// JS 侧对账驱动（切片 3 parity）：用**真实** CombatUnit 执行与 Rust 探针相同的操作脚本，
// 产出与 `engine/src/unit_probe.rs` 同构的轨迹。两侧 schema 成对维护：任何一侧改动
// 操作集、轨迹字段或数值归一规则，另一侧必须同步（否则 parity 测试立刻翻红）。
//
// 数值归一约定：非有限数（NaN/±Infinity）与 undefined 一律记为 null——
// Rust 侧 serde_json 把非有限 f64 序列化为 null，JS 侧若不做归一就会出现
// `NaN !== null` 式的伪分歧（NaN 自比较恒为 false，直接深比较没有意义）。
import CombatUnit from '../../../combatsimulator/combatUnit.js';
import { createSeededRandom } from '../../seededRandom.js';

function normalizeForTrace(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForTrace(entry));
  }
  if (typeof value === 'object') {
    const normalized = {};
    for (const [key, nested] of Object.entries(value)) {
      normalized[key] = normalizeForTrace(nested);
    }
    return normalized;
  }
  return value;
}

// 增益记录的规范化轨迹形态（字段集合与 Rust `buff_to_trace` 成对维护）。
function buffToTrace(buff) {
  return {
    uniqueHrid: buff.uniqueHrid,
    typeHrid: buff.typeHrid,
    ratioBoost: buff.ratioBoost ?? null,
    flatBoost: buff.flatBoost ?? null,
    duration: buff.duration ?? null,
    startTime: buff.startTime ?? null,
    multiplierForSkillHrid: buff.multiplierForSkillHrid ?? '',
    multiplierPerSkillLevel: buff.multiplierPerSkillLevel ?? 0,
  };
}

// 单位全量快照（面板 + 增益注册表 + 源注册表 + 键序），与 Rust `snapshot_unit` 成对维护。
function snapshotJsUnit(unit) {
  const combatBuffKeys = Object.keys(unit.combatBuffs);
  const combatBuffs = {};
  for (const key of combatBuffKeys) {
    combatBuffs[key] = buffToTrace(unit.combatBuffs[key]);
  }

  const permanentBuffKeys = Object.keys(unit.permanentBuffs);
  const permanentBuffs = {};
  for (const key of permanentBuffKeys) {
    permanentBuffs[key] = buffToTrace(unit.permanentBuffs[key]);
  }

  const buffSources = {};
  for (const uniqueHrid of Object.keys(unit.buffSources)) {
    const sources = unit.buffSources[uniqueHrid];
    const keys = [...sources.keys()];
    const entries = {};
    for (const [sourceKey, entry] of sources.entries()) {
      entries[sourceKey] = { buff: buffToTrace(entry.buff), expiresAt: entry.expiresAt, sequence: entry.sequence };
    }
    buffSources[uniqueHrid] = { keys, entries };
  }

  return {
    isPlayer: Boolean(unit.isPlayer),
    twoHandHrid: unit.equipment?.['/equipment_types/two_hand']?.hrid ?? null,
    combatDetails: unit.combatDetails,
    baseCombatStats: unit.baseCombatStats,
    combatBuffKeys,
    combatBuffs,
    permanentBuffKeys,
    permanentBuffs,
    activeBuffSourceKeys: { ...unit.activeBuffSourceKeys },
    buffSourcePolicies: { ...unit.buffSourcePolicies },
    buffSourceSequence: unit.buffSourceSequence,
    buffSources,
  };
}

function pureBuff(uniqueHrid, typeHrid, ratioBoost, flatBoost, duration) {
  return { uniqueHrid, typeHrid, ratioBoost, flatBoost, duration };
}

// 执行操作脚本并返回轨迹（与 Rust run_unit_operations 的输出逐项可比）。
export function driveJsCombatUnit(ops) {
  let unit = null;
  const trace = [];

  const trackValue = (op, value) => {
    trace.push({ op, value: normalizeForTrace(value ?? null) });
  };

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'createUnit':
          unit = new CombatUnit();
          unit.isPlayer = Boolean(op.isPlayer);
          trackValue(op.op, null);
          break;
        case 'setLevels':
          Object.assign(unit, op.levels);
          trackValue(op.op, null);
          break;
        case 'setCombatStat':
          unit.combatDetails.combatStats[op.name] = op.value;
          trackValue(op.op, null);
          break;
        case 'setEquipment':
          unit.equipment =
            op.twoHandHrid === undefined || op.twoHandHrid === null
              ? undefined
              : { '/equipment_types/two_hand': { hrid: op.twoHandHrid } };
          trackValue(op.op, null);
          break;
        case 'setPermanentSources':
          if (op.houseRooms !== undefined) unit.houseRooms = op.houseRooms;
          if (op.guildBuffs !== undefined) unit.guildBuffs = op.guildBuffs;
          if (op.achievements !== undefined) unit.achievements = op.achievements;
          if (op.zoneBuffs !== undefined) unit.zoneBuffs = op.zoneBuffs;
          if (op.extraBuffs !== undefined) unit.extraBuffs = op.extraBuffs;
          trackValue(op.op, null);
          break;
        case 'refreshBase':
          unit.refreshBaseCombatStats();
          trackValue(op.op, null);
          break;
        case 'addBuff': {
          const options = op.sourcePolicy === undefined ? {} : { sourcePolicy: op.sourcePolicy };
          unit.addBuff(op.buff, op.currentTime, op.sourceHrid === undefined ? null : op.sourceHrid, options);
          trackValue(op.op, null);
          break;
        }
        case 'removeBuff': {
          const buff = op.uniqueHrid === undefined || op.uniqueHrid === null ? null : { uniqueHrid: op.uniqueHrid };
          // 缺省（undefined）触发 JS 默认参数 REMOVE_ACTIVE_SOURCE；显式 null 指向 default 源。
          unit.removeBuff(buff, op.sourceHrid === undefined ? undefined : op.sourceHrid);
          trackValue(op.op, null);
          break;
        }
        case 'expireBuff':
          trackValue(
            op.op,
            unit.removeExpiredBuffByUniqueHrid(op.uniqueHrid, op.currentTime, { updateDetails: op.updateDetails }),
          );
          break;
        case 'expireBuffs':
          trackValue(op.op, unit.removeExpiredBuffs(op.currentTime, { updateDetails: op.updateDetails }));
          break;
        case 'clearBuffs':
          unit.clearBuffs();
          trackValue(op.op, null);
          break;
        case 'clearCCs':
          unit.clearCCs();
          trackValue(op.op, null);
          break;
        case 'updateDetails':
          unit.updateCombatDetails();
          trackValue(op.op, null);
          break;
        case 'getBoost':
          trackValue(op.op, unit.getBuffBoost(op.type));
          break;
        case 'getBoosts':
          trackValue(op.op, unit.getBuffBoosts(op.type));
          break;
        case 'addPermanentBuff':
          unit.addPermanentBuff(op.buff);
          trackValue(op.op, null);
          break;
        case 'generatePermanentBuffs':
          unit.generatePermanentBuffs();
          trackValue(op.op, null);
          break;
        case 'snapshotUnit':
          trackValue(op.op, snapshotJsUnit(unit));
          break;
        default:
          throw new Error(`unknown parity op: ${op.op}`);
      }
    } catch (error) {
      trace.push({ op: op.op, error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) } });
    }
  }

  return trace;
}

// 定向脚本：覆盖等级/生命/法力/命中/伤害/闪避/抗性/regen/掉落/威胁/穿透等结算分支、
// 源替换与级联清除、最强源交接与平局、过期扫描、永久增益、clearBuffs/clearCCs、
// bulwark、tenacity 缺失语义，以及各类校验报错。与 Rust 实现逐项对账。
export function buildTargetedCombatUnitOps() {
  return [
    { op: 'createUnit', isPlayer: true },
    {
      op: 'setLevels',
      levels: {
        staminaLevel: 40,
        intelligenceLevel: 35,
        attackLevel: 60,
        meleeLevel: 55,
        defenseLevel: 50,
        rangedLevel: 20,
        magicLevel: 15,
      },
    },
    { op: 'setCombatStat', name: 'maxHitpoints', value: 250 },
    { op: 'setCombatStat', name: 'maxManapoints', value: 175 },
    { op: 'setCombatStat', name: 'maxHitpointsRatio', value: 0.04 },
    { op: 'setCombatStat', name: 'stabAccuracy', value: 0.12 },
    { op: 'setCombatStat', name: 'slashAccuracy', value: 0.07 },
    { op: 'setCombatStat', name: 'smashDamage', value: 0.35 },
    { op: 'setCombatStat', name: 'rangedDamage', value: 0.08 },
    { op: 'setCombatStat', name: 'magicDamage', value: 0.05 },
    { op: 'setCombatStat', name: 'defensiveDamage', value: 0.2 },
    { op: 'setCombatStat', name: 'armor', value: 0.15 },
    { op: 'setCombatStat', name: 'waterResistance', value: 0.05 },
    { op: 'setCombatStat', name: 'fireResistance', value: 0.03 },
    { op: 'setCombatStat', name: 'threat', value: 30 },
    { op: 'setCombatStat', name: 'hpRegenPer10', value: 0.05 },
    { op: 'setCombatStat', name: 'mpRegenPer10', value: 0.02 },
    { op: 'setCombatStat', name: 'attackSpeed', value: 0.2 },
    { op: 'setCombatStat', name: 'combatDropRate', value: 0.1 },
    { op: 'setCombatStat', name: 'combatRareFind', value: 0.2 },
    { op: 'setCombatStat', name: 'combatDropQuantity', value: 0.15 },
    { op: 'setCombatStat', name: 'criticalRate', value: 0.03 },
    { op: 'setCombatStat', name: 'tenacity', value: 50 },
    { op: 'refreshBase' },
    { op: 'updateDetails' },
    { op: 'snapshotUnit' },

    // 覆盖全部结算分支的运行时增益集合。
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/stamina_level', '/buff_types/stamina_level', 0.1, 2, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/intelligence_level', '/buff_types/intelligence_level', 0.05, 1, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/attack_level', '/buff_types/attack_level', 0.02, 0.5, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/melee_level', '/buff_types/melee_level', 0.03, 0.25, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/defense_level', '/buff_types/defense_level', 0.04, 3, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/ranged_level', '/buff_types/ranged_level', 0.06, 0, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/magic_level', '/buff_types/magic_level', 0.07, 1, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/max_hitpoints', '/buff_types/max_hitpoints', 0.5, 10, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/max_manapoints', '/buff_types/max_manapoints', 0.2, 5, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/accuracy', '/buff_types/accuracy', 0.05, 0, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fury_accuracy', '/buff_types/fury_accuracy', 0.1, 0, 5000),
      currentTime: 1000,
    },
    { op: 'addBuff', buff: pureBuff('/buff_uniques/damage', '/buff_types/damage', 0.15, 0, 5000), currentTime: 1000 },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fury_damage', '/buff_types/fury_damage', 0.25, 0, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/evasion_a', '/buff_types/evasion', 0.02, 3, 5000),
      currentTime: 1100,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/evasion_b', '/buff_types/evasion', 0.03, 1, 5000),
      currentTime: 1200,
      sourceHrid: 'src_b',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/attack_speed', '/buff_types/attack_speed', 0.3, 0, 5000),
      currentTime: 1000,
    },
    { op: 'addBuff', buff: pureBuff('/buff_uniques/armor', '/buff_types/armor', 0.1, 0.05, 5000), currentTime: 1000 },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/water_resistance', '/buff_types/water_resistance', 0.1, 0.02, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/nature_resistance', '/buff_types/nature_resistance', 0, 0.03, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fire_resistance', '/buff_types/fire_resistance', 0.2, 0.01, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/hp_regen', '/buff_types/hp_regen', 0.5, 0.01, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/mp_regen', '/buff_types/mp_regen', 0.25, 0.005, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/damage_taken', '/buff_types/damage_taken', 0, 0.07, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/physical_amplify', '/buff_types/physical_amplify', 0, 0.12, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/water_amplify', '/buff_types/water_amplify', 0, 0.02, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/nature_amplify', '/buff_types/nature_amplify', 0, 0.03, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fire_amplify', '/buff_types/fire_amplify', 0, 0.04, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/healing_amplify', '/buff_types/healing_amplify', 0, 0.05, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/cast_speed', '/buff_types/cast_speed', 0, 0.15, 5000),
      currentTime: 1000,
    },
    { op: 'addBuff', buff: pureBuff('/buff_uniques/wisdom', '/buff_types/wisdom', 0, 0.09, 5000), currentTime: 1000 },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/critical_damage', '/buff_types/critical_damage', 0, 0.4, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/life_steal', '/buff_types/life_steal', 0, 0.06, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/physical_thorns', '/buff_types/physical_thorns', 0, 0.08, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/elemental_thorns', '/buff_types/elemental_thorns', 0, 0.04, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/retaliation', '/buff_types/retaliation', 0, 0.11, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/tenacity_flat', '/buff_types/tenacity', 0, 13, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/combat_drop_rate', '/buff_types/combat_drop_rate', 0.2, 0.05, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/rare_find', '/buff_types/rare_find', 0.3, 0.02, 5000),
      currentTime: 1000,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/combat_drop_quantity', '/buff_types/combat_drop_quantity', 0.1, 0.01, 5000),
      currentTime: 1000,
    },
    { op: 'getBoost', type: '/buff_types/evasion' },
    { op: 'getBoosts', type: '/buff_types/evasion' },
    { op: 'getBoosts', type: '/buff_types/missing_type' },
    { op: 'getBoost', type: '/buff_types/missing_type' },
    { op: 'snapshotUnit' },

    // 威胁 ratio 分支：ratio 0.25 → base + base*0.25 + flat。
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/threat_ratio', '/buff_types/threat', 0.25, 5, 1500),
      currentTime: 1000,
    },
    { op: 'snapshotUnit' },
    // 过期：threat 源在 2500 之后过期（REPLACE 级联清 ⇒ 威胁回落到基础值）。
    { op: 'expireBuffs', currentTime: 3000 },
    { op: 'snapshotUnit' },
    // 威胁 ratio 0 分支：覆盖为 base 再 + flat。
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/threat_zero', '/buff_types/threat', 0, 11, 9000),
      currentTime: 3000,
    },
    { op: 'snapshotUnit' },

    // REPLACE：同 uniqueHrid 两个源，活动源移除即级联清除。
    {
      op: 'addBuff',
      buff: pureBuff('/fuzz/scroll', '/buff_types/damage', 0.1, 0, 1000),
      currentTime: 4000,
      sourceHrid: 'scroll:one',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/fuzz/scroll', '/buff_types/damage', 0.2, 0, 9000),
      currentTime: 4100,
      sourceHrid: 'scroll:two',
    },
    { op: 'snapshotUnit' },
    { op: 'removeBuff', uniqueHrid: '/fuzz/scroll' },
    { op: 'snapshotUnit' },

    // 最强源：更弱不交接、平局保留 incumbent、更强交接、活动源过期/移除后交接。
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fierce_aura', '/buff_types/fierce_aura', 0, 0.2, 6000),
      currentTime: 5000,
      sourceHrid: 'ally_a',
      sourcePolicy: 'strongest',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fierce_aura', '/buff_types/fierce_aura', 0, 0.1, 9000),
      currentTime: 5100,
      sourceHrid: 'ally_b',
      sourcePolicy: 'strongest',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fierce_aura', '/buff_types/fierce_aura', 0, 0.2, 9000),
      currentTime: 5200,
      sourceHrid: 'ally_c',
      sourcePolicy: 'strongest',
    },
    { op: 'snapshotUnit' },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/fierce_aura', '/buff_types/fierce_aura', 0, 0.35, 9000),
      currentTime: 5300,
      sourceHrid: 'ally_d',
      sourcePolicy: 'strongest',
    },
    { op: 'snapshotUnit' },
    // ally_a 在 11000 过期 → 交接给次强。
    { op: 'expireBuff', uniqueHrid: '/buff_uniques/fierce_aura', currentTime: 11000 },
    { op: 'snapshotUnit' },
    { op: 'removeBuff', uniqueHrid: '/buff_uniques/fierce_aura' },
    { op: 'snapshotUnit' },
    // 策略冲突 / 不支持的最强源 / 非法策略值 / 缺失 duration。
    { op: 'removeBuff', uniqueHrid: '/fuzz/policy' },
    { op: 'addBuff', buff: pureBuff('/fuzz/policy', '/buff_types/damage', 0.05, 0, 5000), currentTime: 6000 },
    {
      op: 'addBuff',
      buff: pureBuff('/fuzz/policy', '/buff_types/damage', 0.05, 0, 5000),
      currentTime: 6100,
      sourcePolicy: 'strongest',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/fuzz/not_aura', '/buff_types/damage', 0, 1, 5000),
      currentTime: 6000,
      sourcePolicy: 'strongest',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/guardian_aura_armor', '/buff_types/armor', 0, 0.1, 5000),
      currentTime: 6200,
    },
    {
      op: 'addBuff',
      buff: pureBuff('/buff_uniques/guardian_aura_armor', '/buff_types/armor', 0, 0.2, 5000),
      currentTime: 6300,
      sourcePolicy: 'strongest',
    },
    {
      op: 'addBuff',
      buff: pureBuff('/fuzz/policy', '/buff_types/damage', 0.05, 0, 5000),
      currentTime: 6400,
      sourcePolicy: 'bogus',
    },
    {
      op: 'addBuff',
      buff: { uniqueHrid: '/fuzz/no_duration', typeHrid: '/buff_types/damage', ratioBoost: 0, flatBoost: 1 },
      currentTime: 6000,
    },
    { op: 'removeBuff' },

    // 永久增益：同 typeHrid 累加 + generatePermanentBuffs 装配顺序。
    {
      op: 'addPermanentBuff',
      buff: { uniqueHrid: '/perm/house', typeHrid: '/buff_types/damage', ratioBoost: 0.1, flatBoost: 5 },
    },
    {
      op: 'addPermanentBuff',
      buff: { uniqueHrid: '/perm/guild', typeHrid: '/buff_types/damage', ratioBoost: 0.05, flatBoost: 2 },
    },
    {
      op: 'setPermanentSources',
      houseRooms: [
        {
          buffs: [{ uniqueHrid: '/perm/room_a', typeHrid: '/buff_types/max_hitpoints', ratioBoost: 0, flatBoost: 30 }],
        },
        {
          buffs: [{ uniqueHrid: '/perm/room_b', typeHrid: '/buff_types/max_hitpoints', ratioBoost: 0, flatBoost: 20 }],
        },
      ],
      guildBuffs: [
        {
          buffs: [{ uniqueHrid: '/perm/guild_buff', typeHrid: '/buff_types/evasion', ratioBoost: 0.05, flatBoost: 0 }],
        },
      ],
      achievements: {
        buffs: [{ uniqueHrid: '/perm/achievement', typeHrid: '/buff_types/evasion', ratioBoost: 0.01, flatBoost: 0 }],
      },
      zoneBuffs: [{ uniqueHrid: '/perm/zone', typeHrid: '/buff_types/evasion', ratioBoost: 0.01, flatBoost: 2 }],
      extraBuffs: [{ uniqueHrid: '/perm/extra', typeHrid: '/buff_types/evasion', ratioBoost: 0.02, flatBoost: 1 }],
    },
    { op: 'generatePermanentBuffs' },
    { op: 'snapshotUnit' },
    { op: 'clearBuffs' },
    { op: 'snapshotUnit' },
    { op: 'getBoost', type: '/buff_types/evasion' },
    { op: 'expireBuffs', currentTime: 20000 },

    // bulwark：闪击最大伤害叠加防御伤害；clearCCs 重置 damageTaken 并重新捕获基准。
    { op: 'setEquipment', twoHandHrid: 'x_bulwark_shield' },
    { op: 'updateDetails' },
    { op: 'snapshotUnit' },
    { op: 'setEquipment', twoHandHrid: null },
    { op: 'clearCCs' },
    { op: 'snapshotUnit' },
    { op: 'expireBuff', uniqueHrid: '/buff_uniques/unknown', currentTime: 50000 },
    { op: 'expireBuffs', currentTime: 50000, updateDetails: false },
    { op: 'snapshotUnit' },
  ];
}

// 模糊脚本：确定性随机生成大量操作，覆盖源键/策略/时序/过期组合。
// 输入始终为合法形状（比例/时长均为有限数），使两侧都只可能命中单位自身的校验错误。
export function buildFuzzCombatUnitOps(seed, count) {
  const rng = createSeededRandom(seed);
  const buffTypes = [
    '/buff_types/damage',
    '/buff_types/accuracy',
    '/buff_types/evasion',
    '/buff_types/armor',
    '/buff_types/threat',
    '/buff_types/hp_regen',
    '/buff_types/attack_speed',
    '/buff_types/stamina_level',
    '/buff_types/max_hitpoints',
    '/buff_types/combat_drop_rate',
    '/buff_types/critical_rate',
    '/buff_types/cast_speed',
    '/buff_types/life_steal',
    '/buff_types/tenacity',
  ];
  const auraTypes = [
    ['/buff_uniques/fierce_aura', '/buff_types/fierce_aura', 'flatBoost'],
    ['/buff_uniques/guardian_aura_evasion', '/buff_types/evasion', 'ratioBoost'],
  ];
  const sourceKeys = ['ally_a', 'ally_b', null];
  const roundRatio = () => Math.round(rng() * 40) / 200;
  const roundFlat = () => Math.round(rng() * 60) / 10;
  const usedHrids = [];

  const ops = [
    { op: 'createUnit', isPlayer: rng() < 0.5 },
    {
      op: 'setLevels',
      levels: {
        staminaLevel: 1 + Math.floor(rng() * 60),
        intelligenceLevel: 1 + Math.floor(rng() * 60),
        attackLevel: 1 + Math.floor(rng() * 90),
        meleeLevel: 1 + Math.floor(rng() * 90),
        defenseLevel: 1 + Math.floor(rng() * 90),
        rangedLevel: 1 + Math.floor(rng() * 60),
        magicLevel: 1 + Math.floor(rng() * 60),
      },
    },
    { op: 'setCombatStat', name: 'maxHitpoints', value: Math.floor(rng() * 400) },
    { op: 'setCombatStat', name: 'maxManapoints', value: Math.floor(rng() * 400) },
    { op: 'setCombatStat', name: 'armor', value: roundRatio() },
    { op: 'setCombatStat', name: 'threat', value: Math.floor(rng() * 200) },
    { op: 'setCombatStat', name: 'hpRegenPer10', value: roundRatio() },
    { op: 'setCombatStat', name: 'combatDropRate', value: roundRatio() },
    { op: 'refreshBase' },
    { op: 'updateDetails' },
    {
      op: 'setPermanentSources',
      houseRooms: [
        { buffs: [{ uniqueHrid: '/perm/room', typeHrid: '/buff_types/max_hitpoints', ratioBoost: 0, flatBoost: 10 }] },
      ],
      guildBuffs: [
        { buffs: [{ uniqueHrid: '/perm/guild', typeHrid: '/buff_types/evasion', ratioBoost: 0.02, flatBoost: 0 }] },
      ],
      achievements: null,
      zoneBuffs: [{ uniqueHrid: '/perm/zone', typeHrid: '/buff_types/armor', ratioBoost: 0, flatBoost: 1 }],
      extraBuffs: [{ uniqueHrid: '/perm/extra', typeHrid: '/buff_types/damage', ratioBoost: 0.01, flatBoost: 0 }],
    },
  ];

  for (let index = 0; index < count; index += 1) {
    const roll = rng();
    const currentTime = Math.floor(rng() * 8000);
    if (roll < 0.32 || usedHrids.length === 0) {
      const duration = 100 + Math.floor(rng() * 5000);
      if (rng() < 0.15) {
        const [uniqueHrid, typeHrid, strengthField] = auraTypes[Math.floor(rng() * auraTypes.length)];
        const strength = Math.round(rng() * 30) / 100;
        const ratioBoost = strengthField === 'ratioBoost' ? strength : 0;
        const flatBoost = strengthField === 'flatBoost' ? strength : 0;
        ops.push({
          op: 'addBuff',
          buff: pureBuff(uniqueHrid, typeHrid, ratioBoost, flatBoost, duration),
          currentTime,
          sourceHrid: sourceKeys[Math.floor(rng() * sourceKeys.length)],
          sourcePolicy: 'strongest',
        });
      } else {
        // 复用既有 uniqueHrid 以触发策略冲突；否则新建。
        const reuse = usedHrids.length > 0 && rng() < 0.35;
        const uniqueHrid = reuse ? usedHrids[Math.floor(rng() * usedHrids.length)] : `/fuzz/buff_${index}`;
        if (!reuse) usedHrids.push(uniqueHrid);
        const op = {
          op: 'addBuff',
          buff: pureBuff(
            uniqueHrid,
            buffTypes[Math.floor(rng() * buffTypes.length)],
            roundRatio(),
            roundFlat(),
            duration,
          ),
          currentTime,
        };
        if (rng() < 0.6) op.sourceHrid = sourceKeys[Math.floor(rng() * sourceKeys.length)];
        const policyRoll = rng();
        if (policyRoll < 0.08) op.sourcePolicy = 'replace';
        else if (policyRoll < 0.12) op.sourcePolicy = 'strongest';
        else if (policyRoll < 0.14) op.sourcePolicy = 'bogus';
        ops.push(op);
      }
    } else if (roll < 0.44) {
      const op = { op: 'removeBuff' };
      if (rng() < 0.15) {
        // 缺省 uniqueHrid：命中 JS 的 `!uniqueHrid` 提前返回分支。
      } else if (rng() < 0.5) {
        op.uniqueHrid = usedHrids[Math.floor(rng() * usedHrids.length)];
      } else {
        op.uniqueHrid = `/fuzz/unknown_${index}`;
      }
      const sourceRoll = rng();
      if (sourceRoll < 0.4) op.sourceHrid = null;
      else if (sourceRoll < 0.7) op.sourceHrid = sourceKeys[Math.floor(rng() * sourceKeys.length)];
      ops.push(op);
    } else if (roll < 0.5) {
      ops.push({
        op: 'expireBuff',
        uniqueHrid: rng() < 0.7 ? usedHrids[Math.floor(rng() * usedHrids.length)] : `/fuzz/unknown_${index}`,
        currentTime,
      });
    } else if (roll < 0.6) {
      ops.push({ op: 'expireBuffs', currentTime, updateDetails: rng() < 0.8 });
    } else if (roll < 0.72) {
      ops.push({ op: rng() < 0.5 ? 'getBoost' : 'getBoosts', type: buffTypes[Math.floor(rng() * buffTypes.length)] });
    } else if (roll < 0.76) {
      ops.push({ op: 'clearBuffs' });
    } else if (roll < 0.79) {
      ops.push({ op: 'clearCCs' });
    } else if (roll < 0.85) {
      ops.push({ op: 'updateDetails' });
    } else if (roll < 0.9) {
      ops.push({
        op: 'addPermanentBuff',
        buff: {
          uniqueHrid: `/perm/fuzz_${index}`,
          typeHrid: buffTypes[Math.floor(rng() * buffTypes.length)],
          ratioBoost: roundRatio(),
          flatBoost: roundFlat(),
        },
      });
    } else if (roll < 0.93) {
      ops.push({ op: 'generatePermanentBuffs' });
    } else if (roll < 0.97) {
      ops.push({ op: 'snapshotUnit' });
    } else {
      ops.push({ op: 'setEquipment', twoHandHrid: rng() < 0.5 ? 'x_bulwark_shield' : null });
      ops.push({ op: 'updateDetails' });
    }
  }

  return ops;
}
