// Profile panel helpers (PLAN.md 1.4, 1.8 item 2, phase P9).
//
// Only the pure text helpers are imported: `renderProfile` needs a DOM, while
// cellText/groupLabel/cellTitle work from plain objects. The real invariants
// checked here are the ones the comparison table depends on: target + unit +
// type on one line, an em dash (not "0") for a missing value, never a minus
// sign, and age-group captions including the open-ended groups.

import test from "node:test";
import assert from "node:assert/strict";

import { COLUMNS, cellAmount, cellText, cellTitle, cellType, groupLabel } from "../../docs/js/ui/profile.js";

test("COLUMNS lists China first, then the US, with Chinese toggle labels", () => {
  assert.equal(COLUMNS.length, 2);
  assert.deepEqual(
    COLUMNS.map((column) => column.standard),
    ["cn2023", "us"],
  );
  assert.equal(COLUMNS[0].toggle, "使用中国标准");
  assert.equal(COLUMNS[1].toggle, "使用美国标准");
  for (const column of COLUMNS) assert.ok(column.heading);
});

test("cellText shows target, unit and type, e.g. 800 mg (RNI)", () => {
  const reference = { target: 800, type: "RNI" };
  assert.equal(cellText(reference, "mg"), "800 mg (RNI)");
  assert.equal(cellAmount(reference, "mg"), "800 mg");
  assert.equal(cellType(reference), "RNI");
});

test("cellText applies the shared number formatting rules", () => {
  assert.equal(cellText({ target: 1234.5, type: "RNI" }, "mg"), "1235 mg (RNI)");
  assert.equal(cellText({ target: 12.34, type: "AI" }, "mg"), "12.3 mg (AI)");
  assert.equal(cellText({ target: 0.456, type: "RDA" }, "mg"), "0.46 mg (RDA)");
  assert.equal(cellText({ target: 15, type: "RDA" }, "ug"), "15 ug (RDA)");
});

test("cellText keeps multi-word units intact", () => {
  assert.equal(cellText({ target: 400, type: "RNI" }, "ug DFE"), "400 ug DFE (RNI)");
  assert.equal(cellText({ target: 12, type: "RNI" }, "mg NE"), "12 mg NE (RNI)");
  assert.equal(cellText({ target: 660, type: "RNI" }, "ug RAE"), "660 ug RAE (RNI)");
});

test("a missing target yields null so the table shows an em dash, never 0", () => {
  assert.equal(cellText(null, "mg"), null);
  assert.equal(cellText(undefined, "mg"), null);
  assert.equal(cellText({}, "mg"), null);
  assert.equal(cellText({ target: null, type: "RNI" }, "mg"), null);
  assert.equal(cellAmount({ target: null }, "mg"), null);
});

test("cellText drops the parentheses when the type is empty", () => {
  assert.equal(cellText({ target: 10 }, "ug"), "10 ug");
  assert.equal(cellText({ target: 10, type: "  " }, "ug"), "10 ug");
  assert.equal(cellType({ target: 10 }), "");
  assert.equal(cellType({ target: 10, type: "  " }), "");
});

test("cellText never emits a minus sign for a non-negative target sweep", () => {
  for (let i = 0; i <= 200; i++) {
    const target = i / 7;
    const text = cellText({ target, type: "RNI" }, "mg");
    assert.ok(!text.includes("-"), `minus in ${text}`);
  }
});

test("cellTitle reports the upper limit and the source reference", () => {
  const foodUl = cellTitle(
    { target: 800, type: "RNI", ul: 2000, ulAppliesToFood: true, ref: "CNS table 11" },
    "mg",
  );
  assert.match(foodUl, /上限（UL）2000 mg/);
  assert.match(foodUl, /CNS table 11/);
  assert.ok(!foodUl.includes("补充剂"));

  const supplementOnly = cellTitle(
    { target: 700, type: "RNI", ul: 3000, ulAppliesToFood: false, ref: "CNS table 12" },
    "ug RAE",
  );
  assert.match(supplementOnly, /仅适用于补充剂或强化剂/);

  assert.equal(cellTitle(null, "mg"), "");
  // No UL and no ref: nothing to say, so no empty tooltip.
  assert.equal(cellTitle({ target: 10, type: "AI" }, "mg"), "");
});

test("groupLabel renders closed and open-ended age ranges in Chinese", () => {
  assert.equal(groupLabel({ ageMin: 30, ageMax: 49 }), "30–49 岁");
  assert.equal(groupLabel({ ageMin: 18, ageMax: 18 }), "18–18 岁");
  assert.equal(groupLabel({ ageMin: 75, ageMax: null }), "75 岁以上");
  assert.equal(groupLabel({ ageMin: 71, ageMax: undefined }), "71 岁以上");
  assert.equal(groupLabel(null), "");
  assert.equal(groupLabel({}), "");
});
