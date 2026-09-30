//! 战斗卷轴运行时（切片 17）：`src/combatsimulator/combatSimulator.js` 卷轴窗口状态机
//! （`initializeScrollRuntime` / `openScrollWindow` / `closeScrollWindow` /
//! `syncScrollsToTime` / `activateInitialScrolls` / `finalizeScrollUsage`）的数据结构。
//!
//! 说明：
//! - 窗口为半开区间 `[activeStartTime, activeUntil)`；续期事件 `ScrollRenewal` 由模拟器
//!   在 open 时按 `activeUntil < simulationTimeLimit` 排程（token 守卫旧事件）；
//! - 定义表（`durationNs` + buff 模板）由 JS 桥从真实游戏数据快照后随请求传入——
//!   Rust 侧不持有游戏数据；buff 模板与 `new Buff(template, 1)` 的注册输入一致
//!   （卷轴无等级，level=1 不做等级并入）。

use crate::hrid::Hrid;
use crate::sim_unit::UnitId;
use crate::unit::RawBuffInput;
use serde::{Deserialize, Serialize};

/// 桥侧快照的战斗卷轴定义（等价 JS `getCombatScrollDefinition(itemHrid)` 的被消费子集：
/// `durationNs` 与 `buff` 模板）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatScrollDefinition {
    pub item_hrid: String,
    pub duration_ns: f64,
    #[serde(default)]
    pub buff: RawBuffInput,
}

/// 单个（玩家, 物品）的卷轴运行时状态（等价 JS `scrollRuntimeByPlayer[player][item]`）。
#[derive(Clone, Debug)]
pub struct ScrollState {
    /// 拥有该卷轴的玩家（arena 下标；初始化时解析，副本/迷宫重开不改变）。
    pub player_id: UnitId,
    /// JS `String(player?.hrid || '')`（续期事件按此 hrid 定位）。
    pub player_hrid: Hrid,
    pub item_hrid: Hrid,
    /// JS `configuredQuantity`（`None` = `null` 无限库存）。
    pub configured_quantity: Option<f64>,
    /// JS `remaining`（`None` = 无限库存）。
    pub remaining: Option<f64>,
    pub started: bool,
    pub active: bool,
    pub active_start_time: f64,
    pub active_until: f64,
    /// JS `accumulatedDurationNs`（只写不读，保留以保持状态形状完整）。
    pub accumulated_duration_ns: f64,
    /// JS `token`（每次 open 自增；续期事件按 token 守卫过期事件）。
    pub token: f64,
    /// JS `state.buffUniqueHrid`（定义缺失时为 `""`）。
    pub buff_unique_hrid: Hrid,
    /// 定义表下标（初始化时解析；定义缺失的项不进入运行时状态）。
    pub definition_index: usize,
}
