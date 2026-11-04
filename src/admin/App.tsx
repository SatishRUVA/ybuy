import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider, useAuth } from '@/auth-context';
import { ThemeProvider } from '@/theme-context';
import { RouterProvider, useRouter } from '@/router';
import { Alert, Button } from '@/main-site/components/ui';
import { BrandLogo } from '@/main-site/components/brand-logo';
import { fieldClass } from '@/main-site/components/form-classes';
import { loadLocalProfiles, type LocalLoginProfile } from '@/lib/local-profile-login';
import '@/main-site/index.css';
import '@/main-site/theme.css';

const AdminPage = lazy(() => import('./pages/admin-page').then(module => ({ default: module.AdminPage })));
type Role = 'admin' | 'super_admin';
type Grant = { role: Role; profiles: LocalLoginProfile[] };
const roleName = (role: Role) => role === 'admin' ? 'Admin' : 'Super Admin';

async function accessRequest(method: 'GET' | 'POST' | 'DELETE', body?: { role: Role; code: string }) {
  const response = await fetch('/api/admin/access', {
    method, cache: 'no-store',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await response.json();
  if (response.status === 401 && method === 'GET') return null;
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
    ? data.error : 'Could not verify administrator access. Please retry.');
  if (method === 'DELETE') return null;
  if (!data || typeof data !== 'object' || !('role' in data) || (data.role !== 'admin' && data.role !== 'super_admin')) {
    throw new Error('Administrator verification returned an invalid role.');
  }
  return data.role;
}

function AdminPortal() {
  const { route, navigate } = useRouter();
  const { user, profile, loading: authLoading, error: authError, authBusy, selectLocalProfile, signOut } = useAuth();
  const [grant, setGrant] = useState<Grant | null>(null);
  const [role, setRole] = useState<Role>('admin');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const checking = useRef(false);
  const mutating = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    if (checking.current || mutating.current) return;
    checking.current = true;
    const currentRevision = revision.current;
    try {
      const verifiedRole = await accessRequest('GET');
      if (currentRevision !== revision.current) return;
      if (!verifiedRole) { setGrant(null); return; }
      const profiles = await loadLocalProfiles();
      if (currentRevision !== revision.current) return;
      if (profiles.some(item => item.role !== roleName(verifiedRole))) throw new Error('Administrator profiles do not match your verified role.');
      setGrant({ role: verifiedRole, profiles });
      setError(null);
    } catch (reason) {
      if (currentRevision !== revision.current) return;
      setGrant(null);
      setError(reason instanceof Error ? reason.message : 'Could not restore administrator access.');
    } finally { checking.current = false; if (currentRevision === revision.current) setBusy(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutating.current = true;
    revision.current++;
    setBusy(true); setError(null); setGrant(null);
    try {
      const verifiedRole = await accessRequest('POST', { role, code });
      setCode('');
      if (!verifiedRole) throw new Error('Administrator verification did not return a role.');
      const profiles = await loadLocalProfiles();
      if (profiles.some(item => item.role !== roleName(verifiedRole))) throw new Error('Administrator profiles do not match your verified role.');
      setGrant({ role: verifiedRole, profiles });
      setSwitching(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify your authenticator code.');
    } finally { mutating.current = false; setBusy(false); }
  }

  async function lock() {
    mutating.current = true;
    revision.current++;
    setBusy(true); setError(null); setGrant(null);
    try {
      await accessRequest('DELETE');
      await signOut();
      setSwitching(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not lock administrator access. Please retry.');
    } finally { mutating.current = false; setBusy(false); }
  }

  const authorized = grant && user && grant.profiles.some(item => item.id === user.id);
  const picker = !authorized || switching;
  return <div className="min-h-screen bg-app text-main">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-app bg-card px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3"><BrandLogo /><span className="text-sm font-semibold">Administration</span></div>
      {grant && <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-sec">{profile?.full_name ?? roleName(grant.role)}</span>
        {authorized && !switching && <Button variant="secondary" size="sm" onClick={() => setSwitching(true)}>Switch profile</Button>}
        <Button variant="ghost" size="sm" disabled={busy || authBusy !== null} onClick={() => void lock()}>Lock & sign out</Button>
      </div>}
    </header>
    {(error || authError) && <div role="alert" className="mx-auto max-w-xl px-5 pt-5"><Alert tone="error">{error || authError}</Alert></div>}
    {busy || authLoading || authBusy !== null ? <p role="status" className="p-8 text-center text-sec">Checking administrator access...</p>
      : !grant ? <main className="mx-auto max-w-lg px-5 py-12 sm:py-20">
        <ShieldCheck className="mb-5 text-main" size={32} aria-hidden="true" />
        <h1 className="font-display text-3xl font-bold">Administrator sign-in</h1>
        <p className="mt-3 text-sm leading-relaxed text-sec">Isolated test environment. Admin and Super Admin use different authenticator codes. Each code unlocks only its own role for up to two hours.</p>
        <form onSubmit={event => void verify(event)} className="mt-7 space-y-5">
          <label className="block text-sm font-semibold">Administrator role
            <select className={fieldClass('mt-2')} value={role} onChange={event => { setRole(event.target.value === 'super_admin' ? 'super_admin' : 'admin'); setCode(''); }}>
              <option value="admin">Admin</option><option value="super_admin">Super Admin</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">{roleName(role)} authenticator code
            <input className={fieldClass('mt-2')} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
          </label>
          <Button type="submit" fullWidth disabled={code.length !== 6}>Verify & choose profile</Button>
        </form>
        <Button variant="ghost" className="mt-4" onClick={() => { setBusy(true); void refresh(); }}>Retry access check</Button>
      </main>
      : picker ? <main className="mx-auto max-w-lg px-5 py-12">
        <h1 className="font-display text-3xl font-bold">Choose {grant.role === 'admin' ? 'an Admin' : 'a Super Admin'} profile</h1>
        <p className="mt-3 text-sm text-sec">Your authenticator code is verified. You can switch between profiles in this role without entering it again until access expires.</p>
        <label className="mt-6 block text-sm font-semibold">Administrator profile
          <select className={fieldClass('mt-2')} value={authorized ? user.id : ''} disabled={authBusy !== null}
            onChange={event => { setSwitching(false); void selectLocalProfile(event.target.value); }}>
            <option value="" disabled>Select a profile</option>
            {grant.profiles.map(item => <option key={item.id} value={item.id}>{item.name} - {item.role}</option>)}
          </select>
        </label>
        {authBusy && <p role="status" className="mt-3 text-sm text-sec">Signing in...</p>}
        {authorized && <Button variant="secondary" className="mt-4" onClick={() => setSwitching(false)}>Back to dashboard</Button>}
        <Button variant="ghost" className="mt-4" onClick={() => void lock()}>Use a different role</Button>
      </main>
      : <Suspense fallback={<p role="status" className="p-8">Loading admin console...</p>}>
        <AdminPage key={user.id} section={route.name === 'admin' && route.section !== 'login' ? route.section : undefined} />
        {route.name !== 'admin' && <Button className="sr-only focus:not-sr-only" onClick={() => navigate({ name: 'admin' })}>Open admin dashboard</Button>}
      </Suspense>}
  </div>;
}

export default function App() {
  return <ThemeProvider fixedTheme="main"><AuthProvider><RouterProvider><AdminPortal /></RouterProvider></AuthProvider></ThemeProvider>;
}
