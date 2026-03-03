import Ability from "../combatsimulator/ability.js";
import Consumable from "../combatsimulator/consumable.js";
import Equipment from "../combatsimulator/equipment.js";
import Player from "../combatsimulator/player.js";
import abilitySlotsLevelRequirementList from "../combatsimulator/data/abilitySlotsLevelRequirementList.json";
import houseRoomDetailMap from "../combatsimulator/data/houseRoomDetailMap.json";
import itemDetailMap from "../combatsimulator/data/itemDetailMap.json";
import { sanitizeTriggerMap, toTriggerInstances } from "./triggerMapper.js";

const LEVEL_KEYS = ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"];
const EQUIPMENT_SLOT_KEYS = ["head", "body", "legs", "feet", "hands", "weapon", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"];

export function createEmptyPlayerConfig(id) {
    const houseRooms = {};
    Object.keys(houseRoomDetailMap).forEach((hrid) => {
        houseRooms[hrid] = 0;
    });

    const levels = Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1]));
    const equipment = Object.fromEntries(EQUIPMENT_SLOT_KEYS.map((slot) => [slot, { itemHrid: "", enhancementLevel: 0 }]));

    return {
        id: String(id),
        name: `Player ${id}`,
        selected: Number(id) === 1,
        levels,
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

function mapWeaponType(itemHrid) {
    const item = itemDetailMap[itemHrid];
    if (!item?.equipmentDetail?.type) {
        return "";
    }

    const type = String(item.equipmentDetail.type);
    if (type === "/equipment_types/main_hand" || type === "/equipment_types/two_hand") {
        return type;
    }

    return "";
}

function normalizeEnhancementLevel(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }

    return Math.floor(parsed);
}

export function calcCombatLevel(staminaLevel, intelligenceLevel, defenseLevel, attackLevel, meleeLevel, rangedLevel, magicLevel) {
    return (
        0.1 * (staminaLevel + intelligenceLevel + attackLevel + defenseLevel + Math.max(meleeLevel, rangedLevel, magicLevel)) +
        0.5 * Math.max(attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel)
    );
}

function applyDebuffOnLevelGap(playersToSim) {
    let maxPlayerCombatLevel = 1;
    for (const currentPlayer of playersToSim) {
        currentPlayer.combatLevel = calcCombatLevel(
            currentPlayer.staminaLevel,
            currentPlayer.intelligenceLevel,
            currentPlayer.defenseLevel,
            currentPlayer.attackLevel,
            currentPlayer.meleeLevel,
            currentPlayer.rangedLevel,
            currentPlayer.magicLevel
        );
        maxPlayerCombatLevel = Math.max(maxPlayerCombatLevel, currentPlayer.combatLevel);
    }

    for (const currentPlayer of playersToSim) {
        if (maxPlayerCombatLevel / currentPlayer.combatLevel > 1.2) {
            const maxDebuffOnLevelGap = 0.9;
            const levelPercent = maxPlayerCombatLevel / currentPlayer.combatLevel - 1.2;
            currentPlayer.debuffOnLevelGap = -1 * Math.min(maxDebuffOnLevelGap, 3 * levelPercent);
        } else {
            currentPlayer.debuffOnLevelGap = 0;
        }
    }
}

function buildSimulationPlayerFromConfig(playerConfig) {
    const levels = playerConfig.levels ?? {};
    const triggerMap = sanitizeTriggerMap(playerConfig.triggerMap ?? {});

    const playerData = {
        hrid: `player${playerConfig.id}`,
        staminaLevel: Number(levels.stamina ?? 1),
        intelligenceLevel: Number(levels.intelligence ?? 1),
        attackLevel: Number(levels.attack ?? 1),
        meleeLevel: Number(levels.melee ?? 1),
        defenseLevel: Number(levels.defense ?? 1),
        rangedLevel: Number(levels.ranged ?? 1),
        magicLevel: Number(levels.magic ?? 1),
        equipment: {},
        food: [null, null, null],
        drinks: [null, null, null],
        abilities: [null, null, null, null, null],
        houseRooms: playerConfig.houseRooms ?? {},
        achievements: playerConfig.achievements ?? {},
        debuffOnLevelGap: 0,
    };

    for (const [slot, setting] of Object.entries(playerConfig.equipment ?? {})) {
        const itemHrid = setting?.itemHrid || "";
        if (!itemHrid) {
            continue;
        }

        const enhancementLevel = normalizeEnhancementLevel(setting?.enhancementLevel ?? 0);
        if (slot === "weapon") {
            const weaponType = mapWeaponType(itemHrid);
            if (!weaponType) {
                continue;
            }
            playerData.equipment[weaponType] = new Equipment(itemHrid, enhancementLevel);
            continue;
        }

        const equipmentType = `/equipment_types/${slot}`;
        playerData.equipment[equipmentType] = new Equipment(itemHrid, enhancementLevel);
    }

    const simulationPlayer = Player.createFromDTO(playerData);
    simulationPlayer.updateCombatDetails();

    for (let i = 0; i < 3; i++) {
        const foodHrid = playerConfig.food?.[i] || "";
        if (foodHrid && i < simulationPlayer.combatDetails.combatStats.foodSlots) {
            const customFoodTriggers = Object.prototype.hasOwnProperty.call(triggerMap, foodHrid)
                ? toTriggerInstances(triggerMap[foodHrid])
                : null;
            simulationPlayer.food[i] = new Consumable(foodHrid, customFoodTriggers);
        } else {
            simulationPlayer.food[i] = null;
        }

        const drinkHrid = playerConfig.drinks?.[i] || "";
        if (drinkHrid && i < simulationPlayer.combatDetails.combatStats.drinkSlots) {
            const customDrinkTriggers = Object.prototype.hasOwnProperty.call(triggerMap, drinkHrid)
                ? toTriggerInstances(triggerMap[drinkHrid])
                : null;
            simulationPlayer.drinks[i] = new Consumable(drinkHrid, customDrinkTriggers);
        } else {
            simulationPlayer.drinks[i] = null;
        }
    }

    for (let i = 0; i < 5; i++) {
        const ability = playerConfig.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const abilityHrid = ability.abilityHrid || "";
        const abilityLevel = Number(ability.level ?? 1);

        if (
            abilityHrid
            && Number.isFinite(abilityLevel)
            && abilityLevel > 0
            && simulationPlayer.intelligenceLevel >= abilitySlotsLevelRequirementList[i + 1]
        ) {
            const customAbilityTriggers = Object.prototype.hasOwnProperty.call(triggerMap, abilityHrid)
                ? toTriggerInstances(triggerMap[abilityHrid])
                : null;
            simulationPlayer.abilities[i] = new Ability(abilityHrid, abilityLevel, customAbilityTriggers);
        } else {
            simulationPlayer.abilities[i] = null;
        }
    }

    return simulationPlayer;
}

export function buildPlayersForSimulation(playerConfigs) {
    const selectedPlayers = (playerConfigs ?? []).filter((player) => player.selected);
    const simulationPlayers = selectedPlayers.map((player) => buildSimulationPlayerFromConfig(player));

    applyDebuffOnLevelGap(simulationPlayers);

    return simulationPlayers;
}

export { LEVEL_KEYS, EQUIPMENT_SLOT_KEYS };
