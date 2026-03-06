export function createMainSiteShareProfileFixture(options = {}) {
    const {
        characterName = "Main Site Hero",
        skills = {},
        wearableItemMap = {},
        equippedAbilities = [],
        foodItemHrids = ["", "", ""],
        drinkItemHrids = ["", "", ""],
        consumableCombatTriggersMap = {},
        abilityCombatTriggersMap = {},
        characterHouseRoomMap = {},
        characterAchievements = [],
    } = options;

    const normalizedSkills = {
        stamina: Number(skills.stamina ?? 1),
        intelligence: Number(skills.intelligence ?? 1),
        attack: Number(skills.attack ?? 1),
        melee: Number(skills.melee ?? 1),
        defense: Number(skills.defense ?? 1),
        ranged: Number(skills.ranged ?? 1),
        magic: Number(skills.magic ?? 1),
    };

    const totalLevel = Object.values(normalizedSkills).reduce((sum, value) => sum + Math.max(1, Math.floor(Number(value || 1))), 0);

    return {
        sharableCharacter: {
            name: characterName,
            gameMode: "/game_modes/standard",
            createdAt: "2026-01-01T00:00:00.000Z",
            avatarHrid: "",
            avatarOutfitHrid: "",
            hasMooPass: false,
            isOnline: true,
            hideOnlineStatus: false,
        },
        characterSkills: [
            { skillHrid: "/skills/stamina", level: normalizedSkills.stamina, experience: 0 },
            { skillHrid: "/skills/intelligence", level: normalizedSkills.intelligence, experience: 0 },
            { skillHrid: "/skills/attack", level: normalizedSkills.attack, experience: 0 },
            { skillHrid: "/skills/melee", level: normalizedSkills.melee, experience: 0 },
            { skillHrid: "/skills/defense", level: normalizedSkills.defense, experience: 0 },
            { skillHrid: "/skills/ranged", level: normalizedSkills.ranged, experience: 0 },
            { skillHrid: "/skills/magic", level: normalizedSkills.magic, experience: 0 },
            { skillHrid: "/skills/total_level", level: totalLevel, experience: 0 },
        ],
        wearableItemMap,
        equippedAbilities,
        foodItemHrids: [...foodItemHrids],
        drinkItemHrids: [...drinkItemHrids],
        consumableCombatTriggersMap: { ...consumableCombatTriggersMap },
        abilityCombatTriggersMap: { ...abilityCombatTriggersMap },
        characterHouseRoomMap: { ...characterHouseRoomMap },
        characterAchievements: [...characterAchievements],
    };
}
