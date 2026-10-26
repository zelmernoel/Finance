import {
  createContext, useContext, useEffect, useState,
  useCallback, type ReactNode,
} from 'react';
import type { Budget, MergeResult } from '../types';
import { useAuth } from './AuthContext';
import { createLocalBudgetStorage, GUEST_ACTIVE_KEY } from '../lib/localStorageAdapter';
import { createSupabaseBudgetStorage, initializeNewUser, createSupabaseAdapter } from '../lib/supabaseAdapter';
import { createLocalStorageAdapter } from '../lib/localStorageAdapter';

const DEFAULT_COLOR = '#4A6FA5';
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
  mergeBudgets: (sourceId: string, targetId: string, name: string, type: Budget['type']) => Promise<MergeResult>;
  refreshBudgets: () => Promise<void>;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function BudgetProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
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
    // Solange die Sitzung noch nicht gelesen ist, nicht als Gast losrennen:
    // der Gast-Durchlauf legte sonst ein Phantom-Budget im localStorage an und
    // überschrieb den zuletzt aktiven Bereich des eingeloggten Nutzers.
    if (authLoading) return;
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
          color: DEFAULT_COLOR,
          createdAt: new Date().toISOString(),
        };
        await storage.addBudget(defaultBudget);
        list = [defaultBudget];
      }

      setBudgets(list);
      if (list.length === 0) throw new Error('Kein Bereich vorhanden.');

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
  }, [getStorage, user, authLoading]);

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
    // Den Kontostand rechnet überall settings.starting_balance, nicht
    // budgets.starting_balance — also dort ablegen, sonst ist die Eingabe wirkungslos.
    if (startingBalance !== 0) {
      const scoped = user ? createSupabaseAdapter(user.id, b.id) : createLocalStorageAdapter(b.id);
      await scoped.updateSettings({ startingBalance });
    }
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
    const next = budgets.filter(b => b.id !== id);
    setBudgets(next);
    // Aktiven oder gepinnten Bereich nicht auf eine gelöschte ID zeigen lassen.
    if (activeBudgetId === id && next.length > 0) setActiveBudgetId(next[0].id);
    if (defaultBudgetId === id) {
      setDefaultBudgetIdState(null);
      localStorage.removeItem(DEFAULT_BUDGET_KEY);
    }
  }

  async function mergeBudgets(sourceId: string, targetId: string, name: string, type: Budget['type']) {
    const result = await getStorage().mergeBudgets(sourceId, targetId, name, type);
    setBudgets(prev => prev
      .filter(b => b.id !== sourceId)
      .map(b => b.id === targetId ? { ...b, name: name.trim(), type } : b));
    // Zeigte der aktive oder gepinnte Bereich auf die Quelle, gilt jetzt das Ziel.
    if (activeBudgetId === sourceId) setActiveBudgetId(targetId);
    if (defaultBudgetId === sourceId) {
      setDefaultBudgetIdState(targetId);
      localStorage.setItem(DEFAULT_BUDGET_KEY, targetId);
    }
    return result;
  }

  const activeBudget = budgets.find(b => b.id === activeBudgetId) ?? null;

  return (
    <BudgetContext.Provider value={{
      budgets, activeBudgetId, activeBudget, defaultBudgetId, loadingBudgets,
      setActiveBudgetId, setDefaultBudgetId, createBudget, updateBudget, deleteBudget, mergeBudgets, refreshBudgets,
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
