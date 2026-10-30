export interface NotificationEmail {
  subject: string;
  body: string;
  destination: string;
  details?: { label: string; value: string }[];
  testActor?: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

export function renderNotificationEmail(
  notification: NotificationEmail,
  appUrl: string,
): { subject: string; text: string; html: string } {
  const base = new URL(appUrl);
  if (!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(notification.destination)) {
    throw new Error('Notification destination must be a safe in-app path.');
  }
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('PUBLIC_APP_URL must use HTTP or HTTPS.');
  if (base.protocol === 'http:' && base.hostname !== 'localhost') {
    throw new Error('PUBLIC_APP_URL must use HTTPS outside local development.');
  }

  const link = new URL(notification.destination, base);
  const subject = notification.subject.replace(/[\r\n]+/g, ' ').slice(0, 160);
  const body = notification.body.slice(0, 500);
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(body);
  const safeLink = escapeHtml(link.toString());
  const details = (notification.details ?? []).slice(0, 24).map(({ label, value }) => ({
    label: String(label).slice(0, 80), value: String(value).slice(0, 300),
  }));
  const detailsText = details.map(({ label, value }) => `${label}: ${value}`).join('\n');
  const detailsHtml = details.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-top:1px solid #e3e9e5">${details.map(({ label, value }) => `<tr><td style="padding:10px 8px 10px 0;border-bottom:1px solid #e3e9e5;color:#526159;vertical-align:top">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e3e9e5;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table>` : '';
  const testText = notification.testActor ? `TEST ENVIRONMENT - notification for ${notification.testActor.slice(0, 254)}. All test mail is redirected to the designated test inbox.\n\n` : '';
  const testHtml = testText ? `<p style="padding:12px;background:#fff3cd;color:#604b00;font-size:13px;line-height:1.5">${escapeHtml(testText)}</p>` : '';

  return {
    subject: notification.testActor ? `[YBuy TEST] ${subject}` : subject,
    text: `${testText}${body}\n\n${detailsText ? `${detailsText}\n\n` : ''}Open YBuy: ${link.toString()}\n\nYou received this email because of your YBuy notification settings.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubject}</title></head><body style="margin:0;background:#f5f7f6;font-family:Arial,sans-serif;color:#18211d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e3e9e5;border-radius:12px"><tr><td style="padding:28px"><p style="margin:0 0 20px;color:#147d55;font-size:20px;font-weight:700">YBuy</p>${testHtml}<h1 style="margin:0 0 12px;font-size:22px;line-height:1.35">${safeSubject}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6">${safeBody}</p>${detailsHtml}<a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#147d55;color:#fff;text-decoration:none;font-weight:700">Open YBuy</a><p style="margin:24px 0 0;color:#68756e;font-size:12px;line-height:1.5">You received this email because of your YBuy notification settings.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
