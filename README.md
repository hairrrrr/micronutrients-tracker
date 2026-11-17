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

## Disclaimer

This tool is for general information only and is not medical advice.
Household measures are rough approximations, and composite dish values are labeled estimates.
