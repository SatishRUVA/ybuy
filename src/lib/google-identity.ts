/**
 * Wraps Google Identity Services (script tag in index.html) to get a Google ID token without
 * redirecting through Supabase's own auth domain. Avoids Google's consent screen showing
 * "<project>.supabase.co" (Supabase custom domains require a paid plan) — the prompt shows this
 * app's own origin instead. The resulting ID token is handed to
 * `supabase.auth.signInWithIdToken`, so session/RLS handling downstream is unchanged.
 */

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleNotification {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
}

interface GoogleIdentityAccounts {
  id: {
    initialize: (config: {
      client_id: string;
      ux_mode?: 'popup' | 'redirect';
      callback: (response: GoogleCredentialResponse) => void;
    }) => void;
    renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    prompt: (momentListener?: (notification: GoogleNotification) => void) => void;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleIdentityAccounts };
  }
}

let initialized = false;
let hiddenButtonHost: HTMLDivElement | null = null;

function waitForGis(): Promise<void> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const timer = setInterval(() => {
      if (window.google?.accounts?.id) { clearInterval(timer); resolve(); }
    }, 50);
  });
}

/** Sets up GIS once; `onToken` fires with the signed ID token whenever a user completes sign-in. */
export async function initGoogleIdentity(clientId: string, onToken: (idToken: string) => void) {
  if (initialized) return;
  initialized = true; // set synchronously — guards against React StrictMode's dev double-invoke
  await waitForGis();
  window.google!.accounts.id.initialize({
    client_id: clientId,
    ux_mode: 'popup',
    callback: (response) => onToken(response.credential),
  });

  // Render Google's real, Google-branded button into an off-screen host — only used as a
  // fallback (opens a real popup window) when the in-page One Tap prompt below can't be shown.
  hiddenButtonHost = document.createElement('div');
  hiddenButtonHost.style.position = 'fixed';
  hiddenButtonHost.style.top = '-9999px';
  hiddenButtonHost.style.left = '-9999px';
  document.body.appendChild(hiddenButtonHost);
  window.google!.accounts.id.renderButton(hiddenButtonHost, { type: 'standard' });
}

/** Opens Google's One Tap prompt (an in-page card, not a new window); falls back to the real
 *  popup button only if One Tap can't be displayed (e.g. dismissed recently, cookies blocked). */
export function triggerGoogleSignIn() {
  const clickFallbackButton = () => hiddenButtonHost?.querySelector<HTMLElement>('div[role="button"]')?.click();
  if (!window.google?.accounts?.id) {
    // GIS script/init may still be in flight on a slow connection — retry shortly once.
    setTimeout(() => triggerGoogleSignIn(), 300);
    return;
  }
  window.google.accounts.id.prompt((notification) => {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) clickFallbackButton();
  });
}
