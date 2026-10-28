// What this site is. Counts are read from the catalogue as served, never typed in:
// a hand-typed number goes stale the next time the view is rebuilt.
import { goHome } from '../lib/router';
import type { Stats } from '../lib/types';

export default function About({ stats }: { stats: Stats }) {
  const tracks = stats.publishers[0]?.counts.Track ?? 0;

  return (
    <section className="about">
      <div className="hero-kicker">About</div>
      <h1>A music catalogue that <em>runs in your tab</em>.</h1>
      <p className="about-lede">
        Fangorn Music holds the {tracks.toLocaleString()} most-played tracks on Audius,
        searchable by how they feel. The whole catalogue is downloaded to your browser
        once, and everything after that, from the search to the recommendations, happens
        here, with nothing sent to a server.
      </p>

      <h2>How the catalogue is published</h2>
      <p>
        Each track is a record on Fangorn, published from Audius' public data by one
        wallet. Every record is content-addressed, so anyone can check that what they
        were served is what was published. This site's server only builds a view of
        those records: compressed files with each track's fields and a vector for what
        it sounds like, rebuilt as the catalogue changes. There is no search server and
        no database behind this page.
      </p>

      <h2>What runs where</h2>
      <p>
        The view comes to your browser, and a worker thread in this tab holds it. The
        first time you search, the search model (Google's EmbeddingGemma) downloads to
        your browser too. From then on your words are turned into a vector here and
        compared with every track here. Queries never leave the tab.
      </p>

      <h2>For you</h2>
      <p>
        The recommendations are a taste model, not a playlist. The genres and artists
        you pick start it; from there it follows a position and a direction through the
        same space the search runs in, and steers by what you do. A track you let
        finish pulls it closer; one you skip early pushes it away; a heart or a dash
        says so outright. Skipping a lot of one artist rests them for the session. The
        model is kept in this browser's storage, and the strip at the top of the page
        resets it whenever you like.
      </p>

      <h2>Agents</h2>
      <p>
        An agent in your browser can use this page through WebMCP, where the browser
        supports it: search, open records, drive the player, read your taste and build
        playlists, all against the catalogue already in this tab. Changing a playlist
        you made asks you first. Agents elsewhere can read the same catalogue through
        this site's MCP endpoint, <code>/mcp</code>.
      </p>

      <h2>Where the music comes from</h2>
      <ul className="about-caveats">
        <li>
          <b>The music is Audius'.</b> Audio and artwork stream from Audius' own servers
          as you listen and browse. Some tracks are gated or withdrawn there and will not
          play.
        </li>
        <li>
          <b>Their branding is borrowed, not claimed.</b> The Audius mark attributes where
          a track came from and nothing else. The colours and type scale follow their
          open-source Harmony design tokens, with Figtree in place of their proprietary
          typeface. This site is not an Audius property, nor affiliated with or endorsed
          by them.
        </li>
      </ul>

      <button className="back" onClick={goHome}>← Back to the music</button>
    </section>
  );
}
