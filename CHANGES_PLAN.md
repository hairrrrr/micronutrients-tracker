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

## P19 - Per-10 g ranking for condiments and dried goods (user decision after v1.1 review)
- **P19a (supervisor):** create `data-src/small_portion_foods.csv` (`food_id,name_zh,basis_g,rule`) with 58 flagged foods:
  - every food in the categories 调味料, 香辛料 and 食用油脂
  - an explicit, reviewed list: 大蒜, 小葱, 细香葱, dried shiitake, dried wood ear, agar, spirulina, dehydrated radish/carrot, sun-dried tomato, dried tofu, sesame seeds/paste, flaxseed and chia

  Fresh seaweed (海带/紫菜/裙带菜 raw in SR Legacy) is not flagged, because the data is for the raw form.
- **P19b (hms):** build_foods.py adds `amountBasisG` (10 or 100) to every food. Rules:
  - Ordering: commonness tier first. Within a tier, richness = per100g[n] * amountBasisG / 100, then nameZh.
  - Flagged cards show the amount per 10 g with a clear "每 10 g" label; other cards show "每 100 g".
  - About explains the rule. The food list heading is renamed from 「食物含量排行」 to 「常见食物」.

  Commit: `feat(order): rank condiments and dried goods per 10 g`

AC:
- The validator checks that every flagged id exists and that amountBasisG ∈ {10, 100}.
- Unit tests cover the ordering and the card labels.
- e2e: in the calcium tab, garlic is no longer ahead of tofu or milk-tier foods with more calcium per 100 g than garlic's per-10 g value. Flagged cards show "每 10 g". The heading reads 常见食物.
- npm test and Playwright pass.

## P20 - Ingredients only, raw meat only, bone-in handling, more whole grains (user decisions after v1.1)
- **P20a (supervisor data prep):**
  - `data-src/bone_in_foods.csv`: 15 bone-in raw foods with the USDA SR28 FOOD_DES refuse % (source zip sr28asc.zip, sha256 8308fd1d…e70a), e.g. spare ribs 30% bone and chicken wing 38%. Drumstick uses 33%: the SR28 Refuse field reads 66, but its own description lists 33% twice, so it is flagged for review.
  - `data-src/p20/add_curated.csv` (11 new raw SR Legacy foods, found with tools/search_usda.py):
    - raw replacements for cooked-only cuts: pork composite 167888, beef rib 168675, beef short ribs 169439, chicken gizzard 171456, ground turkey 171505, turkey liver 171486
    - whole grains: wild rice 169726/168897, rye grain 168884, cooked oatmeal 173905, hulled barley 170283
  - `data-src/p20/add_commonness.csv`: tiers for these 11 foods from the hms API scorer, reviewed by the supervisor.
  - Not in SR Legacy, so not added: black rice, rye flakes (rye grain added instead), a "mixed grain rice" blend (component grains are present instead), raw chicken feet (cooked 鸡爪 dropped) and a raw equivalent of lean roasted ham (火腿 dropped).
- **P20 (hms):**
  - remove all 24 dish estimates and tap water
  - drop 33 cooked meat entries
  - add the 11 foods
  - add bone-in handling: household measures and grams are with-bone weights, edible grams = grams × (1 − refuse), shown on the card and in About

  Commit: `refactor(data): drop dish estimates and cooked meats, add bone-in handling`

AC:
- validator: no composites, no cooked meat entries, bone-in foods valid
- check_values 50/50
- unit tests for the edible-gram conversion
- e2e: no dish names, and the spare-rib card shows the with-bone note
- all tests pass

## P21 - More raw leafy greens and a food detail view (user requests after v1.1)
- **P21a (supervisor data, done):**
  - Already present raw: 空心菜 169301 (Water convolvulus, raw), 茼蒿 168491 (Chrysanthemum leaves, raw), pak-choi 170390.
  - 小油菜 / 上海青 are pak-choi; SR Legacy has one pak-choi entry, so 170390/170391 are renamed 小白菜/上海青 (aliases keep 小油菜, 青菜).
  - Added: 红薯叶（生） 169303 (Sweet potato leaves, raw), 莴笋（生） 169990 (Celtuce, raw), commonness 3 and 4 from the hms API scorer.
  - Not in SR Legacy: 莴笋尖 (celtuce leaf tips) has no own entry; the celtuce row (with a USDA 一片（叶） portion) and the leaf lettuces are the closest.
  - Measures: USDA portions plus an estimate 一根 300 g for celtuce (default).
- **P21b (hms): pure core `docs/js/core/detail.js`**
  - `detailRows(food, targets, nutrients, grams)` returns all 22 nutrients: per-100 g amount, % of the daily target per 100 g, and, when grams is given, the amount and % for that quantity (edible grams for bone-in foods).
  - Order: nutrients with a value > 0 and a target by % descending; then value > 0 without a target (by amount); then value 0 (label 不含); then null/missing (label 无数据).
  - Unit tests. Commit: `feat(core): add food detail ranking`
- **P21c (hms): UI**
  - In the expanded tile, a 「查看详情」 button next to the title opens a native `<dialog>` (bottom sheet at <= 600 px, centered dialog wider), title = food name, the basis note (每 100 g; 每 10 g foods also show the per-10 g amount), and one row per nutrient: name, per-100 g amount + unit, % bar, and the chosen-quantity amount and %.
  - Esc, 关闭 button and backdrop click close it; focus returns to the button. No horizontal overflow at 360/390 px.
  - e2e: open, first row = highest % computed from foods.json + dri.json, 22 rows, Esc closes, focus returns.
  - Commit: `feat(ui): add food detail sheet`

## P22 - Eggs raw only (user decision after v1.2)
- Remove the 3 cooked egg rows from `data-src/foods_curated.csv`, `data-src/measures.csv` and `data-src/commonness.csv`: 172187 炒鸡蛋（全蛋） (Egg, whole, cooked, scrambled), 173423 煎鸡蛋（全蛋） (Egg, whole, cooked, fried), 173424 鸡蛋（水煮，全熟） (Egg, whole, cooked, hard-boiled).
- Keep the raw eggs: 171287 鸡蛋（全蛋，生）, 172183 蛋清（生）, 172184 蛋黄（生）, 172189 鸭蛋（全蛋，生）, 172191 鹌鹑蛋（全蛋，生）. Egg noodles (面条与面食) and mayonnaise (调味料) are not in 蛋类 and stay.
- Validator: extend the raw-only meat check to 蛋类 (no cooked words in name_zh such as 熟/煮/煎/炒/烤/蒸/荷包/炖, and no cooked/fried/scrambled/boiled/poached/omelet/baked in the USDA description). Every 蛋类 food must contain 生 in name_zh.
- Tests: unit data test that 蛋类 is raw-only and the 3 ids are gone; update any unit/e2e test that referenced a cooked egg (use 鸡蛋（全蛋，生） 171287 instead); e2e vitamin A/calcium top checks keep following the P19 rule.
- Rebuild foods.json (618 -> 615 foods); nutrient values of other foods must not change.

  Commit: `refactor(data): keep raw eggs only`

AC: validator exit 0, check_values 50/50, npm test and Playwright pass, no cooked egg name on the site.

## P23 - Detail view lists only nutrients the food contains (user request after v1.2)
- `detailRows` (docs/js/core/detail.js) drops rows whose value is 0 (不含) or null/missing (无数据); the order of the remaining rows is unchanged (with a target by % desc, then without a target by amount desc).
- The 查看详情 dialog renders no 不含 / 无数据 rows; a food without any nutrient value shows 暂无营养素数据.
- Unit tests updated; e2e test 19 computes the expected row count from foods.json and checks that a food with no vitamin D has no vitD row (row count < 22).

  Commit: `feat(ui): list only nutrients the food contains in the detail view`

AC: npm test and Playwright pass.
