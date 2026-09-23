import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { initGoogleIdentity, triggerGoogleSignIn } from '@/lib/google-identity';

export type ActiveRole = 'renter' | 'owner';

export interface RoleState {
  ownerListingsCount: number;
  ownerBookingsCount: number;
  renterBookingsCount: number;
  hasOwnerRole: boolean;
  hasRenterRole: boolean;
  isMultiRole: boolean;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  location: string | null;
  created_at: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  roleState: RoleState | null;
  activeRole: ActiveRole;
  setActiveRole: (role: ActiveRole) => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_ROLE_STORAGE_KEY = 'ybuy-active-role';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roleState, setRoleState] = useState<RoleState | null>(null);
  const [activeRole, setActiveRoleState] = useState<ActiveRole>(() => {
    if (typeof localStorage === 'undefined') return 'renter';
    const stored = localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY);
    return stored === 'owner' ? 'owner' : 'renter';
  });
  const [loading, setLoading] = useState(true);

  function setActiveRole(role: ActiveRole) {
    setActiveRoleState(role);
    if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId) { console.error('VITE_GOOGLE_CLIENT_ID is not set — Google sign-in is disabled.'); return; }
    void initGoogleIdentity(clientId, async (idToken) => {
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
      if (error) console.error('Google sign-in failed:', error.message);
    });
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setProfile(null);
      setRoleState(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('listings').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('renter_id', userId),
    ]).then(([profileResult, ownerListingsResult, ownerBookingsResult, renterBookingsResult]) => {
      if (cancelled) return;
      setProfile((profileResult.data as Profile) ?? null);
      const nextRoleState: RoleState = {
        ownerListingsCount: ownerListingsResult.count ?? 0,
        ownerBookingsCount: ownerBookingsResult.count ?? 0,
        renterBookingsCount: renterBookingsResult.count ?? 0,
        hasOwnerRole: (ownerListingsResult.count ?? 0) > 0 || (ownerBookingsResult.count ?? 0) > 0,
        hasRenterRole: (renterBookingsResult.count ?? 0) > 0,
        isMultiRole: (((ownerListingsResult.count ?? 0) > 0 || (ownerBookingsResult.count ?? 0) > 0) && (renterBookingsResult.count ?? 0) > 0),
      };
      setRoleState(nextRoleState);

      if (nextRoleState.isMultiRole) return;
      if (nextRoleState.hasOwnerRole) {
        setActiveRole('owner');
        return;
      }
      setActiveRole('renter');
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const signInWithGoogle = async () => {
    triggerGoogleSignIn();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, loading, roleState, activeRole, setActiveRole, signInWithGoogle, signOut }}
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
