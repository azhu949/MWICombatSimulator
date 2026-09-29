// 切片 5-B：WASM / JS A/B 接线测试（默认关 + 回退纪律 + 两侧样本逐字段一致）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { buildPlayersForSimulation } from '../playerMapper.js';
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
        options: { minimalResult: false, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('full_result');

    expect(
      await tryRunWasmProductionRound({
        useWasmEngine: true,
        players: [],
        zone: { hrid: '/actions/combat/fly', difficultyTier: 0, isDungeon: true },
        seed: 1,
        simulationTimeLimit: 1e9,
        options: { minimalResult: true, logCombatEvents: false },
      }),
    ).toBeNull();
    expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('dungeon');

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

  it('gates optimizer rounds onto wasm only when no JS-side observer is needed', () => {
    const request = { useWasmEngine: true };
    const candidate = { food: [] };
    expect(shouldUseWasmOptimizerRound({}, null, false, null)).toBe(false);
    // 切片 12：候选轮（shouldStop 由 Rust earlyStop 承接）已放行。
    expect(shouldUseWasmOptimizerRound(request, candidate, false, null)).toBe(true);
    expect(shouldUseWasmOptimizerRound(request, null, true, null)).toBe(false);
    expect(shouldUseWasmOptimizerRound(request, candidate, true, null)).toBe(false);
    expect(shouldUseWasmOptimizerRound(request, null, false, { cutoff: 1 })).toBe(false);
    expect(shouldUseWasmOptimizerRound(request, null, false, null)).toBe(true);
  });

  describe.runIf(wasmPackageBuilt)('with the built wasm package', () => {
    beforeEach(async () => {
      setWasmProductionEngineForTests(await loadRealEngine());
    });

    it('produces the same optimizer round sample on both engines', async () => {
      const jsRequest = buildRequest();
      const wasmRequest = buildRequest();
      wasmRequest.useWasmEngine = true;

      const jsSample = await simulateFoodOptimizerRound(jsRequest, null, 12345, () => {}, Infinity, {
        collectThresholds: false,
      });
      const wasmSample = await simulateFoodOptimizerRound(wasmRequest, null, 12345, () => {}, Infinity, {
        collectThresholds: false,
      });

      expect(getWasmProductionDiagnostics().lastFallbackReason).toBe('');
      expect(wasmSample).toEqual(jsSample);
    });
  });
});
