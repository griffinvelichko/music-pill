// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('SSR import', () => {
  it('imports the root entry without browser globals', async () => {
    expect(typeof (globalThis as Record<string, unknown>).HTMLElement).toBe('undefined');
    const mod = await import('../../src/index');
    expect(typeof mod.registerMusicPill).toBe('function');
    expect(mod.registerMusicPill()).toBeUndefined();
  });
  it('imports the resolver without browser globals', async () => {
    const mod = await import('../../src/resolve');
    expect(typeof mod.resolveSpotifyMetadata).toBe('function');
  });
});
