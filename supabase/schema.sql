-- ============================================================
-- FinanzTracker — Supabase Schema v2
-- Im Supabase SQL Editor ausführen (einmalig, bei Neuinstallation)
-- Bei bestehender DB: nur die mit "-- NEU" markierten Blöcke ausführen
-- ============================================================

-- ── Budgets (Workspaces) — NEU ───────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name             TEXT    NOT NULL DEFAULT 'Persönlich',
  type             TEXT    NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'business')),
  starting_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  color            TEXT    NOT NULL DEFAULT '#4A6FA5',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene Budgets" ON budgets
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS budgets_user ON budgets (user_id, created_at);

-- ── Transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id    UUID    REFERENCES budgets(id) ON DELETE CASCADE,    -- NEU
  date         DATE    NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category     TEXT    NOT NULL DEFAULT '',
  description  TEXT    NOT NULL DEFAULT '',
  note         TEXT             DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene Transaktionen" ON transactions
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS transactions_user_budget_date
  ON transactions (user_id, budget_id, date DESC);

-- ── Categories ───────────────────────────────────────────────
-- id ist TEXT, weil das Frontend eigene IDs wie 'cat-exp-1-abc123' vergibt
CREATE TABLE IF NOT EXISTS categories (
  id             TEXT    PRIMARY KEY,
  user_id        UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id      UUID    REFERENCES budgets(id) ON DELETE CASCADE,   -- NEU
  name           TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  monthly_budget NUMERIC(12,2)                                        -- NEU
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene Kategorien" ON categories
  FOR ALL USING (auth.uid() = user_id);

-- ── Settings (per Budget) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id        UUID    REFERENCES budgets(id) ON DELETE CASCADE,   -- NEU
  starting_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  name             TEXT    NOT NULL DEFAULT '',
  UNIQUE (user_id, budget_id)                                          -- NEU (ersetzt altes UNIQUE user_id)
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene Settings" ON settings
  FOR ALL USING (auth.uid() = user_id);

-- ── Recurring Transactions — NEU ─────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  budget_id     UUID    REFERENCES budgets(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  type          TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  category      TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL,
  note          TEXT,
  frequency     TEXT    NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  start_date    DATE    NOT NULL,
  end_date      DATE,
  next_due      DATE    NOT NULL,
  last_executed DATE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene Dauerauftraege" ON recurring_transactions
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS recurring_user_budget_due
  ON recurring_transactions (user_id, budget_id, next_due, is_active);

-- ============================================================
-- Migration: Bestehende Daten (ohne budget_id) einem Default-Budget zuweisen
-- Nur ausführen wenn bereits Daten existieren und budget_id noch NULL ist
-- ============================================================
-- 1. Für jeden User ein Default-Budget anlegen:
-- INSERT INTO budgets (user_id, name, type)
--   SELECT DISTINCT user_id, 'Persönlich', 'personal'
--   FROM transactions WHERE budget_id IS NULL
--   ON CONFLICT DO NOTHING;
--
-- 2. Transaktionen verknüpfen:
-- UPDATE transactions t
--   SET budget_id = (SELECT id FROM budgets WHERE user_id = t.user_id LIMIT 1)
--   WHERE budget_id IS NULL;
--
-- 3. Gleiches für categories, settings:
-- UPDATE categories c
--   SET budget_id = (SELECT id FROM budgets WHERE user_id = c.user_id LIMIT 1)
--   WHERE budget_id IS NULL;
-- UPDATE settings s
--   SET budget_id = (SELECT id FROM budgets WHERE user_id = s.user_id LIMIT 1)
--   WHERE budget_id IS NULL;
