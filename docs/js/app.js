// Entry point: load the JSON data with relative fetch, restore the state from
// localStorage, render the profile panel and wire every change back into the
// pure reducers (PLAN.md 1.1, 1.5 and phase P9).
//
// Flow: change event -> state.js reducer -> save() -> re-render. Nothing else
// mutates the state, so the panel, storage and any later card/list section can
// never disagree.
//
// All paths are relative ("data/…", "js/…") so the site works at
// https://host/ and at https://host/any/sub/path/ (PLAN.md rule 7).

import { load, reduce, save } from "./core/state.js";
import { renderProfile } from "./ui/profile.js";

const DATA_FILES = ["nutrients", "foods", "dri"];

/** Text shown when the data cannot be loaded. */
const LOAD_ERROR = "数据加载失败，请刷新页面重试。";

/**
 * Fetch one JSON file next to index.html.
 *
 * @param {string} name file stem without extension, e.g. "nutrients"
 * @returns {Promise<object>} parsed JSON
 */
async function fetchJson(name) {
  const response = await fetch(`data/${name}.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${name}.json: HTTP ${response.status}`);
  return response.json();
}

/**
 * localStorage access that survives private mode / disabled storage.
 *
 * @returns {Storage|null}
 */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Replace the loading placeholder with a Chinese error message.
 *
 * @param {string} message
 */
function showError(message) {
  const section = document.getElementById("profile");
  if (!section) return;
  section.setAttribute("aria-busy", "false");
  section.innerHTML = `<p class="status status--error" role="alert">${message}</p>`;
}

/**
 * Index foods by id for the calculation/lookup modules.
 *
 * @param {{foods?: Array<object>}|null} foodsJson
 * @returns {Record<string, object>}
 */
function indexFoods(foodsJson) {
  /** @type {Record<string, object>} */
  const byId = {};
  for (const food of foodsJson?.foods ?? []) {
    if (food && typeof food.id === "string") byId[food.id] = food;
  }
  return byId;
}

async function main() {
  const section = document.getElementById("profile");
  if (!section) return;

  const store = storage();

  let payloads;
  try {
    payloads = await Promise.all(DATA_FILES.map((name) => fetchJson(name)));
  } catch (error) {
    console.error(error);
    showError(`${LOAD_ERROR}（${error instanceof Error ? error.message : String(error)}）`);
    return;
  }

  const [nutrients, foods, dri] = payloads;

  /** Everything the UI modules need, shared by every section. */
  const app = {
    nutrients,
    foods,
    dri,
    foodsById: indexFoods(foods),
    state: load(store),
  };

  /**
   * Apply a reducer, persist and re-render the panel.
   *
   * @param {string} action state.js reducer name
   * @param {*} payload reducer payload
   */
  function update(action, payload) {
    app.state = reduce(app.state, action, payload);
    save(app.state, store);
    renderProfile(section, context);
  }

  const context = {
    get state() {
      return app.state;
    },
    nutrients: app.nutrients,
    dri: app.dri,
    foods: app.foods,
    onChange: update,
  };

  renderProfile(section, context);

  // Handy for the headless smoke check and the console; no behaviour depends
  // on it.
  window.__app = app;
}

main().catch((error) => {
  console.error(error);
  showError(LOAD_ERROR);
});
