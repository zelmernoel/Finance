import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, addMonths, addYears, getMonthRange, todayISO } from './utils.ts';
import { calcNextDue } from './hooks/useRecurringTransactions.ts';

// ── Warum es diese Tests gibt ─────────────────────────────────────────────────
//
// Diese Arithmetik entscheidet, wann ein Dauerauftrag das nächste Mal bucht.
// Bleibt ein nextDue stehen, bucht die App bei JEDEM Start erneut — auf echten
// Finanzdaten. Die Fälle unten sind alle schon einmal falsch gewesen:
//
//   addDays('2026-03-29', +1)   ergab 2026-03-29 (Sommerzeitbeginn)
//   addMonths('2026-03-15', +1) ergab 2026-04-14 (Sommerzeitbeginn)
//   addMonths('2026-01-31', +1) ergab 2026-03-03 (JS-Monatsüberlauf)
//
// Ausgeführt mit:  npm test
//
// Läuft ohne Test-Framework über den Node-eigenen Runner.

// ── Unabhängige Referenz ──────────────────────────────────────────────────────
// Bewusst OHNE Date implementiert (Algorithmus nach Howard Hinnant). Eine
// Referenz, die selbst Date benutzt, würde dieselben Fehler teilen und könnte
// sie deshalb nicht finden.

function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): [number, number, number] {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number) =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = ([y, m, d]: [number, number, number]) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (iso: string): [number, number, number] =>
  iso.split('-').map(Number) as [number, number, number];

/** Referenz: n Tage addieren. */
function refAddDays(iso: string, n: number): string {
  const [y, m, d] = parse(iso);
  return fmt(civilFromDays(daysFromCivil(y, m, d) + n));
}

/** Referenz: n Monate addieren, Tag auf das Monatsende klemmen. */
function refAddMonths(iso: string, n: number): string {
  const [y, m, d] = parse(iso);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return fmt([ty, tm, Math.min(d, daysInMonth(ty, tm))]);
}

// ── Zeitzonen ─────────────────────────────────────────────────────────────────
// Kalenderdaten dürfen von der Zeitzone nicht abhängen. Geprüft wird über
// Zonen östlich und westlich von Greenwich sowie mit halbstündigem Versatz.

const ZONES = [
  'UTC',
  'Europe/Berlin',      // UTC+1/+2, Umstellung nachts um 02:00
  'America/New_York',   // UTC-5/-4
  'Asia/Kolkata',       // UTC+5:30, keine Sommerzeit
  'Pacific/Auckland',   // UTC+12/+13, Umstellung gegenläufig zur Nordhalbkugel
  'America/Santiago',   // Umstellung historisch um Mitternacht
];

function inZone<T>(tz: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/** Führt die Zusicherung in jeder Zone aus. */
function inAllZones(fn: (tz: string) => void) {
  for (const tz of ZONES) inZone(tz, () => fn(tz));
}

// ── 1. Sommerzeit-Umstellung ──────────────────────────────────────────────────

test('addDays über den Sommerzeitbeginn (29.03.2026, DE)', () => {
  inAllZones((tz) => {
    assert.equal(addDays('2026-03-28', 1), '2026-03-29', tz);
    assert.equal(addDays('2026-03-29', 1), '2026-03-30', tz); // war: 2026-03-29
    assert.equal(addDays('2026-03-30', 1), '2026-03-31', tz);
    assert.equal(addDays('2026-03-29', -1), '2026-03-28', tz);
    assert.equal(addDays('2026-03-30', -1), '2026-03-29', tz);
  });
});

test('addDays über das Sommerzeitende (25.10.2026, DE)', () => {
  inAllZones((tz) => {
    assert.equal(addDays('2026-10-24', 1), '2026-10-25', tz);
    assert.equal(addDays('2026-10-25', 1), '2026-10-26', tz);
    assert.equal(addDays('2026-10-26', 1), '2026-10-27', tz);
    assert.equal(addDays('2026-10-25', -1), '2026-10-24', tz);
    assert.equal(addDays('2026-10-26', -1), '2026-10-25', tz);
  });
});

test('addMonths über den Sommerzeitbeginn', () => {
  inAllZones((tz) => {
    assert.equal(addMonths('2026-03-15', 1), '2026-04-15', tz); // war: 2026-04-14
    assert.equal(addMonths('2026-02-28', 1), '2026-03-28', tz);
    assert.equal(addMonths('2026-03-29', 1), '2026-04-29', tz);
  });
});

// ── 2. Monatsüberlauf klemmen ─────────────────────────────────────────────────

test('addMonths klemmt auf das Monatsende statt überzulaufen', () => {
  inAllZones((tz) => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28', tz); // war: 2026-03-03
    assert.equal(addMonths('2026-01-30', 1), '2026-02-28', tz);
    assert.equal(addMonths('2026-01-29', 1), '2026-02-28', tz);
    assert.equal(addMonths('2026-03-31', 1), '2026-04-30', tz);
    assert.equal(addMonths('2026-05-31', 1), '2026-06-30', tz);
    assert.equal(addMonths('2026-08-31', 1), '2026-09-30', tz);
    assert.equal(addMonths('2026-10-31', 1), '2026-11-30', tz);
  });
});

test('addMonths über alle 12 Monate für Starttage 28–31', () => {
  inAllZones((tz) => {
    for (const day of [28, 29, 30, 31]) {
      for (let m = 1; m <= 12; m++) {
        if (day > daysInMonth(2026, m)) continue; // Startdatum muss es geben
        const iso = `2026-${pad(m)}-${pad(day)}`;
        assert.equal(addMonths(iso, 1), refAddMonths(iso, 1), `${tz} ${iso} +1M`);
      }
    }
  });
});

// ── 3. Schaltjahr ─────────────────────────────────────────────────────────────

test('Schaltjahr: 2028-01-29 +1 Monat ergibt 2028-02-29', () => {
  inAllZones((tz) => {
    assert.equal(addMonths('2028-01-29', 1), '2028-02-29', tz);
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29', tz);
  });
});

test('Kein Schaltjahr: 2026-01-29 +1 Monat ergibt 2026-02-28', () => {
  inAllZones((tz) => {
    assert.equal(addMonths('2026-01-29', 1), '2026-02-28', tz);
  });
});

test('Schalttag +1 Jahr klemmt auf den 28.', () => {
  inAllZones((tz) => {
    assert.equal(addYears('2028-02-29', 1), '2029-02-28', tz);
    assert.equal(addYears('2028-02-29', 4), '2032-02-29', tz);
  });
});

test('Jahrhundertregel: 2100 ist kein Schaltjahr', () => {
  inAllZones((tz) => {
    assert.equal(addMonths('2100-01-31', 1), '2100-02-28', tz);
    assert.equal(addMonths('2000-01-31', 1), '2000-02-29', tz);
  });
});

// ── 4. Jahreswechsel ──────────────────────────────────────────────────────────

test('Jahreswechsel', () => {
  inAllZones((tz) => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01', tz);
    assert.equal(addMonths('2026-12-31', 1), '2027-01-31', tz);
    assert.equal(addDays('2027-01-01', -1), '2026-12-31', tz);
    assert.equal(addMonths('2026-12-15', 1), '2027-01-15', tz);
    assert.equal(addYears('2026-12-31', 1), '2027-12-31', tz);
  });
});

// ── 5. Idempotenz: kein Tag darf stehenbleiben ────────────────────────────────

test('addDays(+1) bewegt sich an JEDEM Tag eines vollen Jahres', () => {
  inAllZones((tz) => {
    let iso = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      const next = addDays(iso, 1);
      assert.notEqual(next, iso, `${tz}: ${iso} blieb stehen`);
      assert.equal(next, refAddDays(iso, 1), `${tz}: ${iso} +1d`);
      assert.ok(next > iso, `${tz}: ${iso} → ${next} lief rückwärts`);
      iso = next;
    }
    assert.equal(iso, '2027-01-01', `${tz}: 365 Schritte ab 2026-01-01`);
  });
});

test('addDays(+1) bewegt sich auch im Schaltjahr an jedem Tag', () => {
  inAllZones((tz) => {
    let iso = '2028-01-01';
    for (let i = 0; i < 366; i++) {
      const next = addDays(iso, 1);
      assert.notEqual(next, iso, `${tz}: ${iso} blieb stehen`);
      iso = next;
    }
    assert.equal(iso, '2029-01-01', `${tz}: 366 Schritte ab 2028-01-01`);
  });
});

test('addMonths(+1) bewegt sich an jedem Tag von drei Jahren', () => {
  inAllZones((tz) => {
    for (let y = 2026; y <= 2028; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= daysInMonth(y, m); d++) {
          const iso = `${y}-${pad(m)}-${pad(d)}`;
          const next = addMonths(iso, 1);
          assert.notEqual(next, iso, `${tz}: ${iso} blieb stehen`);
          assert.ok(next > iso, `${tz}: ${iso} → ${next} lief rückwärts`);
        }
      }
    }
  });
});

// ── 6. Abgleich gegen die unabhängige Referenz ────────────────────────────────

test('addDays deckt sich über 4 Jahre mit der Referenz', () => {
  inAllZones((tz) => {
    for (let z = daysFromCivil(2026, 1, 1); z < daysFromCivil(2030, 1, 1); z++) {
      const iso = fmt(civilFromDays(z));
      for (const n of [1, 7, -1, -7]) {
        assert.equal(addDays(iso, n), refAddDays(iso, n), `${tz}: ${iso} ${n >= 0 ? '+' : ''}${n}d`);
      }
    }
  });
});

test('addMonths und addYears decken sich mit der Referenz', () => {
  inAllZones((tz) => {
    for (let y = 2024; y <= 2030; y++) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 15, 28, daysInMonth(y, m)]) {
          const iso = `${y}-${pad(m)}-${pad(d)}`;
          assert.equal(addMonths(iso, 1), refAddMonths(iso, 1), `${tz}: ${iso} +1M`);
          assert.equal(addMonths(iso, -1), refAddMonths(iso, -1), `${tz}: ${iso} -1M`);
          assert.equal(addYears(iso, 1), refAddMonths(iso, 12), `${tz}: ${iso} +1J`);
        }
      }
    }
  });
});

// ── 7. calcNextDue reicht korrekt durch ───────────────────────────────────────

test('calcNextDue bildet die vier Frequenzen ab', () => {
  inAllZones((tz) => {
    assert.equal(calcNextDue('2026-03-29', 'daily'), '2026-03-30', tz);
    assert.equal(calcNextDue('2026-03-29', 'weekly'), '2026-04-05', tz);
    assert.equal(calcNextDue('2026-01-31', 'monthly'), '2026-02-28', tz);
    assert.equal(calcNextDue('2028-02-29', 'yearly'), '2029-02-28', tz);
  });
});

test('calcNextDue bleibt an keinem Tag eines Jahres stehen', () => {
  inAllZones((tz) => {
    let iso = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      for (const f of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
        assert.ok(calcNextDue(iso, f) > iso, `${tz}: ${iso} ${f} rückte nicht vor`);
      }
      iso = addDays(iso, 1);
    }
  });
});

// ── 8. getMonthRange darf sich nicht verändern ────────────────────────────────
// Absicherung gegen Kollateralschaden: die Werte stammen aus dem Abgleich mit
// supabase/functions/mcp/index.ts und müssen so bleiben.

test('getMonthRange liefert unveränderte Werte', () => {
  inAllZones((tz) => {
    assert.deepEqual(getMonthRange(2026, 1, 1), { from: '2026-01-01', to: '2026-01-31' }, tz);
    assert.deepEqual(getMonthRange(2026, 2, 1), { from: '2026-02-01', to: '2026-02-28' }, tz);
    assert.deepEqual(getMonthRange(2028, 2, 1), { from: '2028-02-01', to: '2028-02-29' }, tz);
    assert.deepEqual(getMonthRange(2026, 1, 15), { from: '2026-01-15', to: '2026-02-14' }, tz);
    assert.deepEqual(getMonthRange(2026, 12, 15), { from: '2026-12-15', to: '2027-01-14' }, tz);
    assert.deepEqual(getMonthRange(2026, 3, 15), { from: '2026-03-15', to: '2026-04-14' }, tz);
    assert.deepEqual(getMonthRange(2026, 10, 15), { from: '2026-10-15', to: '2026-11-14' }, tz);
  });
});

// ── 9. todayISO(): "heute" ist ein lokaler Begriff ────────────────────────────
//
// Vorher stand an neun Stellen `new Date().toISOString().slice(0, 10)`. Das
// liefert den UTC-Tag und liegt damit systematisch daneben:
//
//   östlich von Greenwich  kurz nach Mitternacht noch der VORTAG
//   westlich von Greenwich am späten Abend schon der FOLGETAG
//
// Die Tests fixieren "jetzt" auf einen Zeitpunkt, an dem lokaler und
// UTC-Kalendertag auseinanderfallen. Genau dort muss todayISO() den lokalen
// Tag liefern — und genau dort schlug die alte Fassung fehl.

/** Führt fn so aus, als wäre jetzt genau `fixed`. */
function withFixedNow<T>(fixed: Date, fn: () => T): T {
  const Real = globalThis.Date;
  class Fixed extends Real {
    // unknown[] statt ConstructorParameters<DateConstructor>: letzteres löst auf
    // die einargumentige Überladung auf, dann hält TS `args.length === 0` für
    // unmöglich. Hier sind aber gerade beide Fälle gemeint.
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed.getTime());
      else super(...(args as [number]));
    }
    static override now(): number {
      return fixed.getTime();
    }
  }
  globalThis.Date = Fixed as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = Real;
  }
}

/** Der Kalendertag in UTC — die alte, fehlerhafte Bestimmung von "heute". */
const alteFassung = () => new Date().toISOString().slice(0, 10);

/** Fixiert einen Zeitpunkt, der in `tz` die angegebene Ortszeit hat. */
function anOrtszeit<T>(
  tz: string, y: number, mo: number, d: number, h: number, min: number,
  fn: (kontext: { utcTag: string }) => T,
): T {
  return inZone(tz, () => {
    const fixed = new Date(y, mo - 1, d, h, min, 0);
    return withFixedNow(fixed, () => fn({ utcTag: alteFassung() }));
  });
}

test('todayISO liefert kurz nach lokaler Mitternacht den lokalen Tag', () => {
  for (const tz of ZONES) {
    // Sommer (Nordhalbkugel) und Winter, damit beide Sommerzeit-Lagen vorkommen
    for (const [y, mo, d] of [[2026, 6, 15], [2026, 1, 15]] as const) {
      const soll = `${y}-${pad(mo)}-${pad(d)}`;
      anOrtszeit(tz, y, mo, d, 0, 30, () => {
        assert.equal(todayISO(), soll, `${tz} um 00:30 Ortszeit am ${soll}`);
      });
    }
  }
});

test('todayISO liefert kurz vor lokaler Mitternacht noch den laufenden Tag', () => {
  for (const tz of ZONES) {
    for (const [y, mo, d] of [[2026, 6, 14], [2026, 1, 14]] as const) {
      const soll = `${y}-${pad(mo)}-${pad(d)}`;
      anOrtszeit(tz, y, mo, d, 23, 30, () => {
        assert.equal(todayISO(), soll, `${tz} um 23:30 Ortszeit am ${soll}`);
      });
    }
  }
});

test('todayISO stimmt zur Tagesmitte in jeder Zone', () => {
  for (const tz of ZONES) {
    anOrtszeit(tz, 2026, 6, 15, 12, 0, () => {
      assert.equal(todayISO(), '2026-06-15', `${tz} um 12:00 Ortszeit`);
    });
  }
});

test('todayISO über ein volles Jahr: jeder Tag zur Mitternachtsstunde korrekt', () => {
  for (const tz of ['Europe/Berlin', 'America/New_York', 'Pacific/Auckland']) {
    let iso = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      const [y, mo, d] = iso.split('-').map(Number);
      anOrtszeit(tz, y, mo, d, 0, 15, () => {
        assert.equal(todayISO(), iso, `${tz} am ${iso} um 00:15`);
      });
      iso = addDays(iso, 1);
    }
  }
});

test('die alte UTC-Fassung weicht nachweislich ab — der Test hat Zähne', () => {
  const abweichungen: string[] = [];
  for (const tz of ZONES) {
    // 00:30 Ortszeit: östlich von Greenwich ist UTC noch am Vortag
    anOrtszeit(tz, 2026, 6, 15, 0, 30, ({ utcTag }) => {
      if (utcTag !== '2026-06-15') abweichungen.push(`${tz} 00:30 → alt ${utcTag}`);
    });
    // 23:30 Ortszeit: westlich von Greenwich ist UTC schon am Folgetag
    anOrtszeit(tz, 2026, 6, 14, 23, 30, ({ utcTag }) => {
      if (utcTag !== '2026-06-14') abweichungen.push(`${tz} 23:30 → alt ${utcTag}`);
    });
  }
  assert.ok(
    abweichungen.length > 0,
    'Die alte Fassung wich nirgends ab — dann prüfen diese Tests nichts.',
  );
  // Nachweis in beide Richtungen: Vortag UND Folgetag müssen vorkommen.
  assert.ok(abweichungen.some(a => a.includes('00:30')), 'kein Vortag-Fall gefunden');
  assert.ok(abweichungen.some(a => a.includes('23:30')), 'kein Folgetag-Fall gefunden');
});
