import { useEffect, useState } from 'react';
import { useTheme } from './useTheme';

export interface ChartTheme {
  grid: string;
  tick: string;
  axisLabel: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  /** Outline around scatter dots / line dots, so they stay legible on any surface. */
  dotStroke: string;
}

function readChartTheme(): ChartTheme {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const dark = root.classList.contains('dark');

  return {
    grid:          dark ? v('--color-gray-700') : v('--color-gray-200'),
    tick:          dark ? v('--color-gray-400') : v('--color-gray-500'),
    axisLabel:     dark ? v('--color-gray-400') : v('--color-gray-400'),
    tooltipBg:     dark ? v('--color-gray-800') : '#ffffff',
    tooltipBorder: dark ? v('--color-gray-700') : v('--color-gray-200'),
    tooltipText:   dark ? v('--color-gray-100') : v('--color-gray-900'),
    dotStroke:     dark ? v('--color-gray-900') : '#ffffff',
  };
}

/**
 * Recharts takes colors as SVG presentation attributes, which cannot resolve
 * `var(--x)`. So we read the resolved palette values and hand over plain hex.
 */
export function useChartTheme(): ChartTheme {
  const { theme, palette } = useTheme();
  const [colors, setColors] = useState<ChartTheme>(readChartTheme);

  // `theme`/`palette` changes mutate classes on <html> before this effect runs.
  useEffect(() => { setColors(readChartTheme()); }, [theme, palette]);

  // In 'system' mode the resolved scheme can flip without any React state change.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setColors(readChartTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return colors;
}
