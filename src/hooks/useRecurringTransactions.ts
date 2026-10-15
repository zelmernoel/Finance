import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageAdapter } from '../lib/storage';
import type { Transaction, Frequency } from '../types';
import { addDays, addMonths, addYears, todayISO } from '../utils';

// ── Nächste Fälligkeit ────────────────────────────────────────────────────────
//
// Die Datumsarithmetik liegt in src/utils.ts, damit sie im Frontend nur einmal
// existiert. Sie rechnet auf UTC-Mitternacht und klemmt den Monatsüberlauf —
// beides ist hier zwingend: eine Fälligkeit, die stehenbleibt, lässt die App
// bei jedem Start erneut buchen. Siehe src/utils.dates.test.ts.

/**
 * anchorDay = Monatstag des Startdatums. Hält einen Auftrag vom 31. auf dem
 * Monatsletzten statt ihn nach dem Februar dauerhaft auf den 28. zu setzen.
 */
export function calcNextDue(current: string, frequency: Frequency, anchorDay?: number): string {
  switch (frequency) {
    case 'daily':   return addDays(current, 1);
    case 'weekly':  return addDays(current, 7);
    case 'monthly': return addMonths(current, 1, anchorDay);
    case 'yearly':  return addYears(current, 1, anchorDay);
  }
}

/** Monatstag aus "YYYY-MM-DD" — der Anker für calcNextDue. */
export function anchorDayOf(iso: string): number {
  return Number(iso.slice(8, 10)) || 1;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseRecurringResult {
  processedCount: number;
  processing: boolean;
}

/**
 * Sicherheitsgrenze je Dauerauftrag und App-Start. Ein täglicher Auftrag, der
 * ein Jahr nicht lief, würde sonst 365 Buchungen auf einmal erzeugen.
 */
const MAX_CATCH_UP = 60;

/**
 * On mount (when storage becomes available): auto-executes all overdue
 * recurring transactions. Returns how many were booked.
 *
 * Jede überfällige Fälligkeit wird einzeln gebucht, datiert auf ihren
 * Fälligkeitstag — nicht auf "heute". Vorher wurde pro App-Start nur EINE
 * Ausführung nachgeholt: wer die App zwei Monate nicht öffnete, bekam einen
 * Monat Abo geschenkt, und das Datum stimmte auch nicht.
 */
export function useRecurringTransactions(
  storage: StorageAdapter | null,
  onNewTransactions: (txs: Transaction[]) => void,
): UseRecurringResult {
  const [processedCount, setProcessedCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const ranRef = useRef(false);
  // Läuft gerade ein Durchlauf, startet kein zweiter — sonst buchen zwei
  // Läufe (z. B. nach einem Budget-Wechsel mitten im Nachholen) dieselben
  // Termine doppelt.
  const inFlightRef = useRef(false);

  const process = useCallback(async () => {
    if (!storage || ranRef.current || inFlightRef.current) return;
    ranRef.current = true;
    inFlightRef.current = true;
    setProcessing(true);

    try {
      const today = todayISO();
      const recurring = await storage.getRecurring();
      const due = recurring.filter(r => r.isActive && r.nextDue <= today);
      if (due.length === 0) return;

      const created: Transaction[] = [];

      for (const r of due) {
        let nextDue = r.nextDue;
        let lastBooked = r.lastExecuted;
        let active = true;
        let runs = 0;
        const anchorDay = anchorDayOf(r.startDate);

        while (active && nextDue <= today && runs < MAX_CATCH_UP) {
          // Enddatum VOR dem Buchen prüfen — ein abgelaufener Auftrag bucht nichts mehr.
          if (r.endDate && nextDue > r.endDate) { active = false; break; }
          lastBooked = nextDue;
          const saved = await storage.addTransaction({
            id: crypto.randomUUID(),
            date: nextDue,
            type: r.type,
            amount: r.amount,
            taxAmount: r.taxAmount ?? 0,
            category: r.category,
            description: r.description,
            note: r.note ?? '',
          });
          created.push(saved);
          runs++;

          nextDue = calcNextDue(nextDue, r.frequency, anchorDay);
          if (r.endDate && nextDue > r.endDate) active = false;
        }

        await storage.updateRecurring(r.id, {
          nextDue,
          lastExecuted: lastBooked,
          isActive: active,
        });
      }

      if (created.length > 0) {
        onNewTransactions(created);
        setProcessedCount(created.length);
      }
    } catch (e) {
      console.error('Fehler beim Verarbeiten von Daueraufträgen:', e);
    } finally {
      inFlightRef.current = false;
      setProcessing(false);
    }
  }, [storage, onNewTransactions]);

  useEffect(() => {
    ranRef.current = false; // reset when storage changes (budget switch)
    if (storage) process();
  }, [storage, process]);

  return { processedCount, processing };
}
