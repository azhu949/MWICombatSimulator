import { describe, expect, it, vi } from 'vitest';
import { buildPlayersForSimulation } from '../playerMapper.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { buildFoodCandidate, buildFoodDefaultCandidate, getFoodOptimizerItems } from '../foodOptimizerDomain.js';
import {
  createFoodOptimizerRandom,
  createFoodOptimizerSimulation,
  createFoodOptimizerEvaluator,
  evaluateFoodOptimizerCandidate,
  getFoodOptimizerResources,
  simulateFoodOptimizerRound,
} from '../foodOptimizerSimulation.js';
import { dungeonOptions, labyrinthOptions } from '../../shared/gameDataIndex.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';

function request() {
  const player = createEmptyPlayerConfig(1);
  for (const key of Object.keys(player.levels)) player.levels[key] = 30;
  player.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
  return {
    activePlayerId: '1',
    rounds: 3,
    seeds: [1, 2, 3],
    prices: { priceTable: {}, consumableMode: 'ask' },
    payload: {
      players: structuredClone(buildPlayersForSimulation([player])),
      zone: { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
      labyrinth: null,
      extra: {},
      simulationTimeLimit: 120 * 1e9,
    },
  };
}
const sample = (deaths, ranOutOfMana = false, costPerHour = 10) => ({
  deaths,
  ranOutOfMana,
  costPerHour,
  foodUsed: { '/items/donut': 2 },
});

describe('food optimizer engine execution', () => {
  it('reproduces real engine results with the same seed and restores Math.random', async () => {
    const input = request();
    const original = Math.random;
    expect(Array.from({ length: 5 }, createFoodOptimizerRandom(1))).toEqual(
      Array.from({ length: 5 }, createFoodOptimizerRandom(1)),
    );
    const first = await simulateFoodOptimizerRound(input, null, 12345);
    const second = await simulateFoodOptimizerRound(input, null, 12345);
    expect(first).toEqual(second);
    expect(Math.random).toBe(original);
    const broken = request();
    broken.payload.zone.zoneHrid = '/invalid';
    await expect(simulateFoodOptimizerRound(broken, null, 12345)).rejects.toThrow();
    expect(Math.random).toBe(original);
  });

  it('uses initialized attributes in zone and dungeon contexts', () => {
    const input = request();
    for (const target of [
      { zone: input.payload.zone, labyrinth: null },
      { zone: { zoneHrid: dungeonOptions[0].hrid, difficultyTier: 0 }, labyrinth: null },
    ]) {
      Object.assign(input.payload, target);
      const resources = getFoodOptimizerResources(input);
      const simulator = createFoodOptimizerSimulation(input);
      simulator.simulationTimeLimit = input.payload.simulationTimeLimit;
      simulator.reset();
      simulator.startNewEncounter = () => {};
      simulator.processCombatStartEvent({ time: 0 });
      expect(resources.maxHp).toBe(simulator.players[0].combatDetails.maxHitpoints);
      expect(resources.maxMp).toBe(simulator.players[0].combatDetails.maxManapoints);
      expect(resources.foodSlots).toBe(1);
    }
  });

  it('uses a compact result object for optimizer simulations', async () => {
    const input = request();
    const simulator = createFoodOptimizerSimulation(input);
    await simulator.simulate(input.payload.simulationTimeLimit);
    expect(simulator.simResult).not.toHaveProperty('attacks');
    expect(simulator.simResult).not.toHaveProperty('experienceGained');
    expect(simulator.simResult).not.toHaveProperty('hitpointsGained');
    expect(simulator.simResult).toHaveProperty('deaths');
    expect(simulator.simResult).toHaveProperty('consumablesUsed');
    expect(simulator.simResult).toHaveProperty('scrollUsage');
  });

  it('rejects labyrinth requests before constructing or evaluating food simulations', async () => {
    const input = request();
    input.payload.labyrinth = { labyrinthHrid: labyrinthOptions[0].hrid, roomLevel: 40, crates: [] };
    const error = 'common:foodOptimizer.labyrinthUnsupported';
    const originalRandom = Math.random;
    expect(() => createFoodOptimizerSimulation(input)).toThrow(error);
    expect(() => getFoodOptimizerResources(input)).toThrow(error);
    expect(() => createFoodOptimizerEvaluator(input)).toThrow(error);
    const simulate = vi.fn();
    await expect(evaluateFoodOptimizerCandidate(input, null, 0, undefined, simulate)).rejects.toThrow(error);
    await expect(simulateFoodOptimizerRound(input, null, 1)).rejects.toThrow(error);
    expect(simulate).not.toHaveBeenCalled();
    expect(Math.random).toBe(originalRandom);
  });

  it('preserves the native instant and ongoing recovery behavior', async () => {
    const input = request();
    const items = getFoodOptimizerItems({ maxHp: 400, maxMp: 400, thresholdStepPercent: 10 });
    for (const kind of ['hp', 'mp'])
      for (const ongoing of [false, true]) {
        const food = items.find((entry) => entry.kind === kind && Boolean(entry.recoveryDuration) === ongoing);
        const candidate = buildFoodCandidate([{ ...food, threshold: 1 }]);
        const engine = createFoodOptimizerSimulation(input, candidate);
        expect(engine.players[0].food[0].recoveryDuration).toBe(food.recoveryDuration);
        engine.simulationTimeLimit = input.payload.simulationTimeLimit;
        engine.reset();
        engine.initializeCombatPlayers(0);
        const player = engine.players[0];
        const currentKey = kind === 'hp' ? 'currentHitpoints' : 'currentManapoints';
        const maxKey = kind === 'hp' ? 'maxHitpoints' : 'maxManapoints';
        const consumable = player.food[0];
        expect(consumable.shouldTrigger(0, player, null, engine.players, [])).toBe(false);
        player.combatDetails[currentKey] = player.combatDetails[maxKey] - 1;
        expect(consumable.shouldTrigger(0, player, null, engine.players, [])).toBe(true);
        player.combatDetails[currentKey] = 1;
        engine.tryUseConsumable(player, consumable);
        if (ongoing) {
          expect(player.combatDetails[currentKey]).toBe(1);
          engine.processConsumableTickEvent(engine.eventQueue.getNextEvent());
          expect(player.combatDetails[currentKey]).toBeGreaterThan(1);
        } else expect(player.combatDetails[currentKey]).toBe(1 + food.restore);
        const result = await simulateFoodOptimizerRound(input, candidate, 1);
        expect(result.foodUsed).toHaveProperty(food.hrid);
      }
  });

  it('avoids retaining per-round dungeon console output during exhaustive search', async () => {
    const input = request();
    input.payload.zone = { zoneHrid: dungeonOptions[0].hrid, difficultyTier: 0 };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await simulateFoodOptimizerRound(input, null, 1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('finds an earlier recovery threshold that avoids mana failure in the real engine', async () => {
    const input = request();
    input.payload.players[0].intelligenceLevel = 1;
    input.payload.simulationTimeLimit = 600 * 1e9;
    const resources = getFoodOptimizerResources(input);
    const food = getFoodOptimizerItems({ ...resources, thresholdStepPercent: 10 }).find(
      (item) => item.hrid === '/items/star_fruit_yogurt',
    );
    const defaultCandidate = buildFoodDefaultCandidate([food]);
    const earlyCandidate = buildFoodCandidate([{ ...food, threshold: food.thresholds.at(-1) }]);
    const failed = await simulateFoodOptimizerRound(input, defaultCandidate, 1);
    const rescued = await simulateFoodOptimizerRound(input, earlyCandidate, 1);
    expect(defaultCandidate.slots[0].threshold).toBe(Math.floor(resources.maxMp));
    expect(failed).toMatchObject({ ranOutOfMana: true, stoppedEarly: true });
    expect(failed.simulatedTime).toBeLessThan(input.payload.simulationTimeLimit);
    expect(rescued).toMatchObject({
      ranOutOfMana: false,
      stoppedEarly: false,
      simulatedTime: input.payload.simulationTimeLimit,
    });
    expect(rescued.foodUsed[food.hrid]).toBeGreaterThan(0);
  });

  it('ends a mana-failing candidate within the round while fully simulating the baseline', async () => {
    const input = request();
    input.payload.players[0].intelligenceLevel = 1;
    input.payload.simulationTimeLimit = 600 * 1e9;
    const baseline = await simulateFoodOptimizerRound(input, null, 1, undefined, 0);
    const candidate = await simulateFoodOptimizerRound(input, buildFoodCandidate([]), 1);
    expect(baseline).toMatchObject({
      ranOutOfMana: true,
      stoppedEarly: false,
      simulatedTime: input.payload.simulationTimeLimit,
    });
    expect(candidate).toMatchObject({ ranOutOfMana: true, stoppedEarly: true });
    expect(candidate.simulatedTime).toBeLessThan(baseline.simulatedTime);
    expect(candidate.simulatedTime).toBeGreaterThan(0);
  });

  it('ends the current round as soon as the remaining death budget is exceeded', async () => {
    const input = request();
    input.payload.simulationTimeLimit = 600 * 1e9;
    input.payload.zone = { zoneHrid: '/actions/combat/sorcerers_tower', difficultyTier: 4 };
    input.payload.players[0].abilities = [];
    const baseline = await simulateFoodOptimizerRound(input, null, 1, undefined, 0);
    const rejected = await simulateFoodOptimizerRound(input, buildFoodCandidate([]), 1, undefined, 0);
    expect(baseline).toMatchObject({ stoppedEarly: false, simulatedTime: input.payload.simulationTimeLimit });
    expect(baseline.deaths).toBeGreaterThan(1);
    expect(rejected).toMatchObject({ stoppedEarly: true, deaths: 1, ranOutOfMana: false });
    expect(rejected.simulatedTime).toBeLessThan(input.payload.simulationTimeLimit);
  });

  it('fully evaluates baseline even if it runs out of mana', async () => {
    const simulate = vi.fn().mockResolvedValue(sample(2, true));
    const result = await evaluateFoodOptimizerCandidate(request(), null, 0, () => {}, simulate);
    expect(result.deaths).toBe(6);
    expect(result.roundsCompleted).toBe(3);
    expect(simulate.mock.calls.map((call) => call[2])).toEqual([1, 2, 3]);
    expect(simulate.mock.calls.map((call) => call[4])).toEqual([Infinity, Infinity, Infinity]);
  });

  it('rejects at the first mana-failing round', async () => {
    const simulate = vi.fn().mockResolvedValueOnce(sample(0)).mockResolvedValueOnce(sample(0, true));
    const result = await evaluateFoodOptimizerCandidate(request(), buildFoodCandidate([]), 100, () => {}, simulate);
    expect(result).toMatchObject({ rejected: 'mana', feasible: false, roundsCompleted: 2 });
    expect(simulate).toHaveBeenCalledTimes(2);
  });

  it('compares cumulative deaths to the entire baseline, not individual rounds', async () => {
    const simulate = vi.fn().mockResolvedValue(sample(2));
    const result = await evaluateFoodOptimizerCandidate(request(), buildFoodCandidate([]), 3, () => {}, simulate);
    expect(result).toMatchObject({ rejected: 'deaths', feasible: false, deaths: 4, roundsCompleted: 2 });
    expect(simulate.mock.calls.map((call) => call[4])).toEqual([3, 1]);
    simulate.mockClear();
    const allowed = await evaluateFoodOptimizerCandidate(request(), buildFoodCandidate([]), 6, () => {}, simulate);
    expect(allowed).toMatchObject({ feasible: true, roundsCompleted: 3, costPerHour: 10 });
    expect(simulate.mock.calls.map((call) => call[4])).toEqual([6, 4, 2]);
  });

  it.each([
    [90, 0, 0],
    [120, 0, 0],
    [60, 70, 1000000],
  ])('classifies every valid candidate regardless of its cost (%s, %s, %s)', async (...costs) => {
    const simulate = vi.fn();
    for (const cost of costs) simulate.mockResolvedValueOnce(sample(0, false, cost));
    const result = await evaluateFoodOptimizerCandidate(request(), buildFoodCandidate([]), 0, undefined, simulate);
    expect(result).toMatchObject({ rejected: '', roundsCompleted: 3, feasible: true });
    expect(result.costPerHour).toBe(costs.reduce((sum, value) => sum + value, 0) / 3);
  });

  it('finishes an expensive feasible round and can disable observation without changing combat', async () => {
    const input = request();
    input.payload.players[0].intelligenceLevel = 1;
    input.payload.simulationTimeLimit = 600 * 1e9;
    input.prices.priceTable['/items/star_fruit_yogurt'] = { ask: 100 };
    const food = getFoodOptimizerItems({ ...getFoodOptimizerResources(input), thresholdStepPercent: 10 }).find(
      (entry) => entry.hrid === '/items/star_fruit_yogurt',
    );
    const candidate = buildFoodCandidate([{ ...food, threshold: food.thresholds.at(-1) }]);
    const observed = await simulateFoodOptimizerRound(input, candidate, 1);
    const plain = await simulateFoodOptimizerRound(input, candidate, 1, undefined, Infinity, {
      collectThresholds: false,
    });
    expect(observed).toMatchObject({
      stoppedEarly: false,
      ranOutOfMana: false,
      simulatedTime: input.payload.simulationTimeLimit,
    });
    expect(observed.costPerHour).toBeGreaterThan(0);
    expect(observed.equivalentThresholds).toHaveLength(1);
    expect(observed.equivalentThresholds[0].max).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(observed.inactiveFoodThresholds.hp).toBeGreaterThanOrEqual(1);
    expect(observed.inactiveFoodThresholds.mp).toBeGreaterThanOrEqual(1);
    expect({ ...observed, equivalentThresholds: null, inactiveFoodThresholds: null }).toEqual(plain);
  });

  it('creates isolated combat objects from deeply frozen DTOs without copying or mutating the snapshot', async () => {
    const input = request();
    input.payload.players[0].equipment['/equipment_types/pouch'] = { hrid: '/items/large_pouch', enhancementLevel: 0 };
    const original = structuredClone(input);
    const freeze = (value) => {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    };
    freeze(input);
    const food = getFoodOptimizerItems({ ...getFoodOptimizerResources(input), thresholdStepPercent: 25 })[0];
    const candidate = buildFoodDefaultCandidate([food]);
    const first = createFoodOptimizerSimulation(input, candidate);
    const second = createFoodOptimizerSimulation(input, candidate);
    first.players[0].abilities[0].level = 99;
    first.players[0].equipment['/equipment_types/pouch'].enhancementLevel = 5;
    first.players[0].food[0].lastUsed = 777;
    expect(second.players[0].abilities[0].level).toBe(1);
    expect(second.players[0].equipment['/equipment_types/pouch'].enhancementLevel).toBe(0);
    expect(second.players[0].food[0].lastUsed).not.toBe(777);
    await simulateFoodOptimizerRound(input, candidate, 1);
    await simulateFoodOptimizerRound(input, null, 2);
    expect(input).toEqual(original);
  });

  it('includes every earlier round in a cumulative death-failure certificate', async () => {
    const candidate = buildFoodCandidate([{ hrid: '/items/gummy', kind: 'mp', threshold: 50, restore: 40, price: 1 }]);
    const range = (min, max) => [{ hrid: '/items/gummy', kind: 'mp', min, max }];
    const simulate = vi
      .fn()
      .mockResolvedValueOnce({ ...sample(1), equivalentThresholds: range(30, 80) })
      .mockResolvedValueOnce({ ...sample(1), equivalentThresholds: range(10, 90) });
    const result = await evaluateFoodOptimizerCandidate(request(), candidate, 1, undefined, simulate);
    expect(result).toMatchObject({ rejected: 'deaths', roundsCompleted: 2, equivalentThresholds: range(30, 80) });
  });

  it('uses the failing seed alone to certify mana rejection while retaining earlier successful rounds', async () => {
    const input = request();
    input.rounds = 2;
    const makeCandidate = (threshold) =>
      buildFoodCandidate([{ hrid: '/items/gummy', kind: 'mp', threshold, restore: 40, price: 1 }]);
    const range = (min, max) => [{ hrid: '/items/gummy', kind: 'mp', min, max }];
    const completed = (seed, min, max) => ({
      ...sample(0),
      seed,
      stoppedEarly: false,
      simulatedTime: input.payload.simulationTimeLimit,
      equivalentThresholds: range(min, max),
    });
    const simulate = vi
      .fn()
      .mockResolvedValueOnce(completed(1, 30, 80))
      .mockResolvedValueOnce({
        ...completed(2, 1, 100),
        ranOutOfMana: true,
        stoppedEarly: true,
        unusedFoodThresholds: { hp: 26, mp: 51 },
      });
    const roundCache = createFoodOptimizerRoundCache();
    const result = await evaluateFoodOptimizerCandidate(input, makeCandidate(50), 0, undefined, simulate, {
      roundCache,
    });
    expect(result).toMatchObject({
      rejected: 'mana',
      roundsCompleted: 2,
      equivalentThresholds: range(1, 100),
      unusedFoodThresholds: { hp: 26, mp: 51 },
    });
    expect(roundCache.match(1, makeCandidate(60))).toEqual(completed(1, 30, 80));
    expect(roundCache.match(2, makeCandidate(60))).toBeNull();
  });

  it('reuses individual seeds when the complete multi-round threshold intersection cannot be reused', async () => {
    const input = request();
    const makeCandidate = (threshold) =>
      buildFoodCandidate([{ hrid: '/items/gummy', kind: 'mp', threshold, restore: 40, price: 1 }]);
    const completed = (seed, min, max, costPerHour) => ({
      ...sample(0, false, costPerHour),
      seed,
      stoppedEarly: false,
      simulatedTime: input.payload.simulationTimeLimit,
      equivalentThresholds: [{ hrid: '/items/gummy', kind: 'mp', min, max }],
    });
    const samples = [completed(1, 10, 90, 10), completed(2, 50, 50, 20), completed(3, 1, 100, 30)];
    const changed = completed(2, 60, 60, 40);
    const simulate = vi.fn();
    for (const value of [...samples, changed]) simulate.mockResolvedValueOnce(value);
    const roundCache = createFoodOptimizerRoundCache();
    const first = await evaluateFoodOptimizerCandidate(input, makeCandidate(50), 0, undefined, simulate, {
      roundCache,
    });
    expect(first.equivalentThresholds).toEqual([{ hrid: '/items/gummy', kind: 'mp', min: 50, max: 50 }]);
    const progress = vi.fn();
    const second = await evaluateFoodOptimizerCandidate(input, makeCandidate(60), 0, progress, simulate, {
      roundCache,
    });
    expect(second).toMatchObject({ feasible: true, roundsCompleted: 3, simulatedRounds: 1, reusedRounds: 2 });
    expect(second.samples).toEqual([samples[0], changed, samples[2]]);
    expect(second.costPerHour).toBe(80 / 3);
    expect(simulate.mock.calls.map((call) => call[2])).toEqual([1, 2, 3, 2]);
    expect(progress).toHaveBeenLastCalledWith({ round: 3, progress: 0, simulatedRounds: 1, reusedRounds: 2 });
  });

  it('checks the current death budget after reusing a complete round', async () => {
    const input = request();
    input.rounds = 1;
    const candidate = buildFoodCandidate([{ hrid: '/items/gummy', kind: 'mp', threshold: 50, restore: 40, price: 1 }]);
    const roundCache = createFoodOptimizerRoundCache();
    const simulate = vi.fn().mockResolvedValue({
      ...sample(2),
      seed: 1,
      stoppedEarly: false,
      simulatedTime: input.payload.simulationTimeLimit,
      equivalentThresholds: [{ hrid: '/items/gummy', kind: 'mp', min: 1, max: 100 }],
    });
    expect(
      (await evaluateFoodOptimizerCandidate(input, candidate, 2, undefined, simulate, { roundCache })).feasible,
    ).toBe(true);
    const rejected = await evaluateFoodOptimizerCandidate(input, candidate, 1, undefined, simulate, { roundCache });
    expect(rejected).toMatchObject({ feasible: false, rejected: 'deaths', simulatedRounds: 0, reusedRounds: 1 });
    expect(simulate).toHaveBeenCalledOnce();
  });
});
