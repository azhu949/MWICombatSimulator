import { describe, expect, it } from 'vitest';
import { resolveEquipmentComboboxItems } from '../gameDataIndex.js';

const charmOptions = [
  { hrid: '/items/trainee_attack_charm', name: 'Trainee Attack Charm', itemLevel: 1, isCombatInert: false },
  { hrid: '/items/trainee_milking_charm', name: 'Trainee Milking Charm', itemLevel: 1, isCombatInert: true },
];

// 装备下拉口径的唯一实现（simulatorStore 选项出品层用它产出 options.equipmentBySlot，
// getEquipmentComboboxOptions 用它补回「保留已选中」例外）；UI 层不得再自建第二份过滤逻辑。
// 标记是产出语义（构建期 isCombatInert：引擎在战斗里读不到贡献，当前数据即生活技能护符），
// 不是身份判定。本测试锁定：过滤语义、保留已选中的例外、无标记槽位零影响（含引用同一性）、
// 异常输入容错。
describe('resolveEquipmentComboboxItems', () => {
  it('filters combat-inert charms (current data: life-skill charms) out of the equipment dropdown', () => {
    const visible = resolveEquipmentComboboxItems(charmOptions);
    expect(visible).toEqual([charmOptions[0]]);
    // 过滤分支必须产出新数组：入参是共享索引里的槽位数组，不得被原地修改。
    expect(visible).not.toBe(charmOptions);
    expect(charmOptions).toHaveLength(2);
  });

  it('keeps the equipped life-skill charm visible so the selector never renders blank', () => {
    const items = resolveEquipmentComboboxItems(charmOptions, '/items/trainee_milking_charm');
    expect(items.map((item) => item.hrid)).toEqual(['/items/trainee_attack_charm', '/items/trainee_milking_charm']);
  });

  it('does not duplicate the equipped item when it is already visible', () => {
    const items = resolveEquipmentComboboxItems(charmOptions, '/items/trainee_attack_charm');
    expect(items.map((item) => item.hrid)).toEqual(['/items/trainee_attack_charm']);
  });

  it('leaves slots without the projection marker untouched', () => {
    const headOptions = [
      { hrid: '/items/cheese_helmet', name: 'Cheese Helmet', itemLevel: 10 },
      { hrid: '/items/vision_helmet', name: 'Vision Helmet', itemLevel: 90 },
    ];
    // 无标记槽位必须原样返回同一数组引用（= 共享索引 equipmentOptionsBySlot[slot]），
    // 否则「store 选项 === 共享索引」在引用层面不成立，每个槽位还多一份等价长驻副本。
    expect(resolveEquipmentComboboxItems(headOptions, '/items/vision_helmet')).toBe(headOptions);
    expect(resolveEquipmentComboboxItems(headOptions)).toBe(headOptions);
  });

  it('tolerates missing or empty option lists', () => {
    expect(resolveEquipmentComboboxItems()).toEqual([]);
    expect(resolveEquipmentComboboxItems(null, '/items/trainee_milking_charm')).toEqual([]);
    expect(resolveEquipmentComboboxItems([], '/items/trainee_milking_charm')).toEqual([]);
  });

  it('ignores an unknown equipped hrid', () => {
    expect(resolveEquipmentComboboxItems(charmOptions, '/items/missing_charm')).toEqual([charmOptions[0]]);
  });
});
