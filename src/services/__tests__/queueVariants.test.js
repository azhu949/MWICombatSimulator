import { describe, expect, it } from 'vitest';
import { abilityDetailIndex, houseRoomDetailIndex, itemDetailIndex } from '../../shared/gameDataIndex.js';
import { combatGuildBuffDetails } from '../../shared/guildBuffs.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { combatScrollOptions } from '../../shared/combatScrolls.js';
import {
  EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
  buildEquipmentSetQueueChangesFromQueueState,
  buildQueueItemsFromQueueChangeTemplates,
  buildQueueVariantSnapshotsFromChanges,
  computeQueueChangeSummary,
  createEquipmentSetSnapshotFromPlayer,
  normalizeEquipmentSetQueueChanges,
  queueStateHasUnsupportedEquipmentSetQueueChanges,
} from '../queueVariants.js';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findEquipmentForSlot(slotKey = 'head') {
  const typeHrid = `/equipment_types/${slotKey}`;
  const item = Object.values(itemDetailIndex || {}).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/equipment' && String(entry?.equipmentDetail?.type || '') === typeHrid,
  );
  return item?.hrid ?? '';
}

function findFirstAbility() {
  const ability = Object.values(abilityDetailIndex || {}).find(
    (entry) => String(entry?.hrid || '') && entry?.isSpecialAbility !== true,
  );
  return ability?.hrid ?? '';
}

function findFirstAbilityWithDefaultTriggers() {
  const ability = Object.values(abilityDetailIndex || {}).find(
    (entry) =>
      String(entry?.hrid || '') &&
      entry?.isSpecialAbility !== true &&
      Array.isArray(entry?.defaultCombatTriggers) &&
      entry.defaultCombatTriggers.length > 0,
  );
  return ability?.hrid ?? '';
}

function findFirstFood() {
  const item = Object.values(itemDetailIndex || {}).find(
    (entry) => entry?.categoryHrid === '/item_categories/food' && String(entry?.hrid || ''),
  );
  return item?.hrid ?? '';
}

function findHouseRoomWithLevel(level = 1) {
  return Object.values(houseRoomDetailIndex || {}).find(
    (entry) => String(entry?.hrid || '') && Array.isArray(entry?.upgradeCostsMap?.[String(level)]),
  );
}

function createBaseSnapshot() {
  const player = createEmptyPlayerConfig('1');
  const scrollHrid = combatScrollOptions[0]?.itemHrid;
  if (scrollHrid) {
    player.combatScrolls[scrollHrid] = { quantity: 2 };
  }
  return createEquipmentSetSnapshotFromPlayer(player);
}

describe('queueVariants', () => {
  it('splits multi-change queue candidates into one-change variants', () => {
    const equipmentHrid = findEquipmentForSlot('head');
    const room = findHouseRoomWithLevel(1);
    expect(equipmentHrid).toBeTruthy();
    expect(room).toBeTruthy();

    const baseline = createBaseSnapshot();
    const target = deepClone(baseline);
    target.levels.attack = 7;
    target.equipment.head = {
      itemHrid: equipmentHrid,
      enhancementLevel: 2,
    };
    target.houseRooms[room.hrid] = 1;

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.changes.map((change) => change.kind)).toEqual(['level', 'equipment', 'house_room']);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    expect(variants).toHaveLength(3);
    variants.forEach((variant) => {
      const variantSummary = computeQueueChangeSummary(baseline, variant.snapshot);
      expect(variantSummary.count).toBe(1);
      expect(variant.name).toBe(variant.labels[0]);
      expect(variant.changeDetails).toHaveLength(1);
      expect(variant.snapshot.combatScrolls).toEqual(baseline.combatScrolls);
    });

    const equipmentVariant = variants.find((variant) => variant.changeDetails[0]?.kind === 'equipment');
    expect(equipmentVariant?.snapshot?.equipment?.head).toEqual({
      itemHrid: equipmentHrid,
      enhancementLevel: 2,
    });
    expect(equipmentVariant?.snapshot?.levels?.attack).toBe(1);
    expect(equipmentVariant?.snapshot?.houseRooms?.[room.hrid]).toBe(0);
  });

  it('serializes queue change templates without before fields and rejects trigger-only templates', () => {
    const equipmentHrid = findEquipmentForSlot('head');
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    expect(equipmentHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();

    const baseline = createBaseSnapshot();
    const target = deepClone(baseline);
    target.levels.attack = 4;
    target.equipment.head = {
      itemHrid: equipmentHrid,
      enhancementLevel: 1,
    };

    const queueChanges = buildEquipmentSetQueueChangesFromQueueState({
      baseline: { snapshot: baseline },
      items: [{ name: 'Supported', snapshot: target }],
    });

    expect(queueChanges.version).toBe(EQUIPMENT_SET_QUEUE_CHANGES_VERSION);
    expect(queueChanges.items).toHaveLength(1);
    expect(queueChanges.items[0].targets).toEqual([
      expect.objectContaining({
        kind: 'level',
        key: 'attack',
        level: 4,
      }),
      expect.objectContaining({
        kind: 'equipment',
        slot: 'head',
        itemHrid: equipmentHrid,
        enhancementLevel: 1,
      }),
    ]);
    queueChanges.items[0].targets.forEach((targetEntry) => {
      expect(Object.keys(targetEntry).some((key) => key.startsWith('before'))).toBe(false);
    });

    expect(
      normalizeEquipmentSetQueueChanges({
        items: [
          {
            name: '',
            targets: [
              { kind: 'level', key: 'attack', level: '8' },
              { kind: 'equipment', slot: 'unknown', itemHrid: equipmentHrid },
            ],
          },
        ],
      }),
    ).toEqual({
      version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
      items: [
        {
          name: 'Variant 1',
          targets: [
            {
              kind: 'level',
              key: 'attack',
              level: 8,
            },
          ],
        },
      ],
    });

    const triggerBaseline = createBaseSnapshot();
    triggerBaseline.abilities[0] = {
      abilityHrid,
      level: 1,
    };
    const triggerTarget = deepClone(triggerBaseline);
    triggerTarget.triggerMap = {
      [abilityHrid]: [],
    };

    expect(
      queueStateHasUnsupportedEquipmentSetQueueChanges({
        baseline: { snapshot: triggerBaseline },
        items: [{ id: 'trigger', snapshot: triggerTarget }],
      }),
    ).toBe(true);
  });

  it('rebuilds queue items from change templates with deterministic ids and timestamps', () => {
    const equipmentHrid = findEquipmentForSlot('head');
    const abilityHrid = findFirstAbility();
    const foodHrid = findFirstFood();
    const room = findHouseRoomWithLevel(1);
    const guildBuffHrid = combatGuildBuffDetails[0]?.hrid;
    expect(equipmentHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();
    expect(foodHrid).toBeTruthy();
    expect(room).toBeTruthy();
    expect(guildBuffHrid).toBeTruthy();

    const baseline = createBaseSnapshot();
    const builtItems = buildQueueItemsFromQueueChangeTemplates(
      baseline,
      [
        {
          name: '',
          targets: [
            { kind: 'level', key: 'attack', level: 9 },
            { kind: 'equipment', slot: 'head', itemHrid: equipmentHrid, enhancementLevel: 3 },
            { kind: 'food', index: 0, itemHrid: foodHrid },
            { kind: 'ability', index: 0, abilityHrid, level: 4 },
            { kind: 'house_room', roomHrid: room.hrid, level: 1 },
            { kind: 'guild_buff', guildBuffHrid, level: 1 },
          ],
        },
      ],
      {
        createId: () => 'queue-item-1',
        getNow: () => 123456,
      },
    );

    expect(builtItems).toHaveLength(1);
    expect(builtItems[0]).toMatchObject({
      id: 'queue-item-1',
      createdAt: 123456,
    });
    expect(builtItems[0].name).toContain('(+');
    expect(builtItems[0].snapshot.levels.attack).toBe(9);
    expect(builtItems[0].snapshot.equipment.head).toEqual({
      itemHrid: equipmentHrid,
      enhancementLevel: 3,
    });
    expect(builtItems[0].snapshot.food[0]).toBe(foodHrid);
    expect(builtItems[0].snapshot.abilities[0]).toEqual({
      abilityHrid,
      level: 4,
    });
    expect(builtItems[0].snapshot.houseRooms[room.hrid]).toBe(1);
    expect(builtItems[0].snapshot.guildBuffs[guildBuffHrid]).toBe(1);
    expect(builtItems[0].changeDetails.map((change) => change.kind)).toEqual(
      expect.arrayContaining(['level', 'equipment', 'food', 'ability', 'house_room', 'guild_buff']),
    );

    expect(baseline.levels.attack).toBe(1);
    expect(baseline.equipment.head.itemHrid).toBe('');
    expect(baseline.houseRooms[room.hrid]).toBe(0);
  });
});
