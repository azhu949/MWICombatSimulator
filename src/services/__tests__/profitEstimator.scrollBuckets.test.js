import { describe, expect, it } from 'vitest';
import { buildNoRngDropCountMap, buildNoRngProfitBreakdown, buildRandomProfitBreakdown } from '../profitEstimator.js';

const MONSTER_HRID = '/monsters/abyssal_imp';
const COIN_HRID = '/items/coin';

// 切片 21B：JS SimResult 类已随 A 层删除。桶的合并/归一/兼容重载语义由 Rust
// sim_result.rs 的单测承载，wasm 序列化形状由 golden 快照锁定；本文件只保留
// profitEstimator 对 dropContextBuckets 消费口径的断言（手写桶对象）。

function priceTable() {
  return {
    [COIN_HRID]: { ask: 1, bid: 1, vendor: 1 },
    '/items/large_treasure_chest': { ask: 0, bid: 0, vendor: 0 },
    '/items/red_tea_leaf': { ask: 0, bid: 0, vendor: 0 },
    '/items/emp_tea_leaf': { ask: 0, bid: 0, vendor: 0 },
    '/items/abyssal_essence': { ask: 0, bid: 0, vendor: 0 },
    '/items/quick_aid': { ask: 0, bid: 0, vendor: 0 },
    '/items/firestorm': { ask: 0, bid: 0, vendor: 0 },
    '/items/fireball': { ask: 0, bid: 0, vendor: 0 },
  };
}

describe('timed-scroll result contexts', () => {
  it('uses each drop bucket for no-RNG estimates instead of the final snapshot', () => {
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      deaths: { [MONSTER_HRID]: 10 },
      // 刻意不同的最终值：分桶值存在时具有权威性。
      dropRateMultiplier: { player1: 99 },
      rareFindMultiplier: { player1: 99 },
      combatDropQuantity: { player1: 99 },
      debuffOnLevelGap: { player1: 0 },
      dropContextBuckets: {
        player1: {
          [MONSTER_HRID]: [
            {
              killCount: 5,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
            {
              killCount: 5,
              dropRateMultiplier: 2,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const breakdown = buildNoRngProfitBreakdown(simResult, 'player1', {
      dropMode: 'bid',
      priceTable: priceTable(),
    });

    // 深渊小鬼硬币：掉落率 .8，中点 1500。x2 分桶在 100% 掉落率
    // 处封顶，产出 6,000 + 7,500 枚硬币。
    expect(breakdown.revenueItems.find((row) => row.itemHrid === COIN_HRID)?.amount).toBe(13_500);
    expect(breakdown.revenue).toBe(13_500);
  });

  it('uses bucket windows for random drops', () => {
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      deaths: { [MONSTER_HRID]: 10 },
      dropContextBuckets: {
        player1: {
          [MONSTER_HRID]: [
            {
              killCount: 5,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
            {
              killCount: 5,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 1,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const breakdown = buildRandomProfitBreakdown(simResult, 'player1', {
      dropMode: 'bid',
      priceTable: priceTable(),
      randomSource: () => 0,
      useDropCache: false,
    });

    // random=0 始终通过 .8 硬币判定并选择 minCount=500：
    // 五次无加成击杀加五次 +100% 数量的击杀。
    expect(breakdown.revenue).toBe(7_500);
  });

  it('uses the legacy final snapshot only for residual deaths missing from buckets', () => {
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      deaths: { [MONSTER_HRID]: 10 },
      dropRateMultiplier: { player1: 2 },
      rareFindMultiplier: { player1: 1 },
      combatDropQuantity: { player1: 0 },
      debuffOnLevelGap: { player1: 0 },
      dropContextBuckets: {
        player1: {
          [MONSTER_HRID]: [
            {
              killCount: 5,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const breakdown = buildNoRngProfitBreakdown(simResult, 'player1', {
      dropMode: 'bid',
      priceTable: priceTable(),
    });

    expect(breakdown.revenueItems.find((row) => row.itemHrid === COIN_HRID)?.amount).toBe(13_500);
  });

  it('uses buckets as the complete source when deaths omits the monster', () => {
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      // 这种形状出现在部分序列化/较新的结果中：
      // 分桶携带击杀数，而旧版映射缺失。
      dropContextBuckets: {
        player1: {
          [MONSTER_HRID]: [
            {
              killCount: 5,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const breakdown = buildNoRngProfitBreakdown(simResult, 'player1', {
      dropMode: 'bid',
      priceTable: priceTable(),
    });

    expect(breakdown.revenueItems.find((row) => row.itemHrid === COIN_HRID)?.amount).toBe(6_000);
    expect(breakdown.revenue).toBe(6_000);

    const randomBreakdown = buildRandomProfitBreakdown(simResult, 'player1', {
      dropMode: 'bid',
      priceTable: priceTable(),
      randomSource: () => 0,
      useDropCache: false,
    });
    expect(randomBreakdown.revenueItems.find((row) => row.itemHrid === COIN_HRID)?.amount).toBe(2_500);
    expect(randomBreakdown.revenue).toBe(2_500);
  });

  it('uses the recorded per-monster difficultyTier for tier-gated drops instead of the zone snapshot', () => {
    // 苍蝇（/monsters/fly）蓝钥匙碎片：-0.00003 + 0.00006×档 > 0 自有效档 1 起。
    // 区域档快照为 0 时按旧口径判定永不可掉；怪物有效难度 2（引擎口径
    // spawn 偏移 + 区域档）时开门，掉落/h 估算必须采用桶内记录的难度。
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      dropContextBuckets: {
        player1: {
          '/monsters/fly': [
            {
              killCount: 1,
              difficultyTier: 2,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const dropCountMap = buildNoRngDropCountMap(simResult, 'player1');
    expect(dropCountMap.get('/items/blue_key_fragment')).toBeGreaterThan(0);
  });

  it('falls back to the zone snapshot tier when buckets omit difficultyTier', () => {
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      // 旧版/部分序列化形状：桶没有 difficultyTier 字段。
      dropContextBuckets: {
        player1: {
          '/monsters/fly': [
            {
              killCount: 1,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const dropCountMap = buildNoRngDropCountMap(simResult, 'player1');
    // 回退区域档 0：-0.00003 + 0.00006×0 ≤ 0，按快照口径判定不可掉。
    expect(dropCountMap.has('/items/blue_key_fragment')).toBe(false);
  });
});
