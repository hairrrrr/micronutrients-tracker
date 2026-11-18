// Food list for the active nutrient: one card per food in `order.js` order
// (pinned selections in confirmation order, then commonness first and the
// richest comparison portion within a tier), with a "show more" button that
// raises the limit by 60 and a search box (PLAN.md 1.7 and 1.8 item 5, phases
// P11a, P11b, P17, P18b and P19b).
//
// Amounts (P19b): an ordinary card shows the per-100 g value labelled 每 100 g.
// Condiments, spices, cooking oils and dried goods carry `amountBasisG` 10 in
// foods.json because they are eaten by the spoonful; their card divides the
// per-100 g value by 10 and labels it 每 10 g. The editor always computes the
// contribution from grams x per100g / 100, so the basis only changes how the
// card compares and describes the food, never the intake maths.
//
// Bone-in foods (P20): the household measures and the gram input of a food
// with `refusePct` mean the weight WITH the bone. The card and the editor say
// so ("带骨重量") and show the edible part ("可食部约 X g"), which is what the
// nutrients use (calc.js converts before multiplying per100g).
//
// Rendering only: ordering, the limit, the search text and the selections all
// come from the pure modules (`core/order.js`, `core/measures.js`,
// `core/state.js` values passed in by `app.js`). This module never touches
// localStorage and never mutates state: a control reports a reducer call
// through `ctx.onChange`, `app.js` applies it, saves and re-renders everything.
//
// Expand-in-place editing (P17). A tap on a card does not select anything: the
// card expands at its own grid position into a full-row editing tile (the grid
// cell spans every column, so the cards before and after stay in normal flow
// and the tapped food keeps its index). The tile shows the food name, the
// per-100 g amount, the quantity editor (household measure select + count
// stepper, or a gram input), a round check-mark button at its top right, a 确认
// button and 取消. Only 确认 selects the food (with the chosen quantity) and
// collapses the tile; the food then joins the BOTTOM of the pinned group
// because the pinned order is the confirmation order stored in `state.order`.
// 取消 collapses without selecting. Tapping an already selected (pinned) card
// reopens the same tile with the current quantity and adds 取消选择 (deselect);
// 确认 there saves the quantity and keeps the pinned position.
//
// The open tile, its draft quantity and the search/limit are UI-only: they are
// kept on the section DOM node, never in the persisted state, so an unconfirmed
// draft contributes nothing to the totals.
//
// The select never triggers a re-render of itself: a measure change only
// updates the draft and the quantity block below it (P17c, the measure picker
// used to pop up a second time because the change handler re-rendered the whole
// list and refocused the new <select>).
//
// Card density and the 2/4-column grid follow the food-card grids of common
// nutrition trackers (see "Credits" in README.md); the markup and CSS are
// written from scratch.

import { formatAmount } from "../core/calc.js";
import {
  GRAMS_MEASURE_ID,
  WITH_BONE_LABEL,
  edibleGrams,
  formatEdibleGrams,
  formatGrams,
  isBoneIn,
  measureOptions,
  measuresOf,
  normalizeSelection,
  stepCount,
} from "../core/measures.js";
import { MET_COLORS, nameZhOf, unitOf } from "../core/nutrients.js";
import { DEFAULT_LIMIT, LIMIT_STEP, amountBasisGOf, commonnessOf, foodsForNutrient, nextLimit, valueOf } from "../core/order.js";
import { FALLBACK_GRAMS } from "../core/state.js";
import { DETAIL_LABEL, openDetail } from "./detail.js";

/**
 * Ordering hint of the meta line, e.g. "维生素A · 按常见度排序".
 *
 * P19b: the meta line no longer claims a per-100 g basis, because condiments
 * and dried goods are shown per 10 g; every card carries its own label.
 */
export const ORDER_HINT = "按常见度排序";
/** Amount basis label of an ordinary food card (per 100 g). */
export const BASIS_100_LABEL = "每 100 g";
/** Amount basis label of a small-portion food card (P19b, per 10 g). */
export const BASIS_10_LABEL = "每 10 g";
/**
 * Small commonness badge for everyday foods (P18b): tier 5 = a staple almost
 * everywhere, tier 4 = very common. Tiers 1-3 get no badge.
 *
 * @type {Readonly<Record<number, string>>}
 */
export const COMMON_BADGES = Object.freeze({ 4: "常见", 5: "★常见" });
/** Screen-reader/title expansion of the commonness badge. */
export const COMMON_BADGE_TITLE = "常见度：日常饮食中经常出现（AI 估算）";
/** Hint inside the search box. */
export const SEARCH_PLACEHOLDER = "搜索食物（中文或英文名）";
/** Note under the editor: household measures are rough. */
export const MEASURE_NOTE = "家庭计量为估算值";
/** Note of a bone-in food: the weighed amount includes the bone (P20). */
export const BONE_NOTE = "带骨称重，营养素按可食部计算";
/** Shown when a search matches nothing. */
export const NO_MATCH_TEXT = "没有匹配的食物。";
/** Confirm control of an expanded tile (the round check mark and the button). */
export const CONFIRM_LABEL = "确认";
/** Cancel control of an expanded tile: collapse without selecting. */
export const CANCEL_LABEL = "取消";
/** Deselect control of an expanded tile of an already selected food. */
export const DESELECT_LABEL = "取消选择";

/**
 * Draft quantity of a tile that is about to be opened: the current selection
 * when the food is pinned, otherwise the food's default measure x 1 (100 g for
 * a food without a measure row).
 *
 * @param {{id?: string, measures?: Array<object>}} food
 * @param {{measureId?: string, count?: number, grams?: number}|null} [selection]
 * @returns {{measureId: string, count: number, grams: number}}
 */
export function draftQuantity(food, selection) {
  if (selection && typeof selection === "object") return normalizeSelection(food, selection);
  if (measuresOf(food).length === 0) {
    return { measureId: GRAMS_MEASURE_ID, count: 0, grams: FALLBACK_GRAMS };
  }
  return normalizeSelection(food, undefined);
}

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
 * Amount text of one food on its comparison basis (P19b).
 *
 * Ordinary foods are shown per 100 g, exactly like `per100gText`. Condiments,
 * spices, cooking oils and dried goods have `amountBasisG` 10: their per-100 g
 * value is divided by 10 so the card shows what a spoonful actually supplies.
 * The nutrients themselves are never changed, only the displayed portion.
 *
 * @param {object} food foods.json food
 * @param {string} nutrientId
 * @param {string} unit e.g. "ug RAE"
 * @returns {string} e.g. "18.1 mg"
 */
export function amountText(food, nutrientId, unit) {
  const value = valueOf(food, nutrientId);
  if (value === null) return "无数据";
  return formatAmount((value * amountBasisGOf(food)) / 100, unit);
}

/**
 * Small basis label under the amount: "每 10 g" for a small-portion food,
 * "每 100 g" otherwise (P19b).
 *
 * @param {object} food foods.json food
 * @returns {string}
 */
export function basisLabel(food) {
  return amountBasisGOf(food) === 10 ? BASIS_10_LABEL : BASIS_100_LABEL;
}

/**
 * Quantity editor model of one food (PLAN.md 1.8 item 5).
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
    // P20: a bone-in food is weighed with the bone; the editor says so and
    // shows the edible part that the nutrients actually use.
    boneIn: isBoneIn(food),
    boneText: boneTextOf(food, current.grams),
    boneNote: String(food?.refuseNote ?? ""),
  };
}

/**
 * Chinese note of a bone-in weighed amount: "带骨重量 · 可食部约 70 g".
 *
 * @param {{refusePct?: number}} food
 * @param {number} grams weighed with-bone grams
 * @returns {string} empty for an ordinary food
 */
export function boneTextOf(food, grams) {
  if (!isBoneIn(food)) return "";
  return `${WITH_BONE_LABEL} · ${formatEdibleGrams(food, grams)}`;
}

/**
 * Share of the edible part of a bone-in food, e.g. "可食部约 70%".
 *
 * @param {{refusePct?: number}} food
 * @returns {string} empty for an ordinary food
 */
export function boneShareText(food) {
  if (!isBoneIn(food)) return "";
  const share = Math.round((100 - Number(food.refusePct)) * 10) / 10;
  return `可食部约 ${shortNumber(share)}%`;
}

/**
 * Card models for one nutrient in display order.
 *
 * @param {{foods: object, nutrients: object, state: object,
 *   limit?: number, search?: string, expandedId?: string|null,
 *   quantity?: object|null}} ctx
 *   `limit` is the number of unpinned cards (default 60); `search` filters by
 *   nameZh / nameEn / aliases and keeps the pinned foods on top; `expandedId`
 *   and `quantity` are the UI-only open tile and its draft (P17)
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
  const order = Array.isArray(state.order) ? state.order : [];
  const expandedId = typeof ctx.expandedId === "string" ? ctx.expandedId : null;
  const draft = ctx.quantity && typeof ctx.quantity === "object" ? ctx.quantity : null;

  const list = foodsForNutrient(foodArray(ctx.foods), nutrientId, selections, { limit, search, order });

  return list.map((food) => {
    const selection = selections[food.id];
    const selected = Boolean(selection);
    const expanded = expandedId === food.id;
    const cardAmount = amountText(food, nutrientId, unit);
    const basis = basisLabel(food);
    const amountBasisG = amountBasisGOf(food);
    const base = `${food.nameZh}：${basis} ${cardAmount}`;
    // P20: a bone-in food is weighed with the bone, so the card says so and
    // spells out how much of a 100 g weighed portion is edible.
    const boneIn = isBoneIn(food);
    const boneText = boneIn ? boneShareText(food) : "";
    const title = boneIn
      ? `${base}（${boneText}）· 点击${selected ? "修改份量" : "选择"}`
      : `${base} · 点击${selected ? "修改份量" : "选择"}`;
    const quantity = expanded ? (draft ?? selection ?? draftQuantity(food, null)) : null;
    const commonness = commonnessOf(food);
    return {
      id: food.id,
      nameZh: String(food.nameZh ?? ""),
      nameEn: String(food.nameEn ?? ""),
      amountText: cardAmount,
      amountBasisG,
      basisLabel: basis,
      smallPortion: amountBasisG === 10,
      boneIn,
      boneText,
      boneNote: String(food.refuseNote ?? ""),
      commonness,
      commonBadge: COMMON_BADGES[commonness] ?? "",
      selected,
      pinned: selected,
      expanded,
      title,
      editor: quantity ? editorModel(food, quantity) : null,
    };
  });
}

/**
 * Commonness badge of a card (P18b): tiers 4-5 only. Shared by the compact
 * card, its expanded tile head and the tile's card body.
 *
 * @param {object} card card model from `buildFoodCards`
 * @returns {string} HTML, empty for tiers 1-3
 */
function commonBadgeHtml(card) {
  if (!card.commonBadge) return "";
  return `<span class="food-card__badge food-card__badge--common"
        title="${esc(COMMON_BADGE_TITLE)}">${esc(card.commonBadge)}</span>`;
}

/**
 * Markup of the head of a food card: name, commonness badge, English name and
 * the amount on the card's basis (per 100 g, or per 10 g for small-portion
 * foods). A bone-in food adds a short "带骨重量" note. Shared by the compact
 * card and the expanded tile.
 *
 * @param {object} card card model from `buildFoodCards`
 * @param {{withName?: boolean}} [options] `withName: false` leaves the name out:
 *   the expanded tile shows it in its own head row next to the 查看详情 button,
 *   because a button cannot contain the detail button (P21c)
 * @returns {string} HTML
 */
function cardBodyHtml(card, options = {}) {
  const common = commonBadgeHtml(card);
  const english = card.nameEn ? `<span class="food-card__en">${esc(card.nameEn)}</span>` : "";
  // The basis label stays visible on every card (P19b): a spoonful of sesame
  // paste must not read like a 100 g portion.
  const basis = card.basisLabel
    ? `<span class="food-card__basis">${esc(card.basisLabel)}</span>`
    : "";
  // P20: a bone-in food is measured with the bone; the card says so and gives
  // the edible share, so the per-100 g amount is not mistaken for a whole-cut
  // weight.
  const bone = card.boneIn
    ? `<span class="food-card__bone" title="${esc(card.boneNote)}">${esc(WITH_BONE_LABEL)} · ${esc(card.boneText)}</span>`
    : "";
  // The expanded tile shows the name in its own head row next to the 查看详情
  // button (P21c), so its card body keeps only a screen-reader name.
  const head = options.withName === false
    ? `<span class="visually-hidden">${esc(card.nameZh)}</span>`
    : `<span class="food-card__head">
      <span class="food-card__name">${esc(card.nameZh)}</span>
      ${common}
    </span>`;
  return `${head}
    ${english}
    <span class="food-card__amount">${esc(card.amountText)}</span>
    ${basis}${bone}`;
}

/** Inline custom properties of the single "met" green (selected card). */
function metStyle(card) {
  return card.pinned
    ? ` style="--food-bg:${MET_COLORS.background};--food-border:${MET_COLORS.border};--food-text:${MET_COLORS.text}"`
    : "";
}

/**
 * Markup of one compact food card. A `<button>` with `aria-pressed` so the card
 * is keyboard reachable and its selected state is announced (PLAN.md 1.8
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

  return `<button type="button" class="${classes}" data-food="${esc(card.id)}"${metStyle(card)}
    aria-pressed="${card.selected ? "true" : "false"}" title="${esc(card.title)}">
    ${cardBodyHtml(card)}
  </button>`;
}

/**
 * Markup of the quantity block (stepper or gram input) of the editor.
 *
 * Kept separate so a measure change can refresh only this block and the weight
 * text: the `<select>` node itself is never replaced or refocused (P17c).
 *
 * @param {object} editor editor model from `editorModel`
 * @returns {string} HTML
 */
export function quantityHtml(editor) {
  if (editor.manual) {
    return `<div class="food-editor__row">
        <input class="food-editor__grams-input" type="number" inputmode="decimal" min="0"
          step="1" value="${esc(shortNumber(editor.grams))}" data-grams
          aria-label="克数">
        <span class="food-editor__unit">克</span>
      </div>`;
  }
  return `<div class="food-editor__qty">
        <button type="button" class="food-editor__step" data-step="-1" aria-label="减少半份">−</button>
        <output class="food-editor__count" data-count>${esc(editor.countText)}</output>
        <button type="button" class="food-editor__step" data-step="1" aria-label="增加半份">+</button>
      </div>`;
}

/**
 * Markup of the quantity editor of an open tile (PLAN.md 1.8 item 5, P17).
 *
 * Deliberately not nested inside the card `<button>`: a `<select>`/`<input>`
 * inside a button is invalid HTML and a label click would toggle the card.
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

  const weight = editor.manual
    ? ""
    : esc(editor.gramsText);

  // P20: a bone-in food's weight includes the bone, so the editor labels the
  // weight "带骨重量" and spells out the edible part that the nutrients use.
  const boneLabel = editor.boneIn ? `${WITH_BONE_LABEL} ` : "";
  const bone = editor.boneIn
    ? `<p class="food-editor__bone" data-bone>${esc(editor.boneText)}</p>
    <p class="food-editor__note food-editor__note--bone" data-bone-note
      title="${esc(editor.boneNote)}">${esc(BONE_NOTE)}</p>`
    : "";

  return `<div class="food-editor" data-food-editor="${esc(card.id)}"
    style="--food-border:${MET_COLORS.border};--food-text:${MET_COLORS.text}">
    <label class="food-editor__label">
      <span class="visually-hidden">计量单位</span>
      <select class="food-editor__select" data-measure>${options}</select>
    </label>
    <div class="food-editor__fields" data-qty>${quantityHtml(editor)}</div>
    <p class="food-editor__weight" data-weight${editor.manual ? " hidden" : ""}>${boneLabel}${weight}</p>
    <p class="food-editor__note" data-note${editor.manual ? " hidden" : ""}>${editor.manual ? "" : MEASURE_NOTE}</p>
    ${bone}
  </div>`;
}

/**
 * Markup of an expanded tile: the same information as a card plus the quantity
 * editor, the round check button and the 确认 / 取消选择 / 取消 row.
 *
 * The check and the buttons carry their food id in a `data-*` value, so a
 * handler can look the food up without escaping ids into CSS selectors.
 *
 * @param {object} card card model with `expanded: true` and an `editor`
 * @returns {string} HTML
 */
export function expandedTileHtml(card) {
  const deselect = card.selected
    ? `<button type="button" class="food-tile__btn food-tile__btn--danger"
        data-deselect="${esc(card.id)}">${DESELECT_LABEL}</button>`
    : "";

  return `<div class="food-tile${card.selected ? " is-selected" : ""}"${metStyle(card)}
    data-food-tile="${esc(card.id)}">
    <div class="food-tile__head">
      <span class="food-tile__title">${esc(card.nameZh)}</span>
      ${commonBadgeHtml(card)}
      <button type="button" class="food-tile__detail" data-detail="${esc(card.id)}"
        aria-haspopup="dialog">${DETAIL_LABEL}</button>
    </div>
    <button type="button" class="food-card food-card--expanded" data-food="${esc(card.id)}"
      aria-pressed="${card.selected ? "true" : "false"}" aria-expanded="true"
      title="${esc(card.title)}">
      ${cardBodyHtml(card, { withName: false })}
    </button>
    <button type="button" class="food-tile__check" data-confirm="${esc(card.id)}"
      aria-label="${CONFIRM_LABEL}" title="${CONFIRM_LABEL}">✓</button>
    ${editorHtml(card)}
    <div class="food-tile__actions">
      <button type="button" class="food-tile__btn food-tile__btn--primary"
        data-confirm="${esc(card.id)}">${CONFIRM_LABEL}</button>
      ${deselect}
      <button type="button" class="food-tile__btn" data-cancel="${esc(card.id)}">${CANCEL_LABEL}</button>
    </div>
  </div>`;
}

/**
 * One grid cell: a compact card button, or the expanded tile at the same
 * position (the cell spans the whole row through CSS, so the cards around it
 * stay in normal flow and the food keeps its index).
 *
 * @param {object} card card model from `buildFoodCards`
 * @returns {string} HTML
 */
export function foodCellHtml(card) {
  const classes = [
    "food-cell",
    card.selected ? "food-cell--selected" : "",
    card.expanded ? "food-cell--expanded" : "",
  ].filter(Boolean).join(" ");
  const content = card.expanded ? expandedTileHtml(card) : foodCardHtml(card);
  const expandedAttr = card.expanded ? ' data-expanded="true"' : "";
  return `<div class="${classes}" data-food-cell="${esc(card.id)}"${expandedAttr}>${content}</div>`;
}

/**
 * Heading text of the list: the active nutrient and the ordering hint.
 *
 * The meta line no longer claims a single per-100 g basis (P19b): most cards
 * are per 100 g but condiments and dried goods are per 10 g, and each card
 * carries its own label.
 *
 * @param {{nutrients: object, state: object}} ctx
 * @returns {string}
 */
export function foodsHeading(ctx) {
  const name = nameZhOf(ctx?.nutrients, ctx?.state?.activeNutrient, ctx?.state?.activeNutrient ?? "");
  return `${name} · ${ORDER_HINT}`;
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

  // P20: dish estimates are gone; the only remaining note is the bone-in
  // reminder, which is about how the weight is read, not about the data.
  const note = cards.some((card) => card.boneIn)
    ? `<p class="foods__note">标有“${WITH_BONE_LABEL}”的食物按带骨重量称量，营养素按可食部（去骨）计算。</p>`
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
      <h2 class="foods__title">常见食物</h2>
      <p class="foods__hint">${esc(foodsHeading(ctx ?? {}))}</p>
    </div>
    <div class="foods__search">
      <label class="visually-hidden" for="food-search">搜索食物</label>
      <input type="search" id="food-search" class="foods__search-input" data-food-search
        placeholder="${esc(SEARCH_PLACEHOLDER)}" autocomplete="off" spellcheck="false"
        value="${esc(search)}">
    </div>
    <div class="foods__body" data-food-body>${foodsBodyHtml(cards, ctx)}</div>
    <p class="foods__note">点击卡片就地展开，确认后才会加入已选；已选食物按确认顺序排在列表最前；其余食物按常见度优先、同一档内再按含量排序（调味料、香辛料、食用油和干货按每 10 g 计，其余按每 100 g 计）；本列表只显示含有该营养素的食物；家庭计量为估算值。</p>`;
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
  const order = Array.isArray(ctx?.state?.order) ? ctx.state.order : [];
  if (!nutrientId) return 0;
  const foods = foodArray(ctx?.foods);
  const all = foodsForNutrient(foods, nutrientId, selections, {
    limit: Number.MAX_SAFE_INTEGER,
    search,
    order,
  });
  const shownLimit = Number.isFinite(Number(limit)) && Number(limit) >= 0
    ? Math.floor(Number(limit))
    : DEFAULT_LIMIT;
  const shown = foodsForNutrient(foods, nutrientId, selections, {
    limit: shownLimit,
    search,
    order,
  });
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
 * The UI-only open tile of one section: the food id and its draft quantity
 * (never part of the persisted state).
 *
 * @param {HTMLElement} container
 * @returns {{expandedId: string|null, quantity: object|null}}
 */
function expandedOf(container) {
  const draft = container._foodsDraft;
  const expandedId = typeof container._foodsExpanded === "string" ? container._foodsExpanded : null;
  return {
    expandedId,
    quantity: draft && draft.foodId === expandedId ? draft.quantity : null,
  };
}

/**
 * Build card models for the current state and view.
 *
 * @param {HTMLElement} container
 * @param {object} ctx
 * @returns {Array<object>}
 */
function cardsFor(container, ctx) {
  const view = viewOf(container);
  const open = expandedOf(container);
  return buildFoodCards({
    foods: ctx.foods,
    nutrients: ctx.nutrients,
    state: ctx.state,
    limit: view.limit,
    search: view.search,
    expandedId: open.expandedId,
    quantity: open.quantity,
  });
}

/**
 * Body markup for the current state and view.
 *
 * @param {HTMLElement} container
 * @param {object} ctx
 * @returns {string}
 */
function bodyHtmlFor(container, ctx) {
  const view = viewOf(container);
  let cards = cardsFor(container, ctx);
  // A search that hides the open tile drops it, so a later reopen cannot
  // revive a stale draft.
  if (container._foodsExpanded && !cards.some((card) => card.id === container._foodsExpanded)) {
    container._foodsExpanded = null;
    container._foodsDraft = null;
    cards = cardsFor(container, ctx);
  }
  return foodsBodyHtml(cards, {
    nutrients: ctx.nutrients,
    state: ctx.state,
    more: hiddenCount({
      foods: ctx.foods,
      state: ctx.state,
    }, view.limit, view.search),
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
 * Put the focus back on a card button after a re-render. The `<select>` is
 * never focused here: focusing a select on a touch browser opens the native
 * picker again (P17c).
 *
 * @param {HTMLElement} container
 * @param {string} foodId
 */
function focusCard(container, foodId) {
  const cell = cellFor(container, foodId);
  if (!cell) return;
  const button = cell.querySelector(".food-card");
  if (button) button.focus({ preventScroll: true });
}

/**
 * Update the quantity block and the weight text of the open tile after a draft
 * change, without replacing the `<select>` or any other node that holds the
 * focus (P17c).
 *
 * @param {HTMLElement} container
 * @param {object} food
 * @returns {void}
 */
function refreshEditor(container, food) {
  const cell = cellFor(container, food.id);
  if (!cell) return;
  const editor = cell.querySelector("[data-food-editor]");
  const draft = container._foodsDraft;
  if (!editor || !draft || draft.foodId !== food.id) return;

  const model = editorModel(food, draft.quantity);
  const fields = editor.querySelector("[data-qty]");
  if (fields) {
    const gramsNow = fields.querySelector("[data-grams]");
    if (Boolean(gramsNow) !== model.manual) {
      // Mode change (household <-> grams): swap the whole block once.
      fields.innerHTML = quantityHtml(model);
    } else if (gramsNow) {
      if (document.activeElement !== gramsNow) gramsNow.value = shortNumber(model.grams);
    } else {
      const count = fields.querySelector("[data-count]");
      if (count) count.textContent = model.countText;
    }
  }

  const weight = editor.querySelector("[data-weight]");
  if (weight) {
    // P20: a bone-in weight keeps its 带骨重量 label next to the grams.
    const label = model.boneIn ? `${WITH_BONE_LABEL} ` : "";
    weight.textContent = model.manual ? "" : `${label}${model.gramsText}`;
    weight.hidden = model.manual;
  }
  const note = editor.querySelector("[data-note]");
  if (note) {
    note.textContent = model.manual ? "" : MEASURE_NOTE;
    note.hidden = model.manual;
  }
  // P20: the edible part follows the draft weight without a re-render.
  const bone = editor.querySelector("[data-bone]");
  if (bone) bone.textContent = model.boneText;
}

/**
 * Open the editing tile of one food at its current position, collapsing any
 * other open tile. Duck-typed context keeps the handlers free of globals.
 *
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {object} food
 */
function openEditor(container, ctx, food) {
  if (container._foodsExpanded === food.id) {
    collapseEditor(container, ctx, food.id);
    return;
  }
  const selection = ctx.state.selections?.[food.id] ?? null;
  container._foodsExpanded = food.id;
  container._foodsDraft = { foodId: food.id, quantity: draftQuantity(food, selection) };
  renderFoods(container, ctx);
  focusCard(container, food.id);
}

/**
 * Collapse the open tile without touching the state (取消, or a tap on the open
 * card).
 *
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {string} [foodId] only collapse when this tile is the open one
 */
function collapseEditor(container, ctx, foodId) {
  if (foodId && container._foodsExpanded !== foodId) return;
  const openId = container._foodsExpanded;
  container._foodsExpanded = null;
  container._foodsDraft = null;
  renderFoods(container, ctx);
  if (typeof openId === "string") focusCard(container, openId);
}

/**
 * Confirm the open tile: select the food with the draft quantity (or update the
 * quantity of an already selected food, which keeps its pinned position), then
 * collapse.
 *
 * @param {HTMLElement} container
 * @param {object} ctx
 * @param {string} foodId
 */
function confirmEditor(container, ctx, foodId) {
  const food = foodById(ctx.foods, foodId);
  if (!food) return;
  const draft = container._foodsDraft;
  const quantity = draft && draft.foodId === foodId ? draft.quantity : undefined;
  // The gram input commits on `change`, which a tap on the check button does
  // fire (the input blurs first), but read the live value anyway so a confirm
  // can never save a stale draft.
  const live = cellFor(container, foodId)?.querySelector("[data-grams]");
  let final = quantity;
  if (live && quantity) {
    const grams = Number(live.value);
    final = normalizeSelection(food, {
      measureId: GRAMS_MEASURE_ID,
      grams: Number.isFinite(grams) && grams > 0 ? grams : 0,
    });
  }
  container._foodsExpanded = null;
  container._foodsDraft = null;
  ctx.onChange("confirmFood", { food, quantity: final });
}

/**
 * Click handler: "show more", the open tile's controls (confirm / cancel /
 * deselect / step), or opening a card's editor.
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

  // P21c: 查看详情 opens the shared detail sheet. It must not toggle the tile
  // or confirm anything, so it is handled before the card button.
  const detail = event.target.closest("[data-detail]");
  if (detail && container.contains(detail)) {
    const food = foodById(ctx.foods, detail.dataset.detail);
    if (!food) return;
    const draft = container._foodsDraft;
    const live = cellFor(container, food.id)?.querySelector("[data-grams]");
    let grams = null;
    if (draft && draft.foodId === food.id) {
      grams = draft.quantity?.grams ?? null;
    } else {
      grams = ctx.state.selections?.[food.id]?.grams ?? null;
    }
    // A gram input that was typed but not blurred yet is the visible quantity:
    // read it so the sheet matches what the user sees, without saving it.
    if (live) {
      const typed = Number(live.value);
      if (Number.isFinite(typed) && typed > 0) grams = typed;
    }
    openDetail({
      food,
      dri: ctx.dri,
      state: ctx.state,
      nutrients: ctx.nutrients,
      grams,
      trigger: detail,
    });
    return;
  }

  const confirm = event.target.closest("[data-confirm]");
  if (confirm && container.contains(confirm)) {
    confirmEditor(container, ctx, confirm.dataset.confirm);
    return;
  }

  const cancel = event.target.closest("[data-cancel]");
  if (cancel && container.contains(cancel)) {
    collapseEditor(container, ctx, cancel.dataset.cancel);
    return;
  }

  const deselect = event.target.closest("[data-deselect]");
  if (deselect && container.contains(deselect)) {
    const foodId = deselect.dataset.deselect;
    container._foodsExpanded = null;
    container._foodsDraft = null;
    ctx.onChange("removeFood", { foodId });
    return;
  }

  // The stepper edits the UI-only draft: nothing is selected until 确认.
  const step = event.target.closest("[data-step]");
  if (step) {
    const editor = step.closest("[data-food-editor]");
    if (!editor) return;
    const foodId = editor.dataset.foodEditor;
    const food = foodById(ctx.foods, foodId);
    const draft = container._foodsDraft;
    if (!food || !draft || draft.foodId !== foodId) return;
    if (draft.quantity.measureId === GRAMS_MEASURE_ID) return;

    const steps = Number(step.dataset.step);
    const count = stepCount(draft.quantity.count, Number.isFinite(steps) ? steps : 0);
    draft.quantity = normalizeSelection(food, { measureId: draft.quantity.measureId, count });
    refreshEditor(container, food);
    return;
  }

  const button = event.target.closest(".food-card[data-food]");
  if (!button || !container.contains(button)) return;
  const food = foodById(ctx.foods, button.dataset.food);
  if (!food) return;

  openEditor(container, ctx, food);
}

/**
 * Change handler of the open tile: measure select or gram input.
 *
 * Both only update the UI-only draft (quantityHtml/refreshEditor); the whole
 * list is not re-rendered and the `<select>` is not refocused, so the native
 * picker does not pop up a second time (P17c).
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
  const draft = container._foodsDraft;
  if (!food || !draft || draft.foodId !== foodId) return;

  const target = event.target;
  if (target.matches("[data-measure]")) {
    const measureId = target.value;
    // Switching to "克" keeps the current weight; a household measure starts at
    // one unit (the user can then step it up or down in 0.5 steps).
    const quantity = measureId === GRAMS_MEASURE_ID
      ? { measureId: GRAMS_MEASURE_ID, grams: draft.quantity.grams }
      : { measureId, count: 1 };
    draft.quantity = normalizeSelection(food, quantity);
    refreshEditor(container, food);
    return;
  }

  if (target.matches("[data-grams]")) {
    const grams = Number(target.value);
    draft.quantity = normalizeSelection(food, {
      measureId: GRAMS_MEASURE_ID,
      grams: Number.isFinite(grams) && grams > 0 ? grams : 0,
    });
    refreshEditor(container, food);
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
  // again instead of carrying a raised limit across tabs, and close an open
  // tile (its food may not even be listed in the new tab).
  if (container._foodsNutrient !== nutrientId) {
    container._foodsNutrient = nutrientId;
    container._foodsLimit = DEFAULT_LIMIT;
    container._foodsExpanded = null;
    container._foodsDraft = null;
  }

  const view = viewOf(container);
  const open = expandedOf(container);
  const cards = buildFoodCards({
    foods: ctx.foods,
    nutrients: ctx.nutrients,
    state: ctx.state,
    limit: view.limit,
    search: view.search,
    expandedId: open.expandedId,
    quantity: open.quantity,
  });

  // A search or a tab switch can hide the open tile: drop it so reopening the
  // card does not revive an old draft.
  if (container._foodsExpanded && !cards.some((card) => card.id === container._foodsExpanded)) {
    container._foodsExpanded = null;
    container._foodsDraft = null;
  }

  container.innerHTML = foodsHtml(cards, {
    nutrients: ctx.nutrients,
    state: ctx.state,
    more: hiddenCount({ foods: ctx.foods, state: ctx.state }, view.limit, view.search),
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

  // "Show more" rebuilds the grid, but the button stays in place; return the
  // focus to it so a keyboard user can keep pressing it.
  if (container._foodsKeepFocus) {
    container._foodsKeepFocus = false;
    const button = container.querySelector("[data-more]");
    if (button) button.focus({ preventScroll: true });
  }
}

export default {
  ORDER_HINT,
  BASIS_100_LABEL,
  BASIS_10_LABEL,
  SEARCH_PLACEHOLDER,
  MEASURE_NOTE,
  BONE_NOTE,
  NO_MATCH_TEXT,
  CONFIRM_LABEL,
  CANCEL_LABEL,
  DESELECT_LABEL,
  DETAIL_LABEL,
  shortNumber,
  foodArray,
  foodById,
  per100gText,
  amountText,
  basisLabel,
  boneTextOf,
  boneShareText,
  draftQuantity,
  editorModel,
  buildFoodCards,
  foodCardHtml,
  quantityHtml,
  editorHtml,
  expandedTileHtml,
  foodCellHtml,
  foodsHeading,
  foodsBodyHtml,
  foodsHtml,
  hiddenCount,
  renderFoods,
};
