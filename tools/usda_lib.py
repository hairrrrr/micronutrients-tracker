"""Loading helpers for the USDA FoodData Central SR Legacy CSV tables.

Python 3 standard library only. All paths are resolved relative to the
repository root, so the scripts work from any working directory.
"""

from __future__ import annotations

import csv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data-raw"
DATASET_DIR_NAME = "FoodData_Central_sr_legacy_food_csv_2018-04"
DATASET_DIR = RAW_DIR / DATASET_DIR_NAME

EXPECTED_SHA256 = "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0"


def dataset_dir() -> Path:
    """Return the extracted CSV directory, or exit with a helpful message."""
    if not (DATASET_DIR / "food.csv").is_file():
        raise SystemExit(
            f"USDA data not found in {DATASET_DIR}.\n"
            "Run: bash tools/fetch_usda.sh"
        )
    return DATASET_DIR


def table_path(name: str) -> Path:
    """Path of one CSV table inside the extracted dataset."""
    return dataset_dir() / name


def _rows(name: str):
    with table_path(name).open(newline="", encoding="utf-8-sig") as handle:
        yield from csv.DictReader(handle)


def _to_int(value):
    value = (value or "").strip()
    return int(value) if value else None


def _to_float(value):
    value = (value or "").strip()
    return float(value) if value else None


def load_food():
    """fdc_id -> {fdc_id, data_type, description, food_category_id, publication_date}."""
    foods = {}
    for row in _rows("food.csv"):
        fdc_id = _to_int(row.get("fdc_id"))
        if fdc_id is None:
            continue
        foods[fdc_id] = {
            "fdc_id": fdc_id,
            "data_type": (row.get("data_type") or "").strip(),
            "description": (row.get("description") or "").strip(),
            "food_category_id": _to_int(row.get("food_category_id")),
            "publication_date": (row.get("publication_date") or "").strip(),
        }
    return foods


def load_nutrients():
    """nutrient id -> {id, name, unit_name, nutrient_nbr, rank}."""
    nutrients = {}
    for row in _rows("nutrient.csv"):
        nutrient_id = _to_int(row.get("id"))
        if nutrient_id is None:
            continue
        nutrients[nutrient_id] = {
            "id": nutrient_id,
            "name": (row.get("name") or "").strip(),
            "unit_name": (row.get("unit_name") or "").strip(),
            "nutrient_nbr": (row.get("nutrient_nbr") or "").strip(),
            "rank": _to_float(row.get("rank")),
        }
    return nutrients


def load_food_category():
    """food_category id -> {id, code, description}."""
    categories = {}
    for row in _rows("food_category.csv"):
        category_id = _to_int(row.get("id"))
        if category_id is None:
            continue
        categories[category_id] = {
            "id": category_id,
            "code": (row.get("code") or "").strip(),
            "description": (row.get("description") or "").strip(),
        }
    return categories


def load_food_nutrient():
    """fdc_id -> {nutrient_id: amount} (last row wins, amounts as floats)."""
    values = {}
    for row in _rows("food_nutrient.csv"):
        fdc_id = _to_int(row.get("fdc_id"))
        nutrient_id = _to_int(row.get("nutrient_id"))
        amount = _to_float(row.get("amount"))
        if fdc_id is None or nutrient_id is None or amount is None:
            continue
        values.setdefault(fdc_id, {})[nutrient_id] = amount
    return values


def load_food_nutrient_rows():
    """List of full food_nutrient rows with numeric fields converted."""
    rows = []
    for row in _rows("food_nutrient.csv"):
        fdc_id = _to_int(row.get("fdc_id"))
        nutrient_id = _to_int(row.get("nutrient_id"))
        amount = _to_float(row.get("amount"))
        if fdc_id is None or nutrient_id is None:
            continue
        rows.append(
            {
                "id": _to_int(row.get("id")),
                "fdc_id": fdc_id,
                "nutrient_id": nutrient_id,
                "amount": amount,
                "data_points": _to_int(row.get("data_points")),
                "derivation_id": _to_int(row.get("derivation_id")),
                "min": _to_float(row.get("min")),
                "max": _to_float(row.get("max")),
                "median": _to_float(row.get("median")),
                "footnote": (row.get("footnote") or "").strip(),
            }
        )
    return rows


def load_food_portion():
    """fdc_id -> list of portion rows (id, amount, gram_weight, description...)."""
    portions = {}
    for row in _rows("food_portion.csv"):
        fdc_id = _to_int(row.get("fdc_id"))
        if fdc_id is None:
            continue
        portions.setdefault(fdc_id, []).append(
            {
                "id": _to_int(row.get("id")),
                "fdc_id": fdc_id,
                "seq_num": _to_int(row.get("seq_num")),
                "amount": _to_float(row.get("amount")),
                "measure_unit_id": _to_int(row.get("measure_unit_id")),
                "portion_description": (row.get("portion_description") or "").strip(),
                "modifier": (row.get("modifier") or "").strip(),
                "gram_weight": _to_float(row.get("gram_weight")),
            }
        )
    for rows in portions.values():
        rows.sort(key=lambda item: (item["seq_num"] or 0, item["id"] or 0))
    return portions


def load_measure_unit():
    """measure_unit id -> {id, name}."""
    units = {}
    for row in _rows("measure_unit.csv"):
        unit_id = _to_int(row.get("id"))
        if unit_id is None:
            continue
        units[unit_id] = {"id": unit_id, "name": (row.get("name") or "").strip()}
    return units


def load_all():
    """Convenience bundle of every table used by the pipeline."""
    return {
        "foods": load_food(),
        "nutrients": load_nutrients(),
        "categories": load_food_category(),
        "food_nutrients": load_food_nutrient(),
        "portions": load_food_portion(),
    }
