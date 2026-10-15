import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import type { Category, SavingsPot, Transaction } from '../types';
import Card from '../components/Card';
import ErrorBoundary from '../components/ErrorBoundary';
import EmptyState from '../components/EmptyState';
import {
  formatEuro, getCurrentMonth, filterByMonth, getLast12Months,
  getCustomMonthRange,
  groupByCategory, computeBalance, CHART_INCOME, CHART_EXPENSE, ACCENT,
  formatAxisEuro
} from '../utils';
import { useChartTheme } from '../hooks/useChartTheme';
import { useCategoryColorResolver } from '../hooks/useCategoryColors';
import { useBudget } from '../context/BudgetContext';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  /** Sparttöpfe des Bereichs — ihr Bestand ist reserviert, nicht verfügbar. */
  pots: SavingsPot[];
  startingBalance: number;
  userName: string;
  onNavigateToNew: () => void;
  onNavigateToPots?: () => void;
  /** Klick auf einen Monatsbalken → Auswertung dieses Monats. */
  onNavigateToMonth?: (year: number, month: number) => void;
  monthStart?: number;
}

type DonutRange = 'current' | 'last3' | 'all';

const DONUT_LABELS: Record<DonutRange, string> = {
  current: 'Lfd. Monat',
  last3: 'Letzte 3 M.',
  all: 'Gesamt',
};

function KpiCard({ label, value, hint, highlight = false, onClick }: {
  label: string; value: string; hint?: string; highlight?: boolean; onClick?: () => void;
}) {
  return (
    <Card className="p-4 md:p-5" onClick={onClick}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p
        className={`text-xl md:text-2xl font-semibold tracking-tight ${highlight ? '' : 'text-gray-900 dark:text-gray-100'}`}
        style={highlight ? { color: ACCENT } : undefined}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate">{hint}</p>}
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const euroFormatter = (value: any) => formatEuro(typeof value === 'number' ? value : 0);

export default function Dashboard({
  transactions, categories, pots, startingBalance, userName,
  onNavigateToNew, onNavigateToPots, onNavigateToMonth, monthStart = 1,
}: Props) {
  const [donutRange, setDonutRange] = useState<DonutRange>('current');
  const { year, month } = getCurrentMonth();
  const ct = useChartTheme();
  const { activeBudgetId } = useBudget();
  const catColor = useCategoryColorResolver(activeBudgetId, categories, ct.series);
  const tooltipStyle = {
    fontSize: 12,
    backgroundColor: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 6,
    color: ct.tooltipText,
  };

  const { from: periodFrom, to: periodTo } = getCustomMonthRange(monthStart);
  const currentMonthTx = useMemo(
    () => transactions.filter(t => t.date >= periodFrom && t.date <= periodTo),
    [transactions, periodFrom, periodTo],
  );
  const currentIncome  = useMemo(() => currentMonthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), [currentMonthTx]);
  const currentExpense = useMemo(() => currentMonthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0), [currentMonthTx]);
  const balance        = useMemo(() => startingBalance + computeBalance(transactions), [transactions, startingBalance]);
  const savingsRate    = currentIncome > 0 ? ((currentIncome - currentExpense) / currentIncome) * 100 : 0;

  // Verfügbar = Kontostand minus alles, was in Töpfen liegt. Der Steuertopf
  // zählt mit: dieses Geld gehört dem Finanzamt. Ein negativer Steuertopf
  // (Vorsteuerüberhang) erhöht das Verfügbare — die Erstattung kommt.
  const inPots    = useMemo(() => pots.reduce((s, p) => s + p.currentAmount, 0), [pots]);
  const available = balance - inPots;
  const taxPot    = pots.find(p => p.kind === 'tax');

  const barData = useMemo(() => getLast12Months().map(({ year, month, label }) => {
    const monthTx = filterByMonth(transactions, year, month);
    return {
      label, year, month,
      Einnahmen: monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      Ausgaben:  monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    };
  }), [transactions]);

  const lineData = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    let running = startingBalance;
    return sorted.map((t) => {
      running += t.type === 'income' ? t.amount : -t.amount;
      return { date: t.date, Kontostand: running };
    });
  }, [transactions, startingBalance]);

  const donutData = useMemo(() => {
    let filtered: Transaction[];
    if (donutRange === 'current') {
      filtered = currentMonthTx.filter(t => t.type === 'expense');
    } else if (donutRange === 'last3') {
      const cutoff = new Date(year, month - 4, 1);
      filtered = transactions.filter(t => {
        const d = new Date(t.date);
        return t.type === 'expense' && d >= cutoff;
      });
    } else {
      filtered = transactions.filter(t => t.type === 'expense');
    }
    const grouped = groupByCategory(filtered);
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [transactions, donutRange, currentMonthTx, year, month]);

  if (transactions.length === 0) {
    return (
      <EmptyState
        message="Noch keine Transaktionen. Erste Transaktion hinzufügen →"
        action={{ label: 'Erste Transaktion hinzufügen', onClick: onNavigateToNew }}
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Greeting */}
      {userName && (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Willkommen zurück, <span className="font-medium text-gray-900 dark:text-gray-100">{userName}</span>.
        </p>
      )}

      {/* KPI Row — 2x2 on mobile, 4 columns on lg */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {pots.length > 0 ? (
          <KpiCard
            label="Verfügbar" value={formatEuro(available)} highlight
            hint={`Kontostand ${formatEuro(balance)} · ${formatEuro(inPots)} in Töpfen${taxPot ? ` (Steuer ${formatEuro(taxPot.currentAmount)})` : ''}`}
            onClick={onNavigateToPots}
          />
        ) : (
          <KpiCard label="Kontostand aktuell" value={formatEuro(balance)} highlight />
        )}
        <KpiCard label="Einnahmen (lfd. Monat)" value={formatEuro(currentIncome)} />
        <KpiCard label="Ausgaben (lfd. Monat)" value={formatEuro(currentExpense)} />
        <KpiCard label="Sparquote" value={`${savingsRate.toFixed(1)} %`} />
      </div>

      {/* Bar chart */}
      <ErrorBoundary>
        <Card className="p-4 md:p-5">
          <div className="flex items-baseline justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Einnahmen vs. Ausgaben (letzte 12 Monate)</h2>
            {onNavigateToMonth && (
              <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">Monat anklicken für die Auswertung</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={barData} barGap={2} barCategoryGap="30%"
              className={onNavigateToMonth ? 'cursor-pointer' : undefined}
              onClick={(state: unknown) => {
                const s = state as { activePayload?: Array<{ payload?: { year: number; month: number } }> };
                const p = s?.activePayload?.[0]?.payload;
                if (p && onNavigateToMonth) onNavigateToMonth(p.year, p.month);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: ct.tick }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={formatAxisEuro} tick={{ fontSize: 10, fill: ct.tick }} axisLine={false} tickLine={false} />
              {/* Dezenter Hover: nur eine leichte Umrandung statt der kräftigen Standardfläche */}
              <Tooltip
                formatter={euroFormatter} contentStyle={tooltipStyle} labelStyle={{ color: ct.tooltipText }}
                cursor={{ fill: ct.cursorFill, fillOpacity: 0.18, stroke: ct.cursorFill, strokeWidth: 1, radius: 4 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: ct.tick }} />
              <Bar dataKey="Einnahmen" fill={CHART_INCOME} radius={[2, 2, 0, 0]} />
              <Bar dataKey="Ausgaben" fill={CHART_EXPENSE} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        {/* Line chart */}
        <ErrorBoundary>
          <Card className="p-4 md:p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Kontostandsverlauf (kumulativ)</h2>
            {lineData.length === 0 ? (
              <EmptyState message="Keine Daten vorhanden." />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                  <YAxis tickFormatter={formatAxisEuro} tick={{ fontSize: 10, fill: ct.tick }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={euroFormatter} contentStyle={tooltipStyle} labelStyle={{ color: ct.tooltipText }} />
                  <Line type="monotone" dataKey="Kontostand" stroke={ACCENT} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </ErrorBoundary>

        {/* Donut chart */}
        <ErrorBoundary>
          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ausgaben nach Kategorie</h2>
              <div className="flex gap-1">
                {(Object.keys(DONUT_LABELS) as DonutRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setDonutRange(r)}
                    className={`px-1.5 py-1 text-xs rounded border transition-colors ${
                      donutRange === r
                        ? 'text-white border-transparent'
                        : 'text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-400'
                    }`}
                    style={donutRange === r ? { backgroundColor: ACCENT, borderColor: ACCENT } : undefined}
                  >
                    {DONUT_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            {donutData.length === 0 ? (
              <EmptyState message="Keine Ausgaben im gewählten Zeitraum." />
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={180}>
                  <PieChart>
                    <Pie data={donutData} cx="50%" cy="50%"
                      innerRadius={50} outerRadius={78} dataKey="value" paddingAngle={2}>
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={catColor(d.name, i)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={euroFormatter} contentStyle={tooltipStyle} labelStyle={{ color: ct.tooltipText }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5 overflow-hidden">
                  {donutData.slice(0, 6).map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: catColor(d.name, i) }} />
                      <span className="text-gray-600 dark:text-gray-400 truncate flex-1">{d.name}</span>
                      <span className="text-gray-900 dark:text-gray-100 font-medium">{formatEuro(d.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </ErrorBoundary>
      </div>
    </div>
  );
}
