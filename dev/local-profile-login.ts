import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Plugin } from 'vite';

const marker = 'ybuy-local-profile-picker-v1';
const names = [
  'Maya Patel', 'Oliver Brooks', 'Sofia Martinez', 'Ethan Williams', 'Chloe Nguyen',
  'Noah Anderson', 'Amelia Carter', 'Liam Thompson', 'Isabella Reed', 'Lucas Bennett',
  'Ava Morgan', 'James Rivera', 'Mia Chen', 'Benjamin Hayes', 'Harper Wilson',
  'Elijah Scott', 'Charlotte Davis', 'Henry Clarke', 'Evelyn Foster', 'Leo Ramirez',
];
const personas = [
  ...names.map((name, index) => ({
    key: `${index < 10 ? 'owner' : 'renter'}${index % 10 + 1}`,
    name, role: index < 10 ? 'Owner' : 'Renter',
  })),
  { key: 'admin', name: 'Grace Mitchell', role: 'Admin' },
  { key: 'super-admin', name: 'Daniel Lawson', role: 'Super Admin' },
];

export function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false;
  const parsed = new URL(url);
  return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    && parsed.port === '54321' && parsed.pathname === '/' && !parsed.username && !parsed.password;
}

export function localProfileLogin(url: string, serviceKey: string): Plugin {
  if (!isLocalSupabase(url)) throw new Error('Profile selection requires isolated local Supabase.');
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      if (new URL(String(input)).origin !== new URL(url).origin) throw new Error('Non-local profile request refused.');
      return fetch(input, { ...init, redirect: 'error' });
    } },
  });

  async function provision() {
    const existing = new Map<string, { id: string; app_metadata: Record<string, unknown> }>();
    for (let page = 1; ; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      for (const user of data.users) if (user.email) existing.set(user.email, user);
      if (data.users.length < 100) break;
    }
    const { data: permissions, error: permissionsError } = await db.rpc('admin_grantable_permissions');
    if (permissionsError) throw permissionsError;
    if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== 'string')) {
      throw new Error('Local admin permission catalog is invalid. Apply local migrations.');
    }
    const profiles = [];
    for (const persona of personas) {
      const email = `${persona.key}@profiles.ybuy.test`;
      let user = existing.get(email);
      if (user && user.app_metadata.local_test_fixture !== marker) {
        throw new Error(`Refusing to modify unrelated account ${email}.`);
      }
      if (!user) {
        const { data, error } = await db.auth.admin.createUser({
          email, email_confirm: true, password: randomBytes(32).toString('base64url'),
          app_metadata: { local_test_fixture: marker },
          user_metadata: { full_name: persona.name },
        });
        if (error) throw error;
        if (!data.user) throw new Error('Local account creation returned no user.');
        user = data.user;
      }
      if (persona.role === 'Admin' || persona.role === 'Super Admin') {
        const { error } = await db.from('admin_users').upsert({
          user_id: user.id, role: persona.role === 'Admin' ? 'admin' : 'super_admin',
          permissions: persona.role === 'Admin' ? permissions : [], active: true,
        });
        if (error) throw error;
      }
      profiles.push({ id: user.id, name: persona.name, role: persona.role, email });
    }
    return profiles;
  }

  return {
    name: 'ybuy-local-profile-login',
    apply: 'serve',
    configureServer(server) {
      let profilesPromise: ReturnType<typeof provision> | undefined;
      server.middlewares.use('/api/local-profiles', (request, response) => {
        const host = request.headers.host;
        const address = request.socket.remoteAddress;
        let hostname: string | undefined;
        try { hostname = host ? new URL(`http://${host}`).hostname : undefined; } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'Invalid local request host.' }));
          return;
        }
        if (!host || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')
          || !['localhost', '127.0.0.1', '[::1]'].includes(hostname ?? '')) {
          response.statusCode = 403;
          response.end();
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-store');
        response.setHeader('x-content-type-options', 'nosniff');
        if (!['GET', 'POST'].includes(request.method ?? '')) {
          response.statusCode = 405;
          response.setHeader('allow', 'GET, POST');
          response.end(JSON.stringify({ error: 'Method not allowed.' }));
          return;
        }
        if (request.method === 'POST' && request.headers.origin !== `http://${host}`) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: 'Local profile selection requires a same-origin request.' }));
          return;
        }
        void (async () => {
          profilesPromise ??= provision().catch((error: unknown) => {
            profilesPromise = undefined;
            throw error;
          });
          const profiles = await profilesPromise;
          if (request.method === 'GET') {
            response.end(JSON.stringify(profiles.map(({ id, name, role }) => ({ id, name, role }))));
            return;
          }
          let body = '';
          for await (const chunk of request) {
            body += chunk.toString();
            if (body.length > 1024) {
              response.statusCode = 413;
              response.end(JSON.stringify({ error: 'Profile request is too large.' }));
              return;
            }
          }
          let input: unknown;
          try { input = JSON.parse(body); } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'Invalid profile request.' }));
            return;
          }
          const profile = profiles.find((item) => typeof input === 'object' && input !== null
            && 'id' in input && input.id === item.id);
          if (!profile) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'Choose one of the local profiles.' }));
            return;
          }
          const { data: account, error: accountError } = await db.auth.admin.getUserById(profile.id);
          if (accountError) throw accountError;
          if (account.user.app_metadata.local_test_fixture !== marker) throw new Error('Local fixture identity changed.');
          const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: profile.email });
          if (error) throw error;
          if (data.user.id !== profile.id || !data.properties.hashed_token) throw new Error('Local login identity mismatch.');
          response.end(JSON.stringify({ tokenHash: data.properties.hashed_token }));
        })().catch((error: unknown) => {
          server.config.logger.error(`Local profile login failed: ${error instanceof Error ? error.message : String(error)}`);
          response.statusCode = 503;
          response.end(JSON.stringify({ error: 'Local profiles are unavailable. Start local Supabase and apply its migrations, then retry.' }));
        });
      });
    },
  };
}
