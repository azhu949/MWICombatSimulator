import { afterEach, describe, expect, it, vi } from 'vitest';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { ONE_HOUR } from '../simulationDomain.js';
import {
  aggregateRoundMetrics,
  applyCandidateToPlayerConfig,
  applyCandidateToTriggerMap,
  buildCandidatePayload,
  collectMetrics,
  createDegenerateMetrics,
  evaluatePayload,
  readCurrentTriggers,
  resolveEnemyHpScale,
  resolveOptimizerResources,
} from '../triggerOptimizerSimulation.js';
import {
  cancelDedicatedWorkerRuns,
  isWorkerRunCancelledError,
  stopTriggerOptimizerWorkerRuns,
} from '../simulatorWorkerRuns.js';

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';

// 技能槽 1 的智力要求是 abilitySlotsLevelRequirementList[2] === 1，
// createEmptyPlayerConfig 的全 1 等级即可让它进入模拟（同语义探针）。
const ABILITY_SLOT = 1;

function findFirstAbilityWithDefaultTriggers() {
  const ability = Object.values(abilityDetailMap).find(
    (entry) =>
      entry?.isSpecialAbility !== true &&
      Array.isArray(entry?.defaultCombatTriggers) &&
      entry.defaultCombatTriggers.length > 0,
  );
  return ability?.hrid ?? '';
}

const ABILITY_HRID = findFirstAbilityWithDefaultTriggers();

function customTrigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

function buildPlayerConfig(triggerMap = {}) {
  const config = createEmptyPlayerConfig('1');
  config.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
  config.triggerMap = triggerMap;
  return config;
}

function candidateOf(triggers) {
  return {
    slotIndex: ABILITY_SLOT,
    abilityHrid: ABILITY_HRID,
    triggers,
    signature: triggers === null ? 'default' : JSON.stringify(triggers ?? []),
  };
}

// 最小可打分的 simResult：24h、240 次击杀、48000 总经验、零攻击/零掉落/零消耗。
function buildSimResult(overrides = {}) {
  return {
    simulatedTime: 24 * ONE_HOUR,
    encounters: 240,
    deaths: { player1: 0 },
    experienceGained: { player1: { attack: 48000 } },
    attacks: { player1: {} },
    consumablesUsed: { player1: {} },
    playerRanOutOfMana: { player1: false },
    ...overrides,
  };
}

class FakeWorkerClient {
  static instances = [];

  constructor() {
    this.handlers = {};
    this.stopSimulation = vi.fn();
    FakeWorkerClient.instances.push(this);
  }

  startSimulation(payload, handlers = {}) {
    this.payload = payload;
    this.handlers = handlers;
  }

  emit(type, ...args) {
    this.handlers[type]?.(...args);
  }
}

// §54 批量路径的桩：只有生产 WorkerClient 才有 startSimulationBatch，supportsSimulationBatch
// 据此把 evaluatePayload 分流到批量入口；这里只记录「一次评估建了几个 realm、发了哪些 payload」。
class BatchWorkerClient {
  static instances = [];

  constructor() {
    this.stopSimulation = vi.fn();
    this.batches = [];
    BatchWorkerClient.instances.push(this);
  }

  startSimulationBatch(payloads, handlers = {}) {
    this.batches.push({ payloads: Array.isArray(payloads) ? payloads : [], handlers });
  }

  emitBatchResult(simResult, index, batchIndex = this.batches.length - 1) {
    this.batches[batchIndex].handlers.onResult?.(simResult, index);
  }

  emitBatchError(error, index, batchIndex = this.batches.length - 1) {
    this.batches[batchIndex].handlers.onError?.(error, index);
  }

  emitBatchComplete(batchIndex = this.batches.length - 1) {
    this.batches[batchIndex].handlers.onComplete?.();
  }
}

afterEach(() => {
  FakeWorkerClient.instances = [];
  BatchWorkerClient.instances = [];
  cancelDedicatedWorkerRuns();
});

describe('triggerOptimizerSimulation', () => {
  describe('applyCandidateToTriggerMap', () => {
    it('default 候选删键，disabled 候选写空数组，custom 候选写 sanitize 结果', () => {
      const base = { [ABILITY_HRID]: [customTrigger(500)], '/items/food': [{ value: 1 }] };

      const returned = applyCandidateToTriggerMap(base, candidateOf(null));
      expect(returned).toBe(base);
      expect(Object.prototype.hasOwnProperty.call(base, ABILITY_HRID)).toBe(false);
      // 非目标键不动。
      expect(base['/items/food']).toEqual([{ value: 1 }]);

      applyCandidateToTriggerMap(base, candidateOf([]));
      expect(base).toEqual({ [ABILITY_HRID]: [], '/items/food': [{ value: 1 }] });

      applyCandidateToTriggerMap(base, candidateOf([customTrigger('500')]));
      expect(base[ABILITY_HRID]).toEqual([customTrigger(500)]);
    });

    it('非对象 triggerMap 回落为新建对象，缺失候选是安全空操作', () => {
      // 非对象输入不抛错：回落到新建的 {} 并照常应用候选。
      expect(applyCandidateToTriggerMap(null, candidateOf([]))).toEqual({ [ABILITY_HRID]: [] });
      const map = { [ABILITY_HRID]: [] };
      expect(applyCandidateToTriggerMap(map, null)).toBe(map);
    });
  });

  describe('applyCandidateToPlayerConfig', () => {
    it('深拷贝源配置：不污染原对象且强制 selected:true', () => {
      const source = buildPlayerConfig({ [ABILITY_HRID]: [customTrigger(500)] });
      source.selected = false;
      const snapshot = JSON.stringify(source);

      const cloned = applyCandidateToPlayerConfig(source, candidateOf([]));

      expect(JSON.stringify(source)).toBe(snapshot);
      expect(cloned).not.toBe(source);
      expect(cloned.selected).toBe(true);
      expect(cloned.triggerMap[ABILITY_HRID]).toEqual([]);
    });

    it('candidate=null 时保留当前 triggerMap（基线克隆）', () => {
      const source = buildPlayerConfig({ [ABILITY_HRID]: [customTrigger(500)] });
      const cloned = applyCandidateToPlayerConfig(source, null);
      expect(cloned.triggerMap).toEqual({ [ABILITY_HRID]: [customTrigger(500)] });
    });
  });

  describe('readCurrentTriggers', () => {
    it('缺失键补默认 DTO 并写回传入的 map（可变副本契约）', () => {
      const map = {};
      const triggers = readCurrentTriggers(map, ABILITY_HRID);
      expect(triggers.length).toBeGreaterThan(0);
      expect(map[ABILITY_HRID]).toBe(triggers);
    });
  });

  describe('buildCandidatePayload', () => {
    const settings = {
      mode: 'zone',
      zoneHrid: '/actions/combat/green_slimes',
      difficultyTier: 0,
      simulationTimeHours: 24,
    };

    function extractSlotTriggers(payload) {
      return payload.players.map((player) => player.abilities[ABILITY_SLOT].triggers.map((t) => t.conditionHrid));
    }

    it('payload 是 start_simulation 且触发器随候选变化（默认 vs 空 vs 自定义）', () => {
      const config = buildPlayerConfig({});

      const payloadDefault = buildCandidatePayload(config, settings, null, candidateOf(null));
      const payloadAlways = buildCandidatePayload(config, settings, null, candidateOf([]));
      const payloadCustom = buildCandidatePayload(config, settings, null, candidateOf([customTrigger(500)]));

      expect(payloadDefault.type).toBe('start_simulation');
      expect(extractSlotTriggers(payloadAlways)[0]).toEqual([]);
      expect(extractSlotTriggers(payloadDefault)[0].length).toBeGreaterThan(0);
      expect(extractSlotTriggers(payloadCustom)[0]).toEqual([CURRENT_HP]);
    });

    it('extra 对象透传到 payload', () => {
      const config = buildPlayerConfig({});
      const payload = buildCandidatePayload(config, settings, { mooPass: true }, candidateOf(null));
      expect(payload.extra).toMatchObject({ mooPass: true });
    });

    // 队伍载荷（2026-09-27，设计 §59）：队友按**冻结配置**一起进模拟，候选只改主角。
    it('队伍载荷：队友按冻结配置进模拟，候选只改主角', () => {
      const config = buildPlayerConfig({});
      const teammate = { ...buildPlayerConfig({}), id: '2', name: 'Mate' };

      const solo = buildCandidatePayload(config, settings, null, candidateOf([customTrigger(500)]));
      const party = buildCandidatePayload(config, settings, null, candidateOf([customTrigger(500)]), {
        teammates: [teammate],
      });

      expect(solo.players).toHaveLength(1);
      expect(party.players).toHaveLength(2);
      const [heroTriggers, mateTriggers] = extractSlotTriggers(party);
      expect(heroTriggers).toEqual([CURRENT_HP]);
      // 队友那一份触发器与它自己的基线逐值一致（配置冻结：候选只作用于主角）。
      const mateBaseline = extractSlotTriggers(buildCandidatePayload(teammate, settings, null, candidateOf(null)))[0];
      expect(mateTriggers).toEqual(mateBaseline);
    });
  });

  describe('resolveEnemyHpScale（区域真实怪物血量尺度）', () => {
    const JUNGLE = '/actions/combat/jungle_planet';
    const zonePayload = (difficultyTier) => ({ zone: { zoneHrid: JUNGLE, difficultyTier } });

    it('读引擎自己的口径（Zone + Monster 难度缩放后）：丛林 tier0 = 小怪 500 / BOSS 4400 / 一波 3200', () => {
      // 250 亿血量的 BOSS 与小怪不能共用一个阈值尺度 —— 这正是旧版「玩家 maxHp × 百分比」
      // 近似目标血量的毛病（对 500 血小怪写出 439 的斩杀线 ≈ 恒真）。
      // waveSize = 一波怪的**上限**人数（maxSpawnCount），2026-09-20 起随尺度一起给出：
      // 「已死怪数」类候选的阈值合法区间由它决定（≥ waveSize 恒假、≤ waveSize−1 恒真，§22.2）。
      expect(resolveEnemyHpScale(zonePayload(0))).toEqual({ min: 500, max: 4400, group: 3200, waveSize: 4 });
    });

    it('难度会缩放血量：同一区域 tier4 的尺度必须按同难度重算（不能沿用 tier0）', () => {
      const hard = resolveEnemyHpScale(zonePayload(4));
      expect(hard).toEqual({ min: 2500, max: 10300, group: 12400, waveSize: 4 });
      const base = resolveEnemyHpScale(zonePayload(0));
      expect(hard.min).toBeGreaterThan(base.min);
      expect(hard.group).toBeGreaterThan(base.group);
      // 人数上限是**区域**属性（刷新表），不随难度变化 —— 波内进度候选的阈值不该被难度改写。
      expect(hard.waveSize).toBe(base.waveSize);
    });

    it('缺 zone / 未知区域都降级为 null：错填的区域 hrid 不能把整次搜索带崩', () => {
      expect(resolveEnemyHpScale({})).toBeNull();
      expect(resolveEnemyHpScale(null)).toBeNull();
      expect(
        resolveEnemyHpScale({ zone: { zoneHrid: '/actions/combat/does_not_exist', difficultyTier: 0 } }),
      ).toBeNull();
    });
  });

  describe('resolveOptimizerResources（战斗属性 + 敌方血量尺度）', () => {
    it('同时给出 maxHp/maxMp 与 enemyHp（数值类候选的两种换算尺度）', () => {
      const payload = buildCandidatePayload(
        buildPlayerConfig(),
        { mode: 'zone', zoneHrid: '/actions/combat/jungle_planet', difficultyTier: 0, simulationTimeHours: 1 },
        null,
        null,
      );

      const resources = resolveOptimizerResources(payload, '1');

      expect(Number.isFinite(resources.maxHp)).toBe(true);
      expect(Number.isFinite(resources.maxMp)).toBe(true);
      expect(resources.enemyHp).toEqual({ min: 500, max: 4400, group: 3200, waveSize: 4 });
    });

    it('读不到战斗属性时返回 null（候选生成器据此只保留非数值锚点）', () => {
      expect(resolveOptimizerResources({}, '1')).toBeNull();
      expect(resolveOptimizerResources(null, '1')).toBeNull();
    });
  });

  describe('collectMetrics', () => {
    it('从 simResult 提取打 to 指标（dps/kills/xp 每小时、死亡、空蓝）', () => {
      const metrics = collectMetrics(buildSimResult(), { preferredPlayerId: '1' });
      expect(metrics).toMatchObject({
        dps: 0,
        killsPerHour: 10,
        xpPerHour: 2000,
        deathsPerHour: 0,
        ranOutOfMana: false,
      });
      expect(metrics.failed).toBeUndefined();
    });

    it('死亡与空蓝按玩家键换算', () => {
      const metrics = collectMetrics(
        buildSimResult({ deaths: { player1: 12 }, playerRanOutOfMana: { player1: true } }),
        { preferredPlayerId: '1' },
      );
      expect(metrics.deathsPerHour).toBeCloseTo(0.5, 6);
      expect(metrics.ranOutOfMana).toBe(true);
    });

    it('非对象输入与计算异常都退化为可打分的失败结构', () => {
      expect(collectMetrics(null)).toMatchObject({ failed: true });
      const explosive = buildSimResult();
      Object.defineProperty(explosive, 'encounters', {
        get() {
          throw new Error('boom');
        },
      });
      expect(collectMetrics(explosive)).toMatchObject({ failed: true, error: 'boom' });
    });
  });

  describe('aggregateRoundMetrics（重复次数聚合口径）', () => {
    it('数值指标取算术均值，空蓝计数与逐轮样本一并保留', () => {
      const aggregated = aggregateRoundMetrics([
        {
          dps: 100,
          dailyProfit: 10,
          dailyNoRngProfit: 10,
          xpPerHour: 1000,
          killsPerHour: 10,
          deathsPerHour: 0,
          ranOutOfMana: false,
        },
        {
          dps: 200,
          dailyProfit: 20,
          dailyNoRngProfit: 20,
          xpPerHour: 3000,
          killsPerHour: 30,
          deathsPerHour: 1,
          ranOutOfMana: true,
        },
      ]);
      expect(aggregated).toEqual({
        dps: 150,
        dailyProfit: 15,
        dailyNoRngProfit: 15,
        xpPerHour: 2000,
        killsPerHour: 20,
        deathsPerHour: 0.5,
        ranOutOfMana: true,
        ranOutOfManaCount: 1,
        rounds: 2,
        // 逐轮样本是配对统计的原料：与入参一一对应（同种子下标可直接相减）。
        samples: [
          {
            dps: 100,
            dailyProfit: 10,
            dailyNoRngProfit: 10,
            xpPerHour: 1000,
            killsPerHour: 10,
            deathsPerHour: 0,
            ranOutOfMana: false,
          },
          {
            dps: 200,
            dailyProfit: 20,
            dailyNoRngProfit: 20,
            xpPerHour: 3000,
            killsPerHour: 30,
            deathsPerHour: 1,
            ranOutOfMana: true,
          },
        ],
      });
    });

    it('任一场失败 → 整体退化为失败结构（失败抽样绝不混进均值）', () => {
      const aggregated = aggregateRoundMetrics([
        { dps: 100, ranOutOfMana: false },
        createDegenerateMetrics('worker crashed'),
      ]);
      expect(aggregated).toMatchObject({ failed: true, error: 'worker crashed' });
    });

    it('空列表与非数组输入都退化为失败结构而不是抛异常', () => {
      expect(aggregateRoundMetrics([])).toMatchObject({ failed: true });
      expect(aggregateRoundMetrics(null)).toMatchObject({ failed: true });
      expect(aggregateRoundMetrics([null, 'garbage'])).toMatchObject({ failed: true });
    });
  });

  describe('evaluatePayload', () => {
    it('用 trigger-optimizer scope 跑到结果并提取指标', async () => {
      const promise = evaluatePayload(
        { type: 'start_simulation' },
        { WorkerClientCtor: FakeWorkerClient, preferredPlayerId: '1', rounds: 1 },
      );
      const client = FakeWorkerClient.instances[0];
      client.emit('onResult', buildSimResult());

      const metrics = await promise;
      expect(metrics.killsPerHour).toBe(10);
      expect(client.stopSimulation).toHaveBeenCalledTimes(1);
    });

    it('桩没有批量能力时回退到逐场路径：每场一个新 worker，指标按均值聚合', async () => {
      const promise = evaluatePayload(
        { type: 'start_simulation', workerId: 'trigger-optimizer' },
        { WorkerClientCtor: FakeWorkerClient, preferredPlayerId: '1', rounds: 2 },
      );
      expect(FakeWorkerClient.instances).toHaveLength(1);
      // 每场抽样的 workerId 带轮次后缀：即便将来 worker 侧按 workerId 派生随机流，
      // 抽样之间也不会退化成同一条序列。
      expect(FakeWorkerClient.instances[0].payload.workerId).toBe('trigger-optimizer#r1');
      FakeWorkerClient.instances[0].emit('onResult', buildSimResult());

      await vi.waitFor(() => expect(FakeWorkerClient.instances).toHaveLength(2));
      expect(FakeWorkerClient.instances[1].payload.workerId).toBe('trigger-optimizer#r2');
      // 第二场：720 次击杀（30/h）、24 次死亡（1/h）。
      FakeWorkerClient.instances[1].emit('onResult', buildSimResult({ encounters: 720, deaths: { player1: 24 } }));

      const metrics = await promise;
      expect(metrics.killsPerHour).toBe(20);
      expect(metrics.deathsPerHour).toBeCloseTo(0.5, 6);
      expect(metrics.rounds).toBe(2);
      expect(metrics.failed).toBeUndefined();
    });

    it('单场抽样失败时整体退化（多轮里的一场崩溃不产出半真半假的分）', async () => {
      const promise = evaluatePayload({ type: 'start_simulation' }, { WorkerClientCtor: FakeWorkerClient, rounds: 2 });
      FakeWorkerClient.instances[0].emit('onResult', buildSimResult());
      await vi.waitFor(() => expect(FakeWorkerClient.instances).toHaveLength(2));
      FakeWorkerClient.instances[1].emit('onError', new Error('worker crashed'));

      await expect(promise).resolves.toMatchObject({ failed: true, error: 'worker crashed' });
    });

    it('worker 报错时退化为失败指标而不是抛异常', async () => {
      const promise = evaluatePayload({ type: 'start_simulation' }, { WorkerClientCtor: FakeWorkerClient, rounds: 1 });
      const client = FakeWorkerClient.instances[0];
      client.emit('onError', new Error('worker crashed'));

      await expect(promise).resolves.toMatchObject({ failed: true, error: 'worker crashed' });
    });

    it('同一组 seeds 逐场写入确定性 seed：公共随机数的实际载体', async () => {
      const promise = evaluatePayload(
        { type: 'start_simulation', workerId: 'trigger-optimizer' },
        { WorkerClientCtor: FakeWorkerClient, preferredPlayerId: '1', seeds: [11, 22] },
      );
      expect(FakeWorkerClient.instances[0].payload.seed).toBe(11);
      FakeWorkerClient.instances[0].emit('onResult', buildSimResult());

      await vi.waitFor(() => expect(FakeWorkerClient.instances).toHaveLength(2));
      expect(FakeWorkerClient.instances[1].payload.seed).toBe(22);
      FakeWorkerClient.instances[1].emit('onResult', buildSimResult({ encounters: 720 }));

      const metrics = await promise;
      expect(metrics.killsPerHour).toBe(20);
      expect(metrics.rounds).toBe(2);
    });

    it('未给 seeds 时按 rounds 从 workerId 派生确定性种子（回落路径也可复现）', async () => {
      const runOnce = async (index) => {
        const promise = evaluatePayload(
          { type: 'start_simulation', workerId: 'trigger-optimizer' },
          { WorkerClientCtor: FakeWorkerClient, rounds: 1 },
        );
        const client = FakeWorkerClient.instances[index];
        client.emit('onResult', buildSimResult());
        await promise;
        return client.payload.seed;
      };
      const first = await runOnce(0);
      expect(Number.isInteger(first)).toBe(true);
      expect(await runOnce(1)).toBe(first);
    });

    it('trigger-optimizer scope 的专用运行可被 stopTriggerOptimizerWorkerRuns 定向取消', async () => {
      const promise = evaluatePayload({ type: 'start_simulation' }, { WorkerClientCtor: FakeWorkerClient, rounds: 1 });
      stopTriggerOptimizerWorkerRuns();

      const error = await promise.catch((reason) => reason);
      expect(isWorkerRunCancelledError(error)).toBe(true);
    });

    it('§54 批量路径：一次评估只建一个 realm，逐场结果按序聚合', async () => {
      const promise = evaluatePayload(
        { type: 'start_simulation', workerId: 'trigger-optimizer' },
        { WorkerClientCtor: BatchWorkerClient, preferredPlayerId: '1', seeds: [11, 22] },
      );
      expect(BatchWorkerClient.instances).toHaveLength(1);
      const client = BatchWorkerClient.instances[0];
      const batch = client.batches[0];
      // 同一组种子按序写入（公共随机数的载体不变）+ 轮次后缀照旧。
      expect(batch.payloads.map((payload) => payload.seed)).toEqual([11, 22]);
      expect(batch.payloads.map((payload) => payload.workerId)).toEqual([
        'trigger-optimizer#r1',
        'trigger-optimizer#r2',
      ]);

      client.emitBatchResult(buildSimResult(), 0);
      client.emitBatchResult(buildSimResult({ encounters: 720, deaths: { player1: 24 } }), 1);
      client.emitBatchComplete();

      const metrics = await promise;
      expect(metrics.killsPerHour).toBe(20);
      expect(metrics.deathsPerHour).toBeCloseTo(0.5, 6);
      expect(metrics.rounds).toBe(2);
      expect(metrics.failed).toBeUndefined();
      expect(client.stopSimulation).toHaveBeenCalledTimes(1);
    });

    it('§54 批量路径：单场失败退化为失败样本（与逐场路径同款）', async () => {
      const promise = evaluatePayload(
        { type: 'start_simulation' },
        { WorkerClientCtor: BatchWorkerClient, preferredPlayerId: '1', seeds: [11, 22] },
      );
      const client = BatchWorkerClient.instances[0];
      client.emitBatchResult(buildSimResult(), 0);
      client.emitBatchError('worker crashed', 1);
      client.emitBatchComplete();

      await expect(promise).resolves.toMatchObject({ failed: true, error: 'worker crashed' });
    });

    it('§54 批量路径：取消以 code cancelled 拒绝整批', async () => {
      const promise = evaluatePayload(
        { type: 'start_simulation' },
        { WorkerClientCtor: BatchWorkerClient, preferredPlayerId: '1', seeds: [11, 22] },
      );
      stopTriggerOptimizerWorkerRuns();

      const error = await promise.catch((reason) => reason);
      expect(isWorkerRunCancelledError(error)).toBe(true);
    });
  });
});
