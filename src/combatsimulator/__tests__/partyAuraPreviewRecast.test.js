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
    // Remove the default is_inactive self-barrier so the aura can be
    // recast once its 120s cooldown ends inside the replay window.
    teammateConfig.triggerMap = { '/abilities/speed_aura': [] };
    // Attack Coffee strengthens the SECOND cast: it triggers mid-fight
    // (MP <= 1500, after ~6 fireballs) instead of before the first cast.
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
    // The second (drink-strengthened) cast owns the buff in the final state.
    expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe('player2');
    // level 109 → ratioBoost = 0.03 * (1 + 109 * 0.005) = 0.04635.
    expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.04635, 10);

    // Only ONE source exists for the recast aura, not one row per cast.
    const auraSources = preview.highlightSources.filter((source) => source.sourceKey?.startsWith('teammate-aura-'));
    expect(auraSources).toHaveLength(1);
    expect(auraSources[0].sourceKey).toBe('teammate-aura-player2-/abilities/speed_aura');
    expect(auraSources[0].sourceName).toContain('RecastMate');

    // The single source spans the full change: no aura → final (level 109)
    // cast, not just the small delta of the second cast.
    const castSpeedSource = auraSources[0].changedStats.find((stat) => stat.key === 'castSpeed');
    expect(castSpeedSource).toBeTruthy();
    expect(castSpeedSource.deltaValue).toBeCloseTo(0.04635, 10);

    // The breakdown lists the aura source once and reconciles cleanly.
    const intervalBreakdown = Object.values(preview.statBreakdowns).find((entry) =>
      entry?.sources?.some((source) => source.sourceKey === 'teammate-aura-player2-/abilities/speed_aura'),
    );
    expect(intervalBreakdown).toBeTruthy();
    expect(intervalBreakdown.sources).toHaveLength(1);
    expect(intervalBreakdown.sources[0].sourceKey).toBe('teammate-aura-player2-/abilities/speed_aura');
  });
});
