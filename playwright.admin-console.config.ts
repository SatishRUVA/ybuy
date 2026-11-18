import { defineConfig } from '@playwright/test';

const appPort = process.env.YBUY_TEST_PORT ?? '5174';
const appUrl = `http://localhost:${appPort}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/admin-console.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: appUrl },
  webServer: {
    command: `pnpm exec vite build --outDir dist-admin && pnpm exec vite preview --outDir dist-admin --host localhost --port ${appPort} --strictPort`,
    url: appUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'playwright-not-a-valid-key',
      VITE_AUTH_PROVIDERS: 'google',
      VITE_TEST_ENVIRONMENT: 'true',
      VITE_SITE_VARIANT: 'admin',
      SUPABASE_URL: 'http://localhost:54321',
    },
  },
});
