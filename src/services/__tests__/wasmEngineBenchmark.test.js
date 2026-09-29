// 切片 6 性能对照基准（默认跳过，用 `npm run benchmark:wasm-engine` 运行）。
//
// 对账口径：**真实夹具 + 真实区域 + minimal 结果**（食物优化器生产路径），两侧各跑 N 轮，
// 比较「引擎单轮耗时」中位数；wasm 侧计入请求快照 + JSON 往返（应用真实要付的开销）。
// 每轮都重建玩家实例（与 worker 每轮装配一致），模板缓存跨轮复用（与 worker realm 一致）。
//
// 环境变量：WASM_BENCH_ROUNDS（默认 5）、WASM_BENCH_HOURS（默认 1）、WASM_BENCH_SEED（默认 101）。
//
// 三个口径：minimal（食物优化器）、full-result（首页单轮 + 可视化）、
// 副本 full-result（切片 15，chimerical_den）。
import { existsSync, writeFileSync } from 'node:fs';
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
import fixture from './fixtures/modernPlayerJunglePlanetFixture.json';

const benchEnabled = process.env.WASM_BENCH === '1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const gluePath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine.js');
const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

const ROUNDS = Number(process.env.WASM_BENCH_ROUNDS ?? 5);
const HOURS = Number(process.env.WASM_BENCH_HOURS ?? 1);
const SEED = Number(process.env.WASM_BENCH_SEED ?? 101);
const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
// 切片 15：副本口径。fixture 玩家在 chimerical_den 反复团灭（打不完整副本），基准覆盖
// 团灭重开 + 逐波计数路径；完整副本完成分支由 Rust 单测覆盖（见 simulator.rs 测试模块）。
const FIXTURE_DUNGEON_HRID = '/actions/combat/chimerical_den';

function buildPayload({ dungeon = false } = {}) {
  const settings = {
    mode: 'zone',
    runScope: 'single',
    useDungeon: dungeon,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: dungeon ? FIXTURE_DUNGEON_HRID : '',
    difficultyTier: 1,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: HOURS,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: false,
  };
  const imported = importSoloConfig(JSON.stringify(fixture), createEmptyPlayerConfig(1), settings);
  const playersDto = buildPlayersForSimulation([{ ...imported.player, selected: true }]);
  const payload = buildSingleSimulationPayload(playersDto, settings, [], {
    workerId: 'wasm-bench',
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = SEED;
  return payload;
}

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

async function runJsRound(payload, { minimal, enableHpMpVisualization }) {
  const setupStartedAt = performance.now();
  const { zone, players } = buildLivePieces(payload);
  const setupMs = performance.now() - setupStartedAt;
  const originalRandom = Math.random;
  Math.random = createSeededRandom(payload.seed >>> 0);
  try {
    const simulator = new CombatSimulator(players, zone, null, {
      minimalResult: minimal,
      logCombatEvents: false,
      enableHpMpVisualization,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    });
    const engineStartedAt = performance.now();
    const result = await simulator.simulate(payload.simulationTimeLimit);
    return { result, setupMs, engineMs: performance.now() - engineStartedAt };
  } finally {
    Math.random = originalRandom;
  }
}

function runWasmRound(engine, payload, { minimal, enableHpMpVisualization }) {
  const setupStartedAt = performance.now();
  const { zone, players } = buildLivePieces(payload);
  const request = buildProductionRequest({
    players,
    zone,
    seed: payload.seed,
    simulationTimeLimit: payload.simulationTimeLimit,
    options: {
      minimalResult: minimal,
      logCombatEvents: false,
      enableHpMpVisualization,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    },
  });
  const requestBytes = JSON.stringify(request).length;
  const setupMs = performance.now() - setupStartedAt;
  const engineStartedAt = performance.now();
  const { simResult } = runWasmProductionSimulation(engine, request);
  return { result: simResult, setupMs, engineMs: performance.now() - engineStartedAt, requestBytes };
}

/**
 * 键序无关的 JSON 投影：两侧聚合结构的有序表与对象字面量键序不同，值必须一致；
 * 先过一遍 JSON 往返把 `undefined` 自有属性归一为「键不存在」（Rust 侧省略键的语义）。
 */
function canonicalJson(value) {
  return canonicalize(JSON.parse(JSON.stringify(value)));
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function loadBenchEngine() {
  return loadWasmEngine({
    glueUrl: pathToFileURL(gluePath).href,
    moduleOrPath: readFile(wasmPath),
  });
}

/** 单口径 A/B：两侧各跑 ROUNDS 轮（含预热，不计量），打印中位数并返回两侧结果。 */
async function runBenchmark(engine, payload, benchOptions, label) {
  const jsTimes = [];
  const wasmTimes = [];
  const jsSetupTimes = [];
  const wasmSetupTimes = [];
  const jsEngineTimes = [];
  const wasmEngineTimes = [];
  let jsResult = null;
  let wasmResult = null;
  let requestBytes = 0;

  // 预热（模板缓存 + wasm 实例化 + JIT），不计量。
  jsResult = (await runJsRound(payload, benchOptions)).result;
  wasmResult = runWasmRound(engine, payload, benchOptions).result;

  for (let round = 0; round < ROUNDS; round += 1) {
    let startedAt = performance.now();
    const jsRound = await runJsRound(payload, benchOptions);
    jsTimes.push(performance.now() - startedAt);
    jsSetupTimes.push(jsRound.setupMs);
    jsEngineTimes.push(jsRound.engineMs);
    jsResult = jsRound.result;

    startedAt = performance.now();
    const wasmRound = runWasmRound(engine, payload, benchOptions);
    wasmTimes.push(performance.now() - startedAt);
    wasmSetupTimes.push(wasmRound.setupMs);
    wasmEngineTimes.push(wasmRound.engineMs);
    wasmResult = wasmRound.result;
    requestBytes = wasmRound.requestBytes;
  }

  const jsMedian = median(jsTimes);
  const wasmMedian = median(wasmTimes);
  console.log(
    [
      '',
      `=== wasm engine production benchmark · ${label} (${HOURS}h simulated, ${ROUNDS} rounds, seed ${SEED}) ===`,
      `JS   total ${formatMs(jsMedian)}  = 装配 ${formatMs(median(jsSetupTimes))} + 引擎 ${formatMs(median(jsEngineTimes))}`,
      `WASM total ${formatMs(wasmMedian)}  = 装配/快照 ${formatMs(median(wasmSetupTimes))} + 引擎 ${formatMs(median(wasmEngineTimes))}`,
      `speedup (JS/WASM) = ${(jsMedian / wasmMedian).toFixed(3)}x   请求 JSON ${requestBytes} bytes`,
      `JS deaths ${JSON.stringify(jsResult.deaths)}`,
      `WASM deaths ${JSON.stringify(wasmResult.deaths)}`,
      '',
    ].join('\n'),
  );
  return { jsResult, wasmResult };
}

describe.runIf(benchEnabled && wasmPackageBuilt)('wasm engine production benchmark', () => {
  it('compares JS and WASM on the real minimal-result workload', async () => {
    const engine = await loadBenchEngine();
    expect(engine).not.toBeNull();

    const payload = buildPayload();

    // 可选：把本次基准的生产请求导出为 JSON，供原生 profiling 使用
    // （`$env:WASM_BENCH_DUMP='<path>'; npm run benchmark:wasm-engine`）。
    if (process.env.WASM_BENCH_DUMP) {
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
        },
      });
      writeFileSync(process.env.WASM_BENCH_DUMP, JSON.stringify(request));
      console.log(`request JSON dumped to ${process.env.WASM_BENCH_DUMP}`);
    }

    const { jsResult, wasmResult } = await runBenchmark(
      engine,
      payload,
      { minimal: true, enableHpMpVisualization: false },
      'minimal（食物优化器口径）',
    );

    // 顺带再确认一次两侧结果一致（避免基准跑在错误的分支上）。
    expect(canonicalJson(wasmResult)).toBe(canonicalJson(jsResult));
  }, 600000);

  // 切片 14：首页单轮口径（full-result + HP/MP 可视化开启）——经验记账、掉落上下文桶
  // 与每 1000 事件的时序快照全部计入两侧引擎耗时。
  it('compares JS and WASM on the full-result workload', async () => {
    const engine = await loadBenchEngine();
    expect(engine).not.toBeNull();

    const payload = buildPayload();
    const { jsResult, wasmResult } = await runBenchmark(
      engine,
      payload,
      { minimal: false, enableHpMpVisualization: true },
      'full-result（首页单轮 + 可视化）',
    );

    // 防退化：两侧都必须真的采到时序快照（否则对照跑在空负载上）。
    expect(wasmResult.timeSeriesData.timestamps.length).toBeGreaterThan(0);
    expect(canonicalJson(wasmResult)).toBe(canonicalJson(jsResult));
  }, 600000);

  // 切片 15：副本口径（chimerical_den，full-result）——波次生成 / 团灭重开 / 逐波存活时间
  // 与失败计数全在计时范围内。fixture 玩家在该副本反复团灭（打不完整副本），因此本口径
  // 覆盖团灭路径；完整副本完成分支由 Rust 单测覆盖（见 simulator.rs 的副本单测）。
  it('compares JS and WASM on the real dungeon workload', async () => {
    const engine = await loadBenchEngine();
    expect(engine).not.toBeNull();

    const payload = buildPayload({ dungeon: true });
    const { jsResult, wasmResult } = await runBenchmark(
      engine,
      payload,
      { minimal: false, enableHpMpVisualization: false },
      'full-result 副本（chimerical_den）',
    );

    // 防退化：两侧都必须真的在副本路径上（否则对照跑在普通区域口径上）。
    expect(wasmResult.isDungeon).toBe(true);
    expect(wasmResult.dungeonsFailed).toBeGreaterThan(0);
    expect(wasmResult.maxWaveReached).toBeGreaterThan(0);
    expect(wasmResult.timeSpentAlive.length).toBeGreaterThan(0);
    expect(wasmResult.bossSpawns).toHaveLength(10);
    expect(canonicalJson(wasmResult)).toBe(canonicalJson(jsResult));
  }, 600000);
});
