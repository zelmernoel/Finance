# MCP-Setup — Claude-Zugriff auf den Finance

Claude (claude.ai) darf **alle Finanzdaten lesen** und **Transaktionen, Notizen
und Sparttöpfe anlegen**. Ändern und Löschen sind gesperrt — nicht in der
Oberfläche, sondern durch Row Level Security in der Datenbank. Jede Änderung
wird protokolliert, auch die aus der App.

Reihenfolge einhalten.

---

## Überblick der Dateien

| Datei | Zweck |
|---|---|
| `supabase/mcp-schema.sql` | Migration: Rollen, Spalten, Funktionen, Tabellen, Grants, Hook, RLS-Policies, Trigger |
| `supabase/mcp-verify.sql` | Verhaltensprüfung danach (Rollenwechsel, Token-Simulation) |
| `supabase/functions/mcp/index.ts` | Der MCP-Server als Edge Function |
| `supabase/config.toml` | `verify_jwt = false` für die Function |
| `src/pages/ConsentPage.tsx` | Zustimmungsseite unter `/oauth/consent` |
| `src/lib/activityLog.ts` | Lesezugriff auf das Änderungsprotokoll |
| `src/lib/transactionNotes.ts` | Notizen lesen und anhängen |

Geändert: `src/types.ts`, `src/lib/supabaseAdapter.ts`, `src/App.tsx`,
`src/MainApp.tsx`, `src/pages/Transactions.tsx`, `src/pages/Settings.tsx`.

---

## Das Sicherheitsmodell in zwei Schichten

### Was Claude darf

| | |
|---|---|
| Lesen | alles |
| Anlegen | Transaktionen, Notizen, Sparttöpfe |
| Ändern | nichts |
| Löschen | nichts |
| Protokoll | jede Änderung, egal von wem, Herkunft markiert |

Das Anlegen von Sparttöpfen hängt zusätzlich am Schalter
*Einstellungen → KI-Zugriff → Sparttöpfe anlegen*
(`settings.mcp_allow_pot_creation`). Er wird zweifach geprüft: im Tool, mit
klarer Fehlermeldung, und in der INSERT-Policy auf `savings_pots` — am Tool
vorbei geht es also nicht.

**Schicht 1 — RLS. Die tragende.**
Ein Token mit `client_id`-Claim gilt als Fremdclient. Access-Tokens des
OAuth-2.1-Servers tragen diesen Claim immer, Sessions aus
`signInWithPassword` nie. Fremdclients dürfen lesen und Transaktionen mit
`source = 'mcp'` anlegen — sonst nichts.

Das schliesst im Zweifel **zu**: Ein Client, der nirgends eingetragen ist, hat
dadurch keine Sonderrechte, sondern weniger. Ein Versäumnis bei der Pflege
macht das System strenger, nicht durchlässiger.

**Schicht 2 — eigene Postgres-Rolle. Zusätzlich, optional.**
Ein Custom Access Token Hook schreibt den `role`-Claim auf `mcp_agent` um.
Diese Rolle hat nur die explizit vergebenen Table-Grants und **keine
Default-Privileges**. Eine künftig angelegte Tabelle ist für sie automatisch
dicht — auch wenn jemand RLS vergisst. `authenticated` bekommt bei Supabase
über `pg_default_acl` dagegen automatisch `arwdDxtm` auf jede neue Tabelle.

Schicht 2 ersetzt Schicht 1 nicht. Ohne registrierten Hook bleibt der
`role`-Claim `authenticated`, und Schicht 1 greift allein.

---

## Schritt 1 — Migration ausführen

Dashboard → **SQL Editor** → Inhalt von `supabase/mcp-schema.sql` einfügen →
**Run**. Idempotent; mehrfaches Ausführen schadet nicht.

Am Ende läuft eine Katalogprüfung. Findet sie etwas, bricht sie mit einer
Aufzählung aller Befunde ab und die **gesamte Migration wird zurückgerollt** —
lieber gar nichts als ein halber Zustand.

**Zwei Dinge, die diese Migration am Bestand ändert und die du kennen solltest:**

1. **`auth.uid()` in den Policies wird durch `public.jwt_user_id()` ersetzt.**
   Semantisch identisch — die Funktion liest dieselbe Sitzungsvariable
   (`request.jwt.claims`), aus der auch `auth.uid()` liest. Der Grund: das
   Schema `auth` gehört `supabase_admin`, und die Rolle `postgres` kann dort
   keine Rechte vergeben. Ein `GRANT USAGE ON SCHEMA auth` an eine neue Rolle
   **warnt nur und bewirkt nichts**. Ohne den Tausch könnten weder
   `mcp_fn_owner` (Eigentümer der Definer-Funktionen) noch `mcp_agent` die
   Policies überhaupt auswerten. Das ist die Änderung, die am ehesten deine
   Durchsicht verdient.

2. **`settings.month_start` wird nachgezogen.** Der Anwendungscode liest und
   schreibt die Spalte seit längerem, aber keine bisherige `.sql`-Datei legt
   sie an (`SYSTEM-REPORT.md`, 7.1). Falls du sie damals von Hand angelegt
   hast, ist die Anweisung wirkungslos.

Ausserdem werden die sieben bestehenden `FOR ALL`-Policies durch je vier
getrennte ersetzt (SELECT/INSERT/UPDATE/DELETE), weil eine `FOR ALL`-Policy
keine unterschiedlichen Bedingungen pro Operation tragen kann.

---

## Schritt 2 — Verhaltensprüfung

Dashboard → **SQL Editor** → `supabase/mcp-verify.sql` → **Run**.

Ergebnis ist eine Tabelle. **Jede Zeile mit `>>> BEFUND <<<` ist ein Problem.**
Die letzte Abfrage zeigt die Anzahl; erwartet ist `befunde = 0`.

Diese Datei ist bewusst von der Migration getrennt: sie wechselt Rollen und
simuliert Tokens. Ein Fehlschlag hier soll eine korrekte Migration nicht
zurückrollen.

Sie prüft unter anderem den Fall, der sonst **still** schiefgeht: ob
`is_revoked_client()` die Tabelle `mcp_clients` überhaupt sehen kann. RLS gilt
auch für den Eigentümer einer `SECURITY DEFINER`-Funktion — ohne die
ausdrückliche Policy `TO mcp_fn_owner` läse die Funktion null Zeilen, ohne
Fehler, und jeder Widerruf wäre wirkungslos.

Prüfung 9, 10 und 13 erwarten ausdrücklich, dass etwas **nicht** geht.

---

## Schritt 3 — Asymmetrische JWT-Signaturschlüssel

Der MCP-Server prüft Tokens gegen
`https://<PROJECT-REF>.supabase.co/auth/v1/.well-known/jwks.json`.
Das funktioniert nur mit asymmetrischen Schlüsseln, nicht mit dem alten
gemeinsamen HS256-Secret.

Dashboard → **Authentication → JWT Keys** → asymmetrischen Schlüssel anlegen
und als *current key* aktivieren.

**Prüfen:** URL im Browser öffnen, es muss ein nicht leeres `keys`-Array
kommen. Sonst meldet der MCP-Server später einen Klartextfehler.

---

## Schritt 4 — OAuth-2.1-Server und Consent-URL

Dashboard → **Authentication → OAuth Server** → aktivieren.

Consent-/Authorization-Page-URL:

```
https://<DEINE-NETLIFY-DOMAIN>/oauth/consent
```

Unter **Authentication → URL Configuration** die Netlify-Domain als *Site URL*
eintragen.

> Der OAuth-2.1-Server ist bei Supabase in Public Beta. Ist er für dein Projekt
> nicht freigeschaltet, schlägt `getAuthorizationDetails()` auf der
> Consent-Seite fehl. Die Methoden selbst sind in der installierten
> `@supabase/auth-js` 2.107.0 vorhanden — es fehlt dann nur die Serverseite.

---

## Schritt 5 — Edge Function deployen

```bash
supabase login
```

```bash
supabase link --project-ref <DEIN-PROJECT-REF>
```

```bash
supabase functions deploy mcp --no-verify-jwt
```

`--no-verify-jwt` entspricht `verify_jwt = false` in `supabase/config.toml`.
Kein Sicherheitsloch: die Function prüft jedes Token selbst (Signatur gegen
JWKS, `exp`, `iss`). Abgeschaltet werden muss die eingebaute Prüfung nur, weil
MCP-Clients den Metadaten-Endpunkt `/.well-known/oauth-protected-resource`
laut RFC 9728 **ohne** Token abrufen müssen. Jeder andere Pfad antwortet ohne
gültiges Token mit HTTP 401.

`SUPABASE_URL` und `SUPABASE_ANON_KEY` setzt die Edge-Runtime automatisch.
**Es muss nichts weiter gesetzt werden** — insbesondere kein Service-Role-Key.

---

## Schritt 6 — Frontend deployen und Claude verbinden

```bash
npm run build
```

In claude.ai → **Settings → Connectors → Add custom connector**:

```
https://<PROJECT-REF>.supabase.co/functions/v1/mcp
```

Claude findet über den 401-Header `WWW-Authenticate: Bearer resource_metadata=…`
den Metadaten-Endpunkt, von dort den Authorization Server, und leitet dich auf
deine Consent-Seite. Nach „Erlauben" ist die Verbindung aktiv.

**Ab hier greift Schicht 1 vollständig.** Die folgenden Schritte sind
Zusatzhärtung und Komfort.

---

## Schritt 7 — Optional: Hook aktivieren (Schicht 2)

**Erst nach dem Test unten aktivieren.** Der Hook läuft bei *jeder*
Tokenausgabe, auch bei normalen App-Logins.

Die Funktion `public.custom_access_token_hook` wurde von der Migration bereits
angelegt und ist defensiv gebaut: bei jedem internen Fehler gibt sie das Event
unverändert zurück, damit ein Problem hier keine Anmeldung blockiert.

1. Dashboard → **Authentication → Hooks** → *Custom Access Token* →
   `public.custom_access_token_hook` auswählen und aktivieren.
2. In claude.ai den Connector einmal trennen und neu verbinden, damit ein
   frisches Token ausgestellt wird.
3. **Token prüfen** (siehe unten). Steht dort nicht `"role": "mcp_agent"`,
   wirkt Schicht 2 nicht — Schicht 1 aber sehr wohl.

### Zur Frage, ob Hooks bei OAuth-2.1-Tokens laufen

Sie tun es. Supabase dokumentiert das ausdrücklich: *„Custom Access Token
Hooks are triggered for **all** token issuance"*, mit `client_id` bzw.
`authentication_method` als empfohlenem Unterscheidungsmerkmal für
OAuth-Flows ([Token Security and Row Level
Security](https://supabase.com/docs/guides/auth/oauth-server/token-security),
[Custom Access Token
Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)).

Zwei Einschränkungen bleiben und rechtfertigen den Test in Schritt 3:

- Der OAuth-2.1-Server ist Public Beta; das Verhalten kann sich ändern.
- Supabase **empfiehlt den Rollentausch selbst nicht**. Die Dokumentation zeigt
  `"role": "authenticated"` auch für OAuth-Tokens und setzt allein auf RLS mit
  `(auth.jwt() ->> 'client_id') IS NOT NULL` — genau die Bedingung, die diese
  Migration als Schicht 1 verwendet. Schicht 2 geht darüber hinaus.

### Token dekodieren

Nach dem Neuverbinden in claude.ai. Ein Access-Token aus dem Browser (App,
also *ohne* `client_id`) bekommst du in der Konsole der laufenden App:

```bash
node -e "const t=process.argv[1];console.log(JSON.parse(Buffer.from(t.split('.')[1],'base64url')))" <TOKEN>
```

Erwartet für ein Claude-Token: `client_id` gesetzt **und** `role` =
`mcp_agent`. Für ein App-Token: kein `client_id`, `role` = `authenticated`.

---

## Schritt 8 — Optional: Client beschriften

**Nicht sicherheitskritisch.** Ein Client, der hier fehlt, hat keine
zusätzlichen Rechte — die Erkennung hängt allein am `client_id`-Claim.

Der Eintrag dient zwei Zwecken: einem lesbaren Namen und dem **Widerruf**.

```sql
select id, client_name, created_at
from auth.oauth_clients
order by created_at desc;
```

```sql
insert into public.mcp_clients (client_id, label)
values ('<CLIENT-ID-VON-CLAUDE>', 'Claude (claude.ai)')
on conflict (client_id) do nothing;
```

---

## Indirekte Effekte

Ein Schreibzugriff über MCP ändert **mehr als eine Tabelle**. Zwei Mechanismen
laufen dabei als `SECURITY DEFINER` und damit **an RLS vorbei**; weder die
Policies noch der MCP-Server können sie verhindern.

### 1. Protokollierung — bei jedem Schreibzugriff

| Tabelle | was passiert | ausgelöst durch |
|---|---|---|
| `activity_log` | eine Zeile je geänderter Datenzeile, mit `before`/`after` als JSON und `actor` = `app` oder `mcp` | `trg_log_transactions`, `trg_log_transaction_notes`, `trg_log_savings_pots` → `log_activity()` |

Diese Trigger feuern **auch bei Änderungen aus der App** — genau das ist ihr
Zweck. Wer in der Oberfläche eine Buchung löscht, findet sie danach im
Protokoll wieder, mit dem alten Inhalt in `before`.

Zusätzlich schreibt der MCP-Server selbst je Tool-Aufruf eine Zeile mit
`action = 'read'`. Das gilt auch für die schreibenden Tools: nur so bleibt
ein *fehlgeschlagener* Aufruf sichtbar, bei dem gar keine Änderung zustande
kam und deshalb auch kein Trigger feuerte.

Ein erfolgreicher `create-transaction` erzeugt also mindestens zwei Zeilen:
den Aufruf (`read`) und die Buchung (`insert`).

### 2. Spartopf-Verteilung — bei Einnahmen

Bei einem MCP-Insert mit `type = 'income'` und Sparttöpfen im selben Bereich:

| Tabelle | was passiert | ausgelöst durch |
|---|---|---|
| `transactions` | die Buchung selbst, `source = 'mcp'` | der MCP-Server |
| `pot_allocations` | eine Zeile je Topf mit `allocation_percent > 0` | `trg_distribute_income` → `apply_pot_distribution()` |
| `savings_pots` | `current_amount` und `updated_at` steigen je Topf | `trg_sync_pot_amount` → `sync_pot_current_amount()` |
| `activity_log` | eine `update`-Zeile je berührtem Topf | `trg_log_savings_pots` |

Bei `type = 'expense'` passiert nichts davon — `apply_pot_distribution()`
steigt bei allem ausser positiven Einnahmen sofort aus.

**Zur Menge:** Eine Einnahme mit drei befüllten Töpfen erzeugt eine
`insert`-Zeile für die Buchung plus drei `update`-Zeilen für die Töpfe. Das
ist gewollt — jede Änderung wird protokolliert — macht das Log bei vielen
Töpfen aber gesprächig.

Beim **Löschen** einer solchen Buchung in der App räumt der FK-CASCADE auf
`pot_allocations.income_transaction_id` auf, und `sync_pot_current_amount()`
bucht `current_amount` zurück. Claude kann nicht löschen; das betrifft nur dich.
Notizen verschwinden auf demselben Weg mit ihrer Transaktion.

**Deshalb meldet `create-transaction` die Verteilung mit.** Die Antwort enthält
`spartopf_verteilung` mit Betrag je Topf, und die Bestätigungszeile wird
ergänzt:

```
Eingetragen: 2.000,00 € Einnahme, Kategorie Lohn, 03.09.2026,
Budget Persönlich — ID abc123 Davon automatisch auf Sparttöpfe verteilt:
600,00 € (Notgroschen 400,00 €, Urlaub 200,00 €).
```

Lässt sich die Verteilung nicht nachlesen, steht das ebenfalls in der Antwort —
statt sie zu verschweigen.

### Wenn das Protokoll leer bleibt

`log_activity()` darf die auslösende Buchung **nie** zum Scheitern bringen.
Jeder Fehler beim Protokollieren wird deshalb gefangen und nur als `NOTICE`
ausgegeben — im Supabase-Dashboard sieht man davon nichts.

Die Kehrseite: ein fehlendes Recht bliebe unbemerkt, das Log einfach leer.
Dagegen stehen zwei Prüfungen. Die Migration prüft im Katalog, ob
`mcp_fn_owner` sowohl das `INSERT`-Recht als auch die Policy auf
`activity_log` hat (RLS gilt auch für den Eigentümer einer
Definer-Funktion — dieselbe Falle wie bei `mcp_clients`).
`mcp-verify.sql` schreibt zusätzlich probeweise als diese Rolle und liest die
Zeile zurück.

## Inventar der SECURITY-DEFINER-Funktionen

Definer-Funktionen umgehen RLS vollständig; es zählen nur die Rechte ihres
Eigentümers. Deshalb hier vollständig, auch der Bestand.

### Neu in dieser Migration

| Funktion | Eigentümer | `search_path` | schreibt |
|---|---|---|---|
| `public.is_mcp_client()` | `mcp_fn_owner` | `''` gesetzt | nichts (liest nur `request.jwt.claims`) |
| `public.is_revoked_client()` | `mcp_fn_owner` | `''` gesetzt | nichts (liest `public.mcp_clients`) |

`mcp_fn_owner` hat ausser `USAGE` auf `public` nur `SELECT` auf
`mcp_clients` — mehr kann der Definer-Kontext nicht.

Nicht Definer, der Vollständigkeit halber: `public.jwt_claims()` und
`public.jwt_user_id()` sind `SECURITY INVOKER` mit `search_path = ''`;
`public.custom_access_token_hook(jsonb)` ist ebenfalls Invoker und läuft
ausschliesslich als `supabase_auth_admin`.

### Bestand aus `savings-pots.sql` — nur gemeldet, nicht geändert

Diese fünf existieren seit dem Spartöpfe-Feature. Ihr Eigentümer ist die
Rolle, die `savings-pots.sql` ausgeführt hat (in aller Regel `postgres`) —
also eine Rolle mit sehr weitreichenden Rechten.

| Funktion | Definer | `search_path` | schreibt in |
|---|---|---|---|
| `sync_pot_current_amount()` | ja | `public, pg_temp` | `savings_pots` |
| `apply_pot_distribution(tx transactions)` | ja | `public, pg_temp` | `pot_allocations` |
| `tx_insert_distribute()` | ja | `public, pg_temp` | mittelbar `pot_allocations`, `savings_pots` |
| `tx_update_redistribute()` | ja | `public, pg_temp` | `pot_allocations` (löscht und legt neu an) |
| `check_pot_allocation_sum()` | **nein** (Invoker) | nicht gesetzt | nichts (nur Prüfung) |

Zwei Punkte, die du separat entscheiden solltest — ich habe hier bewusst
nichts angefasst:

1. **`search_path = public, pg_temp` statt `''`.** Mit `pg_temp` im Suchpfad
   kann eine Rolle, die temporäre Objekte anlegen darf, unter Umständen einen
   Funktionsaufruf umlenken. Empfehlung wäre `SET search_path = ''` plus
   durchgehende Schema-Qualifizierung — das ist ein Eingriff in laufende
   Trigger und gehört in einen eigenen, getesteten Schritt.
2. **Eigentümer.** Läuft alles unter `postgres`, hat jede dieser Funktionen
   effektiv volle Rechte. Eine eigene, schmale Eigentümerrolle wäre auch hier
   die sauberere Form.

Die Katalogprüfung am Ende der Migration meldet jede Definer-Funktion ohne
gesetzten `search_path` als `WARNING` — sie bricht deswegen nicht ab.

---

## Testen

### Metadaten ohne Token

```bash
curl -s https://<PROJECT-REF>.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource
```

Erwartet: HTTP 200, JSON mit `resource` und `authorization_servers`.

### Zugriff ohne Token

```bash
curl -i -X POST https://<PROJECT-REF>.supabase.co/functions/v1/mcp -d '{}'
```

Erwartet: HTTP 401 mit
`WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.

### Tools auflisten

Ein App-Token bekommst du in der Browser-Konsole der laufenden App:
`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('sb-')))).access_token`

```bash
curl -s -X POST https://<PROJECT-REF>.supabase.co/functions/v1/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Erwartet: elf Tools, darunter `create-transaction`.

### Die Sperre wirkt

Der Nachweis über Claude, sobald verbunden:

- Claude eine Transaktion **anlegen** lassen → funktioniert, erscheint in der
  App mit „KI"-Kennzeichen, Verteilung wird in der Antwort mitgemeldet.
- Claude **ändern oder löschen** lassen → dafür gibt es kein Tool, und die
  Datenbank lehnt es auch direkt ab:

```bash
# Muss mit einem RLS-Fehler bzw. 403 antworten
curl -i -X PATCH \
  "https://<PROJECT-REF>.supabase.co/rest/v1/transactions?id=eq.<TX-ID>" \
  -H "apikey: <ANON-KEY>" \
  -H "Authorization: Bearer <CLAUDE-TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"description":"manipuliert"}'
```

### Protokoll

App → **Einstellungen → KI-Zugriff**: die letzten 50 Änderungen, mit Filter
„Alle / Nur KI" und Sprung auf die betroffene Buchung. Oder:

```sql
select created_at, actor, entity, action, tool, status, entity_id
from public.activity_log order by created_at desc limit 20;
```

---

## Was Claude kann und was nicht

**Lesen (elf Tools):** `list-budgets`, `list-categories`, `list-transactions`,
`get-summary`, `analyze-by-category`, `compare-periods`, `list-recurring`,
`list-pots`, `get-settings`, `list-notes`, `list-activity-log`.

**Schreiben (drei Tools):** `create-transaction`, `add-note`,
`create-savings-pot`. Alle drei legen nur an — es gibt kein Tool zum Ändern
oder Löschen, und die Datenbank liesse es auch nicht zu.

`add-note` prüft zuerst, dass die Transaktion existiert und zum Konto gehört,
schreibt dann mit `author = 'mcp'` und liest die Notiz zurück. Notizen sind
unveränderlich — auch für dich in der App.

`create-savings-pot` prüft zuerst den Schalter `mcp_allow_pot_creation`, dann
den Verteilungsanteil gegen die 100-Prozent-Grenze; bei Überschreitung nennt
die Fehlermeldung den noch freien Anteil. Danach Read-after-write.

`create-transaction` prüft vor dem Schreiben:

- `budget_id` existiert und gehört zum Konto, sonst Fehler mit Liste der gültigen Bereiche
- `category` kommt exakt so in `categories` vor (gleiches Budget, gleicher Typ),
  sonst Fehler mit Liste der gültigen Namen — nichts wird angelegt,
  normalisiert oder geraten
- `amount` > 0, ≤ 1000000, höchstens zwei Nachkommastellen
- `date` gültig und zwischen `2000-01-01` und heute + 1 Jahr

Danach wird die Zeile über ihre ID neu gelesen, die ausgelöste
Spartopf-Verteilung nachgeschlagen, und beides an Claude zurückgegeben.

**Nicht möglich:** irgendetwas ändern oder löschen; Kategorien, Bereiche,
Einstellungen oder Daueraufträge anlegen. Weder Tool noch Berechtigung.

---

## Noch ein Punkt zur Berechnung

`get-summary` und `analyze-by-category` verwenden ohne `from`/`to` den
laufenden Abrechnungsmonat. Das Frontend berechnet dessen Enddatum in
`getCustomMonthRange()` über `toISOString()` auf einem lokal konstruierten
`Date`; in Zeitzonen östlich von UTC — also auch in Deutschland — liegt das
Enddatum dort **einen Tag zu früh**. `getMonthRange()` in derselben Datei macht
es korrekt. Der MCP-Server verwendet die korrekte Variante. Bei
`monthStart = 1` fällt das nicht auf. Wer exakte Deckungsgleichheit will,
korrigiert den Fehler im Frontend, statt ihn im Server nachzubauen.

---

## Zugriff abschalten

```sql
-- Sofort, ohne etwas zu löschen und ohne Policy anzufassen:
update public.mcp_clients set revoked_at = now() where client_id = '<CLIENT-ID>';
```

Wirkt auf alle Lese-Policies und auf die beiden Insert-Policies, die
Fremdclients offenstehen. Rückgängig mit `revoked_at = null`.

Voraussetzung: die `client_id` steht in `mcp_clients` (Schritt 8). Ist sie
nicht eingetragen, bleibt der harte Weg — Connector in claude.ai entfernen und
den Client unter **Authentication → OAuth Server** widerrufen.

Vollständiger Rückbau von Schicht 2:

```sql
-- Hook im Dashboard deaktivieren, danach:
drop function if exists public.custom_access_token_hook(jsonb);
```

`activity_log`, `transaction_notes` und `transactions.source` bleiben erhalten —
reine Historie. Die Protokoll-Trigger laufen weiter und erfassen dann nur noch
die Änderungen aus der App.
