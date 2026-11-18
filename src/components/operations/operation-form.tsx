import { useId, useState, type ReactNode } from 'react';
import { Alert, Button } from '@/components/ui';
import { fieldClass, textareaClass } from '@/components/form-classes';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/shadcn/dialog';
import { Dropdown } from '@/components/shadcn/select';

export function OperationDialog({ title, description, open, onClose, onSave, children }: {
  title: string; description: string; open: boolean; onClose: () => void;
  onSave: (data: FormData) => Promise<void>; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) { setError(null); onClose(); } }}>
      <DialogContent className="admin-operation-dialog">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="admin-operation-form mt-4" aria-busy={busy} onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError(null);
          try { await onSave(data); onClose(); }
          catch (e) { setError(e instanceof Error ? e.message : 'Operation failed. Please try again.'); }
          finally { setBusy(false); }
        }}>
          <fieldset disabled={busy} className="space-y-4">{children}</fieldset>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-col-reverse gap-3 border-t border-app pt-4 sm:flex-row sm:justify-end">
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
  return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span><input name={name} type={type} required={required} defaultValue={value} min={min} max={max} step={step} maxLength={maxLength} className={fieldClass()} /></label>;
}

export function LongField({ name, label, required = true, value, maxLength = 4000 }: {
  name: string; label: string; required?: boolean; value?: string; maxLength?: number;
}) {
  return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span><textarea name={name} required={required} defaultValue={value} maxLength={maxLength} rows={4} className={textareaClass()} /></label>;
}

export function ChoiceField({ name, label, options, value }: {
  name: string; label: string; options: readonly string[]; value?: string;
}) {
  const id = useId();
  const [selected, setSelected] = useState(value ?? options[0] ?? '');
  return <div className="grid gap-1.5 text-sm font-medium"><label htmlFor={id}>{label}</label>
    <Dropdown id={id} name={name} value={selected} onChange={setSelected}
      options={options.map((option) => ({ value: option, label: option.replace(/_/g, ' ') }))} />
  </div>;
}
