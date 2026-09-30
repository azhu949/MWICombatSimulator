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
// - 非有限数（NaN/±Infinity）无法经 JSON 传输，遇到即抛错（调用方按失败处置，无 JS 回退）；
// - 调用方必须传入**未初始化**的玩家（`permanentBuffs` 为空，等价 JS t=0 之前）：
//   房屋 / 公会 / 成就 / 区域 / 额外增益的合并由引擎在 t=0 自行完成，桥接重复合并会翻倍；
// - 怪物模板按 `(zoneHrid, difficultyTier)` 缓存：模板只读，可跨模拟复用。
import Ability from '../combatsimulator/ability.js';
import Monster from '../combatsimulator/monster.js';
import combatStyleDetailMap from '../combatsimulator/data/combatStyleDetailMap.json';
import combatTriggerDependencyDetailMap from '../combatsimulator/data/combatTriggerDependencyDetailMap.json';
import { itemDetailIndex } from '../shared/gameDataIndex.js';
import { getCombatScrollBuffTemplate, getCombatScrollDefinition } from '../shared/combatScrolls.js';
import { resolveMarketPrice } from './marketPriceService.js';

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

/// 游戏数据里的 buff `startTime` 可能是 .NET 日期字符串（如副本区域 `buffs` 的
/// `"0001-01-01T00:00:00Z"`）。JS 引擎只在 `typeof startTime === 'number'` 时才把它当作
/// 定时增益（永久增益的字符串/null 开始时间被明确排除在过期判定外，见
/// `combatUnit.js` 的 `removeExpiredBuffs` 注释），因此快照时丢弃非数字 startTime 与
/// JS 语义一致；不丢弃会让 Rust 侧 `startTime: Option<f64>` 反序列化整条请求失败。
function stripNonNumericStartTime(buff) {
  if (!buff || typeof buff !== 'object' || Number.isFinite(buff.startTime)) return buff;
  const { startTime: _ignored, ...rest } = buff;
  return rest;
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
    ...(Number.isFinite(buff.startTime) ? { startTime: buff.startTime } : {}),
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
    houseRooms: (unit.houseRooms ?? []).map((room) => ({
      ...room,
      buffs: (room?.buffs ?? []).map((buff) => stripNonNumericStartTime(buff)),
    })),
    guildBuffs: (unit.guildBuffs ?? []).map((guildBuff) => ({
      ...guildBuff,
      buffs: (guildBuff?.buffs ?? []).map((buff) => stripNonNumericStartTime(buff)),
    })),
    achievements: unit.achievements
      ? {
          ...unit.achievements,
          buffs: (unit.achievements.buffs ?? []).map((buff) => stripNonNumericStartTime(buff)),
        }
      : null,
    zoneBuffs: (unit.zoneBuffs ?? []).map((buff) => stripNonNumericStartTime(buff)),
    extraBuffs: (unit.extraBuffs ?? []).map((buff) => stripNonNumericStartTime(buff)),
    permanentBuffs: Object.values(unit.permanentBuffs ?? {})
      .filter(Boolean)
      .map((buff) => serializeBuff(buff)),
    abilities: unit.abilities.map((ability) => (ability ? serializeAbility(ability) : null)),
    food: unit.food.map((item) => (item ? serializeConsumable(item) : null)),
    drinks: unit.drinks.map((item) => (item ? serializeConsumable(item) : null)),
    // 切片 17：玩家配置的战斗卷轴（JS `normalizeCombatScrolls` 后的对象键序；怪物为空）。
    combatScrolls: Object.entries(unit.combatScrolls ?? {}).map(([itemHrid, configuration]) => ({
      itemHrid,
      quantity: configuration?.quantity ?? null,
    })),
  };
}

/// 区域怪物模板：对 `randomSpawnInfo.spawns` + `bossSpawns` 里每个 hrid 实例化 `new Monster(...)`
/// 并快照；按 `(zoneHrid, difficultyTier)` 缓存（模板只读，可跨模拟复用）。
///
/// 切片 15：副本时还要把 `dungeonInfo` 两张波次表里的怪物一并纳入模板集合——副本刷怪走
/// `getNextWave()`，怪物定义不在 `fightInfo` 里（`fixedSpawnsMap` 各固定波次 +
/// `randomSpawnInfoMap` 各波次区间的 spawns）。
export function buildEncounterTemplates(zoneHrid, difficultyTier, fightInfo, dungeonInfo = null) {
  const cacheKey = `${zoneHrid}|${difficultyTier}`;
  const cached = encounterTemplateCache.get(cacheKey);
  if (cached) return cached;

  const entries = [
    ...(fightInfo?.randomSpawnInfo?.spawns ?? []).map((spawn) => [spawn.combatMonsterHrid, spawn.difficultyTier]),
    ...(fightInfo?.bossSpawns ?? []).map((spawn) => [spawn.combatMonsterHrid, spawn.difficultyTier]),
    ...Object.values(dungeonInfo?.fixedSpawnsMap ?? {}).flatMap((monsters) =>
      (monsters ?? []).map((monster) => [monster.combatMonsterHrid, monster.difficultyTier]),
    ),
    ...Object.values(dungeonInfo?.randomSpawnInfoMap ?? {}).flatMap((wave) =>
      (wave?.spawns ?? []).map((spawn) => [spawn.combatMonsterHrid, spawn.difficultyTier]),
    ),
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

/// 切片 16：迷宫怪物模板（`Labyrinth.getMonster()` = `new Monster(hrid, 0, roomLevel)`，单只）。
///
/// 迷宫每轮遭遇都会生成一只**全新**怪物，但模板只读：这里按 `(monsterHrid, roomLevel)` 缓存
/// 一份已按房间等级缩放并结算过的快照，Rust 侧每次遭遇用 `instantiate_templates` 复刻实例。
/// `difficultyTier` 恒 0（JS `new Monster(hrid, 0, roomLevel)`）。
const labyrinthTemplateCache = new Map();
export function buildLabyrinthEncounterTemplate(labyrinth) {
  const cacheKey = `${labyrinth.monsterHrid}|${labyrinth.roomLevel}`;
  const cached = labyrinthTemplateCache.get(cacheKey);
  if (cached) return cached;

  const monster = labyrinth.getMonster()[0];
  settleUnitForSnapshot(monster);
  const templates = [
    {
      hrid: monster.hrid,
      difficultyTier: Number(monster.difficultyTier ?? 0),
      spec: dumpUnitSpec(monster),
    },
  ];
  labyrinthTemplateCache.set(cacheKey, templates);
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

/// 切片 17：战斗卷轴定义表——玩家配置引用到的 itemHrid 去重后快照
///（`durationNs` + `new Buff(template, 1)` 的注册输入）。Rust 侧不持有游戏数据。
function buildCombatScrollDefinitions(players) {
  const seen = new Set();
  const definitions = [];
  for (const player of players) {
    for (const itemHrid of Object.keys(player.combatScrolls ?? {})) {
      if (seen.has(itemHrid)) continue;
      seen.add(itemHrid);
      const definition = getCombatScrollDefinition(itemHrid);
      if (!definition) continue;
      definitions.push({
        itemHrid,
        durationNs: definition.durationNs,
        buff: serializeBuff(getCombatScrollBuffTemplate(itemHrid)),
      });
    }
  }
  return definitions;
}

/// 切片 20：成本上界观察器请求字段（等价 JS `observeFoodOptimizerCostBound` 的安装快照）。
///
/// 价格由桥侧预解析成 `[hrid, price]` 快照：键序 = 监视玩家 food 槽 `filter(Boolean)`
/// 去重（与 JS 观察器 `foodUsed` 的求和序逐字一致——浮点加法顺序即结果），且只含
/// food 类目条目（等价 `computeFoodCostPerHour` 的 `itemDetailIndex` 类目过滤）；
/// `resolveMarketPrice` 的 ask/bid/vendor 兜底也一并固化，引擎不持有市场数据。
/// 监视玩家未出场或时长非法 → null（Rust 侧同样不激活，输出 null，等价 JS 不装观察器）。
function buildCostBoundSpec(costBound, players, simulationTimeLimit) {
  if (!costBound) return null;
  if (!Number.isFinite(simulationTimeLimit) || simulationTimeLimit <= 0) return null;
  const watch = players.find((player) => player?.hrid === costBound.watchHrid);
  if (!watch) return null;
  assertFinite(costBound.cutoff, 'costBound.cutoff');
  assertFinite(costBound.completedCostPerHour, 'costBound.completedCostPerHour');
  assertFinite(costBound.totalRounds, 'costBound.totalRounds');
  const seen = new Set();
  const prices = [];
  for (const food of watch.food ?? []) {
    if (!food || seen.has(food.hrid)) continue;
    seen.add(food.hrid);
    if (itemDetailIndex[food.hrid]?.categoryHrid !== '/item_categories/food') continue;
    prices.push([food.hrid, resolveMarketPrice(costBound.priceTable, food.hrid, costBound.consumableMode)]);
  }
  return {
    watchHrid: costBound.watchHrid,
    cutoff: costBound.cutoff,
    completedCostPerHour: costBound.completedCostPerHour,
    totalRounds: costBound.totalRounds,
    prices,
  };
}

/// 生产路径支持判定：不满足时本轮 wasm 不可用（返回原因供日志/UI 使用；生产调用方硬失败，无 JS 回退）。
///
/// 切片 14：`minimalResult` / `logCombatEvents` / `enableHpMpVisualization` 三条闸门已解除
/// ——full-result 全量覆盖（经验记账、掉落上下文桶、1000-tick 时序快照、激怒层数），
/// 战斗日志只影响控制台输出（无数据），时序随 simResult 的 `timeSeriesData` 一次性返回
/// （wasm 侧没有流式 progress）。
///
/// 切片 15：副本（dungeon）波次机制纳入覆盖（含团灭计数、逐波存活时间、
/// maxWaveReached、bossSpawns）。minimal 变体把 `addWipeEvent` 覆写为空操作、
/// 也不序列化 `wipeEvents`，不受影响。
///
/// 切片 16：迷宫（labyrinth）纳入覆盖——无 zone 的单怪循环 + 120s 超时重启。
/// 切片 17：战斗卷轴窗口语义纳入覆盖（定义表随请求快照传入）。
/// 切片 19：副本 + full-result + `logCombatEvents` 组合纳入覆盖——团灭日志
/// （`wipeEvents`）由引擎生成，timestamp 用确定性字符串 `t+{simulationTime}`
/// 替代 JS 的 `new Date().toISOString()` 墙钟（UI 仅用作 v-for key，不显示）。
/// 仍留 JS 的还有公会试炼与无区域。
export function getProductionSupport({ zone, labyrinth, isDungeon, simulationContext, options }) {
  if (!zone && !labyrinth) return { supported: false, reason: 'no_zone' };
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
      // 切片 15：副本标记必须显式传递——Rust 侧 `zone_is_dungeon` 默认 false，
      // 缺失时副本会被当作普通区域跑（`getRandomEncounter` 而非 `getNextWave`）。
      zoneIsDungeon: Boolean(zone?.isDungeon),
      zoneMonsterSpawnInfo: zone?.monsterSpawnInfo ?? null,
      zoneDungeonSpawnInfo: zone?.dungeonSpawnInfo ?? null,
      // 切片 16：迷宫模式没有 zone（`payload.zone` 为 null），怪物模板来自
      // `Labyrinth.getMonster()` 的单怪快照（difficultyTier 恒 0）。
      labyrinthPresent: Boolean(labyrinth),
      labyrinthName: labyrinth?.monsterHrid ?? null,
      labyrinthRoomLevel: labyrinth?.roomLevel ?? 0,
      encounterTemplates: zone
        ? buildEncounterTemplates(zoneHrid, zoneDifficultyTier, zone.monsterSpawnInfo, zone.dungeonSpawnInfo)
        : labyrinth
          ? buildLabyrinthEncounterTemplate(labyrinth)
          : [],
      // 切片 14：full-result 经验记账需要的风格技能表（静态数据，进程内缓存）。
      combatStyleSkillExpMap: getCombatStyleSkillExpMap(),
      logCombatEvents: Boolean(options.logCombatEvents),
      enableHpMpVisualization: Boolean(options.enableHpMpVisualization),
      combatScrollsEnabled: Boolean(options.combatScrollsEnabled),
      // 切片 17：卷轴定义表（玩家配置引用的 itemHrid 去重快照）。
      combatScrollDefinitions: buildCombatScrollDefinitions(players),
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
      // 切片 20：成本上界观察器（等价 JS observeFoodOptimizerCostBound）。与 earlyStop
      // 组合成 JS shouldStop 的完整语义（失败谓词优先、成本其次——|| 短路顺序一致）；
      // 停止结论与下界走独立输出字段 costBound，simResult 逐字节不变。
      costBound: buildCostBoundSpec(options.costBound, players, simulationTimeLimit),
    },
    players: players.map((player) => dumpUnitSpec(player)),
  };
}

/// 调用 wasm 生产出口；`error` 非空时抛错（调用方按失败处置，无 JS 回退）。
/// 返回 `{ simResult, observers, costBound }`：simResult 形状由 golden 快照锁定
/// （切片 21B 起 parity 对 golden，JS 引擎已删除）；observers 在未开启时为 null，开启时为 `{ thresholdRanges, inactiveMinimum }`；
/// costBound（切片 20）在未激活时为 null，激活时为 `{ stoppedForCost, costLowerBound }`
///（独立输出字段，保证 simResult 逐字节不变）。
export function runWasmProductionSimulation(engine, request) {
  const output = JSON.parse(engine.run_production_simulation(JSON.stringify(request)));
  if (output.error) {
    throw new Error(`wasm production simulation failed: ${output.error.name}: ${output.error.message}`);
  }
  return { simResult: output.simResult, observers: output.observers ?? null, costBound: output.costBound ?? null };
}

/// 调试用：返回 `{ simResult, observers, eventCount, eventTrace, error }` 原始输出（`traceLimit > 0` 时轨迹有内容）。
export function runWasmProductionSimulationVerbose(engine, request) {
  return JSON.parse(engine.run_production_simulation(JSON.stringify(request)));
}
