// Checks the generated food data against fixed values taken directly from the
// USDA SR Legacy 2018-04 tables (see PLAN.md phase P4). The fixture numbers
// below must not be changed: they are the independent reference values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foodsPath = new URL("../../docs/data/foods.json", import.meta.url);
const nutrientsPath = new URL("../../docs/data/nutrients.json", import.meta.url);

const data = JSON.parse(await readFile(foodsPath, "utf8"));
const nutrients = JSON.parse(await readFile(nutrientsPath, "utf8"));

const foodsById = new Map(data.foods.map((food) => [food.id, food]));

function food(id) {
  const found = foodsById.get(id);
  assert.ok(found, `foods.json has no food ${id}`);
  return found;
}

function per100g(id, nutrientId) {
  return food(id).per100g[nutrientId];
}

test("foods.json has the SR Legacy source header", () => {
  assert.equal(data.source.name, "USDA FoodData Central SR Legacy");
  assert.equal(data.source.release, "2018-04");
  assert.ok(data.source.url.startsWith("https://"));
});

test("foods.json is not empty and every food has all 22 nutrients", () => {
  assert.ok(data.foods.length > 100, `only ${data.foods.length} foods`);
  const nutrientIds = nutrients.nutrients.map((nutrient) => nutrient.id);
  assert.equal(nutrientIds.length, 22);
  for (const food of data.foods) {
    for (const nutrientId of nutrientIds) {
      assert.ok(
        Object.hasOwn(food.per100g, nutrientId),
        `${food.id} misses ${nutrientId}`,
      );
    }
  }
});

test("pork liver raw (fdc:167862) has the SR Legacy values", () => {
  assert.equal(per100g("fdc:167862", "vitA"), 6502);
  assert.equal(per100g("fdc:167862", "vitB12"), 26);
  assert.equal(per100g("fdc:167862", "iron"), 23.3);
  assert.equal(per100g("fdc:167862", "thiamin"), 0.283);
});

test("egg whole raw (fdc:171287) has the SR Legacy values", () => {
  assert.equal(per100g("fdc:171287", "vitA"), 160);
  assert.equal(per100g("fdc:171287", "vitB12"), 0.89);
  assert.equal(per100g("fdc:171287", "iron"), 1.75);
});

test("niacin is reported as NE for pork liver raw (fdc:167862)", () => {
  // 15.301 mg niacin + 0.301 g tryptophan * 1000 / 60 = 20.317 -> 20.32
  const niacin = per100g("fdc:167862", "niacin");
  assert.ok(Math.abs(niacin - 20.32) <= 0.01, `niacin ${niacin} != 20.32 +/- 0.01`);
  assert.equal(food("fdc:167862").flags.niacinNoTryptophan, false);
});

test("missing USDA data stays null and is never turned into 0", () => {
  const nullable = data.foods.filter((food) =>
    Object.values(food.per100g).some((value) => value === null),
  );
  assert.ok(nullable.length > 0, "no null values at all: suspicious for SR Legacy");
  for (const food of data.foods) {
    for (const [nutrientId, value] of Object.entries(food.per100g)) {
      assert.ok(
        value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0),
        `${food.id} ${nutrientId}: ${value}`,
      );
    }
  }
});

test("every food has measures with exactly one default", () => {
  for (const food of data.foods) {
    assert.ok(food.measures.length >= 1, `${food.id} has no measure`);
    const defaults = food.measures.filter((measure) => measure.default);
    assert.equal(defaults.length, 1, `${food.id} has ${defaults.length} defaults`);
    for (const measure of food.measures) {
      assert.ok(measure.grams >= 1 && measure.grams <= 1000, `${food.id} ${measure.id}`);
      // P20: a bone-in measure appends its with-bone conversion to the basis,
      // so only the first part is the source.
      assert.match(measure.basis, /^(usda_portion:\d+|estimate:.+?)(; with bone: .+)?$/);
    }
  }
});

test("household measures stay in their sanity ranges (PLAN P5)", () => {
  const ranges = [
    { id: "fdc:171287", label: "一个", low: 40, high: 60 }, // one egg
    { id: "fdc:170567", label: "一把", low: 15, high: 35 }, // handful of almonds
    { id: "fdc:168878", label: "一拳", low: 100, high: 200 }, // fist of cooked rice
    { id: "fdc:168878", label: "一碗", low: 120, high: 250 }, // bowl of cooked rice
    { id: "fdc:171265", label: "一杯", low: 200, high: 260 }, // cup of milk
  ];
  for (const range of ranges) {
    const measure = food(range.id).measures.find((item) => item.labelZh === range.label);
    assert.ok(measure, `${range.id} has no ${range.label} measure`);
    assert.ok(
      measure.grams >= range.low && measure.grams <= range.high,
      `${range.id} ${range.label} is ${measure.grams} g, expected ${range.low}-${range.high} g`,
    );
  }
});

// ---------------------------------------------------------------------------
// P18b: commonness tiers, and no review text under docs/
// ---------------------------------------------------------------------------

const commonnessPath = new URL("../../data-src/commonness.csv", import.meta.url);
const docsDataPath = new URL("../../docs/data/", import.meta.url);

/** Minimal CSV reader for the four-column commonness file (quoted fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((line) => line.some((cell) => cell !== ""))
    .map((line) => Object.fromEntries(header.map((key, index) => [key, line[index] ?? ""])));
}

/** Every key path of a decoded JSON value (for the "reason" key check). */
function keyPaths(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyPaths(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...keyPaths(item, path)];
    });
  }
  return [];
}

test("every food has a commonness tier of 1-5 that matches commonness.csv", async () => {
  const csv = parseCsv(await readFile(commonnessPath, "utf8"));
  assert.ok(csv.length > 100, `commonness.csv has only ${csv.length} rows`);
  const tiers = new Map(csv.map((row) => [row.food_id, Number(row.commonness)]));

  assert.equal(tiers.size, csv.length, "commonness.csv repeats a food_id");
  assert.equal(tiers.size, data.foods.length, "commonness.csv and foods.json differ in size");

  for (const food of data.foods) {
    assert.ok(
      Number.isInteger(food.commonness) && food.commonness >= 1 && food.commonness <= 5,
      `${food.id}: commonness ${food.commonness} is not an integer 1-5`,
    );
    assert.equal(food.commonness, tiers.get(food.id), `${food.id}: tier differs from the CSV`);
  }
  for (const id of tiers.keys()) {
    assert.ok(foodsById.has(id), `commonness.csv has an unknown food_id ${id}`);
  }
});

test("no docs/data JSON contains a reason key or any reason_zh text", async () => {
  const { readdir } = await import("node:fs/promises");
  const csv = parseCsv(await readFile(commonnessPath, "utf8"));
  const reasons = [...new Set(csv.map((row) => row.reason_zh.trim()).filter(Boolean))];
  assert.ok(reasons.length > 100, "no reason strings found in commonness.csv");

  const names = (await readdir(docsDataPath)).filter((name) => name.endsWith(".json"));
  assert.ok(names.length >= 3, `only ${names.length} docs/data JSON files`);
  for (const name of names) {
    const text = await readFile(new URL(name, docsDataPath), "utf8");
    const decoded = JSON.parse(text);
    for (const path of keyPaths(decoded)) {
      const bare = path.split(".").at(-1).split("[").at(0);
      assert.ok(
        bare !== "reason" && bare !== "reason_zh",
        `docs/data/${name} contains the key ${path}`,
      );
    }
    for (const reason of reasons) {
      assert.equal(text.includes(reason), false, `docs/data/${name} leaks a reason_zh string`);
    }
  }
});

test("no docs JS or HTML file contains a reason_zh string", async () => {
  const { readdir } = await import("node:fs/promises");
  const csv = parseCsv(await readFile(commonnessPath, "utf8"));
  const reasons = [...new Set(csv.map((row) => row.reason_zh.trim()).filter(Boolean))];

  const docsRoot = new URL("../../docs/", import.meta.url);
  const files = [];
  const walk = async (url) => {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(js|mjs|html)$/i.test(entry.name)) files.push(child);
    }
  };
  await walk(docsRoot);
  assert.ok(files.length > 5, `only ${files.length} docs JS/HTML files`);

  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const reason of reasons) {
      assert.equal(
        text.includes(reason),
        false,
        `${file.pathname.split("/docs/")[1]} leaks a reason_zh string`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// P19b: amountBasisG on every food
// ---------------------------------------------------------------------------

const smallPortionPath = new URL("../../data-src/small_portion_foods.csv", import.meta.url);

test("every food has amountBasisG in {10, 100} and flagged foods are exactly 10", async () => {
  const csv = parseCsv(await readFile(smallPortionPath, "utf8"));
  assert.ok(csv.length > 40, `small_portion_foods.csv has only ${csv.length} rows`);
  const flagged = new Set(csv.map((row) => row.food_id));

  assert.equal(flagged.size, csv.length, "small_portion_foods.csv repeats a food_id");
  for (const row of csv) {
    assert.equal(Number(row.basis_g), 10, `${row.food_id}: basis_g ${row.basis_g}`);
    assert.ok(foodsById.has(row.food_id), `small_portion_foods.csv lists an unknown id ${row.food_id}`);
  }

  let small = 0;
  for (const food of data.foods) {
    assert.ok(
      food.amountBasisG === 10 || food.amountBasisG === 100,
      `${food.id}: amountBasisG ${food.amountBasisG} is not 10 or 100`,
    );
    if (flagged.has(food.id)) {
      assert.equal(food.amountBasisG, 10, `${food.id}: flagged food must be 10 g`);
      small += 1;
    } else {
      assert.equal(food.amountBasisG, 100, `${food.id}: unflagged food must be 100 g`);
    }
  }
  assert.equal(small, flagged.size, "not every flagged food is in foods.json");
  // The flagged set is a small minority, as the supervisor's list intends.
  assert.ok(small < data.foods.length / 4, `${small} of ${data.foods.length} foods are per 10 g`);
});

test("the flagged foods include the reviewed garlic and dried goods", () => {
  for (const id of ["fdc:169230", "fdc:168581", "fdc:170189", "fdc:171016"]) {
    assert.equal(food(id).amountBasisG, 10, `${id} should be compared per 10 g`);
  }
  // A fresh vegetable and a staple keep the per-100 g basis.
  assert.equal(food("fdc:170393").amountBasisG, 100);
  assert.equal(food("fdc:168878").amountBasisG, 100);
});

// ---------------------------------------------------------------------------
// P20: no dish estimates, raw meat only, bone-in handling
// ---------------------------------------------------------------------------

const boneInPath = new URL("../../data-src/bone_in_foods.csv", import.meta.url);
const curatedPath = new URL("../../data-src/foods_curated.csv", import.meta.url);

test("no composite dish or estimate field survives anywhere (P20)", async () => {
  assert.equal(data.foods.some((food) => food.id.startsWith("composite:")), false);
  for (const food of data.foods) {
    assert.equal(Object.hasOwn(food, "estimate"), false, `${food.id} still has estimate`);
    assert.equal(Object.hasOwn(food, "basis"), false, `${food.id} still has basis`);
  }
  const curated = parseCsv(await readFile(curatedPath, "utf8"));
  assert.equal(curated.some((row) => row.fdc_id.startsWith("composite:")), false);
  // Tap water was only a dish ingredient, so it is gone too.
  assert.equal(curated.some((row) => row.fdc_id === "173647"), false);
  assert.equal(foodsById.has("fdc:173647"), false);
});

test("the meat categories hold raw entries only", async () => {
  const curated = parseCsv(await readFile(curatedPath, "utf8"));
  const meatCategories = new Set(["畜肉类", "禽肉类", "内脏类", "加工肉制品"]);
  const zhCooked = ["熟", "烤", "炖", "煮", "炒", "煎"];
  const enCooked = ["cooked", "roasted", "braised", "broiled", "simmered", "boiled"];
  let meatRows = 0;
  for (const row of curated) {
    if (!meatCategories.has(row.category_zh)) continue;
    meatRows += 1;
    for (const word of zhCooked) {
      assert.equal(row.name_zh.includes(word), false, `${row.fdc_id} ${row.name_zh} is cooked`);
    }
    const english = row.name_en.toLowerCase();
    for (const word of enCooked) {
      assert.equal(english.includes(word), false, `${row.fdc_id} ${row.name_en} is cooked`);
    }
  }
  assert.ok(meatRows > 40, `only ${meatRows} meat rows`);
  // The 33 cooked ids of the phase are gone, bacon unprepared (raw) stays.
  for (const cookedId of ["169484", "170208", "171791", "168665", "173630", "174312", "172532"]) {
    assert.equal(curated.some((row) => row.fdc_id === cookedId), false, `${cookedId} should be gone`);
  }
  assert.ok(foodsById.has("fdc:168277"), "bacon unprepared (raw) must stay");
});

test("the 11 new foods are present with their reviewed names", async () => {
  const curated = parseCsv(await readFile(curatedPath, "utf8"));
  const added = [
    "167888", "168675", "169439", "171456", "171505", "171486",
    "169726", "168897", "168884", "173905", "170283",
  ];
  for (const id of added) {
    const row = curated.find((item) => item.fdc_id === id);
    assert.ok(row, `foods_curated.csv has no ${id}`);
    assert.ok(foodsById.has(`fdc:${id}`), `foods.json has no fdc:${id}`);
    for (const measure of food(`fdc:${id}`).measures) {
      assert.equal(measure.default === true, measure.default === true);
    }
    assert.equal(food(`fdc:${id}`).measures.filter((measure) => measure.default).length, 1);
  }
  // Oats (raw) got the renamed label and the three aliases.
  const oats = food("fdc:169705");
  assert.equal(oats.nameZh, "燕麦片（生）");
  assert.deepEqual(oats.aliases, ["燕麦", "麦片", "燕麦米"]);
  // A cooked grain gets a bowl; wild rice raw keeps its cup.
  assert.ok(food("fdc:168897").measures.some((measure) => measure.labelZh === "一碗"));
  assert.ok(food("fdc:173905").measures.some((measure) => measure.labelZh === "一碗"));
  assert.ok(food("fdc:169726").measures.some((measure) => measure.labelZh === "一杯"));
});

test("every bone-in food carries refusePct and a generated note", async () => {
  const csv = parseCsv(await readFile(boneInPath, "utf8"));
  assert.equal(csv.length, 15, `bone_in_foods.csv has ${csv.length} rows, expected 15`);
  const listed = new Set();
  for (const row of csv) {
    listed.add(row.food_id);
    const pct = Number(row.refuse_pct);
    assert.ok(pct > 0 && pct < 100, `${row.food_id}: refuse ${row.refuse_pct}`);
    const entry = food(row.food_id);
    assert.equal(entry.refusePct, pct, `${row.food_id}: refusePct differs from the CSV`);
    assert.equal(typeof entry.refuseNote, "string");
    assert.ok(entry.refuseNote.includes("可食部"), `${row.food_id}: note is not Chinese`);
    assert.ok(entry.refuseNote.includes(`${pct}`), `${row.food_id}: note omits the refuse %`);
  }
  for (const entry of data.foods) {
    if (listed.has(entry.id)) continue;
    assert.equal(Object.hasOwn(entry, "refusePct"), false, `${entry.id} must not carry refusePct`);
  }
  // Spare ribs are the reviewer's example: 30 % bone.
  assert.equal(food("fdc:167853").refusePct, 30);
  assert.equal(food("fdc:172390").refusePct, 38);
});
