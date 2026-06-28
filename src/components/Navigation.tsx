import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Tab } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBudget } from '../context/BudgetContext';
import { ACCENT } from '../utils';

interface NavigationProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

// Regular nav tabs for desktop (excludes 'new', 'settings', 'budgets' — rendered separately)
const NAV_TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard',    label: 'Dashboard' },
  { id: 'transactions', label: 'Transaktionen' },
  { id: 'analysis',     label: 'Auswertungen' },
  { id: 'recurring',    label: 'Daueraufträge' },
];

// ── Mobile bottom nav tabs ────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function IconTransactions() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function IconAnalysis() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

const MOBILE_TABS = [
  { id: 'dashboard'    as Tab, label: 'Start',           Icon: IconDashboard },
  { id: 'transactions' as Tab, label: 'Verlauf',         Icon: IconTransactions },
  { id: 'new'          as Tab, label: 'Neu',             Icon: IconPlus },
  { id: 'analysis'     as Tab, label: 'Analyse',         Icon: IconAnalysis },
  { id: 'settings'     as Tab, label: 'Mehr',            Icon: IconSettings },
];

export default function Navigation({ activeTab, onTabChange }: NavigationProps) {
  const { user, signOut } = useAuth();
  const { budgets, activeBudget, setActiveBudgetId } = useBudget();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [dropdownOpen, setDropdown] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close "Mehr" sheet when navigating away
  useEffect(() => { setMoreOpen(false); }, [activeTab]);

  // Close budget dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdown(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [dropdownOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  }

  return (
    <>
      {/* ── Desktop Top Nav (hidden on mobile) ───────────────────────────────── */}
      <nav className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-10 hidden lg:block">
        <div className="max-w-screen-xl mx-auto px-6">
          <div className="flex items-center gap-0">
            {/* Logo */}
            <div className="flex items-center gap-2 mr-6 py-4 flex-shrink-0">
              <img src="/logo.png" alt="FinanzTracker" className="w-6 h-6 object-contain" />
              <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm tracking-tight">Finance</span>
            </div>

            {/* Budget switcher */}
            {budgets.length > 0 && (
              <div className="relative mr-4 flex-shrink-0" ref={dropdownRef}>
                <button
                  onClick={() => setDropdown(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: activeBudget?.color ?? ACCENT }} />
                  <span className="max-w-[100px] truncate font-medium">
                    {activeBudget?.name ?? '–'}
                  </span>
                  <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {dropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 min-w-[160px] py-1">
                    {budgets.map(b => (
                      <button
                        key={b.id}
                        onClick={() => { setActiveBudgetId(b.id); setDropdown(false); }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 ${
                          activeBudget?.id === b.id ? 'font-semibold' : ''
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                        <span className="truncate">{b.name}</span>
                        {activeBudget?.id === b.id && <span className="ml-auto text-gray-400">✓</span>}
                      </button>
                    ))}
                    <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                      <button
                        onClick={() => { onTabChange('budgets'); setDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Bereiche verwalten →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Regular nav tabs */}
            <div className="flex gap-0 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
              {NAV_TABS.map((t) => {
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { onTabChange(t.id); setDropdown(false); }}
                    className={`px-2 xl:px-3 py-4 text-xs xl:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      isActive
                        ? 'border-[#4A6FA5] text-[#4A6FA5]'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* "+ Neue Transaktion" — accent pill button */}
            <button
              onClick={() => { onTabChange('new'); setDropdown(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-full transition-opacity hover:opacity-80 flex-shrink-0 mx-3"
              style={{ backgroundColor: ACCENT }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Neue Transaktion
            </button>

            {/* Settings gear icon — right edge */}
            <button
              onClick={() => { onTabChange('settings'); setDropdown(false); }}
              title="Einstellungen"
              className={`p-2 rounded transition-colors flex-shrink-0 ${
                activeTab === 'settings'
                  ? 'text-[#4A6FA5]'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* User + Logout */}
            <div className="flex items-center gap-2 ml-1 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 pl-3">
              {user && (
                <span className="text-xs text-gray-400 dark:text-gray-500 hidden xl:block truncate max-w-[140px]" title={user.email ?? ''}>
                  {user.email}
                </span>
              )}
              {user ? (
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
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

      {/* ── Mobile Bottom Nav (hidden on lg+) ────────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-10 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 lg:hidden">
        <div className="flex items-end justify-around px-1 pt-1 pb-2">
          {MOBILE_TABS.map((t) => {
            if (t.id === 'new') {
              return (
                <button
                  key="new"
                  onClick={() => onTabChange('new')}
                  className="flex flex-col items-center gap-0.5 -mt-5 px-2"
                  aria-label="Neue Transaktion"
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <IconPlus />
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{t.label}</span>
                </button>
              );
            }

            // "Mehr" tab — opens sheet instead of navigating
            if (t.id === 'settings') {
              const moreActive = moreOpen || activeTab === 'settings' || activeTab === 'recurring' || activeTab === 'budgets';
              return (
                <button
                  key="mehr"
                  onClick={() => setMoreOpen(v => !v)}
                  className="flex flex-col items-center gap-0.5 py-1 px-2 min-w-[56px] min-h-[44px] justify-center transition-colors"
                  style={moreActive ? { color: ACCENT } : undefined}
                >
                  <span className={moreActive ? '' : 'text-gray-400 dark:text-gray-500'}>
                    <t.Icon />
                  </span>
                  <span className={`text-[10px] ${moreActive ? '' : 'text-gray-400 dark:text-gray-500'}`}>
                    Mehr
                  </span>
                </button>
              );
            }

            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className="flex flex-col items-center gap-0.5 py-1 px-2 min-w-[56px] min-h-[44px] justify-center transition-colors"
                style={isActive ? { color: ACCENT } : undefined}
              >
                <span className={isActive ? '' : 'text-gray-400 dark:text-gray-500'}>
                  <t.Icon />
                </span>
                <span className={`text-[10px] ${isActive ? '' : 'text-gray-400 dark:text-gray-500'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── "Mehr" sheet (slides up from bottom nav) ─────────────────────────── */}
      {moreOpen && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-20 lg:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div className="sheet-enter fixed bottom-[60px] inset-x-0 z-30 lg:hidden">
            <div className="mx-3 mb-2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {([
                { id: 'recurring' as Tab, label: 'Daueraufträge', desc: 'Wiederkehrende Buchungen verwalten' },
                { id: 'budgets'   as Tab, label: 'Bereiche',       desc: 'Privates & anderes trennen' },
                { id: 'settings'  as Tab, label: 'Einstellungen',  desc: 'Kategorien, Darstellung, Export' },
              ]).map((item, i, arr) => (
                <button
                  key={item.id}
                  onClick={() => { onTabChange(item.id); setMoreOpen(false); }}
                  className={`w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    i < arr.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''
                  } ${activeTab === item.id ? 'bg-gray-50 dark:bg-gray-700/50' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                  {activeTab === item.id && (
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ACCENT }} />
                  )}
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}

              {/* Auth row */}
              <div className="border-t border-gray-100 dark:border-gray-700">
                {user ? (
                  <div className="flex items-center gap-4 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 dark:text-gray-500">Angemeldet als</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user.email}</p>
                    </div>
                    <button
                      onClick={async () => { setMoreOpen(false); setSigningOut(true); try { await signOut(); } finally { setSigningOut(false); } }}
                      disabled={signingOut}
                      className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      {signingOut ? '…' : 'Abmelden'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setMoreOpen(false); navigate('/login'); }}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Anmelden</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Daten in der Cloud sichern & synchronisieren</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
