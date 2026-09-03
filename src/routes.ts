import type { Tab } from './types';

// ── Routen ────────────────────────────────────────────────────────────────────
// Eine Stelle für alle Pfade, damit Navigation, MainApp und Deep-Links nicht
// auseinanderlaufen. Die Tab-IDs bleiben erhalten: einzelne Seiten reichen sie
// noch als Callback-Argument herum (z. B. NewTransaction.onSuccess).

export const ROUTES = {
  dashboard:    '/',
  transactions: '/verlauf',
  new:          '/neu',
  analysis:     '/auswertung',
  recurring:    '/dauereintraege',
  savings:      '/sparen',
  budgets:      '/bereiche',
  settings:     '/einstellungen',
  aiLog:        '/einstellungen/ki-protokoll',
} as const;

export type RoutePath = typeof ROUTES[keyof typeof ROUTES];

/** Tab-ID → Pfad. Für Komponenten, die noch in Tabs denken. */
export const TAB_TO_PATH: Record<Tab, string> = {
  dashboard:    ROUTES.dashboard,
  transactions: ROUTES.transactions,
  new:          ROUTES.new,
  analysis:     ROUTES.analysis,
  recurring:    ROUTES.recurring,
  savings:      ROUTES.savings,
  budgets:      ROUTES.budgets,
  settings:     ROUTES.settings,
};

export function pathForTab(tab: Tab): string {
  return TAB_TO_PATH[tab] ?? ROUTES.dashboard;
}
