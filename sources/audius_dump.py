"""Audius tracks from the weekly Postgres dump: the most-played, listed, ungated ones.

A snapshot source. One streaming pass over the dump (~27 GB gzipped, plain SQL) pulls only
the catalog tables' COPY blocks into a small cache, keyed by the dump's ETag, so a rerun on
the same dump never downloads again. Nothing outside those tables is read.

    python sources/audius_dump.py --output-dir .ship/stage/tracks --cache-dir .ship/cache/tracks
"""
import gzip
import heapq
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

from quickbeam import SourceBase

TAG = "fangorn-music.track.v1"
DUMP = "https://audius-pgdump.s3-us-west-2.amazonaws.com/discProvProduction.sql.gz"

# table → the columns kept. Everything else in the dump (plays by user, wallets' balances,
# notifications, keys) is never parsed.
COLS = {
    "aggregate_plays": ["play_item_id", "count"],
    "aggregate_track": ["track_id", "repost_count", "save_count"],
    "track_routes": ["slug", "track_id", "is_current"],
    "tracks": ["track_id", "is_current", "is_delete", "owner_id", "title", "tags", "genre", "mood",
               "description", "release_date", "created_at", "duration", "is_unlisted", "is_available",
               "is_stream_gated", "stream_conditions", "stem_of", "bpm", "musical_key", "cover_art_sizes"],
    "users": ["user_id", "is_current", "handle", "name", "is_verified", "is_deactivated", "is_available", "wallet"],
}
# ponytail: keep this many top play counts while streaming so tracks below them are never
# held; 4x the target leaves room for the deleted/unlisted/gated ones dropped later.
FLOOR_MARGIN = 4

_ESC = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v"}


def unescape(s):
    """One field of COPY's text format."""
    if s == r"\N":
        return None
    if "\\" not in s:
        return s
    return re.sub(r"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)", lambda m: (
        chr(int(m[1], 8)) if m[1][0] in "01234567" else
        chr(int(m[1][1:], 16)) if m[1][0] == "x" and len(m[1]) > 1 else
        _ESC.get(m[1], m[1])), s)


def copy_blocks(lines):
    """(table, row dict) for each row of a wanted table's COPY block. `lines` are bytes, and
    only a wanted block's are decoded: the rest of the dump is skipped at bytes speed."""
    want = None
    for line in lines:
        if want is None:
            if line.startswith(b"COPY public."):
                m = re.match(r"COPY public\.(\w+) \((.*)\) FROM stdin;", line.decode())
                if m and m[1] in COLS:
                    cols = m[2].split(", ")
                    want = (m[1], [(cols.index(c), c) for c in COLS[m[1]]])
                    print(f"[audius] reading {m[1]}", file=sys.stderr)
            continue
        if line.startswith(b"\\."):
            want = None
            continue
        parts = line.decode("utf-8", "replace").rstrip("\n").split("\t")
        yield want[0], {c: unescape(parts[i]) for i, c in want[1]}


def extract(lines, target):
    """The cache: plays above a floor, then only the routes, counts, tracks and users those reach."""
    plays, floor, keep = {}, 0, None
    out = {"plays": {}, "counts": {}, "routes": {}, "tracks": {}, "users": {}}
    owners = set()
    for table, r in copy_blocks(lines):
        if table == "aggregate_plays":
            plays[r["play_item_id"]] = int(r["count"] or 0)
            continue
        if keep is None and plays:   # the first table after plays: fix the floor once
            top = heapq.nlargest(target * FLOOR_MARGIN, plays.values())
            floor = top[-1] if top else 0
            keep = {k for k, v in plays.items() if v >= floor}
            out["plays"] = {k: plays[k] for k in keep}
            plays = None
            print(f"[audius] play floor {floor}: {len(keep)} candidate tracks", file=sys.stderr)
        inkeep = (lambda t: True) if keep is None else keep.__contains__
        if table == "aggregate_track" and inkeep(r["track_id"]):
            out["counts"][r["track_id"]] = [int(r["save_count"] or 0), int(r["repost_count"] or 0)]
        elif table == "track_routes" and r["is_current"] == "t" and inkeep(r["track_id"]):
            out["routes"][r["track_id"]] = r["slug"]
        elif table == "tracks" and inkeep(r["track_id"]) and r["is_current"] == "t":
            out["tracks"][r["track_id"]] = r
            owners.add(r["owner_id"])
        elif table == "users" and r["user_id"] in owners and r["is_current"] == "t":
            out["users"][r["user_id"]] = r
    if plays:   # plays came after the tracks: nothing was filtered while streaming
        out["plays"] = plays
    if out["tracks"] and not out["users"]:
        raise SystemExit("[audius] no users matched: the dump put users before tracks; extract needs a second pass")
    return out


def eligible(t, u):
    return (t["is_delete"] == "f" and t["is_unlisted"] == "f" and t["is_available"] != "f"
            and t["is_stream_gated"] != "t" and not t["stream_conditions"] and not t["stem_of"]
            and u is not None and u["is_deactivated"] != "t" and u["is_available"] != "f")


def _clean(s, n=None):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s[:n].rsplit(" ", 1)[0] + "…" if n and len(s) > n else s


def tempo(bpm):
    # ponytail: fixed bands; half/double-time detection would need the audio
    for top, word in [(80, "slow"), (100, "laid-back"), (118, "mid-tempo"), (135, "club tempo"), (160, "fast")]:
        if bpm < top:
            return word
    return "very fast"


def track_record(t, u, plays, counts, slug):
    tid = t["track_id"]
    title, artist = _clean(t["title"]), _clean(u["name"]) or u["handle"]
    genre, mood = _clean(t["genre"]), _clean(re.sub(r"[^\w &/-]+", "", t["mood"] or ""))
    tags = [x for x in dict.fromkeys(re.sub(r"[^\w-]+", "", s.strip().lower().lstrip("#"))
                                     for s in (t["tags"] or "").split(",")) if x]
    bpm = round(float(t["bpm"])) if t["bpm"] else None
    desc = _clean(t["description"], 500)
    date = (t["release_date"] or t["created_at"] or "")[:10]
    # The embedded prose: what a listener's phrasing ("warm lofi for a rainy morning") meets.
    # It leads with the feel and leaves out the title and artist: those are embedded by their
    # own roles, and repeating them here let a word in a title outrank genre and mood.
    feel = " ".join(x for x in [mood.lower() if mood and mood != "Other" else "", genre or "music"] if x)
    text = " ".join(x for x in [
        f"{'An' if feel[0] in 'aeiouAEIOU' else 'A'} {feel} track.",
        f"Tagged {', '.join(tags)}." if tags else "",
        f"{tempo(bpm).capitalize()}, {bpm} BPM{' in ' + t['musical_key'] if t['musical_key'] else ''}." if bpm else "",
        desc,
    ] if x)
    saves, reposts = counts or [None, None]
    return {"name": f"audius:track:{tid}", "fields": {
        "entityType": TAG,
        "track_id": f"audius:track:{tid}",
        "audius_id": int(tid),
        "title": title,
        "artist": artist,
        "artist_handle": u["handle"],
        "artist_id": f"audius:user:{u['user_id']}",
        "artist_verified": u["is_verified"] == "t",
        "genre": genre,
        "mood": mood,
        "tags": tags,
        "bpm": bpm,
        "key": t["musical_key"] or None,
        "duration": int(t["duration"]) if t["duration"] else None,
        "release_date": date or None,
        "plays": plays,
        "saves": saves,
        "reposts": reposts,
        "artwork_cid": t["cover_art_sizes"] or None,
        "url": f"https://audius.co/{u['handle']}/{slug}" if slug else f"https://audius.co/tracks/{tid}",
        "text": text,
    }}


class AudiusDumpSource(SourceBase):
    name = "audius"
    stems = {TAG: "tracks"}
    snapshot_stems = {"tracks"}

    def add_source_args(self, p):
        p.add_argument("--dump-url", default=DUMP)
        p.add_argument("--cache-dir", default=".ship/cache/tracks")
        p.add_argument("--limit", type=int, default=50_000, help="tracks kept, by plays")

    def read(self, cursor, args):
        os.makedirs(args.cache_dir, exist_ok=True)
        path = os.path.join(args.cache_dir, "extract.json.gz")
        req = urllib.request.Request(args.dump_url, method="HEAD")
        etag = urllib.request.urlopen(req, timeout=60).headers["ETag"].strip('"')
        if os.path.exists(path):
            with gzip.open(path, "rt") as f:
                cache = json.load(f)
            if cache["etag"] == etag and cache["limit"] >= args.limit:
                print(f"[audius] cache hit for dump {etag}")
                return self._select(cache, args.limit)
        print(f"[audius] streaming {args.dump_url} ({etag})")
        unzip = shutil.which("pigz") or "gzip"
        curl = subprocess.Popen(["curl", "-sfL", args.dump_url], stdout=subprocess.PIPE)
        gz = subprocess.Popen([unzip, "-dc"], stdin=curl.stdout, stdout=subprocess.PIPE)
        curl.stdout.close()
        cache = {"etag": etag, "limit": args.limit, **extract(gz.stdout, args.limit)}
        if gz.wait() or curl.wait():
            raise SystemExit(f"[audius] download failed (curl {curl.returncode}, gunzip {gz.returncode})")
        with gzip.open(path + ".tmp", "wt") as f:
            json.dump(cache, f)
        os.replace(path + ".tmp", path)
        return self._select(cache, args.limit)

    def _select(self, cache, limit):
        """The top `limit` eligible tracks by plays, each with its artist joined in."""
        users, plays = cache["users"], cache["plays"]
        ok = [t for t in cache["tracks"].values() if eligible(t, users.get(t["owner_id"]))]
        top = heapq.nlargest(limit, ok, key=lambda t: (plays.get(t["track_id"], 0), t["track_id"]))
        print(f"[audius] {len(ok)} eligible of {len(cache['tracks'])}; kept {len(top)}")
        return [{"t": t, "u": users[t["owner_id"]], "plays": plays.get(t["track_id"], 0),
                 "counts": cache["counts"].get(t["track_id"]), "slug": cache["routes"].get(t["track_id"])}
                for t in top]

    def build_graph(self, records):
        # Wallets stay in the cache (for artists claiming later); none reach a record.
        return {TAG: [track_record(**r) for r in records]}, []

    def next_cursor(self, records, prev):
        return prev


if __name__ == "__main__":
    from quickbeam.ingest.scrapers.harness import run_source
    run_source(AudiusDumpSource(), sys.argv[1:])
