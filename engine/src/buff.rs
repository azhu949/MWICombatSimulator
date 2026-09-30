//! 运行时增益（Buff）模型与「源选择策略」：逐行复刻 JS 侧 `buff.js` +
//! `buffSourcePolicy.js` 的可观察行为。
//!
//! 关键忠实点：
//! - `new Buff(raw, level)` 的等级并入公式：`ratio + (level-1)*ratioLevelBonus`，
//!   字段缺失时 JS 会得到 NaN（`0 * undefined`），Rust 侧同样建模为 NaN。
//! - 最强源策略仅对官方队伍光环 uniqueHrid 开放，且要求「强度字段非负、次字段为 0」，
//!   形状不符时必须报错（而不是发明排序规则）。

use crate::hrid::Hrid;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buff {
    pub unique_hrid: Hrid,
    pub type_hrid: Hrid,
    pub ratio_boost: f64,
    pub flat_boost: f64,
    // 以下字段带默认值：JS 运行时记录允许缺失（structuredClone 保留 undefined，
    // 消费点用 `?? null` / `?? ''` / `?? 0` 归一）；反序列化时按同样的归一语义补齐。
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub start_time: Option<f64>,
    #[serde(default)]
    pub multiplier_for_skill_hrid: Hrid,
    #[serde(default)]
    pub multiplier_per_skill_level: f64,
}

fn nan_default() -> f64 {
    f64::NAN
}

fn default_level() -> f64 {
    1.0
}

/// addBuff / addPermanentBuff 的原始输入（含等级与等级奖励字段）。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffInput {
    pub unique_hrid: Hrid,
    pub type_hrid: Hrid,
    pub ratio_boost: f64,
    pub flat_boost: f64,
    pub duration: Option<f64>,
    // JS：缺失时 `(level-1) * undefined` = NaN；默认 NaN 复刻该行为。
    #[serde(default = "nan_default")]
    pub ratio_boost_level_bonus: f64,
    #[serde(default = "nan_default")]
    pub flat_boost_level_bonus: f64,
    #[serde(default)]
    pub multiplier_for_skill_hrid: Option<Hrid>,
    #[serde(default)]
    pub multiplier_per_skill_level: Option<f64>,
    #[serde(default = "default_level")]
    pub level: f64,
    #[serde(default)]
    pub start_time: Option<f64>,
}

/// 等价 JS `new Buff(input, level)`：把等级奖励并入有效 ratio/flat。
pub fn buff_from_input(input: &BuffInput) -> Buff {
    Buff {
        unique_hrid: input.unique_hrid,
        type_hrid: input.type_hrid,
        ratio_boost: input.ratio_boost + (input.level - 1.0) * input.ratio_boost_level_bonus,
        flat_boost: input.flat_boost + (input.level - 1.0) * input.flat_boost_level_bonus,
        duration: input.duration,
        start_time: input.start_time,
        multiplier_for_skill_hrid: input.multiplier_for_skill_hrid.unwrap_or(Hrid::EMPTY),
        multiplier_per_skill_level: input.multiplier_per_skill_level.unwrap_or(0.0),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuffSourcePolicy {
    Replace,
    Strongest,
}

/// `PARTY_AURA_STRENGTH_FIELDS` 的忠实快照（uniqueHrid → 强度字段名）。
pub const PARTY_AURA_STRENGTH_FIELDS: &[(Hrid, &str)] = &[
    (Hrid::BUFF_UNIQUE_SPEED_AURA_ATTACK_SPEED, "ratioBoost"),
    (Hrid::BUFF_UNIQUE_SPEED_AURA_CAST_SPEED, "flatBoost"),
    (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_HEALING_AMPLIFY, "flatBoost"),
    (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_EVASION, "ratioBoost"),
    (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_ARMOR, "flatBoost"),
    (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_WATER_RESISTANCE, "flatBoost"),
    (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_NATURE_RESISTANCE, "flatBoost"),
    (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_FIRE_RESISTANCE, "flatBoost"),
    (Hrid::BUFF_UNIQUE_FIERCE_AURA, "flatBoost"),
    (Hrid::BUFF_UNIQUE_CRITICAL_AURA_RATE, "flatBoost"),
    (Hrid::BUFF_UNIQUE_CRITICAL_AURA_DAMAGE, "flatBoost"),
    (Hrid::BUFF_UNIQUE_MYSTIC_AURA_WATER_AMPLIFY, "flatBoost"),
    (Hrid::BUFF_UNIQUE_MYSTIC_AURA_NATURE_AMPLIFY, "flatBoost"),
    (Hrid::BUFF_UNIQUE_MYSTIC_AURA_FIRE_AMPLIFY, "flatBoost"),
];

/// 队伍光环校验错误的类别（与 JS 抛出的内置错误一一对应）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartyAuraErrorKind {
    TypeError,
    RangeError,
    Error,
}

/// 队伍光环校验/比较错误：保留错误类别与消息，供上层（unit 探针）逐字对账。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartyAuraError {
    pub kind: PartyAuraErrorKind,
    pub message: String,
}

impl PartyAuraError {
    pub fn type_error(message: impl Into<String>) -> Self {
        Self { kind: PartyAuraErrorKind::TypeError, message: message.into() }
    }

    pub fn range_error(message: impl Into<String>) -> Self {
        Self { kind: PartyAuraErrorKind::RangeError, message: message.into() }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self { kind: PartyAuraErrorKind::Error, message: message.into() }
    }
}

impl std::fmt::Display for PartyAuraError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

pub fn strength_field_for(unique_hrid: Hrid) -> Option<&'static str> {
    PARTY_AURA_STRENGTH_FIELDS
        .iter()
        .find(|(hrid, _)| *hrid == unique_hrid)
        .map(|(_, field)| *field)
}

/// 官方队伍光环技能 hrid 集合（等价 JS `PARTY_AURA_ABILITY_HRIDS`）。
pub const PARTY_AURA_ABILITY_HRIDS: &[Hrid] = &[
    Hrid::ABILITY_SPEED_AURA,
    Hrid::ABILITY_GUARDIAN_AURA,
    Hrid::ABILITY_FIERCE_AURA,
    Hrid::ABILITY_CRITICAL_AURA,
    Hrid::ABILITY_MYSTIC_AURA,
];

/// 等价 JS `isPartyAuraBuff`。
pub fn is_party_aura_buff(unique_hrid: Hrid) -> bool {
    strength_field_for(unique_hrid).is_some()
}

/// 等价 JS `getAbilityBuffSourcePolicy(ability, buff)`：
/// 官方队伍光环技能施加官方队伍光环增益才启用最强源策略，其余一律 replace。
pub fn get_ability_buff_source_policy(ability_hrid: Hrid, buff_unique_hrid: Hrid) -> BuffSourcePolicy {
    if PARTY_AURA_ABILITY_HRIDS.contains(&ability_hrid) && is_party_aura_buff(buff_unique_hrid) {
        BuffSourcePolicy::Strongest
    } else {
        BuffSourcePolicy::Replace
    }
}

/// 等价 JS `getPartyAuraBuffStrength`；形状/数值不符时返回 Err（JS 抛异常）。
pub fn get_party_aura_buff_strength(buff: &Buff) -> Result<f64, PartyAuraError> {
    let Some(strength_field) = strength_field_for(buff.unique_hrid) else {
        return Err(PartyAuraError::type_error(format!(
            "Strongest-source policy is unsupported for {}",
            buff.unique_hrid
        )));
    };
    let (strength, secondary) = if strength_field == "ratioBoost" {
        (buff.ratio_boost, buff.flat_boost)
    } else {
        (buff.flat_boost, buff.ratio_boost)
    };
    if !strength.is_finite() || !secondary.is_finite() {
        return Err(PartyAuraError::type_error(format!("Party aura boosts must be finite for {}", buff.unique_hrid)));
    }
    if strength < 0.0 || secondary != 0.0 {
        return Err(PartyAuraError::range_error(format!(
            "Party aura strength shape changed for {}; review the official data and comparator",
            buff.unique_hrid
        )));
    }
    Ok(strength)
}

/// 等价 JS `isStrongerPartyAuraBuff`（候选为 None 时恒 false；平局保留当前源）。
pub fn is_stronger_party_aura_buff(candidate: Option<&Buff>, current: Option<&Buff>) -> Result<bool, PartyAuraError> {
    let Some(candidate) = candidate else {
        return Ok(false);
    };
    let candidate_strength = get_party_aura_buff_strength(candidate)?;
    let Some(current) = current else {
        return Ok(true);
    };
    if candidate.unique_hrid != current.unique_hrid {
        return Err(PartyAuraError::error(format!(
            "Cannot compare different party aura buffs: {} vs {}",
            candidate.unique_hrid, current.unique_hrid
        )));
    }
    Ok(candidate_strength > get_party_aura_buff_strength(current)?)
}

/// 等价 JS `buffsAffectStatsEqually`：投影字段相同则视为对派生属性影响一致。
pub fn buffs_affect_stats_equally(a: Option<&Buff>, b: Option<&Buff>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            a.unique_hrid == b.unique_hrid
                && a.type_hrid == b.type_hrid
                && a.ratio_boost == b.ratio_boost
                && a.flat_boost == b.flat_boost
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hrid::{hrid_to_string, intern_hrid};

    fn input(unique_hrid: &str, ratio: f64, flat: f64) -> BuffInput {
        BuffInput {
            unique_hrid: intern_hrid(unique_hrid),
            type_hrid: intern_hrid("/buff_types/test"),
            ratio_boost: ratio,
            flat_boost: flat,
            duration: Some(1000.0),
            ratio_boost_level_bonus: 0.0,
            flat_boost_level_bonus: 0.0,
            multiplier_for_skill_hrid: None,
            multiplier_per_skill_level: None,
            level: 1.0,
            start_time: None,
        }
    }

    #[test]
    fn level_merges_into_effective_boosts() {
        let mut raw = input("/buff_uniques/x", 1.0, 2.0);
        raw.ratio_boost_level_bonus = 0.5;
        raw.flat_boost_level_bonus = 0.25;
        raw.level = 3.0;
        let buff = buff_from_input(&raw);
        assert_eq!(buff.ratio_boost, 2.0);
        assert_eq!(buff.flat_boost, 2.5);
        assert_eq!(hrid_to_string(buff.multiplier_for_skill_hrid), "");
        assert_eq!(buff.multiplier_per_skill_level, 0.0);
    }

    #[test]
    fn missing_level_bonus_yields_nan_like_js() {
        let mut raw = input("/buff_uniques/x", 1.0, 2.0);
        raw.ratio_boost_level_bonus = f64::NAN;
        raw.level = 1.0;
        let buff = buff_from_input(&raw);
        assert!(buff.ratio_boost.is_nan());
    }

    #[test]
    fn party_aura_strength_rules() {
        let ok = buff_from_input(&input("/buff_uniques/fierce_aura", 0.0, 0.2));
        assert_eq!(get_party_aura_buff_strength(&ok), Ok(0.2));

        let mut bad_shape = input("/buff_uniques/fierce_aura", 0.1, 0.2);
        bad_shape.ratio_boost_level_bonus = 0.0;
        let bad = buff_from_input(&bad_shape);
        assert!(get_party_aura_buff_strength(&bad).is_err());

        let unknown = buff_from_input(&input("/buff_uniques/not_an_aura", 0.1, 0.0));
        assert!(get_party_aura_buff_strength(&unknown).is_err());
    }

    #[test]
    fn strongest_comparison_ties_keep_incumbent() {
        let weak = buff_from_input(&input("/buff_uniques/fierce_aura", 0.0, 0.1));
        let strong = buff_from_input(&input("/buff_uniques/fierce_aura", 0.0, 0.2));
        let equal = buff_from_input(&input("/buff_uniques/fierce_aura", 0.0, 0.2));
        assert_eq!(is_stronger_party_aura_buff(Some(&strong), None), Ok(true));
        assert_eq!(is_stronger_party_aura_buff(Some(&strong), Some(&weak)), Ok(true));
        assert_eq!(is_stronger_party_aura_buff(Some(&equal), Some(&strong)), Ok(false));
        assert_eq!(is_stronger_party_aura_buff(None, Some(&strong)), Ok(false));
    }

    #[test]
    fn stats_equality_uses_projection_only() {
        let a = buff_from_input(&input("/buff_uniques/x", 1.0, 2.0));
        let mut b = a.clone();
        b.duration = Some(999.0);
        b.start_time = Some(5.0);
        assert!(buffs_affect_stats_equally(Some(&a), Some(&b)));
        b.flat_boost = 3.0;
        assert!(!buffs_affect_stats_equally(Some(&a), Some(&b)));
        assert!(buffs_affect_stats_equally(None, None));
        assert!(!buffs_affect_stats_equally(Some(&a), None));
    }
}
