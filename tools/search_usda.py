#!/usr/bin/env python3
"""Search USDA SR Legacy food descriptions from the command line.

Usage:
    python3 tools/search_usda.py <words...>

Every word must appear in the English description (case-insensitive, in any
order). Output is one line per food: `fdc_id | category | description`,
at most 40 rows, sorted by fdc_id.

Examples:
    python3 tools/search_usda.py pork liver raw
    python3 tools/search_usda.py broccoli
"""

from __future__ import annotations

import sys

from usda_lib import load_food, load_food_category

MAX_ROWS = 40


def search(words, foods, categories, limit=MAX_ROWS):
    """Return matching food rows as (fdc_id, category, description) tuples."""
    needles = [word.casefold() for word in words if word.strip()]
    if not needles:
        raise SystemExit("usage: python3 tools/search_usda.py <words...>")

    matches = []
    for fdc_id, food in foods.items():
        description = food["description"]
        haystack = description.casefold()
        if all(needle in haystack for needle in needles):
            category = categories.get(food["food_category_id"])
            category_name = category["description"] if category else ""
            matches.append((fdc_id, category_name, description))

    matches.sort(key=lambda item: item[0])
    return matches[:limit]


def main(argv):
    foods = load_food()
    categories = load_food_category()
    matches = search(argv[1:], foods, categories)

    if not matches:
        print("no matches", file=sys.stderr)
        return 1

    for fdc_id, category, description in matches:
        print(f"{fdc_id} | {category} | {description}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
