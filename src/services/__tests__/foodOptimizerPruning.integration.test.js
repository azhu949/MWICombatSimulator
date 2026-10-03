import { describe, it } from 'vitest';
import { pruningScenariosFor, runPruningScenario } from './support/foodOptimizerPruningHarness.js';

// 2026-10-03：「E 提速拆分」的 2 个薄子文件（PruningA/B）合并回本文件。
// 该拆分实测对全量墙钟零收益，只增加文件数与 fork 启停。
// 场景字面量与 oracle 仍只在 support/foodOptimizerPruningHarness.js 保留单副本；
// 用例集合（7 个）、断言文本与 60000 超时逐字未变。
describe('complete food coverage versus an exhaustive per-candidate evaluation oracle', () => {
  it.each(pruningScenariosFor(['dungeon', 'no mana-consuming abilities', 'entire food catalog']))(
    'classifies every candidate, including every feasible result, in $name',
    async (scenario) => {
      await runPruningScenario(scenario);
    },
    60000,
  );

  it.each(
    pruningScenariosFor([
      'three-slot zone',
      'zone',
      'party with scroll expiration and the second player as target',
      'single-slot dungeon',
    ]),
  )(
    'classifies every candidate, including every feasible result, in $name',
    async (scenario) => {
      await runPruningScenario(scenario);
    },
    60000,
  );
});
