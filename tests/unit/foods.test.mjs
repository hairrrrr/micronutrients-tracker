// Food card models (PLAN.md 1.7, 1.8 item 5, phase P11a).
//
// Only the pure helpers are imported: `renderFoods` needs a DOM, while
// `buildFoodCards` / `foodCardHtml` / `foodsHtml` / `hiddenCount` work from
// plain objects. The invariants checked here are the ones the phase's
// acceptance criteria depend on: the cards follow `order.js` (pinned first,
// then highest per 100 g), 60 cards initially with a "show more" button that
// adds 60, the amount text carries the active nutrient's unit, an estimate
// badge only on composites, and every card is a button with `aria-pressed`.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LIMIT, LIMIT_STEP } from "../../docs/js/core/order.js";
import {
  ESTIMATE_BADGE,
  buildFoodCards,
  foodArray,
  foodCardHtml,
  foodsHeading,
  foodsHtml,
  hiddenCount,
  per100gText,
} from "../../docs/js/ui/foods.js";

const NUTRIENTS = {
  nutrients: [
    { id: "vitA", nameZh: "维生素A", nameEn: "Vitamin A", unit: "ug RAE", color: "#f3daba", kind: "vitamin" },
    { id: "iron", nameZh: "铁", nameEn: "Iron", unit: "mg", color: "#ecd5f1", kind: "mineral" },
  ],
};

const FOODS = [
  { id: "fdc:liver", nameZh: "猪肝", nameEn: "Pork liver, raw", per100g: { vitA: 6502, iron: 23.3 }, estimate: false },
  { id: "fdc:carrot", nameZh: "胡萝卜", nameEn: "Carrots, raw", per100g: { vitA: 835, iron: 0.3 }, estimate: false },
  { id: "fdc:spinach", nameZh: "菠菜", nameEn: "Spinach, raw", per100g: { vitA: 469, iron: 2.7 }, estimate: false },
  { id: "fdc:salt", nameZh: "食盐", nameEn: "Salt", per100g: { vitA: null, iron: 0 }, estimate: false },
  {
    id: "composite:fanqie",
    nameZh: "番茄炒蛋",
    nameEn: "Tomato and egg stir-fry",
    per100g: { vitA: 66.95, iron: 0.6154 },
    estimate: true,
  },
];

const FOODS_JSON = { foods: FOODS };

function ctx(overrides = {}) {
  return {
    nutrients: NUTRIENTS,
    foods: FOODS_JSON,
    limit: DEFAULT_LIMIT,
    state: {
      profile: { sex: "female", age: 30, lifeStage: "none" },
      standard: "cn2023",
      activeNutrient: "vitA",
      selections: {},
      ...overrides,
    },
  };
}

function ids(cards) {
  return cards.map((card) => card.id);
}

test("foodArray accepts the payload and a bare array, and drops junk", () => {
  assert.equal(foodArray(FOODS_JSON).length, FOODS.length);
  assert.equal(foodArray(FOODS).length, FOODS.length);
  assert.deepEqual(foodArray(null), []);
  assert.equal(foodArray({ foods: [null, FOODS[0]] }).length, 1);
});

test("cards come in order.js order: per 100 g descending", () => {
  const cards = buildFoodCards(ctx());
  assert.deepEqual(ids(cards), [
    "fdc:liver",
    "fdc:carrot",
    "fdc:spinach",
    "composite:fanqie",
  ]);
});

test("a food with null for the active nutrient is not listed", () => {
  const cards = buildFoodCards(ctx());
  assert.equal(ids(cards).includes("fdc:salt"), false);
});

test("a selected food is pinned first and marked selected", () => {
  const cards = buildFoodCards(ctx({ selections: { "fdc:spinach": { grams: 200 } } }));
  assert.equal(cards[0].id, "fdc:spinach");
  assert.equal(cards[0].selected, true);
  assert.equal(cards[0].pinned, true);
  assert.equal(cards.slice(1).every((card) => card.selected === false), true);
});

test("amount text is the per 100 g amount with the nutrient's unit", () => {
  const cards = buildFoodCards(ctx());
  assert.equal(cards[0].amountText, "6502 ug RAE");
  const iron = buildFoodCards(ctx({ activeNutrient: "iron" }));
  assert.equal(iron[0].amountText, "23.3 mg");
});

test("per100gText says 无数据 only for a food without a value", () => {
  assert.equal(per100gText({ per100g: { vitA: null } }, "vitA", "ug RAE"), "无数据");
  assert.equal(per100gText({ per100g: {} }, "vitA", "ug RAE"), "无数据");
  assert.equal(per100gText({ per100g: { vitA: 0 } }, "vitA", "ug RAE"), "0 ug RAE");
});

test("the estimate badge appears only on composite dishes", () => {
  const cards = buildFoodCards(ctx());
  const composite = cards.find((card) => card.id === "composite:fanqie");
  assert.equal(composite.estimate, true);
  assert.match(foodCardHtml(composite), new RegExp(ESTIMATE_BADGE));
  assert.equal(foodCardHtml(cards[0]).includes("food-card__badge"), false);
});

test("every card is a button with aria-pressed and the food id", () => {
  const html = foodCardHtml(buildFoodCards(ctx())[0]);
  assert.match(html, /^<button type="button"/);
  assert.match(html, /data-food="fdc:liver"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /猪肝/);
  assert.match(html, /Pork liver, raw/);
  assert.match(html, /6502 ug RAE/);
});

test("a selected card is green through the shared met colours", () => {
  const card = buildFoodCards(ctx({ selections: { "fdc:liver": { grams: 100 } } }))[0];
  const html = foodCardHtml(card);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /is-selected/);
  assert.match(html, /--food-bg:#c8f2d0/);
  assert.match(html, /--food-border:#145c2a/);
});

test("food names are HTML-escaped", () => {
  const html = foodCardHtml({
    id: 'x"y',
    nameZh: "<i>a</i>",
    nameEn: 'b"c',
    amountText: "1 mg",
    estimate: false,
    selected: false,
    pinned: false,
    title: "t",
  });
  assert.equal(html.includes("<i>"), false);
  assert.match(html, /&lt;i&gt;a&lt;\/i&gt;/);
  assert.match(html, /data-food="x&quot;y"/);
});

test("60 cards are shown initially and hiddenCount reports the rest", () => {
  const many = Array.from({ length: 140 }, (_, index) => ({
    id: `fdc:${index}`,
    nameZh: `食物${index}`,
    nameEn: `Food ${index}`,
    per100g: { vitA: 1000 - index },
  }));
  const shared = { nutrients: NUTRIENTS, foods: { foods: many }, state: ctx().state, limit: DEFAULT_LIMIT };

  assert.equal(DEFAULT_LIMIT, 60);
  assert.equal(buildFoodCards(shared).length, 60);
  assert.equal(hiddenCount(shared, DEFAULT_LIMIT), 80);
  assert.equal(hiddenCount(shared, DEFAULT_LIMIT + LIMIT_STEP), 20);
  assert.equal(hiddenCount(shared, 1000), 0);
});

test("a raised limit shows the next 60 foods, still sorted", () => {
  const many = Array.from({ length: 140 }, (_, index) => ({
    id: `fdc:${index}`,
    nameZh: `食物${index}`,
    nameEn: `Food ${index}`,
    per100g: { vitA: 1000 - index },
  }));
  const shared = { nutrients: NUTRIENTS, foods: { foods: many }, state: ctx().state, limit: 120 };
  const cards = buildFoodCards(shared);
  assert.equal(cards.length, 120);
  assert.equal(cards[60].id, "fdc:60");
  assert.equal(cards[119].id, "fdc:119");
});

test("pinned foods are never hidden behind the limit", () => {
  const many = Array.from({ length: 140 }, (_, index) => ({
    id: `fdc:${index}`,
    nameZh: `食物${index}`,
    nameEn: `Food ${index}`,
    per100g: { vitA: 1000 - index },
  }));
  const shared = {
    nutrients: NUTRIENTS,
    foods: { foods: many },
    state: ctx({ selections: { "fdc:139": { grams: 50 } } }).state,
    limit: 10,
  };
  const cards = buildFoodCards(shared);
  assert.equal(cards[0].id, "fdc:139");
  assert.equal(cards[0].selected, true);
  assert.equal(cards.length, 11);
  assert.equal(hiddenCount(shared, 10), 129);
});

test("switching nutrient re-ranks around the new nutrient's values", () => {
  const iron = buildFoodCards(ctx({ activeNutrient: "iron" }));
  assert.equal(iron[0].id, "fdc:liver");
  const cards = buildFoodCards(ctx({ activeNutrient: "vitA" }));
  assert.equal(cards[0].id, "fdc:liver");
  assert.notEqual(cards[3].amountText, iron[3].amountText);
});

test("the heading names the active nutrient and the per 100 g basis", () => {
  assert.equal(foodsHeading(ctx()), "维生素A · 每 100 克含量");
  assert.equal(foodsHeading(ctx({ activeNutrient: "iron" })), "铁 · 每 100 克含量");
});

test("the show more button appears only while foods are hidden", () => {
  const cards = buildFoodCards(ctx());
  const withMore = foodsHtml(cards, { ...ctx(), more: 80 });
  assert.match(withMore, /data-more/);
  assert.match(withMore, /显示更多（\+60）/);
  assert.match(withMore, /已显示 4 种，还有 80 种/);
  assert.match(withMore, /估算/);

  const complete = foodsHtml(cards, { ...ctx(), more: 0 });
  assert.equal(complete.includes("data-more"), false);
  assert.match(complete, /共 4 种食物/);
});

test("a nutrient without any food shows the Chinese empty state", () => {
  const empty = foodsHtml([], { ...ctx(), more: 0 });
  assert.match(empty, /该营养素暂无食物数据/);
  assert.equal(empty.includes("foods__grid"), false);
});

test("buildFoodCards tolerates a missing state, food and limit", () => {
  assert.deepEqual(buildFoodCards(null), []);
  assert.deepEqual(buildFoodCards({ state: null }), []);
  assert.equal(buildFoodCards({ nutrients: NUTRIENTS, foods: FOODS_JSON, state: { activeNutrient: "" } }).length, 0);
  assert.equal(
    buildFoodCards({ nutrients: NUTRIENTS, foods: null, state: ctx().state }).length,
    0,
  );
  assert.equal(buildFoodCards(ctx({ limit: Number.NaN })).length, 4);
});

// Acceptance for P11a against the real data files: on the default Vitamin A
// tab the first card must be the food with the highest vitamin A per 100 g in
// foods.json, and exactly DEFAULT_LIMIT cards are visible before "show more".
test("against foods.json, the first Vitamin A card is the highest vitamin A food", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = async (name) =>
    JSON.parse(await readFile(new URL(`../../docs/data/${name}.json`, import.meta.url), "utf8"));
  const [realNutrients, realFoods] = await Promise.all([read("nutrients"), read("foods")]);

  const nutrient = realNutrients.nutrients.find((entry) => entry.id === "vitA");
  assert.ok(nutrient, "nutrients.json has no vitA");

  // Same rule as order.js: value descending, ties broken by nameZh.
  const ranked = realFoods.foods
    .filter((food) => typeof food.per100g?.vitA === "number" && food.per100g.vitA > 0)
    .sort((a, b) => (b.per100g.vitA - a.per100g.vitA) || (a.nameZh < b.nameZh ? -1 : a.nameZh > b.nameZh ? 1 : 0));
  assert.ok(ranked.length > DEFAULT_LIMIT, "not enough foods with vitamin A for this check");

  const cards = buildFoodCards({
    nutrients: realNutrients,
    foods: realFoods,
    limit: DEFAULT_LIMIT,
    state: {
      profile: { sex: "female", age: 30, lifeStage: "none" },
      standard: "cn2023",
      activeNutrient: "vitA",
      selections: {},
    },
  });

  assert.equal(cards.length, DEFAULT_LIMIT, "60 food cards are visible initially");
  assert.equal(cards[0].id, ranked[0].id, "first card is the highest vitamin A food");
  assert.equal(cards[0].nameZh, ranked[0].nameZh);
  assert.equal(cards[0].amountText, `${ranked[0].per100g.vitA} ${nutrient.unit}`.trim());
  // Sorted all the way down, not just at the top.
  const shown = cards.map((card) => card.id);
  assert.deepEqual(shown, ranked.slice(0, DEFAULT_LIMIT).map((food) => food.id));
});
