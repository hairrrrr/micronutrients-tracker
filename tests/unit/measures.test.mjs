// Household measure -> grams conversion (PLAN.md 1.3/1.5/1.8, phase P8).
//
// Fixture shaped like foods.json, with a missing measure and a food without
// measures to cover the fallbacks.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GRAMS_MEASURE_ID,
  COUNT_STEP,
  roundGrams,
  clampCount,
  measuresOf,
  findMeasure,
  defaultMeasure,
  measureGrams,
  measureOptions,
  gramsFromMeasure,
  gramsForSelection,
  normalizeSelection,
  formatGrams,
  stepCount,
} from "../../docs/js/core/measures.js";

const EGG = {
  id: "fdc:egg",
  measures: [
    { id: "piece", labelZh: "一个", grams: 50, basis: "estimate:one egg", default: true },
    { id: "cup", labelZh: "一杯", grams: 243, basis: "usda_portion:1", default: false },
  ],
};

const OIL = {
  id: "fdc:oil",
  measures: [
    { id: "spoon", labelZh: "一勺", grams: 13.5, basis: "estimate:one spoon", default: true },
  ],
};

const NO_MEASURES = { id: "fdc:bare", measures: [] };

test("count x measure grams (half an egg is 25 g, 2 eggs 100 g)", () => {
  assert.equal(gramsFromMeasure(EGG, "piece", 1), 50);
  assert.equal(gramsFromMeasure(EGG, "piece", 0.5), 25);
  assert.equal(gramsFromMeasure(EGG, "piece", 2), 100);
  assert.equal(gramsFromMeasure(EGG, "cup", 1), 243);
  assert.equal(gramsFromMeasure(EGG, "cup", 1.5), 364.5);
  assert.equal(gramsFromMeasure(OIL, "spoon", 2), 27);
});

test("count or gram weight of 0 / negative gives 0 grams", () => {
  assert.equal(gramsFromMeasure(EGG, "piece", 0), 0);
  assert.equal(gramsFromMeasure(EGG, "piece", -1), 0);
  assert.equal(gramsFromMeasure(EGG, "piece", Number.NaN), 0);
  assert.equal(gramsFromMeasure(EGG, "nope", 1), 0);
  assert.equal(gramsFromMeasure(NO_MEASURES, "piece", 1), 0);
  assert.equal(gramsFromMeasure(null, "piece", 1), 0);
  assert.equal(roundGrams(-5), 0);
  assert.equal(roundGrams(Number.NaN), 0);
  assert.equal(clampCount(-2), 0);
});

test("unknown measure and the manual grams id have no gram weight", () => {
  assert.equal(findMeasure(EGG, "nope"), null);
  assert.equal(findMeasure(EGG, GRAMS_MEASURE_ID), null);
  assert.equal(findMeasure(EGG, null), null);
  assert.equal(measureGrams(EGG, "nope"), 0);
  assert.equal(measureGrams(EGG, "piece"), 50);
  // Rows with a non-positive gram weight are unusable and never offered.
  const broken = { measures: [{ id: "x", labelZh: "坏", grams: 0 }, { id: "y", labelZh: "好", grams: 30 }] };
  assert.deepEqual(measuresOf(broken).map((m) => m.id), ["y"]);
});

test("defaultMeasure picks the flagged row, else the first one", () => {
  assert.equal(defaultMeasure(EGG).id, "piece");
  const unflagged = { measures: [{ id: "a", labelZh: "甲", grams: 10 }, { id: "b", labelZh: "乙", grams: 20 }] };
  assert.equal(defaultMeasure(unflagged).id, "a");
  assert.equal(defaultMeasure(NO_MEASURES), null);
  assert.equal(defaultMeasure(null), null);
});

test("measureOptions lists the measures plus the manual grams entry", () => {
  const options = measureOptions(OIL);
  assert.deepEqual(options.map((option) => option.id), ["spoon", GRAMS_MEASURE_ID]);
  assert.equal(options[0].labelZh, "一勺");
  assert.equal(options[0].grams, 13.5);
  // The manual option has no gram weight of its own.
  assert.equal(options[1].grams, null);
  assert.equal(measureOptions(NO_MEASURES).length, 1);
  assert.equal(measureOptions(NO_MEASURES)[0].id, GRAMS_MEASURE_ID);
});

test("manual grams override the measure, and an explicit 0 is respected", () => {
  // Manual input wins over a count that would give 100 g.
  assert.equal(gramsForSelection(EGG, { measureId: "piece", count: 2, grams: 30 }), 30);
  // Grams only, no measure.
  assert.equal(gramsForSelection(EGG, { grams: 55.55 }), 55.6);
  // An explicit gram override of 0 is not "missing", it is 0 g.
  assert.equal(gramsForSelection(EGG, { measureId: "piece", count: 2, grams: 0 }), 0);
  assert.equal(gramsForSelection(EGG, { grams: -4 }), 0);
  // No grams at all -> count x measure.
  assert.equal(gramsForSelection(EGG, { measureId: "piece", count: 0.5 }), 25);
  assert.equal(gramsForSelection(EGG, { measureId: "cup", count: 1 }), 243);
  // Manual measure id without grams -> 0, nothing to convert.
  assert.equal(gramsForSelection(EGG, { measureId: GRAMS_MEASURE_ID, count: 1 }), 0);
  assert.equal(gramsForSelection(EGG, null), 0);
  assert.equal(gramsForSelection(EGG, "50"), 0);
});

test("normalizeSelection always returns measureId, count and grams", () => {
  assert.deepEqual(normalizeSelection(EGG, { measureId: "piece", count: 2 }), {
    measureId: "piece",
    count: 2,
    grams: 100,
  });
  // Half a unit keeps its count and the computed weight.
  assert.deepEqual(normalizeSelection(EGG, { measureId: "cup", count: 0.5 }), {
    measureId: "cup",
    count: 0.5,
    grams: 121.5,
  });
  // Manual grams -> count 0, the typed amount kept.
  assert.deepEqual(normalizeSelection(EGG, { measureId: GRAMS_MEASURE_ID, grams: 28 }), {
    measureId: GRAMS_MEASURE_ID,
    count: 0,
    grams: 28,
  });
  // An unknown measure falls back to the food's default measure.
  assert.deepEqual(normalizeSelection(EGG, { measureId: "nope", count: 1 }), {
    measureId: "piece",
    count: 1,
    grams: 50,
  });
  // No selection at all -> default measure x1.
  assert.deepEqual(normalizeSelection(EGG, undefined), { measureId: "piece", count: 1, grams: 50 });
  // A food without measures still gets a valid (0 g) selection object.
  assert.deepEqual(normalizeSelection(NO_MEASURES, undefined), {
    measureId: GRAMS_MEASURE_ID,
    count: 0,
    grams: 0,
  });
});

test("formatGrams renders Chinese weight text", () => {
  assert.equal(formatGrams(28), "约 28 g");
  assert.equal(formatGrams(121.5), "约 121.5 g");
  assert.equal(formatGrams(0), "约 0 g");
  assert.equal(formatGrams(-3), "约 0 g");
  assert.equal(formatGrams(24.04), "约 24 g");
});

test("stepCount moves in 0.5 steps and never goes below 0", () => {
  assert.equal(COUNT_STEP, 0.5);
  assert.equal(stepCount(1), 1.5);
  assert.equal(stepCount(1, -1), 0.5);
  assert.equal(stepCount(0.5, -1), 0);
  assert.equal(stepCount(0, -3), 0);
  assert.equal(stepCount(1, 0), 1);
  assert.equal(stepCount(2.5, 2), 3.5);
  // Float noise never leaks into the count.
  assert.equal(stepCount(0.1 + 0.2, 1), 0.8);
});
