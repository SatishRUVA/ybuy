import type { ReactNode } from 'react';
import { useAuth } from '@/auth-context';
import { EmptyState } from '@/main-site/components/ui';
import { Skeleton } from '@/main-site/components/skeleton';
import { LOCAL_PROFILE_LOGIN } from '@/lib/local-profile-login';
import { LogIn } from 'lucide-react';

// Client-side gate for UX only - RLS is the real authorization boundary for all data access.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, openSignIn } = useAuth();

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" rounded="rounded-card-lg" />
        <Skeleton className="h-24 w-full" rounded="rounded-card-lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 animate-fade-in">
        <EmptyState
          icon={<LogIn size={20} />}
          title={LOCAL_PROFILE_LOGIN ? 'Choose a profile to continue' : 'Sign in to continue'}
          description={LOCAL_PROFILE_LOGIN ? 'Select an account from the Tester dropdown above to continue.' : 'Sign in or create an account to continue.'}
          actionLabel={LOCAL_PROFILE_LOGIN ? undefined : 'Sign in or create an account'}
          onAction={openSignIn}
        />
      </div>
    );
  }

  return <>{children}</>;
}
