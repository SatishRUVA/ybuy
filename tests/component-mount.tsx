import { createElement, type ElementType } from 'react';
import { createRoot } from 'react-dom/client';

export { createElement };

export function mountComponent(component: ElementType, props: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  createRoot(container).render(createElement(component, props));
}
