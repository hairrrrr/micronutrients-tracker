// End-to-end smoke tests (PLAN.md phase P13).
//
// Nine scenarios that cover the user-visible promises of the app: the profile
// and standard switch, selecting a food, the cross-tab pinning, a target card
// turning green, the surplus wording, persistence across a reload, no
// horizontal overflow at 390 px, the same site served from a sub-path and
// (P16) a selected food that lacks the nutrient not appearing in that tab.
// Every flow goes through the real UI; only the reset touches localStorage.
//
// The reference numbers used here are the fixed DRI fixtures of the unit
// tests (Cn male 30-49 iron 12 mg, US male 31-50 iron 8 mg, vitamin A 770 /
// 900 ug RAE) and the fixed food fixture fdc:167862 (raw pork liver,
// 6502 ug RAE and 26 ug B12 per 100 g). No nutrient or DRI value is invented
// in this file.

import { expect, test } from "@playwright/test";
import { SUBPATH_BASE } from "../../playwright.config.mjs";
import {
  CARROT_ID,
  CARROT_NAME,
  LIVER_ID,
  LIVER_NAME,
  SEL,
  cardStatus,
  cardTarget,
  measureOverflow,
  resetApp,
  selectFood,
  setGrams,
  watchErrors,
} from "./helpers.mjs";

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
    await expect(page.locator(SEL.editor(LIVER_ID))).toBeVisible();
    await expect(page.locator(SEL.editor(LIVER_ID))).toContainText("约 100 g");

    // 100 g of raw pork liver = 6502 ug RAE, far above the 660 ug target.
    await expect(page.locator(SEL.cardStatus("vitA"))).toHaveText("+5842 ug RAE");
    await expect(page.locator(SEL.card("vitA"))).toHaveClass(/is-met/);

    // The selection is stored in the documented state shape.
    const stored = await page.evaluate(() => window.localStorage.getItem("mnt.state.v1"));
    expect(stored).toContain(LIVER_ID);

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
    // ... and it keeps its quantity editor on the new tab.
    await expect(page.locator(SEL.editor(LIVER_ID))).toContainText("约 100 g");

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
    await expect(page.locator(`${SEL.editor(LIVER_ID)} [data-grams]`)).toHaveValue("20");

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
    await expect(page.locator(`${SEL.editor(LIVER_ID)} [data-grams]`)).toHaveValue("80");
    // 80 g x 26 ug / 100 g = 20.8 ug against the 2.4 ug US target.
    await expect(page.locator(SEL.cardStatus("vitB12"))).toHaveText("+18.4 ug");

    expect(errors).toEqual([]);
  });

  test("7. no horizontal overflow at 390 and 360 px", async ({ page }) => {
    const errors = watchErrors(page);
    await resetApp(page);

    // The whole page, with a selection and its editor open, at 390 x 844.
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    await selectFood(page, "猪肝");
    await setGrams(page, 250);
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
      expect(height, `${selector} height at 360 px`).toBeGreaterThanOrEqual(38);
    }

    // The stepper and the gram input are two different editor modes: check the
    // stepper in household mode and the input after switching to "克".
    await page.locator(SEL.editor(LIVER_ID)).locator("[data-measure]")
      .selectOption({ index: 0 });
    const stepHeight = await page.locator(`${SEL.editor(LIVER_ID)} [data-step]`).first()
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(stepHeight).toBeGreaterThanOrEqual(38);
    await setGrams(page, 250);
    const gramsHeight = await page.locator(`${SEL.editor(LIVER_ID)} [data-grams]`)
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(gramsHeight).toBeGreaterThanOrEqual(38);

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
    // listed in that tab, and its cross-tab editor is gone with it.
    await expect(page.locator(SEL.foodCard(CARROT_ID))).toHaveCount(0);
    await expect(page.locator(`.food-cell[data-food-cell="${CARROT_ID}"]`)).toHaveCount(0);
    await expect(page.locator(SEL.editor(CARROT_ID))).toHaveCount(0);

    // The selection itself is untouched: back in the vitamin A tab the carrot
    // is pinned first and still selected.
    await page.locator(SEL.tab("vitA")).click();
    await expect(page.locator(SEL.tab("vitA"))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".food-cell").first()).toHaveAttribute("data-food-cell", CARROT_ID);
    await expect(page.locator(SEL.foodCard(CARROT_ID))).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SEL.editor(CARROT_ID))).toBeVisible();
    const stored = await page.evaluate(() => window.localStorage.getItem("mnt.state.v1"));
    expect(stored).toContain(CARROT_ID);

    expect(errors).toEqual([]);
  });
});
