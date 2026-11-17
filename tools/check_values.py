#!/usr/bin/env python3
"""Independent spot-check of docs/data/foods.json against the raw USDA CSVs.

This script deliberately does NOT import the build pipeline helpers: it reads
data-raw/FoodData_Central_sr_legacy_food_csv_2018-04/food_nutrient.csv itself
and recomputes every nutrient value for a random sample of foods, so a bug or a
wrong singular assumption in build_foods.py cannot hide.

Checks per sampled food (PLAN.md P4):
    * every nutrient value of foods.json is recomputed from the raw table;
    * a missing raw value must be null in the JSON (and vice versa);
    * niacin is compared against the NE formula niacin_mg + tryptophan_g*1000/60,
      or against niacin alone plus flags.niacinNoTryptophan when tryptophan is
      missing;
    * rounded values may differ by at most 0.1 % relative (4 significant digits
      change a value by at most 0.05 %).

Usage:
    python3 tools/check_values.py [--foods N] [--seed S]
    python3 tools/check_values.py     # prints e.g. "25/25 OK"
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = REPO_ROOT / "data-raw" / "FoodData_Central_sr_legacy_food_csv_2018-04"
FOODS_JSON = REPO_ROOT / "docs" / "data" / "foods.json"

RELATIVE_TOLERANCE = 0.001  # 0.1 %
NIACIN_ID = 1167
TRYPTOPHAN_ID = 1210


def read_amounts(fdc_ids):
    """fdc_id -> {nutrient_id: amount} straight from the raw CSV."""
    wanted = set(fdc_ids)
    amounts = {}
    path = DATASET_DIR / "food_nutrient.csv"
    if not path.is_file():
        raise SystemExit(f"missing raw table {path.relative_to(REPO_ROOT)}; run tools/fetch_usda.sh")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            raw_fdc_id = (row.get("fdc_id") or "").strip()
            if not raw_fdc_id.isdigit() or int(raw_fdc_id) not in wanted:
                continue
            raw_nutrient_id = (row.get("nutrient_id") or "").strip()
            raw_amount = (row.get("amount") or "").strip()
            if not raw_nutrient_id.isdigit() or not raw_amount:
                continue
            amounts.setdefault(int(raw_fdc_id), {})[int(raw_nutrient_id)] = float(raw_amount)
    return amounts


def close_enough(expected, actual):
    if expected == actual:
        return True
    scale = max(abs(expected), abs(actual))
    if scale == 0:
        return True
    return abs(expected - actual) / scale <= RELATIVE_TOLERANCE


def expected_value(nutrient_id, usda_ids, amounts):
    """Recomputed value from the raw table; niacin uses the NE formula."""
    if nutrient_id == "niacin":
        niacin = amounts.get(NIACIN_ID)
        if niacin is None:
            return None, False
        tryptophan = amounts.get(TRYPTOPHAN_ID)
        if tryptophan is None:
            return niacin, True
        return niacin + tryptophan * 1000.0 / 60.0, False
    return amounts.get(usda_ids[0]), False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--foods", type=int, default=25, help="how many foods to sample")
    parser.add_argument("--seed", type=int, default=None, help="random seed (default: random)")
    args = parser.parse_args(argv)

    if not FOODS_JSON.is_file():
        raise SystemExit("missing docs/data/foods.json; run python3 tools/build_foods.py")
    nut_path = REPO_ROOT / "docs" / "data" / "nutrients.json"
    if not nut_path.is_file():
        raise SystemExit("missing docs/data/nutrients.json; run python3 tools/build_foods.py")

    payload = json.loads(FOODS_JSON.read_text(encoding="utf-8"))
    nutrients = json.loads(nut_path.read_text(encoding="utf-8"))["nutrients"]
    nutrients_by_id = {nutrient["id"]: nutrient for nutrient in nutrients}

    sr_foods = [food for food in payload["foods"] if food.get("fdcId") is not None]
    if not sr_foods:
        raise SystemExit("foods.json contains no SR Legacy foods")

    seed = args.seed if args.seed is not None else random.randrange(2**31)
    rng = random.Random(seed)
    sample = rng.sample(sr_foods, min(args.foods, len(sr_foods)))
    print(f"seed {seed}, sampling {len(sample)} of {len(sr_foods)} SR Legacy foods")

    amounts_by_food = read_amounts([food["fdcId"] for food in sample])

    problems = []
    passed = 0
    for food in sample:
        label = food["id"]
        amounts = amounts_by_food.get(food["fdcId"], {})
        food_ok = True
        for nutrient_id, nutrient in nutrients_by_id.items():
            expected, niacin_without_tryptophan = expected_value(
                nutrient_id, nutrient["usdaNutrientIds"], amounts
            )
            actual = food["per100g"].get(nutrient_id)

            if expected is None:
                if actual is not None:
                    problems.append(
                        f"{label} {nutrient_id}: raw table has no value but JSON has {actual}"
                    )
                    food_ok = False
                continue
            if actual is None:
                problems.append(f"{label} {nutrient_id}: JSON is null but raw value is {expected}")
                food_ok = False
                continue
            if not close_enough(expected, actual):
                problems.append(
                    f"{label} {nutrient_id}: JSON {actual} != raw {expected}"
                )
                food_ok = False
            if nutrient_id == "niacin":
                flag = bool(food.get("flags", {}).get("niacinNoTryptophan"))
                if flag != niacin_without_tryptophan:
                    problems.append(
                        f"{label} niacinNoTryptophan: JSON {flag} != expected "
                        f"{niacin_without_tryptophan}"
                    )
                    food_ok = False
        if food_ok:
            passed += 1
        # Every nutrient id of the site must be present (null or a value).
        missing_keys = [
            nutrient_id
            for nutrient_id in nutrients_by_id
            if nutrient_id not in food["per100g"]
        ]
        if missing_keys:
            problems.append(f"{label}: per100g misses {', '.join(missing_keys)}")

    for problem in problems:
        print(f"FAIL: {problem}")
    total = len(sample)
    if problems:
        print(f"{passed}/{total} OK, {len(problems)} problem(s)")
        return 1
    print(f"{passed}/{total} OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
