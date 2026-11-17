// Age-group mapping for the DRI tables (PLAN.md phase P7a).
//
// The mapping is tested against small in-test fixtures, not the real
// dri.json, so the cases stay readable and a change to the data can never
// hide a mapping bug. The last block only checks the skeleton tables'
// structure (group ids and coverage), never their numeric values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MIN_AGE,
  MAX_AGE,
  clampAge,
  findGroup,
  targetsFor,
} from "../../docs/js/core/dri.js";

// Same group boundaries as the real tables (PLAN.md 1.4), with placeholder
// values only: the mapping is what these tests are about.
function group(id, sex, ageMin, ageMax) {
  return {
    id,
    sex,
    ageMin,
    ageMax,
    lifeStage: "none",
    values: { iron: { target: 1, type: "RNI", ul: null, ulAppliesToFood: null, ulNote: null, ref: "fixture" } },
  };
}

const cnFixture = {
  label: "fixture CN",
  groups: [
    group("cn-m-18-29", "male", 18, 29),
    group("cn-m-30-49", "male", 30, 49),
    group("cn-m-50-64", "male", 50, 64),
    group("cn-m-65-74", "male", 65, 74),
    group("cn-m-75-", "male", 75, null),
    group("cn-f-18-29", "female", 18, 29),
    group("cn-f-30-49", "female", 30, 49),
    group("cn-f-50-64", "female", 50, 64),
    group("cn-f-65-74", "female", 65, 74),
    group("cn-f-75-", "female", 75, null),
  ],
};

const usFixture = {
  label: "fixture US",
  groups: [
    group("us-m-14-18", "male", 14, 18),
    group("us-m-19-30", "male", 19, 30),
    group("us-m-31-50", "male", 31, 50),
    group("us-m-51-70", "male", 51, 70),
    group("us-m-71-", "male", 71, null),
    group("us-f-14-18", "female", 14, 18),
    group("us-f-19-30", "female", 19, 30),
    group("us-f-31-50", "female", 31, 50),
    group("us-f-51-70", "female", 51, 70),
    group("us-f-71-", "female", 71, null),
  ],
};

const driFixture = { standards: { cn2023: cnFixture, us: usFixture } };

function idOf(standard, sex, age, lifeStage) {
  return findGroup(standard, sex, age, lifeStage)?.id ?? null;
}

// The exact cases listed in PLAN.md P7a.
const CN_CASES = [
  [18, "cn-m-18-29"],
  [29, "cn-m-18-29"],
  [30, "cn-m-30-49"],
  [49, "cn-m-30-49"],
  [50, "cn-m-50-64"],
  [64, "cn-m-50-64"],
  [65, "cn-m-65-74"],
  [74, "cn-m-65-74"],
  [75, "cn-m-75-"],
  [100, "cn-m-75-"],
];

const US_CASES = [
  [18, "us-m-14-18"],
  [19, "us-m-19-30"],
  [30, "us-m-19-30"],
  [31, "us-m-31-50"],
  [50, "us-m-31-50"],
  [51, "us-m-51-70"],
  [70, "us-m-51-70"],
  [71, "us-m-71-"],
];

test("CN male age mapping hits every boundary", () => {
  for (const [age, expected] of CN_CASES) {
    assert.equal(idOf(cnFixture, "male", age), expected, `CN male age ${age}`);
  }
});

test("CN female age mapping uses the female groups", () => {
  for (const [age, expected] of CN_CASES) {
    const femaleId = expected.replace("-m-", "-f-");
    assert.equal(idOf(cnFixture, "female", age), femaleId, `CN female age ${age}`);
  }
});

test("US male age mapping hits every boundary", () => {
  for (const [age, expected] of US_CASES) {
    assert.equal(idOf(usFixture, "male", age), expected, `US male age ${age}`);
  }
});

test("US female age mapping uses the female groups", () => {
  for (const [age, expected] of US_CASES) {
    const femaleId = expected.replace("-m-", "-f-");
    assert.equal(idOf(usFixture, "female", age), femaleId, `US female age ${age}`);
  }
});

test("US 18 is the 14-18 group and 17 is still mapped there", () => {
  assert.equal(idOf(usFixture, "male", 18), "us-m-14-18");
  assert.equal(idOf(usFixture, "female", 18), "us-f-14-18");
  // The UI clamps to 18, so 17 is only reachable through a direct call.
  assert.equal(idOf(usFixture, "male", 17), "us-m-14-18");
});

test("ages outside 18..100 are clamped to the adult range", () => {
  assert.equal(clampAge(17), MIN_AGE);
  assert.equal(clampAge(3), MIN_AGE);
  assert.equal(clampAge(-5), MIN_AGE);
  assert.equal(clampAge(101), MAX_AGE);
  assert.equal(clampAge(140), MAX_AGE);

  assert.equal(idOf(cnFixture, "male", 10), "cn-m-18-29");
  assert.equal(idOf(cnFixture, "female", 120), "cn-f-75-");
  assert.equal(idOf(usFixture, "male", 0), "us-m-14-18");
  assert.equal(idOf(usFixture, "female", 130), "us-f-71-");
});

test("open-ended groups have a null ageMax", () => {
  const cnOld = findGroup(cnFixture, "female", 90);
  assert.equal(cnOld.ageMax, null);
  assert.equal(cnOld.id, "cn-f-75-");

  const usOld = findGroup(usFixture, "male", 100);
  assert.equal(usOld.ageMax, null);
  assert.equal(usOld.id, "us-m-71-");
});

test("findGroup accepts either a standard object or its group array", () => {
  assert.equal(findGroup(cnFixture, "male", 35).id, "cn-m-30-49");
  assert.equal(findGroup(cnFixture.groups, "male", 35).id, "cn-m-30-49");
});

test("unknown sex, life stage or standard finds no group", () => {
  assert.equal(findGroup(cnFixture, "other", 30), null);
  assert.equal(findGroup(cnFixture, undefined, 30), null);
  assert.equal(findGroup(cnFixture, "male", 30, "pregnancy"), null);
  assert.equal(findGroup(null, "male", 30), null);
  assert.equal(findGroup({}, "male", 30), null);
  assert.equal(findGroup({ groups: "nope" }, "male", 30), null);
});

test("a non-numeric age falls back to 18 instead of throwing", () => {
  assert.equal(clampAge("abc"), MIN_AGE);
  assert.equal(clampAge(NaN), MIN_AGE);
  assert.equal(clampAge(undefined), MIN_AGE);
  assert.equal(idOf(cnFixture, "male", "30"), "cn-m-30-49");
});

test("integer ages only: a fractional age is truncated", () => {
  assert.equal(clampAge(29.9), 29);
  assert.equal(idOf(cnFixture, "male", 29.9), "cn-m-18-29");
  assert.equal(idOf(cnFixture, "male", 30.1), "cn-m-30-49");
});

test("targetsFor returns the group and its values for the chosen standard", () => {
  const result = targetsFor(driFixture, "cn2023", { sex: "male", age: 35 });
  assert.equal(result.standard, "cn2023");
  assert.equal(result.group.id, "cn-m-30-49");
  assert.deepEqual(result.unitIds, ["iron"]);
  assert.equal(result.values.iron.target, 1);
  assert.equal(result.values.iron.type, "RNI");

  const us = targetsFor(driFixture, "us", { sex: "female", age: 45 });
  assert.equal(us.group.id, "us-f-31-50");
  assert.equal(us.values.iron.ref, "fixture");
});

test("targetsFor returns empty values for an unknown standard or profile", () => {
  for (const [standard, profile] of [
    ["xx", { sex: "male", age: 30 }],
    ["cn2023", { sex: "male", age: 30, lifeStage: "lactation" }],
    ["cn2023", { sex: undefined, age: 30 }],
  ]) {
    const result = targetsFor(driFixture, standard, profile);
    assert.equal(result.group, null, `${standard} / ${JSON.stringify(profile)}`);
    assert.deepEqual(result.values, {});
    assert.deepEqual(result.unitIds, []);
  }
  assert.deepEqual(targetsFor(driFixture, "cn2023").values, {});
  assert.deepEqual(targetsFor(null, "us", { sex: "male", age: 20 }).values, {});
});

test("targetsFor keeps the default life stage when the profile omits it", () => {
  assert.equal(targetsFor(driFixture, "cn2023", { sex: "female", age: 70 }).group.id, "cn-f-65-74");
});

// --- Skeleton table structure (data-src/dri/*.csv) -------------------------
// Only ids and coverage are asserted: the numbers are entered and verified by
// the supervisor in P7b, so no test may depend on a target value.

const DRI_COLUMNS = [
  "standard", "group_id", "sex", "age_min", "age_max", "life_stage",
  "nutrient_id", "target", "target_type", "ul", "ul_applies_to_food",
  "source_ref", "verified_by",
];

async function readTable(name) {
  const text = await readFile(new URL(`../../data-src/dri/${name}.csv`, import.meta.url), "utf8");
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell !== ""));
  const [header, ...body] = rows;
  return { header, rows: body };
}

// Minimal RFC 4180 reader: enough for the DRI tables, and it keeps a quoted
// source_ref or ulNote containing a comma in one cell instead of failing.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const EXPECTED_GROUPS = {
  cn2023: [
    "cn-m-18-29", "cn-m-30-49", "cn-m-50-64", "cn-m-65-74", "cn-m-75-",
    "cn-f-18-29", "cn-f-30-49", "cn-f-50-64", "cn-f-65-74", "cn-f-75-",
  ],
  us: [
    "us-m-14-18", "us-m-19-30", "us-m-31-50", "us-m-51-70", "us-m-71-",
    "us-f-14-18", "us-f-19-30", "us-f-31-50", "us-f-51-70", "us-f-71-",
  ],
};

const NUTRIENT_IDS = [
  "vitA", "vitD", "vitE", "vitK", "vitC", "thiamin", "riboflavin", "niacin",
  "vitB6", "folate", "vitB12", "pantothenic", "choline", "calcium",
  "phosphorus", "potassium", "magnesium", "iron", "zinc", "selenium",
  "copper", "manganese",
];

for (const [standard, expectedGroups] of Object.entries(EXPECTED_GROUPS)) {
  test(`${standard}.csv is a complete 10 x 22 skeleton`, async () => {
    const { header, rows } = await readTable(standard);
    assert.deepEqual(header, DRI_COLUMNS);
    assert.equal(rows.length, expectedGroups.length * NUTRIENT_IDS.length);

    const pairs = new Set();
    for (const row of rows) {
      assert.equal(row.length, DRI_COLUMNS.length, `column count: ${row.join(",")}`);
      const [fileStandard, groupId, , , , , nutrientId, , , , , sourceRef] = row;
      assert.equal(fileStandard, standard);
      assert.ok(expectedGroups.includes(groupId), `unexpected group ${groupId}`);
      assert.ok(NUTRIENT_IDS.includes(nutrientId), `unexpected nutrient ${nutrientId}`);
      assert.ok(sourceRef.length > 0, `empty source_ref in ${groupId}/${nutrientId}`);
      pairs.add(`${groupId}/${nutrientId}`);
    }
    assert.equal(pairs.size, rows.length, "duplicate group/nutrient rows");

    const groups = new Set(rows.map((row) => row[1]));
    assert.deepEqual([...groups].sort(), [...expectedGroups].sort());
  });
}

// P7b fixed checks on the real docs/data/dri.json. These values were
// confirmed by the supervisor against the official sources (CNS DRIs 2023
// tables 9-14 and 20-23; NIH ODS fact sheets) before being added here.
// Only the supervisor may change them.
async function realDri() {
  const url = new URL("../../docs/data/dri.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

function valueOf(dri, standard, sex, age, nutrient) {
  const { values } = targetsFor(dri, standard, { sex, age });
  assert.ok(values[nutrient], `${standard} ${sex} ${age} has no ${nutrient}`);
  return values[nutrient];
}

test("real DRI fixtures: China 2023", async () => {
  const dri = await realDri();
  const ironM = valueOf(dri, "cn2023", "male", 35, "iron");
  assert.equal(ironM.target, 12);
  assert.equal(ironM.ul, 42);
  assert.equal(valueOf(dri, "cn2023", "female", 35, "iron").target, 18);
  assert.equal(valueOf(dri, "cn2023", "male", 35, "vitA").target, 770);
  assert.equal(valueOf(dri, "cn2023", "female", 35, "vitA").target, 660);
  for (const sex of ["male", "female"]) {
    for (const age of [18, 29, 30, 49]) {
      assert.equal(valueOf(dri, "cn2023", sex, age, "calcium").target, 800, `${sex} ${age}`);
    }
  }
});

test("real DRI fixtures: US (NASEM via NIH ODS)", async () => {
  const dri = await realDri();
  assert.equal(valueOf(dri, "us", "male", 40, "iron").target, 8);
  assert.equal(valueOf(dri, "us", "female", 40, "iron").target, 18);
  for (const sex of ["male", "female"]) {
    for (const age of [19, 30, 31, 50]) {
      assert.equal(valueOf(dri, "us", sex, age, "calcium").target, 1000, `${sex} ${age}`);
    }
    for (const age of [19, 40, 60, 70]) {
      assert.equal(valueOf(dri, "us", sex, age, "vitD").target, 15, `${sex} ${age}`);
    }
  }
  assert.equal(valueOf(dri, "us", "male", 40, "vitC").target, 90);
  assert.equal(valueOf(dri, "us", "female", 40, "vitC").target, 75);
});

test("every real DRI row is verified and sourced", async () => {
  const dri = await realDri();
  for (const [key, standard] of Object.entries(dri.standards)) {
    for (const group of standard.groups) {
      for (const [nutrient, value] of Object.entries(group.values)) {
        assert.ok(Number.isFinite(value.target) && value.target > 0, `${key} ${group.id} ${nutrient}`);
        assert.ok(value.ref && value.ref.length > 0, `${key} ${group.id} ${nutrient} ref`);
      }
    }
  }
});
