import { useId, useState, type ReactNode } from 'react';
import { Alert, Button } from '@/main-site/components/ui';
import { fieldClass, textareaClass } from '@/main-site/components/form-classes';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/main-site/components/shadcn/dialog';

export function OperationDialog({ title, description, open, onClose, onSave, children }: {
  title: string; description: string; open: boolean; onClose: () => void;
  onSave: (data: FormData) => Promise<void>; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) { setError(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="space-y-4 mt-4" onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError(null);
          try { await onSave(data); onClose(); }
          catch (e) { setError(e instanceof Error ? e.message : 'Operation failed. Please try again.'); }
          finally { setBusy(false); }
        }}>
          {children}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setError(null); onClose(); }}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TextField({ name, label, required = true, value, type = 'text', min, max, step, maxLength = 200 }: {
  name: string; label: string; required?: boolean; value?: string | number; type?: string;
  min?: number; max?: number; step?: string; maxLength?: number;
}) {
  return <label className="block text-sm font-semibold text-main">{label}<input name={name} type={type} required={required} defaultValue={value} min={min} max={max} step={step} maxLength={maxLength} className={fieldClass('mt-1 font-normal')} /></label>;
}

export function LongField({ name, label, required = true, value, maxLength = 4000 }: {
  name: string; label: string; required?: boolean; value?: string; maxLength?: number;
}) {
  return <label className="block text-sm font-semibold text-main">{label}<textarea name={name} required={required} defaultValue={value} maxLength={maxLength} rows={4} className={textareaClass('mt-1 font-normal')} /></label>;
}

export function ChoiceField({ name, label, options, value }: {
  name: string; label: string; options: readonly string[]; value?: string;
}) {
  const id = useId();
  return <div><label htmlFor={id} className="block text-sm font-semibold text-main">{label}</label><select id={id} name={name} defaultValue={value} className={fieldClass('mt-1 font-normal')}>{options.map((option) => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}</select></div>;
}
