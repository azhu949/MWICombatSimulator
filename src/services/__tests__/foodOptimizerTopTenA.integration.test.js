import { describe, it } from 'vitest';
import { runTopTenScenario, topTenScenariosFor } from './support/foodOptimizerTopTenHarness.js';

// E 提速拆分（docs §42）：场景体与 oracle 只在 harness 保留单一副本；本文件只声明场景子集。
describe('exact top ten versus a full native-engine oracle', () => {
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
});
