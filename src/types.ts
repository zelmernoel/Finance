// ── Core entities ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  date: string;           // ISO date "YYYY-MM-DD"
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  note?: string;
  /**
   * Herkunft der Buchung (transactions.source).
   * 'app' = in der Oberfläche erfasst, 'mcp' = von Claude über den
   * MCP-Server angelegt. Im Gast-Modus nicht gesetzt.
   */
  source?: 'app' | 'mcp';
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
  /** Steuert nur die Anzeige der KI-Markierung; source wird immer geschrieben. */
  showAiBadges?: boolean;
  /** Darf Claude Sparttöpfe anlegen? Wird zusätzlich per RLS erzwungen. */
  mcpAllowPotCreation?: boolean;
  /** Einmaliger Erstkontakt abgeschlossen — steuert nur, ob das Onboarding erscheint. */
  onboardingCompleted?: boolean;
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

// ── Änderungsprotokoll (activity_log) ─────────────────────────────────────────
// Append-only. Erfasst JEDE Änderung an Transaktionen, Notizen und Sparttöpfen —
// aus der App wie von Claude. Nur für eingeloggte Nutzer; im Gast-Modus liegen
// die Daten lokal und es gibt weder MCP-Zugriff noch Protokoll.

export type ActivityActor = 'app' | 'mcp';
export type ActivityAction = 'insert' | 'update' | 'delete' | 'read';

export interface ActivityLogEntry {
  id: string;
  budgetId: string | null;
  createdAt: string;
  actor: ActivityActor;
  clientLabel?: string;
  entity: string;
  entityId?: string;
  action: ActivityAction;
  tool?: string;
  status: 'ok' | 'error';
  errorMessage?: string;
}

// ── Notizen zu einer Transaktion (transaction_notes) ──────────────────────────
// Unveränderlich: nur anhängen. Getrennt vom Feld Transaction.note, das
// unverändert seine bisherige Funktion behält.

export interface TransactionNote {
  id: string;
  transactionId: string;
  createdAt: string;
  author: ActivityActor;
  body: string;
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
