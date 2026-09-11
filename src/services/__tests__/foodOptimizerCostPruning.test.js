import { describe, expect, it, vi } from 'vitest';
import CombatSimulator from '../../combatsimulator/combatSimulator.js';
import { buildFoodCandidate, computeFoodCostPerHour } from '../foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import {
  createFoodOptimizerEvaluator,
  evaluateFoodOptimizerCandidate,
  simulateFoodOptimizerRound,
} from '../foodOptimizerSimulation.js';
import { createFoodOptimizerFixture } from './support/foodOptimizerTestSupport.js';

const HRID = '/items/gummy';
const TIME_LIMIT = 600e9;
const range = (min = 1, max = 100) => [{ hrid: HRID, kind: 'mp', min, max }];
const candidate = buildFoodCandidate([{ hrid: HRID, kind: 'mp', threshold: 50, restore: 40, price: 10 }]);
const inputFor = (rounds = 3) => ({
  searchMode: 'top10',
  rounds,
  seeds: Array.from({ length: rounds }, (_, index) => index + 1),
  payload: { simulationTimeLimit: TIME_LIMIT },
});
const complete = (seed, costPerHour, overrides = {}) => ({
  seed,
  deaths: 0,
  ranOutOfMana: false,
  foodUsed: { [HRID]: 2 },
  costPerHour,
  equivalentThresholds: range(),
  unusedFoodThresholds: null,
  inactiveFoodThresholds: { hp: 21, mp: 31 },
  stoppedEarly: false,
  simulatedTime: TIME_LIMIT,
  ...overrides,
});

describe('food optimizer cost pruning between rounds', () => {
  it('stops an expensive prefix without claiming feasibility and retains its complete rounds', async () => {
    const samples = [
      complete(1, 120, { equivalentThresholds: range(10, 80) }),
      complete(2, 60, { equivalentThresholds: range(30, 90) }),
    ];
    const simulate = vi.fn().mockResolvedValueOnce(samples[0]).mockResolvedValueOnce(samples[1]);
    const roundCache = { match: vi.fn(() => null), record: vi.fn() };
    const progress = vi.fn();
    const result = await evaluateFoodOptimizerCandidate(inputFor(), candidate, 0, progress, simulate, {
      costCutoff: 50,
      roundCache,
    });
    expect(result).toMatchObject({
      pruned: 'cost',
      feasible: null,
      rejected: '',
      ranOutOfMana: false,
      costPerHour: null,
      costLowerBound: 60,
      roundsCompleted: 2,
      simulatedRounds: 2,
      reusedRounds: 0,
      equivalentThresholds: range(30, 80),
      unusedFoodThresholds: null,
    });
    expect(result.samples).toEqual(samples);
    expect(simulate.mock.calls.map((call) => call[5])).toEqual([
      { collectThresholds: true, costBound: { cutoff: 50, completedCostPerHour: 0, totalRounds: 3 } },
      { collectThresholds: true, costBound: { cutoff: 50, completedCostPerHour: 120, totalRounds: 3 } },
    ]);
    expect(roundCache.record.mock.calls).toEqual(samples.map((sample) => [sample.seed, candidate, sample]));
    expect(progress).toHaveBeenLastCalledWith({
      round: 2,
      progress: 0,
      simulatedRounds: 2,
      reusedRounds: 0,
      pruned: 'cost',
    });
  });

  it('can stop after a cached prefix without running another round or mutating the sample', async () => {
    const sample = Object.freeze(complete(1, 180));
    const roundCache = createFoodOptimizerRoundCache();
    roundCache.record(1, candidate, sample);
    const simulate = vi.fn();
    const result = await evaluateFoodOptimizerCandidate(inputFor(), candidate, 0, undefined, simulate, {
      costCutoff: 50,
      roundCache,
    });
    expect(result).toMatchObject({
      pruned: 'cost',
      feasible: null,
      costLowerBound: 60,
      simulatedRounds: 0,
      reusedRounds: 1,
      roundsCompleted: 1,
    });
    expect(simulate).not.toHaveBeenCalled();
    expect(sample).not.toHaveProperty('pruned');
    expect(roundCache.match(1, candidate)).toEqual(sample);
  });

  it('intersects every consumed prefix and never records an unfinished cost sample as a complete round', async () => {
    const first = complete(1, 90, { equivalentThresholds: range(10, 90) });
    const partial = complete(2, 0, {
      pruned: 'cost',
      costLowerBound: 70,
      stoppedEarly: true,
      simulatedTime: 150e9,
      equivalentThresholds: range(20, 100),
    });
    const simulate = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(partial);
    const roundCache = { match: vi.fn(() => null), record: vi.fn() };
    const result = await evaluateFoodOptimizerCandidate(inputFor(), candidate, 0, undefined, simulate, {
      costCutoff: 50,
      roundCache,
    });
    expect(result).toMatchObject({
      pruned: 'cost',
      feasible: null,
      rejected: '',
      costLowerBound: 70,
      equivalentThresholds: range(20, 90),
      simulatedRounds: 2,
      reusedRounds: 0,
    });
    expect(result.samples).toEqual([first, partial]);
    expect(roundCache.record).toHaveBeenCalledTimes(1);
    expect(roundCache.record).toHaveBeenCalledWith(1, candidate, first);
    expect(simulate.mock.calls[1][5].costBound.completedCostPerHour).toBe(90);
  });

  it.each([
    ['mana', { ranOutOfMana: true }],
    ['deaths', { deaths: 1 }],
  ])('preserves genuine %s failure before considering the cost bound', async (reason, failure) => {
    const simulate = vi.fn().mockResolvedValue(complete(1, 1000, failure));
    const result = await evaluateFoodOptimizerCandidate(inputFor(), candidate, 0, undefined, simulate, {
      costCutoff: 0,
    });
    expect(result).toMatchObject({ feasible: false, rejected: reason, roundsCompleted: 1 });
    expect(result).not.toHaveProperty('pruned');
  });

  it('keeps a completed final round feasible even when its cost exceeds the incumbent', async () => {
    const simulate = vi.fn().mockResolvedValueOnce(complete(1, 0)).mockResolvedValueOnce(complete(2, 1000));
    const result = await evaluateFoodOptimizerCandidate(inputFor(2), candidate, 0, undefined, simulate, {
      costCutoff: 0,
    });
    expect(result).toMatchObject({ feasible: true, costPerHour: 500, roundsCompleted: 2 });
    expect(result).not.toHaveProperty('pruned');
  });

  it('keeps exact and near ties and preserves ordinary sample-order arithmetic', async () => {
    const samples = [complete(1, 0.1), complete(2, 0.2), complete(3, 0)];
    const simulate = vi.fn();
    for (const sample of samples) simulate.mockResolvedValueOnce(sample);
    const result = await evaluateFoodOptimizerCandidate(inputFor(), candidate, 0, undefined, simulate, {
      costCutoff: 0.1,
    });
    expect(result).toMatchObject({ feasible: true, costPerHour: (0.1 + 0.2 + 0) / 3, roundsCompleted: 3 });
    expect(result).not.toHaveProperty('pruned');
  });

  it('does not add cost controls in complete mode, without a cutoff, or for the baseline', async () => {
    for (const [request, selected, options] of [
      [{ ...inputFor(), searchMode: undefined }, candidate, { costCutoff: 0 }],
      [{ ...inputFor(), searchMode: 'complete' }, candidate, { costCutoff: 0 }],
      [inputFor(), candidate, {}],
      [inputFor(), candidate, { costCutoff: Infinity }],
      [inputFor(), null, { costCutoff: 0 }],
    ]) {
      const simulate = vi.fn((input, food, seed) => Promise.resolve(complete(seed, 1000)));
      const result = await evaluateFoodOptimizerCandidate(request, selected, 0, undefined, simulate, options);
      expect(result).toMatchObject({ feasible: true, costPerHour: 1000, roundsCompleted: 3 });
      expect(result).not.toHaveProperty('pruned');
      expect(simulate.mock.calls.map((call) => call[5])).toEqual(Array(3).fill({ collectThresholds: true }));
    }
  });
});

describe('food optimizer in-round cost pruning', () => {
  function foodFixture() {
    const fixture = createFoodOptimizerFixture({ foodSlots: 1, seconds: 600, rounds: 3 });
    fixture.request.searchMode = 'top10';
    const food = fixture.items.find((entry) => entry.hrid === '/items/star_fruit_yogurt');
    return { ...fixture, candidate: buildFoodCandidate([{ ...food, threshold: food.thresholds.at(-1) }]) };
  }

  it('stops after real food consumption with an identical event/RNG prefix and a full-duration cost bound', async () => {
    const { request, candidate } = foodFixture();
    const originalRandom = Math.random;
    const nativeSimulate = CombatSimulator.prototype.simulate;
    const nativeProcess = CombatSimulator.prototype.processEvent;
    const runs = [];
    let currentRun;
    const simulateSpy = vi.spyOn(CombatSimulator.prototype, 'simulate').mockImplementation(async function (...args) {
      const seededRandom = Math.random;
      currentRun = { events: [], random: [] };
      const run = currentRun;
      runs.push(run);
      Math.random = () => {
        const value = seededRandom();
        run.random.push(value);
        return value;
      };
      try {
        return await nativeSimulate.apply(this, args);
      } finally {
        Math.random = seededRandom;
      }
    });
    const processSpy = vi.spyOn(CombatSimulator.prototype, 'processEvent').mockImplementation(function (event) {
      const result = nativeProcess.call(this, event);
      currentRun.events.push({
        type: event.type,
        time: event.time,
        source: event.source?.hrid,
        target: event.target?.hrid,
        resources: this.players.map((player) => [
          player.combatDetails.currentHitpoints,
          player.combatDetails.currentManapoints,
        ]),
      });
      return result;
    });
    try {
      const full = await simulateFoodOptimizerRound(request, candidate, 1);
      const partial = await simulateFoodOptimizerRound(request, candidate, 1, undefined, Infinity, {
        costBound: { cutoff: 0, completedCostPerHour: 0, totalRounds: request.rounds },
      });
      expect(full).toMatchObject({ stoppedEarly: false, ranOutOfMana: false });
      expect(partial).toMatchObject({ pruned: 'cost', stoppedEarly: true, ranOutOfMana: false, costPerHour: 0 });
      expect(partial.simulatedTime).toBeLessThan(request.payload.simulationTimeLimit);
      expect(partial.foodUsed[candidate.food[0]]).toBeGreaterThan(0);
      expect(partial.costLowerBound).toBe(
        computeFoodCostPerHour(
          partial.foodUsed,
          request.prices.priceTable,
          request.prices.consumableMode,
          request.payload.simulationTimeLimit,
        ) / request.rounds,
      );
      expect(partial.costLowerBound).toBeLessThanOrEqual(full.costPerHour / request.rounds);
      expect(partial.equivalentThresholds[0]).toMatchObject({ hrid: candidate.food[0], kind: 'mp' });
      expect(runs[1].events).toEqual(runs[0].events.slice(0, runs[1].events.length));
      expect(runs[1].random).toEqual(runs[0].random.slice(0, runs[1].random.length));
      expect(Math.random).toBe(originalRandom);
    } finally {
      simulateSpy.mockRestore();
      processSpy.mockRestore();
    }
  });

  it('forwards evaluator cutoffs while leaving a baseline and complete-mode round unchanged', async () => {
    const { request, candidate } = foodFixture();
    const evaluate = createFoodOptimizerEvaluator(request);
    const result = await evaluate(candidate, Infinity, undefined, [], 0);
    expect(result).toMatchObject({ pruned: 'cost', feasible: null, rejected: '', simulatedRounds: 1 });

    const ordinaryRequest = { ...request, searchMode: 'complete' };
    const ordinary = await simulateFoodOptimizerRound(ordinaryRequest, candidate, 1);
    const withIgnoredBound = await simulateFoodOptimizerRound(ordinaryRequest, candidate, 1, undefined, Infinity, {
      costBound: { cutoff: 0, completedCostPerHour: 0, totalRounds: 3 },
    });
    expect(withIgnoredBound).toEqual(ordinary);
    const baseline = await simulateFoodOptimizerRound(request, null, 1, undefined, 0, {
      costBound: { cutoff: 0, completedCostPerHour: 1000, totalRounds: 3 },
    });
    expect(baseline).toMatchObject({ stoppedEarly: false, simulatedTime: request.payload.simulationTimeLimit });
    expect(baseline).not.toHaveProperty('pruned');
  });

  it.each(['mana', 'deaths'])('gives a same-event %s failure priority over a crossed cost bound', async (failure) => {
    const { request, candidate } = foodFixture();
    const nativeUse = CombatSimulator.prototype.tryUseConsumable;
    const useSpy = vi.spyOn(CombatSimulator.prototype, 'tryUseConsumable').mockImplementation(function (unit, food) {
      const consumed = nativeUse.call(this, unit, food);
      if (consumed && unit.hrid === 'player1' && unit.food.includes(food)) {
        if (failure === 'mana') this.simResult.playerRanOutOfMana[unit.hrid] = true;
        else this.simResult.deaths[unit.hrid] = 1;
      }
      return consumed;
    });
    try {
      const partial = await simulateFoodOptimizerRound(request, candidate, 1, undefined, 0, {
        costBound: { cutoff: 0, completedCostPerHour: 0, totalRounds: 3 },
      });
      expect(partial).toMatchObject({ stoppedEarly: true });
      expect(partial.foodUsed[candidate.food[0]]).toBeGreaterThan(0);
      expect(partial).not.toHaveProperty('pruned');
      expect(partial).not.toHaveProperty('costLowerBound');
      if (failure === 'mana') expect(partial.ranOutOfMana).toBe(true);
      else expect(partial.deaths).toBe(1);
    } finally {
      useSpy.mockRestore();
    }
  });
});
