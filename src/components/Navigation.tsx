import { useRef, useState } from 'react';
import type { Tab } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { ACCENT } from '../utils';

interface NavigationProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard',    label: 'Dashboard' },
  { id: 'transactions', label: 'Transaktionen' },
  { id: 'new',          label: '+ Neue Transaktion' },
  { id: 'analysis',     label: 'Auswertungen' },
  { id: 'recurring',    label: 'Daueraufträge' },
  { id: 'budgets',      label: 'Budgets' },
  { id: 'settings',     label: 'Einstellungen' },
];

export default function Navigation({ activeTab, onTabChange }: NavigationProps) {
  const { user, signOut } = useAuth();
  const { budgets, activeBudget, setActiveBudgetId } = useBudget();
  const [signingOut, setSigningOut]   = useState(false);
  const [dropdownOpen, setDropdown]   = useState(false);
  const dropdownRef                   = useRef<HTMLDivElement>(null);

  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  }

  return (
    <nav className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="max-w-screen-xl mx-auto px-6">
        <div className="flex items-center gap-0">
          {/* Logo */}
          <div className="flex items-center gap-2 mr-6 py-4 flex-shrink-0">
            <img src="/logo.png" alt="FinanzTracker" className="w-6 h-6 object-contain" />
            <span className="font-semibold text-gray-900 text-sm tracking-tight">Finance</span>
          </div>

          {/* Budget switcher */}
          {budgets.length > 0 && (
            <div className="relative mr-4 flex-shrink-0" ref={dropdownRef}>
              <button
                onClick={() => setDropdown(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: activeBudget?.color ?? ACCENT }}
                />
                <span className="max-w-[100px] truncate font-medium text-gray-700">
                  {activeBudget?.name ?? '–'}
                </span>
                <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[160px] py-1">
                  {budgets.map(b => (
                    <button
                      key={b.id}
                      onClick={() => { setActiveBudgetId(b.id); setDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 ${
                        activeBudget?.id === b.id ? 'font-semibold' : ''
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                      <span className="truncate">{b.name}</span>
                      {activeBudget?.id === b.id && <span className="ml-auto text-gray-400">✓</span>}
                    </button>
                  ))}
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={() => { onTabChange('budgets'); setDropdown(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50"
                    >
                      Budgets verwalten →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-0 flex-1 overflow-x-auto scrollbar-hide">
            {TABS.map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { onTabChange(t.id); setDropdown(false); }}
                  className={`px-3 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-[#4A6FA5] text-[#4A6FA5]'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* User + Logout */}
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            {user && (
              <span className="text-xs text-gray-400 hidden lg:block truncate max-w-[140px]" title={user.email ?? ''}>
                {user.email}
              </span>
            )}
            {user ? (
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                {signingOut ? '…' : 'Abmelden'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
