import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ACCENT } from '../utils';

// ── OAuth-Consent ─────────────────────────────────────────────────────────────
// Supabase leitet nach /authorize mit einer authorization_id hierher.
// Der Ablauf nutzt die OAuth-Server-Methoden von supabase-js
// (supabase.auth.oauth.*), vorhanden ab @supabase/auth-js 2.107.
//
// Es werden keine HTTP-Endpunkte von Hand nachgebaut.
//
// Zwei Eigenschaften sind hier bewusst so gebaut und sollten so bleiben:
//
// 1. Diese Seite leitet NIE von selbst zum Client zurück. Auch wenn Supabase
//    meldet, die Zustimmung liege bereits vor, muss sie aktiv bestätigt werden.
//    Ein Consent, den niemand gesehen hat, ist keine Zustimmung — und ohne
//    diesen Halt würde auf einem geteilten Gerät still das zuletzt angemeldete
//    Konto autorisiert.
//
// 2. Der Kontowechsel meldet die Sitzung ab, OHNE zu navigieren. Die Adresse
//    dieser Seite bleibt dabei unverändert, weshalb sämtliche OAuth-Parameter
//    den Umweg überstehen — auch solche, die dieser Code gar nicht kennt.
//    Würde man stattdessen auf /login umleiten und die Parameter von Hand
//    wieder anhängen, ginge beim ersten übersehenen Parameter der Flow kaputt.

type Details = {
  authorization_id: string;
  redirect_uri: string;
  client: { name?: string; client_id?: string; client_uri?: string; logo_uri?: string };
  user: { id: string; email: string };
  scope: string;
};

function mapAuthError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'E-Mail oder Passwort falsch.';
  if (msg.includes('Email not confirmed')) return 'Bitte bestätige zuerst deine E-Mail-Adresse.';
  if (msg.includes('too many requests')) return 'Zu viele Versuche. Bitte warte kurz.';
  return msg;
}

const inputCls =
  'w-full border border-gray-200 dark:border-gray-600 rounded px-3 py-2.5 text-sm bg-white ' +
  'dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 ' +
  'focus:outline-none focus:border-[#4A6FA5]';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src="/logo.png" alt="Finance Logo" className="w-8 h-8 object-contain" />
          <span className="font-semibold text-gray-900 dark:text-gray-100 text-base tracking-tight">Finance</span>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-7">
          {children}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="w-8 h-8 border-2 border-gray-200 dark:border-gray-700 rounded-full animate-spin mx-auto"
      style={{ borderTopColor: ACCENT }}
    />
  );
}

// ── Inline-Login, damit der Nutzer die Seite nicht verlässt ───────────────────

function InlineLogin({ clientHint, switched }: { clientHint: string; switched: boolean }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      // Kein Redirect nötig: AuthContext meldet die neue Session,
      // diese Seite lädt die Autorisierungsdetails danach selbst.
    } catch (err) {
      setError(mapAuthError(err instanceof Error ? err.message : 'Unbekannter Fehler'));
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Anmelden</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {switched
          ? 'Die vorherige Sitzung wurde in diesem Browser beendet. Melde dich mit dem Konto an, das du verbinden möchtest.'
          : clientHint + ' wartet auf deine Freigabe. Melde dich an, um fortzufahren.'}
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            E-Mail
          </label>
          <input
            type="email" required autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            Passwort
          </label>
          <input
            type="password" required autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)}
            className={inputCls}
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit" disabled={loading}
          className="w-full py-2.5 text-sm font-semibold text-white rounded disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {loading ? 'Anmelden…' : 'Anmelden'}
        </button>
      </form>
    </>
  );
}

// ── Konto, für das die Freigabe gilt ─────────────────────────────────────────
// Steht bewusst oberhalb der Buttons und nicht im Kleingedruckten: wer hier
// zustimmt, soll ohne Suchen sehen, welches Konto er gerade freigibt.

function AccountBlock({
  email, mismatch, busy, switching, onSwitch,
}: {
  email: string;
  mismatch: string | null;
  busy: boolean;
  switching: boolean;
  onSwitch: () => void;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3.5 mb-5 bg-gray-50 dark:bg-gray-700/40">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        Freigabe gilt für
      </p>
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
          style={{ backgroundColor: ACCENT }}
          aria-hidden="true"
        >
          {email.charAt(0).toUpperCase()}
        </div>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate" title={email}>
          {email}
        </p>
      </div>

      {mismatch && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-2.5 leading-relaxed">
          Achtung: In diesem Browser ist <strong>{mismatch}</strong> angemeldet, freigegeben würde aber
          das oben genannte Konto. Wechsle das Konto, wenn das nicht beabsichtigt ist.
        </p>
      )}

      <button
        type="button"
        onClick={onSwitch}
        disabled={busy}
        className="mt-3 text-xs font-medium underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
        style={{ color: ACCENT }}
      >
        {switching ? 'Sitzung wird beendet…' : 'Anderes Konto verwenden'}
      </button>
    </div>
  );
}

// ── Consent ───────────────────────────────────────────────────────────────────

export default function ConsentPage() {
  const [params] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  // Supabase verwendet authorization_id; ältere Beispiele nennen es auth_id.
  const authorizationId = params.get('authorization_id') ?? params.get('auth_id') ?? '';

  const [details, setDetails] = useState<Details | null>(null);
  // Gesetzt, wenn Supabase meldet, die Zustimmung liege bereits vor. Wir merken
  // uns die Rücksprung-Adresse und warten auf eine aktive Bestätigung, statt
  // sofort dorthin zu springen.
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'approve' | 'deny' | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switched, setSwitched] = useState(false);

  const load = useCallback(async () => {
    if (!authorizationId || !user) return;
    setLoading(true);
    setError(null);
    // Reste des zuvor angemeldeten Kontos verwerfen, bevor neu geladen wird.
    setDetails(null);
    setReturnUrl(null);
    try {
      const { data, error: e } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (e) throw e;
      if (!data) throw new Error('Keine Autorisierungsdaten erhalten.');

      if ('authorization_id' in data) {
        setDetails(data as Details);
      } else {
        // Zustimmung liegt bereits vor. Adresse merken, nicht folgen — die
        // Bestätigung holt sich der Nutzer weiter unten selbst ab.
        setReturnUrl(data.redirect_url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Anfrage konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [authorizationId, user]);

  useEffect(() => { load(); }, [load]);

  async function decide(kind: 'approve' | 'deny') {
    if (!authorizationId) return;
    setDeciding(kind);
    setError(null);
    try {
      const { data, error: e } =
        kind === 'approve'
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (e) throw e;
      if (!data?.redirect_url) throw new Error('Es wurde keine Rücksprung-Adresse geliefert.');
      window.location.href = data.redirect_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Entscheidung konnte nicht übermittelt werden.');
      setDeciding(null);
    }
  }

  // Bereits erteilte Zustimmung: der Nutzer bestätigt sie erneut, dann geht es
  // zur gemerkten Adresse zurück.
  function confirmReturn() {
    if (!returnUrl) return;
    setDeciding('approve');
    window.location.href = returnUrl;
  }

  // Kontowechsel: nur die Sitzung dieses Browsers beenden. Bewusst
  // scope: 'local' — ein globales Abmelden würde alle Sitzungen des Nutzers auf
  // allen Geräten verwerfen, obwohl hier nur ein anderes Konto gemeint ist.
  //
  // Es wird NICHT navigiert. Dadurch bleibt die Adresse mitsamt allen
  // OAuth-Parametern unverändert; sobald user auf null fällt, rendert diese
  // Komponente das Login-Formular an derselben Stelle, und nach dem Login läuft
  // load() erneut.
  async function switchAccount() {
    setSwitching(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.signOut({ scope: 'local' });
      if (e) throw e;
      setDetails(null);
      setReturnUrl(null);
      setSwitched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Sitzung konnte nicht beendet werden.');
    } finally {
      setSwitching(false);
    }
  }

  // ── Zustände ──────────────────────────────────────────────

  if (!authorizationId) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Ungültiger Aufruf</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Diese Seite wird von Supabase mit einer Autorisierungs-ID aufgerufen. In der Adresse fehlt der
          Parameter <code className="text-xs">authorization_id</code>. Starte die Verbindung erneut aus der
          Anwendung heraus, die den Zugriff anfragt.
        </p>
      </Shell>
    );
  }

  if (authLoading) {
    return <Shell><Spinner /></Shell>;
  }

  if (!user) {
    return <Shell><InlineLogin clientHint="Eine Anwendung" switched={switched} /></Shell>;
  }

  if (loading) {
    return (
      <Shell>
        <Spinner />
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-3">Anfrage wird geladen…</p>
      </Shell>
    );
  }

  if (error && !details && !returnUrl) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Anfrage nicht ladbar</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          Mögliche Gründe: der Link ist abgelaufen, wurde bereits verwendet, oder die Autorisierungs-ID
          in der Adresse ist ungültig. Starte die Verbindung in diesem Fall erneut aus der Anwendung
          heraus, die den Zugriff anfragt.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Meldung: {error}</p>
        <div className="flex gap-3">
          <button
            onClick={load}
            className="px-4 py-2 text-sm font-medium text-white rounded"
            style={{ backgroundColor: ACCENT }}
          >
            Erneut versuchen
          </button>
          <button
            onClick={switchAccount}
            disabled={switching}
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {switching ? 'Sitzung wird beendet…' : 'Anderes Konto verwenden'}
          </button>
        </div>
      </Shell>
    );
  }

  const clientName = details?.client?.name?.trim() || 'Eine unbekannte Anwendung';

  // Massgeblich ist die E-Mail aus den Autorisierungsdetails: das ist das Konto,
  // das der Server autorisieren wird. user.email ist nur die lokale Sitzung.
  // Weichen beide ab, wird das im Kontoblock als Warnung sichtbar.
  const serverEmail = details?.user?.email?.trim() || '';
  const localEmail = user.email?.trim() || '';
  const shownEmail = serverEmail || localEmail || 'Unbekanntes Konto';
  const mismatch = serverEmail && localEmail && serverEmail !== localEmail ? localEmail : null;

  const busy = deciding !== null || switching;

  // ── Zustimmung liegt bereits vor ──────────────────────────
  // Früher wurde hier sofort weitergeleitet. Genau das ist der Fall, in dem ein
  // "Trennen" auf Claude-Seite die Browser-Sitzung stehen liess und der nächste
  // Verbindungsversuch ungefragt durchlief.

  if (returnUrl) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Erneut verbinden</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Für diese Anwendung liegt bereits eine Freigabe vor. Prüfe das Konto und bestätige die
          Verbindung.
        </p>

        <AccountBlock
          email={shownEmail} mismatch={mismatch} busy={busy}
          switching={switching} onSwitch={switchAccount}
        />

        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

        <button
          onClick={confirmReturn}
          disabled={busy}
          className="w-full py-2.5 text-sm font-semibold text-white rounded disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {deciding === 'approve' ? 'Wird verbunden…' : 'Verbinden'}
        </button>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
          Du kannst die Freigabe jederzeit widerrufen. Jeder Zugriff wird unter
          Einstellungen → KI-Zugriff protokolliert.
        </p>
      </Shell>
    );
  }

  // ── Erstmalige Zustimmung ─────────────────────────────────

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        Zugriff erlauben?
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        <strong className="text-gray-700 dark:text-gray-300">{clientName}</strong> möchte auf dein
        Finanzkonto zugreifen.
      </p>

      <AccountBlock
        email={shownEmail} mismatch={mismatch} busy={busy}
        switching={switching} onSwitch={switchAccount}
      />

      {/* Rechte */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 mb-5">
        <div className="flex items-start gap-3 p-3">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: ACCENT }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Erlaubt</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Alle Daten lesen, neue Transaktionen anlegen.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-300 dark:text-gray-600"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Nicht erlaubt</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Ändern, löschen.
            </p>
          </div>
        </div>
      </div>

      {/* Details */}
      <dl className="text-xs space-y-1.5 mb-6">
        {details?.redirect_uri && (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-400 dark:text-gray-500 flex-shrink-0">Rücksprung</dt>
            <dd className="text-gray-600 dark:text-gray-300 truncate">{details.redirect_uri}</dd>
          </div>
        )}
        {details?.scope && (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-400 dark:text-gray-500 flex-shrink-0">Bereiche</dt>
            <dd className="text-gray-600 dark:text-gray-300 truncate">{details.scope}</dd>
          </div>
        )}
      </dl>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={() => decide('approve')}
          disabled={busy}
          className="flex-1 py-2.5 text-sm font-semibold text-white rounded disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {deciding === 'approve' ? 'Wird erlaubt…' : 'Erlauben'}
        </button>
        <button
          onClick={() => decide('deny')}
          disabled={busy}
          className="flex-1 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {deciding === 'deny' ? 'Wird abgelehnt…' : 'Ablehnen'}
        </button>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
        Du kannst die Freigabe jederzeit widerrufen. Jeder Zugriff wird unter
        Einstellungen → KI-Zugriff protokolliert.
      </p>
    </Shell>
  );
}
