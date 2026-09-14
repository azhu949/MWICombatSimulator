import {
  abilityDetailIndex,
  getAbilityName as getIndexedAbilityName,
  getHouseRoomName as getIndexedHouseRoomName,
  getItemName as getIndexedItemName,
  houseRoomDetailIndex,
  itemDetailIndex,
} from '../shared/gameDataIndex.js';
import { createEmptyPlayerConfig, EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from '../shared/playerConfig.js';
import {
  combatGuildBuffDetails,
  getGuildBuffMaxLevel,
  getGuildShrineName,
  guildBuffDetailIndex,
  normalizeGuildBuffLevels,
} from '../shared/guildBuffs.js';
import {
  applyTriggerStateToTriggerMap,
  buildTriggerChangeDescriptor,
  getComparableTriggerTargetHrids,
  getEffectiveTriggerState,
  sanitizeTriggerMap,
} from './triggerMapper.js';
import { clampPositiveInteger, deepClone, isPlainObject, toFiniteNumber } from './utils.js';
import { normalizeCombatScrolls } from '../shared/combatScrolls.js';

export const EQUIPMENT_SET_QUEUE_CHANGES_VERSION = 1;

function createDefaultQueueItemId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEquipmentSetSnapshotFromPlayer(player) {
  const source = player && typeof player === 'object' ? player : createEmptyPlayerConfig(1);

  return {
    levels: deepClone(source.levels ?? {}),
    equipment: deepClone(source.equipment ?? {}),
    food: deepClone(source.food ?? ['', '', '']),
    drinks: deepClone(source.drinks ?? ['', '', '']),
    abilities: deepClone(
      source.abilities ?? [
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
      ],
    ),
    triggerMap: sanitizeTriggerMap(source.triggerMap ?? {}),
    houseRooms: deepClone(source.houseRooms ?? {}),
    guildBuffs: normalizeGuildBuffLevels(source.guildBuffs),
    achievements: deepClone(source.achievements ?? {}),
    // 卷轴配置是玩家构建快照的一部分。它目前刻意不作为队列 *变更* 目标，
    // 但每个基准/变体都必须原样携带它，以免应用装备套装变体时
    // 静默禁用限时卷轴。
    combatScrolls: normalizeCombatScrolls(source.combatScrolls),
  };
}

export function normalizeEquipmentSetSnapshot(rawSet, fallbackPlayerId = '1') {
  const source = isPlainObject(rawSet) ? rawSet : null;
  if (!source) {
    return null;
  }

  const fallback = createEmptyPlayerConfig(String(fallbackPlayerId || '1'));
  const normalized = deepClone(fallback);

  for (const key of LEVEL_KEYS) {
    normalized.levels[key] = Math.max(1, clampPositiveInteger(source.levels?.[key], fallback.levels[key] || 1));
  }

  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const sourceSlot = source.equipment?.[slot] ?? {};
    const rawItemHrid = sourceSlot.itemHrid ?? sourceSlot.equipment ?? '';
    normalized.equipment[slot] = {
      itemHrid: String(rawItemHrid || ''),
      enhancementLevel: clampPositiveInteger(sourceSlot.enhancementLevel, 0),
    };
  }

  normalized.food = [0, 1, 2].map((index) => {
    const value = source.food?.[index] ?? source.food?.[String(index)] ?? '';
    return String(value || '');
  });

  normalized.drinks = [0, 1, 2].map((index) => {
    const value = source.drinks?.[index] ?? source.drinks?.[String(index)] ?? '';
    return String(value || '');
  });

  normalized.abilities = [0, 1, 2, 3, 4].map((index) => {
    const sourceAbility = source.abilities?.[index] ?? source.abilities?.[String(index)] ?? {};
    return {
      abilityHrid: String(sourceAbility.abilityHrid ?? sourceAbility.ability ?? ''),
      level: Math.max(1, clampPositiveInteger(sourceAbility.level, 1)),
    };
  });

  normalized.triggerMap = sanitizeTriggerMap(source.triggerMap ?? {});

  normalized.houseRooms = isPlainObject(source.houseRooms)
    ? deepClone(source.houseRooms)
    : deepClone(fallback.houseRooms);

  normalized.guildBuffs = normalizeGuildBuffLevels(source.guildBuffs, fallback.guildBuffs);

  normalized.achievements = isPlainObject(source.achievements) ? deepClone(source.achievements) : {};

  normalized.combatScrolls = normalizeCombatScrolls(source.combatScrolls);

  return normalized;
}

export function normalizeEquipmentSetQueueChangeTarget(rawTarget) {
  if (!isPlainObject(rawTarget)) {
    return null;
  }

  const kind = String(rawTarget.kind || '');
  if (kind === 'level') {
    const key = String(rawTarget.key || '');
    if (!LEVEL_KEYS.includes(key)) {
      return null;
    }
    return {
      kind: 'level',
      key,
      level: Math.max(1, clampPositiveInteger(rawTarget.level, 1)),
    };
  }

  if (kind === 'equipment') {
    const slot = String(rawTarget.slot || '');
    if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
      return null;
    }
    return {
      kind: 'equipment',
      slot,
      itemHrid: String(rawTarget.itemHrid || ''),
      enhancementLevel: clampPositiveInteger(rawTarget.enhancementLevel, 0),
    };
  }

  if (kind === 'food' || kind === 'drink') {
    const index = Math.floor(toFiniteNumber(rawTarget.index, -1));
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      return null;
    }
    return {
      kind,
      index,
      itemHrid: String(rawTarget.itemHrid || ''),
    };
  }

  if (kind === 'ability') {
    const index = Math.floor(toFiniteNumber(rawTarget.index, -1));
    if (!Number.isInteger(index) || index < 0 || index > 4) {
      return null;
    }
    return {
      kind: 'ability',
      index,
      abilityHrid: String(rawTarget.abilityHrid || ''),
      level: Math.max(1, clampPositiveInteger(rawTarget.level, 1)),
    };
  }

  if (kind === 'house_room') {
    const roomHrid = String(rawTarget.roomHrid || '');
    if (!roomHrid || !Object.prototype.hasOwnProperty.call(houseRoomDetailIndex || {}, roomHrid)) {
      return null;
    }
    return {
      kind: 'house_room',
      roomHrid,
      level: clampPositiveInteger(rawTarget.level, 0),
    };
  }

  if (kind === 'guild_buff') {
    const guildBuffHrid = String(rawTarget.guildBuffHrid || '');
    const maxLevel = getGuildBuffMaxLevel(guildBuffHrid);
    if (!guildBuffHrid || maxLevel <= 0) {
      return null;
    }
    return {
      kind: 'guild_buff',
      guildBuffHrid,
      level: Math.min(clampPositiveInteger(rawTarget.level, 0), maxLevel),
    };
  }

  return null;
}

export function normalizeEquipmentSetQueueChanges(rawQueueChanges) {
  const source = isPlainObject(rawQueueChanges) ? rawQueueChanges : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const normalizedItems = [];

  for (let i = 0; i < rawItems.length; i++) {
    const rawItem = isPlainObject(rawItems[i]) ? rawItems[i] : {};
    const itemName = String(rawItem.name || '').trim();
    const rawTargets = Array.isArray(rawItem.targets) ? rawItem.targets : [];
    const targets = rawTargets
      .map((rawTarget) => normalizeEquipmentSetQueueChangeTarget(rawTarget))
      .filter((target) => Boolean(target));
    if (targets.length <= 0) {
      continue;
    }
    normalizedItems.push({
      name: itemName || `Variant ${normalizedItems.length + 1}`,
      targets,
    });
  }

  return {
    version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
    items: normalizedItems,
  };
}

export function serializeQueueChangeToTarget(change) {
  if (!isPlainObject(change)) {
    return null;
  }

  if (change.kind === 'level') {
    return normalizeEquipmentSetQueueChangeTarget({
      kind: 'level',
      key: String(change.key || ''),
      level: Number(change.afterLevel),
    });
  }
  if (change.kind === 'equipment') {
    return normalizeEquipmentSetQueueChangeTarget({
      kind: 'equipment',
      slot: String(change.slot || ''),
      itemHrid: String(change.afterItemHrid || ''),
      enhancementLevel: Number(change.afterEnhancementLevel || 0),
    });
  }
  if (change.kind === 'food' || change.kind === 'drink') {
    return normalizeEquipmentSetQueueChangeTarget({
      kind: change.kind,
      index: Number(change.index),
      itemHrid: String(change.afterItemHrid || ''),
    });
  }
  if (change.kind === 'ability') {
    return normalizeEquipmentSetQueueChangeTarget({
      kind: 'ability',
      index: Number(change.index),
      abilityHrid: String(change.afterAbilityHrid || ''),
      level: Number(change.afterLevel || 1),
    });
  }
  if (change.kind === 'house_room') {
    return normalizeEquipmentSetQueueChangeTarget({
      kind: 'house_room',
      roomHrid: String(change.roomHrid || ''),
      level: Number(change.afterLevel || 0),
    });
  }
  if (change.kind === 'guild_buff') {
    return normalizeEquipmentSetQueueChangeTarget({
      kind: 'guild_buff',
      guildBuffHrid: String(change.guildBuffHrid || ''),
      level: Number(change.afterLevel || 0),
    });
  }
  return null;
}

export function queueStateHasUnsupportedEquipmentSetQueueChanges(queueState) {
  const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
  const queueItems = Array.isArray(queueState?.items) ? queueState.items : [];
  if (!baselineSnapshot || queueItems.length <= 0) {
    return false;
  }

  return queueItems.some((item) => {
    const diff = computeQueueChangeSummary(baselineSnapshot, item?.snapshot);
    return (Array.isArray(diff?.changes) ? diff.changes : []).some((change) => !serializeQueueChangeToTarget(change));
  });
}

export function buildEquipmentSetQueueChangesFromQueueState(queueState) {
  const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
  const queueItems = Array.isArray(queueState?.items) ? queueState.items : [];
  if (!baselineSnapshot || queueItems.length <= 0) {
    return {
      version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
      items: [],
    };
  }

  const serializedItems = [];
  for (let i = 0; i < queueItems.length; i++) {
    const item = queueItems[i];
    const diff = computeQueueChangeSummary(baselineSnapshot, item?.snapshot);
    const targets = (Array.isArray(diff?.changes) ? diff.changes : [])
      .map((change) => serializeQueueChangeToTarget(change))
      .filter((target) => Boolean(target));
    if (targets.length <= 0) {
      continue;
    }

    const fallbackName = deriveQueueVariantNameFromLabels(diff?.labels, serializedItems.length + 1);
    serializedItems.push({
      name: String(item?.name || '').trim() || fallbackName,
      targets,
    });
  }

  return {
    version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
    items: serializedItems,
  };
}

export function applyQueueChangeTargetToSnapshot(snapshot, target) {
  if (!snapshot || !target) {
    return false;
  }

  if (target.kind === 'level') {
    const levelKey = String(target.key || '');
    if (!LEVEL_KEYS.includes(levelKey)) {
      return false;
    }
    snapshot.levels[levelKey] = Math.max(1, clampPositiveInteger(target.level, 1));
    return true;
  }

  if (target.kind === 'equipment') {
    const slot = String(target.slot || '');
    if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
      return false;
    }
    snapshot.equipment[slot] = {
      itemHrid: String(target.itemHrid || ''),
      enhancementLevel: clampPositiveInteger(target.enhancementLevel, 0),
    };
    return true;
  }

  if (target.kind === 'food' || target.kind === 'drink') {
    const index = Math.floor(toFiniteNumber(target.index, -1));
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      return false;
    }
    snapshot[target.kind][index] = String(target.itemHrid || '');
    return true;
  }

  if (target.kind === 'ability') {
    const index = Math.floor(toFiniteNumber(target.index, -1));
    if (!Number.isInteger(index) || index < 0 || index > 4) {
      return false;
    }
    snapshot.abilities[index] = {
      abilityHrid: String(target.abilityHrid || ''),
      level: Math.max(1, clampPositiveInteger(target.level, 1)),
    };
    return true;
  }

  if (target.kind === 'house_room') {
    const roomHrid = String(target.roomHrid || '');
    if (!roomHrid || !Object.prototype.hasOwnProperty.call(houseRoomDetailIndex || {}, roomHrid)) {
      return false;
    }
    if (!isPlainObject(snapshot.houseRooms)) {
      snapshot.houseRooms = {};
    }
    snapshot.houseRooms[roomHrid] = clampPositiveInteger(target.level, 0);
    return true;
  }

  if (target.kind === 'guild_buff') {
    const guildBuffHrid = String(target.guildBuffHrid || '');
    const maxLevel = getGuildBuffMaxLevel(guildBuffHrid);
    if (!guildBuffHrid || maxLevel <= 0) {
      return false;
    }
    if (!isPlainObject(snapshot.guildBuffs)) {
      snapshot.guildBuffs = {};
    }
    snapshot.guildBuffs[guildBuffHrid] = Math.min(clampPositiveInteger(target.level, 0), maxLevel);
    return true;
  }

  return false;
}

export function buildQueueItemsFromQueueChangeTemplates(baseSnapshot, queueChangeItems = [], options = {}) {
  if (!baseSnapshot || !Array.isArray(queueChangeItems) || queueChangeItems.length <= 0) {
    return [];
  }

  const createId = typeof options.createId === 'function' ? options.createId : createDefaultQueueItemId;
  const getNow = typeof options.getNow === 'function' ? options.getNow : Date.now;
  const builtItems = [];
  for (let index = 0; index < queueChangeItems.length; index++) {
    const queueChangeItem = isPlainObject(queueChangeItems[index]) ? queueChangeItems[index] : {};
    const targets = Array.isArray(queueChangeItem.targets) ? queueChangeItem.targets : [];
    const targetSnapshot = deepClone(baseSnapshot);
    let appliedCount = 0;
    for (const target of targets) {
      if (applyQueueChangeTargetToSnapshot(targetSnapshot, target)) {
        appliedCount += 1;
      }
    }
    if (appliedCount <= 0) {
      continue;
    }

    const summary = computeQueueChangeSummary(baseSnapshot, targetSnapshot);
    if (summary.count <= 0) {
      continue;
    }

    builtItems.push({
      id: String(createId()),
      name:
        String(queueChangeItem.name || '').trim() ||
        deriveQueueVariantNameFromLabels(summary.labels, builtItems.length + 1),
      snapshot: targetSnapshot,
      changes: Array.isArray(summary.labels) ? summary.labels : [],
      changeDetails: Array.isArray(summary.changes) ? deepClone(summary.changes) : [],
      createdAt: getNow(),
    });
  }

  return builtItems;
}

export function formatQueueSkillNameFromKey(skillKey) {
  const normalized = String(skillKey || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return '';
  }
  const map = {
    stamina: 'Stamina',
    intelligence: 'Intelligence',
    attack: 'Attack',
    melee: 'Melee',
    defense: 'Defense',
    ranged: 'Ranged',
    magic: 'Magic',
  };
  if (map[normalized]) {
    return map[normalized];
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatQueueItemNameFromHrid(itemHrid) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 'None';
  }
  return getIndexedItemName(hrid, hrid);
}

export function formatQueueAbilityNameFromHrid(abilityHrid) {
  const hrid = String(abilityHrid || '');
  if (!hrid) {
    return 'None';
  }
  return getIndexedAbilityName(hrid, hrid);
}

export function formatQueueTriggerTargetNameFromHrid(targetHrid) {
  const hrid = String(targetHrid || '');
  if (!hrid) {
    return 'Unknown';
  }
  if (Object.prototype.hasOwnProperty.call(itemDetailIndex || {}, hrid)) {
    return formatQueueItemNameFromHrid(hrid);
  }
  if (Object.prototype.hasOwnProperty.call(abilityDetailIndex || {}, hrid)) {
    return formatQueueAbilityNameFromHrid(hrid);
  }
  return hrid;
}

export function formatQueueTriggerStateLabel(state) {
  const normalized = String(state || 'default')
    .trim()
    .toLowerCase();
  if (normalized === 'custom') {
    return 'Custom';
  }
  if (normalized === 'disabled') {
    return 'No conditions';
  }
  return 'Default';
}

export function formatQueueEquipmentSlotName(slotKey) {
  const normalized = String(slotKey || '')
    .trim()
    .toLowerCase();
  const map = {
    head: 'Head',
    body: 'Body',
    legs: 'Legs',
    feet: 'Feet',
    hands: 'Hands',
    weapon: 'Weapon',
    off_hand: 'Off Hand',
    pouch: 'Pouch',
    neck: 'Neck',
    earrings: 'Earrings',
    ring: 'Ring',
    back: 'Back',
    charm: 'Charm',
    trinket: 'Trinket',
  };
  if (map[normalized]) {
    return map[normalized];
  }
  return normalized || 'Equipment';
}

export function formatQueueHouseRoomNameFromHrid(roomHrid) {
  const hrid = String(roomHrid || '');
  if (!hrid) {
    return 'House Room';
  }
  return getIndexedHouseRoomName(hrid, hrid);
}

export function formatQueueGuildBuffNameFromHrid(guildBuffHrid) {
  const detail = guildBuffDetailIndex?.[String(guildBuffHrid || '')];
  return getGuildShrineName(detail?.shrineHrid, String(guildBuffHrid || 'Guild Shrine'));
}

export function computeQueueChangeSummary(baselinePlayer, candidatePlayer) {
  const baseline = baselinePlayer || {};
  const candidate = candidatePlayer || {};
  const labels = [];
  const changes = [];

  const pushChange = (label, change) => {
    labels.push(label);
    changes.push(change);
  };

  for (const key of LEVEL_KEYS) {
    const before = Number(baseline?.levels?.[key] ?? 1);
    const after = Number(candidate?.levels?.[key] ?? 1);
    if (before !== after) {
      pushChange(`${formatQueueSkillNameFromKey(key)} Level: ${before} -> ${after}`, {
        kind: 'level',
        key,
        beforeLevel: before,
        afterLevel: after,
      });
    }
  }

  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const beforeSlot = baseline?.equipment?.[slot] ?? { itemHrid: '', enhancementLevel: 0 };
    const afterSlot = candidate?.equipment?.[slot] ?? { itemHrid: '', enhancementLevel: 0 };
    const beforeItem = String(beforeSlot.itemHrid || '');
    const afterItem = String(afterSlot.itemHrid || '');
    const beforeEnh = Number(beforeSlot.enhancementLevel || 0);
    const afterEnh = Number(afterSlot.enhancementLevel || 0);

    if (beforeItem !== afterItem || beforeEnh !== afterEnh) {
      pushChange(
        `${formatQueueEquipmentSlotName(slot)}: ${formatQueueItemNameFromHrid(beforeItem)}(+${beforeEnh}) -> ${formatQueueItemNameFromHrid(afterItem)}(+${afterEnh})`,
        {
          kind: 'equipment',
          slot,
          beforeItemHrid: beforeItem,
          afterItemHrid: afterItem,
          beforeEnhancementLevel: beforeEnh,
          afterEnhancementLevel: afterEnh,
        },
      );
    }
  }

  for (let i = 0; i < 3; i++) {
    const beforeFood = String(baseline?.food?.[i] || '');
    const afterFood = String(candidate?.food?.[i] || '');
    if (beforeFood !== afterFood) {
      pushChange(
        `Food ${i + 1}: ${formatQueueItemNameFromHrid(beforeFood)} -> ${formatQueueItemNameFromHrid(afterFood)}`,
        {
          kind: 'food',
          index: i,
          beforeItemHrid: beforeFood,
          afterItemHrid: afterFood,
        },
      );
    }

    const beforeDrink = String(baseline?.drinks?.[i] || '');
    const afterDrink = String(candidate?.drinks?.[i] || '');
    if (beforeDrink !== afterDrink) {
      pushChange(
        `Drink ${i + 1}: ${formatQueueItemNameFromHrid(beforeDrink)} -> ${formatQueueItemNameFromHrid(afterDrink)}`,
        {
          kind: 'drink',
          index: i,
          beforeItemHrid: beforeDrink,
          afterItemHrid: afterDrink,
        },
      );
    }
  }

  // 技能变更按槽位描述（逐槽对比 before/after 快照）：这里是「快照差异描述」，供条目命名、变体生成与变更
  // 列表展示使用，**刻意不改成技能锚定**——重排确实换了槽位内容与施法优先级（等级随技能走），描述必须
  // 如实反映；需要技能锚定的地方只有升级成本与「参考数据加载门」（见 queueUpgradeCost.resolveAbilityUpgradeFromLevel
  // 与 collectAbilityUpgradeRanges，两者都直接看快照、与本描述无关）。
  // 两条互相搬槽的变更仍各自成条（摘要不做合并），「必须一起应用」的原子性由变体生成阶段负责
  // （buildAtomicQueueChangeGroups：镜像搬槽合成一个变体，避免半交换快照）。
  for (let i = 0; i < 5; i++) {
    const beforeAbility = baseline?.abilities?.[i] ?? { abilityHrid: '', level: 1 };
    const afterAbility = candidate?.abilities?.[i] ?? { abilityHrid: '', level: 1 };
    const beforeHrid = String(beforeAbility.abilityHrid || '');
    const afterHrid = String(afterAbility.abilityHrid || '');
    const beforeLevel = Number(beforeAbility.level || 1);
    const afterLevel = Number(afterAbility.level || 1);

    if (beforeHrid !== afterHrid || beforeLevel !== afterLevel) {
      pushChange(
        `Ability ${i + 1}: ${formatQueueAbilityNameFromHrid(beforeHrid)}(Lv${beforeLevel}) -> ${formatQueueAbilityNameFromHrid(afterHrid)}(Lv${afterLevel})`,
        {
          kind: 'ability',
          index: i,
          beforeAbilityHrid: beforeHrid,
          afterAbilityHrid: afterHrid,
          beforeLevel,
          afterLevel,
        },
      );
    }
  }

  for (const targetHrid of getComparableTriggerTargetHrids(baseline, candidate)) {
    const normalizedTargetHrid = String(targetHrid || '');
    if (!normalizedTargetHrid) {
      continue;
    }

    const triggerChange = buildTriggerChangeDescriptor(
      baseline?.triggerMap,
      candidate?.triggerMap,
      normalizedTargetHrid,
    );
    if (!triggerChange) {
      continue;
    }

    pushChange(
      `Trigger ${formatQueueTriggerTargetNameFromHrid(normalizedTargetHrid)}: ${formatQueueTriggerStateLabel(triggerChange.beforeState)} -> ${formatQueueTriggerStateLabel(triggerChange.afterState)}`,
      {
        kind: 'trigger',
        targetHrid: normalizedTargetHrid,
        beforeState: triggerChange.beforeState,
        afterState: triggerChange.afterState,
        beforeTriggers: deepClone(triggerChange.beforeTriggers),
        afterTriggers: deepClone(triggerChange.afterTriggers),
      },
    );
  }

  for (const room of Object.values(houseRoomDetailIndex || {})) {
    const roomHrid = String(room?.hrid || '');
    if (!roomHrid) {
      continue;
    }

    const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(baseline?.houseRooms?.[roomHrid], 0)));
    const afterLevel = Math.max(0, Math.floor(toFiniteNumber(candidate?.houseRooms?.[roomHrid], 0)));
    if (beforeLevel !== afterLevel) {
      pushChange(`${formatQueueHouseRoomNameFromHrid(roomHrid)}: Lv${beforeLevel} -> Lv${afterLevel}`, {
        kind: 'house_room',
        roomHrid,
        beforeLevel,
        afterLevel,
      });
    }
  }

  for (const detail of combatGuildBuffDetails) {
    const guildBuffHrid = String(detail?.hrid || '');
    const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(baseline?.guildBuffs?.[guildBuffHrid], 0)));
    const afterLevel = Math.max(0, Math.floor(toFiniteNumber(candidate?.guildBuffs?.[guildBuffHrid], 0)));
    if (beforeLevel !== afterLevel) {
      pushChange(`${formatQueueGuildBuffNameFromHrid(guildBuffHrid)}: Lv${beforeLevel} -> Lv${afterLevel}`, {
        kind: 'guild_buff',
        guildBuffHrid,
        beforeLevel,
        afterLevel,
      });
    }
  }

  return {
    count: labels.length,
    labels,
    changes,
  };
}

export function deriveQueueVariantNameFromLabels(labels, fallbackIndex = 1) {
  const safeLabels = (Array.isArray(labels) ? labels : []).map((value) => String(value || '').trim()).filter(Boolean);

  if (safeLabels.length === 1) {
    return safeLabels[0];
  }
  if (safeLabels.length > 1) {
    return `${safeLabels[0]} (+${safeLabels.length - 1})`;
  }
  return `Variant ${Math.max(1, Math.floor(toFiniteNumber(fallbackIndex, 1)))}`;
}

export function syncTriggerStateFromSnapshot(snapshot, targetSnapshot, targetHrid) {
  const hrid = String(targetHrid || '');
  if (!hrid) {
    return;
  }

  if (!isPlainObject(snapshot.triggerMap)) {
    snapshot.triggerMap = {};
  }

  const effectiveState = getEffectiveTriggerState(targetSnapshot?.triggerMap, hrid);
  applyTriggerStateToTriggerMap(snapshot.triggerMap, hrid, effectiveState.state, effectiveState.triggers);
}

export function applySingleQueueChange(snapshot, targetSnapshot, change) {
  if (!snapshot || !targetSnapshot || !change) {
    return false;
  }

  if (change.kind === 'level') {
    const levelKey = String(change.key || '');
    if (!LEVEL_KEYS.includes(levelKey)) {
      return false;
    }
    snapshot.levels[levelKey] = Number(targetSnapshot?.levels?.[levelKey] ?? snapshot.levels[levelKey] ?? 1);
    return true;
  }

  if (change.kind === 'equipment') {
    const slot = String(change.slot || '');
    if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
      return false;
    }
    snapshot.equipment[slot] = deepClone(
      targetSnapshot?.equipment?.[slot] ??
        snapshot.equipment?.[slot] ?? {
          itemHrid: '',
          enhancementLevel: 0,
        },
    );
    return true;
  }

  if (change.kind === 'food') {
    const index = Number(change.index);
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      return false;
    }
    const targetHrid = String(targetSnapshot?.food?.[index] || '');
    snapshot.food[index] = targetHrid;
    syncTriggerStateFromSnapshot(snapshot, targetSnapshot, targetHrid);
    return true;
  }

  if (change.kind === 'drink') {
    const index = Number(change.index);
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      return false;
    }
    const targetHrid = String(targetSnapshot?.drinks?.[index] || '');
    snapshot.drinks[index] = targetHrid;
    syncTriggerStateFromSnapshot(snapshot, targetSnapshot, targetHrid);
    return true;
  }

  if (change.kind === 'ability') {
    const index = Number(change.index);
    if (!Number.isInteger(index) || index < 0 || index > 4) {
      return false;
    }
    const targetAbility = deepClone(
      targetSnapshot?.abilities?.[index] ??
        snapshot.abilities?.[index] ?? {
          abilityHrid: '',
          level: 1,
        },
    );
    snapshot.abilities[index] = targetAbility;
    syncTriggerStateFromSnapshot(snapshot, targetSnapshot, targetAbility?.abilityHrid);
    return true;
  }

  if (change.kind === 'trigger') {
    const targetHrid = String(change.targetHrid || '');
    if (!targetHrid) {
      return false;
    }
    if (!isPlainObject(snapshot.triggerMap)) {
      snapshot.triggerMap = {};
    }
    applyTriggerStateToTriggerMap(
      snapshot.triggerMap,
      targetHrid,
      String(change.afterState || 'default'),
      Array.isArray(change.afterTriggers) ? change.afterTriggers : [],
    );
    return true;
  }

  if (change.kind === 'house_room') {
    const roomHrid = String(change.roomHrid || '');
    if (!roomHrid || !Object.prototype.hasOwnProperty.call(houseRoomDetailIndex || {}, roomHrid)) {
      return false;
    }
    if (!isPlainObject(snapshot.houseRooms)) {
      snapshot.houseRooms = {};
    }
    snapshot.houseRooms[roomHrid] = clampPositiveInteger(targetSnapshot?.houseRooms?.[roomHrid], 0);
    return true;
  }

  if (change.kind === 'guild_buff') {
    const guildBuffHrid = String(change.guildBuffHrid || '');
    const maxLevel = getGuildBuffMaxLevel(guildBuffHrid);
    if (!guildBuffHrid || maxLevel <= 0) {
      return false;
    }
    if (!isPlainObject(snapshot.guildBuffs)) {
      snapshot.guildBuffs = {};
    }
    snapshot.guildBuffs[guildBuffHrid] = Math.min(
      clampPositiveInteger(targetSnapshot?.guildBuffs?.[guildBuffHrid], 0),
      maxLevel,
    );
    return true;
  }

  return false;
}

// 「可搬槽」的槽位变更类型：技能/食物/饮品的同一身份（hrid）通常只占一格，且两格之间的对调/轮转在语义上
// 是「整对搬动」而不是两条独立变更——镜像变更必须成组应用（见下），否则会产出同名身份占两格的快照
// （技能在游戏里一个只能占一格；食物优化器同样以「不重复」为搜索不变量）。
// 装备不在此列：配置里每个槽位类型只有一格（见 EQUIPMENT_SLOT_KEYS），不存在同类型槽位之间的搬槽。
const QUEUE_ATOMIC_SLOT_CHANGE_KINDS = {
  ability: {
    indexKey: 'index',
    afterKey: 'afterAbilityHrid',
    baselineKey: 'abilities',
    baselineIdentityKey: 'abilityHrid',
  },
  food: { indexKey: 'index', afterKey: 'afterItemHrid', baselineKey: 'food', baselineIdentityKey: '' },
  drink: { indexKey: 'index', afterKey: 'afterItemHrid', baselineKey: 'drinks', baselineIdentityKey: '' },
};

function resolveQueueSlotIdentity(entry, identityKey) {
  if (identityKey) {
    return String(entry?.[identityKey] || '');
  }
  return String(entry || '');
}

// 原子变更分组：把「互相搬槽」的变更合成一组，同组必须一起应用。
//
// 背景：多变更差异会被拆成「一条变更 = 一个变体」的单变更快照，用来分别评估每条变更的收益——这对互不
// 相关的变更是正确的（换装备 / 升技能 / 升房间），但对「同一类槽位里两格对调」这种互为镜像的成对变更
// 不成立：单独应用其中一条的语义是「把目标侧那一格整格覆盖到基准上」（见 applySingleQueueChange），
// 于是同一个技能/食物会同时占两格（[B@3, B@3] 与 [A@5, A@5]）——既不是用户想评估的配置（同名技能在游戏里
// 不可能占两格），用户真实的完整重排反而从未被整体模拟。首页箭头互换把这种形状提升成一等操作，触发频率更高。
//
// 规则：把「本槽位新拿到的身份在基准里所在的那个槽位」与本槽位连一条边（身份 = 技能/食物/饮品 hrid），
// 再取连通分量。两格互换是 2 环、三格轮转是 3 环：组内变更之间不冲突——互为镜像的搬槽一起应用，不会被
// 拆成半交换；组外槽位保持基准值。
//
// 这不是「快照恒无重复身份」的全局保证：目标侧自身就重复（手改下拉/导入模板可造出的退化配置）时，分组只能
// 如实复制、修不掉。最直接的一种是「基准里该身份的搬出方本轮没变」（见下方「该槽位本轮没变」分支）：这条边
// 没有可合并的变更，该变更本身仍可能经由别的边并入其它组，但目标侧自带的重复照旧保留。本函数只保证两点：
// ① 组内变更之间不冲突；② 变体里的重复身份一定来自目标侧（拆分/分组不制造目标侧没有的重复）。
//
// 基准里没有的新身份（新增技能/食物）没有边，独立成组；被清空的槽位没有「新拿到的身份」，同样不产生边
// ——两条互不相干的删除各自成组，变体粒度不丢。
function buildAtomicQueueChangeGroups(baselineSnapshot, changes) {
  const list = Array.isArray(changes) ? changes : [];
  const parent = list.map((_, index) => index);

  const findRoot = (index) => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  // 本轮差异里「类型 + 槽位」→ 变更下标（同一槽位同一类型至多一条变更）。
  const changeIndexByKindSlot = new Map();
  const slotEntriesByChangeIndex = new Map();
  for (let index = 0; index < list.length; index++) {
    const change = list[index];
    const kind = String(change?.kind || '');
    const descriptor = QUEUE_ATOMIC_SLOT_CHANGE_KINDS[kind];
    if (!descriptor) {
      continue;
    }
    const slot = Math.floor(toFiniteNumber(change?.[descriptor.indexKey], -1));
    if (slot < 0) {
      continue;
    }
    changeIndexByKindSlot.set(`${kind}|${slot}`, index);
    slotEntriesByChangeIndex.set(index, { kind, descriptor, slot });
  }

  // 基准里每个身份占用的槽位（可能不止一格：手改下拉/导入的重复配置可达）。
  const baselineSlotsByKindIdentity = new Map();
  for (const [kind, descriptor] of Object.entries(QUEUE_ATOMIC_SLOT_CHANGE_KINDS)) {
    const slots = Array.isArray(baselineSnapshot?.[descriptor.baselineKey])
      ? baselineSnapshot[descriptor.baselineKey]
      : [];
    for (let slot = 0; slot < slots.length; slot++) {
      const identity = resolveQueueSlotIdentity(slots[slot], descriptor.baselineIdentityKey);
      if (!identity) {
        continue;
      }
      const key = `${kind}|${identity}`;
      const owners = baselineSlotsByKindIdentity.get(key);
      if (owners) {
        owners.push(slot);
      } else {
        baselineSlotsByKindIdentity.set(key, [slot]);
      }
    }
  }

  for (const [index, entry] of slotEntriesByChangeIndex) {
    const gainedIdentity = String(list[index]?.[entry.descriptor.afterKey] || '');
    if (!gainedIdentity) {
      continue;
    }
    const owners = baselineSlotsByKindIdentity.get(`${entry.kind}|${gainedIdentity}`) || [];
    for (const ownerSlot of owners) {
      if (ownerSlot === entry.slot) {
        continue;
      }
      const ownerChangeIndex = changeIndexByKindSlot.get(`${entry.kind}|${ownerSlot}`);
      if (ownerChangeIndex === undefined) {
        // 该槽位本轮没变（目标侧自身就重复）：这条边没有可合并的变更，分组救不了这种退化配置——本条变更仍
        // 可能经由别的边并入其它组，但目标侧自带的重复照旧如实复制（分组不制造新的重复，也修不掉它；见上方注释）。
        continue;
      }
      union(index, ownerChangeIndex);
    }
  }

  // 按变更原始顺序输出各组（组内也保持原始顺序），未参与搬槽的变更各自成组。
  const groups = [];
  const groupIndexByRoot = new Map();
  for (let index = 0; index < list.length; index++) {
    const root = findRoot(index);
    let groupIndex = groupIndexByRoot.get(root);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexByRoot.set(root, groupIndex);
      groups.push([]);
    }
    groups[groupIndex].push(list[index]);
  }

  return groups;
}

export function buildQueueVariantSnapshotsFromChanges(baselineSnapshot, targetSnapshot, changeSummary) {
  const safeSummary = changeSummary && typeof changeSummary === 'object' ? changeSummary : { count: 0, changes: [] };
  if (!baselineSnapshot || !targetSnapshot || safeSummary.count <= 0) {
    return [];
  }

  const changes = Array.isArray(safeSummary.changes) ? safeSummary.changes : [];
  if (changes.length <= 1) {
    // 直返目标快照：目标侧自身重复（手改下拉/导入模板）时变体就如实带重复——分组只在多变更时才有机会
    // 合并搬槽，且保证范围同样只到「不制造目标侧没有的重复」（见 buildAtomicQueueChangeGroups 注释）。
    const labels = Array.isArray(safeSummary.labels) ? safeSummary.labels : [];
    const changeDetails = Array.isArray(safeSummary.changes) ? deepClone(safeSummary.changes) : [];
    return [
      {
        snapshot: deepClone(targetSnapshot),
        labels,
        name: deriveQueueVariantNameFromLabels(labels, 1),
        changeDetails,
      },
    ];
  }

  const groups = buildAtomicQueueChangeGroups(baselineSnapshot, changes);
  const variants = [];
  const seenSignatures = new Set();

  for (const group of groups) {
    const variantSnapshot = deepClone(baselineSnapshot);
    let appliedCount = 0;
    for (const change of group) {
      if (applySingleQueueChange(variantSnapshot, targetSnapshot, change)) {
        appliedCount += 1;
      }
    }
    if (appliedCount <= 0) {
      continue;
    }

    const variantDiff = computeQueueChangeSummary(baselineSnapshot, variantSnapshot);
    if (variantDiff.count <= 0) {
      continue;
    }

    const signature = JSON.stringify(variantDiff.labels);
    if (seenSignatures.has(signature)) {
      continue;
    }
    seenSignatures.add(signature);
    const labels = Array.isArray(variantDiff.labels) ? variantDiff.labels : [];
    const changeDetails = Array.isArray(variantDiff.changes) ? deepClone(variantDiff.changes) : [];
    variants.push({
      snapshot: variantSnapshot,
      labels,
      name: deriveQueueVariantNameFromLabels(labels, variants.length + 1),
      changeDetails,
    });
  }

  if (variants.length === 0) {
    const labels = Array.isArray(safeSummary.labels) ? safeSummary.labels : [];
    const changeDetails = Array.isArray(safeSummary.changes) ? deepClone(safeSummary.changes) : [];
    return [
      {
        snapshot: deepClone(targetSnapshot),
        labels,
        name: deriveQueueVariantNameFromLabels(labels, 1),
        changeDetails,
      },
    ];
  }

  return variants;
}
