// 地下城计算器「模拟每轮时长」链路测试：注入 playerMapper 桩与 WorkerClient 桩，
// 走真实批量入口（simulatorWorkerRuns）与真实聚合/写回逻辑，不触 worker / wasm。
// 覆盖面：全部 4 地牢 × T0/T1/T2（12 组合）的 payload 契约、跨组合种子唯一、按组合聚合写回、
// 零通关组合保留、失败轮剔除、空队伍 / 忙碌 / 重入 / 取消，以及每轮分钟映射的持久化与迁移。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { normalizeDungeonCalculatorPersistedState, useDungeonCalculatorStore } from '../dungeonCalculatorStore.js';
import { cancelDedicatedWorkerRuns } from '../../services/simulatorWorkerRuns.js';

const NANOSECONDS_PER_MINUTE = 60 * 1_000_000_000;
const NANOSECONDS_PER_HOUR = 3_600 * 1_000_000_000;

// 模拟目标数 = 4 地牢 × 3 档位；每目标轮数 = config.simulationRounds 默认 3。
const EXPECTED_TARGETS = 12;
const ROUNDS = 3;

// 批入口桩：保存 payload 与 handlers，由用例手动驱动逐轮结算
//（照 simulatorStore.test.js 的 HomeBatchWorkerClient 先例）。
class StubBatchWorkerClient {
  static instances = [];

  constructor() {
    this.payloads = null;
    this.handlers = null;
    this.stopSimulation = vi.fn();
    StubBatchWorkerClient.instances.push(this);
  }

  startSimulationBatch(payloads, handlers = {}) {
    this.payloads = Array.isArray(payloads) ? payloads : [];
    this.handlers = handlers;
  }

  emitResult(simResult, index) {
    this.handlers?.onResult?.(simResult, index);
  }

  emitError(error, index) {
    this.handlers?.onError?.(error, index);
  }

  emitComplete() {
    this.handlers?.onComplete?.();
  }
}

const fakePlayerMapperLoader = async () => ({
  buildPlayersForSimulation: (playerConfigs) =>
    (playerConfigs ?? []).filter((player) => player.selected).map((player) => ({ id: player.id })),
});

function createRoundResult({
  completed = 0,
  failed = 0,
  maxWave = 0,
  fastestMinutes = 0,
  consumablesUsed = null,
  deaths = null,
} = {}) {
  return {
    simulatedTime: 24 * NANOSECONDS_PER_HOUR,
    dungeonsCompleted: completed,
    dungeonsFailed: failed,
    maxWaveReached: maxWave,
    minDungenonTime: fastestMinutes * NANOSECONDS_PER_MINUTE,
    ...(consumablesUsed ? { consumablesUsed } : {}),
    ...(deaths ? { deaths } : {}),
  };
}

function createLocalStorageMock() {
  const storage = new Map();
  return {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

function createStores() {
  const simulator = useSimulatorStore();
  // 模拟队伍口径 = 「已导入且勾选」（2026-10-16 修复）：夹具把参与模拟的槽位标记为已导入，
  // 未导入的空槽位既不参与模拟、也不影响队伍人数联动。
  simulator.players.forEach((player, index) => {
    player.selected = index === 0;
    simulator.setImportedProfileState(String(player.id), index === 0);
  });
  const calculator = useDungeonCalculatorStore();
  return { simulator, calculator };
}

async function waitForBatchClient() {
  await vi.waitFor(() => {
    expect(StubBatchWorkerClient.instances.length).toBe(1);
  });
  return StubBatchWorkerClient.instances[0];
}

// 逐组合驱动结算：index 区间 [targetIndex × ROUNDS, (targetIndex + 1) × ROUNDS)；
// resultFactory(targetIndex, roundIndex) 返回该轮结果，null 表示发 worker 错误。
function settleAllTargets(client, resultFactory) {
  for (let index = 0; index < client.payloads.length; index += 1) {
    const targetIndex = Math.floor(index / ROUNDS);
    const simResult = resultFactory(targetIndex, index % ROUNDS);
    if (simResult === null) {
      client.emitError(new Error('round failed'), index);
    } else {
      client.emitResult(simResult, index);
    }
  }
  client.emitComplete();
}

function targetPayloadsFor(client, targetIndex) {
  return client.payloads.slice(targetIndex * ROUNDS, (targetIndex + 1) * ROUNDS);
}

function startSimulation(calculator) {
  return calculator.simulateRunMinutes({
    loadPlayerMapperModule: fakePlayerMapperLoader,
    WorkerClientCtor: StubBatchWorkerClient,
  });
}

describe('dungeonCalculatorStore party simulation (minutes per run, all dungeons)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    StubBatchWorkerClient.instances = [];
    cancelDedicatedWorkerRuns();
    vi.restoreAllMocks();
  });

  it('builds one seeded 24h batch for all 12 dungeon x tier targets', async () => {
    const { calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 批规模：12 组合 × 3 轮；总进度同步登记。
    expect(calculator.simulation.totalRounds).toBe(EXPECTED_TARGETS * ROUNDS);
    expect(client.payloads).toHaveLength(EXPECTED_TARGETS * ROUNDS);

    // 每个组合 3 轮、24h 窗口、副本模式、关日志；12 个组合键互不重复。
    const targetKeys = new Set();
    for (let targetIndex = 0; targetIndex < EXPECTED_TARGETS; targetIndex += 1) {
      const targetPayloads = targetPayloadsFor(client, targetIndex);
      expect(targetPayloads).toHaveLength(ROUNDS);
      for (const payload of targetPayloads) {
        expect(payload).toMatchObject({
          type: 'start_simulation',
          simulationTimeLimit: 24 * NANOSECONDS_PER_HOUR,
          logCombatEvents: false,
        });
        expect(payload.zone.zoneHrid).toBeTruthy();
        expect([0, 1, 2]).toContain(payload.zone.difficultyTier);
        targetKeys.add(`${payload.zone.zoneHrid}|${payload.zone.difficultyTier}`);
      }
    }
    expect(targetKeys.size).toBe(EXPECTED_TARGETS);

    // 跨组合种子全局唯一（12 × 3 = 36 个互不相同）。
    const seeds = client.payloads.map((payload) => payload.seed);
    expect(new Set(seeds).size).toBe(seeds.length);

    calculator.stopRunMinutesSimulation();
    await expect(pending).resolves.toBe(false);
  });

  it('writes back the per-target average minutes when every target clears', async () => {
    const { calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 每个组合：3 轮 × 120 次通关 → 平均每轮 = 1440 / 120 = 12 分钟。
    settleAllTargets(client, () => createRoundResult({ completed: 120, failed: 5, maxWave: 50, fastestMinutes: 12 }));
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    expect(result.targets).toHaveLength(EXPECTED_TARGETS);
    expect(result.appliedTargets).toBe(EXPECTED_TARGETS);
    expect(result.rounds).toBe(ROUNDS);
    expect(result.totalRounds).toBe(EXPECTED_TARGETS * ROUNDS);
    expect(result.successfulRounds).toBe(EXPECTED_TARGETS * ROUNDS);
    expect(result.dungeonsCompleted).toBe(EXPECTED_TARGETS * 3 * 120);
    expect(result.dungeonsFailed).toBe(EXPECTED_TARGETS * 3 * 5);

    // 组合顺序与「每轮分钟」总表一致；每个组合都写回 12 分钟。
    expect(result.targets.map((row) => `${row.dungeonHrid}|${row.difficultyTier}`)).toEqual(
      calculator.runMinutesTargetRows.map((row) => row.key),
    );
    for (const row of result.targets) {
      expect(row.avgRunMinutes).toBeCloseTo(12, 6);
      expect(row.minRunMinutes).toBeCloseTo(12, 6);
      expect(calculator.getRunMinutesOverride(row.dungeonHrid, row.difficultyTier)).toBe(12);
    }
    expect(calculator.simulation.isRunning).toBe(false);
    expect(calculator.simulation.settledRounds).toBe(EXPECTED_TARGETS * ROUNDS);
    expect(calculator.simulation.error).toBe('');
  });

  it('keeps each target value that never cleared while other targets are written back', async () => {
    const { calculator } = createStores();
    const zeroHrid = calculator.catalog[0].actionHrid;
    calculator.setRunMinutesOverride(zeroHrid, 0, 9);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 组合 0（目录第一个地牢 × T0）三轮回团灭；其余组合正常通关（60 次/轮 → 24 分钟）。
    settleAllTargets(client, (targetIndex) =>
      targetIndex === 0
        ? createRoundResult({ failed: 610, maxWave: 4 })
        : createRoundResult({ completed: 60, failed: 2, maxWave: 50, fastestMinutes: 12 }),
    );
    await expect(pending).resolves.toBe(true);

    // 零通关组合：不写回、保留原值 9，摘要记录团灭与最深波。
    expect(calculator.getRunMinutesOverride(zeroHrid, 0)).toBe(9);
    const result = calculator.simulation.lastResult;
    expect(result.appliedTargets).toBe(EXPECTED_TARGETS - 1);
    const zeroTarget = result.targets.find((row) => row.dungeonHrid === zeroHrid && row.difficultyTier === 0);
    expect(zeroTarget.avgRunMinutes).toBeNull();
    expect(zeroTarget.minRunMinutes).toBeNull();
    expect(zeroTarget.dungeonsCompleted).toBe(0);
    expect(zeroTarget.dungeonsFailed).toBe(1830);
    expect(zeroTarget.maxWaveReached).toBe(4);
    expect(calculator.simulation.error).toBe('');

    // 其余组合全部写回 24 分钟。
    for (const row of result.targets) {
      if (row.dungeonHrid === zeroHrid && row.difficultyTier === 0) {
        continue;
      }
      expect(calculator.getRunMinutesOverride(row.dungeonHrid, row.difficultyTier)).toBe(24);
    }
  });

  it('aggregates only the successful rounds of a target when some rounds fail with engine errors', async () => {
    const { calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 组合 1：轮 0 成功（100 次通关）、轮 1 失败、轮 2 成功（50 次）；其余组合统一成功 120 次。
    settleAllTargets(client, (targetIndex, roundIndex) => {
      if (targetIndex === 1) {
        if (roundIndex === 1) {
          return null;
        }
        return createRoundResult({ completed: roundIndex === 0 ? 100 : 50, maxWave: 50, fastestMinutes: 12 });
      }
      return createRoundResult({ completed: 120, maxWave: 50, fastestMinutes: 12 });
    });
    await expect(pending).resolves.toBe(true);

    const row = calculator.simulation.lastResult.targets[1];
    // 48h ÷ 150 次 = 19.2 分钟；失败轮的 simulatedTime 不进分母。
    expect(row.successfulRounds).toBe(2);
    expect(row.failedRounds).toBe(1);
    expect(row.dungeonsCompleted).toBe(150);
    expect(row.avgRunMinutes).toBeCloseTo(19.2, 6);
    expect(calculator.getRunMinutesOverride(row.dungeonHrid, row.difficultyTier)).toBe(19.2);
  });

  it('fails the run when every round of every target reports an engine error', async () => {
    const { calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    settleAllTargets(client, () => null);
    await expect(pending).resolves.toBe(false);

    expect(calculator.simulation.error).toBe('common:dungeonCalculator.simulateErrorFailed');
    expect(calculator.simulation.lastResult).toBeNull();
    expect(calculator.simulation.isRunning).toBe(false);
  });

  it('rejects the run when no player is selected', async () => {
    const { simulator, calculator } = createStores();
    simulator.players.forEach((player) => {
      player.selected = false;
    });

    await expect(calculator.simulateRunMinutes({ loadPlayerMapperModule: fakePlayerMapperLoader })).resolves.toBe(
      false,
    );

    expect(calculator.simulation.error).toBe('common:dungeonCalculator.simulateErrorNoPlayers');
    expect(calculator.simulation.isRunning).toBe(false);
    expect(StubBatchWorkerClient.instances).toHaveLength(0);
  });

  it('excludes selected-but-never-imported slots from the simulated party and the party size', async () => {
    const { simulator, calculator } = createStores();
    // 勾选槽 2 但从未导入（空槽位 / 幽灵队友）：模拟队伍仍只含已导入的玩家 1。
    simulator.players.forEach((player, index) => {
      player.selected = index < 2;
      simulator.setImportedProfileState(String(player.id), index === 0);
    });

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 全部 36 条 payload 的队伍都只含已导入的玩家 1；未导入空槽位不编入。
    for (const payload of client.payloads) {
      expect(payload.players.map((player) => player.id)).toEqual(['1']);
    }
    // 队伍人数与 partySize 联动同源：勾选 2 人（含 1 个未导入槽位）时仍按已导入勾选数 1 计。
    expect(calculator.simulationPartySize).toBe(1);
    expect(calculator.config.partySize).toBe(1);

    calculator.stopRunMinutesSimulation();
    await expect(pending).resolves.toBe(false);
  });

  it('rejects the run when every selected slot was never imported', async () => {
    const { simulator, calculator } = createStores();
    // 夹具默认把玩家 1 标为已导入：这里清掉，制造「只有未导入的勾选槽位」的入口状态。
    simulator.players.forEach((player, index) => {
      player.selected = index < 2;
      simulator.setImportedProfileState(String(player.id), false);
    });

    await expect(calculator.simulateRunMinutes({ loadPlayerMapperModule: fakePlayerMapperLoader })).resolves.toBe(
      false,
    );

    expect(calculator.simulation.error).toBe('common:dungeonCalculator.simulateErrorNoPlayers');
    expect(calculator.simulation.isRunning).toBe(false);
    expect(StubBatchWorkerClient.instances).toHaveLength(0);
  });

  it('rejects the run while another run is marked busy', async () => {
    const { simulator, calculator } = createStores();
    simulator.runtime.isRunning = true;

    try {
      await expect(startSimulation(calculator)).resolves.toBe(false);
      expect(calculator.simulation.error).toBe('common:dungeonCalculator.simulateErrorBusy');
      expect(StubBatchWorkerClient.instances).toHaveLength(0);
    } finally {
      simulator.runtime.isRunning = false;
    }
  });

  it('keeps the last summary and write-backs when the run is rejected as busy', async () => {
    const { simulator, calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();
    settleAllTargets(client, () => createRoundResult({ completed: 120, failed: 5, maxWave: 50, fastestMinutes: 12 }));
    await expect(pending).resolves.toBe(true);

    const beforeResult = calculator.simulation.lastResult;
    const beforeMinutes = JSON.parse(JSON.stringify(calculator.config.runMinutesByDungeonTier));
    expect(beforeResult).not.toBeNull();
    expect(Object.keys(beforeMinutes)).toHaveLength(EXPECTED_TARGETS / 3);

    simulator.runtime.isRunning = true;
    try {
      await expect(startSimulation(calculator)).resolves.toBe(false);
      expect(calculator.simulation.error).toBe('common:dungeonCalculator.simulateErrorBusy');
      // 拒绝路径不得丢上次摘要（页面小字与未通关门禁全部读 lastResult），也不得改动已写回覆盖、重开批运行。
      expect(calculator.simulation.lastResult).toBe(beforeResult);
      expect(calculator.config.runMinutesByDungeonTier).toEqual(beforeMinutes);
      expect(StubBatchWorkerClient.instances).toHaveLength(1);
    } finally {
      simulator.runtime.isRunning = false;
    }
  });

  it('keeps the last summary and write-backs when the run is rejected for an empty party', async () => {
    const { simulator, calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();
    settleAllTargets(client, () => createRoundResult({ completed: 120, failed: 5, maxWave: 50, fastestMinutes: 12 }));
    await expect(pending).resolves.toBe(true);

    const beforeResult = calculator.simulation.lastResult;
    const beforeMinutes = JSON.parse(JSON.stringify(calculator.config.runMinutesByDungeonTier));
    expect(beforeResult).not.toBeNull();

    simulator.players.forEach((player) => {
      player.selected = false;
    });

    await expect(calculator.simulateRunMinutes({ loadPlayerMapperModule: fakePlayerMapperLoader })).resolves.toBe(
      false,
    );

    expect(calculator.simulation.error).toBe('common:dungeonCalculator.simulateErrorNoPlayers');
    expect(calculator.simulation.lastResult).toBe(beforeResult);
    expect(calculator.config.runMinutesByDungeonTier).toEqual(beforeMinutes);
    expect(StubBatchWorkerClient.instances).toHaveLength(1);
  });

  it('clears the last summary and error when the config is reset', () => {
    const { calculator } = createStores();

    // 直接构造最小摘要（页面按 lastResult 判定未通关门禁）：含一个零通关 target 即可，
    // 再人为写入一个错误键，模拟「上次运行留下摘要 + 报错」的残留状态。
    calculator.simulation.lastResult = {
      rounds: 1,
      targets: [{ dungeonHrid: calculator.catalog[0].actionHrid, difficultyTier: 0, avgRunMinutes: null }],
    };
    calculator.simulation.error = 'common:dungeonCalculator.simulateErrorFailed';

    // 重置即回到「未跑过」形态：摘要（门禁依据）与错误一并失效；配置零通关组合锁死的
    // 门禁随 lastResult 清空自然解除。运行态字段不属于 resetConfig 管辖，此处不校验。
    calculator.resetConfig();

    expect(calculator.simulation.lastResult).toBeNull();
    expect(calculator.simulation.error).toBe('');
  });

  it('guards against re-entry while a run is in flight', async () => {
    const { calculator } = createStores();

    const first = startSimulation(calculator);
    await waitForBatchClient();

    await expect(startSimulation(calculator)).resolves.toBe(false);
    expect(StubBatchWorkerClient.instances).toHaveLength(1);

    calculator.stopRunMinutesSimulation();
    await expect(first).resolves.toBe(false);
  });

  it('cancels the in-flight batch through stopRunMinutesSimulation', async () => {
    const { calculator } = createStores();

    const pending = startSimulation(calculator);
    await waitForBatchClient();

    expect(calculator.stopRunMinutesSimulation()).toBe(true);
    await expect(pending).resolves.toBe(false);
    expect(calculator.simulation.isRunning).toBe(false);
    expect(calculator.simulation.lastResult).toBeNull();
    expect(calculator.simulation.error).toBe('');
  });

  it('ignores a stop click during the playerMapper import window and never submits a batch', async () => {
    const { calculator } = createStores();

    // 可控延迟导入桩：在 await 期间点「停止」，复现首次进入页面、playerMapper chunk 仍在拉取
    // 的窗口（此时专用运行句柄尚未注册，stopDungeonCalculatorWorkerRuns 是空操作）。
    let releaseMapper;
    const loadPlayerMapperModule = () =>
      new Promise((resolve) => {
        releaseMapper = () => resolve({ buildPlayersForSimulation: () => [{ hrid: 'player1' }] });
      });

    const pending = calculator.simulateRunMinutes({ loadPlayerMapperModule, WorkerClientCtor: StubBatchWorkerClient });

    // 运行态在首个 await 之前同步置位：页面此刻显示的就是「停止」按钮。
    expect(calculator.simulation.isRunning).toBe(true);
    expect(calculator.stopRunMinutesSimulation()).toBe(true);

    releaseMapper();
    await expect(pending).resolves.toBe(false);

    // 关键断言：批入口未被提交（无 client 实例），取消按「静默收尾」口径落地。
    expect(StubBatchWorkerClient.instances).toHaveLength(0);
    expect(calculator.simulation.isRunning).toBe(false);
    expect(calculator.simulation.error).toBe('');
    expect(calculator.simulation.lastResult).toBeNull();

    // 回归锚点：取消意图不残留——下一次运行照常提交 12 组合 × 3 轮，并可被正常取消。
    const next = startSimulation(calculator);
    const client = await waitForBatchClient();
    expect(client.payloads).toHaveLength(EXPECTED_TARGETS * ROUNDS);

    expect(calculator.stopRunMinutesSimulation()).toBe(true);
    await expect(next).resolves.toBe(false);
  });

  it('counts only player deaths and derives the per-run average for every target', async () => {
    const { calculator } = createStores();

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 每轮：120 次通关；玩家死亡 30（player1）+ 6（player2，未勾选也计入模拟单位）+ 怪物键不计。
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        fastestMinutes: 12,
        deaths: {
          player1: 30,
          player2: 6,
          '/monsters/abyssal_imp': 999,
          '/monsters/griffin': 12,
        },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    // 窗口内死亡总数 = 3 轮 × (30 + 6) = 108；每轮 = 108 ÷ 360 次通关 = 0.3。
    expect(result.playerDeaths).toBeCloseTo(EXPECTED_TARGETS * 108, 6);
    for (const row of result.targets) {
      expect(row.playerDeaths).toBeCloseTo(108, 6);
      expect(row.deathsPerRun).toBeCloseTo(0.3, 6);
    }
  });

  it('leaves the per-run deaths null when the engine never reports deaths or the target never clears', async () => {
    const { calculator } = createStores();
    const zeroHrid = calculator.catalog[0].actionHrid;

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 组合 0 回团灭（零通关）；组合 1 上报了消耗品但没上报 deaths（旧引擎）；其余正常上报。
    settleAllTargets(client, (targetIndex) => {
      if (targetIndex === 0) {
        return createRoundResult({ failed: 610, maxWave: 4 });
      }
      if (targetIndex === 1) {
        return createRoundResult({ completed: 120, maxWave: 50, consumablesUsed: {} });
      }
      return createRoundResult({
        completed: 120,
        maxWave: 50,
        consumablesUsed: {},
        deaths: { player1: 60 },
      });
    });
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    // 零通关组合：deathsPerRun 保持 null（不写回、不显示）。
    const zeroRow = result.targets.find((row) => row.dungeonHrid === zeroHrid && row.difficultyTier === 0);
    expect(zeroRow.deathsPerRun).toBeNull();
    // 未上报 deaths 的组合：null（展示端回落占位符），不得按 0 计入。
    expect(result.targets[1].deathsPerRun).toBeNull();
    // 正常组合：3 轮 × 60 ÷ 360 次通关 = 0.5。
    expect(result.targets[2].deathsPerRun).toBeCloseTo(0.5, 6);
    // 汇总只累计有上报的组合（10 个 × 180 = 1800）。
    expect(result.playerDeaths).toBeCloseTo((EXPECTED_TARGETS - 2) * 180, 6);
  });

  it('clamps and persists the simulation rounds setting', async () => {
    const { calculator } = createStores();
    expect(calculator.config.simulationRounds).toBe(3);

    calculator.setSimulationRounds(4);
    expect(calculator.config.simulationRounds).toBe(4);
    calculator.setSimulationRounds(99);
    expect(calculator.config.simulationRounds).toBe(10);
    calculator.setSimulationRounds(0);
    expect(calculator.config.simulationRounds).toBe(1);

    expect(normalizeDungeonCalculatorPersistedState({ config: { simulationRounds: 42 } }).config.simulationRounds).toBe(
      10,
    );
    expect(normalizeDungeonCalculatorPersistedState({}).config.simulationRounds).toBe(3);
  });

  it('derives the measured consumables cost per run and writes it back per target', async () => {
    const { calculator } = createStores();
    // 固定价格：让折算可手算（override 直接烘焙成市场价）。
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);
    calculator.setPriceOverride('/items/channeling_coffee', 'ask', 300);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 每轮：120 次通关、整队（1 人）吃 57 蛋糕 + 14 咖啡 → 花费 = 57×1500 + 14×300 = 89,700。
    // 每轮摊薄 = 3 轮合计 269,100 ÷ 360 次通关 ÷ 1 人 = 747.5（单人单轮口径）。
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        fastestMinutes: 12,
        consumablesUsed: {
          player1: { '/items/marsberry_cake': 57, '/items/channeling_coffee': 14 },
        },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    expect(result.appliedConsumablesTargets).toBe(EXPECTED_TARGETS);
    for (const row of result.targets) {
      expect(row.simConsumablesCost).toBeCloseTo(269100, 6);
      expect(row.simConsumablesCostPerRun).toBeCloseTo(747.5, 6);
      expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(747.5);
    }

    // 写回后逐行覆盖每日摊薄值：当前组合的单值覆盖与批量对比行同步生效。
    calculator.setDailyConsumablesCostMillions(11.52);
    const compareRow = calculator.compareRows.find(
      (row) =>
        row.dungeonHrid === calculator.config.dungeonHrid && row.difficultyTier === calculator.config.difficultyTier,
    );
    expect(calculator.currentConsumablesCostPerRunOverride).toBe(747.5);
    expect(compareRow.consumablesCostPerRun).toBe(747.5);
    expect(calculator.result.consumablesCostPerRun).toBe(747.5);
    // 每日手填值仍保留（未实测组合的兜底口径）。
    expect(calculator.result.dailyConsumablesCost).toBe(11_520_000);
  });

  it('attributes the measured consumables cost to each selected player and follows the active player', async () => {
    const { simulator, calculator } = createStores();
    // 勾选 2 名队员：各吃各的药，实测值按角色分别写回（不做整队摊薄）。
    simulator.players.forEach((player, index) => {
      player.selected = index < 2;
      simulator.setImportedProfileState(String(player.id), index < 2);
    });
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 每轮 player1 吃 2 个、player2 吃 1 个：3 轮合计 6 个 / 3 个 × 1500 = 9,000 / 4,500；
    // 每轮值 = 该角色窗口内花费 ÷ 360 次通关 = 25 / 12.5（药钱归属吃药的该角色本人）。
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        consumablesUsed: {
          player1: { '/items/marsberry_cake': 2 },
          player2: { '/items/marsberry_cake': 1 },
        },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const row = calculator.simulation.lastResult.targets[0];
    // 整队窗口内总量仍在（9,000 + 4,500），结果行携带按角色的每轮值。
    expect(row.simConsumablesCost).toBeCloseTo(13500, 6);
    expect(row.simConsumablesCostPerRunByPlayer).toEqual({ 1: 25, 2: 12.5 });
    // 当前角色（activePlayerId = '1'）的每轮值与写回值。
    expect(row.simConsumablesCostPerRun).toBeCloseTo(25, 6);
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(25);

    // 切换角色即换值：player2 的药钱独立生效（覆盖 / 批量对比行 / 当前组合结果同步切换）。
    simulator.setActivePlayer('2');
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(12.5);
    const compareRow = calculator.compareRows.find(
      (item) => item.dungeonHrid === row.dungeonHrid && item.difficultyTier === row.difficultyTier,
    );
    expect(compareRow.consumablesCostPerRun).toBe(12.5);
    expect(calculator.result.consumablesCostPerRunOverride).toBe(12.5);
    expect(calculator.result.consumablesCostPerRun).toBe(12.5);
  });

  it('keeps a selected player without reported consumables at zero and falls back for an unselected one', async () => {
    const { simulator, calculator } = createStores();
    simulator.players.forEach((player, index) => {
      player.selected = index < 2;
      simulator.setImportedProfileState(String(player.id), index < 2);
    });
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 只有 player1 上报消耗品；player2 引擎未建键 = 窗口内没吃到 → 该角色实测 0（不回落摊薄）。
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        consumablesUsed: { player1: { '/items/marsberry_cake': 1 } },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const row = calculator.simulation.lastResult.targets[0];
    expect(row.simConsumablesCostPerRunByPlayer).toEqual({ 1: 12.5, 2: 0 });
    simulator.setActivePlayer('2');
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(0);

    // 未参与模拟的角色（未勾选）：无实测值，回落每日摊薄口径。
    simulator.setActivePlayer('3');
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBeNull();
  });

  it('still writes back every participating player when the active player switches mid-run', async () => {
    const { simulator, calculator } = createStores();
    simulator.players.forEach((player, index) => {
      player.selected = index < 2;
      simulator.setImportedProfileState(String(player.id), index < 2);
    });
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 运行中把当前角色切到未参与模拟的 player3：写回仍覆盖参与模拟的 player1 / player2。
    simulator.setActivePlayer('3');
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        consumablesUsed: { player1: { '/items/marsberry_cake': 2 } },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const row = calculator.simulation.lastResult.targets[0];
    expect(row.simConsumablesCostPerRunByPlayer).toEqual({ 1: 25, 2: 0 });
    // 结果行回显按「运行开始时定格的角色」（player1）——运行中切换不改变本次回显。
    expect(row.simConsumablesCostPerRun).toBe(25);
    // 读侧按当前角色：player3 未参与模拟 → 无实测值，回落每日摊薄。
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBeNull();
    // 切回参与模拟的角色：实测值立即可用。
    simulator.setActivePlayer('1');
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(25);
    simulator.setActivePlayer('2');
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(0);
  });

  it('keeps a zero measured consumables cost (engine reported no eating) instead of falling back', async () => {
    const { calculator } = createStores();
    calculator.setDailyConsumablesCostMillions(11.52);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 引擎上报了消耗品字段但为空表（未吃到任何消耗品）→ 实测值 0 是合法值。
    settleAllTargets(client, () => createRoundResult({ completed: 120, maxWave: 50, consumablesUsed: {} }));
    await expect(pending).resolves.toBe(true);

    const row = calculator.simulation.lastResult.targets[0];
    expect(row.simConsumablesCost).toBe(0);
    expect(row.simConsumablesCostPerRun).toBe(0);
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(0);
    expect(calculator.currentConsumablesCostPerRunOverride).toBe(0);
    expect(calculator.result.consumablesCostPerRun).toBe(0);
  });

  it('skips the measured write-back for targets that never cleared or never reported consumables', async () => {
    const { calculator } = createStores();
    const zeroHrid = calculator.catalog[0].actionHrid;
    calculator.setRunMinutesOverride(zeroHrid, 0, 9);
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    settleAllTargets(client, (targetIndex) => {
      // 组合 0 回团灭（不写回）；组合 1 引擎未上报 consumablesUsed（跳过写回）；其余正常。
      if (targetIndex === 0) {
        return createRoundResult({ failed: 610, maxWave: 4 });
      }
      if (targetIndex === 1) {
        return createRoundResult({ completed: 60, maxWave: 50 });
      }
      return createRoundResult({
        completed: 60,
        maxWave: 50,
        consumablesUsed: { player1: { '/items/marsberry_cake': 1 } },
      });
    });
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    expect(result.appliedConsumablesTargets).toBe(EXPECTED_TARGETS - 2);
    expect(calculator.getConsumablesCostPerRunOverride(zeroHrid, 0)).toBeNull();
    const noDataRow = result.targets[1];
    expect(noDataRow.simConsumablesCostPerRun).toBeNull();
    expect(calculator.getConsumablesCostPerRunOverride(noDataRow.dungeonHrid, noDataRow.difficultyTier)).toBeNull();
    // 正常组合：3 轮 × 1 个蛋糕 × 1500 ÷ 180 次通关 = 25 每轮。
    const otherRow = result.targets[2];
    expect(otherRow.simConsumablesCost).toBeCloseTo(4500, 6);
    expect(otherRow.simConsumablesCostPerRun).toBeCloseTo(25, 6);
    expect(calculator.getConsumablesCostPerRunOverride(otherRow.dungeonHrid, otherRow.difficultyTier)).toBe(25);
  });

  it('keeps the daily fallback when consumables keys never match the simulated players', async () => {
    const { calculator } = createStores();
    calculator.setDailyConsumablesCostMillions(11.52);
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 键口径漂移守卫：引擎上报了 consumablesUsed，但键全是官方口径（/players/pN）而非本次
    // payload 玩家 hrid（playerN）。「上报了键但无一命中」视同未上报——跳过该组合整个实测
    // 写回（含补 0），保留每日摊薄口径，绝不把消耗品成本按 0 清零。
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        consumablesUsed: { '/players/p1': { '/items/marsberry_cake': 2 } },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    const row = result.targets[0];
    // 全部键未命中：按玩家结果留空（若进了补 0 循环会是 { 1: 0, 2: 0 }），无任何玩家写回。
    expect(row.simConsumablesCostPerRunByPlayer).toEqual({});
    expect(row.simConsumablesCostPerRun).toBeNull();
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBeNull();
    // 12 个组合全部被旁路，无一行进入实测写回。
    expect(result.appliedConsumablesTargets).toBe(0);
    // 每日手填值仍在：实测旁路的组合由读侧回落该兜底口径。
    expect(calculator.result.dailyConsumablesCost).toBe(11_520_000);
  });

  it('writes back only the matched players when consumables keys partially match', async () => {
    const { simulator, calculator } = createStores();
    // 勾选 2 名队员：player1 键命中；player2 的官方口径键漂移（命中数 > 0 不触发整组合旁路，
    // player2 沿用「引擎未建键」的补 0 语义）。
    simulator.players.forEach((player, index) => {
      player.selected = index < 2;
      simulator.setImportedProfileState(String(player.id), index < 2);
    });
    calculator.setPriceOverride('/items/marsberry_cake', 'ask', 1500);

    const pending = startSimulation(calculator);
    const client = await waitForBatchClient();

    // 部分命中（player1 命中、官方口径键未命中）：命中的玩家照常按真实值写回，漂移键不得
    // 触发整组合旁路；player2 的「未命中补 0」由既有用例（keeps a selected player ...）锁定。
    settleAllTargets(client, () =>
      createRoundResult({
        completed: 120,
        maxWave: 50,
        consumablesUsed: {
          player1: { '/items/marsberry_cake': 2 },
          '/players/p2': { '/items/marsberry_cake': 1 },
        },
      }),
    );
    await expect(pending).resolves.toBe(true);

    const result = calculator.simulation.lastResult;
    const row = result.targets[0];
    // player1：2 个 × 1500 × 3 轮 ÷ 360 次通关 = 25 每轮；漂移键（/players/p2）不参与折算。
    expect(row.simConsumablesCostPerRunByPlayer).toEqual({ 1: 25, 2: 0 });
    expect(row.simConsumablesCostPerRun).toBeCloseTo(25, 6);
    expect(calculator.getConsumablesCostPerRunOverride(row.dungeonHrid, row.difficultyTier)).toBe(25);
    // 部分命中不算「未上报」：所有组合照常写回。
    expect(result.appliedConsumablesTargets).toBe(EXPECTED_TARGETS);
  });
});

describe('dungeonCalculatorStore minutes per run by dungeon x tier', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets and clears overrides per dungeon x tier and exposes the effective rows', () => {
    const { calculator } = createStores();
    const firstHrid = calculator.catalog[0].actionHrid;
    const secondHrid = calculator.catalog[1].actionHrid;

    expect(calculator.getRunMinutesOverride(firstHrid, 0)).toBeNull();
    expect(calculator.setRunMinutesOverride(firstHrid, 0, 9.5)).toBe(true);
    expect(calculator.getRunMinutesOverride(firstHrid, 0)).toBe(9.5);
    // 同地牢相邻档位互不影响。
    expect(calculator.getRunMinutesOverride(firstHrid, 1)).toBeNull();

    // 非法输入：未知地牢 / 非法档位 / 非正数 / 非数均拒绝。
    expect(calculator.setRunMinutesOverride('/actions/combat/nope', 0, 9)).toBe(false);
    expect(calculator.setRunMinutesOverride(firstHrid, 3, 9)).toBe(false);
    expect(calculator.setRunMinutesOverride(firstHrid, 0, 0)).toBe(false);
    expect(calculator.setRunMinutesOverride(firstHrid, 0, 'bad')).toBe(false);

    // 行模型：覆盖组合用覆盖值、其余回落默认；每日轮数按有效值折算。
    const rows = calculator.runMinutesTargetRows;
    expect(rows).toHaveLength(EXPECTED_TARGETS);
    const row = rows.find((item) => item.dungeonHrid === firstHrid && item.difficultyTier === 0);
    expect(row.overrideRunMinutes).toBe(9.5);
    expect(row.effectiveRunMinutes).toBe(9.5);
    expect(row.runsPerDay).toBeCloseTo(1440 / 9.5, 6);
    const defaultRow = rows.find((item) => item.dungeonHrid === firstHrid && item.difficultyTier === 1);
    expect(defaultRow.overrideRunMinutes).toBeNull();
    expect(defaultRow.effectiveRunMinutes).toBe(defaultRow.defaultRunMinutes);

    // 当前选中组合的覆盖值随选择切换。
    calculator.setDungeonHrid(firstHrid);
    calculator.setDifficultyTier(0);
    expect(calculator.currentRunMinutesOverride).toBe(9.5);
    calculator.setDifficultyTier(2);
    expect(calculator.currentRunMinutesOverride).toBeNull();

    // 清除：回落默认；重复清除返回 false。
    expect(calculator.clearRunMinutesOverride(firstHrid, 0)).toBe(true);
    expect(calculator.getRunMinutesOverride(firstHrid, 0)).toBeNull();
    expect(calculator.clearRunMinutesOverride(firstHrid, 0)).toBe(false);
    // 未设置的相邻地牢不受影响。
    expect(calculator.getRunMinutesOverride(secondHrid, 0)).toBeNull();
  });

  it('keeps the batch comparison rows on their own minutes when the current target is overridden', () => {
    const { calculator } = createStores();
    const firstHrid = calculator.catalog[0].actionHrid;
    const secondHrid = calculator.catalog[1].actionHrid;

    // 当前组合 = 第一个地牢 × T0；改一格（即选中该格）写入覆盖值 8。
    expect(calculator.setDungeonHrid(firstHrid)).toBe(true);
    expect(calculator.setDifficultyTier(0)).toBe(true);
    expect(calculator.setRunMinutesOverride(firstHrid, 0, 8)).toBe(true);

    const compareRowFor = (hrid, tier) =>
      calculator.compareRows.find((row) => row.dungeonHrid === hrid && row.difficultyTier === tier);
    const defaultFor = (hrid, tier) =>
      calculator.runMinutesTargetRows.find((row) => row.key === `${hrid}|${tier}`).defaultRunMinutes;

    // 当前组合行 = 覆盖值 8；其余未覆盖行回落各自默认值——不得被当前组合覆盖值串掉。
    expect(compareRowFor(firstHrid, 0).runMinutes).toBe(8);
    expect(compareRowFor(firstHrid, 1).runMinutes).toBe(defaultFor(firstHrid, 1));
    expect(compareRowFor(firstHrid, 2).runMinutes).toBe(defaultFor(firstHrid, 2));
    expect(compareRowFor(secondHrid, 0).runMinutes).toBe(defaultFor(secondHrid, 0));
  });

  it('normalizes the persisted map and migrates the legacy single value', () => {
    const { calculator } = createStores();
    const [firstHrid, secondHrid] = [calculator.catalog[0].actionHrid, calculator.catalog[1].actionHrid];

    // 白名单与值域：未知地牢 / 越界档位 / 非正 / 非数 / 非对象全部静默丢弃。
    const normalized = normalizeDungeonCalculatorPersistedState({
      config: {
        runMinutesByDungeonTier: {
          [firstHrid]: { 0: 9.5, 1: 0, 2: 'bad', 5: 12 },
          [secondHrid]: 'nope',
          '/actions/combat/unknown': { 0: 3 },
        },
      },
    });
    expect(normalized.config.runMinutesByDungeonTier).toEqual({ [firstHrid]: { 0: 9.5 } });

    // 旧单值迁移到当前选中组合；新字段已有值时以新字段为准。
    const migrated = normalizeDungeonCalculatorPersistedState({
      config: { runMinutes: 11.5, dungeonHrid: secondHrid, difficultyTier: 1 },
    });
    expect(migrated.config.runMinutesByDungeonTier).toEqual({ [secondHrid]: { 1: 11.5 } });

    const preferred = normalizeDungeonCalculatorPersistedState({
      config: {
        runMinutes: 11.5,
        dungeonHrid: secondHrid,
        difficultyTier: 1,
        runMinutesByDungeonTier: { [secondHrid]: { 1: 20 } },
      },
    });
    expect(preferred.config.runMinutesByDungeonTier).toEqual({ [secondHrid]: { 1: 20 } });
  });

  it('normalizes the per-player consumables map and drops malformed entries', () => {
    const { calculator } = createStores();
    const [firstHrid, secondHrid] = [calculator.catalog[0].actionHrid, calculator.catalog[1].actionHrid];

    const normalized = normalizeDungeonCalculatorPersistedState({
      config: {
        consumablesCostPerRunByPlayerDungeonTier: {
          1: { [firstHrid]: { 0: 0, 1: 747.5, 2: 'bad', 5: 12 }, [secondHrid]: 'nope' },
          2: { '/actions/combat/unknown': { 0: 3 } },
          '': { [firstHrid]: { 0: 1 } },
          'bad id!': { [firstHrid]: { 0: 1 } },
          // 旧扁平格式（无玩家分层）不迁移：结构不符直接丢弃。
          [firstHrid]: { 0: 5 },
        },
      },
    });

    // 0 是合法实测值；越界档位 / 非数 / 未知地牢 / 非法玩家键全部静默丢弃。
    expect(normalized.config.consumablesCostPerRunByPlayerDungeonTier).toEqual({
      1: { [firstHrid]: { 0: 0, 1: 747.5 } },
    });
    expect(normalized.config.consumablesCostPerRunByPlayerDungeonTier[2]).toBeUndefined();
  });

  it('defaults the party size to 5 without imported data and follows the imported party afterwards', () => {
    const { simulator, calculator } = createStores();

    // 夹具默认给玩家 1 记了导入标记（模拟链路用例需要）：本用例从「无导入数据」起点验证联动，先清空。
    simulator.players.forEach((player) => {
      simulator.setImportedProfileState(String(player.id), false);
    });

    // 没导入数据：默认满编 5（2026-10-15 用户裁决）——空槽位勾选不带偏人数。
    expect(calculator.config.partySize).toBe(5);

    // 导入 4 人并勾选 → 跟随为 4（「导入数据后，根据数据来」）。
    simulator.players.forEach((player, index) => {
      if (index < 4) {
        simulator.setImportedProfileState(String(player.id), true);
      }
      player.selected = index < 4;
    });
    expect(calculator.config.partySize).toBe(4);
    expect(calculator.result.teamDaily).toBeCloseTo(calculator.result.perMemberDaily * 4, 6);

    // 手动改值仍可用（联动源不变时保持）；勾选再变化即按导入的勾选数重新对齐。
    calculator.setPartySize(2);
    expect(calculator.config.partySize).toBe(2);
    simulator.players[3].selected = false;
    expect(calculator.config.partySize).toBe(3);

    // 全部取消勾选：每次勾选变化都同步，最终停在最后一个非零人数（1）；0 人不会写成 0。
    simulator.players.forEach((player) => {
      player.selected = false;
    });
    expect(calculator.config.partySize).toBe(1);

    // 重置配置：回落默认 5，随后再按导入的勾选数对齐。
    calculator.resetConfig();
    expect(calculator.config.partySize).toBe(5);
    simulator.players[0].selected = true;
    expect(calculator.config.partySize).toBe(1);
  });
});
