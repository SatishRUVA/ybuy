import type { ReactNode } from 'react';
import { useAuth } from '@/auth-context';
import { EmptyState } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
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
          title="Sign in to continue"
          description="One account for renting and lending. Sign in or create your account to continue where you left off."
          actionLabel="Sign in or create an account"
          onAction={openSignIn}
        />
      </div>
    );
  }

  return <>{children}</>;
}
