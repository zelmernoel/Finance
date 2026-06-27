import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { RecurringTransaction, Category, Frequency } from '../types';
import type { StorageAdapter } from '../lib/storage';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { formatEuro, formatDate, ACCENT } from '../utils';
import { calcNextDue } from '../hooks/useRecurringTransactions';

const FREQ_LABELS: Record<Frequency, string> = {
  daily: 'Täglich', weekly: 'Wöchentlich',
  monthly: 'Monatlich', yearly: 'Jährlich',
};

interface Props {
  storage: StorageAdapter;
  categories: Category[];
  budgetId: string;
  onNavigateToNew: () => void;
}

export default function RecurringPage({ storage, categories, budgetId, onNavigateToNew }: Props) {
  const [list, setList] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setList(await storage.getRecurring()); }
    finally { setLoading(false); }
  }, [storage]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Daueraufträge</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 text-sm font-medium text-white rounded"
          style={{ backgroundColor: ACCENT }}
        >
          + Neuer Dauerauftrag
        </button>
      </div>

      {showForm && (
        <RecurringForm
          categories={categories}
          budgetId={budgetId}
          onSave={async r => { await storage.addRecurring(r); await load(); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">Lädt…</p>
      ) : list.length === 0 ? (
        <EmptyState
          message="Noch keine Daueraufträge vorhanden."
          action={{ label: 'Erste Transaktion hinzufügen', onClick: onNavigateToNew }}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Beschreibung</th>
                  <th className="text-left px-4 py-3 font-medium">Betrag</th>
                  <th className="text-left px-4 py-3 font-medium">Kategorie</th>
                  <th className="text-left px-4 py-3 font-medium">Frequenz</th>
                  <th className="text-left px-4 py-3 font-medium">Nächste Fälligkeit</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.description}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                      <span style={r.type === 'income' ? { color: ACCENT } : undefined}>
                        {r.type === 'income' ? '+' : '−'} {formatEuro(r.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.category}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{FREQ_LABELS[r.frequency]}</td>
                    <td className={`px-4 py-3 ${r.nextDue <= today && r.isActive ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                      {formatDate(r.nextDue)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.isActive ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'}`}>
                        {r.isActive ? 'Aktiv' : 'Pausiert'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {/* Toggle active */}
                        <button
                          onClick={async () => {
                            await storage.updateRecurring(r.id, { isActive: !r.isActive });
                            await load();
                          }}
                          className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                        >
                          {r.isActive ? 'Pausieren' : 'Aktivieren'}
                        </button>
                        {deleteConfirm === r.id ? (
                          <>
                            <button
                              onClick={async () => { await storage.deleteRecurring(r.id); await load(); setDeleteConfirm(null); }}
                              className="text-xs px-2 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded"
                            >Ja</button>
                            <button onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">Nein</button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(r.id)}
                            className="p-1 text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── RecurringForm ─────────────────────────────────────────────────────────────

function RecurringForm({
  categories, budgetId, onSave, onCancel,
}: {
  categories: Category[];
  budgetId: string;
  onSave: (r: RecurringTransaction) => Promise<void>;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType]         = useState<'expense' | 'income'>('expense');
  const [amount, setAmount]     = useState('');
  const [category, setCategory] = useState('');
  const [desc, setDesc]         = useState('');
  const [freq, setFreq]         = useState<Frequency>('monthly');
  const [startDate, setStart]   = useState(today);
  const [endDate, setEnd]       = useState('');
  const [saving, setSaving]     = useState(false);

  const catOptions = categories.filter(c => c.type === type).map(c => c.name);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(',', '.'));
    if (!amt || !category || !desc) return;
    setSaving(true);
    try {
      const r: RecurringTransaction = {
        id: crypto.randomUUID(),
        budgetId,
        amount: amt,
        type, category, description: desc,
        frequency: freq,
        startDate, endDate: endDate || undefined,
        nextDue: startDate,
        isActive: true,
      };
      // Advance nextDue if startDate is in the past
      let nd = r.nextDue;
      while (nd < today) nd = calcNextDue(nd, freq);
      await onSave({ ...r, nextDue: nd });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">Neuer Dauerauftrag</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
          {(['expense', 'income'] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${type === t ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              style={type === t ? { backgroundColor: ACCENT } : undefined}>
              {t === 'expense' ? 'Ausgabe' : 'Einnahme'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Betrag (€)</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" required inputMode="decimal"
              className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Frequenz</label>
            <select value={freq} onChange={e => setFreq(e.target.value as Frequency)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]">
              {(Object.entries(FREQ_LABELS) as [Frequency, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Kategorie</label>
          <select value={category} onChange={e => setCategory(e.target.value)} required
            className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]">
            <option value="">Kategorie wählen</option>
            {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Beschreibung</label>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="z. B. Netflix Abo" required
            className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Startdatum</label>
            <input type="date" value={startDate} onChange={e => setStart(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Enddatum (optional)</label>
            <input type="date" value={endDate} onChange={e => setEnd(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]" />
          </div>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}>
            {saving ? 'Speichern…' : 'Dauerauftrag erstellen'}
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Abbrechen
          </button>
        </div>
      </form>
    </Card>
  );
}
