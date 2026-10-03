import { describe, it } from 'vitest';
import {
  runSearchModeEquivalence,
  runTopTenScenario,
  topTenScenariosFor,
} from './support/foodOptimizerTopTenHarness.js';

// 2026-10-03：「E 提速拆分」的 4 个薄子文件（TopTenA/B/C/D）合并回本文件。
// 该拆分实测对全量墙钟零收益（把 50.3s 的单文件拆到
// 15.7s，墙钟 59.1–60.9s 纹丝不动），只增加文件数与 fork 启停——正是已定位的真实瓶颈。
// 场景字面量与 oracle 仍只在 support/foodOptimizerTopTenHarness.js 保留单副本；
// 用例集合（14 个）、断言文本与 60000 超时逐字未变。
describe('exact top ten versus an exhaustive per-candidate evaluation oracle', () => {
  it.each(
    topTenScenariosFor([
      'equipped dungeon baseline with a stricter death budget',
      'ordinary zone requiring HP food but no mana',
    ]),
  )(
    'preserves the full search domain and the exact physical top ten in $name',
    async (scenario) => {
      await runTopTenScenario(scenario);
    },
    60000,
  );

  it.each(topTenScenariosFor(['equipped dungeon baseline with inactive food', 'zone with three slots']))(
    'preserves the full search domain and the exact physical top ten in $name',
    async (scenario) => {
      await runTopTenScenario(scenario);
    },
    60000,
  );

  it.each(
    topTenScenariosFor([
      'equipped ordinary zone with a bounded priority neighborhood',
      'ordinary zone with feasible defaults, MP demand and app seeds',
    ]),
  )(
    'preserves the full search domain and the exact physical top ten in $name',
    async (scenario) => {
      await runTopTenScenario(scenario);
    },
    60000,
  );

  it.each(
    topTenScenariosFor([
      'dungeon',
      'second player and a finite combat scroll',
      'all foods with one slot',
      'HP pressure without mana-consuming abilities',
      'zero-cost ties from entirely unused food',
      'single round at the product default',
      'wrapped and nonconsecutive seeds',
    ]),
  )(
    'preserves the full search domain and the exact physical top ten in $name',
    async (scenario) => {
      await runTopTenScenario(scenario);
    },
    60000,
  );

  it('keeps omitted searchMode equivalent to explicit complete mode', async () => {
    await runSearchModeEquivalence();
  });
});
