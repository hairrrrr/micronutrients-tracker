// Nutrient metadata helpers (PLAN.md 1.2 and phase P8).
//
// Pure ES module: no DOM, no fetch, no imports. The UI passes the
// `nutrients.json` payload (or just its `nutrients` array) in, so node --test
// can use tiny fixtures instead of the real data.
//
// Data shape (docs/data/nutrients.json, built by tools/build_foods.py):
//   { source: {...}, nutrients: [
//       { id: "vitA", nameZh: "维生素A", nameEn: "Vitamin A", unit: "ug RAE",
//         usdaNutrientIds: [1106], color: "#f3daba", kind: "vitamin",
//         note: "..." } ] }

/**
 * The single "met" green from PLAN.md 1.2. No nutrient may use it as its
 * color, so a card turning green always means "target reached".
 */
export const MET_COLORS = Object.freeze({
  background: "#c8f2d0",
  border: "#145c2a",
  text: "#145c2a",
});

/** Fallback color when a nutrient is unknown or its color is missing. */
export const FALLBACK_COLOR = "#e9ecef";

/** Unit used when metadata is missing; amounts are still shown unit-less. */
export const FALLBACK_UNIT = "";

const KINDS = ["vitamin", "mineral"];

/**
 * Normalise the two accepted inputs (payload object or bare array) to an array.
 *
 * @param {{nutrients?: Array<object>}|Array<object>|null|undefined} nutrients
 * @returns {Array<object>} nutrient metadata objects, possibly empty
 */
export function nutrientList(nutrients) {
  if (Array.isArray(nutrients)) return nutrients.filter(Boolean);
  if (nutrients && Array.isArray(nutrients.nutrients)) {
    return nutrients.nutrients.filter(Boolean);
  }
  return [];
}

/**
 * Nutrient ids in data order (the order the tabs and cards use).
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @returns {string[]} nutrient ids
 */
export function nutrientIds(nutrients) {
  return nutrientList(nutrients)
    .map((nutrient) => nutrient.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * Index nutrient metadata by id.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @returns {Map<string, object>} id -> metadata, in data order
 */
export function nutrientIndex(nutrients) {
  const index = new Map();
  for (const nutrient of nutrientList(nutrients)) {
    if (typeof nutrient.id === "string" && nutrient.id && !index.has(nutrient.id)) {
      index.set(nutrient.id, nutrient);
    }
  }
  return index;
}

/**
 * One nutrient's metadata.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @param {string} id e.g. "vitA"
 * @returns {object|null} metadata or null when unknown
 */
export function getNutrient(nutrients, id) {
  if (typeof id !== "string" || !id) return null;
  return nutrientIndex(nutrients).get(id) ?? null;
}

/** @returns {boolean} true when the id is a known nutrient */
export function isKnownNutrient(nutrients, id) {
  return getNutrient(nutrients, id) !== null;
}

/**
 * Display unit of a nutrient, e.g. "mg NE" for niacin.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @param {string} id nutrient id
 * @param {string} [fallback] returned when the nutrient has no unit
 * @returns {string}
 */
export function unitOf(nutrients, id, fallback = FALLBACK_UNIT) {
  const unit = getNutrient(nutrients, id)?.unit;
  return typeof unit === "string" && unit ? unit : fallback;
}

/**
 * Chinese UI name of a nutrient.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @param {string} id nutrient id
 * @param {string} [fallback] returned for an unknown nutrient
 * @returns {string}
 */
export function nameZhOf(nutrients, id, fallback = "") {
  const name = getNutrient(nutrients, id)?.nameZh;
  return typeof name === "string" && name ? name : fallback || String(id ?? "");
}

/**
 * English name of a nutrient (shown small under the Chinese name).
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @param {string} id nutrient id
 * @returns {string} the English name, or "" when unknown
 */
export function nameEnOf(nutrients, id) {
  const name = getNutrient(nutrients, id)?.nameEn;
  return typeof name === "string" ? name : "";
}

/**
 * Card / chip background color of a nutrient.
 *
 * Never returns the "met" green: an unknown nutrient or a nutrient whose color
 * happens to be the met green falls back to a neutral grey.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @param {string} id nutrient id
 * @returns {string} "#rrggbb"
 */
export function colorOf(nutrients, id) {
  const color = getNutrient(nutrients, id)?.color;
  if (typeof color !== "string") return FALLBACK_COLOR;
  const value = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(value)) return FALLBACK_COLOR;
  if (value === MET_COLORS.background) return FALLBACK_COLOR;
  return value;
}

/**
 * Split the nutrients into the two groups the About/tabs sections use.
 *
 * Unknown `kind` values are ignored by both groups; they stay reachable through
 * `nutrientList`.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @returns {{vitamins: object[], minerals: object[]}}
 */
export function byKind(nutrients) {
  const list = nutrientList(nutrients);
  return {
    vitamins: list.filter((nutrient) => nutrient.kind === KINDS[0]),
    minerals: list.filter((nutrient) => nutrient.kind === KINDS[1]),
  };
}

/**
 * Backing card style for a nutrient: its color, or the met green when the
 * target is reached (PLAN.md 1.8 item 3).
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients
 * @param {string} id nutrient id
 * @param {boolean} met whether the intake reached the target
 * @returns {{background: string, border: string, text: string}}
 */
export function cardColors(nutrients, id, met) {
  if (met) {
    return {
      background: MET_COLORS.background,
      border: MET_COLORS.border,
      text: MET_COLORS.text,
    };
  }
  return {
    background: colorOf(nutrients, id),
    border: "transparent",
    text: "#1f2328",
  };
}

export default {
  MET_COLORS,
  FALLBACK_COLOR,
  FALLBACK_UNIT,
  nutrientList,
  nutrientIds,
  nutrientIndex,
  getNutrient,
  isKnownNutrient,
  unitOf,
  nameZhOf,
  nameEnOf,
  colorOf,
  byKind,
  cardColors,
};
