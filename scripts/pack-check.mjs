#!/usr/bin/env node
// Packs the library, installs the tarball into a throwaway consumer project
// (.tmp/consumer), and verifies what a real user would get:
//   - tarball contents (dist, bin, licence files; no tests/fixtures)
//   - Node ESM imports of every export path (SSR safety included)
//   - TypeScript resolution of types under "bundler" and "nodenext",
//     including the opt-in React JSX typing
//   - the packaged dist/auto.js registers and renders in a real browser
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = join(root, '.tmp', 'consumer');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const ok = (msg) => console.log(`  ✓ ${msg}`);

rmSync(join(root, '.tmp'), { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. Pack and inspect contents.
const [packInfo] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', join(root, '.tmp')]));
const files = packInfo.files.map((f) => f.path);
const must = ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/index.js', 'dist/auto.js', 'dist/resolve.js', 'dist/index.d.ts', 'dist/auto.d.ts', 'dist/react-jsx.d.ts', 'bin/music-pill-resolve.mjs'];
for (const f of must) if (!files.includes(f)) throw new Error(`tarball is missing ${f}`);
const banned = files.filter((f) => /^(tests|fixtures|playground|src|scripts|examples)\//.test(f) || /\.(wav|mp3|tgz)$/.test(f));
if (banned.length) throw new Error(`tarball contains files that should not ship: ${banned.join(', ')}`);
ok(`tarball ${packInfo.filename}: ${files.length} files, ${(packInfo.size / 1024).toFixed(1)} kB packed`);

// 2. Install into a consumer project.
writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2));
run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', join(root, '.tmp', packInfo.filename),
  `typescript@${pkg.devDependencies.typescript}`, `@types/react@${pkg.devDependencies['@types/react']}`, `@playwright/test@${pkg.devDependencies['@playwright/test']}`], work);
ok('installed tarball into .tmp/consumer');

// 3. Node ESM imports (no DOM present).
writeFileSync(join(work, 'node-check.mjs'), `
const root = await import('music-pill');
const auto = await import('music-pill/auto');
const resolveMod = await import('music-pill/resolve');
const pkg = await import('music-pill/package.json', { with: { type: 'json' } });
if (root.registerMusicPill() !== undefined) throw new Error('should no-op in Node');
if (typeof auto.registerMusicPill !== 'function') throw new Error('auto re-exports missing');
if (typeof resolveMod.toMusicPillSnippet !== 'function') throw new Error('resolve export missing');
if (!pkg.default.version) throw new Error('package.json export missing');
console.log('node imports ok');
`);
run('node', ['node-check.mjs'], work);
ok('Node imports: music-pill, music-pill/auto, music-pill/resolve, music-pill/package.json');

// 4. CLI binary resolves from the installed package.
const help = run(join(work, 'node_modules', '.bin', 'music-pill-resolve'), ['--help'], work);
if (!help.includes('Usage')) throw new Error('bin did not print usage');
ok('bin: music-pill-resolve --help');

// 5. TypeScript consumers.
writeFileSync(join(work, 'consumer.ts'), `
import { registerMusicPill, normalizeSpotifyTrackUrl, type MusicPillElement, type PlaybackState, type MusicPillEventMap } from 'music-pill';
import 'music-pill/auto';
import { resolveSpotifyMetadata, type SpotifyOEmbedMetadata } from 'music-pill/resolve';
const ctor = registerMusicPill();
const el: MusicPillElement | null = document.querySelector('music-pill');
const state: PlaybackState | undefined = el?.playbackState;
if (el) el.audioSources = [{ src: '/audio/licensed-song.mp3', type: 'audio/mpeg' }];
el?.addEventListener('music-pill-statechange', (e) => { const s: PlaybackState = e.detail.state; void s; });
el?.addEventListener('music-pill-error', (e) => { const c: string = e.detail.code; void c; });
void el?.enableSound();
el?.mute();
const meta: Promise<SpotifyOEmbedMetadata> = resolveSpotifyMetadata('spotify:track:4PTG3Z6ehGkBFwjybzWkR8');
type _E = MusicPillEventMap['music-pill-ready'];
void ctor; void state; void meta; void normalizeSpotifyTrackUrl;
`);
writeFileSync(join(work, 'consumer.tsx'), `
import type {} from 'music-pill/react-jsx';
export const ok = (
  <music-pill
    spotify-url="https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8"
    song-title="Song"
    artist="Artist"
    size="md"
    position="bottom-left"
    volume={0.3}
    onmusic-pill-statechange={(e) => console.log(e.detail.state)}
  />
);
// @ts-expect-error invalid enumerated value
export const bad = <music-pill spotify-url="x" size="huge" />;
`);
for (const moduleResolution of ['bundler', 'nodenext']) {
  writeFileSync(join(work, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: moduleResolution === 'bundler' ? 'ESNext' : 'NodeNext',
      moduleResolution,
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      lib: ['ES2022', 'DOM'],
      types: [],
    },
    files: ['consumer.ts', 'consumer.tsx'],
  }, null, 2));
  run(join(work, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], work);
  ok(`TypeScript (${moduleResolution}): root, auto, resolve and react-jsx types resolve`);
}

// 6. Packaged browser bundle renders in Chromium.
writeFileSync(join(work, 'browser-check.mjs'), `
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const code = readFileSync('node_modules/music-pill/dist/auto.js', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><music-pill spotify-url="spotify:track:4PTG3Z6ehGkBFwjybzWkR8" song-title="Song" artist="Artist"></music-pill>');
await page.addScriptTag({ content: code, type: 'module' });
const href = await page.waitForFunction(() => document.querySelector('music-pill')?.shadowRoot?.querySelector('a')?.getAttribute('href'));
const value = await href.jsonValue();
await browser.close();
if (value !== 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8') throw new Error('bad href ' + value);
console.log('browser ok');
`);
run('node', ['browser-check.mjs'], work);
ok('packaged dist/auto.js registers and renders <music-pill> in Chromium');

console.log('pack check passed');
