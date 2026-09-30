//! 单位容器（切片 4）：把 `CombatUnit` 放在一个竞技场里按下标寻址，
//! 以便模拟循环同时可变借用一个攻击者与一个目标（JS 侧为对象引用）。
//!
//! 设计要点：
//! - 事件持有 `UnitId`（= 竞技场下标）而非引用，避免 Rust 借用冲突；
//! - 玩家 / 敌人的遍历顺序由各自的 id 列表维护（与 JS 数组顺序一致）；
//! - 单位列表在模拟期**只增不减**（死亡单位保留在竞技场中，只是 HP = 0）；
//!   切片 26 的唯一例外是重生池的形态不符丢弃（`release`，调用方负责全表重映射）。

use crate::ability::Ability;
use crate::consumable::Consumable;
use crate::rng::Mulberry32;
use crate::unit::CombatUnit;

pub type UnitId = usize;

/// 单位数量上限（防御性，正常场景远低于此值）。
pub const NUMBER_MIN_SAFE_INTEGER: f64 = -9007199254740991.0;

#[derive(Clone, Debug, Default)]
pub struct UnitArena {
    pub units: Vec<CombatUnit>,
}

impl UnitArena {
    pub fn new() -> Self {
        Self { units: Vec::new() }
    }

    pub fn push(&mut self, unit: CombatUnit) -> UnitId {
        self.units.push(unit);
        self.units.len() - 1
    }

    pub fn len(&self) -> usize {
        self.units.len()
    }

    pub fn is_empty(&self) -> bool {
        self.units.is_empty()
    }

    pub fn get(&self, id: UnitId) -> &CombatUnit {
        &self.units[id]
    }

    pub fn get_mut(&mut self, id: UnitId) -> &mut CombatUnit {
        &mut self.units[id]
    }

    /// 切片 26（重生槽位复用）：移除一个槽位——`Vec::swap_remove` 语义，**末位单位被换入
    /// 该下标、其余下标一律不变**，返回被移除的单位。
    ///
    /// 调用方必须负责重映射所有持有 `UnitId` 的表（`CombatSimulator::remove_slot_or_degrade`
    /// 一次性完成）——遗留旧下标会让后续 `arena.get` 越界 panic。
    pub fn release(&mut self, id: UnitId) -> CombatUnit {
        self.units.swap_remove(id)
    }

    /// 同时可变借用两个不同单位（等价 JS 里两个对象引用各自可变）。
    pub fn two_mut(&mut self, first: UnitId, second: UnitId) -> (&mut CombatUnit, &mut CombatUnit) {
        assert_ne!(first, second, "two_mut requires two distinct unit ids");
        if first < second {
            let (head, tail) = self.units.split_at_mut(second);
            (&mut head[first], &mut tail[0])
        } else {
            let (head, tail) = self.units.split_at_mut(first);
            (&mut tail[0], &mut head[second])
        }
    }

    /// 竞技场中按给定顺序查找第一个存活单位（等价 JS `CombatUtilities.getTarget`）。
    pub fn first_alive(&self, ids: &[UnitId]) -> Option<UnitId> {
        ids.iter()
            .copied()
            .find(|id| self.get(*id).combat_details.current_hitpoints > 0.0)
    }

    /// 命中率判定用的存活单位列表（保持原顺序）。
    pub fn alive_ids(&self, ids: &[UnitId]) -> Vec<UnitId> {
        ids.iter()
            .copied()
            .filter(|id| self.get(*id).combat_details.current_hitpoints > 0.0)
            .collect()
    }
}

// ---------------------------------------------------------------------------
// CombatUnit 的模拟循环行为（JS `combatUnit.js` 的 addHitpoints / addManapoints /
// reset / resetCooldowns；方法体与 unit.rs 的结算逻辑分文件维护）
// ---------------------------------------------------------------------------

impl CombatUnit {
    /// 等价 JS `addHitpoints`：已满血返回 0，否则按上限截断。
    pub fn add_hitpoints(&mut self, hitpoints: f64) -> f64 {
        if self.combat_details.current_hitpoints >= self.combat_details.max_hitpoints {
            return 0.0;
        }
        let new_hitpoints =
            (self.combat_details.current_hitpoints + hitpoints).min(self.combat_details.max_hitpoints);
        let hitpoints_added = new_hitpoints - self.combat_details.current_hitpoints;
        self.combat_details.current_hitpoints = new_hitpoints;
        hitpoints_added
    }

    /// 等价 JS `addManapoints`。
    pub fn add_manapoints(&mut self, manapoints: f64) -> f64 {
        if self.combat_details.current_manapoints >= self.combat_details.max_manapoints {
            return 0.0;
        }
        let new_manapoints =
            (self.combat_details.current_manapoints + manapoints).min(self.combat_details.max_manapoints);
        let manapoints_added = new_manapoints - self.combat_details.current_manapoints;
        self.combat_details.current_manapoints = new_manapoints;
        manapoints_added
    }

    /// 等价 JS `reset(currentTime = 0)`（含 `resetCooldowns` 的随机数消费）。
    pub fn reset(&mut self, current_time: f64, rng: &mut Mulberry32) {
        self.clear_ccs();

        // 只有玩家在地下城团灭重开时保留 buff 与 CD；敌人始终完全重置。
        if current_time == 0.0 || !self.is_player {
            self.clear_buffs();
            self.reset_cooldowns(current_time, rng);
        } else {
            let _ = self.remove_expired_buffs(current_time, false);
            self.update_combat_details();
        }

        self.combat_details.current_hitpoints = self.combat_details.max_hitpoints;
        self.combat_details.current_manapoints = self.combat_details.max_manapoints;
    }

    /// 等价 JS `resetCooldowns(currentTime = 0)`：食品/饮料/技能冷却复位。
    /// 敌人的技能冷却带随机抖动，按 JS 顺序为每个非空技能各消费一次 `Math.random()`。
    pub fn reset_cooldowns(&mut self, current_time: f64, rng: &mut Mulberry32) {
        for consumable in self.food.iter_mut().flatten() {
            consumable.last_used = NUMBER_MIN_SAFE_INTEGER;
        }
        for consumable in self.drinks.iter_mut().flatten() {
            consumable.last_used = NUMBER_MIN_SAFE_INTEGER;
        }

        // JS 读的是 `combatDetails.combatStats.abilityHaste`：玩家侧恒为 undefined ⇒ 不缩放；
        // 怪物数据可能补 0 或正数。按 `haste > 0` 的裸比较语义建模。
        let haste = self.combat_details.combat_stats.ability_haste;
        let is_player = self.is_player;
        for ability in self.abilities.iter_mut().flatten() {
            if is_player {
                ability.last_used = NUMBER_MIN_SAFE_INTEGER;
            } else {
                let mut cooldown_duration = ability.cooldown_duration;
                if haste.is_some_and(|value| value > 0.0) {
                    cooldown_duration = (cooldown_duration * 100.0) / (100.0 + haste.unwrap_or(0.0));
                }
                ability.last_used = current_time - (cooldown_duration * 0.5).floor()
                    + (rng.next_f64() * cooldown_duration * 0.5).floor();
            }
        }
    }

    /// 便捷构造：给指定槽位装备技能（切片 4 探针 / 场景装配用）。
    pub fn set_ability(&mut self, slot: usize, ability: Ability) {
        self.abilities[slot] = Some(ability);
    }

    /// 便捷构造：给指定槽位装备食品或饮料。
    pub fn set_consumable(&mut self, is_food: bool, slot: usize, consumable: Consumable) {
        if is_food {
            self.food[slot] = Some(consumable);
        } else {
            self.drinks[slot] = Some(consumable);
        }
    }
}
