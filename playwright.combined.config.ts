import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/combined-site.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results-combined',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:5193', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite preview --outDir dist-combined --host localhost --port 5193 --strictPort',
    url: 'http://localhost:5193',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
