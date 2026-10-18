import { expect, test, type Page } from '@playwright/test';

// Real-browser tests with a generated test tone. Output level is measured with
// an AnalyserNode tap installed by the harness, so "playing" here means samples
// actually flowed through the gain node, not merely that a promise resolved.

const TONE = '/fixtures/audio/test-tone.wav';
const SHORT = '/fixtures/audio/short-tone.wav';
const CROSS = 'http://127.0.0.1:4392';

async function open(page: Page, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  await page.goto(`/tests/e2e/pages/harness.html?${qs}`);
  await page.waitForFunction(() => (window as any).__events.some((e: any) => e.type === 'music-pill-ready'));
}

const state = (page: Page, id = 'pill-0') =>
  page.evaluate((id) => (document.getElementById(id) as any).playbackState as string, id);
const level = (page: Page) => page.evaluate(() => (window as any).__level() as number);
const events = (page: Page, type: string) =>
  page.evaluate((type) => (window as any).__events.filter((e: any) => e.type === type).map((e: any) => e.detail), type);
const media = (page: Page, id = 'pill-0') =>
  page.evaluate((id) => {
    const a = document.getElementById(id)!.shadowRoot!.querySelector('audio');
    return a ? { paused: a.paused, time: a.currentTime } : null;
  }, id);
const soundButton = (page: Page, id = 'pill-0') => page.locator(`#${id}`).getByRole('button');

async function waitForState(page: Page, expected: string, id = 'pill-0', timeout = 10_000) {
  await expect.poll(() => state(page, id), { timeout }).toBe(expected);
}

async function expectAudible(page: Page) {
  // 0.12 amplitude tone x 0.25 gain ~= 0.02 RMS once the fade completes.
  await expect.poll(() => level(page), { timeout: 8_000, intervals: [200] }).toBeGreaterThan(0.005);
}

test('link-only pill links to Spotify and has no sound control', async ({ page }) => {
  await open(page, {});
  const link = page.locator('#pill-0').getByRole('link');
  await expect(link).toHaveAttribute('href', 'https://open.spotify.com/track/MusicPillTestFixture00');
  await expect(link).toHaveAccessibleName(
    'Test tone (generated fixture) by Not a Spotify recording, listen on Spotify (opens in a new tab)',
  );
  await expect(page.locator('#pill-0').getByRole('button')).toHaveCount(0);
  expect(await state(page)).toBe('none');
});

test('first-visit autoplay attempt: blocked is reported, never faked', async ({ page, browserName }) => {
  await open(page, { 'audio-src': TONE });
  await expect.poll(() => state(page), { timeout: 10_000 }).toMatch(/^(blocked|playing)$/);
  const outcome = await state(page);
  test.info().annotations.push({ type: 'autoplay-outcome', description: `${browserName}: ${outcome}` });
  if (outcome === 'blocked') {
    expect((await events(page, 'music-pill-autoplay-blocked')).length).toBe(1);
    await expect(soundButton(page)).toHaveAccessibleName('Enable website sound');
    await page.waitForTimeout(500);
    expect(await level(page)).toBeLessThan(0.001);
    // Unrelated interaction must not start sound.
    await page.locator('#page-link').click();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(800);
    expect(await state(page)).toBe('blocked');
    expect(await level(page)).toBeLessThan(0.001);
  } else {
    await expectAudible(page);
  }
  if (browserName !== 'webkit') expect(outcome).toBe('blocked'); // policy pinned in config
});

test('sound button activation plays real audio with a fade-in', async ({ page }) => {
  await open(page, { 'audio-src': TONE, autoplay: 'off' });
  expect(await state(page)).toBe('idle');
  await soundButton(page).click();
  await waitForState(page, 'playing');
  await expect(soundButton(page)).toHaveAccessibleName('Mute website sound');
  await expectAudible(page);
  // Media time advances (WebKit's headless clock can stall briefly at start).
  const t1 = (await media(page))!.time;
  await expect.poll(async () => (await media(page))!.time, { timeout: 5_000 }).toBeGreaterThan(t1 + 0.5);
  const ramps = await page.evaluate(() => (window as any).__ramps as { value: number }[]);
  expect(ramps.some((r) => Math.abs(r.value - 0.25) < 1e-6)).toBe(true);
});

test('activation works when media readiness arrives later', async ({ page }) => {
  await open(page, { 'audio-src': `/slow${TONE}`, autoplay: 'off' });
  await soundButton(page).click();
  expect(await state(page)).toBe('starting');
  await waitForState(page, 'playing');
  await expectAudible(page);
});

test('keyboard: Tab reaches link then sound button; Enter toggles', async ({ page, browserName }) => {
  await open(page, { 'audio-src': TONE, autoplay: 'off' });
  // WebKit only tabs to links with the "Press Tab to highlight each item" setting.
  const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.locator('#page-link').focus();
  await page.keyboard.press(tabKey);
  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const inner = el?.shadowRoot?.activeElement as HTMLElement | null;
      return inner ? inner.tagName.toLowerCase() : el?.tagName.toLowerCase();
    });
  expect(await active()).toBe('a');
  await page.keyboard.press(tabKey);
  expect(await active()).toBe('button');
  await page.keyboard.press('Enter');
  await waitForState(page, 'playing');
  await page.keyboard.press('Enter');
  await waitForState(page, 'muted');
});

test('mute is prompt, stays in force, and persists for the session', async ({ page }) => {
  // Uses the 6 s fixture; mute holding across a loop restart is unit-tested.
  await open(page, { 'audio-src': TONE, autoplay: 'off' });
  await soundButton(page).click();
  await waitForState(page, 'playing');
  await expectAudible(page);
  await soundButton(page).click();
  expect(await state(page)).toBe('muted');
  await page.waitForTimeout(300);
  expect(await level(page)).toBeLessThan(0.001);
  expect((await media(page))!.paused).toBe(true);
  await page.waitForTimeout(1500);
  expect(await state(page)).toBe('muted');
  await page.reload();
  await page.waitForFunction(() => (window as any).__events.some((e: any) => e.type === 'music-pill-ready'));
  await waitForState(page, 'muted');
  await expect(soundButton(page)).toHaveAccessibleName('Enable website sound');
});

test('loops a short track: fades clamp, restart is faded, state stays playing', async ({ page, browserName }) => {
  await open(page, { 'audio-src': SHORT, autoplay: 'off', 'fade-duration': '5' });
  await page.evaluate(() => {
    const a = document.getElementById('pill-0')!.shadowRoot!.querySelector('audio')!;
    (window as any).__ended = 0;
    a.addEventListener('ended', () => (window as any).__ended++);
  });
  await soundButton(page).click();
  await waitForState(page, 'playing');
  // Headless WebKit (notably on Linux) can stall or suspend audio on very
  // short looping files. The engine must then report "paused" with reason
  // "interrupted" (never a false "playing"); other engines must keep playing.
  const interrupted = async () => {
    const last = await page.evaluate(() =>
      (window as any).__events.filter((e: any) => e.type === 'music-pill-statechange').at(-1)?.detail,
    );
    return last?.state === 'paused' && last?.reason === 'interrupted';
  };
  await expect
    .poll(async () => (await page.evaluate(() => (window as any).__ended)) >= 2 || (await interrupted()), { timeout: 12_000 })
    .toBe(true);
  if (browserName === 'webkit' && (await interrupted())) {
    test.info().annotations.push({ type: 'webkit-media-freeze', description: 'loop reported paused (interrupted)' });
    return;
  }
  expect(await state(page)).toBe('playing');
  // A 5 s fade on a 1 s file is clamped to < 0.5 s, so fade-in and fade-out never overlap.
  const ramps = await page.evaluate(() => (window as any).__ramps as { value: number; time: number }[]);
  const ups = ramps.filter((r) => Math.abs(r.value - 0.25) < 1e-6);
  const downs = ramps.filter((r) => r.value === 0);
  expect(ups.length).toBeGreaterThanOrEqual(2);
  expect(downs.length).toBeGreaterThanOrEqual(2);
  // Headless WebKit's media clock occasionally freezes on short looping files
  // without any event. The engine must then stop claiming "playing" (stall
  // watchdog) instead of showing a false indicator.
  await expect
    .poll(async () => (await level(page)) > 0.005 || (await state(page)) === 'paused', { timeout: 12_000, intervals: [200] })
    .toBe(true);
  if ((await state(page)) === 'paused') {
    test.info().annotations.push({ type: 'webkit-media-freeze', description: 'stall reported as paused (interrupted)' });
    expect(browserName).toBe('webkit');
  }
});

test('cross-origin audio with CORS headers is audible through Web Audio', async ({ page }) => {
  await open(page, { 'audio-src': `${CROSS}/cors${TONE}`, autoplay: 'off' });
  await soundButton(page).click();
  await waitForState(page, 'playing');
  await expectAudible(page);
});

test('cross-origin audio without CORS is reported and the link keeps working', async ({ page }) => {
  await open(page, { 'audio-src': `${CROSS}/nocors${TONE}`, autoplay: 'off' });
  await soundButton(page).click();
  await waitForState(page, 'error');
  expect((await events(page, 'music-pill-error')).map((e: any) => e.code)).toEqual(['audio-load-failed']);
  await expect(soundButton(page)).toBeDisabled();
  await expect(page.locator('#pill-0').getByRole('link')).toHaveAttribute('href', /open\.spotify\.com/);
  expect(await level(page)).toBeLessThan(0.001);
});

test('missing audio file is reported as unavailable', async ({ page }) => {
  await open(page, { 'audio-src': '/fixtures/audio/does-not-exist.wav', autoplay: 'off' });
  await soundButton(page).click();
  await waitForState(page, 'error');
  await expect(soundButton(page)).toHaveAccessibleName('Website sound unavailable');
});

test('hiding the page pauses; returning resumes only previously active audio', async ({ page }) => {
  await open(page, { 'audio-src': TONE, autoplay: 'off' });
  await soundButton(page).click();
  await waitForState(page, 'playing');
  const setVisibility = (v: 'hidden' | 'visible') =>
    page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
  await setVisibility('hidden');
  await waitForState(page, 'paused');
  await expect.poll(async () => (await media(page))!.paused).toBe(true);
  await setVisibility('visible');
  await waitForState(page, 'playing');
  await expectAudible(page);
});

test('several instances: only one plays; switching silences the other', async ({ page }) => {
  await open(page, { 'audio-src': TONE, autoplay: 'off', count: '2' });
  await soundButton(page, 'pill-0').click();
  await waitForState(page, 'playing', 'pill-0');
  await soundButton(page, 'pill-1').click();
  await waitForState(page, 'playing', 'pill-1');
  await waitForState(page, 'paused', 'pill-0');
  await expect.poll(async () => (await media(page, 'pill-0'))!.paused).toBe(true);
  // Removing the active one must not start the other.
  await page.evaluate(() => document.getElementById('pill-1')!.remove());
  await page.waitForTimeout(500);
  expect(await state(page, 'pill-0')).toBe('paused');
  expect(await level(page)).toBeLessThan(0.001);
});

test('changing position/size/theme while playing does not restart audio', async ({ page }) => {
  await open(page, { 'audio-src': TONE, autoplay: 'off' });
  await soundButton(page).click();
  await waitForState(page, 'playing');
  await page.waitForTimeout(600);
  const before = (await media(page))!.time;
  await page.evaluate(() => {
    const el = document.getElementById('pill-0')!;
    el.setAttribute('position', 'top-center');
    el.setAttribute('size', 'lg');
    el.setAttribute('theme', 'dark');
  });
  await page.waitForTimeout(300);
  const after = (await media(page))!.time;
  expect(after).toBeGreaterThan(before);
  expect(await state(page)).toBe('playing');
});

test('replacing the source mid-start never plays the old source', async ({ page }) => {
  await open(page, { 'audio-src': `/slow${TONE}`, autoplay: 'off' });
  await soundButton(page).click();
  await page.evaluate(() => document.getElementById('pill-0')!.setAttribute('audio-src', '/fixtures/audio/short-tone.wav'));
  await page.waitForTimeout(2500); // the slow response for the old source arrives
  const audios = await page.evaluate(() => document.getElementById('pill-0')!.shadowRoot!.querySelectorAll('audio').length);
  expect(audios).toBe(1);
  expect(await state(page)).toBe('idle');
  expect(await level(page)).toBeLessThan(0.001);
});

test('works under a strict CSP without unsafe-inline', async ({ page }) => {
  await page.goto('/csp/tests/e2e/pages/csp.html');
  await page.waitForFunction(() => document.querySelector('music-pill')?.shadowRoot?.querySelector('a')?.hasAttribute('href'));
  const height = await page.evaluate(
    () => document.querySelector('music-pill')!.shadowRoot!.querySelector('.root')!.getBoundingClientRect().height,
  );
  expect(height).toBe(56); // styles applied
  await page.locator('music-pill').getByRole('button').click();
  await expect.poll(() => page.evaluate(() => (document.querySelector('music-pill') as any).playbackState)).toBe('playing');
  expect(await page.evaluate(() => (window as any).__csp)).toEqual([]);
});
