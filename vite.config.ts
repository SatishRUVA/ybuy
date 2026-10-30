import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { checkVpn, isVpnDetectionEnabled } from './api/_lib/vpn-check.js';

function localVpnCheck({ apiKey, supabaseUrl, anonKey }: {
  apiKey: string | undefined;
  supabaseUrl: string | undefined;
  anonKey: string | undefined;
}): Plugin {
  return {
    name: 'ybuy-local-vpn-check',
    configureServer(server) {
      server.middlewares.use('/api/access/vpn-check', (request, response) => {
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.end();
          return;
        }

        void isVpnDetectionEnabled(supabaseUrl, anonKey).then(async (enabled) => {
          const isVpn = enabled ? await checkVpn(undefined, apiKey) : false;
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'no-store');
          response.end(JSON.stringify({ enabled, isVpn }));
        }).catch(() => {
          response.statusCode = 502;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ error: 'VPN check unavailable' }));
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), localVpnCheck({
      apiKey: env.IPAPI_IS_KEY,
      supabaseUrl: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
    })],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: 'localhost',
      port: 5174,
      strictPort: true,
      watch: {
        ignored: ['**/node_modules/**', '**/test-results*/**', '**/playwright-report*/**'],
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
  };
});
