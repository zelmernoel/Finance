-- RLS Policies: alle Operationen (SELECT, INSERT, UPDATE, DELETE) für eingeloggte User erlauben.
-- Ausführen in Supabase SQL-Editor: https://supabase.com/dashboard → SQL Editor

-- Transactions
DROP POLICY IF EXISTS "Eigene Transaktionen" ON transactions;
CREATE POLICY "Eigene Transaktionen" ON transactions
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Categories
DROP POLICY IF EXISTS "Eigene Kategorien" ON categories;
CREATE POLICY "Eigene Kategorien" ON categories
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Budgets
DROP POLICY IF EXISTS "Eigene Budgets" ON budgets;
CREATE POLICY "Eigene Budgets" ON budgets
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Settings
DROP POLICY IF EXISTS "Eigene Settings" ON settings;
CREATE POLICY "Eigene Settings" ON settings
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Recurring transactions
DROP POLICY IF EXISTS "Eigene Dauerauftraege" ON recurring_transactions;
CREATE POLICY "Eigene Dauerauftraege" ON recurring_transactions
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
