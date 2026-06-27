import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { Category, Transaction } from '../types';
import Card from '../components/Card';
import ErrorBoundary from '../components/ErrorBoundary';
import EmptyState from '../components/EmptyState';
import {
  formatEuro, getCurrentMonth, filterByMonth, getLast12Months,
  groupByCategory, ACCENT, CHART_COLORS,
} from '../utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const euroFmt = (v: any) => formatEuro(typeof v === 'number' ? v : 0);
function smartTick(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;
}
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

interface Props {
  transactions: Transaction[];
  categories: Category[];
  onNavigateToNew: () => void;
  onUpdateCategory: (id: string, patch: { monthlyBudget?: number }) => Promise<void>;
}

export default function Analysis({ transactions, categories, onNavigateToNew, onUpdateCategory }: Props) {
  const { year, month } = getCurrentMonth();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const currentExpenses = useMemo(() =>
    filterByMonth(transactions, year, month).filter(t => t.type === 'expense'),
    [transactions, year, month]);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const prevExpenses = useMemo(() =>
    filterByMonth(transactions, prevYear, prevMonth).filter(t => t.type === 'expense'),
    [transactions, prevYear, prevMonth]);

  // Top 5
  const top5Data = useMemo(() => {
    const current = groupByCategory(currentExpenses);
    const prev    = groupByCategory(prevExpenses);
    const allCats = new Set([...Object.keys(current), ...Object.keys(prev)]);
    return [...allCats]
      .map(cat => ({ cat, current: current[cat] ?? 0, prev: prev[cat] ?? 0 }))
      .sort((a, b) => b.current - a.current).slice(0, 5);
  }, [currentExpenses, prevExpenses]);

  // Average monthly + category ranking
  const monthCount = Math.max(getLast12Months().length, 1);
  const allExpenses = useMemo(() => transactions.filter(t => t.type === 'expense'), [transactions]);
  const totalExpenses = useMemo(() => allExpenses.reduce((s, t) => s + t.amount, 0), [allExpenses]);

  const categoryRanking = useMemo(() => {
    const grouped = groupByCategory(allExpenses);
    const currentGrouped = groupByCategory(currentExpenses);
    const prevGrouped    = groupByCategory(prevExpenses);
    return Object.entries(grouped)
      .map(([cat, total]) => {
        const currentAmt = currentGrouped[cat] ?? 0;
        const prevAmt    = prevGrouped[cat] ?? 0;
        const trend      = prevAmt === 0 ? null : ((currentAmt - prevAmt) / prevAmt) * 100;
        const catObj     = categories.find(c => c.name === cat);
        return {
          cat, total, avg: total / monthCount,
          pct: totalExpenses > 0 ? (total / totalExpenses) * 100 : 0,
          trend, monthlyBudget: catObj?.monthlyBudget,
          catId: catObj?.id,
          currentAmt,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [allExpenses, currentExpenses, prevExpenses, categories, monthCount, totalExpenses]);

  // Category detail: monthly line chart for selected category
  const catDetailData = useMemo(() => {
    if (!selectedCat) return [];
    return getLast12Months().map(({ year, month, label }) => {
      const monthExpenses = filterByMonth(transactions, year, month).filter(t => t.type === 'expense');
      const grouped = groupByCategory(monthExpenses);
      return { label, Betrag: grouped[selectedCat] ?? 0 };
    });
  }, [selectedCat, transactions]);

  // Saving trend
  const savingTrend = useMemo(() => getLast12Months().map(({ year, month, label }) => {
    const monthTx = filterByMonth(transactions, year, month);
    const income  = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { label, Sparrate: income - expense };
  }), [transactions]);

  // Scatter
  const scatterData = useMemo(() => transactions
    .filter(t => t.type === 'expense')
    .map(t => {
      const d = new Date(t.date);
      return { weekday: d.getDay(), dayOfMonth: d.getDate(), amount: t.amount, label: t.description };
    }), [transactions]);

  // YTD
  const ytdData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
      const monthTx = filterByMonth(transactions, year, m);
      const income  = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      return {
        label: new Date(year, m - 1, 1).toLocaleDateString('de-DE', { month: 'long' }),
        income, expense, savings: income - expense,
      };
    }).filter(r => r.income > 0 || r.expense > 0);
  }, [transactions, year]);

  if (transactions.length === 0) {
    return (
      <EmptyState
        message="Noch keine Transaktionen vorhanden."
        action={{ label: 'Erste Transaktion hinzufügen', onClick: onNavigateToNew }}
      />
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Kategorie-Ranking ─────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Kategorie-Ranking</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="text-left py-2 pl-0 font-medium">Kategorie</th>
                  <th className="text-right py-2 font-medium">Gesamt</th>
                  <th className="text-right py-2 font-medium">Ø/Monat</th>
                  <th className="text-right py-2 font-medium">Anteil</th>
                  <th className="text-right py-2 font-medium">Trend</th>
                  <th className="text-right py-2 font-medium">Budget/Monat</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {categoryRanking.map((row, i) => (
                  <tr key={row.cat}
                    className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${selectedCat === row.cat ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedCat(selectedCat === row.cat ? null : row.cat)}>
                    <td className="py-2 pl-0">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="font-medium text-gray-900">{row.cat}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right text-gray-700">{formatEuro(row.total)}</td>
                    <td className="py-2 text-right text-gray-500">{formatEuro(row.avg)}</td>
                    <td className="py-2 text-right text-gray-500">{row.pct.toFixed(1)} %</td>
                    <td className="py-2 text-right">
                      {row.trend !== null ? (
                        <span className={`text-xs font-medium ${row.trend > 5 ? 'text-red-500' : row.trend < -5 ? 'text-green-600' : 'text-gray-400'}`}>
                          {row.trend > 0 ? '↑' : '↓'} {Math.abs(row.trend).toFixed(0)} %
                        </span>
                      ) : <span className="text-xs text-gray-300">–</span>}
                    </td>
                    <td className="py-2 text-right">
                      {row.monthlyBudget ? (
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, (row.currentAmt / row.monthlyBudget) * 100)}%`,
                                backgroundColor: row.currentAmt > row.monthlyBudget ? '#EF4444' : ACCENT,
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {formatEuro(row.monthlyBudget)}
                          </span>
                        </div>
                      ) : (
                        row.catId ? (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const v = prompt(`Monatsbudget für "${row.cat}" (€):`, '');
                              const n = parseFloat((v ?? '').replace(',', '.'));
                              if (!isNaN(n) && n > 0 && row.catId) {
                                onUpdateCategory(row.catId, { monthlyBudget: n });
                              }
                            }}
                            className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2"
                          >
                            + Setzen
                          </button>
                        ) : <span className="text-xs text-gray-300">–</span>
                      )}
                    </td>
                    <td className="py-2 pl-2">
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${selectedCat === row.cat ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Category detail chart */}
          {selectedCat && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Ausgabenverlauf: <span style={{ color: ACCENT }}>{selectedCat}</span>
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={catDetailData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={smartTick} tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={euroFmt} contentStyle={{ fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 6 }} />
                  <Line type="monotone" dataKey="Betrag" stroke={ACCENT} strokeWidth={2} dot={{ r: 3, fill: ACCENT }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </ErrorBoundary>

      {/* ── Top 5 ────────────────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Top 5 Ausgabenkategorien: Lfd. Monat vs. Vormonat</h2>
          {top5Data.length === 0 ? (
            <EmptyState message="Keine Ausgaben in diesem Monat." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={top5Data} layout="vertical" barGap={4} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tickFormatter={smartTick} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="cat" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={90} />
                <Tooltip formatter={euroFmt} contentStyle={{ fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 6 }} />
                <Bar dataKey="current" name="Lfd. Monat" fill={ACCENT} radius={[0, 2, 2, 0]} />
                <Bar dataKey="prev"    name="Vormonat"   fill="#9CA3AF" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </ErrorBoundary>

      {/* ── Ø Ausgaben ───────────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Ø Monatliche Ausgaben pro Kategorie</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="text-left py-2 font-medium">Kategorie</th>
                  <th className="text-right py-2 font-medium">Ø / Monat</th>
                  <th className="text-right py-2 font-medium">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {categoryRanking.map((row, i) => (
                  <tr key={row.cat} className="border-b border-gray-100">
                    <td className="py-2 flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      {row.cat}
                    </td>
                    <td className="py-2 text-right font-medium">{formatEuro(row.avg)}</td>
                    <td className="py-2 text-right text-gray-500">{formatEuro(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryRanking.slice(0, 7)} layout="vertical" barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tickFormatter={smartTick} tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="cat" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={euroFmt} contentStyle={{ fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 6 }} />
                <Bar dataKey="avg" name="Ø / Monat" radius={[0, 2, 2, 0]}>
                  {categoryRanking.slice(0, 7).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </ErrorBoundary>

      {/* ── Sparrate ─────────────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Sparrate pro Monat</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={savingTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={smartTick} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={euroFmt} contentStyle={{ fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 6 }} />
              <Line type="monotone" dataKey="Sparrate" stroke={ACCENT} strokeWidth={2} dot={{ r: 3, fill: ACCENT }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </ErrorBoundary>

      {/* ── Ausgabenrhythmus ─────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Ausgabenrhythmus</h2>
          <p className="text-xs text-gray-400 mb-4">Wochentag × Tag des Monats — Punktgröße = Betrag</p>
          {scatterData.length === 0 ? <EmptyState message="Keine Ausgaben vorhanden." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" dataKey="dayOfMonth" domain={[1, 31]}
                  ticks={[1, 5, 10, 15, 20, 25, 31]}
                  tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} name="Tag"
                  label={{ value: 'Tag des Monats', position: 'insideBottom', offset: -4, fontSize: 10, fill: '#9CA3AF' }} />
                <YAxis type="number" dataKey="weekday" domain={[0, 6]}
                  ticks={[0, 1, 2, 3, 4, 5, 6]}
                  tickFormatter={v => WEEKDAYS[v as number]}
                  tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} name="Wochentag" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload as { label: string; amount: number; weekday: number; dayOfMonth: number };
                    return (
                      <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow-sm">
                        <p className="font-medium">{d.label}</p>
                        <p>{formatEuro(d.amount)}</p>
                        <p className="text-gray-400">{WEEKDAYS[d.weekday]}, Tag {d.dayOfMonth}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill={ACCENT} opacity={0.7}
                  shape={(props: { cx?: number; cy?: number; payload?: { amount: number } }) => {
                    const { cx = 0, cy = 0, payload } = props;
                    const r = Math.max(3, Math.min(14, Math.sqrt((payload?.amount ?? 0) / 10)));
                    return <circle cx={cx} cy={cy} r={r} fill={ACCENT} opacity={0.6} />;
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Card>
      </ErrorBoundary>

      {/* ── YTD ──────────────────────────────────────────────────────── */}
      <ErrorBoundary>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Jahresübersicht {year}</h2>
          {ytdData.length === 0 ? <EmptyState message="Keine Daten für dieses Jahr." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                    <th className="text-left py-2 font-medium">Monat</th>
                    <th className="text-right py-2 font-medium">Einnahmen</th>
                    <th className="text-right py-2 font-medium">Ausgaben</th>
                    <th className="text-right py-2 font-medium">Ersparnis</th>
                    <th className="text-right py-2 font-medium">Sparquote</th>
                  </tr>
                </thead>
                <tbody>
                  {ytdData.map(row => {
                    const rate = row.income > 0 ? (row.savings / row.income) * 100 : 0;
                    return (
                      <tr key={row.label} className="border-b border-gray-100">
                        <td className="py-2 text-gray-700">{row.label}</td>
                        <td className="py-2 text-right" style={{ color: ACCENT }}>{formatEuro(row.income)}</td>
                        <td className="py-2 text-right text-gray-900">{formatEuro(row.expense)}</td>
                        <td className="py-2 text-right font-medium">{formatEuro(row.savings)}</td>
                        <td className="py-2 text-right text-xs text-gray-500">{rate.toFixed(1)} %</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-gray-300 font-semibold">
                    <td className="py-2">Gesamt</td>
                    <td className="py-2 text-right" style={{ color: ACCENT }}>{formatEuro(ytdData.reduce((s, r) => s + r.income, 0))}</td>
                    <td className="py-2 text-right">{formatEuro(ytdData.reduce((s, r) => s + r.expense, 0))}</td>
                    <td className="py-2 text-right">{formatEuro(ytdData.reduce((s, r) => s + r.savings, 0))}</td>
                    <td className="py-2 text-right text-xs text-gray-500">
                      {(() => {
                        const inc = ytdData.reduce((s, r) => s + r.income, 0);
                        const sav = ytdData.reduce((s, r) => s + r.savings, 0);
                        return inc > 0 ? `${((sav / inc) * 100).toFixed(1)} %` : '–';
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </ErrorBoundary>
    </div>
  );
}
