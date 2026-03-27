import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS, houseRoomHrids } from "./gameDataIndex.js";

export { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS };

export function createEmptySkillExperienceMap() {
    return Object.fromEntries(LEVEL_KEYS.map((key) => [key, null]));
}

export function createEmptyPlayerConfig(id) {
    const houseRooms = Object.fromEntries(houseRoomHrids.map((hrid) => [hrid, 0]));
    const levels = Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1]));
    const skillExperience = createEmptySkillExperienceMap();
    const equipment = Object.fromEntries(EQUIPMENT_SLOT_KEYS.map((slot) => [slot, { itemHrid: "", enhancementLevel: 0 }]));

    return {
        id: String(id),
        name: `Player ${id}`,
        selected: Number(id) === 1,
        levels,
        skillExperience,
        equipment,
        food: ["", "", ""],
        drinks: ["", "", ""],
        abilities: [
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ],
        triggerMap: {},
        houseRooms,
        achievements: {},
    };
}

export function calcCombatLevel(staminaLevel, intelligenceLevel, defenseLevel, attackLevel, meleeLevel, rangedLevel, magicLevel) {
    return (
        0.1 * (staminaLevel + intelligenceLevel + attackLevel + defenseLevel + Math.max(meleeLevel, rangedLevel, magicLevel)) +
        0.5 * Math.max(attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel)
    );
}
