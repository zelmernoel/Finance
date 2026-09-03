import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Setzt die Scrollposition bei jedem Routenwechsel zurück.
 *
 * Nur beim Pfadwechsel, nicht bei reinen Query-Änderungen: die
 * Transaktionsliste schreibt ihren Suchbegriff laufend in die URL, dort würde
 * ein Sprung nach oben mitten im Tippen stören.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
}
