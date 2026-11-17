// Checks the generated food data against fixed values taken directly from the
// USDA SR Legacy 2018-04 tables (see PLAN.md phase P4). The fixture numbers
// below must not be changed: they are the independent reference values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foodsPath = new URL("../../docs/data/foods.json", import.meta.url);
const nutrientsPath = new URL("../../docs/data/nutrients.json", import.meta.url);

const data = JSON.parse(await readFile(foodsPath, "utf8"));
const nutrients = JSON.parse(await readFile(nutrientsPath, "utf8"));

const foodsById = new Map(data.foods.map((food) => [food.id, food]));

function food(id) {
  const found = foodsById.get(id);
  assert.ok(found, `foods.json has no food ${id}`);
  return found;
}

function per100g(id, nutrientId) {
  return food(id).per100g[nutrientId];
}

test("foods.json has the SR Legacy source header", () => {
  assert.equal(data.source.name, "USDA FoodData Central SR Legacy");
  assert.equal(data.source.release, "2018-04");
  assert.ok(data.source.url.startsWith("https://"));
});

test("foods.json is not empty and every food has all 22 nutrients", () => {
  assert.ok(data.foods.length > 100, `only ${data.foods.length} foods`);
  const nutrientIds = nutrients.nutrients.map((nutrient) => nutrient.id);
  assert.equal(nutrientIds.length, 22);
  for (const food of data.foods) {
    for (const nutrientId of nutrientIds) {
      assert.ok(
        Object.hasOwn(food.per100g, nutrientId),
        `${food.id} misses ${nutrientId}`,
      );
    }
  }
});

test("pork liver raw (fdc:167862) has the SR Legacy values", () => {
  assert.equal(per100g("fdc:167862", "vitA"), 6502);
  assert.equal(per100g("fdc:167862", "vitB12"), 26);
  assert.equal(per100g("fdc:167862", "iron"), 23.3);
  assert.equal(per100g("fdc:167862", "thiamin"), 0.283);
});

test("egg whole raw (fdc:171287) has the SR Legacy values", () => {
  assert.equal(per100g("fdc:171287", "vitA"), 160);
  assert.equal(per100g("fdc:171287", "vitB12"), 0.89);
  assert.equal(per100g("fdc:171287", "iron"), 1.75);
});

test("niacin is reported as NE for pork liver raw (fdc:167862)", () => {
  // 15.301 mg niacin + 0.301 g tryptophan * 1000 / 60 = 20.317 -> 20.32
  const niacin = per100g("fdc:167862", "niacin");
  assert.ok(Math.abs(niacin - 20.32) <= 0.01, `niacin ${niacin} != 20.32 +/- 0.01`);
  assert.equal(food("fdc:167862").flags.niacinNoTryptophan, false);
});

test("missing USDA data stays null and is never turned into 0", () => {
  const nullable = data.foods.filter((food) =>
    Object.values(food.per100g).some((value) => value === null),
  );
  assert.ok(nullable.length > 0, "no null values at all: suspicious for SR Legacy");
  for (const food of data.foods) {
    for (const [nutrientId, value] of Object.entries(food.per100g)) {
      assert.ok(
        value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0),
        `${food.id} ${nutrientId}: ${value}`,
      );
    }
  }
});

test("every food has measures with exactly one default", () => {
  for (const food of data.foods) {
    assert.ok(food.measures.length >= 1, `${food.id} has no measure`);
    const defaults = food.measures.filter((measure) => measure.default);
    assert.equal(defaults.length, 1, `${food.id} has ${defaults.length} defaults`);
    for (const measure of food.measures) {
      assert.ok(measure.grams >= 1 && measure.grams <= 1000, `${food.id} ${measure.id}`);
      assert.match(measure.basis, /^(usda_portion:\d+|estimate:.+)$/);
    }
  }
});

test("household measures stay in their sanity ranges (PLAN P5)", () => {
  const ranges = [
    { id: "fdc:171287", label: "一个", low: 40, high: 60 }, // one egg
    { id: "fdc:170567", label: "一把", low: 15, high: 35 }, // handful of almonds
    { id: "fdc:168878", label: "一拳", low: 100, high: 200 }, // fist of cooked rice
    { id: "fdc:168878", label: "一碗", low: 120, high: 250 }, // bowl of cooked rice
    { id: "fdc:171265", label: "一杯", low: 200, high: 260 }, // cup of milk
  ];
  for (const range of ranges) {
    const measure = food(range.id).measures.find((item) => item.labelZh === range.label);
    assert.ok(measure, `${range.id} has no ${range.label} measure`);
    assert.ok(
      measure.grams >= range.low && measure.grams <= range.high,
      `${range.id} ${range.label} is ${measure.grams} g, expected ${range.low}-${range.high} g`,
    );
  }
});
