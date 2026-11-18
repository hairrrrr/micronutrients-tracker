#!/usr/bin/env python3
"""Build the site data files from SR Legacy and the curated CSV inputs.

Python 3 standard library only. Paths are resolved relative to the repository
root so the script works from any working directory.

Inputs (see PLAN.md 1.3):
    data-src/nutrients.csv      nutrient metadata (id -> USDA nutrient ids)
    data-src/foods_curated.csv  which foods to include + Chinese names
    data-src/measures.csv       optional household measures (phase P5)
    data-src/composites.csv     optional composite dish estimates (phase P6)
    data-src/commonness.csv     commonness tier 1-5 per food (phase P18b)
    data-raw/<dataset>/*.csv    USDA FoodData Central SR Legacy 2018-04

Outputs:
    docs/data/foods.json        every curated food with per-100 g values
    docs/data/nutrients.json    nutrient metadata for the UI
    docs/data/meta.json         source info + build date + counts

Rules (PLAN.md 1.3):
    * a value that is missing in the raw table stays null; null is "no data",
      never zero;
    * niacin is reported in mg NE = niacin_mg + tryptophan_g * 1000 / 60; if
      tryptophan is missing only niacin is used and flags.niacinNoTryptophan
      is true;
    * numbers are rounded to at most 4 significant digits, never otherwise
      changed.

Usage:
    python3 tools/build_foods.py
"""

from __future__ import annotations

import csv
import json
import math
import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from usda_lib import (
    DATASET_DIR_NAME,
    EXPECTED_SHA256,
    REPO_ROOT,
    dataset_dir,
    load_food,
    load_food_nutrient,
)

DATA_SRC = REPO_ROOT / "data-src"
DOCS_DATA = REPO_ROOT / "docs" / "data"

SOURCE = {
    "name": "USDA FoodData Central SR Legacy",
    "release": "2018-04",
    "url": "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    "sha256": EXPECTED_SHA256,
    "dataset": DATASET_DIR_NAME,
}

# USDA nutrient ids used by the niacin NE formula (PLAN.md 1.2).
NIACIN_ID = 1167
TRYPTOPHAN_ID = 1210
NIACIN_NE_DIVISOR = 60.0

SIGNIFICANT_DIGITS = 4

# Every food without a curated measure gets this one, so the UI always has a
# valid default until phase P5 fills data-src/measures.csv.
DEFAULT_MEASURE = {
    "id": "g100",
    "labelZh": "100克",
    "grams": 100,
    "basis": "estimate:default 100 g",
    "default": True,
}

NUTRIENT_COLUMNS = ["id", "name_zh", "name_en", "unit", "usda_nutrient_id", "color", "kind", "note"]
FOODS_COLUMNS = ["fdc_id", "name_zh", "name_en", "category_zh", "aliases_zh"]
MEASURE_COLUMNS = ["food_key", "measure_id", "label_zh", "grams", "basis", "is_default"]
COMPOSITE_COLUMNS = [
    "composite_id",
    "name_zh",
    "name_en",
    "ingredient_fdc_id",
    "grams_per_100g",
    "note",
]
COMMONNESS_COLUMNS = ["food_id", "name_zh", "commonness", "reason_zh"]
COMMONNESS_MIN = 1
COMMONNESS_MAX = 5


def read_csv(path, expected_columns):
    """Return a list of stripped dict rows, or [] when the file is absent."""
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        if header != expected_columns:
            raise SystemExit(
                f"{path.relative_to(REPO_ROOT)}: columns are {header}, expected {expected_columns}"
            )
        return [{key: (value or "").strip() for key, value in row.items()} for row in reader]


def round_sig(value, digits=SIGNIFICANT_DIGITS):
    """Round to at most `digits` significant digits without adding precision.

    Returns an int when the result is a whole number, else a float. None and 0
    pass through unchanged (0 cannot be rescaled).
    """
    if value is None:
        return None
    if value == 0 or not math.isfinite(value):
        return 0 if value == 0 else None
    decimal_value = Decimal(repr(float(value)))
    exponent = decimal_value.adjusted() - (digits - 1)
    rounded = decimal_value.scaleb(-exponent).quantize(
        Decimal(1), rounding=ROUND_HALF_UP
    ).scaleb(exponent)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def load_nutrient_metadata():
    """List of nutrients in nutrients.csv order, with parsed USDA ids."""
    rows = read_csv(DATA_SRC / "nutrients.csv", NUTRIENT_COLUMNS)
    if not rows:
        raise SystemExit("data-src/nutrients.csv is missing or empty")
    nutrients = []
    for row in rows:
        usda_ids = [int(part) for part in row["usda_nutrient_id"].split("+") if part]
        nutrients.append(
            {
                "id": row["id"],
                "nameZh": row["name_zh"],
                "nameEn": row["name_en"],
                "unit": row["unit"],
                "usdaNutrientIds": usda_ids,
                "color": row["color"],
                "kind": row["kind"],
                "note": row["note"] or None,
            }
        )
    return nutrients


def nutrient_value(nutrient, amounts):
    """Per-100 g value of one nutrient for one food, or None for "no data".

    `amounts` maps USDA nutrient id -> amount in the USDA unit. Niacin is
    special: mg NE = niacin + tryptophan * 1000 / 60, and the flag tells the
    UI whether tryptophan contributed.
    """
    if nutrient["id"] == "niacin":
        niacin = amounts.get(NIACIN_ID)
        if niacin is None:
            return None, {"niacinNoTryptophan": False}
        tryptophan = amounts.get(TRYPTOPHAN_ID)
        if tryptophan is None:
            return niacin, {"niacinNoTryptophan": True}
        return niacin + tryptophan * 1000.0 / NIACIN_NE_DIVISOR, {"niacinNoTryptophan": False}
    primary_id = nutrient["usdaNutrientIds"][0]
    value = amounts.get(primary_id)
    return (None if value is None else value), {"niacinNoTryptophan": False}


def load_commonness():
    """food_id -> integer commonness tier (1-5) from data-src/commonness.csv.

    Phase P18b: only the integer tier is merged into foods.json. The Chinese
    reason column is review material for the supervisor and must never reach
    docs/ (the validator checks that too).
    """
    path = DATA_SRC / "commonness.csv"
    rows = read_csv(path, COMMONNESS_COLUMNS)
    if not rows:
        raise SystemExit("data-src/commonness.csv is missing or empty")
    tiers = {}
    for line_no, row in enumerate(rows, start=2):
        food_id = row["food_id"]
        if not food_id:
            raise SystemExit(f"commonness.csv line {line_no}: empty food_id")
        if food_id in tiers:
            raise SystemExit(f"commonness.csv line {line_no}: duplicate food_id {food_id}")
        raw = row["commonness"]
        try:
            tier = int(raw)
        except ValueError:
            raise SystemExit(
                f"commonness.csv line {line_no} ({food_id}): commonness {raw!r} is not an integer"
            )
        if not COMMONNESS_MIN <= tier <= COMMONNESS_MAX:
            raise SystemExit(
                f"commonness.csv line {line_no} ({food_id}): commonness {tier} is outside "
                f"{COMMONNESS_MIN}..{COMMONNESS_MAX}"
            )
        tiers[food_id] = tier
    return tiers


def load_measures():
    """food_key -> list of measure dicts from data-src/measures.csv (P5)."""
    rows = read_csv(DATA_SRC / "measures.csv", MEASURE_COLUMNS)
    measures = {}
    for row in rows:
        food_key = row["food_key"]
        if not food_key:
            continue
        is_default = row["is_default"] in {"1", "true", "True", "yes"}
        measures.setdefault(food_key, []).append(
            {
                "id": row["measure_id"],
                "labelZh": row["label_zh"],
                "grams": round_sig(float(row["grams"])) if row["grams"] else None,
                "basis": row["basis"] or None,
                "default": is_default,
            }
        )
    return measures


def load_composites(nutrient_meta, foods_by_id, measures):
    """Composite dish rows from data-src/composites.csv (P6), grouped by id.

    Every dish is an estimate over its ingredient foods (never another
    composite): per 100 g = sum(ingredient per100g * grams/100). A nutrient is
    null only when no ingredient has a value for it; missing values of single
    ingredients count as 0 and are listed in flags.partialNullNutrients.
    """
    rows = read_csv(DATA_SRC / "composites.csv", COMPOSITE_COLUMNS)
    if not rows:
        return [], 0
    grouped = {}
    order = []
    for row in rows:
        composite_id = row["composite_id"]
        if composite_id not in grouped:
            grouped[composite_id] = {
                "name_zh": row["name_zh"],
                "name_en": row["name_en"],
                "note": row["note"],
                "ingredients": [],
            }
            order.append(composite_id)
        grouped[composite_id]["ingredients"].append(
            {"fdc_id": int(row["ingredient_fdc_id"]), "grams": float(row["grams_per_100g"])}
        )

    composites = []
    for composite_id in order:
        entry = grouped[composite_id]
        per100g = {}
        totals = {nutrient["id"]: 0.0 for nutrient in nutrient_meta}
        known = {nutrient["id"]: False for nutrient in nutrient_meta}
        # Nutrient ids where at least one ingredient has no value while another
        # one does: the missing part counts as 0 and the dish is marked, so the
        # UI can say the value is a lower bound.
        missing = set()
        for ingredient in entry["ingredients"]:
            food = foods_by_id.get(ingredient["fdc_id"])
            if food is None:
                raise SystemExit(
                    f"composites.csv {composite_id}: ingredient {ingredient['fdc_id']} "
                    "is not in foods_curated.csv"
                )
            share = ingredient["grams"] / 100.0
            for nutrient_id, value in food["per100g"].items():
                if value is None:
                    missing.add(nutrient_id)
                    continue
                totals[nutrient_id] += value * share
                known[nutrient_id] = True
        partial = {
            nutrient_id for nutrient_id in missing if known[nutrient_id]
        }
        for nutrient in nutrient_meta:
            nutrient_id = nutrient["id"]
            per100g[nutrient_id] = round_sig(totals[nutrient_id]) if known[nutrient_id] else None
        partial_nutrients = [
            nutrient["id"] for nutrient in nutrient_meta if nutrient["id"] in partial
        ]
        basis = "; ".join(
            f"fdc:{ingredient['fdc_id']} {ingredient['grams']:g} g"
            for ingredient in entry["ingredients"]
        )
        composites.append(
            {
                "id": f"composite:{composite_id}",
                "fdcId": None,
                "nameZh": entry["name_zh"],
                "nameEn": entry["name_en"],
                "usdaDescription": None,
                "category": "菜肴估算",
                "aliases": [],
                "estimate": True,
                "basis": f"recipe estimate, raw-weight ingredients per 100 g finished dish: {basis}"
                + (f"; {entry['note']}" if entry["note"] else "")
                + (
                    "; ingredients without a value for "
                    + ", ".join(partial_nutrients)
                    + " were counted as 0"
                    if partial_nutrients
                    else ""
                ),
                "per100g": per100g,
                "flags": {
                    "niacinNoTryptophan": False,
                    "partialNullNutrients": partial_nutrients,
                },
                "measures": measures.get(composite_id, [dict(DEFAULT_MEASURE)]),
            }
        )
    return composites, len(composites)


def build():
    dataset_dir()
    nutrient_meta = load_nutrient_metadata()
    curated = read_csv(DATA_SRC / "foods_curated.csv", FOODS_COLUMNS)
    if not curated:
        raise SystemExit("data-src/foods_curated.csv is missing or empty")

    usda_foods = load_food()
    amounts_by_food = load_food_nutrient()
    measures = load_measures()

    foods = []
    missing_measures = 0
    for row in curated:
        raw_id = row["fdc_id"]
        if not raw_id.isdigit():
            raise SystemExit(f"foods_curated.csv: fdc_id {raw_id!r} is not a number")
        fdc_id = int(raw_id)
        usda_food = usda_foods.get(fdc_id)
        if usda_food is None:
            raise SystemExit(f"foods_curated.csv: fdc_id {fdc_id} is not in SR Legacy food.csv")
        amounts = amounts_by_food.get(fdc_id, {})

        per100g = {}
        flags = {"niacinNoTryptophan": False}
        for nutrient in nutrient_meta:
            value, nutrient_flags = nutrient_value(nutrient, amounts)
            per100g[nutrient["id"]] = round_sig(value)
            if nutrient_flags["niacinNoTryptophan"]:
                flags["niacinNoTryptophan"] = True

        food_measures = measures.get(raw_id, [])
        if not food_measures:
            missing_measures += 1
            food_measures = [dict(DEFAULT_MEASURE)]

        aliases = [alias for alias in row["aliases_zh"].split("|") if alias]
        foods.append(
            {
                "id": f"fdc:{fdc_id}",
                "fdcId": fdc_id,
                "nameZh": row["name_zh"],
                "nameEn": row["name_en"],
                "usdaDescription": usda_food["description"],
                "category": row["category_zh"],
                "aliases": aliases,
                "estimate": False,
                "basis": None,
                "per100g": per100g,
                "flags": flags,
                "measures": food_measures,
            }
        )

    foods_by_id = {food["fdcId"]: food for food in foods}
    composites, composite_count = load_composites(nutrient_meta, foods_by_id, measures)
    foods.extend(composites)

    # Phase P18b: every food needs its integer commonness tier (1-5). The id
    # match covers SR Legacy foods (`fdc:<id>`) and composites
    # (`composite:<id>`) alike; a food without a tier fails the build.
    commonness = load_commonness()
    missing_tiers = []
    for food in foods:
        tier = commonness.get(food["id"])
        if tier is None:
            missing_tiers.append(food["id"])
            continue
        # Appended as the last key of the food object; only the integer tier
        # is carried over, never the CSV reason column.
        food["commonness"] = tier
    if missing_tiers:
        preview = ", ".join(missing_tiers[:10])
        raise SystemExit(
            f"data-src/commonness.csv has no tier for {len(missing_tiers)} food(s): {preview}"
        )
    unknown_tiers = sorted(set(commonness) - {food["id"] for food in foods})
    if unknown_tiers:
        preview = ", ".join(unknown_tiers[:10])
        raise SystemExit(
            f"data-src/commonness.csv lists {len(unknown_tiers)} unknown food id(s): {preview}"
        )

    foods.sort(
        key=lambda food: (
            food["fdcId"] is None,
            food["fdcId"] if food["fdcId"] is not None else 0,
            food["id"],
        )
    )

    return nutrient_meta, foods, composite_count, missing_measures


def write_json(path, payload, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def main():
    nutrient_meta, foods, composite_count, missing_measures = build()

    foods_payload = {"source": SOURCE, "foods": foods}
    nutrients_payload = {"source": SOURCE, "nutrients": nutrient_meta}
    meta_payload = {
        "source": SOURCE,
        "buildDate": date.today().isoformat(),
        "generator": "tools/build_foods.py",
        "counts": {
            "foods": len(foods),
            "srLegacyFoods": len(foods) - composite_count,
            "composites": composite_count,
            "nutrients": len(nutrient_meta),
        },
        "measures": {
            "curatedFoods": len(foods) - composite_count - missing_measures,
            "defaultGramsOnly": missing_measures,
        },
        "notes": [
            "Values are per 100 g of the food as described in usdaDescription.",
            "null means the SR Legacy table has no value: it counts as 0 and the food is "
            "not listed for that nutrient.",
            "Values are rounded to at most 4 significant digits, never otherwise changed.",
            "Niacin is in mg NE = niacin + tryptophan*1000/60; when tryptophan is missing "
            "only niacin is used and flags.niacinNoTryptophan is true.",
            "Composite dishes are labeled estimates: per 100 g is the sum of the "
            "ingredient per-100 g values times grams/100, on a raw-weight basis "
            "without cooking retention factors.",
            "When an ingredient has no value for a nutrient but another ingredient does, "
            "the missing part counts as 0 and flags.partialNullNutrients lists that "
            "nutrient, so the value is a lower bound.",
            "commonness tiers 1-5: AI model estimate (DeepSeek via hms), supervisor-reviewed",
        ],
    }

    write_json(DOCS_DATA / "foods.json", foods_payload, compact=True)
    write_json(DOCS_DATA / "nutrients.json", nutrients_payload)
    write_json(DOCS_DATA / "meta.json", meta_payload)

    null_total = sum(
        1 for food in foods for value in food["per100g"].values() if value is None
    )
    print(f"wrote docs/data/foods.json: {len(foods)} foods "
          f"({len(foods) - composite_count} SR Legacy, {composite_count} composites)")
    print(f"wrote docs/data/nutrients.json: {len(nutrient_meta)} nutrients")
    print(f"wrote docs/data/meta.json: build date {meta_payload['buildDate']}")
    print(f"null nutrient values kept: {null_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
