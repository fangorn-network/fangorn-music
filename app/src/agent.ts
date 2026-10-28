// The page's tools for westmarch's agent card (app.json `site.agent`): `westmarch build`
// imports this, calls registerAgent against a stub modelContext and records what it
// registers. Capture never runs a tool, so nothing behind `get` is ever reached.
import { registerTools } from './lib/webmcp.ts';

export const registerAgent = () => registerTools(document.modelContext!, () => {
  throw new Error('the card captures these tools; the page runs them');
});
