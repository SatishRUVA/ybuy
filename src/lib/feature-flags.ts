// Part 1 keeps out-of-scope and prototype-only features hard-disabled.
export const SHOW_OUT_OF_SCOPE_PAGES = false;

// Keep demo theme switcher disabled in Part 1 builds.
export const SHOW_DEMO_THEMES = false;

export const SHOW_HERO_CATEGORY_PILLS = import.meta.env.VITE_SHOW_HERO_CATEGORY_PILLS === 'true';

export const OUT_OF_SCOPE_ROUTES = new Set([
  'item-passport',
  'protection',
]);
