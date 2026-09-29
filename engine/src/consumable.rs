//! 消耗品模型（`src/combatsimulator/consumable.js` 的移植；定义数据由场景 JSON 提供）。
//!
//! 逐位 parity 要点：
//! - `should_trigger` 的「单一 self + missing_hp/mp + greater_than_equal」快速路径
//!   必须保留（它决定 `compareValue` 的调用，而不是绕过比较）；
//! - 无触发器时恒为 true；`isStunned` 时恒为 false；
//! - 食物/饮料的 haste 取自 `foodHaste` / `drinkConcentration`（按 categoryHrid 含
//!   'food' / 其它区分，与 JS 的 if/else 顺序一致）。

use crate::buff::Buff;
use crate::sim_unit::{UnitArena, UnitId};
use crate::simulator::ThresholdObserve;
use crate::trigger::Trigger;
use crate::unit::UnitError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Consumable {
    pub hrid: String,
    pub cooldown_duration: f64,
    pub hitpoint_restore: f64,
    pub manapoint_restore: f64,
    pub recovery_duration: f64,
    pub category_hrid: String,
    #[serde(default)]
    pub buffs: Vec<Buff>,
    #[serde(default)]
    pub triggers: Vec<Trigger>,
    #[serde(default = "crate::ability::default_last_used")]
    pub last_used: f64,
}

impl Consumable {
    /// 等价 JS `Consumable.shouldTrigger(currentTime, source, target, friendlies, enemies)`。
    ///
    /// `observe`（切片 13）：快速路径调用 compare_value 的那一刻同步记录
    /// (value, active)——与 JS 侧包装 compareValue 的观察点逐次一致（门控早退不记录）。
    pub fn should_trigger(
        &self,
        arena: &UnitArena,
        source: UnitId,
        target: Option<UnitId>,
        friendlies: &[UnitId],
        enemies: Option<&[UnitId]>,
        current_time: f64,
        observe: Option<ThresholdObserve<'_>>,
    ) -> Result<bool, UnitError> {
        let unit = arena.get(source);
        if unit.is_stunned {
            return Ok(false);
        }

        // JS `if (this.catagoryHrid.includes('food'))`：食物取 foodHaste，其余取 drinkConcentration。
        let combat_stats = &unit.combat_details.combat_stats;
        let consumable_haste = if self.category_hrid.contains("food") {
            combat_stats.food_haste
        } else {
            combat_stats.drink_concentration
        };

        let mut cooldown_duration = self.cooldown_duration;
        if consumable_haste > 0.0 {
            cooldown_duration = cooldown_duration / (1.0 + consumable_haste);
        }

        if self.last_used + cooldown_duration > current_time {
            return Ok(false);
        }

        if self.triggers.is_empty() {
            return Ok(true);
        }

        // 快速路径：单一 self + missing_hp/mp + greater_than_equal 直接比较资源缺口。
        // 仍走 compareValue，保持优化器的阈值观察点与 JS 完全一致。
        if self.triggers.len() == 1 {
            let trigger = &self.triggers[0];
            let is_missing_hp = trigger.condition_hrid == "/combat_trigger_conditions/missing_hp";
            let is_missing_mp = trigger.condition_hrid == "/combat_trigger_conditions/missing_mp";
            if trigger.dependency_hrid == "/combat_trigger_dependencies/self"
                && trigger.comparator_hrid == "/combat_trigger_comparators/greater_than_equal"
                && (is_missing_hp || is_missing_mp)
            {
                let current = if is_missing_hp {
                    unit.combat_details.max_hitpoints - unit.combat_details.current_hitpoints
                } else {
                    unit.combat_details.max_manapoints - unit.combat_details.current_manapoints
                };
                let active = trigger.compare_value(&crate::trigger::TriggerValue::Number(current))?;
                if let Some(mut observe) = observe {
                    observe.record(current, active);
                }
                return Ok(active);
            }
        }

        // 不短路：全部触发器都要被求值。
        let mut should_trigger = true;
        for trigger in &self.triggers {
            if !trigger.is_active(arena, source, target, friendlies, enemies, current_time)? {
                should_trigger = false;
            }
        }

        Ok(should_trigger)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ability::default_last_used;
    use crate::unit::CombatUnit;

    fn consumable(hrid: &str, category_hrid: &str, cooldown_duration: f64, triggers: Vec<Trigger>) -> Consumable {
        Consumable {
            hrid: hrid.to_string(),
            cooldown_duration,
            hitpoint_restore: 0.0,
            manapoint_restore: 0.0,
            recovery_duration: 0.0,
            category_hrid: category_hrid.to_string(),
            buffs: Vec::new(),
            triggers,
            last_used: default_last_used(),
        }
    }

    fn missing_hp_trigger(value: f64) -> Trigger {
        Trigger {
            dependency_hrid: "/combat_trigger_dependencies/self".to_string(),
            condition_hrid: "/combat_trigger_conditions/missing_hp".to_string(),
            comparator_hrid: "/combat_trigger_comparators/greater_than_equal".to_string(),
            value,
            is_single_target: true,
        }
    }

    fn unit_with_hp(hp: f64, max_hp: f64) -> CombatUnit {
        let mut unit = CombatUnit::default();
        unit.combat_details.max_hitpoints = max_hp;
        unit.combat_details.current_hitpoints = hp;
        unit
    }

    #[test]
    fn stun_blocks_consumable_use() {
        let mut unit = unit_with_hp(50.0, 100.0);
        unit.is_stunned = true;
        let mut arena = UnitArena::new();
        let id = arena.push(unit);
        let item = consumable("/items/donut", "/item_categories/food", 1000.0, Vec::new());
        assert_eq!(item.should_trigger(&arena, id, None, &[id], None, 5000.0, None), Ok(false));
    }

    #[test]
    fn cooldown_gate_uses_food_haste_and_drink_concentration() {
        let mut unit = unit_with_hp(50.0, 100.0);
        unit.combat_details.combat_stats.food_haste = 1.0; // 冷却减半
        unit.combat_details.combat_stats.drink_concentration = 0.5;
        let mut arena = UnitArena::new();
        let id = arena.push(unit);

        // lastUsed 从「远处过去」起步（JS 的 MIN_SAFE_INTEGER 恒能通过门控），
        // 因此显式写 0 才能观察到冷却缩放。
        let mut food = consumable("/items/donut", "/item_categories/food", 1000.0, Vec::new());
        food.last_used = 0.0;
        assert_eq!(food.should_trigger(&arena, id, None, &[id], None, 499.0, None), Ok(false));
        assert_eq!(food.should_trigger(&arena, id, None, &[id], None, 500.0, None), Ok(true));

        let mut drink = consumable("/items/water", "/item_categories/drink", 1000.0, Vec::new());
        drink.last_used = 0.0;
        assert_eq!(drink.should_trigger(&arena, id, None, &[id], None, 666.0, None), Ok(false));
        assert_eq!(drink.should_trigger(&arena, id, None, &[id], None, 667.0, None), Ok(true));

        let mut fresh_food = consumable("/items/donut", "/item_categories/food", 1000.0, Vec::new());
        fresh_food.last_used = default_last_used();
        assert_eq!(fresh_food.should_trigger(&arena, id, None, &[id], None, 0.0, None), Ok(true));
    }

    #[test]
    fn fast_path_compares_missing_hp_and_mp() {
        let mut unit = unit_with_hp(40.0, 100.0);
        unit.combat_details.max_manapoints = 80.0;
        unit.combat_details.current_manapoints = 30.0;
        let mut arena = UnitArena::new();
        let id = arena.push(unit);

        let hp_item = consumable(
            "/items/donut",
            "/item_categories/food",
            0.0,
            vec![missing_hp_trigger(60.0)],
        );
        assert_eq!(hp_item.should_trigger(&arena, id, None, &[id], None, 0.0, None), Ok(true));

        let strict_item = consumable(
            "/items/donut",
            "/item_categories/food",
            0.0,
            vec![missing_hp_trigger(61.0)],
        );
        assert_eq!(strict_item.should_trigger(&arena, id, None, &[id], None, 0.0, None), Ok(false));

        let mp_item = consumable(
            "/items/mana_potion",
            "/item_categories/drink",
            0.0,
            vec![Trigger {
                dependency_hrid: "/combat_trigger_dependencies/self".to_string(),
                condition_hrid: "/combat_trigger_conditions/missing_mp".to_string(),
                comparator_hrid: "/combat_trigger_comparators/greater_than_equal".to_string(),
                value: 50.0,
                is_single_target: true,
            }],
        );
        assert_eq!(mp_item.should_trigger(&arena, id, None, &[id], None, 0.0, None), Ok(true));
    }
}
