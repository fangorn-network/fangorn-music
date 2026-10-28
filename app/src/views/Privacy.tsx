// Privacy policy. Every claim here is checked against this app's code; change it with them:
//   • localStorage keys: lib/kernel.tsx ("fangorn-music.kernel"), lib/playlists.ts
//     ("fangorn-music.playlists").
//   • Artwork per record from CONTENT_NODE, audio from DISCOVERY_NODE (lib/config.ts).
//   • Search rides in the hash (lib/router.ts, #/search?q=…), which browsers never send.
//   • The model: huggingface.co (transformers.js's default host), and onnxruntime's wasm
//     from cdn.jsdelivr.net (its default wasm path; westmarch's build drops the local copy).
//   • Figtree is bundled (@fontsource-variable/figtree): no font CDN.
//   • The Worker serving this page has Cloudflare's request logs on (wrangler.json
//     observability). No analytics script anywhere in this app.
//   • WebMCP (lib/webmcp.ts) can read the taste (`read-taste`) and write playlists.
import { goHome } from '../lib/router';

export default function Privacy() {
  return (
    <section className="about">
      <div className="hero-kicker">Privacy</div>
      <h1>What this page <em>can</em> know.</h1>
      <p className="about-lede">
        There are no accounts, no logins and no wallet connection here. The catalogue is
        downloaded to your browser and searched there, so most of what you do never
        reaches a server at all, including what you type. The exceptions are below.
      </p>

      <h2>What never leaves your browser</h2>
      <p>
        <b>Your searches.</b> Your query is turned into a vector and matched against the
        catalogue inside this tab. There is no search server to send it to.
      </p>
      <p>
        <b>Not even in the address bar.</b> Searches are addressed as{' '}
        <code>#/search?q=…</code>, a URL <i>fragment</i>. Browsers never send the part
        after <code>#</code> to a server, so your query cannot appear in this site's
        logs. It is still in your own history and in any link you copy.
      </p>
      <p>
        <b>Your taste.</b> What you play, skip, like and dislike is folded into a model
        held in this tab and saved in this browser's storage. It is never uploaded, and
        there is no account to attach it to.
      </p>
      <p>
        <b>Your playlists.</b> A name and a list of track ids, kept in this browser.
        Exporting writes a file you keep; importing reads one here. A shared link
        carries the playlist <i>in the link itself</i>, after the <code>#</code>, so it
        is never sent to this site, but anyone holding the link can read it. Opening
        someone's link only shows it to you until you press Save.
      </p>

      <h2>If you use an AI agent in this browser</h2>
      <p>
        Where a browser supports WebMCP (today, behind a flag), an agent you use can call
        this page's tools: search, the player, your playlists, and your taste, through a
        tool called <code>read-taste</code>. Every tool runs against the catalogue in this
        tab and none of them sends anything to us. Adding to a playlist you already made
        asks you first, and silence is a no. No tool renames or deletes anything.
      </p>

      <h2>What Audius can see</h2>
      <ul className="about-caveats">
        <li>
          <b>Tracks you play.</b> Audio streams from Audius (<code>api.audius.co</code>{' '}
          and their content nodes), so playing a track tells them which one, from this
          app, with your IP address.
        </li>
        <li>
          <b>Artwork you load, which means pages you look at.</b> Cover images load from
          Audius' content node (<code>creatornode.audius.co</code>) as you browse, so that
          traffic shows which tracks and artists you viewed, played or not.
        </li>
      </ul>

      <h2>Other services your browser contacts</h2>
      <ul className="about-caveats">
        <li>
          <b>Hugging Face</b> (<code>huggingface.co</code>) and <b>jsDelivr</b>{' '}
          (<code>cdn.jsdelivr.net</code>): the first time you search, the search model and
          its runtime download from them. Your browser keeps them, and they run here.
        </li>
        <li>
          <b>Cloudflare</b> hosts this site. Its request logs record the address, path and
          time of each request to this site, for running it. Paths here never include
          your searches, the tracks you open or your playlists, which live after the{' '}
          <code>#</code>.
        </li>
      </ul>
      <p>
        No cookies and no analytics. Typefaces are served from this site. Nothing is sold,
        shared, or used for advertising.
      </p>

      <h2>Storage on your device</h2>
      <p>
        Your taste, under <code>fangorn-music.kernel</code>; your playlists, under{' '}
        <code>fangorn-music.playlists</code>; and the catalogue and search model, in your
        browser's cache. Clearing this site's data removes them all. The strip at the top
        of the page resets your taste without touching anything else.
      </p>

      <button className="back" onClick={goHome}>← Back to the music</button>
    </section>
  );
}
