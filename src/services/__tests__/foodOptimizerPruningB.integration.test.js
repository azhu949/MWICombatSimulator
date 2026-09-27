import { describe, it } from 'vitest';
import { pruningScenariosFor, runPruningScenario } from './support/foodOptimizerPruningHarness.js';

// E 提速拆分（docs §42）：场景体与 oracle 只在 harness 保留单一副本；本文件只声明场景子集。
describe('complete food coverage versus an independent native-engine oracle', () => {
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
