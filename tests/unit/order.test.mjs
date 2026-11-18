// Per-nutrient ordering with pinned selections (PLAN.md 1.7, phase P8).
//
// Small in-test fixtures: five foods with different per100g values, one food
// without data for the nutrient under test, one with a zero value and one with
// a nutrient key that is missing entirely.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LIMIT,
  LIMIT_STEP,
  valueOf,
  contribution,
  partitionFoods,
  foodsForNutrient,
  nextLimit,
  hasMore,
} from "../../docs/js/core/order.js";

// vitamin A per 100 g, chosen so contribution order != per100g order.
const FOODS = [
  { id: "fdc:liver", nameZh: "猪肝", nameEn: "Pork liver", per100g: { vitA: 6502, iron: 23.3 } },
  { id: "fdc:carrot", nameZh: "胡萝卜", nameEn: "Carrots", per100g: { vitA: 835, iron: 0.3 } },
  { id: "fdc:spinach", nameZh: "菠菜", nameEn: "Spinach", per100g: { vitA: 469, iron: 2.7 } },
  { id: "fdc:sweetpotato", nameZh: "红薯", nameEn: "Sweet potato", per100g: { vitA: 709, iron: 0.6 } },
  { id: "fdc:rice", nameZh: "米饭", nameEn: "Cooked rice", per100g: { vitA: 0, iron: 0.2 } },
  { id: "fdc:salt", nameZh: "食盐", nameEn: "Salt", per100g: { vitA: null, iron: 0 } },
];

const byId = (foods, id) => foods.find((food) => food.id === id);

test("valueOf returns numbers and null for missing data or zero-ish values", () => {
  assert.equal(valueOf(byId(FOODS, "fdc:liver"), "vitA"), 6502);
  assert.equal(valueOf(byId(FOODS, "fdc:rice"), "vitA"), 0);
  assert.equal(valueOf(byId(FOODS, "fdc:salt"), "vitA"), null);
  assert.equal(valueOf(byId(FOODS, "fdc:liver"), "nope"), null);
  assert.equal(valueOf(null, "vitA"), null);
});

test("contribution is per100g * grams / 100", () => {
  assert.equal(contribution(byId(FOODS, "fdc:liver"), "vitA", { grams: 50 }), 3251);
  assert.equal(contribution(byId(FOODS, "fdc:carrot"), "vitA", { grams: 200 }), 1670);
  assert.equal(contribution(byId(FOODS, "fdc:salt"), "vitA", { grams: 100 }), 0);
  assert.equal(contribution(byId(FOODS, "fdc:liver"), "vitA", { grams: 0 }), 0);
});

test("without selections foods are sorted by per100g descending, no zeros", () => {
  const list = foodsForNutrient(FOODS, "vitA", {});
  assert.deepEqual(list.map((food) => food.id), [
    "fdc:liver",
    "fdc:carrot",
    "fdc:sweetpotato",
    "fdc:spinach",
  ]);
  // per100g 0 and null are both excluded from the group.
  assert.equal(list.some((food) => food.id === "fdc:rice"), false);
  assert.equal(list.some((food) => food.id === "fdc:salt"), false);
});

test("selected foods are pinned first, ordered by actual contribution", () => {
  // 200 g of carrot (1670) beats 100 g of spinach (469) although its per100g
  // value is lower than liver's: pinned order uses contribution, not density.
  const selections = {
    "fdc:carrot": { grams: 200 },
    "fdc:spinach": { grams: 100 },
  };
  const list = foodsForNutrient(FOODS, "vitA", selections);
  assert.deepEqual(list.slice(0, 2).map((food) => food.id), ["fdc:carrot", "fdc:spinach"]);
  assert.equal(list[0].selected, true);
  assert.equal(list[0].contribution, 1670);
  assert.equal(list[1].contribution, 469);
  // The rest is still density-sorted.
  assert.deepEqual(list.slice(2).map((food) => food.id), ["fdc:liver", "fdc:sweetpotato"]);
});

test("a selected food with a null or missing value is not listed", () => {
  const selections = { "fdc:salt": { grams: 100 } };
  const list = foodsForNutrient(FOODS, "vitA", selections);
  assert.equal(list.some((food) => food.id === "fdc:salt"), false);

  // A missing per100g key behaves like null: no data, so not listed.
  const noKey = [{ id: "fdc:bare", nameZh: "无数据食物", per100g: { iron: 1 } }];
  const bare = foodsForNutrient(noKey, "vitA", { "fdc:bare": { grams: 100 } });
  assert.deepEqual(bare, []);
  const { pinned, unpinned } = partitionFoods(noKey, "vitA", { "fdc:bare": { grams: 100 } });
  assert.deepEqual(pinned, []);
  assert.deepEqual(unpinned, []);
});

test("a selected food with a zero value is not pinned and not listed", () => {
  // User review (P16): carrot in the Vitamin A tab (vitD = 0) used to be
  // pinned in the Vitamin D tab. 0 means "none of this nutrient".
  const selections = { "fdc:rice": { grams: 150 } };
  const list = foodsForNutrient(FOODS, "vitA", selections);
  assert.equal(list.some((food) => food.id === "fdc:rice"), false);
  const { pinned, unpinned } = partitionFoods(FOODS, "vitA", selections);
  assert.deepEqual(pinned, []);
  assert.equal(unpinned.some((food) => food.id === "fdc:rice"), false);

  // A selected food with iron 0 is likewise absent from the iron tab.
  const iron = foodsForNutrient(FOODS, "iron", { "fdc:salt": { grams: 100 } });
  assert.equal(iron.some((food) => food.id === "fdc:salt"), false);

  // ... while a selected food that does contain the nutrient is still pinned.
  const pinnedRice = partitionFoods(FOODS, "iron", { "fdc:rice": { grams: 150 } }).pinned;
  assert.deepEqual(pinnedRice.map((food) => food.id), ["fdc:rice"]);
  assert.equal(pinnedRice[0].selected, true);
  assert.equal(pinnedRice[0].contribution, 0.3);
});

test("a selected food with a value > 0 is pinned in that nutrient's tab", () => {
  const selections = { "fdc:carrot": { grams: 200 } };
  const { pinned } = partitionFoods(FOODS, "vitA", selections);
  assert.deepEqual(pinned.map((food) => food.id), ["fdc:carrot"]);
  assert.equal(pinned[0].selected, true);
  assert.equal(pinned[0].contribution, 1670);
  const list = foodsForNutrient(FOODS, "vitA", selections);
  assert.equal(list[0].id, "fdc:carrot");
  assert.equal(list[0].selected, true);
  // The same selection is not listed under a nutrient the food lacks.
  assert.equal(foodsForNutrient(FOODS, "vitD", selections).length, 0);
});

test("pinned foods come before unpinned ones regardless of the limit", () => {
  const selections = { "fdc:spinach": { grams: 10 } };
  const list = foodsForNutrient(FOODS, "vitA", selections, { limit: 1 });
  // 1 pinned + 1 unpinned card.
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "fdc:spinach");
  assert.equal(list[1].id, "fdc:liver");
});

test("limit applies only to the unpinned part and defaults to 60", () => {
  assert.equal(DEFAULT_LIMIT, 60);
  assert.equal(LIMIT_STEP, 60);

  const many = [];
  for (let index = 0; index < 100; index += 1) {
    many.push({
      id: `fdc:${index}`,
      nameZh: `食物${String(index).padStart(3, "0")}`,
      per100g: { vitA: 1000 - index },
    });
  }

  assert.equal(foodsForNutrient(many, "vitA", {}).length, DEFAULT_LIMIT);
  assert.deepEqual(
    foodsForNutrient(many, "vitA", {}, { limit: 3 }).map((food) => food.per100g.vitA),
    [1000, 999, 998],
  );
  // Two pinned + 60 unpinned.
  assert.equal(foodsForNutrient(many, "vitA", { "fdc:99": { grams: 100 } }).length, 61);
  assert.equal(nextLimit(DEFAULT_LIMIT), 120);
  assert.equal(hasMore(many, "vitA", {}, DEFAULT_LIMIT), true);
  assert.equal(hasMore(many, "vitA", {}, 100), false);
  // A negative or broken limit falls back to the default instead of throwing.
  assert.equal(foodsForNutrient(many, "vitA", {}, { limit: -5 }).length, DEFAULT_LIMIT);
  assert.equal(foodsForNutrient(many, "vitA", {}, { limit: "x" }).length, DEFAULT_LIMIT);
});

test("ties are broken by nameZh in the unpinned part", () => {
  const tied = [
    { id: "fdc:c", nameZh: "丙", per100g: { vitA: 100 } },
    { id: "fdc:a", nameZh: "甲", per100g: { vitA: 100 } },
    { id: "fdc:b", nameZh: "乙", per100g: { vitA: 100 } },
  ];
  assert.deepEqual(
    foodsForNutrient(tied, "vitA", {}).map((food) => food.nameZh),
    ["丙", "乙", "甲"], // code-point order
  );
});

test("partitionFoods exposes both sorted groups without truncation", () => {
  const { pinned, unpinned } = partitionFoods(FOODS, "vitA", { "fdc:liver": { grams: 100 } });
  assert.deepEqual(pinned.map((food) => food.id), ["fdc:liver"]);
  assert.deepEqual(unpinned.map((food) => food.id), ["fdc:carrot", "fdc:sweetpotato", "fdc:spinach"]);
  // Broken inputs are handled, not thrown at.
  assert.deepEqual(partitionFoods(null, "vitA", null), { pinned: [], unpinned: [] });
  assert.deepEqual(partitionFoods(FOODS, "unknown"), { pinned: [], unpinned: [] });
});

test("optional search keeps pinned foods on top and matches nameZh/aliases/nameEn", () => {
  const foods = [
    ...FOODS,
    { id: "fdc:liverpaste", nameZh: "肝酱", nameEn: "Liver paste", aliases: ["猪肝酱"], per100g: { vitA: 100 } },
  ];
  const list = foodsForNutrient(foods, "vitA", { "fdc:liverpaste": { grams: 100 } }, { search: "liver" });
  assert.deepEqual(list.map((food) => food.id), ["fdc:liverpaste", "fdc:liver"]);
  const byAlias = foodsForNutrient(foods, "vitA", { "fdc:liverpaste": { grams: 100 } }, { search: "猪肝酱" });
  assert.deepEqual(byAlias.map((food) => food.id), ["fdc:liverpaste"]);
  // The search never reorders pinned foods below an unpinned match.
  const mixed = foodsForNutrient(foods, "vitA", { "fdc:liverpaste": { grams: 1 } }, { search: "肝" });
  assert.equal(mixed[0].id, "fdc:liverpaste");
});
