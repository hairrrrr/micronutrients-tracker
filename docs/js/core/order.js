// Per-nutrient food ordering with pinned selections (PLAN.md 1.7, phase P8;
// confirmation order since P17; commonness first since P18b; per-10 g
// comparison for small-portion foods since P19b).
//
// Pure ES module: no DOM access. It imports only `edibleGramsOf` from calc.js,
// so node --test can load it directly. Ordering is:
//   1. pinned: selected foods with per100g[n] > 0, in confirmation order
//      (oldest first) from `state.order` - the pinned group is a list of what
//      the user confirmed, so a newly confirmed food joins the BOTTOM and
//      editing a portion never reshuffles it. A selection missing from `order`
//      (older saved state) falls back to the key order of `selections`, which
//      older versions wrote in confirmation order;
//   2. unselected leading foods (P25b): foods whose `pinTop` lists this
//      nutrient - the user's own branded milks, which the calcium tab must show
//      before everything else - keep their foods.json order and come before the
//      ranked part. Selecting one moves it into the pinned group above, so the
//      leading block only ever holds unselected foods;
//   3. unpinned: every other food with per100g[n] > 0, sorted by commonness
//      descending (the AI-estimated everyday-use tier, P18), then by richness
//      within a tier, ties broken by nameZh. A food without a commonness tier
//      counts as 0, so it sorts after every tiered food;
//   4. richness (P19b) is the amount in the food's comparison portion:
//      per100g[n] * amountBasisG / 100. Condiments, spices, cooking oils and
//      dried goods are eaten by the spoonful, so their `amountBasisG` is 10 and
//      they are compared per 10 g; every other food keeps 100 g. A missing or
//      unusable amountBasisG means 100, so old data and test fixtures behave as
//      before. Note that the tier still decides first: a per-10 g food never
//      jumps above a food of a higher tier;
//   5. `limit` (default 60) applies to the ranked part only, so a user's pinned
//      foods and the leading `pinTop` foods never disappear behind "show more".
//
// Only foods that actually contain the nutrient are listed in a nutrient tab
// (user review, P16): a food with per100g[n] = 0, null or no key at all is not
// listed at all, whether it is selected or not. A zero value means "none of
// this nutrient", and a missing value has no data; neither belongs in a
// ranking of foods that contain it, so a selected carrot (vitamin D = 0) is
// not pinned in the vitamin D tab. The selection itself is global and stays
// untouched; it only does not show up in tabs of nutrients the food lacks.

import { edibleGramsOf } from "./calc.js";

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

/** Default comparison portion in grams (P19b). */
export const DEFAULT_AMOUNT_BASIS_G = 100;

/**
 * Comparison portion of a food in grams (P19b): 10 for condiments, spices,
 * cooking oils and dried goods, 100 for everything else.
 *
 * A missing or unusable value means the default 100 g, so older data and test
 * fixtures keep the per-100 g comparison.
 *
 * @param {{amountBasisG?: number}|null|undefined} food
 * @returns {number} 10 or 100
 */
export function amountBasisGOf(food) {
  const value = Number(food?.amountBasisG);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_AMOUNT_BASIS_G;
}

/**
 * Richness of a food in a comparison portion: per100g[n] * amountBasisG / 100.
 *
 * This is what the unpinned order compares inside one commonness tier, so a
 * condiment eaten per 10 g is neither flattered nor buried by the per-100 g
 * number of a staple.
 *
 * @param {{per100g?: Record<string, number|null>, amountBasisG?: number}} food
 * @param {string} nutrientId
 * @returns {number} 0 when the food has no value for the nutrient
 */
export function richnessOf(food, nutrientId) {
  const per100g = valueOf(food, nutrientId);
  if (per100g === null) return 0;
  return (per100g * amountBasisGOf(food)) / 100;
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
 * Kept for the card models (how much a portion adds); it no longer decides the
 * pinned order, which follows the confirmation order. A bone-in food (P20) is
 * weighed with the bone, so its edible grams are what the per-100 g value
 * multiplies - the same rule as `calc.js intakeTotals`.
 *
 * @param {{per100g?: Record<string, number|null>, refusePct?: number}} food
 * @param {string} nutrientId
 * @param {{grams?: number}|undefined} selection
 * @returns {number} amount, 0 when there is no value
 */
export function contribution(food, nutrientId, selection) {
  const per100g = valueOf(food, nutrientId);
  if (per100g === null) return 0;
  return (per100g * edibleGramsOf(food, selection)) / 100;
}

/**
 * Nutrients for which a food wants to lead its tab, from its `pinTop` list.
 *
 * Since P25b the user's own branded milks carry `pinTop: ["calcium"]`: they are
 * everyday foods the user owns, and the point of adding them was to see them
 * at the top of the calcium tab rather than buried in the commonness ranking.
 *
 * @param {{pinTop?: Array<string>}|null|undefined} food
 * @returns {Array<string>} nutrient ids, empty when the food has none
 */
export function pinTopOf(food) {
  const list = Array.isArray(food?.pinTop) ? food.pinTop : [];
  return list.filter((id) => typeof id === "string" && id);
}

/**
 * Whether a food leads the tab of one nutrient (P25b).
 *
 * @param {{pinTop?: Array<string>}|null|undefined} food
 * @param {string} nutrientId
 * @returns {boolean}
 */
export function isPinTop(food, nutrientId) {
  return Boolean(nutrientId) && pinTopOf(food).includes(nutrientId);
}

/**
 * Whether a food's numbers come from a package label the user transcribed
 * (P25b).
 *
 * foods.json marks such foods with `source.type === "package_label"`: the user's
 * own branded milks, whose calcium is printed on the carton and whose other
 * nutrients are estimated from a USDA food of the same kind. The UI badges
 * them, so a card is never mistaken for USDA data.
 *
 * @param {{source?: {type?: string}}|null|undefined} food
 * @returns {boolean}
 */
export function isPackageLabel(food) {
  return food?.source?.type === "package_label";
}

/**
 * Split foods into pinned, leading and ranked groups for one nutrient.
 *
 * Only foods that contain the nutrient are considered: a food whose per100g
 * value is 0, null or missing is neither pinned nor listed (P16).
 *
 * The pinned group follows the confirmation order (`order`, falling back to
 * the key order of `selections`) and only then drops the foods that lack the
 * nutrient, so the relative order of the remaining pinned cards is unchanged
 * from tab to tab.
 *
 * The leading group (P25b) is every unselected food whose `pinTop` lists this
 * nutrient, in foods.json order: the user's own labelled foods lead their tab
 * before the commonness ranking. The ranked group holds the rest.
 *
 * Exposed separately because the UI needs the total count for its "show more"
 * button without building the whole list.
 *
 * @param {Array<object>} foods foods.json `foods` array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections] keyed by food id
 * @param {Array<string>} [order] confirmation order of the selected food ids
 * @returns {{pinned: Array<object>, leading: Array<object>,
 *   unpinned: Array<object>}}
 *   both sorted; `pinned` entries carry `contribution` (grams of the
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
  const leading = [];
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
      contribution: (per100g * edibleGramsOf(food, picked[foodId])) / 100,
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
    // P25b: an unselected pinTop food leads the tab, in foods.json order.
    if (isPinTop(food, nutrientId)) {
      leading.push(food);
      continue;
    }
    unpinned.push(food);
  }

  unpinned.sort((a, b) => {
    // Commonness first (P18b): an everyday food outranks a niche one even when
    // the niche food is far richer in the nutrient. Only inside one tier does
    // the richness decide (P19b: the per-10 g comparison for condiments and
    // dried goods, per 100 g otherwise), then the Chinese name.
    const byCommonness = desc(commonnessOf(a), commonnessOf(b));
    if (byCommonness !== 0) return byCommonness;
    const byRichness = desc(richnessOf(a, nutrientId), richnessOf(b, nutrientId));
    return byRichness !== 0 ? byRichness : byName(a, b);
  });

  return { pinned, leading, unpinned };
}

/**
 * Foods to show for one nutrient: pinned first (confirmation order), then the
 * leading `pinTop` foods (P25b), then the ranked ones up to `limit` (default
 * 60). Raised by `LIMIT_STEP` on "show more".
 *
 * @param {Array<object>} foods foods.json `foods` array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections]
 * @param {{limit?: number, search?: string, order?: Array<string>}} [options]
 *   `limit` applies to the ranked part only; `search` is optional (P11b) and
 *   keeps pinned and leading foods on top; `order` is the persisted
 *   confirmation order
 * @returns {Array<object>} cards in display order; pinned foods have
 *   `selected: true` and `contribution`
 */
export function foodsForNutrient(foods, nutrientId, selections, options = {}) {
  const { pinned, leading, unpinned } = partitionFoods(foods, nutrientId, selections, options?.order);

  const rawLimit = Number(options?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.floor(rawLimit) : DEFAULT_LIMIT;

  const query = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  if (!query) return [...pinned, ...leading, ...unpinned.slice(0, limit)];

  const matches = (food) => {
    const fields = [
      food.nameZh,
      food.nameEn,
      ...(Array.isArray(food.aliases) ? food.aliases : []),
    ];
    return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(query));
  };

  return [
    ...pinned.filter(matches),
    ...leading.filter(matches),
    ...unpinned.filter(matches).slice(0, limit),
  ];
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
 * The leading `pinTop` foods (P25b) are not limited, so only the ranked part
 * counts against `limit`.
 *
 * @param {Array<object>} foods full foods array
 * @param {string} nutrientId
 * @param {Record<string, {grams?: number}>} [selections]
 * @param {number} [limit] current limit
 * @returns {boolean} true when more ranked cards exist
 */
export function hasMore(foods, nutrientId, selections, limit = DEFAULT_LIMIT, order) {
  const { unpinned } = partitionFoods(foods, nutrientId, selections, order);
  const shown = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;
  return unpinned.length > shown;
}

export default {
  DEFAULT_LIMIT,
  LIMIT_STEP,
  DEFAULT_AMOUNT_BASIS_G,
  valueOf,
  commonnessOf,
  amountBasisGOf,
  richnessOf,
  pinTopOf,
  isPinTop,
  isPackageLabel,
  selectionOrder,
  contribution,
  partitionFoods,
  foodsForNutrient,
  nextLimit,
  hasMore,
};
