#!/usr/bin/env node
// Prints a <music-pill> attribute snippet for a Spotify track using the
// documented oEmbed fields (title, thumbnail). Run locally or at build time:
//   npx music-pill-resolve https://open.spotify.com/track/<id> --artist "Artist"
import { resolveSpotifyMetadata, toMusicPillSnippet } from '../dist/resolve.js';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: music-pill-resolve <spotify-track-url> [--artist "Name"] [--json]');
  process.exit(args.length === 0 ? 1 : 0);
}
const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--artist');
const artistIndex = args.indexOf('--artist');
const artist = artistIndex >= 0 ? args[artistIndex + 1] : undefined;

try {
  const meta = await resolveSpotifyMetadata(url ?? '');
  if (args.includes('--json')) console.log(JSON.stringify(meta, null, 2));
  else console.log(toMusicPillSnippet(meta, artist ? { artist } : {}));
  if (meta.status === 'unavailable') {
    console.error('Note: oEmbed lookup failed; the snippet only contains the link.');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
