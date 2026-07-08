-- ============================================================
-- FIX: transactions-Tabelle neu anlegen (sauberes Schema)
-- Ausführen im Supabase SQL Editor → Run
--
-- Sicher, weil die Tabelle leer ist → kein Datenverlust.
-- categories / budgets / settings werden NICHT angefasst.
--
-- Optional vorher prüfen, dass wirklich nichts drin ist:
--   SELECT count(*) FROM transactions;   -- sollte 0 sein
-- ============================================================

DROP TABLE IF EXISTS transactions CASCADE;

CREATE TABLE transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id   UUID REFERENCES budgets(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eigene Transaktionen" ON transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX transactions_user_budget_date
  ON transactions (user_id, budget_id, date DESC);
