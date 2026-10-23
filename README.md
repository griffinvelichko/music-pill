# music-pill

**Website and live demo:** https://griffinvelichko.github.io/music-pill/ · [Playground](https://griffinvelichko.github.io/music-pill/playground/) · [npm](https://www.npmjs.com/package/music-pill)

A small, framework-independent web component: a fixed "now playing" style pill
that **links to a song on Spotify**, with optional background audio that
**you host and are licensed to play**, which fades in, loops, and fades out.

![music-pill in the bottom-right corner of a page](docs/screenshots/desktop-bottom-right.png)

<img src="docs/screenshots/iphone-dark.png" alt="Dark theme on an iPhone-sized viewport" width="260"> <img src="docs/screenshots/iphone-320-long-text.png" alt="Long title and artist truncated at a 320px viewport" width="260">

- Native custom element, open Shadow DOM, vanilla TypeScript, **zero runtime dependencies**. The browser script `dist/auto.js` is about **13 kB gzipped**.
- One script plus one tag. Works in plain HTML and in any framework.
- No Spotify login, API key, backend or proxy is needed.
- Six positions, three sizes, auto/light/dark themes, CSS custom properties, and `::part()` hooks.

> **Two separate things.** `spotify-url` is where the pill *links to*. It
> is never fetched or played. Audio is an *optional, separate* file (or files)
> that you host. Linking to Spotify grants no audio or artwork rights.

> **You are responsible for the rights.** music-pill does not give you music,
> a licence, or artwork rights. You must have the rights to **every song you
> display** (the Spotify link, title, artist, and artwork) and to **every
> audio file you attach and play**. Audio always comes from a URL or file you
> host. The component never downloads, rips, proxies, or plays audio from
> Spotify.

> **Install:** `npm install music-pill`, or load it from a CDN with one
> `<script>` tag (see [Install](#install)).

## Contents

- [Quick start](#quick-start)
- [Link-only vs. licensed audio](#link-only-vs-licensed-audio)
- [Formats and several sources](#formats-and-several-sources)
- [Attributes](#attributes)
- [Metadata and the resolver](#metadata)
- [Autoplay outcomes](#autoplay-outcomes)
- [Sound control](#sound-control)
- [JavaScript API](#javascript-api)
- [Events and error codes](#events)
- [Audio behaviour](#audio-behaviour-details)
- [Hosting audio (CORS)](#hosting-audio-cors)
- [Content Security Policy](#content-security-policy)
- [Accessibility](#accessibility)
- [Styling](#styling)
- [SSR and imports](#ssr-and-imports)
- [Framework integration](#framework-integration)
- [Browser support](#browser-support)
- [Rights and licensing](#rights-and-licensing)
- [Examples and the playground](#examples-and-the-playground)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Publishing](#publishing-manual)

---

## Quick start

```sh
git clone https://github.com/griffinvelichko/music-pill.git
cd music-pill
npm ci
npm run build          # -> dist/auto.js (self-contained module)
npm run playground     # serves and opens http://127.0.0.1:4391/playground/
```

Copy `dist/auto.js` into your site (for example to `/vendor/music-pill/auto.js`), then:

```html
<script type="module" src="/vendor/music-pill/auto.js"></script>

<music-pill
  spotify-url="https://open.spotify.com/track/TRACK_ID"
  song-title="Song title"
  artist="Artist name"
  artwork="/images/album.jpg"
></music-pill>
```

`TRACK_ID` and the image path are placeholders; use your own values. The
smallest valid tag is:

```html
<music-pill spotify-url="https://open.spotify.com/track/TRACK_ID"></music-pill>
```

That renders a generic **"Listen on Spotify"** link with a neutral artwork
placeholder. A Spotify link alone cannot supply a title, artist, artwork or
audio: the component never calls Spotify at runtime, so anything you want shown
must be in the attributes. See [Metadata](#metadata) for an optional helper that
fills in the title and artwork for you.

Runnable pages are listed under [Examples and the playground](#examples-and-the-playground).

### Install

From npm:

```sh
npm install music-pill
```

```js
import 'music-pill/auto'; // registers <music-pill> (browser only)
```

Or with no build step, from a CDN. Pin the version:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/music-pill@0.1.0/dist/auto.js"></script>
```

Self-hosting `dist/auto.js` works too, and keeps third-party CDNs out of your
Content Security Policy.

---

## Link-only vs. licensed audio

| Setup | What the visitor gets |
| --- | --- |
| `spotify-url` (+ optional metadata) | A link pill. **No audio work at all**, no sound button, and nothing implies that music is playing. |
| `spotify-url` + `audio-src` (or several sources) | The same link pill, plus background audio that fades and loops, and a separate sound on/off button. |

```html
<music-pill
  spotify-url="https://open.spotify.com/track/TRACK_ID"
  song-title="Song title"
  artist="Artist name"
  artwork="/images/album.jpg"
  audio-src="/audio/licensed-song.mp3"
  theme="dark"
  size="md"
  position="bottom-right"
  autoplay="attempt"
></music-pill>
```

When you attach audio:

- It must be audio you're allowed to play publicly on a website: you own it, or you hold a licence that covers it. A Spotify link grants no such right, and **Spotify does not grant general website soundtrack rights**. The same duty applies to the title, artist, and artwork you display.
- It must be **the same recording** that the Spotify link and the title/artist describe. Never play unrelated audio under a Spotify song's label.
- Do not use ripped Spotify audio, Spotify preview URLs, or the Spotify Web Playback SDK as a background-audio source. None of these are supported, and they are not permitted for this purpose.

### Formats and several sources

Supported types are **MP3**, **M4A/AAC**, **OGG**, and **WAV**. Put MP3 first in the list you write. The component keeps that order, asks the browser which file it can play (`HTMLMediaElement.canPlayType`), and uses the first match. It does not transcode.

Give a MIME type when you know it, including codec parameters (`audio/mp4; codecs="mp4a.40.2"`). Those parameters are passed through to `canPlayType`. Otherwise the type is inferred:

| Extension or URL | Type |
| --- | --- |
| `.mp3`, `.mpeg`, `.mpga` | `audio/mpeg` |
| `.m4a`, `.mp4` | `audio/mp4` |
| `.aac` | `audio/aac` |
| `.ogg`, `.oga` | `audio/ogg` |
| `.wav`, `.wave` | `audio/wav` |
| `data:audio/…` | the type written in the data URL |

An extensionless URL or a `blob:` URL has no inferred type, so it is tried as-is. A known type is kept only when `canPlayType` returns `maybe` or `probably`. If every source has a type this browser refuses, nothing is fetched and the pill shows `no-playable-source`. See [Known limitations](#known-limitations) for what happens after a file is chosen.

`audio-src` on its own is unchanged. To offer more than one file, the component reads exactly one of these lists. Highest precedence first:

1. The `audioSources` property, once you assign an array (including `[]`). Assign `null` to follow the markup below again. Reading the property returns that list, or the markup list when you have not assigned one. It is the candidate list, not the single file the browser picked.
2. The `audio-sources` attribute, when it is not blank: a JSON array of URLs or `{ "src", "type"? }` objects. A non-blank value replaces `audio-src` and `<source>` children. A blank attribute is ignored. `[]` means no audio and no error.
3. `audio-src`, then direct `<source src type>` children, in that order.

At most **12** sources are used. Further entries are ignored. An `audio-sources` value longer than 20,000 characters is `invalid-audio-sources`.

```html
<!-- One file. The type is inferred from .mp3. -->
<music-pill
  spotify-url="https://open.spotify.com/track/TRACK_ID"
  song-title="Song title"
  artist="Artist name"
  audio-src="/audio/licensed-song.mp3"
></music-pill>

<!-- Several files. The first type this browser can play is used. -->
<music-pill spotify-url="https://open.spotify.com/track/TRACK_ID" song-title="Song title" artist="Artist name">
  <source src="/audio/licensed-song.mp3" type="audio/mpeg">
  <source src="/audio/licensed-song.m4a" type="audio/mp4">
  <source src="/audio/licensed-song.ogg" type="audio/ogg">
  <source src="/audio/licensed-song.wav" type="audio/wav">
</music-pill>
```

```html
<music-pill
  spotify-url="https://open.spotify.com/track/TRACK_ID"
  audio-sources='[{"src":"/audio/licensed-song.mp3","type":"audio/mpeg"},{"src":"/audio/licensed-song.ogg","type":"audio/ogg"}]'
></music-pill>
```

```js
pill.audioSources = [
  { src: '/audio/licensed-song.mp3', type: 'audio/mpeg' },
  { src: '/audio/licensed-song.ogg', type: 'audio/ogg' },
];
```

A runnable demo of one source, several sources, and the error state is in [`examples/sources/`](examples/sources/index.html). It uses the generated test tone only. The [playground](playground/index.html) has the same three cases under **Sources**.

---

## Attributes

| Attribute | Values | Default |
| --- | --- | --- |
| `spotify-url` | **Required.** `https://open.spotify.com/track/<22-char id>` (`?si=` and `/intl-xx/` are stripped), or a `spotify:track:<id>` URI, which is normalised. Anything else hides the pill and emits `music-pill-error`. | none |
| `song-title`, `artist` | Plain text. It is rendered as text, never as HTML. Control/bidi-override characters are stripped and it is capped at 200 characters. | none |
| `artwork` | Image URL (`http(s)`, relative, `blob:`, or `data:image/…`). A broken image falls back to a neutral placeholder. | placeholder |
| `audio-src` | One audio URL (`http(s)`, relative, `blob:`, or `data:audio/…`). If omitted, and there is no other source, no audio work happens and there is no sound button. | none |
| `audio-sources` | JSON array of URLs or `{"src","type"?}` objects. Replaces `audio-src` and `<source>` children. `[]` means no audio. | none |
| `position` | `top-left` `top-center` `top-right` `bottom-left` `bottom-center` `bottom-right` | `bottom-right` |
| `size` | `sm` (48 px) `md` (56 px) `lg` (64 px) | `md` |
| `theme` | `auto` `light` `dark` | `auto` |
| `autoplay` | `attempt` or `off`. This is an **enumerated string**, not an HTML boolean: a bare `autoplay` or `autoplay="false"` means the default, `attempt`. | `attempt` whenever a playable source is configured |
| `volume` | `0`–`1`. Values are clamped and junk is ignored. This is the gain the fade reaches. | `0.25` |
| `fade-duration` | Seconds, clamped to `0`–`10`, and further clamped at runtime so fade-in and fade-out never overlap within a short track. | `1.5` |
| `sound-control` | `built-in` or `host`. See [Sound control](#sound-control). | `built-in` |

Live changes: `position`, `size`, `theme`, `volume`, `fade-duration` and the
metadata attributes update the existing pill **without restarting audio**.
Changing `audio-src`, `audio-sources`, the `audioSources` property, a `<source>`
child, or `spotify-url` is a song change. It stops and releases the old audio,
cancels all of its pending work, and starts fresh. `autoplay` is read when a
song loads. At most 12 sources are considered.

---

## Metadata

**Explicit attributes are authoritative**, and they are the reliable,
zero-backend path. Write the title, artist and artwork yourself.

To fill them in faster, use the optional resolver **at build time or on your
machine**, not on every page view. It requests two URLs and nothing else:

- Spotify's documented [oEmbed endpoint](https://developer.spotify.com/documentation/embeds/tutorials/using-the-oembed-api) for `title` and `thumbnail_url` (plus dimensions).
- The public track page (`https://open.spotify.com/track/…`) for the artist, from the `music:musician_description` meta tag. If that tag is missing, the English document title is a fallback (`… by Artist | Spotify`, including the "Song, Lyrics, and Music Video" wording).

```sh
npm run build
node bin/music-pill-resolve.mjs "https://open.spotify.com/track/TRACK_ID"
node bin/music-pill-resolve.mjs "https://open.spotify.com/track/TRACK_ID" --artist "Artist name"
node bin/music-pill-resolve.mjs "https://open.spotify.com/track/TRACK_ID" --json
# after installing the package: npx music-pill-resolve <url> [--artist "Name"] [--json]
```

`--json` prints the metadata object, including `artist`. Without it, the command prints the tag. `--artist` replaces the resolved name, and an empty `--artist ""` clears it. `--help` prints usage. A failed oEmbed lookup still prints a tag and a note on stderr; a missing artist does the same and does not fail the command. An invalid track URL exits with status 1.

The default output is a ready-to-paste tag:

```html
<!-- artwork is Spotify-provided: keep the built-in Spotify attribution and link. -->
<music-pill
  spotify-url="https://open.spotify.com/track/TRACK_ID"
  song-title="Title from oEmbed"
  artist="Artist from the track page"
  artwork="https://image-cdn-….spotifycdn.com/image/…"
></music-pill>
```

What the resolver will and will not do:

- oEmbed has **no artist field**. `author_name` is ignored. The artist comes from the track page, not from parsing the oEmbed title.
- Several artists stay as Spotify writes them, usually one comma-separated string (`Justin Bieber, Daniel Caesar, GIVĒON`). Repeated `music:musician_description` tags are joined with `", "`. Names are not split on commas, so a band name that contains a comma stays intact. Spotify sometimes lists only the primary artist and omits featured artists; the resolver reports that string.
- The track-page markup is not a documented oEmbed field. Spotify can change it. The title fallback only matches the English patterns above (`Accept-Language: en` is sent). A value that looks like a URL is discarded.
- oEmbed sends `Access-Control-Allow-Origin: *`, so a browser can fill title and artwork. The track page does not, so **the artist lookup works in Node 20+ and comes back null in a browser**. That is a normal result, with a note, not a thrown error.
- No audio, preview, or embed URL is read or returned. The iframe `html` from oEmbed is ignored. Nothing discovered inside the HTML is requested. A non-HTML response is not parsed.
- A network error, HTTP error, CORS block, or unusable oEmbed body sets `status: "unavailable"` and null title and artwork. If the track page still answered, `artist` can be set. If only oEmbed answered, `artist` is null and title and artwork are filled.

It is also available programmatically. An invalid track URL throws `TypeError`. `fetch` and `signal` can be passed in the options object. `toMusicPillSnippet(meta, { artist })` uses your string, including `""`, instead of `meta.artist`.

```js
import { resolveSpotifyMetadata, toMusicPillSnippet } from 'music-pill/resolve';
const meta = await resolveSpotifyMetadata('spotify:track:TRACK_ID');
console.log(meta.artist);
console.log(toMusicPillSnippet(meta));
```

`examples/sample-track/` is produced by that resolver, not by typing the artist into the page. After a build:

```sh
npm run generate:sample-track
```

That rewrites `examples/sample-track/index.html` from `index.template.html` and writes `resolved.json` beside it. It is not part of `npm run check`, because it calls Spotify. If oEmbed fails, the script exits 1 and leaves the page alone. If the artist is empty, it still writes the page and warns.

A future authenticated Spotify Web API adapter (for richer metadata) is possible
but out of scope for v1. It would need credentials and a backend.

---

## Autoplay outcomes

Audible autoplay is **a best-effort attempt, never a guarantee**. Browsers
(Chrome, Safari/WebKit, Firefox, and especially iOS) commonly block sound for
new visitors until they interact with the site.

With `autoplay="attempt"`, the component makes **one** startup attempt:

| Outcome | `playbackState` | Event |
| --- | --- | --- |
| Browser allows it, the media plays and the Web Audio graph runs | `playing` (fades in) | `music-pill-statechange` |
| `play()` rejected (`NotAllowedError`) | `blocked` | `music-pill-autoplay-blocked` `{ reason: "play-rejected" }` |
| Media "plays" but the `AudioContext` stays suspended, so nothing would be heard | `blocked` | `music-pill-autoplay-blocked` `{ reason: "context-suspended" }` |
| Visitor muted earlier in this session | `muted` | none (no attempt is made) |
| Another pill on the page already holds the audio slot | `idle` | none |

When autoplay is blocked, the pill stays silent and shows **Sound off**. It does
not retry in a loop or pretend a gesture happened. The **next click or key
press** anywhere on the page starts sound once (`play()` and
`AudioContext.resume()` run inside that gesture). The listener is `click` and
`keydown` on the document. Scrolling does not count. Tab, Escape, CapsLock, and
a modifier key on its own do not count. A click on the built-in sound button is
left to that button, so it cannot start sound and mute it in the same click.
After that one attempt, further page clicks do not start sound again; the
sound button and `enableSound()` still do. `autoplay="off"` does not install
this listener. A remembered mute is not treated as permission to start.

If a suspended context later starts on its own (some browsers resolve a pending
`resume()` on the next click) while the pill is not meant to be playing, the
component re-suspends it, and the media is already paused.

**Activation timing.** `enableSound()` calls `HTMLMediaElement.play()` and
`AudioContext.resume()` *synchronously* inside the gesture, before awaiting
anything. Activation therefore still works when the audio has not loaded yet
(`preload="none"` with `autoplay="off"`, or a slow network): the state is
`starting` until media data arrives, and then `playing`. A browser test covers
this with a deliberately delayed response.

---

## Sound control

When a source was selected, or when every source was refused
(`no-playable-source`), the pill shows **one small separate button** next to
the link. A link-only pill, an empty source list, and an invalid URL or JSON
list hide the button.

- The button is a sibling of the link, never nested inside it. The link stays a normal link.
- It has a hit area of at least 44 × 44 px and a visible focus ring.
- Its name tells you what pressing it will do: **"Enable website sound"** or **"Mute website sound"**. When audio failed it is disabled, labelled **"Website sound unavailable"**.
- A separate status, next to the button and **not inside the Spotify link**, says **Loading audio**, **Playing**, **Muted**, **Paused**, **Sound off**, or the error. The link stays an "open in Spotify" action. Playing uses the speaker-with-waves icon, muted uses the crossed speaker, and paused uses a pause mark, so those states are not the same icon.
- While audio is fetching or waiting to start, the button shows a spinner and `aria-busy="true"`, and the status reads **Loading audio**.
- `aria-pressed` is `true` while the state is `playing` or `starting`, and `false` while it is `blocked`, `muted`, or `paused`. `idle`, `none`, and `error` omit it.
- `idle` and `none` hide the status text. `error` uses `role="alert"` and the other visible statuses use `role="status"`.

It exists because browsers usually require a gesture to start sound, and
because continuously playing audio needs an independent way to stop it
([WCAG 1.4.2 Audio Control](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html)).

**Muting** fades to zero within about 60 ms and then pauses. Mute holds across
loop restarts, beats every automatic behaviour, and is remembered for the
**browser session** (`sessionStorage` key `music-pill:sound-off`, with an in-memory fallback when storage
is blocked). A remembered preference is never treated as permission to
autoplay.

### Providing your own control (opt-in)

```html
<music-pill sound-control="host" spotify-url="…" audio-src="…"></music-pill>
<button type="button" id="sound">Enable website sound</button>
<script type="module">
  const pill = document.querySelector('music-pill');
  const button = document.getElementById('sound');
  button.addEventListener('click', () => {
    const on = pill.playbackState === 'playing' || pill.playbackState === 'starting';
    on ? pill.mute() : pill.enableSound(); // call inside the click handler
  });
  pill.addEventListener('music-pill-statechange', (e) => {
    const on = e.detail.state === 'playing' || e.detail.state === 'starting';
    button.textContent = on ? 'Mute website sound' : 'Enable website sound';
  });
</script>
```

`sound-control="host"` hides the built-in button. **You become responsible**
for a visible, keyboard-accessible control with an accurate name, available
whenever audio can play. Automatic continuous audio without an independent
control is not accessible, so do not use this option to remove the control
altogether.

---

## JavaScript API

```ts
const pill = document.querySelector('music-pill')!;

pill.playbackState;          // 'none' | 'idle' | 'starting' | 'playing' | 'blocked' | 'muted' | 'paused' | 'error' (read-only)
await pill.enableSound();    // true only when audio is confirmed audible; call from a user gesture
pill.mute();                 // prompt fade-out + pause, remembered for the session
pill.audioSources;           // candidate list in effect; assign an array to override markup, or null to follow it
```

`enableSound()` resolves `true` only after the media is playing and the Web Audio graph is running. It resolves `false` when the pill has no audio engine (link-only, empty list, invalid configuration, or `no-playable-source`), when the state is already `error`, or when the start does not become audible. It clears a remembered mute before it starts. Call it synchronously inside the gesture handler.

`mute()` stores the session preference even when the pill has no engine. When an engine exists, it fades to silence in about 60 ms and then pauses.

| State | Meaning |
| --- | --- |
| `none` | Link-only, an empty source list, or a rejected URL/JSON list. The sound button is hidden. An error event may already have fired. |
| `idle` | Audio is configured but not started (autoplay off, another pill holds the audio, or `play()` was aborted). No status text. |
| `starting` | A start attempt is in flight (fetch, decode, or `play()`). The status reads **Loading audio**. Not audible yet. |
| `playing` | The media is playing **and** the Web Audio graph is running. The status reads **Playing**. |
| `blocked` | The browser refused to start sound without a gesture. The status reads **Sound off**. The next click or key press starts it once. |
| `muted` | The visitor turned website sound off. The status reads **Muted**. |
| `paused` | The page was hidden, another pill took over, or playback was interrupted (including a stall where media time stops advancing for 6 s). The status reads **Paused**. |
| `error` | No source can play, or the chosen file could not be loaded, decoded, played, faded, or restarted. The status is an alert with the message. The link still works. |

### Events

All events are `CustomEvent`s that **bubble** and are **composed**:

| Event | `detail` |
| --- | --- |
| `music-pill-ready` | `{ spotifyUrl, hasAudio }`. The UI has rendered for a valid Spotify URL. `hasAudio` is true when a source was selected or every candidate type was refused. It is false for a link-only pill and for an invalid audio configuration. It says nothing about playback. An invalid `spotify-url` hides the pill and does not emit this event. |
| `music-pill-statechange` | `{ state, previousState, reason }`. `reason` values are listed below. |
| `music-pill-autoplay-blocked` | `{ reason: 'play-rejected' \| 'context-suspended' }` |
| `music-pill-error` | `{ code, message }`. The message is a fixed sentence for that code. It does not include raw browser error objects, URLs, or credentials. |

#### State-change reasons

| `reason` | When |
| --- | --- |
| `configured` | Audio is ready and `autoplay="off"`. State becomes `idle`. |
| `autoplay-attempt` | Autoplay called `play()`. State becomes `starting`. |
| `user-gesture` | `enableSound()` or the first-gesture listener called `play()`. State becomes `starting`. |
| `page-visible` | The page was shown again and playback is resuming. State becomes `starting`. |
| `started` | Media is playing and the graph is running. State becomes `playing`. |
| `autoplay-blocked` | The browser refused the start. State becomes `blocked`. |
| `session-muted` | A remembered mute skipped startup. State becomes `muted`. |
| `user-muted` | `mute()` ran. State becomes `muted`. |
| `page-hidden` | The page was hidden. State becomes `paused`. |
| `other-instance` | Another pill took the audio slot. State becomes `paused` if this one was audible, otherwise `idle`. |
| `another-instance-owns-audio` | Autoplay found the slot already taken. State becomes `idle`. |
| `interrupted` | Something else paused the media, or media time stopped advancing for 6 s. State becomes `paused`. |
| `source-changed` | A pill that had audio was switched to a link-only or invalid configuration. State becomes `none`. |
| `error` | Playback failed, or `play()` was aborted. State becomes `error`, or `idle` when the call was aborted. |

`StateChangeReason` also includes `restart`. A successful loop stays on `playing` and does not emit that reason. A failed loop emits `restart-failed` with reason `error`.

#### Error codes

| `code` | What triggers it | `playbackState` |
| --- | --- | --- |
| `invalid-spotify-url` | `spotify-url` is missing or not an `https://open.spotify.com/track/…` URL or `spotify:track:…` URI. The pill stays hidden. | hidden |
| `invalid-audio-src` | Every candidate URL was rejected (`http(s)`, `blob:`, or `data:audio/` only; no username or password), **or** a rejected URL was skipped because a later source could be used. | `none` and no button when every URL was rejected. Playback of the chosen file continues when one URL was only skipped. |
| `invalid-audio-sources` | `audio-sources` is not blank, and it is not a JSON array of URLs or `{ "src", "type"? }` objects. That includes invalid JSON, a non-array, an array with no usable `src`, and a value longer than 20,000 characters. A blank attribute is ignored. `[]` is an empty list, not this error. | `none`, button hidden |
| `no-playable-source` | At least one URL was valid, and every known type was refused by `canPlayType`. Nothing is fetched. | `error`, button disabled, alert |
| `audio-load-failed` | The chosen file could not be fetched: media error code 2 (network), code 1 (aborted), or `play()` failed for a reason other than `NotAllowedError`, `NotSupportedError`, or `AbortError`. | `error` |
| `audio-decode-failed` | The file arrived but the browser could not decode it (media error code 3). | `error` |
| `audio-unsupported` | The browser rejected the file at playback time (media error code 4, or `play()` threw `NotSupportedError`). | `error` |
| `fade-unavailable` | `AudioContext` or `MediaElementAudioSourceNode` could not be created, so the fade and loop path cannot run. | `error` |
| `restart-failed` | The track ended and `play()` could not start it again. | `error` |

A runtime failure is reported once for that file. `AbortError` from `play()` moves the pill to `idle` and does not emit `music-pill-error`.

### Multiple pills

Only one pill plays at a time, under a deterministic policy:

1. On load, the **first** audio pill to connect claims the page's audio slot. Later pills do not autoplay.
2. Pressing a pill's sound button (or calling `enableSound()` on it) takes the slot and silences the previous owner.
3. Removing the playing pill frees the slot but **never starts another pill**.

### Page visibility and lifecycle

- When the page is hidden (tab switch, `pagehide`), the pill fades out, pauses, and suspends its `AudioContext`. When the page is shown again, it resumes **only** if it was playing before, the visitor hasn't muted, it still owns the audio, and the browser allows it. That is one attempt, with no retry loop.
- Removing the element stops playback, releases the media and the `AudioContext`, removes every listener, and cancels all timers and ramps. Moving the element within the same task (as frameworks do when reordering) keeps audio running. Remounting never duplicates audio.

---

## Audio behaviour (details)

- One `<audio>` element, routed `MediaElementAudioSourceNode → GainNode → destination`. The gain sets the audible level; the element's volume property is not relied on, because iOS ignores programmatic `volume`.
- Fades are linear ramps scheduled on the `AudioContext` clock: from 0 up to `volume`, hold, then down to 0 shortly before the end. On `ended`, gain is held at 0, `play()` restarts from the beginning, and the fade-in is scheduled only after playback has actually resumed. This is a fade-out, restart and fade-in, **not** a crossfade. Expect a tiny silent gap at the loop point; gapless, sample-accurate looping is not promised.
- Cancelling a fade holds the current value (`cancelAndHoldAtTime`, or `value` re-anchoring in Firefox), so there are no jumps or clicks.
- Buffering (`waiting`) or seeking freezes the envelope so the fade-out cannot drift early, and `playing`/`seeked` re-plans it. `stalled` alone is ignored, because playback may continue from the buffer. A single re-armed watchdog catches silent stalls. Nothing polls, and timers do not accumulate.
- If Web Audio is unavailable, or the source cannot go through it, the component reports `fade-unavailable` or `audio-load-failed` and keeps the link UI. It never falls back to unfaded audio.

---

## Hosting audio: CORS

Same-origin audio needs no configuration. For audio on **another origin** (a
CDN, object storage), the component sets `crossOrigin = "anonymous"` *before*
`src`, and the audio server **must** respond with CORS headers:

```http
Access-Control-Allow-Origin: https://your-site.example     (or *)
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges
Accept-Ranges: bytes
```

It must also answer `Range` requests with `206 Partial Content`; Safari
requires this for media.

Why it matters: Web Audio outputs **silence** for cross-origin media fetched
without CORS (the [spec's security rule](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceNode-security)).
Because the component always requests CORS, a misconfigured server usually
surfaces as a load failure (`audio-load-failed`). But **you cannot always
detect it from a media error**: redirects to another origin, service workers
returning opaque responses, or caches serving stale headers can still produce
"playing" with no sound.

**Troubleshooting recipe**

1. `curl -sI -H "Origin: https://your-site.example" https://cdn.example/song.mp3` should show `access-control-allow-origin`.
2. `curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-1" -H "Origin: https://your-site.example" https://cdn.example/song.mp3` should print `206`.
3. Make sure no redirect sends the request to a different host without the same headers: `curl -sIL …`.
4. In DevTools → Network, the audio request should be `cors` mode and its response should carry the header.
5. If you use a CDN, purge cached responses that were stored before you added the headers. Add `Vary: Origin` if you echo specific origins.
6. Still silent? Host the file on the same origin as the page.

The repository's browser tests serve the same fixture from a second origin,
with and without these headers, to verify both paths.

---

## Content Security Policy

The component needs no `unsafe-inline` and no `unsafe-eval`. Its styles use
constructable stylesheets, with a `<style>` fallback only in old engines. A
strict policy only needs to allow your own resources:

```
script-src 'self';                     # where you host auto.js
img-src    'self' <artwork hosts>;     # e.g. https://image-cdn-ak.spotifycdn.com https://i.scdn.co for oEmbed artwork
media-src  'self' <audio host>;        # where audio-src lives
connect-src https://open.spotify.com;  # only if you call the resolver from the browser
```

This is covered by a browser test that runs under
`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'`.
Sites that **enforce Trusted Types** need to allow the component's static
template (it uses `innerHTML` once, with a constant string).

---

## Accessibility

- The main surface is a real `<a href>` that opens Spotify in a new tab (`rel="noopener noreferrer"`). Its accessible name starts with the visible title and adds the artist, the destination and the new-tab note. For example: "Song by Artist, listen on Spotify (opens in a new tab)".
- Artwork has empty `alt`, because the adjacent text carries the same information. The Spotify icon is `aria-hidden`.
- Long titles and artists truncate visually with an ellipsis. The full text stays in the accessible name and in a hover tooltip.
- Tab order: link, then sound button. There is a visible `:focus-visible` ring, and forced-colours (Windows High Contrast) styling.
- Under `prefers-reduced-motion: reduce`, transitions on the pill and the sound button are removed, and the loading spinner does not spin (it stays a static ring). **Audio fades still run**, because they are the loudness envelope, not UI motion. Set `fade-duration="0"` if you want the level change to be instant as well.
- The pill grows rather than clips when text is enlarged or zoomed, and stays within a 320 px viewport.

---

## Styling

```css
music-pill {
  --music-pill-background: #1e3a5f;
  --music-pill-foreground: #ffffff;
  --music-pill-secondary: #cfe0f5;   /* artist line */
  --music-pill-border: rgb(255 255 255 / 0.15);
  --music-pill-offset: 24px;         /* distance from the viewport edges (safe areas are added) */
  --music-pill-z-index: 2000;        /* default 1000 */
  --music-pill-focus-ring: #ffd60a;
}
music-pill::part(title) { letter-spacing: 0; }
```

Stable parts: `container`, `pill` (the link), `artwork`, `title`, `artist`,
`attribution` (the Spotify icon), `sound-button`, `status`.

`--music-pill-danger` colours the error status (default `#9f1239`, or `#ffb4ab` in the dark theme).

**Contrast is your responsibility** when you override colours. Text needs at
least 4.5:1 against the background. The [playground](playground/index.html)
validates colours and warns about low contrast before generating a snippet.
There is deliberately no free-form `style` attribute API.

**Placement.** The pill uses `position: fixed` with a 16 px offset plus the
device safe-area insets (`env(safe-area-inset-*)`). Use
`viewport-fit=cover` in your viewport meta to get those insets on notched
phones. Center positions are centred in the viewport. Place the element near
the end of `<body>`. If an ancestor has `transform`, `filter`, `perspective`,
`contain: paint/layout` or `will-change: transform`, that ancestor becomes the
containing block, and the pill is positioned relative to it instead of the
viewport. Raise `--music-pill-z-index` or change `--music-pill-offset` to avoid
your navigation bars, cookie banners and chat widgets. The component never
modifies global page styles.

### Design and Spotify branding

The look is a restrained, Apple-inspired rounded rectangle: system font,
subtle border and shadow, generous small-scale spacing. These are this
project's own design choices, not Apple specifications.

| Size | Height | Artwork | Outer radius | Artwork radius |
| --- | --- | --- | --- | --- |
| `sm` | 48 | 32 | 12 | 4 (nested) |
| `md` | 56 | 40 | 16 | 8 (nested) |
| `lg` | 64 | 48 | 18 | 10 (nested) |

The pill follows these rules from Spotify's
[design guidelines](https://developer.spotify.com/documentation/design):

- Artwork hosted on Spotify's CDN (`*.scdn.co`, `*.spotifycdn.com`) uses Spotify's artwork corner radius, which is 4 px, or 8 px at `lg`, instead of the nested radius.
- Artwork is always shown complete (`object-fit: contain`), never cropped, blurred, overlaid or distorted.
- Every pill links back to Spotify.
- Attribution is the Spotify icon at its 21 px minimum, in a single colour matching the text so it is valid on any background, with clear space around it.
- Spotify prefers the full logo where there is room. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and review the guidelines yourself before you ship.

---

## SSR and imports

| Import | Safe on the server? | Effect |
| --- | --- | --- |
| `music-pill` | Yes | Exports `registerMusicPill()`, types, and URL/attribute helpers. Importing it evaluates no `window`, `document`, `HTMLElement` or `customElements`. `registerMusicPill()` is a no-op outside a browser and returns `undefined`. |
| `music-pill/resolve` | Yes | Metadata helper: oEmbed title and artwork, and the artist from the public track page (Node). |
| `music-pill/auto` | Browser only (it no-ops in Node) | Registers `<music-pill>` as a side effect, and re-exports the root API. Use it from `<script type="module">` or client-only code. |
| `music-pill/react-jsx` | Types only | Opt-in JSX typing for React. |

`registerMusicPill(tagName?)` guards duplicate definitions. If the tag is
already defined, for example by a second copy of the bundle, it returns the
existing constructor instead of throwing. The element class is only created
inside that call.

Server-rendered HTML can include `<music-pill …>` directly. It upgrades when
the script runs, and nothing is shown before then, because the content lives
in Shadow DOM. Declarative Shadow DOM is not used.

---

## Framework integration

Every framework uses the same element; there are no wrapper packages. Some
need a one-line compiler or schema setting so that they treat `<music-pill>` as a
custom element. Pass attributes as **strings**. Event names contain dashes.

### Plain HTML

```html
<script type="module" src="/vendor/music-pill/auto.js"></script>
<music-pill spotify-url="https://open.spotify.com/track/TRACK_ID" song-title="Song" artist="Artist"></music-pill>
```

### React 19

```tsx
// Once, anywhere in your types (opt-in JSX typing; adds no React runtime):
import type {} from 'music-pill/react-jsx';

import { useEffect } from 'react';

export function SongPill() {
  useEffect(() => {
    void import('music-pill/auto'); // browser-only registration
  }, []);
  return (
    <music-pill
      spotify-url="https://open.spotify.com/track/TRACK_ID"
      song-title="Song"
      artist="Artist"
      position="bottom-left"
      onmusic-pill-statechange={(e) => console.log(e.detail.state)}
    />
  );
}
```

React 19 passes string attributes and attaches `on<event-name>` listeners on custom
elements. Pass `audioSources` as a property (an array, or `null`); it is on the
JSX type from `music-pill/react-jsx` and is not an HTML attribute. On React 18, use a `ref` with `addEventListener` for events.

### Next.js (App Router)

```tsx
// app/song-pill.tsx
'use client';
import type {} from 'music-pill/react-jsx';
import { useEffect } from 'react';

export default function SongPill() {
  useEffect(() => {
    void import('music-pill/auto');
  }, []);
  return <music-pill spotify-url="https://open.spotify.com/track/TRACK_ID" song-title="Song" artist="Artist" />;
}
```

Render `<SongPill />` from a layout or page. Server Components can import the
SSR-safe root (`music-pill`) for types or URL validation, but registration
must happen in a client component.

### Vue 3 (Vite)

```js
// vite.config.js — tell the template compiler this tag is a custom element
import vue from '@vitejs/plugin-vue';
export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'music-pill' } } })],
};
```

```vue
<script setup>
import 'music-pill/auto';
const onState = (e) => console.log(e.detail.state);
</script>
<template>
  <music-pill spotify-url="https://open.spotify.com/track/TRACK_ID" song-title="Song" artist="Artist"
              @music-pill-statechange="onState" />
</template>
```

With Nuxt, set the same `isCustomElement` under `vue.compilerOptions` and import `auto` from a `.client` plugin.

### Svelte 5

```svelte
<script>
  import { onMount } from 'svelte';
  let pill;
  onMount(async () => {
    await import('music-pill/auto');
    const onState = (e) => console.log(e.detail.state);
    pill.addEventListener('music-pill-statechange', onState);
    return () => pill.removeEventListener('music-pill-statechange', onState);
  });
</script>

<music-pill bind:this={pill} spotify-url="https://open.spotify.com/track/TRACK_ID" song-title="Song" artist="Artist"></music-pill>
```

Svelte renders unknown dashed tags as custom elements with no configuration.
Importing inside `onMount` keeps SvelteKit SSR clean.

### Astro

```astro
---
// src/components/SongPill.astro
---
<music-pill spotify-url="https://open.spotify.com/track/TRACK_ID" song-title="Song" artist="Artist"></music-pill>
<script>
  import 'music-pill/auto'; // Astro bundles and runs this in the browser only
</script>
```

### Angular (standalone component)

```ts
// main.ts
import 'music-pill/auto';
```

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-song-pill',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // allow <music-pill> and its dashed attributes
  template: `
    <music-pill
      spotify-url="https://open.spotify.com/track/TRACK_ID"
      [attr.song-title]="title"
      artist="Artist"
      (music-pill-statechange)="onState($any($event).detail.state)"
    ></music-pill>`,
})
export class SongPillComponent {
  title = 'Song';
  onState(state: string) { console.log(state); }
}
```

Use `[attr.name]` bindings for dynamic values. With NgModules, add
`CUSTOM_ELEMENTS_SCHEMA` to the module's `schemas` instead. For Angular SSR,
import `auto` only in the browser (`main.ts` or `afterNextRender`).

---

## Browser support

Targets current Chrome, Edge, Firefox, Safari, iOS Safari and Android
Chrome. The component uses Custom Elements v1, Shadow DOM, Web Audio,
`color-mix()` and constructable stylesheets (with a fallback).

**Tested here (automated, Playwright 1.63.0 on macOS 15.6):**

| Engine | Version | Result |
| --- | --- | --- |
| Chromium | 153.0.8010.12 | All audio, lifecycle, CORS and CSP tests pass. First visits are blocked by policy (`--autoplay-policy=user-gesture-required`). |
| Firefox | 155.0 | All tests pass. First visits are blocked by policy (`media.autoplay.default=1`). |
| WebKit (Playwright build) | 26.6 | All tests pass. Its headless media clock sometimes freezes on very short looping files; the engine then reports `paused` instead of a false `playing`, and the test accepts either honest outcome. |
| Layout and screenshots | Desktop Chrome, iPhone 13 (WebKit), Pixel 7 (Chromium) | All positions, sizes, themes, 320 px and large-text checks pass. Each run writes 45 screenshots to `test-results/screenshots/` (also uploaded as a CI artifact); a curated set is in [`docs/screenshots/`](docs/screenshots). |

**Not tested yet:** real iPhone Safari, real Android Chrome, Edge and
desktop Safari. Playwright's WebKit is not a substitute for iOS Safari, which
has its own autoplay, audio-session and background rules.

### Manual device checklist (iOS / Android)

1. `npm run build && node scripts/serve.mjs --port 4391`, then expose it over HTTPS on your LAN (for example `npx localtunnel --port 4391`, or your own tunnel) and open `/playground/` on the device.
2. **Tone mode:** on first load, confirm that nothing plays, the button reads "Enable website sound", and the status reads "Sound off". Tap anywhere on the page, or tap the button: you should hear a fade-in within about 2 s, the button should read "Mute website sound", and the status should read "Playing".
3. Wait for at least two loops of the 1 s fixture. You should hear fade-out, a brief gap, and fade-in, without clicks.
4. Tap mute: silence within about 0.1 s. Reload: it stays muted.
5. With sound on, lock the screen or switch apps: audio stops. Return: it resumes or reports blocked, and never plays while hidden.
6. Toggle the iOS silent switch and use the hardware volume keys to understand how the platform behaves.
7. Rotate the device, and check notch/home-indicator clearance in all six positions with `viewport-fit=cover`.
8. Use VoiceOver or TalkBack: the link name reads title, artist, Spotify and new tab, and the button name matches its action.

---

## Rights and licensing

- The **component code** is MIT-licensed ([LICENSE](LICENSE)).
- **Music, recordings, album artwork and Spotify marks are not** covered by that licence. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- No commercial music is included in this repository. The tests use generated tones (`npm run fixtures`), labelled as tones everywhere. The playground's tone mode links to a non-existent placeholder track and never presents the tone as a Spotify recording.
- Use only audio you're licensed to play on a website. Follow Spotify's [Developer Policy](https://developer.spotify.com/policy), [Design guidelines](https://developer.spotify.com/documentation/design) and [embed terms](https://developer.spotify.com/documentation/embeds/terms) for links, artwork and attribution.

---

## Examples and the playground

Build first, then serve the repo. `npm run serve` listens on `http://127.0.0.1:4391`.

| Page | Open | What you see |
| --- | --- | --- |
| [`examples/plain-html/`](examples/plain-html/index.html) | `/examples/plain-html/` | A link-only pill. No sound button. |
| [`examples/strobe/`](examples/strobe/index.html) | `/examples/strobe/` | A link-only pill with a title, artist, and artwork. No audio file is attached. |
| [`examples/sample-track/`](examples/sample-track/index.html) | `/examples/sample-track/` | One real Spotify track. Title, artist, and artwork are the committed output of `npm run generate:sample-track`. Sound is the generated test tone, with autoplay off. |
| [`examples/sources/`](examples/sources/index.html) | `/examples/sources/` | One `audio-src`, several `<source>` children, and an unplayable type. Autoplay is off. |
| [`playground/`](playground/index.html) | `/playground/` | A live editor. `npm run playground` builds, serves, and opens this page. The **Sources** tab shows the same three cases as `examples/sources/`. |

`examples/sources/`, `examples/sample-track/`, and the playground tone and Sources modes play `fixtures/audio/test-tone.wav`, generated by `npm run fixtures`. That file is a tone, not a recording. On `examples/sources/` and in the playground the Spotify URL is a placeholder track id. `examples/sample-track/` links to a real track; its `audio-src` is still the generated tone, and a deployment should replace that with a file the site owner has the rights to play.

## Known limitations

- Source choice happens once, before fetch. The first candidate whose type is missing or whose type `canPlayType` accepts is the file that loads. A later decode, network, or unsupported-media failure stops on that file and emits `audio-decode-failed`, `audio-load-failed`, or `audio-unsupported`. The next file is not tried.
- If `canPlayType` returns an empty string for `audio/mpeg`, `audio/wav`, `audio/mp4`, `audio/ogg`, and `audio/aac`, the detector is treated as unreliable and the first valid URL is used.
- An extensionless URL or a `blob:` URL is tried even when the browser might not be able to decode it.
- Only the first 12 sources are considered. An `audio-sources` string longer than 20,000 characters is rejected as a whole.
- `StateChangeReason` includes `restart`, and a successful loop does not emit it.
- Audible autoplay depends on the browser. `autoplay="attempt"` is one try. The document listener that follows a block is also one try per song.
- The artist lookup reads undocumented track-page markup and only works where that page can be fetched (Node 20+). In a browser it stays null because of CORS. Spotify may list only the primary artist.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short:

```sh
npm ci && npx playwright install chromium firefox webkit
npm run check   # typecheck, unit tests, build, SSR import, packed-tarball consumer, browser tests
```

## Publishing (manual)

CI never publishes. To release:

1. Update `version` in `package.json`, `CHANGELOG.md`, and the pinned CDN URL in this README.
2. `npm login` (an account with 2FA and publish rights to `music-pill`).
3. `npm ci && npm run check`. Everything must pass.
4. `npm pack --dry-run` to review the file list (only `dist/`, `bin/` and the docs).
5. `npm publish` (`prepublishOnly` rebuilds `dist/` and re-runs the SSR check first). Enter your 2FA code when asked.
6. Tag and release: `git tag v<version> && git push --tags`, then create a GitHub release from the changelog entry.
