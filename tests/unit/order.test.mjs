// Per-nutrient ordering with pinned selections (PLAN.md 1.7, phase P8;
// confirmation order since P17; commonness first since P18b).
//
// Small in-test fixtures: five foods with different per100g values, one food
// without data for the nutrient under test, one with a zero value and one with
// a nutrient key that is missing entirely.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LIMIT,
  LIMIT_STEP,
  DEFAULT_AMOUNT_BASIS_G,
  valueOf,
  commonnessOf,
  amountBasisGOf,
  richnessOf,
  selectionOrder,
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

test("selected foods are pinned first, in confirmation order (not by contribution)", () => {
  // `order` is the confirmation order: spinach was confirmed first, so it stays
  // above the carrot although the carrot contributes far more (200 g = 1670 ug
  // vs 100 g = 469 ug). A newly confirmed food joins the bottom (P17).
  const selections = {
    "fdc:carrot": { grams: 200 },
    "fdc:spinach": { grams: 100 },
  };
  const list = foodsForNutrient(FOODS, "vitA", selections, { order: ["fdc:spinach", "fdc:carrot"] });
  assert.deepEqual(list.slice(0, 2).map((food) => food.id), ["fdc:spinach", "fdc:carrot"]);
  assert.equal(list[0].selected, true);
  // The contribution is still reported (it describes the portion, not the rank).
  assert.equal(list[0].contribution, 469);
  assert.equal(list[1].contribution, 1670);
  // The rest is still density-sorted.
  assert.deepEqual(list.slice(2).map((food) => food.id), ["fdc:liver", "fdc:sweetpotato"]);

  // Without a stored order the key order of `selections` is used, which is how
  // state saved before P17 was written (migration path).
  const legacy = foodsForNutrient(FOODS, "vitA", { "fdc:carrot": { grams: 200 }, "fdc:spinach": { grams: 100 } });
  assert.deepEqual(legacy.slice(0, 2).map((food) => food.id), ["fdc:carrot", "fdc:spinach"]);

  // An id in `order` that is no longer selected is ignored, a selected id that
  // is missing from `order` is appended at the end.
  const drifted = foodsForNutrient(FOODS, "vitA", selections, { order: ["fdc:spinach", "fdc:gone"] });
  assert.deepEqual(drifted.slice(0, 2).map((food) => food.id), ["fdc:spinach", "fdc:carrot"]);
  assert.deepEqual(selectionOrder(selections, ["fdc:spinach", "fdc:gone", "fdc:spinach"]),
    ["fdc:spinach", "fdc:carrot"]);
  assert.deepEqual(selectionOrder(selections, "nope"), ["fdc:carrot", "fdc:spinach"]);
  assert.deepEqual(selectionOrder(null, ["x"]), []);
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
    { id: "fdc:c", nameZh: "丙", commonness: 3, per100g: { vitA: 100 } },
    { id: "fdc:a", nameZh: "甲", commonness: 3, per100g: { vitA: 100 } },
    { id: "fdc:b", nameZh: "乙", commonness: 3, per100g: { vitA: 100 } },
  ];
  assert.deepEqual(
    foodsForNutrient(tied, "vitA", {}).map((food) => food.nameZh),
    ["丙", "乙", "甲"], // code-point order
  );
});

// ---------------------------------------------------------------------------
// P18b: commonness first, richness second
// ---------------------------------------------------------------------------

test("commonnessOf reads the integer tier and treats junk as 0", () => {
  assert.equal(commonnessOf({ commonness: 5 }), 5);
  assert.equal(commonnessOf({ commonness: 1 }), 1);
  assert.equal(commonnessOf({}), 0);
  assert.equal(commonnessOf(null), 0);
  assert.equal(commonnessOf({ commonness: null }), 0);
  assert.equal(commonnessOf({ commonness: "x" }), 0);
  assert.equal(commonnessOf({ commonness: -2 }), 0);
});

test("unpinned foods sort by commonness first, richness within a tier", () => {
  const foods = [
    { id: "fdc:rare", nameZh: "鹿肉", commonness: 1, per100g: { vitA: 9000 } },
    { id: "fdc:liver", nameZh: "猪肝", commonness: 3, per100g: { vitA: 6502 } },
    { id: "fdc:carrot", nameZh: "胡萝卜", commonness: 5, per100g: { vitA: 835 } },
    { id: "fdc:spinach", nameZh: "菠菜", commonness: 5, per100g: { vitA: 469 } },
    { id: "fdc:sweetpotato", nameZh: "红薯", commonness: 4, per100g: { vitA: 709 } },
  ];
  assert.deepEqual(
    foodsForNutrient(foods, "vitA", {}).map((food) => food.id),
    ["fdc:carrot", "fdc:spinach", "fdc:sweetpotato", "fdc:liver", "fdc:rare"],
  );
  // Within tier 5 the richer food still leads; the rare but very rich food is
  // last because a tier decides before the amount does.
  const tiered = foodsForNutrient(foods, "vitA", {}).filter((food) => food.commonness === 5);
  assert.deepEqual(tiered.map((food) => food.per100g.vitA), [835, 469]);
});

test("a missing commonness sorts last, behind every tiered food", () => {
  const foods = [
    { id: "fdc:none", nameZh: "某食物", per100g: { vitA: 10000 } },
    { id: "fdc:tier1", nameZh: "鹿肉", commonness: 1, per100g: { vitA: 1 } },
    { id: "fdc:tier5", nameZh: "米饭", commonness: 5, per100g: { vitA: 2 } },
  ];
  assert.deepEqual(
    foodsForNutrient(foods, "vitA", {}).map((food) => food.id),
    ["fdc:tier5", "fdc:tier1", "fdc:none"],
  );
});

test("the pinned group ignores commonness and keeps the confirmation order", () => {
  const foods = [
    { id: "fdc:rare", nameZh: "鹿肉", commonness: 1, per100g: { vitA: 9000 } },
    { id: "fdc:carrot", nameZh: "胡萝卜", commonness: 5, per100g: { vitA: 835 } },
    { id: "fdc:spinach", nameZh: "菠菜", commonness: 5, per100g: { vitA: 469 } },
  ];
  const selections = { "fdc:rare": { grams: 10 }, "fdc:spinach": { grams: 10 } };
  const list = foodsForNutrient(foods, "vitA", selections, { order: ["fdc:rare", "fdc:spinach"] });
  assert.deepEqual(list.map((food) => food.id), ["fdc:rare", "fdc:spinach", "fdc:carrot"]);
  assert.deepEqual(list.slice(0, 2).map((food) => food.selected), [true, true]);
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

// ---------------------------------------------------------------------------
// P19b: richness on the comparison basis (per 10 g for small-portion foods)
// ---------------------------------------------------------------------------

test("amountBasisGOf reads 10 or 100 and defaults to 100", () => {
  assert.equal(amountBasisGOf({ amountBasisG: 10 }), 10);
  assert.equal(amountBasisGOf({ amountBasisG: 100 }), 100);
  assert.equal(amountBasisGOf({}), DEFAULT_AMOUNT_BASIS_G);
  assert.equal(amountBasisGOf(null), DEFAULT_AMOUNT_BASIS_G);
  assert.equal(amountBasisGOf({ amountBasisG: null }), DEFAULT_AMOUNT_BASIS_G);
  assert.equal(amountBasisGOf({ amountBasisG: "x" }), DEFAULT_AMOUNT_BASIS_G);
  assert.equal(amountBasisGOf({ amountBasisG: 0 }), DEFAULT_AMOUNT_BASIS_G);
  assert.equal(DEFAULT_AMOUNT_BASIS_G, 100);
});

test("richnessOf is per100g * amountBasisG / 100", () => {
  assert.equal(richnessOf({ per100g: { calcium: 181 }, amountBasisG: 10 }, "calcium"), 18.1);
  assert.equal(richnessOf({ per100g: { calcium: 181 } }, "calcium"), 181);
  assert.equal(richnessOf({ per100g: { calcium: null }, amountBasisG: 10 }, "calcium"), 0);
  assert.equal(richnessOf(null, "calcium"), 0);
});

test("a per-10 g food ranks below a same-tier food richer than its per-10 g value", () => {
  // Acceptance case for P19b, modelled on the calcium tab: garlic (181 mg per
  // 100 g, eaten per 10 g = 18.1 mg) and tofu (350 mg per 100 g). Both are
  // tier 5, so the tier does not decide; the comparison portion does. The
  // flagged food's per-100 g value (181) is higher than the unflagged food's
  // (100), yet the unflagged food wins because 100 > 18.1.
  const foods = [
    { id: "fdc:garlic", nameZh: "大蒜（生）", commonness: 5, amountBasisG: 10, per100g: { calcium: 181 } },
    { id: "fdc:tofu", nameZh: "豆腐（常规）", commonness: 5, amountBasisG: 100, per100g: { calcium: 350 } },
    { id: "fdc:seaweed", nameZh: "海带（生）", commonness: 5, amountBasisG: 100, per100g: { calcium: 100 } },
  ];
  assert.deepEqual(
    foodsForNutrient(foods, "calcium", {}).map((food) => food.id),
    ["fdc:tofu", "fdc:seaweed", "fdc:garlic"],
  );
  // The flagged food is not buried: a same-tier food that is poorer than
  // garlic's per-10 g value (e.g. 10 mg per 100 g) still comes after it.
  const mixed = [...foods, { id: "fdc:milk", nameZh: "牛奶", commonness: 5, amountBasisG: 100, per100g: { calcium: 10 } }];
  assert.deepEqual(
    foodsForNutrient(mixed, "calcium", {}).map((food) => food.id),
    ["fdc:tofu", "fdc:seaweed", "fdc:garlic", "fdc:milk"],
  );
});

test("the per-10 g basis never lets a food jump a commonness tier", () => {
  const foods = [
    { id: "fdc:spice", nameZh: "辣椒粉", commonness: 3, amountBasisG: 10, per100g: { calcium: 100000 } },
    { id: "fdc:tofu", nameZh: "豆腐（常规）", commonness: 5, amountBasisG: 100, per100g: { calcium: 1 } },
  ];
  // 100000 * 10 / 100 = 10000 is far above 1, but tier 5 still leads.
  assert.deepEqual(
    foodsForNutrient(foods, "calcium", {}).map((food) => food.id),
    ["fdc:tofu", "fdc:spice"],
  );
});

test("a missing amountBasisG competes like 100 g and ties keep the name order", () => {
  const foods = [
    { id: "fdc:b", nameZh: "乙", commonness: 5, per100g: { calcium: 100 } },
    { id: "fdc:a", nameZh: "甲", commonness: 5, per100g: { calcium: 100 } },
    { id: "fdc:ten", nameZh: "丙", commonness: 5, amountBasisG: 10, per100g: { calcium: 1000 } },
  ];
  // 1000 * 10 / 100 = 100, a three-way tie on richness, so the name decides
  // (code-point order: 丙, 乙, 甲).
  assert.deepEqual(
    foodsForNutrient(foods, "calcium", {}).map((food) => food.id),
    ["fdc:ten", "fdc:b", "fdc:a"],
  );
});

test("the pinned group still follows the confirmation order with per-10 g foods", () => {
  const foods = [
    { id: "fdc:garlic", nameZh: "大蒜（生）", commonness: 5, amountBasisG: 10, per100g: { calcium: 181 } },
    { id: "fdc:tofu", nameZh: "豆腐（常规）", commonness: 5, amountBasisG: 100, per100g: { calcium: 350 } },
  ];
  const selections = { "fdc:garlic": { grams: 5 }, "fdc:tofu": { grams: 100 } };
  const list = foodsForNutrient(foods, "calcium", selections, { order: ["fdc:garlic", "fdc:tofu"] });
  assert.deepEqual(list.map((food) => food.id), ["fdc:garlic", "fdc:tofu"]);
  // The contribution is grams x per100g / 100, untouched by the basis.
  assert.equal(list[0].contribution, 9.05);
  assert.equal(list[1].contribution, 350);
});
