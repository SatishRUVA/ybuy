import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const isPreviewOne = import.meta.env.DEV && window.location.pathname.startsWith('/preview-1');
const previewModulePath = '/src/preview-1/PreviewApp.tsx';
const RootApp = isPreviewOne
  ? lazy(() => import(/* @vite-ignore */ previewModulePath))
  : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  </StrictMode>
);
