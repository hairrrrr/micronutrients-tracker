// Checks the labeled composite dish estimates (PLAN.md phase P6).
//
// The dish 番茄炒蛋 (tomato and egg stir-fry) is recomputed here by hand from
// the SR Legacy per-100 g values of its ingredients as they are stored in
// foods.json: 70 g tomato, 23 g whole raw egg, 5.5 g peanut oil and 1.5 g
// spring onion per 100 g of finished dish. The expected numbers below are
// written out independently of the build script, so a wrong recipe, a wrong
// summation or a silently dropped ingredient shows up as a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foodsPath = new URL("../../docs/data/foods.json", import.meta.url);
const data = JSON.parse(await readFile(foodsPath, "utf8"));

const foodsById = new Map(data.foods.map((food) => [food.id, food]));

function food(id) {
  const found = foodsById.get(id);
  assert.ok(found, `foods.json has no food ${id}`);
  return found;
}

// Recipe of composite:fanqie-chaodan: [food id, grams per 100 g of dish].
const TOMATO_EGG_RECIPE = [
  ["fdc:170457", 70], // 番茄（生）
  ["fdc:171287", 23], // 鸡蛋（全蛋，生）
  ["fdc:171410", 5.5], // 花生油
  ["fdc:170005", 1.5], // 小葱
];

// A null ingredient value means "no data" and counts as 0, exactly like the
// build script does for composites; the dish is flagged when that happens.
function recompute(nutrientId) {
  let total = 0;
  let known = false;
  for (const [id, grams] of TOMATO_EGG_RECIPE) {
    const value = food(id).per100g[nutrientId];
    if (value === null) continue;
    total += (value * grams) / 100;
    known = true;
  }
  return known ? total : null;
}

function partialNutrients() {
  const dish = food("composite:fanqie-chaodan");
  return Object.keys(dish.per100g).filter((nutrientId) => {
    const values = TOMATO_EGG_RECIPE.map(([id]) => food(id).per100g[nutrientId]);
    const known = values.filter((value) => value !== null).length;
    return known > 0 && known < values.length;
  });
}

test("番茄炒蛋 is a labeled composite with a recipe basis", () => {
  const dish = food("composite:fanqie-chaodan");
  assert.equal(dish.estimate, true);
  assert.equal(dish.fdcId, null);
  assert.equal(dish.usdaDescription, null);
  assert.equal(dish.nameZh, "番茄炒蛋");
  assert.equal(dish.category, "菜肴估算");
  for (const [id, grams] of TOMATO_EGG_RECIPE) {
    assert.ok(
      dish.basis.includes(`${id} ${grams} g`),
      `basis does not list ${id} ${grams} g: ${dish.basis}`,
    );
  }
  assert.match(dish.basis, /rough typical home recipe/);
  assert.match(dish.basis, /no cooking retention/);
});

test("番茄炒蛋 per 100 g equals the hand-computed ingredient sum", () => {
  const dish = food("composite:fanqie-chaodan");
  // 番茄 vitA 42 mg/100 g * 0.7 + 鸡蛋 160 * 0.23 = 29.4 + 36.8 = 66.2
  // + 花生油 0 + 小葱 50 * 0.015 = 0.75 -> 66.95
  assert.equal(dish.per100g.vitA, 66.95);
  // vitC: 13.7*0.7 + 0*0.23 + 0 + 18.8*0.015 = 9.59 + 0.282 = 9.872
  assert.equal(dish.per100g.vitC, 9.872);
  // folate: 15*0.7 + 47*0.23 + 64*0.015 = 10.5 + 10.81 + 0.96 = 22.27
  assert.equal(dish.per100g.folate, 22.27);
  // iron: 0.27*0.7 + 1.75*0.23 + 0.03*0.055 + 1.48*0.015 = 0.6154
  assert.equal(dish.per100g.iron, 0.6154);
  // potassium: 237*0.7 + 138*0.23 + 276*0.015 = 201.78 -> 201.8
  assert.equal(dish.per100g.potassium, 201.8);
});

test("番茄炒蛋 nutrient values match a generic recomputation from foods.json", () => {
  const dish = food("composite:fanqie-chaodan");
  for (const nutrientId of Object.keys(dish.per100g)) {
    const expected = recompute(nutrientId);
    const actual = dish.per100g[nutrientId];
    if (expected === null) {
      assert.equal(actual, null, `${nutrientId}: ${actual} should be null`);
      continue;
    }
    assert.ok(
      Math.abs(actual - expected) <= Math.max(0.001, Math.abs(expected) * 0.001),
      `${nutrientId}: ${actual} != recomputed ${expected}`,
    );
  }
  // Missing ingredient values count as 0, and the dish says which nutrients
  // that affected so the UI can show the value as a lower bound.
  assert.deepEqual(dish.flags.partialNullNutrients, partialNutrients());
  assert.deepEqual(dish.flags.partialNullNutrients, ["manganese"]);
  assert.match(dish.basis, /counted as 0/);
});

test("every composite dish is an estimate with ingredients summing to 100 g", () => {
  const composites = data.foods.filter((item) => item.estimate);
  assert.ok(composites.length >= 15 && composites.length <= 25, `${composites.length} composites`);
  for (const dish of composites) {
    assert.match(dish.id, /^composite:[a-z0-9_-]+$/, dish.id);
    const listed = [...dish.basis.matchAll(/fdc:(\d+) ([\d.]+) g/g)];
    assert.ok(listed.length >= 2, `${dish.id} basis lists ${listed.length} ingredients`);
    const sum = listed.reduce((total, match) => total + Number(match[2]), 0);
    assert.ok(Math.abs(sum - 100) <= 0.5, `${dish.id} ingredients sum to ${sum} g`);
    for (const [index, match] of listed.entries()) {
      const ingredientId = `fdc:${match[1]}`;
      assert.ok(foodsById.has(ingredientId), `${dish.id} ingredient ${ingredientId} missing`);
      assert.equal(foodsById.get(ingredientId).estimate, false, `${ingredientId} is an estimate`);
      // Every ingredient must appear once, and the order in the basis is the
      // order of the recipe rows.
      assert.equal(
        listed.findIndex((other) => other[1] === match[1]),
        index,
        `${dish.id} lists ${ingredientId} twice`,
      );
    }
    assert.equal(dish.measures.filter((measure) => measure.default).length, 1, dish.id);
    assert.match(dish.measures.find((measure) => measure.default).labelZh, /^[一二三四五六七八九十百半]/);
  }
});
