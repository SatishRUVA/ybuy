import { escapeHtml } from '../_shared/notification-email.ts';

export const TEST_BACKEND = 'https://jzyjmsixfuwzfnntewqn.supabase.co';
export const TEST_APP = 'https://ybuy-e2e-test.vercel.app';
export const TEST_INBOX = 'satish.babu1777@gmail.com';

export interface AuthEmailEvent {
  user: { email: string; new_email?: string };
  email_data: {
    email_action_type: string; token: string; token_hash: string;
    token_new?: string; token_hash_new?: string; redirect_to?: string;
  };
}

export function renderTestAuthEmails(event: AuthEmailEvent) {
  const subjects: Record<string, string> = {
    signup: 'Confirm your YBuy test account', recovery: 'Reset your YBuy test password',
    magiclink: 'Sign in to YBuy test', invite: 'Your YBuy test invitation',
    email_change: 'Confirm your YBuy test email change', reauthentication: 'Verify your YBuy test identity',
  };
  const data = event.email_data;
  const codeOnly = data?.email_action_type === 'reauthentication';
  const subject = subjects[data?.email_action_type];
  if (!subject || typeof event.user?.email !== 'string' || !event.user.email.includes('@')) {
    throw new Error('Unsupported or invalid Auth email event.');
  }
  const redirect = new URL(data.redirect_to || '/', TEST_APP);
  if (redirect.origin !== TEST_APP || redirect.username || redirect.password) {
    throw new Error('Auth email redirect must stay on the isolated test site.');
  }
  const recipients = data.email_action_type === 'email_change'
    ? [
      ...(data.token_hash_new ? [{ actor: event.user.email, hash: data.token_hash_new, token: data.token }] : []),
      { actor: event.user.new_email, hash: data.token_hash, token: data.token_new || data.token },
    ]
    : [{ actor: event.user.email, hash: data.token_hash, token: data.token }];
  return recipients.map(({ actor, hash, token }) => {
    if (typeof actor !== 'string' || !actor.includes('@') || (!codeOnly &&
      (typeof hash !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(hash))) ||
      typeof token !== 'string' || !/^\d{6,10}$/.test(token)) {
      throw new Error('Auth email is missing a valid recipient or verification token.');
    }
    const url = new URL('/auth/v1/verify', TEST_BACKEND);
    url.searchParams.set('token', hash);
    url.searchParams.set('type', data.email_action_type);
    url.searchParams.set('redirect_to', redirect.toString());
    const instruction = codeOnly ? 'Enter this verification code in the YBuy action that requested it.' : url.toString();
    const actionHtml = codeOnly
      ? '<p>Enter this verification code in the YBuy action that requested it.</p>'
      : `<p><a href="${escapeHtml(url.toString())}" style="display:inline-block;padding:12px 18px;background:#147d55;color:white;border-radius:8px">Continue verification</a></p>`;
    const text = `TEST ENVIRONMENT\n${subject}\nAccount: ${actor}\nAction: ${data.email_action_type}\nVerification code: ${token}\n\n${instruction}\n\nAll test emails are redirected to the designated test inbox. Do not forward this private, single-use verification.`;
    return {
      to: TEST_INBOX, subject: `[YBuy TEST] ${subject}`, text,
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body style="font-family:Arial,sans-serif;background:#f5f7f6;padding:24px;color:#18211d"><main style="max-width:560px;margin:auto;background:#fff;padding:28px;border-radius:12px"><h1 style="color:#147d55">YBuy Test</h1><h2>${escapeHtml(subject)}</h2><p>TEST ENVIRONMENT: all test mail is redirected to the designated test inbox.</p><p>Account: <strong>${escapeHtml(actor)}</strong></p><p>Action: ${escapeHtml(data.email_action_type)}</p><p>Verification code: <strong>${escapeHtml(token)}</strong></p>${actionHtml}<p>This private, single-use verification must not be forwarded.</p></main></body></html>`,
    };
  });
}
