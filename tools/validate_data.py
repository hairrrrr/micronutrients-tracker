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
                     food, every food has all 22 nutrients
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

Phase P6 (removed in P20): the composite dish estimates are gone, and the
                     validator now fails if any composite id survives.

Phase P18b adds:
    data-src/commonness.csv - header, one row per food of foods.json and no
                     other id, integer tiers within 1..5. Every food in
                     foods.json carries that same integer `commonness`, and no
                     review text leaks into docs/: no docs/data/*.json has a
                     `reason`/`reason_zh` key, and no file under docs/ (JSON,
                     JS, HTML) contains any reason_zh string of the CSV.

Phase P19b adds:
    data-src/small_portion_foods.csv - header, unique ids, every flagged id a
                     food of foods.json, basis_g 10. Every food in foods.json
                     has an integer `amountBasisG` of exactly 10 or 100, and
                     the flagged foods have exactly 10.

Phase P20 adds:
    no dish estimates         - data-src/composites.csv is gone and no food id
                     starts with `composite:`.
    raw meat only             - in the meat categories (畜肉类, 禽肉类, 内脏类,
                     加工肉制品) no name_zh contains a cooking word (熟/烤/炖/
                     煮/炒/煎) and no name_en a cooked word (cooked, roasted,
                     braised, broiled, simmered, boiled).
    data-src/bone_in_foods.csv - header, unique ids, every id a food of
                     foods.json, 0 < refuse_pct < 100. Every listed food in
                     foods.json carries that same number as `refusePct` and a
                     non-empty Chinese `refuseNote` generated from it, and no
                     other food carries `refusePct`.
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

# Phase P20: the composite dish estimates are gone, so no food id may use this
# prefix any more.
COMPOSITE_PREFIX = "composite:"

# Phase P20: only raw entries may stay in the meat categories. A name with one
# of these words (Chinese name_zh, English name_en, lower case) is cooked.
COOKED_MEAT_CATEGORIES = {"畜肉类", "禽肉类", "内脏类", "加工肉制品"}
COOKED_NAME_WORDS_ZH = ("熟", "烤", "炖", "煮", "炒", "煎")
COOKED_NAME_WORDS_EN = (
    "cooked",
    "roasted",
    "braised",
    "broiled",
    "simmered",
    "boiled",
)

# Phase P22: eggs are raw only as well. Every 蛋类 food must say 生 in name_zh
# and no cooked word may appear in either name or in the USDA description.
EGG_CATEGORY = "蛋类"
COOKED_EGG_WORDS_ZH = ("熟", "煮", "煎", "炒", "烤", "蒸", "荷包", "炖")
COOKED_EGG_WORDS_EN = (
    "cooked",
    "fried",
    "scrambled",
    "boiled",
    "poached",
    "omelet",
    "omelette",
    "baked",
)

# data-src/bone_in_foods.csv columns (phase P20).
BONE_IN_COLUMNS = ["food_id", "name_zh", "refuse_pct", "refuse_desc", "source"]
# Suffix of a household measure label whose grams include the bone (P20).
WITH_BONE_SUFFIX = "（带骨）"

# data-src/commonness.csv columns (phase P18b).
COMMONNESS_COLUMNS = ["food_id", "name_zh", "commonness", "reason_zh"]
COMMONNESS_MIN = 1
COMMONNESS_MAX = 5
# Files under docs/ that are scanned for leaked review text (P18b).
DOCS_SCAN_SUFFIXES = {".json", ".js", ".mjs", ".html"}

# data-src/small_portion_foods.csv columns (phase P19b).
SMALL_PORTION_COLUMNS = ["food_id", "name_zh", "basis_g", "rule"]
SMALL_PORTION_BASIS_G = 10
DEFAULT_AMOUNT_BASIS_G = 100
AMOUNT_BASIS_VALUES = {SMALL_PORTION_BASIS_G, DEFAULT_AMOUNT_BASIS_G}

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


def load_bone_in_csv():
    """food_id -> refuse percent from data-src/bone_in_foods.csv (P20).

    Returns {} when the file is absent, so the measure checks still work; the
    dedicated check below reports the missing file.
    """
    path = DATA_SRC / "bone_in_foods.csv"
    if not path.is_file():
        return {}
    _, rows = read_csv(path)
    refuse = {}
    for row in rows:
        food_id = (row.get("food_id") or "").strip()
        raw_pct = (row.get("refuse_pct") or "").strip()
        try:
            pct = float(raw_pct)
        except ValueError:
            continue
        if food_id:
            refuse[food_id] = pct
    return refuse


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
    # Phase P20: the household measures of a bone-in food are with-bone
    # weights, so a USDA portion row is compared after converting it back to
    # its edible weight.
    bone_in = load_bone_in_csv()

    curated = {}
    for row in read_csv(DATA_SRC / "foods_curated.csv")[1]:
        raw_id = (row.get("fdc_id") or "").strip()
        if raw_id.isdigit():
            curated[raw_id] = {
                "category_zh": (row.get("category_zh") or "").strip(),
                "name_zh": (row.get("name_zh") or "").strip(),
            }

    measures = defaultdict(list)
    for line_no, row in enumerate(rows, start=2):
        food_key = (row.get("food_key") or "").strip()
        measure_id = (row.get("measure_id") or "").strip()
        label = f"measures.csv line {line_no} ({food_key or 'no food_key'}/{measure_id or 'no id'})"

        if not checks.check(food_key != "", f"{label}: empty food_key"):
            continue
        checks.check(
            food_key in curated,
            f"{label}: food_key is not a curated fdc_id",
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
        # A with-bone row appends `; with bone: <edible> g edible / (1 - X%
        # refuse) = <grams> g with bone` after the usual basis, so only the
        # first `;`-separated part identifies the source.
        source_basis = basis.split(";", 1)[0].strip()
        if source_basis.startswith("usda_portion:"):
            raw_portion_id = source_basis.split(":", 1)[1]
            if not checks.check(
                raw_portion_id.isdigit(),
                f"{label}: usda_portion basis needs a numeric id, got {basis!r}",
            ):
                continue
            portion_id = int(raw_portion_id)
            food_portions = portions.get(int(food_key), {}) if food_key.isdigit() else {}
            if not checks.check(
                portion_id in food_portions,
                f"{label}: {source_basis} is not a food_portion id of fdc_id {food_key}",
            ):
                continue
            portion_grams = food_portions[portion_id]
            # The USDA portion is an edible weight; a bone-in food stores the
            # with-bone equivalent, so convert the portion before comparing.
            refuse_pct = bone_in.get(f"fdc:{food_key}")
            expected_grams = portion_grams
            if refuse_pct is not None and portion_grams is not None:
                expected_grams = round(portion_grams / (1 - refuse_pct / 100.0), 1)
            checks.check(
                expected_grams is not None and abs(expected_grams - grams) < 0.05,
                f"{label}: grams {grams} != food_portion gram_weight "
                f"{portion_grams}"
                + (
                    f" converted with {refuse_pct:g}% refuse -> {expected_grams:g} g"
                    if refuse_pct is not None
                    else ""
                ),
            )
            if refuse_pct is not None:
                checks.check(
                    "with bone" in basis,
                    f"{label}: a bone-in measure must say how it was converted, got {basis!r}",
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

    # Phase P20: the label of a with-bone measure ends in （带骨）, and only a
    # bone-in food may carry such a label.
    for food_key, food_measures in measures.items():
        for measure in food_measures:
            bone = f"fdc:{food_key}" in bone_in
            checks.check(
                measure["label"].endswith(WITH_BONE_SUFFIX) == bone,
                f"measures.csv: {food_key} {measure['id']} label {measure['label']!r} "
                + ("must end in （带骨） (bone-in food)" if bone else "must not be marked 带骨"),
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

    unknown_keys = sorted(set(measures) - set(curated))
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


NO_DISH_NAMES = ("麻婆豆腐", "炒青菜", "番茄炒蛋", "红烧肉", "宫保鸡丁")


def validate_no_composites(checks):
    """No dish estimate may survive (phase P20).

    The phase removed data-src/composites.csv and every `composite:` food, so
    the file must be gone, foods_curated.csv cannot list a composite id, and
    no generated food may use the prefix.
    """
    checks.check(
        not (DATA_SRC / "composites.csv").is_file(),
        "data-src/composites.csv must be deleted (phase P20 drops dish estimates)",
    )
    _, curated = read_csv(DATA_SRC / "foods_curated.csv")
    bad_curated = [
        (row.get("fdc_id") or "").strip()
        for row in curated
        if (row.get("fdc_id") or "").strip().startswith(COMPOSITE_PREFIX)
    ]
    checks.check(
        not bad_curated,
        "foods_curated.csv still holds composite ids: " + ", ".join(bad_curated[:5]),
    )
    for name in DATA_FILENAMES:
        path = DOCS_DATA / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        checks.check(
            COMPOSITE_PREFIX not in text,
            f"docs/data/{name} still mentions a {COMPOSITE_PREFIX} id",
        )
        for dish in NO_DISH_NAMES:
            checks.check(
                dish not in text,
                f"docs/data/{name} still contains the dish name {dish}",
            )


def validate_raw_meat(checks):
    """Only raw entries may stay in the meat categories (phase P20).

    Returns the number of meat-category rows checked. A name_zh with a cooking
    word (熟/烤/炖/煮/炒/煎) or a name_en with a cooked word fails.
    """
    _, rows = read_csv(DATA_SRC / "foods_curated.csv")
    meat_rows = 0
    for line_no, row in enumerate(rows, start=2):
        category = (row.get("category_zh") or "").strip()
        if category not in COOKED_MEAT_CATEGORIES:
            continue
        meat_rows += 1
        name_zh = (row.get("name_zh") or "").strip()
        name_en = (row.get("name_en") or "").strip().lower()
        label = f"foods_curated.csv line {line_no} ({row.get('fdc_id')})"
        zh_hits = [word for word in COOKED_NAME_WORDS_ZH if word in name_zh]
        en_hits = [word for word in COOKED_NAME_WORDS_EN if word in name_en]
        checks.check(
            not zh_hits,
            f"{label}: cooked meat entry (name_zh {name_zh!r} contains "
            f"{'/'.join(zh_hits)}); only raw entries may stay in {category}",
        )
        checks.check(
            not en_hits,
            f"{label}: cooked meat entry (name_en {name_en!r} contains "
            f"{'/'.join(en_hits)}); only raw entries may stay in {category}",
        )
    checks.check(meat_rows > 0, "no meat-category rows found in foods_curated.csv")
    return meat_rows


def validate_raw_eggs(checks, usda_foods):
    """Only raw eggs may stay in 蛋类 (phase P22).

    Every 蛋类 row must carry 生 in name_zh, must not use a cooked word in
    name_zh or name_en, and its SR Legacy description must not describe a
    cooked egg. Returns the number of egg rows checked.
    """
    _, rows = read_csv(DATA_SRC / "foods_curated.csv")
    egg_rows = 0
    for line_no, row in enumerate(rows, start=2):
        category = (row.get("category_zh") or "").strip()
        if category != EGG_CATEGORY:
            continue
        egg_rows += 1
        raw_id = (row.get("fdc_id") or "").strip()
        name_zh = (row.get("name_zh") or "").strip()
        name_en = (row.get("name_en") or "").strip()
        label = f"foods_curated.csv line {line_no} ({raw_id or 'no fdc_id'})"
        checks.check(
            "生" in name_zh,
            f"{label}: 蛋类 name_zh {name_zh!r} must contain 生 (raw egg only)",
        )
        zh_hits = [word for word in COOKED_EGG_WORDS_ZH if word in name_zh]
        checks.check(
            not zh_hits,
            f"{label}: cooked egg name_zh {name_zh!r} contains {'/'.join(zh_hits)}",
        )
        lowered = name_en.lower()
        en_hits = [word for word in COOKED_EGG_WORDS_EN if word in lowered]
        checks.check(
            not en_hits,
            f"{label}: cooked egg name_en {name_en!r} contains {'/'.join(en_hits)}",
        )
        usda_food = usda_foods.get(int(raw_id)) if raw_id.isdigit() else None
        if usda_food is None:
            continue
        description = (usda_food.get("description") or "").strip().lower()
        desc_hits = [word for word in COOKED_EGG_WORDS_EN if word in description]
        checks.check(
            not desc_hits,
            f"{label}: USDA description {description!r} contains "
            f"{'/'.join(desc_hits)} (raw eggs only)",
        )
    checks.check(egg_rows > 0, "no 蛋类 rows found in foods_curated.csv")
    return egg_rows


def validate_bone_in_csv(checks, foods):
    """Checks for data-src/bone_in_foods.csv (phase P20).

    Returns food_id -> refuse percent. Every id must be a food of foods.json,
    refuse_pct must be a number strictly between 0 and 100, and every listed
    food must carry that number as `refusePct` plus a non-empty Chinese
    `refuseNote`. No other food may carry `refusePct`.
    """
    path = DATA_SRC / "bone_in_foods.csv"
    if not checks.check(path.is_file(), "missing data-src/bone_in_foods.csv"):
        return {}

    header, rows = read_csv(path)
    checks.check(
        header == BONE_IN_COLUMNS,
        f"bone_in_foods.csv columns are {header}, expected {BONE_IN_COLUMNS}",
    )
    checks.check(
        len(rows) == 15,
        f"bone_in_foods.csv has {len(rows)} rows, expected the 15 reviewed foods",
    )

    foods_by_id = {str(food.get("id") or ""): food for food in foods}
    refuse = {}
    for line_no, row in enumerate(rows, start=2):
        food_id = (row.get("food_id") or "").strip()
        label = f"bone_in_foods.csv line {line_no} ({food_id or 'no food_id'})"
        if not checks.check(food_id != "", f"{label}: empty food_id"):
            continue
        if not checks.check(food_id not in refuse, f"{label}: duplicate food_id"):
            continue
        checks.check(has_cjk((row.get("name_zh") or "").strip()), f"{label}: name_zh must be Chinese")
        checks.check(
            (row.get("refuse_desc") or "").strip() != "",
            f"{label}: refuse_desc must not be empty",
        )
        checks.check(
            (row.get("source") or "").strip() != "",
            f"{label}: source must not be empty",
        )
        raw_pct = (row.get("refuse_pct") or "").strip()
        if not checks.check(raw_pct != "", f"{label}: empty refuse_pct"):
            continue
        try:
            pct = float(raw_pct)
        except ValueError:
            checks.fail(f"{label}: refuse_pct {raw_pct!r} is not a number")
            continue
        if not checks.check(0 < pct < 100, f"{label}: refuse_pct {pct:g} must be 0 < x < 100"):
            continue
        checks.check(food_id in foods_by_id, f"{label}: food_id is not a food of foods.json")
        refuse[food_id] = pct

    for food in foods:
        food_id = str(food.get("id") or "")
        label = f"foods.json {food_id or 'no id'}"
        if food_id in refuse:
            pct = food.get("refusePct")
            checks.check(
                isinstance(pct, (int, float))
                and not isinstance(pct, bool)
                and abs(pct - refuse[food_id]) < 1e-9,
                f"{label}: refusePct {pct!r} != bone_in_foods.csv {refuse[food_id]:g}",
            )
            note = food.get("refuseNote")
            edible = round(100 - refuse[food_id], 1)
            checks.check(
                isinstance(note, str)
                and has_cjk(note)
                and f"{edible:g}" in note
                and f"{refuse[food_id]:g}" in note,
                f"{label}: refuseNote must be generated Chinese text, got {note!r}",
            )
        else:
            checks.check(
                "refusePct" not in food,
                f"{label}: refusePct is only allowed for the foods of bone_in_foods.csv",
            )
    return refuse


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


def validate_foods_json(checks, foods_data, curated_count, measures=None):
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
    null_values = 0

    for food in foods:
        food_id = str(food.get("id") or "")
        label = f"foods.json {food_id or 'no id'}"
        if food_id in seen_food_ids:
            checks.fail(f"{label}: duplicate food id")
        seen_food_ids.add(food_id)

        checks.check(
            not food_id.startswith(COMPOSITE_PREFIX),
            f"{label}: composite foods are gone (phase P20)",
        )
        checks.check(
            food_id == f"fdc:{food.get('fdcId')}",
            f"{label}: id must be 'fdc:<fdcId>'",
        )
        # The dish-estimate fields are gone with the composites (P20).
        checks.check(
            "estimate" not in food, f"{label}: the estimate flag is gone (phase P20)"
        )
        checks.check(
            "basis" not in food, f"{label}: the composite basis field is gone (phase P20)"
        )
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
    return len(foods)


def validate_measure_merge(checks, label, food, measures):
    """foods.json measures must be exactly the measures.csv rows of that food."""
    food_id = str(food.get("id") or "")
    if not food_id.startswith("fdc:"):
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


def validate_small_portion_csv(checks):
    """Checks for data-src/small_portion_foods.csv (phase P19b).

    Returns the set of flagged food ids. Every id must be a food of
    foods.json, must be unique, and its basis_g must be 10. The `rule` column is
    review material and is never copied into docs/.
    """
    path = DATA_SRC / "small_portion_foods.csv"
    if not checks.check(path.is_file(), "missing data-src/small_portion_foods.csv"):
        return set()

    header, rows = read_csv(path)
    checks.check(
        header == SMALL_PORTION_COLUMNS,
        f"small_portion_foods.csv columns are {header}, expected {SMALL_PORTION_COLUMNS}",
    )

    foods_data = load_json(checks, DOCS_DATA / "foods.json") or {}
    food_ids = {str(food.get("id") or "") for food in foods_data.get("foods") or []}
    flagged = set()
    for line_no, row in enumerate(rows, start=2):
        food_id = (row.get("food_id") or "").strip()
        label = f"small_portion_foods.csv line {line_no} ({food_id or 'no food_id'})"

        if not checks.check(food_id != "", f"{label}: empty food_id"):
            continue
        checks.check(food_id in food_ids, f"{label}: food_id is not in foods.json")
        if food_id in flagged:
            checks.fail(f"{label}: duplicate food_id")
        flagged.add(food_id)

        raw_basis = (row.get("basis_g") or "").strip()
        if checks.check(
            raw_basis.isdigit(), f"{label}: basis_g must be an integer, got {raw_basis!r}"
        ):
            checks.check(
                int(raw_basis) == SMALL_PORTION_BASIS_G,
                f"{label}: basis_g must be {SMALL_PORTION_BASIS_G}, got {raw_basis}",
            )
        checks.check(
            has_cjk((row.get("name_zh") or "").strip()),
            f"{label}: name_zh must be Chinese, got {row.get('name_zh')!r}",
        )
        checks.check(
            (row.get("rule") or "").strip() != "",
            f"{label}: rule must not be empty (review material, never published)",
        )
    return flagged


def validate_amount_basis(checks, foods, flagged):
    """Every food has amountBasisG 10 or 100, flagged foods exactly 10 (P19b)."""
    for food in foods:
        food_id = str(food.get("id") or "")
        label = f"foods.json {food_id or 'no id'}"
        basis = food.get("amountBasisG")
        if not checks.check(
            isinstance(basis, int)
            and not isinstance(basis, bool)
            and basis in AMOUNT_BASIS_VALUES,
            f"{label}: amountBasisG must be 10 or 100, got {basis!r}",
        ):
            continue
        if food_id in flagged:
            checks.check(
                basis == SMALL_PORTION_BASIS_G,
                f"{label}: flagged small-portion food must have amountBasisG "
                f"{SMALL_PORTION_BASIS_G}, got {basis}",
            )
        else:
            checks.check(
                basis == DEFAULT_AMOUNT_BASIS_G,
                f"{label}: unflagged food must have amountBasisG "
                f"{DEFAULT_AMOUNT_BASIS_G}, got {basis}",
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


def validate_generated_json(
    checks, curated_count, measures=None, tiers=None, flagged=None
):
    """Checks for docs/data/*.json written by tools/build_foods.py (phase P4)."""
    foods_path = DOCS_DATA / "foods.json"
    if not checks.check(foods_path.is_file(), "missing docs/data/foods.json"):
        return 0, 0

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
        return 0, 0

    validate_nutrients_json(checks, nutrients_data)
    validate_meta_json(checks, meta_data)
    food_count = validate_foods_json(checks, foods_data, curated_count, measures)
    foods = foods_data.get("foods") or []
    if tiers is not None:
        validate_commonness_json(checks, foods, tiers)
    if flagged is not None:
        validate_amount_basis(checks, foods, flagged)
    bone_in = validate_bone_in_csv(checks, foods)
    return food_count, size, bone_in


def main():
    checks = Checks()
    usda_nutrients = load_usda_nutrients()
    usda_foods = load_usda_foods()
    nutrient_count = validate_nutrients(checks, usda_nutrients)
    food_count = validate_foods(checks, usda_foods, load_excluded_categories())
    measures_count, estimate_share, measures = validate_measures_csv(checks)
    meat_count = validate_raw_meat(checks)
    egg_count = validate_raw_eggs(checks, usda_foods)
    tiers = validate_commonness_csv(checks)
    flagged = validate_small_portion_csv(checks)
    docs_scanned = validate_no_reason_leak(checks)
    validate_no_composites(checks)
    json_food_count, foods_json_size, bone_in = validate_generated_json(
        checks, food_count, measures, tiers, flagged
    )

    if checks.failures:
        print(f"nutrients: {nutrient_count} rows checked")
        print(f"foods: {food_count} rows checked")
        print(f"meat rows (raw only): {meat_count} checked")
        print(f"egg rows (raw only): {egg_count} checked")
        print(f"measures: {measures_count} rows checked, {estimate_share:.1f}% estimates")
        print(f"commonness: {len(tiers)} tiers checked")
        print(f"small portions: {len(flagged)} flagged foods checked")
        print(f"bone-in foods: {len(bone_in)} checked")
        print(f"docs/ text scan: {docs_scanned} files checked")
        print(f"foods.json: {json_food_count} foods checked")
        print(f"{len(checks.failures)} problem(s) found")
        return checks.report()

    print(f"nutrients: {nutrient_count} OK")
    print(f"foods: {food_count} OK")
    print(f"meat rows: {meat_count} OK (raw only, no cooking words)")
    print(f"egg rows: {egg_count} OK (raw only, 生 in name_zh, no cooking words)")
    print(
        f"measures: {measures_count} rows OK for {food_count} foods, "
        f"{estimate_share:.1f}% estimates"
    )
    print("composites: none OK (dish estimates removed in P20)")
    print(f"commonness: {len(tiers)} tiers OK (1..5, no reason text under docs/)")
    print(f"small portions: {len(flagged)} flagged OK (amountBasisG 10, others 100)")
    print(f"bone-in foods: {len(bone_in)} OK (0 < refusePct < 100, note generated)")
    print(f"docs/ text scan: {docs_scanned} files OK")
    print(f"foods.json: {json_food_count} foods OK ({foods_json_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
