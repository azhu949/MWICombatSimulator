import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS, houseRoomHrids } from './gameDataIndex.js';
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

  if (!player.achievements || typeof player.achievements !== 'object' || Array.isArray(player.achievements)) {
    player.achievements = {};
  }
  player.guildBuffs = normalizeGuildBuffLevels(player.guildBuffs);
  return player;
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
