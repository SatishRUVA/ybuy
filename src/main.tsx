import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const isPreviewOne = import.meta.env.DEV && window.location.pathname.startsWith('/preview-1');
const previewModulePath = '/src/preview-1/PreviewApp.tsx';
const RootApp = import.meta.env.VITE_SITE_VARIANT === 'admin'
  ? lazy(() => import('./admin/App'))
  : isPreviewOne
  ? lazy(() => import(/* @vite-ignore */ previewModulePath))
  : import.meta.env.VITE_SITE_VARIANT === 'main'
    ? lazy(() => import('./main-site/App'))
    : lazy(() => import('./App'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  </StrictMode>
);
