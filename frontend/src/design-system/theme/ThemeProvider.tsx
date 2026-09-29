import React, { useEffect, useState, useCallback } from 'react';
import { type Theme, ThemeContext } from './useTheme';
import { refreshTokens } from './tokenReader';
import { TOKEN_FALLBACKS } from './tokens.generated';

function getInitialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme') as Theme | null;
    if (attr === 'night' || attr === 'terminal') {
      return attr;
    }
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('runway_theme') as Theme | null;
    if (stored === 'night' || stored === 'terminal') {
      return stored;
    }
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'night';
  }
  return 'terminal';
}

const SUNLIGHT_KEY = 'runway_sunlight';

function getInitialSunlight(): boolean {
  try {
    return localStorage.getItem(SUNLIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

function applySunlight(on: boolean) {
  if (typeof document === 'undefined') return;
  if (on) {
    document.documentElement.setAttribute('data-contrast', 'high');
  } else {
    document.documentElement.removeAttribute('data-contrast');
  }
  refreshTokens();
  document.dispatchEvent(new CustomEvent('runway:themechange', { detail: { sunlight: on } }));
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      TOKEN_FALLBACKS[theme === 'night' ? '--theme-color-night' : '--theme-color-terminal']
    );
  }
  refreshTokens();
  document.dispatchEvent(new CustomEvent('runway:themechange', { detail: { theme } }));
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [sunlight, setSunlightState] = useState<boolean>(getInitialSunlight);

  const setSunlight = useCallback((on: boolean) => {
    setSunlightState(on);
    try {
      localStorage.setItem(SUNLIGHT_KEY, on ? '1' : '0');
    } catch {
      // Blocked storage only loses persistence, the mode still applies for this session.
    }
  }, []);

  useEffect(() => {
    applySunlight(sunlight);
  }, [sunlight]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('runway_theme', newTheme);
    }
    applyTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'night' ? 'terminal' : 'night');
  }, [theme, setTheme]);

  useEffect(() => {
    // Sync with system preferences only if localStorage is not set
    if (typeof localStorage !== 'undefined' && localStorage.getItem('runway_theme')) {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const systemTheme: Theme = e.matches ? 'night' : 'terminal';
      setThemeState(systemTheme);
      applyTheme(systemTheme);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, sunlight, setSunlight }}>
      {children}
    </ThemeContext.Provider>
  );
};
