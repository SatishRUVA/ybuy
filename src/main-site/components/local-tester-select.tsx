import { useEffect, useState } from 'react';
import { useAuth } from '@/auth-context';
import { loadLocalProfiles, type LocalLoginProfile } from '@/lib/local-profile-login';
import { Alert, Button } from '@/main-site/components/ui';

export function LocalTesterSelect() {
  const { user, loading: authLoading, authBusy, selectLocalProfile } = useAuth();
  const [profiles, setProfiles] = useState<LocalLoginProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadLocalProfiles().then(data => {
      if (active) setProfiles(data);
    }).catch((reason: unknown) => {
      console.error('Local testers failed to load:', reason);
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load local testers.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="local-tester" className="text-sm font-semibold text-main">Tester</label>
      <select id="local-tester" name="local-tester" autoComplete="off"
        value={profiles.some(item => item.id === user?.id) ? user?.id : ''}
        disabled={loading || authLoading || authBusy !== null || error !== null}
        onChange={event => void selectLocalProfile(event.target.value)}
        className="min-h-11 w-full max-w-64 rounded-card border border-strong bg-card px-3 text-base text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:w-64 sm:text-sm">
        <option value="" disabled>{loading ? 'Loading testers...' : 'Select an account'}</option>
        {(['Owner', 'Renter'] as const).map(role => <optgroup key={role} label={`${role}s`}>
          {profiles.filter(item => item.role === role).map(item =>
            <option key={item.id} value={item.id}>{item.name} - {role}</option>)}
        </optgroup>)}
      </select>
      {(loading || authBusy !== null) && <span role="status" className="text-xs text-sec">
        {loading ? 'Preparing testers...' : 'Switching account...'}
      </span>}
    </div>
    {error && <Alert tone="error" className="mt-2">{error}
      <Button size="sm" variant="secondary" className="ml-2" onClick={() => setRetry(value => value + 1)}>Retry</Button>
    </Alert>}
  </div>;
}
