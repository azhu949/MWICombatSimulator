//! 战斗单位（CombatUnit）核心：增益注册/源选择/过期 + 派生属性结算。
//! 逐行复刻 JS 侧 `src/combatsimulator/combatUnit.js`：
//! - 属性结算 `updateCombatDetailsFromBuffs`（JS 406-613 行）；
//! - 增益生命周期 `addBuff` / `reconcileBuffSource` / `removeBuff*` / 过期扫描 / `clearBuffs`（JS 615-966 行）。
//!
//! 逐位 parity 要点：
//! - 所有浮点表达式保持与 JS 完全相同的运算顺序（浮点不满足结合律）；
//! - combatBuffs / permanentBuffs / buffSources 等按插入序遍历（见 `ordered_map`）；
//! - 结算期增益索引（等价 JS `buffBoostSnapshots`）在结算开头构建一次，全程使用；
//! - JS `updateCombatDetails` 的 FRESH_COMBAT_STATS 分支只是省去「刚捕获即写回」的复制，
//!   结果与完整恢复一致，此处不做分支。
//!
//! 刻意保留的 JS 既有怪癖（不得「改进」）：
//! - `addPermanentBuff` 直接按 typeHrid 累加 ratio/flat，不做等级并入；
//! - REPLACE 策略下活动源被移除/过期时级联清除该 uniqueHrid 的所有源（无休眠交接）；
//! - STRONGEST 策略平局保留先注册者；最强比较仅对官方队伍光环开放；
//! - `removeExpiredBuffByUniqueHrid` / `removeExpiredBuffs` 返回「属性是否变脏」布尔，
//!   而 `removeBuff` / `clearBuffs` 等包装方法不返回任何值（探针轨迹记 null）；
//! - threat 结算的 `if (ratioBoost !== 0)` 分支：ratio 为 0 时直接覆盖为 base 再叠加 flat。

use crate::ability::Ability;
use crate::buff::{
    buffs_affect_stats_equally, get_party_aura_buff_strength, is_stronger_party_aura_buff, Buff, BuffSourcePolicy,
    PartyAuraError, PartyAuraErrorKind,
};
use crate::consumable::Consumable;
use crate::ordered_map::OrderedMap;
use serde::{Deserialize, Serialize};

/// 单位操作错误的类别（与 JS 抛出的内置错误一一对应）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnitErrorKind {
    TypeError,
    Error,
    RangeError,
}

impl UnitErrorKind {
    pub fn name(&self) -> &'static str {
        match self {
            UnitErrorKind::TypeError => "TypeError",
            UnitErrorKind::Error => "Error",
            UnitErrorKind::RangeError => "RangeError",
        }
    }
}

/// 单位操作错误：保留类别与消息，供探针逐字对账 JS 的异常。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnitError {
    pub kind: UnitErrorKind,
    pub message: String,
}

impl UnitError {
    pub fn type_error(message: impl Into<String>) -> Self {
        Self { kind: UnitErrorKind::TypeError, message: message.into() }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self { kind: UnitErrorKind::Error, message: message.into() }
    }
}

impl From<PartyAuraError> for UnitError {
    fn from(error: PartyAuraError) -> Self {
        let kind = match error.kind {
            PartyAuraErrorKind::TypeError => UnitErrorKind::TypeError,
            PartyAuraErrorKind::RangeError => UnitErrorKind::RangeError,
            PartyAuraErrorKind::Error => UnitErrorKind::Error,
        };
        Self { kind, message: error.message }
    }
}

impl std::fmt::Display for UnitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.kind.name(), self.message)
    }
}

/// 战斗数值面板（等价 JS `combatDetails.combatStats` 全字段）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatStats {
    pub combat_style_hrid: String,
    pub damage_type: String,
    pub attack_interval: f64,
    pub auto_attack_damage: f64,
    pub ability_damage: f64,
    pub critical_rate: f64,
    pub critical_damage: f64,
    pub stab_accuracy: f64,
    pub slash_accuracy: f64,
    pub smash_accuracy: f64,
    pub ranged_accuracy: f64,
    pub magic_accuracy: f64,
    pub stab_damage: f64,
    pub slash_damage: f64,
    pub smash_damage: f64,
    pub ranged_damage: f64,
    pub magic_damage: f64,
    pub defensive_damage: f64,
    pub task_damage: f64,
    pub physical_amplify: f64,
    pub water_amplify: f64,
    pub nature_amplify: f64,
    pub fire_amplify: f64,
    pub healing_amplify: f64,
    pub physical_thorns: f64,
    pub elemental_thorns: f64,
    pub max_hitpoints: f64,
    pub max_manapoints: f64,
    pub stab_evasion: f64,
    pub slash_evasion: f64,
    pub smash_evasion: f64,
    pub ranged_evasion: f64,
    pub magic_evasion: f64,
    pub armor: f64,
    pub water_resistance: f64,
    pub nature_resistance: f64,
    pub fire_resistance: f64,
    pub life_steal: f64,
    pub hp_regen_per10: f64,
    pub mp_regen_per10: f64,
    pub combat_drop_rate: f64,
    pub combat_drop_quantity: f64,
    pub combat_rare_find: f64,
    pub combat_experience: f64,
    pub food_slots: f64,
    pub drink_slots: f64,
    pub armor_penetration: f64,
    pub water_penetration: f64,
    pub nature_penetration: f64,
    pub fire_penetration: f64,
    pub mana_leech: f64,
    pub cast_speed: f64,
    pub threat: f64,
    pub parry: f64,
    pub mayhem: f64,
    pub pierce: f64,
    pub curse: f64,
    pub ripple: f64,
    pub bloom: f64,
    pub blaze: f64,
    pub weaken: f64,
    pub fury: f64,
    pub food_haste: f64,
    pub drink_concentration: f64,
    pub damage_taken: f64,
    pub attack_speed: f64,
    pub armor_damage_ratio: f64,
    pub hp_drain_ratio: f64,
    pub primary_training: String,
    pub focus_training: String,
    pub stamina_experience: f64,
    pub intelligence_experience: f64,
    pub attack_experience: f64,
    pub defense_experience: f64,
    pub melee_experience: f64,
    pub ranged_experience: f64,
    pub magic_experience: f64,
    pub retaliation: f64,
    /// 忠实复刻 JS 怪癖：`combatStats` 初始对象**没有** tenacity 键（面板有），
    /// 结算 `undefined + x` 得 NaN；数据驱动的怪物可能带上数值。
    /// `None` = JS 的 undefined（序列化为缺失键），`Some(NaN)` = 结算后的 NaN（序列化为 null）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tenacity: Option<f64>,
    /// 同为 JS 的「可能缺失」字段：`combatStats.abilityHaste` 仅由怪物数据写入
    /// （monster.js 的 OPTIONAL_COMBAT_STATS 会补 0），玩家侧为 undefined ⇒ 冷却缩放恒不生效。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ability_haste: Option<f64>,
    pub max_hitpoints_ratio: f64,
    pub max_manapoints_ratio: f64,
}

impl Default for CombatStats {
    fn default() -> Self {
        Self {
            combat_style_hrid: "/combat_styles/smash".to_string(),
            damage_type: "/damage_types/physical".to_string(),
            attack_interval: 3000000000.0,
            auto_attack_damage: 0.0,
            ability_damage: 0.0,
            critical_rate: 0.0,
            critical_damage: 0.0,
            stab_accuracy: 0.0,
            slash_accuracy: 0.0,
            smash_accuracy: 0.0,
            ranged_accuracy: 0.0,
            magic_accuracy: 0.0,
            stab_damage: 0.0,
            slash_damage: 0.0,
            smash_damage: 0.0,
            ranged_damage: 0.0,
            magic_damage: 0.0,
            defensive_damage: 0.0,
            task_damage: 0.0,
            physical_amplify: 0.0,
            water_amplify: 0.0,
            nature_amplify: 0.0,
            fire_amplify: 0.0,
            healing_amplify: 0.0,
            physical_thorns: 0.0,
            elemental_thorns: 0.0,
            max_hitpoints: 0.0,
            max_manapoints: 0.0,
            stab_evasion: 0.0,
            slash_evasion: 0.0,
            smash_evasion: 0.0,
            ranged_evasion: 0.0,
            magic_evasion: 0.0,
            armor: 0.0,
            water_resistance: 0.0,
            nature_resistance: 0.0,
            fire_resistance: 0.0,
            life_steal: 0.0,
            hp_regen_per10: 0.01,
            mp_regen_per10: 0.01,
            combat_drop_rate: 0.0,
            combat_drop_quantity: 0.0,
            combat_rare_find: 0.0,
            combat_experience: 0.0,
            food_slots: 1.0,
            drink_slots: 1.0,
            armor_penetration: 0.0,
            water_penetration: 0.0,
            nature_penetration: 0.0,
            fire_penetration: 0.0,
            mana_leech: 0.0,
            cast_speed: 0.0,
            threat: 100.0,
            parry: 0.0,
            mayhem: 0.0,
            pierce: 0.0,
            curse: 0.0,
            ripple: 0.0,
            bloom: 0.0,
            blaze: 0.0,
            weaken: 0.0,
            fury: 0.0,
            food_haste: 0.0,
            drink_concentration: 0.0,
            damage_taken: 0.0,
            attack_speed: 0.0,
            armor_damage_ratio: 0.0,
            hp_drain_ratio: 0.0,
            primary_training: String::new(),
            focus_training: String::new(),
            stamina_experience: 0.0,
            intelligence_experience: 0.0,
            attack_experience: 0.0,
            defense_experience: 0.0,
            melee_experience: 0.0,
            ranged_experience: 0.0,
            magic_experience: 0.0,
            retaliation: 0.0,
            tenacity: None,
            ability_haste: None,
            max_hitpoints_ratio: 0.0,
            max_manapoints_ratio: 0.0,
        }
    }
}

macro_rules! combat_stats_numeric_fields {
    ($($field:ident => $name:literal),* $(,)?) => {
        impl CombatStats {
            /// 按 JS 字段名写入数值字段（探针 / 测试装配用）。返回是否命中。
            pub fn set_numeric_field(&mut self, name: &str, value: f64) -> bool {
                match name {
                    $( $name => { self.$field = value; true } )*
                    _ => false,
                }
            }
        }
    };
}

combat_stats_numeric_fields! {
    attack_interval => "attackInterval",
    auto_attack_damage => "autoAttackDamage",
    ability_damage => "abilityDamage",
    critical_rate => "criticalRate",
    critical_damage => "criticalDamage",
    stab_accuracy => "stabAccuracy",
    slash_accuracy => "slashAccuracy",
    smash_accuracy => "smashAccuracy",
    ranged_accuracy => "rangedAccuracy",
    magic_accuracy => "magicAccuracy",
    stab_damage => "stabDamage",
    slash_damage => "slashDamage",
    smash_damage => "smashDamage",
    ranged_damage => "rangedDamage",
    magic_damage => "magicDamage",
    defensive_damage => "defensiveDamage",
    task_damage => "taskDamage",
    physical_amplify => "physicalAmplify",
    water_amplify => "waterAmplify",
    nature_amplify => "natureAmplify",
    fire_amplify => "fireAmplify",
    healing_amplify => "healingAmplify",
    physical_thorns => "physicalThorns",
    elemental_thorns => "elementalThorns",
    max_hitpoints => "maxHitpoints",
    max_manapoints => "maxManapoints",
    stab_evasion => "stabEvasion",
    slash_evasion => "slashEvasion",
    smash_evasion => "smashEvasion",
    ranged_evasion => "rangedEvasion",
    magic_evasion => "magicEvasion",
    armor => "armor",
    water_resistance => "waterResistance",
    nature_resistance => "natureResistance",
    fire_resistance => "fireResistance",
    life_steal => "lifeSteal",
    hp_regen_per10 => "hpRegenPer10",
    mp_regen_per10 => "mpRegenPer10",
    combat_drop_rate => "combatDropRate",
    combat_drop_quantity => "combatDropQuantity",
    combat_rare_find => "combatRareFind",
    combat_experience => "combatExperience",
    food_slots => "foodSlots",
    drink_slots => "drinkSlots",
    armor_penetration => "armorPenetration",
    water_penetration => "waterPenetration",
    nature_penetration => "naturePenetration",
    fire_penetration => "firePenetration",
    mana_leech => "manaLeech",
    cast_speed => "castSpeed",
    threat => "threat",
    parry => "parry",
    mayhem => "mayhem",
    pierce => "pierce",
    curse => "curse",
    ripple => "ripple",
    bloom => "bloom",
    blaze => "blaze",
    weaken => "weaken",
    fury => "fury",
    food_haste => "foodHaste",
    drink_concentration => "drinkConcentration",
    damage_taken => "damageTaken",
    attack_speed => "attackSpeed",
    armor_damage_ratio => "armorDamageRatio",
    hp_drain_ratio => "hpDrainRatio",
    stamina_experience => "staminaExperience",
    intelligence_experience => "intelligenceExperience",
    attack_experience => "attackExperience",
    defense_experience => "defenseExperience",
    melee_experience => "meleeExperience",
    ranged_experience => "rangedExperience",
    magic_experience => "magicExperience",
    retaliation => "retaliation",
    max_hitpoints_ratio => "maxHitpointsRatio",
    max_manapoints_ratio => "maxManapointsRatio",
}

macro_rules! combat_stats_string_fields {
    ($($field:ident => $name:literal),* $(,)?) => {
        impl CombatStats {
            /// 按 JS 字段名写入字符串字段（生产桥 / 探针装配用）。返回是否命中。
            pub fn set_string_field(&mut self, name: &str, value: &str) -> bool {
                match name {
                    $( $name => { self.$field = value.to_string(); true } )*
                    _ => false,
                }
            }
        }
    };
}

combat_stats_string_fields! {
    combat_style_hrid => "combatStyleHrid",
    damage_type => "damageType",
    primary_training => "primaryTraining",
    focus_training => "focusTraining",
}

/// 结算后面板（等价 JS `combatDetails`，含派生等级/伤害/闪避/抗性等）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatDetails {
    pub stamina_level: f64,
    pub intelligence_level: f64,
    pub attack_level: f64,
    pub melee_level: f64,
    pub defense_level: f64,
    pub ranged_level: f64,
    pub magic_level: f64,
    pub max_hitpoints: f64,
    pub current_hitpoints: f64,
    pub max_manapoints: f64,
    pub current_manapoints: f64,
    pub stab_accuracy_rating: f64,
    pub slash_accuracy_rating: f64,
    pub smash_accuracy_rating: f64,
    pub ranged_accuracy_rating: f64,
    pub magic_accuracy_rating: f64,
    pub stab_max_damage: f64,
    pub slash_max_damage: f64,
    pub smash_max_damage: f64,
    pub ranged_max_damage: f64,
    pub magic_max_damage: f64,
    pub stab_evasion_rating: f64,
    pub slash_evasion_rating: f64,
    pub smash_evasion_rating: f64,
    pub ranged_evasion_rating: f64,
    pub magic_evasion_rating: f64,
    pub defensive_max_damage: f64,
    pub total_armor: f64,
    pub total_water_resistance: f64,
    pub total_nature_resistance: f64,
    pub total_fire_resistance: f64,
    pub ability_haste: f64,
    pub tenacity: f64,
    pub total_threat: f64,
    pub combat_stats: CombatStats,
}

impl Default for CombatDetails {
    fn default() -> Self {
        Self {
            stamina_level: 1.0,
            intelligence_level: 1.0,
            attack_level: 1.0,
            melee_level: 1.0,
            defense_level: 1.0,
            ranged_level: 1.0,
            magic_level: 1.0,
            max_hitpoints: 110.0,
            current_hitpoints: 110.0,
            max_manapoints: 110.0,
            current_manapoints: 110.0,
            stab_accuracy_rating: 11.0,
            slash_accuracy_rating: 11.0,
            smash_accuracy_rating: 11.0,
            ranged_accuracy_rating: 11.0,
            magic_accuracy_rating: 11.0,
            stab_max_damage: 11.0,
            slash_max_damage: 11.0,
            smash_max_damage: 11.0,
            ranged_max_damage: 11.0,
            magic_max_damage: 11.0,
            stab_evasion_rating: 11.0,
            slash_evasion_rating: 11.0,
            smash_evasion_rating: 11.0,
            ranged_evasion_rating: 11.0,
            magic_evasion_rating: 11.0,
            defensive_max_damage: 0.0,
            total_armor: 0.2,
            total_water_resistance: 0.4,
            total_nature_resistance: 0.4,
            total_fire_resistance: 0.4,
            ability_haste: 0.0,
            tenacity: 0.0,
            total_threat: 100.0,
            combat_stats: CombatStats::default(),
        }
    }
}

/// 单个增益对某 buff_type 的投影（等价 JS `{ ratioBoost, flatBoost }`）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffBoost {
    pub ratio_boost: f64,
    pub flat_boost: f64,
}

impl BuffBoost {
    pub const ZERO: Self = Self { ratio_boost: 0.0, flat_boost: 0.0 };
}

/// 结算期索引条目（等价 JS `{ buffs, boost: { ratioBoost, flatBoost } }`）。
#[derive(Clone, Debug, Default)]
pub struct BuffBoostEntry {
    pub buffs: Vec<Buff>,
    pub ratio_boost: f64,
    pub flat_boost: f64,
}

/// 增益类型索引（等价 JS `buffBoostSnapshots` 的 WeakMap 值）。
pub type BuffBoostIndex = OrderedMap<String, BuffBoostEntry>;

/// 等价 JS `indexBuffsByType`：按遍历顺序累积每个 typeHrid 的 ratio/flat 总和。
///
/// JS 侧畸形记录（非字符串 typeHrid）会让整个索引退化为 `null`；Rust 侧 `Buff`
/// 类型保证 typeHrid 为字符串、生产数据不存在该分支，故不做建模。
pub fn index_buffs_by_type(buffs: &OrderedMap<String, Buff>) -> BuffBoostIndex {
    let mut index = BuffBoostIndex::new();
    for buff in buffs.values() {
        if let Some(group) = index.get_mut(&buff.type_hrid) {
            group.buffs.push(buff.clone());
            group.ratio_boost += buff.ratio_boost;
            group.flat_boost += buff.flat_boost;
        } else {
            index.set(
                buff.type_hrid.clone(),
                BuffBoostEntry {
                    buffs: vec![buff.clone()],
                    ratio_boost: buff.ratio_boost,
                    flat_boost: buff.flat_boost,
                },
            );
        }
    }
    index
}

/// 注册表中的一个源（等价 JS `{ buff, expiresAt, sequence }`）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffSourceEntry {
    pub buff: Buff,
    pub expires_at: f64,
    pub sequence: u64,
}

/// houseRooms / guildBuffs / achievements 的元素形态（仅消费其 `buffs` 数组）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuffList {
    #[serde(default)]
    pub buffs: Vec<RawBuffInput>,
}

/// 原始增益记录（addBuff / addPermanentBuff 的输入）。
///
/// 逐字段可缺失，以便复刻 JS 的运行时校验顺序与报错文本；`AddBuff` 注册时
/// **不做等级并入**（等级并入发生在 `new Buff(raw, level)`，即更早的构造点）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawBuffInput {
    #[serde(default)]
    pub unique_hrid: Option<String>,
    #[serde(default)]
    pub type_hrid: Option<String>,
    #[serde(default)]
    pub ratio_boost: Option<f64>,
    #[serde(default)]
    pub flat_boost: Option<f64>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub start_time: Option<f64>,
    #[serde(default)]
    pub multiplier_for_skill_hrid: Option<String>,
    #[serde(default)]
    pub multiplier_per_skill_level: Option<f64>,
}

/// `removeBuff` 的源选择器（等价 JS 的 `REMOVE_ACTIVE_SOURCE` / 显式键 / `null`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BuffSourceSelector {
    /// 省略参数：定位当前活动源（含漂移防御回退）。
    ActiveSource,
    /// 显式参数：`None` 等价 JS 的 `null`（指向 `default` 键）。
    Explicit(Option<String>),
}

/// 战斗单位（等价 JS `CombatUnit` 的引擎相关状态）。
#[derive(Clone, Debug)]
pub struct CombatUnit {
    pub is_player: bool,
    pub is_stunned: bool,
    pub stun_expire_time: Option<f64>,
    pub is_blinded: bool,
    pub blind_expire_time: Option<f64>,
    pub is_silenced: bool,
    pub silence_expire_time: Option<f64>,
    pub is_out_of_mana: bool,
    pub stamina_level: f64,
    pub intelligence_level: f64,
    pub attack_level: f64,
    pub melee_level: f64,
    pub defense_level: f64,
    pub ranged_level: f64,
    pub magic_level: f64,
    pub experience: f64,
    pub experience_rate: f64,
    pub enrage_time: f64,
    pub house_rooms: Vec<BuffList>,
    pub guild_buffs: Vec<BuffList>,
    pub achievements: Option<BuffList>,
    pub zone_buffs: Vec<RawBuffInput>,
    pub extra_buffs: Vec<RawBuffInput>,
    pub combat_details: CombatDetails,
    pub base_combat_stats: Option<CombatStats>,
    /// 「类自有」面板快照（仅 spec 标记 `classOwnedStats` 时存在）：
    /// JS 的 `Player` / `Monster` 覆写在捕获基准前会重写类自有字段（装备 / 怪物数据），
    /// Rust 无该覆写步骤，因此在 `clear_ccs` 的基准刷新点用它恢复这些字段。
    pub class_base_combat_stats: Option<CombatStats>,
    pub combat_buffs: OrderedMap<String, Buff>,
    pub permanent_buffs: OrderedMap<String, Buff>,
    pub buff_sources: OrderedMap<String, OrderedMap<String, BuffSourceEntry>>,
    pub active_buff_source_keys: OrderedMap<String, String>,
    pub buff_source_policies: OrderedMap<String, BuffSourcePolicy>,
    pub buff_source_sequence: u64,
    /// `/equipment_types/two_hand` 槽位的 hrid（bulwark 判定；等价 JS `equipment?.[...]?.hrid`）。
    pub two_hand_hrid: Option<String>,
    // -----------------------------------------------------------------------
    // 模拟循环所需的单位状态（JS `combatUnit.js` 字段 + 模拟器写入的运行时字段）
    // -----------------------------------------------------------------------
    /// 单位标识（JS `unit.hrid`）；事件定位、按 hrid 查找与日志都使用它。
    pub hrid: String,
    /// JS `isWeakened` 在整个仓库中从未被赋值（恒 undefined ⇒ 恒假），如实建模。
    pub is_weakened: bool,
    /// JS `weakenPercentage` 同样从未赋值；`processAttack` 的命中惩罚分支恒不触发。
    pub weaken_percentage: f64,
    /// JS 模拟器写入的 `source.weakenExpireTime`（写入后无读取点，仅保持状态完整）。
    pub weaken_expire_time: Option<f64>,
    /// 技能槽（JS 固定 4 个，未装备为 null）。
    pub abilities: Vec<Option<Ability>>,
    /// 食物 / 饮料槽（JS 各 3 个）。
    pub food: Vec<Option<Consumable>>,
    pub drinks: Vec<Option<Consumable>>,
    /// 每个技能累计消耗的魔法值（JS `abilityManaCosts` Map，仅玩家记账）。
    pub ability_mana_costs: OrderedMap<String, f64>,
}

impl Default for CombatUnit {
    fn default() -> Self {
        Self {
            is_player: false,
            is_stunned: false,
            stun_expire_time: None,
            is_blinded: false,
            blind_expire_time: None,
            is_silenced: false,
            silence_expire_time: None,
            is_out_of_mana: false,
            stamina_level: 1.0,
            intelligence_level: 1.0,
            attack_level: 1.0,
            melee_level: 1.0,
            defense_level: 1.0,
            ranged_level: 1.0,
            magic_level: 1.0,
            experience: 0.0,
            experience_rate: 0.0,
            enrage_time: 0.0,
            house_rooms: Vec::new(),
            guild_buffs: Vec::new(),
            achievements: None,
            zone_buffs: Vec::new(),
            extra_buffs: Vec::new(),
            combat_details: CombatDetails::default(),
            base_combat_stats: None,
            class_base_combat_stats: None,
            combat_buffs: OrderedMap::new(),
            permanent_buffs: OrderedMap::new(),
            buff_sources: OrderedMap::new(),
            active_buff_source_keys: OrderedMap::new(),
            buff_source_policies: OrderedMap::new(),
            buff_source_sequence: 0,
            two_hand_hrid: None,
            hrid: String::new(),
            is_weakened: false,
            weaken_percentage: 0.0,
            weaken_expire_time: None,
            abilities: vec![None, None, None, None],
            food: vec![None, None, None],
            drinks: vec![None, None, None],
            ability_mana_costs: OrderedMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// 源选择（JS 70-162 行）
// ---------------------------------------------------------------------------

fn pick_latest_buff_source(sources: &OrderedMap<String, BuffSourceEntry>) -> Option<(&String, &BuffSourceEntry)> {
    let mut latest: Option<(&String, &BuffSourceEntry)> = None;
    for (source_key, entry) in sources.iter() {
        if latest.is_none() || entry.sequence > latest.expect("latest checked").1.sequence {
            latest = Some((source_key, entry));
        }
    }
    latest
}

fn pick_strongest_buff_source(
    sources: &OrderedMap<String, BuffSourceEntry>,
) -> Result<Option<(&String, &BuffSourceEntry)>, UnitError> {
    let mut best: Option<(&String, &BuffSourceEntry)> = None;
    for (source_key, entry) in sources.iter() {
        // 完全相等的 ratio/flat 刻意不算「更强」：迭代保留最先注册的源（平局规则）。
        if is_stronger_party_aura_buff(Some(&entry.buff), best.map(|(_, best_entry)| &best_entry.buff))? {
            best = Some((source_key, entry));
        }
    }
    Ok(best)
}

fn pick_active_buff_source<'a>(
    sources: &'a OrderedMap<String, BuffSourceEntry>,
    policy: BuffSourcePolicy,
    preferred_source_key: Option<&str>,
) -> Result<Option<(&'a String, &'a BuffSourceEntry)>, UnitError> {
    if policy == BuffSourcePolicy::Strongest {
        return pick_strongest_buff_source(sources);
    }
    if let Some(preferred) = preferred_source_key {
        if let Some(entry) = sources.iter().find(|(source_key, _)| source_key.as_str() == preferred) {
            return Ok(Some(entry));
        }
    }
    Ok(pick_latest_buff_source(sources))
}

fn normalize_buff_source_policy(policy: Option<&str>) -> Result<BuffSourcePolicy, UnitError> {
    match policy {
        None => Ok(BuffSourcePolicy::Replace),
        Some("replace") => Ok(BuffSourcePolicy::Replace),
        Some("strongest") => Ok(BuffSourcePolicy::Strongest),
        Some(other) => Err(UnitError::type_error(format!("Unsupported buff source policy: {other}"))),
    }
}

pub fn policy_name(policy: BuffSourcePolicy) -> &'static str {
    match policy {
        BuffSourcePolicy::Replace => "replace",
        BuffSourcePolicy::Strongest => "strongest",
    }
}

fn read_non_empty_hrid(value: Option<&str>, field_name: &str) -> Result<String, UnitError> {
    match value {
        Some(text) if !text.trim().is_empty() => Ok(text.to_string()),
        _ => Err(UnitError::type_error(format!(
            "CombatUnit buff {field_name} must be a non-empty string"
        ))),
    }
}

fn read_finite_number(value: Option<f64>, field_name: &str, unique_hrid: &str) -> Result<f64, UnitError> {
    match value.filter(|candidate| candidate.is_finite()) {
        Some(number) => Ok(number),
        None => Err(UnitError::type_error(format!(
            "CombatUnit buff {field_name} must be a finite number for {unique_hrid}"
        ))),
    }
}

fn raw_buff_from_input(input: &RawBuffInput, start_time: Option<f64>) -> Buff {
    // JS 侧缺失字段为 undefined；此处 ratio/flat 以 NaN 兜底（消费端 NaN 语义一致，
    // 探针轨迹两边都归一为 null），其余字段按 `?? ''` / `?? 0` 归一。
    Buff {
        unique_hrid: input.unique_hrid.clone().unwrap_or_default(),
        type_hrid: input.type_hrid.clone().unwrap_or_default(),
        ratio_boost: input.ratio_boost.unwrap_or(f64::NAN),
        flat_boost: input.flat_boost.unwrap_or(f64::NAN),
        duration: input.duration,
        start_time,
        multiplier_for_skill_hrid: input.multiplier_for_skill_hrid.clone().unwrap_or_default(),
        multiplier_per_skill_level: input.multiplier_per_skill_level.unwrap_or(0.0),
    }
}

/// 单个等级字段的结算（等价 JS 对某 COMBAT_LEVEL_FIELDS 项的累加循环）。
fn settled_level(base_level: f64, boosts: &[BuffBoost]) -> f64 {
    let mut value = base_level;
    for boost in boosts {
        value += base_level * boost.ratio_boost;
        value += boost.flat_boost;
    }
    value
}

fn snapshot_boost(snapshot: &BuffBoostIndex, type_hrid: &str) -> BuffBoost {
    match snapshot.get_str(type_hrid) {
        Some(entry) => BuffBoost { ratio_boost: entry.ratio_boost, flat_boost: entry.flat_boost },
        None => BuffBoost::ZERO,
    }
}

fn snapshot_boosts(snapshot: &BuffBoostIndex, type_hrid: &str) -> Vec<BuffBoost> {
    match snapshot.get_str(type_hrid) {
        Some(entry) => entry
            .buffs
            .iter()
            .map(|buff| BuffBoost { ratio_boost: buff.ratio_boost, flat_boost: buff.flat_boost })
            .collect(),
        None => Vec::new(),
    }
}

impl CombatUnit {
    // -----------------------------------------------------------------------
    // 基准属性（JS 368-404 行）
    // -----------------------------------------------------------------------

    /// 等价 JS `refreshBaseCombatStats`：把当前面板捕获为「纯净基准」。
    pub fn refresh_base_combat_stats(&mut self) {
        self.base_combat_stats = Some(self.combat_details.combat_stats.clone());
    }

    /// 等价 JS `resetCombatStatsToBase`：无基准则先捕获，然后整体恢复。
    pub fn reset_combat_stats_to_base(&mut self) {
        if self.base_combat_stats.is_none() {
            self.refresh_base_combat_stats();
        }
        if let Some(base) = &self.base_combat_stats {
            self.combat_details.combat_stats = base.clone();
        }
    }

    /// 等价 JS `updateCombatDetails`：构建快照 → 结算。
    pub fn update_combat_details(&mut self) {
        let snapshot = index_buffs_by_type(&self.combat_buffs);
        self.update_combat_details_with_snapshot(&snapshot);
    }

    /// 结算主体（等价 JS `updateCombatDetailsFromBuffs`，忽略 FRESH_COMBAT_STATS 微优化）。
    pub fn update_combat_details_with_snapshot(&mut self, snapshot: &BuffBoostIndex) {
        self.reset_combat_stats_to_base();

        if self.is_player {
            self.combat_details.combat_stats.hp_regen_per10 += 0.01;
            self.combat_details.combat_stats.mp_regen_per10 += 0.01;
        }

        // COMBAT_LEVEL_FIELDS（JS 164-172 行）——加成基数取单位自身等级字段。
        let stamina_level = settled_level(self.stamina_level, &snapshot_boosts(snapshot, "/buff_types/stamina_level"));
        let intelligence_level =
            settled_level(self.intelligence_level, &snapshot_boosts(snapshot, "/buff_types/intelligence_level"));
        let attack_level = settled_level(self.attack_level, &snapshot_boosts(snapshot, "/buff_types/attack_level"));
        let melee_level = settled_level(self.melee_level, &snapshot_boosts(snapshot, "/buff_types/melee_level"));
        let defense_level = settled_level(self.defense_level, &snapshot_boosts(snapshot, "/buff_types/defense_level"));
        let ranged_level = settled_level(self.ranged_level, &snapshot_boosts(snapshot, "/buff_types/ranged_level"));
        let magic_level = settled_level(self.magic_level, &snapshot_boosts(snapshot, "/buff_types/magic_level"));

        let is_bulwark = self.two_hand_hrid.as_deref().is_some_and(|hrid| hrid.contains("bulwark"));
        let cd = &mut self.combat_details;

        cd.stamina_level = stamina_level;
        cd.intelligence_level = intelligence_level;
        cd.attack_level = attack_level;
        cd.melee_level = melee_level;
        cd.defense_level = defense_level;
        cd.ranged_level = ranged_level;
        cd.magic_level = magic_level;

        let max_hitpoints_boost = snapshot_boost(snapshot, "/buff_types/max_hitpoints");
        let max_manapoints_boost = snapshot_boost(snapshot, "/buff_types/max_manapoints");
        cd.max_hitpoints = (((10.0 * (10.0 + cd.stamina_level)) + cd.combat_stats.max_hitpoints)
            + max_hitpoints_boost.flat_boost)
            * (((1.0 + cd.combat_stats.max_hitpoints_ratio) + max_hitpoints_boost.ratio_boost));
        cd.max_hitpoints = cd.max_hitpoints.floor();
        cd.max_manapoints = (((10.0 * (10.0 + cd.intelligence_level)) + cd.combat_stats.max_manapoints)
            + max_manapoints_boost.flat_boost)
            * (((1.0 + cd.combat_stats.max_manapoints_ratio) + max_manapoints_boost.ratio_boost));
        cd.max_manapoints = cd.max_manapoints.floor();

        let accuracy_ratio_boost_from_fury = snapshot_boost(snapshot, "/buff_types/fury_accuracy").ratio_boost;
        let damage_ratio_boost_from_fury = snapshot_boost(snapshot, "/buff_types/fury_damage").ratio_boost;
        let accuracy_ratio_boost = snapshot_boost(snapshot, "/buff_types/accuracy").ratio_boost;
        let damage_ratio_boost = snapshot_boost(snapshot, "/buff_types/damage").ratio_boost;

        let evasion_boosts = snapshot_boosts(snapshot, "/buff_types/evasion");
        // MELEE_STYLE_FIELDS（stab / slash / smash）
        cd.stab_accuracy_rating = (10.0 + cd.attack_level)
            * (1.0 + cd.combat_stats.stab_accuracy)
            * (1.0 + accuracy_ratio_boost)
            * (1.0 + accuracy_ratio_boost_from_fury);
        cd.stab_max_damage = (10.0 + cd.melee_level)
            * (1.0 + cd.combat_stats.stab_damage)
            * (1.0 + damage_ratio_boost)
            * (1.0 + damage_ratio_boost_from_fury);
        let base_evasion = (10.0 + cd.defense_level) * (1.0 + cd.combat_stats.stab_evasion);
        cd.stab_evasion_rating = base_evasion;
        for boost in &evasion_boosts {
            cd.stab_evasion_rating += boost.flat_boost;
            cd.stab_evasion_rating += base_evasion * boost.ratio_boost;
        }

        cd.slash_accuracy_rating = (10.0 + cd.attack_level)
            * (1.0 + cd.combat_stats.slash_accuracy)
            * (1.0 + accuracy_ratio_boost)
            * (1.0 + accuracy_ratio_boost_from_fury);
        cd.slash_max_damage = (10.0 + cd.melee_level)
            * (1.0 + cd.combat_stats.slash_damage)
            * (1.0 + damage_ratio_boost)
            * (1.0 + damage_ratio_boost_from_fury);
        let base_evasion = (10.0 + cd.defense_level) * (1.0 + cd.combat_stats.slash_evasion);
        cd.slash_evasion_rating = base_evasion;
        for boost in &evasion_boosts {
            cd.slash_evasion_rating += boost.flat_boost;
            cd.slash_evasion_rating += base_evasion * boost.ratio_boost;
        }

        cd.smash_accuracy_rating = (10.0 + cd.attack_level)
            * (1.0 + cd.combat_stats.smash_accuracy)
            * (1.0 + accuracy_ratio_boost)
            * (1.0 + accuracy_ratio_boost_from_fury);
        cd.smash_max_damage = (10.0 + cd.melee_level)
            * (1.0 + cd.combat_stats.smash_damage)
            * (1.0 + damage_ratio_boost)
            * (1.0 + damage_ratio_boost_from_fury);
        let base_evasion = (10.0 + cd.defense_level) * (1.0 + cd.combat_stats.smash_evasion);
        cd.smash_evasion_rating = base_evasion;
        for boost in &evasion_boosts {
            cd.smash_evasion_rating += boost.flat_boost;
            cd.smash_evasion_rating += base_evasion * boost.ratio_boost;
        }

        cd.defensive_max_damage = (10.0 + cd.defense_level)
            * (1.0 + cd.combat_stats.defensive_damage)
            * (1.0 + damage_ratio_boost)
            * (1.0 + damage_ratio_boost_from_fury);

        // 装备 bulwark（壁垒盾）时，闪击最大伤害叠加防御伤害。
        if is_bulwark {
            cd.smash_max_damage += cd.defensive_max_damage;
        }

        cd.ranged_accuracy_rating = (10.0 + cd.attack_level)
            * (1.0 + cd.combat_stats.ranged_accuracy)
            * (1.0 + accuracy_ratio_boost)
            * (1.0 + accuracy_ratio_boost_from_fury);
        cd.ranged_max_damage = (10.0 + cd.ranged_level)
            * (1.0 + cd.combat_stats.ranged_damage)
            * (1.0 + damage_ratio_boost)
            * (1.0 + damage_ratio_boost_from_fury);

        let base_ranged_evasion = (10.0 + cd.defense_level) * (1.0 + cd.combat_stats.ranged_evasion);
        cd.ranged_evasion_rating = base_ranged_evasion;
        for boost in &evasion_boosts {
            cd.ranged_evasion_rating += boost.flat_boost;
            cd.ranged_evasion_rating += base_ranged_evasion * boost.ratio_boost;
        }

        cd.combat_stats.damage_taken = snapshot_boost(snapshot, "/buff_types/damage_taken").flat_boost;

        cd.magic_accuracy_rating = (10.0 + cd.attack_level)
            * (1.0 + cd.combat_stats.magic_accuracy)
            * (1.0 + accuracy_ratio_boost)
            * (1.0 + accuracy_ratio_boost_from_fury);
        cd.magic_max_damage = (10.0 + cd.magic_level)
            * (1.0 + cd.combat_stats.magic_damage)
            * (1.0 + damage_ratio_boost)
            * (1.0 + damage_ratio_boost_from_fury);

        let base_magic_evasion = (10.0 + cd.defense_level) * (1.0 + cd.combat_stats.magic_evasion);
        cd.magic_evasion_rating = base_magic_evasion;
        for boost in &evasion_boosts {
            cd.magic_evasion_rating += boost.flat_boost;
            cd.magic_evasion_rating += base_magic_evasion * boost.ratio_boost;
        }

        cd.combat_stats.physical_amplify += snapshot_boost(snapshot, "/buff_types/physical_amplify").flat_boost;
        cd.combat_stats.water_amplify += snapshot_boost(snapshot, "/buff_types/water_amplify").flat_boost;
        cd.combat_stats.nature_amplify += snapshot_boost(snapshot, "/buff_types/nature_amplify").flat_boost;
        cd.combat_stats.fire_amplify += snapshot_boost(snapshot, "/buff_types/fire_amplify").flat_boost;
        cd.combat_stats.healing_amplify += snapshot_boost(snapshot, "/buff_types/healing_amplify").flat_boost;

        cd.combat_stats.attack_interval /= 1.0 + cd.attack_level / 2000.0;

        let base_attack_speed = cd.combat_stats.attack_speed;
        cd.combat_stats.attack_interval /= 1.0 + base_attack_speed;
        let attack_interval_boosts = snapshot_boosts(snapshot, "/buff_types/attack_speed");
        let attack_interval_ratio_boost =
            attack_interval_boosts.iter().map(|boost| boost.ratio_boost).fold(0.0, |prev, cur| prev + cur);
        cd.combat_stats.attack_interval /= 1.0 + attack_interval_ratio_boost;

        let base_armor = 0.2 * cd.defense_level + cd.combat_stats.armor;
        cd.total_armor = base_armor;
        for boost in snapshot_boosts(snapshot, "/buff_types/armor") {
            cd.total_armor += boost.flat_boost;
            cd.total_armor += base_armor * boost.ratio_boost;
        }

        let base_water_resistance = 0.2 * cd.defense_level + cd.combat_stats.water_resistance;
        cd.total_water_resistance = base_water_resistance;
        for boost in snapshot_boosts(snapshot, "/buff_types/water_resistance") {
            cd.total_water_resistance += boost.flat_boost;
            cd.total_water_resistance += base_water_resistance * boost.ratio_boost;
        }

        let base_nature_resistance = 0.2 * cd.defense_level + cd.combat_stats.nature_resistance;
        cd.total_nature_resistance = base_nature_resistance;
        for boost in snapshot_boosts(snapshot, "/buff_types/nature_resistance") {
            cd.total_nature_resistance += boost.flat_boost;
            cd.total_nature_resistance += base_nature_resistance * boost.ratio_boost;
        }

        let base_fire_resistance = 0.2 * cd.defense_level + cd.combat_stats.fire_resistance;
        cd.total_fire_resistance = base_fire_resistance;
        for boost in snapshot_boosts(snapshot, "/buff_types/fire_resistance") {
            cd.total_fire_resistance += boost.flat_boost;
            cd.total_fire_resistance += base_fire_resistance * boost.ratio_boost;
        }

        let hp_regen_boosts = snapshot_boost(snapshot, "/buff_types/hp_regen");
        cd.combat_stats.hp_regen_per10 += cd.combat_stats.hp_regen_per10 * hp_regen_boosts.ratio_boost;
        cd.combat_stats.hp_regen_per10 += hp_regen_boosts.flat_boost;

        let mp_regen_boosts = snapshot_boost(snapshot, "/buff_types/mp_regen");
        cd.combat_stats.mp_regen_per10 += cd.combat_stats.mp_regen_per10 * mp_regen_boosts.ratio_boost;
        cd.combat_stats.mp_regen_per10 += mp_regen_boosts.flat_boost;

        cd.combat_stats.life_steal += snapshot_boost(snapshot, "/buff_types/life_steal").flat_boost;
        cd.combat_stats.physical_thorns += snapshot_boost(snapshot, "/buff_types/physical_thorns").flat_boost;
        cd.combat_stats.elemental_thorns += snapshot_boost(snapshot, "/buff_types/elemental_thorns").flat_boost;
        cd.combat_stats.combat_experience += snapshot_boost(snapshot, "/buff_types/wisdom").flat_boost;
        cd.combat_stats.critical_rate += snapshot_boost(snapshot, "/buff_types/critical_rate").flat_boost;
        cd.combat_stats.critical_damage += snapshot_boost(snapshot, "/buff_types/critical_damage").flat_boost;

        cd.combat_stats.cast_speed += snapshot_boost(snapshot, "/buff_types/cast_speed").flat_boost;
        cd.combat_stats.cast_speed += cd.attack_level / 2000.0;

        let combat_drop_rate_boosts = snapshot_boost(snapshot, "/buff_types/combat_drop_rate");
        cd.combat_stats.combat_drop_rate += (1.0 + cd.combat_stats.combat_drop_rate) * combat_drop_rate_boosts.ratio_boost;
        cd.combat_stats.combat_drop_rate += combat_drop_rate_boosts.flat_boost;
        let combat_rare_find_boosts = snapshot_boost(snapshot, "/buff_types/rare_find");
        cd.combat_stats.combat_rare_find += (1.0 + cd.combat_stats.combat_rare_find) * combat_rare_find_boosts.ratio_boost;
        cd.combat_stats.combat_rare_find += combat_rare_find_boosts.flat_boost;
        let combat_drop_quantity_boosts = snapshot_boost(snapshot, "/buff_types/combat_drop_quantity");
        cd.combat_stats.combat_drop_quantity +=
            (1.0 + cd.combat_stats.combat_drop_quantity) * combat_drop_quantity_boosts.ratio_boost;
        cd.combat_stats.combat_drop_quantity += combat_drop_quantity_boosts.flat_boost;

        let base_threat = 100.0 + cd.combat_stats.threat;
        cd.total_threat = base_threat;
        let threat_boosts = snapshot_boost(snapshot, "/buff_types/threat");
        if threat_boosts.ratio_boost != 0.0 {
            cd.combat_stats.threat += base_threat * threat_boosts.ratio_boost;
        } else {
            cd.combat_stats.threat = base_threat;
        }
        cd.combat_stats.threat += threat_boosts.flat_boost;

        cd.combat_stats.retaliation += snapshot_boost(snapshot, "/buff_types/retaliation").flat_boost;
        // JS：combatStats.tenacity 缺失时为 undefined，`undefined + x` 得 NaN（键随之出现且此后保持）。
        cd.combat_stats.tenacity = Some(match cd.combat_stats.tenacity {
            Some(value) => value + snapshot_boost(snapshot, "/buff_types/tenacity").flat_boost,
            None => f64::NAN,
        });
    }

    // -----------------------------------------------------------------------
    // 增益生命周期（JS 615-966 行）
    // -----------------------------------------------------------------------

    /// 等价 JS `addBuff(buff, currentTime, sourceHrid = null, { sourcePolicy })`。
    ///
    /// `source_policy` 传原始策略字符串（`"replace"` / `"strongest"`），
    /// 以便复刻 JS 对未知策略值的 TypeError（`panic` 风格的错误文本逐字一致）。
    pub fn add_buff(
        &mut self,
        input: &RawBuffInput,
        current_time: f64,
        source_hrid: Option<&str>,
        source_policy: Option<&str>,
    ) -> Result<(), UnitError> {
        if !current_time.is_finite() {
            return Err(UnitError::type_error("CombatUnit.addBuff requires a finite numeric currentTime"));
        }

        let unique_hrid = read_non_empty_hrid(input.unique_hrid.as_deref(), "uniqueHrid")?;
        let type_hrid = read_non_empty_hrid(input.type_hrid.as_deref(), "typeHrid")?;
        let ratio_boost = read_finite_number(input.ratio_boost, "ratioBoost", &unique_hrid)?;
        let flat_boost = read_finite_number(input.flat_boost, "flatBoost", &unique_hrid)?;
        let duration = read_finite_number(input.duration, "duration", &unique_hrid)?;

        // 注册副本：调用方对象不被修改，startTime 由注册时刻决定。
        let registered_buff = Buff {
            unique_hrid: unique_hrid.clone(),
            type_hrid,
            ratio_boost,
            flat_boost,
            duration: Some(duration),
            start_time: Some(current_time),
            multiplier_for_skill_hrid: input.multiplier_for_skill_hrid.clone().unwrap_or_default(),
            multiplier_per_skill_level: input.multiplier_per_skill_level.unwrap_or(0.0),
        };
        let source_key = source_hrid.unwrap_or("default");
        let expires_at = current_time + duration;
        let normalized_policy = normalize_buff_source_policy(source_policy)?;
        if normalized_policy == BuffSourcePolicy::Strongest {
            // 先校验再改源注册表：不支持/形状漂移的光环必须大声失败。
            get_party_aura_buff_strength(&registered_buff)?;
        }

        // JS 语义：源注册表先建（即便随后策略冲突抛错也会留下空表）。
        if !self.buff_sources.contains_key_str(&unique_hrid) {
            self.buff_sources.set(unique_hrid.clone(), OrderedMap::new());
        }
        if let Some(existing_policy) = self.buff_source_policies.get_str(&unique_hrid).copied() {
            if existing_policy != normalized_policy {
                return Err(UnitError::error(format!(
                    "CombatUnit buff source policy mismatch for {unique_hrid}: {} vs {}",
                    policy_name(existing_policy),
                    policy_name(normalized_policy)
                )));
            }
        }
        self.buff_source_policies.set(unique_hrid.clone(), normalized_policy);
        self.buff_source_sequence += 1;
        let sequence = self.buff_source_sequence;
        if let Some(sources) = self.buff_sources.get_mut(&unique_hrid) {
            sources.set(source_key.to_string(), BuffSourceEntry { buff: registered_buff, expires_at, sequence });
        }

        let sources_snapshot = self.buff_sources.get_str(&unique_hrid).cloned();
        self.reconcile_buff_source(&unique_hrid, sources_snapshot.as_ref(), true, Some(source_key))?;
        Ok(())
    }

    /// 等价 JS `reconcileBuffSource(uniqueHrid, sources, { updateDetails, preferredSourceKey })`。
    pub fn reconcile_buff_source(
        &mut self,
        unique_hrid: &str,
        sources: Option<&OrderedMap<String, BuffSourceEntry>>,
        update_details: bool,
        preferred_source_key: Option<&str>,
    ) -> Result<bool, UnitError> {
        let previous_active_buff = self.combat_buffs.get_str(unique_hrid).cloned();
        let policy = self.buff_source_policies.get_str(unique_hrid).copied().unwrap_or(BuffSourcePolicy::Replace);
        let next_active_source = match sources {
            Some(sources) if !sources.is_empty() => pick_active_buff_source(sources, policy, preferred_source_key)?,
            _ => None,
        };
        let next_active_buff = next_active_source.map(|(_, entry)| entry.buff.clone());

        if let Some((source_key, entry)) = next_active_source {
            self.active_buff_source_keys.set(unique_hrid.to_string(), source_key.clone());
            self.combat_buffs.set(unique_hrid.to_string(), entry.buff.clone());
        } else {
            self.active_buff_source_keys.delete(&unique_hrid.to_string());
            self.combat_buffs.delete(&unique_hrid.to_string());
        }

        let active_buff_changed = !buffs_affect_stats_equally(next_active_buff.as_ref(), previous_active_buff.as_ref());
        if active_buff_changed && update_details {
            self.update_combat_details();
        }

        Ok(active_buff_changed)
    }

    /// 等价 JS `removeBuff(buff, sourceHrid = REMOVE_ACTIVE_SOURCE)`（`uniqueHrid` 为空则不动作）。
    pub fn remove_buff(&mut self, unique_hrid: Option<&str>, selector: BuffSourceSelector) -> Result<(), UnitError> {
        let Some(unique_hrid) = unique_hrid.filter(|hrid| !hrid.is_empty()) else {
            return Ok(());
        };
        self.remove_buff_by_unique_hrid(unique_hrid, selector)
    }

    /// 等价 JS `removeBuffByUniqueHrid(uniqueHrid, sourceHrid = REMOVE_ACTIVE_SOURCE)`。
    pub fn remove_buff_by_unique_hrid(
        &mut self,
        unique_hrid: &str,
        selector: BuffSourceSelector,
    ) -> Result<(), UnitError> {
        let sources_snapshot = self.buff_sources.get_str(unique_hrid).cloned();

        let mut source_key: Option<String> = None;
        match selector {
            BuffSourceSelector::ActiveSource => {
                let active_source_key = self.active_buff_source_keys.get_str(unique_hrid).cloned();
                let use_active = active_source_key
                    .as_ref()
                    .is_some_and(|active| sources_snapshot.as_ref().map_or(true, |sources| sources.contains_key_str(active)));
                if use_active {
                    source_key = active_source_key;
                } else if let Some(sources) = sources_snapshot.as_ref() {
                    if !sources.is_empty() {
                        // 恢复/遗留状态：推导与对账相同的活动源，而不是静默返回空操作。
                        let policy =
                            self.buff_source_policies.get_str(unique_hrid).copied().unwrap_or(BuffSourcePolicy::Replace);
                        source_key = pick_active_buff_source(sources, policy, None)?.map(|(key, _)| key.clone());
                    }
                }
            }
            BuffSourceSelector::Explicit(explicit) => source_key = explicit,
        }
        let source_key = source_key.unwrap_or_else(|| "default".to_string());

        if let Some(sources) = sources_snapshot.as_ref() {
            if !sources.contains_key_str(&source_key) {
                return Ok(());
            }

            let policy = self.buff_source_policies.get_str(unique_hrid).copied().unwrap_or(BuffSourcePolicy::Replace);
            let source_was_active =
                self.active_buff_source_keys.get_str(unique_hrid).is_some_and(|active| *active == source_key);
            let mut remaining = sources.len();
            if let Some(live_sources) = self.buff_sources.get_mut(&unique_hrid.to_string()) {
                if live_sources.delete(&source_key) {
                    remaining -= 1;
                }
            }

            if policy == BuffSourcePolicy::Replace && source_was_active {
                // 后写覆盖的增益被移除时不揭示旧值：级联清除该 uniqueHrid 的全部源。
                self.buff_sources.delete(&unique_hrid.to_string());
                self.buff_source_policies.delete(&unique_hrid.to_string());
                self.reconcile_buff_source(unique_hrid, None, true, None)?;
            } else if remaining == 0 {
                self.buff_sources.delete(&unique_hrid.to_string());
                self.buff_source_policies.delete(&unique_hrid.to_string());
                self.reconcile_buff_source(unique_hrid, None, true, None)?;
            } else if source_was_active || self.active_buff_source_keys.get_str(unique_hrid).is_none() {
                let live_snapshot = self.buff_sources.get_str(unique_hrid).cloned();
                self.reconcile_buff_source(unique_hrid, live_snapshot.as_ref(), true, None)?;
            }
            return Ok(());
        }

        // 早于源注册机制的旧式增益兼容回退。
        if self.combat_buffs.contains_key_str(unique_hrid) {
            self.combat_buffs.delete(&unique_hrid.to_string());
            self.active_buff_source_keys.delete(&unique_hrid.to_string());
            self.buff_source_policies.delete(&unique_hrid.to_string());
            self.update_combat_details();
        }
        Ok(())
    }

    /// 等价 JS `addPermanentBuff`：按 typeHrid 累加 ratio/flat，首次写入克隆后存储。
    pub fn add_permanent_buff(&mut self, input: &RawBuffInput) {
        // JS 对象键会把 undefined 字符串化为 "undefined"；探针脚本始终给出合法
        // typeHrid，此处复刻该字符串化以保持两侧一致。
        let type_key = input.type_hrid.clone().unwrap_or_else(|| "undefined".to_string());
        let ratio_boost = input.ratio_boost.unwrap_or(f64::NAN);
        let flat_boost = input.flat_boost.unwrap_or(f64::NAN);
        if let Some(existing) = self.permanent_buffs.get_mut(&type_key) {
            existing.flat_boost += flat_boost;
            existing.ratio_boost += ratio_boost;
        } else {
            self.permanent_buffs.set(type_key, raw_buff_from_input(input, input.start_time));
        }
    }

    /// 等价 JS `generatePermanentBuffs`（顺序：houseRooms → guildBuffs → achievements → zoneBuffs → extraBuffs）。
    pub fn generate_permanent_buffs(&mut self) {
        // 克隆输入以避开 &self 输入 / &mut self 方法的借用冲突（数据量小，代价可忽略）。
        let house_room_buffs: Vec<RawBuffInput> =
            self.house_rooms.iter().flat_map(|room| room.buffs.iter().cloned()).collect();
        for buff in &house_room_buffs {
            self.add_permanent_buff(buff);
        }

        let guild_buffs: Vec<RawBuffInput> =
            self.guild_buffs.iter().flat_map(|guild| guild.buffs.iter().cloned()).collect();
        for buff in &guild_buffs {
            self.add_permanent_buff(buff);
        }

        if let Some(achievements) = self.achievements.as_ref() {
            let achievement_buffs: Vec<RawBuffInput> = achievements.buffs.clone();
            for buff in &achievement_buffs {
                self.add_permanent_buff(buff);
            }
        }

        let zone_buffs: Vec<RawBuffInput> = self.zone_buffs.clone();
        for buff in &zone_buffs {
            self.add_permanent_buff(buff);
        }

        let extra_buffs: Vec<RawBuffInput> = self.extra_buffs.clone();
        for buff in &extra_buffs {
            self.add_permanent_buff(buff);
        }
    }

    /// 等价 JS `removeExpiredBuffByUniqueHrid(uniqueHrid, currentTime, { updateDetails })`。
    /// 返回「派生属性是否变脏」（JS 布尔返回值，逐字保留）。
    pub fn remove_expired_buff_by_unique_hrid(
        &mut self,
        unique_hrid: &str,
        current_time: f64,
        update_details: bool,
    ) -> Result<bool, UnitError> {
        if unique_hrid.is_empty() {
            return Ok(false);
        }

        let mut details_dirty = false;
        if self.buff_sources.contains_key_str(unique_hrid) {
            let active_source_key = self.active_buff_source_keys.get_str(unique_hrid).cloned();
            let policy = self.buff_source_policies.get_str(unique_hrid).copied().unwrap_or(BuffSourcePolicy::Replace);
            let mut active_source_expired = false;
            {
                let sources = self
                    .buff_sources
                    .get_mut(&unique_hrid.to_string())
                    .expect("buff sources entry exists for known uniqueHrid");
                // 在扫描快照时删除，避免修改影响迭代语义。
                let mut expired_keys: Vec<String> = Vec::new();
                for (source_key, entry) in sources.iter() {
                    if entry.expires_at <= current_time {
                        if active_source_key.as_deref() == Some(source_key.as_str()) {
                            active_source_expired = true;
                        }
                        expired_keys.push(source_key.clone());
                    }
                }
                for source_key in &expired_keys {
                    sources.delete(source_key);
                }
            }

            let remaining = self.buff_sources.get_str(unique_hrid).map_or(0, |sources| sources.len());
            let active_key_missing = match active_source_key.as_deref() {
                Some(active) => !self.buff_sources.get_str(unique_hrid).is_some_and(|sources| sources.contains_key_str(active)),
                None => true,
            };

            if policy == BuffSourcePolicy::Replace && active_source_expired {
                self.buff_sources.delete(&unique_hrid.to_string());
                self.buff_source_policies.delete(&unique_hrid.to_string());
                details_dirty =
                    self.reconcile_buff_source(unique_hrid, None, false, None)? || details_dirty;
            } else if remaining == 0 {
                self.buff_sources.delete(&unique_hrid.to_string());
                self.buff_source_policies.delete(&unique_hrid.to_string());
                details_dirty =
                    self.reconcile_buff_source(unique_hrid, None, false, None)? || details_dirty;
            } else if active_source_expired || active_key_missing {
                let live_snapshot = self.buff_sources.get_str(unique_hrid).cloned();
                details_dirty =
                    self.reconcile_buff_source(unique_hrid, live_snapshot.as_ref(), false, None)? || details_dirty;
            }
        } else {
            // 与源注册机制引入前由旧调用方恢复的运行时增益保持兼容。
            let buff = self.combat_buffs.get_str(unique_hrid).cloned();
            if let Some(buff) = buff {
                if is_timed_buff_expired(&buff, current_time) {
                    self.combat_buffs.delete(&unique_hrid.to_string());
                    self.active_buff_source_keys.delete(&unique_hrid.to_string());
                    self.buff_source_policies.delete(&unique_hrid.to_string());
                    details_dirty = true;
                }
            }
        }

        if details_dirty && update_details {
            self.update_combat_details();
        }

        Ok(details_dirty)
    }

    /// 等价 JS `removeExpiredBuffs(currentTime, { updateDetails })`。
    pub fn remove_expired_buffs(&mut self, current_time: f64, update_details: bool) -> Result<bool, UnitError> {
        let mut details_dirty = false;
        // Object.keys 快照：先收集再逐项处理（处理过程会删除条目）。
        let unique_hrids: Vec<String> = self.buff_sources.keys().cloned().collect();
        for unique_hrid in unique_hrids {
            details_dirty = self.remove_expired_buff_by_unique_hrid(&unique_hrid, current_time, false)? || details_dirty;
        }

        // 与未在 buffSources 中表示、由旧调用方恢复的运行时增益保持兼容。
        let combat_buff_entries: Vec<(String, Buff)> =
            self.combat_buffs.iter().map(|(key, buff)| (key.clone(), buff.clone())).collect();
        for (unique_hrid, buff) in combat_buff_entries {
            if self.buff_sources.contains_key_str(&unique_hrid) {
                continue;
            }
            if is_timed_buff_expired(&buff, current_time) {
                self.combat_buffs.delete(&unique_hrid);
                self.active_buff_source_keys.delete(&unique_hrid);
                self.buff_source_policies.delete(&unique_hrid);
                details_dirty = true;
            }
        }

        if details_dirty && update_details {
            self.update_combat_details();
        }

        Ok(details_dirty)
    }

    /// 等价 JS `clearBuffs`：combatBuffs 重置为 permanentBuffs 的深拷贝，源注册表清空。
    pub fn clear_buffs(&mut self) {
        // JS 对「非玩家 + 空 permanentBuffs」用全新 {}（与 structuredClone 内容一致），此处统一克隆。
        self.combat_buffs = self.permanent_buffs.clone();
        self.buff_sources = OrderedMap::new();
        self.active_buff_source_keys = OrderedMap::new();
        self.buff_source_policies = OrderedMap::new();
        self.buff_source_sequence = 0;
        self.update_combat_details();
    }

    /// 等价 JS `clearCCs`。
    pub fn clear_ccs(&mut self) {
        self.is_stunned = false;
        self.stun_expire_time = None;
        self.is_silenced = false;
        self.silence_expire_time = None;
        self.is_blinded = false;
        self.blind_expire_time = None;
        self.combat_details.combat_stats.damage_taken = 0.0;
        // JS 的 `Player` / `Monster` 覆写会在紧随其后的 `updateCombatDetails` 里把
        // 「类自有」面板字段重写回装备 / 怪物数据（`refreshBaseCombatStats` 因此总是
        // 捕获干净基准）；合成单位（探针）没有该覆写，基准会带上派生值。
        // Rust 无类覆写，故仅在 spec 标记类自有面板时把字段恢复为构造期快照。
        if let Some(class_base) = &self.class_base_combat_stats {
            self.combat_details.combat_stats = class_base.clone();
            self.combat_details.combat_stats.damage_taken = 0.0;
        }
        self.refresh_base_combat_stats();
    }

    /// 等价 JS `getBuffBoosts(type)`（无快照路径：按 combatBuffs 遍历序投影）。
    pub fn get_buff_boosts(&self, type_hrid: &str) -> Vec<BuffBoost> {
        self.combat_buffs
            .values()
            .filter(|buff| buff.type_hrid == type_hrid)
            .map(|buff| BuffBoost { ratio_boost: buff.ratio_boost, flat_boost: buff.flat_boost })
            .collect()
    }

    /// 等价 JS `getBuffBoost(type)`（无快照路径：`?? 0` 归一后逐项累加）。
    pub fn get_buff_boost(&self, type_hrid: &str) -> BuffBoost {
        let mut boost = BuffBoost::ZERO;
        for buff in self.combat_buffs.values().filter(|buff| buff.type_hrid == type_hrid) {
            boost.ratio_boost += buff.ratio_boost;
            boost.flat_boost += buff.flat_boost;
        }
        boost
    }
}

/// 等价 JS 定时过期判定：startTime / duration 均为有限数且 `startTime + duration <= currentTime`。
fn is_timed_buff_expired(buff: &Buff, current_time: f64) -> bool {
    match (buff.start_time, buff.duration) {
        (Some(start_time), Some(duration)) if start_time.is_finite() && duration.is_finite() => {
            start_time + duration <= current_time
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(unique_hrid: &str, type_hrid: &str, ratio: f64, flat: f64, duration: f64) -> RawBuffInput {
        RawBuffInput {
            unique_hrid: Some(unique_hrid.to_string()),
            type_hrid: Some(type_hrid.to_string()),
            ratio_boost: Some(ratio),
            flat_boost: Some(flat),
            duration: Some(duration),
            ..Default::default()
        }
    }

    fn fierce_aura(flat: f64) -> RawBuffInput {
        raw("/buff_uniques/fierce_aura", "/buff_types/fierce_aura", 0.0, flat, 10000.0)
    }

    #[test]
    fn default_panel_matches_js_initial_values() {
        let unit = CombatUnit::default();
        assert_eq!(unit.combat_details.max_hitpoints, 110.0);
        assert_eq!(unit.combat_details.current_manapoints, 110.0);
        assert_eq!(unit.combat_details.stab_accuracy_rating, 11.0);
        assert_eq!(unit.combat_details.total_armor, 0.2);
        assert_eq!(unit.combat_details.total_fire_resistance, 0.4);
        assert_eq!(unit.combat_details.total_threat, 100.0);
        assert_eq!(unit.combat_details.combat_stats.attack_interval, 3000000000.0);
        assert_eq!(unit.combat_details.combat_stats.threat, 100.0);
        assert_eq!(unit.combat_details.combat_stats.hp_regen_per10, 0.01);
        assert_eq!(unit.combat_details.combat_stats.food_slots, 1.0);
        assert_eq!(unit.combat_details.combat_stats.combat_style_hrid, "/combat_styles/smash");
        assert!(unit.base_combat_stats.is_none());
        assert_eq!(unit.buff_source_sequence, 0);
    }

    #[test]
    fn player_regen_bonus_and_level_buffs_are_idempotent() {
        let mut unit = CombatUnit { is_player: true, ..Default::default() };
        unit.refresh_base_combat_stats();
        unit.update_combat_details();
        assert_eq!(unit.combat_details.combat_stats.hp_regen_per10, 0.02);
        assert_eq!(unit.combat_details.combat_stats.mp_regen_per10, 0.02);

        unit.add_buff(&raw("/buff_uniques/level_up", "/buff_types/stamina_level", 0.5, 2.0, 1000.0), 0.0, None, None)
            .expect("registers");
        // 等级 = base(1) + 1*0.5 + 2
        assert_eq!(unit.combat_details.stamina_level, 3.5);
        // maxHitpoints = floor((10*(10+3.5) + 0 + 0) * (1 + 0 + 0))
        assert_eq!(unit.combat_details.max_hitpoints, 135.0);
        // 幂等：重复结算从基准快照恢复
        unit.update_combat_details();
        assert_eq!(unit.combat_details.stamina_level, 3.5);
        assert_eq!(unit.combat_details.max_hitpoints, 135.0);
    }

    #[test]
    fn threat_ratio_zero_branch_overrides_base_then_adds_flat() {
        let mut unit = CombatUnit::default();
        unit.refresh_base_combat_stats();
        unit.add_buff(&raw("/buff_uniques/t_zero", "/buff_types/threat", 0.0, 25.0, 1000.0), 0.0, None, None)
            .expect("registers");
        // base = 100 + combatStats.threat(100) = 200；ratio 为 0 → 覆盖为 base，再 + flat
        assert_eq!(unit.combat_details.total_threat, 200.0);
        assert_eq!(unit.combat_details.combat_stats.threat, 225.0);
        // 重复结算幂等（基准快照把 threat 还原为 100）
        unit.update_combat_details();
        assert_eq!(unit.combat_details.combat_stats.threat, 225.0);
    }

    #[test]
    fn threat_ratio_branch_scales_base() {
        let mut unit = CombatUnit::default();
        unit.refresh_base_combat_stats();
        unit.add_buff(&raw("/buff_uniques/t_ratio", "/buff_types/threat", 0.25, 5.0, 1000.0), 0.0, None, None)
            .expect("registers");
        // base = 200 → 100 + 200*0.25 + 5 = 155
        assert_eq!(unit.combat_details.total_threat, 200.0);
        assert_eq!(unit.combat_details.combat_stats.threat, 155.0);
    }

    #[test]
    fn strongest_policy_hands_off_and_ties_keep_incumbent() {
        let mut unit = CombatUnit::default();
        unit.refresh_base_combat_stats();
        fn active(unit: &CombatUnit) -> Option<&str> {
            unit.active_buff_source_keys.get_str("/buff_uniques/fierce_aura").map(String::as_str)
        }

        unit.add_buff(&fierce_aura(0.2), 0.0, Some("ally_a"), Some("strongest")).expect("registers");
        unit.add_buff(&fierce_aura(0.1), 100.0, Some("ally_b"), Some("strongest")).expect("registers");
        // 新源更弱：不交接
        assert_eq!(active(&unit), Some("ally_a"));

        // 平局：保留先注册的 ally_a（迭代顺序决定，而非「后写覆盖」）
        unit.add_buff(&fierce_aura(0.2), 200.0, Some("ally_c"), Some("strongest")).expect("registers");
        assert_eq!(active(&unit), Some("ally_a"));

        // 明确更强：交接
        unit.add_buff(&fierce_aura(0.3), 300.0, Some("ally_d"), Some("strongest")).expect("registers");
        assert_eq!(active(&unit), Some("ally_d"));

        // 移除活动源 → 交接给剩余最强（ally_a 与 ally_c 平局 → 先注册的 ally_a）
        unit.remove_buff(Some("/buff_uniques/fierce_aura"), BuffSourceSelector::ActiveSource).expect("removes");
        assert_eq!(active(&unit), Some("ally_a"));
        assert_eq!(unit.buff_source_sequence, 4);
    }

    #[test]
    fn replace_policy_active_removal_cascades_and_clears_sources() {
        let mut unit = CombatUnit::default();
        unit.refresh_base_combat_stats();
        unit.add_buff(&raw("/scrolls/x", "/buff_types/damage", 0.1, 0.0, 1000.0), 0.0, None, None).expect("registers");
        unit.add_buff(&raw("/scrolls/x", "/buff_types/damage", 0.2, 0.0, 5000.0), 100.0, Some("scroll:x"), None)
            .expect("registers");
        assert_eq!(unit.active_buff_source_keys.get_str("/scrolls/x").map(String::as_str), Some("scroll:x"));

        unit.remove_buff(Some("/scrolls/x"), BuffSourceSelector::ActiveSource).expect("removes");
        // REPLACE + 活动源移除 → 级联清除：无休眠交接
        assert!(!unit.combat_buffs.contains_key_str("/scrolls/x"));
        assert!(!unit.buff_sources.contains_key_str("/scrolls/x"));
        assert!(!unit.buff_source_policies.contains_key_str("/scrolls/x"));
        assert!(unit.active_buff_source_keys.is_empty());
    }

    #[test]
    fn expired_replace_source_cascades_and_reports_dirty() {
        let mut unit = CombatUnit::default();
        unit.add_buff(&raw("/u/expire", "/buff_types/damage", 1.0, 0.0, 500.0), 0.0, None, None).expect("registers");
        assert!(!unit.remove_expired_buffs(100.0, true).expect("scans"));
        assert!(unit.remove_expired_buffs(500.0, true).expect("scans"));
        assert!(!unit.combat_buffs.contains_key_str("/u/expire"));
        assert!(!unit.buff_sources.contains_key_str("/u/expire"));
        assert!(!unit.remove_expired_buff_by_unique_hrid("", 9999.0, true).expect("ignores empty hrid"));
    }

    #[test]
    fn legacy_buff_without_sources_expires_by_start_time() {
        let mut unit = CombatUnit::default();
        unit.combat_buffs.set(
            "/u/legacy".to_string(),
            Buff {
                unique_hrid: "/u/legacy".to_string(),
                type_hrid: "/buff_types/damage".to_string(),
                ratio_boost: 0.5,
                flat_boost: 0.0,
                duration: Some(100.0),
                start_time: Some(50.0),
                multiplier_for_skill_hrid: String::new(),
                multiplier_per_skill_level: 0.0,
            },
        );
        assert!(!unit.remove_expired_buffs(149.0, false).expect("scans"));
        assert!(unit.remove_expired_buffs(150.0, false).expect("scans"));
        assert!(!unit.combat_buffs.contains_key_str("/u/legacy"));
    }

    #[test]
    fn permanent_buffs_accumulate_by_type_and_survive_clear() {
        let mut unit = CombatUnit::default();
        unit.add_permanent_buff(&RawBuffInput {
            type_hrid: Some("/buff_types/damage".to_string()),
            unique_hrid: Some("/u/house".to_string()),
            ratio_boost: Some(0.1),
            flat_boost: Some(5.0),
            ..Default::default()
        });
        unit.add_permanent_buff(&RawBuffInput {
            type_hrid: Some("/buff_types/damage".to_string()),
            unique_hrid: Some("/u/guild".to_string()),
            ratio_boost: Some(0.05),
            flat_boost: Some(2.0),
            ..Default::default()
        });
        let merged = unit.permanent_buffs.get_str("/buff_types/damage").expect("permanent buff stored");
        assert_eq!(merged.ratio_boost, 0.15000000000000002);
        assert_eq!(merged.flat_boost, 7.0);
        // 首次写入克隆：保留首个记录的 uniqueHrid，累加只作用于本单位副本
        assert_eq!(merged.unique_hrid, "/u/house");

        unit.clear_buffs();
        assert!(unit.combat_buffs.contains_key_str("/buff_types/damage"));
        assert_eq!(unit.permanent_buffs.len(), 1);
        assert!(unit.buff_sources.is_empty());
        assert_eq!(unit.buff_source_sequence, 0);
    }

    #[test]
    fn generate_permanent_buffs_follows_js_order() {
        let mut unit = CombatUnit {
            house_rooms: vec![BuffList {
                buffs: vec![RawBuffInput {
                    type_hrid: Some("/buff_types/max_hitpoints".to_string()),
                    unique_hrid: Some("/house/room".to_string()),
                    ratio_boost: Some(0.0),
                    flat_boost: Some(30.0),
                    ..Default::default()
                }],
            }],
            guild_buffs: vec![BuffList {
                buffs: vec![RawBuffInput {
                    type_hrid: Some("/buff_types/max_hitpoints".to_string()),
                    unique_hrid: Some("/guild/buff".to_string()),
                    ratio_boost: Some(0.0),
                    flat_boost: Some(20.0),
                    ..Default::default()
                }],
            }],
            achievements: Some(BuffList {
                buffs: vec![RawBuffInput {
                    type_hrid: Some("/buff_types/evasion".to_string()),
                    unique_hrid: Some("/achievements/a".to_string()),
                    ratio_boost: Some(0.05),
                    flat_boost: Some(0.0),
                    ..Default::default()
                }],
            }),
            zone_buffs: vec![RawBuffInput {
                type_hrid: Some("/buff_types/evasion".to_string()),
                unique_hrid: Some("/zone/buff".to_string()),
                ratio_boost: Some(0.01),
                flat_boost: Some(2.0),
                ..Default::default()
            }],
            extra_buffs: vec![RawBuffInput {
                type_hrid: Some("/buff_types/evasion".to_string()),
                unique_hrid: Some("/extra/buff".to_string()),
                ratio_boost: Some(0.02),
                flat_boost: Some(1.0),
                ..Default::default()
            }],
            ..Default::default()
        };
        unit.generate_permanent_buffs();
        assert_eq!(unit.permanent_buffs.len(), 2);
        let hitpoints = unit.permanent_buffs.get_str("/buff_types/max_hitpoints").expect("merged");
        assert_eq!(hitpoints.flat_boost, 50.0);
        assert_eq!(hitpoints.unique_hrid, "/house/room");
        let evasion = unit.permanent_buffs.get_str("/buff_types/evasion").expect("merged");
        assert_eq!(evasion.ratio_boost, 0.05 + 0.01 + 0.02);
        assert_eq!(evasion.flat_boost, 3.0);
    }

    #[test]
    fn bulwark_adds_defensive_damage_to_smash() {
        let mut plain = CombatUnit::default();
        plain.refresh_base_combat_stats();
        plain.update_combat_details();
        assert_eq!(plain.combat_details.defensive_max_damage, 11.0);
        assert_eq!(plain.combat_details.smash_max_damage, 11.0);

        let mut bulwark_unit = CombatUnit { two_hand_hrid: Some("x_bulwark_shield".to_string()), ..Default::default() };
        bulwark_unit.refresh_base_combat_stats();
        bulwark_unit.update_combat_details();
        assert_eq!(bulwark_unit.combat_details.defensive_max_damage, 11.0);
        assert_eq!(bulwark_unit.combat_details.smash_max_damage, 22.0);
    }

    #[test]
    fn policy_mismatch_and_strongest_validation_fail_loudly() {
        let mut unit = CombatUnit::default();
        unit.add_buff(&fierce_aura(0.1), 0.0, None, None).expect("registers with default policy");
        let mismatch = unit.add_buff(&fierce_aura(0.2), 100.0, None, Some("strongest")).expect_err("policy conflict");
        assert_eq!(mismatch.kind, UnitErrorKind::Error);
        assert_eq!(
            mismatch.message,
            "CombatUnit buff source policy mismatch for /buff_uniques/fierce_aura: replace vs strongest"
        );

        let mut other = CombatUnit::default();
        let unsupported = other
            .add_buff(&raw("/u/not_aura", "/buff_types/damage", 0.0, 1.0, 100.0), 0.0, None, Some("strongest"))
            .expect_err("unsupported aura");
        assert_eq!(unsupported.kind, UnitErrorKind::TypeError);
        assert_eq!(unsupported.message, "Strongest-source policy is unsupported for /u/not_aura");

        let bogus = other
            .add_buff(&raw("/u/b", "/buff_types/damage", 0.0, 1.0, 100.0), 0.0, None, Some("bogus"))
            .expect_err("bogus policy");
        assert_eq!(bogus.kind, UnitErrorKind::TypeError);
        assert_eq!(bogus.message, "Unsupported buff source policy: bogus");

        let bad_duration = other
            .add_buff(&RawBuffInput { duration: None, ..raw("/u/c", "/buff_types/damage", 0.0, 1.0, 100.0) }, 0.0, None, None)
            .expect_err("missing duration");
        assert_eq!(bad_duration.message, "CombatUnit buff duration must be a finite number for /u/c");
    }

    #[test]
    fn index_buffs_by_type_accumulates_in_iteration_order() {
        let mut unit = CombatUnit::default();
        unit.add_buff(&raw("/u/a", "/buff_types/damage", 0.1, 1.0, 1000.0), 0.0, None, None).expect("registers");
        unit.add_buff(&raw("/u/b", "/buff_types/damage", 0.2, 2.0, 1000.0), 1.0, None, None).expect("registers");
        unit.add_buff(&raw("/u/c", "/buff_types/armor", 0.0, 0.5, 1000.0), 2.0, None, None).expect("registers");
        let index = index_buffs_by_type(&unit.combat_buffs);
        let damage = index.get_str("/buff_types/damage").expect("damage group");
        assert_eq!(damage.ratio_boost, 0.1 + 0.2);
        assert_eq!(damage.flat_boost, 3.0);
        assert_eq!(damage.buffs.len(), 2);
        assert_eq!(index.get_str("/buff_types/armor").expect("armor group").flat_boost, 0.5);
    }

    #[test]
    fn remove_buff_with_explicit_null_targets_default_source() {
        let mut unit = CombatUnit::default();
        unit.add_buff(&raw("/u/default_key", "/buff_types/damage", 0.3, 0.0, 1000.0), 0.0, None, None).expect("registers");
        unit.remove_buff(Some("/u/default_key"), BuffSourceSelector::Explicit(None)).expect("removes default");
        assert!(!unit.combat_buffs.contains_key_str("/u/default_key"));
        assert!(!unit.buff_sources.contains_key_str("/u/default_key"));
    }
}
