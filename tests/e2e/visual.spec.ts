import { expect, test, type Page } from '@playwright/test';

// Layout checks plus screenshots written to test-results/screenshots/ for
// inspection (a curated few are copied into docs/screenshots/).
// Not pixel-diffed: rendering differs across OS font stacks.

const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

async function open(page: Page, params: Record<string, string>) {
  await page.goto(`/tests/e2e/pages/harness.html?${new URLSearchParams(params)}`);
  await page.waitForFunction(() => (window as any).__events.some((e: any) => e.type === 'music-pill-ready'));
  await page.evaluate(() => document.fonts.ready);
}

async function pillBox(page: Page) {
  return page.evaluate(() => {
    const r = document.getElementById('pill-0')!.shadowRoot!.querySelector('.root')!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/screenshots/${test.info().project.name}-${name}.png` });

for (const position of POSITIONS) {
  test(`position ${position} stays inside the viewport with a 16px offset`, async ({ page }) => {
    await open(page, { position, artwork: '/fixtures/artwork/tone-art.svg', 'audio-src': '/fixtures/audio/test-tone.wav', autoplay: 'off' });
    const box = await pillBox(page);
    const vp = page.viewportSize()!;
    expect(box.left).toBeGreaterThanOrEqual(15.5);
    expect(box.right).toBeLessThanOrEqual(vp.width - 15.5);
    if (position.startsWith('top')) expect(box.top).toBeCloseTo(16, 0);
    else expect(vp.height - box.bottom).toBeCloseTo(16, 0);
    if (position.endsWith('center')) expect(Math.abs(box.left + box.width / 2 - vp.width / 2)).toBeLessThan(1);
    await shot(page, `position-${position}`);
  });
}

for (const size of ['sm', 'md', 'lg'] as const) {
  test(`size ${size} has the specified height`, async ({ page }) => {
    await open(page, { size, artwork: '/fixtures/artwork/tone-art.svg', 'audio-src': '/fixtures/audio/test-tone.wav', autoplay: 'off' });
    const box = await pillBox(page);
    expect(box.height).toBe({ sm: 48, md: 56, lg: 64 }[size]);
    const art = await page.evaluate(() => document.getElementById('pill-0')!.shadowRoot!.querySelector('.art')!.getBoundingClientRect().width);
    expect(art).toBe({ sm: 32, md: 40, lg: 48 }[size]);
    // Sound control hit area is at least 44 x 44.
    const btn = await page.evaluate(() => {
      const r = document.getElementById('pill-0')!.shadowRoot!.querySelector('button')!.getBoundingClientRect();
      return [r.width, r.height];
    });
    expect(btn[0]).toBeGreaterThanOrEqual(44);
    expect(btn[1]).toBeGreaterThanOrEqual(44);
    await shot(page, `size-${size}`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`theme ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(() => undefined);
    await open(page, { theme: 'auto', artwork: '/fixtures/artwork/tone-art.svg', 'audio-src': '/fixtures/audio/test-tone.wav', autoplay: 'off' });
    if (theme === 'dark') await page.evaluate(() => (document.body.style.background = '#111'));
    await shot(page, `theme-${theme}`);
  });
}

test('link-only and broken-artwork fallbacks', async ({ page }) => {
  await open(page, { 'song-title': '', artist: '', artwork: '/fixtures/artwork/missing.png' });
  await page.waitForTimeout(300);
  const placeholderVisible = await page.evaluate(
    () => !document.getElementById('pill-0')!.shadowRoot!.querySelector('.art svg')!.hasAttribute('hidden'),
  );
  expect(placeholderVisible).toBe(true);
  await shot(page, 'link-only-placeholder');
});

test('long strings at 320px: no horizontal overflow, text truncates', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, {
    'song-title': 'An Extraordinarily Long Song Title That Keeps Going (Extended Remastered Edition)',
    artist: 'A Collaborative Ensemble Featuring Many Guest Artists',
    artwork: '/fixtures/artwork/tone-art.svg',
    'audio-src': '/fixtures/audio/test-tone.wav',
    autoplay: 'off',
    position: 'bottom-center',
  });
  const box = await pillBox(page);
  expect(box.left).toBeGreaterThanOrEqual(15.5);
  expect(box.right).toBeLessThanOrEqual(320 - 15.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await shot(page, 'narrow-320-long-text');
});

test('200% zoom-equivalent text does not clip the pill', async ({ page }) => {
  await open(page, { artwork: '/fixtures/artwork/tone-art.svg' });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'music-pill::part(title), music-pill::part(artist) { font-size: 200%; }';
    document.head.append(s);
  });
  const box = await pillBox(page);
  expect(box.height).toBeGreaterThan(56); // grows instead of clipping
  await shot(page, 'large-text');
});

test('CSS custom properties restyle the pill', async ({ page }) => {
  await open(page, { artwork: '/fixtures/artwork/tone-art.svg', 'audio-src': '/fixtures/audio/test-tone.wav', autoplay: 'off' });
  await page.evaluate(() => {
    const el = document.getElementById('pill-0')!;
    el.style.setProperty('--music-pill-background', '#1e3a5f');
    el.style.setProperty('--music-pill-foreground', '#ffffff');
    el.style.setProperty('--music-pill-secondary', '#cfe0f5');
    el.style.setProperty('--music-pill-offset', '32px');
  });
  const box = await pillBox(page);
  expect(page.viewportSize()!.height - box.bottom).toBeCloseTo(32, 0);
  const bg = await page.evaluate(
    () => getComputedStyle(document.getElementById('pill-0')!.shadowRoot!.querySelector('.root')!).backgroundColor,
  );
  expect(bg).toBe('rgb(30, 58, 95)');
  await shot(page, 'custom-colours');
});
