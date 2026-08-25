import CombatUtilities from './combatUtilities';
import AutoAttackEvent from './events/autoAttackEvent';
import DamageOverTimeEvent from './events/damageOverTimeEvent';
import CheckBuffExpirationEvent from './events/checkBuffExpirationEvent';
import CombatStartEvent from './events/combatStartEvent';
import ConsumableTickEvent from './events/consumableTickEvent';
import CooldownReadyEvent from './events/cooldownReadyEvent';
import EnemyRespawnEvent from './events/enemyRespawnEvent';
import EventQueue from './events/eventQueue';
import PlayerRespawnEvent from './events/playerRespawnEvent';
import RegenTickEvent from './events/regenTickEvent';
import StunExpirationEvent from './events/stunExpirationEvent';
import BlindExpirationEvent from './events/blindExpirationEvent';
import SilenceExpirationEvent from './events/silenceExpirationEvent';
import CurseExpirationEvent from './events/curseExpirationEvent';
import WeakenExpirationEvent from './events/weakenExpirationEvent';
import FuryExpirationEvent from './events/furyExpirationEvent';
import EnrageTickEvent from './events/enrageTickEvent';
import ScrollRenewalEvent from './events/scrollRenewalEvent';
import SimResult from './simResult';
import AbilityCastEndEvent from './events/abilityCastEndEvent';
import AwaitCooldownEvent from './events/awaitCooldownEvent';
import Monster from './monster';
import Ability from './ability';
import './dataBuffValidation.js';
import { createCombatScrollBuff, getCombatScrollSourceKey } from './combatScrollBuff.js';
import { BUFF_SOURCE_POLICY, getAbilityBuffSourcePolicy } from './buffSourcePolicy.js';
import { getCombatScrollDefinition, normalizeCombatScrolls } from '../shared/combatScrolls.js';

const ONE_SECOND = 1e9;
const HOT_TICK_INTERVAL = 5 * ONE_SECOND;
const DOT_TICK_INTERVAL = 3 * ONE_SECOND;
const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;
const ENEMY_RESPAWN_INTERVAL = 3 * ONE_SECOND;
const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;
const RESTART_INTERVAL = 3 * ONE_SECOND;
const ENRAGE_TICK_INTERVAL = 60 * ONE_SECOND;
const CURSE_UNIQUE_HRID = '/buff_uniques/curse';
const WEAKEN_UNIQUE_HRID = '/buff_uniques/weaken';
const FURY_ACCURACY_UNIQUE_HRID = '/buff_uniques/fury_accuracy';
const FURY_DAMAGE_UNIQUE_HRID = '/buff_uniques/fury_damage';

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

class CombatSimulator extends EventTarget {
  constructor(players, zone, labyrinth, options = {}) {
    super();
    this.players = players;
    this.zone = zone;
    this.labyrinth = labyrinth;
    this.isGuildTrial = Boolean(options.isGuildTrial || options.simulationContext?.isGuildTrial);
    this.scrollsAllowed = !labyrinth && !this.isGuildTrial;
    this.combatScrollsEnabled = Boolean(options.combatScrollsEnabled);
    this.eventQueue = new EventQueue();
    this.simResult = new SimResult(zone, labyrinth, players.length);
    this.allPlayersDead = false;
    this.enableHpMpVisualization = options.enableHpMpVisualization || false;
    this.simulationTimeLimit = 0;
    this.scrollRuntimeByPlayer = {};
    this.nextScrollRenewalTime = Number.POSITIVE_INFINITY;
    this.experienceAwardedEnemies = new WeakSet();
    // 敌人对象是遭遇战局部的运行时值。将击杀时刻的经验状态
    // 保存在这里，而不是修改它们的战斗字段。
    this.enemyDeathSnapshots = new WeakMap();
    this.invalidExperienceRateWarningKeys = new Set();
    // 经验在怪物死亡时快照，但仅在遭遇战成功清场后才提交。
    // 这保留了遭遇战级别的回滚行为，同时让临时增益
    // （例如智慧卷轴）与击杀时间戳绑定。
    this.pendingExperienceGains = new Map();

    this.wipeLogs = {
      buffer: new Array(200),
      index: 0,
      count: 0,
      maxSize: 200,
    };
  }

  addToWipeLogs(logEntry) {
    const { buffer, maxSize } = this.wipeLogs;

    buffer[this.wipeLogs.index] = logEntry;
    this.wipeLogs.index = (this.wipeLogs.index + 1) % maxSize;
    this.wipeLogs.count = Math.min(this.wipeLogs.count + 1, maxSize);
  }

  logAndResetWipeLogs() {
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
    const { buffer, maxSize, count } = this.wipeLogs;
    const logs = [];

    for (let i = 0; i < count; i++) {
      const idx = (this.wipeLogs.index - count + maxSize + i) % maxSize;
      logs.push(buffer[idx]);
    }

    return logs;
  }

  saveWipeLogsToSimResult(wave) {
    const logs = this.getOrderedWipeLogs();
    this.simResult.addWipeEvent(logs, this.simulationTime, wave);
  }

  initializeScrollRuntime() {
    this.scrollRuntimeByPlayer = {};
    this.nextScrollRenewalTime = Number.POSITIVE_INFINITY;

    for (const player of this.players || []) {
      const playerHrid = String(player?.hrid || '');
      if (!playerHrid) {
        continue;
      }

      const configuredScrolls = normalizeCombatScrolls(player?.combatScrolls || {});
      const stateByItem = {};
      for (const [itemHrid, configuration] of Object.entries(configuredScrolls)) {
        const definition = getCombatScrollDefinition(itemHrid);
        if (!definition) {
          continue;
        }

        const configuredQuantity = configuration?.quantity == null ? null : Number(configuration.quantity);
        const finiteQuantity =
          Number.isSafeInteger(configuredQuantity) && configuredQuantity > 0 ? configuredQuantity : null;
        stateByItem[itemHrid] = {
          player,
          playerHrid,
          itemHrid,
          configuredQuantity: finiteQuantity,
          remaining: finiteQuantity,
          started: false,
          active: false,
          activeStartTime: 0,
          activeUntil: 0,
          accumulatedDurationNs: 0,
          token: 0,
          buffUniqueHrid: String(definition.buff?.uniqueHrid || ''),
        };

        this.simResult.setScrollConfiguration(playerHrid, itemHrid, finiteQuantity);
      }

      this.scrollRuntimeByPlayer[playerHrid] = stateByItem;
    }
  }

  clearScrollRuntimeBuffs() {
    for (const stateByItem of Object.values(this.scrollRuntimeByPlayer || {})) {
      for (const state of Object.values(stateByItem || {})) {
        if (state?.buffUniqueHrid && state.player) {
          state.player.removeBuff({ uniqueHrid: state.buffUniqueHrid }, getCombatScrollSourceKey(state.itemHrid));
        }
      }
    }
  }

  canOpenScroll(state, startTime) {
    if (!this.scrollsAllowed || !this.combatScrollsEnabled || !state || startTime >= this.simulationTimeLimit) {
      return false;
    }
    return state.remaining === null || state.remaining > 0;
  }

  scheduleScrollRenewal(state) {
    if (!state?.active || state.activeUntil >= this.simulationTimeLimit) {
      return;
    }

    this.nextScrollRenewalTime = Math.min(this.nextScrollRenewalTime, state.activeUntil);
    this.eventQueue.addEvent(new ScrollRenewalEvent(state.activeUntil, state.playerHrid, state.itemHrid, state.token));
  }

  openScrollWindow(state, startTime, consumeInventory = true) {
    if (!state || !this.canOpenScroll(state, startTime)) {
      return false;
    }

    const definition = getCombatScrollDefinition(state.itemHrid);
    const durationNs = Number(definition?.durationNs || definition?.duration || 0);
    if (!definition || !Number.isFinite(durationNs) || durationNs <= 0) {
      return false;
    }

    const buff = createCombatScrollBuff(state.itemHrid);
    if (!buff) {
      return false;
    }

    // Buff 实例携带可变的 startTime；始终为每个玩家和每次开启
    // 创建一个新的实例。
    state.player.addBuff(buff, startTime, getCombatScrollSourceKey(state.itemHrid));
    state.started = true;
    state.active = true;
    state.activeStartTime = startTime;
    state.activeUntil = startTime + durationNs;
    state.token += 1;

    if (consumeInventory) {
      if (state.remaining !== null) {
        state.remaining -= 1;
      }
      this.simResult.recordScrollOpen(state.playerHrid, state.itemHrid, {
        configuredQuantity: state.configuredQuantity,
        openedCount: 1,
        exhausted: state.configuredQuantity !== null && state.remaining <= 0,
      });
    }

    this.scheduleScrollRenewal(state);
    return true;
  }

  closeScrollWindow(state, endTime) {
    if (!state?.active) {
      return;
    }

    const boundedEnd = Math.min(Math.max(Number(endTime) || 0, state.activeStartTime), this.simulationTimeLimit);
    const duration = Math.max(0, boundedEnd - state.activeStartTime);
    if (duration > 0) {
      state.accumulatedDurationNs += duration;
      this.simResult.recordScrollWindow(state.playerHrid, state.itemHrid, duration);
    }

    if (state.buffUniqueHrid) {
      state.player.removeBuff({ uniqueHrid: state.buffUniqueHrid }, getCombatScrollSourceKey(state.itemHrid));
    }
    state.active = false;
    state.activeUntil = 0;
    state.activeStartTime = 0;
  }

  restoreActiveScrollBuff(state, currentTime) {
    if (!state?.active || currentTime >= state.activeUntil || !state.buffUniqueHrid) {
      return;
    }

    const sourceKey = getCombatScrollSourceKey(state.itemHrid);
    const hasRegisteredSource = state.player.buffSources?.[state.buffUniqueHrid]?.has(sourceKey);
    if (!hasRegisteredSource) {
      const buff = createCombatScrollBuff(state.itemHrid);
      if (buff) {
        state.player.addBuff(buff, state.activeStartTime, sourceKey);
      }
    }
  }

  syncScrollsToTime(currentTime) {
    const time = Math.max(0, Number(currentTime) || 0);
    this.nextScrollRenewalTime = Number.POSITIVE_INFINITY;

    for (const stateByItem of Object.values(this.scrollRuntimeByPlayer || {})) {
      for (const state of Object.values(stateByItem || {})) {
        if (!state?.started && time < this.simulationTimeLimit) {
          continue;
        }

        if (state.active && time < state.activeUntil) {
          this.restoreActiveScrollBuff(state, time);
          if (state.activeUntil < this.simulationTimeLimit) {
            this.nextScrollRenewalTime = Math.min(this.nextScrollRenewalTime, state.activeUntil);
          }
          continue;
        }

        while (state.active && time >= state.activeUntil) {
          const renewalTime = state.activeUntil;
          this.closeScrollWindow(state, renewalTime);
          if (!this.canOpenScroll(state, renewalTime)) {
            break;
          }
          this.openScrollWindow(state, renewalTime, true);
        }
      }
    }
  }

  syncScrollsIfDue(currentTime) {
    const time = Math.max(0, Number(currentTime) || 0);
    if (!Number.isFinite(this.nextScrollRenewalTime) || time < this.nextScrollRenewalTime) {
      return false;
    }

    this.syncScrollsToTime(time);
    return true;
  }

  activateInitialScrolls() {
    if (!this.scrollsAllowed || !this.combatScrollsEnabled || this.simulationTimeLimit <= 0) {
      return;
    }

    for (const stateByItem of Object.values(this.scrollRuntimeByPlayer || {})) {
      for (const state of Object.values(stateByItem || {})) {
        if (!state.started) {
          this.openScrollWindow(state, 0, true);
        }
      }
    }
  }

  processScrollRenewalEvent(event) {
    const state = this.scrollRuntimeByPlayer?.[event?.playerHrid]?.[event?.itemHrid];
    if (!state || !state.active || event.token !== state.token || event.time < state.activeUntil) {
      return;
    }
    // processEvent 的 O(1) 到期时间守卫通常先处理这种情况。当此处理器
    // 被直接调用，或外部队列变更使缓存的下一续期时间过期时，
    // 防御性回退仍然有用。当守卫耗尽有限的卷轴
    // 库存后，`state.active` 可防止第二次全量同步。
    this.syncScrollsToTime(event.time);
  }

  finalizeScrollUsage(simulationTimeLimit) {
    const limit = Math.max(0, Number(simulationTimeLimit) || 0);
    for (const stateByItem of Object.values(this.scrollRuntimeByPlayer || {})) {
      for (const state of Object.values(stateByItem || {})) {
        if (state.active) {
          this.closeScrollWindow(state, limit);
        }
        const entry = this.simResult.scrollUsage?.byPlayer?.[state.playerHrid]?.[state.itemHrid];
        if (entry) {
          entry.exhausted = state.configuredQuantity !== null && entry.openedCount >= state.configuredQuantity;
        }
      }
    }
  }

  recordUnitDeath(unit) {
    this.simResult.addDeath(unit);
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
    const gains = this.simResult.calculateExperienceGain(player, experience);
    if (!gains || !player?.hrid) {
      return;
    }

    this.appendPendingExperienceGains({ [player.hrid]: gains });
  }

  commitPendingExperience() {
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

  dispatchProgress(progress) {
    const normalizedProgress = Math.max(0, Math.min(Number(progress) || 0, 1));
    this.dispatchEvent(
      new CustomEvent('progress', {
        detail: {
          zone: this.zone?.hrid,
          difficultyTier: this.zone?.difficultyTier,
          labyrinth: this.labyrinth?.hrid,
          roomLevel: this.labyrinth?.roomLevel,
          progress: normalizedProgress,
          timeSeriesData: this.enableHpMpVisualization ? this.simResult.timeSeriesData : null,
        },
      }),
    );
  }

  async simulate(simulationTimeLimit) {
    const normalizedSimulationTimeLimit = Math.max(0, Number(simulationTimeLimit) || 0);
    this.simulationTimeLimit = normalizedSimulationTimeLimit;
    this.reset();
    // 在处理任何事件之前发布重置状态。这使零长度模拟
    // 可观察为 [0, 1]，而不是直接跳到
    // 最终的进度通知。
    this.dispatchProgress(0);

    let ticks = 0;

    let combatStartEvent = new CombatStartEvent(0);
    this.eventQueue.addEvent(combatStartEvent);

    while (this.simulationTime < normalizedSimulationTimeLimit) {
      const nextEventPreview = this.eventQueue.peekNextEvent();
      // 模拟时间范围是半开区间 [0, limit)：处于或晚于
      // limit 的事件在本轮之外，不会被处理。
      // 先窥视还可防止当下一排队事件晚于请求时长时
      // 发生旧版"多处理一个事件"的越界。
      if (!nextEventPreview || nextEventPreview.time >= normalizedSimulationTimeLimit) {
        this.simulationTime = normalizedSimulationTimeLimit;
        break;
      }

      let nextEvent = this.eventQueue.getNextEvent();
      await this.processEvent(nextEvent);

      ticks++;
      if (ticks === 1000) {
        ticks = 0;
        // 收集HP/MP时序数据
        if (this.enableHpMpVisualization) {
          this.simResult.addTimeSeriesSnapshot(this.simulationTime, this.players);
        }
        this.dispatchProgress(
          normalizedSimulationTimeLimit > 0 ? Math.min(this.simulationTime / normalizedSimulationTimeLimit, 1) : 1,
        );
      }
    }

    // for (let i = 0; i < this.simResult.timeSpentAlive.length; i++) {
    //     if (this.simResult.timeSpentAlive[i].alive == true) {
    //         this.simResult.updateTimeSpentAlive(this.simResult.timeSpentAlive[i].name, false, simulationTimeLimit);
    //     }
    // }

    this.simResult.isDungeon = this.zone?.isDungeon ?? false;
    if (this.zone && this.simResult.isDungeon) {
      console.log('Timeout now at wave #' + (this.zone.encountersKilled - 1));

      this.simResult.dungeonsCompleted = this.zone.dungeonsCompleted;
      this.simResult.dungeonsFailed = this.zone.dungeonsFailed;
      if (this.simResult.dungeonsCompleted < 1) {
        this.simResult.maxWaveReached = 0;
        for (let i = 1; i <= this.zone.dungeonSpawnInfo.maxWaves; i++) {
          let waveName = '#' + i.toString();
          const idx = this.simResult.timeSpentAlive.findIndex((e) => e.name === waveName);
          if (idx == -1 || this.simResult.timeSpentAlive[idx].count == 0) {
            break;
          }
          this.simResult.maxWaveReached = i;
        }
      } else {
        this.simResult.maxWaveReached = this.zone.dungeonSpawnInfo.maxWaves;
      }
    }
    // 半开时间范围之内的续期事件已由队列处理。
    // 直接关闭当前窗口，使结束路径既不恢复增益，
    // 也不调度历史的续期。
    this.finalizeScrollUsage(normalizedSimulationTimeLimit);
    // 模拟可能在遭遇战中途停止。不要将
    // 该次遭遇战的死亡快照留在可复用的模拟器实例上。
    this.discardPendingExperience();
    this.simResult.simulatedTime = normalizedSimulationTimeLimit;

    for (let i = 0; i < this.players.length; i++) {
      this.simResult.setDropRateMultipliers(this.players[i]);
      this.simResult.setManaUsed(this.players[i]);
    }

    if (this.zone?.isDungeon) {
      Object.entries(this.zone.dungeonSpawnInfo.fixedSpawnsMap).forEach(([wave, monsters]) => {
        let waveName = '#' + wave.toString();
        monsters.forEach((monster) => {
          waveName += ',' + monster.combatMonsterHrid;
        });
        this.simResult.bossSpawns.push(waveName);
      });
    }
    if (this.zone?.isDungeon && this.zone.monsterSpawnInfo.bossSpawns) {
      for (const boss of this.zone.monsterSpawnInfo.bossSpawns) {
        this.simResult.bossSpawns.push(boss.combatMonsterHrid);
      }
    }

    // 时间范围中断可能发生在周期 tick 到达 1000 事件边界之前。
    // 在所有收尾工作完成后发出最终的进度通知，
    // 使其先于结果消息，又不会超前于最后的状态更新。
    this.dispatchProgress(1);

    return this.simResult;
  }

  reset() {
    this.tempDungeonCount = 0;
    this.simulationTime = 0;
    this.eventQueue.clear();
    // 模拟器实例可能被复用。运行时库存从不可变的玩家配置
    // 重建，上一轮运行中的定时增益不允许
    // 泄漏到 t=0 的下一次开启。
    this.clearScrollRuntimeBuffs();
    this.simResult = new SimResult(this.zone, this.labyrinth, this.players.length);
    this.simResult.setScrollUsageContext(
      this.scrollsAllowed,
      this.isGuildTrial ? 'guild_trial' : this.labyrinth ? 'labyrinth' : '',
    );
    this.simResult.setScrollUsageDisabled(!this.combatScrollsEnabled);
    this.simulationTimeLimit = Math.max(0, Number(this.simulationTimeLimit) || 0);
    this.scrollRuntimeByPlayer = {};
    this.experienceAwardedEnemies = new WeakSet();
    this.enemyDeathSnapshots = new WeakMap();
    this.invalidExperienceRateWarningKeys = new Set();
    this.pendingExperienceGains = new Map();
    this.initializeScrollRuntime();
  }

  async processEvent(event) {
    if (!event) {
      return;
    }
    this.simulationTime = event.time;
    this.syncScrollsIfDue(this.simulationTime);

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
      case ScrollRenewalEvent.type:
        this.processScrollRenewalEvent(event);
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
      case WeakenExpirationEvent.type:
        this.processWeakenExpirationEvent(event);
        break;
      case FuryExpirationEvent.type:
        this.processFuryExpirationEvent(event);
        break;
      case EnrageTickEvent.type:
        this.processEnrageTickEvent(event);
        break;
      case AbilityCastEndEvent.type:
        this.tryUseAbility(event.source, event.ability);
        break;
      case AwaitCooldownEvent.type:
        this.addNextAttackEvent(event.source);
        break;
      case CooldownReadyEvent.type:
        // 仅用于检查触发器
        break;
    }

    this.checkTriggers();
  }

  processCombatStartEvent(event) {
    for (let i = 0; i < this.players.length; i++) {
      if (event.time === 0) {
        // 首次战斗开始事件
        this.players[i].generatePermanentBuffs();
      }
      if (this.labyrinth) {
        this.players[i].reset();
      } else {
        this.players[i].reset(this.simulationTime);
      }
    }

    if (event.time === 0) {
      // 第一次重置清除普通战斗增益。卷轴只在这次重置之后、
      // 首次遭遇战/攻击之前开启。
      this.activateInitialScrolls();
    } else {
      // 副本重启会让卷轴计时继续运行。玩家重置后
      // 重新挂接仍处于活动状态的窗口，而不消耗
      // 第二个道具。
      this.syncScrollsToTime(this.simulationTime);
    }

    let regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);
    this.eventQueue.addEvent(regenTickEvent);

    this.startNewEncounter();
  }

  processPlayerRespawnEvent(event) {
    let respawningPlayer = this.players.find((player) => player.hrid === event.hrid);
    respawningPlayer.combatDetails.currentHitpoints = respawningPlayer.combatDetails.maxHitpoints;
    respawningPlayer.combatDetails.currentManapoints = respawningPlayer.combatDetails.maxManapoints;
    respawningPlayer.clearBuffs();
    this.syncScrollsToTime(this.simulationTime);
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

  calculateNextEncounterRespawnTime() {
    return this.simulationTime + ENEMY_RESPAWN_INTERVAL;
  }

  startNewEncounter() {
    if (this.allPlayersDead) {
      this.allPlayersDead = false;
      if (this.zone) {
        this.zone.failWave();
      }
    }

    this.encounterStartTime = this.simulationTime;

    if (this.zone) {
      if (!this.zone.isDungeon) {
        this.enemies = this.zone.getRandomEncounter();
      } else {
        this.enemies = this.zone.getNextWave();
        this.simResult.updateTimeSpentAlive(
          '#' + (this.zone.encountersKilled - 1).toString(),
          true,
          this.simulationTime,
        );
        let currentDungeonCount = this.zone.dungeonsCompleted;
        if (currentDungeonCount > this.tempDungeonCount) {
          this.tempDungeonCount = currentDungeonCount;
          for (let i = 0; i < this.players.length; i++) {
            this.players[i].combatDetails.currentHitpoints = this.players[i].combatDetails.maxHitpoints;
            this.players[i].combatDetails.currentManapoints = this.players[i].combatDetails.maxManapoints;
            // this.simResult.playerRanOutOfMana[this.players[i].hrid] = false;
          }
        }
      }
    }

    if (this.labyrinth) {
      this.enemies = this.labyrinth.getMonster();
      this.labyrinth.updateEnconterStartTime(this.simulationTime);
    }

    this.enemies.forEach((enemy) => {
      enemy.reset(this.simulationTime);
      this.simResult.updateTimeSpentAlive(enemy.hrid, true, this.simulationTime);
    });

    this.eventQueue.clearEventsOfType(EnrageTickEvent.type);
    let enrageTickEvent = new EnrageTickEvent(this.simulationTime + ENRAGE_TICK_INTERVAL, ENRAGE_TICK_INTERVAL);
    this.eventQueue.addEvent(enrageTickEvent);
    this.enrageBeginTime = this.simulationTime;

    this.eventQueue.clearEventsOfType(AbilityCastEndEvent.type);

    // 提前检查trigger让吃喝先跑
    this.checkTriggers();

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
            }*/
      this.addNextAttackEvent(unit);
    }
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

  processAutoAttackEvent(event) {
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
        aliveTargets.forEach((player) => {
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
      }
      let source = event.source;

      let parryTarget = this.checkParry(targets);
      if (parryTarget) {
        target = source;
        source = parryTarget;
      }

      let attackResult = CombatUtilities.processAttack(source, target);
      if (this.zone?.isDungeon && target.isPlayer && attackResult.didHit && attackResult.damageDone > 0) {
        const log = this.generateCombatLog(source, 'autoAttack', target, attackResult);
        this.addToWipeLogs(log);
      }

      let mayhem = source.combatDetails.combatStats.mayhem > Math.random();

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
        let currentWeakenEvent = this.eventQueue.getMatching(
          (event) => event.type == WeakenExpirationEvent.type && event.source == source,
        );
        let weakenAmount = 0;
        if (currentWeakenEvent) weakenAmount = currentWeakenEvent.weakenAmount;
        this.eventQueue.clearMatching((event) => event.type == WeakenExpirationEvent.type && event.source == source);
        let weakenExpirationEvent = new WeakenExpirationEvent(this.simulationTime + 15000000000, weakenAmount, source);
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

      if (!mayhem || (mayhem && attackResult.didHit) || (mayhem && i == aliveTargets.length - 1)) {
        let attackType = 'autoAttack';
        if (parryTarget) attackType = 'parry';
        this.simResult.addAttack(source, target, 'autoAttack', attackResult.didHit ? attackResult.damageDone : 'miss');
      }

      if (attackResult.lifeStealHeal > 0) {
        this.simResult.addHitpointsGained(source, 'lifesteal', attackResult.lifeStealHeal);
      }

      if (attackResult.manaLeechMana > 0) {
        this.simResult.addManapointsGained(source, 'manaLeech', attackResult.manaLeechMana);
      }

      if (attackResult.thornDamageDone > 0) {
        this.simResult.addAttack(target, source, attackResult.thornType, attackResult.thornDamageDone);
      }
      if (this.zone?.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {
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
      if (this.zone?.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {
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

      // 可能死于反伤伤害
      if (
        source.combatDetails.currentHitpoints == 0 &&
        (attackResult.thornDamageDone != 0 || attackResult.retaliationDamageDone != 0)
      ) {
        this.eventQueue.clearEventsForUnit(source);
        this.recordUnitDeath(source);
        if (!source.isPlayer) {
          this.simResult.updateTimeSpentAlive(source.hrid, false, this.simulationTime);
        }
        break;
      }

      if (mayhem && !attackResult.didHit) {
        continue;
      }

      if (!attackResult.didHit || parryTarget || source.combatDetails.combatStats.pierce <= Math.random()) {
        break;
      }
    }

    if (!this.checkEncounterEnd()) {
      this.addNextAttackEvent(event.source);
    }
  }

  checkEncounterEnd() {
    if (this.enemies) {
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
          let playerRespawnEvent = new PlayerRespawnEvent(this.simulationTime + PLAYER_RESPAWN_INTERVAL, player.hrid);
          this.eventQueue.addEvent(playerRespawnEvent);
        }
        this.simResult.addRanOutOfManaCount(player, false, this.simulationTime);
      }
    });

    if (!this.players.some((player) => player.combatDetails.currentHitpoints > 0)) {
      if (this.zone) {
        if (this.zone.isDungeon) {
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

  addNextAttackEvent(source) {
    if (
      this.eventQueue.getMatching(
        (event) =>
          (event.type == AbilityCastEndEvent.type || event.type == AutoAttackEvent.type) && event.source == source,
      )
    ) {
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

  processConsumableTickEvent(event) {
    if (event.consumable.hitpointRestore > 0) {
      let tickValue = CombatUtilities.calculateTickValue(
        event.consumable.hitpointRestore,
        event.totalTicks,
        event.currentTick,
      );
      let hitpointsAdded = event.source.addHitpoints(tickValue);
      this.simResult.addHitpointsGained(event.source, event.consumable.hrid, hitpointsAdded);
    }

    if (event.consumable.manapointRestore > 0) {
      let tickValue = CombatUtilities.calculateTickValue(
        event.consumable.manapointRestore,
        event.totalTicks,
        event.currentTick,
      );
      let manapointsAdded = event.source.addManapoints(tickValue);
      this.simResult.addManapointsGained(event.source, event.consumable.hrid, manapointsAdded);

      // 空蓝（oom）时检查技能触发器
      if (event.source.isOutOfMana) {
        let awaitCooldownEvent = new AwaitCooldownEvent(this.simulationTime, event.source);
        this.eventQueue.addEvent(awaitCooldownEvent);
      }
    }

    if (event.currentTick < event.totalTicks) {
      let consumableTickEvent = new ConsumableTickEvent(
        this.simulationTime + HOT_TICK_INTERVAL,
        event.source,
        event.consumable,
        event.totalTicks,
        event.currentTick + 1,
      );
      this.eventQueue.addEvent(consumableTickEvent);
    }
  }

  processDamageOverTimeTickEvent(event) {
    let tickDamage = CombatUtilities.calculateTickValue(event.damage, event.totalTicks, event.currentTick);
    let damage = Math.min(tickDamage, event.target.combatDetails.currentHitpoints);

    event.target.combatDetails.currentHitpoints -= damage;
    this.simResult.addAttack(event.sourceRef, event.target, 'damageOverTime', damage);

    if (this.zone?.isDungeon) {
      const log = this.buildCombatLog('', 'damageOverTime', event.target, damage);
      this.addToWipeLogs(log);
    }

    if (event.currentTick < event.totalTicks) {
      let damageOverTimeTickEvent = new DamageOverTimeEvent(
        this.simulationTime + DOT_TICK_INTERVAL,
        event.sourceRef,
        event.target,
        event.damage,
        event.totalTicks,
        event.currentTick + 1,
        event.combatStyleHrid,
      );
      this.eventQueue.addEvent(damageOverTimeTickEvent);
    }

    if (event.target.combatDetails.currentHitpoints == 0) {
      this.eventQueue.clearEventsForUnit(event.target);
      this.recordUnitDeath(event.target);
      if (!event.target.isPlayer) {
        this.simResult.updateTimeSpentAlive(event.target.hrid, false, this.simulationTime);
      }
    }

    this.checkEncounterEnd();
  }

  processRegenTickEvent(event) {
    let units = [...this.players];

    // 敌人的回复（regen）始终设为 0，忽略触发时间
    // if (this.enemies) {
    //     units.push(...this.enemies);
    // }

    for (const unit of units) {
      if (unit.combatDetails.currentHitpoints <= 0) {
        continue;
      }

      let hitpointRegen = Math.floor(unit.combatDetails.maxHitpoints * unit.combatDetails.combatStats.hpRegenPer10);
      let hitpointsAdded = unit.addHitpoints(hitpointRegen);
      this.simResult.addHitpointsGained(unit, 'regen', hitpointsAdded);

      let manapointRegen = Math.floor(unit.combatDetails.maxManapoints * unit.combatDetails.combatStats.mpRegenPer10);
      let manapointsAdded = unit.addManapoints(manapointRegen);
      this.simResult.addManapointsGained(unit, 'regen', manapointsAdded);

      // 空蓝（oom）时检查技能触发器
      if (unit.isOutOfMana) {
        let awaitCooldownEvent = new AwaitCooldownEvent(this.simulationTime, unit);
        this.eventQueue.addEvent(awaitCooldownEvent);
      }
    }

    let regenTickEvent = new RegenTickEvent(this.simulationTime + REGEN_TICK_INTERVAL);
    this.eventQueue.addEvent(regenTickEvent);
  }

  processCheckBuffExpirationEvent(event) {
    // 技能增益事件携带增益的 uniqueHrid，因此只让该注册过期，
    // 而不是扫掉单元上每个 buffSource（5 人全光环
    // 队伍每个单元可注册 56+ 个源）。这里刻意不查询
    // sourceKey：事件拥有 uniqueHrid 的生命周期，
    // 同一 uniqueHrid 在同一时间戳过期的兄弟源
    // 有自己的事件（稍后为空操作）。
    // 消耗品事件构造时不带这些字段，而激怒增益
    // 根本没有过期事件；它们仍依赖全量
    // 扫描清理任何已过期的注册。
    if (event.buffUniqueHrid != null) {
      event.source.removeExpiredBuffByUniqueHrid(event.buffUniqueHrid, this.simulationTime);
    } else {
      event.source.removeExpiredBuffs(this.simulationTime);
    }
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

  processStunExpirationEvent(event) {
    event.source.isStunned = false;
    this.addNextAttackEvent(event.source);
  }

  processBlindExpirationEvent(event) {
    event.source.isBlinded = false;
    this.addNextAttackEvent(event.source);
  }

  processSilenceExpirationEvent(event) {
    event.source.isSilenced = false;
  }

  processCurseExpirationEvent(event) {
    // 事件拥有诅咒的生命周期。不要仅仅因为诅咒到达过期时间
    // 就从目标上扫掉无关的增益。
    event.source.removeExpiredBuffByUniqueHrid(CURSE_UNIQUE_HRID, this.simulationTime);
  }

  processWeakenExpirationEvent(event) {
    // 事件拥有虚弱（weaken）的生命周期。不要仅仅因为虚弱到达过期时间
    // 就从攻击者身上扫掉无关的增益。
    event.source.removeExpiredBuffByUniqueHrid(WEAKEN_UNIQUE_HRID, this.simulationTime);
  }

  processFuryExpirationEvent(event) {
    // 事件拥有狂暴（fury）的生命周期。不要仅仅因为狂暴到达过期时间
    // 就从来源身上扫掉无关的增益。
    event.source.removeExpiredBuffByUniqueHrid(FURY_ACCURACY_UNIQUE_HRID, this.simulationTime);
    event.source.removeExpiredBuffByUniqueHrid(FURY_DAMAGE_UNIQUE_HRID, this.simulationTime);
  }

  processEnrageTickEvent(event) {
    if (!this.enemies) return;
    const maxEnrageStack = 10;
    this.enemies
      .filter((enemy) => enemy.combatDetails.currentHitpoints > 0)
      .forEach((enemy) => {
        const enrageTime = Number(enemy.enrageTime);
        // 激怒时间为非正数的敌人永远不会激怒——默认的
        // combatUnit 字段为 0，缺失/非数值的值
        // 会把层数计算变成 Infinity 或 NaN
        // （立即满层，或 addBuff 校验崩溃）。
        if (!(enrageTime > 0)) {
          return;
        }

        let nowStack = Math.min(maxEnrageStack, Math.floor(event.encounterTime / enrageTime));

        if (nowStack <= 0) {
          return;
        }

        const enrageDamageBuff = {
          uniqueHrid: '/buff_uniques/enrage_damage',
          typeHrid: '/buff_types/damage',
          ratioBoost: nowStack * 0.1,
          ratioBoostLevelBonus: 0,
          flatBoost: 0,
          flatBoostLevelBonus: 0,
          duration: ENRAGE_TICK_INTERVAL,
        };
        const enrageAccuracyBuff = {
          uniqueHrid: '/buff_uniques/enrage_accuracy',
          typeHrid: '/buff_types/accuracy',
          ratioBoost: nowStack * 0.1,
          ratioBoostLevelBonus: 0,
          flatBoost: 0,
          flatBoostLevelBonus: 0,
          duration: ENRAGE_TICK_INTERVAL,
        };
        // 两种激怒增益刻意使用默认源键：
        // buffSources 先按 uniqueHrid 分桶，因此伤害与
        // 命中率保持为独立注册，不会互相覆盖。
        enemy.addBuff(enrageDamageBuff, this.simulationTime);
        enemy.addBuff(enrageAccuracyBuff, this.simulationTime);

        this.simResult.maxEnrageStack = Math.max(this.simResult.maxEnrageStack, nowStack);
      });

    let enrageTickEvent = new EnrageTickEvent(
      this.simulationTime + ENRAGE_TICK_INTERVAL,
      event.encounterTime + ENRAGE_TICK_INTERVAL,
    );
    this.eventQueue.addEvent(enrageTickEvent);
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
        this.simulationTime + HOT_TICK_INTERVAL,
        source,
        consumable,
        consumable.recoveryDuration / HOT_TICK_INTERVAL,
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
  // （不调度事件、不记录 simResult），因此实时施法路径
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

        if (this.zone?.isDungeon && target.isPlayer && attackResult.didHit && attackResult.damageDone > 0) {
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
            this.simulationTime + DOT_TICK_INTERVAL,
            source,
            target,
            attackResult.damageDone * abilityEffect.damageOverTimeRatio,
            abilityEffect.damageOverTimeDuration / DOT_TICK_INTERVAL,
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
            uniqueHrid: '/buff_uniques/curse',
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
        if (this.zone?.isDungeon && attackResult.thornDamageDone > 0 && source.isPlayer) {
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
        if (this.zone?.isDungeon && attackResult.retaliationDamageDone > 0 && source.isPlayer) {
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
}

export default CombatSimulator;
