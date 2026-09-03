import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from './icons';

interface AccordionSectionProps {
  title: string;
  /** Einzeiliger Zusatz unter dem Titel, optional. */
  subtitle?: string;
  /** Optionales Icon links vom Titel. */
  icon?: ReactNode;
  /** Startzustand. Vorgabe: zu. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Eine aufklappbare Sektion.
 *
 * Jede Sektion hält ihren eigenen Zustand — mehrere dürfen gleichzeitig offen
 * sein. Der Kopf ist ein echter <button> mit aria-expanded/aria-controls, damit
 * Tastatur und Screenreader das Verhalten mitbekommen.
 */
export function AccordionSection({
  title, subtitle, icon, defaultOpen = false, children,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 py-4 text-left group"
      >
        {icon && (
          <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{icon}</span>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
          {subtitle && (
            <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronRight
          className={`w-4 h-4 flex-shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>

      {open && (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="pb-5 slide-in-up">
          {children}
        </div>
      )}
    </div>
  );
}

interface AccordionLinkProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClick: () => void;
}

/**
 * Sieht aus wie eine Accordion-Zeile, klappt aber nicht auf, sondern
 * navigiert. Der Chevron bleibt deshalb ungedreht stehen.
 */
export function AccordionLink({ title, subtitle, icon, onClick }: AccordionLinkProps) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-3 py-4 text-left group"
      >
        {icon && (
          <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{icon}</span>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
          {subtitle && (
            <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400" />
      </button>
    </div>
  );
}
