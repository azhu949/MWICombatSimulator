import { describe, expect, it, vi } from 'vitest';
import {
  computeFoodOptimizerCostLowerBound,
  getFoodOptimizerCostCutoff,
  isFoodOptimizerCostAboveCutoff,
  observeFoodOptimizerCostBound,
} from '../foodOptimizerCostBound.js';
import { computeFoodCostPerHour } from '../foodOptimizerDomain.js';

const GUMMY = '/items/gummy';
const DONUT = '/items/donut';
const TIME_LIMIT = 600e9;

describe('food optimizer cost lower bounds', () => {
  it('requires an explicitly enabled candidate and a finite nonnegative cutoff', () => {
    const request = { searchMode: 'top10', rounds: 3 };
    expect(getFoodOptimizerCostCutoff(request, {}, 0)).toBe(0);
    expect(getFoodOptimizerCostCutoff(request, {}, 25)).toBe(25);
    expect(getFoodOptimizerCostCutoff(request, null, 0)).toBeNull();
    for (const mode of [undefined, 'complete', 'invalid'])
      expect(getFoodOptimizerCostCutoff({ ...request, searchMode: mode }, {}, 0)).toBeNull();
    for (const cutoff of [undefined, null, '10', -1, NaN, Infinity])
      expect(getFoodOptimizerCostCutoff(request, {}, cutoff)).toBeNull();
    for (const rounds of [0, -1, 1.5, Infinity])
      expect(getFoodOptimizerCostCutoff({ ...request, rounds }, {}, 10)).toBeNull();
  });

  it('keeps equality and floating-point neighbours for the ordinary tie-breakers', () => {
    expect(isFoodOptimizerCostAboveCutoff(20, 20)).toBe(false);
    expect(isFoodOptimizerCostAboveCutoff(20 + Number.EPSILON * 20, 20)).toBe(false);
    expect(isFoodOptimizerCostAboveCutoff(1e16 + 2, 1e16)).toBe(false);
    expect(isFoodOptimizerCostAboveCutoff(20.001, 20)).toBe(true);
    expect(isFoodOptimizerCostAboveCutoff(1, 0)).toBe(true);
    for (const value of [null, undefined, NaN, Infinity, -1]) {
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
    expect(readCount).not.toHaveBeenCalled();

    simulator.tryUseConsumable(player, food);
    expect(observer.shouldStop()).toBe(false);
    expect(observer.read()).toBe(60);
    for (let event = 0; event < 100; event += 1) expect(observer.shouldStop()).toBe(false);
    expect(readCount).toHaveBeenCalledOnce();

    simulator.tryUseConsumable(player, food);
    expect(observer.shouldStop()).toBe(true);
    expect(observer.read()).toBe(80);
    expect(readCount).toHaveBeenCalledTimes(2);
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
