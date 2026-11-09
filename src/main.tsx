import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const RootApp = import.meta.env.VITE_SITE_VARIANT === 'admin'
  ? lazy(() => import('./admin/App'))
  : lazy(() => import('./main-site/App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  </StrictMode>
);
