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

## P24 - Fish and seafood raw only (user decision after v1.3)
Scope: categories 鱼类, 虾蟹类, 贝类. Seaweed (海藻类), vegetables and tubers are unchanged (dried agar and spirulina stay).
- Remove these 28 cooked, canned, salted or dried seafood rows from `data-src/foods_curated.csv`, `data-src/measures.csv` and `data-src/commonness.csv`:
  167742 扇贝（蒸）, 171956 大西洋鳕鱼（熟）, 171971 虾（混合种，熟）, 171975 蛤蜊（熟）, 171976 蛤蜊（罐装）, 171980 东部牡蛎（熟）, 171981 东部牡蛎（罐装）, 171986 金枪鱼（水浸罐装）, 171990 太平洋鳕鱼（熟）, 172006 黄鳍金枪鱼（熟）, 172007 首长黄道蟹（熟）, 172009 多棘龙虾（熟）, 172010 墨鱼（熟）, 173693 红鲑（罐装）, 174185 鲤鱼（熟）, 174190 大西洋鳕鱼（盐腌风干）, 174194 鳗鱼（熟）, 174202 阿拉斯加帝王蟹（熟）, 174205 蓝蟹（熟）, 174207 小龙虾（熟）, 174209 北方龙虾（熟）, 174217 蓝贻贝（熟）, 174249 章鱼（熟）, 174250 太平洋牡蛎（熟）, 175139 沙丁鱼（油浸罐装）, 175158 白金枪鱼（水浸罐装）, 175168 大西洋鲑鱼（养殖，熟）, 175180 虾（熟）.
- Raw equivalents already in the list for all of them except Pacific cod; add that one raw SR Legacy row (supervisor-checked):
  - foods_curated.csv: `174191,太平洋鳕鱼（生）,Fish cod Pacific raw,鱼类,鳕鱼|太平洋鳕`
  - commonness.csv: `fdc:174191,太平洋鳕鱼（生）,3,鳕鱼常见于超市冻品，但多为进口、价格偏高` (hms API scorer, reviewed by the supervisor)
  - measures from tools/suggest_measures.py (USDA portions first, palm-sized estimate like other fish, exactly one default).
- No raw SR Legacy row exists for sardine (only canned) and white/albacore tuna (only canned); they are dropped without substitute (raw bluefin, yellowfin and skipjack tuna remain).
- Validator: reject any food in 鱼类/虾蟹类/贝类 whose name_zh contains 熟/蒸/煮/烤/煎/炸/罐装/腌/干/熏 or whose USDA description contains cooked/canned/dried/salted/smoked/fried/baked/broiled/steamed/moist heat/dry heat; every such food must contain 生 in name_zh.
- Tests: unit data test (seafood raw-only, the 28 ids gone, 174191 present); update unit/e2e tests that referenced removed seafood ids; P19/P20/P22 checks still pass.
- Rebuild foods.json (615 -> 588 foods); nutrient values of other foods must not change.

  Commit: `refactor(data): keep raw fish and seafood only`

AC: validator exit 0, check_values 50/50, npm test and Playwright pass.

## P25 - User-owned branded milks pinned at the top of the calcium tab (user request after v1.4)
- **P25-data (supervisor, done):** `data-src/custom_foods.csv` (3 rows, the site's input) and `data-src/custom_labels.csv` (full label transcription, archive only, not used by the build).
  - Base unit: like every other food, values are per 100 g. The powder row is per 100 g of POWDER (calcium 288 mg per 25 g serving -> 1152 mg/100 g); the two fluid milks are per 100 g of milk (label per 100 mL / 1.03 g/mL: 130 -> 126.2 mg, 120 -> 116.5 mg).
  - Calcium = label value. All other micronutrients are copied from the USDA SR Legacy base food (`base_fdc_id`: 170877 nonfat dry milk without added A/D for the powder; 173432 nonfat fluid milk without added A/D for both fluid milks), computed exactly like a normal SR Legacy food (including niacin NE), then the nutrients in `null_nutrients` (vitA|vitD|vitE) are set to null (unfortified, no data).
  - `source_note_zh` and `custom_labels.csv` stay in data-src only; nothing from them goes to docs/.
- **P25a (hms): build + validator + unit tests**
  - build_foods.py reads custom_foods.csv and appends 3 foods to foods.json: `id` = food_id, `fdcId: null`, `nameZh`, `nameEn`, `usdaDescription: null`, category, aliases, `per100g` as above, `flags` like the base food, `source: {"type": "package_label", "baseFdcId": <n>, "estimated": [all nutrient ids except calcium and the null ones]}`, `pinTop: ["calcium"]`, `commonness` from commonness.csv, `amountBasisG: 100`.
  - commonness.csv: add the 3 ids with commonness 4 and reason 用户自家常备的品牌牛奶 (data-src only).
  - measures.csv (food_key = the custom id): powder `cup,一杯（25 g 奶粉冲 250 mL）,25,label:serving 25 g powder in 250 mL water,1`; each fluid milk `cup,一杯（250 mL）,257.5,label:250 mL x 1.03 g/mL,1` and `box,一盒（250 mL）,257.5,label:250 mL x 1.03 g/mL,0` (validator accepts a `label:` basis).
  - Validator: custom rows need source=package_label, an existing base_fdc_id, a numeric calcium, null_nutrients from the nutrient list, pin_top from the nutrient list; foods.json custom foods have fdcId null and a `source` object; still no Chinese reason text under docs/. check_values.py keeps sampling only foods with fdcId.
  - Unit tests: the 3 foods exist with the expected calcium (1152, 126.2, 116.5), vitA/vitD/vitE null, another nutrient (e.g. phosphorus) equals the base USDA food value, pinTop calcium, measures.
  - Commit: `feat(data): add user-owned branded milks from package labels`
- **P25b (hms): ordering + UI + e2e**
  - order.js: in a nutrient tab, order = selected pinned group (unchanged P17 rule, includes a selected custom milk) -> unselected foods whose `pinTop` contains this nutrient, in foods.json order -> the usual commonness/richness order. Other tabs treat these foods normally.
  - Card and detail view show a small badge 包装标签 for foods with `source.type === "package_label"`; the detail view adds one short line 钙为包装标签值，其余营养素参考 USDA 同类食品估算 for them. About gets one sentence about user-added label foods. No other Chinese text from data-src.
  - Unit tests for the ordering; e2e: calcium tab first 3 cards = 德运脱脂奶粉, 山姆部分脱脂牛奶, 盒马零脂牛奶; the powder card's default measure is 一杯（25 g 奶粉冲 250 mL） and confirming it adds 288 mg calcium; after confirming another calcium food it is pinned above the milks; the vitamin A tab does not lead with the milks.
  - Commit: `feat(ui): pin user-owned milks at the top of the calcium tab`

## D - Documentation (Chinese, after P20-P25 were accepted)
Style: like a well-written Chinese engineering handbook (plain words, short sentences, a layperson can follow; every claim names the real file/function; describe only what the code does now). Model: per-diagram `**图解：…**` one-line summary + 2-4 bullets under each image; glossary tables with columns 术语 | 英文全称 | 中文 | 在本项目里.
Location: GitHub Pages serves `docs/`, so ALL new markdown goes to a top-level `documentation/` folder (never inside `docs/`); `README.md` stays at the repo root. Diagrams: `documentation/diagrams/<name>.dot` sources rendered to `<name>.svg` by `documentation/diagrams/build.mjs` (Node, devDependency `@viz-js/viz`, Graphviz compiled to WebAssembly, because the box has no system `dot`), `npm run docs:diagrams`.
Colour legend used by every diagram (and stated once in each doc that shows diagrams): yellow `#FFF4D6/#C9A227` = input/output (user, browser, files the user sees); blue `#EAF2FB/#4A78A8` = our own code; green `#E8F6EA/#3C8D4F` = external source (USDA, CNS/NASEM tables, GitHub Pages); red `#FCE8E6/#C0392B` = rejected / error path; purple cylinder `#F1ECF8/#7D5BA6` = stored data (CSV, JSON, localStorage). Font "Noto Sans CJK SC".
Facts that must match the repo (check, don't copy blindly): 591 foods in docs/data/foods.json (588 USDA SR Legacy 2018-04 + 3 package-label milks), 22 nutrients, 33 categories, 58 foods ranked per 10 g, 15 bone-in foods, DRI CSVs cn2023.csv and us.csv (220 data rows each), unit tests `npm test`, e2e `npx playwright test` (count them by running). Never mention API keys, the development relay/model provider, HANDOFF.md content, paths outside the repo, or personal data.

- **D1 diagram tooling + 5 diagrams.** `documentation/diagrams/build.mjs` (shared style helpers + legend subgraph option), devDependency `@viz-js/viz`, npm script `docs:diagrams`. Diagrams: `overview` (offline data build -> static site -> browser, localStorage), `data-build` (USDA CSV + data-src CSVs -> tools/build_foods.py / build_dri.py -> validate_data.py -> docs/data/*.json, rejected rows in red), `modules` (docs/js/app.js, core/* pure modules, ui/* modules and what each reads), `ordering` (selected pinned group -> pinTop foods -> commonness tier -> richness per 100 g / per 10 g), `intake` (selection -> grams -> edible grams for bone-in -> per100g -> totals -> target cards: remaining / met / +surplus / UL warning). AC: 5 .dot + 5 .svg, each SVG contains Chinese text and a legend; `npm run docs:diagrams` regenerates with no git diff. Commit `docs: add diagram tooling and five diagrams`.
- **D2 glossary + index.** `documentation/GLOSSARY.md` (>= 25 terms: DRI, RNI, AI, RDA, UL, EAR, RAE, NE, DFE, alpha-TE, SR Legacy, FDC ID, refuse, per 100 g, ES module, localStorage, GitHub Pages, static site, Playwright, node --test, commonness tier, pinTop, package label, etc.) and `documentation/README.md` (目录: one line per doc, reading order for a beginner). AC: tables in the 4-column format; every term used in later docs appears here. Commit `docs: add glossary and documentation index`.
- **D3 root README (Chinese).** Rewrite `README.md` in Chinese: what the site does (with live URL and 2 screenshots from shots/), features list, data sources and licences, how to run locally / tests / data build, folder layout, links to documentation/, existing credits/licence lines kept. AC: all links and image paths exist; commands match package.json. Commit `docs: rewrite README in Chinese`.
- **D4 architecture.** `documentation/ARCHITECTURE.md` (架构): overview + data-build + modules diagrams with 图解, folder-by-folder table, data files and their fields (foods.json food object, dri.json, nutrients.json, meta.json), state in localStorage, deployment from /docs. AC: every path/function named exists. Commit `docs: add architecture`.
- **D5 key implementation.** `documentation/KEY_IMPLEMENTATION.md` (关键实现): DRI target lookup (dri.js), intake totals and card status (calc.js), household measures and bone-in edible grams (measures.js), ordering (order.js incl. per-10 g basis and pinTop), detail ranking (detail.js), data build rules (raw-only meat/eggs/seafood, no dishes, package-label foods, per-10 g list), validator checks, testing strategy. Short real code excerpts (<= 15 lines each) quoted from the files. AC: excerpts match the files verbatim. Commit `docs: add key implementation notes`.
- **D6 beginner explainer.** `documentation/EXPLAINED.md` (入门讲解): for someone who has never coded: what a micronutrient target is, how one tap on a food becomes numbers on the cards (worked example with real numbers from foods.json/dri.json, e.g. 25 g 德运脱脂奶粉 = 288 mg calcium vs the default target), why data is built offline, how the pages are served, how tests protect behaviour; uses the ordering + intake diagrams. AC: worked-example numbers recomputed from the JSON. Commit `docs: add beginner explainer`.
- **D7 check + wrap-up.** `tools/check_docs.mjs` (no dependencies besides Node): every relative link/image in README.md and documentation/*.md resolves, every backticked repo path exists, no `documentation` file under docs/; npm script `docs:check`; run diagrams build (no diff) and fix any broken link. AC: `npm run docs:check` exit 0; npm test and Playwright still pass. Commit `docs: add documentation link check`.
- **D5a (salvage, after D5 tries 1-2 timed out at 1800 s).** documentation/KEY_IMPLEMENTATION.md was left untracked but complete (sections 一-八, 11 code excerpts; supervisor checked all excerpts appear verbatim in the repo and all paths/functions exist). hms: read it once, fix only clear errors, run npm test, log, commit `docs: add key implementation notes`. Must finish in about 5 minutes.
