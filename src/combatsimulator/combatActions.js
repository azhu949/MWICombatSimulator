// 切片 21A：共享战斗动作核心。
//
// 战斗「单步动作」方法（施法 / 消耗品 / 触发器检查 / 遭遇战收尾 / 经验与团灭记账）
// 的单一事实来源。`CombatSimulator`（完整事件驱动引擎）与 `CombatPreviewContext`
// （playerMapper 的零时刻预览）共同继承本类：动作语义只在一份代码里演化，
// 预览面板与真实模拟不会漂移。
//
// 基类对实例状态的契约（由子类构造器提供）：
// - this.players / this.enemies：战斗单位数组（enemies 可为 null / undefined）；
// - this.eventQueue：EventQueue 兼容队列（addEvent / clear / getMatching /
//   clearMatching / clearEventsForUnit / clearEventsOfType /
//   containsEventOfTypesAndSource / containsEventOfTypeAndHrid）；
// - this.simResult：记账接收器（SimResult 或等价的 no-op 接收器——预览不读任何记账输出）；
// - this.simulationTime：当前模拟时间（纳秒）；
// - this.zone / this.labyrinth / this.logCombatEvents / this.minimalResult / this.allPlayersDead /
//   this.enrageBeginTime / this.experienceAwardedEnemies / this.enemyDeathSnapshots /
//   this.pendingExperienceGains / this.invalidExperienceRateWarningKeys / this.wipeLogs。
//
// 方法体逐字保留自 combatSimulator.js（2026-09-29 切片 21A 抽出）；修改动作语义时
// 必须同步评估 Rust 侧（engine/src/simulator.rs）的对应实现。
import CombatUtilities from './combatUtilities';
import AutoAttackEvent from './events/autoAttackEvent';
import DamageOverTimeEvent from './events/damageOverTimeEvent';
import CheckBuffExpirationEvent from './events/checkBuffExpirationEvent';
import CombatStartEvent from './events/combatStartEvent';
import ConsumableTickEvent from './events/consumableTickEvent';
import CooldownReadyEvent from './events/cooldownReadyEvent';
import EnemyRespawnEvent from './events/enemyRespawnEvent';
import EnrageTickEvent from './events/enrageTickEvent';
import RegenTickEvent from './events/regenTickEvent';
import PlayerRespawnEvent from './events/playerRespawnEvent';
import StunExpirationEvent from './events/stunExpirationEvent';
import BlindExpirationEvent from './events/blindExpirationEvent';
import SilenceExpirationEvent from './events/silenceExpirationEvent';
import CurseExpirationEvent from './events/curseExpirationEvent';
import WeakenExpirationEvent from './events/weakenExpirationEvent';
import FuryExpirationEvent from './events/furyExpirationEvent';
import AbilityCastEndEvent from './events/abilityCastEndEvent';
import AwaitCooldownEvent from './events/awaitCooldownEvent';
import Monster from './monster';
import Ability from './ability';
import { BUFF_SOURCE_POLICY, getAbilityBuffSourcePolicy } from './buffSourcePolicy.js';

export const ONE_SECOND = 1e9;
export const HOT_TICK_INTERVAL = 5 * ONE_SECOND;
export const DOT_TICK_INTERVAL = 3 * ONE_SECOND;
export const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;
export const ENEMY_RESPAWN_INTERVAL = 3 * ONE_SECOND;
export const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;
export const RESTART_INTERVAL = 3 * ONE_SECOND;
export const ENRAGE_TICK_INTERVAL = 60 * ONE_SECOND;
export const CURSE_UNIQUE_HRID = '/buff_uniques/curse';
export const WEAKEN_UNIQUE_HRID = '/buff_uniques/weaken';
export const FURY_ACCURACY_UNIQUE_HRID = '/buff_uniques/fury_accuracy';
export const FURY_DAMAGE_UNIQUE_HRID = '/buff_uniques/fury_damage';
export const ATTACK_EVENT_TYPES = [AbilityCastEndEvent.type, AutoAttackEvent.type];

function addAbilityBuff(target, buff, currentTime, source, ability) {
  const sourcePolicy = getAbilityBuffSourcePolicy(ability, buff);
  const sourceKey = sourcePolicy === BUFF_SOURCE_POLICY.STRONGEST ? (source.hrid ?? 'default') : 'default';
  target.addBuff(buff, currentTime, sourcePolicy === BUFF_SOURCE_POLICY.STRONGEST ? sourceKey : null, {
    sourcePolicy,
  });
  return sourceKey;
}

function isPositiveFiniteNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0;
}

// EventTarget：CombatSimulator 的 progress 事件依赖它；预览上下文不派发事件，
// 继承只是让两个子类共享同一基类构造契约（super() 链）。
class CombatActionsCore extends EventTarget {
  addToWipeLogs(logEntry) {
    if (!this.logCombatEvents) return;
    const { buffer, maxSize } = this.wipeLogs;

    buffer[this.wipeLogs.index] = logEntry;
    this.wipeLogs.index = (this.wipeLogs.index + 1) % maxSize;
    this.wipeLogs.count = Math.min(this.wipeLogs.count + 1, maxSize);
  }

  logAndResetWipeLogs() {
    if (!this.logCombatEvents) return;
    const logs = this.getOrderedWipeLogs();

    logs.forEach((log) => {
      if (log.error) {
        console.log(log.error);
        return;
      }
    });

    this.wipeLogs.index = 0;
    this.wipeLogs.count = 0;
  }

  buildCombatLog(source, ability, target, damageDone) {
    if (!this.logCombatEvents) return null;
    try {
      const sourceHrid = source?.hrid || 'UNKNOWN_SOURCE';
      const targetHrid = target?.hrid || 'UNKNOWN_TARGET';

      const afterHp = target?.combatDetails?.currentHitpoints || 0;
      const beforeHp = Math.max(0, afterHp + damageDone);

      const playersHp = this.players.map((p) => ({
        hrid: p.hrid || 'UNKNOWN_PLAYER',
        current: p.combatDetails?.currentHitpoints ?? 0,
        max: p.combatDetails?.maxHitpoints ?? 0,
      }));

      return {
        time: this.simulationTime,
        wave: this.zone.encountersKilled - 1,
        source: sourceHrid,
        ability: ability,
        target: targetHrid,
        damage: damageDone,
        beforeHp: beforeHp,
        afterHp: afterHp,
        playersHp: playersHp,
        // enemiesHp: enemiesHp,
        isCrit: false,
      };
    } catch (e) {
      return {
        error: `[日志生成错误] ${e.message}`,
      };
    }
  }

  generateCombatLog(source, ability, target, attackResult) {
    if (!this.logCombatEvents) return null;
    try {
      const sourceHrid = source?.hrid || 'UNKNOWN_SOURCE';
      const targetHrid = target?.hrid || 'UNKNOWN_TARGET';
      const damage = attackResult?.damageDone || 0;

      const afterHp = target?.combatDetails?.currentHitpoints || 0;
      const beforeHp = Math.max(0, afterHp + damage);

      const playersHp = this.players.map((p) => ({
        hrid: p.hrid || 'UNKNOWN_PLAYER',
        current: p.combatDetails?.currentHitpoints ?? 0,
        max: p.combatDetails?.maxHitpoints ?? 0,
      }));

      return {
        time: this.simulationTime,
        wave: this.zone.encountersKilled - 1,
        source: sourceHrid,
        ability: ability,
        target: targetHrid,
        damage: damage,
        beforeHp: beforeHp,
        afterHp: afterHp,
        playersHp: playersHp,
        // enemiesHp: enemiesHp,
        isCrit: attackResult?.isCrit || false,
      };
    } catch (e) {
      return {
        error: `[日志生成错误] ${e.message}`,
      };
    }
  }

  getOrderedWipeLogs() {
    if (!this.logCombatEvents) return [];
    const { buffer, maxSize, count } = this.wipeLogs;
    const logs = [];

    for (let i = 0; i < count; i++) {
      const idx = (this.wipeLogs.index - count + maxSize + i) % maxSize;
      logs.push(buffer[idx]);
    }

    return logs;
  }

  saveWipeLogsToSimResult(wave) {
    if (!this.logCombatEvents) return;
    const logs = this.getOrderedWipeLogs();
    this.simResult.addWipeEvent(logs, this.simulationTime, wave);
  }

  recordUnitDeath(unit) {
    this.simResult.addDeath(unit);
    if (this.minimalResult) return;
    if (!unit?.isPlayer) {
      // 只有遭遇战成员参与经验快照。
      // 保留此守卫还让仅需结果/掉落的调用方能够使用
      // 轻量级、无经验元数据的 DTO 调用死亡记录器。
      if (this.enemies?.includes(unit)) {
        this.captureEnemyDeathSnapshot(unit, this.simulationTime);
      }
      for (const player of this.players || []) {
        this.simResult.recordMonsterDeathFromUnit(player, unit, 1);
      }
    }
  }

  appendPendingExperienceGains(gains) {
    if (!gains) {
      return;
    }

    for (const [playerHrid, playerGains] of Object.entries(gains)) {
      let pending = this.pendingExperienceGains.get(playerHrid);
      if (!pending) {
        pending = {};
        this.pendingExperienceGains.set(playerHrid, pending);
      }

      for (const [type, value] of Object.entries(playerGains || {})) {
        pending[type] = (pending[type] || 0) + value;
      }
    }
  }

  captureExperienceGain(player, experience) {
    if (this.minimalResult) return;
    const gains = this.simResult.calculateExperienceGain(player, experience);
    if (!gains || !player?.hrid) {
      return;
    }

    this.appendPendingExperienceGains({ [player.hrid]: gains });
  }

  commitPendingExperience() {
    if (this.minimalResult) {
      this.pendingExperienceGains.clear();
      return;
    }
    for (const [playerHrid, gains] of this.pendingExperienceGains.entries()) {
      const player = this.players.find((candidate) => candidate?.hrid === playerHrid);
      if (player) {
        this.simResult.addExperienceGainValues(player, gains);
      }
    }
    this.pendingExperienceGains.clear();
  }

  discardPendingExperience() {
    this.pendingExperienceGains.clear();
  }

  warnInvalidEnemyExperienceRate(enemy, aliveDuration, enrageTime) {
    const enemyHrid = String(enemy?.hrid || 'unknown');
    if (this.invalidExperienceRateWarningKeys.has(enemyHrid)) {
      return;
    }

    this.invalidExperienceRateWarningKeys.add(enemyHrid);
    console.warn(
      `WARN: Invalid experience rate for ${enemyHrid}; using 1.0 ` +
        `(aliveDuration=${aliveDuration}, enrageTime=${enrageTime})`,
    );
  }

  calculateEnemyExperienceRate(enemy) {
    return this.calculateEnemyExperienceRateAt(enemy, this.simulationTime);
  }

  calculateEnemyExperienceRateAt(enemy, deathTime) {
    const enrageTime = Number(enemy?.enrageTime);
    let aliveDuration = Number(deathTime) - Number(this.enrageBeginTime);
    let experienceRate = Number.NaN;

    if (Number.isFinite(aliveDuration) && isPositiveFiniteNumber(enrageTime)) {
      aliveDuration = Math.min(aliveDuration, enrageTime);
      experienceRate = 1.0 + aliveDuration / enrageTime;
    }

    if (!isPositiveFiniteNumber(experienceRate)) {
      this.warnInvalidEnemyExperienceRate(enemy, aliveDuration, enrageTime);
      return 1.0;
    }

    return experienceRate;
  }

  captureEnemyDeathSnapshot(enemy, deathTime) {
    if (this.minimalResult) return;
    if (
      !enemy ||
      typeof enemy !== 'object' ||
      this.enemyDeathSnapshots.has(enemy) ||
      this.experienceAwardedEnemies.has(enemy)
    ) {
      return;
    }

    const experienceRate = this.calculateEnemyExperienceRateAt(enemy, deathTime);
    const totalExperience = Number(enemy.experience || 0) * experienceRate;
    const gainsByPlayer = {};

    if (Number.isFinite(totalExperience) && totalExperience > 0) {
      const experiencePerPlayer = totalExperience / Math.max(1, this.players.length);
      for (const player of this.players || []) {
        const gains = this.simResult.calculateExperienceGain(player, experiencePerPlayer);
        if (gains && player?.hrid) {
          gainsByPlayer[player.hrid] = gains;
        }
      }
    }

    this.enemyDeathSnapshots.set(enemy, {
      deathTime,
      experienceRate,
      gainsByPlayer,
    });
  }

  finalizeEnemyExperience(enemy) {
    if (this.minimalResult) return;
    if (!enemy || typeof enemy !== 'object' || this.experienceAwardedEnemies.has(enemy)) {
      return;
    }

    if (!this.enemyDeathSnapshots.has(enemy)) {
      this.captureEnemyDeathSnapshot(enemy, this.simulationTime);
    }

    const snapshot = this.enemyDeathSnapshots.get(enemy);
    if (!snapshot) {
      return;
    }

    this.appendPendingExperienceGains(snapshot.gainsByPlayer);
    this.experienceAwardedEnemies.add(enemy);
  }

  awardEnemyExperience(enemy, explicitExperienceRate = undefined) {
    if (!enemy || this.experienceAwardedEnemies.has(enemy)) {
      return;
    }

    if (explicitExperienceRate === undefined && this.enemyDeathSnapshots.has(enemy)) {
      this.finalizeEnemyExperience(enemy);
      return;
    }

    // 保持此公共助手与直接授予预计算比率的调用方兼容。
    // 遭遇战死亡使用上面的快照路径，
    // 因此没有任何结果状态依赖 `enemy.experienceRate`。
    const experienceRate =
      explicitExperienceRate !== undefined ? Number(explicitExperienceRate) : Number(enemy.experienceRate);
    const totalExperience = Number(enemy.experience || 0) * experienceRate;
    if (!Number.isFinite(totalExperience) || totalExperience <= 0) {
      return;
    }
    this.experienceAwardedEnemies.add(enemy);
    this.players.forEach((player) => {
      this.captureExperienceGain(player, totalExperience / Math.max(1, this.players.length));
    });
  }

  checkParry(targets) {
    let parryUnits = targets.filter(
      (unit) => unit && unit.combatDetails.currentHitpoints > 0 && unit.combatDetails.combatStats.parry > 0,
    );
    if (parryUnits.length <= 0) {
      return undefined;
    }
    let randomIndex = Math.floor(Math.random() * parryUnits.length);
    if (parryUnits[randomIndex].combatDetails.combatStats.parry > Math.random()) {
      return parryUnits[randomIndex];
    }
    return undefined;
  }

  addNextAttackEvent(source) {
    if (this.eventQueue.containsEventOfTypesAndSource(ATTACK_EVENT_TYPES, source)) {
      return;
    }

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
    let skipNextAbility = false;

    source.abilities
      .filter((ability) => ability != null)
      .forEach((ability) => {
        if (
          !usedAbility &&
          !skipNextAbility &&
          ability.shouldTrigger(this.simulationTime, source, target, friendlies, enemies)
        ) {
          if (!this.canUseAbility(source, ability, true)) {
            skipNextAbility = true;
          }

          if (!skipNextAbility) {
            let castDuration = ability.castDuration;
            castDuration /= 1 + source.combatDetails.combatStats.castSpeed;
            let abilityCastEndEvent = new AbilityCastEndEvent(this.simulationTime + castDuration, source, ability);
            this.eventQueue.addEvent(abilityCastEndEvent);
            /*-if (source.isPlayer) {
                            let haste = source.combatDetails.combatStats.abilityHaste;
                            let cooldownDuration = ability.cooldownDuration;
                            if (haste > 0) {
                                cooldownDuration = cooldownDuration * 100 / (100 + haste);
                            }
                        }*/
            usedAbility = true;
          }
        }
      });

    if (usedAbility) {
      source.isOutOfMana = false;
      return;
    }

    if (!enemies) {
      return;
    }

    if (!source.isBlinded) {
      let autoAttackEvent = new AutoAttackEvent(
        this.simulationTime + source.combatDetails.combatStats.attackInterval,
        source,
      );
      /*-if (source.isPlayer) {
            }*/
      this.eventQueue.addEvent(autoAttackEvent);
    } else {
      source.isOutOfMana = true;
    }
  }

  checkTriggers() {
    let triggeredSomething;

    do {
      triggeredSomething = false;

      for (let index = 0; index < this.players.length; index += 1) {
        const player = this.players[index];
        if (
          player.combatDetails.currentHitpoints > 0 &&
          this.checkTriggersForUnit(player, this.players, this.enemies)
        ) {
          triggeredSomething = true;
        }
      }

      if (this.enemies) {
        for (let index = 0; index < this.enemies.length; index += 1) {
          const enemy = this.enemies[index];
          if (
            enemy.combatDetails.currentHitpoints > 0 &&
            this.checkTriggersForUnit(enemy, this.enemies, this.players)
          ) {
            triggeredSomething = true;
          }
        }
      }
    } while (triggeredSomething);
  }

  checkTriggersForUnit(unit, friendlies, enemies) {
    if (unit.combatDetails.currentHitpoints <= 0) {
      throw new Error('Checking triggers for a dead unit');
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
    if (source.combatDetails.currentHitpoints <= 0) {
      return false;
    }

    consumable.lastUsed = this.simulationTime;
    let consumeCooldown = consumable.cooldownDuration;
    if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes('drink')) {
      consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.drinkConcentration);
    } else if (source.combatDetails.combatStats.foodHaste > 0 && consumable.catagoryHrid.includes('food')) {
      consumeCooldown = consumeCooldown / (1 + source.combatDetails.combatStats.foodHaste);
    }
    let cooldownReadyEvent = new CooldownReadyEvent(this.simulationTime + consumeCooldown);
    this.eventQueue.addEvent(cooldownReadyEvent);

    this.simResult.addConsumableUse(source, consumable);

    if (consumable.recoveryDuration == 0) {
      if (consumable.hitpointRestore > 0) {
        let hitpointsAdded = source.addHitpoints(consumable.hitpointRestore);
        this.simResult.addHitpointsGained(source, consumable.hrid, hitpointsAdded);
      }

      if (consumable.manapointRestore > 0) {
        let manapointsAdded = source.addManapoints(consumable.manapointRestore);
        this.simResult.addManapointsGained(source, consumable.hrid, manapointsAdded);

        // 空蓝（oom）时检查技能触发器
        if (source.isOutOfMana) {
          let awaitCooldownEvent = new AwaitCooldownEvent(this.simulationTime, source);
          this.eventQueue.addEvent(awaitCooldownEvent);
        }
      }
    } else {
      let consumableTickEvent = new ConsumableTickEvent(
        this.simulationTime + 5 * ONE_SECOND,
        source,
        consumable,
        consumable.recoveryDuration / (5 * ONE_SECOND),
        1,
      );
      this.eventQueue.addEvent(consumableTickEvent);
    }

    for (const buff of consumable.buffs) {
      let currentBuff = structuredClone(buff);
      if (source.combatDetails.combatStats.drinkConcentration > 0 && consumable.catagoryHrid.includes('drink')) {
        currentBuff.ratioBoost *= 1 + source.combatDetails.combatStats.drinkConcentration;
        currentBuff.flatBoost *= 1 + source.combatDetails.combatStats.drinkConcentration;
        currentBuff.duration = currentBuff.duration / (1 + source.combatDetails.combatStats.drinkConcentration);
      }
      source.addBuff(currentBuff, this.simulationTime);
      let checkBuffExpirationEvent = new CheckBuffExpirationEvent(this.simulationTime + currentBuff.duration, source);
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
        // if (this.simResult.playerRanOutOfMana[source.hrid] == false) {
        // }
        this.simResult.addRanOutOfManaCount(source, true, this.simulationTime);
      }
      return false;
    }
    if (source.isPlayer && oomCheck) {
      this.simResult.addRanOutOfManaCount(source, false, this.simulationTime);
    }
    return true;
  }

  // 从施法者身上扣除技能的魔法值消耗，并更新
  // 面向玩家的魔法值记账。这种做法刻意无副作用
  //（不调度事件、不记录 simResult），因此实时施法路径
  // 与静态预览路径可以共享魔法值记账的
  // 单一事实来源，而不会逐渐偏离。
  spendAbilityMana(source, ability) {
    if (source.isPlayer) {
      if (source.abilityManaCosts.has(ability.hrid)) {
        source.abilityManaCosts.set(ability.hrid, source.abilityManaCosts.get(ability.hrid) + ability.manaCost);
      } else {
        source.abilityManaCosts.set(ability.hrid, ability.manaCost);
      }
    }

    source.combatDetails.currentManapoints -= ability.manaCost;
    ability.lastUsed = this.simulationTime;
  }

  tryUseAbility(source, ability) {
    if (!this.canUseAbility(source, ability, true)) {
      return false;
    }

    this.spendAbilityMana(source, ability);

    let haste = source.combatDetails.combatStats.abilityHaste;
    let cooldownDuration = ability.cooldownDuration;
    if (haste > 0) {
      cooldownDuration = (cooldownDuration * 100) / (100 + haste);
    }

    /*-if (source.isPlayer) {
            let castDuration = ability.castDuration;
            castDuration /= (1 + source.combatDetails.combatStats.castSpeed)
        }*/

    let todoAbilities = [ability];

    if (source.combatDetails.combatStats.blaze > 0 && Math.random() < source.combatDetails.combatStats.blaze) {
      todoAbilities.push(new Ability('blaze'));
    }

    if (source.combatDetails.combatStats.bloom > 0 && Math.random() < source.combatDetails.combatStats.bloom) {
      todoAbilities.push(new Ability('bloom'));
    }

    for (const todoAbility of todoAbilities) {
      for (const abilityEffect of todoAbility.abilityEffects) {
        switch (abilityEffect.effectType) {
          case '/ability_effect_types/buff':
            this.processAbilityBuffEffect(source, todoAbility, abilityEffect);
            break;
          case '/ability_effect_types/damage':
            this.processAbilityDamageEffect(source, todoAbility, abilityEffect);
            break;
          case '/ability_effect_types/heal':
            this.processAbilityHealEffect(source, todoAbility, abilityEffect);
            break;
          case '/ability_effect_types/spend_hp':
            this.processAbilitySpendHpEffect(source, todoAbility, abilityEffect);
            break;
          case '/ability_effect_types/revive':
            this.processAbilityReviveEffect(source, todoAbility, abilityEffect);
            break;
          case '/ability_effect_types/promote':
            this.eventQueue.clearEventsForUnit(source);
            source = this.processAbilityPromoteEffect(source, todoAbility, abilityEffect);
            this.addNextAttackEvent(source);
            break;
          default:
            throw new Error(
              'Unsupported effect type for ability: ' + todoAbility.hrid + ' effectType: ' + abilityEffect.effectType,
            );
        }
      }
    }

    if (source.combatDetails.combatStats.ripple > 0 && Math.random() < source.combatDetails.combatStats.ripple) {
      let manapointsAdded = source.addManapoints(10);
      this.simResult.addManapointsGained(source, 'ripple', manapointsAdded);
      for (const ability of source.abilities) {
        if (ability && ability.lastUsed) {
          const remainingCooldown = ability.lastUsed + ability.cooldownDuration - this.simulationTime;
          if (remainingCooldown > 0) {
            ability.lastUsed = Math.max(
              ability.lastUsed - ONE_SECOND * 2,
              this.simulationTime - ability.cooldownDuration,
            );
          }
        }
      }
    }

    this.addNextAttackEvent(source);

    // 可能死于反伤伤害
    if (source.combatDetails.currentHitpoints == 0) {
      this.eventQueue.clearEventsForUnit(source);
      this.recordUnitDeath(source);
      if (!source.isPlayer) {
        this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);
      }
    }

    this.checkEncounterEnd();

    return true;
  }

  scheduleBuffExpirationEvent(target, buff, sourceKey) {
    // 重新施放会刷新此目标/源注册。替换旧事件
    // 而不是跳过新事件；否则较短的刷新会过期过晚，
    // 而保留所有历史事件又是冗余的。
    this.eventQueue.clearMatching(
      (event) =>
        event.type === CheckBuffExpirationEvent.type &&
        event.source === target &&
        event.buffUniqueHrid === buff.uniqueHrid &&
        event.buffSourceKey === sourceKey,
    );
    this.eventQueue.addEvent(
      new CheckBuffExpirationEvent(this.simulationTime + buff.duration, target, buff.uniqueHrid, sourceKey),
    );
  }

  processAbilityBuffEffect(source, ability, abilityEffect, { scheduleExpirationEvents = true } = {}) {
    if (abilityEffect.targetType == 'allAllies') {
      let targets = source.isPlayer ? this.players : this.enemies;
      for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
        for (const buff of abilityEffect.buffs) {
          let currentBuff = buff;
          if (ability.isSpecialAbility && buff.multiplierForSkillHrid && buff.multiplierPerSkillLevel > 0) {
            let multiplier =
              1.0 +
              source.combatDetails[buff.multiplierForSkillHrid.split('/')[2] + 'Level'] * buff.multiplierPerSkillLevel;
            currentBuff = structuredClone(buff);
            currentBuff.flatBoost *= multiplier;
            currentBuff.ratioBoost *= multiplier;
          }

          const sourceKey = addAbilityBuff(target, currentBuff, this.simulationTime, source, ability);
          if (scheduleExpirationEvents) {
            this.scheduleBuffExpirationEvent(target, currentBuff, sourceKey);
          }
        }
      }
      return;
    }

    if (abilityEffect.targetType != 'self') {
      throw new Error('Unsupported target type for buff ability effect: ' + ability.hrid);
    }

    for (const buff of abilityEffect.buffs) {
      const sourceKey = addAbilityBuff(source, buff, this.simulationTime, source, ability);
      if (scheduleExpirationEvents) {
        this.scheduleBuffExpirationEvent(source, buff, sourceKey);
      }
    }
  }

  processAbilityDamageEffect(source, ability, abilityEffect) {
    let targets;
    switch (abilityEffect.targetType) {
      case 'enemy':
      case 'allEnemies':
        targets = source.isPlayer ? this.enemies : this.players;
        break;
      default:
        throw new Error('Unsupported target type for damage ability effect: ' + ability.hrid);
    }

    if (!targets) {
      return;
    }

    let avoidTarget = [];

    let isSkipParry = false;

    for (let target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
      let parryTarget = undefined;
      if (!isSkipParry) {
        parryTarget = this.checkParry(targets);
        isSkipParry = true; //  格挡检查只在第一个目标上执行一次
      }

      if (parryTarget) {
        let tempTarget = source;
        let tempSource = parryTarget;

        let attackResult = CombatUtilities.processAttack(tempSource, tempTarget);

        this.simResult.addAttack(
          tempSource,
          tempTarget,
          'parry',
          attackResult.didHit ? attackResult.damageDone : 'miss',
        );

        if (attackResult.lifeStealHeal > 0) {
          this.simResult.addHitpointsGained(tempSource, 'lifesteal', attackResult.lifeStealHeal);
        }

        if (attackResult.manaLeechMana > 0) {
          this.simResult.addManapointsGained(tempSource, 'manaLeech', attackResult.manaLeechMana);
        }

        if (attackResult.thornDamageDone > 0) {
          this.simResult.addAttack(tempTarget, tempSource, attackResult.thornType, attackResult.thornDamageDone);
        }
        if (tempTarget.combatDetails.combatStats.retaliation > 0) {
          this.simResult.addAttack(
            tempTarget,
            tempSource,
            'retaliation',
            attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : 'miss',
          );
        }

        if (tempTarget.combatDetails.currentHitpoints == 0) {
          this.eventQueue.clearEventsForUnit(tempTarget);
          this.recordUnitDeath(tempTarget);
          if (!tempTarget.isPlayer) {
            this.simResult.updateTimeSpentAlive(tempTarget.hrid, false, this.simulationTime);
          }
        }

        // 可能死于反伤伤害
        if (
          tempSource.combatDetails.currentHitpoints == 0 &&
          (attackResult.thornDamageDone != 0 || attackResult.retaliationDamageDone != 0)
        ) {
          this.eventQueue.clearEventsForUnit(tempSource);
          this.recordUnitDeath(tempSource);
          if (!tempSource.isPlayer) {
            this.simResult.updateTimeSpentAlive(tempSource.hrid, false, this.simulationTime);
          }
        }
      } else {
        targets = targets.filter(
          (unit) => unit && !avoidTarget.includes(unit.hrid) && unit.combatDetails.currentHitpoints > 0,
        );
        if (!source.isPlayer && targets.length > 0 && abilityEffect.targetType == 'enemy') {
          let cumulativeThreat = 0;
          let cumulativeRanges = [];
          targets.forEach((player) => {
            let playerThreat = player.combatDetails.combatStats.threat;
            cumulativeThreat += playerThreat;
            cumulativeRanges.push({
              player: player,
              rangeStart: cumulativeThreat - playerThreat,
              rangeEnd: cumulativeThreat,
            });
          });
          let randomValueHit = Math.random() * cumulativeThreat;
          target = cumulativeRanges.find(
            (range) => randomValueHit >= range.rangeStart && randomValueHit < range.rangeEnd,
          ).player;
          avoidTarget.push(target.hrid);
        }
        if (targets.length <= 0) {
          break;
        }

        let attackResult = CombatUtilities.processAttack(source, target, abilityEffect);

        if (
          this.logCombatEvents &&
          this.zone?.isDungeon &&
          target.isPlayer &&
          attackResult.didHit &&
          attackResult.damageDone > 0
        ) {
          const log = this.generateCombatLog(source, ability.hrid, target, attackResult);
          this.addToWipeLogs(log);
        }

        if (attackResult.hpDrain > 0) {
          this.simResult.addHitpointsGained(source, ability.hrid, attackResult.hpDrain);
        }

        if (attackResult.didHit && abilityEffect.buffs) {
          for (const buff of abilityEffect.buffs) {
            const sourceKey = addAbilityBuff(target, buff, this.simulationTime, source, ability);
            this.scheduleBuffExpirationEvent(target, buff, sourceKey);
          }
        }

        if (abilityEffect.damageOverTimeRatio > 0 && attackResult.damageDone > 0) {
          let damageOverTimeEvent = new DamageOverTimeEvent(
            this.simulationTime + 3 * ONE_SECOND,
            source,
            target,
            attackResult.damageDone * abilityEffect.damageOverTimeRatio,
            abilityEffect.damageOverTimeDuration / (3 * ONE_SECOND),
            1,
            abilityEffect.combatStyleHrid,
          );
          this.eventQueue.addEvent(damageOverTimeEvent);
        }

        if (
          attackResult.didHit &&
          abilityEffect.stunChance > 0 &&
          Math.random() < (abilityEffect.stunChance * 100) / (100 + target.combatDetails.combatStats.tenacity)
        ) {
          target.isStunned = true;
          target.stunExpireTime = this.simulationTime + abilityEffect.stunDuration;
          this.eventQueue.clearMatching(
            (event) =>
              (event.type == AutoAttackEvent.type ||
                event.type == AbilityCastEndEvent.type ||
                event.type == StunExpirationEvent.type) &&
              event.source == target,
          );
          let stunExpirationEvent = new StunExpirationEvent(target.stunExpireTime, target);
          this.eventQueue.addEvent(stunExpirationEvent);
        }

        if (
          attackResult.didHit &&
          abilityEffect.blindChance > 0 &&
          Math.random() < (abilityEffect.blindChance * 100) / (100 + target.combatDetails.combatStats.tenacity)
        ) {
          target.isBlinded = true;
          target.blindExpireTime = this.simulationTime + abilityEffect.blindDuration;
          this.eventQueue.clearMatching((event) => event.type == BlindExpirationEvent.type && event.source == target);
          if (this.eventQueue.clearMatching((event) => event.type == AutoAttackEvent.type && event.source == target)) {
            this.addNextAttackEvent(target);
          }
          let blindExpirationEvent = new BlindExpirationEvent(target.blindExpireTime, target);
          this.eventQueue.addEvent(blindExpirationEvent);
        }

        if (
          attackResult.didHit &&
          abilityEffect.silenceChance > 0 &&
          Math.random() < (abilityEffect.silenceChance * 100) / (100 + target.combatDetails.combatStats.tenacity)
        ) {
          target.isSilenced = true;
          target.silenceExpireTime = this.simulationTime + abilityEffect.silenceDuration;
          this.eventQueue.clearMatching((event) => event.type == SilenceExpirationEvent.type && event.source == target);
          if (
            this.eventQueue.clearMatching((event) => event.type == AbilityCastEndEvent.type && event.source == target)
          ) {
            this.addNextAttackEvent(target);
          }
          let silenceExpirationEvent = new SilenceExpirationEvent(target.silenceExpireTime, target);
          this.eventQueue.addEvent(silenceExpirationEvent);
        }

        if (attackResult.didHit && source.combatDetails.combatStats.curse > 0) {
          const curseExpireTime = 15000000000;
          let currentCurseEvent = this.eventQueue.getMatching(
            (event) => event.type == CurseExpirationEvent.type && event.source == target,
          );
          let currentCurseAmount = 0;
          if (currentCurseEvent) currentCurseAmount = currentCurseEvent.curseAmount;
          this.eventQueue.clearMatching((event) => event.type == CurseExpirationEvent.type && event.source == target);

          let curseExpirationEvent = new CurseExpirationEvent(
            this.simulationTime + curseExpireTime,
            currentCurseAmount,
            target,
          );
          const curseBuff = {
            uniqueHrid: CURSE_UNIQUE_HRID,
            typeHrid: '/buff_types/damage_taken',
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: source.combatDetails.combatStats.curse * curseExpirationEvent.curseAmount,
            flatBoostLevelBonus: 0,
            duration: curseExpireTime,
          };
          target.addBuff(curseBuff, this.simulationTime);
          this.eventQueue.addEvent(curseExpirationEvent);
        }

        if (source.combatDetails.combatStats.fury > 0) {
          let currentFuryEvent = this.eventQueue.getMatching(
            (event) => event.type == FuryExpirationEvent.type && event.source == source,
          );
          this.eventQueue.clearMatching((event) => event.type == FuryExpirationEvent.type && event.source == source);

          const furyExpireTime = 15000000000;
          const maxFuryStack = 5;

          let furyAmount = 0;
          if (currentFuryEvent) furyAmount = currentFuryEvent.furyAmount;

          if (attackResult.didHit) {
            furyAmount = Math.min(furyAmount + 1, maxFuryStack);
          } else {
            furyAmount = furyAmount / 2;
          }

          const furyAccuracyBuf = {
            uniqueHrid: FURY_ACCURACY_UNIQUE_HRID,
            typeHrid: '/buff_types/fury_accuracy',
            ratioBoost: furyAmount * source.combatDetails.combatStats.fury,
            ratioBoostLevelBonus: 0,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            duration: furyExpireTime,
          };
          const furyDamageBuf = {
            uniqueHrid: FURY_DAMAGE_UNIQUE_HRID,
            typeHrid: '/buff_types/fury_damage',
            ratioBoost: furyAmount * source.combatDetails.combatStats.fury,
            ratioBoostLevelBonus: 0,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            duration: furyExpireTime,
          };

          if (furyAmount > 0) {
            let furyExpirationEvent = new FuryExpirationEvent(this.simulationTime + furyExpireTime, furyAmount, source);
            this.eventQueue.addEvent(furyExpirationEvent);

            source.addBuff(furyAccuracyBuf, this.simulationTime);
            source.addBuff(furyDamageBuf, this.simulationTime);
          } else {
            source.removeBuffByUniqueHrid(FURY_ACCURACY_UNIQUE_HRID, null);
            source.removeBuffByUniqueHrid(FURY_DAMAGE_UNIQUE_HRID, null);
          }
        }

        if (target.combatDetails.combatStats.weaken > 0) {
          const weakenExpireTime = 15000000000;
          source.weakenExpireTime = this.simulationTime + weakenExpireTime;
          let currentWeakenEvent = this.eventQueue.getMatching(
            (event) => event.type == WeakenExpirationEvent.type && event.source == source,
          );
          let weakenAmount = 0;
          if (currentWeakenEvent) weakenAmount = currentWeakenEvent.weakenAmount;
          this.eventQueue.clearMatching((event) => event.type == WeakenExpirationEvent.type && event.source == source);
          let weakenExpirationEvent = new WeakenExpirationEvent(
            this.simulationTime + weakenExpireTime,
            weakenAmount,
            source,
          );
          const weakenBuff = {
            uniqueHrid: WEAKEN_UNIQUE_HRID,
            typeHrid: '/buff_types/damage',
            ratioBoost: -1 * target.combatDetails.combatStats.weaken * weakenExpirationEvent.weakenAmount,
            ratioBoostLevelBonus: 0,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            duration: weakenExpireTime,
          };
          source.addBuff(weakenBuff, this.simulationTime);
          this.eventQueue.addEvent(weakenExpirationEvent);
        }

        this.simResult.addAttack(source, target, ability.hrid, attackResult.didHit ? attackResult.damageDone : 'miss');

        if (attackResult.thornDamageDone > 0) {
          this.simResult.addAttack(target, source, attackResult.thornType, attackResult.thornDamageDone);
        }
        if (this.logCombatEvents && this.zone?.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {
          const log = this.buildCombatLog(target, attackResult.thornType, source, attackResult.thornDamageDone);
          this.addToWipeLogs(log);
        }

        if (target.combatDetails.combatStats.retaliation > 0) {
          this.simResult.addAttack(
            target,
            source,
            'retaliation',
            attackResult.retaliationDamageDone > 0 ? attackResult.retaliationDamageDone : 'miss',
          );
        }
        if (this.logCombatEvents && this.zone?.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {
          const log = this.buildCombatLog(target, 'retaliation', source, attackResult.retaliationDamageDone);
          this.addToWipeLogs(log);
        }

        if (target.combatDetails.currentHitpoints == 0) {
          this.eventQueue.clearEventsForUnit(target);
          this.recordUnitDeath(target);
          if (!target.isPlayer) {
            this.simResult.updateTimeSpentAlive(target.hrid, false, this.simulationTime);
          }
        }

        if (attackResult.didHit && abilityEffect.pierceChance > Math.random()) {
          continue;
        }
      }

      if (parryTarget) {
        break;
      }

      if (abilityEffect.targetType == 'enemy') {
        break;
      }
    }
  }

  processAbilityHealEffect(source, ability, abilityEffect) {
    if (abilityEffect.targetType == 'allAllies') {
      let targets = source.isPlayer ? this.players : this.enemies;
      for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
        let amountHealed = CombatUtilities.processHeal(source, abilityEffect, target);

        this.simResult.addHitpointsGained(target, ability.hrid, amountHealed);
      }
      return;
    }

    if (abilityEffect.targetType == 'lowestHpAlly') {
      let targets = source.isPlayer ? this.players : this.enemies;
      let healTarget;
      for (const target of targets.filter((unit) => unit && unit.combatDetails.currentHitpoints > 0)) {
        if (!healTarget) {
          healTarget = target;
          continue;
        }
        // 按HP百分比比较，选择百分比最低的目标
        const targetHpPercent = target.combatDetails.currentHitpoints / target.combatDetails.maxHitpoints;
        const healTargetHpPercent = healTarget.combatDetails.currentHitpoints / healTarget.combatDetails.maxHitpoints;
        if (targetHpPercent < healTargetHpPercent) {
          healTarget = target;
        }
      }

      if (healTarget) {
        let amountHealed = CombatUtilities.processHeal(source, abilityEffect, healTarget);

        this.simResult.addHitpointsGained(healTarget, ability.hrid, amountHealed);
      }
      return;
    }

    if (abilityEffect.targetType != 'self') {
      throw new Error('Unsupported target type for heal ability effect: ' + ability.hrid);
    }

    let amountHealed = CombatUtilities.processHeal(source, abilityEffect, source);

    this.simResult.addHitpointsGained(source, ability.hrid, amountHealed);
  }

  processAbilityReviveEffect(source, ability, abilityEffect) {
    if (abilityEffect.targetType != 'deadAlly') {
      throw new Error('Unsupported target type for revive ability effect: ' + ability.hrid);
    }

    let targets = source.isPlayer ? this.players : this.enemies;
    let reviveTarget = targets.find((unit) => unit && unit.combatDetails.currentHitpoints <= 0);

    if (reviveTarget) {
      this.eventQueue.clearMatching(
        (event) => event.type == PlayerRespawnEvent.type && event.hrid == reviveTarget.hrid,
      );

      // 死亡快照是临时的，直到遭遇战结束检查确认该单元
      // 仍然死亡。在此之前复活，
      // 不得为非最终死亡保留经验收益。
      if (!reviveTarget.isPlayer && !this.experienceAwardedEnemies.has(reviveTarget)) {
        this.enemyDeathSnapshots.delete(reviveTarget);
      }

      reviveTarget.removeExpiredBuffs(this.simulationTime);

      let amountHealed = CombatUtilities.processRevive(source, abilityEffect, reviveTarget);

      this.simResult.addHitpointsGained(reviveTarget, ability.hrid, amountHealed);

      this.addNextAttackEvent(reviveTarget);

      if (!source.isPlayer) {
        this.simResult.updateTimeSpentAlive(reviveTarget.hrid, true, this.simulationTime);
      }
    }
    return;
  }

  processAbilityPromoteEffect(source, ability, abilityEffect) {
    const promotionHrids = ['/monsters/enchanted_rook', '/monsters/enchanted_knight', '/monsters/enchanted_bishop'];
    let randomPromotionIndex = Math.floor(Math.random() * promotionHrids.length);
    return new Monster(promotionHrids[randomPromotionIndex], source.difficultyTier);
  }

  processAbilitySpendHpEffect(source, ability, abilityEffect) {
    if (abilityEffect.targetType != 'self') {
      throw new Error('Unsupported target type for spend hp ability effect: ' + ability.hrid);
    }

    let hpSpent = CombatUtilities.processSpendHp(source, abilityEffect);

    this.simResult.addHitpointsSpent(source, ability.hrid, hpSpent);
  }

  checkEncounterEnd() {
    if (!this.minimalResult && this.enemies) {
      let deadEnemies = this.enemies.filter(
        (enemy) => enemy.combatDetails.currentHitpoints <= 0 && !this.experienceAwardedEnemies.has(enemy),
      );
      if (deadEnemies.length > 0) {
        deadEnemies.forEach((enemy) => {
          // 正常事件会在本方法运行前记录精确时间戳。
          // 仅调整了生命值时，回退逻辑让直接/手动调用
          // 保持确定性。
          this.finalizeEnemyExperience(enemy);
        });
      }
    }

    let encounterEnded = false;
    let encounterCleared = false;

    if (this.enemies && !this.enemies.some((enemy) => enemy.combatDetails.currentHitpoints > 0)) {
      this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
      // this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
      let enemyRespawnEvent = new EnemyRespawnEvent(this.calculateNextEncounterRespawnTime());
      this.eventQueue.addEvent(enemyRespawnEvent);

      if (
        !this.minimalResult &&
        this.enemies.some(
          (enemy) => enemy.combatDetails.currentHitpoints <= 0 && !this.experienceAwardedEnemies.has(enemy),
        )
      ) {
        console.warn('WARN: Some enemies have no valid experience rate');
      }

      // 只有在遭遇战中所有怪物都已死亡后才提交击杀快照。
      // 之后的副本团灭不得保留它们。
      this.commitPendingExperience();
      encounterCleared = true;
      this.enemies = null;

      if (this.zone?.isDungeon) {
        this.simResult.updateTimeSpentAlive(
          '#' + (this.zone.encountersKilled - 1).toString(),
          false,
          this.simulationTime,
        );
        if (this.zone.encountersKilled > this.zone.dungeonSpawnInfo.maxWaves) {
          this.simResult.updateDungenonFinish('#1', this.simulationTime);
          this.simResult.lastDungeonFinishTime = this.simulationTime;
        }
      }
      this.simResult.addEncounterEnd();
      this.simResult.lastEncounterFinishTime = this.simulationTime;

      encounterEnded = true;
    }

    this.players.forEach((player) => {
      if (
        player.combatDetails.currentHitpoints <= 0 &&
        !this.eventQueue.containsEventOfTypeAndHrid(PlayerRespawnEvent.type, player.hrid)
      ) {
        if (this.zone && !this.zone.isDungeon) {
          let playerRespawnEvent = new PlayerRespawnEvent(this.simulationTime + 150 * ONE_SECOND, player.hrid);
          this.eventQueue.addEvent(playerRespawnEvent);
        }
        this.simResult.addRanOutOfManaCount(player, false, this.simulationTime);
      }
    });

    if (!this.players.some((player) => player.combatDetails.currentHitpoints > 0)) {
      if (this.zone) {
        if (this.zone.isDungeon) {
          if (this.logCombatEvents) {
            console.log(
              'All Players died at wave #' +
                (this.zone.encountersKilled - 1) +
                ' with ememies: ' +
                this.enemies
                  .map(
                    (enemy) =>
                      enemy.hrid +
                      '(' +
                      ((enemy.combatDetails.currentHitpoints * 100) / enemy.combatDetails.maxHitpoints).toFixed(2) +
                      '%)',
                  )
                  .join(', '),
            );

            this.saveWipeLogsToSimResult(this.zone.encountersKilled - 1);
            this.wipeLogs.index = 0;
            this.wipeLogs.count = 0;
          }

          // 地下城团灭：只清除战斗相关事件，保留buff过期检查和CD事件
          this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
          this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
          this.eventQueue.clearEventsOfType(DamageOverTimeEvent.type);
          this.eventQueue.clearEventsOfType(ConsumableTickEvent.type);
          this.eventQueue.clearEventsOfType(RegenTickEvent.type);
          this.eventQueue.clearEventsOfType(EnrageTickEvent.type);
          this.eventQueue.clearEventsOfType(StunExpirationEvent.type);
          this.eventQueue.clearEventsOfType(BlindExpirationEvent.type);
          this.eventQueue.clearEventsOfType(SilenceExpirationEvent.type);
          this.eventQueue.clearEventsOfType(AwaitCooldownEvent.type);
          this.discardPendingExperience();
          this.enemies = null;

          let combatStartEvent = new CombatStartEvent(this.simulationTime + RESTART_INTERVAL);
          this.eventQueue.addEvent(combatStartEvent);
        } else {
          this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
          this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);
        }
      }

      encounterEnded = true;
      this.allPlayersDead = true;
    }

    if (this.labyrinth) {
      const labyrinthTimedOut = this.labyrinth.checkTimeout(this.simulationTime);
      if (labyrinthTimedOut || encounterEnded) {
        if (!encounterCleared) {
          this.discardPendingExperience();
        }
        this.enemies = null;
        encounterEnded = true;
        this.eventQueue.clear();
        let combatStartEvent = new CombatStartEvent(this.simulationTime);
        this.eventQueue.addEvent(combatStartEvent);
      }
    }

    return encounterEnded;
  }

  calculateNextEncounterRespawnTime() {
    return this.simulationTime + 3 * ONE_SECOND;
  }
}

export default CombatActionsCore;
