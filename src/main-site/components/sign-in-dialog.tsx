import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import { BrandLogo } from '@/main-site/components/brand-logo';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { HOSTED_PROFILE_LOGIN, LOCAL_PROFILE_LOGIN, loadLocalProfiles, type LocalLoginProfile } from '@/lib/local-profile-login';

export function SignInDialog() {
  const { user, error, signInOpen, passwordRecovery, authBusy, closeSignIn, authenticate, requestPasswordReset, finishPasswordReset, signInWithGoogle } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!signInOpen || !dialog) return;
    setPassword('');
    setSubmitted(false);
    setResetMode(false);
    setResetSent(false);
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="sign-in-title"
      aria-describedby="sign-in-description"
      onCancel={closeSignIn}
      className="w-[calc(100%_-_2rem)] max-w-[40rem] max-h-[90dvh] overflow-y-auto rounded-card-xl border border-app bg-card text-main p-0 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="relative p-6 sm:p-8 md:p-9">
        <button onClick={closeSignIn} aria-label="Close sign-in" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle hover:text-main">
          <X size={20} aria-hidden="true" />
        </button>
        <div className="mb-6 flex items-center gap-2.5 pr-12">
          <BrandLogo />
        </div>
        <h2 id="sign-in-title" className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-main sm:text-4xl">
          {(LOCAL_PROFILE_LOGIN || HOSTED_PROFILE_LOGIN) && !passwordRecovery ? HOSTED_PROFILE_LOGIN ? 'Choose a test profile' : 'Choose a local profile'
            : passwordRecovery ? 'Choose a new password' : resetMode ? 'Reset your password' : register ? 'Create your account' : user ? 'Use another account' : 'Welcome to YBuy'}
        </h2>
        <p id="sign-in-description" className="mt-2 mb-6 text-[15px] leading-relaxed text-sec">
          {(LOCAL_PROFILE_LOGIN || HOSTED_PROFILE_LOGIN) && !passwordRecovery ? HOSTED_PROFILE_LOGIN
            ? 'Synthetic test accounts. Database permissions still apply.'
            : 'No password needed. These are isolated local test accounts.'
            : user ? `You're signed in as ${user.email}. Signing in switches accounts on this device.` : 'One account to rent items and list your own.'}
        </p>
        {(LOCAL_PROFILE_LOGIN || HOSTED_PROFILE_LOGIN) && !passwordRecovery ? <LocalProfilePicker /> : <>
        {error && <div role="alert" className="mb-4"><Alert tone="error">{error}</Alert></div>}
        {submitted && !error && <Alert tone="info">Check your email for a confirmation link before signing in. If you already have an account, sign in instead.</Alert>}
        {resetSent && !error && <Alert tone="info">If an account uses that email, a reset link is on its way. Check your inbox and spam folder.</Alert>}
        {passwordRecovery && <Alert tone="info">Enter a new password for your YBuy account.</Alert>}
        {!passwordRecovery && !resetMode && <>
          <Button type="button" fullWidth size="lg" variant="secondary" disabled={authBusy !== null} onClick={() => void signInWithGoogle()}>
            Continue with Google
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-sec"><span className="flex-1 border-t border-app" /><span>or use your YBuy account</span><span className="flex-1 border-t border-app" /></div>
        </>}
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {register && !resetMode && !passwordRecovery && <label className="block text-sm font-semibold">Full name
            <input className={fieldClass('mt-1')} autoComplete="name" required maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>}
          {!passwordRecovery && <label className="block text-sm font-semibold">Email
            <input className={fieldClass('mt-1')} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>}
          {!resetMode && <label className="block text-sm font-semibold">{passwordRecovery ? 'New password' : 'Password'}
            <input className={fieldClass('mt-1')} type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>}
          {!resetMode && <label className="flex min-h-11 items-center gap-2 text-sm text-sec">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show password
          </label>}
          {register && !resetMode && !passwordRecovery && <p className="text-sm text-sec">Use at least 8 characters. You may need to confirm your email.</p>}
          <Button type="submit" fullWidth size="lg" loading={authBusy === 'sign-in'} disabled={authBusy !== null} loadingLabel={passwordRecovery ? 'Updating password...' : resetMode ? 'Sending reset link...' : register ? 'Creating account...' : 'Signing in...'}>
            {passwordRecovery ? 'Update password' : resetMode ? 'Send reset link' : register ? 'Create account' : 'Sign in'}
          </Button>
          {!passwordRecovery && !resetMode && !register && <Button type="button" variant="ghost" fullWidth disabled={authBusy !== null} onClick={() => { setResetMode(true); setResetSent(false); }}>Forgot password?</Button>}
          {!passwordRecovery && <Button type="button" variant="ghost" fullWidth disabled={authBusy !== null} onClick={() => { setResetMode(false); setResetSent(false); setRegister(resetMode ? false : !register); setPassword(''); setSubmitted(false); }}>
            {resetMode ? 'Back to sign in' : register ? 'Already have an account? Sign in' : 'New to YBuy? Create an account'}
          </Button>}
        </form>
        <p className="mt-5 flex items-start justify-center gap-2 border-t border-app pt-4 text-center text-xs leading-relaxed text-sec">
          <LockKeyhole size={16} aria-hidden="true" className="shrink-0" />
          <span>Authentication is handled by Supabase. Bookings and saved items stay with their original account.</span>
        </p>
        </>}
      </div>
    </dialog>
  );
}

function LocalProfilePicker() {
  const { profile, error, signInOpen, authBusy, selectLocalProfile } = useAuth();
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
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error : `Tester verification failed (${response.status}).`;
        throw new Error(message);
      }
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

  return (
    <>
      {HOSTED_PROFILE_LOGIN && <form onSubmit={event => void verifyTester(event)} className="mb-6 space-y-4">
        <label className="block text-sm font-semibold">Tester security code
          <span className="mt-1 block text-sm font-normal text-sec">Use your authorized tester authenticator. Access expires after two hours.</span>
          <input className={fieldClass('mt-2')} value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
            required disabled={verifying} />
        </label>
        <Button type="submit" fullWidth disabled={code.length !== 6 || verifying} loading={verifying}>Verify tester access</Button>
      </form>}
      <p className="mb-4 text-sm leading-relaxed text-sec">Bookings and saved items stay with their original profile.</p>
      {HOSTED_PROFILE_LOGIN && <p className="mb-4 text-sm leading-relaxed text-sec">No password needed. These are isolated test accounts, not real customers.</p>}
      {(loadError || error) && <div role="alert" className="mb-4"><Alert tone="error">{loadError || error}</Alert></div>}
      <label htmlFor="local-profile" className="block text-sm font-semibold">Profile</label>
      <select
        id="local-profile"
        name="local-profile"
        autoComplete="off"
        className={fieldClass('mt-1')}
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
      {authBusy === 'sign-in' && <p role="status" className="mt-3 text-sm text-sec">Signing in...</p>}
      {loadError && <Button variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>Retry profiles</Button>}
    </>
  );
}
