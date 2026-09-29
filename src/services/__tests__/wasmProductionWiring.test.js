// 切片 5-B：WASM / JS A/B 接线测试（默认关 + 回退纪律 + 两侧样本逐字段一致）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import CombatSimulator from '../../combatsimulator/combatSimulator.js';
import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import { buildPlayersForSimulation } from '../playerMapper.js';
import { createSeededRandom } from '../seededRandom.js';
import { shouldUseWasmOptimizerRound, simulateFoodOptimizerRound } from '../foodOptimizerSimulation.js';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import {
  getWasmProductionDiagnostics,
  setWasmProductionEngineForTests,
  tryRunWasmProductionRound,
} from '../wasmProductionSimulation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const gluePath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine.js');
const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

async function loadRealEngine() {
  return loadWasmEngine({ glueUrl: pathToFileURL(gluePath).href, moduleOrPath: readFile(wasmPath) });
}

function buildRequest() {
  const player = createEmptyPlayerConfig(1);
  for (const key of Object.keys(player.levels)) player.levels[key] = 30;
  player.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
  return {
    activePlayerId: '1',
    rounds: 1,
    seeds: [12345],
    prices: { priceTable: {}, consumableMode: 'ask' },
    payload: {
      players: structuredClone(buildPlayersForSimulation([player])),
      zone: { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
      labyrinth: null,
      extra: {},
      simulationTimeLimit: 120 * 1e9,
    },
  };
}

describe('wasm production A/B wiring', () => {
  beforeEach(() => {
    setWasmProductionEngineForTests(null);
  });

  afterEach(() => {
    setWasmProductionEngineForTests(null);
  });

  it('keeps the switch off by default and falls back to the JS engine', async () => {
    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: false,
        players: [],
        zone: null,
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('disabled');

    // 优化器轮次：开关未开时连尝试都不发生（判据直接落到 JS 引擎）。
    const request = buildRequest();
    const sample = await simulateFoodOptimizerRound(request, null, 12345, () => {}, Infinity, {
      collectThresholds: false,
    });
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('disabled');
    expect(sample.simulatedTime).toBeGreaterThan(0);
    expect(sample).toHaveProperty('deaths');
    expect(sample.equivalentThresholds).toBeNull();
  });

  it('reports unsupported configurations instead of running wasm', async () => {
    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: null,
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('no_zone');

    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/fly', difficultyTier: 0, isDungeon: false },
        seed: 1,
        simulationTimeLimit: 1e9,
        // 切片 14：full-result / 战斗日志 / 可视化不再阻止 wasm——引擎未注入时回退原因
        // 应落到 engine_unavailable（而不是配置不受支持）。
        options: { minimalResult: false, logCombatEvents: true, enableHpMpVisualization: true },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');

    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/fly', difficultyTier: 0, isDungeon: false },
        simulationContext: { isGuildTrial: true },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('guild_trial');

    // 切片 15：副本不再被配置闸门挡住（引擎未注入 → engine_unavailable）；
    // 唯一仍留 JS 的副本组合是 full-result + logCombatEvents（wipe 日志含墙钟时间戳）。
    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/spider_queen', difficultyTier: 0, isDungeon: true },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');

    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/spider_queen', difficultyTier: 0, isDungeon: true },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: false, logCombatEvents: true },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('dungeon_combat_logs');

    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/fly', difficultyTier: 0, isDungeon: false },
        labyrinth: { hrid: '/labyrinths/x' },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('labyrinth');
  });

  it('falls back to the JS engine when the wasm package cannot be loaded', async () => {
    const request = buildRequest();
    request.useWasmEngine = true;
    const sample = await simulateFoodOptimizerRound(request, null, 12345, () => {}, Infinity, {
      collectThresholds: false,
    });
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');
    expect(sample.simulatedTime).toBeGreaterThan(0);
  });

  it('gates optimizer rounds onto wasm unless the cost observer is needed', () => {
    const request = { useWasmEngine: true };
    const candidate = { food: [] };
    expect(shouldUseWasmOptimizerRound({}, null, false, null)).toBe(false);
    // 切片 12：候选轮（shouldStop 由 Rust earlyStop 承接）已放行。
    expect(shouldUseWasmOptimizerRound(request, candidate, false, null)).toBe(true);
    // 切片 13：阈值/闲置观察由 Rust observers 承接，collectThresholds 不再阻止 wasm 轮次。
    expect(shouldUseWasmOptimizerRound(request, null, true, null)).toBe(true);
    expect(shouldUseWasmOptimizerRound(request, candidate, true, null)).toBe(true);
    // 成本上界观察器（observeFoodOptimizerCostBound）仍留 JS：costBound 轮不放开。
    expect(shouldUseWasmOptimizerRound(request, null, false, { cutoff: 1 })).toBe(false);
    expect(shouldUseWasmOptimizerRound(request, null, true, { cutoff: 1 })).toBe(false);
    expect(shouldUseWasmOptimizerRound(request, null, false, null)).toBe(true);
  });

  describe.runIf(wasmPackageBuilt)('with the built wasm package', () => {
    beforeEach(async () => {
      setWasmProductionEngineForTests(await loadRealEngine());
    });

    it('produces the same optimizer round sample on both engines', async () => {
      // 切片 13：collectThresholds 两种取值都逐字段对照（true 时阈值/闲置观察由两侧
      // 各自的观察器承接：JS 观察器 vs Rust observers 映射，样本必须一致）。
      for (const collectThresholds of [false, true]) {
        const jsRequest = buildRequest();
        const wasmRequest = buildRequest();
        wasmRequest.useWasmEngine = true;

        const jsSample = await simulateFoodOptimizerRound(jsRequest, null, 12345, () => {}, Infinity, {
          collectThresholds,
        });
        const wasmSample = await simulateFoodOptimizerRound(wasmRequest, null, 12345, () => {}, Infinity, {
          collectThresholds,
        });

        expect(getWasmProductionDiagnostics().lastFallbackReason, `collectThresholds=${collectThresholds}`).toBe('');
        expect(wasmSample, `collectThresholds=${collectThresholds}`).toEqual(jsSample);
      }
    });

    // 切片 14：首页单轮（full-result + 战斗日志 + 可视化）不再回退——打开开关后
    // `tryRunWasmProductionRound` 直接跑通，且结果与 JS 引擎逐字段一致（时序数据
    // 随 simResult 一次性返回，首页 store 从 `simResult.timeSeriesData` 兜底取）。
    it('runs a full-result homepage round on wasm and matches the JS engine', async () => {
      const seed = 12345;
      // 1h：必须真的跨过 1000 事件边界（否则时序快照退化成空数组对账）。
      const simulationTimeLimit = 3600 * 1e9;
      const player = createEmptyPlayerConfig(1);
      for (const key of Object.keys(player.levels)) player.levels[key] = 30;
      player.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
      const playerDtos = buildPlayersForSimulation([player]);

      const buildPieces = () => {
        const zone = new Zone('/actions/combat/fly', 0);
        const players = playerDtos.map((dto) => {
          const live = Player.createFromDTO(structuredClone(dto));
          live.zoneBuffs = zone.buffs || [];
          live.extraBuffs = [];
          return live;
        });
        return { zone, players };
      };

      const { zone: jsZone, players: jsPlayers } = buildPieces();
      const originalRandom = Math.random;
      Math.random = createSeededRandom(seed);
      let jsSample;
      try {
        const simulator = new CombatSimulator(jsPlayers, jsZone, null, {
          minimalResult: false,
          logCombatEvents: true,
          enableHpMpVisualization: true,
          combatScrollsEnabled: false,
          isGuildTrial: false,
        });
        jsSample = await simulator.simulate(simulationTimeLimit);
      } finally {
        Math.random = originalRandom;
      }

      const { zone, players } = buildPieces();
      const wasmSample = await tryRunWasmProductionRound({
        useWasmEngine: true,
        players,
        zone,
        seed,
        simulationTimeLimit,
        options: {
          minimalResult: false,
          logCombatEvents: true,
          enableHpMpVisualization: true,
          combatScrollsEnabled: false,
          isGuildTrial: false,
        },
      });

      expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('');
      expect(wasmSample).not.toBeNull();
      // 防退化：完整字段面必须真的有数据。
      expect(wasmSample.simResult.encounters).toBeGreaterThan(0);
      expect(Object.keys(wasmSample.simResult.experienceGained).length).toBeGreaterThan(0);
      expect(jsSample.timeSeriesData.timestamps.length).toBeGreaterThan(0);
      expect(wasmSample.simResult.timeSeriesData.timestamps).toHaveLength(jsSample.timeSeriesData.timestamps.length);
      expect(wasmSample.simResult).toEqual(jsSample);
    });
  });
});
