// One food's nutrient rows for the detail view (phase P21b).
//
// Pure ES module: no DOM access, no fetch, no storage. It only needs the food
// record from foods.json, the per-nutrient targets of the current profile and
// the nutrient metadata from nutrients.json, so node --test can load it with
// small fixtures and the UI (P21c) can render the rows as they are.
//
// Data shapes used here:
//   food      { per100g: { vitA: 469, vitD: null, ... }, refusePct?: 30 }
//   targets   `targetsFor(...)` from dri.js, its `.values` map, or a plain
//             `nutrientId -> number` map (see `detailRows`)
//   nutrients the `nutrients` array of nutrients.json, or its whole payload
//
// Since P23 only the nutrients the food actually contains get a row: a value
// of exactly 0 ("this food contains none") and a null / absent value ("not
// measured") are left out, so the sheet lists the nutrients that contribute.
// `null` is still never turned into 0 inside a row, and `sortDetailRows` keeps
// the "zero" / "missing" groups for callers that pass such rows themselves.

import { edibleGramsOf } from "./calc.js";
import { nutrientList } from "./nutrients.js";

/**
 * Ranking groups of a detail row, best first. The UI uses the order to group
 * or tint the list; the labels themselves are UI text and are not part of the
 * core module.
 */
export const STATUS_ORDER = Object.freeze(["ok", "noTarget", "zero", "missing"]);

/** Text `formatPct` returns when there is no percentage. */
export const NO_PCT_TEXT = "—";

/** Text `formatPct` returns for a positive percentage below 1 %. */
export const TINY_PCT_TEXT = "<1%";

/**
 * The target map of the accepted `targets` shapes.
 *
 * @param {*} targets
 * @returns {Record<string, *>} nutrient id -> target entry (or bare number)
 */
function targetValues(targets) {
  if (!targets || typeof targets !== "object") return {};
  const values = targets.values;
  if (values && typeof values === "object" && !Array.isArray(values)) return values;
  return targets;
}

/**
 * Target value of one nutrient, or null when the profile has none.
 *
 * Accepts either the `values` shape of dri.json (`{ target, type, ul, ... }`)
 * or a bare number. A target of 0 or less is treated as "no target" so the
 * percentages can never divide by zero.
 *
 * @param {*} targets see `detailRows`
 * @param {string} id nutrient id
 * @returns {number|null}
 */
function targetOf(targets, id) {
  const entry = targetValues(targets)[id];
  const raw = entry && typeof entry === "object" ? entry.target : entry;
  if (raw === null || raw === undefined) return null;
  const target = Number(raw);
  if (!Number.isFinite(target) || target <= 0) return null;
  return target;
}

/**
 * Per-100 g value of one nutrient: a finite number >= 0, or null.
 *
 * @param {{per100g?: object}|null|undefined} food
 * @param {string} id nutrient id
 * @returns {number|null}
 */
function per100gOf(food, id) {
  const raw = food?.per100g?.[id];
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Ranking group of one row.
 *
 * @param {number|null} per100g
 * @param {boolean} hasTarget
 * @returns {"ok"|"noTarget"|"zero"|"missing"}
 */
function statusOf(per100g, hasTarget) {
  if (per100g === null) return "missing";
  if (per100g === 0) return "zero";
  return hasTarget ? "ok" : "noTarget";
}

/**
 * Sort detail rows: the richest first, the unknown last.
 *
 * 1. `ok` (value > 0 and a target) by `pct100` descending
 * 2. `noTarget` (value > 0, no target) by `per100g` descending
 * 3. `zero` (value exactly 0)
 * 4. `missing` (null / missing)
 *
 * Ties keep the nutrients.json order, so a food with several equal values is
 * listed in the same order as the tabs and the target cards.
 *
 * @param {Array<object>} rows rows from `detailRows`
 * @returns {Array<object>} the same rows, sorted (stable, no mutation)
 */
export function sortDetailRows(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  // The filters keep the input (nutrients.json) order; Array#sort is stable,
  // so equal values keep that order too.
  const ranked = list.filter((row) => row.status === "ok");
  const untargeted = list.filter((row) => row.status === "noTarget");
  const zero = list.filter((row) => row.status === "zero");
  const missing = list.filter((row) => row.status === "missing");
  ranked.sort((a, b) => b.pct100 - a.pct100);
  untargeted.sort((a, b) => b.per100g - a.per100g);
  return [...ranked, ...untargeted, ...zero, ...missing];
}

/**
 * Nutrient rows of one food that the food actually contains, ranked for the
 * detail view (phase P21b, narrowed in P23).
 *
 * One row per nutrient of `nutrients` whose value is greater than 0 (22
 * nutrients in the real metadata):
 *
 * - `per100g` / `pct100` describe 100 g of the food,
 * - `amount` / `pct` describe the chosen quantity `grams` (null without a
 *   positive quantity),
 * - `status` is "ok" (value > 0 and a target) or "noTarget" (value > 0, no
 *   target for this profile).
 *
 * Nutrients the food has none of (value exactly 0) or no value for
 * (null / absent) get no row at all, so the sheet lists only what the food
 * brings. `sortDetailRows` still knows the "zero" and "missing" groups for
 * callers that build rows themselves.
 *
 * Bone-in foods: `grams` is the weight WITH bone, the same convention as the
 * household measures and the gram input (P20), so the nutrients use
 * `calc.edibleGramsOf` and 100 g of spare ribs at 30 % refuse counts as 70 g.
 * This is the same rule as the intake totals on the target cards.
 *
 * Values are kept as the raw float products (no rounding) so the caller decides
 * the display precision.
 *
 * @param {{per100g?: Record<string, number|null>, refusePct?: number}|null|undefined} food
 *   one food record from foods.json
 * @param {object|Record<string, number|null>|null|undefined} targets
 *   the per-nutrient targets of the current standard/sex/age: the object
 *   returned by `dri.js targetsFor(dri, standard, profile)` (its `values` map
 *   is used), that `values` map itself (`nutrientId -> { target, ... }`), or a
 *   plain `nutrientId -> number` map. A missing nutrient or a target <= 0
 *   means "no target" and gives `pct100: null` / `pct: null`.
 * @param {{nutrients: Array<object>}|Array<object>} nutrients
 *   the `nutrients` array of nutrients.json (or its whole payload)
 * @param {number|null|undefined} [grams]
 *   chosen quantity in grams (with bone for bone-in foods); a non-positive or
 *   non-numeric value gives no amount
 * @returns {Array<{id: string, name: string, unit: string, per100g: number,
 *   pct100: number|null, amount: number|null, pct: number|null,
 *   status: "ok"|"noTarget"}>} rows in `sortDetailRows` order
 */
export function detailRows(food, targets, nutrients, grams) {
  const edible = edibleGramsOf(food, { grams });
  const weighed = Number(grams);
  const hasQuantity = Number.isFinite(weighed) && weighed > 0 && edible > 0;

  const rows = nutrientList(nutrients)
    .filter((nutrient) => nutrient && typeof nutrient.id === "string" && nutrient.id)
    .map((nutrient) => {
      const id = nutrient.id;
      const per100g = per100gOf(food, id);
      const target = targetOf(targets, id);

      const pct100 = per100g !== null && target !== null ? (per100g / target) * 100 : null;

      let amount = null;
      let pct = null;
      if (per100g !== null && hasQuantity) {
        amount = (per100g * edible) / 100;
        if (target !== null) pct = (amount / target) * 100;
      }

      return {
        id,
        name: typeof nutrient.nameZh === "string" ? nutrient.nameZh : id,
        unit: typeof nutrient.unit === "string" ? nutrient.unit : "",
        per100g,
        pct100,
        amount,
        pct,
        status: statusOf(per100g, target !== null),
      };
    })
    // P23: only what the food contains. 0 ("contains none") and null
    // ("not measured") add nothing to the picture the sheet draws.
    .filter((row) => row.per100g !== null && row.per100g > 0);

  return sortDetailRows(rows);
}

/**
 * Percentage text for the detail view.
 *
 * | case                    | text  |
 * |-------------------------|-------|
 * | no percentage (null)    | "—"   |
 * | 0 < pct < 1             | "<1%" |
 * | pct < 10                | "3.5%" (one decimal, trailing zero trimmed) |
 * | pct >= 10               | "123%" (rounded) |
 *
 * A finite 0 stays "0%", so "none" and "no data" never look the same.
 *
 * @param {number|null|undefined} pct percentage, e.g. 123.4
 * @returns {string} e.g. "123%", "3.5%", "<1%", "0%", "—"
 */
export function formatPct(pct) {
  if (pct === null || pct === undefined) return NO_PCT_TEXT;
  const value = Number(pct);
  if (!Number.isFinite(value)) return NO_PCT_TEXT;
  if (value === 0) return "0%";
  if (value > 0 && value < 1) return TINY_PCT_TEXT;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}%`;
}

export default {
  STATUS_ORDER,
  NO_PCT_TEXT,
  TINY_PCT_TEXT,
  sortDetailRows,
  detailRows,
  formatPct,
};
