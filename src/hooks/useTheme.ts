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

/** Background palettes. `forcesDark` palettes only read well as dark surfaces. */
export const PALETTES = [
  { id: 'default',  name: 'Standard',    desc: 'Neutrales Blaugrau',   swatch: '#111827', card: '#1f2937', forcesDark: false },
  { id: 'mono',     name: 'Mono',        desc: 'Reines Schwarz-Weiß',  swatch: '#171717', card: '#262626', forcesDark: false },
  { id: 'graphite', name: 'Graphit',     desc: 'Warmes Anthrazit',     swatch: '#1c1917', card: '#292524', forcesDark: false },
  { id: 'ocean',    name: 'Ozean',       desc: 'Tiefes Marineblau',    swatch: '#0a1929', card: '#0f2942', forcesDark: true  },
  { id: 'midnight', name: 'Mitternacht', desc: 'Fast schwarz, kühl',   swatch: '#0b0e16', card: '#141924', forcesDark: true  },
  { id: 'nebula',   name: 'Nebula',      desc: 'Dunkles Violett',      swatch: '#171026', card: '#271b3f', forcesDark: true  },
  { id: 'forest',   name: 'Wald',        desc: 'Tiefes Waldgrün',      swatch: '#0c1e15', card: '#142f21', forcesDark: true  },
] as const;

export type PaletteId = typeof PALETTES[number]['id'];

export const DEFAULT_PALETTE: PaletteId = 'default';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: string;
  setAccent: (color: string) => void;
  palette: PaletteId;
  setPalette: (p: PaletteId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
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

function applyPalette(id: PaletteId): void {
  const root = document.documentElement;
  PALETTES.forEach(p => root.classList.remove(`palette-${p.id}`));
  if (id !== 'default') root.classList.add(`palette-${id}`);
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

  const [palette, setPaletteState] = useState<PaletteId>(() => {
    try {
      const stored = localStorage.getItem('finance-palette') as PaletteId | null;
      return PALETTES.some(p => p.id === stored) ? stored! : DEFAULT_PALETTE;
    } catch { return DEFAULT_PALETTE; }
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

  const setPalette = (id: PaletteId) => {
    setPaletteState(id);
    try { localStorage.setItem('finance-palette', id); } catch { /* ignore */ }
    applyPalette(id);
    // Dark-only palettes have no legible light variant — switch the mode with them.
    if (PALETTES.find(p => p.id === id)?.forcesDark) setTheme('dark');
  };

  // Apply on mount
  useEffect(() => {
    applyTheme(theme);
    applyAccent(accent);
    applyPalette(palette);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for system pref changes when mode is 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return createElement(
    ThemeContext.Provider,
    { value: { theme, setTheme, accent, setAccent, palette, setPalette } },
    children,
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
