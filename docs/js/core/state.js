// State model, pure reducers and localStorage persistence (PLAN.md 1.5,
// phase P8).
//
// Pure ES module: no DOM access and no direct localStorage access. The UI
// passes the real `localStorage` in, tests pass a fake object with
// getItem/setItem, so the module stays importable from node --test.
//
// State shape (localStorage key "mnt.state.v1"):
//   { version: 1,
//     profile: { sex: "female"|"male", age: 30, lifeStage: "none" },
//     standard: "cn2023"|"us",
//     activeNutrient: "vitA",
//     selections: { "fdc:167862": { measureId: "piece", count: 0.5,
//                                    grams: 50 } } }
//
// Every reducer returns a new state object and never mutates its input.
// `selections` is global (keyed by food id, not by nutrient group), which is
// what makes the tabs stay in sync.
//
// Only pure helpers are imported: `dri.js` for the age clamp and `measures.js`
// for the measure maths. Storage is always passed in by the caller.

import { clampAge, DEFAULT_LIFE_STAGE } from "./dri.js";
import { GRAMS_MEASURE_ID, clampCount, defaultMeasure, roundGrams, normalizeSelection } from "./measures.js";

/** localStorage key (PLAN.md 1.5). */
export const STORAGE_KEY = "mnt.state.v1";

/** Schema version; a stored state with another version is discarded. */
export const VERSION = 1;

/** Supported reference standards. */
export const STANDARDS = Object.freeze(["cn2023", "us"]);

/** Supported sexes. */
export const SEXES = Object.freeze(["female", "male"]);

/** Default quantity when a food has no usable measure row: its 100 g basis. */
export const FALLBACK_GRAMS = 100;

/**
 * Default state (PLAN.md 1.5): female, 30, CN 2023, vitamin A, no selections.
 *
 * @returns {{version: number, profile: {sex: string, age: number, lifeStage: string},
 *   standard: string, activeNutrient: string, selections: Record<string, object>}}
 */
export function defaultState() {
  return {
    version: VERSION,
    profile: { sex: "female", age: 30, lifeStage: DEFAULT_LIFE_STAGE },
    standard: "cn2023",
    activeNutrient: "vitA",
    selections: {},
  };
}

/**
 * Sanitise a sex value.
 *
 * @param {*} sex
 * @param {string} [fallback] used when the value is not supported
 * @returns {string} "female" or "male"
 */
export function sanitizeSex(sex, fallback = "female") {
  return SEXES.includes(sex) ? sex : fallback;
}

/**
 * Sanitise a standard key.
 *
 * @param {*} standard
 * @param {string} [fallback] used when the value is not supported
 * @returns {string} "cn2023" or "us"
 */
export function sanitizeStandard(standard, fallback = "cn2023") {
  return STANDARDS.includes(standard) ? standard : fallback;
}

/**
 * Sanitise one stored selection.
 *
 * `null` / non-objects are dropped. Numbers are clamped to >= 0 and grams are
 * rounded to 0.1 g. A selection without a usable `grams` still gets one from
 * count x measure grams when the measure is known, otherwise 0.
 *
 * @param {*} selection stored value
 * @returns {{measureId: string, count: number, grams: number}|null}
 */
export function sanitizeSelection(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return null;

  const measureId = typeof selection.measureId === "string" && selection.measureId
    ? selection.measureId
    : GRAMS_MEASURE_ID;
  const count = clampCount(selection.count);
  const rawGrams = Number(selection.grams);
  const grams = Number.isFinite(rawGrams) && rawGrams > 0 ? roundGrams(rawGrams) : 0;

  return { measureId, count, grams };
}

/**
 * Sanitise a whole selections map.
 *
 * @param {*} selections
 * @returns {Record<string, {measureId: string, count: number, grams: number}>}
 */
export function sanitizeSelections(selections) {
  /** @type {Record<string, object>} */
  const clean = {};
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return clean;
  for (const [foodId, selection] of Object.entries(selections)) {
    if (typeof foodId !== "string" || !foodId) continue;
    const value = sanitizeSelection(selection);
    if (value) clean[foodId] = value;
  }
  return clean;
}

/**
 * Turn any candidate object into a valid state.
 *
 * Used by `load` and by the reducers so a corrupt or partial object can never
 * break the UI: unknown sexes/standards fall back to the defaults, the age is
 * clamped to 18..100 (dri.js) and every selection is sanitised.
 *
 * @param {*} candidate parsed JSON or partial state
 * @returns {object} a fresh valid state
 */
export function normalizeState(candidate) {
  const base = defaultState();
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return base;

  const profile = candidate.profile && typeof candidate.profile === "object" ? candidate.profile : {};
  const activeNutrient = typeof candidate.activeNutrient === "string" && candidate.activeNutrient
    ? candidate.activeNutrient
    : base.activeNutrient;

  return {
    version: VERSION,
    profile: {
      sex: sanitizeSex(profile.sex, base.profile.sex),
      age: clampAge(profile.age === undefined ? base.profile.age : profile.age),
      lifeStage: typeof profile.lifeStage === "string" && profile.lifeStage
        ? profile.lifeStage
        : DEFAULT_LIFE_STAGE,
    },
    standard: sanitizeStandard(candidate.standard, base.standard),
    activeNutrient,
    selections: sanitizeSelections(candidate.selections),
  };
}

/**
 * Whether a food id is currently selected.
 *
 * @param {object} state
 * @param {string} foodId e.g. "fdc:167862"
 * @returns {boolean}
 */
export function isSelected(state, foodId) {
  return Boolean(state?.selections && typeof foodId === "string" && state.selections[foodId]);
}

/**
 * Selected food ids in insertion order.
 *
 * @param {object} state
 * @returns {string[]}
 */
export function selectedFoodIds(state) {
  return state?.selections ? Object.keys(state.selections) : [];
}

/**
 * Add a food with its default measure x1, or remove it when already selected
 * (PLAN.md 1.5). A food without any measure row is added as 100 g.
 *
 * @param {object} state
 * @param {{id: string, measures?: Array<object>}} food
 * @returns {object} new state (the same object when `food` is unusable)
 */
export function toggleFood(state, food) {
  const current = normalizeState(state);
  const foodId = food && typeof food === "object" ? food.id : null;
  if (typeof foodId !== "string" || !foodId) return state;

  const selections = { ...current.selections };
  if (selections[foodId]) {
    delete selections[foodId];
  } else {
    const measure = defaultMeasure(food);
    selections[foodId] = measure
      ? { measureId: measure.id, count: 1, grams: roundGrams(measure.grams) }
      : { measureId: GRAMS_MEASURE_ID, count: 0, grams: FALLBACK_GRAMS };
  }
  return { ...current, selections };
}

/**
 * Set (replace) the quantity of an already selected food.
 *
 * Accepted quantities:
 *   { grams: 50 }                       manual grams
 *   { measureId: "piece", count: 1.5 }  household measure x count
 *
 * The food is passed as the 4th argument so count x measure grams can be
 * resolved exactly (measures.js). Without it, a count change is scaled by the
 * existing grams-per-unit ratio, and an unknown food/measure keeps 0 g.
 *
 * A quantity of `null` removes the selection; a selection that was never added
 * is added by this call (the UI can then skip toggleFood).
 *
 * @param {object} state
 * @param {string} foodId
 * @param {{measureId?: string, count?: number, grams?: number|null}|null} quantity
 * @param {{id?: string, measures?: Array<object>}} [food] optional food record
 * @returns {object} new state
 */
export function setQuantity(state, foodId, quantity, food) {
  const current = normalizeState(state);
  if (typeof foodId !== "string" || !foodId) return state;

  const selections = { ...current.selections };

  if (quantity === null || quantity === undefined) {
    delete selections[foodId];
    return { ...current, selections };
  }
  if (typeof quantity !== "object") return state;

  const existing = selections[foodId];

  if (food && typeof food === "object") {
    selections[foodId] = normalizeSelection(food, quantity);
    return { ...current, selections };
  }

  const measureId = typeof quantity.measureId === "string" && quantity.measureId
    ? quantity.measureId
    : existing?.measureId ?? GRAMS_MEASURE_ID;
  const count = quantity.count === undefined
    ? (existing && existing.measureId === measureId ? existing.count : 0)
    : clampCount(quantity.count);

  const rawGrams = quantity.grams;
  let grams;
  if (rawGrams !== null && rawGrams !== undefined && Number.isFinite(Number(rawGrams))) {
    // Manual gram input is authoritative.
    grams = roundGrams(rawGrams);
  } else if (existing && existing.measureId === measureId && existing.count > 0) {
    // Same measure: scale the grams-per-unit of the current selection.
    grams = roundGrams((existing.grams / existing.count) * count);
  } else {
    // A different measure needs the food record to know its gram weight; the
    // UI always passes it, so this only keeps a bare call from inventing one.
    grams = existing?.grams ?? 0;
  }

  selections[foodId] = { measureId, count, grams };
  return { ...current, selections };
}

/**
 * Merge a profile change (sex, age, life stage), sanitising every field.
 *
 * @param {object} state
 * @param {{sex?: string, age?: number|string, lifeStage?: string}} profile
 * @returns {object} new state
 */
export function setProfile(state, profile) {
  const current = normalizeState(state);
  if (!profile || typeof profile !== "object") return current;
  return {
    ...current,
    profile: {
      sex: profile.sex === undefined ? current.profile.sex : sanitizeSex(profile.sex, current.profile.sex),
      age: profile.age === undefined ? current.profile.age : clampAge(profile.age),
      lifeStage: typeof profile.lifeStage === "string" && profile.lifeStage
        ? profile.lifeStage
        : current.profile.lifeStage,
    },
  };
}

/**
 * Switch the reference standard.
 *
 * @param {object} state
 * @param {"cn2023"|"us"} standard unknown values leave the state unchanged
 * @returns {object} new state
 */
export function setStandard(state, standard) {
  const current = normalizeState(state);
  if (!STANDARDS.includes(standard)) return current;
  return { ...current, standard };
}

/**
 * Switch the active nutrient tab. The selections are untouched, so every tab
 * keeps the same foods (PLAN.md 1.5).
 *
 * @param {object} state
 * @param {string} nutrientId
 * @returns {object} new state
 */
export function setActiveNutrient(state, nutrientId) {
  const current = normalizeState(state);
  if (typeof nutrientId !== "string" || !nutrientId) return current;
  return { ...current, activeNutrient: nutrientId };
}

/**
 * Clear every selection (the About section's "clear all" button).
 *
 * Profile, standard and active tab are kept: clearing the food list should not
 * silently change the user's reference values. Use `defaultState()` for a full
 * reset.
 *
 * @param {object} state
 * @returns {object} new state with `selections: {}`
 */
export function clearAll(state) {
  const current = normalizeState(state);
  return { ...current, selections: {} };
}

/**
 * Apply a reducer by name, for event handlers that only know a string.
 *
 * @param {object} state
 * @param {string} action one of TOGGLE_FOOD/SET_QUANTITY/SET_PROFILE/
 *   SET_STANDARD/SET_ACTIVE_NUTRIENT/CLEAR_ALL
 * @param {*} payload
 * @returns {object} new state, unchanged for unknown actions
 */
export function reduce(state, action, payload) {
  switch (action) {
    case "toggleFood":
      return toggleFood(state, payload);
    case "setQuantity":
      return setQuantity(state, payload?.foodId, payload?.quantity, payload?.food);
    case "setProfile":
      return setProfile(state, payload);
    case "setStandard":
      return setStandard(state, payload);
    case "setActiveNutrient":
      return setActiveNutrient(state, payload);
    case "clearAll":
      return clearAll(state);
    default:
      return state;
  }
}

/**
 * Save the state as JSON. Never throws: a missing storage object, a quota error
 * or a private-mode `setItem` that throws all return false.
 *
 * @param {object} state
 * @param {{setItem?: Function}|null|undefined} storage e.g. localStorage
 * @returns {boolean} whether the write succeeded
 */
export function save(state, storage) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the state, falling back to the default state for anything unusable
 * (missing key, corrupt JSON, another version, wrong types). Never throws.
 *
 * @param {{getItem?: Function}|null|undefined} storage e.g. localStorage
 * @returns {object} a valid state
 */
export function load(storage) {
  if (!storage || typeof storage.getItem !== "function") return defaultState();
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultState();
  }
  if (typeof raw !== "string" || !raw.trim()) return defaultState();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultState();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultState();
  if (parsed.version !== undefined && parsed.version !== VERSION) return defaultState();
  return normalizeState(parsed);
}

/**
 * Remove the stored state.
 *
 * @param {{removeItem?: Function}|null|undefined} storage
 * @returns {boolean} whether a removal was attempted and did not throw
 */
export function clearStorage(storage) {
  if (!storage || typeof storage.removeItem !== "function") return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export default {
  STORAGE_KEY,
  VERSION,
  STANDARDS,
  SEXES,
  FALLBACK_GRAMS,
  defaultState,
  sanitizeSex,
  sanitizeStandard,
  sanitizeSelection,
  sanitizeSelections,
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
};
