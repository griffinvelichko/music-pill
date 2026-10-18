// Inline SVG markup. Static strings only; never interpolated with user data.

/**
 * Spotify icon path, as distributed by Simple Icons (CC0 for the SVG file).
 * The Spotify name and logo are trademarks of Spotify AB and are NOT covered by
 * this project's MIT licence. See THIRD_PARTY_NOTICES.md.
 */
export const SPOTIFY_ICON = `<svg class="mark" part="attribution" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;

/** Neutral artwork placeholder: a simple musical note. */
export const PLACEHOLDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 17.5a2.5 2.5 0 1 1-2.5-2.5c.53 0 1.02.17 1.42.45V5.2a1 1 0 0 1 .76-.97l9-2.2A1 1 0 0 1 19 3v11.5a2.5 2.5 0 1 1-2.5-2.5c.53 0 1.02.17 1.42.45V6.3l-7.92 1.93V17.5z"/></svg>`;

/** Speaker with sound waves: the action "mute" is available. */
export const SOUND_ON_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="on"><path class="solid" d="M4 9.2h3.2L11.6 5.4a.6.6 0 0 1 1 .45v12.3a.6.6 0 0 1-1 .45L7.2 14.8H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/></svg>`;

/** Speaker with a cross: sound is off; the action "enable" is available. */
export const SOUND_OFF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="off"><path class="solid" d="M4 9.2h3.2L11.6 5.4a.6.6 0 0 1 1 .45v12.3a.6.6 0 0 1-1 .45L7.2 14.8H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/></svg>`;

/** Speaker with pause bars: playback is paused, not muted by the visitor. */
export const SOUND_PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="pause"><path class="solid" d="M4 9.2h3.2L11.6 5.4a.6.6 0 0 1 1 .45v12.3a.6.6 0 0 1-1 .45L7.2 14.8H4a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1z"/><path d="M16 8.5v7"/><path d="M19.5 8.5v7"/></svg>`;

/** Error mark: website audio could not be loaded or played. */
export const SOUND_ERROR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="error"><circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>`;
