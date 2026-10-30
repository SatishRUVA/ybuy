import { defineConfig } from '@playwright/test';

const appPort = process.env.YBUY_TEST_PORT ?? '5174';
const appUrl = `http://localhost:${appPort}`;

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/local/**',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm run dev -- --host localhost --port ${appPort} --strictPort --mode e2e`,
    url: appUrl,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'playwright-not-a-valid-key',
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
