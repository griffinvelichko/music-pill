#!/usr/bin/env node
// Regenerates examples/sample-track/index.html and resolved.json by running
// the resolver against one track. Requires `npm run build` first, because
// this imports dist/resolve.js. It is not part of `npm run check`: it needs
// the network.
//
//   npm run build && npm run generate:sample-track
//
// The page title, artist, and artwork are whatever the resolver returns.
// audio-src stays the repo's generated test tone.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACK_URL = 'https://open.spotify.com/track/5GjUhwxykUVYCYkiNo4BEM';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'examples', 'sample-track');

let resolveSpotifyMetadata;
try {
  ({ resolveSpotifyMetadata } = await import('../dist/resolve.js'));
} catch {
  console.error('Could not import dist/resolve.js. Run `npm run build` first.');
  process.exit(1);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const meta = await resolveSpotifyMetadata(TRACK_URL);
const recorded = {
  spotifyUrl: meta.spotifyUrl,
  title: meta.title,
  artist: meta.artist,
  artworkUrl: meta.artworkUrl,
  artworkWidth: meta.artworkWidth,
  artworkHeight: meta.artworkHeight,
  status: meta.status,
};

if (meta.status !== 'ok') {
  console.error('oEmbed lookup failed. The sample page was not rewritten.');
  console.error(JSON.stringify(recorded, null, 2));
  process.exit(1);
}

const template = readFileSync(join(dir, 'index.template.html'), 'utf8');
const html = template
  .replaceAll('{{spotifyUrl}}', escapeHtml(meta.spotifyUrl))
  .replaceAll('{{title}}', escapeHtml(meta.title ?? ''))
  .replaceAll('{{artist}}', escapeHtml(meta.artist ?? ''))
  .replaceAll('{{artworkUrl}}', escapeHtml(meta.artworkUrl ?? ''));

if (html.includes('{{')) {
  console.error('The sample template still has unreplaced tokens.');
  process.exit(1);
}

writeFileSync(join(dir, 'resolved.json'), `${JSON.stringify(recorded, null, 2)}\n`);
writeFileSync(join(dir, 'index.html'), html);

if (!meta.artist) {
  console.warn('Artist was empty. The page was written with an empty artist, matching the resolver.');
}
console.log(`Wrote examples/sample-track for ${meta.title || '(no title)'} — ${meta.artist || '(no artist)'}`);
