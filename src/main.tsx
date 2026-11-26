import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { LOCAL_PROFILE_LOGIN } from '@/lib/local-profile-login';

const variant = import.meta.env.VITE_SITE_VARIANT;
const adminPath = /^\/(?:admin|super-admin)(?:\/|$)/.test(window.location.pathname);
const RootApp = !LOCAL_PROFILE_LOGIN && (variant === 'admin' || (variant === 'combined' && adminPath))
  ? lazy(() => import('./admin/App'))
  : lazy(() => import('./main-site/App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  </StrictMode>
);
