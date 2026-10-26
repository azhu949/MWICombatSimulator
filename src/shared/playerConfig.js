import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS, houseRoomHrids, isKnownNonCombatDrink } from './gameDataIndex.js';
import { combatGuildBuffHrids, normalizeGuildBuffLevels } from './guildBuffs.js';

export { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS };

export function createEmptySkillExperienceMap() {
  return Object.fromEntries(LEVEL_KEYS.map((key) => [key, null]));
}

export function normalizeHouseRoomLevels(houseRooms) {
  const source = houseRooms && typeof houseRooms === 'object' && !Array.isArray(houseRooms) ? houseRooms : {};

  return Object.fromEntries(
    houseRoomHrids.map((hrid) => {
      const current = Number(source[hrid] ?? 0);
      const level = Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0;
      return [hrid, level];
    }),
  );
}

// 战斗技能等级上限：对齐首页「基础设置」技能面板的等级输入 max（HomeLoadoutPanels.vue）。
export const MAX_ABILITY_LEVEL = 400;

// 已学战斗技能（Ability）等级权威表：{ [abilityHrid]: level }。
// 技能等级属于技能本身（角色全局属性，游戏内学到即保留），不随装备槽/配装走；槽位上的
// level 只是当前展示值。套用配装 / 换技能时按 hrid 查本表，避免「技能不在当前槽位就掉回
// 1 级」（切换配装丢等级）。形状清洗：非对象视为空、空 hrid 丢弃、等级钳到 1..400。
export function normalizeAbilityLevels(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const [abilityHrid, rawLevel] of Object.entries(source)) {
    const hrid = String(abilityHrid || '').trim();
    if (!hrid) {
      continue;
    }
    const level = Math.floor(Number(rawLevel));
    if (Number.isFinite(level)) {
      result[hrid] = Math.min(Math.max(level, 1), MAX_ABILITY_LEVEL);
    }
  }
  return result;
}

/**
 * 规范化的 PlayerConfig 对象在内存中数据密集：每个已知的房屋房间和
 * 战斗公会增益都有数值等级，而成就始终使用映射。
 * 序列化可能压缩零级房屋房间，因此每个接受外部或已保存玩家的
 * Store 边界都必须恢复这一约定。
 */
export function ensurePlayerAdvancedState(player) {
  if (!player || typeof player !== 'object') {
    return null;
  }

  player.houseRooms = normalizeHouseRoomLevels(player.houseRooms);
  player.abilityLevels = normalizeAbilityLevels(player.abilityLevels);

  if (!player.achievements || typeof player.achievements !== 'object' || Array.isArray(player.achievements)) {
    player.achievements = {};
  }
  player.guildBuffs = normalizeGuildBuffLevels(player.guildBuffs);
  player.loadouts = normalizePlayerLoadouts(player.loadouts);
  return player;
}

// 配装快照的装备键白名单：主装备槽位 + preview-only 饰品槽（trinket）。
// 与 importExportMapper 的 IMPORTABLE_EQUIPMENT_SLOTS 同口径，配装快照经
// 导入导出 / 玩家数据快照往返时不丢饰品数据。
const LOADOUT_EQUIPMENT_KEYS = Object.freeze([...EQUIPMENT_SLOT_KEYS, 'trinket']);
const LOADOUT_ABILITY_SLOT_COUNT = 5;
const LOADOUT_CONSUMABLE_SLOT_COUNT = 3;
const MAX_LOADOUT_ENHANCEMENT_LEVEL = 20;

// 游戏内配装（Loadout）快照列表的归一化：条目形如
// { id, name, actionTypeHrid, isDefault, equipment, food, drinks, abilities, triggerMap }，
// 是可反复套用的只读快照（套用时整体覆盖玩家装备/食物/饮品/技能/触发器）。
// triggerMap 在本层只做形状防护（对象浅拷贝），深度清洗由 importExportMapper 的
// sanitizePlayerConfig 统一完成（shared 层不反向依赖 services 的 triggerMapper）。
export function normalizePlayerLoadouts(rawLoadouts) {
  if (!Array.isArray(rawLoadouts)) {
    return [];
  }

  const loadouts = [];
  for (const rawEntry of rawLoadouts) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue;
    }

    const id = String(rawEntry.id || '').trim();
    const name = String(rawEntry.name || '').trim();
    if (!id || !name) {
      continue;
    }

    const rawEquipment =
      rawEntry.equipment && typeof rawEntry.equipment === 'object' && !Array.isArray(rawEntry.equipment)
        ? rawEntry.equipment
        : {};
    const equipment = {};
    for (const slot of LOADOUT_EQUIPMENT_KEYS) {
      const entry = rawEquipment[slot] && typeof rawEquipment[slot] === 'object' ? rawEquipment[slot] : {};
      const level = Math.floor(Number(entry.enhancementLevel));
      equipment[slot] = {
        itemHrid: String(entry.itemHrid || ''),
        enhancementLevel: Number.isFinite(level) ? Math.min(Math.max(level, 0), MAX_LOADOUT_ENHANCEMENT_LEVEL) : 0,
      };
    }

    loadouts.push({
      id,
      name,
      actionTypeHrid: String(rawEntry.actionTypeHrid || ''),
      isDefault: rawEntry.isDefault === true,
      equipment,
      food: Array.from({ length: LOADOUT_CONSUMABLE_SLOT_COUNT }, (unused, index) =>
        String(rawEntry.food?.[index] || ''),
      ),
      // 与 importExportMapper 的 normalizeDrinkSlotValue 同口径：已知战斗不可用饮品
      // （如各类 *_tea）置空，其余（含未知 hrid）原样保留——这类饮品进入引擎会以
      // 「恒触发 + 零冷却」造成 checkTriggers 死循环（见 gameDataIndex 的 isKnownNonCombatDrink）。
      drinks: Array.from({ length: LOADOUT_CONSUMABLE_SLOT_COUNT }, (unused, index) => {
        const drinkHrid = String(rawEntry.drinks?.[index] || '');
        return isKnownNonCombatDrink(drinkHrid) ? '' : drinkHrid;
      }),
      abilities: Array.from({ length: LOADOUT_ABILITY_SLOT_COUNT }, (unused, index) => {
        const entry = rawEntry.abilities?.[index];
        const level = Math.floor(Number(entry?.level));
        return {
          abilityHrid: String(entry?.abilityHrid || ''),
          level: Number.isFinite(level) ? Math.max(1, level) : 1,
        };
      }),
      triggerMap:
        rawEntry.triggerMap && typeof rawEntry.triggerMap === 'object' && !Array.isArray(rawEntry.triggerMap)
          ? { ...rawEntry.triggerMap }
          : {},
    });
  }

  return loadouts;
}

export function createEmptyPlayerConfig(id) {
  const houseRooms = normalizeHouseRoomLevels();
  const guildBuffs = Object.fromEntries(combatGuildBuffHrids.map((hrid) => [hrid, 0]));
  const levels = Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1]));
  const skillExperience = createEmptySkillExperienceMap();
  const equipment = Object.fromEntries(
    EQUIPMENT_SLOT_KEYS.map((slot) => [slot, { itemHrid: '', enhancementLevel: 0 }]),
  );

  return {
    id: String(id),
    name: `Player ${id}`,
    selected: Number(id) === 1,
    levels,
    skillExperience,
    equipment,
    food: ['', '', ''],
    drinks: ['', '', ''],
    // 非战斗行动类型（制作/生活技能）的茶槽，形如 { [actionTypeHrid]: [茶 hrid, ...] }。
    // 供资产分的精炼折扣（工匠茶 lessResource，对齐 MWITools projectAction 的茶效）使用。
    craftingTeaSlots: {},
    abilities: [
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ],
    triggerMap: {},
    // 已学战斗技能等级权威表（技能等级属于技能本身，不随配装走；套用配装按 hrid 查表，
    // 避免技能不在当前槽位就掉回 1 级）。槽位上的 level 只是当前展示值。
    abilityLevels: {},
    // 游戏内配装（Loadout）快照列表，由主站导入解析生成；空数组 = 未导入配装。
    loadouts: [],
    // 已启用的战斗卷轴以物品 HRID 为键。值为
    // `{ quantity: null }` 表示无限库存；缺失的键为禁用行。
    // 为兼容旧配置，默认保持映射为空。
    combatScrolls: {},
    houseRooms,
    guildBuffs,
    achievements: {},
    // 资产分（Gear Score）快照，由 assetScoreService 计算后写入；
    // null 表示尚未计算/无资产数据（UI 隐藏）。结构见 assetScoreService.sanitizeAssetScorePayload。
    assetScore: null,
  };
}

export function calcCombatLevel(
  staminaLevel,
  intelligenceLevel,
  defenseLevel,
  attackLevel,
  meleeLevel,
  rangedLevel,
  magicLevel,
) {
  return (
    0.1 *
      (staminaLevel + intelligenceLevel + attackLevel + defenseLevel + Math.max(meleeLevel, rangedLevel, magicLevel)) +
    0.5 * Math.max(attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel)
  );
}
