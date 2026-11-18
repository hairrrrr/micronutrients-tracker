#!/usr/bin/env python3
"""Suggest household measures for every curated food (phase P5).

Python 3 standard library only. Paths are resolved relative to the repository
root so the script works from any working directory.

Two steps, as in PLAN.md phase P5:

  1. USDA portions: for every food in data-src/foods_curated.csv take the
     rows of food_portion.csv, drop the ones that are not household measures
     (oz, lb, quart, "yield from ...", NLEA servings, ...) and translate the
     remaining modifier into a Chinese label. The basis of such a measure is
     "usda_portion:<food_portion.id>", so every gram value stays traceable.

  2. Builder judgement: add the common Chinese household measures that the
     USDA table does not have (a handful for nuts, a fist and a bowl for
     cooked rice, a bowl for noodles, a palm-sized piece for meat and fish,
     a cup for milk, a slice for bread, a spoon for oils and pastes). These
     rows are labeled estimates with basis "estimate:<short English reason>".

Bone-in foods (phase P20): the SR Legacy nutrient values of the foods of
data-src/bone_in_foods.csv are per 100 g of EDIBLE portion, while people
weigh and buy these cuts with the bone. Their household measures are
therefore stored as with-bone weights: a USDA portion that describes edible
meat is converted with grams_with_bone = edible_grams / (1 - refuse/100),
and the basis text says so. An estimate row that is already a with-bone
description keeps its grams.

Every food gets exactly one default measure; the choice follows the food
category (an egg defaults to "one egg", milk to "one cup", oils to "one
spoon", cooked rice to "one bowl", ...).

Output: data-src/measures.csv with the columns of PLAN.md 1.3
    food_key,measure_id,label_zh,grams,basis,is_default

Usage:
    python3 tools/suggest_measures.py            # writes the CSV
    python3 tools/suggest_measures.py --dry-run   # prints a summary only
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from usda_lib import (
    REPO_ROOT,
    dataset_dir,
    load_food_portion,
)

DATA_SRC = REPO_ROOT / "data-src"
MEASURES_CSV = DATA_SRC / "measures.csv"
CURATED_CSV = DATA_SRC / "foods_curated.csv"
BONE_IN_CSV = DATA_SRC / "bone_in_foods.csv"

MEASURE_COLUMNS = ["food_key", "measure_id", "label_zh", "grams", "basis", "is_default"]

MIN_GRAMS = 1.0
MAX_GRAMS = 1000.0
MAX_MEASURES = 4
# At most this many USDA portions may share one classifier ("一个" plus one
# size variant is enough; three sizes of tomato crowd out the slice).
MAX_PER_CLASSIFIER = 2

# --- step 1: USDA portion modifiers -> Chinese household labels ------------
#
# COUNT_RULES map a counted noun in the portion text to its Chinese
# classifier, e.g. "1 large" -> 一个, "1 slice" -> 一片, "1 stalk" -> 一根.
# Rules are tried in order, so the first (most specific) match wins.
# "kind" is used later to cap the number of measures and to pick a default.

COUNT_RULES = [
    ("spear tip", "小段", "piece"),
    ("head", "颗", "piece"),
    ("bunch", "捆", "piece"),
    ("piece whole", "朵", "piece"),
    ("slice", "片", "piece"),
    ("fillet", "片（鱼柳）", "piece"),
    ("filet", "片（鱼柳）", "piece"),
    ("leaf", "片（叶）", "piece"),
    ("clove", "瓣", "piece"),
    ("block", "块", "piece"),
    ("pat ", "小块", "piece"),
    ("container", "盒", "piece"),
    ("can ", "罐", "piece"),
    ("packet", "包", "piece"),
    ("package", "包", "piece"),    ("egg", "个", "piece"),
    ("fruit", "个", "piece"),
    ("spear", "根", "piece"),
    ("stalk", "根", "piece"),
    ("sprig", "小枝", "piece"),
    ("pod", "根", "piece"),
    ("ear", "根", "piece"),
    ("shoot", "根", "piece"),
    ("nut", "颗", "piece"),
    ("kernel", "颗", "piece"),
    ("berry", "颗", "piece"),
    ("grape", "颗", "piece"),
    ("cherry", "颗", "piece"),
    ("olive", "颗", "piece"),
    ("tomato", "个", "piece"),
    ("potato", "个", "piece"),
    ("pepper", "个", "piece"),
    ("banana", "根", "piece"),
    ("plantain", "根", "piece"),
    ("cucumber", "根", "piece"),
    ("carrot", "根", "piece"),
    ("artichoke", "个", "piece"),
    ("floweret", "朵", "piece"),
    ("mushroom", "朵", "piece"),
    ("shrimp", "只", "piece"),
    ("crab", "只", "piece"),
    ("lobster", "只", "piece"),
    # Before "oyster": "cracker, oyster" is a cracker, not an oyster.
    ("cracker", "块", "piece"),
    ("oyster", "只", "piece"),
    ("wedge", "角", "piece"),
    ("ring", "圈", "piece"),
    ("sheet", "张", "piece"),
    ("bagel", "个", "piece"),
    ("roll", "个", "piece"),
    ("muffin", "个", "piece"),
    ("biscuit", "个", "piece"),
    ("tortilla", "张", "piece"),
    ("steak", "块", "piece"),
    ("chop", "块", "piece"),
    ("breast", "块", "piece"),
    ("thigh", "块", "piece"),
    ("drumstick", "只", "piece"),
    ("wing", "只", "piece"),
    ("leg", "只", "piece"),
    ("liver", "块", "piece"),
    ("heart", "个", "piece"),
    ("kidney", "个", "piece"),
    ("bird", "只", "piece"),
    ("quail", "只", "piece"),
    ("duck", "只", "piece"),
    ("goose", "只", "piece"),
    ("chicken", "只", "piece"),
    ("pheasant", "只", "piece"),
    ("chunk", "块", "piece"),
    ("waterchestnuts", "个", "piece"),
    ("broadbean", "个", "piece"),
    ("gourd", "个", "piece"),
    ("waxgourd", "个", "piece"),
    ("balsam-pear", "个", "piece"),
    ("chayote", "个", "piece"),
    ("melon", "个", "piece"),
    ("sprouts", "根", "piece"),
    ("pomegranate", "个", "piece"),
    ("apple", "个", "piece"),
    ("pear", "个", "piece"),
    ("peach", "个", "piece"),
    ("nectarine", "个", "piece"),
    ("plum", "个", "piece"),
    ("apricot", "个", "piece"),
    ("orange", "个", "piece"),
    ("grapefruit", "个", "piece"),
    ("kumquat", "个", "piece"),
    ("tangerine", "个", "piece"),
    ("lime", "个", "piece"),
    ("lemon", "个", "piece"),
    ("kiwi", "个", "piece"),
    ("mango", "个", "piece"),
    ("papaya", "个", "piece"),
    ("avocado", "个", "piece"),
    ("guava", "个", "piece"),
    ("fig", "个", "piece"),
    ("persimmon", "个", "piece"),
    ("loquat", "个", "piece"),
    ("jujube", "个", "piece"),
    ("lychee", "个", "piece"),
    ("longan", "个", "piece"),
    ("cherimoya", "个", "piece"),
    ("sapodilla", "个", "piece"),
    ("soursop", "个", "piece"),
    ("durian", "个", "piece"),
    ("jackfruit", "个", "piece"),
    ("rambutan", "个", "piece"),
    ("mangosteen", "个", "piece"),
    ("carambola", "个", "piece"),
    ("starfruit", "个", "piece"),
    ("quince", "个", "piece"),
    ("prickly pear", "个", "piece"),
    ("tamarind", "个", "piece"),
    ("dates", "个", "piece"),
    ("each", "个", "piece"),
    ("serving", "份", "piece"),
    # Size words without a noun: "1 large", "2 medium" of an unnamed food.
    ("extra large", "个（特大）", "piece"),
    ("jumbo", "个（特大）", "piece"),
    ("medium", "个（中）", "piece"),
    ("small", "个（小）", "piece"),
    ("large", "个", "piece"),
    ("piece", "块", "piece"),
]

# Size words that qualify an already-found classifier: "ear, medium" is the
# middle-sized one of that food, not a separate measure. Restricting this to
# count-like classifiers keeps "slice, large" a plain slice.
SIZE_SUFFIXES = [(("extra large", "jumbo"), "（特大）"), (("medium",), "（中）"), (("small",), "（小）")]
SIZE_SUFFIX_CLASSIFIERS = {"个", "根", "颗", "只", "条"}

SPOON_RULES = [    ("tablespoon", "勺", "spoon"),
    ("tbsp", "勺", "spoon"),
    ("teaspoon", "小勺", "spoon"),
    ("tsp", "小勺", "spoon"),
    ("cup", "杯", "cup"),
    ("dash", "少许", "dash"),
]

# Text that means "not a household measure": weights, containers of unknown
# size, and portions that describe a whole animal or a yield calculation.
# "fruit without refuse" is an edible-yield statement, so "refuse" alone is
# only skipped when it is not part of "without refuse".
SKIP_PATTERNS = [
    "oz",
    "ounce",
    "lb",
    "pound",
    "quart",
    "gallon",
    "liter",
    "milliliter",
    "cubic",
    "pint",
    "yield",
    "unit",
    "nlea",
    "undetermined",
    "fl oz",
    "fluid",
    "serving 1",
]

AMOUNT_ZH = {
    0.2: "五分之一",
    0.25: "四分之一",
    0.5: "半",
    0.75: "四分之三",
    1.0: "一",
    2.0: "两",
    3.0: "三",
    4.0: "四",
    5.0: "五",
    6.0: "六",
    8.0: "八",
    10.0: "十",
    12.0: "十二",
    15.0: "十五",
    20.0: "二十",
}


def has_skip_pattern(text):
    return any(pattern in text for pattern in SKIP_PATTERNS)


# Markers that cancel a portion even inside a parenthetical.
HARD_SKIP_PATTERNS = ["yield", "refuse (", "unit", "nlea"]


def has_hard_skip(text):
    return any(pattern in text for pattern in HARD_SKIP_PATTERNS)


def amount_prefix(amount):
    # A handful of SR Legacy rows leave the amount at 0; one piece is meant.
    if not amount:
        return "一"
    key = round(float(amount), 2)
    if key in AMOUNT_ZH:
        return AMOUNT_ZH[key]
    return f"{key:g}"


def portion_label(row):
    """Chinese label + kind for one food_portion row, or (None, None).

    The third value is True when the label came from a bare size word
    ("large", "medium") instead of a counted noun, so that the caller may
    replace the generic classifier 个 with the one the food really uses.
    """
    text = " ".join(
        part for part in (row["modifier"], row["portion_description"]) if part
    ).strip().lower()
    if not text:
        return None, None, False
    # A parenthetical is a size hint or a yield note, never the measure itself:
    # "cup (8 fl oz)" is a cup, "package (5 oz)" is a package, ...
    primary = re.sub(r"\([^)]*\)", " ", text).strip()
    # ... but "piece (yield from 1 lb raw)" is a yield calculation, not a
    # household measure, so the whole text decides for these markers.
    if has_hard_skip(text):
        return None, None, False
    # "fruit without refuse" is an edible-yield statement, not a yield calc.
    primary = re.sub(r"\b(without|with) refuse\b", " ", primary).strip()
    if not primary or has_skip_pattern(primary):
        return None, None, False
    for needle, classifier, kind in SPOON_RULES:
        if needle in primary:
            if kind == "dash":
                return "少许", kind, False
            return amount_prefix(row["amount"]) + classifier, kind, False
    for needle, classifier, kind in COUNT_RULES:
        if needle in primary:
            # "5 packages (5 oz)" is a pack size, not a household count.
            if classifier in ("包", "罐", "盒") and (row["amount"] or 0) > 1:
                return None, None, False
            suffix = ""
            if classifier in SIZE_SUFFIX_CLASSIFIERS:
                for needles, size_suffix in SIZE_SUFFIXES:
                    if any(extra in primary for extra in needles):
                        suffix = size_suffix
                        break
            generic = needle in SIZE_ONLY_WORDS
            return amount_prefix(row["amount"]) + classifier + suffix, kind, generic
    return None, None, False


# "1 large" of a mushroom is one mushroom, of a scallion one stalk: the
# classifier in the label has to follow the food, not the size word.
SIZE_ONLY_WORDS = {"extra large", "jumbo", "medium", "small", "large"}


def food_classifier(food):
    """The classifier a bare size word should become for this food, or None."""
    name = food["name_zh"]
    category = food["category_zh"]
    if category == "菌菇类":
        return "根" if "金针菇" in name else "朵"
    if category in ("鱼类", "虾蟹类") and any(word in name for word in ("沙丁鱼", "凤尾鱼")):
        return "条"
    if category == "葱蒜与香辛菜" and "洋葱" not in name and "大蒜" not in name:
        return "根" if any(word in name for word in ("葱", "韭", "蒜苗")) else None
    return None


def replace_generic_classifier(label, classifier):
    """一个（中） -> 一朵（中）: swap the leading 个 for the food's classifier."""
    match = re.match(r"^(.+?)个(（[^）]*）)?$", label)
    if not match:
        return label
    return match.group(1) + classifier + (match.group(2) or "")


def load_curated():
    with CURATED_CSV.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        expected = ["fdc_id", "name_zh", "name_en", "category_zh", "aliases_zh"]
        if list(reader.fieldnames or []) != expected:
            raise SystemExit(f"{CURATED_CSV.name}: unexpected columns {reader.fieldnames}")
        return [
            {
                "fdc_id": int(row["fdc_id"]),
                "name_zh": row["name_zh"].strip(),
                "name_en": row["name_en"].strip(),
                "category_zh": row["category_zh"].strip(),
            }
            for row in reader
        ]


def add_measure(measures, seen_labels, measure_id, label, grams, basis, kind):
    """Append one measure unless the label already exists or grams are off."""
    if grams is None:
        return
    grams = round(float(grams), 1)
    if not (MIN_GRAMS <= grams <= MAX_GRAMS):
        return
    if label in seen_labels:
        return
    if any(item["id"] == measure_id for item in measures):
        return
    measures.append(
        {"id": measure_id, "label": label, "grams": grams, "basis": basis, "kind": kind}
    )
    seen_labels.add(label)


def drop_measure(measures, seen_labels, measure):
    """Remove one measure and free its label again."""
    measures.remove(measure)
    seen_labels.discard(measure["label"])


# --- step 2: Chinese household measures that USDA does not provide ---------

NUT_CATEGORIES = {"坚果类", "种子类"}
MEAT_CATEGORIES = {"畜肉类", "禽肉类", "鱼类", "虾蟹类", "贝类", "内脏类", "加工肉制品"}
DRIED_NUT_CATEGORIES = {"坚果类", "种子类"}

# Foods whose USDA portion table is empty or unsuitable, one entry per food.
# Only these use a hand-set gram value outside the category rules below.
FOOD_OVERRIDES = {
    169404: [("bunch", "一捆", 250, "one bunch of Chinese broccoli, about 250 g")],
    168151: [("piece", "一颗", 20, "one fresh jujube, about 20 g")],
    168152: [("piece", "一颗", 8, "one dried red date, about 8 g")],
    171314: [("spoon", "一勺", 13, "one tablespoon of ghee, about 13 g")],
    171304: [("cup", "一杯", 240, "one cup of Greek yogurt, about 240 g")],
    170894: [("cup", "一杯", 245, "one cup of Greek yogurt, about 245 g")],
    170090: [("spoon_small", "一小勺", 3, "one teaspoon of dried agar, about 3 g")],
    174276: [("serving", "一份", 30, "one scoop of soy protein powder, about 30 g")],
    174258: [("bowl", "一碗", 50, "one bowl of dried glass noodles, about 50 g")],
    170845: [("slice", "一片", 28, "one slice of mozzarella, about 28 g")],
    173032: [("spoon", "一勺", 6, "one tablespoon of dried goji berries, about 6 g")],
    168820: [("spoon", "一勺", 21, "one tablespoon of molasses, about 21 g")],
    170164: [("piece", "一颗", 10, "one chestnut kernel, about 10 g")],
    170166: [("piece", "一颗", 10, "one cooked chestnut kernel, about 10 g")],
    170584: [("piece", "一颗", 3, "one ginkgo nut, about 3 g")],
    170175: [("piece", "一颗", 3, "one dried ginkgo nut, about 3 g")],
    168591: [("spoon", "一勺", 10, "one tablespoon of dried lotus seeds, about 10 g")],
    169250: [("cup", "半杯", 60, "half a cup of sliced lotus root, about 60 g")],
    169087: [("spoon", "一勺", 10, "one tablespoon of dried litchis, about 10 g")],
    169907: [("spoon", "一勺", 8, "one tablespoon of dried longans, about 8 g")],
    173410: [("stick", "一长条", 113, "one US stick of butter, about 113 g")],
    173430: [("stick", "一长条", 113, "one US stick of butter, about 113 g")],
}

COOKED_WORDS = ("熟", "煮", "蒸", "烤")
RAW_WORDS = ("（生", "生，", "（干", "脱水", "面粉", "粉（")

# A "slice" heavier than this is a whole loaf cut once ("1 slice" of French
# bread in SR Legacy is 139 g), so it is not a household slice.
BREAD_SLICE_MAX = 60


def is_cooked(name_zh):
    return any(word in name_zh for word in COOKED_WORDS) and not any(
        word in name_zh for word in RAW_WORDS
    )


def household_measures(food, measures, seen_labels):
    """Add the Chinese household measures (estimates) that are still missing."""
    fdc_id = food["fdc_id"]
    name = food["name_zh"]
    category = food["category_zh"]

    def add(slug, label, grams, reason, kind):
        add_measure(
            measures, seen_labels, slug, label, grams, f"estimate:{reason}", kind
        )

    for slug, label, grams, reason in FOOD_OVERRIDES.get(fdc_id, []):
        add(slug, label, grams, reason, "piece" if slug != "cup" and slug != "spoon" else slug)

    if category in NUT_CATEGORIES and not any(
        word in name for word in ("酱", "糊", "粉")
    ):
        add("handful", "一把", 25, "handful of nuts or seeds, about 25 g", "handful")

    # Cooked rice, other cooked grains and noodles are eaten by the bowl; rice
    # also by the fist (a common way to describe a portion without a scale).
    # Porridge, congee and soup-like foods get the porridge bowl below instead,
    # because "one bowl of cooked rice" would be the wrong weight for them.
    is_porridge = (
        any(word in name for word in ("粥", "羹", "糊"))
        and "酱" not in name
    )
    if category == "谷物与面食" and is_cooked(name) and not is_porridge:
        add("bowl", "一碗", 200, "one Chinese bowl of cooked rice, about 200 g", "bowl")
        if "饭" in name:
            add("fist", "一拳", 150, "one fist of cooked rice, about 150 g", "fist")
    elif category == "面条与面食":
        add("bowl", "一碗", 200, "one Chinese bowl of cooked noodles, about 200 g", "bowl")

    # Porridge, congee and soup-like foods are eaten by the bowl as well.
    # Pastes ("芝麻糊", "酱糊") are not soup, so a name with 酱/酱糊 is left
    # alone.
    if is_porridge and "一碗" not in seen_labels:
        add("bowl", "一碗", 300, "one Chinese bowl of porridge or soup, about 300 g", "bowl")

    if category in MEAT_CATEGORIES:
        add(
            "palm",
            "一掌心大小",
            100,
            "palm-sized portion of meat or fish, about 100 g",
            "palm",
        )

    if category == "奶类" and any(word in name for word in ("牛奶", "山羊奶", "酪乳")):
        add("cup", "一杯", 240, "one cup of milk, about 240 g", "cup")

    if category == "食用油脂":
        add("spoon", "一勺", 13, "one tablespoon of cooking oil, about 13 g", "spoon")
        add("spoon_small", "一小勺", 4.5, "one teaspoon of cooking oil, about 4.5 g", "spoon_small")

    if category == "调味料" and ("酱" in name or "蚝油" in name):
        add("spoon", "一勺", 16, "one tablespoon of sauce or paste, about 16 g", "spoon")

    if category == "豆制品" and "豆浆" in name:
        add("cup", "一杯", 240, "one cup of soy milk, about 240 g", "cup")

    # Cheeses sold as a block only have package portions in SR Legacy; a slice
    # is the usual Chinese way to count cheese.
    if category == "奶酪" and not any(label.endswith("片") for label in seen_labels):
        add("slice", "一片", 28, "one slice of cheese, about 28 g", "piece")

    # Canned or dry beans often lack a cup portion in SR Legacy.
    if category == "豆类" and "一杯" not in seen_labels and "半杯" not in seen_labels:
        add("cup", "一杯", 180, "one cup of cooked beans, about 180 g", "cup")

    # Bread is sliced; crackers, pita and tortillas already have their own
    # count in SR Legacy, so the slice estimate is only for loaves and rolls
    # that have no per-piece portion.
    if (
        category == "面包与烘焙"
        and any(word in name for word in ("面包", "贝果", "吐司"))
        and not any(label.startswith(("一个", "一张")) for label in seen_labels)
        and not any(
            measure["label"] == "一片" and measure["grams"] <= BREAD_SLICE_MAX
            for measure in measures
        )
    ):
        add("slice", "一片", 30, "one slice of bread, about 30 g", "piece")


# Preferred default label per category, most specific first.
CATEGORY_DEFAULT_PREFIXES = {
    "蛋类": ["一个", "一杯"],
    "坚果类": ["一把", "一杯"],
    "种子类": ["一把", "一小勺", "一杯"],
    "奶类": ["一杯", "一勺", "一块"],
    "奶酪": ["一片", "一杯"],
    "食用油脂": ["一勺", "一杯"],
    "香辛料": ["一小勺", "一勺"],
    "调味料": ["一勺", "一小勺"],
    "面包与烘焙": ["一片", "一个"],
    "面条与面食": ["一碗", "一杯"],
    "谷物与面食": ["一杯", "一碗"],
    "水果类": ["一个", "一杯"],
    "水果干": ["一个", "一杯"],
    "豆制品": ["一块", "半杯", "一杯"],
    "豆类": ["一杯", "一勺"],
    "菌菇类": ["一朵", "一杯"],
    "海藻类": ["一杯", "一小勺"],
    "畜肉类": ["一掌心大小", "一块", "一片"],
    "禽肉类": ["一掌心大小", "一块", "一只"],
    "鱼类": ["一掌心大小", "一片"],
    "虾蟹类": ["一掌心大小", "一只"],
    "贝类": ["一掌心大小", "一个"],
    "内脏类": ["一掌心大小", "一块"],
    "加工肉制品": ["一掌心大小", "一片"],
    "叶菜类": ["一杯", "半杯", "一颗", "一片（叶）"],
    "根茎类": ["一杯", "半杯", "一根"],
    "薯类与根茎": ["一杯", "一个（中）"],
    "茄果瓜类": ["一杯", "一个"],
    "笋类与芽苗": ["一杯", "一根"],
    "葱蒜与香辛菜": ["一根", "一个（中）", "一勺", "一杯"],
    "荚豆类": ["一杯", "一根"],
    "水果制品": ["一杯"],
}

# Per-food default tweaks where the category default would be odd.
DEFAULT_NAME_OVERRIDES = [
    ("黄油", ["一勺", "一小块", "一杯"]),
    ("稀奶油", ["一勺", "一杯"]),
    ("酸奶油", ["一勺", "一杯"]),
    ("炼乳", ["一勺", "一杯"]),
    ("奶粉", ["四分之一杯", "一杯"]),
    ("蜂蜜", ["一勺"]),
    ("粉丝", ["一碗", "一杯"]),
    ("豆腐", ["一块", "半杯", "一杯"]),
    ("豆浆", ["一杯"]),
    ("味噌", ["一勺", "一杯"]),
    ("米饭", ["一碗", "一拳", "一杯"]),
    ("面条", ["一碗", "一杯"]),
    ("意大利面", ["一碗", "一杯"]),
    ("荞麦面", ["一碗", "一杯"]),
    ("鸡蛋面", ["一碗", "一杯"]),
    ("面（", ["一杯", "一碗"]),
    # Large fruits are eaten in pieces, not whole.
    ("西瓜", ["一杯", "一角"]),
    ("甜瓜", ["一杯", "一角"]),
    ("蜜瓜", ["一杯", "一角"]),
    ("哈密瓜", ["一杯", "一角"]),
    ("菠萝", ["一杯", "一片"]),
    ("木瓜", ["一杯", "一片"]),
    ("榴莲", ["一杯", "一个"]),
    ("柚子", ["一杯", "半个"]),
    ("西柚", ["半个", "一杯"]),
    # Small fruits are counted by the cup, not by one berry.
    ("草莓", ["一杯", "一个"]),
    ("蓝莓", ["一杯", "一个"]),
    ("黑莓", ["一杯", "一个"]),
    ("覆盆子", ["一杯", "一个"]),
    ("桑葚", ["一杯", "一个"]),
    ("葡萄", ["一杯", "一颗"]),
    ("樱桃", ["一杯", "一颗"]),
    ("醋栗", ["一杯", "一颗"]),
    ("龙眼干", ["一勺", "一杯"]),
    ("荔枝干", ["一勺", "一杯"]),
    ("枸杞", ["一勺", "一杯"]),
    ("龙眼", ["一杯", "一个"]),
    ("荔枝", ["一杯", "一个"]),
    ("罗望子", ["一杯"]),
    ("芝麻菜", ["半杯", "一片（叶）"]),
    ("莲藕", ["半杯", "十片"]),
    ("大蒜", ["一瓣", "一杯"]),
    ("洋葱", ["一个（中）", "一杯"]),
    ("芹菜", ["一根（中）", "一根", "一杯"]),
    ("小葱", ["一个（中）", "一根", "一勺"]),
    ("葫芦", ["半杯", "一个"]),
    ("冬瓜", ["一杯", "半杯"]),
    ("细香葱", ["一勺", "一小勺"]),
    ("苏打饼干", ["五块", "一块", "一杯"]),
    ("全麦饼干", ["六块", "一块", "一份"]),
]


# Used only when neither the category nor the name gives a match: a real
# spoon or cup is a better default than a package or a 10-piece portion.
FALLBACK_DEFAULT_PREFIXES = ["一杯", "一勺", "一个", "一份"]


def choose_default(food, measures):
    """Mark exactly one measure as the default.

    The first label of the prefix list wins; an exact label match beats a
    prefix match so that "一个" is preferred over "一个（小）".
    """
    name = food["name_zh"]
    prefixes = None
    for needle, override in DEFAULT_NAME_OVERRIDES:
        if needle in name:
            prefixes = override
            break
    # Cooked grains (rice, millet, barley, quinoa, ...) are eaten by the bowl,
    # raw grains and flours by the cup.
    if prefixes is None and food["category_zh"] == "谷物与面食" and is_cooked(name):
        prefixes = ["一碗", "一拳", "一杯"]
    if prefixes is None:
        prefixes = CATEGORY_DEFAULT_PREFIXES.get(food["category_zh"], [])
    for prefix in prefixes:
        for measure in measures:
            if measure["label"] == prefix:
                return measure
    for prefix in prefixes:
        for measure in measures:
            if measure["label"].startswith(prefix):
                return measure
    # Last resort before "whatever comes first": prefer a real household
    # spoon or cup over a fragment of a bigger unit.
    for prefix in FALLBACK_DEFAULT_PREFIXES:
        for measure in measures:
            if measure["label"].startswith(prefix):
                return measure
    return measures[0]


KIND_ORDER = {
    "piece": 0,
    "bowl": 1,
    "fist": 2,
    "cup": 3,
    "handful": 4,
    "palm": 5,
    "spoon": 6,
    "spoon_small": 7,
    "dash": 8,
}


def label_unit(label):
    """The classifier part of a label: 一个（中） -> 个, 一杯 -> 杯, 十片 -> 片."""
    label = re.sub(r"（[^）]*）$", "", label)
    for amount in sorted(AMOUNT_ZH.values(), key=len, reverse=True):
        if label.startswith(amount):
            return label[len(amount):]
    return re.sub(r"^\d+(\.\d+)?", "", label)


def trim_measures(measures, default_measure):
    """Keep at most MAX_MEASURES, always keeping the default first.

    The remaining slots prefer a classifier that the kept measures do not use
    yet (so a whole tomato keeps its slice instead of three sizes of tomato),
    then the sizes closest to the default.
    """
    if len(measures) <= MAX_MEASURES:
        return measures
    kept = [default_measure]
    units = {label_unit(default_measure["label"])}
    rest = [measure for measure in measures if measure is not default_measure]
    while rest and len(kept) < MAX_MEASURES:
        rest.sort(
            key=lambda measure: (
                label_unit(measure["label"]) in units,
                KIND_ORDER.get(measure["kind"], 9),
                abs(measure["grams"] - default_measure["grams"]),
            )
        )
        chosen = rest.pop(0)
        kept.append(chosen)
        units.add(label_unit(chosen["label"]))
    return kept


SIZE_RANK = {"（中）": 1, "（小）": 2, "（特大）": 3}


def cap_classifiers(measures):
    """Drop size variants of one classifier when a food has other classifiers.

    A tomato has a cup, a whole tomato, a slice, a wedge and a cherry portion;
    keeping three sizes of whole tomato would crowd out the slice. A food
    counted only one way (eggs: small/medium/large) keeps all of its sizes.
    """
    classifiers = {label_unit(measure["label"]) for measure in measures}
    if len(classifiers) <= 1:
        return measures
    ordered = sorted(
        measures,
        key=lambda measure: SIZE_RANK.get(
            (re.search(r"（[^）]*）$", measure["label"]) or [""])[0], 0
        ),
    )
    kept = []
    count = {}
    for measure in ordered:
        unit = label_unit(measure["label"])
        count[unit] = count.get(unit, 0) + 1
        if count[unit] <= MAX_PER_CLASSIFIER:
            kept.append(measure)
    # Restore the USDA portion order of the surviving measures.
    order = {id(measure): index for index, measure in enumerate(measures)}
    return sorted(kept, key=lambda measure: order[id(measure)])


BONE_IN_COLUMNS = ["food_id", "name_zh", "refuse_pct", "refuse_desc", "source"]
# Suffix of a household measure label whose grams include the bone (P20).
WITH_BONE_SUFFIX = "（带骨）"


def load_bone_in():
    """food_id -> refuse percent from data-src/bone_in_foods.csv (P20).

    The SR Legacy nutrient values of these foods are per 100 g of edible
    portion, but people weigh and buy the cut with the bone, so the household
    measures of these foods are stored as with-bone weights.
    """
    if not BONE_IN_CSV.is_file():
        return {}
    with BONE_IN_CSV.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if list(reader.fieldnames or []) != BONE_IN_COLUMNS:
            raise SystemExit(f"{BONE_IN_CSV.name}: unexpected columns {reader.fieldnames}")
        refuse = {}
        for row in reader:
            food_id = (row["food_id"] or "").strip()
            if not food_id:
                continue
            try:
                pct = float((row["refuse_pct"] or "").strip())
            except ValueError:
                raise SystemExit(f"{BONE_IN_CSV.name}: {food_id} refuse_pct is not a number")
            if not 0 < pct < 100:
                raise SystemExit(f"{BONE_IN_CSV.name}: {food_id} refuse_pct {pct} is not 0..100")
            refuse[food_id] = pct
    return refuse


def with_bone_grams(edible_grams, refuse_pct):
    """With-bone weight of an edible portion: edible / (1 - refuse/100)."""
    factor = 1 - refuse_pct / 100.0
    return round(edible_grams / factor, 1)


def apply_bone_in(measures, refuse_pct):
    """Convert edible-portion measures to with-bone weights (P20).

    The label gets a （带骨） suffix and the basis text states the conversion,
    so a reader can always recover the edible weight. The USDA portion id stays
    in the basis (the validator converts back before comparing gram weights).
    """
    for measure in measures:
        edible = measure["grams"]
        with_bone = with_bone_grams(edible, refuse_pct)
        conversion = (
            f"with bone: {edible:g} g edible / (1 - {refuse_pct:g}% refuse) "
            f"= {with_bone:g} g with bone"
        )
        basis = measure["basis"]
        if basis.startswith("estimate:"):
            reason = basis[len("estimate:"):].split(";")[0]
            measure["basis"] = f"estimate:{reason}; {conversion}"
        else:
            measure["basis"] = f"{basis}; {conversion}"
        measure["grams"] = with_bone
        if not measure["label"].endswith(WITH_BONE_SUFFIX):
            measure["label"] = measure["label"] + WITH_BONE_SUFFIX
    return measures


def build_measures(curated, portions):
    """food_key -> list of measures, one default each."""
    result = {}
    bone_in = load_bone_in()
    for food in curated:
        fdc_id = food["fdc_id"]
        measures = []
        seen_labels = set()


        for row in portions.get(fdc_id, []):
            label, kind, generic = portion_label(row)
            if label is None:
                continue
            if generic:
                classifier = food_classifier(food)
                if classifier:
                    label = replace_generic_classifier(label, classifier)
            add_measure(
                measures,
                seen_labels,
                f"usda{row['id']}",
                label,
                row["gram_weight"],
                f"usda_portion:{row['id']}",
                kind,
            )
        measures = cap_classifiers(measures)
        seen_labels = {measure["label"] for measure in measures}

        # A "slice" of bread heavier than a normal household slice is a whole
        # loaf portion, not something a person cuts; replace it by an estimate.
        if food["category_zh"] == "面包与烘焙":
            for measure in list(measures):
                if measure["label"] == "一片" and measure["grams"] > BREAD_SLICE_MAX:
                    drop_measure(measures, seen_labels, measure)

        household_measures(food, measures, seen_labels)
        if not measures:
            add_measure(
                measures,
                seen_labels,
                "serving",
                "一份",
                100,
                "estimate:one serving, about 100 g",
                "piece",
            )

        default_measure = choose_default(food, measures)
        measures = trim_measures(measures, default_measure)
        for measure in measures:
            measure["is_default"] = measure is default_measure

        # Phase P20: the nutrients of a bone-in food are per 100 g edible
        # portion, so its household measures become with-bone weights. The
        # conversion runs after the default choice, because the default is
        # matched on the plain labels.
        refuse_pct = bone_in.get(f"fdc:{fdc_id}")
        if refuse_pct is not None:
            apply_bone_in(measures, refuse_pct)

        result[str(fdc_id)] = measures
    return result


def write_measures(measures_by_food):
    with MEASURES_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(MEASURE_COLUMNS)
        for food_key, measures in measures_by_food.items():
            for measure in measures:
                writer.writerow(
                    [
                        food_key,
                        measure["id"],
                        measure["label"],
                        f"{measure['grams']:g}",
                        measure["basis"],
                        "1" if measure["is_default"] else "0",
                    ]
                )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dry-run", action="store_true", help="print the summary without writing"
    )
    args = parser.parse_args(argv)

    dataset_dir()
    curated = load_curated()
    portions = load_food_portion()
    measures_by_food = build_measures(curated, portions)

    total = sum(len(rows) for rows in measures_by_food.values())
    estimates = sum(
        1
        for rows in measures_by_food.values()
        for row in rows
        if row["basis"].startswith("estimate:")
    )
    usda = total - estimates
    print(f"foods: {len(measures_by_food)}")
    print(f"measures: {total} ({usda} usda_portion, {estimates} estimate)")
    print(f"estimate share: {estimates / total * 100:.1f}%")

    if not args.dry_run:
        write_measures(measures_by_food)
        print(f"wrote {MEASURES_CSV.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
