// Shared helpers for the Playwright smoke and screenshot specs (phase P13).
//
// Everything here talks to the real page in the real browser: no module is
// imported from docs/, so a broken module in the site cannot make a test pass
// by accident. All flows go through the UI (click / fill / select); only the
// "reset" step touches localStorage directly.

import { expect } from "@playwright/test";

/** Food used by the smoke tests: raw pork liver, a fixed data fixture. */
export const LIVER_ID = "fdc:167862";
export const LIVER_NAME = "猪肝（生）";

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
  editor: (id) => `[data-food-editor="${id}"]`,
  search: "[data-food-search]",
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
 * Select one food in the current nutrient tab through the search box.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} query search text, e.g. "猪肝"
 * @param {string} [id] food id when the query matches several (default liver)
 */
export async function selectFood(page, query, id = LIVER_ID) {
  await page.locator(SEL.search).fill(query);
  const card = page.locator(SEL.foodCard(id));
  await expect(card).toBeVisible();
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(SEL.editor(id))).toBeVisible();
}

/**
 * Set a selected food to an exact weight through the "克" option and the gram
 * input of its quantity editor.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} grams
 * @param {string} [id]
 */
export async function setGrams(page, grams, id = LIVER_ID) {
  await page.locator(SEL.editor(id)).locator("[data-measure]").selectOption("grams");
  const input = page.locator(`${SEL.editor(id)} [data-grams]`);
  await expect(input).toBeVisible();
  await input.fill(String(grams));
  await input.blur();
  await expect(page.locator(`${SEL.editor(id)} [data-grams]`)).toHaveValue(String(grams));
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
 * Horizontal overflow of the page, in CSS pixels, with the elements that stick
 * out of the viewport (for a readable failure message).
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
