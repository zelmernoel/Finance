import type { Budget, Category } from '../types';

// ── Standardkategorien ────────────────────────────────────────────────────────
// Eine Liste für alle Adapter. Vorher gab es sie dreimal (Gast-Adapter,
// Supabase-Erstanlage, Supabase-Nachseeden) mit drei verschiedenen ID-Schemata.
//
// Firmenbereiche bekommen eigene Vorschläge inklusive Steuer-Vorbelegung:
// Umsatz mit 19 % USt, Ausgaben ohne (Reverse Charge bei ausländischen
// Anbietern ist bei Software die Regel; deutsche Rechnungen trägt man je
// Buchung nach).

type Seed = Omit<Category, 'id'>;

const PERSONAL: Seed[] = [
  { name: 'Lebensmittel',   type: 'expense' },
  { name: 'Transport',      type: 'expense' },
  { name: 'Freizeit',       type: 'expense' },
  { name: 'Kleidung',       type: 'expense' },
  { name: 'Technik',        type: 'expense' },
  { name: 'Bildung',        type: 'expense' },
  { name: 'Abos',           type: 'expense', defaultFrequency: 'monthly' },
  { name: 'Sonstiges',      type: 'expense' },
  { name: 'Lohn',           type: 'income',  defaultFrequency: 'monthly' },
  { name: 'Nebeneinkommen', type: 'income' },
  { name: 'Geschenk',       type: 'income' },
  { name: 'Sonstiges',      type: 'income' },
];

const BUSINESS: Seed[] = [
  { name: 'Technik',        type: 'expense' },
  { name: 'Software',       type: 'expense', defaultFrequency: 'monthly' },
  { name: 'Bildung',        type: 'expense' },
  { name: 'Auszahlung',     type: 'expense' },
  { name: 'Sonstiges',      type: 'expense' },
  { name: 'Umsatz',         type: 'income',  defaultTaxRate: 19 },
  { name: 'Leasing',        type: 'income',  defaultTaxRate: 19, defaultFrequency: 'monthly' },
  { name: 'Einzahlung',     type: 'income' },
  { name: 'Sonstiges',      type: 'income' },
];

export function defaultCategoriesFor(type: Budget['type'] = 'personal'): Category[] {
  return (type === 'business' ? BUSINESS : PERSONAL).map(c => ({ id: crypto.randomUUID(), ...c }));
}
