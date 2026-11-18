export async function verifyWebhookSignature(
  secret: string, eventId: string, timestamp: string, signature: string, body: string,
): Promise<boolean> {
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const encoded = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
    const key = await crypto.subtle.importKey('raw',
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const payload = new TextEncoder().encode(`${eventId}.${timestamp}.${body}`);
    for (const entry of signature.split(' ')) {
      const [version, value] = entry.split(',', 2);
      if (version !== 'v1' || !value) continue;
      try {
        const digest = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
        if (await crypto.subtle.verify('HMAC', key, digest, payload)) return true;
      } catch {
        // A malformed candidate must not prevent checking other rotated signatures.
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}
