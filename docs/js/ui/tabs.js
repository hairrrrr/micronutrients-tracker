// Nutrient tabs: one horizontally scrollable chip per nutrient, in the same
// order as the target cards and the standards table (PLAN.md 1.8 item 4,
// phase P11a).
//
// Rendering only: tapping a chip reports `ctx.onChange("setActiveNutrient",
// id)` and `app.js` applies the state.js reducer, saves and re-renders. This
// module never touches localStorage and never mutates state.
//
// The active chip is filled with the nutrient colour from nutrients.json (the
// same colour its target card uses), inactive chips stay a neutral surface with
// a small colour dot. Colours come in as an inline `--tab-bg` custom property,
// so the data colours stay out of the stylesheet.
//
// The chip row is a plain flex row with `overflow-x: auto`; no code copied.
// The pattern follows the "chip / tab row" of common nutrition trackers (see
// "Credits" in README.md).

import { colorOf, nameZhOf, nutrientList } from "../core/nutrients.js";

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
 * Background colour of one chip: the nutrient colour when active, nothing when
 * not (the stylesheet then uses its neutral surface).
 *
 * @param {string} color nutrient colour, "#rrggbb"
 * @param {boolean} active
 * @returns {string} a colour or "" for the inactive state
 */
export function tabBackground(color, active) {
  return active ? color : "";
}

/**
 * Chip models for the whole tab row, in nutrients.json order.
 *
 * @param {{nutrients?: Array<object>}|Array<object>} nutrients nutrients.json
 *   payload or its array
 * @param {{activeNutrient?: string}} state current state (only the active
 *   nutrient is read)
 * @returns {Array<{id: string, nameZh: string, color: string, background: string,
 *   active: boolean, title: string}>} chip models
 */
export function buildTabs(nutrients, state) {
  const activeId = typeof state?.activeNutrient === "string" ? state.activeNutrient : "";

  return nutrientList(nutrients)
    .filter((nutrient) => typeof nutrient.id === "string" && nutrient.id)
    .map((nutrient) => {
      const color = colorOf(nutrients, nutrient.id);
      const active = nutrient.id === activeId;
      const nameZh = nameZhOf(nutrients, nutrient.id, nutrient.id);
      return {
        id: nutrient.id,
        nameZh,
        color,
        background: tabBackground(color, active),
        active,
        title: active ? `${nameZh}（当前）` : `查看${nameZh}含量最高的食物`,
      };
    });
}

/**
 * Markup of one chip. A `<button>` with `aria-pressed` so the row is keyboard
 * reachable and the active nutrient is announced (PLAN.md 1.8 accessibility).
 *
 * @param {object} tab chip model from `buildTabs`
 * @returns {string} HTML
 */
export function tabHtml(tab) {
  const classes = `tab${tab.active ? " is-active" : ""}`;
  const style = tab.active ? ` style="--tab-bg:${esc(tab.background)}"` : "";
  return `<button type="button" class="${classes}"${style}
    data-nutrient="${esc(tab.id)}" aria-pressed="${tab.active ? "true" : "false"}"
    title="${esc(tab.title)}"><span class="tab__dot" style="background:${esc(tab.color)}"
    aria-hidden="true"></span>${esc(tab.nameZh)}</button>`;
}

/**
 * The whole chip row (`role="group"`, labelled for screen readers).
 *
 * @param {Array<object>} tabs chip models
 * @returns {string} HTML
 */
export function tabsHtml(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return '<p class="status">暂无营养素数据。</p>';
  }
  return `<div class="tabs__row" role="group" aria-label="选择营养素">
    ${tabs.map(tabHtml).join("")}
  </div>`;
}

/**
 * Click handler: switch the active nutrient.
 *
 * @param {Event} event
 */
function handleClick(event) {
  const container = event.currentTarget;
  const ctx = container._tabsCtx;
  if (!ctx) return;
  const button = event.target.closest(".tab[data-nutrient]");
  if (!button || !container.contains(button)) return;
  const nutrientId = button.dataset.nutrient;
  if (!nutrientId || nutrientId === ctx.state.activeNutrient) return;
  container._tabsFocus = nutrientId;
  ctx.onChange("setActiveNutrient", nutrientId);
}

/**
 * Keep the active chip in view without scrolling the page.
 *
 * Scrolls the row by the smallest amount that makes the whole active chip
 * visible (plus a small margin), instead of centring it: on a wide screen the
 * row then stays where the user left it and no neighbouring chip is left half
 * clipped at an edge. Called only when the active nutrient changed or on the
 * first render, so a user who scrolled the row by hand keeps their position
 * while the tab stays the same.
 *
 * @param {HTMLElement} container the section element
 * @param {boolean} changed whether the active chip should be revealed
 */
function revealActiveChip(container, changed) {
  if (!changed) return;
  const row = container.querySelector(".tabs__row");
  const active = row?.querySelector('.tab[aria-pressed="true"]');
  if (!row || !active) return;

  const margin = 8;
  const rowBox = row.getBoundingClientRect();
  const chipBox = active.getBoundingClientRect();
  let delta = 0;
  if (chipBox.left < rowBox.left + margin) {
    delta = chipBox.left - rowBox.left - margin;
  } else if (chipBox.right > rowBox.right - margin) {
    delta = chipBox.right - rowBox.right + margin;
  }
  if (delta === 0) return;

  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  row.scrollLeft = Math.max(0, Math.min(max, row.scrollLeft + delta));
}

/**
 * Render (or re-render) the nutrient chip row into `container`.
 *
 * @param {HTMLElement|null} container section in index.html
 * @param {{state: object, nutrients: object, onChange: Function}} ctx
 *   `onChange(action, payload)` applies a state.js reducer in the caller
 */
export function renderTabs(container, ctx) {
  if (!container || !ctx || !ctx.state) return;

  const tabs = buildTabs(ctx.nutrients, ctx.state);
  container.innerHTML = tabsHtml(tabs);
  container.classList.add("panel", "panel--tabs");
  container.setAttribute("aria-busy", "false");

  const activeId = ctx.state.activeNutrient;
  const first = container._tabsActive === undefined;
  const changed = first || container._tabsActive !== activeId;
  container._tabsActive = activeId;

  container._tabsCtx = ctx;
  if (!container._tabsBound) {
    container._tabsBound = true;
    container.addEventListener("click", handleClick);
  }

  // A restored tab (localStorage) may be far down the row, and after a tap the
  // clicked chip is a new element; both cases reveal the active chip. A plain
  // re-render of the same tab (age change, food selection) leaves the row where
  // the user scrolled it.
  revealActiveChip(container, changed);

  // Restore focus after a chip tap (the row is rebuilt, so the clicked button
  // is a new element). The target card grid does the same for its cards.
  const focusId = container._tabsFocus;
  container._tabsFocus = undefined;
  if (focusId) {
    const element = container.querySelector(`.tab[data-nutrient="${focusId}"]`);
    if (element) element.focus({ preventScroll: true });
  }
}

export default { tabBackground, buildTabs, tabHtml, tabsHtml, renderTabs };
