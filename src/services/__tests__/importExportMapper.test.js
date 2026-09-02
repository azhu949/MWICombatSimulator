import { describe, expect, it } from 'vitest';
import actionDetailMap from '../../combatsimulator/data/actionDetailMap.json';
import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import { combatGuildBuffDetails, combatGuildBuffHrids, getGuildBuffMaxLevel } from '../../shared/guildBuffs.js';
import { createEmptyPlayerConfig } from '../playerMapper.js';
import { exportGroupConfig, exportSoloConfig, importGroupConfig, importSoloConfig } from '../importExportMapper.js';
import {
  createMainSiteCurrentCharacterFixture,
  createMainSiteShareProfileFixture,
} from './fixtures/mainSiteShareProfileFixture.js';

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

function findFirstEquipmentItemByType(equipmentTypeHrid) {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/equipment' &&
      String(entry?.equipmentDetail?.type || '') === equipmentTypeHrid,
  );
  return item?.hrid ?? '';
}

function findFirstFoodWithDefaultTriggers() {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/food' &&
      Array.isArray(entry?.consumableDetail?.defaultCombatTriggers) &&
      entry.consumableDetail.defaultCombatTriggers.length > 0,
  );
  return item?.hrid ?? '';
}

function findFirstDrinkWithDefaultTriggers() {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/drink' &&
      Array.isArray(entry?.consumableDetail?.defaultCombatTriggers) &&
      entry.consumableDetail.defaultCombatTriggers.length > 0,
  );
  return item?.hrid ?? '';
}

function findFirstAbilityWithDefaultTriggers() {
  const ability = Object.values(abilityDetailMap).find(
    (entry) =>
      !entry?.isSpecialAbility && Array.isArray(entry?.defaultCombatTriggers) && entry.defaultCombatTriggers.length > 0,
  );
  return ability?.hrid ?? '';
}

function findFirstSpecialAbility() {
  const ability = Object.values(abilityDetailMap).find((entry) => entry?.isSpecialAbility === true);
  return ability?.hrid ?? '';
}

function findAnotherStandardAbility(excludedHrid = '') {
  const excluded = String(excludedHrid || '');
  const ability = Object.values(abilityDetailMap).find(
    (entry) => !entry?.isSpecialAbility && String(entry?.hrid || '') !== excluded,
  );
  return ability?.hrid ?? '';
}

function findFirstCombatAction(isDungeon = false) {
  const action = Object.values(actionDetailMap).find(
    (entry) =>
      String(entry?.type || '') === '/action_types/combat' &&
      Boolean(entry?.combatZoneInfo?.isDungeon) === isDungeon &&
      Number(entry?.maxDifficulty ?? 0) >= 0,
  );
  return action?.hrid ?? '';
}

function createConfiguredPlayer(id = 1) {
  const player = createEmptyPlayerConfig(id);
  player.levels.attack = 33;
  player.levels.magic = 44;
  player.levels.stamina = 55;
  player.equipment.head = {
    itemHrid: findFirstEquipmentItemByType('/equipment_types/head'),
    enhancementLevel: 3,
  };
  player.food[0] = findFirstFoodWithDefaultTriggers();
  player.drinks[0] = findFirstDrinkWithDefaultTriggers();
  player.abilities[0] = {
    abilityHrid: findFirstAbilityWithDefaultTriggers(),
    level: 7,
  };
  player.triggerMap[player.food[0]] = [];
  player.houseRooms[Object.keys(player.houseRooms)[0]] = 2;
  player.guildBuffs[combatGuildBuffDetails[0].hrid] = 4;
  player.achievements = { '/achievements/test': true };
  return player;
}

describe('importExportMapper', () => {
  it('exports modern group payload', () => {
    const players = [createConfiguredPlayer(1), createConfiguredPlayer(2)];
    const settings = createSimulationSettings();

    const exported = exportGroupConfig(players, settings);
    const parsed = JSON.parse(exported);

    expect(parsed.version).toBe(2);
    expect(parsed.format).toBe('mwi-vue-group');
    expect(parsed.players).toHaveLength(2);
    expect(parsed.players[0].levels.attack).toBe(33);
    expect(Object.values(parsed.players[0].houseRooms).every((level) => Number(level) > 0)).toBe(true);
    expect(Object.keys(parsed.players[0].houseRooms)).toHaveLength(1);
    expect(parsed.simulationSettings.zoneHrid).toBe(settings.zoneHrid);
  });

  it('exports modern solo payload', () => {
    const player = createConfiguredPlayer(1);
    const settings = createSimulationSettings();

    const exported = exportSoloConfig(player, settings);
    const parsed = JSON.parse(exported);

    expect(parsed.version).toBe(2);
    expect(parsed.format).toBe('mwi-vue-solo');
    expect(parsed.player.levels.magic).toBe(44);
    expect(parsed.player.food[0]).toBe(player.food[0]);
    expect(parsed.player.guildBuffs[combatGuildBuffDetails[0].hrid]).toBe(4);
    expect(Object.values(parsed.player.houseRooms).every((level) => Number(level) > 0)).toBe(true);
    expect(Object.keys(parsed.player.houseRooms)).toHaveLength(1);
  });

  it('keeps an explicit empty house room map in exports', () => {
    const player = createEmptyPlayerConfig(1);
    const parsed = JSON.parse(exportSoloConfig(player, createSimulationSettings()));

    expect(parsed.player).toHaveProperty('houseRooms');
    expect(parsed.player.houseRooms).toEqual({});
  });

  it('omits unknown house room hrids from portable exports', () => {
    const player = createConfiguredPlayer(1);
    const knownRoomHrid = Object.keys(player.houseRooms).find((hrid) => player.houseRooms[hrid] > 0);
    const unknownRoomHrid = '/house_rooms/removed_or_misspelled';
    player.houseRooms[unknownRoomHrid] = 7;

    const soloPlayer = JSON.parse(exportSoloConfig(player, createSimulationSettings())).player;
    const groupPlayer = JSON.parse(exportGroupConfig([player], createSimulationSettings())).players[0];

    expect(soloPlayer.houseRooms).toEqual({ [knownRoomHrid]: 2 });
    expect(groupPlayer.houseRooms).toEqual({ [knownRoomHrid]: 2 });
    expect(soloPlayer.houseRooms).not.toHaveProperty(unknownRoomHrid);
    expect(groupPlayer.houseRooms).not.toHaveProperty(unknownRoomHrid);
  });

  it('removes unknown house room hrids during modern import', () => {
    const fallbackPlayer = createEmptyPlayerConfig(1);
    const knownRoomHrid = Object.keys(fallbackPlayer.houseRooms)[0];
    const unknownRoomHrid = '/house_rooms/removed_or_misspelled';
    const payload = {
      version: 2,
      format: 'mwi-vue-solo',
      player: {
        id: '1',
        houseRooms: {
          [knownRoomHrid]: 4,
          [unknownRoomHrid]: 7,
        },
      },
    };

    const result = importSoloConfig(JSON.stringify(payload), fallbackPlayer, createSimulationSettings());

    expect(result.player.houseRooms[knownRoomHrid]).toBe(4);
    expect(result.player.houseRooms).not.toHaveProperty(unknownRoomHrid);
  });

  it('imports modern group payload', () => {
    const players = [createConfiguredPlayer(1), createConfiguredPlayer(2)];
    const settings = {
      ...createSimulationSettings(),
      zoneHrid: findFirstCombatAction(false),
      dungeonHrid: findFirstCombatAction(true),
      difficultyTier: 2,
    };

    const result = importGroupConfig(exportGroupConfig(players, settings), players, createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-group');
    expect(result.players[0].levels.attack).toBe(33);
    expect(result.simulationSettings.zoneHrid).toBe(settings.zoneHrid);
    expect(result.simulationSettings.difficultyTier).toBe(2);
  });

  it('imports modern solo payload', () => {
    const player = createConfiguredPlayer(1);
    const settings = {
      ...createSimulationSettings(),
      zoneHrid: findFirstCombatAction(false),
      simulationTimeHours: 12,
    };

    const result = importSoloConfig(
      exportSoloConfig(player, settings),
      createEmptyPlayerConfig(1),
      createSimulationSettings(),
    );

    expect(result.detectedFormat).toBe('modern-solo');
    expect(result.player.levels.attack).toBe(33);
    expect(result.player.skillExperience.attack).toBeNull();
    expect(result.player.guildBuffs[combatGuildBuffDetails[0].hrid]).toBe(4);
    expect(result.simulationSettings.zoneHrid).toBe(settings.zoneHrid);
    expect(result.simulationSettings.simulationTimeHours).toBe(12);
  });

  it('defaults guild buffs to zero when an older simulator config omits them', () => {
    const guildBuffHrid = combatGuildBuffDetails[0].hrid;
    const fallbackPlayer = createEmptyPlayerConfig(1);
    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;
    const payload = JSON.parse(exportSoloConfig(createConfiguredPlayer(1), createSimulationSettings()));
    delete payload.player.guildBuffs;

    const result = importSoloConfig(JSON.stringify(payload), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-solo');
    expect(result.player.guildBuffs[guildBuffHrid]).toBe(0);
  });

  it('imports legacy solo payload for manual paste compatibility', () => {
    const fallbackPlayer = createEmptyPlayerConfig(1);
    const guildBuffHrid = combatGuildBuffDetails[0].hrid;
    fallbackPlayer.achievements = { '/achievements/existing': true };
    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;

    const legacyPayload = {
      player: {
        attackLevel: 117,
        magicLevel: 125,
        meleeLevel: 66,
        rangedLevel: 52,
        defenseLevel: 112,
        staminaLevel: 103,
        intelligenceLevel: 102,
        equipment: [
          {
            itemLocationHrid: '/item_locations/head',
            itemHrid: '/items/magicians_hat',
            enhancementLevel: 6,
          },
          {
            itemLocationHrid: '/item_locations/main_hand',
            itemHrid: '/items/blazing_trident',
            enhancementLevel: 10,
          },
          {
            itemLocationHrid: '/item_locations/off_hand',
            itemHrid: '/items/bishops_codex',
            enhancementLevel: 5,
          },
        ],
      },
      food: {
        '/action_types/combat': [
          { itemHrid: '/items/star_fruit_gummy' },
          { itemHrid: '/items/dragon_fruit_yogurt' },
          { itemHrid: '/items/marsberry_cake' },
        ],
      },
      drinks: {
        '/action_types/combat': [
          { itemHrid: '/items/wisdom_coffee' },
          { itemHrid: '/items/super_magic_coffee' },
          { itemHrid: '/items/channeling_coffee' },
        ],
      },
      abilities: [
        { abilityHrid: '/abilities/mystic_aura', level: 26 },
        { abilityHrid: '/abilities/elemental_affinity', level: 60 },
        { abilityHrid: '/abilities/firestorm', level: 60 },
        { abilityHrid: '/abilities/flame_blast', level: 70 },
        { abilityHrid: '/abilities/fireball', level: 70 },
      ],
      triggerMap: {
        '/abilities/mystic_aura': [],
      },
      houseRooms: {
        '/house_rooms/archery_range': 1,
        '/house_rooms/removed_or_misspelled': 7,
      },
      zone: '/actions/combat/jungle_planet',
      difficulty: '2',
      simulationTime: '12',
    };

    const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('legacy-solo');
    expect(result.player.levels.attack).toBe(117);
    expect(result.player.equipment.weapon.itemHrid).toBe('/items/blazing_trident');
    expect(result.player.food[0]).toBe('/items/star_fruit_gummy');
    expect(result.player.abilities[4].abilityHrid).toBe('/abilities/fireball');
    expect(result.player.achievements).toEqual({ '/achievements/existing': true });
    expect(result.player.guildBuffs[guildBuffHrid]).toBe(0);
    expect(result.player.houseRooms['/house_rooms/archery_range']).toBe(1);
    expect(result.player.houseRooms).not.toHaveProperty('/house_rooms/removed_or_misspelled');
    expect(result.simulationSettings.zoneHrid).toBe('/actions/combat/jungle_planet');
    expect(result.simulationSettings.difficultyTier).toBe(2);
    expect(result.simulationSettings.simulationTimeHours).toBe(12);
  });

  it('normalizes legacy item location hrids before mapping equipment slots', () => {
    const fallbackPlayer = createEmptyPlayerConfig(1);
    const legacyPayload = {
      player: {
        equipment: [
          {
            itemLocationHrid: ' /item_locations/head ',
            itemHrid: '/items/magicians_hat',
            enhancementLevel: 6,
          },
          {
            itemLocationHrid: ' /item_locations/main_hand ',
            itemHrid: '/items/blazing_trident',
            enhancementLevel: 10,
          },
        ],
      },
    };

    const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('legacy-solo');
    expect(result.player.equipment.head.itemHrid).toBe('/items/magicians_hat');
    expect(result.player.equipment.weapon.itemHrid).toBe('/items/blazing_trident');
  });

  it('preserves legacy trinket item locations for preview-only task badge highlights', () => {
    const fallbackPlayer = createEmptyPlayerConfig(1);
    const legacyPayload = {
      player: {
        equipment: [
          {
            itemLocationHrid: '/item_locations/trinket',
            itemHrid: '/items/basic_task_badge',
            enhancementLevel: 2,
          },
        ],
      },
    };

    const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('legacy-solo');
    expect(result.player.equipment.trinket).toEqual({
      itemHrid: '/items/basic_task_badge',
      enhancementLevel: 2,
    });
  });

  it('clears fallback preview-only trinkets when a legacy import omits them', () => {
    const fallbackPlayer = createEmptyPlayerConfig(1);
    fallbackPlayer.equipment.trinket = {
      itemHrid: '/items/expert_task_badge',
      enhancementLevel: 4,
    };

    const legacyPayload = {
      player: {
        equipment: [],
      },
    };

    const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('legacy-solo');
    expect(result.player.equipment.trinket).toEqual({
      itemHrid: '',
      enhancementLevel: 0,
    });
  });

  it('imports modern player-only payload', () => {
    const player = createConfiguredPlayer(2);

    const result = importSoloConfig(JSON.stringify(player), createEmptyPlayerConfig(2), createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-player-only');
    expect(result.player.levels.attack).toBe(33);
    expect(result.simulationSettings.zoneHrid).toBe(createSimulationSettings().zoneHrid);
  });

  it('clamps out-of-range enhancement levels to the game max of 20', () => {
    const player = createConfiguredPlayer(2);
    // 手注 JSON 超限值：999 远超游戏上限、20.7 小数、-5 负数。
    player.equipment.head = {
      itemHrid: findFirstEquipmentItemByType('/equipment_types/head'),
      enhancementLevel: 999,
    };
    player.equipment.trinket = {
      itemHrid: '/items/expert_task_badge',
      enhancementLevel: 20.7,
    };
    player.equipment.off_hand = {
      itemHrid: findFirstEquipmentItemByType('/equipment_types/head'),
      enhancementLevel: -5,
    };

    const result = importSoloConfig(JSON.stringify(player), createEmptyPlayerConfig(2), createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-player-only');
    // 超限值钳到游戏上限 20：行元数据与成本法计价（内部已钳 20）一致，
    // 且战斗模拟倍率表（21 元素 0-20）索引不越界。
    expect(result.player.equipment.head.enhancementLevel).toBe(20);
    // 小数向下取整后仍受 20 上限约束；负数钳到 0。
    expect(result.player.equipment.trinket.enhancementLevel).toBe(20);
    expect(result.player.equipment.off_hand.enhancementLevel).toBe(0);
  });

  // B4（2026-09-01）：clampEnhancementLevel 的 4 处应用点中 sanitizePlayerConfig
  // （modern-* 共用路径）由上一用例覆盖；legacy-solo / share-profile / current-character
  // 三条独立提取路径此前无超限断言——任一处漏接会让 999/负数穿透玩家配置（行元数据
  // 显示 +999、战斗模拟倍率表索引 undefined、计价按 +20 三者不一致）。
  it('clamps out-of-range enhancement levels on the legacy-solo / share-profile / current-character paths', () => {
    const headItemHrid = findFirstEquipmentItemByType('/equipment_types/head');
    expect(headItemHrid).toBeTruthy();

    const legacyResult = importSoloConfig(
      JSON.stringify({
        player: {
          equipment: [
            { itemLocationHrid: '/item_locations/head', itemHrid: headItemHrid, enhancementLevel: 999 },
            { itemLocationHrid: '/item_locations/off_hand', itemHrid: headItemHrid, enhancementLevel: -5 },
          ],
        },
      }),
      createEmptyPlayerConfig(21),
      createSimulationSettings(),
    );
    expect(legacyResult.detectedFormat).toBe('legacy-solo');
    expect(legacyResult.player.equipment.head.enhancementLevel).toBe(20);
    expect(legacyResult.player.equipment.off_hand.enhancementLevel).toBe(0);

    const shareProfileResult = importSoloConfig(
      JSON.stringify(
        createMainSiteShareProfileFixture({
          characterName: 'Clamp Share Hero',
          wearableItemMap: {
            head: {
              currentItem: {
                itemLocationHrid: '/item_locations/head',
                itemHrid: headItemHrid,
                enhancementLevel: 999,
              },
            },
          },
        }),
      ),
      createEmptyPlayerConfig(22),
      createSimulationSettings(),
    );
    expect(shareProfileResult.detectedFormat).toBe('main-site-share-profile');
    expect(shareProfileResult.player.equipment.head.enhancementLevel).toBe(20);

    const currentCharacterResult = importSoloConfig(
      JSON.stringify(
        createMainSiteCurrentCharacterFixture({
          characterName: 'Clamp Current Hero',
          characterItems: [
            {
              itemLocationHrid: '/item_locations/trinket',
              itemHrid: '/items/expert_task_badge',
              enhancementLevel: 20.7,
            },
          ],
        }),
      ),
      createEmptyPlayerConfig(23),
      createSimulationSettings(),
    );
    expect(currentCharacterResult.detectedFormat).toBe('main-site-current-character');
    expect(currentCharacterResult.player.equipment.trinket.enhancementLevel).toBe(20);
  });

  it('clears fallback preview-only trinkets when a modern player-only import omits them', () => {
    const fallbackPlayer = createEmptyPlayerConfig(2);
    fallbackPlayer.equipment.trinket = {
      itemHrid: '/items/expert_task_badge',
      enhancementLevel: 4,
    };

    const importedPlayer = createConfiguredPlayer(2);

    const result = importSoloConfig(JSON.stringify(importedPlayer), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-player-only');
    expect(result.player.equipment.trinket).toEqual({
      itemHrid: '',
      enhancementLevel: 0,
    });
  });

  it('imports main-site share profile payload', () => {
    const fallbackPlayer = createEmptyPlayerConfig(3);
    const guildBuffHrid = combatGuildBuffDetails[0].hrid;
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    const specialAbilityHrid = findFirstSpecialAbility();
    const zoneActionHrid = findFirstCombatAction(false);

    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;

    expect(abilityHrid).toBeTruthy();
    expect(specialAbilityHrid).toBeTruthy();

    const fixture = {
      ...createMainSiteShareProfileFixture({
        characterName: 'Fixture Hero',
        equippedAbilities: [
          {
            slotNumber: 1,
            abilityHrid,
            level: 6,
          },
          {
            abilityHrid: specialAbilityHrid,
            level: 4,
          },
        ],
      }),
      mainSiteCombat: {
        actionHrid: zoneActionHrid,
        difficultyTier: 1,
      },
    };

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');
    expect(result.player.id).toBe('3');
    expect(result.player.name).toBe('Fixture Hero');
    expect(result.player.abilities[0]).toEqual({
      abilityHrid: specialAbilityHrid,
      level: 4,
    });
    expect(result.player.guildBuffs[guildBuffHrid]).toBe(9);
    expect(result.player.abilities[1]).toEqual({
      abilityHrid,
      level: 6,
    });
    expect(result.simulationSettings.zoneHrid).toBe(zoneActionHrid);
  });

  it('imports main-site current character payload', () => {
    const fallbackPlayer = createEmptyPlayerConfig(4);
    const headItemHrid = findFirstEquipmentItemByType('/equipment_types/head');
    const weaponItemHrid = findFirstEquipmentItemByType('/equipment_types/two_hand');
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const drinkItemHrid = findFirstDrinkWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    const specialAbilityHrid = findFirstSpecialAbility();
    const zoneActionHrid = findFirstCombatAction(false);
    const houseRoomHrid = Object.keys(fallbackPlayer.houseRooms)[0];

    expect(specialAbilityHrid).toBeTruthy();

    const fixture = {
      ...createMainSiteCurrentCharacterFixture({
        characterName: 'Current Fixture Hero',
        skills: {
          stamina: 16,
          intelligence: 26,
          attack: 36,
          melee: 46,
          defense: 56,
          ranged: 66,
          magic: 76,
        },
        skillExperience: {
          stamina: 1600,
          intelligence: 2600,
          attack: 3600,
          melee: 4600,
          defense: 5600,
          ranged: 6600,
          magic: 7600,
        },
        characterItems: [
          {
            itemLocationHrid: '/item_locations/head',
            itemHrid: headItemHrid,
            enhancementLevel: 3,
          },
          {
            currentItem: {
              itemLocationHrid: '/item_locations/two_hand',
              itemHrid: weaponItemHrid,
              enhancementLevel: 4,
            },
          },
        ],
        combatAbilities: [
          {
            abilityHrid: specialAbilityHrid,
            level: 9,
          },
          {
            abilityHrid,
            level: 7,
          },
        ],
        actionTypeFoodSlotsMap: {
          '/action_types/combat': [foodItemHrid, '', ''],
        },
        actionTypeDrinkSlotsMap: {
          '/action_types/combat': [drinkItemHrid, '', ''],
        },
        consumableCombatTriggersMap: {
          [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
          [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
        },
        abilityCombatTriggersMap: {
          [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
        },
        characterHouseRoomMap: {
          11: {
            houseRoomHrid,
            level: 4,
          },
        },
        characterAchievements: {
          7: {
            achievementHrid: '/achievements/current_fixture',
            isCompleted: true,
          },
        },
      }),
      mainSiteCombat: {
        actionHrid: zoneActionHrid,
        difficultyTier: 2,
      },
    };

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.id).toBe('4');
    expect(result.player.name).toBe('Current Fixture Hero');
    expect(result.player.levels.stamina).toBe(16);
    expect(result.player.skillExperience.magic).toBe(7600);
    expect(result.player.equipment.head.itemHrid).toBe(headItemHrid);
    expect(result.player.equipment.weapon.itemHrid).toBe(weaponItemHrid);
    expect(result.player.food[0]).toBe(foodItemHrid);
    expect(result.player.drinks[0]).toBe(drinkItemHrid);
    expect(result.player.abilities[0]).toEqual({
      abilityHrid: specialAbilityHrid,
      level: 9,
    });
    expect(result.player.abilities[1]).toEqual({
      abilityHrid,
      level: 7,
    });
    expect(result.player.triggerMap[foodItemHrid]).toEqual(
      itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
    );
    expect(result.player.triggerMap[abilityHrid]).toEqual(abilityDetailMap[abilityHrid].defaultCombatTriggers);
    expect(result.player.houseRooms[houseRoomHrid]).toBe(4);
    expect(result.player.achievements['/achievements/current_fixture']).toBe(true);
    expect(result.simulationSettings.zoneHrid).toBe(zoneActionHrid);
    expect(result.simulationSettings.difficultyTier).toBe(2);
  });

  it('preserves main-site current character trinkets for homepage preview data', () => {
    const fallbackPlayer = createEmptyPlayerConfig(12);
    const fixture = createMainSiteCurrentCharacterFixture({
      characterItems: [
        {
          itemLocationHrid: '/item_locations/trinket',
          itemHrid: '/items/expert_task_badge',
          enhancementLevel: 4,
        },
      ],
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.equipment.trinket).toEqual({
      itemHrid: '/items/expert_task_badge',
      enhancementLevel: 4,
    });
  });

  it('clears fallback preview-only trinkets when current-character imports omit them', () => {
    const fallbackPlayer = createEmptyPlayerConfig(12);
    fallbackPlayer.equipment.trinket = {
      itemHrid: '/items/expert_task_badge',
      enhancementLevel: 4,
    };

    const fixture = createMainSiteCurrentCharacterFixture({
      characterItems: [],
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.equipment.trinket).toEqual({
      itemHrid: '',
      enhancementLevel: 0,
    });
  });

  it('imports shareable profile food and drinks from combatConsumables arrays in cached profiles', () => {
    const fallbackPlayer = createEmptyPlayerConfig(11);
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const drinkItemHrid = findFirstDrinkWithDefaultTriggers();

    expect(foodItemHrid).toBeTruthy();
    expect(drinkItemHrid).toBeTruthy();

    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Cached Shareable Consumables Hero',
      foodItemHrids: ['', '', ''],
      drinkItemHrids: ['', '', ''],
    });
    delete fixture.foodItemHrids;
    delete fixture.drinkItemHrids;
    fixture.combatConsumables = [{ itemHrid: foodItemHrid }, { itemHrid: drinkItemHrid }];

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');
    expect(result.player.food[0]).toBe(foodItemHrid);
    expect(result.player.drinks[0]).toBe(drinkItemHrid);
  });

  it('clears fallback triggers when a shareable profile explicitly provides empty trigger maps', () => {
    const fallbackPlayer = createEmptyPlayerConfig(9);
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();

    expect(foodItemHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();

    fallbackPlayer.triggerMap = {
      [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
      [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
    };

    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Explicit Empty Shareable Triggers',
      consumableCombatTriggersMap: {},
      abilityCombatTriggersMap: {},
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');
    expect(result.player.triggerMap).toEqual({});
  });

  it('clears fallback triggers when a current-character payload explicitly provides empty trigger maps', () => {
    const fallbackPlayer = createEmptyPlayerConfig(10);
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();

    expect(foodItemHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();

    fallbackPlayer.triggerMap = {
      [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
      [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
    };

    const fixture = createMainSiteCurrentCharacterFixture({
      characterName: 'Explicit Empty Current Triggers',
      actionTypeFoodSlotsMap: {
        '/action_types/combat': ['', '', ''],
      },
      actionTypeDrinkSlotsMap: {
        '/action_types/combat': ['', '', ''],
      },
      consumableCombatTriggersMap: {},
      abilityCombatTriggersMap: {},
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.triggerMap).toEqual({});
  });

  it('imports partial current-character trigger payloads without falling back to stale triggers', () => {
    const fallbackPlayer = createEmptyPlayerConfig(12);
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();

    expect(foodItemHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();

    fallbackPlayer.triggerMap = {
      [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
      [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
    };

    const fixture = createMainSiteCurrentCharacterFixture({
      characterName: 'Partial Current Trigger Payload',
      actionTypeFoodSlotsMap: {
        '/action_types/combat': [foodItemHrid, '', ''],
      },
      actionTypeDrinkSlotsMap: {
        '/action_types/combat': ['', '', ''],
      },
      consumableCombatTriggersMap: {
        [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
      },
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.triggerMap).toEqual({
      [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
    });
  });

  it('imports main-site share profile payload with zero-based explicit ability slots', () => {
    const fallbackPlayer = createEmptyPlayerConfig(5);
    const standardAbilityHrid = findFirstAbilityWithDefaultTriggers();
    const secondAbilityHrid = findAnotherStandardAbility(standardAbilityHrid);
    const specialAbilityHrid = findFirstSpecialAbility();

    expect(standardAbilityHrid).toBeTruthy();
    expect(secondAbilityHrid).toBeTruthy();
    expect(specialAbilityHrid).toBeTruthy();

    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Zero Based Share Hero',
      equippedAbilities: [
        {
          abilityHrid: specialAbilityHrid,
          level: 11,
          slotIndex: 0,
        },
        {
          abilityHrid: standardAbilityHrid,
          level: 7,
          slotIndex: 1,
        },
        {
          abilityHrid: secondAbilityHrid,
          level: 5,
          slotIndex: 2,
        },
      ],
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');
    expect(result.player.abilities[0]).toEqual({
      abilityHrid: specialAbilityHrid,
      level: 11,
    });
    expect(result.player.abilities[1]).toEqual({
      abilityHrid: standardAbilityHrid,
      level: 7,
    });
    expect(result.player.abilities[2]).toEqual({
      abilityHrid: secondAbilityHrid,
      level: 5,
    });
  });

  it('imports main-site current character payload with zero-based explicit ability slots', () => {
    const fallbackPlayer = createEmptyPlayerConfig(6);
    const standardAbilityHrid = findFirstAbilityWithDefaultTriggers();
    const secondAbilityHrid = findAnotherStandardAbility(standardAbilityHrid);
    const specialAbilityHrid = findFirstSpecialAbility();

    expect(standardAbilityHrid).toBeTruthy();
    expect(secondAbilityHrid).toBeTruthy();
    expect(specialAbilityHrid).toBeTruthy();

    const fixture = createMainSiteCurrentCharacterFixture({
      characterName: 'Zero Based Current Hero',
      combatAbilities: [
        {
          abilityHrid: specialAbilityHrid,
          level: 9,
          slotIndex: 0,
        },
        {
          abilityHrid: standardAbilityHrid,
          level: 6,
          slotIndex: 1,
        },
        {
          abilityHrid: secondAbilityHrid,
          level: 4,
          slotIndex: 2,
        },
      ],
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.abilities[0]).toEqual({
      abilityHrid: specialAbilityHrid,
      level: 9,
    });
    expect(result.player.abilities[1]).toEqual({
      abilityHrid: standardAbilityHrid,
      level: 6,
    });
    expect(result.player.abilities[2]).toEqual({
      abilityHrid: secondAbilityHrid,
      level: 4,
    });
  });

  it('imports main-site share profile payload with zero-based standard ability slots and no explicit special ability', () => {
    const fallbackPlayer = createEmptyPlayerConfig(7);
    const firstAbilityHrid = findFirstAbilityWithDefaultTriggers();
    const secondAbilityHrid = findAnotherStandardAbility(firstAbilityHrid);

    expect(firstAbilityHrid).toBeTruthy();
    expect(secondAbilityHrid).toBeTruthy();

    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Zero Based Standard Share Hero',
      equippedAbilities: [
        {
          abilityHrid: firstAbilityHrid,
          level: 8,
          slotIndex: 0,
        },
        {
          abilityHrid: secondAbilityHrid,
          level: 6,
          slotIndex: 1,
        },
      ],
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');
    expect(result.player.abilities[0]).toEqual({
      abilityHrid: '',
      level: 1,
    });
    expect(result.player.abilities[1]).toEqual({
      abilityHrid: firstAbilityHrid,
      level: 8,
    });
    expect(result.player.abilities[2]).toEqual({
      abilityHrid: secondAbilityHrid,
      level: 6,
    });
  });

  it('imports main-site current character payload with zero-based standard ability slots and no explicit special ability', () => {
    const fallbackPlayer = createEmptyPlayerConfig(8);
    const firstAbilityHrid = findFirstAbilityWithDefaultTriggers();
    const secondAbilityHrid = findAnotherStandardAbility(firstAbilityHrid);

    expect(firstAbilityHrid).toBeTruthy();
    expect(secondAbilityHrid).toBeTruthy();

    const fixture = createMainSiteCurrentCharacterFixture({
      characterName: 'Zero Based Standard Current Hero',
      combatAbilities: [
        {
          abilityHrid: firstAbilityHrid,
          level: 10,
          slotIndex: 0,
        },
        {
          abilityHrid: secondAbilityHrid,
          level: 7,
          slotIndex: 1,
        },
      ],
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.abilities[0]).toEqual({
      abilityHrid: '',
      level: 1,
    });
    expect(result.player.abilities[1]).toEqual({
      abilityHrid: firstAbilityHrid,
      level: 10,
    });
    expect(result.player.abilities[2]).toEqual({
      abilityHrid: secondAbilityHrid,
      level: 7,
    });
  });

  it('imports effective guild buff levels capped by the current guild shrines', () => {
    const fallbackPlayer = createEmptyPlayerConfig(9);
    const purchased = {};
    const buildings = {};

    for (let index = 0; index < combatGuildBuffDetails.length; index++) {
      const detail = combatGuildBuffDetails[index];
      purchased[detail.hrid] = { guildBuffHrid: detail.hrid, level: 10 + index };
      buildings[detail.shrineHrid] = index + 2;
    }

    const fixture = createMainSiteCurrentCharacterFixture({
      characterGuildBuffMap: purchased,
      guildBuildingLevelMap: buildings,
    });
    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    for (let index = 0; index < combatGuildBuffDetails.length; index++) {
      expect(result.player.guildBuffs[combatGuildBuffDetails[index].hrid]).toBe(index + 2);
    }
  });

  it('preserves configured guild buffs when older main-site payloads omit guild fields', () => {
    const fallbackPlayer = createEmptyPlayerConfig(10);
    const guildBuffHrid = combatGuildBuffDetails[0].hrid;
    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;
    const fixture = createMainSiteCurrentCharacterFixture();
    delete fixture.characterGuildBuffMap;
    delete fixture.guildBuildingLevelMap;

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.player.guildBuffs[guildBuffHrid]).toBe(9);
  });

  it('clears effective guild buffs when the new main-site payload reports no guild data', () => {
    const fallbackPlayer = createEmptyPlayerConfig(11);
    const guildBuffHrid = combatGuildBuffDetails[0].hrid;
    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;

    const result = importSoloConfig(
      JSON.stringify(createMainSiteCurrentCharacterFixture()),
      fallbackPlayer,
      createSimulationSettings(),
    );

    expect(result.player.guildBuffs[guildBuffHrid]).toBe(0);
  });

  it('imports effective guild shrine combat buffs from shareable profile guildBuffLevelMap', () => {
    const fallbackPlayer = createEmptyPlayerConfig(12);
    const guildBuffLevelMap = {
      '/guild_buffs/force_combat': 3,
      '/guild_buffs/tempo_combat': 2,
    };
    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Shareable Guild Buff Hero',
      guildBuffLevelMap,
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');

    // 遍历全部战斗增益动态断言（与数据文件解耦）：map 中有的取分享值，缺失的一律归 0。
    for (const guildBuffHrid of combatGuildBuffHrids) {
      expect(result.player.guildBuffs[guildBuffHrid]).toBe(guildBuffLevelMap[guildBuffHrid] ?? 0);
    }

    // 非战斗增益被排除：player.guildBuffs 的键集合应与数据派生的战斗增益列表一致。
    expect(Object.keys(result.player.guildBuffs).sort()).toEqual([...combatGuildBuffHrids].sort());
  });

  it('zeros guild buff levels missing from the shareable guildBuffLevelMap even with a non-zero fallback', () => {
    const fallbackPlayer = createEmptyPlayerConfig(13);
    const preservedHrid = combatGuildBuffHrids[0];
    const overwrittenHrid = combatGuildBuffHrids[1];
    fallbackPlayer.guildBuffs[preservedHrid] = 7;
    fallbackPlayer.guildBuffs[overwrittenHrid] = 5;

    const guildBuffLevelMap = {
      [overwrittenHrid]: 3,
    };
    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Shareable Partial Guild Buff Hero',
      guildBuffLevelMap,
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');

    // map 是权威快照：存在的键取分享值；缺失键一律归 0，即使 fallback 玩家在该键上有非零
    // 手动配置——队友未拥有的增益不应被静默继承为导入者自己的等级（与空 map 清零语义一致）。
    expect(result.player.guildBuffs[overwrittenHrid]).toBe(3);
    expect(result.player.guildBuffs[preservedHrid]).toBe(0);
  });

  it('clears all guild buffs when the shareable guildBuffLevelMap is an empty object', () => {
    const fallbackPlayer = createEmptyPlayerConfig(14);
    const guildBuffHrid = combatGuildBuffHrids[0];
    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;

    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Shareable No Guild Buff Hero',
      guildBuffLevelMap: {},
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');

    // 空 map {} 表示主站明确下发「无任何增益」：全部归 0，而非保留 fallback 手动配置。
    for (const combatGuildBuffHrid of combatGuildBuffHrids) {
      expect(result.player.guildBuffs[combatGuildBuffHrid]).toBe(0);
    }
  });

  it('zeros all combat guild buffs when the shareable map only carries non-combat keys', () => {
    const fallbackPlayer = createEmptyPlayerConfig(17);
    const guildBuffHrid = combatGuildBuffHrids[0];
    fallbackPlayer.guildBuffs[guildBuffHrid] = 9;

    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Shareable Non-Combat Guild Buff Hero',
      guildBuffLevelMap: { '/guild_buffs/force_skilling': 5 },
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');

    // 与空 map {} 同一语义：map 不含任何战斗键 = 未拥有任何战斗增益，全部归 0。
    // 非战斗键（force_skilling）不参与战斗增益导入，也不改变清零结局（历史实现曾在此
    // 场景下把全部战斗增益静默回退到 fallback 手动配置，与空 map 清零结局不一致）。
    for (const combatGuildBuffHrid of combatGuildBuffHrids) {
      expect(result.player.guildBuffs[combatGuildBuffHrid]).toBe(0);
    }
  });

  it('caps shareable guildBuffLevelMap values at the per-buff max level', () => {
    const fallbackPlayer = createEmptyPlayerConfig(15);
    const guildBuffHrid = combatGuildBuffHrids[0];
    const guildBuffLevelMap = {
      [guildBuffHrid]: 99,
    };
    const fixture = createMainSiteShareProfileFixture({
      characterName: 'Shareable Over-Cap Guild Buff Hero',
      guildBuffLevelMap,
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-share-profile');

    // 分享值超过 maxLevel 时按数据文件中的 maxLevel 封顶（normalizeGuildBuffLevels 语义）。
    const maxLevel = getGuildBuffMaxLevel(guildBuffHrid);
    expect(maxLevel).toBeGreaterThan(0);
    expect(result.player.guildBuffs[guildBuffHrid]).toBe(maxLevel);
  });

  it('imports effective guild buffs from guildBuffLevelMap on the current-character path', () => {
    // 防御性覆盖：当前端到端路径（用户脚本 CURRENT_CHARACTER_SNAPSHOT_KEYS）不携带
    // guildBuffLevelMap，当前角色走「已购等级 × 公会神龛等级」计算分支（见
    // scripts/mwi-main-site-import.README.md）。若未来主站直接下发该字段，需同步
    // 加入快照键列表后再启用此路径。
    const fallbackPlayer = createEmptyPlayerConfig(16);
    const guildBuffLevelMap = {
      '/guild_buffs/force_combat': 3,
      '/guild_buffs/tempo_combat': 2,
    };
    const fixture = createMainSiteCurrentCharacterFixture({
      characterName: 'Current Character Guild Buff Hero',
      guildBuffLevelMap,
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');

    // 当前角色路径同样支持 guildBuffLevelMap 直接下发：map 中有的取分享值，缺失的一律归 0。
    for (const guildBuffHrid of combatGuildBuffHrids) {
      expect(result.player.guildBuffs[guildBuffHrid]).toBe(guildBuffLevelMap[guildBuffHrid] ?? 0);
    }
  });

  it('extracts crafting tea slots（非战斗茶槽）separate from combat drinks on the current-character path', () => {
    // 资产分精炼折扣依赖 tailoring 等制作槽的工匠茶；战斗槽必须保持 isolation 进 drinks。
    const fallbackPlayer = createEmptyPlayerConfig(17);
    const fixture = createMainSiteCurrentCharacterFixture({
      characterName: 'Crafting Tea Slots Hero',
      actionTypeDrinkSlotsMap: {
        '/action_types/combat': ['/items/combat_drink_sample', '', ''],
        '/action_types/tailoring': ['/items/artisan_tea', ''],
        '/action_types/forging': ['', '/items/forging_tea_sample'],
      },
    });

    const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.player.drinks[0]).toBe('/items/combat_drink_sample');
    expect(result.player.drinks).toEqual(['/items/combat_drink_sample', '', '']);
    expect(result.player.craftingTeaSlots).toEqual({
      '/action_types/tailoring': ['/items/artisan_tea'],
      '/action_types/forging': ['/items/forging_tea_sample'],
    });
  });

  it('strips the combat action-type key from crafted craftingTeaSlots at the import boundary（防伪造工匠茶折扣）', () => {
    // sanitizeCraftingTeaSlots（导入提取与配置白名单收敛后的单一实现）剔除 /action_types/combat：战斗槽不是制作
    // 茶槽，正常流（主站导出/桥接）不可能产出该键，仅手工构造的导入 JSON 可达。消费端
    // resolveCraftingTeaLessResource 对全部槽值扫 artisan_tea 且不看键类型，战斗键漏进来
    // 会无中生有精炼折扣、装备分偏低——校验边界缺口（2026-08-31 修复）的回归锁定。
    const payload = {
      version: 2,
      player: {
        craftingTeaSlots: {
          '/action_types/combat': ['/items/artisan_tea'],
          '/action_types/tailoring': ['/items/artisan_tea'],
        },
      },
    };

    const result = importSoloConfig(JSON.stringify(payload), createEmptyPlayerConfig(18), createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-solo');
    // 差分对照：同一 artisan_tea 在战斗键下被剔除、在合法非战斗键下保留，
    // 证明剔除是「按键类型」而非「按物品」。
    expect(result.player.craftingTeaSlots).toEqual({
      '/action_types/tailoring': ['/items/artisan_tea'],
    });
  });

  it('rejects craftingTeaSlot keys without the /action_types/ prefix（键白名单：拦伪造键与 __proto__ setter）', () => {
    // 键前缀白名单回归锁定（2026-09-01 收敛单一实现 + 补白名单）：伪键此前会被放行——
    // __proto__ 自有键（JSON.parse 产物）在 result[actionTypeHrid] = items 赋值时触发
    // Object.prototype.__proto__ setter（槽值被吞、result 原型被换成槽值数组）；无前缀
    // 伪键携带 artisan_tea 进入消费端扫描（resolveCraftingTeaLessResource 只看槽值不看
    // 键类型）→ 无中生有精炼折扣。白名单以 /action_types/ 前缀 + 非战斗键收敛，伪键一律剔除。
    const craftingTeaSlots = JSON.parse(`{
      "__proto__": ["/items/artisan_tea"],
      "constructor": ["/items/artisan_tea"],
      "artisan_tea": ["/items/artisan_tea"],
      "/action_types/tailoring": ["/items/artisan_tea"]
    }`);
    const payload = {
      version: 2,
      player: {
        craftingTeaSlots,
      },
    };

    const result = importSoloConfig(JSON.stringify(payload), createEmptyPlayerConfig(19), createSimulationSettings());

    expect(result.detectedFormat).toBe('modern-solo');
    expect(result.player.craftingTeaSlots).toEqual({
      '/action_types/tailoring': ['/items/artisan_tea'],
    });
    // __proto__ 自有键被剔除后不得触发原型 setter：结果对象必须保持普通对象原型。
    expect(Object.getPrototypeOf(result.player.craftingTeaSlots)).toBe(Object.prototype);
  });
});
