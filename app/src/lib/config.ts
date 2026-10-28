// Audius' own hosts, the only places this page sends a reader's browser besides its own.
// Artwork is a CID on each track, resolved through a content node; audio is the API's
// stream route, which 302s to whichever node holds the file, with open CORS.
export const CONTENT_NODE = 'https://creatornode.audius.co';
export const DISCOVERY_NODE = 'https://api.audius.co';
/** Audius' attribution convention; required on every API call, no key needed. */
export const APP_NAME = 'fangorn-music';
