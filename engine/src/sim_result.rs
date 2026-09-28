//! SimResult 聚合结果：`src/combatsimulator/simResult.js`（684 行）与
//! `src/combatsimulator/foodOptimizerSimResult.js`（minimal 变体）的逐方法移植。
//!
//! 覆盖范围（切片 5）：构造字段集合、攻击/死亡/消耗品/血蓝/经验/掉落桶/空蓝计时/卷轴记账/
//! 存活时间与副本计时/团灭事件/时序快照/收尾汇总，以及 `to_value()` 的 JS JSON 形状。
//!
//! 对应 JS 的两条构造分支：
//! - 普通分支：`new SimResult(zone, labyrinth, numberOfPlayers)`，构造参数在 Rust 侧拆成
//!   `zone_hrid` / `difficulty_tier` / `labyrinth_name` / `room_level`（`zone?.hrid` 等可选读取）；
//! - minimal 分支：`new FoodOptimizerSimResult(...)`（内部走 `{ minimal: true }`），字段少一半，
//!   且 14 个方法被重写成空操作。
//!
//! 刻意保留的 JS 既有怪癖（不得「改进」）：
//! - `setDropRateMultipliers` 里「先写 `{}` 再被数字覆盖」的死代码等价于直接写数字；重复调用是
//!   **覆盖**而非累加；
//! - `playerRanOutOfMana` 的 5 个键（player1..player5）写死在构造函数里，真实玩家 hrid 只会**新增**
//!   键，不会替换 player1..5；
//! - `recordMonsterDeathFromContext` 先比较最后一个桶再回退线性查找：命中最末桶时只写最末桶，
//!   否则才回退到最早的匹配桶；`difficultyTier` 仅在调用方提供（`Some`）时写入桶；
//! - `updateTimeSpentAlive(name, false, t)` 找不到条目时 JS 抛 TypeError（Rust 侧返回同消息的
//!   `UnitError::type_error`）；`updateDungenonFinish` 找不到则静默返回；
//! - `minDungenonTime` 的 `== 0` 松比较：0 与 -0 都会触发首次写入；
//! - `setManaUsed` 先清空再逐项写入（重复调用是替换），`addDeath` / 消耗品 / 空蓝计时 / 卷轴记账 /
//!   收尾 setter 在 minimal 分支下仍然生效；
//! - 普通分支的 `simulatedTime` / `stoppedEarly` 在构造后**不存在**（未赋值即 `undefined`，
//!   JSON 中无此键），minimal 分支则初值为 0 / false。
//!
//! 与 JS 的差异（均在此注明，不影响真实集成路径的 parity）：
//! - `addWipeEvent` 的 `timestamp` 改为调用方注入（Rust 侧拿不到挂钟）；
//! - `recordScrollOpen` 的 `configuredQuantity` 由 `setScrollConfiguration` 承担（Rust 签名不再从
//!   metadata 取），`openedCount` / `activeDurationNs` / `exhausted` 由调用方显式传入；
//!   `combatSimulator.js` 只会传「有限正整数或 null」，故 `undefined`（不改写已配置数量）这一分支
//!   在 Rust 侧统一折叠为 `None`（写入 null）；
//! - JS 的 `recordMonsterDeath` / `recordMonsterDeathFromUnit` 两个兼容包装折叠为本模块的
//!   `record_monster_death_from_context`（上下文倍率由调用方按 `readMultiplier` 口径算好后传入）；
//! - `ExperienceGainParams` 没有 `isPlayer` 字段：调用方只对玩家调用（等价 JS 的 `unit?.isPlayer`
//!   守卫，非玩家时 JS 只做空操作）；
//! - `primaryTraining` / `combatStyleHrid` / 风格表缺失时，JS 会抛 TypeError（或写出 NaN 技能键），
//!   Rust 侧 `calculate_experience_gain` 返回 `None`，`add_experience_gain` 只累加 7 个标准技能键
//!   （等价 JS `hasOwnProperty(experienceGained, type)` 对未知技能的丢弃）。

use crate::ordered_map::OrderedMap;
use crate::simulator::AttackOutcome;
use crate::unit::UnitError;
use serde_json::{json, Number, Value};

/// JS `experienceGainedRate` / `experienceGained[hrid]` 的技能顺序（7 技能表的键序）。
const EXPERIENCE_SKILLS: [&str; 7] = ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"];

/// JS `Number.MAX_SAFE_INTEGER`。
const JS_MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
/// JS `Number.prototype.toString` 的指数写法上界：`|v| >= 1e21` 起用指数。
const JS_EXPONENTIAL_UPPER: f64 = 1e21;
/// JS `Number.prototype.toString` 的指数写法下界：`|v| < 1e-6` 起用指数。
const JS_EXPONENTIAL_LOWER: f64 = 1e-6;

/// 攻击表：源 hrid → 目标 hrid → 能力 → 命中键（数字串 / `"miss"`）→ 次数。
type AttackTable = OrderedMap<String, OrderedMap<String, OrderedMap<String, OrderedMap<String, f64>>>>;
/// 两层记账表（血/蓝获得、消耗、消耗品），键序按插入序。
type TwoLevelTable = OrderedMap<String, OrderedMap<String, f64>>;

/// `map[key] ??= V::default()`（JS 对象/Map 的「缺失即插入默认值」语义）。
fn ensure_child<'a, V: Default>(map: &'a mut OrderedMap<String, V>, key: &str) -> &'a mut V {
    if !map.contains_key_str(key) {
        map.set(key.to_string(), V::default());
    }
    map.get_mut(&key.to_string()).expect("刚刚插入的键必然存在")
}

/// JS `Math.max(0, value)`（NaN 传播：`Math.max(0, NaN)` 为 NaN）。
fn js_math_max_zero(value: f64) -> f64 {
    if value.is_nan() {
        f64::NAN
    } else if value > 0.0 {
        value
    } else {
        0.0
    }
}

/// JS `Number.isSafeInteger`。
fn js_is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= JS_MAX_SAFE_INTEGER
}

/// JS `String(number)`（属性键字符串化 / `Number.prototype.toString` 的十进制语义）。
///
/// - 整数值不带小数点（`12` → `"12"`，`-0` → `"0"`）；
/// - 非整数走最短往返表示（Rust 的 `Display` 与 JS 同为最短往返十进制，常见值逐字一致）；
/// - `NaN` / `±Infinity` 与 JS 同名（它们也会成为真实的属性键）；
/// - 量级越过 JS 的定点输出范围（`|v| >= 1e21` 或 `|v| < 1e-6`）时改用指数写法并补 `+`，
///   与 JS 一致（`1e21` → `"1e+21"`、`1e-7` → `"1e-7"`、`1e-6` → `"0.000001"`）。
fn js_number_key(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value == 0.0 {
        // JS 的 `(-0).toString()` 为 "0"。
        return "0".to_string();
    }
    if value.abs() >= JS_EXPONENTIAL_UPPER || value.abs() < JS_EXPONENTIAL_LOWER {
        let text = format!("{value:e}");
        return match text.split_once('e') {
            Some((mantissa, exponent)) if !exponent.starts_with('-') => format!("{mantissa}e+{exponent}"),
            _ => text,
        };
    }
    format!("{value}")
}

/// JS `JSON.stringify` 的数字表示：整数值不带小数点、非有限值写成 `null`。
fn js_number_value(value: f64) -> Value {
    if !value.is_finite() {
        return Value::Null;
    }
    if value.fract() == 0.0 && value.abs() <= JS_MAX_SAFE_INTEGER + 1.0 {
        return json!(value as i64);
    }
    Number::from_f64(value).map(Value::Number).unwrap_or(Value::Null)
}

/// 技能 hrid → 技能名（JS `hrid.split('/')[2]`，形如 `/skills/attack` → `attack`）。
fn skill_name_of_hrid(hrid: &str) -> Option<&str> {
    hrid.split('/').nth(2).filter(|name| !name.is_empty())
}

/// 技能名在 7 技能表中的下标（未知技能在 JS 里会写到模板外的键，由累加端丢弃）。
fn skill_index(name: &str) -> Option<usize> {
    EXPERIENCE_SKILLS.iter().position(|skill| *skill == name)
}

/// 经验结算入参（等价 JS `unit.combatDetails.combatStats` + `unit.debuffOnLevelGap` 的投影）。
#[derive(Clone, Debug)]
pub struct ExperienceGainParams {
    /// 玩家 hrid（用于写 `experienceGained[hrid]`）。
    pub hrid: String,
    /// 该次击杀分给该玩家的经验基数。
    pub experience: f64,
    /// `combatStats.primaryTraining`（形如 `/skills/attack`）。
    pub primary_training: Option<String>,
    /// `combatStats.focusTraining`。
    pub focus_training: Option<String>,
    /// `combatStats.combatStyleHrid`。
    pub combat_style_hrid: Option<String>,
    /// `combatStats.combatExperience`。
    pub combat_experience: f64,
    /// `[(技能名, combatStats.<技能>Experience)]`，顺序固定
    /// stamina,intelligence,attack,melee,defense,ranged,magic。
    pub skill_experience: Vec<(String, f64)>,
    /// `unit.debuffOnLevelGap`。
    pub debuff_on_level_gap: f64,
}

/// 空蓝计时条目（JS `playerRanOutOfManaTime[hrid]`）。
#[derive(Clone, Debug, Default)]
struct ManaOutEntry {
    is_out_of_mana: bool,
    start_time_for_out_of_mana: f64,
    total_time_for_out_of_mana: f64,
}

/// 卷轴使用条目（JS `scrollUsage.byPlayer[player][item]`）。
#[derive(Clone, Debug, Default)]
struct ScrollEntry {
    /// `null`（Rust `None`）＝ 无限库存。
    configured_quantity: Option<f64>,
    opened_count: f64,
    active_duration_ns: f64,
    exhausted: bool,
}

/// 卷轴使用汇总（JS `scrollUsage`）。
#[derive(Clone, Debug)]
struct ScrollUsage {
    allowed: bool,
    ignored_reason: String,
    disabled: bool,
    by_player: OrderedMap<String, OrderedMap<String, ScrollEntry>>,
}

/// 存活时间条目（JS `timeSpentAlive[i]`）。
#[derive(Clone, Debug)]
struct TimeSpentAliveEntry {
    name: String,
    time_spent_alive: f64,
    spawned_at: f64,
    alive: bool,
    count: f64,
}

/// 掉落上下文桶（JS `dropContextBuckets[player][monster][i]`）。
#[derive(Clone, Debug)]
struct DropBucket {
    kill_count: f64,
    /// 仅调用方提供怪物有效难度档时写入（未提供时桶里没有该键）。
    difficulty_tier: Option<f64>,
    drop_rate_multiplier: f64,
    rare_find_multiplier: f64,
    combat_drop_quantity: f64,
    debuff_on_level_gap: f64,
}

/// 团灭事件（JS `wipeEvents[i]`）。
#[derive(Clone, Debug)]
struct WipeEvent {
    simulation_time: f64,
    logs: Value,
    wave: f64,
    timestamp: String,
}

/// 单个玩家的时序序列（JS `timeSeriesData.players[hrid]`）。
#[derive(Clone, Debug, Default)]
struct PlayerTimeSeries {
    hp: Vec<f64>,
    mp: Vec<f64>,
    max_hp: Vec<f64>,
    max_mp: Vec<f64>,
}

/// 时序数据（JS `timeSeriesData`）。
#[derive(Clone, Debug, Default)]
struct TimeSeriesData {
    timestamps: Vec<f64>,
    players: OrderedMap<String, PlayerTimeSeries>,
}

/// SimResult 聚合状态（字段私有，仅通过下方方法与 `to_value` 交互）。
#[derive(Clone, Debug)]
pub struct SimResultState {
    /// minimal 变体（`{ minimal: true }` 分支）。
    minimal: bool,

    deaths: OrderedMap<String, f64>,
    consumables_used: TwoLevelTable,
    player_ran_out_of_mana: OrderedMap<String, bool>,
    player_ran_out_of_mana_time: OrderedMap<String, ManaOutEntry>,
    scroll_usage: ScrollUsage,
    time_spent_alive: Vec<TimeSpentAliveEntry>,
    boss_spawns: Vec<String>,
    zone_name: Option<String>,
    difficulty_tier: Option<f64>,
    labyrinth_name: Option<String>,
    room_level: Option<f64>,
    is_dungeon: bool,
    is_labyrinth: bool,
    dungeons_completed: f64,
    dungeons_failed: f64,
    max_wave_reached: f64,
    number_of_players: usize,
    max_enrage_stack: f64,
    min_dungenon_time: f64,
    last_dungeon_finish_time: f64,
    last_encounter_finish_time: f64,

    // 仅普通分支存在的字段（minimal 分支不写、不序列化）。
    experience_gained: TwoLevelTable,
    encounters: f64,
    attacks: AttackTable,
    hitpoints_gained: TwoLevelTable,
    manapoints_gained: TwoLevelTable,
    debuff_on_level_gap: OrderedMap<String, f64>,
    drop_context_buckets: OrderedMap<String, OrderedMap<String, Vec<DropBucket>>>,
    drop_rate_multiplier: OrderedMap<String, f64>,
    rare_find_multiplier: OrderedMap<String, f64>,
    combat_drop_quantity: OrderedMap<String, f64>,
    mana_used: TwoLevelTable,
    hitpoints_spent: TwoLevelTable,
    wipe_events: Vec<WipeEvent>,
    time_series_data: TimeSeriesData,
    /// 普通分支构造后为 `None`（JS 未赋值 → JSON 无此键）；minimal 分支初值 `Some(0)`。
    simulated_time: Option<f64>,
    /// 普通分支构造后为 `None`；minimal 分支初值 `Some(false)`。
    stopped_early: Option<bool>,

    /// `combatStyleDetailMap` 的投影：styleHrid → skillHrid 顺序表（`Object.keys(skillExpMap)`）。
    combat_style_skill_exp_map: Vec<(String, Vec<String>)>,
}

impl SimResultState {
    pub fn new(
        minimal: bool,
        zone_hrid: Option<String>,
        difficulty_tier: Option<f64>,
        labyrinth_name: Option<String>,
        room_level: Option<f64>,
        number_of_players: usize,
        combat_style_skill_exp_map: Vec<(String, Vec<String>)>,
    ) -> Self {
        // JS `labyrinth ? true : false`：Rust 侧以「是否给出迷宫名」代表迷宫对象是否存在。
        let is_labyrinth = labyrinth_name.is_some();
        let mut player_ran_out_of_mana = OrderedMap::new();
        // JS 构造函数里写死的 5 个键（true 会落到真实 hrid 上，见 add_ran_out_of_mana_count）。
        for index in 1..=5 {
            player_ran_out_of_mana.set(format!("player{index}"), false);
        }
        Self {
            minimal,
            deaths: OrderedMap::new(),
            consumables_used: OrderedMap::new(),
            player_ran_out_of_mana,
            player_ran_out_of_mana_time: OrderedMap::new(),
            scroll_usage: ScrollUsage {
                allowed: !is_labyrinth,
                ignored_reason: if is_labyrinth { "labyrinth".to_string() } else { String::new() },
                disabled: false,
                by_player: OrderedMap::new(),
            },
            time_spent_alive: Vec::new(),
            boss_spawns: Vec::new(),
            zone_name: zone_hrid,
            difficulty_tier,
            labyrinth_name,
            room_level,
            is_dungeon: false,
            is_labyrinth,
            dungeons_completed: 0.0,
            dungeons_failed: 0.0,
            max_wave_reached: 0.0,
            number_of_players,
            max_enrage_stack: 0.0,
            min_dungenon_time: 0.0,
            last_dungeon_finish_time: 0.0,
            last_encounter_finish_time: 0.0,
            experience_gained: OrderedMap::new(),
            encounters: 0.0,
            attacks: OrderedMap::new(),
            hitpoints_gained: OrderedMap::new(),
            manapoints_gained: OrderedMap::new(),
            debuff_on_level_gap: OrderedMap::new(),
            drop_context_buckets: OrderedMap::new(),
            drop_rate_multiplier: OrderedMap::new(),
            rare_find_multiplier: OrderedMap::new(),
            combat_drop_quantity: OrderedMap::new(),
            mana_used: OrderedMap::new(),
            hitpoints_spent: OrderedMap::new(),
            wipe_events: Vec::new(),
            time_series_data: TimeSeriesData::default(),
            // 普通分支不初始化 simulatedTime / stoppedEarly（JS 里到模拟收尾才赋值）。
            simulated_time: if minimal { Some(0.0) } else { None },
            stopped_early: if minimal { Some(false) } else { None },
            combat_style_skill_exp_map,
        }
    }

    pub fn is_minimal(&self) -> bool {
        self.minimal
    }

    /// JS `addDeath(unit)`（minimal 分支未重写，照常记账）。
    pub fn add_death(&mut self, hrid: &str) {
        *ensure_child(&mut self.deaths, hrid) += 1.0;
    }

    /// JS `addWipeEvent(logs, simulationTime, wave)`（timestamp 由调用方注入）。
    pub fn add_wipe_event(&mut self, logs: Value, simulation_time: f64, wave: f64, timestamp: String) {
        if self.minimal {
            return;
        }
        self.wipe_events.push(WipeEvent { simulation_time, logs, wave, timestamp });
    }

    /// JS `updateTimeSpentAlive(name, alive, time)`。
    ///
    /// `alive == false` 且找不到同名条目时，JS 会读 `undefined.spawnedAt` 抛 TypeError；
    /// 这里返回同消息的 `UnitError::type_error`（小写开头，与 V8 的消息逐字一致）。
    pub fn update_time_spent_alive(&mut self, name: &str, alive: bool, time: f64) -> Result<(), UnitError> {
        if self.minimal {
            return Ok(());
        }
        let index = self.time_spent_alive.iter().position(|entry| entry.name == name);
        if alive {
            match index {
                Some(index) => {
                    let entry = &mut self.time_spent_alive[index];
                    entry.alive = true;
                    entry.spawned_at = time;
                }
                None => self.time_spent_alive.push(TimeSpentAliveEntry {
                    name: name.to_string(),
                    time_spent_alive: 0.0,
                    spawned_at: time,
                    alive: true,
                    count: 0.0,
                }),
            }
            return Ok(());
        }

        let Some(index) = index else {
            return Err(UnitError::type_error("Cannot read properties of undefined (reading 'spawnedAt')"));
        };
        let entry = &mut self.time_spent_alive[index];
        let time_alive = time - entry.spawned_at;
        entry.alive = false;
        entry.time_spent_alive += time_alive;
        entry.count += 1.0;
        Ok(())
    }

    /// JS `updateDungenonFinish(beginFlag, finishTime)`：找不到条目则静默返回。
    pub fn update_dungenon_finish(&mut self, begin_flag: &str, finish_time: f64) {
        if self.minimal {
            return;
        }
        let Some(entry) = self.time_spent_alive.iter().find(|entry| entry.name == begin_flag) else {
            return;
        };
        let current_dungenon_time = finish_time - entry.spawned_at;
        // JS `this.minDungenonTime == 0 || this.minDungenonTime > current`（松比较：-0 也算 0）。
        if self.min_dungenon_time == 0.0 || self.min_dungenon_time > current_dungenon_time {
            self.min_dungenon_time = current_dungenon_time;
        }
    }

    /// JS `addEncounterEnd()`。
    pub fn add_encounter_end(&mut self) {
        if self.minimal {
            return;
        }
        self.encounters += 1.0;
    }

    /// JS `addAttack(source, target, ability, hit)`：`hit` 作为对象键被字符串化
    /// （数字走 `js_number_key`，未命中为字面量 `"miss"`）。
    pub fn add_attack(&mut self, source_hrid: &str, target_hrid: &str, ability: &str, outcome: &AttackOutcome) {
        if self.minimal {
            return;
        }
        let hit_key = match outcome {
            AttackOutcome::Miss => "miss".to_string(),
            AttackOutcome::Damage(damage) => js_number_key(*damage),
        };
        let targets = ensure_child(&mut self.attacks, source_hrid);
        let abilities = ensure_child(targets, target_hrid);
        let hits = ensure_child(abilities, ability);
        *ensure_child(hits, &hit_key) += 1.0;
    }

    /// JS `addConsumableUse(unit, consumable)`（minimal 分支仍记账）。
    pub fn add_consumable_use(&mut self, unit_hrid: &str, consumable_hrid: &str) {
        let consumables = ensure_child(&mut self.consumables_used, unit_hrid);
        *ensure_child(consumables, consumable_hrid) += 1.0;
    }

    /// JS `addHitpointsGained(unit, source, amount)`。
    pub fn add_hitpoints_gained(&mut self, unit_hrid: &str, source: &str, amount: f64) {
        if self.minimal {
            return;
        }
        *ensure_child(ensure_child(&mut self.hitpoints_gained, unit_hrid), source) += amount;
    }

    /// JS `addManapointsGained(unit, source, amount)`。
    pub fn add_manapoints_gained(&mut self, unit_hrid: &str, source: &str, amount: f64) {
        if self.minimal {
            return;
        }
        *ensure_child(ensure_child(&mut self.manapoints_gained, unit_hrid), source) += amount;
    }

    /// JS `addHitpointsSpent(unit, source, amount)`。
    pub fn add_hitpoints_spent(&mut self, unit_hrid: &str, source: &str, amount: f64) {
        if self.minimal {
            return;
        }
        *ensure_child(ensure_child(&mut self.hitpoints_spent, unit_hrid), source) += amount;
    }

    /// JS `setDropRateMultipliers(unit)`：四个表都按 hrid 直接**覆盖**写数字。
    pub fn set_drop_rate_multipliers(
        &mut self,
        hrid: &str,
        combat_drop_rate: f64,
        combat_rare_find: f64,
        combat_drop_quantity: f64,
        debuff_on_level_gap: f64,
    ) {
        if self.minimal {
            return;
        }
        // JS 里「`if (!this.dropRateMultiplier[hrid]) this.dropRateMultiplier[hrid] = {}` 之后又被
        // `1 + stat` 覆盖」是死代码：结果等价于直接写数字。
        *ensure_child(&mut self.drop_rate_multiplier, hrid) = 1.0 + combat_drop_rate;
        *ensure_child(&mut self.rare_find_multiplier, hrid) = 1.0 + combat_rare_find;
        *ensure_child(&mut self.combat_drop_quantity, hrid) = combat_drop_quantity;
        *ensure_child(&mut self.debuff_on_level_gap, hrid) = debuff_on_level_gap;
    }

    /// JS `setManaUsed(unit)`：整个能力消耗表**替换**重建（重复调用会丢掉旧键）。
    pub fn set_mana_used(&mut self, hrid: &str, entries: &[(String, f64)]) {
        if self.minimal {
            return;
        }
        let mut table = OrderedMap::new();
        for (ability_hrid, mana_cost) in entries {
            table.set(ability_hrid.clone(), *mana_cost);
        }
        self.mana_used.set(hrid.to_string(), table);
    }

    /// JS `addRanOutOfManaCount(unit, isOutOfMana, time)`（minimal 分支仍记账）。
    pub fn add_ran_out_of_mana_count(&mut self, hrid: &str, is_out_of_mana: bool, time: f64) {
        if is_out_of_mana {
            // JS `this.playerRanOutOfMana[unit.hrid] = true`：真实 hrid 是**新增**键。
            self.player_ran_out_of_mana.set(hrid.to_string(), true);
        }

        let entry = ensure_child(&mut self.player_ran_out_of_mana_time, hrid);
        if is_out_of_mana {
            if !entry.is_out_of_mana {
                entry.is_out_of_mana = true;
                entry.start_time_for_out_of_mana = time;
            }
        } else if entry.is_out_of_mana {
            entry.is_out_of_mana = false;
            entry.total_time_for_out_of_mana += time - entry.start_time_for_out_of_mana;
        }
    }

    /// JS `calculateExperienceGain(unit, experience)`：不修改结果，只算出技能经验增益。
    ///
    /// 返回 `None` 的三种情形：minimal 分支、`primaryTraining` 缺失、风格表/风格 hrid 缺失
    /// （后两者 JS 会抛 TypeError）。零倍率技能按 JS 的 `if (rate <= 0) continue` 跳过。
    pub fn calculate_experience_gain(&self, params: &ExperienceGainParams) -> Option<Vec<(String, f64)>> {
        if self.minimal {
            return None;
        }
        let primary_skill = params.primary_training.as_deref().and_then(skill_name_of_hrid)?;
        let style_hrid = params.combat_style_hrid.as_deref()?;
        let style_skills = self
            .combat_style_skill_exp_map
            .iter()
            .find(|(hrid, _)| hrid == style_hrid)
            .map(|(_, skills)| skills)?;

        // JS `experienceGainedRate` 的 7 个零值键 + 主训练 0.3。
        let mut rates = [0.0_f64; EXPERIENCE_SKILLS.len()];
        if let Some(index) = skill_index(primary_skill) {
            rates[index] = 0.3;
        }

        let focus_skill = params.focus_training.as_deref().and_then(skill_name_of_hrid);
        let focus_in_style = match params.focus_training.as_deref() {
            Some(focus_training) => style_skills.iter().any(|hrid| hrid == focus_training),
            None => false,
        };
        if focus_in_style {
            if let Some(index) = focus_skill.and_then(skill_index) {
                rates[index] += 0.7;
            }
        } else {
            // JS 按 `Object.keys(skillExpMap)` 平均分摊 0.7（除数是全部风格技能数，不是标准 7 技能数）。
            let share = 0.7 / style_skills.len() as f64;
            for skill_hrid in style_skills {
                if let Some(index) = skill_name_of_hrid(skill_hrid).and_then(skill_index) {
                    rates[index] += share;
                }
            }
        }

        let mut gains = Vec::new();
        for (index, skill) in EXPERIENCE_SKILLS.iter().enumerate() {
            let rate = rates[index];
            // JS `if (rate <= 0) continue;`：NaN 不满足 `<= 0`，会照常写出（此处同样保留）。
            if rate <= 0.0 {
                continue;
            }
            let skill_experience_rate = rate * (1.0 + skill_experience_value(params, skill));
            let gain = params.experience
                * (1.0 + params.combat_experience)
                * skill_experience_rate
                * (1.0 + params.debuff_on_level_gap);
            gains.push(((*skill).to_string(), gain));
        }
        Some(gains)
    }

    /// JS `addExperienceGain(unit, experience)`（= `addExperienceGainValues(unit, calculateExperienceGain(...))`）。
    pub fn add_experience_gain(&mut self, params: &ExperienceGainParams) {
        if self.minimal {
            return;
        }
        let gains = self.calculate_experience_gain(params);
        if !self.experience_gained.contains_key_str(&params.hrid) {
            let mut entry = OrderedMap::new();
            for skill in EXPERIENCE_SKILLS {
                entry.set(skill.to_string(), 0.0);
            }
            self.experience_gained.set(params.hrid.clone(), entry);
        }
        let Some(gains) = gains else {
            return;
        };
        let entry = self.experience_gained.get_mut(&params.hrid).expect("上面已确保存在");
        for (skill, value) in gains {
            // JS `hasOwnProperty(experienceGained, type)`：模板外的技能键不加。
            if let Some(target) = entry.get_mut(&skill) {
                *target += value;
            }
        }
    }

    /// JS `addTimeSeriesSnapshot(time, players)`：按 `players` 顺序 push（同一玩家重复出现会 push 两次）。
    pub fn add_time_series_snapshot(&mut self, time: f64, players: &[(String, f64, f64, f64, f64)]) {
        if self.minimal {
            return;
        }
        self.time_series_data.timestamps.push(time);
        for (hrid, hitpoints, manapoints, max_hitpoints, max_manapoints) in players {
            let series = ensure_child(&mut self.time_series_data.players, hrid);
            series.hp.push(*hitpoints);
            series.mp.push(*manapoints);
            series.max_hp.push(*max_hitpoints);
            series.max_mp.push(*max_manapoints);
        }
    }

    /// JS `setScrollUsageContext(allowed, ignoredReason)`。
    pub fn set_scroll_usage_context(&mut self, allowed: bool, ignored_reason: &str) {
        self.scroll_usage.allowed = allowed;
        self.scroll_usage.ignored_reason = if allowed {
            String::new()
        } else if ignored_reason.is_empty() {
            "scrolls_not_allowed".to_string()
        } else {
            ignored_reason.to_string()
        };
    }

    /// JS `setScrollUsageDisabled(disabled)`。
    pub fn set_scroll_usage_disabled(&mut self, disabled: bool) {
        self.scroll_usage.disabled = disabled;
    }

    /// JS `setScrollConfiguration(playerHrid, itemHrid, configuration)`。
    ///
    /// 只接受「有限安全整数且 > 0」作为已配置数量；其它数字（0/负数/小数）按 JS 语义整调用返回，
    /// 既不注册也不改写。`None` 对应 JS 的 `null`（无限库存）。
    pub fn set_scroll_configuration(&mut self, player_hrid: &str, item_hrid: &str, configured_quantity: Option<f64>) {
        if let Some(quantity) = configured_quantity {
            if !js_is_safe_integer(quantity) || quantity <= 0.0 {
                return;
            }
            if let Some(entry) = ensure_scroll_entry(&mut self.scroll_usage, player_hrid, item_hrid) {
                entry.configured_quantity = Some(quantity);
            }
            return;
        }
        if let Some(entry) = ensure_scroll_entry(&mut self.scroll_usage, player_hrid, item_hrid) {
            entry.configured_quantity = None;
        }
    }

    /// JS `recordScrollOpen(playerHrid, itemHrid, metadata, activeDurationNs, exhausted)`。
    pub fn record_scroll_open(
        &mut self,
        player_hrid: &str,
        item_hrid: &str,
        opened_count: f64,
        active_duration_ns: f64,
        exhausted: Option<bool>,
    ) {
        let Some(entry) = ensure_scroll_entry(&mut self.scroll_usage, player_hrid, item_hrid) else {
            return;
        };
        // JS `Number.isFinite(Number(details.openedCount)) ? Math.max(0, Math.floor(...)) : 1`。
        let count = if opened_count.is_finite() { js_math_max_zero(opened_count.floor()) } else { 1.0 };
        entry.opened_count += count;
        if active_duration_ns.is_finite() && active_duration_ns > 0.0 {
            entry.active_duration_ns += active_duration_ns;
        }
        match exhausted {
            Some(value) => entry.exhausted = value,
            None => {
                // JS 只在显式未提供 exhausted 时按已配置数量推断（且只置 true，不置回 false）。
                if let Some(configured_quantity) = entry.configured_quantity {
                    if entry.opened_count >= configured_quantity {
                        entry.exhausted = true;
                    }
                }
            }
        }
    }

    /// JS `recordScrollWindow(playerHrid, itemHrid, activeDurationNs)`。
    pub fn record_scroll_window(&mut self, player_hrid: &str, item_hrid: &str, active_duration_ns: f64) {
        let Some(entry) = ensure_scroll_entry(&mut self.scroll_usage, player_hrid, item_hrid) else {
            return;
        };
        if active_duration_ns.is_finite() && active_duration_ns > 0.0 {
            entry.active_duration_ns += active_duration_ns;
        }
    }

    /// JS `recordMonsterDeathFromContext(...)`：按（玩家, 怪物）维护掉落上下文桶。
    ///
    /// 倍率入参对应 JS `readMultiplier` 的计算结果；这里保留 JS 结尾的兜底归一化
    /// （非有限倍率回落到 1 / 0）。JS 从不抛错，故始终返回 `Ok`。
    pub fn record_monster_death_from_context(
        &mut self,
        player_hrid: &str,
        monster_hrid: &str,
        kill_count: f64,
        monster_difficulty_tier: Option<f64>,
        drop_rate_multiplier: f64,
        rare_find_multiplier: f64,
        combat_drop_quantity: f64,
        debuff_on_level_gap: f64,
    ) -> Result<(), UnitError> {
        if self.minimal {
            return Ok(());
        }
        let player_key = player_hrid.trim();
        let monster_key = monster_hrid.trim();
        if player_key.is_empty() || monster_key.is_empty() {
            return Ok(());
        }

        let drop_rate = if drop_rate_multiplier.is_finite() { drop_rate_multiplier } else { 1.0 };
        let rare_find = if rare_find_multiplier.is_finite() { rare_find_multiplier } else { 1.0 };
        let drop_quantity = if combat_drop_quantity.is_finite() { combat_drop_quantity } else { 0.0 };
        let level_gap = if debuff_on_level_gap.is_finite() { debuff_on_level_gap } else { 0.0 };
        let difficulty_tier = monster_difficulty_tier
            .filter(|tier| tier.is_finite())
            .map(|tier| js_math_max_zero(tier.floor()));

        let count = js_math_max_zero(kill_count.floor());
        if count <= 0.0 {
            return Ok(());
        }

        let monsters = ensure_child(&mut self.drop_context_buckets, player_key);
        let buckets = ensure_child(monsters, monster_key);
        let matches_context = |bucket: &DropBucket| -> bool {
            bucket.drop_rate_multiplier == drop_rate
                && bucket.rare_find_multiplier == rare_find
                && bucket.combat_drop_quantity == drop_quantity
                && bucket.debuff_on_level_gap == level_gap
                // 同一怪物在同一模拟内的有效难度档恒定；纳入签名避免不同难度被静默合并。
                && bucket.difficulty_tier == difficulty_tier
        };

        // 死亡通常集中在同一个增益窗口内：先查最近使用的桶（热路径 O(1)），
        // 回退线性查找以便旧签名再次出现时仍能合并更早的桶。
        let latest_matches = buckets.last().map(|bucket| matches_context(bucket)).unwrap_or(false);
        let existing = if latest_matches {
            Some(buckets.len() - 1)
        } else {
            buckets.iter().position(|bucket| matches_context(bucket))
        };
        if let Some(index) = existing {
            buckets[index].kill_count += count;
            return Ok(());
        }

        buckets.push(DropBucket {
            kill_count: count,
            // 仅在已知怪物有效难度时写入该键（旧形状结果/DTO 保持无键）。
            difficulty_tier,
            drop_rate_multiplier: drop_rate,
            rare_find_multiplier: rare_find,
            combat_drop_quantity: drop_quantity,
            debuff_on_level_gap: level_gap,
        });
        Ok(())
    }

    /// JS `this.simResult.simulatedTime = effectiveSimulationTime`。
    pub fn set_simulated_time(&mut self, value: f64) {
        self.simulated_time = Some(value);
    }

    /// JS `this.simResult.stoppedEarly = stoppedEarly`。
    pub fn set_stopped_early(&mut self, value: bool) {
        self.stopped_early = Some(value);
    }

    /// JS `this.simResult.isDungeon = this.zone?.isDungeon ?? false`。
    pub fn set_is_dungeon(&mut self, value: bool) {
        self.is_dungeon = value;
    }

    /// JS 收尾时写入的副本计数（`dungeonsCompleted` / `dungeonsFailed` / `maxWaveReached`）。
    pub fn set_dungeon_summary(&mut self, dungeons_completed: f64, dungeons_failed: f64, max_wave_reached: f64) {
        self.dungeons_completed = dungeons_completed;
        self.dungeons_failed = dungeons_failed;
        self.max_wave_reached = max_wave_reached;
    }

    /// JS `this.simResult.maxEnrageStack = Math.max(...)`（取 max 由调用方完成）。
    pub fn set_max_enrage_stack(&mut self, value: f64) {
        self.max_enrage_stack = value;
    }

    /// JS `this.simResult.lastDungeonFinishTime = this.simulationTime`。
    pub fn set_last_dungeon_finish_time(&mut self, value: f64) {
        self.last_dungeon_finish_time = value;
    }

    /// JS `this.simResult.lastEncounterFinishTime = this.simulationTime`。
    pub fn set_last_encounter_finish_time(&mut self, value: f64) {
        self.last_encounter_finish_time = value;
    }

    /// JS `this.simResult.bossSpawns.push(...)`。
    pub fn push_boss_spawn(&mut self, label: String) {
        self.boss_spawns.push(label);
    }

    /// `JSON.stringify(simResult)` 的等价形状（键集合/嵌套层级一致；键序无关）。
    pub fn to_value(&self) -> Value {
        let mut result = serde_json::Map::new();
        if self.minimal {
            result.insert("deaths".to_string(), number_map_to_value(&self.deaths));
            result.insert("consumablesUsed".to_string(), two_level_to_value(&self.consumables_used));
            result.insert("playerRanOutOfMana".to_string(), bool_map_to_value(&self.player_ran_out_of_mana));
            result.insert("playerRanOutOfManaTime".to_string(), mana_out_map_to_value(&self.player_ran_out_of_mana_time));
            result.insert("scrollUsage".to_string(), scroll_usage_to_value(&self.scroll_usage));
            result.insert("timeSpentAlive".to_string(), time_spent_alive_to_value(&self.time_spent_alive));
            result.insert("bossSpawns".to_string(), json!(self.boss_spawns));
            self.insert_zone_fields(&mut result);
            self.insert_shared_summary(&mut result);
            self.insert_simulated_time(&mut result);
            return Value::Object(result);
        }

        result.insert("deaths".to_string(), number_map_to_value(&self.deaths));
        result.insert("experienceGained".to_string(), two_level_to_value(&self.experience_gained));
        result.insert("encounters".to_string(), js_number_value(self.encounters));
        result.insert("attacks".to_string(), attacks_to_value(&self.attacks));
        result.insert("consumablesUsed".to_string(), two_level_to_value(&self.consumables_used));
        result.insert("hitpointsGained".to_string(), two_level_to_value(&self.hitpoints_gained));
        result.insert("manapointsGained".to_string(), two_level_to_value(&self.manapoints_gained));
        result.insert("debuffOnLevelGap".to_string(), number_map_to_value(&self.debuff_on_level_gap));
        result.insert("scrollUsage".to_string(), scroll_usage_to_value(&self.scroll_usage));
        result.insert("dropContextBuckets".to_string(), drop_buckets_to_value(&self.drop_context_buckets));
        result.insert("dropRateMultiplier".to_string(), number_map_to_value(&self.drop_rate_multiplier));
        result.insert("rareFindMultiplier".to_string(), number_map_to_value(&self.rare_find_multiplier));
        result.insert("combatDropQuantity".to_string(), number_map_to_value(&self.combat_drop_quantity));
        result.insert("playerRanOutOfMana".to_string(), bool_map_to_value(&self.player_ran_out_of_mana));
        result.insert("playerRanOutOfManaTime".to_string(), mana_out_map_to_value(&self.player_ran_out_of_mana_time));
        result.insert("manaUsed".to_string(), two_level_to_value(&self.mana_used));
        result.insert("timeSpentAlive".to_string(), time_spent_alive_to_value(&self.time_spent_alive));
        result.insert("bossSpawns".to_string(), json!(self.boss_spawns));
        result.insert("hitpointsSpent".to_string(), two_level_to_value(&self.hitpoints_spent));
        self.insert_zone_fields(&mut result);
        self.insert_shared_summary(&mut result);
        result.insert("wipeEvents".to_string(), wipe_events_to_value(&self.wipe_events));
        result.insert("timeSeriesData".to_string(), time_series_to_value(&self.time_series_data));
        self.insert_simulated_time(&mut result);
        Value::Object(result)
    }

    /// 可选身份字段（`zone?.hrid` 等未提供时 JS 的键为 `undefined`，JSON 里没有该键）。
    fn insert_zone_fields(&self, result: &mut serde_json::Map<String, Value>) {
        if let Some(zone_name) = &self.zone_name {
            result.insert("zoneName".to_string(), json!(zone_name));
        }
        if let Some(difficulty_tier) = self.difficulty_tier {
            result.insert("difficultyTier".to_string(), js_number_value(difficulty_tier));
        }
        if let Some(labyrinth_name) = &self.labyrinth_name {
            result.insert("labyrinthName".to_string(), json!(labyrinth_name));
        }
        if let Some(room_level) = self.room_level {
            result.insert("roomLevel".to_string(), js_number_value(room_level));
        }
    }

    /// 两个分支共有的计数/汇总字段。
    fn insert_shared_summary(&self, result: &mut serde_json::Map<String, Value>) {
        result.insert("isDungeon".to_string(), json!(self.is_dungeon));
        result.insert("isLabyrinth".to_string(), json!(self.is_labyrinth));
        result.insert("dungeonsCompleted".to_string(), js_number_value(self.dungeons_completed));
        result.insert("dungeonsFailed".to_string(), js_number_value(self.dungeons_failed));
        result.insert("maxWaveReached".to_string(), js_number_value(self.max_wave_reached));
        result.insert("numberOfPlayers".to_string(), json!(self.number_of_players));
        result.insert("maxEnrageStack".to_string(), js_number_value(self.max_enrage_stack));
        result.insert("minDungenonTime".to_string(), js_number_value(self.min_dungenon_time));
        result.insert("lastDungeonFinishTime".to_string(), js_number_value(self.last_dungeon_finish_time));
        result.insert("lastEncounterFinishTime".to_string(), js_number_value(self.last_encounter_finish_time));
    }

    /// `simulatedTime` / `stoppedEarly`：只有被赋值过才出现在 JSON 里。
    fn insert_simulated_time(&self, result: &mut serde_json::Map<String, Value>) {
        if let Some(simulated_time) = self.simulated_time {
            result.insert("simulatedTime".to_string(), js_number_value(simulated_time));
        }
        if let Some(stopped_early) = self.stopped_early {
            result.insert("stoppedEarly".to_string(), json!(stopped_early));
        }
    }
}

/// `combatStats.<技能>Experience` 的取值（契约保证 7 项齐全；缺失时按 0 处理，JS 会得到 NaN）。
fn skill_experience_value(params: &ExperienceGainParams, skill: &str) -> f64 {
    params
        .skill_experience
        .iter()
        .find(|(name, _)| name == skill)
        .map(|(_, value)| *value)
        .unwrap_or(0.0)
}

/// JS `ensureScrollUsageEntry`：玩家/物品键去空白后为空则不注册（返回 `None`）。
fn ensure_scroll_entry<'a>(
    usage: &'a mut ScrollUsage,
    player_hrid: &str,
    item_hrid: &str,
) -> Option<&'a mut ScrollEntry> {
    let player_key = player_hrid.trim();
    let item_key = item_hrid.trim();
    if player_key.is_empty() || item_key.is_empty() {
        return None;
    }
    Some(ensure_child(ensure_child(&mut usage.by_player, player_key), item_key))
}

/// `OrderedMap<String, f64>` → JS 数字对象。
fn number_map_to_value(map: &OrderedMap<String, f64>) -> Value {
    Value::Object(map.iter().map(|(key, value)| (key.clone(), js_number_value(*value))).collect())
}

/// `OrderedMap<String, bool>` → JS 布尔对象。
fn bool_map_to_value(map: &OrderedMap<String, bool>) -> Value {
    Value::Object(map.iter().map(|(key, value)| (key.clone(), json!(*value))).collect())
}

/// 两层记账表 → JS 嵌套数字对象。
fn two_level_to_value(map: &TwoLevelTable) -> Value {
    Value::Object(map.iter().map(|(key, inner)| (key.clone(), number_map_to_value(inner))).collect())
}

/// 空蓝计时表 → JS 对象。
fn mana_out_map_to_value(map: &OrderedMap<String, ManaOutEntry>) -> Value {
    Value::Object(
        map.iter()
            .map(|(key, entry)| {
                let mut value = serde_json::Map::new();
                value.insert("isOutOfMana".to_string(), json!(entry.is_out_of_mana));
                value.insert("startTimeForOutOfMana".to_string(), js_number_value(entry.start_time_for_out_of_mana));
                value.insert("totalTimeForOutOfMana".to_string(), js_number_value(entry.total_time_for_out_of_mana));
                (key.clone(), Value::Object(value))
            })
            .collect(),
    )
}

/// 卷轴使用汇总 → JS 对象。
fn scroll_usage_to_value(usage: &ScrollUsage) -> Value {
    let by_player = usage
        .by_player
        .iter()
        .map(|(player_key, by_item)| {
            let items = by_item
                .iter()
                .map(|(item_key, entry)| {
                    let mut value = serde_json::Map::new();
                    value.insert(
                        "configuredQuantity".to_string(),
                        match entry.configured_quantity {
                            Some(quantity) => js_number_value(quantity),
                            None => Value::Null,
                        },
                    );
                    value.insert("openedCount".to_string(), js_number_value(entry.opened_count));
                    value.insert("activeDurationNs".to_string(), js_number_value(entry.active_duration_ns));
                    value.insert("exhausted".to_string(), json!(entry.exhausted));
                    (item_key.clone(), Value::Object(value))
                })
                .collect();
            (player_key.clone(), Value::Object(items))
        })
        .collect();
    let mut value = serde_json::Map::new();
    value.insert("allowed".to_string(), json!(usage.allowed));
    value.insert("ignoredReason".to_string(), json!(usage.ignored_reason));
    value.insert("disabled".to_string(), json!(usage.disabled));
    value.insert("byPlayer".to_string(), Value::Object(by_player));
    Value::Object(value)
}

/// 存活时间条目数组 → JS 数组。
fn time_spent_alive_to_value(entries: &[TimeSpentAliveEntry]) -> Value {
    Value::Array(
        entries
            .iter()
            .map(|entry| {
                let mut value = serde_json::Map::new();
                value.insert("name".to_string(), json!(entry.name));
                value.insert("timeSpentAlive".to_string(), js_number_value(entry.time_spent_alive));
                value.insert("spawnedAt".to_string(), js_number_value(entry.spawned_at));
                value.insert("alive".to_string(), json!(entry.alive));
                value.insert("count".to_string(), js_number_value(entry.count));
                Value::Object(value)
            })
            .collect(),
    )
}

/// 掉落上下文桶表 → JS 对象。
fn drop_buckets_to_value(map: &OrderedMap<String, OrderedMap<String, Vec<DropBucket>>>) -> Value {
    let by_player = map
        .iter()
        .map(|(player_key, by_monster)| {
            let monsters = by_monster
                .iter()
                .map(|(monster_key, buckets)| {
                    let value = Value::Array(
                        buckets
                            .iter()
                            .map(|bucket| {
                                let mut value = serde_json::Map::new();
                                value.insert("killCount".to_string(), js_number_value(bucket.kill_count));
                                if let Some(tier) = bucket.difficulty_tier {
                                    value.insert("difficultyTier".to_string(), js_number_value(tier));
                                }
                                value.insert(
                                    "dropRateMultiplier".to_string(),
                                    js_number_value(bucket.drop_rate_multiplier),
                                );
                                value.insert(
                                    "rareFindMultiplier".to_string(),
                                    js_number_value(bucket.rare_find_multiplier),
                                );
                                value.insert(
                                    "combatDropQuantity".to_string(),
                                    js_number_value(bucket.combat_drop_quantity),
                                );
                                value.insert(
                                    "debuffOnLevelGap".to_string(),
                                    js_number_value(bucket.debuff_on_level_gap),
                                );
                                Value::Object(value)
                            })
                            .collect(),
                    );
                    (monster_key.clone(), value)
                })
                .collect();
            (player_key.clone(), Value::Object(monsters))
        })
        .collect();
    Value::Object(by_player)
}

/// 攻击表 → JS 四层嵌套对象。
fn attacks_to_value(map: &AttackTable) -> Value {
    let by_source = map
        .iter()
        .map(|(source_key, by_target)| {
            let targets = by_target
                .iter()
                .map(|(target_key, by_ability)| {
                    let abilities = by_ability
                        .iter()
                        .map(|(ability_key, by_hit)| (ability_key.clone(), number_map_to_value(by_hit)))
                        .collect();
                    (target_key.clone(), Value::Object(abilities))
                })
                .collect();
            (source_key.clone(), Value::Object(targets))
        })
        .collect();
    Value::Object(by_source)
}

/// 团灭事件数组 → JS 数组。
fn wipe_events_to_value(events: &[WipeEvent]) -> Value {
    Value::Array(
        events
            .iter()
            .map(|event| {
                let mut value = serde_json::Map::new();
                value.insert("simulationTime".to_string(), js_number_value(event.simulation_time));
                value.insert("logs".to_string(), event.logs.clone());
                value.insert("wave".to_string(), js_number_value(event.wave));
                value.insert("timestamp".to_string(), json!(event.timestamp));
                Value::Object(value)
            })
            .collect(),
    )
}

/// 时序数据 → JS 对象。
fn time_series_to_value(data: &TimeSeriesData) -> Value {
    let players = data
        .players
        .iter()
        .map(|(player_key, series)| {
            let mut value = serde_json::Map::new();
            value.insert("hp".to_string(), Value::Array(series.hp.iter().map(|v| js_number_value(*v)).collect()));
            value.insert("mp".to_string(), Value::Array(series.mp.iter().map(|v| js_number_value(*v)).collect()));
            value.insert("maxHp".to_string(), Value::Array(series.max_hp.iter().map(|v| js_number_value(*v)).collect()));
            value.insert("maxMp".to_string(), Value::Array(series.max_mp.iter().map(|v| js_number_value(*v)).collect()));
            (player_key.clone(), Value::Object(value))
        })
        .collect();
    let mut value = serde_json::Map::new();
    value.insert(
        "timestamps".to_string(),
        Value::Array(data.timestamps.iter().map(|v| js_number_value(*v)).collect()),
    );
    value.insert("players".to_string(), Value::Object(players));
    Value::Object(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    // 以下期望值全部由真实 JS 类产出：临时 vitest 脚本对 `SimResult` / `FoodOptimizerSimResult`
    // 调用同样的方法序列后 `JSON.stringify` 落盘（脚本已删除，输出逐字抄录到这里）。
    // 对比按 JSON 值做，键序无关（serde_json 的对象比较不要求键序）。

    fn expected_json(text: &str) -> Value {
        serde_json::from_str(text).expect("硬编码的期望值必须是合法 JSON")
    }

    /// 经验增益表（Vec）→ JS 对象，便于与 JS 的 gains 对象逐键比对。
    fn gains_to_value(gains: &[(String, f64)]) -> Value {
        Value::Object(gains.iter().map(|(skill, value)| (skill.clone(), js_number_value(*value))).collect())
    }

    /// `/combat_styles/smash` 的 `skillExpMap` 键序（`combatStyleDetailMap.json` 的声明顺序）。
    fn smash_style_map() -> Vec<(String, Vec<String>)> {
        vec![(
            "/combat_styles/smash".to_string(),
            vec![
                "/skills/attack".to_string(),
                "/skills/defense".to_string(),
                "/skills/intelligence".to_string(),
                "/skills/melee".to_string(),
                "/skills/stamina".to_string(),
            ],
        )]
    }

    fn skill_experience(
        stamina: f64,
        intelligence: f64,
        attack: f64,
        melee: f64,
        defense: f64,
        ranged: f64,
        magic: f64,
    ) -> Vec<(String, f64)> {
        vec![
            ("stamina".to_string(), stamina),
            ("intelligence".to_string(), intelligence),
            ("attack".to_string(), attack),
            ("melee".to_string(), melee),
            ("defense".to_string(), defense),
            ("ranged".to_string(), ranged),
            ("magic".to_string(), magic),
        ]
    }

    /// JS 侧 P1：primary `/skills/attack`、focus `/skills/melee`（在 smash 表内）、非零经验加成。
    fn p1_params(experience: f64) -> ExperienceGainParams {
        ExperienceGainParams {
            hrid: "/players/p1".to_string(),
            experience,
            primary_training: Some("/skills/attack".to_string()),
            focus_training: Some("/skills/melee".to_string()),
            combat_style_hrid: Some("/combat_styles/smash".to_string()),
            combat_experience: 0.25,
            skill_experience: skill_experience(0.5, 0.0, 3.0, 1.5, 0.125, 0.0, 0.0),
            debuff_on_level_gap: 0.0,
        }
    }

    /// JS 侧 P2：primary `/skills/stamina`、无 focus → 走平均分摊分支。
    fn p2_params(experience: f64) -> ExperienceGainParams {
        ExperienceGainParams {
            hrid: "/players/p2".to_string(),
            experience,
            primary_training: Some("/skills/stamina".to_string()),
            focus_training: None,
            combat_style_hrid: Some("/combat_styles/smash".to_string()),
            combat_experience: 0.0,
            skill_experience: skill_experience(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            debuff_on_level_gap: 0.0,
        }
    }

    /// JS 侧 P3：focus `/skills/magic` 不在 smash 表内 → `skillExpMap[focusTraining]` 为假，走分摊分支。
    fn p3_params(experience: f64) -> ExperienceGainParams {
        ExperienceGainParams {
            hrid: "/players/p3".to_string(),
            experience,
            primary_training: Some("/skills/attack".to_string()),
            focus_training: Some("/skills/magic".to_string()),
            combat_style_hrid: Some("/combat_styles/smash".to_string()),
            combat_experience: 0.0,
            skill_experience: skill_experience(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            debuff_on_level_gap: 0.0,
        }
    }

    const CONSTRUCTOR_FULL: &str = r#"{
      "deaths": {},
      "experienceGained": {},
      "encounters": 0,
      "attacks": {},
      "consumablesUsed": {},
      "hitpointsGained": {},
      "manapointsGained": {},
      "debuffOnLevelGap": {},
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "dropContextBuckets": {},
      "dropRateMultiplier": {},
      "rareFindMultiplier": {},
      "combatDropQuantity": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "manaUsed": {},
      "timeSpentAlive": [],
      "bossSpawns": [],
      "hitpointsSpent": {},
      "zoneName": "/zones/zone_a",
      "difficultyTier": 2,
      "isDungeon": false,
      "isLabyrinth": false,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 2,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "wipeEvents": [],
      "timeSeriesData": { "timestamps": [], "players": {} }
    }"#;

    const CONSTRUCTOR_FULL_LABYRINTH: &str = r#"{
      "deaths": {},
      "experienceGained": {},
      "encounters": 0,
      "attacks": {},
      "consumablesUsed": {},
      "hitpointsGained": {},
      "manapointsGained": {},
      "debuffOnLevelGap": {},
      "scrollUsage": { "allowed": false, "ignoredReason": "labyrinth", "disabled": false, "byPlayer": {} },
      "dropContextBuckets": {},
      "dropRateMultiplier": {},
      "rareFindMultiplier": {},
      "combatDropQuantity": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "manaUsed": {},
      "timeSpentAlive": [],
      "bossSpawns": [],
      "hitpointsSpent": {},
      "zoneName": "/zones/zone_b",
      "difficultyTier": 1,
      "labyrinthName": "/monsters/trork",
      "roomLevel": 5,
      "isDungeon": false,
      "isLabyrinth": true,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 1,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "wipeEvents": [],
      "timeSeriesData": { "timestamps": [], "players": {} }
    }"#;

    const CONSTRUCTOR_MINIMAL: &str = r#"{
      "deaths": {},
      "consumablesUsed": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "timeSpentAlive": [],
      "bossSpawns": [],
      "isDungeon": false,
      "isLabyrinth": false,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 3,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "simulatedTime": 0,
      "stoppedEarly": false
    }"#;

    const CONSTRUCTOR_MINIMAL_LABYRINTH: &str = r#"{
      "deaths": {},
      "consumablesUsed": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "scrollUsage": { "allowed": false, "ignoredReason": "labyrinth", "disabled": false, "byPlayer": {} },
      "timeSpentAlive": [],
      "bossSpawns": [],
      "labyrinthName": "/monsters/trork",
      "roomLevel": 2,
      "isDungeon": false,
      "isLabyrinth": true,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 1,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "simulatedTime": 0,
      "stoppedEarly": false
    }"#;

    const ATTACKS: &str = r#"{
      "/players/p1": {
        "/monsters/m1": {
          "autoAttack": {
            "0": 1,
            "12": 2,
            "0.5": 1,
            "0.30000000000000004": 1,
            "0.3333333333333333": 1,
            "miss": 2,
            "-3.5": 1,
            "1e+21": 1,
            "1e-7": 1
          }
        },
        "/monsters/m2": { "damageOverTime": { "2.5": 1 } }
      },
      "/players/p2": { "/monsters/m1": { "stab": { "100": 1 } } }
    }"#;

    const MISC: &str = r#"{
      "deaths": { "/players/p1": 2, "/monsters/m1": 1 },
      "experienceGained": {},
      "encounters": 2,
      "attacks": {},
      "consumablesUsed": {
        "/players/p1": { "/items/health_potion": 2, "/items/mana_potion": 1 },
        "/monsters/m1": { "/items/health_potion": 1 }
      },
      "hitpointsGained": { "/players/p1": { "regen": 7.5, "lifeSteal": 1 } },
      "manapointsGained": { "/players/p1": { "manaPotion": 10, "regen": 1.25 } },
      "debuffOnLevelGap": {},
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "dropContextBuckets": {},
      "dropRateMultiplier": {},
      "rareFindMultiplier": {},
      "combatDropQuantity": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "manaUsed": {},
      "timeSpentAlive": [],
      "bossSpawns": [],
      "hitpointsSpent": { "/players/p1": { "sacrifice": 3.25 } },
      "zoneName": "/zones/zone_a",
      "difficultyTier": 2,
      "isDungeon": false,
      "isLabyrinth": false,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 2,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "wipeEvents": [],
      "timeSeriesData": {
        "timestamps": [1000000000, 2000000000],
        "players": {
          "/players/p1": { "hp": [100, 100], "mp": [50, 50], "maxHp": [200, 200], "maxMp": [120, 120] },
          "/players/p2": { "hp": [100, 100], "mp": [50, 50], "maxHp": [200, 200], "maxMp": [120, 120] }
        }
      }
    }"#;

    const EXPERIENCE: &str = r#"{
      "/players/p1": { "stamina": 0, "intelligence": 0, "attack": 225, "melee": 328.125, "defense": 0, "ranged": 0, "magic": 0 },
      "/players/p2": {
        "stamina": 109.99999999999999,
        "intelligence": 34.99999999999999,
        "attack": 34.99999999999999,
        "melee": 34.99999999999999,
        "defense": 34.99999999999999,
        "ranged": 0,
        "magic": 0
      },
      "/players/p3": { "stamina": 1.4, "intelligence": 1.4, "attack": 4.3999999999999995, "melee": 1.4, "defense": 1.4, "ranged": 0, "magic": 0 }
    }"#;

    const CALCULATE_FOCUS: &str = r#"{ "attack": 150, "melee": 218.75 }"#;
    const CALCULATE_NO_FOCUS: &str = r#"{
      "stamina": 109.99999999999999,
      "intelligence": 34.99999999999999,
      "attack": 34.99999999999999,
      "melee": 34.99999999999999,
      "defense": 34.99999999999999
    }"#;
    const CALCULATE_FOCUS_NOT_IN_STYLE: &str = r#"{
      "stamina": 1.4,
      "intelligence": 1.4,
      "attack": 4.3999999999999995,
      "melee": 1.4,
      "defense": 1.4
    }"#;

    const DROPS: &str = r#"{
      "/players/p1": {
        "/monsters/boss": [
          {
            "killCount": 7,
            "difficultyTier": 3,
            "dropRateMultiplier": 1.5,
            "rareFindMultiplier": 1.25,
            "combatDropQuantity": 2,
            "debuffOnLevelGap": 0.1
          },
          {
            "killCount": 1,
            "difficultyTier": 3,
            "dropRateMultiplier": 2.5,
            "rareFindMultiplier": 1.25,
            "combatDropQuantity": 2,
            "debuffOnLevelGap": 0.1
          }
        ],
        "/monsters/spawn": [
          {
            "killCount": 1,
            "difficultyTier": 3,
            "dropRateMultiplier": 1.5,
            "rareFindMultiplier": 1.25,
            "combatDropQuantity": 2,
            "debuffOnLevelGap": 0.1
          }
        ],
        "/monsters/rat": [
          {
            "killCount": 1,
            "dropRateMultiplier": 1.5,
            "rareFindMultiplier": 1.25,
            "combatDropQuantity": 2,
            "debuffOnLevelGap": 0.1
          }
        ]
      },
      "/players/p2": {
        "/monsters/boss": [
          {
            "killCount": 3,
            "difficultyTier": 3,
            "dropRateMultiplier": 1,
            "rareFindMultiplier": 1,
            "combatDropQuantity": 1,
            "debuffOnLevelGap": 0
          }
        ]
      }
    }"#;

    const MANA_OUT: &str = r#"{
      "deaths": {},
      "experienceGained": {},
      "encounters": 0,
      "attacks": {},
      "consumablesUsed": {},
      "hitpointsGained": {},
      "manapointsGained": {},
      "debuffOnLevelGap": {},
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "dropContextBuckets": {},
      "dropRateMultiplier": {},
      "rareFindMultiplier": {},
      "combatDropQuantity": {},
      "playerRanOutOfMana": {
        "player1": false,
        "player2": false,
        "player3": false,
        "player4": false,
        "player5": false,
        "/players/p1": true
      },
      "playerRanOutOfManaTime": {
        "/players/p1": { "isOutOfMana": true, "startTimeForOutOfMana": 30000000000, "totalTimeForOutOfMana": 10000000000 },
        "/players/p2": { "isOutOfMana": false, "startTimeForOutOfMana": 0, "totalTimeForOutOfMana": 0 }
      },
      "manaUsed": {},
      "timeSpentAlive": [],
      "bossSpawns": [],
      "hitpointsSpent": {},
      "isDungeon": false,
      "isLabyrinth": false,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 2,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "wipeEvents": [],
      "timeSeriesData": { "timestamps": [], "players": {} }
    }"#;

    const SCROLLS: &str = r#"{
      "allowed": false,
      "ignoredReason": "guild_trial",
      "disabled": true,
      "byPlayer": {
        "/players/p1": {
          "/items/scroll_a": { "configuredQuantity": 5, "openedCount": 2, "activeDurationNs": 30000000000, "exhausted": false },
          "/items/scroll_b": { "configuredQuantity": null, "openedCount": 4, "activeDurationNs": 7000000000, "exhausted": false },
          "/items/scroll_d": { "configuredQuantity": 4, "openedCount": 5, "activeDurationNs": 0, "exhausted": true },
          "/items/scroll_e": { "configuredQuantity": 6, "openedCount": 0, "activeDurationNs": 0, "exhausted": false },
          "/items/scroll_f": { "configuredQuantity": null, "openedCount": 0, "activeDurationNs": 0, "exhausted": false },
          "/items/scroll_never": { "configuredQuantity": null, "openedCount": 0, "activeDurationNs": 5000000000, "exhausted": false }
        }
      }
    }"#;

    const ALIVE: &str = r##"{
      "deaths": {},
      "experienceGained": {},
      "encounters": 0,
      "attacks": {},
      "consumablesUsed": {},
      "hitpointsGained": {},
      "manapointsGained": {},
      "debuffOnLevelGap": {},
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "dropContextBuckets": {},
      "dropRateMultiplier": {},
      "rareFindMultiplier": {},
      "combatDropQuantity": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "manaUsed": {},
      "timeSpentAlive": [
        { "name": "#1", "timeSpentAlive": 3000000000, "spawnedAt": 7000000000, "alive": false, "count": 3 },
        { "name": "trork", "timeSpentAlive": 1000000000, "spawnedAt": 1000000000, "alive": false, "count": 1 }
      ],
      "bossSpawns": [],
      "hitpointsSpent": {},
      "isDungeon": false,
      "isLabyrinth": false,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 1,
      "maxEnrageStack": 0,
      "minDungenonTime": 13000000000,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "wipeEvents": [],
      "timeSeriesData": { "timestamps": [], "players": {} }
    }"##;

    const SUMMARY: &str = r##"{
      "deaths": {},
      "experienceGained": {},
      "encounters": 0,
      "attacks": {},
      "consumablesUsed": {},
      "hitpointsGained": {},
      "manapointsGained": {},
      "debuffOnLevelGap": { "/players/p1": 0, "/players/p2": 0 },
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "dropContextBuckets": {},
      "dropRateMultiplier": { "/players/p1": 1, "/players/p2": 1 },
      "rareFindMultiplier": { "/players/p1": 1, "/players/p2": 1 },
      "combatDropQuantity": { "/players/p1": 0, "/players/p2": 0 },
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "manaUsed": { "/players/p2": { "/abilities/c": 1 }, "/players/p1": {} },
      "timeSpentAlive": [
        { "name": "#1", "timeSpentAlive": 0, "spawnedAt": 0, "alive": true, "count": 0 }
      ],
      "bossSpawns": ["#1,/monsters/a", "/monsters/b"],
      "hitpointsSpent": {},
      "zoneName": "/zones/zone_d",
      "difficultyTier": 1,
      "isDungeon": true,
      "isLabyrinth": false,
      "dungeonsCompleted": 2,
      "dungeonsFailed": 1,
      "maxWaveReached": 7,
      "numberOfPlayers": 2,
      "maxEnrageStack": 4,
      "minDungenonTime": 12.5,
      "lastDungeonFinishTime": 100,
      "lastEncounterFinishTime": 200,
      "wipeEvents": [],
      "timeSeriesData": { "timestamps": [], "players": {} },
      "simulatedTime": 4321.5,
      "stoppedEarly": true
    }"##;

    const MINIMAL_NOOPS_AFTER: &str = r#"{
      "deaths": {},
      "consumablesUsed": {},
      "playerRanOutOfMana": { "player1": false, "player2": false, "player3": false, "player4": false, "player5": false },
      "playerRanOutOfManaTime": {},
      "scrollUsage": { "allowed": true, "ignoredReason": "", "disabled": false, "byPlayer": {} },
      "timeSpentAlive": [],
      "bossSpawns": [],
      "isDungeon": false,
      "isLabyrinth": false,
      "dungeonsCompleted": 0,
      "dungeonsFailed": 0,
      "maxWaveReached": 0,
      "numberOfPlayers": 2,
      "maxEnrageStack": 0,
      "minDungenonTime": 0,
      "lastDungeonFinishTime": 0,
      "lastEncounterFinishTime": 0,
      "simulatedTime": 0,
      "stoppedEarly": false
    }"#;

    const MINIMAL_WRITES: &str = r##"{
      "deaths": { "/players/p1": 2 },
      "consumablesUsed": { "/players/p1": { "/items/potion": 1 } },
      "playerRanOutOfMana": {
        "player1": false,
        "player2": false,
        "player3": false,
        "player4": false,
        "player5": false,
        "/players/p1": true
      },
      "playerRanOutOfManaTime": {
        "/players/p1": { "isOutOfMana": false, "startTimeForOutOfMana": 1000000000, "totalTimeForOutOfMana": 2000000000 }
      },
      "scrollUsage": {
        "allowed": false,
        "ignoredReason": "scrolls_not_allowed",
        "disabled": true,
        "byPlayer": {
          "/players/p1": {
            "/items/scroll_a": { "configuredQuantity": 2, "openedCount": 1, "activeDurationNs": 10000000000, "exhausted": false }
          }
        }
      },
      "timeSpentAlive": [],
      "bossSpawns": ["#1,/monsters/a"],
      "isDungeon": true,
      "isLabyrinth": false,
      "dungeonsCompleted": 1,
      "dungeonsFailed": 0,
      "maxWaveReached": 3,
      "numberOfPlayers": 2,
      "maxEnrageStack": 2,
      "minDungenonTime": 5,
      "lastDungeonFinishTime": 7,
      "lastEncounterFinishTime": 8,
      "simulatedTime": 123,
      "stoppedEarly": true
    }"##;

    const WIPE_EVENTS: &str = r#"[
      {
        "simulationTime": 12000000000,
        "logs": [{ "t": 1, "message": "dead" }],
        "wave": 3,
        "timestamp": "FIXED_TIMESTAMP"
      },
      { "simulationTime": 20000000000, "logs": [], "wave": 4, "timestamp": "FIXED_TIMESTAMP" }
    ]"#;

    #[test]
    fn constructor_field_sets_match_js() {
        // 普通分支：字段齐全，且构造后没有 simulatedTime / stoppedEarly（JS 未赋值）。
        assert_eq!(
            SimResultState::new(false, Some("/zones/zone_a".to_string()), Some(2.0), None, None, 2, Vec::new()).to_value(),
            expected_json(CONSTRUCTOR_FULL)
        );
        assert_eq!(
            SimResultState::new(
                false,
                Some("/zones/zone_b".to_string()),
                Some(1.0),
                Some("/monsters/trork".to_string()),
                Some(5.0),
                1,
                Vec::new(),
            )
            .to_value(),
            expected_json(CONSTRUCTOR_FULL_LABYRINTH)
        );
        // minimal 分支：字段少一半，simulatedTime / stoppedEarly 初值 0 / false。
        assert_eq!(
            SimResultState::new(true, None, None, None, None, 3, Vec::new()).to_value(),
            expected_json(CONSTRUCTOR_MINIMAL)
        );
        assert_eq!(
            SimResultState::new(true, None, None, Some("/monsters/trork".to_string()), Some(2.0), 1, Vec::new()).to_value(),
            expected_json(CONSTRUCTOR_MINIMAL_LABYRINTH)
        );
    }

    #[test]
    fn js_number_key_matches_js_string_conversion() {
        // 期望值 = JS `[...].map(String)`（`Number.prototype.toString` 语义）。
        let values = [
            12.0,
            12.5,
            0.1 + 0.2,
            1.0 / 3.0,
            0.0,
            -0.0,
            -3.5,
            1e21,
            1e-7,
            1e-6,
            1e20,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ];
        let texts = [
            "12",
            "12.5",
            "0.30000000000000004",
            "0.3333333333333333",
            "0",
            "0",
            "-3.5",
            "1e+21",
            "1e-7",
            "0.000001",
            "100000000000000000000",
            "NaN",
            "Infinity",
            "-Infinity",
        ];
        assert_eq!(values.len(), texts.len());
        for (value, text) in values.iter().zip(texts.iter()) {
            assert_eq!(&js_number_key(*value), text, "js_number_key({value})");
        }
    }

    #[test]
    fn attack_table_nested_keys_match_js() {
        let mut state = SimResultState::new(false, None, None, None, None, 2, Vec::new());
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(12.0));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(12.0));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(0.5));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(0.1 + 0.2));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(1.0 / 3.0));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(0.0));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Miss);
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Miss);
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(-3.5));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(1e21));
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(1e-7));
        state.add_attack("/players/p1", "/monsters/m2", "damageOverTime", &AttackOutcome::Damage(2.5));
        state.add_attack("/players/p2", "/monsters/m1", "stab", &AttackOutcome::Damage(100.0));
        assert_eq!(state.to_value()["attacks"], expected_json(ATTACKS));
    }

    #[test]
    fn deaths_consumables_and_gains_match_js() {
        let mut state = SimResultState::new(
            false,
            Some("/zones/zone_a".to_string()),
            Some(2.0),
            None,
            None,
            2,
            Vec::new(),
        );
        state.add_death("/players/p1");
        state.add_death("/players/p1");
        state.add_death("/monsters/m1");
        state.add_consumable_use("/players/p1", "/items/health_potion");
        state.add_consumable_use("/players/p1", "/items/health_potion");
        state.add_consumable_use("/players/p1", "/items/mana_potion");
        state.add_consumable_use("/monsters/m1", "/items/health_potion");
        state.add_hitpoints_gained("/players/p1", "regen", 5.0);
        state.add_hitpoints_gained("/players/p1", "regen", 2.5);
        state.add_hitpoints_gained("/players/p1", "lifeSteal", 1.0);
        state.add_manapoints_gained("/players/p1", "manaPotion", 10.0);
        state.add_manapoints_gained("/players/p1", "regen", 1.25);
        state.add_hitpoints_spent("/players/p1", "sacrifice", 3.25);
        state.add_encounter_end();
        state.add_encounter_end();
        let players = [
            ("/players/p1".to_string(), 100.0, 50.0, 200.0, 120.0),
            ("/players/p2".to_string(), 100.0, 50.0, 200.0, 120.0),
        ];
        state.add_time_series_snapshot(1e9, &players);
        state.add_time_series_snapshot(2e9, &players);
        assert_eq!(state.to_value(), expected_json(MISC));
    }

    #[test]
    fn experience_gain_matches_js() {
        let mut state = SimResultState::new(false, None, None, None, None, 3, smash_style_map());
        state.add_experience_gain(&p1_params(100.0));
        state.add_experience_gain(&p1_params(50.0));
        state.add_experience_gain(&p2_params(250.0));
        state.add_experience_gain(&p3_params(10.0));
        // JS 还对非玩家单位调用过一次 addExperienceGain（`unit?.isPlayer` 守卫使其无效果），
        // Rust 侧由调用方负责不调用，故这里不产生任何键。
        assert_eq!(state.to_value()["experienceGained"], expected_json(EXPERIENCE));

        // 有 focusTraining（在风格技能表内）→ 只写主训练与 focus 两个技能。
        assert_eq!(
            gains_to_value(&state.calculate_experience_gain(&p1_params(100.0)).expect("P1 应算出增益")),
            expected_json(CALCULATE_FOCUS)
        );
        // 无 focusTraining → 0.7 按风格技能数平摊（smash 为 5 个技能）。
        assert_eq!(
            gains_to_value(&state.calculate_experience_gain(&p2_params(250.0)).expect("P2 应算出增益")),
            expected_json(CALCULATE_NO_FOCUS)
        );
        // focusTraining 不在风格技能表内 → 同样走平摊分支。
        assert_eq!(
            gains_to_value(&state.calculate_experience_gain(&p3_params(10.0)).expect("P3 应算出增益")),
            expected_json(CALCULATE_FOCUS_NOT_IN_STYLE)
        );

        // 缺 primaryTraining / 风格表（JS 会抛 TypeError）→ Rust 返回 None。
        let mut missing_primary = p1_params(100.0);
        missing_primary.primary_training = None;
        assert_eq!(state.calculate_experience_gain(&missing_primary), None);
        let mut unknown_style = p1_params(100.0);
        unknown_style.combat_style_hrid = Some("/combat_styles/unknown".to_string());
        assert_eq!(state.calculate_experience_gain(&unknown_style), None);
        // minimal 分支既不计算也不记账（整份结果与未调用时相同）。
        let mut minimal = SimResultState::new(true, None, None, None, None, 2, smash_style_map());
        assert_eq!(minimal.calculate_experience_gain(&p1_params(100.0)), None);
        minimal.add_experience_gain(&p1_params(100.0));
        assert!(!minimal.to_value().as_object().expect("结果必然是对象").contains_key("experienceGained"));
        assert_eq!(minimal.to_value(), expected_json(MINIMAL_NOOPS_AFTER));
    }

    #[test]
    fn drop_context_buckets_match_js() {
        let mut state = SimResultState::new(
            false,
            Some("/zones/zone_a".to_string()),
            Some(2.0),
            None,
            None,
            2,
            Vec::new(),
        );
        // P1：入参是调用方按 JS `readMultiplier` 口径算好的倍率
        // （1 + combatDropRate 0.5 = 1.5、1 + combatRareFind 0.25 = 1.25、combatDropQuantity 2、
        //   debuffOnLevelGap 0.1）。
        let player = ("/players/p1", 1.5, 1.25, 2.0, 0.1);
        state
            .record_monster_death_from_context(player.0, "/monsters/boss", 1.0, Some(3.0), player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // 同签名 → 合并到最近的桶。
        state
            .record_monster_death_from_context(player.0, "/monsters/boss", 2.0, Some(3.0), player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // 小数难度档 → floor 后取 3。
        state
            .record_monster_death_from_context(player.0, "/monsters/spawn", 1.0, Some(3.7), player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // 未提供难度档 → 桶里没有 difficultyTier 键。
        state
            .record_monster_death_from_context(player.0, "/monsters/rat", 1.0, None, player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // 新的掉落倍率签名（combatDropRate 改为 1.5 → 倍率 2.5）→ 新桶。
        state
            .record_monster_death_from_context(player.0, "/monsters/boss", 1.0, Some(3.0), 2.5, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // 回到旧签名 → `find` 回退合并到最早的同签桶（killCount 3 + 4 = 7）。
        state
            .record_monster_death_from_context(player.0, "/monsters/boss", 4.0, Some(3.0), player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // killCount <= 0 / 玩家键为空 → 静默忽略。
        state
            .record_monster_death_from_context(player.0, "/monsters/boss", 0.0, Some(3.0), player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        state
            .record_monster_death_from_context("", "/monsters/boss", 1.0, Some(3.0), player.1, player.2, player.3, player.4)
            .expect("JS 在此从不抛错");
        // P2：倍率 1 + 0 = 1 / 1 + 0 = 1，combatDropQuantity 1、debuffOnLevelGap 0。
        state
            .record_monster_death_from_context("/players/p2", "/monsters/boss", 3.0, Some(3.0), 1.0, 1.0, 1.0, 0.0)
            .expect("JS 在此从不抛错");
        assert_eq!(state.to_value()["dropContextBuckets"], expected_json(DROPS));
    }

    #[test]
    fn mana_out_timer_matches_js() {
        let mut state = SimResultState::new(false, None, None, None, None, 2, Vec::new());
        state.add_ran_out_of_mana_count("/players/p1", true, 10e9);
        // 已在空蓝态 → 不重置起点。
        state.add_ran_out_of_mana_count("/players/p1", true, 15e9);
        // 恢复 → 累计 20e9 - 10e9。
        state.add_ran_out_of_mana_count("/players/p1", false, 20e9);
        // 非空蓝态 → 不累计。
        state.add_ran_out_of_mana_count("/players/p1", false, 25e9);
        state.add_ran_out_of_mana_count("/players/p1", true, 30e9);
        // 从未空蓝的玩家只建默认条目。
        state.add_ran_out_of_mana_count("/players/p2", false, 40e9);
        assert_eq!(state.to_value(), expected_json(MANA_OUT));
    }

    #[test]
    fn scroll_bookkeeping_matches_js() {
        let mut state = SimResultState::new(false, None, None, None, None, 1, Vec::new());
        state.set_scroll_usage_context(false, "guild_trial");
        state.set_scroll_usage_disabled(true);
        state.set_scroll_configuration("/players/p1", "/items/scroll_a", Some(5.0));
        // null（Rust None）＝ 无限库存。
        state.set_scroll_configuration("/players/p1", "/items/scroll_b", None);
        // 0 / 1.5 / -2 都不是「有限安全正整数」→ 整调用返回，不注册。
        state.set_scroll_configuration("/players/p1", "/items/scroll_bad", Some(0.0));
        state.set_scroll_configuration("/players/p1", "/items/scroll_frac", Some(1.5));
        state.set_scroll_configuration("/players/p1", "/items/scroll_neg", Some(-2.0));
        // 玩家键 / 物品键去空白后为空 → 不注册。
        state.set_scroll_configuration("   ", "/items/scroll_c", Some(3.0));
        state.set_scroll_configuration("/players/p1", "  ", Some(3.0));
        state.set_scroll_configuration("/players/p1", "/items/scroll_d", Some(4.0));
        state.set_scroll_configuration("/players/p1", "/items/scroll_e", Some(6.0));
        // JS 传 `{}`（configuredQuantity undefined）→ 注册且保持 null。
        state.set_scroll_configuration("/players/p1", "/items/scroll_f", None);

        state.record_scroll_open("/players/p1", "/items/scroll_a", 1.0, f64::NAN, Some(false));
        state.record_scroll_open("/players/p1", "/items/scroll_a", 1.0, f64::NAN, Some(false));
        state.record_scroll_window("/players/p1", "/items/scroll_a", 30e9);
        // 非正时长不入账。
        state.record_scroll_window("/players/p1", "/items/scroll_a", 0.0);
        // 没配置过的物品也会建条目。
        state.record_scroll_window("/players/p1", "/items/scroll_never", 5e9);
        state.record_scroll_open("/players/p1", "/items/scroll_b", 1.0, f64::NAN, Some(false));
        // openedCount 非有限 → 记 1；exhausted 未提供且 configuredQuantity 为 null → 保持 false。
        state.record_scroll_open("/players/p1", "/items/scroll_b", f64::NAN, f64::NAN, None);
        // openedCount 2.7 → floor 记 2；时长走 metadata 口径。
        state.record_scroll_open("/players/p1", "/items/scroll_b", 2.7, 7e9, None);
        // exhausted 未提供且已配置数量 → 5 >= 4 推断为 true。
        state.record_scroll_open("/players/p1", "/items/scroll_d", 5.0, f64::NAN, None);
        // 物品键为空 → 不注册。
        state.record_scroll_open("/players/p1", "   ", 1.0, f64::NAN, None);
        assert_eq!(state.to_value()["scrollUsage"], expected_json(SCROLLS));
    }

    #[test]
    fn alive_timer_and_dungeon_timer_match_js() {
        let mut state = SimResultState::new(false, None, None, None, None, 1, Vec::new());
        state.update_time_spent_alive("#1", true, 0.0).expect("活着的分支不报错");
        state.update_time_spent_alive("#1", false, 5e9).expect("条目已存在");
        // 再次复活 → 重置 spawnedAt 并置 alive。
        state.update_time_spent_alive("#1", true, 7e9).expect("条目已存在");
        state.update_time_spent_alive("#1", false, 9e9).expect("条目已存在");
        state.update_time_spent_alive("trork", true, 1e9).expect("活着的分支不报错");
        state.update_time_spent_alive("trork", false, 2e9).expect("条目已存在");
        // 副本计时：只有第一次（minDungenonTime == 0）与更小的值会写入。
        state.update_dungenon_finish("#1", 20e9);
        // 找不到条目 → 静默返回。
        state.update_dungenon_finish("#9", 30e9);
        state.update_dungenon_finish("#1", 100e9);
        // 负数存活时长照常累加（JS 不做保护）。
        state.update_time_spent_alive("#1", false, 3e9).expect("条目已存在");
        assert_eq!(state.to_value(), expected_json(ALIVE));

        // 找不到条目且 alive=false → JS `undefined.spawnedAt` 的 TypeError，消息逐字一致。
        let mut missing = SimResultState::new(false, None, None, None, None, 1, Vec::new());
        let error = missing.update_time_spent_alive("nobody", false, 1.0).expect_err("JS 会抛 TypeError");
        assert_eq!(error, UnitError::type_error("Cannot read properties of undefined (reading 'spawnedAt')"));
        assert_eq!(error.kind, crate::unit::UnitErrorKind::TypeError);
    }

    #[test]
    fn summary_setters_match_js() {
        let mut state = SimResultState::new(
            false,
            Some("/zones/zone_d".to_string()),
            Some(1.0),
            None,
            None,
            2,
            Vec::new(),
        );
        state.set_simulated_time(4321.5);
        state.set_stopped_early(true);
        state.set_is_dungeon(true);
        state.set_dungeon_summary(2.0, 1.0, 7.0);
        state.set_max_enrage_stack(4.0);
        // minDungenonTime 没有 setter（JS 侧是裸属性赋值 `r.minDungenonTime = ...`）：
        // 走生产路径 updateTimeSpentAlive + updateDungenonFinish，与 JS 期望值同一来源。
        state.update_time_spent_alive("#1", true, 0.0).expect("活着的分支不报错");
        state.update_dungenon_finish("#1", 12.5);
        state.set_last_dungeon_finish_time(100.0);
        state.set_last_encounter_finish_time(200.0);
        state.push_boss_spawn("#1,/monsters/a".to_string());
        state.push_boss_spawn("/monsters/b".to_string());
        state.set_drop_rate_multipliers("/players/p1", 0.0, 0.0, 0.0, 0.0);
        state.set_drop_rate_multipliers("/players/p2", 0.0, 0.0, 0.0, 0.0);
        // 第二次 setManaUsed 是整体替换（JS 先置 {} 再逐项写入）。
        state.set_mana_used("/players/p2", &[("/abilities/a".to_string(), 5.0), ("/abilities/b".to_string(), 12.5)]);
        state.set_mana_used("/players/p2", &[("/abilities/c".to_string(), 1.0)]);
        state.set_mana_used("/players/p1", &[]);
        assert_eq!(state.to_value(), expected_json(SUMMARY));

        // 普通分支下 minDungenonTime 初值 0 时才会被 updateDungenonFinish 写入。
        let mut fresh = SimResultState::new(false, None, None, None, None, 1, Vec::new());
        assert!(!fresh.is_minimal());
        fresh.set_dungeon_summary(0.0, 0.0, 0.0);
        assert_eq!(fresh.to_value()["minDungenonTime"], js_number_value(0.0));
    }

    #[test]
    fn minimal_noops_do_not_change_result() {
        let mut state = SimResultState::new(true, None, None, None, None, 2, smash_style_map());
        let before = state.to_value();
        state.add_wipe_event(Value::Array(Vec::new()), 1e9, 1.0, "TS".to_string());
        state.update_time_spent_alive("#1", true, 1e9).expect("minimal 空操作不报错");
        state.update_dungenon_finish("#1", 2e9);
        state.add_encounter_end();
        state.add_attack("/players/p1", "/monsters/m1", "autoAttack", &AttackOutcome::Damage(5.0));
        state.add_hitpoints_gained("/players/p1", "regen", 5.0);
        state.add_manapoints_gained("/players/p1", "regen", 5.0);
        state.add_hitpoints_spent("/players/p1", "sacrifice", 5.0);
        state.add_experience_gain(&p1_params(100.0));
        assert_eq!(state.calculate_experience_gain(&p1_params(100.0)), None);
        state
            .record_monster_death_from_context("/players/p1", "/monsters/m1", 1.0, None, 1.0, 1.0, 1.0, 0.0)
            .expect("minimal 下 recordMonsterDeathFromContext 是空操作");
        state.set_drop_rate_multipliers("/players/p1", 0.0, 0.0, 0.0, 0.0);
        state.set_mana_used("/players/p1", &[("/abilities/a".to_string(), 1.0)]);
        state.add_time_series_snapshot(1e9, &[("/players/p1".to_string(), 1.0, 2.0, 3.0, 4.0)]);
        assert_eq!(state.to_value(), before);
        assert_eq!(state.to_value(), expected_json(MINIMAL_NOOPS_AFTER));
    }

    #[test]
    fn minimal_still_writes_deaths_mana_and_scrolls() {
        let mut state = SimResultState::new(true, None, None, None, None, 2, Vec::new());
        state.add_death("/players/p1");
        state.add_death("/players/p1");
        state.add_consumable_use("/players/p1", "/items/potion");
        state.add_ran_out_of_mana_count("/players/p1", true, 1e9);
        state.add_ran_out_of_mana_count("/players/p1", false, 3e9);
        // 空原因串 → JS `ignoredReason || 'scrolls_not_allowed'` 落默认值。
        state.set_scroll_usage_context(false, "");
        state.set_scroll_usage_disabled(true);
        state.set_scroll_configuration("/players/p1", "/items/scroll_a", Some(2.0));
        state.record_scroll_open("/players/p1", "/items/scroll_a", 1.0, f64::NAN, Some(false));
        state.record_scroll_window("/players/p1", "/items/scroll_a", 10e9);
        state.set_simulated_time(123.0);
        state.set_stopped_early(true);
        state.set_is_dungeon(true);
        state.set_dungeon_summary(1.0, 0.0, 3.0);
        state.set_max_enrage_stack(2.0);
        state.set_last_dungeon_finish_time(7.0);
        state.set_last_encounter_finish_time(8.0);
        state.push_boss_spawn("#1,/monsters/a".to_string());
        // minimal 下 updateDungenonFinish 是空操作 → minDungenonTime 保持 0
        // （JS 期望里的 5 是裸属性赋值 `r.minDungenonTime = 5`，Rust 侧没有该 setter，
        //   生产路径的 minDungenonTime 只由 updateDungenonFinish 维护）。
        state.update_dungenon_finish("#1", 5.0);
        assert_eq!(state.to_value()["minDungenonTime"], js_number_value(0.0));

        let expected = expected_json(MINIMAL_WRITES);
        let actual = state.to_value();
        assert_eq!(actual["deaths"], expected["deaths"]);
        assert_eq!(actual["consumablesUsed"], expected["consumablesUsed"]);
        assert_eq!(actual["playerRanOutOfMana"], expected["playerRanOutOfMana"]);
        assert_eq!(actual["playerRanOutOfManaTime"], expected["playerRanOutOfManaTime"]);
        assert_eq!(actual["scrollUsage"], expected["scrollUsage"]);
        assert_eq!(actual["bossSpawns"], expected["bossSpawns"]);
        assert_eq!(actual["simulatedTime"], expected["simulatedTime"]);
        assert_eq!(actual["stoppedEarly"], expected["stoppedEarly"]);
        assert_eq!(actual["isDungeon"], expected["isDungeon"]);
        assert_eq!(actual["maxEnrageStack"], expected["maxEnrageStack"]);
        assert_eq!(actual["dungeonsCompleted"], expected["dungeonsCompleted"]);
        assert_eq!(actual["maxWaveReached"], expected["maxWaveReached"]);
        assert_eq!(actual["lastDungeonFinishTime"], expected["lastDungeonFinishTime"]);
        assert_eq!(actual["lastEncounterFinishTime"], expected["lastEncounterFinishTime"]);
    }

    #[test]
    fn wipe_events_match_js() {
        let mut state = SimResultState::new(false, None, None, None, None, 1, Vec::new());
        // timestamp 由调用方注入（JS 在这里写 `new Date().toISOString()`）。
        state.add_wipe_event(
            json!([{ "t": 1, "message": "dead" }]),
            12e9,
            3.0,
            "FIXED_TIMESTAMP".to_string(),
        );
        state.add_wipe_event(Value::Array(Vec::new()), 20e9, 4.0, "FIXED_TIMESTAMP".to_string());
        assert_eq!(state.to_value()["wipeEvents"], expected_json(WIPE_EVENTS));
    }
}
