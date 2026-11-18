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

Phase P5 adds:
    data-src/measures.csv - header, one row per measure of every curated food,
                     a single default per food, 1..1000 g, every basis either
                     `usda_portion:<food_portion.id>` for a portion row of that
                     same food or `estimate:<text>`, Chinese labels, no
                     duplicate label per food, at most 4 measures per food, the
                     measures in foods.json match the CSV, and the five sanity
                     ranges of PLAN.md P5 (egg, handful of nuts, fist and bowl
                     of cooked rice, cup of milk). The share of estimated
                     measures is printed.

Phase P6 adds:
    data-src/composites.csv - header, unique composite ids, Chinese and ASCII
                     English names, at least two ingredients per dish, every
                     ingredient fdc_id a curated food (never another composite),
                     positive grams, grams per 100 g summing to 100 +/- 0.5,
                     a note that says the recipe is a rough home recipe, and a
                     household measure with exactly one default per composite.
                     foods.json must carry every composite with estimate true, a
                     basis that lists its ingredients and grams, and per-100 g
                     values recomputed here from the ingredient values.

Phase P18b adds:
    data-src/commonness.csv - header, one row per food of foods.json and no
                     other id, integer tiers within 1..5. Every food in
                     foods.json carries that same integer `commonness`, and no
                     review text leaks into docs/: no docs/data/*.json has a
                     `reason`/`reason_zh` key, and no file under docs/ (JSON,
                     JS, HTML) contains any reason_zh string of the CSV.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

# data-src/measures.csv columns (PLAN.md 1.3).
MEASURES_COLUMNS = ["food_key", "measure_id", "label_zh", "grams", "basis", "is_default"]
MAX_MEASURES_PER_FOOD = 4

# data-src/composites.csv columns (PLAN.md 1.3, phase P6).
COMPOSITES_COLUMNS = [
    "composite_id",
    "name_zh",
    "name_en",
    "ingredient_fdc_id",
    "grams_per_100g",
    "note",
]
COMPOSITE_GRAMS_TOLERANCE = 0.5
MIN_COMPOSITE_INGREDIENTS = 2
MAX_COMPOSITES = 25

# data-src/commonness.csv columns (phase P18b).
COMMONNESS_COLUMNS = ["food_id", "name_zh", "commonness", "reason_zh"]
COMMONNESS_MIN = 1
COMMONNESS_MAX = 5
# Files under docs/ that are scanned for leaked review text (P18b).
DOCS_SCAN_SUFFIXES = {".json", ".js", ".mjs", ".html"}

# Sanity ranges from PLAN.md P5: (name, food+measure matcher, min g, max g).
# Each matcher only picks the plain household measure it talks about, so a
# cooked scramble (mass changed by the pan) or a quail egg (a different bird)
# does not have to fit the hen's egg weight.
SANITY_RANGES = [
    (
        "one whole hen egg",
        lambda food, measure: food["category_zh"] == "蛋类"
        and "鸡蛋" in food["name_zh"]
        and "炒" not in food["name_zh"]
        and "煎" not in food["name_zh"]
        and measure["label"] == "一个",
        40,
        60,
    ),
    (
        "handful of nuts or seeds",
        lambda food, measure: food["category_zh"] in ("坚果类", "种子类")
        and measure["label"] == "一把",
        15,
        35,
    ),
    (
        "fist of cooked rice",
        lambda food, measure: food["category_zh"] == "谷物与面食"
        and "饭" in food["name_zh"]
        and measure["label"] == "一拳",
        100,
        200,
    ),
    (
        "bowl of cooked rice",
        lambda food, measure: food["category_zh"] == "谷物与面食"
        and "饭" in food["name_zh"]
        and measure["label"] == "一碗",
        120,
        250,
    ),
    (
        "cup of milk",
        lambda food, measure: food["category_zh"] == "奶类"
        and any(word in food["name_zh"] for word in ("牛奶", "山羊奶", "酪乳"))
        and measure["label"] == "一杯",
        200,
        260,
    ),
]


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


def load_usda_portions():
    """fdc_id -> {food_portion.id: gram_weight} from the SR Legacy table."""
    from usda_lib import load_food_portion  # local import: keeps --help cheap

    return {
        fdc_id: {row["id"]: row["gram_weight"] for row in rows}
        for fdc_id, rows in load_food_portion().items()
    }


def validate_measures_csv(checks):
    """Checks for data-src/measures.csv (phase P5).

    Returns (row count, share of estimate rows in percent, food_key -> measures)
    so that the generated foods.json can be compared with the CSV.
    """
    path = DATA_SRC / "measures.csv"
    if not checks.check(path.is_file(), "missing data-src/measures.csv"):
        return 0, 0.0, {}

    header, rows = read_csv(path)
    checks.check(
        header == MEASURES_COLUMNS,
        f"measures.csv columns are {header}, expected {MEASURES_COLUMNS}",
    )

    portions = load_usda_portions()

    curated = {}
    for row in read_csv(DATA_SRC / "foods_curated.csv")[1]:
        raw_id = (row.get("fdc_id") or "").strip()
        if raw_id.isdigit():
            curated[raw_id] = {
                "category_zh": (row.get("category_zh") or "").strip(),
                "name_zh": (row.get("name_zh") or "").strip(),
            }
    # Composite ids (phase P6) are allowed as food_key too, but only with
    # estimate measures; they have no USDA portion table.
    composite_ids = set()
    composites_path = DATA_SRC / "composites.csv"
    if composites_path.is_file():
        for row in read_csv(composites_path)[1]:
            composite_id = (row.get("composite_id") or "").strip()
            if composite_id:
                composite_ids.add(composite_id)

    measures = defaultdict(list)
    for line_no, row in enumerate(rows, start=2):
        food_key = (row.get("food_key") or "").strip()
        measure_id = (row.get("measure_id") or "").strip()
        label = f"measures.csv line {line_no} ({food_key or 'no food_key'}/{measure_id or 'no id'})"

        if not checks.check(food_key != "", f"{label}: empty food_key"):
            continue
        checks.check(
            food_key in curated or food_key in composite_ids,
            f"{label}: food_key is neither a curated fdc_id nor a known composite id",
        )
        if not checks.check(measure_id != "", f"{label}: empty measure_id"):
            continue

        if any(item["id"] == measure_id for item in measures[food_key]):
            checks.fail(f"{label}: duplicate measure_id for this food")

        try:
            grams = float(row.get("grams") or "")
        except ValueError:
            checks.fail(f"{label}: grams {row.get('grams')!r} is not a number")
            continue
        checks.check(
            1 <= grams <= 1000, f"{label}: grams must be 1..1000, got {grams!r}"
        )

        is_default = (row.get("is_default") or "").strip()
        checks.check(is_default in ("0", "1"), f"{label}: is_default must be 0 or 1")

        checks.check(
            has_cjk((row.get("label_zh") or "").strip()),
            f"{label}: label_zh must be Chinese, got {row.get('label_zh')!r}",
        )

        basis = (row.get("basis") or "").strip()
        if basis.startswith("usda_portion:"):
            raw_portion_id = basis.split(":", 1)[1]
            if not checks.check(
                raw_portion_id.isdigit(), f"{label}: usda_portion basis needs a numeric id"
            ):
                continue
            portion_id = int(raw_portion_id)
            food_portions = portions.get(int(food_key), {}) if food_key.isdigit() else {}
            if not checks.check(
                portion_id in food_portions,
                f"{label}: {basis} is not a food_portion id of fdc_id {food_key}",
            ):
                continue
            portion_grams = food_portions[portion_id]
            checks.check(
                portion_grams is not None and abs(portion_grams - grams) < 0.05,
                f"{label}: grams {grams} != food_portion gram_weight {portion_grams}",
            )
        elif basis.startswith("estimate:"):
            checks.check(
                len(basis) > len("estimate:") + 5,
                f"{label}: estimate basis needs a reason, got {basis!r}",
            )
        else:
            checks.fail(
                f"{label}: basis must be usda_portion:<id> or estimate:<text>, got {basis!r}"
            )

        measures[food_key].append(
            {
                "id": measure_id,
                "label": (row.get("label_zh") or "").strip(),
                "grams": grams,
                "basis": basis,
                "isDefault": is_default == "1",
            }
        )

    for food_key, food in curated.items():
        food_measures = measures.get(food_key, [])
        if not checks.check(
            len(food_measures) >= 1, f"measures.csv: fdc_id {food_key} has no measure"
        ):
            continue
        defaults = [measure for measure in food_measures if measure["isDefault"]]
        checks.check(
            len(defaults) == 1,
            f"measures.csv: fdc_id {food_key} has {len(defaults)} default measures, "
            "expected exactly 1",
        )
        checks.check(
            len(food_measures) <= MAX_MEASURES_PER_FOOD,
            f"measures.csv: fdc_id {food_key} has {len(food_measures)} measures, "
            f"at most {MAX_MEASURES_PER_FOOD} allowed",
        )
        labels = [measure["label"] for measure in food_measures]
        checks.check(
            len(labels) == len(set(labels)),
            f"measures.csv: fdc_id {food_key} repeats a label: {labels}",
        )

    unknown_keys = sorted(set(measures) - set(curated) - composite_ids)
    checks.check(
        not unknown_keys,
        f"measures.csv has measures for unknown foods: {', '.join(unknown_keys)}",
    )

    # Sanity ranges from PLAN.md P5. Each range must find at least one measure,
    # otherwise the rule would silently check nothing.
    for name, matcher, low, high in SANITY_RANGES:
        hits = [
            (food_key, measure)
            for food_key, food in curated.items()
            for measure in measures.get(food_key, [])
            if matcher(food, measure)
        ]
        if checks.check(hits != [], f"sanity: no food found for the {name} range"):
            for food_key, measure in hits:
                if not (
                    checks.check(
                        low <= measure["grams"] <= high,
                        f"sanity: {curated[food_key]['name_zh']} {measure['label']} "
                        f"is {measure['grams']:g} g, expected {low}-{high} g ({name})",
                    )
                ):
                    break

    total = len(rows)
    estimates = sum(
        1 for measure_rows in measures.values() for measure in measure_rows
        if measure["basis"].startswith("estimate:")
    )
    share = (estimates / total * 100) if total else 0.0
    return total, share, dict(measures)


def validate_composites_csv(checks, measures):
    """Checks for data-src/composites.csv (phase P6).

    Returns (composite count, {composite_id: [composite food dict]}), the
    latter used to recompute the values written to foods.json.
    """
    path = DATA_SRC / "composites.csv"
    if not checks.check(path.is_file(), "missing data-src/composites.csv"):
        return 0, {}

    header, rows = read_csv(path)
    checks.check(
        header == COMPOSITES_COLUMNS,
        f"composites.csv columns are {header}, expected {COMPOSITES_COLUMNS}",
    )

    curated = {}
    for row in read_csv(DATA_SRC / "foods_curated.csv")[1]:
        raw_id = (row.get("fdc_id") or "").strip()
        if raw_id.isdigit():
            curated[int(raw_id)] = {
                "name_zh": (row.get("name_zh") or "").strip(),
                "category_zh": (row.get("category_zh") or "").strip(),
            }

    grouped = {}
    order = []
    for line_no, row in enumerate(rows, start=2):
        composite_id = (row.get("composite_id") or "").strip()
        label = f"composites.csv line {line_no} ({composite_id or 'no composite_id'})"

        if not checks.check(composite_id != "", f"{label}: empty composite_id"):
            continue
        checks.check(
            composite_id.isascii()
            and composite_id.replace("-", "").replace("_", "").isalnum()
            and composite_id == composite_id.lower(),
            f"{label}: composite_id must be lowercase ASCII letters, digits, '-' or '_'",
        )
        if composite_id not in grouped:
            grouped[composite_id] = {
                "name_zh": (row.get("name_zh") or "").strip(),
                "name_en": (row.get("name_en") or "").strip(),
                "note": (row.get("note") or "").strip(),
                "ingredients": [],
            }
            order.append(composite_id)
        else:
            entry = grouped[composite_id]
            for key, column in (
                ("name_zh", "name_zh"),
                ("name_en", "name_en"),
                ("note", "note"),
            ):
                checks.check(
                    entry[key] == (row.get(column) or "").strip(),
                    f"{label}: {column} differs from the first row of this composite",
                )

        raw_ingredient = (row.get("ingredient_fdc_id") or "").strip()
        if not checks.check(
            raw_ingredient.isdigit(), f"{label}: ingredient_fdc_id must be a number"
        ):
            continue
        ingredient_id = int(raw_ingredient)
        checks.check(
            ingredient_id in curated,
            f"{label}: ingredient fdc_id {ingredient_id} is not in foods_curated.csv "
            "(composites may only use curated foods, never other composites)",
        )

        raw_grams = (row.get("grams_per_100g") or "").strip()
        try:
            grams = float(raw_grams)
        except ValueError:
            checks.fail(f"{label}: grams_per_100g {raw_grams!r} is not a number")
            continue
        checks.check(grams > 0, f"{label}: grams_per_100g must be positive, got {grams:g}")
        checks.check(
            any(item["fdc_id"] == ingredient_id for item in grouped[composite_id]["ingredients"]) is False,
            f"{label}: duplicate ingredient fdc_id {ingredient_id}",
        )
        grouped[composite_id]["ingredients"].append({"fdc_id": ingredient_id, "grams": grams})

    checks.check(
        len(order) <= MAX_COMPOSITES,
        f"composites.csv has {len(order)} composites, at most {MAX_COMPOSITES} planned",
    )

    result = {}
    for composite_id in order:
        entry = grouped[composite_id]
        label = f"composites.csv {composite_id}"

        checks.check(
            entry["name_zh"] != "" and has_cjk(entry["name_zh"]),
            f"{label}: name_zh must be a non-empty Chinese name, got {entry['name_zh']!r}",
        )
        checks.check(
            entry["name_en"] != "" and entry["name_en"].isascii(),
            f"{label}: name_en must be a non-empty ASCII English name, got {entry['name_en']!r}",
        )
        checks.check(
            "rough" in entry["note"].lower() and "no cooking retention" in entry["note"].lower(),
            f"{label}: note must say the recipe is a rough home recipe without "
            f"cooking retention factors, got {entry['note']!r}",
        )
        checks.check(
            len(entry["ingredients"]) >= MIN_COMPOSITE_INGREDIENTS,
            f"{label}: needs at least {MIN_COMPOSITE_INGREDIENTS} ingredients, "
            f"got {len(entry['ingredients'])}",
        )
        total = sum(ingredient["grams"] for ingredient in entry["ingredients"])
        checks.check(
            abs(total - 100) <= COMPOSITE_GRAMS_TOLERANCE,
            f"{label}: grams per 100 g sum to {total:g}, expected 100 +/- "
            f"{COMPOSITE_GRAMS_TOLERANCE:g}",
        )

        # The composite must have a default household measure (P6 gives every
        # dish 一碗 / 一个 / 一盘 ...). Missing measures are reported once.
        food_measures = measures.get(composite_id) or []
        if checks.check(food_measures != [], f"{label}: no household measure in measures.csv"):
            defaults = [measure for measure in food_measures if measure["isDefault"]]
            checks.check(
                len(defaults) == 1,
                f"{label}: has {len(defaults)} default measures, expected exactly 1",
            )

        result[composite_id] = entry
    return len(order), result


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


def validate_foods_json(checks, foods_data, curated_count, measures=None, composite_rows=None):
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
        if measures is not None:
            validate_measure_merge(checks, label, food, measures)

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

    if composite_rows is not None:
        validate_composite_values(checks, foods, composite_rows)
        expected_composite_ids = {f"composite:{composite_id}" for composite_id in composite_rows}
        found_composite_ids = {
            str(food.get("id") or "") for food in foods if str(food.get("id") or "").startswith("composite:")
        }
        checks.check(
            found_composite_ids == expected_composite_ids,
            "foods.json composites must be exactly the composites.csv rows "
            f"(missing {sorted(expected_composite_ids - found_composite_ids)}, "
            f"unexpected {sorted(found_composite_ids - expected_composite_ids)})",
        )
    return len(foods), composites


def expected_composite_per100g(entry, values_by_id, nutrient_ids):
    """Recompute a composite per 100 g from its ingredient values.

    Returns (values, partial) where values has the same 4-significant-digit
    rounding as build_foods.py and partial lists the nutrients for which some
    ingredient has no value while another one does (those count as 0).
    """
    totals = {nutrient_id: 0.0 for nutrient_id in nutrient_ids}
    known = {nutrient_id: False for nutrient_id in nutrient_ids}
    missing = set()
    for ingredient in entry["ingredients"]:
        share = ingredient["grams"] / 100.0
        for nutrient_id in nutrient_ids:
            # An unknown ingredient is already reported by the caller; skip it
            # here instead of crashing so every other failure is still listed.
            value = values_by_id.get(ingredient["fdc_id"], {}).get(nutrient_id)
            if value is None:
                missing.add(nutrient_id)
                continue
            totals[nutrient_id] += value * share
            known[nutrient_id] = True
    partial = [nutrient_id for nutrient_id in nutrient_ids if nutrient_id in missing and known[nutrient_id]]
    values = {}
    for nutrient_id in nutrient_ids:
        if not known[nutrient_id]:
            values[nutrient_id] = None
            continue
        # Same rule as build_foods.py: at most 4 significant digits.
        values[nutrient_id] = round_significant(totals[nutrient_id])
    return values, partial


def round_significant(value, digits=4):
    """Round to at most `digits` significant digits (ROUND_HALF_UP), as the build does."""
    from decimal import ROUND_HALF_UP

    if value == 0:
        return 0
    decimal_value = Decimal(repr(float(value)))
    exponent = decimal_value.adjusted() - (digits - 1)
    rounded = decimal_value.scaleb(-exponent).quantize(Decimal(1), rounding=ROUND_HALF_UP).scaleb(exponent)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def validate_composite_values(checks, foods, composites):
    """Every composite in foods.json must equal its recomputed ingredient sum."""
    foods_by_id = {food.get("id"): food for food in foods}
    values_by_id = {
        food.get("fdcId"): food.get("per100g") or {}
        for food in foods
        if food.get("fdcId") is not None
    }
    nutrient_ids = list(EXPECTED_NUTRIENTS)

    for composite_id, entry in composites.items():
        food_id = f"composite:{composite_id}"
        food = foods_by_id.get(food_id)
        if not checks.check(food is not None, f"foods.json misses {food_id}"):
            continue
        label = f"foods.json {food_id}"

        for ingredient in entry["ingredients"]:
            ingredient_id = ingredient["fdc_id"]
            if not checks.check(
                ingredient_id in values_by_id,
                f"{label}: ingredient fdc:{ingredient_id} is missing from foods.json",
            ):
                continue
            checks.check(
                f"fdc:{ingredient_id} {ingredient['grams']:g} g" in (food.get("basis") or ""),
                f"{label}: basis must list 'fdc:{ingredient_id} {ingredient['grams']:g} g'",
            )

        expected, partial = expected_composite_per100g(entry, values_by_id, nutrient_ids)
        actual = food.get("per100g") or {}
        for nutrient_id in nutrient_ids:
            checks.check(
                actual.get(nutrient_id) == expected[nutrient_id],
                f"{label} {nutrient_id}: {actual.get(nutrient_id)!r} != recomputed "
                f"{expected[nutrient_id]!r}",
            )

        flags = food.get("flags") or {}
        checks.check(
            flags.get("partialNullNutrients") == partial,
            f"{label}: flags.partialNullNutrients is {flags.get('partialNullNutrients')!r}, "
            f"expected {partial!r}",
        )
        if partial:
            checks.check(
                "counted as 0" in (food.get("basis") or ""),
                f"{label}: basis must say that ingredients without a value were counted as 0",
            )


def validate_measure_merge(checks, label, food, measures):
    """foods.json measures must be exactly the measures.csv rows of that food."""
    food_id = str(food.get("id") or "")
    # Composite dishes are keyed by their bare composite_id in measures.csv.
    if not food_id.startswith("fdc:") and not food_id.startswith("composite:"):
        return
    food_key = food_id.split(":", 1)[1]
    csv_measures = measures.get(food_key)
    checks.check(csv_measures is not None, f"{label}: no measures.csv rows for this food")
    if not csv_measures:
        return
    json_measures = food.get("measures") or []
    checks.check(
        len(json_measures) == len(csv_measures),
        f"{label}: foods.json has {len(json_measures)} measures, "
        f"measures.csv has {len(csv_measures)}",
    )
    for csv_measure, json_measure in zip(csv_measures, json_measures):
        checks.check(
            json_measure.get("id") == csv_measure["id"]
            and json_measure.get("labelZh") == csv_measure["label"]
            and json_measure.get("basis") == csv_measure["basis"]
            and json_measure.get("default") is csv_measure["isDefault"]
            and isinstance(json_measure.get("grams"), (int, float))
            and abs(json_measure["grams"] - csv_measure["grams"]) < 0.05,
            f"{label}: foods.json measure {json_measure.get('id')} does not match "
            f"measures.csv ({json_measure} vs {csv_measure})",
        )


def validate_commonness_csv(checks):
    """Checks for data-src/commonness.csv (phase P18b).

    Returns food_id -> tier so the generated foods.json can be compared.
    """
    path = DATA_SRC / "commonness.csv"
    if not checks.check(path.is_file(), "missing data-src/commonness.csv"):
        return {}

    header, rows = read_csv(path)
    checks.check(
        header == COMMONNESS_COLUMNS,
        f"commonness.csv columns are {header}, expected {COMMONNESS_COLUMNS}",
    )

    tiers = {}
    for line_no, row in enumerate(rows, start=2):
        food_id = (row.get("food_id") or "").strip()
        label = f"commonness.csv line {line_no} ({food_id or 'no food_id'})"

        if not checks.check(food_id != "", f"{label}: empty food_id"):
            continue
        if food_id in tiers:
            checks.fail(f"{label}: duplicate food_id (also on line {tiers[food_id][1]})")
            continue

        raw_tier = (row.get("commonness") or "").strip()
        tier = None
        if checks.check(raw_tier.isdigit(), f"{label}: commonness must be an integer, got {raw_tier!r}"):
            tier = int(raw_tier)
            checks.check(
                COMMONNESS_MIN <= tier <= COMMONNESS_MAX,
                f"{label}: commonness {tier} is outside {COMMONNESS_MIN}..{COMMONNESS_MAX}",
            )

        name_zh = (row.get("name_zh") or "").strip()
        checks.check(
            name_zh != "" and has_cjk(name_zh),
            f"{label}: name_zh must be a non-empty Chinese name, got {name_zh!r}",
        )
        checks.check(
            (row.get("reason_zh") or "").strip() != "",
            f"{label}: reason_zh must not be empty (review material, never published)",
        )
        if tier is not None:
            tiers[food_id] = (tier, line_no)
    return {food_id: entry[0] for food_id, entry in tiers.items()}


def validate_commonness_json(checks, foods, tiers):
    """Every food in foods.json has its CSV tier as an integer of 1..5."""
    food_ids = {str(food.get("id") or "") for food in foods}
    tier_ids = set(tiers)

    missing = sorted(food_ids - tier_ids)
    checks.check(
        not missing,
        f"commonness.csv has no tier for {len(missing)} food(s) of foods.json: "
        f"{', '.join(missing[:10])}",
    )
    unknown = sorted(tier_ids - food_ids)
    checks.check(
        not unknown,
        f"commonness.csv lists {len(unknown)} id(s) that are not in foods.json: "
        f"{', '.join(unknown[:10])}",
    )

    for food in foods:
        food_id = str(food.get("id") or "")
        label = f"foods.json {food_id or 'no id'}"
        tier = food.get("commonness")
        checks.check(
            isinstance(tier, int) and not isinstance(tier, bool)
            and COMMONNESS_MIN <= tier <= COMMONNESS_MAX,
            f"{label}: commonness must be an integer {COMMONNESS_MIN}..{COMMONNESS_MAX}, "
            f"got {tier!r}",
        )
        if food_id in tiers:
            checks.check(
                tier == tiers[food_id],
                f"{label}: commonness {tier!r} != commonness.csv {tiers[food_id]}",
            )


def iter_json_keys(value, path=""):
    """Yield (key path) of every object key in a decoded JSON value."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield f"{path}.{key}" if path else str(key)
            yield from iter_json_keys(item, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from iter_json_keys(item, f"{path}[{index}]")


def validate_no_reason_leak(checks):
    """No review reason text and no `reason` key may reach docs/ (P18b)."""
    path = DATA_SRC / "commonness.csv"
    if not checks.check(path.is_file(), "missing data-src/commonness.csv"):
        return 0
    _, rows = read_csv(path)
    reasons = sorted({
        (row.get("reason_zh") or "").strip()
        for row in rows
        if (row.get("reason_zh") or "").strip()
    })

    docs_root = REPO_ROOT / "docs"
    scanned = 0
    leaked = []
    reason_hits = []
    for file_path in sorted(docs_root.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in DOCS_SCAN_SUFFIXES:
            continue
        scanned += 1
        text = file_path.read_text(encoding="utf-8", errors="replace")
        relative = file_path.relative_to(REPO_ROOT)
        for reason in reasons:
            if reason in text:
                reason_hits.append(f"{relative}: contains reason text {reason!r}")
        if file_path.parent == DOCS_DATA and file_path.suffix.lower() == ".json":
            try:
                decoded = json.loads(text)
            except json.JSONDecodeError:
                continue
            for key in iter_json_keys(decoded):
                bare = key.rsplit(".", 1)[-1].split("[", 1)[0]
                if bare in ("reason", "reason_zh"):
                    leaked.append(f"{relative}: key {key}")

    checks.check(not leaked, "docs/data JSON must not contain reason keys: " + "; ".join(leaked[:5]))
    checks.check(
        not reason_hits,
        "docs/ must not contain commonness reason text: " + "; ".join(reason_hits[:3]),
    )
    return scanned


def validate_generated_json(checks, curated_count, measures=None, composite_rows=None, tiers=None):
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
    food_count, composite_count = validate_foods_json(
        checks, foods_data, curated_count, measures, composite_rows
    )
    if tiers is not None:
        validate_commonness_json(checks, foods_data.get("foods") or [], tiers)
    return food_count, composite_count, size


def main():
    checks = Checks()
    usda_nutrients = load_usda_nutrients()
    nutrient_count = validate_nutrients(checks, usda_nutrients)
    food_count = validate_foods(checks, load_usda_foods(), load_excluded_categories())
    measures_count, estimate_share, measures = validate_measures_csv(checks)
    composite_count_csv, composites = validate_composites_csv(checks, measures)
    tiers = validate_commonness_csv(checks)
    docs_scanned = validate_no_reason_leak(checks)
    json_food_count, composite_count, foods_json_size = validate_generated_json(
        checks, food_count, measures, composites if composites else None, tiers
    )

    if checks.failures:
        print(f"nutrients: {nutrient_count} rows checked")
        print(f"foods: {food_count} rows checked")
        print(f"measures: {measures_count} rows checked, {estimate_share:.1f}% estimates")
        print(f"composites: {composite_count_csv} rows checked")
        print(f"commonness: {len(tiers)} tiers checked")
        print(f"docs/ text scan: {docs_scanned} files checked")
        print(f"foods.json: {json_food_count} foods checked")
        print(f"{len(checks.failures)} problem(s) found")
        return checks.report()

    print(f"nutrients: {nutrient_count} OK")
    print(f"foods: {food_count} OK")
    print(
        f"measures: {measures_count} rows OK for {food_count + composite_count_csv} foods, "
        f"{estimate_share:.1f}% estimates"
    )
    print(f"composites: {composite_count_csv} OK (ingredients sum to 100 g +/- {COMPOSITE_GRAMS_TOLERANCE:g})")
    print(f"commonness: {len(tiers)} tiers OK (1..5, no reason text under docs/)")
    print(f"docs/ text scan: {docs_scanned} files OK")
    print(
        f"foods.json: {json_food_count} foods OK "
        f"({composite_count} composites, {foods_json_size} bytes)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
