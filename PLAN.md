# PLAN - Micronutrients Tracker

Answer to `SPEC_FOR_CLAUDE.md`. Written by the supervisor (Grok Bot) on 2026-11-18 because the browser Claude's free quota ran out.
Builder: the `hms` model (`deepseek-v4.1-flash-free`) via OpenCode, driven phase by phase by a supervisor bot.

- Repository: `hairrrrr/micronutrients-tracker` (public). Local working copy: `/workspace/vita-site`.
- Review URL (GitHub Pages): `https://hairrrrr.github.io/micronutrients-tracker/`
- Final domain (later, user creates DNS): `micronutrients.lianboji.club`
- UI language: Simplified Chinese. Code, comments, commit titles: English. Commit bodies may be Chinese.

---

## 0. Rules for the builder (read before every phase)

1. **Never invent numbers.** Nutrient values come only from the downloaded USDA SR Legacy CSV files via scripts. DRI values come only from `data-src/dri/*.csv`, which the supervisor fills from official sources. If a value is unknown, leave it empty / `null` and say so. Never "fill in from memory".
2. **One phase (or sub-step) = one commit.** Finish with `git add -A && git commit` using an English Conventional Commit title, e.g. `feat(data): build foods.json from SR Legacy`. Never rewrite history, never force-push.
3. **Keep the repo working.** Before committing, run the phase's acceptance commands. If a check fails and you cannot fix it, commit nothing; write what failed into `NIGHT_LOG.md` instead.
4. **Small steps.** The API is unreliable. Prefer several short file writes over one huge one. After an interruption, start with `git status` and `git log --oneline -5` and continue from there.
5. **No secrets, no private data.** Do not read or write anything outside `/workspace/vita-site` (except the read-only raw data dir `data-raw/` inside it). Do not print environment variables.
6. **No new runtime dependencies.** The site is plain HTML + CSS + ES modules (no framework, no bundler). Dev dependencies allowed: `@playwright/test` only. Data tools are Python 3 standard library only.
7. **Relative paths only.** No URL or `fetch()` path may start with `/`. The site must work at `https://host/` and at `https://host/any/sub/path/`.
8. Append a short entry to `NIGHT_LOG.md` at the end of each phase: time (Asia/Taipei), phase, what you did, checks run and results.

---

## 1. Architecture

### 1.1 File layout

```
/workspace/vita-site
  PLAN.md  SPEC_FOR_CLAUDE.md  NIGHT_LOG.md  README.md  DEPLOY.md
  HANDOFF.md            (gitignored; supervisor notes)
  package.json          npm scripts only; devDependency @playwright/test
  .gitignore            node_modules/, data-raw/, test-results/, playwright-report/, HANDOFF.md
  tools/                Python 3 stdlib data pipeline (never shipped)
    fetch_usda.sh        download + sha256-check SR Legacy into data-raw/
    usda_lib.py          CSV loading helpers (food, nutrient, food_nutrient, food_portion)
    search_usda.py       CLI: search SR Legacy descriptions -> fdc_id, description, category
    build_foods.py       data-src/*.csv + data-raw -> docs/data/foods.json
    build_dri.py         data-src/dri/*.csv -> docs/data/dri.json
    validate_data.py     all data checks; exit 1 on any failure
    check_values.py      independent spot-check: re-reads raw CSV and compares with foods.json
  data-raw/             (gitignored) USDA CSVs
  data-src/             human/AI-curated inputs (committed, reviewable)
    nutrients.csv        nutrient metadata
    foods_curated.csv    which foods to include + Chinese names
    measures.csv         household measures per food
    composites.csv       labeled estimates for Chinese dishes (recipe-based)
    dri/cn2023.csv       Chinese DRIs 2023 (supervisor-entered)
    dri/us.csv           US DRIs (supervisor-entered)
  docs/                 THE STATIC SITE (GitHub Pages serves main:/docs)
    index.html
    css/style.css
    js/app.js            bootstraps: load JSON, init state, render, wire events
    js/core/nutrients.js metadata helpers
    js/core/dri.js       age-group mapping + target lookup
    js/core/calc.js      intake totals, status (remaining / surplus / met / overUL), formatting
    js/core/measures.js  quantity -> grams
    js/core/order.js     per-nutrient food ordering with pinned selections
    js/core/state.js     state model, pure reducers, localStorage load/save
    js/ui/profile.js     sex/age/life stage + side-by-side CN/US standards + toggle
    js/ui/targets.js     target cards
    js/ui/tabs.js        nutrient tabs
    js/ui/foods.js       food cards + quantity editor
    js/ui/about.js       data sources + disclaimer
    data/nutrients.json  data/foods.json  data/dri.json  data/meta.json
    CNAME                (added only at the custom-domain step; not before)
  tests/unit/*.test.mjs  node --test (no deps)
  tests/e2e/smoke.spec.mjs  Playwright, system Chrome
  playwright.config.mjs
  shots/                final screenshots
  research/DATA_SOURCES_NOTES.md
```

Why no build step: ES modules + `fetch('data/foods.json')` with relative URLs run directly on GitHub Pages under any base path. The core modules are pure functions, so `node --test` imports them directly.

### 1.2 Nutrients in scope (v1)

`data-src/nutrients.csv` columns: `id,name_zh,name_en,unit,usda_nutrient_id,color,kind,note`

| id | name_zh (UI) | unit | USDA SR Legacy nutrient id | note |
|---|---|---|---|---|
| vitA | Vitamin A | ug RAE | 1106 | |
| vitD | Vitamin D | ug | 1114 | |
| vitE | Vitamin E | mg | 1109 | USDA = alpha-tocopherol only; CN target is alpha-TE |
| vitK | Vitamin K | ug | 1185 | phylloquinone |
| vitC | Vitamin C | mg | 1162 | |
| thiamin | Vitamin B1 | mg | 1165 | |
| riboflavin | Vitamin B2 | mg | 1166 | |
| niacin | Niacin | mg NE | 1167 (+1210) | NE = niacin_mg + tryptophan_g*1000/60; if tryptophan missing use niacin only and set flag |
| vitB6 | Vitamin B6 | mg | 1175 | |
| folate | Folate | ug DFE | 1190 | |
| vitB12 | Vitamin B12 | ug | 1178 | |
| pantothenic | Pantothenic acid | mg | 1170 | |
| choline | Choline | mg | 1180 | |
| calcium | Calcium | mg | 1087 | |
| phosphorus | Phosphorus | mg | 1091 | |
| potassium | Potassium | mg | 1092 | |
| magnesium | Magnesium | mg | 1090 | |
| iron | Iron | mg | 1089 | |
| zinc | Zinc | mg | 1095 | |
| selenium | Selenium | ug | 1103 | |
| copper | Copper | mg | 1098 | |
| manganese | Manganese | mg | 1101 | |

(`name_zh` must be the standard Simplified Chinese nutrient name; the table above shows English for readability.)
Out of v1: iodine and biotin (no SR Legacy data), sodium (a limit, not a target), molybdenum, chromium, fluoride. List them on the About section as "not tracked, no food data / not a target".
Colors: 22 distinct pastel background colors with dark text (WCAG AA contrast >= 4.5:1). The "met" state uses one green (`#c8f2d0` bg, `#145c2a` border) that is not used by any nutrient color.

### 1.3 Data pipeline

```
fetch_usda.sh --> data-raw/FoodData_Central_sr_legacy_food_csv_2018-04/*.csv   (sha256 b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0)
data-src/foods_curated.csv + measures.csv + composites.csv + nutrients.csv
      --build_foods.py--> docs/data/foods.json, docs/data/nutrients.json
data-src/dri/cn2023.csv + us.csv --build_dri.py--> docs/data/dri.json
validate_data.py + check_values.py gate every data commit
```

Source: `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip` (public domain / CC0). Foundation Foods is NOT used in v1 (its latest CSV release lacks the needed food/food_nutrient tables and covers fewer foods).

`foods_curated.csv` columns: `fdc_id,name_zh,name_en,category_zh,aliases_zh` (aliases separated by `|`, used by search).
`measures.csv` columns: `food_key,measure_id,label_zh,grams,basis,is_default` where `food_key` is an fdc_id or a composite id, `basis` is `usda_portion:<food_portion.id>` or `estimate:<short English reason>`.
`composites.csv` columns: `composite_id,name_zh,name_en,ingredient_fdc_id,grams_per_100g,note` (one row per ingredient; grams per 100 g of finished dish must sum to 100 +/- 0.5; raw-weight basis, no cooking retention factors - stated in the UI).

`foods.json` shape:

```json
{
  "source": {"name": "USDA FoodData Central SR Legacy", "release": "2018-04", "url": "..."},
  "foods": [
    {"id": "fdc:167862", "fdcId": 167862, "nameZh": "...", "nameEn": "Pork liver, raw", "usdaDescription": "Pork, fresh, variety meats and by-products, liver, raw",
     "category": "...", "aliases": [], "estimate": false, "basis": null,
     "per100g": {"vitA": 6502, "vitB12": 26, "iron": 23.3, "niacin": 20.317, "vitD": null},
     "flags": {"niacinNoTryptophan": false},
     "measures": [{"id": "piece", "labelZh": "...", "grams": 100, "basis": "estimate:...", "default": true}]}
  ]
}
```

Rules: `null` = no data (shown as "no data", contributes 0, and the food is not listed in that nutrient's group). Values are rounded to at most 4 significant digits, never otherwise changed. Composite foods have `"estimate": true` and `"basis"` listing ingredients and grams.

`dri.json` shape:

```json
{
  "standards": {
    "cn2023": {"label": "...", "source": "...", "groups": [
      {"id": "cn-m-30-49", "sex": "male", "ageMin": 30, "ageMax": 49, "lifeStage": "none",
       "values": {"iron": {"target": 12, "type": "RNI", "ul": 42, "ulNote": null, "ref": "CNS DRIs 2023 Table 11"}}}]},
    "us": {"...": "..."}
  }
}
```

### 1.4 DRI data and age-group mapping

- `data-src/dri/*.csv` columns: `standard,group_id,sex,age_min,age_max,life_stage,nutrient_id,target,target_type,ul,ul_applies_to_food,source_ref,verified_by`
  - `target_type`: `RNI`/`AI` (CN) or `RDA`/`AI` (US). `ul` empty if none. `ul_applies_to_food` = `no` when the UL covers only supplements/synthetic forms (e.g. folate, niacin, magnesium in US; folate synthetic in CN) - then no UL warning is shown.
  - `source_ref`: e.g. `CNS DRIs 2023 Table 11 (cnsoc.org image)` or `NIH ODS Vitamin A fact sheet, Table 1`.
  - `verified_by`: filled ONLY by the supervisor after checking against the official source. `build_dri.py` refuses to build (exit 1) if any row has empty `verified_by`.
- Chinese groups (adults, v1): 18-29, 30-49, 50-64, 65-74, 75+ for male and female (official tables 9-14, 20-23). Optional v1.1: pregnancy T1/T2/T3 and lactation, women 18-49 (tables 15-18).
- US groups (v1): 14-18 (used only for age 18), 19-30, 31-50, 51-70, 71+ for male and female. Optional v1.1: pregnancy and lactation.
- Mapping (pure function in `js/core/dri.js`): `findGroup(standard, sex, age, lifeStage)` returns the group whose `[ageMin, ageMax]` contains the integer age (`ageMax` null = open). Age input is an integer 18-100; values outside are clamped and the UI says the site covers adults only.
- The profile panel shows both standards side by side for the chosen profile (two columns: CN 2023 / US, one row per nutrient with target + type, e.g. "800 mg (RNI)"), plus a radio toggle choosing which one drives the calculation.

### 1.5 State model

```js
// localStorage key: "mnt.state.v1"
{
  version: 1,
  profile: { sex: "female" | "male", age: 30, lifeStage: "none" },
  standard: "cn2023" | "us",
  activeNutrient: "vitA",
  selections: { "fdc:167862": { grams: 50, measureId: "piece", count: 0.5 } }
}
```

- Selection is global (keyed by food id), not per nutrient group. That alone gives cross-group sync.
- Reducers in `state.js` are pure: `toggleFood(state, food)` (adds with default measure x1, or removes), `setQuantity(state, foodId, {measureId, count} | {grams})`, `setProfile`, `setStandard`, `setActiveNutrient`, `clearAll`. `save(state, storage)` / `load(storage)` take a storage object (so tests pass a fake). Invalid/corrupt stored JSON -> default state, no crash.
- Default state: female, 30, `cn2023`, `vitA`, no selections.

### 1.6 Calculation (`calc.js`)

- `intakeTotals(selections, foodsById)` -> `{ nutrientId: sum(per100g[n] * grams / 100) }` (null treated as 0).
- `status(target, intake, ul, ulAppliesToFood)` -> `{ remaining: max(target - intake, 0), surplus: max(intake - target, 0), met: intake >= target, overUL: ulAppliesToFood && ul != null && intake > ul }`.
- `formatAmount(value, unit)`: >= 100 -> 0 decimals; >= 10 -> 1 decimal; else 2 significant decimals (trim trailing zeros). Never outputs a minus sign.
- Card text: not met -> "still need X unit" (Chinese); met with surplus > 0 -> "+X unit"; met exactly -> "reached".
- Target missing for the chosen standard/group (no value) -> card shows "no reference value", never green.

### 1.7 Ordering (`order.js`)

`foodsForNutrient(foods, nutrientId, selections, {limit})`:
1. Pinned: selected foods that have a non-null value for this nutrient, sorted by their actual contribution (per100g * grams / 100) descending. (Selected foods with null for this nutrient are not shown in this group.)
2. Then the rest with `per100g[n] > 0`, sorted by `per100g[n]` descending, tie-break by `nameZh`.
3. `limit` (default 60) applies only to the unpinned part; a "show more" button raises it by 60.
Search box (optional, Phase 11b) filters by `nameZh`, aliases, `nameEn`, keeping pinned items on top.

### 1.8 UI components (mobile-first, 390 px design width)

1. Header: title, one-line disclaimer.
2. Profile panel (`profile.js`): sex segmented control, age number input (18-100), life stage select (v1: none only), standards comparison table (CN 2023 | US), radio toggle "use CN / use US". Collapsible on mobile after first set.
3. Target cards (`targets.js`): CSS grid, 3 columns at 390 px, 6+ at desktop; each card = nutrient name, target, remaining or "+surplus", small progress bar; background = nutrient color, or green when met; red outline + warning text when overUL. Tapping a card switches the active nutrient tab.
4. Nutrient tabs (`tabs.js`): horizontally scrollable chip row, active chip uses the nutrient color.
5. Food list (`foods.js`): cards in a 2-column grid (mobile) / 4-column (desktop). Card = Chinese name, English name (small), amount per 100 g for the active nutrient, "estimate" badge if composite. Selected card: green background + quantity editor: measure select (household measures + "grams"), count stepper (0.5 steps) or grams input, computed grams shown ("~ 28 g"). The editor click must not toggle the card.
6. Footer/About (`about.js`): data sources with versions and links, unit notes (vit E, niacin, vit A UL), "household measures are rough approximations", "not medical advice", "data stored only in this browser", clear-all button.

Accessibility: cards are `<button>` or have `role="button"` + `aria-pressed`; inputs have labels; no horizontal page scroll at 360-390 px.

---

## 2. Phases

Each phase: Builder = hms unless marked **[SUPERVISOR]**. Every phase ends with one commit (title given) and a NIGHT_LOG entry. "AC" = acceptance criteria the supervisor checks; the builder should run them too.

Common checks after every phase from P3 on (call them **AC-common**):
- `npm test` exits 0.
- `python3 tools/validate_data.py` exits 0 (once it exists).
- `grep -rnE '(src|href)="/|fetch\(["'"'"']/' docs/` prints nothing.
- `git status --porcelain` is empty after the commit; no file > 2 MB committed; nothing under `data-raw/` committed.

### P0 - Scaffold
Tasks: create `package.json` (name `micronutrients-tracker`, `"type": "module"`, scripts: `test` = `node --test tests/unit/`, `serve` = `python3 -m http.server 8000 -d docs`, `build:data` = `python3 tools/build_foods.py && python3 tools/build_dri.py`, `validate` = `python3 tools/validate_data.py`, `e2e` = `playwright test`), `.gitignore` (node_modules/, data-raw/, test-results/, playwright-report/, HANDOFF.md), `README.md` (short, English), `docs/index.html` (lang `zh-CN`, viewport meta, links `css/style.css` and `js/app.js` relatively, placeholder heading), empty `css/style.css`, `js/app.js` that logs "ok", `tests/unit/smoke.test.mjs` with one passing test.
Commit: `chore: scaffold static site and test runner`
AC: `npm test` -> 1 pass, 0 fail. `curl -s localhost:8000/ | grep -c 'js/app.js'` = 1 while `npm run serve` runs. No absolute paths (grep above).

### P1 - USDA download and search tools
Tasks: `tools/fetch_usda.sh` (curl with a browser User-Agent, URL in 1.3, verify sha256, unzip into `data-raw/`, idempotent); `tools/usda_lib.py` (load food.csv, nutrient.csv, food_nutrient.csv, food_portion.csv, food_category.csv into dicts); `tools/search_usda.py <words...>` (case-insensitive AND match on description; prints `fdc_id | category | description`, max 40 rows).
Commit: `feat(tools): add USDA SR Legacy fetch and search scripts`
AC: `bash tools/fetch_usda.sh` exits 0 and prints the sha256 OK message; second run is a no-op. `python3 tools/search_usda.py pork liver raw` lists `167862`. `git check-ignore data-raw` succeeds.

### P2 - Nutrient metadata
Tasks: `data-src/nutrients.csv` per table 1.2 (22 rows, Chinese names, units, USDA ids, colors). First version of `tools/validate_data.py` checking: 22 unique ids; each `usda_nutrient_id` exists in `data-raw/.../nutrient.csv` and its USDA unit matches (UG->ug, MG->mg; niacin special); colors unique, valid hex, not the "met" green; text contrast >= 4.5.
Commit: `feat(data): add nutrient metadata and validator`
AC: `python3 tools/validate_data.py` exits 0 and prints "nutrients: 22 OK". Supervisor reads the 22 Chinese names.

### P3 - Food curation (7 sub-steps, one commit each)
Tasks: using ONLY `tools/search_usda.py` output, append rows to `data-src/foods_curated.csv`. Prefer raw or plainly cooked forms, avoid branded/fast food/baby food (categories 3, 21, 25, 26, 27). Chinese name = common mainland name (e.g. state "cooked"/"raw" when it matters). Targets per sub-step:
- P3a grains, rice, noodles, breads, tubers (~60)
- P3b vegetables incl. leafy greens, Chinese vegetables available in SR (bok choy, napa cabbage, lotus root, bamboo shoots, etc.) (~120)
- P3c fruits (~70)
- P3d meat, poultry, offal, eggs (~90)
- P3e fish and seafood (~70)
- P3f dairy, soy products (tofu, soy milk), legumes (~70)
- P3g nuts, seeds, mushrooms, seaweed, oils, condiments with micronutrient value (sesame paste, etc.) (~70)
Extend `validate_data.py`: every fdc_id exists in SR Legacy food.csv, unique, `name_zh` non-empty and contains CJK, no category in the excluded list, total row count reported.
Commits: `feat(data): curate <group> foods from SR Legacy` (one per sub-step)
AC: validator exits 0; row count within +/-30% of the target; supervisor samples 10 rows per sub-step comparing `name_zh` with `usdaDescription` (must be the same food and same state raw/cooked). Any mismatch -> fix before next sub-step.

### P4 - Build foods.json
Tasks: `tools/build_foods.py` per 1.3 (niacin NE rule; nulls preserved; 4 significant digits; writes `docs/data/foods.json` and `docs/data/nutrients.json` and `docs/data/meta.json` with source info and build date). `tools/check_values.py`: independently re-reads `food_nutrient.csv` for 25 random foods x all nutrients and compares with foods.json (relative diff <= 0.1%; niacin checked against the NE formula). Unit test `tests/unit/data.test.mjs` loads foods.json and asserts these fixed values (from SR Legacy): `fdc:167862` (pork liver raw) vitA 6502, vitB12 26, iron 23.3, thiamin 0.283; `fdc:171287` (egg whole raw) vitA 160, vitB12 0.89, iron 1.75; niacin NE for 167862 = 15.301 + 0.301*1000/60 = 20.32 (+/-0.01).
Commit: `feat(data): build foods.json from SR Legacy`
AC: `python3 tools/build_foods.py && python3 tools/check_values.py` -> "25/25 OK"; `npm test` passes; foods.json < 1.5 MB.

### P5 - Household measures
Tasks: generate `data-src/measures.csv`. Step 1 (script `tools/suggest_measures.py`): for each curated food, take USDA `food_portion.csv` rows (e.g. "1 cup", "1 large", "1 slice") with their gram_weight -> rows with `basis=usda_portion:<id>`, Chinese label translated (cup -> bowl/cup, large egg -> one egg, etc.). Step 2 (builder judgement, allowed here): add common Chinese household measures where missing, e.g. "a handful" for nuts, "a fist" for cooked rice, "a bowl" for cooked rice/noodles/porridge, "a palm-sized piece" for meat/fish, each with `basis=estimate:<reason>`; one `is_default=1` per food. build_foods.py merges measures into foods.json; every food also gets the implicit "grams" option in the UI.
Commit: `feat(data): add household measures for foods`
AC: validator: every food has >= 1 measure and exactly 1 default; 1 <= grams <= 1000; every basis is `usda_portion:<existing id>` or `estimate:<text>`; report share of estimates. Supervisor sanity list (must be within the range): 1 egg 40-60 g, handful of nuts 15-35 g, fist of cooked rice 100-200 g, bowl of cooked rice 120-250 g, cup of milk 200-260 g.

### P6 - Composite Chinese dish estimates (optional, ~15-25 items)
Tasks: `data-src/composites.csv` for common items not in SR Legacy (e.g. steamed bun, dumplings, tomato-egg stir-fry, congee, soy milk if missing) using only curated fdc ids as ingredients; build_foods.py computes per100g = sum(ingredient per100g * grams/100), sets `estimate: true` and `basis`.
Commit: `feat(data): add labeled composite dish estimates`
AC: validator: ingredient grams sum to 100 +/- 0.5 for each composite; every ingredient fdc_id is curated; a unit test recomputes one composite by hand from foods.json. UI later shows an "estimate" badge.

### P7 - DRI tables
- **P7a (hms):** create `data-src/dri/cn2023.csv` and `data-src/dri/us.csv` with ALL rows (every group x sex x 22 nutrients) but EMPTY `target`, `target_type`, `ul`, `ul_applies_to_food`, `verified_by` and a `source_ref` naming the table to use (CN: table number per 1.4; US: "NIH ODS <nutrient> fact sheet RDA/AI table" or "NASEM DRI summary table"). `tools/build_dri.py` (refuses rows with empty verified_by unless `--allow-unverified`, which writes nothing to docs/). `js/core/dri.js` with `findGroup` + `targetsFor(dri, standard, profile)`, and `tests/unit/dri.test.mjs` for mapping only: CN 18->18-29, 29->18-29, 30->30-49, 49->30-49, 50->50-64, 64->50-64, 65->65-74, 74->65-74, 75->75+, 100->75+; US 18->14-18, 19->19-30, 30->19-30, 31->31-50, 50->31-50, 51->51-70, 70->51-70, 71->71+.
  Commit: `feat(dri): add DRI schema, skeleton tables and age mapping`
  AC: `npm test` passes; skeleton row count = CN 10 groups x 22 = 220, US 10 x 22 = 220; no target values present.
- **P7b [SUPERVISOR]:** fill every `target`, `target_type`, `ul`, `ul_applies_to_food`, `source_ref`, `verified_by`. CN from official images `/workspace/vita-research/cn_dri/table{9..14,20..23}.jpg` (cnsoc.org/drpostand). US from NIH ODS fact sheets / NASEM tables (browser if NCBI shows a captcha). Every value read twice (enter, then re-verify against the image/page in a second pass, ideally by a different model or by zooming the image). Record in NIGHT_LOG which values were checked how.
  Commit: `feat(dri): enter verified China 2023 and US DRI values`
  AC: `python3 tools/build_dri.py` exits 0; `tests/unit/dri.test.mjs` extended with fixed checks: CN male 30-49 iron 12 (UL 42), CN female 30-49 iron 18, CN male 30-49 vitA 770, CN female 30-49 vitA 660, CN calcium 18-49 = 800; US male 31-50 iron 8, US female 31-50 iron 18, US calcium 19-50 = 1000, US vitC male 90 / female 75, US vitD 19-70 = 15 ug. (Supervisor confirms these fixtures against sources before adding them.)

### P8 - Core logic modules + unit tests
Tasks: implement `calc.js`, `measures.js`, `order.js`, `state.js`, `nutrients.js` exactly per 1.5-1.7. Tests (`tests/unit/*.test.mjs`) using small in-test fixtures (not the real data):
- calc: totals across 2 foods; null treated as 0; remaining/surplus never negative; met at exactly target; overUL only when `ulAppliesToFood`.
- format: 1234.5 mg -> "1235"; 12.34 -> "12.3"; 0.456 -> "0.46"; surplus formatting yields "+12 mg" style string; no "-" in any output for a sweep of random inputs.
- measures: count x measure grams; manual grams overrides; 0 or negative -> 0.
- order: selected foods pinned first (by contribution), unselected sorted by per100g desc, selected food with null for that nutrient not listed, limit applies only to unpinned.
- state: toggle adds default measure x1 and removes on second toggle; selection persists when activeNutrient changes; save/load round trip with fake storage; corrupt JSON -> default state.
Commit: `feat(core): add calculation, measures, ordering and state modules`
AC: `npm test` all pass; >= 25 test cases; core modules do not touch `document` or `window` (grep).

### P9 - Profile panel and standards comparison
Tasks: `app.js` loads the 3 JSON files with relative `fetch`, builds state from `load(localStorage)`; `profile.js` renders sex/age/standard controls and the side-by-side CN/US table for the current profile; changing anything updates state, saves, re-renders.
Commit: `feat(ui): add profile panel with China and US standards toggle`
AC: Playwright (or manual headless check script) at 390x844: page loads with no console errors; switching sex/age changes the table values; selecting "US" marks the US column as active.

### P10 - Target cards
Tasks: `targets.js` per 1.8 item 3 using `calc.status`.
Commit: `feat(ui): add live nutrient target cards`
AC: with no selections every card shows "still need <target>"; card background equals its nutrient color; no card is green.

### P11 - Nutrient tabs and food cards
- P11a: `tabs.js` + `foods.js` list (ordering from `order.js`, "show more"). Commit `feat(ui): add nutrient tabs and sorted food cards`. AC: first vitamin A card is the food with highest vitA per 100 g in foods.json; 60 cards visible initially.
- P11b: selection + quantity editor + live updates + estimate badge (+ optional search). Commit `feat(ui): add food selection, quantity editor and cross-tab sync`. AC: tap pork liver in Vitamin A tab -> card green, default quantity filled, vitamin A card updates; switch to Vitamin B12 tab -> pork liver is first and green; B12 card already reduced.

### P12 - Persistence, About, disclaimer
Tasks: save on every change; restore on load; clear-all with confirm; `about.js` content per 1.8 item 6 (sources: USDA FDC SR Legacy 2018-04 with link; CNS DRIs 2023 with link to cnsoc.org/drpostand; NASEM DRIs via NIH ODS link; estimates explanation; unit caveats; not medical advice).
Commit: `feat(ui): persist selections and add data sources section`
AC: reload keeps profile, standard, selections, quantities; clear-all empties them; About section contains the three source links.

### P13 - Mobile polish and Playwright smoke tests
Tasks: `npm i -D @playwright/test`; `playwright.config.mjs` (`use.channel = 'chrome'`, headless, `webServer` = `python3 -m http.server 8123 -d docs`, baseURL `http://localhost:8123/`); `tests/e2e/smoke.spec.mjs` covering: (1) choose male 35, toggle US; (2) select a food in vitamin A tab; (3) switch to another nutrient tab, food pinned first and counted; (4) set a quantity large enough that a target card turns green; (5) surplus text starts with "+" and no card text contains "-" before a digit; (6) reload restores state; (7) at 390x844 `document.documentElement.scrollWidth <= 390`; (8) the site also works when served from a sub-path (serve the parent dir and open `/docs/`). Also `tests/e2e/screens.spec.mjs` writing `shots/desktop-1440.png`, `shots/mobile-390.png`, `shots/mobile-390-selected.png`.
Commit: `test(e2e): add Playwright smoke tests and screenshots`
AC: `npx playwright test` -> all passed; 3 screenshots exist and are non-empty; supervisor views them.

### P14 - GitHub repo, Pages, DEPLOY.md [SUPERVISOR runs gh; hms writes DEPLOY.md]
Tasks: hms writes `DEPLOY.md` (GitHub Pages from `main:/docs`; custom subdomain: add `docs/CNAME` containing `micronutrients.lianboji.club`, create a DNS CNAME record `micronutrients` -> `hairrrrr.github.io`, set custom domain + Enforce HTTPS in repo Settings > Pages; the site uses only relative paths so no code change is needed). Supervisor: `gh repo create hairrrrr/micronutrients-tracker --public --source . --remote origin --push`, then enable Pages: `gh api -X POST repos/hairrrrr/micronutrients-tracker/pages -f "source[branch]=main" -f "source[path]=/docs"`. (The gh token has `repo` scope but not `workflow`, so do NOT add GitHub Actions workflows; branch-based Pages needs none.) Do NOT add `docs/CNAME` yet; do not touch DNS.
Commit: `docs: add deployment guide for GitHub Pages and custom subdomain`
AC: `gh api repos/hairrrrr/micronutrients-tracker/pages --jq .status` = `built` (poll up to ~10 min); `curl -s -o /dev/null -w '%{http_code}' https://hairrrrr.github.io/micronutrients-tracker/` = 200, same for `data/foods.json`; Playwright smoke test re-run with `BASE_URL=https://hairrrrr.github.io/micronutrients-tracker/` passes.

### P15 - Final review [SUPERVISOR]
Tasks: data audit (re-run check_values on 50 foods; re-check 20 random DRI cells against sources; review 30 Chinese food names); review UI on real mobile width screenshots; finalize NIGHT_LOG with stats (hms calls, retries, failures, durations from `/workspace/vita-logs/runs.tsv`, what hms did vs supervisor fixes); update HANDOFF.md status.
Commit: `docs: finalize night log and review notes`
AC: all AC-common checks pass; live site matches local; report delivered to the user in Chinese.

v1.1 (only if time remains, each its own phase): pregnancy/lactation groups; food search; sodium as a limit card; iodine from the USDA/FDA/ODS iodine database.

---

## 3. Risks and guardrails

| Risk | Guardrail |
|---|---|
| Model invents nutrient values | Values only via `build_foods.py` from raw CSV; `check_values.py` re-reads raw data independently; fixed fixtures in unit tests; supervisor reviews diffs of `docs/data/foods.json` only as generated output (never hand-edited - a check compares regenerated output with committed file). |
| Model invents DRI values | hms only creates empty skeletons; the supervisor enters values from official images/pages with `source_ref` per row; `build_dri.py` refuses unverified rows; fixed fixtures in tests. |
| Wrong food chosen for a Chinese name (e.g. "cooked" vs "raw", "dried" vs "fresh") | `usdaDescription` kept in JSON and shown small in UI; supervisor samples 10 per curation batch. |
| Unit mismatch (vit E alpha-TE vs alpha-tocopherol; niacin NE; vit A UL only preformed) | Documented in nutrients.csv `note`, shown in About; niacin NE computed; UL warning only when `ul_applies_to_food`. |
| Missing data treated as zero | `null` preserved; foods with null not listed in that nutrient's group; About explains. |
| Absolute paths break sub-path hosting | AC-common grep; e2e sub-path test. |
| Flaky API, partial edits | Small phases, commit per phase, wrapper retries with backoff, resume prompt starts with git status. Supervisor checks `git diff` after each run. |
| Model edits outside repo or leaks secrets | Prompts forbid it; repo contains no secrets; supervisor checks `git diff --stat` and greps for `hms-`/`token`/`key` before every push. |
| Large files / slow mobile load | foods.json < 1.5 MB; no images; lazy "show more". |
| Model "fixes" a failing test by weakening it | Supervisor reviews test diffs; fixture values in tests may only be changed by the supervisor. |
| Copyright | Never use the Chinese Food Composition Table; only USDA (public domain) + labeled estimates. |

## 4. How the supervisor drives a phase

1. Write the phase prompt to `/workspace/vita-tools/prompts/<label>.txt`: "Read PLAN.md section 0 and phase <X>. Do only phase <X>. Run its acceptance commands. Commit with the given title. Append to NIGHT_LOG.md."
2. Run `/workspace/vita-tools/hms-phase.sh <label> /workspace/vita-tools/prompts/<label>.txt`.
3. Check: `git log --oneline -3`, `git show --stat HEAD`, run the AC commands yourself, read key diffs.
4. Accept -> next phase. Reject -> write a fix prompt (`<label>-fix1`) describing the failing check; after 2 failed fix rounds, fix by hand and log "supervisor fix" in NIGHT_LOG.
