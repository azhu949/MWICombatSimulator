//! 装备数值规则（`src/combatsimulator/equipment.js`）的移植。
//!
//! 只移植与数据无关的**规则**：enhancement 总倍率加成与 JS 的 `|| 0` /
//! 真值判断语义。具体的 `itemDetailMap` / `enhancementLevelTotalMultiplierTable`
//! 数据表由上层（后续切片装配 Player/Monster 时）以参数形式提供——切片 3 的
//! CombatUnit parity 不消费该函数，此处先固化为可单测的纯函数。
//!
//! 逐位 parity 要点（JS `getCombatStat`）：
//! - `combatStats[stat]` 为真值判断：0 / NaN / 缺失 → 直接返回 0（enhancement 加成不计）；
//! - 存在时返回 `stat + multiplier * (bonus || 0)`，其中 `|| 0` 把 0 / NaN / 缺失归零；
//! - `multiplier` 由 `enhancementLevelTotalMultiplierTable[enhancementLevel]` 查得，
//!   表中缺失会得到 `undefined` → 与 bonus 相乘得 NaN（由调用方决定是否建模）。

/// 等价 JS `Equipment.getCombatStat(combatStat)`。
pub fn get_combat_stat(combat_stat: Option<f64>, enhancement_bonus: Option<f64>, multiplier: f64) -> f64 {
    let Some(stat) = combat_stat else {
        return 0.0;
    };
    if stat == 0.0 || stat.is_nan() {
        return 0.0;
    }
    let bonus = match enhancement_bonus {
        Some(value) if value != 0.0 && !value.is_nan() => value,
        _ => 0.0,
    };
    stat + multiplier * bonus
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_and_nan_stats_short_circuit_before_enhancement() {
        assert_eq!(get_combat_stat(Some(0.0), Some(2.0), 3.0), 0.0);
        assert_eq!(get_combat_stat(Some(f64::NAN), Some(2.0), 3.0), 0.0);
        assert_eq!(get_combat_stat(None, Some(2.0), 3.0), 0.0);
    }

    #[test]
    fn truthy_stats_add_multiplied_bonus() {
        assert_eq!(get_combat_stat(Some(15.0), Some(0.5), 2.0), 16.0);
        assert_eq!(get_combat_stat(Some(-4.0), Some(1.0), 1.5), -2.5);
        // bonus 缺失 / 0 / NaN 一律归零（JS `|| 0`）
        assert_eq!(get_combat_stat(Some(15.0), None, 2.0), 15.0);
        assert_eq!(get_combat_stat(Some(15.0), Some(0.0), 2.0), 15.0);
        assert_eq!(get_combat_stat(Some(15.0), Some(f64::NAN), 2.0), 15.0);
    }
}
