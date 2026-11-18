# Micronutrients Tracker

A static, mobile-first web app that tracks daily intake of 22 micronutrients and compares
it with Chinese (CNS DRIs 2023) and US (NASEM/NIH ODS) reference intakes.

- No framework, no build step: plain HTML + CSS + ES modules served from `docs/`.
- Works at any sub-path (all paths are relative).
- Food values come from USDA FoodData Central SR Legacy (2018-04, public domain).
- Reference intakes come from official published tables.
- All state stays in the browser (localStorage); nothing is uploaded.

## Development

```sh
npm test        # unit tests (node --test, no dependencies)
npm run e2e     # Playwright smoke tests + screenshots (system Chrome, no browser download)
npm run serve   # serve docs/ at http://localhost:8000/
npm run validate  # data validation (Python 3 stdlib)
```

The end-to-end tests run against the system Chrome (`use.channel = 'chrome'`), so
`npx playwright install` is not needed. `npx playwright test` starts two throwaway
static servers (`docs/` on :8123 and the repo root on :8125 for the sub-path check)
and writes `shots/desktop-1440.png`, `shots/mobile-390.png` and
`shots/mobile-390-selected.png`. Set `BASE_URL` to test an already-served copy
(e.g. the deployed site) instead of starting local servers.

Data pipeline scripts live in `tools/` (Python 3 standard library only) and are never shipped.

## Layout

- `docs/` - the site (GitHub Pages serves this folder)
- `data-src/` - committed, reviewable data inputs
- `data-raw/` - downloaded USDA CSVs (not committed)
- `tools/` - data pipeline
- `tests/unit/` - unit tests
- `tests/e2e/` - Playwright smoke tests and screenshots (`shots/` holds the images)

## Credits

The UI borrows established patterns from permissively licensed open-source
projects instead of inventing new ones. Borrowed code is kept tiny and vendored
under `docs/` (no CDN, no runtime dependency), as noted per item.

- **Pico CSS v2** - https://picocss.com - MIT License, Copyright (c) 2019-2024
  Pico. `docs/vendor/pico-segmented.css` is a small adapted excerpt of Pico's
  `[role=group]` inline-group layout, used for the sex segmented control
  (renamed to `.segmented`, Pico custom properties replaced with this project's
  tokens, unused rules trimmed). License text kept next to it in
  `docs/vendor/pico-segmented.LICENSE.md`. The grouped form rows and plain
  input styling in `docs/css/style.css` follow the same Pico patterns,
  rewritten by hand.
- **Open Props** - https://open-props.style - MIT License. The design-token
  approach (a `:root` block of `--surface`, `--border`, `--radius`, `--pad`
  custom properties) follows Open Props' idea; the values are our own. The
  target-card grid (`repeat(n, minmax(0, 1fr))` with a `min-width: 0` card so
  long Chinese names cannot widen a column) and the 4 px rounded progress bar
  are the same utility-style ideas re-implemented by hand in
  `docs/css/style.css`; no Open Props file is vendored or fetched.
- **Cronometer** - https://cronometer.com - design reference only, no code
  copied (the site is not open source, so nothing was vendored). The target
  cards in `docs/js/ui/targets.js` and `docs/css/style.css` follow the common
  nutrition-tracker pattern of a dense goal/nutrient card grid: nutrient name,
  target, remaining or surplus amount, and a thin progress bar under it. The
  markup and CSS are written from scratch for this project.
- **Cronometer / MyFitnessPal** - https://cronometer.com and
  https://www.myfitnesspal.com - design reference only, no code copied (both
  sites are not open source). The nutrient chip row in `docs/js/ui/tabs.js`
  and the food card grid in `docs/js/ui/foods.js` follow the usual
  nutrition-tracker layout of a horizontally scrollable nutrient tab row above
  a dense food grid whose cards show a name, a small secondary name and one
  number per food. The markup, the CSS and the 2-column (mobile) / 4-column
  (desktop) grid are written from scratch in `docs/css/style.css`, using the
  same hand-written `repeat(n, minmax(0, 1fr))` idea as the target cards.
- **Cronometer / USDA FoodData Central documentation pages** -
  https://cronometer.com and https://fdc.nal.usda.gov - design reference only,
  no code copied (neither is an open-source codebase). The data-sources block
  in `docs/js/ui/about.js` and `docs/css/style.css` follows the common
  "sources - notes - disclaimer" footer of nutrition trackers and dataset
  documentation: a heading, one card per source with its name, one line of
  context, an outbound link and the bare URL, then short note sections and a
  final disclaimer box. The markup and CSS are written from scratch; the URLs
  are plain links and are never fetched at runtime.
- **Cronometer / MyFitnessPal / Lose It!** - https://cronometer.com,
  https://www.myfitnesspal.com and https://www.loseit.com - design reference
  only, no code copied (none of the three is open source). The selected food
  card and its quantity editor in `docs/js/ui/foods.js` and `docs/css/style.css`
  follow the common tracker pattern of a green (logged) card with an inline
  serving editor underneath it: a serving/measure dropdown, a `-` / `+`
  quantity stepper in half steps, and the resolved weight in grams. The markup
  is written from scratch; the editor is a sibling of the card button so no
  click inside it can toggle the card.
- **Pico CSS v2** - https://picocss.com - MIT License, Copyright (c) 2019-2024
  Pico. The P17 expand-in-place editor in `docs/js/ui/foods.js` and
  `docs/css/style.css` reuses the same hand-written Pico form-field and button
  ideas already used elsewhere in this project (a 38 px control height, a plain
  native `<select>` with our own skin, flat bordered buttons) for its measure
  select and its 确认 / 取消选择 / 取消 row. The expand-in-place tile itself -
  full-row grid span, round check button at the top right, draft state that is
  only committed on confirm - is written from scratch for this project; no file
  is vendored or fetched for it beyond `docs/vendor/pico-segmented.css`
  credited above.
- **WAI-ARIA Authoring Practices (APG), disclosure and button patterns** -
  https://www.w3.org/WAI/ARIA/apg/ - W3C document (not code), used as a design
  reference for the `aria-expanded` / `aria-pressed` pair and the focus handling
  of the expandable food tile in `docs/js/ui/foods.js`; the markup and
  behaviour are our own.

- **Pico CSS v2 / Open Props (mobile polish)** - https://picocss.com and
  https://open-props.style - MIT License. The phone pass in `docs/css/style.css`
  (38-40 px tap targets, 16 px inputs so iOS Safari does not zoom on focus, and
  `max(48px, calc(24px + env(safe-area-inset-bottom)))` page padding) follows
  the same hand-written utility ideas; no file is vendored or fetched for it.
- **Pico CSS v2 (modal)** - https://picocss.com - MIT License, Copyright (c)
  2019-2024 Pico. The food detail sheet in `docs/js/ui/detail.js` and
  `docs/css/style.css` follows Pico's modal pattern: one native `<dialog>`
  opened with `showModal()` (top layer, native Esc, `::backdrop` dimming)
  instead of a hand-written overlay. The bottom-sheet / centred-dialog skin,
  the nutrient rows and the focus return are written from scratch; no file is
  vendored or fetched for it.

## Disclaimer

This tool is for general information only and is not medical advice.
Household measures are rough approximations. Only raw ingredients are listed.
Bone-in foods are weighed with the bone, and the nutrients are computed from the
edible part (weight x (1 - refuse)).
