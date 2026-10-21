import { defineConfig } from '@playwright/test';

process.env.YBUY_E2E_HOSTED = 'true';

export default defineConfig({
  testDir: './tests/local',
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-hosted-report', open: 'never' }]],
  outputDir: 'test-results-hosted',
  use: {
    baseURL: 'https://ybuy-e2e-test.vercel.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
