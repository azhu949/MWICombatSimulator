"use strict";
(self["webpackChunkmwicombatsimulator"] = self["webpackChunkmwicombatsimulator"] || []).push([["src_combatsimulator_combatSimulator_js"],{

/***/ "./src/combatsimulator/ability.js":
/*!****************************************!*\
  !*** ./src/combatsimulator/ability.js ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _buff__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./buff */ "./src/combatsimulator/buff.js");
/* harmony import */ var _data_abilityDetailMap_json__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./data/abilityDetailMap.json */ "./src/combatsimulator/data/abilityDetailMap.json");
/* harmony import */ var _trigger__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./trigger */ "./src/combatsimulator/trigger.js");




const abilityFromCombatStat = {
    "blaze":
    {
        "hrid": "/abilities/blaze",
        "name": "Blaze",
        "description": "",
        "isSpecialAbility": false,
        "manaCost": 0,
        "cooldownDuration": 0,
        "castDuration": 0,
        "abilityEffects": [
            {
                "targetType": "allEnemies",
                "effectType": "/ability_effect_types/damage",
                "combatStyleHrid": "/combat_styles/magic",
                "damageType": "/damage_types/fire",
                "baseDamageFlat": 0,
                "baseDamageFlatLevelBonus": 0.0,
                "baseDamageRatio": 0.3,
                "baseDamageRatioLevelBonus": 0,
                "bonusAccuracyRatio": 0,
                "bonusAccuracyRatioLevelBonus": 0,
                "damageOverTimeRatio": 0,
                "damageOverTimeDuration": 0,
                "armorDamageRatio": 0,
                "armorDamageRatioLevelBonus": 0,
                "hpDrainRatio": 0,
                "pierceChance": 0,
                "blindChance": 0,
                "blindDuration": 0,
                "silenceChance": 0,
                "silenceDuration": 0,
                "stunChance": 0,
                "stunDuration": 0,
                "spendHpRatio": 0,
                "buffs": null
            }
        ],
        "defaultCombatTriggers": [
            {
                "dependencyHrid": "/combat_trigger_dependencies/all_enemies",
                "conditionHrid": "/combat_trigger_conditions/number_of_active_units",
                "comparatorHrid": "/combat_trigger_comparators/greater_than_equal",
                "value": 1
            },
            {
                "dependencyHrid": "/combat_trigger_dependencies/all_enemies",
                "conditionHrid": "/combat_trigger_conditions/current_hp",
                "comparatorHrid": "/combat_trigger_comparators/greater_than_equal",
                "value": 1
            }
        ],
    },
    "bloom":
    {
        "hrid": "/abilities/bloom",
        "name": "Bloom",
        "description": "",
        "isSpecialAbility": false,
        "manaCost": 0,
        "cooldownDuration": 0,
        "castDuration": 0,
        "abilityEffects": [
            {
                "targetType": "lowestHpAlly",
                "effectType": "/ability_effect_types/heal",
                "combatStyleHrid": "/combat_styles/magic",
                "damageType": "",
                "baseDamageFlat": 10,
                "baseDamageFlatLevelBonus": 0,
                "baseDamageRatio": 0.15,
                "baseDamageRatioLevelBonus": 0,
                "bonusAccuracyRatio": 0,
                "bonusAccuracyRatioLevelBonus": 0,
                "damageOverTimeRatio": 0,
                "damageOverTimeDuration": 0,
                "armorDamageRatio": 0,
                "armorDamageRatioLevelBonus": 0,
                "hpDrainRatio": 0,
                "pierceChance": 0,
                "blindChance": 0,
                "blindDuration": 0,
                "silenceChance": 0,
                "silenceDuration": 0,
                "stunChance": 0,
                "stunDuration": 0,
                "spendHpRatio": 0,
                "buffs": null
            }
        ],
        "defaultCombatTriggers": [
            {
                "dependencyHrid": "/combat_trigger_dependencies/all_allies",
                "conditionHrid": "/combat_trigger_conditions/lowest_hp_percentage",
                "comparatorHrid": "/combat_trigger_comparators/less_than_equal",
                "value": 100
            }
        ],
    }
}

class Ability {
    constructor(hrid, level = 1, triggers = null) {
        this.hrid = hrid;
        this.level = level;

        let gameAbility = _data_abilityDetailMap_json__WEBPACK_IMPORTED_MODULE_1__[hrid];
        if (!gameAbility) {
            gameAbility = abilityFromCombatStat[hrid];
        }
        if (!gameAbility) {
            throw new Error("No ability found for hrid: " + this.hrid);
        }

        this.manaCost = gameAbility.manaCost;
        this.cooldownDuration = gameAbility.cooldownDuration;
        this.castDuration = gameAbility.castDuration;
        this.isSpecialAbility = gameAbility.isSpecialAbility;

        this.abilityEffects = [];

        for (const effect of gameAbility.abilityEffects) {
            let abilityEffect = {
                targetType: effect.targetType,
                effectType: effect.effectType,
                combatStyleHrid: effect.combatStyleHrid,
                damageType: effect.damageType,
                damageFlat: effect.baseDamageFlat + (this.level - 1) * effect.baseDamageFlatLevelBonus,
                damageRatio: effect.baseDamageRatio + (this.level - 1) * effect.baseDamageRatioLevelBonus,
                bonusAccuracyRatio: effect.bonusAccuracyRatio + (this.level - 1) * effect.bonusAccuracyRatioLevelBonus,
                damageOverTimeRatio: effect.damageOverTimeRatio,
                damageOverTimeDuration: effect.damageOverTimeDuration,
                armorDamageRatio: effect.armorDamageRatio + (this.level - 1) * effect.armorDamageRatioLevelBonus,
                hpDrainRatio: effect.hpDrainRatio,
                pierceChance: effect.pierceChance,
                blindChance: effect.blindChance,
                blindDuration: effect.blindDuration,
                silenceChance: effect.silenceChance,
                silenceDuration: effect.silenceDuration,
                stunChance: effect.stunChance,
                stunDuration: effect.stunDuration,
                spendHpRatio: effect.spendHpRatio,
                buffs: null,
            };
            if (effect.buffs) {
                abilityEffect.buffs = [];
                for (const buff of effect.buffs) {
                    abilityEffect.buffs.push(new _buff__WEBPACK_IMPORTED_MODULE_0__["default"](buff, this.level));
                }
            }
            this.abilityEffects.push(abilityEffect);
        }

        if (triggers) {
            this.triggers = triggers;
        } else {
            this.triggers = [];
            for (const defaultTrigger of gameAbility.defaultCombatTriggers) {
                let trigger = new _trigger__WEBPACK_IMPORTED_MODULE_2__["default"](
                    defaultTrigger.dependencyHrid,
                    defaultTrigger.conditionHrid,
                    defaultTrigger.comparatorHrid,
                    defaultTrigger.value
                );
                this.triggers.push(trigger);
            }
        }

        this.lastUsed = Number.MIN_SAFE_INTEGER;
    }

    static createFromDTO(dto) {
        let triggers = dto.triggers.map((trigger) => _trigger__WEBPACK_IMPORTED_MODULE_2__["default"].createFromDTO(trigger));
        let ability = new Ability(dto.hrid, dto.level, triggers);

        return ability;
    }

    shouldTrigger(currentTime, source, target, friendlies, enemies) {
        if (source.isStunned) {
            return false;
        }

        if (source.isSilenced) {
            return false;
        }

        let haste = source.combatDetails.combatStats.abilityHaste;
        let cooldownDuration = this.cooldownDuration;
        if (haste > 0) {
            cooldownDuration = cooldownDuration * 100 / (100 + haste);
        }

        if (this.lastUsed + cooldownDuration > currentTime) {
            return false;
        }

        if (this.triggers.length == 0) {
            return true;
        }

        let shouldTrigger = true;
        for (const trigger of this.triggers) {
            if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
                shouldTrigger = false;
            }
        }

        return shouldTrigger;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Ability);


/***/ }),

/***/ "./src/combatsimulator/buff.js":
/*!*************************************!*\
  !*** ./src/combatsimulator/buff.js ***!
  \*************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class Buff {
    startTime;

    constructor(buff, level = 1) {
        this.uniqueHrid = buff.uniqueHrid;
        this.typeHrid = buff.typeHrid;
        this.ratioBoost = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
        this.flatBoost = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
        this.duration = buff.duration;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Buff);


/***/ }),

/***/ "./src/combatsimulator/combatSimulator.js":
/*!************************************************!*\
  !*** ./src/combatsimulator/combatSimulator.js ***!
  \************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatUtilities__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatUtilities */ "./src/combatsimulator/combatUtilities.js");
/* harmony import */ var _events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./events/autoAttackEvent */ "./src/combatsimulator/events/autoAttackEvent.js");
/* harmony import */ var _events_damageOverTimeEvent__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./events/damageOverTimeEvent */ "./src/combatsimulator/events/damageOverTimeEvent.js");
/* harmony import */ var _events_checkBuffExpirationEvent__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./events/checkBuffExpirationEvent */ "./src/combatsimulator/events/checkBuffExpirationEvent.js");
/* harmony import */ var _events_combatStartEvent__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./events/combatStartEvent */ "./src/combatsimulator/events/combatStartEvent.js");
/* harmony import */ var _events_consumableTickEvent__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./events/consumableTickEvent */ "./src/combatsimulator/events/consumableTickEvent.js");
/* harmony import */ var _events_cooldownReadyEvent__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./events/cooldownReadyEvent */ "./src/combatsimulator/events/cooldownReadyEvent.js");
/* harmony import */ var _events_enemyRespawnEvent__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./events/enemyRespawnEvent */ "./src/combatsimulator/events/enemyRespawnEvent.js");
/* harmony import */ var _events_eventQueue__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./events/eventQueue */ "./src/combatsimulator/events/eventQueue.js");
/* harmony import */ var _events_playerRespawnEvent__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./events/playerRespawnEvent */ "./src/combatsimulator/events/playerRespawnEvent.js");
/* harmony import */ var _events_regenTickEvent__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./events/regenTickEvent */ "./src/combatsimulator/events/regenTickEvent.js");
/* harmony import */ var _events_stunExpirationEvent__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./events/stunExpirationEvent */ "./src/combatsimulator/events/stunExpirationEvent.js");
/* harmony import */ var _events_blindExpirationEvent__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./events/blindExpirationEvent */ "./src/combatsimulator/events/blindExpirationEvent.js");
/* harmony import */ var _events_silenceExpirationEvent__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ./events/silenceExpirationEvent */ "./src/combatsimulator/events/silenceExpirationEvent.js");
/* harmony import */ var _events_curseExpirationEvent__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ./events/curseExpirationEvent */ "./src/combatsimulator/events/curseExpirationEvent.js");
/* harmony import */ var _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__ = __webpack_require__(/*! ./events/weakenExpirationEvent */ "./src/combatsimulator/events/weakenExpirationEvent.js");
/* harmony import */ var _events_furyExpirationEvent__WEBPACK_IMPORTED_MODULE_16__ = __webpack_require__(/*! ./events/furyExpirationEvent */ "./src/combatsimulator/events/furyExpirationEvent.js");
/* harmony import */ var _simResult__WEBPACK_IMPORTED_MODULE_17__ = __webpack_require__(/*! ./simResult */ "./src/combatsimulator/simResult.js");
/* harmony import */ var _events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__ = __webpack_require__(/*! ./events/abilityCastEndEvent */ "./src/combatsimulator/events/abilityCastEndEvent.js");
/* harmony import */ var _events_awaitCooldownEvent__WEBPACK_IMPORTED_MODULE_19__ = __webpack_require__(/*! ./events/awaitCooldownEvent */ "./src/combatsimulator/events/awaitCooldownEvent.js");
/* harmony import */ var _monster__WEBPACK_IMPORTED_MODULE_20__ = __webpack_require__(/*! ./monster */ "./src/combatsimulator/monster.js");
/* harmony import */ var _ability__WEBPACK_IMPORTED_MODULE_21__ = __webpack_require__(/*! ./ability */ "./src/combatsimulator/ability.js");























const ONE_SECOND = 1e9;
const HOT_TICK_INTERVAL = 5 * ONE_SECOND;
const DOT_TICK_INTERVAL = 3 * ONE_SECOND;
const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;
const ENEMY_RESPAWN_INTERVAL = 3 * ONE_SECOND;
const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;
const RESTART_INTERVAL = 15 * ONE_SECOND;

let tempDungeonCount = 0;

class CombatSimulator extends EventTarget {
    constructor(players, zone) {
        super();
        this.players = players;
        this.zone = zone;
        this.eventQueue = new _events_eventQueue__WEBPACK_IMPORTED_MODULE_8__["default"]();
        this.simResult = new _simResult__WEBPACK_IMPORTED_MODULE_17__["default"](zone.hrid, players.length);
        this.allPlayersDead = false;
    }

    async simulate(simulationTimeLimit) {
        this.reset();

        let ticks = 0;

        let combatStartEvent = new _events_combatStartEvent__WEBPACK_IMPORTED_MODULE_4__["default"](0);
        this.eventQueue.addEvent(combatStartEvent);

        while (this.simulationTime < simulationTimeLimit) {
            let nextEvent = this.eventQueue.getNextEvent();
            await this.processEvent(nextEvent);

            ticks++;
            if (ticks == 1000) {
                ticks = 0;
                let progressEvent = new CustomEvent("progress", {
                    zone: this.zone,
                    detail: Math.min(this.simulationTime / simulationTimeLimit, 1),
                });
                this.dispatchEvent(progressEvent);
            }
        }

        // for (let i = 0; i < this.simResult.timeSpentAlive.length; i++) {
        //     if (this.simResult.timeSpentAlive[i].alive == true) {
        //         this.simResult.updateTimeSpentAlive(this.simResult.timeSpentAlive[i].name, false, simulationTimeLimit);
        //     }
        // }

        this.simResult.isDungeon = this.zone.isDungeon;
        if (this.simResult.isDungeon) {
            console.log("Timeout now at wave #" + (this.zone.encountersKilled - 1));

            this.simResult.dungeonsCompleted = this.zone.dungeonsCompleted;
            this.simResult.dungeonsFailed = this.zone.dungeonsFailed;
            if (this.simResult.dungeonsCompleted < 1) {
                this.simResult.maxWaveReached = 0;
                for (let i = 0; i <= this.zone.dungeonSpawnInfo.maxWaves; i++) {
                    let waveName = "#" + i.toString();
                    const idx = this.simResult.timeSpentAlive.findIndex(e => e.name === waveName);
                    if (idx == -1 || this.simResult.timeSpentAlive[idx].count == 0) {
                        break;
                    }
                    this.simResult.maxWaveReached = i;
                }
            } else {
                this.simResult.maxWaveReached = this.zone.dungeonSpawnInfo.maxWaves;
            }
        }
        this.simResult.simulatedTime = this.simulationTime;
        
        for (let i = 0; i < this.players.length; i++) {
            this.simResult.setDropRateMultipliers(this.players[i]);
            this.simResult.setManaUsed(this.players[i]);
        }

        if (this.zone.isDungeon) {
            Object.entries(this.zone.dungeonSpawnInfo.fixedSpawnsMap).forEach(([wave, monsters]) => {
                let waveName = "#" + wave.toString();
                monsters.forEach(monster => {
                    waveName += ',' + monster.combatMonsterHrid;
                });
                this.simResult.bossSpawns.push(waveName);
            });

        }
        if (this.zone.monsterSpawnInfo.bossSpawns) {
            for (const boss of this.zone.monsterSpawnInfo.bossSpawns) {
                this.simResult.bossSpawns.push(boss.combatMonsterHrid);
            }
        }

        if (!this.zone.isDungeon) {
            this.simResult.eliteTier = this.zone.monsterSpawnInfo.randomSpawnInfo.spawns[0].eliteTier;
        }

        return this.simResult;
    }

    reset() {
        this.tempDungeonCount = 0;
        this.simulationTime = 0;
        this.eventQueue.clear();
        this.simResult = new _simResult__WEBPACK_IMPORTED_MODULE_17__["default"](this.zone.hrid, this.players.length);
    }

    async processEvent(event) {
        this.simulationTime = event.time;

        // console.log(this.simulationTime / 1e9, event.type, event);

        switch (event.type) {
            case _events_combatStartEvent__WEBPACK_IMPORTED_MODULE_4__["default"].type:
                this.processCombatStartEvent(event);
                break;
            case _events_playerRespawnEvent__WEBPACK_IMPORTED_MODULE_9__["default"].type:
                this.processPlayerRespawnEvent(event);
                break;
            case _events_enemyRespawnEvent__WEBPACK_IMPORTED_MODULE_7__["default"].type:
                this.processEnemyRespawnEvent(event);
                break;
            case _events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"].type:
                this.processAutoAttackEvent(event);
                break;
            case _events_consumableTickEvent__WEBPACK_IMPORTED_MODULE_5__["default"].type:
                this.processConsumableTickEvent(event);
                break;
            case _events_damageOverTimeEvent__WEBPACK_IMPORTED_MODULE_2__["default"].type:
                this.processDamageOverTimeTickEvent(event);
                break;
            case _events_checkBuffExpirationEvent__WEBPACK_IMPORTED_MODULE_3__["default"].type:
                this.processCheckBuffExpirationEvent(event);
                break;
            case _events_regenTickEvent__WEBPACK_IMPORTED_MODULE_10__["default"].type:
                this.processRegenTickEvent(event);
                break;
            case _events_stunExpirationEvent__WEBPACK_IMPORTED_MODULE_11__["default"].type:
                this.processStunExpirationEvent(event);
                break;
            case _events_blindExpirationEvent__WEBPACK_IMPORTED_MODULE_12__["default"].type:
                this.processBlindExpirationEvent(event);
                break;
            case _events_silenceExpirationEvent__WEBPACK_IMPORTED_MODULE_13__["default"].type:
                this.processSilenceExpirationEvent(event);
                break;
            case _events_curseExpirationEvent__WEBPACK_IMPORTED_MODULE_14__["default"].type:
                this.processCurseExpirationEvent(event);
                break;
            case _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"].type:
                this.processWeakenExpirationEvent(event);
                break;
            case _events_furyExpirationEvent__WEBPACK_IMPORTED_MODULE_16__["default"].type:
                this.processFuryExpirationEvent(event);
                break;
            case _events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__["default"].type:
                this.tryUseAbility(event.source, event.ability);
                break;
            case _events_awaitCooldownEvent__WEBPACK_IMPORTED_MODULE_19__["default"].type:
                // console.log("Await CD " + (this.simulationTime / 1000000000));
                this.addNextAttackEvent(event.source);
                break;
            case _events_cooldownReadyEvent__WEBPACK_IMPORTED_MODULE_6__["default"].type:
                // Only used to check triggers
                break;
        }

        this.checkTriggers();
    }

    processCombatStartEvent(event) {
        // console.log("Combat Start " + (this.simulationTime / 1000000000));
        for (let i = 0; i < this.players.length; i++) {
            if (event.time == 0) { // First combat start event
                this.players[i].generatePermanentBuffs();
            }
            this.players[i].reset(this.simulationTime);
        }
        let regenTickEvent = new _events_regenTickEvent__WEBPACK_IMPORTED_MODULE_10__["default"](this.simulationTime + REGEN_TICK_INTERVAL);
        this.eventQueue.addEvent(regenTickEvent);

        this.startNewEncounter();
    }

    processPlayerRespawnEvent(event) {
        // console.log("Player " + event.hrid + " respawn at " + + (this.simulationTime / 1000000000));
        let respawningPlayer = this.players.find(player => player.hrid === event.hrid);
        respawningPlayer.combatDetails.currentHitpoints = respawningPlayer.combatDetails.maxHitpoints;
        respawningPlayer.combatDetails.currentManapoints = respawningPlayer.combatDetails.maxManapoints;
        respawningPlayer.clearBuffs();
        respawningPlayer.clearCCs();
        if (this.allPlayersDead) {
            this.allPlayersDead = false;
            this.startAttacks();
        } else {
            this.addNextAttackEvent(respawningPlayer);
        }
    }

    processEnemyRespawnEvent(event) {
        this.startNewEncounter();
    }

    startNewEncounter() {
        if (this.allPlayersDead) {
            this.allPlayersDead = false;
            this.zone.failWave();
        }

        if (!this.zone.isDungeon) {
            this.enemies = this.zone.getRandomEncounter();
        } else {
            this.enemies = this.zone.getNextWave();
            this.simResult.updateTimeSpentAlive("#" + (this.zone.encountersKilled - 1).toString(), true, this.simulationTime);
            let currentDungeonCount = this.zone.dungeonsCompleted;
            if (currentDungeonCount > tempDungeonCount) {
                tempDungeonCount = currentDungeonCount;
                for (let i = 0; i < this.players.length; i++) {
                    this.players[i].combatDetails.currentHitpoints = this.players[i].combatDetails.maxHitpoints;
                    this.players[i].combatDetails.currentManapoints = this.players[i].combatDetails.maxManapoints;
                }
            }
        }

        this.enemies.forEach((enemy) => {
            enemy.reset(this.simulationTime);
            this.simResult.updateTimeSpentAlive(enemy.hrid, true, this.simulationTime);
            //console.log(enemy.hrid, "spawned");
        });

        this.startAttacks();
    }

    startAttacks() {
        let units = [...this.players];
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

        const aliveTargets = targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0);

        for (let i = 0; i < aliveTargets.length; i++) {
            let target = aliveTargets[i];
            if (!event.source.isPlayer && aliveTargets.length > 1) {
                let cumulativeThreat = 0;
                let cumulativeRanges = [];
                aliveTargets.forEach(player => {
                    let playerThreat = player.combatDetails.combatStats.threat;
                    cumulativeThreat += playerThreat;
                    cumulativeRanges.push({
                        player: player,
                        rangeStart: cumulativeThreat - playerThreat,
                        rangeEnd: cumulativeThreat
                    });
                });
                let randomValueHit = Math.random() * cumulativeThreat;
                target = cumulativeRanges.find(range => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd).player;
            }
            let source = event.source;

            if (target.combatDetails.combatStats.parry > Math.random()) {
                let temp = source;
                source = target;
                target = temp;
            }

            let attackResult = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processAttack(source, target);

            let mayhem = source.combatDetails.combatStats.mayhem > Math.random();

            if (attackResult.didHit && source.combatDetails.combatStats.curse > 0) {
                let curseExpireTime = this.simulationTime + 15000000000;
                target.addCurse(source.combatDetails.combatStats.curse);
                this.eventQueue.clearMatching((event) => event.type == _events_curseExpirationEvent__WEBPACK_IMPORTED_MODULE_14__["default"].type && event.source == target)
                let curseExpirationEvent = new _events_curseExpirationEvent__WEBPACK_IMPORTED_MODULE_14__["default"](curseExpireTime, target);
                this.eventQueue.addEvent(curseExpirationEvent);
            }

            if (source.combatDetails.combatStats.fury > 0) {
                this.eventQueue.clearMatching((event) => event.type == _events_furyExpirationEvent__WEBPACK_IMPORTED_MODULE_16__["default"].type && event.source == source);
                let oldFuryValue = source.furyValue;
                let nowFuryValue = source.updateFury(attackResult.didHit, source.combatDetails.combatStats.fury);

                const furyExpireTime = 15000000000;
                let furryExpireTime = this.simulationTime + furyExpireTime;

                if (nowFuryValue > 0) {
                    let furyExpirationEvent = new _events_furyExpirationEvent__WEBPACK_IMPORTED_MODULE_16__["default"](furryExpireTime, source);
                    this.eventQueue.addEvent(furyExpirationEvent);
                }

                if (oldFuryValue != nowFuryValue) {
                    const furyAccuracyBuf = {
                        "uniqueHrid": "/buff_uniques/fury_accuracy",
                        "typeHrid": "/buff_types/fury_accuracy",
                        "ratioBoost": 0,
                        "ratioBoostLevelBonus": 0,
                        "flatBoost": source.combatDetails.combatStats.fury,
                        "flatBoostLevelBonus": 0,
                        "startTime": "0001-01-01T00:00:00Z",
                        "duration": furyExpireTime
                    };
                    const furyDamageBuf = {
                        "uniqueHrid": "/buff_uniques/fury_damage",
                        "typeHrid": "/buff_types/fury_damage",
                        "ratioBoost": 0,
                        "ratioBoostLevelBonus": 0,
                        "flatBoost": source.combatDetails.combatStats.fury,
                        "flatBoostLevelBonus": 0,
                        "startTime": "0001-01-01T00:00:00Z",
                        "duration": furyExpireTime
                    };

                    if (attackResult.didHit) {
                        source.addBuff(furyAccuracyBuf, this.simulationTime);
                        source.addBuff(furyDamageBuf, this.simulationTime);
                    }
                    else if (nowFuryValue == 0) {
                        source.removeBuff(furyAccuracyBuf);
                        source.removeBuff(furyDamageBuf);
                    }
                }
            }

            if (target.combatDetails.combatStats.weaken > 0) {
                source.isWeakened = true;
                source.weakenExpireTime = this.simulationTime + 15000000000;
                let currentWeakenEvent = this.eventQueue.getMatching((event) => event.type == _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"].type && event.source == source);
                let weakenAmount = 0;
                if (currentWeakenEvent)
                    weakenAmount = currentWeakenEvent.weakenAmount;
                this.eventQueue.clearMatching((event) => event.type == _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"].type && event.source == source);
                let weakenExpirationEvent = new _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"](source.weakenExpireTime, weakenAmount, source);
                source.weakenPercentage = weakenExpirationEvent.weakenAmount * 2 / 100;
                this.eventQueue.addEvent(weakenExpirationEvent);
            }

            if (!mayhem || (mayhem && attackResult.didHit) || (mayhem && i == (aliveTargets.length - 1))) {
                this.simResult.addAttack(
                    source,
                    target,
                    "autoAttack",
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );
            }

            if (attackResult.lifeStealHeal > 0) {
                this.simResult.addHitpointsGained(source, "lifesteal", attackResult.lifeStealHeal);
            }

            if (attackResult.manaLeechMana > 0) {
                this.simResult.addManapointsGained(source, "manaLeech", attackResult.manaLeechMana);
            }

            if (attackResult.reflectDamageDone > 0) {
                this.simResult.addAttack(target, source, attackResult.thornType, attackResult.reflectDamageDone);
            }

            if (mayhem && !attackResult.didHit && i < (aliveTargets.length - 1)) {
                attackResult.experienceGained.source = {
                    attack: 0,
                    power: 0,
                    ranged: 0,
                    magic: 0
                }
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

            if (mayhem && !attackResult.didHit) {
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
            this.eventQueue.clearEventsOfType(_events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"].type);
            this.eventQueue.clearEventsOfType(_events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__["default"].type);
            let enemyRespawnEvent = new _events_enemyRespawnEvent__WEBPACK_IMPORTED_MODULE_7__["default"](this.simulationTime + ENEMY_RESPAWN_INTERVAL);
            this.eventQueue.addEvent(enemyRespawnEvent);
            this.enemies = null;

            if (this.zone.isDungeon) {
                this.simResult.updateTimeSpentAlive("#" + (this.zone.encountersKilled - 1).toString(), false, this.simulationTime);
            }
            this.simResult.addEncounterEnd();
            // console.log("All enemies died");

            encounterEnded = true;
            // console.log("encounter end " + (this.simulationTime / 1000000000))
        }

        this.players.forEach(player => {
            if ((player.combatDetails.currentHitpoints <= 0) && !this.eventQueue.containsEventOfTypeAndHrid(_events_playerRespawnEvent__WEBPACK_IMPORTED_MODULE_9__["default"].type, player.hrid)) {
                if (!this.zone.isDungeon) {
                    let playerRespawnEvent = new _events_playerRespawnEvent__WEBPACK_IMPORTED_MODULE_9__["default"](this.simulationTime + PLAYER_RESPAWN_INTERVAL, player.hrid);
                    this.eventQueue.addEvent(playerRespawnEvent);
                }
                // console.log(player.hrid + " died at " + (this.simulationTime / 1000000000));
            }
        });

        if (
            !this.players.some((player) => player.combatDetails.currentHitpoints > 0)
        ) {
            if (this.zone.isDungeon) {
                console.log("All Players died at wave #" + (this.zone.encountersKilled - 1) + " with ememies: " + this.enemies.map(enemy => (enemy.hrid+"("+(enemy.combatDetails.currentHitpoints*100/enemy.combatDetails.maxHitpoints).toFixed(2)+"%)")).join(", "));

                this.eventQueue.clear();
                this.enemies = null;

                let combatStartEvent = new _events_combatStartEvent__WEBPACK_IMPORTED_MODULE_4__["default"](this.simulationTime + RESTART_INTERVAL);
                this.eventQueue.addEvent(combatStartEvent);
            } else {
                this.eventQueue.clearEventsOfType(_events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"].type);
                this.eventQueue.clearEventsOfType(_events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__["default"].type);
            }
            // console.log("All Players died");
            encounterEnded = true;
            this.allPlayersDead = true;
        }

        return encounterEnded;
    }

    addNextAttackEvent(source) {
        let target;
        let friendlies;
        let enemies;
        if (source.isPlayer) {
            target = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].getTarget(this.enemies);
            friendlies = this.players;
            enemies = this.enemies;
        } else {
            target = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].getTarget(this.players);
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
                    let abilityCastEndEvent = new _events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__["default"](this.simulationTime + castDuration, source, ability);
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
            let autoAttackEvent = new _events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"](
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
                let autoAttackEvent = new _events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"](
                    source.blindExpireTime + source.combatDetails.combatStats.attackInterval,
                    source
                );
                /*-if (source.isPlayer) {
                    // console.log("next attack " + ((source.blindExpireTime + source.combatDetails.combatStats.attackInterval) / 1e9))
                }*/
                this.eventQueue.addEvent(autoAttackEvent);
            } else {
                let awaitCooldownEvent = new _events_awaitCooldownEvent__WEBPACK_IMPORTED_MODULE_19__["default"](
                    nextCast,
                    source
                );
                this.eventQueue.addEvent(awaitCooldownEvent);
            }
        }
    }

    processConsumableTickEvent(event) {
        if (event.consumable.hitpointRestore > 0) {
            let tickValue = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateTickValue(
                event.consumable.hitpointRestore,
                event.totalTicks,
                event.currentTick
            );
            let hitpointsAdded = event.source.addHitpoints(tickValue);
            this.simResult.addHitpointsGained(event.source, event.consumable.hrid, hitpointsAdded);
            // console.log("Added hitpoints:", hitpointsAdded);
        }

        if (event.consumable.manapointRestore > 0) {
            let tickValue = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateTickValue(
                event.consumable.manapointRestore,
                event.totalTicks,
                event.currentTick
            );
            let manapointsAdded = event.source.addManapoints(tickValue);
            this.simResult.addManapointsGained(event.source, event.consumable.hrid, manapointsAdded);
            // console.log("Added manapoints:", manapointsAdded);
        }

        if (event.currentTick < event.totalTicks) {
            let consumableTickEvent = new _events_consumableTickEvent__WEBPACK_IMPORTED_MODULE_5__["default"](
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
        let tickDamage = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateTickValue(event.damage, event.totalTicks, event.currentTick);
        let damage = Math.min(tickDamage, event.target.combatDetails.currentHitpoints);

        event.target.combatDetails.currentHitpoints -= damage;
        this.simResult.addAttack(event.sourceRef, event.target, "damageOverTime", damage);

        let targetStaminaExperience = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateStaminaExperience(0, damage);
        this.simResult.addExperienceGain(event.target, "stamina", targetStaminaExperience);
        // console.log(event.target.hrid, "bleed for", damage);

        switch (event.combatStyleHrid) {
            case "/combat_styles/magic":
                let sourceMagicExperience = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateMagicExperience(damage, 0);
                this.simResult.addExperienceGain(event.sourceRef, "magic", sourceMagicExperience);
                break;
            case "/combat_styles/slash":
                let sourceAttackExperience = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateAttackExperience(damage, 0, "/combat_styles/slash");
                this.simResult.addExperienceGain(event.sourceRef, "attack", sourceAttackExperience);
                let sourcePowerExperience = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculatePowerExperience(damage, 0, "/combat_styles/slash");
                this.simResult.addExperienceGain(event.sourceRef, "power", sourcePowerExperience);
                break;
        }

        if (event.currentTick < event.totalTicks) {
            let damageOverTimeTickEvent = new _events_damageOverTimeEvent__WEBPACK_IMPORTED_MODULE_2__["default"](
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

            let hitpointRegen = Math.floor(unit.combatDetails.maxHitpoints * unit.combatDetails.combatStats.hpRegenPer10);
            let hitpointsAdded = unit.addHitpoints(hitpointRegen);
            this.simResult.addHitpointsGained(unit, "regen", hitpointsAdded);
            // console.log("Added hitpoints:", hitpointsAdded);

            let manapointRegen = Math.floor(unit.combatDetails.maxManapoints * unit.combatDetails.combatStats.mpRegenPer10);
            let manapointsAdded = unit.addManapoints(manapointRegen);
            this.simResult.addManapointsGained(unit, "regen", manapointsAdded);
            // console.log("Added manapoints:", manapointsAdded);
        }

        let regenTickEvent = new _events_regenTickEvent__WEBPACK_IMPORTED_MODULE_10__["default"](this.simulationTime + REGEN_TICK_INTERVAL);
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
        event.source.curseValue = 0;
    }

    processWeakenExpirationEvent(event) {
        event.source.isWeakened = false;
        event.source.weakenPercentage = 0;
    }

    processFuryExpirationEvent(event) {
        event.source.furyValue = 0;
        console.log("Fury Timeout");
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
        let target = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].getTarget(enemies);

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
        let consumeCooldown = consumable.cooldownDuration;
        if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes("drink")) {
            consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.drinkConcentration);
        } else if (source.combatDetails.combatStats.foodHaste > 0 && consumable.catagoryHrid.includes("food")) {
            consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.foodHaste);
        }
        let cooldownReadyEvent = new _events_cooldownReadyEvent__WEBPACK_IMPORTED_MODULE_6__["default"](this.simulationTime + consumeCooldown);
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
            let consumableTickEvent = new _events_consumableTickEvent__WEBPACK_IMPORTED_MODULE_5__["default"](
                this.simulationTime + HOT_TICK_INTERVAL,
                source,
                consumable,
                consumable.recoveryDuration / HOT_TICK_INTERVAL,
                1
            );
            this.eventQueue.addEvent(consumableTickEvent);
        }

        for (const buff of consumable.buffs) {
            let currentBuff = structuredClone(buff);
            if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes("drink")) {
                currentBuff.ratioBoost *= (1 + source.combatDetails.combatStats.drinkConcentration);
                currentBuff.flatBoost *= (1 + source.combatDetails.combatStats.drinkConcentration);
                currentBuff.duration = currentBuff.duration / (1 + source.combatDetails.combatStats.drinkConcentration);
            }
            source.addBuff(currentBuff, this.simulationTime);
            // console.log("Added buff:", currentBuff);
            let checkBuffExpirationEvent = new _events_checkBuffExpirationEvent__WEBPACK_IMPORTED_MODULE_3__["default"](this.simulationTime + currentBuff.duration, source);
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
                this.simResult.playerRanOutOfMana[source.hrid] = true;
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

        let sourceIntelligenceExperience = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateIntelligenceExperience(ability.manaCost);
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

        let todoAbilities = [ability];

        if (source.combatDetails.combatStats.blaze > 0 && Math.random() < source.combatDetails.combatStats.blaze) {
            todoAbilities.push(new _ability__WEBPACK_IMPORTED_MODULE_21__["default"]("blaze"));
        }

        if (source.combatDetails.combatStats.bloom > 0 && Math.random() < source.combatDetails.combatStats.bloom) {
            todoAbilities.push(new _ability__WEBPACK_IMPORTED_MODULE_21__["default"]("bloom"));
        }

        for (const todoAbility of todoAbilities) {
            for (const abilityEffect of todoAbility.abilityEffects) {
                switch (abilityEffect.effectType) {
                    case "/ability_effect_types/buff":
                        this.processAbilityBuffEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/damage":
                        this.processAbilityDamageEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/heal":
                        this.processAbilityHealEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/spend_hp":
                        this.processAbilitySpendHpEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/revive":
                        this.processAbilityReviveEffect(source, todoAbility, abilityEffect);
                        break;
                    case "/ability_effect_types/promote":
                        this.eventQueue.clearEventsForUnit(source);
                        source = this.processAbilityPromoteEffect(source, todoAbility, abilityEffect);
                        this.addNextAttackEvent(source);
                        break;
                    default:
                        throw new Error("Unsupported effect type for ability: " + todoAbility.hrid + " effectType: " + abilityEffect.effectType);
                }
            }
        }

        if (source.combatDetails.combatStats.ripple > 0 && Math.random() < source.combatDetails.combatStats.ripple) {
            for (const skill of source.abilities) {
                if (skill && skill.lastUsed) {
                    const remainingCooldown = skill.lastUsed + skill.cooldownDuration - this.simulationTime;
                    if (remainingCooldown > 0) {
                        skill.lastUsed = Math.max(skill.lastUsed - ONE_SECOND * 2, this.simulationTime - skill.cooldownDuration);
                    }
                }
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
        if (abilityEffect.targetType == "allAllies") {
            let targets = source.isPlayer ? this.players : this.enemies;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                for (const buff of abilityEffect.buffs) {
                    target.addBuff(buff, this.simulationTime);
                    let checkBuffExpirationEvent = new _events_checkBuffExpirationEvent__WEBPACK_IMPORTED_MODULE_3__["default"](this.simulationTime + buff.duration, target);
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
            let checkBuffExpirationEvent = new _events_checkBuffExpirationEvent__WEBPACK_IMPORTED_MODULE_3__["default"](this.simulationTime + buff.duration, source);
            this.eventQueue.addEvent(checkBuffExpirationEvent);
        }
    }

    processAbilityDamageEffect(source, ability, abilityEffect) {
        let targets;
        switch (abilityEffect.targetType) {
            case "enemy":
            case "allEnemies":
                targets = source.isPlayer ? this.enemies : this.players;
                break;
            default:
                throw new Error("Unsupported target type for damage ability effect: " + ability.hrid);
        }

        if (!targets) {
            return;
        }

        for (let target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
            if (target.combatDetails.combatStats.parry > Math.random()) {
                let tempTarget = source;
                let tempSource = target;

                let attackResult = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processAttack(tempSource, tempTarget);

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
                    this.simResult.addAttack(tempTarget, tempSource, attackResult.thornType, attackResult.reflectDamageDone);
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
                targets = targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0);
                if (!source.isPlayer && targets.length > 1 && abilityEffect.targetType == "enemy") {
                    let cumulativeThreat = 0;
                    let cumulativeRanges = [];
                    targets.forEach(player => {
                        let playerThreat = player.combatDetails.combatStats.threat;
                        cumulativeThreat += playerThreat;
                        cumulativeRanges.push({
                            player: player,
                            rangeStart: cumulativeThreat - playerThreat,
                            rangeEnd: cumulativeThreat
                        });
                    });
                    let randomValueHit = Math.random() * cumulativeThreat;
                    target = cumulativeRanges.find(range => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd).player;
                }

                let attackResult = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processAttack(source, target, abilityEffect);

                if (attackResult.hpDrain > 0) {
                    this.simResult.addHitpointsGained(source, ability.hrid, attackResult.hpDrain);
                }

                if (attackResult.didHit && abilityEffect.buffs) {
                    for (const buff of abilityEffect.buffs) {
                        target.addBuff(buff, this.simulationTime);
                        let checkBuffExpirationEvent = new _events_checkBuffExpirationEvent__WEBPACK_IMPORTED_MODULE_3__["default"](
                            this.simulationTime + buff.duration,
                            target
                        );
                        this.eventQueue.addEvent(checkBuffExpirationEvent);
                    }
                }

                if (abilityEffect.damageOverTimeRatio > 0 && attackResult.damageDone > 0) {
                    let damageOverTimeEvent = new _events_damageOverTimeEvent__WEBPACK_IMPORTED_MODULE_2__["default"](
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
                    this.eventQueue.clearMatching((event) => (event.type == _events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"].type || event.type == _events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__["default"].type || event.type == _events_stunExpirationEvent__WEBPACK_IMPORTED_MODULE_11__["default"].type) && event.source == target);
                    let stunExpirationEvent = new _events_stunExpirationEvent__WEBPACK_IMPORTED_MODULE_11__["default"](target.stunExpireTime, target);
                    this.eventQueue.addEvent(stunExpirationEvent);
                }

                if (attackResult.didHit && abilityEffect.blindChance > 0 && Math.random() < (abilityEffect.blindChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isBlinded = true;
                    target.blindExpireTime = this.simulationTime + abilityEffect.blindDuration;
                    this.eventQueue.clearMatching((event) => event.type == _events_blindExpirationEvent__WEBPACK_IMPORTED_MODULE_12__["default"].type && event.source == target)
                    if (this.eventQueue.clearMatching((event) => event.type == _events_autoAttackEvent__WEBPACK_IMPORTED_MODULE_1__["default"].type && event.source == target)) {
                        // console.log("Blind " + (this.simulationTime / 1000000000));
                        this.addNextAttackEvent(target);
                    }
                    let blindExpirationEvent = new _events_blindExpirationEvent__WEBPACK_IMPORTED_MODULE_12__["default"](target.blindExpireTime, target);
                    this.eventQueue.addEvent(blindExpirationEvent);
                }

                if (attackResult.didHit && abilityEffect.silenceChance > 0 && Math.random() < (abilityEffect.silenceChance * 100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    target.isSilenced = true;
                    target.silenceExpireTime = this.simulationTime + abilityEffect.silenceDuration;
                    this.eventQueue.clearMatching((event) => event.type == _events_silenceExpirationEvent__WEBPACK_IMPORTED_MODULE_13__["default"].type && event.source == target)
                    if (this.eventQueue.clearMatching((event) => event.type == _events_abilityCastEndEvent__WEBPACK_IMPORTED_MODULE_18__["default"].type && event.source == target)) {
                        // console.log("Silence " + (this.simulationTime / 1000000000));
                        this.addNextAttackEvent(target);
                    }
                    let silenceExpirationEvent = new _events_silenceExpirationEvent__WEBPACK_IMPORTED_MODULE_13__["default"](target.silenceExpireTime, target);
                    this.eventQueue.addEvent(silenceExpirationEvent);
                }

                if (attackResult.didHit && source.combatDetails.combatStats.curse > 0 && Math.random() < (100 / (100 + target.combatDetails.combatStats.tenacity))) {
                    let curseExpireTime = this.simulationTime + 15000000000;
                    target.addCurse(source.combatDetails.combatStats.curse);
                    this.eventQueue.clearMatching((event) => event.type == _events_curseExpirationEvent__WEBPACK_IMPORTED_MODULE_14__["default"].type && event.source == target)
                    let curseExpirationEvent = new _events_curseExpirationEvent__WEBPACK_IMPORTED_MODULE_14__["default"](curseExpireTime, target);
                    this.eventQueue.addEvent(curseExpirationEvent);
                }

                if (target.combatDetails.combatStats.weaken > 0) {
                    source.isWeakened = true;
                    source.weakenExpireTime = this.simulationTime + 15000000000;
                    let currentWeakenEvent = this.eventQueue.getMatching((event) => event.type == _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"].type && event.source == source);
                    let weakenAmount = 0;
                    if (currentWeakenEvent)
                        weakenAmount = currentWeakenEvent.weakenAmount;
                    this.eventQueue.clearMatching((event) => event.type == _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"].type && event.source == source);
                    let weakenExpirationEvent = new _events_weakenExpirationEvent__WEBPACK_IMPORTED_MODULE_15__["default"](source.weakenExpireTime, weakenAmount, source);
                    source.weakenPercentage = weakenExpirationEvent.weakenAmount * 2 / 100;
                    this.eventQueue.addEvent(weakenExpirationEvent);
                }

                this.simResult.addAttack(
                    source,
                    target,
                    ability.hrid,
                    attackResult.didHit ? attackResult.damageDone : "miss"
                );

                if (attackResult.reflectDamageDone > 0) {
                    this.simResult.addAttack(target, source, attackResult.thornType, attackResult.reflectDamageDone);
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

        if (abilityEffect.targetType == "allAllies") {
            let targets = source.isPlayer ? this.players : this.enemies;
            for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
                let amountHealed = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processHeal(source, abilityEffect, target);
                let experienceGained = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateHealingExperience(amountHealed);

                this.simResult.addHitpointsGained(target, ability.hrid, amountHealed);
                this.simResult.addExperienceGain(source, "magic", experienceGained);
            }
            return;
        }

        if (abilityEffect.targetType == "lowestHpAlly") {
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
                let amountHealed = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processHeal(source, abilityEffect, healTarget);
                let experienceGained = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateHealingExperience(amountHealed);

                this.simResult.addHitpointsGained(healTarget, ability.hrid, amountHealed);
                this.simResult.addExperienceGain(source, "magic", experienceGained);
            }
            return;
        }

        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for heal ability effect: " + ability.hrid);
        }

        let amountHealed = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processHeal(source, abilityEffect, source);
        let experienceGained = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateHealingExperience(amountHealed);

        this.simResult.addHitpointsGained(source, ability.hrid, amountHealed);
        this.simResult.addExperienceGain(source, "magic", experienceGained);
    }

    processAbilityReviveEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType != "deadAlly") {
            throw new Error("Unsupported target type for revive ability effect: " + ability.hrid);
        }

        let targets = source.isPlayer ? this.players : this.enemies;
        let reviveTarget = targets.find((unit) => unit && unit.combatDetails.currentHitpoints <= 0);

        if (reviveTarget) {
            this.eventQueue.clearMatching((event) => event.type == _events_playerRespawnEvent__WEBPACK_IMPORTED_MODULE_9__["default"].type && event.hrid == reviveTarget.hrid);
            let amountHealed = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processRevive(source, abilityEffect, reviveTarget);
            let experienceGained = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateHealingExperience(amountHealed);

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

    processAbilityPromoteEffect(source, ability, abilityEffect) {
        const promotionHrids = ["/monsters/enchanted_rook", "/monsters/enchanted_knight", "/monsters/enchanted_bishop"];
        let randomPromotionIndex = Math.floor(Math.random() * promotionHrids.length);
        return new _monster__WEBPACK_IMPORTED_MODULE_20__["default"](promotionHrids[randomPromotionIndex], source.eliteTier);
    }

    processAbilitySpendHpEffect(source, ability, abilityEffect) {
        if (abilityEffect.targetType != "self") {
            throw new Error("Unsupported target type for spend hp ability effect: " + ability.hrid);
        }

        let hpSpent = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].processSpendHp(source, abilityEffect);
        let experienceGained = _combatUtilities__WEBPACK_IMPORTED_MODULE_0__["default"].calculateStaminaExperience(0, hpSpent);

        this.simResult.addHitpointsSpent(source, ability.hrid, hpSpent);
        this.simResult.addExperienceGain(source, "stamina", experienceGained);
    }
}

onmessage = async function (event) {
    switch (event.data.type) {
        case "start_simulation":
            try {
                const simulationResult = await event.data.simulator.simulate(event.data.simulationTimeLimit);
                this.postMessage({
                    type: "simulation_result",
                    simResult: simulationResult,
                })
            } catch (error) {
                this.postMessage({
                    type: "simulation_error",
                    error: error.message,
                })
            }
            break;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CombatSimulator);


/***/ }),

/***/ "./src/combatsimulator/combatUnit.js":
/*!*******************************************!*\
  !*** ./src/combatsimulator/combatUnit.js ***!
  \*******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class CombatUnit {
    isPlayer;
    isStunned = false;
    stunExpireTime = null;
    isBlinded = false;
    blindExpireTime = null;
    isSilenced = false;
    silenceExpireTime = null;
    curseValue = 0;
    furyValue = 0;
    isWeakened = false;
    weakenExpireTime = null;
    weakenPercentage = 0;

    // Base levels which don't change after initialization
    staminaLevel = 1;
    intelligenceLevel = 1;
    attackLevel = 1;
    powerLevel = 1;
    defenseLevel = 1;
    rangedLevel = 1;
    magicLevel = 1;

    abilities = [null, null, null, null];
    food = [null, null, null];
    drinks = [null, null, null];
    houseRooms = [];
    dropTable = [];
    rareDropTable = [];
    abilityManaCosts = new Map();

    // Calculated combat stats including temporary buffs
    combatDetails = {
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        powerLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        maxHitpoints: 110,
        currentHitpoints: 110,
        maxManapoints: 110,
        currentManapoints: 110,
        stabAccuracyRating: 11,
        slashAccuracyRating: 11,
        smashAccuracyRating: 11,
        rangedAccuracyRating: 11,
        magicAccuracyRating: 11,
        stabMaxDamage: 11,
        slashMaxDamage: 11,
        smashMaxDamage: 11,
        rangedMaxDamage: 11,
        magicMaxDamage: 11,
        stabEvasionRating: 11,
        slashEvasionRating: 11,
        smashEvasionRating: 11,
        rangedEvasionRating: 11,
        magicEvasionRating: 11,
        totalArmor: 0.2,
        totalWaterResistance: 0.4,
        totalNatureResistance: 0.4,
        totalFireResistance: 0.4,
        abilityHaste: 0,
        tenacity: 0,
        totalThreat: 100,
        combatStats: {
            combatStyleHrid: "/combat_styles/smash",
            damageType: "/damage_types/physical",
            attackInterval: 3000000000,
            autoAttackDamage: 0,
            criticalRate: 0,
            criticalDamage: 0,
            stabAccuracy: 0,
            slashAccuracy: 0,
            smashAccuracy: 0,
            rangedAccuracy: 0,
            magicAccuracy: 0,
            stabDamage: 0,
            slashDamage: 0,
            smashDamage: 0,
            rangedDamage: 0,
            magicDamage: 0,
            taskDamage: 0,
            physicalAmplify: 0,
            waterAmplify: 0,
            natureAmplify: 0,
            fireAmplify: 0,
            healingAmplify: 0,
            physicalThorns: 0,
            elementalThorns: 0,
            maxHitpoints: 0,
            maxManapoints: 0,
            stabEvasion: 0,
            slashEvasion: 0,
            smashEvasion: 0,
            rangedEvasion: 0,
            magicEvasion: 0,
            armor: 0,
            waterResistance: 0,
            natureResistance: 0,
            fireResistance: 0,
            lifeSteal: 0,
            hpRegenPer10: 0.01,
            mpRegenPer10: 0.01,
            combatDropRate: 0,
            combatDropQuantity: 0,
            combatRareFind: 0,
            combatExperience: 0,
            foodSlots: 1,
            drinkSlots: 1,
            armorPenetration: 0,
            waterPenetration: 0,
            naturePenetration: 0,
            firePenetration: 0,
            manaLeech: 0,
            castSpeed: 0,
            threat: 100,
            parry: 0,
            mayhem: 0,
            pierce: 0,
            curse: 0,
            ripple: 0,
            bloom: 0,
            blaze: 0,
            weaken: 0,
            fury: 0,
            foodHaste: 0,
            drinkConcentration: 0,
            damageTaken: 0,
            attackSpeed: 0,
            armorDamageRatio: 0,
            hpDrainRatio: 0
        },
    };
    combatBuffs = {};
    permanentBuffs = {};
    zoneBuffs = {};

    constructor() { }

    updateCombatDetails() {
        if (this.isPlayer) {
            if (this.combatDetails.combatStats.hpRegenPer10 === 0) {
                this.combatDetails.combatStats.hpRegenPer10 = 0.01;
            } else {
                this.combatDetails.combatStats.hpRegenPer10 = 0.01 + this.combatDetails.combatStats.hpRegenPer10;
            }
            if (this.combatDetails.combatStats.mpRegenPer10 === 0) {
                this.combatDetails.combatStats.mpRegenPer10 = 0.01;
            } else {
                this.combatDetails.combatStats.mpRegenPer10 = 0.01 + this.combatDetails.combatStats.mpRegenPer10;
            }
        }

        ["stamina", "intelligence", "attack", "power", "defense", "ranged", "magic"].forEach((stat) => {
            this.combatDetails[stat + "Level"] = this[stat + "Level"];
            let boosts = this.getBuffBoosts("/buff_types/" + stat + "_level");
            boosts.forEach((buff) => {
                this.combatDetails[stat + "Level"] += Math.floor(this[stat + "Level"] * buff.ratioBoost);
                this.combatDetails[stat + "Level"] += buff.flatBoost;
            });
        });

        this.combatDetails.maxHitpoints =
            10 * (10 + this.combatDetails.staminaLevel) + this.combatDetails.combatStats.maxHitpoints;
        this.combatDetails.maxManapoints =
            10 * (10 + this.combatDetails.intelligenceLevel) + this.combatDetails.combatStats.maxManapoints;

        let accuracyRatioBoost = this.getBuffBoost("/buff_types/accuracy").ratioBoost;
        let damageRatioBoost = this.getBuffBoost("/buff_types/damage").ratioBoost;

        ["stab", "slash", "smash"].forEach((style) => {
            this.combatDetails[style + "AccuracyRating"] =
                (10 + this.combatDetails.attackLevel) *
                (1 + this.combatDetails.combatStats[style + "Accuracy"]) *
                (1 + accuracyRatioBoost) *
                (1 + this.furyValue);
            this.combatDetails[style + "MaxDamage"] =
                (10 + this.combatDetails.powerLevel) *
                (1 + this.combatDetails.combatStats[style + "Damage"]) *
                (1 + damageRatioBoost) *
                (1 + this.furyValue);
            let baseEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + "Evasion"]);
            this.combatDetails[style + "EvasionRating"] = baseEvasion;
            let evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
            for (const boost of evasionBoosts) {
                this.combatDetails[style + "EvasionRating"] += boost.flatBoost;
                this.combatDetails[style + "EvasionRating"] += baseEvasion * boost.ratioBoost;
            }
        });

        this.combatDetails.rangedAccuracyRating =
            (10 + this.combatDetails.rangedLevel) *
            (1 + this.combatDetails.combatStats.rangedAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + this.furyValue);
        this.combatDetails.rangedMaxDamage =
            (10 + this.combatDetails.rangedLevel) *
            (1 + this.combatDetails.combatStats.rangedDamage) *
            (1 + damageRatioBoost) *
            (1 + this.furyValue);

        let baseRangedEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);
        this.combatDetails.rangedEvasionRating = baseRangedEvasion;
        let evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
        for (const boost of evasionBoosts) {
            this.combatDetails.rangedEvasionRating += boost.flatBoost;
            this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;
        }

        let baseDamageTaken = this.curseValue;
        this.combatDetails.combatStats.damageTaken = baseDamageTaken;
        let damageTakens = this.getBuffBoosts("/buff_types/damage_taken");
        for (const boost of damageTakens) {
            this.combatDetails.combatStats.damageTaken += boost.flatBoost;
        }
        // if (this.combatDetails.combatStats.damageTaken > 0) {
        //     console.log("Damage taken: " + this.combatDetails.combatStats.damageTaken);
        // }

        this.combatDetails.magicAccuracyRating =
            (10 + this.combatDetails.magicLevel) *
            (1 + this.combatDetails.combatStats.magicAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + this.furyValue);
        this.combatDetails.magicMaxDamage =
            (10 + this.combatDetails.magicLevel) *
            (1 + this.combatDetails.combatStats.magicDamage) *
            (1 + damageRatioBoost) *
            (1 + this.furyValue);

        let baseMagicEvasion = (10 + (this.combatDetails.defenseLevel * 0.75 + this.combatDetails.rangedLevel * 0.25)) * (1 + this.combatDetails.combatStats.magicEvasion);
        this.combatDetails.magicEvasionRating = baseMagicEvasion;
        for (const boost of evasionBoosts) {
            this.combatDetails.magicEvasionRating += boost.flatBoost;
            this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost("/buff_types/physical_amplify").flatBoost;
        this.combatDetails.combatStats.waterAmplify += this.getBuffBoost("/buff_types/water_amplify").flatBoost;
        this.combatDetails.combatStats.natureAmplify += this.getBuffBoost("/buff_types/nature_amplify").flatBoost;
        this.combatDetails.combatStats.fireAmplify += this.getBuffBoost("/buff_types/fire_amplify").flatBoost;

        if (this.isPlayer) {
            this.combatDetails.combatStats.attackInterval /= (1 + (this.combatDetails.attackLevel / 2000));
        }
        let baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
        let attackIntervalBoosts = this.getBuffBoosts("/buff_types/attack_speed");
        let attackIntervalRatioBoost = attackIntervalBoosts
            .map((boost) => boost.ratioBoost)
            .reduce((prev, cur) => prev + cur, 0);
        this.combatDetails.combatStats.attackInterval /= (1 + (baseAttackSpeed + attackIntervalRatioBoost));

        let baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;
        this.combatDetails.totalArmor = baseArmor;
        let armorBoosts = this.getBuffBoosts("/buff_types/armor");
        for (const boost of armorBoosts) {
            this.combatDetails.totalArmor += boost.flatBoost;
            this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
        }

        let baseWaterResistance =
            0.1 * (this.combatDetails.defenseLevel + this.combatDetails.magicLevel) +
            this.combatDetails.combatStats.waterResistance;
        this.combatDetails.totalWaterResistance = baseWaterResistance;
        let waterResistanceBoosts = this.getBuffBoosts("/buff_types/water_resistance");
        for (const boost of waterResistanceBoosts) {
            this.combatDetails.totalWaterResistance += boost.flatBoost;
            this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;
        }

        let baseNatureResistance =
            0.1 * (this.combatDetails.defenseLevel + this.combatDetails.magicLevel) +
            this.combatDetails.combatStats.natureResistance;
        this.combatDetails.totalNatureResistance = baseNatureResistance;
        let natureResistanceBoosts = this.getBuffBoosts("/buff_types/nature_resistance");
        for (const boost of natureResistanceBoosts) {
            this.combatDetails.totalNatureResistance += boost.flatBoost;
            this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;
        }

        let baseFireResistance =
            0.1 * (this.combatDetails.defenseLevel + this.combatDetails.magicLevel) +
            this.combatDetails.combatStats.fireResistance;
        this.combatDetails.totalFireResistance = baseFireResistance;
        let fireResistanceBoosts = this.getBuffBoosts("/buff_types/fire_resistance");
        for (const boost of fireResistanceBoosts) {
            this.combatDetails.totalFireResistance += boost.flatBoost;
            this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;
        }

        let hpRegenBoosts = this.getBuffBoost("/buff_types/hp_regen");
        this.combatDetails.combatStats.hpRegenPer10 += this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

        let mpRegenBoosts = this.getBuffBoost("/buff_types/mp_regen");
        this.combatDetails.combatStats.mpRegenPer10 += this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

        this.combatDetails.combatStats.lifeSteal += this.getBuffBoost("/buff_types/life_steal").flatBoost;
        this.combatDetails.combatStats.physicalThorns += this.getBuffBoost(
            "/buff_types/physical_thorns"
        ).flatBoost;
        this.combatDetails.combatStats.elementalThorns += this.getBuffBoost(
            "/buff_types/elemental_thorns"
        ).flatBoost;
        this.combatDetails.combatStats.combatExperience += this.getBuffBoost("/buff_types/wisdom").flatBoost;
        this.combatDetails.combatStats.criticalRate += this.getBuffBoost("/buff_types/critical_rate").flatBoost;
        this.combatDetails.combatStats.criticalDamage += this.getBuffBoost("/buff_types/critical_damage").flatBoost;
        this.combatDetails.combatStats.castSpeed += this.getBuffBoost("/buff_types/cast_speed").flatBoost;

        let combatDropRateBoosts = this.getBuffBoost("/buff_types/combat_drop_rate");
        this.combatDetails.combatStats.combatDropRate += (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;
        let combatRareFindBoosts = this.getBuffBoost("/buff_types/rare_find");
        this.combatDetails.combatStats.combatRareFind += (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;
        this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;

        let baseThreat = 100 + this.combatDetails.combatStats.threat;
        this.combatDetails.totalThreat = baseThreat;
        let threatBoosts = this.getBuffBoost("/buff_types/threat");
        if(threatBoosts.ratioBoost !== 0) {
            this.combatDetails.combatStats.threat += baseThreat * threatBoosts.ratioBoost;               
        } else {
            this.combatDetails.combatStats.threat = baseThreat;   
        }
        this.combatDetails.combatStats.threat += threatBoosts.flatBoost;
    }

    addCurse(curse) {
        if (this.curseValue >= 0.1) {
            return;
        }

        this.curseValue += curse;
        this.updateCombatDetails();
    }

    updateFury(isHit, fury) {
        if (isHit && this.furyValue < 0.15) {
            this.furyValue += fury;
        }
        if (!isHit) {
            this.furyValue = Math.floor(this.furyValue / fury / 2) * fury;
        }

        // console.log("Fury value: " + this.furyValue);
        return this.furyValue;
    }

    addBuff(buff, currentTime) {
        buff.startTime = currentTime;
        this.combatBuffs[buff.uniqueHrid] = buff;

        this.updateCombatDetails();
    }

    removeBuff(buff) {
        if (!this.combatBuffs[buff.uniqueHrid]) {
            return;
        }
        delete this.combatBuffs[buff.uniqueHrid];

        this.updateCombatDetails();
    }

    addPermanentBuff(buff) {
        if (this.permanentBuffs[buff.typeHrid]) {
            this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
            this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
        } else {
            this.permanentBuffs[buff.typeHrid] = buff;
        }
    }

    generatePermanentBuffs() {
        for (let i = 0; i < this.houseRooms.length; i++) {
            const houseRoom = this.houseRooms[i];
            houseRoom.buffs.forEach(buff => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.zoneBuffs) {
            this.zoneBuffs.forEach(buff => {
                this.addPermanentBuff(buff);
            });
        }
    }

    removeExpiredBuffs(currentTime) {
        let expiredBuffs = Object.values(this.combatBuffs).filter(
            (buff) => buff.startTime + buff.duration <= currentTime
        );
        expiredBuffs.forEach((buff) => {
            delete this.combatBuffs[buff.uniqueHrid];
        });

        this.updateCombatDetails();
    }

    clearBuffs() {
        this.combatBuffs = structuredClone(this.permanentBuffs);
        this.updateCombatDetails();
    }

    clearCCs() {
        this.isStunned = false;
        this.stunExpireTime = null;
        this.isSilenced = false;
        this.silenceExpireTime = null;
        this.isBlinded = false;
        this.blindExpireTime = null;
        this.combatDetails.combatStats.damageTaken = 0;
        this.curseValue = 0; // max 0.1
        this.furyValue = 0; // max 0.15
    }

    getBuffBoosts(type) {
        let boosts = [];
        Object.values(this.combatBuffs)
            .filter((buff) => buff.typeHrid == type)
            .forEach((buff) => {
                boosts.push({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost });
            });

        return boosts;
    }

    getBuffBoost(type) {
        let boosts = this.getBuffBoosts(type);

        let boost = {
            ratioBoost: 0,
            flatBoost: 0,
        };

        for (let i = 0; i < boosts.length; i++) {
            boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;
            boost.flatBoost += boosts[i]?.flatBoost ?? 0;
        }

        return boost;
    }

    reset(currentTime = 0) {
        this.clearCCs();
        this.clearBuffs();
        this.updateCombatDetails();
        this.resetCooldowns(currentTime);

        this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
        this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
    }

    resetCooldowns(currentTime = 0) {
        this.food.filter((food) => food != null).forEach((food) => (food.lastUsed = Number.MIN_SAFE_INTEGER));
        this.drinks.filter((drink) => drink != null).forEach((drink) => (drink.lastUsed = Number.MIN_SAFE_INTEGER));

        let haste = this.combatDetails.combatStats.abilityHaste;

        this.abilities
            .filter((ability) => ability != null)
            .forEach((ability) => {
                if (this.isPlayer) {
                    ability.lastUsed = Number.MIN_SAFE_INTEGER;
                } else {
                    let cooldownDuration = ability.cooldownDuration;
                    if (haste > 0) {
                        cooldownDuration = cooldownDuration * 100 / (100 + haste);
                    }
                    ability.lastUsed = currentTime - Math.floor(cooldownDuration * 0.5) + Math.floor(Math.random() * cooldownDuration * 0.5);
                }
            });
    }

    addHitpoints(hitpoints) {
        let hitpointsAdded = 0;

        if (this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints) {
            return hitpointsAdded;
        }

        let newHitpoints = Math.min(this.combatDetails.currentHitpoints + hitpoints, this.combatDetails.maxHitpoints);
        hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;
        this.combatDetails.currentHitpoints = newHitpoints;

        return hitpointsAdded;
    }

    addManapoints(manapoints) {
        let manapointsAdded = 0;

        if (this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints) {
            return manapointsAdded;
        }

        let newManapoints = Math.min(
            this.combatDetails.currentManapoints + manapoints,
            this.combatDetails.maxManapoints
        );
        manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
        this.combatDetails.currentManapoints = newManapoints;

        return manapointsAdded;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CombatUnit);


/***/ }),

/***/ "./src/combatsimulator/combatUtilities.js":
/*!************************************************!*\
  !*** ./src/combatsimulator/combatUtilities.js ***!
  \************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class CombatUtilities {
    static getTarget(enemies) {
        if (!enemies) {
            return null;
        }
        let target = enemies.find((enemy) => enemy.combatDetails.currentHitpoints > 0);

        return target ?? null;
    }

    static randomInt(min, max) {
        if (max < min) {
            let temp = min;
            min = max;
            max = temp;
        }

        let minCeil = Math.ceil(min);
        let maxFloor = Math.floor(max);

        if (Math.floor(min) == maxFloor) {
            return Math.floor((min + max) / 2 + Math.random());
        }

        let minTail = -1 * (min - minCeil);
        let maxTail = max - maxFloor;

        let balancedWeight = 2 * minTail + (maxFloor - minCeil);
        let balancedAverage = (maxFloor + minCeil) / 2;
        let average = (max + min) / 2;
        let extraTailWeight = (balancedWeight * (average - balancedAverage)) / (maxFloor + 1 - average);
        let extraTailChance = Math.abs(extraTailWeight / (extraTailWeight + balancedWeight));

        if (Math.random() < extraTailChance) {
            if (maxTail > minTail) {
                return Math.floor(maxFloor + 1);
            } else {
                return Math.floor(minCeil - 1);
            }
        }

        if (maxTail > minTail) {
            return Math.floor(min + Math.random() * (maxFloor + minTail - min + 1));
        } else {
            return Math.floor(minCeil - maxTail + Math.random() * (max - (minCeil - maxTail) + 1));
        }
    }

    static processAttack(source, target, abilityEffect = null) {
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
                throw new Error("Unknown combat style: " + combatStyle);
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
                thornType = "elementalThorns";
                break;
            case "/damage_types/nature":
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.natureAmplify;
                sourceResistance = source.combatDetails.totalNatureResistance;
                sourcePenetration = source.combatDetails.combatStats.naturePenetration;
                targetResistance = target.combatDetails.totalNatureResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                thornType = "elementalThorns";
                break;
            case "/damage_types/fire":
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.fireAmplify;
                sourceResistance = source.combatDetails.totalFireResistance;
                sourcePenetration = source.combatDetails.combatStats.firePenetration;
                targetResistance = target.combatDetails.totalFireResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                thornType = "elementalThorns";
                break;
            default:
                throw new Error("Unknown damage type: " + damageType);
        }

        let hitChance = 1;
        let critChance = 0;
        let bonusCritChance = source.combatDetails.combatStats.criticalRate;
        let bonusCritDamage = source.combatDetails.combatStats.criticalDamage;

        if (abilityEffect) {
            sourceAccuracyRating *= (1 + abilityEffect.bonusAccuracyRatio);
        }

        if (source.isWeakened) {
            sourceAccuracyRating = sourceAccuracyRating - (source.weakenPercentage * sourceAccuracyRating);
        }

        hitChance =
            Math.pow(sourceAccuracyRating, 1.4) /
            (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));

        if (combatStyle == "/combat_styles/ranged") {
            critChance = 0.3 * hitChance;
        }

        critChance = critChance + bonusCritChance;

        let baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
        let baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;

        let armorDamageRatioFlat = abilityEffect ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor : 0;

        let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
        let sourceMaxDamage = sourceDamageMultiplier * (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);

        if (Math.random() < critChance) {
            sourceMaxDamage = sourceMaxDamage * (1 + bonusCritDamage);
            sourceMinDamage = sourceMaxDamage;
        }

        let damageRoll = CombatUtilities.randomInt(sourceMinDamage, sourceMaxDamage);
        damageRoll *= (1 + source.combatDetails.combatStats.taskDamage);
        damageRoll *= (1 + target.combatDetails.combatStats.damageTaken);
        if (!abilityEffect) {
            damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;
        }
        let maxPremitigatedDamage = Math.min(damageRoll, target.combatDetails.currentHitpoints);

        let damageDone = 0;
        let reflectDamage = 0;
        let mitigatedReflectDamage = 0;
        let reflectDamageDone = 0;

        let didHit = false;
        if (Math.random() < hitChance) {
            didHit = true;
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

        if (targetThornPower > 0 && targetResistance > 0) {
            let penetratedSourceResistance = sourceResistance

            if (targetPenetration > 0 && sourceResistance > 0) {
                penetratedSourceResistance = sourceResistance / (1 + targetPenetration);
            }

            let sourceDamageTakenRatio = 100 / (100 + penetratedSourceResistance);
            if (penetratedSourceResistance < 0) {
                sourceDamageTakenRatio = (100 - penetratedSourceResistance) / 100;
            }

            reflectDamage = Math.ceil(targetThornPower * targetResistance);
            mitigatedReflectDamage = Math.ceil(sourceDamageTakenRatio * reflectDamage);
            reflectDamageDone = Math.min(mitigatedReflectDamage, source.combatDetails.currentHitpoints);
            source.combatDetails.currentHitpoints -= reflectDamageDone;
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

        let experienceGained = {
            source: {
                attack: 0,
                power: 0,
                ranged: 0,
                magic: 0,
            },
            target: {
                defense: 0,
                stamina: 0,
            },
        };

        let damagePrevented = maxPremitigatedDamage - damageDone;

        if (damagePrevented < 0) {
            damagePrevented = 0;
        }

        switch (combatStyle) {
            case "/combat_styles/stab":
            case "/combat_styles/slash":
            case "/combat_styles/smash":
                experienceGained.source.attack = this.calculateAttackExperience(damageDone, damagePrevented, combatStyle);
                experienceGained.source.power = this.calculatePowerExperience(damageDone, damagePrevented, combatStyle);
                break;
            case "/combat_styles/ranged":
                experienceGained.source.ranged = this.calculateRangedExperience(damageDone, damagePrevented);
                break;
            case "/combat_styles/magic":
                experienceGained.source.magic = this.calculateMagicExperience(damageDone, damagePrevented);
                break;
        }

        experienceGained.target.defense = this.calculateDefenseExperience(damagePrevented);
        experienceGained.target.stamina = this.calculateStaminaExperience(damagePrevented, damageDone);

        if (mitigatedReflectDamage > 0) {
            experienceGained.target.defense += this.calculateDefenseExperience(mitigatedReflectDamage);

            let reflectDamagePrevented = reflectDamage - reflectDamageDone;

            experienceGained.source.defense = this.calculateDefenseExperience(reflectDamagePrevented);
            experienceGained.source.stamina = this.calculateStaminaExperience(reflectDamagePrevented, reflectDamageDone);
        }

        return { damageDone, didHit, reflectDamageDone, thornType, lifeStealHeal, hpDrain, manaLeechMana, experienceGained };
    }

    static processHeal(source, abilityEffect, target) {
        if (abilityEffect.combatStyleHrid != "/combat_styles/magic") {
            throw new Error("Heal ability effect not supported for combat style: " + abilityEffect.combatStyleHrid);
        }

        let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        let magicMaxDamage = source.combatDetails.magicMaxDamage;

        let baseHealFlat = abilityEffect.damageFlat;
        let baseHealRatio = abilityEffect.damageRatio;

        let minHeal = healingAmplify * (1 + baseHealFlat);
        let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

        let heal = this.randomInt(minHeal, maxHeal);
        let amountHealed = target.addHitpoints(heal);

        return amountHealed;
    }

    static processRevive(source, abilityEffect, target) {
        if (abilityEffect.combatStyleHrid != "/combat_styles/magic") {
            throw new Error("Heal ability effect not supported for combat style: " + abilityEffect.combatStyleHrid);
        }

        let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        let magicMaxDamage = source.combatDetails.magicMaxDamage;

        let baseHealFlat = abilityEffect.damageFlat;
        let baseHealRatio = abilityEffect.damageRatio;

        let minHeal = healingAmplify * (1 + baseHealFlat);
        let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

        let heal = this.randomInt(minHeal, maxHeal);
        let amountHealed = target.addHitpoints(heal);
        target.combatDetails.currentManapoints = target.combatDetails.maxManapoints;
        target.clearCCs();
        target.clearBuffs();

        return amountHealed;
    }

    static processSpendHp(source, abilityEffect) {
        let currentHp = source.combatDetails.currentHitpoints;
        let spendHpRatio = abilityEffect.spendHpRatio;

        let spentHp = Math.floor(currentHp * spendHpRatio);

        source.combatDetails.currentHitpoints -= spentHp;

        return spentHp;
    }

    static calculateTickValue(totalValue, totalTicks, currentTick) {
        let currentSum = Math.floor((currentTick * totalValue) / totalTicks);
        let previousSum = Math.floor(((currentTick - 1) * totalValue) / totalTicks);

        return currentSum - previousSum;
    }

    static calculateStaminaExperience(damagePrevented, damageTaken) {
        return 0.03 * damagePrevented + 0.3 * damageTaken;
    }

    static calculateIntelligenceExperience(manaUsed) {
        return 0.3 * manaUsed;
    }

    static calculateAttackExperience(damage, damagePrevented, combatStyle) {
        switch (combatStyle) {
            case "/combat_styles/stab":
                return 0.54 + 0.1125 * (damage + 0.35 * damagePrevented);
            case "/combat_styles/slash":
                return 0.3 + 0.0625 * (damage + 0.35 * damagePrevented)
            case "/combat_styles/smash":
                return 0.06 + 0.0125 * (damage + 0.35 * damagePrevented)
            default:
                return 0;
        }
    }

    static calculatePowerExperience(damage, damagePrevented, combatStyle) {
        switch (combatStyle) {
            case "/combat_styles/stab":
                return 0.06 + 0.0125 * (damage + 0.35 * damagePrevented)
            case "/combat_styles/slash":
                return 0.3 + 0.0625 * (damage + 0.35 * damagePrevented)
            case "/combat_styles/smash":
                return 0.54 + 0.1125 * (damage + 0.35 * damagePrevented);
            default:
                return 0;
        }
    }

    static calculateDefenseExperience(damagePrevented) {
        return 0.4 + 0.1 * damagePrevented;
    }

    static calculateRangedExperience(damage, damagePrevented) {
        return 0.4 + 0.083375 * (damage + 0.35 * damagePrevented)
    }

    static calculateMagicExperience(damage, damagePrevented) {
        return 0.4 + 0.083375 * (damage + 0.35 * damagePrevented)
    }

    static calculateHealingExperience(healed) {
        return CombatUtilities.calculateMagicExperience(healed, 0) * 3;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CombatUtilities);


/***/ }),

/***/ "./src/combatsimulator/data/abilityDetailMap.json":
/*!********************************************************!*\
  !*** ./src/combatsimulator/data/abilityDetailMap.json ***!
  \********************************************************/
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"/abilities/aqua_arrow":{"hrid":"/abilities/aqua_arrow","name":"Aqua Arrow","description":"Shoots an arrow made of water at the targeted enemy","isSpecialAbility":false,"manaCost":35,"cooldownDuration":18000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/water","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.9,"baseDamageRatioLevelBonus":0.009,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":15},"/abilities/aqua_aura":{"hrid":"/abilities/aqua_aura","name":"Aqua Aura","description":"Increases water amplify and resistance for all allies","isSpecialAbility":true,"manaCost":100,"cooldownDuration":120000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/aqua_aura_water_amplify","typeHrid":"/buff_types/water_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.08,"flatBoostLevelBonus":0.0016,"startTime":"0001-01-01T00:00:00Z","duration":120000000000},{"uniqueHrid":"/buff_uniques/aqua_aura_water_resistance","typeHrid":"/buff_types/water_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":4,"flatBoostLevelBonus":0.08,"startTime":"0001-01-01T00:00:00Z","duration":120000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/aqua_aura_water_amplify","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":53},"/abilities/arcane_reflection":{"hrid":"/abilities/arcane_reflection","name":"Arcane Reflection","description":"Gains elemental thorns temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/arcane_reflection","typeHrid":"/buff_types/elemental_thorns","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.25,"flatBoostLevelBonus":0.0025,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/arcane_reflection","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":47},"/abilities/berserk":{"hrid":"/abilities/berserk","name":"Berserk","description":"Greatly increases physical damage temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/berserk","typeHrid":"/buff_types/physical_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.18,"flatBoostLevelBonus":0.0018,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/berserk","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":43},"/abilities/cleave":{"hrid":"/abilities/cleave","name":"Cleave","description":"Cleaves all enemies","isSpecialAbility":false,"manaCost":35,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/slash","damageType":"/damage_types/physical","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.5,"baseDamageRatioLevelBonus":0.005,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":6},"/abilities/crippling_slash":{"hrid":"/abilities/crippling_slash","name":"Crippling Slash","description":"Slashes all enemies and reduce their damage","isSpecialAbility":false,"manaCost":55,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/slash","damageType":"/damage_types/physical","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.006,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/crippling_slash","typeHrid":"/buff_types/damage","ratioBoost":-0.12,"ratioBoostLevelBonus":-0.0012,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":12000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":8},"/abilities/critical_aura":{"hrid":"/abilities/critical_aura","name":"Critical Aura","description":"Increases critical rate for all allies","isSpecialAbility":true,"manaCost":100,"cooldownDuration":120000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/critical_aura","typeHrid":"/buff_types/critical_rate","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.03,"flatBoostLevelBonus":0.0006,"startTime":"0001-01-01T00:00:00Z","duration":120000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/critical_aura","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":57},"/abilities/elemental_affinity":{"hrid":"/abilities/elemental_affinity","name":"Elemental Affinity","description":"Greatly increases elemental damage temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/elemental_affinity_water_amplify","typeHrid":"/buff_types/water_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.4,"flatBoostLevelBonus":0.004,"startTime":"0001-01-01T00:00:00Z","duration":20000000000},{"uniqueHrid":"/buff_uniques/elemental_affinity_nature_amplify","typeHrid":"/buff_types/nature_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.4,"flatBoostLevelBonus":0.004,"startTime":"0001-01-01T00:00:00Z","duration":20000000000},{"uniqueHrid":"/buff_uniques/elemental_affinity_fire_amplify","typeHrid":"/buff_types/fire_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.4,"flatBoostLevelBonus":0.004,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/elemental_affinity_water_amplify","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":45},"/abilities/elusiveness":{"hrid":"/abilities/elusiveness","name":"Elusiveness","description":"Greatly increases evasion temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/elusiveness","typeHrid":"/buff_types/evasion","ratioBoost":0.2,"ratioBoostLevelBonus":0.002,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/elusiveness","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":41},"/abilities/entangle":{"hrid":"/abilities/entangle","name":"Entangle","description":"Entangles the targeted enemy, dealing damage with chance to stun","isSpecialAbility":false,"manaCost":10,"cooldownDuration":0,"castDuration":3000000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/nature","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.52,"baseDamageRatioLevelBonus":0.0026,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0.1,"stunDuration":2000000000,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":26},"/abilities/fierce_aura":{"hrid":"/abilities/fierce_aura","name":"Fierce Aura","description":"Increases physical amplify and armor for all allies","isSpecialAbility":true,"manaCost":100,"cooldownDuration":120000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/fierce_aura_physical_amplify","typeHrid":"/buff_types/physical_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.06,"flatBoostLevelBonus":0.0012,"startTime":"0001-01-01T00:00:00Z","duration":120000000000},{"uniqueHrid":"/buff_uniques/fierce_aura_armor","typeHrid":"/buff_types/armor","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":4,"flatBoostLevelBonus":0.08,"startTime":"0001-01-01T00:00:00Z","duration":120000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/fierce_aura_physical_amplify","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":52},"/abilities/fireball":{"hrid":"/abilities/fireball","name":"Fireball","description":"Casts a fireball at the targeted enemy","isSpecialAbility":false,"manaCost":10,"cooldownDuration":0,"castDuration":3000000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/fire","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.003,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":30},"/abilities/firestorm":{"hrid":"/abilities/firestorm","name":"Firestorm","description":"Casts a firestorm at all enemies","isSpecialAbility":false,"manaCost":75,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/fire","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.006,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":1,"damageOverTimeDuration":6000000000,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":32},"/abilities/flame_arrow":{"hrid":"/abilities/flame_arrow","name":"Flame Arrow","description":"Shoots a flaming arrow at the targeted enemy","isSpecialAbility":false,"manaCost":35,"cooldownDuration":18000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/fire","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.9,"baseDamageRatioLevelBonus":0.009,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":16},"/abilities/flame_aura":{"hrid":"/abilities/flame_aura","name":"Flame Aura","description":"Increases fire amplify and resistance for all allies","isSpecialAbility":true,"manaCost":100,"cooldownDuration":120000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/flame_aura_fire_amplify","typeHrid":"/buff_types/fire_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.08,"flatBoostLevelBonus":0.0016,"startTime":"0001-01-01T00:00:00Z","duration":120000000000},{"uniqueHrid":"/buff_uniques/flame_aura_fire_resistance","typeHrid":"/buff_types/fire_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":4,"flatBoostLevelBonus":0.08,"startTime":"0001-01-01T00:00:00Z","duration":120000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/flame_aura_fire_amplify","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":55},"/abilities/flame_blast":{"hrid":"/abilities/flame_blast","name":"Flame Blast","description":"Casts a flame blast at all enemies","isSpecialAbility":false,"manaCost":45,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/fire","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.8,"baseDamageRatioLevelBonus":0.008,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":31},"/abilities/fracturing_impact":{"hrid":"/abilities/fracturing_impact","name":"Fracturing Impact","description":"Attacks all enemies, dealing damage and increases their damage taken","isSpecialAbility":false,"manaCost":55,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/smash","damageType":"/damage_types/physical","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.006,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/fracturing_impact","typeHrid":"/buff_types/damage_taken","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.05,"flatBoostLevelBonus":0.0005,"startTime":"0001-01-01T00:00:00Z","duration":12000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":12},"/abilities/frenzy":{"hrid":"/abilities/frenzy","name":"Frenzy","description":"Greatly increases attack speed temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/frenzy","typeHrid":"/buff_types/attack_speed","ratioBoost":0.24,"ratioBoostLevelBonus":0.0024,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/frenzy","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":44},"/abilities/frost_surge":{"hrid":"/abilities/frost_surge","name":"Frost Surge","description":"Casts frost surge at all enemies, dealing damage and reducing evasion","isSpecialAbility":false,"manaCost":75,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/water","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/frost_surge","typeHrid":"/buff_types/evasion","ratioBoost":-0.1,"ratioBoostLevelBonus":-0.001,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":9000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":24},"/abilities/heal":{"hrid":"/abilities/heal","name":"Heal","description":"Casts heal on yourself","isSpecialAbility":false,"manaCost":60,"cooldownDuration":15000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/heal","combatStyleHrid":"/combat_styles/magic","damageType":"","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":0.45,"baseDamageRatioLevelBonus":0.0045,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/missing_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":35},"/abilities/ice_spear":{"hrid":"/abilities/ice_spear","name":"Ice Spear","description":"Casts an ice spear at the targeted enemy, dealing damage and reducing attack speed","isSpecialAbility":false,"manaCost":45,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/water","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":1.3,"baseDamageRatioLevelBonus":0.013,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/ice_spear","typeHrid":"/buff_types/attack_speed","ratioBoost":-0.25,"ratioBoostLevelBonus":-0.0025,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":8000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":23},"/abilities/impale":{"hrid":"/abilities/impale","name":"Impale","description":"Impales the targeted enemy","isSpecialAbility":false,"manaCost":35,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/stab","damageType":"/damage_types/physical","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.9,"baseDamageRatioLevelBonus":0.009,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":2},"/abilities/insanity":{"hrid":"/abilities/insanity","name":"Insanity","description":"Increases damage, attack speed, and cast speed temporarily at the cost of HP","isSpecialAbility":true,"manaCost":80,"cooldownDuration":90000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/insanity_damage","typeHrid":"/buff_types/damage","ratioBoost":0.3,"ratioBoostLevelBonus":0.0015,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/insanity_attack_speed","typeHrid":"/buff_types/attack_speed","ratioBoost":0.3,"ratioBoostLevelBonus":0.0015,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/insanity_cast_speed","typeHrid":"/buff_types/cast_speed","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.3,"flatBoostLevelBonus":0.0015,"startTime":"0001-01-01T00:00:00Z","duration":12000000000}]},{"targetType":"self","effectType":"/ability_effect_types/spend_hp","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0.3,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/insanity_damage","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":50},"/abilities/invincible":{"hrid":"/abilities/invincible","name":"Invincible","description":"Tremendously increases armor, resistances, and tenacity temporarily","isSpecialAbility":true,"manaCost":80,"cooldownDuration":90000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/invincible_armor","typeHrid":"/buff_types/armor","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":700,"flatBoostLevelBonus":7,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/invincible_water_resistance","typeHrid":"/buff_types/water_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":700,"flatBoostLevelBonus":7,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/invincible_nature_resistance","typeHrid":"/buff_types/nature_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":700,"flatBoostLevelBonus":7,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/invincible_fire_resistance","typeHrid":"/buff_types/fire_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":700,"flatBoostLevelBonus":7,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/invincible_tenacity","typeHrid":"/buff_types/tenacity","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":700,"flatBoostLevelBonus":7,"startTime":"0001-01-01T00:00:00Z","duration":12000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/invincible_armor","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":51},"/abilities/life_drain":{"hrid":"/abilities/life_drain","name":"Life Drain","description":"Drains the life force of the targeted enemy, dealing damage and healing the caster","isSpecialAbility":false,"manaCost":75,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/nature","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1.8,"baseDamageRatioLevelBonus":0.018,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0.08,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":29},"/abilities/maim":{"hrid":"/abilities/maim","name":"Maim","description":"Maims the targeted enemy and causes bleeding","isSpecialAbility":false,"manaCost":50,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/slash","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":0.65,"baseDamageRatioLevelBonus":0.0065,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":1,"damageOverTimeDuration":9000000000,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/maim","typeHrid":"/buff_types/damage_taken","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.08,"flatBoostLevelBonus":0.0008,"startTime":"0001-01-01T00:00:00Z","duration":12000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":7},"/abilities/mana_spring":{"hrid":"/abilities/mana_spring","name":"Mana Spring","description":"Casts mana spring at all enemies, dealing damage and increasing ally MP regeneration","isSpecialAbility":false,"manaCost":75,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/water","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":0.7,"baseDamageRatioLevelBonus":0.007,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null},{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/mana_spring","typeHrid":"/buff_types/mp_regen","ratioBoost":0.5,"ratioBoostLevelBonus":0.005,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":10000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":25},"/abilities/minor_heal":{"hrid":"/abilities/minor_heal","name":"Minor Heal","description":"Casts minor heal on yourself","isSpecialAbility":false,"manaCost":30,"cooldownDuration":15000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/heal","combatStyleHrid":"/combat_styles/magic","damageType":"","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.3,"baseDamageRatioLevelBonus":0.003,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/missing_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":34},"/abilities/natures_veil":{"hrid":"/abilities/natures_veil","name":"Nature\'s Veil","description":"Cast\'s a veil over all enemies, dealing damage with a chance to blind","isSpecialAbility":false,"manaCost":80,"cooldownDuration":18000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/nature","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0.5,"blindDuration":5000000000,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":28},"/abilities/penetrating_shot":{"hrid":"/abilities/penetrating_shot","name":"Penetrating Shot","description":"Shoots the targeted enemy. On each successful hit, will pierce and hit the next enemy","isSpecialAbility":false,"manaCost":55,"cooldownDuration":20000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":0.8,"baseDamageRatioLevelBonus":0.008,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":1,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":21},"/abilities/penetrating_strike":{"hrid":"/abilities/penetrating_strike","name":"Penetrating Strike","description":"Strikes the targeted enemy. On each successful hit, will pierce and hit the next enemy.","isSpecialAbility":false,"manaCost":55,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/stab","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":0.8,"baseDamageRatioLevelBonus":0.008,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":1,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":4},"/abilities/pestilent_shot":{"hrid":"/abilities/pestilent_shot","name":"Pestilent Shot","description":"Shoots the targeted enemy, dealing damage and decreasing regeneration","isSpecialAbility":false,"manaCost":50,"cooldownDuration":20000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/pestilent_shot_hp_regen","typeHrid":"/buff_types/hp_regen","ratioBoost":-0.25,"ratioBoostLevelBonus":-0.0025,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":10000000000},{"uniqueHrid":"/buff_uniques/pestilent_shot_mp_regen","typeHrid":"/buff_types/mp_regen","ratioBoost":-0.25,"ratioBoostLevelBonus":-0.0025,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":10000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":20},"/abilities/poke":{"hrid":"/abilities/poke","name":"Poke","description":"Pokes the targeted enemy","isSpecialAbility":false,"manaCost":25,"cooldownDuration":15000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/stab","damageType":"/damage_types/physical","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.006,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":1},"/abilities/precision":{"hrid":"/abilities/precision","name":"Precision","description":"Greatly increases accuracy temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/precision","typeHrid":"/buff_types/accuracy","ratioBoost":0.4,"ratioBoostLevelBonus":0.004,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/precision","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":42},"/abilities/promote":{"hrid":"/abilities/promote","name":"Promote","description":"Promotes a pawn","isSpecialAbility":true,"manaCost":100,"cooldownDuration":180000000000,"castDuration":10000000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/promote","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[],"sortIndex":58},"/abilities/provoke":{"hrid":"/abilities/provoke","name":"Provoke","description":"Tremendously increases threat rating","isSpecialAbility":false,"manaCost":150,"cooldownDuration":60000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/provoke","typeHrid":"/buff_types/threat","ratioBoost":5,"ratioBoostLevelBonus":0.05,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":65000000000}]}],"defaultCombatTriggers":[],"sortIndex":39},"/abilities/puncture":{"hrid":"/abilities/puncture","name":"Puncture","description":"Punctures the targeted enemy\'s armor, dealing damage and temporarily reducing its armor","isSpecialAbility":false,"manaCost":50,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/stab","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1.1,"baseDamageRatioLevelBonus":0.011,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/puncture","typeHrid":"/buff_types/armor","ratioBoost":-0.2,"ratioBoostLevelBonus":-0.002,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":10000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":3},"/abilities/quick_aid":{"hrid":"/abilities/quick_aid","name":"Quick Aid","description":"Casts heal on the ally with the lowest HP percentage","isSpecialAbility":false,"manaCost":60,"cooldownDuration":12000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"lowestHpAlly","effectType":"/ability_effect_types/heal","combatStyleHrid":"/combat_styles/magic","damageType":"","baseDamageFlat":40,"baseDamageFlatLevelBonus":0.4,"baseDamageRatio":0.3,"baseDamageRatioLevelBonus":0.003,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_allies","conditionHrid":"/combat_trigger_conditions/lowest_hp_percentage","comparatorHrid":"/combat_trigger_comparators/less_than_equal","value":75}],"sortIndex":36},"/abilities/quick_shot":{"hrid":"/abilities/quick_shot","name":"Quick Shot","description":"Takes a quick shot at the targeted enemy","isSpecialAbility":false,"manaCost":25,"cooldownDuration":15000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/physical","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.55,"baseDamageRatioLevelBonus":0.0055,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":14},"/abilities/rain_of_arrows":{"hrid":"/abilities/rain_of_arrows","name":"Rain Of Arrows","description":"Shoots a rain of arrows on all enemies","isSpecialAbility":false,"manaCost":35,"cooldownDuration":20000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/physical","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.5,"baseDamageRatioLevelBonus":0.005,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":17},"/abilities/rejuvenate":{"hrid":"/abilities/rejuvenate","name":"Rejuvenate","description":"Heals all allies","isSpecialAbility":false,"manaCost":90,"cooldownDuration":25000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/heal","combatStyleHrid":"/combat_styles/magic","damageType":"","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":0.2,"baseDamageRatioLevelBonus":0.002,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_allies","conditionHrid":"/combat_trigger_conditions/missing_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":37},"/abilities/revive":{"hrid":"/abilities/revive","name":"Revive","description":"Revives a dead ally","isSpecialAbility":true,"manaCost":200,"cooldownDuration":300000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"deadAlly","effectType":"/ability_effect_types/revive","combatStyleHrid":"/combat_styles/magic","damageType":"","baseDamageFlat":100,"baseDamageFlatLevelBonus":1,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_allies","conditionHrid":"/combat_trigger_conditions/number_of_dead_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":49},"/abilities/scratch":{"hrid":"/abilities/scratch","name":"Scratch","description":"Scratches the targeted enemy","isSpecialAbility":false,"manaCost":25,"cooldownDuration":15000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/slash","damageType":"/damage_types/physical","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.006,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":5},"/abilities/shield_bash":{"hrid":"/abilities/shield_bash","name":"Shield Bash","description":"Bashes the targeted enemy with a shield, dealing extra damage based on attacker\'s armor","isSpecialAbility":false,"manaCost":35,"cooldownDuration":12000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/smash","damageType":"/damage_types/physical","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.3,"baseDamageRatioLevelBonus":0.003,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0.6,"armorDamageRatioLevelBonus":0.006,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":13},"/abilities/silencing_shot":{"hrid":"/abilities/silencing_shot","name":"Silencing Shot","description":"Takes a shot at the targeted enemy, temporarily silencing them","isSpecialAbility":false,"manaCost":50,"cooldownDuration":20000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0.6,"silenceDuration":5000000000,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":18},"/abilities/smack":{"hrid":"/abilities/smack","name":"Smack","description":"Smacks the targeted enemy","isSpecialAbility":false,"manaCost":25,"cooldownDuration":15000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/smash","damageType":"/damage_types/physical","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.006,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":9},"/abilities/smoke_burst":{"hrid":"/abilities/smoke_burst","name":"Smoke Burst","description":"Casts a smoke burst at the targeted enemy, dealing damage and decreasing their accuracy","isSpecialAbility":false,"manaCost":75,"cooldownDuration":15000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/fire","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1.8,"baseDamageRatioLevelBonus":0.018,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/smoke_burst_accuracy","typeHrid":"/buff_types/accuracy","ratioBoost":-0.15,"ratioBoostLevelBonus":-0.0015,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":8000000000},{"uniqueHrid":"/buff_uniques/smoke_burst_evasion","typeHrid":"/buff_types/evasion","ratioBoost":-0.15,"ratioBoostLevelBonus":-0.0015,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":8000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":33},"/abilities/speed_aura":{"hrid":"/abilities/speed_aura","name":"Speed Aura","description":"Increases attack speed and cast speed for all allies","isSpecialAbility":true,"manaCost":100,"cooldownDuration":120000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/speed_aura_attack_speed","typeHrid":"/buff_types/attack_speed","ratioBoost":0.04,"ratioBoostLevelBonus":0.0008,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":120000000000},{"uniqueHrid":"/buff_uniques/speed_aura_cast_speed","typeHrid":"/buff_types/cast_speed","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.04,"flatBoostLevelBonus":0.0008,"startTime":"0001-01-01T00:00:00Z","duration":120000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/speed_aura_attack_speed","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":56},"/abilities/spike_shell":{"hrid":"/abilities/spike_shell","name":"Spike Shell","description":"Gains physical thorns temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/spike_shell","typeHrid":"/buff_types/physical_thorns","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.2,"flatBoostLevelBonus":0.002,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/spike_shell","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":46},"/abilities/steady_shot":{"hrid":"/abilities/steady_shot","name":"Steady Shot","description":"Takes a shot at the targeted enemy with greatly enhanced accuracy","isSpecialAbility":false,"manaCost":50,"cooldownDuration":20000000000,"castDuration":800000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/ranged","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":1,"bonusAccuracyRatioLevelBonus":0.01,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":19},"/abilities/stunning_blow":{"hrid":"/abilities/stunning_blow","name":"Stunning Blow","description":"Smashes the targeted enemy and has a chance to stun","isSpecialAbility":false,"manaCost":50,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/smash","damageType":"/damage_types/physical","baseDamageFlat":30,"baseDamageFlatLevelBonus":0.3,"baseDamageRatio":1,"baseDamageRatioLevelBonus":0.01,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0.7,"stunDuration":3000000000,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":11},"/abilities/sweep":{"hrid":"/abilities/sweep","name":"Sweep","description":"Performs a sweeping attack on all enemies","isSpecialAbility":false,"manaCost":35,"cooldownDuration":20000000000,"castDuration":500000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/smash","damageType":"/damage_types/physical","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.5,"baseDamageRatioLevelBonus":0.005,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":10},"/abilities/sylvan_aura":{"hrid":"/abilities/sylvan_aura","name":"Sylvan Aura","description":"Increases nature amplify and resistance for all allies","isSpecialAbility":true,"manaCost":100,"cooldownDuration":120000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"allAllies","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/sylvan_aura_nature_amplify","typeHrid":"/buff_types/nature_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.06,"flatBoostLevelBonus":0.0012,"startTime":"0001-01-01T00:00:00Z","duration":120000000000},{"uniqueHrid":"/buff_uniques/sylvan_aura_healing_amplify","typeHrid":"/buff_types/healing_amplify","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.06,"flatBoostLevelBonus":0.0012,"startTime":"0001-01-01T00:00:00Z","duration":120000000000},{"uniqueHrid":"/buff_uniques/sylvan_aura_nature_resistance","typeHrid":"/buff_types/nature_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":4,"flatBoostLevelBonus":0.08,"startTime":"0001-01-01T00:00:00Z","duration":120000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/sylvan_aura_nature_amplify","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":54},"/abilities/taunt":{"hrid":"/abilities/taunt","name":"Taunt","description":"Greatly increases threat rating","isSpecialAbility":false,"manaCost":120,"cooldownDuration":60000000000,"castDuration":200000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/taunt","typeHrid":"/buff_types/threat","ratioBoost":2.5,"ratioBoostLevelBonus":0.025,"flatBoost":0,"flatBoostLevelBonus":0,"startTime":"0001-01-01T00:00:00Z","duration":65000000000}]}],"defaultCombatTriggers":[],"sortIndex":38},"/abilities/toughness":{"hrid":"/abilities/toughness","name":"Toughness","description":"Greatly increases armor and resistances temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/toughness_armor","typeHrid":"/buff_types/armor","ratioBoost":0.2,"ratioBoostLevelBonus":0.002,"flatBoost":20,"flatBoostLevelBonus":0.2,"startTime":"0001-01-01T00:00:00Z","duration":20000000000},{"uniqueHrid":"/buff_uniques/toughness_water_resistance","typeHrid":"/buff_types/water_resistance","ratioBoost":0.2,"ratioBoostLevelBonus":0.002,"flatBoost":20,"flatBoostLevelBonus":0.2,"startTime":"0001-01-01T00:00:00Z","duration":20000000000},{"uniqueHrid":"/buff_uniques/toughness_nature_resistance","typeHrid":"/buff_types/nature_resistance","ratioBoost":0.2,"ratioBoostLevelBonus":0.002,"flatBoost":20,"flatBoostLevelBonus":0.2,"startTime":"0001-01-01T00:00:00Z","duration":20000000000},{"uniqueHrid":"/buff_uniques/toughness_fire_resistance","typeHrid":"/buff_types/fire_resistance","ratioBoost":0.2,"ratioBoostLevelBonus":0.002,"flatBoost":20,"flatBoostLevelBonus":0.2,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/toughness_armor","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":40},"/abilities/toxic_pollen":{"hrid":"/abilities/toxic_pollen","name":"Toxic Pollen","description":"Casts toxic pollen at all enemies, dealing damage and decreasing armor and resistances","isSpecialAbility":false,"manaCost":50,"cooldownDuration":18000000000,"castDuration":2000000000,"abilityEffects":[{"targetType":"allEnemies","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/nature","baseDamageFlat":20,"baseDamageFlatLevelBonus":0.2,"baseDamageRatio":0.8,"baseDamageRatioLevelBonus":0.008,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/toxic_pollen_armor","typeHrid":"/buff_types/armor","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":-12,"flatBoostLevelBonus":-0.12,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/toxic_pollen_water_resistance","typeHrid":"/buff_types/water_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":-15,"flatBoostLevelBonus":-0.15,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/toxic_pollen_nature_resistance","typeHrid":"/buff_types/nature_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":-20,"flatBoostLevelBonus":-0.2,"startTime":"0001-01-01T00:00:00Z","duration":12000000000},{"uniqueHrid":"/buff_uniques/toxic_pollen_fire_resistance","typeHrid":"/buff_types/fire_resistance","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":-15,"flatBoostLevelBonus":-0.15,"startTime":"0001-01-01T00:00:00Z","duration":12000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/number_of_active_units","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1},{"dependencyHrid":"/combat_trigger_dependencies/all_enemies","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":27},"/abilities/vampirism":{"hrid":"/abilities/vampirism","name":"Vampirism","description":"Gains lifesteal temporarily","isSpecialAbility":false,"manaCost":65,"cooldownDuration":30000000000,"castDuration":300000000,"abilityEffects":[{"targetType":"self","effectType":"/ability_effect_types/buff","combatStyleHrid":"","damageType":"","baseDamageFlat":0,"baseDamageFlatLevelBonus":0,"baseDamageRatio":0,"baseDamageRatioLevelBonus":0,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":[{"uniqueHrid":"/buff_uniques/vampirism","typeHrid":"/buff_types/life_steal","ratioBoost":0,"ratioBoostLevelBonus":0,"flatBoost":0.08,"flatBoostLevelBonus":0.0008,"startTime":"0001-01-01T00:00:00Z","duration":20000000000}]}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/vampirism","comparatorHrid":"/combat_trigger_comparators/is_inactive","value":0}],"sortIndex":48},"/abilities/water_strike":{"hrid":"/abilities/water_strike","name":"Water Strike","description":"Casts a water strike at the targeted enemy","isSpecialAbility":false,"manaCost":10,"cooldownDuration":0,"castDuration":3000000000,"abilityEffects":[{"targetType":"enemy","effectType":"/ability_effect_types/damage","combatStyleHrid":"/combat_styles/magic","damageType":"/damage_types/water","baseDamageFlat":10,"baseDamageFlatLevelBonus":0.1,"baseDamageRatio":0.6,"baseDamageRatioLevelBonus":0.003,"bonusAccuracyRatio":0,"bonusAccuracyRatioLevelBonus":0,"damageOverTimeRatio":0,"damageOverTimeDuration":0,"armorDamageRatio":0,"armorDamageRatioLevelBonus":0,"hpDrainRatio":0,"pierceChance":0,"blindChance":0,"blindDuration":0,"silenceChance":0,"silenceDuration":0,"stunChance":0,"stunDuration":0,"spendHpRatio":0,"buffs":null}],"defaultCombatTriggers":[{"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/current_hp","comparatorHrid":"/combat_trigger_comparators/greater_than_equal","value":1}],"sortIndex":22}}');

/***/ }),

/***/ "./src/combatsimulator/data/combatMonsterDetailMap.json":
/*!**************************************************************!*\
  !*** ./src/combatsimulator/data/combatMonsterDetailMap.json ***!
  \**************************************************************/
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"/monsters/abyssal_imp":{"hrid":"/monsters/abyssal_imp","name":"Abyssal Imp","combatDetails":{"currentHitpoints":1800,"maxHitpoints":1800,"currentManapoints":1800,"maxManapoints":1800,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":170,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":170,"stabEvasionRating":130,"slashEvasionRating":130,"smashEvasionRating":130,"rangedEvasionRating":130,"magicEvasionRating":100,"totalArmor":24,"totalWaterResistance":48,"totalNatureResistance":78,"totalFireResistance":78,"totalThreat":100,"combatLevel":156,"staminaLevel":170,"intelligenceLevel":170,"attackLevel":0,"powerLevel":0,"defenseLevel":120,"rangedLevel":0,"magicLevel":160,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":3040,"maxHitpoints":3040,"currentManapoints":3040,"maxManapoints":3040,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":290,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":290,"stabEvasionRating":234,"slashEvasionRating":234,"smashEvasionRating":234,"rangedEvasionRating":234,"magicEvasionRating":192,"totalArmor":44.800000000000004,"totalWaterResistance":70.4,"totalNatureResistance":100.4,"totalFireResistance":100.4,"totalThreat":100,"combatLevel":274,"staminaLevel":294,"intelligenceLevel":294,"attackLevel":56,"powerLevel":56,"defenseLevel":224,"rangedLevel":56,"magicLevel":280,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4600,"maxHitpoints":4600,"currentManapoints":4600,"maxManapoints":4600,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":442,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":442,"stabEvasionRating":370,"slashEvasionRating":370,"smashEvasionRating":370,"rangedEvasionRating":370,"magicEvasionRating":316,"totalArmor":72,"totalWaterResistance":99.2,"totalNatureResistance":129.2,"totalFireResistance":129.2,"totalThreat":100,"combatLevel":424,"staminaLevel":450,"intelligenceLevel":450,"attackLevel":144,"powerLevel":144,"defenseLevel":360,"rangedLevel":144,"magicLevel":432,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/quick_aid","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/firestorm","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/fireball","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":500,"maxCount":2500,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/abyssal_essence","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/quick_aid","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/firestorm","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/fireball","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.00114,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/acrobat":{"hrid":"/monsters/acrobat","name":"Acrobat","combatDetails":{"currentHitpoints":27800,"maxHitpoints":27800,"currentManapoints":27800,"maxManapoints":27800,"attackInterval":2745098039,"stabAccuracyRating":560,"slashAccuracyRating":560,"smashAccuracyRating":560,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":310,"slashMaxDamage":310,"smashMaxDamage":310,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":720,"slashEvasionRating":720,"smashEvasionRating":720,"rangedEvasionRating":360,"magicEvasionRating":272.5,"totalArmor":70,"totalWaterResistance":85,"totalNatureResistance":85,"totalFireResistance":85,"totalThreat":100,"combatLevel":1348,"staminaLevel":2770,"intelligenceLevel":2770,"attackLevel":550,"powerLevel":300,"defenseLevel":350,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabEvasion":1,"slashEvasion":1,"smashEvasion":1,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":39439,"maxHitpoints":39439,"currentManapoints":39439,"maxManapoints":39439,"attackInterval":2476999292,"stabAccuracyRating":836,"slashAccuracyRating":836,"smashAccuracyRating":836,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":485.99999999999994,"slashMaxDamage":485.99999999999994,"smashMaxDamage":485.99999999999994,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":1112,"slashEvasionRating":1112,"smashEvasionRating":1112,"rangedEvasionRating":556,"magicEvasionRating":433.5,"totalArmor":109.2,"totalWaterResistance":110.2,"totalNatureResistance":110.2,"totalFireResistance":110.2,"totalThreat":100,"combatLevel":1943,"staminaLevel":3933.9999999999995,"intelligenceLevel":3933.9999999999995,"attackLevel":826,"powerLevel":475.99999999999994,"defenseLevel":546,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabEvasion":1,"slashEvasion":1,"smashEvasion":1,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":51400,"maxHitpoints":51400,"currentManapoints":51400,"maxManapoints":51400,"attackInterval":2233567326,"stabAccuracyRating":1144,"slashAccuracyRating":1144,"smashAccuracyRating":1144,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":694,"slashMaxDamage":694,"smashMaxDamage":694,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":1568,"slashEvasionRating":1568,"smashEvasionRating":1568,"rangedEvasionRating":784,"magicEvasionRating":626.5,"totalArmor":154.8,"totalWaterResistance":141.8,"totalNatureResistance":141.8,"totalFireResistance":141.8,"totalThreat":100,"combatLevel":2570,"staminaLevel":5130,"intelligenceLevel":5130,"attackLevel":1134,"powerLevel":684,"defenseLevel":774,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabEvasion":1,"slashEvasion":1,"smashEvasion":1,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/elusiveness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/precision","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/smack","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/stunning_blow","level":40,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.10912,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/alligator":{"hrid":"/monsters/alligator","name":"Sherlock","combatDetails":{"currentHitpoints":300,"maxHitpoints":300,"currentManapoints":300,"maxManapoints":300,"attackInterval":3465346534,"stabAccuracyRating":30,"slashAccuracyRating":30,"smashAccuracyRating":30,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":37.1,"slashMaxDamage":37.1,"smashMaxDamage":37.1,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":36.4,"slashEvasionRating":36.4,"smashEvasionRating":36.4,"rangedEvasionRating":26,"magicEvasionRating":22,"totalArmor":3.2,"totalWaterResistance":1.6,"totalNatureResistance":1.6,"totalFireResistance":1.6,"totalThreat":100,"combatLevel":20,"staminaLevel":20,"intelligenceLevel":20,"attackLevel":20,"powerLevel":25,"defenseLevel":16,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabDamage":0.06,"slashDamage":0.06,"smashDamage":0.06,"stabEvasion":0.4,"slashEvasion":0.4,"smashEvasion":0.4,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":940,"maxHitpoints":940,"currentManapoints":940,"maxManapoints":940,"attackInterval":3358925143,"stabAccuracyRating":94,"slashAccuracyRating":94,"smashAccuracyRating":94,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":107.06,"slashMaxDamage":107.06,"smashMaxDamage":107.06,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":123.75999999999998,"slashEvasionRating":123.75999999999998,"smashEvasionRating":123.75999999999998,"rangedEvasionRating":88.39999999999999,"magicEvasionRating":82.8,"totalArmor":15.68,"totalWaterResistance":13.440000000000001,"totalNatureResistance":13.440000000000001,"totalFireResistance":13.440000000000001,"totalThreat":100,"combatLevel":84,"staminaLevel":84,"intelligenceLevel":84,"attackLevel":84,"powerLevel":91,"defenseLevel":78.39999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabDamage":0.06,"slashDamage":0.06,"smashDamage":0.06,"stabEvasion":0.4,"slashEvasion":0.4,"smashEvasion":0.4,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1900,"maxHitpoints":1900,"currentManapoints":1900,"maxManapoints":1900,"attackInterval":3211009174,"stabAccuracyRating":190,"slashAccuracyRating":190,"smashAccuracyRating":190,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":210.94,"slashMaxDamage":210.94,"smashMaxDamage":210.94,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":255.92,"slashEvasionRating":255.92,"smashEvasionRating":255.92,"rangedEvasionRating":182.8,"magicEvasionRating":175.60000000000002,"totalArmor":34.56,"totalWaterResistance":31.68,"totalNatureResistance":31.68,"totalFireResistance":31.68,"totalThreat":100,"combatLevel":180,"staminaLevel":180,"intelligenceLevel":180,"attackLevel":180,"powerLevel":189,"defenseLevel":172.8,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabDamage":0.06,"slashDamage":0.06,"smashDamage":0.06,"stabEvasion":0.4,"slashEvasion":0.4,"smashEvasion":0.4,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/scratch","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":50,"maxCount":250,"minEliteTier":0},{"itemHrid":"/items/reptile_hide","dropRate":1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/blueberry","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/blackberry","dropRate":0.05,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/apple","dropRate":0.3,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.15,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/gator_vest","dropRate":0.003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/swamp_essence","dropRate":0.4,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/scratch","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.000488888888888889,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/anchor_shark":{"hrid":"/monsters/anchor_shark","name":"Anchor Shark","combatDetails":{"currentHitpoints":34500,"maxHitpoints":34500,"currentManapoints":34500,"maxManapoints":34500,"attackInterval":3404255319,"stabAccuracyRating":360,"slashAccuracyRating":360,"smashAccuracyRating":360,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":460,"slashMaxDamage":460,"smashMaxDamage":460,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":400,"slashEvasionRating":400,"smashEvasionRating":400,"rangedEvasionRating":800,"magicEvasionRating":302.5,"totalArmor":178,"totalWaterResistance":89,"totalNatureResistance":39,"totalFireResistance":89,"totalThreat":100,"combatLevel":1614,"staminaLevel":3440,"intelligenceLevel":3440,"attackLevel":350,"powerLevel":450,"defenseLevel":390,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"rangedEvasion":1,"armor":100,"waterResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":48820,"maxHitpoints":48820,"currentManapoints":48820,"maxManapoints":48820,"attackInterval":3142183817,"stabAccuracyRating":556,"slashAccuracyRating":556,"smashAccuracyRating":556,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":696,"slashMaxDamage":696,"smashMaxDamage":696,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":612,"slashEvasionRating":612,"smashEvasionRating":612,"rangedEvasionRating":1224,"magicEvasionRating":475.5,"totalArmor":220.4,"totalWaterResistance":115.8,"totalNatureResistance":65.8,"totalFireResistance":115.8,"totalThreat":100,"combatLevel":2315,"staminaLevel":4872,"intelligenceLevel":4872,"attackLevel":546,"powerLevel":686,"defenseLevel":602,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"rangedEvasion":1,"armor":100,"waterResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":63460,"maxHitpoints":63460,"currentManapoints":63460,"maxManapoints":63460,"attackInterval":2883922134,"stabAccuracyRating":784,"slashAccuracyRating":784,"smashAccuracyRating":784,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":964,"slashMaxDamage":964,"smashMaxDamage":964,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":856,"slashEvasionRating":856,"smashEvasionRating":856,"rangedEvasionRating":1712,"magicEvasionRating":680.5,"totalArmor":269.20000000000005,"totalWaterResistance":149,"totalNatureResistance":99.00000000000001,"totalFireResistance":149,"totalThreat":100,"combatLevel":3049,"staminaLevel":6336,"intelligenceLevel":6336,"attackLevel":774,"powerLevel":954,"defenseLevel":846,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"rangedEvasion":1,"armor":100,"waterResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/invincible","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/toughness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/berserk","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/stunning_blow","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/shield_bash","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.16089,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/aquahorse":{"hrid":"/monsters/aquahorse","name":"Aquahorse","combatDetails":{"currentHitpoints":400,"maxHitpoints":400,"currentManapoints":700,"maxManapoints":700,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":50,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":50,"magicMaxDamage":10,"stabEvasionRating":45,"slashEvasionRating":45,"smashEvasionRating":45,"rangedEvasionRating":45,"magicEvasionRating":46.25,"totalArmor":7,"totalWaterResistance":23.5,"totalNatureResistance":3.5,"totalFireResistance":23.5,"totalThreat":100,"combatLevel":41,"staminaLevel":30,"intelligenceLevel":60,"attackLevel":0,"powerLevel":0,"defenseLevel":35,"rangedLevel":40,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/water","attackInterval":3000000000,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1080,"maxHitpoints":1080,"currentManapoints":1500,"maxManapoints":1500,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":122,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":122,"magicMaxDamage":66,"stabEvasionRating":115,"slashEvasionRating":115,"smashEvasionRating":115,"rangedEvasionRating":115,"magicEvasionRating":116.75,"totalArmor":21,"totalWaterResistance":36.1,"totalNatureResistance":16.1,"totalFireResistance":36.1,"totalThreat":100,"combatLevel":113,"staminaLevel":98,"intelligenceLevel":140,"attackLevel":56,"powerLevel":56,"defenseLevel":105,"rangedLevel":112,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/water","attackInterval":3000000000,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2080,"maxHitpoints":2080,"currentManapoints":2620,"maxManapoints":2620,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":226,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":226,"magicMaxDamage":154,"stabEvasionRating":217,"slashEvasionRating":217,"smashEvasionRating":217,"rangedEvasionRating":217,"magicEvasionRating":219.25,"totalArmor":41.400000000000006,"totalWaterResistance":55.1,"totalNatureResistance":35.1,"totalFireResistance":55.1,"totalThreat":100,"combatLevel":217,"staminaLevel":198,"intelligenceLevel":252,"attackLevel":144,"powerLevel":144,"defenseLevel":207,"rangedLevel":216,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/water","attackInterval":3000000000,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/aqua_arrow","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":60,"maxCount":300,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.15,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.05,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/pearl","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_essence","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/aqua_arrow","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0006694444444444445,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/black_bear":{"hrid":"/monsters/black_bear","name":"Black Bear","combatDetails":{"currentHitpoints":1300,"maxHitpoints":1300,"currentManapoints":1300,"maxManapoints":1300,"attackInterval":2990654205,"stabAccuracyRating":150,"slashAccuracyRating":150,"smashAccuracyRating":150,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":150,"slashMaxDamage":150,"smashMaxDamage":150,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":143,"slashEvasionRating":110,"smashEvasionRating":110,"rangedEvasionRating":110,"magicEvasionRating":85,"totalArmor":20,"totalWaterResistance":20,"totalNatureResistance":20,"totalFireResistance":10,"totalThreat":100,"combatLevel":124,"staminaLevel":120,"intelligenceLevel":120,"attackLevel":140,"powerLevel":140,"defenseLevel":100,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"stabEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2340,"maxHitpoints":2340,"currentManapoints":2340,"maxManapoints":2340,"attackInterval":2841918294,"stabAccuracyRating":262,"slashAccuracyRating":262,"smashAccuracyRating":262,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":262,"slashMaxDamage":262,"smashMaxDamage":262,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":267.8,"slashEvasionRating":206,"smashEvasionRating":206,"rangedEvasionRating":206,"magicEvasionRating":171,"totalArmor":39.2,"totalWaterResistance":35.2,"totalNatureResistance":35.2,"totalFireResistance":25.200000000000003,"totalThreat":100,"combatLevel":229,"staminaLevel":224,"intelligenceLevel":224,"attackLevel":251.99999999999997,"powerLevel":251.99999999999997,"defenseLevel":196,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"stabEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3700,"maxHitpoints":3700,"currentManapoints":3700,"maxManapoints":3700,"attackInterval":2671118530,"stabAccuracyRating":406,"slashAccuracyRating":406,"smashAccuracyRating":406,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":406,"slashMaxDamage":406,"smashMaxDamage":406,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":434.2,"slashEvasionRating":334,"smashEvasionRating":334,"rangedEvasionRating":334,"magicEvasionRating":289,"totalArmor":64.8,"totalWaterResistance":56.8,"totalNatureResistance":56.8,"totalFireResistance":46.8,"totalThreat":100,"combatLevel":367,"staminaLevel":360,"intelligenceLevel":360,"attackLevel":396,"powerLevel":396,"defenseLevel":324,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"stabEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/frenzy","level":4,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":340,"maxCount":1700,"minEliteTier":0},{"itemHrid":"/items/beast_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/mooberry","dropRate":0.1,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/marsberry","dropRate":0.15,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/spaceberry","dropRate":0.05,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.15,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/black_bear_fluff","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/bear_essence","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/frenzy","dropRate":0.0006,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.001317037037037037,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/brine_marksman":{"hrid":"/monsters/brine_marksman","name":"Brine Marksman","combatDetails":{"currentHitpoints":32500,"maxHitpoints":32500,"currentManapoints":32500,"maxManapoints":32500,"attackInterval":3600000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":500,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":500,"magicMaxDamage":10,"stabEvasionRating":320,"slashEvasionRating":320,"smashEvasionRating":320,"rangedEvasionRating":320,"magicEvasionRating":730,"totalArmor":62,"totalWaterResistance":181,"totalNatureResistance":131,"totalFireResistance":181,"totalThreat":100,"combatLevel":1554,"staminaLevel":3240,"intelligenceLevel":3240,"attackLevel":0,"powerLevel":0,"defenseLevel":310,"rangedLevel":490,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3600000000,"magicEvasion":1,"waterResistance":150,"natureResistance":100,"fireResistance":150,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":46020,"maxHitpoints":46020,"currentManapoints":46020,"maxManapoints":46020,"attackInterval":3501945525,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":752,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":752,"magicMaxDamage":66,"stabEvasionRating":499.99999999999994,"slashEvasionRating":499.99999999999994,"smashEvasionRating":499.99999999999994,"rangedEvasionRating":499.99999999999994,"magicEvasionRating":1126,"totalArmor":98,"totalWaterResistance":204.6,"totalNatureResistance":154.6,"totalFireResistance":204.6,"totalThreat":100,"combatLevel":2231,"staminaLevel":4592,"intelligenceLevel":4592,"attackLevel":56,"powerLevel":56,"defenseLevel":489.99999999999994,"rangedLevel":742,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3600000000,"magicEvasion":1,"waterResistance":150,"natureResistance":100,"fireResistance":150,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":59860,"maxHitpoints":59860,"currentManapoints":59860,"maxManapoints":59860,"attackInterval":3358208955,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":1036,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":1036,"magicMaxDamage":154,"stabEvasionRating":712,"slashEvasionRating":712,"smashEvasionRating":712,"rangedEvasionRating":712,"magicEvasionRating":1586,"totalArmor":140.4,"totalWaterResistance":234.60000000000002,"totalNatureResistance":184.60000000000002,"totalFireResistance":234.60000000000002,"totalThreat":100,"combatLevel":2941,"staminaLevel":5976,"intelligenceLevel":5976,"attackLevel":144,"powerLevel":144,"defenseLevel":702,"rangedLevel":1026,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3600000000,"magicEvasion":1,"waterResistance":150,"natureResistance":100,"fireResistance":150,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/aqua_arrow","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/penetrating_shot","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/quick_shot","level":60,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.14615666666666668,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/butterjerry":{"hrid":"/monsters/butterjerry","name":"Butterjerry","combatDetails":{"currentHitpoints":5500,"maxHitpoints":5500,"currentManapoints":5500,"maxManapoints":5500,"attackInterval":3171806167,"stabAccuracyRating":280,"slashAccuracyRating":280,"smashAccuracyRating":280,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":280,"slashMaxDamage":280,"smashMaxDamage":280,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":390,"slashEvasionRating":390,"smashEvasionRating":390,"rangedEvasionRating":260,"magicEvasionRating":197.5,"totalArmor":50,"totalWaterResistance":25,"totalNatureResistance":25,"totalFireResistance":25,"totalThreat":100,"combatLevel":374,"staminaLevel":540,"intelligenceLevel":540,"attackLevel":270,"powerLevel":270,"defenseLevel":250,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3600000000,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":8220,"maxHitpoints":8220,"currentManapoints":8220,"maxManapoints":8220,"attackInterval":2958093672,"stabAccuracyRating":444,"slashAccuracyRating":444,"smashAccuracyRating":444,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":444,"slashMaxDamage":444,"smashMaxDamage":444,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":624,"slashEvasionRating":624,"smashEvasionRating":624,"rangedEvasionRating":416,"magicEvasionRating":328.5,"totalArmor":81.2,"totalWaterResistance":46.2,"totalNatureResistance":46.2,"totalFireResistance":46.2,"totalThreat":100,"combatLevel":579,"staminaLevel":812,"intelligenceLevel":812,"attackLevel":434,"powerLevel":434,"defenseLevel":406,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3600000000,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":11260,"maxHitpoints":11260,"currentManapoints":11260,"maxManapoints":11260,"attackInterval":2737642585,"stabAccuracyRating":640,"slashAccuracyRating":640,"smashAccuracyRating":640,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":640,"slashMaxDamage":640,"smashMaxDamage":640,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":906,"slashEvasionRating":906,"smashEvasionRating":906,"rangedEvasionRating":604,"magicEvasionRating":491.5,"totalArmor":118.80000000000001,"totalWaterResistance":73.80000000000001,"totalNatureResistance":73.80000000000001,"totalFireResistance":73.80000000000001,"totalThreat":100,"combatLevel":817,"staminaLevel":1116,"intelligenceLevel":1116,"attackLevel":630,"powerLevel":630,"defenseLevel":594,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3600000000,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/poke","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/impale","level":30,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0067511111111111105,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/captain_fishhook":{"hrid":"/monsters/captain_fishhook","name":"Captain Fishhook","combatDetails":{"currentHitpoints":67500,"maxHitpoints":67500,"currentManapoints":67500,"maxManapoints":67500,"attackInterval":2415094339,"stabAccuracyRating":660,"slashAccuracyRating":660,"smashAccuracyRating":660,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":720,"slashMaxDamage":720,"smashMaxDamage":720,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":340,"slashEvasionRating":340,"smashEvasionRating":340,"rangedEvasionRating":510,"magicEvasionRating":257.5,"totalArmor":116,"totalWaterResistance":83,"totalNatureResistance":33,"totalFireResistance":83,"totalThreat":100,"combatLevel":3034,"staminaLevel":6740,"intelligenceLevel":6740,"attackLevel":650,"powerLevel":710,"defenseLevel":330,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"rangedEvasion":0.5,"armor":50,"waterResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":95020,"maxHitpoints":95020,"currentManapoints":95020,"maxManapoints":95020,"attackInterval":2157788267,"stabAccuracyRating":975.9999999999999,"slashAccuracyRating":975.9999999999999,"smashAccuracyRating":975.9999999999999,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":1060,"slashMaxDamage":1060,"smashMaxDamage":1060,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":528,"slashEvasionRating":528,"smashEvasionRating":528,"rangedEvasionRating":792,"magicEvasionRating":412.5,"totalArmor":153.60000000000002,"totalWaterResistance":107.4,"totalNatureResistance":57.400000000000006,"totalFireResistance":107.4,"totalThreat":100,"combatLevel":4303,"staminaLevel":9492,"intelligenceLevel":9492,"attackLevel":965.9999999999999,"powerLevel":1050,"defenseLevel":518,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"rangedEvasion":0.5,"armor":50,"waterResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":122860,"maxHitpoints":122860,"currentManapoints":122860,"maxManapoints":122860,"attackInterval":1931200965,"stabAccuracyRating":1324,"slashAccuracyRating":1324,"smashAccuracyRating":1324,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":1432,"slashMaxDamage":1432,"smashMaxDamage":1432,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":748,"slashEvasionRating":748,"smashEvasionRating":748,"rangedEvasionRating":1122,"magicEvasionRating":599.5,"totalArmor":197.6,"totalWaterResistance":138.2,"totalNatureResistance":88.2,"totalFireResistance":138.2,"totalThreat":100,"combatLevel":5605,"staminaLevel":12276,"intelligenceLevel":12276,"attackLevel":1314,"powerLevel":1422,"defenseLevel":738,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"rangedEvasion":0.5,"armor":50,"waterResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/cleave","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/maim","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/fracturing_impact","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.5809844444444445,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/centaur_archer":{"hrid":"/monsters/centaur_archer","name":"Centaur Archer","combatDetails":{"currentHitpoints":1100,"maxHitpoints":1100,"currentManapoints":1100,"maxManapoints":1100,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":90,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":90,"magicMaxDamage":10,"stabEvasionRating":90,"slashEvasionRating":90,"smashEvasionRating":90,"rangedEvasionRating":90,"magicEvasionRating":90,"totalArmor":16,"totalWaterResistance":38,"totalNatureResistance":38,"totalFireResistance":38,"totalThreat":100,"combatLevel":88,"staminaLevel":100,"intelligenceLevel":100,"attackLevel":0,"powerLevel":0,"defenseLevel":80,"rangedLevel":80,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"waterResistance":30,"natureResistance":30,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2060,"maxHitpoints":2060,"currentManapoints":2060,"maxManapoints":2060,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":178,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":178,"magicMaxDamage":66,"stabEvasionRating":178,"slashEvasionRating":178,"smashEvasionRating":178,"rangedEvasionRating":178,"magicEvasionRating":178,"totalArmor":33.6,"totalWaterResistance":52.400000000000006,"totalNatureResistance":52.400000000000006,"totalFireResistance":52.400000000000006,"totalThreat":100,"combatLevel":179,"staminaLevel":196,"intelligenceLevel":196,"attackLevel":56,"powerLevel":56,"defenseLevel":168,"rangedLevel":168,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"waterResistance":30,"natureResistance":30,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3340,"maxHitpoints":3340,"currentManapoints":3340,"maxManapoints":3340,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":298,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":298,"magicMaxDamage":154,"stabEvasionRating":298,"slashEvasionRating":298,"smashEvasionRating":298,"rangedEvasionRating":298,"magicEvasionRating":298,"totalArmor":57.6,"totalWaterResistance":73.2,"totalNatureResistance":73.2,"totalFireResistance":73.2,"totalThreat":100,"combatLevel":302,"staminaLevel":324,"intelligenceLevel":324,"attackLevel":144,"powerLevel":144,"defenseLevel":288,"rangedLevel":288,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"waterResistance":30,"natureResistance":30,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/elusiveness","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/quick_shot","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":200,"maxCount":1000,"minEliteTier":0},{"itemHrid":"/items/beast_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/amber","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/centaur_hoof","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jungle_essence","dropRate":0.2,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/elusiveness","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/rain_of_arrows","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/quick_shot","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0009688888888888889,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/chronofrost_sorcerer":{"hrid":"/monsters/chronofrost_sorcerer","name":"Chronofrost Sorcerer","combatDetails":{"currentHitpoints":6500,"maxHitpoints":6500,"currentManapoints":6500,"maxManapoints":6500,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":270,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":270,"stabEvasionRating":130,"slashEvasionRating":130,"smashEvasionRating":130,"rangedEvasionRating":130,"magicEvasionRating":100,"totalArmor":24,"totalWaterResistance":88,"totalNatureResistance":58,"totalFireResistance":88,"totalThreat":100,"combatLevel":384,"staminaLevel":640,"intelligenceLevel":640,"attackLevel":0,"powerLevel":0,"defenseLevel":120,"rangedLevel":0,"magicLevel":260,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"abilityHaste":10,"waterAmplify":0.3,"waterResistance":50,"natureResistance":20,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":9619,"maxHitpoints":9619,"currentManapoints":9619,"maxManapoints":9619,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":430,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":430,"stabEvasionRating":234,"slashEvasionRating":234,"smashEvasionRating":234,"rangedEvasionRating":234,"magicEvasionRating":192,"totalArmor":44.800000000000004,"totalWaterResistance":114.4,"totalNatureResistance":84.4,"totalFireResistance":114.4,"totalThreat":100,"combatLevel":593,"staminaLevel":951.9999999999999,"intelligenceLevel":951.9999999999999,"attackLevel":56,"powerLevel":56,"defenseLevel":224,"rangedLevel":56,"magicLevel":420,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"abilityHaste":10,"waterAmplify":0.3,"waterResistance":50,"natureResistance":20,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":13060,"maxHitpoints":13060,"currentManapoints":13060,"maxManapoints":13060,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":622,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":622,"stabEvasionRating":370,"slashEvasionRating":370,"smashEvasionRating":370,"rangedEvasionRating":370,"magicEvasionRating":316,"totalArmor":72,"totalWaterResistance":147.2,"totalNatureResistance":117.2,"totalFireResistance":147.2,"totalThreat":100,"combatLevel":835,"staminaLevel":1296,"intelligenceLevel":1296,"attackLevel":144,"powerLevel":144,"defenseLevel":360,"rangedLevel":144,"magicLevel":612,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"abilityHaste":10,"waterAmplify":0.3,"waterResistance":50,"natureResistance":20,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/aqua_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/heal","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/elemental_affinity","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/frost_surge","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/ice_spear","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":1600,"maxCount":8000,"minEliteTier":0},{"itemHrid":"/items/sorcerers_sole","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/chrono_sphere","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/frost_sphere","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerer_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/heal","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/elemental_affinity","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/frost_surge","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/ice_spear","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_aura","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/orange_key_fragment","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/orange_key_fragment","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.008140000000000001,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/crab":{"hrid":"/monsters/crab","name":"I Pinch","combatDetails":{"currentHitpoints":400,"maxHitpoints":400,"currentManapoints":400,"maxManapoints":400,"attackInterval":3456790123,"stabAccuracyRating":35,"slashAccuracyRating":35,"smashAccuracyRating":35,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":40,"slashMaxDamage":40,"smashMaxDamage":40,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":50,"slashEvasionRating":70,"smashEvasionRating":40,"rangedEvasionRating":50,"magicEvasionRating":40,"totalArmor":8,"totalWaterResistance":24,"totalNatureResistance":4,"totalFireResistance":24,"totalThreat":100,"combatLevel":31,"staminaLevel":30,"intelligenceLevel":30,"attackLevel":25,"powerLevel":30,"defenseLevel":40,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1080,"maxHitpoints":1080,"currentManapoints":1080,"maxManapoints":1080,"attackInterval":3347680535,"stabAccuracyRating":101,"slashAccuracyRating":101,"smashAccuracyRating":101,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":108,"slashMaxDamage":108,"smashMaxDamage":108,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":122,"slashEvasionRating":170.79999999999998,"smashEvasionRating":97.60000000000001,"rangedEvasionRating":122,"magicEvasionRating":108,"totalArmor":22.400000000000002,"totalWaterResistance":36.8,"totalNatureResistance":16.8,"totalFireResistance":36.8,"totalThreat":100,"combatLevel":99,"staminaLevel":98,"intelligenceLevel":98,"attackLevel":91,"powerLevel":98,"defenseLevel":112,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2080,"maxHitpoints":2080,"currentManapoints":2080,"maxManapoints":2080,"attackInterval":3197807217,"stabAccuracyRating":199,"slashAccuracyRating":199,"smashAccuracyRating":199,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":208,"slashMaxDamage":208,"smashMaxDamage":208,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":226,"slashEvasionRating":316.4,"smashEvasionRating":180.8,"rangedEvasionRating":226,"magicEvasionRating":208,"totalArmor":43.2,"totalWaterResistance":56,"totalNatureResistance":36,"totalFireResistance":56,"totalThreat":100,"combatLevel":199,"staminaLevel":198,"intelligenceLevel":198,"attackLevel":189,"powerLevel":198,"defenseLevel":216,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/smack","level":5,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":60,"maxCount":300,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.15,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.05,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/crab_pincer","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_essence","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/smack","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0006416666666666667,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/crystal_colossus":{"hrid":"/monsters/crystal_colossus","name":"Crystal Colossus","combatDetails":{"currentHitpoints":8500,"maxHitpoints":8500,"currentManapoints":8500,"maxManapoints":8500,"attackInterval":3097345132,"stabAccuracyRating":270,"slashAccuracyRating":270,"smashAccuracyRating":270,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":310,"slashMaxDamage":310,"smashMaxDamage":310,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":340,"slashEvasionRating":340,"smashEvasionRating":272,"rangedEvasionRating":475.99999999999994,"magicEvasionRating":257.5,"totalArmor":66,"totalWaterResistance":73,"totalNatureResistance":33,"totalFireResistance":73,"totalThreat":100,"combatLevel":514,"staminaLevel":840,"intelligenceLevel":840,"attackLevel":260,"powerLevel":300,"defenseLevel":330,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3500000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":12420,"maxHitpoints":12420,"currentManapoints":12420,"maxManapoints":12420,"attackInterval":2892561983,"stabAccuracyRating":430,"slashAccuracyRating":430,"smashAccuracyRating":430,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":485.99999999999994,"slashMaxDamage":485.99999999999994,"smashMaxDamage":485.99999999999994,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":528,"slashEvasionRating":528,"smashEvasionRating":422.40000000000003,"rangedEvasionRating":739.1999999999999,"magicEvasionRating":412.5,"totalArmor":103.60000000000001,"totalWaterResistance":97.4,"totalNatureResistance":57.400000000000006,"totalFireResistance":97.4,"totalThreat":100,"combatLevel":775,"staminaLevel":1232,"intelligenceLevel":1232,"attackLevel":420,"powerLevel":475.99999999999994,"defenseLevel":518,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3500000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":16660,"maxHitpoints":16660,"currentManapoints":16660,"maxManapoints":16660,"attackInterval":2679938744,"stabAccuracyRating":622,"slashAccuracyRating":622,"smashAccuracyRating":622,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":694,"slashMaxDamage":694,"smashMaxDamage":694,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":748,"slashEvasionRating":748,"smashEvasionRating":598.4,"rangedEvasionRating":1047.2,"magicEvasionRating":599.5,"totalArmor":147.6,"totalWaterResistance":128.2,"totalNatureResistance":88.2,"totalFireResistance":128.2,"totalThreat":100,"combatLevel":1069,"staminaLevel":1656,"intelligenceLevel":1656,"attackLevel":612,"powerLevel":684,"defenseLevel":738,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3500000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/invincible","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/toughness","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/spike_shell","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/puncture","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/impale","level":30,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":4000,"maxCount":20000,"minEliteTier":0},{"itemHrid":"/items/garnet","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jade","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/amethyst","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/colossus_core","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/golem_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/spike_shell","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/puncture","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/impale","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/invincible","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/stone_key_fragment","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/stone_key_fragment","dropRate":0.07,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.013712222222222221,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/demonic_overlord":{"hrid":"/monsters/demonic_overlord","name":"Demonic Overlord","combatDetails":{"currentHitpoints":9500,"maxHitpoints":9500,"currentManapoints":9500,"maxManapoints":9500,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":360,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":360,"stabEvasionRating":200,"slashEvasionRating":200,"smashEvasionRating":200,"rangedEvasionRating":200,"magicEvasionRating":152.5,"totalArmor":38,"totalWaterResistance":74,"totalNatureResistance":104,"totalFireResistance":104,"totalThreat":100,"combatLevel":554,"staminaLevel":940,"intelligenceLevel":940,"attackLevel":0,"powerLevel":0,"defenseLevel":190,"rangedLevel":0,"magicLevel":350,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":13820,"maxHitpoints":13820,"currentManapoints":13820,"maxManapoints":13820,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":556,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":556,"stabEvasionRating":332,"slashEvasionRating":332,"smashEvasionRating":332,"rangedEvasionRating":332,"magicEvasionRating":265.5,"totalArmor":64.4,"totalWaterResistance":106.80000000000001,"totalNatureResistance":136.8,"totalFireResistance":136.8,"totalThreat":100,"combatLevel":831,"staminaLevel":1372,"intelligenceLevel":1372,"attackLevel":56,"powerLevel":56,"defenseLevel":322,"rangedLevel":56,"magicLevel":546,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":18460,"maxHitpoints":18460,"currentManapoints":18460,"maxManapoints":18460,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":784,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":784,"stabEvasionRating":496,"slashEvasionRating":496,"smashEvasionRating":496,"rangedEvasionRating":496,"magicEvasionRating":410.5,"totalArmor":97.2,"totalWaterResistance":146,"totalNatureResistance":176,"totalFireResistance":176,"totalThreat":100,"combatLevel":1141,"staminaLevel":1836,"intelligenceLevel":1836,"attackLevel":144,"powerLevel":144,"defenseLevel":486,"rangedLevel":144,"magicLevel":774,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/flame_aura","level":10,"minEliteTier":1},{"abilityHrid":"/abilities/toughness","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/firestorm","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/flame_blast","level":25,"minEliteTier":0},{"abilityHrid":"/abilities/fireball","level":40,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":4000,"maxCount":20000,"minEliteTier":0},{"itemHrid":"/items/demonic_core","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/abyssal_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/firestorm","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_blast","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/fireball","dropRate":0.1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_aura","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/burning_key_fragment","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/burning_key_fragment","dropRate":0.07,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.016373333333333333,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/deranged_jester":{"hrid":"/monsters/deranged_jester","name":"Deranged Jester","combatDetails":{"currentHitpoints":123450,"maxHitpoints":123450,"currentManapoints":246800,"maxManapoints":246800,"attackInterval":2745098039,"stabAccuracyRating":560,"slashAccuracyRating":560,"smashAccuracyRating":560,"rangedAccuracyRating":10,"magicAccuracyRating":460,"stabMaxDamage":730,"slashMaxDamage":730,"smashMaxDamage":730,"rangedMaxDamage":10,"magicMaxDamage":460,"stabEvasionRating":380,"slashEvasionRating":380,"smashEvasionRating":380,"rangedEvasionRating":760,"magicEvasionRating":287.5,"totalArmor":74,"totalWaterResistance":162,"totalNatureResistance":162,"totalFireResistance":162,"totalThreat":100,"combatLevel":7729,"staminaLevel":12335,"intelligenceLevel":24670,"attackLevel":550,"powerLevel":720,"defenseLevel":370,"rangedLevel":0,"magicLevel":450,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":1,"waterResistance":80,"natureResistance":80,"fireResistance":80,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"curse":0.04}},"elite1CombatDetails":{"currentHitpoints":173350,"maxHitpoints":173350,"currentManapoints":346040,"maxManapoints":346040,"attackInterval":2476999292,"stabAccuracyRating":836,"slashAccuracyRating":836,"smashAccuracyRating":836,"rangedAccuracyRating":66,"magicAccuracyRating":696,"stabMaxDamage":1074,"slashMaxDamage":1074,"smashMaxDamage":1074,"rangedMaxDamage":66,"magicMaxDamage":696,"stabEvasionRating":584,"slashEvasionRating":584,"smashEvasionRating":584,"rangedEvasionRating":1168,"magicEvasionRating":454.5,"totalArmor":114.80000000000001,"totalWaterResistance":206,"totalNatureResistance":206,"totalFireResistance":206,"totalThreat":100,"combatLevel":10876,"staminaLevel":17325,"intelligenceLevel":34594,"attackLevel":826,"powerLevel":1064,"defenseLevel":574,"rangedLevel":56,"magicLevel":686,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":1,"waterResistance":80,"natureResistance":80,"fireResistance":80,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"curse":0.04}},"elite2CombatDetails":{"currentHitpoints":223570,"maxHitpoints":223570,"currentManapoints":445600,"maxManapoints":445600,"attackInterval":2233567326,"stabAccuracyRating":1144,"slashAccuracyRating":1144,"smashAccuracyRating":1144,"rangedAccuracyRating":154,"magicAccuracyRating":964,"stabMaxDamage":1450,"slashMaxDamage":1450,"smashMaxDamage":1450,"rangedMaxDamage":154,"magicMaxDamage":964,"stabEvasionRating":820,"slashEvasionRating":820,"smashEvasionRating":820,"rangedEvasionRating":1640,"magicEvasionRating":653.5,"totalArmor":162,"totalWaterResistance":256.4,"totalNatureResistance":256.4,"totalFireResistance":256.4,"totalThreat":100,"combatLevel":14056,"staminaLevel":22347,"intelligenceLevel":44550,"attackLevel":1134,"powerLevel":1440,"defenseLevel":810,"rangedLevel":144,"magicLevel":954,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":1,"waterResistance":80,"natureResistance":80,"fireResistance":80,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"curse":0.04}},"abilities":[{"abilityHrid":"/abilities/insanity","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/vampirism","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/smoke_burst","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/sweep","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/stunning_blow","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":2.6731415277777777,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/dodocamel":{"hrid":"/monsters/dodocamel","name":"Dodocamel","combatDetails":{"currentHitpoints":18500,"maxHitpoints":18500,"currentManapoints":18500,"maxManapoints":18500,"attackInterval":3004291845,"stabAccuracyRating":340,"slashAccuracyRating":340,"smashAccuracyRating":340,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":340,"slashMaxDamage":340,"smashMaxDamage":340,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":420,"slashEvasionRating":504,"smashEvasionRating":504,"rangedEvasionRating":840,"magicEvasionRating":317.5,"totalArmor":182,"totalWaterResistance":61,"totalNatureResistance":61,"totalFireResistance":61,"totalThreat":100,"combatLevel":950,"staminaLevel":1840,"intelligenceLevel":1840,"attackLevel":330,"powerLevel":330,"defenseLevel":410,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.2,"smashEvasion":0.2,"rangedEvasion":1,"armor":100,"waterResistance":20,"natureResistance":20,"fireResistance":20,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":26420,"maxHitpoints":26420,"currentManapoints":26420,"maxManapoints":26420,"attackInterval":2779984114,"stabAccuracyRating":528,"slashAccuracyRating":528,"smashAccuracyRating":528,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":528,"slashMaxDamage":528,"smashMaxDamage":528,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":640,"slashEvasionRating":768,"smashEvasionRating":768,"rangedEvasionRating":1280,"magicEvasionRating":496.5,"totalArmor":226,"totalWaterResistance":88.6,"totalNatureResistance":88.6,"totalFireResistance":88.6,"totalThreat":100,"combatLevel":1386,"staminaLevel":2632,"intelligenceLevel":2632,"attackLevel":518,"powerLevel":518,"defenseLevel":630,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.2,"smashEvasion":0.2,"rangedEvasion":1,"armor":100,"waterResistance":20,"natureResistance":20,"fireResistance":20,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":34660,"maxHitpoints":34660,"currentManapoints":34660,"maxManapoints":34660,"attackInterval":2556610664,"stabAccuracyRating":748,"slashAccuracyRating":748,"smashAccuracyRating":748,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":748,"slashMaxDamage":748,"smashMaxDamage":748,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":892,"slashEvasionRating":1070.3999999999999,"smashEvasionRating":1070.3999999999999,"rangedEvasionRating":1784,"magicEvasionRating":707.5,"totalArmor":276.4,"totalWaterResistance":122.60000000000001,"totalNatureResistance":122.60000000000001,"totalFireResistance":122.60000000000001,"totalThreat":100,"combatLevel":1854,"staminaLevel":3456,"intelligenceLevel":3456,"attackLevel":738,"powerLevel":738,"defenseLevel":882,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.2,"smashEvasion":0.2,"rangedEvasion":1,"armor":100,"waterResistance":20,"natureResistance":20,"fireResistance":20,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/invincible","level":25,"minEliteTier":0},{"abilityHrid":"/abilities/toughness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/berserk","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/sweep","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/shield_bash","level":20,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.05218333333333333,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/dusk_revenant":{"hrid":"/monsters/dusk_revenant","name":"Dusk Revenant","combatDetails":{"currentHitpoints":8800,"maxHitpoints":8800,"currentManapoints":8800,"maxManapoints":8800,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":350,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":350,"magicMaxDamage":10,"stabEvasionRating":260,"slashEvasionRating":260,"smashEvasionRating":260,"rangedEvasionRating":260,"magicEvasionRating":282.5,"totalArmor":50,"totalWaterResistance":85,"totalNatureResistance":85,"totalFireResistance":65,"totalThreat":100,"combatLevel":534,"staminaLevel":870,"intelligenceLevel":870,"attackLevel":0,"powerLevel":0,"defenseLevel":250,"rangedLevel":340,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"waterResistance":60,"natureResistance":60,"fireResistance":40,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":12840,"maxHitpoints":12840,"currentManapoints":12840,"maxManapoints":12840,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":542,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":542,"magicMaxDamage":66,"stabEvasionRating":416,"slashEvasionRating":416,"smashEvasionRating":416,"rangedEvasionRating":416,"magicEvasionRating":447.5,"totalArmor":81.2,"totalWaterResistance":106.2,"totalNatureResistance":106.2,"totalFireResistance":86.2,"totalThreat":100,"combatLevel":803,"staminaLevel":1274,"intelligenceLevel":1274,"attackLevel":56,"powerLevel":56,"defenseLevel":406,"rangedLevel":532,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"waterResistance":60,"natureResistance":60,"fireResistance":40,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":17200,"maxHitpoints":17200,"currentManapoints":17200,"maxManapoints":17200,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":766,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":766,"magicMaxDamage":154,"stabEvasionRating":604,"slashEvasionRating":604,"smashEvasionRating":604,"rangedEvasionRating":604,"magicEvasionRating":644.5,"totalArmor":118.80000000000001,"totalWaterResistance":133.8,"totalNatureResistance":133.8,"totalFireResistance":113.80000000000001,"totalThreat":100,"combatLevel":1105,"staminaLevel":1710,"intelligenceLevel":1710,"attackLevel":144,"powerLevel":144,"defenseLevel":594,"rangedLevel":756,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"waterResistance":60,"natureResistance":60,"fireResistance":40,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":10,"minEliteTier":1},{"abilityHrid":"/abilities/vampirism","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/steady_shot","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/silencing_shot","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":25,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":4000,"maxCount":20000,"minEliteTier":0},{"itemHrid":"/items/moonstone","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/revenant_anima","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/twilight_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/vampirism","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/steady_shot","dropRate":0.006,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/silencing_shot","dropRate":0.006,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/rain_of_arrows","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/critical_aura","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/dark_key_fragment","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/dark_key_fragment","dropRate":0.07,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.014685,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/elementalist":{"hrid":"/monsters/elementalist","name":"Elementalist","combatDetails":{"currentHitpoints":1700,"maxHitpoints":1700,"currentManapoints":1900,"maxManapoints":1900,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":190,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":190,"stabEvasionRating":90,"slashEvasionRating":90,"smashEvasionRating":90,"rangedEvasionRating":90,"magicEvasionRating":70,"totalArmor":16,"totalWaterResistance":66,"totalNatureResistance":66,"totalFireResistance":66,"totalThreat":100,"combatLevel":156,"staminaLevel":160,"intelligenceLevel":180,"attackLevel":0,"powerLevel":0,"defenseLevel":80,"rangedLevel":0,"magicLevel":180,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3500000000,"autoAttackDamage":-0.5,"waterAmplify":0.3,"fireAmplify":0.3,"waterResistance":40,"natureResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2900,"maxHitpoints":2900,"currentManapoints":3180,"maxManapoints":3180,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":318,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":318,"stabEvasionRating":178,"slashEvasionRating":178,"smashEvasionRating":178,"rangedEvasionRating":178,"magicEvasionRating":150,"totalArmor":33.6,"totalWaterResistance":87.6,"totalNatureResistance":87.6,"totalFireResistance":87.6,"totalThreat":100,"combatLevel":274,"staminaLevel":280,"intelligenceLevel":308,"attackLevel":56,"powerLevel":56,"defenseLevel":168,"rangedLevel":56,"magicLevel":308,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3500000000,"autoAttackDamage":-0.5,"waterAmplify":0.3,"fireAmplify":0.3,"waterResistance":40,"natureResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4420,"maxHitpoints":4420,"currentManapoints":4780,"maxManapoints":4780,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":478,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":478,"stabEvasionRating":298,"slashEvasionRating":298,"smashEvasionRating":298,"rangedEvasionRating":298,"magicEvasionRating":262,"totalArmor":57.6,"totalWaterResistance":115.60000000000001,"totalNatureResistance":115.60000000000001,"totalFireResistance":115.60000000000001,"totalThreat":100,"combatLevel":424,"staminaLevel":432,"intelligenceLevel":468,"attackLevel":144,"powerLevel":144,"defenseLevel":288,"rangedLevel":144,"magicLevel":468,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3500000000,"autoAttackDamage":-0.5,"waterAmplify":0.3,"fireAmplify":0.3,"waterResistance":40,"natureResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/revive","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/elemental_affinity","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/ice_spear","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/flame_blast","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":240,"maxCount":1200,"minEliteTier":0},{"itemHrid":"/items/dragon_fruit","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/silk_fabric","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/radiant_fiber","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/sorcerers_sole","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/tome_of_the_elements","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerer_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/elemental_affinity","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/ice_spear","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_blast","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/revive","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.00108,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/enchanted_bishop":{"hrid":"/monsters/enchanted_bishop","name":"Enchanted Bishop","combatDetails":{"currentHitpoints":30500,"maxHitpoints":30500,"currentManapoints":30500,"maxManapoints":30500,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":460,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":460,"stabEvasionRating":480,"slashEvasionRating":480,"smashEvasionRating":480,"rangedEvasionRating":320,"magicEvasionRating":485,"totalArmor":62,"totalWaterResistance":226,"totalNatureResistance":226,"totalFireResistance":176,"totalThreat":100,"combatLevel":1458,"staminaLevel":3040,"intelligenceLevel":3040,"attackLevel":0,"powerLevel":0,"defenseLevel":310,"rangedLevel":0,"magicLevel":450,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3500000000,"autoAttackDamage":-0.5,"natureAmplify":0.4,"healingAmplify":0.4,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"magicEvasion":1,"waterResistance":150,"natureResistance":150,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":43220,"maxHitpoints":43220,"currentManapoints":43220,"maxManapoints":43220,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":696,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":696,"stabEvasionRating":749.9999999999999,"slashEvasionRating":749.9999999999999,"smashEvasionRating":749.9999999999999,"rangedEvasionRating":499.99999999999994,"magicEvasionRating":782.9999999999999,"totalArmor":98,"totalWaterResistance":267.6,"totalNatureResistance":267.6,"totalFireResistance":217.60000000000002,"totalThreat":100,"combatLevel":2097,"staminaLevel":4312,"intelligenceLevel":4312,"attackLevel":56,"powerLevel":56,"defenseLevel":489.99999999999994,"rangedLevel":56,"magicLevel":686,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3500000000,"autoAttackDamage":-0.5,"natureAmplify":0.4,"healingAmplify":0.4,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"magicEvasion":1,"waterResistance":150,"natureResistance":150,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":56260,"maxHitpoints":56260,"currentManapoints":56260,"maxManapoints":56260,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":964,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":964,"stabEvasionRating":1068,"slashEvasionRating":1068,"smashEvasionRating":1068,"rangedEvasionRating":712,"magicEvasionRating":1145,"totalArmor":140.4,"totalWaterResistance":315.6,"totalNatureResistance":315.6,"totalFireResistance":265.6,"totalThreat":100,"combatLevel":2768,"staminaLevel":5616,"intelligenceLevel":5616,"attackLevel":144,"powerLevel":144,"defenseLevel":702,"rangedLevel":144,"magicLevel":954,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3500000000,"autoAttackDamage":-0.5,"natureAmplify":0.4,"healingAmplify":0.4,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"magicEvasion":1,"waterResistance":150,"natureResistance":150,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/revive","level":100,"minEliteTier":0},{"abilityHrid":"/abilities/arcane_reflection","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/rejuvenate","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/heal","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/natures_veil","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.12903,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/enchanted_king":{"hrid":"/monsters/enchanted_king","name":"Enchanted King","combatDetails":{"currentHitpoints":64000,"maxHitpoints":64000,"currentManapoints":64000,"maxManapoints":64000,"attackInterval":2500000000,"stabAccuracyRating":410,"slashAccuracyRating":410,"smashAccuracyRating":410,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":410,"slashMaxDamage":410,"smashMaxDamage":410,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":320,"slashEvasionRating":320,"smashEvasionRating":320,"rangedEvasionRating":320,"magicEvasionRating":242.5,"totalArmor":62,"totalWaterResistance":31,"totalNatureResistance":31,"totalFireResistance":31,"totalThreat":100,"combatLevel":2778,"staminaLevel":6390,"intelligenceLevel":6390,"attackLevel":400,"powerLevel":400,"defenseLevel":310,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":90120,"maxHitpoints":90120,"currentManapoints":90120,"maxManapoints":90120,"attackInterval":2293577981,"stabAccuracyRating":626,"slashAccuracyRating":626,"smashAccuracyRating":626,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":626,"slashMaxDamage":626,"smashMaxDamage":626,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":499.99999999999994,"slashEvasionRating":499.99999999999994,"smashEvasionRating":499.99999999999994,"rangedEvasionRating":499.99999999999994,"magicEvasionRating":391.49999999999994,"totalArmor":98,"totalWaterResistance":54.6,"totalNatureResistance":54.6,"totalFireResistance":54.6,"totalThreat":100,"combatLevel":3945,"staminaLevel":9002,"intelligenceLevel":9002,"attackLevel":616,"powerLevel":616,"defenseLevel":489.99999999999994,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":116560,"maxHitpoints":116560,"currentManapoints":116560,"maxManapoints":116560,"attackInterval":2094972067,"stabAccuracyRating":874,"slashAccuracyRating":874,"smashAccuracyRating":874,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":874,"slashMaxDamage":874,"smashMaxDamage":874,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":712,"slashEvasionRating":712,"smashEvasionRating":712,"rangedEvasionRating":712,"magicEvasionRating":572.5,"totalArmor":140.4,"totalWaterResistance":84.60000000000001,"totalNatureResistance":84.60000000000001,"totalFireResistance":84.60000000000001,"totalThreat":100,"combatLevel":5144,"staminaLevel":11646,"intelligenceLevel":11646,"attackLevel":864,"powerLevel":864,"defenseLevel":702,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/invincible","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/toughness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/elusiveness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/crippling_slash","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/cleave","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.5053216666666667,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/enchanted_knight":{"hrid":"/monsters/enchanted_knight","name":"Enchanted Knight","combatDetails":{"currentHitpoints":37700,"maxHitpoints":37700,"currentManapoints":37700,"maxManapoints":37700,"attackInterval":2904564315,"stabAccuracyRating":420,"slashAccuracyRating":420,"smashAccuracyRating":420,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":470,"slashMaxDamage":470,"smashMaxDamage":470,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":420,"slashEvasionRating":420,"smashEvasionRating":420,"rangedEvasionRating":840,"magicEvasionRating":317.5,"totalArmor":182,"totalWaterResistance":41,"totalNatureResistance":41,"totalFireResistance":41,"totalThreat":100,"combatLevel":1760,"staminaLevel":3760,"intelligenceLevel":3760,"attackLevel":410,"powerLevel":460,"defenseLevel":410,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":1,"armor":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":53300,"maxHitpoints":53300,"currentManapoints":53300,"maxManapoints":53300,"attackInterval":2661596958,"stabAccuracyRating":640,"slashAccuracyRating":640,"smashAccuracyRating":640,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":710,"slashMaxDamage":710,"smashMaxDamage":710,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":640,"slashEvasionRating":640,"smashEvasionRating":640,"rangedEvasionRating":1280,"magicEvasionRating":496.5,"totalArmor":226,"totalWaterResistance":68.6,"totalNatureResistance":68.6,"totalFireResistance":68.6,"totalThreat":100,"combatLevel":2520,"staminaLevel":5320,"intelligenceLevel":5320,"attackLevel":630,"powerLevel":700,"defenseLevel":630,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":1,"armor":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":69220,"maxHitpoints":69220,"currentManapoints":69220,"maxManapoints":69220,"attackInterval":2428868841,"stabAccuracyRating":892,"slashAccuracyRating":892,"smashAccuracyRating":892,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":982,"slashMaxDamage":982,"smashMaxDamage":982,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":892,"slashEvasionRating":892,"smashEvasionRating":892,"rangedEvasionRating":1784,"magicEvasionRating":707.5,"totalArmor":276.4,"totalWaterResistance":102.60000000000001,"totalNatureResistance":102.60000000000001,"totalFireResistance":102.60000000000001,"totalThreat":100,"combatLevel":3312,"staminaLevel":6912,"intelligenceLevel":6912,"attackLevel":882,"powerLevel":972,"defenseLevel":882,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":1,"armor":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/toughness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/crippling_slash","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/maim","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.1911,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/enchanted_pawn":{"hrid":"/monsters/enchanted_pawn","name":"Enchanted Pawn","combatDetails":{"currentHitpoints":9700,"maxHitpoints":9700,"currentManapoints":9700,"maxManapoints":9700,"attackInterval":2575107296,"stabAccuracyRating":340,"slashAccuracyRating":340,"smashAccuracyRating":340,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":340,"slashMaxDamage":340,"smashMaxDamage":340,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":320,"slashEvasionRating":320,"smashEvasionRating":320,"rangedEvasionRating":320,"magicEvasionRating":242.5,"totalArmor":62,"totalWaterResistance":31,"totalNatureResistance":31,"totalFireResistance":31,"totalThreat":100,"combatLevel":578,"staminaLevel":960,"intelligenceLevel":960,"attackLevel":330,"powerLevel":330,"defenseLevel":310,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":14100,"maxHitpoints":14100,"currentManapoints":14100,"maxManapoints":14100,"attackInterval":2382843526,"stabAccuracyRating":528,"slashAccuracyRating":528,"smashAccuracyRating":528,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":528,"slashMaxDamage":528,"smashMaxDamage":528,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":499.99999999999994,"slashEvasionRating":499.99999999999994,"smashEvasionRating":499.99999999999994,"rangedEvasionRating":499.99999999999994,"magicEvasionRating":391.49999999999994,"totalArmor":98,"totalWaterResistance":54.6,"totalNatureResistance":54.6,"totalFireResistance":54.6,"totalThreat":100,"combatLevel":865,"staminaLevel":1400,"intelligenceLevel":1400,"attackLevel":518,"powerLevel":518,"defenseLevel":489.99999999999994,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":18820,"maxHitpoints":18820,"currentManapoints":18820,"maxManapoints":18820,"attackInterval":2191380569,"stabAccuracyRating":748,"slashAccuracyRating":748,"smashAccuracyRating":748,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":748,"slashMaxDamage":748,"smashMaxDamage":748,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":712,"slashEvasionRating":712,"smashEvasionRating":712,"rangedEvasionRating":712,"magicEvasionRating":572.5,"totalArmor":140.4,"totalWaterResistance":84.60000000000001,"totalNatureResistance":84.60000000000001,"totalFireResistance":84.60000000000001,"totalThreat":100,"combatLevel":1184,"staminaLevel":1872,"intelligenceLevel":1872,"attackLevel":738,"powerLevel":738,"defenseLevel":702,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/promote","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/elusiveness","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/precision","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/stunning_blow","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.017367777777777777,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/enchanted_queen":{"hrid":"/monsters/enchanted_queen","name":"Enchanted Queen","combatDetails":{"currentHitpoints":64000,"maxHitpoints":64000,"currentManapoints":64000,"maxManapoints":64000,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":580,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":580,"stabEvasionRating":585,"slashEvasionRating":585,"smashEvasionRating":585,"rangedEvasionRating":390,"magicEvasionRating":295,"totalArmor":126,"totalWaterResistance":145,"totalNatureResistance":145,"totalFireResistance":145,"totalThreat":100,"combatLevel":2860,"staminaLevel":6390,"intelligenceLevel":6390,"attackLevel":0,"powerLevel":0,"defenseLevel":380,"rangedLevel":0,"magicLevel":570,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"armor":50,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":90120,"maxHitpoints":90120,"currentManapoints":90120,"maxManapoints":90120,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":864,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":864,"stabEvasionRating":897,"slashEvasionRating":897,"smashEvasionRating":897,"rangedEvasionRating":598,"magicEvasionRating":465,"totalArmor":167.60000000000002,"totalWaterResistance":194.20000000000002,"totalNatureResistance":194.20000000000002,"totalFireResistance":194.20000000000002,"totalThreat":100,"combatLevel":4060,"staminaLevel":9002,"intelligenceLevel":9002,"attackLevel":56,"powerLevel":56,"defenseLevel":588,"rangedLevel":56,"magicLevel":854,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"armor":50,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":116560,"maxHitpoints":116560,"currentManapoints":116560,"maxManapoints":116560,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":1180,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":1180,"stabEvasionRating":1257,"slashEvasionRating":1257,"smashEvasionRating":1257,"rangedEvasionRating":838,"magicEvasionRating":667,"totalArmor":215.60000000000002,"totalWaterResistance":249.8,"totalNatureResistance":249.8,"totalFireResistance":249.8,"totalThreat":100,"combatLevel":5292,"staminaLevel":11646,"intelligenceLevel":11646,"attackLevel":144,"powerLevel":144,"defenseLevel":828,"rangedLevel":144,"magicLevel":1170,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"stabEvasion":0.5,"slashEvasion":0.5,"smashEvasion":0.5,"armor":50,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/speed_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/toxic_pollen","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/mana_spring","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/flame_blast","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/water_strike","level":70,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.5199222222222223,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/enchanted_rook":{"hrid":"/monsters/enchanted_rook","name":"Enchanted Rook","combatDetails":{"currentHitpoints":34700,"maxHitpoints":34700,"currentManapoints":34700,"maxManapoints":34700,"attackInterval":3600000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":470,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":470,"magicMaxDamage":10,"stabEvasionRating":380,"slashEvasionRating":380,"smashEvasionRating":380,"rangedEvasionRating":760,"magicEvasionRating":704.375,"totalArmor":124,"totalWaterResistance":87,"totalNatureResistance":87,"totalFireResistance":87,"totalThreat":100,"combatLevel":1642,"staminaLevel":3460,"intelligenceLevel":3460,"attackLevel":0,"powerLevel":0,"defenseLevel":370,"rangedLevel":460,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3600000000,"rangedEvasion":1,"magicEvasion":0.75,"armor":50,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":49100,"maxHitpoints":49100,"currentManapoints":49100,"maxManapoints":49100,"attackInterval":3501945525,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":710,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":710,"magicMaxDamage":66,"stabEvasionRating":584,"slashEvasionRating":584,"smashEvasionRating":584,"rangedEvasionRating":1168,"magicEvasionRating":1077.125,"totalArmor":164.8,"totalWaterResistance":113,"totalNatureResistance":113,"totalFireResistance":113,"totalThreat":100,"combatLevel":2354,"staminaLevel":4900,"intelligenceLevel":4900,"attackLevel":56,"powerLevel":56,"defenseLevel":574,"rangedLevel":700,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3600000000,"rangedEvasion":1,"magicEvasion":0.75,"armor":50,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":63820,"maxHitpoints":63820,"currentManapoints":63820,"maxManapoints":63820,"attackInterval":3358208955,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":982,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":982,"magicMaxDamage":154,"stabEvasionRating":820,"slashEvasionRating":820,"smashEvasionRating":820,"rangedEvasionRating":1640,"magicEvasionRating":1505.875,"totalArmor":212,"totalWaterResistance":145.4,"totalNatureResistance":145.4,"totalFireResistance":145.4,"totalThreat":100,"combatLevel":3099,"staminaLevel":6372,"intelligenceLevel":6372,"attackLevel":144,"powerLevel":144,"defenseLevel":810,"rangedLevel":972,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3600000000,"rangedEvasion":1,"magicEvasion":0.75,"armor":50,"waterResistance":50,"natureResistance":50,"fireResistance":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/precision","level":40,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/silencing_shot","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/penetrating_shot","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.16452666666666668,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/eye":{"hrid":"/monsters/eye","name":"Eye","combatDetails":{"currentHitpoints":990,"maxHitpoints":990,"currentManapoints":990,"maxManapoints":990,"attackInterval":2872187649,"stabAccuracyRating":99,"slashAccuracyRating":99,"smashAccuracyRating":99,"rangedAccuracyRating":10,"magicAccuracyRating":99,"stabMaxDamage":99,"slashMaxDamage":99,"smashMaxDamage":99,"rangedMaxDamage":10,"magicMaxDamage":99,"stabEvasionRating":74.25,"slashEvasionRating":99,"smashEvasionRating":99,"rangedEvasionRating":74.25,"magicEvasionRating":76.75,"totalArmor":17.8,"totalWaterResistance":17.8,"totalNatureResistance":17.8,"totalFireResistance":17.8,"totalThreat":100,"combatLevel":89,"staminaLevel":89,"intelligenceLevel":89,"attackLevel":89,"powerLevel":89,"defenseLevel":89,"rangedLevel":0,"magicLevel":89,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1906,"maxHitpoints":1906,"currentManapoints":1906,"maxManapoints":1906,"attackInterval":2751536274,"stabAccuracyRating":190.6,"slashAccuracyRating":190.6,"smashAccuracyRating":190.6,"rangedAccuracyRating":66,"magicAccuracyRating":190.6,"stabMaxDamage":190.6,"slashMaxDamage":190.6,"smashMaxDamage":190.6,"rangedMaxDamage":66,"magicMaxDamage":190.6,"stabEvasionRating":142.95,"slashEvasionRating":190.6,"smashEvasionRating":190.6,"rangedEvasionRating":142.95,"magicEvasionRating":159.45,"totalArmor":36.12,"totalWaterResistance":36.12,"totalNatureResistance":36.12,"totalFireResistance":36.12,"totalThreat":100,"combatLevel":180,"staminaLevel":180.6,"intelligenceLevel":180.6,"attackLevel":180.6,"powerLevel":180.6,"defenseLevel":180.6,"rangedLevel":56,"magicLevel":180.6,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3142,"maxHitpoints":3142,"currentManapoints":3142,"maxManapoints":3142,"attackInterval":2603940630,"stabAccuracyRating":314.2,"slashAccuracyRating":314.2,"smashAccuracyRating":314.2,"rangedAccuracyRating":154,"magicAccuracyRating":314.2,"stabMaxDamage":314.2,"slashMaxDamage":314.2,"smashMaxDamage":314.2,"rangedMaxDamage":154,"magicMaxDamage":314.2,"stabEvasionRating":235.64999999999998,"slashEvasionRating":314.2,"smashEvasionRating":314.2,"rangedEvasionRating":235.64999999999998,"magicEvasionRating":274.15,"totalArmor":60.84,"totalWaterResistance":60.84,"totalNatureResistance":60.84,"totalFireResistance":60.84,"totalThreat":100,"combatLevel":304,"staminaLevel":304.2,"intelligenceLevel":304.2,"attackLevel":304.2,"powerLevel":304.2,"defenseLevel":304.2,"rangedLevel":144,"magicLevel":304.2,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/precision","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":200,"maxCount":1000,"minEliteTier":0},{"itemHrid":"/items/azure_cheese","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_cheese","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/crimson_cheese","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/strawberry","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/mooberry","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/marsberry","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.1,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.15,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/dragon_fruit","dropRate":0.05,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.6,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.45,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/eyessence","dropRate":0.4,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/precision","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0008841111111111111,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/eyes":{"hrid":"/monsters/eyes","name":"Eyes","combatDetails":{"currentHitpoints":1110,"maxHitpoints":1110,"currentManapoints":1110,"maxManapoints":1110,"attackInterval":2855782960,"stabAccuracyRating":111,"slashAccuracyRating":111,"smashAccuracyRating":111,"rangedAccuracyRating":10,"magicAccuracyRating":111,"stabMaxDamage":111,"slashMaxDamage":111,"smashMaxDamage":111,"rangedMaxDamage":10,"magicMaxDamage":111,"stabEvasionRating":83.25,"slashEvasionRating":111,"smashEvasionRating":111,"rangedEvasionRating":83.25,"magicEvasionRating":85.75,"totalArmor":20.200000000000003,"totalWaterResistance":20.200000000000003,"totalNatureResistance":20.200000000000003,"totalFireResistance":20.200000000000003,"totalThreat":100,"combatLevel":101,"staminaLevel":101,"intelligenceLevel":101,"attackLevel":101,"powerLevel":101,"defenseLevel":101,"rangedLevel":0,"magicLevel":101,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2074,"maxHitpoints":2074,"currentManapoints":2074,"maxManapoints":2074,"attackInterval":2730499681,"stabAccuracyRating":207.39999999999998,"slashAccuracyRating":207.39999999999998,"smashAccuracyRating":207.39999999999998,"rangedAccuracyRating":66,"magicAccuracyRating":207.39999999999998,"stabMaxDamage":207.39999999999998,"slashMaxDamage":207.39999999999998,"smashMaxDamage":207.39999999999998,"rangedMaxDamage":66,"magicMaxDamage":207.39999999999998,"stabEvasionRating":155.54999999999998,"slashEvasionRating":207.39999999999998,"smashEvasionRating":207.39999999999998,"rangedEvasionRating":155.54999999999998,"magicEvasionRating":172.04999999999998,"totalArmor":39.48,"totalWaterResistance":39.48,"totalNatureResistance":39.48,"totalFireResistance":39.48,"totalThreat":100,"combatLevel":197,"staminaLevel":197.39999999999998,"intelligenceLevel":197.39999999999998,"attackLevel":197.39999999999998,"powerLevel":197.39999999999998,"defenseLevel":197.39999999999998,"rangedLevel":56,"magicLevel":197.39999999999998,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3358,"maxHitpoints":3358,"currentManapoints":3358,"maxManapoints":3358,"attackInterval":2579757502,"stabAccuracyRating":335.8,"slashAccuracyRating":335.8,"smashAccuracyRating":335.8,"rangedAccuracyRating":154,"magicAccuracyRating":335.8,"stabMaxDamage":335.8,"slashMaxDamage":335.8,"smashMaxDamage":335.8,"rangedMaxDamage":154,"magicMaxDamage":335.8,"stabEvasionRating":251.85000000000002,"slashEvasionRating":335.8,"smashEvasionRating":335.8,"rangedEvasionRating":251.85000000000002,"magicEvasionRating":290.35,"totalArmor":65.16000000000001,"totalWaterResistance":65.16000000000001,"totalNatureResistance":65.16000000000001,"totalFireResistance":65.16000000000001,"totalThreat":100,"combatLevel":325,"staminaLevel":325.8,"intelligenceLevel":325.8,"attackLevel":325.8,"powerLevel":325.8,"defenseLevel":325.8,"rangedLevel":144,"magicLevel":325.8,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/precision","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":240,"maxCount":1200,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.15,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/goggles","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/eyessence","dropRate":0.4,"minCount":2,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/precision","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0010352222222222223,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/flame_sorcerer":{"hrid":"/monsters/flame_sorcerer","name":"Flame Sorcerer","combatDetails":{"currentHitpoints":1200,"maxHitpoints":1200,"currentManapoints":1400,"maxManapoints":1400,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":140,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":140,"stabEvasionRating":70,"slashEvasionRating":70,"smashEvasionRating":70,"rangedEvasionRating":70,"magicEvasionRating":55,"totalArmor":12,"totalWaterResistance":29,"totalNatureResistance":59,"totalFireResistance":59,"totalThreat":100,"combatLevel":112,"staminaLevel":110,"intelligenceLevel":130,"attackLevel":0,"powerLevel":0,"defenseLevel":60,"rangedLevel":0,"magicLevel":130,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":10,"natureResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2200,"maxHitpoints":2200,"currentManapoints":2479,"maxManapoints":2479,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":247.99999999999997,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":247.99999999999997,"stabEvasionRating":150,"slashEvasionRating":150,"smashEvasionRating":150,"rangedEvasionRating":150,"magicEvasionRating":129,"totalArmor":28,"totalWaterResistance":47.8,"totalNatureResistance":77.8,"totalFireResistance":77.8,"totalThreat":100,"combatLevel":212,"staminaLevel":210,"intelligenceLevel":237.99999999999997,"attackLevel":56,"powerLevel":56,"defenseLevel":140,"rangedLevel":56,"magicLevel":237.99999999999997,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":10,"natureResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3520,"maxHitpoints":3520,"currentManapoints":3880,"maxManapoints":3880,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":388,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":388,"stabEvasionRating":262,"slashEvasionRating":262,"smashEvasionRating":262,"rangedEvasionRating":262,"magicEvasionRating":235,"totalArmor":50.400000000000006,"totalWaterResistance":73,"totalNatureResistance":103,"totalFireResistance":103,"totalThreat":100,"combatLevel":345,"staminaLevel":342,"intelligenceLevel":378,"attackLevel":144,"powerLevel":144,"defenseLevel":252,"rangedLevel":144,"magicLevel":378,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"waterResistance":10,"natureResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/flame_blast","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/fireball","level":15,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":150,"maxCount":750,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/bamboo_fabric","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/flaming_cloth","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerers_sole","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerer_essence","dropRate":0.2,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/flame_blast","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/fireball","dropRate":0.012,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0011651851851851851,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/fly":{"hrid":"/monsters/fly","name":"Fly","combatDetails":{"currentHitpoints":50,"maxHitpoints":50,"currentManapoints":100,"maxManapoints":100,"attackInterval":3990024937,"stabAccuracyRating":15,"slashAccuracyRating":15,"smashAccuracyRating":7.5,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":15,"slashMaxDamage":15,"smashMaxDamage":7.5,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":11,"slashEvasionRating":11,"smashEvasionRating":11,"rangedEvasionRating":11,"magicEvasionRating":10.75,"totalArmor":0.2,"totalWaterResistance":0.1,"totalNatureResistance":0.1,"totalFireResistance":0.1,"totalThreat":100,"combatLevel":1,"staminaLevel":-5,"intelligenceLevel":0,"attackLevel":5,"powerLevel":5,"defenseLevel":1,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"smashAccuracy":-0.5,"smashDamage":-0.5,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":590,"maxHitpoints":590,"currentManapoints":660,"maxManapoints":660,"attackInterval":3877847794,"stabAccuracyRating":73,"slashAccuracyRating":73,"smashAccuracyRating":36.5,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":73,"slashMaxDamage":73,"smashMaxDamage":36.5,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":67.4,"slashEvasionRating":67.4,"smashEvasionRating":67.4,"rangedEvasionRating":67.4,"magicEvasionRating":67.05,"totalArmor":11.48,"totalWaterResistance":11.34,"totalNatureResistance":11.34,"totalFireResistance":11.34,"totalThreat":100,"combatLevel":57,"staminaLevel":49,"intelligenceLevel":56,"attackLevel":62.99999999999999,"powerLevel":62.99999999999999,"defenseLevel":57.4,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"smashAccuracy":-0.5,"smashDamage":-0.5,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1450,"maxHitpoints":1450,"currentManapoints":1540,"maxManapoints":1540,"attackInterval":3715745471,"stabAccuracyRating":163,"slashAccuracyRating":163,"smashAccuracyRating":81.5,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":163,"slashMaxDamage":163,"smashMaxDamage":81.5,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":155.8,"slashEvasionRating":155.8,"smashEvasionRating":155.8,"rangedEvasionRating":155.8,"magicEvasionRating":155.35000000000002,"totalArmor":29.160000000000004,"totalWaterResistance":28.980000000000004,"totalNatureResistance":28.980000000000004,"totalFireResistance":28.980000000000004,"totalThreat":100,"combatLevel":146,"staminaLevel":135,"intelligenceLevel":144,"attackLevel":153,"powerLevel":153,"defenseLevel":145.8,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"smashAccuracy":-0.5,"smashDamage":-0.5,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":8,"maxCount":40,"minEliteTier":0},{"itemHrid":"/items/blue_key_fragment","dropRate":0.0001,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00016749999999999998,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/frog":{"hrid":"/monsters/frog","name":"Frogger","combatDetails":{"currentHitpoints":150,"maxHitpoints":150,"currentManapoints":150,"maxManapoints":150,"attackInterval":3176178660,"stabAccuracyRating":25,"slashAccuracyRating":25,"smashAccuracyRating":25,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":20,"slashMaxDamage":20,"smashMaxDamage":20,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":25,"slashEvasionRating":25,"smashEvasionRating":25,"rangedEvasionRating":25,"magicEvasionRating":21.25,"totalArmor":3,"totalWaterResistance":1.5,"totalNatureResistance":1.5,"totalFireResistance":1.5,"totalThreat":100,"combatLevel":10,"staminaLevel":5,"intelligenceLevel":5,"attackLevel":15,"powerLevel":10,"defenseLevel":15,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":730,"maxHitpoints":730,"currentManapoints":730,"maxManapoints":730,"attackInterval":3081367356,"stabAccuracyRating":87,"slashAccuracyRating":87,"smashAccuracyRating":87,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":80,"slashMaxDamage":80,"smashMaxDamage":80,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":87,"slashEvasionRating":87,"smashEvasionRating":87,"rangedEvasionRating":87,"magicEvasionRating":81.75,"totalArmor":15.4,"totalWaterResistance":13.3,"totalNatureResistance":13.3,"totalFireResistance":13.3,"totalThreat":100,"combatLevel":70,"staminaLevel":62.99999999999999,"intelligenceLevel":62.99999999999999,"attackLevel":77,"powerLevel":70,"defenseLevel":77,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1630,"maxHitpoints":1630,"currentManapoints":1630,"maxManapoints":1630,"attackInterval":2947950253,"stabAccuracyRating":181,"slashAccuracyRating":181,"smashAccuracyRating":181,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":172,"slashMaxDamage":172,"smashMaxDamage":172,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":181,"slashEvasionRating":181,"smashEvasionRating":181,"rangedEvasionRating":181,"magicEvasionRating":174.25,"totalArmor":34.2,"totalWaterResistance":31.5,"totalNatureResistance":31.5,"totalFireResistance":31.5,"totalThreat":100,"combatLevel":162,"staminaLevel":153,"intelligenceLevel":153,"attackLevel":171,"powerLevel":162,"defenseLevel":171,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/smack","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":24,"maxCount":120,"minEliteTier":0},{"itemHrid":"/items/egg","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.4,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/swamp_essence","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/smack","dropRate":0.007,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0002916666666666667,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/giant_shoebill":{"hrid":"/monsters/giant_shoebill","name":"Giant Shoebill","combatDetails":{"currentHitpoints":1500,"maxHitpoints":1500,"currentManapoints":1500,"maxManapoints":1500,"attackInterval":2905569007,"stabAccuracyRating":75,"slashAccuracyRating":75,"smashAccuracyRating":75,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":75,"slashMaxDamage":75,"smashMaxDamage":75,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":60,"slashEvasionRating":60,"smashEvasionRating":60,"rangedEvasionRating":60,"magicEvasionRating":47.5,"totalArmor":10,"totalWaterResistance":5,"totalNatureResistance":5,"totalFireResistance":5,"totalThreat":100,"combatLevel":92,"staminaLevel":140,"intelligenceLevel":140,"attackLevel":65,"powerLevel":65,"defenseLevel":50,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2620,"maxHitpoints":2620,"currentManapoints":2620,"maxManapoints":2620,"attackInterval":2794597112,"stabAccuracyRating":157,"slashAccuracyRating":157,"smashAccuracyRating":157,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":157,"slashMaxDamage":157,"smashMaxDamage":157,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":136,"slashEvasionRating":136,"smashEvasionRating":136,"rangedEvasionRating":136,"magicEvasionRating":118.49999999999999,"totalArmor":25.2,"totalWaterResistance":18.2,"totalNatureResistance":18.2,"totalFireResistance":18.2,"totalThreat":100,"combatLevel":184,"staminaLevel":251.99999999999997,"intelligenceLevel":251.99999999999997,"attackLevel":147,"powerLevel":147,"defenseLevel":125.99999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4060,"maxHitpoints":4060,"currentManapoints":4060,"maxManapoints":4060,"attackInterval":2653693056,"stabAccuracyRating":271,"slashAccuracyRating":271,"smashAccuracyRating":271,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":271,"slashMaxDamage":271,"smashMaxDamage":271,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":244,"slashEvasionRating":244,"smashEvasionRating":244,"rangedEvasionRating":244,"magicEvasionRating":221.5,"totalArmor":46.800000000000004,"totalWaterResistance":37.800000000000004,"totalNatureResistance":37.800000000000004,"totalFireResistance":37.800000000000004,"totalThreat":100,"combatLevel":309,"staminaLevel":396,"intelligenceLevel":396,"attackLevel":261,"powerLevel":261,"defenseLevel":234,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/speed_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/elusiveness","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/sweep","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/smack","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":400,"maxCount":2000,"minEliteTier":0},{"itemHrid":"/items/swamp_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/shoebill_feather","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/elusiveness","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sweep","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/smack","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/speed_aura","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/green_key_fragment","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/green_key_fragment","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0013155555555555557,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gobo_boomy":{"hrid":"/monsters/gobo_boomy","name":"Boomy","combatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":800,"maxManapoints":800,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":74.4,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":70.8,"stabEvasionRating":50,"slashEvasionRating":50,"smashEvasionRating":50,"rangedEvasionRating":50,"magicEvasionRating":40,"totalArmor":8,"totalWaterResistance":24,"totalNatureResistance":24,"totalFireResistance":24,"totalThreat":100,"combatLevel":56,"staminaLevel":70,"intelligenceLevel":70,"attackLevel":0,"powerLevel":0,"defenseLevel":40,"rangedLevel":0,"magicLevel":50,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3500000000,"autoAttackDamage":-0.5,"magicAccuracy":0.24,"magicDamage":0.18,"fireAmplify":0.2,"waterResistance":15,"natureResistance":15,"fireResistance":15,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1640,"maxHitpoints":1640,"currentManapoints":1640,"maxManapoints":1640,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":168.64,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":160.48,"stabEvasionRating":122,"slashEvasionRating":122,"smashEvasionRating":122,"rangedEvasionRating":122,"magicEvasionRating":108,"totalArmor":22.400000000000002,"totalWaterResistance":38.8,"totalNatureResistance":38.8,"totalFireResistance":38.8,"totalThreat":100,"combatLevel":134,"staminaLevel":154,"intelligenceLevel":154,"attackLevel":56,"powerLevel":56,"defenseLevel":112,"rangedLevel":56,"magicLevel":125.99999999999999,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3500000000,"autoAttackDamage":-0.5,"magicAccuracy":0.24,"magicDamage":0.18,"fireAmplify":0.2,"waterResistance":15,"natureResistance":15,"fireResistance":15,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":2800,"maxManapoints":2800,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":302.56,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":287.91999999999996,"stabEvasionRating":226,"slashEvasionRating":226,"smashEvasionRating":226,"rangedEvasionRating":226,"magicEvasionRating":208,"totalArmor":43.2,"totalWaterResistance":60,"totalNatureResistance":60,"totalFireResistance":60,"totalThreat":100,"combatLevel":244,"staminaLevel":270,"intelligenceLevel":270,"attackLevel":144,"powerLevel":144,"defenseLevel":216,"rangedLevel":144,"magicLevel":234,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3500000000,"autoAttackDamage":-0.5,"magicAccuracy":0.24,"magicDamage":0.18,"fireAmplify":0.2,"waterResistance":15,"natureResistance":15,"fireResistance":15,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/revive","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/fireball","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":130,"maxCount":650,"minEliteTier":0},{"itemHrid":"/items/gobo_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/cotton_fabric","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/linen_fabric","dropRate":0.05,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/gobo_boomstick","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/fireball","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/revive","dropRate":0.0001,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00128,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gobo_chieftain":{"hrid":"/monsters/gobo_chieftain","name":"Gobo Chieftain","combatDetails":{"currentHitpoints":4800,"maxHitpoints":4800,"currentManapoints":4800,"maxManapoints":4800,"attackInterval":2976744186,"stabAccuracyRating":160,"slashAccuracyRating":160,"smashAccuracyRating":160,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":160,"slashMaxDamage":160,"smashMaxDamage":160,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":100,"slashEvasionRating":100,"smashEvasionRating":100,"rangedEvasionRating":100,"magicEvasionRating":77.5,"totalArmor":28,"totalWaterResistance":9,"totalNatureResistance":9,"totalFireResistance":9,"totalThreat":100,"combatLevel":266,"staminaLevel":470,"intelligenceLevel":470,"attackLevel":150,"powerLevel":150,"defenseLevel":90,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"armorPenetration":0.2,"armor":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":7240,"maxHitpoints":7240,"currentManapoints":7240,"maxManapoints":7240,"attackInterval":2824360105,"stabAccuracyRating":276,"slashAccuracyRating":276,"smashAccuracyRating":276,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":276,"slashMaxDamage":276,"smashMaxDamage":276,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":192,"slashEvasionRating":192,"smashEvasionRating":192,"rangedEvasionRating":192,"magicEvasionRating":160.5,"totalArmor":46.4,"totalWaterResistance":23.8,"totalNatureResistance":23.8,"totalFireResistance":23.8,"totalThreat":100,"combatLevel":428,"staminaLevel":714,"intelligenceLevel":714,"attackLevel":266,"powerLevel":266,"defenseLevel":182,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"armorPenetration":0.2,"armor":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":10000,"maxHitpoints":10000,"currentManapoints":10000,"maxManapoints":10000,"attackInterval":2651201325,"stabAccuracyRating":424,"slashAccuracyRating":424,"smashAccuracyRating":424,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":424,"slashMaxDamage":424,"smashMaxDamage":424,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":316,"slashEvasionRating":316,"smashEvasionRating":316,"rangedEvasionRating":316,"magicEvasionRating":275.5,"totalArmor":71.2,"totalWaterResistance":45,"totalNatureResistance":45,"totalFireResistance":45,"totalThreat":100,"combatLevel":622,"staminaLevel":990,"intelligenceLevel":990,"attackLevel":414,"powerLevel":414,"defenseLevel":306,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"armorPenetration":0.2,"armor":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/berserk","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/puncture","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/impale","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/poke","level":30,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":800,"maxCount":4000,"minEliteTier":0},{"itemHrid":"/items/gobo_hide","dropRate":1,"minCount":5,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/gobo_rag","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_defender","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/berserk","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/puncture","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/impale","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/poke","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/fierce_aura","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/purple_key_fragment","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/purple_key_fragment","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.004437222222222222,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gobo_shooty":{"hrid":"/monsters/gobo_shooty","name":"Shooty","combatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":300,"maxManapoints":300,"attackInterval":3200000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":78,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":93,"magicMaxDamage":10,"stabEvasionRating":70,"slashEvasionRating":70,"smashEvasionRating":70,"rangedEvasionRating":70,"magicEvasionRating":67.5,"totalArmor":12,"totalWaterResistance":36,"totalNatureResistance":36,"totalFireResistance":36,"totalThreat":100,"combatLevel":50,"staminaLevel":70,"intelligenceLevel":20,"attackLevel":0,"powerLevel":0,"defenseLevel":60,"rangedLevel":50,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3200000000,"rangedAccuracy":0.3,"rangedDamage":0.55,"waterResistance":30,"natureResistance":30,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1640,"maxHitpoints":1640,"currentManapoints":940,"maxManapoints":940,"attackInterval":3112840466,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":176.8,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":210.8,"magicMaxDamage":66,"stabEvasionRating":150,"slashEvasionRating":150,"smashEvasionRating":150,"rangedEvasionRating":150,"magicEvasionRating":146.5,"totalArmor":28,"totalWaterResistance":49.6,"totalNatureResistance":49.6,"totalFireResistance":49.6,"totalThreat":100,"combatLevel":126,"staminaLevel":154,"intelligenceLevel":84,"attackLevel":56,"powerLevel":56,"defenseLevel":140,"rangedLevel":125.99999999999999,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3200000000,"rangedAccuracy":0.3,"rangedDamage":0.55,"waterResistance":30,"natureResistance":30,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":1900,"maxManapoints":1900,"attackInterval":2985074626,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":317.2,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":378.2,"magicMaxDamage":154,"stabEvasionRating":262,"slashEvasionRating":262,"smashEvasionRating":262,"rangedEvasionRating":262,"magicEvasionRating":257.5,"totalArmor":50.400000000000006,"totalWaterResistance":69.6,"totalNatureResistance":69.6,"totalFireResistance":69.6,"totalThreat":100,"combatLevel":234,"staminaLevel":270,"intelligenceLevel":180,"attackLevel":144,"powerLevel":144,"defenseLevel":252,"rangedLevel":234,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3200000000,"rangedAccuracy":0.3,"rangedDamage":0.55,"waterResistance":30,"natureResistance":30,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/flame_arrow","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":130,"maxCount":650,"minEliteTier":0},{"itemHrid":"/items/gobo_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.15,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.05,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/gobo_shooter","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/flame_arrow","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00125,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gobo_slashy":{"hrid":"/monsters/gobo_slashy","name":"Slashy","combatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":300,"maxManapoints":300,"attackInterval":3235294117,"stabAccuracyRating":50,"slashAccuracyRating":95,"smashAccuracyRating":50,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":50,"slashMaxDamage":95,"smashMaxDamage":50,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":70,"slashEvasionRating":70,"smashEvasionRating":70,"rangedEvasionRating":70,"magicEvasionRating":55,"totalArmor":12,"totalWaterResistance":6,"totalNatureResistance":6,"totalFireResistance":6,"totalThreat":100,"combatLevel":46,"staminaLevel":70,"intelligenceLevel":20,"attackLevel":40,"powerLevel":40,"defenseLevel":60,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3300000000,"slashAccuracy":0.9,"slashDamage":0.9,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1640,"maxHitpoints":1640,"currentManapoints":940,"maxManapoints":940,"attackInterval":3125000000,"stabAccuracyRating":122,"slashAccuracyRating":231.79999999999998,"smashAccuracyRating":122,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":122,"slashMaxDamage":231.79999999999998,"smashMaxDamage":122,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":150,"slashEvasionRating":150,"smashEvasionRating":150,"rangedEvasionRating":150,"magicEvasionRating":129,"totalArmor":28,"totalWaterResistance":19.6,"totalNatureResistance":19.6,"totalFireResistance":19.6,"totalThreat":100,"combatLevel":120,"staminaLevel":154,"intelligenceLevel":84,"attackLevel":112,"powerLevel":112,"defenseLevel":140,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3300000000,"slashAccuracy":0.9,"slashDamage":0.9,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":1900,"maxManapoints":1900,"attackInterval":2978339350,"stabAccuracyRating":226,"slashAccuracyRating":429.4,"smashAccuracyRating":226,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":226,"slashMaxDamage":429.4,"smashMaxDamage":226,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":262,"slashEvasionRating":262,"smashEvasionRating":262,"rangedEvasionRating":262,"magicEvasionRating":235,"totalArmor":50.400000000000006,"totalWaterResistance":39.6,"totalNatureResistance":39.6,"totalFireResistance":39.6,"totalThreat":100,"combatLevel":226,"staminaLevel":270,"intelligenceLevel":180,"attackLevel":216,"powerLevel":216,"defenseLevel":252,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3300000000,"slashAccuracy":0.9,"slashDamage":0.9,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/cleave","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":130,"maxCount":650,"minEliteTier":0},{"itemHrid":"/items/gobo_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blackberry","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/strawberry","dropRate":0.15,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/mooberry","dropRate":0.05,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/gobo_slasher","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/cleave","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00123,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gobo_smashy":{"hrid":"/monsters/gobo_smashy","name":"Smashy","combatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":300,"maxManapoints":300,"attackInterval":3627450980,"stabAccuracyRating":50,"slashAccuracyRating":50,"smashAccuracyRating":55.00000000000001,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":55,"slashMaxDamage":55,"smashMaxDamage":145.75,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":70,"slashEvasionRating":70,"smashEvasionRating":70,"rangedEvasionRating":70,"magicEvasionRating":55,"totalArmor":12,"totalWaterResistance":6,"totalNatureResistance":6,"totalFireResistance":6,"totalThreat":100,"combatLevel":47,"staminaLevel":70,"intelligenceLevel":20,"attackLevel":40,"powerLevel":45,"defenseLevel":60,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3700000000,"smashAccuracy":0.1,"smashDamage":1.65,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1640,"maxHitpoints":1640,"currentManapoints":940,"maxManapoints":940,"attackInterval":3503787878,"stabAccuracyRating":122,"slashAccuracyRating":122,"smashAccuracyRating":134.20000000000002,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":129,"slashMaxDamage":129,"smashMaxDamage":341.84999999999997,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":150,"slashEvasionRating":150,"smashEvasionRating":150,"rangedEvasionRating":150,"magicEvasionRating":129,"totalArmor":28,"totalWaterResistance":19.6,"totalNatureResistance":19.6,"totalFireResistance":19.6,"totalThreat":100,"combatLevel":121,"staminaLevel":154,"intelligenceLevel":84,"attackLevel":112,"powerLevel":118.99999999999999,"defenseLevel":140,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3700000000,"smashAccuracy":0.1,"smashDamage":1.65,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":1900,"maxManapoints":1900,"attackInterval":3339350180,"stabAccuracyRating":226,"slashAccuracyRating":226,"smashAccuracyRating":248.60000000000002,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":235,"slashMaxDamage":235,"smashMaxDamage":622.75,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":262,"slashEvasionRating":262,"smashEvasionRating":262,"rangedEvasionRating":262,"magicEvasionRating":235,"totalArmor":50.400000000000006,"totalWaterResistance":39.6,"totalNatureResistance":39.6,"totalFireResistance":39.6,"totalThreat":100,"combatLevel":228,"staminaLevel":270,"intelligenceLevel":180,"attackLevel":216,"powerLevel":225,"defenseLevel":252,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3700000000,"smashAccuracy":0.1,"smashDamage":1.65,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/berserk","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":130,"maxCount":650,"minEliteTier":0},{"itemHrid":"/items/gobo_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.15,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.05,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/gobo_smasher","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/berserk","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0012350000000000002,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gobo_stabby":{"hrid":"/monsters/gobo_stabby","name":"Stabby","combatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":300,"maxManapoints":300,"attackInterval":2450980392,"stabAccuracyRating":150,"slashAccuracyRating":50,"smashAccuracyRating":50,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":44,"slashMaxDamage":40,"smashMaxDamage":40,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":70,"slashEvasionRating":70,"smashEvasionRating":70,"rangedEvasionRating":70,"magicEvasionRating":55,"totalArmor":12,"totalWaterResistance":6,"totalNatureResistance":6,"totalFireResistance":6,"totalThreat":100,"combatLevel":44,"staminaLevel":70,"intelligenceLevel":20,"attackLevel":40,"powerLevel":30,"defenseLevel":60,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":2500000000,"stabAccuracy":2,"stabDamage":0.1,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1640,"maxHitpoints":1640,"currentManapoints":940,"maxManapoints":940,"attackInterval":2367424242,"stabAccuracyRating":366,"slashAccuracyRating":122,"smashAccuracyRating":122,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":118.80000000000001,"slashMaxDamage":108,"smashMaxDamage":108,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":150,"slashEvasionRating":150,"smashEvasionRating":150,"rangedEvasionRating":150,"magicEvasionRating":129,"totalArmor":28,"totalWaterResistance":19.6,"totalNatureResistance":19.6,"totalFireResistance":19.6,"totalThreat":100,"combatLevel":117,"staminaLevel":154,"intelligenceLevel":84,"attackLevel":112,"powerLevel":98,"defenseLevel":140,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":2500000000,"stabAccuracy":2,"stabDamage":0.1,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":1900,"maxManapoints":1900,"attackInterval":2256317689,"stabAccuracyRating":678,"slashAccuracyRating":226,"smashAccuracyRating":226,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":228.8,"slashMaxDamage":208,"smashMaxDamage":208,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":262,"slashEvasionRating":262,"smashEvasionRating":262,"rangedEvasionRating":262,"magicEvasionRating":235,"totalArmor":50.400000000000006,"totalWaterResistance":39.6,"totalNatureResistance":39.6,"totalFireResistance":39.6,"totalThreat":100,"combatLevel":223,"staminaLevel":270,"intelligenceLevel":180,"attackLevel":216,"powerLevel":198,"defenseLevel":252,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":2500000000,"stabAccuracy":2,"stabDamage":0.1,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/impale","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":130,"maxCount":650,"minEliteTier":0},{"itemHrid":"/items/gobo_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/burble_milk","dropRate":0.15,"minCount":2,"maxCount":10,"minEliteTier":0},{"itemHrid":"/items/crimson_milk","dropRate":0.05,"minCount":2,"maxCount":10,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/gobo_stabber","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/gobo_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/impale","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00122,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/granite_golem":{"hrid":"/monsters/granite_golem","name":"Granite Golem","combatDetails":{"currentHitpoints":1800,"maxHitpoints":1800,"currentManapoints":1800,"maxManapoints":1800,"attackInterval":3105022831,"stabAccuracyRating":200,"slashAccuracyRating":200,"smashAccuracyRating":200,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":260,"slashMaxDamage":260,"smashMaxDamage":260,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":310,"slashEvasionRating":310,"smashEvasionRating":248,"rangedEvasionRating":434,"magicEvasionRating":235,"totalArmor":60,"totalWaterResistance":70,"totalNatureResistance":30,"totalFireResistance":70,"totalThreat":100,"combatLevel":216,"staminaLevel":170,"intelligenceLevel":170,"attackLevel":190,"powerLevel":250,"defenseLevel":300,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":3040,"maxHitpoints":3040,"currentManapoints":3040,"maxManapoints":3040,"attackInterval":2928509905,"stabAccuracyRating":332,"slashAccuracyRating":332,"smashAccuracyRating":332,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":416,"slashMaxDamage":416,"smashMaxDamage":416,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":485.99999999999994,"slashEvasionRating":485.99999999999994,"smashEvasionRating":388.79999999999995,"rangedEvasionRating":680.3999999999999,"magicEvasionRating":380.99999999999994,"totalArmor":95.19999999999999,"totalWaterResistance":93.19999999999999,"totalNatureResistance":53.199999999999996,"totalFireResistance":93.19999999999999,"totalThreat":100,"combatLevel":358,"staminaLevel":294,"intelligenceLevel":294,"attackLevel":322,"powerLevel":406,"defenseLevel":475.99999999999994,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4600,"maxHitpoints":4600,"currentManapoints":4600,"maxManapoints":4600,"attackInterval":2735317779,"stabAccuracyRating":496,"slashAccuracyRating":496,"smashAccuracyRating":496,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":604,"slashMaxDamage":604,"smashMaxDamage":604,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":694,"slashEvasionRating":694,"smashEvasionRating":555.2,"rangedEvasionRating":971.5999999999999,"magicEvasionRating":559,"totalArmor":136.8,"totalWaterResistance":122.80000000000001,"totalNatureResistance":82.80000000000001,"totalFireResistance":122.80000000000001,"totalThreat":100,"combatLevel":532,"staminaLevel":450,"intelligenceLevel":450,"attackLevel":486,"powerLevel":594,"defenseLevel":684,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/invincible","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/provoke","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/stunning_blow","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/sweep","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":750,"maxCount":3750,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/garnet","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jade","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/amethyst","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/living_granite","dropRate":0.0007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/golem_essence","dropRate":0.3,"minCount":3,"maxCount":9,"minEliteTier":0},{"itemHrid":"/items/provoke","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/stunning_blow","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sweep","dropRate":0.0025,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/invincible","dropRate":0.00005,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0014566666666666664,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/griffin":{"hrid":"/monsters/griffin","name":"Griffin","combatDetails":{"currentHitpoints":68500,"maxHitpoints":68500,"currentManapoints":68500,"maxManapoints":68500,"attackInterval":3076923076,"stabAccuracyRating":610,"slashAccuracyRating":610,"smashAccuracyRating":610,"rangedAccuracyRating":490,"magicAccuracyRating":10,"stabMaxDamage":610,"slashMaxDamage":610,"smashMaxDamage":610,"rangedMaxDamage":490,"magicMaxDamage":10,"stabEvasionRating":468,"slashEvasionRating":468,"smashEvasionRating":468,"rangedEvasionRating":360,"magicEvasionRating":785,"totalArmor":70,"totalWaterResistance":335,"totalNatureResistance":335,"totalFireResistance":335,"totalThreat":100,"combatLevel":3046,"staminaLevel":6840,"intelligenceLevel":6840,"attackLevel":600,"powerLevel":600,"defenseLevel":350,"rangedLevel":480,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"stabEvasion":0.3,"slashEvasion":0.3,"smashEvasion":0.3,"magicEvasion":1,"waterResistance":300,"natureResistance":300,"fireResistance":300,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":96420,"maxHitpoints":96420,"currentManapoints":96420,"maxManapoints":96420,"attackInterval":2762430939,"stabAccuracyRating":906,"slashAccuracyRating":906,"smashAccuracyRating":906,"rangedAccuracyRating":738,"magicAccuracyRating":66,"stabMaxDamage":906,"slashMaxDamage":906,"smashMaxDamage":906,"rangedMaxDamage":738,"magicMaxDamage":66,"stabEvasionRating":722.8000000000001,"slashEvasionRating":722.8000000000001,"smashEvasionRating":722.8000000000001,"rangedEvasionRating":556,"magicEvasionRating":1203,"totalArmor":109.2,"totalWaterResistance":360.2,"totalNatureResistance":360.2,"totalFireResistance":360.2,"totalThreat":100,"combatLevel":4320,"staminaLevel":9632,"intelligenceLevel":9632,"attackLevel":896,"powerLevel":896,"defenseLevel":546,"rangedLevel":728,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"stabEvasion":0.3,"slashEvasion":0.3,"smashEvasion":0.3,"magicEvasion":1,"waterResistance":300,"natureResistance":300,"fireResistance":300,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":124660,"maxHitpoints":124660,"currentManapoints":124660,"maxManapoints":124660,"attackInterval":2481389578,"stabAccuracyRating":1234,"slashAccuracyRating":1234,"smashAccuracyRating":1234,"rangedAccuracyRating":1018,"magicAccuracyRating":154,"stabMaxDamage":1234,"slashMaxDamage":1234,"smashMaxDamage":1234,"rangedMaxDamage":1018,"magicMaxDamage":154,"stabEvasionRating":1019.2,"slashEvasionRating":1019.2,"smashEvasionRating":1019.2,"rangedEvasionRating":784,"magicEvasionRating":1685,"totalArmor":154.8,"totalWaterResistance":391.8,"totalNatureResistance":391.8,"totalFireResistance":391.8,"totalThreat":100,"combatLevel":5626,"staminaLevel":12456,"intelligenceLevel":12456,"attackLevel":1224,"powerLevel":1224,"defenseLevel":774,"rangedLevel":1008,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"stabEvasion":0.3,"slashEvasion":0.3,"smashEvasion":0.3,"magicEvasion":1,"waterResistance":300,"natureResistance":300,"fireResistance":300,"tenacity":100,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/berserk","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/crippling_slash","level":20,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.5918655555555555,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/grizzly_bear":{"hrid":"/monsters/grizzly_bear","name":"Grizzly Bear","combatDetails":{"currentHitpoints":1400,"maxHitpoints":1400,"currentManapoints":1400,"maxManapoints":1400,"attackInterval":2976744186,"stabAccuracyRating":160,"slashAccuracyRating":160,"smashAccuracyRating":160,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":160,"slashMaxDamage":160,"smashMaxDamage":160,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":120,"slashEvasionRating":156,"smashEvasionRating":120,"rangedEvasionRating":120,"magicEvasionRating":92.5,"totalArmor":22,"totalWaterResistance":21,"totalNatureResistance":21,"totalFireResistance":11,"totalThreat":100,"combatLevel":134,"staminaLevel":130,"intelligenceLevel":130,"attackLevel":150,"powerLevel":150,"defenseLevel":110,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"slashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2479,"maxHitpoints":2479,"currentManapoints":2479,"maxManapoints":2479,"attackInterval":2824360105,"stabAccuracyRating":276,"slashAccuracyRating":276,"smashAccuracyRating":276,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":276,"slashMaxDamage":276,"smashMaxDamage":276,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":220,"slashEvasionRating":286,"smashEvasionRating":220,"rangedEvasionRating":220,"magicEvasionRating":181.5,"totalArmor":42,"totalWaterResistance":36.6,"totalNatureResistance":36.6,"totalFireResistance":26.6,"totalThreat":100,"combatLevel":243,"staminaLevel":237.99999999999997,"intelligenceLevel":237.99999999999997,"attackLevel":266,"powerLevel":266,"defenseLevel":210,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"slashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3880,"maxHitpoints":3880,"currentManapoints":3880,"maxManapoints":3880,"attackInterval":2651201325,"stabAccuracyRating":424,"slashAccuracyRating":424,"smashAccuracyRating":424,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":424,"slashMaxDamage":424,"smashMaxDamage":424,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":352,"slashEvasionRating":457.6,"smashEvasionRating":352,"rangedEvasionRating":352,"magicEvasionRating":302.5,"totalArmor":68.4,"totalWaterResistance":58.6,"totalNatureResistance":58.6,"totalFireResistance":48.6,"totalThreat":100,"combatLevel":385,"staminaLevel":378,"intelligenceLevel":378,"attackLevel":414,"powerLevel":414,"defenseLevel":342,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"slashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/frenzy","level":7,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":380,"maxCount":1900,"minEliteTier":0},{"itemHrid":"/items/beast_hide","dropRate":1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/mooberry","dropRate":0.1,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/marsberry","dropRate":0.15,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/spaceberry","dropRate":0.05,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.15,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/grizzly_bear_fluff","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/bear_essence","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/frenzy","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0014666666666666667,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/gummy_bear":{"hrid":"/monsters/gummy_bear","name":"Gummy Bear","combatDetails":{"currentHitpoints":1200,"maxHitpoints":1200,"currentManapoints":1200,"maxManapoints":1200,"attackInterval":2616822429,"stabAccuracyRating":150,"slashAccuracyRating":150,"smashAccuracyRating":150,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":90,"slashMaxDamage":90,"smashMaxDamage":90,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":90,"slashEvasionRating":90,"smashEvasionRating":117,"rangedEvasionRating":90,"magicEvasionRating":70,"totalArmor":16,"totalWaterResistance":18,"totalNatureResistance":18,"totalFireResistance":8,"totalThreat":100,"combatLevel":104,"staminaLevel":110,"intelligenceLevel":110,"attackLevel":140,"powerLevel":80,"defenseLevel":80,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":2800000000,"smashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2200,"maxHitpoints":2200,"currentManapoints":2200,"maxManapoints":2200,"attackInterval":2486678507,"stabAccuracyRating":262,"slashAccuracyRating":262,"smashAccuracyRating":262,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":178,"slashMaxDamage":178,"smashMaxDamage":178,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":178,"slashEvasionRating":178,"smashEvasionRating":231.4,"rangedEvasionRating":178,"magicEvasionRating":150,"totalArmor":33.6,"totalWaterResistance":32.400000000000006,"totalNatureResistance":32.400000000000006,"totalFireResistance":22.400000000000002,"totalThreat":100,"combatLevel":201,"staminaLevel":210,"intelligenceLevel":210,"attackLevel":251.99999999999997,"powerLevel":168,"defenseLevel":168,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":2800000000,"smashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3520,"maxHitpoints":3520,"currentManapoints":3520,"maxManapoints":3520,"attackInterval":2337228714,"stabAccuracyRating":406,"slashAccuracyRating":406,"smashAccuracyRating":406,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":298,"slashMaxDamage":298,"smashMaxDamage":298,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":298,"slashEvasionRating":298,"smashEvasionRating":387.40000000000003,"rangedEvasionRating":298,"magicEvasionRating":262,"totalArmor":57.6,"totalWaterResistance":53.2,"totalNatureResistance":53.2,"totalFireResistance":43.2,"totalThreat":100,"combatLevel":331,"staminaLevel":342,"intelligenceLevel":342,"attackLevel":396,"powerLevel":288,"defenseLevel":288,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":2800000000,"smashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/frenzy","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/sugar","dropRate":1,"minCount":20,"maxCount":100,"minEliteTier":0},{"itemHrid":"/items/apple_gummy","dropRate":0.5,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/orange_gummy","dropRate":0.5,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/plum_gummy","dropRate":0.5,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/peach_gummy","dropRate":0.5,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/dragon_fruit_gummy","dropRate":0.5,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/bear_essence","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/frenzy","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0011266666666666667,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/ice_sorcerer":{"hrid":"/monsters/ice_sorcerer","name":"Ice Sorcerer","combatDetails":{"currentHitpoints":1100,"maxHitpoints":1100,"currentManapoints":1300,"maxManapoints":1300,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":130,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":130,"stabEvasionRating":60,"slashEvasionRating":60,"smashEvasionRating":60,"rangedEvasionRating":60,"magicEvasionRating":47.5,"totalArmor":10,"totalWaterResistance":57,"totalNatureResistance":27,"totalFireResistance":57,"totalThreat":100,"combatLevel":102,"staminaLevel":100,"intelligenceLevel":120,"attackLevel":0,"powerLevel":0,"defenseLevel":50,"rangedLevel":0,"magicLevel":120,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterAmplify":0.2,"waterResistance":40,"natureResistance":10,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2060,"maxHitpoints":2060,"currentManapoints":2340,"maxManapoints":2340,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":234,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":234,"stabEvasionRating":136,"slashEvasionRating":136,"smashEvasionRating":136,"rangedEvasionRating":136,"magicEvasionRating":118.49999999999999,"totalArmor":25.2,"totalWaterResistance":75,"totalNatureResistance":45,"totalFireResistance":75,"totalThreat":100,"combatLevel":198,"staminaLevel":196,"intelligenceLevel":224,"attackLevel":56,"powerLevel":56,"defenseLevel":125.99999999999999,"rangedLevel":56,"magicLevel":224,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterAmplify":0.2,"waterResistance":40,"natureResistance":10,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3340,"maxHitpoints":3340,"currentManapoints":3700,"maxManapoints":3700,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":370,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":370,"stabEvasionRating":244,"slashEvasionRating":244,"smashEvasionRating":244,"rangedEvasionRating":244,"magicEvasionRating":221.5,"totalArmor":46.800000000000004,"totalWaterResistance":99.4,"totalNatureResistance":69.4,"totalFireResistance":99.4,"totalThreat":100,"combatLevel":327,"staminaLevel":324,"intelligenceLevel":360,"attackLevel":144,"powerLevel":144,"defenseLevel":234,"rangedLevel":144,"magicLevel":360,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterAmplify":0.2,"waterResistance":40,"natureResistance":10,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/ice_spear","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/water_strike","level":15,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":120,"maxCount":600,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/bamboo_fabric","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/icy_cloth","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerers_sole","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerer_essence","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/ice_spear","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/water_strike","dropRate":0.012,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0010311111111111111,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/infernal_warlock":{"hrid":"/monsters/infernal_warlock","name":"Infernal Warlock","combatDetails":{"currentHitpoints":2600,"maxHitpoints":2600,"currentManapoints":3100,"maxManapoints":3100,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":270,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":270,"stabEvasionRating":190,"slashEvasionRating":190,"smashEvasionRating":190,"rangedEvasionRating":190,"magicEvasionRating":145,"totalArmor":46,"totalWaterResistance":64,"totalNatureResistance":94,"totalFireResistance":94,"totalThreat":100,"combatLevel":250,"staminaLevel":250,"intelligenceLevel":300,"attackLevel":0,"powerLevel":0,"defenseLevel":180,"rangedLevel":0,"magicLevel":260,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"armor":10,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":4160,"maxHitpoints":4160,"currentManapoints":4859,"maxManapoints":4859,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":430,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":430,"stabEvasionRating":318,"slashEvasionRating":318,"smashEvasionRating":318,"rangedEvasionRating":318,"magicEvasionRating":255,"totalArmor":71.6,"totalWaterResistance":92.8,"totalNatureResistance":122.8,"totalFireResistance":122.8,"totalThreat":100,"combatLevel":406,"staminaLevel":406,"intelligenceLevel":475.99999999999994,"attackLevel":56,"powerLevel":56,"defenseLevel":308,"rangedLevel":56,"magicLevel":420,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"armor":10,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":6040,"maxHitpoints":6040,"currentManapoints":6940,"maxManapoints":6940,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":622,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":622,"stabEvasionRating":478,"slashEvasionRating":478,"smashEvasionRating":478,"rangedEvasionRating":478,"magicEvasionRating":397,"totalArmor":103.60000000000001,"totalWaterResistance":128,"totalNatureResistance":158,"totalFireResistance":158,"totalThreat":100,"combatLevel":594,"staminaLevel":594,"intelligenceLevel":684,"attackLevel":144,"powerLevel":144,"defenseLevel":468,"rangedLevel":144,"magicLevel":612,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"fireAmplify":0.2,"armor":10,"waterResistance":20,"natureResistance":50,"fireResistance":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/flame_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/firestorm","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/flame_blast","level":15,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":750,"maxCount":3750,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/infernal_ember","dropRate":0.0007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/abyssal_essence","dropRate":0.3,"minCount":3,"maxCount":9,"minEliteTier":0},{"itemHrid":"/items/firestorm","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_blast","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_aura","dropRate":0.00005,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0023250000000000002,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/jackalope":{"hrid":"/monsters/jackalope","name":"Jackalope","combatDetails":{"currentHitpoints":13500,"maxHitpoints":13500,"currentManapoints":13500,"maxManapoints":13500,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":320,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":320,"stabEvasionRating":260,"slashEvasionRating":260,"smashEvasionRating":260,"rangedEvasionRating":260,"magicEvasionRating":395,"totalArmor":50,"totalWaterResistance":256,"totalNatureResistance":256,"totalFireResistance":156,"totalThreat":100,"combatLevel":710,"staminaLevel":1340,"intelligenceLevel":1340,"attackLevel":0,"powerLevel":0,"defenseLevel":250,"rangedLevel":0,"magicLevel":310,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"magicEvasion":1,"waterResistance":200,"natureResistance":200,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":19419,"maxHitpoints":19419,"currentManapoints":19419,"maxManapoints":19419,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":499.99999999999994,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":499.99999999999994,"stabEvasionRating":416,"slashEvasionRating":416,"smashEvasionRating":416,"rangedEvasionRating":416,"magicEvasionRating":657,"totalArmor":81.2,"totalWaterResistance":289.6,"totalNatureResistance":289.6,"totalFireResistance":189.6,"totalThreat":100,"combatLevel":1050,"staminaLevel":1931.9999999999998,"intelligenceLevel":1931.9999999999998,"attackLevel":56,"powerLevel":56,"defenseLevel":406,"rangedLevel":56,"magicLevel":489.99999999999994,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"magicEvasion":1,"waterResistance":200,"natureResistance":200,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":25660,"maxHitpoints":25660,"currentManapoints":25660,"maxManapoints":25660,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":712,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":712,"stabEvasionRating":604,"slashEvasionRating":604,"smashEvasionRating":604,"rangedEvasionRating":604,"magicEvasionRating":983,"totalArmor":118.80000000000001,"totalWaterResistance":329.6,"totalNatureResistance":329.6,"totalFireResistance":229.60000000000002,"totalThreat":100,"combatLevel":1422,"staminaLevel":2556,"intelligenceLevel":2556,"attackLevel":144,"powerLevel":144,"defenseLevel":594,"rangedLevel":144,"magicLevel":702,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"magicEvasion":1,"waterResistance":200,"natureResistance":200,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/sylvan_aura","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/heal","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/natures_veil","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/entangle","level":60,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.02908888888888889,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/juggler":{"hrid":"/monsters/juggler","name":"Juggler","combatDetails":{"currentHitpoints":35000,"maxHitpoints":35000,"currentManapoints":35000,"maxManapoints":35000,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":460,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":460,"magicMaxDamage":10,"stabEvasionRating":320,"slashEvasionRating":320,"smashEvasionRating":320,"rangedEvasionRating":416,"magicEvasionRating":710,"totalArmor":62,"totalWaterResistance":131,"totalNatureResistance":131,"totalFireResistance":131,"totalThreat":100,"combatLevel":1638,"staminaLevel":3490,"intelligenceLevel":3490,"attackLevel":0,"powerLevel":0,"defenseLevel":310,"rangedLevel":450,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":0.3,"magicEvasion":1,"waterResistance":100,"natureResistance":100,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"curse":0.04}},"elite1CombatDetails":{"currentHitpoints":49520,"maxHitpoints":49520,"currentManapoints":49520,"maxManapoints":49520,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":696,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":696,"magicMaxDamage":66,"stabEvasionRating":499.99999999999994,"slashEvasionRating":499.99999999999994,"smashEvasionRating":499.99999999999994,"rangedEvasionRating":650,"magicEvasionRating":1098,"totalArmor":98,"totalWaterResistance":154.6,"totalNatureResistance":154.6,"totalFireResistance":154.6,"totalThreat":100,"combatLevel":2349,"staminaLevel":4942,"intelligenceLevel":4942,"attackLevel":56,"powerLevel":56,"defenseLevel":489.99999999999994,"rangedLevel":686,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":0.3,"magicEvasion":1,"waterResistance":100,"natureResistance":100,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"curse":0.04}},"elite2CombatDetails":{"currentHitpoints":64360,"maxHitpoints":64360,"currentManapoints":64360,"maxManapoints":64360,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":964,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":964,"magicMaxDamage":154,"stabEvasionRating":712,"slashEvasionRating":712,"smashEvasionRating":712,"rangedEvasionRating":925.6,"magicEvasionRating":1550,"totalArmor":140.4,"totalWaterResistance":184.60000000000002,"totalNatureResistance":184.60000000000002,"totalFireResistance":184.60000000000002,"totalThreat":100,"combatLevel":3092,"staminaLevel":6426,"intelligenceLevel":6426,"attackLevel":144,"powerLevel":144,"defenseLevel":702,"rangedLevel":954,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":0.3,"magicEvasion":1,"waterResistance":100,"natureResistance":100,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"curse":0.04}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/precision","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/pestilent_shot","level":40,"minEliteTier":0},{"abilityHrid":"/abilities/steady_shot","level":40,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.165555,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/jungle_sprite":{"hrid":"/monsters/jungle_sprite","name":"Jungle Sprite","combatDetails":{"currentHitpoints":500,"maxHitpoints":500,"currentManapoints":500,"maxManapoints":500,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":40,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":40,"stabEvasionRating":30,"slashEvasionRating":30,"smashEvasionRating":30,"rangedEvasionRating":30,"magicEvasionRating":25,"totalArmor":4,"totalWaterResistance":25,"totalNatureResistance":25,"totalFireResistance":5,"totalThreat":100,"combatLevel":32,"staminaLevel":40,"intelligenceLevel":40,"attackLevel":0,"powerLevel":0,"defenseLevel":20,"rangedLevel":0,"magicLevel":30,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1220,"maxHitpoints":1220,"currentManapoints":1220,"maxManapoints":1220,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":108,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":108,"stabEvasionRating":94,"slashEvasionRating":94,"smashEvasionRating":94,"rangedEvasionRating":94,"magicEvasionRating":87,"totalArmor":16.8,"totalWaterResistance":38.2,"totalNatureResistance":38.2,"totalFireResistance":18.200000000000003,"totalThreat":100,"combatLevel":100,"staminaLevel":112,"intelligenceLevel":112,"attackLevel":56,"powerLevel":56,"defenseLevel":84,"rangedLevel":56,"magicLevel":98,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2260,"maxHitpoints":2260,"currentManapoints":2260,"maxManapoints":2260,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":208,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":208,"stabEvasionRating":190,"slashEvasionRating":190,"smashEvasionRating":190,"rangedEvasionRating":190,"magicEvasionRating":181,"totalArmor":36,"totalWaterResistance":57.8,"totalNatureResistance":57.8,"totalFireResistance":37.8,"totalThreat":100,"combatLevel":201,"staminaLevel":216,"intelligenceLevel":216,"attackLevel":144,"powerLevel":144,"defenseLevel":180,"rangedLevel":144,"magicLevel":198,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/rejuvenate","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/heal","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/entangle","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":80,"maxCount":400,"minEliteTier":0},{"itemHrid":"/items/cotton","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/flax","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/tome_of_healing","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jungle_essence","dropRate":0.2,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/heal","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/entangle","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/rejuvenate","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0007733333333333332,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/luna_empress":{"hrid":"/monsters/luna_empress","name":"Luna Empress","combatDetails":{"currentHitpoints":4400,"maxHitpoints":4400,"currentManapoints":4400,"maxManapoints":4400,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":150,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":150,"stabEvasionRating":90,"slashEvasionRating":90,"smashEvasionRating":90,"rangedEvasionRating":90,"magicEvasionRating":70,"totalArmor":36,"totalWaterResistance":42,"totalNatureResistance":42,"totalFireResistance":22,"totalThreat":100,"combatLevel":244,"staminaLevel":430,"intelligenceLevel":430,"attackLevel":0,"powerLevel":0,"defenseLevel":80,"rangedLevel":0,"magicLevel":140,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"armor":20,"waterResistance":20,"natureResistance":20,"tenacity":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":6680,"maxHitpoints":6680,"currentManapoints":6680,"maxManapoints":6680,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":262,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":262,"stabEvasionRating":178,"slashEvasionRating":178,"smashEvasionRating":178,"rangedEvasionRating":178,"magicEvasionRating":150,"totalArmor":53.6,"totalWaterResistance":62,"totalNatureResistance":62,"totalFireResistance":42,"totalThreat":100,"combatLevel":397,"staminaLevel":658,"intelligenceLevel":658,"attackLevel":56,"powerLevel":56,"defenseLevel":168,"rangedLevel":56,"magicLevel":251.99999999999997,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"armor":20,"waterResistance":20,"natureResistance":20,"tenacity":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":9280,"maxHitpoints":9280,"currentManapoints":9280,"maxManapoints":9280,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":406,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":406,"stabEvasionRating":298,"slashEvasionRating":298,"smashEvasionRating":298,"rangedEvasionRating":298,"magicEvasionRating":262,"totalArmor":77.6,"totalWaterResistance":88.4,"totalNatureResistance":88.4,"totalFireResistance":68.4,"totalThreat":100,"combatLevel":583,"staminaLevel":918,"intelligenceLevel":918,"attackLevel":144,"powerLevel":144,"defenseLevel":288,"rangedLevel":144,"magicLevel":396,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"armor":20,"waterResistance":20,"natureResistance":20,"tenacity":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/sylvan_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/rejuvenate","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/elusiveness","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/natures_veil","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/toxic_pollen","level":15,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":1000,"maxCount":5000,"minEliteTier":0},{"itemHrid":"/items/amber","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/luna_wing","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jungle_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/rejuvenate","dropRate":0.0025,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/elusiveness","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/natures_veil","dropRate":0.0035,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/toxic_pollen","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sylvan_aura","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/green_key_fragment","dropRate":0.004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/green_key_fragment","dropRate":0.04,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0038,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/magician":{"hrid":"/monsters/magician","name":"Magician","combatDetails":{"currentHitpoints":32400,"maxHitpoints":32400,"currentManapoints":32400,"maxManapoints":32400,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":450,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":450,"stabEvasionRating":270,"slashEvasionRating":270,"smashEvasionRating":270,"rangedEvasionRating":270,"magicEvasionRating":205,"totalArmor":52,"totalWaterResistance":110,"totalNatureResistance":150,"totalFireResistance":150,"totalThreat":100,"combatLevel":1520,"staminaLevel":3230,"intelligenceLevel":3230,"attackLevel":0,"powerLevel":0,"defenseLevel":260,"rangedLevel":0,"magicLevel":440,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterResistance":40,"natureResistance":80,"fireResistance":80,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":45880,"maxHitpoints":45880,"currentManapoints":45880,"maxManapoints":45880,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":682,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":682,"stabEvasionRating":430,"slashEvasionRating":430,"smashEvasionRating":430,"rangedEvasionRating":430,"magicEvasionRating":339,"totalArmor":84,"totalWaterResistance":149.2,"totalNatureResistance":189.2,"totalFireResistance":189.2,"totalThreat":100,"combatLevel":2184,"staminaLevel":4578,"intelligenceLevel":4578,"attackLevel":56,"powerLevel":56,"defenseLevel":420,"rangedLevel":56,"magicLevel":672,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterResistance":40,"natureResistance":80,"fireResistance":80,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":59680,"maxHitpoints":59680,"currentManapoints":59680,"maxManapoints":59680,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":946,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":946,"stabEvasionRating":622,"slashEvasionRating":622,"smashEvasionRating":622,"rangedEvasionRating":622,"magicEvasionRating":505,"totalArmor":122.4,"totalWaterResistance":194.8,"totalNatureResistance":234.8,"totalFireResistance":234.8,"totalThreat":100,"combatLevel":2880,"staminaLevel":5958,"intelligenceLevel":5958,"attackLevel":144,"powerLevel":144,"defenseLevel":612,"rangedLevel":144,"magicLevel":936,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/fire","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterResistance":40,"natureResistance":80,"fireResistance":80,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/flame_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/elemental_affinity","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/rejuvenate","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/firestorm","level":40,"minEliteTier":0},{"abilityHrid":"/abilities/fireball","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.14263888888888887,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/magnetic_golem":{"hrid":"/monsters/magnetic_golem","name":"Magnetic Golem","combatDetails":{"currentHitpoints":1400,"maxHitpoints":1400,"currentManapoints":1400,"maxManapoints":1400,"attackInterval":3162790697,"stabAccuracyRating":160,"slashAccuracyRating":160,"smashAccuracyRating":160,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":220,"slashMaxDamage":220,"smashMaxDamage":220,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":270,"slashEvasionRating":270,"smashEvasionRating":216,"rangedEvasionRating":378,"magicEvasionRating":205,"totalArmor":52,"totalWaterResistance":66,"totalNatureResistance":26,"totalFireResistance":66,"totalThreat":100,"combatLevel":176,"staminaLevel":130,"intelligenceLevel":130,"attackLevel":150,"powerLevel":210,"defenseLevel":260,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2479,"maxHitpoints":2479,"currentManapoints":2479,"maxManapoints":2479,"attackInterval":3000882612,"stabAccuracyRating":276,"slashAccuracyRating":276,"smashAccuracyRating":276,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":360,"slashMaxDamage":360,"smashMaxDamage":360,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":430,"slashEvasionRating":430,"smashEvasionRating":344,"rangedEvasionRating":602,"magicEvasionRating":339,"totalArmor":84,"totalWaterResistance":87.6,"totalNatureResistance":47.6,"totalFireResistance":87.6,"totalThreat":100,"combatLevel":302,"staminaLevel":237.99999999999997,"intelligenceLevel":237.99999999999997,"attackLevel":266,"powerLevel":350,"defenseLevel":420,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3880,"maxHitpoints":3880,"currentManapoints":3880,"maxManapoints":3880,"attackInterval":2816901408,"stabAccuracyRating":424,"slashAccuracyRating":424,"smashAccuracyRating":424,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":532,"slashMaxDamage":532,"smashMaxDamage":532,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":622,"slashEvasionRating":622,"smashEvasionRating":497.6,"rangedEvasionRating":870.8,"magicEvasionRating":505,"totalArmor":122.4,"totalWaterResistance":115.60000000000001,"totalNatureResistance":75.60000000000001,"totalFireResistance":115.60000000000001,"totalThreat":100,"combatLevel":460,"staminaLevel":378,"intelligenceLevel":378,"attackLevel":414,"powerLevel":522,"defenseLevel":612,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/stunning_blow","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":500,"maxCount":2500,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/garnet","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jade","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/amethyst","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/magnet","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/golem_essence","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/stunning_blow","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0009833333333333332,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/manticore":{"hrid":"/monsters/manticore","name":"Manticore","combatDetails":{"currentHitpoints":35100,"maxHitpoints":35100,"currentManapoints":35100,"maxManapoints":35100,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":410,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":410,"magicMaxDamage":10,"stabEvasionRating":340,"slashEvasionRating":340,"smashEvasionRating":340,"rangedEvasionRating":442,"magicEvasionRating":715,"totalArmor":116,"totalWaterResistance":233,"totalNatureResistance":233,"totalFireResistance":233,"totalThreat":100,"combatLevel":1626,"staminaLevel":3500,"intelligenceLevel":3500,"attackLevel":0,"powerLevel":0,"defenseLevel":330,"rangedLevel":400,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":0.3,"magicEvasion":1,"armor":50,"waterResistance":200,"natureResistance":200,"fireResistance":200,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":49660,"maxHitpoints":49660,"currentManapoints":49660,"maxManapoints":49660,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":626,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":626,"magicMaxDamage":66,"stabEvasionRating":528,"slashEvasionRating":528,"smashEvasionRating":528,"rangedEvasionRating":686.4,"magicEvasionRating":1105,"totalArmor":153.60000000000002,"totalWaterResistance":257.4,"totalNatureResistance":257.4,"totalFireResistance":257.4,"totalThreat":100,"combatLevel":2332,"staminaLevel":4956,"intelligenceLevel":4956,"attackLevel":56,"powerLevel":56,"defenseLevel":518,"rangedLevel":616,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":0.3,"magicEvasion":1,"armor":50,"waterResistance":200,"natureResistance":200,"fireResistance":200,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":64540,"maxHitpoints":64540,"currentManapoints":64540,"maxManapoints":64540,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":874,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":874,"magicMaxDamage":154,"stabEvasionRating":748,"slashEvasionRating":748,"smashEvasionRating":748,"rangedEvasionRating":972.4,"magicEvasionRating":1559,"totalArmor":197.6,"totalWaterResistance":288.2,"totalNatureResistance":288.2,"totalFireResistance":288.2,"totalThreat":100,"combatLevel":3070,"staminaLevel":6444,"intelligenceLevel":6444,"attackLevel":144,"powerLevel":144,"defenseLevel":738,"rangedLevel":864,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"rangedEvasion":0.3,"magicEvasion":1,"armor":50,"waterResistance":200,"natureResistance":200,"fireResistance":200,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":25,"minEliteTier":0},{"abilityHrid":"/abilities/precision","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/pestilent_shot","level":40,"minEliteTier":0},{"abilityHrid":"/abilities/steady_shot","level":40,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.16485333333333332,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/marine_huntress":{"hrid":"/monsters/marine_huntress","name":"Marine Huntress","combatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":2800,"maxManapoints":2800,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":105,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":105,"magicMaxDamage":10,"stabEvasionRating":80,"slashEvasionRating":80,"smashEvasionRating":80,"rangedEvasionRating":80,"magicEvasionRating":86.25,"totalArmor":14,"totalWaterResistance":27,"totalNatureResistance":7,"totalFireResistance":27,"totalThreat":100,"combatLevel":160,"staminaLevel":270,"intelligenceLevel":270,"attackLevel":0,"powerLevel":0,"defenseLevel":70,"rangedLevel":95,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/water","attackInterval":3000000000,"waterAmplify":0.2,"waterResistance":20,"fireResistance":20,"tenacity":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":4440,"maxHitpoints":4440,"currentManapoints":4440,"maxManapoints":4440,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":199,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":199,"magicMaxDamage":66,"stabEvasionRating":164,"slashEvasionRating":164,"smashEvasionRating":164,"rangedEvasionRating":164,"magicEvasionRating":172.75,"totalArmor":30.8,"totalWaterResistance":41,"totalNatureResistance":21,"totalFireResistance":41,"totalThreat":100,"combatLevel":280,"staminaLevel":434,"intelligenceLevel":434,"attackLevel":56,"powerLevel":56,"defenseLevel":154,"rangedLevel":189,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/water","attackInterval":3000000000,"waterAmplify":0.2,"waterResistance":20,"fireResistance":20,"tenacity":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":6400,"maxHitpoints":6400,"currentManapoints":6400,"maxManapoints":6400,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":325,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":325,"magicMaxDamage":154,"stabEvasionRating":280,"slashEvasionRating":280,"smashEvasionRating":280,"rangedEvasionRating":280,"magicEvasionRating":291.25,"totalArmor":54,"totalWaterResistance":61.4,"totalNatureResistance":41.4,"totalFireResistance":61.4,"totalThreat":100,"combatLevel":432,"staminaLevel":630,"intelligenceLevel":630,"attackLevel":144,"powerLevel":144,"defenseLevel":270,"rangedLevel":315,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/water","attackInterval":3000000000,"waterAmplify":0.2,"waterResistance":20,"fireResistance":20,"tenacity":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/aqua_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/silencing_shot","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/aqua_arrow","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/rain_of_arrows","level":15,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":700,"maxCount":3500,"minEliteTier":0},{"itemHrid":"/items/pearl","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/marine_scale","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/silencing_shot","dropRate":0.0025,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_arrow","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/rain_of_arrows","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_aura","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/blue_key_fragment","dropRate":0.004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blue_key_fragment","dropRate":0.04,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0017722222222222223,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/myconid":{"hrid":"/monsters/myconid","name":"Myconid","combatDetails":{"currentHitpoints":700,"maxHitpoints":700,"currentManapoints":700,"maxManapoints":700,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":50,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":50,"stabEvasionRating":40,"slashEvasionRating":40,"smashEvasionRating":40,"rangedEvasionRating":40,"magicEvasionRating":32.5,"totalArmor":6,"totalWaterResistance":27,"totalNatureResistance":27,"totalFireResistance":7,"totalThreat":100,"combatLevel":46,"staminaLevel":60,"intelligenceLevel":60,"attackLevel":0,"powerLevel":0,"defenseLevel":30,"rangedLevel":0,"magicLevel":40,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1500,"maxHitpoints":1500,"currentManapoints":1500,"maxManapoints":1500,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":122,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":122,"stabEvasionRating":108,"slashEvasionRating":108,"smashEvasionRating":108,"rangedEvasionRating":108,"magicEvasionRating":97.5,"totalArmor":19.6,"totalWaterResistance":41,"totalNatureResistance":41,"totalFireResistance":21,"totalThreat":100,"combatLevel":120,"staminaLevel":140,"intelligenceLevel":140,"attackLevel":56,"powerLevel":56,"defenseLevel":98,"rangedLevel":56,"magicLevel":112,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2620,"maxHitpoints":2620,"currentManapoints":2620,"maxManapoints":2620,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":226,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":226,"stabEvasionRating":208,"slashEvasionRating":208,"smashEvasionRating":208,"rangedEvasionRating":208,"magicEvasionRating":194.5,"totalArmor":39.6,"totalWaterResistance":61.400000000000006,"totalNatureResistance":61.400000000000006,"totalFireResistance":41.400000000000006,"totalThreat":100,"combatLevel":226,"staminaLevel":252,"intelligenceLevel":252,"attackLevel":144,"powerLevel":144,"defenseLevel":198,"rangedLevel":144,"magicLevel":216,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/toxic_pollen","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":120,"maxCount":600,"minEliteTier":0},{"itemHrid":"/items/cocoon","dropRate":0.3,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/amber","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jungle_essence","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/toxic_pollen","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0010933333333333333,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/nom_nom":{"hrid":"/monsters/nom_nom","name":"Nom Nom","combatDetails":{"currentHitpoints":480,"maxHitpoints":480,"currentManapoints":480,"maxManapoints":480,"attackInterval":3129584352,"stabAccuracyRating":44,"slashAccuracyRating":44,"smashAccuracyRating":55,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":55,"slashMaxDamage":55,"smashMaxDamage":55,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":55,"slashEvasionRating":55,"smashEvasionRating":55,"rangedEvasionRating":55,"magicEvasionRating":43.75,"totalArmor":9,"totalWaterResistance":24.5,"totalNatureResistance":4.5,"totalFireResistance":24.5,"totalThreat":100,"combatLevel":42,"staminaLevel":38,"intelligenceLevel":38,"attackLevel":45,"powerLevel":45,"defenseLevel":45,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"stabAccuracy":-0.2,"slashAccuracy":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1192,"maxHitpoints":1192,"currentManapoints":1192,"maxManapoints":1192,"attackInterval":3020292590,"stabAccuracyRating":103.2,"slashAccuracyRating":103.2,"smashAccuracyRating":129,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":129,"slashMaxDamage":129,"smashMaxDamage":129,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":129,"slashEvasionRating":129,"smashEvasionRating":129,"rangedEvasionRating":129,"magicEvasionRating":113.24999999999999,"totalArmor":23.799999999999997,"totalWaterResistance":37.5,"totalNatureResistance":17.5,"totalFireResistance":37.5,"totalThreat":100,"combatLevel":115,"staminaLevel":109.19999999999999,"intelligenceLevel":109.19999999999999,"attackLevel":118.99999999999999,"powerLevel":118.99999999999999,"defenseLevel":118.99999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"stabAccuracy":-0.2,"slashAccuracy":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2224,"maxHitpoints":2224,"currentManapoints":2224,"maxManapoints":2224,"attackInterval":2876404494,"stabAccuracyRating":188,"slashAccuracyRating":188,"smashAccuracyRating":235,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":235,"slashMaxDamage":235,"smashMaxDamage":235,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":235,"slashEvasionRating":235,"smashEvasionRating":235,"rangedEvasionRating":235,"magicEvasionRating":214.75,"totalArmor":45,"totalWaterResistance":56.9,"totalNatureResistance":36.9,"totalFireResistance":56.9,"totalThreat":100,"combatLevel":219,"staminaLevel":212.4,"intelligenceLevel":212.4,"attackLevel":225,"powerLevel":225,"defenseLevel":225,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"stabAccuracy":-0.2,"slashAccuracy":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/impale","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":90,"maxCount":450,"minEliteTier":0},{"itemHrid":"/items/blackberry","dropRate":0.15,"minCount":1,"maxCount":12,"minEliteTier":0},{"itemHrid":"/items/strawberry","dropRate":0.05,"minCount":1,"maxCount":8,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.15,"minCount":1,"maxCount":10,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.05,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.4,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/pearl","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_essence","dropRate":0.4,"minCount":3,"maxCount":9,"minEliteTier":0},{"itemHrid":"/items/impale","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0007797777777777778,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/novice_sorcerer":{"hrid":"/monsters/novice_sorcerer","name":"Novice Sorcerer","combatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":800,"maxManapoints":800,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":100,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":100,"stabEvasionRating":40,"slashEvasionRating":40,"smashEvasionRating":40,"rangedEvasionRating":40,"magicEvasionRating":32.5,"totalArmor":6,"totalWaterResistance":32,"totalNatureResistance":32,"totalFireResistance":32,"totalThreat":100,"combatLevel":70,"staminaLevel":70,"intelligenceLevel":70,"attackLevel":0,"powerLevel":0,"defenseLevel":30,"rangedLevel":0,"magicLevel":90,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterAmplify":0.1,"waterResistance":20,"natureResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1640,"maxHitpoints":1640,"currentManapoints":1640,"maxManapoints":1640,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":192,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":192,"stabEvasionRating":108,"slashEvasionRating":108,"smashEvasionRating":108,"rangedEvasionRating":108,"magicEvasionRating":97.5,"totalArmor":19.6,"totalWaterResistance":48,"totalNatureResistance":48,"totalFireResistance":48,"totalThreat":100,"combatLevel":154,"staminaLevel":154,"intelligenceLevel":154,"attackLevel":56,"powerLevel":56,"defenseLevel":98,"rangedLevel":56,"magicLevel":182,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterAmplify":0.1,"waterResistance":20,"natureResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2800,"maxHitpoints":2800,"currentManapoints":2800,"maxManapoints":2800,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":316,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":316,"stabEvasionRating":208,"slashEvasionRating":208,"smashEvasionRating":208,"rangedEvasionRating":208,"magicEvasionRating":194.5,"totalArmor":39.6,"totalWaterResistance":70.4,"totalNatureResistance":70.4,"totalFireResistance":70.4,"totalThreat":100,"combatLevel":270,"staminaLevel":270,"intelligenceLevel":270,"attackLevel":144,"powerLevel":144,"defenseLevel":198,"rangedLevel":144,"magicLevel":306,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"waterAmplify":0.1,"waterResistance":20,"natureResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/quick_aid","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/water_strike","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":60,"maxCount":300,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/linen_fabric","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/sorcerers_sole","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sorcerer_essence","dropRate":0.2,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/quick_aid","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/water_strike","dropRate":0.008,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0006666666666666666,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/panda":{"hrid":"/monsters/panda","name":"Panda","combatDetails":{"currentHitpoints":1600,"maxHitpoints":1600,"currentManapoints":1600,"maxManapoints":1600,"attackInterval":3380281690,"stabAccuracyRating":140,"slashAccuracyRating":140,"smashAccuracyRating":140,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":140,"slashMaxDamage":140,"smashMaxDamage":140,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":140,"slashEvasionRating":140,"smashEvasionRating":182,"rangedEvasionRating":140,"magicEvasionRating":107.5,"totalArmor":38,"totalWaterResistance":23,"totalNatureResistance":23,"totalFireResistance":13,"totalThreat":100,"combatLevel":138,"staminaLevel":150,"intelligenceLevel":150,"attackLevel":130,"powerLevel":130,"defenseLevel":130,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3600000000,"smashEvasion":0.3,"armor":12,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2760,"maxHitpoints":2760,"currentManapoints":2760,"maxManapoints":2760,"attackInterval":3217158176,"stabAccuracyRating":247.99999999999997,"slashAccuracyRating":247.99999999999997,"smashAccuracyRating":247.99999999999997,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":247.99999999999997,"slashMaxDamage":247.99999999999997,"smashMaxDamage":247.99999999999997,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":247.99999999999997,"slashEvasionRating":247.99999999999997,"smashEvasionRating":322.4,"rangedEvasionRating":247.99999999999997,"magicEvasionRating":202.49999999999997,"totalArmor":59.599999999999994,"totalWaterResistance":39.4,"totalNatureResistance":39.4,"totalFireResistance":29.4,"totalThreat":100,"combatLevel":249,"staminaLevel":266,"intelligenceLevel":266,"attackLevel":237.99999999999997,"powerLevel":237.99999999999997,"defenseLevel":237.99999999999997,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3600000000,"smashEvasion":0.3,"armor":12,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4240,"maxHitpoints":4240,"currentManapoints":4240,"maxManapoints":4240,"attackInterval":3027754415,"stabAccuracyRating":388,"slashAccuracyRating":388,"smashAccuracyRating":388,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":388,"slashMaxDamage":388,"smashMaxDamage":388,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":388,"slashEvasionRating":388,"smashEvasionRating":504.40000000000003,"rangedEvasionRating":388,"magicEvasionRating":329.5,"totalArmor":87.60000000000001,"totalWaterResistance":62.2,"totalNatureResistance":62.2,"totalFireResistance":52.2,"totalThreat":100,"combatLevel":392,"staminaLevel":414,"intelligenceLevel":414,"attackLevel":378,"powerLevel":378,"defenseLevel":378,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3600000000,"smashEvasion":0.3,"armor":12,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/toughness","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":340,"maxCount":1700,"minEliteTier":0},{"itemHrid":"/items/beast_hide","dropRate":1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/bamboo_branch","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/wheat","dropRate":0.3,"minCount":1,"maxCount":15,"minEliteTier":0},{"itemHrid":"/items/egg","dropRate":0.3,"minCount":1,"maxCount":15,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.1,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/dragon_fruit","dropRate":0.15,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/star_fruit","dropRate":0.05,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.15,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/panda_fluff","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/bear_essence","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.0016874074074074074,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/polar_bear":{"hrid":"/monsters/polar_bear","name":"Polar Bear","combatDetails":{"currentHitpoints":1500,"maxHitpoints":1500,"currentManapoints":1500,"maxManapoints":1500,"attackInterval":2962962962,"stabAccuracyRating":170,"slashAccuracyRating":170,"smashAccuracyRating":170,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":170,"slashMaxDamage":170,"smashMaxDamage":170,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":140,"slashEvasionRating":140,"smashEvasionRating":182,"rangedEvasionRating":140,"magicEvasionRating":107.5,"totalArmor":26,"totalWaterResistance":23,"totalNatureResistance":23,"totalFireResistance":13,"totalThreat":100,"combatLevel":146,"staminaLevel":140,"intelligenceLevel":140,"attackLevel":160,"powerLevel":160,"defenseLevel":130,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"smashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2620,"maxHitpoints":2620,"currentManapoints":2620,"maxManapoints":2620,"attackInterval":2807017543,"stabAccuracyRating":290,"slashAccuracyRating":290,"smashAccuracyRating":290,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":290,"slashMaxDamage":290,"smashMaxDamage":290,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":247.99999999999997,"slashEvasionRating":247.99999999999997,"smashEvasionRating":322.4,"rangedEvasionRating":247.99999999999997,"magicEvasionRating":202.49999999999997,"totalArmor":47.599999999999994,"totalWaterResistance":39.4,"totalNatureResistance":39.4,"totalFireResistance":29.4,"totalThreat":100,"combatLevel":260,"staminaLevel":251.99999999999997,"intelligenceLevel":251.99999999999997,"attackLevel":280,"powerLevel":280,"defenseLevel":237.99999999999997,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"smashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4060,"maxHitpoints":4060,"currentManapoints":4060,"maxManapoints":4060,"attackInterval":2631578947,"stabAccuracyRating":442,"slashAccuracyRating":442,"smashAccuracyRating":442,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":442,"slashMaxDamage":442,"smashMaxDamage":442,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":388,"slashEvasionRating":388,"smashEvasionRating":504.40000000000003,"rangedEvasionRating":388,"magicEvasionRating":329.5,"totalArmor":75.60000000000001,"totalWaterResistance":62.2,"totalNatureResistance":62.2,"totalFireResistance":52.2,"totalThreat":100,"combatLevel":406,"staminaLevel":396,"intelligenceLevel":396,"attackLevel":432,"powerLevel":432,"defenseLevel":378,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"smashEvasion":0.3,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/frenzy","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":440,"maxCount":2200,"minEliteTier":0},{"itemHrid":"/items/beast_hide","dropRate":1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/crimson_milk","dropRate":0.1,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/rainbow_milk","dropRate":0.15,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/holy_milk","dropRate":0.05,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.15,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/polar_bear_fluff","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/bear_essence","dropRate":0.3,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/frenzy","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0009155555555555556,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/porcupine":{"hrid":"/monsters/porcupine","name":"Porcupine","combatDetails":{"currentHitpoints":120,"maxHitpoints":120,"currentManapoints":120,"maxManapoints":120,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":20,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":20,"magicMaxDamage":10,"stabEvasionRating":18,"slashEvasionRating":18,"smashEvasionRating":18,"rangedEvasionRating":18,"magicEvasionRating":18.5,"totalArmor":1.6,"totalWaterResistance":0.8,"totalNatureResistance":0.8,"totalFireResistance":0.8,"totalThreat":100,"combatLevel":6,"staminaLevel":2,"intelligenceLevel":2,"attackLevel":0,"powerLevel":0,"defenseLevel":8,"rangedLevel":10,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":688,"maxHitpoints":688,"currentManapoints":688,"maxManapoints":688,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":80,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":80,"magicMaxDamage":66,"stabEvasionRating":77.19999999999999,"slashEvasionRating":77.19999999999999,"smashEvasionRating":77.19999999999999,"rangedEvasionRating":77.19999999999999,"magicEvasionRating":77.89999999999999,"totalArmor":13.439999999999998,"totalWaterResistance":12.32,"totalNatureResistance":12.32,"totalFireResistance":12.32,"totalThreat":100,"combatLevel":64,"staminaLevel":58.8,"intelligenceLevel":58.8,"attackLevel":56,"powerLevel":56,"defenseLevel":67.19999999999999,"rangedLevel":70,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1576,"maxHitpoints":1576,"currentManapoints":1576,"maxManapoints":1576,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":172,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":172,"magicMaxDamage":154,"stabEvasionRating":168.4,"slashEvasionRating":168.4,"smashEvasionRating":168.4,"rangedEvasionRating":168.4,"magicEvasionRating":169.3,"totalArmor":31.680000000000003,"totalWaterResistance":30.240000000000002,"totalNatureResistance":30.240000000000002,"totalFireResistance":30.240000000000002,"totalThreat":100,"combatLevel":155,"staminaLevel":147.6,"intelligenceLevel":147.6,"attackLevel":144,"powerLevel":144,"defenseLevel":158.4,"rangedLevel":162,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/quick_shot","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":16,"maxCount":80,"minEliteTier":0},{"itemHrid":"/items/rough_hide","dropRate":1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/cotton","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/quick_shot","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blue_key_fragment","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00025177777777777774,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/rabid_rabbit":{"hrid":"/monsters/rabid_rabbit","name":"Rabid Rabbit","combatDetails":{"currentHitpoints":8500,"maxHitpoints":8500,"currentManapoints":8500,"maxManapoints":8500,"attackInterval":2620087336,"stabAccuracyRating":300,"slashAccuracyRating":300,"smashAccuracyRating":300,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":370,"slashMaxDamage":370,"smashMaxDamage":370,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":210,"slashEvasionRating":210,"smashEvasionRating":210,"rangedEvasionRating":210,"magicEvasionRating":160,"totalArmor":40,"totalWaterResistance":20,"totalNatureResistance":20,"totalFireResistance":20,"totalThreat":100,"combatLevel":506,"staminaLevel":840,"intelligenceLevel":840,"attackLevel":290,"powerLevel":360,"defenseLevel":200,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":12420,"maxHitpoints":12420,"currentManapoints":12420,"maxManapoints":12420,"attackInterval":2437043054,"stabAccuracyRating":471.99999999999994,"slashAccuracyRating":471.99999999999994,"smashAccuracyRating":471.99999999999994,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":570,"slashMaxDamage":570,"smashMaxDamage":570,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":346,"slashEvasionRating":346,"smashEvasionRating":346,"rangedEvasionRating":346,"magicEvasionRating":276,"totalArmor":67.2,"totalWaterResistance":39.2,"totalNatureResistance":39.2,"totalFireResistance":39.2,"totalThreat":100,"combatLevel":764,"staminaLevel":1232,"intelligenceLevel":1232,"attackLevel":461.99999999999994,"powerLevel":560,"defenseLevel":336,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":16660,"maxHitpoints":16660,"currentManapoints":16660,"maxManapoints":16660,"attackInterval":2250562640,"stabAccuracyRating":676,"slashAccuracyRating":676,"smashAccuracyRating":676,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":802,"slashMaxDamage":802,"smashMaxDamage":802,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":514,"slashEvasionRating":514,"smashEvasionRating":514,"rangedEvasionRating":514,"magicEvasionRating":424,"totalArmor":100.80000000000001,"totalWaterResistance":64.80000000000001,"totalNatureResistance":64.80000000000001,"totalFireResistance":64.80000000000001,"totalThreat":100,"combatLevel":1054,"staminaLevel":1656,"intelligenceLevel":1656,"attackLevel":666,"powerLevel":792,"defenseLevel":504,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/insanity","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/berserk","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/scratch","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.01352111111111111,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/rat":{"hrid":"/monsters/rat","name":"Jerry","combatDetails":{"currentHitpoints":70,"maxHitpoints":70,"currentManapoints":100,"maxManapoints":100,"attackInterval":3491271820,"stabAccuracyRating":15,"slashAccuracyRating":15,"smashAccuracyRating":15,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":15,"slashMaxDamage":15,"smashMaxDamage":15,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":15,"slashEvasionRating":15,"smashEvasionRating":15,"rangedEvasionRating":15,"magicEvasionRating":13.75,"totalArmor":1,"totalWaterResistance":0.5,"totalNatureResistance":0.5,"totalFireResistance":0.5,"totalThreat":100,"combatLevel":2,"staminaLevel":-3,"intelligenceLevel":0,"attackLevel":5,"powerLevel":5,"defenseLevel":5,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3500000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":618,"maxHitpoints":618,"currentManapoints":660,"maxManapoints":660,"attackInterval":3393116820,"stabAccuracyRating":73,"slashAccuracyRating":73,"smashAccuracyRating":73,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":73,"slashMaxDamage":73,"smashMaxDamage":73,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":73,"slashEvasionRating":73,"smashEvasionRating":73,"rangedEvasionRating":73,"magicEvasionRating":71.25,"totalArmor":12.6,"totalWaterResistance":11.9,"totalNatureResistance":11.9,"totalFireResistance":11.9,"totalThreat":100,"combatLevel":59,"staminaLevel":51.8,"intelligenceLevel":56,"attackLevel":62.99999999999999,"powerLevel":62.99999999999999,"defenseLevel":62.99999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3500000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1486,"maxHitpoints":1486,"currentManapoints":1540,"maxManapoints":1540,"attackInterval":3251277287,"stabAccuracyRating":163,"slashAccuracyRating":163,"smashAccuracyRating":163,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":163,"slashMaxDamage":163,"smashMaxDamage":163,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":163,"slashEvasionRating":163,"smashEvasionRating":163,"rangedEvasionRating":163,"magicEvasionRating":160.75,"totalArmor":30.6,"totalWaterResistance":29.700000000000003,"totalNatureResistance":29.700000000000003,"totalFireResistance":29.700000000000003,"totalThreat":100,"combatLevel":148,"staminaLevel":138.6,"intelligenceLevel":144,"attackLevel":153,"powerLevel":153,"defenseLevel":153,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3500000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/poke","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":10,"maxCount":50,"minEliteTier":0},{"itemHrid":"/items/rough_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/wheat","dropRate":0.3,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/sugar","dropRate":0.3,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/cheese","dropRate":0.2,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/verdant_cheese","dropRate":0.1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/azure_cheese","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/poke","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blue_key_fragment","dropRate":0.0002,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00019077777777777778,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/red_panda":{"hrid":"/monsters/red_panda","name":"Red Panda","combatDetails":{"currentHitpoints":6800,"maxHitpoints":6800,"currentManapoints":6800,"maxManapoints":6800,"attackInterval":2882882882,"stabAccuracyRating":230,"slashAccuracyRating":230,"smashAccuracyRating":230,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":230,"slashMaxDamage":230,"smashMaxDamage":230,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":170,"slashEvasionRating":170,"smashEvasionRating":221,"rangedEvasionRating":170,"magicEvasionRating":130,"totalArmor":52,"totalWaterResistance":26,"totalNatureResistance":26,"totalFireResistance":16,"totalThreat":100,"combatLevel":388,"staminaLevel":670,"intelligenceLevel":670,"attackLevel":220,"powerLevel":220,"defenseLevel":160,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"smashEvasion":0.3,"armor":20,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":10039,"maxHitpoints":10039,"currentManapoints":10039,"maxManapoints":10039,"attackInterval":2707275803,"stabAccuracyRating":374,"slashAccuracyRating":374,"smashAccuracyRating":374,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":374,"slashMaxDamage":374,"smashMaxDamage":374,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":290,"slashEvasionRating":290,"smashEvasionRating":377,"rangedEvasionRating":290,"magicEvasionRating":234,"totalArmor":76,"totalWaterResistance":43.6,"totalNatureResistance":43.6,"totalFireResistance":33.6,"totalThreat":100,"combatLevel":599,"staminaLevel":993.9999999999999,"intelligenceLevel":993.9999999999999,"attackLevel":364,"powerLevel":364,"defenseLevel":280,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"smashEvasion":0.3,"armor":20,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":13600,"maxHitpoints":13600,"currentManapoints":13600,"maxManapoints":13600,"attackInterval":2519685039,"stabAccuracyRating":550,"slashAccuracyRating":550,"smashAccuracyRating":550,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":550,"slashMaxDamage":550,"smashMaxDamage":550,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":442,"slashEvasionRating":442,"smashEvasionRating":574.6,"rangedEvasionRating":442,"magicEvasionRating":370,"totalArmor":106.4,"totalWaterResistance":67.6,"totalNatureResistance":67.6,"totalFireResistance":57.6,"totalThreat":100,"combatLevel":842,"staminaLevel":1350,"intelligenceLevel":1350,"attackLevel":540,"powerLevel":540,"defenseLevel":432,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3200000000,"smashEvasion":0.3,"armor":20,"waterResistance":10,"natureResistance":10,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/insanity","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/berserk","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/maim","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/cleave","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":2500,"maxCount":12500,"minEliteTier":0},{"itemHrid":"/items/beast_hide","dropRate":1,"minCount":3,"maxCount":9,"minEliteTier":0},{"itemHrid":"/items/red_panda_fluff","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/bear_essence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/berserk","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/frenzy","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/maim","dropRate":0.0025,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/cleave","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/insanity","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/brown_key_fragment","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/brown_key_fragment","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.008586666666666668,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/sea_snail":{"hrid":"/monsters/sea_snail","name":"Gary","combatDetails":{"currentHitpoints":350,"maxHitpoints":350,"currentManapoints":350,"maxManapoints":350,"attackInterval":3956478733,"stabAccuracyRating":32,"slashAccuracyRating":32,"smashAccuracyRating":32,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":32,"slashMaxDamage":32,"smashMaxDamage":32,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":38,"slashEvasionRating":53.199999999999996,"smashEvasionRating":30.400000000000002,"rangedEvasionRating":38,"magicEvasionRating":31,"totalArmor":5.6000000000000005,"totalWaterResistance":22.8,"totalNatureResistance":2.8000000000000003,"totalFireResistance":22.8,"totalThreat":100,"combatLevel":24,"staminaLevel":25,"intelligenceLevel":25,"attackLevel":22,"powerLevel":22,"defenseLevel":28,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1010,"maxHitpoints":1010,"currentManapoints":1010,"maxManapoints":1010,"attackInterval":3833620854,"stabAccuracyRating":96.8,"slashAccuracyRating":96.8,"smashAccuracyRating":96.8,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":96.8,"slashMaxDamage":96.8,"smashMaxDamage":96.8,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":105.19999999999999,"slashEvasionRating":147.27999999999997,"smashEvasionRating":84.16,"rangedEvasionRating":105.19999999999999,"magicEvasionRating":95.39999999999999,"totalArmor":19.04,"totalWaterResistance":35.120000000000005,"totalNatureResistance":15.120000000000001,"totalFireResistance":35.120000000000005,"totalThreat":100,"combatLevel":90,"staminaLevel":91,"intelligenceLevel":91,"attackLevel":86.8,"powerLevel":86.8,"defenseLevel":95.19999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1990,"maxHitpoints":1990,"currentManapoints":1990,"maxManapoints":1990,"attackInterval":3663674665,"stabAccuracyRating":193.6,"slashAccuracyRating":193.6,"smashAccuracyRating":193.6,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":193.6,"slashMaxDamage":193.6,"smashMaxDamage":193.6,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":204.4,"slashEvasionRating":286.15999999999997,"smashEvasionRating":163.52,"rangedEvasionRating":204.4,"magicEvasionRating":191.8,"totalArmor":38.88,"totalWaterResistance":53.84,"totalNatureResistance":33.84,"totalFireResistance":53.84,"totalThreat":100,"combatLevel":187,"staminaLevel":189,"intelligenceLevel":189,"attackLevel":183.6,"powerLevel":183.6,"defenseLevel":194.4,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":4000000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/toughness","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":56,"maxCount":280,"minEliteTier":0},{"itemHrid":"/items/wheat","dropRate":0.3,"minCount":1,"maxCount":10,"minEliteTier":0},{"itemHrid":"/items/snail_shell","dropRate":0.006,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.4,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/aqua_essence","dropRate":0.3,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0005600000000000001,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/skunk":{"hrid":"/monsters/skunk","name":"Skunk","combatDetails":{"currentHitpoints":100,"maxHitpoints":100,"currentManapoints":100,"maxManapoints":100,"attackInterval":3486055776,"stabAccuracyRating":18,"slashAccuracyRating":18,"smashAccuracyRating":18,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":18,"slashMaxDamage":18,"smashMaxDamage":18,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":18,"slashEvasionRating":18,"smashEvasionRating":18,"rangedEvasionRating":18,"magicEvasionRating":16,"totalArmor":1.6,"totalWaterResistance":0.8,"totalNatureResistance":0.8,"totalFireResistance":0.8,"totalThreat":100,"combatLevel":4,"staminaLevel":0,"intelligenceLevel":0,"attackLevel":8,"powerLevel":8,"defenseLevel":8,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":660,"maxHitpoints":660,"currentManapoints":660,"maxManapoints":660,"attackInterval":3386222910,"stabAccuracyRating":77.19999999999999,"slashAccuracyRating":77.19999999999999,"smashAccuracyRating":77.19999999999999,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":77.19999999999999,"slashMaxDamage":77.19999999999999,"smashMaxDamage":77.19999999999999,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":77.19999999999999,"slashEvasionRating":77.19999999999999,"smashEvasionRating":77.19999999999999,"rangedEvasionRating":77.19999999999999,"magicEvasionRating":74.39999999999999,"totalArmor":13.439999999999998,"totalWaterResistance":12.32,"totalNatureResistance":12.32,"totalFireResistance":12.32,"totalThreat":100,"combatLevel":62,"staminaLevel":56,"intelligenceLevel":56,"attackLevel":67.19999999999999,"powerLevel":67.19999999999999,"defenseLevel":67.19999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1540,"maxHitpoints":1540,"currentManapoints":1540,"maxManapoints":1540,"attackInterval":3243143068,"stabAccuracyRating":168.4,"slashAccuracyRating":168.4,"smashAccuracyRating":168.4,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":168.4,"slashMaxDamage":168.4,"smashMaxDamage":168.4,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":168.4,"slashEvasionRating":168.4,"smashEvasionRating":168.4,"rangedEvasionRating":168.4,"magicEvasionRating":164.8,"totalArmor":31.680000000000003,"totalWaterResistance":30.240000000000002,"totalNatureResistance":30.240000000000002,"totalFireResistance":30.240000000000002,"totalThreat":100,"combatLevel":152,"staminaLevel":144,"intelligenceLevel":144,"attackLevel":158.4,"powerLevel":158.4,"defenseLevel":158.4,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/scratch","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":14,"maxCount":70,"minEliteTier":0},{"itemHrid":"/items/rough_hide","dropRate":1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/blueberry","dropRate":0.2,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/scratch","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blue_key_fragment","dropRate":0.00025,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00022666666666666668,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/slimy":{"hrid":"/monsters/slimy","name":"Slimy","combatDetails":{"currentHitpoints":140,"maxHitpoints":140,"currentManapoints":200,"maxManapoints":200,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":22,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":22,"stabEvasionRating":20,"slashEvasionRating":20,"smashEvasionRating":20,"rangedEvasionRating":20,"magicEvasionRating":17.5,"totalArmor":2,"totalWaterResistance":2.2,"totalNatureResistance":2.2,"totalFireResistance":2.2,"totalThreat":100,"combatLevel":9,"staminaLevel":4,"intelligenceLevel":10,"attackLevel":0,"powerLevel":0,"defenseLevel":10,"rangedLevel":0,"magicLevel":12,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":716,"maxHitpoints":716,"currentManapoints":800,"maxManapoints":800,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":82.8,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":82.8,"stabEvasionRating":80,"slashEvasionRating":80,"smashEvasionRating":80,"rangedEvasionRating":80,"magicEvasionRating":76.5,"totalArmor":14,"totalWaterResistance":14.280000000000001,"totalNatureResistance":14.280000000000001,"totalFireResistance":14.280000000000001,"totalThreat":100,"combatLevel":69,"staminaLevel":61.599999999999994,"intelligenceLevel":70,"attackLevel":56,"powerLevel":56,"defenseLevel":70,"rangedLevel":56,"magicLevel":72.8,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1612,"maxHitpoints":1612,"currentManapoints":1720,"maxManapoints":1720,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":175.6,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":175.6,"stabEvasionRating":172,"slashEvasionRating":172,"smashEvasionRating":172,"rangedEvasionRating":172,"magicEvasionRating":167.5,"totalArmor":32.4,"totalWaterResistance":32.76,"totalNatureResistance":32.76,"totalFireResistance":32.76,"totalThreat":100,"combatLevel":161,"staminaLevel":151.20000000000002,"intelligenceLevel":162,"attackLevel":144,"powerLevel":144,"defenseLevel":162,"rangedLevel":144,"magicLevel":165.6,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3000000000,"autoAttackDamage":-0.5,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/minor_heal","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/water_strike","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":20,"maxCount":100,"minEliteTier":0},{"itemHrid":"/items/apple","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/minor_heal","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/water_strike","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blue_key_fragment","dropRate":0.00035,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00027866666666666665,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/snake":{"hrid":"/monsters/snake","name":"Thnake","combatDetails":{"currentHitpoints":200,"maxHitpoints":200,"currentManapoints":200,"maxManapoints":200,"attackInterval":3177755710,"stabAccuracyRating":24,"slashAccuracyRating":24,"smashAccuracyRating":24,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":26,"slashMaxDamage":26,"smashMaxDamage":26,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":28,"slashEvasionRating":19.599999999999998,"smashEvasionRating":28,"rangedEvasionRating":28,"magicEvasionRating":23.5,"totalArmor":3.6,"totalWaterResistance":1.8,"totalNatureResistance":1.8,"totalFireResistance":1.8,"totalThreat":100,"combatLevel":13,"staminaLevel":10,"intelligenceLevel":10,"attackLevel":14,"powerLevel":16,"defenseLevel":18,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"slashEvasion":-0.3,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":800,"maxHitpoints":800,"currentManapoints":800,"maxManapoints":800,"attackInterval":3083445750,"stabAccuracyRating":85.6,"slashAccuracyRating":85.6,"smashAccuracyRating":85.6,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":88.39999999999999,"slashMaxDamage":88.39999999999999,"smashMaxDamage":88.39999999999999,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":91.19999999999999,"slashEvasionRating":63.83999999999999,"smashEvasionRating":91.19999999999999,"rangedEvasionRating":91.19999999999999,"magicEvasionRating":84.89999999999999,"totalArmor":16.24,"totalWaterResistance":13.719999999999999,"totalNatureResistance":13.719999999999999,"totalFireResistance":13.719999999999999,"totalThreat":100,"combatLevel":75,"staminaLevel":70,"intelligenceLevel":70,"attackLevel":75.6,"powerLevel":78.39999999999999,"defenseLevel":81.19999999999999,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"slashEvasion":-0.3,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1720,"maxHitpoints":1720,"currentManapoints":1720,"maxManapoints":1720,"attackInterval":2950396459,"stabAccuracyRating":179.20000000000002,"slashAccuracyRating":179.20000000000002,"smashAccuracyRating":179.20000000000002,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":182.8,"slashMaxDamage":182.8,"smashMaxDamage":182.8,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":186.4,"slashEvasionRating":130.48,"smashEvasionRating":186.4,"rangedEvasionRating":186.4,"magicEvasionRating":178.3,"totalArmor":35.28,"totalWaterResistance":32.04,"totalNatureResistance":32.04,"totalFireResistance":32.04,"totalThreat":100,"combatLevel":168,"staminaLevel":162,"intelligenceLevel":162,"attackLevel":169.20000000000002,"powerLevel":172.8,"defenseLevel":176.4,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3200000000,"slashEvasion":-0.3,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/poke","level":5,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":32,"maxCount":160,"minEliteTier":0},{"itemHrid":"/items/reptile_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/egg","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/snake_fang","dropRate":0.015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/swamp_essence","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/poke","dropRate":0.008,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00035499999999999996,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/soul_hunter":{"hrid":"/monsters/soul_hunter","name":"Soul Hunter","combatDetails":{"currentHitpoints":2300,"maxHitpoints":2300,"currentManapoints":2300,"maxManapoints":2300,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":230,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":230,"magicMaxDamage":10,"stabEvasionRating":160,"slashEvasionRating":160,"smashEvasionRating":160,"rangedEvasionRating":160,"magicEvasionRating":177.5,"totalArmor":30,"totalWaterResistance":65,"totalNatureResistance":65,"totalFireResistance":65,"totalThreat":100,"combatLevel":206,"staminaLevel":220,"intelligenceLevel":220,"attackLevel":0,"powerLevel":0,"defenseLevel":150,"rangedLevel":220,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"fireAmplify":0.2,"waterResistance":50,"natureResistance":50,"fireResistance":50,"manaLeech":0.02,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":3740,"maxHitpoints":3740,"currentManapoints":3740,"maxManapoints":3740,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":374,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":374,"magicMaxDamage":66,"stabEvasionRating":276,"slashEvasionRating":276,"smashEvasionRating":276,"rangedEvasionRating":276,"magicEvasionRating":300.5,"totalArmor":53.2,"totalWaterResistance":82.2,"totalNatureResistance":82.2,"totalFireResistance":82.2,"totalThreat":100,"combatLevel":344,"staminaLevel":364,"intelligenceLevel":364,"attackLevel":56,"powerLevel":56,"defenseLevel":266,"rangedLevel":364,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"fireAmplify":0.2,"waterResistance":50,"natureResistance":50,"fireResistance":50,"manaLeech":0.02,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":5500,"maxHitpoints":5500,"currentManapoints":5500,"maxManapoints":5500,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":550,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":550,"magicMaxDamage":154,"stabEvasionRating":424,"slashEvasionRating":424,"smashEvasionRating":424,"rangedEvasionRating":424,"magicEvasionRating":455.5,"totalArmor":82.80000000000001,"totalWaterResistance":105.80000000000001,"totalNatureResistance":105.80000000000001,"totalFireResistance":105.80000000000001,"totalThreat":100,"combatLevel":514,"staminaLevel":540,"intelligenceLevel":540,"attackLevel":144,"powerLevel":144,"defenseLevel":414,"rangedLevel":540,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3000000000,"fireAmplify":0.2,"waterResistance":50,"natureResistance":50,"fireResistance":50,"manaLeech":0.02,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/silencing_shot","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/flame_arrow","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":600,"maxCount":3000,"minEliteTier":0},{"itemHrid":"/items/umbral_leather","dropRate":0.1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/soul_fragment","dropRate":0.0007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/abyssal_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/silencing_shot","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_arrow","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/critical_aura","dropRate":0.00005,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0017733333333333334,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/squawker":{"hrid":"/monsters/squawker","name":"Squawker","combatDetails":{"currentHitpoints":10500,"maxHitpoints":10500,"currentManapoints":10500,"maxManapoints":10500,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":370,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":370,"stabEvasionRating":775,"slashEvasionRating":775,"smashEvasionRating":775,"rangedEvasionRating":310,"magicEvasionRating":235,"totalArmor":60,"totalWaterResistance":66,"totalNatureResistance":66,"totalFireResistance":66,"totalThreat":100,"combatLevel":620,"staminaLevel":1040,"intelligenceLevel":1040,"attackLevel":0,"powerLevel":0,"defenseLevel":300,"rangedLevel":0,"magicLevel":360,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"stabEvasion":1.5,"slashEvasion":1.5,"smashEvasion":1.5,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"bloom":0.4}},"elite1CombatDetails":{"currentHitpoints":15220,"maxHitpoints":15220,"currentManapoints":15220,"maxManapoints":15220,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":570,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":570,"stabEvasionRating":1214.9999999999998,"slashEvasionRating":1214.9999999999998,"smashEvasionRating":1214.9999999999998,"rangedEvasionRating":485.99999999999994,"magicEvasionRating":380.99999999999994,"totalArmor":95.19999999999999,"totalWaterResistance":103.6,"totalNatureResistance":103.6,"totalFireResistance":103.6,"totalThreat":100,"combatLevel":924,"staminaLevel":1512,"intelligenceLevel":1512,"attackLevel":56,"powerLevel":56,"defenseLevel":475.99999999999994,"rangedLevel":56,"magicLevel":560,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"stabEvasion":1.5,"slashEvasion":1.5,"smashEvasion":1.5,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"bloom":0.4}},"elite2CombatDetails":{"currentHitpoints":20260,"maxHitpoints":20260,"currentManapoints":20260,"maxManapoints":20260,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":802,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":802,"stabEvasionRating":1735,"slashEvasionRating":1735,"smashEvasionRating":1735,"rangedEvasionRating":694,"magicEvasionRating":559,"totalArmor":136.8,"totalWaterResistance":147.60000000000002,"totalNatureResistance":147.60000000000002,"totalFireResistance":147.60000000000002,"totalThreat":100,"combatLevel":1260,"staminaLevel":2016,"intelligenceLevel":2016,"attackLevel":144,"powerLevel":144,"defenseLevel":684,"rangedLevel":144,"magicLevel":792,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"stabEvasion":1.5,"slashEvasion":1.5,"smashEvasion":1.5,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"bloom":0.4}},"abilities":[{"abilityHrid":"/abilities/sylvan_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/life_drain","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/natures_veil","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/entangle","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.020022222222222223,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/stalactite_golem":{"hrid":"/monsters/stalactite_golem","name":"Stalactite Golem","combatDetails":{"currentHitpoints":1600,"maxHitpoints":1600,"currentManapoints":1600,"maxManapoints":1600,"attackInterval":2702702702,"stabAccuracyRating":230,"slashAccuracyRating":230,"smashAccuracyRating":230,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":160,"slashMaxDamage":160,"smashMaxDamage":160,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":240,"slashEvasionRating":240,"smashEvasionRating":192,"rangedEvasionRating":336,"magicEvasionRating":182.5,"totalArmor":46,"totalWaterResistance":63,"totalNatureResistance":23,"totalFireResistance":63,"totalThreat":100,"combatLevel":180,"staminaLevel":150,"intelligenceLevel":150,"attackLevel":220,"powerLevel":150,"defenseLevel":230,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3000000000,"physicalThorns":0.2,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2760,"maxHitpoints":2760,"currentManapoints":2760,"maxManapoints":2760,"attackInterval":2538071065,"stabAccuracyRating":374,"slashAccuracyRating":374,"smashAccuracyRating":374,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":276,"slashMaxDamage":276,"smashMaxDamage":276,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":388,"slashEvasionRating":388,"smashEvasionRating":310.40000000000003,"rangedEvasionRating":543.1999999999999,"magicEvasionRating":307.5,"totalArmor":75.60000000000001,"totalWaterResistance":83.4,"totalNatureResistance":43.400000000000006,"totalFireResistance":83.4,"totalThreat":100,"combatLevel":308,"staminaLevel":266,"intelligenceLevel":266,"attackLevel":364,"powerLevel":266,"defenseLevel":378,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3000000000,"physicalThorns":0.2,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4240,"maxHitpoints":4240,"currentManapoints":4240,"maxManapoints":4240,"attackInterval":2362204724,"stabAccuracyRating":550,"slashAccuracyRating":550,"smashAccuracyRating":550,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":424,"slashMaxDamage":424,"smashMaxDamage":424,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":568,"slashEvasionRating":568,"smashEvasionRating":454.40000000000003,"rangedEvasionRating":795.1999999999999,"magicEvasionRating":464.5,"totalArmor":111.60000000000001,"totalWaterResistance":110.2,"totalNatureResistance":70.2,"totalFireResistance":110.2,"totalThreat":100,"combatLevel":468,"staminaLevel":414,"intelligenceLevel":414,"attackLevel":540,"powerLevel":414,"defenseLevel":558,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3000000000,"physicalThorns":0.2,"smashEvasion":-0.2,"rangedEvasion":0.4,"waterResistance":40,"fireResistance":40,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/spike_shell","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/toughness","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":600,"maxCount":3000,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/garnet","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jade","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/amethyst","dropRate":0.0003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/stalactite_shard","dropRate":0.0007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/golem_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/spike_shell","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.0025,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/fierce_aura","dropRate":0.00005,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0011333333333333334,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/swampy":{"hrid":"/monsters/swampy","name":"Swampy","combatDetails":{"currentHitpoints":260,"maxHitpoints":260,"currentManapoints":260,"maxManapoints":260,"attackInterval":2973240832,"stabAccuracyRating":28,"slashAccuracyRating":28,"smashAccuracyRating":28,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":26,"slashMaxDamage":26,"smashMaxDamage":26,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":32,"slashEvasionRating":32,"smashEvasionRating":22.4,"rangedEvasionRating":32,"magicEvasionRating":26.5,"totalArmor":4.4,"totalWaterResistance":2.2,"totalNatureResistance":2.2,"totalFireResistance":2.2,"totalThreat":100,"combatLevel":17,"staminaLevel":16,"intelligenceLevel":16,"attackLevel":18,"powerLevel":16,"defenseLevel":22,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"smashEvasion":-0.3,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":883,"maxHitpoints":883,"currentManapoints":883,"maxManapoints":883,"attackInterval":2882952142,"stabAccuracyRating":91.19999999999999,"slashAccuracyRating":91.19999999999999,"smashAccuracyRating":91.19999999999999,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":88.39999999999999,"slashMaxDamage":88.39999999999999,"smashMaxDamage":88.39999999999999,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":96.8,"slashEvasionRating":96.8,"smashEvasionRating":67.75999999999999,"rangedEvasionRating":96.8,"magicEvasionRating":89.1,"totalArmor":17.36,"totalWaterResistance":14.280000000000001,"totalNatureResistance":14.280000000000001,"totalFireResistance":14.280000000000001,"totalThreat":100,"combatLevel":80,"staminaLevel":78.39999999999999,"intelligenceLevel":78.39999999999999,"attackLevel":81.19999999999999,"powerLevel":78.39999999999999,"defenseLevel":86.8,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"smashEvasion":-0.3,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":1828,"maxHitpoints":1828,"currentManapoints":1828,"maxManapoints":1828,"attackInterval":2756846167,"stabAccuracyRating":186.4,"slashAccuracyRating":186.4,"smashAccuracyRating":186.4,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":182.8,"slashMaxDamage":182.8,"smashMaxDamage":182.8,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":193.6,"slashEvasionRating":193.6,"smashEvasionRating":135.51999999999998,"rangedEvasionRating":193.6,"magicEvasionRating":183.7,"totalArmor":36.72,"totalWaterResistance":32.76,"totalNatureResistance":32.76,"totalFireResistance":32.76,"totalThreat":100,"combatLevel":175,"staminaLevel":172.8,"intelligenceLevel":172.8,"attackLevel":176.4,"powerLevel":172.8,"defenseLevel":183.6,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"smashEvasion":-0.3,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/sweep","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":44,"maxCount":220,"minEliteTier":0},{"itemHrid":"/items/cocoon","dropRate":0.3,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/blueberry","dropRate":0.3,"minCount":1,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/blackberry","dropRate":0.15,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/apple","dropRate":0.1,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.05,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.4,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/swamp_essence","dropRate":0.4,"minCount":3,"maxCount":9,"minEliteTier":0},{"itemHrid":"/items/sweep","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.00043400000000000003,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/the_kraken":{"hrid":"/monsters/the_kraken","name":"The Kraken","combatDetails":{"currentHitpoints":83000,"maxHitpoints":83000,"currentManapoints":83000,"maxManapoints":83000,"attackInterval":2713178294,"stabAccuracyRating":590,"slashAccuracyRating":590,"smashAccuracyRating":590,"rangedAccuracyRating":720,"magicAccuracyRating":10,"stabMaxDamage":650,"slashMaxDamage":650,"smashMaxDamage":650,"rangedMaxDamage":720,"magicMaxDamage":10,"stabEvasionRating":380,"slashEvasionRating":380,"smashEvasionRating":380,"rangedEvasionRating":380,"magicEvasionRating":697.5,"totalArmor":124,"totalWaterResistance":137,"totalNatureResistance":87,"totalFireResistance":137,"totalThreat":100,"combatLevel":3674,"staminaLevel":8290,"intelligenceLevel":8290,"attackLevel":580,"powerLevel":640,"defenseLevel":370,"rangedLevel":710,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"magicEvasion":0.5,"armor":50,"waterResistance":100,"natureResistance":50,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"ripple":0.18}},"elite1CombatDetails":{"currentHitpoints":116720,"maxHitpoints":116720,"currentManapoints":116720,"maxManapoints":116720,"attackInterval":2440725244,"stabAccuracyRating":878,"slashAccuracyRating":878,"smashAccuracyRating":878,"rangedAccuracyRating":1060,"magicAccuracyRating":66,"stabMaxDamage":961.9999999999999,"slashMaxDamage":961.9999999999999,"smashMaxDamage":961.9999999999999,"rangedMaxDamage":1060,"magicMaxDamage":66,"stabEvasionRating":584,"slashEvasionRating":584,"smashEvasionRating":584,"rangedEvasionRating":584,"magicEvasionRating":1054.5,"totalArmor":164.8,"totalWaterResistance":163,"totalNatureResistance":113,"totalFireResistance":163,"totalThreat":100,"combatLevel":5199,"staminaLevel":11662,"intelligenceLevel":11662,"attackLevel":868,"powerLevel":951.9999999999999,"defenseLevel":574,"rangedLevel":1050,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"magicEvasion":0.5,"armor":50,"waterResistance":100,"natureResistance":50,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"ripple":0.18}},"elite2CombatDetails":{"currentHitpoints":150760,"maxHitpoints":150760,"currentManapoints":150760,"maxManapoints":150760,"attackInterval":2195734002,"stabAccuracyRating":1198,"slashAccuracyRating":1198,"smashAccuracyRating":1198,"rangedAccuracyRating":1432,"magicAccuracyRating":154,"stabMaxDamage":1306,"slashMaxDamage":1306,"smashMaxDamage":1306,"rangedMaxDamage":1432,"magicMaxDamage":154,"stabEvasionRating":820,"slashEvasionRating":820,"smashEvasionRating":820,"rangedEvasionRating":820,"magicEvasionRating":1459.5,"totalArmor":212,"totalWaterResistance":195.4,"totalNatureResistance":145.4,"totalFireResistance":195.4,"totalThreat":100,"combatLevel":6757,"staminaLevel":15066,"intelligenceLevel":15066,"attackLevel":1188,"powerLevel":1296,"defenseLevel":810,"rangedLevel":1422,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"magicEvasion":0.5,"armor":50,"waterResistance":100,"natureResistance":50,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"ripple":0.18}},"abilities":[{"abilityHrid":"/abilities/critical_aura","level":40,"minEliteTier":0},{"abilityHrid":"/abilities/frenzy","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/aqua_arrow","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/penetrating_shot","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/fracturing_impact","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.8619316666666668,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/the_watcher":{"hrid":"/monsters/the_watcher","name":"The Watcher","combatDetails":{"currentHitpoints":5550,"maxHitpoints":5550,"currentManapoints":5550,"maxManapoints":5550,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":190,"magicAccuracyRating":10,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":190,"magicMaxDamage":10,"stabEvasionRating":116.25,"slashEvasionRating":155,"smashEvasionRating":155,"rangedEvasionRating":116.25,"magicEvasionRating":163.75,"totalArmor":29,"totalWaterResistance":14.5,"totalNatureResistance":14.5,"totalFireResistance":14.5,"totalThreat":100,"combatLevel":319,"staminaLevel":545,"intelligenceLevel":545,"attackLevel":0,"powerLevel":0,"defenseLevel":145,"rangedLevel":180,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":8290,"maxHitpoints":8290,"currentManapoints":8290,"maxManapoints":8290,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":318,"magicAccuracyRating":66,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":318,"magicMaxDamage":66,"stabEvasionRating":201.75,"slashEvasionRating":269,"smashEvasionRating":269,"rangedEvasionRating":201.75,"magicEvasionRating":281.25,"totalArmor":51.800000000000004,"totalWaterResistance":31.500000000000004,"totalNatureResistance":31.500000000000004,"totalFireResistance":31.500000000000004,"totalThreat":100,"combatLevel":502,"staminaLevel":819,"intelligenceLevel":819,"attackLevel":56,"powerLevel":56,"defenseLevel":259,"rangedLevel":308,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":11350,"maxHitpoints":11350,"currentManapoints":11350,"maxManapoints":11350,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":478,"magicAccuracyRating":154,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":478,"magicMaxDamage":154,"stabEvasionRating":311.25,"slashEvasionRating":415,"smashEvasionRating":415,"rangedEvasionRating":311.25,"magicEvasionRating":430.75,"totalArmor":81,"totalWaterResistance":54.9,"totalNatureResistance":54.9,"totalFireResistance":54.9,"totalThreat":100,"combatLevel":718,"staminaLevel":1125,"intelligenceLevel":1125,"attackLevel":144,"powerLevel":144,"defenseLevel":405,"rangedLevel":468,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/ranged"],"damageType":"/damage_types/physical","attackInterval":3500000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/speed_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/precision","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/steady_shot","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/aqua_arrow","level":20,"minEliteTier":0},{"abilityHrid":"/abilities/flame_arrow","level":20,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":1500,"maxCount":7500,"minEliteTier":0},{"itemHrid":"/items/eye_of_the_watcher","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/eyessence","dropRate":0.5,"minCount":10,"maxCount":30,"minEliteTier":0},{"itemHrid":"/items/precision","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/steady_shot","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_arrow","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/flame_arrow","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/speed_aura","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":1},{"itemHrid":"/items/white_key_fragment","dropRate":0.005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/white_key_fragment","dropRate":0.05,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.005948194444444444,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/tidal_conjuror":{"hrid":"/monsters/tidal_conjuror","name":"Tidal Conjuror","combatDetails":{"currentHitpoints":27500,"maxHitpoints":27500,"currentManapoints":27500,"maxManapoints":27500,"attackInterval":3500000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":410,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":410,"stabEvasionRating":270,"slashEvasionRating":270,"smashEvasionRating":270,"rangedEvasionRating":270,"magicEvasionRating":266.5,"totalArmor":52,"totalWaterResistance":166,"totalNatureResistance":116,"totalFireResistance":166,"totalThreat":100,"combatLevel":1308,"staminaLevel":2740,"intelligenceLevel":2740,"attackLevel":0,"powerLevel":0,"defenseLevel":260,"rangedLevel":0,"magicLevel":400,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"waterAmplify":0.4,"magicEvasion":0.3,"waterResistance":100,"natureResistance":50,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"ripple":0.18}},"elite1CombatDetails":{"currentHitpoints":39019,"maxHitpoints":39019,"currentManapoints":39019,"maxManapoints":39019,"attackInterval":3404669260,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":626,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":626,"stabEvasionRating":430,"slashEvasionRating":430,"smashEvasionRating":430,"rangedEvasionRating":430,"magicEvasionRating":440.7,"totalArmor":84,"totalWaterResistance":203.6,"totalNatureResistance":153.6,"totalFireResistance":203.6,"totalThreat":100,"combatLevel":1887,"staminaLevel":3891.9999999999995,"intelligenceLevel":3891.9999999999995,"attackLevel":56,"powerLevel":56,"defenseLevel":420,"rangedLevel":56,"magicLevel":616,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"waterAmplify":0.4,"magicEvasion":0.3,"waterResistance":100,"natureResistance":50,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"ripple":0.18}},"elite2CombatDetails":{"currentHitpoints":50860,"maxHitpoints":50860,"currentManapoints":50860,"maxManapoints":50860,"attackInterval":3264925373,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":874,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":874,"stabEvasionRating":622,"slashEvasionRating":622,"smashEvasionRating":622,"rangedEvasionRating":622,"magicEvasionRating":656.5,"totalArmor":122.4,"totalWaterResistance":247.60000000000002,"totalNatureResistance":197.60000000000002,"totalFireResistance":247.60000000000002,"totalThreat":100,"combatLevel":2498,"staminaLevel":5076,"intelligenceLevel":5076,"attackLevel":144,"powerLevel":144,"defenseLevel":612,"rangedLevel":144,"magicLevel":864,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/water","attackInterval":3500000000,"autoAttackDamage":-0.5,"waterAmplify":0.4,"magicEvasion":0.3,"waterResistance":100,"natureResistance":50,"fireResistance":100,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01,"ripple":0.18}},"abilities":[{"abilityHrid":"/abilities/aqua_aura","level":30,"minEliteTier":0},{"abilityHrid":"/abilities/elemental_affinity","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/frost_surge","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/ice_spear","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/water_strike","level":50,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.10487999999999999,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/treant":{"hrid":"/monsters/treant","name":"Treant","combatDetails":{"currentHitpoints":900,"maxHitpoints":900,"currentManapoints":900,"maxManapoints":900,"attackInterval":3000000000,"stabAccuracyRating":10,"slashAccuracyRating":10,"smashAccuracyRating":10,"rangedAccuracyRating":10,"magicAccuracyRating":70,"stabMaxDamage":10,"slashMaxDamage":10,"smashMaxDamage":10,"rangedMaxDamage":10,"magicMaxDamage":70,"stabEvasionRating":70,"slashEvasionRating":70,"smashEvasionRating":70,"rangedEvasionRating":70,"magicEvasionRating":55,"totalArmor":22,"totalWaterResistance":32,"totalNatureResistance":32,"totalFireResistance":12,"totalThreat":100,"combatLevel":68,"staminaLevel":80,"intelligenceLevel":80,"attackLevel":0,"powerLevel":0,"defenseLevel":60,"rangedLevel":0,"magicLevel":60,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"armor":10,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1780,"maxHitpoints":1780,"currentManapoints":1780,"maxManapoints":1780,"attackInterval":2918287937,"stabAccuracyRating":66,"slashAccuracyRating":66,"smashAccuracyRating":66,"rangedAccuracyRating":66,"magicAccuracyRating":150,"stabMaxDamage":66,"slashMaxDamage":66,"smashMaxDamage":66,"rangedMaxDamage":66,"magicMaxDamage":150,"stabEvasionRating":150,"slashEvasionRating":150,"smashEvasionRating":150,"rangedEvasionRating":150,"magicEvasionRating":129,"totalArmor":38,"totalWaterResistance":48,"totalNatureResistance":48,"totalFireResistance":28,"totalThreat":100,"combatLevel":151,"staminaLevel":168,"intelligenceLevel":168,"attackLevel":56,"powerLevel":56,"defenseLevel":140,"rangedLevel":56,"magicLevel":140,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"armor":10,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2980,"maxHitpoints":2980,"currentManapoints":2980,"maxManapoints":2980,"attackInterval":2798507462,"stabAccuracyRating":154,"slashAccuracyRating":154,"smashAccuracyRating":154,"rangedAccuracyRating":154,"magicAccuracyRating":262,"stabMaxDamage":154,"slashMaxDamage":154,"smashMaxDamage":154,"rangedMaxDamage":154,"magicMaxDamage":262,"stabEvasionRating":262,"slashEvasionRating":262,"smashEvasionRating":262,"rangedEvasionRating":262,"magicEvasionRating":235,"totalArmor":60.400000000000006,"totalWaterResistance":70.4,"totalNatureResistance":70.4,"totalFireResistance":50.400000000000006,"totalThreat":100,"combatLevel":266,"staminaLevel":288,"intelligenceLevel":288,"attackLevel":144,"powerLevel":144,"defenseLevel":252,"rangedLevel":144,"magicLevel":252,"combatStats":{"combatStyleHrids":["/combat_styles/magic"],"damageType":"/damage_types/nature","attackInterval":3000000000,"autoAttackDamage":-0.5,"natureAmplify":0.3,"armor":10,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/sylvan_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/toxic_pollen","level":5,"minEliteTier":0},{"abilityHrid":"/abilities/entangle","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":160,"maxCount":800,"minEliteTier":0},{"itemHrid":"/items/log","dropRate":0.25,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/birch_log","dropRate":0.25,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/cedar_log","dropRate":0.125,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/purpleheart_log","dropRate":0.06,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/ginkgo_log","dropRate":0.03,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/redwood_log","dropRate":0.015,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/arcane_log","dropRate":0.01,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/bamboo_branch","dropRate":0.1,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/amber","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/treant_bark","dropRate":0.003,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/jungle_essence","dropRate":0.4,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/toxic_pollen","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/entangle","dropRate":0.01,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/sylvan_aura","dropRate":0.00002,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.001488888888888889,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/turtle":{"hrid":"/monsters/turtle","name":"Turuto","combatDetails":{"currentHitpoints":700,"maxHitpoints":700,"currentManapoints":600,"maxManapoints":600,"attackInterval":3431372549,"stabAccuracyRating":50,"slashAccuracyRating":50,"smashAccuracyRating":50,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":65,"slashMaxDamage":65,"smashMaxDamage":65,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":65,"slashEvasionRating":91,"smashEvasionRating":52,"rangedEvasionRating":65,"magicEvasionRating":51.25,"totalArmor":11,"totalWaterResistance":25.5,"totalNatureResistance":5.5,"totalFireResistance":25.5,"totalThreat":100,"combatLevel":52,"staminaLevel":60,"intelligenceLevel":50,"attackLevel":40,"powerLevel":55,"defenseLevel":55,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":1500,"maxHitpoints":1500,"currentManapoints":1360,"maxManapoints":1360,"attackInterval":3314393939,"stabAccuracyRating":122,"slashAccuracyRating":122,"smashAccuracyRating":122,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":143,"slashMaxDamage":143,"smashMaxDamage":143,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":143,"slashEvasionRating":200.2,"smashEvasionRating":114.4,"rangedEvasionRating":143,"magicEvasionRating":123.75,"totalArmor":26.6,"totalWaterResistance":38.900000000000006,"totalNatureResistance":18.900000000000002,"totalFireResistance":38.900000000000006,"totalThreat":100,"combatLevel":128,"staminaLevel":140,"intelligenceLevel":125.99999999999999,"attackLevel":112,"powerLevel":133,"defenseLevel":133,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":2620,"maxHitpoints":2620,"currentManapoints":2440,"maxManapoints":2440,"attackInterval":3158844765,"stabAccuracyRating":226,"slashAccuracyRating":226,"smashAccuracyRating":226,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":253,"slashMaxDamage":253,"smashMaxDamage":253,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":253,"slashEvasionRating":354.2,"smashEvasionRating":202.4,"rangedEvasionRating":253,"magicEvasionRating":228.25,"totalArmor":48.6,"totalWaterResistance":58.7,"totalNatureResistance":38.7,"totalFireResistance":58.7,"totalThreat":100,"combatLevel":237,"staminaLevel":252,"intelligenceLevel":234,"attackLevel":216,"powerLevel":243,"defenseLevel":243,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/smash"],"damageType":"/damage_types/physical","attackInterval":3500000000,"slashEvasion":0.4,"smashEvasion":-0.2,"waterResistance":20,"fireResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/taunt","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/toughness","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":120,"maxCount":600,"minEliteTier":0},{"itemHrid":"/items/reptile_hide","dropRate":1,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/egg","dropRate":0.2,"minCount":1,"maxCount":10,"minEliteTier":0},{"itemHrid":"/items/orange","dropRate":0.1,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/plum","dropRate":0.15,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/peach","dropRate":0.05,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/pearl","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/turtle_shell","dropRate":0.004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/aqua_essence","dropRate":0.4,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.0015,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/taunt","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/small_treasure_chest","dropRate":0.0011200000000000001,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/vampire":{"hrid":"/monsters/vampire","name":"Vampire","combatDetails":{"currentHitpoints":2200,"maxHitpoints":2200,"currentManapoints":2200,"maxManapoints":2200,"attackInterval":2933333333,"stabAccuracyRating":260,"slashAccuracyRating":260,"smashAccuracyRating":260,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":210,"slashMaxDamage":210,"smashMaxDamage":210,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":180,"slashEvasionRating":180,"smashEvasionRating":180,"rangedEvasionRating":180,"magicEvasionRating":137.5,"totalArmor":34,"totalWaterResistance":67,"totalNatureResistance":67,"totalFireResistance":47,"totalThreat":100,"combatLevel":208,"staminaLevel":210,"intelligenceLevel":210,"attackLevel":250,"powerLevel":200,"defenseLevel":170,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3300000000,"waterResistance":50,"natureResistance":50,"fireResistance":30,"lifeSteal":0.02,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":3600,"maxHitpoints":3600,"currentManapoints":3600,"maxManapoints":3600,"attackInterval":2743142144,"stabAccuracyRating":416,"slashAccuracyRating":416,"smashAccuracyRating":416,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":346,"slashMaxDamage":346,"smashMaxDamage":346,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":304,"slashEvasionRating":304,"smashEvasionRating":304,"rangedEvasionRating":304,"magicEvasionRating":244.5,"totalArmor":58.800000000000004,"totalWaterResistance":85,"totalNatureResistance":85,"totalFireResistance":65,"totalThreat":100,"combatLevel":347,"staminaLevel":350,"intelligenceLevel":350,"attackLevel":406,"powerLevel":336,"defenseLevel":294,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3300000000,"waterResistance":50,"natureResistance":50,"fireResistance":30,"lifeSteal":0.02,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":5320,"maxHitpoints":5320,"currentManapoints":5320,"maxManapoints":5320,"attackInterval":2544333076,"stabAccuracyRating":604,"slashAccuracyRating":604,"smashAccuracyRating":604,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":514,"slashMaxDamage":514,"smashMaxDamage":514,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":460,"slashEvasionRating":460,"smashEvasionRating":460,"rangedEvasionRating":460,"magicEvasionRating":383.5,"totalArmor":90,"totalWaterResistance":109.4,"totalNatureResistance":109.4,"totalFireResistance":89.4,"totalThreat":100,"combatLevel":518,"staminaLevel":522,"intelligenceLevel":522,"attackLevel":594,"powerLevel":504,"defenseLevel":450,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":3300000000,"waterResistance":50,"natureResistance":50,"fireResistance":30,"lifeSteal":0.02,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/vampirism","level":1,"minEliteTier":0},{"abilityHrid":"/abilities/puncture","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":600,"maxCount":3000,"minEliteTier":0},{"itemHrid":"/items/umbral_hide","dropRate":1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moonstone","dropRate":0.0004,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/vampire_fang","dropRate":0.0007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/twilight_essence","dropRate":0.3,"minCount":2,"maxCount":6,"minEliteTier":0},{"itemHrid":"/items/vampirism","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/puncture","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/fierce_aura","dropRate":0.00005,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0017122222222222224,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/veyes":{"hrid":"/monsters/veyes","name":"Veyes","combatDetails":{"currentHitpoints":1230,"maxHitpoints":1230,"currentManapoints":1230,"maxManapoints":1230,"attackInterval":2839564600,"stabAccuracyRating":123,"slashAccuracyRating":123,"smashAccuracyRating":123,"rangedAccuracyRating":10,"magicAccuracyRating":123,"stabMaxDamage":123,"slashMaxDamage":123,"smashMaxDamage":123,"rangedMaxDamage":10,"magicMaxDamage":123,"stabEvasionRating":92.25,"slashEvasionRating":123,"smashEvasionRating":123,"rangedEvasionRating":92.25,"magicEvasionRating":94.75,"totalArmor":22.6,"totalWaterResistance":22.6,"totalNatureResistance":22.6,"totalFireResistance":22.6,"totalThreat":100,"combatLevel":113,"staminaLevel":113,"intelligenceLevel":113,"attackLevel":113,"powerLevel":113,"defenseLevel":113,"rangedLevel":0,"magicLevel":113,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":2242,"maxHitpoints":2242,"currentManapoints":2242,"maxManapoints":2242,"attackInterval":2709782314,"stabAccuracyRating":224.2,"slashAccuracyRating":224.2,"smashAccuracyRating":224.2,"rangedAccuracyRating":66,"magicAccuracyRating":224.2,"stabMaxDamage":224.2,"slashMaxDamage":224.2,"smashMaxDamage":224.2,"rangedMaxDamage":66,"magicMaxDamage":224.2,"stabEvasionRating":168.14999999999998,"slashEvasionRating":224.2,"smashEvasionRating":224.2,"rangedEvasionRating":168.14999999999998,"magicEvasionRating":184.64999999999998,"totalArmor":42.84,"totalWaterResistance":42.84,"totalNatureResistance":42.84,"totalFireResistance":42.84,"totalThreat":100,"combatLevel":214,"staminaLevel":214.2,"intelligenceLevel":214.2,"attackLevel":214.2,"powerLevel":214.2,"defenseLevel":214.2,"rangedLevel":56,"magicLevel":214.2,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":3574,"maxHitpoints":3574,"currentManapoints":3574,"maxManapoints":3574,"attackInterval":2556019425,"stabAccuracyRating":357.40000000000003,"slashAccuracyRating":357.40000000000003,"smashAccuracyRating":357.40000000000003,"rangedAccuracyRating":154,"magicAccuracyRating":357.40000000000003,"stabMaxDamage":357.40000000000003,"slashMaxDamage":357.40000000000003,"smashMaxDamage":357.40000000000003,"rangedMaxDamage":154,"magicMaxDamage":357.40000000000003,"stabEvasionRating":268.05,"slashEvasionRating":357.40000000000003,"smashEvasionRating":357.40000000000003,"rangedEvasionRating":268.05,"magicEvasionRating":306.55,"totalArmor":69.48,"totalWaterResistance":69.48,"totalNatureResistance":69.48,"totalFireResistance":69.48,"totalThreat":100,"combatLevel":347,"staminaLevel":347.40000000000003,"intelligenceLevel":347.40000000000003,"attackLevel":347.40000000000003,"powerLevel":347.40000000000003,"defenseLevel":347.40000000000003,"rangedLevel":144,"magicLevel":347.40000000000003,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3000000000,"stabEvasion":-0.25,"rangedEvasion":-0.25,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/precision","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":280,"maxCount":1400,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.15,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.1,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/magnifying_glass","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/eyessence","dropRate":0.4,"minCount":5,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/precision","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0}],"rareDropTable":[{"itemHrid":"/items/medium_treasure_chest","dropRate":0.001197,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/werewolf":{"hrid":"/monsters/werewolf","name":"Werewolf","combatDetails":{"currentHitpoints":2500,"maxHitpoints":2500,"currentManapoints":2500,"maxManapoints":2500,"attackInterval":2780269058,"stabAccuracyRating":240,"slashAccuracyRating":240,"smashAccuracyRating":240,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":240,"slashMaxDamage":240,"smashMaxDamage":240,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":170,"slashEvasionRating":170,"smashEvasionRating":170,"rangedEvasionRating":170,"magicEvasionRating":130,"totalArmor":32,"totalWaterResistance":66,"totalNatureResistance":66,"totalFireResistance":46,"totalThreat":100,"combatLevel":220,"staminaLevel":240,"intelligenceLevel":240,"attackLevel":230,"powerLevel":230,"defenseLevel":160,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3100000000,"waterResistance":50,"natureResistance":50,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":4020,"maxHitpoints":4020,"currentManapoints":4020,"maxManapoints":4020,"attackInterval":2607232968,"stabAccuracyRating":388,"slashAccuracyRating":388,"smashAccuracyRating":388,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":388,"slashMaxDamage":388,"smashMaxDamage":388,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":290,"slashEvasionRating":290,"smashEvasionRating":290,"rangedEvasionRating":290,"magicEvasionRating":234,"totalArmor":56,"totalWaterResistance":83.6,"totalNatureResistance":83.6,"totalFireResistance":63.6,"totalThreat":100,"combatLevel":364,"staminaLevel":392,"intelligenceLevel":392,"attackLevel":378,"powerLevel":378,"defenseLevel":280,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3100000000,"waterResistance":50,"natureResistance":50,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":5860,"maxHitpoints":5860,"currentManapoints":5860,"maxManapoints":5860,"attackInterval":2423768569,"stabAccuracyRating":568,"slashAccuracyRating":568,"smashAccuracyRating":568,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":568,"slashMaxDamage":568,"smashMaxDamage":568,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":442,"slashEvasionRating":442,"smashEvasionRating":442,"rangedEvasionRating":442,"magicEvasionRating":370,"totalArmor":86.4,"totalWaterResistance":107.6,"totalNatureResistance":107.6,"totalFireResistance":87.6,"totalThreat":100,"combatLevel":540,"staminaLevel":576,"intelligenceLevel":576,"attackLevel":558,"powerLevel":558,"defenseLevel":432,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3100000000,"waterResistance":50,"natureResistance":50,"fireResistance":30,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/insanity","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/berserk","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/maim","level":10,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":750,"maxCount":3750,"minEliteTier":0},{"itemHrid":"/items/umbral_hide","dropRate":1,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.2,"minCount":1,"maxCount":2,"minEliteTier":0},{"itemHrid":"/items/moonstone","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/werewolf_claw","dropRate":0.0007,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/twilight_essence","dropRate":0.3,"minCount":3,"maxCount":9,"minEliteTier":0},{"itemHrid":"/items/berserk","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/maim","dropRate":0.0008,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/insanity","dropRate":0.00005,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.002022222222222222,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/zombie":{"hrid":"/monsters/zombie","name":"Zombie","combatDetails":{"currentHitpoints":1800,"maxHitpoints":1800,"currentManapoints":1800,"maxManapoints":1800,"attackInterval":3119266055,"stabAccuracyRating":190,"slashAccuracyRating":190,"smashAccuracyRating":190,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":200,"slashMaxDamage":200,"smashMaxDamage":200,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":160,"slashEvasionRating":160,"smashEvasionRating":160,"rangedEvasionRating":160,"magicEvasionRating":122.5,"totalArmor":30,"totalWaterResistance":35,"totalNatureResistance":35,"totalFireResistance":15,"totalThreat":100,"combatLevel":172,"staminaLevel":170,"intelligenceLevel":170,"attackLevel":180,"powerLevel":190,"defenseLevel":150,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":3040,"maxHitpoints":3040,"currentManapoints":3040,"maxManapoints":3040,"attackInterval":2946273830,"stabAccuracyRating":318,"slashAccuracyRating":318,"smashAccuracyRating":318,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":332,"slashMaxDamage":332,"smashMaxDamage":332,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":276,"slashEvasionRating":276,"smashEvasionRating":276,"rangedEvasionRating":276,"magicEvasionRating":223.5,"totalArmor":53.2,"totalWaterResistance":52.2,"totalNatureResistance":52.2,"totalFireResistance":32.2,"totalThreat":100,"combatLevel":296,"staminaLevel":294,"intelligenceLevel":294,"attackLevel":308,"powerLevel":322,"defenseLevel":266,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":4600,"maxHitpoints":4600,"currentManapoints":4600,"maxManapoints":4600,"attackInterval":2755267423,"stabAccuracyRating":478,"slashAccuracyRating":478,"smashAccuracyRating":478,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":496,"slashMaxDamage":496,"smashMaxDamage":496,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":424,"slashEvasionRating":424,"smashEvasionRating":424,"rangedEvasionRating":424,"magicEvasionRating":356.5,"totalArmor":82.80000000000001,"totalWaterResistance":75.80000000000001,"totalNatureResistance":75.80000000000001,"totalFireResistance":55.800000000000004,"totalThreat":100,"combatLevel":453,"staminaLevel":450,"intelligenceLevel":450,"attackLevel":468,"powerLevel":486,"defenseLevel":414,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/slash"],"damageType":"/damage_types/physical","attackInterval":3400000000,"waterResistance":20,"natureResistance":20,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/provoke","level":1,"minEliteTier":1},{"abilityHrid":"/abilities/toughness","level":10,"minEliteTier":0},{"abilityHrid":"/abilities/maim","level":1,"minEliteTier":0}],"dropTable":[{"itemHrid":"/items/coin","dropRate":0.8,"minCount":500,"maxCount":2500,"minEliteTier":0},{"itemHrid":"/items/umbral_hide","dropRate":1,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/green_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/black_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":5,"minEliteTier":0},{"itemHrid":"/items/burble_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/moolong_tea_leaf","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/red_tea_leaf","dropRate":0.4,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/emp_tea_leaf","dropRate":0.4,"minCount":1,"maxCount":3,"minEliteTier":0},{"itemHrid":"/items/twilight_essence","dropRate":0.3,"minCount":1,"maxCount":4,"minEliteTier":0},{"itemHrid":"/items/toughness","dropRate":0.002,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/maim","dropRate":0.0005,"minCount":1,"maxCount":1,"minEliteTier":0},{"itemHrid":"/items/provoke","dropRate":0.001,"minCount":1,"maxCount":1,"minEliteTier":1}],"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.0012244444444444442,"minCount":1,"maxCount":1,"minEliteTier":0}]},"/monsters/zombie_bear":{"hrid":"/monsters/zombie_bear","name":"Zombie Bear","combatDetails":{"currentHitpoints":18000,"maxHitpoints":18000,"currentManapoints":18000,"maxManapoints":18000,"attackInterval":3347280334,"stabAccuracyRating":400,"slashAccuracyRating":400,"smashAccuracyRating":400,"rangedAccuracyRating":10,"magicAccuracyRating":10,"stabMaxDamage":320,"slashMaxDamage":320,"smashMaxDamage":320,"rangedMaxDamage":10,"magicMaxDamage":10,"stabEvasionRating":320,"slashEvasionRating":320,"smashEvasionRating":320,"rangedEvasionRating":480,"magicEvasionRating":242.5,"totalArmor":112,"totalWaterResistance":31,"totalNatureResistance":31,"totalFireResistance":31,"totalThreat":100,"combatLevel":918,"staminaLevel":1790,"intelligenceLevel":1790,"attackLevel":390,"powerLevel":310,"defenseLevel":310,"rangedLevel":0,"magicLevel":0,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":4000000000,"rangedEvasion":0.5,"armor":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite1CombatDetails":{"currentHitpoints":25720,"maxHitpoints":25720,"currentManapoints":25720,"maxManapoints":25720,"attackInterval":3074558032,"stabAccuracyRating":612,"slashAccuracyRating":612,"smashAccuracyRating":612,"rangedAccuracyRating":66,"magicAccuracyRating":66,"stabMaxDamage":499.99999999999994,"slashMaxDamage":499.99999999999994,"smashMaxDamage":499.99999999999994,"rangedMaxDamage":66,"magicMaxDamage":66,"stabEvasionRating":499.99999999999994,"slashEvasionRating":499.99999999999994,"smashEvasionRating":499.99999999999994,"rangedEvasionRating":749.9999999999999,"magicEvasionRating":391.49999999999994,"totalArmor":148,"totalWaterResistance":54.6,"totalNatureResistance":54.6,"totalFireResistance":54.6,"totalThreat":100,"combatLevel":1341,"staminaLevel":2562,"intelligenceLevel":2562,"attackLevel":602,"powerLevel":489.99999999999994,"defenseLevel":489.99999999999994,"rangedLevel":56,"magicLevel":56,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":4000000000,"rangedEvasion":0.5,"armor":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"elite2CombatDetails":{"currentHitpoints":33760,"maxHitpoints":33760,"currentManapoints":33760,"maxManapoints":33760,"attackInterval":2810962754,"stabAccuracyRating":856,"slashAccuracyRating":856,"smashAccuracyRating":856,"rangedAccuracyRating":154,"magicAccuracyRating":154,"stabMaxDamage":712,"slashMaxDamage":712,"smashMaxDamage":712,"rangedMaxDamage":154,"magicMaxDamage":154,"stabEvasionRating":712,"slashEvasionRating":712,"smashEvasionRating":712,"rangedEvasionRating":1068,"magicEvasionRating":572.5,"totalArmor":190.4,"totalWaterResistance":84.60000000000001,"totalNatureResistance":84.60000000000001,"totalFireResistance":84.60000000000001,"totalThreat":100,"combatLevel":1796,"staminaLevel":3366,"intelligenceLevel":3366,"attackLevel":846,"powerLevel":702,"defenseLevel":702,"rangedLevel":144,"magicLevel":144,"combatStats":{"combatStyleHrids":["/combat_styles/stab"],"damageType":"/damage_types/physical","attackInterval":4000000000,"rangedEvasion":0.5,"armor":50,"tenacity":50,"hpRegenPer10":0.01,"mpRegenPer10":0.01}},"abilities":[{"abilityHrid":"/abilities/fierce_aura","level":25,"minEliteTier":0},{"abilityHrid":"/abilities/berserk","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/puncture","level":50,"minEliteTier":0},{"abilityHrid":"/abilities/penetrating_strike","level":40,"minEliteTier":0}],"dropTable":null,"rareDropTable":[{"itemHrid":"/items/large_treasure_chest","dropRate":0.04917166666666666,"minCount":1,"maxCount":1,"minEliteTier":0}]}}');

/***/ }),

/***/ "./src/combatsimulator/data/combatTriggerDependencyDetailMap.json":
/*!************************************************************************!*\
  !*** ./src/combatsimulator/data/combatTriggerDependencyDetailMap.json ***!
  \************************************************************************/
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"/combat_trigger_dependencies/all_allies":{"hrid":"/combat_trigger_dependencies/all_allies","name":"Allies\' Total","isSingleTarget":false,"isMultiTarget":true,"sortIndex":4},"/combat_trigger_dependencies/all_enemies":{"hrid":"/combat_trigger_dependencies/all_enemies","name":"Enemies\' Total","isSingleTarget":false,"isMultiTarget":true,"sortIndex":3},"/combat_trigger_dependencies/self":{"hrid":"/combat_trigger_dependencies/self","name":"My","isSingleTarget":true,"isMultiTarget":false,"sortIndex":1},"/combat_trigger_dependencies/targeted_enemy":{"hrid":"/combat_trigger_dependencies/targeted_enemy","name":"Target Enemy\'s","isSingleTarget":true,"isMultiTarget":false,"sortIndex":2}}');

/***/ }),

/***/ "./src/combatsimulator/drops.js":
/*!**************************************!*\
  !*** ./src/combatsimulator/drops.js ***!
  \**************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class Drops {

    constructor(itemHrid, dropRate, minCount, maxCount, eliteTier) {
        this.itemHrid = itemHrid;
        this.dropRate = dropRate;
        this.minCount = minCount;
        this.maxCount = maxCount;
        this.eliteTier = eliteTier;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Drops);


/***/ }),

/***/ "./src/combatsimulator/events/abilityCastEndEvent.js":
/*!***********************************************************!*\
  !*** ./src/combatsimulator/events/abilityCastEndEvent.js ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class AbilityCastEndEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "abilityCastEndEvent";

    constructor(time, source, ability) {
        super(AbilityCastEndEvent.type, time);

        this.source = source;
        this.ability = ability;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (AbilityCastEndEvent);

/***/ }),

/***/ "./src/combatsimulator/events/autoAttackEvent.js":
/*!*******************************************************!*\
  !*** ./src/combatsimulator/events/autoAttackEvent.js ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class AutoAttackEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "autoAttack";

    constructor(time, source) {
        super(AutoAttackEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (AutoAttackEvent);


/***/ }),

/***/ "./src/combatsimulator/events/awaitCooldownEvent.js":
/*!**********************************************************!*\
  !*** ./src/combatsimulator/events/awaitCooldownEvent.js ***!
  \**********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class AwaitCooldownEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "awaitCooldownEvent";

    constructor(time, source) {
        super(AwaitCooldownEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (AwaitCooldownEvent);

/***/ }),

/***/ "./src/combatsimulator/events/blindExpirationEvent.js":
/*!************************************************************!*\
  !*** ./src/combatsimulator/events/blindExpirationEvent.js ***!
  \************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class BlindExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "blindExpiration";

    constructor(time, source) {
        super(BlindExpirationEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (BlindExpirationEvent);

/***/ }),

/***/ "./src/combatsimulator/events/checkBuffExpirationEvent.js":
/*!****************************************************************!*\
  !*** ./src/combatsimulator/events/checkBuffExpirationEvent.js ***!
  \****************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class CheckBuffExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "checkBuffExpiration";

    constructor(time, source) {
        super(CheckBuffExpirationEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CheckBuffExpirationEvent);


/***/ }),

/***/ "./src/combatsimulator/events/combatEvent.js":
/*!***************************************************!*\
  !*** ./src/combatsimulator/events/combatEvent.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class CombatEvent {
    constructor(type, time) {
        this.type = type;
        this.time = time;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CombatEvent);


/***/ }),

/***/ "./src/combatsimulator/events/combatStartEvent.js":
/*!********************************************************!*\
  !*** ./src/combatsimulator/events/combatStartEvent.js ***!
  \********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class CombatStartEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "combatStart";

    constructor(time) {
        super(CombatStartEvent.type, time);
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CombatStartEvent);


/***/ }),

/***/ "./src/combatsimulator/events/consumableTickEvent.js":
/*!***********************************************************!*\
  !*** ./src/combatsimulator/events/consumableTickEvent.js ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class ConsumableTickEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "consumableTick";

    constructor(time, source, consumable, totalTicks, currentTick) {
        super(ConsumableTickEvent.type, time);

        this.source = source;
        this.consumable = consumable;
        this.totalTicks = totalTicks;
        this.currentTick = currentTick;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ConsumableTickEvent);


/***/ }),

/***/ "./src/combatsimulator/events/cooldownReadyEvent.js":
/*!**********************************************************!*\
  !*** ./src/combatsimulator/events/cooldownReadyEvent.js ***!
  \**********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class CooldownReadyEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "cooldownReady";

    constructor(time) {
        super(CooldownReadyEvent.type, time);
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CooldownReadyEvent);


/***/ }),

/***/ "./src/combatsimulator/events/curseExpirationEvent.js":
/*!************************************************************!*\
  !*** ./src/combatsimulator/events/curseExpirationEvent.js ***!
  \************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class CurseExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "curseExpiration";

    constructor(time, source) {
        super(CurseExpirationEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CurseExpirationEvent);

/***/ }),

/***/ "./src/combatsimulator/events/damageOverTimeEvent.js":
/*!***********************************************************!*\
  !*** ./src/combatsimulator/events/damageOverTimeEvent.js ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class DamageOverTimeEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "damageOverTime";

    constructor(time, sourceRef, target, damage, totalTicks, currentTick, combatStyleHrid) {
        super(DamageOverTimeEvent.type, time);

        // Calling it 'source' would wrongly clear Damage Over Time when the source dies
        this.sourceRef = sourceRef;
        this.target = target;
        this.damage = damage;
        this.totalTicks = totalTicks;
        this.currentTick = currentTick;
        this.combatStyleHrid = combatStyleHrid;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (DamageOverTimeEvent);


/***/ }),

/***/ "./src/combatsimulator/events/enemyRespawnEvent.js":
/*!*********************************************************!*\
  !*** ./src/combatsimulator/events/enemyRespawnEvent.js ***!
  \*********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class EnemyRespawnEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "enemyRespawn";

    constructor(time) {
        super(EnemyRespawnEvent.type, time);
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (EnemyRespawnEvent);


/***/ }),

/***/ "./src/combatsimulator/events/eventQueue.js":
/*!**************************************************!*\
  !*** ./src/combatsimulator/events/eventQueue.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var heap_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! heap-js */ "./node_modules/heap-js/dist/heap-js.es5.js");


class EventQueue {
    constructor() {
        this.minHeap = new heap_js__WEBPACK_IMPORTED_MODULE_0__["default"]((a, b) => a.time - b.time);
    }

    addEvent(event) {
        this.minHeap.push(event);
    }

    getNextEvent() {
        return this.minHeap.pop();
    }

    containsEventOfType(type) {
        let heapEvents = this.minHeap.toArray();

        return heapEvents.some((event) => event.type == type);
    }

    containsEventOfTypeAndHrid(type, hrid) {
        let heapEvents = this.minHeap.toArray();
        return heapEvents.some((event) => event.type == type && event.hrid == hrid);
    }

    clear() {
        this.minHeap = new heap_js__WEBPACK_IMPORTED_MODULE_0__["default"]((a, b) => a.time - b.time);
    }

    clearEventsForUnit(unit) {
        this.clearMatching((event) => event.source == unit || event.target == unit);
    }

    clearEventsOfType(type) {
        this.clearMatching((event) => event.type == type);
    }

    clearMatching(fn) {
        let cleared = false;
        let heapEvents = this.minHeap.toArray();

        for (const event of heapEvents) {
            if (fn(event)) {
                this.minHeap.remove(event);
                cleared = true;
            }
        }
        return cleared;
    }

    getMatching(fn) {
        let heapEvents = this.minHeap.toArray(); 
    
        for (const event of heapEvents) {
            if (fn(event)) {
                return event; 
            }
        }
    
        return null; 
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (EventQueue);


/***/ }),

/***/ "./src/combatsimulator/events/furyExpirationEvent.js":
/*!***********************************************************!*\
  !*** ./src/combatsimulator/events/furyExpirationEvent.js ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class FuryExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "furyExpiration";

    constructor(time, source) {
        super(FuryExpirationEvent.type, time);
        
        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (FuryExpirationEvent);

/***/ }),

/***/ "./src/combatsimulator/events/playerRespawnEvent.js":
/*!**********************************************************!*\
  !*** ./src/combatsimulator/events/playerRespawnEvent.js ***!
  \**********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class PlayerRespawnEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "playerRespawn";

    constructor(time, hrid) {
        super(PlayerRespawnEvent.type, time);
        this.hrid = hrid;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (PlayerRespawnEvent);


/***/ }),

/***/ "./src/combatsimulator/events/regenTickEvent.js":
/*!******************************************************!*\
  !*** ./src/combatsimulator/events/regenTickEvent.js ***!
  \******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class RegenTickEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "regenTick";

    constructor(time) {
        super(RegenTickEvent.type, time);
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (RegenTickEvent);


/***/ }),

/***/ "./src/combatsimulator/events/silenceExpirationEvent.js":
/*!**************************************************************!*\
  !*** ./src/combatsimulator/events/silenceExpirationEvent.js ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class SilenceExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "silenceExpiration";

    constructor(time, source) {
        super(SilenceExpirationEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (SilenceExpirationEvent);

/***/ }),

/***/ "./src/combatsimulator/events/stunExpirationEvent.js":
/*!***********************************************************!*\
  !*** ./src/combatsimulator/events/stunExpirationEvent.js ***!
  \***********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class StunExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "stunExpiration";

    constructor(time, source) {
        super(StunExpirationEvent.type, time);

        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (StunExpirationEvent);

/***/ }),

/***/ "./src/combatsimulator/events/weakenExpirationEvent.js":
/*!*************************************************************!*\
  !*** ./src/combatsimulator/events/weakenExpirationEvent.js ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _combatEvent__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./combatEvent */ "./src/combatsimulator/events/combatEvent.js");


class WeakenExpirationEvent extends _combatEvent__WEBPACK_IMPORTED_MODULE_0__["default"] {
    static type = "weakenExpiration";
    static maxWeakenStacks = 5;

    constructor(time, weakenAmount, source) {
        super(WeakenExpirationEvent.type, time);
        this.weakenAmount = Math.min(
            weakenAmount + 1,
            WeakenExpirationEvent.maxWeakenStacks
        );
        this.source = source;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (WeakenExpirationEvent);

/***/ }),

/***/ "./src/combatsimulator/monster.js":
/*!****************************************!*\
  !*** ./src/combatsimulator/monster.js ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _ability__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ability */ "./src/combatsimulator/ability.js");
/* harmony import */ var _combatUnit__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./combatUnit */ "./src/combatsimulator/combatUnit.js");
/* harmony import */ var _data_combatMonsterDetailMap_json__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./data/combatMonsterDetailMap.json */ "./src/combatsimulator/data/combatMonsterDetailMap.json");
/* harmony import */ var _drops__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./drops */ "./src/combatsimulator/drops.js");





class Monster extends _combatUnit__WEBPACK_IMPORTED_MODULE_1__["default"] {

    eliteTier = 0;

    constructor(hrid, eliteTier = 0) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.eliteTier = eliteTier;

        let gameMonster = _data_combatMonsterDetailMap_json__WEBPACK_IMPORTED_MODULE_2__[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (gameMonster.abilities[i].minEliteTier > this.eliteTier) {
                continue;
            }
            this.abilities[i] = new _ability__WEBPACK_IMPORTED_MODULE_0__["default"](gameMonster.abilities[i].abilityHrid, gameMonster.abilities[i].level);
        }
        if(gameMonster.dropTable)
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new _drops__WEBPACK_IMPORTED_MODULE_3__["default"](gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount, gameMonster.dropTable[i].eliteTier);
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            let dropTableItem = (gameMonster.dropTable && i < gameMonster.dropTable.length) ? gameMonster.dropTable[i] : null;
            let eliteTier = dropTableItem?.eliteTier ?? gameMonster.rareDropTable[i].minEliteTier;

            this.rareDropTable[i] = new _drops__WEBPACK_IMPORTED_MODULE_3__["default"](gameMonster.rareDropTable[i].itemHrid, gameMonster.rareDropTable[i].dropRate, gameMonster.rareDropTable[i].minCount, eliteTier);
        }
    }

    updateCombatDetails() {
        let gameMonster = _data_combatMonsterDetailMap_json__WEBPACK_IMPORTED_MODULE_2__[this.hrid];

        switch (this.eliteTier) {
            case 2:
                this.staminaLevel = gameMonster.elite2CombatDetails.staminaLevel;
                this.intelligenceLevel = gameMonster.elite2CombatDetails.intelligenceLevel;
                this.attackLevel = gameMonster.elite2CombatDetails.attackLevel;
                this.powerLevel = gameMonster.elite2CombatDetails.powerLevel;
                this.defenseLevel = gameMonster.elite2CombatDetails.defenseLevel;
                this.rangedLevel = gameMonster.elite2CombatDetails.rangedLevel;
                this.magicLevel = gameMonster.elite2CombatDetails.magicLevel;

                this.combatDetails.combatStats.combatStyleHrid = gameMonster.elite2CombatDetails.combatStats.combatStyleHrids[0];

                for (const [key, value] of Object.entries(gameMonster.elite2CombatDetails.combatStats)) {
                    this.combatDetails.combatStats[key] = value;
                }

                [
                    "stabAccuracy",
                    "slashAccuracy",
                    "smashAccuracy",
                    "rangedAccuracy",
                    "magicAccuracy",
                    "stabDamage",
                    "slashDamage",
                    "smashDamage",
                    "rangedDamage",
                    "magicDamage",
                    "taskDamage",
                    "physicalAmplify",
                    "waterAmplify",
                    "natureAmplify",
                    "fireAmplify",
                    "healingAmplify",
                    "stabEvasion",
                    "slashEvasion",
                    "smashEvasion",
                    "rangedEvasion",
                    "magicEvasion",
                    "armor",
                    "waterResistance",
                    "natureResistance",
                    "fireResistance",
                    "maxHitpoints",
                    "maxManapoints",
                    "lifeSteal",
                    "hpRegenPer10",
                    "mpRegenPer10",
                    "physicalThorns",
                    "elementalThorns",
                    "combatDropRate",
                    "combatRareFind",
                    "combatDropQuantity",
                    "combatExperience",
                    "criticalRate",
                    "criticalDamage",
                    "armorPenetration",
                    "waterPenetration",
                    "naturePenetration",
                    "firePenetration",
                    "abilityHaste",
                    "tenacity",
                    "manaLeech",
                    "castSpeed",
                    "threat",
                    "parry",
                    "mayhem",
                    "pierce",
                    "curse",
                    "fury",
                    "weaken",
                    "ripple",
                    "bloom",
                    "blaze",
                    "attackSpeed",
                    "foodHaste",
                    "drinkConcentration",
                    "autoAttackDamage"
                ].forEach((stat) => {
                    if (gameMonster.combatDetails.combatStats[stat] == null) {
                        this.combatDetails.combatStats[stat] = 0;
                    }
                });

                this.combatDetails.combatStats.attackInterval = gameMonster.elite2CombatDetails.attackInterval;
                break;
            case 1:
                this.staminaLevel = gameMonster.elite1CombatDetails.staminaLevel;
                this.intelligenceLevel = gameMonster.elite1CombatDetails.intelligenceLevel;
                this.attackLevel = gameMonster.elite1CombatDetails.attackLevel;
                this.powerLevel = gameMonster.elite1CombatDetails.powerLevel;
                this.defenseLevel = gameMonster.elite1CombatDetails.defenseLevel;
                this.rangedLevel = gameMonster.elite1CombatDetails.rangedLevel;
                this.magicLevel = gameMonster.elite1CombatDetails.magicLevel;

                this.combatDetails.combatStats.combatStyleHrid = gameMonster.elite1CombatDetails.combatStats.combatStyleHrids[0];

                for (const [key, value] of Object.entries(gameMonster.elite1CombatDetails.combatStats)) {
                    this.combatDetails.combatStats[key] = value;
                }

                [
                    "stabAccuracy",
                    "slashAccuracy",
                    "smashAccuracy",
                    "rangedAccuracy",
                    "magicAccuracy",
                    "stabDamage",
                    "slashDamage",
                    "smashDamage",
                    "rangedDamage",
                    "magicDamage",
                    "taskDamage",
                    "physicalAmplify",
                    "waterAmplify",
                    "natureAmplify",
                    "fireAmplify",
                    "healingAmplify",
                    "stabEvasion",
                    "slashEvasion",
                    "smashEvasion",
                    "rangedEvasion",
                    "magicEvasion",
                    "armor",
                    "waterResistance",
                    "natureResistance",
                    "fireResistance",
                    "maxHitpoints",
                    "maxManapoints",
                    "lifeSteal",
                    "hpRegenPer10",
                    "mpRegenPer10",
                    "physicalThorns",
                    "elementalThorns",
                    "combatDropRate",
                    "combatRareFind",
                    "combatDropQuantity",
                    "combatExperience",
                    "criticalRate",
                    "criticalDamage",
                    "armorPenetration",
                    "waterPenetration",
                    "naturePenetration",
                    "firePenetration",
                    "abilityHaste",
                    "tenacity",
                    "manaLeech",
                    "castSpeed",
                    "threat",
                    "parry",
                    "mayhem",
                    "pierce",
                    "curse",
                    "fury",
                    "weaken",
                    "ripple",
                    "bloom",
                    "blaze",
                    "attackSpeed",
                    "foodHaste",
                    "drinkConcentration",
                    "autoAttackDamage"
                ].forEach((stat) => {
                    if (gameMonster.combatDetails.combatStats[stat] == null) {
                        this.combatDetails.combatStats[stat] = 0;
                    }
                });

                this.combatDetails.combatStats.attackInterval = gameMonster.elite1CombatDetails.attackInterval;
                break;
            default:
                this.staminaLevel = gameMonster.combatDetails.staminaLevel;
                this.intelligenceLevel = gameMonster.combatDetails.intelligenceLevel;
                this.attackLevel = gameMonster.combatDetails.attackLevel;
                this.powerLevel = gameMonster.combatDetails.powerLevel;
                this.defenseLevel = gameMonster.combatDetails.defenseLevel;
                this.rangedLevel = gameMonster.combatDetails.rangedLevel;
                this.magicLevel = gameMonster.combatDetails.magicLevel;

                this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];

                for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {
                    this.combatDetails.combatStats[key] = value;
                }

                [
                    "stabAccuracy",
                    "slashAccuracy",
                    "smashAccuracy",
                    "rangedAccuracy",
                    "magicAccuracy",
                    "stabDamage",
                    "slashDamage",
                    "smashDamage",
                    "rangedDamage",
                    "magicDamage",
                    "taskDamage",
                    "physicalAmplify",
                    "waterAmplify",
                    "natureAmplify",
                    "fireAmplify",
                    "healingAmplify",
                    "stabEvasion",
                    "slashEvasion",
                    "smashEvasion",
                    "rangedEvasion",
                    "magicEvasion",
                    "armor",
                    "waterResistance",
                    "natureResistance",
                    "fireResistance",
                    "maxHitpoints",
                    "maxManapoints",
                    "lifeSteal",
                    "hpRegenPer10",
                    "mpRegenPer10",
                    "physicalThorns",
                    "elementalThorns",
                    "combatDropRate",
                    "combatRareFind",
                    "combatDropQuantity",
                    "combatExperience",
                    "criticalRate",
                    "criticalDamage",
                    "armorPenetration",
                    "waterPenetration",
                    "naturePenetration",
                    "firePenetration",
                    "abilityHaste",
                    "tenacity",
                    "manaLeech",
                    "castSpeed",
                    "threat",
                    "parry",
                    "mayhem",
                    "pierce",
                    "curse",
                    "fury",
                    "weaken",
                    "ripple",
                    "bloom",
                    "blaze",
                    "attackSpeed",
                    "foodHaste",
                    "drinkConcentration",
                    "autoAttackDamage"
                ].forEach((stat) => {
                    if (gameMonster.combatDetails.combatStats[stat] == null) {
                        this.combatDetails.combatStats[stat] = 0;
                    }
                });
                
                this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;
                break;
        }

        super.updateCombatDetails();
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Monster);


/***/ }),

/***/ "./src/combatsimulator/simResult.js":
/*!******************************************!*\
  !*** ./src/combatsimulator/simResult.js ***!
  \******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
class SimResult {
    constructor(zoneName, numberOfPlayers) {
        this.deaths = {};
        this.experienceGained = {};
        this.encounters = 0;
        this.attacks = {};
        this.consumablesUsed = {};
        this.hitpointsGained = {};
        this.manapointsGained = {};
        this.dropRateMultiplier = {};
        this.rareFindMultiplier = {};
        this.playerRanOutOfMana = {
            "player1" : false,
            "player2" : false,
            "player3" : false,
            "player4" : false,
            "player5" : false
        };
        this.manaUsed = {};
        this.timeSpentAlive = [];
        this.bossSpawns = [];
        this.eliteTier = 0;
        this.hitpointsSpent = {};
        this.zoneName = zoneName;
        this.isDungeon = false;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.maxWaveReached = 0;
        this.numberOfPlayers = numberOfPlayers;
    }

    addDeath(unit) {
        if (!this.deaths[unit.hrid]) {
            this.deaths[unit.hrid] = 0;
        }

        this.deaths[unit.hrid] += 1;
    }

    updateTimeSpentAlive(name, alive, time) {
        const i = this.timeSpentAlive.findIndex(e => e.name === name);
        if (alive) {
            if (i !== -1) {
                this.timeSpentAlive[i].alive = true;
                this.timeSpentAlive[i].spawnedAt = time;
            } else {
                this.timeSpentAlive.push({ name: name, timeSpentAlive: 0, spawnedAt: time, alive: true, count: 0 });
            }
        } else {
            const timeAlive = time - this.timeSpentAlive[i].spawnedAt;
            this.timeSpentAlive[i].alive = false;
            this.timeSpentAlive[i].timeSpentAlive += timeAlive;
            this.timeSpentAlive[i].count += 1;
        }
    }

    addExperienceGain(unit, type, experience) {
        if (!unit.isPlayer) {
            return;
        }

        if (!this.experienceGained[unit.hrid]) {
            this.experienceGained[unit.hrid] = {
                stamina: 0,
                intelligence: 0,
                attack: 0,
                power: 0,
                defense: 0,
                ranged: 0,
                magic: 0,
            };
        }

        this.experienceGained[unit.hrid][type] += experience * (1 + unit.combatDetails.combatStats.combatExperience);
    }

    addEncounterEnd() {
        this.encounters++;
    }

    addAttack(source, target, ability, hit) {
        if (!this.attacks[source.hrid]) {
            this.attacks[source.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid]) {
            this.attacks[source.hrid][target.hrid] = {};
        }
        if (!this.attacks[source.hrid][target.hrid][ability]) {
            this.attacks[source.hrid][target.hrid][ability] = {};
        }

        if (!this.attacks[source.hrid][target.hrid][ability][hit]) {
            this.attacks[source.hrid][target.hrid][ability][hit] = 0;
        }

        this.attacks[source.hrid][target.hrid][ability][hit] += 1;
    }

    addConsumableUse(unit, consumable) {
        if (!this.consumablesUsed[unit.hrid]) {
            this.consumablesUsed[unit.hrid] = {};
        }
        if (!this.consumablesUsed[unit.hrid][consumable.hrid]) {
            this.consumablesUsed[unit.hrid][consumable.hrid] = 0;
        }

        this.consumablesUsed[unit.hrid][consumable.hrid] += 1;
    }

    addHitpointsGained(unit, source, amount) {
        if (!this.hitpointsGained[unit.hrid]) {
            this.hitpointsGained[unit.hrid] = {};
        }
        if (!this.hitpointsGained[unit.hrid][source]) {
            this.hitpointsGained[unit.hrid][source] = 0;
        }

        this.hitpointsGained[unit.hrid][source] += amount;
    }

    addManapointsGained(unit, source, amount) {
        if (!this.manapointsGained[unit.hrid]) {
            this.manapointsGained[unit.hrid] = {};
        }
        if (!this.manapointsGained[unit.hrid][source]) {
            this.manapointsGained[unit.hrid][source] = 0;
        }

        this.manapointsGained[unit.hrid][source] += amount;
    }

    setDropRateMultipliers(unit) {
        if (!this.dropRateMultiplier[unit.hrid]) {
            this.dropRateMultiplier[unit.hrid] = {};
        }
        this.dropRateMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatDropRate;
        if (!this.rareFindMultiplier[unit.hrid]) {
            this.rareFindMultiplier[unit.hrid] = {};
        }
        this.rareFindMultiplier[unit.hrid] = 1 + unit.combatDetails.combatStats.combatRareFind;
    }

    setManaUsed(unit) {
        this.manaUsed[unit.hrid] = {};
        for (let [key, value] of unit.abilityManaCosts.entries()) {
            this.manaUsed[unit.hrid][key] = value;
        }
    }

    addHitpointsSpent(unit, source, amount) {
        if (!this.hitpointsSpent[unit.hrid]) {
            this.hitpointsSpent[unit.hrid] = {};
        }
        if (!this.hitpointsSpent[unit.hrid][source]) {
            this.hitpointsSpent[unit.hrid][source] = 0;
        }

        this.hitpointsSpent[unit.hrid][source] += amount;
    }
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (SimResult);


/***/ }),

/***/ "./src/combatsimulator/trigger.js":
/*!****************************************!*\
  !*** ./src/combatsimulator/trigger.js ***!
  \****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _data_combatTriggerDependencyDetailMap_json__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./data/combatTriggerDependencyDetailMap.json */ "./src/combatsimulator/data/combatTriggerDependencyDetailMap.json");


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
        if (_data_combatTriggerDependencyDetailMap_json__WEBPACK_IMPORTED_MODULE_0__[this.dependencyHrid].isSingleTarget) {
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
            case "/combat_trigger_conditions/smoke_burst_accuracy":
            case "/combat_trigger_conditions/smoke_burst_evasion":
            case "/combat_trigger_conditions/arcane_reflection":
            case "/combat_trigger_conditions/fracturing_impact":
            case "/combat_trigger_conditions/maim":
            case "/combat_trigger_conditions/fury_accuracy":
            case "/combat_trigger_conditions/fury_damage":
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
                return source.curseValue > 0;
            case "/combat_trigger_conditions/weaken":
                return source.isWeakened || source.weakenExpireTime == currentTime;
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

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Trigger);


/***/ })

}]);
//# sourceMappingURL=src_combatsimulator_combatSimulator_js.bundle.js.map