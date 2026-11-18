// Screenshots of the finished UI (PLAN.md phase P13).
//
// Three images, written to shots/ next to the repo root:
//   desktop-1440.png         the page at 1440 x 900
//   mobile-390.png           the page at 390 x 844, default state
//   mobile-390-selected.png  the same, with a selected food and its editor open
//
// Only the page is captured (full page), not the browser chrome. The default
// state is freshly cleared for every shot, so the images are reproducible.

import { expect, test } from "@playwright/test";
import { LIVER_ID, openTile, resetApp, selectFood, setGrams, watchErrors } from "./helpers.mjs";

/** Folder of the images, relative to the repo root (Playwright's cwd). */
const SHOTS = "shots";

test("desktop 1440 px screenshot", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetApp(page);

  // A small selection so the target cards show a mix of remaining and met.
  // The search box is cleared again so the shot shows the normal ranking with
  // the selected food pinned on top.
  await selectFood(page, "猪肝");
  await setGrams(page, 10);
  await page.locator("[data-food-search]").fill("");
  // 60 unpinned cards of the default limit plus the pinned selection.
  await expect(page.locator(".food-card")).toHaveCount(61);

  await page.screenshot({ path: `${SHOTS}/desktop-1440.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("mobile 390 px screenshot", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await resetApp(page);

  await page.screenshot({ path: `${SHOTS}/mobile-390.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("mobile 390 px screenshot with a selected food", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await resetApp(page);

  await selectFood(page, "猪肝", LIVER_ID);
  await setGrams(page, 100);
  await page.locator("[data-food-search]").fill("");
  // P17: the selected card is compact again after the confirm; reopen its tile
  // so the shot shows the expanded editor at the pinned food's position.
  await openTile(page, LIVER_ID);
  await expect(page.locator(`[data-food-editor="${LIVER_ID}"]`)).toBeVisible();
  // 60 unpinned cards of the default limit plus the pinned selection.
  await expect(page.locator(".food-card")).toHaveCount(61);

  await page.screenshot({ path: `${SHOTS}/mobile-390-selected.png`, fullPage: true });
  expect(errors).toEqual([]);
});
