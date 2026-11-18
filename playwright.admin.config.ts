import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/admin-portal.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results-admin-portal',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:5191', trace: 'retain-on-failure' },
  webServer: [{
    command: 'npx vite preview --outDir dist-admin --host localhost --port 5191 --strictPort',
    url: 'http://localhost:5191',
    reuseExistingServer: false,
    timeout: 60_000,
  }, {
    command: 'npx vite preview --outDir dist-customer --host localhost --port 5192 --strictPort',
    url: 'http://localhost:5192',
    reuseExistingServer: false,
    timeout: 60_000,
  }],
});
