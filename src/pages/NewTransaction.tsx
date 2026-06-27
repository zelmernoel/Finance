import { useEffect, useState, type FormEvent } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Category, Transaction, Frequency } from '../types';
import type { StorageAdapter } from '../lib/storage';
import Card from '../components/Card';
import { ACCENT } from '../utils';
import { calcNextDue } from '../hooks/useRecurringTransactions';

interface Props {
  categories: Category[];
  onSubmit: (t: Transaction) => Promise<void>;
  onAddCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  storage: StorageAdapter | null;
  budgetId: string;
}

const DEFAULT_EXPENSE_CATS = ['Lebensmittel', 'Transport', 'Freizeit', 'Kleidung', 'Technik', 'Bildung', 'Sonstiges'];
const DEFAULT_INCOME_CATS  = ['Lohn', 'Nebeneinkommen', 'Geschenk', 'Sonstiges'];
const FREQ_LABELS: Record<Frequency, string> = {
  daily: 'Täglich', weekly: 'Wöchentlich',
  monthly: 'Monatlich', yearly: 'Jährlich',
};

const inputCls = 'w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-3 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5] min-h-[44px]';
const labelCls = 'block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2';

export default function NewTransaction({ categories, onSubmit, onAddCategory, storage, budgetId }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType]           = useState<'income' | 'expense'>('expense');
  const [date, setDate]           = useState(today);
  const [amount, setAmount]       = useState('');
  const [category, setCategory]   = useState('');
  const [description, setDesc]    = useState('');
  const [note, setNote]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);
  const [newCatName, setNewCat]   = useState('');
  const [showNewCat, setShowNewCat] = useState(false);

  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency]     = useState<Frequency>('monthly');
  const [endDate, setEndDate]         = useState('');

  const relevantCats = categories.filter(c => c.type === type).map(c => c.name);
  const fallbackCats = type === 'expense' ? DEFAULT_EXPENSE_CATS : DEFAULT_INCOME_CATS;
  const catOptions   = relevantCats.length > 0 ? relevantCats : fallbackCats;

  useEffect(() => { setCategory(''); }, [type]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date || !amount || !category || !description) return;
    const parsed = parseFloat(amount.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) return;

    setLoading(true);
    try {
      const tx: Transaction = {
        id: uuidv4(), date, type, amount: parsed,
        category, description, note,
      };
      await onSubmit(tx);

      if (isRecurring && storage) {
        let nextDue = date;
        while (nextDue < today) nextDue = calcNextDue(nextDue, frequency);
        await storage.addRecurring({
          id: uuidv4(), budgetId, amount: parsed, type,
          category, description, note,
          frequency, startDate: date,
          endDate: endDate || undefined,
          nextDue: calcNextDue(date, frequency),
          isActive: true,
        });
      }

      setAmount(''); setDesc(''); setNote('');
      setDate(today); setCategory('');
      setIsRecurring(false); setEndDate('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) return;
    await onAddCategory(newCatName.trim(), type);
    setCategory(newCatName.trim());
    setNewCat(''); setShowNewCat(false);
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card className="p-5 md:p-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">Neue Transaktion</h1>
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Type */}
          <div>
            <label className={labelCls}>Typ</label>
            <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
              {(['expense', 'income'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`flex-1 py-3 text-sm font-medium transition-colors min-h-[44px] ${type === t ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                  style={type === t ? { backgroundColor: ACCENT } : undefined}>
                  {t === 'expense' ? 'Ausgabe' : 'Einnahme'}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className={labelCls}>Datum</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              className={inputCls} />
          </div>

          {/* Amount */}
          <div>
            <label className={labelCls}>Betrag (€)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">€</span>
              <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0,00" required
                className={`${inputCls} pl-7`} />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className={labelCls}>Kategorie</label>
            <div className="flex gap-2">
              <select value={category} onChange={e => setCategory(e.target.value)} required
                className={`flex-1 ${inputCls} bg-white dark:bg-gray-700`}>
                <option value="">Kategorie wählen</option>
                {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewCat(v => !v)}
                className="px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">
                + Neu
              </button>
            </div>
            {showNewCat && (
              <div className="flex gap-2 mt-2">
                <input value={newCatName} onChange={e => setNewCat(e.target.value)}
                  placeholder="Neue Kategorie..."
                  className={inputCls}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddCategory())} />
                <button type="button" onClick={handleAddCategory}
                  className="px-3 py-2.5 text-sm text-white rounded min-h-[44px]" style={{ backgroundColor: ACCENT }}>
                  Hinzufügen
                </button>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Beschreibung</label>
            <input value={description} onChange={e => setDesc(e.target.value)}
              placeholder="z. B. Wocheneinkauf Rewe" required
              className={inputCls} />
          </div>

          {/* Note */}
          <div>
            <label className={labelCls}>
              Notiz <span className="normal-case font-normal">(optional)</span>
            </label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optionale Notiz..."
              className={inputCls} />
          </div>

          {/* Recurring toggle */}
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
              <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300" style={{ accentColor: ACCENT }} />
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Als Dauerauftrag einrichten</span>
            </label>
            {isRecurring && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Frequenz</label>
                  <select value={frequency} onChange={e => setFrequency(e.target.value as Frequency)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]">
                    {(Object.entries(FREQ_LABELS) as [Frequency, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Enddatum (optional)</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]" />
                </div>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 text-sm font-semibold text-white rounded transition-opacity disabled:opacity-50 min-h-[44px]"
            style={{ backgroundColor: ACCENT }}>
            {loading ? 'Speichern…' : 'Transaktion speichern'}
          </button>

          {success && (
            <div className="text-center text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded py-2">
              Transaktion erfolgreich gespeichert.
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
