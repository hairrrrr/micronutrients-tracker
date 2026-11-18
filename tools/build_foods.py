#!/usr/bin/env python3
"""Build the site data files from SR Legacy and the curated CSV inputs.

Python 3 standard library only. Paths are resolved relative to the repository
root so the script works from any working directory.

Inputs (see PLAN.md 1.3):
    data-src/nutrients.csv      nutrient metadata (id -> USDA nutrient ids)
    data-src/foods_curated.csv  which foods to include + Chinese names
    data-src/measures.csv       optional household measures (phase P5)
    data-src/commonness.csv     commonness tier 1-5 per food (phase P18b)
    data-src/small_portion_foods.csv  foods eaten in small amounts (phase P19b)
    data-src/bone_in_foods.csv  foods weighed with the bone (phase P20)
    data-src/custom_foods.csv  user-owned branded foods from package labels (P25a)
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
      changed;
    * every food carries `amountBasisG` (P19b): 10 for the condiments, spices,
      cooking oils and dried goods of data-src/small_portion_foods.csv, 100 for
      everything else. Only the integer basis is merged, never the CSV rule
      text, and an id of the CSV that is not a food fails the build;
    * a bone-in food (P20) carries `refusePct` (a number) and a short Chinese
      `refuseNote`; the nutrients stay per 100 g edible portion and the UI
      multiplies the edible grams only. No other CSV text is copied.

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
COMMONNESS_COLUMNS = ["food_id", "name_zh", "commonness", "reason_zh"]
COMMONNESS_MIN = 1
COMMONNESS_MAX = 5
# Phase P19b: foods eaten in small amounts, compared and shown per 10 g.
SMALL_PORTION_COLUMNS = ["food_id", "name_zh", "basis_g", "rule"]
SMALL_PORTION_BASIS_G = 10
DEFAULT_AMOUNT_BASIS_G = 100
# Phase P20: foods whose nutrient values are per 100 g edible portion but that
# people weigh with the bone.
BONE_IN_COLUMNS = ["food_id", "name_zh", "refuse_pct", "refuse_desc", "source"]
# Phase P25a: user-owned branded foods transcribed from package labels. Only
# the food values are used; source_note_zh is review material that never
# reaches docs/. Calcium is the label value, every other nutrient is estimated
# from the SR Legacy base food (base_fdc_id) with the usual code path.
CUSTOM_COLUMNS = [
    "food_id",
    "name_zh",
    "name_en",
    "category_zh",
    "aliases_zh",
    "base_fdc_id",
    "label_basis",
    "density_g_per_ml",
    "calcium_mg_per_100g",
    "null_nutrients",
    "pin_top",
    "source",
    "source_note_zh",
]
CUSTOM_ID_PREFIX = "custom:"
CUSTOM_SOURCE_TYPE = "package_label"


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


def load_small_portions():
    """set of food ids eaten in small amounts (basis 10 g), phase P19b.

    `data-src/small_portion_foods.csv` is the reviewed list (P19a) of
    condiments, spices, cooking oils and dried goods. Only the ids are used:
    the `basis_g` column must be 10 and the `rule` column is review material
    that never reaches docs/.
    """
    path = DATA_SRC / "small_portion_foods.csv"
    rows = read_csv(path, SMALL_PORTION_COLUMNS)
    if not rows:
        raise SystemExit("data-src/small_portion_foods.csv is missing or empty")
    ids = set()
    for line_no, row in enumerate(rows, start=2):
        food_id = row["food_id"]
        if not food_id:
            raise SystemExit(f"small_portion_foods.csv line {line_no}: empty food_id")
        if food_id in ids:
            raise SystemExit(
                f"small_portion_foods.csv line {line_no}: duplicate food_id {food_id}"
            )
        try:
            basis = int(row["basis_g"])
        except ValueError:
            raise SystemExit(
                f"small_portion_foods.csv line {line_no} ({food_id}): "
                f"basis_g {row['basis_g']!r} is not an integer"
            )
        if basis != SMALL_PORTION_BASIS_G:
            raise SystemExit(
                f"small_portion_foods.csv line {line_no} ({food_id}): basis_g {basis} "
                f"!= {SMALL_PORTION_BASIS_G}"
            )
        ids.add(food_id)
    return ids


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


def load_bone_in():
    """food_id -> refuse percent from data-src/bone_in_foods.csv (P20).

    The SR Legacy nutrient values of these foods are per 100 g of edible
    portion, while people weigh and buy the cut with the bone. Only the number
    is merged into foods.json; the CSV description and source columns are
    review material. A percentage outside 0..100 fails the build.
    """
    path = DATA_SRC / "bone_in_foods.csv"
    rows = read_csv(path, BONE_IN_COLUMNS)
    refuse = {}
    for line_no, row in enumerate(rows, start=2):
        food_id = row["food_id"]
        if not food_id:
            raise SystemExit(f"bone_in_foods.csv line {line_no}: empty food_id")
        if food_id in refuse:
            raise SystemExit(f"bone_in_foods.csv line {line_no}: duplicate food_id {food_id}")
        try:
            pct = float(row["refuse_pct"])
        except ValueError:
            raise SystemExit(
                f"bone_in_foods.csv line {line_no} ({food_id}): refuse_pct "
                f"{row['refuse_pct']!r} is not a number"
            )
        if not 0 < pct < 100:
            raise SystemExit(
                f"bone_in_foods.csv line {line_no} ({food_id}): refuse_pct {pct:g} "
                "must be between 0 and 100"
            )
        refuse[food_id] = pct
    return refuse


def refuse_note(pct):
    """Short Chinese note for a bone-in food, generated from the percentage.

    Only the number is used, never a text column of the CSV: the note says that
    a weighed amount is with-bone and how much of it is edible.
    """
    edible = round(100 - pct, 1)
    return f"按带骨重量计，可食部约 {edible:g}%（USDA 废弃率 {pct:g}%：骨）"


def nutrient_values(nutrient_meta, amounts):
    """(per100g, flags) for one SR Legacy food, from its USDA amounts."""
    per100g = {}
    flags = {"niacinNoTryptophan": False}
    for nutrient in nutrient_meta:
        value, nutrient_flags = nutrient_value(nutrient, amounts)
        per100g[nutrient["id"]] = round_sig(value)
        if nutrient_flags["niacinNoTryptophan"]:
            flags["niacinNoTryptophan"] = True
    return per100g, flags


def load_custom_foods(nutrient_meta, usda_foods, amounts_by_food):
    """User-owned branded foods from data-src/custom_foods.csv (phase P25a).

    The values stay per 100 g of the product. Calcium is the transcribed label
    value; every other micronutrient is computed from the SR Legacy base food
    (base_fdc_id) with exactly the normal code path, then the ids listed in
    null_nutrients are set back to null because the unfortified product has no
    data for them (never zero). fdcId and usdaDescription are null: these foods
    are not SR Legacy entries. Only the source type, the base id and the
    estimated nutrient ids are published, never the Chinese label note.
    """
    path = DATA_SRC / "custom_foods.csv"
    rows = read_csv(path, CUSTOM_COLUMNS)
    nutrient_ids = [nutrient["id"] for nutrient in nutrient_meta]
    custom = []
    for line_no, row in enumerate(rows, start=2):
        food_id = row["food_id"]
        label = f"custom_foods.csv line {line_no} ({food_id or 'no food_id'})"
        if not food_id.startswith(CUSTOM_ID_PREFIX) or len(food_id) <= len(CUSTOM_ID_PREFIX):
            raise SystemExit(f"{label}: food_id must start with {CUSTOM_ID_PREFIX}")
        if row["source"] != CUSTOM_SOURCE_TYPE:
            raise SystemExit(f"{label}: source must be {CUSTOM_SOURCE_TYPE}, got {row['source']!r}")

        raw_base = row["base_fdc_id"]
        if not raw_base.isdigit():
            raise SystemExit(f"{label}: base_fdc_id {raw_base!r} is not a number")
        base_fdc_id = int(raw_base)
        usda_food = usda_foods.get(base_fdc_id)
        if usda_food is None:
            raise SystemExit(f"{label}: base_fdc_id {base_fdc_id} is not in SR Legacy food.csv")
        if usda_food["description"] is None:
            raise SystemExit(f"{label}: base_fdc_id {base_fdc_id} has no description")

        raw_calcium = row["calcium_mg_per_100g"]
        try:
            calcium = float(raw_calcium)
        except ValueError:
            raise SystemExit(f"{label}: calcium_mg_per_100g {raw_calcium!r} is not a number")
        if not math.isfinite(calcium) or calcium <= 0:
            raise SystemExit(f"{label}: calcium_mg_per_100g must be a positive number")

        null_nutrients = [part for part in row["null_nutrients"].split("|") if part]
        unknown_null = [part for part in null_nutrients if part not in nutrient_ids]
        if unknown_null:
            raise SystemExit(f"{label}: null_nutrients has unknown ids {unknown_null}")

        pin_top = [part for part in row["pin_top"].split("|") if part]
        unknown_pin = [part for part in pin_top if part not in nutrient_ids]
        if unknown_pin:
            raise SystemExit(f"{label}: pin_top has unknown ids {unknown_pin}")

        per100g, flags = nutrient_values(nutrient_meta, amounts_by_food.get(base_fdc_id, {}))
        per100g["calcium"] = round_sig(calcium)
        for nutrient_id in null_nutrients:
            per100g[nutrient_id] = None

        estimated = [
            nutrient_id
            for nutrient_id in nutrient_ids
            if nutrient_id != "calcium" and nutrient_id not in null_nutrients
        ]
        custom.append(
            {
                "id": food_id,
                "fdcId": None,
                "nameZh": row["name_zh"],
                "nameEn": row["name_en"],
                "usdaDescription": None,
                "category": row["category_zh"],
                "aliases": [alias for alias in row["aliases_zh"].split("|") if alias],
                "per100g": per100g,
                "flags": flags,
                "source": {
                    "type": CUSTOM_SOURCE_TYPE,
                    "baseFdcId": base_fdc_id,
                    "estimated": estimated,
                },
                "pinTop": pin_top,
            }
        )
    return custom


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

        per100g, flags = nutrient_values(nutrient_meta, amounts)

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
                "per100g": per100g,
                "flags": flags,
                "measures": food_measures,
            }
        )

    # Phase P25a: user-owned branded foods from package labels. Their values
    # are per 100 g like every other food: calcium is the label value, the
    # other micronutrients come from the SR Legacy base food. They carry no
    # fdcId, so they are appended after the SR Legacy foods (which stay sorted
    # by fdcId) and keep the CSV order.
    custom = load_custom_foods(nutrient_meta, usda_foods, amounts_by_food)
    for food in custom:
        food_measures = measures.get(food["id"], [])
        if not food_measures:
            raise SystemExit(
                f"data-src/measures.csv has no measures for the custom food {food['id']}"
            )
        food["measures"] = food_measures
        foods.append(food)

    # Phase P18b: every food needs its integer commonness tier (1-5). A food
    # without a tier fails the build.
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

    # Phase P19b: every food gets its amount basis. The reviewed list marks
    # condiments, spices, cooking oils and dried goods as eaten in small
    # amounts, so they are compared and shown per 10 g; everything else keeps
    # the per-100 g basis. An id of the list that is not a food fails the
    # build, exactly like an unknown commonness id.
    small_portions = load_small_portions()
    unknown_portions = sorted(small_portions - {food["id"] for food in foods})
    if unknown_portions:
        preview = ", ".join(unknown_portions[:10])
        raise SystemExit(
            f"data-src/small_portion_foods.csv lists {len(unknown_portions)} "
            f"unknown food id(s): {preview}"
        )
    for food in foods:
        food["amountBasisG"] = (
            SMALL_PORTION_BASIS_G if food["id"] in small_portions else DEFAULT_AMOUNT_BASIS_G
        )

    # Phase P20: bone-in foods carry the USDA refuse percentage and a short
    # generated note. Their per100g values stay untouched (they are already per
    # 100 g edible portion); the UI converts with-bone grams to edible grams.
    bone_in = load_bone_in()
    unknown_bone_in = sorted(set(bone_in) - {food["id"] for food in foods})
    if unknown_bone_in:
        preview = ", ".join(unknown_bone_in[:10])
        raise SystemExit(
            f"data-src/bone_in_foods.csv lists {len(unknown_bone_in)} "
            f"unknown food id(s): {preview}"
        )
    for food in foods:
        pct = bone_in.get(food["id"])
        if pct is None:
            continue
        food["refusePct"] = pct
        food["refuseNote"] = refuse_note(pct)

    # SR Legacy foods are sorted by fdcId for a stable order; the custom foods
    # have no fdcId and keep the tail in CSV order.
    sr_foods = [food for food in foods if food["id"].startswith("fdc:")]
    custom_foods = [food for food in foods if not food["id"].startswith("fdc:")]
    sr_foods.sort(key=lambda food: food["fdcId"])
    foods = sr_foods + custom_foods

    return nutrient_meta, foods, missing_measures


def write_json(path, payload, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def main():
    nutrient_meta, foods, missing_measures = build()

    foods_payload = {"source": SOURCE, "foods": foods}
    nutrients_payload = {"source": SOURCE, "nutrients": nutrient_meta}
    bone_in_count = sum(1 for food in foods if "refusePct" in food)
    sr_count = sum(1 for food in foods if food["fdcId"] is not None)
    custom_count = len(foods) - sr_count
    meta_payload = {
        "source": SOURCE,
        "buildDate": date.today().isoformat(),
        "generator": "tools/build_foods.py",
        "counts": {
            "foods": len(foods),
            "srLegacyFoods": sr_count,
            "customFoods": custom_count,
            "boneInFoods": bone_in_count,
            "nutrients": len(nutrient_meta),
        },
        "measures": {
            "curatedFoods": len(foods) - missing_measures,
            "defaultGramsOnly": missing_measures,
        },
        "notes": [
            "Values are per 100 g of the food as described in usdaDescription.",
            "null means the SR Legacy table has no value: it counts as 0 and the food is "
            "not listed for that nutrient.",
            "Values are rounded to at most 4 significant digits, never otherwise changed.",
            "Niacin is in mg NE = niacin + tryptophan*1000/60; when tryptophan is missing "
            "only niacin is used and flags.niacinNoTryptophan is true.",
            "commonness tiers 1-5: AI model estimate (DeepSeek via hms), supervisor-reviewed",
            "amountBasisG is the comparison basis: 10 g for condiments, spices, cooking "
            "oils and dried goods eaten in small amounts, 100 g for every other food; "
            "per100g values themselves are always per 100 g",
            "Bone-in foods (refusePct) are measured with the bone: the edible weight is "
            "grams * (1 - refusePct/100) and the per100g values are for the edible part",
            "Custom foods (source.type package_label) are per 100 g of the product: calcium "
            "is the package label value, the other micronutrients are estimated from the "
            "SR Legacy base food source.baseFdcId, and null means the label or product has "
            "no data for that nutrient",
        ],
    }

    write_json(DOCS_DATA / "foods.json", foods_payload, compact=True)
    write_json(DOCS_DATA / "nutrients.json", nutrients_payload)
    write_json(DOCS_DATA / "meta.json", meta_payload)

    null_total = sum(
        1 for food in foods for value in food["per100g"].values() if value is None
    )
    print(f"wrote docs/data/foods.json: {len(foods)} foods")
    print(f"wrote docs/data/nutrients.json: {len(nutrient_meta)} nutrients")
    print(f"wrote docs/data/meta.json: build date {meta_payload['buildDate']}")
    small = sum(1 for food in foods if food["amountBasisG"] == SMALL_PORTION_BASIS_G)
    print(f"amountBasisG 10 g: {small} foods, 100 g: {len(foods) - small} foods")
    print(f"bone-in foods with refusePct: {bone_in_count}")
    print(f"null nutrient values kept: {null_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
