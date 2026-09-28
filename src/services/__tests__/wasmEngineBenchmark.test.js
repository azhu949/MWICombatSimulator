// 切片 6 性能对照基准（默认跳过，用 `npm run benchmark:wasm-engine` 运行）。
//
// 对账口径：**真实夹具 + 真实区域 + minimal 结果**（食物优化器生产路径），两侧各跑 N 轮，
// 比较「引擎单轮耗时」中位数；wasm 侧计入请求快照 + JSON 往返（应用真实要付的开销）。
// 每轮都重建玩家实例（与 worker 每轮装配一致），模板缓存跨轮复用（与 worker realm 一致）。
//
// 环境变量：WASM_BENCH_ROUNDS（默认 5）、WASM_BENCH_HOURS（默认 1）、WASM_BENCH_SEED（默认 101）。
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

function buildPayload() {
  const settings = {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: '',
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

async function runJsRound(payload) {
  const setupStartedAt = performance.now();
  const { zone, players } = buildLivePieces(payload);
  const setupMs = performance.now() - setupStartedAt;
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
    const engineStartedAt = performance.now();
    const result = await simulator.simulate(payload.simulationTimeLimit);
    return { result, setupMs, engineMs: performance.now() - engineStartedAt };
  } finally {
    Math.random = originalRandom;
  }
}

function runWasmRound(engine, payload) {
  const setupStartedAt = performance.now();
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
  const requestBytes = JSON.stringify(request).length;
  const setupMs = performance.now() - setupStartedAt;
  const engineStartedAt = performance.now();
  const result = runWasmProductionSimulation(engine, request);
  return { result, setupMs, engineMs: performance.now() - engineStartedAt, requestBytes };
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

describe.runIf(benchEnabled && wasmPackageBuilt)('wasm engine production benchmark', () => {
  it('compares JS and WASM on the real minimal-result workload', async () => {
    const engine = await loadWasmEngine({
      glueUrl: pathToFileURL(gluePath).href,
      moduleOrPath: readFile(wasmPath),
    });
    expect(engine).not.toBeNull();

    const payload = buildPayload();
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
    jsResult = (await runJsRound(payload)).result;
    wasmResult = runWasmRound(engine, payload).result;

    for (let round = 0; round < ROUNDS; round += 1) {
      let startedAt = performance.now();
      const jsRound = await runJsRound(payload);
      jsTimes.push(performance.now() - startedAt);
      jsSetupTimes.push(jsRound.setupMs);
      jsEngineTimes.push(jsRound.engineMs);
      jsResult = jsRound.result;

      startedAt = performance.now();
      const wasmRound = runWasmRound(engine, payload);
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
        `=== wasm engine production benchmark (${HOURS}h simulated, ${ROUNDS} rounds, seed ${SEED}) ===`,
        `JS   total ${formatMs(jsMedian)}  = 装配 ${formatMs(median(jsSetupTimes))} + 引擎 ${formatMs(median(jsEngineTimes))}`,
        `WASM total ${formatMs(wasmMedian)}  = 装配/快照 ${formatMs(median(wasmSetupTimes))} + 引擎 ${formatMs(median(wasmEngineTimes))}`,
        `speedup (JS/WASM) = ${(jsMedian / wasmMedian).toFixed(3)}x   请求 JSON ${requestBytes} bytes`,
        `JS deaths ${JSON.stringify(jsResult.deaths)}`,
        `WASM deaths ${JSON.stringify(wasmResult.deaths)}`,
        '',
      ].join('\n'),
    );

    // 顺带再确认一次两侧结果一致（避免基准跑在错误的分支上）。
    expect(canonicalJson(wasmResult)).toBe(canonicalJson(jsResult));
  }, 600000);
});
