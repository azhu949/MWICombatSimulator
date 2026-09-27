import { expect, vi } from 'vitest';
import {
  buildFoodCandidate,
  buildFoodDefaultCandidate,
  compareFoodOptimizerResults,
  countFoodOptimizerCandidates,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../../foodOptimizerDomain.js';
import { materializeFoodOptimizerOutcome } from '../../foodOptimizerPruning.js';
import { createFoodOptimizerSearch } from '../../foodOptimizerSearch.js';
import { createFoodOptimizerEvaluator } from '../../foodOptimizerSimulation.js';
import {
  createFoodOptimizerFixture,
  physicalFoodOptimizerResult,
  referenceDeathBudget,
  referenceFoodOptimizerRound,
} from './foodOptimizerTestSupport.js';

// Deliberately do not call the production evaluator or its aggregation helpers.
// Every oracle seed runs to the full time limit, including infeasible candidates.
// The death budget follows the slot-aware rule (fewer slots than the equipped
// baseline must die strictly less), so this oracle does not share the production
// helper that decides it.
async function referenceResult(request, candidate, baselineDeaths = Infinity) {
  const samples = [];
  for (const seed of request.seeds) samples.push(await referenceFoodOptimizerRound(request, candidate, seed));
  const deaths = samples.reduce((sum, sample) => sum + sample.deaths, 0);
  const ranOutOfMana = samples.some((sample) => sample.ranOutOfMana);
  const foodUsed = {};
  for (const sample of samples)
    for (const [hrid, count] of Object.entries(sample.foodUsed))
      foodUsed[hrid] = (foodUsed[hrid] || 0) + count / samples.length;
  const budget = referenceDeathBudget(request, candidate, baselineDeaths);
  const rejected = candidate ? (ranOutOfMana ? 'mana' : deaths > budget ? 'deaths' : '') : '';
  return {
    feasible: !rejected,
    rejected,
    deaths,
    ranOutOfMana,
    samples,
    roundsCompleted: samples.length,
    foodUsed,
    costPerHour: samples.reduce((sum, sample) => sum + sample.costPerHour, 0) / samples.length,
  };
}

const rankedPhysical = (results) =>
  results.map((result) => ({ signature: result.signature, result: physicalFoodOptimizerResult(result) }));

async function runSearch(fixture, searchMode) {
  const request = { ...fixture.request };
  if (searchMode !== undefined) request.searchMode = searchMode;
  const covered = new Map();
  const duplicates = [];
  const sentCutoffs = [];
  const updates = [];
  const accept = (candidate, result) => {
    if (covered.has(candidate.signature)) duplicates.push(candidate.signature);
    covered.set(candidate.signature, result);
  };
  let evaluate;
  const client = {
    stop: vi.fn(),
    async call(message, progress) {
      if (message.type === 'init') {
        evaluate = createFoodOptimizerEvaluator(message.request, {
          collectThresholds: message.collectThresholds,
          sharedRounds: message.sharedRounds,
          items: message.items,
        });
        return;
      }
      if (message.candidate) sentCutoffs.push(message.costCutoff);
      return evaluate(message.candidate, message.deathBudget, progress, message.reusableSamples, message.costCutoff);
    },
  };
  // The in-process engine temporarily installs a seeded Math.random. Keep this
  // independent comparison serial; the benchmark uses isolated real workers.
  const report = await createFoodOptimizerSearch({
    ...fixture,
    request,
    workerLimit: 1,
    workerFactory: () => client,
    onUpdate(report, progress) {
      updates.push({ report, progress });
    },
    onCoverage(coverage) {
      if (coverage.candidate) accept(coverage.candidate, coverage.result);
      else
        for (const candidate of generateFoodOptimizerCompositionCandidates(coverage.items)) {
          if (candidate.signature === coverage.excludedSignature) continue;
          accept(candidate, materializeFoodOptimizerOutcome(coverage.evidence, candidate));
        }
    },
  }).done;
  expect(report.status, report.error).toBe('completed');
  expect(report.complete).toBe(true);
  expect(duplicates).toEqual([]);
  expect(client.stop).toHaveBeenCalled();
  expect(updates.at(-1).progress.progress).toBe(1);
  expect(
    updates.every(({ progress }, index) => index === 0 || progress.progress >= updates[index - 1].progress.progress),
  ).toBe(true);
  return { report, covered, sentCutoffs };
}

export const topTenScenarios = [
  { name: 'zone with three slots', foodSlots: 3 },
  {
    name: 'equipped ordinary zone with a bounded priority neighborhood',
    foodSlots: 3,
    intelligenceLevel: 30,
    equipped: 'active',
  },
  {
    name: 'ordinary zone with feasible defaults, MP demand and app seeds',
    foodSlots: 3,
    intelligenceLevel: 30,
    feasibleDefaults: true,
    seeds: Array.from({ length: 3 }, (_, index) => (0x4d574946 + Math.imul(index, 0x9e3779b9)) >>> 0),
  },
  {
    name: 'ordinary zone requiring HP food but no mana',
    foodSlots: 3,
    intelligenceLevel: 30,
    staminaLevel: 30,
    zoneHrid: '/actions/combat/snake',
    noManaUse: true,
    equippedHpThreshold: 80,
  },
  { name: 'dungeon', target: 'dungeon', foodSlots: 2 },
  { name: 'equipped dungeon baseline with inactive food', target: 'dungeon', foodSlots: 2, equipped: 'inactive' },
  {
    name: 'equipped dungeon baseline with a stricter death budget',
    target: 'dungeon',
    foodSlots: 2,
    equipped: 'active',
  },
  {
    name: 'HP pressure without mana-consuming abilities',
    target: 'dungeon',
    foodSlots: 3,
    noManaUse: true,
    seconds: 120,
    rounds: 2,
    thresholdStepPercent: 50,
  },
  {
    name: 'second player and a finite combat scroll',
    foodSlots: 2,
    party: true,
    activePlayerId: '2',
    scrolls: true,
    seconds: 1801,
    rounds: 2,
    thresholdStepPercent: 50,
  },
  {
    name: 'all foods with one slot',
    foodSlots: 1,
    fullCatalog: true,
    seconds: 600,
    rounds: 2,
    thresholdStepPercent: 25,
  },
  {
    name: 'zero-cost ties from entirely unused food',
    foodSlots: 3,
    noManaUse: true,
    unusedDomain: true,
    rounds: 2,
    thresholdStepPercent: 50,
  },
  {
    // 产品默认口径（1 轮 + app 的第 0 个种子 0x4d574946）也要与穷举 oracle 逐候选
    // 一致：rounds=1 时没有跨轮成本下界可用，剪枝只能来自轮内早期停止与排名界，
    // 正是最容易出偏差的路径。
    name: 'single round at the product default',
    foodSlots: 2,
    seconds: 600,
    rounds: 1,
    thresholdStepPercent: 25,
    expectPruned: true,
    seeds: [0x4d574946],
  },
  {
    name: 'wrapped and nonconsecutive seeds',
    foodSlots: 2,
    seconds: 240,
    rounds: 3,
    thresholdStepPercent: 50,
    seeds: [0xffffffff, 0x100000000, 17],
  },
];

// 场景名过滤：子测试文件按名取子集；场景字面量只保留在本文件一份，防多处副本口径分叉。
export function topTenScenariosFor(names) {
  const picked = topTenScenarios.filter((scenario) => names.includes(scenario.name));
  if (picked.length !== names.length) throw new Error(`Unknown topTen scenario name(s): ${names.join(' / ')}`);
  return picked;
}

export async function runTopTenScenario(scenario) {
  const fixture = createFoodOptimizerFixture(scenario);
  if (scenario.seeds) fixture.request.seeds = scenario.seeds;
  if (scenario.equipped) {
    const foods = fixture.items.filter((item) =>
      ['/items/blueberry_cake', '/items/star_fruit_yogurt'].includes(item.hrid),
    );
    const equipped =
      scenario.equipped === 'inactive'
        ? buildFoodCandidate(foods.map((item) => ({ ...item, threshold: Number.MAX_SAFE_INTEGER })))
        : buildFoodDefaultCandidate(foods);
    fixture.request.payload.players.find((player) => player.hrid === `player${fixture.request.activePlayerId}`).food =
      Array.from({ length: 3 }, (_, index) =>
        equipped.food[index]
          ? { hrid: equipped.food[index], triggers: equipped.triggerMap[equipped.food[index]] }
          : null,
      );
  }
  const baseline = await referenceResult(fixture.request, null);
  if (scenario.feasibleDefaults) expect(baseline.ranOutOfMana).toBe(true);
  if (scenario.equippedHpThreshold) {
    expect(baseline.deaths).toBe(0);
    expect(baseline.costPerHour).toBeGreaterThan(0);
  }
  if (scenario.equipped) expect(baseline.costPerHour > 0).toBe(scenario.equipped === 'active');
  if (scenario.noManaUse && scenario.target === 'dungeon') expect(baseline.deaths).toBeGreaterThan(0);
  const expected = new Map();
  const feasible = [];
  for (const candidate of generateFoodOptimizerCandidates(fixture.items, fixture.foodSlots)) {
    expect(expected.has(candidate.signature)).toBe(false);
    const result = await referenceResult(fixture.request, candidate, baseline.deaths);
    expected.set(candidate.signature, { ...candidate, ...result });
    if (result.feasible) feasible.push({ ...candidate, ...result });
  }
  feasible.sort(compareFoodOptimizerResults);
  if (scenario.feasibleDefaults || scenario.equippedHpThreshold) {
    expect(expected.get('').feasible).toBe(false);
    expect(feasible[0].costPerHour).toBeGreaterThan(0);
  }
  // 少带食物必须严格更少死：'inactive' 基线的 2 件食物阈值在上限、从不触发，空方案与基线
  // 同轨迹同死亡数，却只带 0 槽（< 基线 2 槽）⇒ 空方案按死亡预算淘汰，不再与基线并列入榜。
  if (scenario.equipped) expect(expected.get('').feasible).toBe(false);
  if (scenario.equipped === 'inactive') {
    expect(expected.get('').deaths).toBe(baseline.deaths);
    expect(expected.get('').rejected).toBe('deaths');
  }
  if (scenario.noManaUse && scenario.target === 'dungeon')
    expect(
      [...expected.values()].some((result) =>
        result.samples.some((sample) =>
          fixture.items.some((food) => food.kind === 'hp' && sample.foodUsed[food.hrid] > 0),
        ),
      ),
    ).toBe(true);
  const expectedTop = rankedPhysical(feasible.slice(0, 10));
  expect(expected.size).toBe(countFoodOptimizerCandidates(fixture.items, fixture.foodSlots));

  for (const mode of ['complete', 'top10']) {
    const { report, covered, sentCutoffs } = await runSearch(fixture, mode);
    if (scenario.feasibleDefaults) expect(report.stats.passedCompositions).toBeGreaterThan(0);
    expect(new Set(covered.keys())).toEqual(new Set(expected.keys()));
    expect(physicalFoodOptimizerResult(report.baseline)).toEqual(physicalFoodOptimizerResult(baseline));
    expect(rankedPhysical(report.topResults)).toEqual(expectedTop);
    expect(report.topResults.every((result) => result.feasible === true && !result.pruned)).toBe(true);

    let pruned = 0;
    let knownFeasible = 0;
    let rejectedMana = 0;
    let rejectedDeaths = 0;
    for (const [signature, result] of covered) {
      const oracle = expected.get(signature);
      if (result.pruned === 'cost' || result.pruned === 'rank') {
        pruned += 1;
        expect(mode).toBe('top10');
        expect(result.feasible).toBeNull();
        expect(result.rejected).toBe('');
        expect(expectedTop.some((entry) => entry.signature === signature)).toBe(false);
        // Feasible candidates with equal cost can still lose on deaths,
        // slot count, or signature. Check the full ordering independently.
        if (oracle.feasible) {
          expect(feasible.length).toBeGreaterThanOrEqual(10);
          expect(compareFoodOptimizerResults(oracle, feasible[9])).toBeGreaterThan(0);
        }
      } else {
        expect(physicalFoodOptimizerResult(result)).toEqual(physicalFoodOptimizerResult(oracle));
        if (result.feasible) knownFeasible += 1;
        else if (result.rejected === 'mana') rejectedMana += 1;
        else if (result.rejected === 'deaths') rejectedDeaths += 1;
        else throw new Error(`Candidate has no final classification: ${signature}`);
      }
    }
    const stats = report.stats;
    expect(stats.prunedCandidates).toBe(pruned);
    expect(stats.feasibleCandidates).toBe(knownFeasible);
    expect(stats.rejectedMana).toBe(rejectedMana);
    expect(stats.rejectedDeaths).toBe(rejectedDeaths);
    expect(stats.totalCandidates).toBe(expected.size);
    expect(stats.completedCandidates).toBe(expected.size);
    expect(stats.simulatedCandidates + stats.reusedCandidates + stats.skippedCandidates + pruned).toBe(expected.size);
    expect(knownFeasible + rejectedMana + rejectedDeaths + pruned).toBe(expected.size);
    expect(knownFeasible).toBeLessThanOrEqual(feasible.length);
    expect(knownFeasible + pruned).toBeGreaterThanOrEqual(feasible.length);
    expect(stats.completedRounds).toBeLessThanOrEqual(stats.maxSimulationRounds);
    if (mode === 'complete') {
      expect(pruned).toBe(0);
      expect(knownFeasible).toBe(feasible.length);
      expect(sentCutoffs.every((cutoff) => cutoff == null || cutoff === Infinity)).toBe(true);
    } else if (scenario.name === 'dungeon' || scenario.expectPruned) {
      expect(pruned).toBeGreaterThan(0);
    }
    if (scenario.expectPruned) {
      // 非空保证：前 10 名必须真实存在，否则与 oracle 的比较是空对空。
      expect(feasible.length).toBeGreaterThanOrEqual(10);
      expect(report.topResults).toHaveLength(10);
    }
    if (mode === 'top10' && scenario.equipped === 'inactive') {
      // 改造前：空方案（0 槽）与 inactive 基线同轨迹，复用它即可立刻建立 0 成本排名下界。
      // 改造后：空方案少带食物却不多死，先被死亡预算淘汰，下界只能由真实候选逐步建立。
      expect(sentCutoffs[0]).toBeUndefined();
      expect(sentCutoffs.slice(1, 10)).not.toContain(0);
    }
    if (scenario.unusedDomain) {
      if (mode === 'complete') expect(pruned).toBe(0);
      expect(stats.completedRounds).toBe(fixture.request.rounds);
      expect(report.topResults.every((result) => result.costPerHour === 0)).toBe(true);
    }
  }
}

export async function runSearchModeEquivalence() {
  const fixture = createFoodOptimizerFixture({ foodSlots: 2, seconds: 120, rounds: 2, thresholdStepPercent: 50 });
  const implicit = await runSearch(fixture);
  const complete = await runSearch(fixture, 'complete');
  // 引擎把缺失解析为完整搜索并写回 request，报告因此自描述实际执行的模式。
  expect(implicit.report.request.searchMode).toBe('complete');
  expect(implicit.report.stats).toEqual(complete.report.stats);
  expect(implicit.report.stats.prunedCandidates).toBe(0);
  expect(rankedPhysical(implicit.report.topResults)).toEqual(rankedPhysical(complete.report.topResults));
  expect(physicalFoodOptimizerResult(implicit.report.baseline)).toEqual(
    physicalFoodOptimizerResult(complete.report.baseline),
  );
  expect([...implicit.covered].map(([signature, result]) => [signature, physicalFoodOptimizerResult(result)])).toEqual(
    [...complete.covered].map(([signature, result]) => [signature, physicalFoodOptimizerResult(result)]),
  );
}
