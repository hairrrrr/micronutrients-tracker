// Food card models (PLAN.md 1.7, 1.8 item 5, phase P11a).
//
// Only the pure helpers are imported: `renderFoods` needs a DOM, while
// `buildFoodCards` / `foodCardHtml` / `foodsHtml` / `hiddenCount` work from
// plain objects. The invariants checked here are the ones the phase's
// acceptance criteria depend on: the cards follow `order.js` (pinned first,
// then commonness first and the highest per 100 g within a tier), 60 cards
// initially with a "show more" button that adds 60, the amount text carries the
// active nutrient's unit, a 常见 badge only for commonness tiers 4-5 (P18b),
// a 带骨重量 note only on bone-in foods (P20), and every card is a button with
// `aria-pressed`.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LIMIT, LIMIT_STEP } from "../../docs/js/core/order.js";
import { reduce } from "../../docs/js/core/state.js";
import {
  BASIS_100_LABEL,
  BASIS_10_LABEL,
  CANCEL_LABEL,
  COMMON_BADGES,
  CONFIRM_LABEL,
  DESELECT_LABEL,
  BONE_NOTE,
  amountText,
  basisLabel,
  buildFoodCards,
  draftQuantity,
  expandedTileHtml,
  editorHtml,
  editorModel,
  foodArray,
  foodById,
  foodCardHtml,
  foodCellHtml,
  foodsBodyHtml,
  foodsHeading,
  foodsHtml,
  hiddenCount,
  per100gText,
  quantityHtml,
  shortNumber,
} from "../../docs/js/ui/foods.js";

const NUTRIENTS = {
  nutrients: [
    { id: "vitA", nameZh: "维生素A", nameEn: "Vitamin A", unit: "ug RAE", color: "#f3daba", kind: "vitamin" },
    { id: "iron", nameZh: "铁", nameEn: "Iron", unit: "mg", color: "#ecd5f1", kind: "mineral" },
  ],
};

const FOODS = [
  { id: "fdc:liver", nameZh: "猪肝", nameEn: "Pork liver, raw", commonness: 3, per100g: { vitA: 6502, iron: 23.3 } },
  { id: "fdc:carrot", nameZh: "胡萝卜", nameEn: "Carrots, raw", commonness: 3, per100g: { vitA: 835, iron: 0.3 } },
  { id: "fdc:spinach", nameZh: "菠菜", nameEn: "Spinach, raw", commonness: 3, per100g: { vitA: 469, iron: 2.7 } },
  { id: "fdc:salt", nameZh: "食盐", nameEn: "Salt", commonness: 3, per100g: { vitA: null, iron: 0 } },
  {
    id: "fdc:tofu",
    nameZh: "北豆腐",
    nameEn: "Firm tofu, raw",
    commonness: 3,
    per100g: { vitA: 66.95, iron: 0.6154 },
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
    "fdc:tofu",
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

test("no dish-estimate badge is rendered any more (P20)", () => {
  const cards = buildFoodCards(ctx());
  for (const card of cards) {
    assert.equal(card.estimate, undefined, `${card.id} carries no estimate flag`);
    const html = foodCardHtml(card);
    assert.equal(html.includes("估算"), false, `${card.id} has no 估算 badge`);
    assert.equal(html.includes("food-card__badge\">"), false);
  }
});

// P18b: a small 常见 badge only for commonness tiers 4-5, next to the amount.
test("the commonness badge appears only for tiers 4 and 5", () => {
  const base = {
    nameZh: "米饭",
    nameEn: "Cooked rice",
    amountText: "1.2 mg",
    selected: false,
    pinned: false,
    title: "t",
  };
  const htmlOf = (commonness) => {
    const card = { ...base, id: `fdc:${commonness}`, commonness };
    return foodCardHtml({ ...card, commonBadge: COMMON_BADGES[commonness] ?? "" });
  };

  for (const tier of [1, 2, 3]) {
    const html = htmlOf(tier);
    assert.equal(html.includes("food-card__badge--common"), false, `tier ${tier} has no badge`);
    assert.equal(html.includes("常见"), false, `tier ${tier} has no 常见 text`);
  }
  assert.match(htmlOf(4), /food-card__badge--common/);
  assert.match(htmlOf(4), /常见/);
  assert.equal(htmlOf(4).includes("★"), false);
  assert.match(htmlOf(5), /★常见/);
  // The badge never replaces the per-100 g amount.
  assert.match(htmlOf(5), /1\.2 mg/);
  // The badge model comes from the food's tier, not from the caller.
  const cards = buildFoodCards({
    ...ctx(),
    foods: {
      foods: [
        { id: "fdc:rice", nameZh: "米饭", commonness: 5, per100g: { vitA: 1 } },
        { id: "fdc:liver", nameZh: "猪肝", commonness: 3, per100g: { vitA: 2 } },
      ],
    },
  });
  assert.equal(cards.find((card) => card.id === "fdc:rice").commonBadge, "★常见");
  assert.equal(cards.find((card) => card.id === "fdc:liver").commonBadge, "");
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

test("the heading names the active nutrient and no longer claims a single basis", () => {
  assert.equal(foodsHeading(ctx()), "维生素A · 按常见度排序");
  assert.equal(foodsHeading(ctx({ activeNutrient: "iron" })), "铁 · 按常见度排序");
  // P19b: the meta text must not claim everything is per 100 g, because
  // condiments and dried goods are per 10 g.
  assert.equal(foodsHeading(ctx()).includes("每 100"), false);
  assert.equal(foodsHeading(ctx()).includes("每 10"), false);
});

test("the list heading reads 常见食物 (P19b)", () => {
  const html = foodsHtml(buildFoodCards(ctx()), { ...ctx(), more: 0 });
  assert.match(html, /<h2 class="foods__title">常见食物<\/h2>/);
  assert.equal(html.includes("食物含量排行"), false);
});

// ---------------------------------------------------------------------------
// P19b: per-10 g cards for condiments, spices, cooking oils and dried goods
// ---------------------------------------------------------------------------

const SMALL_FOOD = {
  id: "fdc:garlic",
  nameZh: "大蒜（生）",
  nameEn: "Garlic, raw",
  commonness: 5,
  amountBasisG: 10,
  per100g: { calcium: 181, vitA: 0 },
};

test("a flagged food shows the per-10 g amount with a 每 10 g label", () => {
  // 181 mg per 100 g -> 18.1 mg per 10 g, through the same number formatter.
  assert.equal(amountText(SMALL_FOOD, "calcium", "mg"), "18.1 mg");
  assert.equal(basisLabel(SMALL_FOOD), BASIS_10_LABEL);
  assert.equal(BASIS_10_LABEL, "每 10 g");

  const cards = buildFoodCards({
    nutrients: { nutrients: [{ id: "calcium", nameZh: "钙", nameEn: "Calcium", unit: "mg", color: "#cfe3f7", kind: "mineral" }] },
    foods: { foods: [SMALL_FOOD] },
    state: { activeNutrient: "calcium", selections: {}, order: [] },
  });
  const card = cards[0];
  assert.equal(card.amountText, "18.1 mg");
  assert.equal(card.basisLabel, "每 10 g");
  assert.equal(card.smallPortion, true);
  assert.equal(card.amountBasisG, 10);
  const html = foodCardHtml(card);
  assert.match(html, /18\.1 mg/);
  assert.match(html, /每 10 g/);
  assert.equal(html.includes("每 100 g"), false);
  // Both the visible label and the accessible title carry the basis.
  assert.match(card.title, /每 10 g/);
});

test("an unflagged food keeps the per-100 g amount and label", () => {
  const tofu = {
    id: "fdc:tofu",
    nameZh: "北豆腐",
    nameEn: "Firm tofu",
    commonness: 5,
    amountBasisG: 100,
    per100g: { calcium: 683 },
  };
  assert.equal(amountText(tofu, "calcium", "mg"), "683 mg");
  assert.equal(basisLabel(tofu), BASIS_100_LABEL);
  assert.equal(BASIS_100_LABEL, "每 100 g");

  // A missing basis behaves like 100 g (older data and test fixtures).
  const legacy = { ...tofu, amountBasisG: undefined };
  assert.equal(amountText(legacy, "calcium", "mg"), "683 mg");
  assert.equal(basisLabel(legacy), "每 100 g");

  const html = foodCardHtml({
    id: tofu.id,
    nameZh: tofu.nameZh,
    nameEn: tofu.nameEn,
    amountText: amountText(tofu, "calcium", "mg"),
    basisLabel: basisLabel(tofu),
    commonness: 5,
    commonBadge: "★常见",
    selected: false,
    pinned: false,
    title: "t",
  });
  assert.match(html, /每 100 g/);
  assert.equal(html.includes("每 10 g"), false);
});

test("the per-10 g card keeps a no-data food at 无数据 with its basis label", () => {
  const empty = { ...SMALL_FOOD, per100g: { calcium: null } };
  assert.equal(amountText(empty, "calcium", "mg"), "无数据");
  assert.equal(basisLabel(empty), "每 10 g");
});

test("the editor still computes a contribution from grams x per100g / 100", () => {
  // The card basis only changes how the food is compared and labelled; a
  // confirmed 12 g of garlic still adds 181 * 12 / 100 = 21.72 mg of calcium.
  const cards = buildFoodCards({
    nutrients: { nutrients: [{ id: "calcium", nameZh: "钙", nameEn: "Calcium", unit: "mg", color: "#cfe3f7", kind: "mineral" }] },
    foods: { foods: [SMALL_FOOD] },
    state: {
      activeNutrient: "calcium",
      selections: { [SMALL_FOOD.id]: { grams: 12 } },
      order: [SMALL_FOOD.id],
    },
    expandedId: SMALL_FOOD.id,
    quantity: { measureId: "grams", grams: 12 },
  });
  const card = cards[0];
  assert.equal(card.selected, true);
  assert.ok(card.editor, "the expanded tile keeps its editor");
  assert.equal(card.editor.grams, 12);
  assert.equal(card.amountText, "18.1 mg");
  assert.equal(card.basisLabel, "每 10 g");
  // The saved selection is stored in grams, untouched by the basis.
  assert.equal(card.editor.measureId, "grams");
});

test("the show more button appears only while foods are hidden", () => {
  const cards = buildFoodCards(ctx());
  const withMore = foodsHtml(cards, { ...ctx(), more: 80 });
  assert.match(withMore, /data-more/);
  assert.match(withMore, /显示更多（\+60）/);
  assert.match(withMore, /已显示 4 种，还有 80 种/);
  assert.equal(withMore.includes("按食谱"), false, "dish estimates are gone");

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

// Acceptance for P11a against the real data files, updated for P18b: on the
// default Vitamin A tab the first card follows the new rule (commonness
// descending, then vitamin A per 100 g, then nameZh) and exactly DEFAULT_LIMIT
// cards are visible before "show more".
test("against foods.json, the first Vitamin A card follows the commonness-first ranking", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = async (name) =>
    JSON.parse(await readFile(new URL(`../../docs/data/${name}.json`, import.meta.url), "utf8"));
  const [realNutrients, realFoods] = await Promise.all([read("nutrients"), read("foods")]);

  const nutrient = realNutrients.nutrients.find((entry) => entry.id === "vitA");
  assert.ok(nutrient, "nutrients.json has no vitA");

  // Same rule as order.js: commonness descending (missing = 0), then richness
  // on the comparison basis (P19b), ties broken by nameZh.
  const richness = (food) => (food.per100g.vitA * (food.amountBasisG ?? 100)) / 100;
  const ranked = realFoods.foods
    .filter((food) => typeof food.per100g?.vitA === "number" && food.per100g.vitA > 0)
    .sort((a, b) => ((b.commonness ?? 0) - (a.commonness ?? 0))
      || (richness(b) - richness(a))
      || (a.nameZh < b.nameZh ? -1 : a.nameZh > b.nameZh ? 1 : 0));
  assert.ok(ranked.length > DEFAULT_LIMIT, "not enough foods with vitamin A for this check");
  // The tiered top is what the ordering is about: an everyday food leads.
  assert.equal(ranked[0].commonness, 5, "the richest very common vitamin A food leads");

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
  assert.equal(cards[0].id, ranked[0].id, "first card follows the commonness-first ranking");
  assert.equal(cards[0].nameZh, ranked[0].nameZh);
  assert.equal(cards[0].amountText, `${ranked[0].per100g.vitA} ${nutrient.unit}`.trim());
  assert.equal(cards[0].basisLabel, "每 100 g");
  // Sorted all the way down, not just at the top.
  const shown = cards.map((card) => card.id);
  assert.deepEqual(shown, ranked.slice(0, DEFAULT_LIMIT).map((food) => food.id));
});

// ---------------------------------------------------------------------------
// P11b: selection, quantity editor and cross-tab sync
// ---------------------------------------------------------------------------

const SELECTION_FOODS = [
  {
    id: "fdc:liver",
    nameZh: "猪肝（生）",
    nameEn: "Pork, fresh, variety meats and by-products, liver, raw",
    aliases: ["猪肝"],
    per100g: { vitA: 6502, iron: 23.3 },
    measures: [
      { id: "palm", labelZh: "一掌心大小", grams: 100, basis: "estimate:one palm", default: true },
      { id: "slice", labelZh: "一块", grams: 44, basis: "usda_portion:1", default: false },
    ],
  },
  {
    id: "fdc:tofu",
    nameZh: "北豆腐",
    nameEn: "Firm tofu, raw",
    aliases: ["豆腐"],
    per100g: { vitA: 66.95, iron: 0.6154 },
    measures: [{ id: "piece", labelZh: "一块", grams: 250, basis: "estimate:one block", default: true }],
  },
];
const SELECTION_JSON = { foods: SELECTION_FOODS };

function selCtx(overrides = {}, ctxOverrides = {}) {
  return {
    ...ctxOverrides,
    nutrients: NUTRIENTS,
    foods: SELECTION_JSON,
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

test("only the expanded card carries an editor model (P17)", () => {
  const plain = buildFoodCards(selCtx());
  assert.equal(plain.every((card) => card.editor === null), true);
  assert.equal(plain.every((card) => card.expanded === false), true);

  // A pinned (selected) card is compact until it is tapped open.
  const pinnedCards = buildFoodCards(selCtx({ selections: { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } } }));
  const pinned = pinnedCards.find((card) => card.id === "fdc:liver");
  assert.equal(pinned.selected, true);
  assert.equal(pinned.expanded, false);
  assert.equal(pinned.editor, null);

  // The open tile shows the current quantity of a selected food...
  const cards = buildFoodCards(selCtx(
    { selections: { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } } },
    { expandedId: "fdc:liver" },
  ));
  const liver = cards.find((card) => card.id === "fdc:liver");
  assert.equal(liver.selected, true);
  assert.equal(liver.expanded, true);
  assert.equal(liver.editor.measureId, "palm");
  assert.equal(liver.editor.count, 1);
  assert.equal(liver.editor.grams, 100);
  assert.equal(liver.editor.manual, false);

  // ... and the draft quantity of an unselected one, without marking it selected.
  const draft = buildFoodCards(selCtx({}, { expandedId: "fdc:liver", quantity: { measureId: "slice", count: 2 } }));
  const opened = draft.find((card) => card.id === "fdc:liver");
  assert.equal(opened.selected, false);
  assert.equal(opened.expanded, true);
  assert.equal(opened.editor.grams, 88);
});

test("draftQuantity starts at the default measure x1 or the saved quantity", () => {
  assert.deepEqual(draftQuantity(SELECTION_FOODS[0], null), { measureId: "palm", count: 1, grams: 100 });
  assert.deepEqual(
    draftQuantity(SELECTION_FOODS[0], { measureId: "slice", count: 0.5, grams: 22 }),
    { measureId: "slice", count: 0.5, grams: 22 },
  );
  // A food without a measure row starts at 100 g.
  assert.deepEqual(draftQuantity({ id: "x", measures: [] }, null), { measureId: "grams", count: 0, grams: 100 });
});

test("editor model lists household measures plus 克, with per-unit weights", () => {
  const model = editorModel(SELECTION_FOODS[0], { measureId: "palm", count: 1, grams: 100 });
  assert.deepEqual(model.options.map((option) => option.id), ["palm", "slice", "grams"]);
  assert.equal(model.options[0].label, "一掌心大小（100 g）");
  assert.equal(model.options[1].label, "一块（44 g）");
  assert.equal(model.options[2].label, "克");
  assert.equal(model.options[2].manual, true);
  assert.equal(model.options[0].selected, true);
});

test("editor model marks the manual gram option and formats the weight", () => {
  const model = editorModel(SELECTION_FOODS[0], { measureId: "grams", count: 0, grams: 28 });
  assert.equal(model.manual, true);
  assert.equal(model.gramsText, "约 28 g");
  assert.equal(model.options.find((option) => option.manual).selected, true);
  // Half a slice: the computed weight follows the count, not the selected id.
  const half = editorModel(SELECTION_FOODS[0], { measureId: "slice", count: 0.5 });
  assert.equal(half.grams, 22);
  assert.equal(half.countText, "0.5");
  assert.equal(half.gramsText, "约 22 g");
});

test("editor model tolerates a missing selection and a food without measures", () => {
  const fallback = editorModel(SELECTION_FOODS[0], undefined);
  assert.equal(fallback.measureId, "palm");
  assert.equal(fallback.count, 1);
  const bare = editorModel({ id: "x", measures: [] }, { measureId: "grams", grams: 50 });
  assert.deepEqual(bare.options.map((option) => option.id), ["grams"]);
  assert.equal(bare.gramsText, "约 50 g");
});

test("the editor markup has a select, a stepper and 克, and never nests in the button", () => {
  const card = buildFoodCards(selCtx(
    { selections: { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } } },
    { expandedId: "fdc:liver" },
  )).find((entry) => entry.id === "fdc:liver");
  const editor = editorHtml(card);
  assert.match(editor, /<select[^>]*data-measure/);
  assert.match(editor, /data-step="-1"/);
  assert.match(editor, /data-step="1"/);
  assert.match(editor, /约 100 g/);
  assert.match(editor, /家庭计量为估算值/);
  assert.match(editor, /<option value="grams"/);

  // The cell keeps the editor outside the card <button>, so no click inside it
  // can toggle the card (PLAN.md 1.8 item 5) and the tile's check/confirm
  // buttons are not nested in it either.
  const cell = foodCellHtml(card);
  const buttonEnd = cell.indexOf("</button>");
  assert.ok(buttonEnd > 0, "the card is a button");
  assert.ok(cell.indexOf('class="food-editor"') > buttonEnd, "the editor sits after the card button");
  assert.equal(/<button[^>]*>[^]*data-measure/.test(cell.slice(cell.indexOf("<button"), buttonEnd)), false);

  // A manual gram amount swaps the stepper for a gram input.
  const manualCard = buildFoodCards(selCtx(
    { selections: { "fdc:liver": { measureId: "grams", count: 0, grams: 28 } } },
    { expandedId: "fdc:liver" },
  )).find((entry) => entry.id === "fdc:liver");
  const manualHtml = editorHtml(manualCard);
  assert.match(manualHtml, /type="number"/);
  assert.match(manualHtml, /data-grams/);
  assert.equal(manualHtml.includes("data-step"), false);
  // The note about household measures only makes sense with a household measure.
  assert.equal(manualHtml.includes("家庭计量为估算值"), false);
});

test("an expanded tile has the round check, 确认, 取消 and a deselect for a pinned food", () => {
  const context = selCtx(
    { selections: { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } } },
    { expandedId: "fdc:liver" },
  );
  const card = buildFoodCards(context).find((entry) => entry.id === "fdc:liver");
  const html = expandedTileHtml(card);
  assert.match(html, /class="food-tile__check"[^>]*data-confirm="fdc:liver"[^>]*aria-label="确认"/);
  assert.match(html, /✓/);
  assert.match(html, new RegExp(`data-confirm="fdc:liver"[^>]*>${CONFIRM_LABEL}`));
  assert.match(html, new RegExp(`>${DESELECT_LABEL}<`));
  assert.match(html, new RegExp(`data-cancel="fdc:liver">${CANCEL_LABEL}<`));
  assert.match(html, /猪肝（生）/);
  assert.match(html, /6502 ug RAE/);
  assert.match(html, /is-selected/);

  // An unselected tile confirms from the draft and has no deselect control.
  const draft = buildFoodCards(selCtx({}, { expandedId: "fdc:liver" }))
    .find((entry) => entry.id === "fdc:liver");
  const draftHtml = expandedTileHtml(draft);
  assert.match(draftHtml, new RegExp(`data-confirm="fdc:liver"[^>]*>${CONFIRM_LABEL}`));
  assert.equal(draftHtml.includes("data-deselect"), false);
  // It is not green yet: nothing is selected before the confirm.
  assert.equal(draftHtml.includes("is-selected"), false);

  // The cell of the expanded tile spans the row through CSS and is marked.
  const cell = foodCellHtml(draft);
  assert.match(cell, /class="food-cell food-cell--expanded"/);
  assert.match(cell, /data-expanded="true"/);
});

test("quantityHtml renders the stepper or the gram input", () => {
  const stepper = quantityHtml(editorModel(SELECTION_FOODS[0], { measureId: "palm", count: 1.5 }));
  assert.match(stepper, /data-step="-1"/);
  assert.match(stepper, /data-count>1.5</);
  const grams = quantityHtml(editorModel(SELECTION_FOODS[0], { measureId: "grams", grams: 28 }));
  assert.match(grams, /data-grams/);
  assert.match(grams, /value="28"/);
});

test("editorHtml returns nothing for an unselected card", () => {
  assert.equal(editorHtml({ id: "x", editor: null }), "");
  assert.equal(editorHtml({}), "");
});

test("selected foods stay pinned across nutrient tabs (cross-tab sync)", () => {
  const selections = { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } };
  for (const nutrientId of ["vitA", "iron"]) {
    const cards = buildFoodCards(selCtx({ activeNutrient: nutrientId, selections }));
    assert.equal(cards[0].id, "fdc:liver", nutrientId);
    assert.equal(cards[0].selected, true);
    // Compact via the shared card, and showing the saved quantity when opened.
    const opened = buildFoodCards({
      ...selCtx({ activeNutrient: nutrientId, selections }, { expandedId: "fdc:liver" }),
    });
    assert.equal(opened[0].editor.grams, 100);
  }
});

test("selection state flows through state.js and changes the contributions", () => {
  let state = { ...selCtx().state };
  state = reduce(state, "confirmFood", { food: SELECTION_FOODS[0] });
  assert.deepEqual(state.selections["fdc:liver"], { measureId: "palm", count: 1, grams: 100 });
  assert.deepEqual(state.order, ["fdc:liver"]);

  const cards = buildFoodCards({ ...selCtx(), state });
  assert.equal(cards[0].id, "fdc:liver");

  // A quantity change re-renders the editor; the pinned position is kept.
  state = reduce(state, "confirmFood", {
    food: SELECTION_FOODS[0],
    quantity: { measureId: "slice", count: 2 },
  });
  assert.deepEqual(state.selections["fdc:liver"], { measureId: "slice", count: 2, grams: 88 });
  assert.deepEqual(state.order, ["fdc:liver"]);
  const updated = buildFoodCards({ ...selCtx(), state, expandedId: "fdc:liver" });
  assert.equal(updated[0].editor.grams, 88);
  assert.equal(updated[0].editor.gramsText, "约 88 g");

  // 取消选择 removes it and its editor.
  state = reduce(state, "removeFood", { foodId: "fdc:liver" });
  assert.deepEqual(state.selections, {});
  assert.deepEqual(state.order, []);
  assert.equal(buildFoodCards({ ...selCtx(), state }).some((card) => card.editor), false);
});

test("a newly confirmed food is the last pinned card (confirmation order)", () => {
  // Confirm the liver first, then the tofu: the tofu joins the bottom of the
  // pinned group although the liver contributes far more.
  let state = reduce(selCtx().state, "confirmFood", { food: SELECTION_FOODS[0] });
  state = reduce(state, "confirmFood", { food: SELECTION_FOODS[1] });
  assert.deepEqual(state.order, ["fdc:liver", "fdc:tofu"]);
  const cards = buildFoodCards({ ...selCtx(), state });
  assert.deepEqual(cards.map((card) => card.id), ["fdc:liver", "fdc:tofu"]);
  assert.equal(cards.every((card) => card.pinned), true);
});

test("the search box filters by Chinese name, alias and English name, pinned first", () => {
  const selections = { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } };
  const byZh = buildFoodCards(selCtx({ selections }, { search: "豆腐" }));
  assert.deepEqual(byZh.map((card) => card.id), ["fdc:tofu"]);

  const byEn = buildFoodCards(selCtx({}, { search: "firm tofu" }));
  assert.deepEqual(byEn.map((card) => card.id), ["fdc:tofu"]);

  const byAlias = buildFoodCards(selCtx({ selections }, { search: "猪肝" }));
  assert.equal(byAlias[0].id, "fdc:liver");
  assert.equal(byAlias[0].pinned, true);

  // Case-insensitive English search.
  assert.equal(buildFoodCards(selCtx({}, { search: "PORK" }))[0].id, "fdc:liver");
  // Searching a name that only the pinned food matches keeps it first.
  const pinnedOnly = buildFoodCards(selCtx({ selections }, { search: "liver" }));
  assert.deepEqual(pinnedOnly.map((card) => card.id), ["fdc:liver"]);
  // No match: empty list, and the section shows the Chinese empty state.
  const none = buildFoodCards(selCtx({}, { search: "zzz" }));
  assert.deepEqual(none, []);
  assert.match(foodsBodyHtml(none, { ...selCtx(), more: 0, search: "zzz" }), /没有匹配的食物/);
  // An empty search shows everything again.
  assert.equal(buildFoodCards(selCtx({}, { search: "   " })).length, SELECTION_FOODS.length);
});

test("hiddenCount follows the search filter", () => {
  const many = Array.from({ length: 140 }, (_, index) => ({
    id: `fdc:${index}`,
    nameZh: index % 2 === 0 ? `肝脏${index}` : `水果${index}`,
    nameEn: `Food ${index}`,
    per100g: { vitA: 1000 - index },
  }));
  const shared = { nutrients: NUTRIENTS, foods: { foods: many }, state: selCtx().state, limit: 10 };
  assert.equal(hiddenCount(shared, 10), 130);
  assert.equal(hiddenCount(shared, 10, "肝脏"), 60);
  assert.equal(hiddenCount(shared, 1000, "肝脏"), 0);
});

test("the section renders a search box and the open tile's editor for a tapped food", () => {
  const selected = selCtx(
    { selections: { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } } },
    { expandedId: "fdc:liver" },
  );
  const html = foodsHtml(buildFoodCards(selected), { ...selected, more: 0 });
  assert.match(html, /data-food-search/);
  assert.match(html, /搜索食物/);
  assert.match(html, /data-food-body/);
  assert.match(html, /data-food-tile="fdc:liver"/);
  assert.match(html, /data-food-editor="fdc:liver"/);
  assert.match(html, /--food-border:#145c2a/);
  // A pinned card that is not open stays a compact card with no editor.
  const closed = foodsHtml(buildFoodCards(selCtx({ selections: { "fdc:liver": { grams: 100 } } })), { more: 0 });
  assert.equal(closed.includes("data-food-editor"), false);
  assert.match(closed, /food-cell food-cell--selected/);
});

test("shortNumber drops trailing float noise", () => {
  assert.equal(shortNumber(1), "1");
  assert.equal(shortNumber(1.5), "1.5");
  assert.equal(shortNumber(28), "28");
  assert.equal(shortNumber(13.5), "13.5");
  assert.equal(shortNumber(Number.NaN), "0");
});

test("foodById finds a food and tolerates junk", () => {
  assert.equal(foodById(SELECTION_JSON, "fdc:liver").nameZh, "猪肝（生）");
  assert.equal(foodById(SELECTION_FOODS, "nope"), null);
  assert.equal(foodById(null, "fdc:liver"), null);
  assert.equal(foodById(SELECTION_JSON, ""), null);
});
