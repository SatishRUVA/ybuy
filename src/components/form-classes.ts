/**
 * Shared form-control skins. Kept out of `ui.tsx` so that file exports components only
 * (react-refresh requirement). Import alongside `Field` from `@/components/ui`.
 */
const FIELD_BASE =
  'w-full bg-card border border-strong rounded-card text-sm text-main placeholder:text-muted ' +
  'outline-none transition-[border-color,box-shadow] duration-fast ease-out ' +
  'focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)]';

export const fieldClass = (extra = '') => `${FIELD_BASE} px-3 h-11 ${extra}`;
export const textareaClass = (extra = '') => `${FIELD_BASE} px-3 py-2.5 resize-none ${extra}`;
