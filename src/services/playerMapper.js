import Ability from "../combatsimulator/ability.js";
import CombatUtilities from "../combatsimulator/combatUtilities.js";
import CombatSimulator from "../combatsimulator/combatSimulator.js";
import Consumable from "../combatsimulator/consumable.js";
import Equipment from "../combatsimulator/equipment.js";
import Labyrinth from "../combatsimulator/labyrinth.js";
import Monster from "../combatsimulator/monster.js";
import Player from "../combatsimulator/player.js";
import Zone from "../combatsimulator/zone.js";
import abilitySlotsLevelRequirementList from "../combatsimulator/data/abilitySlotsLevelRequirementList.json";
import combatMonsterDetailMap from "../combatsimulator/data/combatMonsterDetailMap.json";
import { abilityDetailIndex, itemDetailIndex } from "../shared/gameDataIndex.js";
import {
    calcCombatLevel,
    createEmptyPlayerConfig,
    createEmptySkillExperienceMap,
    EQUIPMENT_SLOT_KEYS,
    LEVEL_KEYS,
} from "../shared/playerConfig.js";
import { buildSimulationExtraBuffs, normalizeSimulationExtra } from "../shared/simulationExtraBuffs.js";
import { getEffectiveTriggerState, sanitizeTriggerMap, toTriggerInstances } from "./triggerMapper.js";

const ONE_SECOND = 1e9;
const COMBAT_PREVIEW_EPSILON = 1e-9;
const COMBAT_PREVIEW_ENEMY_HRID = Object.keys(combatMonsterDetailMap || {})[0] || "";
const COMBAT_PREVIEW_STAT_SPECS = [
    {
        key: "maxHitpoints",
        labelKey: "common:vue.home.combatStats.maxHp",
        fallbackLabel: "Max HP",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.maxHitpoints || 0),
    },
    {
        key: "maxManapoints",
        labelKey: "common:vue.home.combatStats.maxMp",
        fallbackLabel: "Max MP",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.maxManapoints || 0),
    },
    {
        key: "attackIntervalSeconds",
        labelKey: "common:vue.home.combatStats.attackInterval",
        fallbackLabel: "Attack Interval",
        format: "seconds",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.attackInterval || 0) / ONE_SECOND,
    },
    {
        key: "stabAccuracyRating",
        labelKey: "common:vue.home.combatStats.stabAccuracy",
        fallbackLabel: "Stab Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.stabAccuracyRating || 0),
    },
    {
        key: "stabMaxDamage",
        labelKey: "common:vue.home.combatStats.stabDamage",
        fallbackLabel: "Stab Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.stabMaxDamage || 0),
    },
    {
        key: "slashAccuracyRating",
        labelKey: "common:vue.home.combatStats.slashAccuracy",
        fallbackLabel: "Slash Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.slashAccuracyRating || 0),
    },
    {
        key: "slashMaxDamage",
        labelKey: "common:vue.home.combatStats.slashDamage",
        fallbackLabel: "Slash Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.slashMaxDamage || 0),
    },
    {
        key: "smashAccuracyRating",
        labelKey: "common:vue.home.combatStats.smashAccuracy",
        fallbackLabel: "Smash Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.smashAccuracyRating || 0),
    },
    {
        key: "smashMaxDamage",
        labelKey: "common:vue.home.combatStats.smashDamage",
        fallbackLabel: "Smash Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.smashMaxDamage || 0),
    },
    {
        key: "defensiveMaxDamage",
        labelKey: "common:vue.home.combatStats.defensiveDamage",
        fallbackLabel: "Defensive Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.defensiveMaxDamage || 0),
    },
    {
        key: "rangedAccuracyRating",
        labelKey: "common:vue.home.combatStats.rangedAccuracy",
        fallbackLabel: "Ranged Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.rangedAccuracyRating || 0),
    },
    {
        key: "rangedMaxDamage",
        labelKey: "common:vue.home.combatStats.rangedDamage",
        fallbackLabel: "Ranged Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.rangedMaxDamage || 0),
    },
    {
        key: "magicAccuracyRating",
        labelKey: "common:vue.home.combatStats.magicAccuracy",
        fallbackLabel: "Magic Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.magicAccuracyRating || 0),
    },
    {
        key: "magicMaxDamage",
        labelKey: "common:vue.home.combatStats.magicDamage",
        fallbackLabel: "Magic Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.magicMaxDamage || 0),
    },
    {
        key: "averageEvasion",
        labelKey: "common:vue.home.combatStats.evasion",
        fallbackLabel: "Evasion",
        format: "int",
        getValue: (player) => {
            const evasionValues = [
                Number(player?.combatDetails?.stabEvasionRating || 0),
                Number(player?.combatDetails?.slashEvasionRating || 0),
                Number(player?.combatDetails?.smashEvasionRating || 0),
                Number(player?.combatDetails?.rangedEvasionRating || 0),
                Number(player?.combatDetails?.magicEvasionRating || 0),
            ].filter((value) => Number.isFinite(value));
            if (evasionValues.length <= 0) {
                return 0;
            }
            return evasionValues.reduce((sum, value) => sum + value, 0) / evasionValues.length;
        },
    },
    {
        key: "stabEvasionRating",
        labelKey: "common:vue.home.combatStats.stabEvasion",
        fallbackLabel: "Stab Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.stabEvasionRating || 0),
    },
    {
        key: "slashEvasionRating",
        labelKey: "common:vue.home.combatStats.slashEvasion",
        fallbackLabel: "Slash Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.slashEvasionRating || 0),
    },
    {
        key: "smashEvasionRating",
        labelKey: "common:vue.home.combatStats.smashEvasion",
        fallbackLabel: "Smash Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.smashEvasionRating || 0),
    },
    {
        key: "rangedEvasionRating",
        labelKey: "common:vue.home.combatStats.rangedEvasion",
        fallbackLabel: "Ranged Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.rangedEvasionRating || 0),
    },
    {
        key: "magicEvasionRating",
        labelKey: "common:vue.home.combatStats.magicEvasion",
        fallbackLabel: "Magic Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.magicEvasionRating || 0),
    },
    {
        key: "totalArmor",
        labelKey: "common:vue.home.combatStats.armor",
        fallbackLabel: "Armor",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalArmor || 0),
    },
    {
        key: "totalWaterResistance",
        labelKey: "common:vue.home.combatStats.waterResistance",
        fallbackLabel: "Water Resistance",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalWaterResistance || 0),
    },
    {
        key: "totalNatureResistance",
        labelKey: "common:vue.home.combatStats.natureResistance",
        fallbackLabel: "Nature Resistance",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalNatureResistance || 0),
    },
    {
        key: "totalFireResistance",
        labelKey: "common:vue.home.combatStats.fireResistance",
        fallbackLabel: "Fire Resistance",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalFireResistance || 0),
    },
    {
        key: "criticalRate",
        labelKey: "common:vue.home.combatStats.criticalRate",
        fallbackLabel: "Critical Rate",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.criticalRate || 0),
    },
    {
        key: "armorPenetration",
        labelKey: "common:vue.home.combatStats.armorPenetration",
        fallbackLabel: "Armor Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.armorPenetration || 0),
    },
    {
        key: "physicalAmplify",
        labelKey: "common:vue.home.combatStats.physicalAmplify",
        fallbackLabel: "Physical Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.physicalAmplify || 0),
    },
    {
        key: "waterAmplify",
        labelKey: "common:vue.home.combatStats.waterAmplify",
        fallbackLabel: "Water Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.waterAmplify || 0),
    },
    {
        key: "natureAmplify",
        labelKey: "common:vue.home.combatStats.natureAmplify",
        fallbackLabel: "Nature Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.natureAmplify || 0),
    },
    {
        key: "fireAmplify",
        labelKey: "common:vue.home.combatStats.fireAmplify",
        fallbackLabel: "Fire Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.fireAmplify || 0),
    },
    {
        key: "healingAmplify",
        labelKey: "common:vue.home.combatStats.healingAmplify",
        fallbackLabel: "Healing Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.healingAmplify || 0),
    },
    {
        key: "lifeSteal",
        labelKey: "common:vue.home.combatStats.lifeSteal",
        fallbackLabel: "Life Steal",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.lifeSteal || 0),
    },
    {
        key: "physicalThorns",
        labelKey: "common:vue.home.combatStats.physicalThorns",
        fallbackLabel: "Physical Thorns",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.physicalThorns || 0),
    },
    {
        key: "elementalThorns",
        labelKey: "common:vue.home.combatStats.elementalThorns",
        fallbackLabel: "Elemental Thorns",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.elementalThorns || 0),
    },
    {
        key: "retaliation",
        labelKey: "common:vue.home.combatStats.retaliation",
        fallbackLabel: "Retaliation",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.retaliation || 0),
    },
    {
        key: "hpRegenPer10",
        labelKey: "common:vue.home.combatStats.hpRegen",
        fallbackLabel: "HP Regen",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.hpRegenPer10 || 0),
    },
    {
        key: "mpRegenPer10",
        labelKey: "common:vue.home.combatStats.mpRegen",
        fallbackLabel: "MP Regen",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.mpRegenPer10 || 0),
    },
    {
        key: "criticalDamage",
        labelKey: "common:vue.home.combatStats.criticalDamage",
        fallbackLabel: "Critical Damage Bonus",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.criticalDamage || 0),
    },
    {
        key: "taskDamage",
        labelKey: "common:vue.home.combatStats.taskDamage",
        fallbackLabel: "Task Damage Bonus",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.taskDamage || 0),
    },
    {
        key: "waterPenetration",
        labelKey: "common:vue.home.combatStats.waterPenetration",
        fallbackLabel: "Water Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.waterPenetration || 0),
    },
    {
        key: "naturePenetration",
        labelKey: "common:vue.home.combatStats.naturePenetration",
        fallbackLabel: "Nature Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.naturePenetration || 0),
    },
    {
        key: "firePenetration",
        labelKey: "common:vue.home.combatStats.firePenetration",
        fallbackLabel: "Fire Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.firePenetration || 0),
    },
    {
        key: "abilityHaste",
        labelKey: "common:vue.home.combatStats.abilityHaste",
        fallbackLabel: "Ability Haste",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.abilityHaste || 0),
    },
    {
        key: "tenacity",
        labelKey: "common:vue.home.combatStats.tenacity",
        fallbackLabel: "Tenacity",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.tenacity || 0),
    },
    {
        key: "manaLeech",
        labelKey: "common:vue.home.combatStats.manaLeech",
        fallbackLabel: "Mana Leech",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.manaLeech || 0),
    },
    {
        key: "castSpeed",
        labelKey: "common:vue.home.combatStats.castSpeed",
        fallbackLabel: "Cast Speed",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.castSpeed || 0),
    },
    {
        key: "totalThreat",
        labelKey: "common:vue.home.combatStats.threat",
        fallbackLabel: "Threat",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.threat || 0),
    },
    {
        key: "parry",
        labelKey: "common:vue.home.combatStats.parry",
        fallbackLabel: "Parry",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.parry || 0),
    },
    {
        key: "mayhem",
        labelKey: "common:vue.home.combatStats.mayhem",
        fallbackLabel: "Mayhem",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.mayhem || 0),
    },
    {
        key: "pierce",
        labelKey: "common:vue.home.combatStats.pierce",
        fallbackLabel: "Pierce",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.pierce || 0),
    },
    {
        key: "curse",
        labelKey: "common:vue.home.combatStats.curse",
        fallbackLabel: "Curse",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.curse || 0),
    },
    {
        key: "fury",
        labelKey: "common:vue.home.combatStats.fury",
        fallbackLabel: "Fury",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.fury || 0),
    },
    {
        key: "weaken",
        labelKey: "common:vue.home.combatStats.weaken",
        fallbackLabel: "Weaken",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.weaken || 0),
    },
    {
        key: "ripple",
        labelKey: "common:vue.home.combatStats.ripple",
        fallbackLabel: "Ripple",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.ripple || 0),
    },
    {
        key: "bloom",
        labelKey: "common:vue.home.combatStats.bloom",
        fallbackLabel: "Bloom",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.bloom || 0),
    },
    {
        key: "blaze",
        labelKey: "common:vue.home.combatStats.blaze",
        fallbackLabel: "Blaze",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.blaze || 0),
    },
    {
        key: "attackSpeed",
        labelKey: "common:vue.home.combatStats.attackSpeed",
        fallbackLabel: "Attack Speed",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.attackSpeed || 0),
    },
    {
        key: "autoAttackDamage",
        labelKey: "common:vue.home.combatStats.autoAttackDamage",
        fallbackLabel: "Auto Attack Damage",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.autoAttackDamage || 0),
    },
    {
        key: "abilityDamage",
        labelKey: "common:vue.home.combatStats.abilityDamage",
        fallbackLabel: "Ability Damage",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.abilityDamage || 0),
    },
    {
        key: "combatDropRate",
        labelKey: "common:vue.home.combatStats.combatDropRate",
        fallbackLabel: "Drop Rate",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatDropRate || 0),
    },
    {
        key: "combatRareFind",
        labelKey: "common:vue.home.combatStats.combatRareFind",
        fallbackLabel: "Rare Find",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatRareFind || 0),
    },
    {
        key: "combatDropQuantity",
        labelKey: "common:vue.home.combatStats.combatDropQuantity",
        fallbackLabel: "Drop Quantity",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatDropQuantity || 0),
    },
    {
        key: "combatExperience",
        labelKey: "common:vue.home.combatStats.combatExperience",
        fallbackLabel: "Experience Rate",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatExperience || 0),
    },
    {
        key: "staminaExperience",
        labelKey: "common:vue.home.combatStats.staminaExperience",
        fallbackLabel: "Stamina Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.staminaExperience || 0),
    },
    {
        key: "intelligenceExperience",
        labelKey: "common:vue.home.combatStats.intelligenceExperience",
        fallbackLabel: "Intelligence Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.intelligenceExperience || 0),
    },
    {
        key: "attackExperience",
        labelKey: "common:vue.home.combatStats.attackExperience",
        fallbackLabel: "Attack Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.attackExperience || 0),
    },
    {
        key: "defenseExperience",
        labelKey: "common:vue.home.combatStats.defenseExperience",
        fallbackLabel: "Defense Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.defenseExperience || 0),
    },
    {
        key: "meleeExperience",
        labelKey: "common:vue.home.combatStats.meleeExperience",
        fallbackLabel: "Melee Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.meleeExperience || 0),
    },
    {
        key: "rangedExperience",
        labelKey: "common:vue.home.combatStats.rangedExperience",
        fallbackLabel: "Ranged Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.rangedExperience || 0),
    },
    {
        key: "magicExperience",
        labelKey: "common:vue.home.combatStats.magicExperience",
        fallbackLabel: "Magic Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.magicExperience || 0),
    },
];

function mapWeaponType(itemHrid) {
    const equipmentType = String(itemDetailIndex?.[itemHrid]?.equipmentType || "");
    if (!equipmentType) {
        return "";
    }

    if (equipmentType === "/equipment_types/main_hand" || equipmentType === "/equipment_types/two_hand") {
        return equipmentType;
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

        if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
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

function cloneCombatPreviewBuffs(buffs) {
    return Array.isArray(buffs) ? structuredClone(buffs) : [];
}

function normalizePreviewPlayer(player, previewExtra = null, previewEnvironment = null) {
    if (!player) {
        return null;
    }

    // Match the player's state at the start of combat without changing simulation entry semantics.
    player.zoneBuffs = previewEnvironment
        ? cloneCombatPreviewBuffs(previewEnvironment.zoneBuffs)
        : cloneCombatPreviewBuffs(player.zoneBuffs);
    const existingExtraBuffs = Array.isArray(player.extraBuffs) ? player.extraBuffs : [];
    const previewExtraBuffs = buildSimulationExtraBuffs(previewExtra);
    player.extraBuffs = [...existingExtraBuffs, ...previewExtraBuffs];
    player.generatePermanentBuffs();
    player.reset(0);

    return player;
}

function buildSingleCombatPreviewPlayer(playerConfig, previewExtra = null, previewEnvironment = null) {
    if (!playerConfig) {
        return null;
    }

    const previewConfig = {
        ...playerConfig,
        selected: true,
    };

    const [player] = buildPlayersForSimulation([previewConfig]);
    return normalizePreviewPlayer(player, previewExtra, previewEnvironment);
}

function mapDrinkTriggerMode(rawTriggerMap, drinkHrid) {
    const triggerState = getEffectiveTriggerState(rawTriggerMap, drinkHrid);
    if (triggerState.state === "disabled") {
        return "always";
    }

    return triggerState.state;
}

function collectCombatPreviewChangedStats(beforePlayer, afterPlayer) {
    return COMBAT_PREVIEW_STAT_SPECS
        .map((spec) => {
            const beforeValue = spec.getValue(beforePlayer);
            const afterValue = spec.getValue(afterPlayer);
            const deltaValue = afterValue - beforeValue;
            if (!Number.isFinite(deltaValue) || Math.abs(deltaValue) <= COMBAT_PREVIEW_EPSILON) {
                return null;
            }

            return {
                key: spec.key,
                labelKey: spec.labelKey,
                fallbackLabel: spec.fallbackLabel,
                format: spec.format,
                deltaValue,
                finalValue: afterValue,
            };
        })
        .filter(Boolean);
}

const COMBAT_PREVIEW_STAT_SPEC_MAP = new Map(
    COMBAT_PREVIEW_STAT_SPECS.map((spec) => [spec.key, spec])
);

function buildCombatPreviewHighlightSource(sourceType, sourceKey, sourceHrid, sourceName, changedStats) {
    return {
        sourceType,
        sourceKey,
        sourceHrid,
        sourceName,
        changedStats: Array.isArray(changedStats) ? changedStats : [],
    };
}

function snapshotCombatPreviewPlayer(player) {
    return structuredClone(player);
}

function getCombatPreviewUnitContext(previewState) {
    const friendlies = previewState.player.isPlayer
        ? previewState.simulator.players
        : previewState.simulator.enemies;
    const enemies = previewState.player.isPlayer
        ? previewState.simulator.enemies
        : previewState.simulator.players;
    const target = CombatUtilities.getTarget(enemies);

    return {
        friendlies,
        enemies,
        target,
    };
}

function normalizeCombatPreviewContext(previewContext) {
    const previewMode = String(previewContext?.mode || "");
    const labyrinthHrid = String(previewContext?.labyrinthHrid || "");
    if (previewMode === "labyrinth" || (!previewMode && labyrinthHrid)) {
        if (!labyrinthHrid) {
            return null;
        }

        const rawRoomLevel = Number(previewContext?.roomLevel || 100);
        return {
            mode: "labyrinth",
            labyrinthHrid,
            roomLevel: Number.isFinite(rawRoomLevel) ? Math.max(20, rawRoomLevel) : 100,
            crates: Array.isArray(previewContext?.crates)
                ? previewContext.crates.map((crate) => String(crate || "")).filter(Boolean)
                : [],
        };
    }

    const zoneHrid = String(previewContext?.zoneHrid || "");
    if (!zoneHrid) {
        return null;
    }

    const rawDifficultyTier = Number(previewContext?.difficultyTier || 0);
    return {
        mode: "zone",
        zoneHrid,
        difficultyTier: Number.isFinite(rawDifficultyTier) ? rawDifficultyTier : 0,
        useDungeon: Boolean(previewContext?.useDungeon),
    };
}

function withCombatPreviewDeterministicRandom(callback) {
    const originalMathRandom = Math.random;
    Math.random = () => 0;

    try {
        return callback();
    } finally {
        Math.random = originalMathRandom;
    }
}

function initializeCombatPreviewEnemy(enemy) {
    if (!enemy) {
        return null;
    }

    enemy.zoneBuffs = Array.isArray(enemy.zoneBuffs) ? enemy.zoneBuffs : [];
    enemy.extraBuffs = Array.isArray(enemy.extraBuffs) ? enemy.extraBuffs : [];
    enemy.updateCombatDetails();
    enemy.generatePermanentBuffs();
    enemy.reset(0);

    return enemy;
}

function createFallbackCombatPreviewEnemies() {
    if (!COMBAT_PREVIEW_ENEMY_HRID) {
        return [];
    }

    return [initializeCombatPreviewEnemy(new Monster(COMBAT_PREVIEW_ENEMY_HRID, 0, 100))].filter(Boolean);
}

function buildCombatPreviewEnvironment(previewContext = null) {
    const normalizedContext = normalizeCombatPreviewContext(previewContext);
    const fallbackEnemies = createFallbackCombatPreviewEnemies();
    if (!normalizedContext) {
        return {
            zoneBuffs: [],
            enemies: fallbackEnemies,
        };
    }

    try {
        if (normalizedContext.mode === "labyrinth") {
            const previewLabyrinth = new Labyrinth(
                normalizedContext.labyrinthHrid,
                normalizedContext.roomLevel,
                normalizedContext.crates
            );
            const enemies = (previewLabyrinth.getMonster() ?? [])
                .map((enemy) => initializeCombatPreviewEnemy(enemy))
                .filter(Boolean);

            return {
                zoneBuffs: cloneCombatPreviewBuffs(previewLabyrinth.buffs),
                enemies: enemies.length > 0 ? enemies : fallbackEnemies,
            };
        }

        const previewZone = new Zone(normalizedContext.zoneHrid, normalizedContext.difficultyTier);
        const encounter = withCombatPreviewDeterministicRandom(() => (
            normalizedContext.useDungeon || previewZone.isDungeon
                ? previewZone.getNextWave()
                : previewZone.getRandomEncounter()
        ));
        const enemies = (encounter ?? []).map((enemy) => initializeCombatPreviewEnemy(enemy)).filter(Boolean);

        return {
            zoneBuffs: cloneCombatPreviewBuffs(previewZone.buffs),
            enemies: enemies.length > 0 ? enemies : fallbackEnemies,
        };
    } catch (error) {
        return {
            zoneBuffs: [],
            enemies: fallbackEnemies,
        };
    }
}

function createCombatPreviewEnemies(previewContext = null) {
    return buildCombatPreviewEnvironment(previewContext).enemies;
}

function createCombatPreviewSimulationState(playerConfig, previewExtra = null, previewEnvironment = null) {
    const resolvedPreviewEnvironment = previewEnvironment || buildCombatPreviewEnvironment();
    const player = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, resolvedPreviewEnvironment);
    if (!player) {
        return null;
    }

    const simulator = new CombatSimulator([player], null, null, { enableHpMpVisualization: false });
    simulator.enemies = resolvedPreviewEnvironment.enemies;
    simulator.simulationTime = 0;
    simulator.enemies.forEach((enemy) => {
        simulator.simResult.updateTimeSpentAlive(enemy.hrid, true, simulator.simulationTime);
    });

    return {
        player,
        simulator,
    };
}

function getCombatPreviewDeterministicInt(min, max) {
    let normalizedMin = Number(min);
    let normalizedMax = Number(max);

    if (!Number.isFinite(normalizedMin) || !Number.isFinite(normalizedMax)) {
        return 0;
    }

    if (normalizedMax < normalizedMin) {
        [normalizedMin, normalizedMax] = [normalizedMax, normalizedMin];
    }

    return Math.floor((normalizedMin + normalizedMax) / 2);
}

function getCombatPreviewDeterministicRatio(...parts) {
    const serialized = parts.map((part) => String(part ?? "")).join("||");
    let hash = 2166136261;

    for (let i = 0; i < serialized.length; i += 1) {
        hash ^= serialized.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0) / 4294967296;
}

function processAttackForCombatPreview(source, target, abilityEffect = null) {
    let combatStyle = abilityEffect
        ? abilityEffect.combatStyleHrid
        : source.combatDetails.combatStats.combatStyleHrid;
    let damageType = abilityEffect ? abilityEffect.damageType : source.combatDetails.combatStats.damageType;

    let sourceAccuracyRating = 1;
    let sourceAutoAttackMaxDamage = 1;
    let targetEvasionRating = 1;

    switch (combatStyle) {
        case "/combat_styles/stab":
            sourceAccuracyRating = source.combatDetails.stabAccuracyRating;
            sourceAutoAttackMaxDamage = source.combatDetails.stabMaxDamage;
            targetEvasionRating = target.combatDetails.stabEvasionRating;
            break;
        case "/combat_styles/slash":
            sourceAccuracyRating = source.combatDetails.slashAccuracyRating;
            sourceAutoAttackMaxDamage = source.combatDetails.slashMaxDamage;
            targetEvasionRating = target.combatDetails.slashEvasionRating;
            break;
        case "/combat_styles/smash":
            sourceAccuracyRating = source.combatDetails.smashAccuracyRating;
            sourceAutoAttackMaxDamage = source.combatDetails.smashMaxDamage;
            targetEvasionRating = target.combatDetails.smashEvasionRating;
            break;
        case "/combat_styles/ranged":
            sourceAccuracyRating = source.combatDetails.rangedAccuracyRating;
            sourceAutoAttackMaxDamage = source.combatDetails.rangedMaxDamage;
            targetEvasionRating = target.combatDetails.rangedEvasionRating;
            break;
        case "/combat_styles/magic":
            sourceAccuracyRating = source.combatDetails.magicAccuracyRating;
            sourceAutoAttackMaxDamage = source.combatDetails.magicMaxDamage;
            targetEvasionRating = target.combatDetails.magicEvasionRating;
            break;
        default:
            throw new Error(`Unknown combat style: ${combatStyle}`);
    }

    let sourceDamageMultiplier = 1;
    let sourceResistance = 0;
    let sourcePenetration = 0;
    let targetResistance = 0;
    let targetThornPower = 0;
    let targetPenetration = 0;
    let thornType;

    switch (damageType) {
        case "/damage_types/physical":
            sourceDamageMultiplier = 1 + source.combatDetails.combatStats.physicalAmplify;
            sourceResistance = source.combatDetails.totalArmor;
            sourcePenetration = source.combatDetails.combatStats.armorPenetration;
            targetResistance = target.combatDetails.totalArmor;
            targetThornPower = target.combatDetails.combatStats.physicalThorns;
            targetPenetration = target.combatDetails.combatStats.armorPenetration;
            thornType = "physicalThorns";
            break;
        case "/damage_types/water":
            sourceDamageMultiplier = 1 + source.combatDetails.combatStats.waterAmplify;
            sourceResistance = source.combatDetails.totalWaterResistance;
            sourcePenetration = source.combatDetails.combatStats.waterPenetration;
            targetResistance = target.combatDetails.totalWaterResistance;
            targetThornPower = target.combatDetails.combatStats.elementalThorns;
            targetPenetration = target.combatDetails.combatStats.waterPenetration;
            thornType = "elementalThorns";
            break;
        case "/damage_types/nature":
            sourceDamageMultiplier = 1 + source.combatDetails.combatStats.natureAmplify;
            sourceResistance = source.combatDetails.totalNatureResistance;
            sourcePenetration = source.combatDetails.combatStats.naturePenetration;
            targetResistance = target.combatDetails.totalNatureResistance;
            targetThornPower = target.combatDetails.combatStats.elementalThorns;
            targetPenetration = target.combatDetails.combatStats.naturePenetration;
            thornType = "elementalThorns";
            break;
        case "/damage_types/fire":
            sourceDamageMultiplier = 1 + source.combatDetails.combatStats.fireAmplify;
            sourceResistance = source.combatDetails.totalFireResistance;
            sourcePenetration = source.combatDetails.combatStats.firePenetration;
            targetResistance = target.combatDetails.totalFireResistance;
            targetThornPower = target.combatDetails.combatStats.elementalThorns;
            targetPenetration = target.combatDetails.combatStats.firePenetration;
            thornType = "elementalThorns";
            break;
        default:
            throw new Error(`Unknown damage type: ${damageType}`);
    }

    if (abilityEffect) {
        sourceAccuracyRating *= (1 + abilityEffect.bonusAccuracyRatio);
    }

    if (source.isWeakened) {
        sourceAccuracyRating = sourceAccuracyRating - (source.weakenPercentage * sourceAccuracyRating);
    }

    const hitChance =
        Math.pow(sourceAccuracyRating, 1.4) /
        (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));

    let baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
    let baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;
    let armorDamageRatioFlat = abilityEffect ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor : 0;

    let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
    let sourceMaxDamage = sourceDamageMultiplier * (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);
    let damageRoll = getCombatPreviewDeterministicInt(sourceMinDamage, sourceMaxDamage);
    damageRoll *= (1 + source.combatDetails.combatStats.taskDamage);
    damageRoll *= (1 + target.combatDetails.combatStats.damageTaken);
    if (!abilityEffect) {
        damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;
    } else {
        damageRoll *= (1 + source.combatDetails.combatStats.abilityDamage);
    }

    let damageDone = 0;
    let thornDamageDone = 0;
    const didHit = hitChance >= 1 - COMBAT_PREVIEW_EPSILON || (
        hitChance > COMBAT_PREVIEW_EPSILON
        && getCombatPreviewDeterministicRatio(
            "combat-preview-hit",
            source?.hrid,
            target?.hrid,
            combatStyle,
            damageType,
            Number(source?.combatDetails?.currentHitpoints || 0),
            Number(source?.combatDetails?.currentManapoints || 0),
            Number(target?.combatDetails?.currentHitpoints || 0),
            Number(target?.combatDetails?.currentManapoints || 0),
            Number(abilityEffect?.damageFlat || 0),
            Number(abilityEffect?.damageRatio || 0),
            Number(abilityEffect?.bonusAccuracyRatio || 0),
            Number(abilityEffect?.armorDamageRatio || 0)
        ) < hitChance
    );

    if (didHit) {
        let penetratedTargetResistance = targetResistance;
        if (sourcePenetration > 0 && targetResistance > 0) {
            penetratedTargetResistance = targetResistance / (1 + sourcePenetration);
        }

        let targetDamageTakenRatio = 100 / (100 + penetratedTargetResistance);
        if (penetratedTargetResistance < 0) {
            targetDamageTakenRatio = (100 - penetratedTargetResistance) / 100;
        }

        let mitigatedDamage = Math.ceil(targetDamageTakenRatio * damageRoll);
        damageDone = Math.min(mitigatedDamage, target.combatDetails.currentHitpoints);
        target.combatDetails.currentHitpoints -= damageDone;
    }

    if (targetThornPower > 0.0 && targetResistance > -99.0) {
        let penetratedSourceResistance = sourceResistance;

        if (sourceResistance > 0) {
            penetratedSourceResistance = sourceResistance / (1 + targetPenetration);
        }

        let sourceDamageTakenRatio = 100.0 / (100 + penetratedSourceResistance);
        if (penetratedSourceResistance < 0) {
            sourceDamageTakenRatio = (100 - penetratedSourceResistance) / 100;
        }

        let targetTaskDamageMultiplier = 1.0 + target.combatDetails.combatStats.taskDamage;
        let sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;
        let targetDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

        let thornsDamageRoll = getCombatPreviewDeterministicInt(
            1,
            targetDamageMultiplier
                * target.combatDetails.defensiveMaxDamage
                * (1.0 + targetResistance / 100.0)
                * targetThornPower
        );

        let mitigatedThornsDamage = Math.ceil(sourceDamageTakenRatio * thornsDamageRoll);
        thornDamageDone = Math.min(mitigatedThornsDamage, source.combatDetails.currentHitpoints);
        source.combatDetails.currentHitpoints -= thornDamageDone;
    }

    let lifeStealHeal = 0;
    if (!abilityEffect && didHit && source.combatDetails.combatStats.lifeSteal > 0) {
        lifeStealHeal = source.addHitpoints(Math.floor(source.combatDetails.combatStats.lifeSteal * damageDone));
    }

    let hpDrain = 0;
    if (abilityEffect && didHit && abilityEffect.hpDrainRatio > 0) {
        let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        hpDrain = source.addHitpoints(Math.floor(abilityEffect.hpDrainRatio * damageDone * healingAmplify));
    }

    let manaLeechMana = 0;
    if (!abilityEffect && didHit && source.combatDetails.combatStats.manaLeech > 0) {
        manaLeechMana = source.addManapoints(Math.floor(source.combatDetails.combatStats.manaLeech * damageDone));
    }

    return {
        damageDone,
        didHit,
        thornDamageDone,
        thornType,
        retaliationDamageDone: 0,
        lifeStealHeal,
        hpDrain,
        manaLeechMana,
        isCrit: false,
    };
}

function processHealForCombatPreview(source, abilityEffect, target) {
    if (abilityEffect.combatStyleHrid != "/combat_styles/magic") {
        throw new Error(`Heal ability effect not supported for combat style: ${abilityEffect.combatStyleHrid}`);
    }

    let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
    let magicMaxDamage = source.combatDetails.magicMaxDamage;
    let baseHealFlat = abilityEffect.damageFlat;
    let baseHealRatio = abilityEffect.damageRatio;
    let minHeal = healingAmplify * (1 + baseHealFlat);
    let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);
    let heal = getCombatPreviewDeterministicInt(minHeal, maxHeal);

    return target.addHitpoints(heal);
}

function processReviveForCombatPreview(source, abilityEffect, target) {
    if (abilityEffect.combatStyleHrid != "/combat_styles/magic") {
        throw new Error(`Heal ability effect not supported for combat style: ${abilityEffect.combatStyleHrid}`);
    }

    let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
    let magicMaxDamage = source.combatDetails.magicMaxDamage;
    let baseHealFlat = abilityEffect.damageFlat;
    let baseHealRatio = abilityEffect.damageRatio;
    let minHeal = healingAmplify * (1 + baseHealFlat);
    let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);
    let heal = getCombatPreviewDeterministicInt(minHeal, maxHeal);
    let amountHealed = target.addHitpoints(heal);
    target.combatDetails.currentManapoints = target.combatDetails.maxManapoints;
    target.clearCCs();

    return amountHealed;
}

function runCombatPreviewDeterministicAbilityUse(previewState, previewAbility) {
    const originalProcessAttack = CombatUtilities.processAttack;
    const originalProcessHeal = CombatUtilities.processHeal;
    const originalProcessRevive = CombatUtilities.processRevive;
    const originalCheckParry = previewState?.simulator?.checkParry;
    const originalProcStats = {
        blaze: Number(previewState?.player?.combatDetails?.combatStats?.blaze || 0),
        bloom: Number(previewState?.player?.combatDetails?.combatStats?.bloom || 0),
        ripple: Number(previewState?.player?.combatDetails?.combatStats?.ripple || 0),
    };
    const originalChanceEffects = Array.isArray(previewAbility?.abilityEffects)
        ? previewAbility.abilityEffects.map((effect) => ({
            stunChance: Number(effect?.stunChance || 0),
            blindChance: Number(effect?.blindChance || 0),
            silenceChance: Number(effect?.silenceChance || 0),
            pierceChance: Number(effect?.pierceChance || 0),
        }))
        : [];

    CombatUtilities.processAttack = processAttackForCombatPreview;
    CombatUtilities.processHeal = processHealForCombatPreview;
    CombatUtilities.processRevive = processReviveForCombatPreview;
    previewState.simulator.checkParry = () => undefined;
    previewState.player.combatDetails.combatStats.blaze = 0;
    previewState.player.combatDetails.combatStats.bloom = 0;
    previewState.player.combatDetails.combatStats.ripple = 0;
    previewAbility?.abilityEffects?.forEach((effect) => {
        effect.stunChance = 0;
        effect.blindChance = 0;
        effect.silenceChance = 0;
        effect.pierceChance = 0;
    });

    try {
        return previewState.simulator.tryUseAbility(previewState.player, previewAbility);
    } finally {
        CombatUtilities.processAttack = originalProcessAttack;
        CombatUtilities.processHeal = originalProcessHeal;
        CombatUtilities.processRevive = originalProcessRevive;
        previewState.simulator.checkParry = originalCheckParry;
        previewState.player.combatDetails.combatStats.blaze = originalProcStats.blaze;
        previewState.player.combatDetails.combatStats.bloom = originalProcStats.bloom;
        previewState.player.combatDetails.combatStats.ripple = originalProcStats.ripple;
        previewAbility?.abilityEffects?.forEach((effect, index) => {
            const original = originalChanceEffects[index];
            if (!original) {
                return;
            }

            effect.stunChance = original.stunChance;
            effect.blindChance = original.blindChance;
            effect.silenceChance = original.silenceChance;
            effect.pierceChance = original.pierceChance;
        });
    }
}

function buildDrinkPreviewCard(playerConfig, slotIndex, previewExtra = null, previewEnvironment = null) {
    const drinkHrid = String(playerConfig?.drinks?.[slotIndex] || "");
    if (!drinkHrid) {
        return null;
    }

    const beforePlayer = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, previewEnvironment);
    const previewPlayer = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, previewEnvironment);
    const previewDrink = previewPlayer?.drinks?.[slotIndex] || null;
    const itemDetail = itemDetailIndex[drinkHrid];
    const rawConsumableDetail = itemDetail?.consumableDetail || {};

    const card = {
        slotIndex: slotIndex + 1,
        drinkHrid,
        drinkName: itemDetail?.name || drinkHrid,
        triggerMode: mapDrinkTriggerMode(playerConfig?.triggerMap ?? {}, drinkHrid),
        cooldownSeconds: Number(rawConsumableDetail.cooldownDuration || 0) / ONE_SECOND,
        hitpointRestore: Number(rawConsumableDetail.hitpointRestore || 0),
        manapointRestore: Number(rawConsumableDetail.manapointRestore || 0),
        recoveryDurationSeconds: Number(rawConsumableDetail.recoveryDuration || 0) / ONE_SECOND,
        changedStats: [],
        slotAvailable: Boolean(previewDrink),
    };

    if (!previewPlayer || !previewDrink) {
        return card;
    }

    const simulator = new CombatSimulator([previewPlayer], null, null, { enableHpMpVisualization: false });
    simulator.simulationTime = 0;

    const consumed = simulator.tryUseConsumable(previewPlayer, previewDrink);
    if (!consumed) {
        return card;
    }

    const cooldownReadyEvent = simulator.eventQueue.getMatching((event) => event.type === "cooldownReady");
    if (cooldownReadyEvent) {
        card.cooldownSeconds = Math.max(0, Number(cooldownReadyEvent.time || 0) - Number(simulator.simulationTime || 0)) / ONE_SECOND;
    }

    card.changedStats = collectCombatPreviewChangedStats(beforePlayer, previewPlayer);
    return card;
}

function buildSequentialConsumablePreviewResult(previewState, consumableSpec) {
    if (!previewState?.player || !previewState?.simulator || !consumableSpec?.consumableHrid) {
        return {
            source: null,
            consumed: false,
        };
    }

    const collectionKey = consumableSpec.sourceType === "food" ? "food" : "drinks";
    const previewConsumable = previewState.player?.[collectionKey]?.[consumableSpec.slotIndex - 1] || null;
    if (!previewConsumable) {
        return {
            source: null,
            consumed: false,
        };
    }

    const { friendlies, enemies, target } = getCombatPreviewUnitContext(previewState);
    const shouldTrigger = previewConsumable.shouldTrigger(
        previewState.simulator.simulationTime,
        previewState.player,
        target,
        friendlies,
        enemies
    );
    if (!shouldTrigger) {
        return {
            source: null,
            consumed: false,
        };
    }

    const beforePlayer = snapshotCombatPreviewPlayer(previewState.player);
    const consumed = previewState.simulator.tryUseConsumable(previewState.player, previewConsumable);
    if (!consumed) {
        return {
            source: null,
            consumed: false,
        };
    }

    const changedStats = collectCombatPreviewChangedStats(beforePlayer, previewState.player);
    if (changedStats.length <= 0) {
        return {
            source: null,
            consumed: true,
        };
    }

    return {
        source: buildCombatPreviewHighlightSource(
            consumableSpec.sourceType,
            `${consumableSpec.sourceType}-${consumableSpec.slotIndex}-${consumableSpec.consumableHrid}`,
            consumableSpec.consumableHrid,
            consumableSpec.consumableName,
            changedStats
        ),
        consumed: true,
    };
}

function abilityHasPreviewableBuffEffect(ability) {
    return Boolean(ability?.abilityEffects?.some((effect) => (
        effect?.effectType === "/ability_effect_types/buff"
        && (effect?.targetType === "self" || effect?.targetType === "allAllies")
    )));
}

function buildSequentialAbilityPreviewResult(previewState, slotIndex) {
    if (!previewState?.player || !previewState?.simulator) {
        return {
            source: null,
            used: false,
            shouldStop: false,
        };
    }

    const previewAbility = previewState.player?.abilities?.[slotIndex] || null;
    if (!previewAbility) {
        return {
            source: null,
            used: false,
            shouldStop: false,
        };
    }

    const { friendlies, enemies, target } = getCombatPreviewUnitContext(previewState);
    const shouldTrigger = previewAbility.shouldTrigger(
        previewState.simulator.simulationTime,
        previewState.player,
        target,
        friendlies,
        enemies
    );
    if (!shouldTrigger) {
        return {
            source: null,
            used: false,
            shouldStop: false,
        };
    }

    const canUse = previewState.simulator.canUseAbility(previewState.player, previewAbility, false);
    if (!canUse) {
        return {
            source: null,
            used: false,
            shouldStop: true,
        };
    }

    const beforePlayer = snapshotCombatPreviewPlayer(previewState.player);
    const used = runCombatPreviewDeterministicAbilityUse(previewState, previewAbility);
    if (!used) {
        return {
            source: null,
            used: false,
            shouldStop: true,
        };
    }

    if (!abilityHasPreviewableBuffEffect(previewAbility)) {
        return {
            source: null,
            used: true,
            shouldStop: false,
        };
    }

    const changedStats = collectCombatPreviewChangedStats(beforePlayer, previewState.player);
    if (changedStats.length <= 0) {
        return {
            source: null,
            used: true,
            shouldStop: false,
        };
    }

    const abilityHrid = String(previewAbility?.hrid || "");
    const abilityDetail = abilityDetailIndex[abilityHrid];
    return {
        source: buildCombatPreviewHighlightSource(
            "ability",
            `ability-${slotIndex + 1}-${abilityHrid}`,
            abilityHrid,
            abilityDetail?.name || abilityHrid,
            changedStats
        ),
        used: true,
        shouldStop: false,
    };
}

function collectSequentialConsumableHighlightSources(
    previewState,
    consumableSpecs,
    consumedConsumableSlots,
    highlightedConsumableSourceKeys
) {
    const highlightSources = [];
    let consumedConsumable;

    do {
        consumedConsumable = false;

        for (const consumableSpec of consumableSpecs) {
            const consumableSlotKey = `${consumableSpec.sourceType}-${consumableSpec.slotIndex}`;
            if (consumedConsumableSlots.has(consumableSlotKey)) {
                continue;
            }

            const result = buildSequentialConsumablePreviewResult(previewState, consumableSpec);
            if (result.source && !highlightedConsumableSourceKeys.has(result.source.sourceKey)) {
                highlightSources.push(result.source);
                highlightedConsumableSourceKeys.add(result.source.sourceKey);
            }
            if (result.consumed) {
                consumedConsumableSlots.add(consumableSlotKey);
                consumedConsumable = true;
            }
        }
    } while (consumedConsumable);

    return highlightSources;
}

function buildCombatPreviewConsumableSpecs(playerConfig, drinkCards = []) {
    const foodSpecs = (playerConfig?.food ?? [])
        .map((foodHrid, slotIndex) => {
            const normalizedHrid = String(foodHrid || "");
            if (!normalizedHrid) {
                return null;
            }

            return {
                sourceType: "food",
                slotIndex: slotIndex + 1,
                consumableHrid: normalizedHrid,
                consumableName: itemDetailIndex[normalizedHrid]?.name || normalizedHrid,
            };
        })
        .filter(Boolean);
    const drinkSpecs = drinkCards
        .map((card) => {
            const drinkHrid = String(card?.drinkHrid || "");
            if (!drinkHrid) {
                return null;
            }

            return {
                sourceType: "drink",
                slotIndex: Number(card.slotIndex || 0),
                consumableHrid: drinkHrid,
                consumableName: card.drinkName || drinkHrid,
            };
        })
        .filter(Boolean);

    return [...foodSpecs, ...drinkSpecs];
}

function buildCombatPreviewUnitStateKey(unit) {
    if (!unit) {
        return "";
    }

    const combatBuffKey = Object.values(unit.combatBuffs ?? {})
        .map((buff) => [
            String(buff?.uniqueHrid || ""),
            Number(buff?.startTime || 0),
            Number(buff?.duration || 0),
            Number(buff?.ratioBoost || 0),
            Number(buff?.flatBoost || 0),
        ].join(":"))
        .sort()
        .join("|");
    const consumableKey = (collection) => (Array.isArray(collection)
        ? collection.map((consumable) => (
            consumable
                ? `${String(consumable.hrid || "")}:${Number(consumable.lastUsed || 0)}`
                : ""
        )).join("|")
        : "");
    const abilityKey = Array.isArray(unit.abilities)
        ? unit.abilities.map((ability) => (
            ability
                ? `${String(ability.hrid || "")}:${Number(ability.lastUsed || 0)}`
                : ""
        )).join("|")
        : "";

    return [
        Number(unit.combatDetails?.currentHitpoints || 0),
        Number(unit.combatDetails?.currentManapoints || 0),
        Number(unit.combatDetails?.combatStats?.damageTaken || 0),
        Boolean(unit.isStunned),
        Boolean(unit.isSilenced),
        Boolean(unit.isBlinded),
        Boolean(unit.isOutOfMana),
        combatBuffKey,
        consumableKey(unit.food),
        consumableKey(unit.drinks),
        abilityKey,
    ].join("||");
}

function buildCombatPreviewCycleStateKey(previewState) {
    const enemyKey = (previewState?.simulator?.enemies ?? [])
        .map((enemy) => buildCombatPreviewUnitStateKey(enemy))
        .join("###");

    return [
        buildCombatPreviewUnitStateKey(previewState?.player),
        enemyKey,
    ].join("@@@");
}

function buildTaskBadgePreviewSource(playerConfig, previewExtra = null, previewEnvironment = null) {
    const legacyTaskBadge = playerConfig?.equipment?.trinket ?? null;
    const itemHrid = String(legacyTaskBadge?.itemHrid || "");
    if (!itemHrid) {
        return null;
    }

    const itemDetail = itemDetailIndex[itemHrid];
    if (itemDetail?.equipmentDetail?.type !== "/equipment_types/trinket") {
        return null;
    }

    const enhancementLevel = normalizeEnhancementLevel(legacyTaskBadge?.enhancementLevel ?? 0);
    const taskBadge = new Equipment(itemHrid, enhancementLevel);
    const taskDamage = Number(taskBadge.getCombatStat("taskDamage") || 0);
    if (!Number.isFinite(taskDamage) || Math.abs(taskDamage) <= COMBAT_PREVIEW_EPSILON) {
        return null;
    }

    const taskDamageSpec = COMBAT_PREVIEW_STAT_SPEC_MAP.get("taskDamage");
    if (!taskDamageSpec) {
        return null;
    }

    const previewPlayer = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, previewEnvironment);
    const baseTaskDamage = Number(taskDamageSpec.getValue(previewPlayer));

    return buildCombatPreviewHighlightSource(
        "task_badge",
        `task-badge-${itemHrid}-${enhancementLevel}`,
        itemHrid,
        itemDetail?.name || itemHrid,
        [{
            key: taskDamageSpec.key,
            labelKey: taskDamageSpec.labelKey,
            fallbackLabel: taskDamageSpec.fallbackLabel,
            format: taskDamageSpec.format,
            deltaValue: taskDamage,
            finalValue: baseTaskDamage + taskDamage,
        }]
    );
}

function buildConditionalHighlightSources(playerConfig, previewExtra = null, drinkCards = [], previewEnvironment = null) {
    const previewState = createCombatPreviewSimulationState(playerConfig, previewExtra, previewEnvironment);
    const highlightSources = [];

    if (previewState) {
        const consumableSpecs = buildCombatPreviewConsumableSpecs(playerConfig, drinkCards);
        const consumedConsumableSlots = new Set();
        const highlightedConsumableSourceKeys = new Set();
        const seenCycleStateKeys = new Set();
        const abilitySlotCount = playerConfig?.abilities?.length ?? 0;

        highlightSources.push(...collectSequentialConsumableHighlightSources(
            previewState,
            consumableSpecs,
            consumedConsumableSlots,
            highlightedConsumableSourceKeys
        ));

        while (true) {
            const cycleStateKey = buildCombatPreviewCycleStateKey(previewState);
            if (seenCycleStateKeys.has(cycleStateKey)) {
                break;
            }
            seenCycleStateKeys.add(cycleStateKey);

            let usedAbilityThisCycle = false;
            let shouldStop = false;

            for (let slotIndex = 0; slotIndex < abilitySlotCount; slotIndex += 1) {
                const result = buildSequentialAbilityPreviewResult(previewState, slotIndex);
                if (result.source) {
                    highlightSources.push(result.source);
                }
                if (result.shouldStop) {
                    shouldStop = true;
                    break;
                }
                if (!result.used) {
                    continue;
                }

                usedAbilityThisCycle = true;
                highlightSources.push(...collectSequentialConsumableHighlightSources(
                    previewState,
                    consumableSpecs,
                    consumedConsumableSlots,
                    highlightedConsumableSourceKeys
                ));
                break;
            }

            if (shouldStop || !usedAbilityThisCycle) {
                break;
            }
        }
    }

    const taskBadgeSource = buildTaskBadgePreviewSource(playerConfig, previewExtra, previewEnvironment);
    if (taskBadgeSource) {
        highlightSources.push(taskBadgeSource);
    }

    return highlightSources;
}

export function buildPlayersForSimulation(playerConfigs) {
    const selectedPlayers = (playerConfigs ?? []).filter((player) => player.selected);
    const simulationPlayers = selectedPlayers.map((player) => buildSimulationPlayerFromConfig(player));

    applyDebuffOnLevelGap(simulationPlayers);

    return simulationPlayers;
}

export function buildPlayersForCombatPreview(playerConfigs, previewExtra = null, previewContext = null) {
    const normalizedExtra = normalizeSimulationExtra(previewExtra);
    const previewEnvironment = buildCombatPreviewEnvironment(previewContext);
    const simulationPlayers = buildPlayersForSimulation(playerConfigs);
    simulationPlayers.forEach((player) => normalizePreviewPlayer(player, normalizedExtra, previewEnvironment));

    return simulationPlayers;
}

export function buildCombatPreviewData(playerConfig, previewExtra = null, previewContext = null) {
    const normalizedExtra = normalizeSimulationExtra(previewExtra);
    const previewEnvironment = buildCombatPreviewEnvironment(previewContext);
    const player = buildSingleCombatPreviewPlayer(playerConfig, normalizedExtra, previewEnvironment);
    const drinkCards = (playerConfig?.drinks ?? [])
        .map((_, slotIndex) => buildDrinkPreviewCard(playerConfig, slotIndex, normalizedExtra, previewEnvironment))
        .filter(Boolean);
    const highlightSources = buildConditionalHighlightSources(
        playerConfig,
        normalizedExtra,
        drinkCards,
        previewEnvironment
    );

    return {
        player,
        drinkCards,
        highlightSources,
    };
}

export {
    calcCombatLevel,
    createEmptyPlayerConfig,
    createEmptySkillExperienceMap,
    EQUIPMENT_SLOT_KEYS,
    LEVEL_KEYS,
};
