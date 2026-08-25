import { describe, expect, it } from 'vitest';
import { buildCombatPreviewData, createEmptyPlayerConfig } from '../../services/playerMapper.js';

function emptyConfig(id) {
  return { ...createEmptyPlayerConfig(String(id)), selected: true };
}

function withAbilities(config, abilityHrids) {
  const slots = abilityHrids.map((abilityHrid) => ({ abilityHrid, level: 1 }));
  while (slots.length < 5) {
    slots.push({ abilityHrid: '', level: 1 });
  }
  return { ...config, abilities: slots };
}

describe('Party aura combat preview recast attribution', () => {
  it('attributes a recast aura to a single source spanning the whole effective change', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = withAbilities(emptyConfig('2'), ['/abilities/speed_aura', '/abilities/fireball']);
    teammateConfig.name = 'RecastMate';
    teammateConfig.levels = { ...teammateConfig.levels, attack: 100, intelligence: 200 };
    // 移除默认的 is_inactive 自屏蔽，使光环在其 120 秒
    // 冷却于回放窗口内结束后可以被重新施放。
    teammateConfig.triggerMap = { '/abilities/speed_aura': [] };
    // 攻击咖啡强化第二次施放：它在战斗中触发
    // （魔法值 <= 1500，约 6 个火球术后），而不是在第一次施放之前。
    teammateConfig.drinks[0] = '/items/attack_coffee';
    teammateConfig.triggerMap['/items/attack_coffee'] = [
      {
        dependencyHrid: '/combat_trigger_dependencies/self',
        conditionHrid: '/combat_trigger_conditions/current_mp',
        comparatorHrid: '/combat_trigger_comparators/less_than_equal',
        value: 1500,
      },
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    // 第二次（饮品强化后的）施放在最终状态中拥有该增益。
    expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe('player2');
    // 等级 109 → ratioBoost = 0.03 * (1 + 109 * 0.005) = 0.04635。
    expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.04635, 10);

    // 重新施放的光环只存在一个源，而非每次施放一行。
    const auraSources = preview.highlightSources.filter((source) => source.sourceKey?.startsWith('teammate-aura-'));
    expect(auraSources).toHaveLength(1);
    expect(auraSources[0].sourceKey).toBe('teammate-aura-player2-/abilities/speed_aura');
    expect(auraSources[0].sourceName).toContain('RecastMate');

    // 单个源涵盖完整变化：无光环 → 最终（等级 109）
    // 施放，而不只是第二次施放的微小差值。
    const castSpeedSource = auraSources[0].changedStats.find((stat) => stat.key === 'castSpeed');
    expect(castSpeedSource).toBeTruthy();
    expect(castSpeedSource.deltaValue).toBeCloseTo(0.04635, 10);

    // 拆解只列出光环源一次，并干净地对账。
    const intervalBreakdown = Object.values(preview.statBreakdowns).find((entry) =>
      entry?.sources?.some((source) => source.sourceKey === 'teammate-aura-player2-/abilities/speed_aura'),
    );
    expect(intervalBreakdown).toBeTruthy();
    expect(intervalBreakdown.sources).toHaveLength(1);
    expect(intervalBreakdown.sources[0].sourceKey).toBe('teammate-aura-player2-/abilities/speed_aura');
  });
});
