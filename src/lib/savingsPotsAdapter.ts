import { supabase } from './supabase';
import type { SavingsPot, PotAllocation } from '../types';

// ── Savings pots storage (Supabase only, scoped to one budget) ────────────────
// Sparttöpfe existieren nur für eingeloggte Nutzer. Verteilung, Rückabwicklung
// und die 100%-Grenze erzwingen DB-Trigger (supabase/savings-pots.sql); dieser
// Adapter macht reines CRUD auf savings_pots + Lesen von pot_allocations.

function toNum(v: unknown): number {
  return typeof v === 'string' ? parseFloat(v) : Number(v ?? 0);
}

function rowToPot(row: Record<string, unknown>): SavingsPot {
  return {
    id:                String(row.id),
    budgetId:          String(row.budget_id ?? ''),
    name:              String(row.name ?? ''),
    allocationPercent: toNum(row.allocation_percent),
    targetAmount:      row.target_amount != null ? toNum(row.target_amount) : undefined,
    currentAmount:     toNum(row.current_amount),
    color:             String(row.color ?? '#4A6FA5'),
    icon:              row.icon != null ? String(row.icon) : undefined,
    sortOrder:         toNum(row.sort_order),
    createdAt:         String(row.created_at ?? ''),
    updatedAt:         String(row.updated_at ?? ''),
  };
}

function rowToAllocation(row: Record<string, unknown>): PotAllocation {
  return {
    id:                  String(row.id),
    potId:               String(row.pot_id ?? ''),
    incomeTransactionId: String(row.income_transaction_id ?? ''),
    amount:              toNum(row.amount),
    createdAt:           String(row.created_at ?? ''),
  };
}

export interface SavingsPotsStorage {
  getPots(): Promise<SavingsPot[]>;
  addPot(p: Omit<SavingsPot, 'currentAmount' | 'createdAt' | 'updatedAt'>): Promise<SavingsPot>;
  updatePot(id: string, patch: Partial<Omit<SavingsPot, 'id' | 'budgetId' | 'currentAmount' | 'createdAt' | 'updatedAt'>>): Promise<SavingsPot>;
  deletePot(id: string): Promise<void>;
  getAllocations(potId: string, limit?: number): Promise<PotAllocation[]>;
}

export function createSavingsPotsAdapter(userId: string, budgetId: string): SavingsPotsStorage {
  return {
    async getPots() {
      const { data, error } = await supabase
        .from('savings_pots')
        .select('*')
        .eq('user_id', userId)
        .eq('budget_id', budgetId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return (data ?? []).map(r => rowToPot(r as Record<string, unknown>));
    },

    async addPot(p) {
      const { data, error } = await supabase
        .from('savings_pots')
        .insert({
          id: p.id, user_id: userId, budget_id: budgetId,
          name: p.name, allocation_percent: p.allocationPercent,
          target_amount: p.targetAmount ?? null,
          color: p.color, icon: p.icon ?? null, sort_order: p.sortOrder,
        })
        .select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToPot(data as Record<string, unknown>);
    },

    async updatePot(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.name              !== undefined) dbPatch.name               = patch.name;
      if (patch.allocationPercent !== undefined) dbPatch.allocation_percent = patch.allocationPercent;
      if (patch.targetAmount      !== undefined) dbPatch.target_amount      = patch.targetAmount ?? null;
      if (patch.color             !== undefined) dbPatch.color              = patch.color;
      if (patch.icon              !== undefined) dbPatch.icon               = patch.icon ?? null;
      if (patch.sortOrder         !== undefined) dbPatch.sort_order         = patch.sortOrder;
      const { data, error } = await supabase
        .from('savings_pots')
        .update(dbPatch).eq('id', id).eq('user_id', userId).select().single();
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return rowToPot(data as Record<string, unknown>);
    },

    async deletePot(id) {
      const { error } = await supabase
        .from('savings_pots')
        .delete().eq('id', id).eq('user_id', userId);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
    },

    async getAllocations(potId, limit = 20) {
      const { data, error } = await supabase
        .from('pot_allocations')
        .select('*')
        .eq('user_id', userId)
        .eq('pot_id', potId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
      return (data ?? []).map(r => rowToAllocation(r as Record<string, unknown>));
    },
  };
}
