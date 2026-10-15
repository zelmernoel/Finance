import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportCSV, splitCsvLine } from './utils.ts';

test('splitCsvLine: Semikolon-Trenner, Anführungszeichen, "" als Escape', () => {
  assert.deepEqual(splitCsvLine('15.10.2026;Ausgabe;12,50;Technik;"Abo; monatlich";"Sagt ""Hallo"""'),
    ['15.10.2026', 'Ausgabe', '12,50', 'Technik', 'Abo; monatlich', 'Sagt "Hallo"']);
  assert.deepEqual(splitCsvLine('a;;c'), ['a', '', 'c']);
});

test('parseImportCSV liest den eigenen Export mit Komma-Beträgen und Steuer', () => {
  const csv = [
    'Datum;Typ;Betrag;Kategorie;Beschreibung;Notiz;Steuer',
    '11.09.2026;Einnahme;1499,40;"Anzahlung";"ANZ-001";"Michael Bittner";239,40',
    '2026-10-01;Ausgabe;107,10;Technik;"Claude Max Abo";;',
  ].join('\n');
  const { valid, errors } = parseImportCSV(csv);
  assert.deepEqual(errors, []);
  assert.equal(valid.length, 2);
  assert.equal(valid[0].amount, 1499.4);
  assert.equal(valid[0].taxAmount, 239.4);
  assert.equal(valid[0].category, 'Anzahlung');
  assert.equal(valid[0].description, 'ANZ-001');
  assert.equal(valid[0].date, '2026-09-11');
  assert.equal(valid[1].taxAmount, 0);
  assert.equal(valid[1].type, 'expense');
});

test('parseImportCSV meldet ungültige Steuer und Beträge', () => {
  const { valid, errors } = parseImportCSV('Datum;Typ;Betrag;Kategorie;Beschreibung;Notiz;Steuer\n01.01.2026;Ausgabe;10,00;A;B;;11,00\n01.01.2026;Ausgabe;abc;A;B');
  assert.equal(valid.length, 0);
  assert.equal(errors.length, 2);
});
