import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Category, Transaction, Frequency } from '../types';
import type { StorageAdapter } from '../lib/storage';
import Card from '../components/Card';
import { ACCENT } from '../utils';
import { calcNextDue } from '../hooks/useRecurringTransactions';
import { saveReceipt, fileToDataUrl } from '../lib/receiptStorage';

interface Props {
  categories: Category[];
  onSubmit: (t: Transaction) => Promise<void>;
  onAddCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  onSuccess: (tab: 'dashboard' | 'recurring') => void;
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

export default function NewTransaction({ categories, onSubmit, onAddCategory, onSuccess, storage, budgetId }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [type, setType]           = useState<'income' | 'expense'>('expense');
  const [date, setDate]           = useState(today);
  const [amount, setAmount]       = useState('');
  const [category, setCategory]   = useState('');
  const [description, setDesc]    = useState('');
  const [notes, setNotes]         = useState<string[]>(['']);
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newCatName, setNewCat]   = useState('');
  const [showNewCat, setShowNewCat] = useState(false);

  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency]     = useState<Frequency>('monthly');
  const [endDate, setEndDate]         = useState('');

  // Receipt
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const [receiptProcessing, setReceiptProcessing] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  async function handleReceiptFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptProcessing(true);
    setReceiptError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setReceiptDataUrl(dataUrl);
      setReceiptFileName(file.name);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Datei konnte nicht geladen werden');
    } finally {
      setReceiptProcessing(false);
      e.target.value = '';
    }
  }

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
    setSubmitError(null);
    try {
      const noteValue = notes.filter(n => n.trim()).join('\n') || undefined;
      const tx: Transaction = {
        id: uuidv4(), date, type, amount: parsed,
        category, description,
        note: noteValue,
      };
      await onSubmit(tx);
      if (receiptDataUrl) saveReceipt(tx.id, receiptDataUrl);

      if (isRecurring && storage) {
        let nextDue = date;
        while (nextDue < today) nextDue = calcNextDue(nextDue, frequency);
        await storage.addRecurring({
          id: uuidv4(), budgetId, amount: parsed, type,
          category, description, note: noteValue,
          frequency, startDate: date,
          endDate: endDate || undefined,
          nextDue: calcNextDue(date, frequency),
          isActive: true,
        });
      }

      const wasRecurring = isRecurring;
      setAmount(''); setDesc(''); setNotes(['']);
      setDate(today); setCategory('');
      setIsRecurring(false); setEndDate('');
      setReceiptDataUrl(null); setReceiptFileName(null);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onSuccess(wasRecurring ? 'recurring' : 'dashboard');
      }, 800);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Fehler beim Speichern');
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

          {/* Notes — dynamic list */}
          <div>
            <label className={labelCls}>
              Notizen <span className="normal-case font-normal">(optional)</span>
            </label>
            <div className="space-y-2">
              {notes.map((n, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={n}
                    onChange={e => setNotes(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                    placeholder={`Notiz ${notes.length > 1 ? i + 1 : ''}…`}
                    className={`flex-1 ${inputCls}`}
                  />
                  {notes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setNotes(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setNotes(prev => [...prev, ''])}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Notiz hinzufügen
              </button>
            </div>
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

          {/* Receipt upload */}
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2.5">
              Beleg (optional)
            </p>
            {receiptDataUrl ? (
              <div className="relative">
                {receiptDataUrl.startsWith('data:application/pdf') ? (
                  <div className="flex items-center gap-2 px-3 py-3 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
                    <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{receiptFileName ?? 'dokument.pdf'}</span>
                  </div>
                ) : (
                  <img
                    src={receiptDataUrl}
                    alt="Beleg"
                    className="w-full max-h-48 object-contain rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800"
                  />
                )}
                <button
                  type="button"
                  onClick={() => { setReceiptDataUrl(null); setReceiptFileName(null); }}
                  className="absolute top-1.5 right-1.5 bg-gray-900/60 hover:bg-gray-900/80 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors"
                >✕</button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {/* Camera — mobile only */}
                <label className="lg:hidden flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-200 dark:border-gray-600 rounded text-sm text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px] transition-colors">
                  <CameraIcon />
                  Kamera
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleReceiptFile} />
                </label>
                {/* File / Gallery — always visible */}
                <label className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-200 dark:border-gray-600 rounded text-sm text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px] transition-colors">
                  <AttachIcon />
                  <span className="lg:hidden">Galerie / Datei</span>
                  <span className="hidden lg:inline">Datei anhängen</span>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleReceiptFile} />
                </label>
                {receiptProcessing && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 self-center">Verarbeite…</span>
                )}
              </div>
            )}
            {receiptError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{receiptError}</p>}
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
          {submitError && (
            <p className="text-sm text-red-600 dark:text-red-400 text-center">
              {submitError}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  );
}
