// 首页「多轮模拟」性能抽查基准（默认跳过，仅在显式开启时运行）。
// 运行：$env:HOME_MULTI_ROUND_BENCH='1'; npx vitest run src/services/__tests__/homeMultiRoundBenchmark.test.js
//
// 口径：真实夹具 + 真实区域（jungle planet, tier 1）+ full-result（含 HP/MP 时序快照）——
// 与 docs/wasm-engine-performance.md §24–31 的「1h full-result 单轮 median ≈10.4 ms」同口径。
// 负载按生产形态构建：buildMultiRoundPayloads 逐轮注入确定性种子 → 每轮重建玩家实例
// （与 worker 每轮装配一致）→ buildProductionRequest → runWasmProductionSimulation；
// 怪物模板缓存跨轮复用（与 worker realm 一致）。
//
// 与生产批量入口 runSimulationBatchWithDedicatedWorker 的差异：本基准在 vitest 进程内直调
// 引擎（测试环境无浏览器 Worker），不计 realm 建立与消息往返开销——生产一次多轮运行
// = 1 次 realm 建立 + N × 本基准单轮耗时 + 汇总开销。
//
// 环境变量：HOME_MULTI_ROUND_BENCH_5（5 轮口径重复次数，默认 5）、
//           HOME_MULTI_ROUND_BENCH_100（100 轮口径重复次数，默认 3）、
//           HOME_MULTI_ROUND_BENCH_HOURS（默认 1）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import { buildSimulationExtraBuffs } from '../../shared/simulationExtraBuffs.js';
import { importSoloConfig } from '../importExportMapper.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../playerMapper.js';
import { buildSimulationExtra, buildSingleSimulationPayload } from '../simulationDomain.js';
import { buildMultiRoundPayloads } from '../homeMultiRoundSimulation.js';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import { buildProductionRequest, runWasmProductionSimulation } from '../wasmProductionBridge.js';
import fixture from './fixtures/modernPlayerJunglePlanetFixture.json';

const benchEnabled = process.env.HOME_MULTI_ROUND_BENCH === '1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const gluePath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine.js');
const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

const HOURS = Number(process.env.HOME_MULTI_ROUND_BENCH_HOURS ?? 1);
const REPEATS_5 = Number(process.env.HOME_MULTI_ROUND_BENCH_5 ?? 5);
const REPEATS_100 = Number(process.env.HOME_MULTI_ROUND_BENCH_100 ?? 3);
const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
// docs/wasm-engine-performance.md §24–31：1h full-result 单轮（含桥接）median ≈10.4 ms。
const SINGLE_ROUND_BASELINE_MS = 10.4;

function buildBasePayload() {
  const settings = {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: '',
    labyrinthHrid: '',
    roomLevel: 0,
    difficultyTier: 1,
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
    workerId: 'home-multi-round-bench',
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  // 与生产多轮路径同款口径（store 构造批模板时显式置 false）：多轮逐轮关闭战斗事件日志，
  // 聚合只读数值字段、关日志不改变数值；生产单轮（rounds <= 1）不设置该字段，worker 默认开启。
  payload.logCombatEvents = false;
  return payload;
}

function buildLivePieces(payload) {
  const extraBuffs = buildSimulationExtraBuffs(payload.extra || {});
  const zone = payload.zone ? new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier) : null;
  const players = payload.players.map((dto) => {
    const player = Player.createFromDTO(structuredClone(dto));
    player.zoneBuffs = zone?.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });
  return { zone, players };
}

// 单轮：重建玩家实例 + 组装生产请求 + 直调 wasm 引擎（full-result + HP/MP 时序）。
function runRound(engine, payload) {
  const setupStartedAt = performance.now();
  const { zone, players } = buildLivePieces(payload);
  const request = buildProductionRequest({
    players,
    zone,
    labyrinth: null,
    seed: payload.seed,
    simulationTimeLimit: payload.simulationTimeLimit,
    options: {
      minimalResult: false,
      logCombatEvents: false,
      enableHpMpVisualization: true,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    },
  });
  const setupMs = performance.now() - setupStartedAt;
  const engineStartedAt = performance.now();
  const { simResult } = runWasmProductionSimulation(engine, request);
  return { simResult, setupMs, engineMs: performance.now() - engineStartedAt };
}

// 完整批：生产形态的 payloads（逐轮种子）在同一个已加载引擎实例上串行跑完
// ——对应生产批量入口的单 realm 形态；返回整批耗时与逐轮明细。
function measureBatch(engine, basePayload, rounds) {
  const payloads = buildMultiRoundPayloads(basePayload, rounds);
  const roundTimes = [];
  const simResults = [];
  let setupMs = 0;
  let engineMs = 0;
  const startedAt = performance.now();
  for (const payload of payloads) {
    const roundStartedAt = performance.now();
    const round = runRound(engine, payload);
    roundTimes.push(performance.now() - roundStartedAt);
    setupMs += round.setupMs;
    engineMs += round.engineMs;
    simResults.push(round.simResult);
  }
  return { totalMs: performance.now() - startedAt, setupMs, engineMs, roundTimes, simResults };
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

function reportLine(label, batches) {
  const totalMedian = median(batches.map((batch) => batch.totalMs));
  const setupMedian = median(batches.map((batch) => batch.setupMs));
  const engineMedian = median(batches.map((batch) => batch.engineMs));
  const perRoundMedian = median(batches.flatMap((batch) => batch.roundTimes));
  const ratio = perRoundMedian / SINGLE_ROUND_BASELINE_MS;
  return (
    `${label}: total median ${formatMs(totalMedian)} = 装配 ${formatMs(setupMedian)} + 引擎 ${formatMs(engineMedian)}; ` +
    `单轮 median ${formatMs(perRoundMedian)}（vs 单轮基线 ${SINGLE_ROUND_BASELINE_MS} ms → ${ratio.toFixed(2)}x）`
  );
}

describe.runIf(benchEnabled && wasmPackageBuilt)('home multi-round benchmark', () => {
  it('measures 1h x 5 and 1h x 100 multi-round batches (full-result)', async () => {
    const engine = await loadBenchEngine();
    expect(engine).not.toBeNull();

    const basePayload = buildBasePayload();

    // 预热（模板缓存 + wasm 实例化 + JIT），不计量。
    runRound(engine, buildMultiRoundPayloads(basePayload, 1)[0]);

    const batches5 = [];
    for (let index = 0; index < REPEATS_5; index += 1) {
      batches5.push(measureBatch(engine, basePayload, 5));
    }
    const batches100 = [];
    for (let index = 0; index < REPEATS_100; index += 1) {
      batches100.push(measureBatch(engine, basePayload, 100));
    }

    console.log(
      [
        '',
        `=== home multi-round benchmark (${HOURS}h simulated, full-result, 5 rounds x${REPEATS_5} / 100 rounds x${REPEATS_100}) ===`,
        reportLine('1h x 5 rounds  ', batches5),
        reportLine('1h x 100 rounds', batches100),
        '',
      ].join('\n'),
    );

    // 防跑空：每个口径都必须真的产出完整结果（full-result 路径时序快照非空）。
    const allBatches = [...batches5, ...batches100];
    expect(
      allBatches.every((batch) => batch.simResults.every((result) => result?.timeSeriesData?.timestamps?.length > 0)),
    ).toBe(true);
    expect(batches100[0].simResults).toHaveLength(100);

    // 取样前提抽查：100 轮种子互不相同（deriveSeedSet 契约，失败属基建问题而非性能问题）。
    const payloads = buildMultiRoundPayloads(basePayload, 100);
    expect(new Set(payloads.map((payload) => payload.seed)).size).toBe(100);
  }, 600000);
});
