# Finance

Persönlicher Finanz-Tracker — vollständig lokal entwickelbar, mit Supabase als Backend.

## Tech Stack

| Schicht | Technologie |
|---------|-------------|
| Frontend | Vite + React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| Auth & DB | Supabase (PostgreSQL + Row Level Security) |
| Routing | React Router v7 |

---

## Einrichtung

### 1. Abhängigkeiten installieren

```bash
npm install
```

### 2. Supabase-Projekt erstellen

1. Auf [supabase.com](https://supabase.com) einloggen und ein neues Projekt anlegen.
2. Im **SQL Editor** nacheinander ausführen: `supabase/schema.sql` (Tabellen + RLS), `supabase/savings-pots.sql` (Sparttöpfe), `supabase/mcp-schema.sql` (MCP-Zugriff, siehe `MCP-SETUP.md`) und `supabase/tax.sql` (Steuer, Steuertopf, Kategorie-Vorbelegungen).
3. Unter **Project Settings → API** die folgenden Werte kopieren:
   - `Project URL`
   - `anon / public` Key

### 3. Umgebungsvariablen setzen

`.env.local` im Projektverzeichnis anlegen (wird von Git ignoriert):

```env
VITE_SUPABASE_URL=https://dein-projekt-id.supabase.co
VITE_SUPABASE_ANON_KEY=dein-anon-key-hier
```

### 4. Starten

```bash
npm run dev
```

App läuft auf `http://localhost:5173`.  
Beim ersten Start: Registrieren → E-Mail bestätigen → Anmelden.  
Default-Kategorien werden automatisch beim ersten Login angelegt.

---

## Datenspeicherung

Alle Daten liegen in Supabase (PostgreSQL) und sind durch **Row Level Security** geschützt:
jeder Nutzer sieht ausschließlich seine eigenen Transaktionen, Kategorien und Einstellungen.

---

## Deployment (Netlify)

1. Repository in Netlify importieren.
2. Build-Einstellungen:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
3. Unter **Environment Variables** die Supabase-Schlüssel eintragen:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. In Supabase unter **Authentication → URL Configuration** die Netlify-Domain als **Site URL** eintragen.

---

## Seiten

| Tab | Inhalt |
|-----|--------|
| Dashboard | Verfügbar (= Kontostand − Sparttöpfe) als Haupt-KPI, Einnahmen/Ausgaben-Chart, Kontostandsverlauf, Donut-Chart |
| Transaktionen | Tabelle mit Filter, Suche, Sortierung, Löschen, CSV-Export |
| Neue Buchung | Wizard in vier Schritten: Was (Typ + Kategorie) → Wie viel (im Firmenbereich mit Brutto/Netto/Steuer) → Details (Datum, Beschreibung, Dauerauftrag, Beleg, Notizen) → Prüfen |
| Auswertungen | Top-5-Kategorien, Ø-Ausgaben, Spartrend, Ausgabenrhythmus, Jahresübersicht |
| Sparttöpfe | Manuelle Töpfe (Prozent vom Netto jeder Einnahme) und der automatische Steuertopf (Umsatzsteuer rein, Vorsteuer raus) |
| Daueraufträge | Übersicht, Pausieren/Aktivieren; angelegt werden sie im Buchungs-Wizard |
| Einstellungen | Profil, Startsaldo, Kontostand-Abgleich, CSV/JSON-Export, CSV-Import, Kategorien mit Vorbelegungen (Steuersatz, Dauerauftrag), Datensatz-Reset |

## Steuer (Firmenbereiche)

Jede Buchung speichert den **Bruttobetrag** (`amount`, zählt zum Kontostand) und die darin **enthaltene Steuer** (`tax_amount`); Netto ist die Differenz. Beispiel: 1.499,40 € brutto bei 19 % → 1.260,00 € netto, 239,40 € USt (nicht 19 % vom Brutto — das wäre Steuer auf die Steuer).

Die Verteilung macht die Datenbank (Trigger in `supabase/tax.sql`), damit App, Daueraufträge und der MCP-Server dasselbe tun:

- Einnahme mit Steuer → Umsatzsteuer in den Steuertopf
- Ausgabe mit Steuer → Vorsteuer aus dem Steuertopf (Vorsteuerabzug)
- Zahlung ans Finanzamt / Erstattung → Buchung, die zu 100 % aus Steuer besteht (im Wizard: „Zahlung ans Finanzamt“)
- Prozent-Töpfe bekommen ihren Anteil vom Netto

„Verfügbar“ im Dashboard ist der Kontostand abzüglich aller Töpfe — der Steuertopf eingeschlossen, denn dieses Geld gehört dem Finanzamt.
