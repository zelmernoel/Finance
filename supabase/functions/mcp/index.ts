// ============================================================
// Finance — MCP-Server als Supabase Edge Function
//
// Streamable HTTP, stateless, JSON-RPC 2.0 von Hand (kein MCP-SDK).
//
// Sicherheitsmodell:
//   - Es wird NIRGENDS ein service_role-Key verwendet.
//   - Der Server reicht ausschliesslich das Bearer-Token des Nutzers
//     an Supabase durch. Über jede einzelne Operation entscheidet
//     damit RLS in der Datenbank, nicht dieser Code.
//   - Es gibt in diesem Server KEIN .update(), .upsert() und .delete()
//     auf Nutzertabellen. Geschrieben wird ausschliesslich:
//       * transactions      .insert()  (create-transaction, source = 'mcp')
//       * transaction_notes .insert()  (add-note, author = 'mcp')
//       * savings_pots      .insert()  (create-savings-pot)
//       * activity_log      .insert()  (Protokoll, append-only)
//
// verify_jwt = false in config.toml — die Prüfung machen wir selbst
// gegen den JWKS-Endpunkt des Projekts (siehe verifyToken).
// ============================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.107.0';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'npm:jose@5.9.6';

// ── Umgebung ────────────────────────────────────────────────
// SUPABASE_URL und SUPABASE_ANON_KEY werden von der Edge-Runtime
// automatisch gesetzt. SUPABASE_SERVICE_ROLE_KEY wird bewusst nicht gelesen.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Öffentliche Basis-URL dieser Function (für die RFC-9728-Metadaten). */
const MCP_PUBLIC_URL = (
  Deno.env.get('MCP_PUBLIC_URL') ?? `${SUPABASE_URL}/functions/v1/mcp`
).replace(/\/+$/, '');

const AUTH_SERVER = `${SUPABASE_URL}/auth/v1`;
const RESOURCE_METADATA_URL = `${MCP_PUBLIC_URL}/.well-known/oauth-protected-resource`;

const SERVER_NAME = 'finance';
const SERVER_VERSION = '1.2.0';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// ── CORS ────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, mcp-session-id',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

// ── Tokenprüfung gegen JWKS ─────────────────────────────────
// createRemoteJWKSet cached den Schlüsselsatz von sich aus und holt
// ihn nur bei unbekannter kid und frühestens nach cooldownDuration neu.

const JWKS = createRemoteJWKSet(new URL(`${AUTH_SERVER}/.well-known/jwks.json`), {
  cacheMaxAge: 10 * 60 * 1000,
  cooldownDuration: 30 * 1000,
});

interface AuthContext {
  token: string;
  userId: string;
  clientId: string | null;
}

class AuthError extends Error {}

function bearerFrom(req: Request): string | null {
  const raw = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

async function verifyToken(req: Request): Promise<AuthContext> {
  const token = bearerFrom(req);
  if (!token) throw new AuthError('Kein Bearer-Token übermittelt.');

  let payload: Record<string, unknown>;
  try {
    // Prüft Signatur (gegen JWKS), exp/nbf und iss.
    const result = await jwtVerify(token, JWKS, { issuer: AUTH_SERVER });
    payload = result.payload as Record<string, unknown>;
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new AuthError('Token ist abgelaufen.');
    if (e instanceof joseErrors.JWKSNoMatchingKey) {
      throw new AuthError(
        'Kein passender Signaturschlüssel im JWKS. Nutzt das Projekt noch den ' +
        'symmetrischen Legacy-JWT-Secret? Dann müssen in Supabase asymmetrische ' +
        'JWT Signing Keys aktiviert werden.',
      );
    }
    throw new AuthError(`Token ungültig: ${e instanceof Error ? e.message : String(e)}`);
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  if (!userId) throw new AuthError('Token enthält keine Subject-ID (sub).');

  const clientId = typeof payload.client_id === 'string' ? payload.client_id : null;

  return { token, userId, clientId };
}

/**
 * Supabase-Client, der ausschliesslich mit dem Nutzer-Token arbeitet.
 * Kein service_role — RLS greift bei jeder Abfrage.
 */
function clientFor(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ── Formatierung ────────────────────────────────────────────

const EURO = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
});

function formatEuro(n: number): string {
  return EURO.format(n);
}

/** ISO "YYYY-MM-DD" → "DD.MM.YYYY" */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Supabase liefert NUMERIC als String. */
function toNum(v: unknown): number {
  return typeof v === 'string' ? parseFloat(v) : Number(v ?? 0);
}

function money(n: number) {
  return { betrag: Math.round(n * 100) / 100, formatiert: formatEuro(n) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ── Datumslogik ─────────────────────────────────────────────
//
// Zweitimplementierung von getMonthRange()/getCustomMonthRange()
// aus src/utils.ts. Deno kann diese Datei nicht importieren (der
// Supabase-CLI bündelt nur aus supabase/functions/, und src/utils.ts
// zieht Browser-APIs nach), deshalb steht die Rechnung zweimal da.
// Wer hier etwas ändert, muss es dort nachziehen — und umgekehrt.
//
// Gerechnet wird durchgehend in UTC, damit das Ergebnis nicht von
// der Zeitzone des Servers abhängt. Für getMonthRange() ist das
// deckungsgleich mit dem Frontend: die Funktion bekommt Jahr und
// Monat übergeben und rechnet nur Kalendertage, keine Zeitzonen.

function isoUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Zeitraum eines bestimmten Abrechnungsmonats.
 * Entspricht getMonthRange() aus src/utils.ts.
 */
function getMonthRange(year: number, month: number, monthStart = 1): { from: string; to: string } {
  const from = `${year}-${pad2(month)}-${pad2(monthStart)}`;
  const nextStart = new Date(Date.UTC(year, month, monthStart)); // month ist 1-basiert → nächster Monat
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return { from, to: isoUTC(nextStart) };
}

/**
 * Laufender Abrechnungszeitraum.
 * Entspricht getCustomMonthRange() aus src/utils.ts.
 *
 * Verbleibender Unterschied zum Frontend, unvermeidbar: welcher Tag
 * "heute" ist. Das Frontend nimmt den lokalen Tag des Nutzers, hier
 * gibt es nur UTC — die Zeitzone des Nutzers ist dem Server nicht
 * bekannt. In Europe/Berlin fallen die beiden deshalb zwischen
 * 00:00 und 01:00 bzw. 02:00 Ortszeit auseinander: dort ist es nach
 * UTC noch der Vortag. Trifft dieser Moment genau auf den
 * monthStart-Tag, meldet der Server noch den vorherigen Zeitraum.
 *
 * Für monthStart = 1 und zu jeder anderen Tageszeit sind beide
 * deckungsgleich. Wer das vollständig ausschliessen will, müsste
 * from/to explizit an die Tools übergeben, statt sie hier zu raten.
 */
function getCustomMonthRange(monthStart = 1, now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();

  let fromYear = y;
  let fromMonth = m;
  if (d < monthStart) {
    const prev = new Date(Date.UTC(y, m - 2, 1));
    fromYear = prev.getUTCFullYear();
    fromMonth = prev.getUTCMonth() + 1;
  }
  return getMonthRange(fromYear, fromMonth, monthStart);
}

// ── Validierung ─────────────────────────────────────────────

class ToolError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new ToolError(`Pflichtparameter "${key}" fehlt oder ist leer.`);
  }
  return v.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new ToolError(`Parameter "${key}" muss ein Text sein.`);
  return v.trim();
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ToolError(`Parameter "${key}" muss eine Zahl sein.`);
  return n;
}

function validDate(value: string, key: string): string {
  if (!ISO_DATE.test(value)) {
    throw new ToolError(`Parameter "${key}" muss im Format YYYY-MM-DD vorliegen (erhalten: "${value}").`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() + 1 !== m ||
    probe.getUTCDate() !== d
  ) {
    throw new ToolError(`Parameter "${key}" ist kein gültiges Datum ("${value}").`);
  }
  return value;
}

/** Entschärft Freitext für den PostgREST-or()-Filter. */
function safeLikeTerm(s: string): string {
  return s.replace(/["\\]/g, '').replace(/[%_]/g, '');
}

// ── Datenzugriff (nur SELECT ausser den zwei erlaubten Inserts) ──

async function fetchBudgets(sb: SupabaseClient) {
  const { data, error } = await sb
    .from('budgets')
    .select('id, name, type, color, created_at')
    .order('created_at');
  if (error) throw new ToolError(`Bereiche konnten nicht gelesen werden: ${error.message}`);
  return data ?? [];
}

async function requireBudget(sb: SupabaseClient, budgetId: string) {
  const budgets = await fetchBudgets(sb);
  const found = budgets.find((b) => String(b.id) === budgetId);
  if (!found) {
    const list = budgets.map((b) => `${b.name} (${b.id})`).join(', ') || '— keine vorhanden —';
    throw new ToolError(
      `Der Bereich "${budgetId}" existiert nicht oder gehört nicht zu diesem Konto. ` +
      `Gültige Bereiche: ${list}`,
    );
  }
  return found;
}

async function fetchCategories(sb: SupabaseClient, budgetId: string) {
  const { data, error } = await sb
    .from('categories')
    .select('id, name, type, monthly_budget, default_frequency, default_tax_rate, budget_id')
    .eq('budget_id', budgetId)
    .order('type')
    .order('name');
  if (error) throw new ToolError(`Kategorien konnten nicht gelesen werden: ${error.message}`);
  return data ?? [];
}

/** Alle Transaktionen eines Bereichs — Grundlage für Kontostand und Auswertungen. */
async function fetchAllTransactions(sb: SupabaseClient, budgetId: string) {
  const out: Record<string, unknown>[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await sb
      .from('transactions')
      .select('id, date, type, amount, tax_amount, category, description, note, source, created_at')
      .eq('budget_id', budgetId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id') // eindeutige Reihenfolge, sonst kann OFFSET-Paging Zeilen überspringen
      .range(offset, offset + page - 1);
    if (error) throw new ToolError(`Transaktionen konnten nicht gelesen werden: ${error.message}`);
    const rows = data ?? [];
    out.push(...(rows as Record<string, unknown>[]));
    if (rows.length < page) break;
  }
  return out;
}

async function fetchSettings(sb: SupabaseClient, budgetId: string) {
  const { data, error } = await sb
    .from('settings')
    .select('id, budget_id, starting_balance, name, month_start, show_ai_badges, mcp_allow_pot_creation')
    .eq('budget_id', budgetId)
    .maybeSingle();
  if (error) throw new ToolError(`Einstellungen konnten nicht gelesen werden: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/**
 * amount ist immer BRUTTO und zählt zum Kontostand. tax_amount ist die darin
 * enthaltene Steuer (0 = keine); Netto wird abgeleitet, nicht gespeichert.
 */
function mapTx(row: Record<string, unknown>) {
  const amount = toNum(row.amount);
  const tax = toNum(row.tax_amount);
  return {
    id: String(row.id),
    datum: String(row.date),
    datum_formatiert: formatDate(String(row.date)),
    typ: row.type === 'income' ? 'Einnahme' : 'Ausgabe',
    type: String(row.type),
    ...money(amount),
    netto: money(amount - tax),
    steuer: money(tax),
    kategorie: String(row.category ?? ''),
    beschreibung: String(row.description ?? ''),
    notiz: row.note != null ? String(row.note) : '',
    herkunft: row.source === 'mcp' ? 'mcp' : 'app',
    erfasst_am: row.created_at != null ? String(row.created_at) : null,
  };
}

function mapNote(row: Record<string, unknown>) {
  const created = row.created_at != null ? String(row.created_at) : '';
  return {
    id: String(row.id),
    transaction_id: row.transaction_id != null ? String(row.transaction_id) : '',
    text: String(row.body ?? ''),
    herkunft: row.author === 'mcp' ? 'mcp' : 'app',
    erfasst_am: created,
    erfasst_am_formatiert: created ? formatDate(created.slice(0, 10)) : '',
  };
}

// ── activity_log ────────────────────────────────────────────

interface LogInput {
  tool: string;
  params: Record<string, unknown>;
  status: 'ok' | 'error';
  budgetId?: string | null;
  resultSummary?: string | null;
  errorMessage?: string | null;
  affectedId?: string | null;
}

/**
 * Protokolliert einen Tool-Aufruf in activity_log.
 *
 * Abgrenzung zum Trigger: die eigentlichen DATENÄNDERUNGEN schreibt
 * der Trigger log_activity() (action = 'insert'/'update'/'delete'),
 * unabhängig davon, ob App oder Claude sie ausgelöst hat. Hier wird
 * der AUFRUF festgehalten — mit action = 'read', weil aus Sicht des
 * Servers eine Anfrage eingegangen ist. Das ist bewusst auch für die
 * schreibenden Tools so: nur dadurch bleibt ein fehlgeschlagener
 * Aufruf sichtbar, bei dem gar keine Änderung zustande kam und
 * deshalb auch kein Trigger feuerte.
 *
 * Gibt die Fehlermeldung zurück, falls das Protokollieren selbst
 * scheitert — der Aufrufer entscheidet, ob das die Antwort
 * beeinflusst. Wirft nie.
 */
async function writeLog(
  sb: SupabaseClient,
  userId: string,
  input: LogInput,
): Promise<string | null> {
  try {
    const params: Record<string, unknown> = { ...(input.params ?? {}) };
    if (input.resultSummary) params.ergebnis = input.resultSummary;

    const { error } = await sb.from('activity_log').insert({
      user_id: userId,
      budget_id: input.budgetId ?? null,
      actor: 'mcp',
      entity: 'read',
      entity_id: input.affectedId ?? null,
      action: 'read',
      tool: input.tool,
      params,
      status: input.status,
      error_message: input.errorMessage ?? null,
    });
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ── Tool-Katalog ────────────────────────────────────────────

const BUDGET_ID_DESC =
  'ID des Bereichs (Budgets). Pflichtparameter — vorher mit list-budgets ermitteln. Es gibt keine Vorbelegung.';

const TOOLS = [
  {
    name: 'list-budgets',
    description:
      'Listet alle Bereiche (Budgets) des Kontos mit ID, Name und Typ. Ausgangspunkt für alle anderen Tools, ' +
      'da fast jedes eine budget_id benötigt. Den Kontostand eines Bereichs liefert get-summary, nicht dieses Tool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list-categories',
    description:
      'Listet die Kategorien eines Bereichs, getrennt nach Einnahme und Ausgabe, mit Vorbelegungen ' +
      '(steuersatz_vorbelegung: enthaltener Steuersatz, den die App bei dieser Kategorie vorschlägt — ' +
      'bei create-transaction dann als tax_rate übergeben, sofern die Rechnung nichts anderes sagt). ' +
      'Die Kategorienamen aus diesem Tool sind die einzigen zulässigen Werte für den Parameter "category" ' +
      'von create-transaction. Pflichtparameter: budget_id.',
    inputSchema: {
      type: 'object',
      properties: { budget_id: { type: 'string', description: BUDGET_ID_DESC } },
      required: ['budget_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list-transactions',
    description:
      'Listet Transaktionen eines Bereichs, absteigend nach Datum. Alle Filter sind optional und werden ' +
      'kombiniert (UND-Verknüpfung). Pflichtparameter: budget_id.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: BUDGET_ID_DESC },
        from: { type: 'string', description: 'Frühestes Datum, einschliesslich, Format YYYY-MM-DD.' },
        to: { type: 'string', description: 'Spätestes Datum, einschliesslich, Format YYYY-MM-DD.' },
        type: { type: 'string', enum: ['income', 'expense'], description: 'Nur Einnahmen bzw. nur Ausgaben.' },
        category: { type: 'string', description: 'Exakter Kategoriename.' },
        min_amount: { type: 'number', description: 'Mindestbetrag (brutto) in Euro, einschliesslich.' },
        max_amount: { type: 'number', description: 'Höchstbetrag (brutto) in Euro, einschliesslich.' },
        search: { type: 'string', description: 'Freitextsuche in Beschreibung, Kategorie und Notiz.' },
        limit: { type: 'number', description: 'Anzahl Treffer. Vorgabe 100, Maximum 500.' },
        offset: { type: 'number', description: 'Anzahl zu überspringender Treffer für Blättern. Vorgabe 0.' },
      },
      required: ['budget_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get-summary',
    description:
      'Kennzahlen eines Bereichs: Einnahmen, Ausgaben, Saldo und Sparquote für einen Zeitraum sowie den ' +
      'aktuellen Kontostand, den Bestand in Sparttöpfen und das daraus VERFÜGBARE Geld ' +
      '(Kontostand minus Töpfe; der Steuertopf enthält die ans Finanzamt abzuführende Umsatzsteuer). ' +
      'Ohne Angabe von from/to wird der laufende Abrechnungsmonat verwendet, der den in den Einstellungen ' +
      'gesetzten Monatsbeginn berücksichtigt. Der Kontostand umfasst immer alle Transaktionen des Bereichs, ' +
      'unabhängig vom Zeitraum. Alle Beträge sind brutto. Pflichtparameter: budget_id.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: BUDGET_ID_DESC },
        from: { type: 'string', description: 'Beginn des Zeitraums, Format YYYY-MM-DD.' },
        to: { type: 'string', description: 'Ende des Zeitraums, Format YYYY-MM-DD.' },
      },
      required: ['budget_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze-by-category',
    description:
      'Summen und prozentuale Anteile je Kategorie in einem Zeitraum, absteigend sortiert. ' +
      'Ohne from/to wird der laufende Abrechnungsmonat verwendet. Pflichtparameter: budget_id.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: BUDGET_ID_DESC },
        from: { type: 'string', description: 'Beginn des Zeitraums, Format YYYY-MM-DD.' },
        to: { type: 'string', description: 'Ende des Zeitraums, Format YYYY-MM-DD.' },
        type: {
          type: 'string',
          enum: ['income', 'expense'],
          description: 'Auszuwertende Buchungsart. Vorgabe: expense.',
        },
      },
      required: ['budget_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare-periods',
    description:
      'Stellt zwei Zeiträume je Kategorie gegenüber und liefert absolute und prozentuale Differenz. ' +
      'Pflichtparameter: budget_id, a_from, a_to, b_from, b_to. Zeitraum A ist der Vergleichszeitraum, ' +
      'Zeitraum B der aktuellere.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: BUDGET_ID_DESC },
        a_from: { type: 'string', description: 'Beginn Zeitraum A, Format YYYY-MM-DD.' },
        a_to: { type: 'string', description: 'Ende Zeitraum A, Format YYYY-MM-DD.' },
        b_from: { type: 'string', description: 'Beginn Zeitraum B, Format YYYY-MM-DD.' },
        b_to: { type: 'string', description: 'Ende Zeitraum B, Format YYYY-MM-DD.' },
        type: {
          type: 'string',
          enum: ['income', 'expense'],
          description: 'Auszuwertende Buchungsart. Vorgabe: expense.',
        },
      },
      required: ['budget_id', 'a_from', 'a_to', 'b_from', 'b_to'],
      additionalProperties: false,
    },
  },
  {
    name: 'list-recurring',
    description:
      'Listet Daueraufträge mit Betrag, Frequenz, nächster Fälligkeit und Status. ' +
      'Ohne budget_id werden die Daueraufträge aller Bereiche zurückgegeben.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: 'Optional. ID des Bereichs, sonst alle Bereiche.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list-pots',
    description:
      'Listet Sparttöpfe mit Art, Zuteilungsprozentsatz, Sparziel und aktuellem Bestand. ' +
      'Art "manuell": vom Nutzer angelegt, bekommt den Prozentanteil vom NETTO jeder Einnahme. ' +
      'Art "steuer": der automatische Steuertopf (einer je Bereich), exakt befüllt aus der in Buchungen ' +
      'enthaltenen Steuer — Umsatzsteuer aus Einnahmen rein, Vorsteuer aus Ausgaben raus; ein negativer ' +
      'Bestand ist ein Vorsteuerüberhang. Der Bestand aller Töpfe ist reserviert und nicht verfügbar. ' +
      '"aktiv": false heißt pausiert — der Bestand bleibt reserviert, neue Buchungen laufen aber nicht hinein. ' +
      'Ohne budget_id werden die Töpfe aller Bereiche zurückgegeben.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: 'Optional. ID des Bereichs, sonst alle Bereiche.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get-settings',
    description:
      'Liefert die Einstellungen des Kontos je Bereich: Anzeigename, Anfangssaldo, Monatsbeginn und den ' +
      'Anzeigeschalter für KI-Markierungen. Ohne budget_id werden die Einstellungen aller Bereiche geliefert.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: 'Optional. ID des Bereichs, sonst alle Bereiche.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list-activity-log',
    description:
      'Liefert die jüngsten Einträge des Änderungsprotokolls. Erfasst wird JEDE Änderung an Transaktionen, ' +
      'Notizen und Sparttöpfen — auch die aus der App, nicht nur die von Claude. Die Spalte "herkunft" ' +
      'unterscheidet beides. Zusätzlich stehen dort die Aufrufe dieses MCP-Servers selbst (aktion "read").',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Anzahl Einträge. Vorgabe 50, Maximum 200.' },
        actor:  { type: 'string', enum: ['app', 'mcp'], description: 'Nur Einträge dieser Herkunft.' },
        entity: { type: 'string', description: 'Nur Einträge zu dieser Tabelle, z. B. "transactions".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list-notes',
    description:
      'Listet alle Notizen zu einer Transaktion, chronologisch aufsteigend. Notizen sind unveränderlich und ' +
      'liegen getrennt vom Feld "notiz" der Transaktion selbst. Pflichtparameter: transaction_id.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: 'ID der Transaktion (aus list-transactions).' },
      },
      required: ['transaction_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add-note',
    description:
      'Hängt eine Notiz an eine bestehende Transaktion an. Notizen können nur hinzugefügt, niemals geändert ' +
      'oder gelöscht werden. Die Notiz wird mit der Herkunft "mcp" markiert. Das Feld "notiz" der Transaktion ' +
      'selbst bleibt davon unberührt. Pflichtparameter: transaction_id und body.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: 'ID der Transaktion, die die Notiz bekommt.' },
        body:           { type: 'string', description: 'Text der Notiz. Darf nicht leer sein.' },
      },
      required: ['transaction_id', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'create-savings-pot',
    description:
      'Legt einen neuen manuellen Spartopf an. ACHTUNG, Tragweite: ein Topf mit Verteilungsanteil verändert, ' +
      'was mit KÜNFTIGEN Einnahmen geschieht — der Netto-Anteil jeder neuen Einnahme wird automatisch ' +
      'anteilig verteilt (die enthaltene Steuer geht in den Steuertopf). Deshalb muss ' +
      'der Nutzer das in den Einstellungen erlaubt haben (Schalter "Sparttöpfe anlegen"); ist er aus, ' +
      'schlägt der Aufruf fehl. Bestehende Töpfe können weder geändert noch gelöscht werden. ' +
      'Pflichtparameter: budget_id, name, allocation_percent.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: BUDGET_ID_DESC },
        name:      { type: 'string', description: 'Name des Topfes, z. B. "Notgroschen".' },
        allocation_percent: {
          type: 'number',
          description:
            'Anteil vom Netto künftiger Einnahmen in Prozent (0–100). Die Summe über alle manuellen Töpfe eines Bereichs darf ' +
            '100 nicht überschreiten; bei Überschreitung nennt die Fehlermeldung den noch freien Anteil.',
        },
        target_amount: { type: 'number', description: 'Optionales Sparziel in Euro.' },
        color:         { type: 'string', description: 'Optionale Farbe als Hex-Wert, z. B. "#4A6FA5".' },
        icon:          { type: 'string', description: 'Optionales Emoji.' },
      },
      required: ['budget_id', 'name', 'allocation_percent'],
      additionalProperties: false,
    },
  },
  {
    name: 'create-transaction',
    description:
      'Legt eine neue Transaktion an (neben add-note und create-savings-pot einer von drei schreibenden ' +
      'Zugriffen; Ändern und Löschen sind nicht möglich). Alle Pflichtparameter müssen gesetzt sein, es gibt ' +
      'keine Vorbelegung — ' +
      'insbesondere wird kein Bereich geraten. Der Kategoriename muss exakt einer vorhandenen Kategorie des ' +
      'Bereichs mit passendem Typ entsprechen (siehe list-categories); neue Kategorien werden nicht angelegt. ' +
      'Der Betrag ist immer positiv und BRUTTO, die Richtung ergibt sich aus "type". ' +
      'Enthaltene Steuer (nur Firmenbereiche): entweder "tax_amount" (Betrag von der Rechnung) oder ' +
      '"tax_rate" (Satz in Prozent, z. B. 19 → Steuer = amount − amount/1,19) angeben, nie beides. ' +
      'Ohne Angabe gilt 0 — richtig für Privatbereiche und für Rechnungen ohne deutsche USt ' +
      '(Reverse Charge, Kleinunternehmer). Die Steuer bucht ein DB-Trigger automatisch in den Steuertopf: ' +
      'Einnahme +, Ausgabe − (Vorsteuerabzug). Die Buchung wird mit der Herkunft "mcp" markiert und im ' +
      'KI-Protokoll festgehalten.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_id: { type: 'string', description: BUDGET_ID_DESC },
        date: { type: 'string', description: 'Buchungsdatum, Pflicht, Format YYYY-MM-DD.' },
        type: {
          type: 'string',
          enum: ['income', 'expense'],
          description: 'Pflicht. "income" für Einnahme, "expense" für Ausgabe.',
        },
        amount: {
          type: 'number',
          description: 'Pflicht. Positiver Bruttobetrag in Euro, maximal zwei Nachkommastellen, höchstens 1000000.',
        },
        tax_amount: {
          type: 'number',
          description:
            'Optional. Im Bruttobetrag enthaltene Steuer in Euro (0 ≤ tax_amount ≤ amount; Gleichheit = ' +
            'reine Steuerzahlung ans Finanzamt bzw. Erstattung). Nicht zusammen mit tax_rate.',
        },
        tax_rate: {
          type: 'number',
          description:
            'Optional. Enthaltener Steuersatz in Prozent (0–100), z. B. 19 oder 7. Der Server rechnet ' +
            'Netto = amount / (1 + tax_rate/100), auf Cent gerundet, und Steuer = amount − Netto.',
        },
        category: {
          type: 'string',
          description:
            'Pflicht. Kategoriename als Freitext, exakt wie von list-categories geliefert (Gross- und ' +
            'Kleinschreibung sowie Umlaute zählen).',
        },
        description: { type: 'string', description: 'Pflicht. Kurze Beschreibung der Buchung.' },
        note: { type: 'string', description: 'Optionale Notiz.' },
      },
      required: ['budget_id', 'date', 'type', 'amount', 'category', 'description'],
      additionalProperties: false,
    },
  },
] as const;

// ── Tool-Implementierungen ──────────────────────────────────

interface ToolOutcome {
  payload: unknown;
  summary: string;
  budgetId?: string | null;
  affectedId?: string | null;
  /** Freitext, der der Antwort vorangestellt wird. */
  headline?: string;
}

type Handler = (
  sb: SupabaseClient,
  args: Record<string, unknown>,
  ctx: AuthContext,
) => Promise<ToolOutcome>;

/** Zeitraum bestimmen: explizit gesetzt, sonst laufender Abrechnungsmonat. */
async function resolveRange(
  sb: SupabaseClient,
  budgetId: string,
  args: Record<string, unknown>,
): Promise<{ from: string; to: string; monthStart: number; quelle: string }> {
  const rawFrom = optionalString(args, 'from');
  const rawTo = optionalString(args, 'to');
  const settings = await fetchSettings(sb, budgetId);
  const monthStart = settings?.month_start != null ? toNum(settings.month_start) : 1;

  if (rawFrom || rawTo) {
    const from = rawFrom ? validDate(rawFrom, 'from') : '0000-01-01';
    const to = rawTo ? validDate(rawTo, 'to') : '9999-12-31';
    if (from > to) throw new ToolError(`"from" (${from}) liegt nach "to" (${to}).`);
    return { from, to, monthStart, quelle: 'explizit angegeben' };
  }

  const range = getCustomMonthRange(monthStart);
  return { ...range, monthStart, quelle: `laufender Abrechnungsmonat ab Tag ${monthStart}` };
}

/** Buchungsart aus den Argumenten; Vorgabe "expense". */
function parseBookingType(args: Record<string, unknown>): 'income' | 'expense' {
  const raw = optionalString(args, 'type') ?? 'expense';
  if (raw !== 'income' && raw !== 'expense') {
    throw new ToolError(`Parameter "type" muss "income" oder "expense" sein (erhalten: "${raw}").`);
  }
  return raw;
}

function sumBy(rows: Record<string, unknown>[], type: 'income' | 'expense'): number {
  return rows
    .filter((t) => t.type === type)
    .reduce((s, t) => s + toNum(t.amount), 0);
}

function sumTaxBy(rows: Record<string, unknown>[], type: 'income' | 'expense'): number {
  return rows
    .filter((t) => t.type === type)
    .reduce((s, t) => s + toNum(t.tax_amount), 0);
}

/** Töpfe eines Bereichs — für "verfügbar" in get-summary. */
async function fetchPots(sb: SupabaseClient, budgetId: string) {
  const { data, error } = await sb
    .from('savings_pots')
    .select('id, name, kind, current_amount')
    .eq('budget_id', budgetId);
  if (error) throw new ToolError(`Sparttöpfe konnten nicht gelesen werden: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

function groupByCategory(rows: Record<string, unknown>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of rows) {
    const key = String(t.category ?? '');
    out[key] = (out[key] ?? 0) + toNum(t.amount);
  }
  return out;
}

const HANDLERS: Record<string, Handler> = {
  // ── list-budgets ──────────────────────────────────────────
  'list-budgets': async (sb) => {
    const rows = await fetchBudgets(sb);
    const payload = rows.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      typ: b.type === 'business' ? 'Firma' : 'Privat',
      type: String(b.type),
      farbe: String(b.color ?? ''),
      erstellt_am: b.created_at != null ? String(b.created_at) : null,
    }));
    return {
      payload: { bereiche: payload, anzahl: payload.length },
      summary: `${payload.length} Bereiche gelesen`,
      headline: `${payload.length} Bereich${payload.length !== 1 ? 'e' : ''} gefunden.`,
    };
  },

  // ── list-categories ───────────────────────────────────────
  'list-categories': async (sb, args) => {
    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);
    const rows = await fetchCategories(sb, budgetId);

    const map = (t: 'income' | 'expense') =>
      rows
        .filter((c) => c.type === t)
        .map((c) => ({
          id: String(c.id),
          name: String(c.name),
          monatsbudget:
            c.monthly_budget != null ? money(toNum(c.monthly_budget)) : null,
          // Vorbelegungen aus der App: welchen Steuersatz und welche Wiederholung
          // der Wizard bei dieser Kategorie vorschlägt. Für create-transaction
          // heisst das: bei steuersatz_vorbelegung 19 ist tax_rate 19 der Normalfall.
          steuersatz_vorbelegung: c.default_tax_rate != null ? toNum(c.default_tax_rate) : null,
          dauerauftrag_vorbelegung: c.default_frequency != null ? String(c.default_frequency) : null,
        }));

    const einnahmen = map('income');
    const ausgaben = map('expense');
    return {
      budgetId,
      payload: {
        bereich: { id: budgetId, name: String(budget.name) },
        einnahme_kategorien: einnahmen,
        ausgabe_kategorien: ausgaben,
        anzahl: rows.length,
      },
      summary: `${rows.length} Kategorien gelesen (Bereich ${budget.name})`,
      headline:
        `${rows.length} Kategorien im Bereich ${budget.name}: ` +
        `${einnahmen.length} für Einnahmen, ${ausgaben.length} für Ausgaben.`,
    };
  },

  // ── list-transactions ─────────────────────────────────────
  'list-transactions': async (sb, args) => {
    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);

    const rawLimit = optionalNumber(args, 'limit');
    const limit = Math.min(500, Math.max(1, Math.floor(rawLimit ?? 100)));
    const offset = Math.max(0, Math.floor(optionalNumber(args, 'offset') ?? 0));

    let q = sb
      .from('transactions')
      .select('id, date, type, amount, tax_amount, category, description, note, source, created_at', {
        count: 'exact',
      })
      .eq('budget_id', budgetId);

    const from = optionalString(args, 'from');
    if (from) q = q.gte('date', validDate(from, 'from'));
    const to = optionalString(args, 'to');
    if (to) q = q.lte('date', validDate(to, 'to'));

    const type = optionalString(args, 'type');
    if (type) {
      if (type !== 'income' && type !== 'expense') {
        throw new ToolError('Parameter "type" muss "income" oder "expense" sein.');
      }
      q = q.eq('type', type);
    }

    const category = optionalString(args, 'category');
    if (category) q = q.eq('category', category);

    const minAmount = optionalNumber(args, 'min_amount');
    if (minAmount !== undefined) q = q.gte('amount', minAmount);
    const maxAmount = optionalNumber(args, 'max_amount');
    if (maxAmount !== undefined) q = q.lte('amount', maxAmount);

    const search = optionalString(args, 'search');
    if (search) {
      const term = safeLikeTerm(search);
      if (term) {
        q = q.or(
          `description.ilike."%${term}%",category.ilike."%${term}%",note.ilike."%${term}%"`,
        );
      }
    }

    const { data, error, count } = await q
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);

    if (error) throw new ToolError(`Transaktionen konnten nicht gelesen werden: ${error.message}`);

    const rows = (data ?? []) as Record<string, unknown>[];
    const mapped = rows.map(mapTx);
    const einnahmen = sumBy(rows, 'income');
    const ausgaben = sumBy(rows, 'expense');
    const umsatzsteuer = sumTaxBy(rows, 'income');
    const vorsteuer = sumTaxBy(rows, 'expense');

    return {
      budgetId,
      payload: {
        bereich: { id: budgetId, name: String(budget.name) },
        transaktionen: mapped,
        anzahl_geliefert: mapped.length,
        anzahl_gesamt_gefiltert: count ?? null,
        offset,
        limit,
        summen_der_gelieferten_zeilen: {
          einnahmen: money(einnahmen),
          ausgaben: money(ausgaben),
          saldo: money(einnahmen - ausgaben),
          umsatzsteuer_enthalten: money(umsatzsteuer),
          vorsteuer_enthalten: money(vorsteuer),
        },
      },
      summary: `${mapped.length} Transaktionen gelesen (Bereich ${budget.name})`,
      headline:
        `${mapped.length} von ${count ?? mapped.length} Transaktionen im Bereich ${budget.name}. ` +
        `Einnahmen ${formatEuro(einnahmen)}, Ausgaben ${formatEuro(ausgaben)}.`,
    };
  },

  // ── get-summary ───────────────────────────────────────────
  // Rechenlogik identisch zu src/pages/Dashboard.tsx:
  //   Kontostand   = settings.starting_balance + Summe(Einnahmen) − Summe(Ausgaben)  über ALLE Buchungen
  //   Sparquote    = Einnahmen > 0 ? (Einnahmen − Ausgaben) / Einnahmen * 100 : 0    für den Zeitraum
  // Massgeblich ist settings.starting_balance, nicht budgets.starting_balance.
  'get-summary': async (sb, args) => {
    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);
    const range = await resolveRange(sb, budgetId, args);

    const settings = await fetchSettings(sb, budgetId);
    const startingBalance = settings ? toNum(settings.starting_balance) : 0;

    const all = await fetchAllTransactions(sb, budgetId);
    const inRange = all.filter((t) => {
      const d = String(t.date);
      return d >= range.from && d <= range.to;
    });

    const einnahmen = sumBy(inRange, 'income');
    const ausgaben = sumBy(inRange, 'expense');
    const saldo = einnahmen - ausgaben;
    const sparquote = einnahmen > 0 ? ((einnahmen - ausgaben) / einnahmen) * 100 : 0;

    const kontostand =
      startingBalance + sumBy(all, 'income') - sumBy(all, 'expense');

    // Verfügbar = Kontostand minus Bestand aller Töpfe. Rechnung identisch
    // zu src/pages/Dashboard.tsx. Der Steuertopf zählt mit — dieses Geld
    // gehört dem Finanzamt; ist er negativ, erhöht die erwartete Erstattung
    // das Verfügbare.
    const pots = await fetchPots(sb, budgetId);
    const inToepfen = pots.reduce((s, p) => s + toNum(p.current_amount), 0);
    const verfuegbar = kontostand - inToepfen;
    const steuertopf = pots.find((p) => p.kind === 'tax');

    return {
      budgetId,
      payload: {
        bereich: { id: budgetId, name: String(budget.name) },
        zeitraum: {
          von: range.from,
          bis: range.to,
          von_formatiert: formatDate(range.from),
          bis_formatiert: formatDate(range.to),
          monatsbeginn: range.monthStart,
          herkunft: range.quelle,
        },
        einnahmen: money(einnahmen),
        ausgaben: money(ausgaben),
        saldo: money(saldo),
        umsatzsteuer_im_zeitraum: money(sumTaxBy(inRange, 'income')),
        vorsteuer_im_zeitraum: money(sumTaxBy(inRange, 'expense')),
        sparquote_prozent: Math.round(sparquote * 10) / 10,
        sparquote_formatiert: `${(Math.round(sparquote * 10) / 10).toLocaleString('de-DE', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} %`,
        kontostand: money(kontostand),
        kontostand_basis: {
          anfangssaldo: money(startingBalance),
          quelle: 'settings.starting_balance',
          anzahl_beruecksichtigter_buchungen: all.length,
          hinweis: 'Der Kontostand umfasst alle Buchungen des Bereichs, nicht nur den Zeitraum. Beträge sind brutto.',
        },
        verfuegbar: money(verfuegbar),
        in_toepfen: money(inToepfen),
        steuertopf: steuertopf
          ? {
              pot_id: String(steuertopf.id),
              name: String(steuertopf.name ?? ''),
              bestand: money(toNum(steuertopf.current_amount)),
              hinweis:
                toNum(steuertopf.current_amount) < 0
                  ? 'Negativ: Vorsteuerüberhang, Erstattung vom Finanzamt zu erwarten.'
                  : 'Umsatzsteuer aus Einnahmen abzüglich Vorsteuer aus Ausgaben; ans Finanzamt abzuführen.',
            }
          : null,
        anzahl_toepfe: pots.length,
        anzahl_buchungen_im_zeitraum: inRange.length,
      },
      summary:
        `Kennzahlen ${range.from} bis ${range.to} gelesen ` +
        `(${inRange.length} Buchungen, Bereich ${budget.name})`,
      headline:
        `${budget.name}, ${formatDate(range.from)}–${formatDate(range.to)}: ` +
        `Einnahmen ${formatEuro(einnahmen)}, Ausgaben ${formatEuro(ausgaben)}, ` +
        `Saldo ${formatEuro(saldo)}. Kontostand ${formatEuro(kontostand)}, ` +
        `davon ${formatEuro(inToepfen)} in Töpfen → verfügbar ${formatEuro(verfuegbar)}.`,
    };
  },

  // ── analyze-by-category ───────────────────────────────────
  'analyze-by-category': async (sb, args) => {
    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);
    const range = await resolveRange(sb, budgetId, args);

    const type = parseBookingType(args);

    const all = await fetchAllTransactions(sb, budgetId);
    const rows = all.filter((t) => {
      const d = String(t.date);
      return t.type === type && d >= range.from && d <= range.to;
    });

    const grouped = groupByCategory(rows);
    const gesamt = Object.values(grouped).reduce((s, v) => s + v, 0);
    const cats = await fetchCategories(sb, budgetId);

    const liste = Object.entries(grouped)
      .map(([name, summe]) => {
        const catObj = cats.find((c) => String(c.name) === name && c.type === type);
        const monatsbudget =
          catObj?.monthly_budget != null ? toNum(catObj.monthly_budget) : null;
        return {
          kategorie: name,
          ...money(summe),
          anteil_prozent: gesamt > 0 ? Math.round((summe / gesamt) * 1000) / 10 : 0,
          anzahl_buchungen: rows.filter((t) => String(t.category ?? '') === name).length,
          monatsbudget: monatsbudget != null ? money(monatsbudget) : null,
          bekannte_kategorie: catObj != null,
        };
      })
      .sort((a, b) => b.betrag - a.betrag);

    return {
      budgetId,
      payload: {
        bereich: { id: budgetId, name: String(budget.name) },
        buchungsart: type === 'income' ? 'Einnahmen' : 'Ausgaben',
        zeitraum: { von: range.from, bis: range.to, herkunft: range.quelle },
        gesamt: money(gesamt),
        kategorien: liste,
      },
      summary:
        `${liste.length} Kategorien ausgewertet, ${rows.length} Buchungen ` +
        `(${range.from} bis ${range.to}, Bereich ${budget.name})`,
      headline:
        `${liste.length} Kategorien, ${type === 'income' ? 'Einnahmen' : 'Ausgaben'} gesamt ` +
        `${formatEuro(gesamt)} zwischen ${formatDate(range.from)} und ${formatDate(range.to)}.`,
    };
  },

  // ── compare-periods ───────────────────────────────────────
  'compare-periods': async (sb, args) => {
    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);

    const aFrom = validDate(requireString(args, 'a_from'), 'a_from');
    const aTo = validDate(requireString(args, 'a_to'), 'a_to');
    const bFrom = validDate(requireString(args, 'b_from'), 'b_from');
    const bTo = validDate(requireString(args, 'b_to'), 'b_to');
    if (aFrom > aTo) throw new ToolError(`"a_from" (${aFrom}) liegt nach "a_to" (${aTo}).`);
    if (bFrom > bTo) throw new ToolError(`"b_from" (${bFrom}) liegt nach "b_to" (${bTo}).`);

    const type = parseBookingType(args);

    const all = await fetchAllTransactions(sb, budgetId);
    const pick = (from: string, to: string) =>
      all.filter((t) => {
        const d = String(t.date);
        return t.type === type && d >= from && d <= to;
      });

    const rowsA = pick(aFrom, aTo);
    const rowsB = pick(bFrom, bTo);
    const groupedA = groupByCategory(rowsA);
    const groupedB = groupByCategory(rowsB);

    const alle = [...new Set([...Object.keys(groupedA), ...Object.keys(groupedB)])];
    const vergleich = alle
      .map((kategorie) => {
        const a = groupedA[kategorie] ?? 0;
        const b = groupedB[kategorie] ?? 0;
        const diff = b - a;
        return {
          kategorie,
          zeitraum_a: money(a),
          zeitraum_b: money(b),
          differenz: money(diff),
          differenz_prozent: a === 0 ? null : Math.round(((b - a) / a) * 1000) / 10,
          richtung: diff > 0 ? 'gestiegen' : diff < 0 ? 'gesunken' : 'unverändert',
        };
      })
      .sort((x, y) => Math.abs(y.differenz.betrag) - Math.abs(x.differenz.betrag));

    const gesamtA = Object.values(groupedA).reduce((s, v) => s + v, 0);
    const gesamtB = Object.values(groupedB).reduce((s, v) => s + v, 0);

    return {
      budgetId,
      payload: {
        bereich: { id: budgetId, name: String(budget.name) },
        buchungsart: type === 'income' ? 'Einnahmen' : 'Ausgaben',
        zeitraum_a: { von: aFrom, bis: aTo, gesamt: money(gesamtA), anzahl: rowsA.length },
        zeitraum_b: { von: bFrom, bis: bTo, gesamt: money(gesamtB), anzahl: rowsB.length },
        gesamt_differenz: money(gesamtB - gesamtA),
        gesamt_differenz_prozent:
          gesamtA === 0 ? null : Math.round(((gesamtB - gesamtA) / gesamtA) * 1000) / 10,
        kategorien: vergleich,
      },
      summary:
        `Zeitraumvergleich ${aFrom}–${aTo} gegen ${bFrom}–${bTo} über ` +
        `${vergleich.length} Kategorien (Bereich ${budget.name})`,
      headline:
        `Zeitraum A ${formatEuro(gesamtA)}, Zeitraum B ${formatEuro(gesamtB)}, ` +
        `Differenz ${formatEuro(gesamtB - gesamtA)} über ${vergleich.length} Kategorien.`,
    };
  },

  // ── list-recurring ────────────────────────────────────────
  'list-recurring': async (sb, args) => {
    const budgetId = optionalString(args, 'budget_id');
    if (budgetId) await requireBudget(sb, budgetId);

    let q = sb
      .from('recurring_transactions')
      .select(
        'id, budget_id, amount, tax_amount, type, category, description, note, frequency, ' +
        'start_date, end_date, next_due, last_executed, is_active, created_at',
      );
    if (budgetId) q = q.eq('budget_id', budgetId);

    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw new ToolError(`Daueraufträge konnten nicht gelesen werden: ${error.message}`);

    const FREQ: Record<string, string> = {
      daily: 'Täglich',
      weekly: 'Wöchentlich',
      monthly: 'Monatlich',
      yearly: 'Jährlich',
    };

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const payload = rows.map((r) => ({
      id: String(r.id),
      budget_id: r.budget_id != null ? String(r.budget_id) : null,
      beschreibung: String(r.description ?? ''),
      ...money(toNum(r.amount)),
      steuer: money(toNum(r.tax_amount)),
      typ: r.type === 'income' ? 'Einnahme' : 'Ausgabe',
      type: String(r.type),
      kategorie: String(r.category ?? ''),
      notiz: r.note != null ? String(r.note) : null,
      frequenz: FREQ[String(r.frequency)] ?? String(r.frequency),
      frequency: String(r.frequency),
      startdatum: String(r.start_date),
      enddatum: r.end_date != null ? String(r.end_date) : null,
      naechste_faelligkeit: String(r.next_due),
      naechste_faelligkeit_formatiert: formatDate(String(r.next_due)),
      zuletzt_ausgefuehrt: r.last_executed != null ? String(r.last_executed) : null,
      aktiv: Boolean(r.is_active),
    }));

    const aktive = payload.filter((r) => r.aktiv).length;
    return {
      budgetId: budgetId ?? null,
      payload: { dauerauftraege: payload, anzahl: payload.length, davon_aktiv: aktive },
      summary: `${payload.length} Daueraufträge gelesen`,
      headline: `${payload.length} Dauerauftrag${payload.length !== 1 ? 'e' : ''}, davon ${aktive} aktiv.`,
    };
  },

  // ── list-pots ─────────────────────────────────────────────
  'list-pots': async (sb, args) => {
    const budgetId = optionalString(args, 'budget_id');
    if (budgetId) await requireBudget(sb, budgetId);

    let q = sb
      .from('savings_pots')
      .select(
        'id, budget_id, name, kind, allocation_percent, target_amount, current_amount, ' +
        'color, icon, sort_order, is_active, created_at, updated_at',
      );
    if (budgetId) q = q.eq('budget_id', budgetId);

    const { data, error } = await q
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new ToolError(`Sparttöpfe konnten nicht gelesen werden: ${error.message}`);

    // Der Typ-Parser von postgrest-js kann zusammengesetzte Select-Strings
    // nicht lesen und liefert GenericStringError; die Zeilen sind trotzdem da.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const payload = rows.map((p) => {
      const ist = toNum(p.current_amount);
      const ziel = p.target_amount != null ? toNum(p.target_amount) : null;
      return {
        id: String(p.id),
        budget_id: p.budget_id != null ? String(p.budget_id) : null,
        name: String(p.name ?? ''),
        art: p.kind === 'tax' ? 'steuer' : 'manuell',
        kind: p.kind === 'tax' ? 'tax' : 'manual',
        zuteilung_prozent: toNum(p.allocation_percent),
        ist_betrag: money(ist),
        ziel_betrag: ziel != null ? money(ziel) : null,
        zielerreichung_prozent: ziel && ziel > 0 ? Math.round((ist / ziel) * 1000) / 10 : null,
        symbol: p.icon != null ? String(p.icon) : null,
        reihenfolge: toNum(p.sort_order),
        // false = pausiert: Bestand bleibt reserviert, neue Buchungen laufen nicht hinein.
        aktiv: p.is_active !== false,
      };
    });

    const gesamt = payload.reduce((s, p) => s + p.ist_betrag.betrag, 0);
    return {
      budgetId: budgetId ?? null,
      payload: { sparttoepfe: payload, anzahl: payload.length, gesamtbestand: money(gesamt) },
      summary: `${payload.length} Sparttöpfe gelesen`,
      headline: `${payload.length} Spartopf/-töpfe, Gesamtbestand ${formatEuro(gesamt)}.`,
    };
  },

  // ── get-settings ──────────────────────────────────────────
  'get-settings': async (sb, args) => {
    const budgetId = optionalString(args, 'budget_id');
    if (budgetId) await requireBudget(sb, budgetId);

    // Bewusst ohne id und user_id.
    let q = sb
      .from('settings')
      .select('budget_id, starting_balance, name, month_start, show_ai_badges');
    if (budgetId) q = q.eq('budget_id', budgetId);

    const { data, error } = await q;
    if (error) throw new ToolError(`Einstellungen konnten nicht gelesen werden: ${error.message}`);

    const budgets = await fetchBudgets(sb);
    const rows = (data ?? []) as Record<string, unknown>[];
    const payload = rows.map((s) => {
      const bid = s.budget_id != null ? String(s.budget_id) : null;
      return {
        budget_id: bid,
        bereich_name: budgets.find((b) => String(b.id) === bid)?.name ?? null,
        anzeigename: String(s.name ?? ''),
        anfangssaldo: money(toNum(s.starting_balance)),
        monatsbeginn: s.month_start != null ? toNum(s.month_start) : 1,
        ki_markierungen_sichtbar: s.show_ai_badges !== false,
      };
    });

    return {
      budgetId: budgetId ?? null,
      payload: { einstellungen: payload, anzahl: payload.length },
      summary: `${payload.length} Einstellungssätze gelesen`,
      headline: `Einstellungen für ${payload.length} Bereich${payload.length !== 1 ? 'e' : ''}.`,
    };
  },

  // ── list-activity-log ─────────────────────────────────────
  'list-activity-log': async (sb, args) => {
    const limit = Math.min(200, Math.max(1, Math.floor(optionalNumber(args, 'limit') ?? 50)));

    let q = sb
      .from('activity_log')
      .select('id, budget_id, created_at, actor, client_label, entity, entity_id, action, tool, params, status, error_message');

    const actor = optionalString(args, 'actor');
    if (actor) {
      if (actor !== 'app' && actor !== 'mcp') {
        throw new ToolError('Parameter "actor" muss "app" oder "mcp" sein.');
      }
      q = q.eq('actor', actor);
    }
    const entity = optionalString(args, 'entity');
    if (entity) q = q.eq('entity', entity);

    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) throw new ToolError(`Protokoll konnte nicht gelesen werden: ${error.message}`);

    const AKTION: Record<string, string> = {
      insert: 'angelegt', update: 'geändert', delete: 'gelöscht', read: 'gelesen',
    };

    const rows = (data ?? []) as Record<string, unknown>[];
    const payload = rows.map((r) => ({
      id: String(r.id),
      zeitpunkt: String(r.created_at),
      herkunft: String(r.actor),
      client: r.client_label != null ? String(r.client_label) : null,
      entitaet: String(r.entity),
      entitaet_id: r.entity_id != null ? String(r.entity_id) : null,
      aktion: AKTION[String(r.action)] ?? String(r.action),
      action: String(r.action),
      tool: r.tool != null ? String(r.tool) : null,
      status: String(r.status),
      fehler: r.error_message != null ? String(r.error_message) : null,
      budget_id: r.budget_id != null ? String(r.budget_id) : null,
      parameter: r.params ?? null,
    }));

    const fehler = payload.filter((r) => r.status === 'error').length;
    const vonKi  = payload.filter((r) => r.herkunft === 'mcp').length;
    return {
      payload: {
        eintraege: payload,
        anzahl: payload.length,
        davon_von_ki: vonKi,
        davon_aus_der_app: payload.length - vonKi,
        davon_fehler: fehler,
      },
      summary: `${payload.length} Protokolleinträge gelesen`,
      headline:
        `${payload.length} Protokolleinträge — ${vonKi} von der KI, ` +
        `${payload.length - vonKi} aus der App, ${fehler} mit Fehler.`,
    };
  },

  // ── list-notes ────────────────────────────────────────────
  'list-notes': async (sb, args) => {
    const txId = requireString(args, 'transaction_id');

    const { data: tx, error: txError } = await sb
      .from('transactions')
      .select('id, description, date, budget_id')
      .eq('id', txId)
      .maybeSingle();
    if (txError) throw new ToolError(`Transaktion konnte nicht gelesen werden: ${txError.message}`);
    if (!tx) {
      throw new ToolError(
        `Es gibt keine Transaktion mit der ID "${txId}" in diesem Konto. ` +
        'IDs stammen aus list-transactions.',
      );
    }

    const { data, error } = await sb
      .from('transaction_notes')
      .select('id, transaction_id, created_at, author, body')
      .eq('transaction_id', txId)
      .order('created_at', { ascending: true });
    if (error) throw new ToolError(`Notizen konnten nicht gelesen werden: ${error.message}`);

    const rows = (data ?? []) as Record<string, unknown>[];
    const notizen = rows.map(mapNote);
    const row = tx as Record<string, unknown>;

    return {
      budgetId: row.budget_id != null ? String(row.budget_id) : null,
      affectedId: txId,
      payload: {
        transaktion: {
          id: txId,
          beschreibung: String(row.description ?? ''),
          datum: String(row.date ?? ''),
        },
        notizen,
        anzahl: notizen.length,
      },
      summary: `${notizen.length} Notizen gelesen`,
      headline: `${notizen.length} Notiz${notizen.length !== 1 ? 'en' : ''} zu „${String(row.description ?? '')}".`,
    };
  },

  // ── add-note ──────────────────────────────────────────────
  'add-note': async (sb, args, ctx) => {
    const txId = requireString(args, 'transaction_id');
    const body = requireString(args, 'body');

    if (body.length > 4000) {
      throw new ToolError(`Die Notiz ist zu lang (${body.length} Zeichen, erlaubt sind 4000).`);
    }

    // Schritt 1: gehört die Transaktion diesem Konto? RLS lässt fremde
    // Zeilen gar nicht erst sehen, ein leeres Ergebnis heisst also
    // "existiert nicht oder gehört jemand anderem".
    const { data: tx, error: txError } = await sb
      .from('transactions')
      .select('id, description, date, budget_id')
      .eq('id', txId)
      .maybeSingle();
    if (txError) throw new ToolError(`Transaktion konnte nicht geprüft werden: ${txError.message}`);
    if (!tx) {
      throw new ToolError(
        `Es gibt keine Transaktion mit der ID "${txId}" in diesem Konto. ` +
        'Es wurde nichts geschrieben. Gültige IDs liefert list-transactions.',
      );
    }
    const txRow = tx as Record<string, unknown>;
    const budgetId = txRow.budget_id != null ? String(txRow.budget_id) : null;

    // Schritt 2: Insert mit author = 'mcp'
    const id = crypto.randomUUID();
    const { error: insertError } = await sb.from('transaction_notes').insert({
      id,
      transaction_id: txId,
      user_id: ctx.userId,
      author: 'mcp',
      body,
    });
    if (insertError) {
      throw new ToolError(`Die Notiz konnte nicht gespeichert werden: ${insertError.message}`);
    }

    // Schritt 3: Read-after-write
    const { data: readBack, error: readError } = await sb
      .from('transaction_notes')
      .select('id, transaction_id, created_at, author, body')
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      throw new ToolError(
        `Die Notiz wurde geschrieben (ID ${id}), konnte aber nicht zurückgelesen werden: ${readError.message}`,
      );
    }
    if (!readBack) {
      throw new ToolError(
        `Die Notiz mit der ID ${id} war nach dem Schreiben nicht auffindbar. ` +
        'Bitte in der App prüfen, bevor erneut geschrieben wird.',
      );
    }

    const notiz = mapNote(readBack as Record<string, unknown>);
    const bestaetigung =
      `Notiz angehängt an „${String(txRow.description ?? '')}" ` +
      `vom ${formatDate(String(txRow.date ?? ''))} — ID ${notiz.id}`;

    return {
      budgetId,
      affectedId: notiz.id,
      payload: {
        bestaetigung,
        gespeicherte_notiz: notiz,
        transaktion: {
          id: txId,
          beschreibung: String(txRow.description ?? ''),
          datum: String(txRow.date ?? ''),
        },
        hinweis:
          'Die Werte stammen aus dem erneuten Lesen der Zeile nach dem Schreiben. ' +
          'Notizen lassen sich nicht mehr ändern oder löschen.',
      },
      summary: `Notiz angelegt an Transaktion ${txId}`,
      headline: bestaetigung,
    };
  },

  // ── create-savings-pot ────────────────────────────────────
  'create-savings-pot': async (sb, args, ctx) => {
    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);
    const name = requireString(args, 'name');

    // Schritt 1: Hat der Nutzer das überhaupt erlaubt? Ohne Settings-Zeile
    // greift die RLS-Policy ohnehin (EXISTS auf settings), also gleich klar sagen.
    const settings = await fetchSettings(sb, budgetId);
    if (settings?.mcp_allow_pot_creation !== true) {
      throw new ToolError(
        `Das Anlegen von Sparttöpfen ist für den Bereich "${budget.name}" abgeschaltet. ` +
        'Der Schalter steht in der App unter Einstellungen → KI-Zugriff → "Sparttöpfe anlegen". ' +
        'Es wurde nichts geschrieben.',
      );
    }

    // Schritt 2: Prozentsatz gegen die 100-Prozent-Grenze prüfen.
    const rawPercent = args.allocation_percent;
    const percentNum = typeof rawPercent === 'number' ? rawPercent : Number(rawPercent);
    if (!Number.isFinite(percentNum)) {
      throw new ToolError('Pflichtparameter "allocation_percent" fehlt oder ist keine Zahl.');
    }
    if (percentNum < 0 || percentNum > 100) {
      throw new ToolError(`"allocation_percent" muss zwischen 0 und 100 liegen (erhalten: ${percentNum}).`);
    }
    const percent = Math.round(percentNum * 100) / 100;

    const { data: potRows, error: potError } = await sb
      .from('savings_pots')
      .select('id, name, allocation_percent, sort_order, is_active')
      .eq('budget_id', budgetId);
    if (potError) throw new ToolError(`Sparttöpfe konnten nicht gelesen werden: ${potError.message}`);

    const bestehende = (potRows ?? []) as Record<string, unknown>[];
    // Der Steuertopf (0 %) und pausierte Töpfe zählen nicht zur 100-%-Grenze
    // (so rechnet auch der DB-Trigger, siehe supabase/merge-and-pause.sql).
    const belegt = bestehende
      .filter((p) => p.is_active !== false)
      .reduce((sum, p) => sum + toNum(p.allocation_percent), 0);
    const frei = Math.round((100 - belegt) * 100) / 100;

    if (percent > frei) {
      throw new ToolError(
        `Der Anteil von ${percent} % passt nicht mehr: im Bereich "${budget.name}" sind bereits ` +
        `${Math.round(belegt * 100) / 100} % verplant, frei sind noch ${frei} %. ` +
        'Es wurde nichts geschrieben.',
      );
    }

    const target = optionalNumber(args, 'target_amount');
    if (target !== undefined && (target < 0 || target > 100_000_000)) {
      throw new ToolError(`Ungültiges Sparziel (${target}).`);
    }
    const color = optionalString(args, 'color') ?? '#4A6FA5';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new ToolError(`"color" muss ein Hex-Wert der Form #RRGGBB sein (erhalten: "${color}").`);
    }
    const icon = optionalString(args, 'icon');

    const maxSort = bestehende.reduce((m, p) => Math.max(m, toNum(p.sort_order)), -1);

    // Schritt 3: Insert
    const id = crypto.randomUUID();
    const { error: insertError } = await sb.from('savings_pots').insert({
      id,
      user_id: ctx.userId,
      budget_id: budgetId,
      name,
      allocation_percent: percent,
      target_amount: target ?? null,
      color,
      icon: icon ?? null,
      sort_order: maxSort + 1,
    });
    if (insertError) {
      throw new ToolError(`Der Spartopf konnte nicht angelegt werden: ${insertError.message}`);
    }

    // Schritt 4: Read-after-write
    const { data: readBack, error: readError } = await sb
      .from('savings_pots')
      .select('id, budget_id, name, allocation_percent, target_amount, current_amount, color, icon, sort_order, created_at')
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      throw new ToolError(
        `Der Spartopf wurde angelegt (ID ${id}), konnte aber nicht zurückgelesen werden: ${readError.message}`,
      );
    }
    if (!readBack) {
      throw new ToolError(
        `Der Spartopf mit der ID ${id} war nach dem Schreiben nicht auffindbar. Bitte in der App prüfen.`,
      );
    }

    const row = readBack as Record<string, unknown>;
    const ist = toNum(row.current_amount);
    const ziel = row.target_amount != null ? toNum(row.target_amount) : null;
    const freiDanach = Math.round((frei - percent) * 100) / 100;

    const bestaetigung =
      `Spartopf angelegt: „${String(row.name)}", ${toNum(row.allocation_percent)} % künftiger Einnahmen, ` +
      `Bereich ${budget.name} — ID ${String(row.id)}. Frei bleiben ${freiDanach} %.`;

    return {
      budgetId,
      affectedId: String(row.id),
      payload: {
        bestaetigung,
        gespeicherter_topf: {
          id: String(row.id),
          name: String(row.name),
          bereich_name: String(budget.name),
          zuteilung_prozent: toNum(row.allocation_percent),
          ist_betrag: money(ist),
          ziel_betrag: ziel != null ? money(ziel) : null,
          symbol: row.icon != null ? String(row.icon) : null,
          reihenfolge: toNum(row.sort_order),
        },
        verplant_prozent_gesamt: Math.round((belegt + percent) * 100) / 100,
        frei_prozent: freiDanach,
        hinweis:
          'Ab jetzt wird der NETTO-Anteil jeder neuen Einnahme in diesem Bereich automatisch anteilig ' +
          'auf die manuellen Sparttöpfe verteilt; enthaltene Steuer geht in den Steuertopf. ' +
          'Bestehende Buchungen bleiben unberührt.',
      },
      summary: `Spartopf angelegt: ${String(row.name)} (${toNum(row.allocation_percent)} %)`,
      headline: bestaetigung,
    };
  },

  // ── create-transaction ────────────────────────────────────
  'create-transaction': async (sb, args, ctx) => {
    // ── Schritt 1: vollständig validieren, VOR jedem Schreibzugriff ──

    const budgetId = requireString(args, 'budget_id');
    const budget = await requireBudget(sb, budgetId);

    const date = validDate(requireString(args, 'date'), 'date');
    const heute = new Date();
    const maxDate = isoUTC(
      new Date(Date.UTC(heute.getUTCFullYear() + 1, heute.getUTCMonth(), heute.getUTCDate())),
    );
    if (date < '2000-01-01' || date > maxDate) {
      throw new ToolError(
        `Das Datum "${date}" liegt ausserhalb des zulässigen Bereichs ` +
        `(2000-01-01 bis ${maxDate}, also höchstens ein Jahr in der Zukunft).`,
      );
    }

    const type = requireString(args, 'type');
    if (type !== 'income' && type !== 'expense') {
      throw new ToolError(`Parameter "type" muss "income" oder "expense" sein (erhalten: "${type}").`);
    }

    const rawAmount = args.amount;
    const amountNum = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
    if (!Number.isFinite(amountNum)) {
      throw new ToolError('Pflichtparameter "amount" fehlt oder ist keine Zahl.');
    }
    if (amountNum <= 0) {
      throw new ToolError(
        `Der Betrag muss grösser als 0 sein (erhalten: ${amountNum}). ` +
        'Ausgaben werden nicht negativ erfasst — die Richtung ergibt sich aus "type".',
      );
    }
    if (amountNum > 1_000_000) {
      throw new ToolError(`Der Betrag darf höchstens 1000000 betragen (erhalten: ${amountNum}).`);
    }
    const amount = Math.round(amountNum * 100) / 100;
    if (Math.abs(amount - amountNum) > 1e-9) {
      throw new ToolError(
        `Der Betrag darf höchstens zwei Nachkommastellen haben (erhalten: ${amountNum}).`,
      );
    }

    // Steuer: entweder Betrag von der Rechnung oder aus dem Satz gerechnet.
    // Gleiche Rechnung wie src/lib/money.ts (netFromGross/taxFromGross):
    // Netto = round(Brutto / (1 + Satz)), Steuer = Brutto − Netto.
    let taxAmount = 0;
    const rawTax = optionalNumber(args, 'tax_amount');
    const rawRate = optionalNumber(args, 'tax_rate');
    if (rawTax !== undefined && rawRate !== undefined) {
      throw new ToolError('Bitte entweder "tax_amount" oder "tax_rate" angeben, nicht beides.');
    }
    if (rawTax !== undefined) {
      taxAmount = Math.round(rawTax * 100) / 100;
      if (Math.abs(taxAmount - rawTax) > 1e-9) {
        throw new ToolError(`"tax_amount" darf höchstens zwei Nachkommastellen haben (erhalten: ${rawTax}).`);
      }
    } else if (rawRate !== undefined) {
      if (rawRate < 0 || rawRate > 100) {
        throw new ToolError(`"tax_rate" muss zwischen 0 und 100 liegen (erhalten: ${rawRate}).`);
      }
      // Mit EPSILON wie round2() in src/lib/money.ts, damit App und Server
      // bei Grenzfällen (x,xx5) denselben Cent liefern.
      const net = Math.round((amount / (1 + rawRate / 100) + Number.EPSILON) * 100) / 100;
      taxAmount = Math.round((amount - net + Number.EPSILON) * 100) / 100;
    }
    if (taxAmount < 0 || taxAmount > amount) {
      throw new ToolError(
        `Die enthaltene Steuer muss zwischen 0 und dem Bruttobetrag liegen (Steuer ${taxAmount}, Brutto ${amount}).`,
      );
    }
    if (taxAmount > 0 && budget.type !== 'business') {
      throw new ToolError(
        `Der Bereich "${budget.name}" ist ein Privatbereich; dort gibt es keine Steuerzerlegung. ` +
        'Bitte ohne tax_amount/tax_rate buchen.',
      );
    }

    const category = requireString(args, 'category');
    const cats = await fetchCategories(sb, budgetId);
    const passend = cats.filter((c) => c.type === type);
    const exakt = passend.find((c) => String(c.name) === category);
    if (!exakt) {
      const namen = passend.map((c) => `"${String(c.name)}"`).join(', ') || '— keine vorhanden —';
      throw new ToolError(
        `Die Kategorie "${category}" existiert im Bereich "${budget.name}" nicht als ` +
        `${type === 'income' ? 'Einnahme' : 'Ausgabe'}-Kategorie. ` +
        `Zulässig sind ausschliesslich: ${namen}. ` +
        'Der Name muss exakt übereinstimmen; es wird nichts automatisch angelegt oder korrigiert.',
      );
    }

    const description = requireString(args, 'description');
    const note = optionalString(args, 'note') ?? '';

    // ── Schritt 2: Insert mit source = 'mcp' ──
    const id = crypto.randomUUID();
    const { error: insertError } = await sb.from('transactions').insert({
      id,
      // user_id kommt aus dem sub-Claim des geprüften Tokens. RLS verlangt
      // zusätzlich auth.uid() = user_id, ein abweichender Wert würde abgelehnt.
      user_id: ctx.userId,
      budget_id: budgetId,
      date,
      type,
      amount,
      tax_amount: taxAmount,
      category,
      description,
      note,
      source: 'mcp',
    });
    if (insertError) {
      throw new ToolError(`Die Buchung konnte nicht gespeichert werden: ${insertError.message}`);
    }

    // ── Schritt 3: Read-after-write ──
    const { data: readBack, error: readError } = await sb
      .from('transactions')
      .select('id, budget_id, date, type, amount, tax_amount, category, description, note, source, created_at')
      .eq('id', id)
      .maybeSingle();

    if (readError) {
      throw new ToolError(
        `Die Buchung wurde geschrieben (ID ${id}), konnte aber nicht zurückgelesen werden: ${readError.message}`,
      );
    }
    if (!readBack) {
      throw new ToolError(
        `Die Buchung mit der ID ${id} war nach dem Schreiben nicht auffindbar. ` +
        'Bitte in der App prüfen, bevor erneut gebucht wird.',
      );
    }

    const row = readBack as Record<string, unknown>;
    const gelesen = mapTx(row);

    // ── Schritt 3b: indirekte Effekte sichtbar machen ──
    // Ein INSERT auf transactions löst über SECURITY-DEFINER-Trigger
    // (supabase/tax.sql) eine Verteilung auf die Sparttöpfe aus — Steuer in
    // den Steuertopf (auch bei Ausgaben, dann negativ), Netto-Anteile in
    // manuelle Töpfe — an RLS vorbei und ohne Zutun dieses Servers. Ohne
    // diesen Nachtrag wäre die Bestätigung unvollständig.
    let verteilung: {
      stattgefunden: boolean;
      summe: { betrag: number; formatiert: string } | null;
      toepfe: { topf: string; pot_id: string; art: string; betrag: number; formatiert: string }[];
      hinweis: string;
      lesefehler?: string;
    } = {
      stattgefunden: false,
      summe: null,
      toepfe: [],
      hinweis: 'Keine Spartopf-Verteilung ausgelöst.',
    };

    try {
      const { data: allocRows, error: allocError } = await sb
        .from('pot_allocations')
        .select('id, pot_id, amount, kind')
        .eq('transaction_id', id);

      if (allocError) {
        verteilung.lesefehler = allocError.message;
        verteilung.hinweis =
          'Ob eine Spartopf-Verteilung stattgefunden hat, konnte nicht geprüft werden.';
      } else {
        const allocs = (allocRows ?? []) as Record<string, unknown>[];
        if (allocs.length > 0) {
          const potIds = [...new Set(allocs.map((a) => String(a.pot_id)))];
          const { data: potRows } = await sb
            .from('savings_pots')
            .select('id, name')
            .in('id', potIds);
          const namen = new Map(
            ((potRows ?? []) as Record<string, unknown>[]).map(
              (p) => [String(p.id), String(p.name ?? '')] as const,
            ),
          );

          const toepfe = allocs
            .map((a) => {
              const betrag = toNum(a.amount);
              return {
                topf: namen.get(String(a.pot_id)) ?? '(unbekannter Topf)',
                pot_id: String(a.pot_id),
                art: a.kind === 'tax' ? (betrag < 0 ? 'Vorsteuer' : 'Umsatzsteuer') : 'Anteil',
                betrag: Math.round(betrag * 100) / 100,
                formatiert: formatEuro(betrag),
              };
            })
            .sort((x, y) => y.betrag - x.betrag);

          const summe = toepfe.reduce((s2, t) => s2 + t.betrag, 0);
          verteilung = {
            stattgefunden: true,
            summe: money(summe),
            toepfe,
            hinweis:
              'Diese Verteilung hat ein Datenbank-Trigger ausgelöst, nicht der MCP-Server. ' +
              'Sie verändert savings_pots.current_amount und pot_allocations. ' +
              'Negative Beträge sind Vorsteuer, die den Steuertopf mindert.',
          };
        }
      }
    } catch (e) {
      verteilung.lesefehler = e instanceof Error ? e.message : String(e);
      verteilung.hinweis =
        'Ob eine Spartopf-Verteilung stattgefunden hat, konnte nicht geprüft werden.';
    }

    const steuerZeile = gelesen.steuer.betrag > 0
      ? ` (netto ${gelesen.netto.formatiert}, Steuer ${gelesen.steuer.formatiert})`
      : '';
    const bestaetigung =
      `Eingetragen: ${formatEuro(gelesen.betrag)} ${gelesen.typ}${steuerZeile}, ` +
      `Kategorie ${gelesen.kategorie}, ${gelesen.datum_formatiert}, ` +
      `Budget ${budget.name} — ID ${gelesen.id}`;

    const verteilungsZeile = verteilung.stattgefunden
      ? ` Spartopf-Buchungen: ` +
        verteilung.toepfe.map((t) => `${t.topf} ${t.art} ${t.formatiert}`).join(', ') + '.'
      : verteilung.lesefehler
        ? ' Hinweis: die Spartopf-Verteilung konnte nicht geprüft werden.'
        : '';

    return {
      budgetId,
      affectedId: gelesen.id,
      payload: {
        bestaetigung: bestaetigung + verteilungsZeile,
        spartopf_verteilung: verteilung,
        gespeicherte_transaktion: {
          id: gelesen.id,
          budget_id: row.budget_id != null ? String(row.budget_id) : null,
          bereich_name: String(budget.name),
          steuer: gelesen.steuer,
          netto: gelesen.netto,
          datum: gelesen.datum,
          datum_formatiert: gelesen.datum_formatiert,
          type: gelesen.type,
          typ: gelesen.typ,
          betrag: gelesen.betrag,
          betrag_formatiert: gelesen.formatiert,
          kategorie: gelesen.kategorie,
          beschreibung: gelesen.beschreibung,
          notiz: gelesen.notiz,
          herkunft: gelesen.herkunft,
          erfasst_am: gelesen.erfasst_am,
        },
        hinweis: 'Die Werte stammen aus dem erneuten Lesen der Zeile nach dem Schreiben.',
      },
      summary:
        `Transaktion angelegt: ${formatEuro(gelesen.betrag)} ${gelesen.typ}, ${gelesen.kategorie}` +
        (verteilung.stattgefunden
          ? ` — Spartopf-Verteilung ${verteilung.summe?.formatiert} auf ${verteilung.toepfe.length} Topf/Töpfe`
          : ''),
      headline: bestaetigung + verteilungsZeile,
    };
  },
};

// ── Tool-Ausführung mit Protokollierung ─────────────────────

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(
  ctx: AuthContext,
  name: string,
  rawArgs: unknown,
): Promise<{ content: { type: string; text: string }[]; isError: boolean }> {
  const sb = clientFor(ctx.token);
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  const handler = HANDLERS[name];
  if (!handler) {
    const known = Object.keys(HANDLERS).join(', ');
    const message = `Unbekanntes Tool "${name}". Verfügbar: ${known}.`;
    await writeLog(sb, ctx.userId, {
      tool: name,
      params: args,
      status: 'error',
      errorMessage: message,
    });
    return textResult(`Fehler: ${message}`, true);
  }

  try {
    const outcome = await handler(sb, args, ctx);

    const logError = await writeLog(sb, ctx.userId, {
      tool: name,
      params: args,
      status: 'ok',
      budgetId: outcome.budgetId ?? null,
      resultSummary: outcome.summary,
      affectedId: outcome.affectedId ?? null,
    });

    const parts: string[] = [];
    if (outcome.headline) parts.push(outcome.headline);
    if (logError) {
      // Der eigentliche Vorgang war erfolgreich; das Protokoll nicht.
      // Das wird gemeldet statt verschwiegen.
      parts.push(`Hinweis: Der Protokolleintrag konnte nicht geschrieben werden (${logError}).`);
    }
    parts.push(JSON.stringify(outcome.payload, null, 2));

    return textResult(parts.join('\n\n'), false);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writeLog(sb, ctx.userId, {
      tool: name,
      params: args,
      status: 'error',
      budgetId: typeof args.budget_id === 'string' ? args.budget_id : null,
      errorMessage: message,
    });
    return textResult(`Fehler: ${message}`, true);
  }
}

// ── JSON-RPC 2.0 ────────────────────────────────────────────

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

async function handleRpc(ctx: AuthContext, msg: Record<string, unknown>): Promise<unknown | null> {
  const id = (msg.id ?? null) as JsonRpcId;
  const isNotification = msg.id === undefined || msg.id === null;
  const method = typeof msg.method === 'string' ? msg.method : '';
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Zugriff auf den Finance. Alle Auswertungs-Tools benötigen eine budget_id — diese zuerst ' +
          'mit list-budgets ermitteln. Geschrieben wird nur über create-transaction, add-note und ' +
          'create-savings-pot; Ändern und Löschen sind serverseitig gesperrt. Kategorienamen müssen exakt ' +
          'einer vorhandenen Kategorie entsprechen (list-categories). Beträge sind brutto; im Firmenbereich ' +
          'enthaltene Steuer über tax_amount oder tax_rate angeben, sonst landet nichts im Steuertopf.',
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // Notification — keine Antwort

    case 'ping':
      return isNotification ? null : rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return rpcError(id, -32602, 'Parameter "name" fehlt.');
      const result = await callTool(ctx, name, params.arguments);
      return rpcResult(id, result);
    }

    case 'resources/list':
      return rpcResult(id, { resources: [] });

    case 'prompts/list':
      return rpcResult(id, { prompts: [] });

    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Methode "${method}" wird nicht unterstützt.`);
  }
}

// ── HTTP ────────────────────────────────────────────────────

function unauthorized(detail: string): Response {
  return json(
    {
      error: 'unauthorized',
      error_description: detail,
      resource_metadata: RESOURCE_METADATA_URL,
    },
    401,
    {
      'WWW-Authenticate':
        `Bearer resource_metadata="${RESOURCE_METADATA_URL}", ` +
        `error="invalid_token", error_description="${detail.replace(/"/g, "'")}"`,
    },
  );
}

function protectedResourceMetadata(): Response {
  return json({
    resource: MCP_PUBLIC_URL,
    authorization_servers: [AUTH_SERVER],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile'],
    resource_name: 'Finance MCP',
    resource_documentation: `${MCP_PUBLIC_URL}`,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // CORS-Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // RFC 9728 — Metadaten der geschützten Ressource, ohne Token erreichbar
  if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    if (req.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, OPTIONS' });
    }
    return protectedResourceMetadata();
  }

  if (req.method === 'GET') {
    // Kein SSE-Stream: der Server ist stateless. Clients, die GET zum
    // Öffnen eines Server-Streams nutzen, bekommen eine klare Absage.
    return json(
      {
        error: 'method_not_allowed',
        error_description:
          'Dieser MCP-Server arbeitet stateless über POST (Streamable HTTP). Es gibt keinen GET-Stream.',
      },
      405,
      { Allow: 'POST, OPTIONS' },
    );
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST, GET, OPTIONS' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json(
      {
        error: 'server_misconfigured',
        error_description: 'SUPABASE_URL oder SUPABASE_ANON_KEY fehlt in der Umgebung.',
      },
      500,
    );
  }

  // Token prüfen — wir machen das selbst, verify_jwt ist aus.
  let ctx: AuthContext;
  try {
    ctx = await verifyToken(req);
  } catch (e) {
    return unauthorized(e instanceof AuthError ? e.message : 'Token konnte nicht geprüft werden.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, 'Ungültiges JSON.'), 400);
  }

  // Einzelnachricht oder Batch
  if (Array.isArray(body)) {
    const responses: unknown[] = [];
    for (const item of body) {
      if (item && typeof item === 'object') {
        const r = await handleRpc(ctx, item as Record<string, unknown>);
        if (r !== null) responses.push(r);
      }
    }
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return json(responses);
  }

  if (!body || typeof body !== 'object') {
    return json(rpcError(null, -32600, 'Ungültige JSON-RPC-Nachricht.'), 400);
  }

  const response = await handleRpc(ctx, body as Record<string, unknown>);
  if (response === null) {
    // Notification — laut Spezifikation ohne Antwortkörper
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }
  return json(response);
});
