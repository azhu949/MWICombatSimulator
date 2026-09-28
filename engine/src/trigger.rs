//! 战斗触发器（`src/combatsimulator/trigger.js` 的移植）。
//!
//! 依赖关系表的 `isSingleTarget` 标记来自官方数据快照
//! （`combatTriggerDependencyDetailMap.json`）；场景 JSON 必须为每个触发器
//! 提供该标记（JS 侧从真实数据表读出），Rust 侧不做数据查询。
//!
//! 逐位 parity 要点：
//! - `is_active` 中的比较必须复用 JS 的 `>=` / `<=` / `!!` / `!` 语义；
//! - `lowest_hp_percentage` 的 reduce 初值为 2（200%），空列表时返回 200；
//! - 多目标默认分支按「存活单位 → 取值 → 求和」处理（顺序敏感），且 `+`
//!   必须复刻 JS 的「数值相加 / 字符串拼接」混合语义（增益对象为字符串
//!   拼接、undefined 参与数值相加得 NaN）；
//! - 未知 dependency/condition/comparator 一律抛错（消息逐字一致）。
//!
//! 刻意保留的 JS 既有怪癖（不得「改进」）：
//! - 第一组增益条件用**精确键** `/buff_uniques/<末段>` 查询；第二组用
//!   `startsWith` 前缀取 `Object.keys` 顺序下的**首个**命中键，命中即返回
//!   增益对象本身（不返回 boost 值）；
//! - 缺失的增益键 / 未命中前缀返回 `undefined`（Rust 用 `TriggerValue::Undefined`），
//!   `>=` 比较因 NaN 恒假，`is_active` 因 `!!undefined` 恒假。

use crate::sim_unit::{UnitArena, UnitId};
use crate::unit::{CombatUnit, UnitError};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub dependency_hrid: String,
    pub condition_hrid: String,
    pub comparator_hrid: String,
    #[serde(default)]
    pub value: f64,
    /// 官方数据 `combatTriggerDependencyDetailMap[dependencyHrid].isSingleTarget`。
    #[serde(default)]
    pub is_single_target: bool,
}

/// JS 值的忠实模型：仅保留比较 / 拼接语义所需的判别信息。
///
/// JS 侧 `getDependencyValue` 可能返回五种形态：undefined（缺失增益键）、
/// 布尔（*_status）、数字（hp/mp 类）、增益对象（buff 类）与字符串
/// （多目标 `+` 拼接的结果）。
#[derive(Clone, Debug, PartialEq)]
pub enum TriggerValue {
    Undefined,
    Boolean(bool),
    Number(f64),
    /// 增益对象：参与 `+` 时按 `[object Object]` 字符串化。
    Buff,
    String(String),
}

/// JS 数值 → 字符串（`String(number)`）。
///
/// 说明：Rust `Display` 与 JS 在最短路表示上一致，仅「≥1e21 的整数」与
/// 「<1e-6 的小数」会走指数形式差异；这种字符串只会出现在 buff 键拼接里，
/// 后续至多按 `Number(...)` 解析为同一个数值，因此数值结果不受影响。
pub fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == f64::INFINITY {
        return "Infinity".to_string();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".to_string();
    }
    if value == 0.0 {
        // JS：`String(-0)` === "0"。
        return "0".to_string();
    }
    format!("{value}")
}

/// JS 字符串 → 数值（`Number(string)`）的忠实近似。
fn js_string_to_number(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    if let Some(hex) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X")) {
        return u64::from_str_radix(hex, 16).map(|value| value as f64).unwrap_or(f64::NAN);
    }
    if let Some(hex) = trimmed.strip_prefix("-0x").or_else(|| trimmed.strip_prefix("-0X")) {
        return u64::from_str_radix(hex, 16).map(|value| -(value as f64)).unwrap_or(f64::NAN);
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

impl TriggerValue {
    /// JS `!!value`。
    pub fn is_truthy(&self) -> bool {
        match self {
            TriggerValue::Undefined => false,
            TriggerValue::Boolean(value) => *value,
            TriggerValue::Number(value) => *value != 0.0 && !value.is_nan(),
            TriggerValue::Buff => true,
            TriggerValue::String(value) => !value.is_empty(),
        }
    }

    /// JS `Number(value)`（关系比较的 ToNumber）。
    pub fn to_number(&self) -> f64 {
        match self {
            TriggerValue::Undefined => f64::NAN,
            TriggerValue::Boolean(value) => {
                if *value {
                    1.0
                } else {
                    0.0
                }
            }
            TriggerValue::Number(value) => *value,
            // 对象 valueOf 不返回原始值 → toString → "[object Object]" → NaN。
            TriggerValue::Buff => f64::NAN,
            TriggerValue::String(value) => js_string_to_number(value),
        }
    }

    /// JS `String(value)`（字符串拼接的 ToString）。
    pub fn to_js_string(&self) -> String {
        match self {
            TriggerValue::Undefined => "undefined".to_string(),
            TriggerValue::Boolean(value) => {
                if *value {
                    "true".to_string()
                } else {
                    "false".to_string()
                }
            }
            TriggerValue::Number(value) => js_number_to_string(*value),
            TriggerValue::Buff => "[object Object]".to_string(),
            TriggerValue::String(value) => value.clone(),
        }
    }

    /// JS `+` 的忠实语义：任一操作数为字符串/对象 → 字符串拼接，否则数值相加。
    pub fn add(self, other: TriggerValue) -> TriggerValue {
        let string_like = matches!(self, TriggerValue::Buff | TriggerValue::String(_))
            || matches!(other, TriggerValue::Buff | TriggerValue::String(_));
        if string_like {
            TriggerValue::String(format!("{}{}", self.to_js_string(), other.to_js_string()))
        } else {
            TriggerValue::Number(self.to_number() + other.to_number())
        }
    }
}

/// 第一组条件（精确键查询）：`/buff_uniques/<conditionHrid 末段>`。
const EXACT_KEY_BUFF_CONDITIONS: &[&str] = &[
    "/combat_trigger_conditions/berserk",
    "/combat_trigger_conditions/frenzy",
    "/combat_trigger_conditions/precision",
    "/combat_trigger_conditions/vampirism",
    "/combat_trigger_conditions/attack_coffee",
    "/combat_trigger_conditions/defense_coffee",
    "/combat_trigger_conditions/lucky_coffee",
    "/combat_trigger_conditions/magic_coffee",
    "/combat_trigger_conditions/melee_coffee",
    "/combat_trigger_conditions/ranged_coffee",
    "/combat_trigger_conditions/swiftness_coffee",
    "/combat_trigger_conditions/wisdom_coffee",
    "/combat_trigger_conditions/ice_spear",
    "/combat_trigger_conditions/puncture",
    "/combat_trigger_conditions/frost_surge",
    "/combat_trigger_conditions/elusiveness",
    "/combat_trigger_conditions/channeling_coffee",
    "/combat_trigger_conditions/fierce_aura",
    "/combat_trigger_conditions/provoke",
    "/combat_trigger_conditions/taunt",
    "/combat_trigger_conditions/crippling_slash",
    "/combat_trigger_conditions/mana_spring",
    "/combat_trigger_conditions/retribution",
    "/combat_trigger_conditions/fracturing_impact",
    "/combat_trigger_conditions/maim",
    "/combat_trigger_conditions/curse",
    "/combat_trigger_conditions/weaken",
];

/// 第二组条件（`startsWith` 前缀查询，取首个命中键）。
const PREFIX_BUFF_CONDITIONS: &[&str] = &[
    "/combat_trigger_conditions/critical_aura",
    "/combat_trigger_conditions/critical_coffee",
    "/combat_trigger_conditions/intelligence_coffee",
    "/combat_trigger_conditions/stamina_coffee",
    "/combat_trigger_conditions/elemental_affinity",
    "/combat_trigger_conditions/fury",
    "/combat_trigger_conditions/guardian_aura",
    "/combat_trigger_conditions/insanity",
    "/combat_trigger_conditions/spike_shell",
    "/combat_trigger_conditions/toxic_pollen",
    "/combat_trigger_conditions/invincible",
    "/combat_trigger_conditions/mystic_aura",
    "/combat_trigger_conditions/pestilent_shot",
    "/combat_trigger_conditions/smoke_burst",
    "/combat_trigger_conditions/speed_aura",
    "/combat_trigger_conditions/toughness",
    "/combat_trigger_conditions/enrage",
];

/// JS `conditionHrid.slice(conditionHrid.lastIndexOf('/'))`：保留末段（含斜杠）。
fn unique_hrid_suffix(condition_hrid: &str) -> &str {
    match condition_hrid.rfind('/') {
        Some(index) => &condition_hrid[index..],
        // 无斜杠时 JS slice(-1) 取最后一个字符（合法 hrid 不会走到这里）。
        None => {
            let start = condition_hrid.char_indices().next_back().map_or(0, |(index, _)| index);
            &condition_hrid[start..]
        }
    }
}

/// JS `checkTriggers` 的触发条件类别（决定取值路径）。
enum BuffConditionLookup {
    ExactKey,
    Prefix,
}

fn buff_condition_lookup(condition_hrid: &str) -> Option<BuffConditionLookup> {
    if EXACT_KEY_BUFF_CONDITIONS.contains(&condition_hrid) {
        return Some(BuffConditionLookup::ExactKey);
    }
    if PREFIX_BUFF_CONDITIONS.contains(&condition_hrid) {
        return Some(BuffConditionLookup::Prefix);
    }
    None
}

impl Trigger {
    /// 等价 JS `Trigger.isActive(source, target, friendlies, enemies, currentTime)`。
    pub fn is_active(
        &self,
        arena: &UnitArena,
        source: UnitId,
        target: Option<UnitId>,
        friendlies: &[UnitId],
        enemies: Option<&[UnitId]>,
        current_time: f64,
    ) -> Result<bool, UnitError> {
        if self.is_single_target {
            self.is_active_single_target(arena, source, target, current_time)
        } else {
            self.is_active_multi_target(arena, friendlies, enemies, current_time)
        }
    }

    fn is_active_single_target(
        &self,
        arena: &UnitArena,
        source: UnitId,
        target: Option<UnitId>,
        current_time: f64,
    ) -> Result<bool, UnitError> {
        let dependency_value = match self.dependency_hrid.as_str() {
            "/combat_trigger_dependencies/self" => {
                self.get_dependency_value(arena.get(source), current_time)?
            }
            "/combat_trigger_dependencies/targeted_enemy" => {
                let Some(target) = target else {
                    return Ok(false);
                };
                self.get_dependency_value(arena.get(target), current_time)?
            }
            other => {
                return Err(UnitError::error(format!("Unknown dependencyHrid in trigger: {other}")));
            }
        };
        self.compare_value(&dependency_value)
    }

    fn is_active_multi_target(
        &self,
        arena: &UnitArena,
        friendlies: &[UnitId],
        enemies: Option<&[UnitId]>,
        current_time: f64,
    ) -> Result<bool, UnitError> {
        let dependency: &[UnitId] = match self.dependency_hrid.as_str() {
            "/combat_trigger_dependencies/all_allies" => friendlies,
            "/combat_trigger_dependencies/all_enemies" => {
                let Some(enemies) = enemies else {
                    return Ok(false);
                };
                enemies
            }
            other => {
                return Err(UnitError::error(format!("Unknown dependencyHrid in trigger: {other}")));
            }
        };

        let dependency_value = match self.condition_hrid.as_str() {
            "/combat_trigger_conditions/number_of_active_units" => {
                let count = dependency.iter().filter(|id| arena.get(**id).combat_details.current_hitpoints > 0.0).count();
                TriggerValue::Number(count as f64)
            }
            "/combat_trigger_conditions/number_of_dead_units" => {
                let count = dependency.iter().filter(|id| arena.get(**id).combat_details.current_hitpoints <= 0.0).count();
                TriggerValue::Number(count as f64)
            }
            "/combat_trigger_conditions/lowest_hp_percentage" => {
                // JS reduce 初值 2（200%）：空列表 ⇒ 200。
                let mut lowest = 2.0_f64;
                for id in dependency {
                    let unit = arena.get(*id);
                    if unit.combat_details.current_hitpoints > 0.0 {
                        let percentage =
                            unit.combat_details.current_hitpoints / unit.combat_details.max_hitpoints;
                        if percentage < lowest {
                            lowest = percentage;
                        }
                    }
                }
                TriggerValue::Number(lowest * 100.0)
            }
            _ => {
                let mut acc = TriggerValue::Number(0.0);
                for id in dependency {
                    let unit = arena.get(*id);
                    if unit.combat_details.current_hitpoints > 0.0 {
                        let value = self.get_dependency_value(unit, current_time)?;
                        acc = acc.add(value);
                    }
                }
                acc
            }
        };

        self.compare_value(&dependency_value)
    }

    /// 等价 JS `Trigger.getDependencyValue(source, currentTime)`。
    fn get_dependency_value(&self, source: &CombatUnit, current_time: f64) -> Result<TriggerValue, UnitError> {
        if let Some(kind) = buff_condition_lookup(&self.condition_hrid) {
            let unique_hrid = format!("/buff_uniques{}", unique_hrid_suffix(&self.condition_hrid));
            return Ok(match kind {
                BuffConditionLookup::ExactKey => {
                    if source.combat_buffs.contains_key_str(&unique_hrid) {
                        TriggerValue::Buff
                    } else {
                        TriggerValue::Undefined
                    }
                }
                BuffConditionLookup::Prefix => {
                    // Object.keys 顺序 = 插入顺序；命中首个前缀匹配的键即返回其增益对象。
                    let matched = source.combat_buffs.keys().any(|key| key.starts_with(&unique_hrid));
                    if matched {
                        TriggerValue::Buff
                    } else {
                        TriggerValue::Undefined
                    }
                }
            });
        }

        match self.condition_hrid.as_str() {
            "/combat_trigger_conditions/current_hp" => {
                Ok(TriggerValue::Number(source.combat_details.current_hitpoints))
            }
            "/combat_trigger_conditions/current_mp" => {
                Ok(TriggerValue::Number(source.combat_details.current_manapoints))
            }
            "/combat_trigger_conditions/missing_hp" => Ok(TriggerValue::Number(
                source.combat_details.max_hitpoints - source.combat_details.current_hitpoints,
            )),
            "/combat_trigger_conditions/missing_mp" => Ok(TriggerValue::Number(
                source.combat_details.max_manapoints - source.combat_details.current_manapoints,
            )),
            "/combat_trigger_conditions/stun_status" => Ok(TriggerValue::Boolean(
                source.is_stunned || source.stun_expire_time == Some(current_time),
            )),
            "/combat_trigger_conditions/blind_status" => Ok(TriggerValue::Boolean(
                source.is_blinded || source.blind_expire_time == Some(current_time),
            )),
            "/combat_trigger_conditions/silence_status" => Ok(TriggerValue::Boolean(
                source.is_silenced || source.silence_expire_time == Some(current_time),
            )),
            other => Err(UnitError::error(format!("Unknown conditionHrid in trigger: {other}"))),
        }
    }

    /// 等价 JS `Trigger.compareValue(dependencyValue)`。
    pub fn compare_value(&self, dependency_value: &TriggerValue) -> Result<bool, UnitError> {
        match self.comparator_hrid.as_str() {
            "/combat_trigger_comparators/greater_than_equal" => {
                Ok(dependency_value.to_number() >= self.value)
            }
            "/combat_trigger_comparators/less_than_equal" => {
                Ok(dependency_value.to_number() <= self.value)
            }
            "/combat_trigger_comparators/is_active" => Ok(dependency_value.is_truthy()),
            "/combat_trigger_comparators/is_inactive" => Ok(!dependency_value.is_truthy()),
            other => Err(UnitError::error(format!("Unknown comparatorHrid in trigger: {other}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buff::Buff;
    use crate::ordered_map::OrderedMap;
    use crate::unit::CombatUnit;

    fn trigger(dependency: &str, condition: &str, comparator: &str, value: f64, single: bool) -> Trigger {
        Trigger {
            dependency_hrid: dependency.to_string(),
            condition_hrid: condition.to_string(),
            comparator_hrid: comparator.to_string(),
            value,
            is_single_target: single,
        }
    }

    fn arena_with(units: Vec<CombatUnit>) -> UnitArena {
        let mut arena = UnitArena::new();
        for unit in units {
            arena.push(unit);
        }
        arena
    }

    fn buff(unique_hrid: &str) -> Buff {
        Buff {
            unique_hrid: unique_hrid.to_string(),
            type_hrid: "/buff_types/damage".to_string(),
            ratio_boost: 0.1,
            flat_boost: 0.0,
            duration: Some(1000.0),
            start_time: Some(0.0),
            multiplier_for_skill_hrid: String::new(),
            multiplier_per_skill_level: 0.0,
        }
    }

    #[test]
    fn self_hp_comparisons_match_js_semantics() {
        let mut unit = CombatUnit::default();
        unit.combat_details.current_hitpoints = 40.0;
        unit.combat_details.max_hitpoints = 100.0;
        let arena = arena_with(vec![unit]);

        let missing_hp = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/missing_hp",
            "/combat_trigger_comparators/greater_than_equal",
            60.0,
            true,
        );
        assert_eq!(missing_hp.is_active(&arena, 0, None, &[0], None, 0.0), Ok(true));

        let missing_hp_strict = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/missing_hp",
            "/combat_trigger_comparators/greater_than_equal",
            61.0,
            true,
        );
        assert_eq!(missing_hp_strict.is_active(&arena, 0, None, &[0], None, 0.0), Ok(false));

        let less_equal = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/current_hp",
            "/combat_trigger_comparators/less_than_equal",
            40.0,
            true,
        );
        assert_eq!(less_equal.is_active(&arena, 0, None, &[0], None, 0.0), Ok(true));
    }

    #[test]
    fn targeted_enemy_without_target_is_false_and_unknown_hrids_error() {
        let arena = arena_with(vec![CombatUnit::default()]);
        let targeted_enemy = trigger(
            "/combat_trigger_dependencies/targeted_enemy",
            "/combat_trigger_conditions/current_hp",
            "/combat_trigger_comparators/greater_than_equal",
            0.0,
            true,
        );
        assert_eq!(targeted_enemy.is_active(&arena, 0, None, &[0], None, 0.0), Ok(false));

        let unknown_dependency = trigger(
            "/combat_trigger_dependencies/bogus",
            "/combat_trigger_conditions/current_hp",
            "/combat_trigger_comparators/greater_than_equal",
            0.0,
            true,
        );
        assert_eq!(
            unknown_dependency.is_active(&arena, 0, None, &[0], None, 0.0),
            Err(UnitError::error("Unknown dependencyHrid in trigger: /combat_trigger_dependencies/bogus"))
        );

        let unknown_condition = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/bogus",
            "/combat_trigger_comparators/greater_than_equal",
            0.0,
            true,
        );
        assert_eq!(
            unknown_condition.is_active(&arena, 0, None, &[0], None, 0.0),
            Err(UnitError::error("Unknown conditionHrid in trigger: /combat_trigger_conditions/bogus"))
        );

        let unknown_comparator = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/current_hp",
            "/combat_trigger_comparators/bogus",
            0.0,
            true,
        );
        assert_eq!(
            unknown_comparator.is_active(&arena, 0, None, &[0], None, 0.0),
            Err(UnitError::error("Unknown comparatorHrid in trigger: /combat_trigger_comparators/bogus"))
        );
    }

    #[test]
    fn buff_conditions_use_exact_and_prefix_lookup_with_insertion_order() {
        let mut unit = CombatUnit::default();
        let mut buffs: OrderedMap<String, Buff> = OrderedMap::new();
        buffs.set("/buff_uniques/fury_1".to_string(), buff("/buff_uniques/fury_1"));
        buffs.set("/buff_uniques/fury".to_string(), buff("/buff_uniques/fury"));
        unit.combat_buffs = buffs;
        let arena = arena_with(vec![unit]);

        // 前缀条件：命中首个 startsWith 键（插入序），返回增益对象 ⇒ is_active 真。
        let prefix_hit = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/fury",
            "/combat_trigger_comparators/is_active",
            0.0,
            true,
        );
        assert_eq!(prefix_hit.is_active(&arena, 0, None, &[0], None, 0.0), Ok(true));

        // 精确条件：`/buff_uniques/curse` 不存在 ⇒ undefined ⇒ is_active 假、is_inactive 真。
        let exact_miss = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/curse",
            "/combat_trigger_comparators/is_active",
            0.0,
            true,
        );
        assert_eq!(exact_miss.is_active(&arena, 0, None, &[0], None, 0.0), Ok(false));

        let exact_miss_inactive = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/curse",
            "/combat_trigger_comparators/is_inactive",
            0.0,
            true,
        );
        assert_eq!(exact_miss_inactive.is_active(&arena, 0, None, &[0], None, 0.0), Ok(true));

        // 增益对象参与 `>=` 比较：Number(object) = NaN ⇒ 恒假。
        let buff_numeric = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/fury",
            "/combat_trigger_comparators/greater_than_equal",
            0.0,
            true,
        );
        assert_eq!(buff_numeric.is_active(&arena, 0, None, &[0], None, 0.0), Ok(false));
    }

    #[test]
    fn status_conditions_use_expire_time_equality() {
        let mut unit = CombatUnit::default();
        unit.is_stunned = false;
        unit.stun_expire_time = Some(500.0);
        let arena = arena_with(vec![unit]);

        let stun = trigger(
            "/combat_trigger_dependencies/self",
            "/combat_trigger_conditions/stun_status",
            "/combat_trigger_comparators/is_active",
            0.0,
            true,
        );
        assert_eq!(stun.is_active(&arena, 0, None, &[0], None, 500.0), Ok(true));
        assert_eq!(stun.is_active(&arena, 0, None, &[0], None, 501.0), Ok(false));
    }

    #[test]
    fn multi_target_conditions_count_and_reduce_alive_units() {
        let mut alive = CombatUnit::default();
        alive.combat_details.current_hitpoints = 50.0;
        alive.combat_details.max_hitpoints = 100.0;
        let mut hurt = CombatUnit::default();
        hurt.combat_details.current_hitpoints = 25.0;
        hurt.combat_details.max_hitpoints = 100.0;
        let mut dead = CombatUnit::default();
        dead.combat_details.current_hitpoints = 0.0;
        let arena = arena_with(vec![alive, hurt, dead]);
        let ids = vec![0usize, 1, 2];

        let active_units = trigger(
            "/combat_trigger_dependencies/all_allies",
            "/combat_trigger_conditions/number_of_active_units",
            "/combat_trigger_comparators/greater_than_equal",
            2.0,
            false,
        );
        assert_eq!(active_units.is_active(&arena, 0, None, &ids, None, 0.0), Ok(true));
        assert_eq!(active_units.is_active(&arena, 0, None, &[2], None, 0.0), Ok(false));

        let dead_units = trigger(
            "/combat_trigger_dependencies/all_allies",
            "/combat_trigger_conditions/number_of_dead_units",
            "/combat_trigger_comparators/greater_than_equal",
            1.0,
            false,
        );
        assert_eq!(dead_units.is_active(&arena, 0, None, &ids, None, 0.0), Ok(true));

        // lowest_hp_percentage：25% ；空列表 ⇒ reduce 初值 2 ⇒ 200。
        let lowest = trigger(
            "/combat_trigger_dependencies/all_allies",
            "/combat_trigger_conditions/lowest_hp_percentage",
            "/combat_trigger_comparators/less_than_equal",
            25.0,
            false,
        );
        assert_eq!(lowest.is_active(&arena, 0, None, &ids, None, 0.0), Ok(true));

        let empty_lowest = trigger(
            "/combat_trigger_dependencies/all_allies",
            "/combat_trigger_conditions/lowest_hp_percentage",
            "/combat_trigger_comparators/greater_than_equal",
            200.0,
            false,
        );
        assert_eq!(empty_lowest.is_active(&arena, 0, None, &[], None, 0.0), Ok(true));
    }

    #[test]
    fn multi_target_default_branch_sums_missing_hp_of_alive_units() {
        let mut first = CombatUnit::default();
        first.combat_details.max_hitpoints = 100.0;
        first.combat_details.current_hitpoints = 40.0;
        let mut second = CombatUnit::default();
        second.combat_details.max_hitpoints = 200.0;
        second.combat_details.current_hitpoints = 150.0;
        let mut dead = CombatUnit::default();
        dead.combat_details.max_hitpoints = 100.0;
        dead.combat_details.current_hitpoints = 0.0;
        let arena = arena_with(vec![first, second, dead]);

        let sum_missing = trigger(
            "/combat_trigger_dependencies/all_allies",
            "/combat_trigger_conditions/missing_hp",
            "/combat_trigger_comparators/greater_than_equal",
            110.0,
            false,
        );
        assert_eq!(sum_missing.is_active(&arena, 0, None, &[0, 1, 2], None, 0.0), Ok(true));

        // all_enemies 为 null ⇒ 直接 false（求值前短路）。
        let enemies_null = trigger(
            "/combat_trigger_dependencies/all_enemies",
            "/combat_trigger_conditions/number_of_active_units",
            "/combat_trigger_comparators/greater_than_equal",
            1.0,
            false,
        );
        assert_eq!(enemies_null.is_active(&arena, 0, None, &[0], None, 0.0), Ok(false));

        // 前缀条件未命中 ⇒ undefined 参与数值求和 ⇒ NaN ⇒ `>=` 恒假。
        let buff_sum = trigger(
            "/combat_trigger_dependencies/all_allies",
            "/combat_trigger_conditions/fury",
            "/combat_trigger_comparators/greater_than_equal",
            -1.0,
            false,
        );
        assert_eq!(buff_sum.is_active(&arena, 0, None, &[0, 1], None, 0.0), Ok(false));
    }

    #[test]
    fn trigger_value_matches_js_coercions() {
        assert!(!TriggerValue::Undefined.is_truthy());
        assert!(TriggerValue::Buff.is_truthy());
        assert!(!TriggerValue::String(String::new()).is_truthy());
        assert!(!TriggerValue::Number(f64::NAN).is_truthy());
        assert!(!TriggerValue::Number(0.0).is_truthy());
        assert!(TriggerValue::Number(-1.0).is_truthy());
        assert!(TriggerValue::Boolean(true).is_truthy());

        assert!(TriggerValue::Undefined.to_number().is_nan());
        assert!(TriggerValue::Buff.to_number().is_nan());
        assert_eq!(TriggerValue::String(" 12.5 ".to_string()).to_number(), 12.5);
        assert_eq!(TriggerValue::String("0x10".to_string()).to_number(), 16.0);
        assert_eq!(TriggerValue::String("".to_string()).to_number(), 0.0);
        assert_eq!(TriggerValue::Boolean(true).to_number(), 1.0);

        // `+` 语义：数字相加、含对象/字符串则拼接。
        assert_eq!(
            TriggerValue::Number(2.0).add(TriggerValue::Boolean(true)),
            TriggerValue::Number(3.0)
        );
        assert!(TriggerValue::Number(0.0).add(TriggerValue::Undefined).to_number().is_nan());
        assert_eq!(
            TriggerValue::Number(0.0).add(TriggerValue::Buff),
            TriggerValue::String("0[object Object]".to_string())
        );
        assert_eq!(
            TriggerValue::Number(0.0).add(TriggerValue::String("x".to_string())).to_js_string(),
            "0x"
        );
        assert_eq!(js_number_to_string(20.0), "20");
        assert_eq!(js_number_to_string(-0.0), "0");
    }
}
