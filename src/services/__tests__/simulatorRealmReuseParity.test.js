// wasm 引擎时代的 realm 复用 parity 防线（§54 回归锚，2026-10-01 重建）。
//
// 背景：本文件原是 JS 引擎时代的「同 realm 连跑 vs 每场全新 realm」对照测试，
// 切片 21B 随 JS 引擎物理删除（理由「前提消失」，见 docs/wasm-engine-performance.md
// §21.1）。wasm 引擎同为有状态实例：worker realm 复用（runSimulationBatchWithDedicatedWorker
// 的批量路径、realm 保活计划）的正确性前提是「引擎在同一实例连续两次 simulate 之间
// 没有会改变结果的状态残留」（Rust 侧状态、桥侧模块级缓存、共享对象就地改写等）。
// 本文件把该前提重新固化为常规流水线断言：
//
//   对照臂 A（同 realm 连跑）：同一份模块 registry（本文件顶部静态 import 的模块图）里注入
//   **同一个 wasm 引擎实例**，按生产 worker.js 的装配方式依次跑 K 场不同种子的真实 wasm 模拟；
//   对照臂 B（每场全新 realm）：vi.resetModules() 清空模块缓存后重新 import() 得到全新模块图
//   （模块级缓存/JSON 常量的全新副本），并为每场装载**全新的 wasm 引擎实例** ——
//   wasm-bindgen glue 对重复 init 有「已初始化即返回」保护（if (wasm !== undefined) return wasm;），
//   因此用 URL query 破坏 Node ESM 模块缓存键，取得独立 glue 模块实例；
//
//   同一种子在 A、B 两臂的 simResult 必须逐位一致（JSON 序列化等值）。
//   若将来引擎/桥改动引入非确定性残留，A 臂会污染后续场次，本测试即红。
//
// 与旧版差异：运行入口从 JS `CombatSimulator` 换成生产 wasm 入口 `tryRunWasmProductionRound`
// （worker.js 的调用形态）；两臂各场为 full-result（覆盖经验记账/掉落桶等字段面，比 minimal
// 更能捕获残留）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import { buildSimulationExtraBuffs } from '../../shared/simulationExtraBuffs.js';
import { importSoloConfig } from '../importExportMapper.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../playerMapper.js';
import { buildSimulationExtra, buildSingleSimulationPayload } from '../simulationDomain.js';
import {
  getWasmProductionDiagnostics,
  setWasmProductionEngineForTests,
  tryRunWasmProductionRound,
} from '../wasmProductionSimulation.js';
import fixture from './fixtures/modernPlayerJunglePlanetFixture.json';

// wasm 产物目录按候选链回退解析：engine/pkg 是本地构建产物（npm run build:wasm 输出，被
// .gitignore 忽略，新 clone / CI / 未跑构建的机器上不存在），优先取最新构建；public/engine/pkg
// 是随仓库提交的部署口径产物，作兜底 —— 避免 describe.runIf 在产物缺失时静默跳过、防线落空。
// 每个候选目录须同时存在 glue（mwi_combat_engine.js）与 wasm（mwi_combat_engine_bg.wasm）才生效。
function resolveWasmPackageDir(root, candidates) {
  for (const segments of candidates) {
    const dir = resolve(root, ...segments);
    if (existsSync(resolve(dir, 'mwi_combat_engine.js')) && existsSync(resolve(dir, 'mwi_combat_engine_bg.wasm'))) {
      return dir;
    }
  }
  return null;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkgDir = resolveWasmPackageDir(root, [
  ['engine', 'pkg'],
  ['public', 'engine', 'pkg'],
]);
const gluePath = pkgDir === null ? null : resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = pkgDir === null ? null : resolve(pkgDir, 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = pkgDir !== null;

const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
const SEEDS = [101, 202, 303];

// 全新引擎实例：每次用带独立 query 的 glue URL —— 绕过 glue 的「已初始化即返回」保护，
// 取得独立模块实例并各自完成 init（「每场全新 realm」的 wasm 等价物）。
async function loadFreshEngine(realmTag) {
  const glue = await import(/* @vite-ignore */ `${pathToFileURL(gluePath).href}?realm=${realmTag}`);
  await glue.default({ module_or_path: await readFile(wasmPath) });
  return glue;
}

function createSimulationSettings() {
  return {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: '',
    difficultyTier: 1,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: 1,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: false,
  };
}

// 按给定模块 registry（A 臂为顶部图 / B 臂为全新图）构建一场的输入 payload ——
// 与生产路径一致：realm 内完成 payload 构建与播种。
function buildSeededPayload(registry, seed) {
  const settings = createSimulationSettings();
  const imported = registry.importSoloConfig(JSON.stringify(fixture), registry.createEmptyPlayerConfig(1), settings);
  const playersDto = registry.buildPlayersForSimulation([{ ...imported.player, selected: true }]);
  const payload = registry.buildSingleSimulationPayload(playersDto, settings, [], {
    workerId: 'realm-reuse-parity',
    extra: { ...registry.buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = seed;
  return payload;
}

// 与生产 worker.js 'start_simulation' 分支同构的装配 + full-result wasm 单轮。
async function runRoundInRegistry(registry, payload) {
  const extraBuffs = registry.buildSimulationExtraBuffs(payload.extra || {});
  const zone = new registry.Zone(payload.zone.zoneHrid, payload.zone.difficultyTier);
  const players = payload.players.map((dto) => {
    const player = registry.Player.createFromDTO(structuredClone(dto));
    player.zoneBuffs = zone.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });

  const output = await registry.tryRunWasmProductionRound({
    useWasmEngine: true,
    players,
    zone,
    labyrinth: null,
    simulationContext: null,
    seed: payload.seed,
    simulationTimeLimit: payload.simulationTimeLimit,
    options: {
      minimalResult: false,
      logCombatEvents: false,
      enableHpMpVisualization: false,
      combatScrollsEnabled: false,
      isGuildTrial: false,
    },
  });
  if (!output) {
    throw new Error(`wasm round unavailable: ${registry.getWasmProductionDiagnostics().lastFallbackReason}`);
  }
  return output.simResult;
}

// A 臂 registry：本文件顶部静态 import 的模块图（单一 registry，跨场共享）。
function createSharedRegistry() {
  return {
    importSoloConfig,
    createEmptyPlayerConfig,
    buildPlayersForSimulation,
    buildSimulationExtra,
    buildSingleSimulationPayload,
    setWasmProductionEngineForTests,
    tryRunWasmProductionRound,
    getWasmProductionDiagnostics,
    Player,
    Zone,
    buildSimulationExtraBuffs,
  };
}

// B 臂 registry：vi.resetModules() 清空模块缓存后重新 import() —— 模块被重新执行，
// 返回全新模块实例（模块级缓存/JSON 常量的全新副本），即「全新 realm」的等价物。
async function importFreshRegistry() {
  vi.resetModules();
  const [wasmMod, playerMod, zoneMod, extraMod, simDomainMod, exportMapperMod, playerMapperMod] = await Promise.all([
    import('../wasmProductionSimulation.js'),
    import('../../combatsimulator/player.js'),
    import('../../combatsimulator/zone.js'),
    import('../../shared/simulationExtraBuffs.js'),
    import('../simulationDomain.js'),
    import('../importExportMapper.js'),
    import('../playerMapper.js'),
  ]);
  return {
    importSoloConfig: exportMapperMod.importSoloConfig,
    createEmptyPlayerConfig: playerMapperMod.createEmptyPlayerConfig,
    buildPlayersForSimulation: playerMapperMod.buildPlayersForSimulation,
    buildSimulationExtra: simDomainMod.buildSimulationExtra,
    buildSingleSimulationPayload: simDomainMod.buildSingleSimulationPayload,
    setWasmProductionEngineForTests: wasmMod.setWasmProductionEngineForTests,
    tryRunWasmProductionRound: wasmMod.tryRunWasmProductionRound,
    getWasmProductionDiagnostics: wasmMod.getWasmProductionDiagnostics,
    Player: playerMod.default ?? playerMod.Player,
    Zone: zoneMod.default ?? zoneMod.Zone,
    buildSimulationExtraBuffs: extraMod.buildSimulationExtraBuffs,
  };
}

async function runSharedRealmArm(seeds) {
  const registry = createSharedRegistry();
  registry.setWasmProductionEngineForTests(await loadFreshEngine('shared'));
  const results = [];
  for (const seed of seeds) {
    results.push(await runRoundInRegistry(registry, buildSeededPayload(registry, seed)));
  }
  return results;
}

async function runFreshRealmArm(seeds) {
  const results = [];
  for (let index = 0; index < seeds.length; index += 1) {
    const registry = await importFreshRegistry();
    registry.setWasmProductionEngineForTests(await loadFreshEngine(`fresh-${index}`));
    results.push(await runRoundInRegistry(registry, buildSeededPayload(registry, seeds[index])));
  }
  return results;
}

// 标题动态化：候选目录链全部不命中（产物缺失）时在 describe 标题追加显式 SKIPPED 提示，
// 让 vitest 输出中的跳过状态可见、可读；wasmPackageBuilt 的布尔语义保持为「目录解析成功与否」。
const describeTitle = wasmPackageBuilt
  ? 'worker realm 复用 parity（同 realm 连跑 vs 每场全新 realm）'
  : 'worker realm 复用 parity（同 realm 连跑 vs 每场全新 realm）' +
    '（SKIPPED：engine/pkg 与 public/engine/pkg 均未找到 wasm 产物，先运行 npm run build:wasm）';

describe.runIf(wasmPackageBuilt)(describeTitle, () => {
  it('同一批种子在「同一 realm 连跑」与「每场全新 realm」下逐位一致', async () => {
    const sharedResults = await runSharedRealmArm(SEEDS);
    const freshResults = await runFreshRealmArm(SEEDS);

    expect(sharedResults).toHaveLength(SEEDS.length);
    expect(freshResults).toHaveLength(SEEDS.length);
    for (let index = 0; index < SEEDS.length; index += 1) {
      // 逐位一致：直接 JSON 序列化比较（simResult 是 worker postMessage 的纯数据，
      // JSON 等值即逐位等值）。
      expect(JSON.stringify(sharedResults[index])).toBe(JSON.stringify(freshResults[index]));
    }
  }, 30000);

  it('对照组：不同种子结果不同（排除「两臂都跑出空结果」的假阳性）', async () => {
    const registry = createSharedRegistry();
    registry.setWasmProductionEngineForTests(await loadFreshEngine('control'));
    const first = await runRoundInRegistry(registry, buildSeededPayload(registry, 11));
    const second = await runRoundInRegistry(registry, buildSeededPayload(registry, 12));

    expect(first.encounters).toBeGreaterThan(0);
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  }, 30000);

  it('设施自检：query 变体装载得到相互独立的模块实例（对照有效性的前提）', async () => {
    // 若 URL query 被运行时忽略（两臂拿到同一模块实例），B 臂会退化成「同实例连跑」，
    // 主断言将失去对照意义 —— 本用例锚定「全新实例」这一设施前提本身。
    const first = await loadFreshEngine('selfcheck-a');
    const second = await loadFreshEngine('selfcheck-b');
    expect(first).not.toBe(second);
    expect(first.bridge_probe).not.toBe(second.bridge_probe);
  }, 30000);
});
