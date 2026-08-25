import gameDataIndex from './gameDataIndex.generated.json';

const itemDetailMap = gameDataIndex?.combatScrollItemDetailIndex || {};
// 由 `combatsimulator/data/personalBuffTypeDetailMap.json` 生成；
// 让共享代码基于生成的投影，使依赖保持单向。
const personalBuffTypeDetailMap = gameDataIndex?.personalBuffTypeDetailIndex || {};

/**
 * 战斗卷轴是一种可开启、不可交易的物品，可赋予限时个人增益。
 * 持续时间保持模拟器原生的纳秒单位，调用方无需自行转换官方数据。
 */
export const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';
export const COMBAT_SCROLL_CATEGORY_HRID = '/item_categories/scroll';
// 当前官方目录使用此持续时间。它仍作为诊断时的默认参考值；
// 未来有效的数据可能提供其他持续时间。
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
 * 从两张官方映射中解析战斗有效的卷轴。该连接刻意采用数据驱动：
 * 当物品指向一个动作映射包含战斗的个人增益时，新卷轴会自动出现。
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
    // 格式错误/不完整的模板不得创建可选行或运行时增益。
    // 有效数据的持续时间具有权威性，以便未来的目录变更
    // 可见，而不是静默隐藏卷轴。
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
      // 为消费方保留 `hrid` 作为小的兼容别名，
      // 其形状与其他选项列表一致。
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
 * 归一化一个持久化的数量值。
 *
 * `null` 是无限库存唯一的归一化表示；正安全整数表示有限库存；
 * `undefined` 表示无效。布尔值刻意视为无效，因为行的启用
 * 由键是否存在（或显式的 `enabled` 字段）表示，而不取决于数量值。
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
    // 存在的空对象表示已勾选行且数量为空（无限），
    // 对手工编辑的导入很有用。
    return { enabled: true, quantity: null };
  }

  return { enabled: true, quantity: rawEntry };
}

/**
 * 归一化持久化的映射形状：
 *   { "/items/seal_of_damage": { quantity: 3 } }
 *   { "/items/seal_of_wisdom": { quantity: null } } // 无限库存
 *
 * 键存在即表示该行已启用。未知/非战斗条目与无效数量
 * 将被丢弃，使导入在旧版本之间保持安全。
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
