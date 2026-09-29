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
};
use crate::consumable::Consumable;
use crate::event_queue::{EventQueue, QueueItem};
use crate::ordered_map::OrderedMap;
use crate::rng::Mulberry32;
use crate::sim_events::SimEvent;
use crate::sim_unit::{UnitArena, UnitId};
use crate::unit::{policy_name, BuffList, BuffSourceSelector, CombatUnit, RawBuffInput, UnitError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ONE_SECOND: f64 = 1e9;
pub const HOT_TICK_INTERVAL: f64 = 5.0 * ONE_SECOND;
pub const DOT_TICK_INTERVAL: f64 = 3.0 * ONE_SECOND;
pub const REGEN_TICK_INTERVAL: f64 = 10.0 * ONE_SECOND;
pub const ENEMY_RESPAWN_INTERVAL: f64 = 3.0 * ONE_SECOND;
pub const PLAYER_RESPAWN_INTERVAL: f64 = 150.0 * ONE_SECOND;
pub const RESTART_INTERVAL: f64 = 3.0 * ONE_SECOND;
pub const ENRAGE_TICK_INTERVAL: f64 = 60.0 * ONE_SECOND;
pub const CURSE_UNIQUE_HRID: &str = "/buff_uniques/curse";
pub const WEAKEN_UNIQUE_HRID: &str = "/buff_uniques/weaken";
pub const FURY_ACCURACY_UNIQUE_HRID: &str = "/buff_uniques/fury_accuracy";
pub const FURY_DAMAGE_UNIQUE_HRID: &str = "/buff_uniques/fury_damage";
pub const ATTACK_EVENT_TYPES: [&str; 2] = ["abilityCastEndEvent", "autoAttack"];

const CURSE_EXPIRE_TIME: f64 = 15_000_000_000.0;
const FURY_EXPIRE_TIME: f64 = 15_000_000_000.0;
const WEAKEN_EXPIRE_TIME: f64 = 15_000_000_000.0;
const MAX_FURY_STACK: f64 = 5.0;
const MAX_ENRAGE_STACK: f64 = 10.0;

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

    pub fn add_death(&mut self, hrid: &str) {
        if let Some(real) = self.real.as_mut() {
            real.add_death(hrid);
            return;
        }
        self.push("addDeath", vec![json!(hrid)]);
    }

    pub fn add_attack(&mut self, source_hrid: &str, target_hrid: &str, ability: &str, outcome: AttackOutcome) {
        if let Some(real) = self.real.as_mut() {
            real.add_attack(source_hrid, target_hrid, ability, &outcome);
            return;
        }
        self.push(
            "addAttack",
            vec![json!(source_hrid), json!(target_hrid), json!(ability), outcome.to_value()],
        );
    }

    pub fn add_hitpoints_gained(&mut self, hrid: &str, source_hrid: &str, amount: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_hitpoints_gained(hrid, source_hrid, amount);
            return;
        }
        self.push("addHitpointsGained", vec![json!(hrid), json!(source_hrid), json!(amount)]);
    }

    pub fn add_manapoints_gained(&mut self, hrid: &str, source_hrid: &str, amount: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_manapoints_gained(hrid, source_hrid, amount);
            return;
        }
        self.push("addManapointsGained", vec![json!(hrid), json!(source_hrid), json!(amount)]);
    }

    pub fn add_hitpoints_spent(&mut self, hrid: &str, source_hrid: &str, amount: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_hitpoints_spent(hrid, source_hrid, amount);
            return;
        }
        self.push("addHitpointsSpent", vec![json!(hrid), json!(source_hrid), json!(amount)]);
    }

    pub fn add_ran_out_of_mana_count(&mut self, hrid: &str, ran_out: bool, time: f64) {
        if let Some(real) = self.real.as_mut() {
            real.add_ran_out_of_mana_count(hrid, ran_out, time);
            return;
        }
        self.push("addRanOutOfManaCount", vec![json!(hrid), json!(ran_out), json!(time)]);
    }

    pub fn add_consumable_use(&mut self, hrid: &str, consumable_hrid: &str) {
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
    pub fn deaths_for(&self, hrid: &str) -> f64 {
        match self.real.as_ref() {
            Some(real) => real.deaths_value(hrid),
            None => 0.0,
        }
    }

    /// `playerRanOutOfMana[hrid] === true`（缺键 / false / 探针模式都为假）。
    pub fn mana_out_for(&self, hrid: &str) -> bool {
        match self.real.as_ref() {
            Some(real) => real.player_ran_out_of_mana_value(hrid),
            None => false,
        }
    }

    /// 探针模式只记录 hrid（与 JS `ParitySimResult` 一致）；生产模式转发完整统计值。
    pub fn set_drop_rate_multipliers(
        &mut self,
        hrid: &str,
        combat_drop_rate: f64,
        combat_rare_find: f64,
        combat_drop_quantity: f64,
        debuff_on_level_gap: f64,
    ) {
        if let Some(real) = self.real.as_mut() {
            real.set_drop_rate_multipliers(
                hrid,
                1.0 + combat_drop_rate,
                1.0 + combat_rare_find,
                combat_drop_quantity,
                debuff_on_level_gap,
            );
            return;
        }
        self.push("setDropRateMultipliers", vec![json!(hrid)]);
    }

    /// 探针模式只记录 hrid；生产模式复制 `abilityManaCosts` 快照。
    pub fn set_mana_used(&mut self, hrid: &str, entries: &[(String, f64)]) {
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

    /// 生产模式专用：`simResult.lastEncounterFinishTime = time` 的直接属性写入。
    pub fn set_last_encounter_finish_time(&mut self, value: f64) {
        if let Some(real) = self.real.as_mut() {
            real.set_last_encounter_finish_time(value);
        }
    }

    /// 生产模式专用：`addTimeSeriesSnapshot`（可视化关闭时不会被调用）。
    pub fn add_time_series_snapshot(&mut self, time: f64, players: &[(String, f64, f64, f64, f64)]) {
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
    /// 该单位在 JS 侧是否由 `Player` / `Monster` 构建（类覆写会重写「类自有」面板字段）。
    /// 生产桥始终为 true；合成单位（探针）保持 false 以对齐同样合成构建的 JS 侧。
    #[serde(default)]
    pub class_owned_stats: bool,
}

/// 由场景定义构建单位（JS 侧同序：等级 → 面板 → 基准捕获 → 结算 → 技能/消耗品）。
pub fn build_unit_from_spec(spec: &UnitSpec) -> Result<CombatUnit, UnitError> {
    let _prof = crate::prof::start("unit.build_from_spec");
    let mut unit = CombatUnit { is_player: spec.is_player, ..Default::default() };
    unit.hrid = spec.hrid.clone();

    let _prof_spec_apply = crate::prof::start("unit.spec_apply");
    if let Some(levels) = &spec.levels {
        levels.apply(&mut unit);
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
    unit.two_hand_hrid = spec.two_hand_hrid.clone();
    unit.house_rooms = spec.house_rooms.clone();
    unit.guild_buffs = spec.guild_buffs.clone();
    unit.achievements = spec.achievements.clone();
    unit.zone_buffs = spec.zone_buffs.clone();
    unit.extra_buffs = spec.extra_buffs.clone();
    // 构造期永久增益：JS 侧 `permanentBuffs` 已按 typeHrid 合并，这里直接按序播种。
    for buff in &spec.permanent_buffs {
        unit.permanent_buffs.set(buff.type_hrid.clone(), buff.clone());
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

    Ok(unit)
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
    /// JS `logCombatEvents`（当前生产路径要求 false，否则回退 JS）。
    #[serde(default)]
    pub log_combat_events: bool,
    /// JS `enableHpMpVisualization`（当前生产路径要求 false）。
    #[serde(default)]
    pub enable_hp_mp_visualization: bool,
    /// JS `combatScrollsEnabled`（当前生产路径要求 false）。
    #[serde(default)]
    pub combat_scrolls_enabled: bool,
    /// JS `isGuildTrial`（为 true 时 `scrollsAllowed` 为假、卷轴上下文为 'guild_trial'）。
    #[serde(default)]
    pub is_guild_trial: bool,
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
}

/// 提前停止谓词参数（切片 12）。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlyStopSpec {
    /// 监视单位的 hrid（如 `player1`）。
    pub watch_hrid: String,
    /// 死亡上限；`None` = JS `Infinity`（不因死亡停止）。
    pub death_limit: Option<f64>,
}

/// 切片 13：观察器参数（等价 JS 侧 `observeFoodOptimizerThresholds` +
/// `observeInactiveFoodThresholds` 包装）。两者都是**纯读窥视**：不改 RNG、不改
/// 事件流、不改比较结果——只在既有代码路径旁同步记录。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverSpec {
    /// 监视单位的 hrid（食物优化器为活动玩家，如 `player1`）。
    pub watch_hrid: String,
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
            let kind = match trigger.condition_hrid.as_str() {
                "/combat_trigger_conditions/missing_hp" => "hp",
                "/combat_trigger_conditions/missing_mp" => "mp",
                _ => {
                    state.threshold_valid = false;
                    state.threshold_ranges.clear();
                    break;
                }
            };
            if trigger.dependency_hrid != "/combat_trigger_dependencies/self"
                || trigger.comparator_hrid != "/combat_trigger_comparators/greater_than_equal"
                || consumable.triggers.len() != 1
                || !is_safe_integer(trigger.value)
            {
                state.threshold_valid = false;
                state.threshold_ranges.clear();
                break;
            }
            state.threshold_ranges.push(ThresholdRange {
                hrid: consumable.hrid.clone(),
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

/// JS Number.isSafeInteger.
fn is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER_F64
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
    labyrinth_name: Option<String>,
    labyrinth_room_level: f64,
    combat_style_skill_exp_map: Vec<(String, Vec<String>)>,
    log_combat_events: bool,
    enable_hp_mp_visualization: bool,
    combat_scrolls_enabled: bool,
    player_count: usize,
    is_guild_trial: bool,
    /// 切片 12：提前停止谓词参数（`None` = 无提前停止）。
    early_stop: Option<EarlyStopSpec>,
    /// 切片 13：观察器参数与运行时状态（`None` = 不观察；state 在匹配玩家入池时初始化，
    /// reset 重建——等价 JS 每轮模拟前新装观察器）。
    observer_spec: Option<ObserverSpec>,
    observer_state: Option<ObserverState>,
    observer_unit: Option<UnitId>,
}

/// 取「第一个存活单位」：改成收 `Option<&[UnitId]>` 切片视图，调用方无需克隆单位列表。
fn first_alive_in(arena: &UnitArena, ids: Option<&[UnitId]>) -> Option<UnitId> {
    let ids = ids?;
    ids.iter()
        .copied()
        .find(|id| arena.get(*id).combat_details.current_hitpoints > 0.0)
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
            labyrinth_name: options.labyrinth_name,
            labyrinth_room_level: options.labyrinth_room_level,
            combat_style_skill_exp_map: options.combat_style_skill_exp_map,
            log_combat_events: options.log_combat_events,
            enable_hp_mp_visualization: options.enable_hp_mp_visualization,
            combat_scrolls_enabled: options.combat_scrolls_enabled,
            player_count: 0,
            is_guild_trial: options.is_guild_trial,
            early_stop: options.early_stop,
            observer_spec: options.observers,
            observer_state: None,
            observer_unit: None,
        }
    }

    pub fn add_player(&mut self, spec: &UnitSpec) -> Result<UnitId, UnitError> {
        let unit = build_unit_from_spec(spec)?;
        let id = self.arena.push(unit);
        self.players.push(id);
        self.player_count += 1;
        // 切片 13：观察器跟随匹配玩家初始化（JS 在轮次开始前对找到的 player 装观察器）。
        if let Some(spec_observer) = self.observer_spec.as_ref() {
            if spec_observer.watch_hrid == spec.hrid && self.observer_state.is_none() {
                self.observer_state = Some(ObserverState::new(spec_observer, &self.arena.get(id).food));
                self.observer_unit = Some(id);
            }
        }
        Ok(id)
    }

    /// 生产模式支持边界（其余情形由 JS 侧回退）。
    fn validate_production_support(&self) -> Result<(), UnitError> {
        if !self.minimal_result {
            return Err(UnitError::error(
                "wasm production path currently supports only minimalResult simulations",
            ));
        }
        if self.zone.is_none() {
            return Err(UnitError::error("wasm production path requires a zone"));
        }
        if self.zone_is_dungeon {
            return Err(UnitError::error("wasm production path does not support dungeon zones yet"));
        }
        if self.labyrinth_present {
            return Err(UnitError::error("wasm production path does not support labyrinth runs yet"));
        }
        if self.combat_scrolls_enabled {
            return Err(UnitError::error("wasm production path does not support combat scrolls yet"));
        }
        if self.log_combat_events {
            return Err(UnitError::error("wasm production path does not support logCombatEvents yet"));
        }
        if self.enable_hp_mp_visualization {
            return Err(UnitError::error("wasm production path does not support hp/mp visualization yet"));
        }
        if self.encounter_templates.is_empty() {
            return Err(UnitError::error("wasm production path requires encounter templates"));
        }
        Ok(())
    }

    fn take_event_id(&mut self) -> u64 {
        let id = self.next_event_id;
        self.next_event_id += 1;
        id
    }

    /// 注：曾试验改成返回 `&str` 借用（热路径约 1.6 万次/轮的 String 克隆），但调用点
    /// 与 `self.tally` / `self.arena.get_mut` 交错的约 30 处会全部报借用冲突，且调用
    /// 频率分布很平（无单点热点）。收益约 2–4%，改动面大；待与「效果循环直借 arena
    /// 中技能」的重构（第 7.4 节第 1 条）一起做。
    fn unit_hrid(&self, id: UnitId) -> String {
        let _prof = crate::prof::start("unit_hrid");
        self.arena.get(id).hrid.clone()
    }

    fn clear_events_for_unit(&mut self, id: UnitId) {
        let _prof = crate::prof::start("queue.clear_for_unit");
        self.queue.clear_events_for_unit(id as u64);
    }

    fn record_unit_death(&mut self, unit: UnitId) {
        let hrid = self.unit_hrid(unit);
        self.tally.add_death(&hrid);
        // minimal 结果：跳过经验快照与掉落记账（JS `if (this.minimalResult) return;`）。
    }

    /// 切片 12：提前停止谓词（等价食物优化器候选轮的 JS `shouldStop`）。
    ///
    /// `playerRanOutOfMana[watch_hrid] === true || (deaths[watch_hrid] || 0) > death_limit`。
    fn early_stop_hit(&self) -> bool {
        let Some(spec) = self.early_stop.as_ref() else {
            return false;
        };
        if self.tally.mana_out_for(&spec.watch_hrid) {
            return true;
        }
        match spec.death_limit {
            Some(death_limit) => self.tally.deaths_for(&spec.watch_hrid) > death_limit,
            None => false,
        }
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
            if self.early_stop_hit() {
                stopped_early = true;
                break;
            }

            ticks += 1;
            if ticks == 1000 {
                ticks = 0;
            }
        }
        drop(prof_total);

        let prof_finalize = crate::prof::start("simulate(finalize)");
        // JS：`stoppedEarly ? this.simulationTime : normalizedSimulationTimeLimit`。
        let effective_simulation_time = if stopped_early { self.simulation_time } else { limit };
        // finalizeScrollUsage / discardPendingExperience：切片 4 无卷轴与挂起经验。
        self.tally.simulated_time = effective_simulation_time;
        self.tally.stopped_early = stopped_early;
        if let Some(real) = self.tally.real.as_mut() {
            // JS：`simResult.isDungeon = this.zone?.isDungeon ?? false`（生产路径仅普通区域）。
            real.set_is_dungeon(false);
            real.set_simulated_time(effective_simulation_time);
            real.set_stopped_early(stopped_early);
        }

        for player in self.players.clone() {
            let hrid = self.unit_hrid(player);
            let (drop_rate, rare_find, drop_quantity) = {
                let stats = &self.arena.get(player).combat_details.combat_stats;
                (stats.combat_drop_rate, stats.combat_rare_find, stats.combat_drop_quantity)
            };
            let mana_entries: Vec<(String, f64)> = self
                .arena
                .get(player)
                .ability_mana_costs
                .iter()
                .map(|(key, value)| (key.clone(), *value))
                .collect();
            // JS `setDropRateMultipliers(unit)` 会读 `unit.debuffOnLevelGap`；当前生产路径只支持
            // minimal 结果（该方法在 FoodOptimizerSimResult 里是空操作），故此处传 0。
            self.tally.set_drop_rate_multipliers(&hrid, drop_rate, rare_find, drop_quantity, 0.0);
            self.tally.set_mana_used(&hrid, &mana_entries);
        }
        drop(prof_finalize);

        Ok(())
    }

    fn reset(&mut self) {
        self.temp_dungeon_count = 0.0;
        self.simulation_time = 0.0;
        self.queue.clear();
        self.tally.reset_like_js();
        self.tally.real = None;
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
        // 切片 13：每轮模拟前重建观察器状态（等价 JS 每轮新装；food 列表结构在战斗中
        // 不变，只有 last_used 会动，而形态校验只看 triggers）。
        if let (Some(spec), Some(unit)) = (self.observer_spec.as_ref(), self.observer_unit) {
            self.observer_state = Some(ObserverState::new(spec, &self.arena.get(unit).food));
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

    fn process_event(&mut self, event: SimEvent) -> Result<(), UnitError> {
        let _prof = crate::prof::start(event.kind());
        self.simulation_time = event.time();
        self.event_count += 1;
        if self.trace.len() < self.trace_limit {
            let entry = self.build_trace_entry(&event);
            self.trace.push(entry);
        }

        match event {
            SimEvent::CombatStart { time, .. } => self.process_combat_start_event(time)?,
            SimEvent::PlayerRespawn { hrid, .. } => self.process_player_respawn_event(&hrid)?,
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
                // 免克隆：事件本身已拥有该 String（process_event 按值收事件），直接移动后按 &str 传递。
                self.process_check_buff_expiration_event(source, buff_unique_hrid.as_deref())?
            }
            SimEvent::ScrollRenewal { .. } => {
                // 切片 4 不启用卷轴；事件到达说明场景配置有误。
                return Err(UnitError::error("scrollRenewal events are not supported by the slice-4 simulator"));
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
        let hrid = |id: UnitId| Some(self.arena.get(id).hrid.clone());
        let ability_hrid = |id: UnitId, slot: usize| {
            self.arena
                .get(id)
                .abilities
                .get(slot)
                .and_then(|ability| ability.as_ref())
                .map(|ability| ability.hrid.clone())
        };
        let consumable_hrid = |id: UnitId, is_food: bool, slot: usize| {
            consumable_slot_ref(self.arena.get(id), is_food, slot).map(|item| item.hrid.clone())
        };
        let (time, event_type, source, target, entry_hrid, value) = match event {
            SimEvent::CombatStart { time, .. } => (*time, "combatStart", None, None, None, None),
            SimEvent::PlayerRespawn { time, hrid: player_hrid, .. } => {
                (*time, "playerRespawn", None, None, Some(player_hrid.clone()), None)
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
                buff_unique_hrid.clone(),
                None,
            ),
            SimEvent::ScrollRenewal { time, item_hrid, token, .. } => {
                (*time, "scrollRenewal", None, None, Some(item_hrid.clone()), Some(*token))
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
    // 遭遇战与玩家初始化
    // -----------------------------------------------------------------------

    fn initialize_combat_players(&mut self, time: f64) -> Result<(), UnitError> {
        for player in self.players.clone() {
            if time == 0.0 {
                self.arena.get_mut(player).generate_permanent_buffs();
            }
            let reset_time = self.simulation_time;
            self.arena.get_mut(player).reset(reset_time, &mut self.rng);
        }
        // activateInitialScrolls / syncScrollsToTime：切片 4 无卷轴。
        Ok(())
    }

    fn process_combat_start_event(&mut self, time: f64) -> Result<(), UnitError> {
        self.initialize_combat_players(time)?;
        let event_time = self.simulation_time + REGEN_TICK_INTERVAL;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::RegenTick { time: event_time, id });
        self.start_new_encounter()
    }

    fn process_player_respawn_event(&mut self, hrid: &str) -> Result<(), UnitError> {
        let respawning_player = self.players.iter().copied().find(|id| self.arena.get(*id).hrid == *hrid);
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
            // 生产路径：真实 Zone 生成遭遇战（每次迭代恰好一次抽样，与 JS 逐位一致）。
            let entries = {
                let zone = self.zone.as_mut().expect("zone checked above");
                zone.get_random_encounter(&mut self.rng)?
            };
            let enemies = self.instantiate_templates(&entries)?;
            self.enemies = Some(enemies);
        } else if self.zone_present && !self.zone_is_dungeon {
            let encounter = self.get_random_encounter()?;
            self.enemies = Some(encounter);
        }

        if let Some(enemies) = self.enemies.clone() {
            for enemy in enemies {
                let time = self.simulation_time;
                let hrid = self.unit_hrid(enemy);
                self.arena.get_mut(enemy).reset(time, &mut self.rng);
                self.tally.update_time_spent_alive(&hrid, true, time);
            }
        }

        self.queue.clear_events_of_type("enrageTick");
        let enrage_time = self.simulation_time + ENRAGE_TICK_INTERVAL;
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::EnrageTick {
            time: enrage_time,
            id,
            encounter_time: ENRAGE_TICK_INTERVAL,
        });
        self.enrage_begin_time = self.simulation_time;

        self.queue.clear_events_of_type("abilityCastEndEvent");

        // 提前检查 trigger 让吃喝先跑。
        self.check_triggers()?;

        self.start_attacks()
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

    /// 生产路径：按 `(hrid, difficultyTier)` 查模板并实例化新单位（等价 JS 每次 `new Monster(...)`）。
    ///
    /// 竞技场只增不减：旧敌人保留在 `units` 里（JS 侧由 GC 回收），
    /// 长时间模拟会累积单位快照，属已知取舍。
    fn instantiate_templates(&mut self, entries: &[(String, f64)]) -> Result<Vec<UnitId>, UnitError> {
        let _prof = crate::prof::start("encounter.instantiate");
        let mut ids = Vec::with_capacity(entries.len());
        for (hrid, tier) in entries {
            let index = self
                .encounter_templates
                .iter()
                .position(|template| template.hrid == *hrid && template.difficulty_tier == *tier)
                .ok_or_else(|| {
                    UnitError::error(format!("missing encounter template for {hrid} (difficultyTier {tier})"))
                })?;
            // 免克隆：`build_unit_from_spec` 只读 spec 且返回的 unit 不借用它，原实现每次刷怪
            // 都深拷贝一份 UnitSpec（遭遇生成的主要开销之一）。
            let unit = build_unit_from_spec(&self.encounter_templates[index].spec)?;
            ids.push(self.arena.push(unit));
        }
        Ok(ids)
    }

    fn start_attacks(&mut self) -> Result<(), UnitError> {
        let mut units = self.players.clone();
        if let Some(enemies) = &self.enemies {
            units.extend(enemies.iter().copied());
        }
        for unit in units {
            if self.arena.get(unit).combat_details.current_hitpoints <= 0.0 {
                continue;
            }
            self.add_next_attack_event(unit)?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // 攻击排程与格挡
    // -----------------------------------------------------------------------

    fn add_next_attack_event(&mut self, source: UnitId) -> Result<(), UnitError> {
        let _prof = crate::prof::start("attack.schedule");
        if self.queue.contains_event_of_types_and_source(&ATTACK_EVENT_TYPES, source as u64) {
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
        let mut ranges: Vec<(UnitId, f64, f64)> = Vec::with_capacity(alive_targets.len());
        for id in alive_targets {
            let player_threat = self.arena.get(*id).combat_details.combat_stats.threat;
            cumulative_threat += player_threat;
            ranges.push((*id, cumulative_threat - player_threat, cumulative_threat));
        }
        let random_value_hit = self.rng.next_f64() * cumulative_threat;
        ranges
            .iter()
            .find(|(_, range_start, range_end)| random_value_hit >= *range_start && random_value_hit < *range_end)
            .map(|(id, _, _)| *id)
            .ok_or_else(|| UnitError::type_error("Cannot read properties of undefined (reading 'player')"))
    }

    // -----------------------------------------------------------------------
    // 普攻事件
    // -----------------------------------------------------------------------

    fn process_auto_attack_event(&mut self, event_source: UnitId) -> Result<(), UnitError> {
        let is_player = self.arena.get(event_source).is_player;
        let targets: Vec<UnitId> = if is_player {
            match &self.enemies {
                Some(enemies) => enemies.clone(),
                None => return Ok(()),
            }
        } else {
            self.players.clone()
        };

        let alive_targets: Vec<UnitId> = targets
            .iter()
            .copied()
            .filter(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0)
            .collect();

        for index in 0..alive_targets.len() {
            let mut target = alive_targets[index];
            if !is_player && alive_targets.len() > 1 {
                target = self.pick_threat_target(&alive_targets)?;
            }

            let mut current_source = event_source;
            let parry_target = self.check_parry(&targets);
            if let Some(parry) = parry_target {
                target = current_source;
                current_source = parry;
            }

            let attack_result = {
                let (source_unit, target_unit) = self.arena.two_mut(current_source, target);
                process_attack(source_unit, target_unit, None, &mut self.rng)
            };

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
                self.tally.add_attack(&source_hrid, &target_hrid, "autoAttack", outcome);
            }

            if attack_result.life_steal_heal > 0.0 {
                self.tally.add_hitpoints_gained(&source_hrid, "lifesteal", attack_result.life_steal_heal);
            }
            if attack_result.mana_leech_mana > 0.0 {
                self.tally.add_manapoints_gained(&source_hrid, "manaLeech", attack_result.mana_leech_mana);
            }
            if attack_result.thorn_damage_done > 0.0 {
                self.tally.add_attack(
                    &target_hrid,
                    &source_hrid,
                    &attack_result.thorn_type,
                    AttackOutcome::Damage(attack_result.thorn_damage_done),
                );
            }
            if self.arena.get(target).combat_details.combat_stats.retaliation > 0.0 {
                let outcome = if attack_result.retaliation_damage_done > 0.0 {
                    AttackOutcome::Damage(attack_result.retaliation_damage_done)
                } else {
                    AttackOutcome::Miss
                };
                self.tally.add_attack(&target_hrid, &source_hrid, "retaliation", outcome);
            }

            if self.arena.get(target).combat_details.current_hitpoints == 0.0 {
                self.clear_events_for_unit(target);
                self.record_unit_death(target);
                if !self.arena.get(target).is_player {
                    let time = self.simulation_time;
                    self.tally.update_time_spent_alive(&target_hrid, false, time);
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
                    self.tally.update_time_spent_alive(&source_hrid, false, time);
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
                event.event_type() == "curseExpiration" && event.source() == Some(target as u64)
            })
            .and_then(|event| event.curse_amount())
            .unwrap_or(0.0);
        self.queue
            .clear_matching(|event| event.event_type() == "curseExpiration" && event.source() == Some(target as u64));

        let time = self.simulation_time;
        let id = self.take_event_id();
        let event = SimEvent::curse_expiration(time + CURSE_EXPIRE_TIME, id, current_amount, target);
        let curse_amount = event.curse_amount().unwrap_or(0.0);

        let curse_buff = RawBuffInput {
            unique_hrid: Some(CURSE_UNIQUE_HRID.to_string()),
            type_hrid: Some("/buff_types/damage_taken".to_string()),
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
            .get_matching(|event| event.event_type() == "furyExpiration" && event.source() == Some(source as u64))
            .and_then(|event| event.fury_amount())
            .unwrap_or(0.0);
        self.queue
            .clear_matching(|event| event.event_type() == "furyExpiration" && event.source() == Some(source as u64));

        let mut fury_amount = current_amount;
        if did_hit {
            fury_amount = js_math_min(fury_amount + 1.0, MAX_FURY_STACK);
        } else {
            fury_amount = fury_amount / 2.0;
        }

        let accuracy_buff = RawBuffInput {
            unique_hrid: Some(FURY_ACCURACY_UNIQUE_HRID.to_string()),
            type_hrid: Some("/buff_types/fury_accuracy".to_string()),
            ratio_boost: Some(fury_amount * fury_power),
            flat_boost: Some(0.0),
            duration: Some(FURY_EXPIRE_TIME),
            ..Default::default()
        };
        let damage_buff = RawBuffInput {
            unique_hrid: Some(FURY_DAMAGE_UNIQUE_HRID.to_string()),
            type_hrid: Some("/buff_types/fury_damage".to_string()),
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
            .get_matching(|event| event.event_type() == "weakenExpiration" && event.source() == Some(source as u64))
            .and_then(|event| event.weaken_amount())
            .unwrap_or(0.0);
        self.queue
            .clear_matching(|event| event.event_type() == "weakenExpiration" && event.source() == Some(source as u64));

        let id = self.take_event_id();
        let event = SimEvent::weaken_expiration(time + WEAKEN_EXPIRE_TIME, id, current_amount, source);
        let weaken_amount = event.weaken_amount().unwrap_or(0.0);

        let weaken_buff = RawBuffInput {
            unique_hrid: Some(WEAKEN_UNIQUE_HRID.to_string()),
            type_hrid: Some("/buff_types/damage".to_string()),
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
        let mut encounter_ended = false;

        if let Some(enemies) = self.enemies.clone() {
            let all_dead = !enemies
                .iter()
                .any(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0);
            if all_dead {
                self.queue.clear_events_of_type("autoAttack");
                let time = self.simulation_time + ENEMY_RESPAWN_INTERVAL;
                let id = self.take_event_id();
                self.queue.add_event(SimEvent::EnemyRespawn { time, id });

                // minimal 结果：跳过经验告警/提交（JS minimalResult 分支）。
                self.enemies = None;
                self.tally.add_encounter_end();
                // JS：`this.simResult.lastEncounterFinishTime = this.simulationTime;`（普通与 minimal 都写）。
                self.tally.set_last_encounter_finish_time(self.simulation_time);
                encounter_ended = true;
            }
        }

        for player in self.players.clone() {
            let hp = self.arena.get(player).combat_details.current_hitpoints;
            if hp > 0.0 {
                continue;
            }
            let hrid = self.unit_hrid(player);
            if !self.queue.contains_event_of_type_and_hrid("playerRespawn", &hrid) {
                if self.zone_present && !self.zone_is_dungeon {
                    let time = self.simulation_time + PLAYER_RESPAWN_INTERVAL;
                    let id = self.take_event_id();
                    self.queue.add_event(SimEvent::PlayerRespawn { time, id, hrid: hrid.clone() });
                }
                let time = self.simulation_time;
                self.tally.add_ran_out_of_mana_count(&hrid, false, time);
            }
        }

        let any_alive = self
            .players
            .iter()
            .any(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0);
        if !any_alive {
            if self.zone_present && !self.zone_is_dungeon {
                self.queue.clear_events_of_type("autoAttack");
                self.queue.clear_events_of_type("abilityCastEndEvent");
            }
            encounter_ended = true;
            self.all_players_dead = true;
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
            self.tally.add_hitpoints_gained(&source_hrid, &consumable.hrid, hitpoints_added);
        }

        if consumable.manapoint_restore > 0.0 {
            let tick_value = calculate_tick_value(consumable.manapoint_restore, total_ticks, current_tick);
            let manapoints_added = self.arena.get_mut(source).add_manapoints(tick_value);
            self.tally.add_manapoints_gained(&source_hrid, &consumable.hrid, manapoints_added);

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
        combat_style_hrid: Option<String>,
    ) -> Result<(), UnitError> {
        let tick_damage = calculate_tick_value(damage, total_ticks, current_tick);
        let current_hitpoints = self.arena.get(target).combat_details.current_hitpoints;
        let applied = js_math_min(tick_damage, current_hitpoints);

        self.arena.get_mut(target).combat_details.current_hitpoints -= applied;
        let source_hrid = self.unit_hrid(source_ref);
        let target_hrid = self.unit_hrid(target);
        self.tally.add_attack(&source_hrid, &target_hrid, "damageOverTime", AttackOutcome::Damage(applied));

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
                self.tally.update_time_spent_alive(&target_hrid, false, time);
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
            self.tally.add_hitpoints_gained(&hrid, "regen", hitpoints_added);

            let (max_manapoints, mp_regen_per10) = {
                let details = &self.arena.get(player).combat_details;
                (details.max_manapoints, details.combat_stats.mp_regen_per10)
            };
            let manapoint_regen = (max_manapoints * mp_regen_per10).floor();
            let manapoints_added = self.arena.get_mut(player).add_manapoints(manapoint_regen);
            self.tally.add_manapoints_gained(&hrid, "regen", manapoints_added);

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
        buff_unique_hrid: Option<&str>,
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
        source_key: &str,
    ) -> Result<(), UnitError> {
        let unique_hrid = buff.unique_hrid.clone();
        let key = source_key.to_string();
        self.queue.clear_matching(|event| {
            event.event_type() == "checkBuffExpiration"
                && event.source() == Some(target as u64)
                && event.buff_unique_hrid() == Some(unique_hrid.as_str())
                && event.buff_source_key() == Some(key.as_str())
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
                unique_hrid: Some("/buff_uniques/enrage_damage".to_string()),
                type_hrid: Some("/buff_types/damage".to_string()),
                ratio_boost: Some(now_stack * 0.1),
                flat_boost: Some(0.0),
                duration: Some(ENRAGE_TICK_INTERVAL),
                ..Default::default()
            };
            let accuracy_buff = RawBuffInput {
                unique_hrid: Some("/buff_uniques/enrage_accuracy".to_string()),
                type_hrid: Some("/buff_types/accuracy".to_string()),
                ratio_boost: Some(now_stack * 0.1),
                flat_boost: Some(0.0),
                duration: Some(ENRAGE_TICK_INTERVAL),
                ..Default::default()
            };
            let time = self.simulation_time;
            self.arena.get_mut(enemy).add_buff(&damage_buff, time, None, None)?;
            self.arena.get_mut(enemy).add_buff(&accuracy_buff, time, None, None)?;
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
        for slot in 0..food_len {
            // 免克隆求值：`consumable_slot_ref` 与 `should_trigger` 都是共享借用，原实现的
            // `.cloned()` 只是绕开借用检查，却让热路径每次触发检查都深拷贝一份 Consumable。
            //
            // 切片 13：开启阈值观察时把观察句柄一并传入——`should_trigger` 在快速路径真正
            // 调用 compare_value 的那一刻同步记录 (value, active)（等价 JS 包装 compareValue；
            // 门控早退则不记录，与 JS 观察点一致）。观察状态临时 take 出来构造句柄以绕开
            // 与 `&self.arena` 的借用冲突，**任何路径**（含空槽位 continue）都先放回——
            // 后续 `try_use_consumable` 需要 &mut self。
            let slot_consumable = consumable_slot_ref(self.arena.get(unit), true, slot);
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

        let is_drink = consumable.category_hrid.contains("drink");
        let (drink_concentration, food_haste) = {
            let stats = &self.arena.get(source).combat_details.combat_stats;
            (stats.drink_concentration, stats.food_haste)
        };

        let mut consume_cooldown = consumable.cooldown_duration;
        if drink_concentration > 0.0 && is_drink {
            consume_cooldown = consume_cooldown / (1.0 + drink_concentration);
        } else if food_haste > 0.0 && consumable.category_hrid.contains("food") {
            consume_cooldown = consume_cooldown / (1.0 + food_haste);
        }
        let id = self.take_event_id();
        self.queue.add_event(SimEvent::CooldownReady { time: time + consume_cooldown, id });

        let source_hrid = self.unit_hrid(source);
        self.tally.add_consumable_use(&source_hrid, &consumable.hrid);

        if consumable.recovery_duration == 0.0 {
            if consumable.hitpoint_restore > 0.0 {
                let hitpoints_added = self.arena.get_mut(source).add_hitpoints(consumable.hitpoint_restore);
                self.tally.add_hitpoints_gained(&source_hrid, &consumable.hrid, hitpoints_added);
            }
            if consumable.manapoint_restore > 0.0 {
                let manapoints_added = self.arena.get_mut(source).add_manapoints(consumable.manapoint_restore);
                self.tally.add_manapoints_gained(&source_hrid, &consumable.hrid, manapoints_added);

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
                self.tally.add_ran_out_of_mana_count(&hrid, true, time);
            }
            return false;
        }
        if is_player && oom_check {
            let hrid = self.unit_hrid(source);
            let time = self.simulation_time;
            self.tally.add_ran_out_of_mana_count(&hrid, false, time);
        }
        true
    }

    /// 只扣蓝 + 玩家侧蓝耗记账。`last_used` 的写入由调用方完成：取还式窗口内
    /// （见 `try_use_ability`）技能槽位为 None，冷却时间戳写在调用方的 owned 副本上，
    /// 随 restore 一并落回槽位。
    fn spend_ability_mana(&mut self, source: UnitId, ability_hrid: &str, mana_cost: f64) {
        let is_player = self.arena.get(source).is_player;
        if is_player {
            let unit = self.arena.get_mut(source);
            let existing = unit.ability_mana_costs.get_str(ability_hrid).copied();
            match existing {
                Some(current) => unit.ability_mana_costs.set_str(ability_hrid, current + mana_cost),
                None => unit.ability_mana_costs.set(ability_hrid.to_string(), mana_cost),
            }
        }

        self.arena.get_mut(source).combat_details.current_manapoints -= mana_cost;
    }

    fn try_use_ability(&mut self, source: UnitId, slot: usize) -> Result<bool, UnitError> {
        let _prof = crate::prof::start("ability.try_use");
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
        self.spend_ability_mana(source, &ability.hrid, ability.mana_cost);

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

        let mut current_source = source;
        for todo_ability in std::iter::once(&ability).chain(blaze_ability.iter()).chain(bloom_ability.iter()) {
            for effect in &todo_ability.ability_effects {
                match effect.effect_type.as_str() {
                    "/ability_effect_types/buff" => {
                        let _prof = crate::prof::start("ability.effect.buff");
                        self.process_ability_buff_effect(current_source, todo_ability, effect, true)?;
                    }
                    "/ability_effect_types/damage" => {
                        self.process_ability_damage_effect(current_source, todo_ability, effect)?;
                    }
                    "/ability_effect_types/heal" => {
                        let _prof = crate::prof::start("ability.effect.heal");
                        self.process_ability_heal_effect(current_source, todo_ability, effect)?;
                    }
                    "/ability_effect_types/spend_hp" => {
                        let _prof = crate::prof::start("ability.effect.spendHp");
                        self.process_ability_spend_hp_effect(current_source, todo_ability, effect)?;
                    }
                    "/ability_effect_types/revive" => {
                        let _prof = crate::prof::start("ability.effect.revive");
                        self.process_ability_revive_effect(current_source, todo_ability, effect)?;
                    }
                    "/ability_effect_types/promote" => {
                        self.clear_events_for_unit(current_source);
                        let promoted = self.process_ability_promote_effect()?;
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

        // restore：把（已写好 last_used 的）owned 副本放回槽位。放在 ripple 段**之前**——
        // ripple 冷却回溯会遍历技能槽写 last_used，必须看到完整槽位；效果循环内也无任何
        // 路径读 source 的技能槽（已核实 damage 目标恒为敌方列表、promote/revive 触新单位）。
        self.arena.get_mut(source).abilities[slot] = Some(ability);

        let ripple = self.arena.get(current_source).combat_details.combat_stats.ripple;
        if ripple > 0.0 && self.rng.next_f64() < ripple {
            let manapoints_added = self.arena.get_mut(current_source).add_manapoints(10.0);
            let hrid = self.unit_hrid(current_source);
            self.tally.add_manapoints_gained(&hrid, "ripple", manapoints_added);

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
                self.tally.update_time_spent_alive(&hrid, false, time);
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
        if effect.target_type == "allAllies" {
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
                        && !buff.multiplier_for_skill_hrid.is_empty()
                        && buff.multiplier_per_skill_level > 0.0
                    {
                        let multiplier = 1.0
                            + self.skill_level_value(source, &buff.multiplier_for_skill_hrid)
                                * buff.multiplier_per_skill_level;
                        current_buff.flat_boost *= multiplier;
                        current_buff.ratio_boost *= multiplier;
                    }
                    let source_key = self.add_ability_buff(target, &current_buff, source, ability)?;
                    if schedule_expiration_events {
                        self.schedule_buff_expiration_event(target, &current_buff, &source_key)?;
                    }
                }
            }
            return Ok(());
        }

        if effect.target_type != "self" {
            return Err(UnitError::error(format!(
                "Unsupported target type for buff ability effect: {}",
                ability.hrid
            )));
        }

        for buff in &effect.buffs {
            let source_key = self.add_ability_buff(source, buff, source, ability)?;
            if schedule_expiration_events {
                self.schedule_buff_expiration_event(source, buff, &source_key)?;
            }
        }
        Ok(())
    }

    /// JS `source.combatDetails[buff.multiplierForSkillHrid.split('/')[2] + 'Level']`。
    fn skill_level_value(&self, source: UnitId, multiplier_for_skill_hrid: &str) -> f64 {
        let segment = multiplier_for_skill_hrid.split('/').nth(2).unwrap_or("");
        let details = &self.arena.get(source).combat_details;
        match segment {
            "stamina" => details.stamina_level,
            "intelligence" => details.intelligence_level,
            "attack" => details.attack_level,
            "melee" => details.melee_level,
            "defense" => details.defense_level,
            "ranged" => details.ranged_level,
            "magic" => details.magic_level,
            // JS：combatDetails[undefined + 'Level'] → undefined ⇒ 与数值相乘得 NaN。
            _ => f64::NAN,
        }
    }

    /// 等价 JS 顶层 `addAbilityBuff(target, buff, currentTime, source, ability)`。
    fn add_ability_buff(
        &mut self,
        target: UnitId,
        buff: &crate::buff::Buff,
        source: UnitId,
        ability: &Ability,
    ) -> Result<String, UnitError> {
        let policy = get_ability_buff_source_policy(&ability.hrid, &buff.unique_hrid);
        let source_key = if policy == BuffSourcePolicy::Strongest {
            let hrid = self.unit_hrid(source);
            if hrid.is_empty() {
                "default".to_string()
            } else {
                hrid
            }
        } else {
            "default".to_string()
        };

        let input = RawBuffInput {
            unique_hrid: Some(buff.unique_hrid.clone()),
            type_hrid: Some(buff.type_hrid.clone()),
            ratio_boost: Some(buff.ratio_boost),
            flat_boost: Some(buff.flat_boost),
            duration: buff.duration,
            multiplier_for_skill_hrid: Some(buff.multiplier_for_skill_hrid.clone()),
            multiplier_per_skill_level: Some(buff.multiplier_per_skill_level),
            start_time: buff.start_time,
        };
        let time = self.simulation_time;
        let source_hrid_arg = if policy == BuffSourcePolicy::Strongest { Some(source_key.as_str()) } else { None };
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
        let is_player = self.arena.get(source).is_player;
        let targets_option: Option<Vec<UnitId>> = match effect.target_type.as_str() {
            "enemy" | "allEnemies" => {
                if is_player {
                    self.enemies.clone()
                } else {
                    Some(self.players.clone())
                }
            }
            _ => {
                return Err(UnitError::error(format!(
                    "Unsupported target type for damage ability effect: {}",
                    ability.hrid
                )));
            }
        };

        let Some(mut targets) = targets_option else {
            return Ok(());
        };

        let mut avoid_target: Vec<String> = Vec::new();
        let mut is_skip_parry = false;

        let alive_targets: Vec<UnitId> = targets
            .iter()
            .copied()
            .filter(|id| self.arena.get(*id).combat_details.current_hitpoints > 0.0)
            .collect();

        for alive_index in 0..alive_targets.len() {
            let mut target = alive_targets[alive_index];
            let mut parry_target: Option<UnitId> = None;
            if !is_skip_parry {
                parry_target = self.check_parry(&targets);
                is_skip_parry = true;
            }

            if let Some(parry) = parry_target {
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
                self.tally.add_attack(&temp_source_hrid, &temp_target_hrid, "parry", outcome);

                if attack_result.life_steal_heal > 0.0 {
                    self.tally
                        .add_hitpoints_gained(&temp_source_hrid, "lifesteal", attack_result.life_steal_heal);
                }
                if attack_result.mana_leech_mana > 0.0 {
                    self.tally
                        .add_manapoints_gained(&temp_source_hrid, "manaLeech", attack_result.mana_leech_mana);
                }
                if attack_result.thorn_damage_done > 0.0 {
                    self.tally.add_attack(
                        &temp_target_hrid,
                        &temp_source_hrid,
                        &attack_result.thorn_type,
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
                        .add_attack(&temp_target_hrid, &temp_source_hrid, "retaliation", outcome);
                }

                if self.arena.get(temp_target).combat_details.current_hitpoints == 0.0 {
                    self.clear_events_for_unit(temp_target);
                    self.record_unit_death(temp_target);
                    if !self.arena.get(temp_target).is_player {
                        let time = self.simulation_time;
                        self.tally.update_time_spent_alive(&temp_target_hrid, false, time);
                    }
                }

                if self.arena.get(temp_source).combat_details.current_hitpoints == 0.0
                    && (attack_result.thorn_damage_done != 0.0 || attack_result.retaliation_damage_done != 0.0)
                {
                    self.clear_events_for_unit(temp_source);
                    self.record_unit_death(temp_source);
                    if !self.arena.get(temp_source).is_player {
                        let time = self.simulation_time;
                        self.tally.update_time_spent_alive(&temp_source_hrid, false, time);
                    }
                }
            } else {
                targets = targets
                    .iter()
                    .copied()
                    .filter(|id| {
                        let unit = self.arena.get(*id);
                        let hrid = unit.hrid.clone();
                        !avoid_target.iter().any(|avoid| avoid == &hrid)
                            && unit.combat_details.current_hitpoints > 0.0
                    })
                    .collect();

                if !is_player && !targets.is_empty() && effect.target_type == "enemy" {
                    target = self.pick_threat_target(&targets)?;
                    let hrid = self.unit_hrid(target);
                    avoid_target.push(hrid);
                }
                if targets.is_empty() {
                    break;
                }

                let attack_result = {
                    let (source_unit, target_unit) = self.arena.two_mut(source, target);
                    process_attack(source_unit, target_unit, Some(effect), &mut self.rng)
                };

                let source_hrid = self.unit_hrid(source);
                let target_hrid = self.unit_hrid(target);

                if attack_result.hp_drain > 0.0 {
                    self.tally.add_hitpoints_gained(&source_hrid, &ability.hrid, attack_result.hp_drain);
                }

                if attack_result.did_hit && !effect.buffs.is_empty() {
                    for buff in &effect.buffs {
                        let source_key = self.add_ability_buff(target, buff, source, ability)?;
                        self.schedule_buff_expiration_event(target, buff, &source_key)?;
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
                            (event.event_type() == "autoAttack"
                                || event.event_type() == "abilityCastEndEvent"
                                || event.event_type() == "stunExpiration")
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
                            event.event_type() == "blindExpiration" && event.source() == Some(target as u64)
                        });
                        let cleared_auto_attack = self
                            .queue
                            .clear_matching(|event| event.event_type() == "autoAttack" && event.source() == Some(target as u64));
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
                            event.event_type() == "silenceExpiration" && event.source() == Some(target as u64)
                        });
                        let cleared_cast = self.queue.clear_matching(|event| {
                            event.event_type() == "abilityCastEndEvent" && event.source() == Some(target as u64)
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
                self.tally.add_attack(&source_hrid, &target_hrid, &ability.hrid, outcome);

                if attack_result.thorn_damage_done > 0.0 {
                    self.tally.add_attack(
                        &target_hrid,
                        &source_hrid,
                        &attack_result.thorn_type,
                        AttackOutcome::Damage(attack_result.thorn_damage_done),
                    );
                }

                if self.arena.get(target).combat_details.combat_stats.retaliation > 0.0 {
                    let outcome = if attack_result.retaliation_damage_done > 0.0 {
                        AttackOutcome::Damage(attack_result.retaliation_damage_done)
                    } else {
                        AttackOutcome::Miss
                    };
                    self.tally.add_attack(&target_hrid, &source_hrid, "retaliation", outcome);
                }

                if self.arena.get(target).combat_details.current_hitpoints == 0.0 {
                    self.clear_events_for_unit(target);
                    self.record_unit_death(target);
                    if !self.arena.get(target).is_player {
                        let time = self.simulation_time;
                        self.tally.update_time_spent_alive(&target_hrid, false, time);
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
            if effect.target_type == "enemy" {
                break;
            }
        }

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

        if effect.target_type == "allAllies" {
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
                self.tally.add_hitpoints_gained(&target_hrid, &ability.hrid, amount_healed);
            }
            return Ok(());
        }

        if effect.target_type == "lowestHpAlly" {
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
                self.tally.add_hitpoints_gained(&target_hrid, &ability.hrid, amount_healed);
            }
            return Ok(());
        }

        if effect.target_type != "self" {
            return Err(UnitError::error(format!(
                "Unsupported target type for heal ability effect: {}",
                ability.hrid
            )));
        }

        let (healing_amplify, magic_max_damage) = self.caster_heal_stats(source);
        let amount_healed =
            process_heal_with_stats(healing_amplify, magic_max_damage, effect, self.arena.get_mut(source), &mut self.rng);
        let source_hrid = self.unit_hrid(source);
        self.tally.add_hitpoints_gained(&source_hrid, &ability.hrid, amount_healed);
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
        if effect.target_type != "deadAlly" {
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
                .clear_matching(|event| event.event_type() == "playerRespawn" && event.hrid() == Some(revive_hrid.as_str()));

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

            self.tally.add_hitpoints_gained(&revive_hrid, &ability.hrid, amount_healed);
            self.add_next_attack_event(revive_target)?;

            if !is_player {
                let time = self.simulation_time;
                self.tally.update_time_spent_alive(&revive_hrid, true, time);
            }
        }
        Ok(())
    }

    /// 等价 JS `processAbilityPromoteEffect(source, ability, abilityEffect)`。
    fn process_ability_promote_effect(&mut self) -> Result<UnitId, UnitError> {
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
        let unit = build_unit_from_spec(&spec)?;
        Ok(self.arena.push(unit))
    }

    /// 等价 JS `processAbilitySpendHpEffect(source, ability, abilityEffect)`。
    fn process_ability_spend_hp_effect(
        &mut self,
        source: UnitId,
        ability: &Ability,
        effect: &AbilityEffect,
    ) -> Result<(), UnitError> {
        if effect.target_type != "self" {
            return Err(UnitError::error(format!(
                "Unsupported target type for spend hp ability effect: {}",
                ability.hrid
            )));
        }
        let hp_spent = process_spend_hp(self.arena.get_mut(source), effect);
        let source_hrid = self.unit_hrid(source);
        self.tally.add_hitpoints_spent(&source_hrid, &ability.hrid, hp_spent);
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
                hrid: "blaze".to_string(),
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
            watch_hrid: "/monsters/dummy".to_string(),
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
            watch_hrid: "/monsters/dummy".to_string(),
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
            hrid: hrid.to_string(),
            cooldown_duration: 0.0,
            hitpoint_restore: 10.0,
            manapoint_restore: 10.0,
            recovery_duration: 0.0,
            category_hrid: "/item_categories/food".to_string(),
            buffs: Vec::new(),
            triggers: vec![crate::trigger::Trigger {
                dependency_hrid: "/combat_trigger_dependencies/self".to_string(),
                condition_hrid: condition.to_string(),
                comparator_hrid: "/combat_trigger_comparators/greater_than_equal".to_string(),
                value,
                is_single_target: true,
            }],
            last_used: crate::ability::default_last_used(),
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

        options.observers = Some(ObserverSpec { watch_hrid: "player1".to_string() });
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
            "/combat_trigger_comparators/less_than_equal".to_string();
        player.food = vec![Some(bad)];
        options.observers = Some(ObserverSpec { watch_hrid: "player1".to_string() });

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
}
