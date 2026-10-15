import { useMemo } from 'react';
import type { Category } from '../types';

// Optionale Farbe je Kategorie. Liegt — wie die Kategorie-Reihenfolge
// (catOrder:{budgetId}) — im localStorage und ist damit gerätelokal.
// Ohne Eintrag bekommt die Kategorie automatisch einen Ton aus der
// Akzentfarben-Palette.

export function categoryColorKey(budgetId: string | null): string {
  return `catColor:${budgetId ?? 'guest'}`;
}

export function loadCategoryColors(budgetId: string | null): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(categoryColorKey(budgetId)) ?? '{}'); }
  catch { return {}; }
}

export function saveCategoryColors(budgetId: string | null, map: Record<string, string>): void {
  try { localStorage.setItem(categoryColorKey(budgetId), JSON.stringify(map)); }
  catch { /* ignore */ }
}

// ── Reihenfolge ───────────────────────────────────────────────────────────────

export function categoryOrderKey(budgetId: string | null): string {
  return `catOrder:${budgetId ?? 'guest'}`;
}

export function loadCategoryOrder(budgetId: string | null): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(categoryOrderKey(budgetId)) ?? '{}'); }
  catch { return {}; }
}

export function saveCategoryOrder(budgetId: string | null, map: Record<string, number>): void {
  try { localStorage.setItem(categoryOrderKey(budgetId), JSON.stringify(map)); }
  catch { /* ignore */ }
}

/** Sortiert nach gespeicherter Reihenfolge; Kategorien ohne Eintrag kommen hinten, stabil. */
export function sortByCategoryOrder<T extends { id: string }>(cats: T[], order: Record<string, number>): T[] {
  return [...cats].sort((a, b) => (order[a.id] ?? Number.MAX_SAFE_INTEGER) - (order[b.id] ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Liefert eine Funktion, die zu einem Kategorienamen die Farbe auflöst:
 * eigene Farbe, falls gesetzt — sonst ein Ton aus `series` anhand des Index.
 */
export function useCategoryColorResolver(
  budgetId: string | null,
  categories: Category[],
  series: string[],
  overrides?: Record<string, string>,
): (name: string, index: number) => string {
  const byName = useMemo(() => {
    const map = overrides ?? loadCategoryColors(budgetId);
    const out: Record<string, string> = {};
    for (const c of Array.isArray(categories) ? categories : []) {
      if (map[c.id]) out[c.name] = map[c.id];
    }
    return out;
  }, [budgetId, categories, overrides]);

  return useMemo(
    () => (name: string, index: number) =>
      byName[name] ?? series[index % Math.max(1, series.length)] ?? '#4A6FA5',
    [byName, series],
  );
}
