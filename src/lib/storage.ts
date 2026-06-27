import type {
  Transaction, Category, Settings, Budget,
  RecurringTransaction,
} from '../types';

// ── StorageAdapter ─────────────────────────────────────────────────────────────
// Single interface for all data operations, scoped to one budget.
// Implementations: LocalStorageAdapter (guest mode) and SupabaseAdapter (logged-in).

export interface StorageAdapter {
  // Transactions
  getTransactions(): Promise<Transaction[]>;
  addTransaction(t: Transaction): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  deleteAllTransactions(ids: string[]): Promise<void>;
  importTransactions(txs: Transaction[]): Promise<Transaction[]>;

  // Categories
  getCategories(): Promise<Category[]>;
  addCategory(c: Category): Promise<Category>;
  updateCategory(id: string, patch: Partial<Category>): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  // Settings (per-budget)
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  // Recurring transactions
  getRecurring(): Promise<RecurringTransaction[]>;
  addRecurring(r: RecurringTransaction): Promise<RecurringTransaction>;
  updateRecurring(id: string, patch: Partial<RecurringTransaction>): Promise<RecurringTransaction>;
  deleteRecurring(id: string): Promise<void>;
}

// ── BudgetStorage ─────────────────────────────────────────────────────────────
// Separate interface for budget-list management (cross-budget).

export interface BudgetStorage {
  getBudgets(): Promise<Budget[]>;
  addBudget(b: Budget): Promise<Budget>;
  updateBudget(id: string, patch: Partial<Budget>): Promise<Budget>;
  deleteBudget(id: string): Promise<void>;
}
