import { useEffect, useState } from 'react';
import Card from '../components/Card';
import KernelRail from '../components/KernelRail';
import { RecordRail } from '../components/Rail';
import SearchBar from '../components/SearchBar';
import { neighbours, sample } from '../lib/client';
import { useKernel } from '../lib/kernel';
import { goEntity, goSearch } from '../lib/router';
import type { Rec, Stats } from '../lib/types';

const EXAMPLES = [
  'driving to the beach',
  'rainy day, slow and warm',
  'party at my house',
  'late night synthwave',
  'focus music, no vocals',
];

export default function Home({ stats }: { stats: Stats }) {
  const [popular, setPopular] = useState<Rec[]>([]);
  const [genres, setGenres] = useState<Rec[]>([]);
  const [moods, setMoods] = useState<Rec[]>([]);
  const { railVersion, snap } = useKernel();

  useEffect(() => {
    void sample('Track', 12).then(setPopular);
    void sample('Genre', 40).then(setGenres);
    void sample('Mood', 40).then(setMoods);
  }, []);

  // The kernel names genres in lower case; the catalogue's own records carry the name.
  const yours = (snap?.topGenres ?? [])
    .map(([g]) => genres.find((x) => String(x.fields.title).toLowerCase() === g))
    .filter((g): g is Rec => !!g)
    .slice(0, 2);
  const counts = stats.publishers[0]?.counts ?? {};

  return (
    <>
      <section className="hero">
        <h1>Find music by <em>how it feels</em>.</h1>
        <p>
          Describe a moment, a mood, a time of night. The whole catalogue is in this
          tab and the search runs here. Nothing you type is sent anywhere.
        </p>

        <SearchBar autoFocus />
        <div className="suggestions">
          {EXAMPLES.map((e) => (
            <button key={e} className="suggestion" onClick={() => goSearch(e)}>{e}</button>
          ))}
        </div>

        <p className="hero-stats">
          {(counts.Track ?? 0).toLocaleString()} tracks · {(counts.Artist ?? 0).toLocaleString()} artists ·
          searched in this browser
        </p>
      </section>

      {/* Recommendations first: the page should answer what you've done, not repeat
          what it showed on load. */}
      <KernelRail railVersion={railVersion} stats={stats} />

      {yours.map((g) => <TopIn key={g.id} genre={g} />)}

      {popular.length > 0 && (
        <>
          <div className="section-head"><h2>Most played</h2></div>
          <div className="grid">{popular.map((t) => <Card key={t.id} rec={t} queue={popular} />)}</div>
        </>
      )}

      <Chips title="Genres" recs={genres} />
      <Chips title="Moods" recs={moods} />
    </>
  );
}

/** The most played tracks in a genre the listener leans toward. */
function TopIn({ genre }: { genre: Rec }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  useEffect(() => { void neighbours(genre.id, 'inGenre', 'in', 6).then((r) => setRecs(r.records)); }, [genre.id]);
  return (
    <RecordRail
      title={`Top in ${genre.fields.title}`}
      recs={recs}
      footer={<button className="rail-more" onClick={() => goEntity(genre.id)}>All {genre.fields.title}</button>}
    />
  );
}

function Chips({ title, recs }: { title: string; recs: Rec[] }) {
  if (!recs.length) return null;
  return (
    <>
      <div className="section-head"><h2>{title}</h2></div>
      <div className="suggestions">
        {recs.map((r) => (
          <button key={r.id} className="suggestion" onClick={() => goEntity(r.id)}>{String(r.fields.title)}</button>
        ))}
      </div>
    </>
  );
}
