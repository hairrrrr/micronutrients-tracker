// Nutrient target cards: one card per nutrient with its reference target, the
// remaining / surplus amount, a small progress bar and the met / over-UL
// states (PLAN.md 1.6 and 1.8 item 3, phase P10).
//
// Rendering only: tapping a card reports `ctx.onChange("setActiveNutrient", id)`
// and `app.js` applies the reducer, saves and re-renders. This module never
// touches localStorage and never mutates state.
//
// Numbers come from the data only: targets from `dri.js targetsFor`, intakes
// from `calc.js intakeTotals`, status/text from `calc.js status` / `cardText`.
// The card background is the nutrient colour from nutrients.json, or the single
// "met" green when the target is reached; an over-UL card keeps its background
// and gets the red danger outline plus a short warning line.
//
// Layout is hand-written CSS (`docs/css/style.css`): 3 columns at 390 px, 4 at
// 560 px, 6 at 760 px. The card density and the thin progress bar follow the
// target/goal cards of common nutrition trackers (e.g. Cronometer); no code
// was copied. See "Credits" in README.md.

import { cardText, formatAmount, intakeTotals, status } from "../core/calc.js";
import { targetsFor } from "../core/dri.js";
import { cardColors, nameZhOf, unitOf } from "../core/nutrients.js";
import { COLUMNS } from "./profile.js";

/** Chinese label of a sex value (same wording as the profile panel). */
const SEX_LABELS = Object.freeze({ female: "女", male: "男" });

/** Short heading of a standard, e.g. "中国 2023". */
const STANDARD_LABELS = Object.freeze({ cn2023: "中国 2023", us: "美国" });

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
 * Short label of a standard key, falling back to the profile panel's heading.
 *
 * @param {string} standard
 * @returns {string}
 */
export function standardLabel(standard) {
  return STANDARD_LABELS[standard]
    ?? COLUMNS.find((column) => column.standard === standard)?.short
    ?? "";
}

/**
 * One nutrient card, computed from the state and the data.
 *
 * @param {string} nutrientId e.g. "vitA"
 * @param {{nutrients: object, dri: object, state: object, foodsById: object}} ctx
 * @returns {object} card model (see `buildTargetCards`)
 */
function buildCard(nutrientId, ctx) {
  const { nutrients, state, targets } = ctx;
  const unit = unitOf(nutrients, nutrientId);
  const reference = targets.values?.[nutrientId] ?? null;
  const intake = Number(ctx.totals[nutrientId]) || 0;
  const result = status(
    reference?.target ?? null,
    intake,
    reference?.ul ?? null,
    reference?.ulAppliesToFood,
  );
  const colors = cardColors(nutrients, nutrientId, result.met);
  const targetText = result.hasTarget ? formatAmount(result.target, unit) : "—";
  const ulText = result.ul !== null ? formatAmount(result.ul, unit) : "";

  const title = [`目标 ${targetText}`];
  if (reference?.type) title.push(reference.type);
  if (ulText) title.push(`上限（UL）${ulText}`);

  return {
    id: nutrientId,
    nameZh: nameZhOf(nutrients, nutrientId, nutrientId),
    unit,
    target: result.target,
    targetText,
    ul: result.ul,
    ulText,
    intake,
    text: cardText(result, unit),
    met: result.met,
    overUL: result.overUL,
    hasTarget: result.hasTarget,
    // The bar is capped at 100 %: a card never overflows its track, and the
    // surplus / over-UL cases are carried by the text and the red outline.
    percent: Math.round(Math.max(0, Math.min(1, result.ratio)) * 100),
    colors,
    active: nutrientId === state.activeNutrient,
    title: `${nameZhOf(nutrients, nutrientId, nutrientId)}：${title.join(" · ")}`,
  };
}

/**
 * All cards for the current profile, standard and selections, in nutrient data
 * order (the same order as the tabs and the standards table).
 *
 * @param {{nutrients: object, dri: object, state: object, foodsById?: object}} ctx
 * @returns {Array<object>} card models
 */
export function buildTargetCards(ctx) {
  if (!ctx || !ctx.state) return [];
  const state = ctx.state;
  const targets = targetsFor(ctx.dri, state.standard, state.profile);
  const totals = intakeTotals(state.selections ?? {}, ctx.foodsById ?? {});
  const local = { ...ctx, targets, totals };

  const list = Array.isArray(ctx.nutrients?.nutrients)
    ? ctx.nutrients.nutrients
    : Array.isArray(ctx.nutrients)
      ? ctx.nutrients
      : [];
  return list
    .filter((nutrient) => nutrient && typeof nutrient.id === "string" && nutrient.id)
    .map((nutrient) => buildCard(nutrient.id, local));
}

/**
 * Summary line above the grid: standard, profile, met count.
 *
 * Kept compact so it fits on one line next to the heading at 390 px.
 *
 * @param {Array<object>} cards
 * @param {{state: object}} ctx
 * @returns {string}
 */
export function summaryText(cards, ctx) {
  const profile = ctx.state.profile ?? {};
  const met = cards.filter((card) => card.met).length;
  const over = cards.filter((card) => card.overUL).length;
  const sex = SEX_LABELS[profile.sex] ?? "";
  const age = Number.isFinite(Number(profile.age)) ? `${profile.age} 岁` : "";
  const parts = [
    standardLabel(ctx.state.standard),
    [sex, age].filter(Boolean).join(" "),
    `已达标 ${met}/${cards.length}`,
  ].filter(Boolean);
  if (over > 0) parts.push(`超上限 ${over}`);
  return parts.join(" · ");
}

/**
 * Markup of one card. A `<button>` with `aria-pressed` so the grid is
 * keyboard reachable and the active nutrient is announced (PLAN.md 1.8).
 *
 * @param {object} card card model from `buildTargetCards`
 * @returns {string} HTML
 */
export function cardHtml(card) {
  const classes = [
    "target-card",
    card.met ? "is-met" : "",
    card.overUL ? "is-over" : "",
    card.active ? "is-active" : "",
  ].filter(Boolean).join(" ");
  const style = `--card-bg:${card.colors.background};--card-border:${card.colors.border};--card-text:${card.colors.text}`;
  const warn = card.overUL
    ? `<span class="target-card__warn">超过上限${card.ulText ? ` ${esc(card.ulText)}` : ""}</span>`
    : "";

  return `<button type="button" class="${classes}" style="${esc(style)}"
    data-nutrient="${esc(card.id)}" aria-pressed="${card.active ? "true" : "false"}"
    title="${esc(card.title)}">
    <span class="target-card__name">${esc(card.nameZh)}</span>
    <span class="target-card__target">目标 ${esc(card.targetText)}</span>
    <span class="target-card__status">${esc(card.text)}</span>
    <span class="target-card__bar" aria-hidden="true"><span class="target-card__fill" style="width:${card.percent}%"></span></span>
    ${warn}
  </button>`;
}

/**
 * The whole section: heading, summary, card grid and the legend note.
 *
 * @param {Array<object>} cards
 * @param {{state: object}} ctx
 * @returns {string} HTML
 */
export function targetsHtml(cards, ctx) {
  const body = cards.length > 0
    ? `<div class="targets__grid">${cards.map(cardHtml).join("")}</div>`
    : '<p class="status">暂无营养素数据。</p>';

  return `<div class="targets__head">
      <h2 class="targets__title">每日目标</h2>
      <p class="targets__meta">${esc(summaryText(cards, ctx))}</p>
    </div>
    ${body}
    <p class="targets__note">
      点击卡片可切换到该营养素的食物列表。绿色表示已达标；红色边框表示已超过可耐受最高摄入量（UL）。
    </p>`;
}

/**
 * Click handler: switch the active nutrient tab.
 *
 * @param {Event} event
 */
function handleClick(event) {
  const container = event.currentTarget;
  const ctx = container._targetsCtx;
  if (!ctx) return;
  const button = event.target.closest(".target-card[data-nutrient]");
  if (!button || !container.contains(button)) return;
  const nutrientId = button.dataset.nutrient;
  if (!nutrientId || nutrientId === ctx.state.activeNutrient) return;
  container._targetsFocus = nutrientId;
  ctx.onChange("setActiveNutrient", nutrientId);
}

/**
 * Render (or re-render) the target cards into `container`.
 *
 * @param {HTMLElement|null} container section in index.html
 * @param {{state: object, nutrients: object, dri: object, foodsById: object,
 *   onChange: Function}} ctx `onChange(action, payload)` applies a state.js
 *   reducer in the caller
 */
export function renderTargets(container, ctx) {
  if (!container || !ctx || !ctx.state) return;

  const cards = buildTargetCards(ctx);
  container.innerHTML = targetsHtml(cards, ctx);
  container.classList.add("panel", "panel--targets");
  container.setAttribute("aria-busy", "false");

  container._targetsCtx = ctx;
  if (!container._targetsBound) {
    container._targetsBound = true;
    container.addEventListener("click", handleClick);
  }

  // Restore focus once after a card tap only: the grid is rebuilt, so the
  // clicked <button> is a new element. Clearing the id keeps a later profile
  // change (age input, radio) from having its own focus stolen back here.
  const focusId = container._targetsFocus;
  container._targetsFocus = null;
  if (focusId) {
    const element = container.querySelector(`[data-nutrient="${focusId}"]`);
    if (element) element.focus({ preventScroll: true });
  }
}

export default {
  standardLabel,
  buildTargetCards,
  summaryText,
  cardHtml,
  targetsHtml,
  renderTargets,
};
