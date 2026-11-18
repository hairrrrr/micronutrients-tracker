// Detail sheet markup helpers (phase P21c).
//
// The ranking itself is covered by detail.test.mjs (core). Here only the UI
// text and the row markup are checked: the status words, the bar width, the
// per-100 g / per-10 g amounts, the chosen-quantity line and the 查看详情
// button of the expanded tile.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DETAIL_CLOSE_LABEL,
  DETAIL_LABEL,
  DETAIL_NO_DATA_TEXT,
  DETAIL_NO_TARGET_TEXT,
  DETAIL_NOTE,
  DETAIL_QUANTITY_LABEL,
  DETAIL_ZERO_TEXT,
  barWidth,
  basisAmountText,
  detailHtml,
  detailRowHtml,
  pctLabel,
} from "../../docs/js/ui/detail.js";
import { buildFoodCards, expandedTileHtml } from "../../docs/js/ui/foods.js";

const NUTRIENTS = {
  nutrients: [
    { id: "vitA", nameZh: "维生素A", nameEn: "Vitamin A", unit: "ug RAE", color: "#f3daba", kind: "vitamin" },
    { id: "iron", nameZh: "铁", nameEn: "Iron", unit: "mg", color: "#ecd5f1", kind: "mineral" },
    { id: "choline", nameZh: "胆碱", nameEn: "Choline", unit: "mg", color: "#d7e8f7", kind: "vitamin" },
  ],
};

const TARGETS = { values: { vitA: { target: 800 }, iron: { target: 20 } } };

/** Liver-like fixture: 400 ug RAE (50 %), 0 iron, no choline value. */
const FOOD = {
  id: "fdc:test",
  nameZh: "测试食物",
  nameEn: "Test food",
  per100g: { vitA: 400, iron: 0, choline: null },
};

const rowOf = (html, id) => {
  const start = html.indexOf(`data-nutrient="${id}"`);
  assert.ok(start > 0, `row ${id} exists`);
  return html.slice(start, html.indexOf("</li>", start));
};

test("the status words replace a percentage", () => {
  assert.equal(pctLabel("ok", 12.34), "12%");
  assert.equal(pctLabel("ok", 3.456), "3.5%");
  assert.equal(pctLabel("zero", null), DETAIL_ZERO_TEXT);
  assert.equal(pctLabel("missing", null), DETAIL_NO_DATA_TEXT);
  assert.equal(pctLabel("noTarget", null), DETAIL_NO_TARGET_TEXT);
  assert.equal(DETAIL_ZERO_TEXT, "不含");
  assert.equal(DETAIL_NO_DATA_TEXT, "无数据");
  assert.equal(DETAIL_NO_TARGET_TEXT, "无参考值");
});

test("barWidth caps at 100 and never goes below 0", () => {
  assert.equal(barWidth(12.34), 12.3);
  assert.equal(barWidth(250), 100);
  assert.equal(barWidth(0), 0);
  assert.equal(barWidth(null), 0);
  assert.equal(barWidth(-3), 0);
  assert.equal(barWidth(Number.NaN), 0);
});

test("basisAmountText divides the per-100 g value by the basis", () => {
  const row = { per100g: 400, unit: "ug RAE" };
  assert.equal(basisAmountText(row, 100), "400 ug RAE");
  assert.equal(basisAmountText(row, 10), "40 ug RAE");
  assert.equal(basisAmountText({ per100g: null, unit: "mg" }, 100), "无数据");
});

test("a row shows the per-100 g amount, the bar and the percentage", () => {
  const html = detailRowHtml(
    { id: "vitA", name: "维生素A", unit: "ug RAE", per100g: 400, pct100: 50, amount: 200, pct: 25, status: "ok" },
    { color: "#f3daba" },
  );
  assert.match(html, /data-nutrient="vitA"/);
  assert.match(html, /data-status="ok"/);
  assert.match(html, /维生素A/);
  assert.match(html, /每 100 g：400 ug RAE/);
  assert.match(html, /50%/);
  assert.match(html, /width:50%;background:#f3daba/);
  // No quantity given: no 当前数量 line.
  assert.equal(html.includes(DETAIL_QUANTITY_LABEL), false);
});

test("a per-10 g food adds the per-10 g amount", () => {
  const html = detailRowHtml(
    { id: "vitA", name: "维生素A", unit: "ug RAE", per100g: 400, pct100: 50, amount: null, pct: null, status: "ok" },
    { basisG: 10 },
  );
  assert.match(html, /每 100 g：400 ug RAE/);
  assert.match(html, /每 10 g：40 ug RAE/);
});

test("a quantity adds the chosen amount with its own percentage", () => {
  const html = detailRowHtml(
    { id: "vitA", name: "维生素A", unit: "ug RAE", per100g: 400, pct100: 50, amount: 280, pct: 35, status: "ok" },
    { grams: 70, boneIn: true, refusePct: 30 },
  );
  assert.match(html, /当前数量 70 g（带骨重量，可食部约 49 g）：280 ug RAE（35%）/);
});

test("the sheet shows the note and every row of the food", () => {
  const html = detailHtml(FOOD, TARGETS, NUTRIENTS, 100);
  assert.match(html, new RegExp(DETAIL_NOTE));
  assert.equal((html.match(/class="detail-row"/g) ?? []).length, 3);
  assert.match(rowOf(html, "vitA"), /50%/);
  assert.match(rowOf(html, "iron"), new RegExp(DETAIL_ZERO_TEXT));
  assert.match(rowOf(html, "choline"), new RegExp(DETAIL_NO_DATA_TEXT));
  // A nutrient without a target for this profile says so instead of a %.
  assert.match(rowOf(html, "choline"), new RegExp(DETAIL_NO_TARGET_TEXT + "|" + DETAIL_NO_DATA_TEXT));
  // The nutrient colour of nutrients.json reaches the bar.
  assert.match(rowOf(html, "vitA"), /background:#f3daba/);
});

test("the expanded tile has a 查看详情 button next to the name", () => {
  const state = {
    activeNutrient: "vitA",
    profile: { sex: "female", age: 30, lifeStage: "none" },
    standard: "cn2023",
    selections: {},
    order: [],
  };
  const card = buildFoodCards({
    foods: { foods: [FOOD] },
    nutrients: NUTRIENTS,
    state,
    expandedId: FOOD.id,
  })[0];
  const html = expandedTileHtml(card);
  assert.match(html, /class="food-tile__title">测试食物</);
  assert.match(html, new RegExp(`data-detail="${FOOD.id}"`));
  assert.match(html, new RegExp(`aria-haspopup="dialog">${DETAIL_LABEL}<`));
  assert.match(html, /type="button"/);
  // The button sits outside the card <button>, so a click cannot toggle it.
  const buttonEnd = html.indexOf("</button>", html.indexOf("data-detail"));
  const cardStart = html.indexOf(`class="food-card food-card--expanded"`);
  assert.ok(cardStart > buttonEnd, "the detail button closes before the card button");
  assert.equal(DETAIL_CLOSE_LABEL, "关闭");
});
