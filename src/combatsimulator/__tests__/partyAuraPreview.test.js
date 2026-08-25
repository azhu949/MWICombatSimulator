import { describe, expect, it, vi } from 'vitest';
import CombatSimulator from '../combatSimulator.js';
import Player from '../player.js';
import Zone from '../zone.js';
import {
  buildPlayersForSimulation,
  buildCombatPreviewData,
  createEmptyPlayerConfig,
} from '../../services/playerMapper.js';

const MINUTE = 60e9;

function emptyConfig(id) {
  return { ...createEmptyPlayerConfig(String(id)), selected: true };
}

function withAura(config, abilityHrid, level = 1) {
  return {
    ...config,
    abilities: [{ abilityHrid, level }, ...config.abilities.slice(1)],
  };
}

async function runSimulation(players, durationNs = MINUTE) {
  const zone = new Zone('/actions/combat/sorcerers_tower', 0);
  const simulator = new CombatSimulator(players, zone, null, { enableHpMpVisualization: false });
  for (const player of players) {
    player.zoneBuffs = [];
    player.extraBuffs = [];
    player.generatePermanentBuffs();
  }
  await simulator.simulate(durationNs);
  return simulator;
}

describe('Party aura combat preview', () => {
  it('does not skip an earlier continuously-triggered attack to preview a later aura', () => {
    const heroConfig = emptyConfig('opener-order-hero');
    const teammateConfig = emptyConfig('opener-order-mate');
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/fireball', level: 1 },
      { abilityHrid: '/abilities/speed_aura', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    // 火球术没有冷却，仍是第一个可触发槽位，因此
    // 实时调度器永远不会到达后面的速度光环。
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeFalsy();
    expect(
      preview.highlightSources.some(
        (source) => source.sourceKey === 'teammate-aura-playeropener-order-mate-/abilities/speed_aura',
      ),
    ).toBe(false);
  });

  it('replays a one-shot prerequisite buff before selecting a later aura', () => {
    const heroConfig = emptyConfig('prerequisite-hero');
    const teammateConfig = emptyConfig('prerequisite-mate');
    teammateConfig.levels = { ...teammateConfig.levels, intelligence: 20 };
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/elemental_affinity', level: 1 },
      { abilityHrid: '/abilities/mystic_aura', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    expect(preview.finalPlayer.combatBuffs['/buff_uniques/mystic_aura_water_amplify']).toBeTruthy();
  });

  it("applies a teammate's opening drink before scaling their party aura", () => {
    const heroConfig = emptyConfig('drink-order-hero');
    const teammateConfig = withAura(emptyConfig('drink-order-mate'), '/abilities/speed_aura');
    teammateConfig.levels = { ...teammateConfig.levels, attack: 100 };
    teammateConfig.drinks[0] = '/items/attack_coffee';

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    // 攻击咖啡在光环乘数被实时战斗开局评估之前，
    // 将等级从 100 提升到 109（8% + 1 点固定值）。
    const expectedRatio = 0.03 * (1 + 109 * 0.005);
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBeCloseTo(
      expectedRatio,
      10,
    );
  });

  it("keeps a teammate's already-scheduled aura after an ally triggers their drink", () => {
    const heroConfig = emptyConfig('scheduled-aura-hero');
    const firstTeammate = withAura(emptyConfig('scheduled-aura-first'), '/abilities/speed_aura');
    const secondTeammate = withAura(emptyConfig('scheduled-aura-second'), '/abilities/speed_aura');
    secondTeammate.levels = { ...secondTeammate.levels, attack: 100 };
    secondTeammate.drinks[0] = '/items/attack_coffee';
    secondTeammate.triggerMap['/items/attack_coffee'] = [
      {
        dependencyHrid: '/combat_trigger_dependencies/all_allies',
        conditionHrid: '/combat_trigger_conditions/speed_aura',
        comparatorHrid: '/combat_trigger_comparators/is_active',
        value: 0,
      },
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, firstTeammate, secondTeammate],
    });

    // 两个光环在任一次施放结算之前都已排定。第一次
    // 施放激活第二位队友的饮品；其已排定的
    // 光环随后按攻击等级 109 缩放，并成为生效源。
    const expectedRatio = 0.03 * (1 + 109 * 0.005);
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBeCloseTo(
      expectedRatio,
      10,
    );
    expect(preview.finalPlayer.activeBuffSourceKeys['/buff_uniques/speed_aura_attack_speed']).toBe(
      'playerscheduled-aura-second',
    );
  });

  it('invalidates cached party aura triggers when the combat context changes', () => {
    const heroConfig = emptyConfig('context-cache-hero');
    const teammateConfig = withAura(emptyConfig('context-cache-mate'), '/abilities/speed_aura');
    teammateConfig.triggerMap['/abilities/speed_aura'] = [
      {
        dependencyHrid: '/combat_trigger_dependencies/all_enemies',
        conditionHrid: '/combat_trigger_conditions/number_of_active_units',
        comparatorHrid: '/combat_trigger_comparators/greater_than_equal',
        value: 4,
      },
    ];
    const options = { partyPlayerConfigs: [heroConfig, teammateConfig] };

    const fourEnemyPreview = buildCombatPreviewData(
      heroConfig,
      null,
      {
        zoneHrid: '/actions/combat/aqua_planet',
        difficultyTier: 0,
      },
      options,
    );
    const oneEnemyPreview = buildCombatPreviewData(
      heroConfig,
      null,
      {
        zoneHrid: '/actions/combat/alligator',
        difficultyTier: 0,
      },
      options,
    );

    expect(fourEnemyPreview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeTruthy();
    expect(oneEnemyPreview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeFalsy();
  });

  it("shows only the party auras affordable from a teammate's opening MP", async () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = emptyConfig('2');
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/speed_aura', level: 1 },
      { abilityHrid: '/abilities/critical_aura', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    expect(preview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeTruthy();
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_cast_speed']).toBeTruthy();
    // 一级队友有 110 魔法值；每个官方队伍光环消耗 100。
    // 第一个槽位可以施放，但第二个槽位不行。
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/critical_aura_rate']).toBeFalsy();
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/critical_aura_damage']).toBeFalsy();

    const auraSourceHrids = preview.highlightSources
      .filter((source) => source.sourceKey?.startsWith('teammate-aura-player2-'))
      .map((source) => source.sourceHrid);
    expect(auraSourceHrids).toEqual(['/abilities/speed_aura']);

    // 端到端一致性：使用相同配置，真实引擎的一分钟
    // 也拥有足够施放速度光环的魔法值，但不够施放暴击光环。
    const simulationPlayers = buildPlayersForSimulation([heroConfig, teammateConfig]);
    await runSimulation(simulationPlayers);
    expect(simulationPlayers[0].combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeTruthy();
    expect(simulationPlayers[0].combatBuffs['/buff_uniques/critical_aura_rate']).toBeFalsy();
  });

  it("replays multiple party auras when the teammate's opening MP covers their costs", () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = emptyConfig('2');
    teammateConfig.levels = { ...teammateConfig.levels, intelligence: 20 };
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/speed_aura', level: 1 },
      { abilityHrid: '/abilities/critical_aura', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    expect(preview.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeTruthy();
    expect(preview.finalPlayer.combatBuffs['/buff_uniques/critical_aura_rate']).toBeTruthy();
    expect(
      preview.highlightSources.filter((source) => source.sourceKey?.startsWith('teammate-aura-player2-')),
    ).toHaveLength(2);
  });

  it('includes all 14 buffs from the five party auras in the party preview', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = emptyConfig('2');
    teammateConfig.levels = { ...teammateConfig.levels, intelligence: 90 };
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/speed_aura', level: 1 },
      { abilityHrid: '/abilities/guardian_aura', level: 1 },
      { abilityHrid: '/abilities/fierce_aura', level: 1 },
      { abilityHrid: '/abilities/critical_aura', level: 1 },
      { abilityHrid: '/abilities/mystic_aura', level: 1 },
    ];

    const expectedPartyAuraBuffHrids = [
      '/buff_uniques/speed_aura_attack_speed',
      '/buff_uniques/speed_aura_cast_speed',
      '/buff_uniques/guardian_aura_healing_amplify',
      '/buff_uniques/guardian_aura_evasion',
      '/buff_uniques/guardian_aura_armor',
      '/buff_uniques/guardian_aura_water_resistance',
      '/buff_uniques/guardian_aura_nature_resistance',
      '/buff_uniques/guardian_aura_fire_resistance',
      '/buff_uniques/fierce_aura',
      '/buff_uniques/critical_aura_rate',
      '/buff_uniques/critical_aura_damage',
      '/buff_uniques/mystic_aura_water_amplify',
      '/buff_uniques/mystic_aura_nature_amplify',
      '/buff_uniques/mystic_aura_fire_amplify',
    ];

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    expect(expectedPartyAuraBuffHrids).toHaveLength(14);
    for (const uniqueHrid of expectedPartyAuraBuffHrids) {
      expect(preview.finalPlayer.combatBuffs[uniqueHrid]).toBeTruthy();
    }
  });

  it('does not deep-clone the hero for each teammate aura attribution snapshot', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = emptyConfig('2');
    teammateConfig.levels = { ...teammateConfig.levels, intelligence: 90 };
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/speed_aura', level: 1 },
      { abilityHrid: '/abilities/guardian_aura', level: 1 },
      { abilityHrid: '/abilities/fierce_aura', level: 1 },
      { abilityHrid: '/abilities/critical_aura', level: 1 },
      { abilityHrid: '/abilities/mystic_aura', level: 1 },
    ];

    const cloneSpy = vi.spyOn(globalThis, 'structuredClone');
    try {
      const preview = buildCombatPreviewData(heroConfig, null, null, {
        partyPlayerConfigs: [heroConfig, teammateConfig],
      });

      expect(
        preview.highlightSources.filter((source) => source.sourceKey?.startsWith('teammate-aura-player2-')),
      ).toHaveLength(5);
      expect(cloneSpy.mock.calls.some(([value]) => value instanceof Player)).toBe(false);
    } finally {
      cloneSpy.mockRestore();
    }
  });

  it('reuses party aura results for unrelated edits and invalidates on relevant in-place changes', () => {
    const heroConfig = emptyConfig('cache-hero');
    const teammateConfig = withAura(emptyConfig('cache-mate'), '/abilities/speed_aura');
    teammateConfig.levels = { ...teammateConfig.levels, attack: 1 };

    const buildPreview = () =>
      buildCombatPreviewData(heroConfig, null, null, {
        partyPlayerConfigs: [heroConfig, teammateConfig],
      });
    const findAuraSource = (preview) =>
      preview.highlightSources.find(
        (source) => source.sourceKey === 'teammate-aura-playercache-mate-/abilities/speed_aura',
      );

    const first = buildPreview();
    const firstSource = findAuraSource(first);
    expect(firstSource).toBeTruthy();

    // 技能经验是 UI/成长元数据，不参与
    // 队伍光环开启状态模拟。
    teammateConfig.skillExperience.attack = 123_456;
    const afterUnrelatedEdit = buildPreview();
    // 缓存命中交出隔离的快照（structuredClone），因此
    // 源条目与第一次构建的结果是内容相等而非引用相等。
    expect(findAuraSource(afterUnrelatedEdit)).toStrictEqual(firstSource);

    // Store 的编辑会改动现有配置对象。值签名
    // 仍必须在光环相关字段改变时失效。
    teammateConfig.levels.attack = 800;
    const afterRelevantEdit = buildPreview();
    expect(findAuraSource(afterRelevantEdit)).not.toBe(firstSource);
    expect(afterRelevantEdit.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBeCloseTo(
      0.03 * (1 + 800 * 0.005),
      10,
    );
  });

  it('includes teammate auras in final panel stats and source details when teammates are selected', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = {
      ...withAura(emptyConfig('2'), '/abilities/speed_aura'),
      name: 'AuraBuddy',
    };

    const solo = buildCombatPreviewData(heroConfig);
    const withParty = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    // 无队伍：无队友光环。
    expect(solo.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeFalsy();
    // 有队伍：主角获得队友光环并攻击更快。
    expect(withParty.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeTruthy();
    expect(withParty.finalPlayer.buffSources['/buff_uniques/speed_aura_attack_speed'].has('player2')).toBe(true);
    expect(withParty.finalPlayer.buffSources['/buff_uniques/speed_aura_attack_speed'].has('party-aura')).toBe(false);
    expect(withParty.finalPlayer.combatDetails.combatStats.attackInterval).toBeLessThan(
      solo.finalPlayer.combatDetails.combatStats.attackInterval,
    );

    // 源详情包含一条队友光环条目（队友名 + 光环名）。
    const auraSource = withParty.highlightSources.find((source) => source.sourceKey?.startsWith('teammate-aura-'));
    expect(auraSource).toBeTruthy();
    expect(auraSource.sourceHrid).toBe('/abilities/speed_aura');
    expect(auraSource.sourceName).toContain('AuraBuddy');
    // attackInterval 拆解条目包含该源。
    const breakdowns = withParty.statBreakdowns || {};
    const intervalBreakdown = Object.values(breakdowns).find((entry) =>
      entry?.sources?.some((source) => source.sourceKey?.startsWith('teammate-aura-')),
    );
    expect(intervalBreakdown).toBeTruthy();
  });

  it('preserves real sources and supports source handoff for the same aura from multiple teammates', () => {
    const heroConfig = emptyConfig('1');
    const strongTeammate = withAura(emptyConfig('2'), '/abilities/speed_aura');
    const weakTeammate = withAura(emptyConfig('3'), '/abilities/speed_aura');
    strongTeammate.levels = { ...strongTeammate.levels, attack: 800 };
    weakTeammate.levels = { ...weakTeammate.levels, attack: 1 };
    strongTeammate.triggerMap = { '/abilities/speed_aura': [] };
    weakTeammate.triggerMap = { '/abilities/speed_aura': [] };

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, strongTeammate, weakTeammate],
    });
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    const sources = preview.finalPlayer.buffSources[uniqueHrid];

    expect(sources.has('player2')).toBe(true);
    expect(sources.has('player3')).toBe(true);
    expect(sources.has('party-aura')).toBe(false);
    expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe('player2');
    expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03 * (1 + 800 * 0.005), 10);

    // 给两个预览源不同的生命周期，以演练
    // 战斗引擎使用的同一最强源交接（handoff）。
    sources.get('player2').expiresAt = 1;
    sources.get('player3').expiresAt = 100;
    preview.finalPlayer.removeExpiredBuffs(2);

    expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe('player3');
    expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03 * (1 + 1 * 0.005), 10);
  });

  it('does not include unselected teammates in the panel preview', () => {
    const heroConfig = emptyConfig('1');
    const unselectedTeammate = { ...withAura(emptyConfig('2'), '/abilities/speed_aura'), selected: false };

    const withParty = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, unselectedTeammate],
    });

    expect(withParty.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed']).toBeFalsy();
  });

  it('uses the stronger version when the hero and a teammate both provide an aura', () => {
    const strongHero = withAura(emptyConfig('1'), '/abilities/speed_aura');
    strongHero.levels = { ...strongHero.levels, attack: 800 };
    const weakTeammate = {
      ...withAura(emptyConfig('2'), '/abilities/speed_aura'),
      name: 'WeakMate',
    };
    weakTeammate.levels = { ...weakTeammate.levels, attack: 1 };

    const solo = buildCombatPreviewData(strongHero);
    const withParty = buildCombatPreviewData(strongHero, null, null, {
      partyPlayerConfigs: [strongHero, weakTeammate],
    });

    // 主角自身的光环（强）处于生效状态。
    expect(solo.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBeCloseTo(
      0.03 * (1 + 800 * 0.005),
      10,
    );
    // 较弱的队友光环不得覆盖它；数值保持不变。
    expect(withParty.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBeCloseTo(
      0.03 * (1 + 800 * 0.005),
      10,
    );
    // 由于较弱的光环不产生净变化，因此不会生成队友光环源条目。
    expect(withParty.highlightSources.some((source) => source.sourceKey?.startsWith('teammate-aura-'))).toBe(false);
  });

  it('attributes a stat to the strongest teammate aura only, but preserves every source for handoff', () => {
    const heroConfig = emptyConfig('1');
    const weakMate = withAura(emptyConfig('2'), '/abilities/speed_aura');
    weakMate.levels = { ...weakMate.levels, attack: 1 };
    const strongMate = withAura(emptyConfig('3'), '/abilities/speed_aura');
    strongMate.levels = { ...strongMate.levels, attack: 800 };
    weakMate.triggerMap = { '/abilities/speed_aura': [] };
    strongMate.triggerMap = { '/abilities/speed_aura': [] };

    const preview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, weakMate, strongMate],
    });
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    const auraSources = preview.highlightSources.filter((source) => source.sourceKey?.startsWith('teammate-aura-'));

    // 只有实际的生效贡献者（更强的队友，最后施放）才会
    // 作为源显示；较弱队友较早的施放已被覆盖，
    // 未贡献任何最终属性变化。
    expect(auraSources).toHaveLength(1);
    expect(auraSources[0].sourceKey).toBe('teammate-aura-player3-/abilities/speed_aura');
    // 最终状态中生效的是最强源 ...
    expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe('player3');
    expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03 * (1 + 800 * 0.005), 10);
    // ... 但每个源仍保持注册，以便最强源在过期时交接
    // （状态保留与归因是分离的）。
    expect(preview.finalPlayer.buffSources[uniqueHrid].has('player2')).toBe(true);
    expect(preview.finalPlayer.buffSources[uniqueHrid].has('player3')).toBe(true);
    // 速度光环降低攻击间隔：负数差值与其
    // 源都被保留，因此有利的缩减永远不会被丢弃。
    const intervalSource = auraSources[0].changedStats.find((stat) => stat.key === 'attackIntervalSeconds');
    expect(intervalSource).toBeTruthy();
    expect(intervalSource.deltaValue).toBeLessThan(0);
    // attackInterval 拆解只列出生效的贡献者。
    const breakdowns = preview.statBreakdowns || {};
    const intervalBreakdown = Object.values(breakdowns).find((entry) =>
      entry?.sources?.some((source) => source.sourceKey?.startsWith('teammate-aura-')),
    );
    expect(intervalBreakdown).toBeTruthy();
    expect(intervalBreakdown.sources).toHaveLength(1);
    expect(intervalBreakdown.sources[0].sourceKey).toBe('teammate-aura-player3-/abilities/speed_aura');
  });

  it("excludes multiple weaker teammate auras that cannot beat the hero's own stronger buff", () => {
    const strongHero = withAura(emptyConfig('1'), '/abilities/speed_aura');
    strongHero.levels = { ...strongHero.levels, attack: 800 };
    const weakMateA = { ...withAura(emptyConfig('2'), '/abilities/speed_aura'), name: 'WeakMateA' };
    const weakMateB = { ...withAura(emptyConfig('3'), '/abilities/speed_aura'), name: 'WeakMateB' };
    weakMateA.levels = { ...weakMateA.levels, attack: 1 };
    weakMateB.levels = { ...weakMateB.levels, attack: 2 };
    weakMateA.triggerMap = { '/abilities/speed_aura': [] };
    weakMateB.triggerMap = { '/abilities/speed_aura': [] };

    const withParty = buildCombatPreviewData(strongHero, null, null, {
      partyPlayerConfigs: [strongHero, weakMateA, weakMateB],
    });

    // 在累加顺序下，主角自身更强的光环保持生效；
    // 两个较弱的队友都不会产生可见变化或源条目。
    expect(withParty.finalPlayer.combatBuffs['/buff_uniques/speed_aura_attack_speed'].ratioBoost).toBeCloseTo(
      0.03 * (1 + 800 * 0.005),
      10,
    );
    expect(withParty.highlightSources.filter((source) => source.sourceKey?.startsWith('teammate-aura-'))).toHaveLength(
      0,
    );
  });

  it('does not leak caller-side mutations into later cache hits', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = withAura(emptyConfig('2'), '/abilities/speed_aura');
    teammateConfig.levels = { ...teammateConfig.levels, attack: 100 };
    teammateConfig.triggerMap = { '/abilities/speed_aura': [] };

    const firstPreview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    // 相同缓存键：第二次构建必须命中模块缓存。
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    const firstBuff = firstPreview.finalPlayer.combatBuffs[uniqueHrid];

    // 破坏第一次构建交出的*每个*对象：克隆进 finalPlayer 的
    // 增益、sourceBuffs 中捕获的增益、
    // highlightSources 数组以及一条高亮条目。
    firstBuff.ratioBoost = 999;
    const auraAuraSource = firstPreview.highlightSources.find((source) =>
      source.sourceKey?.startsWith('teammate-aura-'),
    );
    auraAuraSource.sourceName = 'corrupted';
    auraAuraSource.changedStats = [];

    const secondPreview = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });

    // 新的构建必须不受第一次构建的改动影响：
    // 最终增益强度与高亮归因都会从权威的
    // 缓存状态重建。
    const secondBuff = secondPreview.finalPlayer.combatBuffs[uniqueHrid];
    expect(secondBuff.ratioBoost).toBeCloseTo(0.03 * (1 + 100 * 0.005), 10);
    expect(secondPreview.highlightSources.some((source) => source.sourceKey?.startsWith('teammate-aura-'))).toBe(true);
    const secondAuraSource = secondPreview.highlightSources.find((source) =>
      source.sourceKey?.startsWith('teammate-aura-'),
    );
    expect(secondAuraSource.sourceName).toContain('Player 2');
    expect(secondAuraSource.changedStats.length).toBeGreaterThan(0);
  });

  it('flags and caches party preview truncation after the event budget is exhausted', () => {
    const heroConfig = emptyConfig('event-budget-hero');
    const teammateConfig = emptyConfig('event-budget-mate');
    teammateConfig.levels = { ...teammateConfig.levels, intelligence: 600 };
    teammateConfig.abilities = [
      { abilityHrid: '/abilities/fireball', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const options = { partyPlayerConfigs: [heroConfig, teammateConfig] };
      const preview = buildCombatPreviewData(heroConfig, null, null, options);

      // 火球术只消耗 10 魔法值且没有冷却。智力 600
      // 让队友拥有足够的开场魔法值来排队 512 次以上的施放，
      // 因此回放必须因 maxEvents 而停止，而不是收敛。
      expect(preview.partyAuraPreviewTruncated).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stopped after 512 events'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('preview may be incomplete'));

      // 截断的结果连同其警告标志一起缓存，而不是
      // 合并进普通的 null/无光环缓存条目。
      const cachedHit = buildCombatPreviewData(heroConfig, null, null, options);
      expect(cachedHit.partyAuraPreviewTruncated).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps partyAuraPreviewTruncated false for a converging party preview', () => {
    const heroConfig = emptyConfig('1');
    const teammateConfig = withAura(emptyConfig('2'), '/abilities/speed_aura');
    teammateConfig.levels = { ...teammateConfig.levels, attack: 100 };

    // 单人预览（未配置队伍）不得被标记为截断。
    const solo = buildCombatPreviewData(heroConfig);
    expect(solo.partyAuraPreviewTruncated).toBe(false);

    // 正常的队伍回放会在事件预算内顺利收敛。
    const withParty = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });
    expect(withParty.partyAuraPreviewTruncated).toBe(false);

    // 从缓存供应的相同键必须保留该标志。
    const cachedHit = buildCombatPreviewData(heroConfig, null, null, {
      partyPlayerConfigs: [heroConfig, teammateConfig],
    });
    expect(cachedHit.partyAuraPreviewTruncated).toBe(false);
  });
});
