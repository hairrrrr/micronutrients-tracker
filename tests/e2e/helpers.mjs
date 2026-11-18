// Shared helpers for the Playwright smoke and screenshot specs (phase P13;
// expand-in-place editor since P17).
//
// Everything here talks to the real page in the real browser: no module is
// imported from docs/, so a broken module in the site cannot make a test pass
// by accident. All flows go through the UI (click / fill / select); only the
// "reset" step touches localStorage directly.
//
// P17: a tap on a card only expands the editing tile at that position. A food
// becomes selected only after 确认 (the round check or the 确认 button), so
// `selectFood` and `setGrams` open the tile, set the quantity and confirm.
//
// P18b: `expectedRanking` / `expectedTopIds` / `commonnessOfFood` read
// docs/data/foods.json (data, never a site module) and apply the ordering rule
// of order.js, so a test can compute the expected first card instead of
// hard-coding a food that the new commonness-first rule may have moved.
// P19b: the same helpers apply the per-10 g comparison basis of condiments,
// spices, cooking oils and dried goods.

import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** Food used by the smoke tests: raw pork liver, a fixed data fixture. */
export const LIVER_ID = "fdc:167862";
export const LIVER_NAME = "猪肝（生）";

/**
 * Carrot fixture for the P16 regression: 835 ug RAE but 0 ug vitamin D per
 * 100 g, so it belongs in the vitamin A tab and not in the vitamin D tab.
 */
export const CARROT_ID = "fdc:170393";
export const CARROT_NAME = "胡萝卜（生）";

/** Selectors of the sections rendered by app.js. */
export const SEL = Object.freeze({
  profile: "#profile",
  targets: "#targets",
  tabs: "#tabs",
  foods: "#foods",
  about: "#about",
  card: (nutrient) => `.target-card[data-nutrient="${nutrient}"]`,
  cardStatus: (nutrient) => `.target-card[data-nutrient="${nutrient}"] .target-card__status`,
  cardTarget: (nutrient) => `.target-card[data-nutrient="${nutrient}"] .target-card__target`,
  tab: (nutrient) => `.tab[data-nutrient="${nutrient}"]`,
  foodCard: (id) => `.food-card[data-food="${id}"]`,
  cell: (id) => `.food-cell[data-food-cell="${id}"]`,
  tile: (id) => `[data-food-tile="${id}"]`,
  editor: (id) => `[data-food-editor="${id}"]`,
  check: (id) => `[data-food-tile="${id}"] .food-tile__check`,
  confirmButton: (id) => `[data-food-tile="${id}"] .food-tile__btn--primary`,
  cancel: (id) => `[data-food-tile="${id}"] [data-cancel]`,
  deselect: (id) => `[data-food-tile="${id}"] [data-deselect]`,
  search: "[data-food-search]",
  detailButton: (id) => `[data-food-tile="${id}"] [data-detail]`,
  detailDialog: "dialog#food-detail",
  detailRows: "dialog#food-detail .detail-row",
});

/**
 * Collect console errors and uncaught exceptions for the whole test.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Array<string>} filled as the page runs
 */
export function watchErrors(page) {
  /** @type {Array<string>} */
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/**
 * Open the site, clear the stored state and reload, so a test starts from the
 * documented default state (female, 30, China 2023, vitamin A, no selections).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [url] entry URL, relative to the base URL (default "./")
 */
export async function resetApp(page, url = "./") {
  await page.goto(url);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator(".target-card")).toHaveCount(22);
  await expect(page.locator(SEL.targets)).toHaveAttribute("aria-busy", "false");
}

/**
 * Tap a food card to expand its editing tile in place (no selection yet).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
export async function openTile(page, id) {
  const card = page.locator(SEL.foodCard(id));
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator(SEL.tile(id))).toBeVisible();
  await expect(page.locator(SEL.editor(id))).toBeVisible();
}

/**
 * Confirm the open tile through the round check-mark button.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
export async function confirmTile(page, id, useButton = false) {
  const control = useButton ? page.locator(SEL.confirmButton(id)).last() : page.locator(SEL.check(id));
  await control.click();
  await expect(page.locator(SEL.tile(id))).toHaveCount(0);
}

/**
 * Cancel the open tile (no selection).
 *
 * @param {import('@playwright/test}.Page} page
 * @param {string} id
 */
export async function cancelTile(page, id) {
  await page.locator(SEL.cancel(id)).click();
  await expect(page.locator(SEL.tile(id))).toHaveCount(0);
}

/**
 * Select one food in the current nutrient tab through the search box: open its
 * tile and confirm it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} query search text, e.g. "猪肝"
 * @param {string} [id] food id when the query matches several (default liver)
 */
export async function selectFood(page, query, id = LIVER_ID) {
  await page.locator(SEL.search).fill(query);
  await openTile(page, id);
  await confirmTile(page, id);
  await expect(page.locator(SEL.foodCard(id))).toHaveAttribute("aria-pressed", "true");
}

/**
 * Set a selected food to an exact weight: reopen its tile, choose "克", fill the
 * gram input and confirm.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} grams
 * @param {string} [id]
 * @param {boolean} [open] false when the tile is already open (default true)
 */
export async function setGrams(page, grams, id = LIVER_ID, open = true) {
  if (open) await openTile(page, id);
  await page.locator(SEL.editor(id)).locator("[data-measure]").selectOption("grams");
  const input = page.locator(`${SEL.editor(id)} [data-grams]`);
  await expect(input).toBeVisible();
  await input.fill(String(grams));
  await input.blur();
  await expect(page.locator(`${SEL.editor(id)} [data-grams]`)).toHaveValue(String(grams));
  if (open) await confirmTile(page, id);
}

/**
 * Plain text of one target card status line.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} nutrient
 * @returns {Promise<string>}
 */
export async function cardStatus(page, nutrient) {
  return (await page.locator(SEL.cardStatus(nutrient)).innerText()).trim();
}

/**
 * Plain text of one target card's "目标 X" line.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} nutrient
 * @returns {Promise<string>}
 */
export async function cardTarget(page, nutrient) {
  return (await page.locator(SEL.cardTarget(nutrient)).innerText()).trim();
}

/**
 * Horizontal overflow of the page, in CSS pixels, with the elements that stick out of the viewport (for a readable failure message).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{scrollWidth: number, clientWidth: number, innerWidth: number,
 *   offenders: Array<{tag: string, cls: string, right: number}>}>}
 */
export async function measureOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = window.innerWidth;
    const offenders = [];
    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= width + 0.5) continue;
      let node = element.parentElement;
      let clipped = false;
      while (node && node !== document.body) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
          clipped = true;
          break;
        }
        node = node.parentElement;
      }
      if (clipped) continue;
      offenders.push({
        tag: element.tagName.toLowerCase(),
        cls: typeof element.className === "string" ? element.className : "",
        right: Math.round(box.right * 10) / 10,
      });
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerWidth: width,
      offenders: offenders.slice(0, 10),
    };
  });
}

/**
 * Expected ranking of the unpinned cards of one nutrient, computed from
 * docs/data/foods.json with the same rule as order.js (P18b, P19b): commonness
 * descending (missing = 0), then richness on the comparison basis descending
 * (per100g * amountBasisG / 100, amountBasisG defaulting to 100), then nameZh.
 * Foods with no value or a zero value for the nutrient are not listed (P16).
 *
 * Since P25b the foods whose `pinTop` contains the nutrient are not part of this
 * ranking: they lead the tab in foods.json order (see `expectedLeadingIds`).
 *
 * @param {string} nutrientId
 * @returns {Promise<Array<{id: string, nameZh: string, commonness: number,
 *   amount: number|null, amountBasisG: number, richness: number}>>>}
 */
export async function expectedRanking(nutrientId) {
  const path = new URL("../../docs/data/foods.json", import.meta.url);
  const payload = JSON.parse(await readFile(path, "utf8"));
  return payload.foods
    .filter((food) => typeof food.per100g?.[nutrientId] === "number" && food.per100g[nutrientId] > 0)
    .filter((food) => !(Array.isArray(food.pinTop) && food.pinTop.includes(nutrientId)))
    .sort((a, b) => ((b.commonness ?? 0) - (a.commonness ?? 0))
      || (richnessOf(b, nutrientId) - richnessOf(a, nutrientId))
      || (a.nameZh < b.nameZh ? -1 : a.nameZh > b.nameZh ? 1 : 0))
    .map((food) => ({
      id: food.id,
      nameZh: food.nameZh,
      commonness: food.commonness ?? 0,
      amount: food.per100g[nutrientId],
      amountBasisG: food.amountBasisG ?? 100,
      richness: richnessOf(food, nutrientId),
    }));
}

/**
 * Ids of the unselected foods that lead a tab through `pinTop` (P25b), in
 * foods.json order, read from docs/data/foods.json.
 *
 * @param {string} nutrientId
 * @returns {Promise<Array<{id: string, nameZh: string}>>}
 */
export async function expectedLeading(nutrientId) {
  const path = new URL("../../docs/data/foods.json", import.meta.url);
  const payload = JSON.parse(await readFile(path, "utf8"));
  return payload.foods
    .filter((food) => Array.isArray(food.pinTop) && food.pinTop.includes(nutrientId))
    .map((food) => ({ id: food.id, nameZh: food.nameZh }));
}

/**
 * Ids that lead a tab: the `pinTop` foods of the nutrient (P25b).
 *
 * @param {string} nutrientId
 * @returns {Promise<Array<string>>}
 */
export async function expectedLeadingIds(nutrientId) {
  return (await expectedLeading(nutrientId)).map((entry) => entry.id);
}

/** Richness on the comparison basis: per100g * amountBasisG / 100 (P19b). */
function richnessOf(food, nutrientId) {
  return (food.per100g[nutrientId] * (food.amountBasisG ?? 100)) / 100;
}

/**
 * Ids of the first `count` cards of one nutrient under the P18b rule.
 *
 * @param {string} nutrientId
 * @param {number} [count] defaults to 60 (the initial limit)
 * @returns {Promise<Array<string>>}
 */
export async function expectedTopIds(nutrientId, count = 60) {
  return (await expectedRanking(nutrientId)).slice(0, count).map((entry) => entry.id);
}

/** Commonness tier of one food in foods.json (0 when it has none). */
export async function commonnessOfFood(foodId) {
  const path = new URL("../../docs/data/foods.json", import.meta.url);
  const payload = JSON.parse(await readFile(path, "utf8"));
  const food = payload.foods.find((entry) => entry.id === foodId);
  if (!food) throw new Error(`foods.json has no food ${foodId}`);
  return food.commonness ?? 0;
}

/**
 * Number of nutrients in docs/data/nutrients.json that one food contains, i.e.
 * its per100g value is a number > 0 (P23: those are the detail rows).
 *
 * @param {string} foodId
 * @returns {Promise<number>}
 */
export async function containedNutrientCount(foodId) {
  const foods = JSON.parse(await readFile(new URL("../../docs/data/foods.json", import.meta.url), "utf8"));
  const nutrients = JSON.parse(await readFile(new URL("../../docs/data/nutrients.json", import.meta.url), "utf8"));
  const food = foods.foods.find((entry) => entry.id === foodId);
  if (!food) throw new Error(`foods.json has no food ${foodId}`);
  return nutrients.nutrients.filter((nutrient) => {
    const value = food.per100g?.[nutrient.id];
    return typeof value === "number" && value > 0;
  }).length;
}

/**
 * Per-100 g value one food has for one nutrient, or null when absent / not a
 * number (read from docs/data/foods.json).
 *
 * @param {string} foodId
 * @param {string} nutrientId
 * @returns {Promise<number|null>}
 */
export async function per100gOfFood(foodId, nutrientId) {
  const foods = JSON.parse(await readFile(new URL("../../docs/data/foods.json", import.meta.url), "utf8"));
  const food = foods.foods.find((entry) => entry.id === foodId);
  if (!food) throw new Error(`foods.json has no food ${foodId}`);
  const value = food.per100g?.[nutrientId];
  return typeof value === "number" ? value : null;
}

/**
 * Expected ranking of the detail sheet of one food (P21c), computed from
 * docs/data/foods.json and docs/data/dri.json: every nutrient whose food value
 * is > 0 and whose target for the profile is > 0, by per100g / target
 * descending, ties keeping nutrients.json order.
 *
 * @param {string} foodId
 * @param {{standard?: string, sex?: string, age?: number}} [profile]
 * @returns {Promise<Array<{id: string, ratio: number}>>}
 */
export async function expectedDetailRanking(foodId, profile = {}) {
  const { standard = "cn2023", sex = "female", age = 30 } = profile;
  const foods = JSON.parse(await readFile(new URL("../../docs/data/foods.json", import.meta.url), "utf8"));
  const dri = JSON.parse(await readFile(new URL("../../docs/data/dri.json", import.meta.url), "utf8"));
  const nutrients = JSON.parse(await readFile(new URL("../../docs/data/nutrients.json", import.meta.url), "utf8"));

  const food = foods.foods.find((entry) => entry.id === foodId);
  if (!food) throw new Error(`foods.json has no food ${foodId}`);
  const group = dri.standards[standard].groups.find((entry) => entry.sex === sex
    && entry.lifeStage === "none"
    && entry.ageMin <= age
    && (entry.ageMax === null || age <= entry.ageMax));
  if (!group) throw new Error(`no ${standard} group for ${sex} ${age}`);

  return nutrients.nutrients
    .map((nutrient) => {
      const value = food.per100g?.[nutrient.id];
      const target = Number(group.values?.[nutrient.id]?.target);
      if (typeof value !== "number" || !(value > 0) || !(target > 0)) return null;
      return { id: nutrient.id, ratio: value / target };
    })
    .filter(Boolean)
    .sort((a, b) => b.ratio - a.ratio);
}
