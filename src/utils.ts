import type { Transaction } from './types';

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
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

export const ACCENT = '#4A6FA5';
export const CHART_INCOME = '#4A6FA5';
export const CHART_EXPENSE = '#9CA3AF';
export const CHART_COLORS = [
  '#4A6FA5', '#6B8FC4', '#8BAFD0', '#A8C5DA', '#C4D9E6',
  '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB',
];
