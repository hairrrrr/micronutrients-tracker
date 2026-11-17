// Footer/About section: data sources, estimates and unit caveats, nutrients
// that are not tracked, the privacy note, the disclaimer and the "clear all"
// button (PLAN.md 1.8 item 6, phase P12).
//
// Rendering only: this module never touches localStorage and never mutates
// state. The clear button asks for confirmation and then reports
// `ctx.onChange("clearAll")`; `app.js` applies the state.js reducer, saves and
// re-renders everything, so the stored state and the UI cannot disagree.
//
// Every link is an external https URL that opens in a new tab. The site itself
// only uses relative paths (PLAN.md rule 7).
//
// The section layout follows the usual "data sources / notes / disclaimer"
// block found on nutrition trackers and documentation footers; the markup and
// the CSS are written from scratch (see "Credits" in README.md).

/** Confirmation text of the clear-all button. */
export const CLEAR_CONFIRM = "确定要清空全部已选食物吗？此操作无法撤销。";

/** Button label. */
export const CLEAR_LABEL = "清空全部";

/**
 * The three data sources, in the order they are shown.
 *
 * `url` values are official download/documentation pages; they are the only
 * absolute URLs in the site and are never fetched at runtime.
 */
export const ABOUT_SOURCES = Object.freeze([
  Object.freeze({
    id: "usda",
    name: "USDA FoodData Central · SR Legacy（2018-04 版）",
    detail: "全部食物成分数值来自美国农业部 SR Legacy 数据集（公有领域）。",
    url: "https://fdc.nal.usda.gov/download-datasets",
    linkLabel: "FDC 数据集下载页",
  }),
  Object.freeze({
    id: "cn2023",
    name: "中国营养学会《中国居民膳食营养素参考摄入量（2023版）》",
    detail: "中国参考摄入量（RNI/AI 与 UL）的数值来源。",
    url: "https://www.cnsoc.org/drpostand/",
    linkLabel: "中国营养学会 DRIs 页面",
  }),
  Object.freeze({
    id: "us",
    name: "NASEM 膳食参考摄入量（经 NIH ODS 汇总）",
    detail: "美国参考摄入量（RDA/AI 与 UL）的数值来源。",
    url: "https://ods.od.nih.gov/HealthInformation/nutrientrecommendations.aspx",
    linkLabel: "NIH ODS 参考摄入量页面",
  }),
]);

/** Unit and upper-limit caveats, one item per topic. */
export const UNIT_NOTES = Object.freeze([
  Object.freeze({
    id: "vitE",
    title: "维生素 E",
    text: "USDA 数值是 α-生育酚；中国 2023 的目标以 α-生育酚当量（α-TE）表示，两者并不完全等同。",
  }),
  Object.freeze({
    id: "niacin",
    title: "烟酸",
    text: "以烟酸当量（NE）计：NE = 烟酸（mg）+ 色氨酸（mg）÷ 60。缺少色氨酸数据的食物只计烟酸，并在数据里标注。",
  }),
  Object.freeze({
    id: "ul",
    title: "上限（UL）的范围",
    text: "维生素 A 的上限只针对预成型维生素 A（视黄醇），叶酸的上限只针对合成叶酸，烟酸以及美国标准的维生素 E、镁的上限只针对补充剂或强化剂；这些项目不会因为普通食物摄入而显示超上限提示。",
  }),
]);

/** Nutrients that are deliberately not tracked, with the reason. */
export const UNTRACKED = Object.freeze([
  Object.freeze({ name: "碘", reason: "没有可用的食物成分数据" }),
  Object.freeze({ name: "生物素", reason: "没有可用的食物成分数据" }),
  Object.freeze({ name: "钠", reason: "属于需要限制的项，不作为摄入目标" }),
  Object.freeze({ name: "钼、铬、氟", reason: "v1 未纳入" }),
]);

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
 * Number of selected foods, used by the clear button.
 *
 * @param {{state?: {selections?: object}}} ctx
 * @returns {number}
 */
export function selectionCount(ctx) {
  const selections = ctx?.state?.selections;
  return selections && typeof selections === "object" ? Object.keys(selections).length : 0;
}

/**
 * Markup of the three source rows.
 *
 * @param {Array<object>} [sources]
 * @returns {string} HTML
 */
export function sourcesHtml(sources = ABOUT_SOURCES) {
  const items = sources.map((source) => `<li class="about__item">
      <p class="about__item-name">${esc(source.name)}</p>
      <p class="about__item-text">${esc(source.detail)}</p>
      <a class="about__link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.linkLabel)}<span class="visually-hidden">（在新标签页打开）</span></a>
      <span class="about__url">${esc(source.url)}</span>
    </li>`).join("");
  return `<ul class="about__list">${items}</ul>`;
}

/**
 * Markup of the unit caveat rows.
 *
 * @returns {string} HTML
 */
export function unitNotesHtml() {
  const items = UNIT_NOTES.map((note) => `<li class="about__item">
      <p class="about__item-name">${esc(note.title)}</p>
      <p class="about__item-text">${esc(note.text)}</p>
    </li>`).join("");
  return `<ul class="about__list">${items}</ul>`;
}

/**
 * Markup of the "not tracked" rows.
 *
 * @returns {string} HTML
 */
export function untrackedHtml() {
  const items = UNTRACKED.map((entry) => `<li class="about__untracked">
      <span class="about__untracked-name">${esc(entry.name)}</span>
      <span class="about__untracked-reason">${esc(entry.reason)}</span>
    </li>`).join("");
  return `<ul class="about__untracked-list">${items}</ul>`;
}

/**
 * The clear-all button. Disabled while nothing is selected, so the confirm
 * dialog can never appear for a no-op.
 *
 * @param {{state?: {selections?: object}}} ctx
 * @returns {string} HTML
 */
export function clearButtonHtml(ctx) {
  const count = selectionCount(ctx);
  const disabled = count === 0 ? " disabled" : "";
  const meta = count === 0 ? "当前没有已选食物" : `已选 ${count} 种食物`;
  return `<div class="about__clear">
      <button type="button" class="about__clear-btn" data-action="clear-all"${disabled}>${esc(CLEAR_LABEL)}</button>
      <p class="about__clear-meta">${esc(meta)}</p>
    </div>`;
}

/**
 * The whole About section.
 *
 * @param {{state?: object}} ctx
 * @returns {string} HTML
 */
export function aboutHtml(ctx) {
  return `<div class="about__head">
      <h2 class="about__title">数据来源与说明</h2>
      <p class="about__intro">本站只做参考摄入量的对照与食物速查，所有数值均可追溯到下列公开来源。</p>
    </div>

    <section class="about__section" aria-labelledby="about-sources">
      <h3 class="about__subtitle" id="about-sources">数据来源</h3>
      ${sourcesHtml()}
    </section>

    <section class="about__section" aria-labelledby="about-estimates">
      <h3 class="about__subtitle" id="about-estimates">估算值说明</h3>
      <p class="about__text">
        家常菜肴（标有“估算”徽章）是按常见配方用原料数据折算出来的粗略值，不是实验室测得的成品数据；家庭计量（一碗、一把、一掌心等）同样只是近似重量。称重仍然是最准确的做法。
      </p>
    </section>

    <section class="about__section" aria-labelledby="about-units">
      <h3 class="about__subtitle" id="about-units">单位与上限说明</h3>
      ${unitNotesHtml()}
    </section>

    <section class="about__section" aria-labelledby="about-untracked">
      <h3 class="about__subtitle" id="about-untracked">未纳入的营养素</h3>
      ${untrackedHtml()}
    </section>

    <section class="about__section" aria-labelledby="about-privacy">
      <h3 class="about__subtitle" id="about-privacy">数据与隐私</h3>
      <p class="about__text">
        你的性别、年龄、参考标准、已选食物和数量只保存在本浏览器的本地存储（localStorage）中，不会上传到任何服务器。清除浏览器数据或点击下方按钮会删除这些记录。
      </p>
      ${clearButtonHtml(ctx)}
    </section>

    <p class="about__disclaimer" role="note">
      本站仅供一般信息参考，不构成医疗建议。如有健康问题或特殊饮食需求，请咨询医生或注册营养师。
    </p>`;
}

/**
 * Click handler: confirm, then clear every selection.
 *
 * @param {Event} event
 */
function handleClick(event) {
  const container = event.currentTarget;
  const ctx = container._aboutCtx;
  if (!ctx) return;
  const button = event.target.closest('[data-action="clear-all"]');
  if (!button || button.disabled || !container.contains(button)) return;
  if (selectionCount(ctx) === 0) return;

  const ask = typeof window !== "undefined" && typeof window.confirm === "function"
    ? window.confirm.bind(window)
    : null;
  if (!ask || ask(CLEAR_CONFIRM) !== true) return;

  // Set before the re-render so `renderAbout` can restore the focus.
  container._aboutFocus = true;
  ctx.onChange("clearAll", undefined);
}

/**
 * Render (or re-render) the About section into `container`.
 *
 * @param {HTMLElement|null} container section in index.html
 * @param {{state: object, onChange: Function}} ctx `onChange(action, payload)`
 *   applies a state.js reducer and saves in the caller
 */
export function renderAbout(container, ctx) {
  if (!container || !ctx || !ctx.state) return;

  container.innerHTML = aboutHtml(ctx);
  container.classList.add("panel", "panel--about");
  container.setAttribute("aria-busy", "false");

  container._aboutCtx = ctx;
  if (!container._aboutBound) {
    container._aboutBound = true;
    container.addEventListener("click", handleClick);
  }

  // Focus returns to the button once after a confirmed clear (the section is
  // rebuilt), so keyboard users do not lose their place. After the clear the
  // button becomes disabled and is no longer focusable, so the panel itself
  // takes the focus instead.
  if (container._aboutFocus) {
    container._aboutFocus = false;
    const button = container.querySelector('[data-action="clear-all"]');
    if (button && !button.disabled) {
      button.focus({ preventScroll: true });
    } else {
      container.setAttribute("tabindex", "-1");
      container.focus({ preventScroll: true });
    }
  }
}

export default {
  CLEAR_CONFIRM,
  CLEAR_LABEL,
  ABOUT_SOURCES,
  UNIT_NOTES,
  UNTRACKED,
  selectionCount,
  sourcesHtml,
  unitNotesHtml,
  untrackedHtml,
  clearButtonHtml,
  aboutHtml,
  renderAbout,
};
