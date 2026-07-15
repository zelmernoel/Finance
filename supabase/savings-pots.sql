-- ============================================================
-- FinanzTracker — Sparttöpfe (Envelope Budgeting)
-- Im Supabase SQL Editor ausführen (einmalig, nach schema.sql)
--
-- Verteilung, Rückabwicklung und die 100%-Grenze laufen server-
-- seitig über Trigger — nicht im Client. Funktioniert daher nur
-- für eingeloggte Nutzer (Gast-Modus hat keine Töpfe).
-- ============================================================

-- ── savings_pots ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS savings_pots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id          UUID REFERENCES budgets(id)    ON DELETE CASCADE NOT NULL,
  name               TEXT NOT NULL,
  allocation_percent NUMERIC(5,2) NOT NULL DEFAULT 0
                       CHECK (allocation_percent >= 0 AND allocation_percent <= 100),
  target_amount      NUMERIC(12,2) CHECK (target_amount IS NULL OR target_amount >= 0),
  current_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  color              TEXT NOT NULL DEFAULT '#4A6FA5',
  icon               TEXT,
  sort_order         INT  NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE savings_pots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Eigene Sparttöpfe" ON savings_pots;
CREATE POLICY "Eigene Sparttöpfe" ON savings_pots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS savings_pots_user_budget
  ON savings_pots (user_id, budget_id, sort_order);

-- ── pot_allocations (Audit-Trail) ────────────────────────────
CREATE TABLE IF NOT EXISTS pot_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id)   ON DELETE CASCADE NOT NULL,
  pot_id                UUID REFERENCES savings_pots(id) ON DELETE CASCADE NOT NULL,
  income_transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE NOT NULL,
  amount                NUMERIC(12,2) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pot_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Eigene Pot-Zuweisungen" ON pot_allocations;
CREATE POLICY "Eigene Pot-Zuweisungen" ON pot_allocations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS pot_allocations_pot ON pot_allocations (pot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pot_allocations_tx  ON pot_allocations (income_transaction_id);

-- ── current_amount immer = Summe der Zuweisungen ─────────────
-- Eine einzige Stelle pflegt current_amount: egal ob eine Zuweisung
-- direkt entsteht oder per Transaktions-Löschung (FK-CASCADE) verschwindet.
CREATE OR REPLACE FUNCTION sync_pot_current_amount()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE savings_pots
       SET current_amount = current_amount + NEW.amount, updated_at = now()
     WHERE id = NEW.pot_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE savings_pots
       SET current_amount = current_amount - OLD.amount, updated_at = now()
     WHERE id = OLD.pot_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_pot_amount ON pot_allocations;
CREATE TRIGGER trg_sync_pot_amount
  AFTER INSERT OR DELETE ON pot_allocations
  FOR EACH ROW EXECUTE FUNCTION sync_pot_current_amount();

-- ── Kern: eine Einnahme auf die Töpfe ihres Budgets verteilen ─
CREATE OR REPLACE FUNCTION apply_pot_distribution(tx transactions)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pot           RECORD;
  alloc         NUMERIC(12,2);
  distributed   NUMERIC(12,2) := 0;
  total_planned NUMERIC(6,2)  := 0;
  remainder     NUMERIC(12,2);
  last_pot_id   UUID;
BEGIN
  -- Nur positive Einnahmen (Korrekturbuchungen / Ausgaben lösen nichts aus)
  IF (tx.type <> 'income' OR tx.amount <= 0) THEN RETURN; END IF;

  -- Höchste sort_order UNTER den befüllten Töpfen bekommt den Rundungsrest
  SELECT id INTO last_pot_id FROM savings_pots
   WHERE budget_id = tx.budget_id AND user_id = tx.user_id AND allocation_percent > 0
   ORDER BY sort_order DESC, created_at DESC LIMIT 1;

  -- Keine (befüllten) Töpfe → nichts tun, kein Fehler
  IF last_pot_id IS NULL THEN RETURN; END IF;

  FOR pot IN
    SELECT id, allocation_percent FROM savings_pots
     WHERE budget_id = tx.budget_id AND user_id = tx.user_id AND allocation_percent > 0
     ORDER BY sort_order ASC, created_at ASC
  LOOP
    alloc := round(tx.amount * pot.allocation_percent / 100.0, 2);
    INSERT INTO pot_allocations (user_id, pot_id, income_transaction_id, amount)
      VALUES (tx.user_id, pot.id, tx.id, alloc);
    distributed   := distributed + alloc;
    total_planned := total_planned + pot.allocation_percent;
  END LOOP;

  -- Rundungsrest so, dass die Summe exakt dem VERPLANTEN Anteil entspricht
  -- (bei <100 % bleibt der freie Rest bewusst unverteilt).
  remainder := round(tx.amount * total_planned / 100.0, 2) - distributed;
  IF remainder <> 0 THEN
    UPDATE pot_allocations SET amount = amount + remainder
     WHERE income_transaction_id = tx.id AND pot_id = last_pot_id;
  END IF;
END; $$;

-- Neue Einnahme → verteilen
CREATE OR REPLACE FUNCTION tx_insert_distribute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM apply_pot_distribution(NEW);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_distribute_income ON transactions;
CREATE TRIGGER trg_distribute_income
  AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION tx_insert_distribute();

-- Einnahme nachträglich geändert (Betrag/Typ/Budget) → alte Verteilung
-- rückgängig (DELETE bucht via sync ab) und mit neuen Werten neu verteilen.
CREATE OR REPLACE FUNCTION tx_update_redistribute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.amount    IS DISTINCT FROM OLD.amount
   OR NEW.type      IS DISTINCT FROM OLD.type
   OR NEW.budget_id IS DISTINCT FROM OLD.budget_id) THEN
    DELETE FROM pot_allocations WHERE income_transaction_id = OLD.id;
    PERFORM apply_pot_distribution(NEW);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_redistribute_income ON transactions;
CREATE TRIGGER trg_redistribute_income
  AFTER UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION tx_update_redistribute();

-- ── 100 %-Grenze pro Budget erzwingen + updated_at pflegen ───
CREATE OR REPLACE FUNCTION check_pot_allocation_sum()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE other_sum NUMERIC(6,2);
BEGIN
  SELECT COALESCE(SUM(allocation_percent), 0) INTO other_sum
    FROM savings_pots
   WHERE budget_id = NEW.budget_id AND user_id = NEW.user_id AND id <> NEW.id;

  IF (other_sum + NEW.allocation_percent > 100) THEN
    RAISE EXCEPTION 'Gesamtzuteilung überschreitet 100%% (bereits % %%, neu % %%)',
      other_sum, NEW.allocation_percent USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_check_pot_sum ON savings_pots;
CREATE TRIGGER trg_check_pot_sum
  BEFORE INSERT OR UPDATE ON savings_pots
  FOR EACH ROW EXECUTE FUNCTION check_pot_allocation_sum();
