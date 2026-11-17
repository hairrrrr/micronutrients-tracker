// Intake totals, target status and amount formatting (PLAN.md 1.6, phase P8).
//
// Pure ES module: no DOM access, no imports. `null` means "no data"
// everywhere: it contributes 0 to a total and the food is simply not listed in
// that nutrient's group (order.js). DRI values are never computed here, only
// compared against whatever the caller passes in.

/** Card text when the target is not reached yet (PLAN.md 1.6). */
export const TEXT_REMAINING = "还差";
/** Card text when the target is exceeded. */
export const TEXT_SURPLUS_PREFIX = "+";
/** Card text when the intake equals the target. */
export const TEXT_MET = "已达标";
/** Card text when the chosen standard has no value for the nutrient. */
export const TEXT_NO_TARGET = "无参考值";

/**
 * Sanitise a number coming from data or localStorage.
 *
 * @param {*} value
 * @returns {number} the finite number, or 0
 */
function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Gram amount of one selection, whatever shape it was stored in.
 *
 * A stored selection is `{ grams, measureId, count }` (state.js always writes
 * `grams`), but a hand-written or older value may only carry
 * `{ measureId, count }`; measures.js resolves that case for the UI.
 *
 * @param {{grams?: number}|null|undefined} selection
 * @returns {number} grams, never negative
 */
export function selectionGrams(selection) {
  if (!selection || typeof selection !== "object") return 0;
  const grams = Number(selection.grams);
  if (!Number.isFinite(grams) || grams <= 0) return 0;
  return grams;
}

/**
 * Total intake per nutrient over all selections.
 *
 * `per100g[n] * grams / 100` summed; a null / missing / non-numeric value
 * counts as 0. Unknown nutrients in a food are ignored, so the result only
 * contains nutrients that at least one selected food has a value for.
 *
 * @param {Record<string, {grams?: number}>} selections keyed by food id
 * @param {Record<string, {per100g?: Record<string, number|null>}>} foodsById
 * @returns {Record<string, number>} nutrient id -> intake in the nutrient's unit
 */
export function intakeTotals(selections, foodsById) {
  /** @type {Record<string, number>} */
  const totals = {};
  if (!selections || typeof selections !== "object") return totals;
  if (!foodsById || typeof foodsById !== "object") return totals;

  for (const [foodId, selection] of Object.entries(selections)) {
    const food = foodsById[foodId];
    if (!food || !food.per100g || typeof food.per100g !== "object") continue;
    const grams = selectionGrams(selection);
    if (grams <= 0) continue;

    for (const [nutrientId, per100g] of Object.entries(food.per100g)) {
      if (per100g === null || per100g === undefined) continue;
      const value = Number(per100g);
      if (!Number.isFinite(value) || value === 0) {
        // A zero still proves the nutrient is known for this food, so make
        // sure the key exists without adding anything.
        if (!(nutrientId in totals)) totals[nutrientId] = 0;
        continue;
      }
      totals[nutrientId] = finiteOrZero(totals[nutrientId]) + (value * grams) / 100;
    }
  }
  return totals;
}

/**
 * Status of one nutrient against a target.
 *
 * - `remaining` / `surplus` are never negative, and exactly one of them is > 0
 *   (both are 0 when the intake equals the target).
 * - `met` is `intake >= target`.
 * - `overUL` is only true when the UL actually covers food intake
 *   (`ulAppliesToFood`), because a supplement-only UL must not warn.
 * - A missing target (`null`/`undefined`) yields `{ hasTarget: false }` with
 *   every derived flag false, so the card can show "no reference value" and can
 *   never turn green.
 *
 * @param {number|null|undefined} target reference intake, or null when unknown
 * @param {number|null|undefined} intake total intake
 * @param {number|null|undefined} [ul] tolerable upper intake level
 * @param {boolean|null|undefined} [ulAppliesToFood] whether the UL covers food
 * @returns {{hasTarget: boolean, target: number|null, intake: number,
 *   remaining: number, surplus: number, met: boolean, overUL: boolean,
 *   ul: number|null, ratio: number}}
 */
export function status(target, intake, ul, ulAppliesToFood) {
  const value = finiteOrZero(intake);
  const hasTarget = target !== null && target !== undefined && Number.isFinite(Number(target));
  const targetValue = hasTarget ? Math.max(Number(target), 0) : null;
  const ulValue = ul !== null && ul !== undefined && Number.isFinite(Number(ul)) ? Number(ul) : null;

  if (!hasTarget) {
    return {
      hasTarget: false,
      target: null,
      intake: value,
      remaining: 0,
      surplus: 0,
      met: false,
      overUL: false,
      ul: ulValue,
      ratio: 0,
    };
  }

  const diff = targetValue - value;
  const met = value >= targetValue;
  // Snap float noise (0.1 + 0.2 vs 0.3) to an exact hit, so a card never shows
  // a meaningless "+0.00000000000000006" surplus.
  const epsilon = Math.max(1e-9, Math.abs(targetValue) * 1e-12);
  const exact = Math.abs(diff) < epsilon;
  return {
    hasTarget: true,
    target: targetValue,
    intake: value,
    remaining: !met && diff > 0 ? diff : 0,
    surplus: met && !exact && diff < 0 ? -diff : 0,
    met: met || exact,
    overUL: Boolean(ulAppliesToFood) && ulValue !== null && value > ulValue,
    ul: ulValue,
    ratio: targetValue > 0 ? value / targetValue : met ? 1 : 0,
  };
}

/**
 * Round to a number of significant decimals and trim trailing zeros.
 *
 * @param {number} value absolute value >= 0
 * @param {number} decimals digits after the decimal point
 * @returns {string} digits only, no sign
 */
function fixed(value, decimals) {
  const text = value.toFixed(decimals);
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

/**
 * Format an amount for display (PLAN.md 1.6).
 *
 * - `>= 100` -> 0 decimals (1234.5 -> "1235")
 * - `>= 10`  -> 1 decimal  (12.34 -> "12.3")
 * - otherwise -> 2 decimals with trailing zeros trimmed (0.456 -> "0.46",
 *   0.5 -> "0.5")
 *
 * Never outputs a minus sign: the sign is decided by the card text, so an
 * absolute value is used and 0 values render as "0". Tiny non-zero values
 * never round down to "0", they show "<0.01" instead so a card cannot claim
 * "still need 0 mg".
 *
 * @param {number|null|undefined} value amount in the nutrient's unit
 * @returns {string} e.g. "1235", "12.3", "0.46", "0", "<0.01"
 */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const abs = Math.abs(number);
  if (abs === 0) return "0";
  if (abs >= 100) return fixed(abs, 0);
  if (abs >= 10) return fixed(abs, 1);
  if (abs < 0.01) return "<0.01";
  return fixed(abs, 2);
}

/**
 * Same as `formatNumber` plus the unit.
 *
 * @param {number|null|undefined} value
 * @param {string} [unit] e.g. "mg" or "ug DFE"
 * @returns {string} e.g. "12.3 mg" (no trailing space when unit is empty)
 */
export function formatAmount(value, unit) {
  const text = formatNumber(value);
  const suffix = typeof unit === "string" ? unit.trim() : "";
  return suffix ? `${text} ${suffix}` : text;
}

/**
 * Signed surplus text, e.g. "+12 mg". A zero surplus gets no "+".
 *
 * @param {number|null|undefined} surplus amount above the target
 * @param {string} [unit]
 * @returns {string} "+12 mg", or "0 mg" when surplus is 0
 */
export function formatSurplus(surplus, unit) {
  const number = Number(surplus);
  const amount = Number.isFinite(number) && number > 0 ? number : 0;
  if (amount === 0) return formatAmount(0, unit);
  return `${TEXT_SURPLUS_PREFIX}${formatAmount(amount, unit)}`;
}

/**
 * Card text of one nutrient (PLAN.md 1.6, Chinese for the UI).
 *
 * | case                       | text              |
 * |----------------------------|-------------------|
 * | no target for this profile | "无参考值"         |
 * | not met                    | "还差 X unit"      |
 * | met with surplus           | "+X unit"          |
 * | met exactly                | "已达标"           |
 *
 * @param {{hasTarget: boolean, remaining: number, surplus: number, met: boolean}} statusResult
 *   the object returned by `status`
 * @param {string} [unit]
 * @returns {string} Chinese card text, never containing a minus sign
 */
export function cardText(statusResult, unit) {
  if (!statusResult || statusResult.hasTarget !== true) return TEXT_NO_TARGET;
  if (!statusResult.met) {
    const remaining = Number(statusResult.remaining);
    return `${TEXT_REMAINING} ${formatAmount(remaining > 0 ? remaining : 0, unit)}`;
  }
  const surplus = Number(statusResult.surplus);
  if (Number.isFinite(surplus) && surplus > 0) return formatSurplus(surplus, unit);
  return TEXT_MET;
}

/**
 * Convenience: totals, status and card text for one nutrient in one call.
 *
 * @param {{target: number|null, ul?: number|null, ulAppliesToFood?: boolean|null}|null|undefined} reference
 *   one entry of `targetsFor(...).values`, or null when there is no value
 * @param {number} intake total intake of that nutrient
 * @param {string} [unit]
 * @returns {{status: object, text: string}}
 */
export function nutrientSummary(reference, intake, unit) {
  const result = status(reference?.target ?? null, intake, reference?.ul ?? null, reference?.ulAppliesToFood);
  return { status: result, text: cardText(result, unit) };
}

export default {
  TEXT_REMAINING,
  TEXT_SURPLUS_PREFIX,
  TEXT_MET,
  TEXT_NO_TARGET,
  selectionGrams,
  intakeTotals,
  status,
  formatNumber,
  formatAmount,
  formatSurplus,
  cardText,
  nutrientSummary,
};
