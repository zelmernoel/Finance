-- ============================================================
-- Finance — Steuer, Steuertopf, Kategorie-Vorbelegungen
-- Im Supabase SQL Editor ausführen (einmalig, NACH savings-pots.sql
-- und mcp-schema.sql). Idempotent: ein zweiter Lauf ändert nichts.
-- Bewusst ohne DROP: nur ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE
-- und Constraints über Existenzprüfung — läuft so auch über Werkzeuge,
-- die destruktive Anweisungen erst nach Rückfrage ausführen.
-- Live eingespielt am 15.10.2026 (Migration steuer_steuertopf_vorbelegungen).
--
-- Warum die Logik hier liegt und nicht im Client:
-- Buchungen entstehen an drei Stellen — App, Daueraufträge und
-- der MCP-Server (Claude). Läge die Steuerverteilung im Client,
-- liefe jede Buchung, die nicht aus dem Formular kommt, am
-- Steuertopf vorbei. Ein Trigger kennt diese Unterscheidung nicht.
--
-- Modell:
--   transactions.amount      = Brutto (unverändert, zählt zum Kontostand)
--   transactions.tax_amount  = darin enthaltene Steuer (0 = keine)
--   Netto                    = amount - tax_amount (wird nicht gespeichert;
--                              eine Quelle der Wahrheit statt drei Spalten)
--
--   Einnahme mit Steuer  → +tax_amount in den Steuertopf (Umsatzsteuer)
--   Ausgabe mit Steuer   → -tax_amount aus dem Steuertopf (Vorsteuerabzug)
--   Prozent-Töpfe        → verteilen den NETTO-Anteil einer Einnahme.
--                          Die Steuer gehört dem Finanzamt, nicht der Rücklage.
--
--   Der Steuertopf (savings_pots.kind = 'tax') entsteht automatisch
--   beim ersten Buchen mit Steuer, einer je Bereich, 0 % Zuteilung.
--   Ist er negativ, erwartet man eine Erstattung (Vorsteuerüberhang).
-- ============================================================

-- ── 1. Spalten ───────────────────────────────────────────────

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Vorbelegungen im Buchungs-Wizard: Dauerauftrag und Steuersatz je Kategorie.
-- NULL = nichts vorbelegt.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS default_frequency TEXT;
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC(5,2);

-- Topf-Art: 'manual' = vom Nutzer angelegt, prozentual befüllt.
--           'tax'    = Steuertopf, automatisch geführt, exakt befüllt.
ALTER TABLE public.savings_pots
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual';

-- Zuweisungsart: 'percent' = Anteil einer Einnahme, 'tax' = Steuer
-- (negativ = Vorsteuer aus einer Ausgabe).
ALTER TABLE public.pot_allocations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'percent';

-- Stand aus onboarding.sql nachziehen (fehlte in der Live-DB; der
-- Client schreibt die Spalte bereits).
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  -- Zuweisungen entstehen jetzt auch aus Ausgaben (negative Vorsteuer),
  -- der alte Spaltenname "income_transaction_id" wäre eine Lüge.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pot_allocations'
                AND column_name = 'income_transaction_id') THEN
    ALTER TABLE public.pot_allocations RENAME COLUMN income_transaction_id TO transaction_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_tax_amount_check') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_tax_amount_check
      CHECK (tax_amount >= 0 AND tax_amount < amount);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_transactions_tax_amount_check') THEN
    ALTER TABLE public.recurring_transactions ADD CONSTRAINT recurring_transactions_tax_amount_check
      CHECK (tax_amount >= 0 AND tax_amount < amount);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_default_frequency_check') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_default_frequency_check
      CHECK (default_frequency IS NULL OR default_frequency IN ('daily','weekly','monthly','yearly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_default_tax_rate_check') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_default_tax_rate_check
      CHECK (default_tax_rate IS NULL OR (default_tax_rate >= 0 AND default_tax_rate <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'savings_pots_kind_check') THEN
    ALTER TABLE public.savings_pots ADD CONSTRAINT savings_pots_kind_check CHECK (kind IN ('manual','tax'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pot_allocations_kind_check') THEN
    ALTER TABLE public.pot_allocations ADD CONSTRAINT pot_allocations_kind_check CHECK (kind IN ('percent','tax'));
  END IF;
END $$;

-- Höchstens ein Steuertopf je Bereich.
CREATE UNIQUE INDEX IF NOT EXISTS savings_pots_one_tax_pot
  ON public.savings_pots (budget_id) WHERE kind = 'tax';

-- ── 2. current_amount = Summe der Zuweisungen ────────────────
-- Jetzt auch für UPDATE: die Rundungskorrektur der alten Version
-- änderte eine Zuweisung nachträglich, ohne den Topf nachzuziehen.
CREATE OR REPLACE FUNCTION public.sync_pot_current_amount()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE savings_pots SET current_amount = current_amount + NEW.amount, updated_at = now()
     WHERE id = NEW.pot_id;
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (NEW.pot_id = OLD.pot_id) THEN
      UPDATE savings_pots SET current_amount = current_amount + (NEW.amount - OLD.amount), updated_at = now()
       WHERE id = NEW.pot_id;
    ELSE
      UPDATE savings_pots SET current_amount = current_amount - OLD.amount, updated_at = now()
       WHERE id = OLD.pot_id;
      UPDATE savings_pots SET current_amount = current_amount + NEW.amount, updated_at = now()
       WHERE id = NEW.pot_id;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE savings_pots SET current_amount = current_amount - OLD.amount, updated_at = now()
     WHERE id = OLD.pot_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE TRIGGER trg_sync_pot_amount
  AFTER INSERT OR UPDATE OR DELETE ON public.pot_allocations
  FOR EACH ROW EXECUTE FUNCTION public.sync_pot_current_amount();

-- ── 3. Steuertopf sicherstellen ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_tax_pot(p_user UUID, p_budget UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id   UUID;
  v_sort INT;
BEGIN
  SELECT id INTO v_id FROM savings_pots
   WHERE budget_id = p_budget AND user_id = p_user AND kind = 'tax';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort
    FROM savings_pots WHERE budget_id = p_budget AND user_id = p_user;

  INSERT INTO savings_pots (user_id, budget_id, name, allocation_percent, color, icon, sort_order, kind)
  VALUES (p_user, p_budget, 'Umsatzsteuer', 0, '#6B7280', '🧾', v_sort, 'tax')
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- ── 4. Verteilung einer Buchung ──────────────────────────────
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
BEGIN
  IF (tx.amount <= 0) THEN RETURN; END IF;

  -- (a) Steuer: exakt, beide Richtungen.
  IF (tx.tax_amount > 0) THEN
    INSERT INTO pot_allocations (user_id, pot_id, transaction_id, amount, kind)
    VALUES (
      tx.user_id,
      ensure_tax_pot(tx.user_id, tx.budget_id),
      tx.id,
      CASE WHEN tx.type = 'income' THEN tx.tax_amount ELSE -tx.tax_amount END,
      'tax'
    );
  END IF;

  -- (b) Prozent-Töpfe: nur Einnahmen, nur der Netto-Anteil.
  IF (tx.type <> 'income') THEN RETURN; END IF;
  net := tx.amount - tx.tax_amount;

  SELECT id INTO last_pot_id FROM savings_pots
   WHERE budget_id = tx.budget_id AND user_id = tx.user_id
     AND kind = 'manual' AND allocation_percent > 0
   ORDER BY sort_order DESC, created_at DESC LIMIT 1;
  IF last_pot_id IS NULL THEN RETURN; END IF;

  FOR pot IN
    SELECT id, allocation_percent FROM savings_pots
     WHERE budget_id = tx.budget_id AND user_id = tx.user_id
       AND kind = 'manual' AND allocation_percent > 0
     ORDER BY sort_order ASC, created_at ASC
  LOOP
    alloc := round(net * pot.allocation_percent / 100.0, 2);
    total_planned := total_planned + pot.allocation_percent;
    -- Rundungsrest in den letzten Topf falten, BEVOR geschrieben wird —
    -- so braucht es keine nachträgliche Korrektur.
    IF pot.id = last_pot_id THEN
      remainder := round(net * total_planned / 100.0, 2) - (distributed + alloc);
      alloc := alloc + remainder;
    END IF;
    INSERT INTO pot_allocations (user_id, pot_id, transaction_id, amount, kind)
    VALUES (tx.user_id, pot.id, tx.id, alloc, 'percent');
    distributed := distributed + alloc;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.tx_insert_distribute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM apply_pot_distribution(NEW);
  RETURN NEW;
END; $$;

-- Betrag, Steuer, Typ oder Bereich geändert → alte Verteilung weg
-- (DELETE bucht über den Sync-Trigger ab), neu verteilen.
CREATE OR REPLACE FUNCTION public.tx_update_redistribute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.amount     IS DISTINCT FROM OLD.amount
   OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
   OR NEW.type       IS DISTINCT FROM OLD.type
   OR NEW.budget_id  IS DISTINCT FROM OLD.budget_id) THEN
    DELETE FROM pot_allocations WHERE transaction_id = OLD.id;
    PERFORM apply_pot_distribution(NEW);
  END IF;
  RETURN NEW;
END; $$;

-- Ersetzt den Trigger der Erstfassung (distribute_income_to_pots) in place.
-- Die alte Funktion bleibt als verwaister Rest stehen und kann bei
-- Gelegenheit entfernt werden: DROP FUNCTION IF EXISTS public.distribute_income_to_pots();
CREATE OR REPLACE TRIGGER trg_distribute_income
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tx_insert_distribute();
CREATE OR REPLACE TRIGGER trg_redistribute_income
  AFTER UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tx_update_redistribute();

-- ── 5. Regeln für Töpfe ──────────────────────────────────────
-- 100 %-Grenze gilt nur für manuelle Töpfe; der Steuertopf hat immer 0 %.
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
     AND kind = 'manual' AND id <> NEW.id;

  IF (NEW.kind = 'manual' AND other_sum + NEW.allocation_percent > 100) THEN
    RAISE EXCEPTION 'Gesamtzuteilung überschreitet 100%% (bereits % %%, neu % %%)',
      other_sum, NEW.allocation_percent USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE TRIGGER trg_check_pot_sum
  BEFORE INSERT OR UPDATE ON public.savings_pots
  FOR EACH ROW EXECUTE FUNCTION public.check_pot_allocation_sum();

-- Löschen des Steuertopfs verhindert die App (Adapter + Oberfläche),
-- nicht die DB: ein BEFORE-DELETE-Trigger würde beim Löschen eines
-- ganzen Bereichs mitten im FK-Cascade feuern und das Löschen abbrechen.
-- Der MCP-Server darf Töpfe ohnehin nicht löschen (RLS).
