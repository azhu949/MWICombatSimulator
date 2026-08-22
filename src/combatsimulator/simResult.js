import combatStyleDetailMap from './data/combatStyleDetailMap.json';

class SimResult {
  constructor(zone, labyrinth, numberOfPlayers) {
    this.deaths = {};
    this.experienceGained = {};
    this.encounters = 0;
    this.attacks = {};
    this.consumablesUsed = {};
    this.hitpointsGained = {};
    this.manapointsGained = {};
    this.debuffOnLevelGap = {};
    // Timed combat scrolls are intentionally kept separate from ordinary
    // consumables.  A scroll is not a market expense and its effect may
    // change during a simulation, so the result records usage windows
    // independently from the final stat snapshot below.
    this.scrollUsage = {
      allowed: !labyrinth,
      ignoredReason: labyrinth ? 'labyrinth' : '',
      disabled: false,
      byPlayer: {},
    };

    // A final drop multiplier is not sufficient for a long simulation
    // containing expiring scrolls.  CombatSimulator can append one bucket
    // per (player, monster, stat signature) and the profit estimator will
    // use these buckets when present, while retaining the legacy fallback
    // for older serialized results.
    this.dropContextBuckets = {};
    this.dropRateMultiplier = {};
    this.rareFindMultiplier = {};
    this.combatDropQuantity = {};
    this.playerRanOutOfMana = {
      player1: false,
      player2: false,
      player3: false,
      player4: false,
      player5: false,
    };
    this.playerRanOutOfManaTime = {};
    this.manaUsed = {};
    this.timeSpentAlive = [];
    this.bossSpawns = [];
    this.hitpointsSpent = {};
    this.zoneName = zone?.hrid;
    this.difficultyTier = zone?.difficultyTier;
    this.labyrinthName = labyrinth?.monsterHrid;
    this.roomLevel = labyrinth?.roomLevel;
    this.isDungeon = false;
    this.isLabyrinth = labyrinth ? true : false;
    this.dungeonsCompleted = 0;
    this.dungeonsFailed = 0;
    this.maxWaveReached = 0;
    this.numberOfPlayers = numberOfPlayers;
    this.maxEnrageStack = 0;
    this.minDungenonTime = 0;
    this.lastDungeonFinishTime = 0;
    this.lastEncounterFinishTime = 0;

    this.wipeEvents = [];

    // 时间序列数据用于图表显示
    this.timeSeriesData = {
      timestamps: [],
      players: {},
    };
  }

  addWipeEvent(logs, simulationTime, wave) {
    this.wipeEvents.push({
      simulationTime: simulationTime,
      logs: logs,
      wave: wave,
      timestamp: new Date().toISOString(),
    });
  }

  addDeath(unit) {
    if (!this.deaths[unit.hrid]) {
      this.deaths[unit.hrid] = 0;
    }

    this.deaths[unit.hrid] += 1;
  }

  /**
   * Set the context in which scrolls were evaluated.  Invalid contexts
   * (currently labyrinth and guild trials) retain their configuration but
   * report a reason instead of silently dropping it.
   */
  setScrollUsageContext(allowed = true, ignoredReason = '') {
    this.scrollUsage.allowed = Boolean(allowed);
    this.scrollUsage.ignoredReason = this.scrollUsage.allowed ? '' : String(ignoredReason || 'scrolls_not_allowed');
  }

  /**
   * Record the user-facing feature gate separately from context rules.
   * A disabled simulation can still retain configured rows in `byPlayer`.
   */
  setScrollUsageDisabled(disabled = false) {
    this.scrollUsage.disabled = Boolean(disabled);
  }

  ensureScrollUsageEntry(playerHrid, itemHrid, configuredQuantity = undefined) {
    const playerKey = String(playerHrid || '').trim();
    const itemKey = String(itemHrid || '').trim();
    if (!playerKey || !itemKey) {
      return null;
    }

    if (!this.scrollUsage.byPlayer[playerKey]) {
      this.scrollUsage.byPlayer[playerKey] = {};
    }

    const playerUsage = this.scrollUsage.byPlayer[playerKey];
    if (!playerUsage[itemKey] || typeof playerUsage[itemKey] !== 'object') {
      playerUsage[itemKey] = {
        configuredQuantity: null,
        openedCount: 0,
        activeDurationNs: 0,
        exhausted: false,
      };
    }

    if (configuredQuantity !== undefined) {
      const numeric = Number(configuredQuantity);
      // null (and an empty value supplied by a form) means unlimited.
      if (configuredQuantity === null || configuredQuantity === '') {
        playerUsage[itemKey].configuredQuantity = null;
      } else if (Number.isFinite(numeric) && Number.isSafeInteger(numeric) && numeric > 0) {
        playerUsage[itemKey].configuredQuantity = numeric;
      }
    }

    return playerUsage[itemKey];
  }

  /**
   * Register a configured scroll even when it was not opened (for example,
   * because the selected context ignores scrolls).  `configuration` may be
   * a quantity, or an object containing configuredQuantity/quantity.
   */
  setScrollConfiguration(playerHrid, itemHrid, configuration = null) {
    let configuredQuantity = configuration;
    if (configuration && typeof configuration === 'object') {
      configuredQuantity = Object.prototype.hasOwnProperty.call(configuration, 'configuredQuantity')
        ? configuration.configuredQuantity
        : configuration.quantity;
    }

    // Keep malformed finite quantities out of the result.  Blank/null is
    // the only representation of unlimited inventory; zero, negative,
    // fractional, and non-numeric values are disabled by normalization.
    if (configuredQuantity !== null && configuredQuantity !== undefined && configuredQuantity !== '') {
      const numeric = Number(configuredQuantity);
      if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric) || numeric <= 0) {
        return null;
      }
      configuredQuantity = numeric;
    }
    return this.ensureScrollUsageEntry(playerHrid, itemHrid, configuredQuantity);
  }

  /**
   * Record one or more actual scroll openings.  The optional metadata is
   * deliberately permissive so worker/event code can pass either a compact
   * object or positional values while the public result shape stays stable.
   * Opening metadata does not infer a window duration.  The simulator's
   * normal lifecycle records elapsed time through `recordScrollWindow` when
   * the window closes; callers that already have a duration may still pass
   * it explicitly for compatibility.
   */
  recordScrollOpen(playerHrid, itemHrid, metadata = {}, activeDurationNs, exhausted) {
    let details = metadata;
    if (typeof metadata === 'number') {
      details = { configuredQuantity: metadata };
    } else if (!details || typeof details !== 'object') {
      details = {};
    }

    const configuredQuantity = Object.prototype.hasOwnProperty.call(details, 'configuredQuantity')
      ? details.configuredQuantity
      : Object.prototype.hasOwnProperty.call(details, 'quantity')
        ? details.quantity
        : undefined;
    const entry = this.ensureScrollUsageEntry(playerHrid, itemHrid, configuredQuantity);
    if (!entry) {
      return null;
    }

    const openedCount = Number.isFinite(Number(details.openedCount))
      ? Math.max(0, Math.floor(Number(details.openedCount)))
      : 1;
    entry.openedCount += openedCount;

    const duration = Object.prototype.hasOwnProperty.call(details, 'activeDurationNs')
      ? details.activeDurationNs
      : activeDurationNs;
    const durationNumber = Number(duration);
    if (Number.isFinite(durationNumber) && durationNumber > 0) {
      entry.activeDurationNs += durationNumber;
    }

    const exhaustedValue = Object.prototype.hasOwnProperty.call(details, 'exhausted') ? details.exhausted : exhausted;
    if (exhaustedValue !== undefined) {
      entry.exhausted = Boolean(exhaustedValue);
    } else if (entry.configuredQuantity !== null && entry.openedCount >= entry.configuredQuantity) {
      entry.exhausted = true;
    }

    return entry;
  }

  recordScrollWindow(playerHrid, itemHrid, activeDurationNs) {
    const entry = this.ensureScrollUsageEntry(playerHrid, itemHrid);
    const duration = Number(activeDurationNs);
    if (entry && Number.isFinite(duration) && duration > 0) {
      entry.activeDurationNs += duration;
    }
    return entry;
  }

  /**
   * Compatibility wrapper for older callers which used the overloaded
   * object/string signature. New code should use one of the two explicit
   * entry points below.
   */
  recordMonsterDeath(playerOrHrid, monsterOrHrid, contextOrCount = {}, killCount = 1) {
    if (playerOrHrid && typeof playerOrHrid === 'object') {
      let explicitContext = contextOrCount;
      let normalizedKillCount = killCount;
      if (typeof contextOrCount === 'number') {
        explicitContext = null;
        normalizedKillCount = contextOrCount;
      }

      const hasExplicitContext = Boolean(
        explicitContext && typeof explicitContext === 'object' && Object.keys(explicitContext).length > 0,
      );
      if (hasExplicitContext) {
        return this.recordMonsterDeathFromContext(
          playerOrHrid.hrid,
          monsterOrHrid?.hrid ?? monsterOrHrid,
          explicitContext,
          normalizedKillCount,
        );
      }
      return this.recordMonsterDeathFromUnit(playerOrHrid, monsterOrHrid, normalizedKillCount);
    }

    return this.recordMonsterDeathFromContext(
      playerOrHrid,
      monsterOrHrid?.hrid ?? monsterOrHrid,
      contextOrCount,
      killCount,
    );
  }

  /** Record a death using a CombatUnit as the drop-stat source. */
  recordMonsterDeathFromUnit(player, monster, killCount = 1) {
    return this.recordMonsterDeathFromContext(player?.hrid, monster?.hrid ?? monster, player, killCount);
  }

  /**
   * Record a monster death under an explicit drop-stat context. Buckets with
   * an identical exact signature are merged to keep long simulations compact.
   */
  recordMonsterDeathFromContext(playerHrid, monsterHrid, context = {}, killCount = 1) {
    const playerKey = String(playerHrid || '').trim();
    const monsterKey = String(monsterHrid || '').trim();
    if (!playerKey || !monsterKey) {
      return null;
    }

    let source = context;
    if (!source || typeof source !== 'object') {
      source = {};
    }
    const stats = source.combatDetails?.combatStats || source.combatStats || source;

    const readMultiplier = (multiplierKey, statKey, defaultValue) => {
      if (Object.prototype.hasOwnProperty.call(source, multiplierKey)) {
        return Number.isFinite(Number(source[multiplierKey])) ? Number(source[multiplierKey]) : defaultValue;
      }
      if (Object.prototype.hasOwnProperty.call(stats, multiplierKey)) {
        return Number.isFinite(Number(stats[multiplierKey])) ? Number(stats[multiplierKey]) : defaultValue;
      }
      const statValue = Number(stats?.[statKey]);
      return Number.isFinite(statValue) ? defaultValue + statValue : defaultValue;
    };

    const normalizedContext = {
      dropRateMultiplier: readMultiplier('dropRateMultiplier', 'combatDropRate', 1),
      rareFindMultiplier: readMultiplier('rareFindMultiplier', 'combatRareFind', 1),
      combatDropQuantity: Object.prototype.hasOwnProperty.call(source, 'combatDropQuantity')
        ? Number(source.combatDropQuantity)
        : Number(stats?.combatDropQuantity),
      debuffOnLevelGap: Object.prototype.hasOwnProperty.call(source, 'debuffOnLevelGap')
        ? Number(source.debuffOnLevelGap)
        : Number(stats?.debuffOnLevelGap ?? source?.debuffOnLevelGap ?? 0),
    };

    if (!Number.isFinite(normalizedContext.combatDropQuantity)) {
      normalizedContext.combatDropQuantity = 0;
    }
    if (!Number.isFinite(normalizedContext.debuffOnLevelGap)) {
      normalizedContext.debuffOnLevelGap = 0;
    }
    normalizedContext.dropRateMultiplier = Number.isFinite(normalizedContext.dropRateMultiplier)
      ? normalizedContext.dropRateMultiplier
      : 1;
    normalizedContext.rareFindMultiplier = Number.isFinite(normalizedContext.rareFindMultiplier)
      ? normalizedContext.rareFindMultiplier
      : 1;

    const count = Math.max(0, Math.floor(Number(killCount)));
    if (count <= 0) {
      return null;
    }

    if (!this.dropContextBuckets[playerKey]) {
      this.dropContextBuckets[playerKey] = {};
    }
    if (!Array.isArray(this.dropContextBuckets[playerKey][monsterKey])) {
      this.dropContextBuckets[playerKey][monsterKey] = [];
    }

    const buckets = this.dropContextBuckets[playerKey][monsterKey];
    const matchesContext = (bucket) =>
      Boolean(
        bucket &&
        bucket.dropRateMultiplier === normalizedContext.dropRateMultiplier &&
        bucket.rareFindMultiplier === normalizedContext.rareFindMultiplier &&
        bucket.combatDropQuantity === normalizedContext.combatDropQuantity &&
        bucket.debuffOnLevelGap === normalizedContext.debuffOnLevelGap,
      );
    // Deaths are normally clustered inside one buff window.  Checking the
    // most recently used signature first keeps that hot path O(1), while
    // the fallback still merges an older bucket if a signature returns.
    const latestBucket = buckets[buckets.length - 1];
    const existing = matchesContext(latestBucket) ? latestBucket : buckets.find(matchesContext);
    if (existing) {
      existing.killCount += count;
      return existing;
    }

    const bucket = {
      killCount: count,
      dropRateMultiplier: normalizedContext.dropRateMultiplier,
      rareFindMultiplier: normalizedContext.rareFindMultiplier,
      combatDropQuantity: normalizedContext.combatDropQuantity,
      debuffOnLevelGap: normalizedContext.debuffOnLevelGap,
    };
    buckets.push(bucket);
    return bucket;
  }

  updateTimeSpentAlive(name, alive, time) {
    const i = this.timeSpentAlive.findIndex((e) => e.name === name);
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

  updateDungenonFinish(beginFlag, finishTime) {
    const i = this.timeSpentAlive.findIndex((e) => e.name === beginFlag);
    if (i == -1) {
      return;
    }

    const currentDungenonTime = finishTime - this.timeSpentAlive[i].spawnedAt;

    if (this.minDungenonTime == 0 || this.minDungenonTime > currentDungenonTime) {
      this.minDungenonTime = currentDungenonTime;
    }
  }

  ensureExperienceGainEntry(unit) {
    if (!unit?.isPlayer) {
      return null;
    }

    if (!this.experienceGained[unit.hrid]) {
      this.experienceGained[unit.hrid] = {
        stamina: 0,
        intelligence: 0,
        attack: 0,
        melee: 0,
        defense: 0,
        ranged: 0,
        magic: 0,
      };
    }

    return this.experienceGained[unit.hrid];
  }

  /**
   * Calculate the skill-level experience produced by an event without
   * mutating the result.  CombatSimulator uses this to snapshot a monster
   * kill while its temporary combat buffs are still active.
   */
  calculateExperienceGain(unit, experience) {
    if (!unit?.isPlayer) {
      return null;
    }

    let experienceGainedRate = {
      stamina: 0,
      intelligence: 0,
      attack: 0,
      melee: 0,
      defense: 0,
      ranged: 0,
      magic: 0,
    };

    const primaryTraining = unit.combatDetails.combatStats.primaryTraining;
    experienceGainedRate[primaryTraining.split('/')[2]] = 0.3;

    const skillExpMap = combatStyleDetailMap[unit.combatDetails.combatStats.combatStyleHrid].skillExpMap;
    const skillExpMapLength = Object.keys(skillExpMap).length;

    const focusTraining = unit.combatDetails.combatStats.focusTraining;
    if (focusTraining && skillExpMap[focusTraining]) {
      experienceGainedRate[focusTraining.split('/')[2]] += 0.7;
    } else {
      Object.keys(skillExpMap).forEach((skillHrid) => {
        experienceGainedRate[skillHrid.split('/')[2]] += 0.7 / skillExpMapLength;
      });
    }

    const gains = {};
    for (const [type, rate] of Object.entries(experienceGainedRate)) {
      if (rate <= 0) continue;

      const skillExperience = rate * (1 + unit.combatDetails.combatStats[type + 'Experience']);

      gains[type] =
        experience *
        (1 + unit.combatDetails.combatStats.combatExperience) *
        skillExperience *
        (1 + unit.debuffOnLevelGap);
    }

    return gains;
  }

  addExperienceGainValues(unit, gains) {
    const experienceGained = this.ensureExperienceGainEntry(unit);
    if (!experienceGained || !gains) {
      return;
    }

    for (const [type, value] of Object.entries(gains)) {
      if (Object.prototype.hasOwnProperty.call(experienceGained, type)) {
        experienceGained[type] += value;
      }
    }
  }

  addExperienceGain(unit, experience) {
    this.addExperienceGainValues(unit, this.calculateExperienceGain(unit, experience));
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

    if (!this.combatDropQuantity[unit.hrid]) {
      this.combatDropQuantity[unit.hrid] = {};
    }
    this.combatDropQuantity[unit.hrid] = unit.combatDetails.combatStats.combatDropQuantity;

    if (!this.debuffOnLevelGap[unit.hrid]) {
      this.debuffOnLevelGap[unit.hrid] = {};
    }
    this.debuffOnLevelGap[unit.hrid] = unit.debuffOnLevelGap;
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

  addRanOutOfManaCount(unit, isOutOfMana, time) {
    if (isOutOfMana) this.playerRanOutOfMana[unit.hrid] = true;

    if (!this.playerRanOutOfManaTime[unit.hrid]) {
      this.playerRanOutOfManaTime[unit.hrid] = {
        isOutOfMana: false,
        startTimeForOutOfMana: 0,
        totalTimeForOutOfMana: 0,
      };
    }

    if (isOutOfMana) {
      if (!this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
        this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = true;
        this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana = time;
      }
    } else {
      if (this.playerRanOutOfManaTime[unit.hrid].isOutOfMana) {
        this.playerRanOutOfManaTime[unit.hrid].isOutOfMana = false;
        this.playerRanOutOfManaTime[unit.hrid].totalTimeForOutOfMana +=
          time - this.playerRanOutOfManaTime[unit.hrid].startTimeForOutOfMana;
      }
    }
  }

  // 添加时间序列数据点
  addTimeSeriesSnapshot(time, players) {
    this.timeSeriesData.timestamps.push(time);

    players.forEach((player) => {
      if (!this.timeSeriesData.players[player.hrid]) {
        this.timeSeriesData.players[player.hrid] = {
          hp: [],
          mp: [],
          maxHp: [],
          maxMp: [],
        };
      }

      const playerData = this.timeSeriesData.players[player.hrid];
      playerData.hp.push(player.combatDetails.currentHitpoints);
      playerData.mp.push(player.combatDetails.currentManapoints);
      playerData.maxHp.push(player.combatDetails.maxHitpoints);
      playerData.maxMp.push(player.combatDetails.maxManapoints);
    });
  }
}

export default SimResult;
