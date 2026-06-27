# FinanzTracker

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
2. Im **SQL Editor** den Inhalt von `supabase/schema.sql` ausführen — das legt alle Tabellen mit Row Level Security an.
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
| Dashboard | KPI-Karten, Einnahmen/Ausgaben-Chart, Kontostandsverlauf, Donut-Chart |
| Transaktionen | Tabelle mit Filter, Suche, Sortierung, Löschen, CSV-Export |
| Neue Transaktion | Formular + eigene Kategorien |
| Auswertungen | Top-5-Kategorien, Ø-Ausgaben, Spartrend, Ausgabenrhythmus, Jahresübersicht |
| Einstellungen | Profil, Startsaldo, CSV/JSON-Export, CSV-Import, Kategorieverwaltung, Datensatz-Reset |
