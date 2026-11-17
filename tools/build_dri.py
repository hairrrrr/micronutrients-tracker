#!/usr/bin/env python3
"""Build docs/data/dri.json from the curated DRI tables.

Python 3 standard library only. Paths are resolved relative to the repository
root, so the script works from any working directory.

Inputs (see PLAN.md 1.4):
    data-src/dri/cn2023.csv   Chinese DRIs 2023, one row per group x nutrient
    data-src/dri/us.csv       US DRIs (NASEM via NIH ODS), same layout
    data-src/nutrients.csv    the 22 nutrient ids, used to check coverage

Columns of both DRI tables:
    standard,group_id,sex,age_min,age_max,life_stage,nutrient_id,target,
    target_type,ul,ul_applies_to_food,source_ref,verified_by

`target`, `target_type`, `ul` and `ul_applies_to_food` may only be filled from
an official source by a human (PLAN.md 0 rule 1). `verified_by` records who
checked the row against that source. Until every row carries a `verified_by`
the build refuses to write, because an unverified DRI value must never reach
the site:

    python3 tools/build_dri.py                  # exit 1 while rows are unverified
    python3 tools/build_dri.py --allow-unverified
                                                # validates the skeleton, writes
                                                # NOTHING to docs/, exits 0

Output (PLAN.md 1.3):

    {
      "buildDate": "2026-11-18",
      "standards": {
        "cn2023": {"label": "...", "source": "...", "note": "...",
                   "groups": [{"id": "cn-m-30-49", "sex": "male",
                               "ageMin": 30, "ageMax": 49, "lifeStage": "none",
                               "values": {"iron": {"target": 12, "type": "RNI",
                                                   "ul": 42, "ulAppliesToFood": true,
                                                   "ulNote": null, "ref": "..."}}}]},
        "us": {"...": "..."}
      }
    }

An open-ended group (75+ for China, 71+ for the US) is written with
`"ageMax": null`; its group id ends with a dash, e.g. `cn-f-75-`.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_SRC = REPO_ROOT / "data-src"
DRI_SRC = DATA_SRC / "dri"
DOCS_DATA = REPO_ROOT / "docs" / "data"
NUTRIENTS_CSV = DATA_SRC / "nutrients.csv"
DRI_JSON = DOCS_DATA / "dri.json"

DRI_COLUMNS = [
    "standard",
    "group_id",
    "sex",
    "age_min",
    "age_max",
    "life_stage",
    "nutrient_id",
    "target",
    "target_type",
    "ul",
    "ul_applies_to_food",
    "source_ref",
    "verified_by",
]

NUTRIENT_COLUMNS = ["id", "name_zh", "name_en", "unit", "usda_nutrient_id", "color", "kind", "note"]

# standard key -> (file name, Chinese label, source line, note)
STANDARDS = {
    "cn2023": {
        "file": "cn2023.csv",
        "prefix": "cn",
        "label": "中国居民膳食营养素参考摄入量（2023版）",
        "source": "中国营养学会（CNS）《中国居民膳食营养素参考摄入量（2023版）》，cnsoc.org/drpostand",
        "note": "本版仅覆盖成人（18 岁及以上）；孕期与哺乳期列为后续版本。",
        "types": {"RNI", "AI"},
    },
    "us": {
        "file": "us.csv",
        "prefix": "us",
        "label": "美国膳食参考摄入量（NASEM DRI）",
        "source": "美国国家科学院（NASEM）膳食参考摄入量，经美国国立卫生研究院膳食补充剂办公室（NIH ODS）汇总",
        "note": "本版仅覆盖成人；18 岁按 14-18 岁组计算，孕期与哺乳期列为后续版本。",
        "types": {"RDA", "AI"},
    },
}

STANDARD_ORDER = ["cn2023", "us"]
SEX_ORDER = ["male", "female"]
SEX_SLUG = {"male": "m", "female": "f"}

# Shown as `ulNote` when a UL exists but covers only supplements or synthetic
# forms, so the UI must not warn about food intake (PLAN.md 1.4).
UL_FOOD_NOTE = "上限仅适用于补充剂或合成形式，不用于食物摄入"

GROUP_ID_RE = re.compile(r"^(?P<prefix>[a-z0-9]+)-(?P<sex>[mf])-(?P<min>\d+)-(?P<max>\d*)$")


def fail(message):
    print(f"FAIL {message}", file=sys.stderr)
    return 1


def read_nutrient_ids():
    if not NUTRIENTS_CSV.is_file():
        raise SystemExit(f"missing {NUTRIENTS_CSV.relative_to(REPO_ROOT)}")
    with NUTRIENTS_CSV.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        if header != NUTRIENT_COLUMNS:
            raise SystemExit(
                f"data-src/nutrients.csv: columns are {header}, expected {NUTRIENT_COLUMNS}"
            )
        ids = [(row.get("id") or "").strip() for row in reader]
    if not ids:
        raise SystemExit("data-src/nutrients.csv: no nutrient rows")
    return ids


def read_rows(path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = list(reader.fieldnames or [])
        if header != DRI_COLUMNS:
            raise SystemExit(
                f"{path.relative_to(REPO_ROOT)}: columns are {header}, expected {DRI_COLUMNS}"
            )
        return [
            {key: (value or "").strip() for key, value in row.items()}
            for row in reader
        ]


def parse_number(text, *, label, integer=False):
    """Return an int/float, or None with an error message for bad input."""
    if text == "":
        return None, None
    try:
        if integer:
            if not re.fullmatch(r"\d+", text):
                raise ValueError
            return int(text), None
        value = float(text)
    except ValueError:
        kind = "an integer" if integer else "a number"
        return None, f"{label}: {kind} expected, got {text!r}"
    if not (value >= 0):
        return None, f"{label}: must not be negative, got {text!r}"
    return value, None


def number_for_json(value):
    """Write whole floats as ints so the JSON matches the plan's example."""
    if value is None:
        return None
    if float(value).is_integer():
        return int(value)
    return value


def build_standard(standard, spec, rows, nutrient_ids):
    """Validate the rows of one standard and return the JSON payload."""
    errors = []
    groups = {}
    group_order = []
    seen = {}

    for index, row in enumerate(rows, start=2):
        where = f"{spec['file']} line {index}"
        if row["standard"] != standard:
            errors.append(f"{where}: standard is {row['standard']!r}, expected {standard!r}")
            continue

        group_id = row["group_id"]
        sex = row["sex"]
        if sex not in SEX_SLUG:
            errors.append(f"{where}: sex must be male or female, got {sex!r}")
            continue

        age_min, error = parse_number(row["age_min"], label=f"{where} age_min", integer=True)
        if error:
            errors.append(error)
            continue
        if age_min is None:
            errors.append(f"{where}: age_min is required")
            continue
        age_max, error = parse_number(row["age_max"], label=f"{where} age_max", integer=True)
        if error:
            errors.append(error)
            continue
        if age_max is not None and age_max < age_min:
            errors.append(f"{where}: age_max {age_max} is below age_min {age_min}")
            continue

        life_stage = row["life_stage"] or "none"
        if life_stage != "none":
            errors.append(
                f"{where}: life_stage {life_stage!r} is not supported by v1 (only 'none')"
            )
            continue

        expected_id = "-".join(
            [spec["prefix"], SEX_SLUG[sex], str(age_min), "" if age_max is None else str(age_max)]
        )
        if group_id != expected_id:
            errors.append(f"{where}: group_id {group_id!r} should be {expected_id!r}")
            continue
        match = GROUP_ID_RE.match(group_id)
        if not match:
            errors.append(f"{where}: group_id {group_id!r} is not in prefix-sex-min-max form")
            continue
        if match.group("sex") != SEX_SLUG[sex]:
            errors.append(f"{where}: group_id {group_id!r} disagrees with sex {sex!r}")
            continue

        nutrient_id = row["nutrient_id"]
        if nutrient_id not in nutrient_ids:
            errors.append(f"{where}: unknown nutrient_id {nutrient_id!r}")
            continue

        key = (group_id, nutrient_id)
        if key in seen:
            errors.append(f"{where}: duplicate row for {group_id} / {nutrient_id}")
            continue
        seen[key] = index

        if row["target"]:
            target, error = parse_number(row["target"], label=f"{where} target")
            if error:
                errors.append(error)
                continue
        else:
            target = None
        target_type = row["target_type"]
        if target_type and target_type not in spec["types"]:
            errors.append(
                f"{where}: target_type must be one of {sorted(spec['types'])}, got {target_type!r}"
            )
            continue
        if target is not None and not target_type:
            errors.append(f"{where}: target_type is required when target is set")
            continue
        if target is None and target_type:
            errors.append(f"{where}: target_type is set but target is empty")
            continue

        if row["ul"]:
            ul, error = parse_number(row["ul"], label=f"{where} ul")
            if error:
                errors.append(error)
                continue
        else:
            ul = None
        ul_applies = row["ul_applies_to_food"]
        if ul_applies not in ("", "yes", "no"):
            errors.append(f"{where}: ul_applies_to_food must be yes, no or empty, got {ul_applies!r}")
            continue
        if ul is None and ul_applies:
            errors.append(f"{where}: ul_applies_to_food is set but ul is empty")
            continue
        if ul is not None and not ul_applies:
            errors.append(f"{where}: ul_applies_to_food is required when ul is set")
            continue

        if not row["source_ref"]:
            errors.append(f"{where}: source_ref is required")
            continue

        if group_id not in groups:
            groups[group_id] = {
                "id": group_id,
                "sex": sex,
                "ageMin": age_min,
                "ageMax": age_max,
                "lifeStage": life_stage,
                "values": {},
            }
            group_order.append(group_id)
        else:
            existing = groups[group_id]
            if (existing["sex"], existing["ageMin"], existing["ageMax"], existing["lifeStage"]) != (
                sex,
                age_min,
                age_max,
                life_stage,
            ):
                errors.append(f"{where}: group {group_id} has inconsistent sex/ages/life_stage")
                continue

        values = groups[group_id]["values"]
        values[nutrient_id] = {
            "target": number_for_json(target),
            "type": target_type or None,
            "ul": number_for_json(ul),
            "ulAppliesToFood": (ul_applies == "yes") if ul is not None else None,
            "ulNote": UL_FOOD_NOTE if (ul is not None and ul_applies == "no") else None,
            "ref": row["source_ref"],
        }

    for group_id in group_order:
        values = groups[group_id]["values"]
        missing = [nutrient_id for nutrient_id in nutrient_ids if nutrient_id not in values]
        extra = [nutrient_id for nutrient_id in values if nutrient_id not in nutrient_ids]
        if missing:
            errors.append(f"{spec['file']} {group_id}: missing nutrients {missing}")
        if extra:
            errors.append(f"{spec['file']} {group_id}: unexpected nutrients {extra}")

    if not group_order and not errors:
        errors.append(f"{spec['file']}: no data rows")

    def sort_key(group_id):
        group = groups[group_id]
        sex_rank = SEX_ORDER.index(group["sex"]) if group["sex"] in SEX_ORDER else len(SEX_ORDER)
        return (sex_rank, group["ageMin"], group["ageMax"] if group["ageMax"] is not None else 10**6)

    ordered_groups = [groups[group_id] for group_id in sorted(group_order, key=sort_key)]

    payload = {
        "label": spec["label"],
        "source": spec["source"],
        "note": spec["note"],
        "groups": ordered_groups,
    }
    return payload, errors


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Build docs/data/dri.json from data-src/dri/*.csv"
    )
    parser.add_argument(
        "--allow-unverified",
        action="store_true",
        help="validate the skeleton without writing docs/data/dri.json",
    )
    args = parser.parse_args(argv)

    nutrient_ids = read_nutrient_ids()

    payloads = {}
    lineage = []
    all_errors = []
    total_rows = 0
    unverified = []
    filled_targets = 0

    for standard in STANDARD_ORDER:
        spec = STANDARDS[standard]
        path = DRI_SRC / spec["file"]
        if not path.is_file():
            all_errors.append(f"missing data-src/dri/{spec['file']}")
            continue
        rows = read_rows(path)
        total_rows += len(rows)
        payload, errors = build_standard(standard, spec, rows, nutrient_ids)
        all_errors.extend(errors)

        for row in rows:
            if not row["verified_by"]:
                unverified.append(f"{standard}:{row['group_id']}:{row['nutrient_id']}")
        for group in payload["groups"]:
            for value in group["values"].values():
                if value["target"] is not None:
                    filled_targets += 1

        payloads[standard] = payload
        lineage.append(
            f"{standard}: {len(payload['groups'])} groups, {len(rows)} rows "
            f"({len(payload['groups'])} x {len(nutrient_ids)} nutrients)"
        )

    if all_errors:
        for error in all_errors[:40]:
            print(f"FAIL {error}", file=sys.stderr)
        if len(all_errors) > 40:
            print(f"FAIL ... and {len(all_errors) - 40} more errors", file=sys.stderr)
        print(f"FAIL {len(all_errors)} problem(s), nothing written", file=sys.stderr)
        return 1

    for line in lineage:
        print(line)
    print(f"rows: {total_rows} ({len(STANDARD_ORDER)} standards), target values filled: {filled_targets}")

    if unverified:
        if not args.allow_unverified:
            print(
                f"FAIL {len(unverified)} row(s) have an empty verified_by; "
                "refusing to write docs/data/dri.json",
                file=sys.stderr,
            )
            for entry in unverified[:10]:
                print(f"FAIL unverified {entry}", file=sys.stderr)
            if len(unverified) > 10:
                print(f"FAIL ... and {len(unverified) - 10} more unverified rows", file=sys.stderr)
            print(
                "hint: DRI values are entered and verified by the supervisor "
                "(PLAN.md P7b); use --allow-unverified to check the skeleton only.",
                file=sys.stderr,
            )
            return 1
        print(
            f"not written: {len(unverified)} of {total_rows} row(s) are unverified "
            "(--allow-unverified), docs/data/dri.json left untouched"
        )
        return 0

    document = {
        "buildDate": date.today().isoformat(),
        "generator": "tools/build_dri.py",
        "standards": {standard: payloads[standard] for standard in STANDARD_ORDER},
    }

    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    DRI_JSON.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote docs/data/dri.json: {DRI_JSON.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
