import { useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';
import { HOSTED_PROFILE_LOGIN, PROFILE_LOGIN, loadLocalProfiles, type LocalLoginProfile } from '@/lib/local-profile-login';
import { Button as PreviewButton, Field, Modal } from '@/preview-1/ui';

export function SignInDialog() {
  const { user, error, signInOpen, passwordRecovery, authBusy, closeSignIn, authenticate, requestPasswordReset, finishPasswordReset, signInWithGoogle } = useAuth();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (!signInOpen) return;
    setPassword('');
    setSubmitted(false);
    setResetMode(false);
    setResetSent(false);
  }, [signInOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(false);
    if (passwordRecovery) {
      await finishPasswordReset(password);
      setPassword('');
      return;
    }
    if (resetMode) {
      setResetSent(await requestPasswordReset(email));
      return;
    }
    const result = await authenticate(email, password, register ? fullName : undefined);
    setPassword('');
    if (result === 'confirmation-required') setSubmitted(true);
  }

  const title = PROFILE_LOGIN && !passwordRecovery ? HOSTED_PROFILE_LOGIN ? 'Choose a test profile' : 'Choose a local profile'
    : passwordRecovery ? 'Choose a new password' : resetMode ? 'Reset your password' : register ? 'Create your account'
      : user ? 'Use another account' : 'More doing starts with hello.';
  return (
    <Modal open={signInOpen} onClose={closeSignIn} title={title}
      description={PROFILE_LOGIN && !passwordRecovery ? 'Synthetic test accounts. Database permissions still apply.'
        : user ? `You are signed in as ${user.email}. Signing in switches accounts on this device.` : 'One account to rent items and list your own.'}>
        {PROFILE_LOGIN && !passwordRecovery ? <LocalProfilePicker /> : <>
        {error && <div role="alert" className="mb-4"><Alert tone="error">{error}</Alert></div>}
        {submitted && !error && <Alert tone="info">Check your email for a confirmation link before signing in. If you already have an account, sign in instead.</Alert>}
        {resetSent && !error && <Alert tone="info">If an account uses that email, a reset link is on its way. Check your inbox and spam folder.</Alert>}
        {passwordRecovery && <Alert tone="info">Enter a new password for your YBuy account.</Alert>}
        <form className="p1-auth-form" onSubmit={(event) => void submit(event)}>
          {register && !resetMode && !passwordRecovery && <Field label="Full name">
            <input autoComplete="name" required disabled={authBusy !== null} maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>}
          {!passwordRecovery && <Field label="Email">
            <input type="email" autoComplete="email" required disabled={authBusy !== null} value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>}
          {!resetMode && <Field label={passwordRecovery ? 'New password' : 'Password'}>
            <input type={showPassword ? 'text' : 'password'} autoComplete={register || passwordRecovery ? 'new-password' : 'current-password'} minLength={8} required disabled={authBusy !== null} value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>}
          {!resetMode && <label className="p1-check">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show password
          </label>}
          {register && !resetMode && !passwordRecovery && <p className="text-sm text-sec">Use at least 8 characters. You may need to confirm your email.</p>}
          <PreviewButton type="submit" className="p1-full" disabled={authBusy !== null}>
            {authBusy !== null ? 'Working...' : passwordRecovery ? 'Update password' : resetMode ? 'Send reset link' : register ? 'Create account' : 'Sign in'}
          </PreviewButton>
          {!passwordRecovery && !resetMode && !register && <PreviewButton type="button" variant="quiet" className="p1-full" disabled={authBusy !== null} onClick={() => { setResetMode(true); setResetSent(false); }}>Forgot password?</PreviewButton>}
          {!passwordRecovery && <PreviewButton type="button" variant="quiet" className="p1-full" disabled={authBusy !== null} onClick={() => { setResetMode(false); setResetSent(false); setRegister(resetMode ? false : !register); setPassword(''); setSubmitted(false); }}>
            {resetMode ? 'Back to sign in' : register ? 'Already have an account? Sign in' : 'New to YBuy? Create an account'}
          </PreviewButton>}
        </form>
        {!passwordRecovery && !resetMode && <div className="p1-social-demo">
          <p className="p1-muted">Or use your connected Google account</p>
          <PreviewButton type="button" variant="secondary" disabled={authBusy !== null} onClick={() => void signInWithGoogle()}>Continue with Google</PreviewButton>
        </div>}
        <p className="mt-5 flex items-start justify-center gap-2 border-t border-app pt-4 text-center text-xs leading-relaxed text-sec">
          <LockKeyhole size={16} aria-hidden="true" className="shrink-0" />
          <span>Authentication is handled by Supabase. Bookings and saved items stay with their original account.</span>
        </p>
        </>}
    </Modal>
  );
}

function LocalProfilePicker() {
  const { signInOpen, profile, error, authBusy, selectLocalProfile } = useAuth();
  const [profiles, setProfiles] = useState<LocalLoginProfile[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  async function verifyTester(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifying(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/access/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error('Could not verify tester access. Check your authenticator code and retry.');
      setCode('');
      setAttempt(value => value + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Tester verification failed.');
    } finally { setVerifying(false); }
  }

  useEffect(() => {
    if (!signInOpen) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    loadLocalProfiles().then((data) => { if (active) setProfiles(data); }).catch((err: unknown) => {
      console.error('Local profiles failed to load:', err);
      if (active) setLoadError(err instanceof Error ? err.message : 'Could not load local profiles.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [signInOpen, attempt]);

  return <>
    {HOSTED_PROFILE_LOGIN && <form onSubmit={event => void verifyTester(event)} className="p1-auth-form mb-6">
      <Field label="Tester security code" hint="Use your authorized tester authenticator. Access expires after two hours.">
        <input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={verifying} />
      </Field>
      <Button type="submit" disabled={code.length !== 6} loading={verifying}>Verify tester access</Button>
    </form>}
    <p className="mb-6 mt-2 text-sm leading-relaxed text-sec">
      No password needed. These are isolated test accounts, not real customers.
      {profile && ` Currently using ${profile.full_name}.`}
    </p>
    {(loadError || error) && <div role="alert" className="mb-4"><Alert tone="error">{loadError || error}</Alert></div>}
    <label htmlFor="local-profile" className="block text-sm font-semibold">Profile</label>
    <select
      id="local-profile"
      name="local-profile"
      autoComplete="off"
      className={fieldClass('mt-2 min-h-12')}
      value={profile?.id ?? ''}
      disabled={loading || Boolean(loadError) || authBusy !== null}
      onChange={(event) => void selectLocalProfile(event.target.value)}
    >
      <option value="" disabled>{loading ? 'Loading profiles...' : 'Select a profile'}</option>
      {(['Owner', 'Renter', ...(HOSTED_PROFILE_LOGIN ? [] : ['Admin', 'Super Admin'])] as const).map((role) => (
        <optgroup key={role} label={role === 'Owner' || role === 'Renter' ? `${role}s` : role}>
          {profiles.filter((item) => item.role === role).map((item) => (
            <option key={item.id} value={item.id}>{item.name} - {item.role}</option>
          ))}
        </optgroup>
      ))}
    </select>
    {loading && <p role="status" className="mt-3 text-sm text-sec">Preparing local profiles...</p>}
    {authBusy === 'sign-in' && <p role="status" className="mt-3 text-sm text-sec">Switching profile...</p>}
    {loadError && <Button variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>Retry profiles</Button>}
    <p className="mt-5 text-xs leading-relaxed text-sec">Bookings and saved items stay with their original profile. Owner and Renter are test personas; database permissions still apply.</p>
  </>;
}
