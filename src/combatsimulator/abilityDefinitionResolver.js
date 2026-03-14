import abilityDetailMap from "./data/abilityDetailMap.json";

const SUPPLEMENTAL_ABILITY_ALIAS_MAP = Object.freeze({
    blaze: "/abilities/blaze",
    bloom: "/abilities/bloom",
});

// These simulator-only abilities are derived from combat stats and are not
// part of the extracted official abilityDetailMap payload.
const supplementalAbilityDefinitionMap = Object.freeze({
    "/abilities/blaze": {
        hrid: "/abilities/blaze",
        name: "Blaze",
        description: "",
        isSpecialAbility: false,
        manaCost: 0,
        cooldownDuration: 0,
        castDuration: 0,
        abilityEffects: [
            {
                targetType: "allEnemies",
                effectType: "/ability_effect_types/damage",
                combatStyleHrid: "/combat_styles/magic",
                damageType: "/damage_types/fire",
                baseDamageFlat: 0,
                baseDamageFlatLevelBonus: 0.0,
                baseDamageRatio: 0.3,
                baseDamageRatioLevelBonus: 0,
                bonusAccuracyRatio: 0,
                bonusAccuracyRatioLevelBonus: 0,
                damageOverTimeRatio: 0,
                damageOverTimeDuration: 0,
                armorDamageRatio: 0,
                armorDamageRatioLevelBonus: 0,
                hpDrainRatio: 0,
                pierceChance: 0,
                blindChance: 0,
                blindDuration: 0,
                silenceChance: 0,
                silenceDuration: 0,
                stunChance: 0,
                stunDuration: 0,
                spendHpRatio: 0,
                buffs: null,
            },
        ],
        defaultCombatTriggers: [
            {
                dependencyHrid: "/combat_trigger_dependencies/all_enemies",
                conditionHrid: "/combat_trigger_conditions/number_of_active_units",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 1,
            },
            {
                dependencyHrid: "/combat_trigger_dependencies/all_enemies",
                conditionHrid: "/combat_trigger_conditions/current_hp",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 1,
            },
        ],
    },
    "/abilities/bloom": {
        hrid: "/abilities/bloom",
        name: "Bloom",
        description: "",
        isSpecialAbility: false,
        manaCost: 0,
        cooldownDuration: 0,
        castDuration: 0,
        abilityEffects: [
            {
                targetType: "lowestHpAlly",
                effectType: "/ability_effect_types/heal",
                combatStyleHrid: "/combat_styles/magic",
                damageType: "",
                baseDamageFlat: 10,
                baseDamageFlatLevelBonus: 0,
                baseDamageRatio: 0.15,
                baseDamageRatioLevelBonus: 0,
                bonusAccuracyRatio: 0,
                bonusAccuracyRatioLevelBonus: 0,
                damageOverTimeRatio: 0,
                damageOverTimeDuration: 0,
                armorDamageRatio: 0,
                armorDamageRatioLevelBonus: 0,
                hpDrainRatio: 0,
                pierceChance: 0,
                blindChance: 0,
                blindDuration: 0,
                silenceChance: 0,
                silenceDuration: 0,
                stunChance: 0,
                stunDuration: 0,
                spendHpRatio: 0,
                buffs: null,
            },
        ],
        defaultCombatTriggers: [
            {
                dependencyHrid: "/combat_trigger_dependencies/all_allies",
                conditionHrid: "/combat_trigger_conditions/lowest_hp_percentage",
                comparatorHrid: "/combat_trigger_comparators/less_than_equal",
                value: 100,
            },
        ],
    },
});

export function normalizeAbilityDefinitionHrid(hrid) {
    const rawHrid = String(hrid || "");
    return SUPPLEMENTAL_ABILITY_ALIAS_MAP[rawHrid] || rawHrid;
}

export function resolveAbilityDefinition(hrid) {
    const normalizedHrid = normalizeAbilityDefinitionHrid(hrid);
    if (!normalizedHrid) {
        return null;
    }

    return abilityDetailMap[normalizedHrid] || supplementalAbilityDefinitionMap[normalizedHrid] || null;
}

