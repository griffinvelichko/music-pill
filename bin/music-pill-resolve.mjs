#!/usr/bin/env node
// Prints a <music-pill> attribute snippet for a Spotify track.
// Title and artwork come from Spotify oEmbed. The artist is read from the
// public track page (Node 20+). Browsers cannot read that page (CORS).
// No audio URL is requested.
//   npx music-pill-resolve https://open.spotify.com/track/<id>
//   npx music-pill-resolve https://open.spotify.com/track/<id> --artist "Name"
import { ARTIST_UNAVAILABLE_NOTE, resolveSpotifyMetadata, toMusicPillSnippet } from '../dist/resolve.js';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: music-pill-resolve <spotify-track-url> [--artist "Name"] [--json]

Title and artwork come from Spotify oEmbed. The artist is read from the
public track page in Node 20 or newer. --artist replaces that name, including
when you pass an empty string. --json prints the metadata object.`);
  process.exit(args.length === 0 ? 1 : 0);
}
const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--artist');
const artistIndex = args.indexOf('--artist');
const artistProvided = artistIndex >= 0;
const artist = artistProvided ? (args[artistIndex + 1] ?? '') : undefined;

try {
  const meta = await resolveSpotifyMetadata(url ?? '');
  const snippetOptions = artistProvided ? { artist } : {};
  if (args.includes('--json')) console.log(JSON.stringify(meta, null, 2));
  else console.log(toMusicPillSnippet(meta, snippetOptions));
  if (meta.status === 'unavailable') {
    console.error('Note: oEmbed lookup failed; the snippet has no title or artwork from Spotify.');
  }
  if (!artistProvided && !meta.artist) console.error(`Note: ${ARTIST_UNAVAILABLE_NOTE}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
