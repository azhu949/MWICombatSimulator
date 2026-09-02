import { describe, expect, it } from 'vitest';
import { importSoloConfig } from '../importExportMapper.js';
import { createEmptyPlayerConfig } from '../playerMapper.js';

function createSimulationSettings() {
  return {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: '/actions/combat/fly',
    dungeonHrid: '',
    difficultyTier: 1,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: 24,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: true,
  };
}

function buildModernSoloPayload(player) {
  return JSON.stringify({ version: 2, player });
}

// 历史持久化快照与导入配置可能残留战斗不可用饮品（如各类 *_tea）：
// 它们不在饮品下拉选项中（显示空白），且进入引擎会以
// "恒触发 + 零冷却"造成 checkTriggers 死循环（模拟永久挂起）。
// 导入归一化（sanitizePlayerConfig）是第一道防线，覆盖 solo/群组导入、
// 角色快照恢复与分享档案导入。
describe('导入归一化清洗战斗不可用饮品', () => {
  it('importSoloConfig 清洗 drinks 中的战斗不可用饮品并保留合法饮品', () => {
    const base = createEmptyPlayerConfig('1');
    const payloadPlayer = {
      ...base,
      drinks: ['/items/brewing_tea', '/items/attack_coffee', '/items/foraging_tea'],
    };

    const parsed = importSoloConfig(buildModernSoloPayload(payloadPlayer), base, createSimulationSettings());

    expect(parsed.player.drinks).toEqual(['', '/items/attack_coffee', '']);
  });

  it('未知饮品 hrid 保持原样（维持既有导入行为）', () => {
    const base = createEmptyPlayerConfig('1');
    const payloadPlayer = { ...base, drinks: ['/items/not_a_real_drink', '', ''] };

    const parsed = importSoloConfig(buildModernSoloPayload(payloadPlayer), base, createSimulationSettings());

    expect(parsed.player.drinks).toEqual(['/items/not_a_real_drink', '', '']);
  });
});
