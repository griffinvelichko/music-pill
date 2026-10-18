// Opt-in React JSX typing. Types only; no runtime code and no React globals.
// Enable it once in your project, e.g. in a .d.ts file or your entry:
//   import type {} from 'music-pill/react-jsx';

import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { MusicPillAttributes, MusicPillElement, MusicPillEventMap } from './types.js';

/** React 19 attaches `on<event-name>` props on custom elements as listeners. */
export type MusicPillEventProps = {
  [K in keyof MusicPillEventMap as `on${K}`]?: (event: MusicPillEventMap[K]) => void;
};

export type MusicPillJSXProps = DetailedHTMLProps<HTMLAttributes<MusicPillElement>, MusicPillElement> &
  MusicPillAttributes &
  MusicPillEventProps;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'music-pill': MusicPillJSXProps;
    }
  }
}
