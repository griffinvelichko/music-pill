// Deterministically generates the original, rights-free test fixtures:
//   fixtures/audio/test-tone.wav   quiet 440 Hz + 660 Hz tone, 6 s, mono 16-bit 22.05 kHz
//   fixtures/audio/short-tone.wav  1 s tone, for fade-clamping tests
//   fixtures/artwork/tone-art.svg  abstract square artwork
// These are NOT recordings of any song and must never be labelled as one.
// Run: node scripts/generate-fixtures.mjs [--check]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

function wav(seconds, { sampleRate = 22050, amplitude = 0.12 } = {}) {
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Short 10 ms edge ramps so the fixture itself has no clicks.
    const edge = Math.min(1, t / 0.01, (seconds - t) / 0.01);
    const s = amplitude * edge * (0.7 * Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 660 * t));
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">
  <title>music-pill test artwork (original, not album art)</title>
  <rect width="300" height="300" fill="#2b2d42"/>
  <circle cx="150" cy="150" r="96" fill="none" stroke="#8d99ae" stroke-width="10"/>
  <circle cx="150" cy="150" r="56" fill="none" stroke="#edf2f4" stroke-width="10"/>
  <circle cx="150" cy="150" r="16" fill="#ef233c"/>
</svg>
`;

const files = {
  'fixtures/audio/test-tone.wav': wav(6),
  'fixtures/audio/short-tone.wav': wav(1),
  'fixtures/artwork/tone-art.svg': Buffer.from(art),
};

let stale = false;
for (const [rel, buf] of Object.entries(files)) {
  const path = join(root, rel);
  if (check) {
    let existing = null;
    try { existing = readFileSync(path); } catch { /* missing */ }
    if (!existing || !existing.equals(buf)) { console.error(`stale fixture: ${rel}`); stale = true; }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
    console.log(`wrote ${rel} (${buf.length} bytes)`);
  }
}
if (stale) process.exit(1);
