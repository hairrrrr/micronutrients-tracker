#!/usr/bin/env python3
"""Data checks for the micronutrients tracker.

Python 3 standard library only. Every check reports a failure line and the
script exits with status 1 if anything is wrong, so it can gate data commits.

Usage:
    python3 tools/validate_data.py

Current checks (phase P2):
    nutrients.csv  - the 22 nutrients of PLAN.md table 1.2, unique ids,
                     standard Simplified Chinese names, known units and kinds,
                     USDA nutrient ids that exist in the SR Legacy nutrient
                     table with a matching USDA unit, 22 unique pastel colors
                     that stay WCAG AA readable with the UI text color.

Phase P3 adds:
    foods_curated.csv - header, unique fdc_id, every fdc_id present in the
                     SR Legacy food table, no excluded food category (baby
                     food, fast food, restaurant food, branded, QC material),
                     non-empty Chinese name_zh / category_zh and Chinese
                     aliases; the total row count is printed.

Phase P4 adds:
    docs/data/*.json - foods.json exists and is < 1.5 MB, holds every curated
                     food (plus composites), every food has all 22 nutrients
                     and >= 1 measure with exactly 1 default, values are null or
                     non-negative numbers with at most 4 significant digits,
                     nutrients.json has the 22 nutrients in nutrients.csv
                     order, meta.json carries the source and a build date, and
                     no JSON contains an absolute URL path.
"""

from __future__ import annotations

import csv
import json
import sys
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_SRC = REPO_ROOT / "data-src"

# Dark text color used on every colored card in the UI (see docs/css/style.css).
# Contrast is measured against it; it must stay WCAG AA for normal text.
TEXT_COLOR = "#1f2328"
MIN_CONTRAST = 4.5

# The "met" card style from PLAN.md 1.2; no nutrient may reuse these colors.
MET_BACKGROUND = "#c8f2d0"
MET_BORDER = "#145c2a"

# id -> USDA nutrient ids that this nutrient reads from the SR Legacy table.
# The first id is the primary source; extra ids are used by the pipeline.
EXPECTED_NUTRIENTS = {
    "vitA": [1106],
    "vitD": [1114],
    "vitE": [1109],
    "vitK": [1185],
    "vitC": [1162],
    "thiamin": [1165],
    "riboflavin": [1166],
    "niacin": [1167, 1210],
    "vitB6": [1175],
    "folate": [1190],
    "vitB12": [1178],
    "pantothenic": [1170],
    "choline": [1180],
    "calcium": [1087],
    "phosphorus": [1091],
    "potassium": [1092],
    "magnesium": [1090],
    "iron": [1089],
    "zinc": [1095],
    "selenium": [1103],
    "copper": [1098],
    "manganese": [1101],
}

EXPECTED_COUNT = len(EXPECTED_NUTRIENTS)
KINDS = {"vitamin", "mineral"}

# Our unit -> accepted USDA SR Legacy unit_name values (per nutrient id).
UNIT_TO_USDA = {"ug": {"UG"}, "mg": {"MG"}}
# Special cases where the USDA table unit differs from the nutrient's own unit.
USDA_UNIT_OVERRIDES = {
    (1210, "G"): "tryptophan is stored in G and converted to mg NE",
}

CSV_COLUMNS = [
    "id",
    "name_zh",
    "name_en",
    "unit",
    "usda_nutrient_id",
    "color",
    "kind",
    "note",
]

# data-src/foods_curated.csv columns (PLAN.md 1.3).
FOODS_COLUMNS = ["fdc_id", "name_zh", "name_en", "category_zh", "aliases_zh"]

# P3: categories that must never appear in the curated food list:
# 3 Baby Foods, 21 Fast Foods, 25 Restaurant Foods, 26 Branded Food
# Products Database, 27 Quality Control Materials.
EXCLUDED_CATEGORY_IDS = {3, 21, 25, 26, 27}


class Checks:
    """Collects failures so that one run reports every problem it found."""

    def __init__(self):
        self.failures = []
        self.passes = 0

    def check(self, condition, message):
        if condition:
            self.passes += 1
        else:
            self.failures.append(message)
        return condition

    def fail(self, message):
        self.failures.append(message)

    def report(self):
        for message in self.failures:
            print(f"FAIL: {message}")
        return 1 if self.failures else 0


def read_csv(path):
    if not path.is_file():
        raise SystemExit(f"missing data file: {path.relative_to(REPO_ROOT)}")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def parse_hex(color):
    """Return (r, g, b) for '#rrggbb', or None when the color is invalid."""
    if not color or not color.startswith("#") or len(color) != 7:
        return None
    try:
        return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))
    except ValueError:
        return None


def column_luminance(channel):
    channel /= 255.0
    return channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4


def relative_luminance(color):
    """WCAG 2.x relative luminance of a '#rrggbb' color."""
    r, g, b = color
    return (
        0.2126 * column_luminance(r)
        + 0.7152 * column_luminance(g)
        + 0.0722 * column_luminance(b)
    )


def contrast_ratio(background, text):
    lum_bg = relative_luminance(background)
    lum_text = relative_luminance(text)
    lighter, darker = max(lum_bg, lum_text), min(lum_bg, lum_text)
    return (lighter + 0.05) / (darker + 0.05)


def has_cjk(text):
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def normalize_hex(color):
    parsed = parse_hex((color or "").strip())
    if parsed is None:
        return None
    return "#{:02x}{:02x}{:02x}".format(*parsed)


def load_usda_nutrients():
    """nutrient id -> {name, unit_name} from the SR Legacy nutrient table."""
    from usda_lib import load_nutrients  # local import: keeps --help cheap

    return {nutrient_id: row for nutrient_id, row in load_nutrients().items()}


def load_usda_foods():
    """fdc_id -> food row from the SR Legacy food table."""
    from usda_lib import load_food  # local import: keeps --help cheap

    return load_food()


def load_excluded_categories():
    """food_category id -> description for the categories P3 forbids."""
    from usda_lib import load_food_category

    categories = load_food_category()
    return {
        category_id: categories[category_id]["description"]
        for category_id in EXCLUDED_CATEGORY_IDS
        if category_id in categories
    }


def validate_nutrients(checks, usda_nutrients):
    header, rows = read_csv(DATA_SRC / "nutrients.csv")

    checks.check(header == CSV_COLUMNS, f"nutrients.csv columns are {header}, expected {CSV_COLUMNS}")
    checks.check(
        len(rows) == EXPECTED_COUNT,
        f"nutrients.csv has {len(rows)} rows, expected exactly {EXPECTED_COUNT}",
    )

    seen_ids = {}
    seen_colors = {}
    met_background = parse_hex(MET_BACKGROUND)
    met_border = parse_hex(MET_BORDER)
    text_rgb = parse_hex(TEXT_COLOR)

    for line_no, row in enumerate(rows, start=2):
        nutrient_id = (row.get("id") or "").strip()
        label = f"nutrients.csv line {line_no} ({nutrient_id or 'no id'})"

        if not checks.check(nutrient_id != "", f"{label}: empty id"):
            continue
        checks.check(nutrient_id in EXPECTED_NUTRIENTS, f"{label}: unknown nutrient id")

        if nutrient_id in seen_ids:
            checks.fail(f"{label}: duplicate id (also on line {seen_ids[nutrient_id]})")
        else:
            seen_ids[nutrient_id] = line_no

        name_zh = (row.get("name_zh") or "").strip()
        checks.check(
            name_zh != "" and has_cjk(name_zh),
            f"{label}: name_zh must be a non-empty Simplified Chinese name, got {name_zh!r}",
        )

        name_en = (row.get("name_en") or "").strip()
        checks.check(
            name_en != "" and name_en.isascii(),
            f"{label}: name_en must be a non-empty ASCII English name, got {name_en!r}",
        )

        unit = (row.get("unit") or "").strip()
        base_unit = unit.split(" ")[0] if unit else ""
        checks.check(
            base_unit in UNIT_TO_USDA,
            f"{label}: unit must start with 'ug' or 'mg', got {unit!r}",
        )

        kind = (row.get("kind") or "").strip()
        checks.check(kind in KINDS, f"{label}: kind must be vitamin or mineral, got {kind!r}")

        # USDA nutrient ids: they must exist and their unit must match ours.
        raw_ids = [part.strip() for part in (row.get("usda_nutrient_id") or "").split("+") if part.strip()]
        checks.check(raw_ids != [], f"{label}: empty usda_nutrient_id")
        parsed_ids = []
        for raw_id in raw_ids:
            if not raw_id.isdigit():
                checks.fail(f"{label}: usda_nutrient_id {raw_id!r} is not a number")
                continue
            parsed_ids.append(int(raw_id))
        checks.check(
            parsed_ids == sorted(set(parsed_ids)),
            f"{label}: usda_nutrient_id list must be unique and ascending, got {raw_ids}",
        )
        expected_ids = EXPECTED_NUTRIENTS.get(nutrient_id)
        if expected_ids is not None and parsed_ids:
            checks.check(
                parsed_ids[0] == expected_ids[0],
                f"{label}: primary USDA id {parsed_ids[0]} != expected {expected_ids[0]}",
            )
        for usda_id in parsed_ids:
            usda_row = usda_nutrients.get(usda_id)
            if not checks.check(usda_row is not None, f"{label}: USDA nutrient id {usda_id} not in nutrient.csv"):
                continue
            usda_unit = usda_row["unit_name"]
            allowed = UNIT_TO_USDA.get(base_unit, set())
            if (usda_id, usda_unit) in USDA_UNIT_OVERRIDES:
                allowed = allowed | {usda_unit}
            checks.check(
                usda_unit in allowed,
                f"{label}: USDA id {usda_id} ({usda_row['name']}) has unit {usda_unit}, "
                f"which does not match our unit {unit!r}",
            )
        if expected_ids is not None and parsed_ids:
            checks.check(
                parsed_ids == expected_ids,
                f"{label}: USDA ids {parsed_ids} != expected {expected_ids}",
            )

        raw_color = (row.get("color") or "").strip()
        parsed_color = parse_hex(raw_color)
        if not checks.check(parsed_color is not None, f"{label}: color {raw_color!r} is not #rrggbb"):
            continue
        color = normalize_hex(raw_color)
        checks.check(
            color not in seen_colors,
            f"{label}: color {color} already used on line {seen_colors.get(color)}",
        )
        seen_colors.setdefault(color, line_no)
        checks.check(
            parsed_color != met_background and parsed_color != met_border,
            f"{label}: color {color} is reserved for the 'met' state",
        )
        ratio = contrast_ratio(parsed_color, text_rgb)
        checks.check(
            ratio >= MIN_CONTRAST,
            f"{label}: color {color} has contrast {ratio:.2f}:1 with text {TEXT_COLOR}, "
            f"needs >= {MIN_CONTRAST}:1",
        )

    missing = [nutrient_id for nutrient_id in EXPECTED_NUTRIENTS if nutrient_id not in seen_ids]
    checks.check(not missing, f"nutrients.csv is missing these ids: {', '.join(missing)}")

    return len(rows)


def validate_foods(checks, usda_foods, excluded_categories):
    """Checks for data-src/foods_curated.csv (phase P3)."""
    path = DATA_SRC / "foods_curated.csv"
    if not checks.check(path.is_file(), "missing data-src/foods_curated.csv"):
        return 0

    header, rows = read_csv(path)
    checks.check(
        header == FOODS_COLUMNS,
        f"foods_curated.csv columns are {header}, expected {FOODS_COLUMNS}",
    )

    seen_ids = {}
    for line_no, row in enumerate(rows, start=2):
        raw_id = (row.get("fdc_id") or "").strip()
        label = f"foods_curated.csv line {line_no} ({raw_id or 'no fdc_id'})"

        if not checks.check(raw_id.isdigit(), f"{label}: fdc_id must be a number"):
            continue
        fdc_id = int(raw_id)

        if fdc_id in seen_ids:
            checks.fail(f"{label}: duplicate fdc_id (also on line {seen_ids[fdc_id]})")
        else:
            seen_ids[fdc_id] = line_no

        food = usda_foods.get(fdc_id)
        if not checks.check(food is not None, f"{label}: fdc_id {fdc_id} not in SR Legacy food.csv"):
            continue

        category_id = food["food_category_id"]
        if category_id in excluded_categories:
            checks.fail(
                f"{label}: excluded category {category_id} "
                f"({excluded_categories[category_id]}): {food['description']}"
            )

        name_zh = (row.get("name_zh") or "").strip()
        checks.check(
            name_zh != "" and has_cjk(name_zh),
            f"{label}: name_zh must be a non-empty Chinese name, got {name_zh!r}",
        )

        name_en = (row.get("name_en") or "").strip()
        checks.check(name_en != "", f"{label}: name_en must not be empty")

        category_zh = (row.get("category_zh") or "").strip()
        checks.check(
            category_zh != "" and has_cjk(category_zh),
            f"{label}: category_zh must be a non-empty Chinese category, got {category_zh!r}",
        )

        aliases = (row.get("aliases_zh") or "").strip()
        if aliases:
            checks.check(
                all(has_cjk(part) for part in aliases.split("|") if part.strip()),
                f"{label}: aliases_zh entries must be Chinese, got {aliases!r}",
            )

    return len(rows)


# --- P4: generated JSON under docs/data -------------------------------------

DOCS_DATA = REPO_ROOT / "docs" / "data"
FOODS_JSON_MAX_BYTES = 1_500_000
DATA_FILENAMES = ["foods.json", "nutrients.json", "meta.json"]
SR_SOURCE_NAME = "USDA FoodData Central SR Legacy"
SR_SOURCE_URL = (
    "https://fdc.nal.usda.gov/fdc-datasets/"
    "FoodData_Central_sr_legacy_food_csv_2018-04.zip"
)


def significant_digits(value):
    """Number of significant digits of a non-zero number as written in JSON.

    Trailing zeros of whole numbers are not significant (10750 has four), so the
    decimal is normalized before counting.
    """
    return len(Decimal(repr(value)).normalize().as_tuple().digits)


def load_json(checks, path):
    if not checks.check(path.is_file(), f"missing {path.relative_to(REPO_ROOT)}"):
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        checks.fail(f"{path.relative_to(REPO_ROOT)} is not valid JSON: {error}")
        return None


def validate_nutrients_json(checks, nutrients_data):
    checks.check(
        (nutrients_data.get("source") or {}).get("name") == SR_SOURCE_NAME,
        "nutrients.json source.name is wrong",
    )
    nutrient_rows = nutrients_data.get("nutrients") or []
    checks.check(
        [row.get("id") for row in nutrient_rows] == list(EXPECTED_NUTRIENTS),
        "nutrients.json must list the 22 nutrient ids in nutrients.csv order",
    )
    for row in nutrient_rows:
        checks.check(
            isinstance(row.get("nameZh"), str) and has_cjk(row["nameZh"]),
            f"nutrients.json {row.get('id')}: nameZh must be Chinese",
        )
        checks.check(
            isinstance(row.get("unit"), str) and row["unit"] != "",
            f"nutrients.json {row.get('id')}: empty unit",
        )
        checks.check(
            isinstance(row.get("color"), str) and parse_hex(row["color"]) is not None,
            f"nutrients.json {row.get('id')}: color must be #rrggbb",
        )


def validate_meta_json(checks, meta_data):
    source = meta_data.get("source") or {}
    checks.check(source.get("name") == SR_SOURCE_NAME, "meta.json source.name is wrong")
    checks.check(source.get("release") == "2018-04", "meta.json source.release must be 2018-04")
    checks.check(
        source.get("url") == SR_SOURCE_URL,
        "meta.json source.url must be the SR Legacy 2018-04 zip URL",
    )
    build_date = meta_data.get("buildDate")
    checks.check(
        isinstance(build_date, str)
        and len(build_date) == 10
        and build_date[4] == "-"
        and build_date[7] == "-",
        f"meta.json buildDate must be an ISO date, got {build_date!r}",
    )


def validate_food_measures(checks, label, measures):
    checks.check(len(measures) >= 1, f"{label}: needs at least one measure")
    defaults = [measure for measure in measures if measure.get("default") is True]
    checks.check(len(defaults) == 1, f"{label}: needs exactly one default measure")
    for measure in measures:
        measure_label = f"{label} measure {measure.get('id') or 'no id'}"
        grams = measure.get("grams")
        checks.check(
            isinstance(grams, (int, float))
            and not isinstance(grams, bool)
            and 1 <= grams <= 1000,
            f"{measure_label}: grams must be 1..1000, got {grams!r}",
        )
        basis = measure.get("basis") or ""
        checks.check(
            basis.startswith("usda_portion:") or basis.startswith("estimate:"),
            f"{measure_label}: basis must be usda_portion:<id> or estimate:<text>, got {basis!r}",
        )
        checks.check(
            isinstance(measure.get("labelZh"), str) and has_cjk(measure["labelZh"]),
            f"{measure_label}: labelZh must be Chinese",
        )


def validate_foods_json(checks, foods_data, curated_count):
    checks.check(
        (foods_data.get("source") or {}).get("name") == SR_SOURCE_NAME,
        "foods.json source.name is wrong",
    )
    foods = foods_data.get("foods") or []
    checks.check(
        len(foods) >= curated_count,
        f"foods.json has {len(foods)} foods but foods_curated.csv has {curated_count} rows",
    )

    expected_nutrients = list(EXPECTED_NUTRIENTS)
    sr_ids = set()
    seen_food_ids = set()
    composites = 0
    null_values = 0

    for food in foods:
        food_id = str(food.get("id") or "")
        label = f"foods.json {food_id or 'no id'}"
        if food_id in seen_food_ids:
            checks.fail(f"{label}: duplicate food id")
        seen_food_ids.add(food_id)

        is_composite = food_id.startswith("composite:")
        if is_composite:
            composites += 1
            checks.check(food.get("estimate") is True, f"{label}: composite must have estimate true")
            checks.check(
                isinstance(food.get("basis"), str) and food["basis"] != "",
                f"{label}: composite needs a non-empty basis",
            )
        else:
            checks.check(
                food_id == f"fdc:{food.get('fdcId')}",
                f"{label}: id must be 'fdc:<fdcId>'",
            )
            checks.check(
                food.get("estimate") is False, f"{label}: curated food must have estimate false"
            )
            checks.check(food.get("basis") is None, f"{label}: curated food must have basis null")
            sr_ids.add(food.get("fdcId"))

        for key in ("nameZh", "nameEn", "category"):
            checks.check(
                isinstance(food.get(key), str) and food[key] != "",
                f"{label}: {key} must be a non-empty string",
            )
        checks.check(has_cjk(str(food.get("nameZh") or "")), f"{label}: nameZh must be Chinese")
        checks.check(isinstance(food.get("aliases"), list), f"{label}: aliases must be a list")

        per100g = food.get("per100g") or {}
        checks.check(
            sorted(per100g) == sorted(expected_nutrients),
            f"{label}: per100g keys must be exactly the 22 nutrient ids",
        )
        for nutrient_id, value in per100g.items():
            if value is None:
                null_values += 1
                continue
            if not checks.check(
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and value >= 0,
                f"{label} {nutrient_id}: value must be null or a non-negative number, "
                f"got {value!r}",
            ):
                continue
            checks.check(
                value == 0 or significant_digits(value) <= 4,
                f"{label} {nutrient_id}: {value} has more than 4 significant digits",
            )

        flags = food.get("flags") or {}
        checks.check(
            flags.get("niacinNoTryptophan") in (True, False),
            f"{label}: flags.niacinNoTryptophan must be a boolean",
        )
        validate_food_measures(checks, label, food.get("measures") or [])

    curated_ids = set()
    for row in read_csv(DATA_SRC / "foods_curated.csv")[1]:
        raw_id = (row.get("fdc_id") or "").strip()
        if raw_id.isdigit():
            curated_ids.add(int(raw_id))
    checks.check(
        curated_ids == sr_ids,
        "foods.json must contain every curated fdc_id exactly once "
        f"(missing {len(curated_ids - sr_ids)}, unexpected {len(sr_ids - curated_ids)})",
    )
    checks.check(null_values > 0, "foods.json has no null values: missing data must be preserved")
    return len(foods), composites


def validate_generated_json(checks, curated_count):
    """Checks for docs/data/*.json written by tools/build_foods.py (phase P4)."""
    foods_path = DOCS_DATA / "foods.json"
    if not checks.check(foods_path.is_file(), "missing docs/data/foods.json"):
        return 0, 0, 0

    size = foods_path.stat().st_size
    checks.check(
        size < FOODS_JSON_MAX_BYTES,
        f"foods.json is {size} bytes, must stay under {FOODS_JSON_MAX_BYTES}",
    )

    for name in DATA_FILENAMES:
        path = DOCS_DATA / name
        if not checks.check(path.is_file(), f"missing docs/data/{name}"):
            continue
        text = path.read_text(encoding="utf-8")
        checks.check(
            ":/" not in text.replace("https://", "").replace("http://", ""),
            f"{name} must not contain absolute URL paths",
        )

    foods_data = load_json(checks, foods_path)
    nutrients_data = load_json(checks, DOCS_DATA / "nutrients.json")
    meta_data = load_json(checks, DOCS_DATA / "meta.json")
    if foods_data is None or nutrients_data is None or meta_data is None:
        return 0, 0, 0

    validate_nutrients_json(checks, nutrients_data)
    validate_meta_json(checks, meta_data)
    food_count, composite_count = validate_foods_json(checks, foods_data, curated_count)
    return food_count, composite_count, size


def main():
    checks = Checks()
    usda_nutrients = load_usda_nutrients()
    nutrient_count = validate_nutrients(checks, usda_nutrients)
    food_count = validate_foods(checks, load_usda_foods(), load_excluded_categories())
    json_food_count, composite_count, foods_json_size = validate_generated_json(
        checks, food_count
    )

    if checks.failures:
        print(f"nutrients: {nutrient_count} rows checked")
        print(f"foods: {food_count} rows checked")
        print(f"foods.json: {json_food_count} foods checked")
        print(f"{len(checks.failures)} problem(s) found")
        return checks.report()

    print(f"nutrients: {nutrient_count} OK")
    print(f"foods: {food_count} OK")
    print(
        f"foods.json: {json_food_count} foods OK "
        f"({composite_count} composites, {foods_json_size} bytes)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
