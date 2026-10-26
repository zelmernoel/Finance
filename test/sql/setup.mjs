// Lädt das komplette Supabase-Schema in PGlite (Postgres als WebAssembly),
// damit Trigger und RPCs ohne laufende Datenbank testbar sind. auth.users,
// auth.uid() und die Supabase-Rollen werden minimal nachgebildet.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const R = new URL('../../supabase/', import.meta.url).pathname;
export async function setup(extra = []) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
  `);
  for (const f of ['schema.sql','savings-pots.sql','onboarding.sql','settings-month-start.sql','mcp-schema.sql','tax.sql', ...extra]) {
    try { await db.exec(readFileSync(R + f, 'utf8')); }
    catch (e) { console.log('FEHLER in', f, ':', e.message); throw e; }
  }
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
  return db;
}
