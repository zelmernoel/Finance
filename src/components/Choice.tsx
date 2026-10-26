import type { ReactNode } from 'react';
import { ACCENT } from '../utils';

// ── Antipp-Auswahl statt Dropdowns ────────────────────────────────────────────
// Zwei Bausteine für Auswahlen, die auf dem Handy mit einem Tipp erledigt sind:
//   ChoiceChips  — kleine, gleich breite Segmente (z. B. Privat | Firma)
//   ChoiceTile   — große Kachel mit Titel und Erklärung (z. B. im Assistenten)
// Gleicher Look wie der Buchungs-Wizard: aktiv = Akzentfarbe, sonst Rahmen.

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

export function ChoiceChips<T extends string>({
  options, value, onChange, label, size = 'md',
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Für Screenreader: wofür ist diese Auswahl? */
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label}
      className="flex rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex-1 font-medium transition-colors ${size === 'sm' ? 'py-1.5 text-xs' : 'py-2.5 text-sm min-h-[44px]'} ${active ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            style={active ? { backgroundColor: ACCENT } : undefined}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChoiceTile({
  active, onClick, title, subtitle, dot, aside, children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  /** Farbpunkt vor dem Titel (z. B. Bereichsfarbe). */
  dot?: string;
  /** Rechts ausgerichtet, z. B. ein Betrag. */
  aside?: string;
  children?: ReactNode;
}) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick}
      className={`w-full text-left px-3.5 py-3 rounded border min-h-[56px] transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
      style={active ? { backgroundColor: ACCENT } : undefined}>
      <span className="flex items-center gap-2">
        {dot && <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${active ? 'ring-2 ring-white/70' : ''}`} style={{ backgroundColor: dot }} />}
        <span className="text-sm font-medium truncate flex-1">{title}</span>
        {aside && <span className={`text-sm tabular-nums flex-shrink-0 ${active ? 'text-white/90' : 'text-gray-500 dark:text-gray-400'}`}>{aside}</span>}
      </span>
      {subtitle && (
        <span className={`block text-xs mt-1 leading-snug ${active ? 'text-white/85' : 'text-gray-500 dark:text-gray-400'}`}>
          {subtitle}
        </span>
      )}
      {children}
    </button>
  );
}
