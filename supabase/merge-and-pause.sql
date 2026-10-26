-- ============================================================
-- Finance — Töpfe pausieren + Bereiche zusammenführen
-- Im Supabase SQL Editor ausführen (einmalig, NACH tax.sql).
-- Idempotent: ein zweiter Lauf ändert nichts. Bewusst ohne DROP.
--
-- 1. Töpfe pausieren (savings_pots.is_active)
--    Ein pausierter Topf behält seinen Bestand und wird weiter von
--    "Verfügbar" abgezogen (das Geld ist ja reserviert). Neue Buchungen
--    laufen aber nicht mehr hinein: weder Prozentanteile noch Steuer.
--    Wieder aktiviert füllt er sich ab dann weiter, rückwirkend nicht.
--
--    Warum im Trigger und nicht in der App: Buchungen entstehen in der
--    App, durch Daueraufträge und durch Claude (MCP). Nur ein Trigger
--    sieht alle drei.
--
-- 2. Bereiche zusammenführen (RPC merge_budgets)
--    Alles aus dem Quell-Bereich wandert in den Ziel-Bereich, danach
--    wird der Quell-Bereich gelöscht. Eine einzige Datenbank-Transaktion:
--    entweder alles oder nichts — kein halb zusammengeführter Zustand.
--
--    Ergebnis "Privat":  Töpfe beider Bereiche entfallen, Steueranteile
--                        der Buchungen werden auf 0 gesetzt.
--    Ergebnis "Firma":   Töpfe bleiben erhalten und laufen weiter.
--                        Zwei Steuertöpfe werden zu einem.
--                        Würden die aktiven Prozent-Töpfe zusammen über
--                        100 % kommen, werden die Töpfe des Quell-Bereichs
--                        pausiert statt die Zusammenführung abzubrechen.
--
--    Warum SECURITY INVOKER: die Funktion läuft mit den Rechten des
--    angemeldeten Nutzers, RLS gilt also für jede Zeile. Sie kann nur
--    eigene Bereiche anfassen, und MCP-Clients dürfen ohnehin nichts
--    ändern (UPDATE-Policies schließen sie aus).
-- ============================================================

-- ── 1. Spalte ────────────────────────────────────────────────
ALTER TABLE public.savings_pots
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ── 2. Verteilung: pausierte Töpfe überspringen ──────────────
CREATE OR REPLACE FUNCTION public.apply_pot_distribution(tx public.transactions)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pot           RECORD;
  net           NUMERIC(12,2);
  alloc         NUMERIC(12,2);
  distributed   NUMERIC(12,2) := 0;
  total_planned NUMERIC(6,2)  := 0;
  last_pot_id   UUID;
  remainder     NUMERIC(12,2);
  v_tax_pot     UUID;
BEGIN
  IF (tx.amount <= 0) THEN RETURN; END IF;

  -- (a) Steuer: exakt, beide Richtungen — nur wenn der Steuertopf läuft.
  IF (tx.tax_amount > 0) THEN
    v_tax_pot := ensure_tax_pot(tx.user_id, tx.budget_id);
    IF EXISTS (SELECT 1 FROM savings_pots WHERE id = v_tax_pot AND is_active) THEN
      INSERT INTO pot_allocations (user_id, pot_id, transaction_id, amount, kind)
      VALUES (
        tx.user_id, v_tax_pot, tx.id,
        CASE WHEN tx.type = 'income' THEN tx.tax_amount ELSE -tx.tax_amount END,
        'tax'
      );
    END IF;
  END IF;

  -- (b) Prozent-Töpfe: nur Einnahmen, nur Netto, nur aktive Töpfe.
  IF (tx.type <> 'income') THEN RETURN; END IF;
  net := tx.amount - tx.tax_amount;

  SELECT id INTO last_pot_id FROM savings_pots
   WHERE budget_id = tx.budget_id AND user_id = tx.user_id
     AND kind = 'manual' AND is_active AND allocation_percent > 0
   ORDER BY sort_order DESC, created_at DESC LIMIT 1;
  IF last_pot_id IS NULL THEN RETURN; END IF;

  FOR pot IN
    SELECT id, allocation_percent FROM savings_pots
     WHERE budget_id = tx.budget_id AND user_id = tx.user_id
       AND kind = 'manual' AND is_active AND allocation_percent > 0
     ORDER BY sort_order ASC, created_at ASC
  LOOP
    alloc := round(net * pot.allocation_percent / 100.0, 2);
    total_planned := total_planned + pot.allocation_percent;
    IF pot.id = last_pot_id THEN
      remainder := round(net * total_planned / 100.0, 2) - (distributed + alloc);
      alloc := alloc + remainder;
    END IF;
    INSERT INTO pot_allocations (user_id, pot_id, transaction_id, amount, kind)
    VALUES (tx.user_id, pot.id, tx.id, alloc, 'percent');
    distributed := distributed + alloc;
  END LOOP;
END; $$;

REVOKE EXECUTE ON FUNCTION public.apply_pot_distribution(public.transactions)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. Nachträgliche Änderung einer Buchung ──────────────────
-- Neu verteilt wird nur in AKTIVE Töpfe. Zuweisungen in pausierten
-- Töpfen bleiben eingefroren — sonst würde jede Korrektur einer alten
-- Buchung den Bestand eines pausierten Topfs leise abschmelzen.
-- Während merge_budgets läuft, wird gar nicht neu verteilt: dort
-- wandern Buchungen samt ihren bestehenden Zuweisungen mit.
CREATE OR REPLACE FUNCTION public.tx_update_redistribute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_catalog.current_setting('finance.merging', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF (NEW.amount     IS DISTINCT FROM OLD.amount
   OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
   OR NEW.type       IS DISTINCT FROM OLD.type
   OR NEW.budget_id  IS DISTINCT FROM OLD.budget_id) THEN
    DELETE FROM pot_allocations a
     USING savings_pots p
     WHERE a.transaction_id = OLD.id
       AND p.id = a.pot_id
       AND p.is_active;
    PERFORM apply_pot_distribution(NEW);
  END IF;
  RETURN NEW;
END; $$;

-- ── 4. 100 %-Grenze: nur aktive manuelle Töpfe zählen ────────
-- Ein pausierter Topf verteilt nichts, belegt also auch keinen Anteil.
-- Beim Wiedereinschalten greift die Grenze wieder (UPDATE-Trigger).
CREATE OR REPLACE FUNCTION public.check_pot_allocation_sum()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE other_sum NUMERIC(6,2);
BEGIN
  IF (NEW.kind = 'tax' AND NEW.allocation_percent <> 0) THEN
    RAISE EXCEPTION 'Der Steuertopf wird automatisch befüllt und hat keinen Prozentanteil.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(allocation_percent), 0) INTO other_sum
    FROM savings_pots
   WHERE budget_id = NEW.budget_id AND user_id = NEW.user_id
     AND kind = 'manual' AND is_active AND id <> NEW.id;

  IF (NEW.kind = 'manual' AND NEW.is_active
      AND other_sum + NEW.allocation_percent > 100) THEN
    RAISE EXCEPTION 'Gesamtzuteilung der aktiven Töpfe überschreitet 100%% (bereits % %%, neu % %%)',
      other_sum, NEW.allocation_percent USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- ── 5. Bereiche zusammenführen ───────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_budgets(
  p_source uuid,
  p_target uuid,
  p_name   text,
  p_type   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user        uuid := public.jwt_user_id();
  v_name        text := btrim(coalesce(p_name, ''));
  v_src_start   numeric(12,2);
  v_src_legacy  numeric(12,2);
  v_tx          int;
  v_rec         int;
  v_cats        int;
  v_pots_moved  int := 0;
  v_pots_paused int := 0;
  v_pots_removed int := 0;
  v_src_tax     uuid;
  v_tgt_tax     uuid;
  v_src_tax_on  boolean;
  v_sum         numeric(6,2);
  v_sort_off    int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.is_mcp_client() THEN
    RAISE EXCEPTION 'Zusammenführen ist nur in der App möglich.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RAISE EXCEPTION 'Bitte zwei verschiedene Bereiche wählen.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_type NOT IN ('personal', 'business') THEN
    RAISE EXCEPTION 'Ungültige Art: %', p_type USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Bitte einen Namen angeben.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- RLS filtert fremde Bereiche weg: "nicht gefunden" heißt auch "nicht deiner".
  -- FOR UPDATE sperrt beide Zeilen gegen parallele Änderungen.
  PERFORM 1 FROM budgets WHERE id IN (p_source, p_target) AND user_id = v_user FOR UPDATE;
  IF (SELECT count(*) FROM budgets WHERE id IN (p_source, p_target) AND user_id = v_user) <> 2 THEN
    RAISE EXCEPTION 'Bereich nicht gefunden.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Ab hier keine Neuverteilung durch den Update-Trigger (nur diese Transaktion).
  PERFORM pg_catalog.set_config('finance.merging', 'on', true);

  -- ── Startguthaben addieren ─────────────────────────────────
  -- settings.starting_balance ist die maßgebliche Zahl für den Kontostand.
  SELECT COALESCE(starting_balance, 0) INTO v_src_start
    FROM settings WHERE budget_id = p_source AND user_id = v_user;
  v_src_start := COALESCE(v_src_start, 0);
  IF EXISTS (SELECT 1 FROM settings WHERE budget_id = p_target AND user_id = v_user) THEN
    UPDATE settings SET starting_balance = starting_balance + v_src_start
     WHERE budget_id = p_target AND user_id = v_user;
  ELSE
    INSERT INTO settings (user_id, budget_id, starting_balance)
    VALUES (v_user, p_target, v_src_start);
  END IF;
  -- Altfeld mitziehen, damit beide Werte zueinander passen.
  SELECT starting_balance INTO v_src_legacy FROM budgets WHERE id = p_source;
  UPDATE budgets SET starting_balance = starting_balance + COALESCE(v_src_legacy, 0)
   WHERE id = p_target;

  -- ── Kategorien ─────────────────────────────────────────────
  -- Buchungen verweisen per Name auf Kategorien. Gleichnamige Kategorie
  -- im Ziel → die des Ziels bleibt, fehlende Vorbelegungen werden ergänzt.
  UPDATE categories t
     SET monthly_budget    = COALESCE(t.monthly_budget,    s.monthly_budget),
         default_frequency = COALESCE(t.default_frequency, s.default_frequency),
         default_tax_rate  = COALESCE(t.default_tax_rate,  s.default_tax_rate)
    FROM categories s
   WHERE s.budget_id = p_source AND t.budget_id = p_target
     AND s.user_id = v_user AND t.user_id = v_user
     AND s.name = t.name AND s.type = t.type;

  UPDATE categories s SET budget_id = p_target
   WHERE s.budget_id = p_source AND s.user_id = v_user
     AND NOT EXISTS (SELECT 1 FROM categories t
                      WHERE t.budget_id = p_target AND t.user_id = v_user
                        AND t.name = s.name AND t.type = s.type);
  GET DIAGNOSTICS v_cats = ROW_COUNT;

  -- ── Buchungen und Daueraufträge ────────────────────────────
  UPDATE transactions SET budget_id = p_target
   WHERE budget_id = p_source AND user_id = v_user;
  GET DIAGNOSTICS v_tx = ROW_COUNT;

  UPDATE recurring_transactions SET budget_id = p_target
   WHERE budget_id = p_source AND user_id = v_user;
  GET DIAGNOSTICS v_rec = ROW_COUNT;

  -- ── Töpfe ──────────────────────────────────────────────────
  IF p_type = 'personal' THEN
    -- Privat kennt keine Töpfe und keine Steuer. Die Zuweisungen gehen
    -- per FK-CASCADE mit; der Kontostand ändert sich dadurch nicht, das
    -- Geld ist nur nicht mehr reserviert.
    DELETE FROM savings_pots
     WHERE budget_id IN (p_source, p_target) AND user_id = v_user;
    GET DIAGNOSTICS v_pots_removed = ROW_COUNT;

    UPDATE transactions SET tax_amount = 0
     WHERE budget_id = p_target AND user_id = v_user AND tax_amount <> 0;
    UPDATE recurring_transactions SET tax_amount = 0
     WHERE budget_id = p_target AND user_id = v_user AND tax_amount <> 0;
    UPDATE categories SET default_tax_rate = NULL
     WHERE budget_id = p_target AND user_id = v_user AND default_tax_rate IS NOT NULL;
  ELSE
    -- Steuertöpfe: höchstens einer je Bereich → zusammenlegen.
    SELECT id, is_active INTO v_src_tax, v_src_tax_on
      FROM savings_pots WHERE budget_id = p_source AND kind = 'tax' AND user_id = v_user;
    SELECT id INTO v_tgt_tax
      FROM savings_pots WHERE budget_id = p_target AND kind = 'tax' AND user_id = v_user;

    IF v_src_tax IS NOT NULL AND v_tgt_tax IS NOT NULL THEN
      -- Zuweisungen umhängen; der Sync-Trigger verschiebt den Bestand mit.
      UPDATE pot_allocations SET pot_id = v_tgt_tax WHERE pot_id = v_src_tax;
      -- Lief einer der beiden, läuft der gemeinsame weiter.
      IF v_src_tax_on THEN
        UPDATE savings_pots SET is_active = true WHERE id = v_tgt_tax AND NOT is_active;
      END IF;
      DELETE FROM savings_pots WHERE id = v_src_tax;
    END IF;

    -- 100 %-Grenze der aktiven Prozent-Töpfe nach dem Zusammenlegen.
    SELECT COALESCE(SUM(allocation_percent), 0) INTO v_sum
      FROM savings_pots
     WHERE budget_id IN (p_source, p_target) AND user_id = v_user
       AND kind = 'manual' AND is_active;
    IF v_sum > 100 THEN
      UPDATE savings_pots SET is_active = false
       WHERE budget_id = p_source AND user_id = v_user
         AND kind = 'manual' AND is_active AND allocation_percent > 0;
      GET DIAGNOSTICS v_pots_paused = ROW_COUNT;
    END IF;

    -- Reihenfolge erhalten: Töpfe der Quelle hinten anhängen.
    SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort_off
      FROM savings_pots WHERE budget_id = p_target AND user_id = v_user;
    UPDATE savings_pots SET budget_id = p_target, sort_order = sort_order + v_sort_off
     WHERE budget_id = p_source AND user_id = v_user;
    GET DIAGNOSTICS v_pots_moved = ROW_COUNT;
  END IF;

  -- ── Ziel umbenennen, Quelle löschen ────────────────────────
  UPDATE budgets SET name = v_name, type = p_type WHERE id = p_target;
  -- Restliche Quell-Daten (Settings, doppelte Kategorien) gehen per CASCADE.
  -- activity_log bleibt unverändert: ein Protokoll schreibt man nicht um.
  DELETE FROM budgets WHERE id = p_source AND user_id = v_user;

  PERFORM pg_catalog.set_config('finance.merging', 'off', true);

  RETURN jsonb_build_object(
    'target_id',          p_target,
    'transactions_moved', v_tx,
    'recurring_moved',    v_rec,
    'categories_moved',   v_cats,
    'pots_moved',         v_pots_moved,
    'pots_paused',        v_pots_paused,
    'pots_removed',       v_pots_removed
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.merge_budgets(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.merge_budgets(uuid, uuid, text, text) TO authenticated;
