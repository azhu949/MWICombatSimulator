//! 战斗主循环：`src/combatsimulator/combatSimulator.js` 的逐方法移植。
//!
//! 覆盖范围（切片 4）：全部 18 种事件的处理、遭遇战切换/重生、CC/诅咒/虚弱/狂暴/
//! 激怒、技能四类效果（增益/伤害/治疗/复活/献祭/晋升）、消耗品使用与 tick、
//! 触发器轮询（`checkTriggers`）、攻击排程（`addNextAttackEvent`）。
//!
//! 刻意保留的 JS 既有怪癖（不得「改进」）：
//! - `randomInt` / 命中判定 / pierce 判定的随机数**消费顺序与次数**必须逐位一致：
//!   例如 `mayhem` 判定恒消费一次抽样、`parry` 判定在 `curse/fury/weaken` 之前、
//!   `pierce <= Math.random()` 只在 didHit 且未格挡时才抽样；
//! - 普攻累加事件时传入的能力名恒为字面量 `'autoAttack'`（JS 里那个 `attackType`
//!   变量是死代码，格挡时也不会变成 `'parry'`）；
//! - `checkParry` 在目标列表非空时必须抽样一次索引（即使 `parry <= 0` 的目标列表里
//!   仍有存活单位），命中后再次抽样比较；
//! - 多目标伤害效果里 `parry` 只检查第一个目标（`isSkipParry`），且威胁目标
//!   选择只在「非玩家 + targetType == 'enemy'」时触发；
//! - `Math.min` 的 NaN 传播、`ability.lastUsed` 的 JS 真值语义（0 与 NaN 为假）。
//!
//! 切片 4 的边界：无 zone / 无 labyrinth / 无卷轴（`combatScrollsEnabled` 恒 false），
//! `minimalResult` 语义（跳过经验/掉落记账）；这些在切片 5 接入生产路径时补齐。

use crate::ability::{Ability, AbilityEffect};
use crate::buff::{get_ability_buff_source_policy, BuffSourcePolicy};
use crate::combat_utilities::{
    calculate_tick_value, process_attack, process_heal_with_stats, process_revive_with_stats, process_spend_hp,
    AttackResult,
};
use crate::consumable::Consumable;
use crate::event_queue::{EventQueue, QueueItem};
use crate::hrid::{hrid_is, hrid_is_empty, hrid_to_string, intern_hrid, with_hrid, Hrid};
use crate::ordered_map::OrderedMap;
use crate::rng::Mulberry32;
use crate::sim_events::SimEvent;
use crate::sim_result::js_number_value;
use crate::sim_unit::{UnitArena, UnitId};
use crate::scroll::{CombatScrollDefinition, ScrollState};
use crate::unit::{policy_name, BuffList, BuffSourceSelector, CombatScrollConfig, CombatUnit, RawBuffInput, UnitError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;

pub const ONE_SECOND: f64 = 1e9;
pub const HOT_TICK_INTERVAL: f64 = 5.0 * ONE_SECOND;
pub const DOT_TICK_INTERVAL: f64 = 3.0 * ONE_SECOND;
pub const REGEN_TICK_INTERVAL: f64 = 10.0 * ONE_SECOND;
pub const ENEMY_RESPAWN_INTERVAL: f64 = 3.0 * ONE_SECOND;
pub const PLAYER_RESPAWN_INTERVAL: f64 = 150.0 * ONE_SECOND;
pub const RESTART_INTERVAL: f64 = 3.0 * ONE_SECOND;
pub const ENRAGE_TICK_INTERVAL: f64 = 60.0 * ONE_SECOND;
pub const CURSE_UNIQUE_HRID: Hrid = Hrid::BUFF_UNIQUE_CURSE;
pub const WEAKEN_UNIQUE_HRID: Hrid = Hrid::BUFF_UNIQUE_WEAKEN;
pub const FURY_ACCURACY_UNIQUE_HRID: Hrid = Hrid::BUFF_UNIQUE_FURY_ACCURACY;
pub const FURY_DAMAGE_UNIQUE_HRID: Hrid = Hrid::BUFF_UNIQUE_FURY_DAMAGE;
pub const ATTACK_EVENT_TYPES: [Hrid; 2] = [Hrid::EVENT_ABILITY_CAST_END, Hrid::EVENT_AUTO_ATTACK];

const CURSE_EXPIRE_TIME: f64 = 15_000_000_000.0;
const FURY_EXPIRE_TIME: f64 = 15_000_000_000.0;
const WEAKEN_EXPIRE_TIME: f64 = 15_000_000_000.0;
const MAX_FURY_STACK: f64 = 5.0;
const MAX_ENRAGE_STACK: f64 = 10.0;
/// 切片 26：迷宫槽位池的 tier 标签（键 `"<hrid>|lab"`）——迷宫怪恒 tier 0，
/// 与普通区域的 `"<hrid>|0"` 键隔离，避免同 hrid 跨模式误复用。
const POOL_LABYRINTH_TIER_LABEL: &str = "lab";

/// JS `Math.min`（NaN 传播）。
fn js_math_min(first: f64, second: f64) -> f64 {
    if first.is_nan() || second.is_nan() {
        f64::NAN
    } else if first < second {
        first
    } else {
        second
    }
}

/// JS `Math.max`（NaN 传播）。
fn js_math_max(first: f64, second: f64) -> f64 {
    if first.is_nan() || second.is_nan() {
        f64::NAN
    } else if first > second {
        first
    } else {
        second
    }
}

/// JS 数值真值语义（0 与 NaN 为假）。
fn js_truthy_number(value: f64) -> bool {
    value != 0.0 && !value.is_nan()
}

/// `Math.max(0, Number(value) || 0)`：NaN / 非数 → 0，负数 → 0。
fn normalize_time_limit(value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }
    if value < 0.0 {
        0.0
    } else {
        value
    }
}

/// JS `scroll:${itemHrid}` 源键（切片 25：驻留为句柄；构造点均为低频路径）。
fn scroll_source_key(item_hrid: Hrid) -> Hrid {
    intern_hrid(&format!("scroll:{}", hrid_to_string(item_hrid)))
}

/// 切片 15：`zone.dungeonSpawnInfo.maxWaves`（缺失时为 NaN —— JS `undefined` 参与
/// 比较恒为假，与 `getNextWave` 的守卫语义一致）。
fn dungeon_max_waves(zone: &crate::zone::Zone) -> f64 {
    zone.dungeon_spawn_info()
        .get("maxWaves")
        .map(|value| crate::zone::js_number(value))
        .unwrap_or(f64::NAN)
}

/// 攻击累加结果（`simResult.addAttack` 的第 4 参数：命中伤害值或 `'miss'`）。
#[derive(Clone, Debug, PartialEq)]
pub enum AttackOutcome {
    Miss,
    Damage(f64),
}

impl AttackOutcome {
    pub fn to_value(&self) -> Value {
        match self {
            AttackOutcome::Miss => json!("miss"),
            AttackOutcome::Damage(damage) => json!(*damage),
        }
    }
}

/// 一条 simResult 调用记录（与 JS 侧 `ParitySimResult` 的日志逐项对账）。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ResultCall {
    pub method: String,
    pub args: Vec<Value>,
}

/// 最小 simResult：切片 4 只记录调用序列（等价 JS `minimalResult` 语义）。
///
/// 切片 5 起该结构同时充当「记账门面」：探针模式（`real == None`）记录调用流水；
/// 生产模式（`real == Some(...)`）把同样的调用转发给真实 `SimResultState`，
/// 不再保留调用流水。所有调用点因此无需分支。
#[derive(Clone, Debug, Default)]
pub struct SimResultTally {
    pub calls: Vec<ResultCall>,
    pub call_count: u64,
    pub max_calls: usize,
    pub simulated_time: f64,
    pub stopped_early: bool,
    pub is_dungeon: bool,
    /// 生产模式下的真实聚合结果（JS `SimResult` / `FoodOptimizerSimResult`）。
    pub real: Option<Box<crate::sim_result::SimResultState>>,
}

impl SimResultTally {
    pub fn new(max_calls: usize) -> Self {
        Self {
            calls: Vec::new(),
            call_count: 0,
            max_calls,
            simulated_time: 0.0,
            stopped_early: false,
            is_dungeon: false,
            real: None,
        }
    }

    fn push(&mut self, method: &str, args: Vec<Value>) {
        self.call_count += 1;
        if self.calls.len() < self.max_calls {
            self.calls.push(ResultCall { method: method.to_string(), args });
        }
    }

    pub fn add_death(&mut self, hrid: Hrid) {
        if let Some(real) = self.real.as_mut() {
            real.add_death(hrid);
            return;
        }
        self.push("addDeath", vec![json!(hrid)]);
    }

    pub fn add_attack(&mut self, source_hrid: Hrid, target_hrid: Hrid, ability: Hrid, outcome: AttackOutcome) {
        if let Some(real) = self.real.as_mut() {
            real.add_attack(source_hrid, target_hrid, ability, &outcome);
            return;
        }
        self.push(
            "addAttack",
            vec![json!(source_hrid), json!(target_hrid), json!(ability), outcome.to_value()],
        );
    }

    pub fn add_hitpoints_gained(&mut self, hrid: Hrid, source_hrid: Hrid, amount: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_hitpoints_gained(hrid, source_hrid, amount);
            return;
        }
        self.push("addHitpointsGained", vec![json!(hrid), json!(source_hrid), json!(amount)]);
    }

    pub fn add_manapoints_gained(&mut self, hrid: Hrid, source_hrid: Hrid, amount: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_manapoints_gained(hrid, source_hrid, amount);
            return;
        }
        self.push("addManapointsGained", vec![json!(hrid), json!(source_hrid), json!(amount)]);
    }

    pub fn add_hitpoints_spent(&mut self, hrid: Hrid, source_hrid: Hrid, amount: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_hitpoints_spent(hrid, source_hrid, amount);
            return;
        }
        self.push("addHitpointsSpent", vec![json!(hrid), json!(source_hrid), json!(amount)]);
    }

    pub fn add_ran_out_of_mana_count(&mut self, hrid: Hrid, ran_out: bool, time: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_ran_out_of_mana_count(hrid, ran_out, time);
            return;
        }
        self.push("addRanOutOfManaCount", vec![json!(hrid), json!(ran_out), json!(time)]);
    }

    pub fn add_consumable_use(&mut self, hrid: Hrid, consumable_hrid: Hrid) {
        if let Some(real) = self.real.as_mut() {
            real.add_consumable_use(hrid, consumable_hrid);
            return;
        }
        self.push("addConsumableUse", vec![json!(hrid), json!(consumable_hrid)]);
    }

    pub fn add_encounter_end(&mut self) {
        if let Some(real) = self.real.as_mut() {
            real.add_encounter_end();
            return;
        }
        self.push("addEncounterEnd", vec![]);
    }

    pub fn update_time_spent_alive(&mut self, hrid: &str, alive: bool, time: f64) {
        if let Some(real) = self.real.as_mut() {
            // JS minimal 变体把该方法重写为空操作；失败路径与 JS 一样不应触发 panic。
            let _ = real.update_time_spent_alive(hrid, alive, time);
            return;
        }
        self.push("updateTimeSpentAlive", vec![json!(hrid), json!(alive), json!(time)]);
    }

    /// 切片 12：提前停止谓词的只读视图（`hrid` 未记账时等价 JS 的 `undefined` 归一）。
    pub fn deaths_for(&self, hrid: Hrid) -> f64 {
        match self.real.as_ref() {
            Some(real) => real.deaths_value(hrid),
            None => 0.0,
        }
    }

    /// `playerRanOutOfMana[hrid] === true`（缺键 / false / 探针模式都为假）。
    pub fn mana_out_for(&self, hrid: Hrid) -> bool {
        match self.real.as_ref() {
            Some(real) => real.player_ran_out_of_mana_value(hrid),
            None => false,
        }
    }

    /// 切片 20：`consumablesUsed[unitHrid]?.[itemHrid] || 0`（探针模式恒 0）。
    pub fn consumables_used_for(&self, unit_hrid: Hrid, item_hrid: Hrid) -> f64 {
        match self.real.as_ref() {
            Some(real) => real.consumables_used_value(unit_hrid, item_hrid),
            None => 0.0,
        }
    }

    /// 探针模式只记录 hrid（与 JS `ParitySimResult` 一致）；生产模式转发完整统计值。
    pub fn set_drop_rate_multipliers(
        &mut self,
        hrid: Hrid,
        combat_drop_rate: f64,
        combat_rare_find: f64,
        combat_drop_quantity: f64,
        debuff_on_level_gap: f64,
    ) {
        if let Some(real) = self.real.as_mut() {
            // 倍率的 `1 + stat` 由 `SimResultState::set_drop_rate_multipliers` 施加（JS 语义），
            // 这里必须传原始面板值——重复加 1 会让 minimal 路径外的结果静默翻倍。
            real.set_drop_rate_multipliers(
                hrid,
                combat_drop_rate,
                combat_rare_find,
                combat_drop_quantity,
                debuff_on_level_gap,
            );
            return;
        }
        self.push("setDropRateMultipliers", vec![json!(hrid)]);
    }

    /// 探针模式只记录 hrid；生产模式复制 `abilityManaCosts` 快照。
    pub fn set_mana_used(&mut self, hrid: Hrid, entries: &[(Hrid, f64)]) {
        if let Some(real) = self.real.as_mut() {
            real.set_mana_used(hrid, entries);
            return;
        }
        self.push("setManaUsed", vec![json!(hrid)]);
    }

    pub fn set_scroll_usage_context(&mut self, allowed: bool, context: &str) {
        if let Some(real) = self.real.as_mut() {
            real.set_scroll_usage_context(allowed, context);
            return;
        }
        self.push("setScrollUsageContext", vec![json!(allowed), json!(context)]);
    }

    pub fn set_scroll_usage_disabled(&mut self, disabled: bool) {
        if let Some(real) = self.real.as_mut() {
            real.set_scroll_usage_disabled(disabled);
            return;
        }
        self.push("setScrollUsageDisabled", vec![json!(disabled)]);
    }

    /// 切片 17：生产模式专用：JS `simResult.setScrollConfiguration(playerHrid, itemHrid, finiteQuantity)`。
    pub fn set_scroll_configuration(&mut self, player_hrid: Hrid, item_hrid: Hrid, configured_quantity: Option<f64>) {
        if let Some(real) = self.real.as_mut() {
            real.set_scroll_configuration(player_hrid, item_hrid, configured_quantity);
            return;
        }
        self.push("setScrollConfiguration", vec![json!(player_hrid), json!(item_hrid)]);
    }

    /// 切片 17：生产模式专用：JS `simResult.recordScrollOpen(playerHrid, itemHrid, details)`。
    pub fn record_scroll_open(
        &mut self,
        player_hrid: Hrid,
        item_hrid: Hrid,
        opened_count: f64,
        active_duration_ns: f64,
        exhausted: Option<bool>,
    ) {
        if let Some(real) = self.real.as_mut() {
            real.record_scroll_open(player_hrid, item_hrid, opened_count, active_duration_ns, exhausted);
            return;
        }
        self.push("recordScrollOpen", vec![json!(player_hrid), json!(item_hrid)]);
    }

    /// 切片 17：生产模式专用：JS `simResult.recordScrollWindow(playerHrid, itemHrid, duration)`。
    pub fn record_scroll_window(&mut self, player_hrid: Hrid, item_hrid: Hrid, active_duration_ns: f64) {
        if let Some(real) = self.real.as_mut() {
            real.record_scroll_window(player_hrid, item_hrid, active_duration_ns);
            return;
        }
        self.push("recordScrollWindow", vec![json!(player_hrid), json!(item_hrid)]);
    }

    /// 切片 17：生产模式专用：JS `finalizeScrollUsage` 的 `entry.exhausted = ...` 直写。
    pub fn finalize_scroll_exhausted(&mut self, player_hrid: Hrid, item_hrid: Hrid, configured_quantity: Option<f64>) {
        if let Some(real) = self.real.as_mut() {
            real.finalize_scroll_exhausted(player_hrid, item_hrid, configured_quantity);
            return;
        }
        self.push("finalizeScrollExhausted", vec![json!(player_hrid), json!(item_hrid)]);
    }

    /// 生产模式专用：`simResult.lastEncounterFinishTime = time` 的直接属性写入。
    pub fn set_last_encounter_finish_time(&mut self, value: f64) {
        if let Some(real) = self.real.as_mut() {
            real.set_last_encounter_finish_time(value);
        }
    }

    /// 切片 19：生产模式专用：JS `simResult.addWipeEvent(logs, simulationTime, wave)`。
    /// 探针分支不消费（minimal 恒空），仅记名。
    pub fn add_wipe_event(&mut self, logs: Value, simulation_time: f64, wave: f64, timestamp: String) {
        if let Some(real) = self.real.as_mut() {
            real.add_wipe_event(logs, simulation_time, wave, timestamp);
        }
    }

    /// 切片 15：生产模式专用：JS `simResult.updateDungenonFinish(beginFlag, finishTime)`。
    pub fn update_dungenon_finish(&mut self, begin_flag: &str, finish_time: f64) {
        if let Some(real) = self.real.as_mut() {
            real.update_dungenon_finish(begin_flag, finish_time);
        }
    }

    /// 切片 15：生产模式专用：JS `simResult.lastDungeonFinishTime = time` 的直接属性写入。
    pub fn set_last_dungeon_finish_time(&mut self, value: f64) {
        if let Some(real) = self.real.as_mut() {
            real.set_last_dungeon_finish_time(value);
        }
    }

    /// 切片 15：生产模式专用：JS `simResult.bossSpawns.push(...)`（minimal 变体也照常写）。
    pub fn push_boss_spawn(&mut self, label: String) {
        if let Some(real) = self.real.as_mut() {
            real.push_boss_spawn(label);
        }
    }

    /// 生产模式专用：`addTimeSeriesSnapshot`（可视化关闭时不会被调用）。
    pub fn add_time_series_snapshot(&mut self, time: f64, players: &[(Hrid, f64, f64, f64, f64)]) {
        if let Some(real) = self.real.as_mut() {
            real.add_time_series_snapshot(time, players);
        }
    }

    /// 等价 JS `reset()` 里 `this.simResult = this.createSimResult()` 之后的两次上下文调用。
    pub fn reset_like_js(&mut self) {
        self.calls.clear();
        self.call_count = 0;
        self.simulated_time = 0.0;
        self.stopped_early = false;
        self.is_dungeon = false;
    }
}

/// 事件轨迹条目（与 JS 驱动 `describeEvent` 的输出成对维护）。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EventTraceEntry {
    pub time: f64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub source: Option<String>,
    pub target: Option<String>,
    pub hrid: Option<String>,
    pub value: Option<f64>,
}

/// 关卡等级（场景 JSON 输入，等价 JS `Object.assign(unit, levels)`）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelsSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamina_level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intelligence_level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attack_level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub melee_level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defense_level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ranged_level: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magic_level: Option<f64>,
}

impl LevelsSpec {
    fn apply(&self, unit: &mut CombatUnit) {
        if let Some(value) = self.stamina_level {
            unit.stamina_level = value;
        }
        if let Some(value) = self.intelligence_level {
            unit.intelligence_level = value;
        }
        if let Some(value) = self.attack_level {
            unit.attack_level = value;
        }
        if let Some(value) = self.melee_level {
            unit.melee_level = value;
        }
        if let Some(value) = self.defense_level {
            unit.defense_level = value;
        }
        if let Some(value) = self.ranged_level {
            unit.ranged_level = value;
        }
        if let Some(value) = self.magic_level {
            unit.magic_level = value;
        }
    }
}

/// 单位场景定义（JS 侧 `buildUnitFromSpec` 成对维护，字段与消费方式一一对应）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitSpec {
    pub hrid: String,
    #[serde(default)]
    pub is_player: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub levels: Option<LevelsSpec>,
    #[serde(default)]
    pub combat_stats: Vec<(String, f64)>,
    /// 面板字符串字段（`combatStyleHrid` / `damageType` / `primaryTraining` / `focusTraining`）：
    /// 与 `combat_stats` 同源快照，数字键走前者、字符串键走这里；自动攻击的命中/伤害
    /// 分派依赖战斗风格与伤害类型，缺省会静默退回 `/combat_styles/smash`。
    #[serde(default)]
    pub combat_stats_strings: Vec<(String, String)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub two_hand_hrid: Option<String>,
    #[serde(default)]
    pub enrage_time: f64,
    #[serde(default)]
    pub experience: f64,
    /// JS 玩家 DTO 顶层 `debuffOnLevelGap`（怪物缺省 0）：影响经验收益与掉落
    /// 上下文桶。切片 14 前桥不序列化（默认 0 恰好等于怪物/普通玩家值）。
    #[serde(default)]
    pub debuff_on_level_gap: f64,
    #[serde(default)]
    pub house_rooms: Vec<BuffList>,
    #[serde(default)]
    pub guild_buffs: Vec<BuffList>,
    #[serde(default)]
    pub achievements: Option<BuffList>,
    #[serde(default)]
    pub zone_buffs: Vec<RawBuffInput>,
    #[serde(default)]
    pub extra_buffs: Vec<RawBuffInput>,
    /// 构造期已合并的永久增益（JS `unit.permanentBuffs` 的 `Object.values` 快照，
    /// 装备/房屋等来源已在 JS 侧按 typeHrid 合并；键序 = JS 插入序）。
    /// `generatePermanentBuffs` 会在 t=0 把 zone/extra 等来源继续并入同一张表。
    #[serde(default)]
    pub permanent_buffs: Vec<crate::buff::Buff>,
    #[serde(default)]
    pub abilities: Vec<Option<Ability>>,
    #[serde(default)]
    pub food: Vec<Option<Consumable>>,
    #[serde(default)]
    pub drinks: Vec<Option<Consumable>>,
    /// 切片 17：玩家配置的战斗卷轴（JS `player.combatScrolls` 归一投影；怪物为空）。
    #[serde(default)]
    pub combat_scrolls: Vec<CombatScrollConfig>,
    /// 该单位在 JS 侧是否由 `Player` / `Monster` 构建（类覆写会重写「类自有」面板字段）。
    /// 生产桥始终为 true；合成单位（探针）保持 false 以对齐同样合成构建的 JS 侧。
    #[serde(default)]
    pub class_owned_stats: bool,
}

/// 由场景定义构建单位（JS 侧同序：等级 → 面板 → 基准捕获 → 结算 → 技能/消耗品）。
pub fn build_unit_from_spec(spec: &UnitSpec) -> Result<CombatUnit, UnitError> {
    let _prof = crate::prof::start("unit.build_from_spec");
    let mut unit = CombatUnit { is_player: spec.is_player, ..Default::default() };
    apply_unit_spec(&mut unit, spec)?;
    Ok(unit)
}

/// `build_unit_from_spec` 的公共主体：把 spec 写入一个处于 **default 形态** 的单位
/// （`is_player` 由调用方预设）。切片 26 的 `restore_for_respawn` 走同一路径——
/// 「复用槽位」与「新建单位」因此逐字段一致（等价性由双跑测试锁定）。
fn apply_unit_spec(unit: &mut CombatUnit, spec: &UnitSpec) -> Result<(), UnitError> {
    unit.hrid = intern_hrid(&spec.hrid);

    let _prof_spec_apply = crate::prof::start("unit.spec_apply");
    if let Some(levels) = &spec.levels {
        levels.apply(unit);
    }

    for (name, value) in &spec.combat_stats {
        match name.as_str() {
            "tenacity" => unit.combat_details.combat_stats.tenacity = Some(*value),
            "abilityHaste" => unit.combat_details.combat_stats.ability_haste = Some(*value),
            other => {
                if !unit.combat_details.combat_stats.set_numeric_field(other, *value) {
                    return Err(UnitError::error(format!("unknown combat stat field: {other}")));
                }
            }
        }
    }

    for (name, value) in &spec.combat_stats_strings {
        if !unit.combat_details.combat_stats.set_string_field(name, value) {
            return Err(UnitError::error(format!("unknown combat stat string field: {name}")));
        }
    }

    drop(_prof_spec_apply);

    unit.enrage_time = spec.enrage_time;
    unit.experience = spec.experience;
    unit.debuff_on_level_gap = spec.debuff_on_level_gap;
    unit.two_hand_hrid = spec.two_hand_hrid.as_deref().map(intern_hrid);
    unit.house_rooms = spec.house_rooms.clone();
    unit.guild_buffs = spec.guild_buffs.clone();
    unit.achievements = spec.achievements.clone();
    unit.zone_buffs = spec.zone_buffs.clone();
    unit.extra_buffs = spec.extra_buffs.clone();
    unit.combat_scrolls = spec.combat_scrolls.clone();
    // 构造期永久增益：JS 侧 `permanentBuffs` 已按 typeHrid 合并，这里直接按序播种。
    for buff in &spec.permanent_buffs {
        unit.permanent_buffs.set(buff.type_hrid, buff.clone());
    }

    // 构造期「类自有」面板快照：与基准同源，供 `clear_ccs` 的基准刷新点恢复字段。
    if spec.class_owned_stats {
        unit.class_base_combat_stats = Some(unit.combat_details.combat_stats.clone());
    }

    unit.refresh_base_combat_stats();
    unit.update_combat_details();

    let _prof_spec_loadout = crate::prof::start("unit.spec_loadout");
    for (index, ability) in spec.abilities.iter().enumerate() {
        if index >= unit.abilities.len() {
            // JS `player.abilities = dto.abilities.map(...)`：槽位数 = DTO 长度（可超过默认 4 槽），
            // 模拟器按数组长度遍历，因此这里按需扩展而不是截断。
            unit.abilities.push(None);
        }
        unit.abilities[index] = ability.clone();
    }
    for (index, item) in spec.food.iter().enumerate() {
        if index >= unit.food.len() {
            unit.food.push(None);
        }
        unit.food[index] = item.clone();
    }
    for (index, item) in spec.drinks.iter().enumerate() {
        if index >= unit.drinks.len() {
            unit.drinks.push(None);
        }
        unit.drinks[index] = item.clone();
    }

    drop(_prof_spec_loadout);

    Ok(())
}

impl CombatUnit {
    /// 切片 26：重生槽位复用——把本槽位**原地**重建为 spec 对应的新单位。
    ///
    /// 步骤与 `build_unit_from_spec` 完全同序：先恢复 default 形态
    /// （`reset_to_default_in_place`，保留 Vec 容量），再走 `apply_unit_spec`，
    /// 最后写入实例难度档与重生池键（等价 `instantiate_templates` 对新建单位的收尾）。
    pub fn restore_for_respawn(
        &mut self,
        spec: &UnitSpec,
        respawn_pool_key: String,
        difficulty_tier: f64,
    ) -> Result<(), UnitError> {
        let _prof = crate::prof::start("unit.restore_for_respawn");
        {
            let _prof_reset = crate::prof::start("respawn.reset_default");
            self.reset_to_default_in_place();
        }
        self.is_player = spec.is_player;
        {
            let _prof_apply = crate::prof::start("respawn.apply_spec");
            apply_unit_spec(self, spec)?;
        }
        self.difficulty_tier = Some(difficulty_tier);
        self.respawn_pool_key = Some(respawn_pool_key);
        Ok(())
    }
}

/// 怪物模板（切片 5 生产模式）：按 `(hrid, difficultyTier)` 预生成，遭遇战开始时按需实例化。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSpec {
    pub hrid: String,
    pub difficulty_tier: f64,
    pub spec: UnitSpec,
}

/// 模拟器构造选项。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorOptions {
    #[serde(default)]
    pub seed: u32,
    #[serde(default)]
    pub simulation_time_limit: f64,
    #[serde(default)]
    pub trace_limit: usize,
    #[serde(default = "default_max_result_calls")]
    pub max_result_calls: usize,
    /// JS 侧存在 zone（普通区域，非地下城）时敌人重生/玩家复活才会排程。
    #[serde(default)]
    pub zone_present: bool,
    /// 切片 4 不支持地下城（`zone.isDungeon === true` 的分支未移植）。
    #[serde(default)]
    pub zone_is_dungeon: bool,
    /// 切片 4 不支持迷宫。
    #[serde(default)]
    pub labyrinth_present: bool,
    #[serde(default)]
    pub encounter_specs: Vec<Vec<UnitSpec>>,
    #[serde(default)]
    pub promotion_specs: Vec<(String, UnitSpec)>,
    #[serde(default)]
    pub blaze_ability: Option<Ability>,
    #[serde(default)]
    pub bloom_ability: Option<Ability>,
    // ------------------------------------------------------------------
    // 切片 5：生产模式（真实区域 + 真实聚合结果）
    // ------------------------------------------------------------------
    /// `true` 时使用真实 `SimResult`/`FoodOptimizerSimResult` 聚合（`minimal_result` 同时选择
    /// 结果类），而不是探针的调用流水。
    #[serde(default)]
    pub real_result: bool,
    /// `true` = JS `FoodOptimizerSimResult`（字段更少、多个钩子为空操作）。
    #[serde(default)]
    pub minimal_result: bool,
    #[serde(default)]
    pub zone_hrid: Option<String>,
    #[serde(default)]
    pub zone_difficulty_tier: f64,
    #[serde(default)]
    pub zone_monster_spawn_info: Option<Value>,
    #[serde(default)]
    pub zone_dungeon_spawn_info: Option<Value>,
    #[serde(default)]
    pub encounter_templates: Vec<TemplateSpec>,
    #[serde(default)]
    pub labyrinth_name: Option<String>,
    #[serde(default)]
    pub labyrinth_room_level: f64,
    /// `combatStyleDetailMap[styleHrid].skillExpMap` 的键序快照（经验计算用）。
    #[serde(default)]
    pub combat_style_skill_exp_map: Vec<(String, Vec<String>)>,
    /// JS `logCombatEvents`（切片 14 起不再限制：仅控制台输出，不产生结果数据）。
    #[serde(default)]
    pub log_combat_events: bool,
    /// JS `enableHpMpVisualization`（切片 14 起支持：每 1000 个事件采集一次时序快照，
    /// 随 simResult 的 `timeSeriesData` 一次性返回）。
    #[serde(default)]
    pub enable_hp_mp_visualization: bool,
    /// JS `combatScrollsEnabled`（切片 17 起引擎侧完整支持：窗口开启/续期/关闭与记账）。
    #[serde(default)]
    pub combat_scrolls_enabled: bool,
    /// JS `isGuildTrial`（为 true 时 `scrollsAllowed` 为假、卷轴上下文为 'guild_trial'）。
    #[serde(default)]
    pub is_guild_trial: bool,
    /// 切片 17：战斗卷轴定义表（桥侧对 `getCombatScrollDefinition(itemHrid)` 的快照：
    /// `durationNs` + `buff` 模板）。Rust 不持有游戏数据，缺定义的配置项在初始化时跳过。
    #[serde(default)]
    pub combat_scroll_definitions: Vec<CombatScrollDefinition>,
    /// 切片 12：提前停止谓词（等价 JS `simulate(limit, { shouldStop })` 回调）。
    ///
    /// 生产调用方只用一种谓词（食物优化器候选轮）：`playerRanOutOfMana[watchHrid] ===
    /// true || (deaths[watchHrid] || 0) > deathLimit`——两个状态都单调（空蓝粘滞、
    /// 死亡只增），Rust 侧在**每个事件处理后**求值（与 JS 检查点逐事件一致）。
    /// `death_limit` 为 `None` 时表示 JS 的 `Infinity`（无死亡上限，仅空蓝停止）。
    /// 通用 JS 回调（任意谓词）不在 WASM 契约内，仍由 JS 引擎承接。
    #[serde(default)]
    pub early_stop: Option<EarlyStopSpec>,
    /// 切片 13：观察器（等价 JS `observeFoodOptimizerThresholds` /
    /// `observeInactiveFoodThresholds`）。`None` = 不观察（基线轮）。
    #[serde(default)]
    pub observers: Option<ObserverSpec>,
    /// 切片 20：成本上界观察器（等价 JS `observeFoodOptimizerCostBound`）。`None` =
    /// 不安装（非 top-ten 剪枝轮）。与 `earlyStop` 组合成 JS `shouldStop` 的完整语义
    ///（失败谓词优先、成本其次——`||` 短路顺序一致）。
    #[serde(default)]
    pub cost_bound: Option<CostBoundSpec>,
}

/// 提前停止谓词参数（切片 12）。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlyStopSpec {
    /// 监视单位的 hrid（如 `player1`；反序列化时直接驻留为句柄）。
    pub watch_hrid: Hrid,
    /// 死亡上限；`None` = JS `Infinity`（不因死亡停止）。
    pub death_limit: Option<f64>,
}

/// 切片 13：观察器参数（等价 JS 侧 `observeFoodOptimizerThresholds` +
/// `observeInactiveFoodThresholds` 包装）。两者都是**纯读窥视**：不改 RNG、不改
/// 事件流、不改比较结果——只在既有代码路径旁同步记录。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverSpec {
    /// 监视单位的 hrid（食物优化器为活动玩家，如 `player1`；反序列化时直接驻留为句柄）。
    pub watch_hrid: Hrid,
}

/// 切片 20：成本上界观察器参数（等价 JS `observeFoodOptimizerCostBound` 的安装快照）。
///
/// 价格由桥侧预解析成 `[hrid, price]` 快照：键序 = 监视玩家 food 槽序（`filter(Boolean)`
/// 去重——与 JS `foodUsed` 的求和序逐字一致），且只含 food 类目条目（等价
/// `computeFoodCostPerHour` 的 `itemDetailIndex` 类目过滤）；`resolveMarketPrice` 的
/// bid/ask/vendor 兜底也一并固化在快照里，引擎不持有市场数据。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostBoundSpec {
    /// 监视单位的 hrid（食物优化器为活动玩家，如 `player1`；反序列化时直接驻留为句柄）。
    pub watch_hrid: Hrid,
    /// 成本上界（JS `cutoff`；有限非负由桥侧安装条件保证，非法值不激活观察器）。
    pub cutoff: f64,
    /// 已完成轮次的累计小时成本（JS `completedCostPerHour`）。
    pub completed_cost_per_hour: f64,
    /// 总轮数（JS `totalRounds`；安全整数 ≥ 1）。
    pub total_rounds: f64,
    /// 价格快照（`[[hrid, price], ...]`，求和按此顺序）。
    pub prices: Vec<(String, f64)>,
}

/// 单槽位阈值区间（等价 JS `observeFoodOptimizerThresholds` 的 ranges 元素）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdRange {
    pub hrid: String,
    pub kind: String,
    pub min: f64,
    pub max: f64,
}

/// 观察器运行时状态（切片 13）。
#[derive(Debug)]
pub struct ObserverState {
    /// 阈值观察（None = 形态不匹配或观察到非有限值，等价 JS `() => null`）。
    threshold_valid: bool,
    /// 每个已观察槽位的 (hrid, kind, min, max)；槽位索引为下标。
    threshold_ranges: Vec<ThresholdRange>,
    /// 闲置食物观察（None = 无效）。
    inactive_valid: bool,
    inactive_hp: f64,
    inactive_mp: f64,
}

impl ObserverState {
    fn new(_spec: &ObserverSpec, player_food: &[Option<Consumable>]) -> Self {
        // JS observeFoodOptimizerThresholds：形态不匹配 → readThresholds() 返回 null；
        // 闲置观察器（observeInactiveFoodThresholds）不依赖形态，恒为有效。
        let mut state = Self {
            threshold_valid: true,
            threshold_ranges: Vec::new(),
            inactive_valid: true,
            inactive_hp: 1.0,
            inactive_mp: 1.0,
        };
        for slot in player_food {
            let Some(consumable) = slot else { continue };
            let Some(trigger) = consumable.triggers.first() else {
                state.threshold_valid = false;
                state.threshold_ranges.clear();
                break;
            };
            let kind = match trigger.condition_hrid {
                Hrid::TRIGGER_COND_MISSING_HP => "hp",
                Hrid::TRIGGER_COND_MISSING_MP => "mp",
                _ => {
                    state.threshold_valid = false;
                    state.threshold_ranges.clear();
                    break;
                }
            };
            if trigger.dependency_hrid != Hrid::TRIGGER_DEP_SELF
                || trigger.comparator_hrid != Hrid::TRIGGER_CMP_GREATER_THAN_EQUAL
                || consumable.triggers.len() != 1
                || !is_safe_integer(trigger.value)
            {
                state.threshold_valid = false;
                state.threshold_ranges.clear();
                break;
            }
            state.threshold_ranges.push(ThresholdRange {
                hrid: hrid_to_string(consumable.hrid),
                kind: kind.to_string(),
                min: 1.0,
                max: MAX_SAFE_INTEGER_F64,
            });
        }
        state
    }

    /// JS 包装后的 compareValue：窥视 (value, active) 收敛区间。
    fn observe_threshold_compare(&mut self, slot_index: usize, value: f64, active: bool) {
        let Some(range) = self.threshold_ranges.get_mut(slot_index) else { return };
        if !value.is_finite() {
            self.threshold_valid = false;
            return;
        }
        if active {
            range.max = range.max.min(value.floor());
        } else {
            range.min = range.min.max(value.floor() + 1.0);
        }
    }

    /// JS observeInactiveFoodThresholds 的 observe(unit)：存活且未眩晕时更新缺口下界。
    fn observe_inactive(&mut self, hp_deficit: f64, mp_deficit: f64) {
        if !hp_deficit.is_finite() || !mp_deficit.is_finite() {
            self.inactive_valid = false;
            return;
        }
        self.inactive_hp = self.inactive_hp.max(hp_deficit.floor() + 1.0);
        self.inactive_mp = self.inactive_mp.max(mp_deficit.floor() + 1.0);
        if !is_safe_integer(self.inactive_hp) || !is_safe_integer(self.inactive_mp) {
            self.inactive_valid = false;
        }
    }

    /// 导出（等价 JS readThresholds() / readInactiveFood() 的返回形状）。
    fn to_value(&self) -> Value {
        json!({
            "thresholdRanges": if self.threshold_valid {
                json!(self.threshold_ranges)
            } else {
                Value::Null
            },
            "inactiveMinimum": if self.inactive_valid {
                json!({ "hp": self.inactive_hp, "mp": self.inactive_mp })
            } else {
                Value::Null
            },
        })
    }
}

/// 切片 13：`should_trigger` 快速路径的阈值窥视句柄（等价 JS
/// `observeFoodOptimizerThresholds` 包装的 compareValue）——借用 `ObserverState`，
/// 在 compare_value 被真正调用的那一刻转发 (value, active)。具体 struct 而非
/// `dyn FnMut`：零虚调用开销，food 循环用 take/put 绕开借用冲突时也能整体移动。
pub struct ThresholdObserve<'a> {
    state: &'a mut ObserverState,
    slot_index: usize,
}

impl ThresholdObserve<'_> {
    /// 记录一次比较观察：active 收缩上界 / inactive 抬高下界（等价 JS 包装体）。
    pub fn record(&mut self, value: f64, active: bool) {
        self.state.observe_threshold_compare(self.slot_index, value, active);
    }
}

/// JS `Number.isSafeInteger`.
fn is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER_F64
}

/// 切片 20：成本上界观察器运行时状态（等价 JS `observeFoodOptimizerCostBound` 闭包）。
///
/// 与阈值/闲置观察器不同，本观察器**会停止模拟**（等价 JS `shouldStop` 谓词的成本
/// 分支），但不改 RNG、不改事件流、不改 simResult——停止结论与下界只走独立输出字段。
struct CostBoundState {
    cutoff: f64,
    completed_cost_per_hour: f64,
    total_rounds: f64,
    /// 价格快照（求和顺序 = 玩家 food 槽序；空 = 无食物槽，恒不置 dirty）。
    prices: Vec<(String, f64)>,
    /// JS `dirty`：监视玩家成功使用其 food 槽物品后置位，下一次检查点重算。
    dirty: bool,
    /// 最新成本下界（None = 非有限，等价 JS `null`）。
    cost_lower_bound: Option<f64>,
    /// JS `aboveCutoff`。
    above_cutoff: bool,
    /// JS `stoppedForCost`：本轮是否已因成本停止（earlyStop 先触发时恒 false）。
    stopped_for_cost: bool,
}

impl CostBoundState {
    /// 安装校验 + 初值（等价 JS 观察器构造体：`computeFoodOptimizerCostLowerBound` 与
    /// `isFoodOptimizerCostAboveCutoff` 的首轮求值）。守卫不过 → 不激活（None）。
    fn try_new(spec: &CostBoundSpec) -> Option<Self> {
        let initial = cost_lower_bound_of(spec.completed_cost_per_hour, 0.0, spec.total_rounds)?;
        Some(Self {
            cutoff: spec.cutoff,
            completed_cost_per_hour: spec.completed_cost_per_hour,
            total_rounds: spec.total_rounds,
            prices: spec.prices.clone(),
            dirty: false,
            cost_lower_bound: Some(initial),
            above_cutoff: cost_above_cutoff(Some(initial), spec.cutoff),
            stopped_for_cost: false,
        })
    }

    /// JS `foods.has(consumable)` 的等价判断（价格快照键集 = food 槽 hrid 集合）。
    fn watches_food(&self, hrid: Hrid) -> bool {
        with_hrid(hrid, |name| self.prices.iter().any(|(food, _)| food == name))
    }

    /// JS `shouldStop()` 的 dirty 分支：从 `consumablesUsed` 全量快照重算。
    ///
    /// 逐字镜像 `computeFoodCostPerHour`：以**全额** `simulationTimeLimit` 为除数
    ///（绝不除以已流逝时长）、按 foodUsed 键序（= 槽序）累加 `max(0,count)*max(0,price)`、
    /// 总和除以小时数。`hours <= 0` 在安装守卫下不可达（JS 会抛 RangeError），防御性
    /// 保持上次结果不变。
    fn recompute(&mut self, tally: &SimResultTally, watch_hrid: Hrid, simulation_time_limit: f64) {
        self.dirty = false;
        let hours = simulation_time_limit / 3_600_000_000_000.0;
        if !(hours > 0.0) {
            return;
        }
        let mut total = 0.0;
        for (hrid, price) in &self.prices {
            let item_hrid = intern_hrid(hrid);
            let count = tally.consumables_used_for(watch_hrid, item_hrid);
            total += count.max(0.0) * price.max(0.0);
        }
        let current_cost_per_hour = total / hours;
        self.cost_lower_bound =
            cost_lower_bound_of(self.completed_cost_per_hour, current_cost_per_hour, self.total_rounds);
        self.above_cutoff = cost_above_cutoff(self.cost_lower_bound, self.cutoff);
    }
}

/// JS `computeFoodOptimizerCostLowerBound`（守卫不过 / 非有限和 → None = null）。
fn cost_lower_bound_of(completed: f64, current: f64, total_rounds: f64) -> Option<f64> {
    if !completed.is_finite()
        || completed < 0.0
        || !current.is_finite()
        || current < 0.0
        || !is_safe_integer(total_rounds)
        || total_rounds < 1.0
    {
        return None;
    }
    let lower = (completed + current) / total_rounds;
    if lower.is_finite() { Some(lower) } else { None }
}

/// JS `isFoodOptimizerCostAboveCutoff`（非有限/负值输入恒 false；浮点边界留 margin）。
fn cost_above_cutoff(lower: Option<f64>, cutoff: f64) -> bool {
    let Some(lower) = lower else { return false };
    if !lower.is_finite() || lower < 0.0 || !cutoff.is_finite() || cutoff < 0.0 {
        return false;
    }
    let margin = 16.0 * f64::EPSILON * 1.0f64.max(lower).max(cutoff);
    lower - cutoff > margin
}

/// JS `Number.MAX_SAFE_INTEGER`（`observeFoodOptimizerThresholds` 的区间上界）。
const MAX_SAFE_INTEGER_F64: f64 = 9_007_199_254_740_991.0;

fn default_max_result_calls() -> usize {
    4000
}

/// 战斗模拟器（等价 JS `CombatSimulator` 的引擎相关状态）。
pub struct CombatSimulator {
    pub arena: UnitArena,
    pub players: Vec<UnitId>,
    pub enemies: Option<Vec<UnitId>>,
    pub queue: EventQueue<SimEvent>,
    pub rng: Mulberry32,
    pub tally: SimResultTally,
    pub trace: Vec<EventTraceEntry>,
    pub trace_limit: usize,
    pub event_count: u64,
    pub simulation_time: f64,
    pub simulation_time_limit: f64,
    pub all_players_dead: bool,
    pub temp_dungeon_count: f64,
    pub encounter_start_time: f64,
    pub enrage_begin_time: f64,
    next_event_id: u64,
    zone_present: bool,
    zone_is_dungeon: bool,
    labyrinth_present: bool,
    encounter_specs: Vec<Vec<UnitSpec>>,
    encounter_calls: usize,
    promotion_specs: OrderedMap<String, UnitSpec>,
    blaze_ability: Option<Ability>,
    bloom_ability: Option<Ability>,
    // 切片 5 生产模式字段
    real_result: bool,
    minimal_result: bool,
    zone: Option<crate::zone::Zone>,
    encounter_templates: Vec<TemplateSpec>,
    /// 切片 30：`encounter_templates` 的池键预计算（下标对齐：`"<hrid>|<JS 数字键>"`）。
    /// 模板表构造后不再变更，故在 `new` 里一次性算出；刷怪路径只做 `String` 克隆。
    template_pool_keys: Vec<String>,
    labyrinth_name: Option<String>,
    labyrinth_room_level: f64,
    /// 切片 16：JS `labyrinth.updateEnconterStartTime(simulationTime)`——迷宫每轮遭遇的
    /// 起始时间（120s 超时判定用；`checkTimeout` 读它）。
    labyrinth_encounter_start_time: f64,
    combat_style_skill_exp_map: Vec<(String, Vec<String>)>,
    /// JS `logCombatEvents`：切片 19 起驱动副本团灭日志（wipeEvents）。仅副本
    /// （`zone_is_dungeon`）消费它——7 个结算点写环形缓冲，团灭时快照进 simResult。
    /// 构造后条件已编码进 `wipe_logs`（Some = 启用），字段本身不再保留。
    wipe_logs: Option<WipeLogBuffer>,
    enable_hp_mp_visualization: bool,
    combat_scrolls_enabled: bool,
    /// 切片 17：战斗卷轴定义表（桥侧快照）与运行时状态。`scroll_runtime` 顺序 =
    /// 玩家序 × 配置序；`next_scroll_renewal_time` 等价 JS `nextScrollRenewalTime`。
    scroll_definitions: Vec<CombatScrollDefinition>,
    scroll_runtime: Vec<ScrollState>,
    next_scroll_renewal_time: f64,
    player_count: usize,
    // 切片 14 full-result 经验簿记（JS pendingExperienceGains / enemyDeathSnapshots /
    // experienceAwardedEnemies）；切片 26 起改为**按槽位下标**索引（下标 = UnitId），
    // 槽位释放入池时清空对应项——复用后新兵不会误读旧快照/旧颁奖状态
    //（JS 侧 WeakMap/WeakSet 的键是每次实例化的全新对象身份，槽位复用必须显式清账）。
    // `pending_experience_gains` 键恒为玩家（玩家槽位不回收），保持线性查找。
    pending_experience_gains: Vec<(UnitId, Vec<(String, f64)>)>,
    enemy_death_snapshots: Vec<Option<(UnitId, f64, Vec<(UnitId, Vec<(String, f64)>)>)>>,
    experience_awarded: Vec<bool>,
    is_guild_trial: bool,
    /// 切片 12：提前停止谓词参数（`None` = 无提前停止）。
    early_stop: Option<EarlyStopSpec>,
    /// 切片 13：观察器参数与运行时状态（`None` = 不观察；state 在匹配玩家入池时初始化，
    /// reset 重建——等价 JS 每轮模拟前新装观察器）。
    observer_spec: Option<ObserverSpec>,
    observer_state: Option<ObserverState>,
    observer_unit: Option<UnitId>,
    /// 切片 20：成本上界观察器（spec 常驻；state 在匹配玩家入池时初始化、reset 重建，
    /// 等价 JS 每轮模拟前新装观察器闭包）。
    cost_bound_spec: Option<CostBoundSpec>,
    cost_bound_state: Option<CostBoundState>,
    cost_bound_unit: Option<UnitId>,
    // ------------------------------------------------------------------
    // 切片 26：重生路径死槽复用
    // ------------------------------------------------------------------
    /// 池化槽位：`"<hrid>|<tier 键>"`（迷宫为 `"<hrid>|lab"`）→ 已死敌人的竞技场下标栈。
    /// 遭遇战结束时按死亡单位的 `respawn_pool_key` 收池；重生时同键命中则**原地重写**
    /// 该槽位（`CombatUnit::restore_for_respawn`）。玩家与探针合成单位不入池。
    pool_by_key: OrderedMap<String, Vec<UnitId>>,
    /// 复用命中 / 新建计数（测试断言池生效用；不进任何输出）。
    pool_reuse_hits: u64,
    pool_build_misses: u64,
    /// 关闭后完全退化为旧行为（不进池 / 不复用）——等价性双跑测试与问题定位用；
    /// 生产路径构造后恒为 `true`（无外部写入口）。
    respawn_reuse_enabled: bool,
    /// 切片 29：热路径暂存（容量复用；见 `SimScratch`——非语义状态，不进任何输出）。
    scratch: SimScratch,
}

/// 取「第一个存活单位」：改成收 `Option<&[UnitId]>` 切片视图，调用方无需克隆单位列表。
fn first_alive_in(arena: &UnitArena, ids: Option<&[UnitId]>) -> Option<UnitId> {
    let ids = ids?;
    ids.iter()
        .copied()
        .find(|id| arena.get(*id).combat_details.current_hitpoints > 0.0)
}

/// 切片 26：`UnitArena::release`（swap_remove）后的槽位映射——末位单位 `moved` 被换入
/// 被移除的下标 `removed`，**其余下标一律不变**（swap 语义，不做 `-1` 平移）。
fn remap_slot_after_release(id: UnitId, removed: UnitId, moved: UnitId) -> UnitId {
    if id == moved {
        removed
    } else {
        id
    }
}

/// 切片 19：JS `wipeLogs` 环形缓冲（`new Array(200)` + index/count）。
#[derive(Default)]
struct WipeLogBuffer {
    buffer: VecDeque<Value>,
    capacity: usize,
}

impl WipeLogBuffer {
    fn new() -> Self {
        Self { buffer: VecDeque::with_capacity(200), capacity: 200 }
    }

    /// JS `addToWipeLogs`：环形覆盖最老条目。
    fn push(&mut self, entry: Value) {
        if self.capacity == 0 {
            return;
        }
        if self.buffer.len() == self.capacity {
            self.buffer.pop_front();
        }
        self.buffer.push_back(entry);
    }

    /// JS `getOrderedWipeLogs`（顺序快照）+ 团灭后的 `index = 0; count = 0`（取走即清空）。
    fn take(&mut self) -> Vec<Value> {
        self.buffer.drain(..).collect()
    }
}

/// 切片 29：模拟器热路径暂存表——各热函数以 `std::mem::take → clear → 重填 → 使用 →
/// restore` 模式复用 Vec 容量，消除每次调用的小表分配/释放。**非语义状态**：
/// 使用方恒先 `clear` 再填充，绝不在重填前读取旧内容；`take` 期间发生重入时，内层
/// 拿到空表独立分配（仅放弃复用），外层的表在函数返回前原样放回。错误路径的提前
/// 返回仅丢失容量（下次调用重新分配），不影响任何输出。
#[derive(Default)]
struct SimScratch {
    /// `process_auto_attack_event` / `process_ability_damage_effect` 的存活目标表。
    alive: Vec<UnitId>,
    /// `process_ability_damage_effect` 非玩家路径的 avoid 收缩候选表。
    candidates: Vec<UnitId>,
    /// `pick_threat_target` 的威胁区间表。
    threat_ranges: Vec<(UnitId, f64, f64)>,
    /// `start_attacks` 的单位表。
    start_units: Vec<UnitId>,
}

fn consumable_slot_ref(unit: &CombatUnit, is_food: bool, slot: usize) -> Option<&Consumable> {
    let slots = if is_food { &unit.food } else { &unit.drinks };
    slots.get(slot).and_then(|item| item.as_ref())
}

fn consumable_slot_mut(unit: &mut CombatUnit, is_food: bool, slot: usize) -> Option<&mut Consumable> {
    let slots = if is_food { &mut unit.food } else { &mut unit.drinks };
    slots.get_mut(slot).and_then(|item| item.as_mut())
}

impl CombatSimulator {
    pub fn new(options: SimulatorOptions) -> Self {
        let promotion_specs: OrderedMap<String, UnitSpec> = {
            let mut map = OrderedMap::new();
            for (hrid, spec) in options.promotion_specs.iter() {
                map.set(hrid.clone(), spec.clone());
            }
            map
        };
        let zone = options.zone_monster_spawn_info.as_ref().map(|spawn_info| {
            crate::zone::Zone::new(
                options.zone_hrid.clone().unwrap_or_default(),
                options.zone_difficulty_tier,
                spawn_info.clone(),
                options.zone_dungeon_spawn_info.clone().unwrap_or(Value::Null),
                options.zone_is_dungeon,
            )
        });
        // 切片 30：模板池键预计算——产物与 `instantiate_templates` 原先的即时
        // `format!("{hrid}|{}", js_number_key(*tier))` 逐字符一致（`js_number_key` 语义未变；
        // 查表命中即 entry 的 (hrid, tier) 与模板逐位相等）。迷宫分支仍走现算键
        // （`tier_label_override`，每次遭遇一条，非热路径）。
        let template_pool_keys: Vec<String> = options
            .encounter_templates
            .iter()
            .map(|template| {
                format!(
                    "{}|{}",
                    template.hrid,
                    crate::zone::js_number_key(template.difficulty_tier)
                )
            })
            .collect();
        Self {
            arena: UnitArena::new(),
            players: Vec::new(),
            enemies: None,
            queue: EventQueue::new(),
            rng: Mulberry32::new(options.seed),
            tally: SimResultTally::new(options.max_result_calls),
            trace: Vec::new(),
            trace_limit: options.trace_limit,
            event_count: 0,
            simulation_time: 0.0,
            simulation_time_limit: options.simulation_time_limit,
            all_players_dead: false,
            temp_dungeon_count: 0.0,
            encounter_start_time: 0.0,
            enrage_begin_time: 0.0,
            next_event_id: 1,
            zone_present: options.zone_present,
            zone_is_dungeon: options.zone_is_dungeon,
            labyrinth_present: options.labyrinth_present,
            encounter_specs: options.encounter_specs,
            encounter_calls: 0,
            promotion_specs,
            blaze_ability: options.blaze_ability,
            bloom_ability: options.bloom_ability,
            real_result: options.real_result,
            minimal_result: options.minimal_result,
            zone,
            encounter_templates: options.encounter_templates,
            template_pool_keys,
            labyrinth_name: options.labyrinth_name,
            labyrinth_room_level: options.labyrinth_room_level,
            labyrinth_encounter_start_time: 0.0,
            combat_style_skill_exp_map: options.combat_style_skill_exp_map,
            wipe_logs: if options.log_combat_events && options.zone_is_dungeon && !options.minimal_result {
                Some(WipeLogBuffer::new())
            } else {
                None
            },
            enable_hp_mp_visualization: options.enable_hp_mp_visualization,
            combat_scrolls_enabled: options.combat_scrolls_enabled,
            scroll_definitions: options.combat_scroll_definitions,
            scroll_runtime: Vec::new(),
            next_scroll_renewal_time: f64::INFINITY,
            player_count: 0,
            pending_experience_gains: Vec::new(),
            enemy_death_snapshots: Vec::new(),
            experience_awarded: Vec::new(),
            is_guild_trial: options.is_guild_trial,
            early_stop: options.early_stop,
            observer_spec: options.observers,
            observer_state: None,
            observer_unit: None,
            // 切片 20：JS 安装守卫要求 `Number.isFinite(limit) && limit > 0`（成本以全额
            // 时长为除数）；不满足时不激活（等价 JS 不装观察器）。
            cost_bound_spec: match &options.cost_bound {
                Some(spec) if options.simulation_time_limit.is_finite() && options.simulation_time_limit > 0.0 => {
                    Some(spec.clone())
                }
                _ => None,
            },
            cost_bound_state: None,
            cost_bound_unit: None,
            pool_by_key: OrderedMap::new(),
            pool_reuse_hits: 0,
            pool_build_misses: 0,
            respawn_reuse_enabled: true,
            scratch: SimScratch::default(),
        }
    }

    pub fn add_player(&mut self, spec: &UnitSpec) -> Result<UnitId, UnitError> {
        let unit = build_unit_from_spec(spec)?;
        let id = self.arena.push(unit);
        self.players.push(id);
        self.player_count += 1;
        // 切片 13：观察器跟随匹配玩家初始化（JS 在轮次开始前对找到的 player 装观察器）。
        if let Some(spec_observer) = self.observer_spec.as_ref() {
            if with_hrid(spec_observer.watch_hrid, |hrid| hrid == spec.hrid) && self.observer_state.is_none() {
                self.observer_state = Some(ObserverState::new(spec_observer, &self.arena.get(id).food));
                self.observer_unit = Some(id);
            }
        }
        // 切片 20：成本观察器同样跟随匹配玩家初始化（等价 JS `simulateFoodOptimizerRound`
        // 找到 player 后装观察器；安装校验不过 → 恒不激活——unit 不写入，reset 守卫随之跳过）。
        if let Some(spec_cost) = self.cost_bound_spec.as_ref() {
            if with_hrid(spec_cost.watch_hrid, |hrid| hrid == spec.hrid) && self.cost_bound_state.is_none() {
                self.cost_bound_state = CostBoundState::try_new(spec_cost);
                if self.cost_bound_state.is_some() {
                    self.cost_bound_unit = Some(id);
                }
            }
        }
        Ok(id)
    }

    /// 生产模式支持边界（其余情形由 JS 侧回退）。
    ///
    /// 切片 14：full-result 全量覆盖（经验记账 / 掉落上下文桶 / 1000-tick 时序快照 /
    /// 激怒层数），因此 `minimalResult`、`logCombatEvents`（仅控制台输出，无数据）
    /// 与 `enableHpMpVisualization`（时序随 simResult 一次性返回）三条闸门已解除。
    ///
    /// 切片 15：副本（dungeon）波次机制纳入引擎。唯一仍留 JS 的副本组合是
    /// full-result + `logCombatEvents`：副本团灭时 JS 写 `wipeEvents`（日志内容含
    /// `new Date().toISOString()` 墙钟时间戳，天然不可复现），本引擎不生成该日志。
    /// minimal 变体把 `addWipeEvent` 覆写为空操作、也不序列化 `wipeEvents`，不受影响。
    /// 切片 16：迷宫（labyrinth）模式纳入引擎（无 zone 的单怪循环 + 120s 超时重启）。
    /// 切片 17：战斗卷轴窗口语义纳入引擎（定义表随请求传入；窗口开启/续期/关闭与记账，
    /// 迷宫/公会试炼按下文 `scrollsAllowed` 规则忽略）。
    /// 仍留 JS 的还有公会试炼与无区域。
    fn validate_production_support(&self) -> Result<(), UnitError> {
        // 迷宫模式没有 zone（JS `payload.zone` 为 null、labyrinth 非空），
        // 因此「必须有区域」放宽为「区域或迷宫至少有一个」。
        if self.zone.is_none() && !self.labyrinth_present {
            return Err(UnitError::error("wasm production path requires a zone"));
        }
        if self.encounter_templates.is_empty() {
            return Err(UnitError::error("wasm production path requires encounter templates"));
        }
        // full-result 经验记账要读 `combatStyleDetailMap[style].skillExpMap`（JS 在首次击杀时
        // 解引用，缺失/为 null 会抛 TypeError）。这里提前失败 → 调用方回退 JS，避免 wasm
        // 静默产出「0 经验」的错误结果。minimal 结果不参与经验记账，故不检查。
        if !self.minimal_result {
            for player in &self.players {
                let style_hrid = self.arena.get(*player).combat_details.combat_stats.combat_style_hrid;
                let style_in_map = with_hrid(style_hrid, |style_name| {
                    self.combat_style_skill_exp_map.iter().any(|(hrid, _)| hrid == style_name)
                });
                if !style_in_map {
                    return Err(UnitError::error(format!(
                        "wasm production path is missing the combat style skill exp map for {style_hrid}"
                    )));
                }
            }
        }
        Ok(())
    }

    fn take_event_id(&mut self) -> u64 {
        let id = self.next_event_id;
        self.next_event_id += 1;
        id
    }

    /// 注（切片 25）：返回 `Hrid` 句柄（Copy 无克隆）；句柄由构造期驻留，恒有效。
    fn unit_hrid(&self, id: UnitId) -> Hrid {
        let _prof = crate::prof::start("unit_hrid");
        self.arena.get(id).hrid
    }

    fn clear_events_for_unit(&mut self, id: UnitId) {
        let _prof = crate::prof::start("queue.clear_for_unit");
        self.queue.clear_events_for_unit(id as u64);
    }

    /// 切片 26：尽力清掉引用该槽位的队列事件（`clear_matching` 单趟 retain，**不会 panic**）。
    /// 返回是否有事件被清除——槽位入池/移除前的防御性清场（死亡点已清，此处兜底）。
    fn try_clear_events_for_unit(&mut self, id: UnitId) -> bool {
        self.queue
            .clear_matching(|event| event.source() == Some(id as u64) || event.target() == Some(id as u64))
    }

    fn record_unit_death(&mut self, unit: UnitId) {
        let hrid = self.unit_hrid(unit);
        self.tally.add_death(hrid);
        // 切片 14 full-result：JS `recordUnitDeath` 的 minimal 之后分支——只有
        // 遭遇战成员的经验快照 + 每玩家掉落上下文桶。real 分支以外（探针流水）跳过。
        if !self.real_result || self.minimal_result {
            return;
        }
        if !self.arena.get(unit).is_player {
            if self.enemies.as_ref().is_some_and(|ids| ids.contains(&unit)) {
                self.capture_enemy_death_snapshot(unit, self.simulation_time);
            }
            for player in self.players.clone() {
                self.record_monster_death_from_unit(player, unit);
            }
        }
    }

    /// JS `captureEnemyDeathSnapshot(enemy, deathTime)`（full-result）：
    /// 按 enrage 比率算总经验、按存活玩家平分并逐个 `calculateExperienceGain`；
    /// 同一敌人只快照一次（JS WeakMap 语义 → 按 UnitId 去重）。
    fn capture_enemy_death_snapshot(&mut self, enemy: UnitId, death_time: f64) {
        if self.enemy_death_snapshot_of(enemy).is_some() || self.is_experience_awarded(enemy) {
            return;
        }
        let experience_rate = self.calculate_enemy_experience_rate_at(enemy, death_time);
        let total_experience = self.arena.get(enemy).experience * experience_rate;
        let mut gains_by_player: Vec<(UnitId, Vec<(String, f64)>)> = Vec::new();
        if total_experience.is_finite() && total_experience > 0.0 {
            let experience_per_player = total_experience / js_math_max(1.0, self.players.len() as f64);
            for player in self.players.clone() {
                if let Some(gains) = self.calculate_experience_gain_for(player, experience_per_player) {
                    gains_by_player.push((player, gains));
                }
            }
        }
        self.set_enemy_death_snapshot(enemy, (enemy, death_time, gains_by_player));
    }

    /// JS `SimResult.calculateExperienceGain(unit, experience)` 的参数投影：
    /// 从结算面板与单位字段取 primaryTraining/focusTraining/combatStyle 等。
    fn calculate_experience_gain_for(&mut self, player: UnitId, experience: f64) -> Option<Vec<(String, f64)>> {
        let unit = self.arena.get(player);
        if !unit.is_player {
            return None;
        }
        let stats = &unit.combat_details.combat_stats;
        let skill_experience = vec![
            ("stamina".to_string(), stats.stamina_experience),
            ("intelligence".to_string(), stats.intelligence_experience),
            ("attack".to_string(), stats.attack_experience),
            ("melee".to_string(), stats.melee_experience),
            ("defense".to_string(), stats.defense_experience),
            ("ranged".to_string(), stats.ranged_experience),
            ("magic".to_string(), stats.magic_experience),
        ];
        let params = crate::sim_result::ExperienceGainParams {
            hrid: unit.hrid.clone(),
            experience,
            primary_training: Some(stats.primary_training.clone()),
            focus_training: Some(stats.focus_training.clone()),
            combat_style_hrid: Some(stats.combat_style_hrid.clone()),
            combat_experience: stats.combat_experience,
            skill_experience,
            debuff_on_level_gap: unit.debuff_on_level_gap,
        };
        let Some(real) = self.tally.real.as_ref() else {
            return None;
        };
        real.calculate_experience_gain(&params)
    }

    /// JS `recordMonsterDeathFromUnit(player, monster, 1)`：读玩家结算面板的
    /// 掉落三倍率 + `debuffOnLevelGap`，怪物难度档取实例自身的 `difficultyTier`。
    fn record_monster_death_from_unit(&mut self, player: UnitId, monster: UnitId) {
        let player_hrid = self.unit_hrid(player);
        let monster_hrid = self.unit_hrid(monster);
        let monster_tier = self.monster_difficulty_tier_of(monster);
        let stats = &self.arena.get(player).combat_details.combat_stats;
        let drop_rate = 1.0 + stats.combat_drop_rate;
        let rare_find = 1.0 + stats.combat_rare_find;
        let drop_quantity = stats.combat_drop_quantity;
        let debuff_on_level_gap = self.arena.get(player).debuff_on_level_gap;
        let Some(real) = self.tally.real.as_mut() else {
            return;
        };
        let _ = real.record_monster_death_from_context(
            player_hrid,
            monster_hrid,
            1.0,
            monster_tier,
            drop_rate,
            rare_find,
            drop_quantity,
            debuff_on_level_gap,
        );
    }

    /// JS `calculateEnemyExperienceRateAt(enemy, deathTime)`：enrage 比率
    /// `1 + min(aliveDuration, enrageTime) / enrageTime`；非正 enrageTime/非有限 → 1.0。
    fn calculate_enemy_experience_rate_at(&self, enemy: UnitId, death_time: f64) -> f64 {
        let enrage_time = self.arena.get(enemy).enrage_time;
        let mut alive_duration = death_time - self.enrage_begin_time;
        let mut experience_rate = f64::NAN;
        if alive_duration.is_finite() && enrage_time > 0.0 {
            alive_duration = js_math_min(alive_duration, enrage_time);
            experience_rate = 1.0 + alive_duration / enrage_time;
        }
        if !(experience_rate > 0.0 && experience_rate.is_finite()) {
            return 1.0;
        }
        experience_rate
    }

    /// 该怪物实例的有效难度档（JS `monster.difficultyTier`，掉落上下文桶用）。
    /// 刷怪 / 升变时按实例写入，因此同一 hrid 的多档共存不会串味。
    fn monster_difficulty_tier_of(&self, monster: UnitId) -> Option<f64> {
        self.arena.get(monster).difficulty_tier
    }

    /// 切片 26：槽位记账访问器（下标 = UnitId；越界 = 无条目）。槽位复用前必须
    /// 由 `clear_slot_bookkeeping` 清空，否则新兵会误命中原槽位的旧快照/旧颁奖状态。
    fn enemy_death_snapshot_of(&self, enemy: UnitId) -> Option<&(UnitId, f64, Vec<(UnitId, Vec<(String, f64)>)>)> {
        self.enemy_death_snapshots.get(enemy).and_then(|entry| entry.as_ref())
    }

    fn is_experience_awarded(&self, enemy: UnitId) -> bool {
        self.experience_awarded.get(enemy).copied().unwrap_or(false)
    }

    fn set_enemy_death_snapshot(&mut self, enemy: UnitId, snapshot: (UnitId, f64, Vec<(UnitId, Vec<(String, f64)>)>)) {
        if self.enemy_death_snapshots.len() <= enemy {
            self.enemy_death_snapshots.resize_with(enemy + 1, || None);
        }
        self.enemy_death_snapshots[enemy] = Some(snapshot);
    }

    fn set_experience_awarded(&mut self, enemy: UnitId) {
        if self.experience_awarded.len() <= enemy {
            self.experience_awarded.resize(enemy + 1, false);
        }
        self.experience_awarded[enemy] = true;
    }

    /// 槽位入池前的记账清空：清掉该下标的死亡快照与颁奖标记。
    fn clear_slot_bookkeeping(&mut self, slot: UnitId) {
        if let Some(entry) = self.enemy_death_snapshots.get_mut(slot) {
            *entry = None;
        }
        if let Some(entry) = self.experience_awarded.get_mut(slot) {
            *entry = false;
        }
    }

    /// JS `finalizeEnemyExperience(enemy)`（checkEncounterEnd 兜底）：
    /// 无快照则现快照（用当前时间），再把快照收益并入 pending。
    fn finalize_enemy_experience(&mut self, enemy: UnitId) {
        if self.is_experience_awarded(enemy) {
            return;
        }
        if self.enemy_death_snapshot_of(enemy).is_none() {
            self.capture_enemy_death_snapshot(enemy, self.simulation_time);
        }
        let Some(gains_by_player) = self
            .enemy_death_snapshot_of(enemy)
            .map(|(_, _, gains)| gains.clone())
        else {
            return;
        };
        self.append_pending_experience_gains(gains_by_player);
        self.set_experience_awarded(enemy);
    }

    /// JS `appendPendingExperienceGains(gains)`：按玩家把 `[(技能, 值)]` 累加进 pending 表。
    fn append_pending_experience_gains(&mut self, gains_by_player: Vec<(UnitId, Vec<(String, f64)>)>) {
        for (player, gains) in gains_by_player {
            if let Some(entry) = self.pending_experience_gains.iter_mut().find(|(id, _)| *id == player) {
                for (skill, value) in gains {
                    if let Some(target) = entry.1.iter_mut().find(|(name, _)| *name == skill) {
                        target.1 += value;
                    } else {
                        entry.1.push((skill, value));
                    }
                }
            } else {
                self.pending_experience_gains.push((player, gains));
            }
        }
    }

    /// JS `commitPendingExperience()`：把 pending 收益写进 simResult 的
    /// experienceGained（addExperienceGainValues 语义），随后清空。
    fn commit_pending_experience(&mut self) {
        if self.minimal_result {
            self.pending_experience_gains.clear();
            return;
        }
        let pending = std::mem::take(&mut self.pending_experience_gains);
        for (player, gains) in pending {
            let hrid = self.unit_hrid(player);
            let Some(real) = self.tally.real.as_mut() else {
                continue;
            };
            // JS `addExperienceGainValues` → `ensureExperienceGainEntry`：空增益也建零值模板。
            real.ensure_experience_gain_entry(hrid);
            // 只对已有模板键累加（calculate 产出的键恒在模板内；模板外键静默丢弃）。
            for (skill, value) in gains {
                let _ = real.add_experience_gain_value(hrid, &skill, value);
            }
        }
    }

    /// 切片 12：提前停止谓词（等价食物优化器候选轮的 JS `shouldStop`）。
    ///
    /// `playerRanOutOfMana[watch_hrid] === true || (deaths[watch_hrid] || 0) > death_limit`。
    fn early_stop_hit(&self) -> bool {
        let Some(spec) = self.early_stop.as_ref() else {
            return false;
        };
        if self.tally.mana_out_for(spec.watch_hrid) {
            return true;
        }
        match spec.death_limit {
            Some(death_limit) => self.tally.deaths_for(spec.watch_hrid) > death_limit,
            None => false,
        }
    }

    /// 切片 20：成本上界停止谓词（等价 JS `costObserver.shouldStop()`——仅在 dirty 时
    /// 重算，返回最新 `aboveCutoff`）。调用方必须把它放在 `early_stop_hit()` 之后求值
    ///（`||` 短路 = JS `hasFailed(instance) || costObserver.shouldStop()` 的失败优先序）。
    fn cost_stop_hit(&mut self) -> bool {
        let Some(spec) = self.cost_bound_spec.as_ref() else {
            return false;
        };
        let Some(state) = self.cost_bound_state.as_mut() else {
            return false;
        };
        if state.dirty {
            state.recompute(&self.tally, spec.watch_hrid, self.simulation_time_limit);
        }
        state.above_cutoff
    }

    // -----------------------------------------------------------------------
    // simulate / reset / processEvent
    // -----------------------------------------------------------------------

    pub fn simulate(&mut self) -> Result<(), UnitError> {
        if self.real_result {
            self.validate_production_support()?;
        } else {
            if self.zone_is_dungeon {
                return Err(UnitError::error("dungeon zones are not supported by the slice-4 simulator"));
            }
            if self.labyrinth_present {
                return Err(UnitError::error("labyrinth runs are not supported by the slice-4 simulator"));
            }
        }

        let limit = normalize_time_limit(self.simulation_time_limit);
        self.simulation_time_limit = limit;
        self.reset();

        let mut ticks = 0u64;
        let mut stopped_early = false;
        let combat_start = SimEvent::CombatStart { time: 0.0, id: self.take_event_id() };
        self.queue.add_event(combat_start);

        let prof_total = crate::prof::start("simulate(total)");
        loop {
            if !(self.simulation_time < limit) {
                break;
            }
            let Some(next) = self.queue.peek_next_event() else {
                self.simulation_time = limit;
                break;
            };
            if next.time() >= limit {
                self.simulation_time = limit;
                break;
            }
            let event = self.queue.get_next_event().expect("peeked event exists");
            self.process_event(event)?;

            // 切片 12：JS 在每个事件处理后调用 `shouldStop(this)`；谓词单调
            //（空蓝粘滞、死亡只增），与 JS 检查点一致地逐事件求值。
            // 切片 20：`failed || cost_stop` = JS `hasFailed(instance) ||
            // costObserver.shouldStop()` 的短路求值序（真实失败优先于成本停止）；
            // `stopped_for_cost` 仅在成本分支真的被求值时写入（等价 JS 的赋值语义）。
            let failed = self.early_stop_hit();
            let cost_stop = !failed && self.cost_stop_hit();
            if failed || cost_stop {
                if let Some(state) = self.cost_bound_state.as_mut() {
                    state.stopped_for_cost = cost_stop;
                }
                stopped_early = true;
                break;
            }

            ticks += 1;
            if ticks == 1000 {
                ticks = 0;
                // 切片 14：JS 每 1000 个事件采集一次 HP/MP 时序快照（开启可视化时）。
                // 进度派发是 UI 流式通知，wasm 侧不复制（结果一次性返回）。
                if self.enable_hp_mp_visualization {
                    let snapshot: Vec<(Hrid, f64, f64, f64, f64)> = self
                        .players
                        .iter()
                        .map(|id| {
                            let unit = self.arena.get(*id);
                            (
                                unit.hrid,
                                unit.combat_details.current_hitpoints,
                                unit.combat_details.current_manapoints,
                                unit.combat_details.max_hitpoints,
                                unit.combat_details.max_manapoints,
                            )
                        })
                        .collect();
                    self.tally.add_time_series_snapshot(self.simulation_time, &snapshot);
                }
            }
        }
        drop(prof_total);

        let prof_finalize = crate::prof::start("simulate(finalize)");
        // JS：`stoppedEarly ? this.simulationTime : normalizedSimulationTimeLimit`。
        let effective_simulation_time = if stopped_early { self.simulation_time } else { limit };
        // JS：`finalizeScrollUsage(effectiveSimulationTime)` 后紧跟
        // `discardPendingExperience()`——模拟可能停在遭遇战中途，挂起收益不得泄漏到下一轮。
        self.finalize_scroll_usage(effective_simulation_time)?;
        self.pending_experience_gains.clear();
        self.tally.simulated_time = effective_simulation_time;
        self.tally.stopped_early = stopped_early;
        // JS：`simResult.isDungeon = this.zone?.isDungeon ?? false`（切片 15 起副本可到达）。
        let zone_is_dungeon = self.zone.as_ref().map(|zone| zone.is_dungeon()).unwrap_or(false);
        if let Some(real) = self.tally.real.as_mut() {
            real.set_is_dungeon(zone_is_dungeon);
            real.set_simulated_time(effective_simulation_time);
            real.set_stopped_early(stopped_early);
        }
        if zone_is_dungeon {
            // JS：副本收尾写入 dungeonsCompleted / dungeonsFailed / maxWaveReached
            //（maxWaveReached 的逐波计数依赖 timeSpentAlive；`dungeonsCompleted >= 1` 时直接取 maxWaves）。
            let (dungeons_completed, dungeons_failed, max_waves) = {
                let zone = self.zone.as_ref().expect("dungeon zone checked above");
                (zone.dungeons_completed(), zone.dungeons_failed(), dungeon_max_waves(zone))
            };
            if let Some(real) = self.tally.real.as_mut() {
                let max_wave_reached = real.compute_max_wave_reached(dungeons_completed, max_waves);
                real.set_dungeon_summary(dungeons_completed, dungeons_failed, max_wave_reached);
            }
        }

        for player in self.players.clone() {
            let hrid = self.unit_hrid(player);
            let (drop_rate, rare_find, drop_quantity) = {
                let stats = &self.arena.get(player).combat_details.combat_stats;
                (stats.combat_drop_rate, stats.combat_rare_find, stats.combat_drop_quantity)
            };
            let mana_entries: Vec<(Hrid, f64)> = self
                .arena
                .get(player)
                .ability_mana_costs
                .iter()
                .map(|(key, value)| (*key, *value))
                .collect();
            // 切片 14：JS `setDropRateMultipliers(unit)` 读 `unit.debuffOnLevelGap`
            //（下拉难度的等级差惩罚；怪物恒 0，仅玩家有值）。
            let debuff_on_level_gap = self.arena.get(player).debuff_on_level_gap;
            self.tally.set_drop_rate_multipliers(hrid, drop_rate, rare_find, drop_quantity, debuff_on_level_gap);
            self.tally.set_mana_used(hrid, &mana_entries);
        }
        if zone_is_dungeon {
            // JS：副本收尾把 fixedSpawnsMap 的波次清单与普通 bossSpawns 追加到 simResult.bossSpawns。
            self.push_dungeon_boss_spawns();
        }
        drop(prof_finalize);

        Ok(())
    }

    fn reset(&mut self) {
        self.temp_dungeon_count = 0.0;
        self.labyrinth_encounter_start_time = 0.0;
        self.simulation_time = 0.0;
        self.queue.clear();
        // JS `reset()` 在重建 simResult 之前用**上一轮**的运行时状态按源移除卷轴 buff
        //（幂等；Replace 策略 + 显式源键与 JS 同路径不会触发策略校验错误）。
        self.clear_scroll_runtime_buffs();
        self.tally.reset_like_js();
        self.tally.real = None;
        // JS `reset()` 重建 WeakSet/WeakMap/Map：经验挂起表、死亡快照与颁奖集合一律清空。
        self.pending_experience_gains.clear();
        self.enemy_death_snapshots.clear();
        self.experience_awarded.clear();
        if self.real_result {
            // JS `reset()` 里 `this.simResult = this.createSimResult()`：每次重置都换新结果对象。
            let zone_hrid = self.zone.as_ref().map(|zone| zone.hrid.clone());
            let zone_tier = self.zone.as_ref().map(|zone| zone.difficulty_tier());
            self.tally.real = Some(Box::new(crate::sim_result::SimResultState::new(
                self.minimal_result,
                zone_hrid,
                zone_tier,
                self.labyrinth_name.clone(),
                if self.labyrinth_present { Some(self.labyrinth_room_level) } else { None },
                self.player_count,
                self.combat_style_skill_exp_map.clone(),
            )));
        }
        let scrolls_allowed = !self.labyrinth_present && !self.is_guild_trial;
        let context = if self.is_guild_trial {
            "guild_trial"
        } else if self.labyrinth_present {
            "labyrinth"
        } else {
            ""
        };
        self.tally.set_scroll_usage_context(scrolls_allowed, context);
        // JS：`setScrollUsageDisabled(!this.combatScrollsEnabled)`。
        self.tally.set_scroll_usage_disabled(!self.combat_scrolls_enabled);
        self.simulation_time_limit = normalize_time_limit(self.simulation_time_limit);
        // JS：`this.scrollRuntimeByPlayer = {}; … this.initializeScrollRuntime();`——从玩家配置
        // 重建运行时库存并注册 `scrollUsage.byPlayer` 条目（tally.real 已在上方重建）。
        self.initialize_scroll_runtime();
        // 切片 13：每轮模拟前重建观察器状态（等价 JS 每轮新装；food 列表结构在战斗中
        // 不变，只有 last_used 会动，而形态校验只看 triggers）。
        if let (Some(spec), Some(unit)) = (self.observer_spec.as_ref(), self.observer_unit) {
            self.observer_state = Some(ObserverState::new(spec, &self.arena.get(unit).food));
        }
        // 切片 20：成本观察器同样每轮重建（等价 JS 每轮新装闭包；dirty/下界回到初值）。
        // 与 observer 同守卫：仅当监视单位已入池（state 存在）时重建——单位未出场/非法
        // spec 恒不激活（输出保持 null）。
        if let (Some(spec), Some(_)) = (self.cost_bound_spec.as_ref(), self.cost_bound_unit) {
            self.cost_bound_state = CostBoundState::try_new(spec);
        }
    }

    /// 切片 13：观察器导出（`observer_state` 为私有字段；无观察器或观察单位未出场时
    /// 为 null）。**不并入 simResult**——生产 parity 对账对象必须逐字节不变，观察数据
    /// 走独立输出字段。
    pub fn observers_output(&self) -> Value {
        self.observer_state
            .as_ref()
            .map(|state| state.to_value())
            .unwrap_or(Value::Null)
    }

    /// 切片 20：成本上界观察器导出（未安装/未激活/监视单位未出场时为 null）。**不并入
    /// simResult**——与 `observers` 同一独立输出字段纪律（生产 parity 对账对象逐字节不变）。
    pub fn cost_bound_output(&self) -> Value {
        self.cost_bound_state
            .as_ref()
            .map(|state| {
                json!({
                    "stoppedForCost": state.stopped_for_cost,
                    "costLowerBound": state
                        .cost_lower_bound
                        .map(crate::sim_result::js_number_value)
                        .unwrap_or(Value::Null),
                })
            })
            .unwrap_or(Value::Null)
    }

    fn process_event(&mut self, event: SimEvent) -> Result<(), UnitError> {
        let _prof = crate::prof::start(event.kind());
        self.simulation_time = event.time();
        // JS `processEvent`：处理任何事件前先做卷轴到期守卫（O(1)，仅当到期才全量同步）。
        self.sync_scrolls_if_due(self.simulation_time)?;
        self.event_count += 1;
        if self.trace.len() < self.trace_limit {
            let entry = self.build_trace_entry(&event);
            self.trace.push(entry);
        }

        match event {
            SimEvent::CombatStart { time, .. } => self.process_combat_start_event(time)?,
            SimEvent::PlayerRespawn { hrid, .. } => self.process_player_respawn_event(hrid)?,
            SimEvent::EnemyRespawn { .. } => self.start_new_encounter()?,
            SimEvent::AutoAttack { source, .. } => self.process_auto_attack_event(source)?,
            SimEvent::ConsumableTick { source, is_food, slot, total_ticks, current_tick, .. } => {
                self.process_consumable_tick_event(source, is_food, slot, total_ticks, current_tick)?
            }
            SimEvent::DamageOverTime {
                source_ref,
                target,
                damage,
                total_ticks,
                current_tick,
                combat_style_hrid,
                ..
            } => self.process_damage_over_time_tick_event(
                source_ref,
                target,
                damage,
                total_ticks,
                current_tick,
                combat_style_hrid,
            )?,
            SimEvent::CheckBuffExpiration { source, buff_unique_hrid, .. } => {
                // 免克隆：事件本身已拥有句柄（process_event 按值收事件），直接按值传递。
                self.process_check_buff_expiration_event(source, buff_unique_hrid)?
            }
            SimEvent::ScrollRenewal { time, player_hrid, item_hrid, token, .. } => {
                self.process_scroll_renewal_event(player_hrid, item_hrid, token, time)?;
            }
            SimEvent::RegenTick { .. } => self.process_regen_tick_event()?,
            SimEvent::StunExpiration { source, .. } => {
                self.arena.get_mut(source).is_stunned = false;
                self.add_next_attack_event(source)?;
            }
            SimEvent::BlindExpiration { source, .. } => {
                self.arena.get_mut(source).is_blinded = false;
                self.add_next_attack_event(source)?;
            }
            SimEvent::SilenceExpiration { source, .. } => {
                self.arena.get_mut(source).is_silenced = false;
            }
            SimEvent::CurseExpiration { source, .. } => {
                let time = self.simulation_time;
                self.arena.get_mut(source).remove_expired_buff_by_unique_hrid(CURSE_UNIQUE_HRID, time, true)?;
            }
            SimEvent::WeakenExpiration { source, .. } => {
                let time = self.simulation_time;
                self.arena.get_mut(source).remove_expired_buff_by_unique_hrid(WEAKEN_UNIQUE_HRID, time, true)?;
            }
            SimEvent::FuryExpiration { source, .. } => {
                let time = self.simulation_time;
                self.arena.get_mut(source).remove_expired_buff_by_unique_hrid(FURY_ACCURACY_UNIQUE_HRID, time, true)?;
                self.arena.get_mut(source).remove_expired_buff_by_unique_hrid(FURY_DAMAGE_UNIQUE_HRID, time, true)?;
            }
            SimEvent::EnrageTick { encounter_time, .. } => self.process_enrage_tick_event(encounter_time)?,
            SimEvent::AbilityCastEnd { source, ability_slot, .. } => {
                self.try_use_ability(source, ability_slot)?;
            }
            SimEvent::AwaitCooldown { source, .. } => self.add_next_attack_event(source)?,
            SimEvent::CooldownReady { .. } => {
                // 仅用于检查触发器
            }
        }

        self.check_triggers()?;
        Ok(())
    }

    fn build_trace_entry(&self, event: &SimEvent) -> EventTraceEntry {
        let hrid = |id: UnitId| Some(hrid_to_string(self.arena.get(id).hrid));
        let ability_hrid = |id: UnitId, slot: usize| {
            self.arena
                .get(id)
                .abilities
                .get(slot)
                .and_then(|ability| ability.as_ref())
                .map(|ability| hrid_to_string(ability.hrid))
        };
        let consumable_hrid = |id: UnitId, is_food: bool, slot: usize| {
            consumable_slot_ref(self.arena.get(id), is_food, slot).map(|item| hrid_to_string(item.hrid))
        };
        let (time, event_type, source, target, entry_hrid, value) = match event {
            SimEvent::CombatStart { time, .. } => (*time, "combatStart", None, None, None, None),
            SimEvent::PlayerRespawn { time, hrid: player_hrid, .. } => {
                (*time, "playerRespawn", None, None, Some(hrid_to_string(*player_hrid)), None)
            }
            SimEvent::EnemyRespawn { time, .. } => (*time, "enemyRespawn", None, None, None, None),
            SimEvent::AutoAttack { time, source, .. } => (*time, "autoAttack", hrid(*source), None, None, None),
            SimEvent::AbilityCastEnd { time, source, ability_slot, .. } => {
                (*time, "abilityCastEndEvent", hrid(*source), None, ability_hrid(*source, *ability_slot), None)
            }
            SimEvent::ConsumableTick { time, source, is_food, slot, current_tick, .. } => (
                *time,
                "consumableTick",
                hrid(*source),
                None,
                consumable_hrid(*source, *is_food, *slot),
                Some(*current_tick),
            ),
            SimEvent::DamageOverTime { time, source_ref, target, current_tick, .. } => (
                *time,
                "damageOverTime",
                hrid(*source_ref),
                hrid(*target),
                None,
                Some(*current_tick),
            ),
            SimEvent::CheckBuffExpiration { time, source, buff_unique_hrid, .. } => (
                *time,
                "checkBuffExpiration",
                hrid(*source),
                None,
                buff_unique_hrid.map(hrid_to_string),
                None,
            ),
            SimEvent::ScrollRenewal { time, item_hrid, token, .. } => {
                (*time, "scrollRenewal", None, None, Some(hrid_to_string(*item_hrid)), Some(*token))
            }
            SimEvent::RegenTick { time, .. } => (*time, "regenTick", None, None, None, None),
            SimEvent::StunExpiration { time, source, .. } => {
                (*time, "stunExpiration", hrid(*source), None, None, None)
            }
            SimEvent::BlindExpiration { time, source, .. } => {
                (*time, "blindExpiration", hrid(*source), None, None, None)
            }
            SimEvent::SilenceExpiration { time, source, .. } => {
                (*time, "silenceExpiration", hrid(*source), None, None, None)
            }
            SimEvent::CurseExpiration { time, source, curse_amount, .. } => {
                (*time, "curseExpiration", hrid(*source), None, None, Some(*curse_amount))
            }
            SimEvent::WeakenExpiration { time, source, weaken_amount, .. } => {
                (*time, "weakenExpiration", hrid(*source), None, None, Some(*weaken_amount))
            }
            SimEvent::FuryExpiration { time, source, fury_amount, .. } => {
                (*time, "furyExpiration", hrid(*source), None, None, Some(*fury_amount))
            }
            SimEvent::EnrageTick { time, encounter_time, .. } => {
                (*time, "enrageTick", None, None, None, Some(*encounter_time))
            }
            SimEvent::AwaitCooldown { time, source, .. } => {
                (*time, "awaitCooldownEvent", hrid(*source), None, None, None)
            }
            SimEvent::CooldownReady { time, .. } => (*time, "cooldownReady", None, None, None, None),
        };
        EventTraceEntry { time, event_type: event_type.to_string(), source, target, hrid: entry_hrid, value }
    }

    // -----------------------------------------------------------------------
    // 切片 17：战斗卷轴窗口状态机（JS 215-438 / 745-861 / 413-438 行）
    // -----------------------------------------------------------------------

    /// JS `this.scrollsAllowed`（构造期固定：`!labyrinth && !isGuildTrial`）。
    fn scrolls_allowed(&self) -> bool {
        !self.labyrinth_present && !self.is_guild_trial
    }

    /// JS `clearScrollRuntimeBuffs()`：按 `scroll:<itemHrid>` 源移除所有卷轴运行时增益。
    fn clear_scroll_runtime_buffs(&mut self) {
        for index in 0..self.scroll_runtime.len() {
            let (player_id, buff_unique_hrid, item_hrid) = {
                let state = &self.scroll_runtime[index];
                (state.player_id, state.buff_unique_hrid, state.item_hrid)
            };
            if hrid_is_empty(buff_unique_hrid) {
                continue;
            }
            let source_key = scroll_source_key(item_hrid);
            // Replace 策略 + 显式源键：与 JS `removeBuff` 同路径不会触发策略校验错误。
            let _ = self
                .arena
                .get_mut(player_id)
                .remove_buff(Some(buff_unique_hrid), BuffSourceSelector::Explicit(Some(source_key)));
        }
    }

    /// JS `initializeScrollRuntime()`：按玩家配置重建运行时库存并注册 `scrollUsage` 条目。
    fn initialize_scroll_runtime(&mut self) {
        self.scroll_runtime = Vec::new();
        self.next_scroll_renewal_time = f64::INFINITY;

        for player_id in self.players.clone() {
            let player_hrid = self.unit_hrid(player_id);
            if hrid_is_empty(player_hrid) {
                continue;
            }
            let configs = self.arena.get(player_id).combat_scrolls.clone();
            for config in configs {
                let Some(definition_index) = self
                    .scroll_definitions
                    .iter()
                    .position(|definition| hrid_is(config.item_hrid, &definition.item_hrid))
                else {
                    // JS `getCombatScrollDefinition` 缺定义时整项跳过（不注册库存与账目）。
                    continue;
                };
                // JS：`Number.isSafeInteger(q) && q > 0 ? q : null`（无效数量折叠为无限库存）。
                let configured_quantity = match config.quantity {
                    Some(quantity) if is_safe_integer(quantity) && quantity > 0.0 => Some(quantity),
                    _ => None,
                };
                let buff_unique_hrid = self.scroll_definitions[definition_index].buff.unique_hrid.unwrap_or_default();
                self.scroll_runtime.push(ScrollState {
                    player_id,
                    player_hrid,
                    item_hrid: config.item_hrid,
                    configured_quantity,
                    remaining: configured_quantity,
                    started: false,
                    active: false,
                    active_start_time: 0.0,
                    active_until: 0.0,
                    accumulated_duration_ns: 0.0,
                    token: 0.0,
                    buff_unique_hrid,
                    definition_index,
                });
                self.tally
                    .set_scroll_configuration(player_hrid, config.item_hrid, configured_quantity);
            }
        }
    }

    /// JS `canOpenScroll(state, startTime)`。
    fn can_open_scroll(&self, index: usize, start_time: f64) -> bool {
        let state = &self.scroll_runtime[index];
        if !self.scrolls_allowed() || !self.combat_scrolls_enabled || start_time >= self.simulation_time_limit {
            return false;
        }
        match state.remaining {
            None => true,
            Some(remaining) => remaining > 0.0,
        }
    }

    /// JS `scheduleScrollRenewal(state)`：`activeUntil < simulationTimeLimit` 时更新下一次到期
    /// 时间并排入 `ScrollRenewal` 事件（token 守卫旧事件）。
    fn schedule_scroll_renewal(&mut self, index: usize) {
        let (active, active_until, player_hrid, item_hrid, token) = {
            let state = &self.scroll_runtime[index];
            (state.active, state.active_until, state.player_hrid, state.item_hrid, state.token)
        };
        if !active || active_until >= self.simulation_time_limit {
            return;
        }
        self.next_scroll_renewal_time = self.next_scroll_renewal_time.min(active_until);
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::ScrollRenewal { time: active_until, id, player_hrid, item_hrid, token });
    }

    /// JS `openScrollWindow(state, startTime, consumeInventory = true)`。
    fn open_scroll_window(&mut self, index: usize, start_time: f64, consume_inventory: bool) -> Result<bool, UnitError> {
        if !self.can_open_scroll(index, start_time) {
            return Ok(false);
        }
        let (definition_index, duration_ns) = {
            let state = &self.scroll_runtime[index];
            (state.definition_index, self.scroll_definitions[state.definition_index].duration_ns)
        };
        // JS：`Number(definition?.durationNs || definition?.duration || 0)` + 有限性校验。
        if !duration_ns.is_finite() || duration_ns <= 0.0 {
            return Ok(false);
        }
        let (player_id, item_hrid) = {
            let state = &self.scroll_runtime[index];
            (state.player_id, state.item_hrid)
        };
        // JS `createCombatScrollBuff(itemHrid)`：每次开启都从定义新建 Buff 实例（level=1）。
        let buff_input = self.scroll_definitions[definition_index].buff.clone();
        let source_key = scroll_source_key(item_hrid);
        self.arena
            .get_mut(player_id)
            .add_buff(&buff_input, start_time, Some(source_key), None)?;

        {
            let state = &mut self.scroll_runtime[index];
            state.started = true;
            state.active = true;
            state.active_start_time = start_time;
            state.active_until = start_time + duration_ns;
            state.token += 1.0;
        }

        if consume_inventory {
            let (configured_quantity, remaining) = {
                let state = &self.scroll_runtime[index];
                (state.configured_quantity, state.remaining)
            };
            if let Some(remaining) = remaining {
                self.scroll_runtime[index].remaining = Some(remaining - 1.0);
            }
            // JS：`exhausted: state.configuredQuantity !== null && state.remaining <= 0`。
            let exhausted = match (configured_quantity, self.scroll_runtime[index].remaining) {
                (Some(_), Some(remaining)) => remaining <= 0.0,
                _ => false,
            };
            let (player_hrid, item_hrid) = {
                let state = &self.scroll_runtime[index];
                (state.player_hrid, state.item_hrid)
            };
            self.tally.record_scroll_open(player_hrid, item_hrid, 1.0, 0.0, Some(exhausted));
        }

        self.schedule_scroll_renewal(index);
        Ok(true)
    }

    /// JS `closeScrollWindow(state, endTime)`：结算窗口时长、按源移除增益、清空窗口状态。
    fn close_scroll_window(&mut self, index: usize, end_time: f64) -> Result<(), UnitError> {
        if !self.scroll_runtime[index].active {
            return Ok(());
        }
        let (player_id, item_hrid, active_start_time, buff_unique_hrid, player_hrid) = {
            let state = &self.scroll_runtime[index];
            (
                state.player_id,
                state.item_hrid,
                state.active_start_time,
                state.buff_unique_hrid,
                state.player_hrid,
            )
        };
        // JS `Math.min(Math.max(Number(endTime) || 0, state.activeStartTime), this.simulationTimeLimit)`。
        let end_time = if end_time.is_nan() { 0.0 } else { end_time };
        let bounded_end = end_time.max(active_start_time).min(self.simulation_time_limit);
        let duration = (bounded_end - active_start_time).max(0.0);
        if duration > 0.0 {
            self.scroll_runtime[index].accumulated_duration_ns += duration;
            self.tally.record_scroll_window(player_hrid, item_hrid, duration);
        }
        if !hrid_is_empty(buff_unique_hrid) {
            let source_key = scroll_source_key(item_hrid);
            self.arena
                .get_mut(player_id)
                .remove_buff(Some(buff_unique_hrid), BuffSourceSelector::Explicit(Some(source_key)))?;
        }
        let state = &mut self.scroll_runtime[index];
        state.active = false;
        state.active_until = 0.0;
        state.active_start_time = 0.0;
        Ok(())
    }

    /// JS `restoreActiveScrollBuff(state, currentTime)`：活跃窗口的增益被清空（复活/重置）后
    /// 按 registry 检查重新挂接，不消耗库存。
    fn restore_active_scroll_buff(&mut self, index: usize, current_time: f64) -> Result<(), UnitError> {
        let (active, active_until, active_start_time, buff_unique_hrid, player_id) = {
            let state = &self.scroll_runtime[index];
            (
                state.active,
                state.active_until,
                state.active_start_time,
                state.buff_unique_hrid,
                state.player_id,
            )
        };
        if !active || current_time >= active_until || hrid_is_empty(buff_unique_hrid) {
            return Ok(());
        }
        let item_hrid = self.scroll_runtime[index].item_hrid;
        let source_key = scroll_source_key(item_hrid);
        let has_registered_source = self.arena.get(player_id).has_buff_source(buff_unique_hrid, source_key);
        if !has_registered_source {
            let buff_input = self.scroll_definitions[self.scroll_runtime[index].definition_index].buff.clone();
            self.arena
                .get_mut(player_id)
                .add_buff(&buff_input, active_start_time, Some(source_key), None)?;
        }
        Ok(())
    }

    /// JS `syncScrollsToTime(currentTime)`：全量对账——关闭到期窗口、补开新窗口（半开区间）、
    /// 重挂活跃增益，并重算下一次续期时间。
    fn sync_scrolls_to_time(&mut self, current_time: f64) -> Result<(), UnitError> {
        let time = if current_time.is_nan() { 0.0 } else { current_time.max(0.0) };
        self.next_scroll_renewal_time = f64::INFINITY;
        for index in 0..self.scroll_runtime.len() {
            let (started, active, active_until) = {
                let state = &self.scroll_runtime[index];
                (state.started, state.active, state.active_until)
            };
            if !started && time < self.simulation_time_limit {
                continue;
            }
            if active && time < active_until {
                self.restore_active_scroll_buff(index, time)?;
                if active_until < self.simulation_time_limit {
                    self.next_scroll_renewal_time = self.next_scroll_renewal_time.min(active_until);
                }
                continue;
            }
            while self.scroll_runtime[index].active && time >= self.scroll_runtime[index].active_until {
                let renewal_time = self.scroll_runtime[index].active_until;
                self.close_scroll_window(index, renewal_time)?;
                if !self.can_open_scroll(index, renewal_time) {
                    break;
                }
                self.open_scroll_window(index, renewal_time, true)?;
            }
        }
        Ok(())
    }

    /// JS `syncScrollsIfDue(currentTime)`：O(1) 到期守卫（每个事件处理前调用；仅在
    /// `nextScrollRenewalTime` 到期时做全量同步）。
    fn sync_scrolls_if_due(&mut self, current_time: f64) -> Result<bool, UnitError> {
        let time = if current_time.is_nan() { 0.0 } else { current_time.max(0.0) };
        if !self.next_scroll_renewal_time.is_finite() || time < self.next_scroll_renewal_time {
            return Ok(false);
        }
        self.sync_scrolls_to_time(time)?;
        Ok(true)
    }

    /// JS `activateInitialScrolls()`：首个 CombatStart（time == 0）时开启所有未开始的窗口。
    fn activate_initial_scrolls(&mut self) -> Result<(), UnitError> {
        if !self.scrolls_allowed() || !self.combat_scrolls_enabled || self.simulation_time_limit <= 0.0 {
            return Ok(());
        }
        for index in 0..self.scroll_runtime.len() {
            if !self.scroll_runtime[index].started {
                self.open_scroll_window(index, 0.0, true)?;
            }
        }
        Ok(())
    }

    /// JS `processScrollRenewalEvent(event)`：token/时间守卫后全量同步（守卫先处理时本分支
    /// 通常因 token 已变而短路）。
    fn process_scroll_renewal_event(
        &mut self,
        player_hrid: Hrid,
        item_hrid: Hrid,
        token: f64,
        time: f64,
    ) -> Result<(), UnitError> {
        let Some(index) = self
            .scroll_runtime
            .iter()
            .position(|state| state.player_hrid == player_hrid && state.item_hrid == item_hrid)
        else {
            return Ok(());
        };
        let (active, state_token, active_until) = {
            let state = &self.scroll_runtime[index];
            (state.active, state.token, state.active_until)
        };
        if !active || token != state_token || time < active_until {
            return Ok(());
        }
        self.sync_scrolls_to_time(time)
    }

    /// JS `finalizeScrollUsage(simulationTimeLimit)`：收尾关闭活跃窗口并重写 exhausted
    ///（`entry.exhausted = configuredQuantity !== null && openedCount >= configuredQuantity`）。
    fn finalize_scroll_usage(&mut self, simulation_time_limit: f64) -> Result<(), UnitError> {
        let limit = if simulation_time_limit.is_nan() {
            0.0
        } else {
            simulation_time_limit.max(0.0)
        };
        for index in 0..self.scroll_runtime.len() {
            if self.scroll_runtime[index].active {
                self.close_scroll_window(index, limit)?;
            }
            let (player_hrid, item_hrid, configured_quantity) = {
                let state = &self.scroll_runtime[index];
                (state.player_hrid, state.item_hrid, state.configured_quantity)
            };
            self.tally
                .finalize_scroll_exhausted(player_hrid, item_hrid, configured_quantity);
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 切片 19：副本团灭日志（JS wipeLogs / wipeEvents）。
    // -----------------------------------------------------------------------

    /// JS `buildCombatLog`（不带 isCrit 的条目：thorn / retaliation / damageOverTime）。
    /// source/target 传 hrid 字符串；JS `source?.hrid || 'UNKNOWN_SOURCE'` 的 fallback
    /// 等价映射为「空字符串 → `UNKNOWN_SOURCE`」（DoT 点 JS 传 `''`，其余点传单位对象，
    /// 单位 hrid 恒非空；target 恒为单位对象，无 fallback 分支）。
    fn build_wipe_log_entry(
        &self,
        source_hrid: &str,
        ability: &str,
        target: UnitId,
        damage: f64,
    ) -> Value {
        let target_unit = self.arena.get(target);
        let after_hp = target_unit.combat_details.current_hitpoints;
        let before_hp = js_math_max(0.0, after_hp + damage);
        let source_value = if source_hrid.is_empty() { "UNKNOWN_SOURCE" } else { source_hrid };
        json!({
            "time": js_number_value(self.simulation_time),
            "wave": js_number_value(self.wipe_wave()),
            "source": source_value,
            "ability": ability,
            "target": target_unit.hrid,
            "damage": js_number_value(damage),
            "beforeHp": js_number_value(before_hp),
            "afterHp": js_number_value(after_hp),
            "playersHp": self.players_hp_snapshot(),
            "isCrit": false,
        })
    }

    /// JS `generateCombatLog`（带 isCrit：普攻与技能直击）。ability 为 `'autoAttack'` 或技能 hrid。
    /// damage 取 `attackResult?.damageDone || 0`（NaN/未命中归 0）。
    fn generate_wipe_log_entry(&self, source: UnitId, ability: &str, target: UnitId, attack_result: &AttackResult) -> Value {
        let damage = if attack_result.damage_done.is_finite() { attack_result.damage_done } else { 0.0 };
        let source_hrid = self.unit_hrid(source);
        let mut entry = with_hrid(source_hrid, |source_name| {
            self.build_wipe_log_entry(source_name, ability, target, damage)
        });
        if let Some(object) = entry.as_object_mut() {
            object.insert("isCrit".to_string(), serde_json::json!(attack_result.is_crit));
        }
        entry
    }

    /// JS `this.zone.encountersKilled - 1`（副本专用；调用方保证 zone 存在）。
    fn wipe_wave(&self) -> f64 {
        match self.zone.as_ref() {
            Some(zone) => zone.encounters_killed() - 1.0,
            None => -1.0,
        }
    }

    /// JS `playersHp` 快照：`this.players.map(p => ({hrid, current, max}))`（按玩家序）。
    fn players_hp_snapshot(&self) -> Value {
        Value::Array(
            self.players
                .iter()
                .map(|id| {
                    let unit = self.arena.get(*id);
                    json!({
                        "hrid": unit.hrid,
                        "current": js_number_value(unit.combat_details.current_hitpoints),
                        "max": js_number_value(unit.combat_details.max_hitpoints),
                    })
                })
                .collect(),
        )
    }

    /// JS `saveWipeLogsToSimResult(wave)` + 团灭分支的 `index = 0; count = 0`：
    /// 取走缓冲快照进 simResult（timestamp 用确定性字符串 `t+{simulation_time}`——
    /// JS 是 `new Date().toISOString()` 墙钟时间戳，UI 仅用它做 v-for key，不显示）。
    fn save_wipe_logs_to_result(&mut self) {
        let Some(buffer) = self.wipe_logs.as_mut() else { return };
        let logs = buffer.take();
        if logs.is_empty() {
            return;
        }
        let time = self.simulation_time;
        let wave = self.wipe_wave();
        let timestamp = format!("t+{}", crate::zone::js_number_key(time));
        self.tally.add_wipe_event(Value::Array(logs), time, wave, timestamp);
    }

    // -----------------------------------------------------------------------
    // 切片 17：战斗卷轴窗口语义。
    // -----------------------------------------------------------------------

    fn initialize_combat_players(&mut self, time: f64) -> Result<(), UnitError> {
        for player in self.players.clone() {
            if time == 0.0 {
                self.arena.get_mut(player).generate_permanent_buffs();
            }
            // 切片 16：JS 迷宫分支用 `player.reset()`（缺省 `currentTime = 0` → 完全重置、
            // 清空战斗增益并复位 CD）；普通区域 / 副本沿用当前模拟时间。
            let reset_time = if self.labyrinth_present { 0.0 } else { self.simulation_time };
            self.arena.get_mut(player).reset(reset_time, &mut self.rng);
        }
        // JS：`time === 0` 走 `activateInitialScrolls()`（首个战斗开始），否则
        //（副本重启）`syncScrollsToTime(this.simulationTime)` 让窗口计时继续并重挂增益。
        if time == 0.0 {
            self.activate_initial_scrolls()?;
        } else {
            self.sync_scrolls_to_time(self.simulation_time)?;
        }
        Ok(())
    }

    fn process_combat_start_event(&mut self, time: f64) -> Result<(), UnitError> {
        self.initialize_combat_players(time)?;
        let event_time = self.simulation_time + REGEN_TICK_INTERVAL;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::RegenTick { time: event_time, id });
        self.start_new_encounter()
    }

    fn process_player_respawn_event(&mut self, hrid: Hrid) -> Result<(), UnitError> {
        let respawning_player = self.players.iter().copied().find(|id| self.arena.get(*id).hrid == hrid);
        let Some(player) = respawning_player else {
            return Err(UnitError::type_error(
                "Cannot read properties of undefined (reading 'combatDetails')",
            ));
        };

        {
            let unit = self.arena.get_mut(player);
            unit.combat_details.current_hitpoints = unit.combat_details.max_hitpoints;
            unit.combat_details.current_manapoints = unit.combat_details.max_manapoints;
            unit.clear_buffs();
        }
        // JS：`clearBuffs()` 之后、`clearCCs()` 之前 `syncScrollsToTime(this.simulationTime)`——
        // 活跃窗口的增益按 registry 检查重新挂接（不消耗库存）。
        self.sync_scrolls_to_time(self.simulation_time)?;
        self.arena.get_mut(player).clear_ccs();
        if self.all_players_dead {
            self.all_players_dead = false;
            self.start_attacks()?;
        } else {
            self.add_next_attack_event(player)?;
        }
        Ok(())
    }

    fn start_new_encounter(&mut self) -> Result<(), UnitError> {
        if self.all_players_dead {
            self.all_players_dead = false;
            // JS：`if (this.zone) this.zone.failWave();`（普通区域也会计数一次失败波次）。
            if let Some(zone) = self.zone.as_mut() {
                zone.fail_wave();
            }
        }
        self.encounter_start_time = self.simulation_time;

        if self.zone.is_some() {
            let is_dungeon = self.zone.as_ref().map(|zone| zone.is_dungeon()).unwrap_or(false);
            if is_dungeon {
                // 切片 15：副本波次（JS `getNextWave()`）。波次名用自增后的
                // `encountersKilled - 1`（固定波次先自增再返回、随机波次先选取再自增，
                // 两条路径在返回前都已自增，故与 JS 命名一致）。
                let (entries, wave_name, current_dungeon_count) = {
                    let _prof_zone = crate::prof::start("respawn.zone_encounter");
                    let zone = self.zone.as_mut().expect("zone checked above");
                    let entries = zone.get_next_wave(&mut self.rng)?;
                    let wave_name = format!("#{}", crate::zone::js_number_key(zone.encounters_killed() - 1.0));
                    (entries, wave_name, zone.dungeons_completed())
                };
                self.tally.update_time_spent_alive(&wave_name, true, self.simulation_time);
                if current_dungeon_count > self.temp_dungeon_count {
                    // JS：完成副本数刷新后全队回满（下一轮副本的起始状态）。
                    self.temp_dungeon_count = current_dungeon_count;
                    self.restore_players_to_full();
                }
                let enemies = self.instantiate_templates(&entries, None)?;
                self.enemies = Some(enemies);
            } else {
                // 生产路径：真实 Zone 生成遭遇战（每次迭代恰好一次抽样，与 JS 逐位一致）。
                let entries = {
                    let _prof_zone = crate::prof::start("respawn.zone_encounter");
                    let zone = self.zone.as_mut().expect("zone checked above");
                    zone.get_random_encounter(&mut self.rng)?
                };
                let enemies = self.instantiate_templates(&entries, None)?;
                self.enemies = Some(enemies);
            }
        } else if self.zone_present && !self.zone_is_dungeon {
            let encounter = self.get_random_encounter()?;
            self.enemies = Some(encounter);
        }

        if self.labyrinth_present {
            // 切片 16：JS `if (this.labyrinth) { this.enemies = this.labyrinth.getMonster();
            // this.labyrinth.updateEnconterStartTime(this.simulationTime); }`——每次遭遇生成
            // 一只全新怪物（模板由桥按 roomLevel 缩放后快照，difficultyTier 恒 0）。
            let hrid = self
                .labyrinth_name
                .clone()
                .expect("labyrinth mode requires labyrinthName (monster hrid)");
            let enemies = self.instantiate_templates(&[(hrid, 0.0)], Some(POOL_LABYRINTH_TIER_LABEL))?;
            self.enemies = Some(enemies);
            self.labyrinth_encounter_start_time = self.simulation_time;
        }

        // 切片 28：免克隆——按下标遍历（循环体只读 enemies，写 arena/tally）。
        let prof_reset_loop = crate::prof::start("respawn.reset_loop");
        let enemies_len = self.enemies.as_ref().map_or(0, |enemies| enemies.len());
        for index in 0..enemies_len {
            let Some(enemy) = self.enemies.as_ref().and_then(|enemies| enemies.get(index)).copied() else {
                break;
            };
            let time = self.simulation_time;
            let hrid = self.unit_hrid(enemy);
            self.arena.get_mut(enemy).reset(time, &mut self.rng);
            with_hrid(hrid, |name| self.tally.update_time_spent_alive(name, true, time));
        }
        drop(prof_reset_loop);

        let prof_enrage = crate::prof::start("respawn.enrage_block");
        // 切片 30：原先连续两次 `clearEventsOfType`（ENRAGE_TICK、ABILITY_CAST_END）各做一趟
        // 全队列 retain，合并为单趟；清除集合与保留元素相对序不变（EnrageTick 仍在清场之后
        // 入队，其类型只可能被第一次清场匹配，而清场先于入队，故与逐次清场等价）。
        self.queue
            .clear_events_of_types(&[Hrid::EVENT_ENRAGE_TICK, Hrid::EVENT_ABILITY_CAST_END]);
        let enrage_time = self.simulation_time + ENRAGE_TICK_INTERVAL;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::EnrageTick {
            time: enrage_time,
            id,
            encounter_time: ENRAGE_TICK_INTERVAL,
        });
        self.enrage_begin_time = self.simulation_time;
        drop(prof_enrage);

        // 提前检查 trigger 让吃喝先跑。
        self.check_triggers()?;

        self.start_attacks()
    }

    /// JS `startNewEncounter`：副本完成数刷新时把全队 HP/MP 回满（不消耗随机数、不触发行程）。
    fn restore_players_to_full(&mut self) {
        for player in self.players.clone() {
            let unit = self.arena.get_mut(player);
            unit.combat_details.current_hitpoints = unit.combat_details.max_hitpoints;
            unit.combat_details.current_manapoints = unit.combat_details.max_manapoints;
        }
    }

    /// 切片 15（收尾）：副本时把 `dungeonSpawnInfo.fixedSpawnsMap` 的每个波次拼成
    /// `#<wave>,<monster1>,<monster2>,...` 追加到 `bossSpawns`，随后追加
    /// `monsterSpawnInfo.bossSpawns` 的 `combatMonsterHrid`。
    ///
    /// `Object.entries` 对整数键按数值升序枚举，这里显式排序（serde_json 的 Map 迭代序
    /// 不可依赖）；JS 字符串拼接里 `undefined` 字面量为 `"undefined"`。
    fn push_dungeon_boss_spawns(&mut self) {
        let mut labels: Vec<String> = Vec::new();
        {
            let Some(zone) = self.zone.as_ref() else {
                return;
            };
            if let Some(fixed_spawns_map) = zone
                .dungeon_spawn_info()
                .get("fixedSpawnsMap")
                .and_then(|value| value.as_object())
            {
                let mut keys: Vec<&String> = fixed_spawns_map.keys().collect();
                keys.sort_by(|first, second| {
                    first
                        .as_str()
                        .parse::<f64>()
                        .unwrap_or(f64::NAN)
                        .partial_cmp(&second.as_str().parse::<f64>().unwrap_or(f64::NAN))
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                for key in keys {
                    let Some(monsters) = fixed_spawns_map.get(key.as_str()).and_then(|value| value.as_array()) else {
                        continue;
                    };
                    let mut label = format!("#{key}");
                    for monster in monsters {
                        label.push(',');
                        label.push_str(
                            monster
                                .get("combatMonsterHrid")
                                .and_then(|value| value.as_str())
                                .unwrap_or("undefined"),
                        );
                    }
                    labels.push(label);
                }
            }
            // JS：`if (... && this.zone.monsterSpawnInfo.bossSpawns)`（空数组为真但循环零次）。
            if let Some(boss_spawns) = zone
                .monster_spawn_info()
                .get("bossSpawns")
                .and_then(|value| value.as_array())
            {
                for boss in boss_spawns {
                    labels.push(
                        boss.get("combatMonsterHrid")
                            .and_then(|value| value.as_str())
                            .unwrap_or("undefined")
                            .to_string(),
                    );
                }
            }
        }
        for label in labels {
            self.tally.push_boss_spawn(label);
        }
    }

    fn get_random_encounter(&mut self) -> Result<Vec<UnitId>, UnitError> {
        if self.encounter_specs.is_empty() {
            return Ok(Vec::new());
        }
        let index = self.encounter_calls.min(self.encounter_specs.len() - 1);
        self.encounter_calls += 1;
        let specs = self.encounter_specs[index].clone();
        let mut ids = Vec::with_capacity(specs.len());
        for spec in &specs {
            let unit = build_unit_from_spec(spec)?;
            ids.push(self.arena.push(unit));
        }
        Ok(ids)
    }

    /// 生产路径：按 `(hrid, difficultyTier)` 查模板并实例化单位（等价 JS 每次 `new Monster(...)`）。
    ///
    /// 切片 26：优先复用重生池中**同键**的死槽位（原地重建，见 `restore_for_respawn`）；
    /// 池中无同键槽位（或复用被禁用、形态不符被丢弃）时才新建。
    /// `tier_label_override`：迷宫传 `Some(POOL_LABYRINTH_TIER_LABEL)`（键与普通区域隔离）。
    fn instantiate_templates(
        &mut self,
        entries: &[(String, f64)],
        tier_label_override: Option<&str>,
    ) -> Result<Vec<UnitId>, UnitError> {
        let _prof = crate::prof::start("encounter.instantiate");
        let mut ids = Vec::with_capacity(entries.len());
        for (hrid, tier) in entries {
            let prof_lookup = crate::prof::start("instantiate.lookup");
            let index = self
                .encounter_templates
                .iter()
                .position(|template| template.hrid == *hrid && template.difficulty_tier == *tier)
                .ok_or_else(|| {
                    UnitError::error(format!("missing encounter template for {hrid} (difficultyTier {tier})"))
                })?;
            let pool_key = match tier_label_override {
                Some(label) => format!("{hrid}|{label}"),
                // 切片 30：命中下标即 (hrid, tier) 与模板逐位相等，直接用构造期预计算的键。
                None => self.template_pool_keys[index].clone(),
            };
            drop(prof_lookup);
            ids.push(self.instantiate_one(index, *tier, pool_key)?);
        }
        Ok(ids)
    }

    /// 单个模板实例化：池中同键死槽命中且形态相符 → 原地恢复复用；否则新建（并计数）。
    fn instantiate_one(&mut self, template_index: usize, tier: f64, pool_key: String) -> Result<UnitId, UnitError> {
        if let Some(slot) = self.take_pooled_slot(&pool_key) {
            let shape_matches =
                self.arena.get(slot).is_player == self.encounter_templates[template_index].spec.is_player;
            if shape_matches {
                // 原地恢复：字段全量重写，结果与 `build_unit_from_spec` 逐字段一致
                //（等价性由 `respawn_reuse_matches_non_reuse_round_trip` 锁定）。
                self.arena
                    .get_mut(slot)
                    .restore_for_respawn(&self.encounter_templates[template_index].spec, pool_key, tier)?;
                self.pool_reuse_hits += 1;
                return Ok(slot);
            }
            // 形态不符（防御：同键模板与历史槽位通常同类，正常不可达）——丢弃槽位后新建。
            self.remove_slot_or_degrade(slot);
        }
        self.pool_build_misses += 1;
        // 免克隆：`build_unit_from_spec` 只读 spec 且返回的 unit 不借用它，原实现每次刷怪
        // 都深拷贝一份 UnitSpec（遭遇生成的主要开销之一）。
        let mut unit = build_unit_from_spec(&self.encounter_templates[template_index].spec)?;
        // 掉落上下文桶按怪物实例的难度档记账（JS `new Monster(hrid, finalTier)`）。
        unit.difficulty_tier = Some(tier);
        unit.respawn_pool_key = Some(pool_key);
        Ok(self.arena.push(unit))
    }

    /// 从池中弹出一个同键槽位（桶空后删键，保持池表紧凑；复用被禁用时恒 `None`）。
    fn take_pooled_slot(&mut self, pool_key: &str) -> Option<UnitId> {
        if !self.respawn_reuse_enabled {
            return None;
        }
        let slot = self.pool_by_key.get_mut_str(pool_key)?.pop()?;
        if self.pool_by_key.get_str(pool_key).is_some_and(|bucket| bucket.is_empty()) {
            self.pool_by_key.delete_str(pool_key);
        }
        Some(slot)
    }

    /// 切片 26：遭遇战结束丢弃敌人列表时，把「已死 + 有池键」的槽位收回重生池。
    ///
    /// 前提链（复用安全性）：槽位在死亡点已被 `clear_events_for_unit` 清场、快照/颁奖
    /// 记账已被 `finalize` / `commit` 消费；此处再清一次记账（槽位下标化后 O(1)）并
    /// 防御性清残留事件。**活怪不入池**（团灭/迷宫超时被丢弃者事件未清，复用会误伤新单位）。
    fn release_dead_enemy_slots(&mut self, enemies: &[UnitId]) {
        if !self.respawn_reuse_enabled {
            return;
        }
        for &enemy in enemies {
            let dead_and_poolable = {
                let unit = self.arena.get(enemy);
                unit.combat_details.current_hitpoints <= 0.0 && unit.respawn_pool_key.is_some()
            };
            if !dead_and_poolable {
                continue;
            }
            let pool_key = self.arena.get(enemy).respawn_pool_key.clone().expect("checked above");
            self.try_clear_events_for_unit(enemy);
            self.clear_slot_bookkeeping(enemy);
            if self.pool_by_key.get_str(&pool_key).is_none() {
                self.pool_by_key.set(pool_key.clone(), Vec::new());
            }
            self.pool_by_key.get_mut_str(&pool_key).expect("池键刚补齐").push(enemy);
        }
    }

    /// 切片 26：从竞技场移除一个槽位（池中槽位形态不符时的丢弃路径）。
    ///
    /// 返回 `false` = **降级**（槽位保留在竞技场、不再入池）：调用方照常新建单位即可，
    /// 输出不受影响——这是任一前置条件不满足时的保底，**不得 panic 中断模拟**。
    /// 前置条件：槽位非玩家、不在当前敌人列表；被换入的末位单位非玩家，且没有任何
    /// 队列事件引用它（`UnitId` 是纯下标，槽位收缩后旧下标会指向错误单位甚至越界）。
    fn remove_slot_or_degrade(&mut self, slot: UnitId) -> bool {
        let len = self.arena.len();
        if slot >= len || self.arena.get(slot).is_player {
            return false;
        }
        if self.enemies.as_ref().is_some_and(|enemies| enemies.contains(&slot)) {
            return false;
        }
        let moved = len - 1;
        if moved != slot {
            if self.arena.get(moved).is_player {
                return false;
            }
            let moved_is_referenced = self
                .queue
                .get_matching(|event| event.source() == Some(moved as u64) || event.target() == Some(moved as u64))
                .is_some();
            if moved_is_referenced {
                return false;
            }
        }
        // ① 清掉仍引用该槽位的队列事件（`clear_matching` 单趟 retain，不 panic）。
        self.try_clear_events_for_unit(slot);
        // ② 移除：末位单位换入该下标（竞技场收缩 1）。
        self.arena.release(slot);
        // ③ 重映射：所有持有 UnitId 的表把 `moved` → `slot`（其余下标不变）。
        self.remap_unit_ids_after_release(slot, moved);
        true
    }

    /// `remove_slot_or_degrade` 第 ③ 步：把竞技场内外的 `UnitId` 引用与按槽位索引的
    /// 记账表同步到 swap_remove 之后的布局（**新增 UnitId 持有者时必须同步维护本函数**）。
    fn remap_unit_ids_after_release(&mut self, removed: UnitId, moved: UnitId) {
        if removed == moved {
            return;
        }
        let map = |id: UnitId| remap_slot_after_release(id, removed, moved);
        for id in self.players.iter_mut() {
            *id = map(*id);
        }
        if let Some(enemies) = self.enemies.as_mut() {
            for id in enemies.iter_mut() {
                *id = map(*id);
            }
        }
        self.observer_unit = self.observer_unit.map(map);
        self.cost_bound_unit = self.cost_bound_unit.map(map);
        for (player, _) in self.pending_experience_gains.iter_mut() {
            *player = map(*player);
        }
        for entry in self.enemy_death_snapshots.iter_mut().filter_map(|entry| entry.as_mut()) {
            entry.0 = map(entry.0);
            for (player, _) in entry.2.iter_mut() {
                *player = map(*player);
            }
        }
        for state in self.scroll_runtime.iter_mut() {
            state.player_id = map(state.player_id);
        }
        for bucket in self.pool_by_key.values_mut() {
            for id in bucket.iter_mut() {
                *id = map(*id);
            }
        }
        // 按槽位索引的记账表随单位一起换位：被移除槽位的条目随槽位销毁（入池前已清空），
        // 末位条目（属于被换入的单位）搬到 `removed`，原末位下标复位。
        if self.enemy_death_snapshots.len() > moved {
            let moved_entry = self.enemy_death_snapshots[moved].take();
            self.enemy_death_snapshots[removed] = moved_entry;
        }
        if self.experience_awarded.len() > moved {
            let moved_awarded = self.experience_awarded[moved];
            self.experience_awarded[removed] = moved_awarded;
            self.experience_awarded[moved] = false;
        }
    }

    fn start_attacks(&mut self) -> Result<(), UnitError> {
        // 切片 29：单位表复用暂存（take → 清空 → 重填 → 末尾 restore）。
        let mut units = std::mem::take(&mut self.scratch.start_units);
        units.clear();
        units.extend_from_slice(&self.players);
        if let Some(enemies) = &self.enemies {
            units.extend(enemies.iter().copied());
        }
        for unit in units.iter().copied() {
            if self.arena.get(unit).combat_details.current_hitpoints <= 0.0 {
                continue;
            }
            self.add_next_attack_event(unit)?;
        }
        self.scratch.start_units = units;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 攻击排程与格挡
    // -----------------------------------------------------------------------

    fn add_next_attack_event(&mut self, source: UnitId) -> Result<(), UnitError> {
        let _prof = crate::prof::start("attack.schedule");
        let already_pending = {
            let _prof_scan = crate::prof::start("attack.schedule.scan");
            self.queue.contains_event_of_types_and_source(&ATTACK_EVENT_TYPES, source as u64)
        };
        if already_pending {
            return Ok(());
        }

        let is_player = self.arena.get(source).is_player;
        // 免克隆：原先每次排程都克隆 enemies/players 两个 Vec（再派生出 friendlies/enemiesArg
        // 又是 4 次克隆）；这里改成对 players/enemies 的只读切片视图，语义等价。
        let target = if is_player {
            first_alive_in(&self.arena, self.enemies.as_deref())
        } else {
            first_alive_in(&self.arena, Some(self.players.as_slice()))
        };
        let has_enemies = self.enemies.is_some();

        let mut used_ability = false;
        let mut skip_next_ability = false;
        let abilities_len = self.arena.get(source).abilities.len();
        let prof_abilities = crate::prof::start("attack.schedule.ability_loop");

        for slot in 0..abilities_len {
            if used_ability || skip_next_ability {
                break;
            }
            // 免克隆：只取后续真正需要的字段（should / manaCost / castDuration），
            // 原实现会为每次「可施放」判定深拷贝一份 Ability。
            let (should, mana_cost, cast_duration) = {
                let unit = self.arena.get(source);
                let Some(ability) = unit.abilities.get(slot).and_then(|slot_ability| slot_ability.as_ref()) else {
                    continue;
                };
                let should = ability.should_trigger(
                    &self.arena,
                    source,
                    target,
                    if is_player { self.players.as_slice() } else { self.enemies.as_deref().unwrap_or(&[]) },
                    if is_player { self.enemies.as_deref() } else { Some(self.players.as_slice()) },
                    self.simulation_time,
                )?;
                (should, ability.mana_cost, ability.cast_duration)
            };
            if !should {
                continue;
            }

            if !self.can_use_ability(source, mana_cost, true) {
                skip_next_ability = true;
            }

            if !skip_next_ability {
                let cast_speed = self.arena.get(source).combat_details.combat_stats.cast_speed;
                let cast_duration = cast_duration / (1.0 + cast_speed);
                let time = self.simulation_time + cast_duration;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::AbilityCastEnd { time, id, source, ability_slot: slot });
                used_ability = true;
            }
        }
        drop(prof_abilities);

        if used_ability {
            self.arena.get_mut(source).is_out_of_mana = false;
            return Ok(());
        }

        if !has_enemies {
            return Ok(());
        }

        if !self.arena.get(source).is_blinded {
            let attack_interval = self.arena.get(source).combat_details.combat_stats.attack_interval;
            let time = self.simulation_time + attack_interval;
            let id = self.take_event_id();
            self.queue.add_event(SimEvent::AutoAttack { time, id, source });
        } else {
            self.arena.get_mut(source).is_out_of_mana = true;
        }
        Ok(())
    }

    fn check_parry(&mut self, targets: &[UnitId]) -> Option<UnitId> {
        let parry_units: Vec<UnitId> = targets
            .iter()
            .copied()
            .filter(|id| {
                let unit = self.arena.get(*id);
                unit.combat_details.current_hitpoints > 0.0 && unit.combat_details.combat_stats.parry > 0.0
            })
            .collect();
        if parry_units.is_empty() {
            return None;
        }
        let random_index = (self.rng.next_f64() * parry_units.len() as f64).floor() as usize;
        let candidate = parry_units[random_index.min(parry_units.len() - 1)];
        let parry = self.arena.get(candidate).combat_details.combat_stats.parry;
        if parry > self.rng.next_f64() {
            Some(candidate)
        } else {
            None
        }
    }

    fn pick_threat_target(&mut self, alive_targets: &[UnitId]) -> Result<UnitId, UnitError> {
        let mut cumulative_threat = 0.0;
        // 切片 29：区间表复用暂存（take → 清空 → 重填 → restore）。
        let mut ranges = std::mem::take(&mut self.scratch.threat_ranges);
        ranges.clear();
        ranges.reserve(alive_targets.len());
        for id in alive_targets {
            let player_threat = self.arena.get(*id).combat_details.combat_stats.threat;
            cumulative_threat += player_threat;
            ranges.push((*id, cumulative_threat - player_threat, cumulative_threat));
        }
        let random_value_hit = self.rng.next_f64() * cumulative_threat;
        let found = ranges
            .iter()
            .find(|(_, range_start, range_end)| random_value_hit >= *range_start && random_value_hit < *range_end)
            .map(|(id, _, _)| *id);
        self.scratch.threat_ranges = ranges;
        found.ok_or_else(|| UnitError::type_error("Cannot read properties of undefined (reading 'player')"))
    }

    // -----------------------------------------------------------------------
    // 普攻事件
    // -----------------------------------------------------------------------

    fn process_auto_attack_event(&mut self, event_source: UnitId) -> Result<(), UnitError> {
        let is_player = self.arena.get(event_source).is_player;
        // 切片 28：免克隆——原先克隆整个对侧列表再过滤出存活表（每次调用两次分配），
        // 现在按下标直读源列表一次成形。`check_parry` 的候选过滤（存活 ∧ parry>0）对
        // 「全集」与「存活子集」结果恒等（已死者不可能成为候选），故直接传存活表。
        // 切片 29：存活表改为复用模拟器暂存（take → 清空 → 重填；循环后 restore），
        // 消除每次调用的分配/释放；提前返回仅丢失容量、不影响输出。
        let mut alive_targets = std::mem::take(&mut self.scratch.alive);
        alive_targets.clear();
        if is_player {
            let Some(enemies) = self.enemies.as_deref() else {
                self.scratch.alive = alive_targets;
                return Ok(());
            };
            alive_targets.extend(
                enemies
                    .iter()
                    .copied()
                    .filter(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0),
            );
        } else {
            alive_targets.extend(
                self.players
                    .iter()
                    .copied()
                    .filter(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0),
            );
        }

        for index in 0..alive_targets.len() {
            let mut target = alive_targets[index];
            if !is_player && alive_targets.len() > 1 {
                target = self.pick_threat_target(&alive_targets)?;
            }

            let mut current_source = event_source;
            let parry_target = self.check_parry(&alive_targets);
            if let Some(parry) = parry_target {
                target = current_source;
                current_source = parry;
            }

            let attack_result = {
                let (source_unit, target_unit) = self.arena.two_mut(current_source, target);
                process_attack(source_unit, target_unit, None, &mut self.rng)
            };

            // 切片 19：JS :1017-1027——副本日志（普攻直击玩家且造成伤害）。
            if self.wipe_logs.is_some()
                && self.arena.get(target).is_player
                && attack_result.did_hit
                && attack_result.damage_done > 0.0
            {
                let entry = self.generate_wipe_log_entry(current_source, "autoAttack", target, &attack_result);
                self.wipe_logs.as_mut().expect("checked").push(entry);
            }

            let mayhem_power = self.arena.get(current_source).combat_details.combat_stats.mayhem;
            let mayhem = mayhem_power > self.rng.next_f64();

            let curse_power = self.arena.get(current_source).combat_details.combat_stats.curse;
            if attack_result.did_hit && curse_power > 0.0 {
                self.apply_curse_expiration(current_source, target)?;
            }

            let fury_power = self.arena.get(current_source).combat_details.combat_stats.fury;
            if fury_power > 0.0 {
                self.apply_fury(current_source, attack_result.did_hit)?;
            }

            let weaken_power = self.arena.get(target).combat_details.combat_stats.weaken;
            if weaken_power > 0.0 {
                self.apply_weaken(current_source, target, false)?;
            }

            let source_hrid = self.unit_hrid(current_source);
            let target_hrid = self.unit_hrid(target);

            if !mayhem || attack_result.did_hit || index == alive_targets.len() - 1 {
                let outcome = if attack_result.did_hit {
                    AttackOutcome::Damage(attack_result.damage_done)
                } else {
                    AttackOutcome::Miss
                };
                // JS 侧的普攻能力键是字面量 `'autoAttack'`（与事件 type 同一字符串，句柄一致）。
                self.tally.add_attack(source_hrid, target_hrid, Hrid::EVENT_AUTO_ATTACK, outcome);
            }

            if attack_result.life_steal_heal > 0.0 {
                self.tally
                    .add_hitpoints_gained(source_hrid, intern_hrid("lifesteal"), attack_result.life_steal_heal);
            }
            if attack_result.mana_leech_mana > 0.0 {
                self.tally
                    .add_manapoints_gained(source_hrid, intern_hrid("manaLeech"), attack_result.mana_leech_mana);
            }
            if attack_result.thorn_damage_done > 0.0 {
                self.tally.add_attack(
                    target_hrid,
                    source_hrid,
                    intern_hrid(&attack_result.thorn_type),
                    AttackOutcome::Damage(attack_result.thorn_damage_done),
                );
            }
            // 切片 19：JS :1146-1149——反伤日志（thorn 打到玩家）。
            if self.wipe_logs.is_some() && attack_result.thorn_damage_done > 0.0 && self.arena.get(current_source).is_player {
                let entry = with_hrid(target_hrid, |target_name| {
                    self.build_wipe_log_entry(
                        target_name,
                        &attack_result.thorn_type,
                        current_source,
                        attack_result.thorn_damage_done,
                    )
                });
                self.wipe_logs.as_mut().expect("checked").push(entry);
            }
            if self.arena.get(target).combat_details.combat_stats.retaliation > 0.0 {
                let outcome = if attack_result.retaliation_damage_done > 0.0 {
                    AttackOutcome::Damage(attack_result.retaliation_damage_done)
                } else {
                    AttackOutcome::Miss
                };
                self.tally
                    .add_attack(target_hrid, source_hrid, intern_hrid("retaliation"), outcome);
            }
            // 切片 19：JS :1159-1162——反击日志（retaliation 打到玩家）。
            if self.wipe_logs.is_some()
                && attack_result.retaliation_damage_done > 0.0
                && self.arena.get(current_source).is_player
            {
                let entry = with_hrid(target_hrid, |target_name| {
                    self.build_wipe_log_entry(
                        target_name,
                        "retaliation",
                        current_source,
                        attack_result.retaliation_damage_done,
                    )
                });
                self.wipe_logs.as_mut().expect("checked").push(entry);
            }

            if self.arena.get(target).combat_details.current_hitpoints == 0.0 {
                self.clear_events_for_unit(target);
                self.record_unit_death(target);
                if !self.arena.get(target).is_player {
                    let time = self.simulation_time;
                    with_hrid(target_hrid, |name| self.tally.update_time_spent_alive(name, false, time));
                }
            }

            // 可能死于反伤伤害。
            if self.arena.get(current_source).combat_details.current_hitpoints == 0.0
                && (attack_result.thorn_damage_done != 0.0 || attack_result.retaliation_damage_done != 0.0)
            {
                self.clear_events_for_unit(current_source);
                self.record_unit_death(current_source);
                if !self.arena.get(current_source).is_player {
                    let time = self.simulation_time;
                    with_hrid(source_hrid, |name| self.tally.update_time_spent_alive(name, false, time));
                }
                break;
            }

            if mayhem && !attack_result.did_hit {
                continue;
            }

            if !attack_result.did_hit || parry_target.is_some() {
                break;
            }
            let pierce = self.arena.get(current_source).combat_details.combat_stats.pierce;
            if pierce <= self.rng.next_f64() {
                break;
            }
        }

        self.scratch.alive = alive_targets;

        if !self.check_encounter_end()? {
            self.add_next_attack_event(event_source)?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 诅咒 / 狂暴 / 虚弱
    // -----------------------------------------------------------------------

    fn apply_curse_expiration(&mut self, source: UnitId, target: UnitId) -> Result<(), UnitError> {
        let curse_power = self.arena.get(source).combat_details.combat_stats.curse;
        let current_amount = self
            .queue
            .get_matching(|event| {
                event.event_type() == Hrid::EVENT_CURSE_EXPIRATION && event.source() == Some(target as u64)
            })
            .and_then(|event| event.curse_amount())
            .unwrap_or(0.0);
        self.queue.clear_matching(|event| {
            event.event_type() == Hrid::EVENT_CURSE_EXPIRATION && event.source() == Some(target as u64)
        });

        let time = self.simulation_time;
        let id = self.take_event_id();
        let event = SimEvent::curse_expiration(time + CURSE_EXPIRE_TIME, id, current_amount, target);
        let curse_amount = event.curse_amount().unwrap_or(0.0);

        let curse_buff = RawBuffInput {
            unique_hrid: Some(CURSE_UNIQUE_HRID),
            type_hrid: Some(Hrid::BUFF_TYPE_DAMAGE_TAKEN),
            ratio_boost: Some(0.0),
            flat_boost: Some(curse_power * curse_amount),
            duration: Some(CURSE_EXPIRE_TIME),
            ..Default::default()
        };
        self.arena.get_mut(target).add_buff(&curse_buff, time, None, None)?;
        self.queue.add_event(event);
        Ok(())
    }

    fn apply_fury(&mut self, source: UnitId, did_hit: bool) -> Result<(), UnitError> {
        let fury_power = self.arena.get(source).combat_details.combat_stats.fury;
        let current_amount = self
            .queue
            .get_matching(|event| event.event_type() == Hrid::EVENT_FURY_EXPIRATION && event.source() == Some(source as u64))
            .and_then(|event| event.fury_amount())
            .unwrap_or(0.0);
        self.queue.clear_matching(|event| {
            event.event_type() == Hrid::EVENT_FURY_EXPIRATION && event.source() == Some(source as u64)
        });

        let mut fury_amount = current_amount;
        if did_hit {
            fury_amount = js_math_min(fury_amount + 1.0, MAX_FURY_STACK);
        } else {
            fury_amount = fury_amount / 2.0;
        }

        let accuracy_buff = RawBuffInput {
            unique_hrid: Some(FURY_ACCURACY_UNIQUE_HRID),
            type_hrid: Some(Hrid::BUFF_TYPE_FURY_ACCURACY),
            ratio_boost: Some(fury_amount * fury_power),
            flat_boost: Some(0.0),
            duration: Some(FURY_EXPIRE_TIME),
            ..Default::default()
        };
        let damage_buff = RawBuffInput {
            unique_hrid: Some(FURY_DAMAGE_UNIQUE_HRID),
            type_hrid: Some(Hrid::BUFF_TYPE_FURY_DAMAGE),
            ratio_boost: Some(fury_amount * fury_power),
            flat_boost: Some(0.0),
            duration: Some(FURY_EXPIRE_TIME),
            ..Default::default()
        };

        let time = self.simulation_time;
        if fury_amount > 0.0 {
            let id = self.take_event_id();
            self.queue.add_event(SimEvent::FuryExpiration { time: time + FURY_EXPIRE_TIME, id, source, fury_amount });
            self.arena.get_mut(source).add_buff(&accuracy_buff, time, None, None)?;
            self.arena.get_mut(source).add_buff(&damage_buff, time, None, None)?;
        } else {
            self.arena
                .get_mut(source)
                .remove_buff_by_unique_hrid(FURY_ACCURACY_UNIQUE_HRID, BuffSourceSelector::Explicit(None))?;
            self.arena
                .get_mut(source)
                .remove_buff_by_unique_hrid(FURY_DAMAGE_UNIQUE_HRID, BuffSourceSelector::Explicit(None))?;
        }
        Ok(())
    }

    fn apply_weaken(&mut self, source: UnitId, target: UnitId, write_expire_time: bool) -> Result<(), UnitError> {
        let weaken_power = self.arena.get(target).combat_details.combat_stats.weaken;
        let time = self.simulation_time;
        if write_expire_time {
            self.arena.get_mut(source).weaken_expire_time = Some(time + WEAKEN_EXPIRE_TIME);
        }

        let current_amount = self
            .queue
            .get_matching(|event| {
                event.event_type() == Hrid::EVENT_WEAKEN_EXPIRATION && event.source() == Some(source as u64)
            })
            .and_then(|event| event.weaken_amount())
            .unwrap_or(0.0);
        self.queue.clear_matching(|event| {
            event.event_type() == Hrid::EVENT_WEAKEN_EXPIRATION && event.source() == Some(source as u64)
        });

        let id = self.take_event_id();
        let event = SimEvent::weaken_expiration(time + WEAKEN_EXPIRE_TIME, id, current_amount, source);
        let weaken_amount = event.weaken_amount().unwrap_or(0.0);

        let weaken_buff = RawBuffInput {
            unique_hrid: Some(WEAKEN_UNIQUE_HRID),
            type_hrid: Some(Hrid::BUFF_TYPE_DAMAGE),
            ratio_boost: Some(-1.0 * weaken_power * weaken_amount),
            flat_boost: Some(0.0),
            duration: Some(WEAKEN_EXPIRE_TIME),
            ..Default::default()
        };
        self.arena.get_mut(source).add_buff(&weaken_buff, time, None, None)?;
        self.queue.add_event(event);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 遭遇战结束
    // -----------------------------------------------------------------------

    fn check_encounter_end(&mut self) -> Result<bool, UnitError> {
        let _prof = crate::prof::start("encounter.check_end");
        // 切片 27：enemies 的两次 `clone()` 与 players 的一次 `clone()` 改为 take/restore
        // 与下标遍历——本函数每轮约 3700 次调用，克隆开销在 prof 中显著。语义不变：
        // 非清场路径把 enemies 原样放回；清场路径维持 None。
        let mut encounter_ended = false;
        let mut encounter_cleared = false;

        if let Some(enemies) = self.enemies.take() {
            // 切片 14：JS 先给「已死但未颁奖」的敌人补发经验（正常事件路径已记录精确时间戳，
            // 只有直接改血量的调用才走这里的兜底现快照）。minimal 结果不参与经验记账。
            if !self.minimal_result {
                for enemy in &enemies {
                    if self.arena.get(*enemy).combat_details.current_hitpoints <= 0.0
                        && !self.is_experience_awarded(*enemy)
                    {
                        self.finalize_enemy_experience(*enemy);
                    }
                }
            }

            let all_dead = !enemies
                .iter()
                .any(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0);
            if all_dead {
                self.queue.clear_events_of_type(Hrid::EVENT_AUTO_ATTACK);
                let time = self.simulation_time + ENEMY_RESPAWN_INTERVAL;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::EnemyRespawn { time, id });

                // 切片 14：只有在遭遇战中所有怪物都已死亡后才提交击杀快照
                // （JS `commitPendingExperience()`；之后的副本团灭不得保留它们）。
                self.commit_pending_experience();
                // 切片 26：清场后把已死敌人的槽位收回重生池（本遭遇战不再引用它们）。
                self.release_dead_enemy_slots(&enemies);
                self.enemies = None;
                // 切片 15：副本清波按波次名结算存活时间；整个副本打完
                //（`encountersKilled > maxWaves`）时记一次副本耗时。
                if self.zone_present && self.zone_is_dungeon {
                    let (wave_name, dungeon_finished) = {
                        let zone = self.zone.as_ref().expect("dungeon zone must exist");
                        let encounters_killed = zone.encounters_killed();
                        (
                            format!("#{}", crate::zone::js_number_key(encounters_killed - 1.0)),
                            encounters_killed > dungeon_max_waves(zone),
                        )
                    };
                    let time = self.simulation_time;
                    self.tally.update_time_spent_alive(&wave_name, false, time);
                    if dungeon_finished {
                        self.tally.update_dungenon_finish("#1", time);
                        self.tally.set_last_dungeon_finish_time(time);
                    }
                }
                self.tally.add_encounter_end();
                // JS：`this.simResult.lastEncounterFinishTime = this.simulationTime;`（普通与 minimal 都写）。
                self.tally.set_last_encounter_finish_time(self.simulation_time);
                encounter_cleared = true;
                encounter_ended = true;
            } else {
                // 未清场：把 enemies 原样放回（切片 27 的 take/restore 配对）。
                self.enemies = Some(enemies);
            }
        }

        for index in 0..self.players.len() {
            let player = self.players[index];
            let hp = self.arena.get(player).combat_details.current_hitpoints;
            if hp > 0.0 {
                continue;
            }
            let hrid = self.unit_hrid(player);
            if !self.queue.contains_event_of_type_and_hrid(Hrid::EVENT_PLAYER_RESPAWN, hrid) {
                if self.zone_present && !self.zone_is_dungeon {
                    let time = self.simulation_time + PLAYER_RESPAWN_INTERVAL;
                    let id = self.take_event_id();
                    self.queue.add_event(SimEvent::PlayerRespawn { time, id, hrid });
                }
                let time = self.simulation_time;
                self.tally.add_ran_out_of_mana_count(hrid, false, time);
            }
        }

        let any_alive = self
            .players
            .iter()
            .any(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0);
        if !any_alive {
            if self.zone_present && self.zone_is_dungeon {
                // 切片 15：副本团灭（JS :1268-1315）——只清战斗相关事件（保留增益过期与
                // CD 事件），丢弃挂起经验并让 enemies 失效；RESTART_INTERVAL 后以
                // CombatStart 重开（`start_new_encounter` 的 allPlayersDead 分支随后记一次
                // failWave）。切片 19：`logCombatEvents` 为真时先快照团灭日志进 simResult
                // （JS saveWipeLogsToSimResult + 缓冲清零；console 输出无数据、不移植）。
                if self.wipe_logs.is_some() {
                    self.save_wipe_logs_to_result();
                }
                self.queue.clear_events_of_type(Hrid::EVENT_AUTO_ATTACK);
                self.queue.clear_events_of_type(Hrid::EVENT_ABILITY_CAST_END);
                self.queue.clear_events_of_type(Hrid::EVENT_DAMAGE_OVER_TIME);
                self.queue.clear_events_of_type(Hrid::EVENT_CONSUMABLE_TICK);
                self.queue.clear_events_of_type(Hrid::EVENT_REGEN_TICK);
                self.queue.clear_events_of_type(Hrid::EVENT_ENRAGE_TICK);
                self.queue.clear_events_of_type(Hrid::EVENT_STUN_EXPIRATION);
                self.queue.clear_events_of_type(Hrid::EVENT_BLIND_EXPIRATION);
                self.queue.clear_events_of_type(Hrid::EVENT_SILENCE_EXPIRATION);
                self.queue.clear_events_of_type(Hrid::EVENT_AWAIT_COOLDOWN);
                self.pending_experience_gains.clear();
                if let Some(enemies) = self.enemies.take() {
                    // 切片 26：只收回已死敌人的槽位（活怪事件未清、复用会误伤下波单位）。
                    self.release_dead_enemy_slots(&enemies);
                }
                self.enemies = None;
                let time = self.simulation_time + RESTART_INTERVAL;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::CombatStart { time, id });
            } else if self.zone_present && !self.zone_is_dungeon {
                self.queue.clear_events_of_type(Hrid::EVENT_AUTO_ATTACK);
                self.queue.clear_events_of_type(Hrid::EVENT_ABILITY_CAST_END);
            }
            encounter_ended = true;
            self.all_players_dead = true;
        }

        if self.labyrinth_present {
            // 切片 16：JS :1318-1330——迷宫无「清波」概念：怪物死亡（encounterEnded）或
            // 单轮遭遇超过 120s（`checkTimeout`）都立刻整队重启：清空事件队列并在**当前
            // 时间**排入 CombatStart（新怪物由 `start_new_encounter` 生成）；未清场时丢弃
            // 挂起经验。JS 的 `eventQueue.clear()` 会连带丢弃刚排入的 EnemyRespawn。
            let timed_out = self.simulation_time - self.labyrinth_encounter_start_time > 120.0 * 1e9;
            if timed_out || encounter_ended {
                if !encounter_cleared {
                    self.pending_experience_gains.clear();
                }
                self.enemies = None;
                encounter_ended = true;
                self.queue.clear();
                let time = self.simulation_time;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::CombatStart { time, id });
            }
        }

        Ok(encounter_ended)
    }

    // -----------------------------------------------------------------------
    // 消耗品 tick / DoT tick / regen tick / 增益过期
    // -----------------------------------------------------------------------

    fn process_consumable_tick_event(
        &mut self,
        source: UnitId,
        is_food: bool,
        slot: usize,
        total_ticks: f64,
        current_tick: f64,
    ) -> Result<(), UnitError> {
        let Some(consumable) = consumable_slot_ref(self.arena.get(source), is_food, slot).cloned() else {
            return Ok(());
        };
        let source_hrid = self.unit_hrid(source);

        if consumable.hitpoint_restore > 0.0 {
            let tick_value = calculate_tick_value(consumable.hitpoint_restore, total_ticks, current_tick);
            let hitpoints_added = self.arena.get_mut(source).add_hitpoints(tick_value);
            self.tally.add_hitpoints_gained(source_hrid, consumable.hrid, hitpoints_added);
        }

        if consumable.manapoint_restore > 0.0 {
            let tick_value = calculate_tick_value(consumable.manapoint_restore, total_ticks, current_tick);
            let manapoints_added = self.arena.get_mut(source).add_manapoints(tick_value);
            self.tally.add_manapoints_gained(source_hrid, consumable.hrid, manapoints_added);

            if self.arena.get(source).is_out_of_mana {
                let time = self.simulation_time;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::AwaitCooldown { time, id, source });
            }
        }

        if current_tick < total_ticks {
            let time = self.simulation_time + HOT_TICK_INTERVAL;
            let id = self.take_event_id();
            self.queue.add_event(SimEvent::ConsumableTick {
                time,
                id,
                source,
                is_food,
                slot,
                total_ticks,
                current_tick: current_tick + 1.0,
            });
        }
        Ok(())
    }

    fn process_damage_over_time_tick_event(
        &mut self,
        source_ref: UnitId,
        target: UnitId,
        damage: f64,
        total_ticks: f64,
        current_tick: f64,
        combat_style_hrid: Option<Hrid>,
    ) -> Result<(), UnitError> {
        let tick_damage = calculate_tick_value(damage, total_ticks, current_tick);
        let current_hitpoints = self.arena.get(target).combat_details.current_hitpoints;
        let applied = js_math_min(tick_damage, current_hitpoints);

        self.arena.get_mut(target).combat_details.current_hitpoints -= applied;
        let source_hrid = self.unit_hrid(source_ref);
        let target_hrid = self.unit_hrid(target);
        self.tally
            .add_attack(source_hrid, target_hrid, intern_hrid("damageOverTime"), AttackOutcome::Damage(applied));

        // 切片 19：JS :1453-1456——副本日志（DoT tick，无 isPlayer/伤害门控——JS 原样记录）。
        if self.wipe_logs.is_some() {
            let entry = self.build_wipe_log_entry("", "damageOverTime", target, applied);
            self.wipe_logs.as_mut().expect("checked").push(entry);
        }

        if current_tick < total_ticks {
            let time = self.simulation_time + DOT_TICK_INTERVAL;
            let id = self.take_event_id();
            self.queue.add_event(SimEvent::DamageOverTime {
                time,
                id,
                source_ref,
                target,
                damage,
                total_ticks,
                current_tick: current_tick + 1.0,
                combat_style_hrid,
            });
        }

        if self.arena.get(target).combat_details.current_hitpoints == 0.0 {
            self.clear_events_for_unit(target);
            self.record_unit_death(target);
            if !self.arena.get(target).is_player {
                let time = self.simulation_time;
                with_hrid(target_hrid, |name| self.tally.update_time_spent_alive(name, false, time));
            }
        }

        self.check_encounter_end()?;
        Ok(())
    }

    fn process_regen_tick_event(&mut self) -> Result<(), UnitError> {
        for player in self.players.clone() {
            if self.arena.get(player).combat_details.current_hitpoints <= 0.0 {
                continue;
            }
            let hrid = self.unit_hrid(player);

            let (max_hitpoints, hp_regen_per10) = {
                let details = &self.arena.get(player).combat_details;
                (details.max_hitpoints, details.combat_stats.hp_regen_per10)
            };
            let hitpoint_regen = (max_hitpoints * hp_regen_per10).floor();
            let hitpoints_added = self.arena.get_mut(player).add_hitpoints(hitpoint_regen);
            self.tally.add_hitpoints_gained(hrid, intern_hrid("regen"), hitpoints_added);

            let (max_manapoints, mp_regen_per10) = {
                let details = &self.arena.get(player).combat_details;
                (details.max_manapoints, details.combat_stats.mp_regen_per10)
            };
            let manapoint_regen = (max_manapoints * mp_regen_per10).floor();
            let manapoints_added = self.arena.get_mut(player).add_manapoints(manapoint_regen);
            self.tally.add_manapoints_gained(hrid, intern_hrid("regen"), manapoints_added);

            if self.arena.get(player).is_out_of_mana {
                let time = self.simulation_time;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::AwaitCooldown { time, id, source: player });
            }
        }

        let time = self.simulation_time + REGEN_TICK_INTERVAL;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::RegenTick { time, id });
        Ok(())
    }

    fn process_check_buff_expiration_event(
        &mut self,
        source: UnitId,
        buff_unique_hrid: Option<Hrid>,
    ) -> Result<(), UnitError> {
        let time = self.simulation_time;
        match buff_unique_hrid {
            Some(unique_hrid) => {
                self.arena
                    .get_mut(source)
                    .remove_expired_buff_by_unique_hrid(unique_hrid, time, true)?;
            }
            None => {
                self.arena.get_mut(source).remove_expired_buffs(time, true)?;
            }
        }
        Ok(())
    }

    fn schedule_buff_expiration_event(
        &mut self,
        target: UnitId,
        buff: &crate::buff::Buff,
        source_key: Hrid,
    ) -> Result<(), UnitError> {
        let _prof = crate::prof::start("buff.schedule_expiration");
        let unique_hrid = buff.unique_hrid;
        let key = source_key;
        self.queue.clear_matching(|event| {
            event.event_type() == Hrid::EVENT_CHECK_BUFF_EXPIRATION
                && event.source() == Some(target as u64)
                && event.buff_unique_hrid() == Some(unique_hrid)
                && event.buff_source_key() == Some(key)
        });
        let duration = buff.duration.unwrap_or(f64::NAN);
        let time = self.simulation_time + duration;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::CheckBuffExpiration {
            time,
            id,
            source: target,
            buff_unique_hrid: Some(unique_hrid),
            buff_source_key: Some(key),
        });
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 激怒 tick
    // -----------------------------------------------------------------------

    fn process_enrage_tick_event(&mut self, encounter_time: f64) -> Result<(), UnitError> {
        let Some(enemies) = self.enemies.clone() else {
            return Ok(());
        };

        for enemy in enemies {
            if self.arena.get(enemy).combat_details.current_hitpoints <= 0.0 {
                continue;
            }
            let enrage_time = self.arena.get(enemy).enrage_time;
            if !(enrage_time > 0.0) {
                continue;
            }
            let now_stack = js_math_min(MAX_ENRAGE_STACK, (encounter_time / enrage_time).floor());
            if now_stack <= 0.0 {
                continue;
            }
            let damage_buff = RawBuffInput {
                unique_hrid: Some(Hrid::BUFF_UNIQUE_ENRAGE_DAMAGE),
                type_hrid: Some(Hrid::BUFF_TYPE_DAMAGE),
                ratio_boost: Some(now_stack * 0.1),
                flat_boost: Some(0.0),
                duration: Some(ENRAGE_TICK_INTERVAL),
                ..Default::default()
            };
            let accuracy_buff = RawBuffInput {
                unique_hrid: Some(Hrid::BUFF_UNIQUE_ENRAGE_ACCURACY),
                type_hrid: Some(Hrid::BUFF_TYPE_ACCURACY),
                ratio_boost: Some(now_stack * 0.1),
                flat_boost: Some(0.0),
                duration: Some(ENRAGE_TICK_INTERVAL),
                ..Default::default()
            };
            let time = self.simulation_time;
            self.arena.get_mut(enemy).add_buff(&damage_buff, time, None, None)?;
            self.arena.get_mut(enemy).add_buff(&accuracy_buff, time, None, None)?;
            // 切片 14：JS `this.simResult.maxEnrageStack = Math.max(this.simResult.maxEnrageStack, nowStack)`
            //（minimal 结果同样记录该字段——FoodOptimizerSimResult 继承它）。
            if let Some(real) = self.tally.real.as_mut() {
                real.bump_max_enrage_stack(now_stack);
            }
        }

        let time = self.simulation_time + ENRAGE_TICK_INTERVAL;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::EnrageTick {
            time,
            id,
            encounter_time: encounter_time + ENRAGE_TICK_INTERVAL,
        });
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 触发器轮询
    // -----------------------------------------------------------------------

    fn check_triggers(&mut self) -> Result<(), UnitError> {
        let _prof = crate::prof::start("triggers.check");
        loop {
            let mut triggered_something = false;

            // 免克隆：原先每个循环都克隆 players / enemies（每次 checkTriggers 约 6 次 Vec 分配，
            // 5,700 次/轮量级）。改为下标遍历：checkTriggersForUnit 不增删单位列表，
            // 因此读到的顺序与内容与原快照遍历完全一致。
            let players_len = self.players.len();
            for index in 0..players_len {
                let player = self.players[index];
                if self.arena.get(player).combat_details.current_hitpoints > 0.0 {
                    if self.check_triggers_for_unit(player, true)? {
                        triggered_something = true;
                    }
                }
            }

            let enemies_len = self.enemies.as_ref().map_or(0, |enemies| enemies.len());
            for index in 0..enemies_len {
                let Some(enemy) = self.enemies.as_ref().and_then(|enemies| enemies.get(index)).copied() else {
                    break;
                };
                if self.arena.get(enemy).combat_details.current_hitpoints > 0.0 {
                    if self.check_triggers_for_unit(enemy, false)? {
                        triggered_something = true;
                    }
                }
            }

            if !triggered_something {
                break;
            }
        }
        Ok(())
    }

    /// 切片 13：闲置食物观察（等价 JS observeInactiveFoodThresholds 的 observe(unit)：
    /// 监视单位存活且未眩晕时更新 hp/mp 缺口下界）。两个调用点——check_triggers_for_unit
    /// 入口与 try_use_consumable 使用成功后，与 JS 的两处方法包装一一对应。
    fn observe_inactive_for(&mut self, unit: UnitId) {
        if self.observer_unit != Some(unit) {
            return;
        }
        let Some(observer) = self.observer_state.as_mut() else { return; };
        let unit_ref = self.arena.get(unit);
        if unit_ref.combat_details.current_hitpoints <= 0.0 || unit_ref.is_stunned {
            return;
        }
        let hp = unit_ref.combat_details.max_hitpoints - unit_ref.combat_details.current_hitpoints;
        let mp = unit_ref.combat_details.max_manapoints - unit_ref.combat_details.current_manapoints;
        observer.observe_inactive(hp, mp);
    }

    /// 切片 13：food 槽位的**过滤序**索引（等价 JS `observeFoodOptimizerThresholds`
    /// 按 `player.food.filter(Boolean)` 的下标——阈值区间按非空槽位排列，而引擎循环
    /// 按原始下标遍历）。仅当阈值观察生效（观察单位匹配且槽位非空）时返回 Some。
    fn observer_food_slot_index(&self, unit: UnitId, slot: usize) -> Option<usize> {
        if self.observer_unit != Some(unit) {
            return None;
        }
        let food = &self.arena.get(unit).food;
        if slot >= food.len() || food[slot].is_none() {
            return None;
        }
        Some(food.iter().take(slot + 1).filter(|item| item.is_some()).count() - 1)
    }

    /// 免克隆：原先每次调用都克隆 6 个 Vec（players×3 / enemies×3）来绕开借用检查；
    /// 现在只传 `is_player` 标记，友方/敌方切片视图在内部按需借用 `self.players` / `self.enemies`，
    /// 传入 `should_trigger` 的内容与顺序与原实现逐个一致。
    fn check_triggers_for_unit(&mut self, unit: UnitId, is_player: bool) -> Result<bool, UnitError> {
        if self.arena.get(unit).combat_details.current_hitpoints <= 0.0 {
            return Err(UnitError::error("Checking triggers for a dead unit"));
        }

        // 切片 13：闲置食物观察（等价 JS observeInactiveFoodThresholds 包装
        // checkTriggersForUnit：监视单位存活且未眩晕时更新缺口下界）。
        self.observe_inactive_for(unit);

        let mut triggered_something = false;
        let target = {
            let enemies_slice = if is_player { self.enemies.as_deref() } else { Some(self.players.as_slice()) };
            enemies_slice.and_then(|list| {
                list.iter()
                    .copied()
                    .find(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0)
            })
        };

        let food_len = self.arena.get(unit).food.len();
        // 切片 30：观察器只在食物优化器轮次安装（生产路径恒无）。`observer_unit` 在槽位循环
        // 内不会被改写（try_use_consumable / should_trigger 都不改它），提到循环外判定一次。
        let observer_active = self.observer_unit == Some(unit);
        for slot in 0..food_len {
            // 免克隆求值：`consumable_slot_ref` 与 `should_trigger` 都是共享借用，原实现的
            // `.cloned()` 只是绕开借用检查，却让热路径每次触发检查都深拷贝一份 Consumable。
            let slot_consumable = consumable_slot_ref(self.arena.get(unit), true, slot);
            if !observer_active {
                // 无观察器（生产路径）：probe 恒 None，与原实现 take 出 None 的分支逐位等价；
                // 免去每槽位两次 ~48B 观察状态的 take/放回搬移（切片 30）。
                let should = match slot_consumable {
                    Some(consumable) => consumable.should_trigger(
                        &self.arena,
                        unit,
                        target,
                        if is_player { self.players.as_slice() } else { self.enemies.as_deref().unwrap_or(&[]) },
                        if is_player { self.enemies.as_deref() } else { Some(self.players.as_slice()) },
                        self.simulation_time,
                        None,
                    )?,
                    None => continue,
                };
                if should && self.try_use_consumable(unit, true, slot)? {
                    triggered_something = true;
                }
                continue;
            }
            // 切片 13：开启阈值观察时把观察句柄一并传入——`should_trigger` 在快速路径真正
            // 调用 compare_value 的那一刻同步记录 (value, active)（等价 JS 包装 compareValue；
            // 门控早退则不记录，与 JS 观察点一致）。观察状态临时 take 出来构造句柄以绕开
            // 与 `&self.arena` 的借用冲突，**任何路径**（含空槽位 continue）都先放回——
            // 后续 `try_use_consumable` 需要 &mut self。
            let mut taken = self.observer_state.take();
            let probe = match self.observer_food_slot_index(unit, slot) {
                Some(slot_index) => taken.as_mut().map(|state| ThresholdObserve { state, slot_index }),
                None => None,
            };
            let should_result = match slot_consumable {
                Some(consumable) => Some(consumable.should_trigger(
                    &self.arena,
                    unit,
                    target,
                    if is_player { self.players.as_slice() } else { self.enemies.as_deref().unwrap_or(&[]) },
                    if is_player { self.enemies.as_deref() } else { Some(self.players.as_slice()) },
                    self.simulation_time,
                    probe,
                )),
                None => None,
            };
            // 放回必须先于 `?`：即便 should_trigger 出错（随后整轮中止），观察状态也不丢。
            self.observer_state = taken;
            let should = should_result.transpose()?;
            let Some(should) = should else { continue };
            if should && self.try_use_consumable(unit, true, slot)? {
                triggered_something = true;
            }
        }

        let drink_len = self.arena.get(unit).drinks.len();
        for slot in 0..drink_len {
            let should = match consumable_slot_ref(self.arena.get(unit), false, slot) {
                Some(consumable) => consumable.should_trigger(
                    &self.arena,
                    unit,
                    target,
                    if is_player { self.players.as_slice() } else { self.enemies.as_deref().unwrap_or(&[]) },
                    if is_player { self.enemies.as_deref() } else { Some(self.players.as_slice()) },
                    self.simulation_time,
                    // 切片 13：JS 观察器只包 food 槽（compareValue/闲置观察都不含 drinks）。
                    None,
                )?,
                None => continue,
            };
            if should && self.try_use_consumable(unit, false, slot)? {
                triggered_something = true;
            }
        }

        Ok(triggered_something)
    }

    fn try_use_consumable(&mut self, source: UnitId, is_food: bool, slot: usize) -> Result<bool, UnitError> {
        if self.arena.get(source).combat_details.current_hitpoints <= 0.0 {
            return Ok(false);
        }
        let Some(consumable) = consumable_slot_ref(self.arena.get(source), is_food, slot).cloned() else {
            return Ok(false);
        };

        let time = self.simulation_time;
        {
            let unit = self.arena.get_mut(source);
            if let Some(item) = consumable_slot_mut(unit, is_food, slot) {
                item.last_used = time;
            }
        }

        let is_drink = with_hrid(consumable.category_hrid, |category| category.contains("drink"));
        let (drink_concentration, food_haste) = {
            let stats = &self.arena.get(source).combat_details.combat_stats;
            (stats.drink_concentration, stats.food_haste)
        };

        let mut consume_cooldown = consumable.cooldown_duration;
        if drink_concentration > 0.0 && is_drink {
            consume_cooldown = consume_cooldown / (1.0 + drink_concentration);
        } else if food_haste > 0.0 && with_hrid(consumable.category_hrid, |category| category.contains("food")) {
            consume_cooldown = consume_cooldown / (1.0 + food_haste);
        }
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::CooldownReady { time: time + consume_cooldown, id });

        let source_hrid = self.unit_hrid(source);
        self.tally.add_consumable_use(source_hrid, consumable.hrid);

        if consumable.recovery_duration == 0.0 {
            if consumable.hitpoint_restore > 0.0 {
                let hitpoints_added = self.arena.get_mut(source).add_hitpoints(consumable.hitpoint_restore);
                self.tally.add_hitpoints_gained(source_hrid, consumable.hrid, hitpoints_added);
            }
            if consumable.manapoint_restore > 0.0 {
                let manapoints_added = self.arena.get_mut(source).add_manapoints(consumable.manapoint_restore);
                self.tally.add_manapoints_gained(source_hrid, consumable.hrid, manapoints_added);

                if self.arena.get(source).is_out_of_mana {
                    let id = self.take_event_id();
                    self.queue.add_event(SimEvent::AwaitCooldown { time, id, source });
                }
            }
        } else {
            let total_ticks = consumable.recovery_duration / HOT_TICK_INTERVAL;
            let id = self.take_event_id();
            self.queue.add_event(SimEvent::ConsumableTick {
                time: time + HOT_TICK_INTERVAL,
                id,
                source,
                is_food,
                slot,
                total_ticks,
                current_tick: 1.0,
            });
        }

        for buff in &consumable.buffs {
            let mut current_buff = buff.clone();
            if drink_concentration > 0.0 && is_drink {
                current_buff.ratio_boost *= 1.0 + drink_concentration;
                current_buff.flat_boost *= 1.0 + drink_concentration;
                current_buff.duration = Some(current_buff.duration.unwrap_or(f64::NAN) / (1.0 + drink_concentration));
            }
            let input = RawBuffInput {
                unique_hrid: Some(current_buff.unique_hrid.clone()),
                type_hrid: Some(current_buff.type_hrid.clone()),
                ratio_boost: Some(current_buff.ratio_boost),
                flat_boost: Some(current_buff.flat_boost),
                duration: current_buff.duration,
                multiplier_for_skill_hrid: Some(current_buff.multiplier_for_skill_hrid.clone()),
                multiplier_per_skill_level: Some(current_buff.multiplier_per_skill_level),
                start_time: current_buff.start_time,
            };
            self.arena.get_mut(source).add_buff(&input, time, None, None)?;
            let expire_time = time + current_buff.duration.unwrap_or(f64::NAN);
            let id = self.take_event_id();
            self.queue.add_event(SimEvent::CheckBuffExpiration {
                time: expire_time,
                id,
                source,
                buff_unique_hrid: None,
                buff_source_key: None,
            });
        }

        // 切片 13：闲置食物观察第②钩子（等价 JS observeInactiveFoodThresholds 包装
        // tryUseConsumable：使用成功后——即时恢复/buff 已生效——再观察一次缺口下界；
        // JS 包装按 `unit.food.includes(consumable)` 只观察 food 槽，drink 槽不观察）。
        if is_food {
            self.observe_inactive_for(source);
            // 切片 20：成本观察 dirty 钩子（等价 JS 包装 tryUseConsumable 的
            // `consumed && source === player && foods.has(consumable)`——成功使用监视
            // 玩家 food 槽物品才置位；失败路径/其他单位/drink 槽不影响）。
            if let Some(cost_unit) = self.cost_bound_unit {
                if source == cost_unit
                    && self
                        .cost_bound_state
                        .as_ref()
                        .is_some_and(|state| state.watches_food(consumable.hrid))
                {
                    self.cost_bound_state.as_mut().expect("checked above").dirty = true;
                }
            }
        }

        Ok(true)
    }

    // -----------------------------------------------------------------------
    // 技能使用
    // -----------------------------------------------------------------------

    fn can_use_ability(&mut self, source: UnitId, mana_cost: f64, oom_check: bool) -> bool {
        if self.arena.get(source).combat_details.current_hitpoints <= 0.0 {
            return false;
        }
        let is_player = self.arena.get(source).is_player;
        if self.arena.get(source).combat_details.current_manapoints < mana_cost {
            if is_player && oom_check {
                let hrid = self.unit_hrid(source);
                let time = self.simulation_time;
                self.tally.add_ran_out_of_mana_count(hrid, true, time);
            }
            return false;
        }
        if is_player && oom_check {
            let hrid = self.unit_hrid(source);
            let time = self.simulation_time;
            self.tally.add_ran_out_of_mana_count(hrid, false, time);
        }
        true
    }

    /// 只扣蓝 + 玩家侧蓝耗记账。`last_used` 的写入由调用方完成：取还式窗口内
    /// （见 `try_use_ability`）技能槽位为 None，冷却时间戳写在调用方的 owned 副本上，
    /// 随 restore 一并落回槽位。
    fn spend_ability_mana(&mut self, source: UnitId, ability_hrid: Hrid, mana_cost: f64) {
        let is_player = self.arena.get(source).is_player;
        if is_player {
            let unit = self.arena.get_mut(source);
            let existing = unit.ability_mana_costs.get(&ability_hrid).copied();
            match existing {
                Some(current) => unit.ability_mana_costs.set(ability_hrid, current + mana_cost),
                None => unit.ability_mana_costs.set(ability_hrid, mana_cost),
            }
        }

        self.arena.get_mut(source).combat_details.current_manapoints -= mana_cost;
    }

    fn try_use_ability(&mut self, source: UnitId, slot: usize) -> Result<bool, UnitError> {
        let _prof = crate::prof::start("ability.try_use");
        let prof_pre = crate::prof::start("try_use.pre");
        // 免深拷贝（第三批）：取还式（take → 处理 → restore）。原先每次施放都要深拷贝一份
        // `Ability`（效果数组 + 触发器 + 多个 String）；现在把槽内技能**移出**到局部 owned
        // 变量，效果循环结束后原样放回——零克隆。安全性：效果循环内的所有路径都只触
        // 「敌方列表/新单位/死者」或清队列，不会读 source 单位的技能槽（damage 效果目标
        // 恒为敌方列表，永不可能等于 source；parry 分支只 clear 队列）。
        let Some(mut ability) = self
            .arena
            .get_mut(source)
            .abilities
            .get_mut(slot)
            .and_then(|slot_ability| slot_ability.take())
        else {
            return Ok(false);
        };

        if !self.can_use_ability(source, ability.mana_cost, true) {
            self.arena.get_mut(source).abilities[slot] = Some(ability);
            return Ok(false);
        }

        let time = self.simulation_time;
        ability.last_used = time;
        self.spend_ability_mana(source, ability.hrid, ability.mana_cost);

        // 免克隆：原先 `todo_abilities: Vec<Ability>` 会把每个待施放技能再深拷贝一遍；
        // 改为「owned 主技能 + 可选 blaze/bloom owned 技能」的引用链——遍历顺序、
        // 元素身份与 RNG 消费顺序与原实现逐个一致。
        let blaze = self.arena.get(source).combat_details.combat_stats.blaze;
        let blaze_ability: Option<Ability> = if blaze > 0.0 && self.rng.next_f64() < blaze {
            match self.blaze_ability.clone() {
                Some(blaze_ability) => Some(blaze_ability),
                None => return Err(UnitError::error("scenario is missing the blaze ability definition")),
            }
        } else {
            None
        };

        let bloom = self.arena.get(source).combat_details.combat_stats.bloom;
        let bloom_ability: Option<Ability> = if bloom > 0.0 && self.rng.next_f64() < bloom {
            match self.bloom_ability.clone() {
                Some(bloom_ability) => Some(bloom_ability),
                None => return Err(UnitError::error("scenario is missing the bloom ability definition")),
            }
        } else {
            None
        };

        drop(prof_pre);

        let mut current_source = source;
        let prof_effects = crate::prof::start("try_use.effects");
        for todo_ability in std::iter::once(&ability).chain(blaze_ability.iter()).chain(bloom_ability.iter()) {
            for effect in &todo_ability.ability_effects {
                match effect.effect_type {
                    Hrid::EFFECT_BUFF => {
                        let _prof = crate::prof::start("ability.effect.buff");
                        self.process_ability_buff_effect(current_source, todo_ability, effect, true)?;
                    }
                    Hrid::EFFECT_DAMAGE => {
                        self.process_ability_damage_effect(current_source, todo_ability, effect)?;
                    }
                    Hrid::EFFECT_HEAL => {
                        let _prof = crate::prof::start("ability.effect.heal");
                        self.process_ability_heal_effect(current_source, todo_ability, effect)?;
                    }
                    Hrid::EFFECT_SPEND_HP => {
                        let _prof = crate::prof::start("ability.effect.spendHp");
                        self.process_ability_spend_hp_effect(current_source, todo_ability, effect)?;
                    }
                    Hrid::EFFECT_REVIVE => {
                        let _prof = crate::prof::start("ability.effect.revive");
                        self.process_ability_revive_effect(current_source, todo_ability, effect)?;
                    }
                    Hrid::EFFECT_PROMOTE => {
                        self.clear_events_for_unit(current_source);
                        let promoted = self.process_ability_promote_effect(current_source)?;
                        current_source = promoted;
                        self.add_next_attack_event(promoted)?;
                    }
                    other => {
                        return Err(UnitError::error(format!(
                            "Unsupported effect type for ability: {} effectType: {}",
                            todo_ability.hrid, other
                        )));
                    }
                }
            }
        }
        drop(prof_effects);

        let _prof_post = crate::prof::start("try_use.post");

        // restore：把（已写好 last_used 的）owned 副本放回槽位。放在 ripple 段**之前**——
        // ripple 冷却回溯会遍历技能槽写 last_used，必须看到完整槽位；效果循环内也无任何
        // 路径读 source 的技能槽（已核实 damage 目标恒为敌方列表、promote/revive 触新单位）。
        self.arena.get_mut(source).abilities[slot] = Some(ability);

        let ripple = self.arena.get(current_source).combat_details.combat_stats.ripple;
        if ripple > 0.0 && self.rng.next_f64() < ripple {
            let manapoints_added = self.arena.get_mut(current_source).add_manapoints(10.0);
            let hrid = self.unit_hrid(current_source);
            self.tally.add_manapoints_gained(hrid, intern_hrid("ripple"), manapoints_added);

            let time = self.simulation_time;
            let unit = self.arena.get_mut(current_source);
            for slot in 0..unit.abilities.len() {
                if let Some(active_ability) = unit.abilities[slot].as_mut() {
                    if js_truthy_number(active_ability.last_used) {
                        let remaining_cooldown =
                            active_ability.last_used + active_ability.cooldown_duration - time;
                        if remaining_cooldown > 0.0 {
                            active_ability.last_used = js_math_max(
                                active_ability.last_used - ONE_SECOND * 2.0,
                                time - active_ability.cooldown_duration,
                            );
                        }
                    }
                }
            }
        }

        self.add_next_attack_event(current_source)?;

        if self.arena.get(current_source).combat_details.current_hitpoints == 0.0 {
            self.clear_events_for_unit(current_source);
            self.record_unit_death(current_source);
            if !self.arena.get(current_source).is_player {
                let hrid = self.unit_hrid(current_source);
                let time = self.simulation_time;
                with_hrid(hrid, |name| self.tally.update_time_spent_alive(name, false, time));
            }
        }

        self.check_encounter_end()?;
        Ok(true)
    }

    /// 等价 JS `processAbilityBuffEffect(source, ability, abilityEffect, { scheduleExpirationEvents })`。
    fn process_ability_buff_effect(
        &mut self,
        source: UnitId,
        ability: &Ability,
        effect: &AbilityEffect,
        schedule_expiration_events: bool,
    ) -> Result<(), UnitError> {
        if effect.target_type == Hrid::TARGET_ALL_ALLIES {
            // 免克隆：下标遍历替代 players/enemies 的 Vec 克隆（循环内只调
            // add_ability_buff / schedule，不增删单位列表，遍历语义与快照一致）。
            let is_player = self.arena.get(source).is_player;
            let targets_len = if is_player { self.players.len() } else { self.enemies.as_ref().map_or(0, |e| e.len()) };
            for index in 0..targets_len {
                let target = if is_player {
                    self.players[index]
                } else {
                    match self.enemies.as_ref().and_then(|enemies| enemies.get(index)) {
                        Some(enemy) => *enemy,
                        None => break,
                    }
                };
                if self.arena.get(target).combat_details.current_hitpoints <= 0.0 {
                    continue;
                }
                for buff in &effect.buffs {
                    let mut current_buff = buff.clone();
                    if ability.is_special_ability
                        && !hrid_is_empty(buff.multiplier_for_skill_hrid)
                        && buff.multiplier_per_skill_level > 0.0
                    {
                        let multiplier = 1.0
                            + self.skill_level_value(source, buff.multiplier_for_skill_hrid)
                                * buff.multiplier_per_skill_level;
                        current_buff.flat_boost *= multiplier;
                        current_buff.ratio_boost *= multiplier;
                    }
                    let source_key = self.add_ability_buff(target, &current_buff, source, ability)?;
                    if schedule_expiration_events {
                        self.schedule_buff_expiration_event(target, &current_buff, source_key)?;
                    }
                }
            }
            return Ok(());
        }

        if effect.target_type != Hrid::TARGET_SELF {
            return Err(UnitError::error(format!(
                "Unsupported target type for buff ability effect: {}",
                ability.hrid
            )));
        }

        for buff in &effect.buffs {
            let source_key = self.add_ability_buff(source, buff, source, ability)?;
            if schedule_expiration_events {
                self.schedule_buff_expiration_event(source, buff, source_key)?;
            }
        }
        Ok(())
    }

    /// JS `source.combatDetails[buff.multiplierForSkillHrid.split('/')[2] + 'Level']`。
    fn skill_level_value(&self, source: UnitId, multiplier_for_skill_hrid: Hrid) -> f64 {
        let details = &self.arena.get(source).combat_details;
        with_hrid(multiplier_for_skill_hrid, |name| match name.split('/').nth(2).unwrap_or("") {
            "stamina" => details.stamina_level,
            "intelligence" => details.intelligence_level,
            "attack" => details.attack_level,
            "melee" => details.melee_level,
            "defense" => details.defense_level,
            "ranged" => details.ranged_level,
            "magic" => details.magic_level,
            // JS：combatDetails[undefined + 'Level'] → undefined ⇒ 与数值相乘得 NaN。
            _ => f64::NAN,
        })
    }

    /// 等价 JS 顶层 `addAbilityBuff(target, buff, currentTime, source, ability)`。
    fn add_ability_buff(
        &mut self,
        target: UnitId,
        buff: &crate::buff::Buff,
        source: UnitId,
        ability: &Ability,
    ) -> Result<Hrid, UnitError> {
        let _prof = crate::prof::start("buff.add_ability_buff");
        let policy = get_ability_buff_source_policy(ability.hrid, buff.unique_hrid);
        let source_key = if policy == BuffSourcePolicy::Strongest {
            let hrid = self.unit_hrid(source);
            if hrid_is_empty(hrid) {
                Hrid::DEFAULT
            } else {
                hrid
            }
        } else {
            Hrid::DEFAULT
        };

        let input = RawBuffInput {
            unique_hrid: Some(buff.unique_hrid),
            type_hrid: Some(buff.type_hrid),
            ratio_boost: Some(buff.ratio_boost),
            flat_boost: Some(buff.flat_boost),
            duration: buff.duration,
            multiplier_for_skill_hrid: Some(buff.multiplier_for_skill_hrid),
            multiplier_per_skill_level: Some(buff.multiplier_per_skill_level),
            start_time: buff.start_time,
        };
        let time = self.simulation_time;
        let source_hrid_arg = if policy == BuffSourcePolicy::Strongest { Some(source_key) } else { None };
        self.arena
            .get_mut(target)
            .add_buff(&input, time, source_hrid_arg, Some(policy_name(policy)))?;
        Ok(source_key)
    }

    /// 等价 JS `processAbilityDamageEffect(source, ability, abilityEffect)`。
    fn process_ability_damage_effect(
        &mut self,
        source: UnitId,
        ability: &Ability,
        effect: &AbilityEffect,
    ) -> Result<(), UnitError> {
        let _prof = crate::prof::start("ability.damage");
        let prof_setup = crate::prof::start("ability.damage.setup");
        let is_player = self.arena.get(source).is_player;
        // 切片 28：免克隆——原先把对侧全集克隆成 `targets`，它只被三处消费：
        // ① 存活表构造；② `check_parry`（候选过滤「存活 ∧ parry>0」对全集与存活子集
        // 恒等）；③ 逐轮候选重过滤（存活 ∧ 未被 avoid——死单位只减不增、avoid 单调增长，
        // 故其当前态与「存活表重过滤」恒等）。现在直接构造存活表，候选表由 retain 原地
        // 维护（省掉整表克隆与逐轮重分配）。
        // 切片 29：存活表 / 候选表改为复用模拟器暂存（take → 清空 → 重填；末尾 restore）。
        let mut alive_targets = std::mem::take(&mut self.scratch.alive);
        alive_targets.clear();
        match effect.target_type {
            Hrid::TARGET_ENEMY | Hrid::TARGET_ALL_ENEMIES => {
                if is_player {
                    let Some(enemies) = self.enemies.as_deref() else {
                        self.scratch.alive = alive_targets;
                        return Ok(());
                    };
                    alive_targets.extend(
                        enemies
                            .iter()
                            .copied()
                            .filter(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0),
                    );
                } else {
                    alive_targets.extend(
                        self.players
                            .iter()
                            .copied()
                            .filter(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0),
                    );
                }
            }
            _ => {
                self.scratch.alive = alive_targets;
                return Err(UnitError::error(format!(
                    "Unsupported target type for damage ability effect: {}",
                    ability.hrid
                )));
            }
        };

        let mut avoid_target: Vec<Hrid> = Vec::new();
        let mut is_skip_parry = false;
        // 切片 29：候选表仅在非玩家路径参与判定（玩家路径 avoid 集恒空、候选集 ≡ 存活集，
        // 见循环内的等价替换），复用暂存槽位；非玩家路径初始 = 存活表，随后单调收缩。
        let mut candidates = std::mem::take(&mut self.scratch.candidates);
        candidates.clear();
        if !is_player {
            candidates.extend_from_slice(&alive_targets);
        }

        drop(prof_setup);

        for alive_index in 0..alive_targets.len() {
            let mut target = alive_targets[alive_index];
            let mut parry_target: Option<UnitId> = None;
            if !is_skip_parry {
                let _prof = crate::prof::start("ability.damage.parry");
                parry_target = self.check_parry(&alive_targets);
                is_skip_parry = true;
            }

            if let Some(parry) = parry_target {
                let _prof = crate::prof::start("ability.damage.parry_body");
                let temp_target = source;
                let temp_source = parry;
                let attack_result = {
                    let (source_unit, target_unit) = self.arena.two_mut(temp_source, temp_target);
                    process_attack(source_unit, target_unit, None, &mut self.rng)
                };

                let temp_source_hrid = self.unit_hrid(temp_source);
                let temp_target_hrid = self.unit_hrid(temp_target);

                let outcome = if attack_result.did_hit {
                    AttackOutcome::Damage(attack_result.damage_done)
                } else {
                    AttackOutcome::Miss
                };
                self.tally
                    .add_attack(temp_source_hrid, temp_target_hrid, intern_hrid("parry"), outcome);

                if attack_result.life_steal_heal > 0.0 {
                    self.tally
                        .add_hitpoints_gained(temp_source_hrid, intern_hrid("lifesteal"), attack_result.life_steal_heal);
                }
                if attack_result.mana_leech_mana > 0.0 {
                    self.tally
                        .add_manapoints_gained(temp_source_hrid, intern_hrid("manaLeech"), attack_result.mana_leech_mana);
                }
                if attack_result.thorn_damage_done > 0.0 {
                    self.tally.add_attack(
                        temp_target_hrid,
                        temp_source_hrid,
                        intern_hrid(&attack_result.thorn_type),
                        AttackOutcome::Damage(attack_result.thorn_damage_done),
                    );
                }
                if self.arena.get(temp_target).combat_details.combat_stats.retaliation > 0.0 {
                    let outcome = if attack_result.retaliation_damage_done > 0.0 {
                        AttackOutcome::Damage(attack_result.retaliation_damage_done)
                    } else {
                        AttackOutcome::Miss
                    };
                    self.tally
                        .add_attack(temp_target_hrid, temp_source_hrid, intern_hrid("retaliation"), outcome);
                }

                if self.arena.get(temp_target).combat_details.current_hitpoints == 0.0 {
                    self.clear_events_for_unit(temp_target);
                    self.record_unit_death(temp_target);
                    if !self.arena.get(temp_target).is_player {
                        let time = self.simulation_time;
                        with_hrid(temp_target_hrid, |name| {
                            self.tally.update_time_spent_alive(name, false, time)
                        });
                    }
                }

                if self.arena.get(temp_source).combat_details.current_hitpoints == 0.0
                    && (attack_result.thorn_damage_done != 0.0 || attack_result.retaliation_damage_done != 0.0)
                {
                    self.clear_events_for_unit(temp_source);
                    self.record_unit_death(temp_source);
                    if !self.arena.get(temp_source).is_player {
                        let time = self.simulation_time;
                        with_hrid(temp_source_hrid, |name| {
                            self.tally.update_time_spent_alive(name, false, time)
                        });
                    }
                }
            } else {
                // 切片 29：玩家源免候选表——`avoid_target` 只由下方非玩家分支写入（玩家恒空），
                // 且目标只死不回生，故「候选表逐轮收缩后为空」⇔「存活表已无存活目标」。
                // 直接判存活表，省去候选表分配与逐轮 retain；非玩家路径保持原语义（原地收缩）。
                if is_player {
                    let any_alive = alive_targets
                        .iter()
                        .any(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0);
                    if !any_alive {
                        break;
                    }
                } else {
                    // 候选表原地收缩（单调），等价原实现对全集的逐轮重过滤。
                    candidates.retain(|id| {
                        let unit = self.arena.get(*id);
                        !avoid_target.contains(&unit.hrid) && unit.combat_details.current_hitpoints > 0.0
                    });

                    if !candidates.is_empty() && effect.target_type == Hrid::TARGET_ENEMY {
                        target = self.pick_threat_target(&candidates)?;
                        let hrid = self.unit_hrid(target);
                        avoid_target.push(hrid);
                    }
                    if candidates.is_empty() {
                        break;
                    }
                }

                let prof_attack = crate::prof::start("ability.damage.attack");
                let attack_result = {
                    let (source_unit, target_unit) = self.arena.two_mut(source, target);
                    process_attack(source_unit, target_unit, Some(effect), &mut self.rng)
                };

                let source_hrid = self.unit_hrid(source);
                let target_hrid = self.unit_hrid(target);
                drop(prof_attack);

                let _prof_body = crate::prof::start("ability.damage.body");

                // 切片 19：JS :2023-2032——副本日志（技能直击玩家且造成伤害）。
                if self.wipe_logs.is_some()
                    && self.arena.get(target).is_player
                    && attack_result.did_hit
                    && attack_result.damage_done > 0.0
                {
                    let entry = with_hrid(ability.hrid, |ability_name| {
                        self.generate_wipe_log_entry(source, ability_name, target, &attack_result)
                    });
                    self.wipe_logs.as_mut().expect("checked").push(entry);
                }

                if attack_result.hp_drain > 0.0 {
                    self.tally
                        .add_hitpoints_gained(source_hrid, ability.hrid, attack_result.hp_drain);
                }

                if attack_result.did_hit && !effect.buffs.is_empty() {
                    for buff in &effect.buffs {
                        let source_key = self.add_ability_buff(target, buff, source, ability)?;
                        self.schedule_buff_expiration_event(target, buff, source_key)?;
                    }
                }

                let dot_ratio = effect.damage_over_time_ratio.unwrap_or(f64::NAN);
                if dot_ratio > 0.0 && attack_result.damage_done > 0.0 {
                    let dot_duration = effect.damage_over_time_duration.unwrap_or(f64::NAN);
                    let time = self.simulation_time + DOT_TICK_INTERVAL;
                    let id = self.take_event_id();
                    self.queue.add_event(SimEvent::DamageOverTime {
                        time,
                        id,
                        source_ref: source,
                        target,
                        damage: attack_result.damage_done * dot_ratio,
                        total_ticks: dot_duration / DOT_TICK_INTERVAL,
                        current_tick: 1.0,
                        combat_style_hrid: effect.combat_style_hrid.clone(),
                    });
                }

                let stun_chance = effect.stun_chance.unwrap_or(f64::NAN);
                if attack_result.did_hit && stun_chance > 0.0 {
                    let tenacity = self
                        .arena
                        .get(target)
                        .combat_details
                        .combat_stats
                        .tenacity
                        .unwrap_or(f64::NAN);
                    let roll = self.rng.next_f64();
                    if roll < (stun_chance * 100.0) / (100.0 + tenacity) {
                        let duration = effect.stun_duration.unwrap_or(f64::NAN);
                        let time = self.simulation_time;
                        let expire_time = time + duration;
                        {
                            let unit = self.arena.get_mut(target);
                            unit.is_stunned = true;
                            unit.stun_expire_time = Some(expire_time);
                        }
                        self.queue.clear_matching(|event| {
                            (event.event_type() == Hrid::EVENT_AUTO_ATTACK
                                || event.event_type() == Hrid::EVENT_ABILITY_CAST_END
                                || event.event_type() == Hrid::EVENT_STUN_EXPIRATION)
                                && event.source() == Some(target as u64)
                        });
                        let id = self.take_event_id();
                        self.queue
                            .add_event(SimEvent::StunExpiration { time: expire_time, id, source: target });
                    }
                }

                let blind_chance = effect.blind_chance.unwrap_or(f64::NAN);
                if attack_result.did_hit && blind_chance > 0.0 {
                    let tenacity = self
                        .arena
                        .get(target)
                        .combat_details
                        .combat_stats
                        .tenacity
                        .unwrap_or(f64::NAN);
                    let roll = self.rng.next_f64();
                    if roll < (blind_chance * 100.0) / (100.0 + tenacity) {
                        let duration = effect.blind_duration.unwrap_or(f64::NAN);
                        let time = self.simulation_time;
                        let expire_time = time + duration;
                        {
                            let unit = self.arena.get_mut(target);
                            unit.is_blinded = true;
                            unit.blind_expire_time = Some(expire_time);
                        }
                        self.queue.clear_matching(|event| {
                            event.event_type() == Hrid::EVENT_BLIND_EXPIRATION && event.source() == Some(target as u64)
                        });
                        let cleared_auto_attack = self.queue.clear_matching(|event| {
                            event.event_type() == Hrid::EVENT_AUTO_ATTACK && event.source() == Some(target as u64)
                        });
                        if cleared_auto_attack {
                            self.add_next_attack_event(target)?;
                        }
                        let id = self.take_event_id();
                        self.queue
                            .add_event(SimEvent::BlindExpiration { time: expire_time, id, source: target });
                    }
                }

                let silence_chance = effect.silence_chance.unwrap_or(f64::NAN);
                if attack_result.did_hit && silence_chance > 0.0 {
                    let tenacity = self
                        .arena
                        .get(target)
                        .combat_details
                        .combat_stats
                        .tenacity
                        .unwrap_or(f64::NAN);
                    let roll = self.rng.next_f64();
                    if roll < (silence_chance * 100.0) / (100.0 + tenacity) {
                        let duration = effect.silence_duration.unwrap_or(f64::NAN);
                        let time = self.simulation_time;
                        let expire_time = time + duration;
                        {
                            let unit = self.arena.get_mut(target);
                            unit.is_silenced = true;
                            unit.silence_expire_time = Some(expire_time);
                        }
                        self.queue.clear_matching(|event| {
                            event.event_type() == Hrid::EVENT_SILENCE_EXPIRATION && event.source() == Some(target as u64)
                        });
                        let cleared_cast = self.queue.clear_matching(|event| {
                            event.event_type() == Hrid::EVENT_ABILITY_CAST_END && event.source() == Some(target as u64)
                        });
                        if cleared_cast {
                            self.add_next_attack_event(target)?;
                        }
                        let id = self.take_event_id();
                        self.queue
                            .add_event(SimEvent::SilenceExpiration { time: expire_time, id, source: target });
                    }
                }

                let curse_power = self.arena.get(source).combat_details.combat_stats.curse;
                if attack_result.did_hit && curse_power > 0.0 {
                    self.apply_curse_expiration(source, target)?;
                }

                let fury_power = self.arena.get(source).combat_details.combat_stats.fury;
                if fury_power > 0.0 {
                    self.apply_fury(source, attack_result.did_hit)?;
                }

                let weaken_power = self.arena.get(target).combat_details.combat_stats.weaken;
                if weaken_power > 0.0 {
                    self.apply_weaken(source, target, true)?;
                }

                let outcome = if attack_result.did_hit {
                    AttackOutcome::Damage(attack_result.damage_done)
                } else {
                    AttackOutcome::Miss
                };
                self.tally.add_attack(source_hrid, target_hrid, ability.hrid, outcome);

                if attack_result.thorn_damage_done > 0.0 {
                    self.tally.add_attack(
                        target_hrid,
                        source_hrid,
                        intern_hrid(&attack_result.thorn_type),
                        AttackOutcome::Damage(attack_result.thorn_damage_done),
                    );
                }
                // 切片 19：JS :2216-2219——技能反伤日志（thorn 打到玩家攻击者）。
                if self.wipe_logs.is_some() && attack_result.thorn_damage_done > 0.0 && self.arena.get(source).is_player {
                    let entry = with_hrid(target_hrid, |target_name| {
                        self.build_wipe_log_entry(
                            target_name,
                            &attack_result.thorn_type,
                            source,
                            attack_result.thorn_damage_done,
                        )
                    });
                    self.wipe_logs.as_mut().expect("checked").push(entry);
                }

                if self.arena.get(target).combat_details.combat_stats.retaliation > 0.0 {
                    let outcome = if attack_result.retaliation_damage_done > 0.0 {
                        AttackOutcome::Damage(attack_result.retaliation_damage_done)
                    } else {
                        AttackOutcome::Miss
                    };
                    self.tally
                        .add_attack(target_hrid, source_hrid, intern_hrid("retaliation"), outcome);
                }
                // 切片 19：JS :2229-2232——技能反击日志（retaliation 打到玩家攻击者）。
                if self.wipe_logs.is_some()
                    && attack_result.retaliation_damage_done > 0.0
                    && self.arena.get(source).is_player
                {
                    let entry = with_hrid(target_hrid, |target_name| {
                        self.build_wipe_log_entry(
                            target_name,
                            "retaliation",
                            source,
                            attack_result.retaliation_damage_done,
                        )
                    });
                    self.wipe_logs.as_mut().expect("checked").push(entry);
                }

                if self.arena.get(target).combat_details.current_hitpoints == 0.0 {
                    self.clear_events_for_unit(target);
                    self.record_unit_death(target);
                    if !self.arena.get(target).is_player {
                        let time = self.simulation_time;
                        with_hrid(target_hrid, |name| self.tally.update_time_spent_alive(name, false, time));
                    }
                }

                if attack_result.did_hit
                    && effect.pierce_chance.unwrap_or(f64::NAN) > self.rng.next_f64()
                {
                    continue;
                }
            }

            if parry_target.is_some() {
                break;
            }
            if effect.target_type == Hrid::TARGET_ENEMY {
                break;
            }
        }

        self.scratch.alive = alive_targets;
        self.scratch.candidates = candidates;

        Ok(())
    }

    /// 等价 JS `processAbilityHealEffect(source, ability, abilityEffect)`。
    fn process_ability_heal_effect(
        &mut self,
        source: UnitId,
        ability: &Ability,
        effect: &AbilityEffect,
    ) -> Result<(), UnitError> {
        let is_player = self.arena.get(source).is_player;
        let allies_len = if is_player { self.players.len() } else { self.enemies.as_ref().map_or(0, |e| e.len()) };
        let ally_at = |index: usize| -> Option<UnitId> {
            if is_player {
                self.players.get(index).copied()
            } else {
                self.enemies.as_ref().and_then(|enemies| enemies.get(index)).copied()
            }
        };

        if effect.target_type == Hrid::TARGET_ALL_ALLIES {
            for index in 0..allies_len {
                let Some(target) = ally_at(index) else { break };
                if self.arena.get(target).combat_details.current_hitpoints <= 0.0 {
                    continue;
                }
                let (healing_amplify, magic_max_damage) = self.caster_heal_stats(source);
                let amount_healed = process_heal_with_stats(
                    healing_amplify,
                    magic_max_damage,
                    effect,
                    self.arena.get_mut(target),
                    &mut self.rng,
                );
                let target_hrid = self.unit_hrid(target);
                self.tally.add_hitpoints_gained(target_hrid, ability.hrid, amount_healed);
            }
            return Ok(());
        }

        if effect.target_type == Hrid::TARGET_LOWEST_HP_ALLY {
            let mut heal_target: Option<UnitId> = None;
            for index in 0..allies_len {
                let Some(target) = ally_at(index) else { break };
                if self.arena.get(target).combat_details.current_hitpoints <= 0.0 {
                    continue;
                }
                let Some(current) = heal_target else {
                    heal_target = Some(target);
                    continue;
                };
                let target_details = &self.arena.get(target).combat_details;
                let target_hp_percent = target_details.current_hitpoints / target_details.max_hitpoints;
                let heal_details = &self.arena.get(current).combat_details;
                let heal_target_hp_percent = heal_details.current_hitpoints / heal_details.max_hitpoints;
                if target_hp_percent < heal_target_hp_percent {
                    heal_target = Some(target);
                }
            }

            if let Some(heal_target) = heal_target {
                let (healing_amplify, magic_max_damage) = self.caster_heal_stats(source);
                let amount_healed = process_heal_with_stats(
                    healing_amplify,
                    magic_max_damage,
                    effect,
                    self.arena.get_mut(heal_target),
                    &mut self.rng,
                );
                let target_hrid = self.unit_hrid(heal_target);
                self.tally.add_hitpoints_gained(target_hrid, ability.hrid, amount_healed);
            }
            return Ok(());
        }

        if effect.target_type != Hrid::TARGET_SELF {
            return Err(UnitError::error(format!(
                "Unsupported target type for heal ability effect: {}",
                ability.hrid
            )));
        }

        let (healing_amplify, magic_max_damage) = self.caster_heal_stats(source);
        let amount_healed =
            process_heal_with_stats(healing_amplify, magic_max_damage, effect, self.arena.get_mut(source), &mut self.rng);
        let source_hrid = self.unit_hrid(source);
        self.tally.add_hitpoints_gained(source_hrid, ability.hrid, amount_healed);
        Ok(())
    }

    fn caster_heal_stats(&self, source: UnitId) -> (f64, f64) {
        let details = &self.arena.get(source).combat_details;
        (1.0 + details.combat_stats.healing_amplify, details.magic_max_damage)
    }

    /// 等价 JS `processAbilityReviveEffect(source, ability, abilityEffect)`。
    fn process_ability_revive_effect(
        &mut self,
        source: UnitId,
        ability: &Ability,
        effect: &AbilityEffect,
    ) -> Result<(), UnitError> {
        if !hrid_is(effect.target_type, "deadAlly") {
            return Err(UnitError::error(format!(
                "Unsupported target type for revive ability effect: {}",
                ability.hrid
            )));
        }

        let is_player = self.arena.get(source).is_player;
        let targets: Vec<UnitId> = if is_player { self.players.clone() } else { self.enemies.clone().unwrap_or_default() };
        let revive_target = targets
            .iter()
            .copied()
            .find(|id| self.arena.get(*id).combat_details.current_hitpoints <= 0.0);

        if let Some(revive_target) = revive_target {
            let revive_hrid = self.unit_hrid(revive_target);
            self.queue
                .clear_matching(|event| event.event_type() == Hrid::EVENT_PLAYER_RESPAWN && event.hrid() == Some(revive_hrid));

            let time = self.simulation_time;
            self.arena.get_mut(revive_target).remove_expired_buffs(time, true)?;

            let (healing_amplify, magic_max_damage) = self.caster_heal_stats(source);
            let amount_healed = process_revive_with_stats(
                healing_amplify,
                magic_max_damage,
                effect,
                self.arena.get_mut(revive_target),
                &mut self.rng,
            );

            self.tally.add_hitpoints_gained(revive_hrid, ability.hrid, amount_healed);
            self.add_next_attack_event(revive_target)?;

            if !is_player {
                let time = self.simulation_time;
                with_hrid(revive_hrid, |name| self.tally.update_time_spent_alive(name, true, time));
            }
        }
        Ok(())
    }

    /// 等价 JS `processAbilityPromoteEffect(source, ability, abilityEffect)`。
    /// 新怪物的难度档继承升变来源（JS `new Monster(hrid, source.difficultyTier)`）。
    fn process_ability_promote_effect(&mut self, source: UnitId) -> Result<UnitId, UnitError> {
        const PROMOTION_HRIDS: [&str; 3] = [
            "/monsters/enchanted_rook",
            "/monsters/enchanted_knight",
            "/monsters/enchanted_bishop",
        ];
        let random_promotion_index = (self.rng.next_f64() * PROMOTION_HRIDS.len() as f64).floor() as usize;
        let hrid = PROMOTION_HRIDS[random_promotion_index.min(PROMOTION_HRIDS.len() - 1)];
        let Some(spec) = self.promotion_specs.get_str(hrid).cloned() else {
            return Err(UnitError::error(format!(
                "promote effect requires a scenario spec for {hrid}"
            )));
        };
        let mut unit = build_unit_from_spec(&spec)?;
        unit.difficulty_tier = self.arena.get(source).difficulty_tier;
        // 切片 26：升变产物同样入池——键 = 升变 hrid + 继承的难度档（命中模板时原地重建，
        // 与它来自哪条路径无关）；难度档缺失（探针合成来源）时保持 None、不入池。
        unit.respawn_pool_key = unit
            .difficulty_tier
            .map(|tier| format!("{hrid}|{}", crate::zone::js_number_key(tier)));
        Ok(self.arena.push(unit))
    }

    /// 等价 JS `processAbilitySpendHpEffect(source, ability, abilityEffect)`。
    fn process_ability_spend_hp_effect(
        &mut self,
        source: UnitId,
        ability: &Ability,
        effect: &AbilityEffect,
    ) -> Result<(), UnitError> {
        if effect.target_type != Hrid::TARGET_SELF {
            return Err(UnitError::error(format!(
                "Unsupported target type for spend hp ability effect: {}",
                ability.hrid
            )));
        }
        let hp_spent = process_spend_hp(self.arena.get_mut(source), effect);
        let source_hrid = self.unit_hrid(source);
        self.tally.add_hitpoints_spent(source_hrid, ability.hrid, hp_spent);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ability::Ability;

    fn small_scenario() -> SimulatorOptions {
        let enemy = UnitSpec {
            hrid: "/e/0".to_string(),
            is_player: false,
            levels: Some(LevelsSpec { defense_level: Some(1.0), ..Default::default() }),
            combat_stats: vec![],
            abilities: vec![None],
            ..Default::default()
        };
        SimulatorOptions {
            seed: 42,
            simulation_time_limit: 20_000_000.0,
            trace_limit: 64,
            max_result_calls: 512,
            zone_present: true,
            zone_is_dungeon: false,
            labyrinth_present: false,
            encounter_specs: vec![vec![enemy]],
            promotion_specs: vec![],
            blaze_ability: Some(Ability {
                hrid: intern_hrid("blaze"),
                level: 1.0,
                mana_cost: 0.0,
                cooldown_duration: 0.0,
                cast_duration: 0.0,
                is_special_ability: false,
                ability_effects: vec![],
                triggers: vec![],
                last_used: crate::ability::default_last_used(),
            }),
            bloom_ability: None,
            ..Default::default()
        }
    }

    #[test]
    fn simulator_runs_and_is_deterministic() {
        let mut first = CombatSimulator::new(small_scenario());
        first.add_player(&small_scenario_player_spec()).expect("player builds");
        first.simulate().expect("first run succeeds");

        let mut second = CombatSimulator::new(small_scenario());
        second.add_player(&small_scenario_player_spec()).expect("player builds");
        second.simulate().expect("second run succeeds");

        assert!(first.event_count > 0);
        assert_eq!(first.event_count, second.event_count);
        assert_eq!(first.tally.calls, second.tally.calls);
        assert_eq!(first.trace, second.trace);
        let attacks = first
            .tally
            .calls
            .iter()
            .filter(|call| call.method == "addAttack")
            .count();
        assert!(attacks > 0, "expected the run to record attacks");
    }

    fn small_scenario_player_spec() -> UnitSpec {
        UnitSpec {
            hrid: "/p/0".to_string(),
            is_player: true,
            levels: Some(LevelsSpec {
                stamina_level: Some(100.0),
                ..Default::default()
            }),
            combat_stats: vec![("attackInterval".to_string(), 1_000_000.0)],
            ..Default::default()
        }
    }

    #[test]
    fn building_units_rejects_unknown_combat_stat_fields() {
        let spec = UnitSpec {
            hrid: "/x".to_string(),
            combat_stats: vec![("bogusField".to_string(), 1.0)],
            ..Default::default()
        };
        match build_unit_from_spec(&spec) {
            Ok(_) => panic!("expected the unknown combat stat field to be rejected"),
            Err(error) => assert_eq!(error, UnitError::error("unknown combat stat field: bogusField")),
        }
    }

    #[test]
    fn normalize_time_limit_matches_js_number_coercion() {
        assert_eq!(normalize_time_limit(f64::NAN), 0.0);
        assert_eq!(normalize_time_limit(-5.0), 0.0);
        assert_eq!(normalize_time_limit(12.5), 12.5);
    }

    /// 切片 12：真实区域 + 模板的小型生产场景（无需 JS 侧夹具）。
    fn early_stop_production_options(early_stop: Option<EarlyStopSpec>) -> (SimulatorOptions, UnitSpec) {
        let player = UnitSpec {
            hrid: "player1".to_string(),
            is_player: true,
            levels: Some(LevelsSpec { stamina_level: Some(10.0), ..Default::default() }),
            combat_stats: vec![("attackInterval".to_string(), 1_000_000.0)],
            ..Default::default()
        };
        let enemy = UnitSpec {
            hrid: "/monsters/dummy".to_string(),
            is_player: false,
            levels: Some(LevelsSpec { defense_level: Some(1.0), ..Default::default() }),
            ..Default::default()
        };
        let options = SimulatorOptions {
            seed: 7,
            simulation_time_limit: 60.0 * ONE_SECOND,
            zone_present: true,
            real_result: true,
            minimal_result: true,
            zone_hrid: Some("/actions/combat/early_stop_test".to_string()),
            zone_monster_spawn_info: Some(serde_json::json!({
                "randomSpawnInfo": {
                    "maxSpawnCount": 1,
                    "maxTotalStrength": 1,
                    "spawns": [
                        { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0, "rate": 1, "strength": 1 }
                    ]
                },
                "bossSpawns": null,
                "battlesPerBoss": 0
            })),
            encounter_templates: vec![TemplateSpec {
                hrid: "/monsters/dummy".to_string(),
                difficulty_tier: 0.0,
                spec: enemy,
            }],
            early_stop,
            ..Default::default()
        };
        (options, player)
    }

    #[test]
    fn early_stop_triggers_on_death_limit_and_reports_partial_time() {
        // 监视怪物死亡数：deathLimit=2 → 第 3 次死亡后立即停止（怪物 HP 很低，玩家速杀）。
        let (mut options, player) = early_stop_production_options(Some(EarlyStopSpec {
            watch_hrid: intern_hrid("/monsters/dummy"),
            death_limit: Some(2.0),
        }));
        // 拉长时限，让死亡预算成为唯一停止原因。
        options.simulation_time_limit = 20.0 * 60.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["stoppedEarly"], serde_json::json!(true));
        assert!(result["simulatedTime"].as_f64().expect("time") < options.simulation_time_limit);
        let deaths = result["deaths"]["/monsters/dummy"].as_f64().expect("monster deaths recorded");
        assert_eq!(deaths, 3.0);
    }

    #[test]
    fn early_stop_absent_runs_to_limit() {
        let (mut options, player) = early_stop_production_options(None);
        options.simulation_time_limit = 30.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["stoppedEarly"], serde_json::json!(false));
        assert_eq!(
            result["simulatedTime"].as_f64().expect("time"),
            options.simulation_time_limit
        );
    }

    #[test]
    fn early_stop_none_death_limit_ignores_deaths() {
        // deathLimit: None（JS Infinity）：怪物死亡不触发停止，跑满时限。
        let (mut options, player) = early_stop_production_options(Some(EarlyStopSpec {
            watch_hrid: intern_hrid("/monsters/dummy"),
            death_limit: None,
        }));
        options.simulation_time_limit = 30.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["stoppedEarly"], serde_json::json!(false));
        assert_eq!(
            result["simulatedTime"].as_f64().expect("time"),
            options.simulation_time_limit
        );
        assert!(result["deaths"].get("/monsters/dummy").is_some());
    }

    /// 切片 13：带单一 missing_hp/mp 触发器的测试食物（cooldown 0 → 门控恒过，
    /// 每次触发检查都会走到 compare_value，观察点充分暴露）。
    fn observer_trigger_food(hrid: &str, condition: &str, value: f64) -> Consumable {
        Consumable {
            hrid: intern_hrid(hrid),
            cooldown_duration: 0.0,
            hitpoint_restore: 10.0,
            manapoint_restore: 10.0,
            recovery_duration: 0.0,
            category_hrid: intern_hrid("/item_categories/food"),
            buffs: Vec::new(),
            triggers: vec![crate::trigger::Trigger {
                dependency_hrid: intern_hrid("/combat_trigger_dependencies/self"),
                condition_hrid: intern_hrid(condition),
                comparator_hrid: intern_hrid("/combat_trigger_comparators/greater_than_equal"),
                value,
                is_single_target: true,
            }],
            last_used: crate::ability::default_last_used(),
        }
    }

    /// 切片 20：打不死的高体力怪模板（同切片 19 团灭日志用例的调参）。
    /// `early_stop_production_options` 的默认怪 defense_level 1，会被玩家
    /// 1ms 攻速在首击前秒杀 → 玩家 HP 永不下降 → 食物永不消费。换此强怪：
    /// attack_level 1000 → 命中率 ≈99.8%，攻速 1s/1.5≈667ms；melee_level
    /// 1000 → 单击 ≤1010 ≪ 玩家 HP 100100（stamina 10000），玩家全程存活且
    /// 持续掉血，missing_hp 触发器必然满足、食物必然消费。
    fn unkillable_enemy_template() -> TemplateSpec {
        TemplateSpec {
            hrid: "/monsters/dummy".to_string(),
            difficulty_tier: 0.0,
            spec: UnitSpec {
                hrid: "/monsters/dummy".to_string(),
                is_player: false,
                levels: Some(LevelsSpec {
                    stamina_level: Some(1.0e12),
                    attack_level: Some(1_000.0),
                    melee_level: Some(1_000.0),
                    defense_level: Some(1.0),
                    ..Default::default()
                }),
                combat_stats: vec![("attackInterval".to_string(), 1_000_000_000.0)],
                ..Default::default()
            },
        }
    }

    #[test]
    fn observers_export_threshold_ranges_and_inactive_minimum() {
        let (mut options, mut player) = early_stop_production_options(None);
        options.simulation_time_limit = 30.0 * ONE_SECOND;
        // 过滤序场景：中间空槽不占阈值区间位（JS 按 filter(Boolean) 下标）。
        player.food = vec![
            Some(observer_trigger_food(
                "/items/donut",
                "/combat_trigger_conditions/missing_hp",
                1.0,
            )),
            None,
            Some(observer_trigger_food(
                "/items/mana_donut",
                "/combat_trigger_conditions/missing_mp",
                1_000_000_000.0,
            )),
        ];

        // 纯读契约基线：同 seed 同输入，仅 observers 差异。
        let mut baseline = CombatSimulator::new(options.clone());
        baseline.add_player(&player).expect("baseline player builds");
        baseline.simulate().expect("baseline runs");
        let baseline_result = baseline.tally.real.as_ref().expect("real result").to_value();

        options.observers = Some(ObserverSpec { watch_hrid: intern_hrid("player1") });
        let mut observed = CombatSimulator::new(options.clone());
        observed.add_player(&player).expect("player builds");
        observed.simulate().expect("observed run succeeds");

        assert_eq!(observed.event_count, baseline.event_count);
        assert_eq!(
            observed.tally.real.as_ref().expect("real result").to_value(),
            baseline_result
        );

        let observers = observed.observers_output();
        let ranges = observers["thresholdRanges"].as_array().expect("threshold ranges exported");
        assert_eq!(ranges.len(), 2, "None 槽不占区间位（过滤序）");
        assert_eq!(ranges[0]["hrid"], json!("/items/donut"));
        assert_eq!(ranges[0]["kind"], json!("hp"));
        assert_eq!(ranges[1]["hrid"], json!("/items/mana_donut"));
        assert_eq!(ranges[1]["kind"], json!("mp"));
        for range in ranges {
            let min = range["min"].as_f64().expect("min");
            let max = range["max"].as_f64().expect("max");
            assert!(min >= 1.0, "下界不低于初值 1");
            assert!(max <= MAX_SAFE_INTEGER_F64, "上界不超过 MAX_SAFE_INTEGER");
            assert!(max >= min, "区间收敛不自交");
        }
        let minimum = &observers["inactiveMinimum"];
        assert!(minimum.is_object(), "闲置观察不依赖触发器形态");
        assert!(minimum["hp"].as_f64().expect("hp") >= 1.0);
        assert!(minimum["mp"].as_f64().expect("mp") >= 1.0);
    }

    #[test]
    fn observers_invalid_trigger_shape_nulls_threshold_ranges_only() {
        let (mut options, mut player) = early_stop_production_options(None);
        options.simulation_time_limit = 10.0 * ONE_SECOND;
        let mut bad = observer_trigger_food(
            "/items/donut",
            "/combat_trigger_conditions/missing_hp",
            // value=-1 使 less_than_equal 恒假（缺口恒 >= 0）：非 gte 形态走通用
            // is_active 路径且永不触发，避免冷却 0 的食物在满血下无限使用。
            -1.0,
        );
        bad.triggers[0].comparator_hrid =
            intern_hrid("/combat_trigger_comparators/less_than_equal");
        player.food = vec![Some(bad)];
        options.observers = Some(ObserverSpec { watch_hrid: intern_hrid("player1") });

        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");

        let observers = simulator.observers_output();
        assert!(observers["thresholdRanges"].is_null(), "形态不匹配 → 阈值段 null");
        assert!(observers["inactiveMinimum"].is_object(), "闲置观察仍有效");
    }

    #[test]
    fn observers_output_null_without_spec() {
        let (mut options, player) = early_stop_production_options(None);
        options.simulation_time_limit = 5.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        assert!(simulator.observers_output().is_null());
    }

    // -----------------------------------------------------------------------
    // 切片 20：成本上界观察器（等价 JS observeFoodOptimizerCostBound）
    // -----------------------------------------------------------------------

    #[test]
    fn cost_bound_stops_after_real_food_use_and_reports_partial_time() {
        // 与 JS `food optimizer in-round cost pruning` 用例同构：cutoff=0 → 首次真实
        // 食物使用后立即剪枝。cooldown 0 + 阈值 1 的食物保证极早期消费。
        let (mut options, mut player) = early_stop_production_options(None);
        options.simulation_time_limit = 60.0 * ONE_SECOND;
        // 默认脆皮怪会被玩家 1ms 攻速在首击前秒杀 → 玩家 HP 永不下降 →
        // 食物永不消费；换打不死强怪并抬玩家血量（见 unkillable_enemy_template）。
        player.levels =
            Some(LevelsSpec { stamina_level: Some(10_000.0), ..Default::default() });
        options.encounter_templates = vec![unkillable_enemy_template()];
        player.food = vec![Some(observer_trigger_food(
            "/items/donut",
            "/combat_trigger_conditions/missing_hp",
            1.0,
        ))];
        options.cost_bound = Some(CostBoundSpec {
            watch_hrid: intern_hrid("player1"),
            cutoff: 0.0,
            completed_cost_per_hour: 0.0,
            total_rounds: 3.0,
            prices: vec![("/items/donut".to_string(), 10.0)],
        });

        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");

        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["stoppedEarly"], serde_json::json!(true));
        assert!(
            result["simulatedTime"].as_f64().expect("time") < options.simulation_time_limit,
            "成本剪枝必须留下部分时间"
        );
        assert!(
            result["consumablesUsed"]["player1"]["/items/donut"]
                .as_f64()
                .expect("food use recorded")
                > 0.0
        );

        let cost = simulator.cost_bound_output();
        assert_eq!(cost["stoppedForCost"], serde_json::json!(true));
        let lower = cost["costLowerBound"].as_f64().expect("lower bound exported");
        // (0 + 10×uses/小时)/3 —— uses ≥ 1 → 下界必然为正。
        assert!(lower > 0.0);
    }

    #[test]
    fn cost_bound_runs_to_limit_under_unreachable_cutoff() {
        // cutoff 极大 → 永不剪枝；输出仍导出有限下界，stoppedForCost=false。
        let (mut options, mut player) = early_stop_production_options(None);
        options.simulation_time_limit = 20.0 * ONE_SECOND;
        // 同上：换打不死强怪（否则食物永不消费，重算路径永远不被走到），
        // 确保本用例真正覆盖「dirty → recompute → 下界仍低于 1e12 → 不剪枝」。
        player.levels =
            Some(LevelsSpec { stamina_level: Some(10_000.0), ..Default::default() });
        options.encounter_templates = vec![unkillable_enemy_template()];
        player.food = vec![Some(observer_trigger_food(
            "/items/donut",
            "/combat_trigger_conditions/missing_hp",
            1.0,
        ))];
        options.cost_bound = Some(CostBoundSpec {
            watch_hrid: intern_hrid("player1"),
            cutoff: 1e12,
            completed_cost_per_hour: 0.0,
            total_rounds: 3.0,
            prices: vec![("/items/donut".to_string(), 10.0)],
        });

        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");

        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["stoppedEarly"], serde_json::json!(false));
        assert_eq!(result["simulatedTime"].as_f64().expect("time"), options.simulation_time_limit);
        let cost = simulator.cost_bound_output();
        assert_eq!(cost["stoppedForCost"], serde_json::json!(false));
        assert!(cost["costLowerBound"].as_f64().expect("finite lower bound").is_finite());
    }

    #[test]
    fn cost_bound_invalid_spec_or_missing_player_keeps_null_output() {
        // 安装守卫（totalRounds=0 → try_new None）与监视单位未出场 → 输出 null，
        // 模拟照常跑满（等价 JS 不装观察器）。
        let (mut options, player) = early_stop_production_options(None);
        options.simulation_time_limit = 5.0 * ONE_SECOND;
        options.cost_bound = Some(CostBoundSpec {
            watch_hrid: intern_hrid("player1"),
            cutoff: 0.0,
            completed_cost_per_hour: 0.0,
            total_rounds: 0.0,
            prices: vec![("/items/donut".to_string(), 10.0)],
        });
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        assert!(simulator.cost_bound_output().is_null(), "非法 spec → 不激活");

        let (mut options, player) = early_stop_production_options(None);
        options.simulation_time_limit = 5.0 * ONE_SECOND;
        options.cost_bound = Some(CostBoundSpec {
            watch_hrid: intern_hrid("/players/ghost"),
            cutoff: 0.0,
            completed_cost_per_hour: 0.0,
            total_rounds: 3.0,
            prices: vec![("/items/donut".to_string(), 10.0)],
        });
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        assert!(simulator.cost_bound_output().is_null(), "监视单位未出场 → 不激活");
    }

    #[test]
    fn cost_bound_failure_takes_priority_over_cost_stop() {
        // earlyStop 与 costBound 并存：空蓝（真实失败）与成本同事件触发时，失败优先
        //（等价 JS hasFailed 短路），stoppedForCost 必须保持 false。
        let (mut options, mut player) = early_stop_production_options(None);
        options.simulation_time_limit = 20.0 * ONE_SECOND;
        player.food = vec![Some(observer_trigger_food(
            "/items/donut",
            "/combat_trigger_conditions/missing_hp",
            1.0,
        ))];
        // 0 蓝玩家：无法施法（无技能）但触发不了空蓝——改用死亡预算监视怪物：
        // 玩家速杀怪物（HP 低），deathLimit=0 → 首杀即停，成本分支永不被求值。
        options.early_stop = Some(EarlyStopSpec {
            watch_hrid: intern_hrid("/monsters/dummy"),
            death_limit: Some(0.0),
        });
        options.cost_bound = Some(CostBoundSpec {
            watch_hrid: intern_hrid("player1"),
            cutoff: 0.0,
            completed_cost_per_hour: 0.0,
            total_rounds: 3.0,
            prices: vec![("/items/donut".to_string(), 10.0)],
        });

        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");

        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["stoppedEarly"], serde_json::json!(true));
        assert!(
            result["deaths"]["/monsters/dummy"].as_f64().expect("monster death recorded") >= 1.0
        );
        let cost = simulator.cost_bound_output();
        assert_eq!(
            cost["stoppedForCost"],
            serde_json::json!(false),
            "真实失败优先：成本分支被短路，stoppedForCost 保持 false"
        );
    }

    // -----------------------------------------------------------------------
    // 切片 14：full-result 生产路径（经验记账 / 掉落上下文桶 / 时序快照 / 激怒层数）
    // -----------------------------------------------------------------------

    /// full-result 生产场景：`minimal_result=false`，并刻意把战斗日志与可视化两条
    /// 旧闸门打开（切片 14 已解除，必须能直接跑通）。玩家带经验/掉落面板与等级差惩罚。
    fn full_result_production_options() -> (SimulatorOptions, UnitSpec) {
        let player = UnitSpec {
            hrid: "player1".to_string(),
            is_player: true,
            levels: Some(LevelsSpec { stamina_level: Some(100.0), ..Default::default() }),
            combat_stats: vec![
                ("attackInterval".to_string(), 1_000_000.0),
                ("combatDropRate".to_string(), 0.5),
                ("combatRareFind".to_string(), 0.25),
                ("combatDropQuantity".to_string(), 2.0),
            ],
            combat_stats_strings: vec![
                ("primaryTraining".to_string(), "/skills/melee".to_string()),
                ("focusTraining".to_string(), "/skills/melee".to_string()),
                ("combatStyleHrid".to_string(), "/combat_styles/smash".to_string()),
            ],
            debuff_on_level_gap: -0.25,
            ..Default::default()
        };
        let enemy = UnitSpec {
            hrid: "/monsters/dummy".to_string(),
            is_player: false,
            levels: Some(LevelsSpec { defense_level: Some(1.0), ..Default::default() }),
            experience: 1_000.0,
            ..Default::default()
        };
        let options = SimulatorOptions {
            seed: 11,
            simulation_time_limit: 30.0 * ONE_SECOND,
            zone_present: true,
            real_result: true,
            minimal_result: false,
            zone_hrid: Some("/actions/combat/full_result_test".to_string()),
            zone_monster_spawn_info: Some(serde_json::json!({
                "randomSpawnInfo": {
                    "maxSpawnCount": 1,
                    "maxTotalStrength": 1,
                    "spawns": [
                        { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0, "rate": 1, "strength": 1 }
                    ]
                },
                "bossSpawns": null,
                "battlesPerBoss": 0
            })),
            encounter_templates: vec![TemplateSpec {
                hrid: "/monsters/dummy".to_string(),
                difficulty_tier: 0.0,
                spec: enemy,
            }],
            combat_style_skill_exp_map: vec![(
                "/combat_styles/smash".to_string(),
                vec!["/skills/melee".to_string()],
            )],
            log_combat_events: true,
            enable_hp_mp_visualization: true,
            ..Default::default()
        };
        (options, player)
    }

    #[test]
    fn full_result_records_experience_and_drop_context_buckets() {
        let (options, player) = full_result_production_options();
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        let kills = result["deaths"]["/monsters/dummy"]
            .as_f64()
            .expect("场景必须真的产生怪物死亡");
        assert!(kills > 0.0);
        assert!(result["encounters"].as_f64().expect("encounters") > 0.0);

        // 经验：total = 1000（enrageTime=0 → 倍率 1.0），focus 命中风格表 → melee 独占 1.0 倍率；
        // debuffOnLevelGap=-0.25 → 每次提交 1000 * 1 * (1 - 0.25) = 750。
        let gains = &result["experienceGained"]["player1"];
        assert_eq!(gains["melee"].as_f64(), Some(750.0 * kills), "逐次提交的 melee 经验累加");
        for skill in ["stamina", "intelligence", "attack", "defense", "ranged", "magic"] {
            assert_eq!(gains[skill].as_f64(), Some(0.0), "零倍率技能 {skill} 保持 0");
        }

        // 掉落桶：倍率取玩家结算面板，档位取模板 finalTier（0），等级差惩罚随桶记录。
        let bucket = &result["dropContextBuckets"]["player1"]["/monsters/dummy"][0];
        assert_eq!(bucket["killCount"].as_f64(), Some(kills));
        assert_eq!(bucket["difficultyTier"].as_f64(), Some(0.0));
        assert_eq!(bucket["dropRateMultiplier"].as_f64(), Some(1.5));
        assert_eq!(bucket["rareFindMultiplier"].as_f64(), Some(1.25));
        assert_eq!(bucket["combatDropQuantity"].as_f64(), Some(2.0));
        assert_eq!(bucket["debuffOnLevelGap"].as_f64(), Some(-0.25));

        // 收尾快照：等级差惩罚写入 debuffOnLevelGap 表；无激怒怪 → 层数 0。
        assert_eq!(result["debuffOnLevelGap"]["player1"].as_f64(), Some(-0.25));
        assert_eq!(result["maxEnrageStack"].as_f64(), Some(0.0));
    }

    #[test]
    fn full_result_tracks_max_enrage_stack_for_surviving_enemies() {
        let (mut options, player) = full_result_production_options();
        options.simulation_time_limit = 250.0 * ONE_SECOND;
        // 高血量 + 60s 激怒时间：敌人打不死，遭遇战持续到 240s 的第 4 次激怒 tick
        //（nowStack = min(10, floor(encounterTime / enrageTime))，encounterTime 从 60s 起）。
        options.encounter_templates[0].spec.combat_stats = vec![("maxHitpoints".to_string(), 1e18)];
        options.encounter_templates[0].spec.enrage_time = 60.0 * ONE_SECOND;

        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(result["maxEnrageStack"].as_f64(), Some(4.0));
        assert!(result["deaths"].get("/monsters/dummy").is_none(), "敌人必须存活到时限");
    }

    #[test]
    fn full_result_time_series_follows_visualization_flag() {
        let (mut options, player) = full_result_production_options();
        // 20s / attackInterval=1ms → 约 2 万个事件，必然跨过 20 次 1000 事件边界。
        options.simulation_time_limit = 20.0 * ONE_SECOND;
        options.encounter_templates[0].spec.combat_stats = vec![("maxHitpoints".to_string(), 1e18)];

        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let series = simulator.tally.real.as_ref().expect("real result").to_value()["timeSeriesData"].clone();
        let timestamps = series["timestamps"].as_array().expect("timestamps").clone();
        assert!(timestamps.len() >= 10, "20s 内应采集多次（实际 {}）", timestamps.len());
        let player_series = &series["players"]["player1"];
        for key in ["hp", "mp", "maxHp", "maxMp"] {
            let values = player_series[key].as_array().expect(key);
            assert_eq!(values.len(), timestamps.len(), "{key} 与时间戳一一对应");
            assert!(values.iter().all(|value| value.is_number() || value.is_null()));
        }
        for window in timestamps.windows(2) {
            assert!(window[0].as_f64().unwrap() < window[1].as_f64().unwrap(), "时间戳严格递增");
        }

        // 关闭可视化后同一场景不再采集（闸门只影响采集，不影响事件流）。
        options.enable_hp_mp_visualization = false;
        let mut plain = CombatSimulator::new(options.clone());
        plain.add_player(&player).expect("player builds");
        plain.simulate().expect("simulate succeeds");
        let plain_result = plain.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(plain_result["timeSeriesData"]["timestamps"].as_array().expect("timestamps").len(), 0);
        assert_eq!(simulator.event_count, plain.event_count, "开关不改变事件流");
    }

    // -----------------------------------------------------------------------
    // 切片 15：副本（dungeon）波次 / 团灭 / 收尾聚合
    // -----------------------------------------------------------------------

    /// 小副本生产场景：maxWaves=3、波次 1..3 全为固定怪（固定分支不消耗随机数），
    /// `randomSpawnInfoMap` 仅作兜底。玩家高血量 + 1ms 攻速：清波快且不会被反杀。
    fn dungeon_production_options() -> (SimulatorOptions, UnitSpec) {
        let player = UnitSpec {
            hrid: "player1".to_string(),
            is_player: true,
            levels: Some(LevelsSpec { stamina_level: Some(10_000.0), ..Default::default() }),
            combat_stats: vec![("attackInterval".to_string(), 1_000_000.0)],
            combat_stats_strings: vec![("combatStyleHrid".to_string(), "/combat_styles/smash".to_string())],
            ..Default::default()
        };
        let enemy = UnitSpec {
            hrid: "/monsters/dummy".to_string(),
            is_player: false,
            levels: Some(LevelsSpec { defense_level: Some(1.0), ..Default::default() }),
            ..Default::default()
        };
        let options = SimulatorOptions {
            seed: 15,
            simulation_time_limit: 30.0 * ONE_SECOND,
            zone_present: true,
            real_result: true,
            minimal_result: false,
            zone_hrid: Some("/actions/combat/dungeon_test".to_string()),
            zone_is_dungeon: true,
            zone_monster_spawn_info: Some(serde_json::json!({
                "randomSpawnInfo": {
                    "maxSpawnCount": 1,
                    "maxTotalStrength": 1,
                    "spawns": [
                        { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0, "rate": 1, "strength": 1 }
                    ]
                },
                "bossSpawns": null,
                "battlesPerBoss": 0
            })),
            zone_dungeon_spawn_info: Some(serde_json::json!({
                "maxWaves": 3,
                "fixedSpawnsMap": {
                    "1": [ { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0 } ],
                    "2": [ { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0 } ],
                    "3": [ { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0 } ]
                },
                "randomSpawnInfoMap": {
                    "0": {
                        "maxSpawnCount": 1,
                        "maxTotalStrength": 1,
                        "spawns": [
                            { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0, "rate": 1, "strength": 1 }
                        ]
                    }
                }
            })),
            encounter_templates: vec![TemplateSpec {
                hrid: "/monsters/dummy".to_string(),
                difficulty_tier: 0.0,
                spec: enemy,
            }],
            combat_style_skill_exp_map: vec![(
                "/combat_styles/smash".to_string(),
                vec!["/skills/melee".to_string()],
            )],
            log_combat_events: false,
            ..Default::default()
        };
        (options, player)
    }

    #[test]
    fn dungeon_waves_advance_and_finalize_summary() {
        let (options, player) = dungeon_production_options();
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(result["isDungeon"], serde_json::json!(true));
        assert!(
            result["dungeonsCompleted"].as_f64().expect("dungeonsCompleted") >= 1.0,
            "30s 内至少完成一个副本（清空 3 波）"
        );
        assert_eq!(result["maxWaveReached"].as_f64(), Some(3.0), "完成过整副本 → maxWaves");
        assert!(
            result["lastDungeonFinishTime"].as_f64().expect("lastDungeonFinishTime") > 0.0,
            "副本完成瞬间写入时间戳"
        );
        assert_eq!(result["dungeonsFailed"].as_f64(), Some(0.0), "高血量玩家不应失败");

        // 每波开波记 true、清波记 false → count >= 1。
        let waves = result["timeSpentAlive"].as_array().expect("timeSpentAlive");
        for wave_name in ["#1", "#2", "#3"] {
            let entry = waves
                .iter()
                .find(|entry| entry["name"] == wave_name)
                .unwrap_or_else(|| panic!("缺少波次条目 {wave_name}"));
            assert!(
                entry["count"].as_f64().expect("count") >= 1.0,
                "{wave_name} 至少完整结束过一次"
            );
        }

        // bossSpawns：fixedSpawnsMap 按数值升序输出 `#<wave>,<hrid>`；普通 boss 列表为空。
        let boss_spawns = result["bossSpawns"].as_array().expect("bossSpawns");
        assert_eq!(
            boss_spawns,
            &vec![
                serde_json::json!("#1,/monsters/dummy"),
                serde_json::json!("#2,/monsters/dummy"),
                serde_json::json!("#3,/monsters/dummy"),
            ]
        );
    }

    #[test]
    fn dungeon_max_wave_reached_counts_partial_waves() {
        let (mut options, player) = dungeon_production_options();
        // 2s：只来得及清第 1 波（第 2 波要等 3s 的敌人重生间隔）。
        options.simulation_time_limit = 2.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(
            result["dungeonsCompleted"].as_f64(),
            Some(0.0),
            "时限内未完成整副本 → 走逐波计数分支"
        );
        assert_eq!(result["maxWaveReached"].as_f64(), Some(1.0), "只完整结束 #1");
        assert_eq!(
            result["lastDungeonFinishTime"].as_f64(),
            Some(0.0),
            "未打完副本不记完成时间"
        );
    }

    #[test]
    fn dungeon_wipe_schedules_combat_start_and_counts_failure() {
        let (options, player) = dungeon_production_options();
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");

        // 手动引导开局（等价 `simulate` 的前导段），避免依赖伤害平衡来制造团灭。
        simulator.reset();
        let id = simulator.take_event_id();
        simulator.queue.add_event(SimEvent::CombatStart { time: 0.0, id });
        let event = simulator.queue.get_next_event().expect("combat start queued");
        simulator.process_event(event).expect("combat start processes");
        assert!(simulator.enemies.is_some(), "开波后应有敌人");

        // 打死全队（敌人存活）→ 走副本团灭分支。
        for player_id in simulator.players.clone() {
            simulator.arena.get_mut(player_id).combat_details.current_hitpoints = 0.0;
        }
        let ended = simulator.check_encounter_end().expect("check succeeds");
        assert!(ended, "全队死亡必须结束遭遇战");
        assert!(simulator.all_players_dead);
        assert!(simulator.enemies.is_none(), "团灭后 enemies 失效");

        // CombatStart 排到 RESTART_INTERVAL 之后（而不是立即重开）。
        let restart = simulator
            .queue
            .get_matching(|event| event.event_type() == Hrid::EVENT_COMBAT_START)
            .expect("团灭必须排程 CombatStart");
        let restart_time = restart.time();
        assert_eq!(restart_time, simulator.simulation_time + RESTART_INTERVAL);

        // 处理重开事件：failWave 记一次失败并重新开波。
        simulator.simulation_time = restart_time;
        simulator.process_combat_start_event(restart_time).expect("restart processes");
        assert_eq!(
            simulator.zone.as_ref().expect("zone").dungeons_failed(),
            1.0,
            "重开前记一次失败波次"
        );
        assert!(!simulator.all_players_dead);
        assert!(simulator.enemies.is_some(), "重开后重新开波");
    }

    /// 切片 19：副本 + full-result + logCombatEvents 不再被拒绝——团灭日志由引擎生成
    /// （7 个结算点写环形缓冲，团灭时快照进 `wipeEvents`；timestamp 为确定性字符串）。
    /// 怪物体力拉到极高（打不死）→ 持续普攻玩家留痕；再手动置零玩家血量制造团灭。
    #[test]
    fn dungeon_full_result_emits_wipe_events_when_logging() {
        let (mut options, player) = dungeon_production_options();
        options.log_combat_events = true;
        // 怪物模板换成打不死的高体力版（沿用 dungeon_production_options 的其余骨架）：
        // attack_level 1000 → 命中率 ≈99.8%（acc^1.4/(acc^1.4+eva^1.4)，玩家闪避 11）、
        // 攻击间隔 1s/1.5≈667ms；melee_level 1000 → 单击伤害 ≤1010 ≪ 玩家 HP 100100
        // （stamina 10000），引导窗内玩家不会被击杀 → 缓冲稳定累积，杜绝随机团灭。
        let enemy = UnitSpec {
            hrid: "/monsters/dummy".to_string(),
            is_player: false,
            levels: Some(LevelsSpec {
                stamina_level: Some(1.0e12),
                attack_level: Some(1_000.0),
                melee_level: Some(1_000.0),
                defense_level: Some(1.0),
                ..Default::default()
            }),
            combat_stats: vec![("attackInterval".to_string(), 1_000_000_000.0)],
            ..Default::default()
        };
        options.encounter_templates = vec![TemplateSpec {
            hrid: "/monsters/dummy".to_string(),
            difficulty_tier: 0.0,
            spec: enemy,
        }];
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");

        // 手动引导开局（等价 `simulate` 的前导段）。
        simulator.reset();
        let id = simulator.take_event_id();
        simulator.queue.add_event(SimEvent::CombatStart { time: 0.0, id });
        // 推进 5s：怪物普攻玩家（每次命中伤害>0 → 普攻直击日志点必然留痕）。
        // 玩家攻速 1ms → 每毫秒约 1 个攻击事件，5s ≈ 5000+ 事件；怪物首击在
        // t≈1s，迭代上限必须远大于事件数，否则永远轮不到怪物攻击事件。
        for _ in 0..50_000 {
            let Some(event) = simulator.queue.get_next_event() else { break };
            simulator.simulation_time = event.time();
            if simulator.simulation_time > 5.0 * ONE_SECOND {
                break;
            }
            simulator.process_event(event).expect("event processes");
        }
        assert!(
            simulator
                .wipe_logs
                .as_ref()
                .expect("副本 + 日志 → 缓冲启用")
                .buffer
                .len()
                > 0,
            "怪物攻击玩家必须留下日志"
        );

        // 置零玩家血量（敌人存活）→ 副本团灭分支快照日志进 simResult。
        for player_id in simulator.players.clone() {
            simulator.arena.get_mut(player_id).combat_details.current_hitpoints = 0.0;
        }
        simulator.check_encounter_end().expect("check succeeds");

        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        let events = result["wipeEvents"].as_array().expect("wipeEvents 数组");
        assert_eq!(events.len(), 1, "一次团灭 = 一个事件");
        let event = events[0].as_object().expect("事件是对象");
        assert!(event.contains_key("simulationTime"));
        assert!(event.contains_key("wave"));
        // 确定性 timestamp：`t+{simulationTime}`（UI 只用作 v-for key，不显示）。
        assert!(event["timestamp"].as_str().expect("timestamp 字符串").starts_with("t+"));
        let logs = event["logs"].as_array().expect("logs 数组");
        assert!(!logs.is_empty(), "团灭日志不能为空（怪物打玩家的过程必然留痕）");
        for log in logs {
            let log_object = log.as_object().expect("日志条目是对象");
            for key in ["time", "wave", "source", "ability", "target", "damage", "beforeHp", "afterHp", "playersHp", "isCrit"] {
                assert!(log_object.contains_key(key), "日志条目缺 {key}");
            }
            assert_eq!(log_object["source"].as_str().expect("source"), "/monsters/dummy", "伤害来源是怪");
            assert_eq!(log_object["target"].as_str().expect("target"), "player1", "被打的是玩家");
            assert!(log_object["isCrit"].is_boolean(), "isCrit 为布尔");
            let players_hp = log_object["playersHp"].as_array().expect("playersHp 数组");
            assert_eq!(players_hp.len(), 1, "单人场景的 HP 快照");
        }
        // 5s 引导窗内至少有一条普攻直击日志（怪物 autoAttack 玩家）。
        assert!(
            logs
                .iter()
                .any(|log| log["ability"] == serde_json::json!("autoAttack")),
            "普攻直击日志点必须留痕"
        );
        // 团灭后缓冲清零（JS index=0; count=0）。
        assert_eq!(simulator.wipe_logs.as_ref().expect("buffer").buffer.len(), 0, "团灭后缓冲清空");
    }

    /// 切片 19：非副本（普通区域）不启用日志缓冲——`zone?.isDungeon` 门控。
    #[test]
    fn regular_zone_with_logging_keeps_wipe_events_empty() {
        let (mut options, player) = dungeon_production_options();
        options.zone_is_dungeon = false;
        options.log_combat_events = true;
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();
        assert_eq!(result["wipeEvents"], serde_json::json!([]), "非副本恒空数组");
    }

    #[test]
    fn dungeon_minimal_result_skips_wave_timeline() {
        let (mut options, player) = dungeon_production_options();
        options.minimal_result = true;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(result["isDungeon"], serde_json::json!(true));
        // minimal 把 updateTimeSpentAlive 覆写为空操作 → 时间线恒空。
        assert_eq!(result["timeSpentAlive"].as_array().expect("timeSpentAlive").len(), 0);
        // 完成过整副本 → maxWaveReached 直接取 maxWaves。
        assert!(
            result["dungeonsCompleted"].as_f64().expect("dungeonsCompleted") >= 1.0,
            "30s 内至少完成一个副本"
        );
        assert_eq!(result["maxWaveReached"].as_f64(), Some(3.0));
        assert!(result.get("wipeEvents").is_none(), "minimal 不序列化 wipeEvents");
    }

    // -----------------------------------------------------------------------
    // 切片 16：迷宫（labyrinth）单怪循环 / 120s 超时重启 / 身份字段
    // -----------------------------------------------------------------------

    /// 迷宫生产场景：无 zone、单怪模板（difficultyTier 恒 0）、120s 超时重启。
    /// `unkillable` 时把怪物体力拉到极高，用于覆盖「打不死 → 超时重启」分支。
    fn labyrinth_production_options(unkillable: bool) -> (SimulatorOptions, UnitSpec) {
        let player = UnitSpec {
            hrid: "player1".to_string(),
            is_player: true,
            levels: Some(LevelsSpec { stamina_level: Some(10_000.0), ..Default::default() }),
            combat_stats: vec![("attackInterval".to_string(), 1_000_000.0)],
            combat_stats_strings: vec![("combatStyleHrid".to_string(), "/combat_styles/smash".to_string())],
            ..Default::default()
        };
        let enemy = UnitSpec {
            hrid: "/monsters/lab_dummy".to_string(),
            is_player: false,
            levels: Some(LevelsSpec {
                defense_level: Some(1.0),
                stamina_level: Some(if unkillable { 1.0e12 } else { 1.0 }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let options = SimulatorOptions {
            seed: 16,
            simulation_time_limit: 30.0 * ONE_SECOND,
            zone_present: false,
            real_result: true,
            minimal_result: false,
            labyrinth_present: true,
            labyrinth_name: Some("/monsters/lab_dummy".to_string()),
            labyrinth_room_level: 100.0,
            encounter_templates: vec![TemplateSpec {
                hrid: "/monsters/lab_dummy".to_string(),
                difficulty_tier: 0.0,
                spec: enemy,
            }],
            combat_style_skill_exp_map: vec![(
                "/combat_styles/smash".to_string(),
                vec!["/skills/melee".to_string()],
            )],
            log_combat_events: false,
            ..Default::default()
        };
        (options, player)
    }

    #[test]
    fn labyrinth_respawns_monsters_and_reports_identity() {
        let (options, player) = labyrinth_production_options(false);
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(result["isLabyrinth"], serde_json::json!(true));
        assert_eq!(result["labyrinthName"], serde_json::json!("/monsters/lab_dummy"));
        assert_eq!(result["roomLevel"].as_f64(), Some(100.0));
        assert_eq!(result["scrollUsage"]["ignoredReason"], serde_json::json!("labyrinth"));
        assert_eq!(result["scrollUsage"]["allowed"], serde_json::json!(false));
        assert!(result.get("zoneName").is_none(), "迷宫没有 zoneName");
        assert!(result.get("difficultyTier").is_none(), "迷宫没有难度档");

        // 单怪循环：怪物被打死后立刻重开（不等待 ENEMY_RESPAWN_INTERVAL）。
        assert!(
            result["deaths"]["/monsters/lab_dummy"].as_f64().expect("deaths") >= 2.0,
            "30s 内应击杀同一只迷宫怪多次"
        );
        let entry = result["timeSpentAlive"]
            .as_array()
            .expect("timeSpentAlive")
            .iter()
            .find(|entry| entry["name"] == "/monsters/lab_dummy")
            .expect("迷宫怪必须有存活时间线条目");
        assert!(entry["count"].as_f64().expect("count") >= 2.0, "每轮死亡记一次 count");
        assert!(result["encounters"].as_f64().expect("encounters") >= 2.0);
    }

    #[test]
    fn labyrinth_timeout_restarts_unfinished_encounter() {
        let (mut options, player) = labyrinth_production_options(true);
        options.simulation_time_limit = 130.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        // 130s 打不死（体力 1e12）：120s 超时重开把 spawnedAt 推到 120s 之后，
        // 且没有死亡记录（count 保持 0、deaths 无该怪）。
        let entry = result["timeSpentAlive"]
            .as_array()
            .expect("timeSpentAlive")
            .iter()
            .find(|entry| entry["name"] == "/monsters/lab_dummy")
            .expect("迷宫怪必须有存活时间线条目");
        assert!(
            entry["spawnedAt"].as_f64().expect("spawnedAt") >= 120.0 * 1e9,
            "120s 超时必须重开一轮遭遇（spawnedAt 推进）"
        );
        assert_eq!(entry["count"].as_f64(), Some(0.0));
        assert!(result["deaths"].get("/monsters/lab_dummy").is_none());
        assert_eq!(result["encounters"].as_f64(), Some(0.0), "超时重开不记遭遇结束");
    }

    // -----------------------------------------------------------------------
    // 切片 17：战斗卷轴（窗口开/续期/关闭、有限库存耗尽、迷宫忽略、开关禁用）
    // -----------------------------------------------------------------------

    const SCROLL_ITEM_HRID: &str = "/items/test_scroll";

    /// 卷轴 buff 输入（合成定义；level=1 不做等级并入，ratio/flat 原样注册）。
    fn scroll_test_buff(duration_ns: f64) -> RawBuffInput {
        RawBuffInput {
            unique_hrid: Some(intern_hrid("/buff_uniques/test_scroll")),
            type_hrid: Some(intern_hrid("/buff_types/damage")),
            ratio_boost: Some(0.5),
            flat_boost: Some(0.0),
            duration: Some(duration_ns),
            multiplier_for_skill_hrid: None,
            multiplier_per_skill_level: None,
            start_time: None,
        }
    }

    /// 切片 17：普通区域 + 单怪模板 + 卷轴定义/配置（合成数据，不依赖游戏数据）。
    /// `quantity` 为 `None` 表示无限库存；模拟时长由调用方给定。
    fn scroll_production_options(
        duration_ns: f64,
        quantity: Option<f64>,
        simulation_time_limit: f64,
    ) -> (SimulatorOptions, UnitSpec) {
        let player = UnitSpec {
            hrid: "player1".to_string(),
            is_player: true,
            levels: Some(LevelsSpec { stamina_level: Some(10_000.0), ..Default::default() }),
            combat_stats: vec![("attackInterval".to_string(), 1_000_000.0)],
            combat_stats_strings: vec![("combatStyleHrid".to_string(), "/combat_styles/smash".to_string())],
            combat_scrolls: vec![CombatScrollConfig { item_hrid: intern_hrid(SCROLL_ITEM_HRID), quantity }],
            ..Default::default()
        };
        let enemy = UnitSpec {
            hrid: "/monsters/dummy".to_string(),
            is_player: false,
            levels: Some(LevelsSpec { defense_level: Some(1.0), stamina_level: Some(1.0), ..Default::default() }),
            ..Default::default()
        };
        let options = SimulatorOptions {
            seed: 17,
            simulation_time_limit,
            zone_present: true,
            zone_hrid: Some("/actions/combat/test_zone".to_string()),
            zone_difficulty_tier: 0.0,
            zone_monster_spawn_info: Some(serde_json::json!({
                "randomSpawnInfo": {
                    "maxSpawnCount": 1,
                    "maxTotalStrength": 1,
                    "spawns": [
                        { "combatMonsterHrid": "/monsters/dummy", "difficultyTier": 0, "rate": 1, "strength": 1 }
                    ]
                },
                "bossSpawns": null,
                "battlesPerBoss": 0
            })),
            real_result: true,
            minimal_result: false,
            encounter_templates: vec![TemplateSpec {
                hrid: "/monsters/dummy".to_string(),
                difficulty_tier: 0.0,
                spec: enemy,
            }],
            combat_style_skill_exp_map: vec![(
                "/combat_styles/smash".to_string(),
                vec!["/skills/melee".to_string()],
            )],
            combat_scrolls_enabled: true,
            combat_scroll_definitions: vec![CombatScrollDefinition {
                item_hrid: SCROLL_ITEM_HRID.to_string(),
                duration_ns,
                buff: scroll_test_buff(duration_ns),
            }],
            log_combat_events: false,
            ..Default::default()
        };
        (options, player)
    }

    #[test]
    fn combat_scrolls_open_renew_and_finalize_semi_open_windows() {
        let duration = 20.0 * ONE_SECOND;
        let limit = 45.0 * ONE_SECOND;
        let (options, player) = scroll_production_options(duration, None, limit);
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        let entry = &result["scrollUsage"]["byPlayer"]["player1"][SCROLL_ITEM_HRID];
        assert_eq!(
            entry["openedCount"].as_f64(),
            Some(3.0),
            "45s 内应开 3 个 20s 窗口（[0,20) [20,40) [40,45)）"
        );
        assert_eq!(
            entry["activeDurationNs"].as_f64(),
            Some(limit),
            "窗口连续覆盖整个模拟时长（半开区间在 20s/40s 边界续期）"
        );
        assert_eq!(entry["exhausted"], serde_json::json!(false));
        assert_eq!(entry["configuredQuantity"], serde_json::Value::Null, "无限库存");

        // 收尾关闭窗口后按源移除增益（finalizeScrollUsage → closeScrollWindow）。
        let unit = simulator.arena.get(simulator.players[0]);
        assert!(
            !unit.combat_buffs.contains_key(&intern_hrid("/buff_uniques/test_scroll")),
            "finalize 后卷轴增益必须已按源移除"
        );
    }

    #[test]
    fn combat_scrolls_exhaust_finite_inventory_and_stop() {
        let duration = 20.0 * ONE_SECOND;
        let limit = 90.0 * ONE_SECOND;
        let (options, player) = scroll_production_options(duration, Some(2.0), limit);
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        let entry = &result["scrollUsage"]["byPlayer"]["player1"][SCROLL_ITEM_HRID];
        assert_eq!(entry["configuredQuantity"].as_f64(), Some(2.0));
        assert_eq!(entry["openedCount"].as_f64(), Some(2.0), "库存 2 → 只开 2 个窗口");
        assert_eq!(
            entry["activeDurationNs"].as_f64(),
            Some(40.0 * ONE_SECOND),
            "两段完整窗口 [0,20) [20,40)，耗尽后不再开启"
        );
        assert_eq!(entry["exhausted"], serde_json::json!(true));
    }

    #[test]
    fn combat_scrolls_ignored_in_labyrinth_context() {
        let (mut options, mut player) = labyrinth_production_options(false);
        options.combat_scrolls_enabled = true;
        options.combat_scroll_definitions = vec![CombatScrollDefinition {
            item_hrid: SCROLL_ITEM_HRID.to_string(),
            duration_ns: 20.0 * ONE_SECOND,
            buff: scroll_test_buff(20.0 * ONE_SECOND),
        }];
        player.combat_scrolls = vec![CombatScrollConfig { item_hrid: intern_hrid(SCROLL_ITEM_HRID), quantity: None }];

        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(result["scrollUsage"]["allowed"], serde_json::json!(false));
        assert_eq!(result["scrollUsage"]["ignoredReason"], serde_json::json!("labyrinth"));
        assert_eq!(result["scrollUsage"]["disabled"], serde_json::json!(false));
        let entry = &result["scrollUsage"]["byPlayer"]["player1"][SCROLL_ITEM_HRID];
        assert_eq!(entry["openedCount"].as_f64(), Some(0.0), "迷宫内不得开启卷轴");
        assert_eq!(entry["activeDurationNs"].as_f64(), Some(0.0));
        assert_eq!(entry["configuredQuantity"], serde_json::Value::Null, "配置行保留");
    }

    #[test]
    fn combat_scrolls_disabled_keeps_rows_without_opening() {
        let duration = 20.0 * ONE_SECOND;
        let limit = 45.0 * ONE_SECOND;
        let (mut options, player) = scroll_production_options(duration, Some(3.0), limit);
        options.combat_scrolls_enabled = false;
        let mut simulator = CombatSimulator::new(options.clone());
        simulator.add_player(&player).expect("player builds");
        simulator.simulate().expect("simulate succeeds");
        let result = simulator.tally.real.as_ref().expect("real result").to_value();

        assert_eq!(result["scrollUsage"]["disabled"], serde_json::json!(true));
        let entry = &result["scrollUsage"]["byPlayer"]["player1"][SCROLL_ITEM_HRID];
        assert_eq!(entry["configuredQuantity"].as_f64(), Some(3.0), "开关关闭时配置行保留");
        assert_eq!(entry["openedCount"].as_f64(), Some(0.0));
        assert_eq!(entry["activeDurationNs"].as_f64(), Some(0.0));
        assert_eq!(entry["exhausted"], serde_json::json!(false));
    }

    // ------------------------------------------------------------------
    // 切片 26：重生路径死槽位复用
    // ------------------------------------------------------------------

    /// `Vec::swap_remove` 重映射的纯函数契约：只有末位换入者被改写下标（无 -1 平移）。
    #[test]
    fn remap_slot_after_release_only_moves_the_swapped_unit() {
        assert_eq!(remap_slot_after_release(7, 2, 7), 2, "末位换入者映射到被移除下标");
        assert_eq!(remap_slot_after_release(5, 2, 7), 5, "中间下标一律不变");
        assert_eq!(remap_slot_after_release(2, 2, 7), 2);
        assert_eq!(remap_slot_after_release(7, 7, 7), 7, "移除末位时恒等");
    }

    /// 移除槽位：末位单位换入 + 全部 UnitId 持有者重映射 + 引用被移除槽位的事件被清、
    /// 引用玩家的事件保留（清场路径不 panic）。
    #[test]
    fn remove_slot_or_degrade_remaps_swapped_unit_and_all_tables() {
        let (options, player) = full_result_production_options();
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");
        // 槽位布局：0=玩家、1=无关单位、2=待移除、3=末位（被换入 2）。
        simulator.arena.push(CombatUnit { hrid: intern_hrid("/monsters/other"), ..Default::default() });
        let removed = simulator.arena.push(CombatUnit { hrid: intern_hrid("/monsters/removed"), ..Default::default() });
        let moved = simulator.arena.push(CombatUnit { hrid: intern_hrid("/monsters/moved"), ..Default::default() });
        simulator.enemies = Some(vec![moved]);
        simulator.observer_unit = Some(moved);
        simulator.cost_bound_unit = Some(moved);
        simulator.pool_by_key.set("k".to_string(), vec![moved]);
        simulator.pending_experience_gains.push((moved, Vec::new()));
        simulator.enemy_death_snapshots = vec![None, None, None, Some((moved, 1.0, Vec::new()))];
        simulator.experience_awarded = vec![false, false, false, true];
        simulator.scroll_runtime.push(ScrollState {
            player_id: moved,
            player_hrid: intern_hrid("player1"),
            item_hrid: intern_hrid("/items/test_scroll"),
            configured_quantity: None,
            remaining: None,
            started: false,
            active: false,
            active_start_time: 0.0,
            active_until: 0.0,
            accumulated_duration_ns: 0.0,
            token: 0.0,
            buff_unique_hrid: Hrid::EMPTY,
            definition_index: 0,
        });
        // 引用被移除槽位的事件（应被清掉）+ 引用玩家的事件（应保留）。
        simulator.queue.add_event(SimEvent::AutoAttack { time: 1.0, id: 1, source: removed });
        simulator.queue.add_event(SimEvent::AwaitCooldown { time: 2.0, id: 2, source: removed });
        simulator.queue.add_event(SimEvent::AutoAttack { time: 3.0, id: 3, source: 0 });

        assert!(simulator.remove_slot_or_degrade(removed), "前置条件满足时必须移除成功");
        assert_eq!(simulator.arena.len(), 3);
        assert_eq!(
            simulator.arena.get(removed).hrid,
            intern_hrid("/monsters/moved"),
            "末位单位换入被移除下标"
        );
        assert_eq!(simulator.enemies, Some(vec![removed]), "敌人列表重映射 moved → removed");
        assert_eq!(simulator.observer_unit, Some(removed));
        assert_eq!(simulator.cost_bound_unit, Some(removed));
        assert_eq!(simulator.pool_by_key.get_str("k"), Some(&vec![removed]), "池内下标同步重映射");
        assert_eq!(simulator.pending_experience_gains, vec![(removed, Vec::new())]);
        assert_eq!(
            simulator.enemy_death_snapshots[removed].as_ref().map(|entry| entry.0),
            Some(removed),
            "死亡快照随槽位换位且内部下标重映射"
        );
        assert!(simulator.is_experience_awarded(removed), "颁奖标记随槽位换位");
        assert!(!simulator.experience_awarded[3], "原末位下标复位");
        assert_eq!(simulator.scroll_runtime[0].player_id, removed);
        assert_eq!(simulator.queue.len(), 1, "只清掉引用被移除槽位的事件");
        assert_eq!(
            simulator.queue.peek_next_event().map(|event| event.id()),
            Some(3),
            "引用玩家的事件必须保留"
        );
    }

    /// 降级路径：前置条件不满足时不得移除（返回 false、状态不变、事件不清）。
    #[test]
    fn remove_slot_or_degrade_keeps_state_when_preconditions_fail() {
        let (options, player) = full_result_production_options();
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");

        // ① 玩家槽位不可移除。
        assert!(!simulator.remove_slot_or_degrade(0));
        assert_eq!(simulator.arena.len(), 1);

        // ② 末位是玩家（合成场景）时，移除更早的敌人槽位必须降级。
        simulator.arena.push(CombatUnit { hrid: intern_hrid("/monsters/a"), ..Default::default() });
        simulator.arena.push(CombatUnit { hrid: intern_hrid("/players/second"), is_player: true, ..Default::default() });
        assert!(!simulator.remove_slot_or_degrade(1));
        assert_eq!(simulator.arena.len(), 3, "降级时竞技场不变");

        // ③ 槽位仍在敌人列表时降级。
        let mut listed = CombatSimulator::new(full_result_production_options().0);
        listed.add_player(&player).expect("player builds");
        let enemy = listed.arena.push(CombatUnit { hrid: intern_hrid("/monsters/listed"), ..Default::default() });
        listed.arena.push(CombatUnit { hrid: intern_hrid("/monsters/tail"), ..Default::default() });
        listed.enemies = Some(vec![enemy]);
        assert!(!listed.remove_slot_or_degrade(enemy));
        assert_eq!(listed.arena.len(), 3);

        // ④ 末位单位被队列事件引用时降级（槽位收缩会让事件下标悬空）。
        let mut referenced = CombatSimulator::new(full_result_production_options().0);
        referenced.add_player(&player).expect("player builds");
        referenced.arena.push(CombatUnit { hrid: intern_hrid("/monsters/removed"), ..Default::default() });
        let tail = referenced.arena.push(CombatUnit { hrid: intern_hrid("/monsters/referenced"), ..Default::default() });
        referenced.queue.add_event(SimEvent::AutoAttack { time: 1.0, id: 1, source: tail });
        assert!(!referenced.remove_slot_or_degrade(1));
        assert_eq!(referenced.arena.len(), 3, "降级时竞技场不变");
        assert_eq!(referenced.queue.len(), 1, "降级不得清掉事件");
    }

    /// 等价性双跑：同一重生密集型场景在「复用开 / 关」下的输出必须逐字段一致
    /// （事件数、事件轨迹、调用流水、simResult 全量 JSON）。
    #[test]
    fn respawn_reuse_matches_non_reuse_round_trip() {
        let (mut options, player) = full_result_production_options();
        // 拉长到 60 秒 + 打开事件轨迹：足够多次遭遇战/重生，轨迹逐条对账。
        options.simulation_time_limit = 60.0 * ONE_SECOND;
        options.trace_limit = 400;

        let mut reused = CombatSimulator::new(options.clone());
        reused.add_player(&player).expect("player builds");
        reused.simulate().expect("simulate succeeds");

        let mut fresh = CombatSimulator::new(options.clone());
        fresh.respawn_reuse_enabled = false;
        fresh.add_player(&player).expect("player builds");
        fresh.simulate().expect("simulate succeeds");

        // 60 秒 / 3 秒重生间隔 ≈ 20 次遭遇战：除首怪外全部命中池中槽位（实测 hits=19、misses=1）。
        assert!(reused.pool_reuse_hits >= 10, "场景必须真的发生重生槽位复用");
        assert_eq!(fresh.pool_reuse_hits, 0, "对照组不得复用");
        assert!(reused.pool_build_misses > 0, "首怪必须走新建路径");
        assert_eq!(reused.event_count, fresh.event_count, "事件数必须一致");
        assert_eq!(reused.trace.len(), fresh.trace.len());
        assert_eq!(reused.trace, fresh.trace, "事件轨迹必须逐条一致");
        assert_eq!(reused.tally.calls, fresh.tally.calls);
        assert_eq!(
            reused.tally.real.as_ref().map(|real| real.to_value()),
            fresh.tally.real.as_ref().map(|real| real.to_value()),
            "simResult 必须逐字段一致"
        );
    }

    /// 池命中随轮次增加：第二轮起步即命中池中槽位，竞技场规模不随重生累积。
    #[test]
    fn respawn_pool_reuses_slots_across_rounds() {
        let (mut options, player) = full_result_production_options();
        options.simulation_time_limit = 60.0 * ONE_SECOND;
        let mut simulator = CombatSimulator::new(options);
        simulator.add_player(&player).expect("player builds");

        simulator.simulate().expect("round one");
        let first_round_hits = simulator.pool_reuse_hits;
        assert!(first_round_hits > 0, "首轮内就必须发生槽位复用");

        simulator.simulate().expect("round two");
        assert!(simulator.pool_reuse_hits > first_round_hits, "第二轮继续命中池中槽位");
        assert!(
            simulator.pool_build_misses <= 5,
            "只有最初若干次刷怪走新建（m={}）",
            simulator.pool_build_misses
        );
        assert!(simulator.arena.len() <= 6, "竞技场不得随重生累积（len={}）", simulator.arena.len());
    }
}
