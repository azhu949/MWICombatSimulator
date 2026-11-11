import { describe, it, expect, vi } from 'vitest';
import { importSoloConfig } from '../importExportMapper.js';
import { createEmptyPlayerConfig } from '../playerMapper.js';
import { applyTampermonkeyImportMessage } from '../tampermonkeyImportBridge.js';
import sample from './fixtures/blackSheep3ViewLoadout.json';
import { createMainSiteCurrentCharacterFixture } from './fixtures/mainSiteShareProfileFixture.js';
const clone = (x) => JSON.parse(JSON.stringify(x));
const run = (profile, fallback = createEmptyPlayerConfig(1)) => importSoloConfig(JSON.stringify(profile), fallback, {});
function personal() {
  const profile = clone(sample);
  delete profile.combatConsumables;
  return {
    ...profile,
    foodItemHrids: sample.combatConsumables.slice(0, 3).map((x) => x.itemHrid),
    drinkItemHrids: sample.combatConsumables.slice(3).map((x) => x.itemHrid),
    characterHouseRoomMap: { '/house_rooms/archery_range': { houseRoomHrid: '/house_rooms/archery_range', level: 3 } },
    guildBuffLevelMap: { '/guild_buffs/force_combat': 3, '/guild_buffs/spirit_combat': 4 },
  };
}
function overlay() {
  const data = clone(sample);
  data.wearableItemMap['/item_locations/head'].enhancementLevel = 9;
  data.equippedAbilities = [data.equippedAbilities[0]];
  data.combatConsumables = [{ itemHrid: '/items/wisdom_coffee' }];
  data.abilityCombatTriggersMap = { '/abilities/fierce_aura': [] };
  data.consumableCombatTriggersMap = { '/items/wisdom_coffee': [] };
  delete data.guildBuffLevelMap;
  delete data.characterHouseRoomMap;
  return data;
}
describe('atomic personal profile plus current loadout import', () => {
  it('imports the supplied BlackSheep3 copied combat projection exactly', () => {
    const { player } = run(sample);
    expect(player.equipment.weapon).toEqual({ itemHrid: '/items/soul_hunter_crossbow', enhancementLevel: 5 });
    expect(player.equipment.off_hand.itemHrid).toBe('/items/manticore_shield');
    expect(player.abilities.filter((x) => x.abilityHrid).map((x) => [x.abilityHrid, x.level])).toEqual(
      sample.equippedAbilities.map((x) => [x.abilityHrid, x.level]),
    );
    expect(player.food).toEqual(['/items/spaceberry_cake', '/items/plum_gummy', '/items/star_fruit_yogurt']);
    expect(player.drinks).toEqual(['/items/super_ranged_coffee', '/items/swiftness_coffee', '/items/wisdom_coffee']);
    expect(player.triggerMap).toEqual({ ...sample.abilityCombatTriggersMap, ...sample.consumableCombatTriggersMap });
  });
  it('prioritizes explicit current loadout even when the personal profile has all combat fields', () => {
    const profile = clone(sample);
    profile.currentCombatLoadout = overlay(); // full root profile must not hide the explicit loadout
    const result = run(profile);
    expect(result.combatConfigSource).toBe('currentCombatLoadout');
    expect(result.player.equipment.head.enhancementLevel).toBe(9);
    expect(result.player.abilities.filter((x) => x.abilityHrid)).toHaveLength(1);
    expect(result.player.houseRooms['/house_rooms/dining_room']).toBe(6);
    expect(result.player.houseRooms['/house_rooms/laboratory']).toBe(5);
    expect(result.player.guildBuffs['/guild_buffs/force_combat']).toBe(3);
    expect(result.player.guildBuffs['/guild_buffs/spirit_combat']).toBe(4);
    expect(result.player.achievements['/achievements/total_level_1500']).toBe(true);
    expect(result.player.achievements['/achievements/total_level_1800']).not.toBe(true);
  });
  it('overlays the entire current build while retaining personal housing and shrines', () => {
    const profile = personal();
    const base = run(profile).player;
    profile.currentCombatLoadout = overlay();
    const { player, combatConfigSource } = run(profile);
    expect(combatConfigSource).toBe('currentCombatLoadout');
    expect(player.equipment.head.enhancementLevel).toBe(9);
    expect(player.abilities.filter((x) => x.abilityHrid)).toHaveLength(1);
    expect(player.food).toEqual(['', '', '']);
    expect(player.drinks).toEqual(['/items/wisdom_coffee', '', '']);
    expect(player.triggerMap).toEqual({ '/abilities/fierce_aura': [], '/items/wisdom_coffee': [] });
    expect(player.houseRooms).toEqual(base.houseRooms);
    expect(player.guildBuffs).toEqual(base.guildBuffs);
  });
  it.each([undefined, null, {}])('uses personal profile unchanged for empty current loadout %j', (current) => {
    const profile = personal();
    const baseline = run(profile).player;
    profile.currentCombatLoadout = current;
    expect(run(profile).player).toEqual(baseline);
  });
  it('empty current loadout does not fall through to another saved/current alias', () => {
    const profile = personal();
    const expected = run(profile).player;
    profile.currentCombatLoadout = {};
    profile.combatLoadout = overlay();
    expect(run(profile).player).toEqual(expected);
  });
  it('explicitly empty slots in a complete current loadout clear old combat fields', () => {
    const profile = personal();
    profile.currentCombatLoadout = {
      wearableItemMap: {},
      equippedAbilities: [],
      foodItemHrids: [],
      drinkItemHrids: [],
      abilityCombatTriggersMap: {},
      consumableCombatTriggersMap: {},
    };
    const { player } = run(profile);
    expect(Object.values(player.equipment).every((x) => !x.itemHrid)).toBe(true);
    expect(player.abilities.every((x) => !x.abilityHrid)).toBe(true);
    expect(player.food.every((x) => !x)).toBe(true);
    expect(player.drinks.every((x) => !x)).toBe(true);
    expect(player.triggerMap).toEqual({});
  });
  it('does not guess an active loadout from saved loadout maps', () => {
    const profile = personal();
    const expected = run(profile).player;
    profile.characterLoadoutMap = {
      unrelated: { ...overlay(), name: 'Not active', isDefault: true, actionTypeHrid: '/action_types/combat' },
    };
    const actual = run(profile).player;
    for (const key of ['equipment', 'abilities', 'food', 'drinks', 'triggerMap'])
      expect(actual[key]).toEqual(expected[key]);
  });
  it('does not borrow a wrapper consumable/trigger override', () => {
    const profile = personal();
    const expected = run(profile).player;
    const actual = run({
      profile,
      mainSiteConsumables: {
        foodItemHrids: ['/items/apple'],
        drinkItemHrids: ['/items/milk'],
        abilityCombatTriggersMap: { '/abilities/berserk': [] },
      },
    }).player;
    for (const key of ['equipment', 'abilities', 'food', 'drinks', 'triggerMap'])
      expect(actual[key]).toEqual(expected[key]);
  });
  it.each([
    'wearableItemMap',
    'equippedAbilities',
    'combatConsumables',
    'abilityCombatTriggersMap',
    'consumableCombatTriggersMap',
  ])('rejects an incomplete current loadout missing %s rather than filling from personal or simulator', (field) => {
    const profile = personal();
    profile.currentCombatLoadout = overlay();
    delete profile.currentCombatLoadout[field];
    const fallback = run(sample).player;
    const before = clone(fallback);
    expect(() => run(profile, fallback)).toThrow('导入配置不完整');
    expect(fallback).toEqual(before);
  });
  it('rejects missing current-character trigger snapshots instead of reusing previous triggers', () => {
    const fixture = createMainSiteCurrentCharacterFixture();
    delete fixture.abilityCombatTriggersMap;
    const fallback = run(sample).player;
    expect(() => run(fixture, fallback)).toThrow('技能 trigger');
  });
  it('supports hash-based complete loadout with character-level skill levels', () => {
    const profile = personal();
    profile.currentCombatLoadout = {
      wearableMap: { '/item_locations/head': '369965::/item_locations/head::/items/fluffy_red_hat::8' },
      abilityMap: { 1: '/abilities/berserk' },
      foodItemHrids: [],
      drinkItemHrids: ['/items/wisdom_coffee'],
      abilityCombatTriggersMap: {},
      consumableCombatTriggersMap: {},
    };
    const player = run(profile).player;
    expect(player.equipment.head.enhancementLevel).toBe(8);
    expect(player.abilities.find((x) => x.abilityHrid === '/abilities/berserk').level).toBe(44);
    expect(player.drinks[0]).toBe('/items/wisdom_coffee');
  });
  it('rejects before clearing other players or changing team selection', async () => {
    const player = run(sample).player;
    player.selected = true;
    const simulator = {
      players: [player],
      activePlayerId: '1',
      clearOtherPlayersForSoloImport: vi.fn(),
      clearPlayerSlots: vi.fn(),
      setActivePlayer: vi.fn(),
      importSoloConfig: vi.fn(async (text) => importSoloConfig(text, player, {})),
    };
    const invalid = personal();
    delete invalid.consumableCombatTriggersMap;
    await expect(
      applyTampermonkeyImportMessage(simulator, {
        payload: invalid,
        clearOtherPlayers: true,
        resetTeamSelection: true,
      }),
    ).rejects.toThrow('导入配置不完整');
    expect(simulator.clearOtherPlayersForSoloImport).not.toHaveBeenCalled();
    expect(player.selected).toBe(true);
  });
});
