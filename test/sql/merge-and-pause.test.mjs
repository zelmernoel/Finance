// Verhaltenstests für supabase/merge-and-pause.sql: Töpfe pausieren und
// Bereiche zusammenführen. Ausführen: npm run test:sql
import { setup } from './setup.mjs';
import assert from 'node:assert/strict';
const U = '11111111-1111-1111-1111-111111111111', X = '22222222-2222-2222-2222-222222222222';
const A = 'aaaaaaaa-0000-0000-0000-00000000000a', B = 'bbbbbbbb-0000-0000-0000-00000000000b';
let n = 0; const id = () => `00000000-0000-0000-0000-${String(++n).padStart(12,'0')}`;

async function fresh() {
  const db = await setup(['merge-and-pause.sql']);
  await db.exec(`INSERT INTO auth.users VALUES ('${U}'),('${X}');
    INSERT INTO budgets (id,user_id,name,type,starting_balance) VALUES ('${A}','${U}','Privat','personal',10),('${B}','${U}','Firma','business',5);
    INSERT INTO settings (user_id,budget_id,starting_balance) VALUES ('${U}','${A}',100),('${U}','${B}',50);
    INSERT INTO categories (id,user_id,budget_id,name,type) VALUES ('c1','${U}','${A}','Gehalt','income'),('c2','${U}','${B}','Gehalt','income'),('c3','${U}','${B}','Software','expense');
    UPDATE categories SET default_tax_rate=19 WHERE id='c2';`);
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${U}',false);`);
  return db;
}
const q = async (db, s) => (await db.query(s)).rows;
const pot = async (db, name) => (await q(db, `select * from savings_pots where name='${name}'`))[0];
const tx = (db, b, type, amount, tax = 0) => { const i = id(); return db.exec(`INSERT INTO transactions (id,user_id,budget_id,date,type,amount,tax_amount) VALUES ('${i}','${U}','${b}','2026-10-01','${type}',${amount},${tax})`).then(() => i); };

// ── 1. Pausieren ──
{
  const db = await fresh();
  await db.exec(`INSERT INTO savings_pots (user_id,budget_id,name,allocation_percent) VALUES ('${U}','${A}','Urlaub',50),('${U}','${A}','Notgroschen',50)`);
  const t1 = await tx(db, A, 'income', 100);
  assert.equal(Number((await pot(db,'Urlaub')).current_amount), 50);
  await db.exec(`UPDATE savings_pots SET is_active=false WHERE name='Urlaub'`);
  await tx(db, A, 'income', 200);
  assert.equal(Number((await pot(db,'Urlaub')).current_amount), 50, 'pausierter Topf bekommt nichts Neues');
  assert.equal(Number((await pot(db,'Notgroschen')).current_amount), 150);
  await db.exec(`UPDATE transactions SET amount=300 WHERE id='${t1}'`);
  assert.equal(Number((await pot(db,'Urlaub')).current_amount), 50, 'Bestand bleibt bei Korrektur alter Buchung');
  assert.equal(Number((await pot(db,'Notgroschen')).current_amount), 250);
  // 100 %: pausierter zählt nicht → neuer 50%-Topf erlaubt; Reaktivierung dann verboten
  await db.exec(`INSERT INTO savings_pots (user_id,budget_id,name,allocation_percent) VALUES ('${U}','${A}','Auto',50)`);
  await assert.rejects(db.exec(`UPDATE savings_pots SET is_active=true WHERE name='Urlaub'`), /100/);
  // Steuertopf pausieren
  const t2 = await tx(db, B, 'income', 119, 19);
  assert.equal(Number((await pot(db,'Umsatzsteuer')).current_amount), 19);
  await db.exec(`UPDATE savings_pots SET is_active=false WHERE kind='tax'`);
  await tx(db, B, 'income', 238, 38);
  assert.equal(Number((await pot(db,'Umsatzsteuer')).current_amount), 19, 'pausierter Steuertopf bucht nichts');
  assert.equal((await q(db,`select count(*)::int c from savings_pots where kind='tax'`))[0].c, 1, 'kein zweiter Steuertopf');
  await db.exec(`UPDATE transactions SET tax_amount=0 WHERE id='${t2}'`);
  assert.equal(Number((await pot(db,'Umsatzsteuer')).current_amount), 19, 'eingefroren');
  console.log('ok 1 pausieren');
}

// ── 2. Zusammenführen zu Firma ──
{
  const db = await fresh();
  await db.exec(`INSERT INTO savings_pots (user_id,budget_id,name,allocation_percent) VALUES ('${U}','${A}','Urlaub',60),('${U}','${B}','Rücklage',60)`);
  await tx(db, A, 'income', 100);          // Urlaub 60
  await tx(db, B, 'income', 119, 19);      // Rücklage 60, Steuer B 19
  await db.exec(`SET ROLE postgres; INSERT INTO savings_pots (user_id,budget_id,name,allocation_percent,kind,is_active) VALUES ('${U}','${A}','Umsatzsteuer',0,'tax',false); SET ROLE authenticated;`);
  await tx(db, A, 'expense', 50, 0);
  const balBefore = (await q(db, `select (select sum(starting_balance) from settings) + sum(case when type='income' then amount else -amount end) b from transactions`))[0].b;
  const r = (await q(db, `select merge_budgets('${A}','${B}','Alles','business') r`))[0].r;
  assert.equal(r.transactions_moved, 2); assert.equal(r.pots_paused, 1);
  assert.equal((await q(db,`select count(*)::int c from budgets`))[0].c, 1);
  const b = (await q(db,`select * from budgets`))[0];
  assert.equal(b.name, 'Alles'); assert.equal(b.type, 'business'); assert.equal(Number(b.starting_balance), 15);
  assert.equal(Number((await q(db,`select starting_balance from settings`))[0].starting_balance), 150);
  const balAfter = (await q(db, `select (select sum(starting_balance) from settings) + sum(case when type='income' then amount else -amount end) b from transactions`))[0].b;
  assert.equal(Number(balAfter), Number(balBefore));
  assert.equal(Number((await pot(db,'Urlaub')).current_amount), 60, 'Bestand bleibt');
  assert.equal((await pot(db,'Urlaub')).is_active, false, 'Quell-Topf pausiert wegen >100 %');
  assert.equal(Number((await pot(db,'Rücklage')).current_amount), 60);
  const tax = await q(db,`select * from savings_pots where kind='tax'`);
  assert.equal(tax.length, 1); assert.equal(Number(tax[0].current_amount), 19); assert.equal(tax[0].is_active, true);
  assert.equal((await q(db,`select count(*)::int c from categories`))[0].c, 2, 'doppelte Kategorie zusammengelegt');
  await tx(db, B, 'income', 100);
  assert.equal(Number((await pot(db,'Rücklage')).current_amount), 120, 'Töpfe laufen weiter');
  assert.equal(Number((await pot(db,'Urlaub')).current_amount), 60);
  console.log('ok 2 firma');
}

// ── 3. Zusammenführen zu Privat ──
{
  const db = await fresh();
  await db.exec(`INSERT INTO savings_pots (user_id,budget_id,name,allocation_percent) VALUES ('${U}','${B}','Rücklage',30)`);
  await tx(db, B, 'income', 119, 19);
  const r = (await q(db, `select merge_budgets('${B}','${A}','Privat gesamt','personal') r`))[0].r;
  assert.equal(r.pots_removed, 2);
  assert.equal((await q(db,`select count(*)::int c from savings_pots`))[0].c, 0);
  assert.equal((await q(db,`select count(*)::int c from transactions where tax_amount<>0`))[0].c, 0);
  assert.equal((await q(db,`select count(*)::int c from categories where default_tax_rate is not null`))[0].c, 0);
  await tx(db, A, 'income', 119, 0);
  assert.equal((await q(db,`select count(*)::int c from savings_pots`))[0].c, 0);
  console.log('ok 3 privat');
}

// ── 4. Fremder Nutzer / Fehlerfälle ──
{
  const db = await fresh();
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${X}',false)`);
  await assert.rejects(db.query(`select merge_budgets('${A}','${B}','x','business')`), /nicht gefunden/);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${U}',false)`);
  await assert.rejects(db.query(`select merge_budgets('${A}','${A}','x','business')`), /verschiedene/);
  await assert.rejects(db.query(`select merge_budgets('${A}','${B}','  ','business')`), /Namen/);
  assert.equal((await q(db,`select count(*)::int c from budgets`))[0].c, 2);
  // Idempotenz: Migration zweimal
  await db.exec(`SET ROLE postgres`); await db.exec((await import('node:fs')).readFileSync(new URL('../../supabase/merge-and-pause.sql', import.meta.url),'utf8'));
  console.log('ok 4 sicherheit + idempotent');
}
