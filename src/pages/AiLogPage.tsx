import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { ArrowLeft } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../MainApp';
import { ROUTES } from '../routes';
import { ACCENT } from '../utils';
import type { ActivityLogEntry, ActivityActor } from '../types';
import {
  fetchActivityLog, formatLogTime, describeEntry, entityLabel, linksToTransaction,
} from '../lib/activityLog';

const PAGE_SIZE = 50;

/**
 * KI-Protokoll als eigene Seite.
 *
 * Lädt seitenweise nach statt alles auf einmal: bei vielen Einträgen bricht die
 * Liste sonst ein. Datenquelle und Darstellung entsprechen der bisherigen
 * Sektion in den Einstellungen.
 */
export default function AiLogPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openTransaction } = useAppContext();

  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [filter, setFilter]   = useState<'all' | ActivityActor>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const load = useCallback(async (reset: boolean) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const wanted = reset ? PAGE_SIZE : entries.length + PAGE_SIZE;
      const rows = await fetchActivityLog(wanted, filter === 'all' ? undefined : filter);
      setEntries(rows);
      // Weniger zurück als angefragt → es gibt nichts mehr nachzuladen.
      setExhausted(rows.length < wanted);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Protokoll konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [user, filter, entries.length]);

  // Beim ersten Aufbau und bei jedem Filterwechsel von vorn.
  useEffect(() => {
    if (!user) return;
    let abgebrochen = false;
    setLoading(true);
    setError(null);
    fetchActivityLog(PAGE_SIZE, filter === 'all' ? undefined : filter)
      .then(rows => {
        if (abgebrochen) return;
        setEntries(rows);
        setExhausted(rows.length < PAGE_SIZE);
      })
      .catch(e => {
        if (!abgebrochen) setError(e instanceof Error ? e.message : 'Protokoll konnte nicht geladen werden.');
      })
      .finally(() => { if (!abgebrochen) setLoading(false); });
    return () => { abgebrochen = true; };
  }, [user, filter]);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Kopf mit Zurück-Pfeil */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(ROUTES.settings)}
          aria-label="Zurück zu den Einstellungen"
          className="p-2 -ml-2 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">KI-Protokoll</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Jede Änderung — auch die aus der App, nicht nur die von Claude.
          </p>
        </div>
      </div>

      {!user ? (
        <Card className="p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Das Protokoll setzt ein Konto voraus. Im Gast-Modus liegen die Daten nur auf diesem Gerät
            und es wird nichts protokolliert.
          </p>
        </Card>
      ) : (
        <Card className="p-6">
          {/* Filter */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
              {([
                { key: 'all' as const, label: 'Alle' },
                { key: 'mcp' as const, label: 'Nur KI' },
                { key: 'app' as const, label: 'Nur App' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === key
                      ? 'text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  style={filter === key ? { backgroundColor: ACCENT } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {entries.length} Eintr{entries.length === 1 ? 'ag' : 'äge'} geladen
            </p>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

          {!error && !loading && entries.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">Noch nichts protokolliert.</p>
          )}

          {entries.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map(e => (
                <li key={e.id} className="py-2.5 flex items-start gap-3">
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      e.status === 'error' ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                    title={e.status === 'error' ? 'Fehlgeschlagen' : 'Erfolgreich'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-gray-100 dark:bg-gray-700"
                        style={e.actor === 'mcp' ? { color: ACCENT } : undefined}
                        title={e.actor === 'mcp' ? (e.clientLabel ?? 'Über den KI-Zugang') : 'In der App'}
                      >
                        {e.actor === 'mcp' ? 'KI' : 'App'}
                      </span>
                      <span className="font-medium">{entityLabel(e.entity)}</span>
                      <span className="text-gray-400 dark:text-gray-500">· {formatLogTime(e.createdAt)}</span>
                    </p>
                    <p className={`text-xs mt-0.5 break-words ${
                      e.status === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {describeEntry(e)}
                    </p>
                    {linksToTransaction(e) && (
                      <button
                        type="button"
                        onClick={() => openTransaction(e.entityId!)}
                        className="text-xs mt-0.5 hover:underline underline-offset-2"
                        style={{ color: ACCENT }}
                      >
                        Buchung anzeigen →
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Nachladen */}
          <div className="pt-4 flex items-center justify-center">
            {loading ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Lädt…</p>
            ) : exhausted ? (
              entries.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500">Alle Einträge geladen.</p>
              )
            ) : (
              <button
                type="button"
                onClick={() => load(false)}
                className="px-4 py-2 text-xs font-medium rounded border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Weitere {PAGE_SIZE} laden
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
