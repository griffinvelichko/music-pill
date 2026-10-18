// Audio source parsing and selection. Pure: no DOM and no browser globals.
// The element injects canPlayType so this module stays safe to import during SSR.

import { resolveResourceUrl, type ResolvedResource } from './parse.js';
import type { MusicPillAudioSource } from './types.js';

/** Extensions the component treats as a known audio type. */
export const AUDIO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  wave: 'audio/wav',
};

export const MAX_AUDIO_SOURCES = 12;
const MAX_AUDIO_SOURCES_ATTRIBUTE_LENGTH = 20_000;

/** Common types used to tell a real canPlayType from a stub that returns "". */
const RELIABILITY_PROBES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/aac'] as const;

const AUDIO_TYPE = /^(audio\/[a-z0-9][a-z0-9.+-]*)(\s*;[\s\S]*)?$/i;

export const NO_PLAYABLE_SOURCE_MESSAGE =
  'None of the audio sources can be played in this browser. Use MP3, M4A/AAC, OGG, or WAV.';

export const INVALID_AUDIO_SRC_MESSAGE =
  'audio-src must be an http(s), blob: or data:audio/ URL.';

export const INVALID_AUDIO_SOURCES_MESSAGE =
  'audio-sources must be a JSON array of audio URLs or {"src","type"} objects.';

export const DROPPED_AUDIO_SOURCE_MESSAGE =
  'An audio source was ignored because it is not an http(s), blob: or data:audio/ URL.';

export type CanPlayType = (mime: string) => string;

export type ResolvedPlayableSource = ResolvedResource & {
  /** MIME type used for selection, or null when the type could not be determined. */
  type: string | null;
};

export type AudioSourceSelection =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'none-playable'; droppedInvalid: number }
  | { status: 'selected'; source: ResolvedPlayableSource; droppedInvalid: number };

export type ParsedAudioSources =
  | { ok: true; sources: MusicPillAudioSource[] }
  | { ok: false; reason: 'absent' | 'invalid' };

/**
 * Normalises an author-supplied MIME type. Returns null unless it is an
 * `audio/*` type. Parameters such as `codecs` are preserved for canPlayType.
 */
export function normalizeAudioType(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = AUDIO_TYPE.exec(value.trim());
  if (!match?.[1]) return null;
  const params = (match[2] ?? '').trim().replace(/^;\s*/, '; ');
  return match[1].toLowerCase() + params;
}

/**
 * Infers a MIME type from a file extension or a `data:audio/…` URL.
 * Returns null for extensionless, blob:, and unknown extensions.
 */
export function inferAudioMime(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;
  if (/^data:/i.test(raw)) {
    const mime = /^data:(audio\/[a-z0-9.+-]+)/i.exec(raw.replace(/\s/g, ''));
    return mime?.[1]?.toLowerCase() ?? null;
  }
  let path = raw;
  try {
    path = new URL(raw, 'https://example.invalid').pathname;
  } catch {
    path = raw.split(/[?#]/)[0] ?? raw;
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (!ext) return null;
  return AUDIO_MIME_BY_EXTENSION[ext] ?? null;
}

/** Explicit audio MIME type, otherwise the type inferred from the URL. */
export function resolveAudioType(src: string, explicit?: string | null): string | null {
  return normalizeAudioType(explicit) ?? inferAudioMime(src);
}

function readSourceItem(item: unknown): MusicPillAudioSource | null {
  if (typeof item === 'string') {
    const src = item.trim();
    return src ? { src } : null;
  }
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.src !== 'string') return null;
  const src = rec.src.trim();
  if (!src) return null;
  if (typeof rec.type === 'string' && rec.type.trim()) return { src, type: rec.type.trim() };
  return { src };
}

/**
 * Parses the `audio-sources` attribute. A blank value is absent. `[]` is an
 * explicit empty list. Any other non-array, over-long, or all-invalid value
 * is invalid.
 */
export function parseAudioSourcesAttribute(value: string | null | undefined): ParsedAudioSources {
  if (value == null) return { ok: false, reason: 'absent' };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: false, reason: 'absent' };
  if (trimmed.length > MAX_AUDIO_SOURCES_ATTRIBUTE_LENGTH) return { ok: false, reason: 'invalid' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'invalid' };
  if (parsed.length === 0) return { ok: true, sources: [] };
  const sources: MusicPillAudioSource[] = [];
  for (const item of parsed) {
    const source = readSourceItem(item);
    if (source) sources.push(source);
    if (sources.length >= MAX_AUDIO_SOURCES) break;
  }
  if (sources.length === 0) return { ok: false, reason: 'invalid' };
  return { ok: true, sources };
}

/** True when canPlayType recognises at least one common audio type. */
export function canPlayTypeIsReliable(canPlayType: CanPlayType): boolean {
  try {
    return RELIABILITY_PROBES.some((type) => {
      const result = canPlayType(type);
      return typeof result === 'string' && result.trim() !== '';
    });
  } catch {
    return false;
  }
}

function typeCanPlay(canPlayType: CanPlayType, mime: string): boolean {
  try {
    const result = canPlayType(mime);
    return typeof result === 'string' && result.trim() !== '';
  } catch {
    return false;
  }
}

/**
 * Picks the first source the browser can play.
 *
 * A known type (explicit, else inferred from the extension or data: URL) is
 * kept only when canPlayType returns a non-empty result (`maybe` or
 * `probably`). A source whose type cannot be determined is still tried, so
 * extensionless and blob: URLs keep working. When canPlayType recognises no
 * common audio type, the first valid URL is used.
 */
export function selectAudioSource(
  candidates: readonly MusicPillAudioSource[],
  baseUrl: string,
  canPlayType: CanPlayType,
): AudioSourceSelection {
  const limited = candidates.slice(0, MAX_AUDIO_SOURCES).filter((candidate) => candidate.src.trim() !== '');
  if (limited.length === 0) return { status: 'empty' };

  const reliable = canPlayTypeIsReliable(canPlayType);
  let droppedInvalid = 0;
  let sawUnplayable = false;

  for (const candidate of limited) {
    const resolved = resolveResourceUrl(candidate.src, baseUrl, 'audio/');
    if (!resolved) {
      droppedInvalid++;
      continue;
    }
    const type = resolveAudioType(resolved.href, candidate.type);
    if (type && reliable && !typeCanPlay(canPlayType, type)) {
      sawUnplayable = true;
      continue;
    }
    return { status: 'selected', source: { ...resolved, type }, droppedInvalid };
  }

  if (sawUnplayable) return { status: 'none-playable', droppedInvalid };
  return { status: 'invalid' };
}
