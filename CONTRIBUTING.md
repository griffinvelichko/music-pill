# Contributing

Thanks for helping. This is a deliberately small component, so please open an
issue to discuss new attributes or features before writing them.

## Setup

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
```

Development needs Node 22.12 or newer, because Vitest 5 requires it. The published package itself supports Node 20 or newer for SSR imports and the resolver. CI runs the full suite on Node 22 and 24, and checks the SSR import on Node 20.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-checks source, tests and configs |
| `npm test` | Vitest unit tests (happy-dom + fakes) |
| `npm run build` | Builds `dist/` (ESM + declarations) |
| `npm run test:ssr` | Imports the built SSR entries in plain Node with browser globals trapped |
| `npm run test:e2e` | Playwright: real audio in Chromium, Firefox and WebKit, plus layout screenshots |
| `npm run test:pack` | Packs the tarball and installs it into a throwaway consumer project |
| `npm run check` | Runs all of the above in order |
| `npm run playground` | Builds, serves and opens the playground |

`npm run test:e2e` needs a fresh `npm run build`, because the test pages load `dist/auto.js`.

## Ground rules

- **No runtime dependencies.** `dependencies` stays empty.
- **SSR-safe imports.** Nothing at module top level may touch `window`,
  `document`, `HTMLElement`, `customElements` or other browser globals.
  `npm run test:ssr` enforces this.
- **No commercial music, ever.** Tests use the generated tones in
  `fixtures/` (`npm run fixtures` regenerates them deterministically, and
  `node scripts/generate-fixtures.mjs --check` verifies them). Never label a
  test tone as a Spotify recording.
- **Never fake playback.** `playing` must mean audio is actually flowing. A
  suspended `AudioContext`, a mocked promise, or a muted element is not
  `playing`.
- **No Spotify scraping, audio extraction, preview URLs or SDK playback.**
  Use only documented oEmbed fields, and only in the optional resolver.
- Keep the main surface a plain link, and keep the sound button a sibling of
  that link, never nested inside it.
- Add or update tests with every behaviour change. Unit tests prove logic;
  browser tests prove playback.

## Releasing

Releases are manual; nothing is published from CI. See "Publishing" in the
README.
