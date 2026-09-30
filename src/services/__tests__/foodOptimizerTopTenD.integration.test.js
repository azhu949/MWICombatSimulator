import { describe, it } from 'vitest';
import {
  runSearchModeEquivalence,
  runTopTenScenario,
  topTenScenariosFor,
} from './support/foodOptimizerTopTenHarness.js';

// E 提速拆分（docs §42）：场景体与 oracle 只在 harness 保留单一副本；本文件只声明场景子集。
describe('exact top ten versus an exhaustive per-candidate evaluation oracle', () => {
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
