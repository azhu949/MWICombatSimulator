//! 战斗事件（`src/combatsimulator/events/*.js` 的移植）：18 种事件 + `QueueItem` 实现。
//!
//! 设计要点：
//! - 事件持有 `UnitId`（竞技场下标）而非引用（JS 为对象引用），因此事件类型自身的
//!   `source()` / `target()` 语义必须与 JS 事件字段严格一致——`clearEventsForUnit`
//!   依赖它们；
//! - `damageOverTime` 事件在 JS 中刻意**没有** `source` 字段（只有 `sourceRef`），
//!   否则来源死亡会错误地清掉持续伤害事件；Rust 侧 `source()` 返回 `None`、
//!   `target()` 返回受击者；
//! - `curseExpiration` / `weakenExpiration` 的层数在**构造函数内**自增并封顶 5
//!   （与 JS 同构），调用方传入的是「当前层数」而不是最终值。
//!
//! 说明：JS 事件持有 consumable / ability 的**对象引用**，Rust 侧改为
//! `(UnitId, slot)` 定位（槽位在运行期不会被替换，语义等价）。

use crate::event_queue::QueueItem;
use crate::sim_unit::UnitId;

/// JS `Math.min`：NaN 会传播（Rust `f64::min` 会忽略 NaN，故不能直接映射）。
fn js_math_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/// 战斗事件（字段与 JS 事件类一一对应）。
#[derive(Clone, Debug, PartialEq)]
pub enum SimEvent {
    CombatStart {
        time: f64,
        id: u64,
    },
    PlayerRespawn {
        time: f64,
        id: u64,
        hrid: String,
    },
    EnemyRespawn {
        time: f64,
        id: u64,
    },
    AutoAttack {
        time: f64,
        id: u64,
        source: UnitId,
    },
    AbilityCastEnd {
        time: f64,
        id: u64,
        source: UnitId,
        ability_slot: usize,
    },
    ConsumableTick {
        time: f64,
        id: u64,
        source: UnitId,
        is_food: bool,
        slot: usize,
        total_ticks: f64,
        current_tick: f64,
    },
    DamageOverTime {
        time: f64,
        id: u64,
        source_ref: UnitId,
        target: UnitId,
        damage: f64,
        total_ticks: f64,
        current_tick: f64,
        combat_style_hrid: Option<String>,
    },
    CheckBuffExpiration {
        time: f64,
        id: u64,
        source: UnitId,
        buff_unique_hrid: Option<String>,
        buff_source_key: Option<String>,
    },
    ScrollRenewal {
        time: f64,
        id: u64,
        player_hrid: String,
        item_hrid: String,
        token: f64,
    },
    RegenTick {
        time: f64,
        id: u64,
    },
    StunExpiration {
        time: f64,
        id: u64,
        source: UnitId,
    },
    BlindExpiration {
        time: f64,
        id: u64,
        source: UnitId,
    },
    SilenceExpiration {
        time: f64,
        id: u64,
        source: UnitId,
    },
    CurseExpiration {
        time: f64,
        id: u64,
        source: UnitId,
        curse_amount: f64,
    },
    WeakenExpiration {
        time: f64,
        id: u64,
        source: UnitId,
        weaken_amount: f64,
    },
    FuryExpiration {
        time: f64,
        id: u64,
        source: UnitId,
        fury_amount: f64,
    },
    EnrageTick {
        time: f64,
        id: u64,
        encounter_time: f64,
    },
    AwaitCooldown {
        time: f64,
        id: u64,
        source: UnitId,
    },
    CooldownReady {
        time: f64,
        id: u64,
    },
}

impl SimEvent {
    /// 等价 JS `new CurseExpirationEvent(time, curseAmount, source)`（构造函数内自增封顶 5）。
    pub fn curse_expiration(time: f64, id: u64, curse_amount: f64, source: UnitId) -> Self {
        SimEvent::CurseExpiration {
            time,
            id,
            source,
            curse_amount: js_math_min(curse_amount + 1.0, 5.0),
        }
    }

    /// 等价 JS `new WeakenExpirationEvent(time, weakenAmount, source)`。
    pub fn weaken_expiration(time: f64, id: u64, weaken_amount: f64, source: UnitId) -> Self {
        SimEvent::WeakenExpiration {
            time,
            id,
            source,
            weaken_amount: js_math_min(weaken_amount + 1.0, 5.0),
        }
    }

    pub fn source_ref(&self) -> Option<UnitId> {
        match self {
            SimEvent::DamageOverTime { source_ref, .. } => Some(*source_ref),
            _ => None,
        }
    }

    pub fn ability_slot(&self) -> Option<usize> {
        match self {
            SimEvent::AbilityCastEnd { ability_slot, .. } => Some(*ability_slot),
            _ => None,
        }
    }

    pub fn buff_unique_hrid(&self) -> Option<&str> {
        match self {
            SimEvent::CheckBuffExpiration { buff_unique_hrid, .. } => buff_unique_hrid.as_deref(),
            _ => None,
        }
    }

    pub fn buff_source_key(&self) -> Option<&str> {
        match self {
            SimEvent::CheckBuffExpiration { buff_source_key, .. } => buff_source_key.as_deref(),
            _ => None,
        }
    }

    pub fn curse_amount(&self) -> Option<f64> {
        match self {
            SimEvent::CurseExpiration { curse_amount, .. } => Some(*curse_amount),
            _ => None,
        }
    }

    pub fn weaken_amount(&self) -> Option<f64> {
        match self {
            SimEvent::WeakenExpiration { weaken_amount, .. } => Some(*weaken_amount),
            _ => None,
        }
    }

    pub fn fury_amount(&self) -> Option<f64> {
        match self {
            SimEvent::FuryExpiration { fury_amount, .. } => Some(*fury_amount),
            _ => None,
        }
    }

    pub fn encounter_time(&self) -> Option<f64> {
        match self {
            SimEvent::EnrageTick { encounter_time, .. } => Some(*encounter_time),
            _ => None,
        }
    }

    pub fn is_food(&self) -> Option<bool> {
        match self {
            SimEvent::ConsumableTick { is_food, .. } => Some(*is_food),
            _ => None,
        }
    }

    pub fn slot(&self) -> Option<usize> {
        match self {
            SimEvent::ConsumableTick { slot, .. } => Some(*slot),
            _ => None,
        }
    }

    pub fn total_ticks(&self) -> Option<f64> {
        match self {
            SimEvent::ConsumableTick { total_ticks, .. } | SimEvent::DamageOverTime { total_ticks, .. } => {
                Some(*total_ticks)
            }
            _ => None,
        }
    }

    pub fn current_tick(&self) -> Option<f64> {
        match self {
            SimEvent::ConsumableTick { current_tick, .. } | SimEvent::DamageOverTime { current_tick, .. } => {
                Some(*current_tick)
            }
            _ => None,
        }
    }

    pub fn damage(&self) -> Option<f64> {
        match self {
            SimEvent::DamageOverTime { damage, .. } => Some(*damage),
            _ => None,
        }
    }

    pub fn combat_style_hrid(&self) -> Option<&str> {
        match self {
            SimEvent::DamageOverTime { combat_style_hrid, .. } => combat_style_hrid.as_deref(),
            _ => None,
        }
    }

    pub fn player_hrid(&self) -> Option<&str> {
        match self {
            SimEvent::ScrollRenewal { player_hrid, .. } => Some(player_hrid.as_str()),
            _ => None,
        }
    }

    pub fn item_hrid(&self) -> Option<&str> {
        match self {
            SimEvent::ScrollRenewal { item_hrid, .. } => Some(item_hrid.as_str()),
            _ => None,
        }
    }

    pub fn token(&self) -> Option<f64> {
        match self {
            SimEvent::ScrollRenewal { token, .. } => Some(*token),
            _ => None,
        }
    }
}

impl QueueItem for SimEvent {
    fn time(&self) -> f64 {
        match self {
            SimEvent::CombatStart { time, .. }
            | SimEvent::PlayerRespawn { time, .. }
            | SimEvent::EnemyRespawn { time, .. }
            | SimEvent::AutoAttack { time, .. }
            | SimEvent::AbilityCastEnd { time, .. }
            | SimEvent::ConsumableTick { time, .. }
            | SimEvent::DamageOverTime { time, .. }
            | SimEvent::CheckBuffExpiration { time, .. }
            | SimEvent::ScrollRenewal { time, .. }
            | SimEvent::RegenTick { time, .. }
            | SimEvent::StunExpiration { time, .. }
            | SimEvent::BlindExpiration { time, .. }
            | SimEvent::SilenceExpiration { time, .. }
            | SimEvent::CurseExpiration { time, .. }
            | SimEvent::WeakenExpiration { time, .. }
            | SimEvent::FuryExpiration { time, .. }
            | SimEvent::EnrageTick { time, .. }
            | SimEvent::AwaitCooldown { time, .. }
            | SimEvent::CooldownReady { time, .. } => *time,
        }
    }

    fn id(&self) -> u64 {
        match self {
            SimEvent::CombatStart { id, .. }
            | SimEvent::PlayerRespawn { id, .. }
            | SimEvent::EnemyRespawn { id, .. }
            | SimEvent::AutoAttack { id, .. }
            | SimEvent::AbilityCastEnd { id, .. }
            | SimEvent::ConsumableTick { id, .. }
            | SimEvent::DamageOverTime { id, .. }
            | SimEvent::CheckBuffExpiration { id, .. }
            | SimEvent::ScrollRenewal { id, .. }
            | SimEvent::RegenTick { id, .. }
            | SimEvent::StunExpiration { id, .. }
            | SimEvent::BlindExpiration { id, .. }
            | SimEvent::SilenceExpiration { id, .. }
            | SimEvent::CurseExpiration { id, .. }
            | SimEvent::WeakenExpiration { id, .. }
            | SimEvent::FuryExpiration { id, .. }
            | SimEvent::EnrageTick { id, .. }
            | SimEvent::AwaitCooldown { id, .. }
            | SimEvent::CooldownReady { id, .. } => *id,
        }
    }

    /// JS 事件 `type` 字符串（队列匹配依赖它们逐字一致）。
    fn event_type(&self) -> &str {
        match self {
            SimEvent::CombatStart { .. } => "combatStart",
            SimEvent::PlayerRespawn { .. } => "playerRespawn",
            SimEvent::EnemyRespawn { .. } => "enemyRespawn",
            SimEvent::AutoAttack { .. } => "autoAttack",
            SimEvent::AbilityCastEnd { .. } => "abilityCastEndEvent",
            SimEvent::ConsumableTick { .. } => "consumableTick",
            SimEvent::DamageOverTime { .. } => "damageOverTime",
            SimEvent::CheckBuffExpiration { .. } => "checkBuffExpiration",
            SimEvent::ScrollRenewal { .. } => "scrollRenewal",
            SimEvent::RegenTick { .. } => "regenTick",
            SimEvent::StunExpiration { .. } => "stunExpiration",
            SimEvent::BlindExpiration { .. } => "blindExpiration",
            SimEvent::SilenceExpiration { .. } => "silenceExpiration",
            SimEvent::CurseExpiration { .. } => "curseExpiration",
            SimEvent::WeakenExpiration { .. } => "weakenExpiration",
            SimEvent::FuryExpiration { .. } => "furyExpiration",
            SimEvent::EnrageTick { .. } => "enrageTick",
            SimEvent::AwaitCooldown { .. } => "awaitCooldownEvent",
            SimEvent::CooldownReady { .. } => "cooldownReady",
        }
    }

    /// JS 事件的 `source` 字段（DoT 刻意没有 source）。
    fn source(&self) -> Option<u64> {
        let unit = match self {
            SimEvent::AutoAttack { source, .. }
            | SimEvent::AbilityCastEnd { source, .. }
            | SimEvent::ConsumableTick { source, .. }
            | SimEvent::CheckBuffExpiration { source, .. }
            | SimEvent::StunExpiration { source, .. }
            | SimEvent::BlindExpiration { source, .. }
            | SimEvent::SilenceExpiration { source, .. }
            | SimEvent::CurseExpiration { source, .. }
            | SimEvent::WeakenExpiration { source, .. }
            | SimEvent::FuryExpiration { source, .. }
            | SimEvent::AwaitCooldown { source, .. } => Some(*source),
            _ => None,
        };
        unit.map(|value| value as u64)
    }

    /// JS 事件的 `target` 字段（仅 DoT 携带受击者）。
    fn target(&self) -> Option<u64> {
        match self {
            SimEvent::DamageOverTime { target, .. } => Some(*target as u64),
            _ => None,
        }
    }

    /// JS 事件的 `hrid` 字段（仅 playerRespawn 携带；scrollRenewal 用的是 playerHrid/itemHrid）。
    fn hrid(&self) -> Option<&str> {
        match self {
            SimEvent::PlayerRespawn { hrid, .. } => Some(hrid.as_str()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curse_and_weaken_amounts_increment_and_cap_like_js_constructors() {
        assert_eq!(SimEvent::curse_expiration(0.0, 1, 0.0, 0).curse_amount(), Some(1.0));
        assert_eq!(SimEvent::curse_expiration(0.0, 1, 4.0, 0).curse_amount(), Some(5.0));
        assert_eq!(SimEvent::curse_expiration(0.0, 1, 5.0, 0).curse_amount(), Some(5.0));
        assert_eq!(SimEvent::weaken_expiration(0.0, 1, 1.0, 0).weaken_amount(), Some(2.0));
        assert_eq!(SimEvent::weaken_expiration(0.0, 1, 9.0, 0).weaken_amount(), Some(5.0));
    }

    #[test]
    fn damage_over_time_has_no_source_field_but_has_target() {
        let event = SimEvent::DamageOverTime {
            time: 100.0,
            id: 7,
            source_ref: 1,
            target: 2,
            damage: 10.0,
            total_ticks: 3.0,
            current_tick: 1.0,
            combat_style_hrid: Some("/combat_styles/magic".to_string()),
        };
        assert_eq!(event.source(), None);
        assert_eq!(event.target(), Some(2));
        assert_eq!(event.source_ref(), Some(1));
        assert_eq!(event.event_type(), "damageOverTime");
    }

    #[test]
    fn event_type_strings_match_js_classes() {
        assert_eq!(SimEvent::CombatStart { time: 0.0, id: 0 }.event_type(), "combatStart");
        assert_eq!(SimEvent::EnemyRespawn { time: 0.0, id: 0 }.event_type(), "enemyRespawn");
        assert_eq!(
            SimEvent::AbilityCastEnd { time: 0.0, id: 0, source: 0, ability_slot: 0 }.event_type(),
            "abilityCastEndEvent"
        );
        assert_eq!(
            SimEvent::AwaitCooldown { time: 0.0, id: 0, source: 0 }.event_type(),
            "awaitCooldownEvent"
        );
        assert_eq!(
            SimEvent::PlayerRespawn { time: 0.0, id: 0, hrid: "/p/0".to_string() }.hrid(),
            Some("/p/0")
        );
        assert_eq!(
            SimEvent::CheckBuffExpiration {
                time: 0.0,
                id: 0,
                source: 0,
                buff_unique_hrid: Some("/buff_uniques/x".to_string()),
                buff_source_key: None,
            }
            .event_type(),
            "checkBuffExpiration"
        );
    }

    #[test]
    fn queue_item_sources_match_js_fields() {
        assert_eq!(SimEvent::AutoAttack { time: 1.0, id: 3, source: 5 }.source(), Some(5));
        assert_eq!(SimEvent::RegenTick { time: 1.0, id: 3 }.source(), None);
        assert_eq!(SimEvent::EnrageTick { time: 1.0, id: 3, encounter_time: 0.0 }.source(), None);
        assert_eq!(
            SimEvent::ScrollRenewal {
                time: 1.0,
                id: 3,
                player_hrid: "/p/0".to_string(),
                item_hrid: "/items/x".to_string(),
                token: 1.0,
            }
            .source(),
            None
        );
    }
}
