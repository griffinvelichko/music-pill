import { defineConfig, devices } from '@playwright/test';

// Autoplay policy is pinned per browser so "blocked on first visit" is
// exercised deliberately rather than depending on headless defaults.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4391',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 4391 --port 4392',
    url: 'http://127.0.0.1:4391/tests/e2e/pages/harness.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /visual/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
      },
    },
    {
      name: 'firefox',
      testIgnore: /visual/,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.autoplay.default': 1, // 1 = block audible autoplay
            'media.autoplay.blocking_policy': 0,
          },
        },
      },
    },
    {
      name: 'webkit',
      testIgnore: /visual/,
      use: { ...devices['Desktop Safari'] },
    },
    { name: 'visual-desktop', testMatch: /visual/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'visual-iphone', testMatch: /visual/, use: { ...devices['iPhone 13'] } },
    { name: 'visual-android', testMatch: /visual/, use: { ...devices['Pixel 7'] } },
  ],
});
