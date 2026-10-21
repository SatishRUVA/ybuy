export type AuthProviderId = 'google' | 'facebook' | 'apple';

export const AUTH_PROVIDER_LABELS: Record<AuthProviderId, string> = {
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
};

const KNOWN: AuthProviderId[] = ['google', 'facebook', 'apple'];

// Google is always offered. Facebook and Apple appear only when listed in VITE_AUTH_PROVIDERS
// (e.g. "google,facebook,apple") - set it after enabling that provider in Supabase, otherwise
// the button would lead to a "provider is not enabled" error.
export const ENABLED_AUTH_PROVIDERS: AuthProviderId[] = (() => {
  const configured = String(import.meta.env.VITE_AUTH_PROVIDERS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is AuthProviderId => (KNOWN as string[]).includes(value));
  return KNOWN.filter((provider) => provider === 'google' || configured.includes(provider));
})();

export function authProviderLabel(provider: string | undefined): string {
  return provider && provider in AUTH_PROVIDER_LABELS ? AUTH_PROVIDER_LABELS[provider as AuthProviderId] : 'your account';
}
