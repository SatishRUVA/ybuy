import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/main-site-variant.spec.ts',
  fullyParallel: true,
  expect: { timeout: 30_000 },
  use: { baseURL: 'http://localhost:5186' },
  webServer: {
    ...base.webServer,
    command: 'npx vite preview --host localhost --port 5186 --strictPort',
    url: 'http://localhost:5186',
    reuseExistingServer: false,
    env: { ...base.webServer?.env, VITE_SITE_VARIANT: 'main' },
  },
});
