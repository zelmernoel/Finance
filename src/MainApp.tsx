import { useCallback, useEffect, useRef, useState } from 'react';
import type { Transaction, Category, Settings, Tab } from './types';
import { useAuth } from './context/AuthContext';
import { useBudget } from './context/BudgetContext';
import { useStorage } from './hooks/useStorage';
import { supabase } from './lib/supabase';
import { useRecurringTransactions } from './hooks/useRecurringTransactions';
import { useToast } from './components/Toast';
import Navigation from './components/Navigation';
import GuestBanner from './components/GuestBanner';
import MigrateModal from './components/MigrateModal';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import NewTransaction from './pages/NewTransaction';
import Analysis from './pages/Analysis';
import RecurringPage from './pages/RecurringPage';
import BudgetsPage from './pages/BudgetsPage';
import SettingsPage from './pages/Settings';
import {
  hasGuestData, getAllGuestData, clearAllGuestData,
} from './lib/localStorageAdapter';
import { createSupabaseAdapter } from './lib/supabaseAdapter';
import { v4 as uuidv4 } from 'uuid';
import { ACCENT } from './utils';

const DEFAULT_SETTINGS: Settings = { id: '', startingBalance: 0, name: '' };

export default function MainApp() {
  const { user } = useAuth();
  const { activeBudgetId, activeBudget, loadingBudgets } = useBudget();
  const { showToast } = useToast();

  // ── Storage adapter scoped to active budget ───────────────────────────────
  const storage = useStorage(activeBudgetId);

  // ── App state ─────────────────────────────────────────────────────────────
  const [tab, setTab]                 = useState<Tab>('dashboard');
  const [transactions, setTx]         = useState<Transaction[]>([]);
  const [categories, setCats]         = useState<Category[]>([]);
  const [settings, setSettings]       = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
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
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
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
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {!user && <GuestBanner />}
      <Navigation activeTab={tab} onTabChange={setTab} />

      <main className="max-w-screen-xl mx-auto px-4 lg:px-6 py-4 lg:py-6 pb-24 lg:pb-6">
        <div key={tab} className="tab-enter">
        {tab === 'dashboard' && (
          <Dashboard
            transactions={transactions}
            startingBalance={settings.startingBalance}
            userName={settings.name}
            onNavigateToNew={() => setTab('new')}
            monthStart={settings.monthStart ?? 1}
          />
        )}
        {tab === 'transactions' && (
          <Transactions
            transactions={transactions}
            onDelete={handleDelete}
            onNavigateToNew={() => setTab('new')}
            budgetName={activeBudget?.name ?? 'Budget'}
            userName={settings.name}
          />
        )}
        {tab === 'new' && (
          <NewTransaction
            categories={categories}
            onSubmit={handleCreate}
            onAddCategory={handleAddCategory}
            onSuccess={setTab}
            storage={storage}
            budgetId={activeBudgetId ?? ''}
          />
        )}
        {tab === 'analysis' && (
          <Analysis
            transactions={transactions}
            categories={categories}
            onNavigateToNew={() => setTab('new')}
            onUpdateCategory={handleUpdateCategory}
            monthStart={settings.monthStart ?? 1}
          />
        )}
        {tab === 'recurring' && storage && activeBudgetId && (
          <RecurringPage
            storage={storage}
            categories={categories}
            budgetId={activeBudgetId}
            onNavigateToNew={() => setTab('new')}
          />
        )}
        {tab === 'budgets' && <BudgetsPage />}
        {tab === 'settings' && (
          <SettingsPage
            settings={settings}
            categories={categories}
            transactions={transactions}
            onSaveSettings={handleSaveSettings}
            onDeleteCategory={handleDeleteCategory}
            onAddCategory={handleAddCategory}
            onUpdateCategory={handleUpdateCategory}
            onImportTransactions={handleImportTransactions}
            onResetAllTransactions={handleResetAllTransactions}
            onDeleteTransactionsByPeriod={handleDeleteTransactionsByPeriod}
          />
        )}
        </div>
      </main>

      {showMigrate && (
        <MigrateModal
          transactionCount={guestTxCount}
          onImport={handleMigrateImport}
          onDiscard={handleMigrateDiscard}
        />
      )}
    </div>
  );
}
