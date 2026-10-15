import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { FREQUENCY_LABELS, type Budget, type Category, type Frequency, type SavingsPot, type Transaction } from '../types';
import type { StorageAdapter } from '../lib/storage';
import Card from '../components/Card';
import { ACCENT, formatDate, formatEuro, todayISO } from '../utils';
import { anchorDayOf, calcNextDue } from '../hooks/useRecurringTransactions';
import { saveReceipt, fileToDataUrl } from '../lib/receiptStorage';
import {
  TAX_RATES, amountToInput, isValidTaxSplit, netFromGross, parseAmount, round2,
} from '../lib/money';
import { loadCategoryOrder, sortByCategoryOrder } from '../hooks/useCategoryColors';

// ── Buchungs-Wizard ───────────────────────────────────────────────────────────
//
// Vier Schritte statt eines langen Formulars, weil auf dem Handy jeder Schritt
// auf einen Bildschirm passt und nur das fragt, was gerade dran ist:
//
//   1  Was?      Typ + Kategorie (Tipp auf die Kachel springt weiter)
//   2  Wie viel? Brutto; im Firmenbereich dazu Steuer → Netto
//   3  Details   Datum, Beschreibung, Dauerauftrag, Beleg, Notizen
//   4  Prüfen    Zusammenfassung, dann Speichern
//
// Die Kategorie trägt Vorbelegungen (Steuersatz, Dauerauftrag): der Wizard
// setzt sie, der Nutzer bestätigt oder ändert sie. Die Steuer selbst wird nur
// hier zerlegt; die Buchung ins Steuertopf macht der DB-Trigger.

interface Props {
  categories: Category[];
  onSubmit: (t: Transaction) => Promise<void>;
  onAddCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  onSuccess: (tab: 'dashboard' | 'recurring') => void;
  storage: StorageAdapter | null;
  budgetId: string;
  budgetType: Budget['type'];
  pots: SavingsPot[];
  /** Von der Daueraufträge-Seite aus: Wiederholung gleich vorbelegen. */
  presetRecurring?: boolean;
}

type TxType = 'income' | 'expense';
/**
 * none   keine Steuer enthalten
 * rate   Netto aus Brutto und Satz gerechnet
 * custom Netto von der Rechnung abgetippt
 * full   die Buchung IST Steuer: Zahlung ans Finanzamt bzw. Erstattung
 */
type TaxMode = 'none' | 'rate' | 'custom' | 'full';

const STEPS = ['Was?', 'Wie viel?', 'Details', 'Prüfen'] as const;
const FREQ_LABELS = FREQUENCY_LABELS;

const inputCls = 'w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-3 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[var(--accent)] min-h-[44px]';
const labelCls = 'block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2';
const chipCls  = (active: boolean) =>
  `px-3 py-2 text-sm rounded border min-h-[40px] transition-colors ${
    active
      ? 'text-white border-transparent'
      : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
  }`;
const chipStyle = (active: boolean) => (active ? { backgroundColor: ACCENT } : undefined);

export default function NewTransaction({
  categories, onSubmit, onAddCategory, onSuccess, storage, budgetId, budgetType, pots, presetRecurring = false,
}: Props) {
  const today = todayISO();
  const isBusiness = budgetType === 'business';

  const [step, setStep]         = useState(0);
  const [type, setType]         = useState<TxType>('expense');
  const [category, setCategory] = useState('');

  // Schritt 2 — Beträge als Strings, damit "12," beim Tippen nicht sofort
  // zu 12 wird (so hat das alte Bearbeiten-Modal Kommas verschluckt).
  const [gross, setGross]       = useState('');
  const [taxMode, setTaxMode]   = useState<TaxMode>('none');
  const [taxRate, setTaxRate]   = useState<number>(19);
  const [net, setNet]           = useState('');

  // Schritt 3
  const [date, setDate]               = useState(today);
  const [description, setDesc]        = useState('');
  const [notes, setNotes]             = useState<string[]>(['']);
  const [isRecurring, setIsRecurring] = useState(presetRecurring);
  const [frequency, setFrequency]     = useState<Frequency>('monthly');
  const [endDate, setEndDate]         = useState('');
  const [receiptDataUrl, setReceiptDataUrl]   = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const [receiptProcessing, setReceiptProcessing] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const [newCatName, setNewCat]     = useState('');
  const [showNewCat, setShowNewCat] = useState(false);
  const [stepError, setStepError]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [success, setSuccess]       = useState(false);
  const [afterSaveNote, setAfterSaveNote] = useState<string | null>(null);

  const grossRef = useRef<HTMLInputElement>(null);
  const descRef  = useRef<HTMLInputElement>(null);

  // ── Abgeleitete Beträge ───────────────────────────────────────────────────
  // Im Modus "rate" ist das Netto eine Ableitung aus Brutto und Satz und wird
  // bei jeder Änderung neu gerechnet. Im Modus "custom" ist es die Eingabe
  // von der Rechnung — dann gilt, was im Feld steht.
  const grossNum  = parseAmount(gross) ?? 0;
  const netInput  = taxMode === 'rate'
    ? (grossNum > 0 ? amountToInput(netFromGross(grossNum, taxRate)) : '')
    : taxMode === 'full' ? '0' : net;
  const netNum    = taxMode === 'none' ? grossNum : taxMode === 'full' ? 0 : (parseAmount(netInput) ?? 0);
  const taxNum    = taxMode === 'none' ? 0 : round2(grossNum - netNum);
  const taxPot    = pots.find(p => p.kind === 'tax');

  // In der Reihenfolge, die in den Einstellungen festgelegt wurde (gerätelokal).
  const catOptions = useMemo(
    () => sortByCategoryOrder(categories.filter(c => c.type === type), loadCategoryOrder(budgetId)),
    [categories, type, budgetId],
  );

  // ── Vorbelegungen aus der Kategorie ──────────────────────────────────────
  function applyCategoryDefaults(cat: Category | undefined) {
    if (cat?.defaultFrequency) { setIsRecurring(true); setFrequency(cat.defaultFrequency); }
    else setIsRecurring(presetRecurring);

    if (isBusiness && cat?.defaultTaxRate != null && cat.defaultTaxRate > 0) {
      setTaxMode('rate'); setTaxRate(cat.defaultTaxRate);
    } else {
      setTaxMode('none');
    }
  }

  function pickCategory(name: string) {
    setCategory(name);
    applyCategoryDefaults(categories.find(c => c.name === name && c.type === type));
    setStepError(null);
    setStep(1);
  }

  function switchType(t: TxType) {
    if (t === type) return;
    setType(t);
    setCategory('');
    setShowNewCat(false);
  }

  async function handleAddCategory() {
    const name = newCatName.trim();
    if (!name) return;
    await onAddCategory(name, type);
    setNewCat(''); setShowNewCat(false);
    pickCategory(name);
  }

  // ── Beleg ─────────────────────────────────────────────────────────────────
  async function handleReceiptFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptProcessing(true);
    setReceiptError(null);
    try {
      setReceiptDataUrl(await fileToDataUrl(file));
      setReceiptFileName(file.name);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Datei konnte nicht geladen werden');
    } finally {
      setReceiptProcessing(false);
      e.target.value = '';
    }
  }

  // ── Schrittwechsel mit Prüfung ────────────────────────────────────────────
  function validateStep(s: number): string | null {
    if (s === 0 && !category) return 'Bitte eine Kategorie wählen.';
    if (s === 1) {
      if (grossNum <= 0) return 'Bitte einen Betrag größer als 0 eingeben.';
      if (taxMode !== 'none' && !isValidTaxSplit(grossNum, taxNum)) {
        return 'Das Netto muss zwischen 0 und dem Brutto liegen.';
      }
    }
    if (s === 2) {
      if (!date) return 'Bitte ein Datum wählen.';
      if (!description.trim()) return 'Bitte eine Beschreibung eingeben.';
      if (isRecurring && endDate && endDate < date) return 'Das Enddatum liegt vor dem Startdatum.';
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    setStepError(err);
    if (!err) setStep(s => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepError(null);
    setStep(s => Math.max(s - 1, 0));
  }

  // Enter im Betrags- oder Beschreibungsfeld → weiter, wie ein "Weiter"-Tipp.
  function onEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); next(); }
  }

  useEffect(() => {
    if (step === 1) grossRef.current?.focus();
    if (step === 2) descRef.current?.focus();
  }, [step]);

  // ── Speichern ─────────────────────────────────────────────────────────────
  async function handleSave() {
    for (let s = 0; s < 3; s++) {
      const err = validateStep(s);
      if (err) { setStep(s); setStepError(err); return; }
    }
    setLoading(true);
    setStepError(null);
    try {
      const noteValue = notes.filter(n => n.trim()).join('\n') || undefined;
      const tx: Transaction = {
        id: uuidv4(), date, type,
        amount: round2(grossNum), taxAmount: taxNum,
        category, description: description.trim(), note: noteValue,
      };
      await onSubmit(tx);
      let note: string | null = null;
      if (receiptDataUrl && !saveReceipt(tx.id, receiptDataUrl)) {
        note = 'Buchung gespeichert, aber der Beleg passte nicht mehr in den lokalen Speicher.';
        setAfterSaveNote(note);
      }

      if (isRecurring && storage) {
        await storage.addRecurring({
          id: uuidv4(), budgetId, amount: tx.amount, taxAmount: taxNum, type,
          category, description: tx.description, note: noteValue,
          frequency, startDate: date,
          endDate: endDate || undefined,
          nextDue: calcNextDue(date, frequency, anchorDayOf(date)),
          isActive: true,
        });
      }

      const wasRecurring = isRecurring;
      setSuccess(true);
      setTimeout(() => onSuccess(wasRecurring ? 'recurring' : 'dashboard'), note ? 2500 : 700);
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Fehler beim Speichern');
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const typeLabel = type === 'expense' ? 'Ausgabe' : 'Einnahme';

  return (
    <div className="max-w-lg mx-auto">
      <Card className="p-5 md:p-6">
        {/* Kopf: Schrittanzeige */}
        <div className="mb-5">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {step === 0 ? 'Neue Buchung' : STEPS[step]}
            </h1>
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              Schritt {step + 1} von {STEPS.length}
            </span>
          </div>
          <div className="flex gap-1 mt-3">
            {STEPS.map((label, i) => (
              <div key={label} className="h-1 flex-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: i <= step ? '100%' : '0%', backgroundColor: ACCENT }} />
              </div>
            ))}
          </div>
          {step > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">
              {typeLabel} · {category}{step > 1 && grossNum > 0 ? ` · ${formatEuro(grossNum)}` : ''}
            </p>
          )}
        </div>

        {success ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-white text-xl" style={{ backgroundColor: ACCENT }}>✓</div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Buchung gespeichert</p>
            {afterSaveNote && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{afterSaveNote}</p>}
          </div>
        ) : (
          <>
            {/* ── Schritt 1: Was? ───────────────────────────────────────── */}
            {step === 0 && (
              <div className="space-y-5">
                <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
                  {(['expense', 'income'] as const).map(t => (
                    <button key={t} type="button" onClick={() => switchType(t)}
                      className={`flex-1 py-3 text-sm font-medium transition-colors min-h-[44px] ${type === t ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                      style={chipStyle(type === t)}>
                      {t === 'expense' ? 'Ausgabe' : 'Einnahme'}
                    </button>
                  ))}
                </div>

                <div>
                  <label className={labelCls}>Kategorie</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {catOptions.map(c => {
                      const hints = [
                        isBusiness && c.defaultTaxRate ? `${c.defaultTaxRate} % USt` : null,
                        c.defaultFrequency ? FREQ_LABELS[c.defaultFrequency] : null,
                      ].filter(Boolean);
                      const active = category === c.name;
                      return (
                        <button key={c.id} type="button" onClick={() => pickCategory(c.name)}
                          className={`text-left px-3 py-3 rounded border min-h-[56px] transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          style={chipStyle(active)}>
                          <span className="block text-sm font-medium truncate">{c.name}</span>
                          {hints.length > 0 && (
                            <span className={`block text-[11px] mt-0.5 truncate ${active ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'}`}>
                              {hints.join(' · ')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => setShowNewCat(v => !v)}
                      className="text-left px-3 py-3 rounded border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 min-h-[56px] hover:bg-gray-50 dark:hover:bg-gray-700">
                      + Neue Kategorie
                    </button>
                  </div>
                  {catOptions.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                      Noch keine {typeLabel}-Kategorien in diesem Bereich. Lege die erste an.
                    </p>
                  )}
                  {showNewCat && (
                    <div className="flex gap-2 mt-3">
                      <input value={newCatName} onChange={e => setNewCat(e.target.value)} autoFocus
                        placeholder="Name der Kategorie" className={inputCls}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddCategory())} />
                      <button type="button" onClick={handleAddCategory}
                        className="px-4 text-sm text-white rounded min-h-[44px] whitespace-nowrap" style={{ backgroundColor: ACCENT }}>
                        Anlegen
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Schritt 2: Wie viel? ──────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>{isBusiness ? 'Betrag brutto (€)' : 'Betrag (€)'}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">€</span>
                    <input ref={grossRef} type="text" inputMode="decimal" value={gross}
                      onChange={e => setGross(e.target.value)} onKeyDown={onEnter}
                      placeholder="0,00" className={`${inputCls} pl-7 text-2xl font-semibold tabular-nums py-3`} />
                  </div>
                </div>

                {isBusiness && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded p-3 space-y-3">
                    <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[32px]">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {type === 'income' ? 'Umsatzsteuer enthalten?' : 'Vorsteuer enthalten?'}
                      </span>
                      <input type="checkbox" checked={taxMode !== 'none'}
                        onChange={e => { setTaxMode(e.target.checked ? 'rate' : 'none'); if (!e.target.checked) setNet(''); }}
                        className="w-5 h-5 rounded border-gray-300" style={{ accentColor: ACCENT }} />
                    </label>

                    {taxMode === 'none' ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {type === 'income'
                          ? 'Aus: Betrag ohne ausgewiesene USt (z. B. Privat­einlage).'
                          : 'Aus: keine deutsche USt auf der Rechnung, z. B. Reverse Charge bei ausländischen Anbietern.'}
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {TAX_RATES.map(r => (
                            <button key={r} type="button" onClick={() => { setTaxMode('rate'); setTaxRate(r); }}
                              className={chipCls(taxMode === 'rate' && taxRate === r)} style={chipStyle(taxMode === 'rate' && taxRate === r)}>
                              {r} %
                            </button>
                          ))}
                          <button type="button" onClick={() => { setNet(netInput); setTaxMode('custom'); }}
                            className={chipCls(taxMode === 'custom')} style={chipStyle(taxMode === 'custom')}>
                            Netto von der Rechnung
                          </button>
                          <button type="button" onClick={() => setTaxMode('full')}
                            className={chipCls(taxMode === 'full')} style={chipStyle(taxMode === 'full')}>
                            {type === 'income' ? 'Erstattung vom Finanzamt' : 'Zahlung ans Finanzamt'}
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={labelCls}>Netto (€)</label>
                            <input type="text" inputMode="decimal" value={netInput} disabled={taxMode === 'full'}
                              onChange={e => { setTaxMode('custom'); setNet(e.target.value); }}
                              placeholder="0,00" className={`${inputCls} tabular-nums disabled:opacity-60`} />
                          </div>
                          <div>
                            <label className={labelCls}>Steuer (€)</label>
                            <div className={`${inputCls} tabular-nums bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center`}>
                              {grossNum > 0 && isValidTaxSplit(grossNum, taxNum) ? formatEuro(taxNum) : '—'}
                            </div>
                          </div>
                        </div>

                        {grossNum > 0 && isValidTaxSplit(grossNum, taxNum) && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {taxMode === 'full'
                              ? (type === 'income'
                                ? `Erstattung: ${formatEuro(taxNum)} gehen in den Topf „${taxPot?.name ?? 'Umsatzsteuer'}“ (gleicht einen negativen Stand aus).`
                                : `Steuerzahlung: der Topf „${taxPot?.name ?? 'Umsatzsteuer'}“ wird um ${formatEuro(taxNum)} geleert, das Verfügbare bleibt gleich.`)
                              : type === 'income'
                                ? `${formatEuro(taxNum)} wandern in den Topf „${taxPot?.name ?? 'Umsatzsteuer'}“ und zählen nicht als verfügbar.`
                                : `${formatEuro(taxNum)} Vorsteuer werden vom Topf „${taxPot?.name ?? 'Umsatzsteuer'}“ abgezogen (Vorsteuerabzug).`}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Schritt 3: Details ────────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>Beschreibung</label>
                  <input ref={descRef} value={description} onChange={e => setDesc(e.target.value)} onKeyDown={onEnter}
                    placeholder={type === 'expense' ? 'z. B. Wocheneinkauf Rewe' : 'z. B. Rechnung ANZ-002'} className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Datum</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
                </div>

                <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
                  <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[32px]">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Als Dauerauftrag wiederholen</span>
                    <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300" style={{ accentColor: ACCENT }} />
                  </label>
                  {isRecurring && (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {(Object.entries(FREQ_LABELS) as [Frequency, string][]).map(([v, l]) => (
                          <button key={v} type="button" onClick={() => setFrequency(v)}
                            className={chipCls(frequency === v)} style={chipStyle(frequency === v)}>{l}</button>
                        ))}
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Enddatum (optional)</label>
                        <input type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} className={inputCls} />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Diese Buchung wird heute angelegt; die nächste folgt am {formatDate(calcNextDue(date, frequency, anchorDayOf(date)))}, immer mit denselben Beträgen.
                      </p>
                    </div>
                  )}
                </div>

                <ReceiptField
                  dataUrl={receiptDataUrl} fileName={receiptFileName} processing={receiptProcessing} error={receiptError}
                  onFile={handleReceiptFile} onClear={() => { setReceiptDataUrl(null); setReceiptFileName(null); }}
                />

                <div>
                  <label className={labelCls}>Notizen <span className="normal-case font-normal">(optional)</span></label>
                  <div className="space-y-2">
                    {notes.map((n, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input value={n} onChange={e => setNotes(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                          placeholder={`Notiz ${notes.length > 1 ? i + 1 : ''}…`} className={`flex-1 ${inputCls}`} />
                        {notes.length > 1 && (
                          <button type="button" onClick={() => setNotes(prev => prev.filter((_, j) => j !== i))}
                            className="text-gray-300 dark:text-gray-600 hover:text-red-400 flex-shrink-0 px-1" aria-label="Notiz entfernen">✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setNotes(prev => [...prev, ''])}
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                      + Notiz hinzufügen
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Schritt 4: Prüfen ─────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <dl className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                  <SummaryRow label={typeLabel} value={category} onEdit={() => setStep(0)} />
                  <SummaryRow
                    label={isBusiness && taxMode !== 'none' ? 'Brutto' : 'Betrag'}
                    value={formatEuro(grossNum)} strong onEdit={() => setStep(1)} />
                  {isBusiness && taxMode !== 'none' && (
                    <>
                      <SummaryRow label="Netto" value={formatEuro(netNum)} />
                      <SummaryRow
                        label={taxMode === 'full' ? (type === 'income' ? 'Erstattung' : 'Steuerzahlung') : type === 'income' ? 'Umsatzsteuer' : 'Vorsteuer'}
                        value={`${type === 'income' ? '+' : '−'} ${formatEuro(taxNum)} → Topf „${taxPot?.name ?? 'Umsatzsteuer'}“`} />
                    </>
                  )}
                  <SummaryRow label="Datum" value={formatDate(date)} onEdit={() => setStep(2)} />
                  <SummaryRow label="Beschreibung" value={description} onEdit={() => setStep(2)} />
                  <SummaryRow label="Dauerauftrag"
                    value={isRecurring ? `${FREQ_LABELS[frequency]}${endDate ? ` bis ${formatDate(endDate)}` : ''}` : 'Nein'}
                    onEdit={() => setStep(2)} />
                  {receiptDataUrl && <SummaryRow label="Beleg" value={receiptFileName ?? 'angehängt'} />}
                  {notes.some(n => n.trim()) && <SummaryRow label="Notizen" value={notes.filter(n => n.trim()).join(' · ')} />}
                </dl>
              </div>
            )}

            {stepError && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{stepError}</p>}

            {/* ── Fuß: Zurück / Weiter / Speichern ─────────────────────── */}
            <div className={`flex gap-3 mt-6 ${step === 0 ? 'justify-end' : ''}`}>
              {step > 0 && (
                <button type="button" onClick={back} disabled={loading}
                  className="px-4 py-3 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">
                  Zurück
                </button>
              )}
              {step > 0 && step < STEPS.length - 1 && (
                <button type="button" onClick={next}
                  className="flex-1 py-3 text-sm font-semibold text-white rounded min-h-[44px]" style={{ backgroundColor: ACCENT }}>
                  Weiter
                </button>
              )}
              {step === STEPS.length - 1 && (
                <button type="button" onClick={handleSave} disabled={loading}
                  className="flex-1 py-3 text-sm font-semibold text-white rounded min-h-[44px] disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                  {loading ? 'Speichern…' : 'Buchung speichern'}
                </button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ── Bausteine ─────────────────────────────────────────────────────────────────

function SummaryRow({ label, value, strong, onEdit }: { label: string; value: string; strong?: boolean; onEdit?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0 w-28">{label}</dt>
      <dd className={`flex-1 text-right break-words ${strong ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}>
        {value}
      </dd>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0">
          Ändern
        </button>
      ) : <span className="w-[42px] flex-shrink-0" />}
    </div>
  );
}

function ReceiptField({ dataUrl, fileName, processing, error, onFile, onClear }: {
  dataUrl: string | null; fileName: string | null; processing: boolean; error: string | null;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void; onClear: () => void;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2.5">Beleg (optional)</p>
      {dataUrl ? (
        <div className="relative">
          {dataUrl.startsWith('data:application/pdf') ? (
            <div className="flex items-center gap-2 px-3 py-3 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">📄 {fileName ?? 'dokument.pdf'}</span>
            </div>
          ) : (
            <img src={dataUrl} alt="Beleg" className="w-full max-h-48 object-contain rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800" />
          )}
          <button type="button" onClick={onClear}
            className="absolute top-1.5 right-1.5 bg-gray-900/60 hover:bg-gray-900/80 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs">✕</button>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <label className="lg:hidden flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-200 dark:border-gray-600 rounded text-sm text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">
            📷 Kamera
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
          </label>
          <label className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-200 dark:border-gray-600 rounded text-sm text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">
            <span className="lg:hidden">Galerie / Datei</span>
            <span className="hidden lg:inline">Datei anhängen</span>
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
          </label>
          {processing && <span className="text-xs text-gray-400 dark:text-gray-500 self-center">Verarbeite…</span>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
