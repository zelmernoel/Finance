import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2, parseAmount, amountToInput, netFromGross, taxFromGross,
  rateFromAmounts, isValidTaxSplit,
} from './money';

test('netFromGross: 1.499,40 brutto bei 19 % sind 1.260,00 netto', () => {
  assert.equal(netFromGross(1499.40, 19), 1260);
});

test('taxFromGross: Steuer ist Brutto minus Netto, nicht 19 % vom Brutto', () => {
  assert.equal(taxFromGross(1499.40, 19), 239.40);
  assert.notEqual(taxFromGross(1499.40, 19), round2(1499.40 * 0.19)); // 284,89 wäre falsch
});

test('taxFromGross: 7 % und 0 %', () => {
  assert.equal(taxFromGross(107, 7), 7);
  assert.equal(taxFromGross(50, 0), 0);
});

test('Zerlegung bleibt konsistent: netto + steuer = brutto', () => {
  for (const gross of [0.01, 1, 19.99, 100, 1499.40, 123456.78]) {
    for (const rate of [19, 7]) {
      const net = netFromGross(gross, rate);
      const tax = taxFromGross(gross, rate);
      assert.equal(round2(net + tax), gross, `${gross} @ ${rate}%`);
    }
  }
});

test('round2 rundet kaufmännisch ohne Gleitkomma-Artefakte', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(239.4), 239.4);
});

test('parseAmount versteht deutsche und englische Schreibweise', () => {
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount(' 12 '), 12);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('12,'), 12);
});

test('amountToInput zeigt Komma und lässt 0 leer', () => {
  assert.equal(amountToInput(12.5), '12,5');
  assert.equal(amountToInput(0), '');
  assert.equal(amountToInput(undefined), '');
});

test('rateFromAmounts rechnet den Satz zurück', () => {
  assert.equal(rateFromAmounts(1499.40, 1260), 19);
  assert.equal(rateFromAmounts(107, 100), 7);
  assert.equal(rateFromAmounts(100, 0), null);
  assert.equal(rateFromAmounts(90, 100), null);
});

test('isValidTaxSplit entspricht dem DB-Check (0 ≤ Steuer < Brutto)', () => {
  assert.equal(isValidTaxSplit(100, 0), true);
  assert.equal(isValidTaxSplit(100, 15.97), true);
  assert.equal(isValidTaxSplit(100, 100), false);
  assert.equal(isValidTaxSplit(100, -1), false);
  assert.equal(isValidTaxSplit(0, 0), false);
});
