import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS, houseRoomHrids } from './gameDataIndex.js';
import { combatGuildBuffHrids, normalizeGuildBuffLevels } from './guildBuffs.js';

export { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS };

export function createEmptySkillExperienceMap() {
  return Object.fromEntries(LEVEL_KEYS.map((key) => [key, null]));
}

export function normalizeHouseRoomLevels(houseRooms) {
  const source = houseRooms && typeof houseRooms === 'object' && !Array.isArray(houseRooms) ? houseRooms : {};

  return Object.fromEntries(
    houseRoomHrids.map((hrid) => {
      const current = Number(source[hrid] ?? 0);
      const level = Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0;
      return [hrid, level];
    }),
  );
}

/**
 * Canonical PlayerConfig objects are dense in memory: every known house room and
 * combat guild buff has a numeric level, while achievements always use a map.
 * Serialization may compact zero-level house rooms, so every Store boundary that
 * accepts an external or saved player must restore this contract.
 */
export function ensurePlayerAdvancedState(player) {
  if (!player || typeof player !== 'object') {
    return null;
  }

  player.houseRooms = normalizeHouseRoomLevels(player.houseRooms);

  if (!player.achievements || typeof player.achievements !== 'object' || Array.isArray(player.achievements)) {
    player.achievements = {};
  }
  player.guildBuffs = normalizeGuildBuffLevels(player.guildBuffs);
  return player;
}

export function createEmptyPlayerConfig(id) {
  const houseRooms = normalizeHouseRoomLevels();
  const guildBuffs = Object.fromEntries(combatGuildBuffHrids.map((hrid) => [hrid, 0]));
  const levels = Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1]));
  const skillExperience = createEmptySkillExperienceMap();
  const equipment = Object.fromEntries(
    EQUIPMENT_SLOT_KEYS.map((slot) => [slot, { itemHrid: '', enhancementLevel: 0 }]),
  );

  return {
    id: String(id),
    name: `Player ${id}`,
    selected: Number(id) === 1,
    levels,
    skillExperience,
    equipment,
    food: ['', '', ''],
    drinks: ['', '', ''],
    abilities: [
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ],
    triggerMap: {},
    // Enabled combat scrolls are keyed by item HRID.  A value of
    // `{ quantity: null }` means unlimited inventory; absent keys are
    // disabled rows.  Keep the map empty by default for legacy configs.
    combatScrolls: {},
    houseRooms,
    guildBuffs,
    achievements: {},
  };
}

export function calcCombatLevel(
  staminaLevel,
  intelligenceLevel,
  defenseLevel,
  attackLevel,
  meleeLevel,
  rangedLevel,
  magicLevel,
) {
  return (
    0.1 *
      (staminaLevel + intelligenceLevel + attackLevel + defenseLevel + Math.max(meleeLevel, rangedLevel, magicLevel)) +
    0.5 * Math.max(attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel)
  );
}
