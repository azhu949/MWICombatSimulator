import { describe, it } from 'vitest';
import { runTopTenScenario, topTenScenariosFor } from './support/foodOptimizerTopTenHarness.js';

// E 提速拆分（docs §42）：场景体与 oracle 只在 harness 保留单一副本；本文件只声明场景子集。
describe('exact top ten versus an exhaustive per-candidate evaluation oracle', () => {
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
});
