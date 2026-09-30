// 切片 5-B：WASM / JS A/B 接线测试（默认关 + 回退纪律 + 两侧样本逐字段一致）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import { buildPlayersForSimulation } from '../playerMapper.js';
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

  it('keeps the switch off by default and rejects optimizer rounds without it', async () => {
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

    // 切片 15：副本不再被配置闸门挡住（引擎未注入 → engine_unavailable）。
    // 切片 19：full-result + logCombatEvents 组合也不再留 JS——团灭日志由引擎生成，
    // 不再回退 dungeon_combat_logs。
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
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');

    // 切片 16：迷宫不再被配置闸门挡住（引擎未注入 → engine_unavailable）；迷宫模式
    // 没有 zone，`no_zone` 判据只对「既无区域又无迷宫」成立。
    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: null,
        labyrinth: { monsterHrid: '/monsters/cyclops', roomLevel: 100 },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');

    // 切片 17：卷轴不再被配置闸门挡住（引擎未注入 → engine_unavailable）。
    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/fly', difficultyTier: 0, isDungeon: false },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false, combatScrollsEnabled: true },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');
  });

  it('fails hard when the wasm engine cannot be loaded (no JS fallback)', async () => {
    // 切片 21A（审计定案 D1）：wasm 产物随仓库提交，引擎不可达 = 构建事故——
    // 生产轮次硬失败，不再静默回退 JS 引擎。tryRunWasmProductionRound 返回 null
    // 由调用方（worker.js / simulateFoodOptimizerRound）上报 simulation_error / throw。
    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/fly', difficultyTier: 0, isDungeon: false },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('engine_unavailable');
  });

  // 切片 21B：shouldUseWasmOptimizerRound 判据用例已删除——函数与开关一起清理
  //（生产载荷不再携带 useWasmEngine，优化器轮次 wasm-only）。

  describe.runIf(wasmPackageBuilt)('with the built wasm package', () => {
    beforeEach(async () => {
      setWasmProductionEngineForTests(await loadRealEngine());
    });

    // 切片 14：首页单轮（full-result + 战斗日志 + 可视化）在 wasm 上直接跑通——
    // 结果期望由 golden 快照承载（wasmEngineProductionParity.test.js 的 full-1h-viz），
    // 此处只做接线冒烟（真实区域 + full-result 路径畅通 + 完整字段面有数据）。
    it('runs a full-result homepage round on wasm', async () => {
      const player = createEmptyPlayerConfig(1);
      for (const key of Object.keys(player.levels)) player.levels[key] = 30;
      player.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
      const zone = new Zone('/actions/combat/fly', 0);
      const players = buildPlayersForSimulation([player]).map((dto) => {
        const live = Player.createFromDTO(structuredClone(dto));
        live.zoneBuffs = zone.buffs || [];
        live.extraBuffs = [];
        return live;
      });

      const wasmSample = await tryRunWasmProductionRound({
        useWasmEngine: true,
        players,
        zone,
        seed: 12345,
        simulationTimeLimit: 3600 * 1e9,
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
      // 防退化：完整字段面必须真的有数据（时序快照随 simResult 一次性返回）。
      expect(wasmSample.simResult.encounters).toBeGreaterThan(0);
      expect(Object.keys(wasmSample.simResult.experienceGained).length).toBeGreaterThan(0);
      expect(wasmSample.simResult.timeSeriesData.timestamps.length).toBeGreaterThan(0);
    });
  });
});
