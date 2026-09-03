import { supabase } from './supabase';
import type { TransactionNote } from '../types';

// ── Notizen zu einer Transaktion (transaction_notes) ──────────────────────────
// Nur anhängen und lesen. Die Tabelle hat in der Datenbank weder eine UPDATE-
// noch eine DELETE-Policy — Notizen sind unveränderlich und verschwinden nur
// mit ihrer Transaktion (FK-CASCADE).
//
// Nur für eingeloggte Nutzer: im Gast-Modus liegen die Daten in localStorage,
// dort gibt es diese Tabelle nicht. Transaction.note bleibt davon unberührt.

function rowToNote(row: Record<string, unknown>): TransactionNote {
  return {
    id:            String(row.id),
    transactionId: String(row.transaction_id ?? ''),
    createdAt:     String(row.created_at ?? ''),
    author:        row.author === 'mcp' ? 'mcp' : 'app',
    body:          String(row.body ?? ''),
  };
}

/** Alle Notizen zu einer Transaktion, chronologisch aufsteigend. */
export async function fetchNotes(transactionId: string): Promise<TransactionNote[]> {
  const { data, error } = await supabase
    .from('transaction_notes')
    .select('id, transaction_id, created_at, author, body')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });
  if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
  return (data ?? []).map(r => rowToNote(r as Record<string, unknown>));
}

/** Notizanzahl für mehrere Transaktionen auf einmal — für die Liste. */
export async function fetchNoteCounts(
  transactionIds: string[],
): Promise<Record<string, number>> {
  if (!transactionIds.length) return {};
  const { data, error } = await supabase
    .from('transaction_notes')
    .select('transaction_id')
    .in('transaction_id', transactionIds);
  if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = String(row.transaction_id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** Hängt eine Notiz an. author = 'app', weil sie aus der Oberfläche kommt. */
export async function addNote(
  userId: string,
  transactionId: string,
  body: string,
): Promise<TransactionNote> {
  const text = body.trim();
  if (!text) throw new Error('Die Notiz darf nicht leer sein.');

  const { data, error } = await supabase
    .from('transaction_notes')
    .insert({
      id: crypto.randomUUID(),
      transaction_id: transactionId,
      user_id: userId,
      author: 'app',
      body: text,
    })
    .select()
    .single();
  if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
  return rowToNote(data as Record<string, unknown>);
}

/** Zeitpunkt einer Notiz, deutsch formatiert. */
export function formatNoteTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
