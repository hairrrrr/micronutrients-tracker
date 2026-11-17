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
  custom properties) follows Open Props' idea; the values are our own.

## Disclaimer

This tool is for general information only and is not medical advice.
Household measures are rough approximations, and composite dish values are labeled estimates.
