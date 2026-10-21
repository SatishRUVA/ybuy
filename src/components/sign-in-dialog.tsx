import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Leaf, LockKeyhole, X } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Button } from '@/components/ui';
import { fieldClass } from '@/components/form-classes';

export function SignInDialog() {
  const { user, error, signInOpen, authBusy, closeSignIn, authenticate } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!signInOpen || !dialog) return;
    setPassword('');
    setSubmitted(false);
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
          <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent"><Leaf size={20} aria-hidden="true" /></span>
          <span className="font-display text-2xl font-extrabold tracking-tight text-main">YBuy</span>
        </div>
        <h2 id="sign-in-title" className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-main sm:text-4xl">
          {register ? 'Create your account' : user ? 'Use another account' : 'Welcome to YBuy'}
        </h2>
        <p id="sign-in-description" className="mt-2 mb-6 text-[15px] leading-relaxed text-sec">
          {user ? `You're signed in as ${user.email}. Signing in switches accounts on this device.` : 'One account to rent items and list your own.'}
        </p>
        {error && <div role="alert" className="mb-4"><Alert tone="error">{error}</Alert></div>}
        {submitted && !error && <Alert tone="info">Check your email for a confirmation link before signing in. If you already have an account, sign in instead.</Alert>}
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {register && <label className="block text-sm font-semibold">Full name
            <input className={fieldClass('mt-1')} autoComplete="name" required maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>}
          <label className="block text-sm font-semibold">Email
            <input className={fieldClass('mt-1')} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold">Password
            <input className={fieldClass('mt-1')} type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-sec">
            <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show password
          </label>
          {register && <p className="text-sm text-sec">Use at least 8 characters. You may need to confirm your email.</p>}
          <Button type="submit" fullWidth size="lg" loading={authBusy === 'sign-in'} disabled={authBusy !== null} loadingLabel={register ? 'Creating account...' : 'Signing in...'}>
            {register ? 'Create account' : 'Sign in'}
          </Button>
          <Button type="button" variant="ghost" fullWidth disabled={authBusy !== null} onClick={() => { setRegister(!register); setPassword(''); setSubmitted(false); }}>
            {register ? 'Already have an account? Sign in' : 'New to YBuy? Create an account'}
          </Button>
        </form>
        <p className="mt-5 flex items-start justify-center gap-2 border-t border-app pt-4 text-center text-xs leading-relaxed text-sec">
          <LockKeyhole size={16} aria-hidden="true" className="shrink-0" />
          <span>Authentication is handled by Supabase. Bookings and saved items stay with their original account.</span>
        </p>
      </div>
    </dialog>
  );
}
