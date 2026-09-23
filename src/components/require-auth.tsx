import type { ReactNode } from 'react';
import { useAuth } from '@/auth-context';
import { LogIn } from 'lucide-react';

// Client-side gate for UX only — RLS is the real authorization boundary for all data access.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, signInWithGoogle } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-sec">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 px-4 text-center animate-fade-in">
        <div className="w-14 h-14 rounded-full bg-accent-soft flex items-center justify-center">
          <LogIn size={22} className="text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-main">Sign in to continue</h2>
          <p className="text-sm text-sec mt-1">You need a Google account to access this page.</p>
        </div>
        <button
          onClick={() => void signInWithGoogle()}
          className="px-5 py-2.5 rounded-card-lg bg-accent text-accent-text font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
