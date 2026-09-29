import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMultiSimulationMessage } from '../multiWorker.js';

class FakeChildWorker {
  static instances = [];
  static behaviors = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this.behavior = FakeChildWorker.behaviors.shift() || (() => {});
    this.postMessage = vi.fn((payload) => {
      this.behavior(this, payload);
    });
    this.terminate = vi.fn();
    FakeChildWorker.instances.push(this);
  }

  emit(data) {
    this.onmessage?.({ data });
  }

  fail(error) {
    this.onerror?.(error);
  }
}

describe('multiWorker', () => {
  let originalWorker;
  let originalNavigatorDescriptor;

  beforeEach(() => {
    FakeChildWorker.instances = [];
    FakeChildWorker.behaviors = [];
    originalWorker = globalThis.Worker;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    globalThis.Worker = FakeChildWorker;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 2 },
    });
  });

  afterEach(() => {
    if (typeof originalWorker === 'undefined') {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }

    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }

    vi.restoreAllMocks();
  });

  it('terminates sibling child workers when one multi-run task fails', async () => {
    FakeChildWorker.behaviors = [
      (worker) => {
        setTimeout(() => {
          worker.emit({ type: 'simulation_error', error: 'forced failure' });
        }, 0);
      },
      () => {},
    ];

    const workerScope = {
      postMessage: vi.fn(),
      close: vi.fn(),
    };

    await handleMultiSimulationMessage(
      {
        type: 'start_simulation_all_zones',
        players: [],
        zones: [
          { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
        ],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
      },
      workerScope,
    );

    expect(FakeChildWorker.instances).toHaveLength(2);
    expect(FakeChildWorker.instances[0].terminate).toHaveBeenCalled();
    expect(FakeChildWorker.instances[1].terminate).toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'simulation_error',
      error: 'forced failure',
    });
    expect(workerScope.close).toHaveBeenCalledTimes(1);
  });

  it('respects parallelWorkerLimit when scheduling child workers', async () => {
    FakeChildWorker.behaviors = [
      () => {},
      (worker) => {
        setTimeout(() => {
          worker.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
        }, 0);
      },
      (worker) => {
        setTimeout(() => {
          worker.emit({ type: 'simulation_result', simResult: { encounters: 2 } });
        }, 0);
      },
    ];

    const workerScope = {
      postMessage: vi.fn(),
      close: vi.fn(),
    };

    const runPromise = handleMultiSimulationMessage(
      {
        type: 'start_simulation_all_zones',
        players: [],
        zones: [
          { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/bat', difficultyTier: 0 },
        ],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
        parallelWorkerLimit: 1,
      },
      workerScope,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeChildWorker.instances).toHaveLength(1);

    FakeChildWorker.instances[0].emit({ type: 'simulation_result', simResult: { encounters: 0 } });

    await runPromise;

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'simulation_result_allZones',
      simResults: [{ encounters: 0 }, { encounters: 1 }, { encounters: 2 }],
    });
  });

  it('forwards player scroll configuration and simulation context to each child', async () => {
    FakeChildWorker.behaviors = [
      (worker) =>
        setTimeout(() => {
          worker.emit({ type: 'simulation_result', simResult: { encounters: 0 } });
        }, 0),
    ];
    const players = [
      {
        hrid: 'player1',
        combatScrolls: { '/items/seal_of_damage': { quantity: 2 } },
      },
    ];
    const workerScope = { postMessage: vi.fn(), close: vi.fn() };

    await handleMultiSimulationMessage(
      {
        type: 'start_simulation_all_zones',
        players,
        zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
        simulationContext: { isGuildTrial: true },
      },
      workerScope,
    );

    expect(FakeChildWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        players,
        simulationContext: { isGuildTrial: true },
      }),
    );
  });

  // 切片 18：主线程批量消息的 wasm 开关（useWasmEngine）必须透传给每个子 worker，
  // 否则批量扫描永远落在 JS 引擎上。
  it('forwards the wasm engine switch to each child worker', async () => {
    FakeChildWorker.behaviors = [
      (worker) =>
        setTimeout(() => {
          worker.emit({ type: 'simulation_result', simResult: { encounters: 0 } });
        }, 0),
    ];
    const workerScope = { postMessage: vi.fn(), close: vi.fn() };

    await handleMultiSimulationMessage(
      {
        type: 'start_simulation_all_zones',
        players: [],
        zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
        useWasmEngine: true,
      },
      workerScope,
    );

    expect(FakeChildWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ useWasmEngine: true }),
    );

    // 未开启时不注入该字段（保持消息形状最小化）。
    FakeChildWorker.instances.length = 0;
    FakeChildWorker.behaviors = [
      (worker) =>
        setTimeout(() => {
          worker.emit({ type: 'simulation_result', simResult: { encounters: 0 } });
        }, 0),
    ];
    await handleMultiSimulationMessage(
      {
        type: 'start_simulation_all_labyrinths',
        players: [],
        labyrinths: [{ labyrinthHrid: '/monsters/cyclops', roomLevel: 100 }],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
      },
      workerScope,
    );

    expect(FakeChildWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'start_simulation' }),
    );
    const forwarded = FakeChildWorker.instances[0].postMessage.mock.calls[0][0];
    expect(forwarded.useWasmEngine).toBeUndefined();
  });
});
