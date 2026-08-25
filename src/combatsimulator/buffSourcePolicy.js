// Buff 源选择刻意采用显式选择（opt-in）方式。战斗引擎历史上
// 对运行时增益使用"后写覆盖"（last-write-wins）策略；只有官方队伍光环增益使用
// 最强源选择与源交接（handoff）。
import abilityDetailMap from './data/abilityDetailMap.json';

export const BUFF_SOURCE_POLICY = Object.freeze({
  REPLACE: 'replace',
  STRONGEST: 'strongest',
});

export const PARTY_AURA_ABILITY_HRIDS = new Set([
  '/abilities/speed_aura',
  '/abilities/guardian_aura',
  '/abilities/fierce_aura',
  '/abilities/critical_aura',
  '/abilities/mystic_aura',
]);

// 官方客户端数据快照当前将每个队伍光环定义为恰好落在这几个字段之一中的
// 非负加成。为每个 uniqueHrid 显式保留强度字段：这避免了为负面减益或
// 未来混合 ratio 与 flat 数值的增益凭空发明一套通用排序规则。
export const PARTY_AURA_STRENGTH_FIELDS = Object.freeze({
  '/buff_uniques/speed_aura_attack_speed': 'ratioBoost',
  '/buff_uniques/speed_aura_cast_speed': 'flatBoost',
  '/buff_uniques/guardian_aura_healing_amplify': 'flatBoost',
  '/buff_uniques/guardian_aura_evasion': 'ratioBoost',
  '/buff_uniques/guardian_aura_armor': 'flatBoost',
  '/buff_uniques/guardian_aura_water_resistance': 'flatBoost',
  '/buff_uniques/guardian_aura_nature_resistance': 'flatBoost',
  '/buff_uniques/guardian_aura_fire_resistance': 'flatBoost',
  '/buff_uniques/fierce_aura': 'flatBoost',
  '/buff_uniques/critical_aura_rate': 'flatBoost',
  '/buff_uniques/critical_aura_damage': 'flatBoost',
  '/buff_uniques/mystic_aura_water_amplify': 'flatBoost',
  '/buff_uniques/mystic_aura_nature_amplify': 'flatBoost',
  '/buff_uniques/mystic_aura_fire_amplify': 'flatBoost',
});

export const PARTY_AURA_BUFF_HRIDS = new Set(Object.keys(PARTY_AURA_STRENGTH_FIELDS));

// 从已检入的客户端数据快照中提取官方队伍光环增益。这与
// combatUnitBuffSources.test.js 中强测试所用的提取方式一致：队伍光环是
// 在某个官方队伍光环技能上 targetType 为 "allAllies" 的增益效果。
function extractPartyAuraBuffsFromOfficialData() {
  const officialBuffs = [];
  for (const abilityHrid of PARTY_AURA_ABILITY_HRIDS) {
    const ability = abilityDetailMap[abilityHrid];
    if (!ability) {
      continue;
    }
    for (const effect of ability.abilityEffects ?? []) {
      if (effect?.effectType === '/ability_effect_types/buff' && effect?.targetType === 'allAllies') {
        for (const buff of effect.buffs ?? []) {
          officialBuffs.push(buff);
        }
      }
    }
  }
  return officialBuffs;
}

// 当官方数据快照与硬编码的强度字段表产生漂移时，在模块加载阶段快速失败。
// 否则静默的不一致会使最强源仲裁退化为"后写覆盖"（新增光环增益），或在施法
// 中途因 RangeError 崩溃（增益形状改变）。这两种失败模式在运行时都难以
// 诊断；在此处以明确的消息失败，可将数据版本升级转化为立即可处理的错误。
//
// `officialBuffs` 可注入，供模拟数据漂移的测试使用；生产环境调用方
// 始终通过默认参数使用已检入的快照。
export function assertPartyAuraSnapshotMatchesOfficialData(officialBuffs = extractPartyAuraBuffsFromOfficialData()) {
  const officialHrids = officialBuffs.map((buff) => buff.uniqueHrid).sort();
  const snapshotHrids = Object.keys(PARTY_AURA_STRENGTH_FIELDS).sort();

  const missing = snapshotHrids.filter((hrid) => !officialHrids.includes(hrid));
  const unexpected = officialHrids.filter((hrid) => !snapshotHrids.includes(hrid));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Party aura buff snapshot drifted from the official data. ` +
        `Missing from official data: ${missing.join(', ') || '<none>'}. ` +
        `Unexpected in official data: ${unexpected.join(', ') || '<none>'}. ` +
        `Review PARTY_AURA_STRENGTH_FIELDS in buffSourcePolicy.js against the new data version.`,
    );
  }

  for (const buff of officialBuffs) {
    const strengthField = PARTY_AURA_STRENGTH_FIELDS[buff.uniqueHrid];
    const secondaryField = strengthField === 'ratioBoost' ? 'flatBoost' : 'ratioBoost';
    if (buff[strengthField] < 0 || buff[secondaryField] !== 0) {
      throw new Error(
        `Party aura strength shape changed for ${buff.uniqueHrid}: ` +
          `expected non-negative ${strengthField} with ${secondaryField} === 0, ` +
          `got ${strengthField}=${buff[strengthField]}, ${secondaryField}=${buff[secondaryField]}. ` +
          `Review PARTY_AURA_STRENGTH_FIELDS and getPartyAuraBuffStrength.`,
      );
    }
  }
}

assertPartyAuraSnapshotMatchesOfficialData();

export function getPartyAuraBuffStrength(buff) {
  const strengthField = PARTY_AURA_STRENGTH_FIELDS[buff?.uniqueHrid];
  if (!strengthField) {
    throw new TypeError(`Strongest-source policy is unsupported for ${buff?.uniqueHrid || '<unknown>'}`);
  }

  const secondaryField = strengthField === 'ratioBoost' ? 'flatBoost' : 'ratioBoost';
  const strength = buff[strengthField];
  const secondaryValue = buff[secondaryField];
  if (!Number.isFinite(strength) || !Number.isFinite(secondaryValue)) {
    throw new TypeError(`Party aura boosts must be finite for ${buff.uniqueHrid}`);
  }
  if (strength < 0 || secondaryValue !== 0) {
    throw new RangeError(
      `Party aura strength shape changed for ${buff.uniqueHrid}; review the official data and comparator`,
    );
  }
  return strength;
}

export function isStrongerPartyAuraBuff(candidate, current) {
  if (!candidate) {
    return false;
  }

  const candidateStrength = getPartyAuraBuffStrength(candidate);
  if (!current) {
    return true;
  }
  if (candidate.uniqueHrid !== current.uniqueHrid) {
    throw new Error(`Cannot compare different party aura buffs: ${candidate.uniqueHrid} vs ${current.uniqueHrid}`);
  }
  return candidateStrength > getPartyAuraBuffStrength(current);
}

export function isPartyAuraBuff(buff) {
  return PARTY_AURA_BUFF_HRIDS.has(buff?.uniqueHrid);
}

export function getAbilityBuffSourcePolicy(ability, buff) {
  return PARTY_AURA_ABILITY_HRIDS.has(ability?.hrid) && isPartyAuraBuff(buff)
    ? BUFF_SOURCE_POLICY.STRONGEST
    : BUFF_SOURCE_POLICY.REPLACE;
}
