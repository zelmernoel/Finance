import {
  useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Category, Transaction } from '../types';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { formatEuro, formatDate, downloadCSV, ACCENT } from '../utils';
import { exportTransactionsPDF } from '../lib/exportPDF';
import { printTransactions } from '../lib/printTransactions';
import {
  getReceipt, saveReceipt, deleteReceipt, hasReceipt, fileToDataUrl, printReceipt,
} from '../lib/receiptStorage';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Omit<Transaction, 'id'>>) => Promise<void>;
  onNavigateToNew: () => void;
  budgetName: string;
  userName: string;
}

type SortKey = 'date' | 'amount';
type SortDir = 'asc' | 'desc';

// ── Highlight matching text ───────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-100 dark:bg-yellow-900/50 font-semibold rounded px-0.5">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// ── useDebounce ───────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Transactions({
  transactions, categories, onDelete, onUpdate, onNavigateToNew, budgetName, userName,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearchRaw]      = useState(searchParams.get('q') ?? '');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCat] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo]     = useState('');
  const [sortKey, setSortKey]       = useState<SortKey>('date');
  const [sortDir, setSortDir]       = useState<SortDir>('desc');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Edit state
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editForm, setEditForm]   = useState<Partial<Omit<Transaction, 'id'>>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError]   = useState<string | null>(null);

  function openEdit(t: Transaction) {
    setEditingTx(t);
    setEditForm({
      date: t.date, type: t.type, amount: t.amount,
      category: t.category, description: t.description, note: t.note ?? '',
    });
    setEditError(null);
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!editingTx) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await onUpdate(editingTx.id, editForm);
      setEditingTx(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setEditSaving(false);
    }
  }
  const [exportOpen, setExportOpen]       = useState(false);
  const exportRef                         = useRef<HTMLDivElement>(null);
  const [receiptModal, setReceiptModal]   = useState<string | null>(null); // txId
  const [receiptUrl, setReceiptUrl]       = useState<string | null>(null);
  const [receiptProcessing, setReceiptProcessing] = useState(false);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const receiptCamRef  = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function openReceipt(txId: string) {
    setReceiptModal(txId);
    setReceiptUrl(getReceipt(txId));
  }

  async function handleReceiptFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !receiptModal) return;
    setReceiptProcessing(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      saveReceipt(receiptModal, dataUrl);
      setReceiptUrl(dataUrl);
    } finally {
      setReceiptProcessing(false);
      e.target.value = '';
    }
  }

  function handleDeleteReceipt() {
    if (!receiptModal) return;
    deleteReceipt(receiptModal);
    setReceiptUrl(null);
    setReceiptModal(null);
  }

  const debouncedSearch = useDebounce(search, 300);

  function setSearch(v: string) { setSearchRaw(v); }

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (debouncedSearch) params.set('q', debouncedSearch);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, searchParams, setSearchParams]);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!exportOpen) return;
    function close(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportOpen]);

  const categories = useMemo(() => {
    const set = new Set(transactions.map(t => t.category));
    return [...set].sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    let result = transactions;
    if (filterType !== 'all') result = result.filter(t => t.type === filterType);
    if (filterCategory)       result = result.filter(t => t.category === filterCategory);
    if (filterFrom)           result = result.filter(t => t.date >= filterFrom);
    if (filterTo)             result = result.filter(t => t.date <= filterTo);
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        String(t.amount).includes(q) ||
        (t.note ?? '').toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'date') return mul * a.date.localeCompare(b.date);
      return mul * (a.amount - b.amount);
    });
  }, [transactions, filterType, filterCategory, filterFrom, filterTo, debouncedSearch, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="ml-1 text-gray-300 dark:text-gray-600">↕</span>;
    return <span className="ml-1" style={{ color: '#4A6FA5' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const activeFilters = useCallback(() => ({
    dateFrom: filterFrom || undefined,
    dateTo:   filterTo   || undefined,
    type:     filterType !== 'all' ? filterType : undefined,
    category: filterCategory || undefined,
  }), [filterFrom, filterTo, filterType, filterCategory]);

  const inputCls = 'border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          <div className="col-span-2 md:col-span-1 lg:col-span-2 relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Suche… (Strg+F)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`w-full ${inputCls} pl-8`}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-xs"
              >✕</button>
            )}
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value as typeof filterType)}
            className={`${inputCls} bg-white dark:bg-gray-700`}>
            <option value="all">Alle Typen</option>
            <option value="income">Einnahmen</option>
            <option value="expense">Ausgaben</option>
          </select>
          <select value={filterCategory} onChange={e => setFilterCat(e.target.value)}
            className={`${inputCls} bg-white dark:bg-gray-700`}>
            <option value="">Alle Kategorien</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
            className={inputCls} />
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
            className={inputCls} />
        </div>
        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {filtered.length} Transaktion{filtered.length !== 1 ? 'en' : ''} gefunden
            {debouncedSearch && <span className="ml-1 text-gray-400 dark:text-gray-500">für „{debouncedSearch}"</span>}
          </p>
          <div className="flex gap-2">
            {/* Export dropdown */}
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportOpen(v => !v)}
                className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors flex items-center gap-1"
              >
                Exportieren
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {exportOpen && (
                <div className="dropdown-enter absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-20 overflow-hidden">
                  <button onClick={() => { exportTransactionsPDF(filtered, activeFilters(), userName, budgetName); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    Als PDF
                  </button>
                  <button onClick={() => { downloadCSV(filtered); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6M5 8h14M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /></svg>
                    Als CSV
                  </button>
                  <div className="border-t border-gray-100 dark:border-gray-700" />
                  <button onClick={() => { printTransactions(filtered, budgetName, userName); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    Drucken
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Transaction list */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            message="Noch keine Transaktionen. Erste Transaktion hinzufügen →"
            action={{ label: 'Erste Transaktion hinzufügen', onClick: onNavigateToNew }}
          />
        ) : (
          <>
            {/* ── Mobile: Card view ──────────────────────────────────────────── */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(t => {
                const hasImg = hasReceipt(t.id);
                return (
                  <div key={t.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          <Highlight text={t.description} query={debouncedSearch} />
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {formatDate(t.date)}
                          {' · '}
                          <Highlight text={t.category} query={debouncedSearch} />
                        </p>
                        {t.note && t.note.split('\n').filter(Boolean).map((n, i) => (
                          <p key={i} className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{n}</p>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-sm font-semibold whitespace-nowrap mr-1">
                          <span className="text-gray-900 dark:text-gray-100"
                            style={t.type === 'income' ? { color: '#4A6FA5' } : undefined}>
                            {t.type === 'income' ? '+' : '−'} {formatEuro(t.amount)}
                          </span>
                        </span>
                        {/* Receipt icon */}
                        <button
                          onClick={() => openReceipt(t.id)}
                          className={`p-1 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${
                            hasImg
                              ? 'text-[#4A6FA5]'
                              : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400'
                          }`}
                          title={hasImg ? 'Beleg ansehen' : 'Beleg hinzufügen'}
                        >
                          <ReceiptIcon />
                        </button>
                        <button onClick={() => openEdit(t)}
                          className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Bearbeiten">
                          <EditIcon />
                        </button>
                        {deleteConfirm === t.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => { onDelete(t.id); setDeleteConfirm(null); }}
                              className="text-xs px-2 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded">Ja</button>
                            <button onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">Nein</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(t.id)}
                            className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center">
                            <TrashIcon />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Desktop: Table view ────────────────────────────────────────── */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-gray-800 dark:hover:text-gray-200"
                      onClick={() => toggleSort('date')}>
                      Datum <SortIcon k="date" />
                    </th>
                    <th className="text-left px-4 py-3 font-medium">Typ</th>
                    <th className="text-left px-4 py-3 font-medium">Kategorie</th>
                    <th className="text-left px-4 py-3 font-medium">Beschreibung</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-gray-800 dark:hover:text-gray-200"
                      onClick={() => toggleSort('amount')}>
                      Betrag <SortIcon k="amount" />
                    </th>
                    <th className="px-4 py-3 text-center font-medium">Beleg</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const hasImg = hasReceipt(t.id);
                    return (
                      <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(t.date)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                            {t.type === 'income' ? 'Einnahme' : 'Ausgabe'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          <Highlight text={t.category} query={debouncedSearch} />
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                          <Highlight text={t.description} query={debouncedSearch} />
                          {t.note && t.note.split('\n').filter(Boolean).map((n, i) => (
                            <span key={i} className="block text-xs text-gray-400 dark:text-gray-500">{n}</span>
                          ))}
                        </td>
                        <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                          <span className="text-gray-900 dark:text-gray-100"
                            style={t.type === 'income' ? { color: '#4A6FA5' } : undefined}>
                            {t.type === 'income' ? '+' : '−'} {formatEuro(t.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openReceipt(t.id)}
                            title={hasImg ? 'Beleg ansehen' : 'Beleg hinzufügen'}
                            className={`p-1 rounded transition-colors ${
                              hasImg
                                ? 'text-[#4A6FA5] hover:opacity-70'
                                : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400'
                            }`}
                          >
                            <ReceiptIcon />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => openEdit(t)}
                              className="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-400 transition-colors p-1 rounded"
                              title="Bearbeiten">
                              <EditIcon />
                            </button>
                            {deleteConfirm === t.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Löschen?</span>
                                <button onClick={() => { onDelete(t.id); setDeleteConfirm(null); }}
                                  className="text-xs px-2 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-700">Ja</button>
                                <button onClick={() => setDeleteConfirm(null)}
                                  className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">Nein</button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirm(t.id)}
                                className="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-400 transition-colors p-1 rounded">
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Hidden file inputs for receipt modal */}
      <input ref={receiptCamRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleReceiptFile} />
      <input ref={receiptFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleReceiptFile} />

      {/* ── Edit Modal ───────────────────────────────────────────────── */}
      {editingTx && (() => {
        const catOptions = categories.filter(c => c.type === editForm.type).map(c => c.name);
        const inputCls2 = 'w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#4A6FA5]';
        return (
          <>
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setEditingTx(null)} />
            <div className="modal-enter fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-lg mx-auto">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Transaktion bearbeiten</p>
                  <button onClick={() => setEditingTx(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <form onSubmit={handleEditSave} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                  {/* Typ */}
                  <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
                    {(['expense', 'income'] as const).map(t => (
                      <button key={t} type="button"
                        onClick={() => setEditForm(f => ({ ...f, type: t, category: '' }))}
                        className={`flex-1 py-2.5 text-sm font-medium transition-colors ${editForm.type === t ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                        style={editForm.type === t ? { backgroundColor: ACCENT } : undefined}>
                        {t === 'expense' ? 'Ausgabe' : 'Einnahme'}
                      </button>
                    ))}
                  </div>
                  {/* Datum */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Datum</label>
                    <input type="date" required value={editForm.date ?? ''} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} className={inputCls2} />
                  </div>
                  {/* Betrag */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Betrag (€)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                      <input type="text" inputMode="decimal" required
                        value={editForm.amount ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, amount: parseFloat(e.target.value.replace(',', '.')) || 0 }))}
                        className={`${inputCls2} pl-7`} />
                    </div>
                  </div>
                  {/* Kategorie */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Kategorie</label>
                    <select required value={editForm.category ?? ''} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} className={`${inputCls2} bg-white dark:bg-gray-700`}>
                      <option value="">Kategorie wählen</option>
                      {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
                      {editForm.category && !catOptions.includes(editForm.category) && (
                        <option value={editForm.category}>{editForm.category}</option>
                      )}
                    </select>
                  </div>
                  {/* Beschreibung */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Beschreibung</label>
                    <input type="text" required value={editForm.description ?? ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={inputCls2} />
                  </div>
                  {/* Notiz */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Notiz (optional)</label>
                    <input type="text" value={editForm.note ?? ''} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} className={inputCls2} />
                  </div>
                  {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
                  <div className="flex gap-3 pt-1">
                    <button type="submit" disabled={editSaving}
                      className="flex-1 py-2.5 text-sm font-semibold text-white rounded disabled:opacity-50"
                      style={{ backgroundColor: ACCENT }}>
                      {editSaving ? 'Speichern…' : 'Speichern'}
                    </button>
                    <button type="button" onClick={() => setEditingTx(null)}
                      className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                      Abbrechen
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Receipt Modal ─────────────────────────────────────────────── */}
      {receiptModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setReceiptModal(null)} />
          <div className="modal-enter fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-lg mx-auto">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {receiptUrl ? 'Beleg' : 'Beleg hinzufügen'}
                </p>
                <button
                  onClick={() => setReceiptModal(null)}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="p-4">
                {receiptUrl ? (
                  <img
                    src={receiptUrl}
                    alt="Beleg"
                    className="w-full max-h-[60vh] object-contain rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-4">
                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500">
                      <ReceiptIcon />
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                      Noch kein Beleg vorhanden.
                    </p>
                    {receiptProcessing && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">Verarbeite…</p>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 px-4 pb-4 flex-wrap">
                {/* Camera — mobile only */}
                <button
                  onClick={() => receiptCamRef.current?.click()}
                  className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Kamera
                </button>
                {/* File upload */}
                <button
                  onClick={() => receiptFileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <span className="lg:hidden">Galerie / Datei</span>
                  <span className="hidden lg:inline">Datei hochladen</span>
                </button>
                {/* Print — desktop only */}
                {receiptUrl && (
                  <button
                    onClick={() => {
                      const tx = filtered.find(t => t.id === receiptModal);
                      printReceipt(receiptUrl, tx?.description ?? 'Beleg');
                    }}
                    className="hidden lg:flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Drucken
                  </button>
                )}
                {/* Spacer */}
                <div className="flex-1" />
                {/* Delete receipt */}
                {receiptUrl && (
                  <button
                    onClick={handleDeleteReceipt}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs border border-red-200 dark:border-red-800 rounded text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Beleg entfernen
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EditIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12h6m-6 4h6M5 8h14M3 6l1 14a1 1 0 001 1h14a1 1 0 001-1L21 6M3 6h18" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
