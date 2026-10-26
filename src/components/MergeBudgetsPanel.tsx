import { useEffect, useMemo, useState } from 'react';
import type { Budget, MergeResult, SavingsPot } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { createSavingsPotsAdapter } from '../lib/savingsPotsAdapter';
import Card from './Card';
import { ChoiceTile } from './Choice';
import { ACCENT, formatEuro } from '../utils';

// ── Bereiche zusammenführen ───────────────────────────────────────────────────
// Vier kurze Schritte, jeder mit einem Tipp erledigt (bis auf den Namen):
//   1  Womit?    anderen Bereich antippen
//   2  Als was?  Privat (ohne Töpfe/Steuer) oder Firma (Töpfe bleiben)
//   3  Name      vorbelegt, ein Tipp übernimmt einen der beiden alten Namen
//   4  Prüfen    was passiert, dann Zusammenführen
//
// `base` ist der Bereich, auf dem „Zusammenführen“ angetippt wurde. Er bleibt
// bestehen (seine ID, Farbe, Monatsbeginn), der andere wird hineingezogen und
// danach gelöscht. Die eigentliche Arbeit macht die DB-Funktion merge_budgets
// in einer einzigen Transaktion — hier wird nur erklärt und bestätigt.

const STEPS = ['Womit?', 'Als was?', 'Name', 'Prüfen'] as const;

interface Props {
  base: Budget;
  budgets: Budget[];
  balances: Record<string, number | null>;
  txCounts: Record<string, number>;
  onDone: (result: MergeResult, name: string) => void;
  onCancel: () => void;
}

export default function MergeBudgetsPanel({ base, budgets, balances, txCounts, onDone, onCancel }: Props) {
  const { user } = useAuth();
  const { mergeBudgets } = useBudget();
  const others = budgets.filter(b => b.id !== base.id);

  const [step, setStep]         = useState(0);
  const [otherId, setOtherId]   = useState<string | null>(others.length === 1 ? others[0].id : null);
  const other = others.find(b => b.id === otherId) ?? null;
  // Vorschlag für die Art: ist einer der beiden eine Firma, wird es eine Firma —
  // sonst gingen Töpfe und Steuer verloren, ohne dass man es bewusst wählt.
  // Abgeleitet statt per Effekt gesetzt; eine bewusste Wahl hat Vorrang.
  const suggestedType: Budget['type'] =
    base.type === 'business' || other?.type === 'business' ? 'business' : 'personal';
  const [chosenType, setChosenType] = useState<Budget['type'] | null>(null);
  const type = chosenType ?? suggestedType;
  const [name, setName]         = useState(base.name);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Töpfe beider Bereiche — nur um die Folgen vorher zeigen zu können.
  const [pots, setPots] = useState<Record<string, SavingsPot[]>>({});
  useEffect(() => {
    if (!user || !otherId) return;
    let cancelled = false;
    Promise.all([base.id, otherId].map(async id => {
      try { return [id, await createSavingsPotsAdapter(user.id, id).getPots()] as const; }
      catch { return [id, [] as SavingsPot[]] as const; }
    })).then(entries => { if (!cancelled) setPots(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [user, base.id, otherId]);

  const effect = useMemo(() => {
    const basePots  = pots[base.id] ?? [];
    const otherPots = otherId ? pots[otherId] ?? [] : [];
    const all = [...basePots, ...otherPots];
    const reserved = all.reduce((s, p) => s + p.currentAmount, 0);
    const activePercent = all
      .filter(p => p.kind === 'manual' && p.isActive)
      .reduce((s, p) => s + p.allocationPercent, 0);
    const toPause = activePercent > 100
      ? otherPots.filter(p => p.kind === 'manual' && p.isActive && p.allocationPercent > 0)
      : [];
    const taxPots = all.filter(p => p.kind === 'tax');
    return { count: all.length, reserved, activePercent, toPause, taxPots };
  }, [pots, base.id, otherId]);

  const totalBalance = other
    ? (balances[base.id] ?? 0) + (balances[other.id] ?? 0)
    : 0;
  const totalTx = other ? (txCounts[base.id] ?? 0) + (txCounts[other.id] ?? 0) : 0;
  const typeLabel = type === 'business' ? 'Firma' : 'Privat';

  function next() {
    setError(null);
    if (step === 0 && !other) { setError('Bitte einen Bereich antippen.'); return; }
    if (step === 2 && !name.trim()) { setError('Bitte einen Namen eingeben.'); return; }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  }

  async function handleMerge() {
    if (!other) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mergeBudgets(other.id, base.id, name.trim(), type);
      onDone(result, name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Zusammenführen fehlgeschlagen.');
      setBusy(false);
    }
  }

  // ── Folgen für Töpfe, in einem Satz ───────────────────────────────────────
  function potsSentence(): string | null {
    if (!user) return null;
    if (effect.count === 0) return type === 'personal' ? null : 'Keine Töpfe vorhanden.';
    if (type === 'personal') {
      return `${effect.count} ${effect.count === 1 ? 'Topf wird' : 'Töpfe werden'} aufgelöst, ${formatEuro(effect.reserved)} sind danach wieder verfügbar. Steueranteile der Buchungen entfallen.`;
    }
    const parts = [`${effect.count} ${effect.count === 1 ? 'Topf bleibt' : 'Töpfe bleiben'} erhalten und ${effect.count === 1 ? 'läuft' : 'laufen'} weiter.`];
    if (effect.taxPots.length > 1) {
      parts.push(`Die beiden Steuertöpfe werden zu einem (${formatEuro(effect.taxPots.reduce((s, p) => s + p.currentAmount, 0))}).`);
    }
    if (effect.toPause.length > 0 && other) {
      parts.push(`Zusammen wären ${fmtPct(effect.activePercent)} % verplant — die Töpfe aus „${other.name}“ werden deshalb pausiert (Bestand bleibt).`);
    }
    parts.push('Pausieren kannst du jeden Topf danach unter Sparen.');
    return parts.join(' ');
  }

  return (
    <Card className="p-5">
      {/* Kopf: Schrittanzeige wie im Buchungs-Wizard */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            {step === 0 ? `„${base.name}“ zusammenführen` : STEPS[step]}
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">
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
        {step > 0 && other && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">
            {base.name} + {other.name}{step > 1 ? ` → ${typeLabel}` : ''}
          </p>
        )}
      </div>

      {/* ── 1: Womit? ─────────────────────────────────────────────────────── */}
      {step === 0 && (
        <div role="radiogroup" aria-label="Bereich zum Zusammenführen" className="space-y-2">
          {others.map(b => (
            <ChoiceTile key={b.id}
              active={otherId === b.id}
              onClick={() => { setOtherId(b.id); setError(null); }}
              dot={b.color}
              title={b.name}
              subtitle={`${b.type === 'business' ? 'Firma' : 'Privat'} · ${txCounts[b.id] ?? 0} ${(txCounts[b.id] ?? 0) === 1 ? 'Buchung' : 'Buchungen'}`}
              aside={balances[b.id] != null ? formatEuro(balances[b.id] as number) : undefined}
            />
          ))}
        </div>
      )}

      {/* ── 2: Als was? ───────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Art des neuen Bereichs" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ChoiceTile
              active={type === 'personal'}
              onClick={() => setChosenType('personal')}
              title="Privat"
              subtitle="Ohne Steuer und ohne Töpfe. Bestehende Töpfe werden aufgelöst."
            />
            <ChoiceTile
              active={type === 'business'}
              onClick={() => setChosenType('business')}
              title="Firma"
              subtitle="Brutto/Netto bleibt, alle Töpfe bleiben erhalten und laufen weiter."
            />
          </div>
          {potsSentence() && (
            <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-2 leading-relaxed">
              {potsSentence()}
            </p>
          )}
        </div>
      )}

      {/* ── 3: Name ───────────────────────────────────────────────────────── */}
      {step === 2 && other && (
        <div className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} autoFocus
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), next())}
            placeholder="Name des Bereichs"
            className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-3 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[var(--accent)] min-h-[44px]" />
          <div className="flex flex-wrap gap-2">
            {[base.name, other.name].filter((n, i, a) => a.indexOf(n) === i).map(n => (
              <button key={n} type="button" onClick={() => setName(n)}
                className={`px-3 py-2 text-sm rounded border min-h-[40px] transition-colors ${name === n ? 'text-white border-transparent' : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                style={name === n ? { backgroundColor: ACCENT } : undefined}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 4: Prüfen ─────────────────────────────────────────────────────── */}
      {step === 3 && other && (
        <div className="space-y-4">
          <dl className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
            <Row label="Aus" value={`${base.name} + ${other.name}`} onEdit={() => setStep(0)} />
            <Row label="Wird zu" value={`${name.trim()} · ${typeLabel}`} strong onEdit={() => setStep(2)} />
            <Row label="Buchungen" value={`${totalTx}`} />
            <Row label="Kontostand" value={formatEuro(totalBalance)} />
            {user && effect.count > 0 && (
              <Row label="Töpfe"
                value={type === 'personal'
                  ? `${effect.count} aufgelöst`
                  : `${effect.count} bleiben${effect.toPause.length ? `, ${effect.toPause.length} pausiert` : ''}`}
                onEdit={() => setStep(1)} />
            )}
          </dl>
          <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded px-3 py-2 leading-relaxed">
            Aus zwei Bereichen wird einer. Das lässt sich nicht rückgängig machen.
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* ── Fuß ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-3 mt-6">
        <button type="button" onClick={step === 0 ? onCancel : () => { setError(null); setStep(s => s - 1); }} disabled={busy}
          className="px-4 py-3 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 min-h-[44px]">
          {step === 0 ? 'Abbrechen' : 'Zurück'}
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next}
            className="flex-1 py-3 text-sm font-semibold text-white rounded min-h-[44px]" style={{ backgroundColor: ACCENT }}>
            Weiter
          </button>
        ) : (
          <button type="button" onClick={handleMerge} disabled={busy}
            className="flex-1 py-3 text-sm font-semibold text-white rounded min-h-[44px] disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
            {busy ? 'Wird zusammengeführt…' : 'Zusammenführen'}
          </button>
        )}
      </div>
    </Card>
  );
}

function fmtPct(n: number): string {
  return n.toFixed(n % 1 === 0 ? 0 : 2).replace('.', ',');
}

function Row({ label, value, strong, onEdit }: { label: string; value: string; strong?: boolean; onEdit?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0 w-24">{label}</dt>
      <dd className={`flex-1 text-right min-w-0 break-words ${strong ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}>
        {value}
      </dd>
      {onEdit && (
        <button type="button" onClick={onEdit} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0 pt-0.5">
          Ändern
        </button>
      )}
    </div>
  );
}
