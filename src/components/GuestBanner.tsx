import { Link } from 'react-router-dom';

export default function GuestBanner() {
  return (
    <div className="w-full bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-6 py-2.5">
      <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-4">
        <p className="text-sm text-amber-800 dark:text-amber-300">
          <span className="font-medium">👤 Gast-Modus</span>
          {' '}— Deine Daten werden nur auf diesem Gerät gespeichert.
        </p>
        <div className="flex items-center gap-4 whitespace-nowrap">
          <Link
            to="/login"
            className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 hover:underline underline-offset-2 transition-colors"
          >
            Anmelden
          </Link>
          <Link
            to="/signup"
            className="text-xs font-semibold text-amber-900 dark:text-amber-300 underline underline-offset-2 hover:opacity-80"
          >
            Konto erstellen →
          </Link>
        </div>
      </div>
    </div>
  );
}
