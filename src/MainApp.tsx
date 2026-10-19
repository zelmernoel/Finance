import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import type { Transaction, Category, Settings, Tab } from './types';
import type { StorageAdapter } from './lib/storage';
import { useAuth } from './context/AuthContext';
import { useBudget } from './context/BudgetContext';
import { useStorage } from './hooks/useStorage';
import { supabase } from './lib/supabase';
import { useRecurringTransactions } from './hooks/useRecurringTransactions';
import { useToast } from './components/Toast';
import Navigation from './components/Navigation';
import GuestBanner from './components/GuestBanner';
import MigrateModal from './components/MigrateModal';
import Onboarding from './components/Onboarding';
import {
  hasGuestData, getAllGuestData, clearAllGuestData,
} from './lib/localStorageAdapter';
import { createSupabaseAdapter } from './lib/supabaseAdapter';
import { v4 as uuidv4 } from 'uuid';
import { ACCENT } from './utils';
import { ROUTES, pathForTab } from './routes';

const DEFAULT_SETTINGS: Settings = { id: '', startingBalance: 0, name: '' };

// ── Outlet-Kontext ────────────────────────────────────────────────────────────
// MainApp ist die Layout-Route: sie lädt die Daten einmal und hält sie über
// Routenwechsel hinweg. Die Unterseiten holen sich alles über useAppContext(),
// die Props der Seitenkomponenten bleiben unverändert.

export interface AppContextValue {
  transactions: Transaction[];
  categories: Category[];
  settings: Settings;
  storage: StorageAdapter | null;
  activeBudgetId: string | null;
  activeBudgetName: string;
  /** Vom Dashboard angeklickter Monat, den die Auswertung anzeigen soll. */
  analysisMonth?: { year: number; month: number };
  goToMonth: (year: number, month: number) => void;
  goToTab: (tab: Tab) => void;
  openTransaction: (txId: string) => void;
  createTransaction: (t: Transaction) => Promise<void>;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, 'id'>>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  updateCategory: (id: string, patch: { monthlyBudget?: number }) => Promise<void>;
  saveSettings: (s: Partial<Omit<Settings, 'id'>>) => Promise<void>;
  importTransactions: (txs: Transaction[]) => Promise<void>;
  resetAllTransactions: () => Promise<void>;
  deleteTransactionsByPeriod: (from: string, to: string) => Promise<void>;
}

export function useAppContext(): AppContextValue {
  return useOutletContext<AppContextValue>();
}

export default function MainApp() {
  const { user } = useAuth();
  const { activeBudgetId, activeBudget, loadingBudgets } = useBudget();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Storage adapter scoped to active budget ───────────────────────────────
  const storage = useStorage(activeBudgetId);

  // ── App state ─────────────────────────────────────────────────────────────
  const [transactions, setTx]         = useState<Transaction[]>([]);
  const [categories, setCats]         = useState<Category[]>([]);
  const [settings, setSettings]       = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [analysisMonth, setAnalysisMonth] = useState<{ year: number; month: number } | undefined>();
  const prevUserRef                   = useRef<string | null>(null);

  // ── Load data whenever storage (= budget) changes ─────────────────────────
  const loadData = useCallback(async () => {
    if (!storage) return;
    setLoading(true);
    setError(null);
    try {
      const [txs, cats, s] = await Promise.all([
        storage.getTransactions(),
        storage.getCategories(),
        storage.getSettings(),
      ]);
      setTx(txs);
      setCats(cats);
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [storage]);

  useEffect(() => { loadData(); }, [loadData]);

  // Direkt über die Navigation aufgerufen → wieder laufender Monat.
  useEffect(() => {
    if (location.pathname !== ROUTES.analysis) return;
    if (!(location.state as { month?: unknown } | null)?.month) setAnalysisMonth(undefined);
  }, [location.pathname, location.state]);

  // ── Detect login → offer guest data migration ─────────────────────────────
  useEffect(() => {
    const prevUserId = prevUserRef.current;
    prevUserRef.current = user?.id ?? null;

    if (user && !prevUserId && hasGuestData()) {
      setShowMigrate(true);
    }
  }, [user]);

  // ── Recurring transactions auto-execution ─────────────────────────────────
  const handleNewRecurring = useCallback((txs: Transaction[]) => {
    setTx(prev => [...txs, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    showToast(
      `${txs.length} Dauerauftrag${txs.length !== 1 ? '´e' : ''} automatisch gebucht.`,
      'info',
    );
  }, [showToast]);

  const { processedCount } = useRecurringTransactions(storage, handleNewRecurring);
  useEffect(() => {
    if (processedCount > 0) {
      showToast(`${processedCount} Dauerauftrag${processedCount !== 1 ? 'e' : ''} automatisch gebucht.`);
    }
  }, [processedCount, showToast]);

  // ── Realtime (Supabase only) ──────────────────────────────────────────────
  useEffect(() => {
    if (!user || !activeBudgetId) return;
    const channel = supabase
      .channel(`tx-${user.id}-${activeBudgetId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'transactions',
        filter: `user_id=eq.${user.id}`,
      }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, activeBudgetId, loadData]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleCreate(t: Transaction) {
    if (!storage) return;
    try {
      const created = await storage.addTransaction(t);
      setTx(prev => [created, ...prev].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()));
      showToast('Transaktion gespeichert', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Fehler beim Speichern', 'error');
    }
  }

  async function handleUpdateTransaction(id: string, patch: Partial<Omit<Transaction, 'id'>>) {
    if (!storage) return;
    const updated = await storage.updateTransaction(id, patch);
    setTx(prev => prev.map(t => t.id === id ? updated : t)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  }

  async function handleDelete(id: string) {
    if (!storage) return;
    await storage.deleteTransaction(id);
    setTx(prev => prev.filter(t => t.id !== id));
  }

  async function handleAddCategory(name: string, type: 'income' | 'expense') {
    if (!storage) return;
    if (categories.some(c => c.name === name && c.type === type)) {
      showToast(`Kategorie „${name}" existiert bereits.`, 'info');
      return;
    }
    try {
      const created = await storage.addCategory({ id: uuidv4(), name, type });
      setCats(prev => [...prev, created]);
    } catch (e) {
      console.error('Kategorie-Fehler:', e);
      showToast(
        e instanceof Error ? e.message : 'Kategorie konnte nicht gespeichert werden.',
        'error',
      );
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!storage) return;
    await storage.deleteCategory(id);
    setCats(prev => prev.filter(c => c.id !== id));
  }

  async function handleUpdateCategory(id: string, patch: { monthlyBudget?: number }) {
    if (!storage) return;
    const updated = await storage.updateCategory(id, patch);
    setCats(prev => prev.map(c => c.id === id ? updated : c));
  }

  async function handleSaveSettings(s: Partial<Omit<Settings, 'id'>>) {
    if (!storage) return;
    const updated = await storage.updateSettings(s);
    setSettings(updated);
  }

  async function handleImportTransactions(txs: Transaction[]) {
    if (!storage) return;
    const created = await storage.importTransactions(txs);
    setTx(prev => [...prev, ...created].sort((a, b) => b.date.localeCompare(a.date)));
  }

  async function handleResetAllTransactions() {
    if (!storage) return;
    await storage.deleteAllTransactions(transactions.map(t => t.id));
    setTx([]);
  }

  async function handleDeleteTransactionsByPeriod(from: string, to: string) {
    if (!storage) return;
    const ids = transactions.filter(t => t.date >= from && t.date <= to).map(t => t.id);
    if (!ids.length) return;
    await storage.deleteAllTransactions(ids);
    setTx(prev => prev.filter(t => !ids.includes(t.id)));
  }

  /** Aus dem Protokoll heraus eine einzelne Buchung öffnen. */
  function handleOpenTransaction(txId: string) {
    navigate(`${ROUTES.transactions}?q=${encodeURIComponent(txId)}`);
  }

  function goToTab(tab: Tab) {
    navigate(pathForTab(tab));
  }

  function goToMonth(year: number, month: number) {
    setAnalysisMonth({ year, month });
    navigate(ROUTES.analysis, { state: { month: { year, month } } });
  }

  // ── Migration: import guest data into Supabase ────────────────────────────
  async function handleMigrateImport() {
    if (!user || !activeBudgetId) return;
    const guestData = getAllGuestData();
    const adapter = createSupabaseAdapter(user.id, activeBudgetId);

    // Import transactions
    if (guestData.transactions.length > 0) {
      await adapter.importTransactions(guestData.transactions);
    }
    // Import categories (skip duplicates)
    for (const c of guestData.categories) {
      try { await adapter.addCategory(c); } catch { /* duplicate */ }
    }

    clearAllGuestData();
    setShowMigrate(false);
    await loadData();
    showToast(`${guestData.transactions.length} Transaktionen importiert.`, 'success');
  }

  function handleMigrateDiscard() {
    clearAllGuestData();
    setShowMigrate(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingBudgets || (loading && !error)) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-200 dark:border-gray-700 rounded-full animate-spin mx-auto mb-3"
            style={{ borderTopColor: ACCENT }} />
          <p className="text-sm text-gray-500 dark:text-gray-400">Daten werden geladen…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">Fehler beim Laden</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{error}</p>
          <button onClick={loadData} className="px-4 py-2 text-sm text-white rounded"
            style={{ backgroundColor: ACCENT }}>Erneut versuchen</button>
        </div>
      </div>
    );
  }

  const guestTxCount = hasGuestData() ? getAllGuestData().transactions.length : 0;

  const ctx: AppContextValue = {
    transactions,
    categories,
    settings,
    storage,
    activeBudgetId,
    activeBudgetName: activeBudget?.name ?? 'Budget',
    analysisMonth,
    goToMonth,
    goToTab,
    openTransaction: handleOpenTransaction,
    createTransaction: handleCreate,
    updateTransaction: handleUpdateTransaction,
    deleteTransaction: handleDelete,
    addCategory: handleAddCategory,
    deleteCategory: handleDeleteCategory,
    updateCategory: handleUpdateCategory,
    saveSettings: handleSaveSettings,
    importTransactions: handleImportTransactions,
    resetAllTransactions: handleResetAllTransactions,
    deleteTransactionsByPeriod: handleDeleteTransactionsByPeriod,
  };

  return (
    // Safe Areas: Als installierte Web-App liegt die iOS-Statusleiste über der
    // Seite (black-translucent). Auf dem Handy gibt es oben keine Leiste, die den
    // Abstand tragen könnte — die Desktop-Navigation ist dort ausgeblendet —,
    // also schiebt der äussere Rahmen alles unter die Statusleiste. Der fixierte
    // Streifen hält diese Fläche beim Scrollen in Seitenfarbe, sonst liefe Text
    // unter der Uhr durch. Am Desktop und im normalen Browser ist env() 0 und
    // beides wirkungslos.
    <div className="min-h-screen bg-page pt-[env(safe-area-inset-top)]">
      <div
        aria-hidden="true"
        className="fixed top-0 inset-x-0 z-[15] h-[env(safe-area-inset-top)] bg-page"
      />
      {!user && <GuestBanner />}
      <Navigation />

      <main className="max-w-screen-xl mx-auto px-4 lg:px-6 py-4 lg:py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-6">
        <div key={location.pathname} className="tab-enter">
          <Outlet context={ctx} />
        </div>
      </main>

      {showMigrate && (
        <MigrateModal
          transactionCount={guestTxCount}
          onImport={handleMigrateImport}
          onDiscard={handleMigrateDiscard}
        />
      )}

      {/* Einmaliger Erstkontakt. Zeigt sich nur, solange das Flag fehlt. */}
      <Onboarding settings={settings} onSaveSettings={handleSaveSettings} />
    </div>
  );
}
