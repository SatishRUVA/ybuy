import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const variant = import.meta.env.VITE_SITE_VARIANT;
const adminPath = /^\/(?:admin|super-admin)(?:\/|$)/.test(window.location.pathname);
const RootApp = variant === 'admin' || (variant === 'combined' && adminPath)
  ? lazy(() => import('./admin/App'))
  : lazy(() => import('./main-site/App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  </StrictMode>
);
