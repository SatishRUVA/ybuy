import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';
import { ProviderIcon } from '@/components/provider-icon';
import { AUTH_PROVIDER_LABELS, ENABLED_AUTH_PROVIDERS } from '@/lib/auth-providers';
import { categories } from '@/data';

const sideImage = categories.find((category) => category.id === 'camping')?.image ?? categories[0].image;

export function SignInDialog() {
  const reduce = useReducedMotion();
  const { user, error, signInOpen, passwordRecovery, authBusy, closeSignIn, authenticate, requestPasswordReset, finishPasswordReset, signInWithProvider } = useAuth();
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

  const socialVisible = !passwordRecovery && !resetMode;
  const linkButton = 'min-h-11 px-1 text-[13px] sm:text-sm font-semibold text-accent hover:underline underline-offset-4 disabled:opacity-60';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="sign-in-title"
      aria-describedby="sign-in-description"
      onCancel={closeSignIn}
      className="w-[calc(100%_-_2rem)] max-w-[58rem] max-h-[96dvh] overflow-y-auto rounded-[1.75rem] bg-card text-main p-0 shadow-xl backdrop:bg-[#163D34]/70"
    >
      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside aria-hidden="true" className="relative hidden md:block overflow-hidden bg-[var(--ink)] text-white">
          <img src={sideImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#163D34]/45" />
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex h-full flex-col justify-end p-10"
          >
            <p className="font-editorial text-6xl leading-[0.95] tracking-[-0.02em]">Rent what you need. Share what you own.</p>
            <p className="mt-3 max-w-xs text-sm text-white/90">One account for renting and listing.</p>
          </motion.div>
        </aside>

        <div className="relative p-6 sm:p-8">
          <button onClick={closeSignIn} aria-label="Close sign-in" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-sec hover:bg-subtle hover:text-main">
            <X size={20} aria-hidden="true" />
          </button>
          <h2 id="sign-in-title" className="pr-10 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-main sm:text-3xl">
            {passwordRecovery ? 'Choose a new password' : resetMode ? 'Reset your password' : register ? 'Create your account' : user ? 'Use another account' : 'Welcome to YBuy'}
          </h2>
          <p id="sign-in-description" className="mt-1.5 mb-5 text-[15px] leading-snug text-sec">
            {user ? `You're signed in as ${user.email}. Signing in switches accounts on this device.` : 'One account to rent items and list your own.'}
          </p>
          {error && <div role="alert" className="mb-3"><Alert tone="error">{error}</Alert></div>}
          {submitted && !error && <div role="alert" className="mb-3"><Alert tone="info">Check your email for a confirmation link before signing in. If you already have an account, sign in instead.</Alert></div>}
          {resetSent && !error && <div role="alert" className="mb-3"><Alert tone="info">If an account uses that email, a reset link is on its way. Check your inbox and spam folder.</Alert></div>}
          {passwordRecovery && <div className="mb-3"><Alert tone="info">Enter a new password for your YBuy account.</Alert></div>}

          {socialVisible && <>
            <div className="space-y-2">
              {ENABLED_AUTH_PROVIDERS.map((provider) => (
                <Button
                  key={provider}
                  type="button"
                  fullWidth
                  variant="secondary"
                  disabled={authBusy !== null}
                  icon={<ProviderIcon provider={provider} />}
                  onClick={() => void signInWithProvider(provider)}
                >
                  Continue with {AUTH_PROVIDER_LABELS[provider]}
                </Button>
              ))}
            </div>
            <div className="my-4 flex items-center gap-3 text-xs text-sec"><span className="h-px flex-1 bg-[var(--border)]" /><span>or use email</span><span className="h-px flex-1 bg-[var(--border)]" /></div>
          </>}

          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            {register && !resetMode && !passwordRecovery && <label className="block text-sm font-semibold">Full name
              <input className={fieldClass('mt-1')} autoComplete="name" required maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>}
            {!passwordRecovery && <label className="block text-sm font-semibold">Email
              <input className={fieldClass('mt-1')} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>}
            {!resetMode && <div>
              <label htmlFor="sign-in-password" className="block text-sm font-semibold">{passwordRecovery ? 'New password' : 'Password'}</label>
              <div className="relative mt-1">
                <input id="sign-in-password" className={fieldClass('pr-12')} type={showPassword ? 'text' : 'password'} autoComplete={register || passwordRecovery ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-sec hover:text-main">
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
              {register && !passwordRecovery && <p className="mt-1.5 text-xs text-sec">At least 8 characters. You may need to confirm your email.</p>}
            </div>}
            <Button type="submit" fullWidth size="lg" loading={authBusy === 'sign-in'} disabled={authBusy !== null} loadingLabel={passwordRecovery ? 'Updating password...' : resetMode ? 'Sending reset link...' : register ? 'Creating account...' : 'Signing in...'}>
              {passwordRecovery ? 'Update password' : resetMode ? 'Send reset link' : register ? 'Create account' : 'Sign in'}
            </Button>
            {!passwordRecovery && (
              <div className="flex items-center justify-between gap-2">
                {!resetMode && !register
                  ? <button type="button" className={linkButton} disabled={authBusy !== null} onClick={() => { setResetMode(true); setResetSent(false); }}>Forgot password?</button>
                  : <span />}
                <button type="button" className={linkButton} disabled={authBusy !== null} onClick={() => { setResetMode(false); setResetSent(false); setRegister(resetMode ? false : !register); setPassword(''); setSubmitted(false); }}>
                  {resetMode ? 'Back to sign in' : register ? 'Already have an account? Sign in' : 'New to YBuy? Create an account'}
                </button>
              </div>
            )}
          </form>
          <p className="mt-3 text-center text-xs leading-snug text-sec">Authentication is handled by Supabase. Bookings and saved items stay with their original account.</p>
        </div>
      </div>
    </dialog>
  );
}
