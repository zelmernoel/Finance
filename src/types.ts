// ── Core entities ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  date: string;           // ISO date "YYYY-MM-DD"
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  note?: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  monthlyBudget?: number; // optional per-category spending limit
}

export interface Settings {
  id: string;
  startingBalance: number;
  name: string;
  monthStart?: number; // day of month (1–28) when the billing period begins
}

// ── Budget (workspace) ────────────────────────────────────────────────────────

export interface Budget {
  id: string;
  name: string;
  type: 'personal' | 'business';
  startingBalance: number;
  color: string;    // hex, e.g. "#4A6FA5"
  createdAt: string;
}

// ── Savings pots (Sparttöpfe) ─────────────────────────────────────────────────
// Nur für eingeloggte Nutzer. Verteilung/Rückabwicklung laufen serverseitig
// über DB-Trigger (siehe supabase/savings-pots.sql).

export interface SavingsPot {
  id: string;
  budgetId: string;
  name: string;
  allocationPercent: number;   // 0–100
  targetAmount?: number;       // optionales Sparziel
  currentAmount: number;       // trigger-gepflegt (Summe der Zuweisungen)
  color: string;               // hex
  icon?: string;               // optionaler Emoji-/Icon-Identifier
  sortOrder: number;           // höchste = neuester Topf, bekommt Rundungsrest
  createdAt: string;
  updatedAt: string;
}

export interface PotAllocation {
  id: string;
  potId: string;
  incomeTransactionId: string;
  amount: number;
  createdAt: string;
}

// ── Recurring transactions ────────────────────────────────────────────────────

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  budgetId: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  note?: string;
  frequency: Frequency;
  startDate: string;     // ISO
  endDate?: string;      // ISO, optional
  nextDue: string;       // ISO — updated after each execution
  lastExecuted?: string; // ISO
  isActive: boolean;
}

// ── Navigation ────────────────────────────────────────────────────────────────

export type Tab =
  | 'dashboard'
  | 'transactions'
  | 'new'
  | 'analysis'
  | 'recurring'
  | 'budgets'
  | 'savings'
  | 'settings';
