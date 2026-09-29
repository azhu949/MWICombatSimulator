// 生产桥（切片 5）：把 JS 侧**已构建**的单位（玩家 / 怪物实例）快照成 Rust `UnitSpec`，
// 组装 `run_production_simulation` 请求，供 worker / 探针调用。
//
// 设计要点：
// - 玩家与怪物都在 JS 侧按既有生产路径构建（Player.createFromDTO / new Monster），
//   本模块只做「状态快照」，不重算任何数值——两侧结算公式因此天然同源；
// - 快照前必须让单位完成一次构造期面板结算（`settleUnitForSnapshot`）：JS 生产路径在开局
//   t=0（`generatePermanentBuffs` → `reset` → `clearBuffs` → `updateCombatDetails`）才会
//   捕获 `baseCombatStats`，而 wasm 请求在开局前就要这份基准面板；
// - `combatStats` 取 `unit.baseCombatStats ?? unit.combatDetails.combatStats`：
//   前者是 JS 构造期捕获的基准面板，正是 Rust `build_unit_from_spec` 期望的输入；
//   数字键进 `combatStats`，字符串键（战斗风格 / 伤害类型 / 训练方向）进 `combatStatsStrings`；
// - 非有限数（NaN/±Infinity）无法经 JSON 传输，遇到即抛错（调用方回退 JS 引擎）；
// - 调用方必须传入**未初始化**的玩家（`permanentBuffs` 为空，等价 JS t=0 之前）：
//   房屋 / 公会 / 成就 / 区域 / 额外增益的合并由引擎在 t=0 自行完成，桥接重复合并会翻倍；
// - 怪物模板按 `(zoneHrid, difficultyTier)` 缓存：模板只读，可跨模拟复用。
import Ability from '../combatsimulator/ability.js';
import Monster from '../combatsimulator/monster.js';
import combatStyleDetailMap from '../combatsimulator/data/combatStyleDetailMap.json';
import combatTriggerDependencyDetailMap from '../combatsimulator/data/combatTriggerDependencyDetailMap.json';

const encounterTemplateCache = new Map();

/// `combatStyleDetailMap` 的投影：styleHrid → `Object.keys(skillExpMap)` 顺序表。
///
/// Rust `SimResultState` 用它在击杀时把经验拆到 7 个技能（focus 命中风格表 → 0.7 独占，
/// 否则 0.7 / 技能数均摊），键序即 JSON 声明序。`skillExpMap` 为 `null` 的风格
///（heal，非普攻风格）不进表——JS 侧对它 `Object.keys(null)` 会抛 TypeError。
let combatStyleSkillExpMapCache = null;
function getCombatStyleSkillExpMap() {
  if (!combatStyleSkillExpMapCache) {
    combatStyleSkillExpMapCache = Object.entries(combatStyleDetailMap)
      .filter(([, detail]) => detail?.skillExpMap)
      .map(([styleHrid, detail]) => [styleHrid, Object.keys(detail.skillExpMap)]);
  }
  return combatStyleSkillExpMapCache;
}

function assertFinite(value, path) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`wasm production bridge: non-finite number at ${path} (${value})`);
  }
  return value;
}

function serializeTrigger(trigger) {
  const dependency = combatTriggerDependencyDetailMap[trigger.dependencyHrid];
  if (!dependency) {
    throw new Error(`wasm production bridge: missing trigger dependency ${trigger.dependencyHrid}`);
  }
  return {
    dependencyHrid: trigger.dependencyHrid,
    conditionHrid: trigger.conditionHrid,
    comparatorHrid: trigger.comparatorHrid,
    value: trigger.value,
    isSingleTarget: Boolean(dependency.isSingleTarget),
  };
}

function serializeBuff(buff) {
  return {
    uniqueHrid: buff.uniqueHrid,
    typeHrid: buff.typeHrid,
    ratioBoost: assertFinite(buff.ratioBoost, `buff ${buff.uniqueHrid}.ratioBoost`),
    flatBoost: assertFinite(buff.flatBoost, `buff ${buff.uniqueHrid}.flatBoost`),
    ...(buff.duration === undefined ? {} : { duration: buff.duration }),
    ...(buff.startTime === undefined ? {} : { startTime: buff.startTime }),
    ...(buff.multiplierForSkillHrid === undefined ? {} : { multiplierForSkillHrid: buff.multiplierForSkillHrid }),
    ...(buff.multiplierPerSkillLevel === undefined ? {} : { multiplierPerSkillLevel: buff.multiplierPerSkillLevel }),
  };
}

function serializeAbilityEffect(effect) {
  return {
    targetType: effect.targetType,
    effectType: effect.effectType,
    ...(effect.combatStyleHrid === undefined ? {} : { combatStyleHrid: effect.combatStyleHrid }),
    ...(effect.damageType === undefined ? {} : { damageType: effect.damageType }),
    damageFlat: assertFinite(effect.damageFlat, 'abilityEffect.damageFlat'),
    damageRatio: assertFinite(effect.damageRatio, 'abilityEffect.damageRatio'),
    bonusAccuracyRatio: assertFinite(effect.bonusAccuracyRatio, 'abilityEffect.bonusAccuracyRatio'),
    armorDamageRatio: assertFinite(effect.armorDamageRatio, 'abilityEffect.armorDamageRatio'),
    ...(effect.damageOverTimeRatio === undefined ? {} : { damageOverTimeRatio: effect.damageOverTimeRatio }),
    ...(effect.damageOverTimeDuration === undefined ? {} : { damageOverTimeDuration: effect.damageOverTimeDuration }),
    ...(effect.hpDrainRatio === undefined ? {} : { hpDrainRatio: effect.hpDrainRatio }),
    ...(effect.pierceChance === undefined ? {} : { pierceChance: effect.pierceChance }),
    ...(effect.blindChance === undefined ? {} : { blindChance: effect.blindChance }),
    ...(effect.blindDuration === undefined ? {} : { blindDuration: effect.blindDuration }),
    ...(effect.silenceChance === undefined ? {} : { silenceChance: effect.silenceChance }),
    ...(effect.silenceDuration === undefined ? {} : { silenceDuration: effect.silenceDuration }),
    ...(effect.stunChance === undefined ? {} : { stunChance: effect.stunChance }),
    ...(effect.stunDuration === undefined ? {} : { stunDuration: effect.stunDuration }),
    ...(effect.spendHpRatio === undefined ? {} : { spendHpRatio: effect.spendHpRatio }),
    buffs: (effect.buffs ?? []).map((buff) => serializeBuff(buff)),
  };
}

function serializeAbility(ability) {
  return {
    hrid: ability.hrid,
    level: assertFinite(ability.level, `ability ${ability.hrid}.level`),
    manaCost: assertFinite(ability.manaCost, `ability ${ability.hrid}.manaCost`),
    cooldownDuration: assertFinite(ability.cooldownDuration, `ability ${ability.hrid}.cooldownDuration`),
    castDuration: assertFinite(ability.castDuration, `ability ${ability.hrid}.castDuration`),
    isSpecialAbility: Boolean(ability.isSpecialAbility),
    abilityEffects: (ability.abilityEffects ?? []).map((effect) => serializeAbilityEffect(effect)),
    triggers: (ability.triggers ?? []).map((trigger) => serializeTrigger(trigger)),
    lastUsed: assertFinite(ability.lastUsed, `ability ${ability.hrid}.lastUsed`),
  };
}

function serializeConsumable(item) {
  return {
    hrid: item.hrid,
    cooldownDuration: assertFinite(item.cooldownDuration, `consumable ${item.hrid}.cooldownDuration`),
    hitpointRestore: assertFinite(item.hitpointRestore, `consumable ${item.hrid}.hitpointRestore`),
    manapointRestore: assertFinite(item.manapointRestore, `consumable ${item.hrid}.manapointRestore`),
    recoveryDuration: assertFinite(item.recoveryDuration, `consumable ${item.hrid}.recoveryDuration`),
    // JS 字段拼写为 catagoryHrid（上游拼写错误），Rust 侧字段名为 categoryHrid。
    ...(item.catagoryHrid === undefined ? {} : { categoryHrid: item.catagoryHrid }),
    buffs: (item.buffs ?? []).map((buff) => serializeBuff(buff)),
    triggers: (item.triggers ?? []).map((trigger) => serializeTrigger(trigger)),
    lastUsed: assertFinite(item.lastUsed, `consumable ${item.hrid}.lastUsed`),
  };
}

/// 快照前补一次构造期面板结算，让 `baseCombatStats` 捕获装备 / 等级基准。
///
/// JS 生产路径在开局 t=0 才结算（`reset` → `clearBuffs` → `updateCombatDetails`），
/// 而 wasm 请求在开局前就要这份基准，因此调用方需先显式结算。
/// 幂等：`updateCombatDetails` 每次都从基准面板重算，重复调用不累积。
export function settleUnitForSnapshot(unit) {
  unit.updateCombatDetails();
}

/// JS 单位实例 → Rust `UnitSpec`（`engine/src/simulator.rs` 的 `UnitSpec` 成对维护）。
export function dumpUnitSpec(unit) {
  const baseStats = unit.baseCombatStats ?? unit.combatDetails?.combatStats ?? {};
  const combatStats = [];
  const combatStatsStrings = [];
  for (const [name, value] of Object.entries(baseStats)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      combatStatsStrings.push([name, value]);
      continue;
    }
    if (typeof value !== 'number') continue;
    assertFinite(value, `unit ${unit.hrid}.combatStats.${name}`);
    combatStats.push([name, value]);
  }

  const levels = {};
  for (const levelField of [
    'staminaLevel',
    'intelligenceLevel',
    'attackLevel',
    'meleeLevel',
    'defenseLevel',
    'rangedLevel',
    'magicLevel',
  ]) {
    const value = unit[levelField];
    if (typeof value === 'number' && Number.isFinite(value)) {
      levels[levelField] = value;
    }
  }

  return {
    hrid: unit.hrid,
    isPlayer: Boolean(unit.isPlayer),
    // JS 侧由真实 Player / Monster 构建：类覆写会重写「类自有」面板字段，
    // Rust 侧据此在 clearCCs 的基准刷新点恢复构造期快照。
    classOwnedStats: true,
    levels,
    combatStats,
    combatStatsStrings,
    ...(unit.equipment?.['/equipment_types/two_hand']?.hrid
      ? { twoHandHrid: unit.equipment['/equipment_types/two_hand'].hrid }
      : {}),
    enrageTime: Number.isFinite(unit.enrageTime) ? unit.enrageTime : 0,
    experience: Number.isFinite(unit.experience) ? unit.experience : 0,
    // 切片 14：JS 玩家 DTO 顶层字段（`playerMapper` 按等级差计算；怪物缺省 0）。
    // 影响经验收益与掉落上下文桶的 `debuffOnLevelGap`。
    debuffOnLevelGap: Number.isFinite(unit.debuffOnLevelGap) ? unit.debuffOnLevelGap : 0,
    houseRooms: unit.houseRooms ?? [],
    guildBuffs: unit.guildBuffs ?? [],
    achievements: unit.achievements ?? null,
    zoneBuffs: unit.zoneBuffs ?? [],
    extraBuffs: unit.extraBuffs ?? [],
    permanentBuffs: Object.values(unit.permanentBuffs ?? {})
      .filter(Boolean)
      .map((buff) => serializeBuff(buff)),
    abilities: unit.abilities.map((ability) => (ability ? serializeAbility(ability) : null)),
    food: unit.food.map((item) => (item ? serializeConsumable(item) : null)),
    drinks: unit.drinks.map((item) => (item ? serializeConsumable(item) : null)),
  };
}

/// 区域怪物模板：对 `randomSpawnInfo.spawns` + `bossSpawns` 里每个 hrid 实例化 `new Monster(...)`
/// 并快照；按 `(zoneHrid, difficultyTier)` 缓存（模板只读，可跨模拟复用）。
export function buildEncounterTemplates(zoneHrid, difficultyTier, fightInfo) {
  const cacheKey = `${zoneHrid}|${difficultyTier}`;
  const cached = encounterTemplateCache.get(cacheKey);
  if (cached) return cached;

  const entries = [
    ...(fightInfo?.randomSpawnInfo?.spawns ?? []).map((spawn) => [spawn.combatMonsterHrid, spawn.difficultyTier]),
    ...(fightInfo?.bossSpawns ?? []).map((spawn) => [spawn.combatMonsterHrid, spawn.difficultyTier]),
  ];

  const seen = new Set();
  const templates = [];
  for (const [hrid, spawnTier] of entries) {
    const finalTier = spawnTier + difficultyTier;
    const dedupeKey = `${hrid}|${finalTier}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const monster = new Monster(hrid, finalTier);
    settleUnitForSnapshot(monster);
    templates.push({ hrid, difficultyTier: finalTier, spec: dumpUnitSpec(monster) });
  }

  encounterTemplateCache.set(cacheKey, templates);
  return templates;
}

/// `tryUseAbility` 在 blaze / bloom 属性命中时现场 `new Ability('blaze' | 'bloom')`（JS 语义：
/// 等级固定 1、触发器取默认表、构造不消耗随机数也不依赖运行时状态），因此模板可一次构造复用。
/// 数据缺定义时返回 `null`：Rust 侧在属性真正命中时会给出对应报错，等价 JS 现场构造抛错。
function buildSpecialAbilityTemplate(hrid) {
  try {
    return serializeAbility(new Ability(hrid));
  } catch {
    return null;
  }
}

let blazeAbilityTemplate;
let blazeAbilityTemplateReady = false;
function getBlazeAbilityTemplate() {
  if (!blazeAbilityTemplateReady) {
    blazeAbilityTemplate = buildSpecialAbilityTemplate('blaze');
    blazeAbilityTemplateReady = true;
  }
  return blazeAbilityTemplate;
}

let bloomAbilityTemplate;
let bloomAbilityTemplateReady = false;
function getBloomAbilityTemplate() {
  if (!bloomAbilityTemplateReady) {
    bloomAbilityTemplate = buildSpecialAbilityTemplate('bloom');
    bloomAbilityTemplateReady = true;
  }
  return bloomAbilityTemplate;
}

/// 生产路径支持判定：不满足时调用方必须回退 JS 引擎（返回原因供日志/UI 使用）。
///
/// 切片 14：`minimalResult` / `logCombatEvents` / `enableHpMpVisualization` 三条闸门已解除
/// ——full-result 全量覆盖（经验记账、掉落上下文桶、1000-tick 时序快照、激怒层数），
/// 战斗日志只影响控制台输出（无数据），时序随 simResult 的 `timeSeriesData` 一次性返回
/// （wasm 侧没有流式 progress）。仍留 JS 的是副本 / 迷宫 / 卷轴 / 公会试炼与无区域。
export function getProductionSupport({ zone, labyrinth, isDungeon, simulationContext, options }) {
  if (!zone) return { supported: false, reason: 'no_zone' };
  if (isDungeon || zone.isDungeon) return { supported: false, reason: 'dungeon' };
  if (labyrinth) return { supported: false, reason: 'labyrinth' };
  if (options?.combatScrollsEnabled) return { supported: false, reason: 'combat_scrolls' };
  if (simulationContext?.isGuildTrial) return { supported: false, reason: 'guild_trial' };
  return { supported: true, reason: '' };
}

/// 组装 `run_production_simulation` 请求 JSON。
///
/// 直接读活 `Zone` 实例的 `monsterSpawnInfo` / `dungeonSpawnInfo`（Zone 构造时已从
/// 游戏数据拷贝），worker 侧因此无需再引 `actionDetailMap`。
export function buildProductionRequest({ players, zone, labyrinth = null, seed, simulationTimeLimit, options = {} }) {
  const zoneHrid = zone?.hrid ?? '';
  const zoneDifficultyTier = zone?.difficultyTier ?? 0;
  for (const player of players) {
    settleUnitForSnapshot(player);
  }
  return {
    options: {
      seed: seed >>> 0,
      simulationTimeLimit,
      realResult: true,
      minimalResult: Boolean(options.minimalResult),
      zonePresent: Boolean(zone),
      zoneHrid,
      zoneDifficultyTier,
      zoneMonsterSpawnInfo: zone?.monsterSpawnInfo ?? null,
      zoneDungeonSpawnInfo: zone?.dungeonSpawnInfo ?? null,
      encounterTemplates: zone ? buildEncounterTemplates(zoneHrid, zoneDifficultyTier, zone.monsterSpawnInfo) : [],
      // 切片 14：full-result 经验记账需要的风格技能表（静态数据，进程内缓存）。
      combatStyleSkillExpMap: getCombatStyleSkillExpMap(),
      logCombatEvents: Boolean(options.logCombatEvents),
      enableHpMpVisualization: Boolean(options.enableHpMpVisualization),
      combatScrollsEnabled: Boolean(options.combatScrollsEnabled),
      isGuildTrial: Boolean(options.isGuildTrial),
      blazeAbility: getBlazeAbilityTemplate(),
      bloomAbility: getBloomAbilityTemplate(),
      // 切片 12：候选轮 shouldStop 谓词（watchHrid + deathLimit）。deathLimit 为
      // Infinity / 非有限数时传 null——Rust 侧反序列化为 None（= JS Infinity，仅空蓝停止）。
      earlyStop: options.earlyStop
        ? {
            watchHrid: options.earlyStop.watchHrid,
            deathLimit:
              options.earlyStop.deathLimit != null && Number.isFinite(options.earlyStop.deathLimit)
                ? options.earlyStop.deathLimit
                : null,
          }
        : null,
      // 切片 13：观察器（阈值区间 + 闲置食物下界，等价 JS observeFoodOptimizerThresholds /
      // observeInactiveFoodThresholds）。纯读窥视——不改 RNG/事件流/simResult。
      observers: options.observers ? { watchHrid: options.observers.watchHrid } : null,
    },
    players: players.map((player) => dumpUnitSpec(player)),
  };
}

/// 调用 wasm 生产出口；`error` 非空时抛错（调用方捕获后回退 JS）。
/// 返回 `{ simResult, observers }`：simResult 与 JS 引擎逐字段一致（parity 对账对象）；
/// observers 在未开启时为 null，开启时为 `{ thresholdRanges, inactiveMinimum }`（独立输出
/// 字段，保证 simResult 逐字节不变）。
export function runWasmProductionSimulation(engine, request) {
  const output = JSON.parse(engine.run_production_simulation(JSON.stringify(request)));
  if (output.error) {
    throw new Error(`wasm production simulation failed: ${output.error.name}: ${output.error.message}`);
  }
  return { simResult: output.simResult, observers: output.observers ?? null };
}

/// 调试用：返回 `{ simResult, observers, eventCount, eventTrace, error }` 原始输出（`traceLimit > 0` 时轨迹有内容）。
export function runWasmProductionSimulationVerbose(engine, request) {
  return JSON.parse(engine.run_production_simulation(JSON.stringify(request)));
}
