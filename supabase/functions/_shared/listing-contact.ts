export const CONTACT_PLACEHOLDER = '[contact info removed - message the owner in YBuy]';

export function hasListingAddress(text: string): boolean {
  return /\b\d{1,6}[ \t]+(?:[a-z0-9.-]+[ \t]+){1,6}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|terrace|ter|parkway|pkwy)\b|\bp\.?[ \t]*o\.?[ \t]*box[ \t]+\d+\b/i.test(text);
}

export function maskListingContact(text: string): string {
  return text
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, CONTACT_PLACEHOLDER)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, CONTACT_PLACEHOLDER);
}
