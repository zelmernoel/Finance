import { useCallback, useEffect, useState } from 'react';
import { FREQUENCY_LABELS, type RecurringTransaction } from '../types';
import type { StorageAdapter } from '../lib/storage';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { formatEuro, formatDate, ACCENT, todayISO } from '../utils';
import { calcNextDue } from '../hooks/useRecurringTransactions';

// Neue Daueraufträge entstehen im Buchungs-Wizard (Schritt "Details" →
// "Als Dauerauftrag wiederholen"). Das frühere Zweitformular hier kannte
// weder Steuer noch Kategorie-Vorbelegungen und buchte das Startdatum anders
// als der Wizard — eine Stelle statt zwei.

interface Props {
  storage: StorageAdapter;
  onNavigateToNew: () => void;
}

export default function RecurringPage({ storage, onNavigateToNew }: Props) {
  const { showToast } = useToast();
  const [list, setList] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setList(await storage.getRecurring()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Daueraufträge konnten nicht geladen werden.'); }
    finally { setLoading(false); }
  }, [storage]);

  useEffect(() => { load(); }, [load]);

  const today = todayISO();

  async function run(action: () => Promise<void>) {
    try { await action(); await load(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Aktion fehlgeschlagen', 'error'); }
  }

  /**
   * Pausieren hält die Fälligkeit an. Beim Aktivieren wird sie auf die
   * nächste Fälligkeit ab heute vorgerückt — sonst würden alle Termine aus
   * der Pause nachgebucht (die Nachhol-Logik des Hooks bucht jede
   * überfällige Fälligkeit, siehe useRecurringTransactions).
   */
  function toggle(r: RecurringTransaction) {
    return run(async () => {
      if (r.isActive) { await storage.updateRecurring(r.id, { isActive: false }); return; }
      let nextDue = r.nextDue;
      const anchorDay = Number(r.startDate.slice(8, 10));
      while (nextDue < today) nextDue = calcNextDue(nextDue, r.frequency, anchorDay);
      const expired = r.endDate ? nextDue > r.endDate : false;
      if (expired) throw new Error('Das Enddatum ist überschritten — der Dauerauftrag kann nicht mehr aktiviert werden.');
      await storage.updateRecurring(r.id, { isActive: true, nextDue });
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Daueraufträge</h1>
        <button onClick={onNavigateToNew} className="px-4 py-2 text-sm font-medium text-white rounded" style={{ backgroundColor: ACCENT }}>
          + Neuer Dauerauftrag
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">Lädt…</p>
      ) : error ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
          <button onClick={load} className="text-sm px-4 py-2 text-white rounded" style={{ backgroundColor: ACCENT }}>Erneut versuchen</button>
        </Card>
      ) : list.length === 0 ? (
        <EmptyState
          message="Noch keine Daueraufträge. Im Buchungs-Wizard unter „Details“ lässt sich jede Buchung als Dauerauftrag anlegen."
          action={{ label: 'Dauerauftrag anlegen', onClick: onNavigateToNew }}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Beschreibung</th>
                  <th className="text-left px-4 py-3 font-medium">Betrag</th>
                  <th className="text-left px-4 py-3 font-medium">Kategorie</th>
                  <th className="text-left px-4 py-3 font-medium">Frequenz</th>
                  <th className="text-left px-4 py-3 font-medium">Nächste Fälligkeit</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.description}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                      <span style={r.type === 'income' ? { color: ACCENT } : undefined}>
                        {r.type === 'income' ? '+' : '−'} {formatEuro(r.amount)}
                      </span>
                      {!!r.taxAmount && (
                        <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                          davon {r.type === 'income' ? 'USt' : 'VSt'} {formatEuro(r.taxAmount)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.category}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {FREQUENCY_LABELS[r.frequency]}
                      {r.endDate && <span className="block text-[11px] text-gray-400 dark:text-gray-500">bis {formatDate(r.endDate)}</span>}
                    </td>
                    <td className={`px-4 py-3 ${r.nextDue <= today && r.isActive ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                      {formatDate(r.nextDue)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 ${r.isActive ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                        {r.isActive ? 'Aktiv' : 'Pausiert'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => toggle(r)}
                          className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
                          {r.isActive ? 'Pausieren' : 'Aktivieren'}
                        </button>
                        {deleteConfirm === r.id ? (
                          <>
                            <button onClick={() => run(async () => { await storage.deleteRecurring(r.id); setDeleteConfirm(null); })}
                              className="text-xs px-2 py-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded">Ja</button>
                            <button onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">Nein</button>
                          </>
                        ) : (
                          <button onClick={() => setDeleteConfirm(r.id)} aria-label="Dauerauftrag löschen"
                            className="p-1 text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
