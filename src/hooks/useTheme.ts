import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createElement } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export const ACCENT_PRESETS = [
  { name: 'Blau',       value: '#4A6FA5' },
  { name: 'Dunkelblau', value: '#1E3A5F' },
  { name: 'Grün',       value: '#2D7A4F' },
  { name: 'Teal',       value: '#0F766E' },
  { name: 'Lila',       value: '#6B46C1' },
  { name: 'Rot',        value: '#C0392B' },
  { name: 'Orange',     value: '#D4651A' },
  { name: 'Pink',       value: '#B5438A' },
] as const;

export const DEFAULT_ACCENT = '#4A6FA5';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: string;
  setAccent: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
});

function getSystemPref(): 'light' | 'dark' {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? getSystemPref() : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function applyAccent(color: string): void {
  document.documentElement.style.setProperty('--accent', color);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem('theme') as Theme) ?? 'system'; }
    catch { return 'system'; }
  });

  const [accent, setAccentState] = useState<string>(() => {
    try { return localStorage.getItem('finance-accent') ?? DEFAULT_ACCENT; }
    catch { return DEFAULT_ACCENT; }
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem('theme', t); } catch { /* ignore */ }
    applyTheme(t);
  };

  const setAccent = (color: string) => {
    setAccentState(color);
    try { localStorage.setItem('finance-accent', color); } catch { /* ignore */ }
    applyAccent(color);
  };

  // Apply on mount
  useEffect(() => {
    applyTheme(theme);
    applyAccent(accent);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for system pref changes when mode is 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return createElement(ThemeContext.Provider, { value: { theme, setTheme, accent, setAccent } }, children);
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
