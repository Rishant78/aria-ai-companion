import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'companion-theme';

function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch {
    // Ignore storage errors (private browsing, etc.)
  }
  return 'system';
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return mode;
}

function applyThemeToDom(mode: ThemeMode, resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-resolved-theme', resolved);

  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = mode === 'system' ? 'light dark' : mode;
  }
}

export interface UseThemeResult {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemPrefersDark());

  // Listen to system prefers-color-scheme changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };

    if (media.addEventListener) {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    // Fallback for older environments
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  // Listen to cross-tab localStorage changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        const nextTheme = getStoredTheme();
        setThemeState(nextTheme);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolvedTheme = resolveTheme(theme, systemDark);

  // Apply to DOM whenever theme or system preference changes
  useEffect(() => {
    applyThemeToDom(theme, resolvedTheme);
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((nextMode: ThemeMode) => {
    setThemeState(nextMode);
    try {
      if (nextMode === 'system') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, nextMode);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleTheme = useCallback(() => {
    // Cycle: system -> light -> dark -> system
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
  }, [theme, setTheme]);

  return {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
  };
}
