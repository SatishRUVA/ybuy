import { defineConfig } from '@playwright/test';

process.env.YBUY_E2E_HOSTED = 'true';
process.env.YBUY_E2E_LOCAL_APP = 'true';

const appUrl = 'http://localhost:5174';

export default defineConfig({
  testDir: './tests/local',
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-hosted-report', open: 'never' }]],
  outputDir: 'test-results-hosted',
  use: {
    baseURL: appUrl,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm run dev -- --host localhost --port 5174 --strictPort --mode hosted',
    url: appUrl,
    reuseExistingServer: !process.env.CI,
  },
});
