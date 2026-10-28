// The catalogue, in this worker: westmarch's view of the 50k tracks, read with westmarch's
// own shard reader, ranked with its own search, and the queries embedded here by its own
// encoder — so a search on this page means exactly what the same search means to an agent
// on /mcp. Nothing leaves the tab.
//
// The view holds tracks only. Artists, genres and moods are read out of the tracks' fields
// (artist_id, genre, mood) as records of their own, with the relations the demo's pages
// walk (`created`, `inGenre`, `hasMood`), so its pages work unchanged on this data.
import { configure, loadShard } from '@fangorn-network/westmarch/shard';
import * as embed from '@fangorn-network/westmarch/embed';
import { search as rankRows } from '@fangorn-network/westmarch/tools';
import { rolesFrom, values } from '@fangorn-network/westmarch/roles';
import type { Rec, RelationGroup, Stats } from './types.ts';
import { cosToDistance, toFeatures } from '../kernel/adapt.ts';
import {
  describe, deserialiseState, emptyKernel, onPlay, onSkip,
  queryVector as kernelQuery, reweight, serialiseState,
} from '../kernel/SessionKernel.ts';
import type { Hit, KernelState, KernelStateJSON, WeightedHit } from '../kernel/types.ts';

/** What gets stored between visits. See `kernelExport`. */
export interface KernelPersist {
  state: KernelStateJSON;
  /** Ids already signalled on; kept out of a returning visitor's recommendations. */
  seen: string[];
}

/** Choices offered on the first screen. Each artist carries its main genre, so the
 *  picker can offer the artists of the genres chosen. */
export interface OnboardingOptions {
  genres: { id: string; title: string; tracks: number }[];
  artists: { id: string; name: string; genre: string; tracks: number; plays: number }[];
}

/**
 * Greedy per-artist cap, with backfill: at most `per` from one artist, and if that
 * cannot fill `k` the rest comes from the overflow, so a rail is never short.
 */
const capPerArtist = (ranked: WeightedHit[], k: number, per: number): WeightedHit[] => {
  const out: WeightedHit[] = [];
  const overflow: WeightedHit[] = [];
  const n = new Map<string, number>();
  for (const h of ranked) {
    const a = h.metadata?.artistId ?? h.id;
    const c = n.get(a) ?? 0;
    if (out.length < k && c < per) { n.set(a, c + 1); out.push(h); }
    else overflow.push(h);
  }
  return out.concat(overflow).slice(0, k);
};

/** How many tracks each onboarding pick plays into the kernel. Small on purpose: the
 *  prior's pull decays as k/t, so a heavy seed starts the first session already convinced. */
const SEED_PER_ARTIST = 4;
const SEED_PER_GENRE = 3;
/** An artist needs this many tracks here to be worth following at onboarding. */
const MIN_SEED_TRACKS = 3;
/** Most slots one artist may hold in a rail before backfill. */
const MAX_PER_ARTIST = 2;

export type SignalKind = 'play' | 'skip' | 'like' | 'dislike';
export type OnProgress = (phase: string, pct: number, detail?: string) => void;

/** A row as westmarch's shard reader hands it over: the track's fields, flattened. */
type Row = Record<string, any> & { id: string; vector: ArrayLike<number> | null; norm: number };

const plays = (r: Row) => Number(r.plays) || 0;

export class Graph {
  private rows: Row[] = [];
  private roles: any = null;
  /** Records by the publisher's id ("audius:track:1"), which outlives a re-publish; a
   *  row's own id is its CID, which changes whenever the track's play count does. */
  private indexById = new Map<string, number>();
  private indexByCid = new Map<string, number>();
  /** Artists, genres and moods, read out of the tracks. */
  private derived = new Map<string, Rec>();
  /** derived id → its tracks, most played first. */
  private tracksOf = new Map<string, number[]>();
  private _stats: Stats | null = null;
  private _onboarding: OnboardingOptions | null = null;
  private kernel: KernelState = emptyKernel();
  /** Records already signalled on, kept out of recommendations. Persisted with the kernel. */
  private seen = new Set<string>();

  get stats(): Stats | null { return this._stats; }

  async load(view: string, onProgress: OnProgress = () => {}) {
    let total = 0;
    configure({
      // The text the tracks were embedded from: what lexical search matches, beside
      // the title, artist and tags the role map names.
      rowText: (f: Record<string, unknown>) => String(f.text ?? ''),
      onManifests: (ms: Array<{ count?: number }>) => {
        total = ms.reduce((n, m) => n + (m.count ?? 0), 0);
        this.roles = rolesFrom(ms);
      },
    });
    onProgress('catalog', 1, 'Finding the catalogue');
    this.rows = await loadShard(view, (rows: Row[]) =>
      onProgress('rows', total ? Math.min(96, (rows.length / total) * 96) : 50,
        `${rows.length.toLocaleString()} of ${total.toLocaleString()} tracks`));
    onProgress('index', 97, 'Sorting artists, genres and moods');
    this.index();
    onProgress('ready', 100);
    return this._stats!;
  }

  private index() {
    const by = (prefix: string, key: (r: Row) => string) => {
      for (const [i, r] of this.rows.entries()) {
        const k = key(r);
        if (!k) continue;
        const id = `${prefix}${k}`;
        let l = this.tracksOf.get(id);
        if (!l) this.tracksOf.set(id, (l = []));
        l.push(i);
      }
    };
    for (const [i, r] of this.rows.entries()) {
      this.indexById.set(String(r.track_id ?? r.id), i);
      this.indexByCid.set(r.id, i);
    }
    by('', (r) => String(r.artist_id ?? ''));
    by('genre:', (r) => String(r.genre ?? '').trim());
    by('mood:', (r) => String(r.mood ?? '').trim());
    for (const [id, l] of this.tracksOf) {
      l.sort((a, b) => plays(this.rows[b]) - plays(this.rows[a]));
      const top = this.rows[l[0]];
      const sum = l.reduce((n, i) => n + plays(this.rows[i]), 0);
      const kind = id.startsWith('genre:') ? 'Genre' : id.startsWith('mood:') ? 'Mood' : 'Artist';
      this.derived.set(id, {
        id, entityType: kind, owner: top.owner,
        fields: kind === 'Artist'
          ? { source: 'audius', title: top.artist, artist: top.artist, handle: top.artist_handle,
              isVerified: !!top.artist_verified, artworkCid: top.artwork_cid ?? undefined,
              playCount: sum, trackCount: l.length }
          : { title: id.slice(id.indexOf(':') + 1), playCount: sum, trackCount: l.length },
      });
    }
    const count = (t: string) => [...this.derived.values()].filter((r) => r.entityType === t).length;
    const counts = { Track: this.rows.length, Artist: count('Artist'), Genre: count('Genre'), Mood: count('Mood') };
    this._stats = {
      records: this.rows.length + this.derived.size,
      // Every track links to its artist, genre and mood when it has them.
      edges: [...this.tracksOf.values()].reduce((n, l) => n + l.length, 0),
      publishers: [...new Set(this.rows.map((r) => r.owner))].map((owner) => ({
        owner, counts, total: Object.values(counts).reduce((a, b) => a + b, 0),
      })),
      linkset: [], linksetTotal: 0, converged: 0,
    };
  }

  // ── records ────────────────────────────────────────────────────────────────

  /** A track in the shape the pages read (the demo's field names). Built on demand:
   *  the rows already hold everything, and 50k copies would double the memory. */
  private toRec(i: number, score?: number): Rec {
    const r = this.rows[i];
    return {
      id: String(r.track_id ?? r.id), entityType: 'Track', owner: r.owner, score,
      fields: {
        source: 'audius', id: String(r.audius_id ?? ''), title: r.title, artist: r.artist,
        artistId: r.artist_id, artistHandle: r.artist_handle, isVerified: !!r.artist_verified,
        genre: r.genre || undefined, mood: r.mood || undefined, tags: values(r.tags ?? '').join(', '),
        artworkCid: r.artwork_cid ?? undefined, duration: r.duration, playCount: r.plays,
        repostCount: r.reposts, favoriteCount: r.saves, releaseDate: r.release_date,
        permalink: r.url, bpm: r.bpm, key: r.key, description: r.text,
      },
    };
  }

  entity(id: string): Rec | null {
    const i = this.indexById.get(id);
    if (i !== undefined) return this.toRec(i);
    const d = this.derived.get(id);
    return d ? { ...d, fields: { ...d.fields } } : null;
  }

  /** A track's vector, unit length, as the kernel takes it. */
  private vectorOf(i: number): Float32Array | null {
    const r = this.rows[i];
    if (!r?.vector) return null;
    const v = Float32Array.from(r.vector);
    for (let d = 0; d < v.length; d++) v[d] /= r.norm;
    return v;
  }

  /** The `k` tracks nearest a unit vector, by cosine. */
  private topK(q: ArrayLike<number>, k: number, accept: (i: number) => boolean) {
    const best: Array<[number, number]> = [];
    let floor = -Infinity;
    for (let i = 0; i < this.rows.length; i++) {
      const v = this.rows[i].vector;
      if (!v || !accept(i)) continue;
      let dot = 0;
      for (let d = 0; d < q.length; d++) dot += v[d] * q[d];
      dot /= this.rows[i].norm;
      if (best.length >= k && dot <= floor) continue;
      best.push([i, dot]);
      if (best.length > k) { best.sort((a, b) => b[1] - a[1]); best.length = k; floor = best[k - 1][1]; }
    }
    return best.sort((a, b) => b[1] - a[1]);
  }

  // ── search ─────────────────────────────────────────────────────────────────

  /** Start loading the encoder. `onProgress` hears its download (0–100), when this
   *  westmarch reports one. */
  warm(onProgress: (pct: number, detail: string) => void) {
    const files = new Map<string, [number, number]>();
    // ponytail: optional until westmarch with onModelProgress is the pinned version; then call it plainly.
    (embed as any).onModelProgress?.((p: any) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let got = 0, all = 0;
      for (const [l, t] of files.values()) { got += l; all += t; }
      onProgress((got / all) * 100, `${(got / 1e6).toFixed(0)} of ${(all / 1e6).toFixed(0)} MB`);
    });
    return embed.warmDirect();
  }

  /**
   * westmarch's own search: cosine against the query plus a boost for words found in
   * the title, artist and tags, floored per query. Artists, genres and moods whose
   * name the query spells out come first. A model that fails to load leaves the
   * search on words alone, never on a server.
   */
  async search(q: string, k: number, type?: string): Promise<Rec[]> {
    const ql = q.trim().toLowerCase();
    const named = [...this.derived.values()]
      .filter((d) => (!type || d.entityType === type) && String(d.fields.title ?? '').toLowerCase() === ql);
    if (type && type !== 'Track') {
      // Artists by name, the closest first: a whole-name match, then a name holding the words.
      const words = ql.split(/\s+/).filter(Boolean);
      const near = [...this.derived.values()].filter((d) => d.entityType === type && !named.includes(d)
        && words.every((w) => String(d.fields.title ?? '').toLowerCase().includes(w)));
      return [...named, ...near].sort((a, b) => Number(b.fields.playCount) - Number(a.fields.playCount)).slice(0, k);
    }
    const qv = await embed.embedQueryDirect(q).catch(() => null);
    const hits = rankRows(this.rows, q, this.roles, { qv, limit: k }) as Array<{ id: string; score: number }>;
    return [...named.slice(0, 4), ...hits.map((h) => this.toRec(this.indexByCid.get(h.id)!, h.score))];
  }

  // ── relations, read out of the fields ──────────────────────────────────────

  /** Record indices on one relation from a record, most played first. Tracks are
   *  numbers into `rows`; artists, genres and moods are their ids. */
  private linked(id: string, rel: string, dir: 'out' | 'in'): Array<number | string> {
    const i = this.indexById.get(id);
    if (i !== undefined) {
      const r = this.rows[i];
      const to = rel === 'created' && dir === 'in' ? r.artist_id
        : rel === 'inGenre' && dir === 'out' && r.genre ? `genre:${r.genre}`
          : rel === 'hasMood' && dir === 'out' && r.mood ? `mood:${r.mood}` : null;
      return to && this.derived.has(to) ? [to] : [];
    }
    const kind = this.derived.get(id)?.entityType;
    const own = (kind === 'Artist' && rel === 'created' && dir === 'out')
      || (kind === 'Genre' && rel === 'inGenre' && dir === 'in')
      || (kind === 'Mood' && rel === 'hasMood' && dir === 'in');
    return own ? this.tracksOf.get(id) ?? [] : [];
  }

  private recOf(x: number | string): Rec | null {
    return typeof x === 'number' ? this.toRec(x) : this.entity(x);
  }

  relations(id: string): RelationGroup[] {
    const shapes: Array<[string, 'out' | 'in']> = [['created', 'in'], ['inGenre', 'out'], ['hasMood', 'out'],
      ['created', 'out'], ['inGenre', 'in'], ['hasMood', 'in']];
    return shapes
      .map(([rel, dir]) => ({ rel, dir, count: this.linked(id, rel, dir).length, crosses: false }))
      .filter((g) => g.count > 0);
  }

  neighbours(id: string, rel: string, dir: 'out' | 'in', limit: number) {
    const all = this.linked(id, rel, dir);
    return { records: all.slice(0, limit).map((x) => this.recOf(x)!).filter(Boolean), total: all.length };
  }

  // ── session kernel ─────────────────────────────────────────────────────────

  /** One signal into the kernel. A thumb is the same evidence as a play or skip, only
   *  unambiguous: there is one state machine. */
  kernelSignal(id: string, kind: SignalKind): ReturnType<typeof describe> {
    const i = this.indexById.get(id);
    const vec = i === undefined ? null : this.vectorOf(i);
    if (i !== undefined && vec) {
      const feat = toFeatures(this.toRec(i), vec);
      this.kernel = (kind === 'skip' || kind === 'dislike') ? onSkip(this.kernel, feat) : onPlay(this.kernel, feat);
      this.seen.add(id);
    }
    return describe(this.kernel);
  }

  kernelReset(): ReturnType<typeof describe> {
    this.kernel = emptyKernel();
    this.seen.clear();
    return describe(this.kernel);
  }

  kernelSnapshot() {
    return { ...describe(this.kernel), signals: this.seen.size };
  }

  kernelExport(): KernelPersist {
    return { state: serialiseState(this.kernel), seen: [...this.seen] };
  }

  kernelImport(p: KernelPersist): ReturnType<typeof describe> {
    this.kernel = deserialiseState(p.state);
    this.seen = new Set(p.seen ?? []);
    return describe(this.kernel);
  }

  /** Take tracks in order, at most `per` from one artist: an artist's catalogue
   *  clusters tightly, so the nearest N of anything is otherwise one artist repeated. */
  private capByArtist(ranked: Array<[number, number]>, k: number, per = 2): Rec[] {
    const seen = new Map<string, number>();
    const out: Rec[] = [];
    for (const [i, score] of ranked) {
      const a = String(this.rows[i].artist_id ?? i);
      const n = seen.get(a) ?? 0;
      if (n >= per) continue;
      seen.set(a, n + 1);
      out.push(this.toRec(i, score));
      if (out.length >= k) break;
    }
    return out;
  }

  /** The first screen: the biggest genres, and for each the artists most played in it
   *  who have enough tracks here to seed with. */
  onboardingOptions(genreN = 16, perGenre = 6): OnboardingOptions {
    if (this._onboarding) return this._onboarding;
    const of = (t: string) => [...this.derived.values()].filter((d) => d.entityType === t);
    const genres = of('Genre')
      .map((g) => ({ id: g.id, title: String(g.fields.title), tracks: Number(g.fields.trackCount) }))
      .sort((a, b) => b.tracks - a.tracks)
      .slice(0, genreN);
    const mainGenre = (id: string) => {
      const n = new Map<string, number>();
      for (const i of this.tracksOf.get(id) ?? []) { const g = this.rows[i].genre; if (g) n.set(g, (n.get(g) ?? 0) + 1); }
      return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    const artists = of('Artist')
      .filter((a) => Number(a.fields.trackCount) >= MIN_SEED_TRACKS)
      .map((a) => ({ id: a.id, name: String(a.fields.title ?? ''), genre: mainGenre(a.id),
                     tracks: Number(a.fields.trackCount), plays: Number(a.fields.playCount) }))
      .filter((a) => a.name)
      .sort((a, b) => b.plays - a.plays);
    const picked = genres.flatMap((g) => artists.filter((a) => a.genre === g.title).slice(0, perGenre));
    return (this._onboarding = { genres, artists: picked });
  }

  /**
   * Start a kernel from stated taste: each pick plays its most-reposted tracks into it as
   * ordinary `onPlay`s, so it lands where a real session would have. Genres first, the
   * artists last and round-robined: μ is an EMA, so the last plays decide where it ends up.
   */
  kernelSeed(genreIds: string[], artistIds: string[]): ReturnType<typeof describe> {
    const reposts = (i: number) => Number(this.rows[i].reposts) || 0;
    const pick = (id: string, rel: string, dir: 'out' | 'in', n: number) =>
      (this.linked(id, rel, dir) as number[]).slice().sort((a, b) => reposts(b) - reposts(a)).slice(0, n);
    const order: number[] = [];
    const added = new Set<number>();
    const push = (i: number) => { if (!added.has(i)) { added.add(i); order.push(i); } };
    for (const g of genreIds) for (const i of pick(g, 'inGenre', 'in', SEED_PER_GENRE)) push(i);
    const perArtist = artistIds.map((a) => pick(a, 'created', 'out', SEED_PER_ARTIST));
    for (let n = 0; n < SEED_PER_ARTIST; n++) for (const l of perArtist) if (l[n] !== undefined) push(l[n]);

    let k = emptyKernel();
    for (const i of order) {
      const vec = this.vectorOf(i);
      if (vec) k = onPlay(k, toFeatures(this.toRec(i), vec));
    }
    this.kernel = k;
    this.seen.clear();
    return describe(this.kernel);
  }

  /** What else to hear from a track or an artist: the tracks nearest it (for an artist,
   *  nearest the centre of their catalogue). `peers` stays empty: there are no playlists
   *  in this catalogue to say who is heard alongside whom. */
  discovery(id: string, k = 12): { peers: Rec[]; similar: Rec[] } {
    const i = this.indexById.get(id);
    const mine = i !== undefined ? [i] : this.derived.get(id)?.entityType === 'Artist' ? this.tracksOf.get(id) ?? [] : [];
    if (!mine.length) return { peers: [], similar: [] };
    const c = new Float32Array(this.rows[mine[0]].vector?.length ?? 0);
    for (const j of mine) { const v = this.vectorOf(j); if (v) for (let d = 0; d < c.length; d++) c[d] += v[d]; }
    const n = Math.hypot(...c) || 1;
    for (let d = 0; d < c.length; d++) c[d] /= n;
    const artist = i !== undefined ? this.rows[i].artist_id : id;
    const own = new Set(mine);
    // A track's page shows the rest of the artist's catalogue already, so its similar
    // rail looks beyond them.
    const similar = this.capByArtist(this.topK(c, k * 20, (j) => !own.has(j) && this.rows[j].artist_id !== artist), k);
    return { peers: [], similar };
  }

  /** Where the session is heading: rank by the kernel's query vector, then let the
   *  kernel reweight the shortlist. Deterministic, so a rail does not reshuffle while
   *  someone is looking at it. */
  kernelRecommend(k = 12, _owner?: string, pool = 600): Rec[] {
    if (this.kernel.t === 0 && this.kernel.skips.length === 0) return [];
    const q = kernelQuery(this.kernel);
    const shortlist = this.topK(q, pool, (i) => !this.seen.has(String(this.rows[i].track_id)));
    const hits: Hit[] = shortlist.map(([i, score]) => {
      const emb = this.vectorOf(i)!;
      const rec = this.toRec(i);
      const f = toFeatures(rec, emb);
      return {
        id: rec.id, embedding: emb, distance: cosToDistance(score),
        metadata: { artistId: f.artistId, genres: f.genres, moods: f.moods, themes: f.themes,
                    contexts: f.contexts, durationMs: f.durationMs },
      };
    });
    const ranked = reweight(hits, this.kernel).sort((a, b) => b.weight - a.weight);
    return capPerArtist(ranked, k, MAX_PER_ARTIST).map((h) => this.toRec(this.indexById.get(h.id)!, h.weight));
  }

  /** The most played records of a type. */
  sample(type: string, limit: number): Rec[] {
    if (type === 'Track') {
      return this.rows.map((_, i) => i).sort((a, b) => plays(this.rows[b]) - plays(this.rows[a]))
        .slice(0, limit).map((i) => this.toRec(i));
    }
    return [...this.derived.values()].filter((d) => d.entityType === type)
      .sort((a, b) => Number(b.fields.playCount) - Number(a.fields.playCount))
      .slice(0, limit).map((d) => ({ ...d, fields: { ...d.fields } }));
  }
}
