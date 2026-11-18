// End-to-end smoke tests (PLAN.md phase P13; expand-in-place editor since P17).
//
// Scenarios that cover the user-visible promises of the app: the profile and
// standard switch, selecting a food through the expand-in-place editor, the
// cross-tab pinning, a target card turning green, the surplus wording,
// persistence across a reload, no horizontal overflow at 390 px, the same site
// served from a sub-path, (P16) a selected food that lacks the nutrient not
// appearing in that tab, (P17) the expand/cancel/confirm flow, the
// confirmation order of the pinned group, the single change of the measure
// select and no overflow with an open tile, and (P18b) the commonness-first
// ranking of the vitamin A and calcium tabs plus the 常见 badge of tiers 4-5.
// Every flow goes through the real UI; only the reset touches localStorage.
//
// The reference numbers used here are the fixed DRI fixtures of the unit
// tests (Cn male 30-49 iron 12 mg, US male 31-50 iron 8 mg, vitamin A 770 /
// 900 ug RAE) and the fixed food fixture fdc:167862 (raw pork liver,
// 6502 ug RAE and 26 ug B12 per 100 g). No nutrient or DRI value is invented
// in this file. The expected card order is computed from docs/data/foods.json
// through helpers.mjs, never from a hard-coded first food.

import { expect, test } from "@playwright/test";
import { SUBPATH_BASE } from "../../playwright.config.mjs";
import {
  CARROT_ID,
  CARROT_NAME,
  LIVER_ID,
  LIVER_NAME,
  SEL,
  cancelTile,
  cardStatus,
  cardTarget,
  commonnessOfFood,
  confirmTile,
  expectedRanking,
  expectedTopIds,
  measureOverflow,
  openTile,
  resetApp,
  selectFood,
  setGrams,
  watchErrors,
} from "./helpers.mjs";

/** Ids of the grid cells in display order. */
async function cellIds(page) {
  return page.locator(".food-cell").evaluateAll((cells) => cells.map((cell) => cell.dataset.foodCell));
}

/** A food with a household measure that is easy to find by search. */
const EGG_ID = "fdc:171287";

test.describe("smoke", () => {
  test("1. profile: male 35 and the US standard", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    // Default state: female 30, China 2023.
    await expect(page.locator(SEL.card("vitA"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('tr[data-nutrient="iron"] td[data-standard="cn2023"]'))
      .toHaveText("18 mg (RNI)");
    await expect(page.locator('tr[data-nutrient="iron"] td[data-standard="us"]'))
      .toHaveText("18 mg (RDA)");
    await expect(page.locator(SEL.cardTarget("iron"))).toHaveText("目标 18 mg");

    // Male, 35, US standard.
    await page.locator('[data-sex="male"]').click();
    await expect(page.locator('[data-sex="male"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("#profile-age").fill("35");
    await page.locator("#profile-age").blur();
    await expect(page.locator("#profile-age")).toHaveValue("35");
    await expect(page.locator(SEL.cardTarget("vitA"))).toHaveText("目标 770 ug RAE");
    await expect(page.locator(SEL.cardTarget("iron"))).toHaveText("目标 12 mg");

    await page.locator('input[name="standard"][value="us"]').check();
    await expect(page.locator('th[data-standard="us"]')).toHaveClass(/is-active/);
    await expect(page.locator('td[data-standard="cn2023"]').first()).not.toHaveClass(/is-active/);
    await expect(page.locator(SEL.cardTarget("vitA"))).toHaveText("目标 900 ug RAE");
    await expect(page.locator(SEL.cardTarget("iron"))).toHaveText("目标 8 mg");
    // Both columns still show the CN row values for the new profile: CN male
    // 30-49 iron 12 mg, US male 31-50 iron 8 mg (the table is a comparison).
    await expect(page.locator('tr[data-nutrient="iron"] td[data-standard="cn2023"]'))
      .toHaveText("12 mg (RNI)");
    await expect(page.locator('tr[data-nutrient="iron"] td[data-standard="us"]'))
      .toHaveText("8 mg (RDA)");
    await expect(page.locator(".targets__meta")).toContainText("美国");
    await expect(page.locator(".targets__meta")).toContainText("男 35 岁");

    expect(errors).toEqual([]);
  });

  test("2. selecting a food in the vitamin A tab", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    await expect(page.locator(SEL.tab("vitA"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("还差 660 ug RAE");

    await selectFood(page, "猪肝");

    const card = page.locator(SEL.foodCard(LIVER_ID));
    await expect(card).toContainText(LIVER_NAME);
    await expect(card).toHaveAttribute("aria-pressed", "true");
    // The single "met" green of the design, from nutrients.js MET_COLORS.
    await expect(card).toHaveCSS("background-color", "rgb(200, 242, 208)");
    // The tile collapsed after the confirm.
    await expect(page.locator(SEL.tile(LIVER_ID))).toHaveCount(0);

    // 100 g of raw pork liver = 6502 ug RAE, far above the 660 ug target.
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("+5842 ug RAE");
    await expect(page.locator(SEL.card("vitA"))).toHaveClass(/is-met/);

    // Reopening it shows the current quantity and the deselect control.
    await page.locator(SEL.foodCard(LIVER_ID)).click();
    await expect(page.locator(SEL.editor(LIVER_ID))).toContainText("约 100 g");
    await expect(page.locator(SEL.deselect(LIVER_ID))).toBeVisible();
    await cancelTile(page, LIVER_ID);
    await expect(page.locator(SEL.foodCard(LIVER_ID))).toHaveAttribute("aria-pressed", "true");

    // The selection is stored in the documented state shape (with the P17
    // confirmation order).
    const stored = await page.evaluate(() => window.localStorage.getItem("mnt.state.v1"));
    expect(stored).toContain(LIVER_ID);
    expect(JSON.parse(stored).order).toEqual([LIVER_ID]);

    expect(errors).toEqual([]);
  });

  test("3. another nutrient tab keeps the food pinned first and counts it", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);
    await selectFood(page, "猪肝");

    // Vitamin B12 (second tab of the row, after vitamin A).
    await page.locator(SEL.tab("vitB12")).click();
    await expect(page.locator(SEL.tab("vitB12"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".foods__hint")).toContainText("维生素B12");

    // Pinned first: the selected food is the first cell of the grid.
    const firstCell = page.locator(".food-cell").first();
    await expect(firstCell).toHaveAttribute("data-food-cell", LIVER_ID);
    await expect(page.locator(SEL.foodCard(LIVER_ID))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SEL.foodCard(LIVER_ID))).toHaveCSS(
      "background-color",
      "rgb(200, 242, 208)",
    );
    // ... and reopening it keeps its quantity on the new tab.
    await openTile(page, LIVER_ID);
    await expect(page.locator(SEL.editor(LIVER_ID))).toContainText("约 100 g");
    await cancelTile(page, LIVER_ID);

    // Counted: 100 g raw pork liver = 26 ug B12 against the 2.4 ug target.
    await expect(page.locator(SEL.cardStatus("vitB12"))).toHaveText("+23.6 ug");
    await expect(page.locator(SEL.card("vitB12"))).toHaveClass(/is-met/);

    expect(errors).toEqual([]);
  });

  test("4. a large quantity turns a target card green", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);
    await selectFood(page, "猪肝");

    // The default portion (100 g = 6502 ug RAE) is already far above the
    // target, so the green state starts from a small weight instead: 5 g
    // = 325 ug RAE is still short.
    await setGrams(page, 5);
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("还差 335 ug RAE");
    await expect(page.locator(SEL.card("vitA"))).not.toHaveClass(/is-met/);

    // 20 g = 1300 ug RAE > 660 ug: met, so the card uses the met green.
    await setGrams(page, 20);
    await expect(page.locator(SEL.card("vitA"))).toHaveClass(/is-met/);
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("+640 ug RAE");
    await expect(page.locator(SEL.card("vitA"))).toHaveCSS("background-color", "rgb(200, 242, 208)");
    await expect(page.locator(SEL.card("vitA"))).toHaveCSS("border-color", "rgb(20, 92, 42)");
    await openTile(page, LIVER_ID);
    await expect(page.locator(`${SEL.editor(LIVER_ID)} [data-grams]`)).toHaveValue("20");
    await cancelTile(page, LIVER_ID);

    expect(errors).toEqual([]);
  });

  test("5. surplus text starts with + and no card text has a minus sign", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);
    await selectFood(page, "猪肝");
    await setGrams(page, 50);

    const statuses = await page.locator(".target-card__status").allInnerTexts();
    expect(statuses).toHaveLength(22);
    const surplus = statuses.filter((text) => text.trim().startsWith("+"));
    expect(surplus.length).toBeGreaterThan(0);
    expect(surplus).toContain("+2591 ug RAE");

    // No card text may contain a minus sign before a digit: neither the ASCII
    // hyphen of a template string nor the typographic minus of the stepper.
    const texts = await page.locator(".target-card").allInnerTexts();
    for (const text of texts) {
      expect(text).not.toMatch(/[-−–]\s?\d/);
      expect(text).not.toMatch(/\d\s?-/);
    }
    // The remaining / surplus line never hides a deficit behind a minus.
    for (const text of statuses) {
      expect(text).not.toContain("-");
      expect(text).not.toContain("−");
    }
    // 还差 / +X / 已达标 are the only three wordings in this state.
    for (const text of statuses) {
      const trimmed = text.trim();
      expect(trimmed === "已达标" || trimmed.startsWith("还差") || trimmed.startsWith("+")).toBe(true);
    }

    expect(errors).toEqual([]);
  });

  test("6. reload restores profile, standard, tab and selections", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    await page.locator('[data-sex="male"]').click();
    await page.locator("#profile-age").fill("41");
    await page.locator("#profile-age").blur();
    await page.locator('input[name="standard"][value="us"]').check();
    await selectFood(page, "猪肝");
    await setGrams(page, 80);
    await page.locator(SEL.tab("vitB12")).click();
    await expect(page.locator(SEL.tab("vitB12"))).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.locator(".target-card")).toHaveCount(22);

    await expect(page.locator('[data-sex="male"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#profile-age")).toHaveValue("41");
    await expect(page.locator('input[name="standard"][value="us"]')).toBeChecked();
    await expect(page.locator('th[data-standard="us"]')).toHaveClass(/is-active/);
    await expect(page.locator(SEL.tab("vitB12"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SEL.foodCard(LIVER_ID))).toHaveAttribute("aria-pressed", "true");
    // 80 g x 26 ug / 100 g = 20.8 ug against the 2.4 ug US target.
    await expect(page.locator(SEL.cardStatus("vitB12"))).toHaveText("+18.4 ug");
    // The restored quantity is intact in the reopened editor.
    await openTile(page, LIVER_ID);
    await expect(page.locator(`${SEL.editor(LIVER_ID)} [data-grams]`)).toHaveValue("80");
    await cancelTile(page, LIVER_ID);

    expect(errors).toEqual([]);
  });

  test("7. no horizontal overflow at 390 and 360 px", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    // The whole page, with an expanded tile open, at 390 x 844.
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    await selectFood(page, "猪肝");
    await setGrams(page, 250);
    await openTile(page, LIVER_ID);
    // The profile panel starts open, so the comparison table is on the page.
    await page.locator("#profile .standards__table").scrollIntoViewIfNeeded();
    await expect(page.locator("#profile .standards__table")).toBeVisible();

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      const box = await measureOverflow(page);
      expect(box.offenders, `overflowing elements at ${width}px: ${JSON.stringify(box.offenders)}`)
        .toEqual([]);
      expect(box.scrollWidth, `scrollWidth at ${width}px`).toBeLessThanOrEqual(width);
      expect(box.innerWidth).toBe(width);
    }

    // 390 px keeps three target columns and two food columns.
    await page.setViewportSize({ width: 390, height: 844 });
    const grid = await page.evaluate(() => ({
      targets: getComputedStyle(document.querySelector(".targets__grid"))
        .gridTemplateColumns.split(" ").length,
      foods: getComputedStyle(document.querySelector(".foods__grid"))
        .gridTemplateColumns.split(" ").length,
    }));
    expect(grid).toEqual({ targets: 3, foods: 2 });
    await expect(page.locator(".foods__search-input")).toHaveCSS("font-size", "16px");

    // Nothing visible is truncated and every control stays tappable at 360 px.
    await page.setViewportSize({ width: 360, height: 844 });
    const polish = await page.evaluate(() => {
      const clipped = [];
      for (const element of document.querySelectorAll("body *")) {
        if (element.classList.contains("visually-hidden")) continue;
        if (element.childElementCount > 0) continue;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
          clipped.push(`${element.className}: ${element.textContent.trim().slice(0, 20)}`);
        }
      }
      const heights = {};
      for (const selector of [
        ".tab",
        ".target-card",
        ".food-card",
        ".foods__search-input",
        ".food-editor__select",
        ".food-tile__check",
        ".food-tile__btn",
        ".segmented__btn",
        ".choice",
      ]) {
        const element = document.querySelector(selector);
        heights[selector] = element ? Math.round(element.getBoundingClientRect().height) : null;
      }
      return { clipped, heights };
    });
    expect(polish.clipped).toEqual([]);
    for (const [selector, height] of Object.entries(polish.heights)) {
      expect(height, `${selector} height at 360 px`).toBeGreaterThanOrEqual(34);
    }

    // The stepper and the gram input are two different editor modes: check the
    // stepper in household mode and the input after switching to "克".
    await page.locator(SEL.editor(LIVER_ID)).locator("[data-measure]")
      .selectOption({ index: 0 });
    const stepHeight = await page.locator(`${SEL.editor(LIVER_ID)} [data-step]`).first()
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(stepHeight).toBeGreaterThanOrEqual(38);
    await setGrams(page, 250, LIVER_ID, false);
    const gramsHeight = await page.locator(`${SEL.editor(LIVER_ID)} [data-grams]`)
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(gramsHeight).toBeGreaterThanOrEqual(38);
    await cancelTile(page, LIVER_ID);

    expect(errors).toEqual([]);
  });

  test("8. works when served from a sub-path", async ({ page }, testInfo) => {
    test.skip(Boolean(process.env.BASE_URL), "sub-path check needs a local repo-root server");
    const errors = watchErrors(page);

    // Repo root served on :8125, so the site lives at /docs/.
    await page.goto(SUBPATH_BASE);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    await expect(page.locator(".target-card")).toHaveCount(22);
    await expect(page.locator(SEL.cardTarget("vitA"))).toHaveText("目标 660 ug RAE");
    await expect(page.locator("#about")).toContainText("USDA");

    // Every asset and data file resolved under /docs/.
    const urls = await page.evaluate(() => ({
      base: document.baseURI,
      scripts: [...document.querySelectorAll("script[src]")].map((node) => node.src),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.href),
      data: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes("/data/")),
    }));
    expect(urls.base).toContain("/docs/");
    for (const url of [...urls.scripts, ...urls.styles, ...urls.data]) {
      expect(url).toContain("/docs/");
    }
    expect(urls.data.some((url) => url.endsWith("foods.json"))).toBe(true);

    // And the app still works there: select a food, tab switches, state stays.
    await selectFood(page, "猪肝");
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("+5842 ug RAE");
    await page.locator(SEL.tab("iron")).click();
    await expect(page.locator(".food-cell").first()).toHaveAttribute("data-food-cell", LIVER_ID);
    const box = await measureOverflow(page);
    expect(box.scrollWidth).toBeLessThanOrEqual(390);

    expect(errors).toEqual([]);
    await testInfo.attach("subpath-url", {
      body: page.url(),
      contentType: "text/plain",
    });
  });

  test("9. a selected food with no vitamin D is not pinned in the vitamin D tab", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    // Carrot per 100 g: 835 ug RAE vitamin A, 0 ug vitamin D.
    await expect(page.locator(SEL.tab("vitA"))).toHaveAttribute("aria-pressed", "true");
    await selectFood(page, "胡萝卜", CARROT_ID);
    await expect(page.locator(".food-cell").first()).toHaveAttribute("data-food-cell", CARROT_ID);
    await expect(page.locator(SEL.foodCard(CARROT_ID))).toContainText(CARROT_NAME);
    await expect(page.locator(SEL.foodCard(CARROT_ID))).toHaveAttribute("aria-pressed", "true");

    // Clear the search so the whole vitamin D list is rendered, then switch.
    await page.locator(SEL.search).fill("");
    await page.locator(SEL.tab("vitD")).click();
    await expect(page.locator(SEL.tab("vitD"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".foods__hint")).toContainText("维生素D");
    await expect(page.locator(".food-cell").first()).toBeVisible();

    // P16: the carrot does not contain vitamin D, so it is neither pinned nor
    // listed in that tab, and its editor cannot be opened there.
    await expect(page.locator(SEL.foodCard(CARROT_ID))).toHaveCount(0);
    await expect(page.locator(`.food-cell[data-food-cell="${CARROT_ID}"]`)).toHaveCount(0);
    await expect(page.locator(SEL.tile(CARROT_ID))).toHaveCount(0);

    // The selection itself is untouched: back in the vitamin A tab the carrot
    // is pinned first, still selected, and its editor still opens.
    await page.locator(SEL.tab("vitA")).click();
    await expect(page.locator(SEL.tab("vitA"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".food-cell").first()).toHaveAttribute("data-food-cell", CARROT_ID);
    await expect(page.locator(SEL.foodCard(CARROT_ID))).toHaveAttribute("aria-pressed", "true");
    await openTile(page, CARROT_ID);
    await expect(page.locator(SEL.editor(CARROT_ID))).toBeVisible();
    await cancelTile(page, CARROT_ID);
    const stored = await page.evaluate(() => window.localStorage.getItem("mnt.state.v1"));
    expect(stored).toContain(CARROT_ID);

    expect(errors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // P17: expand-in-place editor
  // -------------------------------------------------------------------------

  test("10. a tap expands the card in place and keeps its index; cancel selects nothing", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);
    // A full list without a search filter, so the tapped card's position is
    // the ranking position.
    const before = await cellIds(page);
    expect(before.length).toBe(60);
    const targetId = before[7];

    await page.locator(SEL.foodCard(targetId)).click();

    // Expanded, not selected, still at index 7 (the cells around it are the
    // same ones in the same order).
    const cell = page.locator(SEL.cell(targetId));
    await expect(cell).toHaveAttribute("data-expanded", "true");
    await expect(cell).toHaveClass(/food-cell--expanded/);
    await expect(page.locator(SEL.tile(targetId))).toBeVisible();
    await expect(page.locator(SEL.foodCard(targetId))).toHaveAttribute("aria-pressed", "false");
    const after = await cellIds(page);
    expect(after.length).toBe(60);
    expect(after).toEqual(before);
    expect(after.indexOf(targetId)).toBe(7);

    // The tile spans the grid row (2 columns at 390 px) and shows the quantity
    // editor plus the confirm controls.
    const span = await cell.evaluate((node) => {
      const style = getComputedStyle(node);
      return { start: style.gridColumnStart, end: style.gridColumnEnd };
    });
    expect(span).toEqual({ start: "1", end: "-1" });
    await expect(page.locator(SEL.editor(targetId))).toBeVisible();
    await expect(page.locator(SEL.check(targetId))).toBeVisible();
    await expect(page.locator(SEL.check(targetId))).toHaveAttribute("aria-label", "确认");
    await expect(page.locator(SEL.confirmButton(targetId))).toHaveText("确认");
    await expect(page.locator(SEL.cancel(targetId))).toHaveText("取消");
    await expect(page.locator(SEL.deselect(targetId))).toHaveCount(0);

    // Draft edits are UI-only: no selection and no totals change.
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("还差 660 ug RAE");
    const storedBefore = await page.evaluate(() => window.localStorage.getItem("mnt.state.v1"));

    await cancelTile(page, targetId);
    await expect(page.locator(SEL.tile(targetId))).toHaveCount(0);
    await expect(page.locator(SEL.foodCard(targetId))).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("还差 660 ug RAE");
    const storedAfter = await page.evaluate(() => window.localStorage.getItem("mnt.state.v1"));
    expect(storedAfter).toBe(storedBefore);

    // Only one tile is open at a time: opening another collapses the previous
    // one without selecting it.
    await page.locator(SEL.foodCard(before[3])).click();
    await expect(page.locator(SEL.tile(before[3]))).toBeVisible();
    await page.locator(SEL.foodCard(before[9])).click();
    await expect(page.locator(SEL.tile(before[9]))).toBeVisible();
    await expect(page.locator(SEL.tile(before[3]))).toHaveCount(0);
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("还差 660 ug RAE");
    await cancelTile(page, before[9]);

    expect(errors).toEqual([]);
  });

  test("11. confirm pins the food at the bottom of the pinned group", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    // First confirmed food: the liver (100 g = 6502 ug RAE).
    await selectFood(page, "猪肝");
    await page.locator(SEL.search).fill("");
    let ids = await cellIds(page);
    expect(ids[0]).toBe(LIVER_ID);

    // Second confirmed food: an egg, confirmed through the 确认 button this
    // time. It joins the BOTTOM of the pinned group even though 100 g of liver
    // contributes far more vitamin A than one egg.
    await page.locator(SEL.search).fill("鸡蛋");
    await openTile(page, EGG_ID);
    await confirmTile(page, EGG_ID, true);
    await page.locator(SEL.search).fill("");

    ids = await cellIds(page);
    expect(ids.slice(0, 2)).toEqual([LIVER_ID, EGG_ID]);
    await expect(page.locator(SEL.foodCard(EGG_ID))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SEL.foodCard(EGG_ID))).toHaveCSS(
      "background-color",
      "rgb(200, 242, 208)",
    );
    const stored = JSON.parse(await page.evaluate(() => window.localStorage.getItem("mnt.state.v1")));
    expect(stored.order).toEqual([LIVER_ID, EGG_ID]);

    // Editing a pinned food keeps its position: raise the egg's quantity and
    // the order stays liver, egg.
    await openTile(page, EGG_ID);
    await page.locator(SEL.editor(EGG_ID)).locator("[data-measure]").selectOption("grams");
    await page.locator(`${SEL.editor(EGG_ID)} [data-grams]`).fill("200");
    await page.locator(`${SEL.editor(EGG_ID)} [data-grams]`).blur();
    await confirmTile(page, EGG_ID);
    ids = await cellIds(page);
    expect(ids.slice(0, 2)).toEqual([LIVER_ID, EGG_ID]);

    // 取消选择 removes it from the pinned group but keeps the liver pinned.
    // The egg still contains vitamin A, so it stays in the ranked list as an
    // ordinary (unpinned) card at its P18b position instead of leading it.
    await openTile(page, EGG_ID);
    await page.locator(SEL.deselect(EGG_ID)).click();
    await expect(page.locator(SEL.tile(EGG_ID))).toHaveCount(0);
    ids = await cellIds(page);
    expect(ids[0]).toBe(LIVER_ID);
    expect(ids.slice(1, 2)).not.toContain(EGG_ID);
    const rankedIds = (await expectedRanking("vitA")).map((entry) => entry.id);
    expect(ids.indexOf(EGG_ID)).toBe(rankedIds.indexOf(EGG_ID) + 1); // +1 pinned liver
    await expect(page.locator(SEL.foodCard(EGG_ID))).toHaveAttribute("aria-pressed", "false");
    const cleared = JSON.parse(await page.evaluate(() => window.localStorage.getItem("mnt.state.v1")));
    expect(cleared.order).toEqual([LIVER_ID]);

    expect(errors).toEqual([]);
  });

  test("12. the measure select changes once and is not reopened", async ({ page }) => {
    const errors = watchErrors(page);

    // Count the change listeners that end up on #foods or its children, so a
    // handler added again on every render would be visible.
    await page.addInitScript(() => {
      window.__changeListeners = 0;
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function patched(type, ...rest) {
        if (type === "change" && this instanceof Element && this.closest?.("#foods")) {
          window.__changeListeners += 1;
        }
        return add.call(this, type, ...rest);
      };
      // A capture listener of the test page: counts the change events that were
      // dispatched on the measure select.
      window.__selectChanges = 0;
      document.addEventListener("change", (event) => {
        if (event.target?.matches?.("[data-measure]")) window.__selectChanges += 1;
      }, true);
    });

    await resetApp(page);
    const ids = await cellIds(page);
    const targetId = ids[0];
    // Open an UNSELECTED card, so the change can only touch the draft.
    await openTile(page, targetId);
    const baseline = await page.evaluate(() => window.__changeListeners);
    expect(baseline).toBeGreaterThan(0);

    const select = page.locator(`${SEL.editor(targetId)} [data-measure]`);
    await select.evaluate((node) => { node.dataset.marker = "same-node"; });

    // One household-measure choice: the tile opens on the food's default
    // household measure, so pick the manual 克 entry (a real value change).
    await select.selectOption("grams");

    expect(await page.evaluate(() => window.__selectChanges)).toBe(1);
    // The same <select> node is still in the DOM and still holds the value...
    await expect(select).toHaveAttribute("data-marker", "same-node");
    await expect(select).toHaveValue("grams");
    await expect(page.locator(`${SEL.editor(targetId)} [data-grams]`)).toBeVisible();
    // ... and it is not focused again, so the native picker does not reopen.
    const focused = await page.evaluate(() => document.activeElement?.matches?.("[data-measure]") ?? false);
    expect(focused).toBe(false);
    await expect(page.locator(SEL.editor(targetId))).toBeVisible();
    await expect(page.locator(SEL.tile(targetId))).toBeVisible();

    // The change edited the draft only: still nothing selected.
    await expect(page.locator(SEL.foodCard(targetId))).toHaveAttribute("aria-pressed", "false");

    // Several re-renders (tab switches, a confirm) must not add listeners.
    for (const nutrient of ["iron", "vitA", "iron", "vitA"]) {
      await page.locator(SEL.tab(nutrient)).click();
      await expect(page.locator(SEL.tab(nutrient))).toHaveAttribute("aria-pressed", "true");
    }
    await openTile(page, targetId);
    await confirmTile(page, targetId);
    await openTile(page, targetId);
    await cancelTile(page, targetId);
    expect(await page.evaluate(() => window.__changeListeners)).toBe(baseline);

    // A second, independent choice still fires exactly one change.
    await openTile(page, targetId);
    await page.evaluate(() => { window.__selectChanges = 0; });
    await page.locator(`${SEL.editor(targetId)} [data-measure]`).selectOption({ index: 0 });
    expect(await page.evaluate(() => window.__selectChanges)).toBe(1);
    await cancelTile(page, targetId);
    expect(await page.evaluate(() => window.__changeListeners)).toBe(baseline);

    expect(errors).toEqual([]);
  });

  test("13. no horizontal overflow at 390 px with an expanded card", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // Open a tile near the top and one deeper in the list (with a long English
    // name and a household measure label).
    const ids = await cellIds(page);
    await page.locator(SEL.foodCard(ids[1])).click();
    await expect(page.locator(SEL.tile(ids[1]))).toBeVisible();
    let box = await measureOverflow(page);
    expect(box.scrollWidth).toBeLessThanOrEqual(390);
    expect(box.offenders).toEqual([]);

    // A gram entry of a wide number and the gram input visible.
    await page.locator(`${SEL.editor(ids[1])} [data-measure]`).selectOption("grams");
    await page.locator(`${SEL.editor(ids[1])} [data-grams]`).fill("1234.5");
    box = await measureOverflow(page);
    expect(box.scrollWidth).toBeLessThanOrEqual(390);
    expect(box.offenders).toEqual([]);

    // The tile is the width of the row, not wider than the grid.
    const geometry = await page.evaluate((id) => {
      const cell = document.querySelector(`.food-cell[data-food-cell="${id}"]`);
      const grid = document.querySelector(".foods__grid");
      const active = document.activeElement;
      return {
        cellWidth: Math.round(cell.getBoundingClientRect().width),
        gridWidth: Math.round(grid.getBoundingClientRect().width),
        activeIsGram: Boolean(active?.matches?.("[data-grams]")),
      };
    }, ids[1]);
    expect(geometry.cellWidth).toBe(geometry.gridWidth);
    expect(geometry.activeIsGram).toBe(true);

    // Confirm and reopen as a pinned card: still no overflow.
    await confirmTile(page, ids[1]);
    await openTile(page, ids[1]);
    await expect(page.locator(SEL.deselect(ids[1]))).toBeVisible();
    box = await measureOverflow(page);
    expect(box.scrollWidth).toBeLessThanOrEqual(390);
    expect(box.offenders).toEqual([]);
    await cancelTile(page, ids[1]);

    expect(errors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // P18b: commonness first, richness second
  // -------------------------------------------------------------------------

  test("14. the vitamin A and calcium tabs lead with common foods", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    for (const nutrient of ["vitA", "calcium"]) {
      await page.locator(SEL.tab(nutrient)).click();
      await expect(page.locator(SEL.tab(nutrient))).toHaveAttribute("aria-pressed", "true");

      // The expected order comes from foods.json with the P18b rule
      // (commonness desc, then per100g desc, then nameZh), not from a fixture.
      const expected = await expectedTopIds(nutrient, 60);
      const shown = await cellIds(page);
      expect(shown).toEqual(expected);

      const ranking = await expectedRanking(nutrient);
      expect(ranking[0].commonness).toBe(5);
      // The visible top stays inside the most common tiers, rather than being
      // made of rare but very rich foods.
      expect(ranking.slice(0, 10).every((entry) => entry.commonness >= 4)).toBe(true);

      // The first card is a common food and carries the 常见 badge while still
      // showing its per-100 g amount.
      const first = page.locator(".food-cell").first();
      const firstId = expected[0];
      await expect(first).toHaveAttribute("data-food-cell", firstId);
      const card = page.locator(SEL.foodCard(firstId));
      await expect(card.locator(".food-card__badge--common")).toHaveText("★常见");
      await expect(card.locator(".food-card__amount")).not.toHaveText("");
    }

    // A rare food is not in the visible top of the vitamin A tab.
    const rare = (await expectedRanking("vitA")).filter((entry) => entry.commonness <= 2);
    expect(rare.length).toBeGreaterThan(0);
    expect(await cellIds(page)).not.toContain(rare[0].id);

    expect(errors).toEqual([]);
  });

  test("15. a tier-4 food shows 常见 and a tier-3 food shows no badge", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    // Pick one tier-4 and one tier-3 food with vitamin A out of the data, then
    // find them through the search box instead of guessing their rank.
    const ranking = await expectedRanking("vitA");
    const tier4 = ranking.find((entry) => entry.commonness === 4);
    const tier3 = ranking.find((entry) => entry.commonness === 3);
    expect(tier4, "no tier-4 food with vitamin A").toBeTruthy();
    expect(tier3, "no tier-3 food with vitamin A").toBeTruthy();

    for (const entry of [tier4, tier3]) {
      await page.locator(SEL.search).fill(entry.nameZh);
      const card = page.locator(SEL.foodCard(entry.id));
      await expect(card).toBeVisible();
      await expect(card.locator(".food-card__badge--common")).toHaveCount(entry.commonness >= 4 ? 1 : 0);
      await expect(card.locator(".food-card__amount")).not.toHaveText("");
    }

    await page.locator(SEL.search).fill(tier4.nameZh);
    await expect(page.locator(SEL.foodCard(tier4.id)).locator(".food-card__badge--common"))
      .toHaveText("常见");
    expect(await commonnessOfFood(tier4.id)).toBe(4);

    expect(errors).toEqual([]);
  });
});
