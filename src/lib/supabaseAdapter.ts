import { supabase } from './supabase';
import type {
  Transaction, Category, Settings, Budget, RecurringTransaction,
} from '../types';
import type { StorageAdapter, BudgetStorage } from './storage';

// ── Type helpers ──────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  return typeof v === 'string' ? parseFloat(v) : Number(v ?? 0);
}

function rowToTx(row: Record<string, unknown>): Transaction {
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

function rowToCat(row: Record<string, unknown>): Category {
  return {
    id:            String(row.id),
    name:          String(row.name),
    type:          row.type as 'income' | 'expense',
    monthlyBudget: row.monthly_budget != null ? toNum(row.monthly_budget) : undefined,
  };
}

function rowToSettings(row: Record<string, unknown>): Settings {
  return {
    id:              String(row.id),
    startingBalance: toNum(row.starting_balance),
    name:            String(row.name ?? ''),
    monthStart:      row.month_start != null ? toNum(row.month_start) : undefined,
  };
}

function rowToBudget(row: Record<string, unknown>): Budget {
  return {
    id:              String(row.id),
    name:            String(row.name),
    type:            (row.type ?? 'personal') as 'personal' | 'business',
    startingBalance: toNum(row.starting_balance),
    color:           String(row.color ?? '#4A6FA5'),
    createdAt:       String(row.created_at ?? ''),
  };
}

function rowToRecurring(row: Record<string, unknown>): RecurringTransaction {
  return {
    id:           String(row.id),
    budgetId:     String(row.budget_id ?? ''),
    amount:       toNum(row.amount),
    type:         row.type as 'income' | 'expense',
    category:     String(row.category ?? ''),
    description:  String(row.description ?? ''),
    note:         row.note != null ? String(row.note) : undefined,
    frequency:    row.frequency as RecurringTransaction['frequency'],
    startDate:    String(row.start_date),
    endDate:      row.end_date ? String(row.end_date) : undefined,
    nextDue:      String(row.next_due),
    lastExecuted: row.last_executed ? String(row.last_executed) : undefined,
    isActive:     Boolean(row.is_active),
  };
}

const DEFAULT_CATEGORIES = [
  { name: 'Lebensmittel', type: 'expense' },
  { name: 'Transport',    type: 'expense' },
  { name: 'Freizeit',     type: 'expense' },
  { name: 'Kleidung',     type: 'expense' },
  { name: 'Technik',      type: 'expense' },
  { name: 'Bildung',      type: 'expense' },
  { name: 'Sonstiges',    type: 'expense' },
  { name: 'Lohn',         type: 'income'  },
  { name: 'Nebeneinkommen', type: 'income' },
  { name: 'Geschenk',     type: 'income'  },
  { name: 'Sonstiges',    type: 'income'  },
] as const;

// ── initializeNewUser ─────────────────────────────────────────────────────────
// Garantiert die korrekte Reihenfolge: Budget → Settings → Kategorien.
// Muss einmalig nach Login / Session-Restore aufgerufen werden.
// Gibt die budgetId zurück (bestehend oder neu erstellt).

export async function initializeNewUser(userId: string): Promise<string | null> {
  // Bereinigung: verwaiste Settings ohne budget_id können FK-Fehler verursachen
  await supabase
    .from('settings')
    .delete()
    .eq('user_id', userId)
    .is('budget_id', null);

  // Schritt 1: Bereits initialisiert?
  const { data: existing } = await supabase
    .from('budgets')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (existing) return String(existing.id);

  // Schritt 2: Default-Budget erstellen
  const { data: budget, error: budgetError } = await supabase
    .from('budgets')
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      name: 'Persönlich',
      type: 'personal',
      starting_balance: 0,
      color: '#4A6FA5',
    })
    .select()
    .single();

  if (budgetError || !budget) {
    console.error('Budget-Fehler bei Initialisierung:', budgetError);
    return null;
  }

  const budgetId = String(budget.id);

  // Schritt 3: Settings mit budget_id anlegen
  await supabase
    .from('settings')
    .upsert(
      { user_id: userId, budget_id: budgetId, starting_balance: 0, name: '' },
      { onConflict: 'user_id,budget_id' },
    );

  // Schritt 4: Default-Kategorien mit budget_id anlegen
  const defaultCats = [
    { id: `cat-exp-1-${userId}`, name: 'Lebensmittel',  type: 'expense' },
    { id: `cat-exp-2-${userId}`, name: 'Transport',      type: 'expense' },
    { id: `cat-exp-3-${userId}`, name: 'Freizeit',       type: 'expense' },
    { id: `cat-exp-4-${userId}`, name: 'Kleidung',       type: 'expense' },
    { id: `cat-exp-5-${userId}`, name: 'Technik',        type: 'expense' },
    { id: `cat-exp-6-${userId}`, name: 'Bildung',        type: 'expense' },
    { id: `cat-exp-7-${userId}`, name: 'Sonstiges',      type: 'expense' },
    { id: `cat-inc-1-${userId}`, name: 'Lohn',           type: 'income'  },
    { id: `cat-inc-2-${userId}`, name: 'Nebeneinkommen', type: 'income'  },
    { id: `cat-inc-3-${userId}`, name: 'Geschenk',       type: 'income'  },
    { id: `cat-inc-4-${userId}`, name: 'Sonstiges',      type: 'income'  },
  ].map(c => ({ ...c, user_id: userId, budget_id: budgetId }));

  await supabase
    .from('categories')
    .upsert(defaultCats, { onConflict: 'id', ignoreDuplicates: true });

  return budgetId;
}

// ── SupabaseAdapter (scoped to budgetId) ──────────────────────────────────────

export function createSupabaseAdapter(userId: string, budgetId: string): StorageAdapter {
  return {
    // ── Transactions ──────────────────────────────────────────────────────────

    async getTransactions() {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('budget_id', budgetId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return (data ?? []).map(r => rowToTx(r as Record<string, unknown>));
    },

    async addTransaction(t) {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          id: t.id, user_id: userId, budget_id: budgetId,
          date: t.date, type: t.type, amount: t.amount,
          category: t.category, description: t.description, note: t.note ?? '',
        })
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToTx(data as Record<string, unknown>);
    },

    async deleteTransaction(id) {
      const { error } = await supabase.from('transactions')
        .delete().eq('id', id).eq('user_id', userId);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
    },

    async deleteAllTransactions(ids) {
      if (!ids.length) return;
      const { error } = await supabase.from('transactions')
        .delete().in('id', ids).eq('user_id', userId).eq('budget_id', budgetId);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
    },

    async importTransactions(txs) {
      if (!txs.length) return [];
      const rows = txs.map(t => ({
        id: t.id, user_id: userId, budget_id: budgetId,
        date: t.date, type: t.type, amount: t.amount,
        category: t.category, description: t.description, note: t.note ?? '',
      }));
      const { data, error } = await supabase.from('transactions').insert(rows).select();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return (data ?? []).map(r => rowToTx(r as Record<string, unknown>));
    },

    // ── Categories ────────────────────────────────────────────────────────────

    async getCategories() {
      const { data, error } = await supabase
        .from('categories').select('*')
        .eq('user_id', userId).eq('budget_id', budgetId)
        .order('type').order('name');
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }

      if (!data || data.length === 0) {
        const { data: existing } = await supabase
          .from('categories')
          .select('id')
          .eq('user_id', userId)
          .limit(1);
        if (existing && existing.length > 0) return [];

        const rows = DEFAULT_CATEGORIES.map((c, i) => ({
          id: `cat-${c.type.slice(0, 3)}-${i + 1}-${userId.slice(0, 6)}`,
          user_id: userId, budget_id: budgetId,
          name: c.name, type: c.type,
        }));
        const { data: seeded, error: err2 } = await supabase
          .from('categories')
          .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
          .select();
        if (err2) { console.error('[Supabase Error]', err2.message, err2); throw new Error(err2.message); }
        return (seeded ?? []).map(r => rowToCat(r as Record<string, unknown>));
      }
      return data.map(r => rowToCat(r as Record<string, unknown>));
    },

    async addCategory(c) {
      const { data, error } = await supabase
        .from('categories')
        .insert({ id: c.id, user_id: userId, budget_id: budgetId, name: c.name, type: c.type })
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToCat(data as Record<string, unknown>);
    },

    async updateCategory(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.name !== undefined) dbPatch.name = patch.name;
      if (patch.monthlyBudget !== undefined) dbPatch.monthly_budget = patch.monthlyBudget;
      const { data, error } = await supabase.from('categories')
        .update(dbPatch).eq('id', id).eq('user_id', userId).select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToCat(data as Record<string, unknown>);
    },

    async deleteCategory(id) {
      const { error } = await supabase.from('categories')
        .delete().eq('id', id).eq('user_id', userId);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
    },

    // ── Settings ──────────────────────────────────────────────────────────────

    async getSettings() {
      const { data, error } = await supabase.from('settings')
        .select('*').eq('user_id', userId).eq('budget_id', budgetId).maybeSingle();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      if (!data) {
        const { data: created, error: e2 } = await supabase.from('settings')
          .upsert(
            { user_id: userId, budget_id: budgetId, starting_balance: 0, name: '' },
            { onConflict: 'user_id,budget_id' },
          )
          .select().single();
        if (e2) { console.error('[Supabase Error]', e2.message, e2); throw new Error(e2.message); }
        return rowToSettings(created as Record<string, unknown>);
      }
      return rowToSettings(data as Record<string, unknown>);
    },

    async updateSettings(patch) {
      const dbPatch: Record<string, unknown> = { user_id: userId, budget_id: budgetId };
      if (patch.startingBalance !== undefined) dbPatch.starting_balance = patch.startingBalance;
      if (patch.name !== undefined)            dbPatch.name             = patch.name;
      if (patch.monthStart  !== undefined)     dbPatch.month_start      = patch.monthStart;
      const { data, error } = await supabase.from('settings')
        .upsert(dbPatch, { onConflict: 'user_id,budget_id' }).select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToSettings(data as Record<string, unknown>);
    },

    // ── Recurring ─────────────────────────────────────────────────────────────

    async getRecurring() {
      const { data, error } = await supabase.from('recurring_transactions')
        .select('*').eq('user_id', userId).eq('budget_id', budgetId)
        .order('created_at', { ascending: false });
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return (data ?? []).map(r => rowToRecurring(r as Record<string, unknown>));
    },

    async addRecurring(r) {
      const { data, error } = await supabase.from('recurring_transactions')
        .insert({
          id: r.id, user_id: userId, budget_id: budgetId,
          amount: r.amount, type: r.type, category: r.category,
          description: r.description, note: r.note ?? null,
          frequency: r.frequency, start_date: r.startDate,
          end_date: r.endDate ?? null, next_due: r.nextDue,
          last_executed: r.lastExecuted ?? null, is_active: r.isActive,
        })
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToRecurring(data as Record<string, unknown>);
    },

    async updateRecurring(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.nextDue !== undefined)      dbPatch.next_due      = patch.nextDue;
      if (patch.lastExecuted !== undefined) dbPatch.last_executed = patch.lastExecuted;
      if (patch.isActive !== undefined)     dbPatch.is_active     = patch.isActive;
      if (patch.endDate !== undefined)      dbPatch.end_date      = patch.endDate;
      if (patch.amount !== undefined)       dbPatch.amount        = patch.amount;
      if (patch.category !== undefined)     dbPatch.category      = patch.category;
      if (patch.description !== undefined)  dbPatch.description   = patch.description;
      if (patch.frequency !== undefined)    dbPatch.frequency     = patch.frequency;
      const { data, error } = await supabase.from('recurring_transactions')
        .update(dbPatch).eq('id', id).eq('user_id', userId).select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToRecurring(data as Record<string, unknown>);
    },

    async deleteRecurring(id) {
      const { error } = await supabase.from('recurring_transactions')
        .delete().eq('id', id).eq('user_id', userId);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
    },
  };
}

// ── SupabaseBudgetStorage ─────────────────────────────────────────────────────

export function createSupabaseBudgetStorage(userId: string): BudgetStorage {
  return {
    async getBudgets() {
      const { data, error } = await supabase.from('budgets')
        .select('*').eq('user_id', userId).order('created_at');
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return (data ?? []).map(r => rowToBudget(r as Record<string, unknown>));
    },
    async addBudget(b) {
      const { data, error } = await supabase.from('budgets')
        .insert({
          id: b.id, user_id: userId, name: b.name, type: b.type,
          starting_balance: b.startingBalance, color: b.color,
        })
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToBudget(data as Record<string, unknown>);
    },
    async updateBudget(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.name !== undefined)            dbPatch.name             = patch.name;
      if (patch.type !== undefined)            dbPatch.type             = patch.type;
      if (patch.startingBalance !== undefined) dbPatch.starting_balance = patch.startingBalance;
      if (patch.color !== undefined)           dbPatch.color            = patch.color;
      const { data, error } = await supabase.from('budgets')
        .update(dbPatch).eq('id', id).eq('user_id', userId).select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToBudget(data as Record<string, unknown>);
    },
    async deleteBudget(id) {
      const { error } = await supabase.from('budgets')
        .delete().eq('id', id).eq('user_id', userId);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
    },
  };
}
