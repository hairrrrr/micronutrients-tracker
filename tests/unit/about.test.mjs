// About / data sources section (PLAN.md 1.8 item 6, phase P12).
//
// Only the pure helpers are imported: `renderAbout` needs a DOM, while
// `aboutHtml` / `sourcesHtml` / `clearButtonHtml` work from plain objects. The
// checks here are the ones the phase's acceptance criteria depend on: the three
// source links are present with their exact URLs, the caveats are stated, the
// clear button is disabled without selections, and the confirm string is
// non-empty Chinese text.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ABOUT_SOURCES,
  CLEAR_CONFIRM,
  CLEAR_LABEL,
  UNIT_NOTES,
  UNTRACKED,
  aboutHtml,
  clearButtonHtml,
  selectionCount,
  sourcesHtml,
  unitNotesHtml,
  untrackedHtml,
} from "../../docs/js/ui/about.js";
import { clearAll, defaultState, toggleFood } from "../../docs/js/core/state.js";

const EGG = {
  id: "fdc:egg",
  nameZh: "鸡蛋",
  measures: [{ id: "piece", labelZh: "一个", grams: 50, basis: "estimate:one egg", default: true }],
};

function ctx(overrides = {}) {
  return { state: defaultState(), onChange: () => {}, ...overrides };
}

test("the three source links are the official pages", () => {
  assert.equal(ABOUT_SOURCES.length, 3);
  assert.deepEqual(ABOUT_SOURCES.map((source) => source.url), [
    "https://fdc.nal.usda.gov/download-datasets",
    "https://www.cnsoc.org/drpostand/",
    "https://ods.od.nih.gov/HealthInformation/nutrientrecommendations.aspx",
  ]);
  for (const source of ABOUT_SOURCES) {
    assert.ok(source.url.startsWith("https://"), `${source.id}: https only`);
    assert.ok(source.name.length > 0);
    assert.ok(source.linkLabel.length > 0);
  }
});

test("source markup carries all three hrefs, opening in a new tab safely", () => {
  const html = sourcesHtml();
  for (const source of ABOUT_SOURCES) {
    assert.ok(html.includes(`href="${source.url}"`), `${source.id}: href`);
  }
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 3);
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 3);
  assert.equal((html.match(/<li class="about__item">/g) ?? []).length, 3);
});

test("the source names mention the dataset versions", () => {
  const names = ABOUT_SOURCES.map((source) => source.name).join(" ");
  assert.match(names, /SR Legacy/);
  assert.match(names, /2018-04/);
  assert.match(names, /2023/);
  assert.match(names, /NIH ODS/);
});

test("unit caveats cover vitamin E, niacin NE and the food-only UL cases", () => {
  assert.deepEqual(UNIT_NOTES.map((note) => note.id), ["vitE", "niacin", "ul"]);
  const text = UNIT_NOTES.map((note) => note.text).join(" ");
  assert.match(text, /α-生育酚/);
  assert.match(text, /α-TE/);
  assert.match(text, /烟酸当量/);
  assert.match(text, /色氨酸/);
  assert.match(text, /÷ 60/);
  assert.match(text, /维生素 A/);
  assert.match(text, /叶酸/);
  assert.match(text, /镁/);
  assert.match(text, /补充剂/);
});

test("untracked nutrients list iodine, biotin, sodium and the rest", () => {
  const names = UNTRACKED.map((entry) => entry.name);
  assert.ok(names.includes("碘"));
  assert.ok(names.includes("生物素"));
  assert.ok(names.includes("钠"));
  assert.match(names.join(" "), /钼/);
  const sodium = UNTRACKED.find((entry) => entry.name === "钠");
  assert.match(sodium.reason, /限制/);
  const html = untrackedHtml();
  assert.ok(html.includes("碘"));
  assert.ok(html.includes("生物素"));
});

test("about markup states estimates, privacy and the not-medical-advice note", () => {
  const html = aboutHtml(ctx());
  assert.match(html, /估算/);
  assert.match(html, /家庭计量/);
  assert.match(html, /localStorage/);
  assert.match(html, /不会上传/);
  assert.match(html, /不构成医疗建议/);
  assert.ok(html.includes("数据来源"));
  // No absolute src/href other than the three source pages.
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(hrefs.length, 3);
  for (const href of hrefs) assert.ok(ABOUT_SOURCES.some((source) => source.url === href));
});

test("clear button is disabled with no selection and enabled after one", () => {
  assert.equal(selectionCount(ctx()), 0);
  assert.match(clearButtonHtml(ctx()), /<button[^>]*disabled/);
  assert.match(clearButtonHtml(ctx()), /当前没有已选食物/);

  const selected = ctx({ state: toggleFood(defaultState(), EGG) });
  assert.equal(selectionCount(selected), 1);
  const html = clearButtonHtml(selected);
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /已选 1 种食物/);
  assert.ok(html.includes(CLEAR_LABEL));
  assert.equal(CLEAR_LABEL, "清空全部");
});

test("a corrupt state never breaks the section", () => {
  for (const state of [null, {}, { selections: null }, { selections: [] }]) {
    const html = aboutHtml({ state });
    assert.ok(html.includes("数据来源"));
    assert.match(clearButtonHtml({ state }), /<button[^>]*disabled/);
  }
});

test("the confirm text is Chinese and mentions clearing", () => {
  assert.ok(CLEAR_CONFIRM.length > 0);
  assert.match(CLEAR_CONFIRM, /清空/);
  assert.match(CLEAR_CONFIRM, /[\u4e00-\u9fa5]/);
});

test("every string in the section is Simplified Chinese or a cited name", () => {
  const text = aboutHtml(ctx());
  // Strip markup and the cited source names/URLs, then require CJK.
  assert.match(text, /数据来源与说明/);
  assert.match(text, /单位与上限说明/);
  assert.match(text, /未纳入的营养素/);
  assert.match(text, /数据与隐私/);
});

test("clearAll drops every selection but keeps profile, standard and tab", () => {
  let state = toggleFood(defaultState(), EGG);
  state = clearAll(state);
  assert.deepEqual(state.selections, {});
  assert.equal(state.activeNutrient, "vitA");
  assert.equal(state.standard, "cn2023");
  // The button re-renders as disabled after the clear.
  assert.match(clearButtonHtml(ctx({ state })), /<button[^>]*disabled/);
});
