import { expect, test } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { renderTestAuthEmails, TEST_APP, TEST_INBOX } from '../supabase/functions/send-test-auth-email/email';
import { verifyWebhookSignature } from '../supabase/functions/_shared/webhook-signature';

const event = {
  user: { email: 'renter1@example.test' },
  email_data: { email_action_type: 'signup', token: '123456', token_hash: 'abcdef123456', redirect_to: TEST_APP },
};

test('Auth emails use real verification links, detailed HTML, fixed inbox and escaped actor', () => {
  for (const action of ['signup', 'recovery', 'magiclink', 'invite']) {
    const [mail] = renderTestAuthEmails({ ...event, email_data: { ...event.email_data, email_action_type: action } });
    expect(mail.to).toBe(TEST_INBOX);
    expect(mail.html).toContain('renter1@example.test');
    expect(mail.html).toContain(`/auth/v1/verify?token=abcdef123456&amp;type=${action}`);
    expect(mail.text).toContain('123456');
  }
  const [escaped] = renderTestAuthEmails({ ...event, user: { email: '<test>@example.test' } });
  expect(escaped.html).not.toContain('<test>');
  const [codeOnly] = renderTestAuthEmails({ ...event,
    email_data: { ...event.email_data, email_action_type: 'reauthentication', token_hash: '' } });
  expect(codeOnly.html).toContain('123456');
  expect(codeOnly.html).not.toContain('/auth/v1/verify');
});

test('Auth email change preserves the documented old/new hash mapping', () => {
  const messages = renderTestAuthEmails({ user: { email: 'old@example.test', new_email: 'new@example.test' },
    email_data: { ...event.email_data, email_action_type: 'email_change', token_hash_new: 'oldhash', token_hash: 'newhash', token_new: '987654' } });
  expect(messages).toHaveLength(2);
  expect(messages[0].text).toContain('old@example.test');
  expect(messages[0].text).toContain('token=oldhash');
  expect(messages[1].text).toContain('new@example.test');
  expect(messages[1].text).toContain('token=newhash');
  expect(messages.every((message) => message.to === TEST_INBOX)).toBe(true);
});

test('Auth emails reject external redirects, unsupported actions and missing tokens', () => {
  for (const redirect_to of ['https://attacker.example', '//attacker.example', 'https://user:pass@ybuy-e2e-test.vercel.app']) {
    expect(() => renderTestAuthEmails({ ...event, email_data: { ...event.email_data, redirect_to } })).toThrow('redirect');
  }
  expect(() => renderTestAuthEmails({ ...event, email_data: { ...event.email_data, token_hash: '' } })).toThrow('token');
  expect(() => renderTestAuthEmails({ ...event, email_data: { ...event.email_data, email_action_type: 'unsupported' } })).toThrow('Unsupported');
});

test('Signed Auth and Resend hooks reject forged bodies and expired timestamps', async () => {
  const bytes = randomBytes(32);
  const secret = `whsec_${bytes.toString('base64')}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  const sign = (time: string) => `v1,${createHmac('sha256', bytes).update(`event-id.${time}.${body}`).digest('base64')}`;
  for (const encoded of [secret, `v1,${secret}`]) {
    expect(await verifyWebhookSignature(encoded, 'event-id', timestamp, sign(timestamp), body)).toBe(true);
    expect(await verifyWebhookSignature(encoded, 'event-id', timestamp, sign(timestamp), `${body} `)).toBe(false);
  }
  const expired = String(Number(timestamp) - 600);
  expect(await verifyWebhookSignature(secret, 'event-id', expired, sign(expired), body)).toBe(false);
  expect(await verifyWebhookSignature(secret, 'event-id', timestamp, 'v1,not-base64', body)).toBe(false);
});
