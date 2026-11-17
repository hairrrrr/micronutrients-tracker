// Age-group mapping and target lookup for the DRI tables.
//
// Pure ES module: no DOM, no fetch, no imports. Everything here works from the
// data passed in, so node --test can import it directly and the UI can reuse
// it for both standards (PLAN.md 1.4).
//
// Data shape (docs/data/dri.json, built by tools/build_dri.py):
//   { standards: { cn2023: { label, source, note, groups: [
//       { id: "cn-m-30-49", sex: "male", ageMin: 30, ageMax: 49,
//         lifeStage: "none",
//         values: { iron: { target: 12, type: "RNI", ul: 42,
//                           ulAppliesToFood: true, ulNote: null, ref: "..." } } } ] },
//     us: { ... } } }
//
// An open-ended group has `ageMax: null` (China 75+, US 71+).

/** Adults only: the UI clamps every age into this range (PLAN.md 1.4). */
export const MIN_AGE = 18;
/** Upper end of the covered range; older ages are clamped to it. */
export const MAX_AGE = 100;

/** v1 only supports the general adult population. */
export const DEFAULT_LIFE_STAGE = "none";

const SEXES = ["male", "female"];

/**
 * Clamp an age to the covered adult range.
 * Non-numeric input falls back to MIN_AGE, so a broken localStorage value can
 * never throw.
 *
 * @param {number|string} age
 * @returns {number} integer age between MIN_AGE and MAX_AGE
 */
export function clampAge(age) {
  const value = Math.trunc(Number(age));
  if (!Number.isFinite(value)) return MIN_AGE;
  if (value < MIN_AGE) return MIN_AGE;
  if (value > MAX_AGE) return MAX_AGE;
  return value;
}

/**
 * Find the age group of a standard for one profile.
 *
 * The age is clamped to 18..100 first (the site covers adults only), then the
 * first group whose `[ageMin, ageMax]` contains it is returned; `ageMax: null`
 * means open-ended. Groups for another sex or life stage are ignored.
 *
 * @param {{groups?: Array<object>}|Array<object>} standard
 *   a standard object from dri.json (`{ groups: [...] }`) or the group array
 * @param {"male"|"female"} sex
 * @param {number|string} age integer age; values outside 18..100 are clamped
 * @param {string} [lifeStage] "none" in v1; anything else finds no group
 * @returns {object|null} the matching group, or null when nothing matches
 */
export function findGroup(standard, sex, age, lifeStage = DEFAULT_LIFE_STAGE) {
  if (!standard || !SEXES.includes(sex)) return null;
  if ((lifeStage || DEFAULT_LIFE_STAGE) !== DEFAULT_LIFE_STAGE) return null;

  const groups = Array.isArray(standard) ? standard : standard.groups;
  if (!Array.isArray(groups)) return null;

  const value = clampAge(age);
  for (const group of groups) {
    if (!group || group.sex !== sex) continue;
    if ((group.lifeStage || DEFAULT_LIFE_STAGE) !== DEFAULT_LIFE_STAGE) continue;
    const min = Number(group.ageMin);
    const max = group.ageMax === null || group.ageMax === undefined ? Infinity : Number(group.ageMax);
    if (!Number.isFinite(min)) continue;
    if (value >= min && value <= max) return group;
  }
  return null;
}

/**
 * Targets of one standard for a profile.
 *
 * @param {object} dri whole dri.json payload (`{ standards: {...} }`)
 * @param {string} standardKey e.g. "cn2023" or "us"
 * @param {{sex: string, age: number, lifeStage?: string}} profile
 * @returns {{standard: string, group: object|null, values: object, unitIds: string[]}}
 *   `values` maps nutrient id -> { target, type, ul, ulAppliesToFood, ulNote, ref };
 *   it is empty when the profile has no group for that standard.
 */
export function targetsFor(dri, standardKey, profile) {
  const standard = dri?.standards?.[standardKey] ?? null;
  const sex = profile?.sex;
  const age = profile?.age;
  const lifeStage = profile?.lifeStage || DEFAULT_LIFE_STAGE;

  const group = findGroup(standard, sex, age, lifeStage);
  return {
    standard: standardKey,
    group: group ?? null,
    values: group?.values ?? {},
    unitIds: Object.keys(group?.values ?? {}),
  };
}

export default { MIN_AGE, MAX_AGE, clampAge, findGroup, targetsFor };
