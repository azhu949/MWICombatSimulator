// Module-load-time shape validation for every buff that the combat engine
// consumes from checked-in data files.  addBuff (combatUnit.js) performs the
// same checks on the hot path as its final line of defense; this module moves
// the failure point earlier so a bad data update (e.g. a buff missing
// `duration`) is caught at startup/test time instead of mid-fight, where it
// would abort an already-running simulation.
//
// Coverage:
//   - abilityDetailMap.json   — buff effects of all abilities (incl. party auras,
//                               which additionally have the stronger snapshot
//                               assertion in buffSourcePolicy.js)
//   - itemDetailMap.json      — consumable (food/drink) buffs
// Combat scrolls are validated by getCombatScrollBuffTemplate (combatScrolls.js)
// at construction; curse/fury/weaken/enrage buffs are constructed inline in
// combatSimulator.js and do not change with game data updates.
import abilityDetailMap from './data/abilityDetailMap.json';
import itemDetailMap from './data/itemDetailMap.json';

const BUFF_EFFECT_TYPE_HRID = '/ability_effect_types/buff';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate one buff record against the shape addBuff relies on.  Throws a
 * TypeError listing the offending fields with a data-path context string.
 */
export function validateBuffShape(buff, context) {
  const problems = [];
  if (!isNonEmptyString(buff?.uniqueHrid)) {
    problems.push('uniqueHrid');
  }
  if (!isNonEmptyString(buff?.typeHrid)) {
    problems.push('typeHrid');
  }
  if (!isFiniteNumber(buff?.ratioBoost)) {
    problems.push('ratioBoost');
  }
  if (!isFiniteNumber(buff?.flatBoost)) {
    problems.push('flatBoost');
  }
  if (!isFiniteNumber(buff?.duration)) {
    problems.push('duration');
  }
  if (problems.length > 0) {
    throw new TypeError(`Buff data shape invalid at ${context}: ${problems.join(', ')}`);
  }
}

export function collectAbilityBuffShapes(abilityMap = abilityDetailMap) {
  const failures = [];
  for (const [hrid, ability] of Object.entries(abilityMap ?? {})) {
    for (const [effectIndex, effect] of (ability?.abilityEffects ?? []).entries()) {
      if (effect?.effectType !== BUFF_EFFECT_TYPE_HRID) {
        continue;
      }
      for (const [buffIndex, buff] of (effect?.buffs ?? []).entries()) {
        try {
          validateBuffShape(buff, `ability ${hrid} effect[${effectIndex}] buff[${buffIndex}]`);
        } catch (error) {
          failures.push(error.message);
        }
      }
    }
  }
  return failures;
}

export function collectItemBuffShapes(itemMap = itemDetailMap) {
  const failures = [];
  for (const [hrid, item] of Object.entries(itemMap ?? {})) {
    const buffs = item?.consumableDetail?.buffs ?? item?.buffs;
    if (!Array.isArray(buffs)) {
      continue;
    }
    for (const [buffIndex, buff] of buffs.entries()) {
      try {
        validateBuffShape(buff, `item ${hrid} buff[${buffIndex}]`);
      } catch (error) {
        failures.push(error.message);
      }
    }
  }
  return failures;
}

/**
 * Assert every checked-in ability/consumable buff record has the shape the
 * combat engine consumes.  Injectable maps keep the failure reporting and the
 * unit tests independent of the shipped data files.
 */
export function assertBuffShapesValid({ abilityMap = abilityDetailMap, itemMap = itemDetailMap } = {}) {
  const failures = [...collectAbilityBuffShapes(abilityMap), ...collectItemBuffShapes(itemMap)];
  if (failures.length > 0) {
    throw new Error(
      `Checked-in buff data contains ${failures.length} malformed buff record(s). ` +
        `Fix the data files (or update this validation) before shipping:\n` +
        failures.map((failure) => `  - ${failure}`).join('\n'),
    );
  }
}

// Run once at module load so every simulation/test entry point fails fast on
// malformed buff data before any fight can start.
assertBuffShapesValid();
