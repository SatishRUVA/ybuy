import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const result = spawnSync(process.execPath, ['node_modules\\supabase\\dist\\supabase.js', 'status', '--output', 'json'], { encoding: 'utf8' });
assert.equal(result.status, 0, 'Start Docker Desktop and run `pnpm exec supabase start` before `pnpm dev:local`.');
const status = JSON.parse(result.stdout);
const url = new URL(status.API_URL);
assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '54321', 'Only isolated local Supabase is allowed.');
assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Local Supabase keys are missing.');
writeFileSync('.env.local-profiles.local', [
  `VITE_SUPABASE_URL=${status.API_URL}`,
  `VITE_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
  `SUPABASE_URL=${status.API_URL}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  'VITE_TEST_ENVIRONMENT=true',
  'VITE_STRIPE_PUBLISHABLE_KEY=',
  'STRIPE_SECRET_KEY=',
  'STRIPE_WEBHOOK_SECRET=',
  'RESEND_API_KEY=',
  'IPAPI_IS_KEY=',
  '',
].join('\n'), { mode: 0o600 });
console.log('Configured isolated local profiles. Hosted environment files are unchanged.');
