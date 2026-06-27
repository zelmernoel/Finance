import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageAdapter } from '../lib/storage';
import type { Transaction, Frequency } from '../types';

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, n: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

export function calcNextDue(current: string, frequency: Frequency): string {
  switch (frequency) {
    case 'daily':   return addDays(current, 1);
    case 'weekly':  return addDays(current, 7);
    case 'monthly': return addMonths(current, 1);
    case 'yearly':  return addYears(current, 1);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseRecurringResult {
  processedCount: number;
  processing: boolean;
}

/**
 * On mount (when storage becomes available): auto-executes all overdue
 * recurring transactions. Returns how many were booked.
 */
export function useRecurringTransactions(
  storage: StorageAdapter | null,
  onNewTransactions: (txs: Transaction[]) => void,
): UseRecurringResult {
  const [processedCount, setProcessedCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const ranRef = useRef(false);

  const process = useCallback(async () => {
    if (!storage || ranRef.current) return;
    ranRef.current = true;
    setProcessing(true);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const recurring = await storage.getRecurring();
      const due = recurring.filter(r => r.isActive && r.nextDue <= today);
      if (due.length === 0) return;

      const created: Transaction[] = [];

      for (const r of due) {
        // Book the transaction
        const tx: Transaction = {
          id: crypto.randomUUID(),
          date: today,
          type: r.type,
          amount: r.amount,
          category: r.category,
          description: r.description,
          note: r.note ?? '',
        };
        const saved = await storage.addTransaction(tx);
        created.push(saved);

        // Calculate next due
        const nextDue = calcNextDue(r.nextDue, r.frequency);
        const expired = r.endDate ? nextDue > r.endDate : false;
        await storage.updateRecurring(r.id, {
          nextDue,
          lastExecuted: today,
          isActive: !expired,
        });
      }

      if (created.length > 0) {
        onNewTransactions(created);
        setProcessedCount(created.length);
      }
    } catch (e) {
      console.error('Fehler beim Verarbeiten von Daueraufträgen:', e);
    } finally {
      setProcessing(false);
    }
  }, [storage, onNewTransactions]);

  useEffect(() => {
    ranRef.current = false; // reset when storage changes (budget switch)
    if (storage) process();
  }, [storage, process]);

  return { processedCount, processing };
}
