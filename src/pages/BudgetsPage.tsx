import { useState, useEffect, type FormEvent } from 'react';
import type { Budget } from '../types';
import { useBudget } from '../context/BudgetContext';
import { useAuth } from '../context/AuthContext';
import { createSupabaseAdapter } from '../lib/supabaseAdapter';
import { createLocalStorageAdapter } from '../lib/localStorageAdapter';
import Card from '../components/Card';
import { formatEuro, ACCENT } from '../utils';

const PRESET_COLORS = [
  '#4A6FA5', '#2D6A4F', '#6B4C9A', '#C77D00', '#B5001B',
  '#1A6985', '#374151', '#8B5CF6', '#059669', '#DC2626',
];

export default function BudgetsPage() {
  const {
    budgets, activeBudgetId, defaultBudgetId, setActiveBudgetId, setDefaultBudgetId,
    createBudget, updateBudget, deleteBudget,
  } = useBudget();
  const { user } = useAuth();

  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);

  useEffect(() => {
    if (!budgets.length) return;
    setBalancesLoading(true);
    Promise.all(
      budgets.map(async b => {
        const adapter = user
          ? createSupabaseAdapter(user.id, b.id)
          : createLocalStorageAdapter(b.id);
        try {
          const [txs, settings] = await Promise.all([
            adapter.getTransactions(),
            adapter.getSettings(),
          ]);
          const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
          const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
          return [b.id, (settings.startingBalance ?? 0) + income - expense] as const;
        } catch {
          return [b.id, null] as const;
        }
      })
    ).then(entries => {
      setBalances(Object.fromEntries(entries));
      setBalancesLoading(false);
    });
  }, [budgets, user]);

  const knownBalances = Object.values(balances).filter((v): v is number => v !== null);
  const totalBalance  = knownBalances.reduce((s, v) => s + v, 0);
  const allLoaded     = !balancesLoading && knownBalances.length === budgets.length;

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<Budget['type']>('personal');
  const [formBalance, setFormBalance] = useState('');
  const [formColor, setFormColor] = useState(ACCENT);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const balance = parseFloat(formBalance.replace(',', '.')) || 0;
      await createBudget(formName.trim(), formType, balance, formColor);
      setFormName(''); setFormBalance(''); setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try { await deleteBudget(id); }
    catch (e) { alert(e instanceof Error ? e.message : 'Fehler'); }
    setDeleteConfirm(null);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Bereiche</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 text-sm font-medium text-white rounded"
          style={{ backgroundColor: ACCENT }}
        >
          + Neuer Bereich
        </button>
      </div>

      {/* ── Gesamtübersicht ─────────────────────────────────────────────── */}
      {budgets.length > 1 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Gesamtguthaben</p>
            {balancesLoading && (
              <div className="w-4 h-4 border-2 border-gray-200 dark:border-gray-600 rounded-full animate-spin" style={{ borderTopColor: ACCENT }} />
            )}
          </div>
          <p className={`text-2xl font-bold tabular-nums ${allLoaded ? (totalBalance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100') : 'text-gray-300 dark:text-gray-600'}`}>
            {allLoaded ? formatEuro(totalBalance) : '—'}
          </p>
          {allLoaded && budgets.length > 1 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-x-4 gap-y-1.5">
              {budgets.map(b => {
                const bal = balances[b.id];
                return (
                  <div key={b.id} className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]">{b.name}</span>
                    <span className={`text-xs font-medium tabular-nums ${bal === null ? 'text-gray-300' : bal < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                      {bal === null ? '—' : formatEuro(bal)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}


      {/* Create form */}
      {showForm && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">Bereich erstellen</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Name</label>
              <input
                value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="z. B. Firma 2026"
                required
                className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Typ</label>
                <select
                  value={formType} onChange={e => setFormType(e.target.value as Budget['type'])}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]"
                >
                  <option value="personal">Privat</option>
                  <option value="business">Firma</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Startguthaben (€)</label>
                <input
                  value={formBalance} onChange={e => setFormBalance(e.target.value)}
                  placeholder="0,00" inputMode="decimal"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Farbe</label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => setFormColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${formColor === c ? 'border-gray-900 dark:border-gray-100 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit" disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {saving ? 'Erstellen…' : 'Bereich erstellen'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Abbrechen
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Budget list */}
      <div className="space-y-3">
        {budgets.map(b => (
          <BudgetCard
            key={b.id}
            budget={b}
            balance={balances[b.id] ?? null}
            balanceLoading={balancesLoading}
            isActive={b.id === activeBudgetId}
            isDefault={b.id === defaultBudgetId}
            onActivate={() => setActiveBudgetId(b.id)}
            onSetDefault={() => setDefaultBudgetId(b.id)}
            deleteConfirm={deleteConfirm}
            onDeleteConfirm={setDeleteConfirm}
            onDelete={handleDelete}
            editingId={editingId}
            setEditingId={setEditingId}
            onUpdate={updateBudget}
          />
        ))}
      </div>
    </div>
  );
}

// ── BudgetCard ────────────────────────────────────────────────────────────────

function BudgetCard({
  budget, balance, balanceLoading, isActive, isDefault, onActivate, onSetDefault,
  deleteConfirm, onDeleteConfirm, onDelete,
  editingId, setEditingId, onUpdate,
}: {
  budget: Budget;
  balance: number | null;
  balanceLoading: boolean;
  isActive: boolean;
  isDefault: boolean;
  onActivate: () => void;
  onSetDefault: () => void;
  deleteConfirm: string | null;
  onDeleteConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Budget>) => Promise<void>;
}) {
  const [editName, setEditName] = useState(budget.name);
  const [editBalance, setEditBalance] = useState(String(budget.startingBalance));
  const [saving, setSaving] = useState(false);

  const isEditing = editingId === budget.id;

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(budget.id, {
        name: editName.trim() || budget.name,
        startingBalance: parseFloat(editBalance.replace(',', '.')) || 0,
      });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={`p-4 ${isActive ? 'border-l-4' : ''}`} style={isActive ? { borderLeftColor: budget.color } as React.CSSProperties : undefined}>
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: budget.color }} />
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex gap-2">
              <input
                value={editName} onChange={e => setEditName(e.target.value)}
                className="flex-1 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]"
              />
              <input
                value={editBalance} onChange={e => setEditBalance(e.target.value)}
                placeholder="Startguthaben"
                className="w-28 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]"
              />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {budget.name}
                  {isActive && <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">(aktiv)</span>}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {budget.type === 'business' ? 'Firma' : 'Privat'}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                {balanceLoading ? (
                  <div className="w-3 h-3 border-2 border-gray-200 dark:border-gray-600 rounded-full animate-spin mx-auto" style={{ borderTopColor: budget.color }} />
                ) : (
                  <p className={`text-sm font-semibold tabular-nums ${balance === null ? 'text-gray-300' : balance < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {balance === null ? '—' : formatEuro(balance)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isActive && !isEditing && (
            <button onClick={onActivate}
              className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
              Wechseln
            </button>
          )}
          {!isEditing && (
            <button
              onClick={onSetDefault}
              title={isDefault ? 'Standard-Bereich' : 'Als Standard festlegen'}
              className={`p-1 transition-colors ${isDefault ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'}`}
            >
              <svg className="w-4 h-4" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          )}
          {isEditing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="text-xs px-2 py-1 text-white rounded disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}>
                {saving ? '…' : 'Speichern'}
              </button>
              <button onClick={() => setEditingId(null)}
                className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300">Abbruch</button>
            </>
          ) : (
            <button onClick={() => { setEditName(budget.name); setEditBalance(String(budget.startingBalance)); setEditingId(budget.id); }}
              className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {deleteConfirm === budget.id ? (
            <div className="flex gap-1">
              <button onClick={() => onDelete(budget.id)}
                className="text-xs px-2 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded">Ja</button>
              <button onClick={() => onDeleteConfirm(null)}
                className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">Nein</button>
            </div>
          ) : (
            <button onClick={() => onDeleteConfirm(budget.id)}
              className="p-1 text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
