import Ability from "../combatsimulator/ability.js";
import CombatUtilities from "../combatsimulator/combatUtilities.js";
import CombatSimulator from "../combatsimulator/combatSimulator.js";
import Consumable from "../combatsimulator/consumable.js";
import Equipment from "../combatsimulator/equipment.js";
import GuildBuff from "../combatsimulator/guildBuff.js";
import Labyrinth from "../combatsimulator/labyrinth.js";
import Monster from "../combatsimulator/monster.js";
import Player from "../combatsimulator/player.js";
import Zone from "../combatsimulator/zone.js";
import { createCombatScrollBuff, getCombatScrollSourceKey } from "../combatsimulator/combatScrollBuff.js";
import { BUFF_SOURCE_POLICY, PARTY_AURA_ABILITY_HRIDS, isPartyAuraBuff } from "../combatsimulator/buffSourcePolicy.js";
import abilitySlotsLevelRequirementList from "../combatsimulator/data/abilitySlotsLevelRequirementList.json";
import combatMonsterDetailMap from "../combatsimulator/data/combatMonsterDetailMap.json";
import { abilityDetailIndex, GAME_DATA_VERSION, itemDetailIndex } from "../shared/gameDataIndex.js";
import {
    calcCombatLevel,
    createEmptyPlayerConfig,
    createEmptySkillExperienceMap,
    EQUIPMENT_SLOT_KEYS,
    LEVEL_KEYS,
    normalizeHouseRoomLevels,
} from "../shared/playerConfig.js";
import { normalizeCombatScrolls } from "../shared/combatScrolls.js";
import { combatGuildBuffDetails, guildShrineDetailIndex, normalizeGuildBuffLevels } from "../shared/guildBuffs.js";
import { LABYRINTH_ROOM_LEVEL_DEFAULT, LABYRINTH_ROOM_LEVEL_MIN } from "../shared/labyrinthConfig.js";
import { buildSimulationExtraBuffs, normalizeSimulationExtra } from "../shared/simulationExtraBuffs.js";
import { getEffectiveTriggerState, sanitizeTriggerMap, toTriggerInstances } from "./triggerMapper.js";

const ONE_SECOND = 1e9;
const COMBAT_PREVIEW_EPSILON = 1e-9;
const COMBAT_PREVIEW_ENEMY_HRID = Object.keys(combatMonsterDetailMap || {})[0] || "";
const COMBAT_PREVIEW_STAT_SPECS = [
    {
        key: "maxHitpoints",
        statNameKey: "maxHp",
        fallbackLabel: "Max HP",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.maxHitpoints || 0),
    },
    {
        key: "maxManapoints",
        statNameKey: "maxMp",
        fallbackLabel: "Max MP",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.maxManapoints || 0),
    },
    {
        key: "attackIntervalSeconds",
        statNameKey: "attackInterval",
        fallbackLabel: "Attack Interval",
        format: "seconds",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.attackInterval || 0) / ONE_SECOND,
    },
    {
        key: "stabAccuracyRating",
        statNameKey: "stabAccuracy",
        fallbackLabel: "Stab Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.stabAccuracyRating || 0),
    },
    {
        key: "stabMaxDamage",
        statNameKey: "stabDamage",
        fallbackLabel: "Stab Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.stabMaxDamage || 0),
    },
    {
        key: "slashAccuracyRating",
        statNameKey: "slashAccuracy",
        fallbackLabel: "Slash Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.slashAccuracyRating || 0),
    },
    {
        key: "slashMaxDamage",
        statNameKey: "slashDamage",
        fallbackLabel: "Slash Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.slashMaxDamage || 0),
    },
    {
        key: "smashAccuracyRating",
        statNameKey: "smashAccuracy",
        fallbackLabel: "Smash Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.smashAccuracyRating || 0),
    },
    {
        key: "smashMaxDamage",
        statNameKey: "smashDamage",
        fallbackLabel: "Smash Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.smashMaxDamage || 0),
    },
    {
        key: "defensiveMaxDamage",
        statNameKey: "defensiveDamage",
        fallbackLabel: "Defensive Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.defensiveMaxDamage || 0),
    },
    {
        key: "rangedAccuracyRating",
        statNameKey: "rangedAccuracy",
        fallbackLabel: "Ranged Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.rangedAccuracyRating || 0),
    },
    {
        key: "rangedMaxDamage",
        statNameKey: "rangedDamage",
        fallbackLabel: "Ranged Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.rangedMaxDamage || 0),
    },
    {
        key: "magicAccuracyRating",
        statNameKey: "magicAccuracy",
        fallbackLabel: "Magic Accuracy",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.magicAccuracyRating || 0),
    },
    {
        key: "magicMaxDamage",
        statNameKey: "magicDamage",
        fallbackLabel: "Magic Damage",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.magicMaxDamage || 0),
    },
    {
        key: "averageEvasion",
        statNameKey: "evasion",
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
        statNameKey: "stabEvasion",
        fallbackLabel: "Stab Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.stabEvasionRating || 0),
    },
    {
        key: "slashEvasionRating",
        statNameKey: "slashEvasion",
        fallbackLabel: "Slash Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.slashEvasionRating || 0),
    },
    {
        key: "smashEvasionRating",
        statNameKey: "smashEvasion",
        fallbackLabel: "Smash Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.smashEvasionRating || 0),
    },
    {
        key: "rangedEvasionRating",
        statNameKey: "rangedEvasion",
        fallbackLabel: "Ranged Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.rangedEvasionRating || 0),
    },
    {
        key: "magicEvasionRating",
        statNameKey: "magicEvasion",
        fallbackLabel: "Magic Evasion",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.magicEvasionRating || 0),
    },
    {
        key: "totalArmor",
        statNameKey: "armor",
        fallbackLabel: "Armor",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalArmor || 0),
    },
    {
        key: "totalWaterResistance",
        statNameKey: "waterResistance",
        fallbackLabel: "Water Resistance",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalWaterResistance || 0),
    },
    {
        key: "totalNatureResistance",
        statNameKey: "natureResistance",
        fallbackLabel: "Nature Resistance",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalNatureResistance || 0),
    },
    {
        key: "totalFireResistance",
        statNameKey: "fireResistance",
        fallbackLabel: "Fire Resistance",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.totalFireResistance || 0),
    },
    {
        key: "criticalRate",
        statNameKey: "criticalRate",
        fallbackLabel: "Critical Rate",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.criticalRate || 0),
    },
    {
        key: "armorPenetration",
        statNameKey: "armorPenetration",
        fallbackLabel: "Armor Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.armorPenetration || 0),
    },
    {
        key: "physicalAmplify",
        statNameKey: "physicalAmplify",
        fallbackLabel: "Physical Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.physicalAmplify || 0),
    },
    {
        key: "waterAmplify",
        statNameKey: "waterAmplify",
        fallbackLabel: "Water Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.waterAmplify || 0),
    },
    {
        key: "natureAmplify",
        statNameKey: "natureAmplify",
        fallbackLabel: "Nature Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.natureAmplify || 0),
    },
    {
        key: "fireAmplify",
        statNameKey: "fireAmplify",
        fallbackLabel: "Fire Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.fireAmplify || 0),
    },
    {
        key: "healingAmplify",
        statNameKey: "healingAmplify",
        fallbackLabel: "Healing Amplify",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.healingAmplify || 0),
    },
    {
        key: "lifeSteal",
        statNameKey: "lifeSteal",
        fallbackLabel: "Life Steal",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.lifeSteal || 0),
    },
    {
        key: "physicalThorns",
        statNameKey: "physicalThorns",
        fallbackLabel: "Physical Thorns",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.physicalThorns || 0),
    },
    {
        key: "elementalThorns",
        statNameKey: "elementalThorns",
        fallbackLabel: "Elemental Thorns",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.elementalThorns || 0),
    },
    {
        key: "retaliation",
        statNameKey: "retaliation",
        fallbackLabel: "Retaliation",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.retaliation || 0),
    },
    {
        key: "hpRegenPer10",
        statNameKey: "hpRegen",
        fallbackLabel: "HP Regen",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.hpRegenPer10 || 0),
    },
    {
        key: "mpRegenPer10",
        statNameKey: "mpRegen",
        fallbackLabel: "MP Regen",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.mpRegenPer10 || 0),
    },
    {
        key: "criticalDamage",
        statNameKey: "criticalDamage",
        fallbackLabel: "Critical Damage Bonus",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.criticalDamage || 0),
    },
    {
        key: "taskDamage",
        statNameKey: "taskDamage",
        fallbackLabel: "Task Damage Bonus",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.taskDamage || 0),
    },
    {
        key: "waterPenetration",
        statNameKey: "waterPenetration",
        fallbackLabel: "Water Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.waterPenetration || 0),
    },
    {
        key: "naturePenetration",
        statNameKey: "naturePenetration",
        fallbackLabel: "Nature Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.naturePenetration || 0),
    },
    {
        key: "firePenetration",
        statNameKey: "firePenetration",
        fallbackLabel: "Fire Penetration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.firePenetration || 0),
    },
    {
        key: "abilityHaste",
        statNameKey: "abilityHaste",
        fallbackLabel: "Ability Haste",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.abilityHaste || 0),
    },
    {
        key: "tenacity",
        statNameKey: "tenacity",
        fallbackLabel: "Tenacity",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.tenacity || 0),
    },
    {
        key: "manaLeech",
        statNameKey: "manaLeech",
        fallbackLabel: "Mana Leech",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.manaLeech || 0),
    },
    {
        key: "castSpeed",
        statNameKey: "castSpeed",
        fallbackLabel: "Cast Speed",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.castSpeed || 0),
    },
    {
        key: "totalThreat",
        statNameKey: "threat",
        fallbackLabel: "Threat",
        format: "int",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.threat || 0),
    },
    {
        key: "parry",
        statNameKey: "parry",
        fallbackLabel: "Parry",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.parry || 0),
    },
    {
        key: "mayhem",
        statNameKey: "mayhem",
        fallbackLabel: "Mayhem",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.mayhem || 0),
    },
    {
        key: "pierce",
        statNameKey: "pierce",
        fallbackLabel: "Pierce",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.pierce || 0),
    },
    {
        key: "curse",
        statNameKey: "curse",
        fallbackLabel: "Curse",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.curse || 0),
    },
    {
        key: "fury",
        statNameKey: "fury",
        fallbackLabel: "Fury",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.fury || 0),
    },
    {
        key: "weaken",
        statNameKey: "weaken",
        fallbackLabel: "Weaken",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.weaken || 0),
    },
    {
        key: "ripple",
        statNameKey: "ripple",
        fallbackLabel: "Ripple",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.ripple || 0),
    },
    {
        key: "bloom",
        statNameKey: "bloom",
        fallbackLabel: "Bloom",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.bloom || 0),
    },
    {
        key: "blaze",
        statNameKey: "blaze",
        fallbackLabel: "Blaze",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.blaze || 0),
    },
    {
        key: "attackSpeed",
        statNameKey: "attackSpeed",
        fallbackLabel: "Attack Speed",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.attackSpeed || 0),
    },
    {
        key: "autoAttackDamage",
        statNameKey: "autoAttackDamage",
        fallbackLabel: "Auto Attack Damage",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.autoAttackDamage || 0),
    },
    {
        key: "abilityDamage",
        statNameKey: "abilityDamage",
        fallbackLabel: "Ability Damage",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.abilityDamage || 0),
    },
    {
        key: "drinkConcentration",
        statNameKey: "drinkConcentration",
        fallbackLabel: "Drink Concentration",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.drinkConcentration || 0),
    },
    {
        key: "foodHaste",
        statNameKey: "foodHaste",
        fallbackLabel: "Food Haste",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.foodHaste || 0),
    },
    {
        key: "combatDropRate",
        statNameKey: "combatDropRate",
        fallbackLabel: "Drop Rate",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatDropRate || 0),
    },
    {
        key: "combatRareFind",
        statNameKey: "combatRareFind",
        fallbackLabel: "Rare Find",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatRareFind || 0),
    },
    {
        key: "combatDropQuantity",
        statNameKey: "combatDropQuantity",
        fallbackLabel: "Drop Quantity",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatDropQuantity || 0),
    },
    {
        key: "combatExperience",
        statNameKey: "combatExperience",
        fallbackLabel: "Experience Rate",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.combatExperience || 0),
    },
    {
        key: "staminaExperience",
        statNameKey: "staminaExperience",
        fallbackLabel: "Stamina Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.staminaExperience || 0),
    },
    {
        key: "intelligenceExperience",
        statNameKey: "intelligenceExperience",
        fallbackLabel: "Intelligence Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.intelligenceExperience || 0),
    },
    {
        key: "attackExperience",
        statNameKey: "attackExperience",
        fallbackLabel: "Attack Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.attackExperience || 0),
    },
    {
        key: "defenseExperience",
        statNameKey: "defenseExperience",
        fallbackLabel: "Defense Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.defenseExperience || 0),
    },
    {
        key: "meleeExperience",
        statNameKey: "meleeExperience",
        fallbackLabel: "Melee Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.meleeExperience || 0),
    },
    {
        key: "rangedExperience",
        statNameKey: "rangedExperience",
        fallbackLabel: "Ranged Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.rangedExperience || 0),
    },
    {
        key: "magicExperience",
        statNameKey: "magicExperience",
        fallbackLabel: "Magic Experience",
        format: "percent",
        getValue: (player) => Number(player?.combatDetails?.combatStats?.magicExperience || 0),
    },
];

function normalizeCombatPreviewExtra(previewExtra = null) {
    return {
        ...normalizeSimulationExtra(previewExtra),
        combatScrollsEnabled: Boolean(previewExtra?.combatScrollsEnabled),
    };
}

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
            currentPlayer.magicLevel,
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
        combatScrolls: normalizeCombatScrolls(playerConfig.combatScrolls),
        houseRooms: playerConfig.houseRooms ?? {},
        guildBuffs: playerConfig.guildBuffs ?? {},
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
            abilityHrid &&
            Number.isFinite(abilityLevel) &&
            abilityLevel > 0 &&
            simulationPlayer.intelligenceLevel >= abilitySlotsLevelRequirementList[i + 1]
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

    // Preview represents the state immediately after combat starts.  Apply a
    // single opening of each configured combat scroll for ordinary zones, but
    // deliberately skip it in Labyrinth where the official scroll rule is
    // "not effective", and when the simulation setting disables scrolls
    // entirely.  The real simulator owns renewal/inventory timers.
    if (previewEnvironment?.scrollsAllowed !== false && previewExtra?.combatScrollsEnabled === true) {
        for (const itemHrid of Object.keys(normalizeCombatScrolls(player.combatScrolls))) {
            const buff = createCombatScrollBuff(itemHrid);
            if (buff) {
                player.addBuff(buff, 0, getCombatScrollSourceKey(itemHrid));
            }
        }
    }

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

function buildCombatPreviewChangedStat(spec, beforeValue, afterValue) {
    const deltaValue = afterValue - beforeValue;
    if (!Number.isFinite(deltaValue) || Math.abs(deltaValue) <= COMBAT_PREVIEW_EPSILON) {
        return null;
    }

    return {
        key: spec.key,
        labelKey: getCombatPreviewOfficialLabelKey(spec.statNameKey),
        fallbackLabel: spec.fallbackLabel,
        format: spec.format,
        deltaValue,
        finalValue: afterValue,
    };
}

function collectCombatPreviewChangedStats(beforePlayer, afterPlayer) {
    return COMBAT_PREVIEW_STAT_SPECS.map((spec) =>
        buildCombatPreviewChangedStat(spec, spec.getValue(beforePlayer), spec.getValue(afterPlayer)),
    ).filter(Boolean);
}

function snapshotCombatPreviewStatValues(player) {
    return new Map(COMBAT_PREVIEW_STAT_SPECS.map((spec) => [spec.key, spec.getValue(player)]));
}

function collectCombatPreviewChangedStatsFromSnapshot(beforeValues, afterPlayer) {
    return COMBAT_PREVIEW_STAT_SPECS.map((spec) =>
        buildCombatPreviewChangedStat(spec, Number(beforeValues.get(spec.key)), spec.getValue(afterPlayer)),
    ).filter(Boolean);
}

const COMBAT_PREVIEW_STAT_SPEC_MAP = new Map(COMBAT_PREVIEW_STAT_SPECS.map((spec) => [spec.key, spec]));

const COMBAT_PREVIEW_OFFICIAL_STAT_KEY_ALIASES = Object.freeze({
    maxHp: "maxHitpoints",
    maxMp: "maxManapoints",
    hpRegen: "hpRegenPer10",
    mpRegen: "mpRegenPer10",
});

function getCombatPreviewOfficialLabelKey(statNameKey) {
    if (statNameKey === "evasion") {
        return "translation:buffTypeNames./buff_types/evasion";
    }
    const officialStatKey = COMBAT_PREVIEW_OFFICIAL_STAT_KEY_ALIASES[statNameKey] || statNameKey;
    return `translation:combatStats.${officialStatKey}`;
}

function buildCombatPreviewHighlightSource(sourceType, sourceKey, sourceHrid, sourceName, changedStats) {
    return {
        sourceType,
        sourceKey,
        sourceHrid,
        sourceName,
        changedStats: Array.isArray(changedStats) ? changedStats : [],
    };
}

function buildCombatPreviewStatBreakdowns(baseValues, finalPlayer, highlightSources) {
    const sourcesByStatKey = new Map();

    for (const source of highlightSources) {
        for (const stat of source?.changedStats ?? []) {
            if (!sourcesByStatKey.has(stat.key)) {
                sourcesByStatKey.set(stat.key, []);
            }
            sourcesByStatKey.get(stat.key).push({
                sourceType: source.sourceType,
                sourceKey: source.sourceKey,
                sourceHrid: source.sourceHrid,
                sourceName: source.sourceName,
                deltaValue: stat.deltaValue,
            });
        }
    }

    return Object.fromEntries(
        COMBAT_PREVIEW_STAT_SPECS.map((spec) => {
            const sources = sourcesByStatKey.get(spec.key) ?? [];
            const finalValue = spec.getValue(finalPlayer);
            const sourceTotal = sources.reduce((sum, source) => sum + Number(source.deltaValue || 0), 0);
            const measuredBaseValue = Number(baseValues?.get(spec.key));
            const canReconcile =
                Number.isFinite(measuredBaseValue) && Number.isFinite(finalValue) && Number.isFinite(sourceTotal);
            const reconciliationDelta = canReconcile ? finalValue - measuredBaseValue - sourceTotal : 0;
            // Keep Base as the independently measured no-highlight baseline. Any
            // mismatch caused by mixed/non-linear attribution belongs in the
            // explicit reconciliation field instead of being hidden in Base.
            const baseValue = Number.isFinite(measuredBaseValue) ? measuredBaseValue : finalValue - sourceTotal;

            return [
                spec.key,
                {
                    key: spec.key,
                    labelKey: getCombatPreviewOfficialLabelKey(spec.statNameKey),
                    fallbackLabel: spec.fallbackLabel,
                    format: spec.format,
                    baseValue,
                    finalValue,
                    reconciliationDelta,
                    sources,
                },
            ];
        }),
    );
}

function snapshotCombatPreviewPlayer(player) {
    return structuredClone(player);
}

function getCombatPreviewUnitContext(previewState) {
    const friendlies = previewState.player.isPlayer ? previewState.simulator.players : previewState.simulator.enemies;
    const enemies = previewState.player.isPlayer ? previewState.simulator.enemies : previewState.simulator.players;
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

        const rawRoomLevel = Number(previewContext?.roomLevel || LABYRINTH_ROOM_LEVEL_DEFAULT);
        return {
            mode: "labyrinth",
            labyrinthHrid,
            roomLevel: Number.isFinite(rawRoomLevel)
                ? Math.max(LABYRINTH_ROOM_LEVEL_MIN, rawRoomLevel)
                : LABYRINTH_ROOM_LEVEL_DEFAULT,
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
            scrollsAllowed: true,
        };
    }

    try {
        if (normalizedContext.mode === "labyrinth") {
            const previewLabyrinth = new Labyrinth(
                normalizedContext.labyrinthHrid,
                normalizedContext.roomLevel,
                normalizedContext.crates,
            );
            const enemies = (previewLabyrinth.getMonster() ?? [])
                .map((enemy) => initializeCombatPreviewEnemy(enemy))
                .filter(Boolean);

            return {
                zoneBuffs: cloneCombatPreviewBuffs(previewLabyrinth.buffs),
                enemies: enemies.length > 0 ? enemies : fallbackEnemies,
                scrollsAllowed: false,
            };
        }

        const previewZone = new Zone(normalizedContext.zoneHrid, normalizedContext.difficultyTier);
        const encounter = withCombatPreviewDeterministicRandom(() =>
            normalizedContext.useDungeon || previewZone.isDungeon
                ? previewZone.getNextWave()
                : previewZone.getRandomEncounter(),
        );
        const enemies = (encounter ?? []).map((enemy) => initializeCombatPreviewEnemy(enemy)).filter(Boolean);

        return {
            zoneBuffs: cloneCombatPreviewBuffs(previewZone.buffs),
            enemies: enemies.length > 0 ? enemies : fallbackEnemies,
            scrollsAllowed: true,
        };
    } catch (error) {
        return {
            zoneBuffs: [],
            enemies: fallbackEnemies,
            scrollsAllowed: true,
        };
    }
}

function createCombatPreviewEnemies(previewContext = null) {
    return buildCombatPreviewEnvironment(previewContext).enemies;
}

function createCombatPreviewSimulationState(
    playerConfig,
    previewExtra = null,
    previewEnvironment = null,
    partyPlayerConfigs = null,
) {
    const resolvedPreviewEnvironment = previewEnvironment || buildCombatPreviewEnvironment();
    const player = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, resolvedPreviewEnvironment);
    if (!player) {
        return null;
    }

    // Keep the hero's construction path identical to the solo preview, then
    // add selected teammates solely to the simulator context.  This lets the
    // hero's existing sequential trigger replay see all allies without
    // changing the hero's level-gap/permanent-buff initialization.
    const heroId = String(playerConfig?.id || "");
    const teammateConfigs = (partyPlayerConfigs ?? []).filter(
        (config) => config && config.selected && String(config.id || "") !== heroId,
    );
    const teammatePlayers = buildPlayersForSimulation(teammateConfigs);
    teammatePlayers.forEach((teammate) => {
        normalizePreviewPlayer(teammate, previewExtra, resolvedPreviewEnvironment);
    });
    const simulationPlayers = [player, ...teammatePlayers];

    const simulator = new CombatSimulator(simulationPlayers, null, null, { enableHpMpVisualization: false });
    simulator.enemies = resolvedPreviewEnvironment.enemies;
    simulator.simulationTime = 0;
    simulator.enemies.forEach((enemy) => {
        simulator.simResult.updateTimeSpentAlive(enemy.hrid, true, simulator.simulationTime);
    });

    // The live encounter checks every unit's food/drink triggers before it
    // schedules the first ability.  Replay selected teammates' consumables so
    // hero triggers that inspect ally state see the same opening context. The
    // hero's own consumables are still handled by buildConditionalPreviewResult
    // (which also owns their highlight attribution).
    teammatePlayers.forEach((teammate, index) => {
        replayPartyPreviewConsumables({ player: teammate, simulator }, teammateConfigs[index]);
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
    let combatStyle = abilityEffect ? abilityEffect.combatStyleHrid : source.combatDetails.combatStats.combatStyleHrid;
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
        sourceAccuracyRating *= 1 + abilityEffect.bonusAccuracyRatio;
    }

    if (source.isWeakened) {
        sourceAccuracyRating = sourceAccuracyRating - source.weakenPercentage * sourceAccuracyRating;
    }

    const hitChance =
        Math.pow(sourceAccuracyRating, 1.4) /
        (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));

    let baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
    let baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;
    let armorDamageRatioFlat = abilityEffect ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor : 0;

    let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
    let sourceMaxDamage =
        sourceDamageMultiplier * (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);
    let damageRoll = getCombatPreviewDeterministicInt(sourceMinDamage, sourceMaxDamage);
    damageRoll *= 1 + source.combatDetails.combatStats.taskDamage;
    damageRoll *= 1 + target.combatDetails.combatStats.damageTaken;
    if (!abilityEffect) {
        damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;
    } else {
        damageRoll *= 1 + source.combatDetails.combatStats.abilityDamage;
    }

    let damageDone = 0;
    let thornDamageDone = 0;
    const didHit =
        hitChance >= 1 - COMBAT_PREVIEW_EPSILON ||
        (hitChance > COMBAT_PREVIEW_EPSILON &&
            getCombatPreviewDeterministicRatio(
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
                Number(abilityEffect?.armorDamageRatio || 0),
            ) < hitChance);

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
            targetDamageMultiplier *
                target.combatDetails.defensiveMaxDamage *
                (1.0 + targetResistance / 100.0) *
                targetThornPower,
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

function runCombatPreviewDeterministicAbilityUse(previewState, previewAbility, sourcePlayer = null) {
    const caster = sourcePlayer || previewState?.player;
    if (!caster) {
        return false;
    }
    const originalProcessAttack = CombatUtilities.processAttack;
    const originalProcessHeal = CombatUtilities.processHeal;
    const originalProcessRevive = CombatUtilities.processRevive;
    const originalCheckParry = previewState?.simulator?.checkParry;
    const originalProcStats = {
        blaze: Number(caster?.combatDetails?.combatStats?.blaze || 0),
        bloom: Number(caster?.combatDetails?.combatStats?.bloom || 0),
        ripple: Number(caster?.combatDetails?.combatStats?.ripple || 0),
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
    caster.combatDetails.combatStats.blaze = 0;
    caster.combatDetails.combatStats.bloom = 0;
    caster.combatDetails.combatStats.ripple = 0;
    // Fold the zeroed proc rates into the combat-stat baseline so a
    // updateCombatDetails triggered inside tryUseAbility (e.g. via a buff
    // effect) cannot silently restore the pre-zeroed values through
    // resetCombatStatsToBase.
    caster.refreshBaseCombatStats();
    previewAbility?.abilityEffects?.forEach((effect) => {
        const originalPierceChance = Number(effect?.pierceChance || 0);

        effect.stunChance = 0;
        effect.blindChance = 0;
        effect.silenceChance = 0;
        effect.pierceChance = originalPierceChance >= 1 - COMBAT_PREVIEW_EPSILON ? 1 : 0;
    });

    try {
        return previewState.simulator.tryUseAbility(caster, previewAbility);
    } finally {
        CombatUtilities.processAttack = originalProcessAttack;
        CombatUtilities.processHeal = originalProcessHeal;
        CombatUtilities.processRevive = originalProcessRevive;
        previewState.simulator.checkParry = originalCheckParry;
        caster.combatDetails.combatStats.blaze = originalProcStats.blaze;
        caster.combatDetails.combatStats.bloom = originalProcStats.bloom;
        caster.combatDetails.combatStats.ripple = originalProcStats.ripple;
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

function applyPartyAuraBuffForPreview(previewState, previewAbility, sourcePlayer = null) {
    // Party preview is a static aura snapshot, so this helper applies only the
    // Buff effects. The caller reserves MP and cooldown state before calling
    // it; keeping those concerns separate avoids scheduling preview events.
    const caster = sourcePlayer || previewState?.player;
    const simulator = previewState?.simulator;
    if (!caster || !simulator || !previewAbility) {
        return false;
    }

    let applied = false;
    for (const abilityEffect of previewAbility.abilityEffects ?? []) {
        if (
            abilityEffect?.effectType !== "/ability_effect_types/buff" ||
            !Array.isArray(abilityEffect.buffs) ||
            abilityEffect.buffs.length === 0
        ) {
            continue;
        }

        simulator.processAbilityBuffEffect(caster, previewAbility, abilityEffect, { scheduleExpirationEvents: false });
        applied = true;
    }

    return applied;
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
        card.cooldownSeconds =
            Math.max(0, Number(cooldownReadyEvent.time || 0) - Number(simulator.simulationTime || 0)) / ONE_SECOND;
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
        enemies,
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
            changedStats,
        ),
        consumed: true,
    };
}

function abilityHasPreviewableBuffEffect(ability) {
    return Boolean(
        ability?.abilityEffects?.some(
            (effect) =>
                effect?.effectType === "/ability_effect_types/buff" &&
                (effect?.targetType === "self" || effect?.targetType === "allAllies"),
        ),
    );
}

function collectAbilityBuffUniqueHrids(ability) {
    const uniqueHrids = [];
    for (const abilityEffect of ability?.abilityEffects ?? []) {
        if (abilityEffect?.effectType !== "/ability_effect_types/buff") {
            continue;
        }
        for (const buff of abilityEffect?.buffs ?? []) {
            if (buff?.uniqueHrid) {
                uniqueHrids.push(buff.uniqueHrid);
            }
        }
    }
    return uniqueHrids;
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
        enemies,
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
    const source = buildCombatPreviewHighlightSource(
        "ability",
        `ability-${slotIndex + 1}-${abilityHrid}`,
        abilityHrid,
        abilityDetail?.name || abilityHrid,
        changedStats,
    );
    // Track which buffs this cast registered so the party-aura merge can drop
    // the source when a teammate's stronger cast now owns every one of them
    // (see buildCombatPreviewData). Without this, a hero's overridden aura
    // would still be attributed as if it were active.
    source.sourceBuffUniqueHrids = collectAbilityBuffUniqueHrids(previewAbility);
    return {
        source,
        used: true,
        shouldStop: false,
    };
}

function collectSequentialConsumableHighlightSources(
    previewState,
    consumableSpecs,
    consumedConsumableSlots,
    highlightedConsumableSourceKeys,
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

function buildPartyPreviewConsumableSpecs(playerConfig) {
    const drinkCards = (playerConfig?.drinks ?? [])
        .map((drinkHrid, slotIndex) => {
            const normalizedHrid = String(drinkHrid || "");
            if (!normalizedHrid) {
                return null;
            }

            return {
                slotIndex: slotIndex + 1,
                drinkHrid: normalizedHrid,
                drinkName: itemDetailIndex[normalizedHrid]?.name || normalizedHrid,
            };
        })
        .filter(Boolean);

    return buildCombatPreviewConsumableSpecs(playerConfig, drinkCards);
}

function replayPartyPreviewConsumables(previewState, playerConfig, consumableSpecs = null) {
    if (!previewState?.player || !previewState?.simulator || !playerConfig) {
        return [];
    }

    const resolvedConsumableSpecs = consumableSpecs || buildPartyPreviewConsumableSpecs(playerConfig);
    if (resolvedConsumableSpecs.length === 0) {
        return [];
    }

    const highlightSources = collectSequentialConsumableHighlightSources(
        previewState,
        resolvedConsumableSpecs,
        new Set(),
        new Set(),
    );

    // Consumable use queues cooldown events in the live simulator.  The party
    // preview is a time-zero snapshot, so retain the state changes but not
    // those future events (the next opening ability is evaluated immediately).
    previewState.simulator.eventQueue.clear();
    return highlightSources;
}

function replayPartyPreviewConsumablesForAllUnits(previewEntries) {
    if (!Array.isArray(previewEntries) || previewEntries.length === 0) {
        return;
    }

    let consumedSomething;
    do {
        consumedSomething = false;

        for (const entry of previewEntries) {
            const player = entry?.player;
            const simulator = entry?.simulator;
            if (!player || !simulator || player.combatDetails?.currentHitpoints <= 0) {
                continue;
            }

            const consumableSpecs = entry.consumableSpecs ?? [];
            const consumedConsumableSlots = entry.consumedConsumableSlots;
            for (const consumableSpec of consumableSpecs) {
                const consumableSlotKey = `${consumableSpec.sourceType}-${consumableSpec.slotIndex}`;
                if (consumedConsumableSlots?.has(consumableSlotKey)) {
                    continue;
                }

                const result = buildSequentialConsumablePreviewResult({ player, simulator }, consumableSpec);
                if (!result.consumed) {
                    continue;
                }

                consumedConsumableSlots?.add(consumableSlotKey);
                consumedSomething = true;
            }
        }

        // The static preview retains immediate state changes from consumables,
        // but never advances their cooldown or expiration events.
        previewEntries[0]?.simulator?.eventQueue.clear();
    } while (consumedSomething);
}

function reservePartyPreviewAbilityUse(simulator, source, ability) {
    // Reserve a party-preview cast by checking MP affordability WITHOUT
    // spending it.  The cost is committed by commitPartyPreviewAbilityUse only
    // after the caller confirms the ability's effects were applied, so a cast
    // that contributes no effect (applyPartyAuraBuffForPreview returning
    // false) does not leak MP out of the preview's resource state.  This is
    // defensive ordering: the module-load snapshot validation
    // (assertPartyAuraSnapshotMatchesOfficialData) already guarantees the five
    // party aura abilities carry well-formed buff effects today, but a future
    // data change beyond that scope should fail without corrupting MP first.
    return Boolean(simulator && source && ability && simulator.canUseAbility(source, ability, false));
}

function commitPartyPreviewAbilityUse(simulator, source, ability) {
    // Commit the MP cost of a confirmed preview cast.  Mirrors the live
    // engine's spendAbilityMana bookkeeping (MP, lastUsed, cumulative cost)
    // and resets the out-of-mana flag like addNextAttackEvent's
    // successful-cast path.
    simulator.spendAbilityMana(source, ability);
    source.isOutOfMana = false;
}

function runPartyPreviewAbilityUse(previewState, ability, sourcePlayer) {
    const simulator = previewState?.simulator;
    const source = sourcePlayer || previewState?.player;
    if (!simulator || !source || !ability || !reservePartyPreviewAbilityUse(simulator, source, ability)) {
        return false;
    }

    // Opening replay only needs effects that can change a later trigger or an
    // ally's displayed stats.  Damage is intentionally omitted: applying it
    // would make the shared preview encounter state depend on which teammate
    // happened to be replayed first.  Buff/heal/spend-hp effects retain the
    // relevant live state transitions.
    for (const abilityEffect of ability.abilityEffects ?? []) {
        switch (abilityEffect?.effectType) {
            case "/ability_effect_types/buff":
                simulator.processAbilityBuffEffect(source, ability, abilityEffect, { scheduleExpirationEvents: false });
                break;
            case "/ability_effect_types/heal":
                simulator.processAbilityHealEffect(source, ability, abilityEffect);
                break;
            case "/ability_effect_types/spend_hp":
                simulator.processAbilitySpendHpEffect(source, ability, abilityEffect);
                break;
            default:
                // Damage, revive, and promote effects resolve after the cast
                // event in the real engine and do not affect this static
                // opening resource/trigger replay.
                break;
        }
    }

    // The cast is confirmed (the effects loop ran without failure), so commit
    // the MP cost reserved above.
    commitPartyPreviewAbilityUse(simulator, source, ability);
    return true;
}

function buildCombatPreviewUnitStateKey(unit) {
    if (!unit) {
        return "";
    }

    const combatBuffKey = Object.values(unit.combatBuffs ?? {})
        .map((buff) =>
            [
                String(buff?.uniqueHrid || ""),
                Number(buff?.startTime || 0),
                Number(buff?.duration || 0),
                Number(buff?.ratioBoost || 0),
                Number(buff?.flatBoost || 0),
            ].join(":"),
        )
        .sort()
        .join("|");
    const consumableKey = (collection) =>
        Array.isArray(collection)
            ? collection
                  .map((consumable) =>
                      consumable ? `${String(consumable.hrid || "")}:${Number(consumable.lastUsed || 0)}` : "",
                  )
                  .join("|")
            : "";
    const abilityKey = Array.isArray(unit.abilities)
        ? unit.abilities
              .map((ability) => (ability ? `${String(ability.hrid || "")}:${Number(ability.lastUsed || 0)}` : ""))
              .join("|")
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

    return [buildCombatPreviewUnitStateKey(previewState?.player), enemyKey].join("@@@");
}

function applyTaskBadgePreviewSource(playerConfig, previewPlayer) {
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

    if (!previewPlayer?.combatDetails?.combatStats) {
        return null;
    }

    const baseTaskDamage = Number(taskDamageSpec.getValue(previewPlayer));
    previewPlayer.combatDetails.combatStats.taskDamage = baseTaskDamage + taskDamage;
    // Fold the badge delta into the baseline: this preview player is a
    // snapshot consumer, but any later updateCombatDetails would otherwise
    // discard the write via resetCombatStatsToBase.
    previewPlayer.refreshBaseCombatStats();

    return buildCombatPreviewHighlightSource(
        "task_badge",
        `task-badge-${itemHrid}-${enhancementLevel}`,
        itemHrid,
        itemDetail?.name || itemHrid,
        [
            {
                key: taskDamageSpec.key,
                labelKey: getCombatPreviewOfficialLabelKey(taskDamageSpec.statNameKey),
                fallbackLabel: taskDamageSpec.fallbackLabel,
                format: taskDamageSpec.format,
                deltaValue: taskDamage,
                finalValue: baseTaskDamage + taskDamage,
            },
        ],
    );
}

// Mutates previewPlayer.permanentBuffs irreversibly: each guild buff is
// accumulated onto the player via addPermanentBuff so that every snapshot
// captures the marginal increment over the previously-applied state.
// Callers MUST pass a single-use (disposable) player object whose
// permanentBuffs do not need to stay pristine after this call.
function buildGuildBuffPreviewSources(playerConfig, previewPlayer) {
    if (!previewPlayer) {
        return [];
    }

    const guildBuffLevels = normalizeGuildBuffLevels(playerConfig?.guildBuffs);
    const highlightSources = [];

    for (const detail of combatGuildBuffDetails) {
        const guildBuffHrid = String(detail?.hrid || "");
        const level = Number(guildBuffLevels[guildBuffHrid] || 0);
        if (!guildBuffHrid || level <= 0) {
            continue;
        }

        const beforeValues = snapshotCombatPreviewStatValues(previewPlayer);
        const guildBuff = new GuildBuff(guildBuffHrid, level);
        for (const buff of guildBuff.buffs) {
            previewPlayer.addPermanentBuff(structuredClone(buff));
        }
        previewPlayer.clearBuffs();

        const changedStats = collectCombatPreviewChangedStatsFromSnapshot(beforeValues, previewPlayer);
        if (changedStats.length <= 0) {
            continue;
        }

        const shrineHrid = String(detail.shrineHrid || "");
        highlightSources.push(
            buildCombatPreviewHighlightSource(
                "guild_buff",
                `guild-buff-${guildBuffHrid}`,
                shrineHrid,
                guildShrineDetailIndex[shrineHrid]?.name || shrineHrid,
                changedStats,
            ),
        );
    }

    return highlightSources;
}

function buildCombatScrollPreviewSources(playerConfig, previewPlayer, previewExtra = null, previewEnvironment = null) {
    if (previewEnvironment?.scrollsAllowed === false) {
        return [];
    }
    if (previewExtra?.combatScrollsEnabled !== true) {
        return [];
    }

    const configuredScrolls = normalizeCombatScrolls(playerConfig?.combatScrolls);
    const itemHrids = Object.keys(configuredScrolls);
    if (itemHrids.length <= 0) {
        return [];
    }

    if (!previewPlayer?.combatBuffs || typeof previewPlayer.combatBuffs !== "object") {
        return [];
    }

    // Apply scrolls in configured order so every delta is the marginal change
    // from the state that the next preview source actually receives.
    const highlightSources = [];

    for (const itemHrid of itemHrids) {
        const buff = createCombatScrollBuff(itemHrid);
        if (!buff) {
            continue;
        }

        const beforeValues = snapshotCombatPreviewStatValues(previewPlayer);
        previewPlayer.addBuff(buff, 0, getCombatScrollSourceKey(itemHrid));
        const changedStats = collectCombatPreviewChangedStatsFromSnapshot(beforeValues, previewPlayer);
        if (changedStats.length > 0) {
            highlightSources.push(
                buildCombatPreviewHighlightSource(
                    "combat_scroll",
                    `combat-scroll-${itemHrid}`,
                    itemHrid,
                    itemDetailIndex[itemHrid]?.name || itemHrid,
                    changedStats,
                ),
            );
        }
    }

    return highlightSources;
}

// Party members whose selected configs include aura abilities affect every
// alive ally (including the hero), and the engine keeps only the strongest
// source of each aura buff. The preview replays the time-zero consumable pass
// and the live ability-slot selection/resource gate for teammates. It advances
// only the required cast-end ordering; regeneration, damage, and expiration
// events remain outside this static opening snapshot. The hero's own abilities
// remain owned by the conditional preview.

const PARTY_AURA_PREVIEW_CACHE_LIMIT = 8;
const partyAuraPreviewCache = new Map();

// Deterministically reduce the advanced-state fields that can influence
// party-aura strength to serializable scalars. Raw config objects may carry
// transient or non-JSON-serializable fields (functions, Vue reactivity proxy
// internals, ...); JSON.stringify would silently drop those, making an
// otherwise-relevant edit invisible to the preview cache. Keeping only the
// effect-determining scalars makes the key both stable and cache-correct.
function sortObjectEntries(entries) {
    return [...entries].sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)));
}

function normalizePartyAuraLevelMap(raw, normalizeKnownMap) {
    const source = raw && typeof raw === "object" ? raw : {};
    if (Array.isArray(source)) {
        // Legacy array forms ([hrid, level] or {hrid, level}) are accepted by
        // Player.createFromDTO; convert them to the same map shape first.
        return Object.fromEntries(
            source
                .map((entry) =>
                    Array.isArray(entry)
                        ? [String(entry[0] ?? ""), Number(entry[1] ?? 0)]
                        : [String(entry?.hrid ?? ""), Number(entry?.level ?? 0)],
                )
                .filter(([hrid]) => hrid),
        );
    }
    return normalizeKnownMap(source);
}

function normalizePartyAuraAchievements(achievements) {
    const source = achievements && typeof achievements === "object" ? achievements : {};
    if (Array.isArray(source.buffs)) {
        // createFromDTO round-trip form: explicit buff records. Sort both the
        // buff entries and the buff list; permanent-buff accumulation is
        // commutative, so ordering cannot change the resulting stats.
        return {
            buffs: source.buffs
                .map((buff) => sortObjectEntries(Object.entries(buff ?? {})))
                .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        };
    }
    return {
        unlocked: Object.entries(source)
            .filter(([, value]) => Boolean(value))
            .map(([hrid]) => String(hrid))
            .sort(),
    };
}

const normalizePartyAuraZoneBuffs = (zoneBuffs) =>
    Array.isArray(zoneBuffs)
        ? zoneBuffs
              .map((buff) => sortObjectEntries(Object.entries(buff ?? {})))
              .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
        : [];

function buildPartyAuraPreviewConfigSignature(config) {
    const safeConfig = config && typeof config === "object" ? config : {};
    return {
        id: String(safeConfig.id || ""),
        name: String(safeConfig.name || ""),
        selected: Boolean(safeConfig.selected),
        levels: LEVEL_KEYS.map((key) => Number(safeConfig.levels?.[key] ?? 1)),
        equipment: EQUIPMENT_SLOT_KEYS.map((slot) => [
            slot,
            String(safeConfig.equipment?.[slot]?.itemHrid || ""),
            normalizeEnhancementLevel(safeConfig.equipment?.[slot]?.enhancementLevel ?? 0),
        ]),
        food: Array.from({ length: 3 }, (_, index) => String(safeConfig.food?.[index] || "")),
        drinks: Array.from({ length: 3 }, (_, index) => String(safeConfig.drinks?.[index] || "")),
        abilities: Array.from({ length: 5 }, (_, index) => {
            const ability = safeConfig.abilities?.[index] ?? {};
            return [String(ability.abilityHrid || ""), Number(ability.level ?? 1)];
        }),
        triggerMap: sanitizeTriggerMap(safeConfig.triggerMap ?? {}),
        houseRooms: normalizePartyAuraLevelMap(safeConfig.houseRooms, normalizeHouseRoomLevels),
        guildBuffs: normalizePartyAuraLevelMap(safeConfig.guildBuffs, normalizeGuildBuffLevels),
        achievements: normalizePartyAuraAchievements(safeConfig.achievements),
        combatScrolls: normalizeCombatScrolls(safeConfig.combatScrolls),
    };
}

function buildPartyAuraPreviewCacheKey(playerConfig, teammates, previewExtra, previewContext, previewEnvironment) {
    return JSON.stringify({
        // The cache is module-scoped, so include the generated data version to
        // prevent stale results after a game-data rebuild or hot reload.
        dataVersion: GAME_DATA_VERSION,
        hero: buildPartyAuraPreviewConfigSignature(playerConfig),
        teammates: teammates.map(buildPartyAuraPreviewConfigSignature),
        extra: normalizeCombatPreviewExtra(previewExtra),
        context: normalizeCombatPreviewContext(previewContext),
        environment: {
            scrollsAllowed: previewEnvironment?.scrollsAllowed !== false,
            zoneBuffs: normalizePartyAuraZoneBuffs(previewEnvironment?.zoneBuffs),
        },
    });
}

function buildPartyAuraPreviewHighlightSource(caster, ability, hero, beforeValues, teammateNameByHrid) {
    const changedStats = collectCombatPreviewChangedStatsFromSnapshot(beforeValues, hero);
    if (changedStats.length <= 0) {
        return null;
    }

    const abilityName = abilityDetailIndex?.[ability.hrid]?.name || ability.hrid;
    const teammateName = teammateNameByHrid.get(caster.hrid) || caster.hrid;
    const sourceBuffUniqueHrids = collectAbilityBuffUniqueHrids(ability);

    const highlightSource = buildCombatPreviewHighlightSource(
        "ability",
        `teammate-aura-${caster.hrid}-${ability.hrid}`,
        ability.hrid,
        `${teammateName} · ${abilityName}`,
        changedStats,
    );
    highlightSource.contributorHrid = caster.hrid;
    highlightSource.sourceBuffUniqueHrids = sourceBuffUniqueHrids;
    return highlightSource;
}

function selectPartyPreviewAbilityEvent(simulator, player, currentTime, sequence) {
    if (!simulator || !player || player.combatDetails?.currentHitpoints <= 0) {
        return null;
    }

    simulator.simulationTime = currentTime;
    const { friendlies, enemies, target } = getCombatPreviewUnitContext({ player, simulator });
    let skipNextAbility = false;

    for (const ability of player.abilities ?? []) {
        if (!ability || skipNextAbility) {
            continue;
        }
        const triggerState = ability.shouldTrigger(currentTime, player, target, friendlies, enemies);
        if (!triggerState) {
            continue;
        }

        const usable = simulator.canUseAbility(player, ability, false);

        // Match CombatSimulator.addNextAttackEvent: once the first
        // triggerable slot cannot pay its MP cost, later slots are skipped.
        if (!usable) {
            skipNextAbility = true;
            continue;
        }

        const castDuration =
            Number(ability.castDuration || 0) / (1 + Number(player.combatDetails?.combatStats?.castSpeed || 0));
        return {
            source: player,
            ability,
            time: currentTime + castDuration,
            sequence,
        };
    }

    return null;
}

function insertPartyPreviewAbilityEvent(events, event) {
    if (!event) {
        return;
    }

    events.push(event);
    events.sort((left, right) => left.time - right.time || left.sequence - right.sequence);
}

function replayPartyPreviewAbilities(
    simulator,
    teamPlayers,
    previewEntries,
    hero,
    teammateNameByHrid,
    highlightSources,
) {
    const pendingEvents = [];
    let sequence = 0;
    const auraBeforeValuesByKey = new Map();

    // Schedule every teammate's first cast before resolving any cast. This is
    // the distinction from a serial preview: an aura that is already queued
    // remains valid even if an earlier cast changes its trigger state.
    teamPlayers.slice(1).forEach((player) => {
        insertPartyPreviewAbilityEvent(pendingEvents, selectPartyPreviewAbilityEvent(simulator, player, 0, sequence++));
    });

    const maxEvents = 512;
    let truncated = false;
    for (let processedEvents = 0; pendingEvents.length > 0 && processedEvents < maxEvents; processedEvents += 1) {
        const event = pendingEvents.shift();
        const sourcePlayer = event.source;
        simulator.simulationTime = event.time;

        const isPartyAura = PARTY_AURA_ABILITY_HRIDS.has(event.ability.hrid);
        const beforeValues = isPartyAura ? snapshotCombatPreviewStatValues(hero) : null;
        const previewState = { player: sourcePlayer, simulator };
        let used;
        if (isPartyAura) {
            used = false;
            if (reservePartyPreviewAbilityUse(simulator, sourcePlayer, event.ability)) {
                used = applyPartyAuraBuffForPreview(previewState, event.ability, sourcePlayer);
                if (used) {
                    // Only commit the MP cost once the aura's buff effects were
                    // actually applied; a no-op aura must not drain the caster.
                    commitPartyPreviewAbilityUse(simulator, sourcePlayer, event.ability);
                }
            }
        } else {
            used = runPartyPreviewAbilityUse(previewState, event.ability, sourcePlayer);
        }
        simulator.eventQueue.clear();

        if (!used) {
            // A cast-end event still reaches the simulator's post-event
            // checkTriggers even when the ability can no longer pay its MP.
            replayPartyPreviewConsumablesForAllUnits(previewEntries);
            continue;
        }

        if (isPartyAura && beforeValues) {
            // A teammate may cast the same aura multiple times (custom triggers
            // + cooldown ≤ 120s + long-cast abilities).  Only the first cast's
            // before-snapshot matters: the final source's delta is measured
            // from that snapshot to the hero's end-of-replay state, which
            // reflects the strongest active registration.  Retaining per-cast
            // sources would duplicate the same identifier in the panel and
            // double-count intermediate deltas.
            const key = `teammate-aura-${sourcePlayer.hrid}-${event.ability.hrid}`;
            if (!auraBeforeValuesByKey.has(key)) {
                auraBeforeValuesByKey.set(key, {
                    beforeValues,
                    caster: sourcePlayer,
                    ability: event.ability,
                });
            }
        }

        // tryUseAbility schedules the caster's next action before the engine's
        // post-event checkTriggers call. Preserve that ordering here.
        insertPartyPreviewAbilityEvent(
            pendingEvents,
            selectPartyPreviewAbilityEvent(simulator, sourcePlayer, simulator.simulationTime, sequence++),
        );

        // Every resolved event re-runs food/drink triggers for the whole team;
        // this is what lets a prior teammate aura activate a later teammate's
        // consumable without invalidating the latter's already queued cast.
        replayPartyPreviewConsumablesForAllUnits(previewEntries);
    }

    // The event budget exists only to bound worst-case trigger feedback loops
    // (e.g. a chain of consumables that repeatedly re-arms a teammate's aura).
    // A real party always converges: ability cooldowns and MP costs strictly
    // limit how many casts can fit in an opening window.  Hitting the cap is
    // therefore not a correctness failure (simulationTime is still reset below
    // and the cache stays valid), but it does mean the preview settled before
    // every teammate aura could be applied — surface it so consumers can warn
    // instead of silently showing a partial aura set.
    if (pendingEvents.length > 0) {
        truncated = true;
        console.warn(
            `[playerMapper] Party aura preview stopped after ${maxEvents} events with ${pendingEvents.length} still queued ` +
                `(simulationTime ${simulator.simulationTime}); preview may be incomplete for some teammate auras.`,
        );
    }

    // Build the aura highlight sources after the replay settled.  Each source
    // measures its delta from the FIRST cast's snapshot to the hero's final
    // state, so a teammate who recast the same aura (drink-strengthened)
    // contributes one source spanning the whole effective change instead of
    // one duplicate row per cast.
    for (const { beforeValues, caster, ability } of auraBeforeValuesByKey.values()) {
        const source = buildPartyAuraPreviewHighlightSource(caster, ability, hero, beforeValues, teammateNameByHrid);
        if (source) {
            highlightSources.push(source);
        }
    }

    simulator.simulationTime = 0;
    return truncated;
}

function setPartyAuraPreviewCache(cacheKey, result) {
    partyAuraPreviewCache.delete(cacheKey);
    partyAuraPreviewCache.set(cacheKey, result);
    while (partyAuraPreviewCache.size > PARTY_AURA_PREVIEW_CACHE_LIMIT) {
        partyAuraPreviewCache.delete(partyAuraPreviewCache.keys().next().value);
    }
}

function buildPartyAuraPreviewResult(
    playerConfig,
    partyPlayerConfigs,
    previewExtra = null,
    previewEnvironment = null,
    previewContext = null,
) {
    if (!playerConfig) {
        return null;
    }

    const heroId = String(playerConfig.id || "");
    const teammates = (partyPlayerConfigs ?? []).filter(
        (config) => config && config.selected && String(config.id || "") !== heroId,
    );
    if (teammates.length === 0) {
        return null;
    }

    const cacheKey = buildPartyAuraPreviewCacheKey(
        playerConfig,
        teammates,
        previewExtra,
        previewContext,
        previewEnvironment,
    );
    if (partyAuraPreviewCache.has(cacheKey)) {
        // Never hand out the stored objects: replay-generated Buff instances
        // (and the sourceBuffs/highlightSources containers) would otherwise be
        // shared across builds, and any consumer-side mutation would leak into
        // every later hit. Every exit point returns an isolated snapshot so the
        // stored entry stays authoritative.
        const cachedResult = partyAuraPreviewCache.get(cacheKey);
        return cachedResult === null ? null : structuredClone(cachedResult);
    }

    const resolvedPreviewEnvironment = previewEnvironment || buildCombatPreviewEnvironment();
    const heroConfig = { ...playerConfig, selected: true };
    const teamPlayers = buildPlayersForSimulation([heroConfig, ...teammates]);
    const hero = teamPlayers[0];
    if (!hero) {
        setPartyAuraPreviewCache(cacheKey, null);
        return null;
    }
    teamPlayers.forEach((player) => normalizePreviewPlayer(player, previewExtra, resolvedPreviewEnvironment));

    const teammateNameByHrid = new Map();
    teammates.forEach((config) => {
        teammateNameByHrid.set(`player${config.id}`, config.name || `Player ${config.id}`);
    });
    const teammateSourceKeys = new Set(teamPlayers.filter((player) => player !== hero).map((player) => player.hrid));

    const simulator = new CombatSimulator(teamPlayers, null, null, { enableHpMpVisualization: false });
    simulator.enemies = resolvedPreviewEnvironment.enemies;
    simulator.simulationTime = 0;

    const highlightSources = [];

    // Mirror the encounter opener: food/drink triggers run for every unit
    // before the first ability is selected.  The hero's conditional preview
    // has its own consumable attribution; this temporary pass exists only so
    // teammate trigger/resource state is evaluated against the full party.
    const openingConfigs = [heroConfig, ...teammates];
    const previewEntries = teamPlayers.map((player, index) => ({
        player,
        simulator,
        consumableSpecs: buildPartyPreviewConsumableSpecs(openingConfigs[index]),
        consumedConsumableSlots: new Set(),
    }));
    replayPartyPreviewConsumablesForAllUnits(previewEntries);
    const partyAuraPreviewTruncated = replayPartyPreviewAbilities(
        simulator,
        teamPlayers,
        previewEntries,
        hero,
        teammateNameByHrid,
        highlightSources,
    );

    // Preserve every teammate source, not only the currently strongest buff in
    // hero.combatBuffs.  The weaker entries are required if this preview state
    // is later reconciled after the strongest source expires.
    const sourceBuffs = [];
    for (const sources of Object.values(hero.buffSources)) {
        for (const [sourceKey, entry] of sources.entries()) {
            if (!isPartyAuraBuff(entry?.buff)) {
                continue;
            }
            // Official party-aura processing always registers the caster's
            // player hrid. Ignore malformed/default registrations rather than
            // inventing a synthetic source that cannot participate in source
            // attribution or strongest-source handoff.
            if (!teammateSourceKeys.has(sourceKey)) {
                continue;
            }

            sourceBuffs.push({
                buff: entry.buff,
                sourceHrid: sourceKey,
            });
        }
    }

    if (sourceBuffs.length === 0 && highlightSources.length === 0) {
        if (partyAuraPreviewTruncated) {
            // Truncation can still hide auras that would have appeared after
            // the event budget: report the partial state, not a silent null.
            const truncatedResult = {
                sourceBuffs,
                highlightSources,
                truncated: true,
            };
            setPartyAuraPreviewCache(cacheKey, truncatedResult);
            return structuredClone(truncatedResult);
        }
        setPartyAuraPreviewCache(cacheKey, null);
        return null;
    }

    const result = {
        sourceBuffs,
        highlightSources,
        // Consumers (e.g. the home page preview) use this to surface a warning
        // that the party aura replay hit its event budget and may be incomplete.
        truncated: partyAuraPreviewTruncated,
    };
    setPartyAuraPreviewCache(cacheKey, result);
    // Same snapshot rule as the cache-hit branch: the stored entry stays
    // authoritative, the returned object is caller-owned.
    return structuredClone(result);
}

function buildConditionalPreviewResult(
    playerConfig,
    previewExtra = null,
    drinkCards = [],
    previewEnvironment = null,
    partyPlayerConfigs = null,
) {
    const previewState = createCombatPreviewSimulationState(
        playerConfig,
        previewExtra,
        previewEnvironment,
        partyPlayerConfigs,
    );
    const highlightSources = [];

    if (previewState) {
        const consumableSpecs = buildCombatPreviewConsumableSpecs(playerConfig, drinkCards);
        const consumedConsumableSlots = new Set();
        const highlightedConsumableSourceKeys = new Set();
        const seenCycleStateKeys = new Set();
        const abilitySlotCount = playerConfig?.abilities?.length ?? 0;

        highlightSources.push(
            ...collectSequentialConsumableHighlightSources(
                previewState,
                consumableSpecs,
                consumedConsumableSlots,
                highlightedConsumableSourceKeys,
            ),
        );

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
                highlightSources.push(
                    ...collectSequentialConsumableHighlightSources(
                        previewState,
                        consumableSpecs,
                        consumedConsumableSlots,
                        highlightedConsumableSourceKeys,
                    ),
                );
                break;
            }

            if (shouldStop || !usedAbilityThisCycle) {
                break;
            }
        }
    }

    const taskBadgeSource = applyTaskBadgePreviewSource(playerConfig, previewState?.player);
    if (taskBadgeSource) {
        highlightSources.push(taskBadgeSource);
    }

    return {
        player: previewState?.player ?? null,
        highlightSources,
    };
}

function buildStaticCombatPreviewAttribution(playerConfig, previewExtra, previewEnvironment) {
    const baselineConfig = {
        ...playerConfig,
        guildBuffs: normalizeGuildBuffLevels({}),
    };
    const baselineExtra = {
        ...(previewExtra ?? {}),
        combatScrollsEnabled: false,
    };
    const attributionPlayer = buildSingleCombatPreviewPlayer(baselineConfig, baselineExtra, previewEnvironment);
    if (!attributionPlayer) {
        return {
            baseValues: new Map(),
            highlightSources: [],
        };
    }

    const baseValues = snapshotCombatPreviewStatValues(attributionPlayer);
    const highlightSources = buildGuildBuffPreviewSources(playerConfig, attributionPlayer);
    highlightSources.push(
        ...buildCombatScrollPreviewSources(playerConfig, attributionPlayer, previewExtra, previewEnvironment),
    );

    return {
        baseValues,
        highlightSources,
    };
}

export function buildPlayersForSimulation(playerConfigs) {
    const selectedPlayers = (playerConfigs ?? []).filter((player) => player.selected);
    const simulationPlayers = selectedPlayers.map((player) => buildSimulationPlayerFromConfig(player));

    applyDebuffOnLevelGap(simulationPlayers);

    return simulationPlayers;
}

export function buildPlayersForCombatPreview(playerConfigs, previewExtra = null, previewContext = null) {
    const normalizedExtra = normalizeCombatPreviewExtra(previewExtra);
    const previewEnvironment = buildCombatPreviewEnvironment(previewContext);
    const simulationPlayers = buildPlayersForSimulation(playerConfigs);
    simulationPlayers.forEach((player) => normalizePreviewPlayer(player, normalizedExtra, previewEnvironment));

    return simulationPlayers;
}

// Performance note: buildCombatPreviewData constructs up to three independent
// Player objects per invocation:
//   1. `player` below — the full configured player (with guild buffs + scrolls).
//   2. `attributionPlayer` inside buildStaticCombatPreviewAttribution — a
//      baseline player built from a config with guildBuffs disabled and scrolls
//      disabled, so each guild buff / scroll delta can be measured as a
//      marginal increment. This baseline cannot reuse `player` because their
//      permanentBuffs differ (player's include guild buffs).
//   3. `previewState.player` inside buildConditionalPreviewResult — drives the
//      sequential consumable/ability simulation and must be a fresh instance
//      because the simulation mutates combat state (HP/MP, buff timers, ...).
//   4. `buildPartyAuraPreviewResult` builds a temporary team and simulator on
//      cache misses. Its derived source/highlight result is cached by relevant
//      config fields, so in-place edits to unrelated player fields do not
//      rebuild the party path. The cache is bounded and never retains runtime
//      Player or CombatSimulator instances.
// In addition, buildGuildBuffPreviewSources / buildCombatScrollPreviewSources
// each perform a full STAT_SPECS snapshot + addPermanentBuff/clearBuffs
// (updateCombatDetails) + diff pass per active buff, so 5 shrines cost ~10
// full-spec traversals.
// This function is consumed by a Vue `computed` (see HomePage.vue
// `combatPreviewData`), so it only re-runs when its reactive dependencies
// change. For very frequent config editing the cost is acceptable but not free;
// if profiling shows hotspots, prefer debouncing the upstream config edits over
// micro-optimizing the player construction here.
export function buildCombatPreviewData(playerConfig, previewExtra = null, previewContext = null, options = null) {
    const normalizedExtra = normalizeCombatPreviewExtra(previewExtra);
    const previewEnvironment = buildCombatPreviewEnvironment(previewContext);
    const player = buildSingleCombatPreviewPlayer(playerConfig, normalizedExtra, previewEnvironment);
    const drinkCards = (playerConfig?.drinks ?? [])
        .map((_, slotIndex) => buildDrinkPreviewCard(playerConfig, slotIndex, normalizedExtra, previewEnvironment))
        .filter(Boolean);
    const attribution = buildStaticCombatPreviewAttribution(
        playerConfig,
        normalizedExtra,
        previewEnvironment,
        previewContext,
    );

    // Replay selected teammates against the untouched opening encounter. The
    // hero's conditional preview below may execute ordinary abilities, so
    // evaluating party triggers first prevents those deterministic preview
    // effects from changing the teammate trigger context.
    const partyAuraResult = buildPartyAuraPreviewResult(
        playerConfig,
        options?.partyPlayerConfigs ?? null,
        normalizedExtra,
        previewEnvironment,
        previewContext,
    );
    const conditionalPreview = buildConditionalPreviewResult(
        playerConfig,
        normalizedExtra,
        drinkCards,
        previewEnvironment,
        options?.partyPlayerConfigs ?? null,
    );
    const finalPlayer = conditionalPreview.player || player;
    const highlightSources = [...attribution.highlightSources, ...conditionalPreview.highlightSources];

    // Selected teammates' auras affect the hero in real fights (allAllies +
    // strongest-source rule).  Replay those casts so the panel shows the same
    // final stats the party simulation would produce.
    if (partyAuraResult) {
        partyAuraResult.sourceBuffs.forEach(({ buff, sourceHrid }) => {
            if (finalPlayer) {
                finalPlayer.addBuff(buff, 0, sourceHrid, { sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST });
            }
        });
        // Collect the set of teammate source keys registered on finalPlayer.
        const teammateSourceKeys = new Set(partyAuraResult.sourceBuffs.map(({ sourceHrid }) => sourceHrid));
        // A uniqueHrid is "party-owned" when the active source key belongs to
        // a teammate, meaning the hero's own registration was overridden.
        const isPartyOwned = (uniqueHrid) => {
            const activeKey = finalPlayer.activeBuffSourceKeys?.[uniqueHrid];
            return Boolean(activeKey) && teammateSourceKeys.has(activeKey);
        };
        // Drop conditional ability sources whose buffs are all owned by a
        // teammate in the final state.  Their deltas were measured against a
        // state where the hero's own weaker cast was still active, so they are
        // phantom — only the teammate's stronger cast is now visible.
        if (finalPlayer) {
            for (let i = highlightSources.length - 1; i >= 0; i--) {
                const source = highlightSources[i];
                const uniqueHrids = source.sourceBuffUniqueHrids ?? [];
                if (uniqueHrids.length > 0 && uniqueHrids.every((uniqueHrid) => isPartyOwned(uniqueHrid))) {
                    highlightSources.splice(i, 1);
                }
            }
        }
        // Attribute teammate aura sources by which buff they actually own in
        // the final state (strongest-source rule) instead of by changed-stat
        // key.  A weaker cast that was later overridden by a stronger teammate
        // or by the hero's own buff contributed no final change and must not
        // be shown as a source, even though it stays registered in
        // finalPlayer.buffSources so the strongest source can hand off when it
        // expires.
        highlightSources.push(
            ...partyAuraResult.highlightSources.filter((source) => {
                const contributorHrid = source.contributorHrid;
                return (source.sourceBuffUniqueHrids ?? []).some(
                    (uniqueHrid) => finalPlayer.activeBuffSourceKeys[uniqueHrid] === contributorHrid,
                );
            }),
        );
    }

    const statBreakdowns = buildCombatPreviewStatBreakdowns(attribution.baseValues, finalPlayer, highlightSources);

    return {
        player,
        finalPlayer,
        drinkCards,
        highlightSources,
        statBreakdowns,
        // True when the party aura replay consumed its full event budget before
        // every teammate cast could settle. Consumers may show a warning; the
        // rest of the preview remains valid. Undefined when no party was given.
        partyAuraPreviewTruncated: Boolean(partyAuraResult?.truncated),
    };
}

const COMBAT_PREVIEW_STAT_SPEC_KEYS = COMBAT_PREVIEW_STAT_SPECS.map((spec) => spec.key);

export {
    calcCombatLevel,
    COMBAT_PREVIEW_STAT_SPEC_KEYS,
    createEmptyPlayerConfig,
    createEmptySkillExperienceMap,
    EQUIPMENT_SLOT_KEYS,
    isPartyAuraBuff,
    LEVEL_KEYS,
};
