// Nutrient chip row (PLAN.md 1.8 item 4, phase P11a).
//
// Only the pure helpers are imported: `renderTabs` needs a DOM, while
// `buildTabs` / `tabHtml` / `tabsHtml` work from plain objects. The invariants
// checked here are the ones the phase depends on: one chip per nutrient in data
// order, exactly one active chip, the active chip carries its nutrient colour
// and `aria-pressed="true"`, the row is a scrollable group, and a nutrient
// without a usable colour falls back to the neutral one instead of the "met"
// green.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTabs, tabBackground, tabHtml, tabsHtml } from "../../docs/js/ui/tabs.js";
import { FALLBACK_COLOR, MET_COLORS } from "../../docs/js/core/nutrients.js";

const NUTRIENTS = {
  nutrients: [
    { id: "vitA", nameZh: "维生素A", nameEn: "Vitamin A", unit: "ug RAE", color: "#f3daba", kind: "vitamin" },
    { id: "vitC", nameZh: "维生素C", nameEn: "Vitamin C", unit: "mg", color: "#f8d5d1", kind: "vitamin" },
    { id: "iron", nameZh: "铁", nameEn: "Iron", unit: "mg", color: "#ecd5f1", kind: "mineral" },
    { id: "zinc", nameZh: "锌", nameEn: "Zinc", unit: "mg", kind: "mineral" },
  ],
};

const STATE = { activeNutrient: "vitC" };

test("buildTabs returns one chip per nutrient in data order", () => {
  const tabs = buildTabs(NUTRIENTS, STATE);
  assert.deepEqual(tabs.map((tab) => tab.id), ["vitA", "vitC", "iron", "zinc"]);
  assert.deepEqual(tabs.map((tab) => tab.nameZh), ["维生素A", "维生素C", "铁", "锌"]);
});

test("exactly one chip is active and it is the state's active nutrient", () => {
  const tabs = buildTabs(NUTRIENTS, STATE);
  assert.deepEqual(tabs.filter((tab) => tab.active).map((tab) => tab.id), ["vitC"]);
  assert.equal(tabs.filter((tab) => tab.active).length, 1);
});

test("the active chip carries its own nutrient colour, inactive chips none", () => {
  const tabs = buildTabs(NUTRIENTS, STATE);
  const active = tabs.find((tab) => tab.id === "vitC");
  const other = tabs.find((tab) => tab.id === "vitA");
  assert.equal(active.color, "#f8d5d1");
  assert.equal(active.background, "#f8d5d1");
  assert.equal(other.background, "");
});

test("tabBackground only paints the active chip", () => {
  assert.equal(tabBackground("#f3daba", true), "#f3daba");
  assert.equal(tabBackground("#f3daba", false), "");
  assert.equal(tabBackground(FALLBACK_COLOR, false), "");
});

test("a nutrient without a colour gets the neutral fallback, never the met green", () => {
  const tabs = buildTabs(NUTRIENTS, { activeNutrient: "zinc" });
  const zinc = tabs.find((tab) => tab.id === "zinc");
  assert.equal(zinc.color, FALLBACK_COLOR);
  assert.notEqual(zinc.color, MET_COLORS.background);

  const sneaky = {
    nutrients: [{ id: "weird", nameZh: "怪", color: MET_COLORS.background }],
  };
  assert.equal(buildTabs(sneaky, { activeNutrient: "weird" })[0].color, FALLBACK_COLOR);
});

test("an unknown active nutrient leaves every chip inactive", () => {
  const tabs = buildTabs(NUTRIENTS, { activeNutrient: "nope" });
  assert.equal(tabs.filter((tab) => tab.active).length, 0);
  assert.ok(tabs.every((tab) => tab.background === ""));
});

test("a bare nutrients array and a missing state are both tolerated", () => {
  const tabs = buildTabs(NUTRIENTS.nutrients, undefined);
  assert.equal(tabs.length, 4);
  assert.equal(buildTabs(null, STATE).length, 0);
});

test("each chip is a button with aria-pressed and a data-nutrient", () => {
  const [active] = buildTabs(NUTRIENTS, STATE).filter((tab) => tab.active);
  const html = tabHtml(active);
  assert.match(html, /^<button type="button"/);
  assert.match(html, /class="tab is-active"/);
  assert.match(html, /data-nutrient="vitC"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /--tab-bg:#f8d5d1/);

  const inactive = tabHtml(buildTabs(NUTRIENTS, STATE)[0]);
  assert.match(inactive, /aria-pressed="false"/);
  assert.equal(inactive.includes("--tab-bg"), false);
});

test("chip names are HTML-escaped", () => {
  const html = tabHtml({
    id: "x",
    nameZh: '<b>"A"&</b>',
    color: "#ffffff",
    background: "",
    active: false,
    title: "t",
  });
  assert.equal(html.includes("<b>"), false);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /&quot;A&quot;&amp;/);
});

test("tabsHtml wraps the chips in a labelled, scrollable group", () => {
  const html = tabsHtml(buildTabs(NUTRIENTS, STATE));
  assert.match(html, /role="group"/);
  assert.match(html, /class="tabs__row"/);
  assert.match(html, /aria-label="选择营养素"/);
  assert.equal((html.match(/data-nutrient=/g) ?? []).length, 4);
});

test("an empty nutrient list renders the Chinese empty state, not a broken row", () => {
  const html = tabsHtml([]);
  assert.equal(html.includes("tabs__row"), false);
  assert.match(html, /暂无营养素数据/);
});
