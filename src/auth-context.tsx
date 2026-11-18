import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { PROFILE_LOGIN, PROFILE_ENDPOINT } from '@/lib/local-profile-login';

export interface Profile {
  id: string;
  customer_id?: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  bio?: string | null;
  location: string | null;
  country_code?: string | null;
  state_region_code?: string | null;
  created_at: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signInOpen: boolean;
  passwordRecovery: boolean;
  authBusy: 'sign-in' | 'sign-out' | null;
  openSignIn: () => void;
  closeSignIn: () => void;
  authenticate: (email: string, password: string, fullName?: string) => Promise<'authenticated' | 'confirmation-required' | 'error'>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  finishPasswordReset: (password: string) => Promise<boolean>;
  signInWithGoogle: () => Promise<void>;
  selectLocalProfile: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authBusy, setAuthBusy] = useState<'sign-in' | 'sign-out' | null>(null);
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    let hadSession = false;
    const callbackUrl = new URL(window.location.href);
    const hashParams = new URLSearchParams(callbackUrl.hash.slice(1));
    if (callbackUrl.searchParams.has('error') || hashParams.has('error')) {
      setError('Sign-in was cancelled or could not be completed. Please try again.');
      for (const key of ['error', 'error_code', 'error_description']) {
        callbackUrl.searchParams.delete(key);
        hashParams.delete(key);
      }
      callbackUrl.hash = hashParams.toString();
      window.history.replaceState(null, '', callbackUrl);
    }

    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      if (event === 'INITIAL_SESSION' && authChanged) return;
      if (event !== 'INITIAL_SESSION') authChanged = true;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setSignInOpen(true);
      }
      setSessionError(null);
      if (event === 'SIGNED_OUT' && hadSession && !signingOut.current) {
        setError('Your session has expired or ended. Please sign in again.');
      } else if (newSession) {
        setError(null);
        if (event === 'SIGNED_IN') setSignInOpen(false);
      }
      if (!newSession) setVerifiedUserId(null);
      hadSession = Boolean(newSession);
      setSession(newSession);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!active || authChanged) return;
      if (sessionError) {
        console.error('Session restoration failed:', sessionError.message);
        setError('Could not restore your session. Please sign in again.');
      }
      hadSession = Boolean(sessionData.session);
      setSession(sessionData.session);
      setLoading(false);
    }).catch((err: unknown) => {
      if (!active || authChanged) return;
      console.error('Session restoration failed:', err);
      setError('Could not restore your session. Please sign in again.');
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function verifySession() {
      try {
        const { data, error: verificationError } = await supabase.rpc('has_active_session');
        if (cancelled) return;
        // PGRST202 = the function is not installed, i.e. migration 20261018000001 has not been applied.
        // Without it the database cannot check revocation either, so fall back to token expiry only
        // (still enforced here) rather than locking everyone out. Any other error stays a failure.
        const checkUnavailable = verificationError?.code === 'PGRST202';
        if (verificationError && !checkUnavailable) throw verificationError;
        if (checkUnavailable) console.warn('has_active_session is not installed; apply migration 20261018000001. Session revocation is not being checked.');
        if ((!checkUnavailable && data !== true) || !session?.expires_at || session.expires_at * 1000 <= Date.now()) {
          setVerifiedUserId(null);
          setSessionError('Your session has expired. Please sign in again.');
          return;
        }
        setVerifiedUserId(session.user.id);
        setSessionError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Session verification failed:', err);
        setVerifiedUserId(null);
        setSessionError(session?.expires_at && session.expires_at * 1000 > Date.now()
          ? 'Could not verify your session. Check your connection and refresh to try again.'
          : 'Your session has expired. Please sign in again.');
      }
    }
    void verifySession();
    const expiryTimer = window.setTimeout(() => {
      setVerifiedUserId(null);
      setSessionError('Your session has expired. Please sign in again.');
    }, Math.max(0, (session.expires_at ?? 0) * 1000 - Date.now()));
    function onVisible() {
      if (document.visibilityState === 'visible') void verifySession();
    }
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(expiryTimer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session]);

  useEffect(() => {
    const userId = session?.user.id;
    setProfile(null);
    setProfileError(null);
    if (!userId || verifiedUserId !== userId) return;
    let cancelled = false;
    async function loadProfile() {
      const viaRpc = await supabase.rpc('get_my_profile').single<Profile>();
      // Same migration-not-applied fallback as the session check above.
      if (viaRpc.error?.code !== 'PGRST202') return viaRpc;
      console.warn('get_my_profile is not installed; apply migration 20261018000001.');
      return supabase.from('profiles').select('*').eq('id', userId as string).single<Profile>();
    }
    loadProfile().then(({ data, error: profileError }) => {
      if (cancelled) return;
      if (profileError || !data || data.id !== userId) {
        console.error('Profile loading failed:', profileError?.message ?? 'Profile missing or mismatched.');
        setProfileError('Could not load your profile. Refresh the page to try again.');
        return;
      }
      setProfile(data);
    }).catch((err: unknown) => {
      if (cancelled) return;
      console.error('Profile loading failed:', err);
      setProfileError('Could not load your profile. Refresh the page to try again.');
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, verifiedUserId]);

  async function clearLocalSession() {
    if (!session) return;
    signingOut.current = true;
    const { error: switchError } = await supabase.auth.signOut({ scope: 'local' });
    if (switchError) throw new Error('Could not end your current YBuy session. Please sign out before switching accounts.');
    setSession(null);
    setProfile(null);
    setVerifiedUserId(null);
  }

  function authReturnUrl() {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    for (const key of ['code', 'error', 'error_code', 'error_description']) {
      url.searchParams.delete(key);
      hash.delete(key);
    }
    if (url.hash.includes('error=')) url.hash = hash.toString();
    return url.href;
  }

  const signInWithGoogle = async () => {
    if (authBusy) return;
    setAuthBusy('sign-in');
    setError(null);
    try {
      await clearLocalSession();
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authReturnUrl(),
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: true,
        },
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error('Google sign-in did not return an authorization URL.');
      window.location.assign(data.url);
    } catch (error) {
      console.error('Google sign-in failed:', error instanceof Error ? error.message : 'Unknown error');
      setError('Could not start Google sign-in. Please try again or use your YBuy email and password.');
    } finally {
      signingOut.current = false;
      setAuthBusy(null);
    }
  };

  const authenticate = async (email: string, password: string, fullName?: string): Promise<'authenticated' | 'confirmation-required' | 'error'> => {
    if (authBusy) return 'error';
    setAuthBusy('sign-in');
    setError(null);
    try {
      await clearLocalSession();
      const result = fullName === undefined
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: authReturnUrl() },
        });
      if (result.error) throw result.error;
      return result.data.session ? 'authenticated' : 'confirmation-required';
    } catch (err) {
      console.error('Email authentication failed:', err instanceof Error ? err.message : 'Unknown error');
      setError(fullName === undefined
        ? 'Could not sign in. Check your email and password, or confirm your email before trying again.'
        : 'Could not create your account. Check your details and try again.');
      return 'error';
    } finally {
      signingOut.current = false;
      setAuthBusy(null);
    }
  };

  async function selectLocalProfile(id: string) {
    if (authBusy) return;
    setAuthBusy('sign-in');
    setError(null);
    try {
      if (!PROFILE_LOGIN) throw new Error('Test profile selection is not enabled.');
      const response = await fetch(PROFILE_ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error : 'Could not select this test profile. Please retry.');
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('tokenHash' in data) || typeof data.tokenHash !== 'string') {
        throw new Error('Local sign-in returned an invalid response.');
      }
      await clearLocalSession();
      const result = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.tokenHash });
      if (result.error) throw result.error;
      if (!result.data.session || result.data.user?.id !== id) {
        throw new Error('Local sign-in did not return the selected account.');
      }
      setSignInOpen(false);
    } catch (err) {
      console.error('Local profile selection failed:', err instanceof Error ? err.message : 'Unknown error');
      setError(err instanceof Error ? err.message : 'Could not switch to this test profile. Please retry.');
    } finally {
      signingOut.current = false;
      setAuthBusy(null);
    }
  }

  async function requestPasswordReset(email: string): Promise<boolean> {
    setError(null);
    setAuthBusy('sign-in');
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: new URL('/', window.location.origin).href,
      });
      if (resetError) throw resetError;
      return true;
    } catch (err) {
      console.error('Password reset request failed:', err instanceof Error ? err.message : 'Unknown error');
      setError('Could not request a password reset. Check the email address and try again.');
      return false;
    } finally {
      setAuthBusy(null);
    }
  }

  async function finishPasswordReset(password: string): Promise<boolean> {
    setError(null);
    setAuthBusy('sign-in');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPasswordRecovery(false);
      setSignInOpen(false);
      return true;
    } catch (err) {
      console.error('Password update failed:', err instanceof Error ? err.message : 'Unknown error');
      setError('Could not update your password. Request a new reset link and try again.');
      return false;
    } finally {
      setAuthBusy(null);
    }
  }

  const signOut = async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setAuthBusy('sign-out');
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;
      setSession(null);
      setProfile(null);
      setVerifiedUserId(null);
    } catch (err) {
      console.error('Sign-out failed:', err);
      setError('Could not sign out. Please try again.');
    } finally {
      signingOut.current = false;
      setAuthBusy(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session, user: session?.user.id === verifiedUserId ? session.user : null,
        profile: profile?.id === session?.user.id && profile?.id === verifiedUserId ? profile : null,
        loading: loading || Boolean(session && !error && !sessionError && verifiedUserId !== session.user.id),
        error: error ?? sessionError ?? profileError, signInOpen, passwordRecovery, authBusy,
        openSignIn: () => setSignInOpen(true),
        closeSignIn: () => setSignInOpen(false),
        authenticate, requestPasswordReset, finishPasswordReset, signInWithGoogle, selectLocalProfile, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
