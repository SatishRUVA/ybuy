import { expect, test } from '@playwright/test';
import { renderNotificationEmail } from '../supabase/functions/_shared/notification-email';

test('renders a branded plain-text and HTML email with an escaped safe link', () => {
  const email = renderNotificationEmail({
    subject: '<Booking confirmed>',
    body: 'Rental is ready & waiting.',
    destination: '/messages/123e4567-e89b-12d3-a456-426614174000',
  }, 'https://ybuy.example');

  expect(email.subject).toBe('<Booking confirmed>');
  expect(email.text).toContain('https://ybuy.example/messages/123e4567-e89b-12d3-a456-426614174000');
  expect(email.html).toContain('&lt;Booking confirmed&gt;');
  expect(email.html).toContain('Rental is ready &amp; waiting.');
  expect(email.html).not.toContain('<Booking confirmed>');
});

test('detailed test emails identify the actor and escape booking details in HTML and keep a text alternative', () => {
  const email = renderNotificationEmail({
    subject: 'Deposit refunded', body: 'Your deposit refund was verified.',
    destination: '/confirmation/123e4567-e89b-12d3-a456-426614174000',
    testActor: 'renter1@example.test',
    details: [{ label: 'Item', value: '<Camera & Lens>' }, { label: 'Deposit refund', value: 'USD 50.00 - succeeded' }],
  }, 'https://ybuy-e2e-test.vercel.app');
  expect(email.subject).toBe('[YBuy TEST] Deposit refunded');
  expect(email.html).toContain('renter1@example.test');
  expect(email.html).toContain('&lt;Camera &amp; Lens&gt;');
  expect(email.html).not.toContain('<Camera & Lens>');
  expect(email.text).toContain('Deposit refund: USD 50.00 - succeeded');
  expect(email.html).toContain('https://ybuy-e2e-test.vercel.app/confirmation/');
});

test('rejects external and non-secure production links', () => {
  expect(() => renderNotificationEmail({
    subject: 'Update',
    body: 'Open your account.',
    destination: '//attacker.example',
  }, 'https://ybuy.example')).toThrow('safe in-app path');

  expect(() => renderNotificationEmail({
    subject: 'Update',
    body: 'Open your account.',
    destination: '/profile',
  }, 'http://ybuy.example')).toThrow('must use HTTPS');
});
