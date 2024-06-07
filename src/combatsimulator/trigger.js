import combatTriggerDependencyDetailMap from "./data/combatTriggerDependencyDetailMap.json";

class Trigger {
    constructor(dependencyHrid, conditionHrid, comparatorHrid, value = 0) {
        this.dependencyHrid = dependencyHrid;
        this.conditionHrid = conditionHrid;
        this.comparatorHrid = comparatorHrid;
        this.value = value;
    }

    static createFromDTO(dto) {
        let trigger = new Trigger(dto.dependencyHrid, dto.conditionHrid, dto.comparatorHrid, dto.value);

        return trigger;
    }

    isActive(source, target, friendlies, enemies, currentTime) {
        if (combatTriggerDependencyDetailMap[this.dependencyHrid].isSingleTarget) {
            return this.isActiveSingleTarget(source, target, currentTime);
        } else {
            return this.isActiveMultiTarget(friendlies, enemies, currentTime);
        }
    }

    isActiveSingleTarget(source, target, currentTime) {
        let dependencyValue;
        switch (this.dependencyHrid) {
            case "/combat_trigger_dependencies/self":
                dependencyValue = this.getDependencyValue(source, currentTime);
                break;
            case "/combat_trigger_dependencies/targeted_enemy":
                if (!target) {
                    return false;
                }
                dependencyValue = this.getDependencyValue(target, currentTime);
                break;
            default:
                throw new Error("Unknown dependencyHrid in trigger: " + this.dependencyHrid);
        }

        return this.compareValue(dependencyValue);
    }

    isActiveMultiTarget(friendlies, enemies, currentTime) {
        let dependency;
        switch (this.dependencyHrid) {
            case "/combat_trigger_dependencies/all_allies":
                dependency = friendlies;
                break;
            case "/combat_trigger_dependencies/all_enemies":
                if (!enemies) {
                    return false;
                }
                dependency = enemies;
                break;
            default:
                throw new Error("Unknown dependencyHrid in trigger: " + this.dependencyHrid);
        }

        let dependencyValue;
        switch (this.conditionHrid) {
            case "/combat_trigger_conditions/number_of_active_units":
                dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints > 0).length;
                break;
            case "/combat_trigger_conditions/number_of_dead_units":
                dependencyValue = dependency.filter((unit) => unit.combatDetails.currentHitpoints <= 0).length;
                break;
            case "/combat_trigger_conditions/lowest_hp_percentage":
                dependencyValue = dependency.reduce((prev, curr) => {
                    let currentHpPercentage = curr.combatDetails.currentHitpoints / curr.combatDetails.maxHitpoints;
                    return currentHpPercentage < prev ? currentHpPercentage : prev;
                }, 2) * 100;
                break;
            default:
                dependencyValue = dependency
                    .map((unit) => this.getDependencyValue(unit, currentTime))
                    .reduce((prev, cur) => prev + cur, 0);
                break;
        }

        return this.compareValue(dependencyValue);
    }

    getDependencyValue(source, currentTime) {
        switch (this.conditionHrid) {
            case "/combat_trigger_conditions/berserk":
            case "/combat_trigger_conditions/elemental_affinity_fire_amplify":
            case "/combat_trigger_conditions/elemental_affinity_nature_amplify":
            case "/combat_trigger_conditions/elemental_affinity_water_amplify":
            case "/combat_trigger_conditions/frenzy":
            case "/combat_trigger_conditions/precision":
            case "/combat_trigger_conditions/spike_shell":
            case "/combat_trigger_conditions/toughness_armor":
            case "/combat_trigger_conditions/toughness_fire_resistance":
            case "/combat_trigger_conditions/toughness_nature_resistance":
            case "/combat_trigger_conditions/toughness_water_resistance":
            case "/combat_trigger_conditions/vampirism":
            case "/combat_trigger_conditions/attack_coffee":
            case "/combat_trigger_conditions/defense_coffee":
            case "/combat_trigger_conditions/intelligence_coffee_max_mp":
            case "/combat_trigger_conditions/intelligence_coffee_mp_regen":
            case "/combat_trigger_conditions/lucky_coffee":
            case "/combat_trigger_conditions/magic_coffee":
            case "/combat_trigger_conditions/power_coffee":
            case "/combat_trigger_conditions/ranged_coffee":
            case "/combat_trigger_conditions/stamina_coffee_hp_regen":
            case "/combat_trigger_conditions/stamina_coffee_max_hp":
            case "/combat_trigger_conditions/swiftness_coffee":
            case "/combat_trigger_conditions/critical_coffee_damage":
            case "/combat_trigger_conditions/critical_coffee_rate":
            case "/combat_trigger_conditions/wisdom_coffee":
            case "/combat_trigger_conditions/ice_spear":
            case "/combat_trigger_conditions/toxic_pollen_armor":
            case "/combat_trigger_conditions/toxic_pollen_fire_resistance":
            case "/combat_trigger_conditions/toxic_pollen_nature_resistance":
            case "/combat_trigger_conditions/toxic_pollen_water_resistance":
            case "/combat_trigger_conditions/puncture":
            case "/combat_trigger_conditions/frost_surge":
            case "/combat_trigger_conditions/elusiveness":
            case "/combat_trigger_conditions/channeling_coffee":
            case "/combat_trigger_conditions/aqua_aura_water_amplify":
            case "/combat_trigger_conditions/aqua_aura_water_resistance":
            case "/combat_trigger_conditions/critical_aura":
            case "/combat_trigger_conditions/fierce_aura_armor":
            case "/combat_trigger_conditions/fierce_aura_physical_amplify":
            case "/combat_trigger_conditions/flame_aura_fire_amplify":
            case "/combat_trigger_conditions/flame_aura_fire_resistance":
            case "/combat_trigger_conditions/insanity_attack_speed":
            case "/combat_trigger_conditions/insanity_cast_speed":
            case "/combat_trigger_conditions/insanity_damage":
            case "/combat_trigger_conditions/invincible_armor":
            case "/combat_trigger_conditions/invincible_fire_resistance":
            case "/combat_trigger_conditions/invincible_nature_resistance":
            case "/combat_trigger_conditions/invincible_water_resistance":
            case "/combat_trigger_conditions/provoke":
            case "/combat_trigger_conditions/speed_aura_attack_speed":
            case "/combat_trigger_conditions/speed_aura_cast_speed":
            case "/combat_trigger_conditions/sylvan_aura_healing_amplify":
            case "/combat_trigger_conditions/sylvan_aura_nature_amplify":
            case "/combat_trigger_conditions/sylvan_aura_nature_resistance":
            case "/combat_trigger_conditions/taunt":
            case "/combat_trigger_conditions/crippling_slash":
            case "/combat_trigger_conditions/mana_spring":
            case "/combat_trigger_conditions/pestilent_shot_hp_regen":
            case "/combat_trigger_conditions/pestilent_shot_mp_regen":
            case "/combat_trigger_conditions/smoke_burst":
                let buffHrid = "/buff_uniques";
                buffHrid += this.conditionHrid.slice(this.conditionHrid.lastIndexOf("/"));
                return source.combatBuffs[buffHrid];
            case "/combat_trigger_conditions/current_hp":
                return source.combatDetails.currentHitpoints;
            case "/combat_trigger_conditions/current_mp":
                return source.combatDetails.currentManapoints;
            case "/combat_trigger_conditions/missing_hp":
                return source.combatDetails.maxHitpoints - source.combatDetails.currentHitpoints;
            case "/combat_trigger_conditions/missing_mp":
                return source.combatDetails.maxManapoints - source.combatDetails.currentManapoints;
            case "/combat_trigger_conditions/stun_status":
                // Replicate the game's behaviour of "stun status active" triggers activating
                // immediately after the stun has worn off
                return source.isStunned || source.stunExpireTime == currentTime;
            case "/combat_trigger_conditions/blind_status":
                return source.isBlinded || source.blindExpireTime == currentTime;
            case "/combat_trigger_conditions/silence_status":
                return source.isSilenced || source.silenceExpireTime == currentTime;
            case "/combat_trigger_conditions/curse":
                return source.combatDetails.combatStats.damageTaken > 0 || source.curseExpireTime == currentTime;
            default:
                throw new Error("Unknown conditionHrid in trigger: " + this.conditionHrid);
        }
    }

    compareValue(dependencyValue) {
        switch (this.comparatorHrid) {
            case "/combat_trigger_comparators/greater_than_equal":
                return dependencyValue >= this.value;
            case "/combat_trigger_comparators/less_than_equal":
                return dependencyValue <= this.value;
            case "/combat_trigger_comparators/is_active":
                return !!dependencyValue;
            case "/combat_trigger_comparators/is_inactive":
                return !dependencyValue;
            default:
                throw new Error("Unknown comparatorHrid in trigger: " + this.comparatorHrid);
        }
    }
}

export default Trigger;
