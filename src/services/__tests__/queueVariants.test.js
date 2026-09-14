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

function findAbilities(count = 2) {
  return Object.values(abilityDetailIndex || {})
    .filter((entry) => String(entry?.hrid || '') && entry?.isSpecialAbility !== true)
    .slice(0, count)
    .map((entry) => String(entry.hrid));
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

function findFoods(count = 2) {
  return Object.values(itemDetailIndex || {})
    .filter((entry) => entry?.categoryHrid === '/item_categories/food' && String(entry?.hrid || ''))
    .slice(0, count)
    .map((entry) => String(entry.hrid));
}

function findDrinks(count = 2) {
  return Object.values(itemDetailIndex || {})
    .filter((entry) => entry?.categoryHrid === '/item_categories/drink' && String(entry?.hrid || ''))
    .slice(0, count)
    .map((entry) => String(entry.hrid));
}

function snapshotIdentities(snapshot, kind = 'abilities') {
  const list = Array.isArray(snapshot?.[kind]) ? snapshot[kind] : [];
  return list
    .map((entry) => (kind === 'abilities' ? String(entry?.abilityHrid || '') : String(entry || '')))
    .filter(Boolean);
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

  it('keeps a mirrored two-slot ability swap as one atomic variant instead of two half-swap duplicates', () => {
    const [abilityA, abilityB] = findAbilities(2);
    expect(abilityA).toBeTruthy();
    expect(abilityB).toBeTruthy();

    const baseline = createBaseSnapshot();
    // 首页箭头互换的真实形状：相邻两格（槽位 2/3）对调，等级随技能走。
    baseline.abilities[1] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[2] = { abilityHrid: abilityB, level: 3 };

    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: abilityB, level: 3 };
    target.abilities[2] = { abilityHrid: abilityA, level: 5 };

    // 变更摘要仍按槽位如实描述两条变更（供命名/展示使用）：分组只发生在变体生成阶段。
    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.changes.map((change) => change.kind)).toEqual(['ability', 'ability']);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);

    // 一个原子变体 = 用户真正想评估的「整对互换」；旧口径会给出两个半交换变体
    // （[B@3, B@3] 与 [A@5, A@5]——同一个技能占两格，游戏里不可能出现，指标增量也就无从解释）。
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.abilities).toEqual(target.abilities);
    expect(variants[0].labels).toHaveLength(2);
    expect(variants[0].changeDetails).toHaveLength(2);

    const variantHrids = snapshotIdentities(variants[0].snapshot);
    expect(new Set(variantHrids).size).toBe(variantHrids.length);
  });

  it('keeps the swap atomic while independent changes still split into their own variants', () => {
    const [abilityA, abilityB, abilityC] = findAbilities(3);
    const room = findHouseRoomWithLevel(1);
    expect(abilityC).toBeTruthy();
    expect(room).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.abilities[1] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[2] = { abilityHrid: abilityB, level: 3 };

    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: abilityB, level: 3 };
    target.abilities[2] = { abilityHrid: abilityA, level: 5 };
    // 槽位 4 是独立变更（新技能，不在基准里）；房屋房间同理。
    target.abilities[3] = { abilityHrid: abilityC, level: 1 };
    target.houseRooms[room.hrid] = 1;

    const summary = computeQueueChangeSummary(baseline, target);
    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);

    expect(variants).toHaveLength(3);

    const swapVariant = variants.find((variant) => variant.changeDetails.length === 2);
    expect(swapVariant?.snapshot.abilities.slice(1, 3)).toEqual([target.abilities[1], target.abilities[2]]);
    expect(swapVariant?.snapshot.abilities[3]).toEqual(baseline.abilities[3]);
    expect(swapVariant?.snapshot.houseRooms?.[room.hrid]).toBe(0);
    expect(new Set(snapshotIdentities(swapVariant?.snapshot)).size).toBe(
      snapshotIdentities(swapVariant?.snapshot).length,
    );

    const addedAbilityVariant = variants.find(
      (variant) => variant.changeDetails.length === 1 && variant.changeDetails[0]?.kind === 'ability',
    );
    expect(addedAbilityVariant?.snapshot.abilities[3]).toEqual(target.abilities[3]);
    expect(addedAbilityVariant?.snapshot.abilities[1]).toEqual(baseline.abilities[1]);

    const roomVariant = variants.find((variant) => variant.changeDetails[0]?.kind === 'house_room');
    expect(roomVariant?.snapshot.houseRooms?.[room.hrid]).toBe(1);
    expect(roomVariant?.snapshot.abilities[1]).toEqual(baseline.abilities[1]);
  });

  it('keeps a moved ability level change inside its swap group (a split would put one ability in two slots)', () => {
    const [abilityA, abilityB] = findAbilities(2);

    const baseline = createBaseSnapshot();
    baseline.abilities[1] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[2] = { abilityHrid: abilityB, level: 3 };

    const target = deepClone(baseline);
    // 互换 + 顺手把搬过去的 A 填成 7 级：任一条变更单独应用都会让某个技能同时占两格，
    // 所以这个等级变更也必须并进同一个原子组。
    target.abilities[1] = { abilityHrid: abilityB, level: 3 };
    target.abilities[2] = { abilityHrid: abilityA, level: 7 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.abilities).toEqual(target.abilities);
    expect(new Set(snapshotIdentities(variants[0].snapshot)).size).toBe(
      snapshotIdentities(variants[0].snapshot).length,
    );
  });

  it('keeps a three-slot ability rotation atomic (connectivity, not just mirrored pairs)', () => {
    const [abilityA, abilityB, abilityC] = findAbilities(3);

    const baseline = createBaseSnapshot();
    baseline.abilities[1] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[2] = { abilityHrid: abilityB, level: 4 };
    baseline.abilities[3] = { abilityHrid: abilityC, level: 3 };

    // 首页连点两次箭头（1↔2 再 2↔3）得到的真实形状：A 被转到槽位 4。
    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: abilityB, level: 4 };
    target.abilities[2] = { abilityHrid: abilityC, level: 3 };
    target.abilities[3] = { abilityHrid: abilityA, level: 5 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(3);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.abilities).toEqual(target.abilities);
    expect(new Set(snapshotIdentities(variants[0].snapshot)).size).toBe(
      snapshotIdentities(variants[0].snapshot).length,
    );
  });

  it('keeps a mirrored two-slot food swap atomic as well', () => {
    const [foodA, foodB] = findFoods(2);
    expect(foodA).toBeTruthy();
    expect(foodB).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.food[0] = foodA;
    baseline.food[1] = foodB;

    const target = deepClone(baseline);
    target.food[0] = foodB;
    target.food[1] = foodA;

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.food).toEqual(target.food);
    expect(new Set(snapshotIdentities(variants[0].snapshot, 'food')).size).toBe(
      snapshotIdentities(variants[0].snapshot, 'food').length,
    );
  });

  it('keeps a mirrored two-slot drink swap atomic as well', () => {
    const [drinkA, drinkB] = findDrinks(2);
    expect(drinkA).toBeTruthy();
    expect(drinkB).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.drinks[0] = drinkA;
    baseline.drinks[1] = drinkB;

    const target = deepClone(baseline);
    target.drinks[0] = drinkB;
    target.drinks[1] = drinkA;

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.drinks).toEqual(target.drinks);
    expect(new Set(snapshotIdentities(variants[0].snapshot, 'drinks')).size).toBe(
      snapshotIdentities(variants[0].snapshot, 'drinks').length,
    );
  });

  it('keeps two unrelated ability removals split (a cleared slot gains no identity, so nothing merges)', () => {
    const [abilityA, abilityB] = findAbilities(2);

    const baseline = createBaseSnapshot();
    baseline.abilities[1] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[2] = { abilityHrid: abilityB, level: 3 };

    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: '', level: 1 };
    target.abilities[2] = { abilityHrid: '', level: 1 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    // 两条删除互不搬槽（各自的目标格都是空的）：必须各自成变体，不能被合并成一条。
    expect(variants).toHaveLength(2);
    const emptiedSlots = variants.map((variant) =>
      [1, 2].filter((slot) => !String(variant.snapshot.abilities[slot]?.abilityHrid || '')),
    );
    expect(emptiedSlots).toEqual([[1], [2]]);
  });

  it('keeps an arrow move into an empty neighbour atomic (moving a skill must not silently drop it)', () => {
    const [abilityA] = findAbilities(1);
    expect(abilityA).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.abilities[1] = { abilityHrid: abilityA, level: 5 };

    // 首页箭头「↓」与空格互换（一键可达）：技能下移一格，原槽位清空。
    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: '', level: 1 };
    target.abilities[2] = { abilityHrid: abilityA, level: 5 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    // 旧口径会给出「技能凭空消失」（[空, 空]）与「同名技能占两格」（[A, A]）两个半交换变体。
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.abilities).toEqual(target.abilities);
    expect(snapshotIdentities(variants[0].snapshot)).toEqual([abilityA]);
  });

  it('keeps a degenerate target-side duplicate faithful (grouping neither invents nor repairs it)', () => {
    const [abilityA, abilityB, abilityC, abilityD] = findAbilities(4);
    expect(abilityA).toBeTruthy();
    expect(abilityB).toBeTruthy();
    expect(abilityC).toBeTruthy();
    expect(abilityD).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.abilities[0] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[1] = { abilityHrid: abilityB, level: 3 };
    baseline.abilities[2] = { abilityHrid: abilityC, level: 4 };

    // 退化目标：槽位 2 也放 A（手改下拉 / 导入队列变更模板可达，normalizeEquipmentSetQueueChangeTarget
    // 不校验跨槽重复）。A 在基准里的搬出方（槽位 1）本轮没变 → 命中 queueVariants.js 内「该槽位本轮没变」
    // 分支：没有可合并的变更，分组救不了这种退化配置。
    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: abilityA, level: 5 };
    target.abilities[2] = { abilityHrid: abilityD, level: 1 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    // 变体粒度不丢：两条变更各自成组（退化的那条也不会被静默吞掉）。
    expect(variants).toHaveLength(2);

    const duplicateIdentities = (snapshot) => {
      const identities = snapshotIdentities(snapshot);
      return identities.filter((hrid, index) => identities.indexOf(hrid) !== index);
    };
    const targetDuplicates = new Set(duplicateIdentities(target));
    expect(targetDuplicates.size).toBe(1);

    const degenerateVariant = variants.find((variant) => variant.snapshot.abilities[1]?.abilityHrid === abilityA);
    // 分组如实复制目标侧的重复（[A, A, C]）——注释里的保证范围仅此而已：组内变更之间不冲突、
    // 不制造目标侧没有的重复；「目标侧自带重复」既救不了也没打算救。
    expect(degenerateVariant?.snapshot.abilities[0]).toEqual(target.abilities[0]);
    expect(degenerateVariant?.snapshot.abilities[1]).toEqual(target.abilities[1]);
    // 组外槽位保持基准值：独立变更（槽位 3：C → D）不在本组内。
    expect(degenerateVariant?.snapshot.abilities[2]).toEqual(baseline.abilities[2]);

    // 另一条变体（槽位 3：C → D）同样不夹带怪东西：本组以外维持基准。
    const addedIdentityVariant = variants.find((variant) => variant.snapshot.abilities[2]?.abilityHrid === abilityD);
    expect(addedIdentityVariant?.snapshot.abilities.slice(0, 2)).toEqual(baseline.abilities.slice(0, 2));

    // 各个变体里出现的重复身份都来自目标侧（分组不制造新的重复）。
    variants.forEach((variant) => {
      duplicateIdentities(variant.snapshot).forEach((hrid) => {
        expect(targetDuplicates.has(hrid)).toBe(true);
      });
    });
  });

  it('returns the target verbatim for a single change that repeats an unchanged slot identity', () => {
    const [abilityA, abilityB] = findAbilities(2);
    expect(abilityA).toBeTruthy();
    expect(abilityB).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.abilities[0] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[1] = { abilityHrid: abilityB, level: 3 };

    // 退化形状（只有一条变更）：槽位 2 换成槽位 1 已有的 A → 命中 changes.length <= 1 直返路径，
    // 变体就是目标快照本身、如实带重复；分组只在多变更时有合并机会，这一形状分组根本够不着。
    const target = deepClone(baseline);
    target.abilities[1] = { abilityHrid: abilityA, level: 5 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(1);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.abilities).toEqual(target.abilities);
    expect(snapshotIdentities(variants[0].snapshot)).toEqual([abilityA, abilityA]);
  });

  it('lets a degenerate change merge through its other edge (a skipped edge is not a barrier)', () => {
    const [abilityA, abilityB, abilityC] = findAbilities(3);
    expect(abilityA).toBeTruthy();
    expect(abilityB).toBeTruthy();
    expect(abilityC).toBeTruthy();

    const baseline = createBaseSnapshot();
    baseline.abilities[0] = { abilityHrid: abilityA, level: 5 };
    baseline.abilities[1] = { abilityHrid: abilityB, level: 3 };
    baseline.abilities[2] = { abilityHrid: abilityC, level: 4 };

    // 槽位 1 换成 B（与槽位 2 的 B 重复；槽位 2 本轮没变 → 命中「该槽位本轮没变」分支），槽位 3 同时把 C
    // 换成 A：后一条变更的边（A 在基准里的搬出方正是槽位 1）把两条变更并进同一组——被跳过的边不建边，但
    // 不是屏障。
    const target = deepClone(baseline);
    target.abilities[0] = { abilityHrid: abilityB, level: 3 };
    target.abilities[2] = { abilityHrid: abilityA, level: 5 };

    const summary = computeQueueChangeSummary(baseline, target);
    expect(summary.count).toBe(2);

    const variants = buildQueueVariantSnapshotsFromChanges(baseline, target, summary);
    // 两条变更连成一个原子组：变体就是目标本身（B 占槽位 1/2 两格——重复来自目标侧，既没被制造也没被修复）。
    expect(variants).toHaveLength(1);
    expect(variants[0].snapshot.abilities).toEqual(target.abilities);
    expect(snapshotIdentities(variants[0].snapshot)).toEqual([abilityB, abilityB, abilityA]);
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
