import { describe, expect, it } from 'vitest';
import { buildCombatPreviewData, createEmptyPlayerConfig } from '../../services/playerMapper.js';

function emptyConfig(id) {
  return { ...createEmptyPlayerConfig(String(id)), selected: true };
}

function withAura(config, abilityHrid, level = 1) {
  return {
    ...config,
    abilities: [{ abilityHrid, level }, ...config.abilities.slice(1)],
  };
}

describe('Party aura combat preview highlight attribution', () => {
  it("drops the hero's own aura source when a teammate's stronger aura owns the buff", () => {
    const heroConfig = withAura(emptyConfig('1'), '/abilities/speed_aura');
    heroConfig.levels = { ...heroConfig.levels, attack: 1 };
    const teammateConfig = {
      ...withAura(emptyConfig('2'), '/abilities/speed_aura'),
      name: 'StrongMate',
    };
    teammateConfig.levels = { ...teammateConfig.levels, attack: 800 };

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    // The stronger teammate cast is the active source in the final state.
    expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe('player2');
    // The hero's own overridden cast must not be attributed as a source...
    expect(preview.highlightSources.some((source) => source.sourceKey === 'ability-1-/abilities/speed_aura')).toBe(
      false,
    );
    // ...while the teammate's active cast stays visible.
    const teammateSource = preview.highlightSources.find(
      (source) => source.sourceKey === 'teammate-aura-player2-/abilities/speed_aura',
    );
    expect(teammateSource).toBeTruthy();
    expect(teammateSource.sourceName).toContain('StrongMate');

    // The breakdown attributes the interval delta to the teammate source
    // only, leaving no reconciliation gap.
    const intervalBreakdown = Object.values(preview.statBreakdowns).find((entry) =>
      entry?.sources?.some((source) => source.sourceKey === 'teammate-aura-player2-/abilities/speed_aura'),
    );
    expect(intervalBreakdown).toBeTruthy();
    expect(intervalBreakdown.sources).toHaveLength(1);
    expect(intervalBreakdown.sources[0].sourceKey).toBe('teammate-aura-player2-/abilities/speed_aura');
    expect(intervalBreakdown.reconciliationDelta).toBe(0);
  });

  it("keeps the hero's own aura source when it beats every teammate aura", () => {
    const strongHero = withAura(emptyConfig('1'), '/abilities/speed_aura');
    strongHero.levels = { ...strongHero.levels, attack: 800 };
    const weakTeammate = {
      ...withAura(emptyConfig('2'), '/abilities/speed_aura'),
      name: 'WeakMate',
    };
    weakTeammate.levels = { ...weakTeammate.levels, attack: 1 };

    const withParty = buildCombatPreviewData(strongHero, null, null, {
      partyPlayerConfigs: [strongHero, weakTeammate],
    });

    // The hero's own stronger cast remains active and must still be shown.
    expect(withParty.finalPlayer.activeBuffSourceKeys['/buff_uniques/speed_aura_attack_speed']).toBe('player1');
    expect(withParty.highlightSources.some((source) => source.sourceKey === 'ability-1-/abilities/speed_aura')).toBe(
      true,
    );
    // The weaker teammate cast still contributes no source.
    expect(withParty.highlightSources.some((source) => source.sourceKey?.startsWith('teammate-aura-'))).toBe(false);
  });
});
