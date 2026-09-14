import gameDataIndex from './gameDataIndex.generated.json';
import buffTypeDetailMap from '../combatsimulator/data/buffTypeDetailMap.json';
import itemCategoryDetailMap from '../combatsimulator/data/itemCategoryDetailMap.json';
import skillDetailMap from '../combatsimulator/data/skillDetailMap.json';
import {
  combatScrollDefinitions,
  combatScrollOptions,
  getCombatScrollBuffTemplate,
  getCombatScrollDefinition,
  getCombatScrollOptions,
  normalizeCombatScrolls,
} from './combatScrolls.js';

export const LEVEL_KEYS = gameDataIndex?.metadata?.levelKeys || [];
export const EQUIPMENT_SLOT_KEYS = gameDataIndex?.metadata?.equipmentSlotKeys || [];
// 生成时间戳会在共享游戏数据索引重建时变化。消费方可在
// 长生命周期应用会话期间热重载数据时，用它使派生的记忆化结果失效。
export const GAME_DATA_VERSION = String(gameDataIndex?.metadata?.generatedAt || 'unknown');

export const itemDetailIndex = gameDataIndex?.itemDetailIndex || {};
export const itemVendorPriceByHrid = gameDataIndex?.itemVendorPriceByHrid || {};
export const abilityDetailIndex = gameDataIndex?.abilityDetailIndex || {};
export const actionDetailIndex = gameDataIndex?.actionDetailIndex || {};
export const monsterDetailIndex = gameDataIndex?.monsterDetailIndex || {};
export const houseRoomDetailIndex = gameDataIndex?.houseRoomDetailIndex || {};
export const buffTypeDetailIndex = buffTypeDetailMap || {};
export const skillDetailIndex = skillDetailMap || {};
export const itemCategoryDetailIndex = itemCategoryDetailMap || {};
export const combatScrollItemDetailIndex = gameDataIndex?.combatScrollItemDetailIndex || {};
export const personalBuffTypeDetailIndex = gameDataIndex?.personalBuffTypeDetailIndex || {};

// 与其他共享游戏数据索引一起重新导出数据驱动的战斗卷轴目录，
// 供已依赖此模块的调用方使用。
export {
  combatScrollDefinitions,
  combatScrollOptions,
  getCombatScrollBuffTemplate,
  getCombatScrollDefinition,
  getCombatScrollOptions,
  normalizeCombatScrolls,
};

export const levelExperienceTable = Array.isArray(gameDataIndex?.levelExperienceTable)
  ? gameDataIndex.levelExperienceTable
  : [];
export const abilityBookInfoByAbilityHrid = gameDataIndex?.abilityBookInfoByAbilityHrid || {};

export const equipmentOptionsBySlot = gameDataIndex?.equipmentBySlot || {};
// 装备下拉口径（与饮品 combatUsable 过滤同层：在选项「出品」处过滤，而不是由各消费方
// 各自过滤）：护符槽位构建期投影的 isCombatInert 默认不出现在战斗向装备下拉里。判定
// 依据是引擎口径本身——equipment.js 的 getCombatStat 对 combatStats 中不存在的属性一律
// 返回 0、getFocusTraining 直读 combatStats.focusTraining，所以 combatStats 为空的护符
// 在战斗模拟里不产生任何战斗贡献（当前 102 条护符：60 条为空、42 条有战斗属性）。
// 字段是产出语义而非身份语义：isCombatInert = 「引擎在战斗里读不到贡献 ⇒ 不作为战斗向
// 选项出品」，combatStats 缺数据时同样投影为 true 作 fail-safe（见构建脚本
// resolveIsCombatInert 注释），因此不要把它当「生活技能护符」身份判定使用。
// selectedItemHrid 是「保留已选中」例外——当前已装备的被过滤项追加到列表末尾，避免
// SearchCombobox 的 displayValue 落空、把已装备物品显示成空白（让人误判装备丢失）。
// simulatorStore 用它产出 options.equipmentBySlot（默认已过滤），并以
// getEquipmentComboboxOptions(slotKey, selectedItemHrid) 暴露该例外；装备下拉消费方
// 取选项一律走该 action，绕过它只会丢掉「保留已选中」，不会带出生活技能护符。
// 反向提醒：simulator.options.* 是「战斗模拟器选项目录」（已剔除生活技能护符）；
// 需要全量护符（含生活技能护符）的非战斗消费方，请直接读本模块的原始导出
// equipmentOptionsBySlot，不要指望 store 状态。
export function resolveEquipmentComboboxItems(options, selectedItemHrid = '') {
  const optionList = Array.isArray(options) ? options : [];
  const visibleOptions = optionList.filter((option) => option?.isCombatInert !== true);
  // filter 只做删除、不重排：长度不变即「一条都没被剔除」，可见项与入参逐元素相同，
  // 此时返回入参本身而不是过滤副本——无标记槽位的 store 选项就是共享索引里的同一个数组
  // （equipmentOptionsBySlot[slot]），返回副本会让「选项 === 索引」在引用层面不成立，
  // 并让每个无标记槽位都常驻一份等价副本。调用方只读，不得原地修改（含排序）。
  if (visibleOptions.length === optionList.length) {
    return optionList;
  }

  const selectedHrid = String(selectedItemHrid || '');
  if (!selectedHrid || visibleOptions.some((option) => String(option?.hrid || '') === selectedHrid)) {
    return visibleOptions;
  }

  const selectedOption = optionList.find((option) => String(option?.hrid || '') === selectedHrid);
  return selectedOption ? [...visibleOptions, selectedOption] : visibleOptions;
}
export const foodOptions = Array.isArray(gameDataIndex?.foodOptions) ? gameDataIndex.foodOptions : [];
export const drinkOptions = Array.isArray(gameDataIndex?.drinkOptions) ? gameDataIndex.drinkOptions : [];
// 已知战斗不可用饮品的 hrid 集合，来源于构建期
// usableInActionTypeMap['/action_types/combat'] 的 combatUsable 投影
// （与 simulatorStore 饮品下拉过滤使用同一数据驱动语义）。
// 此类饮品（如各类 *_tea）cooldownDuration=0 且无默认战斗触发器，一旦从
// 历史持久化/导入配置残留进引擎，会以"恒触发 + 零冷却"造成
// checkTriggers 死循环（模拟永久挂起），因此导入归一化与引擎映射
// 两处都必须清除/跳过它们。
const knownNonCombatDrinkHridSet = new Set(
  drinkOptions
    .filter((option) => option?.combatUsable === false)
    .map((option) => String(option?.hrid || ''))
    .filter(Boolean),
);

// 仅对"已知战斗不可用"的饮品返回 true；未知 hrid 一律返回 false，
// 以保持既有"未知 hrid 原样保留"的导入行为。
export function isKnownNonCombatDrink(hrid) {
  return knownNonCombatDrinkHridSet.has(String(hrid || ''));
}
export const abilityOptions = Array.isArray(gameDataIndex?.abilityOptions) ? gameDataIndex.abilityOptions : [];
export const specialAbilityOptions = Array.isArray(gameDataIndex?.specialAbilityOptions)
  ? gameDataIndex.specialAbilityOptions
  : [];
export const zoneOptions = Array.isArray(gameDataIndex?.zones) ? gameDataIndex.zones : [];
export const dungeonOptions = Array.isArray(gameDataIndex?.dungeons) ? gameDataIndex.dungeons : [];
export const groupZoneHrids = Array.isArray(gameDataIndex?.groupZoneHrids) ? gameDataIndex.groupZoneHrids : [];
export const soloZoneHrids = Array.isArray(gameDataIndex?.soloZoneHrids) ? gameDataIndex.soloZoneHrids : [];
// 非地牢战斗区域的怪物刷新投影（构建期生成，来源 actionDetailMap 的
// fightInfo.randomSpawnInfo.spawns + bossSpawns 合并去重）：键为区域 hrid，
// 值为 [{ monsterHrid, difficultyTier }, ...]；difficultyTier 是难度档偏移，
// 有效怪物难度 = difficultyTier + 区域难度档。
export const zoneMonsterSpawnIndex = gameDataIndex?.zoneMonsterSpawnIndex || {};
export const labyrinthOptions = Array.isArray(gameDataIndex?.labyrinthOptions) ? gameDataIndex.labyrinthOptions : [];
export const houseRoomOptions = Array.isArray(gameDataIndex?.houseRoomOptions) ? gameDataIndex.houseRoomOptions : [];
export const houseRoomHrids = Array.isArray(gameDataIndex?.houseRoomHrids) ? gameDataIndex.houseRoomHrids : [];
export const labyrinthCrateOptions = gameDataIndex?.labyrinthCrates || { coffee: [], food: [], tea: [] };
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export const enhancementData = deepFreeze(gameDataIndex?.enhancementData || {});
export const skillingData = deepFreeze(gameDataIndex?.skillingData || {});

function normalizeSkillHrid(skillKey) {
  const normalized = String(skillKey || '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('/skills/')) {
    return `/skills/${normalized.slice('/skills/'.length).toLowerCase()}`;
  }

  const shortKey = normalized.split('/').filter(Boolean).pop() || normalized;
  return `/skills/${shortKey.toLowerCase()}`;
}

export function getItemName(hrid, fallback = '') {
  const normalized = String(hrid || '');
  if (!normalized) {
    return String(fallback || '');
  }
  return String(itemDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getAbilityName(hrid, fallback = '') {
  const normalized = String(hrid || '');
  if (!normalized) {
    return String(fallback || '');
  }
  return String(abilityDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getActionName(hrid, fallback = '') {
  const normalized = String(hrid || '');
  if (!normalized) {
    return String(fallback || '');
  }
  return String(actionDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getMonsterName(hrid, fallback = '') {
  const normalized = String(hrid || '');
  if (!normalized) {
    return String(fallback || '');
  }
  return String(monsterDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getHouseRoomName(hrid, fallback = '') {
  const normalized = String(hrid || '');
  if (!normalized) {
    return String(fallback || '');
  }
  return String(houseRoomDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getBuffTypeName(hrid, fallback = '') {
  const normalized = String(hrid || '').trim();
  if (!normalized) {
    return String(fallback || '');
  }
  return String(buffTypeDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getSkillName(skillKey, fallback = '') {
  const raw = String(skillKey || '').trim();
  if (!raw) {
    return String(fallback || '');
  }

  const normalizedHrid = normalizeSkillHrid(raw);
  return String(skillDetailIndex?.[normalizedHrid]?.name || fallback || raw);
}

export function getItemCategoryName(hrid, fallback = '') {
  const normalized = String(hrid || '').trim();
  if (!normalized) {
    return String(fallback || '');
  }
  return String(itemCategoryDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getSortedHouseRoomOptions() {
  return houseRoomOptions;
}
