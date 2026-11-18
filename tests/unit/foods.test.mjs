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
import { reduce } from "../../docs/js/core/state.js";
import {
  CANCEL_LABEL,
  CONFIRM_LABEL,
  DESELECT_LABEL,
  ESTIMATE_BADGE,
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
    estimate: false,
    measures: [
      { id: "palm", labelZh: "一掌心大小", grams: 100, basis: "estimate:one palm", default: true },
      { id: "slice", labelZh: "一块", grams: 44, basis: "usda_portion:1", default: false },
    ],
  },
  {
    id: "composite:fanqie",
    nameZh: "番茄炒蛋",
    nameEn: "Tomato and egg stir-fry",
    per100g: { vitA: 66.95, iron: 0.6154 },
    estimate: true,
    measures: [{ id: "plate", labelZh: "一盘", grams: 250, basis: "estimate:one plate", default: true }],
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
  // Confirm the liver first, then the composite dish: the composite joins the
  // bottom of the pinned group although the liver contributes far more.
  let state = reduce(selCtx().state, "confirmFood", { food: SELECTION_FOODS[0] });
  state = reduce(state, "confirmFood", { food: SELECTION_FOODS[1] });
  assert.deepEqual(state.order, ["fdc:liver", "composite:fanqie"]);
  const cards = buildFoodCards({ ...selCtx(), state });
  assert.deepEqual(cards.map((card) => card.id), ["fdc:liver", "composite:fanqie"]);
  assert.equal(cards.every((card) => card.pinned), true);
});

test("the search box filters by Chinese name, alias and English name, pinned first", () => {
  const selections = { "fdc:liver": { measureId: "palm", count: 1, grams: 100 } };
  const byZh = buildFoodCards(selCtx({ selections }, { search: "炒蛋" }));
  assert.deepEqual(byZh.map((card) => card.id), ["composite:fanqie"]);

  const byEn = buildFoodCards(selCtx({}, { search: "stir-fry" }));
  assert.deepEqual(byEn.map((card) => card.id), ["composite:fanqie"]);

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
