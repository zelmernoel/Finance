-- ============================================================
-- Finance — Verhaltensprüfung des MCP-Zugriffs
--
-- NACH supabase/mcp-schema.sql im SQL Editor ausführen.
--
-- ── Vor dem Ausführen lesen ─────────────────────────────────
--
-- 1. DIE DATEI SCHREIBT NICHTS FEST.
--    Alles steht zwischen BEGIN (unten) und ROLLBACK (ganz am
--    Dateiende). Am Schluss wird die Transaktion grundsätzlich
--    zurückgerollt — auch wenn alle Prüfungen bestehen. Die
--    Ergebnis-Abfragen laufen VOR dem ROLLBACK, die Ausgabe
--    bleibt also sichtbar.
--
--    Damit sind auch die drei Probeschreibungen folgenlos:
--    je eine Zeile in mcp_clients (Prüfung 5/6) und in
--    activity_log (Prüfung 17). Beide werden ohnehin im Skript
--    wieder gelöscht; der ROLLBACK ist das zweite Netz.
--
-- 2. SUPABASE WARNT — beides erwartbar:
--
--    "destructive operation"  Ausgelöst von DROP/DELETE/UPDATE
--                             weiter unten. Alle wirken
--                             ausschliesslich auf die eigenen
--                             Probezeilen, erkennbar an den
--                             Markern '__mcp_verify_probe__' und
--                             '__verify_probe__'. transactions,
--                             settings und budgets werden nirgends
--                             beschrieben.
--
--    "Tabelle mcp_check ohne Row Level Security"
--                             Fehlalarm. mcp_check ist eine
--                             TEMP-Tabelle im sitzungsprivaten
--                             Schema pg_temp. Für anon und
--                             authenticated ist sie grundsätzlich
--                             nicht erreichbar — die laufen auf
--                             anderen Verbindungen und sehen
--                             fremde Temp-Schemata nicht. RLS ist
--                             dort weder möglich noch nötig. Sie
--                             enthält nur Prüfergebnisse, keine
--                             Finanzdaten.
--
--    Im Bestätigungsdialog also durchlaufen lassen, nicht
--    abbrechen. (Bricht man ab, ist ebenfalls nichts passiert.)
--
-- 3. ERGEBNIS: zwei Tabellen am Ende. Jede Zeile mit
--    ">>> BEFUND <<<" ist ein Problem; erwartet ist befunde = 0.
--    Die Prüfungen sind so formuliert, dass sie fehlschlagen
--    KÖNNEN — mehrere erwarten ausdrücklich, dass etwas NICHT geht.
--
-- ── Warum getrennt von der Migration ────────────────────────
--
-- Diese Datei wechselt Rollen und simuliert Tokens. Ein Fehlschlag
-- hier soll die Migration NICHT zurückrollen — sie kann korrekt
-- sein, während eine Rolle unerwartet konfiguriert ist.
--
-- ── Lücken in der Nummerierung ──────────────────────────────
--
-- Die Nummern 9 und 18 fehlen bewusst. Dort standen zwei
-- Prüfungen der Form
--
--     SET LOCAL ROLE mcp_agent;
--     UPDATE public.transactions SET description = description WHERE false;
--
-- die belegen sollten, dass mcp_agent nicht schreiben darf. Beide
-- sind ersatzlos entfallen:
--
--   * redundant — Prüfung 20 beantwortet dieselbe Frage
--     katalogbasiert über has_table_privilege, und zwar für ALLE
--     Tabellen in public statt für zwei;
--   * im Fehlerfall irreführend — wäre das Grant vorhanden und
--     nur RLS würde blockieren, liefe `UPDATE … WHERE false`
--     fehlerfrei durch (null Zeilen lösen keine RLS-Verletzung
--     aus) und die Prüfung meldete fälschlich "DURCHGELASSEN".
--     Sie testete also ohnehin nur die Grant-Ebene.
--
-- Die übrigen Nummern bleiben unverändert: sie sind Bezeichner,
-- keine laufende Zählung. Ein Umnummerieren würde jede Referenz
-- von aussen (MCP-SETUP.md) und jeden Vergleich mit einer älteren
-- Ausgabe still ungültig machen.
-- ============================================================

BEGIN;

-- pg_temp ausdrücklich qualifiziert: unqualifiziert würde die
-- Auflösung beim ERSTEN Lauf durch pg_temp hindurch auf public
-- durchfallen — und dort im Zweifel eine echte Tabelle treffen.
DROP TABLE IF EXISTS pg_temp.mcp_check;
CREATE TEMP TABLE mcp_check (
  nr       int,
  bereich  text,
  pruefung text,
  erwartet text,
  gemessen text,
  ok       boolean
);

DO $$
DECLARE
  probe_client CONSTANT text := '__mcp_verify_probe__';
  probe_user   CONSTANT text := '00000000-0000-0000-0000-000000000001';
  v_bool  boolean;
  v_text  text;
  v_ok    boolean;
BEGIN
  -- Reste einer abgebrochenen früheren Prüfung entfernen
  DELETE FROM public.mcp_clients WHERE client_id = probe_client;

  -- ── 1/2: Sind die Policy-Funktionen für die Client-Rollen aufrufbar? ──
  -- Fehlt das, ist jede Tabelle für die Rolle unbenutzbar.
  FOREACH v_text IN ARRAY ARRAY['authenticated', 'mcp_agent']
  LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_text);
      PERFORM public.jwt_user_id();
      PERFORM public.is_mcp_client();
      PERFORM public.is_revoked_client();
      RESET ROLE;
      INSERT INTO mcp_check VALUES
        (1, 'Rollen', format('%s kann alle Policy-Funktionen aufrufen', v_text),
         'ja', 'ja', true);
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      INSERT INTO mcp_check VALUES
        (1, 'Rollen', format('%s kann alle Policy-Funktionen aufrufen', v_text),
         'ja', 'FEHLER: ' || SQLERRM, false);
    END;
  END LOOP;

  -- ── 3: App-Token (ohne client_id) gilt NICHT als Fremdclient ──
  BEGIN
    PERFORM set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', probe_user), true);
    SELECT public.is_mcp_client() INTO v_bool;
    INSERT INTO mcp_check VALUES
      (3, 'Erkennung', 'App-Token (ohne client_id) → is_mcp_client()',
       'false', coalesce(v_bool::text, 'NULL'), v_bool IS FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO mcp_check VALUES (3, 'Erkennung', 'App-Token → is_mcp_client()', 'false', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 4: OAuth-Token (mit client_id) gilt als Fremdclient ──
  BEGIN
    PERFORM set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated","client_id":"%s"}', probe_user, probe_client), true);
    SELECT public.is_mcp_client() INTO v_bool;
    INSERT INTO mcp_check VALUES
      (4, 'Erkennung', 'OAuth-Token (mit client_id) → is_mcp_client()',
       'true', coalesce(v_bool::text, 'NULL'), v_bool IS TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO mcp_check VALUES (4, 'Erkennung', 'OAuth-Token → is_mcp_client()', 'true', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 5: Nicht widerrufener Client → is_revoked_client() = false ──
  BEGIN
    INSERT INTO public.mcp_clients (client_id, label, revoked_at)
      VALUES (probe_client, 'Probe der Verhaltensprüfung', NULL);
    PERFORM set_config('request.jwt.claims',
      format('{"sub":"%s","client_id":"%s"}', probe_user, probe_client), true);
    SELECT public.is_revoked_client() INTO v_bool;
    INSERT INTO mcp_check VALUES
      (5, 'Widerruf', 'Eingetragener, nicht widerrufener Client',
       'false', coalesce(v_bool::text, 'NULL'), v_bool IS FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO mcp_check VALUES (5, 'Widerruf', 'Nicht widerrufener Client', 'false', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 6: Widerruf wirkt — der Test, der still scheitern würde, ──
  --      wenn mcp_fn_owner mcp_clients wegen RLS nicht sieht.
  BEGIN
    UPDATE public.mcp_clients SET revoked_at = now() WHERE client_id = probe_client;
    PERFORM set_config('request.jwt.claims',
      format('{"sub":"%s","client_id":"%s"}', probe_user, probe_client), true);
    SELECT public.is_revoked_client() INTO v_bool;
    INSERT INTO mcp_check VALUES
      (6, 'Widerruf', 'Widerrufener Client wird erkannt (RLS-Sicht des Definer-Eigentümers)',
       'true', coalesce(v_bool::text, 'NULL'), v_bool IS TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO mcp_check VALUES (6, 'Widerruf', 'Widerrufener Client wird erkannt', 'true', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 7: Widerruf eines Fremdclients trifft die App nicht ──
  BEGIN
    PERFORM set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', probe_user), true);
    SELECT public.is_revoked_client() INTO v_bool;
    INSERT INTO mcp_check VALUES
      (7, 'Widerruf', 'App-Token bleibt von einem Widerruf unberührt',
       'false', coalesce(v_bool::text, 'NULL'), v_bool IS FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO mcp_check VALUES (7, 'Widerruf', 'App-Token unberührt', 'false', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 8: mcp_agent darf transactions LESEN (Grant + Policy zusammen) ──
  BEGIN
    PERFORM set_config('request.jwt.claims',
      format('{"sub":"%s","role":"mcp_agent","client_id":"unbekannt"}', probe_user), true);
    SET LOCAL ROLE mcp_agent;
    PERFORM count(*) FROM public.transactions;
    RESET ROLE;
    INSERT INTO mcp_check VALUES
      (8, 'mcp_agent', 'SELECT auf transactions läuft fehlerfrei durch',
       'ja', 'ja', true);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO mcp_check VALUES
      (8, 'mcp_agent', 'SELECT auf transactions läuft fehlerfrei durch',
       'ja', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 9 entfällt ──────────────────────────────────────────────
  -- Hier stand ein `UPDATE public.transactions … WHERE false` als
  -- Nachweis, dass mcp_agent nicht schreiben darf. Redundant zu
  -- Prüfung 20 und im Fehlerfall irreführend — Begründung im
  -- Kopfkommentar. Nummer bleibt frei.

  -- ── 10: mcp_agent darf mcp_clients NICHT lesen (Absenzprüfung) ──
  BEGIN
    SET LOCAL ROLE mcp_agent;
    PERFORM count(*) FROM public.mcp_clients;
    RESET ROLE;
    INSERT INTO mcp_check VALUES
      (10, 'mcp_agent', 'SELECT auf mcp_clients wird abgelehnt',
       'abgelehnt', 'DURCHGELASSEN', false);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO mcp_check VALUES
      (10, 'mcp_agent', 'SELECT auf mcp_clients wird abgelehnt',
       'abgelehnt', 'abgelehnt (permission denied)', true);
  WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO mcp_check VALUES
      (10, 'mcp_agent', 'SELECT auf mcp_clients wird abgelehnt',
       'abgelehnt', 'abgelehnt (' || SQLERRM || ')', true);
  END;

  -- ── 11/12: Der Hook schreibt die Rolle nur bei client_id um ──
  BEGIN
    SELECT public.custom_access_token_hook(
      '{"user_id":"u","claims":{"role":"authenticated","sub":"u"}}'::jsonb
    ) -> 'claims' ->> 'role' INTO v_text;
    INSERT INTO mcp_check VALUES
      (11, 'Hook', 'Ohne client_id bleibt role unverändert',
       'authenticated', coalesce(v_text, 'NULL'), v_text = 'authenticated');

    SELECT public.custom_access_token_hook(
      '{"user_id":"u","claims":{"role":"authenticated","sub":"u","client_id":"abc"}}'::jsonb
    ) -> 'claims' ->> 'role' INTO v_text;
    INSERT INTO mcp_check VALUES
      (12, 'Hook', 'Mit client_id wird role auf mcp_agent gesetzt',
       'mcp_agent', coalesce(v_text, 'NULL'), v_text = 'mcp_agent');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO mcp_check VALUES (11, 'Hook', 'Hook-Logik', 'siehe Migration', 'FEHLER: ' || SQLERRM, false);
  END;

  -- ── 13: Der Hook ist für Client-Rollen NICHT als RPC erreichbar ──
  FOREACH v_text IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    SELECT has_function_privilege(v_text, 'public.custom_access_token_hook(jsonb)', 'EXECUTE') INTO v_ok;
    INSERT INTO mcp_check VALUES
      (13, 'Hook', format('%s hat KEIN EXECUTE auf custom_access_token_hook', v_text),
       'kein Recht', CASE WHEN v_ok THEN 'HAT RECHT' ELSE 'kein Recht' END, NOT v_ok);
  END LOOP;

  -- Aufräumen
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.mcp_clients WHERE client_id = probe_client;
END $$;

-- ============================================================
-- Teil 2: Protokoll, Notizen, Sparttöpfe
--
-- Eigener Block, damit ein Fehler oben die folgenden Prüfungen
-- nicht verschluckt. ok = NULL bedeutet "übersprungen" und zählt
-- nicht als Befund.
-- ============================================================

DO $$
DECLARE
  probe_user uuid;
  v_cnt      int;
  v_txt      text;
  r          record;
BEGIN
  -- ── 14/15: activity_log und transaction_notes sind append-only ──
  --          Absenzprüfung: gibt es irgendeine UPDATE-/DELETE-Policy?
  FOREACH v_txt IN ARRAY ARRAY['activity_log', 'transaction_notes']
  LOOP
    SELECT count(*) INTO v_cnt
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_txt
       AND cmd IN ('UPDATE', 'DELETE', 'ALL');
    INSERT INTO mcp_check VALUES
      (14, 'Append-only', format('%s hat keine UPDATE-/DELETE-Policy', v_txt),
       '0 Policies', v_cnt || ' Policies', v_cnt = 0);

    SELECT count(*) INTO v_cnt
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_txt
       AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
       AND grantee NOT IN ('postgres', 'supabase_admin', 'service_role', current_user);
    INSERT INTO mcp_check VALUES
      (15, 'Append-only', format('%s: keine Rolle hat UPDATE/DELETE/TRUNCATE', v_txt),
       '0 Grants', v_cnt || ' Grants', v_cnt = 0);
  END LOOP;

  -- ── 16: Alle drei Protokoll-Trigger sind da und zeigen auf log_activity ──
  FOREACH v_txt IN ARRAY ARRAY['transactions', 'transaction_notes', 'savings_pots']
  LOOP
    SELECT count(*) INTO v_cnt
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_txt
       AND NOT t.tgisinternal
       AND t.tgfoid = 'public.log_activity()'::regprocedure;
    INSERT INTO mcp_check VALUES
      (16, 'Trigger', format('%s hat einen Protokoll-Trigger', v_txt),
       'genau 1', v_cnt::text, v_cnt = 1);
  END LOOP;

  -- ── 17: Kann mcp_fn_owner wirklich in activity_log schreiben? ──
  --        Das ist die Prüfung, die den stillen Ausfall fängt:
  --        log_activity() schluckt Fehler, ein fehlendes Recht
  --        bliebe sonst unsichtbar.
  SELECT id INTO probe_user FROM auth.users ORDER BY created_at LIMIT 1;

  IF probe_user IS NULL THEN
    INSERT INTO mcp_check VALUES
      (17, 'Protokoll', 'mcp_fn_owner kann in activity_log schreiben',
       'gelingt', 'uebersprungen: kein Nutzer in auth.users', NULL);
  ELSE
    BEGIN
      SET LOCAL ROLE mcp_fn_owner;
      INSERT INTO public.activity_log
        (user_id, actor, entity, entity_id, action, status, tool)
      VALUES
        (probe_user, 'app', '__verify_probe__', 'probe', 'read', 'ok', 'mcp-verify.sql');
      RESET ROLE;

      SELECT count(*) INTO v_cnt
        FROM public.activity_log
       WHERE entity = '__verify_probe__';

      INSERT INTO mcp_check VALUES
        (17, 'Protokoll', 'mcp_fn_owner kann in activity_log schreiben',
         'gelingt, Zeile sichtbar', v_cnt || ' Probezeile(n)', v_cnt >= 1);

      -- Aufräumen als Eigentümer der Tabelle (mcp_fn_owner darf nicht löschen).
      DELETE FROM public.activity_log WHERE entity = '__verify_probe__';
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      INSERT INTO mcp_check VALUES
        (17, 'Protokoll', 'mcp_fn_owner kann in activity_log schreiben',
         'gelingt', 'FEHLER: ' || SQLERRM, false);
      BEGIN
        DELETE FROM public.activity_log WHERE entity = '__verify_probe__';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END IF;

  -- ── 18 entfällt ─────────────────────────────────────────────
  -- Hier stand ein `UPDATE public.transaction_notes … WHERE false`
  -- als Nachweis, dass mcp_agent Notizen nicht ändern darf.
  -- Redundant zu Prüfung 20 und im Fehlerfall irreführend —
  -- Begründung im Kopfkommentar. Nummer bleibt frei.

  -- ── 19: Die Spartopf-Policy prüft den Schalter wirklich ──
  SELECT count(*) INTO v_cnt
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'savings_pots'
     AND cmd = 'INSERT'
     AND coalesce(with_check, '') LIKE '%mcp_allow_pot_creation%';
  INSERT INTO mcp_check VALUES
    (19, 'Sparttöpfe', 'INSERT-Policy prüft settings.mcp_allow_pot_creation',
     'ja', CASE WHEN v_cnt > 0 THEN 'ja' ELSE 'NEIN' END, v_cnt > 0);

  -- ── 20: mcp_agent darf Sparttöpfe nicht ändern oder löschen ──
  FOR r IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (has_table_privilege('mcp_agent', c.oid, 'UPDATE')
         OR has_table_privilege('mcp_agent', c.oid, 'DELETE'))
  LOOP
    INSERT INTO mcp_check VALUES
      (20, 'mcp_agent', format('kein UPDATE/DELETE auf public.%s', r.relname),
       'kein Recht', 'HAT RECHT', false);
  END LOOP;
  IF NOT FOUND THEN
    INSERT INTO mcp_check VALUES
      (20, 'mcp_agent', 'kein UPDATE/DELETE auf irgendeiner Tabelle in public',
       'kein Recht', 'kein Recht', true);
  END IF;
END $$;

-- Ergebnis
SELECT nr, bereich, pruefung, erwartet, gemessen,
       CASE WHEN ok IS NULL THEN 'uebersprungen'
            WHEN ok THEN 'OK'
            ELSE '>>> BEFUND <<<' END AS status
  FROM mcp_check
 ORDER BY nr, pruefung;

-- Kurzfassung: 0 Befunde = alles in Ordnung.
SELECT count(*) FILTER (WHERE ok IS FALSE)  AS befunde,
       count(*) FILTER (WHERE ok IS NULL)   AS uebersprungen,
       count(*)                             AS geprueft
  FROM mcp_check;

-- ============================================================
-- Alles zurückrollen — unabhängig vom Ergebnis.
--
-- Muss NACH beiden Ergebnis-Abfragen stehen: die Ausgabe geht
-- vorher an den Client, mcp_check verschwindet mit dem Rollback.
--
-- Danach ist die Datenbank exakt im Zustand von vor dem Lauf:
-- keine Probezeile in mcp_clients, keine in activity_log, keine
-- Temp-Tabelle.
-- ============================================================

ROLLBACK;
