import { describe, expect, it, vi } from 'vitest';

// 真实数据中没有以下这些目录形态，无法在真实快照上覆盖对应的分族行为，
// 因此这里用部分 mock 的合成食物锁定：
// ① 新增「同一恢复机制、但官方分类不同」的烹饪线（如第二条 HP 瞬时线）——
//    它与既有甜甜圈线必须分属两族，合法组合（新线 + 甜甜圈）照旧被枚举；
// ② 没有官方分类映射的产物（测试桩、脏值形态）——自成一类，绝不静默并入已知类；
// ③ 同一产物被多个不同分类的烹饪动作输出（分类冲突）——归属无法判定，自成一类；
// ④ 烹饪动作缺少分类（脏数据）——产物自成一类。
// 同一产物被多个同分类动作输出（如基础款 + 升级款）不属冲突：照常归入该分类。
vi.mock('../../shared/gameDataIndex.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    foodOptions: [
      ...actual.foodOptions,
      { hrid: '/items/prime_heal_snack', name: 'Prime Heal Snack', itemLevel: 1 },
      { hrid: '/items/dual_restore_probe', name: 'Dual Restore Probe', itemLevel: 1 },
      { hrid: '/items/conflicted_snack', name: 'Conflicted Snack', itemLevel: 1 },
      { hrid: '/items/uncategorized_snack', name: 'Uncategorized Snack', itemLevel: 1 },
    ],
    itemDetailIndex: {
      ...actual.itemDetailIndex,
      // 与甜甜圈线同为「HP 瞬时」恢复机制，仅官方分类不同。
      '/items/prime_heal_snack': {
        hrid: '/items/prime_heal_snack',
        name: 'Prime Heal Snack',
        categoryHrid: '/item_categories/food',
        itemLevel: 1,
        hitpointRestore: 100,
        manapointRestore: 0,
        recoveryDuration: 0,
      },
      '/items/dual_restore_probe': {
        hrid: '/items/dual_restore_probe',
        name: 'Dual Restore Probe',
        categoryHrid: '/item_categories/food',
        itemLevel: 1,
        hitpointRestore: 100,
        manapointRestore: 100,
        recoveryDuration: 0,
      },
      '/items/conflicted_snack': {
        hrid: '/items/conflicted_snack',
        name: 'Conflicted Snack',
        categoryHrid: '/item_categories/food',
        itemLevel: 1,
        hitpointRestore: 100,
        manapointRestore: 0,
        recoveryDuration: 0,
      },
      '/items/uncategorized_snack': {
        hrid: '/items/uncategorized_snack',
        name: 'Uncategorized Snack',
        categoryHrid: '/item_categories/food',
        itemLevel: 1,
        hitpointRestore: 0,
        manapointRestore: 100,
        recoveryDuration: 0,
      },
    },
    skillingData: {
      ...actual.skillingData,
      actions: [
        ...actual.skillingData.actions,
        {
          hrid: '/actions/cooking/prime_heal_snack',
          type: '/action_types/cooking',
          category: '/action_categories/cooking/instant_heal_prime',
          outputItems: [{ itemHrid: '/items/prime_heal_snack', count: 1 }],
        },
        // 同分类的第二个动作（基础款 + 升级款形态）：不构成冲突，照旧归入该分类。
        {
          hrid: '/actions/cooking/prime_heal_snack_batch',
          type: '/action_types/cooking',
          category: '/action_categories/cooking/instant_heal_prime',
          outputItems: [{ itemHrid: '/items/prime_heal_snack', count: 2 }],
        },
        // 分类冲突：同一产物被两个不同分类的动作输出。
        {
          hrid: '/actions/cooking/conflicted_snack_a',
          type: '/action_types/cooking',
          category: '/action_categories/cooking/instant_heal',
          outputItems: [{ itemHrid: '/items/conflicted_snack', count: 1 }],
        },
        {
          hrid: '/actions/cooking/conflicted_snack_b',
          type: '/action_types/cooking',
          category: '/action_categories/cooking/instant_mana',
          outputItems: [{ itemHrid: '/items/conflicted_snack', count: 1 }],
        },
        // 分类缺失：动作 category 为空（脏数据）。
        {
          hrid: '/actions/cooking/uncategorized_snack',
          type: '/action_types/cooking',
          category: '',
          outputItems: [{ itemHrid: '/items/uncategorized_snack', count: 1 }],
        },
      ],
    },
  };
});

import {
  generateFoodOptimizerCompositionItems,
  getFoodOptimizerCatalogHrids,
  getFoodOptimizerFamilyKey,
} from '../foodOptimizerDomain.js';

describe('food family classification for catalog data shapes the real snapshot does not contain', () => {
  // 旧实现按恢复属性派生族键，这条新线会与甜甜圈线同族 → 组合被静默排除（漏解）。
  // 族键改用官方分类后两条线分属两族，同机制不再等于同族。
  it('keeps a same-mechanism new cooking line separate from the donut line', () => {
    expect(getFoodOptimizerFamilyKey('/items/prime_heal_snack')).toBe(
      'food-family:/action_categories/cooking/instant_heal_prime',
    );
    expect(getFoodOptimizerFamilyKey('/items/prime_heal_snack')).not.toBe(getFoodOptimizerFamilyKey('/items/donut'));
  });

  it('enumerates the new line together with the donut line in one composition', () => {
    const line = (hrid) => ({ hrid, kind: 'hp', restore: 100, thresholds: [100], price: 1 });
    const items = [line('/items/donut'), line('/items/prime_heal_snack')];
    const compositions = [...generateFoodOptimizerCompositionItems(items, 2)];
    expect(compositions.some((composition) => composition.length === 2)).toBe(true);
  });

  // 没有官方分类映射的 hrid（测试桩、脏值）自成一类，不与任何已知族互斥。
  it('keeps a food without an official category self-isolated instead of folding it into a known family', () => {
    expect(getFoodOptimizerFamilyKey('/items/dual_restore_probe')).toBe('food-family:unknown:dual_restore_probe');
  });

  // 冲突与缺失都归 unknown 自隔离（fail-open），绝不静默挑一条线合并。
  it('keeps products of conflicting or missing action categories self-isolated', () => {
    expect(getFoodOptimizerFamilyKey('/items/conflicted_snack')).toBe('food-family:unknown:conflicted_snack');
    expect(getFoodOptimizerFamilyKey('/items/uncategorized_snack')).toBe('food-family:unknown:uncategorized_snack');
  });

  it('makes the catalog guard flag exactly the foods without a unique official category', () => {
    // 与 foodOptimizerDomain.test.js 的目录守卫用例同一断言口径：有唯一官方分类的食物
    // （含合成注入的同机制新线）全部可归类；无分类映射、分类冲突、分类缺失的食物是
    // 未归类项——即守卫在这些数据形态出现时必然显式失败，而不是静默放过。
    const unclassified = getFoodOptimizerCatalogHrids().filter((hrid) =>
      getFoodOptimizerFamilyKey(hrid).startsWith('food-family:unknown:'),
    );
    expect(unclassified).toEqual([
      '/items/dual_restore_probe',
      '/items/conflicted_snack',
      '/items/uncategorized_snack',
    ]);
  });
});
