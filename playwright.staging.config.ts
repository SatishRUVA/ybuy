import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/staging',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: 'test-results-staging',
  use: {
    baseURL: 'https://ybuy-redesign-v1.vercel.app',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});
