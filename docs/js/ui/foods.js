// Food list for the active nutrient: one card per food in `order.js` order
// (pinned selections first, then the highest amount per 100 g), with a "show
// more" button that raises the limit by 60 and a search box (PLAN.md 1.7 and
// 1.8 item 5, phases P11a and P11b).
//
// Rendering only: ordering, the limit, the search text and the selections all
// come from the pure modules (`core/order.js`, `core/measures.js`,
// `core/state.js` values passed in by `app.js`). This module never touches
// localStorage and never mutates state: a tap reports a reducer call through
// `ctx.onChange`, `app.js` applies it, saves and re-renders everything.
//
// A card shows the Chinese name, the English name small under it, the amount
// of the active nutrient per 100 g with its unit, and a 估算 badge for a
// composite dish (values are recipe estimates, not measured food). Cards are
// 2 columns at the 390 px design width and 4 from 760 px.
//
// Selection (P11b): tapping a card toggles the food in `state.selections`
// (`toggleFood`, default measure x 1). A selected card is green and gets a
// quantity editor with the household measures plus "克", a 0.5-step count
// stepper (or a gram input) and the computed weight ("约 28 g"). The editor is
// a SIBLING of the card button, never a child of it, so no click inside it can
// toggle the card; the click handler also skips anything inside it. Selection
// is global, so the same food is pinned and green on every nutrient tab while
// the target cards update live.
//
// Card density and the 2/4-column grid follow the food-card grids of common
// nutrition trackers (see "Credits" in README.md); the markup and CSS are
// written from scratch.

import { formatAmount } from "../core/calc.js";
import {
  GRAMS_MEASURE_ID,
  formatGrams,
  measureOptions,
  normalizeSelection,
  stepCount,
} from "../core/measures.js";
import { MET_COLORS, nameZhOf, unitOf } from "../core/nutrients.js";
import { DEFAULT_LIMIT, LIMIT_STEP, foodsForNutrient, nextLimit, valueOf } from "../core/order.js";

/** Label above the grid, e.g. "维生素A · 每 100 克含量". */
export const UNIT_HINT_PREFIX = "每 100 克";
/** Badge text on a composite (recipe estimate) food card. */
export const ESTIMATE_BADGE = "估算";
/** Hint inside the search box. */
export const SEARCH_PLACEHOLDER = "搜索食物（中文或英文名）";
/** Note under the editor: household measures are rough. */
export const MEASURE_NOTE = "家庭计量为估算值";
/** Shown when a search matches nothing. */
export const NO_MATCH_TEXT = "没有匹配的食物。";

/** Focus targets inside one card cell, used after a re-render. */
const FOCUS_SELECTORS = Object.freeze({
  card: ".food-card",
  measure: "[data-measure]",
  minus: '[data-step="-1"]',
  plus: '[data-step="1"]',
  grams: "[data-grams]",
});

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
 * Short number text for a count or a gram weight: "1", "1.5", "28", "13.5".
 *
 * @param {number} value
 * @returns {string}
 */
export function shortNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
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
 * Look one food up by id (ids are unique in foods.json).
 *
 * @param {{foods?: Array<object>}|Array<object>|null|undefined} foods
 * @param {string} foodId
 * @returns {object|null}
 */
export function foodById(foods, foodId) {
  if (typeof foodId !== "string" || !foodId) return null;
  return foodArray(foods).find((food) => food.id === foodId) ?? null;
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
 * Quantity editor model of one selected food (PLAN.md 1.8 item 5).
 *
 * `measures.js` owns the maths: the model only picks the option list (the
 * food's household measures in data order plus the manual "克" entry), the
 * current count, the computed grams and the Chinese texts.
 *
 * @param {{id?: string, measures?: Array<object>}} food
 * @param {{measureId?: string, count?: number, grams?: number}} selection
 * @returns {{measureId: string, count: number, countText: string, grams: number,
 *   gramsText: string, manual: boolean, options: Array<{id: string,
 *   label: string, manual: boolean, selected: boolean}>}}
 */
export function editorModel(food, selection) {
  const current = normalizeSelection(food, selection);
  const manual = current.measureId === GRAMS_MEASURE_ID;

  const options = measureOptions(food).map((option) => ({
    id: option.id,
    // The per-unit weight goes into the label, so a user can compare "一碗" and
    // "一勺" before choosing. The manual entry has no weight of its own.
    label: option.grams === null
      ? option.labelZh
      : `${option.labelZh}（${shortNumber(option.grams)} g）`,
    manual: option.grams === null,
    selected: option.id === current.measureId,
  }));

  return {
    measureId: current.measureId,
    count: current.count,
    countText: shortNumber(current.count),
    grams: current.grams,
    gramsText: formatGrams(current.grams),
    manual,
    options,
  };
}

/**
 * Card models for one nutrient in display order.
 *
 * @param {{foods: object, nutrients: object, state: object,
 *   limit?: number, search?: string}} ctx
 *   `limit` is the number of unpinned cards (default 60); `search` filters by
 *   nameZh / nameEn / aliases and keeps the pinned foods on top (`order.js`)
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
  const search = typeof ctx.search === "string" ? ctx.search : "";
  const selections = state.selections && typeof state.selections === "object" ? state.selections : {};

  const list = foodsForNutrient(foodArray(ctx.foods), nutrientId, selections, { limit, search });

  return list.map((food) => {
    const selection = selections[food.id];
    const selected = Boolean(selection);
    const amountText = per100gText(food, nutrientId, unit);
    const base = `${food.nameZh}：每 100 克 ${amountText}`;
    return {
      id: food.id,
      nameZh: String(food.nameZh ?? ""),
      nameEn: String(food.nameEn ?? ""),
      amountText,
      estimate: food.estimate === true,
      selected,
      pinned: selected,
      title: food.estimate === true
        ? `${base}（按食谱估算）· 点击${selected ? "取消选择" : "选择"}`
        : `${base} · 点击${selected ? "取消选择" : "选择"}`,
      editor: selected ? editorModel(food, selection) : null,
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
 * Markup of the quantity editor of a selected card.
 *
 * Deliberately a sibling of the card `<button>`, never nested inside it: a
 * `<select>`/`<input>` inside a button is invalid HTML and a label click would
 * toggle the card (PLAN.md 1.8 item 5).
 *
 * @param {object} card card model with an `editor`
 * @returns {string} HTML
 */
export function editorHtml(card) {
  const editor = card.editor;
  if (!editor) return "";

  const options = editor.options.map((option) =>
    `<option value="${esc(option.id)}"${option.selected ? " selected" : ""}>${esc(option.label)}</option>`,
  ).join("");

  const quantity = editor.manual
    ? `<div class="food-editor__row">
        <input class="food-editor__grams-input" type="number" inputmode="decimal" min="0"
          step="1" value="${esc(shortNumber(editor.grams))}" data-grams
          aria-label="克数">
        <span class="food-editor__unit">克</span>
      </div>`
    : `<div class="food-editor__qty">
        <button type="button" class="food-editor__step" data-step="-1" aria-label="减少半份">−</button>
        <output class="food-editor__count">${esc(editor.countText)}</output>
        <button type="button" class="food-editor__step" data-step="1" aria-label="增加半份">+</button>
      </div>`;

  const weight = editor.manual
    ? ""
    : `<p class="food-editor__weight">${esc(editor.gramsText)}</p>`;

  return `<div class="food-editor" data-food-editor="${esc(card.id)}"
    style="--food-border:${MET_COLORS.border};--food-text:${MET_COLORS.text}">
    <label class="food-editor__label">
      <span class="visually-hidden">计量单位</span>
      <select class="food-editor__select" data-measure>${options}</select>
    </label>
    ${quantity}
    ${weight}
    ${editor.manual ? "" : `<p class="food-editor__note">${MEASURE_NOTE}</p>`}
  </div>`;
}

/**
 * One grid cell: the card button plus, when selected, its quantity editor.
 *
 * @param {object} card card model from `buildFoodCards`
 * @returns {string} HTML
 */
export function foodCellHtml(card) {
  const classes = ["food-cell", card.selected ? "food-cell--selected" : ""].filter(Boolean).join(" ");
  return `<div class="${classes}" data-food-cell="${esc(card.id)}">${foodCardHtml(card)}${editorHtml(card)}</div>`;
}

/**
 * Heading text of the list: the active nutrient and the "per 100 g" hint.
 *
 * @param {{nutrients: object, state: object}} ctx
 * @returns {string}
 */
export function foodsHeading(ctx) {
  const name = nameZhOf(ctx?.nutrients, ctx?.state?.activeNutrient, ctx?.state?.activeNutrient ?? "");
  return `${name} · ${UNIT_HINT_PREFIX}含量`;
}

/**
 * Grid, foot and note of the list (everything below the heading). Rendered
 * separately from the head so typing in the search box can refresh the results
 * without recreating the `<input>` the user is typing in.
 *
 * @param {Array<object>} cards card models
 * @param {{nutrients: object, state: object, more: number, search?: string}} ctx
 *   `more` = how many unpinned cards are still hidden
 * @returns {string} HTML
 */
export function foodsBodyHtml(cards, ctx) {
  const search = typeof ctx?.search === "string" ? ctx.search.trim() : "";
  let body;
  if (cards.length > 0) {
    body = `<div class="foods__grid">${cards.map(foodCellHtml).join("")}</div>`;
  } else if (search) {
    body = `<p class="status">${NO_MATCH_TEXT}</p>`;
  } else {
    body = '<p class="status">该营养素暂无食物数据。</p>';
  }

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

  return `${body}${foot}${note}`;
}

/**
 * The whole section: heading, search box and the list body.
 *
 * @param {Array<object>} cards card models
 * @param {{nutrients: object, state: object, more: number, search?: string}} ctx
 * @returns {string} HTML
 */
export function foodsHtml(cards, ctx) {
  const search = typeof ctx?.search === "string" ? ctx.search : "";
  return `<div class="foods__head">
      <h2 class="foods__title">食物含量排行</h2>
      <p class="foods__hint">${esc(foodsHeading(ctx ?? {}))}</p>
    </div>
    <div class="foods__search">
      <label class="visually-hidden" for="food-search">搜索食物</label>
      <input type="search" id="food-search" class="foods__search-input" data-food-search
        placeholder="${esc(SEARCH_PLACEHOLDER)}" autocomplete="off" spellcheck="false"
        value="${esc(search)}">
    </div>
    <div class="foods__body" data-food-body>${foodsBodyHtml(cards, ctx)}</div>
    <p class="foods__note">点击卡片可选择或取消食物；已选食物固定在列表最前，家庭计量为估算值。</p>`;
}

/**
 * Number of foods still hidden behind "show more" for one limit and search.
 *
 * Only the unpinned part is limited, so the pinned (selected) foods always
 * count as visible. Computed through `foodsForNutrient` (unbounded minus
 * bounded) so the count, the search filter and the grid can never disagree.
 *
 * @param {{foods: object, state: object}} ctx
 * @param {number} limit current unpinned limit
 * @param {string} [search] search text
 * @returns {number}
 */
export function hiddenCount(ctx, limit, search = "") {
  const nutrientId = ctx?.state?.activeNutrient;
  const selections = ctx?.state?.selections ?? {};
  if (!nutrientId) return 0;
  const foods = foodArray(ctx?.foods);
  const all = foodsForNutrient(foods, nutrientId, selections, { limit: Number.MAX_SAFE_INTEGER, search });
  const shownLimit = Number.isFinite(Number(limit)) && Number(limit) >= 0
    ? Math.floor(Number(limit))
    : DEFAULT_LIMIT;
  const shown = foodsForNutrient(foods, nutrientId, selections, { limit: shownLimit, search });
  return Math.max(0, all.length - shown.length);
}

/**
 * The view state of one section element: search text and unpinned limit.
 *
 * Both are view preferences (not persisted), kept on the DOM node so a state
 * change re-renders without losing what the user typed.
 *
 * @param {HTMLElement} container
 * @returns {{limit: number, search: string}}
 */
function viewOf(container) {
  return {
    limit: Number.isFinite(container._foodsLimit) ? container._foodsLimit : DEFAULT_LIMIT,
    search: typeof container._foodsSearch === "string" ? container._foodsSearch : "",
  };
}

/**
 * Build body markup for the current state and view.
 *
 * @param {HTMLElement} container
 * @param {object} ctx
 * @returns {string}
 */
function bodyHtmlFor(container, ctx) {
  const view = viewOf(container);
  const shared = {
    foods: ctx.foods,
    nutrients: ctx.nutrients,
    state: ctx.state,
    limit: view.limit,
    search: view.search,
  };
  const cards = buildFoodCards(shared);
  return foodsBodyHtml(cards, {
    nutrients: ctx.nutrients,
    state: ctx.state,
    more: hiddenCount(shared, view.limit, view.search),
    search: view.search,
  });
}

/**
 * Find the grid cell of one food (ids contain ":", so no CSS selector escaping
 * is needed this way).
 *
 * @param {HTMLElement} container
 * @param {string} foodId
 * @returns {HTMLElement|null}
 */
function cellFor(container, foodId) {
  const cells = container.querySelectorAll("[data-food-cell]");
  for (const cell of cells) {
    if (cell.dataset.foodCell === foodId) return cell;
  }
  return null;
}

/**
 * Focus back on the control the user just used (the grid is rebuilt on every
 * state change, so the old element is gone).
 *
 * @param {HTMLElement} container
 */
function restoreFocus(container) {
  const focus = container._foodsFocus;
  container._foodsFocus = null;
  if (!focus) return;
  const cell = cellFor(container, focus.foodId);
  if (!cell) return;
  const element = cell.querySelector(FOCUS_SELECTORS[focus.part] ?? FOCUS_SELECTORS.card);
  if (element) element.focus({ preventScroll: true });
}

/**
 * Click handler: "show more", or toggle a food.
 *
 * @param {Event} event
 */
function handleClick(event) {
  const container = event.currentTarget;
  const ctx = container._foodsCtx;
  if (!ctx) return;

  if (event.target.closest("[data-more]")) {
    container._foodsLimit = nextLimit(viewOf(container).limit);
    container._foodsKeepFocus = true;
    renderFoods(container, ctx);
    return;
  }

  // The editor is a sibling of the card button; this guard keeps any future
  // nested control from ever toggling the food (PLAN.md 1.8 item 5).
  if (event.target.closest(".food-editor")) {
    const step = event.target.closest("[data-step]");
    if (!step) return;
    const editor = step.closest("[data-food-editor]");
    if (!editor) return;
    const foodId = editor.dataset.foodEditor;
    const food = foodById(ctx.foods, foodId);
    const selection = ctx.state.selections?.[foodId];
    if (!food || !selection) return;
    if (selection.measureId === GRAMS_MEASURE_ID) return;

    const steps = Number(step.dataset.step);
    const count = stepCount(selection.count, Number.isFinite(steps) ? steps : 0);
    container._foodsFocus = { foodId, part: steps < 0 ? "minus" : "plus" };
    ctx.onChange("setQuantity", { foodId, quantity: { measureId: selection.measureId, count }, food });
    return;
  }

  const button = event.target.closest(".food-card[data-food]");
  if (!button || !container.contains(button)) return;
  const food = foodById(ctx.foods, button.dataset.food);
  if (!food) return;

  container._foodsFocus = { foodId: food.id, part: "card" };
  ctx.onChange("toggleFood", food);
}

/**
 * Change handler for the quantity editor: measure select or gram input.
 *
 * @param {Event} event
 */
function handleChange(event) {
  const container = event.currentTarget;
  const ctx = container._foodsCtx;
  if (!ctx) return;
  const editor = event.target.closest("[data-food-editor]");
  if (!editor) return;

  const foodId = editor.dataset.foodEditor;
  const food = foodById(ctx.foods, foodId);
  if (!food) return;
  const selection = ctx.state.selections?.[foodId];
  if (!selection) return;

  const target = event.target;
  if (target.matches("[data-measure]")) {
    const measureId = target.value;
    const current = normalizeSelection(food, selection);
    // Switching to "克" keeps the current weight; a household measure starts at
    // one unit (the user can then step it up or down in 0.5 steps).
    const quantity = measureId === GRAMS_MEASURE_ID
      ? { measureId: GRAMS_MEASURE_ID, grams: current.grams }
      : { measureId, count: 1 };
    container._foodsFocus = { foodId, part: "measure" };
    ctx.onChange("setQuantity", { foodId, quantity, food });
    return;
  }

  if (target.matches("[data-grams]")) {
    const grams = Number(target.value);
    container._foodsFocus = { foodId, part: "grams" };
    ctx.onChange("setQuantity", {
      foodId,
      quantity: { measureId: GRAMS_MEASURE_ID, grams: Number.isFinite(grams) && grams > 0 ? grams : 0 },
      food,
    });
  }
}

/**
 * Input handler: the search box.
 *
 * Only the list body is replaced, so the `<input>` keeps its value, focus and
 * IME composition while the results filter underneath.
 *
 * @param {Event} event
 */
function handleInput(event) {
  const container = event.currentTarget;
  const ctx = container._foodsCtx;
  if (!ctx) return;
  if (!event.target.matches("[data-food-search]")) return;

  container._foodsSearch = event.target.value;
  container._foodsLimit = DEFAULT_LIMIT;
  const body = container.querySelector("[data-food-body]");
  if (body) body.innerHTML = bodyHtmlFor(container, ctx);
}

/**
 * Render (or re-render) the food list into `container`.
 *
 * @param {HTMLElement|null} container section in index.html
 * @param {{state: object, nutrients: object, foods: object, onChange: Function}} ctx
 *   `onChange(action, payload)` applies a state.js reducer in the caller
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

  const view = viewOf(container);
  const shared = {
    foods: ctx.foods,
    nutrients: ctx.nutrients,
    state: ctx.state,
    limit: view.limit,
    search: view.search,
  };
  const cards = buildFoodCards(shared);

  container.innerHTML = foodsHtml(cards, {
    nutrients: ctx.nutrients,
    state: ctx.state,
    more: hiddenCount(shared, view.limit, view.search),
    search: view.search,
  });
  container.classList.add("panel", "panel--foods");
  container.setAttribute("aria-busy", "false");

  container._foodsCtx = ctx;
  if (!container._foodsBound) {
    container._foodsBound = true;
    container.addEventListener("click", handleClick);
    container.addEventListener("change", handleChange);
    container.addEventListener("input", handleInput);
  }

  restoreFocus(container);

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
  SEARCH_PLACEHOLDER,
  MEASURE_NOTE,
  NO_MATCH_TEXT,
  shortNumber,
  foodArray,
  foodById,
  per100gText,
  editorModel,
  buildFoodCards,
  foodCardHtml,
  editorHtml,
  foodCellHtml,
  foodsHeading,
  foodsBodyHtml,
  foodsHtml,
  hiddenCount,
  renderFoods,
};
