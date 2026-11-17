// State model, reducers and persistence (PLAN.md 1.5, phase P8).
//
// The storage is a fake object driven by these tests, so nothing here touches
// a real browser storage.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_KEY,
  VERSION,
  defaultState,
  sanitizeSex,
  sanitizeStandard,
  sanitizeSelection,
  normalizeState,
  isSelected,
  selectedFoodIds,
  toggleFood,
  setQuantity,
  setProfile,
  setStandard,
  setActiveNutrient,
  clearAll,
  reduce,
  save,
  load,
  clearStorage,
} from "../../docs/js/core/state.js";

const EGG = {
  id: "fdc:egg",
  nameZh: "鸡蛋",
  measures: [
    { id: "piece", labelZh: "一个", grams: 50, basis: "estimate:one egg", default: true },
    { id: "cup", labelZh: "一杯", grams: 243, basis: "usda_portion:1", default: false },
  ],
};

const LIVER = {
  id: "fdc:liver",
  nameZh: "猪肝",
  measures: [{ id: "usda1", labelZh: "一片", grams: 30, basis: "usda_portion:1", default: true }],
};

const BARE = { id: "fdc:bare", nameZh: "无份量食物", measures: [] };

/** Minimal in-memory storage with the two methods state.js uses. */
function fakeStorage(initial) {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    size() {
      return data.size;
    },
  };
}

test("default state is female, 30, cn2023, vitA and empty", () => {
  const state = defaultState();
  assert.deepEqual(state, {
    version: 1,
    profile: { sex: "female", age: 30, lifeStage: "none" },
    standard: "cn2023",
    activeNutrient: "vitA",
    selections: {},
  });
  assert.equal(VERSION, 1);
  assert.equal(STORAGE_KEY, "mnt.state.v1");
});

test("toggleFood adds the default measure x1", () => {
  const state = toggleFood(defaultState(), EGG);
  assert.deepEqual(state.selections["fdc:egg"], { measureId: "piece", count: 1, grams: 50 });
  assert.equal(isSelected(state, "fdc:egg"), true);
  assert.deepEqual(selectedFoodIds(state), ["fdc:egg"]);
});

test("toggling the same food a second time removes it", () => {
  const added = toggleFood(defaultState(), EGG);
  const removed = toggleFood(added, EGG);
  assert.deepEqual(removed.selections, {});
  assert.equal(isSelected(removed, "fdc:egg"), false);
  // The input state is never mutated (reducers are pure).
  assert.deepEqual(added.selections["fdc:egg"], { measureId: "piece", count: 1, grams: 50 });
  assert.notEqual(added, removed);
});

test("toggleFood falls back to 100 g when a food has no measure row", () => {
  const state = toggleFood(defaultState(), BARE);
  assert.deepEqual(state.selections["fdc:bare"], { measureId: "grams", count: 0, grams: 100 });
  // Usable food ids are required; broken input returns the state unchanged.
  assert.deepEqual(toggleFood(defaultState(), null).selections, {});
  assert.deepEqual(toggleFood(defaultState(), { nameZh: "无 id" }).selections, {});
});

test("setQuantity with a household measure sets count and grams", () => {
  const state = setQuantity(defaultState(), "fdc:egg", { measureId: "piece", count: 2 }, EGG);
  assert.deepEqual(state.selections["fdc:egg"], { measureId: "piece", count: 2, grams: 100 });
  const half = setQuantity(state, "fdc:egg", { measureId: "cup", count: 0.5 }, EGG);
  assert.deepEqual(half.selections["fdc:egg"], { measureId: "cup", count: 0.5, grams: 121.5 });
});

test("setQuantity with manual grams overrides count", () => {
  const state = setQuantity(defaultState(), "fdc:egg", { grams: 33.33 }, EGG);
  assert.deepEqual(state.selections["fdc:egg"], { measureId: "grams", count: 0, grams: 33.3 });
  const zero = setQuantity(defaultState(), "fdc:egg", { measureId: "piece", count: 3, grams: 0 }, EGG);
  assert.equal(zero.selections["fdc:egg"].grams, 0);
  const negative = setQuantity(defaultState(), "fdc:egg", { grams: -10 }, EGG);
  assert.equal(negative.selections["fdc:egg"].grams, 0);
});

test("setQuantity works without the food record (scales the previous grams)", () => {
  const base = toggleFood(defaultState(), EGG);
  const doubled = setQuantity(base, "fdc:egg", { measureId: "piece", count: 2 });
  assert.deepEqual(doubled.selections["fdc:egg"], { measureId: "piece", count: 2, grams: 100 });
  const manual = setQuantity(base, "fdc:egg", { grams: 80 });
  assert.deepEqual(manual.selections["fdc:egg"], { measureId: "piece", count: 1, grams: 80 });
  // A quantity of null removes the food.
  const removed = setQuantity(base, "fdc:egg", null);
  assert.deepEqual(removed.selections, {});
  // Unknown food id is added, broken ids are ignored.
  assert.equal(setQuantity(defaultState(), "fdc:new", { grams: 20 }).selections["fdc:new"].grams, 20);
  assert.deepEqual(setQuantity(defaultState(), "", { grams: 20 }).selections, {});
});

test("selections persist when the active nutrient changes (cross-tab sync)", () => {
  let state = toggleFood(defaultState(), EGG);
  state = toggleFood(state, LIVER);
  state = setQuantity(state, "fdc:egg", { measureId: "piece", count: 0.5 }, EGG);
  const before = state.selections;

  const switched = setActiveNutrient(state, "vitB12");
  assert.equal(switched.activeNutrient, "vitB12");
  assert.deepEqual(switched.selections, before);
  // Switching back keeps the same selections too.
  assert.deepEqual(setActiveNutrient(switched, "vitA").selections, before);
  // A broken nutrient id leaves the state unchanged.
  assert.equal(setActiveNutrient(state, "").activeNutrient, "vitA");
});

test("setProfile and setStandard validate their input", () => {
  const male = setProfile(defaultState(), { sex: "male", age: 35 });
  assert.deepEqual(male.profile, { sex: "male", age: 35, lifeStage: "none" });
  // Age is clamped to the covered adult range, an unknown sex keeps the old one.
  assert.equal(setProfile(defaultState(), { age: 5 }).profile.age, 18);
  assert.equal(setProfile(defaultState(), { age: 130 }).profile.age, 100);
  assert.equal(setProfile(defaultState(), { sex: "其他" }).profile.sex, "female");
  // A partial update keeps the other fields.
  assert.equal(setProfile(male, { age: 40 }).profile.sex, "male");

  assert.equal(setStandard(defaultState(), "us").standard, "us");
  assert.equal(setStandard(defaultState(), "uk").standard, "cn2023");
  assert.equal(sanitizeSex("male"), "male");
  assert.equal(sanitizeSex("x"), "female");
  assert.equal(sanitizeStandard("us"), "us");
  assert.equal(sanitizeStandard("x"), "cn2023");
});

test("clearAll removes selections but keeps profile and standard", () => {
  let state = setProfile(defaultState(), { sex: "male", age: 50 });
  state = setStandard(state, "us");
  state = toggleFood(state, EGG);
  const cleared = clearAll(state);
  assert.deepEqual(cleared.selections, {});
  assert.deepEqual(cleared.profile, { sex: "male", age: 50, lifeStage: "none" });
  assert.equal(cleared.standard, "us");
});

test("save/load round trip through a fake storage", () => {
  const storage = fakeStorage();
  let state = setProfile(defaultState(), { sex: "male", age: 42 });
  state = setStandard(state, "us");
  state = setActiveNutrient(state, "iron");
  state = toggleFood(state, EGG);
  state = setQuantity(state, "fdc:egg", { measureId: "cup", count: 1.5 }, EGG);
  state = toggleFood(state, LIVER);

  assert.equal(save(state, storage), true);
  assert.equal(typeof storage.getItem(STORAGE_KEY), "string");

  const loaded = load(storage);
  assert.deepEqual(loaded, state);
  // The loaded object is a fresh copy, not shared with the saved one.
  assert.notEqual(loaded, state);
  assert.notEqual(loaded.selections, state.selections);
});

test("save/load keeps the selection fields intact (measureId, count, grams)", () => {
  const storage = fakeStorage();
  const state = setQuantity(defaultState(), "fdc:egg", { measureId: "piece", count: 0.5 }, EGG);
  save(state, storage);
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(stored.selections["fdc:egg"], { measureId: "piece", count: 0.5, grams: 25 });
  assert.deepEqual(load(storage).selections["fdc:egg"], { measureId: "piece", count: 0.5, grams: 25 });
});

test("corrupt or unusable stored JSON falls back to the default state", () => {
  const cases = [
    "{not json",
    "",
    "   ",
    "null",
    "[]",
    '"a string"',
    "42",
    JSON.stringify({ version: 99, selections: { "fdc:egg": { grams: 50 } } }),
  ];
  for (const raw of cases) {
    const storage = fakeStorage({ [STORAGE_KEY]: raw });
    assert.deepEqual(load(storage), defaultState(), `failed for ${JSON.stringify(raw)}`);
  }
  // No storage at all, or a storage that throws, is handled too.
  assert.deepEqual(load(null), defaultState());
  assert.deepEqual(load(undefined), defaultState());
  assert.deepEqual(load({}), defaultState());
  assert.deepEqual(
    load({ getItem() { throw new Error("denied"); } }),
    defaultState(),
  );
  // save() never throws when storage is missing or full.
  assert.equal(save(defaultState(), null), false);
  assert.equal(save(defaultState(), {}), false);
  assert.equal(save(defaultState(), { setItem() { throw new Error("quota"); } }), false);
});

test("load repairs a partially valid stored state instead of crashing", () => {
  const storage = fakeStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      profile: { sex: "male", age: "37", lifeStage: "none" },
      standard: "us",
      activeNutrient: "calcium",
      selections: {
        "fdc:egg": { measureId: "piece", count: 2, grams: 100 },
        "fdc:bad": "not an object",
        "fdc:negative": { measureId: "piece", count: -3, grams: -5 },
      },
    }),
  });
  const state = load(storage);
  assert.deepEqual(state.profile, { sex: "male", age: 37, lifeStage: "none" });
  assert.equal(state.standard, "us");
  assert.equal(state.activeNutrient, "calcium");
  assert.deepEqual(Object.keys(state.selections).sort(), ["fdc:egg", "fdc:negative"]);
  assert.deepEqual(state.selections["fdc:egg"], { measureId: "piece", count: 2, grams: 100 });
  assert.deepEqual(state.selections["fdc:negative"], { measureId: "piece", count: 0, grams: 0 });
  // A missing profile/standard/activeNutrient is filled with the defaults.
  const bare = mockParse("{\"version\":1}");
  assert.deepEqual(bare.profile, defaultState().profile);
  assert.equal(bare.standard, "cn2023");
  assert.equal(bare.activeNutrient, "vitA");
});

/** Helper: run a JSON string through load() with a one-entry fake storage. */
function mockParse(json) {
  return load(fakeStorage({ [STORAGE_KEY]: json }));
}

test("normalizeState and sanitize helpers are defensive", () => {
  assert.deepEqual(normalizeState(null), defaultState());
  assert.deepEqual(normalizeState([1, 2]), defaultState());
  assert.deepEqual(normalizeState("x"), defaultState());
  // A lying version field is rewritten to the current version.
  assert.equal(normalizeState({ version: 7 }).version, VERSION);
  assert.equal(sanitizeSelection("nope"), null);
  assert.equal(sanitizeSelection([]), null);
  assert.deepEqual(sanitizeSelection({ grams: "12.34" }), { measureId: "grams", count: 0, grams: 12.3 });
  // Unknown version numbers are not preserved.
  assert.equal(normalizeState({ activeNutrient: 5 }).activeNutrient, "vitA");
});

test("reduce dispatches every action and ignores unknown ones", () => {
  let state = reduce(defaultState(), "toggleFood", EGG);
  assert.equal(isSelected(state, "fdc:egg"), true);
  state = reduce(state, "setQuantity", { foodId: "fdc:egg", quantity: { measureId: "piece", count: 3 }, food: EGG });
  assert.equal(state.selections["fdc:egg"].grams, 150);
  state = reduce(state, "setActiveNutrient", "zinc");
  assert.equal(state.activeNutrient, "zinc");
  state = reduce(state, "setProfile", { age: 66 });
  assert.equal(state.profile.age, 66);
  state = reduce(state, "setStandard", "us");
  assert.equal(state.standard, "us");
  state = reduce(state, "clearAll");
  assert.deepEqual(state.selections, {});
  // Unknown action -> same object, no mutation.
  const untouched = reduce(state, "nope", null);
  assert.equal(untouched, state);
});

test("clearStorage removes the stored key and tolerates a broken storage", () => {
  const storage = fakeStorage({ [STORAGE_KEY]: "{}" });
  assert.equal(clearStorage(storage), true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(load(storage), defaultState());
  assert.equal(clearStorage(null), false);
  assert.equal(clearStorage({ removeItem() { throw new Error("x"); } }), false);
});
