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
npm run serve   # serve docs/ at http://localhost:8000/
npm run validate  # data validation (Python 3 stdlib)
```

Data pipeline scripts live in `tools/` (Python 3 standard library only) and are never shipped.

## Layout

- `docs/` - the site (GitHub Pages serves this folder)
- `data-src/` - committed, reviewable data inputs
- `data-raw/` - downloaded USDA CSVs (not committed)
- `tools/` - data pipeline
- `tests/unit/` - unit tests

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

## Disclaimer

This tool is for general information only and is not medical advice.
Household measures are rough approximations, and composite dish values are labeled estimates.
