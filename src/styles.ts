// Shadow-DOM stylesheet. Scoped to the component; nothing here touches the host
// page. Public theming is via the --music-pill-* custom properties and ::part().

export const STYLES = /* css */ `
:host {
  display: contents;
}
:host([hidden]) {
  display: none;
}

.root {
  /* --- public custom properties (with defaults) ----------------------- */
  --_offset: var(--music-pill-offset, 16px);
  --_z: var(--music-pill-z-index, 1000);

  /* --- light theme defaults ---------------------------------------------- */
  --_bg: var(--music-pill-background, rgb(255 255 255 / 0.94));
  --_fg: var(--music-pill-foreground, #1d1d1f);
  --_secondary: var(--music-pill-secondary, #5f5f64);
  --_border: var(--music-pill-border, rgb(0 0 0 / 0.1));
  --_focus: var(--music-pill-focus-ring, #0066cc);
  --_danger: var(--music-pill-danger, #9f1239);
  --_hover: color-mix(in srgb, var(--_fg) 6%, transparent);
  --_placeholder-bg: color-mix(in srgb, var(--_fg) 8%, transparent);
  --_shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 6px 20px rgb(0 0 0 / 0.1);

  /* --- size md defaults -------------------------------------------------- */
  --_h: 56px;
  --_art: 40px;
  --_r: 16px;
  --_art-r: 8px;
  --_title-size: 14px;
  --_artist-size: 13px;
  --_sound-inset: 5px;

  position: fixed;
  z-index: var(--_z);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: var(--_h);
  /* For a fixed box, 100% is the viewport width excluding scrollbars. */
  max-width: min(
    400px,
    calc(100% - 2 * var(--_offset) - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))
  );
  border: 1px solid var(--_border);
  border-radius: var(--_r);
  background: var(--_bg);
  color: var(--_fg);
  box-shadow: var(--_shadow);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: var(--_title-size);
  line-height: 1.2;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  text-align: start;
}
.root[hidden] {
  display: none;
}

.root[data-theme="dark"] {
  --_bg: var(--music-pill-background, rgb(30 30 32 / 0.94));
  --_fg: var(--music-pill-foreground, #f5f5f7);
  --_secondary: var(--music-pill-secondary, #b0b0b6);
  --_border: var(--music-pill-border, rgb(255 255 255 / 0.12));
  --_focus: var(--music-pill-focus-ring, #5eb1ff);
  --_danger: var(--music-pill-danger, #ffb4ab);
  --_shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.35);
}
@media (prefers-color-scheme: dark) {
  .root[data-theme="auto"] {
    --_bg: var(--music-pill-background, rgb(30 30 32 / 0.94));
    --_fg: var(--music-pill-foreground, #f5f5f7);
    --_secondary: var(--music-pill-secondary, #b0b0b6);
    --_border: var(--music-pill-border, rgb(255 255 255 / 0.12));
    --_focus: var(--music-pill-focus-ring, #5eb1ff);
    --_danger: var(--music-pill-danger, #ffb4ab);
    --_shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.35);
  }
}

/* Sizes: heights 48/56/64, artwork 32/40/48, outer radius 12/16/18.
   Artwork radius nests inside the outer radius (outer minus padding). */
.root[data-size="sm"] {
  --_h: 48px; --_art: 32px; --_r: 12px; --_art-r: 4px;
  --_title-size: 13px; --_artist-size: 12px; --_sound-inset: 1px;
}
.root[data-size="lg"] {
  --_h: 64px; --_art: 48px; --_r: 18px; --_art-r: 10px;
  --_title-size: 15px; --_artist-size: 14px; --_sound-inset: 9px;
}
/* Spotify-provided artwork: Spotify's guidelines specify 4px corners on
   small/medium displays and 8px on large ones. */
.art[data-spotify] { --_art-r: 4px; }
.root[data-size="lg"] .art[data-spotify] { --_art-r: 8px; }

/* Positions: 16px (configurable) from the edges, plus device safe areas. */
.root[data-position^="top"] { top: calc(var(--_offset) + env(safe-area-inset-top, 0px)); }
.root[data-position^="bottom"] { bottom: calc(var(--_offset) + env(safe-area-inset-bottom, 0px)); }
.root[data-position$="left"] { left: calc(var(--_offset) + env(safe-area-inset-left, 0px)); }
.root[data-position$="right"] { right: calc(var(--_offset) + env(safe-area-inset-right, 0px)); }
.root[data-position$="center"] {
  left: env(safe-area-inset-left, 0px);
  right: env(safe-area-inset-right, 0px);
  width: max-content;
  margin-inline: auto;
}

/* --- link surface ---------------------------------------------------------- */
.pill {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
  align-self: stretch;
  box-sizing: border-box;
  padding: 7px 14px 7px 7px;
  border-radius: calc(var(--_r) - 1px);
  color: inherit;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 150ms ease;
}
.root[data-sound] .pill {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
  padding-inline-end: 10px;
}
.pill:hover {
  background: var(--_hover);
}

.art {
  position: relative;
  flex: none;
  width: var(--_art);
  height: var(--_art);
  border-radius: var(--_art-r);
  overflow: hidden;
  background: var(--_placeholder-bg);
  color: var(--_secondary);
}
.art img {
  display: block;
  width: 100%;
  height: 100%;
  /* Complete artwork: never cropped, blurred or overlaid. */
  object-fit: contain;
}
.art img[hidden], .art svg[hidden] {
  display: none;
}
.art svg {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 50%;
  height: 50%;
}

.text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}
.title, .artist {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.title {
  font-size: var(--_title-size);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.artist {
  font-size: var(--_artist-size);
  color: var(--_secondary);
}
.artist[hidden] {
  display: none;
}

/* Spotify icon (attribution). >= 21px per Spotify's minimum, monochrome so
   it is valid on any background colour; half-height clear space around it. */
.mark {
  flex: none;
  width: 21px;
  height: 21px;
  margin-inline-start: 2px;
  fill: currentColor;
}

/* --- sound control (sibling of the link, never inside it) ----------------- */
.sep {
  flex: none;
  width: 1px;
  height: calc(var(--_h) * 0.45);
  background: var(--_border);
}
.sound {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0 var(--_sound-inset) 0 calc(var(--_sound-inset) + 1px);
  padding: 0;
  border: 0;
  border-radius: calc(var(--_r) - var(--_sound-inset) - 1px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 150ms ease;
}
.sound:hover:not(:disabled) {
  background: var(--_hover);
}
.sound:disabled {
  cursor: default;
  opacity: 0.45;
}
.root[data-playback="error"] .sound:disabled {
  opacity: 1;
  color: var(--_danger);
}
.sound svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sound svg .solid {
  fill: currentColor;
  stroke: none;
}
/* Loading spinner. A static ring under prefers-reduced-motion (below). */
.spinner {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: 50%;
  animation: music-pill-spin 0.8s linear infinite;
}
@keyframes music-pill-spin {
  to { transform: rotate(360deg); }
}

/* Playback status. Sibling of the link, never inside it. */
.status {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 14rem;
  margin: 0;
  padding: 0 12px 0 2px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--_secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.root[data-playback="error"] .status {
  color: var(--_danger);
}

/* Author display values would otherwise override the hidden attribute. */
.sound[hidden], .sep[hidden], .status[hidden], .sound [hidden] {
  display: none;
}

.pill:focus-visible, .sound:focus-visible {
  outline: 2px solid var(--_focus);
  outline-offset: 2px;
}
.pill:focus:not(:focus-visible), .sound:focus:not(:focus-visible) {
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  .pill, .sound { transition: none; }
  /* The spinner stops. Audio fade ramps are not visual motion and still run. */
  .spinner {
    animation: none;
    border-inline-end-color: currentColor;
    opacity: 0.55;
  }
}

@media (forced-colors: active) {
  .root { border-color: CanvasText; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .sep { background: CanvasText; }
  .mark { fill: CanvasText; }
  .status, .root[data-playback="error"] .status, .root[data-playback="error"] .sound { color: CanvasText; }
  .pill:focus-visible, .sound:focus-visible { outline-color: Highlight; }
}
`;
