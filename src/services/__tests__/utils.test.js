import { describe, expect, it } from 'vitest';
import { normalizeAbilitySlotIndex } from '../utils.js';

// 这个口径存在的唯一理由就是「UI 与 store 必须算同一件事」：UI 拿它比对内联触发器编辑器是否正开在
// 被交换的槽位上，store 拿它决定到底换哪两格。两边只要都用它，小数入参也不会分叉；任何一边改回自己
// 写一份（Number vs floor），就会重新长出「store 换了槽位、UI 认为没换」的失配。
describe('normalizeAbilitySlotIndex（技能槽号统一口径）', () => {
  it('整数与数字字符串原样通过，小数按 floor 归一（与 store 交换的目标槽位同值）', () => {
    expect(normalizeAbilitySlotIndex(1)).toBe(1);
    expect(normalizeAbilitySlotIndex(4)).toBe(4);
    expect(normalizeAbilitySlotIndex(0)).toBe(0);
    expect(normalizeAbilitySlotIndex('2')).toBe(2);
    expect(normalizeAbilitySlotIndex(1.9)).toBe(1);
    expect(normalizeAbilitySlotIndex('2.7')).toBe(2);
  });

  it('非法/负数回落到 fallback（默认 -1 = 非法），不让脏值漏过调用方的门位校验', () => {
    expect(normalizeAbilitySlotIndex(-1)).toBe(-1);
    expect(normalizeAbilitySlotIndex(-1.9)).toBe(-1);
    expect(normalizeAbilitySlotIndex('x')).toBe(-1);
    expect(normalizeAbilitySlotIndex(undefined)).toBe(-1);
    expect(normalizeAbilitySlotIndex(Number.NaN)).toBe(-1);
    expect(normalizeAbilitySlotIndex(Number.POSITIVE_INFINITY)).toBe(-1);
    expect(normalizeAbilitySlotIndex('x', 7)).toBe(7);
    // null / '' 经 Number() 变成 0：这不算「非法」而是「槽位 0」，由调用方的门位校验（<= 0）挡掉
    // ——与改造前 store 的 Math.floor(toFiniteNumber(value, -1)) 完全同义。
    expect(normalizeAbilitySlotIndex(null)).toBe(0);
    expect(normalizeAbilitySlotIndex('')).toBe(0);
  });

  it('幂等：已归一的值的再归一不变 ⇒ store 侧二次归一不会把 UI 比对用的数字挪走', () => {
    for (const value of [1.9, '2', -1.9, 'x', 0, Number.NaN, 4, Number.POSITIVE_INFINITY]) {
      const once = normalizeAbilitySlotIndex(value);
      expect(normalizeAbilitySlotIndex(once)).toBe(once);
    }
  });
});
