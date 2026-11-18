// Per-nutrient food ordering with pinned selections (PLAN.md 1.7, phase P8;
// confirmation order since P17; commonness first since P18b).
//
// Pure ES module: no DOM access. It imports only `selectionGrams` from
// calc.js, so node --test can load it directly. Ordering is:
//   1. pinned: selected foods with per100g[n] > 0, in confirmation order
//      (oldest first) from `state.order` - the pinned group is a list of what
//      the user confirmed, so a newly confirmed food joins the BOTTOM and
//      editing a portion never reshuffles it. A selection missing from `order`
//      (older saved state) falls back to the key order of `selections`, which
//      older versions wrote in confirmation order;
//   2. unpinned: every other food with per100g[n] > 0, sorted by commonness
//      descending (the AI-estimated everyday-use tier, P18), then by per100g[n]
//      descending within a tier, ties broken by nameZh. A food without a
//      commonness tier counts as 0, so it sorts after every tiered food;
//   3. `limit` (default 60) applies to the unpinned part only, so a user's
//      pinned foods never disappear behind "show more".
//
// Only foods that actually contain the nutrient are listed in a nutrient tab
// (user review, P16): a food with per100g[n] = 0, null or no key at all is not
// listed at all, whether it is selected or not. A zero value means "none of
// this nutrient", and a missing value has no data; neither belongs in a
// ranking of foods that contain it, so a selected carrot (vitamin D = 0) is
// not pinned in the vitamin D tab. The selection itself is global and stays
// untouched; it only does not show up in tabs of nutrients the food lacks.

import { selectionGrams } from "./calc.js";

/** Default number of unpinned cards per nutrient (PLAN.md 1.7). */
export const DEFAULT_LIMIT = 60;
/** How much the "show more" button raises the limit. */
export const LIMIT_STEP = 60;

/**
 * Numeric value of a nutrient in a food, or null when there is no data.
 *
 * @param {{per100g?: Record<string, number|null>}|null|undefined} food
 * @param {string} nutrientId
 * @returns {number|null} a finite number (>= 0 in practice) or null
 */
export function valueOf(food, nutrientId) {
  const value = food?.per100g?.[nutrientId];
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Stable name comparison, so ties depend only on the data. */
function byName(a, b) {
  const left = String(a?.nameZh ?? "");
  const right = String(b?.nameZh ?? "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Commonness tier of a food as a number, 0 when it has none.
 *
 * The tier is the AI-estimated everyday-use rank from foods.json (1 = rare,
 * 5 = everyday staple, P18). A food without a usable tier sorts behind every
 * tiered food instead of failing or landing at the top.
 *
 * @param {{commonness?: number}|null|undefined} food
 * @returns {number} 1..5, or 0 when missing/invalid
 */
export function commonnessOf(food) {
  const value = Number(food?.commonness);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Descending numeric sort helper, Infinity for empty input. */
function desc(a, b) {
  return b - a;
}

/**
 * Confirmation order of the selections: `order` sanitised against the keys of
 * `selections` (unknown ids dropped, missing ids appended in key order).
 *
 * @param {Record<string, object>} selections
 * @param {Array<string>} [order]
 * @returns {Array<string>}
 */
export function selectionOrder(selections, order) {
  const picked = selections && typeof selections === "object" ? selections : {};
  const result = [];
  const seen = new Set();
  const add = (foodId) => {
    if (typeof foodId !== "string" || !foodId) return;
    if (!Object.prototype.hasOwnProperty.call(picked, foodId)) return;
    if (seen.has(foodId)) return;
    seen.add(foodId);
    result.push(foodId);
  };
  if (Array.isArray(order)) order.forEach(add);
  Object.keys(picked).forEach(add);
  return result;
}

/**
 * Contribution of a selection in grams of the nutrient.
 *
 * Kept for the card models (an estimate of how much a portion adds); it no
 * longer decides the pinned order, which follows the confirmation order.
 *
 * @param {{per100g?: Record<string, number|null>}} food
 * @param {string} nutrientId
 * @param {{grams?: number}|undefined} selection
 * @returns {number} amount, 0 when there is no value
 */
export function contribution(food, nutrientId, selection) {
  const per100g = valueOf(food, nutrientId);
  if (per100g === null) return 0;
  return (per100g * selectionGrams(selection)) / 100;
}

/**
 * Split foods into pinned and unpinned groups for one nutrient.
 *
 * Only foods that contain the nutrient are considered: a food whose per100g
 * value is 0, null or missing is neither pinned nor listed (P16).
 *
 * The pinned group follows the confirmation order (`order`, falling back to
 * the key order of `selections`) and only then drops the foods that lack the
 * nutrient, so the relative order of the remaining pinned cards is unchanged
 * from tab to tab.
 *
 * Exposed separately because the UI needs the total count for its "show more"
 * button without building the whole list.
 *
 * @param {Array<object>} foods foods.json `foods` array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections] keyed by food id
 * @param {Array<string>} [order] confirmation order of the selected food ids
 * @returns {{pinned: Array<object>, unpinned: Array<object>}}
 *   both arrays sorted; `pinned` entries carry `contribution` (grams of the
 *   nutrient) and `selected: true`
 */
export function partitionFoods(foods, nutrientId, selections, order) {
  const list = Array.isArray(foods) ? foods.filter(Boolean) : [];
  const picked = selections && typeof selections === "object" ? selections : {};
  const byId = new Map();
  for (const food of list) {
    if (food && typeof food.id === "string" && !byId.has(food.id)) byId.set(food.id, food);
  }

  const pinned = [];
  const unpinned = [];

  for (const foodId of selectionOrder(picked, order)) {
    const food = byId.get(foodId);
    if (!food) continue;
    const per100g = valueOf(food, nutrientId);
    // 0, null and missing all mean "this food does not contain the nutrient":
    // not listed in this tab at all, selected or not (P16).
    if (per100g === null || per100g <= 0) continue;
    pinned.push({
      ...food,
      selected: true,
      contribution: (per100g * selectionGrams(picked[foodId])) / 100,
    });
  }

  const isPinned = new Set(pinned.map((food) => food.id));
  for (const food of list) {
    const per100g = valueOf(food, nutrientId);
    if (per100g === null || per100g <= 0) continue;
    if (isPinned.has(food.id)) continue;
    // A food selected but not listed under this nutrient is still selected; it
    // simply has no card here, so it must not reappear as an unpinned card
    // either.
    if (picked[food.id]) continue;
    unpinned.push(food);
  }

  unpinned.sort((a, b) => {
    // Commonness first (P18b): an everyday food outranks a niche one even when
    // the niche food is far richer in the nutrient. Only inside one tier does
    // the per-100 g amount decide, then the Chinese name.
    const byCommonness = desc(commonnessOf(a), commonnessOf(b));
    if (byCommonness !== 0) return byCommonness;
    const byValue = desc(valueOf(a, nutrientId) ?? 0, valueOf(b, nutrientId) ?? 0);
    return byValue !== 0 ? byValue : byName(a, b);
  });

  return { pinned, unpinned };
}

/**
 * Foods to show for one nutrient: pinned first (confirmation order), then the
 * unpinned ones up to `limit` (default 60). Raised by `LIMIT_STEP` on
 * "show more".
 *
 * @param {Array<object>} foods foods.json `foods` array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections]
 * @param {{limit?: number, search?: string, order?: Array<string>}} [options]
 *   `limit` applies to the unpinned part only; `search` is optional (P11b) and
 *   keeps pinned foods on top; `order` is the persisted confirmation order
 * @returns {Array<object>} cards in display order; pinned foods have
 *   `selected: true` and `contribution`
 */
export function foodsForNutrient(foods, nutrientId, selections, options = {}) {
  const { pinned, unpinned } = partitionFoods(foods, nutrientId, selections, options?.order);

  const rawLimit = Number(options?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.floor(rawLimit) : DEFAULT_LIMIT;

  const query = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  if (!query) return [...pinned, ...unpinned.slice(0, limit)];

  const matches = (food) => {
    const fields = [
      food.nameZh,
      food.nameEn,
      ...(Array.isArray(food.aliases) ? food.aliases : []),
    ];
    return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(query));
  };

  return [...pinned.filter(matches), ...unpinned.filter(matches).slice(0, limit)];
}

/**
 * Next limit for the "show more" button.
 *
 * @param {number} limit current limit
 * @param {number} [step] defaults to LIMIT_STEP
 * @returns {number} the raised limit
 */
export function nextLimit(limit, step = LIMIT_STEP) {
  const current = Number(limit);
  const base = Number.isFinite(current) && current >= 0 ? Math.floor(current) : DEFAULT_LIMIT;
  const increment = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : LIMIT_STEP;
  return base + increment;
}

/**
 * Whether the "show more" button is needed.
 *
 * @param {Array<object>} foods full foods array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections]
 * @param {number} [limit] current limit
 * @returns {boolean} true when more unpinned cards exist
 */
export function hasMore(foods, nutrientId, selections, limit = DEFAULT_LIMIT, order) {
  const { unpinned } = partitionFoods(foods, nutrientId, selections, order);
  const shown = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;
  return unpinned.length > shown;
}

export default {
  DEFAULT_LIMIT,
  LIMIT_STEP,
  valueOf,
  commonnessOf,
  selectionOrder,
  contribution,
  partitionFoods,
  foodsForNutrient,
  nextLimit,
  hasMore,
};
