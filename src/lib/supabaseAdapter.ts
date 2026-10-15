import { supabase } from './supabase';
import type {
  Transaction, Category, Settings, Budget, RecurringTransaction,
} from '../types';
import type { StorageAdapter, BudgetStorage } from './storage';
import { defaultCategoriesFor } from './defaultCategories';

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
    taxAmount:   toNum(row.tax_amount),
    category:    String(row.category ?? ''),
    description: String(row.description ?? ''),
    note:        row.note != null ? String(row.note) : '',
    source:      row.source === 'mcp' ? 'mcp' : 'app',
  };
}

function rowToCat(row: Record<string, unknown>): Category {
  return {
    id:            String(row.id),
    name:          String(row.name),
    type:          row.type as 'income' | 'expense',
    monthlyBudget: row.monthly_budget != null ? toNum(row.monthly_budget) : undefined,
    defaultFrequency: row.default_frequency != null
      ? (String(row.default_frequency) as Category['defaultFrequency'])
      : undefined,
    defaultTaxRate: row.default_tax_rate != null ? toNum(row.default_tax_rate) : undefined,
  };
}

function rowToSettings(row: Record<string, unknown>): Settings {
  return {
    id:              String(row.id),
    startingBalance: toNum(row.starting_balance),
    name:            String(row.name ?? ''),
    monthStart:      row.month_start != null ? toNum(row.month_start) : undefined,
    showAiBadges:    row.show_ai_badges != null ? Boolean(row.show_ai_badges) : true,
    mcpAllowPotCreation:
      row.mcp_allow_pot_creation != null ? Boolean(row.mcp_allow_pot_creation) : true,
    onboardingCompleted:
      row.onboarding_completed != null ? Boolean(row.onboarding_completed) : false,
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
    taxAmount:    toNum(row.tax_amount),
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
  await supabase.from('categories').insert(categoryRows(userId, budgetId, 'personal'));

  return budgetId;
}

/** Standardkategorien als DB-Zeilen für einen Bereich. */
function categoryRows(userId: string, budgetId: string, type: 'personal' | 'business') {
  return defaultCategoriesFor(type).map(c => ({
    id: c.id, user_id: userId, budget_id: budgetId, name: c.name, type: c.type,
    default_frequency: c.defaultFrequency ?? null,
    default_tax_rate: c.defaultTaxRate ?? null,
  }));
}

// ── SupabaseAdapter (scoped to budgetId) ──────────────────────────────────────

export function createSupabaseAdapter(userId: string, budgetId: string): StorageAdapter {
  /** Eine Stelle, die eine Transaction in eine DB-Zeile übersetzt. */
  const txRow = (t: Transaction) => ({
    id: t.id, user_id: userId, budget_id: budgetId,
    date: t.date, type: t.type, amount: t.amount, tax_amount: t.taxAmount ?? 0,
    category: t.category, description: t.description, note: t.note ?? '',
  });

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
        .insert(txRow(t))
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToTx(data as Record<string, unknown>);
    },

    async updateTransaction(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.date        !== undefined) dbPatch.date        = patch.date;
      if (patch.type        !== undefined) dbPatch.type        = patch.type;
      if (patch.amount      !== undefined) dbPatch.amount      = patch.amount;
      if (patch.taxAmount   !== undefined) dbPatch.tax_amount  = patch.taxAmount;
      if (patch.category    !== undefined) dbPatch.category    = patch.category;
      if (patch.description !== undefined) dbPatch.description = patch.description;
      if (patch.note        !== undefined) dbPatch.note        = patch.note;
      const { data, error } = await supabase.from('transactions')
        .update(dbPatch).eq('id', id).eq('user_id', userId).select().single();
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
      const rows = txs.map(txRow);
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

      // Ein Bereich ohne Kategorien bekommt die Standardliste seiner Art.
      // Vorher wurde nur geseedet, wenn der Nutzer in GAR KEINEM Bereich
      // Kategorien hatte — jeder weitere Bereich (auch "Firma") blieb leer.
      if (!data || data.length === 0) {
        const { data: budget } = await supabase
          .from('budgets').select('type').eq('id', budgetId).maybeSingle();
        const type = budget?.type === 'business' ? 'business' : 'personal';
        const { data: seeded, error: err2 } = await supabase
          .from('categories')
          .insert(categoryRows(userId, budgetId, type))
          .select();
        if (err2) { console.error('[Supabase Error]', err2.message, err2); throw new Error(err2.message); }
        return (seeded ?? []).map(r => rowToCat(r as Record<string, unknown>));
      }
      return data.map(r => rowToCat(r as Record<string, unknown>));
    },

    async addCategory(c) {
      const { data, error } = await supabase
        .from('categories')
        .insert({
          id: c.id, user_id: userId, budget_id: budgetId, name: c.name, type: c.type,
          monthly_budget: c.monthlyBudget ?? null,
          default_frequency: c.defaultFrequency ?? null,
          default_tax_rate: c.defaultTaxRate ?? null,
        })
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToCat(data as Record<string, unknown>);
    },

    async updateCategory(id, patch) {
      // Prüfung auf Schlüssel statt auf !== undefined: { monthlyBudget: undefined }
      // heisst "Budget entfernen" und muss als NULL ankommen. Mit der alten
      // Prüfung war das Entfernen eines Monatsbudgets ein stiller No-op.
      const dbPatch: Record<string, unknown> = {};
      if (patch.name !== undefined)      dbPatch.name              = patch.name;
      if ('monthlyBudget' in patch)      dbPatch.monthly_budget    = patch.monthlyBudget ?? null;
      if ('defaultFrequency' in patch)   dbPatch.default_frequency = patch.defaultFrequency ?? null;
      if ('defaultTaxRate' in patch)     dbPatch.default_tax_rate  = patch.defaultTaxRate ?? null;
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
      if (patch.showAiBadges !== undefined)    dbPatch.show_ai_badges   = patch.showAiBadges;
      if (patch.mcpAllowPotCreation !== undefined)
        dbPatch.mcp_allow_pot_creation = patch.mcpAllowPotCreation;
      if (patch.onboardingCompleted !== undefined)
        dbPatch.onboarding_completed = patch.onboardingCompleted;
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
          amount: r.amount, tax_amount: r.taxAmount ?? 0, type: r.type, category: r.category,
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
      if (patch.taxAmount !== undefined)    dbPatch.tax_amount    = patch.taxAmount;
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
