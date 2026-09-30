// 场景构造与请求序列化（切片 4 parity → 切片 21B golden 化后保留的部分）：
// - 合成单位 / 技能 / 消耗品按 B 层类（CombatUnit/Ability/Consumable/Trigger）构建，
//   序列化成 Rust `run_simulator_operations` 请求 JSON——scenario 定义本身是确定性
//   输入，golden 快照锁 Rust 探针的轨迹输出。
// - 数值归一：非有限数（NaN/±Infinity）记 null（Rust serde_json 同样输出 null），
//   `undefined` 键**删除**（Rust 侧 `skip_serializing_if = "Option::is_none"` 的等价语义）。
import Ability from '../../../combatsimulator/ability.js';
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
// JS 侧运行段已随切片 21B（定案 D2）删除：JS 模拟执行层（CombatSimulator）不复
// 存在，Rust 探针（`engine/src/sim_probe.rs`）的轨迹输出改为与 golden 快照对账
// （`wasmEngineSimulatorParity.test.js`）。场景构造与请求序列化保留如下。
// ---------------------------------------------------------------------------

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
