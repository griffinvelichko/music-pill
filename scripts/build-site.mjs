#!/usr/bin/env node
// Assembles the static GitHub Pages site into _site/:
//   index.html (site/), dist/, playground/, selected examples/, fixtures/
// Run after `npm run build`. All page paths are relative, so the site works
// under the /music-pill/ project-pages prefix and on any other host.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, '_site');
if (!existsSync(join(root, 'dist', 'auto.js'))) {
  console.error('dist/auto.js is missing. Run `npm run build` first.');
  process.exit(1);
}

// examples/sample-track is left out: it plays the generated test tone under a
// real song's title, which the public site should not present.
const EXAMPLES = ['strobe', 'sources', 'plain-html'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'site', 'index.html'), join(out, 'index.html'));
cpSync(join(root, 'dist'), join(out, 'dist'), { recursive: true, filter: (src) => !src.endsWith('.d.ts') });
cpSync(join(root, 'playground'), join(out, 'playground'), { recursive: true });
for (const name of EXAMPLES) {
  cpSync(join(root, 'examples', name), join(out, 'examples', name), { recursive: true });
}
cpSync(join(root, 'fixtures'), join(out, 'fixtures'), { recursive: true });
writeFileSync(join(out, '.nojekyll'), '');
console.log(`site assembled in _site/ (examples: ${EXAMPLES.join(', ')})`);
