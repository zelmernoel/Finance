-- ============================================================
-- Finance — Onboarding-Flag
--
-- Im Supabase SQL Editor ausführen. Idempotent.
--
-- Speichert, ob der einmalige Erstkontakt durchlaufen wurde. Reine
-- Anzeigesteuerung: an den Daten hängt nichts davon ab.
--
-- Im Gast-Modus wird dasselbe Feld im localStorage-Settings-Objekt
-- abgelegt und braucht keine Migration.
-- ============================================================

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Bestandskonten haben die App bereits eingerichtet — für sie soll der
-- Erstkontakt nicht nachträglich aufpoppen. Nur einmal wirksam: bei einem
-- erneuten Lauf ist die Bedingung für dieselben Zeilen schon erfüllt.
UPDATE public.settings
   SET onboarding_completed = true
 WHERE onboarding_completed = false
   AND (name <> '' OR starting_balance <> 0);
