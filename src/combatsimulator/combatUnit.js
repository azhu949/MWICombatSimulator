import { BUFF_SOURCE_POLICY, getPartyAuraBuffStrength, isStrongerPartyAuraBuff } from './buffSourcePolicy.js';

// 为需要定位当前活动源的调用方提供的显式哨兵值。
// 默认值保持省略/未定义参数的向后兼容性。
export const REMOVE_ACTIVE_SOURCE = Symbol('remove-active-source');

// 最强源选择仅用于显式选择加入的调用方
// （当前为官方队伍光环）。默认的运行时增益策略保持
// 与历史上"后写覆盖"行为兼容。
function readFiniteBuffNumber(buff, fieldName) {
  const value = buff?.[fieldName];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`CombatUnit buff ${fieldName} must be a finite number for ${buff?.uniqueHrid || '<unknown>'}`);
  }
  return value;
}

function readNonEmptyBuffHrid(buff, fieldName) {
  const value = buff?.[fieldName];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`CombatUnit buff ${fieldName} must be a non-empty string`);
  }
  return value;
}

function cloneBuffForRegistration(buff, startTime) {
  // 运行时增益目前是扁平的标量记录，但注册时不得跨源
  // 共享可变嵌套状态（数组/对象）。深拷贝让每个源
  // 完全隔离，同时保留旧契约：调用方持有的对象
  // 永不被修改，且每个源都有独立的 startTime。
  const cloned = structuredClone(buff);
  cloned.startTime = startTime;
  return cloned;
}

function pickStrongestBuffSource(sources) {
  let bestSourceKey = null;
  let bestEntry = null;
  // STRONGEST 目前仅限于官方队伍光环增益。单个光环只有
  // 游戏上限内少量的队员源，因此每次对账做 O(n) 扫描
  // 是有意为之。若该策略扩展到大型源集合，
  // 请用带索引的选择结构替换此处，
  // 并保留下方"先注册者优先"的平局规则。
  for (const [sourceKey, entry] of sources.entries()) {
    // 完全相等的 ratio/flat 数值刻意不算"更强"。因此 Map 迭代
    // 会保留最先注册的源作为确定性回退；
    // 这并不是说最近的施法者应当胜出。
    if (isStrongerPartyAuraBuff(entry.buff, bestEntry?.buff)) {
      bestSourceKey = sourceKey;
      bestEntry = entry;
    }
  }
  return bestEntry ? { sourceKey: bestSourceKey, ...bestEntry } : null;
}

// 哪些 Buff 字段影响派生战斗属性的唯一事实来源。updateCombatDetails
// 仅通过 getBuffBoosts(type) 消费运行时增益，而 buffsAffectStatsEqually
// 决定源交接是否会改变这些属性；两者必须对精确的字段集合保持一致。
// 在此处保留投影（而不是在两个地方都硬编码字段）可结构性
// 地强制执行"比较字段 == 消费字段"：在一处添加被消费的字段
// 会自动更新另一处。Buff 构造必须将 ratioBoostLevelBonus/
// flatBoostLevelBonus 预先并入有效的 ratioBoost/flatBoost 值；
// 原始等级奖励字段刻意不参与运行时比较。
function projectBuffStats(buff) {
  return {
    uniqueHrid: buff.uniqueHrid,
    typeHrid: buff.typeHrid,
    ratioBoost: buff.ratioBoost,
    flatBoost: buff.flatBoost,
  };
}

// 两个增益在投影属性字段相同时，对派生战斗属性的影响完全相同。
// 仅做引用比较会把每次 addBuff 刷新（总是创建新的注册副本）
// 都视为变化，即使活动值从未变动，
// 也会强制进行冗余的完整重算。
export function buffsAffectStatsEqually(a, b) {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const pa = projectBuffStats(a);
  const pb = projectBuffStats(b);
  return (
    pa.uniqueHrid === pb.uniqueHrid &&
    pa.typeHrid === pb.typeHrid &&
    pa.ratioBoost === pb.ratioBoost &&
    pa.flatBoost === pb.flatBoost
  );
}

function pickLatestBuffSource(sources) {
  let latestSourceKey = null;
  let latestEntry = null;
  for (const [sourceKey, entry] of sources.entries()) {
    if (!latestEntry || entry.sequence > latestEntry.sequence) {
      latestSourceKey = sourceKey;
      latestEntry = entry;
    }
  }
  return latestEntry ? { sourceKey: latestSourceKey, ...latestEntry } : null;
}

function pickActiveBuffSource(sources, policy, preferredSourceKey = null) {
  if (policy === BUFF_SOURCE_POLICY.STRONGEST) {
    return pickStrongestBuffSource(sources);
  }

  // 普通运行时增益为"后写覆盖"。addBuff 传入它刚写入的源，
  // 因此热路径可以 O(1) 选中它。该扫描仅作为
  // 无提示的遗留/恢复状态的防御性回退保留。
  if (preferredSourceKey !== null && sources.has(preferredSourceKey)) {
    return { sourceKey: preferredSourceKey, ...sources.get(preferredSourceKey) };
  }
  return pickLatestBuffSource(sources);
}

function normalizeBuffSourcePolicy(policy) {
  if (policy === undefined || policy === null) {
    return BUFF_SOURCE_POLICY.REPLACE;
  }
  if (policy === BUFF_SOURCE_POLICY.REPLACE || policy === BUFF_SOURCE_POLICY.STRONGEST) {
    return policy;
  }
  throw new TypeError(`Unsupported buff source policy: ${policy}`);
}

class CombatUnit {
  isPlayer;
  isStunned = false;
  stunExpireTime = null;
  isBlinded = false;
  blindExpireTime = null;
  isSilenced = false;
  silenceExpireTime = null;

  isOutOfMana = false;

  // 初始化后不会改变的基础等级
  staminaLevel = 1;
  intelligenceLevel = 1;
  attackLevel = 1;
  meleeLevel = 1;
  defenseLevel = 1;
  rangedLevel = 1;
  magicLevel = 1;

  experience = 0;
  experienceRate = 0;
  enrageTime = 0;

  abilities = [null, null, null, null];
  food = [null, null, null];
  drinks = [null, null, null];
  houseRooms = [];
  guildBuffs = [];
  achievements = null;
  dropTable = [];
  rareDropTable = [];
  abilityManaCosts = new Map();

  // 计算后的战斗属性，包含临时增益
  combatDetails = {
    staminaLevel: 1,
    intelligenceLevel: 1,
    attackLevel: 1,
    meleeLevel: 1,
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
    defensiveMaxDamage: 0,
    totalArmor: 0.2,
    totalWaterResistance: 0.4,
    totalNatureResistance: 0.4,
    totalFireResistance: 0.4,
    abilityHaste: 0,
    tenacity: 0,
    totalThreat: 100,
    combatStats: {
      combatStyleHrid: '/combat_styles/smash',
      damageType: '/damage_types/physical',
      attackInterval: 3000000000,
      autoAttackDamage: 0,
      abilityDamage: 0,
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
      defensiveDamage: 0,
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
      hpDrainRatio: 0,
      primaryTraining: '',
      focusTraining: '',
      staminaExperience: 0,
      intelligenceExperience: 0,
      attackExperience: 0,
      defenseExperience: 0,
      meleeExperience: 0,
      rangedExperience: 0,
      magicExperience: 0,
      retaliation: 0,
      maxHitpointsRatio: 0,
      maxManapointsRatio: 0,
    },
  };
  // CombatUnit.updateCombatDetails 在应用派生值时修改多个 combatStats 字段。
  // 保留最后一次调用方提供的基础快照，以便重复重算始终从相同的输入开始。
  //
  // 隐式契约——只读基准，切勿在外部写入它：
  // 1. 对 combatDetails.combatStats.X 的直接外部写入会被静默丢弃于下一次
  //    updateCombatDetails()（resetCombatStatsToBase 会先恢复此快照）。
  //    有意的属性变更请改走 addBuff/removeBuff 或装备变更。
  // 2. baseCombatStats 本身由 refreshBaseCombatStats() 整体刷新
  //    （Player/Monster 在 super.updateCombatDetails() 之前调用它），
  //    严禁从外部逐字段修改——被污染的基准会使之后每次重算
  //    都出错且没有可见的失败迹象。
  // 目前没有外部写入冲突；此契约的存在是为了让未来的调用方
  // （模拟扩展、预览路径、UI 钩子）不会意外依赖直接属性修改。
  baseCombatStats = null;
  combatBuffs = {};
  permanentBuffs = {};
  zoneBuffs = {};
  extraBuffs = {};
  // 映射 buffUniqueHrid -> Map<sourceKey, { buff, expiresAt, sequence }>。
  // 源跟踪支持对所有运行时增益的精确移除/过期。
  // 选择仍为"后写覆盖"，除非调用方显式将增益
  // 纳入最强源语义（官方队伍光环）。
  buffSources = {};
  // 映射 buffUniqueHrid -> sourceKey，标识当前在 combatBuffs 中
  // 表示的源。源身份与 buff 对象分开保存，因此
  // 交接和移除不依赖对象引用相等性。
  activeBuffSourceKeys = {};
  buffSourcePolicies = {};
  buffSourceSequence = 0;

  constructor() {}

  refreshBaseCombatStats() {
    // 将"纯净的"仅装备属性捕获为重算基准。
    // 参见上方 baseCombatStats 契约：此快照对外部调用方
    // 只读；请通过增益或重新装备来修改 combatDetails.combatStats，
    // 切勿通过写入此对象。
    this.baseCombatStats = { ...this.combatDetails.combatStats };
  }

  // 每个覆写类（Player / Monster）必须在调用 super.updateCombatDetails()
  // 之前调用 refreshBaseCombatStats()，以捕获"纯净的"仅装备状态。
  // resetCombatStatsToBase() 恢复该纯净快照，使重复重算保持幂等。
  resetCombatStatsToBase() {
    if (!this.baseCombatStats) {
      this.refreshBaseCombatStats();
    }
    Object.assign(this.combatDetails.combatStats, this.baseCombatStats);
  }

  updateCombatDetails() {
    this.resetCombatStatsToBase();

    if (this.isPlayer) {
      this.combatDetails.combatStats.hpRegenPer10 += 0.01;
      this.combatDetails.combatStats.mpRegenPer10 += 0.01;
    }

    ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'].forEach((stat) => {
      this.combatDetails[stat + 'Level'] = this[stat + 'Level'];
      let boosts = this.getBuffBoosts('/buff_types/' + stat + '_level');
      boosts.forEach((buff) => {
        this.combatDetails[stat + 'Level'] += this[stat + 'Level'] * buff.ratioBoost;
        this.combatDetails[stat + 'Level'] += buff.flatBoost;
      });
    });

    const maxHitpointsBoost = this.getBuffBoost('/buff_types/max_hitpoints');
    const maxManapointsBoost = this.getBuffBoost('/buff_types/max_manapoints');
    this.combatDetails.maxHitpoints = Math.floor(
      (10 * (10 + this.combatDetails.staminaLevel) +
        this.combatDetails.combatStats.maxHitpoints +
        maxHitpointsBoost.flatBoost) *
        (1 + this.combatDetails.combatStats.maxHitpointsRatio + maxHitpointsBoost.ratioBoost),
    );
    this.combatDetails.maxManapoints = Math.floor(
      (10 * (10 + this.combatDetails.intelligenceLevel) +
        this.combatDetails.combatStats.maxManapoints +
        maxManapointsBoost.flatBoost) *
        (1 + this.combatDetails.combatStats.maxManapointsRatio + maxManapointsBoost.ratioBoost),
    );

    let accuracyRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_accuracy').ratioBoost;
    let damageRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_damage').ratioBoost;
    let accuracyRatioBoost = this.getBuffBoost('/buff_types/accuracy').ratioBoost;
    let damageRatioBoost = this.getBuffBoost('/buff_types/damage').ratioBoost;

    ['stab', 'slash', 'smash'].forEach((style) => {
      this.combatDetails[style + 'AccuracyRating'] =
        (10 + this.combatDetails.attackLevel) *
        (1 + this.combatDetails.combatStats[style + 'Accuracy']) *
        (1 + accuracyRatioBoost) *
        (1 + accuracyRatioBoostFromFury);
      this.combatDetails[style + 'MaxDamage'] =
        (10 + this.combatDetails.meleeLevel) *
        (1 + this.combatDetails.combatStats[style + 'Damage']) *
        (1 + damageRatioBoost) *
        (1 + damageRatioBoostFromFury);
      let baseEvasion =
        (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + 'Evasion']);
      this.combatDetails[style + 'EvasionRating'] = baseEvasion;
      let evasionBoosts = this.getBuffBoosts('/buff_types/evasion');
      for (const boost of evasionBoosts) {
        this.combatDetails[style + 'EvasionRating'] += boost.flatBoost;
        this.combatDetails[style + 'EvasionRating'] += baseEvasion * boost.ratioBoost;
      }
    });

    this.combatDetails.defensiveMaxDamage =
      (10 + this.combatDetails.defenseLevel) *
      (1 + this.combatDetails.combatStats.defensiveDamage) *
      (1 + damageRatioBoost) *
      (1 + damageRatioBoostFromFury);

    // 当装备了 bulwark（壁垒盾）时
    if (this.equipment?.['/equipment_types/two_hand']?.hrid.includes('bulwark')) {
      this.combatDetails.smashMaxDamage += this.combatDetails.defensiveMaxDamage;
    }

    this.combatDetails.rangedAccuracyRating =
      (10 + this.combatDetails.attackLevel) *
      (1 + this.combatDetails.combatStats.rangedAccuracy) *
      (1 + accuracyRatioBoost) *
      (1 + accuracyRatioBoostFromFury);
    this.combatDetails.rangedMaxDamage =
      (10 + this.combatDetails.rangedLevel) *
      (1 + this.combatDetails.combatStats.rangedDamage) *
      (1 + damageRatioBoost) *
      (1 + damageRatioBoostFromFury);

    let baseRangedEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);
    this.combatDetails.rangedEvasionRating = baseRangedEvasion;
    let evasionBoosts = this.getBuffBoosts('/buff_types/evasion');
    for (const boost of evasionBoosts) {
      this.combatDetails.rangedEvasionRating += boost.flatBoost;
      this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;
    }

    this.combatDetails.combatStats.damageTaken = this.getBuffBoost('/buff_types/damage_taken').flatBoost;
    // if (this.combatDetails.combatStats.damageTaken > 0) {
    //     console.log("受到的伤害: " + this.combatDetails.combatStats.damageTaken);
    // }

    this.combatDetails.magicAccuracyRating =
      (10 + this.combatDetails.attackLevel) *
      (1 + this.combatDetails.combatStats.magicAccuracy) *
      (1 + accuracyRatioBoost) *
      (1 + accuracyRatioBoostFromFury);
    this.combatDetails.magicMaxDamage =
      (10 + this.combatDetails.magicLevel) *
      (1 + this.combatDetails.combatStats.magicDamage) *
      (1 + damageRatioBoost) *
      (1 + damageRatioBoostFromFury);

    let baseMagicEvasion = (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.magicEvasion);
    this.combatDetails.magicEvasionRating = baseMagicEvasion;
    for (const boost of evasionBoosts) {
      this.combatDetails.magicEvasionRating += boost.flatBoost;
      this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;
    }

    this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost('/buff_types/physical_amplify').flatBoost;
    this.combatDetails.combatStats.waterAmplify += this.getBuffBoost('/buff_types/water_amplify').flatBoost;
    this.combatDetails.combatStats.natureAmplify += this.getBuffBoost('/buff_types/nature_amplify').flatBoost;
    this.combatDetails.combatStats.fireAmplify += this.getBuffBoost('/buff_types/fire_amplify').flatBoost;
    this.combatDetails.combatStats.healingAmplify += this.getBuffBoost('/buff_types/healing_amplify').flatBoost;

    this.combatDetails.combatStats.attackInterval /= 1 + this.combatDetails.attackLevel / 2000;

    let baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
    this.combatDetails.combatStats.attackInterval /= 1 + baseAttackSpeed;
    let attackIntervalBoosts = this.getBuffBoosts('/buff_types/attack_speed');
    let attackIntervalRatioBoost = attackIntervalBoosts
      .map((boost) => boost.ratioBoost)
      .reduce((prev, cur) => prev + cur, 0);
    this.combatDetails.combatStats.attackInterval /= 1 + attackIntervalRatioBoost;

    let baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;
    this.combatDetails.totalArmor = baseArmor;
    let armorBoosts = this.getBuffBoosts('/buff_types/armor');
    for (const boost of armorBoosts) {
      this.combatDetails.totalArmor += boost.flatBoost;
      this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
    }

    let baseWaterResistance = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.waterResistance;
    this.combatDetails.totalWaterResistance = baseWaterResistance;
    let waterResistanceBoosts = this.getBuffBoosts('/buff_types/water_resistance');
    for (const boost of waterResistanceBoosts) {
      this.combatDetails.totalWaterResistance += boost.flatBoost;
      this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;
    }

    let baseNatureResistance = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.natureResistance;
    this.combatDetails.totalNatureResistance = baseNatureResistance;
    let natureResistanceBoosts = this.getBuffBoosts('/buff_types/nature_resistance');
    for (const boost of natureResistanceBoosts) {
      this.combatDetails.totalNatureResistance += boost.flatBoost;
      this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;
    }

    let baseFireResistance = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.fireResistance;
    this.combatDetails.totalFireResistance = baseFireResistance;
    let fireResistanceBoosts = this.getBuffBoosts('/buff_types/fire_resistance');
    for (const boost of fireResistanceBoosts) {
      this.combatDetails.totalFireResistance += boost.flatBoost;
      this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;
    }

    let hpRegenBoosts = this.getBuffBoost('/buff_types/hp_regen');
    this.combatDetails.combatStats.hpRegenPer10 +=
      this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
    this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

    let mpRegenBoosts = this.getBuffBoost('/buff_types/mp_regen');
    this.combatDetails.combatStats.mpRegenPer10 +=
      this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
    this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

    this.combatDetails.combatStats.lifeSteal += this.getBuffBoost('/buff_types/life_steal').flatBoost;
    this.combatDetails.combatStats.physicalThorns += this.getBuffBoost('/buff_types/physical_thorns').flatBoost;
    this.combatDetails.combatStats.elementalThorns += this.getBuffBoost('/buff_types/elemental_thorns').flatBoost;
    this.combatDetails.combatStats.combatExperience += this.getBuffBoost('/buff_types/wisdom').flatBoost;
    this.combatDetails.combatStats.criticalRate += this.getBuffBoost('/buff_types/critical_rate').flatBoost;
    this.combatDetails.combatStats.criticalDamage += this.getBuffBoost('/buff_types/critical_damage').flatBoost;

    this.combatDetails.combatStats.castSpeed += this.getBuffBoost('/buff_types/cast_speed').flatBoost;
    this.combatDetails.combatStats.castSpeed += this.combatDetails['attackLevel'] / 2000;

    let combatDropRateBoosts = this.getBuffBoost('/buff_types/combat_drop_rate');
    this.combatDetails.combatStats.combatDropRate +=
      (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;
    this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;
    let combatRareFindBoosts = this.getBuffBoost('/buff_types/rare_find');
    this.combatDetails.combatStats.combatRareFind +=
      (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;
    this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;
    let combatDropQuantityBoosts = this.getBuffBoost('/buff_types/combat_drop_quantity');
    this.combatDetails.combatStats.combatDropQuantity +=
      (1 + this.combatDetails.combatStats.combatDropQuantity) * combatDropQuantityBoosts.ratioBoost;
    this.combatDetails.combatStats.combatDropQuantity += combatDropQuantityBoosts.flatBoost;

    let baseThreat = 100 + this.combatDetails.combatStats.threat;
    this.combatDetails.totalThreat = baseThreat;
    let threatBoosts = this.getBuffBoost('/buff_types/threat');
    if (threatBoosts.ratioBoost !== 0) {
      this.combatDetails.combatStats.threat += baseThreat * threatBoosts.ratioBoost;
    } else {
      this.combatDetails.combatStats.threat = baseThreat;
    }
    this.combatDetails.combatStats.threat += threatBoosts.flatBoost;

    this.combatDetails.combatStats.retaliation += this.getBuffBoost('/buff_types/retaliation').flatBoost;
    this.combatDetails.combatStats.tenacity += this.getBuffBoost('/buff_types/tenacity').flatBoost;
  }

  addBuff(buff, currentTime, sourceHrid = null, options = {}) {
    if (typeof currentTime !== 'number' || !Number.isFinite(currentTime)) {
      throw new TypeError('CombatUnit.addBuff requires a finite numeric currentTime');
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('CombatUnit.addBuff options must be a non-null object');
    }
    const { sourcePolicy } = options;

    readNonEmptyBuffHrid(buff, 'uniqueHrid');
    readNonEmptyBuffHrid(buff, 'typeHrid');
    readFiniteBuffNumber(buff, 'ratioBoost');
    readFiniteBuffNumber(buff, 'flatBoost');
    const duration = readFiniteBuffNumber(buff, 'duration');

    // 注册后保持调用方拥有的 buff 不可变。每个源
    // 需要自己的 startTime，因为同一个 buff 可能被多个
    // 源或战斗单元复用。
    const registeredBuff = cloneBuffForRegistration(buff, currentTime);
    const sourceKey = sourceHrid ?? 'default';
    const expiresAt = currentTime + duration;
    const normalizedPolicy = normalizeBuffSourcePolicy(sourcePolicy);
    if (normalizedPolicy === BUFF_SOURCE_POLICY.STRONGEST) {
      // 在修改源注册表之前先校验。不支持或
      // 变更过的官方数据必须大声失败，而不是通过
      // 推断的负值/混合字段排序规则来选源。
      getPartyAuraBuffStrength(registeredBuff);
    }

    let sources = this.buffSources[registeredBuff.uniqueHrid];
    if (!sources) {
      sources = this.buffSources[registeredBuff.uniqueHrid] = new Map();
    }
    const existingPolicy = this.buffSourcePolicies[registeredBuff.uniqueHrid];
    if (existingPolicy && existingPolicy !== normalizedPolicy) {
      throw new Error(
        `CombatUnit buff source policy mismatch for ${registeredBuff.uniqueHrid}: ` +
          `${existingPolicy} vs ${normalizedPolicy}`,
      );
    }
    this.buffSourcePolicies[registeredBuff.uniqueHrid] = normalizedPolicy;
    sources.set(sourceKey, {
      buff: registeredBuff,
      expiresAt,
      sequence: ++this.buffSourceSequence,
    });

    // 每次源更新后重新选择。最强源增益可能交接
    // 给另一个源；默认增益暴露最近一次写入。
    this.reconcileBuffSource(registeredBuff.uniqueHrid, sources, {
      preferredSourceKey: sourceKey,
    });
  }

  reconcileBuffSource(uniqueHrid, sources, { updateDetails = true, preferredSourceKey = null } = {}) {
    const previousActiveBuff = this.combatBuffs[uniqueHrid];
    const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
    const nextActiveSource =
      sources && sources.size > 0 ? pickActiveBuffSource(sources, policy, preferredSourceKey) : null;

    if (nextActiveSource) {
      this.activeBuffSourceKeys[uniqueHrid] = nextActiveSource.sourceKey;
      this.combatBuffs[uniqueHrid] = nextActiveSource.buff;
    } else {
      delete this.activeBuffSourceKeys[uniqueHrid];
      delete this.combatBuffs[uniqueHrid];
    }

    const activeBuffChanged = !buffsAffectStatsEqually(nextActiveSource?.buff, previousActiveBuff);
    if (activeBuffChanged && updateDetails) {
      this.updateCombatDetails();
    }

    return activeBuffChanged;
  }

  /**
   * 移除一个运行时 Buff 注册。
   *
   * `sourceHrid` 可选，以兼容引入源之前的旧 API：
   * `removeBuff({ uniqueHrid })` 移除当前活动源，即调用方
   * 历史上在 `combatBuffs` 中看到的那个 Buff。对于
   * 最强源 Buff，这可能通过正常的交接规则揭示下一个源。
   * 当只需移除某一个特定注册时传入源键；`REMOVE_ACTIVE_SOURCE`
   * 显式表达活动源意图，而显式 `null` 保留传统的 `default` 键。
   * 传统后写（`REPLACE`）Buff 保留其历史"无休眠交接"
   * 行为：活动注册被移除后清除其余注册。
   */
  removeBuff(buff, sourceHrid = REMOVE_ACTIVE_SOURCE) {
    const uniqueHrid = buff?.uniqueHrid;
    if (!uniqueHrid) {
      return;
    }

    this.removeBuffByUniqueHrid(uniqueHrid, sourceHrid);
  }

  /**
   * 按 uniqueHrid 移除一个运行时 Buff 注册。
   *
   * 省略 `sourceHrid` 时有意定位当前活动源，以保留旧的
   * `removeBuff({ uniqueHrid })` 契约。这也是源感知 Buff 的安全默认：
   * 最强源条目可以交接而不是静默无事。当活动源意图
   * 需要显式表达时使用 `REMOVE_ACTIVE_SOURCE`，精确移除某个
   * 源时使用显式源键；显式 `null` 指向 `default` 源。
   * 传统 `REPLACE` 条目保持其无休眠交接的清理语义。
   */
  removeBuffByUniqueHrid(uniqueHrid, sourceHrid = REMOVE_ACTIVE_SOURCE) {
    const sources = this.buffSources[uniqueHrid];
    let sourceKey;
    if (sourceHrid === REMOVE_ACTIVE_SOURCE) {
      const activeSourceKey = this.activeBuffSourceKeys[uniqueHrid];
      if (activeSourceKey !== undefined && (!sources || sources.has(activeSourceKey))) {
        sourceKey = activeSourceKey;
      } else if (sources?.size) {
        // 恢复/遗留状态可能带有源注册但缺少活动键索引。
        // 推导对账时所用的同一个活动源，
        // 而不是静默返回空操作。
        const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
        sourceKey = pickActiveBuffSource(sources, policy)?.sourceKey;
      }
    } else {
      sourceKey = sourceHrid;
    }
    sourceKey ??= 'default';

    if (sources) {
      if (!sources.has(sourceKey)) {
        return;
      }

      const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
      const sourceWasActive = sourceKey === this.activeBuffSourceKeys[uniqueHrid];
      sources.delete(sourceKey);
      if (policy === BUFF_SOURCE_POLICY.REPLACE && sourceWasActive) {
        // 历史上"后写覆盖"的增益在被覆盖的可见注册被移除时，
        // 不会揭示旧值。
        //
        // 级联清除的可达性说明：每条生产环境的 REPLACE
        // 注册在每个 uniqueHrid 上恰好保留一个源——卷轴
        // 使用 `scroll:${itemHrid}`（卷轴 uniqueHrid 之间互不相同，
        // 与饮料/技能增益隔离；续期是同键覆盖），而狂暴/诅咒/虚弱/激怒、
        // 消耗品和 REPLACE 技能增益都注册
        // "default" 键。因此移除唯一条目会落入
        // 下方 sources.size === 0 分支，所以这个
        // REPLACE+活动分支只会被刻意构造多源 REPLACE
        // 注册的单元测试触发。
        // 保留它：如果未来的数据在每个 uniqueHrid 上注册多个
        // REPLACE 源，它可以维持无休眠交接契约。
        delete this.buffSources[uniqueHrid];
        delete this.buffSourcePolicies[uniqueHrid];
        this.reconcileBuffSource(uniqueHrid, null);
      } else if (sources.size === 0) {
        delete this.buffSources[uniqueHrid];
        delete this.buffSourcePolicies[uniqueHrid];
        this.reconcileBuffSource(uniqueHrid, null);
      } else if (
        sourceWasActive ||
        // 当源注册表与活动键出现漂移时，防御性地重新对账。
        this.activeBuffSourceKeys[uniqueHrid] === undefined
      ) {
        this.reconcileBuffSource(uniqueHrid, sources);
      }
      return;
    }

    // 为早于源注册机制的旧式增益提供的兼容回退。
    // 缺少源注册表不能成为删除无关已注册源的理由。
    if (this.combatBuffs[uniqueHrid]) {
      delete this.combatBuffs[uniqueHrid];
      delete this.activeBuffSourceKeys[uniqueHrid];
      delete this.buffSourcePolicies[uniqueHrid];
      this.updateCombatDetails();
    }
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
      houseRoom.buffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }

    for (const guildBuff of this.guildBuffs) {
      guildBuff.buffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }

    if (this.achievements) {
      this.achievements.buffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }
    if (this.zoneBuffs) {
      this.zoneBuffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }
    if (this.extraBuffs) {
      this.extraBuffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }
  }

  removeExpiredBuffByUniqueHrid(uniqueHrid, currentTime, { updateDetails = true } = {}) {
    if (!uniqueHrid) {
      return false;
    }

    let detailsDirty = false;
    const sources = this.buffSources[uniqueHrid];
    if (sources) {
      const activeSourceKey = this.activeBuffSourceKeys[uniqueHrid];
      const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
      let activeSourceExpired = false;
      // 在扫描快照时删除，以免修改影响迭代语义。源集合
      // 目前受限于较小的队伍光环名单；如果该策略扩展
      // 到大型集合，请改为只收集过期键（或维护索引）。
      for (const [sourceKey, entry] of [...sources.entries()]) {
        if (entry.expiresAt <= currentTime) {
          if (sourceKey === activeSourceKey) {
            activeSourceExpired = true;
          }
          sources.delete(sourceKey);
        }
      }

      // 后写增益历史上没有休眠源交接：一旦可见增益过期，
      // 旧引擎会彻底移除该 uniqueHrid。保留此行为，
      // 同时允许光环源交接给下一个最强且未过期的注册。
      if (policy === BUFF_SOURCE_POLICY.REPLACE && activeSourceExpired) {
        delete this.buffSources[uniqueHrid];
        delete this.buffSourcePolicies[uniqueHrid];
        detailsDirty = this.reconcileBuffSource(uniqueHrid, null, { updateDetails: false }) || detailsDirty;
      } else if (sources.size === 0) {
        delete this.buffSources[uniqueHrid];
        delete this.buffSourcePolicies[uniqueHrid];
        detailsDirty = this.reconcileBuffSource(uniqueHrid, null, { updateDetails: false }) || detailsDirty;
      } else if (activeSourceExpired || activeSourceKey === undefined || !sources.has(activeSourceKey)) {
        detailsDirty = this.reconcileBuffSource(uniqueHrid, sources, { updateDetails: false }) || detailsDirty;
      }
    } else {
      // 与源注册机制引入前由旧调用方恢复的运行时增益保持兼容。
      // 永久增益通常使用 null/字符串开始时间，
      // 因此不在这个数值定时增益回退范围内。
      const buff = this.combatBuffs[uniqueHrid];
      if (
        typeof buff?.startTime === 'number' &&
        Number.isFinite(buff.startTime) &&
        typeof buff?.duration === 'number' &&
        Number.isFinite(buff.duration) &&
        buff.startTime + buff.duration <= currentTime
      ) {
        delete this.combatBuffs[uniqueHrid];
        delete this.activeBuffSourceKeys[uniqueHrid];
        delete this.buffSourcePolicies[uniqueHrid];
        detailsDirty = true;
      }
    }

    if (detailsDirty && updateDetails) {
      this.updateCombatDetails();
    }

    return detailsDirty;
  }

  removeExpiredBuffs(currentTime, { updateDetails = true } = {}) {
    // 这里只处理已注册源的运行时增益过期。clearBuffs() 将永久增益
    // 直接复制进 combatBuffs 而不带源，因此这些条目
    // 刻意不在定时过期生命周期内。
    // 当活动源过期时，最强源增益可能选择回退。
    // 普通后写增益则直接清除，不做交接。
    let detailsDirty = false;
    for (const uniqueHrid of Object.keys(this.buffSources)) {
      detailsDirty =
        this.removeExpiredBuffByUniqueHrid(uniqueHrid, currentTime, { updateDetails: false }) || detailsDirty;
    }

    // 与未在 buffSources 中表示、由旧调用方恢复的运行时增益保持兼容。
    // 上方的定向原语也被专用过期事件使用，
    // 以避免这种全量扫描。
    for (const [uniqueHrid, buff] of Object.entries(this.combatBuffs)) {
      if (this.buffSources[uniqueHrid]) {
        continue;
      }
      if (
        typeof buff?.startTime === 'number' &&
        Number.isFinite(buff.startTime) &&
        typeof buff?.duration === 'number' &&
        Number.isFinite(buff.duration) &&
        buff.startTime + buff.duration <= currentTime
      ) {
        delete this.combatBuffs[uniqueHrid];
        delete this.activeBuffSourceKeys[uniqueHrid];
        delete this.buffSourcePolicies[uniqueHrid];
        detailsDirty = true;
      }
    }

    if (detailsDirty && updateDetails) {
      this.updateCombatDetails();
    }

    return detailsDirty;
  }

  clearBuffs() {
    this.combatBuffs = structuredClone(this.permanentBuffs);
    this.buffSources = {};
    this.activeBuffSourceKeys = {};
    this.buffSourcePolicies = {};
    this.buffSourceSequence = 0;
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
    this.refreshBaseCombatStats();
  }

  getBuffBoosts(type) {
    let boosts = [];
    Object.values(this.combatBuffs)
      .filter((buff) => buff.typeHrid == type)
      .forEach((buff) => {
        const { ratioBoost, flatBoost } = projectBuffStats(buff);
        boosts.push({ ratioBoost, flatBoost });
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

    // 只有玩家在地下城团灭重开时保留buff和CD，敌人始终完全重置
    if (currentTime == 0 || !this.isPlayer) {
      // 首次战斗开始 或 敌人重置：完全重置
      this.clearBuffs();
      this.updateCombatDetails();
      this.resetCooldowns(currentTime);
    } else {
      // 地下城团灭重开（仅玩家）：只移除过期buff，保留CD
      this.removeExpiredBuffs(currentTime, { updateDetails: false });
      this.updateCombatDetails();
    }

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
            cooldownDuration = (cooldownDuration * 100) / (100 + haste);
          }
          ability.lastUsed =
            currentTime - Math.floor(cooldownDuration * 0.5) + Math.floor(Math.random() * cooldownDuration * 0.5);
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

    let newManapoints = Math.min(this.combatDetails.currentManapoints + manapoints, this.combatDetails.maxManapoints);
    manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
    this.combatDetails.currentManapoints = newManapoints;

    return manapointsAdded;
  }
}

export default CombatUnit;
