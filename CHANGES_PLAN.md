# v1.1 changes (from the user's review of the live site, 2026-11-18)

Same rules as PLAN.md section 0. One commit per phase, English Conventional Commit titles. hms phases are driven through the wrapper; the supervisor verifies every acceptance criterion (AC) and logs results in NIGHT_LOG.md.

## P16 - Pin only foods that contain the nutrient (hms)
Bug: a selected food was pinned in a nutrient tab even when it has no value for that nutrient (carrot selected in Vitamin A was pinned in Vitamin D).
Rule: in the tab for nutrient n, a selected food is pinned only if `per100g[n] > 0`. Foods with `per100g[n]` = 0, null or missing are not listed in that tab at all, whether selected or not.
Commit: `fix(order): pin and list only foods that contain the nutrient`
AC: unit tests in order.test.mjs: a selected food with 0, null and missing values is neither pinned nor listed; a selected food with a value > 0 is pinned. An e2e test selects carrot (fdc:170393 or the carrot in foods.json) in Vitamin A, switches to Vitamin D, and checks that carrot is not in the list. `npm test` and `npx playwright test` pass.

## P17 - Expand-in-place selection editor (hms)
- (a) Tapping an unselected card does not move it. The card expands in place into a larger editing tile spanning the grid row, and the cards around it stay in normal flow.
- (b) The expanded tile has a quantity editor (household measure or grams), a confirm control (a check-mark button at the top right plus a 确认 button) and a cancel control (取消 / ×).
  - Only confirm selects the food. It then collapses and joins the pinned group at the BOTTOM: pinned order is confirmation order, kept in state, persisted and migrated from old saved state.
  - Cancel collapses the tile without selecting.
  - Tapping a selected card reopens its editor in place. Its options are change quantity + confirm, 取消选择 (deselect), or cancel.
- (c) Fix the bug where the measure picker (unit select) opens a second time after a choice. Find the root cause (duplicate listeners or a re-render that re-opens or re-focuses the picker) and describe it in NIGHT_LOG.
- Borrow patterns only from permissively licensed projects and credit them in README.

Commit: `feat(ui): expand food cards in place with confirm before selecting`
AC: unit tests for state, covering confirmation-order pinning, cancel, deselect and the migration of old state. order.js uses the selection order for the pinned group. e2e:
- tap a card: its index in the list is unchanged and it is expanded
- cancel: nothing is selected
- confirm: the card is pinned last among the selected cards
- change the unit once: exactly one change event is handled and the select is not re-opened or re-focused (no duplicate listeners: the listener count stays 1 after re-renders)
- no horizontal overflow at 390 px

All tests pass.

## P18 - Order by commonness first, richness second
- **P18a (supervisor script calling the hms model):**
  - The script /workspace/vita-tools/score_commonness.py lives outside the repo. It reads the API key at runtime from the OpenCode config's file reference and never prints or stores it.
  - It sends batches by category with fdc id/food id, name_zh, name_en and category to the model, which returns JSON tiers and reasons.
  - Tiers: integer 1-5, where 5 = everyday staple anywhere in mainland China and 1 = rare, imported or specialty. References: the Chinese Dietary Guidelines food guidance, how often and how much an item appears in common home dishes, and how much it is discussed on Chinese community platforms.
  - Output goes to `data-src/commonness.csv` (`food_id,name_zh,commonness,reason_zh`).
  - Supervisor sanity review: rice, eggs, pork, napa cabbage, tofu and milk must be 5; kohlrabi, caribou and similar must be low. Every change is logged.

  Commit: `feat(data): add AI-estimated commonness tiers for foods`
- **P18b (hms):**
  - build_foods.py merges `commonness` (integer only) into foods.json and strips `reason_zh`.
  - The validator checks that every food in foods.json has a tier of 1-5, and that no reason text is anywhere under docs/ (it greps for each reason string).
  - order.js sorts the unpinned list by commonness desc, then per100g desc, then name.
  - Food cards show a small 常见 badge for tiers 4-5 and keep the per-100 g amount.
  - The About section says that commonness tiers are an estimate by an AI model.

  Commit: `feat(order): sort foods by commonness first and richness second`
AC: validator OK; unit tests for the new ordering; a test that docs/data/*.json contains no `reason` keys or reason strings; e2e still passes; the top of the Vitamin A and Calcium tabs is made of common foods.

## Release
Push to origin main, wait until Pages is `built`, confirm that the live site shows the changes (live smoke test), and take fresh screenshots into shots/: desktop 1440, mobile 390 and mobile 390 with an expanded editor.
