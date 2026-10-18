// Playground logic. Plain JS against the built dist/ so it runs with the
// zero-dependency static server: `npm run playground`.
import { normalizeSpotifyTrackUrl } from '../dist/index.js';
import { escapeAttribute, resolveSpotifyMetadata } from '../dist/resolve.js';

const $ = (id) => document.getElementById(id);
const pill = $('pill');
const FIXTURE_TRACK = 'https://open.spotify.com/track/MusicPillTestFixture00';
const DEFAULTS = { position: 'bottom-right', size: 'md', theme: 'auto', autoplay: 'attempt', volume: '0.25', 'fade-duration': '1.5' };
let mode = 'track';

// ---- tabs ---------------------------------------------------------------
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => setMode(tab.id === 'tab-tone' ? 'tone' : 'track'));
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = tab.id === 'tab-track' ? $('tab-tone') : $('tab-track');
      next.focus();
      next.click();
    }
  });
}
function setMode(next) {
  mode = next;
  $('tab-track').setAttribute('aria-selected', String(mode === 'track'));
  $('tab-tone').setAttribute('aria-selected', String(mode === 'tone'));
  $('tab-track').tabIndex = mode === 'track' ? 0 : -1;
  $('tab-tone').tabIndex = mode === 'tone' ? 0 : -1;
  $('mode-track').hidden = mode !== 'track';
  $('mode-tone').hidden = mode !== 'tone';
  $('snippet-panel').hidden = mode !== 'track';
  apply();
}

// ---- colours ------------------------------------------------------------
const colourPairs = [
  ['c-bg', 'c-bg-t', '--music-pill-background'],
  ['c-fg', 'c-fg-t', '--music-pill-foreground'],
  ['c-sec', 'c-sec-t', '--music-pill-secondary'],
];
for (const [picker, text] of colourPairs) {
  $(picker).addEventListener('input', () => {
    $(text).value = $(picker).value;
    apply();
  });
  $(text).addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test($(text).value.trim())) $(picker).value = $(text).value.trim();
    apply();
  });
}
$('custom-colours').addEventListener('change', () => {
  $('colour-fields').hidden = !$('custom-colours').checked;
  apply();
});

function parseHex(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Returns validated colour overrides, or null (with a message) if invalid. */
function colourOverrides() {
  $('contrast-warn').textContent = '';
  $('contrast-ok').textContent = '';
  if (!$('custom-colours').checked) return {};
  const values = {};
  for (const [, text, prop] of colourPairs) {
    const v = $(text).value.trim();
    if (!parseHex(v) || !CSS.supports('color', v)) {
      $('contrast-warn').textContent = `"${v}" is not a 6-digit hex colour, so it is not applied.`;
      return {};
    }
    values[prop] = v;
  }
  const bg = parseHex(values['--music-pill-background']);
  const fg = contrast(parseHex(values['--music-pill-foreground']), bg);
  const sec = contrast(parseHex(values['--music-pill-secondary']), bg);
  const problems = [];
  if (fg < 4.5) problems.push(`title text ${fg.toFixed(2)}:1`);
  if (sec < 4.5) problems.push(`artist text ${sec.toFixed(2)}:1`);
  if (problems.length) {
    $('contrast-warn').textContent = `Low contrast: ${problems.join(', ')}. Text needs at least 4.5:1 against the background (WCAG 1.4.3). Pick colours that keep the pill readable.`;
  } else {
    $('contrast-ok').innerHTML = `<span class="ok">✓</span> Contrast OK: title ${fg.toFixed(2)}:1, artist ${sec.toFixed(2)}:1.`;
  }
  return values;
}

// ---- oEmbed ---------------------------------------------------------------
$('oembed').addEventListener('click', async () => {
  const status = $('oembed-status');
  status.textContent = 'Looking up…';
  try {
    const meta = await resolveSpotifyMetadata($('spotify-url').value);
    if (meta.status !== 'ok') {
      status.textContent = 'oEmbed unavailable (network, CORS or unknown track). Enter metadata yourself.';
      return;
    }
    if (meta.title) $('song-title').value = meta.title;
    if (meta.artworkUrl) $('artwork').value = meta.artworkUrl;
    status.textContent = 'Filled title and artwork. Check the artist yourself.';
    apply();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  }
});

// ---- apply + snippet ------------------------------------------------------
function attrsFromForm() {
  if (mode === 'tone') {
    return {
      'spotify-url': FIXTURE_TRACK,
      'song-title': 'Test tone (generated, 440 Hz)',
      artist: 'music-pill fixture: not a Spotify recording',
      artwork: '/fixtures/artwork/tone-art.svg',
      'audio-src': $('tone-file').value,
      'fade-duration': $('tone-fade').value,
      autoplay: 'off',
      position: $('position').value,
      size: $('size').value,
      theme: $('theme').value,
    };
  }
  return {
    'spotify-url': $('spotify-url').value.trim(),
    'song-title': $('song-title').value.trim(),
    artist: $('artist').value.trim(),
    artwork: $('artwork').value.trim(),
    'audio-src': $('audio-src').value.trim(),
    autoplay: $('autoplay').value,
    volume: $('volume').value,
    'fade-duration': $('fade-duration').value,
    position: $('position').value,
    size: $('size').value,
    theme: $('theme').value,
  };
}

function apply() {
  const attrs = attrsFromForm();
  for (const [name, value] of Object.entries(attrs)) {
    if (value === '') pill.removeAttribute(name);
    else pill.setAttribute(name, value);
  }
  const colours = colourOverrides();
  for (const [, , prop] of colourPairs) {
    if (colours[prop]) pill.style.setProperty(prop, colours[prop]);
    else pill.style.removeProperty(prop);
  }
  $('audio-warn').textContent = attrs['audio-src'] && mode === 'track'
    ? 'Only use audio you are licensed to play on a website, and make sure it is the same recording as the Spotify link and the title/artist above. A Spotify link grants no audio rights.'
    : '';
  if (mode === 'track') renderSnippet(attrs, colours);
}

function renderSnippet(attrs, colours) {
  const valid = normalizeSpotifyTrackUrl(attrs['spotify-url']);
  if (!valid) {
    $('snippet').textContent = 'Enter a valid https://open.spotify.com/track/… URL (or spotify:track:… URI).';
    $('copy').disabled = true;
    return;
  }
  $('copy').disabled = false;
  const hasAudio = Boolean(attrs['audio-src']);
  const lines = [`  spotify-url="${escapeAttribute(valid)}"`];
  for (const name of ['song-title', 'artist', 'artwork', 'audio-src']) {
    if (attrs[name]) lines.push(`  ${name}="${escapeAttribute(attrs[name])}"`);
  }
  for (const name of ['theme', 'size', 'position']) {
    if (attrs[name] !== DEFAULTS[name]) lines.push(`  ${name}="${escapeAttribute(attrs[name])}"`);
  }
  if (hasAudio) {
    for (const name of ['autoplay', 'volume', 'fade-duration']) {
      if (attrs[name] && attrs[name] !== DEFAULTS[name]) lines.push(`  ${name}="${escapeAttribute(attrs[name])}"`);
    }
  }
  let out = '<script type="module" src="/vendor/music-pill/auto.js"></script>\n';
  const props = Object.entries(colours);
  if (props.length) {
    out += `<style>\n  music-pill {\n${props.map(([k, v]) => `    ${k}: ${v};`).join('\n')}\n  }\n</style>\n`;
  }
  out += `<music-pill\n${lines.join('\n')}\n></music-pill>`;
  $('snippet').textContent = out;
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('snippet').textContent);
    $('copy-status').textContent = 'Copied.';
  } catch {
    $('copy-status').textContent = 'Copy failed; select the text and copy it manually.';
  }
});

for (const el of document.querySelectorAll('#mode-track input, #mode-track select, #mode-tone input, #mode-tone select, #position, #size, #theme')) {
  el.addEventListener('input', apply);
}

// ---- live state -----------------------------------------------------------
pill.addEventListener('music-pill-statechange', (e) => {
  $('state').textContent = `playbackState: ${e.detail.state} (reason: ${e.detail.reason})`;
});
for (const type of ['music-pill-ready', 'music-pill-autoplay-blocked', 'music-pill-error']) {
  pill.addEventListener(type, (e) => {
    $('last-event').textContent = `${type}: ${JSON.stringify(e.detail)}`;
    if (type === 'music-pill-ready') $('state').textContent = `playbackState: ${pill.playbackState}`;
  });
}

setMode('track');
