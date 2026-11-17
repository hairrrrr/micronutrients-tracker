# Data source research notes (supervisor, 2026-11-18 01:30 Asia/Taipei)

Raw downloads are kept OUTSIDE the repo in /workspace/vita-research/ (large files).

## USDA FoodData Central (public domain, CC0)
- Download page: https://fdc.nal.usda.gov/download-datasets
- SR Legacy (final release 2018-04, 7,793 foods, best micronutrient coverage):
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
  -> /workspace/vita-research/usda/FoodData_Central_sr_legacy_food_csv_2018-04/ (food.csv, food_nutrient.csv, nutrient.csv, food_portion.csv ...)
- Foundation Foods (latest 2026-10-29, fewer foods, newer analyses):
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-10-29.zip
  -> /workspace/vita-research/usda/FoodData_Central_foundation_food_csv_2026-10-29/
- food_portion.csv contains USDA household portions (cup, slice, large egg ...) in grams: a sourced basis for household measures.
- Nutrient IDs in SR Legacy (nutrient.csv `id`, unit; count of foods with a value):
  | Nutrient | id | unit | foods |
  |---|---|---|---|
  | Vitamin A, RAE | 1106 | ug | 6918 |
  | Vitamin D (D2+D3) | 1114 | ug | 5185 |
  | Vitamin E (alpha-tocopherol) | 1109 | mg | 5580 |
  | Vitamin K (phylloquinone) | 1185 | ug | 5054 |
  | Vitamin C | 1162 | mg | 7332 |
  | Thiamin | 1165 | mg | 7402 |
  | Riboflavin | 1166 | mg | 7421 |
  | Niacin (preformed) | 1167 | mg | 7402 |
  | Vitamin B-6 | 1175 | mg | 7262 |
  | Folate, DFE | 1190 | ug | 6482 |
  | Vitamin B-12 | 1178 | ug | 7113 |
  | Pantothenic acid | 1170 | mg | 6376 |
  | Choline, total | 1180 | mg | 4611 |
  | Calcium | 1087 | mg | 7708 |
  | Iron | 1089 | mg | 7713 |
  | Zinc | 1095 | mg | 7406 |
  | Magnesium | 1090 | mg | 7421 |
  | Potassium | 1092 | mg | 7516 |
  | Phosphorus | 1091 | mg | 7467 |
  | Selenium | 1103 | ug | 6865 |
  | Copper | 1098 | mg | 7284 |
  | Manganese | 1101 | mg | 6492 |
  | Sodium | 1093 | mg | 7709 |
  | Tryptophan | 1210 | g | 5030 |
  | Biotin | 1176 | ug | NONE in SR Legacy |
  | Iodine | 1100 | ug | NONE in SR Legacy |
- Missing value != zero. Treat absent rows as "no data" and show that in the UI; do not count as 0 silently.
- Iodine: separate USDA/FDA/ODS-NIH Database for the Iodine Content of Common Foods exists (not yet downloaded). Otherwise drop iodine/biotin from food-based tracking or mark "no food data".

## Unit / definition mismatches to handle
- Niacin: Chinese DRI is mg NE (niacin + tryptophan/60); US RDA is also mg NE. USDA niacin (1167) is preformed niacin only. Option: NE = niacin + tryptophan_mg/60 (tryptophan 1210 is in grams -> *1000/60). Must be documented.
- Vitamin E: Chinese DRI uses mg alpha-TE (includes beta/gamma/delta-tocopherols at weights); US RDA uses mg alpha-tocopherol. USDA 1109 is alpha-tocopherol only -> slight underestimate vs Chinese target; document.
- Vitamin A: both use ug RAE; USDA 1106 is RAE. OK.
- Folate: both ug DFE; USDA 1190 DFE. OK.
- Vitamin K: Chinese AI 80 ug; US AI 120/90 ug; USDA phylloquinone only.

## Chinese DRIs 2023 (Chinese Nutrition Society)
- Official page with per-group tables as JPG images: https://www.cnsoc.org/drpostand/ (and page2.html)
- Downloaded official images: /workspace/vita-research/cn_dri/table1..23 (adult tables 9-23 downloaded; index.txt lists table number -> group -> URL).
  Tables: 9/10 18-29 M/F, 11/12 30-49 M/F, 13/14 50-64 M/F, 15-17 pregnancy trimesters, 18 lactation, 19 SPL/UL other components, 20/21 65-74 M/F, 22/23 75+ M/F.
- Spot values read from official Table 11 (30-49 male): Ca 800 (UL 2000), P 710, K 2000 AI, Na 1500 AI, Mg 320, Fe 12 (UL 42), I 120, Zn 12.0, Se 60, Cu 0.8, Mn 4.5 AI, Mo 25; Vit A 770 ugRAE (UL 3000), D 10, E 14 AI mg a-TE, K 80 AI, B1 1.4, B2 1.4, niacin 15 mgNE, B6 1.4, folate 400 ugDFE (UL 1000 synthetic), B12 2.4, pantothenic 5.0 AI, biotin 40 AI, choline 450 AI, C 100 (UL 2000).
- Values for the app must be transcribed from these official images and double-checked by the supervisor.

## US DRIs (NASEM Food and Nutrition Board)
- Index: https://ods.od.nih.gov/HealthInformation/nutrientrecommendations.aspx (fetchable via WebFetch; direct curl gets 403)
- The DRI summary tables (RDA/AI elements & vitamins, UL elements & vitamins) link to NCBI Bookshelf NBK545442 / NBK56068, which return a reCAPTCHA page to curl -> verify via browser or ODS per-nutrient fact sheets (Health Professional pages, each has an RDA/AI table).
- US age groups: 19-30, 31-50, 51-70, >70 (differs from Chinese 18-29, 30-49, 50-64, 65-74, 75+).
- 2019 sodium/potassium update: potassium AI 3400 mg (M) / 2600 mg (F); sodium CDRR 2300 mg.
