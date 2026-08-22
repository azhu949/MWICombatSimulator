import gameDataIndex from './gameDataIndex.generated.json';

const itemDetailMap = gameDataIndex?.combatScrollItemDetailIndex || {};
// Generated from `combatsimulator/data/personalBuffTypeDetailMap.json`; keep
// shared code on the generated projection so dependencies remain one-way.
const personalBuffTypeDetailMap = gameDataIndex?.personalBuffTypeDetailIndex || {};

/**
 * A combat scroll is an openable, non-tradable item which grants a timed
 * personal buff.  Keep the duration in the simulator's native nanosecond
 * unit so callers do not have to convert the official data themselves.
 */
export const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';
export const COMBAT_SCROLL_CATEGORY_HRID = '/item_categories/scroll';
// The current official catalog uses this duration.  It remains the default
// reference for diagnostics; valid future data may provide another duration.
export const COMBAT_SCROLL_DURATION_NS = 30 * 60 * 1_000_000_000;

const warnedDurationMismatchKeys = new Set();

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeBuffTemplate(rawBuff) {
  if (!isPlainObject(rawBuff)) {
    return null;
  }

  const uniqueHrid = String(rawBuff.uniqueHrid || '').trim();
  const typeHrid = String(rawBuff.typeHrid || '').trim();
  const duration = finiteNumber(rawBuff.duration, 0);
  if (!uniqueHrid || !typeHrid || duration <= 0) {
    return null;
  }

  return {
    uniqueHrid,
    typeHrid,
    ratioBoost: finiteNumber(rawBuff.ratioBoost, 0),
    ratioBoostLevelBonus: finiteNumber(rawBuff.ratioBoostLevelBonus, 0),
    flatBoost: finiteNumber(rawBuff.flatBoost, 0),
    flatBoostLevelBonus: finiteNumber(rawBuff.flatBoostLevelBonus, 0),
    startTime: rawBuff.startTime ?? null,
    duration,
    multiplierForSkillHrid: String(rawBuff.multiplierForSkillHrid || ''),
    multiplierPerSkillLevel: finiteNumber(rawBuff.multiplierPerSkillLevel, 0),
  };
}

/**
 * Resolve combat-valid scrolls from the two official maps.  The
 * join is deliberately data-driven: a new scroll appears automatically when
 * its item points to a personal buff whose action map includes combat.
 */
export function getCombatScrollOptions({
  itemMap = itemDetailMap,
  personalBuffMap = personalBuffTypeDetailMap,
  itemDetailMap: itemDetailMapOverride,
  personalBuffTypeDetailMap: personalBuffTypeDetailMapOverride,
} = {}) {
  const resolvedItemMap = itemDetailMapOverride ?? itemMap;
  const resolvedPersonalBuffMap = personalBuffTypeDetailMapOverride ?? personalBuffMap;
  const items = isPlainObject(resolvedItemMap) ? Object.values(resolvedItemMap) : [];
  const personalBuffs = isPlainObject(resolvedPersonalBuffMap) ? resolvedPersonalBuffMap : {};
  const options = [];

  for (const item of items) {
    const itemHrid = String(item?.hrid || '').trim();
    const personalBuffTypeHrid = String(item?.scrollDetail?.personalBuffTypeHrid || '').trim();
    if (!itemHrid || String(item?.categoryHrid || '') !== COMBAT_SCROLL_CATEGORY_HRID || !personalBuffTypeHrid) {
      continue;
    }

    const personalBuff = personalBuffs[personalBuffTypeHrid];
    if (!personalBuff?.usableInActionTypeMap?.[COMBAT_ACTION_TYPE_HRID]) {
      continue;
    }

    const buff = normalizeBuffTemplate(personalBuff.buff);
    // A malformed/partial template must not create a selectable row or a
    // runtime buff.  The valid data duration is authoritative so a future
    // catalog change is visible instead of silently hiding the scroll.
    if (!buff) {
      continue;
    }
    if (buff.duration !== COMBAT_SCROLL_DURATION_NS) {
      const warningKey = `${itemHrid}:${buff.duration}`;
      if (!warnedDurationMismatchKeys.has(warningKey)) {
        warnedDurationMismatchKeys.add(warningKey);
        console.warn(
          `Combat scroll ${itemHrid} uses duration ${buff.duration}ns; ` +
            `the current default is ${COMBAT_SCROLL_DURATION_NS}ns. ` +
            'Using the data duration.',
        );
      }
    }

    const sortIndex = finiteNumber(personalBuff.sortIndex, finiteNumber(item.sortIndex, 0));
    options.push({
      itemHrid,
      // `hrid` is kept as a small compatibility alias for consumers
      // which use the same shape as other option lists.
      hrid: itemHrid,
      name: String(item.name || personalBuff.name || itemHrid),
      description: String(item.description || ''),
      categoryHrid: COMBAT_SCROLL_CATEGORY_HRID,
      sortIndex,
      itemSortIndex: finiteNumber(item.sortIndex, sortIndex),
      personalBuffTypeHrid,
      personalBuffName: String(personalBuff.name || personalBuffTypeHrid),
      personalBuffType: clone(personalBuff),
      usableInActionTypeMap: clone(personalBuff.usableInActionTypeMap || {}),
      buff,
      durationNs: buff.duration,
      duration: buff.duration,
    });
  }

  options.sort(
    (left, right) =>
      left.sortIndex - right.sortIndex ||
      left.name.localeCompare(right.name) ||
      left.itemHrid.localeCompare(right.itemHrid),
  );

  return options;
}

export const combatScrollOptions = getCombatScrollOptions();
export const combatScrollDefinitions = combatScrollOptions;
const combatScrollByItemHrid = Object.freeze(
  Object.fromEntries(combatScrollOptions.map((option) => [option.itemHrid, option])),
);

export function getCombatScrollDefinition(itemHrid, options = undefined) {
  const normalizedHrid = String(itemHrid || '').trim();
  if (!normalizedHrid) {
    return null;
  }

  if (options == null) {
    return combatScrollByItemHrid[normalizedHrid] || null;
  }

  const resolved = getCombatScrollOptions(options);
  return resolved.find((option) => option.itemHrid === normalizedHrid) || null;
}

export function getCombatScrollBuffTemplate(itemHrid, options = undefined) {
  const definition = getCombatScrollDefinition(itemHrid, options);
  return definition?.buff ? clone(definition.buff) : null;
}

export const getCombatScrollBuff = getCombatScrollBuffTemplate;

export function isCombatScrollHrid(itemHrid, options = undefined) {
  return Boolean(getCombatScrollDefinition(itemHrid, options));
}

/**
 * Normalize one persisted quantity value.
 *
 * `null` is the only normalized representation of unlimited inventory;
 * positive safe integers are finite inventory; `undefined` means invalid.
 * Booleans are deliberately invalid because row enablement is represented by
 * key presence (or an explicit `enabled` field), never by the quantity value.
 */
export function normalizeCombatScrollQuantity(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }

  if (typeof value === 'boolean') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function readRawQuantity(rawEntry) {
  if (isPlainObject(rawEntry)) {
    if (rawEntry.enabled === false) {
      return { enabled: false, quantity: null };
    }
    if (Object.prototype.hasOwnProperty.call(rawEntry, 'quantity')) {
      return { enabled: true, quantity: rawEntry.quantity };
    }
    if (Object.prototype.hasOwnProperty.call(rawEntry, 'count')) {
      return { enabled: true, quantity: rawEntry.count };
    }
    // A present empty object represents a checked row with an empty
    // quantity (unlimited), which is useful for hand-edited imports.
    return { enabled: true, quantity: null };
  }

  return { enabled: true, quantity: rawEntry };
}

/**
 * Normalize the persisted map shape:
 *   { "/items/seal_of_damage": { quantity: 3 } }
 *   { "/items/seal_of_wisdom": { quantity: null } } // unlimited
 *
 * An existing key means the row is enabled. Unknown/non-combat entries and
 * invalid quantities are discarded, making imports safe across old versions.
 */
export function normalizeCombatScrolls(raw, options = undefined) {
  if (!isPlainObject(raw)) {
    return {};
  }

  const definitions =
    options == null
      ? combatScrollByItemHrid
      : Object.fromEntries(getCombatScrollOptions(options).map((option) => [option.itemHrid, option]));
  const normalized = {};

  for (const [rawHrid, rawEntry] of Object.entries(raw)) {
    const itemHrid = String(rawHrid || '').trim();
    if (!itemHrid || !definitions[itemHrid]) {
      continue;
    }

    const { enabled, quantity } = readRawQuantity(rawEntry);
    if (!enabled) {
      continue;
    }

    const normalizedQuantity = normalizeCombatScrollQuantity(quantity);
    if (normalizedQuantity === undefined) {
      continue;
    }

    normalized[itemHrid] = { quantity: normalizedQuantity };
  }

  return normalized;
}

export function cloneCombatScrolls(raw) {
  return normalizeCombatScrolls(raw);
}
