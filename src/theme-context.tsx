import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { themes, defaultTheme, type ThemeId, type Theme } from '@/themes';
import { SHOW_DEMO_THEMES } from '@/lib/feature-flags';

interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'rental-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    // Only honor a stored theme when the demo switcher is enabled; otherwise the app is
    // locked to the Ocean Green palette regardless of any stale localStorage value.
    if (SHOW_DEMO_THEMES && typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
      if (stored && themes.some((t) => t.id === stored)) return stored;
    }
    return defaultTheme;
  });

  const theme = themes.find((t) => t.id === themeId)!;

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value);
    }
    root.dataset.theme = theme.id;
    root.classList.toggle('dark', theme.dark);
    localStorage.setItem(STORAGE_KEY, theme.id);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themeId, setThemeId, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
