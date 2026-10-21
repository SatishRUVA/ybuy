import { execSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';
import mockedConfig from './playwright.config';

const status = JSON.parse(execSync('npx supabase status --output json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY) {
  throw new Error('Real tests require the running local Supabase stack.');
}

export default defineConfig({
  testDir: './tests/local',
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-local-report', open: 'never' }]],
  outputDir: 'test-results-local',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    ...mockedConfig.webServer,
    env: { ...mockedConfig.webServer?.env, VITE_SUPABASE_ANON_KEY: status.ANON_KEY },
  },
});
