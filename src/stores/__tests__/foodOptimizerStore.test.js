import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createFoodOptimizerActions } from '../simulatorFoodOptimizerActions.js';
import { snapshotFoodOptimizerInput } from '../../services/foodOptimizerSnapshot.js';
import {
  buildFoodCandidate,
  countFoodOptimizerCandidates,
  getFoodOptimizerCatalogHrids,
  getFoodOptimizerItems,
} from '../../services/foodOptimizerDomain.js';
import { createSimulationActions } from '../simulatorSimulationActions.js';
import { FOOD_OPTIMIZER_LABYRINTH_ERROR } from '../../services/foodOptimizerTarget.js';

const controls = vi.hoisted(() => ({ calls: [], finish: null }));
vi.mock('../../services/foodOptimizerSearch.js', () => ({
  createFoodOptimizerSearch(options) {
    controls.calls.push(options);
    const done = new Promise((resolve) => (controls.finish = resolve));
    return {
      done,
      cancel: () =>
        controls.finish({
          status: 'cancelled',
          complete: false,
          topResults: [],
          request: options.request,
          inputSignature: options.request.inputSignature,
        }),
    };
  },
}));

function storageMock() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storageMock());
  setActivePinia(createPinia());
  controls.calls = [];
  controls.finish = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function importedStore() {
  const store = useSimulatorStore();
  store.setImportedProfileState('1', true);
  store.simulationSettings.zoneHrid = '/actions/combat/fly';
  return store;
}

function attachReport(store) {
  const input = snapshotFoodOptimizerInput(store);
  const food = getFoodOptimizerItems({ maxHp: 110, maxMp: 110, thresholdStepPercent: 10 })[0];
  const candidate = buildFoodCandidate([{ ...food, threshold: 40 }]);
  store.foodOptimizer.report = {
    request: input,
    inputSignature: store.foodOptimizerInputSignature,
    stale: false,
    appliedSignature: null,
    topResults: [{ ...candidate, feasible: true, roundsCompleted: input.rounds }],
    complete: false,
    status: 'cancelled',
  };
  return candidate;
}

function completedReportFor({ request, items, foodSlots }) {
  const candidate = buildFoodCandidate([{ ...items[0], threshold: items[0].thresholds[0] }]);
  const totalCandidates = countFoodOptimizerCandidates(items, foodSlots);
  return {
    request,
    inputSignature: request.inputSignature,
    complete: true,
    status: 'completed',
    stale: false,
    fromCache: false,
    appliedSignature: null,
    appliedInputSignature: '',
    startedAt: 100,
    finishedAt: 10100,
    baseline: { foodUsed: {}, costPerHour: 15, deaths: 0, ranOutOfMana: false },
    stats: { totalCandidates, completedCandidates: totalCandidates, completedRounds: 12, feasibleCandidates: 10 },
    topResults: [
      {
        ...candidate,
        feasible: true,
        roundsCompleted: request.rounds,
        costPerHour: 10,
        deaths: 0,
        samples: request.seeds.map((seed) => ({
          seed,
          costPerHour: 10,
          deaths: 0,
          stoppedEarly: false,
          ranOutOfMana: false,
          simulatedTime: request.payload.simulationTimeLimit,
          foodUsed: { [candidate.food[0]]: 1 },
        })),
      },
    ],
  };
}

async function completeSearch(store, changes = {}) {
  const nextCall = controls.calls.length + 1;
  const pending = store.startFoodOptimizer();
  await vi.waitFor(() => expect(controls.calls).toHaveLength(nextCall), { timeout: 10000 });
  const report = { ...completedReportFor(controls.calls.at(-1)), ...changes };
  controls.calls.at(-1).onUpdate(structuredClone(report), { phase: report.status, progress: 1, elapsedSeconds: 10 });
  controls.finish(report);
  await pending;
  return report;
}

describe('food optimizer store', () => {
  it.each(['top10', 'complete'])(
    'reuses an identical completed %s request before loading the mapper or search',
    async (searchMode) => {
      const store = importedStore();
      store.setFoodOptimizerSettings({ searchMode });
      const original = await completeSearch(store);
      const loadMapper = vi.fn(() => {
        throw new Error('A cache hit must not prepare a simulation.');
      });
      const actions = createFoodOptimizerActions({ loadPlayerMapperModule: loadMapper });
      await actions.startFoodOptimizer.call(store);
      expect(loadMapper).not.toHaveBeenCalled();
      expect(controls.calls).toHaveLength(1);
      expect(store.foodOptimizer.runtime).toMatchObject({
        isRunning: false,
        phase: 'completed',
        progress: 1,
        activeRounds: 0,
        elapsedSeconds: 0,
        error: '',
      });
      expect(store.foodOptimizer.report).toMatchObject({ fromCache: true, stale: false, appliedSignature: null });
      expect(store.foodOptimizer.report.stats).toEqual(original.stats);
      expect(store.foodOptimizer.report.topResults).toEqual(original.topResults);
    },
  );

  it('restores a pristine result after applying it, editing the displayed report, and returning to the original inputs', async () => {
    const store = importedStore();
    const players = JSON.parse(JSON.stringify(store.players));
    const original = await completeSearch(store);
    const signature = original.topResults[0].signature;
    expect(store.applyFoodOptimizerResult(signature)).toBe(true);
    store.foodOptimizer.report.topResults[0].costPerHour = 999;
    store.$patch({ players });
    expect(store.foodOptimizerReportStale).toBe(true);
    await store.startFoodOptimizer();
    expect(controls.calls).toHaveLength(1);
    expect(store.foodOptimizerReportStale).toBe(false);
    expect(store.foodOptimizer.report).toMatchObject({
      fromCache: true,
      appliedSignature: null,
      appliedInputSignature: '',
    });
    expect(store.foodOptimizer.report.topResults[0].costPerHour).toBe(10);
    expect(store.applyFoodOptimizerResult(signature)).toBe(true);
  });

  it.each([
    (store) => {
      store.activePlayer.levels.stamina += 1;
    },
    (store) => {
      store.players[1].selected = true;
    },
    (store) => {
      store.activePlayer.food = ['/items/donut', '', ''];
    },
    (store) => {
      store.activePlayer.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
    },
    (store) => {
      store.simulationSettings.difficultyTier += 1;
    },
    (store) => {
      store.simulationSettings.simulationTimeHours += 1;
    },
    (store) => {
      store.simulationSettings.mooPass = !store.simulationSettings.mooPass;
    },
    (store) => {
      store.setFoodOptimizerSettings({ thresholdStepPercent: 15 });
    },
    (store) => {
      store.setFoodOptimizerSettings({ rounds: 4 });
    },
    (store) => {
      store.setFoodOptimizerSettings({ searchMode: 'complete' });
    },
    (store) => {
      store.setFoodOptimizerSettings({ requireZeroDeaths: true });
    },
    (store) => {
      store.setFoodOptimizerSettings({ foodHrids: getFoodOptimizerCatalogHrids().slice(0, 2) });
    },
    (store) => {
      store.pricing.priceTable['/items/donut'].ask = 12345;
    },
    (store) => {
      store.pricing.consumableMode = 'vendor';
    },
    (store) => {
      store.pricing.overrides['/items/donut'] = { ask: 2 };
    },
  ])('runs a new search after a relevant input changes (%#)', async (mutate) => {
    const store = importedStore();
    await completeSearch(store);
    mutate(store);
    await completeSearch(store);
    expect(controls.calls).toHaveLength(2);
    expect(controls.calls[1].request.inputSignature).not.toBe(controls.calls[0].request.inputSignature);
    expect(store.foodOptimizer.report.fromCache).toBe(false);
  });

  it.each(['cancelled', 'error'])('does not reuse a %s search', async (status) => {
    const store = importedStore();
    await completeSearch(store, { status, complete: false });
    await completeSearch(store);
    expect(controls.calls).toHaveLength(2);
    expect(store.foodOptimizer.report.fromCache).toBe(false);
  });

  it('does not cache a completed report that expired during its run', async () => {
    const store = importedStore();
    const pending = store.startFoodOptimizer();
    await vi.waitFor(() => expect(controls.calls).toHaveLength(1));
    const report = completedReportFor(controls.calls[0]);
    controls.calls[0].onUpdate({ ...report, complete: false, status: 'running' }, { phase: 'searching' });
    store.activePlayer.levels.stamina += 1;
    store.activePlayer.levels.stamina -= 1;
    controls.finish(report);
    await pending;
    expect(store.foodOptimizer.report.stale).toBe(true);
    await completeSearch(store);
    expect(controls.calls).toHaveLength(2);
  });

  it('isolates report reuse between store instances and clears it on disposal', async () => {
    const first = importedStore();
    await completeSearch(first);
    setActivePinia(createPinia());
    const second = importedStore();
    await completeSearch(second);
    expect(controls.calls).toHaveLength(2);
    second.$dispose();
    await completeSearch(useSimulatorStore());
    expect(controls.calls).toHaveLength(3);
  });

  it('still checks busy state before returning a cached report', async () => {
    const store = importedStore();
    await completeSearch(store);
    store.pricing.isLoading = true;
    await store.startFoodOptimizer();
    expect(store.foodOptimizer.runtime.error).toBe('common:foodOptimizer.busy');
    expect(store.foodOptimizer.report.fromCache).toBe(false);
    expect(controls.calls).toHaveLength(1);
    store.pricing.isLoading = false;
    await store.startFoodOptimizer();
    expect(store.foodOptimizer.report.fromCache).toBe(true);
    expect(store.foodOptimizer.runtime.error).toBe('');
  });

  it('rejects labyrinth previews and starts before loading preparation modules, including a cached old preview', async () => {
    const store = importedStore();
    store.setSimulationMode('labyrinth');
    const loadMapper = vi.fn();
    const actions = createFoodOptimizerActions({ loadPlayerMapperModule: loadMapper });
    store.foodOptimizer.preview = {
      inputSignature: store.foodOptimizerInputSignature,
      totalCandidates: 100,
      resources: { maxHp: 110, maxMp: 110, foodSlots: 1 },
    };
    store.foodOptimizer.previewPending = true;

    await actions.refreshFoodOptimizerPreview.call(store);
    expect(store.foodOptimizer.preview).toBeNull();
    expect(store.foodOptimizer.previewPending).toBe(false);
    expect(store.foodOptimizer.previewError).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
    await actions.startFoodOptimizer.call(store);

    expect(loadMapper).not.toHaveBeenCalled();
    expect(controls.calls).toHaveLength(0);
    expect(store.foodOptimizer.runtime.isRunning).toBe(false);
    expect(store.foodOptimizer.runtime.error).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
    expect(snapshotFoodOptimizerInput(store).simulation.labyrinth).not.toBeNull();
  });

  it('does not recreate a labyrinth preview when changing optimization settings', () => {
    const store = importedStore();
    store.setSimulationMode('labyrinth');
    store.foodOptimizer.preview = {
      inputSignature: store.foodOptimizerInputSignature,
      totalCandidates: 100,
      resources: { maxHp: 110, maxMp: 110, foodSlots: 1 },
    };

    expect(store.setFoodOptimizerSettings({ thresholdStepPercent: 50 })).toBe(true);
    expect(store.foodOptimizer.preview).toBeNull();
    expect(store.foodOptimizer.previewError).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
  });

  it('does not start a search if the target changes to a labyrinth during preparation', async () => {
    const store = importedStore();
    const mapper = await import('../../services/playerMapper.js');
    let resolveMapper;
    const actions = createFoodOptimizerActions({
      loadPlayerMapperModule: () => new Promise((resolve) => (resolveMapper = resolve)),
    });
    const pending = actions.startFoodOptimizer.call(store);
    store.setSimulationMode('labyrinth');
    resolveMapper(mapper);
    await pending;

    expect(controls.calls).toHaveLength(0);
    expect(store.foodOptimizer.runtime.isRunning).toBe(false);
    expect(store.foodOptimizer.runtime.error).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
  });

  it('does not publish an in-flight preview after switching to a labyrinth', async () => {
    const store = importedStore();
    const mapper = await import('../../services/playerMapper.js');
    let resolveMapper;
    const actions = createFoodOptimizerActions({
      loadPlayerMapperModule: () => new Promise((resolve) => (resolveMapper = resolve)),
    });
    const pending = actions.refreshFoodOptimizerPreview.call(store);
    expect(store.foodOptimizer.previewPending).toBe(true);
    store.setSimulationMode('labyrinth');
    await actions.refreshFoodOptimizerPreview.call(store);
    resolveMapper(mapper);
    await pending;

    expect(store.foodOptimizer.preview).toBeNull();
    expect(store.foodOptimizer.previewPending).toBe(false);
    expect(store.foodOptimizer.previewError).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
  });

  it.each(['simulation', 'payload'])(
    'blocks an old labyrinth report recorded in %s even with a matching signature',
    (key) => {
      const store = importedStore();
      const candidate = attachReport(store);
      store.foodOptimizer.report.request[key] = {
        labyrinth: { labyrinthHrid: store.simulationSettings.labyrinthHrid, roomLevel: 40 },
      };
      const before = JSON.parse(JSON.stringify(store.players));
      expect(store.foodOptimizerReportStale).toBe(false);

      expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(false);
      expect(store.foodOptimizer.runtime.error).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
      expect(store.players).toEqual(before);
      expect(store.foodOptimizer.report.appliedSignature).toBeNull();
    },
  );

  it('blocks applying an otherwise valid report while a labyrinth is selected', () => {
    const store = importedStore();
    const candidate = attachReport(store);
    store.setSimulationMode('labyrinth');

    expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(false);
    expect(store.foodOptimizer.runtime.error).toBe(FOOD_OPTIMIZER_LABYRINTH_ERROR);
  });

  it.each([false, true])(
    'keeps normal map and dungeon preview, search and application available (dungeon=%s)',
    async (useDungeon) => {
      const store = importedStore();
      store.simulationSettings.useDungeon = useDungeon;
      await store.refreshFoodOptimizerPreview();
      expect(store.foodOptimizer.preview.totalCandidates).toBeGreaterThan(0);
      const pending = store.startFoodOptimizer();
      await vi.waitFor(() => expect(controls.calls).toHaveLength(1));
      const payload = controls.calls[0].request.payload;
      expect(payload.labyrinth).toBeNull();
      expect(payload.zone.zoneHrid).toBe(
        useDungeon ? store.simulationSettings.dungeonHrid : store.simulationSettings.zoneHrid,
      );
      store.stopFoodOptimizer();
      await pending;
      const candidate = attachReport(store);
      expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(true);
    },
  );

  it('keeps ordinary labyrinth simulation dispatch available', async () => {
    const store = importedStore();
    store.setSimulationMode('labyrinth');
    const worker = { startSimulation: vi.fn() };
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{ hrid: 'player1' }] }),
      workerClient: worker,
    });
    await actions.startSimulation.call(store);

    expect(worker.startSimulation).toHaveBeenCalledOnce();
    expect(worker.startSimulation.mock.calls[0][0]).toMatchObject({
      zone: null,
      labyrinth: { labyrinthHrid: store.simulationSettings.labyrinthHrid },
    });
    expect(store.runtime.isRunning).toBe(true);
    worker.startSimulation.mock.calls[0][1].onError('test completed');
  });

  it('persists optimizer-only settings and rejects invalid values', () => {
    const store = importedStore();
    expect(store.foodOptimizer.settings).toEqual({
      thresholdStepPercent: 10,
      rounds: 1,
      searchMode: 'top10',
      foodHrids: null,
      requireZeroDeaths: false,
    });
    expect(
      store.setFoodOptimizerSettings({
        thresholdStepPercent: 15,
        rounds: 7,
        searchMode: 'complete',
        requireZeroDeaths: true,
      }),
    ).toBe(true);
    expect(store.setFoodOptimizerSettings({ thresholdStepPercent: 1.5 })).toBe(false);
    expect(store.setFoodOptimizerSettings({ rounds: 11 })).toBe(false);
    expect(store.setFoodOptimizerSettings({ rounds: '' })).toBe(false);
    expect(store.setFoodOptimizerSettings({ searchMode: 'approximate' })).toBe(false);
    expect(store.setFoodOptimizerSettings({ searchMode: null })).toBe(false);
    expect(store.setFoodOptimizerSettings({ requireZeroDeaths: 'yes' })).toBe(false);
    setActivePinia(createPinia());
    expect(useSimulatorStore().foodOptimizer.settings).toEqual({
      thresholdStepPercent: 15,
      rounds: 7,
      searchMode: 'complete',
      foodHrids: null,
      requireZeroDeaths: true,
    });
  });

  it('always includes the target, keeps selected teammates and ignores unselected configs', () => {
    const store = importedStore();
    store.players[0].selected = false;
    store.players[1].selected = true;
    store.players[1].food = ['/items/donut', '', ''];
    const input = snapshotFoodOptimizerInput(store);
    expect(input.players.map((player) => player.id)).toEqual(['1', '2']);
    expect(input.players[1].food[0]).toBe('/items/donut');
    expect(input.players.every((player) => player.selected)).toBe(true);
    store.players[1].food[0] = '/items/cupcake';
    expect(input.players[1].food[0]).toBe('/items/donut');
  });

  it('updates exact preview count with the selected step', async () => {
    const store = importedStore();
    await store.refreshFoodOptimizerPreview();
    const before = store.foodOptimizer.preview.totalCandidates;
    store.setFoodOptimizerSettings({ thresholdStepPercent: 100 });
    expect(store.foodOptimizer.preview.totalCandidates).toBeLessThan(before);
    await store.refreshFoodOptimizerPreview();
    expect(store.foodOptimizer.preview.totalCandidates).toBeLessThan(before);
    expect(store.foodOptimizer.preview.resources.foodSlots).toBe(1);
  });

  it('restricts the candidate domain and the search request to the selected foods', async () => {
    const store = importedStore();
    await store.refreshFoodOptimizerPreview();
    const fullCount = store.foodOptimizer.preview.totalCandidates;
    const [first, second, ...rest] = getFoodOptimizerCatalogHrids();
    expect(rest.length).toBeGreaterThan(0);

    expect(store.setFoodOptimizerSettings({ foodHrids: [second, first, second, '/items/not_a_food'] })).toBe(true);
    const scope = [first, second];
    expect(store.foodOptimizer.settings.foodHrids).toEqual(scope);
    expect(snapshotFoodOptimizerInput(store).foodHrids).toEqual(scope);
    expect(store.foodOptimizer.preview.totalCandidates).toBeLessThan(fullCount);

    await completeSearch(store);
    const call = controls.calls.at(-1);
    expect(call.request.foodHrids).toEqual(scope);
    expect(call.items.map((item) => item.hrid)).toEqual(scope);

    // 全选保留为显式完整数组（不再折叠为 null——那会让下次打开被静默改回
    // 新用户的装备默认），同样让已完成的报告过期。
    expect(store.setFoodOptimizerSettings({ foodHrids: getFoodOptimizerCatalogHrids() })).toBe(true);
    expect(store.foodOptimizer.settings.foodHrids).toEqual(getFoodOptimizerCatalogHrids());
    expect(store.foodOptimizerReportStale).toBe(true);
  });

  it('resolves an unsaved scope to the equipped foods while keeping saved scopes verbatim', () => {
    const store = importedStore();
    const [first, second, third] = getFoodOptimizerCatalogHrids();
    // 新用户（未保存范围）：解析为当前佩戴食物 ∩ 目录，按目录顺序去重、忽略非目录装备。
    store.players[0].food = [second, null, first, second, '/items/not_a_food'];
    expect(snapshotFoodOptimizerInput(store).foodHrids).toEqual([first, second]);
    // 已保存的范围原样生效，不随装备变化。
    expect(store.setFoodOptimizerSettings({ foodHrids: [third] })).toBe(true);
    store.players[0].food = [first, '', ''];
    expect(snapshotFoodOptimizerInput(store).foodHrids).toEqual([third]);
    // 未保存范围且未佩戴任何目录内食物时保持 null（引擎语义：全部食物）。
    expect(store.setFoodOptimizerSettings({ foodHrids: null })).toBe(true);
    store.players[0].food = ['', '', ''];
    expect(snapshotFoodOptimizerInput(store).foodHrids).toBeNull();
  });

  it('changes the run signature and expires the report without changing candidate counts when switching modes', async () => {
    const store = importedStore();
    await store.refreshFoodOptimizerPreview();
    const before = store.foodOptimizer.preview;
    const candidate = attachReport(store);

    expect(store.setFoodOptimizerSettings({ searchMode: 'complete' })).toBe(true);

    expect(store.foodOptimizerInputSignature).not.toBe(before.inputSignature);
    expect(snapshotFoodOptimizerInput(store).searchMode).toBe('complete');
    expect(store.foodOptimizer.preview.inputSignature).toBe(store.foodOptimizerInputSignature);
    expect(store.foodOptimizer.preview.totalCandidates).toBe(before.totalCandidates);
    expect(store.foodOptimizer.preview.resources).toEqual(before.resources);
    expect(store.foodOptimizer.report.request.searchMode).toBe('top10');
    expect(store.foodOptimizerReportStale).toBe(true);
    expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(false);
  });

  it('marks a report stale across page changes and locks price mutations while searching', async () => {
    const store = importedStore();
    await store.refreshFoodOptimizerPreview();
    const candidate = attachReport(store);
    expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(true);
    expect(store.foodOptimizer.report.stale).toBe(false);
    store.activePlayer.levels.stamina = 90;
    expect(store.foodOptimizer.report.stale).toBe(true);
    store.foodOptimizer.runtime.isRunning = true;
    const before = JSON.parse(JSON.stringify(store.pricing));
    store.setPriceOverride('/items/donut', { ask: 12345 });
    expect(store.pricing.overrides).toEqual(before.overrides);
    expect(store.pricing.priceTable).toEqual(before.priceTable);
  });

  it('locks synchronously during preparation, blocks other simulations, and can stop before workers load', async () => {
    const store = importedStore();
    let resolveMapper;
    const actions = createFoodOptimizerActions({
      loadPlayerMapperModule: () => new Promise((resolve) => (resolveMapper = resolve)),
    });
    const pending = actions.startFoodOptimizer.call(store);
    expect(store.foodOptimizer.runtime.isRunning).toBe(true);
    expect(store.setFoodOptimizerSettings({ rounds: 1 })).toBe(false);
    expect(store.setFoodOptimizerSettings({ searchMode: 'complete' })).toBe(false);
    await store.startSimulation();
    expect(store.runtime.isRunning).toBe(false);
    await store.runAdvisorScan();
    expect(store.advisor.runtime.isRunning).toBe(false);
    await expect(store.setQueueBaselineForActivePlayer({ runSimulation: true })).rejects.toThrow('errorBusy');
    await store.runActiveQueue();
    expect(store.activeQueueState.isRunning).toBe(false);
    store.stopFoodOptimizer();
    resolveMapper({ buildPlayersForSimulation: () => [] });
    await pending;
    expect(store.foodOptimizer.runtime.isRunning).toBe(false);
    expect(controls.calls).toHaveLength(0);
  });

  it('closes the normal-simulation async module-loading race', async () => {
    const store = importedStore();
    let resolveMapper;
    const worker = { startSimulation: vi.fn() };
    const actions = createSimulationActions({
      loadPlayerMapperModule: () => new Promise((resolve) => (resolveMapper = resolve)),
      workerClient: worker,
    });
    const pending = actions.startSimulation.call(store);
    store.foodOptimizer.runtime.isRunning = true;
    resolveMapper({ buildPlayersForSimulation: () => [{}] });
    await pending;
    expect(worker.startSimulation).not.toHaveBeenCalled();
    expect(store.runtime.isRunning).toBe(false);
  });

  it.each(['top10', 'complete'])('keeps the %s snapshot through page changes and cancellation', async (searchMode) => {
    const store = importedStore();
    store.setFoodOptimizerSettings({ searchMode });
    const run = store.startFoodOptimizer();
    await vi.waitFor(() => expect(controls.calls).toHaveLength(1));
    const snapshot = controls.calls[0].request;
    expect(snapshot.searchMode).toBe(searchMode);
    expect(store.setFoodOptimizerSettings({ searchMode: searchMode === 'top10' ? 'complete' : 'top10' })).toBe(false);
    expect(store.foodOptimizer.settings.searchMode).toBe(searchMode);
    const sameStore = useSimulatorStore();
    expect(sameStore.foodOptimizer.runtime.isRunning).toBe(true);
    store.players[0].levels.stamina = 99;
    store.pricing.priceTable['/items/donut'].ask = 99;
    expect(snapshot.players[0].levels.stamina).toBe(1);
    expect(snapshot.prices.priceTable['/items/donut'].ask).not.toBe(99);
    store.stopFoodOptimizer();
    await run;
    expect(store.foodOptimizer.runtime.isRunning).toBe(false);
    expect(store.foodOptimizer.runtime.phase).toBe('cancelled');
    expect(store.foodOptimizer.report.request.searchMode).toBe(searchMode);
    expect(store.foodOptimizer.report.complete).toBe(false);
  });

  it('keeps an expired report expired across screening updates, input reverts, and search completion', async () => {
    const store = importedStore();
    const run = store.startFoodOptimizer();
    await vi.waitFor(() => expect(controls.calls).toHaveLength(1));
    const { request, onUpdate } = controls.calls[0];
    const candidate = attachReport(store);
    const report = {
      request,
      inputSignature: request.inputSignature,
      stale: false,
      appliedSignature: null,
      topResults: [{ ...candidate, feasible: true, roundsCompleted: request.rounds }],
      status: 'running',
      complete: false,
    };
    onUpdate(structuredClone(report), { phase: 'screening' });
    store.activePlayer.levels.stamina = 99;
    expect(store.foodOptimizer.report.stale).toBe(true);
    store.activePlayer.levels.stamina = 1;
    onUpdate(structuredClone(report), { phase: 'searching' });
    expect(store.foodOptimizer.report.stale).toBe(true);
    controls.finish({ ...report, complete: true, status: 'completed' });
    await run;
    expect(store.foodOptimizer.report.stale).toBe(true);
    expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(false);
  });

  it('applies only food and its triggers, preserves the report, and recognizes its own application', () => {
    const store = importedStore();
    const candidate = attachReport(store);
    const before = JSON.parse(JSON.stringify(store.players));
    expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(true);
    expect(store.activePlayer.food).toEqual([candidate.food[0], '', '']);
    expect(store.activePlayer.triggerMap[candidate.food[0]]).toEqual(candidate.triggerMap[candidate.food[0]]);
    expect(store.players.slice(1)).toEqual(before.slice(1));
    expect(store.activePlayer.equipment).toEqual(before[0].equipment);
    expect(store.activePlayer.abilities).toEqual(before[0].abilities);
    expect(store.activePlayer.drinks).toEqual(before[0].drinks);
    expect(store.foodOptimizer.report.appliedSignature).toBe(candidate.signature);
    expect(store.foodOptimizerReportStale).toBe(false);
  });

  it.each([
    (store) => store.setActivePlayer('2'),
    (store) => (store.players[1].selected = true),
    (store) => (store.activePlayer.levels.stamina += 1),
    (store) => (store.simulationSettings.difficultyTier += 1),
    (store) => (store.simulationSettings.simulationTimeHours += 1),
    (store) => (store.simulationSettings.mooPass = !store.simulationSettings.mooPass),
    (store) => store.setFoodOptimizerSettings({ thresholdStepPercent: 15 }),
    (store) => store.setFoodOptimizerSettings({ rounds: 4 }),
    (store) => store.setFoodOptimizerSettings({ searchMode: 'complete' }),
    (store) => store.setFoodOptimizerSettings({ requireZeroDeaths: true }),
    (store) => (store.pricing.priceTable['/items/donut'].ask = 12345),
    (store) => (store.pricing.consumableMode = 'vendor'),
    (store) => (store.pricing.overrides['/items/donut'] = { ask: 2 }),
  ])('prevents application after any relevant input changes (%#)', (mutate) => {
    const store = importedStore();
    const candidate = attachReport(store);
    mutate(store);
    expect(store.foodOptimizerReportStale).toBe(true);
    expect(store.applyFoodOptimizerResult(candidate.signature)).toBe(false);
  });

  it('disables starts without an import or with batch mode, and cleans preparation errors', async () => {
    const store = useSimulatorStore();
    await store.startFoodOptimizer();
    expect(store.foodOptimizer.runtime.error).toContain('requireImport');
    store.setImportedProfileState('1', true);
    store.simulationSettings.runScope = 'all_solo_zones';
    await store.startFoodOptimizer();
    expect(store.foodOptimizer.runtime.error).toContain('requireSingle');
    store.simulationSettings.runScope = 'single';
    const actions = createFoodOptimizerActions({
      loadPlayerMapperModule: async () => {
        throw new Error('load failed');
      },
    });
    await actions.startFoodOptimizer.call(store);
    expect(store.foodOptimizer.runtime.error).toBe('load failed');
    expect(store.foodOptimizer.runtime.isRunning).toBe(false);
  });
});
