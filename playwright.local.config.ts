import { defineConfig } from '@playwright/test';

const appUrl = 'http://localhost:5174/';
const localAnonKey = process.env.YBUY_LOCAL_SUPABASE_ANON_KEY;

if (process.env.YBUY_E2E_HOSTED === 'true') {
  throw new Error('This config is local-only. Unset YBUY_E2E_HOSTED to prevent contacting a remote backend.');
}
if (!localAnonKey) {
  throw new Error('Set YBUY_LOCAL_SUPABASE_ANON_KEY from `supabase status` before running local owner/renter E2E tests.');
}

export default defineConfig({
  testDir: './tests/local',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm run dev -- --host localhost --port 5174 --strictPort --mode e2e',
    url: appUrl,
    reuseExistingServer: false,
    env: {
      YBUY_TEST_APP_URL: appUrl,
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: localAnonKey,
      VITE_AUTH_PROVIDERS: 'google',
      VITE_GOOGLE_CLIENT_ID: '',
      VITE_GOOGLE_MAPS_API_KEY: '',
      VITE_MAP_API_KEY: '',
      VITE_STRIPE_PUBLISHABLE_KEY: '',
      VITE_TEST_ENVIRONMENT: 'true',
      VITE_MAX_BOOKING_RANGE_DAYS: '',
      VITE_SERVICE_FEE_PERCENT: '',
      VITE_SHOW_DEMO_THEMES: 'false',
      VITE_SHOW_HERO_CATEGORY_PILLS: 'false',
      VITE_SHOW_OUT_OF_SCOPE_PAGES: 'false',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      RESEND_API_KEY: '',
      OPENROUTER_API_KEY: '',
    },
  },
});
