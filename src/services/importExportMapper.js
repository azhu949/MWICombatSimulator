import {
  actionDetailIndex,
  abilityDetailIndex,
  isKnownNonCombatDrink,
  itemDetailIndex,
  monsterDetailIndex,
} from '../shared/gameDataIndex.js';
import itemLocationDetailMap from '../combatsimulator/data/itemLocationDetailMap.json';
import {
  createEmptyPlayerConfig,
  createEmptySkillExperienceMap,
  EQUIPMENT_SLOT_KEYS,
  LEVEL_KEYS,
  normalizeHouseRoomLevels,
} from '../shared/playerConfig.js';
import { LABYRINTH_ROOM_LEVEL_DEFAULT, LABYRINTH_ROOM_LEVEL_MIN } from '../shared/labyrinthConfig.js';
import { combatGuildBuffDetails, getGuildBuffMaxLevel, normalizeGuildBuffLevels } from '../shared/guildBuffs.js';
import { sanitizeTriggerList, sanitizeTriggerMap } from './triggerMapper.js';
import { normalizeCombatScrolls } from '../shared/combatScrolls.js';
import { sanitizeAssetScorePayload } from './assetScoreService.js';

const NON_WEAPON_SLOTS = EQUIPMENT_SLOT_KEYS.filter((slot) => slot !== 'weapon');
const COMBAT_ABILITY_SLOT_COUNT = 5;
const SPECIAL_ABILITY_SLOT_INDEX = 0;
const FIRST_STANDARD_ABILITY_SLOT_INDEX = SPECIAL_ABILITY_SLOT_INDEX + 1;
const ITEM_LOCATION_HRID_PREFIX = '/item_locations/';
const WEAPON_ITEM_LOCATION_HRIDS = new Set(['/item_locations/main_hand', '/item_locations/two_hand']);
const PREVIEW_ONLY_EQUIPMENT_SLOTS = new Set(['trinket']);
const IMPORTABLE_EQUIPMENT_SLOTS = [...EQUIPMENT_SLOT_KEYS, ...Array.from(PREVIEW_ONLY_EQUIPMENT_SLOTS)];

const LEGACY_ABILITY_ALIAS_MAP = {
  '/abilities/aqua_aura': '/abilities/mystic_aura',
  '/abilities/flame_aura': '/abilities/mystic_aura',
  '/abilities/sylvan_aura': '/abilities/mystic_aura',
  '/abilities/arcane_reflection': '/abilities/retribution',
};

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactHouseRooms(houseRooms) {
  // PlayerConfig 在内存中数据密集；可移植格式特意省略零级房间，
  // 在导入时于 Store 边界重新展开。
  const compact = {};

  for (const [hrid, level] of Object.entries(normalizeHouseRoomLevels(houseRooms))) {
    if (level > 0) {
      compact[hrid] = level;
    }
  }

  return compact;
}

function buildExportPlayer(player) {
  const normalized = sanitizePlayerConfig(player, player);
  normalized.houseRooms = compactHouseRooms(normalized.houseRooms);
  return normalized;
}

function normalizeAbilityHrid(abilityHrid) {
  const raw = String(abilityHrid || '');
  return LEGACY_ABILITY_ALIAS_MAP[raw] || raw;
}

// 游戏强化等级上限 20（与 enhancementSimulator normalizeEnhancementConfig 的
// clamp(..., 1, 20)、enhancementImportMapper clampInteger(..., 0, 20, 0) 同口径）。
// 手注 JSON 的超限值（如 enhancementLevel=999）必须钳到 20：否则行元数据显示 +999
// 而计价按 +20，且战斗模拟 equipment.js 直接以等级索引 21 元素倍率表（999 → undefined）。
const MAX_ENHANCEMENT_LEVEL = 20;

function clampEnhancementLevel(level) {
  const parsed = Math.floor(toFiniteNumber(level, 0));
  return Math.min(Math.max(parsed, 0), MAX_ENHANCEMENT_LEVEL);
}

function resolveEquipmentSlotFromItemLocationHrid(itemLocationHrid) {
  const normalizedHrid = String(itemLocationHrid || '').trim();
  if (!normalizedHrid) {
    return '';
  }

  const locationDetail = itemLocationDetailMap?.[normalizedHrid];
  if (!locationDetail || String(locationDetail?.type || '') !== '/item_location_types/equipment') {
    return '';
  }

  if (WEAPON_ITEM_LOCATION_HRIDS.has(normalizedHrid)) {
    return 'weapon';
  }

  if (!normalizedHrid.startsWith(ITEM_LOCATION_HRID_PREFIX)) {
    return '';
  }

  const slot = normalizedHrid.slice(ITEM_LOCATION_HRID_PREFIX.length);
  if (PREVIEW_ONLY_EQUIPMENT_SLOTS.has(slot)) {
    return slot;
  }
  return NON_WEAPON_SLOTS.includes(slot) ? slot : '';
}

function getLegacyAbilityEntryCount(rawAbilities) {
  if (Array.isArray(rawAbilities)) {
    return Object.keys(rawAbilities).length;
  }

  if (rawAbilities && typeof rawAbilities === 'object') {
    return Object.keys(rawAbilities).filter((key) => /^\d+$/.test(String(key))).length;
  }

  return 0;
}

function detectLegacyAbilityIndexOffset(rawAbilities) {
  if (Array.isArray(rawAbilities)) {
    if (rawAbilities[0] != null) {
      return 0;
    }
    if (rawAbilities[1] != null) {
      return 1;
    }
    return 0;
  }

  if (rawAbilities && typeof rawAbilities === 'object') {
    if (
      Object.prototype.hasOwnProperty.call(rawAbilities, 0) ||
      Object.prototype.hasOwnProperty.call(rawAbilities, '0')
    ) {
      return 0;
    }
    if (
      Object.prototype.hasOwnProperty.call(rawAbilities, 1) ||
      Object.prototype.hasOwnProperty.call(rawAbilities, '1')
    ) {
      return 1;
    }
  }

  return 0;
}

function getLegacyAbilityEntry(rawAbilities, absoluteIndex) {
  if (absoluteIndex < 0) {
    return null;
  }

  if (Array.isArray(rawAbilities)) {
    return rawAbilities[absoluteIndex] ?? null;
  }

  if (rawAbilities && typeof rawAbilities === 'object') {
    return rawAbilities[absoluteIndex] ?? rawAbilities[String(absoluteIndex)] ?? null;
  }

  return null;
}

function normalizeSkillExperience(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function resolveImportedCombatScrolls(source, fallbackCombatScrolls, preserveWhenMissing) {
  const hasCombatScrolls = Object.prototype.hasOwnProperty.call(source, 'combatScrolls');
  if (hasCombatScrolls) {
    return normalizeCombatScrolls(source.combatScrolls);
  }

  return preserveWhenMissing ? normalizeCombatScrolls(fallbackCombatScrolls) : {};
}

// 清洗饮品槽：已知战斗不可用饮品（如各类 *_tea）置空，其余（含未知 hrid）
// 原样保留。战斗不可用饮品进入引擎会以"恒触发 + 零冷却"造成
// checkTriggers 死循环（模拟永久挂起），且不在下拉选项中（显示空白）。
function normalizeDrinkSlotValue(rawValue) {
  const drinkHrid = String(rawValue || '');
  return isKnownNonCombatDrink(drinkHrid) ? '' : drinkHrid;
}

function sanitizePlayerConfig(
  raw,
  fallbackPlayer,
  { preserveMissingGuildBuffs = false, preserveMissingCombatScrolls = false } = {},
) {
  const fallback = deepClone(fallbackPlayer || createEmptyPlayerConfig(1));
  const source = raw && typeof raw === 'object' ? raw : {};
  const sourceSkillExperience =
    source.skillExperience && typeof source.skillExperience === 'object' ? source.skillExperience : null;

  const normalized = deepClone(fallback);
  normalized.id = String(source.id || fallback.id);
  normalized.name = String(source.name || fallback.name || `Player ${normalized.id}`);
  normalized.selected = source.selected == null ? fallback.selected : Boolean(source.selected);

  for (const key of LEVEL_KEYS) {
    normalized.levels[key] = Math.max(1, Math.floor(toFiniteNumber(source.levels?.[key], fallback.levels[key] || 1)));
    normalized.skillExperience[key] = sourceSkillExperience
      ? normalizeSkillExperience(sourceSkillExperience[key])
      : null;
  }

  for (const slot of IMPORTABLE_EQUIPMENT_SLOTS) {
    const sourceSlot = source.equipment?.[slot] ?? {};
    normalized.equipment[slot] = {
      itemHrid: String(sourceSlot.itemHrid || ''),
      enhancementLevel: clampEnhancementLevel(sourceSlot.enhancementLevel),
    };
  }

  normalized.food = [0, 1, 2].map((index) => String(source.food?.[index] || ''));
  normalized.drinks = [0, 1, 2].map((index) => normalizeDrinkSlotValue(source.drinks?.[index]));
  normalized.craftingTeaSlots = sanitizeCraftingTeaSlots(source.craftingTeaSlots ?? fallback.craftingTeaSlots ?? {});

  normalized.abilities = [0, 1, 2, 3, 4].map((index) => {
    const sourceAbility = source.abilities?.[index] ?? {};
    return {
      abilityHrid: normalizeAbilityHrid(sourceAbility.abilityHrid || sourceAbility.ability || ''),
      level: Math.max(1, Math.floor(toFiniteNumber(sourceAbility.level, 1))),
    };
  });

  normalized.triggerMap = sanitizeTriggerMap(source.triggerMap ?? fallback.triggerMap ?? {});

  normalized.combatScrolls = resolveImportedCombatScrolls(source, fallback.combatScrolls, preserveMissingCombatScrolls);

  normalized.houseRooms = normalizeHouseRoomLevels(
    source.houseRooms && typeof source.houseRooms === 'object' ? source.houseRooms : fallback.houseRooms,
  );

  // preserveMissingGuildBuffs 仅在 source.guildBuffs 整体缺失时生效（fallback 兜底）。
  // share-profile 路径的 guildBuffLevelMap 经 extractEffectiveGuildBuffLevels 归一化后
  // 恒为完整战斗键映射（缺失键一律 0），不存在缺失键，fallback 不会命中；旧式 solo
  // 配置的局部 guildBuffs 映射（合并导入语义）缺失键才回退到 fallback.guildBuffs。
  normalized.guildBuffs = normalizeGuildBuffLevels(
    source.guildBuffs,
    preserveMissingGuildBuffs ? fallback.guildBuffs : {},
  );

  normalized.achievements = Object.prototype.hasOwnProperty.call(source, 'achievements')
    ? source.achievements && typeof source.achievements === 'object'
      ? deepClone(source.achievements)
      : {}
    : deepClone(fallback.achievements ?? {});

  // 资产分快照：形状合法则原样保留（含导出携带与共享 JSON 导入），
  // 缺失或形状非法时置 null，由 store 的 refreshAssetScores 重新计算。
  normalized.assetScore = sanitizeAssetScorePayload(source.assetScore);

  return normalized;
}

function applyLegacySoloToPlayer(legacySoloPayload, fallbackPlayer, { preserveMissingCombatScrolls = false } = {}) {
  const fallback = deepClone(fallbackPlayer || createEmptyPlayerConfig(1));
  const payload = legacySoloPayload && typeof legacySoloPayload === 'object' ? legacySoloPayload : {};

  const merged = deepClone(fallback);
  merged.skillExperience = createEmptySkillExperienceMap();

  for (const key of LEVEL_KEYS) {
    const sourceKey = `${key}Level`;
    const fallbackValue = fallback.levels[key] || 1;
    let value = payload.player?.[sourceKey];

    if (key === 'melee' && (value == null || value === '') && payload.player?.powerLevel != null) {
      value = payload.player.powerLevel;
    }

    merged.levels[key] = Math.max(1, Math.floor(toFiniteNumber(value, fallbackValue)));
  }

  const equipmentEntries = Array.isArray(payload.player?.equipment) ? payload.player.equipment : [];
  for (const slot of IMPORTABLE_EQUIPMENT_SLOTS) {
    merged.equipment[slot] = {
      itemHrid: '',
      enhancementLevel: 0,
    };
  }

  for (const entry of equipmentEntries) {
    const location = String(entry?.itemLocationHrid || '').trim();
    const itemHrid = String(entry?.itemHrid || '');
    const enhancementLevel = clampEnhancementLevel(entry?.enhancementLevel);

    if (!location || !itemHrid) {
      continue;
    }

    const slot = resolveEquipmentSlotFromItemLocationHrid(location);
    if (slot) {
      merged.equipment[slot] = { itemHrid, enhancementLevel };
    }
  }

  const foodEntries = payload.food?.['/action_types/combat'];
  const drinkEntries = payload.drinks?.['/action_types/combat'];

  for (let i = 0; i < 3; i++) {
    merged.food[i] = String(foodEntries?.[i]?.itemHrid || '');
    merged.drinks[i] = normalizeDrinkSlotValue(String(drinkEntries?.[i]?.itemHrid || '').replace('power', 'melee'));
  }

  const legacyAbilities = payload.abilities;
  const hasSpecialAbilitySlot = getLegacyAbilityEntryCount(legacyAbilities) === 5;
  const abilityIndexOffset = detectLegacyAbilityIndexOffset(legacyAbilities);

  for (let i = 0; i < 5; i++) {
    const legacyIndex = hasSpecialAbilitySlot ? i : i - 1;
    const sourceAbility = getLegacyAbilityEntry(legacyAbilities, legacyIndex + abilityIndexOffset) ?? {};
    merged.abilities[i] = {
      abilityHrid: normalizeAbilityHrid(sourceAbility.abilityHrid || sourceAbility.ability || ''),
      level: Math.max(1, Math.floor(toFiniteNumber(sourceAbility.level, 1))),
    };
  }

  merged.triggerMap = sanitizeTriggerMap(payload.triggerMap ?? fallback.triggerMap ?? {});

  merged.combatScrolls = resolveImportedCombatScrolls(payload, fallback.combatScrolls, preserveMissingCombatScrolls);

  merged.houseRooms = normalizeHouseRoomLevels(
    payload.houseRooms && typeof payload.houseRooms === 'object' ? payload.houseRooms : fallback.houseRooms,
  );

  merged.guildBuffs = normalizeGuildBuffLevels(payload.guildBuffs);

  merged.achievements = Object.prototype.hasOwnProperty.call(payload, 'achievements')
    ? payload.achievements && typeof payload.achievements === 'object'
      ? deepClone(payload.achievements)
      : {}
    : deepClone(fallback.achievements ?? {});

  return merged;
}

const SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID = '/action_types/combat';
// 制作茶槽键前缀：非战斗行动类型键形如 /action_types/<skill>（战斗键由白名单显式剔除）。
const CRAFTING_TEA_ACTION_TYPE_KEY_PREFIX = '/action_types/';

function resolveShareableProfileSource(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const wrappedProfile = parsed?.profile;
  if (wrappedProfile && typeof wrappedProfile === 'object' && wrappedProfile?.sharableCharacter) {
    return wrappedProfile;
  }

  return parsed;
}

function isShareableProfilePayload(parsed) {
  const source = resolveShareableProfileSource(parsed);
  return Boolean(source?.sharableCharacter && Array.isArray(source?.characterSkills));
}

function isMainSiteCurrentCharacterPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || isShareableProfilePayload(parsed)) {
    return false;
  }

  return Boolean(
    parsed?.character &&
    typeof parsed.character === 'object' &&
    Array.isArray(parsed?.characterSkills) &&
    (Object.prototype.hasOwnProperty.call(parsed, 'characterItems') ||
      Object.prototype.hasOwnProperty.call(parsed, 'combatUnit') ||
      Object.prototype.hasOwnProperty.call(parsed, 'actionTypeFoodSlotsMap') ||
      Object.prototype.hasOwnProperty.call(parsed, 'actionTypeDrinkSlotsMap')),
  );
}

function mapShareableSkillHridToLevelKey(skillHrid) {
  const normalized = String(skillHrid || '').trim();
  if (!normalized.startsWith('/skills/')) {
    return '';
  }

  const key = normalized.slice('/skills/'.length);
  if (key === 'power') {
    return 'melee';
  }

  return LEVEL_KEYS.includes(key) ? key : '';
}

function scoreShareableLoadoutCandidate(candidate) {
  const actionTypeHrid = String(candidate?.actionTypeHrid || '');
  let score = 0;

  if (actionTypeHrid === SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID) {
    score += 8;
  }
  if (candidate?.isDefault === true) {
    score += 4;
  }
  if (Array.isArray(candidate?.foodItemHrids)) {
    score += 2;
  }
  if (Array.isArray(candidate?.drinkItemHrids)) {
    score += 2;
  }
  if (candidate?.consumableCombatTriggersMap && typeof candidate.consumableCombatTriggersMap === 'object') {
    score += 1;
  }
  if (candidate?.abilityCombatTriggersMap && typeof candidate.abilityCombatTriggersMap === 'object') {
    score += 1;
  }

  return score;
}

function buildShareableProfileLoadoutCandidates(profile) {
  const candidates = [];

  function pushCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object' || candidates.includes(candidate)) {
      return;
    }

    candidates.push(candidate);
  }

  pushCandidate(profile?.currentCombatLoadout);
  pushCandidate(profile?.combatLoadout);
  pushCandidate(profile?.currentLoadout);
  pushCandidate(profile?.loadout);

  const mappedLoadouts =
    profile?.characterLoadoutMap && typeof profile.characterLoadoutMap === 'object'
      ? Object.values(profile.characterLoadoutMap)
          .filter((candidate) => candidate && typeof candidate === 'object')
          .sort((left, right) => scoreShareableLoadoutCandidate(right) - scoreShareableLoadoutCandidate(left))
      : [];

  for (const candidate of mappedLoadouts) {
    pushCandidate(candidate);
  }

  pushCandidate(profile);

  return candidates;
}

function pickShareableCandidateValue(candidates, resolvers, fallbackValue = null) {
  for (const candidate of candidates) {
    for (const resolve of resolvers) {
      const value = resolve(candidate);
      if (value != null) {
        return value;
      }
    }
  }

  return fallbackValue;
}

function toObjectValueList(source) {
  if (Array.isArray(source)) {
    return source;
  }

  if (source && typeof source === 'object') {
    return Object.values(source);
  }

  return [];
}

function createEmptyAbilitySlots() {
  return Array.from({ length: COMBAT_ABILITY_SLOT_COUNT }, () => ({ abilityHrid: '', level: 1 }));
}

function buildNormalizedCombatAbilityEntry(rawAbility) {
  if (!rawAbility || typeof rawAbility !== 'object') {
    return null;
  }

  const abilityHrid = normalizeAbilityHrid(
    rawAbility?.abilityHrid || rawAbility?.ability?.abilityHrid || rawAbility?.ability || '',
  );
  if (!abilityHrid) {
    return null;
  }

  const rawSlotNumber = rawAbility?.slotNumber ?? rawAbility?.slot ?? rawAbility?.slotIndex ?? rawAbility?.position;
  const explicitSlotNumber = Math.floor(toFiniteNumber(rawSlotNumber, Number.NaN));

  return {
    abilityHrid,
    level: Math.max(1, Math.floor(toFiniteNumber(rawAbility?.level ?? rawAbility?.abilityLevel, 1))),
    isSpecialAbility: abilityDetailIndex?.[abilityHrid]?.isSpecialAbility === true,
    explicitSlotNumber,
    hasExplicitSlot: Number.isFinite(explicitSlotNumber),
  };
}

function resolveExplicitNormalAbilitySlotStrategy(normalEntries, explicitSpecialEntries) {
  const explicitSpecialSlotNumbers = explicitSpecialEntries
    .map((entry) => entry.explicitSlotNumber)
    .filter((slotNumber) => Number.isFinite(slotNumber));
  if (explicitSpecialSlotNumbers.some((slotNumber) => slotNumber <= 0)) {
    return 'zero-based-all-slots';
  }
  if (explicitSpecialSlotNumbers.length > 0) {
    return 'one-based-all-slots';
  }

  const explicitNormalSlotNumbers = normalEntries
    .map((entry) => entry.explicitSlotNumber)
    .filter((slotNumber) => Number.isFinite(slotNumber));

  if (explicitNormalSlotNumbers.length === 0) {
    return 'one-based-standard-slots';
  }

  const minExplicitNormalSlot = Math.min(...explicitNormalSlotNumbers);
  const maxExplicitNormalSlot = Math.max(...explicitNormalSlotNumbers);

  if (minExplicitNormalSlot <= 0) {
    return maxExplicitNormalSlot <= COMBAT_ABILITY_SLOT_COUNT - 2
      ? 'zero-based-standard-slots'
      : 'zero-based-all-slots';
  }

  if (
    maxExplicitNormalSlot >= COMBAT_ABILITY_SLOT_COUNT ||
    minExplicitNormalSlot >= FIRST_STANDARD_ABILITY_SLOT_INDEX + 1
  ) {
    return 'one-based-all-slots';
  }

  return 'one-based-standard-slots';
}

function resolveExplicitNormalAbilitySlotIndex(explicitSlotNumber, strategy) {
  if (!Number.isFinite(explicitSlotNumber)) {
    return null;
  }

  if (strategy === 'zero-based-all-slots') {
    return explicitSlotNumber;
  }

  if (strategy === 'zero-based-standard-slots') {
    return explicitSlotNumber + 1;
  }

  if (strategy === 'one-based-all-slots') {
    return explicitSlotNumber - 1;
  }

  return explicitSlotNumber;
}

function normalizeCombatAbilities(rawAbilities) {
  const normalized = createEmptyAbilitySlots();
  const abilityEntries = toObjectValueList(rawAbilities)
    .map((rawAbility) => buildNormalizedCombatAbilityEntry(rawAbility))
    .filter((entry) => entry !== null);

  const explicitSpecialEntries = abilityEntries.filter((entry) => entry.isSpecialAbility && entry.hasExplicitSlot);
  const implicitSpecialEntries = abilityEntries.filter((entry) => entry.isSpecialAbility && !entry.hasExplicitSlot);
  const explicitNormalEntries = abilityEntries.filter((entry) => !entry.isSpecialAbility && entry.hasExplicitSlot);
  const sequentialNormalEntries = abilityEntries.filter((entry) => !entry.isSpecialAbility && !entry.hasExplicitSlot);

  if (explicitSpecialEntries.length > 0) {
    const specialEntry = explicitSpecialEntries[explicitSpecialEntries.length - 1];
    normalized[SPECIAL_ABILITY_SLOT_INDEX] = {
      abilityHrid: specialEntry.abilityHrid,
      level: specialEntry.level,
    };
  } else if (implicitSpecialEntries.length > 0) {
    const specialEntry = implicitSpecialEntries[0];
    normalized[SPECIAL_ABILITY_SLOT_INDEX] = {
      abilityHrid: specialEntry.abilityHrid,
      level: specialEntry.level,
    };
  }

  const explicitNormalSlotStrategy = resolveExplicitNormalAbilitySlotStrategy(
    explicitNormalEntries,
    explicitSpecialEntries,
  );

  for (const entry of explicitNormalEntries) {
    const targetSlotIndex = resolveExplicitNormalAbilitySlotIndex(entry.explicitSlotNumber, explicitNormalSlotStrategy);
    if (
      !Number.isFinite(targetSlotIndex) ||
      targetSlotIndex < FIRST_STANDARD_ABILITY_SLOT_INDEX ||
      targetSlotIndex >= COMBAT_ABILITY_SLOT_COUNT
    ) {
      sequentialNormalEntries.push(entry);
      continue;
    }

    normalized[targetSlotIndex] = {
      abilityHrid: entry.abilityHrid,
      level: entry.level,
    };
  }

  let nextSequentialNormalSlotIndex = FIRST_STANDARD_ABILITY_SLOT_INDEX;
  for (const entry of sequentialNormalEntries) {
    while (
      nextSequentialNormalSlotIndex < COMBAT_ABILITY_SLOT_COUNT &&
      String(normalized[nextSequentialNormalSlotIndex]?.abilityHrid || '').trim()
    ) {
      nextSequentialNormalSlotIndex += 1;
    }

    if (nextSequentialNormalSlotIndex >= COMBAT_ABILITY_SLOT_COUNT) {
      break;
    }

    normalized[nextSequentialNormalSlotIndex] = {
      abilityHrid: entry.abilityHrid,
      level: entry.level,
    };
    nextSequentialNormalSlotIndex += 1;
  }

  return normalized;
}

function resolveCurrentCharacterItemEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') {
    return null;
  }

  const nestedCurrentItem = rawEntry?.currentItem;
  if (nestedCurrentItem && typeof nestedCurrentItem === 'object') {
    return nestedCurrentItem;
  }

  const nestedItem = rawEntry?.item;
  if (nestedItem && typeof nestedItem === 'object') {
    return nestedItem;
  }

  return rawEntry;
}

function normalizeCurrentCharacterSlotItemHrid(slotValue) {
  if (!slotValue) {
    return '';
  }

  if (typeof slotValue === 'string') {
    return String(slotValue || '');
  }

  if (typeof slotValue === 'object') {
    return String(slotValue?.itemHrid || slotValue?.hrid || '');
  }

  return '';
}

function extractCurrentCharacterConsumableHrids(actionTypeMap) {
  const combatSlots = Array.isArray(actionTypeMap?.[SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID])
    ? actionTypeMap[SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID]
    : [];

  return [0, 1, 2].map((index) => normalizeCurrentCharacterSlotItemHrid(combatSlots[index]));
}

// 制作茶槽键白名单：仅接受 /action_types/ 前缀的非战斗行动类型键。前缀白名单对未来新增
// 生活技能前向兼容（未知合法前缀键放行：消费端只扫槽值、未知键不参与茶效判定，无副作
// 用），同时天然拦截手工伪造的非前缀伪键（__proto__/constructor/任意字符串）——此前伪
// 键会被放行，其中 __proto__ 自有键（JSON.parse 产物）在 result[actionTypeHrid] = items
// 赋值时触发 Object.prototype.__proto__ setter：槽值被静默吞掉、result 原型被换成槽值
// 数组（自伤型，2026-09-01 审计修复）。
function isCraftingTeaActionTypeKey(actionTypeHrid) {
  return (
    typeof actionTypeHrid === 'string' &&
    actionTypeHrid.startsWith(CRAFTING_TEA_ACTION_TYPE_KEY_PREFIX) &&
    actionTypeHrid !== SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID
  );
}

// 非战斗行动类型（制作/生活技能）的茶槽：{ [actionTypeHrid]: [茶 hrid, ...] }。
// 供资产分的精炼材料折扣使用（工匠茶 lessResource，对齐 MWITools 的茶效）。
// 主站 current-character 的 actionTypeDrinkSlotsMap 提取与配置白名单保留共用此单一
// 实现（两份逐行重复实现已收敛，2026-09-01 审计）。
function sanitizeCraftingTeaSlots(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const [actionTypeHrid, slots] of Object.entries(source)) {
    // 键白名单 + 显式剔除战斗键：战斗槽不是制作茶槽，正常流（主站导出/桥接）不可能产出
    // 该键，仅手工构造的导入 JSON 可达；否则消费者 resolveCraftingTeaLessResource 对全部
    // 槽值扫 artisan_tea（不看键类型），战斗键或伪键漏进来会无中生有精炼折扣、装备分
    // 偏低（校验边界缺口，2026-08-31 修复；2026-09-01 收敛单一实现并补键前缀白名单）。
    if (!isCraftingTeaActionTypeKey(actionTypeHrid)) {
      continue;
    }
    if (!Array.isArray(slots)) {
      continue;
    }
    const items = slots.map(normalizeCurrentCharacterSlotItemHrid).filter(Boolean);
    if (items.length > 0) {
      result[actionTypeHrid] = items;
    }
  }
  return result;
}

function extractCurrentCharacterEquipment(parsed, fallbackPlayer) {
  const equipment = deepClone(fallbackPlayer?.equipment || {});
  for (const slot of IMPORTABLE_EQUIPMENT_SLOTS) {
    equipment[slot] = {
      itemHrid: '',
      enhancementLevel: 0,
    };
  }

  for (const rawEntry of toObjectValueList(parsed?.characterItems)) {
    const entry = resolveCurrentCharacterItemEntry(rawEntry);
    const location = String(entry?.itemLocationHrid || rawEntry?.itemLocationHrid || '').trim();
    const itemHrid = String(entry?.itemHrid || entry?.hrid || '').trim();
    const enhancementLevel = clampEnhancementLevel(entry?.enhancementLevel ?? rawEntry?.enhancementLevel);

    if (!location || !itemHrid) {
      continue;
    }

    const slot = resolveEquipmentSlotFromItemLocationHrid(location);
    if (slot) {
      equipment[slot] = { itemHrid, enhancementLevel };
    }
  }

  return equipment;
}

function extractCurrentCharacterAbilities(parsed) {
  return normalizeCombatAbilities(parsed?.combatUnit?.combatAbilities);
}

function extractCurrentCharacterTriggerMap(parsed) {
  const triggerMap = {};
  const rawMaps = [parsed?.consumableCombatTriggersMap, parsed?.abilityCombatTriggersMap];

  for (const rawMap of rawMaps) {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
      continue;
    }

    for (const [targetHrid, triggerList] of Object.entries(rawMap)) {
      const hrid = String(targetHrid || '').trim();
      if (!hrid) {
        continue;
      }
      triggerMap[hrid] = sanitizeTriggerList(triggerList);
    }
  }

  return triggerMap;
}

function hasCurrentCharacterTriggerPayload(parsed) {
  return Boolean(
    parsed &&
    typeof parsed === 'object' &&
    (Object.prototype.hasOwnProperty.call(parsed, 'consumableCombatTriggersMap') ||
      Object.prototype.hasOwnProperty.call(parsed, 'abilityCombatTriggersMap')),
  );
}

function normalizeShareableCombatConsumableArray(rawConsumables, categoryHrid) {
  if (!Array.isArray(rawConsumables)) {
    return null;
  }

  const resolved = rawConsumables
    .map((entry) => {
      const itemHrid = String(entry?.itemHrid || entry?.hrid || '').trim();
      if (!itemHrid) {
        return '';
      }

      return itemDetailIndex?.[itemHrid]?.categoryHrid === categoryHrid ? itemHrid : '';
    })
    .filter(Boolean)
    .slice(0, 3);

  if (resolved.length === 0) {
    return null;
  }

  return [0, 1, 2].map((index) => String(resolved[index] || ''));
}

function extractShareableFoodItemHrids(candidates, parsed) {
  const mainSiteFoodItemHrids = Array.isArray(parsed?.mainSiteConsumables?.foodItemHrids)
    ? parsed.mainSiteConsumables.foodItemHrids
    : null;
  if (mainSiteFoodItemHrids) {
    return [0, 1, 2].map((index) => String(mainSiteFoodItemHrids[index] || ''));
  }

  const resolved = pickShareableCandidateValue(
    candidates,
    [
      (candidate) => (Array.isArray(candidate?.foodItemHrids) ? candidate.foodItemHrids : null),
      (candidate) =>
        Array.isArray(candidate?.combatConsumables?.foodItemHrids) ? candidate.combatConsumables.foodItemHrids : null,
      (candidate) => normalizeShareableCombatConsumableArray(candidate?.combatConsumables, '/item_categories/food'),
      (candidate) => (Array.isArray(candidate?.foodHrids) ? candidate.foodHrids : null),
    ],
    [],
  );

  return [0, 1, 2].map((index) => String(resolved?.[index] || ''));
}

function extractShareableDrinkItemHrids(candidates, parsed) {
  const mainSiteDrinkItemHrids = Array.isArray(parsed?.mainSiteConsumables?.drinkItemHrids)
    ? parsed.mainSiteConsumables.drinkItemHrids
    : null;
  if (mainSiteDrinkItemHrids) {
    return [0, 1, 2].map((index) => String(mainSiteDrinkItemHrids[index] || ''));
  }

  const resolved = pickShareableCandidateValue(
    candidates,
    [
      (candidate) => (Array.isArray(candidate?.drinkItemHrids) ? candidate.drinkItemHrids : null),
      (candidate) =>
        Array.isArray(candidate?.combatConsumables?.drinkItemHrids) ? candidate.combatConsumables.drinkItemHrids : null,
      (candidate) => normalizeShareableCombatConsumableArray(candidate?.combatConsumables, '/item_categories/drink'),
      (candidate) => (Array.isArray(candidate?.drinkHrids) ? candidate.drinkHrids : null),
    ],
    [],
  );

  return [0, 1, 2].map((index) => String(resolved?.[index] || ''));
}

function hasShareableTriggerPayload(candidates, parsed) {
  if (
    parsed?.mainSiteConsumables &&
    typeof parsed.mainSiteConsumables === 'object' &&
    (Object.prototype.hasOwnProperty.call(parsed.mainSiteConsumables, 'consumableCombatTriggersMap') ||
      Object.prototype.hasOwnProperty.call(parsed.mainSiteConsumables, 'abilityCombatTriggersMap'))
  ) {
    return true;
  }

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(candidate, 'consumableCombatTriggersMap') ||
      Object.prototype.hasOwnProperty.call(candidate, 'abilityCombatTriggersMap') ||
      Object.prototype.hasOwnProperty.call(candidate, 'triggerMap')
    ) {
      return true;
    }

    if (
      candidate?.combatConsumables &&
      typeof candidate.combatConsumables === 'object' &&
      Object.prototype.hasOwnProperty.call(candidate.combatConsumables, 'consumableCombatTriggersMap')
    ) {
      return true;
    }

    if (
      candidate?.combatAbilities &&
      typeof candidate.combatAbilities === 'object' &&
      Object.prototype.hasOwnProperty.call(candidate.combatAbilities, 'abilityCombatTriggersMap')
    ) {
      return true;
    }
  }

  return false;
}

function extractShareableTriggerMap(candidates, parsed) {
  const triggerMap = {};

  const mainSiteConsumableTriggerMap = parsed?.mainSiteConsumables?.consumableCombatTriggersMap;
  if (
    mainSiteConsumableTriggerMap &&
    typeof mainSiteConsumableTriggerMap === 'object' &&
    !Array.isArray(mainSiteConsumableTriggerMap)
  ) {
    for (const [targetHrid, triggerList] of Object.entries(mainSiteConsumableTriggerMap)) {
      const hrid = String(targetHrid || '').trim();
      if (!hrid) {
        continue;
      }
      triggerMap[hrid] = sanitizeTriggerList(triggerList);
    }
  }

  const mainSiteAbilityTriggerMap = parsed?.mainSiteConsumables?.abilityCombatTriggersMap;
  if (
    mainSiteAbilityTriggerMap &&
    typeof mainSiteAbilityTriggerMap === 'object' &&
    !Array.isArray(mainSiteAbilityTriggerMap)
  ) {
    for (const [targetHrid, triggerList] of Object.entries(mainSiteAbilityTriggerMap)) {
      const hrid = String(targetHrid || '').trim();
      if (!hrid) {
        continue;
      }
      triggerMap[hrid] = sanitizeTriggerList(triggerList);
    }
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const rawMaps = [
      candidate?.consumableCombatTriggersMap,
      candidate?.abilityCombatTriggersMap,
      candidate?.triggerMap,
      candidate?.combatConsumables?.consumableCombatTriggersMap,
      candidate?.combatAbilities?.abilityCombatTriggersMap,
    ];

    for (const rawMap of rawMaps) {
      if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
        continue;
      }

      for (const [targetHrid, triggerList] of Object.entries(rawMap)) {
        const hrid = String(targetHrid || '').trim();
        if (!hrid) {
          continue;
        }

        triggerMap[hrid] = sanitizeTriggerList(triggerList);
      }
    }
  }

  return triggerMap;
}

function extractShareableHouseRooms(profile, fallbackPlayer) {
  const hasShareableHouseRooms =
    Object.prototype.hasOwnProperty.call(profile || {}, 'characterHouseRoomMap') ||
    Object.prototype.hasOwnProperty.call(profile || {}, 'houseRooms');
  if (!hasShareableHouseRooms) {
    return undefined;
  }

  const sourceMap =
    profile?.characterHouseRoomMap && typeof profile.characterHouseRoomMap === 'object'
      ? profile.characterHouseRoomMap
      : profile?.houseRooms && typeof profile.houseRooms === 'object'
        ? profile.houseRooms
        : {};

  const baseline =
    fallbackPlayer?.houseRooms && typeof fallbackPlayer.houseRooms === 'object'
      ? deepClone(fallbackPlayer.houseRooms)
      : {};

  for (const roomHrid of Object.keys(baseline)) {
    baseline[roomHrid] = 0;
  }

  for (const [roomKey, rawValue] of Object.entries(sourceMap)) {
    const normalizedHrid = String(
      rawValue?.houseRoomHrid || rawValue?.roomHrid || rawValue?.hrid || roomKey || '',
    ).trim();
    if (!normalizedHrid) {
      continue;
    }

    const level = Math.max(0, Math.floor(toFiniteNumber(rawValue?.level ?? rawValue, 0)));
    baseline[normalizedHrid] = level;
  }

  return baseline;
}

function extractShareableAchievements(profile) {
  const hasShareableAchievements =
    Object.prototype.hasOwnProperty.call(profile || {}, 'characterAchievements') ||
    Object.prototype.hasOwnProperty.call(profile || {}, 'achievements');
  if (!hasShareableAchievements) {
    return undefined;
  }

  if (Array.isArray(profile?.characterAchievements)) {
    const achievementMap = {};

    for (const entry of profile.characterAchievements) {
      const achievementHrid = String(entry?.achievementHrid || '').trim();
      if (!achievementHrid || entry?.isCompleted !== true) {
        continue;
      }

      achievementMap[achievementHrid] = true;
    }

    return achievementMap;
  }

  if (profile?.characterAchievements && typeof profile.characterAchievements === 'object') {
    const achievementMap = {};

    for (const [achievementKey, rawValue] of Object.entries(profile.characterAchievements)) {
      const achievementHrid = String(rawValue?.achievementHrid || rawValue?.hrid || achievementKey || '').trim();
      if (!achievementHrid) {
        continue;
      }

      const isCompleted = rawValue === true || rawValue?.isCompleted === true || rawValue?.completed === true;
      if (!isCompleted) {
        continue;
      }

      achievementMap[achievementHrid] = true;
    }

    return achievementMap;
  }

  if (profile?.achievements && typeof profile.achievements === 'object') {
    const entries = Object.entries(profile.achievements);
    const isNormalizedAchievementMap = entries.every(([achievementHrid]) =>
      String(achievementHrid || '')
        .trim()
        .startsWith('/achievements/'),
    );
    if (isNormalizedAchievementMap) {
      return deepClone(profile.achievements);
    }

    const achievementMap = {};
    for (const [achievementKey, rawValue] of entries) {
      const achievementHrid = String(rawValue?.achievementHrid || rawValue?.hrid || achievementKey || '').trim();
      if (!achievementHrid) {
        continue;
      }

      const isCompleted = rawValue === true || rawValue?.isCompleted === true || rawValue?.completed === true;
      if (!isCompleted) {
        continue;
      }

      achievementMap[achievementHrid] = true;
    }

    return achievementMap;
  }

  return {};
}

function extractEffectiveGuildBuffLevels(profile) {
  // 可分享档案（队友）直接以 buff-hrid -> 等级映射携带有效的战斗神龛等级，
  // 例如 { "/guild_buffs/force_combat": 3, "/guild_buffs/tempo_combat": 2 }。
  // 该值已由服务端计算并生效；仅保留每项增益的等级上限约束。
  //
  // map 语义（权威快照）：主站下发的是该角色完整的有效增益等级，且只含已拥有的键
  // （空 map {} = 未拥有任何公会增益，见下方分支；稀疏形状由空 map 分支的存在自证，
  // 同一载荷的 characterGuildBuffMap 旧分支同样是稀疏映射）。因此无论 map 是否为空，
  // 缺失的战斗键一律归 0，不回退到 fallbackGuildBuffLevels——否则队友未拥有的增益
  // 会被静默继承为导入者自己的手动配置，模拟出错误的队友属性。
  //
  // 字段整体缺失（undefined）才走下方旧分支：characterGuildBuffMap × 公会神龛等级计算
  // （同样「缺失归 0」），或数据不足时返回 undefined 交由调用方保留 fallback 配置。
  // 可逆出口（若未来实测主站为覆盖型载荷，应恢复回退语义：重新引入 fallbackGuildBuffLevels
  // 参数与两个调用点的传参，并同步还原测试）：
  //   return normalizeGuildBuffLevels(guildBuffLevelMap, fallbackGuildBuffLevels);
  const guildBuffLevelMap = profile?.guildBuffLevelMap;
  if (guildBuffLevelMap && typeof guildBuffLevelMap === 'object' && !Array.isArray(guildBuffLevelMap)) {
    return normalizeGuildBuffLevels(guildBuffLevelMap, {});
  }

  const hasCharacterGuildBuffs = Object.prototype.hasOwnProperty.call(profile || {}, 'characterGuildBuffMap');
  const hasGuildBuildingLevels = Object.prototype.hasOwnProperty.call(profile || {}, 'guildBuildingLevelMap');
  if (!hasCharacterGuildBuffs || !hasGuildBuildingLevels) {
    return undefined;
  }

  const characterGuildBuffMap = profile?.characterGuildBuffMap;
  const guildBuildingLevelMap = profile?.guildBuildingLevelMap;
  const purchasedLevels = {};
  const entries = Array.isArray(characterGuildBuffMap)
    ? characterGuildBuffMap.map((entry, index) => [String(index), entry])
    : Object.entries(characterGuildBuffMap && typeof characterGuildBuffMap === 'object' ? characterGuildBuffMap : {});

  for (const [entryKey, rawValue] of entries) {
    const guildBuffHrid = String(rawValue?.guildBuffHrid || rawValue?.hrid || entryKey || '').trim();
    if (!guildBuffHrid) {
      continue;
    }
    purchasedLevels[guildBuffHrid] = Math.max(0, Math.floor(toFiniteNumber(rawValue?.level ?? rawValue, 0)));
  }

  const effectiveLevels = {};
  for (const detail of combatGuildBuffDetails) {
    const guildBuffHrid = String(detail?.hrid || '');
    const shrineHrid = String(detail?.shrineHrid || '');
    const rawShrineLevel =
      guildBuildingLevelMap && typeof guildBuildingLevelMap === 'object' ? guildBuildingLevelMap[shrineHrid] : 0;
    const shrineLevel = Math.max(0, Math.floor(toFiniteNumber(rawShrineLevel?.level ?? rawShrineLevel, 0)));
    effectiveLevels[guildBuffHrid] = Math.min(
      purchasedLevels[guildBuffHrid] || 0,
      shrineLevel,
      getGuildBuffMaxLevel(guildBuffHrid),
    );
  }

  return normalizeGuildBuffLevels(effectiveLevels);
}

function extractShareableSimulationSettings(parsed, existingSimulationSettings) {
  const baseline = deepClone(existingSimulationSettings || {});
  const actionHrid = normalizeActionValueToHrid(parsed?.mainSiteCombat?.actionHrid || '');
  if (!actionHrid) {
    return baseline;
  }

  const action = actionDetailIndex[actionHrid];
  if (!action || String(action?.type || '') !== '/action_types/combat') {
    return baseline;
  }

  const maxDifficulty = Math.max(0, Math.floor(toFiniteNumber(action?.maxDifficulty, 0)));
  // 难度层级只借「取整+非负」，不借强化等级的 20 上限（未来动作 maxDifficulty
  // 可能 >20）；上界交给下方 Math.min(maxDifficulty, ...) 按动作数据收紧。
  const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(parsed?.mainSiteCombat?.difficultyTier, 0)));

  baseline.mode = 'zone';
  baseline.useDungeon = Boolean(action?.combatZoneInfo?.isDungeon);
  baseline.difficultyTier = Math.max(0, Math.min(maxDifficulty, difficultyTier));

  if (baseline.useDungeon) {
    baseline.dungeonHrid = actionHrid;
  } else {
    baseline.zoneHrid = actionHrid;
  }

  baseline.runScope = 'single';
  return baseline;
}

function importShareableProfile(parsed, existingPlayer, existingSimulationSettings) {
  const profile = resolveShareableProfileSource(parsed);
  const fallbackPlayer = deepClone(existingPlayer || createEmptyPlayerConfig(1));
  const candidateLoadouts = buildShareableProfileLoadoutCandidates(profile);
  const rawPlayer = {
    id: String(fallbackPlayer.id || '1'),
    name: String(
      profile?.sharableCharacter?.name || profile?.name || fallbackPlayer.name || `Player ${fallbackPlayer.id}`,
    ),
    levels: Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1])),
    skillExperience: createEmptySkillExperienceMap(),
    equipment: {},
    food: extractShareableFoodItemHrids(candidateLoadouts, parsed),
    drinks: extractShareableDrinkItemHrids(candidateLoadouts, parsed),
    craftingTeaSlots: sanitizeCraftingTeaSlots(parsed?.actionTypeDrinkSlotsMap),
    abilities: Array.from({ length: 5 }, () => ({ abilityHrid: '', level: 1 })),
  };

  for (const skill of Array.isArray(profile?.characterSkills) ? profile.characterSkills : []) {
    const levelKey = mapShareableSkillHridToLevelKey(skill?.skillHrid);
    if (!levelKey) {
      continue;
    }

    rawPlayer.levels[levelKey] = Math.max(1, Math.floor(toFiniteNumber(skill?.level, 1)));
    rawPlayer.skillExperience[levelKey] = normalizeSkillExperience(skill?.experience);
  }

  const wearableEntries =
    profile?.wearableItemMap && typeof profile.wearableItemMap === 'object'
      ? Object.values(profile.wearableItemMap)
      : [];
  for (const rawEntry of wearableEntries) {
    const entry = rawEntry?.currentItem && typeof rawEntry.currentItem === 'object' ? rawEntry.currentItem : rawEntry;
    const location = String(entry?.itemLocationHrid || '').trim();
    const itemHrid = String(entry?.itemHrid || '').trim();
    const enhancementLevel = clampEnhancementLevel(entry?.enhancementLevel);

    if (!location || !itemHrid) {
      continue;
    }

    const slot = resolveEquipmentSlotFromItemLocationHrid(location);
    if (slot) {
      rawPlayer.equipment[slot] = { itemHrid, enhancementLevel };
    }
  }

  rawPlayer.abilities = normalizeCombatAbilities(profile?.equippedAbilities);

  const triggerMap = extractShareableTriggerMap(candidateLoadouts, parsed);
  if (hasShareableTriggerPayload(candidateLoadouts, parsed)) {
    rawPlayer.triggerMap = triggerMap;
  }

  const houseRooms = extractShareableHouseRooms(profile, fallbackPlayer);
  if (houseRooms !== undefined) {
    rawPlayer.houseRooms = houseRooms;
  }

  const achievements = extractShareableAchievements(profile);
  if (achievements !== undefined) {
    rawPlayer.achievements = achievements;
  }

  const guildBuffs = extractEffectiveGuildBuffLevels(profile);
  if (guildBuffs !== undefined) {
    rawPlayer.guildBuffs = guildBuffs;
  }

  return {
    // 主站载荷有意不携带当前的战斗卷轴状态；
    // 导入角色档案其余部分时，保留用户的手动卷轴配置。
    player: sanitizePlayerConfig(rawPlayer, fallbackPlayer, {
      preserveMissingGuildBuffs: true,
      preserveMissingCombatScrolls: true,
    }),
    simulationSettings: extractShareableSimulationSettings(parsed, existingSimulationSettings),
    detectedFormat: 'main-site-share-profile',
  };
}

function importMainSiteCurrentCharacter(parsed, existingPlayer, existingSimulationSettings) {
  const fallbackPlayer = deepClone(existingPlayer || createEmptyPlayerConfig(1));
  const rawPlayer = {
    id: String(fallbackPlayer.id || '1'),
    name: String(parsed?.character?.name || fallbackPlayer.name || `Player ${fallbackPlayer.id}`),
    levels: Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1])),
    skillExperience: createEmptySkillExperienceMap(),
    equipment: extractCurrentCharacterEquipment(parsed, fallbackPlayer),
    food: extractCurrentCharacterConsumableHrids(parsed?.actionTypeFoodSlotsMap),
    drinks: extractCurrentCharacterConsumableHrids(parsed?.actionTypeDrinkSlotsMap),
    craftingTeaSlots: sanitizeCraftingTeaSlots(parsed?.actionTypeDrinkSlotsMap),
    abilities: extractCurrentCharacterAbilities(parsed),
  };

  for (const skill of Array.isArray(parsed?.characterSkills) ? parsed.characterSkills : []) {
    const levelKey = mapShareableSkillHridToLevelKey(skill?.skillHrid);
    if (!levelKey) {
      continue;
    }

    rawPlayer.levels[levelKey] = Math.max(1, Math.floor(toFiniteNumber(skill?.level, 1)));
    rawPlayer.skillExperience[levelKey] = normalizeSkillExperience(skill?.experience);
  }

  const triggerMap = extractCurrentCharacterTriggerMap(parsed);
  if (hasCurrentCharacterTriggerPayload(parsed)) {
    rawPlayer.triggerMap = triggerMap;
  }

  const houseRooms = extractShareableHouseRooms(parsed, fallbackPlayer);
  if (houseRooms !== undefined) {
    rawPlayer.houseRooms = houseRooms;
  }

  const achievements = extractShareableAchievements(parsed);
  if (achievements !== undefined) {
    rawPlayer.achievements = achievements;
  }

  const guildBuffs = extractEffectiveGuildBuffLevels(parsed);
  if (guildBuffs !== undefined) {
    rawPlayer.guildBuffs = guildBuffs;
  }

  return {
    player: sanitizePlayerConfig(rawPlayer, fallbackPlayer, {
      preserveMissingGuildBuffs: true,
      preserveMissingCombatScrolls: true,
    }),
    simulationSettings: extractShareableSimulationSettings(parsed, existingSimulationSettings),
    detectedFormat: 'main-site-current-character',
  };
}

export function exportGroupConfig(players, simulationSettings) {
  const playerList = Array.isArray(players) ? players : [];

  return JSON.stringify(
    {
      version: 2,
      format: 'mwi-vue-group',
      simulationSettings: deepClone(simulationSettings || {}),
      players: playerList.map((player) => buildExportPlayer(player)),
    },
    null,
    2,
  );
}

export function exportSoloConfig(player, simulationSettings) {
  const payload = {
    version: 2,
    format: 'mwi-vue-solo',
    simulationSettings: deepClone(simulationSettings || {}),
    player: buildExportPlayer(player),
  };

  return JSON.stringify(payload, null, 2);
}

function parseJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('Input is empty.');
  }

  return JSON.parse(raw);
}

// 主站导入载荷顶层可携带官方估算市场价值快照（marketItemValues），
// 供 store 应用到 pricing 状态（资产分取价链第 ① 级）。缺失时返回 null。
function extractPayloadMarketItemValues(parsed) {
  const raw = parsed && typeof parsed === 'object' ? parsed.marketItemValues : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
    return null;
  }
  return raw;
}

// 主站脚本在载荷顶层挂估值来源标记 marketEstimateSource（'official' / 'synthetic'，
// 见 scripts/mwi-main-site-import.user.js N5）：官方估算整体为空、回落合成中价时标
// 'synthetic'，tooltip / 明细 / 导入反馈据此区分「官方估算 / 合成中价」。白名单外
// （旧载荷 / 复制粘贴载荷无该字段 / 非法值）返回 null，app 侧按现状显示官方估算
// （向后兼容，不劣化）。
function extractPayloadMarketEstimateSource(parsed) {
  const raw = parsed && typeof parsed === 'object' ? parsed.marketEstimateSource : '';
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  return value === 'official' || value === 'synthetic' ? value : null;
}

// #18（2026-08-31）：混合载荷的逐件来源真值——主站脚本在「载荷级标记为 official
// 但 merged 混有合成独有物品」时附 syntheticItemHrids（仅含数值完全来自合成中价的
// 物品 hrid，见 scripts/mwi-main-site-import.user.js）。缺失 / 非数组 / 元素非
// 字符串返回 null，app 侧落全量 official 兼容分支（旧载荷 / 复制粘贴载荷向后兼容，
// 不劣化）。
function extractPayloadSyntheticItemHrids(parsed) {
  const raw = parsed && typeof parsed === 'object' ? parsed.syntheticItemHrids : null;
  if (!Array.isArray(raw)) {
    return null;
  }
  const cleaned = raw.filter((itemHrid) => typeof itemHrid === 'string' && itemHrid.trim().length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

// 【一般-5】（2026-09-02）：混合载荷的等级级来源真值——主站脚本在「载荷级标记为
// official 且存在混合物品（官方估算仅覆盖部分等级）」时附 syntheticLevelKeys
//（{ [itemHrid]: [levelKey, ...] }，仅含该物品由合成中价补齐的等级键，见
// scripts/mwi-main-site-import.user.js collectSyntheticLevelKeys）。缺失 / 非对象 /
// 值非数组返回 null（视为无清单，app 侧维持物品级标注，向后兼容不劣化）；清单存在
// 但合法条目为空返回 {}（明确「本载荷无等级级合成补齐」，配合 store 侧对覆盖 hrid
// 的陈旧等级覆盖清理）。与 syntheticItemHrids 并列提取，六个导入分支同构透传。
function extractPayloadSyntheticLevelKeys(parsed) {
  const raw = parsed && typeof parsed === 'object' ? parsed.syntheticLevelKeys : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const sanitized = {};
  for (const [rawHrid, rawLevels] of Object.entries(raw)) {
    const itemHrid = String(rawHrid || '').trim();
    if (!itemHrid || !Array.isArray(rawLevels)) {
      continue;
    }
    const levelKeys = rawLevels.map((level) => String(level ?? '').trim()).filter((level) => level.length > 0);
    if (levelKeys.length > 0) {
      sanitized[itemHrid] = levelKeys;
    }
  }
  return sanitized;
}

function normalizeActionValueToHrid(value) {
  const source = String(value || '').trim();
  if (!source) {
    return '';
  }
  if (source.startsWith('/actions/')) {
    return source;
  }

  const normalized = source.toLowerCase();
  for (const action of Object.values(actionDetailIndex || {})) {
    const actionName = String(action?.name || '')
      .trim()
      .toLowerCase();
    if (actionName && actionName === normalized) {
      return String(action?.hrid || source);
    }
  }
  return source;
}

function normalizeMonsterValueToHrid(value) {
  const source = String(value || '').trim();
  if (!source) {
    return '';
  }
  if (source.startsWith('/monsters/')) {
    return source;
  }

  const normalized = source.toLowerCase();
  for (const monster of Object.values(monsterDetailIndex || {})) {
    const monsterName = String(monster?.name || '')
      .trim()
      .toLowerCase();
    if (monsterName && monsterName === normalized) {
      return String(monster?.hrid || source);
    }
  }
  return source;
}

function normalizeImportedSimulationSettings(raw, existingSettings) {
  const baseline = deepClone(existingSettings || {});
  const source = raw && typeof raw === 'object' ? raw : {};

  const hasLegacyKeys = ['zone', 'dungeon', 'difficulty', 'simulationTime', 'labyrinth', 'roomLevel'].some(
    (key) => key in source,
  );

  if (hasLegacyKeys) {
    const hasZoneKey = Object.prototype.hasOwnProperty.call(source, 'zone');
    const hasDungeonKey = Object.prototype.hasOwnProperty.call(source, 'dungeon');
    const hasLabyrinthKey = Object.prototype.hasOwnProperty.call(source, 'labyrinth');

    const zoneHrid = hasZoneKey ? normalizeActionValueToHrid(source.zone) : String(baseline.zoneHrid || '');
    const dungeonHrid = hasDungeonKey ? normalizeActionValueToHrid(source.dungeon) : String(baseline.dungeonHrid || '');
    const labyrinthHrid = hasLabyrinthKey
      ? normalizeMonsterValueToHrid(source.labyrinth)
      : String(baseline.labyrinthHrid || '');

    baseline.zoneHrid = zoneHrid;
    baseline.dungeonHrid = dungeonHrid;
    baseline.difficultyTier = Math.max(0, Math.floor(toFiniteNumber(source.difficulty, baseline.difficultyTier || 0)));
    baseline.simulationTimeHours = Math.max(
      1,
      Math.floor(toFiniteNumber(source.simulationTime, baseline.simulationTimeHours || 24)),
    );
    baseline.labyrinthHrid = labyrinthHrid;
    baseline.roomLevel = Math.max(
      LABYRINTH_ROOM_LEVEL_MIN,
      Math.floor(toFiniteNumber(source.roomLevel, baseline.roomLevel || LABYRINTH_ROOM_LEVEL_DEFAULT)),
    );

    if (dungeonHrid) {
      baseline.mode = 'zone';
      baseline.useDungeon = true;
    } else if (zoneHrid) {
      baseline.mode = 'zone';
      baseline.useDungeon = false;
    } else if (labyrinthHrid) {
      baseline.mode = 'labyrinth';
      baseline.useDungeon = false;
    }

    baseline.runScope = 'single';
    return baseline;
  }

  if (source.simulationSettings && typeof source.simulationSettings === 'object') {
    return {
      ...baseline,
      ...deepClone(source.simulationSettings),
    };
  }

  return baseline;
}

export function importGroupConfig(text, existingPlayers, existingSimulationSettings) {
  const parsed = parseJsonText(text);
  const playersById = Object.fromEntries(
    (existingPlayers || []).map((player) => [String(player.id), deepClone(player)]),
  );

  if (parsed && parsed.version === 2 && Array.isArray(parsed.players)) {
    for (const importedPlayer of parsed.players) {
      const playerId = String(importedPlayer?.id || '');
      if (!playersById[playerId]) {
        continue;
      }
      playersById[playerId] = sanitizePlayerConfig(importedPlayer, playersById[playerId]);
    }

    return {
      players: Object.values(playersById),
      simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
      detectedFormat: 'modern-group',
      marketItemValues: extractPayloadMarketItemValues(parsed),
      marketEstimateSource: extractPayloadMarketEstimateSource(parsed),
      syntheticItemHrids: extractPayloadSyntheticItemHrids(parsed),
      syntheticLevelKeys: extractPayloadSyntheticLevelKeys(parsed),
    };
  }

  throw new Error('Unsupported group import format.');
}

export function importSoloConfig(text, existingPlayer, existingSimulationSettings) {
  const parsed = parseJsonText(text);

  if (isShareableProfilePayload(parsed)) {
    return {
      ...importShareableProfile(parsed, existingPlayer, existingSimulationSettings),
      marketItemValues: extractPayloadMarketItemValues(parsed),
      marketEstimateSource: extractPayloadMarketEstimateSource(parsed),
      syntheticItemHrids: extractPayloadSyntheticItemHrids(parsed),
      syntheticLevelKeys: extractPayloadSyntheticLevelKeys(parsed),
    };
  }

  if (isMainSiteCurrentCharacterPayload(parsed)) {
    return {
      ...importMainSiteCurrentCharacter(parsed, existingPlayer, existingSimulationSettings),
      marketItemValues: extractPayloadMarketItemValues(parsed),
      marketEstimateSource: extractPayloadMarketEstimateSource(parsed),
      syntheticItemHrids: extractPayloadSyntheticItemHrids(parsed),
      syntheticLevelKeys: extractPayloadSyntheticLevelKeys(parsed),
    };
  }

  if (parsed && parsed.version === 2 && parsed.player) {
    return {
      player: sanitizePlayerConfig(parsed.player, existingPlayer),
      simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
      detectedFormat: 'modern-solo',
      marketItemValues: extractPayloadMarketItemValues(parsed),
      marketEstimateSource: extractPayloadMarketEstimateSource(parsed),
      syntheticItemHrids: extractPayloadSyntheticItemHrids(parsed),
      syntheticLevelKeys: extractPayloadSyntheticLevelKeys(parsed),
    };
  }

  if (parsed && parsed.player) {
    return {
      // 旧版 solo 载荷早于战斗卷轴选择功能。因此缺失字段
      // 不能视为清除它的指令。
      player: applyLegacySoloToPlayer(parsed, existingPlayer, {
        preserveMissingCombatScrolls: true,
      }),
      simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
      detectedFormat: 'legacy-solo',
      marketItemValues: extractPayloadMarketItemValues(parsed),
      marketEstimateSource: extractPayloadMarketEstimateSource(parsed),
      syntheticItemHrids: extractPayloadSyntheticItemHrids(parsed),
      syntheticLevelKeys: extractPayloadSyntheticLevelKeys(parsed),
    };
  }

  if (parsed && typeof parsed === 'object' && parsed.levels && parsed.equipment) {
    return {
      player: sanitizePlayerConfig(parsed, existingPlayer),
      simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
      detectedFormat: 'modern-player-only',
      marketItemValues: extractPayloadMarketItemValues(parsed),
      marketEstimateSource: extractPayloadMarketEstimateSource(parsed),
      syntheticItemHrids: extractPayloadSyntheticItemHrids(parsed),
      syntheticLevelKeys: extractPayloadSyntheticLevelKeys(parsed),
    };
  }

  throw new Error('Unsupported solo import format.');
}
