import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import Zone from '../zone.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../../services/playerMapper.js';
import { loadWasmEngine } from '../../services/wasmEngineLoader.js';
import { buildProductionRequest, runWasmProductionSimulation } from '../../services/wasmProductionBridge.js';

const SECOND = 1e9;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const gluePath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine.js');
const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

function buildPlayersWithDrinks(drinks) {
  const config = { ...createEmptyPlayerConfig('residual-drink-guard'), selected: true };
  config.drinks = [...drinks];
  const players = buildPlayersForSimulation([config]);
  const zone = new Zone('/actions/combat/sorcerers_tower', 0);
  for (const player of players) {
    player.zoneBuffs = [];
    player.extraBuffs = [];
    player.generatePermanentBuffs();
  }
  return { players, zone };
}

// 历史持久化/导入配置可能残留战斗不可用饮品（如各类 *_tea）。它们
// cooldownDuration=0 且无默认战斗触发器，若进入引擎会以
// "恒触发 + 零冷却"造成 checkTriggers 死循环（模拟永久挂起）。
// playerMapper 映射守卫是引擎侧的最后防线（第一道防线在
// importExportMapper 的导入归一化，见 nonCombatDrinkSanitize.test.js）。
//
// 切片 21B：JS 引擎已删除——「不发生 checkTriggers 死循环」的运行时防线由 wasm
// 侧同一映射守卫（buildPlayersForSimulation 在 dumpUnitSpec 快照之前）承接。
describe('战斗不可用饮品残留的引擎防御', () => {
  it('playerMapper 映射时跳过战斗不可用饮品，合法饮品正常保留', () => {
    const { players } = buildPlayersWithDrinks(['/items/brewing_tea', '', '']);
    expect(players[0].drinks[0]).toBeNull();

    const control = buildPlayersWithDrinks(['/items/attack_coffee', '', '']);
    expect(control.players[0].drinks[0]?.hrid).toBe('/items/attack_coffee');
  });

  it.skipIf(!wasmPackageBuilt)('residual non-combat drinks never reach the wasm engine', async () => {
    const engine = await loadWasmEngine({ glueUrl: pathToFileURL(gluePath).href, moduleOrPath: readFile(wasmPath) });
    const { players, zone } = buildPlayersWithDrinks(['/items/brewing_tea', '', '']);
    const request = buildProductionRequest({
      players,
      zone,
      seed: 1,
      simulationTimeLimit: 10 * SECOND,
      options: { minimalResult: true, logCombatEvents: false, enableHpMpVisualization: false },
    });
    // 快照里的饮品槽必须是 null（不可用饮品已被映射守卫剔除），模拟正常完成。
    expect(request.players[0].drinks[0]).toBeNull();
    const output = runWasmProductionSimulation(engine, request);
    expect(output.simResult.simulatedTime).toBeGreaterThan(0);
  });
});
