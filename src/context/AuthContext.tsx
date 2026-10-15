import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, authRedirectTo } from '../lib/supabase';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // supabase-js meldet SIGNED_IN bei jedem Tab-Fokus und TOKEN_REFRESHED
    // stündlich — jedes Mal mit einem NEUEN User-Objekt. Alles, was auf
    // `user` hängt (Storage-Adapter, Budget-Liste, Daten laden), würde dann
    // neu starten: Ladebalken, verlorene Eingaben, doppelt gebuchte
    // Daueraufträge. Deshalb bleibt das alte Objekt, solange die ID gleich ist.
    const applySession = (next: Session | null) => {
      setSession(next);
      setUser(prev => (prev?.id === (next?.user?.id ?? null) ? prev : next?.user ?? null));
      setLoading(false);
    };

    // Initiale Session lesen (z. B. nach Page-Reload)
    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    // Auf Auth-Zustandsänderungen reagieren
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirectTo },
    });
    if (error) throw error;
  }

  async function signOut() {
    // Nur dieses Gerät abmelden — 'global' (Vorgabe) würde alle Sitzungen
    // beenden, auch die Verbindung von Claude (siehe ConsentPage).
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden');
  return ctx;
}
