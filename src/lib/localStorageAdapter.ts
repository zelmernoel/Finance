import type {
  Transaction, Category, Settings, Budget, RecurringTransaction,
} from '../types';
import type { StorageAdapter, BudgetStorage } from './storage';

// ── helpers ───────────────────────────────────────────────────────────────────

function ls<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Keys ──────────────────────────────────────────────────────────────────────

export const GUEST_BUDGETS_KEY = 'ft_guest_budgets';
export const GUEST_ACTIVE_KEY  = 'ft_guest_active_budget_id';

function txKey(budgetId: string)  { return `ft_${budgetId}_tx`; }
function catKey(budgetId: string) { return `ft_${budgetId}_cats`; }
function setKey(budgetId: string) { return `ft_${budgetId}_settings`; }
function recKey(budgetId: string) { return `ft_${budgetId}_recurring`; }

// ── Default seeded categories ─────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-exp-1', name: 'Lebensmittel', type: 'expense' },
  { id: 'cat-exp-2', name: 'Transport',    type: 'expense' },
  { id: 'cat-exp-3', name: 'Freizeit',     type: 'expense' },
  { id: 'cat-exp-4', name: 'Kleidung',     type: 'expense' },
  { id: 'cat-exp-5', name: 'Technik',      type: 'expense' },
  { id: 'cat-exp-6', name: 'Bildung',      type: 'expense' },
  { id: 'cat-exp-7', name: 'Sonstiges',    type: 'expense' },
  { id: 'cat-inc-1', name: 'Lohn',         type: 'income'  },
  { id: 'cat-inc-2', name: 'Nebeneinkommen', type: 'income' },
  { id: 'cat-inc-3', name: 'Geschenk',     type: 'income'  },
  { id: 'cat-inc-4', name: 'Sonstiges',    type: 'income'  },
];

// ── LocalStorageAdapter ───────────────────────────────────────────────────────

export function createLocalStorageAdapter(budgetId: string): StorageAdapter {
  return {
    async getTransactions() {
      return ls<Transaction[]>(txKey(budgetId), []);
    },
    async addTransaction(t) {
      const list = ls<Transaction[]>(txKey(budgetId), []);
      const next = [t, ...list].sort((a, b) => b.date.localeCompare(a.date));
      lsSet(txKey(budgetId), next);
      return t;
    },
    async updateTransaction(id, patch) {
      const list = ls<Transaction[]>(txKey(budgetId), []);
      const updated = list.map(t => t.id === id ? { ...t, ...patch } : t);
      lsSet(txKey(budgetId), updated);
      const found = updated.find(t => t.id === id);
      if (!found) throw new Error('Transaktion nicht gefunden');
      return found;
    },
    async deleteTransaction(id) {
      const list = ls<Transaction[]>(txKey(budgetId), []);
      lsSet(txKey(budgetId), list.filter(t => t.id !== id));
    },
    async deleteAllTransactions(ids) {
      const set = new Set(ids);
      const list = ls<Transaction[]>(txKey(budgetId), []);
      lsSet(txKey(budgetId), list.filter(t => !set.has(t.id)));
    },
    async importTransactions(txs) {
      const list = ls<Transaction[]>(txKey(budgetId), []);
      const next = [...txs, ...list].sort((a, b) => b.date.localeCompare(a.date));
      lsSet(txKey(budgetId), next);
      return txs;
    },

    async getCategories() {
      const stored = ls<Category[] | null>(catKey(budgetId), null);
      if (!stored) {
        lsSet(catKey(budgetId), DEFAULT_CATEGORIES);
        return DEFAULT_CATEGORIES;
      }
      return stored;
    },
    async addCategory(c) {
      const list = ls<Category[]>(catKey(budgetId), DEFAULT_CATEGORIES);
      lsSet(catKey(budgetId), [...list, c]);
      return c;
    },
    async updateCategory(id, patch) {
      const list = ls<Category[]>(catKey(budgetId), DEFAULT_CATEGORIES);
      const updated = list.map(c => c.id === id ? { ...c, ...patch } : c);
      lsSet(catKey(budgetId), updated);
      const found = updated.find(c => c.id === id);
      if (!found) throw new Error('Kategorie nicht gefunden');
      return found;
    },
    async deleteCategory(id) {
      const list = ls<Category[]>(catKey(budgetId), DEFAULT_CATEGORIES);
      lsSet(catKey(budgetId), list.filter(c => c.id !== id));
    },

    async getSettings() {
      return ls<Settings>(setKey(budgetId), { id: budgetId, startingBalance: 0, name: '' });
    },
    async updateSettings(patch) {
      const current = ls<Settings>(setKey(budgetId), { id: budgetId, startingBalance: 0, name: '' });
      const next = { ...current, ...patch };
      lsSet(setKey(budgetId), next);
      return next;
    },

    async getRecurring() {
      return ls<RecurringTransaction[]>(recKey(budgetId), []);
    },
    async addRecurring(r) {
      const list = ls<RecurringTransaction[]>(recKey(budgetId), []);
      lsSet(recKey(budgetId), [r, ...list]);
      return r;
    },
    async updateRecurring(id, patch) {
      const list = ls<RecurringTransaction[]>(recKey(budgetId), []);
      const updated = list.map(r => r.id === id ? { ...r, ...patch } : r);
      lsSet(recKey(budgetId), updated);
      const found = updated.find(r => r.id === id);
      if (!found) throw new Error('Dauerauftrag nicht gefunden');
      return found;
    },
    async deleteRecurring(id) {
      const list = ls<RecurringTransaction[]>(recKey(budgetId), []);
      lsSet(recKey(budgetId), list.filter(r => r.id !== id));
    },
  };
}

// ── LocalBudgetStorage ────────────────────────────────────────────────────────

export function createLocalBudgetStorage(): BudgetStorage {
  return {
    async getBudgets() {
      return ls<Budget[]>(GUEST_BUDGETS_KEY, []);
    },
    async addBudget(b) {
      const list = ls<Budget[]>(GUEST_BUDGETS_KEY, []);
      lsSet(GUEST_BUDGETS_KEY, [...list, b]);
      return b;
    },
    async updateBudget(id, patch) {
      const list = ls<Budget[]>(GUEST_BUDGETS_KEY, []);
      const updated = list.map(b => b.id === id ? { ...b, ...patch } : b);
      lsSet(GUEST_BUDGETS_KEY, updated);
      const found = updated.find(b => b.id === id);
      if (!found) throw new Error('Budget nicht gefunden');
      return found;
    },
    async deleteBudget(id) {
      const list = ls<Budget[]>(GUEST_BUDGETS_KEY, []);
      lsSet(GUEST_BUDGETS_KEY, list.filter(b => b.id !== id));
      // Remove scoped data
      localStorage.removeItem(txKey(id));
      localStorage.removeItem(catKey(id));
      localStorage.removeItem(setKey(id));
      localStorage.removeItem(recKey(id));
    },
  };
}

// ── Guest data check ──────────────────────────────────────────────────────────

export function hasGuestData(): boolean {
  const budgets = ls<Budget[]>(GUEST_BUDGETS_KEY, []);
  for (const b of budgets) {
    const txs = ls<Transaction[]>(txKey(b.id), []);
    if (txs.length > 0) return true;
  }
  return false;
}

export function getAllGuestData(): {
  budgets: Budget[];
  transactions: Transaction[];
  categories: Category[];
  recurring: RecurringTransaction[];
} {
  const budgets = ls<Budget[]>(GUEST_BUDGETS_KEY, []);
  const transactions: Transaction[] = [];
  const categories: Category[] = [];
  const recurring: RecurringTransaction[] = [];
  for (const b of budgets) {
    transactions.push(...ls<Transaction[]>(txKey(b.id), []));
    categories.push(...ls<Category[]>(catKey(b.id), []));
    recurring.push(...ls<RecurringTransaction[]>(recKey(b.id), []));
  }
  return { budgets, transactions, categories, recurring };
}

export function clearAllGuestData() {
  const budgets = ls<Budget[]>(GUEST_BUDGETS_KEY, []);
  for (const b of budgets) {
    localStorage.removeItem(txKey(b.id));
    localStorage.removeItem(catKey(b.id));
    localStorage.removeItem(setKey(b.id));
    localStorage.removeItem(recKey(b.id));
  }
  localStorage.removeItem(GUEST_BUDGETS_KEY);
  localStorage.removeItem(GUEST_ACTIVE_KEY);
}
