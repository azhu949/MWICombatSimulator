import CombatUtilities from "./combatUtilities";
import AutoAttackEvent from "./events/autoAttackEvent";
import DamageOverTimeEvent from "./events/damageOverTimeEvent";
import CheckBuffExpirationEvent from "./events/checkBuffExpirationEvent";
import CombatStartEvent from "./events/combatStartEvent";
import ConsumableTickEvent from "./events/consumableTickEvent";
import CooldownReadyEvent from "./events/cooldownReadyEvent";
import EnemyRespawnEvent from "./events/enemyRespawnEvent";
import EventQueue from "./events/eventQueue";
import PlayerRespawnEvent from "./events/playerRespawnEvent";
import RegenTickEvent from "./events/regenTickEvent";
import StunExpirationEvent from "./events/stunExpirationEvent";
import BlindExpirationEvent from "./events/blindExpirationEvent";
import SilenceExpirationEvent from "./events/silenceExpirationEvent";
import CurseExpirationEvent from "./events/curseExpirationEvent";
import SimResult from "./simResult";
import AbilityCastEndEvent from "./events/abilityCastEndEvent";
import AwaitCooldownEvent from "./events/awaitCooldownEvent";

const ONE_SECOND = 1e9;
const HOT_TICK_INTERVAL = 5 * ONE_SECOND;
const DOT_TICK_INTERVAL = 5 * ONE_SECOND;
const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;
const ENEMY_RESPAWN_INTERVAL = 3 * ONE_SECOND;
const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;

class CombatSimulator extends EventTarget {
    constructor(player, zone) {
        super();
        this.players = [player];
        this.zone = zone;

        this.eventQueue = new EventQueue();
        this.simResult = new SimResult();
    }

    async simulate(simulationTimeLimit) {
        this.reset();

        let ticks = 0;

        let combatStartEvent = new CombatStartEvent(0);
        this.eventQueue.addEvent(combatStartEvent);

        while (this.simulationTime < simulationTimeLimit) {
            let nextEvent = this.eventQueue.getNextEvent();
            await this.processEvent(nextEvent);

            ticks++;
            if (ticks == 1000) {
                ticks = 0;
                let progressEvent = new CustomEvent("progress", {
                    detail: Math.min(this.simulationTime / simulationTimeLimit, 1),
                });
                this.dispatchEvent(progressEvent);
            }
        }

        for (let i = 0; i < this.simResult.timeSpentAlive.length; i++) {
            if (this.simResult.timeSpentAlive[i].alive == true) {
                this.simResult.updateTimeSpentAlive(this.simResult.timeSpentAlive[i].name, false, simulationTimeLimit);
            }
        }

        this.simResult.simulatedTime = this.simulationTime;
        this.simResult.setDropRateMultipliers(this.players[0]);
        this.simResult.setManaUsed(this.players[0]);

        if (this.zone.monsterSpawnInfo.bossSpawns) {
            for (const boss of this.zone.monsterSpawnInfo.bossSpawns) {
                this.simResult.bossSpawns.push(boss.combatMonsterHrid);
            }
        }

        this.simResult.eliteTier = this.zone.monsterSpawnInfo.randomSpawnInfo.spawns[0].eliteTier;

        return this.simResult;
    }

    reset() {
        this.simulationTime = 0;
        this.eventQueue.clear();
        this.simResult = new SimResult();
    }

    async processEvent(event) {
        this.simulationTime = event.time;

        // console.log(this.simulationTime / 1e9, event.type, event);

        switch (event.type) {
            case CombatStartEvent.type:
                this.processCombatStartEvent(event);
                break;
            case PlayerRespawnEvent.type:
                this.processPlayerRespawnEvent(event);
                break;
            case EnemyRespawnEvent.type:
                this.processEnemyRespawnEvent(event);
                break;
            case AutoAttackEvent.type:
                this.processAutoAttackEvent(event);
                break;
            case ConsumableTickEvent.type:
                this.processConsumableTickEvent(event);
                break;
            case DamageOverTimeEvent.type:
                this.processDamageOverTimeTickEvent(event);
                break;
            case CheckBuffExpirationEvent.type:
                this.processCheckBuffExpirationEvent(event);
                break;
            case RegenTickEvent.type:
                this.processRegenTickEvent(event);
                break;
            case StunExpirationEvent.type:
                this.processStunExpirationEvent(event);
                break;
            case BlindExpirationEvent.type:
                this.processBlindExpirationEvent(event);
                break;
            case SilenceExpirationEvent.type:
                this.processSilenceExpirationEvent(event);
                break;
            case CurseExpirationEvent.type:
                this.processCurseExpirationEvent(event);
                break;
            case AbilityCastEndEvent.type:
                this.tryUseAbility(event.source, event.ability);
                break;
            case AwaitCooldownEvent.type:
                // console.log("Await CD " + (this.simulationTime / 1000000000));
                this.addNextAttackEvent(event.source);
                break;
            case CooldownReadyEvent.type:
                // Only used to check triggers
                break;
        }

        this.checkTriggers();
    }

    processCombatStartEvent(event) {
        this.players[0].generatePermanentBuffs();
        this.players[0].reset(this.simulationTime);
        let regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);
        this.eventQueue.addEvent(regenTickEvent);

        this.startNewEncounter();
    }

    processPlayerRespawnEvent(event) {
        this.players[0].combatDetails.currentHitpoints = this.players[0].combatDetails.maxHitpoints;
        this.players[0].combatDetails.currentManapoints = this.players[0].combatDetails.maxManapoints;
        this.players[0].clearBuffs();
        this.players[0].clearCCs();
        this.startAttacks();
    }

    processEnemyRespawnEvent(event) {
        this.startNewEncounter();
    }

    startNewEncounter() {
        this.enemies = this.zone.getRandomEncounter();

        this.enemies.forEach((enemy) => {
            enemy.reset(this.simulationTime);
            this.simResult.updateTimeSpentAlive(enemy.hrid, true, this.simulationTime);
            // console.log(enemy.hrid, "spawned");
        });

        this.startAttacks();
    }

    startAttacks() {
        let units = [this.players[0]];
        if (this.enemies) {
            units.push(...this.enemies);
        }

        for (const unit of units) {
            if (unit.combatDetails.currentHitpoints <= 0) {
                continue;
            }

            /*-if (unit.isPlayer) {
                // console.log("Start Attacks " + (this.simulationTime / 1000000000));
            }*/
            this.addNextAttackEvent(unit);
        }
    }

    processAutoAttackEvent(event) {
        // console.log("source:", event.source.hrid);
        // console.log("aa " + (this.simulationTime / 1000000000));

        let targets = event.source.isPlayer ? this.enemies : this.players;

        if (!targets) {
            return;
        }

        for (let target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
            let source = event.source;

            if (target.combatDetails.combatStats.parry > Math.random()) {
                let temp = source;
                source = target;
                target = temp;
            }

            let attackResult = CombatUtilities.processAttack(source, target);

            if (attackResult.didHit && source.combatDetails.combatStats.curse > 0 && Math.random() < (100 / (100 + target.combatDetails.combatStats.tenacity))) {
                target.curseExpireTime = this.simulationTime + 15000000000;
                if (target.combatDetails.combatStats.damageTaken < 0.1) {
                    target.combatDetails.combatStats.damageTaken += 0.01;
                }
                this.eventQueue.clearMatching((event) => event.type == CurseExpirationEvent.type && event.source == target)
                let curseExpirationEvent = new CurseExpirationEvent(target.curseExpireTime, target);
                this.eventQueue.addEvent(curseExpirationEvent);
            }

            this.simResult.addAttack(
                source,
                target,
                "autoAttack",
                attackResult.didHit ? attackResult.damageDone : "miss"
            );

            if (attackResult.lifeStealHeal > 0) {
                this.simResult.addHitpointsGained(source, "lifesteal", attackResult.lifeStealHeal);
            }

            if (attackResult.manaLeechMana > 0) {
                this.simResult.addManapointsGained(source, "manaLeech", attackResult.manaLeechMana);
            }

            if (attackResult.reflectDamageDone > 0) {
                this.simResult.addAttack(target, source, "physicalReflect", attackResult.reflectDamageDone);
            }

            for (const [skill, xp] of Object.entries(attackResult.experienceGained.source)) {
                this.simResult.addExperienceGain(source, skill, xp);
            }
            for (const [skill, xp] of Object.entries(attackResult.experienceGained.target)) {
                this.simResult.addExperienceGain(target, skill, xp);
            }

            if (target.combatDetails.currentHitpoints == 0) {
                this.eventQueue.clearEventsForUnit(target);
                this.simResult.addDeath(target);
                if (!target.isPlayer) {
                    this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);
                }
                // console.log(target.hrid, "died");
            }

            // Could die from reflect damage
            if (source.combatDetails.currentHitpoints == 0 && attackResult.reflectDamageDone != 0) {
                this.eventQueue.clearEventsForUnit(source);
                this.simResult.addDeath(source);
                if (!source.isPlayer) {
                    this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);
                }
                break;
            }

            if (!attackResult.didHit && source.combatDetails.combatStats.mayhem > Math.random()) {
                continue;
            }

            if (!attackResult.didHit || source.combatDetails.combatStats.pierce <= Math.random()) {
                break;
            }
        }

        if (!this.checkEncounterEnd()) {
            // console.log("!EncounterEnd " + (this.simulationTime / 1000000000));
            this.addNextAttackEvent(event.source);
        }
    }

    checkEncounterEnd() {
        let encounterEnded = false;

        if (this.enemies && !this.enemies.some((enemy) => enemy.combatDetails.currentHitpoints > 0)) {
            this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
            this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
            let enemyRespawnEvent = new EnemyRespawnEvent(this.simulationTime + ENEMY_RESPAWN_INTERVAL);
            this.eventQueue.addEvent(enemyRespawnEvent);
            this.enemies = null;

            this.simResult.addEncounterEnd();
            // console.log("All enemies died");

            encounterEnded = true;
            // console.log("encounter end " + (this.simulationTime / 1000000000))
        }

        if (
            !this.players.some((player) => player.combatDetails.currentHitpoints > 0) &&
            !this.eventQueue.containsEventOfType(PlayerRespawnEvent.type)
        ) {
            this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
            this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
            // 120 seconds respawn and 30 seconds traveling to battle
            let playerRespawnEvent = new PlayerRespawnEvent(this.simulationTime + PLAYER_RESPAWN_INTERVAL);
            this.eventQueue.addEvent(playerRespawnEvent);
            // console.log("Player died");

            encounterEnded = true;
        }

        return encounterEnded;
    }

    addNextAttackEvent(source) {
        let target;
        let friendlies;
        let enemies;
        if (source.isPlayer) {
            target = CombatUtilities.getTarget(this.enemies);
            friendlies = this.players;
            enemies = this.enemies;
        } else {
            target = CombatUtilities.getTarget(this.players);
            friendlies = this.enemies;
            enemies = this.players;
        }

        let usedAbility = false;

        source.abilities
            .filter((ability) => ability != null)
            .forEach((ability) => {
                if (!usedAbility && ability.shouldTrigger(this.simulationTime, source, target, friendlies, enemies) && this.canUseAbility(source, ability, true)) {
                    let castDuration = ability.castDuration;
                    castDuration /= (1 + source.combatDetails.combatStats.castSpeed)
                    let abilityCastEndEvent = new AbilityCastEndEvent(this.simulationTime + castDuration, source, ability);
                    this.eventQueue.addEvent(abilityCastEndEvent);
                    /*-if (source.isPlayer) {
                        let haste = source.combatDetails.combatStats.abilityHaste;
                        let cooldownDuration = ability.cooldownDuration;
                        if (haste > 0) {
                            cooldownDuration = cooldownDuration * 100 / (100 + haste);
                        }
                        // console.log((this.simulationTime / 1000000000) + " Casting " + ability.hrid + " Cast time " + (castDuration / 1e9) + " Off CD at " + ((this.simulationTime + cooldownDuration + castDuration) / 1e9) + " CD " + ((cooldownDuration) / 1e9));
                    }*/
                    usedAbility = true;
                }
            });

        if (usedAbility) {
            return;
        }


        if (!source.isBlinded) {
            let autoAttackEvent = new AutoAttackEvent(
                this.simulationTime + source.combatDetails.combatStats.attackInterval,
                source
            );
            /*-if (source.isPlayer) {
                // console.log("next attack " + ((this.simulationTime + source.combatDetails.combatStats.attackInterval) / 1e9))
            }*/
            this.eventQueue.addEvent(autoAttackEvent);
        } else {
            let nextCast = Number.MAX_SAFE_INTEGER;
            source.abilities
                .filter((ability) => ability != null)
                .forEach((ability) => {
                    // TODO account for regen tick
                    if (this.canUseAbility(source, ability, false)) {
                        let haste = source.combatDetails.combatStats.abilityHaste;
                        let cooldownDuration = ability.cooldownDuration;
                        if (haste > 0) {
                            cooldownDuration = cooldownDuration * 100 / (100 + haste);
                        }

                        let abilityNextCastTime = ability.lastUsed + cooldownDuration;

                        if (abilityNextCastTime <= source.blindExpireTime && abilityNextCastTime < nextCast) {
                            if (ability.shouldTrigger(abilityNextCastTime, source, target, friendlies, enemies)) {
                                nextCast = abilityNextCastTime;
                            }
                        }
                    }
                });

            if (nextCast > source.blindExpireTime) {
                let autoAttackEvent = new AutoAttackEvent(
                    source.blindExpireTime + source.combatDetails.combatStats.attackInterval,
                    source
                );
                /*-if (source.isPlayer) {
                    // console.log("next attack " + ((source.blindExpireTime + source.combatDetails.combatStats.attackInterval) / 1e9))
                }*/
                this.eventQueue.addEvent(autoAttackEvent);
            } else {
                let awaitCooldownEvent = new AwaitCooldownEvent(
                    nextCast,
                    source
                );
                this.eventQueue.addEvent(awaitCooldownEvent);
            }
        }
    }

    processConsumableTickEvent(event) {
        if (event.consumable.hitpointRestore > 0) {
            let tickValue = CombatUtilities.calculateTickValue(
                event.consumable.hitpointRestore,
                event.totalTicks,
                event.currentTick
            );
            let hitpointsAdded = event.source.addHitpoints(tickValue);
            this.simResult.addHitpointsGained(event.source, event.consumable.hrid, hitpointsAdded);
            // console.log("Added hitpoints:", hitpointsAdded);
        }

        if (event.consumable.manapointRestore > 0) {
            let tickValue = CombatUtilities.calculateTickValue(
                event.consumable.manapointRestore,
                event.totalTicks,
                event.currentTick
            );
            let manapointsAdded = event.source.addManapoints(tickValue);
            this.simResult.addManapointsGained(event.source, event.consumable.hrid, manapointsAdded);
            // console.log("Added manapoints:", manapointsAdded);
        }

        if (event.currentTick < event.totalTicks) {
            let consumableTickEvent = new ConsumableTickEvent(
                this.simulationTime + HOT_TICK_INTERVAL,
                event.source,
                event.consumable,
                event.totalTicks,
                event.currentTick + 1
            );
            this.eventQueue.addEvent(consumableTickEvent);
        }
    }

    processDamageOverTimeTickEvent(event) {
        let tickDamage = CombatUtilities.calculateTickValue(event.damage, event.totalTicks, event.currentTick);
        let damage = Math.min(tickDamage, event.target.combatDetails.currentHitpoints);

        event.target.combatDetails.currentHitpoints -= damage;
        this.simResult.addAttack(event.sourceRef, event.target, "damageOverTime", damage);

        let targetStaminaExperience = CombatUtilities.calculateStaminaExperience(0, damage);
        this.simResult.addExperienceGain(event.target, "stamina", targetStaminaExperience);
        // console.log(event.target.hrid, "bleed for", damage);

        switch (event.combatStyleHrid) {
            case "/combat_styles/magic":
                let sourceMagicExperience = CombatUtilities.calculateMagicExperience(damage, 0);
                this.simResult.addExperienceGain(event.sourceRef, "magic", sourceMagicExperience);
                break;
            case "/combat_styles/slash":
                let sourceAttackExperience = CombatUtilities.calculateAttackExperience(damage, 0, "/combat_styles/slash");
                this.simResult.addExperienceGain(event.sourceRef, "attack", sourceAttackExperience);
                let sourcePowerExperience = CombatUtilities.calculatePowerExperience(damage, 0, "/combat_styles/slash");
                this.simResult.addExperienceGain(event.sourceRef, "power", sourcePowerExperience);
                break;
        }

        if (event.currentTick < event.totalTicks) {
            let damageOverTimeTickEvent = new DamageOverTimeEvent(
                this.simulationTime + DOT_TICK_INTERVAL,
                event.sourceRef,
                event.target,
                event.damage,
                event.totalTicks,
                event.currentTick + 1,
                event.combatStyleHrid
            );
            this.eventQueue.addEvent(damageOverTimeTickEvent);
        }

        if (event.target.combatDetails.currentHitpoints == 0) {
            this.eventQueue.clearEventsForUnit(event.target);
            this.simResult.addDeath(event.target);
            if (!event.target.isPlayer) {
                this.simResult.updateTimeSpentAlive(event.target.hrid, false, this.simulationTime);
            }
        }

        this.checkEncounterEnd();
    }

    processRegenTickEvent(event) {
        let units = [...this.players];
        if (this.enemies) {
            units.push(...this.enemies);
        }

        for (const unit of units) {
            if (unit.combatDetails.currentHitpoints <= 0) {
                continue;
            }

            let hitpointRegen = Math.floor(unit.combatDetails.maxHitpoints * unit.combatDetails.combatStats.HPRegen);
            let hitpointsAdded = unit.addHitpoints(hitpointRegen);
            this.simResult.addHitpointsGained(unit, "regen", hitpointsAdded);
            // console.log("Added hitpoints:", hitpointsAdded);

            let manapointRegen = Math.floor(unit.combatDetails.maxManapoints * unit.combatDetails.combatStats.MPRegen);
            let manapointsAdded = unit.addManapoints(manapointRegen);
            this.simResult.addManapointsGained(unit, "regen", manapointsAdded);
            // console.log("Added manapoints:", manapointsAdded);
        }

        let regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);
        this.eventQueue.addEvent(regenTickEvent);
    }

    processCheckBuffExpirationEvent(event) {
        event.source.removeExpiredBuffs(this.simulationTime);
    }

    processStunExpirationEvent(event) {
        event.source.isStunned = false;
        // console.log("Stun " + (this.simulationTime / 1000000000));
        this.addNextAttackEvent(event.source);
    }

    processBlindExpirationEvent(event) {
        event.source.isBlinded = false;
    }

    processSilenceExpirationEvent(event) {
        event.source.isSilenced = false;
    }

    processCurseExpirationEvent(event) {
        event.source.damageTaken = 0;
    }

    checkTriggers() {
        let triggeredSomething;

        do {
            triggeredSomething = false;

            this.players
                .filter((player) => player.combatDetails.currentHitpoints > 0)
                .forEach((player) => {
                    if (this.checkTriggersForUnit(player, this.players, this.enemies)) {
                        triggeredSomething = true;
                    }
                });

            if (this.enemies) {
                this.enemies
                    .filter((enemy) => enemy.combatDetails.currentHitpoints > 0)
                    .forEach((enemy) => {
                        if (this.checkTriggersForUnit(enemy, this.enemies, this.players)) {
                            triggeredSomething = true;
                        }
                    });
            }
        } while (triggeredSomething);
    }

    checkTriggersForUnit(unit, friendlies, enemies) {
        if (unit.combatDetails.currentHitpoints <= 0) {
            throw new Error("Checking triggers for a dead unit");
        }

        let triggeredSomething = false;
        let target = CombatUtilities.getTarget(enemies);

        for (const food of unit.food) {
            if (food && food.shouldTrigger(this.simulationTime, unit, target, friendlies, enemies)) {
                let result = this.tryUseConsumable(unit, food);
                if (result) {
                    triggeredSomething = true;
                }
            }
        }

        for (const drink of unit.drinks) {
            if (drink && drink.shouldTrigger(this.simulationTime, unit, target, friendlies, enemies)) {
                let result = this.tryUseConsumable(unit, drink);
                if (result) {
                    triggeredSomething = true;
                }
            }
        }

        return triggeredSomething;
    }

    tryUseConsumable(source, consumable) {
        // console.log("Consuming:", consumable);

        if (source.combatDetails.currentHitpoints <= 0) {
            return false;
        }

        consumable.lastUsed = this.simulationTime;
        let cooldownReadyEvent = new CooldownReadyEvent(this.simulationTime + consumable.cooldownDuration);
        this.eventQueue.addEvent(cooldownReadyEvent);

        this.simResult.addConsumableUse(source, consumable);

        if (consumable.recoveryDuration == 0) {
            if (consumable.hitpointRestore > 0) {
                let hitpointsAdded = source.addHitpoints(consumable.hitpointRestore);
                this.simResult.addHitpointsGained(source, consumable.hrid, hitpointsAdded);
                // console.log("Added hitpoints:", hitpointsAdded);
            }

            if (consumable.manapointRestore > 0) {
                let manapointsAdded = source.addManapoints(consumable.manapointRestore);
                this.simResult.addManapointsGained(source, consumable.hrid, manapointsAdded);
                // console.log("Added manapoints:", manapointsAdded);
            }
        } else {
            let consumableTickEvent = new ConsumableTickEvent(
                this.simulationTime + HOT_TICK_INTERVAL,
                source,
                consumable,
                consumable.recoveryDuration / HOT_TICK_INTERVAL,
                1
            );
            this.eventQueue.addEvent(consumableTickEvent);
        }

        for (const buff of consumable.buffs) {
            source.addBuff(buff, this.simulationTime);
            // console.log("Added buff:", buff);
            let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + buff.duration, source);
            this.eventQueue.addEvent(checkBuffExpirationEvent);
        }

        return true;
    }

    canUseAbility(source, ability, oomCheck) {
        if (source.combatDetails.currentHitpoints <= 0) {
            return false;
        }

        if (source.combatDetails.currentManapoints < ability.manaCost) {
            if (source.isPlayer && oomCheck) {
                this.simResult.playerRanOutOfMana = true;
            }
            return false;
        }
        return true;
    }

    tryUseAbility(source, ability) {

        if (!this.canUseAbility(source, ability, true)) {
            // console.log("Falseeeeeee");
            return false;
        }

        // console.log("Casting:", ability);

        if (source.isPlayer) {
            if (source.abilityManaCosts.has(ability.hrid)) {
                source.abilityManaCosts.set(ability.hrid, source.abilityManaCosts.get(ability.hrid) + ability.manaCost);
            } else {
                source.abilityManaCosts.set(ability.hrid, ability.manaCost);
            }
        }

        source.combatDetails.currentManapoints -= ability.manaCost;

        let sourceIntelligenceExperience = CombatUtilities.calculateIntelligenceExperience(ability.manaCost);
        this.simResult.addExperienceGain(source, "intelligence", sourceIntelligenceExperience);

        ability.lastUsed = this.simulationTime;

        let haste = source.combatDetails.combatStats.abilityHaste;
        let cooldownDuration = ability.cooldownDuration;
        if (haste > 0) {
            cooldownDuration = cooldownDuration * 100 / (100 + haste);
        }

        /*-if (source.isPlayer) {
            let castDuration = ability.castDuration;
            castDuration /= (1 + source.combatDetails.combatStats.castSpeed)
            // console.log((this.simulationTime / 1000000000) + " Used ability " + ability.hrid + " Cast time " + (castDuration / 1e9));
        }*/
        this.addNextAttackEvent(source);

        for (const abilityEffect of ability.abilityEffects) {
            switch (abilityEffect.effectType) {
                case "/ability_effect_types/buff":
                    this.processAbilityBuffEffect(source, ability, abilityEffect);
                    break;
                case "/ability_effect_types/damage":
                    this.processAbilityDamageEffect(source, ability, abilityEffect);
                    break;
                case "/ability_effect_types/heal":
                    this.processAbilityHealEffect(source, ability, abilityEffect);
                    break;
                case "/ability_effect_types/spend_hp":
                    this.processAbilitySpendHpEffect(source, ability, abilityEffect);
                    break;
                case "/ability_effect_types/revive":
                    this.processAbilityReviveEffect(source, ability, abilityEffect);
                    break;
                default:
                    throw new Error("Unsupported effect type for ability: " + ability.hrid + " effectType: " + abilityEffect.effectType);
            }
        }

        // Could die from reflect damage
        if (source.combatDetails.currentHitpoints == 0) {
            this.eventQueue.clearEventsForUnit(source);
            this.simResult.addDeath(source);
            if (!source.isPlayer) {
                this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);
            }
        }

        this.checkEncounterEnd();

        return true;
    }

    processAbilityBuffEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType == "all allies") {
            let targets = source.isPlayer ? this.players : this.enemies;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                for (const buff of abilityEffect.buffs) {
                    target.addBuff(buff, this.simulationTime);
                    let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + buff.duration, target);
                    this.eventQueue.addEvent(checkBuffExpirationEvent);
                }
            }
            return;
        }

        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for buff ability effect: " + ability.hrid);
        }

        for (const buff of abilityEffect.buffs) {
            source.addBuff(buff, this.simulationTime);
            // console.log("Added buff:", abilityEffect.buff);
            let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + buff.duration, source);
            this.eventQueue.addEvent(checkBuffExpirationEvent);
        }
    }

    processAbilityDamageEffect(source, ability, abilityEffect) {
        let targets;
        switch (abilityEffect.targetType) {
            case "enemy":
            case "all enemies":
                targets = source.isPlayer ? this.enemies : this.players;
                break;
            default:
                throw new Error("Unsupported target type for damage ability effect: " + ability.hrid);
        }

        for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
            if (target.combatDetails.combatStats.parry > Math.random()) {
                let tempTarget = source;
                let tempSource = target;

                let attackResult = CombatUtilities.processAttack(tempSource, tempTarget);

                this.simResult.addAttack(
                    tempSource,
                    tempTarget,
                    "autoAttack",
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );

                if (attackResult.lifeStealHeal > 0) {
                    this.simResult.addHitpointsGained(tempSource, "lifesteal", attackResult.lifeStealHeal);
                }

                if (attackResult.manaLeechMana > 0) {
                    this.simResult.addManapointsGained(tempSource, "manaLeech", attackResult.manaLeechMana);
                }

                if (attackResult.reflectDamageDone > 0) {
                    this.simResult.addAttack(tempTarget, tempSource, "physicalReflect", attackResult.reflectDamageDone);
                }

                for (const [skill, xp] of Object.entries(attackResult.experienceGained.source)) {
                    this.simResult.addExperienceGain(tempSource, skill, xp);
                }
                for (const [skill, xp] of Object.entries(attackResult.experienceGained.target)) {
                    this.simResult.addExperienceGain(tempTarget, skill, xp);
                }

                if (tempTarget.combatDetails.currentHitpoints == 0) {
                    this.eventQueue.clearEventsForUnit(tempTarget);
                    this.simResult.addDeath(tempTarget);
                    if (!tempTarget.isPlayer) {
                        this.simResult.updateTimeSpentAlive(tempTarget.hrid, false, this.simulationTime);
                    }
                    // console.log(tempTarget.hrid, "died");
                }

                // Could die from reflect damage
                if (tempSource.combatDetails.currentHitpoints == 0 && attackResult.reflectDamageDone != 0) {
                    this.eventQueue.clearEventsForUnit(tempSource);
                    this.simResult.addDeath(tempSource);
                    if (!tempSource.isPlayer) {
                        this.simResult.updateTimeSpentAlive(tempSource.hrid, false, this.simulationTime);
                    }
                }
            } else {
                let attackResult = CombatUtilities.processAttack(source, target, abilityEffect);

                if (attackResult.didHit && abilityEffect.buffs) {
                    for (const buff of abilityEffect.buffs) {
                        target.addBuff(buff, this.simulationTime);
                        let checkBuffExpirationEvent = new CheckBuffExpirationEvent(
                            this.simulationTime + buff.duration,
                            target
                        );
                        this.eventQueue.addEvent(checkBuffExpirationEvent);
                    }
                }

                if (abilityEffect.damageOverTimeRatio > 0 && attackResult.damageDone > 0) {
                    let damageOverTimeEvent = new DamageOverTimeEvent(
                        this.simulationTime + DOT_TICK_INTERVAL,
                        source,
                        target,
                        attackResult.damageDone * abilityEffect.damageOverTimeRatio,
                        abilityEffect.damageOverTimeDuration / DOT_TICK_INTERVAL,
                        1, abilityEffect.combatStyleHrid
                    );
                    this.eventQueue.addEvent(damageOverTimeEvent);
                }

                if (attackResult.didHit && abilityEffect.stunChance > 0 && Math.random() < (abilityEffect.stunChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isStunned = true;
                    target.stunExpireTime = this.simulationTime + abilityEffect.stunDuration;
                    this.eventQueue.clearMatching((event) => (event.type == AutoAttackEvent.type || event.type == AbilityCastEndEvent.type || event.type == StunExpirationEvent.type) && event.source == target);
                    let stunExpirationEvent = new StunExpirationEvent(target.stunExpireTime, target);
                    this.eventQueue.addEvent(stunExpirationEvent);
                }

                if (attackResult.didHit && abilityEffect.blindChance > 0 && Math.random() < (abilityEffect.blindChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isBlinded = true;
                    target.blindExpireTime = this.simulationTime + abilityEffect.blindDuration;
                    this.eventQueue.clearMatching((event) => event.type == BlindExpirationEvent.type && event.source == target)
                    if (this.eventQueue.clearMatching((event) => event.type == AutoAttackEvent.type && event.source == target)) {
                        // console.log("Blind " + (this.simulationTime / 1000000000));
                        this.addNextAttackEvent(target);
                    }
                    let blindExpirationEvent = new BlindExpirationEvent(target.blindExpireTime, target);
                    this.eventQueue.addEvent(blindExpirationEvent);
                }

                if (attackResult.didHit && abilityEffect.silenceChance > 0 && Math.random() < (abilityEffect.silenceChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isSilenced = true;
                    target.silenceExpireTime = this.simulationTime + abilityEffect.silenceDuration;
                    this.eventQueue.clearMatching((event) => event.type == SilenceExpirationEvent.type && event.source == target)
                    if (this.eventQueue.clearMatching((event) => event.type == AbilityCastEndEvent.type && event.source == target)) {
                        // console.log("Silence " + (this.simulationTime / 1000000000));
                        this.addNextAttackEvent(target);
                    }
                    let silenceExpirationEvent = new SilenceExpirationEvent(target.silenceExpireTime, target);
                    this.eventQueue.addEvent(silenceExpirationEvent);
                }

                if (attackResult.didHit && source.combatDetails.combatStats.curse > 0 && Math.random() < (100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.curseExpireTime = this.simulationTime + 15000000000;
                    if (target.combatDetails.combatStats.damageTaken < 0.1) {
                        target.combatDetails.combatStats.damageTaken += 0.01;
                    }
                    this.eventQueue.clearMatching((event) => event.type == CurseExpirationEvent.type && event.source == target)
                    let curseExpirationEvent = new CurseExpirationEvent(target.curseExpireTime, target);
                    this.eventQueue.addEvent(curseExpirationEvent);
                }

                this.simResult.addAttack(
                    source,
                    target,
                    ability.hrid,
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );

                if (attackResult.reflectDamageDone > 0) {
                    this.simResult.addAttack(target, source, "physicalReflect", attackResult.reflectDamageDone);
                }

                for (const [skill, xp] of Object.entries(attackResult.experienceGained.source)) {
                    this.simResult.addExperienceGain(source, skill, xp);
                }
                for (const [skill, xp] of Object.entries(attackResult.experienceGained.target)) {
                    this.simResult.addExperienceGain(target, skill, xp);
                }

                if (target.combatDetails.currentHitpoints == 0) {
                    this.eventQueue.clearEventsForUnit(target);
                    this.simResult.addDeath(target);
                    if (!target.isPlayer) {
                        this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);
                    }
                    // console.log(target.hrid, "died");
                }

                if (attackResult.didHit && abilityEffect.pierceChance > Math.random()) {
                    continue;
                }
            }

            if (abilityEffect.targetType == "enemy") {
                break;
            }
        }
    }

    processAbilityHealEffect(source, ability, abilityEffect) {

        if (abilityEffect.targetType == "all allies") {
            let targets = source.isPlayer ? this.players : this.enemies;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                let amountHealed = CombatUtilities.processHeal(source, abilityEffect, target);
                let experienceGained = CombatUtilities.calculateHealingExperience(amountHealed);

                this.simResult.addHitpointsGained(target, ability.hrid, amountHealed);
                this.simResult.addExperienceGain(source, "magic", experienceGained);
            }
            return;
        }

        if (abilityEffect.targetType == "lowest HP ally") {
            let targets = source.isPlayer ? this.players : this.enemies;
            let healTarget;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                if (!healTarget) {
                    healTarget = target;
                    continue;
                }
                if (target.combatDetails.currentHitpoints < healTarget.combatDetails.currentHitpoints) {
                    healTarget = target;
                }
            }

            if (healTarget) {
                let amountHealed = CombatUtilities.processHeal(source, abilityEffect, healTarget);
                let experienceGained = CombatUtilities.calculateHealingExperience(amountHealed);

                this.simResult.addHitpointsGained(healTarget, ability.hrid, amountHealed);
                this.simResult.addExperienceGain(source, "magic", experienceGained);
            }
            return;
        }

        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for heal ability effect: " + ability.hrid);
        }

        let amountHealed = CombatUtilities.processHeal(source, abilityEffect, source);
        let experienceGained = CombatUtilities.calculateHealingExperience(amountHealed);

        this.simResult.addHitpointsGained(source, ability.hrid, amountHealed);
        this.simResult.addExperienceGain(source, "magic", experienceGained);
    }

    processAbilityReviveEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType != "a dead ally") {
            throw new Error("Unsupported target type for revive ability effect: " + ability.hrid);
        }

        let targets = source.isPlayer ? this.players : this.enemies;
        let reviveTarget = targets.find((unit) => unit && unit.combatDetails.currentHitpoints <= 0);

        if (reviveTarget) {
            let amountHealed = CombatUtilities.processRevive(source, abilityEffect, reviveTarget);
            let experienceGained = CombatUtilities.calculateHealingExperience(amountHealed);

            this.simResult.addHitpointsGained(reviveTarget, ability.hrid, amountHealed);
            this.simResult.addExperienceGain(source, "magic", experienceGained);

            this.addNextAttackEvent(reviveTarget);

            if (!source.isPlayer) {
                this.simResult.updateTimeSpentAlive(reviveTarget.hrid, true, this.simulationTime);
            }

            // console.log(source.hrid + " revived " + reviveTarget.hrid + " with " + amountHealed + " HP.");
        }
        return;
    }

    processAbilitySpendHpEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for spend hp ability effect: " + ability.hrid);
        }

        let hpSpent = CombatUtilities.processSpendHp(source, abilityEffect);
        let experienceGained = CombatUtilities.calculateStaminaExperience(0, hpSpent);

        this.simResult.addHitpointsSpent(source, ability.hrid, hpSpent);
        this.simResult.addExperienceGain(source, "stamina", experienceGained);
    }
}

export default CombatSimulator;
