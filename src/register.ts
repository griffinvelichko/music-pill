// Browser registration. Safe to import anywhere: nothing runs until
// registerMusicPill() is called, and it is a no-op outside a browser.

import { createMusicPillClass, type SharedState } from './element.js';
import { AudioCoordinator, SoundPreference } from './session.js';
import type { MusicPillElementConstructor } from './types.js';

export const DEFAULT_TAG_NAME = 'music-pill';

let shared: SharedState | null = null;

function createContext(): AudioContext | null {
  const g = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'playback' });
  } catch {
    return new Ctor();
  }
}

/**
 * Defines the `<music-pill>` custom element (or `tagName`) and returns its
 * constructor. Calling it again, or after another copy of the library has
 * registered the same tag, returns the existing definition instead of throwing.
 *
 * Returns `undefined` when called outside a browser (SSR, Node, workers), so
 * it can be called unconditionally from isomorphic code.
 */
export function registerMusicPill(tagName: string = DEFAULT_TAG_NAME): MusicPillElementConstructor | undefined {
  const g = globalThis as typeof globalThis & { customElements?: CustomElementRegistry };
  if (typeof g.customElements === 'undefined' || typeof g.HTMLElement === 'undefined' || typeof g.document === 'undefined') {
    return undefined;
  }
  const existing = g.customElements.get(tagName);
  if (existing) return existing as unknown as MusicPillElementConstructor;

  shared ??= {
    prefs: new SoundPreference(() => {
      try {
        return g.sessionStorage ?? null;
      } catch {
        return null; // e.g. SecurityError in sandboxed iframes
      }
    }),
    coordinator: new AudioCoordinator(),
    createContext,
  };
  const ctor = createMusicPillClass(shared);
  g.customElements.define(tagName, ctor as unknown as CustomElementConstructor);
  return ctor;
}
