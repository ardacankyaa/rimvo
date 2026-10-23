import { defineConfig, devices } from '@playwright/test';

// Workflows run against the Vite dev server. The production-offline project
// builds the hosted `/rimvo/` variant into dist-e2e/ (leaving dist/ alone),
// serves it with `vite preview` and checks the service worker and the
// Content-Security-Policy that only production builds carry.
const productionPort = 5181;
const production = /\.production\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5180', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: production, use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testIgnore: production, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', testIgnore: production, use: { ...devices['Pixel 7'] } },
    { name: 'production-offline', testMatch: production, use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${productionPort}/rimvo/` } },
  ],
  webServer: [
    { command: 'npm run dev -- --port 5180', url: 'http://localhost:5180', reuseExistingServer: !process.env.CI },
    {
      command: `npx vite build --base=/rimvo/ --outDir dist-e2e --emptyOutDir --logLevel error && npx vite preview --base=/rimvo/ --outDir dist-e2e --host localhost --port ${productionPort} --strictPort`,
      url: `http://localhost:${productionPort}/rimvo/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
