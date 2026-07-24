import type { Transaction } from './types';

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Achsenbeschriftung für Diagramme. Skaliert mit dem Wert statt fest in Tausend
 * zu rechnen — sonst steht bei Beträgen unter 1.000 € überall „0k".
 */
export function formatAxisEuro(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio`;
  if (abs >= 10_000)    return `${(v / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 0 })}k`;
  return v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

export function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function getCurrentMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Returns the ISO date range for the current billing period given a custom month start day. */
export function getCustomMonthRange(monthStart: number = 1): { from: string; to: string } {
  const today = new Date();
  const day   = today.getDate();
  let fromYear  = today.getFullYear();
  let fromMonth = today.getMonth() + 1; // 1-based

  if (day < monthStart) {
    // Haven't reached start day yet → period began last month
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    fromYear  = prev.getFullYear();
    fromMonth = prev.getMonth() + 1;
  }

  const from = `${fromYear}-${String(fromMonth).padStart(2, '0')}-${String(monthStart).padStart(2, '0')}`;

  // End: one day before the next period's start
  const nextStart = new Date(fromYear, fromMonth - 1 + 1, monthStart);
  nextStart.setDate(nextStart.getDate() - 1);
  const to = nextStart.toISOString().slice(0, 10);

  return { from, to };
}

/**
 * Zeitraum eines bestimmten Abrechnungsmonats — dieselbe Logik wie
 * getCustomMonthRange, aber für ein frei gewähltes Jahr/Monat-Paar.
 */
export function getMonthRange(year: number, month: number, monthStart: number = 1): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-${String(monthStart).padStart(2, '0')}`;
  const nextStart = new Date(year, month, monthStart); // month ist 1-basiert → nächster Monat
  nextStart.setDate(nextStart.getDate() - 1);
  const to = `${nextStart.getFullYear()}-${String(nextStart.getMonth() + 1).padStart(2, '0')}-${String(nextStart.getDate()).padStart(2, '0')}`;
  return { from, to };
}

export function isSameMonth(isoDate: string, year: number, month: number): boolean {
  const [y, m] = isoDate.split('-').map(Number);
  return y === year && m === month;
}

export function getMonthLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
}

export function getLast12Months(): Array<{ year: number; month: number; label: string }> {
  const result = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: getMonthLabel(d.getFullYear(), d.getMonth() + 1),
    });
  }
  return result;
}

export function computeBalance(transactions: Transaction[]): number {
  return transactions.reduce((acc, t) => {
    return t.type === 'income' ? acc + t.amount : acc - t.amount;
  }, 0);
}

export function filterByMonth(transactions: Transaction[], year: number, month: number): Transaction[] {
  return transactions.filter((t) => isSameMonth(t.date, year, month));
}

export function filterByDateRange(
  transactions: Transaction[],
  from: string | null,
  to: string | null
): Transaction[] {
  return transactions.filter((t) => {
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    return true;
  });
}

export function groupByCategory(transactions: Transaction[]): Record<string, number> {
  return transactions.reduce(
    (acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    },
    {} as Record<string, number>
  );
}

export function downloadCSV(transactions: Transaction[]): void {
  const header = ['Datum', 'Typ', 'Betrag', 'Kategorie', 'Beschreibung', 'Notiz'];
  const rows = transactions.map((t) => [
    formatDate(t.date),
    t.type === 'income' ? 'Einnahme' : 'Ausgabe',
    t.amount.toFixed(2).replace('.', ','),
    t.category,
    `"${t.description.replace(/"/g, '""')}"`,
    `"${(t.note ?? '').replace(/"/g, '""')}"`,
  ]);
  const csv = [header, ...rows].map((r) => r.join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transaktionen_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJSON(data: object, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface CsvParseResult {
  valid: Transaction[];
  errors: string[];
}

export function parseImportCSV(text: string): CsvParseResult {
  const lines = text.trim().split(/\r?\n/);
  const valid: Transaction[] = [];
  const errors: string[] = [];

  // skip header row if it starts with "Datum" or "Date"
  const start = /^(datum|date)/i.test(lines[0]) ? 1 : 0;

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cols = raw.split(/[;,]/).map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 5) {
      errors.push(`Zeile ${i + 1}: zu wenige Spalten (erwartet: Datum;Typ;Betrag;Kategorie;Beschreibung[;Notiz])`);
      continue;
    }
    const [rawDate, rawType, rawAmount, category, description, note = ''] = cols;

    // parse date: DD.MM.YYYY or YYYY-MM-DD
    let date: string;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(rawDate)) {
      const [d, m, y] = rawDate.split('.');
      date = `${y}-${m}-${d}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else {
      errors.push(`Zeile ${i + 1}: ungültiges Datum „${rawDate}" (DD.MM.YYYY oder YYYY-MM-DD)`);
      continue;
    }

    const type: 'income' | 'expense' =
      /einnahme|income/i.test(rawType) ? 'income' : 'expense';

    const amount = parseFloat(rawAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      errors.push(`Zeile ${i + 1}: ungültiger Betrag „${rawAmount}"`);
      continue;
    }

    if (!category.trim()) {
      errors.push(`Zeile ${i + 1}: Kategorie fehlt`);
      continue;
    }
    if (!description.trim()) {
      errors.push(`Zeile ${i + 1}: Beschreibung fehlt`);
      continue;
    }

    valid.push({ id: crypto.randomUUID(), date, type, amount, category, description, note });
  }

  return { valid, errors };
}

// ── Kategoriefarben aus der Akzentfarbe ableiten ─────────────────────────────
// Die Kategorie-Paletten dürfen nicht fest blau sein, sonst passen sie bei
// jeder anderen Akzentfarbe nicht mehr zum Rest der Oberfläche.

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if      (h <  60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else              rgb = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Kategoriale Palette aus der Akzentfarbe: gleicher Grundton, gestaffelte
 * Helligkeit plus leichte Farbtondrift, damit benachbarte Segmente
 * unterscheidbar bleiben.
 */
export function buildSeriesColors(accent: string, count = 10, dark = false): string[] {
  let h = 210, s = 0.4;
  try { [h, s] = hexToHsl(accent); } catch { /* Fallback bleibt */ }
  const sat = clamp(s, 0.3, 0.85);
  const lo = dark ? 0.40 : 0.34;
  const hi = dark ? 0.80 : 0.74;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    return hslToHex(
      h + (i % 2 ? 12 : -8) + t * 20,
      clamp(sat * (1 - 0.3 * t), 0.22, 0.9),
      lo + (hi - lo) * t,
    );
  });
}

export const ACCENT = 'var(--accent)';
export const CHART_INCOME = 'var(--accent)';
export const CHART_EXPENSE = '#9CA3AF';
export const CHART_COLORS = [
  '#4A6FA5', '#6B8FC4', '#8BAFD0', '#A8C5DA', '#C4D9E6',
  '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB',
];
