// 切片 5 生产 parity：Rust `run_production_simulation`（真实区域生成敌人 + 真实最小结果聚合）
// 与 JS `CombatSimulator`（`minimalResult: true`，食物优化器路径）在**真实夹具 + 真实区域**上的
// simResult 逐字段对账。
//
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过。
// 对账契约（与 `engine/src/prod_probe.rs` 成对维护）：
// - 玩家 / 怪物在 JS 侧按生产路径构建（Player.createFromDTO / new Monster），
//   两侧共用同一份快照约定（wasmProductionBridge.dumpUnitSpec）；
// - `Math.random` 整轮替换为 `createSeededRandom(seed)`（Rust 为 Mulberry32）；
// - 结果只比对 `minimalResult`（FoodOptimizerSimResult）形状；支持边界见 getProductionSupport。
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkgDir = resolve(root, 'engine', 'pkg');
const gluePath = resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = resolve(pkgDir, 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';

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

async function runJsProductionSimulation(payload) {
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
    return await simulator.simulate(payload.simulationTimeLimit);
  } finally {
    Math.random = originalRandom;
  }
}

function runRustProductionSimulation(engine, payload) {
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
  return runWasmProductionSimulation(engine, request);
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

describe.runIf(wasmPackageBuilt)('wasm engine slice-5 production parity (minimal result)', () => {
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
});
