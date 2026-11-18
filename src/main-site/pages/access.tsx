import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/main-site/components/ui';
import { BrandLogo } from '@/main-site/components/brand-logo';

function getRedirectTarget(): string {
  const params = new URLSearchParams(window.location.search);
  const target = params.get('redirect');
  // Never redirect off-site — only allow a same-origin path back into the app.
  if (target && target.startsWith('/') && !target.startsWith('//')) return target;
  return '/';
}

/**
 * Temporary PROD-only site-wide access gate. Reached only via the edge middleware redirect —
 * this page itself never grants access; it just collects a code and asks the server to verify it.
 */
export function AccessPage() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === '1') {
      setError('Your security session has expired. Enter a new code to continue.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length !== 6 || status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        setStatus('error');
        setError('Invalid verification code. Please try again.');
        setCode('');
        inputRef.current?.focus();
        return;
      }
      // Full navigation (not client-side routing) so the freshly-set cookie is sent on the next request.
      window.location.assign(getRedirectTarget());
    } catch {
      setStatus('error');
      setError('Invalid verification code. Please try again.');
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-app px-4 py-8">
      <div className="w-full max-w-sm bg-card border border-app rounded-card-xl shadow-card p-6 sm:p-8 animate-fade-in">
        <div className="flex items-center gap-2.5">
          <BrandLogo />
        </div>

        <h1 className="mt-6 text-xl font-bold text-main font-display">Welcome to YBuy</h1>
        <p className="mt-1.5 text-sm text-sec leading-relaxed">Enter your security code to continue.</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-3">
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (status === 'error') setStatus('idle');
            }}
            className="w-full min-w-0 h-12 px-4 rounded-card border border-strong bg-card text-center text-lg tracking-[0.25em] placeholder:tracking-normal text-main focus:border-accent"
            aria-label="Security code"
            aria-invalid={status === 'error'}
          />
          {error && <p role="alert" className="text-xs text-error">{error}</p>}
          <Button
            type="submit"
            fullWidth
            size="lg"
            disabled={code.length !== 6}
            loading={status === 'submitting'}
            icon={<ShieldCheck size={16} />}
          >
            Continue
          </Button>
        </form>

        <p className="mt-5 text-xs text-muted text-center">Your security session lasts 2 hours.</p>
      </div>
    </div>
  );
}
