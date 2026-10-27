"""python sources/test_audius_dump.py — the extract and the recipe on a tiny fake dump."""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import json
import tempfile
from audius_dump import TAG, extract, main, select, unescape

T = "\t"
TRACK_COLS = ["track_id", "is_current", "is_delete", "owner_id", "title", "tags", "genre", "mood",
              "description", "release_date", "created_at", "duration", "is_unlisted", "is_available",
              "is_stream_gated", "stream_conditions", "stem_of", "bpm", "musical_key", "cover_art_sizes", "txhash"]


def track(tid, owner, title, **kw):
    row = {"track_id": tid, "is_current": "t", "is_delete": "f", "owner_id": owner, "title": title,
           "tags": "summer,#Beach, chill", "genre": "Electronic", "mood": "Upbeat",
           "description": r"line one\nline\ttwo", "release_date": "2024-06-01 00:00:00",
           "created_at": "2024-05-30 00:00:00", "duration": "201", "is_unlisted": "f", "is_available": "t",
           "is_stream_gated": "f", "stream_conditions": r"\N", "stem_of": r"\N", "bpm": "124.2",
           "musical_key": "A minor", "cover_art_sizes": "QmArt", "txhash": "0x"} | kw
    return T.join(row[c] for c in TRACK_COLS)


DUMP = "\n".join([
    "SET client_encoding = 'UTF8';",
    "COPY public.aggregate_plays (play_item_id, count) FROM stdin;",
    "1\t900", "2\t800", "3\t700", "4\t600", "5\t5", r"\.",
    "COPY public.notifications (id, body) FROM stdin;", "1\tsecret", r"\.",
    "COPY public.track_routes (slug, title_slug, track_id, is_current) FROM stdin;",
    "sunny-drive\tx\t1\tt", "old-slug\tx\t1\tf", r"\.",
    f"COPY public.tracks ({', '.join(TRACK_COLS)}) FROM stdin;",
    track("1", "10", "Sunny Drive"),
    track("2", "10", "Hidden", is_unlisted="t"),
    track("3", "11", "Gated", is_stream_gated="t"),
    track("4", "12", "Gone artist"),
    track("5", "10", "Below floor"),
    r"\.",
    "COPY public.users (user_id, is_current, handle, name, is_verified, is_deactivated, is_available, wallet) FROM stdin;",
    "10\tt\tdj_sun\tDJ Sun\tt\tf\tt\t0xWALLET", "11\tt\tgate\tGate\tf\tf\tt\t0x2", "12\tt\tgone\tGone\tf\tt\tt\t0x3",
    r"\.", "",
])

assert unescape(r"\N") is None and unescape(r"a\tb\\c\101") == "a\tb\\cA"

cache = extract(io.BytesIO(DUMP.encode()), target=1)   # floor keeps the top 4 plays
assert set(cache["plays"]) == {"1", "2", "3", "4"}, cache["plays"]
assert "5" not in cache["tracks"] and cache["routes"] == {"1": "sunny-drive"}
assert cache["users"]["10"]["wallet"] == "0xWALLET"     # kept locally, for claims

nodes = select({**cache, "counts": {}}, limit=10)
assert [r["fields"]["title"] for r in nodes] == ["Sunny Drive"], nodes
rec = nodes[0]
f = rec["fields"]
assert rec["name"] == f["track_id"] == "audius:track:1"
assert f["url"] == "https://audius.co/dj_sun/sunny-drive" and f["bpm"] == 124 and f["plays"] == 900
assert f["tags"] == ["summer", "beach", "chill"] and f["release_date"] == "2024-06-01"
assert f["text"].startswith("An upbeat Electronic track. Tagged summer, beach, chill. Club tempo, 124 BPM in A minor."), f["text"]
assert "line one line two" in f["text"] and "Sunny Drive" not in f["text"]
assert "WALLET" not in str(nodes) and "secret" not in str(nodes)

# --publish: stage, then repo init → commit --replace → push, with the batch in the CLI's shape.
with tempfile.TemporaryDirectory() as d:
    import gzip
    os.makedirs(f"{d}/cache")
    with gzip.open(f"{d}/cache/extract.json.gz", "wt") as fh:
        json.dump({**cache, "counts": {}, "etag": "E", "limit": 10}, fh)
    fake = f"{d}/fangorn"
    with open(fake, "w") as fh:
        fh.write("#!/bin/sh\necho \"$@\" >> " + d + "/calls\n"
                 "[ \"$1\" = commit ] && cp \"$2\" " + d + "/sent.json\nexit 0\n")
    os.chmod(fake, 0o755)
    import audius_dump, urllib.request
    audius_dump.urllib.request.urlopen = lambda *a, **k: type("R", (), {"headers": {"ETag": '"E"'}})()
    main(["--output-dir", f"{d}/stage", "--cache-dir", f"{d}/cache", "--limit", "10",
          "--publish", "--namespace", "ns", "--fangorn-bin", fake])
    calls = open(f"{d}/calls").read().splitlines()
    assert calls[0] == "repo init ns" and calls[1].startswith("commit ") and calls[1].endswith("--replace") and calls[2] == "push", calls
    sent = json.load(open(f"{d}/sent.json"))["records"]
    assert sent == [{"id": "audius:track:1", "type": TAG, "payload": f}], sent
    assert json.load(open(f"{d}/stage/volume_1_tracks.json")) == nodes
print("ok")
