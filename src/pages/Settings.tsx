import { useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import type { Category, Settings, Transaction } from '../types';
import Card from '../components/Card';
import { ACCENT, formatEuro, downloadCSV, downloadJSON, parseImportCSV } from '../utils';

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
}

// ── small reusable pieces ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function ActionRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0 gap-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-gray-400 flex-shrink-0">{icon}</div>
        <div>
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex-shrink-0">{action}</div>
    </div>
  );
}

function Btn({
  onClick,
  children,
  variant = 'default',
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'danger';
  disabled?: boolean;
}) {
  const base = 'px-3 py-1.5 text-xs font-medium rounded border transition-colors disabled:opacity-40 whitespace-nowrap';
  const styles: Record<string, string> = {
    default: 'border-gray-200 text-gray-700 hover:bg-gray-50',
    accent: 'border-transparent text-white',
    danger: 'border-red-200 text-red-600 hover:bg-red-50',
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

// ── main component ────────────────────────────────────────────────────────────

export default function SettingsPage({
  settings,
  categories,
  transactions,
  onSaveSettings,
  onDeleteCategory,
  onAddCategory,
  onUpdateCategory,
  onImportTransactions,
  onResetAllTransactions,
}: Props) {
  // profile
  const [name, setName] = useState(settings.name);
  const [balance, setBalance] = useState(
    settings.startingBalance === 0 ? '' : String(settings.startingBalance).replace('.', ',')
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // categories
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense');
  const [catDeleteConfirm, setCatDeleteConfirm] = useState<string | null>(null);

  // csv import state
  const csvRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<{ valid: Transaction[]; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  // reset state
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [resetting, setResetting] = useState(false);

  const expenseCats = categories.filter(c => c.type === 'expense');
  const incomeCats = categories.filter(c => c.type === 'income');

  // ── handlers ────────────────────────────────────────────────────────────────

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const parsed = parseFloat(balance.replace(',', '.'));
      await onSaveSettings({
        name: name.trim(),
        startingBalance: isNaN(parsed) ? 0 : parsed,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCat() {
    if (!newCatName.trim()) return;
    await onAddCategory(newCatName.trim(), newCatType);
    setNewCatName('');
  }

  function handleExportCSV() {
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    downloadCSV(sorted);
  }

  function handleExportJSON() {
    downloadJSON(
      { transactions, categories, settings, exportedAt: new Date().toISOString() },
      `finanztracker_backup_${new Date().toISOString().slice(0, 10)}.json`
    );
  }

  function handleExportMonthly() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthly = transactions.filter(t => t.date.startsWith(`${year}-${month}`));
    downloadCSV(monthly);
  }

  function handleCsvFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setCsvPreview(parseImportCSV(text));
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

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* ── Profil ─────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Profil & Startsaldo</SectionLabel>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="z. B. Max Mustermann"
              className="w-full border border-gray-200 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-[#4A6FA5]"
            />
            <p className="text-xs text-gray-400 mt-1">Wird im Dashboard als Begrüßung angezeigt.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Anfangssaldo (€)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
              <input
                type="text"
                inputMode="decimal"
                value={balance}
                onChange={e => setBalance(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-200 rounded pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#4A6FA5]"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Kontostand vor der ersten erfassten Transaktion.
              Gespeichert: <strong>{formatEuro(settings.startingBalance)}</strong>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? 'Speichern…' : 'Speichern'}
            </button>
            {saved && <span className="text-sm text-gray-400">Gespeichert.</span>}
          </div>
        </form>
      </Card>

      {/* ── Datenverwaltung ────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Datenverwaltung</SectionLabel>

        {/* Export: CSV alle */}
        <ActionRow
          icon={<CsvIcon />}
          title="CSV exportieren — alle Transaktionen"
          description={`${transactions.length} Transaktionen, chronologisch sortiert. Öffnet direkt in Excel.`}
          action={<Btn onClick={handleExportCSV} variant="accent">Herunterladen</Btn>}
        />

        {/* Export: CSV laufender Monat */}
        <ActionRow
          icon={<CalendarIcon />}
          title="CSV exportieren — laufender Monat"
          description="Nur Transaktionen des aktuellen Monats."
          action={<Btn onClick={handleExportMonthly}>Herunterladen</Btn>}
        />

        {/* Export: JSON Backup */}
        <ActionRow
          icon={<BackupIcon />}
          title="Vollständiges Backup (JSON)"
          description="Exportiert alle Transaktionen, Kategorien und Einstellungen als JSON-Datei."
          action={<Btn onClick={handleExportJSON}>Backup erstellen</Btn>}
        />

        {/* Import: CSV */}
        <div className="py-3 border-b border-gray-100">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-gray-400 flex-shrink-0"><UploadIcon /></div>
              <div>
                <p className="text-sm font-medium text-gray-900">CSV importieren</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Format: <code className="bg-gray-100 px-1 rounded">Datum;Typ;Betrag;Kategorie;Beschreibung;Notiz</code>
                  <br />Datum: DD.MM.YYYY oder YYYY-MM-DD · Typ: Einnahme / Ausgabe
                </p>
              </div>
            </div>
            <Btn onClick={() => csvRef.current?.click()}>Datei wählen</Btn>
          </div>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleCsvFileChange}
          />

          {/* CSV preview */}
          {csvPreview && (
            <div className="mt-3 border border-gray-200 rounded p-3 space-y-2">
              <p className="text-xs font-medium text-gray-700">
                Vorschau: <span className="text-gray-900">{csvPreview.valid.length} gültige Transaktionen</span>
                {csvPreview.errors.length > 0 && (
                  <span className="text-red-500 ml-2">· {csvPreview.errors.length} Fehler</span>
                )}
              </p>
              {csvPreview.errors.length > 0 && (
                <ul className="text-xs text-red-500 space-y-0.5 max-h-20 overflow-y-auto">
                  {csvPreview.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              {csvPreview.valid.length > 0 && (
                <div className="text-xs text-gray-500 max-h-24 overflow-y-auto space-y-0.5">
                  {csvPreview.valid.slice(0, 5).map(t => (
                    <div key={t.id} className="flex gap-3">
                      <span className="text-gray-400 w-20 flex-shrink-0">{t.date}</span>
                      <span className="truncate">{t.description}</span>
                      <span className="ml-auto flex-shrink-0">{t.amount.toFixed(2)} €</span>
                    </div>
                  ))}
                  {csvPreview.valid.length > 5 && (
                    <p className="text-gray-400">… und {csvPreview.valid.length - 5} weitere</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Btn
                  onClick={handleConfirmImport}
                  variant="accent"
                  disabled={importing || csvPreview.valid.length === 0}
                >
                  {importing ? 'Importiere…' : `${csvPreview.valid.length} Transaktionen importieren`}
                </Btn>
                <Btn onClick={() => { setCsvPreview(null); if (csvRef.current) csvRef.current.value = ''; }}>
                  Abbrechen
                </Btn>
              </div>
            </div>
          )}
          {importDone && (
            <p className="text-xs text-gray-500 mt-2">Import abgeschlossen.</p>
          )}
        </div>

        {/* Reset */}
        <div className="pt-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-gray-400 flex-shrink-0"><TrashIcon /></div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Alle Transaktionen löschen</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Entfernt alle {transactions.length} Transaktionen unwiderruflich. Einstellungen und Kategorien bleiben erhalten.
              </p>
              <div className="mt-2">
                {resetStep === 0 && (
                  <Btn variant="danger" onClick={() => setResetStep(1)}>Zurücksetzen…</Btn>
                )}
                {resetStep === 1 && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-600">Bist du sicher? Dies kann nicht rückgängig gemacht werden.</p>
                    <Btn variant="danger" onClick={() => setResetStep(2)}>Ja, weiter</Btn>
                    <Btn onClick={() => setResetStep(0)}>Abbrechen</Btn>
                  </div>
                )}
                {resetStep === 2 && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-red-600">Letzte Bestätigung — wirklich alle {transactions.length} Transaktionen löschen?</p>
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

      {/* ── Kategorien ─────────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Kategorien</SectionLabel>

        {/* Neue Kategorie */}
        <div className="flex gap-2 mb-5">
          <div className="flex rounded border border-gray-200 overflow-hidden flex-shrink-0">
            {(['expense', 'income'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setNewCatType(t)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  newCatType === t ? 'text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
                style={newCatType === t ? { backgroundColor: ACCENT } : undefined}
              >
                {t === 'expense' ? 'Ausgabe' : 'Einnahme'}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            placeholder="Neue Kategorie…"
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddCat())}
            className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4A6FA5]"
          />
          <button
            type="button"
            onClick={handleAddCat}
            className="px-4 py-2 text-sm font-medium text-white rounded whitespace-nowrap"
            style={{ backgroundColor: ACCENT }}
          >
            Hinzufügen
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CategoryList
            title="Ausgaben"
            items={expenseCats}
            deleteConfirm={catDeleteConfirm}
            onDelete={onDeleteCategory}
            onConfirm={setCatDeleteConfirm}
            onUpdateCategory={onUpdateCategory}
          />
          <CategoryList
            title="Einnahmen"
            items={incomeCats}
            deleteConfirm={catDeleteConfirm}
            onDelete={onDeleteCategory}
            onConfirm={setCatDeleteConfirm}
          />
        </div>
      </Card>

      {/* ── Über ───────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <SectionLabel>Über diese App</SectionLabel>
        <div className="text-sm text-gray-500 space-y-1">
          <p>Alle Daten werden lokal in <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">db.json</code> gespeichert — kein Cloud-Upload, kein Account.</p>
          <p className="text-xs text-gray-400 mt-2">
            Stack: React · TypeScript · Tailwind CSS · Recharts · json-server
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── Category list ─────────────────────────────────────────────────────────────

function CategoryList({
  title, items, deleteConfirm, onDelete, onConfirm, onUpdateCategory,
}: {
  title: string;
  items: Category[];
  deleteConfirm: string | null;
  onDelete: (id: string) => Promise<void>;
  onConfirm: (id: string | null) => void;
  onUpdateCategory?: (id: string, patch: { monthlyBudget?: number }) => Promise<void>;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{title}</p>
      <ul className="space-y-0.5">
        {items.map(c => (
          <li key={c.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0 gap-2">
            <span className="text-sm text-gray-800 flex-1">{c.name}</span>
            {onUpdateCategory && (
              <span className="text-xs text-gray-400">
                {c.monthlyBudget ? (
                  <button
                    onClick={() => {
                      const v = prompt(`Budget für "${c.name}" (€):`, String(c.monthlyBudget));
                      const n = parseFloat((v ?? '').replace(',', '.'));
                      if (!isNaN(n) && n >= 0) onUpdateCategory(c.id, { monthlyBudget: n || undefined });
                    }}
                    className="underline underline-offset-2 hover:text-gray-700"
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
                    className="hover:text-gray-700"
                  >+ Budget</button>
                )}
              </span>
            )}
            {deleteConfirm === c.id ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">Löschen?</span>
                <button onClick={() => { onDelete(c.id); onConfirm(null); }}
                  className="text-xs px-2 py-0.5 bg-gray-900 text-white rounded">Ja</button>
                <button onClick={() => onConfirm(null)}
                  className="text-xs px-2 py-0.5 border border-gray-200 rounded">Nein</button>
              </div>
            ) : (
              <button onClick={() => onConfirm(c.id)}
                className="text-gray-300 hover:text-gray-600 transition-colors p-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-gray-400 py-2">Keine Kategorien.</li>}
      </ul>
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
