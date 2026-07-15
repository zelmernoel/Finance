import { useState, useEffect, useCallback, type FormEvent } from 'react';
import type { SavingsPot, PotAllocation } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { createSavingsPotsAdapter } from '../lib/savingsPotsAdapter';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { formatEuro, formatDate, ACCENT } from '../utils';

const PRESET_COLORS = [
  '#4A6FA5', '#2D6A4F', '#6B4C9A', '#C77D00', '#B5001B',
  '#1A6985', '#374151', '#8B5CF6', '#059669', '#DC2626',
];
const PRESET_ICONS = ['🐷', '🛟', '📈', '🏖️', '🚗', '🏠', '🎁', '💍', '🎓', '💻'];

interface FormState {
  name: string;
  percent: string;
  target: string;
  color: string;
  icon: string;
}
const EMPTY_FORM: FormState = { name: '', percent: '', target: '', color: ACCENT, icon: '' };

export default function SavingsPotsPage() {
  const { user } = useAuth();
  const { activeBudgetId, activeBudget } = useBudget();

  const [pots, setPots]       = useState<SavingsPot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [formOpen, setFormOpen]     = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // per-pot allocation history (lazy-loaded when expanded)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory]       = useState<Record<string, PotAllocation[] | 'loading'>>({});

  const load = useCallback(async () => {
    if (!user || !activeBudgetId) return;
    setLoading(true);
    setError(null);
    try {
      const adapter = createSavingsPotsAdapter(user.id, activeBudgetId);
      setPots(await adapter.getPots());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [user, activeBudgetId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived allocation figures ─────────────────────────────────────────────
  const totalAllocated = pots.reduce((s, p) => s + p.allocationPercent, 0);
  const otherAllocated = editingId
    ? totalAllocated - (pots.find(p => p.id === editingId)?.allocationPercent ?? 0)
    : totalAllocated;
  const inputPercent = parseFloat(form.percent.replace(',', '.')) || 0;
  const freeAfter    = Math.round((100 - otherAllocated - inputPercent) * 100) / 100;
  const overbooked   = freeAfter < 0;
  const isFull        = totalAllocated >= 100;

  // ── Form helpers ───────────────────────────────────────────────────────────
  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, color: PRESET_COLORS[pots.length % PRESET_COLORS.length] });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(p: SavingsPot) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      percent: String(p.allocationPercent).replace('.', ','),
      target: p.targetAmount != null ? String(p.targetAmount).replace('.', ',') : '',
      color: p.color,
      icon: p.icon ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !activeBudgetId) return;
    const name = form.name.trim();
    if (!name) { setFormError('Bitte einen Namen eingeben.'); return; }
    if (inputPercent < 0 || inputPercent > 100) { setFormError('Prozentsatz muss zwischen 0 und 100 liegen.'); return; }
    if (overbooked) { setFormError('Gesamtzuteilung überschreitet 100 %.'); return; }
    const target = form.target.trim() ? parseFloat(form.target.replace(',', '.')) : undefined;
    if (target !== undefined && (isNaN(target) || target < 0)) { setFormError('Ungültiges Sparziel.'); return; }

    setSaving(true);
    setFormError(null);
    try {
      const adapter = createSavingsPotsAdapter(user.id, activeBudgetId);
      if (editingId) {
        const updated = await adapter.updatePot(editingId, {
          name, allocationPercent: inputPercent, targetAmount: target,
          color: form.color, icon: form.icon || undefined,
        });
        setPots(prev => prev.map(p => p.id === editingId ? updated : p));
      } else {
        const maxSort = pots.reduce((m, p) => Math.max(m, p.sortOrder), -1);
        const created = await adapter.addPot({
          id: crypto.randomUUID(), budgetId: activeBudgetId,
          name, allocationPercent: inputPercent, targetAmount: target,
          color: form.color, icon: form.icon || undefined, sortOrder: maxSort + 1,
        });
        setPots(prev => [...prev, created]);
      }
      closeForm();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!user || !activeBudgetId) return;
    try {
      const adapter = createSavingsPotsAdapter(user.id, activeBudgetId);
      await adapter.deletePot(id);
      setPots(prev => prev.filter(p => p.id !== id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Löschen.');
    }
  }

  async function toggleHistory(potId: string) {
    if (expandedId === potId) { setExpandedId(null); return; }
    setExpandedId(potId);
    if (!history[potId] && user && activeBudgetId) {
      setHistory(prev => ({ ...prev, [potId]: 'loading' }));
      try {
        const adapter = createSavingsPotsAdapter(user.id, activeBudgetId);
        const rows = await adapter.getAllocations(potId);
        setHistory(prev => ({ ...prev, [potId]: rows }));
      } catch {
        setHistory(prev => ({ ...prev, [potId]: [] }));
      }
    }
  }

  // ── Guest hint ─────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4 text-2xl">🐷</div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Sparttöpfe</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-sm mx-auto">
            Verteile jede Einnahme automatisch auf Sparziele. Diese Funktion synchronisiert
            serverseitig und ist nur mit Konto verfügbar.
          </p>
          <a href="/login" className="inline-block px-4 py-2 text-sm font-medium text-white rounded" style={{ backgroundColor: ACCENT }}>
            Anmelden
          </a>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">Sparttöpfe</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
            {activeBudget?.name ?? 'Bereich'} · Einnahmen automatisch verteilen
          </p>
        </div>
        <button
          onClick={formOpen ? closeForm : openCreate}
          className="px-4 py-2 text-sm font-medium text-white rounded flex-shrink-0"
          style={{ backgroundColor: ACCENT }}
        >
          {formOpen ? 'Schließen' : '+ Neuer Topf'}
        </button>
      </div>

      {/* ── Allocation overview ─────────────────────────────────────────────── */}
      {pots.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Verplant</p>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
              {totalAllocated.toFixed(totalAllocated % 1 === 0 ? 0 : 2)} % · {(100 - totalAllocated).toFixed((100 - totalAllocated) % 1 === 0 ? 0 : 2)} % frei
            </p>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
            {pots.map(p => (
              <div key={p.id} style={{ width: `${Math.min(100, p.allocationPercent)}%`, backgroundColor: p.color }} title={`${p.name}: ${p.allocationPercent} %`} />
            ))}
          </div>
          {isFull && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              100 % verplant — für weitere Töpfe zuerst einen bestehenden reduzieren.
            </p>
          )}
        </Card>
      )}

      {/* ── Create / edit form ──────────────────────────────────────────────── */}
      {formOpen && (
        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {editingId ? 'Topf bearbeiten' : 'Neuer Topf'}
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Name</label>
              <input
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="z. B. Notgroschen"
                className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Anteil je Einnahme (%)</label>
                <input
                  value={form.percent} onChange={e => setForm(f => ({ ...f, percent: e.target.value }))}
                  inputMode="decimal" placeholder="0"
                  className={`w-full border rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none ${overbooked ? 'border-red-400 focus:border-red-500' : 'border-gray-200 dark:border-gray-600 focus:border-[#4A6FA5]'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Sparziel (€, optional)</label>
                <input
                  value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                  inputMode="decimal" placeholder="—"
                  className="w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#4A6FA5]"
                />
              </div>
            </div>

            {/* Live free-percent hint */}
            <div className={`text-xs rounded px-3 py-2 ${overbooked ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400'}`}>
              {overbooked
                ? `${Math.abs(freeAfter).toFixed(Math.abs(freeAfter) % 1 === 0 ? 0 : 2)} % über der 100 %-Grenze — bitte reduzieren.`
                : `Noch ${freeAfter.toFixed(freeAfter % 1 === 0 ? 0 : 2)} % frei verfügbar (bleibt unverplant).`}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Farbe</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 dark:ring-offset-gray-800' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Icon (optional)</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button" onClick={() => setForm(f => ({ ...f, icon: '' }))}
                  className={`w-8 h-8 rounded flex items-center justify-center text-xs border ${form.icon === '' ? 'border-transparent ring-2 ring-[#4A6FA5]' : 'border-gray-200 dark:border-gray-600'} text-gray-400`}
                >—</button>
                {PRESET_ICONS.map(ic => (
                  <button
                    key={ic} type="button" onClick={() => setForm(f => ({ ...f, icon: ic }))}
                    className={`w-8 h-8 rounded flex items-center justify-center text-base border ${form.icon === ic ? 'border-transparent ring-2 ring-[#4A6FA5]' : 'border-gray-200 dark:border-gray-600'}`}
                  >{ic}</button>
                ))}
              </div>
            </div>

            {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}

            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving || overbooked}
                className="flex-1 py-2.5 text-sm font-semibold text-white rounded disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}>
                {saving ? 'Speichern…' : editingId ? 'Speichern' : 'Topf anlegen'}
              </button>
              <button type="button" onClick={closeForm}
                className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Abbrechen
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* ── List ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <Card className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-gray-200 dark:border-gray-700 rounded-full animate-spin mx-auto" style={{ borderTopColor: ACCENT }} />
        </Card>
      ) : error ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
          <button onClick={load} className="text-sm px-4 py-2 text-white rounded" style={{ backgroundColor: ACCENT }}>Erneut versuchen</button>
        </Card>
      ) : pots.length === 0 ? (
        <EmptyState
          message="Noch keine Sparttöpfe. Lege einen an, um Einnahmen automatisch zu verteilen."
          action={{ label: 'Ersten Topf anlegen', onClick: openCreate }}
        />
      ) : (
        <div className="space-y-3">
          {pots.map(pot => {
            const hasTarget = pot.targetAmount != null && pot.targetAmount > 0;
            const progress  = hasTarget ? Math.min(100, (pot.currentAmount / (pot.targetAmount as number)) * 100) : 0;
            const reached   = hasTarget && pot.currentAmount >= (pot.targetAmount as number);
            const isExpanded = expandedId === pot.id;
            const rows = history[pot.id];
            return (
              <Card key={pot.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-base"
                    style={{ backgroundColor: pot.icon ? 'transparent' : pot.color, border: pot.icon ? `2px solid ${pot.color}` : undefined }}>
                    {pot.icon || ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{pot.name}</p>
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0" style={{ color: pot.color, backgroundColor: `${pot.color}1a` }}>
                        {pot.allocationPercent.toFixed(pot.allocationPercent % 1 === 0 ? 0 : 2)} %
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums mt-0.5">
                      {formatEuro(pot.currentAmount)}
                      {hasTarget && (
                        <span className="text-xs font-normal text-gray-400 dark:text-gray-500"> / {formatEuro(pot.targetAmount as number)}</span>
                      )}
                    </p>

                    {hasTarget && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: pot.color }} />
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                          {reached ? '🎉 Ziel erreicht' : `${progress.toFixed(0)} % des Ziels`}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-2">
                      <button onClick={() => toggleHistory(pot.id)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1">
                        Verlauf
                        <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button onClick={() => openEdit(pot)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Bearbeiten</button>
                      {deleteConfirm === pot.id ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                          {pot.currentAmount > 0 ? `${formatEuro(pot.currentAmount)} werden freigegeben.` : 'Löschen?'}
                          <button onClick={() => handleDelete(pot.id)} className="px-2 py-0.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded">Ja</button>
                          <button onClick={() => setDeleteConfirm(null)} className="px-2 py-0.5 border border-gray-200 dark:border-gray-600 rounded">Nein</button>
                        </span>
                      ) : (
                        <button onClick={() => setDeleteConfirm(pot.id)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500">Löschen</button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        {rows === 'loading' || rows === undefined ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500">Lädt…</p>
                        ) : rows.length === 0 ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500">Noch keine Zuweisungen. Sie entstehen automatisch bei neuen Einnahmen.</p>
                        ) : (
                          <ul className="space-y-1">
                            {rows.map(r => (
                              <li key={r.id} className="flex items-center justify-between text-xs">
                                <span className="text-gray-400 dark:text-gray-500">{formatDate(r.createdAt.slice(0, 10))}</span>
                                <span className="text-gray-700 dark:text-gray-300 tabular-nums">+ {formatEuro(r.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
