import { useLocation } from 'react-router-dom';
import { useAppContext } from '../MainApp';
import Dashboard from './Dashboard';
import Transactions from './Transactions';
import NewTransaction from './NewTransaction';
import Analysis from './Analysis';
import RecurringPage from './RecurringPage';
import BudgetsPage from './BudgetsPage';
import SavingsPotsPage from './SavingsPotsPage';
import SettingsPage from './Settings';

// ── Route-Views ───────────────────────────────────────────────────────────────
// Dünne Adapter zwischen Route und Seitenkomponente: sie holen den Zustand aus
// dem Outlet-Kontext der Layout-Route und reichen ihn unverändert als Props
// weiter. Die Seitenkomponenten selbst wurden dafür nicht angefasst.

export function DashboardView() {
  const c = useAppContext();
  return (
    <Dashboard
      transactions={c.transactions}
      categories={c.categories}
      pots={c.pots}
      startingBalance={c.settings.startingBalance}
      userName={c.settings.name}
      onNavigateToNew={() => c.goToTab('new')}
      onNavigateToPots={() => c.goToTab('savings')}
      onNavigateToMonth={c.goToMonth}
      monthStart={c.settings.monthStart ?? 1}
    />
  );
}

export function TransactionsView() {
  const c = useAppContext();
  return (
    <Transactions
      transactions={c.transactions}
      categories={c.categories}
      onDelete={c.deleteTransaction}
      onUpdate={c.updateTransaction}
      onNavigateToNew={() => c.goToTab('new')}
      budgetName={c.activeBudgetName}
      budgetType={c.activeBudgetType}
      userName={c.settings.name}
      showAiBadges={c.settings.showAiBadges !== false}
    />
  );
}

export function NewTransactionView() {
  const c = useAppContext();
  const location = useLocation();
  const presetRecurring = Boolean((location.state as { recurring?: boolean } | null)?.recurring);
  return (
    <NewTransaction
      categories={c.categories}
      onSubmit={c.createTransaction}
      onAddCategory={c.addCategory}
      onSuccess={c.goToTab}
      storage={c.storage}
      budgetId={c.activeBudgetId ?? ''}
      budgetType={c.activeBudgetType}
      pots={c.pots}
      presetRecurring={presetRecurring}
    />
  );
}

export function AnalysisView() {
  const c = useAppContext();
  return (
    <Analysis
      transactions={c.transactions}
      categories={c.categories}
      onNavigateToNew={() => c.goToTab('new')}
      onUpdateCategory={c.updateCategory}
      monthStart={c.settings.monthStart ?? 1}
      initialMonth={c.analysisMonth}
    />
  );
}

export function RecurringView() {
  const c = useAppContext();
  if (!c.storage || !c.activeBudgetId) return null;
  return (
    <RecurringPage
      storage={c.storage}
      onNavigateToNew={() => c.goToTab('new', { recurring: true })}
    />
  );
}

export function BudgetsView() {
  return <BudgetsPage />;
}

export function SavingsView() {
  const c = useAppContext();
  return <SavingsPotsPage pots={c.pots} adapter={c.potsAdapter} onChanged={c.refreshPots} />;
}

export function SettingsView() {
  const c = useAppContext();
  return (
    <SettingsPage
      settings={c.settings}
      categories={c.categories}
      transactions={c.transactions}
      budgetType={c.activeBudgetType}
      onSaveSettings={c.saveSettings}
      onDeleteCategory={c.deleteCategory}
      onAddCategory={c.addCategory}
      onUpdateCategory={c.updateCategory}
      onImportTransactions={c.importTransactions}
      onResetAllTransactions={c.resetAllTransactions}
      onDeleteTransactionsByPeriod={c.deleteTransactionsByPeriod}
    />
  );
}
