import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Transaction } from '../types';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { formatEuro, formatDate, downloadCSV } from '../utils';
import { exportTransactionsPDF } from '../lib/exportPDF';
import { printTransactions } from '../lib/printTransactions';

interface Props {
  transactions: Transaction[];
  onDelete: (id: string) => void;
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
          ? <mark key={i} className="bg-yellow-100 font-semibold rounded px-0.5">{p}</mark>
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
  transactions, onDelete, onNavigateToNew, budgetName, userName,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filter state (URL-synced search) ────────────────────────────────────
  const [search, setSearchRaw]     = useState(searchParams.get('q') ?? '');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCat] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo]     = useState('');
  const [sortKey, setSortKey]       = useState<SortKey>('date');
  const [sortDir, setSortDir]       = useState<SortDir>('desc');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const searchInputRef              = useRef<HTMLInputElement>(null);

  // Debounce the search input before syncing to URL
  const debouncedSearch = useDebounce(search, 300);

  function setSearch(v: string) {
    setSearchRaw(v);
  }

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (debouncedSearch) params.set('q', debouncedSearch);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, searchParams, setSearchParams]);

  // ── Ctrl+F shortcut ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
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
    if (sortKey !== k) return <span className="ml-1 text-gray-300">↕</span>;
    return <span className="ml-1" style={{ color: '#4A6FA5' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const activeFilters = useCallback(() => ({
    dateFrom: filterFrom || undefined,
    dateTo:   filterTo   || undefined,
    type:     filterType !== 'all' ? filterType : undefined,
    category: filterCategory || undefined,
  }), [filterFrom, filterTo, filterType, filterCategory]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2 md:col-span-1 lg:col-span-2 relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Suche… (Strg+F)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4A6FA5]"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
              >✕</button>
            )}
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value as typeof filterType)}
            className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4A6FA5] bg-white">
            <option value="all">Alle Typen</option>
            <option value="income">Einnahmen</option>
            <option value="expense">Ausgaben</option>
          </select>
          <select value={filterCategory} onChange={e => setFilterCat(e.target.value)}
            className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4A6FA5] bg-white">
            <option value="">Alle Kategorien</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
            className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4A6FA5]" />
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
            className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4A6FA5]" />
        </div>
        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <p className="text-xs text-gray-500">
            {filtered.length} Transaktion{filtered.length !== 1 ? 'en' : ''} gefunden
            {debouncedSearch && <span className="ml-1 text-gray-400">für „{debouncedSearch}"</span>}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => downloadCSV(filtered)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 transition-colors"
            >CSV</button>
            <button
              onClick={() => exportTransactionsPDF(filtered, activeFilters(), userName, budgetName)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 transition-colors"
            >PDF</button>
            <button
              onClick={() => printTransactions(filtered, budgetName, userName)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 transition-colors"
            >Drucken</button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            message="Noch keine Transaktionen. Erste Transaktion hinzufügen →"
            action={{ label: 'Erste Transaktion hinzufügen', onClick: onNavigateToNew }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-gray-800"
                    onClick={() => toggleSort('date')}>
                    Datum <SortIcon k="date" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Typ</th>
                  <th className="text-left px-4 py-3 font-medium">Kategorie</th>
                  <th className="text-left px-4 py-3 font-medium">Beschreibung</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-gray-800"
                    onClick={() => toggleSort('amount')}>
                    Betrag <SortIcon k="amount" />
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {t.type === 'income' ? 'Einnahme' : 'Ausgabe'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <Highlight text={t.category} query={debouncedSearch} />
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      <Highlight text={t.description} query={debouncedSearch} />
                      {t.note && <span className="block text-xs text-gray-400">{t.note}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                      <span style={t.type === 'income' ? { color: '#4A6FA5' } : undefined}>
                        {t.type === 'income' ? '+' : '−'} {formatEuro(t.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {deleteConfirm === t.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-gray-500">Löschen?</span>
                          <button onClick={() => { onDelete(t.id); setDeleteConfirm(null); }}
                            className="text-xs px-2 py-1 bg-gray-900 text-white rounded hover:bg-gray-700">Ja</button>
                          <button onClick={() => setDeleteConfirm(null)}
                            className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">Nein</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(t.id)}
                          className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded" title="Löschen">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
