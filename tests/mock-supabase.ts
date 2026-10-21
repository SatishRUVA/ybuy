import type { Route } from '@playwright/test';

let cachedModule: string | undefined;

/** Keep browser fixtures isolated from whichever backend the local dev server uses. */
export async function mockSupabaseModule(route: Route) {
  if (!cachedModule) {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'if-none-match': '', 'if-modified-since': '' } });
    cachedModule = (await response.text())
      .replace(/const supabaseUrl = [^\n]+;/, 'const supabaseUrl = "http://127.0.0.1:54321";')
      .replace(/const supabaseAnonKey = [^\n]+;/, 'const supabaseAnonKey = "test-anon-key";');
  }
  await route.fulfill({ contentType: 'application/javascript', body: cachedModule });
}
