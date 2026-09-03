import { supabase } from './supabase';
import type { ActivityLogEntry, ActivityActor } from '../types';

// ── Änderungsprotokoll (activity_log) ─────────────────────────────────────────
// Nur lesend. Die Tabelle ist append-only: es gibt in der Datenbank weder eine
// UPDATE- noch eine DELETE-Policy, auch nicht für die App.
//
// Geschrieben wird sie aus zwei Quellen:
//   * Trigger log_activity() bei jeder Änderung an transactions,
//     transaction_notes und savings_pots — egal ob App oder Claude
//   * MCP-Server bei jedem Tool-Aufruf (action = 'read')

function rowToEntry(row: Record<string, unknown>): ActivityLogEntry {
  return {
    id:           String(row.id),
    budgetId:     row.budget_id != null ? String(row.budget_id) : null,
    createdAt:    String(row.created_at ?? ''),
    actor:        row.actor === 'mcp' ? 'mcp' : 'app',
    clientLabel:  row.client_label != null ? String(row.client_label) : undefined,
    entity:       String(row.entity ?? ''),
    entityId:     row.entity_id != null ? String(row.entity_id) : undefined,
    action:       (row.action ?? 'read') as ActivityLogEntry['action'],
    tool:         row.tool != null ? String(row.tool) : undefined,
    status:       row.status === 'error' ? 'error' : 'ok',
    errorMessage: row.error_message != null ? String(row.error_message) : undefined,
  };
}

/** Die jüngsten Protokolleinträge des angemeldeten Nutzers. */
export async function fetchActivityLog(
  limit = 50,
  actor?: ActivityActor,
): Promise<ActivityLogEntry[]> {
  let q = supabase
    .from('activity_log')
    .select('id, budget_id, created_at, actor, client_label, entity, entity_id, action, tool, status, error_message');
  if (actor) q = q.eq('actor', actor);

  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[Supabase Error]', error.message, error); throw new Error(error.message); }
  return (data ?? []).map(r => rowToEntry(r as Record<string, unknown>));
}

// ── Darstellung ───────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<string, string> = {
  transactions:      'Transaktion',
  transaction_notes: 'Notiz',
  savings_pots:      'Spartopf',
  read:              'Abfrage',
};

const ACTION_LABELS: Record<ActivityLogEntry['action'], string> = {
  insert: 'angelegt',
  update: 'geändert',
  delete: 'gelöscht',
  read:   'gelesen',
};

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

export function actionLabel(action: ActivityLogEntry['action']): string {
  return ACTION_LABELS[action] ?? action;
}

/** Eine Zeile Klartext: was ist passiert. */
export function describeEntry(e: ActivityLogEntry): string {
  if (e.status === 'error') {
    return e.errorMessage ?? 'Fehlgeschlagen.';
  }
  if (e.action === 'read') {
    return e.tool ? `Abfrage über ${e.tool}` : 'Abfrage';
  }
  return `${entityLabel(e.entity)} ${actionLabel(e.action)}`;
}

/** Zeitpunkt eines Eintrags, deutsch formatiert. */
export function formatLogTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Nur bei Transaktionen lässt sich sinnvoll auf die Buchung springen. */
export function linksToTransaction(e: ActivityLogEntry): boolean {
  return e.entity === 'transactions' && e.action !== 'delete' && Boolean(e.entityId);
}
