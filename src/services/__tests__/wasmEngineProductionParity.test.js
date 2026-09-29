// 切片 5 生产 parity：Rust `run_production_simulation`（真实区域生成敌人 + 真实结果聚合）
// 与 JS `CombatSimulator` 在**真实夹具 + 真实区域**上的 simResult 逐字段对账：
// - minimal 结果（食物优化器路径 `FoodOptimizerSimResult`）；
// - 切片 14：full-result（`minimalResult: false`，完整 SimResult 字段面 + HP/MP 时序快照）。
//
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过。
// 对账契约（与 `engine/src/prod_probe.rs` 成对维护）：
// - 玩家 / 怪物在 JS 侧按生产路径构建（Player.createFromDTO / new Monster），
//   两侧共用同一份快照约定（wasmProductionBridge.dumpUnitSpec）；
// - `Math.random` 整轮替换为 `createSeededRandom(seed)`（Rust 为 Mulberry32）；
// - 支持边界见 `getProductionSupport`（切片 14 起含 full-result / 日志 / 可视化）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import CombatSimulator from '../../combatsimulator/combatSimulator.js';
import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import { buildSimulationExtraBuffs } from '../../shared/simulationExtraBuffs.js';
import { importSoloConfig } from '../importExportMapper.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../playerMapper.js';
import { createSeededRandom } from '../seededRandom.js';
import { buildSimulationExtra, buildSingleSimulationPayload } from '../simulationDomain.js';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import { buildProductionRequest, runWasmProductionSimulation } from '../wasmProductionBridge.js';
import { observeInactiveFoodThresholds } from '../foodOptimizerInactiveFood.js';
import { observeFoodOptimizerThresholds } from '../foodOptimizerPruning.js';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { simulateFoodOptimizerRound } from '../foodOptimizerSimulation.js';
import { getWasmProductionDiagnostics, setWasmProductionEngineForTests } from '../wasmProductionSimulation.js';
import { createFoodOptimizerFixture } from './support/foodOptimizerTestSupport.js';
import fixture from './fixtures/modernPlayerJunglePlanetFixture.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkgDir = resolve(root, 'engine', 'pkg');
const gluePath = resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = resolve(pkgDir, 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
const FIXTURE_DUNGEON_HRID = '/actions/combat/chimerical_den';

let enginePromise = null;
function getEngine() {
  if (!enginePromise) {
    enginePromise = loadWasmEngine({
      glueUrl: pathToFileURL(gluePath).href,
      moduleOrPath: readFile(wasmPath),
    }).then((engine) => {
      expect(engine, 'wasm engine must load when engine/pkg exists').not.toBeNull();
      return engine;
    });
  }
  return enginePromise;
}

function createSettings(hours) {
  return {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: '',
    difficultyTier: 1,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: hours,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: false,
  };
}

function buildPayload(hours, seed) {
  const settings = createSettings(hours);
  const imported = importSoloConfig(JSON.stringify(fixture), createEmptyPlayerConfig(1), settings);
  const playersDto = buildPlayersForSimulation([{ ...imported.player, selected: true }]);
  const payload = buildSingleSimulationPayload(playersDto, settings, [], {
    workerId: 'wasm-production-parity',
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = seed;
  return payload;
}

/**
 * 切片 15：副本（dungeon）payload —— 与 `buildPayload` 同构，只把目标切到副本区域。
 * 副本团灭日志（`wipeEvents` 含 `new Date().toISOString()` 墙钟时间戳）不可复现，
 * 两个副本用例都保持 `logCombatEvents: false`。
 */
function buildDungeonPayload(hours, seed) {
  const settings = { ...createSettings(hours), useDungeon: true, dungeonHrid: FIXTURE_DUNGEON_HRID };
  const imported = importSoloConfig(JSON.stringify(fixture), createEmptyPlayerConfig(1), settings);
  const playersDto = buildPlayersForSimulation([{ ...imported.player, selected: true }]);
  const payload = buildSingleSimulationPayload(playersDto, settings, [], {
    workerId: 'wasm-production-parity-dungeon',
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = seed;
  return payload;
}

/** 按生产 worker 的装配方式构建活单位（玩家 + Zone），供两侧各自使用（互不共享实例）。 */
function buildLivePieces(payload) {
  const extraBuffs = buildSimulationExtraBuffs(payload.extra || {});
  const zone = new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier);
  const players = payload.players.map((dto) => {
    const player = Player.createFromDTO(structuredClone(dto));
    player.zoneBuffs = zone.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });
  return { zone, players };
}

async function runJsProductionSimulation(payload, { shouldStop } = {}) {
  const { zone, players } = buildLivePieces(payload);
  const originalRandom = Math.random;
  Math.random = createSeededRandom(payload.seed >>> 0);
  try {
    const simulator = new CombatSimulator(players, zone, null, {
      minimalResult: true,
      logCombatEvents: false,
      enableHpMpVisualization: false,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    });
    return await simulator.simulate(payload.simulationTimeLimit, { shouldStop });
  } finally {
    Math.random = originalRandom;
  }
}

/**
 * 切片 13：JS 侧手动安装两个观察器（与 `foodOptimizerSimulation` 的 JS 分支同一路径），
 * 返回 `{ simResult, equivalentThresholds, inactiveFoodThresholds }` 供与 WASM `observers`
 * 输出逐字段对账。
 */
async function runJsObservedSimulation(payload, { watchHrid, candidate }) {
  const { zone, players } = buildLivePieces(payload);
  const originalRandom = Math.random;
  Math.random = createSeededRandom(payload.seed >>> 0);
  try {
    const simulator = new CombatSimulator(players, zone, null, {
      minimalResult: true,
      logCombatEvents: false,
      enableHpMpVisualization: false,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    });
    const player = simulator.players.find((entry) => entry.hrid === watchHrid);
    const readThresholds = observeFoodOptimizerThresholds(player, candidate);
    const readInactiveFood = observeInactiveFoodThresholds(simulator, watchHrid);
    const simResult = await simulator.simulate(payload.simulationTimeLimit);
    return { simResult, equivalentThresholds: readThresholds(), inactiveFoodThresholds: readInactiveFood() };
  } finally {
    Math.random = originalRandom;
  }
}

function runRustProductionSimulation(engine, payload, extraOptions = {}) {
  const { zone, players } = buildLivePieces(payload);
  const request = buildProductionRequest({
    players,
    zone,
    seed: payload.seed,
    simulationTimeLimit: payload.simulationTimeLimit,
    options: {
      minimalResult: true,
      logCombatEvents: false,
      enableHpMpVisualization: false,
      combatScrollsEnabled: false,
      isGuildTrial: false,
      ...extraOptions,
    },
  });
  return runWasmProductionSimulation(engine, request).simResult;
}

/**
 * 切片 14：full-result 生产模拟（`minimalResult: false`，可选 HP/MP 可视化）。
 * 与 `runJsProductionSimulation` 逐字同构，只把结果类与可视化开关换成完整版。
 */
async function runJsFullResultSimulation(payload, { shouldStop, enableHpMpVisualization = false } = {}) {
  const { zone, players } = buildLivePieces(payload);
  const originalRandom = Math.random;
  Math.random = createSeededRandom(payload.seed >>> 0);
  try {
    const simulator = new CombatSimulator(players, zone, null, {
      minimalResult: false,
      logCombatEvents: false,
      enableHpMpVisualization,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    });
    return await simulator.simulate(payload.simulationTimeLimit, { shouldStop });
  } finally {
    Math.random = originalRandom;
  }
}

/** 切片 14：full-result 的 Rust 侧配对（其余选项与 `runRustProductionSimulation` 一致）。 */
function runRustFullResultSimulation(engine, payload, extraOptions = {}) {
  const { zone, players } = buildLivePieces(payload);
  const request = buildProductionRequest({
    players,
    zone,
    seed: payload.seed,
    simulationTimeLimit: payload.simulationTimeLimit,
    options: {
      minimalResult: false,
      logCombatEvents: false,
      enableHpMpVisualization: false,
      combatScrollsEnabled: false,
      isGuildTrial: false,
      ...extraOptions,
    },
  });
  return runWasmProductionSimulation(engine, request).simResult;
}
/**
 * JS 结果先过一遍 JSON 投影：`undefined` 值的自有属性在序列化时消失，
 * 与 Rust `to_value()` 的「键不存在」语义对齐（worker postMessage 同样只消费可序列化字段）。
 */
function jsonProjection(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 逐字段定位第一处分歧（键序无关；数值要求逐位相等）。 */
function firstDiff(left, right, path = '$') {
  // 先短路完全相等的值（含两侧同为 null/undefined 的字段，如 unusedFoodThresholds）。
  if (left === right) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    if (typeof left === 'number' || typeof right === 'number') {
      if (left !== right) return `${path}: js=${String(left)} rust=${String(right)}`;
      return null;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) {
        return `${path}: array mismatch js=${JSON.stringify(left)} rust=${JSON.stringify(right)}`;
      }
    }
    if (left !== right) return `${path}: js=${JSON.stringify(left)} rust=${JSON.stringify(right)}`;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return `${path}: array mismatch js=${JSON.stringify(left)} rust=${JSON.stringify(right)}`;
    }
    if (left.length !== right.length) return `${path}: length js=${left.length} rust=${right.length}`;
    for (let index = 0; index < left.length; index += 1) {
      const diff = firstDiff(left[index], right[index], `${path}[${index}]`);
      if (diff) return diff;
    }
    return null;
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join(',') !== rightKeys.join(',')) {
      return `${path}: keys js=[${leftKeys.join(',')}] rust=[${rightKeys.join(',')}]`;
    }
    for (const key of leftKeys) {
      const diff = firstDiff(left[key], right[key], `${path}.${key}`);
      if (diff) return diff;
    }
  }
  return null;
}

describe.runIf(wasmPackageBuilt)('wasm engine production parity (minimal + full result)', () => {
  it('matches the JS minimal-result pipeline on the real fixture zone', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const jsSimResult = await runJsProductionSimulation(payload);
    const rustSimResult = runRustProductionSimulation(engine, payload);

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();

    // 结果必须真的跑过遭遇战（防止退化成空转对账）。
    expect(Object.keys(rustSimResult.deaths ?? {}).length).toBeGreaterThan(0);
    expect(rustSimResult.simulatedTime).toBeGreaterThan(0);
  });

  it('matches across seeds', async () => {
    const engine = await getEngine();
    for (const seed of [7, 2024]) {
      const payload = buildPayload(1, seed);
      const jsSimResult = await runJsProductionSimulation(payload);
      const rustSimResult = runRustProductionSimulation(engine, payload);
      expect(firstDiff(jsonProjection(jsSimResult), rustSimResult), `seed ${seed} must match exactly`).toBeNull();
    }
  });

  // 切片 12：提前停止轮（候选轮 shouldStop → Rust earlyStop）在真实夹具上逐字段对账。
  // watchHrid 用怪物 hrid 构造确定性死亡预算触发（谓词本身通用：读 deaths[watchHrid]）。
  it('matches early-stop rounds (death budget) on the real fixture zone', async () => {
    const engine = await getEngine();
    const watchHrid = '/monsters/luna_empress';
    const deathLimit = 10;
    const payload = buildPayload(1, 101);

    // 与 foodOptimizerSimulation 的候选轮 shouldStop 定义逐字一致。
    const shouldStop = (instance) =>
      instance.simResult.playerRanOutOfMana[watchHrid] === true ||
      (instance.simResult.deaths[watchHrid] || 0) > deathLimit;

    const jsSimResult = await runJsProductionSimulation(payload, { shouldStop });
    const rustSimResult = runRustProductionSimulation(engine, payload, {
      earlyStop: { watchHrid, deathLimit },
    });

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();
    // 确认真的提前停了（防止退化成跑满对照）。
    expect(rustSimResult.stoppedEarly).toBe(true);
    expect(rustSimResult.simulatedTime).toBeLessThan(payload.simulationTimeLimit);
    expect(rustSimResult.deaths[watchHrid]).toBe(11);
  });

  // deathLimit 不可达（等价 Infinity → null）时不提前停止，与 JS 无死亡分支一致。
  it('matches when the early-stop death limit is unreachable', async () => {
    const engine = await getEngine();
    const watchHrid = 'player1';
    const payload = buildPayload(1, 101);

    const jsSimResult = await runJsProductionSimulation(payload, {
      shouldStop: (instance) => instance.simResult.playerRanOutOfMana[watchHrid] === true,
    });
    const rustSimResult = runRustProductionSimulation(engine, payload, {
      earlyStop: { watchHrid, deathLimit: Infinity },
    });

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();
    expect(rustSimResult.stoppedEarly).toBe(false);
  });

  // 切片 13：观察器 parity——真实夹具 + 玩家 food 槽塞 missing_hp/mp 触发器的消耗品
  //（模拟候选轮；food 与 candidate.slots 的对应关系与生产构造一致），JS 侧手动装两个
  // 观察器，与 WASM `observers` 输出（thresholdRanges / inactiveMinimum）逐字段对账。
  it('matches threshold and inactive observers on the real fixture zone', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);
    const hpThreshold = 100;
    const mpThreshold = 50;
    const playerDto = payload.players.find((entry) => entry.hrid === 'player1');
    playerDto.food = [
      {
        hrid: '/items/blackberry_donut',
        triggers: [
          {
            dependencyHrid: '/combat_trigger_dependencies/self',
            conditionHrid: '/combat_trigger_conditions/missing_hp',
            comparatorHrid: '/combat_trigger_comparators/greater_than_equal',
            value: hpThreshold,
          },
        ],
      },
      {
        hrid: '/items/apple_gummy',
        triggers: [
          {
            dependencyHrid: '/combat_trigger_dependencies/self',
            conditionHrid: '/combat_trigger_conditions/missing_mp',
            comparatorHrid: '/combat_trigger_comparators/greater_than_equal',
            value: mpThreshold,
          },
        ],
      },
      null,
    ];
    const candidate = {
      slots: [
        { hrid: '/items/blackberry_donut', kind: 'hp', threshold: hpThreshold },
        { hrid: '/items/apple_gummy', kind: 'mp', threshold: mpThreshold },
      ],
    };

    const js = await runJsObservedSimulation(payload, { watchHrid: 'player1', candidate });

    const { zone, players } = buildLivePieces(payload);
    const request = buildProductionRequest({
      players,
      zone,
      seed: payload.seed,
      simulationTimeLimit: payload.simulationTimeLimit,
      options: {
        minimalResult: true,
        logCombatEvents: false,
        enableHpMpVisualization: false,
        combatScrollsEnabled: false,
        isGuildTrial: false,
        observers: { watchHrid: 'player1' },
      },
    });
    const { simResult: rustSimResult, observers } = runWasmProductionSimulation(engine, request);

    // simResult 不受观察影响（观察器是纯读窥视）。
    expect(firstDiff(jsonProjection(js.simResult), rustSimResult)).toBeNull();
    // 阈值区间逐字段对账（hrid/kind/min/max）。
    expect(observers.thresholdRanges).not.toBeNull();
    expect(firstDiff(jsonProjection(js.equivalentThresholds), observers.thresholdRanges)).toBeNull();
    // 闲置下界逐字段对账（hp/mp）。
    expect(observers.inactiveMinimum).not.toBeNull();
    expect(firstDiff(jsonProjection(js.inactiveFoodThresholds), observers.inactiveMinimum)).toBeNull();
    // 防退化：两侧都真的观察到了两个槽位。
    expect(observers.thresholdRanges).toHaveLength(2);
  });

  // 切片 13-3：生产默认时长（24h）的长时长回归——上方用例只覆盖 1h。
  // 走生产单轮函数 `simulateFoodOptimizerRound`（食物优化器真实 fixture，fly 区域），
  // 对照 baseline 轮（无早停）与候选轮（空蓝早停 + 阈值观察器）两条路径。
  it('matches the food-optimizer rounds at the production 24h horizon', async () => {
    const engine = await getEngine();
    setWasmProductionEngineForTests(engine);

    const fixture = createFoodOptimizerFixture({ foodSlots: 3, seconds: 86400, rounds: 3, thresholdStepPercent: 25 });
    const mpItem = fixture.items.find((item) => item.kind === 'mp');
    const candidate = buildFoodCandidate([{ ...mpItem, threshold: mpItem.thresholds[mpItem.thresholds.length >> 1] }]);

    const jsRequest = structuredClone(fixture.request);
    const wasmRequest = structuredClone(fixture.request);
    wasmRequest.useWasmEngine = true;

    const jsBaseline = await simulateFoodOptimizerRound(jsRequest, null, 1, undefined, Infinity, {
      collectThresholds: true,
    });
    // 防退化：wasm 轮必须真走了 wasm（引擎注入成功且无回退），否则对照退化成 JS vs JS。
    expect(getWasmProductionDiagnostics().engineUnavailable).toBe(false);
    const wasmBaseline = await simulateFoodOptimizerRound(wasmRequest, null, 1, undefined, Infinity, {
      collectThresholds: true,
    });
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('');
    expect(firstDiff(jsonProjection(jsBaseline), jsonProjection(wasmBaseline))).toBeNull();

    const jsCandidate = await simulateFoodOptimizerRound(jsRequest, candidate, 1, undefined, Infinity, {
      collectThresholds: true,
    });
    const wasmCandidate = await simulateFoodOptimizerRound(wasmRequest, candidate, 1, undefined, Infinity, {
      collectThresholds: true,
    });
    expect(firstDiff(jsonProjection(jsCandidate), jsonProjection(wasmCandidate))).toBeNull();
    // 防退化：候选轮确实触发早停 + 安装了观察器（阈值区间非空）。
    expect(wasmCandidate.stoppedEarly).toBe(true);
    expect(wasmCandidate.equivalentThresholds).toHaveLength(1);
  });

  // 切片 14：full-result（完整 SimResult 字段面）逐字段对账——经验记账
  //（击杀快照 → 遭遇战提交的时序）、掉落上下文桶（含怪物实例难度档）与激怒层数。
  it('matches the JS full-result pipeline on the real fixture zone', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const jsSimResult = await runJsFullResultSimulation(payload);
    const rustSimResult = runRustFullResultSimulation(engine, payload);

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();

    // 防退化：完整字段面必须真的有数据，否则对账退化成两侧空结果。
    expect(rustSimResult.encounters).toBeGreaterThan(0);
    expect(Object.keys(rustSimResult.experienceGained).length).toBeGreaterThan(0);
    expect(Object.keys(rustSimResult.dropContextBuckets).length).toBeGreaterThan(0);
    const gains = rustSimResult.experienceGained.player1;
    expect(Object.keys(gains).sort()).toEqual([
      'attack',
      'defense',
      'intelligence',
      'magic',
      'melee',
      'ranged',
      'stamina',
    ]);
    expect(Object.values(gains).some((value) => value > 0)).toBe(true);
    expect(rustSimResult.wipeEvents).toEqual([]);
  });

  // 切片 14：可视化开启 → 1000-tick 时序快照随 simResult 一次性返回（wasm 无流式 progress），
  // `timeSeriesData` 逐字段与 JS 一致。
  it('matches the JS time-series snapshots when visualization is enabled', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const jsSimResult = await runJsFullResultSimulation(payload, { enableHpMpVisualization: true });
    const rustSimResult = runRustFullResultSimulation(engine, payload, { enableHpMpVisualization: true });

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();
    // 防退化：1h 内必然跨过多次 1000 事件边界。
    expect(jsSimResult.timeSeriesData.timestamps.length).toBeGreaterThan(0);
    expect(Object.keys(rustSimResult.timeSeriesData.players).length).toBeGreaterThan(0);
  });

  // 切片 14：生产 24h 长时长 full-result 回归（掉落桶跨增益窗口的合并/拆分与经验累加）。
  it('matches the JS full-result pipeline at the production 24h horizon', async () => {
    const engine = await getEngine();
    const payload = buildPayload(24, 101);

    const jsSimResult = await runJsFullResultSimulation(payload);
    const rustSimResult = runRustFullResultSimulation(engine, payload);

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();
    // 防退化：24h 必然多次清场 + 多次提交经验。
    expect(rustSimResult.encounters).toBeGreaterThan(10);
    expect(Object.values(rustSimResult.experienceGained.player1).some((value) => value > 0)).toBe(true);
  });

  // 切片 15：副本（dungeon）波次机制 —— 逐波存活时间 / bossSpawns 清单 / maxWaveReached
  //（1h 未完成整副本 → 逐波计数分支）/ 团灭重开与失败波次计数全字段对账。
  it('matches the JS full-result dungeon pipeline on the real dungeon zone', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(1, 101);

    const jsSimResult = await runJsFullResultSimulation(payload);
    const rustSimResult = runRustFullResultSimulation(engine, payload);

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();

    // 防退化：fixture 玩家在 chimerical_den 反复团灭（怪物档位高于其装备），本用例因此覆盖
    // 「逐波存活时间 + 团灭重开 + 失败波次计数」；1h 内打不完 50 波 → maxWaveReached 走
    // 逐波计数分支（完成整副本的分支由 Rust 单测 `dungeon_waves_advance_and_finalize_summary` 覆盖）。
    expect(rustSimResult.isDungeon).toBe(true);
    expect(rustSimResult.dungeonsCompleted).toBe(0);
    expect(rustSimResult.dungeonsFailed).toBeGreaterThan(0);
    expect(rustSimResult.maxWaveReached).toBeGreaterThan(0);
    expect(rustSimResult.timeSpentAlive.some((entry) => entry.name === '#1')).toBe(true);
    expect(rustSimResult.bossSpawns).toHaveLength(10);
    expect(rustSimResult.wipeEvents).toEqual([]);
  });

  // 切片 15：副本 + minimal（优化器轮次形状：logCombatEvents=false + 时间线钩子为空操作）。
  it('matches the JS minimal-result dungeon pipeline (optimizer shape)', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(1, 101);

    const jsSimResult = await runJsProductionSimulation(payload);
    const rustSimResult = runRustProductionSimulation(engine, payload);

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();

    // 防退化：minimal 时间线被覆写为空操作，但副本计数与 bossSpawns 照常。
    expect(rustSimResult.isDungeon).toBe(true);
    expect(rustSimResult.timeSpentAlive).toEqual([]);
    expect(rustSimResult.dungeonsFailed).toBeGreaterThan(0);
    expect(rustSimResult.bossSpawns).toHaveLength(10);
  });

  // 切片 15：副本 24h 长时段回归 —— 大量团灭/重开循环下副本计数与聚合仍逐字段一致。
  it('matches the JS full-result dungeon pipeline at the 24h horizon', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(24, 101);

    const jsSimResult = await runJsFullResultSimulation(payload);
    const rustSimResult = runRustFullResultSimulation(engine, payload);

    expect(firstDiff(jsonProjection(jsSimResult), rustSimResult)).toBeNull();
    expect(rustSimResult.encounters).toBeGreaterThan(100);
    expect(rustSimResult.dungeonsFailed).toBeGreaterThan(100);
  });
});
