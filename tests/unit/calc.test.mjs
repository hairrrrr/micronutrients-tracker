// Calculation and formatting (PLAN.md 1.6, phase P8).
//
// Small in-test fixtures only: no real foods.json, so the numbers stay readable
// and a data rebuild can never change these tests.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEXT_MET,
  TEXT_NO_TARGET,
  selectionGrams,
  intakeTotals,
  status,
  formatNumber,
  formatAmount,
  formatSurplus,
  cardText,
  nutrientSummary,
} from "../../docs/js/core/calc.js";

// Two foods with different nutrient coverage: `bread` has no vitD at all
// (null), `milk` has no iron value (null) and 0 vitC (a real zero).
const FOODS = {
  "fdc:1": {
    id: "fdc:1",
    nameZh: "猪肝（生）",
    per100g: { vitA: 6502, vitB12: 26, iron: 23.3, vitD: null, vitC: 0 },
  },
  "fdc:2": {
    id: "fdc:2",
    nameZh: "全脂牛奶",
    per100g: { vitA: 46, vitB12: 0.45, iron: null, vitD: 1.3, vitC: 0 },
  },
};

test("intakeTotals sums per100g * grams / 100 across two foods", () => {
  const totals = intakeTotals({ "fdc:1": { grams: 50 }, "fdc:2": { grams: 200 } }, FOODS);
  assert.equal(totals.vitA, 3251 + 92); // 6502*0.5 + 46*2
  assert.equal(Number(totals.vitB12.toFixed(4)), 13.9); // 26*0.5 + 0.45*2
  assert.equal(Number(totals.iron.toFixed(4)), 11.65); // only fdc:1 contributes
});

test("intakeTotals treats null as 0 and keeps the nutrient key at 0", () => {
  const totals = intakeTotals({ "fdc:1": { grams: 100 } }, FOODS);
  assert.equal(totals.iron, 23.3);
  assert.equal(totals.vitD, undefined); // null never becomes a 0 total
  assert.equal(totals.vitC, 0); // a real 0 value keeps its key at 0

  const milkOnly = intakeTotals({ "fdc:2": { grams: 100 } }, FOODS);
  assert.equal(milkOnly.iron, undefined);
});

test("intakeTotals ignores empty, unknown and broken selections", () => {
  assert.deepEqual(intakeTotals({}, FOODS), {});
  assert.deepEqual(intakeTotals(null, FOODS), {});
  assert.deepEqual(intakeTotals({ "fdc:1": { grams: 0 } }, FOODS), {});
  assert.deepEqual(intakeTotals({ "fdc:missing": { grams: 100 } }, FOODS), {});
  assert.deepEqual(intakeTotals({ "fdc:1": { grams: -50 } }, FOODS), {});
  assert.deepEqual(intakeTotals({ "fdc:1": null }, FOODS), {});
  // A stored selection without grams is worth 0 g here; measures.js resolves
  // count x measure grams for the UI first.
  assert.deepEqual(intakeTotals({ "fdc:1": { measureId: "piece", count: 1 } }, FOODS), {});
  assert.equal(selectionGrams({ grams: 50 }), 50);
  assert.equal(selectionGrams({ grams: "50" }), 50);
  assert.equal(selectionGrams({ grams: Number.NaN }), 0);
});

test("status: remaining is never negative, surplus is never negative", () => {
  const low = status(800, 300);
  assert.equal(low.remaining, 500);
  assert.equal(low.surplus, 0);
  assert.equal(low.met, false);

  const high = status(800, 1250);
  assert.equal(high.remaining, 0);
  assert.equal(high.surplus, 450);
  assert.equal(high.met, true);
  assert.equal(high.ratio, 1.5625);
});

test("status: met is true exactly at the target and both remainders are 0", () => {
  const exact = status(800, 800);
  assert.equal(exact.met, true);
  assert.equal(exact.remaining, 0);
  assert.equal(exact.surplus, 0);
  assert.equal(exact.ratio, 1);

  // Float noise must not create a fake surplus.
  const noisy = status(0.3, 0.1 + 0.2);
  assert.equal(noisy.met, true);
  assert.equal(noisy.surplus, 0);
});

test("status: overUL only when the UL applies to food", () => {
  // CN iron: target 12, UL 42, applies to food intake.
  assert.equal(status(12, 50, 42, true).overUL, true);
  // US folate: UL 1000 covers synthetic folic acid only -> no food warning.
  assert.equal(status(400, 1500, 1000, false).overUL, false);
  assert.equal(status(400, 1500, 1000, null).overUL, false);
  // No UL at all, or intake exactly at the UL, is not over.
  assert.equal(status(400, 1500, null, true).overUL, false);
  assert.equal(status(12, 42, 42, true).overUL, false);
  // Over the UL but still under/over target is independent of `met`.
  const underTargetOverUL = status(900, 800, 500, true);
  assert.equal(underTargetOverUL.met, false);
  assert.equal(underTargetOverUL.overUL, true);
});

test("status: a missing target never turns the card green", () => {
  for (const target of [null, undefined]) {
    const result = status(target, 9999, 100, true);
    assert.equal(result.hasTarget, false);
    assert.equal(result.met, false);
    assert.equal(result.overUL, false);
    assert.equal(result.remaining, 0);
    assert.equal(result.surplus, 0);
    assert.equal(result.target, null);
    assert.equal(cardText(result, "mg"), TEXT_NO_TARGET);
  }
});

test("formatNumber: 1234.5 -> 1235, 12.34 -> 12.3, 0.456 -> 0.46", () => {
  assert.equal(formatNumber(1234.5), "1235");
  assert.equal(formatNumber(12.34), "12.3");
  assert.equal(formatNumber(0.456), "0.46");
  // Trailing zeros are trimmed, whole hundreds keep their zeros.
  assert.equal(formatNumber(100), "100");
  assert.equal(formatNumber(1000), "1000");
  assert.equal(formatNumber(10), "10");
  assert.equal(formatNumber(0.5), "0.5");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(12), "12");
});

test("formatNumber: no minus sign for negative or broken input", () => {
  assert.equal(formatNumber(-12.34), "12.3");
  assert.equal(formatNumber(-0.456), "0.46");
  assert.equal(formatNumber(Number.NaN), "0");
  assert.equal(formatNumber(null), "0");
  // Tiny values never collapse to a misleading "0".
  assert.equal(formatNumber(0.004), "<0.01");
});

test("formatAmount appends the unit only when one is given", () => {
  assert.equal(formatAmount(12.34, "mg"), "12.3 mg");
  assert.equal(formatAmount(6502, "ug RAE"), "6502 ug RAE");
  assert.equal(formatAmount(1234.5, "ug"), "1235 ug");
  assert.equal(formatAmount(0, "mg"), "0 mg");
  assert.equal(formatAmount(12.34), "12.3");
  assert.equal(formatAmount(12.34, ""), "12.3");
});

test("formatSurplus yields a '+X unit' string", () => {
  assert.equal(formatSurplus(12.34, "mg"), "+12.3 mg");
  assert.equal(formatSurplus(1234.5, "ug"), "+1235 ug");
  assert.equal(formatSurplus(0, "mg"), "0 mg");
  assert.equal(formatSurplus(-5, "mg"), "0 mg");
});

test("cardText: still need / +surplus / reached / no reference value", () => {
  assert.equal(cardText(status(800, 300), "mg"), "还差 500 mg");
  assert.equal(cardText(status(800, 812.34), "mg"), "+12.3 mg");
  assert.equal(cardText(status(800, 800), "mg"), TEXT_MET);
  assert.equal(cardText(status(null, 300), "mg"), TEXT_NO_TARGET);
  assert.equal(cardText(null, "mg"), TEXT_NO_TARGET);
  // Exact strings the UI and the e2e smoke test rely on.
  assert.equal(TEXT_MET, "已达标");
  assert.equal(TEXT_NO_TARGET, "无参考值");
});

test("no output of any formatter or card text contains a minus sign", () => {
  const values = [];
  let seed = 123456789;
  const next = () => {
    // Deterministic LCG so a failure is reproducible without Math.random.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 500; i += 1) {
    const magnitude = 10 ** (next() * 6 - 3); // 0.001 .. 1000
    values.push(next() < 0.5 ? magnitude : -magnitude);
  }
  values.push(0, -0, -1, -99999, Number.MIN_SAFE_INTEGER, 0.0001);

  for (const value of values) {
    const outputs = [
      formatNumber(value),
      formatAmount(value, "mg"),
      formatSurplus(value, "mg"),
      cardText(status(100, value), "mg"),
      cardText(status(Math.abs(value), value), "mg"),
    ];
    for (const output of outputs) {
      assert.equal(output.includes("-"), false, `minus sign in ${JSON.stringify(output)} for ${value}`);
    }
  }

  // Sweep a range of targets to catch a sign leaking out of the card text.
  for (const target of [0.01, 0.5, 1, 12, 800, 100000]) {
    for (const intake of [0, 0.001, 0.5, 11.9, 12, 800, 999999]) {
      const text = cardText(status(target, intake, 50, true), "ug");
      assert.equal(text.includes("-"), false, `minus sign in ${text} (${target}/${intake})`);
    }
  }
});

test("nutrientSummary combines status and card text", () => {
  const met = nutrientSummary({ target: 100, ul: 500, ulAppliesToFood: true }, 120, "mg");
  assert.equal(met.text, "+20 mg");
  assert.equal(met.status.met, true);
  assert.equal(met.status.overUL, false);

  const missing = nutrientSummary(null, 500, "mg");
  assert.equal(missing.text, TEXT_NO_TARGET);
  assert.equal(missing.status.hasTarget, false);
});
