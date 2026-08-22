import { describe, expect, it } from 'vitest';
import SimResult from '../../combatsimulator/simResult.js';
import { buildNoRngProfitBreakdown, buildRandomProfitBreakdown } from '../profitEstimator.js';

const MONSTER_HRID = '/monsters/abyssal_imp';
const COIN_HRID = '/items/coin';

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
  it('merges exact drop signatures and keeps scroll usage out of consumables', () => {
    const result = new SimResult({ hrid: '/zones/test', difficultyTier: 0 }, null, 1);

    result.setScrollConfiguration('player1', '/items/seal_of_damage', { quantity: 2 });
    result.recordScrollOpen('player1', '/items/seal_of_damage', {
      configuredQuantity: 2,
      activeDurationNs: 1_800_000_000_000,
    });
    result.recordScrollOpen('player1', '/items/seal_of_damage', {
      activeDurationNs: 1_800_000_000_000,
      exhausted: true,
    });
    result.recordMonsterDeathFromContext('player1', MONSTER_HRID, {
      dropRateMultiplier: 1,
      rareFindMultiplier: 1,
      combatDropQuantity: 0,
      debuffOnLevelGap: 0,
    });
    result.recordMonsterDeathFromContext('player1', MONSTER_HRID, {
      dropRateMultiplier: 1,
      rareFindMultiplier: 1,
      combatDropQuantity: 0,
      debuffOnLevelGap: 0,
    });
    result.recordMonsterDeathFromContext('player1', MONSTER_HRID, {
      dropRateMultiplier: 2,
      rareFindMultiplier: 1,
      combatDropQuantity: 0,
      debuffOnLevelGap: 0,
    });
    result.recordMonsterDeathFromContext('player1', MONSTER_HRID, {
      dropRateMultiplier: 1,
      rareFindMultiplier: 1,
      combatDropQuantity: 0,
      debuffOnLevelGap: 0,
    });

    expect(result.scrollUsage.byPlayer.player1['/items/seal_of_damage']).toMatchObject({
      configuredQuantity: 2,
      openedCount: 2,
      activeDurationNs: 3_600_000_000_000,
      exhausted: true,
    });
    expect(result.consumablesUsed).toEqual({});
    expect(result.dropContextBuckets.player1[MONSTER_HRID]).toEqual([
      {
        killCount: 3,
        dropRateMultiplier: 1,
        rareFindMultiplier: 1,
        combatDropQuantity: 0,
        debuffOnLevelGap: 0,
      },
      {
        killCount: 1,
        dropRateMultiplier: 2,
        rareFindMultiplier: 1,
        combatDropQuantity: 0,
        debuffOnLevelGap: 0,
      },
    ]);
  });

  it('reads the level-gap debuff from flat and nested combatStats contexts', () => {
    const result = new SimResult({ hrid: '/zones/test', difficultyTier: 0 }, null, 1);

    const flatBucket = result.recordMonsterDeathFromContext('player1', MONSTER_HRID, {
      debuffOnLevelGap: -0.1,
    });
    const nestedBucket = result.recordMonsterDeathFromContext('player1', MONSTER_HRID, {
      combatStats: {
        debuffOnLevelGap: -0.25,
      },
    });

    expect(flatBucket).toMatchObject({
      killCount: 1,
      debuffOnLevelGap: -0.1,
    });
    expect(nestedBucket).toMatchObject({
      killCount: 1,
      debuffOnLevelGap: -0.25,
    });
  });

  it('records unit deaths explicitly while preserving the legacy overload', () => {
    const result = new SimResult({ hrid: '/zones/test', difficultyTier: 0 }, null, 1);
    const player = {
      hrid: 'player1',
      debuffOnLevelGap: -0.1,
      combatDetails: {
        combatStats: {
          combatDropRate: 0.25,
          combatRareFind: 0.5,
          combatDropQuantity: 2,
        },
      },
    };
    const monster = { hrid: MONSTER_HRID };

    const explicitBucket = result.recordMonsterDeathFromUnit(player, monster, 2);
    const compatibilityBucket = result.recordMonsterDeath(player, monster, 1);

    expect(compatibilityBucket).toBe(explicitBucket);
    expect(explicitBucket).toMatchObject({
      killCount: 3,
      dropRateMultiplier: 1.25,
      rareFindMultiplier: 1.5,
      combatDropQuantity: 2,
      debuffOnLevelGap: -0.1,
    });
  });

  it('uses each drop bucket for no-RNG estimates instead of the final snapshot', () => {
    const simResult = {
      isDungeon: false,
      numberOfPlayers: 1,
      difficultyTier: 0,
      deaths: { [MONSTER_HRID]: 10 },
      // Deliberately different final values: bucket values are
      // authoritative when present.
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

    // Abyssal imp coin: rate .8, midpoint 1500.  The x2 bucket is capped
    // at a 100% drop rate, producing 6,000 + 7,500 coins.
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

    // random=0 always passes the .8 coin roll and chooses minCount=500:
    // five unboosted kills plus five kills with +100% quantity.
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
      // This shape occurs in partially serialized/new results: the
      // bucket carries the kill count, while the legacy map is absent.
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
});
