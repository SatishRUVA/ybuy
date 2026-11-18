import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/auth-context';
import { Alert, Badge, Button, EmptyState } from '@/main-site/components/ui';
import { fieldClass } from '@/main-site/components/form-classes';
import { Card, CardContent, CardHeader, CardTitle } from '@/main-site/components/shadcn/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';
import { supabase } from '@/lib/supabase';
import { getVaultStatus, prepareVault, saveVaultEntry, type VaultEntry, type VaultStatus } from '@/lib/vault';
import { fmtDate } from '@/main-site/components/operations/query-utils';
import { PageHeader } from '@/main-site/components/operations/shared';

interface Enrollment { id: string; qrCode: string; secret: string }

export function VaultSection() {
  const { user } = useAuth();
  return <VaultChest key={user?.id} />;
}

function VaultChest() {
  const generation = useRef(0);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<VaultEntry | null>(null);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function lock() {
    generation.current += 1;
    setStatus(null);
    setTarget(null);
    setSecret('');
    setCode('');
    setNotice(null);
  }

  useEffect(() => {
    if (!status) return;
    const timeout = setTimeout(() => {
      generation.current += 1;
      setStatus(null);
      setTarget(null);
      setSecret('');
      setCode('');
      setNotice(null);
      setError('Vault access expired. Verify a new authenticator code to continue.');
    }, Math.max(0, Date.parse(status.expires_at) - Date.now()));
    return () => clearTimeout(timeout);
  }, [status]);

  async function prepareMfa() {
    setBusy(true);
    setError(null);
    try {
      await prepareVault();
      const { data, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const factor = data.totp.find((item) => item.status === 'verified');
      if (factor) {
        setFactorId(factor.id);
      } else {
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp', friendlyName: `YBuy Vault ${new Date().toISOString()}`, issuer: 'YBuy',
        });
        if (enrollError) throw enrollError;
        setEnrollment({ id: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret });
        setFactorId(enrolled.id);
      }
    } catch {
      setError('Could not prepare authenticator verification. Check your Super Admin session, install the vault backend migration and enable TOTP in Supabase Auth. No vault access was granted.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const { error: cancelError } = await supabase.auth.mfa.unenroll({ factorId: enrollment.id });
    if (cancelError) {
      setError('Could not cancel authenticator setup. Try again before starting another enrollment.');
    } else {
      setEnrollment(null);
      setFactorId(null);
      setCode('');
    }
    setBusy(false);
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    setCode('');
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) {
        setError('The authenticator code could not be verified. Use a current code and try again.');
        return;
      }
      setEnrollment(null);
      const result = await getVaultStatus();
      setStatus(result);
    } catch {
      setError('Vault access was not granted. Confirm the local vault migration is installed and that your account is an active Super Admin, then verify again.');
    } finally {
      setBusy(false);
    }
  }

  function closeEditor() {
    setTarget(null);
    setSecret('');
    setSaveError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const attempt = generation.current;
    setSaving(true);
    setSaveError(null);
    let stored = false;
    try {
      await saveVaultEntry(target, secret);
      stored = true;
      if (attempt !== generation.current) return;
      setSecret('');
      setTarget(null);
      const latest = await getVaultStatus();
      if (attempt !== generation.current) return;
      setStatus(latest);
      setNotice('Secret stored encrypted. Runtime integrations still use their existing environment configuration.');
    } catch (failure) {
      setSecret('');
      if (stored) {
        lock();
        setError('The secret was stored encrypted, but metadata could not be refreshed. Verify MFA again before making further changes.');
      } else {
        setSaveError(failure instanceof Error ? failure.message : 'The secret could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  }

  return <>
    <PageHeader title="Vault Chest" subtitle="Super Admin only. Authenticator verification is enforced by the server for every vault operation."
      action={status && <Button variant="secondary" icon={<Lock size={15} />} onClick={lock}>Lock vault</Button>} />
    <Alert tone="info" className="mb-4" title="Foundation only - no environment secrets have been moved">
      Values stored here are encrypted and cannot be revealed or copied back. Existing integrations still use their platform environment secrets.
      Supabase credentials, OAuth provider secrets and deployment-signing keys stay in their platform secret stores.
    </Alert>
    {error && <Alert tone="error" className="mb-4">{error}</Alert>}
    {!status ? <Card className="max-w-xl">
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck size={18} aria-hidden="true" />Unlock with MFA</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-sec">Use your personal authenticator app, not the shared site-access code. Vault access expires five minutes after verification.</p>
        {!factorId && <Button loading={busy} onClick={() => void prepareMfa()}>Set up or verify authenticator</Button>}
        {enrollment && <div className="space-y-3">
          <p className="text-sm text-sec">Add YBuy to your authenticator app. Keep this setup key private; it is shown only during enrollment.</p>
          <img className="h-48 w-48 bg-white p-2 rounded-card" src={enrollment.qrCode} alt="YBuy authenticator enrollment QR code" />
          <label className="block text-sm font-semibold text-main">Manual setup key
            <input className={fieldClass('mt-1 font-mono')} readOnly value={enrollment.secret} autoComplete="off" />
          </label>
          <Button variant="secondary" disabled={busy} onClick={() => void cancelEnrollment()}>Cancel setup</Button>
        </div>}
        {factorId && <form onSubmit={(event) => void unlock(event)} className="space-y-3">
          <label className="block text-sm font-semibold text-main">Authenticator security code
            <input className={fieldClass('mt-1 tracking-widest')} value={code} onChange={(event) => setCode(event.target.value)}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required
              aria-describedby="vault-code-help" />
          </label>
          <p id="vault-code-help" className="text-xs text-sec">Enter or paste the current six-digit code. Codes are never saved in the audit log.</p>
          <Button type="submit" loading={busy} disabled={!/^\d{6}$/.test(code)}>Verify and unlock</Button>
        </form>}
      </CardContent>
    </Card> : <>
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <p className="text-xs text-sec mb-4" role="status">MFA verified. Access expires {new Date(status.expires_at).toLocaleTimeString()}. Stored status applies only to this vault, not deployed environment values.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {status.entries.map((entry) => <Card key={entry.key}>
          <CardHeader><CardTitle><code className="text-sm break-all">{entry.key}</code></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Badge tone={entry.configured ? 'success' : 'neutral'}>{entry.configured ? 'Stored - value hidden' : 'Not stored in vault'}</Badge>
            {entry.updated_at && <p className="text-xs text-sec">Version {entry.version} - updated {fmtDate(entry.updated_at)}</p>}
            <div><Button size="sm" variant="secondary" onClick={() => { setTarget(entry); setNotice(null); setSaveError(null); }}>
              {entry.configured ? 'Replace secret' : 'Add secret'}
            </Button></div>
          </CardContent>
        </Card>)}
      </div>
      {!status.entries.length && <EmptyState title="No supported vault entries" description="The backend returned no supported integration slots." />}
    </>}
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !saving) closeEditor(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.configured ? 'Replace' : 'Add'} {target?.key}</DialogTitle>
          <DialogDescription>The new value is write-only. Saving does not rotate the provider credential or update runtime environments. The audit log records the key and version, never the submitted value.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-main">New secret value
            <input type="password" autoComplete="new-password" className={fieldClass('mt-1')} value={secret}
              onChange={(event) => setSecret(event.target.value)} minLength={8} maxLength={16384} required spellCheck={false} />
          </label>
          {saveError && <Alert tone="error">{saveError}</Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={saving} onClick={closeEditor}>Cancel</Button>
            <Button type="submit" loading={saving}>Store encrypted secret</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
