// Nutrient metadata helpers (PLAN.md 1.2/1.6/1.8, phase P8).
//
// Tiny in-test fixture with three nutrients; one of them deliberately claims
// the "met" green so the fallback can be checked.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MET_COLORS,
  FALLBACK_COLOR,
  nutrientList,
  nutrientIds,
  nutrientIndex,
  getNutrient,
  isKnownNutrient,
  unitOf,
  nameZhOf,
  nameEnOf,
  colorOf,
  byKind,
  cardColors,
} from "../../docs/js/core/nutrients.js";

const NUTRIENTS = {
  source: { name: "fixture" },
  nutrients: [
    {
      id: "vitA",
      nameZh: "维生素A",
      nameEn: "Vitamin A",
      unit: "ug RAE",
      usdaNutrientIds: [1106],
      color: "#f3daba",
      kind: "vitamin",
      note: "fixture",
    },
    {
      id: "niacin",
      nameZh: "烟酸",
      nameEn: "Niacin",
      unit: "mg NE",
      usdaNutrientIds: [1167, 1210],
      color: "#f6d5d0",
      kind: "vitamin",
      note: "fixture",
    },
    {
      id: "iron",
      nameZh: "铁",
      nameEn: "Iron",
      unit: "mg",
      usdaNutrientIds: [1089],
      // Same value as the "met" green: must never be used as a card color.
      color: MET_COLORS.background,
      kind: "mineral",
      note: "fixture",
    },
  ],
};

test("nutrientList accepts the payload object, a bare array or nothing", () => {
  assert.equal(nutrientList(NUTRIENTS).length, 3);
  assert.equal(nutrientList(NUTRIENTS.nutrients).length, 3);
  assert.deepEqual(nutrientList(null), []);
  assert.deepEqual(nutrientList({}), []);
  assert.deepEqual(nutrientList("x"), []);
  // Null holes in an array are skipped.
  assert.equal(nutrientList([NUTRIENTS.nutrients[0], null]).length, 1);
});

test("nutrientIds and nutrientIndex follow the data order", () => {
  assert.deepEqual(nutrientIds(NUTRIENTS), ["vitA", "niacin", "iron"]);
  const index = nutrientIndex(NUTRIENTS);
  assert.deepEqual([...index.keys()], ["vitA", "niacin", "iron"]);
  assert.equal(index.get("niacin").unit, "mg NE");
  // A duplicate id keeps the first entry.
  const dupes = { nutrients: [NUTRIENTS.nutrients[0], { ...NUTRIENTS.nutrients[0], unit: "other" }] };
  assert.equal(nutrientIndex(dupes).get("vitA").unit, "ug RAE");
});

test("getNutrient / isKnownNutrient handle unknown ids safely", () => {
  assert.equal(getNutrient(NUTRIENTS, "vitA").nameZh, "维生素A");
  assert.equal(getNutrient(NUTRIENTS, "nope"), null);
  assert.equal(getNutrient(NUTRIENTS, ""), null);
  assert.equal(getNutrient(NUTRIENTS, null), null);
  assert.equal(isKnownNutrient(NUTRIENTS, "iron"), true);
  assert.equal(isKnownNutrient(NUTRIENTS, "iodine"), false);
});

test("unit, Chinese name and English name lookups", () => {
  assert.equal(unitOf(NUTRIENTS, "vitA"), "ug RAE");
  assert.equal(unitOf(NUTRIENTS, "niacin"), "mg NE");
  assert.equal(unitOf(NUTRIENTS, "nope"), "");
  assert.equal(unitOf(NUTRIENTS, "nope", "g"), "g");
  assert.equal(nameZhOf(NUTRIENTS, "iron"), "铁");
  // An unknown nutrient falls back to the id, so a card is never blank.
  assert.equal(nameZhOf(NUTRIENTS, "iodine"), "iodine");
  assert.equal(nameZhOf(NUTRIENTS, "iodine", "未知"), "未知");
  assert.equal(nameEnOf(NUTRIENTS, "niacin"), "Niacin");
  assert.equal(nameEnOf(NUTRIENTS, "nope"), "");
});

test("colorOf never returns the 'met' green and validates the hex value", () => {
  assert.equal(colorOf(NUTRIENTS, "vitA"), "#f3daba");
  // The iron row stores the met green: the helper must refuse it.
  assert.equal(colorOf(NUTRIENTS, "iron"), FALLBACK_COLOR);
  assert.equal(colorOf(NUTRIENTS, "nope"), FALLBACK_COLOR);
  assert.equal(colorOf({ nutrients: [{ id: "x", color: "red" }] }, "x"), FALLBACK_COLOR);
  assert.equal(colorOf({ nutrients: [{ id: "x", color: "#ABCDEF" }] }, "x"), "#abcdef");
  // The one green the plan allows for the met state is not a nutrient color.
  assert.equal(MET_COLORS.background, "#c8f2d0");
});

test("byKind splits vitamins from minerals", () => {
  const { vitamins, minerals } = byKind(NUTRIENTS);
  assert.deepEqual(vitamins.map((nutrient) => nutrient.id), ["vitA", "niacin"]);
  assert.deepEqual(minerals.map((nutrient) => nutrient.id), ["iron"]);
  assert.deepEqual(byKind([]), { vitamins: [], minerals: [] });
  assert.deepEqual(byKind(null), { vitamins: [], minerals: [] });
});

test("cardColors uses the nutrient color, or the met green when reached", () => {
  const normal = cardColors(NUTRIENTS, "vitA", false);
  assert.equal(normal.background, "#f3daba");
  assert.equal(normal.text, "#1f2328");

  const met = cardColors(NUTRIENTS, "vitA", true);
  assert.deepEqual(met, {
    background: MET_COLORS.background,
    border: MET_COLORS.border,
    text: MET_COLORS.text,
  });
  // Even an unknown nutrient gets the green when the target is met (a missing
  // target keeps `met` false, so this cannot happen for a "no reference" card).
  assert.equal(cardColors(NUTRIENTS, "nope", true).background, MET_COLORS.background);
  assert.equal(cardColors(NUTRIENTS, "nope", false).background, FALLBACK_COLOR);
});

test("the real nutrients.json has the 22 planned nutrients with unique colors", async () => {
  const { readFile } = await import("node:fs/promises");
  const payload = JSON.parse(await readFile(new URL("../../docs/data/nutrients.json", import.meta.url), "utf8"));
  const ids = nutrientIds(payload);
  assert.equal(ids.length, 22);
  assert.equal(new Set(ids).size, 22);
  const colors = nutrientList(payload).map((nutrient) => colorOf(payload, nutrient.id));
  assert.equal(new Set(colors).size, 22);
  assert.equal(colors.includes(MET_COLORS.background), false);
  // Every nutrient has a Chinese name, a unit and an English name for the UI.
  for (const id of ids) {
    assert.notEqual(nameZhOf(payload, id), "");
    assert.notEqual(unitOf(payload, id), "");
    assert.notEqual(nameEnOf(payload, id), "");
  }
});
