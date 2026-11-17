// Food list for the active nutrient: one card per food in `order.js` order
// (pinned selections first, then the highest amount per 100 g), with a "show
// more" button that raises the limit by 60 (PLAN.md 1.7 and 1.8 item 5, phase
// P11a).
//
// Rendering only: ordering, the limit and the pinned selections all come from
// the pure modules (`core/order.js`, `core/state.js` values passed in by
// `app.js`). This module never touches localStorage and never mutates state.
//
// A card shows the Chinese name, the English name small under it, the amount
// of the active nutrient per 100 g with its unit, and a 估算 badge for a
// composite dish (values are recipe estimates, not measured food). Cards are
// 2 columns at the 390 px design width and 4 from 760 px; each card is a
// `<button>` with `aria-pressed`, ready for the selection toggle of the next
// sub-step.
//
// Card density and the 2/4-column grid follow the food-card grids of common
// nutrition trackers (see "Credits" in README.md); the markup and CSS are
// written from scratch.

import { formatAmount } from "../core/calc.js";
import { MET_COLORS, nameZhOf, unitOf } from "../core/nutrients.js";
import { LIMIT_STEP, DEFAULT_LIMIT, foodsForNutrient, nextLimit, partitionFoods, valueOf } from "../core/order.js";

/** Label above the grid, e.g. "维生素A · 每 100 克含量". */
export const UNIT_HINT_PREFIX = "每 100 克";
/** Badge text on a composite (recipe estimate) food card. */
export const ESTIMATE_BADGE = "估算";

/**
 * Escape text for HTML text and quoted attribute values.
 *
 * @param {*} value
 * @returns {string}
 */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The `foods` array of the foods.json payload (or a bare array).
 *
 * @param {{foods?: Array<object>}|Array<object>|null|undefined} foods
 * @returns {Array<object>}
 */
export function foodArray(foods) {
  if (Array.isArray(foods)) return foods.filter(Boolean);
  if (foods && Array.isArray(foods.foods)) return foods.foods.filter(Boolean);
  return [];
}

/**
 * Amount text of one food for the active nutrient: "6502 ug RAE", or "无数据"
 * when this food has no value for the nutrient.
 *
 * Uses `calc.js formatAmount`, the same rule as the target cards and the
 * standards table, so the same number never renders two ways.
 *
 * @param {object} food foods.json food
 * @param {string} nutrientId
 * @param {string} unit e.g. "ug RAE"
 * @returns {string}
 */
export function per100gText(food, nutrientId, unit) {
  const value = valueOf(food, nutrientId);
  if (value === null) return "无数据";
  return formatAmount(value, unit);
}

/**
 * Card models for one nutrient in display order.
 *
 * @param {{foods: object, nutrients: object, state: object,
 *   limit?: number}} ctx
 *   `limit` is the number of unpinned cards (default 60)
 * @returns {Array<object>} card models
 */
export function buildFoodCards(ctx) {
  if (!ctx || !ctx.state) return [];
  const state = ctx.state;
  const nutrientId = typeof state.activeNutrient === "string" ? state.activeNutrient : "";
  if (!nutrientId) return [];

  const unit = unitOf(ctx.nutrients, nutrientId);
  const limit = Number.isFinite(Number(ctx.limit)) && Number(ctx.limit) >= 0
    ? Math.floor(Number(ctx.limit))
    : DEFAULT_LIMIT;
  const selections = state.selections && typeof state.selections === "object" ? state.selections : {};

  const list = foodsForNutrient(foodArray(ctx.foods), nutrientId, selections, { limit });

  return list.map((food) => {
    const selected = Boolean(selections[food.id]);
    const amountText = per100gText(food, nutrientId, unit);
    return {
      id: food.id,
      nameZh: String(food.nameZh ?? ""),
      nameEn: String(food.nameEn ?? ""),
      amountText,
      estimate: food.estimate === true,
      selected,
      pinned: selected,
      title: food.estimate === true
        ? `${food.nameZh}：每 100 克 ${amountText}（按食谱估算）`
        : `${food.nameZh}：每 100 克 ${amountText}`,
    };
  });
}

/**
 * Markup of one food card. A `<button>` with `aria-pressed` so the card is
 * keyboard reachable and its selected state is announced (PLAN.md 1.8
 * accessibility).
 *
 * @param {object} card card model from `buildFoodCards`
 * @returns {string} HTML
 */
export function foodCardHtml(card) {
  const classes = [
    "food-card",
    card.pinned ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  const badge = card.estimate
    ? `<span class="food-card__badge">${ESTIMATE_BADGE}</span>`
    : "";
  const english = card.nameEn ? `<span class="food-card__en">${esc(card.nameEn)}</span>` : "";
  const colors = card.pinned
    ? ` style="--food-bg:${MET_COLORS.background};--food-border:${MET_COLORS.border};--food-text:${MET_COLORS.text}"`
    : "";

  return `<button type="button" class="${classes}" data-food="${esc(card.id)}"${colors}
    aria-pressed="${card.selected ? "true" : "false"}" title="${esc(card.title)}">
    <span class="food-card__head">
      <span class="food-card__name">${esc(card.nameZh)}</span>
      ${badge}
    </span>
    ${english}
    <span class="food-card__amount">${esc(card.amountText)}</span>
  </button>`;
}

/**
 * Heading text of the list: the active nutrient and the "per 100 g" hint.
 *
 * @param {{nutrients: object, state: object}} ctx
 * @returns {string}
 */
export function foodsHeading(ctx) {
  const name = nameZhOf(ctx.nutrients, ctx.state?.activeNutrient, ctx.state?.activeNutrient ?? "");
  return `${name} · ${UNIT_HINT_PREFIX}含量`;
}

/**
 * The whole section: heading, card grid and the "show more" button.
 *
 * @param {Array<object>} cards card models
 * @param {{nutrients: object, state: object, more: number}} ctx
 *   `more` = how many unpinned cards are still hidden
 * @returns {string} HTML
 */
export function foodsHtml(cards, ctx) {
  const body = cards.length > 0
    ? `<div class="foods__grid">${cards.map(foodCardHtml).join("")}</div>`
    : '<p class="status">该营养素暂无食物数据。</p>';

  const more = Number(ctx?.more) || 0;
  const foot = more > 0
    ? `<div class="foods__foot">
        <p class="foods__count">已显示 ${cards.length} 种，还有 ${more} 种</p>
        <button type="button" class="foods__more" data-more>显示更多（+${LIMIT_STEP}）</button>
      </div>`
    : (cards.length > 0 ? `<p class="foods__count">共 ${cards.length} 种食物</p>` : "");

  const note = cards.some((card) => card.estimate)
    ? '<p class="foods__note">带「估算」标记的是按食谱估算的菜肴，并非直接测定的成分表数值。</p>'
    : "";

  return `<div class="foods__head">
      <h2 class="foods__title">食物含量排行</h2>
      <p class="foods__hint">${esc(foodsHeading(ctx ?? {}))}</p>
    </div>
    ${body}
    ${foot}
    ${note}`;
}

/**
 * Number of foods still hidden behind "show more" for one limit.
 *
 * Only the unpinned part is limited, so the pinned (selected) foods always
 * count as visible. Computed from `partitionFoods` instead of two full list
 * builds, so the count and the grid can never disagree.
 *
 * @param {{foods: object, state: object}} ctx
 * @param {number} limit current unpinned limit
 * @returns {number}
 */
export function hiddenCount(ctx, limit) {
  const nutrientId = ctx?.state?.activeNutrient;
  const selections = ctx?.state?.selections ?? {};
  const { unpinned } = partitionFoods(foodArray(ctx?.foods), nutrientId, selections);
  const shown = Number.isFinite(Number(limit)) && Number(limit) >= 0
    ? Math.floor(Number(limit))
    : DEFAULT_LIMIT;
  return Math.max(0, unpinned.length - shown);
}

/**
 * Click handler: the "show more" button.
 *
 * The limit lives on the section element (not in state): it is a view
 * preference, so it is not persisted, and it starts over at 60 whenever the
 * active nutrient changes because each nutrient has its own ranked list.
 *
 * @param {Event} event
 */
function handleClick(event) {
  const container = event.currentTarget;
  const ctx = container._foodsCtx;
  if (!ctx) return;
  if (!event.target.closest("[data-more]")) return;

  container._foodsLimit = nextLimit(container._foodsLimit ?? DEFAULT_LIMIT);
  container._foodsKeepFocus = true;
  renderFoods(container, ctx);
}

/**
 * Render (or re-render) the food list into `container`.
 *
 * @param {HTMLElement|null} container section in index.html
 * @param {{state: object, nutrients: object, foods: object, onChange: Function}} ctx
 *   `onChange(action, payload)` applies a state.js reducer in the caller (used
 *   by the selection toggle in the next sub-step)
 */
export function renderFoods(container, ctx) {
  if (!container || !ctx || !ctx.state) return;

  const nutrientId = ctx.state.activeNutrient;

  // A different nutrient is a different ranking: start at the default limit
  // again instead of carrying a raised limit across tabs.
  if (container._foodsNutrient !== nutrientId) {
    container._foodsNutrient = nutrientId;
    container._foodsLimit = DEFAULT_LIMIT;
  }

  const limit = container._foodsLimit ?? DEFAULT_LIMIT;
  const shared = { foods: ctx.foods, nutrients: ctx.nutrients, state: ctx.state, limit };
  const cards = buildFoodCards(shared);
  const more = hiddenCount(shared, limit);

  container.innerHTML = foodsHtml(cards, {
    nutrients: ctx.nutrients,
    state: ctx.state,
    more,
  });
  container.classList.add("panel", "panel--foods");
  container.setAttribute("aria-busy", "false");

  container._foodsCtx = ctx;
  if (!container._foodsBound) {
    container._foodsBound = true;
    container.addEventListener("click", handleClick);
  }

  // "Show more" rebuilds the grid, but the button stays in place; return the
  // focus to it so a keyboard user can keep pressing it.
  if (container._foodsKeepFocus) {
    container._foodsKeepFocus = false;
    const button = container.querySelector("[data-more]");
    if (button) button.focus({ preventScroll: true });
  }
}

export default {
  UNIT_HINT_PREFIX,
  ESTIMATE_BADGE,
  foodArray,
  per100gText,
  buildFoodCards,
  foodCardHtml,
  foodsHeading,
  foodsHtml,
  hiddenCount,
  renderFoods,
};
