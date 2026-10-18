// Proves the SSR-safe entries can be imported in plain Node without touching
// browser globals. Any access to these names during import throws.
const trapped = ['window', 'document', 'HTMLElement', 'customElements', 'navigator', 'AudioContext', 'sessionStorage'];
const touched = [];
for (const name of trapped) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      touched.push(name);
      throw new Error(`SSR import touched ${name}`);
    },
  });
}
const root = await import('../dist/index.js');
const resolve = await import('../dist/resolve.js');
if (touched.length) throw new Error(`touched: ${touched.join(', ')}`);
for (const name of trapped) delete globalThis[name];

if (typeof root.registerMusicPill !== 'function') throw new Error('registerMusicPill missing');
if (root.registerMusicPill() !== undefined) throw new Error('registerMusicPill should no-op in Node');
if (root.normalizeSpotifyTrackUrl('spotify:track:4PTG3Z6ehGkBFwjybzWkR8') !== 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8') {
  throw new Error('normalize failed');
}
if (typeof resolve.resolveSpotifyMetadata !== 'function') throw new Error('resolver missing');
console.log('SSR import OK: dist/index.js and dist/resolve.js evaluate no browser globals; registerMusicPill() is a no-op in Node.');
