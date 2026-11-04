import { createClient } from '@supabase/supabase-js';
import { ADMIN_PORTAL } from '@/lib/admin-portal';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { flowType: 'pkce', ...(ADMIN_PORTAL ? { storageKey: 'ybuy-admin-auth', persistSession: false } : {}) },
});
