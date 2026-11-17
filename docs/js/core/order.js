// Per-nutrient food ordering with pinned selections (PLAN.md 1.7, phase P8).
//
// Pure ES module: no DOM access. It imports only `selectionGrams` from
// calc.js, so node --test can load it directly. Ordering is:
//   1. pinned: selected foods that have a non-null value for this nutrient,
//      sorted by their actual contribution (per100g * grams / 100) descending
//      (ties keep food-name order);
//   2. unpinned: every other food with per100g[n] > 0, sorted by per100g[n]
//      descending, ties broken by nameZh;
//   3. `limit` (default 60) applies to the unpinned part only, so a user's
//      pinned foods never disappear behind "show more".
//
// Selected foods with a null value for the nutrient are not listed at all: a
// food without data must not look like a zero contributor.

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

/** Descending numeric sort helper, Infinity for empty input. */
function desc(a, b) {
  return b - a;
}

/**
 * Contribution of a selection in grams of the nutrient.
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
 * Exposed separately because the UI needs the total count for its "show more"
 * button without building the whole list.
 *
 * @param {Array<object>} foods foods.json `foods` array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections] keyed by food id
 * @returns {{pinned: Array<object>, unpinned: Array<object>}}
 *   both arrays sorted; `pinned` entries carry `contribution` (grams of the
 *   nutrient) and `selected: true`
 */
export function partitionFoods(foods, nutrientId, selections) {
  const list = Array.isArray(foods) ? foods.filter(Boolean) : [];
  const picked = selections && typeof selections === "object" ? selections : {};

  const pinned = [];
  const unpinned = [];

  for (const food of list) {
    const per100g = valueOf(food, nutrientId);
    if (per100g === null) continue;

    const selection = picked[food.id];
    if (selection) {
      // Selected, but no data for this nutrient -> not listed in this group.
      pinned.push({
        ...food,
        selected: true,
        contribution: (per100g * selectionGrams(selection)) / 100,
      });
      continue;
    }
    if (per100g > 0) unpinned.push(food);
  }

  pinned.sort((a, b) => {
    const diff = desc(a.contribution, b.contribution);
    if (diff !== 0) return diff;
    const byValue = desc(valueOf(a, nutrientId) ?? 0, valueOf(b, nutrientId) ?? 0);
    return byValue !== 0 ? byValue : byName(a, b);
  });

  unpinned.sort((a, b) => {
    const byValue = desc(valueOf(a, nutrientId) ?? 0, valueOf(b, nutrientId) ?? 0);
    return byValue !== 0 ? byValue : byName(a, b);
  });

  return { pinned, unpinned };
}

/**
 * Foods to show for one nutrient: pinned first, then the unpinned ones up to
 * `limit` (default 60). Raised by `LIMIT_STEP` on "show more".
 *
 * @param {Array<object>} foods foods.json `foods` array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections]
 * @param {{limit?: number, search?: string}} [options]
 *   `limit` applies to the unpinned part only; `search` is optional (P11b) and
 *   keeps pinned foods on top
 * @returns {Array<object>} cards in display order; pinned foods have
 *   `selected: true` and `contribution`
 */
export function foodsForNutrient(foods, nutrientId, selections, options = {}) {
  const { pinned, unpinned } = partitionFoods(foods, nutrientId, selections);

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
export function hasMore(foods, nutrientId, selections, limit = DEFAULT_LIMIT) {
  const { unpinned } = partitionFoods(foods, nutrientId, selections);
  const shown = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;
  return unpinned.length > shown;
}

export default {
  DEFAULT_LIMIT,
  LIMIT_STEP,
  valueOf,
  contribution,
  partitionFoods,
  foodsForNutrient,
  nextLimit,
  hasMore,
};
