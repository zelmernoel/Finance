// ── Icons ─────────────────────────────────────────────────────────────────────
// Inline-SVG im Stil der übrigen Icons im Projekt (24er-Viewbox, currentColor,
// strokeWidth 1.5–2). Bewusst keine Icon-Bibliothek: das Projekt zeichnet seine
// Icons durchgängig selbst, und eine neue Abhängigkeit war ausgeschlossen.
// Die Formen folgen den gleichnamigen lucide-Icons.

interface IconProps {
  className?: string;
}

/** lucide: chevron-right */
export function ChevronRight({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** lucide: arrow-left */
export function ArrowLeft({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12H5m0 0l7 7m-7-7l7-7" />
    </svg>
  );
}

/** lucide: download */
export function Download({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

/** lucide: x */
export function X({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/** lucide: check */
export function Check({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** lucide: copy */
export function Copy({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

/**
 * Claude-Symbol für den „MCP verbinden"-Button.
 *
 * Bewusst als <img> auf das gelieferte Asset (public/claude-symbol.webp,
 * transparenter Hintergrund) statt als nachgezeichnetes SVG — ein Markenzeichen
 * gehört original eingebunden, nicht rekonstruiert. Es behält seine eigene
 * Farbe und folgt nicht currentColor.
 */
export function ClaudeMark({ className = 'w-4 h-4' }: IconProps) {
  return (
    <img
      src="/claude-symbol.webp"
      alt=""
      aria-hidden="true"
      className={`${className} object-contain shrink-0`}
    />
  );
}
