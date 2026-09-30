// 切片 5 生产 parity → 切片 21B（定案 D2）golden 快照：
// Rust `run_production_simulation` 在真实夹具 + 真实区域上的输出与
// `fixtures/golden/*.json` 的固定期望对账（JS 引擎已删除，oracle 语义由
// cargo test 的 128+ 用例承载，本套锁「wasm 输出字节不漂移」）。
// - minimal 结果（食物优化器路径）；
// - full-result（`minimalResult: false`，完整字段面 + HP/MP 时序快照）；
// - 副本 / 迷宫 / 卷轴 / 早停 / 观察器 / 成本剪枝全口径。
//
// 再生成：node scripts/generate-wasm-golden.mjs（GOLDEN_UPDATE=1 覆盖期望文件）。
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import Labyrinth from '../../combatsimulator/labyrinth.js';
import { buildSimulationExtraBuffs } from '../../shared/simulationExtraBuffs.js';
import { importSoloConfig } from '../importExportMapper.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../playerMapper.js';
import { buildSimulationExtra, buildSingleSimulationPayload } from '../simulationDomain.js';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import { buildProductionRequest, runWasmProductionSimulation } from '../wasmProductionBridge.js';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { simulateFoodOptimizerRound } from '../foodOptimizerSimulation.js';
import { getWasmProductionDiagnostics, setWasmProductionEngineForTests } from '../wasmProductionSimulation.js';
import { createFoodOptimizerFixture } from './support/foodOptimizerTestSupport.js';
import { expectMatchesGolden } from './support/goldenSnapshot.js';
import fixture from './fixtures/modernPlayerJunglePlanetFixture.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkgDir = resolve(root, 'engine', 'pkg');
const gluePath = resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = resolve(pkgDir, 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
const FIXTURE_DUNGEON_HRID = '/actions/combat/chimerical_den';
// 切片 16：迷宫（labyrinth）——第一只迷宫怪 + 一个真实补给箱 + 已购满/中档商店升级。
const FIXTURE_LABYRINTH_HRID = '/monsters/cyclops';
const FIXTURE_LABYRINTH_CRATE = '/items/basic_coffee_crate';
const FIXTURE_LABYRINTH_UPGRADES = {
  damage: 12,
  attack_speed: 7,
  cast_speed: 7,
  critical_rate: 7,
  experience: 7,
};
// 切片 17：战斗卷轴——真实卷轴物品（无限库存；1h 天然跨 2 个 30 分钟窗口）。
const FIXTURE_SCROLL_ITEM = '/items/seal_of_damage';

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

/**
 * 切片 16：迷宫（labyrinth）payload —— `mode: 'labyrinth'`（zone 为 null）、真实迷宫怪 +
 * 一个真实补给箱 + 5 项已购商店升级（升级 buff 只在迷宫内生效，类型全在引擎槽表内）。
 */
function buildLabyrinthPayload(hours, seed) {
  const settings = {
    ...createSettings(hours),
    mode: 'labyrinth',
    labyrinthHrid: FIXTURE_LABYRINTH_HRID,
    roomLevel: 100,
    labyrinthUpgrades: FIXTURE_LABYRINTH_UPGRADES,
  };
  const imported = importSoloConfig(JSON.stringify(fixture), createEmptyPlayerConfig(1), settings);
  const playersDto = buildPlayersForSimulation([{ ...imported.player, selected: true }]);
  const payload = buildSingleSimulationPayload(playersDto, settings, [FIXTURE_LABYRINTH_CRATE], {
    workerId: 'wasm-production-parity-labyrinth',
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = seed;
  return payload;
}

/**
 * 切片 17：战斗卷轴 payload —— 与 `buildPayload` 同构，额外打开卷轴开关并给玩家配置一个
 * 真实卷轴（无限库存）。`createSettings` 的时长决定跨过的 30 分钟窗口数。
 */
function buildScrollPayload(hours, seed) {
  const settings = { ...createSettings(hours), combatScrollsEnabled: true };
  const imported = importSoloConfig(JSON.stringify(fixture), createEmptyPlayerConfig(1), settings);
  imported.player.combatScrolls = { [FIXTURE_SCROLL_ITEM]: { quantity: null } };
  const playersDto = buildPlayersForSimulation([{ ...imported.player, selected: true }]);
  const payload = buildSingleSimulationPayload(playersDto, settings, [], {
    workerId: 'wasm-production-parity-scroll',
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = seed;
  return payload;
}

/** 按生产 worker 的装配方式构建活单位（玩家 + Zone），供 wasm 请求快照使用。 */
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

/** 切片 16：迷宫活单位装配——与 `worker.js` 的迷宫分支一致（zone 为 null、buff 取 labyrinth.buffs）。 */
function buildLabyrinthLivePieces(payload) {
  const extraBuffs = buildSimulationExtraBuffs(payload.extra || {});
  const labyrinth = new Labyrinth(
    payload.labyrinth.labyrinthHrid,
    payload.labyrinth.roomLevel,
    payload.labyrinth.crates,
    payload.labyrinth.shopUpgrades,
  );
  const players = payload.players.map((dto) => {
    const player = Player.createFromDTO(structuredClone(dto));
    player.zoneBuffs = labyrinth.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });
  return { labyrinth, players };
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

/** full-result 生产模拟（`minimalResult: false`，可选 HP/MP 可视化与战斗日志）。 */
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

/** 切片 16：Rust 侧迷宫单轮（请求带 labyrinth 三字段、无 zone）。 */
function runRustLabyrinthSimulation(engine, payload, extraOptions = {}) {
  const { labyrinth, players } = buildLabyrinthLivePieces(payload);
  const request = buildProductionRequest({
    players,
    zone: null,
    labyrinth,
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

/** 切片 17：卷轴 Rust 侧单轮（请求带 `combatScrollDefinitions` + 玩家 `combatScrolls` 配置）。 */
function runRustScrollSimulation(engine, payload, extraOptions = {}) {
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
      combatScrollsEnabled: true,
      isGuildTrial: false,
      ...extraOptions,
    },
  });
  return runWasmProductionSimulation(engine, request).simResult;
}

describe.runIf(wasmPackageBuilt)('wasm engine production golden (minimal + full result)', () => {
  it('matches the golden minimal-result output on the real fixture zone', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const rustSimResult = runRustProductionSimulation(engine, payload);
    expectMatchesGolden('minimal-1h', rustSimResult);

    // 结果必须真的跑过遭遇战（防止退化成空转对账）。
    expect(Object.keys(rustSimResult.deaths ?? {}).length).toBeGreaterThan(0);
    expect(rustSimResult.simulatedTime).toBeGreaterThan(0);
  });

  it('matches across seeds', async () => {
    const engine = await getEngine();
    for (const seed of [7, 2024]) {
      const payload = buildPayload(1, seed);
      const rustSimResult = runRustProductionSimulation(engine, payload);
      expectMatchesGolden(`minimal-1h-seed${seed}`, rustSimResult);
    }
  });

  // 切片 12：提前停止轮（候选轮 shouldStop → Rust earlyStop）。watchHrid 用怪物 hrid
  // 构造确定性死亡预算触发。
  it('matches the golden early-stop round (death budget) on the real fixture zone', async () => {
    const engine = await getEngine();
    const watchHrid = '/monsters/luna_empress';
    const deathLimit = 10;
    const payload = buildPayload(1, 101);

    const rustSimResult = runRustProductionSimulation(engine, payload, {
      earlyStop: { watchHrid, deathLimit },
    });
    expectMatchesGolden('minimal-earlystop', rustSimResult);

    // 确认真的提前停了（防止退化成跑满对照）。
    expect(rustSimResult.stoppedEarly).toBe(true);
    expect(rustSimResult.simulatedTime).toBeLessThan(payload.simulationTimeLimit);
    expect(rustSimResult.deaths[watchHrid]).toBe(11);
  });

  // deathLimit 不可达（等价 Infinity → null）时不提前停止。
  it('matches when the early-stop death limit is unreachable', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const rustSimResult = runRustProductionSimulation(engine, payload, {
      earlyStop: { watchHrid: 'player1', deathLimit: Infinity },
    });
    expectMatchesGolden('minimal-earlystop-unreachable', rustSimResult);
    expect(rustSimResult.stoppedEarly).toBe(false);
  });

  // 切片 13：观察器——真实夹具 + 玩家 food 槽塞 missing_hp/mp 触发器的消耗品（模拟候选轮），
  // 与 WASM `observers` 输出（thresholdRanges / inactiveMinimum）golden 对账。
  it('matches the golden threshold and inactive observers on the real fixture zone', async () => {
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
    const { simResult, observers } = runWasmProductionSimulation(engine, request);
    expectMatchesGolden('observers-1h', { simResult, observers });

    // 防退化：真的观察到了两个槽位。
    expect(observers.thresholdRanges).not.toBeNull();
    expect(observers.thresholdRanges).toHaveLength(2);
  });

  // 切片 13-3：生产默认时长（24h）的长时长回归——上方用例只覆盖 1h。
  // 走生产单轮函数 `simulateFoodOptimizerRound`（食物优化器真实 fixture，fly 区域），
  // 对照 baseline 轮（无早停）与候选轮（空蓝早停 + 阈值观察器）两条路径。
  it('matches the golden food-optimizer rounds at the production 24h horizon', async () => {
    const engine = await getEngine();
    setWasmProductionEngineForTests(engine);

    const fixture = createFoodOptimizerFixture({ foodSlots: 3, seconds: 86400, rounds: 3, thresholdStepPercent: 25 });
    const mpItem = fixture.items.find((item) => item.kind === 'mp');
    const candidate = buildFoodCandidate([{ ...mpItem, threshold: mpItem.thresholds[mpItem.thresholds.length >> 1] }]);

    const wasmRequest = structuredClone(fixture.request);
    wasmRequest.useWasmEngine = true;

    expect(getWasmProductionDiagnostics().engineUnavailable).toBe(false);
    const wasmBaseline = await simulateFoodOptimizerRound(wasmRequest, null, 1, undefined, Infinity, {
      collectThresholds: true,
    });
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('');
    expectMatchesGolden('optimizer-24h-baseline', wasmBaseline);

    const wasmCandidate = await simulateFoodOptimizerRound(wasmRequest, candidate, 1, undefined, Infinity, {
      collectThresholds: true,
    });
    expectMatchesGolden('optimizer-24h-candidate', wasmCandidate);
    // 防退化：候选轮确实触发早停 + 安装了观察器（阈值区间非空）。
    expect(wasmCandidate.stoppedEarly).toBe(true);
    expect(wasmCandidate.equivalentThresholds).toHaveLength(1);
  });

  // 切片 20：成本上界观察器——真实夹具 + top10 轮内成本剪枝（cutoff=0 → 首次真实食物
  // 消费后的检查点立即剪枝），Rust costBound 观察器承接。
  it('matches the golden cost-bound pruning round on the real fixture zone', async () => {
    const engine = await getEngine();
    setWasmProductionEngineForTests(engine);

    const fixture = createFoodOptimizerFixture({ foodSlots: 1, seconds: 600, rounds: 3 });
    fixture.request.searchMode = 'top10';
    const food = fixture.items.find((item) => item.hrid === '/items/star_fruit_yogurt');
    const candidate = buildFoodCandidate([{ ...food, threshold: food.thresholds.at(-1) }]);

    const wasmRequest = structuredClone(fixture.request);
    wasmRequest.useWasmEngine = true;
    const costBound = { cutoff: 0, completedCostPerHour: 0, totalRounds: fixture.request.rounds };

    const wasmSample = await simulateFoodOptimizerRound(wasmRequest, candidate, 1, undefined, Infinity, {
      collectThresholds: true,
      costBound,
    });
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('');
    expectMatchesGolden('optimizer-costbound-pruned', wasmSample);
    // 防退化：真剪枝（部分时长、有限下界、costPerHour=0）。
    expect(wasmSample.pruned).toBe('cost');
    expect(wasmSample.stoppedEarly).toBe(true);
    expect(wasmSample.simulatedTime).toBeLessThan(wasmRequest.payload.simulationTimeLimit);
    expect(Number.isFinite(wasmSample.costLowerBound)).toBe(true);
    expect(wasmSample.costPerHour).toBe(0);
  });

  // 切片 20：安装条件不满足（cutoff 非有限 → 不携带 costBound）时跑满整轮。
  it('matches when the cost-bound install guards reject the observer', async () => {
    const engine = await getEngine();
    setWasmProductionEngineForTests(engine);

    const fixture = createFoodOptimizerFixture({ foodSlots: 1, seconds: 600, rounds: 3 });
    fixture.request.searchMode = 'top10';
    const food = fixture.items.find((item) => item.hrid === '/items/star_fruit_yogurt');
    const candidate = buildFoodCandidate([{ ...food, threshold: food.thresholds.at(-1) }]);

    const wasmRequest = structuredClone(fixture.request);
    wasmRequest.useWasmEngine = true;
    const costBound = { cutoff: Infinity, completedCostPerHour: 0, totalRounds: fixture.request.rounds };

    const wasmSample = await simulateFoodOptimizerRound(wasmRequest, candidate, 1, undefined, Infinity, {
      collectThresholds: true,
      costBound,
    });
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('');
    expectMatchesGolden('optimizer-costbound-rejected', wasmSample);
    expect(wasmSample.stoppedEarly).toBe(false);
    expect(wasmSample).not.toHaveProperty('pruned');
  });

  // 切片 14：full-result（完整 SimResult 字段面）——经验记账（击杀快照 → 遭遇战提交的
  // 时序）、掉落上下文桶（含怪物实例难度档）与激怒层数。
  it('matches the golden full-result pipeline on the real fixture zone', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const rustSimResult = runRustFullResultSimulation(engine, payload);
    expectMatchesGolden('full-1h', rustSimResult);

    // 防退化：完整字段面必须真的有数据，否则对账退化成空结果。
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

  // 切片 14：可视化开启 → 1000-tick 时序快照随 simResult 一次性返回。
  it('matches the golden time-series snapshots when visualization is enabled', async () => {
    const engine = await getEngine();
    const payload = buildPayload(1, 101);

    const rustSimResult = runRustFullResultSimulation(engine, payload, { enableHpMpVisualization: true });
    expectMatchesGolden('full-1h-viz', rustSimResult);
    // 防退化：1h 内必然跨过多次 1000 事件边界。
    expect(rustSimResult.timeSeriesData.timestamps.length).toBeGreaterThan(0);
    expect(Object.keys(rustSimResult.timeSeriesData.players).length).toBeGreaterThan(0);
  });

  // 切片 14：生产 24h 长时长 full-result 回归（掉落桶跨增益窗口的合并/拆分与经验累加）。
  it('matches the golden full-result pipeline at the production 24h horizon', async () => {
    const engine = await getEngine();
    const payload = buildPayload(24, 101);

    const rustSimResult = runRustFullResultSimulation(engine, payload);
    expectMatchesGolden('full-24h', rustSimResult);
    // 防退化：24h 必然多次清场 + 多次提交经验。
    expect(rustSimResult.encounters).toBeGreaterThan(10);
    expect(Object.values(rustSimResult.experienceGained.player1).some((value) => value > 0)).toBe(true);
  });

  // 切片 15：副本（dungeon）波次机制 —— 逐波存活时间 / bossSpawns 清单 / maxWaveReached
  //（1h 未完成整副本 → 逐波计数分支）/ 团灭重开与失败波次计数全字段对账。
  it('matches the golden full-result dungeon pipeline on the real dungeon zone', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(1, 101);

    const rustSimResult = runRustFullResultSimulation(engine, payload);
    expectMatchesGolden('dungeon-1h', rustSimResult);

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

  // 切片 19：副本 + full-result + logCombatEvents —— 团灭日志由引擎生成，timestamp 是
  // 确定性字符串 `t+{simulationTime}`（UI 只用作 v-for key，不显示），一并进 golden。
  it('matches the golden full-result dungeon pipeline with combat-event logging (wipeEvents)', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(1, 101);

    const rustSimResult = runRustFullResultSimulation(engine, payload, { logCombatEvents: true });
    expectMatchesGolden('dungeon-1h-logs', rustSimResult);

    // 防退化：该夹具在 chimerical_den 反复团灭 → 必须有团灭日志负载。
    expect(rustSimResult.wipeEvents.length).toBeGreaterThan(0);
    expect(rustSimResult.wipeEvents.some((event) => event.logs.some((log) => log.ability === 'autoAttack'))).toBe(true);
    expect(rustSimResult.wipeEvents.every((event) => event.timestamp.startsWith('t+'))).toBe(true);
  });

  // 切片 15：副本 + minimal（优化器轮次形状：logCombatEvents=false + 时间线钩子为空操作）。
  it('matches the golden minimal-result dungeon pipeline (optimizer shape)', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(1, 101);

    const rustSimResult = runRustProductionSimulation(engine, payload);
    expectMatchesGolden('dungeon-minimal', rustSimResult);

    // 防退化：minimal 时间线被覆写为空操作，但副本计数与 bossSpawns 照常。
    expect(rustSimResult.isDungeon).toBe(true);
    expect(rustSimResult.timeSpentAlive).toEqual([]);
    expect(rustSimResult.dungeonsFailed).toBeGreaterThan(0);
    expect(rustSimResult.bossSpawns).toHaveLength(10);
  });

  // 切片 15：副本 24h 长时段回归 —— 大量团灭/重开循环下副本计数与聚合仍逐字段一致。
  it('matches the golden full-result dungeon pipeline at the 24h horizon', async () => {
    const engine = await getEngine();
    const payload = buildDungeonPayload(24, 101);

    const rustSimResult = runRustFullResultSimulation(engine, payload);
    expectMatchesGolden('dungeon-24h', rustSimResult);
    expect(rustSimResult.encounters).toBeGreaterThan(100);
    expect(rustSimResult.dungeonsFailed).toBeGreaterThan(100);
  });

  // 切片 16：迷宫（labyrinth）——无 zone 的单怪循环 + 120s 超时重启 + 补给箱/商店升级 buff。
  it('matches the golden labyrinth pipeline on the real labyrinth monster', async () => {
    const engine = await getEngine();
    const payload = buildLabyrinthPayload(1, 101);

    const rustSimResult = runRustLabyrinthSimulation(engine, payload);
    expectMatchesGolden('labyrinth-1h', rustSimResult);

    // 防退化：必须是迷宫路径，且单怪循环真的重启过（spawnedAt 推进或击杀计数 > 0）。
    expect(rustSimResult.isLabyrinth).toBe(true);
    expect(rustSimResult.isDungeon).toBe(false);
    expect(rustSimResult.labyrinthName).toBe(FIXTURE_LABYRINTH_HRID);
    expect(rustSimResult.roomLevel).toBe(100);
    expect(rustSimResult.zoneName).toBeUndefined();
    expect(rustSimResult.difficultyTier).toBeUndefined();
    expect(rustSimResult.scrollUsage.allowed).toBe(false);
    expect(rustSimResult.scrollUsage.ignoredReason).toBe('labyrinth');
    const monsterEntry = rustSimResult.timeSpentAlive.find((entry) => entry.name === FIXTURE_LABYRINTH_HRID);
    expect(monsterEntry).toBeDefined();
    expect(monsterEntry.alive).toBe(true);
    expect(monsterEntry.count > 0 || monsterEntry.spawnedAt > 0).toBe(true);
  });

  // 切片 16：迷宫 24h 长时段回归——大量团灭/超时重开循环下逐字段仍一致。
  it('matches the golden labyrinth pipeline at the 24h horizon', async () => {
    const engine = await getEngine();
    const payload = buildLabyrinthPayload(24, 101);

    const rustSimResult = runRustLabyrinthSimulation(engine, payload);
    expectMatchesGolden('labyrinth-24h', rustSimResult);
    // 防退化：24h 内必然发生多轮重开（击杀或全队阵亡都计入 deaths）。
    const totalDeaths = Object.values(rustSimResult.deaths).reduce((total, value) => total + value, 0);
    expect(totalDeaths).toBeGreaterThan(0);
  });

  // 切片 17：战斗卷轴（1h ≥ 2 个 30 分钟窗口）——窗口开启/续期/关闭、按源移除与
  // 逐击杀经验/掉落桶（buff 影响面）全字段对账。
  it('matches the golden combat-scroll pipeline on the real fixture zone', async () => {
    const engine = await getEngine();
    const payload = buildScrollPayload(1, 101);

    const rustSimResult = runRustScrollSimulation(engine, payload);
    expectMatchesGolden('scroll-1h', rustSimResult);

    // 防退化：1h 内应开 2 个 30 分钟窗口（半开区间 [0,1800s) [1800s,3600s)）。
    const entry = rustSimResult.scrollUsage.byPlayer.player1[FIXTURE_SCROLL_ITEM];
    expect(entry.openedCount).toBe(2);
    expect(entry.activeDurationNs).toBe(payload.simulationTimeLimit);
    expect(entry.exhausted).toBe(false);
    expect(rustSimResult.scrollUsage.allowed).toBe(true);
    expect(rustSimResult.scrollUsage.disabled).toBe(false);
  });

  // 切片 17：卷轴 24h 长时段回归——48 个窗口的续期/记账与跨窗口增益切换逐字段一致。
  it('matches the golden combat-scroll pipeline at the 24h horizon', async () => {
    const engine = await getEngine();
    const payload = buildScrollPayload(24, 101);

    const rustSimResult = runRustScrollSimulation(engine, payload);
    expectMatchesGolden('scroll-24h', rustSimResult);

    // 防退化：24h = 48 个 30 分钟窗口。
    const entry = rustSimResult.scrollUsage.byPlayer.player1[FIXTURE_SCROLL_ITEM];
    expect(entry.openedCount).toBe(48);
    expect(entry.activeDurationNs).toBe(payload.simulationTimeLimit);
  });
});
