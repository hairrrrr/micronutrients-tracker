#!/usr/bin/env bash
# Download the USDA FoodData Central SR Legacy (2018-04) CSV package into
# data-raw/ and verify its sha256. Safe to run repeatedly: an already valid
# zip is reused and an already extracted folder is not unpacked again.
set -euo pipefail

cd "$(dirname "$0")/.."

URL="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
ZIP_NAME="FoodData_Central_sr_legacy_food_csv_2018-04.zip"
DIR_NAME="FoodData_Central_sr_legacy_food_csv_2018-04"
EXPECTED_SHA256="b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0"
RAW_DIR="data-raw"
ZIP_PATH="$RAW_DIR/$ZIP_NAME"
EXTRACT_DIR="$RAW_DIR/$DIR_NAME"
USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

sha_of() {
  sha256sum "$1" | cut -d' ' -f1
}

mkdir -p "$RAW_DIR"

need_download=1
if [ -f "$ZIP_PATH" ]; then
  actual="$(sha_of "$ZIP_PATH")"
  if [ "$actual" = "$EXPECTED_SHA256" ]; then
    echo "sha256 OK: $ZIP_NAME ($EXPECTED_SHA256) - existing download reused, skipping fetch"
    need_download=0
  else
    echo "sha256 MISMATCH for existing $ZIP_PATH (got $actual, expected $EXPECTED_SHA256)" >&2
    echo "deleting the corrupt file and downloading again" >&2
    rm -f "$ZIP_PATH"
  fi
fi

if [ "$need_download" -eq 1 ]; then
  echo "downloading $URL"
  tmp_path="$ZIP_PATH.part"
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 30 -A "$USER_AGENT" -o "$tmp_path" "$URL"
  actual="$(sha_of "$tmp_path")"
  if [ "$actual" != "$EXPECTED_SHA256" ]; then
    rm -f "$tmp_path"
    echo "sha256 MISMATCH after download (got $actual, expected $EXPECTED_SHA256)" >&2
    exit 1
  fi
  mv "$tmp_path" "$ZIP_PATH"
  echo "sha256 OK: $ZIP_NAME ($EXPECTED_SHA256)"
fi

# The archive contains the CSV folder at its top level.
if [ -d "$EXTRACT_DIR" ] && [ -f "$EXTRACT_DIR/food.csv" ]; then
  echo "already extracted: $EXTRACT_DIR (skipping unzip)"
else
  echo "extracting $ZIP_NAME into $RAW_DIR/"
  unzip -q -o "$ZIP_PATH" -d "$RAW_DIR"
  if [ ! -f "$EXTRACT_DIR/food.csv" ]; then
    echo "extraction failed: $EXTRACT_DIR/food.csv not found" >&2
    exit 1
  fi
  echo "extracted to $EXTRACT_DIR/"
fi

for table in food.csv nutrient.csv food_nutrient.csv food_portion.csv food_category.csv; do
  if [ ! -f "$EXTRACT_DIR/$table" ]; then
    echo "missing expected table: $EXTRACT_DIR/$table" >&2
    exit 1
  fi
done

echo "ready: $EXTRACT_DIR/"
