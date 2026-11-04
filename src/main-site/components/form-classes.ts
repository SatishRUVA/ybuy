/**
 * Shared form-control skins. Kept out of `ui.tsx` so that file exports components only
 * (react-refresh requirement). Import alongside `Field` from `@/components/ui`.
 */
const FIELD_BASE =
  'w-full min-w-0 max-w-full bg-card border border-strong rounded-card text-base sm:text-sm text-main placeholder:text-muted ' +
  'outline-none transition-[border-color,box-shadow] duration-fast ease-out ' +
  'focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-[var(--error)]';

export const fieldClass = (extra = '') => `${FIELD_BASE} px-3 h-11 ${extra}`;
export const textareaClass = (extra = '') => `${FIELD_BASE} min-h-28 px-3 py-2.5 resize-y ${extra}`;
