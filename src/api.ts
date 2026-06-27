import { supabase } from './lib/supabase';
import type { Transaction, Category, Settings } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht eingeloggt');
  return user.id;
}

// Supabase gibt NUMERIC als string zurück → zu number konvertieren
function toNum(v: unknown): number {
  return typeof v === 'string' ? parseFloat(v) : Number(v);
}

// DB-Row → Transaction
function rowToTransaction(row: Record<string, unknown>): Transaction {
  return {
    id:          String(row.id),
    date:        String(row.date),
    type:        row.type as 'income' | 'expense',
    amount:      toNum(row.amount),
    category:    String(row.category ?? ''),
    description: String(row.description ?? ''),
    note:        row.note != null ? String(row.note) : '',
  };
}

// DB-Row → Settings (snake_case → camelCase)
function rowToSettings(row: Record<string, unknown>): Settings {
  return {
    id:              String(row.id),
    startingBalance: toNum(row.starting_balance),
    name:            String(row.name ?? ''),
  };
}

// ── Transactions ─────────────────────────────────────────────────────────────

export async function fetchTransactions(): Promise<Transaction[]> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToTransaction);
}

export async function createTransaction(t: Transaction): Promise<Transaction> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      id:          t.id,
      user_id:     userId,
      date:        t.date,
      type:        t.type,
      amount:      t.amount,
      category:    t.category,
      description: t.description,
      note:        t.note ?? '',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToTransaction(data as Record<string, unknown>);
}

export async function deleteTransaction(id: string): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function deleteAllTransactions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const userId = await getUserId();
  const { error } = await supabase
    .from('transactions')
    .delete()
    .in('id', ids)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function importTransactions(txs: Transaction[]): Promise<Transaction[]> {
  if (txs.length === 0) return [];
  const userId = await getUserId();
  const rows = txs.map(t => ({
    id:          t.id,
    user_id:     userId,
    date:        t.date,
    type:        t.type,
    amount:      t.amount,
    category:    t.category,
    description: t.description,
    note:        t.note ?? '',
  }));
  const { data, error } = await supabase
    .from('transactions')
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToTransaction);
}

// ── Categories ────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Lebensmittel', type: 'expense' },
  { name: 'Transport',    type: 'expense' },
  { name: 'Freizeit',     type: 'expense' },
  { name: 'Kleidung',     type: 'expense' },
  { name: 'Technik',      type: 'expense' },
  { name: 'Bildung',      type: 'expense' },
  { name: 'Sonstiges',    type: 'expense' },
  { name: 'Lohn',         type: 'income' },
  { name: 'Nebeneinkommen', type: 'income' },
  { name: 'Geschenk',     type: 'income' },
  { name: 'Sonstiges',    type: 'income' },
];

export async function fetchCategories(): Promise<Category[]> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('type')
    .order('name');
  if (error) throw new Error(error.message);

  // Aufgabe 7: Erste Anmeldung → Default-Kategorien anlegen
  if (!data || data.length === 0) {
    return seedDefaultCategories(userId);
  }

  return data.map(r => ({
    id:   String(r.id),
    name: String(r.name),
    type: r.type as 'income' | 'expense',
  }));
}

async function seedDefaultCategories(userId: string): Promise<Category[]> {
  const rows = DEFAULT_CATEGORIES.map((c, i) => ({
    id:      `cat-${c.type.slice(0, 3)}-${i + 1}-${userId.slice(0, 8)}`,
    user_id: userId,
    name:    c.name,
    type:    c.type,
  }));
  const { data, error } = await supabase
    .from('categories')
    .insert(rows)
    .select();
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id:   String(r.id),
    name: String(r.name),
    type: r.type as 'income' | 'expense',
  }));
}

export async function createCategory(c: Category): Promise<Category> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('categories')
    .insert({ id: c.id, user_id: userId, name: c.name, type: c.type })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const r = data as Record<string, unknown>;
  return { id: String(r.id), name: String(r.name), type: r.type as 'income' | 'expense' };
}

export async function deleteCategory(id: string): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<Settings> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  // Erste Anmeldung: noch keine Settings → anlegen
  if (!data) {
    return createDefaultSettings(userId);
  }
  return rowToSettings(data as Record<string, unknown>);
}

async function createDefaultSettings(userId: string): Promise<Settings> {
  const { data, error } = await supabase
    .from('settings')
    .insert({ user_id: userId, starting_balance: 0, name: '' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToSettings(data as Record<string, unknown>);
}

export async function updateSettings(s: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const userId = await getUserId();
  const patch: Record<string, unknown> = { user_id: userId };
  if (s.startingBalance !== undefined) patch.starting_balance = s.startingBalance;
  if (s.name !== undefined) patch.name = s.name;

  const { data, error } = await supabase
    .from('settings')
    .upsert(patch, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToSettings(data as Record<string, unknown>);
}
