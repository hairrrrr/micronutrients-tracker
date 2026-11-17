// Target card models (PLAN.md 1.6, 1.8 item 3, phase P10).
//
// Only the pure helpers are imported: `renderTargets` needs a DOM, while
// `buildTargetCards` / `cardHtml` work from plain objects. The invariants
// checked here are the ones the phase's acceptance criteria depend on:
// no selections -> every card says "还差 <target>", the background is the
// nutrient colour and no card is green; reached targets turn green; over-UL
// adds the warning and the red outline; a missing target never turns green.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTargetCards, cardHtml, standardLabel, summaryText } from "../../docs/js/ui/targets.js";
import { MET_COLORS } from "../../docs/js/core/nutrients.js";

const NUTRIENTS = {
  nutrients: [
    { id: "vitA", nameZh: "维生素A", nameEn: "Vitamin A", unit: "ug RAE", color: "#f3daba", kind: "vitamin" },
    { id: "iron", nameZh: "铁", nameEn: "Iron", unit: "mg", color: "#ecd5f1", kind: "mineral" },
    { id: "vitK", nameZh: "维生素K", nameEn: "Vitamin K", unit: "ug", color: "#c9ede1", kind: "vitamin" },
  ],
};

const DRI = {
  standards: {
    cn2023: {
      label: "中国 2023",
      groups: [
        {
          id: "cn-f-30-49",
          sex: "female",
          ageMin: 30,
          ageMax: 49,
          lifeStage: "none",
          values: {
            vitA: { target: 660, type: "RNI", ul: 3000, ulAppliesToFood: false },
            iron: { target: 18, type: "RNI", ul: 42, ulAppliesToFood: true },
            vitK: { target: 80, type: "AI", ul: null, ulAppliesToFood: null },
          },
        },
      ],
    },
  },
};

const FOODS = {
  "fdc:1": { id: "fdc:1", per100g: { vitA: 1000, iron: 1, vitK: null } },
  "fdc:2": { id: "fdc:2", per100g: { vitA: 2000, iron: 20, vitK: 40 } },
};

function ctx(overrides = {}) {
  return {
    nutrients: NUTRIENTS,
    dri: DRI,
    foodsById: FOODS,
    state: {
      profile: { sex: "female", age: 30, lifeStage: "none" },
      standard: "cn2023",
      activeNutrient: "vitA",
      selections: {},
      ...overrides,
    },
  };
}

function byId(cards, id) {
  return cards.find((card) => card.id === id);
}

test("buildTargetCards returns one card per nutrient in data order", () => {
  const cards = buildTargetCards(ctx());
  assert.deepEqual(cards.map((card) => card.id), ["vitA", "iron", "vitK"]);
  assert.equal(cards[0].nameZh, "维生素A");
  assert.equal(cards[0].unit, "ug RAE");
  assert.equal(cards[0].targetText, "660 ug RAE");
});

test("no selections: every card still needs the full target and none is green", () => {
  const cards = buildTargetCards(ctx());
  for (const card of cards) {
    assert.equal(card.hasTarget, true);
    assert.match(card.text, /^还差 /);
    assert.equal(card.met, false);
    assert.equal(card.overUL, false);
    assert.equal(card.percent, 0);
    assert.notEqual(card.colors.background, MET_COLORS.background);
  }
  assert.equal(byId(cards, "vitA").text, "还差 660 ug RAE");
  assert.equal(byId(cards, "iron").text, "还差 18 mg");
  assert.equal(byId(cards, "vitK").text, "还差 80 ug");
});

test("the card background is the nutrient colour while not met", () => {
  const cards = buildTargetCards(ctx());
  assert.equal(byId(cards, "vitA").colors.background, "#f3daba");
  assert.equal(byId(cards, "iron").colors.background, "#ecd5f1");
  assert.equal(byId(cards, "vitA").colors.border, "transparent");
});

test("intake from selections moves the card and can reach the target", () => {
  // 100 g of fdc:2 -> vitA 2000 of 660 (surplus), iron 20 of 18 (met)
  const cards = buildTargetCards(ctx({ selections: { "fdc:2": { grams: 100 } } }));
  const vitA = byId(cards, "vitA");
  assert.equal(vitA.met, true);
  assert.equal(vitA.text, "+1340 ug RAE");
  assert.equal(vitA.percent, 100);
  assert.equal(vitA.colors.background, MET_COLORS.background);
  assert.equal(vitA.colors.border, MET_COLORS.border);

  const iron = byId(cards, "iron");
  assert.equal(iron.met, true);
  assert.equal(iron.text, "+2 mg");
});

test("exactly at the target shows 已达标 and the green background", () => {
  // 66 g of fdc:1 -> vitA 660 exactly
  const cards = buildTargetCards(ctx({ selections: { "fdc:1": { grams: 66 } } }));
  const vitA = byId(cards, "vitA");
  assert.equal(vitA.text, "已达标");
  assert.equal(vitA.met, true);
  assert.equal(vitA.percent, 100);
});

test("overUL adds the warning, but only when the UL covers food", () => {
  // 100 g of fdc:2 -> iron 20 mg (UL 42, not over); make it big with 300 g.
  const cards = buildTargetCards(ctx({ selections: { "fdc:2": { grams: 300 } } }));
  const iron = byId(cards, "iron");
  assert.equal(iron.met, true);
  assert.equal(iron.overUL, true);
  assert.equal(iron.ulText, "42 mg");
  assert.match(iron.text, /^\+/);

  const html = cardHtml(iron);
  assert.match(html, /is-over/);
  assert.match(html, /超过上限 42 mg/);

  // Vitamin A's UL is supplement-only for CN, so a huge intake must not warn.
  const vitA = byId(cards, "vitA");
  assert.equal(vitA.intake > 3000, true);
  assert.equal(vitA.overUL, false);
  assert.doesNotMatch(cardHtml(vitA), /超过上限/);
});

test("a missing target shows 无参考值 and never turns green", () => {
  const sparse = {
    standards: {
      cn2023: {
        groups: [
          { id: "g", sex: "female", ageMin: 18, ageMax: 49, lifeStage: "none", values: { vitA: { target: 660 } } },
        ],
      },
    },
  };
  const cards = buildTargetCards({ ...ctx({ selections: { "fdc:2": { grams: 500 } } }), dri: sparse });
  const iron = byId(cards, "iron");
  assert.equal(iron.hasTarget, false);
  assert.equal(iron.text, "无参考值");
  assert.equal(iron.targetText, "—");
  assert.equal(iron.met, false);
  assert.equal(iron.percent, 0);
  assert.notEqual(iron.colors.background, MET_COLORS.background);
});

test("a profile without a matching DRI group leaves every card without a target", () => {
  const cards = buildTargetCards(ctx({ profile: { sex: "male", age: 30, lifeStage: "none" } }));
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.equal(card.hasTarget, false);
    assert.equal(card.text, "无参考值");
  }
});

test("cardHtml marks the active card and carries the inline colours", () => {
  const cards = buildTargetCards(ctx());
  const html = cardHtml(byId(cards, "vitA"));
  assert.match(html, /^<button type="button"/);
  assert.match(html, /class="target-card is-active"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /data-nutrient="vitA"/);
  assert.match(html, /--card-bg:#f3daba/);
  assert.match(html, /width:0%/);

  const iron = cardHtml(byId(cards, "iron"));
  assert.doesNotMatch(iron, /is-active/);
  assert.match(iron, /aria-pressed="false"/);
});

test("card text never contains a minus sign", () => {
  for (const grams of [0, 1, 12.5, 66, 100, 250, 900]) {
    for (const card of buildTargetCards(ctx({ selections: { "fdc:1": { grams } } }))) {
      assert.doesNotMatch(card.text, /-\d/);
      assert.doesNotMatch(cardHtml(card), /-\d/);
    }
  }
});

test("summaryText names the standard, profile and met count", () => {
  const quiet = ctx();
  const cards = buildTargetCards(quiet);
  assert.equal(summaryText(cards, quiet), "中国 2023 · 女 30 岁 · 已达标 0/3");

  const loaded = ctx({ selections: { "fdc:2": { grams: 300 } } });
  const metCards = buildTargetCards(loaded);
  assert.equal(summaryText(metCards, loaded), "中国 2023 · 女 30 岁 · 已达标 3/3 · 超上限 1");
});

test("standardLabel falls back to the profile panel headings", () => {
  assert.equal(standardLabel("cn2023"), "中国 2023");
  assert.equal(standardLabel("us"), "美国");
  assert.equal(standardLabel("other"), "");
});

test("buildTargetCards tolerates a bare nutrient array and missing inputs", () => {
  const cards = buildTargetCards({
    nutrients: NUTRIENTS.nutrients,
    dri: DRI,
    foodsById: FOODS,
    state: ctx().state,
  });
  assert.equal(cards.length, 3);
  assert.deepEqual(buildTargetCards(null), []);
  assert.deepEqual(buildTargetCards({ nutrients: NUTRIENTS, dri: DRI }), []);
});
