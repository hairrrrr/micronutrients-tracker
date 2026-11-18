// Food detail sheet (phase P21c): every nutrient of one food, ranked by the
// share of the daily target it supplies per 100 g.
//
// The ranking and the numbers come from the pure core module
// `docs/js/core/detail.js` (`detailRows`); this module only turns the rows into
// markup and owns the single shared native `<dialog>` element.
//
// The dialog is created lazily once and reused for every food: `showModal()`
// puts it in the top layer, Esc and a click on the backdrop close it natively
// (`close`), and the `close` listener returns the focus to the 查看详情 button
// that opened it. On screens up to 600 px it is a bottom sheet (full width,
// 85vh, rounded top corners, scrollable list); wider screens centre it at
// 560 px. See "Credits" in README.md for the Pico CSS modal pattern.
//
// No data lives here: the caller passes the food record, the nutrient metadata
// and the state; the targets are resolved with `dri.js targetsFor`, the same
// call the target cards use, so the detail view always agrees with them.

import { formatAmount } from "../core/calc.js";
import { detailRows, formatPct } from "../core/detail.js";
import { targetsFor } from "../core/dri.js";
import { WITH_BONE_LABEL, formatEdibleGrams, isBoneIn } from "../core/measures.js";
import { FALLBACK_COLOR, colorOf } from "../core/nutrients.js";
import { amountBasisGOf } from "../core/order.js";

/** Button in an expanded tile that opens the detail sheet. */
export const DETAIL_LABEL = "查看详情";
/** Close control of the sheet header. */
export const DETAIL_CLOSE_LABEL = "关闭";
/** One-line basis note under the heading. */
export const DETAIL_NOTE = "所有营养素按占每日目标的百分比从高到低排序；目标随当前标准、性别和年龄变化";
/** Percentage slot of a nutrient the food contains none of. */
export const DETAIL_ZERO_TEXT = "不含";
/** Percentage slot of a nutrient the food has no value for. */
export const DETAIL_NO_DATA_TEXT = "无数据";
/** Percentage slot of a nutrient the current profile has no target for. */
export const DETAIL_NO_TARGET_TEXT = "无参考值";
/** Basis labels of the per-basis amount lines. */
export const DETAIL_PER_100G_LABEL = "每 100 g";
export const DETAIL_PER_10G_LABEL = "每 10 g";
/** Prefix of the chosen-quantity line. */
export const DETAIL_QUANTITY_LABEL = "当前数量";
/** Id of the single shared dialog element. */
export const DETAIL_DIALOG_ID = "food-detail";

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
 * Short number text for a gram weight: "100", "12.5".
 *
 * @param {number} value
 * @returns {string}
 */
function numberText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

/**
 * Percentage slot of one row: the percentage, or the status word.
 *
 * "zero" is 不含 (the food contains none), "missing" is 无数据 (not measured)
 * and "noTarget" is 无参考值 (the current profile has no target), so a "—" only
 * ever means "no percentage computable" in a slot that also carries a word.
 *
 * @param {"ok"|"noTarget"|"zero"|"missing"} status row status
 * @param {number|null} pct percentage (per 100 g or for the quantity)
 * @returns {string}
 */
export function pctLabel(status, pct) {
  if (status === "missing") return DETAIL_NO_DATA_TEXT;
  if (status === "zero") return DETAIL_ZERO_TEXT;
  if (status === "noTarget") return DETAIL_NO_TARGET_TEXT;
  return formatPct(pct);
}

/**
 * Width of the bar fill, in percent: the percentage capped at 100, never
 * negative or NaN. Rounded to 0.1 % so the inline style stays short.
 *
 * @param {number|null|undefined} pct
 * @returns {number} 0..100
 */
export function barWidth(pct) {
  if (pct === null || pct === undefined) return 0;
  const value = Number(pct);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(Math.min(value, 100) * 10) / 10;
}

/**
 * Amount text of one row on a basis, e.g. "469 ug RAE" or 无数据.
 *
 * @param {{per100g: number|null, unit: string}} row
 * @param {number} basisG 100 or 10
 * @returns {string}
 */
export function basisAmountText(row, basisG) {
  if (row.per100g === null) return DETAIL_NO_DATA_TEXT;
  return formatAmount((row.per100g * basisG) / 100, row.unit);
}

/**
 * Markup of one nutrient row of the sheet.
 *
 * @param {{id: string, name: string, unit: string, per100g: number|null,
 *   pct100: number|null, amount: number|null, pct: number|null,
 *   status: "ok"|"noTarget"|"zero"|"missing"}} row row from `detailRows`
 * @param {{color?: string, basisG?: number, grams?: number|null,
 *   boneIn?: boolean}} [options]
 * @returns {string} HTML
 */
export function detailRowHtml(row, options = {}) {
  const color = typeof options.color === "string" && options.color ? options.color : FALLBACK_COLOR;
  const basisG = Number(options.basisG) === 10 ? 10 : 100;
  const grams = Number(options.grams);
  const hasQuantity = Number.isFinite(grams) && grams > 0 && row.amount !== null;
  const boneIn = Boolean(options.boneIn);
  const width = barWidth(row.pct100);
  const pctText = pctLabel(row.status, row.pct100);

  // The per-100 g line is always there; a small-portion food (P19b) adds the
  // per-10 g amount so a spoonful is readable without mental arithmetic.
  const per100 = `<span class="detail-row__amount">${DETAIL_PER_100G_LABEL}：${esc(basisAmountText(row, 100))}</span>`;
  const per10 = basisG === 10
    ? `<span class="detail-row__amount">${DETAIL_PER_10G_LABEL}：${esc(basisAmountText(row, 10))}</span>`
    : "";
  // P20: a bone-in amount is weighed with the bone, and the nutrients use the
  // edible part; the line names both so the two numbers cannot be confused.
  const bone = boneIn
    ? `（${WITH_BONE_LABEL}，${formatEdibleGrams({ refusePct: options.refusePct }, grams)}）`
    : "";
  const quantity = hasQuantity
    ? `<p class="detail-row__qty">${DETAIL_QUANTITY_LABEL} ${esc(numberText(grams))} g${esc(bone)}：${esc(formatAmount(row.amount, row.unit))}（${esc(pctLabel(row.status, row.pct))}）</p>`
    : "";

  return `<li class="detail-row" data-nutrient="${esc(row.id)}" data-status="${esc(row.status)}">
      <div class="detail-row__line">
        <span class="detail-row__name">${esc(row.name)}</span>
        <span class="detail-row__pct">${esc(pctText)}</span>
      </div>
      <span class="detail-row__track" aria-hidden="true"><span class="detail-row__fill"
        style="width:${width}%;background:${esc(color)}"></span></span>
      <p class="detail-row__amounts">${per100}${per10}</p>
      ${quantity}
    </li>`;
}

/**
 * Body markup of the sheet: the note and one row per nutrient of the food.
 *
 * @param {object} food one food record from foods.json
 * @param {object} targets the `dri.js targetsFor(...)` result (or a target map)
 * @param {object} nutrients nutrients.json payload or its array
 * @param {number|null|undefined} [grams] chosen quantity (with bone for bone-in)
 * @returns {string} HTML
 */
export function detailHtml(food, targets, nutrients, grams) {
  const rows = detailRows(food, targets, nutrients, grams);
  const basisG = amountBasisGOf(food);
  const weighed = Number(grams);
  const quantity = Number.isFinite(weighed) && weighed > 0 ? weighed : null;
  const boneIn = isBoneIn(food);
  const items = rows.map((row) => detailRowHtml(row, {
    color: colorOf(nutrients, row.id),
    basisG,
    grams: quantity,
    boneIn,
    refusePct: food?.refusePct,
  })).join("");
  return `<p class="detail__note">${esc(DETAIL_NOTE)}</p>
    <ul class="detail__list">${items}</ul>`;
}

/**
 * The single shared dialog element, created on first use and kept in the body.
 *
 * @param {Document} [doc]
 * @returns {HTMLDialogElement|null} null without a DOM
 */
export function ensureDetailDialog(doc = typeof document === "undefined" ? null : document) {
  if (!doc || !doc.body) return null;
  const existing = doc.getElementById(DETAIL_DIALOG_ID);
  if (existing) return /** @type {HTMLDialogElement} */ (existing);

  const dialog = doc.createElement("dialog");
  dialog.id = DETAIL_DIALOG_ID;
  dialog.className = "detail-dialog";
  dialog.setAttribute("aria-labelledby", `${DETAIL_DIALOG_ID}-title`);
  dialog.innerHTML = `<header class="detail-dialog__head">
      <h2 class="detail-dialog__title" id="${DETAIL_DIALOG_ID}-title"></h2>
      <button type="button" class="detail-dialog__close" data-detail-close>${DETAIL_CLOSE_LABEL}</button>
    </header>
    <div class="detail-dialog__body" data-detail-body></div>`;

  // 关闭 and the backdrop close the sheet; Esc is native. Focus goes back to
  // the 查看详情 button in the `close` handler, whatever closed it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-detail-close]")) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    const trigger = dialog._detailTrigger;
    dialog._detailTrigger = null;
    if (trigger && trigger.isConnected && typeof trigger.focus === "function") {
      trigger.focus({ preventScroll: true });
    }
  });

  doc.body.append(dialog);
  return /** @type {HTMLDialogElement} */ (dialog);
}

/**
 * Fill and open the shared sheet for one food.
 *
 * @param {{food: object, dri: object, state: object, nutrients: object,
 *   grams?: number|null, trigger?: HTMLElement|null,
 *   doc?: Document}} data
 * @returns {HTMLDialogElement|null}
 */
export function openDetail(data) {
  const { food, dri, state, nutrients } = data ?? {};
  if (!food) return null;
  const dialog = ensureDetailDialog(data.doc);
  if (!dialog) return null;

  const targets = targetsFor(dri, state?.standard, state?.profile);
  const title = dialog.querySelector(".detail-dialog__title");
  const body = dialog.querySelector("[data-detail-body]");
  if (title) title.textContent = String(food.nameZh ?? "");
  if (body) body.innerHTML = detailHtml(food, targets, nutrients, data.grams);

  // Reopening for another food: close first (the old trigger gets its focus
  // back) and only then remember the new trigger.
  if (dialog.open) dialog.close();
  dialog._detailTrigger = data.trigger ?? null;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  const close = dialog.querySelector("[data-detail-close]");
  if (close) close.focus({ preventScroll: true });
  return dialog;
}

export default {
  DETAIL_LABEL,
  DETAIL_CLOSE_LABEL,
  DETAIL_NOTE,
  DETAIL_ZERO_TEXT,
  DETAIL_NO_DATA_TEXT,
  DETAIL_NO_TARGET_TEXT,
  DETAIL_PER_100G_LABEL,
  DETAIL_PER_10G_LABEL,
  DETAIL_QUANTITY_LABEL,
  DETAIL_DIALOG_ID,
  pctLabel,
  barWidth,
  basisAmountText,
  detailRowHtml,
  detailHtml,
  ensureDetailDialog,
  openDetail,
};
