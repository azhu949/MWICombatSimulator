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

export function buildQueueVariantSnapshotsFromChanges(baselineSnapshot, targetSnapshot, changeSummary) {
  const safeSummary = changeSummary && typeof changeSummary === 'object' ? changeSummary : { count: 0, changes: [] };
  if (!baselineSnapshot || !targetSnapshot || safeSummary.count <= 0) {
    return [];
  }

  const changes = Array.isArray(safeSummary.changes) ? safeSummary.changes : [];
  if (changes.length <= 1) {
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

  const variants = [];
  const seenSignatures = new Set();

  for (const change of changes) {
    const variantSnapshot = deepClone(baselineSnapshot);
    if (!applySingleQueueChange(variantSnapshot, targetSnapshot, change)) {
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
