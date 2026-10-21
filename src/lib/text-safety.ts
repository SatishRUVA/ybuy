// Shared input safety checks for every free-text field that is stored.
//
// Script injection: free text is plain text. Tags, script URLs and control characters are
// rejected (never silently "cleaned") so what a user sees is exactly what is stored and shown.
// React also escapes text on output, and the database repeats these rules in a trigger
// (supabase/migrations/20261018000003_text_input_validation.sql) because the browser can be bypassed.
//
// SQL injection: not handled by filtering words. All queries go through supabase-js (PostgREST),
// which sends values as parameters, and the SQL functions take typed arguments. The one place
// values are spliced into a string is PostgREST's `.or()` filter grammar; those values are either
// UUIDs (assertUuid) or stripped of grammar characters (sanitizeFilterValue).

// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
export const UNSAFE_TEXT = /<\s*\/?\s*[a-z!?]|javascript\s*:|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/i;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max length for short stored text such as pickup address parts. */
export const PICKUP_TEXT_MAX = 200;

/** Returns a user-facing message when the text is too long or not plain text, otherwise null. */
export function plainTextError(label: string, value: string, max: number): string | null {
  if (value.length > max) return `${label} must be ${max.toLocaleString('en-US')} characters or fewer.`;
  if (UNSAFE_TEXT.test(value)) return `${label} can only contain plain text (no HTML tags, scripts or hidden characters).`;
  return null;
}

/** Thrown for input the user can fix; its message is safe and useful to show as-is. */
export class InputValidationError extends Error {}

export function assertPlainText(label: string, value: string, max: number): void {
  const message = plainTextError(label, value, max);
  if (message) throw new InputValidationError(message);
}

export function assertUuid(value: string, label = 'id'): string {
  if (!UUID_RE.test(value)) throw new InputValidationError(`Invalid ${label}.`);
  return value;
}

/** Removes characters that carry meaning in PostgREST filter strings (`,` `(` `)` `"` `\` `*` `%`). */
export function sanitizeFilterValue(value: string, max = 100): string {
  return value.replace(/[,()%"\\*]/g, '').trim().slice(0, max);
}
