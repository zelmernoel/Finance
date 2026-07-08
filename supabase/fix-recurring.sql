-- ============================================================
-- FIX: recurring_transactions-Tabelle neu anlegen (sauberes Schema)
-- Ausführen im Supabase SQL Editor → Run
--
-- Sicher, weil die Tabelle leer ist → kein Datenverlust.
-- categories / budgets / settings werden NICHT angefasst.
--
-- Optional vorher prüfen, dass wirklich nichts drin ist:
--   SELECT count(*) FROM recurring_transactions;   -- sollte 0 sein
-- ============================================================

DROP TABLE IF EXISTS recurring_transactions CASCADE;

CREATE TABLE recurring_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id     UUID REFERENCES budgets(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  type          TEXT NOT NULL CHECK (type IN ('income','expense')),
  category      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL,
  note          TEXT,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  start_date    DATE NOT NULL,
  end_date      DATE,
  next_due      DATE NOT NULL,
  last_executed DATE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eigene Dauerauftraege" ON recurring_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX recurring_user_budget_due
  ON recurring_transactions (user_id, budget_id, next_due, is_active);
