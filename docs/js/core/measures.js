// Household measure -> grams conversion (PLAN.md 1.3 measures.csv, 1.5, 1.8
// item 5; phase P8).
//
// Pure ES module: no DOM access, no imports. Every food carries
//
//   measures: [{ id, labelZh, grams, basis, default }]
//
// and the UI additionally offers a free "grams" option, which is handled here
// by `GRAMS_MEASURE_ID` instead of a real measure row.
//
// Bone-in foods (phase P20): a bone-in food carries `refusePct` because the
// SR Legacy nutrient values are per 100 g of EDIBLE portion, while the
// household measures and the gram input of such a food mean the weight WITH
// the bone. The helpers here keep the two weights apart:
//
//   gramsForSelection()  -> with-bone grams of a selection
//   edibleGrams()        -> grams * (1 - refusePct/100), what the nutrients use
//   formatEdibleGrams()  -> "可食部约 70 g" for the card and the editor
//
// A food without `refusePct` has a factor of exactly 1, so nothing about the
// ordinary foods changes.

/** Pseudo measure id for the manual gram input (not a row in the data). */
export const GRAMS_MEASURE_ID = "grams";

/** Chinese label of the manual gram input. */
export const GRAMS_LABEL_ZH = "克";

/** Label of a with-bone weight (P20): grams and household measures include bone. */
export const WITH_BONE_LABEL = "带骨重量";

/** Count step of the stepper (PLAN.md 1.8 item 5). */
export const COUNT_STEP = 0.5;

/** Grams are rounded to this many decimals to hide float noise. */
const GRAMS_DECIMALS = 1;

/**
 * Sanitise grams: finite, never negative, rounded to 0.1 g.
 *
 * @param {*} value
 * @returns {number} grams >= 0
 */
export function roundGrams(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  const factor = 10 ** GRAMS_DECIMALS;
  return Math.round(number * factor) / factor;
}

/**
 * USDA refuse percentage of a food (P20): 0 for every ordinary food.
 *
 * Bone-in foods carry `refusePct` because their nutrient values are per 100 g
 * of edible portion while people weigh the cut with the bone. An unusable
 * value (missing, negative, >= 100) means "no refuse" so old data and test
 * fixtures behave as before.
 *
 * @param {{refusePct?: number}|null|undefined} food
 * @returns {number} 0..99
 */
export function refusePctOf(food) {
  const value = Number(food?.refusePct);
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return 0;
  return value;
}

/**
 * Share of a with-bone weight that is edible: 1 - refusePct/100 (P20).
 *
 * @param {{refusePct?: number}|null|undefined} food
 * @returns {number} 0..1, exactly 1 for a food without refuse
 */
export function edibleFactor(food) {
  return 1 - refusePctOf(food) / 100;
}

/**
 * Edible grams of a weighed amount (P20).
 *
 * The household measures and the gram input of a bone-in food mean the weight
 * WITH bone, so the nutrients are multiplied by `edibleGrams`, never by the
 * weighed grams. Every other food is unaffected (factor 1).
 *
 * @param {{refusePct?: number}|null|undefined} food
 * @param {number|null|undefined} grams weighed with-bone grams
 * @returns {number} edible grams >= 0, rounded to 0.1 g
 */
export function edibleGrams(food, grams) {
  return roundGrams(roundGrams(grams) * edibleFactor(food));
}

/**
 * Whether a weighed amount of this food includes bone that is not eaten.
 *
 * @param {{refusePct?: number}|null|undefined} food
 * @returns {boolean}
 */
export function isBoneIn(food) {
  return refusePctOf(food) > 0;
}

/**
 * Chinese text of the edible part of a weighed amount, e.g. "可食部约 70 g".
 *
 * @param {{refusePct?: number}|null|undefined} food
 * @param {number|null|undefined} grams weighed with-bone grams
 * @returns {string} empty string for a food without refuse
 */
export function formatEdibleGrams(food, grams) {
  if (!isBoneIn(food)) return "";
  const edible = edibleGrams(food, grams);
  const text = Number.isInteger(edible) ? String(edible) : edible.toFixed(GRAMS_DECIMALS).replace(/\.?0+$/, "");
  return `可食部约 ${text} g`;
}

/**
 * Sanitise a count: finite, never negative (0 or negative -> 0).
 *
 * @param {*} count
 * @returns {number} count >= 0
 */
export function clampCount(count) {
  const number = Number(count);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number;
}

/**
 * Usable measures of a food (rows with a positive gram weight).
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @returns {Array<object>} measures in data order, possibly empty
 */
export function measuresOf(food) {
  const list = Array.isArray(food?.measures) ? food.measures : [];
  return list.filter((measure) => measure && typeof measure === "object" && roundGrams(measure.grams) > 0);
}

/**
 * Find one measure by id.
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @param {string} measureId
 * @returns {object|null} the measure, or null (also for "grams")
 */
export function findMeasure(food, measureId) {
  if (typeof measureId !== "string" || !measureId || measureId === GRAMS_MEASURE_ID) return null;
  return measuresOf(food).find((measure) => measure.id === measureId) ?? null;
}

/**
 * The measure a fresh selection starts with: the row flagged `default: true`,
 * otherwise the first usable measure (data order).
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @returns {object|null} the default measure, or null when the food has none
 */
export function defaultMeasure(food) {
  const list = measuresOf(food);
  if (list.length === 0) return null;
  return list.find((measure) => measure.default === true) ?? list[0];
}

/**
 * Gram weight of one unit of a measure.
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @param {string} measureId
 * @returns {number} grams, 0 when the measure is unknown
 */
export function measureGrams(food, measureId) {
  return roundGrams(findMeasure(food, measureId)?.grams);
}

/**
 * Options for the measure select: the food's measures plus the manual "grams"
 * entry. Labels are Chinese; the manual entry carries `grams: null` because the
 * amount comes from the gram input.
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @returns {Array<{id: string, labelZh: string, grams: number|null}>}
 */
export function measureOptions(food) {
  const options = measuresOf(food).map((measure) => ({
    id: measure.id,
    labelZh: measure.labelZh,
    grams: roundGrams(measure.grams),
  }));
  options.push({ id: GRAMS_MEASURE_ID, labelZh: GRAMS_LABEL_ZH, grams: null });
  return options;
}

/**
 * Grams for `count` units of one measure.
 *
 * A count of 0 or less, an unknown measure or a missing gram weight all give 0
 * (the caller then treats the selection as empty). The manual "grams" id is
 * ignored here on purpose: it has no gram weight, the gram input is used
 * instead via `gramsForSelection`.
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @param {string} measureId
 * @param {number} count number of household units, e.g. 0.5 for half an egg
 * @returns {number} grams >= 0, rounded to 0.1 g
 */
export function gramsFromMeasure(food, measureId, count) {
  const measure = findMeasure(food, measureId);
  if (!measure) return 0;
  const units = clampCount(count);
  if (units === 0) return 0;
  return roundGrams(roundGrams(measure.grams) * units);
}

/**
 * Grams of a selection, applying the rule "manual grams override the measure".
 *
 * Accepted selection shapes (state.js always writes the first one):
 *   { measureId, count, grams }  -> `grams` wins when it is a finite number
 *   { measureId, count }         -> count x measure grams
 *   { grams }                    -> manual grams
 *
 * An explicit `grams: 0` (or negative) is a valid answer, not "missing": the
 * selection then weighs 0 g and contributes nothing. Only `null`/`undefined`/
 * non-numeric grams fall back to the measure.
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @param {{measureId?: string, count?: number, grams?: number|null}|null|undefined} selection
 * @returns {number} grams >= 0, rounded to 0.1 g
 */
export function gramsForSelection(food, selection) {
  if (!selection || typeof selection !== "object") return 0;

  const raw = selection.grams;
  if (raw !== null && raw !== undefined) {
    const grams = Number(raw);
    if (Number.isFinite(grams)) return roundGrams(grams);
  }
  if (typeof selection.measureId === "string" && selection.measureId !== GRAMS_MEASURE_ID) {
    return gramsFromMeasure(food, selection.measureId, selection.count);
  }
  return 0;
}

/**
 * Canonical selection object for a food: always carries `measureId`, `count`
 * and the computed `grams`, so saving and re-rendering need no special cases.
 *
 * @param {{measures?: Array<object>}|null|undefined} food
 * @param {{measureId?: string, count?: number, grams?: number|null}|null|undefined} selection
 * @returns {{measureId: string, count: number, grams: number}}
 */
export function normalizeSelection(food, selection) {
  const fallback = defaultMeasure(food);
  const fallbackId = fallback?.id ?? GRAMS_MEASURE_ID;

  if (!selection || typeof selection !== "object") {
    return { measureId: fallbackId, count: fallback ? 1 : 0, grams: fallback ? roundGrams(fallback.grams) : 0 };
  }

  const raw = selection.grams;
  const hasGrams = raw !== null && raw !== undefined && Number.isFinite(Number(raw));

  // A manual gram amount with no measure id is the "grams" option.
  const manual = selection.measureId === GRAMS_MEASURE_ID
    || ((selection.measureId === undefined || selection.measureId === null) && hasGrams);

  if (manual) {
    return { measureId: GRAMS_MEASURE_ID, count: 0, grams: hasGrams ? roundGrams(raw) : 0 };
  }

  // Household measure: an unknown id falls back to the food's default row.
  const measure = findMeasure(food, selection.measureId) ?? fallback;
  const measureId = measure?.id ?? fallbackId;
  const count = selection.count === undefined || selection.count === null
    ? (measure ? 1 : 0)
    : clampCount(selection.count);
  const base = measure ? roundGrams(measure.grams) : 0;
  // An explicit gram amount is the manual override and stays authoritative;
  // otherwise the weight is count x measure grams.
  const grams = hasGrams ? roundGrams(raw) : roundGrams(base * count);
  return { measureId, count, grams };
}

/**
 * Human readable weight of a selection, e.g. "约 28 g".
 *
 * @param {number|null|undefined} grams
 * @returns {string} Chinese text; "约 0 g" for an empty selection
 */
export function formatGrams(grams) {
  const value = roundGrams(grams);
  const text = Number.isInteger(value) ? String(value) : value.toFixed(GRAMS_DECIMALS).replace(/\.?0+$/, "");
  return `约 ${text} g`;
}

/**
 * Step a count by `COUNT_STEP`, never below 0.
 *
 * @param {number} count current count
 * @param {number} [steps] number of steps to add (may be negative)
 * @returns {number} new count, a multiple of 0.5
 */
export function stepCount(count, steps = 1) {
  const current = clampCount(count);
  const delta = Number(steps);
  const step = Number.isFinite(delta) ? delta : 0;
  const next = current + step * COUNT_STEP;
  return next <= 0 ? 0 : Math.round(next * 10) / 10;
}

export default {
  GRAMS_MEASURE_ID,
  GRAMS_LABEL_ZH,
  WITH_BONE_LABEL,
  COUNT_STEP,
  roundGrams,
  refusePctOf,
  edibleFactor,
  edibleGrams,
  isBoneIn,
  formatEdibleGrams,
  clampCount,
  measuresOf,
  findMeasure,
  defaultMeasure,
  measureGrams,
  measureOptions,
  gramsFromMeasure,
  gramsForSelection,
  normalizeSelection,
  formatGrams,
  stepCount,
};
