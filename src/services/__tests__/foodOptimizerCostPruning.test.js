import { describe, expect, it, vi } from 'vitest';
import CombatSimulator from '../../combatsimulator/combatSimulator.js';
import {
  computeFoodOptimizerCostLowerBound,
  getFoodOptimizerCostCutoff,
  isFoodOptimizerCostAboveCutoff,
  observeFoodOptimizerCostBound,
} from '../foodOptimizerCostBound.js';
import { buildFoodCandidate, computeFoodCostPerHour } from '../foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { evaluateFoodOptimizerCandidate, simulateFoodOptimizerRound } from '../foodOptimizerSimulation.js';
import { createFoodOptimizerFixture } from './support/foodOptimizerTestSupport.js';

const HRID = '/items/gummy';
const GUMMY = '/items/gummy';
const DONUT = '/items/donut';
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
    } finally {
      simulateSpy.mockRestore();
      processSpy.mockRestore();
    }
  });
});

describe('food optimizer cost lower bounds', () => {
  it('requires an explicitly enabled candidate and a finite nonnegative cutoff', () => {
    const request = { searchMode: 'top10', rounds: 3 };
    expect(getFoodOptimizerCostCutoff(request, {}, 0)).toBe(0);
    expect(getFoodOptimizerCostCutoff(request, {}, 25)).toBe(25);
    expect(getFoodOptimizerCostCutoff(request, null, 0)).toBeNull();
    for (const mode of ['complete', 'invalid'])
      expect(getFoodOptimizerCostCutoff({ ...request, searchMode: mode }, {}, 0)).toBeNull();
    for (const cutoff of [undefined, -1, NaN]) expect(getFoodOptimizerCostCutoff(request, {}, cutoff)).toBeNull();
    for (const rounds of [0, Infinity]) expect(getFoodOptimizerCostCutoff({ ...request, rounds }, {}, 10)).toBeNull();
  });

  it('keeps equality and floating-point neighbours for the ordinary tie-breakers', () => {
    expect(isFoodOptimizerCostAboveCutoff(20, 20)).toBe(false);
    expect(isFoodOptimizerCostAboveCutoff(20 + Number.EPSILON * 20, 20)).toBe(false);
    expect(isFoodOptimizerCostAboveCutoff(20.001, 20)).toBe(true);
    expect(isFoodOptimizerCostAboveCutoff(1, 0)).toBe(true);
    for (const value of [null, NaN, Infinity]) {
      expect(isFoodOptimizerCostAboveCutoff(value, 0)).toBe(false);
      expect(isFoodOptimizerCostAboveCutoff(10, value)).toBe(false);
    }
  });

  it('uses all requested rounds and preserves addition before division', () => {
    expect(computeFoodOptimizerCostLowerBound(120, 60, 3)).toBe(60);
    expect(computeFoodOptimizerCostLowerBound(1e16, 1, 3)).toBe((1e16 + 1) / 3);
    for (const values of [
      [-1, 0, 3],
      [0, NaN, 3],
      [0, 1, 0],
      [0, 1, 1.5],
      [1e308, 1e308, 3],
    ])
      expect(computeFoodOptimizerCostLowerBound(...values)).toBeNull();
  });

  it('updates only for successful food uses by the active player and divides by the full duration', () => {
    const food = { hrid: GUMMY };
    const drink = { hrid: '/items/coffee' };
    const player = { hrid: 'player1', food: [food] };
    const other = { hrid: 'player2', food: [food] };
    let count = 0;
    const readCount = vi.fn(() => count);
    const used = Object.defineProperty({}, GUMMY, { get: readCount });
    const simulator = {
      simulationTime: 1e9,
      simResult: { consumablesUsed: { player1: used } },
      tryUseConsumable: vi.fn((source, consumable, succeeds = true) => {
        if (succeeds && source === player && consumable === food) count += 1;
        return succeeds;
      }),
    };
    const request = {
      prices: { priceTable: { [GUMMY]: { ask: 10 } }, consumableMode: 'ask' },
      payload: { simulationTimeLimit: TIME_LIMIT },
    };
    const observer = observeFoodOptimizerCostBound(simulator, player, request, {
      cutoff: 70,
      completedCostPerHour: 120,
      totalRounds: 3,
    });
    expect(observer.shouldStop()).toBe(false);
    expect(observer.read()).toBe(40);
    simulator.tryUseConsumable(other, food);
    simulator.tryUseConsumable(player, drink);
    simulator.tryUseConsumable(player, food, false);
    expect(observer.shouldStop()).toBe(false);

    simulator.tryUseConsumable(player, food);
    expect(observer.shouldStop()).toBe(false);
    expect(observer.read()).toBe(60);

    simulator.tryUseConsumable(player, food);
    expect(observer.shouldStop()).toBe(true);
    expect(observer.read()).toBe(80);
  });

  it('recomputes in sample slot order instead of summing uses in consumption order', () => {
    const foods = [{ hrid: GUMMY }, { hrid: DONUT }];
    const player = { hrid: 'player1', food: foods };
    const used = {};
    const simulator = {
      simResult: { consumablesUsed: { player1: used } },
      tryUseConsumable(source, consumable) {
        used[consumable.hrid] = (used[consumable.hrid] || 0) + 1;
        return true;
      },
    };
    const request = {
      prices: { priceTable: { [GUMMY]: { ask: 1e16 }, [DONUT]: { ask: 1 } }, consumableMode: 'ask' },
      payload: { simulationTimeLimit: TIME_LIMIT },
    };
    const observer = observeFoodOptimizerCostBound(simulator, player, request, {
      cutoff: 1e18,
      completedCostPerHour: 17,
      totalRounds: 3,
    });
    simulator.tryUseConsumable(player, foods[1]);
    simulator.tryUseConsumable(player, foods[1]);
    observer.shouldStop();
    simulator.tryUseConsumable(player, foods[0]);
    observer.shouldStop();
    const sampleCost = computeFoodCostPerHour({ [GUMMY]: 1, [DONUT]: 2 }, request.prices.priceTable, 'ask', TIME_LIMIT);
    expect(observer.read()).toBe((17 + sampleCost) / 3);
  });
});
