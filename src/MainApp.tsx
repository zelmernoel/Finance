import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import type { Transaction, Category, Settings, Tab, SavingsPot, Budget } from './types';
import type { StorageAdapter } from './lib/storage';
import { createSavingsPotsAdapter, type SavingsPotsStorage } from './lib/savingsPotsAdapter';
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
import { deleteReceipt } from './lib/receiptStorage';
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
  /** 'business' schaltet im Wizard und in den Einstellungen die Steuerfelder frei. */
  activeBudgetType: Budget['type'];
  /**
   * Sparttöpfe des aktiven Bereichs (nur mit Konto; im Gast-Modus leer).
   * Liegen hier, weil Dashboard ("Verfügbar"), Töpfe-Seite und Wizard sie
   * alle brauchen und jede Buchung sie über den DB-Trigger verändert.
   */
  pots: SavingsPot[];
  potsAdapter: SavingsPotsStorage | null;
  refreshPots: () => Promise<void>;
  /** Vom Dashboard angeklickter Monat, den die Auswertung anzeigen soll. */
  analysisMonth?: { year: number; month: number };
  goToMonth: (year: number, month: number) => void;
  goToTab: (tab: Tab, state?: Record<string, unknown>) => void;
  openTransaction: (txId: string) => void;
  createTransaction: (t: Transaction) => Promise<void>;
  updateTransaction: (id: string, patch: Partial<Omit<Transaction, 'id'>>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  updateCategory: (id: string, patch: Partial<Omit<Category, 'id' | 'type'>>) => Promise<void>;
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
  const potsAdapter = useMemo(
    () => (user && activeBudgetId ? createSavingsPotsAdapter(user.id, activeBudgetId) : null),
    [user, activeBudgetId],
  );

  // ── App state ─────────────────────────────────────────────────────────────
  const [transactions, setTx]         = useState<Transaction[]>([]);
  const [categories, setCats]         = useState<Category[]>([]);
  const [pots, setPots]               = useState<SavingsPot[]>([]);
  const [settings, setSettings]       = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [analysisMonth, setAnalysisMonth] = useState<{ year: number; month: number } | undefined>();
  const prevUserRef                   = useRef<string | null>(null);

  // ── Load data whenever storage (= budget) changes ─────────────────────────
  // silent: im Hintergrund nachladen (Realtime-Ereignis), ohne die Seite
  // hinter dem Ladebalken zu verstecken — das würde laufende Eingaben
  // (Wizard, Bearbeiten-Modal) wegwerfen.
  const loadData = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!storage) return;
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const [txs, cats, s, p] = await Promise.all([
        storage.getTransactions(),
        storage.getCategories(),
        storage.getSettings(),
        potsAdapter ? potsAdapter.getPots() : Promise.resolve([] as SavingsPot[]),
      ]);
      setTx(txs);
      setCats(cats);
      setSettings(s);
      setPots(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [storage, potsAdapter]);

  useEffect(() => { loadData(); }, [loadData]);

  // Töpfe ändern sich serverseitig mit jeder Buchung (Trigger). Nach jedem
  // Schreibzugriff auf Transaktionen deshalb neu lesen — leise, ohne Ladebalken.
  const refreshPots = useCallback(async () => {
    if (!potsAdapter) { setPots([]); return; }
    try { setPots(await potsAdapter.getPots()); }
    catch (e) { console.error('Sparttöpfe konnten nicht geladen werden:', e); }
  }, [potsAdapter]);

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
  // Vorher meldeten sich zwei Stellen (Callback + processedCount-Effekt) mit
  // demselben Toast. Eine reicht.
  const handleNewRecurring = useCallback((txs: Transaction[]) => {
    setTx(prev => [...txs, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    showToast(`${txs.length} Dauerauftrag${txs.length !== 1 ? 'e' : ''} automatisch gebucht.`, 'info');
    void refreshPots();
  }, [showToast, refreshPots]);

  useRecurringTransactions(storage, handleNewRecurring);

  // ── Realtime (Supabase only) ──────────────────────────────────────────────
  // Nur Änderungen am aktiven Bereich interessieren (z. B. eine Buchung von
  // Claude), und sie werden leise nachgeladen.
  useEffect(() => {
    if (!user || !activeBudgetId) return;
    const channel = supabase
      .channel(`tx-${user.id}-${activeBudgetId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'transactions',
        filter: `budget_id=eq.${activeBudgetId}`,
      }, () => loadData({ silent: true }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, activeBudgetId, loadData]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleCreate(t: Transaction) {
    if (!storage) return;
    try {
      const created = await storage.addTransaction(t);
      setTx(prev => [created, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
      showToast('Transaktion gespeichert', 'success');
      void refreshPots();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Fehler beim Speichern', 'error');
    }
  }

  async function handleUpdateTransaction(id: string, patch: Partial<Omit<Transaction, 'id'>>) {
    if (!storage) return;
    const updated = await storage.updateTransaction(id, patch);
    setTx(prev => prev.map(t => t.id === id ? updated : t).sort((a, b) => b.date.localeCompare(a.date)));
    void refreshPots();
  }

  async function handleDelete(id: string) {
    if (!storage) return;
    await storage.deleteTransaction(id);
    deleteReceipt(id); // Belege liegen im localStorage und hingen sonst verwaist herum
    setTx(prev => prev.filter(t => t.id !== id));
    void refreshPots();
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

  async function handleUpdateCategory(id: string, patch: Partial<Omit<Category, 'id' | 'type'>>) {
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
    void refreshPots();
  }

  async function handleResetAllTransactions() {
    if (!storage) return;
    const ids = transactions.map(t => t.id);
    await storage.deleteAllTransactions(ids);
    ids.forEach(deleteReceipt);
    setTx([]);
    void refreshPots();
  }

  async function handleDeleteTransactionsByPeriod(from: string, to: string) {
    if (!storage) return;
    const ids = transactions.filter(t => t.date >= from && t.date <= to).map(t => t.id);
    if (!ids.length) return;
    await storage.deleteAllTransactions(ids);
    ids.forEach(deleteReceipt);
    const gone = new Set(ids);
    setTx(prev => prev.filter(t => !gone.has(t.id)));
    void refreshPots();
  }

  /** Aus dem Protokoll heraus eine einzelne Buchung öffnen. */
  function handleOpenTransaction(txId: string) {
    navigate(`${ROUTES.transactions}?q=${encodeURIComponent(txId)}`);
  }

  function goToTab(tab: Tab, state?: Record<string, unknown>) {
    navigate(pathForTab(tab), state ? { state } : undefined);
  }

  function goToMonth(year: number, month: number) {
    setAnalysisMonth({ year, month });
    navigate(ROUTES.analysis, { state: { month: { year, month } } });
  }

  // ── Migration: import guest data into Supabase ────────────────────────────
  // Alles landet im aktiven Bereich. Gast-Daten werden erst gelöscht, wenn
  // der Import durch ist — vorher gingen bei einem Fehler Daten verloren,
  // und Daueraufträge wurden zwar gelesen, aber nie importiert.
  async function handleMigrateImport() {
    if (!user || !activeBudgetId) return;
    const guestData = getAllGuestData();
    const adapter = createSupabaseAdapter(user.id, activeBudgetId);
    try {
      if (guestData.transactions.length > 0) {
        await adapter.importTransactions(guestData.transactions);
      }
      for (const c of guestData.categories) {
        try { await adapter.addCategory(c); } catch { /* Duplikat */ }
      }
      for (const r of guestData.recurring) {
        await adapter.addRecurring({ ...r, budgetId: activeBudgetId });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Import fehlgeschlagen — Gast-Daten bleiben erhalten.', 'error');
      return;
    }

    clearAllGuestData();
    setShowMigrate(false);
    await loadData();
    showToast(`${guestData.transactions.length} Transaktionen und ${guestData.recurring.length} Daueraufträge importiert.`, 'success');
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
          <button onClick={() => loadData()} className="px-4 py-2 text-sm text-white rounded"
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
    activeBudgetType: activeBudget?.type ?? 'personal',
    pots,
    potsAdapter,
    refreshPots,
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
