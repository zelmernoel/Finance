import { useState } from 'react';
import { parseAmount } from '../lib/money';
import { useNavigate } from 'react-router-dom';
import type { Settings } from '../types';
import { useBudget } from '../context/BudgetContext';
import { ACCENT, formatEuro } from '../utils';
import { ROUTES } from '../routes';
import { ClaudeMark } from './icons';

// Fällt der Schreibvorgang in die Datenbank aus (z. B. weil
// supabase/onboarding.sql noch nicht gelaufen ist), darf der Erstkontakt nicht
// bei jedem Start wiederkommen. Deshalb zusätzlich lokal merken.
const LOCAL_FLAG = 'finance-onboarding-completed';

function localDone(): boolean {
  try { return localStorage.getItem(LOCAL_FLAG) === '1'; } catch { return false; }
}

function markLocalDone(): void {
  try { localStorage.setItem(LOCAL_FLAG, '1'); } catch { /* ignore */ }
}

interface Props {
  settings: Settings;
  onSaveSettings: (s: Partial<Omit<Settings, 'id'>>) => Promise<void>;
}

const inputCls =
  'w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white ' +
  'dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 ' +
  'focus:outline-none focus:border-[color:var(--accent)]';

const STEP_COUNT = 4;

/**
 * Einmaliger Erstkontakt, vier Schritte, jederzeit überspringbar.
 *
 * Nimmt nur den Erstkontakt ab — dieselben Einstellungen bleiben danach über
 * die Einstellungsseite erreichbar und änderbar.
 */
export default function Onboarding({ settings, onSaveSettings }: Props) {
  const navigate = useNavigate();
  const { budgets, activeBudgetId, setDefaultBudgetId } = useBudget();

  const alreadyDone = settings.onboardingCompleted === true || localDone();
  const [dismissed, setDismissed] = useState(alreadyDone);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(settings.name ?? '');
  const [balance, setBalance] = useState(
    settings.startingBalance ? String(settings.startingBalance).replace('.', ',') : '',
  );
  const [mainBudget, setMainBudget] = useState<string | null>(activeBudgetId);

  if (dismissed) return null;

  async function finish(withProfile: boolean) {
    setSaving(true);
    markLocalDone();
    try {
      const patch: Partial<Omit<Settings, 'id'>> = { onboardingCompleted: true };
      if (withProfile) {
        patch.name = name.trim();
        patch.startingBalance = (balance.trim() ? parseAmount(balance) : 0) ?? 0;
      }
      // Erst speichern, dann den Hauptbereich wechseln: onSaveSettings schreibt
      // in den AKTIVEN Bereich — nach dem Wechsel wäre das der falsche.
      await onSaveSettings(patch);
      if (withProfile && mainBudget) setDefaultBudgetId(mainBudget);
    } catch {
      // Der lokale Merker steht bereits — der Erstkontakt kommt nicht wieder.
      // Name und Startsaldo lassen sich in den Einstellungen nachtragen.
    } finally {
      setSaving(false);
      setDismissed(true);
    }
  }

  const parsedBalance = parseAmount(balance) ?? NaN;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Erste Schritte"
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto modal-enter"
      >
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-6">
            {/* Fortschritt */}
            <div className="flex items-center gap-1.5 mb-6" aria-hidden="true">
              {Array.from({ length: STEP_COUNT }, (_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= step ? '' : 'bg-gray-200 dark:bg-gray-600'
                  }`}
                  style={i <= step ? { backgroundColor: ACCENT } : undefined}
                />
              ))}
            </div>

            {step === 0 && (
              <>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Willkommen bei Finance
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Finance hält fest, was rein- und rausgeht, und zeigt dir, wo dein Geld bleibt —
                  getrennt nach Bereichen, mit Sparttöpfen und Auswertungen. Vier kurze Schritte,
                  dann ist es eingerichtet.
                </p>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Profil & Startsaldo
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                  Beides lässt sich später jederzeit in den Einstellungen ändern.
                </p>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="ob-name" className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                      Name
                    </label>
                    <input
                      id="ob-name" type="text" value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="z. B. Max"
                      className={inputCls}
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Wird im Dashboard als Begrüßung angezeigt.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="ob-balance" className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                      Startsaldo (€)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">€</span>
                      <input
                        id="ob-balance" type="text" inputMode="decimal" value={balance}
                        onChange={e => setBalance(e.target.value)}
                        placeholder="0,00"
                        className={`${inputCls} pl-7`}
                      />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Dein Kontostand vor der ersten erfassten Buchung
                      {!isNaN(parsedBalance) && balance.trim() ? ` — ${formatEuro(parsedBalance)}` : ''}.
                    </p>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Hauptbereich
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                  Bereiche trennen Privates von allem anderen. Der Hauptbereich wird beim Öffnen
                  der App angezeigt. Weitere legst du später unter „Bereiche" an.
                </p>
                <div className="space-y-2">
                  {budgets.map(b => {
                    const selected = mainBudget === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setMainBudget(b.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                          selected
                            ? 'border-transparent ring-2'
                            : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                        style={selected ? { boxShadow: `0 0 0 2px ${ACCENT}` } : undefined}
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{b.name}</span>
                          <span className="block text-xs text-gray-400 dark:text-gray-500">
                            {b.type === 'business' ? 'Firma' : 'Privat'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {budgets.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Der erste Bereich wird gerade angelegt.
                    </p>
                  )}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Fertig
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Das war's. Eine Sache noch: Finance lässt sich mit Claude verbinden — dann kann
                  Claude deine Zahlen lesen und Buchungen anlegen, aber nichts ändern oder löschen.
                </p>
                <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <ClaudeMark className="w-6 h-6" />
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex-1">
                    Der Knopf <strong className="text-gray-700 dark:text-gray-300">„MCP verbinden"</strong> steht
                    ganz unten in den Einstellungen.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Fußzeile */}
          <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            {step === 0 ? (
              <button
                type="button"
                onClick={() => finish(false)}
                disabled={saving}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40"
              >
                Überspringen
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep(s => s - 1)}
                disabled={saving}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-40"
              >
                Zurück
              </button>
            )}

            <div className="flex-1" />

            {step > 0 && step < STEP_COUNT - 1 && (
              <button
                type="button"
                onClick={() => finish(false)}
                disabled={saving}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40"
              >
                Überspringen
              </button>
            )}

            {step < STEP_COUNT - 1 ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                className="px-4 py-2 text-sm font-semibold text-white rounded"
                style={{ backgroundColor: ACCENT }}
              >
                Weiter
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => { await finish(true); navigate(ROUTES.settings); }}
                  disabled={saving}
                  className="px-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap"
                >
                  Zu den Einstellungen
                </button>
                <button
                  type="button"
                  onClick={() => finish(true)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {saving ? 'Speichern…' : 'Los geht’s'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
