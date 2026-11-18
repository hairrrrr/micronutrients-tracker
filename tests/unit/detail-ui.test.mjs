// Detail sheet markup helpers (phase P21c, P23: only contained nutrients).
//
// The ranking itself is covered by detail.test.mjs (core). Here only the UI
// text and the row markup are checked: the status word, the bar width, the
// per-100 g / per-10 g amounts, the chosen-quantity line, the 暂无营养素数据
// line and the 查看详情 button of the expanded tile.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DETAIL_CLOSE_LABEL,
  DETAIL_EMPTY_TEXT,
  DETAIL_LABEL,
  DETAIL_NO_TARGET_TEXT,
  DETAIL_NOTE,
  DETAIL_QUANTITY_LABEL,
  LABEL_BADGE,
  LABEL_NOTE,
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

/** Liver-like fixture: 400 ug RAE (50 %), no choline target; iron 0 and
 *  choline null get no row (P23). */
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
  assert.equal(pctLabel("noTarget", null), DETAIL_NO_TARGET_TEXT);
  assert.equal(DETAIL_NO_TARGET_TEXT, "无参考值");
  assert.equal(DETAIL_EMPTY_TEXT, "暂无营养素数据");
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

test("the sheet shows the note and only the rows of nutrients the food contains", () => {
  const html = detailHtml(FOOD, TARGETS, NUTRIENTS, 100);
  assert.match(html, new RegExp(DETAIL_NOTE));
  // vitA has 400 ug > 0; iron (0) and choline (null) get no row at all.
  assert.equal((html.match(/class="detail-row"/g) ?? []).length, 1);
  assert.match(rowOf(html, "vitA"), /50%/);
  assert.equal(html.includes('data-nutrient="iron"'), false);
  assert.equal(html.includes('data-nutrient="choline"'), false);
  assert.equal(html.includes("不含"), false);
  assert.equal(html.includes("无数据"), false);
  // The nutrient colour of nutrients.json reaches the bar.
  assert.match(rowOf(html, "vitA"), /background:#f3daba/);
});

test("a nutrient without a target shows 无参考值", () => {
  const food = { id: "fdc:test", nameZh: "测试食物", per100g: { vitA: 400, choline: 12 } };
  const html = detailHtml(food, TARGETS, NUTRIENTS, null);
  assert.equal((html.match(/class="detail-row"/g) ?? []).length, 2);
  assert.match(rowOf(html, "choline"), new RegExp(DETAIL_NO_TARGET_TEXT));
});

test("a food without any nutrient value shows one 暂无营养素数据 line", () => {
  const empty = { id: "fdc:empty", nameZh: "空食物", per100g: { vitA: 0, iron: null } };
  const html = detailHtml(empty, TARGETS, NUTRIENTS, 100);
  assert.match(html, new RegExp(DETAIL_NOTE));
  assert.equal((html.match(/class="detail-row"/g) ?? []).length, 0);
  assert.equal(html.includes('class="detail__list"'), false);
  assert.equal((html.match(new RegExp(DETAIL_EMPTY_TEXT, "g")) ?? []).length, 1);
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

// ---------------------------------------------------------------------------
// P25b: a package-label food says where its numbers come from
// ---------------------------------------------------------------------------

test("a package-label food gets the badge and the one-line origin note", () => {
  const labelFood = {
    id: "custom:powder",
    nameZh: "德运脱脂奶粉",
    nameEn: "Devondale skim milk powder",
    source: { type: "package_label", baseFdcId: 170877, estimated: ["phosphorus"] },
    per100g: { calcium: 1152 },
  };
  const html = detailHtml(labelFood, TARGETS, NUTRIENTS);
  assert.match(html, /data-label-note/);
  assert.match(html, /food-card__badge--label/);
  assert.match(html, /包装标签/);
  assert.match(html, new RegExp(LABEL_NOTE));
  // The origin line comes before the ranking note and the rows.
  assert.ok(html.indexOf("data-label-note") < html.indexOf("detail__note"));

  // A USDA food keeps the plain note only.
  const plain = detailHtml(FOOD, TARGETS, NUTRIENTS);
  assert.equal(plain.includes("包装标签"), false);
  assert.equal(plain.includes("data-label-note"), false);
  assert.match(plain, /detail__note/);

  // The note text is the one the CHANGES_PLAN asks for, word for word.
  assert.equal(LABEL_NOTE, "钙为包装标签值，其余营养素参考 USDA 同类食品估算");
  assert.equal(LABEL_BADGE, "包装标签");
});
