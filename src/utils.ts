import type { Transaction } from './types';
import { isValidTaxSplit, parseAmount, round2 } from './lib/money';

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

/**
 * Für HTML, das aus Strings zusammengesetzt wird (Druckansichten). Beschreibungen
 * kommen auch von Claude (MCP) oder aus CSV-Importen — ungeschützt wären sie
 * Script-Code unter der Origin der App, mit Zugriff auf die Sitzung.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
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

// ── Kalenderdaten ─────────────────────────────────────────────────────────────
//
// Ein Datum wie "2026-03-15" ist ein reines Kalenderdatum ohne Uhrzeit. Eine
// Zeitzone hat darin nichts verloren — deshalb wird hier durchgehend auf
// UTC-Mitternacht gerechnet und in UTC ausgelesen. UTC kennt keine Sommerzeit,
// also gibt es auch keine Sprünge.
//
// Zwei Fallen, die genau hier schon zugeschlagen haben:
//
//   1. toISOString() auf einem LOKAL gebauten Date. `new Date(2026, 2, 14)` ist
//      in Berlin 2026-03-14T00:00+01:00, also 2026-03-13T23:00Z — daraus wird
//      "2026-03-13", ein Tag zu früh.
//   2. Lokale Getter/Setter auf einem UTC-Datum. Fällt die lokale Uhrzeit auf
//      den Sommerzeitsprung, verschiebt setDate() um eine Stunde statt um einen
//      Tag: addDays('2026-03-29', +1) ergab wieder 2026-03-29. Ein Dauerauftrag
//      auf diesem Datum rückte nie vor und buchte bei jedem App-Start erneut.
//
// Regel: Konstruktion mit Date.UTC(), Auslesen mit getUTC*(), formatieren mit
// toISODate(). Niemals mischen.
//
// Zweitimplementierung: getMonthRange()/getCustomMonthRange() stehen auch in
// supabase/functions/mcp/index.ts (Deno, kann diese Datei nicht importieren).
// Wer hier etwas ändert, muss sie dort nachziehen.
//
// ── Zwei Formatierer, und warum ──────────────────────────────────────────────
//
// toISODate(d)  liest in UTC.    Für KALENDERDATEN, die mit Date.UTC() gebaut
//                                wurden — also alles aus addDays/addMonths/
//                                getMonthRange. Dort steckt keine Uhrzeit drin,
//                                UTC ist nur der Träger.
//
// todayISO()    liest LOKAL.     Für den Zeitpunkt JETZT. Welcher Tag gerade
//                                ist, ist eine Frage der Ortszeit des Nutzers,
//                                nicht der von Greenwich.
//
// Die beiden nicht verwechseln. toISODate(new Date()) wäre falsch: es liefert
// den UTC-Tag, und der ist in Berlin zwischen Mitternacht und 01:00 bzw. 02:00
// noch der gestrige. Genau das stand vorher an neun Stellen als
// `new Date().toISOString().slice(0, 10)` und liess Formulare nachts das
// gestrige Datum vorschlagen.

/**
 * "YYYY-MM-DD" aus einem Date, in UTC ausgelesen.
 * Für Kalenderdaten aus der UTC-Arithmetik — nicht für "jetzt", dafür todayISO().
 */
function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Der heutige Tag als "YYYY-MM-DD" — in der ORTSZEIT des Nutzers.
 *
 * Bewusst nicht über toISOString(): das rechnet nach UTC um und liefert
 * östlich von Greenwich kurz nach Mitternacht noch den Vortag, westlich davon
 * am späten Abend schon den Folgetag.
 */
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → Date auf UTC-Mitternacht. */
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Letzter Tag eines Monats (1-basiert), über den Rollover des Folgemonats. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** n Tage addieren (n darf negativ sein). */
export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

/**
 * n Monate addieren (n darf negativ sein). Der Tag wird auf das Monatsende
 * geklemmt, statt in den Folgemonat überzulaufen:
 * 31.01. + 1 Monat ergibt den 28.02. (im Schaltjahr den 29.), nicht den 03.03.
 *
 * Ohne das Klemmen wandert ein Dauerauftrag vom Monatsende Schritt für Schritt
 * in den Folgemonat und verliert seinen Termin.
 */
export function addMonths(iso: string, n: number, anchorDay?: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total     = y * 12 + (m - 1) + n;
  const year      = Math.floor(total / 12);
  const month     = (total % 12 + 12) % 12 + 1;  // 1-basiert, auch bei negativem n
  // anchorDay: der ursprüngliche Monatstag. Ohne ihn hängt ein Auftrag vom
  // 31. nach dem Februar für immer am 28. — jeder Schritt rechnet sonst vom
  // bereits geklemmten Tag weiter.
  const day       = Math.min(anchorDay ?? d, lastDayOfMonth(year, month));
  return toISODate(new Date(Date.UTC(year, month - 1, day)));
}

/** n Jahre addieren. Über addMonths, damit der 29.02. genauso geklemmt wird. */
export function addYears(iso: string, n: number, anchorDay?: number): string {
  return addMonths(iso, n * 12, anchorDay);
}

/**
 * Zeitraum eines bestimmten Abrechnungsmonats: vom `monthStart`. des Monats
 * bis zum Tag vor dem `monthStart`. des Folgemonats.
 *
 * Die einzige Stelle, die den Zeitraum wirklich ausrechnet —
 * getCustomMonthRange() setzt nur den passenden Monat davor.
 */
export function getMonthRange(year: number, month: number, monthStart: number = 1): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-${String(monthStart).padStart(2, '0')}`;
  const nextStart = new Date(Date.UTC(year, month, monthStart)); // month ist 1-basiert → Folgemonat
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return { from, to: toISODate(nextStart) };
}

/**
 * Laufender Abrechnungszeitraum. Liegt der heutige Tag noch vor `monthStart`,
 * hat der Zeitraum im Vormonat begonnen.
 *
 * "Heute" ist bewusst der lokale Tag des Nutzers — die Oberfläche soll den
 * Zeitraum zeigen, in dem sich die Person gerade befindet.
 */
export function getCustomMonthRange(monthStart: number = 1): { from: string; to: string } {
  const today = new Date();
  let fromYear  = today.getFullYear();
  let fromMonth = today.getMonth() + 1; // 1-based

  if (today.getDate() < monthStart) {
    // Startet erst noch → der laufende Zeitraum begann im Vormonat
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    fromYear  = prev.getFullYear();
    fromMonth = prev.getMonth() + 1;
  }

  return getMonthRange(fromYear, fromMonth, monthStart);
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

export function groupByCategory(transactions: Transaction[]): Record<string, number> {
  return transactions.reduce(
    (acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    },
    {} as Record<string, number>
  );
}

// ── CSV ───────────────────────────────────────────────────────────────────────
// Format: Datum;Typ;Betrag;Kategorie;Beschreibung;Notiz;Steuer — Semikolon als
// Trenner, Textfelder in Anführungszeichen (RFC-4180-Quoting, "" für ein
// Anführungszeichen). Die Spalte Steuer ist optional; alte Exporte ohne sie
// lassen sich weiterhin einlesen.

function csvQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Zerlegt eine CSV-Zeile mit Semikolon-Trenner und berücksichtigt
 * Anführungszeichen. Vorher wurde an `;` UND `,` gesplittet — damit zerriss
 * schon der eigene Export ("12,50" wurde zu 12 und "50").
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ';') {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map(v => v.trim());
}

export function downloadCSV(transactions: Transaction[]): void {
  const header = ['Datum', 'Typ', 'Betrag', 'Kategorie', 'Beschreibung', 'Notiz', 'Steuer'];
  const rows = transactions.map((t) => [
    formatDate(t.date),
    t.type === 'income' ? 'Einnahme' : 'Ausgabe',
    t.amount.toFixed(2).replace('.', ','),
    csvQuote(t.category),
    csvQuote(t.description),
    csvQuote((t.note ?? '').replace(/\r?\n/g, ' | ')),
    (t.taxAmount ?? 0).toFixed(2).replace('.', ','),
  ]);
  const csv = [header, ...rows].map((r) => r.join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transaktionen_${todayISO()}.csv`;
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
    const cols = splitCsvLine(raw);
    if (cols.length < 5) {
      errors.push(`Zeile ${i + 1}: zu wenige Spalten (erwartet: Datum;Typ;Betrag;Kategorie;Beschreibung[;Notiz;Steuer])`);
      continue;
    }
    const [rawDate, rawType, rawAmount, category, description, note = '', rawTax = ''] = cols;

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

    const amount = parseAmount(rawAmount);
    if (amount === null || amount <= 0) {
      errors.push(`Zeile ${i + 1}: ungültiger Betrag „${rawAmount}"`);
      continue;
    }
    const tax = rawTax ? parseAmount(rawTax) : 0;
    if (tax === null || !isValidTaxSplit(amount, tax)) {
      errors.push(`Zeile ${i + 1}: ungültige Steuer „${rawTax}" (0 bis Betrag)`);
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

    valid.push({
      id: crypto.randomUUID(), date, type, amount: round2(amount), taxAmount: round2(tax),
      category, description, note,
    });
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
