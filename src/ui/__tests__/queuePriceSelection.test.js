import { describe, expect, it } from 'vitest';
import { buildChangedEquipmentKeys, buildSelectionKey } from '../queuePriceSelection.js';

describe('buildSelectionKey', () => {
  it('constructs a hrid|level key from normal inputs', () => {
    expect(buildSelectionKey('/items/sword', 5)).toBe('/items/sword|5');
  });

  it('floors fractional enhancement levels', () => {
    expect(buildSelectionKey('/items/sword', 5.9)).toBe('/items/sword|5');
  });

  it('clamps negative enhancement levels to zero', () => {
    expect(buildSelectionKey('/items/sword', -3)).toBe('/items/sword|0');
  });

  it('clamps NaN and undefined enhancement levels to zero', () => {
    expect(buildSelectionKey('/items/sword', undefined)).toBe('/items/sword|0');
    expect(buildSelectionKey('/items/sword', NaN)).toBe('/items/sword|0');
    expect(buildSelectionKey('/items/sword', null)).toBe('/items/sword|0');
  });

  it('treats empty or missing itemHrid as empty string', () => {
    expect(buildSelectionKey('', 5)).toBe('|5');
    expect(buildSelectionKey(undefined, 5)).toBe('|5');
    expect(buildSelectionKey(null, 5)).toBe('|5');
  });
});

describe('buildChangedEquipmentKeys', () => {
  // 使用实际 EQUIPMENT_SLOT_KEYS 中的槽位做测试
  const WEAPON_HRID = '/items/iron_sword';
  const HEAD_HRID = '/items/iron_helm';

  function makeSnapshot(equipment) {
    return { equipment };
  }

  it('returns an empty set when baseline and target equipment are identical', () => {
    const equipment = { weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 5 } };
    const baseline = makeSnapshot(equipment);
    const item = { snapshot: makeSnapshot(equipment) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(0);
  });

  it('returns an empty set when both baseline and target have no equipment at all', () => {
    const baseline = makeSnapshot({});
    const item = { snapshot: makeSnapshot({}) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(0);
  });

  it('returns an empty set when item and baseline are null/undefined', () => {
    expect(buildChangedEquipmentKeys(null, null).size).toBe(0);
    expect(buildChangedEquipmentKeys(undefined, undefined).size).toBe(0);
    expect(buildChangedEquipmentKeys({}, {}).size).toBe(0);
  });

  it('detects a single item change (new item in an empty slot)', () => {
    const baseline = makeSnapshot({});
    const item = { snapshot: makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 0 } }) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(1);
    expect(keys.has(buildSelectionKey(WEAPON_HRID, 0))).toBe(true);
  });

  it('detects a single item change (item replaced)', () => {
    const baseline = makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 0 } });
    const item = { snapshot: makeSnapshot({ weapon: { itemHrid: '/items/steel_sword', enhancementLevel: 0 } }) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(1);
    expect(keys.has(buildSelectionKey('/items/steel_sword', 0))).toBe(true);
  });

  it('detects an enhancement level change on the same item', () => {
    const baseline = makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 3 } });
    const item = { snapshot: makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 7 } }) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(1);
    expect(keys.has(buildSelectionKey(WEAPON_HRID, 7))).toBe(true);
  });

  it('detects multiple equipment changes across different slots', () => {
    const baseline = makeSnapshot({
      weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 0 },
      head: { itemHrid: HEAD_HRID, enhancementLevel: 2 },
    });
    const item = {
      snapshot: makeSnapshot({
        weapon: { itemHrid: '/items/steel_sword', enhancementLevel: 5 },
        head: { itemHrid: '/items/steel_helm', enhancementLevel: 2 },
      }),
    };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(2);
    expect(keys.has(buildSelectionKey('/items/steel_sword', 5))).toBe(true);
    expect(keys.has(buildSelectionKey('/items/steel_helm', 2))).toBe(true);
  });

  it('ignores a slot where equipment was removed (after.itemHrid is empty)', () => {
    const baseline = makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 5 } });
    const item = { snapshot: makeSnapshot({ weapon: { itemHrid: '', enhancementLevel: 0 } }) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.size).toBe(0);
  });

  it('produces keys compatible with buildSelectionKey for filtering', () => {
    const baseline = makeSnapshot({ weapon: { itemHrid: '', enhancementLevel: 0 } });
    const item = { snapshot: makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 10 } }) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    const selectionKey = buildSelectionKey(WEAPON_HRID, 10);
    expect(keys.has(selectionKey)).toBe(true);
  });

  it('floors the enhancement level in the produced key', () => {
    const baseline = makeSnapshot({ weapon: { itemHrid: '', enhancementLevel: 0 } });
    const item = { snapshot: makeSnapshot({ weapon: { itemHrid: WEAPON_HRID, enhancementLevel: 7.9 } }) };
    const keys = buildChangedEquipmentKeys(item, baseline);
    expect(keys.has(buildSelectionKey(WEAPON_HRID, 7))).toBe(true);
    expect(keys.has(buildSelectionKey(WEAPON_HRID, 8))).toBe(false);
  });
});
