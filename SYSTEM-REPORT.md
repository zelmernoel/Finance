# SYSTEM-REPORT — Finance

> **Nachtrag 2026-10-16 (Branch `feature/steuer-wizard`):** Dieser Report
> beschreibt den Stand VOR der Steuer-Erweiterung. Seitdem: `transactions.tax_amount`,
> `recurring_transactions.tax_amount`, `categories.default_frequency/default_tax_rate`,
> `savings_pots.kind` ('manual' | 'tax'), `pot_allocations.kind` und die Umbenennung
> `pot_allocations.income_transaction_id → transaction_id`. Die Trigger-Funktionen aus
> Abschnitt „Sparttöpfe“ sind durch `supabase/tax.sql` ersetzt (Steuertopf, Verteilung
> vom Netto, UPDATE-fähiger Sync, `ensure_tax_pot`). Die Live-DB hatte zudem nie den
> Update-Trigger `trg_redistribute_income` und nie `settings.onboarding_completed` —
> beides ist mit `tax.sql` nachgezogen. Massgeblich ist weiterhin der Code.
>
> **Aktualisiert:** 2026-09-03
> **Bezugspunkt:** Commit `e9e3c83` auf `main`
> **Zuvor:** erste Fassung vom 2026-09-02 auf Commit `88be12e`
>
> **Dieser Report ist eine Momentaufnahme.** Bei jeder Abweichung zwischen
> diesem Dokument und dem Code gilt der Code. Das ist keine Floskel: die
> erste Fassung beschrieb `settings.month_start` als fehlend, obwohl die
> Spalte zu dem Zeitpunkt bereits in `supabase/mcp-schema.sql` angelegt
> war — und diese veraltete Angabe hat später zu einer falschen Annahme
> geführt. Wer hier etwas Sicherheitsrelevantes nachschlägt, prüft es
> gegen die Datei oder die Datenbank nach.
>
> **Zeilenangaben** (`datei.ts:42`) beziehen sich auf den Stand von
> `e9e3c83` und verschieben sich mit jeder Änderung. Der Dateiname ist
> verlässlich, die Zeilennummer nur als Wegweiser gemeint.

---

## 1) TECH-STACK

### 1.1 package.json

- **name:** `finance`
- **version:** `0.0.0`
- **private:** `true`
- **type:** `module` (ESM)

**Scripts**

| Script | Befehl |
|---|---|
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `lint` | `eslint .` |
| `preview` | `vite preview` |

**dependencies**

| Paket | Range in package.json | Installiert (package-lock) |
|---|---|---|
| `@supabase/supabase-js` | `^2.107.0` | 2.107.0 |
| `jspdf` | `^4.2.1` | 4.2.1 |
| `jspdf-autotable` | `^5.0.8` | 5.0.8 |
| `react` | `^19.2.6` | 19.2.7 |
| `react-dom` | `^19.2.6` | 19.2.7 |
| `react-router-dom` | `^7.17.0` | 7.17.0 |
| `recharts` | `^3.8.1` | 3.8.1 |
| `uuid` | `^14.0.0` | 14.0.0 |

**devDependencies**

| Paket | Range | Installiert |
|---|---|---|
| `@eslint/js` | `^10.0.1` | 10.0.1 |
| `@tailwindcss/vite` | `^4.3.0` | 4.3.0 |
| `@types/node` | `^24.12.3` | 24.13.0 |
| `@types/react` | `^19.2.14` | 19.2.16 |
| `@types/react-dom` | `^19.2.3` | 19.2.3 |
| `@types/uuid` | `^10.0.0` | 10.0.0 |
| `@vitejs/plugin-react` | `^6.0.1` | 6.0.2 |
| `eslint` | `^10.3.0` | 10.4.1 |
| `eslint-plugin-react-hooks` | `^7.1.1` | 7.1.1 |
| `eslint-plugin-react-refresh` | `^0.5.2` | 0.5.2 |
| `globals` | `^17.6.0` | 17.6.0 |
| `tailwindcss` | `^4.3.0` | 4.3.0 |
| `typescript` | `~6.0.2` | 6.0.3 |
| `typescript-eslint` | `^8.59.2` | 8.60.1 |
| `vite` | `^8.0.12` | 8.0.16 |

### 1.2 Node / Paketmanager / Build / Deploy

- **Node-Version:** Es gibt **kein** `engines`-Feld in `package.json`, keine `.nvmrc`, keine `.node-version`. Die Node-Version ist also **nirgends im Repo festgeschrieben**. Lokal installiert ist Node `v24.14.0`, npm `11.9.0`.
- **Package-Manager:** npm — `package-lock.json` mit `lockfileVersion: 3` ist vorhanden; kein `yarn.lock`, kein `pnpm-lock.yaml`.
- **Build-Tool:** Vite 8 (`vite.config.ts`) mit den Plugins `@vitejs/plugin-react` und `@tailwindcss/vite`. Build läuft zuerst durch `tsc -b` (Project References: `tsconfig.app.json` für `src`, `tsconfig.node.json`).
- **TypeScript-Konfiguration (`tsconfig.app.json`):** target `es2023`, lib `ES2023`+`DOM`, module `esnext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `types: ["vite/client"]`.
- **Deploy-Ziel:** **Vercel** (`vercel.json`). Bis zum Umzug lief das Projekt auf Netlify; `netlify.toml` liegt weiterhin im Repo, ist aber mit einem Kommentar als ausser Betrieb markiert und wird von Vercel ignoriert. Historisch (Netlify):
  ```toml
  [build]
    command = "npm run build"
    publish = "dist"

  [[redirects]]
    from = "/*"
    to = "/index.html"
    status = 200
  ```
  SPA-Fallback-Redirect ist gesetzt. Der `dist/`-Ordner ist gitignored, existiert aber lokal.
- **Dev-Server:** `.claude/launch.json` definiert „Finance (Vite Dev)" auf Port **5173** und „Finance (Preview Build)" auf Port **4173**.
- **Aktive Vercel-Konfiguration** (`vercel.json`): vier Rewrites vor der SPA-Catchall — `/mcp` und `/mcp/(.*)` als Proxy auf die Supabase Edge Function, `/authorize` und `/token` auf die OAuth-Endpunkte von Supabase Auth. Reihenfolge ist wesentlich: die Catchall `/(.*)` → `/index.html` steht zuletzt, sonst würde sie alles abfangen.
- **Backend:** Supabase (PostgreSQL + Auth + Row Level Security + Realtime) — **plus eine Edge Function** unter `supabase/functions/mcp/` (MCP-Server, Deno). `supabase/config.toml` existiert inzwischen (setzt `verify_jwt = false` für diese Function). Weiterhin **kein** `supabase/migrations/`-Ordner und keine Migrationsverwaltung — nur lose `.sql`-Dateien, die manuell im SQL-Editor auszuführen sind.
- **Alt-Artefakt:** `db.json` im Root ist ein `json-server`-Schema (`"$schema": "./node_modules/json-server/schema.json"`) aus einer früheren Entwicklungsstufe. `json-server` ist **nicht** mehr in `package.json` enthalten; die Datei ist gitignored und wird von keinem Code gelesen.

---

## 2) DATENBANK-SCHEMA

> **Wichtig für alles, was jetzt folgt:** Die in 2.1 bis 2.8 gezeigten
> RLS-Policies beschreiben den Stand **vor** der MCP-Migration. Sie sind
> nicht mehr aktuell.
>
> `supabase/mcp-schema.sql` hat inzwischen jede der sieben `FOR ALL`-Policies
> durch **vier getrennte** Policies ersetzt (SELECT / INSERT / UPDATE / DELETE)
> und dabei `auth.uid()` durch `public.jwt_user_id()` getauscht. Der Grund für
> beides steht in 2.12. Der verbindliche Stand steht in `mcp-schema.sql`,
> Abschnitt 8, sowie in der Prüfliste am Ende jener Datei.
>
> Die Tabellendefinitionen (Spalten, Typen, Constraints, Indizes) unten stimmen
> weiterhin — ergänzt um die in 2.12 genannten neuen Spalten.

Quellen im Repo:

| Datei | Rolle |
|---|---|
| `supabase/schema.sql` | Hauptschema v2: `budgets`, `transactions`, `categories`, `settings`, `recurring_transactions` |
| `supabase/fix-rls.sql` | Ersetzt alle fünf RLS-Policies durch Varianten **mit** `WITH CHECK` |
| `supabase/fix-transactions.sql` | `DROP TABLE transactions CASCADE` + Neuanlage (identisch zu schema.sql, Policy mit `WITH CHECK`) |
| `supabase/fix-recurring.sql` | `DROP TABLE recurring_transactions CASCADE` + Neuanlage (identisch, Policy mit `WITH CHECK`) |
| `supabase/savings-pots.sql` | `savings_pots`, `pot_allocations`, 5 Functions, 4 Trigger |

Es gibt **keine** Reihenfolge-/Versionsverwaltung. Der maßgebliche Endzustand ergibt sich aus: `schema.sql` → `savings-pots.sql` → `fix-*.sql` (die `fix-`-Dateien überschreiben die Policies bzw. die Tabellen).

> **Achtung `fix-transactions.sql`:** `DROP TABLE transactions CASCADE` löscht mit der Tabelle auch die Trigger `trg_distribute_income` / `trg_redistribute_income` sowie alle `pot_allocations`-Zeilen (FK auf `transactions.id` mit `ON DELETE CASCADE`). Nach Ausführung dieser Datei muss `savings-pots.sql` erneut gelaufen sein, sonst existiert die Spartöpfe-Verteilung nicht mehr.

---

### 2.1 Tabelle `budgets`

Quelle: `supabase/schema.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | `UUID` | ja (PK) | `gen_random_uuid()` |
| `user_id` | `UUID` | **ja** | – |
| `name` | `TEXT` | **ja** | `'Persönlich'` |
| `type` | `TEXT` | **ja** | `'personal'` |
| `starting_balance` | `NUMERIC(12,2)` | **ja** | `0` |
| `color` | `TEXT` | **ja** | `'#4A6FA5'` |
| `created_at` | `TIMESTAMPTZ` | **ja** | `now()` |

- **Primary Key:** `budgets_pkey` auf `(id)`
- **Foreign Keys:** `user_id → auth.users(id) ON DELETE CASCADE`
- **Check Constraints:** `type IN ('personal', 'business')`
- **Unique Constraints:** keine (außer PK)
- **Indizes:** `budgets_user` auf `(user_id, created_at)`
- **RLS:** aktiviert

**Policies**

```sql
-- schema.sql (Ursprung)
CREATE POLICY "Eigene Budgets" ON budgets
  FOR ALL USING (auth.uid() = user_id);

-- fix-rls.sql (aktueller Stand — ersetzt obige)
DROP POLICY IF EXISTS "Eigene Budgets" ON budgets;
CREATE POLICY "Eigene Budgets" ON budgets
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Eine einzige Policy mit `FOR ALL` deckt SELECT, INSERT, UPDATE und DELETE ab. Es gibt keine getrennten Policies pro Operation.

- **Trigger:** keine

---

### 2.2 Tabelle `transactions`

Quelle: `supabase/schema.sql`, identisch neu angelegt in `supabase/fix-transactions.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | `UUID` | ja (PK) | `gen_random_uuid()` |
| `user_id` | `UUID` | **ja** | – |
| `budget_id` | `UUID` | nein (NULL erlaubt) | – |
| `date` | `DATE` | **ja** | – |
| `type` | `TEXT` | **ja** | – |
| `amount` | `NUMERIC(12,2)` | **ja** | – |
| **`category`** | `TEXT` | **ja** | `''` |
| `description` | `TEXT` | **ja** | `''` |
| `note` | `TEXT` | nein | `''` |
| `created_at` | `TIMESTAMPTZ` | **ja** | `now()` |

- **Primary Key:** `(id)`
- **Foreign Keys:**
  - `user_id → auth.users(id) ON DELETE CASCADE`
  - `budget_id → budgets(id) ON DELETE CASCADE`
- **Check Constraints:**
  - `type IN ('income', 'expense')`
  - `amount > 0` — **Beträge sind immer positiv**; das Vorzeichen steckt ausschließlich in `type`
- **Unique Constraints:** keine
- **Indizes:** `transactions_user_budget_date` auf `(user_id, budget_id, date DESC)`
- **RLS:** aktiviert

**Policies**

```sql
-- schema.sql
CREATE POLICY "Eigene Transaktionen" ON transactions
  FOR ALL USING (auth.uid() = user_id);

-- fix-rls.sql / fix-transactions.sql (aktueller Stand)
CREATE POLICY "Eigene Transaktionen" ON transactions
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Trigger** (aus `supabase/savings-pots.sql`)

```sql
DROP TRIGGER IF EXISTS trg_distribute_income ON transactions;
CREATE TRIGGER trg_distribute_income
  AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION tx_insert_distribute();

DROP TRIGGER IF EXISTS trg_redistribute_income ON transactions;
CREATE TRIGGER trg_redistribute_income
  AFTER UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION tx_update_redistribute();
```

Es existiert **kein** DELETE-Trigger auf `transactions`; das Zurückbuchen beim Löschen läuft über den FK-CASCADE von `pot_allocations.income_transaction_id` und den DELETE-Zweig von `sync_pot_current_amount()`.

---

### 2.3 `category` vs. `category_id` — die historische Inkonsistenz

**Ergebnis der Prüfung:**

- In **allen** SQL-Dateien heißt die Spalte **`category`** (Typ `TEXT`, `NOT NULL DEFAULT ''`) — sowohl in `transactions` als auch in `recurring_transactions`. Eine Spalte `category_id` existiert im Schema **nirgends**.
- Der **aktive** Datenzugriffspfad (`src/lib/supabaseAdapter.ts`) verwendet durchgängig `category`.
- **Erledigt seit Commit `724faf4`:** Die einzige Stelle, die je `category_id` verwendete, war `src/api.ts`. Diese Datei ist gelöscht. Der folgende Absatz beschreibt den historischen Zustand und ist nur noch als Hintergrund zu lesen:

- **`src/api.ts` verwendete `category_id`** — an drei Stellen:

  ```
  src/api.ts:24      category:    String(row.category_id ?? ''),
  src/api.ts:63      category_id: t.category,
  src/api.ts:103     category_id: t.category,
  ```

  Die Datei war **toter Code** — von keiner anderen Datei importiert — und zusätzlich veraltet, weil sie `budget_id` gar nicht kannte und in `createDefaultSettings` / `updateSettings` mit `onConflict: 'user_id'` arbeitete; dieses Unique-Constraint existiert seit Schema v2 nicht mehr (siehe 2.5).

- **Semantik von `category`:** Die Spalte enthält den **Kategorie-Namen als Freitext**, nicht die Kategorie-ID. Belege:
  - `src/pages/NewTransaction.tsx` — `catOptions` wird aus `categories.filter(...).map(c => c.name)` gebildet, der Formularwert `category` ist dieser Name.
  - `src/pages/Analysis.tsx:100` — Rückverknüpfung erfolgt über den Namen: `const catObj = categories.find(c => c.name === cat);`
  - `src/utils.ts` `groupByCategory()` gruppiert direkt über `t.category`.
  - `src/pages/Settings.tsx` bucht Abgleichs-Korrekturen mit `category: 'Korrektur'` — ein Name, der in `categories` gar nicht angelegt sein muss.
  - Es gibt **keinen Foreign Key** von `transactions.category` auf `categories`.

**Fazit (Stand `e9e3c83`):** Die Inkonsistenz ist **vollständig beseitigt**. `src/api.ts` wurde in Commit `724faf4` gelöscht, nachdem geprüft war, dass keine Import-Anweisung im Repo darauf zeigt und keiner der zehn exportierten Namen ausserhalb der Datei importiert wird. Es gibt im gesamten Code keine Erwähnung von `category_id` mehr. Der Zugriffspfad ist durchgehend `category` (Kategoriename als Freitext).

---

### 2.4 Tabelle `categories`

Quelle: `supabase/schema.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | **`TEXT`** | ja (PK) | – |
| `user_id` | `UUID` | **ja** | – |
| `budget_id` | `UUID` | nein | – |
| `name` | `TEXT` | **ja** | – |
| `type` | `TEXT` | **ja** | – |
| `monthly_budget` | `NUMERIC(12,2)` | nein | – (NULL) |

- **Primary Key:** `(id)` — bewusst `TEXT`, weil das Frontend eigene IDs vergibt (Kommentar in der SQL-Datei: „id ist TEXT, weil das Frontend eigene IDs wie 'cat-exp-1-abc123' vergibt")
- **Foreign Keys:**
  - `user_id → auth.users(id) ON DELETE CASCADE`
  - `budget_id → budgets(id) ON DELETE CASCADE`
- **Check Constraints:** `type IN ('income', 'expense')`
- **Unique Constraints:** keine über `(user_id, budget_id, name, type)` — Duplikate sind auf DB-Ebene möglich; Duplikatschutz existiert nur clientseitig in `MainApp.tsx:140`.
- **Indizes:** keine explizit angelegt (nur PK-Index)
- **RLS:** aktiviert

**Policies**

```sql
-- schema.sql
CREATE POLICY "Eigene Kategorien" ON categories
  FOR ALL USING (auth.uid() = user_id);

-- fix-rls.sql (aktueller Stand)
CREATE POLICY "Eigene Kategorien" ON categories
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- **Trigger:** keine

**Von der App verwendete ID-Muster** (kein DB-Constraint, nur Konvention):

| Ort | Muster |
|---|---|
| `supabaseAdapter.ts:140-150` (`initializeNewUser`) | `cat-exp-1-${userId}` … `cat-inc-4-${userId}` |
| `supabaseAdapter.ts:248` (`getCategories`-Seeding) | `cat-${type.slice(0,3)}-${i+1}-${userId.slice(0,6)}` |
| `MainApp.tsx:145` (neue Kategorie durch Nutzer) | `uuidv4()` |
| `localStorageAdapter.ts:33-45` (Gastmodus) | `cat-exp-1` … `cat-inc-4` (ohne Suffix) |

---

### 2.5 Tabelle `settings`

Quelle: `supabase/schema.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | `UUID` | ja (PK) | `gen_random_uuid()` |
| `user_id` | `UUID` | **ja** | – |
| `budget_id` | `UUID` | nein | – |
| `starting_balance` | `NUMERIC(12,2)` | **ja** | `0` |
| `name` | `TEXT` | **ja** | `''` |

- **Primary Key:** `(id)`
- **Foreign Keys:**
  - `user_id → auth.users(id) ON DELETE CASCADE`
  - `budget_id → budgets(id) ON DELETE CASCADE`
- **Unique Constraints:** `UNIQUE (user_id, budget_id)` — laut Kommentar in `schema.sql` „(ersetzt altes UNIQUE user_id)". Hinweis: Da `budget_id` NULL zulässt und Postgres NULLs im Unique-Index als verschieden behandelt, verhindert dieses Constraint **keine** mehrfachen Zeilen mit `budget_id IS NULL`. Genau darauf reagiert `initializeNewUser()` mit einem vorsorglichen Delete verwaister Settings (`supabaseAdapter.ts:93-97`).
- **Indizes:** PK-Index + Unique-Index aus dem Constraint
- **RLS:** aktiviert

**Policies**

```sql
-- schema.sql
CREATE POLICY "Eigene Settings" ON settings
  FOR ALL USING (auth.uid() = user_id);

-- fix-rls.sql (aktueller Stand)
CREATE POLICY "Eigene Settings" ON settings
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- **Trigger:** keine

> **`month_start` — inzwischen angelegt und ausgeführt.** In der ersten Fassung dieses Reports stand hier, die Spalte fehle in allen Migrationen. Das stimmte für die damals betrachteten Dateien, war aber schon zum Zeitpunkt der Analyse überholt.
>
> **Heutiger Stand:** Die Spalte existiert in der Produktivdatenbank als
> `month_start integer NOT NULL DEFAULT 1` mit `CHECK (month_start >= 1 AND month_start <= 28)`.
> Angelegt wird sie von **zwei** Dateien, beide idempotent und mit demselben
> Constraint-Namen `settings_month_start_check`, sie stören sich also nicht:
>
> - `supabase/mcp-schema.sql` (Abschnitt 2) — dort als Beifang der MCP-Migration
> - `supabase/settings-month-start.sql` (Commit `6124cea`) — die eigenständige
>   Migration, die zusätzlich `DEFAULT 1` setzt, bestehende `NULL`-Werte auffüllt
>   und die Spalte auf `NOT NULL` zieht
>
> Der Grund für die zweite Datei: `month_start` ist Kernfunktion der App und hat
> mit dem MCP-Zugriff nichts zu tun. Wer die Datenbank ohne den MCP-Teil aufsetzt,
> bekäme sonst eine App, die auf eine fehlende Spalte schreibt.
>
> Historischer Hintergrund — der Code las und schrieb die Spalte schon vorher:
> ```
> src/lib/supabaseAdapter.ts:40    monthStart: row.month_start != null ? toNum(row.month_start) : undefined,
> src/lib/supabaseAdapter.ts:316   if (patch.monthStart !== undefined) dbPatch.month_start = patch.monthStart;
> ```
> In **keiner** `.sql`-Datei des Repos wird diese Spalte angelegt. Entweder existiert sie nur in der Live-Datenbank (manuell hinzugefügt, Migration fehlt im Repo) — oder jedes `updateSettings({ monthStart })` schlägt fehl. Siehe Abschnitt 7.

---

### 2.6 Tabelle `recurring_transactions`

Quelle: `supabase/schema.sql`, identisch neu angelegt in `supabase/fix-recurring.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | `UUID` | ja (PK) | `gen_random_uuid()` |
| `user_id` | `UUID` | **ja** | – |
| `budget_id` | `UUID` | nein | – |
| `amount` | `NUMERIC(12,2)` | **ja** | – |
| `type` | `TEXT` | **ja** | – |
| **`category`** | `TEXT` | **ja** | `''` |
| `description` | `TEXT` | **ja** | – (kein Default) |
| `note` | `TEXT` | nein | – (NULL) |
| `frequency` | `TEXT` | **ja** | – |
| `start_date` | `DATE` | **ja** | – |
| `end_date` | `DATE` | nein | – |
| `next_due` | `DATE` | **ja** | – |
| `last_executed` | `DATE` | nein | – |
| `is_active` | `BOOLEAN` | **ja** | `true` |
| `created_at` | `TIMESTAMPTZ` | **ja** | `now()` |

- **Primary Key:** `(id)`
- **Foreign Keys:**
  - `user_id → auth.users(id) ON DELETE CASCADE`
  - `budget_id → budgets(id) ON DELETE CASCADE`
- **Check Constraints:**
  - `amount > 0`
  - `type IN ('income', 'expense')`
  - `frequency IN ('daily', 'weekly', 'monthly', 'yearly')`
- **Unique Constraints:** keine
- **Indizes:** `recurring_user_budget_due` auf `(user_id, budget_id, next_due, is_active)`
- **RLS:** aktiviert

**Policies**

```sql
-- schema.sql
CREATE POLICY "Eigene Dauerauftraege" ON recurring_transactions
  FOR ALL USING (auth.uid() = user_id);

-- fix-rls.sql / fix-recurring.sql (aktueller Stand)
CREATE POLICY "Eigene Dauerauftraege" ON recurring_transactions
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- **Trigger:** keine

---

### 2.7 Tabelle `savings_pots`

Quelle: `supabase/savings-pots.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | `UUID` | ja (PK) | `gen_random_uuid()` |
| `user_id` | `UUID` | **ja** | – |
| `budget_id` | `UUID` | **ja** (im Gegensatz zu allen anderen Tabellen) | – |
| `name` | `TEXT` | **ja** | – |
| `allocation_percent` | `NUMERIC(5,2)` | **ja** | `0` |
| `target_amount` | `NUMERIC(12,2)` | nein | – (NULL) |
| `current_amount` | `NUMERIC(12,2)` | **ja** | `0` |
| `color` | `TEXT` | **ja** | `'#4A6FA5'` |
| `icon` | `TEXT` | nein | – (NULL) |
| `sort_order` | `INT` | **ja** | `0` |
| `created_at` | `TIMESTAMPTZ` | **ja** | `now()` |
| `updated_at` | `TIMESTAMPTZ` | **ja** | `now()` |

- **Primary Key:** `(id)`
- **Foreign Keys:**
  - `user_id → auth.users(id) ON DELETE CASCADE`
  - `budget_id → budgets(id) ON DELETE CASCADE`
- **Check Constraints:**
  - `allocation_percent >= 0 AND allocation_percent <= 100`
  - `target_amount IS NULL OR target_amount >= 0`
- **Unique Constraints:** keine
- **Indizes:** `savings_pots_user_budget` auf `(user_id, budget_id, sort_order)`
- **RLS:** aktiviert

**Policy**

```sql
DROP POLICY IF EXISTS "Eigene Sparttöpfe" ON savings_pots;
CREATE POLICY "Eigene Sparttöpfe" ON savings_pots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Trigger**

```sql
DROP TRIGGER IF EXISTS trg_check_pot_sum ON savings_pots;
CREATE TRIGGER trg_check_pot_sum
  BEFORE INSERT OR UPDATE ON savings_pots
  FOR EACH ROW EXECUTE FUNCTION check_pot_allocation_sum();
```

`current_amount` wird **nicht** vom Client gepflegt, sondern ausschließlich vom Trigger `trg_sync_pot_amount` auf `pot_allocations`.

---

### 2.8 Tabelle `pot_allocations`

Quelle: `supabase/savings-pots.sql`

| Spalte | Typ | NOT NULL | Default |
|---|---|---|---|
| `id` | `UUID` | ja (PK) | `gen_random_uuid()` |
| `user_id` | `UUID` | **ja** | – |
| `pot_id` | `UUID` | **ja** | – |
| `income_transaction_id` | `UUID` | **ja** | – |
| `amount` | `NUMERIC(12,2)` | **ja** | – (kein `> 0`-Check) |
| `created_at` | `TIMESTAMPTZ` | **ja** | `now()` |

- **Primary Key:** `(id)`
- **Foreign Keys:**
  - `user_id → auth.users(id) ON DELETE CASCADE`
  - `pot_id → savings_pots(id) ON DELETE CASCADE`
  - `income_transaction_id → transactions(id) ON DELETE CASCADE`
- **Check Constraints:** keine
- **Unique Constraints:** keine
- **Indizes:**
  - `pot_allocations_pot` auf `(pot_id, created_at DESC)`
  - `pot_allocations_tx` auf `(income_transaction_id)`
- **RLS:** aktiviert

**Policy**

```sql
DROP POLICY IF EXISTS "Eigene Pot-Zuweisungen" ON pot_allocations;
CREATE POLICY "Eigene Pot-Zuweisungen" ON pot_allocations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Trigger**

```sql
DROP TRIGGER IF EXISTS trg_sync_pot_amount ON pot_allocations;
CREATE TRIGGER trg_sync_pot_amount
  AFTER INSERT OR DELETE ON pot_allocations
  FOR EACH ROW EXECUTE FUNCTION sync_pot_current_amount();
```

Es gibt **keinen** UPDATE-Zweig in `sync_pot_current_amount()`. Der Rundungsrest-Ausgleich in `apply_pot_distribution()` erfolgt per `UPDATE pot_allocations SET amount = amount + remainder` — dieser UPDATE aktualisiert `savings_pots.current_amount` **nicht**. Siehe Abschnitt 7.

---

### 2.9 Functions (alle aus `supabase/savings-pots.sql`)

Alle fünf Funktionen sind `LANGUAGE plpgsql`. Vier davon sind `SECURITY DEFINER SET search_path = public, pg_temp`; `check_pot_allocation_sum()` ist es **nicht** (läuft als `SECURITY INVOKER`).

#### `sync_pot_current_amount() RETURNS TRIGGER`

```sql
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
```

#### `apply_pot_distribution(tx transactions) RETURNS void`

```sql
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
```

#### `tx_insert_distribute() RETURNS TRIGGER`

```sql
CREATE OR REPLACE FUNCTION tx_insert_distribute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM apply_pot_distribution(NEW);
  RETURN NEW;
END; $$;
```

#### `tx_update_redistribute() RETURNS TRIGGER`

```sql
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
```

#### `check_pot_allocation_sum() RETURNS TRIGGER`

```sql
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
```

### 2.10 Trigger-Übersicht

| Trigger | Tabelle | Timing / Event | Function |
|---|---|---|---|
| `trg_sync_pot_amount` | `pot_allocations` | `AFTER INSERT OR DELETE`, `FOR EACH ROW` | `sync_pot_current_amount()` |
| `trg_distribute_income` | `transactions` | `AFTER INSERT`, `FOR EACH ROW` | `tx_insert_distribute()` |
| `trg_redistribute_income` | `transactions` | `AFTER UPDATE`, `FOR EACH ROW` | `tx_update_redistribute()` |
| `trg_check_pot_sum` | `savings_pots` | `BEFORE INSERT OR UPDATE`, `FOR EACH ROW` | `check_pot_allocation_sum()` |

### 2.11 Auskommentierte Migration in `schema.sql`

Am Ende von `schema.sql` steht ein vollständig auskommentierter Migrationsblock, der Alt-Daten ohne `budget_id` einem Default-Budget zuordnet (`INSERT INTO budgets … SELECT DISTINCT user_id …`, danach `UPDATE transactions / categories / settings SET budget_id = …`). Er ist nie aktiviert.

---

### 2.12 Seit dem MCP-Ausbau hinzugekommen

Nicht in 2.1–2.11 beschrieben, weil zum Zeitpunkt der ersten Fassung noch nicht
vorhanden. Alles aus `supabase/mcp-schema.sql`, ausgeführt gegen die
Produktivdatenbank.

**Neue Spalten an bestehenden Tabellen**

| Tabelle | Spalte | Definition |
|---|---|---|
| `transactions` | `source` | `text NOT NULL DEFAULT 'app'`, CHECK `IN ('app','mcp')` — Herkunftsmarkierung |
| `settings` | `month_start` | `integer NOT NULL DEFAULT 1`, CHECK 1–28 (siehe 2.5) |
| `settings` | `show_ai_badges` | `boolean NOT NULL DEFAULT true` — reine Anzeigeeinstellung |
| `settings` | `mcp_allow_pot_creation` | `boolean NOT NULL DEFAULT true` — steuert, ob Claude Sparttöpfe anlegen darf; wird zusätzlich in der INSERT-Policy auf `savings_pots` geprüft |

**Neue Tabellen**

| Tabelle | Zweck | Besonderheit |
|---|---|---|
| `mcp_clients` | Beschriftung und Widerruf registrierter OAuth-Clients (`client_id`, `label`, `revoked_at`) | Für `anon`, `authenticated` und `mcp_agent` vollständig gesperrt; nur `mcp_fn_owner` hat eine SELECT-Policy |
| `activity_log` | Änderungsprotokoll — jede Änderung an `transactions`, `transaction_notes`, `savings_pots`, mit `actor` = `app` oder `mcp` | **Append-only:** keine UPDATE- und keine DELETE-Policy für irgendeine Rolle |
| `transaction_notes` | Notizen an Transaktionen, FK mit `ON DELETE CASCADE` | **Append-only**, unveränderlich; getrennt vom bestehenden Feld `transactions.note`, das unverändert bleibt |

**Neue Rollen**

| Rolle | Zweck |
|---|---|
| `mcp_agent` | Zielrolle für Fremdclients. Keine Default-Privileges — eine künftig angelegte Tabelle ist für sie automatisch dicht, anders als bei `authenticated`, das über `pg_default_acl` automatisch `arwdDxtm` erhält. |
| `mcp_fn_owner` | Eigentümer der SECURITY-DEFINER-Funktionen. Kein UPDATE, kein DELETE, nirgends. |

**Neue Funktionen** (alle mit `SET search_path = ''`)

| Funktion | Art | Zweck |
|---|---|---|
| `public.jwt_claims()` | Invoker, STABLE | Ersatz für `auth.jwt()` |
| `public.jwt_user_id()` | Invoker, STABLE | Ersatz für `auth.uid()` |
| `public.is_mcp_client()` | **Definer** | true, wenn das Token einen `client_id`-Claim trägt |
| `public.is_revoked_client()` | **Definer** | true, wenn dieser Client in `mcp_clients` widerrufen ist |
| `public.log_activity()` | **Definer**, Trigger | schreibt nach `activity_log` |
| `public.custom_access_token_hook(jsonb)` | Invoker | Auth-Hook, setzt `role` auf `mcp_agent` bei vorhandener `client_id` |

**Warum `auth.uid()` in allen Policies ersetzt wurde:** Das Schema `auth` gehört
`supabase_admin`. Die Rolle `postgres` kann dort keine Rechte vergeben — ein
`GRANT USAGE ON SCHEMA auth` an eine neue Rolle **warnt nur und bewirkt nichts**.
Weder `mcp_fn_owner` noch `mcp_agent` könnten die Policies also auswerten.
`public.jwt_user_id()` liest dieselbe Sitzungsvariable (`request.jwt.claims`) über
`current_setting` aus `pg_catalog` und braucht dafür kein Schemarecht.

**Neue Trigger**

`trg_log_transactions`, `trg_log_transaction_notes`, `trg_log_savings_pots` —
jeweils `AFTER INSERT OR UPDATE OR DELETE … FOR EACH ROW`, alle auf
`public.log_activity()`.

**Prüfstand:** `supabase/mcp-verify.sql` ist gegen die Produktivdatenbank
gelaufen — **24 Prüfungen, 0 Befunde, 0 übersprungen**. Details in 7.0.

---

## 3) DATENZUGRIFF IM CODE

Dateien, die `supabase` importieren:

```
src/context/AuthContext.tsx     (nur supabase.auth.*)
src/context/BudgetContext.tsx   (indirekt über supabaseAdapter)
src/hooks/useStorage.ts         (indirekt über supabaseAdapter)
src/lib/savingsPotsAdapter.ts   (direkt)
src/lib/supabase.ts             (Client-Erzeugung)
src/lib/supabaseAdapter.ts      (direkt — Hauptpfad)
src/MainApp.tsx                 (nur Realtime-Channel)
src/pages/BudgetsPage.tsx       (indirekt über createSupabaseAdapter)
src/pages/Settings.tsx          (indirekt über createSupabaseAdapter)
src/types.ts                    (nur ein Kommentar-Verweis, kein Import)
```

---

### 3.1 `src/lib/supabase.ts`

```ts
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const authRedirectTo = `${window.location.origin}/auth/callback`;
```

Wirft beim Modul-Laden einen Fehler, wenn `VITE_SUPABASE_URL` oder `VITE_SUPABASE_ANON_KEY` fehlen. Keine Options (`auth: {...}`) übergeben — es gilt die supabase-js-Voreinstellung (Session in `localStorage`, Auto-Refresh, PKCE nicht explizit gesetzt).

---

### 3.2 `src/lib/storage.ts` — Interface-Definitionen (vollständig)

```ts
export interface StorageAdapter {
  // Transactions
  getTransactions(): Promise<Transaction[]>;
  addTransaction(t: Transaction): Promise<Transaction>;
  updateTransaction(id: string, patch: Partial<Omit<Transaction, 'id'>>): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;
  deleteAllTransactions(ids: string[]): Promise<void>;
  importTransactions(txs: Transaction[]): Promise<Transaction[]>;

  // Categories
  getCategories(): Promise<Category[]>;
  addCategory(c: Category): Promise<Category>;
  updateCategory(id: string, patch: Partial<Category>): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  // Settings (per-budget)
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  // Recurring transactions
  getRecurring(): Promise<RecurringTransaction[]>;
  addRecurring(r: RecurringTransaction): Promise<RecurringTransaction>;
  updateRecurring(id: string, patch: Partial<RecurringTransaction>): Promise<RecurringTransaction>;
  deleteRecurring(id: string): Promise<void>;
}

export interface BudgetStorage {
  getBudgets(): Promise<Budget[]>;
  addBudget(b: Budget): Promise<Budget>;
  updateBudget(id: string, patch: Partial<Budget>): Promise<Budget>;
  deleteBudget(id: string): Promise<void>;
}
```

---

### 3.3 `src/lib/supabaseAdapter.ts`

**Exportierte Signaturen**

```ts
export async function initializeNewUser(userId: string): Promise<string | null>
export function createSupabaseAdapter(userId: string, budgetId: string): StorageAdapter
export function createSupabaseBudgetStorage(userId: string): BudgetStorage
```

**Interne Mapper (nicht exportiert)**

```ts
function toNum(v: unknown): number
function rowToTx(row: Record<string, unknown>): Transaction
function rowToCat(row: Record<string, unknown>): Category
function rowToSettings(row: Record<string, unknown>): Settings
function rowToBudget(row: Record<string, unknown>): Budget
function rowToRecurring(row: Record<string, unknown>): RecurringTransaction
```

`toNum()` existiert, weil Supabase `NUMERIC` als String liefert.

#### `initializeNewUser(userId)` — Reihenfolge der Operationen

| # | Tabelle | Operation | Felder / Filter |
|---|---|---|---|
| 1 | `settings` | `delete` | Filter: `.eq('user_id', userId).is('budget_id', null)` — räumt verwaiste Settings ohne Budget ab |
| 2 | `budgets` | `select('id')` | Filter: `.eq('user_id', userId).limit(1).maybeSingle()` — bereits initialisiert? Falls ja: Rückgabe der ID, Abbruch |
| 3 | `budgets` | `insert` | `id: crypto.randomUUID()`, `user_id`, `name: 'Persönlich'`, `type: 'personal'`, `starting_balance: 0`, `color: '#4A6FA5'` → `.select().single()` |
| 4 | `settings` | `upsert` | `{ user_id, budget_id, starting_balance: 0, name: '' }`, `onConflict: 'user_id,budget_id'` |
| 5 | `categories` | `upsert` | 11 Zeilen `{ id: 'cat-exp-1-${userId}' … 'cat-inc-4-${userId}', name, type, user_id, budget_id }`, `onConflict: 'id'`, `ignoreDuplicates: true` |

Rückgabe: `budgetId` oder `null` bei Fehler beim Budget-Insert.

#### `createSupabaseAdapter(userId, budgetId)` — Operationen im Detail

| Methode | Tabelle | Operation | Gesetzte Felder | Filter / Optionen |
|---|---|---|---|---|
| `getTransactions()` | `transactions` | `select('*')` | – | `.eq('user_id', userId)` `.eq('budget_id', budgetId)` `.order('date', {ascending:false})` `.order('created_at', {ascending:false})` |
| `addTransaction(t)` | `transactions` | `insert` | `id, user_id, budget_id, date, type, amount, category, description, note` (`note: t.note ?? ''`) | `.select().single()` |
| `updateTransaction(id, patch)` | `transactions` | `update` | dynamisch, nur bei `!== undefined`: `date, type, amount, category, description, note` | `.eq('id', id)` `.eq('user_id', userId)` `.select().single()` — **kein** `budget_id`-Filter |
| `deleteTransaction(id)` | `transactions` | `delete` | – | `.eq('id', id)` `.eq('user_id', userId)` — **kein** `budget_id`-Filter |
| `deleteAllTransactions(ids)` | `transactions` | `delete` | – | `.in('id', ids)` `.eq('user_id', userId)` `.eq('budget_id', budgetId)`; Early return bei leerem Array |
| `importTransactions(txs)` | `transactions` | `insert` (Batch) | pro Zeile: `id, user_id, budget_id, date, type, amount, category, description, note` | `.select()`; Early return `[]` bei leerem Array |
| `getCategories()` | `categories` | `select('*')` | – | `.eq('user_id', userId)` `.eq('budget_id', budgetId)` `.order('type')` `.order('name')` |
| ↳ Fallback bei 0 Treffern | `categories` | `select('id')` | – | `.eq('user_id', userId).limit(1)` — wenn Kategorien in anderen Budgets existieren: leeres Array zurück, **kein** Seeding |
| ↳ Seeding | `categories` | `upsert` | 11 Zeilen `{ id: 'cat-${type.slice(0,3)}-${i+1}-${userId.slice(0,6)}', user_id, budget_id, name, type }` | `onConflict: 'id'`, `ignoreDuplicates: true`, `.select()` |
| `addCategory(c)` | `categories` | `insert` | `id, user_id, budget_id, name, type` — **`monthly_budget` wird nicht gesetzt** | `.select().single()` |
| `updateCategory(id, patch)` | `categories` | `update` | dynamisch: `name`, `monthly_budget` (aus `patch.monthlyBudget`) — **`type` ist nicht änderbar** | `.eq('id', id)` `.eq('user_id', userId)` `.select().single()` |
| `deleteCategory(id)` | `categories` | `delete` | – | `.eq('id', id)` `.eq('user_id', userId)` |
| `getSettings()` | `settings` | `select('*')` | – | `.eq('user_id', userId)` `.eq('budget_id', budgetId)` `.maybeSingle()` |
| ↳ falls nicht vorhanden | `settings` | `upsert` | `{ user_id, budget_id, starting_balance: 0, name: '' }` | `onConflict: 'user_id,budget_id'`, `.select().single()` |
| `updateSettings(patch)` | `settings` | `upsert` | immer `user_id, budget_id`; dynamisch: `starting_balance`, `name`, **`month_start`** | `onConflict: 'user_id,budget_id'`, `.select().single()` |
| `getRecurring()` | `recurring_transactions` | `select('*')` | – | `.eq('user_id', userId)` `.eq('budget_id', budgetId)` `.order('created_at', {ascending:false})` |
| `addRecurring(r)` | `recurring_transactions` | `insert` | `id, user_id, budget_id, amount, type, category, description, note (?? null), frequency, start_date, end_date (?? null), next_due, last_executed (?? null), is_active` | `.select().single()` |
| `updateRecurring(id, patch)` | `recurring_transactions` | `update` | dynamisch: `next_due, last_executed, is_active, end_date, amount, category, description, frequency` — **`type`, `note`, `start_date` sind nicht patchbar** | `.eq('id', id)` `.eq('user_id', userId)` `.select().single()` |
| `deleteRecurring(id)` | `recurring_transactions` | `delete` | – | `.eq('id', id)` `.eq('user_id', userId)` |

#### `createSupabaseBudgetStorage(userId)`

| Methode | Tabelle | Operation | Felder | Filter |
|---|---|---|---|---|
| `getBudgets()` | `budgets` | `select('*')` | – | `.eq('user_id', userId)` `.order('created_at')` |
| `addBudget(b)` | `budgets` | `insert` | `id, user_id, name, type, starting_balance, color` — **`created_at` kommt aus dem DB-Default**, nicht aus `b.createdAt` | `.select().single()` |
| `updateBudget(id, patch)` | `budgets` | `update` | dynamisch: `name, type, starting_balance, color` | `.eq('id', id)` `.eq('user_id', userId)` `.select().single()` |
| `deleteBudget(id)` | `budgets` | `delete` | – | `.eq('id', id)` `.eq('user_id', userId)` |

Fehlerbehandlung überall identisch: `console.error('[Supabase Error]', error.message, error); throw new Error(error.message);`

---

### 3.4 `src/lib/savingsPotsAdapter.ts`

**Exportierte Signaturen**

```ts
export interface SavingsPotsStorage {
  getPots(): Promise<SavingsPot[]>;
  addPot(p: Omit<SavingsPot, 'currentAmount' | 'createdAt' | 'updatedAt'>): Promise<SavingsPot>;
  updatePot(
    id: string,
    patch: Partial<Omit<SavingsPot, 'id' | 'budgetId' | 'currentAmount' | 'createdAt' | 'updatedAt'>>,
  ): Promise<SavingsPot>;
  deletePot(id: string): Promise<void>;
  getAllocations(potId: string, limit?: number): Promise<PotAllocation[]>;
}

export function createSavingsPotsAdapter(userId: string, budgetId: string): SavingsPotsStorage
```

**Interne Mapper:** `toNum(v: unknown): number`, `rowToPot(row): SavingsPot`, `rowToAllocation(row): PotAllocation`

| Methode | Tabelle | Operation | Felder | Filter |
|---|---|---|---|---|
| `getPots()` | `savings_pots` | `select('*')` | – | `.eq('user_id', userId)` `.eq('budget_id', budgetId)` `.order('sort_order', {ascending:true})` `.order('created_at', {ascending:true})` |
| `addPot(p)` | `savings_pots` | `insert` | `id, user_id, budget_id, name, allocation_percent, target_amount (?? null), color, icon (?? null), sort_order` — **`current_amount` wird bewusst nicht gesetzt** (DB-Default 0, danach Trigger) | `.select().single()` |
| `updatePot(id, patch)` | `savings_pots` | `update` | dynamisch: `name, allocation_percent, target_amount, color, icon, sort_order` | `.eq('id', id)` `.eq('user_id', userId)` `.select().single()` |
| `deletePot(id)` | `savings_pots` | `delete` | – | `.eq('id', id)` `.eq('user_id', userId)` |
| `getAllocations(potId, limit = 20)` | `pot_allocations` | `select('*')` | – | `.eq('user_id', userId)` `.eq('pot_id', potId)` `.order('created_at', {ascending:false})` `.limit(limit)` |

Es gibt **keine** schreibende Operation auf `pot_allocations` im Client — Einträge entstehen ausschließlich durch DB-Trigger.

---

### 3.5 `src/lib/localStorageAdapter.ts` (Gastmodus)

**Exportierte Signaturen**

```ts
export const GUEST_BUDGETS_KEY = 'ft_guest_budgets';
export const GUEST_ACTIVE_KEY  = 'ft_guest_active_budget_id';

export function createLocalStorageAdapter(budgetId: string): StorageAdapter
export function createLocalBudgetStorage(): BudgetStorage
export function hasGuestData(): boolean
export function getAllGuestData(): {
  budgets: Budget[];
  transactions: Transaction[];
  categories: Category[];
  recurring: RecurringTransaction[];
}
export function clearAllGuestData(): void
```

**Interne Key-Funktionen**

```ts
function txKey(budgetId: string)  { return `ft_${budgetId}_tx`; }
function catKey(budgetId: string) { return `ft_${budgetId}_cats`; }
function setKey(budgetId: string) { return `ft_${budgetId}_settings`; }
function recKey(budgetId: string) { return `ft_${budgetId}_recurring`; }
```

Implementiert dasselbe `StorageAdapter`-Interface, aber gegen `localStorage`. `getSettings()` liefert bei fehlendem Eintrag `{ id: budgetId, startingBalance: 0, name: '' }`. `deleteBudget(id)` entfernt zusätzlich die vier scoped Keys.

---

### 3.6 `src/lib/receiptStorage.ts` (Belege — rein localStorage)

```ts
export function saveReceipt(txId: string, dataUrl: string): void
export function getReceipt(txId: string): string | null
export function deleteReceipt(txId: string): void
export function hasReceipt(txId: string): boolean
export async function fileToDataUrl(file: File, maxPx = 1400, quality = 0.82): Promise<string>
export function printReceipt(dataUrl: string, label: string): void
```

Key-Präfix: `receipt:` + `txId`. Bilder werden auf max. 1400 px skaliert und als JPEG (Qualität 0,82) als Data-URL gespeichert; Nicht-Bilder (z. B. PDF) unverändert. **Belege werden nie in Supabase abgelegt** — sie existieren nur im Browser des Geräts und gehen bei Gerätewechsel verloren.

---

### 3.7 `src/api.ts` — **gelöscht in Commit `724faf4`**

Die Datei existiert nicht mehr. Der folgende Abschnitt bleibt als Beleg dafür
stehen, was sie enthielt und warum sie entfernt wurde — er beschreibt keinen
aktuellen Zustand.

<details>
<summary>Historischer Stand (aufklappen)</summary>



Vollständige exportierte Signaturen (zur Dokumentation; **keine dieser Funktionen wird aufgerufen**):

```ts
export async function fetchTransactions(): Promise<Transaction[]>
export async function createTransaction(t: Transaction): Promise<Transaction>
export async function deleteTransaction(id: string): Promise<void>
export async function deleteAllTransactions(ids: string[]): Promise<void>
export async function importTransactions(txs: Transaction[]): Promise<Transaction[]>
export async function fetchCategories(): Promise<Category[]>
export async function createCategory(c: Category): Promise<Category>
export async function deleteCategory(id: string): Promise<void>
export async function fetchSettings(): Promise<Settings>
export async function updateSettings(s: Partial<Omit<Settings, 'id'>>): Promise<Settings>
```

Interne: `getUserId(): Promise<string>` (über `supabase.auth.getUser()`), `toNum`, `rowToTransaction`, `rowToSettings`, `seedDefaultCategories(userId)`, `createDefaultSettings(userId)`.

Abweichungen vom aktuellen Schema:
- schreibt/liest `category_id` statt `category`
- kennt `budget_id` nicht (weder Filter noch Insert)
- `onConflict: 'user_id'` auf `settings` — dieses Constraint existiert nicht mehr
- `fetchSettings()` verwendet `.maybeSingle()` ohne `budget_id`-Filter → würde bei mehreren Budgets einen „multiple rows"-Fehler auslösen

</details>

---

### 3.8 `src/context/AuthContext.tsx`

```ts
interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
export function AuthProvider({ children }: { children: ReactNode })
export function useAuth(): AuthContextValue
```

Supabase-Aufrufe:

| Stelle | Aufruf |
|---|---|
| `useEffect` (Mount) | `supabase.auth.getSession()` |
| `useEffect` (Mount) | `supabase.auth.onAuthStateChange((_event, session) => …)`, Cleanup via `subscription.unsubscribe()` |
| `signIn` | `supabase.auth.signInWithPassword({ email, password })` |
| `signUp` | `supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectTo } })` |
| `signOut` | `supabase.auth.signOut()` |

---

### 3.9 `src/context/BudgetContext.tsx`

```ts
interface BudgetContextValue {
  budgets: Budget[];
  activeBudgetId: string | null;
  activeBudget: Budget | null;
  defaultBudgetId: string | null;
  loadingBudgets: boolean;
  setActiveBudgetId: (id: string) => void;
  setDefaultBudgetId: (id: string) => void;
  createBudget: (name: string, type: Budget['type'], startingBalance: number, color: string) => Promise<Budget>;
  updateBudget: (id: string, patch: Partial<Budget>) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  refreshBudgets: () => Promise<void>;
}
export function BudgetProvider({ children }: { children: ReactNode })
export function useBudget(): BudgetContextValue
export { GUEST_BUDGETS_KEY }
```

Datenpfad: `getStorage()` liefert `createSupabaseBudgetStorage(user.id)` bei eingeloggtem Nutzer, sonst `createLocalBudgetStorage()`. `refreshBudgets()` ruft bei eingeloggtem Nutzer zuerst `initializeNewUser(user.id)` auf.

Konstanten: `ACCENT = '#4A6FA5'`, `DEFAULT_BUDGET_KEY = 'finance:defaultBudget'`.

---

### 3.10 `src/hooks/useStorage.ts`

```ts
export function useStorage(budgetId: string | null): StorageAdapter | null
```

`null` bei fehlender `budgetId`; sonst `createSupabaseAdapter(user.id, budgetId)` (eingeloggt) bzw. `createLocalStorageAdapter(budgetId)` (Gast). Memoisiert über `[user, budgetId]`.

---

### 3.11 `src/MainApp.tsx` — Realtime

```ts
useEffect(() => {
  if (!user || !activeBudgetId) return;
  const channel = supabase
    .channel(`tx-${user.id}-${activeBudgetId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'transactions',
      filter: `user_id=eq.${user.id}`,
    }, () => loadData())
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [user, activeBudgetId, loadData]);
```

Filter nur auf `user_id`, nicht auf `budget_id` — jede Änderung an irgendeiner Transaktion des Nutzers löst ein vollständiges Neuladen des aktiven Budgets aus. Nur `transactions` wird überwacht; `categories`, `settings`, `budgets`, `savings_pots`, `activity_log` und `transaction_notes` nicht.

Weitere exportierte Handler-Signaturen in `MainApp.tsx`:

```ts
async function handleCreate(t: Transaction)
async function handleUpdateTransaction(id: string, patch: Partial<Omit<Transaction, 'id'>>)
async function handleDelete(id: string)
async function handleAddCategory(name: string, type: 'income' | 'expense')
async function handleDeleteCategory(id: string)
async function handleUpdateCategory(id: string, patch: { monthlyBudget?: number })
async function handleSaveSettings(s: Partial<Omit<Settings, 'id'>>)
async function handleImportTransactions(txs: Transaction[])
async function handleResetAllTransactions()
async function handleDeleteTransactionsByPeriod(from: string, to: string)
async function handleMigrateImport()
function handleMigrateDiscard()
```

---

### 3.12 `src/pages/BudgetsPage.tsx` und `src/pages/Settings.tsx`

Beide erzeugen **ad hoc Adapter für fremde Budgets**, um bereichsübergreifend zu lesen bzw. zu schreiben:

```ts
const adapter = user
  ? createSupabaseAdapter(user.id, b.id)
  : createLocalStorageAdapter(b.id);
```

- `BudgetsPage.tsx:45-72` — für **jedes** Budget parallel `adapter.getTransactions()` + `adapter.getSettings()`; daraus Kontostände, `txByBudget`, `startByBudget`.
- `Settings.tsx:139-158` (`loadAllBalances`) — dasselbe, aber nur die Salden; wird erst geladen, wenn der Nutzer beim Abgleich auf „Alle Bereiche" umschaltet.
- `Settings.tsx:198-203` — Korrekturbuchung in ein **anderes** Budget: `adapter.importTransactions([tx])`.

---

### 3.13 `src/pages/SavingsPotsPage.tsx`

Erzeugt bei jeder Aktion einen frischen Adapter: `createSavingsPotsAdapter(user.id, activeBudgetId)`. Aufgerufene Operationen: `getPots()`, `addPot()`, `updatePot()`, `deletePot()`, `getAllocations(potId)`.

---

## 4) TYPEN

`src/types.ts` — vollständig im Wortlaut:

```ts
// ── Core entities ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  date: string;           // ISO date "YYYY-MM-DD"
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  note?: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  monthlyBudget?: number; // optional per-category spending limit
}

export interface Settings {
  id: string;
  startingBalance: number;
  name: string;
  monthStart?: number; // day of month (1–28) when the billing period begins
}

// ── Budget (workspace) ────────────────────────────────────────────────────────

export interface Budget {
  id: string;
  name: string;
  type: 'personal' | 'business';
  startingBalance: number;
  color: string;    // hex, e.g. "#4A6FA5"
  createdAt: string;
}

// ── Savings pots (Sparttöpfe) ─────────────────────────────────────────────────
// Nur für eingeloggte Nutzer. Verteilung/Rückabwicklung laufen serverseitig
// über DB-Trigger (siehe supabase/savings-pots.sql).

export interface SavingsPot {
  id: string;
  budgetId: string;
  name: string;
  allocationPercent: number;   // 0–100
  targetAmount?: number;       // optionales Sparziel
  currentAmount: number;       // trigger-gepflegt (Summe der Zuweisungen)
  color: string;               // hex
  icon?: string;               // optionaler Emoji-/Icon-Identifier
  sortOrder: number;           // höchste = neuester Topf, bekommt Rundungsrest
  createdAt: string;
  updatedAt: string;
}

export interface PotAllocation {
  id: string;
  potId: string;
  incomeTransactionId: string;
  amount: number;
  createdAt: string;
}

// ── Recurring transactions ────────────────────────────────────────────────────

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  budgetId: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  note?: string;
  frequency: Frequency;
  startDate: string;     // ISO
  endDate?: string;      // ISO, optional
  nextDue: string;       // ISO — updated after each execution
  lastExecuted?: string; // ISO
  isActive: boolean;
}

// ── Navigation ────────────────────────────────────────────────────────────────

export type Tab =
  | 'dashboard'
  | 'transactions'
  | 'new'
  | 'analysis'
  | 'recurring'
  | 'budgets'
  | 'savings'
  | 'settings';
```

### 4.1 Feldabbildung camelCase ↔ snake_case

| TS-Feld | DB-Spalte | Tabelle |
|---|---|---|
| `Transaction.category` | `category` | `transactions` |
| `Transaction.note` | `note` (`?? ''` beim Schreiben, `''` bei NULL beim Lesen) | `transactions` |
| `Category.monthlyBudget` | `monthly_budget` | `categories` |
| `Settings.startingBalance` | `starting_balance` | `settings` |
| `Settings.monthStart` | `month_start` | `settings` |
| `Settings.showAiBadges` | `show_ai_badges` | `settings` |
| `Settings.mcpAllowPotCreation` | `mcp_allow_pot_creation` | `settings` |
| `Transaction.source` | `source` | `transactions` |
| `Budget.startingBalance` | `starting_balance` | `budgets` |
| `Budget.createdAt` | `created_at` (nur lesend) | `budgets` |
| `SavingsPot.budgetId` | `budget_id` | `savings_pots` |
| `SavingsPot.allocationPercent` | `allocation_percent` | `savings_pots` |
| `SavingsPot.targetAmount` | `target_amount` | `savings_pots` |
| `SavingsPot.currentAmount` | `current_amount` (nur lesend) | `savings_pots` |
| `SavingsPot.sortOrder` | `sort_order` | `savings_pots` |
| `SavingsPot.createdAt` / `updatedAt` | `created_at` / `updated_at` (nur lesend) | `savings_pots` |
| `PotAllocation.potId` | `pot_id` | `pot_allocations` |
| `PotAllocation.incomeTransactionId` | `income_transaction_id` | `pot_allocations` |
| `RecurringTransaction.budgetId` | `budget_id` | `recurring_transactions` |
| `RecurringTransaction.startDate` | `start_date` | `recurring_transactions` |
| `RecurringTransaction.endDate` | `end_date` | `recurring_transactions` |
| `RecurringTransaction.nextDue` | `next_due` | `recurring_transactions` |
| `RecurringTransaction.lastExecuted` | `last_executed` | `recurring_transactions` |
| `RecurringTransaction.isActive` | `is_active` | `recurring_transactions` |

### 4.2 Weitere relevante Typen außerhalb von `types.ts`

`src/lib/storage.ts` — `StorageAdapter`, `BudgetStorage` (siehe 3.2).
`src/lib/savingsPotsAdapter.ts` — `SavingsPotsStorage` (siehe 3.4).

`src/hooks/useTheme.ts`:

```ts
export type Theme = 'light' | 'dark' | 'system';
export const ACCENT_PRESETS = [ … ];
export const DEFAULT_ACCENT = '#4A6FA5';
export const PALETTES = [ … ];
export function palettePinnedTheme(id: PaletteId): 'light' | 'dark' | null
export type PaletteId = typeof PALETTES[number]['id'];
export const DEFAULT_PALETTE: PaletteId = 'default';
export const ANALYSIS_SECTIONS = [ … ];
export type AnalysisSectionId = typeof ANALYSIS_SECTIONS[number]['id'];
export type AnalysisSections = Record<AnalysisSectionId, boolean>;
export function applyTheme(theme: Theme): void
export function ThemeProvider({ children }: { children: ReactNode })
export function useTheme(): ThemeContextValue
```

`src/hooks/useChartTheme.ts`:

```ts
export interface ChartTheme {
  grid: string;
  tick: string;
  axisLabel: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  dotStroke: string;
  series: string[];
  cursorFill: string;
}
export function useChartTheme(): ChartTheme
```

`src/hooks/useCategoryColors.ts`:

```ts
export function categoryColorKey(budgetId: string | null): string
export function loadCategoryColors(budgetId: string | null): Record<string, string>
export function saveCategoryColors(budgetId: string | null, map: Record<string, string>): void
export function useCategoryColorResolver(
  budgetId: string | null,
  categories: Category[],
  series: string[],
  overrides?: Record<string, string>,
): (name: string, index: number) => string
```

`src/hooks/useRecurringTransactions.ts`:

```ts
export function calcNextDue(current: string, frequency: Frequency): string
interface UseRecurringResult { processedCount: number; processing: boolean; }
export function useRecurringTransactions(
  storage: StorageAdapter | null,
  onNewTransactions: (txs: Transaction[]) => void,
): UseRecurringResult
```

`src/utils.ts`:

```ts
export interface CsvParseResult { valid: Transaction[]; errors: string[]; }
export function formatEuro(amount: number): string
export function formatAxisEuro(v: number): string
export function formatDate(isoDate: string): string
export function parseLocalDate(isoDate: string): Date
export function getCurrentMonth(): { year: number; month: number }
export function getCustomMonthRange(monthStart?: number): { from: string; to: string }
export function getMonthRange(year: number, month: number, monthStart?: number): { from: string; to: string }
export function isSameMonth(isoDate: string, year: number, month: number): boolean
export function getMonthLabel(year: number, month: number): string
export function getLast12Months(): Array<{ year: number; month: number; label: string }>
export function computeBalance(transactions: Transaction[]): number
export function filterByMonth(transactions: Transaction[], year: number, month: number): Transaction[]
export function filterByDateRange(transactions: Transaction[], from: string | null, to: string | null): Transaction[]
export function groupByCategory(transactions: Transaction[]): Record<string, number>
export function downloadCSV(transactions: Transaction[]): void
export function downloadJSON(data: object, filename: string): void
export function parseImportCSV(text: string): CsvParseResult
export function buildSeriesColors(accent: string, count?: number, dark?: boolean): string[]
export const ACCENT: string
export const CHART_INCOME: string
export const CHART_EXPENSE: string
export const CHART_COLORS: string[]
```

`src/lib/exportPDF.ts`:

```ts
export interface ActiveFilters {
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  category?: string;
}
export function exportTransactionsPDF(
  transactions: Transaction[],
  filters: ActiveFilters,
  userName: string,
  budgetName: string,
): void
```

---

## 5) GESCHÄFTSLOGIK

Sämtliche Auswertungslogik läuft **im Client**. Es gibt keine SQL-Views, keine RPCs, keine Aggregat-Abfragen — die App lädt alle Transaktionen des aktiven Budgets und rechnet in JavaScript.

### 5.1 Kontostand

Basisfunktion (`src/utils.ts:97`):

```ts
export function computeBalance(transactions: Transaction[]): number {
  return transactions.reduce((acc, t) => {
    return t.type === 'income' ? acc + t.amount : acc - t.amount;
  }, 0);
}
```

**Dashboard** (`src/pages/Dashboard.tsx:79`):

```ts
const balance = useMemo(() => startingBalance + computeBalance(transactions), [transactions, startingBalance]);
```

`startingBalance` kommt aus `settings.startingBalance` des **aktiven Budgets** (nicht aus `budgets.starting_balance` — siehe Abschnitt 7).

**Kontostandsverlauf** (`Dashboard.tsx:91-99`) — kumulativ, ein Punkt je Transaktion:

```ts
const lineData = useMemo(() => {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  let running = startingBalance;
  return sorted.map((t) => {
    running += t.type === 'income' ? t.amount : -t.amount;
    return { date: t.date, Kontostand: running };
  });
}, [transactions, startingBalance]);
```

**Kontostand je Bereich** (`BudgetsPage.tsx:53-61`) — hier über `settings.startingBalance` des jeweiligen Bereichs:

```ts
const [txs, settings] = await Promise.all([
  adapter.getTransactions(),
  adapter.getSettings(),
]);
const start   = settings.startingBalance ?? 0;
const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
return { id: b.id, balance: start + income - expense as number | null, txs, start };
```

**Gesamtguthaben** (`BudgetsPage.tsx:74-76`):

```ts
const knownBalances = Object.values(balances).filter((v): v is number => v !== null);
const totalBalance  = knownBalances.reduce((s, v) => s + v, 0);
const allLoaded     = !balancesLoading && knownBalances.length === budgets.length;
```

### 5.2 Sparquote

`src/pages/Dashboard.tsx:80`:

```ts
const savingsRate = currentIncome > 0 ? ((currentIncome - currentExpense) / currentIncome) * 100 : 0;
```

Bezugszeitraum ist der **laufende Abrechnungsmonat** (siehe 5.3), nicht der Kalendermonat. Bei Einnahmen = 0 wird 0 % angezeigt, auch wenn Ausgaben existieren. Anzeige: `` `${savingsRate.toFixed(1)} %` ``.

Die „Sparrate" in der Auswertung ist etwas anderes — ein absoluter Euro-Betrag je Kalendermonat (`Analysis.tsx:122-128`):

```ts
const savingTrend = useMemo(() => getLast12Months().map(({ year, month, label }) => {
  const monthTx = filterByMonth(transactions, year, month);
  const income  = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { label, Sparrate: income - expense };
}), [transactions]);
```

### 5.3 Monatssummen und der frei wählbare Monatsbeginn

> **Korrigiert in Commit `e9e3c83`.** Der unten gezeigte Code enthielt einen
> Zeitzonenfehler: `getCustomMonthRange()` bildete das Enddatum über
> `toISOString()` auf einem lokal konstruierten `Date`. Östlich von Greenwich —
> also auch in Deutschland — lag das Enddatum dadurch **immer einen Tag zu
> früh**. Bei `monthStart = 15` etwa `2026-01-15 .. 2026-02-13` statt
> `.. 2026-02-14`.
>
> **Heutiger Stand:** Die Zeitraumberechnung liegt einmalig in
> `getMonthRange()`; `getCustomMonthRange()` bestimmt nur noch den passenden
> Monat und delegiert dorthin. Gerechnet wird auf UTC-Mitternacht, formatiert
> über den UTC-Formatierer `toISODate()`. Welcher Tag „heute" ist, bleibt eine
> lokale Frage und läuft über `todayISO()`.
>
> Nachgewiesen: 5376 Kombinationen von `getMonthRange` (3 Jahre × 12 Monate ×
> `monthStart` 1–28) über vier Zeitzonen gegen die Implementierung im
> MCP-Server — **0 Abweichungen**. Frontend und Edge Function rechnen identische
> Zeiträume. 23 Tests in `src/utils.dates.test.ts`, ausführbar mit `npm test`.
>
> Ein Unterschied bleibt und ist unvermeidbar: welcher Tag „heute" ist. Das
> Frontend nimmt den lokalen Tag des Nutzers, der Server kennt nur UTC. In
> Berlin fallen beide zwischen 00:00 und 01:00 bzw. 02:00 Ortszeit auseinander.
> Bei `monthStart = 1` und zu jeder anderen Tageszeit sind sie deckungsgleich.
>
> Der folgende Codeauszug zeigt den **historischen** Stand von `88be12e`.

Zwei verschiedene Monatsbegriffe existieren nebeneinander:

**a) Abrechnungsmonat** (berücksichtigt `settings.monthStart`, Tag 1–28) — `src/utils.ts:38-59`:

```ts
export function getCustomMonthRange(monthStart: number = 1): { from: string; to: string } {
  const today = new Date();
  const day   = today.getDate();
  let fromYear  = today.getFullYear();
  let fromMonth = today.getMonth() + 1; // 1-based

  if (day < monthStart) {
    // Haven't reached start day yet → period began last month
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    fromYear  = prev.getFullYear();
    fromMonth = prev.getMonth() + 1;
  }

  const from = `${fromYear}-${String(fromMonth).padStart(2, '0')}-${String(monthStart).padStart(2, '0')}`;

  // End: one day before the next period's start
  const nextStart = new Date(fromYear, fromMonth - 1 + 1, monthStart);
  nextStart.setDate(nextStart.getDate() - 1);
  const to = nextStart.toISOString().slice(0, 10);

  return { from, to };
}

export function getMonthRange(year: number, month: number, monthStart: number = 1): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-${String(monthStart).padStart(2, '0')}`;
  const nextStart = new Date(year, month, monthStart); // month ist 1-basiert → nächster Monat
  nextStart.setDate(nextStart.getDate() - 1);
  const to = `${nextStart.getFullYear()}-${String(nextStart.getMonth() + 1).padStart(2, '0')}-${String(nextStart.getDate()).padStart(2, '0')}`;
  return { from, to };
}
```

Verwendet in: Dashboard-KPIs, Donut „Lfd. Monat", Analysis-Monatsauswahl.

**b) Kalendermonat** (ignoriert `monthStart`) — `src/utils.ts:73-76, 103-105`:

```ts
export function isSameMonth(isoDate: string, year: number, month: number): boolean {
  const [y, m] = isoDate.split('-').map(Number);
  return y === year && m === month;
}

export function filterByMonth(transactions: Transaction[], year: number, month: number): Transaction[] {
  return transactions.filter((t) => isSameMonth(t.date, year, month));
}
```

Verwendet in: 12-Monats-Balkendiagramm, Spartrend, Kategoriedetail, Jahresübersicht, Vormonatsvergleich in der Auswertung.

**Monatssummen im Dashboard** (`Dashboard.tsx:73-78`):

```ts
const { from: periodFrom, to: periodTo } = getCustomMonthRange(monthStart);
const currentMonthTx = useMemo(
  () => transactions.filter(t => t.date >= periodFrom && t.date <= periodTo),
  [transactions, periodFrom, periodTo],
);
const currentIncome  = useMemo(() => currentMonthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), [currentMonthTx]);
const currentExpense = useMemo(() => currentMonthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0), [currentMonthTx]);
```

**12-Monats-Balken** (`Dashboard.tsx:82-90`) — nach Kalendermonat:

```ts
const barData = useMemo(() => getLast12Months().map(({ year, month, label }) => {
  const monthTx = filterByMonth(transactions, year, month);
  return {
    label, year, month,
    Einnahmen: monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    Ausgaben:  monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
  };
}), [transactions]);
```

### 5.4 Kategorie-Auswertungen

Gruppierung (`src/utils.ts:119-127`) — Schlüssel ist der **Kategoriename** aus `t.category`:

```ts
export function groupByCategory(transactions: Transaction[]): Record<string, number> {
  return transactions.reduce(
    (acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount;
      return acc;
    },
    {} as Record<string, number>
  );
}
```

**Donut im Dashboard** (`Dashboard.tsx:101-119`) — drei Zeiträume:

```ts
const donutData = useMemo(() => {
  let filtered: Transaction[];
  if (donutRange === 'current') {
    filtered = currentMonthTx.filter(t => t.type === 'expense');
  } else if (donutRange === 'last3') {
    const cutoff = new Date(year, month - 4, 1);
    filtered = transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === 'expense' && d >= cutoff;
    });
  } else {
    filtered = transactions.filter(t => t.type === 'expense');
  }
  const grouped = groupByCategory(filtered);
  return Object.entries(grouped)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}, [transactions, donutRange, currentMonthTx, year, month]);
```

**Top 5 mit Vormonatsvergleich** (`Analysis.tsx:79-87`):

```ts
const top5Data = useMemo(() => {
  const current = groupByCategory(currentExpenses);
  const prev    = groupByCategory(prevExpenses);
  const allCats = new Set([...Object.keys(current), ...Object.keys(prev)]);
  return [...allCats]
    .map(cat => ({ cat, current: current[cat] ?? 0, prev: prev[cat] ?? 0 }))
    .sort((a, b) => b.current - a.current).slice(0, 5);
}, [currentExpenses, prevExpenses]);
```

**Kategorie-Ranking mit Ø, Anteil, Trend und Monatsbudget** (`Analysis.tsx:92-111`):

```ts
const monthCount = Math.max(getLast12Months().length, 1);   // konstant 12
const categoryRanking = useMemo(() => {
  const grouped = groupByCategory(allExpenses);
  const currentGrouped = groupByCategory(currentExpenses);
  const prevGrouped    = groupByCategory(prevExpenses);
  return Object.entries(grouped)
    .map(([cat, total]) => {
      const currentAmt = currentGrouped[cat] ?? 0;
      const prevAmt    = prevGrouped[cat] ?? 0;
      const trend      = prevAmt === 0 ? null : ((currentAmt - prevAmt) / prevAmt) * 100;
      const catObj     = categories.find(c => c.name === cat);
      return {
        cat, total, avg: total / monthCount,
        pct: totalExpenses > 0 ? (total / totalExpenses) * 100 : 0,
        trend, monthlyBudget: catObj?.monthlyBudget,
        catId: catObj?.id,
        currentAmt,
      };
    })
    .sort((a, b) => b.total - a.total);
}, [allExpenses, currentExpenses, prevExpenses, categories, monthCount, totalExpenses]);
```

Hinweis: `monthCount` ist immer 12 (`getLast12Months().length`), unabhängig davon, wie viele Monate tatsächlich Daten enthalten. `total` ist die Summe **aller** Ausgaben dieser Kategorie über den gesamten Datenbestand — `avg` ist damit „Gesamtsumme / 12", nicht der Durchschnitt der belegten Monate.

**Ausgabenrhythmus** (`Analysis.tsx:130-137`) und **Jahresübersicht** (`Analysis.tsx:139-150`) folgen demselben Muster (Kalendermonat, Clientseitige Aggregation).

**Kategoriefarben** (`useCategoryColors.ts`): Auflösung über den **Namen**; die eigene Farbwahl liegt im `localStorage` unter `catColor:{budgetId}` und ist auf `category.id` verschlüsselt. Fällt keine eigene Farbe an, wird ein Ton aus der aus der Akzentfarbe abgeleiteten Palette (`buildSeriesColors`) über den Index vergeben.

**Kategorie-Reihenfolge**: `localStorage` unter `catOrder:{budgetId}` (`Settings.tsx:236`), ebenfalls gerätelokal.

### 5.5 Wiederkehrende Transaktionen — wann und wo materialisiert

**Materialisierung erfolgt ausschließlich im Client**, beim Mount von `MainApp` (bzw. bei jedem Budgetwechsel), nicht per Cron, nicht per DB-Job.

Ort: `src/hooks/useRecurringTransactions.ts` — Hook `useRecurringTransactions(storage, onNewTransactions)`, aufgerufen in `MainApp.tsx:91`:

```ts
const { processedCount } = useRecurringTransactions(storage, handleNewRecurring);
```

Ablauf (`useRecurringTransactions.ts:53-99`):

```ts
const process = useCallback(async () => {
  if (!storage || ranRef.current) return;
  ranRef.current = true;
  setProcessing(true);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const recurring = await storage.getRecurring();
    const due = recurring.filter(r => r.isActive && r.nextDue <= today);
    if (due.length === 0) return;

    const created: Transaction[] = [];

    for (const r of due) {
      // Book the transaction
      const tx: Transaction = {
        id: crypto.randomUUID(),
        date: today,
        type: r.type,
        amount: r.amount,
        category: r.category,
        description: r.description,
        note: r.note ?? '',
      };
      const saved = await storage.addTransaction(tx);
      created.push(saved);

      // Calculate next due
      const nextDue = calcNextDue(r.nextDue, r.frequency);
      const expired = r.endDate ? nextDue > r.endDate : false;
      await storage.updateRecurring(r.id, {
        nextDue,
        lastExecuted: today,
        isActive: !expired,
      });
    }

    if (created.length > 0) {
      onNewTransactions(created);
      setProcessedCount(created.length);
    }
  } catch (e) {
    console.error('Fehler beim Verarbeiten von Daueraufträgen:', e);
  } finally {
    setProcessing(false);
  }
}, [storage, onNewTransactions]);

useEffect(() => {
  ranRef.current = false; // reset when storage changes (budget switch)
  if (storage) process();
}, [storage, process]);
```

> **Korrigiert in Commit `e9e3c83`.** Die drei Helfer unten benutzten
> `toISOString()` auf lokal veränderten `Date`-Objekten. Folgen, alle in
> Europe/Berlin nachgewiesen:
>
> - `addDays('2026-03-29', +1)` ergab **wieder `2026-03-29`** — ein Fixpunkt am
>   Tag der Sommerzeitumstellung. Ein täglicher Dauerauftrag wäre dort
>   **dauerhaft** hängengeblieben und hätte bei jedem App-Start erneut gebucht.
>   Im Test blieben 278 aufeinanderfolgende Tage stehen.
> - `addMonths('2026-03-15', +1)` ergab `2026-04-14` statt `2026-04-15`.
> - `addMonths('2026-01-31', +1)` ergab `2026-03-03` statt `2026-02-28`
>   (JS-Monatsüberlauf, unabhängig von der Zeitzone).
>
> **Heutiger Stand:** Die Arithmetik liegt zentral in `src/utils.ts`
> (`addDays`, `addMonths`, `addYears`), rechnet auf UTC-Mitternacht und klemmt
> den Monatsüberlauf auf das Monatsende. `useRecurringTransactions.ts`
> importiert sie; die Fälligkeitsprüfung selbst ist unverändert.
> Abgesichert durch `src/utils.dates.test.ts` gegen eine Referenzimplementierung
> ohne jedes `Date`.
>
> Der folgende Codeauszug zeigt den **historischen** Stand von `88be12e`.

Fälligkeitsfortschreibung (`useRecurringTransactions.ts`, historisch):

```ts
function addDays(iso: string, n: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
function addMonths(iso: string, n: number): string {
  const d = new Date(iso); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10);
}
function addYears(iso: string, n: number): string {
  const d = new Date(iso); d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0, 10);
}

export function calcNextDue(current: string, frequency: Frequency): string {
  switch (frequency) {
    case 'daily':   return addDays(current, 1);
    case 'weekly':  return addDays(current, 7);
    case 'monthly': return addMonths(current, 1);
    case 'yearly':  return addYears(current, 1);
  }
}
```

Wichtige Eigenschaften:

- **Ein Lauf bucht pro fälligem Dauerauftrag genau eine Transaktion**, auch wenn mehrere Perioden versäumt wurden. `nextDue` rückt nur um **eine** Periode vor. Wer zwei Monate nicht öffnet, bekommt beim nächsten Öffnen eine Buchung; die zweite folgt erst beim nächsten Mount, bei dem `nextDue <= today` gilt.
- **Das Buchungsdatum ist immer `today`**, nicht `nextDue`.
- Der Ablauf ist über `ranRef` pro Storage-Instanz einmalig; da `useStorage` bei jedem `[user, budgetId]`-Wechsel eine neue Instanz liefert, läuft er pro Budget einmal je Sitzung.
- Es gibt **keine Idempotenz-Sicherung in der Datenbank**. Zwei gleichzeitig geöffnete Tabs können denselben Dauerauftrag doppelt buchen.
- `isActive` wird auf `false` gesetzt, sobald `nextDue > endDate`.

**Anlage eines Dauerauftrags** geschieht an zwei Stellen:

1. `src/pages/NewTransaction.tsx:96-105` — Checkbox „wiederkehrend" beim Anlegen einer Transaktion:
   ```ts
   if (isRecurring && storage) {
     let nextDue = date;
     while (nextDue < today) nextDue = calcNextDue(nextDue, frequency);
     await storage.addRecurring({
       id: uuidv4(), budgetId, amount: parsed, type,
       category, description, note: noteValue,
       frequency, startDate: date,
       endDate: endDate || undefined,
       nextDue: calcNextDue(date, frequency),
       isActive: true,
     });
   }
   ```
   Hinweis: Die `while`-Schleife berechnet ein `nextDue`, das anschließend gar nicht verwendet wird — gesetzt wird `calcNextDue(date, frequency)`.
2. `src/pages/RecurringPage.tsx` — `RecurringForm` mit `nextDue: startDate`.

### 5.6 Mehr-Budget-Trennung (privat / NZ Studio)

Die Trennung heißt im Code **Budget**, in der Oberfläche **Bereich**. Sie ist auf drei Ebenen umgesetzt:

**a) Datenbank** — jede Nutzdatentabelle trägt `budget_id`:

| Tabelle | `budget_id` | NULL erlaubt? |
|---|---|---|
| `transactions` | ja | ja |
| `categories` | ja | ja |
| `settings` | ja | ja, aber `UNIQUE (user_id, budget_id)` |
| `recurring_transactions` | ja | ja |
| `savings_pots` | ja | **nein** |
| `pot_allocations` | nein (indirekt über `pot_id`) | – |

Alle FKs sind `ON DELETE CASCADE` — Löschen eines Budgets löscht dessen Transaktionen, Kategorien, Settings, Daueraufträge und Sparttöpfe.

**b) Adapter-Scoping** — `createSupabaseAdapter(userId, budgetId)` schließt `budgetId` in die Closure ein und hängt `.eq('budget_id', budgetId)` an alle Lesevorgänge sowie `budget_id: budgetId` an alle Inserts. Ein Adapter kann also nur die Daten *eines* Bereichs sehen. Ausnahmen: `updateTransaction`, `deleteTransaction`, `updateCategory`, `deleteCategory`, `updateRecurring`, `deleteRecurring` filtern nur über `id` + `user_id` (die `id` ist eindeutig, deshalb funktional korrekt, aber ohne Bereichsschutz).

**c) Kontext** — `BudgetContext` hält `budgets`, `activeBudgetId` und `defaultBudgetId`:

- `activeBudgetId` liegt im `localStorage` unter `ft_guest_active_budget_id` (**auch für eingeloggte Nutzer** — der Key trägt „guest" nur historisch).
- `defaultBudgetId` liegt im `localStorage` unter `finance:defaultBudget`.
- Auswahllogik beim Laden (`BudgetContext.tsx:80-85`):
  ```ts
  const storedDefault = localStorage.getItem(DEFAULT_BUDGET_KEY);
  const storedActive  = localStorage.getItem(GUEST_ACTIVE_KEY);
  const validActive =
    (storedDefault && list.some(b => b.id === storedDefault) ? storedDefault : null) ??
    (storedActive  && list.some(b => b.id === storedActive)  ? storedActive  : null) ??
    list[0].id;
  ```
  Reihenfolge: angepinnter Standard → zuletzt aktiv → erster Bereich.
- `deleteBudget()` verweigert das Löschen des letzten Bereichs: `if (budgets.length <= 1) throw new Error('Das letzte Budget kann nicht gelöscht werden.');`
- Budget-Typen: `'personal'` (UI: „Privat") und `'business'` (UI: „Firma"). Der Typ ist rein deskriptiv — **er beeinflusst keine Berechnung** und keine Filterung.

**d) Bereichsübergreifende Auswertung** (`BudgetsPage.tsx:78-114`) — die einzige Stelle, an der Bereiche zusammengeführt werden:

```ts
const months = useMemo(() => getLast12Months(), []);

/** Kontostand am Monatsende, kumulativ über alle Bereiche. */
const totalTimeline = useMemo(() => {
  const allTx = Object.values(txByBudget).flat();
  if (!allTx.length) return [];
  const startSum = Object.values(startByBudget).reduce((s, v) => s + v, 0);
  return months.map(({ year, month, label }) => {
    const end = `${year}-${String(month).padStart(2, '0')}-31`;
    const upto = allTx.filter(t => t.date <= end);
    const income  = upto.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = upto.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { label, Gesamtguthaben: startSum + income - expense };
  });
}, [txByBudget, startByBudget, months]);

/** Einnahmen/Ausgaben je Monat, über alle Bereiche summiert. */
const totalFlow = useMemo(() => {
  const allTx = Object.values(txByBudget).flat();
  if (!allTx.length) return [];
  return months.map(({ year, month, label }) => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const monthTx = allTx.filter(t => t.date.startsWith(prefix));
    return {
      label,
      Einnahmen: monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      Ausgaben:  monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    };
  });
}, [txByBudget, months]);
```

Die Konstante `` `${year}-${month}-31` `` als Monatsende funktioniert für den String-Vergleich, weil ISO-Daten lexikografisch sortierbar sind (kein `2026-02-31` existiert je als Wert).

**e) Kontostand-Abgleich** (`Settings.tsx:120-220`) — zwei Modi:

```ts
const [reconcileScope, setReconcileScope] = useState<'budget' | 'all'>('budget');

const budgetBalance = useMemo(
  () => settings.startingBalance + computeBalance(transactions),
  [settings.startingBalance, transactions],
);

const baseBalance = reconcileScope === 'all' ? totalAllBalance : budgetBalance;
const targetBudgetId = reconcileScope === 'all'
  ? (reconcileTarget ?? defaultBudgetId ?? activeBudgetId)
  : activeBudgetId;

const countedValue = countedInput.trim() ? parseFloat(countedInput.replace(',', '.')) : NaN;
const reconcileDiff = isNaN(countedValue) || baseBalance === null
  ? null
  : Math.round((countedValue - baseBalance) * 100) / 100;
```

Die Korrekturbuchung (`Settings.tsx:180-206`):

```ts
const tx: Transaction = {
  id: crypto.randomUUID(),
  date: iso,
  type: reconcileDiff > 0 ? 'income' : 'expense',
  amount: Math.abs(reconcileDiff),
  category: 'Korrektur',
  description: 'Kontostand-Abgleich',
  note: `Gezählt: ${formatEuro(countedValue)} · vorher berechnet: ${formatEuro(baseBalance)} (${scopeNote})`,
};

if (targetBudgetId && targetBudgetId !== activeBudgetId) {
  // Anderer Bereich → direkt über dessen Adapter buchen
  const adapter = user
    ? createSupabaseAdapter(user.id, targetBudgetId)
    : createLocalStorageAdapter(targetBudgetId);
  await adapter.importTransactions([tx]);
} else {
  // Aktiver Bereich → über den Handler, damit die Oberfläche sofort nachzieht
  await onImportTransactions([tx]);
}
```

Beim Modus „alle Bereiche" wird die Differenz **nicht anteilig verteilt**, sondern vollständig in einen wählbaren Zielbereich gebucht (Vorgabe: Standardbereich). Die Kategorie `'Korrektur'` wird als Freitext geschrieben und existiert nicht zwingend in `categories`.

**f) Sparttöpfe pro Bereich** (`savings-pots.sql`, `SavingsPotsPage.tsx`) — die 100 %-Grenze und die Verteilung wirken je `(user_id, budget_id)`. Clientseitige Vorabprüfung (`SavingsPotsPage.tsx:60-67`):

```ts
const totalAllocated = pots.reduce((s, p) => s + p.allocationPercent, 0);
const otherAllocated = editingId
  ? totalAllocated - (pots.find(p => p.id === editingId)?.allocationPercent ?? 0)
  : totalAllocated;
const inputPercent = parseFloat(form.percent.replace(',', '.')) || 0;
const freeAfter    = Math.round((100 - otherAllocated - inputPercent) * 100) / 100;
const overbooked   = freeAfter < 0;
const isFull       = totalAllocated >= 100;
```

Die verbindliche Prüfung erfolgt serverseitig über `trg_check_pot_sum`.

---

## 6) AUTH UND UMGEBUNG

### 6.1 Umgebungsvariablen

Die App liest genau **zwei** Umgebungsvariablen. Beide werden in `src/lib/supabase.ts` gelesen; ein `grep` über `src/` findet keine weiteren `import.meta.env.*`-Zugriffe.

| Name | Ort |
|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts:3` |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts:4` |

Beide sind auch in `.env.example` und in der lokalen `.env.local` gesetzt (Werte hier nicht wiedergegeben). Für **Vercel** müssen sie unter *Project Settings → Environment Variables* hinterlegt werden (der Umzug von Netlify überträgt sie nicht automatisch) — das `VITE_`-Präfix bedeutet, dass beide Werte **im Client-Bundle landen** und öffentlich sind; das ist für den Anon-Key vorgesehen, RLS ist die eigentliche Schutzschicht.

Fehlt eine der beiden Variablen, wirft `src/lib/supabase.ts` beim Modul-Import:

```ts
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase-Konfiguration fehlt. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY ' +
    'als Umgebungsvariablen setzen (lokal: .env.local, Netlify: Site settings → Environment variables).'
  );
}
```

Kein Service-Role-Key, kein JWT-Secret, keine weiteren Secrets im Code.

### 6.2 Ermittlung und Weiterreichung der `user_id`

**Ermittlung** — ausschließlich über den Supabase-Auth-Client in `AuthContext`:

```ts
supabase.auth.getSession().then(({ data }) => {
  setSession(data.session);
  setUser(data.session?.user ?? null);
  setLoading(false);
});

const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
  setUser(session?.user ?? null);
  setLoading(false);
});
```

Die Session liegt in `localStorage` (supabase-js-Voreinstellung) und wird automatisch aktualisiert.

**Weiterreichung** — als `user.id` explizit in jeden Adapter, per Closure gebunden:

```
useAuth().user.id
  → useStorage(budgetId)          → createSupabaseAdapter(user.id, budgetId)
  → BudgetContext.getStorage()    → createSupabaseBudgetStorage(user.id)
  → BudgetContext.refreshBudgets  → initializeNewUser(user.id)
  → SavingsPotsPage               → createSavingsPotsAdapter(user.id, activeBudgetId)
  → BudgetsPage / Settings        → createSupabaseAdapter(user.id, b.id)  (Fremdbereiche)
  → MainApp Realtime-Channel      → filter: `user_id=eq.${user.id}`
```

Es gibt damit **zwei unabhängige Wege**, auf denen die `user_id` in eine Abfrage kommt:

1. **Explizit als Filter/Spaltenwert** aus `user.id` (jeder `.eq('user_id', userId)` und jedes `user_id: userId` im Insert).
2. **Implizit über das JWT** im `Authorization`-Header, das PostgREST an `auth.uid()` durchreicht und das jede RLS-Policy prüft.

Beide müssen übereinstimmen, sonst schlägt der Schreibvorgang an der `WITH CHECK`-Bedingung fehl (Policies aus `fix-rls.sql`). Ein Client, der eine fremde `user_id` schreiben will, scheitert an RLS.

Die inzwischen gelöschte `src/api.ts` ermittelte die `user_id` anders — pro Aufruf über `supabase.auth.getUser()`:

```ts
async function getUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Nicht eingeloggt');
  return user.id;
}
```

### 6.3 Auth-Flows

| Flow | Aufruf | Nachverhalten |
|---|---|---|
| Anmelden | `supabase.auth.signInWithPassword({ email, password })` (`AuthContext.tsx:40`) | `LoginPage.tsx:36` → `navigate('/', { replace: true })` |
| Registrieren | `supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectTo } })` (`AuthContext.tsx:45-49`) | `SignupPage` zeigt Bestätigungs-Hinweis |
| Abmelden | `supabase.auth.signOut()` (`AuthContext.tsx:54`) | `LogoutButton` in `Settings.tsx:1265` |

`authRedirectTo = ${window.location.origin}/auth/callback` (`supabase.ts:15`). **In `App.tsx` existiert keine Route `/auth/callback`** — die Catch-all-Route `/*` fängt sie ab und rendert `MainApp`. Da supabase-js den Bestätigungs-Token aus dem URL-Fragment liest und `onAuthStateChange` feuert, funktioniert das faktisch; eine dedizierte Callback-Seite gibt es aber nicht.

`src/components/ProtectedRoute.tsx` existiert weiterhin, wird jedoch **nicht mehr verwendet** — `App.tsx:6` dokumentiert das ausdrücklich: „ProtectedRoute is removed — MainApp handles both guest and logged-in modes."

Routing (`src/App.tsx`):

```tsx
<Routes>
  <Route path="/login"  element={<LoginPage />} />
  <Route path="/signup" element={<SignupPage />} />
  <Route path="/*"      element={<MainApp />} />
  <Route path="*"       element={<Navigate to="/" replace />} />
</Routes>
```

### 6.4 Gastmodus

**Ja, es gibt einen Gastmodus.** Die App ist ohne Anmeldung vollständig nutzbar; `MainApp` ist nicht geschützt.

**Unterscheidung im Datenpfad** — die Weiche liegt an genau vier Stellen und lautet immer `user ? … : …`:

| Stelle | Eingeloggt | Gast |
|---|---|---|
| `useStorage.ts:17-19` | `createSupabaseAdapter(user.id, budgetId)` | `createLocalStorageAdapter(budgetId)` |
| `BudgetContext.tsx:46-48` | `createSupabaseBudgetStorage(user.id)` | `createLocalBudgetStorage()` |
| `BudgetsPage.tsx:50-52`, `Settings.tsx:144-146`, `Settings.tsx:200-202` | `createSupabaseAdapter(user.id, b.id)` | `createLocalStorageAdapter(b.id)` |
| `SavingsPotsPage.tsx:161` | Sparttöpfe-UI | Hinweisseite „nur mit Konto verfügbar" |

**Unterschiede im Detail:**

| Aspekt | Eingeloggt | Gast |
|---|---|---|
| Speicherort | Supabase PostgreSQL | `localStorage` des Browsers |
| Budget-Liste | Tabelle `budgets` | Key `ft_guest_budgets` |
| Aktives Budget | Key `ft_guest_active_budget_id` (gerätelokal, **auch eingeloggt**) | derselbe Key |
| Transaktionen | Tabelle `transactions` | Key `ft_${budgetId}_tx` |
| Kategorien | Tabelle `categories` | Key `ft_${budgetId}_cats` |
| Settings | Tabelle `settings` | Key `ft_${budgetId}_settings` |
| Daueraufträge | Tabelle `recurring_transactions` | Key `ft_${budgetId}_recurring` |
| Sparttöpfe | Tabellen `savings_pots` / `pot_allocations` | **nicht verfügbar** |
| Initialisierung | `initializeNewUser()`: Budget → Settings → 11 Default-Kategorien | `refreshBudgets()` legt Default-Budget an; Kategorien beim ersten `getCategories()` |
| Kategorie-IDs | `cat-exp-1-${userId}` bzw. `cat-…-${userId.slice(0,6)}` | `cat-exp-1` … `cat-inc-4` (ohne Suffix) |
| Realtime | aktiv (Channel auf `transactions`) | nicht vorhanden |
| Banner | – | `GuestBanner` oberhalb der Navigation |
| Datum-Sicherheit | RLS `auth.uid() = user_id` | keine — beliebiger Zugriff über DevTools |

**Migration Gast → Konto** (`MainApp.tsx:73-80, 195-218`): Sobald `user` von `null` auf einen Wert wechselt und `hasGuestData()` true ist, erscheint `MigrateModal`. Beim Import:

```ts
async function handleMigrateImport() {
  if (!user || !activeBudgetId) return;
  const guestData = getAllGuestData();
  const adapter = createSupabaseAdapter(user.id, activeBudgetId);

  if (guestData.transactions.length > 0) {
    await adapter.importTransactions(guestData.transactions);
  }
  for (const c of guestData.categories) {
    try { await adapter.addCategory(c); } catch { /* duplicate */ }
  }

  clearAllGuestData();
  setShowMigrate(false);
  await loadData();
  showToast(`${guestData.transactions.length} Transaktionen importiert.`, 'success');
}
```

Achtung: **Alle** Gast-Transaktionen aus **allen** Gast-Budgets landen im **einen** aktiven Budget des Kontos. Gast-Daueraufträge (`guestData.recurring`) und Gast-Settings werden **nicht** migriert, obwohl `getAllGuestData()` sie zurückgibt. Danach wird der gesamte Gast-Speicher gelöscht.

### 6.5 localStorage-Keys (Gesamtübersicht)

| Key | Gesetzt in | Inhalt |
|---|---|---|
| `ft_guest_budgets` | `localStorageAdapter.ts:23` | Budget-Liste im Gastmodus |
| `ft_guest_active_budget_id` | `localStorageAdapter.ts:24` | aktives Budget (auch eingeloggt) |
| `ft_${budgetId}_tx` | `localStorageAdapter.ts:26` | Gast-Transaktionen |
| `ft_${budgetId}_cats` | `localStorageAdapter.ts:27` | Gast-Kategorien |
| `ft_${budgetId}_settings` | `localStorageAdapter.ts:28` | Gast-Settings |
| `ft_${budgetId}_recurring` | `localStorageAdapter.ts:29` | Gast-Daueraufträge |
| `finance:defaultBudget` | `BudgetContext.tsx:14` | angepinnter Standardbereich |
| `catColor:${budgetId}` | `useCategoryColors.ts:10` | eigene Kategoriefarben (auf `category.id`) |
| `catOrder:${budgetId}` | `Settings.tsx:236` | eigene Kategorie-Reihenfolge |
| `receipt:${txId}` | `receiptStorage.ts:1` | Beleg als Data-URL |
| `theme` | `useTheme.ts:113` | `'light' \| 'dark' \| 'system'` |
| `finance-accent` | `useTheme.ts:118` | Akzentfarbe (Hex) |
| `finance-palette` | `useTheme.ts:124` | Palette-ID |
| `finance-analysis-sections` | `useTheme.ts:131` | ein-/ausgeblendete Analyse-Abschnitte |
| (supabase-intern) | supabase-js | Auth-Session |

---

## 7) LÜCKEN

Was ein externer Dienst wissen muss, um korrekt in diese Datenbank zu schreiben, und was aus dem Code allein nicht eindeutig hervorgeht.

### 7.0 Was seit der ersten Fassung geschlossen wurde

| Damals offen | Heutiger Stand |
|---|---|
| Existiert `settings.month_start`? | **Geklärt.** Existiert als `integer NOT NULL DEFAULT 1`, CHECK 1–28. Migration ausgeführt. Siehe 2.5. |
| Welche `.sql`-Dateien sind gelaufen, existieren die Spartopf-Trigger? | **Geklärt.** `mcp-verify.sql` prüft die Trigger katalogbasiert (Prüfung 16) und lief mit 0 Befunden. |
| Sind die RLS-Policies mit `WITH CHECK` aktiv? | **Überholt.** Die `FOR ALL`-Policies sind durch je vier getrennte ersetzt; der Stand wurde per `mcp-verify.sql` gegen die Live-DB bestätigt. |
| `src/api.ts` mit `category_id` | **Gelöscht** (Commit `724faf4`). |
| Zeitzonenfehler in `getCustomMonthRange()` | **Behoben** (Commit `e9e3c83`). Siehe 5.3. |
| Zeitzonenfehler in der Dauerauftrags-Arithmetik | **Behoben** (Commit `e9e3c83`). Siehe 5.5. |
| „Heute" als UTC-Tag an neun Stellen | **Behoben** (Commit `e9e3c83`) — `todayISO()` liest lokal. |

**Verhaltensprüfung gegen die Produktivdatenbank:** `supabase/mcp-verify.sql`
ist gelaufen — **24 Prüfungen, 0 Befunde, 0 übersprungen**. Geprüft werden unter
anderem: Aufrufbarkeit der Policy-Funktionen für `anon`/`authenticated`/
`mcp_agent`, Erkennung von App- gegen OAuth-Token, Wirksamkeit des Widerrufs,
Append-only von `activity_log` und `transaction_notes` auf Policy- **und**
Grant-Ebene, Vorhandensein der drei Protokoll-Trigger, und dass `mcp_fn_owner`
tatsächlich in `activity_log` schreiben kann.

Zwei Anmerkungen zu diesem Lauf:

- Die Prüfungen **9 und 18** wurden vorher gestrichen. Sie führten ein
  `UPDATE … WHERE false` als Nachweis aus, dass `mcp_agent` nicht schreiben darf.
  Das war redundant zu Prüfung 20 (`has_table_privilege`, katalogbasiert, für
  alle Tabellen) und im Fehlerfall irreführend: wäre das Grant vorhanden und nur
  RLS würde blockieren, liefe das Statement fehlerfrei durch und die Prüfung
  meldete fälschlich „DURCHGELASSEN". Die Nummern bleiben als Lücke bestehen,
  damit ältere Ausgaben vergleichbar bleiben.
- Das Skript läuft vollständig zwischen `BEGIN` und `ROLLBACK`. Die beiden
  Probeschreibungen (je eine Zeile in `mcp_clients` und `activity_log`) sind
  damit folgenlos.

### 7.1 Nicht aus dem Repo ableitbar — Restposten

1. **Der OAuth-Consent-Durchlauf ist nie mit echten Zugangsdaten getestet worden.** ⚠️ **Offen.**
   Die Route `/oauth/consent` und `src/pages/ConsentPage.tsx` sind implementiert und im Browser geprüft: abgemeldeter Aufruf mit `authorization_id` zeigt zuverlässig das Login-Formular (nicht das Dashboard), fehlender Parameter zeigt eine klare Fehlermeldung, und die Adresse bleibt über einen Login-Versuch hinweg unverändert. **Nicht geprüft** ist der vollständige Durchlauf: echtes Login → Zustimmungsdialog → `approveAuthorization()` → Rücksprung zum Client. Dafür fehlten gültige Zugangsdaten. Strukturell kann die Adresse nicht verlorengehen, weil das Login inline in derselben Komponente stattfindet und keine Navigation auslöst — aber das ist eine Herleitung, kein Testergebnis.

2. **Läuft der Custom Access Token Hook bei OAuth-2.1-Tokens wirklich?**
   Supabase dokumentiert „Custom Access Token Hooks are triggered for **all** token issuance". Der OAuth-2.1-Server ist allerdings Public Beta, und Supabase empfiehlt den Rollentausch selbst nicht. Verifizierbar nur durch Dekodieren eines echten Claude-Tokens: steht dort `"role": "mcp_agent"`, greift Schicht 2. Steht dort `authenticated`, greift **nur** Schicht 1 — was für sich genommen ausreicht.

3. **Ist Realtime für `public.transactions` in der Publikation aktiviert?**
   Unverändert offen — siehe Punkt 4.

4. **Ist Realtime für `public.transactions` in der Publikation aktiviert?**
   `MainApp.tsx` abonniert `postgres_changes` auf `transactions`. Kein SQL im Repo führt `ALTER PUBLICATION supabase_realtime ADD TABLE transactions;` aus. Ohne diese Aktivierung ist die Subscription wirkungslos (und externe Schreibvorgänge werden im offenen Client nicht sichtbar). `mcp-verify.sql` prüft das nicht.

5. **Welcher Schlüssel wird verwendet?**
   Der Client nutzt den Anon-Key + Nutzer-JWT. Ein externer Dienst müsste entweder (a) sich als Nutzer authentifizieren und dann automatisch RLS-konform schreiben, oder (b) den `service_role`-Key nutzen — dann wird RLS umgangen und `user_id` muss **manuell korrekt** gesetzt werden, sonst entstehen für den Nutzer unsichtbare Zeilen. Der Service-Role-Key ist nirgends im Repo hinterlegt.

6. **Existieren Alt-Daten mit `budget_id IS NULL`?**
   Der auskommentierte Migrationsblock am Ende von `schema.sql` wurde nie aktiviert. `initializeNewUser()` löscht zwar verwaiste `settings` ohne `budget_id`, aber nicht die entsprechenden Transaktionen oder Kategorien. Solche Zeilen wären für die App **komplett unsichtbar**, da jeder Lesevorgang `.eq('budget_id', budgetId)` filtert.

### 7.2 Regeln, die ein Schreibender einhalten muss (aus Code + Schema hergeleitet)

**Für `transactions`:**

| Feld | Regel |
|---|---|
| `id` | UUID. Der Client vergibt sie selbst (`crypto.randomUUID()` bzw. `uuidv4()`) und verlässt sich nicht auf den DB-Default. Ein externer Dienst kann sie weglassen (Default greift) oder eigene UUIDs setzen. |
| `user_id` | **Pflicht.** Muss der `auth.users.id` des Besitzers entsprechen, sonst blockt RLS (bzw. macht die Zeile unsichtbar). |
| `budget_id` | Technisch nullable, **fachlich Pflicht.** Ohne `budget_id` erscheint die Zeile in keiner Ansicht der App und geht in keine Kontostandsberechnung ein. |
| `date` | `DATE`, Format `YYYY-MM-DD`, keine Uhrzeit, keine Zeitzone. Sämtliche Client-Vergleiche sind **String-Vergleiche** (`t.date >= from && t.date <= to`) — ein abweichendes Format bricht alle Filter still. |
| `type` | Genau `'income'` oder `'expense'`. |
| `amount` | **Immer positiv** (`CHECK amount > 0`). Ausgaben werden nicht negativ gespeichert — das Vorzeichen steckt in `type`. Ein negativer Betrag wird vom Check abgelehnt. |
| `category` | **Der Kategorie-*Name* als Freitext**, nicht die ID. Kein FK, keine Validierung. Damit die Kategorie in Donut/Ranking/Budgetvergleich korrekt zugeordnet wird, muss der String **exakt** (case-sensitive, inkl. Umlauten) einem `categories.name` desselben `(user_id, budget_id)` entsprechen. Ein unbekannter Name erzeugt keine Fehlermeldung, sondern taucht als eigenständiger Eintrag in den Auswertungen auf (ohne Monatsbudget und ohne benutzerdefinierte Farbe). |
| `description` | `NOT NULL`, Default `''`. Client-Formulare erzwingen einen Wert. |
| `note` | Optional, Default `''`. Der Client schreibt nie `NULL`, sondern `''`. Mehrzeilige Notizen werden mit `\n` verkettet (`NewTransaction.tsx:88`). |
| `created_at` | DB-Default. Wird als **Sekundärsortierung** genutzt (`.order('date').order('created_at')`) — ein manuell gesetzter Wert verschiebt die Anzeigereihenfolge. |

**Nebenwirkung, die zwingend bekannt sein muss:** Ein `INSERT` mit `type = 'income'` und `amount > 0` löst `trg_distribute_income` aus. Existieren im selben `(user_id, budget_id)` Sparttöpfe mit `allocation_percent > 0`, entstehen automatisch `pot_allocations`-Zeilen und `savings_pots.current_amount` steigt. Ein `UPDATE` von `amount`, `type` oder `budget_id` löst die vollständige Neuverteilung aus (alte Allocations werden gelöscht). Ein `DELETE` bucht über den FK-CASCADE zurück. **Ein externer Dienst kann Sparttöpfe nicht umgehen** — auch nicht mit dem Service-Role-Key, da die Trigger-Funktionen `SECURITY DEFINER` sind.

**Für `categories`:**

- `id` ist **`TEXT` ohne Default** — muss immer explizit gesetzt werden. Es gibt kein verbindliches Format; die App verwendet drei verschiedene Muster (siehe 2.4).
- `name` + `type` bilden **kein** Unique-Constraint. Duplikate sind auf DB-Ebene erlaubt und führen im Client zu doppelten Dropdown-Einträgen.
- `type` ist über `updateCategory()` **nicht** änderbar; nur `name` und `monthly_budget`.
- `monthly_budget` ist optional und wird beim Anlegen nie gesetzt (nur per Update).

**Für `recurring_transactions`:**

- `description` hat **keinen** Default und ist `NOT NULL` → Pflichtfeld beim Insert.
- `note` ist hier `NULL`-fähig ohne Default (Client schreibt `null`), anders als bei `transactions` (`''`).
- `next_due` ist Pflicht. Der Client rechnet die Fortschreibung selbst; es gibt **keinen** serverseitigen Job.
- `type`, `note` und `start_date` sind über `updateRecurring()` **nicht** patchbar.

**Für `savings_pots`:**

- `budget_id` ist hier `NOT NULL` (Abweichung zu allen anderen Tabellen).
- `current_amount` **niemals direkt schreiben** — der Wert wird ausschließlich vom Trigger gepflegt; ein direkter Schreibzugriff wird beim nächsten Allocation-Ereignis inkonsistent.
- `trg_check_pot_sum` wirft bei Überschreitung von 100 % eine Exception mit `ERRCODE = 'check_violation'`. Der Client fängt sie ab und zeigt die Message an.

### 7.3 Konkrete Inkonsistenzen und Fallstricke im Bestand

1. ~~**`src/api.ts` ist toter, schemawidriger Code.**~~ **Erledigt** — in Commit `724faf4` gelöscht.

2. **Zwei konkurrierende Startsaldo-Quellen.** `budgets.starting_balance` **und** `settings.starting_balance` existieren beide. Die Berechnungen nutzen durchgängig `settings.starting_balance` (`Dashboard.tsx:79`, `BudgetsPage.tsx:58`, `Settings.tsx:131`). `budgets.starting_balance` wird bei `createBudget()` gesetzt (`BudgetContext.tsx:117` → `supabaseAdapter.ts:380`) und in `BudgetCard` zur Bearbeitung angezeigt (`BudgetsPage.tsx:373, 383`), fließt aber **in keine Kontostandsberechnung ein**. Wer im Bereichs-Editor das Startguthaben ändert, ändert damit nicht den angezeigten Kontostand. Welcher Wert der maßgebliche ist, geht aus dem Code nicht eindeutig hervor — de facto ist es `settings.starting_balance`.

3. **Rundungsrest der Spartöpfe wird nicht in `current_amount` gespiegelt.** `apply_pot_distribution()` korrigiert den Rest per `UPDATE pot_allocations SET amount = amount + remainder`. `sync_pot_current_amount()` hat aber nur INSERT- und DELETE-Zweige — kein UPDATE. Die Summe der `pot_allocations.amount` und `savings_pots.current_amount` können daher um den Rundungsrest (max. wenige Cent je Einnahme) auseinanderlaufen. Kumulativ über viele Buchungen kann die Abweichung wachsen.

4. **Keine Idempotenz bei Daueraufträgen.** `useRecurringTransactions` prüft nur `nextDue <= today` und hält den Ausführungsstatus in einer React-Ref (`ranRef`). Zwei gleichzeitig geöffnete Tabs oder ein schneller Reload können denselben Dauerauftrag mehrfach buchen. Es gibt kein Unique-Constraint, keinen Idempotenz-Schlüssel und kein Feld, das Dauerauftrag und erzeugte Transaktion verknüpft — die gebuchte Transaktion trägt **keinen Verweis** auf ihren `recurring_transactions.id`. Eine nachträgliche Zuordnung ist unmöglich.

5. **Verpasste Perioden werden nicht nachgeholt.** Pro Client-Mount rückt `next_due` nur um genau eine Periode vor und es entsteht genau eine Transaktion. Nach zwei Monaten Abwesenheit fehlt eine Buchung, bis die App erneut geöffnet wird.

6. **Buchungsdatum ≠ Fälligkeitsdatum.** Der Dauerauftrag bucht auf `today`, nicht auf `nextDue`. Nach längerer Abwesenheit landen alle Nachbuchungen mit heutigem Datum im laufenden Monat.

7. **`updateTransaction` / `deleteTransaction` filtern nicht auf `budget_id`.** Nur `.eq('id')` + `.eq('user_id')`. Funktional korrekt (UUIDs sind eindeutig), aber ein Adapter für Bereich A kann formal eine Transaktion aus Bereich B ändern.

8. **Keine `updated_at`-Spalte auf `transactions`, `categories`, `settings`, `budgets`, `recurring_transactions`.** Nur `savings_pots` hat `updated_at`. Ein externer Dienst kann nicht inkrementell nach „was hat sich seit X geändert" synchronisieren — nur `created_at` steht zur Verfügung, und das ändert sich bei Updates nicht.

9. **Keine Soft-Deletes, kein Audit-Trail** außer `pot_allocations`. Gelöschte Transaktionen sind unwiederbringlich weg.

10. **`settings.UNIQUE (user_id, budget_id)` schützt nicht gegen mehrfache NULL-`budget_id`.** Postgres behandelt NULLs im Unique-Index als verschieden. `initializeNewUser()` räumt solche Zeilen deshalb bei jedem Start vorsorglich ab (`supabaseAdapter.ts:93-97`) — externe Schreibvorgänge, die `settings` ohne `budget_id` anlegen, werden beim nächsten App-Start gelöscht.

11. **Keine Route `/auth/callback`.** `authRedirectTo` verweist auf `${origin}/auth/callback`; das Routing hat dafür keine eigene Route. Funktioniert über den Catch-all + den SPA-Rewrite in `vercel.json`, ist aber nicht explizit vorgesehen. In Supabase muss diese URL trotzdem unter *Authentication → URL Configuration* als erlaubte Redirect-URL eingetragen sein.

12. **Belege existieren nur im Browser.** `receiptStorage.ts` speichert Beleg-Bilder als Data-URL im `localStorage` unter `receipt:${txId}`. Sie werden nie hochgeladen, sind gerätegebunden, gehen bei „Site data löschen" verloren, sind nicht Teil eines Exports und unterliegen dem localStorage-Limit (typisch 5–10 MB pro Origin). `saveReceipt()` schluckt Fehler bei vollem Speicher stillschweigend (`catch { /* storage full */ }`).

13. **Kategoriefarben und -reihenfolge sind gerätelokal.** `catColor:{budgetId}` und `catOrder:{budgetId}` liegen im `localStorage` und werden nicht synchronisiert. Auf einem zweiten Gerät sieht dieselbe Kategorie anders aus.

14. **`ft_guest_active_budget_id` wird auch für eingeloggte Nutzer verwendet.** Der Key-Name ist irreführend; das aktive Budget ist damit gerätelokal, nicht kontogebunden.

15. **`monthStart` wirkt nur in einem Teil der Auswertungen.** *(Der früher hier beschriebene Tag-zu-früh-Fehler ist behoben — siehe 5.3. Die folgende Ungleichbehandlung besteht weiter.)* Dashboard-KPIs, Donut „Lfd. Monat" und die Analysis-Monatsauswahl nutzen `getCustomMonthRange`/`getMonthRange`; 12-Monats-Balken, Spartrend, Kategoriedetail, Jahresübersicht und der Vormonatsvergleich in der Auswertung nutzen `filterByMonth` (reiner Kalendermonat). Bei einem `monthStart ≠ 1` weichen KPI-Werte und Diagrammwerte für denselben Monat systematisch voneinander ab.

16. **`Ø/Monat` im Kategorie-Ranking teilt immer durch 12.** `monthCount = Math.max(getLast12Months().length, 1)` ist konstant 12; der Zähler `total` umfasst dagegen **alle** Ausgaben seit Beginn. Bei weniger oder mehr als 12 Monaten Datenbestand ist der Wert kein Monatsdurchschnitt.

17. **Sparquote ohne Einnahmen ist 0 %.** `currentIncome > 0 ? … : 0` — ein Monat mit Ausgaben, aber ohne Einnahmen zeigt 0 % statt eines negativen Werts.

18. **Gast→Konto-Migration ist verlustbehaftet.** Daueraufträge und Settings werden nicht übernommen, alle Gast-Budgets werden in **ein** Zielbudget zusammengeführt, und `clearAllGuestData()` löscht danach unwiderruflich.

19. **Der Realtime-Filter ist grob.** `filter: user_id=eq.${user.id}` ohne `budget_id` → jede Transaktionsänderung in irgendeinem Bereich löst ein vollständiges Neuladen des aktiven Bereichs aus. Für `categories`, `settings`, `budgets` und `savings_pots` gibt es keine Subscription — externe Schreibvorgänge auf diese Tabellen erreichen einen offenen Client nicht.

20. **Node-Version nirgends fixiert.** Kein `engines`, keine `.nvmrc` — geprüft, gilt weiterhin. Ein CI- oder Vercel-Build läuft auf der jeweiligen Default-Node-Version. Bei `vite@8` / `typescript@6` ist das nicht risikofrei. Zusätzlich relevant seit `e9e3c83`: `npm test` setzt Nodes eingebauten Test-Runner **mit TypeScript-Unterstützung** voraus (Node 22+); der Build prüft die Testdateien über `tsconfig.test.json` mit.

21. **`db.json` im Root ist ein Relikt.** `json-server`-Schema aus einer früheren Stufe, ohne Bezug zum aktuellen Code, gitignored. Enthält die Default-Kategorien in einer vierten Variante (IDs `cat-exp-1` … ohne Suffix, plus ein `settings`-Objekt mit `id: "1"`).

22. **Der Protokoll-Trigger schluckt Fehler.** `log_activity()` fängt jede Ausnahme ab und gibt sie nur als `NOTICE` aus — bewusst, damit eine misslingende Protokollierung nie eine Buchung kippt. Die Kehrseite: ein fehlendes Recht bliebe unbemerkt, das Log einfach leer. Dagegen stehen die Katalogprüfung in `mcp-schema.sql` und Prüfung 17 in `mcp-verify.sql`, die probeweise als `mcp_fn_owner` schreibt. Beide sind gelaufen.

23. **`activity_log` wächst bei Sparttöpfen schnell.** Eine Einnahme mit drei befüllten Töpfen erzeugt eine `insert`-Zeile für die Buchung plus drei `update`-Zeilen für die Töpfe (der Verteilungs-Trigger fasst jeden Topf an). Gewollt — jede Änderung wird protokolliert — macht das Log aber gesprächig. Es gibt keine Aufbewahrungsfrist und kein Aufräumen.

24. **`db.json` im Root existiert weiterhin** — `json-server`-Relikt, gitignored, ohne Bezug zum Code (siehe Punkt 21).

### 7.4 Minimal-Rezept für einen externen Schreiber

Eine Transaktion, die die App vollständig korrekt anzeigt und auswertet:

```jsonc
{
  "id":          "<uuid v4 – optional, sonst DB-Default>",
  "user_id":     "<auth.users.id des Besitzers>",           // Pflicht
  "budget_id":   "<budgets.id desselben Nutzers>",          // fachlich Pflicht
  "date":        "2026-09-02",                              // YYYY-MM-DD, keine Zeit
  "type":        "expense",                                 // 'income' | 'expense'
  "amount":      12.90,                                     // > 0, max. 2 Nachkommastellen
  "category":    "Lebensmittel",                            // NAME, exakt wie categories.name
  "description": "Einkauf",                                 // NOT NULL
  "note":        ""                                         // '' statt NULL, wie der Client
}
```

Vorher zu prüfen:

1. `budget_id` gehört demselben `user_id` (kein DB-Constraint erzwingt das).
2. `category` existiert als `categories.name` mit passendem `type` in `(user_id, budget_id)` — sonst erscheint die Buchung als neue, unkonfigurierte Kategorie.
3. Bei `type = 'income'`: bewusst sein, dass die Spartopf-Trigger feuern.
4. Beim Schreiben mit `service_role` (RLS umgangen): `user_id` und `budget_id` selbst korrekt setzen — es gibt keine Rückfallebene.
5. Die App wird die Änderung erst sehen, wenn (a) Realtime für `transactions` aktiviert ist und ein Client offen ist, oder (b) der Nutzer neu lädt bzw. den Bereich wechselt.
