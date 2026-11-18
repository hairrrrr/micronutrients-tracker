// Food detail rows (phase P21b): all 22 nutrients of one food, ranked by the
// share of the daily target, with the amount for a chosen quantity.
//
// Fixtures are tiny on purpose; the last test uses the real nutrients.json,
// dri.json and foods.json so the module is checked against the shipped data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  STATUS_ORDER,
  detailRows,
  formatPct,
  sortDetailRows,
} from "../../docs/js/core/detail.js";
import { targetsFor } from "../../docs/js/core/dri.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

/** Nutrient metadata fixture: id, Chinese name, unit, in data order. */
const NUTRIENTS = [
  { id: "vitA", nameZh: "维生素A", unit: "ug RAE" },
  { id: "vitC", nameZh: "维生素C", unit: "mg" },
  { id: "calcium", nameZh: "钙", unit: "mg" },
  { id: "iron", nameZh: "铁", unit: "mg" },
  { id: "vitD", nameZh: "维生素D", unit: "ug" },
];

/** Targets in the dri.js `values` shape: `{ target, type, ul }` per nutrient. */
const TARGETS = {
  values: {
    vitA: { target: 800, type: "RNI", ul: 3000 },
    vitC: { target: 100, type: "RNI", ul: 2000 },
    calcium: { target: 800, type: "RNI", ul: 2000 },
    iron: { target: 20, type: "RNI", ul: 42 },
    // vitD deliberately has no entry: this profile has no reference value.
  },
};

const byId = (rows, id) => rows.find((row) => row.id === id);

/** A plain food: 100 g gives 10 % vitamin A, 50 % vitamin C, 1 % calcium. */
const FOOD = {
  id: "fdc:test",
  per100g: { vitA: 80, vitC: 50, calcium: 8, iron: 0, vitD: 3 },
};

/** Bone-in food: 30 % refuse, so 100 g with bone is 70 g edible. */
const BONE_IN = {
  id: "fdc:ribs",
  refusePct: 30,
  per100g: { vitA: 10, vitC: 10, calcium: 10, iron: 10, vitD: 10 },
};

test("one row per nutrient metadata entry, in metadata order for equal rows", () => {
  const rows = detailRows(FOOD, TARGETS, NUTRIENTS, null);
  assert.equal(rows.length, NUTRIENTS.length);
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(NUTRIENTS.map((n) => n.id)));
  for (const row of rows) {
    const meta = NUTRIENTS.find((n) => n.id === row.id);
    assert.equal(row.name, meta.nameZh);
    assert.equal(row.unit, meta.unit);
  }
});

test("per100g, pct100 and the four status groups with their order", () => {
  const rows = detailRows(FOOD, TARGETS, NUTRIENTS, null);
  assert.deepEqual(rows.map((row) => row.id), ["vitC", "vitA", "calcium", "vitD", "iron"]);
  assert.deepEqual(rows.map((row) => row.status), ["ok", "ok", "ok", "noTarget", "zero"]);
  assert.equal(byId(rows, "vitA").pct100, 10);
  assert.equal(byId(rows, "vitC").pct100, 50);
  assert.equal(byId(rows, "vitD").pct100, null);
  assert.equal(byId(rows, "vitD").per100g, 3);
  assert.equal(byId(rows, "iron").per100g, 0);
  assert.equal(byId(rows, "iron").pct100, 0);
});

test("status order constant matches the ranking", () => {
  assert.deepEqual(STATUS_ORDER, ["ok", "noTarget", "zero", "missing"]);
  const food = { per100g: { vitA: 0, vitC: 5 } };
  const rows = detailRows(food, TARGETS, NUTRIENTS, null);
  const seen = rows.map((row) => row.status);
  const ranks = seen.map((status) => STATUS_ORDER.indexOf(status));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.deepEqual(seen, ["ok", "zero", "missing", "missing", "missing"]);
});

test("0 and null are different statuses and different percentages", () => {
  const food = { per100g: { vitA: 0, vitC: null } };
  const rows = detailRows(food, TARGETS, NUTRIENTS, null);
  assert.equal(byId(rows, "vitA").status, "zero");
  assert.equal(byId(rows, "vitA").per100g, 0);
  assert.equal(byId(rows, "vitA").pct100, 0);
  assert.equal(byId(rows, "vitC").status, "missing");
  assert.equal(byId(rows, "vitC").per100g, null);
  assert.equal(byId(rows, "vitC").pct100, null);
  assert.equal(byId(rows, "vitC").amount, null);
  // A nutrient key that is missing entirely is "missing" too.
  assert.equal(byId(rows, "calcium").status, "missing");
});

test("a nutrient without a target sorts after all targeted ones", () => {
  const food = { per100g: { vitA: 4, vitC: 1, calcium: 1, iron: 1, vitD: 999 } };
  const rows = detailRows(food, TARGETS, NUTRIENTS, null);
  const targeted = rows.filter((row) => row.status === "ok");
  assert.equal(rows[rows.length - 1].id, "vitD");
  assert.equal(byId(rows, "vitD").status, "noTarget");
  assert.ok(targeted.length === 4);
  const lastTargeted = rows.findIndex((row) => row.status !== "ok");
  assert.equal(rows.slice(lastTargeted).every((row) => row.status !== "ok"), true);
  // 999 ug of vitamin D per 100 g is bigger than every targeted value, yet it
  // is ranked below them because there is nothing to compare it against.
  const untargeted = rows.filter((row) => row.status === "noTarget").map((row) => row.id);
  assert.deepEqual(untargeted, ["vitD"]);
});

test("quantity scales the amount and the percentage linearly", () => {
  const hundred = detailRows(FOOD, TARGETS, NUTRIENTS, 100);
  const hundredFifty = detailRows(FOOD, TARGETS, NUTRIENTS, 150);
  assert.equal(byId(hundred, "vitC").amount, 50);
  assert.equal(byId(hundred, "vitC").pct, 50);
  assert.equal(byId(hundredFifty, "vitC").amount, 75);
  assert.equal(byId(hundredFifty, "vitC").pct, 75);
  assert.equal(byId(hundredFifty, "vitA").per100g, byId(hundred, "vitA").per100g);
  assert.equal(byId(hundredFifty, "vitA").pct100, byId(hundred, "vitA").pct100);
  assert.equal(byId(hundredFifty, "vitC").pct100, 50);
});

test("no quantity means no amount, and a quantity without a target gives pct null", () => {
  for (const grams of [null, undefined, 0, -5, "abc"]) {
    const rows = detailRows(FOOD, TARGETS, NUTRIENTS, grams);
    assert.equal(byId(rows, "vitC").amount, null);
    assert.equal(byId(rows, "vitC").pct, null);
  }
  const rows = detailRows(FOOD, TARGETS, NUTRIENTS, 100);
  assert.equal(byId(rows, "vitD").amount, 3);
  assert.equal(byId(rows, "vitD").pct, null);
});

test("bone-in food uses edible grams, like the intake totals", () => {
  const rows = detailRows(BONE_IN, TARGETS, NUTRIENTS, 100);
  assert.ok(Math.abs(byId(rows, "vitC").amount - 7) < 1e-9);
  assert.ok(Math.abs(byId(rows, "vitC").pct - 7) < 1e-9);
  // per100g is always per 100 g of edible portion, so refuse never changes it.
  assert.equal(byId(rows, "vitC").per100g, 10);
  assert.equal(byId(rows, "vitC").pct100, 10);
});

test("targets accepted as a bare number map, and unusable targets count as none", () => {
  const rows = detailRows(FOOD, { vitC: 100 }, NUTRIENTS, null);
  assert.equal(byId(rows, "vitC").status, "ok");
  assert.equal(byId(rows, "vitC").pct100, 50);
  assert.equal(byId(rows, "vitA").status, "noTarget");

  const zeroTargets = { values: { vitC: { target: 0 }, vitA: { target: null } } };
  const zeroRows = detailRows(FOOD, zeroTargets, NUTRIENTS, null);
  assert.equal(byId(zeroRows, "vitC").pct100, null);
  assert.equal(byId(zeroRows, "vitC").status, "noTarget");
  assert.equal(byId(zeroRows, "vitA").pct100, null);
});

test("sortDetailRows keeps metadata order on ties and does not mutate", () => {
  const rows = [
    { id: "a", status: "ok", pct100: 10, per100g: 1 },
    { id: "b", status: "ok", pct100: 10, per100g: 1 },
    { id: "c", status: "noTarget", pct100: null, per100g: 5 },
    { id: "d", status: "noTarget", pct100: null, per100g: 5 },
    { id: "e", status: "missing", pct100: null, per100g: null },
    { id: "f", status: "zero", pct100: 0, per100g: 0 },
  ];
  const snapshot = rows.map((row) => row.id);
  const sorted = sortDetailRows(rows);
  assert.deepEqual(sorted.map((row) => row.id), ["a", "b", "c", "d", "f", "e"]);
  assert.deepEqual(rows.map((row) => row.id), snapshot);
});

test("formatPct", () => {
  assert.equal(formatPct(null), "—");
  assert.equal(formatPct(undefined), "—");
  assert.equal(formatPct(0), "0%");
  assert.equal(formatPct(0.4), "<1%");
  assert.equal(formatPct(1), "1%");
  assert.equal(formatPct(3.456), "3.5%");
  assert.equal(formatPct(3.0), "3%");
  assert.equal(formatPct(12.4), "12%");
  assert.equal(formatPct(123.4), "123%");
});

test("real data: 22 rows for a food, ranked with the real DRI targets", () => {
  const { nutrients } = readJson("docs/data/nutrients.json");
  const foods = readJson("docs/data/foods.json").foods;
  const dri = readJson("docs/data/dri.json");
  const targets = targetsFor(dri, "cn2023", { sex: "female", age: 30 });

  const food = foods.find((item) => item.id === "fdc:169301") ?? foods[0];
  const rows = detailRows(food, targets, nutrients, 150);

  assert.equal(nutrients.length, 22);
  assert.equal(rows.length, 22);
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(nutrients.map((n) => n.id)));

  // Expected order recomputed independently from the raw data.
  const expected = nutrients
    .map((nutrient, index) => {
      const value = food.per100g[nutrient.id];
      const per100g = value === null || value === undefined ? null : Number(value);
      const target = targets.values[nutrient.id]?.target ?? null;
      return {
        id: nutrient.id,
        index,
        per100g,
        pct100: per100g !== null && target ? (per100g / target) * 100 : null,
      };
    })
    .filter((row) => row.per100g !== null && row.per100g > 0 && row.pct100 !== null)
    .sort((a, b) => (b.pct100 - a.pct100) || (a.index - b.index))
    .map((row) => row.id);

  assert.deepEqual(rows.slice(0, expected.length).map((row) => row.id), expected);
  assert.equal(rows.filter((row) => row.status === "ok").length, expected.length);

  // Amounts scale with the 150 g quantity on every row that has a value.
  for (const row of rows) {
    if (row.per100g === null) {
      assert.equal(row.status, "missing");
      assert.equal(row.amount, null);
    } else {
      assert.ok(Math.abs(row.amount - (row.per100g * 150) / 100) < 1e-9);
    }
  }
});

test("real data: bone-in spare ribs amount uses edible grams", () => {
  const { nutrients } = readJson("docs/data/nutrients.json");
  const foods = readJson("docs/data/foods.json").foods;
  const dri = readJson("docs/data/dri.json");
  const targets = targetsFor(dri, "cn2023", { sex: "male", age: 30 });

  const ribs = foods.find((item) => item.id === "fdc:167853");
  assert.equal(ribs.refusePct, 30);

  const rows = detailRows(ribs, targets, nutrients, 100);
  const iron = rows.find((row) => row.id === "iron");
  assert.ok(Math.abs(iron.amount - (ribs.per100g.iron * 70) / 100) < 1e-9);
  assert.equal(iron.status, "ok");
});
