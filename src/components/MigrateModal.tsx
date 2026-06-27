import { useState } from 'react';
import { ACCENT } from '../utils';

interface Props {
  transactionCount: number;
  onImport: () => Promise<void>;
  onDiscard: () => void;
}

export default function MigrateModal({ transactionCount, onImport, onDiscard }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    setLoading(true);
    try { await onImport(); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6">
        <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mb-4 mx-auto">
          <svg className="w-5 h-5" style={{ color: ACCENT }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 text-center mb-2">
          Lokale Daten übertragen?
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
          Du hast{' '}
          <strong>{transactionCount} Transaktion{transactionCount !== 1 ? 'en' : ''}</strong>{' '}
          im Gast-Modus gespeichert. Möchtest du diese in deinen Account importieren?
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleImport}
            disabled={loading}
            className="flex-1 py-2.5 text-sm font-semibold text-white rounded disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            {loading ? 'Importieren…' : 'Ja, importieren'}
          </button>
          <button
            onClick={onDiscard}
            disabled={loading}
            className="flex-1 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Verwerfen
          </button>
        </div>
      </div>
    </div>
  );
}
