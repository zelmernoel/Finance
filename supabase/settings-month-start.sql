-- ============================================================
-- FinanzTracker — settings.month_start nachziehen
--
-- Im Supabase SQL Editor ausführen. Idempotent: mehrfaches
-- Ausführen ist schadlos, und die Datei läuft auch dann sauber
-- durch, wenn die Spalte bereits existiert.
--
-- ── Warum diese Datei ───────────────────────────────────────
--
-- settings.month_start bestimmt, an welchem Tag der Abrechnungs-
-- monat beginnt (Dashboard-Kennzahlen, Auswertung, Einstellungen).
-- Der Anwendungscode liest und schreibt die Spalte seit längerem
-- (src/lib/supabaseAdapter.ts), sie stand aber in keiner der
-- Basis-Migrationen — siehe SYSTEM-REPORT.md, Abschnitt 7.1.
--
-- Angelegt wird sie bisher nur in supabase/mcp-schema.sql. Das ist
-- die falsche Stelle: month_start ist Kernfunktion der App und hat
-- mit dem MCP-Zugriff nichts zu tun. Wer die Datenbank ohne den
-- MCP-Teil aufsetzt, bekäme eine App, die auf eine fehlende Spalte
-- schreibt.
--
-- Beide Dateien legen dieselbe Spalte mit demselben
-- Constraint-Namen an und stören sich deshalb nicht. mcp-schema.sql
-- bleibt bewusst in sich geschlossen, damit es weiterhin allein
-- lauffähig ist.
--
-- ── Endzustand ──────────────────────────────────────────────
--
--   settings.month_start   integer  NOT NULL  DEFAULT 1
--   CHECK: month_start zwischen 1 und 28
--
-- Die Obergrenze 28 ist bewusst: höhere Werte gäbe es im Februar
-- nicht in jedem Jahr. Das Frontend begrenzt die Eingabe genauso
-- (src/pages/Settings.tsx).
--
-- NULL galt im Code immer als "1" (`settings.monthStart ?? 1`).
-- Schritt 2 schreibt diesen Standard deshalb fest, statt ihn
-- weiterhin nur im Client zu raten.
-- ============================================================

-- Schritt 1: Spalte anlegen, falls sie fehlt.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS month_start integer;

-- Schritt 2: Default setzen und bestehende NULLs auffüllen.
-- Getrennt vom ADD COLUMN, weil "ADD COLUMN IF NOT EXISTS" bei einer
-- bereits vorhandenen Spalte nichts tut — ein dort angehängtes
-- DEFAULT würde still wirkungslos bleiben.
ALTER TABLE public.settings
  ALTER COLUMN month_start SET DEFAULT 1;

UPDATE public.settings
   SET month_start = 1
 WHERE month_start IS NULL;

-- Schritt 3: NOT NULL erzwingen. Nach Schritt 2 gibt es keine
-- NULL-Werte mehr, der Übergang kann also nicht scheitern.
ALTER TABLE public.settings
  ALTER COLUMN month_start SET NOT NULL;

-- Schritt 4: Wertebereich absichern.
-- Der Constraint-Name ist derselbe wie in mcp-schema.sql; läuft
-- diese Datei zuerst, überspringt mcp-schema.sql den Block, und
-- umgekehrt.
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


-- ============================================================
-- Prüfung
--
-- Fragt nach ABWESENHEIT: Was fehlt noch? Eine Prüfung, die nur
-- bestätigt, was da sein soll, könnte gar nicht fehlschlagen.
-- ============================================================

DO $$
DECLARE
  befunde text[] := '{}';
  r       record;
BEGIN
  SELECT a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS defexpr, t.typname
    INTO r
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.settings'::regclass
     AND a.attname  = 'month_start'
     AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settings.month_start existiert nach der Migration nicht.';
  END IF;

  IF r.typname <> 'int4' THEN
    befunde := befunde || format('month_start hat den Typ %s statt integer.', r.typname);
  END IF;
  IF NOT r.attnotnull THEN
    befunde := befunde || 'month_start ist noch NULL-fähig.';
  END IF;
  IF r.defexpr IS DISTINCT FROM '1' THEN
    befunde := befunde || format('Default ist %L statt 1.', coalesce(r.defexpr, '<keiner>'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'settings_month_start_check'
       AND conrelid = 'public.settings'::regclass
  ) THEN
    befunde := befunde || 'Der CHECK-Constraint settings_month_start_check fehlt.';
  END IF;

  -- Gibt es trotz Constraint Werte ausserhalb 1..28?
  PERFORM 1 FROM public.settings WHERE month_start < 1 OR month_start > 28;
  IF FOUND THEN
    befunde := befunde || 'Es gibt Zeilen mit month_start ausserhalb von 1..28.';
  END IF;

  IF array_length(befunde, 1) > 0 THEN
    RAISE EXCEPTION E'Prüfung fehlgeschlagen, Migration zurückgerollt:\n  - %',
      array_to_string(befunde, E'\n  - ');
  END IF;

  RAISE NOTICE 'settings.month_start: integer NOT NULL DEFAULT 1, Wertebereich 1..28 abgesichert.';
END $$;
