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
    // 定时战斗卷轴刻意与普通消耗品分开记录。卷轴不是
    // 市场支出，其效果在模拟过程中可能变化，因此结果将使用窗口
    // 与下方最终属性快照分开记录。
    this.scrollUsage = {
      allowed: !labyrinth,
      ignoredReason: labyrinth ? 'labyrinth' : '',
      disabled: false,
      byPlayer: {},
    };

    // 对于包含过期卷轴的长时间模拟，单一的最终掉落倍率并不足够。
    // CombatSimulator 可按（玩家、怪物、属性签名）追加一个桶，
    // 利润估算器在存在这些桶时使用它们，同时为旧的
    // 序列化结果保留传统回退。桶还记录击杀时怪物的有效难度档
    // difficultyTier（Monster.difficultyTier = spawn 偏移 + 区域档，与
    // zone.js 构怪口径一致），掉落难度门与开率据此按怪物实际难度计算；
    // 旧结果/DTO 未记录该字段时，估算端回退 SimResult.difficultyTier
    // （纯区域档快照）。
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
   * 设置卷轴被评估时的上下文。无效上下文
   * （当前为迷宫与公会试炼）会保留其配置，
   * 但会报告原因而不是静默丢弃。
   */
  setScrollUsageContext(allowed = true, ignoredReason = '') {
    this.scrollUsage.allowed = Boolean(allowed);
    this.scrollUsage.ignoredReason = this.scrollUsage.allowed ? '' : String(ignoredReason || 'scrolls_not_allowed');
  }

  /**
   * 单独记录面向用户的功能开关，与上下文规则分开。
   * 已禁用的模拟仍可在 `byPlayer` 中保留已配置的行。
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
      // null（以及表单提供的空值）表示无限。
      if (configuredQuantity === null || configuredQuantity === '') {
        playerUsage[itemKey].configuredQuantity = null;
      } else if (Number.isFinite(numeric) && Number.isSafeInteger(numeric) && numeric > 0) {
        playerUsage[itemKey].configuredQuantity = numeric;
      }
    }

    return playerUsage[itemKey];
  }

  /**
   * 注册已配置的卷轴，即使它未被打开（例如
   * 因为所选上下文忽略卷轴）。`configuration` 可以是
   * 数量，或包含 configuredQuantity/quantity 的对象。
   */
  setScrollConfiguration(playerHrid, itemHrid, configuration = null) {
    let configuredQuantity = configuration;
    if (configuration && typeof configuration === 'object') {
      configuredQuantity = Object.prototype.hasOwnProperty.call(configuration, 'configuredQuantity')
        ? configuration.configuredQuantity
        : configuration.quantity;
    }

    // 防止畸形有限数量进入结果。空白/null 是
    // 无限库存的唯一表示；零、负数、
    // 小数和非数值会被规范化禁用。
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
   * 记录一次或多次实际卷轴开启。可选元数据刻意保持宽松，
   * 以便 worker/事件代码既可以传紧凑对象也可以传位置参数，
   * 而公开结果形状保持稳定。开启元数据不会推断窗口时长。
   * 模拟器的正常生命周期在窗口关闭时通过 `recordScrollWindow` 记录
   * 经过的时间；已经持有时长的调用方仍可出于兼容性显式传入。
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
   * 为使用过载 object/string 签名的旧调用方提供的兼容包装。
   * 新代码应使用下方两个显式入口点之一。
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

  /** 使用 CombatUnit 作为掉落统计来源记录一次死亡。 */
  recordMonsterDeathFromUnit(player, monster, killCount = 1) {
    const monsterUnit = monster && typeof monster === 'object' ? monster : null;
    return this.recordMonsterDeathFromContext(
      player?.hrid,
      monsterUnit?.hrid ?? monster,
      player,
      killCount,
      monsterUnit?.difficultyTier,
    );
  }

  /**
   * 在显式掉落统计上下文下记录一次怪物死亡。具有完全相同
   * 签名的桶会被合并，以保持长时间模拟结果紧凑。
   * monsterDifficultyTier 为击杀怪物的有效难度档（Monster.difficultyTier
   * = spawn 偏移 + 区域档）；未提供（DTO/旧调用方）时桶不记录该字段，
   * 利润估算器回退 SimResult.difficultyTier（纯区域档快照）。
   */
  recordMonsterDeathFromContext(
    playerHrid,
    monsterHrid,
    context = {},
    killCount = 1,
    monsterDifficultyTier = undefined,
  ) {
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

    // 怪物有效难度档（spawn 偏移 + 区域档）：仅在调用方明确提供时记录，
    // 未提供（DTO/旧调用方）保持 undefined，让桶维持旧形状，由估算端回退。
    const normalizedDifficultyTier = Number.isFinite(Number(monsterDifficultyTier))
      ? Math.max(0, Math.floor(Number(monsterDifficultyTier)))
      : undefined;

    const normalizedContext = {
      dropRateMultiplier: readMultiplier('dropRateMultiplier', 'combatDropRate', 1),
      rareFindMultiplier: readMultiplier('rareFindMultiplier', 'combatRareFind', 1),
      combatDropQuantity: Object.prototype.hasOwnProperty.call(source, 'combatDropQuantity')
        ? Number(source.combatDropQuantity)
        : Number(stats?.combatDropQuantity),
      debuffOnLevelGap: Object.prototype.hasOwnProperty.call(source, 'debuffOnLevelGap')
        ? Number(source.debuffOnLevelGap)
        : Number(stats?.debuffOnLevelGap ?? source?.debuffOnLevelGap ?? 0),
      difficultyTier: normalizedDifficultyTier,
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
        bucket.debuffOnLevelGap === normalizedContext.debuffOnLevelGap &&
        // 同一怪物在同一模拟内的有效难度档恒定；把难度纳入签名可防止
        // 假想数据（同 hrid 多 spawn 档、升档怪）下不同难度的击杀被静默合并。
        bucket.difficultyTier === normalizedContext.difficultyTier,
      );
    // 死亡通常集中在一个增益窗口内。先检查最近使用的
    // 签名可使该热路径保持 O(1)，而回退逻辑仍会在
    // 旧签名再次出现时合并更早的桶。
    const latestBucket = buckets[buckets.length - 1];
    const existing = matchesContext(latestBucket) ? latestBucket : buckets.find(matchesContext);
    if (existing) {
      existing.killCount += count;
      return existing;
    }

    const bucket = {
      killCount: count,
      // 仅在已知怪物有效难度时新增该键；旧形状结果/DTO 保持原样，
      // 读取端（profitEstimator.normalizeDropContextBucket）回退纯区域档快照。
      ...(normalizedDifficultyTier !== undefined ? { difficultyTier: normalizedDifficultyTier } : {}),
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
   * 计算事件产生的技能等级经验，且不修改结果。
   * CombatSimulator 用它来在怪物临时战斗增益仍然生效时
   * 对击杀进行快照。
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
