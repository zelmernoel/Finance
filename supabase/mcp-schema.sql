-- ============================================================
-- Finance — MCP-Zugriff (Claude über Supabase Edge Function)
--
-- Im Supabase SQL Editor in EINEM Stück ausführen. Idempotent:
-- mehrfaches Ausführen ist schadlos.
--
-- Voraussetzung: schema.sql, savings-pots.sql und fix-rls.sql
-- sind bereits gelaufen.
--
-- Verhaltensprüfung danach: supabase/mcp-verify.sql
-- (bewusst getrennt — ein Rollenwechsel in dieser Datei würde bei
--  jedem Fehlschlag eine ansonsten korrekte Migration zurückrollen).
--
-- Reihenfolge:
--   0. Rollen                (vor allen Grants)
--   1. Schemarechte
--   2. Spalten
--   3. mcp_clients
--   4. Funktionen            (vor den Policies, die sie verwenden)
--   5. Tabellen              (activity_log, transaction_notes)
--   6. Tabellen-Grants
--   7. Custom Access Token Hook
--   8. RLS-Policies
--   9. Trigger               (Protokollierung)
--  10. Katalogprüfung
--  11. Prüfliste (Kommentar)
--
-- ── Zielzustand der Rechte für Fremdclients (Claude) ────────
--
--   Lesen     alles
--   Anlegen   Transaktionen, Notizen, Sparttöpfe
--   Ändern    nichts
--   Löschen   nichts
--   Protokoll jede Änderung, egal von wem, Herkunft markiert
--
-- ── Sicherheitsmodell in zwei Schichten ─────────────────────
--
-- Schicht 1 (RLS, Abschnitt 8) — die tragende:
--   Ein Token mit client_id-Claim gilt als Fremdclient. Das
--   schliesst im Zweifel ZU: ein noch nicht eingetragener Client
--   hat keine Sonderrechte, sondern weniger.
--
-- Schicht 2 (Rolle mcp_agent, Abschnitte 0/6/7) — zusätzlich:
--   Ein Custom Access Token Hook schreibt den role-Claim auf
--   'mcp_agent' um. Diese Rolle hat nur die hier aufgeführten
--   Table-Grants und KEINE Default-Privileges. Eine künftig
--   angelegte Tabelle ist damit für sie automatisch dicht.
--
-- Schicht 2 ist optional und ersetzt Schicht 1 nicht.
--
-- ── Warum hier nirgends auth.uid() oder auth.jwt() steht ────
--
-- Beide liegen im Schema "auth", das supabase_admin gehört. Die
-- Rolle postgres kann dort keine Rechte vergeben — ein GRANT USAGE
-- ON SCHEMA auth an eine neue Rolle WARNT nur und bewirkt nichts.
-- Damit könnten weder mcp_fn_owner (Eigentümer der Definer-
-- Funktionen) noch mcp_agent die Policies auswerten.
--
-- Beide Funktionen lesen ohnehin nur current_setting('request.jwt.…'),
-- und current_setting liegt in pg_catalog — dafür braucht es kein
-- Schemarecht. public.jwt_claims() / public.jwt_user_id() bilden das
-- nach; public.jwt_user_id() ist zu auth.uid() semantisch identisch.
-- ============================================================


-- ============================================================
-- 0. ROLLEN
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_agent') THEN
    CREATE ROLE mcp_agent NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_fn_owner') THEN
    CREATE ROLE mcp_fn_owner NOLOGIN NOINHERIT;
  END IF;
END $$;

-- Damit PostgREST per SET ROLE in mcp_agent wechseln kann.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE 'GRANT mcp_agent TO authenticator';
  ELSE
    RAISE NOTICE 'Rolle "authenticator" nicht gefunden — Schicht 2 (Hook) bleibt wirkungslos, Schicht 1 (RLS) nicht.';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'GRANT mcp_agent TO authenticator nicht erlaubt — Schicht 2 (Hook) bleibt wirkungslos, Schicht 1 (RLS) nicht.';
END $$;

-- ALTER … OWNER TO in den Abschnitten 4 und 9 verlangt Mitgliedschaft
-- in der Zielrolle (seit PG16 vom Anlegen getrennt). Die Mitgliedschaft
-- in mcp_agent braucht ausserdem supabase/mcp-verify.sql, um das
-- Verhalten dieser Rolle überhaupt prüfen zu können.
DO $$
BEGIN
  EXECUTE format('GRANT mcp_fn_owner TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GRANT mcp_fn_owner TO % übersprungen (%).', current_user, SQLERRM;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT mcp_agent TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GRANT mcp_agent TO % übersprungen (%) — mcp-verify.sql kann diese Rolle dann nicht testen.', current_user, SQLERRM;
END $$;


-- ============================================================
-- 1. SCHEMARECHTE
--
-- Nur public. Auf "auth" wird bewusst nichts vergeben — siehe
-- Kopfkommentar; es wird auch nichts von dort benötigt.
-- ============================================================

GRANT USAGE ON SCHEMA public TO mcp_agent, mcp_fn_owner;


-- ============================================================
-- 2. SPALTEN
-- ============================================================

-- ── Herkunftsmarkierung auf transactions ────────────────────

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transactions_source_check'
       AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_source_check
      CHECK (source IN ('app', 'mcp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transactions_source
  ON public.transactions (user_id, budget_id, source);

-- ── NACHZIEHEN: settings.month_start ────────────────────────
-- Der Anwendungscode liest und schreibt settings.month_start
-- (src/lib/supabaseAdapter.ts), aber keine der bisherigen
-- .sql-Dateien legt die Spalte an — siehe SYSTEM-REPORT.md, 7.1.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS month_start integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'settings_month_start_check'
       AND conrelid = 'public.settings'::regclass
  ) THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_month_start_check
      CHECK (month_start IS NULL OR (month_start >= 1 AND month_start <= 28));
  END IF;
END $$;

-- ── Anzeige-Schalter für die KI-Badges ──────────────────────
-- Steuert NUR die Darstellung im Frontend. transactions.source
-- wird unabhängig davon immer geschrieben.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS show_ai_badges boolean NOT NULL DEFAULT true;

-- ── Darf Claude Sparttöpfe anlegen? ─────────────────────────
-- Ein neuer Topf mit Verteilungsanteil verändert, was mit KÜNFTIGEN
-- Einnahmen geschieht. Deshalb ein eigener Schalter statt einer
-- stillen Erlaubnis. Geprüft wird er zweifach: im Tool
-- create-savings-pot (mit klarer Fehlermeldung) und in der
-- INSERT-Policy auf savings_pots (Abschnitt 8), damit er sich
-- nicht am Tool vorbei umgehen lässt.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS mcp_allow_pot_creation boolean NOT NULL DEFAULT true;


-- ============================================================
-- 3. mcp_clients
--
-- Rolle dieser Tabelle: Beschriftung und Widerruf.
--
-- Sie entscheidet NICHT darüber, ob ein Token als Fremdclient gilt —
-- das tut allein der client_id-Claim (Abschnitt 4). Ein fehlender
-- Eintrag verschafft also keine zusätzlichen Rechte. Ein Eintrag
-- mit gesetztem revoked_at entzieht dagegen jeden Zugriff, ohne
-- dass eine Policy angefasst werden muss.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mcp_clients (
  client_id  text PRIMARY KEY,
  label      text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_clients
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE public.mcp_clients ENABLE ROW LEVEL SECURITY;

-- WICHTIG: RLS gilt auch für den Eigentümer einer SECURITY-DEFINER-
-- Funktion. Ohne die folgende Policy sähen is_revoked_client() und
-- log_activity() als mcp_fn_owner NULL Zeilen — ohne Fehler. Der
-- Widerruf wäre dann wirkungslos, und zwar still. Deshalb eine
-- ausdrückliche Lese-Policy nur für diese eine Rolle.
DROP POLICY IF EXISTS "mcp_clients: Widerrufspruefung" ON public.mcp_clients;
CREATE POLICY "mcp_clients: Widerrufspruefung" ON public.mcp_clients
  FOR SELECT TO mcp_fn_owner USING (true);

-- Keine weitere Policy und kein Grant an anon/authenticated/mcp_agent:
-- für die sichtbar ist diese Tabelle nicht. Pflege über SQL-Editor.


-- ============================================================
-- 4. FUNKTIONEN
--
-- Alle mit SET search_path = '' und vollständig qualifizierten
-- Objektnamen. Die Definer-Funktionen gehören mcp_fn_owner —
-- welche Rechte diese Rolle genau hat, steht in Abschnitt 6.
-- ============================================================

-- ── jwt_claims() — Ersatz für auth.jwt() ────────────────────
-- Bildet die Definition von auth.jwt() nach, ohne Abhängigkeit vom
-- Schema auth. SECURITY INVOKER: liest nur Sitzungsvariablen.

CREATE OR REPLACE FUNCTION public.jwt_claims()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim',  true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;

-- ── jwt_user_id() — Ersatz für auth.uid() ───────────────────
-- Semantisch identisch zu auth.uid().

CREATE OR REPLACE FUNCTION public.jwt_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    public.jwt_claims() ->> 'sub'
  )::uuid;
$$;

-- ── is_mcp_client() ─────────────────────────────────────────
-- Fail-closed: entscheidend ist allein, ob das Token einen
-- client_id-Claim trägt.
--
-- Belegt: Supabase dokumentiert, dass jedes Access-Token des
-- OAuth-2.1-Servers einen client_id-Claim enthält, und empfiehlt
-- selbst genau diese Unterscheidung für RLS
-- (docs/guides/auth/oauth-server/token-security).
-- Sessions aus signInWithPassword tragen den Claim nicht. Die App
-- verwendet ausschliesslich signInWithPassword/signUp — geprüft:
-- kein signInWithOAuth, kein exchangeCodeForSession, kein
-- signInWithIdToken.

CREATE OR REPLACE FUNCTION public.is_mcp_client()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(public.jwt_claims() ->> 'client_id', '') <> '';
$$;

-- ── is_revoked_client() ─────────────────────────────────────
-- nullif(…, '') sorgt dafür, dass App-Tokens (ohne Claim) nie
-- treffen: der Vergleich gegen NULL liefert kein Ergebnis.

CREATE OR REPLACE FUNCTION public.is_revoked_client()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.mcp_clients m
     WHERE m.client_id = nullif(public.jwt_claims() ->> 'client_id', '')
       AND m.revoked_at IS NOT NULL
  );
$$;

-- ── Eigentümerwechsel ───────────────────────────────────────
-- ALTER … OWNER TO verlangt Mitgliedschaft in der Zielrolle UND
-- CREATE auf dem Schema. Zweites nur für die Dauer der Übereignung,
-- in derselben Transaktion wieder entzogen.

DO $$
BEGIN
  EXECUTE 'GRANT CREATE ON SCHEMA public TO mcp_fn_owner';
  EXECUTE 'ALTER FUNCTION public.is_mcp_client()     OWNER TO mcp_fn_owner';
  EXECUTE 'ALTER FUNCTION public.is_revoked_client() OWNER TO mcp_fn_owner';
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM mcp_fn_owner';
EXCEPTION WHEN OTHERS THEN
  BEGIN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM mcp_fn_owner';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RAISE WARNING
    'Eigentümerwechsel auf mcp_fn_owner fehlgeschlagen (%). Die Funktionen laufen weiter unter %. Abschnitt 10 meldet das als Befund.',
    SQLERRM, current_user;
END $$;

-- ── EXECUTE-Rechte ──────────────────────────────────────────
-- Erst FROM PUBLIC — das deckt alle Rollen ab, die ihr Recht über
-- PUBLIC beziehen.
--
-- Danach zusätzlich die Rollen beim Namen: Supabase legt in
-- pg_default_acl EXECUTE für anon/authenticated/service_role auf
-- neue Funktionen in public an. Solche eigenen ACL-Einträge
-- überlebt ein REVOKE FROM PUBLIC unbemerkt.
--
-- Erst danach gezielt zurückgeben. Das ist zwingend: diese
-- Funktionen stehen in JEDER Policy aus Abschnitt 8. Fehlt einer
-- Rolle das EXECUTE, scheitert für sie jede Abfrage auf jede dieser
-- Tabellen mit "permission denied for function" — auch für die App.

REVOKE EXECUTE ON FUNCTION public.jwt_claims()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.jwt_user_id()       FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_mcp_client()     FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_revoked_client() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.jwt_claims()        TO anon, authenticated, mcp_agent, mcp_fn_owner;
GRANT EXECUTE ON FUNCTION public.jwt_user_id()       TO anon, authenticated, mcp_agent;
GRANT EXECUTE ON FUNCTION public.is_mcp_client()     TO anon, authenticated, mcp_agent;
GRANT EXECUTE ON FUNCTION public.is_revoked_client() TO anon, authenticated, mcp_agent;

-- Anmerkung zur Erreichbarkeit: alles in public ist über PostgREST
-- als RPC aufrufbar. Diese vier Funktionen berichten ausschliesslich
-- über das Token des Aufrufers selbst und geben keine fremden Daten
-- preis; die Erreichbarkeit ist deshalb unbedenklich und für die
-- Policy-Auswertung ohnehin unvermeidlich.


-- ============================================================
-- 5. TABELLEN
-- ============================================================

-- ── ai_log entfällt ─────────────────────────────────────────
-- Ersetzt durch activity_log: protokolliert wird jede Änderung,
-- nicht nur die von Claude. ai_log wurde nie gegen die Datenbank
-- ausgeführt, es gibt also nichts zu migrieren. Das DROP steht hier
-- nur für den Fall, dass eine frühere Fassung dieser Datei doch
-- schon einmal lief.

DROP TABLE IF EXISTS public.ai_log CASCADE;

-- ── activity_log ────────────────────────────────────────────
-- Append-only. Es gibt bewusst KEINE UPDATE- und KEINE
-- DELETE-Policy — auch die App kann Einträge nicht nachträglich
-- ändern oder entfernen.
--
-- Gefüllt aus zwei Quellen:
--   * Trigger (Abschnitt 9) für jede echte Datenänderung, egal ob
--     App oder Claude sie ausgelöst hat
--   * MCP-Server für Tool-Aufrufe (action = 'read'), damit auch
--     fehlgeschlagene Aufrufe sichtbar sind, bei denen gar keine
--     Änderung zustande kam

CREATE TABLE IF NOT EXISTS public.activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  budget_id     uuid,                                   -- Typ wie transactions.budget_id
  created_at    timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL CHECK (actor IN ('app', 'mcp')),
  client_label  text,
  entity        text NOT NULL,
  entity_id     text,
  action        text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'read')),
  before        jsonb,
  after         jsonb,
  tool          text,
  params        jsonb,
  status        text NOT NULL CHECK (status IN ('ok', 'error')),
  error_message text
);

CREATE INDEX IF NOT EXISTS activity_log_user_created
  ON public.activity_log (user_id, created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- ── transaction_notes ───────────────────────────────────────
-- Nur anhängen. Notizen sind unveränderlich: keine UPDATE- und
-- keine DELETE-Policy für irgendeine Rolle. Verschwinden können sie
-- nur mit ihrer Transaktion (FK-CASCADE).
--
-- transactions.note bleibt davon unberührt und behält seine
-- bisherige Funktion.

CREATE TABLE IF NOT EXISTS public.transaction_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  author         text NOT NULL CHECK (author IN ('app', 'mcp')),
  body           text NOT NULL CHECK (length(trim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS transaction_notes_tx_created
  ON public.transaction_notes (transaction_id, created_at);

ALTER TABLE public.transaction_notes ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 6. TABELLEN-GRANTS
--
-- Erst alles entziehen, dann gezielt vergeben: so bleibt die Liste
-- bei jedem erneuten Ausführen die vollständige Wahrheit.
--
-- Für mcp_agent werden AUSDRÜCKLICH KEINE Default-Privileges
-- angelegt. Eine künftig erzeugte Tabelle erhält damit keinerlei
-- Rechte für diese Rolle — anders als authenticated, das bei
-- Supabase über pg_default_acl automatisch arwdDxtm auf jede neue
-- Tabelle bekommt.
-- ============================================================

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM mcp_agent;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mcp_agent;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM mcp_agent;

-- Lesen auf allen Nutzertabellen
GRANT SELECT ON
  public.budgets,
  public.transactions,
  public.categories,
  public.settings,
  public.recurring_transactions,
  public.savings_pots,
  public.pot_allocations,
  public.activity_log,
  public.transaction_notes
TO mcp_agent;

-- Schreiben ausschliesslich hier — kein UPDATE, kein DELETE.
GRANT INSERT ON public.transactions      TO mcp_agent;
GRANT INSERT ON public.transaction_notes TO mcp_agent;
GRANT INSERT ON public.savings_pots      TO mcp_agent;
GRANT INSERT ON public.activity_log      TO mcp_agent;

-- Die Policy-Funktionen wieder freigeben (REVOKE ALL ON ALL
-- FUNCTIONS oben hat sie mit entzogen).
GRANT EXECUTE ON FUNCTION public.jwt_claims()        TO mcp_agent;
GRANT EXECUTE ON FUNCTION public.jwt_user_id()       TO mcp_agent;
GRANT EXECUTE ON FUNCTION public.is_mcp_client()     TO mcp_agent;
GRANT EXECUTE ON FUNCTION public.is_revoked_client() TO mcp_agent;

-- KEIN Grant auf public.mcp_clients für mcp_agent.


-- ── Append-only auch auf Grant-Ebene erzwingen ──────────────
-- Supabase vergibt über pg_default_acl an authenticated automatisch
-- arwdDxtm auf JEDE neue Tabelle — DELETE eingeschlossen. Für
-- activity_log und transaction_notes hält allein RLS dagegen (es gibt
-- dort keine UPDATE-/DELETE-Policy). Das reicht, ist aber nur eine
-- Schicht. Hier kommt die zweite dazu.
--
-- FROM PUBLIC deckt PUBLIC-Rechte ab, die Rollen zusätzlich beim
-- Namen — ihre eigenen ACL-Einträge aus den Default-Privileges
-- überlebt ein REVOKE FROM PUBLIC sonst unbemerkt.
--
-- service_role bleibt bewusst aussen vor: die Rolle umgeht RLS
-- ohnehin und wird für administrative Eingriffe gebraucht. Ebenso
-- der Tabelleneigentümer — gegen ihn lässt sich in Postgres nichts
-- ausrichten. "Append-only" gilt also für alle Wege, die die App und
-- Claude tatsächlich nehmen, nicht gegen einen Datenbank-Admin.
REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_log
  FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.transaction_notes
  FROM PUBLIC, anon, authenticated;


-- ── mcp_fn_owner ────────────────────────────────────────────
-- Der Definer-Kontext der drei Funktionen aus den Abschnitten 4
-- und 9. Bewusst so schmal wie möglich, aber nicht schmaler:
--
--   SELECT mcp_clients   Widerrufsprüfung und client_label
--   INSERT activity_log  der Protokoll-Trigger schreibt dorthin
--   SELECT auf die drei protokollierten Tabellen
--
-- Die dritte Zeile ist eine Zugabe gegenüber dem reinen Bedarf
-- und braucht eine Begründung: log_activity() ruft to_jsonb(OLD)
-- bzw. to_jsonb(NEW). Ob Postgres für einen Trigger-Record eine
-- Spaltenberechtigung prüft, ist nicht garantiert — für
-- Ganzzeilen-Verweise in Abfragen tut es das. Weil der Trigger
-- Fehler bewusst schluckt (er darf die auslösende Buchung nie
-- kippen), wäre ein fehlendes Recht hier NICHT sichtbar: das
-- Protokoll bliebe einfach leer. Die drei Lesrechte kosten nichts —
-- log_activity() ist ausschliesslich als Trigger erreichbar, EXECUTE
-- ist allen entzogen, und die Funktion nimmt keine Eingabe entgegen.
GRANT INSERT ON public.activity_log TO mcp_fn_owner;
GRANT SELECT ON public.mcp_clients  TO mcp_fn_owner;
GRANT SELECT ON
  public.transactions,
  public.transaction_notes,
  public.savings_pots
TO mcp_fn_owner;


-- ============================================================
-- 7. CUSTOM ACCESS TOKEN HOOK
--
-- Schreibt den role-Claim auf 'mcp_agent' um, sobald das Token
-- einen client_id-Claim trägt. Alle anderen Tokens werden
-- unverändert durchgereicht.
--
-- Belegt: Supabase dokumentiert "Custom Access Token Hooks are
-- triggered for ALL token issuance" und nennt client_id bzw.
-- authentication_method ausdrücklich als Unterscheidungsmerkmal
-- für OAuth-Flows.
--
-- ACHTUNG: Dieser Hook läuft bei JEDER Tokenausgabe, auch bei
-- normalen App-Logins. Er ist deshalb bewusst defensiv: bei jedem
-- Fehler wird das Event unverändert zurückgegeben, damit ein
-- Problem hier keine Anmeldung blockiert.
--
-- Die Funktion wird hier nur ANGELEGT. Aktiv wird sie erst durch
-- die Registrierung im Dashboard — siehe MCP-SETUP.md, Schritt 7.
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  cid    text;
BEGIN
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- client_id kann im claims-Objekt oder auf oberster Event-Ebene stehen.
  cid := coalesce(
    nullif(claims ->> 'client_id', ''),
    nullif(event  ->> 'client_id', ''),
    ''
  );

  IF cid <> '' THEN
    claims := jsonb_set(claims, '{role}', '"mcp_agent"'::jsonb, true);
    RETURN jsonb_set(event, '{claims}', claims, true);
  END IF;

  RETURN event;
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;

-- FROM PUBLIC deckt PUBLIC-Rechte ab; die Rollen zusätzlich beim
-- Namen, weil Supabase ihnen über pg_default_acl eigene
-- ACL-Einträge auf neue Funktionen in public gibt. Ohne die
-- namentliche Nennung bliebe der Hook als PostgREST-RPC unter
-- /rest/v1/rpc/custom_access_token_hook für anon erreichbar.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO supabase_auth_admin';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Grants für supabase_auth_admin übersprungen (%). Ohne sie lässt sich der Hook nicht registrieren.', SQLERRM;
END $$;


-- ============================================================
-- 8. RLS-POLICIES
--
-- Ausgangslage (schema.sql / savings-pots.sql / fix-rls.sql):
-- je Tabelle EINE Policy "FOR ALL USING (auth.uid() = user_id)
-- WITH CHECK (auth.uid() = user_id)".
--
-- Zwei Änderungen daran:
--
-- 1. Aufteilung. Eine FOR-ALL-Policy kann für SELECT, INSERT,
--    UPDATE und DELETE keine unterschiedlichen Bedingungen tragen.
--
-- 2. auth.uid() → public.jwt_user_id(). Semantisch identisch, aber
--    ohne Abhängigkeit vom Schema auth, auf dem postgres keine
--    Rechte vergeben kann. Ohne diesen Tausch könnte die Rolle
--    mcp_agent die Policies gar nicht auswerten.
--
-- Ergänzt wird:
--   SELECT  : AND NOT public.is_revoked_client()
--   INSERT  : AND NOT public.is_mcp_client()
--             (Ausnahmen: transactions, transaction_notes,
--              savings_pots, activity_log)
--   UPDATE  : AND NOT public.is_mcp_client()
--   DELETE  : AND NOT public.is_mcp_client()
--
-- Für normale App-Nutzer ändert sich nichts: deren Token trägt
-- keinen client_id-Claim, beide Prüfungen sind false.
--
-- Abweichung vom Auftrag, bewusst: is_revoked_client() steht auch
-- in jeder INSERT-Policy, die Fremdclients offensteht. Stünde es
-- nur in den SELECT-Policies, könnte ein widerrufener Client
-- weiterhin schreiben — der Widerruf wäre dann kein Widerruf.
-- ============================================================

-- ── transactions ────────────────────────────────────────────
DROP POLICY IF EXISTS "Eigene Transaktionen"   ON public.transactions;
DROP POLICY IF EXISTS "Transaktionen lesen"    ON public.transactions;
DROP POLICY IF EXISTS "Transaktionen anlegen"  ON public.transactions;
DROP POLICY IF EXISTS "Transaktionen aendern"  ON public.transactions;
DROP POLICY IF EXISTS "Transaktionen loeschen" ON public.transactions;

CREATE POLICY "Transaktionen lesen" ON public.transactions
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

-- Fremdclients dürfen anlegen, aber nur mit source = 'mcp'.
CREATE POLICY "Transaktionen anlegen" ON public.transactions
  FOR INSERT WITH CHECK (
    public.jwt_user_id() = user_id
    AND NOT public.is_revoked_client()
    AND (NOT public.is_mcp_client() OR source = 'mcp')
  );

CREATE POLICY "Transaktionen aendern" ON public.transactions
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Transaktionen loeschen" ON public.transactions
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── categories ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Eigene Kategorien"   ON public.categories;
DROP POLICY IF EXISTS "Kategorien lesen"    ON public.categories;
DROP POLICY IF EXISTS "Kategorien anlegen"  ON public.categories;
DROP POLICY IF EXISTS "Kategorien aendern"  ON public.categories;
DROP POLICY IF EXISTS "Kategorien loeschen" ON public.categories;

CREATE POLICY "Kategorien lesen" ON public.categories
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

CREATE POLICY "Kategorien anlegen" ON public.categories
  FOR INSERT WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Kategorien aendern" ON public.categories
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Kategorien loeschen" ON public.categories
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── budgets ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Eigene Budgets"   ON public.budgets;
DROP POLICY IF EXISTS "Budgets lesen"    ON public.budgets;
DROP POLICY IF EXISTS "Budgets anlegen"  ON public.budgets;
DROP POLICY IF EXISTS "Budgets aendern"  ON public.budgets;
DROP POLICY IF EXISTS "Budgets loeschen" ON public.budgets;

CREATE POLICY "Budgets lesen" ON public.budgets
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

CREATE POLICY "Budgets anlegen" ON public.budgets
  FOR INSERT WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Budgets aendern" ON public.budgets
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Budgets loeschen" ON public.budgets
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── settings ────────────────────────────────────────────────
-- Achtung: die App schreibt Settings per upsert. Ein upsert braucht
-- INSERT- UND UPDATE-Rechte, deshalb müssen beide Policies stehen.
-- DELETE bleibt nötig, weil die App beim Start verwaiste Settings
-- ohne budget_id abräumt.
DROP POLICY IF EXISTS "Eigene Settings"   ON public.settings;
DROP POLICY IF EXISTS "Settings lesen"    ON public.settings;
DROP POLICY IF EXISTS "Settings anlegen"  ON public.settings;
DROP POLICY IF EXISTS "Settings aendern"  ON public.settings;
DROP POLICY IF EXISTS "Settings loeschen" ON public.settings;

CREATE POLICY "Settings lesen" ON public.settings
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

CREATE POLICY "Settings anlegen" ON public.settings
  FOR INSERT WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Settings aendern" ON public.settings
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Settings loeschen" ON public.settings
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── recurring_transactions ──────────────────────────────────
DROP POLICY IF EXISTS "Eigene Dauerauftraege"   ON public.recurring_transactions;
DROP POLICY IF EXISTS "Dauerauftraege lesen"    ON public.recurring_transactions;
DROP POLICY IF EXISTS "Dauerauftraege anlegen"  ON public.recurring_transactions;
DROP POLICY IF EXISTS "Dauerauftraege aendern"  ON public.recurring_transactions;
DROP POLICY IF EXISTS "Dauerauftraege loeschen" ON public.recurring_transactions;

CREATE POLICY "Dauerauftraege lesen" ON public.recurring_transactions
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

CREATE POLICY "Dauerauftraege anlegen" ON public.recurring_transactions
  FOR INSERT WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Dauerauftraege aendern" ON public.recurring_transactions
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Dauerauftraege loeschen" ON public.recurring_transactions
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── savings_pots ────────────────────────────────────────────
-- Fremdclients dürfen Töpfe ANLEGEN, aber nur wenn
-- settings.mcp_allow_pot_creation für dieses Budget true ist.
-- Die Bedingung steht hier zusätzlich zur Prüfung im Tool, damit
-- sie sich nicht am Tool vorbei umgehen lässt.
--
-- Ändern und Löschen bleiben der App vorbehalten. Die
-- Trigger-Funktionen aus savings-pots.sql laufen als SECURITY
-- DEFINER und werden von diesen Policies nicht berührt: die
-- automatische Verteilung einer MCP-Einnahme funktioniert weiterhin.
-- Siehe MCP-SETUP.md, Abschnitt "Indirekte Effekte".
DROP POLICY IF EXISTS "Eigene Sparttöpfe"   ON public.savings_pots;
DROP POLICY IF EXISTS "Sparttöpfe lesen"    ON public.savings_pots;
DROP POLICY IF EXISTS "Sparttöpfe anlegen"  ON public.savings_pots;
DROP POLICY IF EXISTS "Sparttöpfe aendern"  ON public.savings_pots;
DROP POLICY IF EXISTS "Sparttöpfe loeschen" ON public.savings_pots;

CREATE POLICY "Sparttöpfe lesen" ON public.savings_pots
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

CREATE POLICY "Sparttöpfe anlegen" ON public.savings_pots
  FOR INSERT WITH CHECK (
    public.jwt_user_id() = user_id
    AND NOT public.is_revoked_client()
    AND (
      NOT public.is_mcp_client()
      OR EXISTS (
        SELECT 1
          FROM public.settings s
         WHERE s.user_id   = savings_pots.user_id
           AND s.budget_id = savings_pots.budget_id
           AND s.mcp_allow_pot_creation
      )
    )
  );

CREATE POLICY "Sparttöpfe aendern" ON public.savings_pots
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Sparttöpfe loeschen" ON public.savings_pots
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── pot_allocations ─────────────────────────────────────────
-- Wird ausschliesslich von Triggern befüllt (SECURITY DEFINER,
-- daher von RLS nicht betroffen). Für Clients hier trotzdem
-- konsequent gesperrt.
DROP POLICY IF EXISTS "Eigene Pot-Zuweisungen"   ON public.pot_allocations;
DROP POLICY IF EXISTS "Pot-Zuweisungen lesen"    ON public.pot_allocations;
DROP POLICY IF EXISTS "Pot-Zuweisungen anlegen"  ON public.pot_allocations;
DROP POLICY IF EXISTS "Pot-Zuweisungen aendern"  ON public.pot_allocations;
DROP POLICY IF EXISTS "Pot-Zuweisungen loeschen" ON public.pot_allocations;

CREATE POLICY "Pot-Zuweisungen lesen" ON public.pot_allocations
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

CREATE POLICY "Pot-Zuweisungen anlegen" ON public.pot_allocations
  FOR INSERT WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Pot-Zuweisungen aendern" ON public.pot_allocations
  FOR UPDATE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client())
           WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());

CREATE POLICY "Pot-Zuweisungen loeschen" ON public.pot_allocations
  FOR DELETE USING (public.jwt_user_id() = user_id AND NOT public.is_mcp_client());


-- ── transaction_notes ───────────────────────────────────────
DROP POLICY IF EXISTS "Notizen lesen"   ON public.transaction_notes;
DROP POLICY IF EXISTS "Notizen anlegen" ON public.transaction_notes;

CREATE POLICY "Notizen lesen" ON public.transaction_notes
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

-- Wie bei transactions: Fremdclients dürfen anhängen, aber nur mit
-- korrekter Herkunftsmarkierung.
CREATE POLICY "Notizen anlegen" ON public.transaction_notes
  FOR INSERT WITH CHECK (
    public.jwt_user_id() = user_id
    AND NOT public.is_revoked_client()
    AND (NOT public.is_mcp_client() OR author = 'mcp')
  );

-- Kein UPDATE, kein DELETE — Notizen sind unveränderlich. Sie
-- verschwinden nur mit ihrer Transaktion (FK-CASCADE).


-- ── activity_log ────────────────────────────────────────────
DROP POLICY IF EXISTS "activity_log lesen"           ON public.activity_log;
DROP POLICY IF EXISTS "activity_log anlegen"         ON public.activity_log;
DROP POLICY IF EXISTS "activity_log Trigger-Eintrag" ON public.activity_log;

CREATE POLICY "activity_log lesen" ON public.activity_log
  FOR SELECT USING (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

-- Bewusst auch für Fremdclients erlaubt — der MCP-Server
-- protokolliert jeden Tool-Aufruf selbst. Nicht mehr erlaubt,
-- sobald der Client widerrufen ist.
CREATE POLICY "activity_log anlegen" ON public.activity_log
  FOR INSERT WITH CHECK (public.jwt_user_id() = user_id AND NOT public.is_revoked_client());

-- Dieselbe Falle wie bei mcp_clients in Abschnitt 3: RLS gilt auch
-- für den Eigentümer einer SECURITY-DEFINER-Funktion. Ohne diese
-- Policy könnte der Protokoll-Trigger aus Abschnitt 9 nichts
-- schreiben — und weil er Fehler bewusst schluckt, wäre das Log
-- still leer. Deshalb eine eigene Policy nur für diese Rolle.
CREATE POLICY "activity_log Trigger-Eintrag" ON public.activity_log
  FOR INSERT TO mcp_fn_owner WITH CHECK (true);

-- Kein UPDATE, kein DELETE — für niemanden.


-- ============================================================
-- 9. TRIGGER — PROTOKOLLIERUNG
--
-- Erfasst jede Änderung an transactions, transaction_notes und
-- savings_pots, unabhängig davon, wer sie ausgelöst hat. Damit
-- stehen App-Änderungen und Löschungen im selben Protokoll wie
-- die Zugriffe von Claude.
--
-- Der Trigger darf die auslösende Operation NIE zum Scheitern
-- bringen. Jeder Fehler beim Protokollieren wird deshalb gefangen
-- und als NOTICE ausgegeben.
--
-- Die Kehrseite dieser Entscheidung: ein fehlendes Recht bliebe
-- unbemerkt, das Protokoll einfach leer. Abschnitt 10 prüft die
-- Rechte im Katalog, supabase/mcp-verify.sql schreibt zusätzlich
-- probeweise als mcp_fn_owner in activity_log.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_before    jsonb;
  v_after     jsonb;
  v_user      uuid;
  v_budget    uuid;
  v_entity_id text;
  v_actor     text;
  v_label     text;
  v_client    text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_before := pg_catalog.to_jsonb(OLD);
    v_after  := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_before := NULL;
    v_after  := pg_catalog.to_jsonb(NEW);
  ELSE
    v_before := pg_catalog.to_jsonb(OLD);
    v_after  := pg_catalog.to_jsonb(NEW);
  END IF;

  v_user      := coalesce(v_after ->> 'user_id', v_before ->> 'user_id')::uuid;
  -- transaction_notes hat keine budget_id; dann bleibt sie NULL.
  v_budget    := nullif(coalesce(v_after ->> 'budget_id', v_before ->> 'budget_id'), '')::uuid;
  v_entity_id := coalesce(v_after ->> 'id', v_before ->> 'id');

  v_client := nullif(public.jwt_claims() ->> 'client_id', '');
  IF v_client IS NOT NULL THEN
    v_actor := 'mcp';
    SELECT m.label INTO v_label
      FROM public.mcp_clients m
     WHERE m.client_id = v_client;
  ELSE
    v_actor := 'app';
  END IF;

  INSERT INTO public.activity_log
    (user_id, budget_id, actor, client_label, entity, entity_id,
     action, before, after, status)
  VALUES
    (v_user, v_budget, v_actor, v_label, TG_TABLE_NAME, v_entity_id,
     lower(TG_OP), v_before, v_after, 'ok');

  RETURN NULL;   -- AFTER-Trigger: Rückgabewert wird verworfen
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'activity_log: Eintrag fuer %.% fehlgeschlagen: %',
    TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN NULL;
END;
$fn$;

-- Trigger anlegen, BEVOR die Rechte an der Funktion beschnitten
-- werden: CREATE TRIGGER prüft EXECUTE auf die Funktion, das Feuern
-- später nicht mehr.

DROP TRIGGER IF EXISTS trg_log_transactions ON public.transactions;
CREATE TRIGGER trg_log_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_log_transaction_notes ON public.transaction_notes;
CREATE TRIGGER trg_log_transaction_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.transaction_notes
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- Hinweis zur Menge: savings_pots wird auch vom Trigger
-- trg_sync_pot_amount (savings-pots.sql) angefasst — jede
-- Einnahme-Verteilung erzeugt hier also eine UPDATE-Zeile je
-- befülltem Topf. Das ist gewollt (jede Änderung wird
-- protokolliert), macht das Log bei vielen Töpfen aber gesprächig.
DROP TRIGGER IF EXISTS trg_log_savings_pots ON public.savings_pots;
CREATE TRIGGER trg_log_savings_pots
  AFTER INSERT OR UPDATE OR DELETE ON public.savings_pots
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- Eigentümer und Rechte, nach demselben Muster wie Abschnitt 4.
DO $$
BEGIN
  EXECUTE 'GRANT CREATE ON SCHEMA public TO mcp_fn_owner';
  EXECUTE 'ALTER FUNCTION public.log_activity() OWNER TO mcp_fn_owner';
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM mcp_fn_owner';
EXCEPTION WHEN OTHERS THEN
  BEGIN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM mcp_fn_owner';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RAISE WARNING
    'Eigentuemerwechsel von log_activity() auf mcp_fn_owner fehlgeschlagen (%). Der Trigger laeuft dann unter % — er funktioniert, ist aber weiter gefasst als noetig.',
    SQLERRM, current_user;
END $$;

-- Eine Trigger-Funktion ist über PostgREST nicht als RPC aufrufbar;
-- der Entzug erfolgt der Vollständigkeit halber und schadet dem
-- Feuern des Triggers nicht.
REVOKE EXECUTE ON FUNCTION public.log_activity()
  FROM PUBLIC, anon, authenticated, service_role;


-- ============================================================
-- 10. KATALOGPRÜFUNG
--
-- Prüft, was diese Migration im Katalog hinterlassen hat.
-- Bewusst OHNE Rollenwechsel: ein SET ROLE hier würde bei jedem
-- Fehlschlag eine ansonsten korrekte Migration zurückrollen.
-- Das Verhalten anderer Rollen prüft supabase/mcp-verify.sql.
--
-- Die Mengen kommen aus dem Katalog, nicht aus der Liste, mit der
-- oben angelegt wurde — sonst würde die Prüfung nur die eigene
-- Annahme bestätigen. Gefragt wird nach ABWESENHEIT ("gibt es ein
-- Objekt ohne Sperre"), und es werden ALLE Befunde gesammelt, nicht
-- nur der erste.
-- ============================================================

DO $$
DECLARE
  befunde text[] := '{}';
  r       record;
  erlaubt_insert text[] := ARRAY['transactions', 'transaction_notes', 'savings_pots', 'activity_log'];
  append_only    text[] := ARRAY['activity_log', 'transaction_notes'];
BEGIN
  -- (a) Policy-Funktionen müssen für die App-Rollen ausführbar sein.
  --     Fehlt das, ist JEDE Tabelle unbenutzbar.
  FOR r IN
    SELECT rolle, fn
      FROM unnest(ARRAY['anon','authenticated']) AS rolle,
           unnest(ARRAY['public.jwt_user_id()','public.is_mcp_client()','public.is_revoked_client()']) AS fn
  LOOP
    IF NOT has_function_privilege(r.rolle, r.fn, 'EXECUTE') THEN
      befunde := befunde || format('%s fehlt EXECUTE auf %s — jede Abfrage auf jede Nutzertabelle würde scheitern.', r.rolle, r.fn);
    END IF;
  END LOOP;

  -- (b) Der Hook darf für Client-Rollen NICHT erreichbar sein.
  FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role']) AS rolle
  LOOP
    IF has_function_privilege(r.rolle, 'public.custom_access_token_hook(jsonb)', 'EXECUTE') THEN
      befunde := befunde || format('%s hat noch EXECUTE auf custom_access_token_hook — als PostgREST-RPC erreichbar.', r.rolle);
    END IF;
  END LOOP;

  -- (c) mcp_agent darf nirgends in public ändern oder löschen.
  --     Menge aus pg_class, nicht aus der Anlage-Liste.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (has_table_privilege('mcp_agent', c.oid, 'UPDATE')
         OR has_table_privilege('mcp_agent', c.oid, 'DELETE')
         OR has_table_privilege('mcp_agent', c.oid, 'TRUNCATE'))
  LOOP
    befunde := befunde || format('mcp_agent hat UPDATE/DELETE/TRUNCATE auf public.%I.', r.relname);
  END LOOP;

  -- (d) mcp_agent darf nur in den vier erlaubten Tabellen einfügen.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND has_table_privilege('mcp_agent', c.oid, 'INSERT')
       AND NOT (c.relname = ANY (erlaubt_insert))
  LOOP
    befunde := befunde || format('mcp_agent hat INSERT auf public.%I — erlaubt sind nur %s.',
                                 r.relname, array_to_string(erlaubt_insert, ', '));
  END LOOP;

  -- (e) mcp_agent darf mcp_clients nicht einmal lesen.
  IF has_table_privilege('mcp_agent', 'public.mcp_clients', 'SELECT') THEN
    befunde := befunde || 'mcp_agent kann public.mcp_clients lesen.';
  END IF;

  -- (f) mcp_fn_owner darf NICHT schreiben ausser in activity_log.
  --     Absenzprüfung über den Katalog.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (has_table_privilege('mcp_fn_owner', c.oid, 'UPDATE')
         OR has_table_privilege('mcp_fn_owner', c.oid, 'DELETE')
         OR (has_table_privilege('mcp_fn_owner', c.oid, 'INSERT') AND c.relname <> 'activity_log'))
  LOOP
    befunde := befunde || format('mcp_fn_owner hat Schreibrechte auf public.%I — der Definer-Kontext soll nur activity_log beschreiben.', r.relname);
  END LOOP;

  -- (g) Der Definer-Kontext muss mcp_clients wirklich sehen können:
  --     Tabellenrecht UND Policy. Fehlt eines, liefert
  --     is_revoked_client() still false und der Widerruf wirkt nicht.
  IF NOT has_table_privilege('mcp_fn_owner', 'public.mcp_clients', 'SELECT') THEN
    befunde := befunde || 'mcp_fn_owner fehlt SELECT auf mcp_clients — Widerruf würde still wirkungslos bleiben.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='mcp_clients'
       AND cmd='SELECT' AND 'mcp_fn_owner' = ANY (roles)
  ) THEN
    befunde := befunde || 'Auf mcp_clients fehlt die SELECT-Policy für mcp_fn_owner — RLS gilt auch für den Definer-Eigentümer, der Widerruf bliebe still wirkungslos.';
  END IF;

  -- (h) Dasselbe für den Protokoll-Trigger: Grant UND Policy auf
  --     activity_log. Fehlt eines, bleibt das Log still leer, weil
  --     log_activity() Fehler bewusst schluckt.
  IF NOT has_table_privilege('mcp_fn_owner', 'public.activity_log', 'INSERT') THEN
    befunde := befunde || 'mcp_fn_owner fehlt INSERT auf activity_log — das Protokoll bliebe still leer.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='activity_log'
       AND cmd='INSERT' AND 'mcp_fn_owner' = ANY (roles)
  ) THEN
    befunde := befunde || 'Auf activity_log fehlt die INSERT-Policy für mcp_fn_owner — das Protokoll bliebe still leer.';
  END IF;

  -- (i) activity_log und transaction_notes sind append-only:
  --     für KEINE Rolle darf es eine UPDATE- oder DELETE-Policy geben.
  FOR r IN
    SELECT p.tablename, p.policyname, p.cmd
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = ANY (append_only)
       AND p.cmd IN ('UPDATE', 'DELETE', 'ALL')
  LOOP
    befunde := befunde || format('public.%s hat die Policy "%s" (%s) — die Tabelle soll append-only sein.',
                                 r.tablename, r.policyname, r.cmd);
  END LOOP;

  -- (j) Auch die Table-Grants müssen append-only sein.
  --     Ausgenommen: Tabelleneigentümer und service_role — siehe
  --     Begründung bei den REVOKEs in Abschnitt 6. Diese Prüfung
  --     fängt genau den Fall, dass Supabase über pg_default_acl
  --     erneut arwdDxtm an authenticated vergeben hat.
  FOR r IN
    SELECT g.table_name, g.grantee, g.privilege_type
      FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public'
       AND g.table_name = ANY (append_only)
       AND g.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
       AND g.grantee NOT IN ('postgres', 'supabase_admin', 'service_role', current_user)
  LOOP
    befunde := befunde || format('%s hat %s auf public.%s — die Tabelle soll append-only sein.',
                                 r.grantee, r.privilege_type, r.table_name);
  END LOOP;

  -- (k) Gibt es eine Tabelle, in die MCP schreiben darf, aber ohne
  --     Protokoll-Trigger? Menge aus dem Katalog, nicht aus der
  --     Liste, mit der die Trigger angelegt wurden.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND has_table_privilege('mcp_agent', c.oid, 'INSERT')
       AND c.relname <> 'activity_log'          -- das Log protokolliert sich nicht selbst
       AND NOT EXISTS (
             SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = c.oid
                AND NOT t.tgisinternal
                AND t.tgfoid = 'public.log_activity()'::regprocedure)
  LOOP
    befunde := befunde || format('public.%I ist für MCP beschreibbar, hat aber keinen Protokoll-Trigger.', r.relname);
  END LOOP;

  -- (l) Jede Nutzertabelle mit RLS braucht mindestens eine Policy.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname='public' AND p.tablename=c.relname)
  LOOP
    befunde := befunde || format('public.%I hat RLS aktiv, aber keine einzige Policy — für alle Rollen unsichtbar.', r.relname);
  END LOOP;

  -- (m) Eigentümerwechsel der Definer-Funktionen (nur Hinweis).
  FOR r IN
    SELECT p.proname, pg_get_userbyid(p.proowner) AS owner
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('is_mcp_client','is_revoked_client','log_activity')
       AND pg_get_userbyid(p.proowner) <> 'mcp_fn_owner'
  LOOP
    RAISE WARNING 'Hinweis: public.%() gehört noch % statt mcp_fn_owner. Funktioniert, ist aber weniger eng gefasst.', r.proname, r.owner;
  END LOOP;

  -- (n) Bestandsaufnahme: SECURITY DEFINER ohne gesetzten search_path.
  --     Nur melden, nichts ändern — siehe MCP-SETUP.md, Inventar.
  FOR r IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND (p.proconfig IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search\_path=%'))
  LOOP
    RAISE WARNING 'Bestandsaufnahme: public.%() ist SECURITY DEFINER ohne search_path.', r.proname;
  END LOOP;

  IF array_length(befunde, 1) > 0 THEN
    RAISE EXCEPTION E'Katalogprüfung fehlgeschlagen, Migration zurückgerollt:\n  - %',
      array_to_string(befunde, E'\n  - ');
  END IF;

  RAISE NOTICE 'Katalogprüfung bestanden. Verhaltensprüfung jetzt mit supabase/mcp-verify.sql.';
END $$;


-- ============================================================
-- 11. PRÜFLISTE
-- ============================================================
--
-- ── Wer ist wer ─────────────────────────────────────────────
--
--   authenticated  Normale App-Session (signInWithPassword).
--                  Token OHNE client_id-Claim.
--                  is_mcp_client() = false, is_revoked_client() = false.
--
--   mcp_agent      Fremdclient (OAuth 2.1), sofern der Hook aus
--                  Abschnitt 7 registriert ist. Token MIT client_id.
--                  Ohne Hook bleibt die Rolle 'authenticated' —
--                  die RLS-Bedingungen greifen trotzdem.
--
--   mcp_fn_owner   Eigentümer der drei Definer-Funktionen. Keine
--                  Anmeldung, kein UPDATE, kein DELETE, nirgends.
--
-- ── Tabellenrechte ──────────────────────────────────────────
--
--   Tabelle                   authenticated   mcp_agent                mcp_fn_owner
--   ------------------------- --------------- ------------------------ ------------
--   budgets                   S I U D         S                        —
--   transactions              S I U D         S I (nur source='mcp')   S
--   categories                S I U D         S                        —
--   settings                  S I U D         S                        —
--   recurring_transactions    S I U D         S                        —
--   savings_pots              S I U D         S I (nur wenn erlaubt)   S
--   pot_allocations           S I U D         S                        —
--   transaction_notes         S I             S I (nur author='mcp')   S
--   activity_log              S I             S I                      I
--   mcp_clients               —               —                        S
--
--   S=SELECT I=INSERT U=UPDATE D=DELETE
--   Die Spalten nennen Table-Grant UND Policy-Ergebnis; beides muss
--   zutreffen, damit eine Operation gelingt.
--   "nur wenn erlaubt" = settings.mcp_allow_pot_creation ist true.
--   Für mcp_agent existieren KEINE Default-Privileges: eine neue
--   Tabelle ist für diese Rolle automatisch dicht. authenticated
--   bekommt dagegen über pg_default_acl automatisch arwdDxtm.
--   mcp_fn_owner liest die drei protokollierten Tabellen nur, damit
--   to_jsonb(OLD/NEW) im Trigger sicher funktioniert (Abschnitt 6).
--
--   transaction_notes und activity_log haben für NIEMANDEN eine
--   UPDATE- oder DELETE-Policy — auch nicht für die App.
--
-- ── Funktionsrechte ─────────────────────────────────────────
--
--   Funktion                      anon  authenticated  mcp_agent  supabase_auth_admin
--   ----------------------------- ----- -------------- ---------- -------------------
--   jwt_claims()                  X     X              X          —
--   jwt_user_id()                 X     X              X          —
--   is_mcp_client()               X     X              X          —
--   is_revoked_client()           X     X              X          —
--   log_activity()                —     —              —          —   (nur als Trigger)
--   custom_access_token_hook()    —     —              —          X
--
--   Die ersten vier MÜSSEN für anon und authenticated ausführbar
--   sein: sie stehen in jeder Policy.
--
-- ── Policies je Tabelle ─────────────────────────────────────
--
-- transactions
--   lesen     SELECT — eigene Zeilen, ausser der Client ist widerrufen.
--   anlegen   INSERT — App beliebig; Fremdclient nur mit source='mcp'.
--   aendern   UPDATE — nur die App.
--   loeschen  DELETE — nur die App.
--
-- savings_pots
--   lesen     SELECT — eigene Zeilen, ausser widerrufen.
--   anlegen   INSERT — App beliebig; Fremdclient nur bei
--                      settings.mcp_allow_pot_creation = true.
--   aendern   UPDATE — nur die App.
--   loeschen  DELETE — nur die App.
--
-- categories / budgets / settings / recurring_transactions /
-- pot_allocations
--   lesen     SELECT — eigene Zeilen, ausser widerrufen.
--   anlegen   INSERT — nur die App.
--   aendern   UPDATE — nur die App.
--   loeschen  DELETE — nur die App.
--
-- transaction_notes
--   "Notizen lesen"    SELECT — eigene Notizen, ausser widerrufen.
--   "Notizen anlegen"  INSERT — App beliebig; Fremdclient nur mit author='mcp'.
--   —                  UPDATE — keine Policy: unveränderlich.
--   —                  DELETE — keine Policy: nur via FK-CASCADE.
--
-- activity_log
--   "activity_log lesen"            SELECT — eigenes Protokoll, ausser widerrufen.
--   "activity_log anlegen"          INSERT — App und Fremdclient (Tool-Aufrufe).
--   "activity_log Trigger-Eintrag"  INSERT — nur mcp_fn_owner (der Trigger).
--   —                               UPDATE — keine Policy: niemand darf ändern.
--   —                               DELETE — keine Policy: niemand darf löschen.
--
-- mcp_clients
--   "mcp_clients: Widerrufspruefung"
--                     SELECT — ausschliesslich TO mcp_fn_owner.
--   —                 sonst nichts: anon, authenticated und mcp_agent
--                     sehen die Tabelle nicht.
--
-- ── Trigger ─────────────────────────────────────────────────
--
--   trg_log_transactions       AFTER I/U/D auf transactions
--   trg_log_transaction_notes  AFTER I/U/D auf transaction_notes
--   trg_log_savings_pots       AFTER I/U/D auf savings_pots
--   alle → public.log_activity() → activity_log
--
-- ── Zugriff abschalten ──────────────────────────────────────
--
--   UPDATE public.mcp_clients SET revoked_at = now() WHERE client_id = '<ID>';
--
--   Wirkt sofort auf alle SELECT-Policies und auf jede
--   INSERT-Policy, die Fremdclients offensteht.
--
--   Rückgängig:
--   UPDATE public.mcp_clients SET revoked_at = NULL WHERE client_id = '<ID>';
--
-- ============================================================
