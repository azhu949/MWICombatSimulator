import { expect, vi } from 'vitest';
import {
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../../foodOptimizerDomain.js';
import { createFoodOptimizerSearch } from '../../foodOptimizerSearch.js';
import { createFoodOptimizerEvaluator, evaluateFoodOptimizerCandidate } from '../../foodOptimizerSimulation.js';
import { materializeFoodOptimizerOutcome } from '../../foodOptimizerPruning.js';
import {
  createFoodOptimizerFixture,
  physicalFoodOptimizerResult,
  referenceFoodOptimizerRound,
} from './foodOptimizerTestSupport.js';

export const pruningScenarios = [
  { name: 'zone', target: 'zone', foodSlots: 2 },
  { name: 'dungeon', target: 'dungeon', foodSlots: 2 },
  { name: 'three-slot zone', target: 'zone', foodSlots: 3 },
  { name: 'single-slot dungeon', target: 'dungeon', foodSlots: 1 },
  {
    name: 'party with scroll expiration and the second player as target',
    target: 'zone',
    foodSlots: 2,
    party: true,
    activePlayerId: '2',
    scrolls: true,
    seconds: 1801,
    rounds: 2,
    thresholdStepPercent: 50,
  },
  {
    name: 'entire food catalog',
    target: 'zone',
    foodSlots: 1,
    fullCatalog: true,
    rounds: 2,
    thresholdStepPercent: 25,
  },
  {
    name: 'no mana-consuming abilities',
    target: 'zone',
    foodSlots: 3,
    noManaUse: true,
    rounds: 2,
    thresholdStepPercent: 50,
  },
];

// 场景名过滤：子测试文件按名取子集；场景字面量只保留在本文件一份，防多处副本口径分叉。
export function pruningScenariosFor(names) {
  const picked = pruningScenarios.filter((scenario) => names.includes(scenario.name));
  if (picked.length !== names.length) throw new Error(`Unknown pruning scenario name(s): ${names.join(' / ')}`);
  return picked;
}

export async function runPruningScenario(scenario) {
  const { request, items, foodSlots } = createFoodOptimizerFixture(scenario);
  const baseline = await evaluateFoodOptimizerCandidate(
    request,
    null,
    undefined,
    undefined,
    referenceFoodOptimizerRound,
  );
  const expected = new Map();
  const ranked = [];
  for (const candidate of generateFoodOptimizerCandidates(items, foodSlots)) {
    const result = await evaluateFoodOptimizerCandidate(
      request,
      candidate,
      baseline.deaths,
      undefined,
      referenceFoodOptimizerRound,
    );
    expected.set(candidate.signature, physicalFoodOptimizerResult(result));
    if (result.feasible) ranked.push({ ...candidate, ...result });
  }
  ranked.sort(compareFoodOptimizerResults);
  const covered = new Map();
  const duplicates = [];
  const accept = (candidate, result) => {
    if (covered.has(candidate.signature)) duplicates.push(candidate.signature);
    covered.set(candidate.signature, physicalFoodOptimizerResult(result));
  };
  let evaluate;
  const client = {
    stop: vi.fn(),
    async call(message, progress) {
      if (message.type === 'init') {
        evaluate = createFoodOptimizerEvaluator(request, {
          collectThresholds: message.collectThresholds,
          sharedRounds: message.sharedRounds,
          items: message.items,
        });
        return;
      }
      return evaluate(message.candidate, message.deathBudget, progress, message.reusableSamples);
    },
  };
  // Browser workers have isolated RNGs. One in-process client keeps this oracle
  // comparison isolated too; separate pool tests exercise concurrent dispatch.
  const report = await createFoodOptimizerSearch({
    request,
    items,
    foodSlots,
    workerLimit: 1,
    workerFactory: () => client,
    onCoverage(coverage) {
      if (coverage.candidate) {
        accept(coverage.candidate, coverage.result);
        return;
      }
      for (const candidate of generateFoodOptimizerCompositionCandidates(coverage.items)) {
        if (candidate.signature === coverage.excludedSignature) continue;
        accept(candidate, materializeFoodOptimizerOutcome(coverage.evidence, candidate));
      }
    },
  }).done;
  expect(report.status, report.error).toBe('completed');
  expect(duplicates).toEqual([]);
  expect(covered).toEqual(expected);
  expect(report.stats.feasibleCandidates).toBe(ranked.length);
  expect(
    report.topResults.map((result) => ({
      signature: result.signature,
      result: physicalFoodOptimizerResult(result),
    })),
  ).toEqual(
    ranked.slice(0, 10).map((result) => ({ signature: result.signature, result: physicalFoodOptimizerResult(result) })),
  );
  expect(report.stats.completedCandidates).toBe(expected.size);
  expect(report.stats.simulatedCandidates + report.stats.skippedCandidates + report.stats.reusedCandidates).toBe(
    expected.size,
  );
  expect(report.stats.feasibleCandidates + report.stats.rejectedMana + report.stats.rejectedDeaths).toBe(expected.size);
  expect(report.stats.completedRounds).toBeLessThanOrEqual(report.stats.maxSimulationRounds);
  expect(report.stats.reusedCandidates + report.stats.skippedCandidates).toBeGreaterThan(0);
  if (scenario.noManaUse) {
    expect(report.stats.simulatedCandidates).toBe(0);
    expect(report.stats.completedRounds).toBe(request.rounds);
    expect(report.stats.reusedCandidates).toBe(expected.size);
  }
  expect(client.stop).toHaveBeenCalled();
}
