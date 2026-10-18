// Browser-only entry: registers <music-pill> as a side effect.
//   <script type="module" src="/vendor/music-pill/auto.js"></script>
//   import 'music-pill/auto';
// Do not import this from server-rendered code paths; use the root entry and
// call registerMusicPill() in a client-only effect instead.

import { registerMusicPill } from './register.js';
import type { MusicPillElement } from './types.js';

registerMusicPill();

export * from './index.js';

declare global {
  interface HTMLElementTagNameMap {
    'music-pill': MusicPillElement;
  }
}
