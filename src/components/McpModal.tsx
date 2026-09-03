import { useEffect, useState, type ReactNode } from 'react';
import { ACCENT } from '../utils';
import { Check, ClaudeMark, Copy, X } from './icons';

export const MCP_SERVER_NAME = 'Finance';
export const MCP_SERVER_URL = 'https://financenoel.vercel.app/mcp';

interface Props {
  onClose: () => void;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard-API kann fehlen (unsicherer Kontext) — dann bleibt Markieren.
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100">
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          title="In Zwischenablage kopieren"
          aria-label={`${label} kopieren`}
          className={`flex-shrink-0 p-2.5 border rounded transition-colors ${
            copied
              ? 'border-transparent text-white'
              : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
          style={copied ? { backgroundColor: ACCENT } : undefined}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white mt-0.5"
        style={{ backgroundColor: ACCENT }}
      >
        {n}
      </span>
      <span className="text-sm text-gray-600 dark:text-gray-300">{children}</span>
    </li>
  );
}

/**
 * Anleitung, wie der Finance-Connector in Claude eingerichtet wird.
 *
 * Auf Mobil ein Bottom-Sheet über die volle Höhe, ab lg ein zentriertes Modal.
 * Schließen per X, Escape und Klick auf den Hintergrund.
 */
export default function McpModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    // Hintergrund nicht mitscrollen lassen, solange das Sheet offen ist.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-modal-title"
        className="fixed z-50 inset-x-0 bottom-0 top-0 lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-lg"
      >
        <div className="h-full lg:h-auto lg:max-h-[85vh] bg-white dark:bg-gray-800 lg:rounded-xl shadow-2xl flex flex-col overflow-hidden sheet-enter lg:modal-enter">
          {/* Kopf */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
            <ClaudeMark className="w-6 h-6" />
            <h2 id="mcp-modal-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1">
              Finance mit Claude verbinden
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="p-1.5 -mr-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Inhalt */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Über einen Connector kann Claude auf dein Konto zugreifen:{' '}
              <strong className="text-gray-700 dark:text-gray-300">alle Daten lesen</strong> sowie{' '}
              <strong className="text-gray-700 dark:text-gray-300">Transaktionen, Notizen und
              Sparttöpfe anlegen</strong>. Ändern oder löschen kann Claude nichts — das ist in der
              Datenbank gesperrt, nicht bloss in der Oberfläche.
            </p>

            <div className="space-y-4">
              <CopyRow label="Name" value={MCP_SERVER_NAME} />
              <CopyRow label="Server-URL" value={MCP_SERVER_URL} />
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
                Einrichtung
              </p>
              <ol className="space-y-3">
                <Step n={1}>
                  In Claude:{' '}
                  <strong className="text-gray-700 dark:text-gray-300">
                    Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen
                  </strong>
                </Step>
                <Step n={2}>Name und Server-URL von oben einfügen</Step>
                <Step n={3}>
                  Bei „OAuth-Client" die Option{' '}
                  <strong className="text-gray-700 dark:text-gray-300">
                    „Keine Client-ID – automatisch eine registrieren"
                  </strong>{' '}
                  wählen
                </Step>
                <Step n={4}>Mit dem eigenen Finance-Konto anmelden und den Zugriff bestätigen</Step>
              </ol>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
                Verbindung testen
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Frag Claude anschliessend etwas, das nur aus deinen Daten kommen kann — zum Beispiel
                „Wie viel habe ich diesen Monat ausgegeben?". Kommt eine Zahl zurück, steht die
                Verbindung. Jeder Zugriff taucht danach im{' '}
                <strong className="text-gray-700 dark:text-gray-300">KI-Protokoll</strong> auf.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
