// Page-wide shared state: the visitor's session sound preference and the
// single-owner audio policy. Instances are created inside registerMusicPill(),
// never at module evaluation, so this file is SSR-safe to import.

const STORAGE_KEY = 'music-pill:sound-off';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Session-scoped "website sound off" preference. Only the *muted* choice is
 * remembered: a remembered "on" would add nothing, because remembering a
 * preference is never browser permission to autoplay. Storage failures
 * (private mode, sandboxed iframes, blocked cookies) fall back to memory.
 */
export class SoundPreference {
  #memory = false;
  /** False once storage has failed; memory is then authoritative. */
  #storageWorks = true;
  readonly #storage: () => StorageLike | null;

  constructor(storage: () => StorageLike | null) {
    this.#storage = storage;
    this.#memory = this.muted;
  }

  get muted(): boolean {
    if (!this.#storageWorks) return this.#memory;
    try {
      const storage = this.#storage();
      if (!storage) return this.#memory;
      return storage.getItem(STORAGE_KEY) === '1';
    } catch {
      this.#storageWorks = false;
      return this.#memory;
    }
  }

  setMuted(muted: boolean): void {
    this.#memory = muted;
    try {
      const storage = this.#storage();
      if (muted) storage?.setItem(STORAGE_KEY, '1');
      else storage?.removeItem(STORAGE_KEY);
    } catch {
      this.#storageWorks = false; // e.g. quota or SecurityError
    }
  }
}

export interface AudioOwner {
  /** Called when another instance takes over the page's audio. */
  preempt(): void;
}

/**
 * Ensures only one `<music-pill>` produces sound at a time.
 *
 * Policy (deterministic):
 * 1. Automatic startup: the first audio instance to connect claims the page's
 *    audio slot. Later instances do not autoplay while the slot is held.
 * 2. Explicit activation (sound button / enableSound()) always takes the slot;
 *    the previous owner is silenced.
 * 3. Removing the owner frees the slot but never starts another instance.
 */
export class AudioCoordinator {
  #owner: AudioOwner | null = null;

  get owner(): AudioOwner | null {
    return this.#owner;
  }

  /** Claims the slot for automatic startup; fails if another instance holds it. */
  claimForAutoplay(candidate: AudioOwner): boolean {
    if (this.#owner && this.#owner !== candidate) return false;
    this.#owner = candidate;
    return true;
  }

  /** Takes the slot for an explicit user action, silencing any previous owner. */
  claimForUser(candidate: AudioOwner): void {
    const previous = this.#owner;
    this.#owner = candidate;
    if (previous && previous !== candidate) previous.preempt();
  }

  release(candidate: AudioOwner): void {
    if (this.#owner === candidate) this.#owner = null;
  }
}
