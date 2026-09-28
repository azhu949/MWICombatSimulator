// JS 侧对账驱动（切片 4 parity）：用**真实** JS 引擎跑同一场景，产出与
// `engine/src/sim_probe.rs` 同构的轨迹（事件流水 + simResult 调用流水 + 单位快照）。
// 两侧 schema 成对维护：任何一侧改动场景字段、轨迹字段或数值归一规则，另一侧必须同步。
//
// 关键契约：
// - 随机数：整轮模拟期间用 `createSeededRandom(seed)`（mulberry32）替换 `Math.random`，
//   Rust 侧等价于 `Mulberry32::new(seed)`；消费顺序与次数必须逐位一致。
// - zone：使用只提供 `getRandomEncounter()` 的最小 zone（`isDungeon: false`），
//   第 N 次调用返回 `encounters[min(N, len - 1)]`（与 Rust `get_random_encounter` 相同）。
// - 数值归一：非有限数（NaN/±Infinity）记 null（Rust serde_json 同样输出 null），
//   `undefined` 键**删除**（Rust 侧 `skip_serializing_if = "Option::is_none"` 的等价语义）。
import Ability from '../../../combatsimulator/ability.js';
import CombatSimulator from '../../../combatsimulator/combatSimulator.js';
import CombatUnit from '../../../combatsimulator/combatUnit.js';
import Consumable from '../../../combatsimulator/consumable.js';
import Trigger from '../../../combatsimulator/trigger.js';
import combatTriggerDependencyDetailMap from '../../../combatsimulator/data/combatTriggerDependencyDetailMap.json';
import { createSeededRandom } from '../../seededRandom.js';

const MAX_RESULT_CALLS = 4000;

// ---------------------------------------------------------------------------
// 数值归一与序列化
// ---------------------------------------------------------------------------

function normalizeForRust(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForRust(entry));
  }
  if (typeof value === 'object') {
    const normalized = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) {
        continue;
      }
      normalized[key] = normalizeForRust(nested);
    }
    return normalized;
  }
  return value;
}

function assertFiniteNumbers(value, path) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`scenario serialization produced a non-finite number at ${path}: ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assertFiniteNumbers(nested, `${path}.${key}`);
    }
  }
}

function serializeTrigger(trigger) {
  const dependency = combatTriggerDependencyDetailMap[trigger.dependencyHrid];
  if (!dependency) {
    throw new Error(`missing combatTriggerDependencyDetailMap entry for ${trigger.dependencyHrid}`);
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
    ratioBoost: buff.ratioBoost,
    flatBoost: buff.flatBoost,
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
    damageFlat: effect.damageFlat,
    damageRatio: effect.damageRatio,
    bonusAccuracyRatio: effect.bonusAccuracyRatio,
    armorDamageRatio: effect.armorDamageRatio,
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
    level: ability.level,
    manaCost: ability.manaCost,
    cooldownDuration: ability.cooldownDuration,
    castDuration: ability.castDuration,
    isSpecialAbility: ability.isSpecialAbility,
    abilityEffects: ability.abilityEffects.map((effect) => serializeAbilityEffect(effect)),
    triggers: ability.triggers.map((trigger) => serializeTrigger(trigger)),
    lastUsed: ability.lastUsed,
  };
}

function serializeConsumable(item) {
  return {
    hrid: item.hrid,
    cooldownDuration: item.cooldownDuration,
    hitpointRestore: item.hitpointRestore,
    manapointRestore: item.manapointRestore,
    recoveryDuration: item.recoveryDuration,
    // JS 字段拼写为 catagoryHrid（上游拼写错误），Rust 侧字段名为 categoryHrid。
    categoryHrid: item.catagoryHrid,
    buffs: item.buffs.map((buff) => serializeBuff(buff)),
    triggers: item.triggers.map((trigger) => serializeTrigger(trigger)),
    lastUsed: item.lastUsed,
  };
}

// ---------------------------------------------------------------------------
// 场景定义 → JS 单位 / Rust 请求 JSON
// ---------------------------------------------------------------------------

function buildAbility(def) {
  const triggers = def.triggers ? def.triggers.map((dto) => Trigger.createFromDTO(dto)) : null;
  return new Ability(def.hrid, def.level ?? 1, triggers);
}

function buildConsumable(def) {
  const triggers = def.triggers ? def.triggers.map((dto) => Trigger.createFromDTO(dto)) : null;
  return new Consumable(def.hrid, triggers);
}

function buildUnit(def) {
  const unit = new CombatUnit();
  unit.hrid = def.hrid;
  unit.isPlayer = Boolean(def.isPlayer);
  if (def.levels) {
    Object.assign(unit, def.levels);
  }
  for (const [name, value] of def.combatStats ?? []) {
    unit.combatDetails.combatStats[name] = value;
  }
  unit.enrageTime = def.enrageTime ?? 0;
  unit.experience = def.experience ?? 0;
  unit.equipment = def.twoHandHrid ? { '/equipment_types/two_hand': { hrid: def.twoHandHrid } } : undefined;
  unit.houseRooms = def.houseRooms ?? [];
  unit.guildBuffs = def.guildBuffs ?? [];
  unit.achievements = def.achievements ?? null;
  unit.zoneBuffs = def.zoneBuffs ?? [];
  unit.extraBuffs = def.extraBuffs ?? [];

  unit.refreshBaseCombatStats();
  unit.updateCombatDetails();

  (def.abilities ?? []).forEach((abilityDef, index) => {
    if (abilityDef) {
      unit.abilities[index] = buildAbility(abilityDef);
    }
  });
  (def.food ?? []).forEach((consumableDef, index) => {
    if (consumableDef) {
      unit.food[index] = buildConsumable(consumableDef);
    }
  });
  (def.drinks ?? []).forEach((consumableDef, index) => {
    if (consumableDef) {
      unit.drinks[index] = buildConsumable(consumableDef);
    }
  });

  return unit;
}

function serializeUnit(def) {
  const unit = buildUnit(def);
  const abilities = unit.abilities.map((ability) => (ability ? serializeAbility(ability) : null));
  const food = unit.food.map((item) => (item ? serializeConsumable(item) : null));
  const drinks = unit.drinks.map((item) => (item ? serializeConsumable(item) : null));
  const serialized = {
    hrid: def.hrid,
    isPlayer: Boolean(def.isPlayer),
    ...(def.levels ? { levels: { ...def.levels } } : {}),
    combatStats: def.combatStats ?? [],
    ...(def.twoHandHrid ? { twoHandHrid: def.twoHandHrid } : {}),
    enrageTime: def.enrageTime ?? 0,
    experience: def.experience ?? 0,
    houseRooms: def.houseRooms ?? [],
    guildBuffs: def.guildBuffs ?? [],
    achievements: def.achievements ?? null,
    zoneBuffs: def.zoneBuffs ?? [],
    extraBuffs: def.extraBuffs ?? [],
    abilities,
    food,
    drinks,
  };
  assertFiniteNumbers(serialized, `unit ${def.hrid}`);
  return serialized;
}

/// 场景 → Rust `run_simulator_operations` 请求 JSON。
export function buildScenarioRequest(scenario) {
  const request = {
    runs: [
      {
        options: {
          seed: scenario.seed,
          simulationTimeLimit: scenario.simulationTimeLimit,
          traceLimit: scenario.traceLimit ?? 400,
          maxResultCalls: MAX_RESULT_CALLS,
          zonePresent: true,
          zoneIsDungeon: false,
          labyrinthPresent: false,
          encounterSpecs: scenario.encounters.map((encounter) => encounter.map((def) => serializeUnit(def))),
          promotionSpecs: [],
          blazeAbility: serializeAbility(new Ability('blaze')),
          bloomAbility: serializeAbility(new Ability('bloom')),
        },
        players: scenario.players.map((def) => serializeUnit(def)),
      },
    ],
  };
  assertFiniteNumbers(request, 'request');
  return request;
}

// ---------------------------------------------------------------------------
// JS 侧运行
// ---------------------------------------------------------------------------

/// 记录 simResult 调用流水的替身（等价切片 4 需要的 `minimalResult` 语义）。
class ParitySimResult {
  constructor(shared) {
    this.shared = shared;
  }

  push(method, args) {
    this.shared.callCount += 1;
    if (this.shared.calls.length < MAX_RESULT_CALLS) {
      this.shared.calls.push({ method, args: normalizeForRust(args) });
    }
  }

  addDeath(unit) {
    this.push('addDeath', [unit?.hrid ?? null]);
  }

  addAttack(source, target, ability, outcome) {
    this.push('addAttack', [source?.hrid ?? null, target?.hrid ?? null, ability, outcome]);
  }

  addHitpointsGained(unit, sourceHrid, amount) {
    this.push('addHitpointsGained', [unit?.hrid ?? null, sourceHrid, amount]);
  }

  addManapointsGained(unit, sourceHrid, amount) {
    this.push('addManapointsGained', [unit?.hrid ?? null, sourceHrid, amount]);
  }

  addHitpointsSpent(unit, sourceHrid, amount) {
    this.push('addHitpointsSpent', [unit?.hrid ?? null, sourceHrid, amount]);
  }

  addRanOutOfManaCount(unit, ranOut, time) {
    this.push('addRanOutOfManaCount', [unit?.hrid ?? null, Boolean(ranOut), time]);
  }

  addConsumableUse(unit, consumable) {
    this.push('addConsumableUse', [unit?.hrid ?? null, consumable?.hrid ?? null]);
  }

  addEncounterEnd() {
    this.push('addEncounterEnd', []);
  }

  updateTimeSpentAlive(hrid, alive, time) {
    this.push('updateTimeSpentAlive', [hrid, Boolean(alive), time]);
  }

  setDropRateMultipliers(unit) {
    this.push('setDropRateMultipliers', [unit?.hrid ?? null]);
  }

  setManaUsed(unit) {
    this.push('setManaUsed', [unit?.hrid ?? null]);
  }

  setScrollUsageContext(allowed, context) {
    this.push('setScrollUsageContext', [Boolean(allowed), context]);
  }

  setScrollUsageDisabled(disabled) {
    this.push('setScrollUsageDisabled', [Boolean(disabled)]);
  }

  // 以下钩子在切片 4 场景（普通区域 / 无卷轴 / 无经验）不会被引擎调用，保持空实现。
  setScrollConfiguration() {}

  addTimeSeriesSnapshot() {}

  addWipeEvent() {}

  updateDungenonFinish() {}

  calculateExperienceGain() {
    return null;
  }

  addExperienceGainValues() {}
}

/// 事件 → 轨迹条目（字段集合与 Rust `EventTraceEntry` 成对维护）。
function describeEvent(event) {
  const entry = { time: event.time, type: event.type, source: null, target: null, hrid: null, value: null };
  switch (event.type) {
    case 'autoAttack':
      entry.source = event.source?.hrid ?? null;
      break;
    case 'abilityCastEndEvent':
      entry.source = event.source?.hrid ?? null;
      entry.hrid = event.ability?.hrid ?? null;
      break;
    case 'consumableTick':
      entry.source = event.source?.hrid ?? null;
      entry.hrid = event.consumable?.hrid ?? null;
      entry.value = event.currentTick;
      break;
    case 'damageOverTime':
      entry.source = event.sourceRef?.hrid ?? null;
      entry.target = event.target?.hrid ?? null;
      entry.value = event.currentTick;
      break;
    case 'checkBuffExpiration':
      entry.source = event.source?.hrid ?? null;
      entry.hrid = event.buffUniqueHrid ?? null;
      break;
    case 'playerRespawn':
      entry.hrid = event.hrid ?? null;
      break;
    case 'stunExpiration':
    case 'blindExpiration':
    case 'silenceExpiration':
    case 'awaitCooldownEvent':
      entry.source = event.source?.hrid ?? null;
      break;
    case 'curseExpiration':
      entry.source = event.source?.hrid ?? null;
      entry.value = event.curseAmount;
      break;
    case 'weakenExpiration':
      entry.source = event.source?.hrid ?? null;
      entry.value = event.weakenAmount;
      break;
    case 'furyExpiration':
      entry.source = event.source?.hrid ?? null;
      entry.value = event.furyAmount;
      break;
    case 'enrageTick':
      entry.value = event.encounterTime;
      break;
    case 'scrollRenewal':
      entry.hrid = event.itemHrid ?? null;
      entry.value = event.token;
      break;
    default:
      break;
  }
  return entry;
}

function unitSnapshot(unit) {
  const combatBuffs = {};
  const combatBuffKeys = Object.keys(unit.combatBuffs);
  for (const key of combatBuffKeys) {
    const buff = unit.combatBuffs[key];
    combatBuffs[key] = {
      uniqueHrid: buff.uniqueHrid,
      typeHrid: buff.typeHrid,
      ratioBoost: buff.ratioBoost,
      flatBoost: buff.flatBoost,
      duration: buff.duration ?? null,
      startTime: buff.startTime ?? null,
    };
  }
  return normalizeForRust({
    hrid: unit.hrid,
    isPlayer: Boolean(unit.isPlayer),
    currentHitpoints: unit.combatDetails.currentHitpoints,
    maxHitpoints: unit.combatDetails.maxHitpoints,
    currentManapoints: unit.combatDetails.currentManapoints,
    maxManapoints: unit.combatDetails.maxManapoints,
    isStunned: unit.isStunned,
    stunExpireTime: unit.stunExpireTime ?? null,
    isBlinded: unit.isBlinded,
    blindExpireTime: unit.blindExpireTime ?? null,
    isSilenced: unit.isSilenced,
    silenceExpireTime: unit.silenceExpireTime ?? null,
    isOutOfMana: unit.isOutOfMana,
    weakenExpireTime: unit.weakenExpireTime ?? null,
    enrageTime: unit.enrageTime,
    experience: unit.experience,
    combatDetails: unit.combatDetails,
    combatBuffKeys,
    combatBuffs,
    abilities: unit.abilities.map((ability) => (ability ? { hrid: ability.hrid, lastUsed: ability.lastUsed } : null)),
    food: unit.food.map((item) => (item ? { hrid: item.hrid, lastUsed: item.lastUsed } : null)),
    drinks: unit.drinks.map((item) => (item ? { hrid: item.hrid, lastUsed: item.lastUsed } : null)),
    abilityManaCosts: [...unit.abilityManaCosts.entries()].map(([hrid, manaCost]) => ({ hrid, manaCost })),
  });
}

function buildZoneStub(scenario, createdEnemies) {
  let calls = 0;
  return {
    hrid: '/parity/zone',
    isDungeon: false,
    encountersKilled: 0,
    failWave() {},
    getRandomEncounter() {
      const index = Math.min(calls, scenario.encounters.length - 1);
      calls += 1;
      const enemies = scenario.encounters[index].map((def) => buildUnit(def));
      createdEnemies.push(...enemies);
      return enemies;
    },
  };
}

class ParityCombatSimulator extends CombatSimulator {
  constructor(players, zone, shared) {
    super(players, zone, null, {
      minimalResult: true,
      logCombatEvents: false,
      enableHpMpVisualization: false,
      combatScrollsEnabled: false,
    });
    this.shared = shared;
  }

  createSimResult() {
    return new ParitySimResult(this.shared);
  }

  processEvent(event) {
    this.shared.eventCount += 1;
    if (this.shared.trace.length < this.shared.traceLimit) {
      this.shared.trace.push(describeEvent(event));
    }
    return super.processEvent(event);
  }
}

/// 跑一轮 JS 场景，返回与 Rust 探针同构的结果对象。
export async function runJsScenario(scenario) {
  const shared = { calls: [], callCount: 0, trace: [], eventCount: 0, traceLimit: scenario.traceLimit ?? 400 };
  const createdEnemies = [];
  const players = scenario.players.map((def) => buildUnit(def));
  const zone = buildZoneStub(scenario, createdEnemies);

  const originalRandom = Math.random;
  Math.random = createSeededRandom(scenario.seed);
  let simulatedTime = null;
  try {
    const simulator = new ParityCombatSimulator(players, zone, shared);
    const result = await simulator.simulate(scenario.simulationTimeLimit);
    simulatedTime = result.simulatedTime;
  } finally {
    Math.random = originalRandom;
  }

  return {
    simulatedTime,
    stoppedEarly: false,
    eventCount: shared.eventCount,
    eventTrace: shared.trace,
    resultCalls: shared.calls,
    resultCallCount: shared.callCount,
    units: [...players, ...createdEnemies].map(unitSnapshot),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// 对账
// ---------------------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function firstObjectDiff(left, right, path) {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return `${path}: 类型不一致（${Array.isArray(left) ? 'array' : typeof left} vs ${Array.isArray(right) ? 'array' : typeof right}）`;
    }
    if (left.length !== right.length) {
      return `${path}.length: js=${left.length} rust=${right.length}`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const nested = firstObjectDiff(left[index], right[index], `${path}[${index}]`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const hasLeft = Object.hasOwn(left, key);
      const hasRight = Object.hasOwn(right, key);
      if (hasLeft !== hasRight) {
        const only = hasLeft ? 'js' : 'rust';
        const value = canonicalJson(hasLeft ? left[key] : right[key]);
        return `${path}.${key}: 仅 ${only} 侧存在（值 ${value}）`;
      }
      const nested = firstObjectDiff(left[key], right[key], `${path}.${key}`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  const leftText = canonicalJson(left);
  const rightText = canonicalJson(right);
  if (leftText !== rightText) {
    return `${path}: js=${truncate(leftText)} rust=${truncate(rightText)}`;
  }
  return null;
}

function truncate(text, limit = 200) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function firstDiffIndex(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftText = canonicalJson(left[index]);
    const rightText = canonicalJson(right[index]);
    if (leftText !== rightText) {
      return { index, left: leftText, right: rightText };
    }
  }
  return null;
}

/// 返回首个分歧描述（null 表示完全一致）。
export function findSimulationDivergence(jsResult, rustResult) {
  if (!rustResult) {
    return 'rust result missing';
  }
  if (rustResult.error) {
    return `rust run failed with ${rustResult.error.name}: ${rustResult.error.message}`;
  }
  if (jsResult.simulatedTime !== rustResult.simulatedTime) {
    return `simulatedTime mismatch: js=${jsResult.simulatedTime} rust=${rustResult.simulatedTime}`;
  }
  if (jsResult.eventCount !== rustResult.eventCount) {
    return `eventCount mismatch: js=${jsResult.eventCount} rust=${rustResult.eventCount}`;
  }
  const traceDiff = firstDiffIndex(jsResult.eventTrace, rustResult.eventTrace);
  if (traceDiff) {
    return `eventTrace diverges at index ${traceDiff.index}: js=${traceDiff.left} rust=${traceDiff.right}`;
  }
  if (jsResult.resultCallCount !== rustResult.resultCallCount) {
    return `resultCallCount mismatch: js=${jsResult.resultCallCount} rust=${rustResult.resultCallCount}`;
  }
  const callDiff = firstDiffIndex(jsResult.resultCalls, rustResult.resultCalls);
  if (callDiff) {
    const detail = firstObjectDiff(
      jsResult.resultCalls[callDiff.index],
      rustResult.resultCalls[callDiff.index],
      'resultCalls',
    );
    return `resultCalls diverge at index ${callDiff.index}: js=${truncate(callDiff.left)} rust=${truncate(
      callDiff.right,
    )}${detail ? ` (${detail})` : ''}`;
  }
  const unitsDiff = firstDiffIndex(jsResult.units, rustResult.units);
  if (unitsDiff) {
    const detail = firstObjectDiff(jsResult.units[unitsDiff.index], rustResult.units[unitsDiff.index], 'unit');
    return `units diverge at index ${unitsDiff.index}${detail ? `: ${detail}` : ''}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 场景定义
// ---------------------------------------------------------------------------

const ABILITY_POOL = [
  '/abilities/fireball',
  '/abilities/stunning_blow',
  '/abilities/firestorm',
  '/abilities/life_drain',
  '/abilities/penetrating_strike',
  '/abilities/silencing_shot',
  '/abilities/natures_veil',
  '/abilities/heal',
  '/abilities/quick_aid',
  '/abilities/berserk',
  '/abilities/speed_aura',
  '/abilities/insanity',
];

function combatStats(entries) {
  return entries;
}

/// 定向场景 A：双玩家 vs 双敌人，覆盖技能四类效果、DoT、CC、诅咒/狂暴/虚弱、
/// 反伤/报复/吸血/吸蓝、格挡/穿透、激怒、吃喝（含 drink 浓缩缩放）。
export function buildTargetedScenarioA() {
  const player = (index) => ({
    hrid: `/parity/player/${index}`,
    isPlayer: true,
    levels: {
      staminaLevel: 300,
      intelligenceLevel: 400,
      attackLevel: 200,
      meleeLevel: 200,
      defenseLevel: 150,
      rangedLevel: 200,
      magicLevel: 250,
    },
    combatStats: combatStats([
      ['attackInterval', 300_000_000],
      ['stabDamage', 0.05],
      ['smashDamage', 0.05],
      ['magicDamage', 0.05],
      ['rangedDamage', 0.05],
      ['stabAccuracy', 0.1],
      ['criticalRate', 0.02],
      ['criticalDamage', 0.5],
      ['curse', 0.05],
      ['fury', 0.08],
      ['parry', index === 0 ? 0.2 : 0],
      ['pierce', index === 0 ? 0.35 : 0],
      ['mayhem', 0],
      ['lifeSteal', 0.04],
      ['manaLeech', 0.02],
      ['retaliation', 0.03],
      ['physicalThorns', 0.05],
      ['elementalThorns', 0.02],
      ['drinkConcentration', index === 0 ? 0.25 : 0],
      ['foodHaste', index === 1 ? 0.5 : 0],
      ['hpRegenPer10', 0.005],
      ['mpRegenPer10', 0.02],
      ['armor', 0.1],
      ['waterResistance', 0.1],
      ['natureResistance', 0.1],
      ['fireResistance', 0.1],
    ]),
    abilities: [
      { hrid: '/abilities/stunning_blow', level: 1 },
      index === 0 ? { hrid: '/abilities/firestorm', level: 1 } : { hrid: '/abilities/life_drain', level: 1 },
      { hrid: '/abilities/heal', level: 2 },
      { hrid: '/abilities/speed_aura', level: 1 },
    ],
    food: [{ hrid: '/items/donut', triggers: [] }],
    drinks: [{ hrid: '/items/attack_coffee', triggers: [] }],
  });

  const enemy = (index) => ({
    hrid: `/parity/enemy/${index}`,
    isPlayer: false,
    levels: { staminaLevel: 400, defenseLevel: 100, attackLevel: 150, magicLevel: 150 },
    combatStats: combatStats([
      ['attackInterval', 400_000_000],
      ['magicDamage', 0.05],
      ['stabDamage', 0.05],
      ['weaken', 0.2],
      ['parry', index === 0 ? 0.15 : 0],
      ['physicalThorns', 0.06],
      ['retaliation', 0.02],
      ['armor', 0.05],
      ['hpRegenPer10', 0.001],
      ['mpRegenPer10', 0],
      ['tenacity', 25],
    ]),
    enrageTime: 20_000_000_000,
    abilities: [
      { hrid: '/abilities/entangle', level: 1 },
      { hrid: '/abilities/fireball', level: 1 },
      { hrid: '/abilities/silencing_shot', level: 1 },
      { hrid: '/abilities/rejuvenate', level: 1 },
    ],
  });

  return {
    seed: 20240928,
    simulationTimeLimit: 45_000_000_000,
    traceLimit: 400,
    players: [player(0), player(1)],
    encounters: [[enemy(0), enemy(1)]],
  };
}

/// 定向场景 B：单玩家小血量 → 阵亡 → 复活 → 重新开打（覆盖遭遇战结束/玩家复活/复发攻击排程）。
export function buildTargetedScenarioB() {
  return {
    seed: 4242,
    simulationTimeLimit: 190_000_000_000,
    traceLimit: 400,
    players: [
      {
        hrid: '/parity/frail/0',
        isPlayer: true,
        levels: { staminaLevel: 10, intelligenceLevel: 20, attackLevel: 10, magicLevel: 10, meleeLevel: 10 },
        combatStats: combatStats([
          ['attackInterval', 1_000_000_000],
          ['stabDamage', 0],
          ['hpRegenPer10', 0],
          ['mpRegenPer10', 0],
        ]),
        abilities: [{ hrid: '/abilities/minor_heal', level: 1 }],
        food: [{ hrid: '/items/donut', triggers: [] }],
        drinks: [null],
      },
    ],
    encounters: [
      [
        {
          hrid: '/parity/brute/0',
          isPlayer: false,
          levels: { staminaLevel: 50, attackLevel: 200, meleeLevel: 200, defenseLevel: 20 },
          combatStats: combatStats([
            ['attackInterval', 800_000_000],
            ['smashDamage', 0.5],
          ]),
          abilities: [{ hrid: '/abilities/stunning_blow', level: 1 }],
        },
      ],
    ],
  };
}

/// 模糊场景：随机属性/技能组合（同一份定义同时喂给两侧）。
export function buildFuzzScenario(seed) {
  const rng = createSeededRandom(seed * 7919 + 13);
  const pick = (values) => values[Math.floor(rng() * values.length)];
  const ratio = () => Math.round(rng() * 40) / 100;

  const makeAbilities = () => {
    const slots = [null, null, null, null];
    const count = 1 + Math.floor(rng() * 4);
    for (let index = 0; index < count; index += 1) {
      slots[index] = { hrid: pick(ABILITY_POOL), level: 1 + Math.floor(rng() * 3) };
    }
    return slots;
  };

  const player = {
    hrid: '/parity/fuzz/player/0',
    isPlayer: true,
    levels: {
      staminaLevel: 50 + Math.floor(rng() * 400),
      intelligenceLevel: 50 + Math.floor(rng() * 400),
      attackLevel: 20 + Math.floor(rng() * 200),
      meleeLevel: 20 + Math.floor(rng() * 200),
      defenseLevel: 20 + Math.floor(rng() * 200),
      rangedLevel: 20 + Math.floor(rng() * 200),
      magicLevel: 20 + Math.floor(rng() * 200),
    },
    combatStats: combatStats([
      ['attackInterval', 200_000_000 + Math.floor(rng() * 800_000_000)],
      ['stabDamage', ratio()],
      ['smashDamage', ratio()],
      ['magicDamage', ratio()],
      ['stabAccuracy', ratio()],
      ['criticalRate', ratio() / 4],
      ['criticalDamage', ratio()],
      ['curse', rng() < 0.5 ? ratio() : 0],
      ['fury', rng() < 0.5 ? ratio() : 0],
      ['parry', rng() < 0.4 ? ratio() : 0],
      ['pierce', rng() < 0.4 ? ratio() : 0],
      ['mayhem', rng() < 0.3 ? ratio() : 0],
      ['ripple', rng() < 0.3 ? ratio() : 0],
      ['blaze', rng() < 0.3 ? ratio() : 0],
      ['bloom', rng() < 0.3 ? ratio() : 0],
      ['lifeSteal', ratio() / 4],
      ['manaLeech', ratio() / 4],
      ['retaliation', ratio() / 4],
      ['physicalThorns', ratio() / 4],
      ['elementalThorns', ratio() / 4],
      ['drinkConcentration', ratio() / 4],
      ['foodHaste', ratio() / 4],
      ['hpRegenPer10', ratio() / 20],
      ['mpRegenPer10', ratio() / 10],
      ['armor', ratio() / 4],
      ['waterResistance', ratio() / 4],
      ['natureResistance', ratio() / 4],
      ['fireResistance', ratio() / 4],
    ]),
    abilities: makeAbilities(),
    food: [{ hrid: rng() < 0.5 ? '/items/donut' : '/items/blueberry_cake', triggers: [] }],
    drinks: [{ hrid: '/items/attack_coffee', triggers: [] }],
  };

  const enemy = {
    hrid: '/parity/fuzz/enemy/0',
    isPlayer: false,
    levels: {
      staminaLevel: 50 + Math.floor(rng() * 400),
      defenseLevel: 20 + Math.floor(rng() * 150),
      attackLevel: 20 + Math.floor(rng() * 200),
      magicLevel: 20 + Math.floor(rng() * 200),
    },
    combatStats: combatStats([
      ['attackInterval', 200_000_000 + Math.floor(rng() * 800_000_000)],
      ['magicDamage', ratio()],
      ['stabDamage', ratio()],
      ['weaken', rng() < 0.4 ? ratio() : 0],
      ['parry', rng() < 0.3 ? ratio() : 0],
      ['physicalThorns', ratio() / 4],
      ['retaliation', ratio() / 4],
      ['armor', ratio() / 4],
      ['hpRegenPer10', 0],
      ['mpRegenPer10', 0],
      ['tenacity', Math.floor(rng() * 60)],
    ]),
    enrageTime: 10_000_000_000 + Math.floor(rng() * 40_000_000_000),
    abilities: makeAbilities(),
  };

  return {
    seed,
    simulationTimeLimit: 30_000_000_000,
    traceLimit: 400,
    players: [player],
    encounters: [[enemy]],
  };
}
