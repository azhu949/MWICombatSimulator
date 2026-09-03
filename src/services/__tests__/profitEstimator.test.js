import { describe, expect, it } from 'vitest';
import combatMonsterDetailMap from '../../combatsimulator/data/combatMonsterDetailMap.json';
import {
  buildNoRngDropCountMap,
  buildNoRngProfitBreakdown,
  buildRandomProfitBreakdown,
  estimateNoRngProfit,
} from '../profitEstimator.js';

describe('profitEstimator', () => {
  it('uses consumable ask price when consumableMode is ask', () => {
    const simResult = {
      deaths: {},
      consumablesUsed: {
        player1: {
          '/items/coin': 3,
        },
      },
    };

    const result = estimateNoRngProfit(simResult, 'player1', {
      consumableMode: 'ask',
      priceTable: {
        '/items/coin': { ask: 5, bid: 2, vendor: 1 },
      },
    });

    expect(result.revenue).toBe(0);
    expect(result.expenses).toBe(15);
    expect(result.profit).toBe(-15);
  });

  it('falls back to ask when bid is unavailable', () => {
    const simResult = {
      deaths: {},
      consumablesUsed: {
        player1: {
          '/items/coin': 4,
        },
      },
    };

    const result = estimateNoRngProfit(simResult, 'player1', {
      consumableMode: 'bid',
      priceTable: {
        '/items/coin': { ask: 3, bid: -1, vendor: 1 },
      },
    });

    expect(result.expenses).toBe(12);
    expect(result.profit).toBe(-12);
  });

  it('falls back to vendor when ask and bid are unavailable', () => {
    const simResult = {
      deaths: {},
      consumablesUsed: {
        player1: {
          '/items/coin': 7,
        },
      },
    };

    const result = estimateNoRngProfit(simResult, 'player1', {
      consumableMode: 'ask',
      priceTable: {
        '/items/coin': { ask: -1, bid: -1, vendor: 2 },
      },
    });

    expect(result.expenses).toBe(14);
    expect(result.profit).toBe(-14);
  });

  it('returns line-item breakdown for consumable expenses', () => {
    const simResult = {
      deaths: {},
      consumablesUsed: {
        player1: {
          '/items/coin': 2.5,
        },
      },
    };

    const breakdown = buildNoRngProfitBreakdown(simResult, 'player1', {
      consumableMode: 'bid',
      priceTable: {
        '/items/coin': { ask: 9, bid: 4, vendor: 1 },
      },
    });

    expect(breakdown.revenue).toBe(0);
    expect(breakdown.expenses).toBe(10);
    expect(breakdown.profit).toBe(-10);
    expect(breakdown.revenueItems).toEqual([]);
    expect(breakdown.expenseItems).toHaveLength(1);
    expect(breakdown.expenseItems[0]).toMatchObject({
      itemHrid: '/items/coin',
      amount: 2.5,
      unitPrice: 4,
      totalValue: 10,
    });
  });

  it('returns empty breakdown for null result', () => {
    const breakdown = buildNoRngProfitBreakdown(null, 'player1', {});

    expect(breakdown).toEqual({
      revenueItems: [],
      expenseItems: [],
      revenue: 0,
      expenses: 0,
      profit: 0,
    });
  });

  it('ignores dungeon drops for no-RNG revenue to match legacy behavior', () => {
    const breakdown = buildNoRngProfitBreakdown(
      {
        isDungeon: true,
        deaths: {
          '/monsters/abyssal_imp': 999,
        },
        consumablesUsed: {
          player1: {
            '/items/coin': 3,
          },
        },
      },
      'player1',
      {
        dropMode: 'bid',
        consumableMode: 'ask',
        priceTable: {
          '/items/coin': { ask: 1, bid: 1, vendor: 1 },
        },
      },
    );

    expect(breakdown.revenue).toBe(0);
    expect(breakdown.expenses).toBe(3);
    expect(breakdown.profit).toBe(-3);
  });

  it('ignores dungeon drops for random revenue to match legacy behavior', () => {
    const breakdown = buildRandomProfitBreakdown(
      {
        isDungeon: true,
        deaths: {
          '/monsters/abyssal_imp': 999,
        },
        consumablesUsed: {
          player1: {
            '/items/coin': 2,
          },
        },
      },
      'player1',
      {
        dropMode: 'bid',
        consumableMode: 'ask',
        priceTable: {
          '/items/coin': { ask: 1, bid: 1, vendor: 1 },
        },
        useDropCache: false,
        randomSource: () => 0,
      },
    );

    expect(breakdown.revenue).toBe(0);
    expect(breakdown.expenses).toBe(2);
    expect(breakdown.profit).toBe(-2);
  });

  it('returns an empty drop count map for dungeons, null and non-object results', () => {
    expect(buildNoRngDropCountMap(null, 'player1').size).toBe(0);
    expect(buildNoRngDropCountMap(42, 'player1').size).toBe(0);
    expect(buildNoRngDropCountMap('result', 'player1').size).toBe(0);
    expect(
      buildNoRngDropCountMap(
        {
          isDungeon: true,
          deaths: { '/monsters/abyssal_imp': 999 },
          dropRateMultiplier: { player1: 1 },
        },
        'player1',
      ).size,
    ).toBe(0);
  });

  it('feeds the no-RNG revenue line items from the exported drop count map', () => {
    const monsterHrid = '/monsters/abyssal_imp';
    const monster = combatMonsterDetailMap[monsterHrid];
    // 分桶击杀（不同难度档/掉落加成）+ 旧版最终快照兜底的剩余击杀，
    // 同时覆盖 dropContextBuckets 与 legacy 两条路径。
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 3,
      difficultyTier: 2,
      deaths: { [monsterHrid]: 12 },
      dropRateMultiplier: { player1: 2 },
      rareFindMultiplier: { player1: 1 },
      combatDropQuantity: { player1: 0 },
      debuffOnLevelGap: { player1: 0 },
      dropContextBuckets: {
        player1: {
          [monsterHrid]: [
            {
              killCount: 5,
              difficultyTier: 0,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
            {
              killCount: 4,
              difficultyTier: 3,
              dropRateMultiplier: 1.5,
              rareFindMultiplier: 2,
              combatDropQuantity: 0.5,
              debuffOnLevelGap: -0.1,
            },
          ],
        },
      },
    };

    const priceTable = { '/items/coin': { ask: 1, bid: 1, vendor: 1 } };
    for (const drop of [...(monster?.dropTable ?? []), ...(monster?.rareDropTable ?? [])]) {
      if (!priceTable[drop.itemHrid]) {
        priceTable[drop.itemHrid] = { ask: 2, bid: 2, vendor: 2 };
      }
    }

    const dropCountMap = buildNoRngDropCountMap(simResult, 'player1');
    const breakdown = buildNoRngProfitBreakdown(simResult, 'player1', {
      dropMode: 'bid',
      priceTable,
    });

    // 硬币期望数量：5*0.8*1500/3 + 4*1*2025/3 + 3*1*1500/3 = 6200。
    expect(dropCountMap.get('/items/coin')).toBe(6200);
    expect(dropCountMap.size).toBeGreaterThan(0);

    const amountByItem = new Map(breakdown.revenueItems.map((row) => [row.itemHrid, row.amount]));
    expect(amountByItem.size).toBe(dropCountMap.size);
    for (const [itemHrid, amount] of dropCountMap.entries()) {
      expect(amountByItem.get(itemHrid)).toBe(amount);
    }
    expect(breakdown.revenue).toBeCloseTo(
      breakdown.revenueItems.reduce((total, row) => total + row.amount * row.unitPrice, 0),
      6,
    );
  });

  it('caches the drop count map per simResult and player across repeated calls', () => {
    // advisor 铁牛模式同一 simResult 的同一玩家会被利润路径
    // （buildNoRngProfitBreakdown）与掉落路径（buildAdvisorDropRateMetrics）
    // 各调一次。二次调用必须命中 per-result 缓存而不是重复全掉落表遍历：
    // 篡改输入后二次调用仍返回首次结果即为命中信号（正常流程汇总阶段
    // simResult 不可变，此处篡改仅为让「重算」产生可区分的数值）。
    const monsterHrid = '/monsters/abyssal_imp';
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 3,
      difficultyTier: 2,
      deaths: { [monsterHrid]: 12 },
      dropRateMultiplier: { player1: 2 },
      rareFindMultiplier: { player1: 1 },
      combatDropQuantity: { player1: 0 },
      debuffOnLevelGap: { player1: 0 },
      dropContextBuckets: {
        player1: {
          [monsterHrid]: [
            {
              killCount: 5,
              difficultyTier: 0,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
            {
              killCount: 4,
              difficultyTier: 3,
              dropRateMultiplier: 1.5,
              rareFindMultiplier: 2,
              combatDropQuantity: 0.5,
              debuffOnLevelGap: -0.1,
            },
          ],
        },
      },
    };

    const first = buildNoRngDropCountMap(simResult, 'player1');
    expect(first.get('/items/coin')).toBe(6200);

    // 若未命中缓存而重算，删掉第二个桶会触发 legacy 兜底（剩余 7 次击杀），
    // 硬币期望变为 5*0.8*1500/3 + 7*1*1500/3 = 5500，与 6200 可区分。
    simResult.dropContextBuckets.player1[monsterHrid].pop();
    const second = buildNoRngDropCountMap(simResult, 'player1');

    // 命中缓存：数值不受篡改影响，且返回的是独立副本（防别名污染）。
    expect(second.get('/items/coin')).toBe(6200);
    expect(second).not.toBe(first);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it('isolates the per-result cache between players', () => {
    // 缓存键必须是「解析后」的玩家：summarizeResult 会为每个玩家各建一份，
    // 铁牛掉落路径只应命中 metric player 那一份。若键串了（如固定 player1），
    // 多玩家扫描会互相取错对方的掉落口径——两玩家的桶击杀数故意不同以便区分。
    const monsterHrid = '/monsters/abyssal_imp';
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      dropRateMultiplier: { player1: 1, player2: 1 },
      rareFindMultiplier: { player1: 1, player2: 1 },
      combatDropQuantity: { player1: 0, player2: 0 },
      debuffOnLevelGap: { player1: 0, player2: 0 },
      dropContextBuckets: {
        player1: {
          [monsterHrid]: [
            {
              killCount: 10,
              difficultyTier: 0,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
        player2: {
          [monsterHrid]: [
            {
              killCount: 5,
              difficultyTier: 0,
              dropRateMultiplier: 1,
              rareFindMultiplier: 1,
              combatDropQuantity: 0,
              debuffOnLevelGap: 0,
            },
          ],
        },
      },
    };

    const player1First = buildNoRngDropCountMap(simResult, 'player1');
    const player2First = buildNoRngDropCountMap(simResult, 'player2');
    // 硬币期望：0.8 掉率 × 1500 中点 ÷ 1 玩家；player1 分桶杀 10 次、player2 杀 5 次。
    expect(player1First.get('/items/coin')).toBe(12000);
    expect(player2First.get('/items/coin')).toBe(6000);

    // 篡改 player1 的桶后二次调用：player1 仍命中自己的缓存，
    // player2 的缓存不受 player1 输入变化影响（键隔离）。
    simResult.dropContextBuckets.player1[monsterHrid].pop();
    const player1Second = buildNoRngDropCountMap(simResult, 'player1');
    const player2Second = buildNoRngDropCountMap(simResult, 'player2');

    expect(player1Second.get('/items/coin')).toBe(12000);
    expect(player2Second.get('/items/coin')).toBe(6000);
    expect(player1Second).not.toBe(player1First);
  });
});
