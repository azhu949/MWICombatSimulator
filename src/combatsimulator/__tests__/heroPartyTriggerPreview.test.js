import { describe, expect, it } from 'vitest';
import { buildCombatPreviewData, createEmptyPlayerConfig } from '../../services/playerMapper.js';

function emptyConfig(id) {
  return { ...createEmptyPlayerConfig(String(id)), selected: true };
}

describe('Hero party trigger combat preview', () => {
  it('evaluates hero all-allies triggers against the selected party', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = emptyConfig('2');

    heroConfig.abilities[0] = {
      abilityHrid: '/abilities/speed_aura',
      level: 1,
    };
    heroConfig.triggerMap['/abilities/speed_aura'] = [
      {
        dependencyHrid: '/combat_trigger_dependencies/all_allies',
        conditionHrid: '/combat_trigger_conditions/number_of_active_units',
        comparatorHrid: '/combat_trigger_comparators/greater_than_equal',
        value: 2,
      },
    ];

    const soloPreview = buildCombatPreviewData(heroConfig);
    expect(soloPreview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeFalsy();

    const partyPreview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    expect(partyPreview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeTruthy();
    expect(partyPreview.highlightSources.some((source) => source.sourceKey === 'ability-1-/abilities/speed_aura')).toBe(
      true,
    );
  });
});
