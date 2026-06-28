import React, { useMemo } from 'react';
import { useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Category, Settings, Transaction } from '../types';
import Card from '../components/Card';
import { ACCENT, formatEuro, downloadCSV, downloadJSON, parseImportCSV } from '../utils';
import { exportTransactionsPDF } from '../lib/exportPDF';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useBudget } from '../context/BudgetContext';

interface Props {
  settings: Settings;
  categories: Category[];
  transactions: Transaction[];
  onSaveSettings: (s: Partial<Omit<Settings, 'id'>>) => Promise<void>;
  onUpdateCategory: (id: string, patch: { monthlyBudget?: number }) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onAddCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  onImportTransactions: (txs: Transaction[]) => Promise<void>;
  onResetAllTransactions: () => Promise<void>;
  onDeleteTransactionsByPeriod: (from: string, to: string) => Promise<void>;
}

// ── small reusable pieces ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function ActionRow({
  icon, title, description, action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex-shrink-0">{action}</div>
    </div>
  );
}

function Btn({
  onClick, children, variant = 'default', disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'danger';
  disabled?: boolean;
}) {
  const base = 'px-3 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-40 whitespace-nowrap';
  const styles: Record<string, string> = {
    default: 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
    accent:  'border-transparent text-white',
    danger:  'border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles[variant]}`}
      style={variant === 'accent' ? { backgroundColor: ACCENT } : undefined}
    >
      {children}
    </button>
  );
}

const inputCls = 'w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]';

// ── main component ────────────────────────────────────────────────────────────

export default function SettingsPage({
  settings, categories, transactions,
  onSaveSettings, onDeleteCategory, onAddCategory,
  onUpdateCategory, onImportTransactions, onResetAllTransactions,
  onDeleteTransactionsByPeriod,
}: Props) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { activeBudgetId } = useBudget();

  // profile
  const [name, setName]       = useState(settings.name);
  const [balance, setBalance] = useState(
    settings.startingBalance === 0 ? '' : String(settings.startingBalance).replace('.', ',')
  );
  const [monthStart, setMonthStart] = useState(settings.monthStart ?? 1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // categories tab
  const [catTab, setCatTab]           = useState<'expense' | 'income'>('expense');
  const [newCatName, setNewCatName]   = useState('');
  const [catDeleteConfirm, setCatDeleteConfirm] = useState<string | null>(null);

  // category order (localStorage, keyed by budgetId)
  const orderKey = `catOrder:${activeBudgetId ?? 'guest'}`;
  const [catOrderMap, setCatOrderMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(orderKey) ?? '{}'); }
    catch { return {}; }
  });
  const [movedInfo, setMovedInfo] = useState<{ id: string; dir: 'up' | 'down' } | null>(null);

  function saveCatOrder(map: Record<string, number>) {
    setCatOrderMap(map);
    localStorage.setItem(orderKey, JSON.stringify(map));
  }

  // csv import
  const csvRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview]   = useState<{ valid: Transaction[]; errors: string[] } | null>(null);
  const [importing, setImporting]     = useState(false);
  const [importDone, setImportDone]   = useState(false);

  // export dropdowns
  const [exportAllOpen, setExportAllOpen]     = useState(false);
  const [exportMonthOpen, setExportMonthOpen] = useState(false);

  // delete by period
  type PeriodType = 'month' | 'year' | 'range';
  const [delPeriodType, setDelPeriodType]     = useState<PeriodType>('month');
  const [delMonth, setDelMonth]               = useState(() => {
    const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [delYear, setDelYear]                 = useState(String(new Date().getFullYear()));
  const [delFrom, setDelFrom]                 = useState('');
  const [delTo, setDelTo]                     = useState('');
  const [delConfirmStep, setDelConfirmStep]   = useState<0 | 1>(0);
  const [deleting, setDeleting]               = useState(false);

  const delRange = useMemo((): { from: string; to: string } | null => {
    if (delPeriodType === 'month' && delMonth) return { from: `${delMonth}-01`, to: `${delMonth}-31` };
    if (delPeriodType === 'year'  && delYear)  return { from: `${delYear}-01-01`, to: `${delYear}-12-31` };
    if (delPeriodType === 'range' && delFrom && delTo && delFrom <= delTo) return { from: delFrom, to: delTo };
    return null;
  }, [delPeriodType, delMonth, delYear, delFrom, delTo]);

  const delCount = useMemo(() => {
    if (!delRange) return 0;
    return transactions.filter(t => t.date >= delRange.from && t.date <= delRange.to).length;
  }, [delRange, transactions]);

  // reset
  const [resetStep, setResetStep]     = useState<0 | 1 | 2>(0);
  const [resetting, setResetting]     = useState(false);

  const expenseCats = categories.filter(c => c.type === 'expense');
  const incomeCats  = categories.filter(c => c.type === 'income');
  const rawActiveCats = catTab === 'expense' ? expenseCats : incomeCats;
  const activeCats = useMemo(() =>
    [...rawActiveCats].sort((a, b) => (catOrderMap[a.id] ?? 999) - (catOrderMap[b.id] ?? 999)),
    [rawActiveCats, catOrderMap]
  );

  function moveCat(id: string, dir: 'up' | 'down') {
    const idx = activeCats.findIndex(c => c.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= activeCats.length) return;
    const newMap = { ...catOrderMap };
    newMap[activeCats[idx].id]     = swapIdx;
    newMap[activeCats[swapIdx].id] = idx;
    saveCatOrder(newMap);
    setMovedInfo({ id, dir });
    setTimeout(() => setMovedInfo(null), 260);
  }

  // ── handlers ────────────────────────────────────────────────────────────────

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const parsed = parseFloat(balance.replace(',', '.'));
      await onSaveSettings({
        name: name.trim(),
        startingBalance: isNaN(parsed) ? 0 : parsed,
        monthStart: Math.min(28, Math.max(1, monthStart)),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCat() {
    if (!newCatName.trim()) return;
    await onAddCategory(newCatName.trim(), catTab);
    setNewCatName('');
  }

  function handleExportCSV() {
    downloadCSV([...transactions].sort((a, b) => a.date.localeCompare(b.date)));
  }

  function handleExportJSON() {
    downloadJSON(
      { transactions, categories, settings, exportedAt: new Date().toISOString() },
      `finanztracker_backup_${new Date().toISOString().slice(0, 10)}.json`
    );
  }

  function getMonthlyTx() {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return transactions.filter(t => t.date.startsWith(ym));
  }

  function handleExportMonthlyCSV() { downloadCSV(getMonthlyTx()); }
  function handleExportMonthlyPDF() {
    const now = new Date();
    const label = now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    exportTransactionsPDF(getMonthlyTx(), {}, settings.name, `Monat ${label}`);
  }
  function handleExportAllPDF() {
    exportTransactionsPDF([...transactions].sort((a, b) => a.date.localeCompare(b.date)), {}, settings.name, 'Alle Transaktionen');
  }

  async function handleDeleteByPeriod() {
    if (!delRange || !delCount) return;
    setDeleting(true);
    try {
      await onDeleteTransactionsByPeriod(delRange.from, delRange.to);
      setDelConfirmStep(0);
    } finally {
      setDeleting(false);
    }
  }

  function handleCsvFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setCsvPreview(parseImportCSV(ev.target?.result as string));
      setImportDone(false);
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function handleConfirmImport() {
    if (!csvPreview?.valid.length) return;
    setImporting(true);
    try {
      await onImportTransactions(csvPreview.valid);
      setImportDone(true);
      setCsvPreview(null);
      if (csvRef.current) csvRef.current.value = '';
    } finally {
      setImporting(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await onResetAllTransactions();
      setResetStep(0);
    } finally {
      setResetting(false);
    }
  }

  const THEME_LABELS: { key: Theme; label: string }[] = [
    { key: 'light', label: 'Hell' },
    { key: 'dark',  label: 'Dunkel' },
    { key: 'system', label: 'System' },
  ];

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* ── Profil ──────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Profil & Startsaldo</SectionLabel>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="z. B. Max Mustermann"
              className={inputCls} />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Wird im Dashboard als Begrüßung angezeigt.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Anfangssaldo (€)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">€</span>
              <input type="text" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)}
                placeholder="0,00"
                className={`${inputCls} pl-7`} />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Kontostand vor der ersten erfassten Transaktion. Gespeichert: <strong>{formatEuro(settings.startingBalance)}</strong>
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Monatsbeginn (Tag)</label>
            <div className="flex items-center gap-3">
              <input
                type="number" min={1} max={28}
                value={monthStart}
                onChange={e => setMonthStart(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                className={`w-24 ${inputCls}`}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Tag 1–28 · Monat beginnt immer am {monthStart}. des Monats
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}>
              {saving ? 'Speichern…' : 'Speichern'}
            </button>
            {saved && <span className="text-sm text-gray-400 dark:text-gray-500">Gespeichert.</span>}
          </div>
        </form>
      </Card>

      {/* ── Darstellung (Dark Mode) ──────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Darstellung</SectionLabel>
        <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
          {THEME_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTheme(key)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                theme === key
                  ? 'text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              style={theme === key ? { backgroundColor: ACCENT } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          „System" übernimmt die Einstellung deines Betriebssystems.
        </p>
      </Card>

      {/* ── Datenverwaltung ─────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Datenverwaltung</SectionLabel>

        <ActionRow
          icon={<CsvIcon />}
          title="Exportieren — alle Transaktionen"
          description={`${transactions.length} Transaktionen, chronologisch sortiert.`}
          action={
            <div className="relative">
              <Btn onClick={() => setExportAllOpen(v => !v)}>Herunterladen ▾</Btn>
              {exportAllOpen && (
                <div className="dropdown-enter absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-20 overflow-hidden">
                  <button onClick={() => { handleExportAllPDF(); setExportAllOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">PDF</button>
                  <button onClick={() => { handleExportCSV(); setExportAllOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">CSV</button>
                </div>
              )}
            </div>
          }
        />
        <ActionRow
          icon={<CalendarIcon />}
          title="Exportieren — laufender Monat"
          description="Nur Transaktionen des aktuellen Kalendermonats."
          action={
            <div className="relative">
              <Btn onClick={() => setExportMonthOpen(v => !v)}>Herunterladen ▾</Btn>
              {exportMonthOpen && (
                <div className="dropdown-enter absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-20 overflow-hidden">
                  <button onClick={() => { handleExportMonthlyPDF(); setExportMonthOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">PDF</button>
                  <button onClick={() => { handleExportMonthlyCSV(); setExportMonthOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">CSV</button>
                </div>
              )}
            </div>
          }
        />
        <ActionRow
          icon={<BackupIcon />}
          title="Vollständiges Backup (JSON)"
          description="Exportiert alle Transaktionen, Kategorien und Einstellungen als JSON-Datei."
          action={<Btn onClick={handleExportJSON}>Backup erstellen</Btn>}
        />

        {/* CSV Import */}
        <div className="py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0"><UploadIcon /></div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">CSV importieren</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 break-words">
                  Format: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded break-all">Datum;Typ;Betrag;Kategorie;Beschreibung;Notiz</code>
                </p>
              </div>
            </div>
            <Btn onClick={() => csvRef.current?.click()}>Datei wählen</Btn>
          </div>
          <input ref={csvRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvFileChange} />

          {csvPreview && (
            <div className="slide-in-up mt-3 border border-gray-200 dark:border-gray-600 rounded p-3 space-y-2">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Vorschau: <span className="text-gray-900 dark:text-gray-100">{csvPreview.valid.length} gültige Transaktionen</span>
                {csvPreview.errors.length > 0 && (
                  <span className="text-red-500 ml-2">· {csvPreview.errors.length} Fehler</span>
                )}
              </p>
              {csvPreview.errors.length > 0 && (
                <ul className="text-xs text-red-500 dark:text-red-400 space-y-0.5 max-h-20 overflow-y-auto">
                  {csvPreview.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              {csvPreview.valid.length > 0 && (
                <div className="text-xs text-gray-500 dark:text-gray-400 max-h-24 overflow-y-auto space-y-0.5">
                  {csvPreview.valid.slice(0, 5).map(t => (
                    <div key={t.id} className="flex gap-3">
                      <span className="text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">{t.date}</span>
                      <span className="truncate">{t.description}</span>
                      <span className="ml-auto flex-shrink-0">{t.amount.toFixed(2)} €</span>
                    </div>
                  ))}
                  {csvPreview.valid.length > 5 && (
                    <p className="text-gray-400 dark:text-gray-500">… und {csvPreview.valid.length - 5} weitere</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Btn onClick={handleConfirmImport} variant="accent"
                  disabled={importing || csvPreview.valid.length === 0}>
                  {importing ? 'Importiere…' : `${csvPreview.valid.length} Transaktionen importieren`}
                </Btn>
                <Btn onClick={() => { setCsvPreview(null); if (csvRef.current) csvRef.current.value = ''; }}>
                  Abbrechen
                </Btn>
              </div>
            </div>
          )}
          {importDone && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Import abgeschlossen.</p>}
        </div>

        {/* Delete by period */}
        <div className="py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0"><TrashIcon /></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Zeitraum löschen</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">
                Alle Transaktionen in einem bestimmten Zeitraum unwiderruflich entfernen.
              </p>
              {/* Period type selector */}
              <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden mb-3 w-fit">
                {(['month', 'year', 'range'] as const).map(pt => (
                  <button key={pt} type="button"
                    onClick={() => { setDelPeriodType(pt); setDelConfirmStep(0); }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      delPeriodType === pt ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    style={delPeriodType === pt ? { backgroundColor: ACCENT } : undefined}
                  >
                    {pt === 'month' ? 'Monat' : pt === 'year' ? 'Jahr' : 'Zeitraum'}
                  </button>
                ))}
              </div>
              {/* Period inputs */}
              {delPeriodType === 'month' && (
                <input type="month" value={delMonth} onChange={e => { setDelMonth(e.target.value); setDelConfirmStep(0); }}
                  className="border border-gray-200 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5] mb-3" />
              )}
              {delPeriodType === 'year' && (
                <input type="number" min={2000} max={2099} value={delYear}
                  onChange={e => { setDelYear(e.target.value); setDelConfirmStep(0); }}
                  className="border border-gray-200 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5] w-28 mb-3" />
              )}
              {delPeriodType === 'range' && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <input type="date" value={delFrom} onChange={e => { setDelFrom(e.target.value); setDelConfirmStep(0); }}
                    className="min-w-0 border border-gray-200 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]" />
                  <span className="text-xs text-gray-400">bis</span>
                  <input type="date" value={delTo} onChange={e => { setDelTo(e.target.value); setDelConfirmStep(0); }}
                    className="min-w-0 border border-gray-200 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]" />
                </div>
              )}
              {/* Action */}
              {delRange && delConfirmStep === 0 && (
                <div className="slide-in-up flex items-center gap-3">
                  <Btn variant="danger" disabled={!delCount} onClick={() => setDelConfirmStep(1)}>
                    {delCount} Transaktion{delCount !== 1 ? 'en' : ''} löschen…
                  </Btn>
                  {delCount === 0 && <span className="text-xs text-gray-400 dark:text-gray-500">Keine Transaktionen im gewählten Zeitraum.</span>}
                </div>
              )}
              {delRange && delConfirmStep === 1 && (
                <div className="slide-in-up flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                    Wirklich {delCount} Transaktion{delCount !== 1 ? 'en' : ''} unwiderruflich löschen?
                  </p>
                  <Btn variant="danger" disabled={deleting} onClick={handleDeleteByPeriod}>
                    {deleting ? 'Lösche…' : 'Ja, löschen'}
                  </Btn>
                  <Btn onClick={() => setDelConfirmStep(0)}>Abbrechen</Btn>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reset */}
        <div className="pt-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-gray-400 dark:text-gray-500 flex-shrink-0"><TrashIcon /></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Alle Transaktionen löschen</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Entfernt alle {transactions.length} Transaktionen unwiderruflich.
              </p>
              <div className="mt-2">
                {resetStep === 0 && (
                  <Btn variant="danger" onClick={() => setResetStep(1)}>Zurücksetzen…</Btn>
                )}
                {resetStep === 1 && (
                  <div className="slide-in-up flex flex-wrap items-center gap-2">
                    <p className="text-xs text-gray-600 dark:text-gray-400">Bist du sicher? Dies kann nicht rückgängig gemacht werden.</p>
                    <Btn variant="danger" onClick={() => setResetStep(2)}>Ja, weiter</Btn>
                    <Btn onClick={() => setResetStep(0)}>Abbrechen</Btn>
                  </div>
                )}
                {resetStep === 2 && (
                  <div className="slide-in-up flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">Letzte Bestätigung — wirklich alle {transactions.length} löschen?</p>
                    <Btn variant="danger" disabled={resetting} onClick={handleReset}>
                      {resetting ? 'Lösche…' : 'Endgültig löschen'}
                    </Btn>
                    <Btn onClick={() => setResetStep(0)}>Abbrechen</Btn>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Kategorien (mit Tabs) ────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Kategorien</SectionLabel>

        {/* Tabs */}
        <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden mb-5">
          <button
            type="button"
            onClick={() => { setCatTab('expense'); setNewCatName(''); }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              catTab === 'expense'
                ? 'bg-red-500 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Ausgaben ({expenseCats.length})
          </button>
          <button
            type="button"
            onClick={() => { setCatTab('income'); setNewCatName(''); }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              catTab === 'income'
                ? 'bg-green-600 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Einnahmen ({incomeCats.length})
          </button>
        </div>

        {/* Add new category — type determined by active tab */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            placeholder={`Neue ${catTab === 'expense' ? 'Ausgabe' : 'Einnahme'}kategorie…`}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddCat())}
            className={inputCls}
          />
          <button
            type="button"
            onClick={handleAddCat}
            className="px-4 py-2 text-sm font-medium text-white rounded whitespace-nowrap min-h-[44px]"
            style={{ backgroundColor: catTab === 'expense' ? '#EF4444' : '#16A34A' }}
          >
            Hinzufügen
          </button>
        </div>

        {/* Category list for active tab */}
        <ul className="space-y-0.5">
          {activeCats.map((c, idx) => (
            <li
              key={c.id}
              className={`flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0 gap-2 ${
                movedInfo?.id === c.id ? `cat-move-${movedInfo.dir}` : ''
              }`}
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button
                  onClick={() => moveCat(c.id, 'up')}
                  disabled={idx === 0}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20 transition-colors leading-none"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                </button>
                <button
                  onClick={() => moveCat(c.id, 'down')}
                  disabled={idx === activeCats.length - 1}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20 transition-colors leading-none"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>
              <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">{c.name}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {c.monthlyBudget ? (
                  <button
                    onClick={() => {
                      const v = prompt(`Budget für "${c.name}" (€):`, String(c.monthlyBudget));
                      const n = parseFloat((v ?? '').replace(',', '.'));
                      if (!isNaN(n) && n >= 0) onUpdateCategory(c.id, { monthlyBudget: n || undefined });
                    }}
                    className="underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    {c.monthlyBudget?.toLocaleString('de-DE')} €/M
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const v = prompt(`Monatsbudget für "${c.name}" (€):`);
                      const n = parseFloat((v ?? '').replace(',', '.'));
                      if (!isNaN(n) && n > 0) onUpdateCategory(c.id, { monthlyBudget: n });
                    }}
                    className="hover:text-gray-700 dark:hover:text-gray-300"
                  >+ Budget</button>
                )}
              </span>
              {catDeleteConfirm === c.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 dark:text-gray-500">Löschen?</span>
                  <button onClick={() => { onDeleteCategory(c.id); setCatDeleteConfirm(null); }}
                    className="text-xs px-2 py-0.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded">Ja</button>
                  <button onClick={() => setCatDeleteConfirm(null)}
                    className="text-xs px-2 py-0.5 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">Nein</button>
                </div>
              ) : (
                <button onClick={() => setCatDeleteConfirm(c.id)}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors p-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </li>
          ))}
          {activeCats.length === 0 && (
            <li className="text-xs text-gray-400 dark:text-gray-500 py-2">Keine Kategorien.</li>
          )}
        </ul>
      </Card>

      {/* ── Gast-Modus Hinweis (nur wenn nicht eingeloggt) ──────────────── */}
      {!user && (
        <Card className="p-6">
          <SectionLabel>Konto</SectionLabel>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
              Du bist im <strong>Gast-Modus</strong>. Deine Daten werden nur lokal auf diesem Gerät gespeichert.
              Registriere dich um deine Daten in der Cloud zu sichern und geräteübergreifend zu synchronisieren.
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center text-sm font-semibold text-amber-900 dark:text-amber-400 underline underline-offset-2 hover:opacity-80"
            >
              Jetzt registrieren →
            </Link>
          </div>
        </Card>
      )}

      {/* ── Über ────────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Über diese App</SectionLabel>
        <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <p>Finanzdaten sicher und privat verwalten — lokal oder in der Cloud mit Supabase.</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Stack: React · TypeScript · Tailwind CSS v4 · Recharts · Supabase
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CsvIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6M5 8h14M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
function BackupIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
