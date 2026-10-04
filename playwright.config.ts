import { defineConfig, devices } from '@playwright/test';

// Mobile-first: every e2e test runs on two phone viewports. Chromium only
// (the sandbox ships Chromium); WebKit can be added when available.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'iphone-390x844',
      use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'pixel-412x915',
      use: { ...devices['Pixel 5'], browserName: 'chromium', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    },
  ],
});
