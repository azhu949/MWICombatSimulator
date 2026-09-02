import { describe, expect, it } from 'vitest';
import CombatSimulator from '../combatSimulator.js';
import Zone from '../zone.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../../services/playerMapper.js';

const SECOND = 1e9;

function buildSimulatorWithDrinks(drinks) {
  const config = { ...createEmptyPlayerConfig('residual-drink-guard'), selected: true };
  config.drinks = [...drinks];
  const players = buildPlayersForSimulation([config]);
  const zone = new Zone('/actions/combat/sorcerers_tower', 0);
  const simulator = new CombatSimulator(players, zone, null, { enableHpMpVisualization: false });
  for (const player of players) {
    player.zoneBuffs = [];
    player.extraBuffs = [];
    player.generatePermanentBuffs();
  }
  return { players, simulator };
}

// 历史持久化/导入配置可能残留战斗不可用饮品（如各类 *_tea）。它们
// cooldownDuration=0 且无默认战斗触发器，若进入引擎会以
// "恒触发 + 零冷却"造成 checkTriggers 死循环（模拟永久挂起）。
// playerMapper 映射守卫是引擎侧的最后防线（第一道防线在
// importExportMapper 的导入归一化，见 nonCombatDrinkSanitize.test.js）。
describe('战斗不可用饮品残留的引擎防御', () => {
  it('playerMapper 映射时跳过战斗不可用饮品，合法饮品正常保留', () => {
    const { players } = buildSimulatorWithDrinks(['/items/brewing_tea', '', '']);
    expect(players[0].drinks[0]).toBeNull();

    const control = buildSimulatorWithDrinks(['/items/attack_coffee', '', '']);
    expect(control.players[0].drinks[0]?.hrid).toBe('/items/attack_coffee');
  });

  it('残留战斗不可用饮品时模拟可正常完成（不发生 checkTriggers 死循环）', async () => {
    const { simulator } = buildSimulatorWithDrinks(['/items/brewing_tea', '', '']);

    await simulator.simulate(10 * SECOND);

    expect(simulator.simulationTime).toBeGreaterThan(0);
  });
});
