import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const PreviewApp = lazy(() => import('./preview/PreviewApp'));
const PreviewOneApp = lazy(() => import('./preview-1/PreviewApp'));
const isPreviewOne = window.location.pathname === '/preview-1' || window.location.pathname.startsWith('/preview-1/');
const isPreview = window.location.pathname.startsWith('/preview');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPreviewOne ? <Suspense fallback={null}><PreviewOneApp /></Suspense> : isPreview ? <Suspense fallback={null}><PreviewApp /></Suspense> : <App />}
  </StrictMode>
);
