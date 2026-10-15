import React, { useMemo, useEffect, useCallback } from 'react';
import { useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Budget, Category, Frequency, Settings, Transaction } from '../types';
import Card from '../components/Card';
import { ACCENT, formatEuro, downloadCSV, downloadJSON, parseImportCSV, computeBalance, todayISO, getCustomMonthRange } from '../utils';
import { amountToInput, parseAmount } from '../lib/money';
import { exportTransactionsPDF } from '../lib/exportPDF';
import { useAuth } from '../context/AuthContext';
import { useTheme, ACCENT_PRESETS, PALETTES, LOOKS, ANALYSIS_SECTIONS, palettePinnedTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useBudget } from '../context/BudgetContext';
import { useChartTheme } from '../hooks/useChartTheme';
import { loadCategoryColors, saveCategoryColors, loadCategoryOrder, saveCategoryOrder, sortByCategoryOrder } from '../hooks/useCategoryColors';
import { createSupabaseAdapter } from '../lib/supabaseAdapter';
import { createLocalStorageAdapter } from '../lib/localStorageAdapter';
import { useNavigate } from 'react-router-dom';
import { AccordionSection, AccordionLink } from '../components/Accordion';
import { ClaudeMark, Download } from '../components/icons';
import McpModal from '../components/McpModal';
import { ROUTES } from '../routes';

interface Props {
  settings: Settings;
  categories: Category[];
  transactions: Transaction[];
  /** Nur im Firmenbereich lässt sich je Kategorie ein Steuersatz vorbelegen. */
  budgetType: Budget['type'];
  onSaveSettings: (s: Partial<Omit<Settings, 'id'>>) => Promise<void>;
  onUpdateCategory: (id: string, patch: Partial<Omit<Category, 'id' | 'type'>>) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onAddCategory: (name: string, type: 'income' | 'expense') => Promise<void>;
  onImportTransactions: (txs: Transaction[]) => Promise<void>;
  onResetAllTransactions: () => Promise<void>;
  onDeleteTransactionsByPeriod: (from: string, to: string) => Promise<void>;
  /** Springt in die Transaktionsliste und filtert auf diese eine Buchung. */
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

const FREQ_OPTIONS: { value: Frequency | ''; label: string }[] = [
  { value: '', label: 'Kein Dauerauftrag' },
  { value: 'daily', label: 'Täglich' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'monthly', label: 'Monatlich' },
  { value: 'yearly', label: 'Jährlich' },
];
const TAX_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Keine Steuer' },
  { value: '19', label: '19 % enthalten' },
  { value: '7', label: '7 % enthalten' },
];

export default function SettingsPage({
  settings, categories, transactions, budgetType,
  onSaveSettings, onDeleteCategory, onAddCategory,
  onUpdateCategory, onImportTransactions, onResetAllTransactions,
  onDeleteTransactionsByPeriod,
}: Props) {
  const navigate = useNavigate();
  const [mcpOpen, setMcpOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { theme, setTheme, accent, setAccent, palette, setPalette, look, setLook, sections, toggleSection, setAllSections } = useTheme();
  const pinnedTheme = palettePinnedTheme(palette);
  const enabledCount = ANALYSIS_SECTIONS.filter(s => sections[s.id]).length;
  const resolvedDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const { activeBudgetId, activeBudget, budgets, defaultBudgetId, setDefaultBudgetId } = useBudget();
  const chartTheme = useChartTheme();

  // profile
  const [name, setName]       = useState(settings.name);
  const [balance, setBalance] = useState(
    settings.startingBalance === 0 ? '' : String(settings.startingBalance).replace('.', ',')
  );
  const [monthStart, setMonthStart] = useState(settings.monthStart ?? 1);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Anfangssaldo wird nach der ersten Buchung eingeklappt — ab dann zählt der
  // Abgleich, nicht mehr der Startwert.
  const hasTransactions = transactions.length > 0;
  const [showStartBalance, setShowStartBalance] = useState(!hasTransactions);

  // ── Kontostand-Abgleich ───────────────────────────────────────────────────
  // Wahlweise nur der aktive Bereich oder alle Bereiche zusammen. Bei "alle"
  // muss die Korrektur trotzdem in einem Bereich gebucht werden — welcher, ist
  // wählbar (Vorgabe: Hauptbereich), denn eine anteilige Verteilung würde
  // Buchungen in Bereichen erzeugen, die gar nicht abweichen.
  const [reconcileScope, setReconcileScope] = useState<'budget' | 'all'>('budget');
  // null je Bereich = konnte nicht geladen werden; dann wird nicht abgeglichen
  // (vorher zählte ein Ladefehler als 0 € und die Korrektur buchte die Differenz).
  const [allBalances, setAllBalances] = useState<Record<string, number | null> | null>(null);
  const [allBalancesLoading, setAllBalancesLoading] = useState(false);
  const [reconcileTarget, setReconcileTarget] = useState<string | null>(null);

  const budgetBalance = useMemo(
    () => settings.startingBalance + computeBalance(transactions),
    [settings.startingBalance, transactions],
  );

  const [countedInput, setCountedInput] = useState('');
  const [reconciling, setReconciling]   = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconcileDone, setReconcileDone]   = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadAllBalances = useCallback(async () => {
    if (!budgets.length) return;
    setAllBalancesLoading(true);
    const entries = await Promise.all(budgets.map(async b => {
      const adapter = user
        ? createSupabaseAdapter(user.id, b.id)
        : createLocalStorageAdapter(b.id);
      try {
        const [txs, s] = await Promise.all([adapter.getTransactions(), adapter.getSettings()]);
        const inc = txs.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
        const exp = txs.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
        return [b.id, (s.startingBalance ?? 0) + inc - exp] as const;
      } catch {
        return [b.id, null] as const;
      }
    }));
    setAllBalances(Object.fromEntries(entries));
    setAllBalancesLoading(false);
  }, [budgets, user]);

  // Erst laden, wenn der Nutzer auf "Alle Bereiche" umschaltet
  useEffect(() => {
    if (reconcileScope === 'all') loadAllBalances();
  }, [reconcileScope, loadAllBalances, reloadKey]);

  const balanceValues = allBalances ? Object.values(allBalances) : null;
  const totalAllBalance = balanceValues && balanceValues.every(v => v !== null)
    ? balanceValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    : null;
  const anyBalanceFailed = balanceValues?.some(v => v === null) ?? false;

  const baseBalance = reconcileScope === 'all' ? totalAllBalance : budgetBalance;
  // Zielbereich nur, wenn es ihn noch gibt — der gepinnte Hauptbereich im
  // localStorage kann längst gelöscht sein.
  const exists = (id: string | null) => (id && budgets.some(b => b.id === id) ? id : null);
  const targetBudgetId = reconcileScope === 'all'
    ? (exists(reconcileTarget) ?? exists(defaultBudgetId) ?? activeBudgetId)
    : activeBudgetId;
  const targetBudget = budgets.find(b => b.id === targetBudgetId);

  const countedValue = parseAmount(countedInput) ?? NaN;
  const reconcileDiff = isNaN(countedValue) || baseBalance === null
    ? null
    : Math.round((countedValue - baseBalance) * 100) / 100;

  async function handleReconcile() {
    if (reconcileDiff === null || reconcileDiff === 0 || baseBalance === null) return;
    setReconciling(true);
    setReconcileError(null);
    try {
      const scopeNote = reconcileScope === 'all' ? 'alle Bereiche' : (activeBudget?.name ?? 'Bereich');
      const tx: Transaction = {
        id: crypto.randomUUID(),
        date: todayISO(),
        type: reconcileDiff > 0 ? 'income' : 'expense',
        amount: Math.abs(reconcileDiff),
        category: 'Korrektur',
        description: 'Kontostand-Abgleich',
        note: `Gezählt: ${formatEuro(countedValue)} · vorher berechnet: ${formatEuro(baseBalance)} (${scopeNote})`,
      };

      if (targetBudgetId && targetBudgetId !== activeBudgetId) {
        // Anderer Bereich → direkt über dessen Adapter buchen
        const adapter = user
          ? createSupabaseAdapter(user.id, targetBudgetId)
          : createLocalStorageAdapter(targetBudgetId);
        await adapter.importTransactions([tx]);
      } else {
        // Aktiver Bereich → über den Handler, damit die Oberfläche sofort nachzieht
        await onImportTransactions([tx]);
      }

      setReconcileDone(reconcileDiff);
      setCountedInput('');
      setReloadKey(k => k + 1);
    } catch (e) {
      setReconcileError(e instanceof Error ? e.message : 'Abgleich fehlgeschlagen.');
    } finally {
      setReconciling(false);
    }
  }

  // ── KI-Zugriff ────────────────────────────────────────────────────────────
  // show_ai_badges steuert ausschliesslich die Anzeige. transactions.source
  // wird unabhängig davon immer geschrieben.
  const [aiBadges, setAiBadges]         = useState(settings.showAiBadges !== false);
  const [aiBadgesSaving, setAiBadgesSaving] = useState(false);
  const [aiBadgesError, setAiBadgesError]   = useState<string | null>(null);

  // mcp_allow_pot_creation entscheidet, ob Claude Sparttöpfe anlegen darf.
  // Der Schalter wirkt nicht nur in der Oberfläche: die INSERT-Policy auf
  // savings_pots prüft dieselbe Spalte.
  const [allowPots, setAllowPots]             = useState(settings.mcpAllowPotCreation !== false);
  const [allowPotsSaving, setAllowPotsSaving] = useState(false);
  const [allowPotsError, setAllowPotsError]   = useState<string | null>(null);



  async function toggleAiBadges(next: boolean) {
    setAiBadges(next);
    setAiBadgesSaving(true);
    setAiBadgesError(null);
    try {
      await onSaveSettings({ showAiBadges: next });
    } catch (e) {
      setAiBadges(!next); // zurückdrehen, damit die Anzeige nicht lügt
      setAiBadgesError(e instanceof Error ? e.message : 'Einstellung konnte nicht gespeichert werden.');
    } finally {
      setAiBadgesSaving(false);
    }
  }

  async function toggleAllowPots(next: boolean) {
    setAllowPots(next);
    setAllowPotsSaving(true);
    setAllowPotsError(null);
    try {
      await onSaveSettings({ mcpAllowPotCreation: next });
    } catch (e) {
      setAllowPots(!next);
      setAllowPotsError(e instanceof Error ? e.message : 'Einstellung konnte nicht gespeichert werden.');
    } finally {
      setAllowPotsSaving(false);
    }
  }

  // categories tab
  const [catTab, setCatTab]           = useState<'expense' | 'income'>('expense');
  const [newCatName, setNewCatName]   = useState('');
  const [catDeleteConfirm, setCatDeleteConfirm] = useState<string | null>(null);

  // category colours (localStorage, keyed by budgetId — wie die Reihenfolge)
  const [catColorMap, setCatColorMap] = useState<Record<string, string>>(
    () => loadCategoryColors(activeBudgetId)
  );
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [defaultsFor, setDefaultsFor]       = useState<string | null>(null);
  const isBusiness = budgetType === 'business';

  function setCatColor(id: string, color: string | null) {
    const next = { ...catColorMap };
    if (color) next[id] = color; else delete next[id];
    setCatColorMap(next);
    saveCategoryColors(activeBudgetId, next);
  }

  // category order (localStorage, keyed by budgetId)
  const [catOrderMap, setCatOrderMap] = useState<Record<string, number>>(() => loadCategoryOrder(activeBudgetId));
  const [movedInfo, setMovedInfo] = useState<{ id: string; dir: 'up' | 'down' } | null>(null);

  function saveCatOrder(map: Record<string, number>) {
    setCatOrderMap(map);
    saveCategoryOrder(activeBudgetId, map);
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
  const activeCats = useMemo(() => sortByCategoryOrder(rawActiveCats, catOrderMap), [rawActiveCats, catOrderMap]);

  // Erst die ganze Liste durchnummerieren, dann tauschen. Vorher bekamen nur
  // die zwei getauschten Einträge eine Position, der Rest blieb bei 999 —
  // und sprang beim nächsten Rendern an eine andere Stelle.
  function moveCat(id: string, dir: 'up' | 'down') {
    const idx = activeCats.findIndex(c => c.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= activeCats.length) return;
    const reordered = [...activeCats];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const newMap = { ...catOrderMap };
    reordered.forEach((c, i) => { newMap[c.id] = i; });
    saveCatOrder(newMap);
    setMovedInfo({ id, dir });
    setTimeout(() => setMovedInfo(null), 260);
  }

  // ── handlers ────────────────────────────────────────────────────────────────

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const parsed = balance.trim() ? parseAmount(balance) : 0;
      if (parsed === null) throw new Error('Der Anfangssaldo ist keine gültige Zahl.');
      await onSaveSettings({
        name: name.trim(),
        startingBalance: parsed,
        monthStart: Math.min(28, Math.max(1, monthStart)),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Fehler beim Speichern');
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
      `finance_backup_${todayISO()}.json`
    );
  }

  // Laufender Abrechnungsmonat — mit dem eingestellten Monatsbeginn, wie im Dashboard.
  function getMonthlyTx() {
    const { from, to } = getCustomMonthRange(settings.monthStart ?? 1);
    return transactions.filter(t => t.date >= from && t.date <= to);
  }

  function handleExportMonthlyCSV() { downloadCSV(getMonthlyTx()); }
  // Der vierte Parameter ist der Bereichsname (steht im PDF-Kopf und Dateinamen);
  // der Zeitraum gehört in die Filter.
  function handleExportMonthlyPDF() {
    const { from, to } = getCustomMonthRange(settings.monthStart ?? 1);
    exportTransactionsPDF(getMonthlyTx(), { dateFrom: from, dateTo: to }, settings.name, activeBudget?.name ?? 'Bereich');
  }
  function handleExportAllPDF() {
    exportTransactionsPDF([...transactions].sort((a, b) => a.date.localeCompare(b.date)), {}, settings.name, activeBudget?.name ?? 'Bereich');
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

      {/* ── Einstellungen als Accordion ──────────────────────────────────
           Alle Sektionen starten zugeklappt, mehrere dürfen offen sein.
           Reihenfolge und Beschriftung folgen der Vorgabe; „KI-Protokoll"
           klappt nicht auf, sondern führt auf eine eigene Seite. */}
      <Card className="px-6 py-1">
        <AccordionSection title="Profil & Startsaldo" subtitle="Name und Kontostand vor der ersten Buchung">
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="z. B. Max Mustermann"
                className={inputCls} />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Wird im Dashboard als Begrüßung angezeigt.</p>
            </div>
            {/* Anfangssaldo — nach der ersten Buchung nur noch ausklappbar */}
            {hasTransactions && !showStartBalance ? (
              <button
                type="button"
                onClick={() => setShowStartBalance(true)}
                className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Anfangssaldo anpassen ({formatEuro(settings.startingBalance)})
              </button>
            ) : (
              <div className={hasTransactions ? 'slide-in-up' : undefined}>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Anfangssaldo (€)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">€</span>
                  <input type="text" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)}
                    placeholder="0,00"
                    className={`${inputCls} pl-7`} />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {hasTransactions
                    ? <>Kontostand vor der ersten Buchung. Für spätere Korrekturen ist der Abgleich unten gedacht.</>
                    : <>Kontostand vor der ersten erfassten Transaktion. Gespeichert: <strong>{formatEuro(settings.startingBalance)}</strong></>}
                </p>
                {hasTransactions && (
                  <button type="button" onClick={() => setShowStartBalance(false)}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mt-1.5">
                    Ausblenden
                  </button>
                )}
              </div>
            )}
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
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}>
                  {saving ? 'Speichern…' : 'Speichern'}
                </button>
                {saved && <span className="text-sm text-gray-400 dark:text-gray-500">Gespeichert.</span>}
              </div>
              {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
            </div>
          </form>
        </AccordionSection>

        {hasTransactions && (
          <AccordionSection title="Kontostand-Abgleich" subtitle="Gezählten Stand eintragen, Differenz wird gebucht">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Zähl dein Geld nach und trag den echten Stand ein. Die Differenz wird als
              Korrekturbuchung ergänzt, damit alles wieder stimmt.
            </p>

            {/* Umfang: nur dieser Bereich oder alle zusammen */}
            {budgets.length > 1 && (
              <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden mb-4">
                {([
                  { key: 'budget' as const, label: activeBudget?.name ?? 'Dieser Bereich' },
                  { key: 'all' as const,    label: 'Alle Bereiche' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setReconcileScope(key); setCountedInput(''); setReconcileDone(null); }}
                    className={`flex-1 py-2 text-sm font-medium transition-colors min-h-[40px] truncate px-2 ${
                      reconcileScope === key
                        ? 'text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    style={reconcileScope === key ? { backgroundColor: ACCENT } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Berechnet{reconcileScope === 'all' ? ' (alle Bereiche)' : ''}
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">
                {baseBalance === null
                  ? (allBalancesLoading ? 'Lädt…' : anyBalanceFailed ? 'Ein Bereich konnte nicht geladen werden' : '—')
                  : formatEuro(baseBalance)}
              </span>
            </div>

            {/* Aufschlüsselung je Bereich */}
            {reconcileScope === 'all' && allBalances && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
                {budgets.map(b => (
                  <span key={b.id} className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                    {b.name}
                    <span className="tabular-nums">{allBalances[b.id] === null ? 'Fehler' : formatEuro(allBalances[b.id] ?? 0)}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Tatsächlicher Kontostand (€)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">€</span>
                <input
                  type="text" inputMode="decimal"
                  value={countedInput}
                  onChange={e => { setCountedInput(e.target.value); setReconcileDone(null); }}
                  placeholder={baseBalance === null ? '0,00' : amountToInput(baseBalance) || '0'}
                  className={`${inputCls} pl-7`}
                />
              </div>
            </div>

            {/* Zielbereich für die Korrekturbuchung */}
            {reconcileScope === 'all' && budgets.length > 1 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                  Korrektur buchen in
                </label>
                <select
                  value={targetBudgetId ?? ''}
                  onChange={e => setReconcileTarget(e.target.value)}
                  className={inputCls}
                >
                  {budgets.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.id === defaultBudgetId ? ' (Hauptbereich)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Die Differenz gilt für alle Bereiche zusammen, muss aber in einem gebucht werden.
                </p>
              </div>
            )}

            {/* Live-Vorschau der Korrektur */}
            {reconcileDiff !== null && (
              <div className={`mt-3 text-xs rounded px-3 py-2 ${
                reconcileDiff === 0
                  ? 'bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400'
                  : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300'
              }`}>
                {reconcileDiff === 0 ? (
                  <>Stimmt bereits — keine Korrektur nötig.</>
                ) : (
                  <>
                    Differenz{' '}
                    <strong className={reconcileDiff > 0 ? '' : 'text-red-500 dark:text-red-400'}
                      style={reconcileDiff > 0 ? { color: ACCENT } : undefined}>
                      {reconcileDiff > 0 ? '+' : '−'} {formatEuro(Math.abs(reconcileDiff))}
                    </strong>
                    {' '}wird als {reconcileDiff > 0 ? 'Einnahme' : 'Ausgabe'} in der Kategorie „Korrektur" gebucht
                    {reconcileScope === 'all' && targetBudget ? <> — in <strong>{targetBudget.name}</strong></> : null}.
                  </>
                )}
              </div>
            )}

            {reconcileError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{reconcileError}</p>}
            {reconcileDone !== null && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Abgeglichen — {reconcileDone > 0 ? '+' : '−'} {formatEuro(Math.abs(reconcileDone))} gebucht.
              </p>
            )}

            <button
              type="button"
              onClick={handleReconcile}
              disabled={reconciling || reconcileDiff === null || reconcileDiff === 0}
              className="mt-4 px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-40"
              style={{ backgroundColor: ACCENT }}
            >
              {reconciling ? 'Wird gebucht…' : 'Abgleichen'}
            </button>

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              Die Korrektur erscheint als normale Buchung im Verlauf — so bleibt nachvollziehbar,
              wann angepasst wurde, und du kannst sie jederzeit wieder löschen.
            </p>
          </AccordionSection>
        )}

        {budgets.length > 1 && (
          <AccordionSection title="Hauptbereiche" subtitle="Welcher Bereich beim Öffnen erscheint">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Dieser Bereich wird beim Öffnen der App automatisch angezeigt.
            </p>
            <div className="space-y-2">
              {budgets.map(b => {
                const isMain = b.id === defaultBudgetId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setDefaultBudgetId(b.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      isMain
                        ? 'border-transparent ring-2'
                        : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    style={isMain ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{b.name}</span>
                      <span className="block text-xs text-gray-400 dark:text-gray-500">
                        {b.type === 'business' ? 'Firma' : 'Privat'}
                      </span>
                    </span>
                    {isMain ? (
                      <span className="text-xs font-medium flex items-center gap-1 flex-shrink-0" style={{ color: accent }}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        Hauptbereich
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">Auswählen</span>
                    )}
                  </button>
                );
              })}
            </div>
          </AccordionSection>
        )}

        <AccordionSection title="Darstellung" subtitle="Hell/Dunkel, Farbthema, Hintergrund und Akzentfarbe">
          <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
            {THEME_LABELS.map(({ key, label }) => {
              const locked = pinnedTheme !== null && key !== pinnedTheme;
              const pinnedLabel = pinnedTheme === 'dark' ? 'Dunkelmodus' : 'Hellmodus';
              return (
                <button
                  key={key}
                  type="button"
                  disabled={locked}
                  onClick={() => setTheme(key)}
                  title={locked ? `Diese Palette ist nur im ${pinnedLabel} verfügbar` : undefined}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    theme === key
                      ? 'text-white'
                      : locked
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  style={theme === key ? { backgroundColor: ACCENT } : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            {pinnedTheme === 'dark'
              ? 'Die gewählte Palette ist nur im Dunkelmodus verfügbar.'
              : pinnedTheme === 'light'
                ? 'Die gewählte Palette ist nur im Hellmodus verfügbar.'
                : '„System" übernimmt die Einstellung deines Betriebssystems.'}
          </p>

          {/* Farbthema */}
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-5 mb-3">Farbthema</p>
          <div className="space-y-2">
            {LOOKS.map(l => {
              const active = look === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLook(l.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    active
                      ? 'border-transparent ring-2'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  style={active ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{l.name}</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">{l.desc}</span>
                  </span>
                  {active && (
                    <svg className="w-4 h-4 flex-shrink-0" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Bestimmt Sättigung und Trennschärfe. Der Hintergrund darunter bleibt davon unberührt.
          </p>

          {/* Background palette */}
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-5 mb-3">Hintergrund</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {PALETTES.map(p => {
              const active = palette === p.id;
              // 'any' palettes preview whichever scheme is currently showing.
              const scheme = p.mode === 'any' ? (resolvedDark ? 'dark' : 'light') : p.mode;
              const [previewBg, previewCard] = p[scheme];
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPalette(p.id)}
                  className={`text-left rounded-lg border overflow-hidden transition-all hover:scale-[1.02] ${
                    active
                      ? 'border-transparent ring-2'
                      : 'border-gray-200 dark:border-gray-600'
                  }`}
                  style={active ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}
                >
                  {/* Mini preview: page bg + card + accent dot */}
                  <div className="h-12 p-2 flex items-end gap-1.5" style={{ backgroundColor: previewBg }}>
                    <div
                      className="flex-1 h-6 rounded"
                      style={{ backgroundColor: previewCard, border: '1px solid rgba(128,128,128,0.35)' }}
                    />
                    <div className="w-3 h-3 rounded-full flex-shrink-0 mb-1.5" style={{ backgroundColor: accent }} />
                  </div>
                  <div className="px-2.5 py-2 bg-white dark:bg-gray-800">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1">
                      {p.name}
                      {active && (
                        <svg className="w-3 h-3 flex-shrink-0" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{p.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Färbt Seitenhintergrund, Karten, Ränder und gedämpfte Texte.
          </p>

          {/* Accent color */}
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-5 mb-3">Akzentfarbe</p>
          <div className="flex flex-wrap gap-2.5">
            {ACCENT_PRESETS.map(preset => {
              const active = accent === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setAccent(preset.value)}
                  title={preset.name}
                  className={`w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center ${active ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 scale-110' : ''}`}
                  style={{ backgroundColor: preset.value }}
                >
                  {active && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            Farbe für Buttons, Hervorhebungen und Diagramme.
          </p>
        </AccordionSection>

        <AccordionSection title="Analyseansichten" subtitle="Welche Karten die Auswertung zeigt">
          <div className="flex items-center justify-between mb-3">
            <span />
            <div className="flex gap-2">
              <Btn onClick={() => setAllSections(true)} disabled={enabledCount === ANALYSIS_SECTIONS.length}>
                Alle an
              </Btn>
              <Btn onClick={() => setAllSections(false)} disabled={enabledCount === 0}>
                Alle aus
              </Btn>
            </div>
          </div>

          {ANALYSIS_SECTIONS.map(s => (
            <div key={s.id} className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{s.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{s.desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sections[s.id]}
                aria-label={s.name}
                onClick={() => toggleSection(s.id)}
                className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors min-h-[24px] ${
                  sections[s.id] ? '' : 'bg-gray-200 dark:bg-gray-600'
                }`}
                style={sections[s.id] ? { backgroundColor: ACCENT } : undefined}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    sections[s.id] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}

          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            {enabledCount === 0
              ? 'Alle Ansichten sind ausgeblendet — die Analyse-Seite bleibt leer.'
              : `${enabledCount} von ${ANALYSIS_SECTIONS.length} Ansichten werden auf der Analyse-Seite angezeigt.`}
          </p>
        </AccordionSection>

        <AccordionSection title="Kategorien" subtitle="Anlegen, umsortieren, Farben, Monatsbudgets und Vorbelegungen">

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
            {activeCats.flatMap((c, idx) => [
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
                {/* Farbe: eigene Farbe oder automatisch aus der Akzentfarbe */}
                <button
                  type="button"
                  onClick={() => setColorPickerFor(colorPickerFor === c.id ? null : c.id)}
                  title={catColorMap[c.id] ? 'Eigene Farbe' : 'Standardfarbe (automatisch)'}
                  className="w-4 h-4 rounded-full flex-shrink-0 transition-transform hover:scale-125"
                  style={catColorMap[c.id]
                    ? { backgroundColor: catColorMap[c.id] }
                    : { border: '1.5px dashed', borderColor: chartTheme.tick }}
                />
                <span className="text-sm text-gray-800 dark:text-gray-200 flex-1 min-w-0">
                  <span className="block truncate">{c.name}</span>
                  {(c.defaultFrequency || (isBusiness && c.defaultTaxRate)) && (
                    <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate">
                      {[
                        c.defaultFrequency ? FREQ_OPTIONS.find(o => o.value === c.defaultFrequency)?.label : null,
                        isBusiness && c.defaultTaxRate ? `${c.defaultTaxRate} % USt` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setDefaultsFor(defaultsFor === c.id ? null : c.id)}
                  title="Vorbelegung im Buchungs-Wizard"
                  className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${defaultsFor === c.id ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  style={defaultsFor === c.id ? { backgroundColor: ACCENT } : undefined}
                >
                  Vorbelegung
                </button>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {c.monthlyBudget ? (
                    <button
                      onClick={() => {
                        const v = prompt(`Budget für "${c.name}" (€):`, amountToInput(c.monthlyBudget));
                        if (v === null) return;
                        const n = v.trim() ? parseAmount(v) : 0;
                        if (n !== null && n >= 0) onUpdateCategory(c.id, { monthlyBudget: n || undefined });
                      }}
                      className="underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      {c.monthlyBudget?.toLocaleString('de-DE')} €/M
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const v = prompt(`Monatsbudget für "${c.name}" (€):`);
                        const n = parseAmount(v ?? '');
                        if (n !== null && n > 0) onUpdateCategory(c.id, { monthlyBudget: n });
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
              </li>,
              colorPickerFor === c.id && (
                <li key={`${c.id}-color`} className="slide-in-up py-2 pl-6 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => { setCatColor(c.id, null); setColorPickerFor(null); }}
                      className={`px-2 py-1 text-xs rounded border ${!catColorMap[c.id] ? 'border-transparent ring-2' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}
                      style={!catColorMap[c.id] ? { boxShadow: `0 0 0 2px ${accent}`, color: accent } : undefined}
                    >
                      Standard
                    </button>
                    {chartTheme.series.map(col => (
                      <button
                        key={col} type="button"
                        onClick={() => { setCatColor(c.id, col); setColorPickerFor(null); }}
                        className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${catColorMap[c.id] === col ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 dark:ring-offset-gray-800' : ''}`}
                        style={{ backgroundColor: col }}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
                    „Standard" vergibt automatisch einen Ton deiner Akzentfarbe.
                  </p>
                </li>
              ),
              defaultsFor === c.id && (
                <li key={`${c.id}-defaults`} className="slide-in-up py-2 pl-6 border-b border-gray-100 dark:border-gray-700">
                  <div className={`grid gap-2 ${isBusiness ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <div>
                      <label className="block text-[11px] text-gray-400 dark:text-gray-500 mb-1">Dauerauftrag vorschlagen</label>
                      <select
                        value={c.defaultFrequency ?? ''}
                        onChange={e => onUpdateCategory(c.id, { defaultFrequency: (e.target.value || undefined) as Frequency | undefined })}
                        className={`${inputCls} py-2`}
                      >
                        {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    {isBusiness && (
                      <div>
                        <label className="block text-[11px] text-gray-400 dark:text-gray-500 mb-1">Steuer vorschlagen</label>
                        <select
                          value={c.defaultTaxRate ? String(c.defaultTaxRate) : ''}
                          onChange={e => onUpdateCategory(c.id, { defaultTaxRate: e.target.value ? Number(e.target.value) : undefined })}
                          className={`${inputCls} py-2`}
                        >
                          {TAX_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
                    Der Wizard setzt das beim Wählen der Kategorie vor — du bestätigst oder änderst es je Buchung.
                  </p>
                </li>
              ),
            ])}
            {activeCats.length === 0 && (
              <li className="text-xs text-gray-400 dark:text-gray-500 py-2">Keine Kategorien.</li>
            )}
          </ul>
        </AccordionSection>

        <AccordionSection title="Datenverwaltung" subtitle="Export, Import, Löschen" icon={<Download className="w-4 h-4" />}>

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
        </AccordionSection>

        <AccordionSection title="Konto" subtitle="Anmeldung und Synchronisierung">
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user.email}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Daten werden in der Cloud synchronisiert — auf allen deinen Geräten verfügbar.</p>
                </div>
              </div>
              {/* Logout only shown on mobile — desktop has it in the top nav */}
              <div className="lg:hidden pt-1">
                <LogoutButton signOut={signOut} />
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
                Du bist im <strong>Gast-Modus</strong>. Deine Daten werden nur lokal auf diesem Gerät gespeichert — kein anderes Gerät hat Zugriff.
                Melde dich an, um deine Daten in der Cloud zu sichern und überall abzurufen.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/login"
                  className="inline-flex items-center text-sm font-semibold text-amber-900 dark:text-amber-400 underline underline-offset-2 hover:opacity-80"
                >
                  Anmelden →
                </Link>
                <Link
                  to="/signup"
                  className="inline-flex items-center text-sm font-semibold text-amber-900 dark:text-amber-400 underline underline-offset-2 hover:opacity-80"
                >
                  Registrieren →
                </Link>
              </div>
            </div>
          )}
        </AccordionSection>

        <AccordionSection title="KI-Zugriff" subtitle="Was Claude darf und wie es gekennzeichnet wird">
          {!user ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Der KI-Zugriff setzt ein Konto voraus. Im Gast-Modus liegen die Daten nur auf diesem
              Gerät, und es gibt keine Schnittstelle, über die Claude sie lesen könnte.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Claude kann über den verbundenen Zugang <strong className="text-gray-700 dark:text-gray-300">alle
                Daten lesen</strong> sowie <strong className="text-gray-700 dark:text-gray-300">Transaktionen,
                Notizen und Sparttöpfe anlegen</strong>. Ändern und Löschen kann Claude nichts — das ist
                in der Datenbank gesperrt, nicht bloss in der Oberfläche.
              </p>

              {/* Badge-Schalter */}
              <div className="flex items-start justify-between gap-4 py-3 border-t border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">KI-Markierung anzeigen</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Zeigt bei Buchungen und Notizen von Claude ein „KI“-Kennzeichen.
                    Die Herkunft wird unabhängig davon immer gespeichert.
                  </p>
                </div>
                <ToggleSwitch
                  on={aiBadges}
                  disabled={aiBadgesSaving}
                  onChange={toggleAiBadges}
                  label="KI-Markierung anzeigen"
                />
              </div>
              {aiBadgesError && (
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">{aiBadgesError}</p>
              )}

              {/* Spartopf-Schalter */}
              <div className="flex items-start justify-between gap-4 py-3 border-t border-gray-100 dark:border-gray-700">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Sparttöpfe anlegen</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Erlaubt Claude, neue Sparttöpfe anzulegen. Bedenke die Tragweite: ein Topf mit
                    Verteilungsanteil verändert, was mit <strong className="text-gray-500 dark:text-gray-400">künftigen
                    Einnahmen</strong> passiert — jede neue Einnahme wird dann automatisch anteilig verteilt.
                    Bestehende Töpfe kann Claude weder ändern noch löschen.
                  </p>
                </div>
                <ToggleSwitch
                  on={allowPots}
                  disabled={allowPotsSaving}
                  onChange={toggleAllowPots}
                  label="Sparttöpfe anlegen"
                />
              </div>
              {allowPotsError && (
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">{allowPotsError}</p>
              )}
            </>
          )}
        </AccordionSection>

        <AccordionSection title="Über diese App" subtitle="Wo deine Daten liegen">
          <SectionLabel>Über diese App</SectionLabel>
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-2">
            <p>
              <strong className="text-gray-700 dark:text-gray-300">Angemeldet:</strong> Deine Daten liegen sicher in der Cloud und sind auf allen deinen Geräten abrufbar — Smartphone, Tablet, Computer.
            </p>
            <p>
              <strong className="text-gray-700 dark:text-gray-300">Gast-Modus:</strong> Deine Daten bleiben nur auf diesem einen Gerät. Kein anderes Gerät hat Zugriff, und beim Löschen des Browsers sind sie weg.
            </p>
          </div>
        </AccordionSection>

        <AccordionLink
          title="KI-Protokoll"
          subtitle="Jede Änderung, mit Herkunft App oder KI"
          onClick={() => navigate(ROUTES.aiLog)}
        />
      </Card>

      {/* ── MCP verbinden ────────────────────────────────────────────────
           Steht bewusst ausserhalb des Accordions: kein Einstellungsfeld,
           sondern der Einstieg in die Einrichtung. */}
      <button
        type="button"
        onClick={() => setMcpOpen(true)}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <ClaudeMark className="w-5 h-5" />
        MCP verbinden
      </button>

      {mcpOpen && <McpModal onClose={() => setMcpOpen(false)} />}
    </div>
  );
}

/** Ein/Aus-Schalter im Stil der App. */
function ToggleSwitch({
  on, disabled, onChange, label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${
        on ? '' : 'bg-gray-200 dark:bg-gray-600'
      }`}
      style={on ? { backgroundColor: ACCENT } : undefined}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          on ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

// ── LogoutButton (mobile Konto-Sektion) ──────────────────────────────────────

function LogoutButton({ signOut }: { signOut: () => Promise<void> }) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <button
      onClick={async () => { setSigningOut(true); try { await signOut(); } finally { setSigningOut(false); } }}
      disabled={signingOut}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
      {signingOut ? '…' : 'Abmelden'}
    </button>
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
