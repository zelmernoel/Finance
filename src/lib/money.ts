// ── Geldbeträge und Steuer ────────────────────────────────────────────────────
//
// Alles, was Beträge parst oder in Brutto/Netto/Steuer zerlegt, steht hier —
// vorher stand die Komma-zu-Punkt-Logik an fünf Stellen leicht unterschiedlich.
//
// Rechenregel: Brutto ist die gespeicherte Wahrheit (transactions.amount),
// die Steuer steckt darin. Netto wird nie gespeichert, sondern abgeleitet.
//
//   Netto  = Brutto / (1 + Satz/100)       1.499,40 / 1,19 = 1.260,00
//   Steuer = Brutto − Netto                1.499,40 − 1.260,00 = 239,40
//
// Nicht "19 % vom Brutto": das wäre Steuer auf die Steuer (284,89 statt 239,40).

/** Übliche Umsatzsteuersätze in Deutschland. Andere Sätze gehen über das Netto-Feld. */
export const TAX_RATES = [19, 7] as const;

/** Auf zwei Nachkommastellen runden, ohne Gleitkomma-Artefakte (1.005 → 1.01). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Nutzereingabe → Betrag. Akzeptiert "12,50", "12.50", "1.234,56" und " 12 ".
 * Gibt null zurück, wenn daraus keine Zahl wird — der Aufrufer entscheidet,
 * ob das ein Fehler oder ein leeres Feld ist.
 */
export function parseAmount(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  // "1.234,56" → Tausenderpunkte raus, Komma zu Punkt. "12.50" bleibt 12.50.
  const normalized = /,\d{1,2}$/.test(s)
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Betrag für ein Eingabefeld: Punkt → Komma, leer bei 0/undefined. */
export function amountToInput(n: number | undefined | null): string {
  if (n == null || n === 0) return '';
  return String(n).replace('.', ',');
}

export function netFromGross(gross: number, ratePercent: number): number {
  return round2(gross / (1 + ratePercent / 100));
}

export function taxFromGross(gross: number, ratePercent: number): number {
  return round2(gross - netFromGross(gross, ratePercent));
}

/** Effektiver Steuersatz aus Brutto und Netto, z. B. zur Anzeige ("19 %"). */
export function rateFromAmounts(gross: number, net: number): number | null {
  if (net <= 0 || gross < net) return null;
  return round2((gross / net - 1) * 100);
}

/**
 * Prüft die Zerlegung, wie sie auch der DB-Check verlangt: 0 ≤ Steuer ≤ Brutto.
 * Gleichheit ist erlaubt und gemeint: eine Zahlung ans Finanzamt (oder eine
 * Erstattung) besteht zu 100 % aus Steuer und bucht den Steuertopf leer.
 */
export function isValidTaxSplit(gross: number, tax: number): boolean {
  return gross > 0 && tax >= 0 && tax <= gross;
}
