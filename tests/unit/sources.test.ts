import { describe, expect, it } from 'vitest';
import {
  AUDIO_MIME_BY_EXTENSION,
  DROPPED_AUDIO_SOURCE_MESSAGE,
  INVALID_AUDIO_SOURCES_MESSAGE,
  NO_PLAYABLE_SOURCE_MESSAGE,
  inferAudioMime,
  normalizeAudioType,
  parseAudioSourcesAttribute,
  selectAudioSource,
} from '../../src/sources';

const BASE = 'https://site.example/player/';

const accept = (...prefixes: string[]) => (mime: string) =>
  prefixes.some((prefix) => mime.toLowerCase().startsWith(prefix)) ? 'probably' : '';

describe('audio MIME detection', () => {
  it.each([
    ['/song.mp3', 'audio/mpeg'],
    ['/song.MP3?cache=1', 'audio/mpeg'],
    ['song.mpeg', 'audio/mpeg'],
    ['/a/track.m4a', 'audio/mp4'],
    ['/a/track.mp4#t', 'audio/mp4'],
    ['voice.aac', 'audio/aac'],
    ['https://cdn.example/a.ogg', 'audio/ogg'],
    ['/a.oga', 'audio/ogg'],
    ['/tone.wav', 'audio/wav'],
    ['/tone.wave', 'audio/wav'],
    ['data:audio/mpeg;base64,QQ==', 'audio/mpeg'],
    ['data:audio/wav;base64,QQ==', 'audio/wav'],
  ])('infers %s as %s', (input, mime) => {
    expect(inferAudioMime(input)).toBe(mime);
  });

  it('returns null when the type cannot be inferred', () => {
    expect(inferAudioMime('/files/abc')).toBeNull();
    expect(inferAudioMime('blob:https://site.example/11111111-1111-1111-1111-111111111111')).toBeNull();
    expect(inferAudioMime('/song.flac')).toBeNull();
    expect(inferAudioMime('data:image/png;base64,QQ==')).toBeNull();
    expect(inferAudioMime('')).toBeNull();
  });

  it('keeps codec parameters and rejects non-audio types', () => {
    expect(normalizeAudioType(' Audio/MP4 ; codecs="mp4a.40.2" ')).toBe('audio/mp4; codecs="mp4a.40.2"');
    expect(normalizeAudioType('video/mp4')).toBeNull();
    expect(normalizeAudioType('not a type')).toBeNull();
  });

  it('maps the supported extensions', () => {
    expect(AUDIO_MIME_BY_EXTENSION.mp3).toBe('audio/mpeg');
    expect(AUDIO_MIME_BY_EXTENSION.m4a).toBe('audio/mp4');
    expect(AUDIO_MIME_BY_EXTENSION.aac).toBe('audio/aac');
    expect(AUDIO_MIME_BY_EXTENSION.ogg).toBe('audio/ogg');
    expect(AUDIO_MIME_BY_EXTENSION.wav).toBe('audio/wav');
  });
});

describe('parseAudioSourcesAttribute', () => {
  it('parses URLs and typed objects', () => {
    const parsed = parseAudioSourcesAttribute(
      JSON.stringify(['/a.mp3', { src: '/b.m4a', type: 'audio/mp4' }, { src: '  /c.ogg  ' }]),
    );
    expect(parsed).toEqual({
      ok: true,
      sources: [{ src: '/a.mp3' }, { src: '/b.m4a', type: 'audio/mp4' }, { src: '/c.ogg' }],
    });
  });

  it('treats a blank value as absent and an empty array as an empty list', () => {
    expect(parseAudioSourcesAttribute(null)).toEqual({ ok: false, reason: 'absent' });
    expect(parseAudioSourcesAttribute('  ')).toEqual({ ok: false, reason: 'absent' });
    expect(parseAudioSourcesAttribute('[]')).toEqual({ ok: true, sources: [] });
  });

  it('rejects malformed lists', () => {
    expect(parseAudioSourcesAttribute('{')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseAudioSourcesAttribute('{"src":"/a.mp3"}')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseAudioSourcesAttribute('[1, null, {}]')).toEqual({ ok: false, reason: 'invalid' });
    expect(INVALID_AUDIO_SOURCES_MESSAGE).toMatch(/JSON array/);
  });
});

describe('selectAudioSource', () => {
  const canPlay = accept('audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav');

  it('picks the first playable type and passes codec parameters through', () => {
    const seen: string[] = [];
    const selected = selectAudioSource(
      [
        { src: '/nope.wav', type: 'audio/x-music-pill-unsupported' },
        { src: '/song.m4a', type: 'audio/mp4; codecs="mp4a.40.2"' },
        { src: '/song.mp3' },
      ],
      BASE,
      (mime) => {
        seen.push(mime);
        return canPlay(mime);
      },
    );
    expect(seen).toContain('audio/x-music-pill-unsupported');
    expect(seen).toContain('audio/mp4; codecs="mp4a.40.2"');
    expect(selected).toMatchObject({
      status: 'selected',
      source: { type: 'audio/mp4; codecs="mp4a.40.2"', crossOrigin: false },
    });
    if (selected.status === 'selected') expect(selected.source.href).toBe('https://site.example/song.m4a');
  });

  it('infers MP3, M4A, AAC, OGG, and WAV and skips a type the browser refuses', () => {
    const wavOnly = accept('audio/wav');
    const selected = selectAudioSource(
      [{ src: '/a.mp3' }, { src: '/b.m4a' }, { src: '/c.aac' }, { src: '/d.ogg' }, { src: 'tone.wav' }],
      BASE,
      wavOnly,
    );
    expect(selected.status).toBe('selected');
    if (selected.status === 'selected') {
      expect(selected.source.href).toBe('https://site.example/player/tone.wav');
      expect(selected.source.type).toBe('audio/wav');
    }
  });

  it('tries an extensionless or blob URL when no type can be inferred', () => {
    const selected = selectAudioSource([{ src: 'blob:https://site.example/uuid' }, { src: '/song.mp3' }], BASE, canPlay);
    expect(selected.status).toBe('selected');
    if (selected.status === 'selected') {
      expect(selected.source.href).toBe('blob:https://site.example/uuid');
      expect(selected.source.type).toBeNull();
    }
  });

  it('uses the first valid URL when canPlayType is not implemented', () => {
    const selected = selectAudioSource([{ src: '/song.mp3' }, { src: '/song.wav' }], BASE, () => '');
    expect(selected.status).toBe('selected');
    if (selected.status === 'selected') expect(selected.source.href).toBe('https://site.example/song.mp3');
  });

  it('reports when every known type is unplayable', () => {
    const selected = selectAudioSource(
      [
        { src: '/a.mp3', type: 'audio/mpeg' },
        { src: '/b.ogg', type: 'audio/ogg' },
      ],
      BASE,
      accept('audio/wav'),
    );
    expect(selected).toEqual({ status: 'none-playable', droppedInvalid: 0 });
    expect(NO_PLAYABLE_SOURCE_MESSAGE).toMatch(/MP3/);
  });

  it('rejects unsafe URLs and still plays a later valid source', () => {
    const selected = selectAudioSource(
      [{ src: 'javascript:alert(1)' }, { src: '/tone.wav' }],
      BASE,
      canPlay,
    );
    expect(selected.status).toBe('selected');
    if (selected.status === 'selected') {
      expect(selected.droppedInvalid).toBe(1);
      expect(selected.source.href).toBe('https://site.example/tone.wav');
    }
    expect(DROPPED_AUDIO_SOURCE_MESSAGE).not.toMatch(/javascript/);
  });

  it('fails closed when every URL is unsafe', () => {
    expect(selectAudioSource([{ src: 'javascript:alert(1)' }], BASE, canPlay)).toEqual({ status: 'invalid' });
    expect(selectAudioSource([{ src: 'data:text/plain,hi' }], BASE, canPlay)).toEqual({ status: 'invalid' });
    expect(selectAudioSource([], BASE, canPlay)).toEqual({ status: 'empty' });
  });
});
