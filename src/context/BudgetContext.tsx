import {
  createContext, useContext, useEffect, useState,
  useCallback, type ReactNode,
} from 'react';
import type { Budget } from '../types';
import { useAuth } from './AuthContext';
import {
  createLocalBudgetStorage,
  GUEST_BUDGETS_KEY, GUEST_ACTIVE_KEY,
} from '../lib/localStorageAdapter';
import { createSupabaseBudgetStorage, initializeNewUser } from '../lib/supabaseAdapter';

const ACCENT = '#4A6FA5';
const DEFAULT_BUDGET_KEY = 'finance:defaultBudget';

// ── Context type ──────────────────────────────────────────────────────────────

interface BudgetContextValue {
  budgets: Budget[];
  activeBudgetId: string | null;
  activeBudget: Budget | null;
  defaultBudgetId: string | null;
  loadingBudgets: boolean;
  setActiveBudgetId: (id: string) => void;
  setDefaultBudgetId: (id: string) => void;
  createBudget: (name: string, type: Budget['type'], startingBalance: number, color: string) => Promise<Budget>;
  updateBudget: (id: string, patch: Partial<Budget>) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  refreshBudgets: () => Promise<void>;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function BudgetProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [activeBudgetId, setActiveBudgetIdState] = useState<string | null>(null);
  const [defaultBudgetId, setDefaultBudgetIdState] = useState<string | null>(
    () => localStorage.getItem(DEFAULT_BUDGET_KEY)
  );
  const [loadingBudgets, setLoadingBudgets] = useState(true);

  const getStorage = useCallback(() => {
    return user
      ? createSupabaseBudgetStorage(user.id)
      : createLocalBudgetStorage();
  }, [user]);

  const refreshBudgets = useCallback(async () => {
    try {
      setLoadingBudgets(true);

      // Für eingeloggte User: Budget → Settings → Kategorien in korrekter Reihenfolge sicherstellen
      if (user) {
        await initializeNewUser(user.id);
      }

      const storage = getStorage();
      let list = await storage.getBudgets();

      // Nur für Gast-User: Default-Budget anlegen wenn keines existiert
      if (list.length === 0 && !user) {
        const defaultBudget: Budget = {
          id: crypto.randomUUID(),
          name: 'Persönlich',
          type: 'personal',
          startingBalance: 0,
          color: ACCENT,
          createdAt: new Date().toISOString(),
        };
        await storage.addBudget(defaultBudget);
        list = [defaultBudget];
      }

      setBudgets(list);

      // Prefer pinned default budget, then last active, then first
      const storedDefault = localStorage.getItem(DEFAULT_BUDGET_KEY);
      const storedActive  = localStorage.getItem(GUEST_ACTIVE_KEY);
      const validActive =
        (storedDefault && list.some(b => b.id === storedDefault) ? storedDefault : null) ??
        (storedActive  && list.some(b => b.id === storedActive)  ? storedActive  : null) ??
        list[0].id;
      setActiveBudgetIdState(validActive);
      localStorage.setItem(GUEST_ACTIVE_KEY, validActive);
    } catch (e) {
      console.error('Fehler beim Laden der Budgets:', e);
    } finally {
      setLoadingBudgets(false);
    }
  }, [getStorage]);

  useEffect(() => { refreshBudgets(); }, [refreshBudgets]);

  function setActiveBudgetId(id: string) {
    setActiveBudgetIdState(id);
    localStorage.setItem(GUEST_ACTIVE_KEY, id);
  }

  function setDefaultBudgetId(id: string) {
    setDefaultBudgetIdState(id);
    localStorage.setItem(DEFAULT_BUDGET_KEY, id);
    // Also switch to it immediately
    setActiveBudgetId(id);
  }

  async function createBudget(
    name: string,
    type: Budget['type'],
    startingBalance: number,
    color: string,
  ): Promise<Budget> {
    const b: Budget = {
      id: crypto.randomUUID(),
      name, type, startingBalance, color,
      createdAt: new Date().toISOString(),
    };
    await getStorage().addBudget(b);
    setBudgets(prev => [...prev, b]);
    return b;
  }

  async function updateBudget(id: string, patch: Partial<Budget>) {
    await getStorage().updateBudget(id, patch);
    setBudgets(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }

  async function deleteBudget(id: string) {
    if (budgets.length <= 1) throw new Error('Das letzte Budget kann nicht gelöscht werden.');
    await getStorage().deleteBudget(id);
    setBudgets(prev => {
      const next = prev.filter(b => b.id !== id);
      // If active budget was deleted, switch to first remaining
      if (activeBudgetId === id && next.length > 0) {
        setActiveBudgetId(next[0].id);
      }
      return next;
    });
  }

  const activeBudget = budgets.find(b => b.id === activeBudgetId) ?? null;

  return (
    <BudgetContext.Provider value={{
      budgets, activeBudgetId, activeBudget, defaultBudgetId, loadingBudgets,
      setActiveBudgetId, setDefaultBudgetId, createBudget, updateBudget, deleteBudget, refreshBudgets,
    }}>
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudget(): BudgetContextValue {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudget muss innerhalb von BudgetProvider verwendet werden');
  return ctx;
}

// Re-export key for use in other files
export { GUEST_BUDGETS_KEY };
