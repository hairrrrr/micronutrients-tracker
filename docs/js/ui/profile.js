// Profile panel: sex, age, life stage, the CN 2023 / US standards comparison
// and the radio toggle that picks the standard used for the calculation
// (PLAN.md 1.4 and 1.8 item 2, phase P9).
//
// Rendering only: every change is reported through `ctx.onChange(action,
// payload)`, and `app.js` applies the pure reducer from state.js, saves and
// re-renders. This module never touches localStorage and never mutates state.
//
// The panel is a native <details> so it can stay collapsed on mobile after the
// first visit; the open/closed state is kept on the container element so a
// re-render does not fight the user.
//
// Markup and CSS are hand-written; the segmented control layout comes from a
// small vendored excerpt of Pico CSS v2's inline group (MIT, see
// docs/vendor/pico-segmented.css). Credits are listed in README.md.

import { formatAmount } from "../core/calc.js";
import { nameEnOf, nameZhOf, nutrientList, unitOf } from "../core/nutrients.js";
import { targetsFor } from "../core/dri.js";

/** One column of the comparison table, in display order. */
export const COLUMNS = Object.freeze([
  { standard: "cn2023", heading: "中国 2023", toggle: "使用中国标准", short: "中国 2023" },
  { standard: "us", heading: "美国", toggle: "使用美国标准", short: "美国" },
]);

const SEXES = [
  { value: "female", label: "女" },
  { value: "male", label: "男" },
];

const AGE_INPUT_ID = "profile-age";
const STAGE_SELECT_ID = "profile-stage";

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
 * Age range of a DRI group for the caption, e.g. "30–49 岁" / "75 岁以上".
 *
 * @param {{ageMin?: number, ageMax?: number|null}|null} group
 * @returns {string} "" when there is no group
 */
export function groupLabel(group) {
  if (!group) return "";
  const min = Number(group.ageMin);
  if (!Number.isFinite(min)) return "";
  if (group.ageMax === null || group.ageMax === undefined) return `${min} 岁以上`;
  return `${min}–${Number(group.ageMax)} 岁`;
}

/**
 * Amount part of one table cell: "800 mg", or null when there is no value.
 *
 * The number formatting rule is calc.js `formatAmount` (PLAN.md 1.6), so the
 * table and the target cards can never show a different number for the same
 * value.
 *
 * @param {{target?: number|null}|null|undefined} reference
 * @param {string} unit
 * @returns {string|null}
 */
export function cellAmount(reference, unit) {
  if (!reference || reference.target === null || reference.target === undefined) return null;
  return formatAmount(reference.target, unit);
}

/**
 * Value type of one table cell: "RNI" / "AI" / "RDA", or "" when absent.
 *
 * @param {{type?: string}|null|undefined} reference
 * @returns {string}
 */
export function cellType(reference) {
  const type = reference?.type;
  return typeof type === "string" && type.trim() ? type.trim() : "";
}

/**
 * Plain text of one table cell: "800 mg (RNI)", or null when there is no
 * value. The markup splits amount and type onto two lines on narrow screens,
 * but the text is the same (PLAN.md 1.4).
 *
 * @param {object|null|undefined} reference
 * @param {string} unit
 * @returns {string|null}
 */
export function cellText(reference, unit) {
  const amount = cellAmount(reference, unit);
  if (amount === null) return null;
  const type = cellType(reference);
  return type ? `${amount} (${type})` : amount;
}

/**
 * Tooltip of one table cell: upper limit and source reference, when known.
 *
 * @param {object|null|undefined} reference
 * @param {string} unit
 * @returns {string}
 */
export function cellTitle(reference, unit) {
  if (!reference) return "";
  const parts = [];
  if (reference.ul !== null && reference.ul !== undefined) {
    let ul = `上限（UL）${formatAmount(reference.ul, unit)}`;
    if (reference.ulAppliesToFood === false) ul += "，仅适用于补充剂或强化剂";
    parts.push(ul);
  }
  if (typeof reference.ref === "string" && reference.ref) parts.push(reference.ref);
  return parts.join(" · ");
}

/** Chinese label of a sex value. */
function sexLabel(sex) {
  return SEXES.find((item) => item.value === sex)?.label ?? "女";
}

/** Column definition of a standard key. */
function columnOf(standard) {
  return COLUMNS.find((column) => column.standard === standard) ?? COLUMNS[0];
}

/**
 * Segmented sex control (two buttons, `aria-pressed` on each).
 *
 * @param {string} sex current value
 * @returns {string} HTML
 */
function sexControl(sex) {
  const buttons = SEXES.map((item) => {
    const active = item.value === sex;
    return `<button type="button" class="segmented__btn${active ? " is-active" : ""}"
      data-sex="${item.value}" aria-pressed="${active ? "true" : "false"}">${item.label}</button>`;
  }).join("");
  return `<div class="segmented" role="group" aria-labelledby="profile-sex-label">${buttons}</div>`;
}

/**
 * Comparison table: one row per nutrient, two value columns, the active
 * standard's column marked in the header and tinted in the body.
 *
 * @param {object} ctx
 * @returns {string} HTML
 */
function standardsTable(ctx) {
  const { state, nutrients, dri } = ctx;
  const list = nutrientList(nutrients);
  const byStandard = {};
  for (const column of COLUMNS) {
    byStandard[column.standard] = targetsFor(dri, column.standard, state.profile);
  }
  const active = state.standard;

  const head = COLUMNS.map((column) => {
    const group = byStandard[column.standard].group;
    const isActive = column.standard === active;
    const marker = isActive
      ? '<span class="standards__badge">使用中</span><span class="visually-hidden">（当前计算标准）</span>'
      : "";
    return `<th scope="col" class="standards__col${isActive ? " is-active" : ""}" data-standard="${column.standard}">
      ${esc(column.heading)}${marker}
      <span class="standards__col-age">${esc(groupLabel(group))}</span>
    </th>`;
  }).join("");

  const rows = list.map((nutrient) => {
    const unit = unitOf(nutrients, nutrient.id);
    const cells = COLUMNS.map((column) => {
      const reference = byStandard[column.standard].values[nutrient.id];
      const amount = cellAmount(reference, unit);
      const kind = cellType(reference);
      const isActive = column.standard === active;
      const title = cellTitle(reference, unit);
      const classes = `standards__value${isActive ? " is-active" : ""}${amount === null ? " is-empty" : ""}`;
      const titleAttr = title ? ` title="${esc(title)}"` : "";
      const body = amount === null
        ? "—"
        : `<span class="standards__amount">${esc(amount)}</span>${kind ? ` <span class="standards__kind">(${esc(kind)})</span>` : ""}`;
      return `<td class="${classes}" data-standard="${column.standard}"${titleAttr}>${body}</td>`;
    }).join("");
    const english = nameEnOf(nutrients, nutrient.id);
    const englishHtml = english ? `<span class="standards__en">${esc(english)}</span>` : "";
    return `<tr data-nutrient="${esc(nutrient.id)}">
      <th scope="row" class="standards__name">${esc(nameZhOf(nutrients, nutrient.id, nutrient.id))}${englishHtml}</th>
      ${cells}
    </tr>`;
  }).join("");

  const caption = `每人每日参考摄入量对照 · ${sexLabel(state.profile.sex)} · ${state.profile.age} 岁`;

  return `<div class="standards">
    <table class="standards__table">
      <caption class="standards__caption">${esc(caption)}</caption>
      <thead><tr>
        <th scope="col" class="standards__name standards__name--head">营养素</th>
        ${head}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="standards__note">
      中国栏目按中国营养学会《中国居民膳食营养素参考摄入量（2023 版）》的年龄组取值；
      美国栏目按 NASEM 膳食参考摄入量（经 NIH ODS 汇总表）取值。
      括号内为数值类型：RNI 推荐摄入量、AI 适宜摄入量、RDA 推荐膳食供给量。
    </p>
  </div>`;
}

/**
 * Radio toggle that selects the standard driving the calculation.
 *
 * @param {string} standard current value
 * @returns {string} HTML
 */
function standardToggle(standard) {
  const options = COLUMNS.map((column) => {
    const checked = column.standard === standard;
    return `<label class="choice${checked ? " is-checked" : ""}">
      <input type="radio" name="standard" value="${column.standard}"${checked ? " checked" : ""}>
      <span>${esc(column.toggle)}</span>
    </label>`;
  }).join("");
  return `<fieldset class="field">
    <legend class="field__label">用于计算的标准</legend>
    <div class="choice-row">${options}</div>
  </fieldset>`;
}

/**
 * The whole panel.
 *
 * @param {object} ctx
 * @returns {string} HTML
 */
function panelHtml(ctx) {
  const { state } = ctx;
  const { profile } = state;
  const open = ctx.open !== false;
  // The short standard name ("中国 2023" / "美国") fits on the summary line at
  // 360 px, where the radio labels ("使用中国标准") would be truncated.
  const summaryMeta = `${sexLabel(profile.sex)} · ${profile.age} 岁 · ${columnOf(state.standard).short}`;

  return `<details class="profile"${open ? " open" : ""}>
    <summary class="profile__summary">
      <span class="profile__summary-title">个人资料与参考标准</span>
      <span class="profile__summary-meta">${esc(summaryMeta)}</span>
    </summary>
    <div class="profile__body">
      <div class="profile__controls">
        <div class="field">
          <span class="field__label" id="profile-sex-label">生理性别</span>
          ${sexControl(profile.sex)}
        </div>
        <div class="field field--age">
          <label class="field__label" for="${AGE_INPUT_ID}">年龄</label>
          <div class="input-row">
            <input class="input input--age" id="${AGE_INPUT_ID}" type="number"
              inputmode="numeric" min="18" max="100" step="1" value="${esc(profile.age)}"
              aria-describedby="profile-age-note" autocomplete="off">
            <span class="input-row__suffix">岁</span>
          </div>
          <p class="field__note" id="profile-age-note">本站只覆盖 18–100 岁成年人；超出范围按 18 或 100 岁计算。</p>
        </div>
        <div class="field">
          <label class="field__label" for="${STAGE_SELECT_ID}">生理阶段</label>
          <select class="input" id="${STAGE_SELECT_ID}">
            <option value="none"${profile.lifeStage === "none" ? " selected" : ""}>一般成人（孕期/哺乳期暂未支持）</option>
          </select>
        </div>
        ${standardToggle(state.standard)}
      </div>
      ${standardsTable(ctx)}
    </div>
  </details>`;
}

/**
 * Focus selector for a control after a re-render.
 *
 * @param {string|null} key
 * @returns {string|null}
 */
function focusSelector(key) {
  if (!key) return null;
  const [kind, value] = String(key).split(":");
  if (kind === "sex" && SEXES.some((item) => item.value === value)) return `[data-sex="${value}"]`;
  if (kind === "standard" && COLUMNS.some((item) => item.standard === value)) {
    return `input[name="standard"][value="${value}"]`;
  }
  if (kind === "age") return `#${AGE_INPUT_ID}`;
  if (kind === "stage") return `#${STAGE_SELECT_ID}`;
  return null;
}

/**
 * Click handler: sex segmented control.
 *
 * @param {Event} event
 */
function handleClick(event) {
  const container = event.currentTarget;
  const ctx = container._profileCtx;
  if (!ctx) return;
  const button = event.target.closest("[data-sex]");
  if (!button || !container.contains(button)) return;
  const sex = button.dataset.sex;
  if (sex === ctx.state.profile.sex) return;
  container._profileFocus = `sex:${sex}`;
  ctx.onChange("setProfile", { sex });
}

/**
 * Change handler: age input, life stage select and the standard radio row.
 *
 * The age is not clamped here; state.js clamps through dri.js `clampAge`, and
 * the re-render writes the clamped number back into the input.
 *
 * @param {Event} event
 */
function handleChange(event) {
  const container = event.currentTarget;
  const ctx = container._profileCtx;
  if (!ctx) return;
  const target = event.target;

  if (target.name === "standard") {
    if (target.value === ctx.state.standard) return;
    container._profileFocus = `standard:${target.value}`;
    ctx.onChange("setStandard", target.value);
    return;
  }
  if (target.id === AGE_INPUT_ID) {
    container._profileFocus = "age";
    ctx.onChange("setProfile", { age: target.value });
    return;
  }
  if (target.id === STAGE_SELECT_ID) {
    container._profileFocus = "stage";
    ctx.onChange("setProfile", { lifeStage: target.value });
  }
}

/**
 * Remember whether the user opened or closed the panel.
 *
 * @param {Event} event
 */
function handleToggle(event) {
  const container = event.currentTarget;
  if (!event.target || event.target.classList?.contains("profile") !== true) return;
  container._profileOpen = event.target.open;
}

/**
 * Render (or re-render) the profile panel into `container`.
 *
 * @param {HTMLElement} container empty section in index.html
 * @param {{state: object, nutrients: object, dri: object, onChange: Function}} ctx
 *   `onChange(action, payload)` applies a state.js reducer in the caller
 */
export function renderProfile(container, ctx) {
  if (!container) return;
  if (!ctx || !ctx.state) return;

  const rendered = {
    ...ctx,
    open: container._profileOpen === undefined ? ctx.open !== false : container._profileOpen,
  };

  container.innerHTML = panelHtml(rendered);
  container.classList.add("panel", "panel--profile");
  container.setAttribute("aria-busy", "false");

  container._profileCtx = ctx;
  if (!container._profileBound) {
    container._profileBound = true;
    container.addEventListener("click", handleClick);
    container.addEventListener("change", handleChange);
    container.addEventListener("toggle", handleToggle, true);
  }

  const selector = focusSelector(container._profileFocus);
  if (selector) {
    const element = container.querySelector(selector);
    if (element) element.focus({ preventScroll: true });
  }
}

export default { COLUMNS, groupLabel, cellAmount, cellType, cellText, cellTitle, renderProfile };
