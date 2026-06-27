import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase-Konfiguration fehlt. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY ' +
    'als Umgebungsvariablen setzen (lokal: .env.local, Netlify: Site settings → Environment variables).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const authRedirectTo = `${window.location.origin}/auth/callback`;
