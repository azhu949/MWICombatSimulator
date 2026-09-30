//! hrid 字符串驻留（切片 25）：引擎内部以 `u32` 句柄流转 hrid，热路径零字符串分配。
//!
//! 设计：
//! - `Hrid`：`u32` 新类型，相等 ⟺ 原字符串相等（同一线程内保证）。
//! - `Interner`：字符串 → 句柄注册表（按内容去重），**线程局部**（WASM 单线程；
//!   原生测试逐线程独立，不会互相污染）。
//! - well-known 常量：启动时按固定顺序预注册的一批高频字符串（战斗风格 / 伤害类型 /
//!   效果与目标类型 / 增益类型），其 `u32` 值 = 表中序号——**跨线程一致**且可用于
//!   `match` 模式。只允许向表尾追加，绝不可重排或删除（否则常量全部错位）。
//! - serde：`Hrid` 序列化为原字符串、反序列化时自动注册——所有 `derive(Serialize/
//!   Deserialize)` 的输入/输出结构无需改动，JSON 形状逐字不变。
//!
//! 使用边界：动态注册的编号逐线程独立，Hrid **不应跨线程传递**；本引擎在单线程内使用。
//! 输出侧（JSON / 错误消息 / 日志）一律经 `Serialize` / `with_hrid` / `hrid_to_string`
//! 映射回原字符串。

use serde::de::Visitor;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;

/// 驻留后的 hrid 句柄（`u32` 编号；相等 ⟺ 原字符串相等）。
///
/// 派生 `Hash` 供集合使用；刻意不派生 `PartialOrd/Ord`（u32 序 ≠ 字符串序，排序请先
/// 映射回字符串）。
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Hrid(u32);

/// well-known 常量表：**预注册顺序即 u32 值，只可向尾部追加**。
/// 与下方 `impl Hrid` 的常量一一对应，由测试逐项锁定。
const WELL_KNOWN: &[&str] = &[
    // 0-2：通用哨兵
    "",            // 0  EMPTY：String::default() 的对应物
    "undefined",   // 1  UNDEFINED：可选 hrid 字段缺省（combat_style / damage_type）
    "default",     // 2  DEFAULT：buff 源注册表的缺省 source key
    // 3-7：战斗风格
    "/combat_styles/stab",   // 3
    "/combat_styles/slash",  // 4
    "/combat_styles/smash",  // 5
    "/combat_styles/ranged", // 6
    "/combat_styles/magic",  // 7
    // 8-11：伤害类型
    "/damage_types/physical", // 8
    "/damage_types/water",    // 9
    "/damage_types/nature",   // 10
    "/damage_types/fire",     // 11
    // 12-17：技能效果类型
    "/ability_effect_types/buff",     // 12
    "/ability_effect_types/damage",   // 13
    "/ability_effect_types/heal",     // 14
    "/ability_effect_types/spend_hp", // 15
    "/ability_effect_types/revive",   // 16
    "/ability_effect_types/promote",  // 17
    // 18-22：效果目标类型
    "self",          // 18
    "allAllies",     // 19
    "enemy",         // 20
    "allEnemies",    // 21
    "lowestHpAlly",  // 22
    // 23-62：增益类型（SettlementBoosts::slot_mut 的消费键，40 项）
    "/buff_types/stamina_level",       // 23
    "/buff_types/intelligence_level",  // 24
    "/buff_types/attack_level",        // 25
    "/buff_types/melee_level",         // 26
    "/buff_types/defense_level",       // 27
    "/buff_types/ranged_level",        // 28
    "/buff_types/magic_level",         // 29
    "/buff_types/evasion",             // 30
    "/buff_types/armor",               // 31
    "/buff_types/water_resistance",    // 32
    "/buff_types/nature_resistance",   // 33
    "/buff_types/fire_resistance",     // 34
    "/buff_types/max_hitpoints",       // 35
    "/buff_types/max_manapoints",      // 36
    "/buff_types/fury_accuracy",       // 37
    "/buff_types/fury_damage",         // 38
    "/buff_types/accuracy",            // 39
    "/buff_types/damage",              // 40
    "/buff_types/damage_taken",        // 41
    "/buff_types/physical_amplify",    // 42
    "/buff_types/water_amplify",       // 43
    "/buff_types/nature_amplify",      // 44
    "/buff_types/fire_amplify",        // 45
    "/buff_types/healing_amplify",     // 46
    "/buff_types/attack_speed",        // 47
    "/buff_types/hp_regen",            // 48
    "/buff_types/mp_regen",            // 49
    "/buff_types/life_steal",          // 50
    "/buff_types/physical_thorns",     // 51
    "/buff_types/elemental_thorns",    // 52
    "/buff_types/wisdom",              // 53
    "/buff_types/critical_rate",       // 54
    "/buff_types/critical_damage",     // 55
    "/buff_types/cast_speed",          // 56
    "/buff_types/combat_drop_rate",    // 57
    "/buff_types/rare_find",           // 58
    "/buff_types/combat_drop_quantity", // 59
    "/buff_types/threat",              // 60
    "/buff_types/retaliation",         // 61
    "/buff_types/tenacity",            // 62
    // 63-81：事件类型（`QueueItem::event_type` 的比较键，19 项）
    "combatStart",          // 63
    "playerRespawn",        // 64
    "enemyRespawn",         // 65
    "autoAttack",           // 66
    "abilityCastEndEvent",  // 67
    "consumableTick",       // 68
    "damageOverTime",       // 69
    "checkBuffExpiration",  // 70
    "scrollRenewal",        // 71
    "regenTick",            // 72
    "stunExpiration",       // 73
    "blindExpiration",      // 74
    "silenceExpiration",    // 75
    "curseExpiration",      // 76
    "weakenExpiration",     // 77
    "furyExpiration",       // 78
    "enrageTick",           // 79
    "awaitCooldownEvent",   // 80
    "cooldownReady",        // 81
    // 82-99：触发器依赖 / 比较器 / 独立条件（trigger 与 consumable 快速路径共用）
    "/combat_trigger_dependencies/self",              // 82
    "/combat_trigger_dependencies/targeted_enemy",    // 83
    "/combat_trigger_dependencies/all_allies",        // 84
    "/combat_trigger_dependencies/all_enemies",       // 85
    "/combat_trigger_comparators/greater_than_equal", // 86
    "/combat_trigger_comparators/less_than_equal",    // 87
    "/combat_trigger_comparators/is_active",          // 88
    "/combat_trigger_comparators/is_inactive",        // 89
    "/combat_trigger_conditions/current_hp",          // 90
    "/combat_trigger_conditions/current_mp",          // 91
    "/combat_trigger_conditions/missing_hp",          // 92
    "/combat_trigger_conditions/missing_mp",          // 93
    "/combat_trigger_conditions/stun_status",         // 94
    "/combat_trigger_conditions/blind_status",        // 95
    "/combat_trigger_conditions/silence_status",      // 96
    "/combat_trigger_conditions/number_of_active_units", // 97
    "/combat_trigger_conditions/number_of_dead_units",   // 98
    "/combat_trigger_conditions/lowest_hp_percentage",   // 99
    // 100-105：战斗负面状态增益（simulator 固定 uniqueHrid）
    "/buff_uniques/curse",           // 100
    "/buff_uniques/weaken",          // 101
    "/buff_uniques/fury_accuracy",   // 102
    "/buff_uniques/fury_damage",     // 103
    "/buff_uniques/enrage_damage",   // 104
    "/buff_uniques/enrage_accuracy", // 105
    // 106-110：队伍光环技能
    "/abilities/speed_aura",    // 106
    "/abilities/guardian_aura", // 107
    "/abilities/fierce_aura",   // 108
    "/abilities/critical_aura", // 109
    "/abilities/mystic_aura",   // 110
    // 111-124：队伍光环增益 uniqueHrid（顺序同 PARTY_AURA_STRENGTH_FIELDS）
    "/buff_uniques/speed_aura_attack_speed",        // 111
    "/buff_uniques/speed_aura_cast_speed",          // 112
    "/buff_uniques/guardian_aura_healing_amplify",  // 113
    "/buff_uniques/guardian_aura_evasion",          // 114
    "/buff_uniques/guardian_aura_armor",            // 115
    "/buff_uniques/guardian_aura_water_resistance", // 116
    "/buff_uniques/guardian_aura_nature_resistance", // 117
    "/buff_uniques/guardian_aura_fire_resistance",  // 118
    "/buff_uniques/fierce_aura",                    // 119
    "/buff_uniques/critical_aura_rate",             // 120
    "/buff_uniques/critical_aura_damage",           // 121
    "/buff_uniques/mystic_aura_water_amplify",      // 122
    "/buff_uniques/mystic_aura_nature_amplify",     // 123
    "/buff_uniques/mystic_aura_fire_amplify",       // 124
];

impl Hrid {
    // —— well-known 常量（序号必须与 WELL_KNOWN 一致；测试 `well_known_constants_resolve` 锁定）——
    /// 空字符串（`String::default()` 的对应物）。
    pub const EMPTY: Hrid = Hrid(0);
    /// 可选 hrid 字段缺省哨兵（JS `undefined`）。
    pub const UNDEFINED: Hrid = Hrid(1);
    /// buff 源注册表的缺省 source key。
    pub const DEFAULT: Hrid = Hrid(2);
    pub const COMBAT_STYLE_STAB: Hrid = Hrid(3);
    pub const COMBAT_STYLE_SLASH: Hrid = Hrid(4);
    pub const COMBAT_STYLE_SMASH: Hrid = Hrid(5);
    pub const COMBAT_STYLE_RANGED: Hrid = Hrid(6);
    pub const COMBAT_STYLE_MAGIC: Hrid = Hrid(7);
    pub const DAMAGE_TYPE_PHYSICAL: Hrid = Hrid(8);
    pub const DAMAGE_TYPE_WATER: Hrid = Hrid(9);
    pub const DAMAGE_TYPE_NATURE: Hrid = Hrid(10);
    pub const DAMAGE_TYPE_FIRE: Hrid = Hrid(11);
    pub const EFFECT_BUFF: Hrid = Hrid(12);
    pub const EFFECT_DAMAGE: Hrid = Hrid(13);
    pub const EFFECT_HEAL: Hrid = Hrid(14);
    pub const EFFECT_SPEND_HP: Hrid = Hrid(15);
    pub const EFFECT_REVIVE: Hrid = Hrid(16);
    pub const EFFECT_PROMOTE: Hrid = Hrid(17);
    pub const TARGET_SELF: Hrid = Hrid(18);
    pub const TARGET_ALL_ALLIES: Hrid = Hrid(19);
    pub const TARGET_ENEMY: Hrid = Hrid(20);
    pub const TARGET_ALL_ENEMIES: Hrid = Hrid(21);
    pub const TARGET_LOWEST_HP_ALLY: Hrid = Hrid(22);

    // —— 增益类型常量（序号必须与 WELL_KNOWN 的 23..62 段一致，顺序同 SettlementBoosts::slot_mut）——
    /// `/buff_types/stamina_level`。
    pub const BUFF_TYPE_STAMINA_LEVEL: Hrid = Hrid(23);
    /// `/buff_types/intelligence_level`。
    pub const BUFF_TYPE_INTELLIGENCE_LEVEL: Hrid = Hrid(24);
    /// `/buff_types/attack_level`。
    pub const BUFF_TYPE_ATTACK_LEVEL: Hrid = Hrid(25);
    /// `/buff_types/melee_level`。
    pub const BUFF_TYPE_MELEE_LEVEL: Hrid = Hrid(26);
    /// `/buff_types/defense_level`。
    pub const BUFF_TYPE_DEFENSE_LEVEL: Hrid = Hrid(27);
    /// `/buff_types/ranged_level`。
    pub const BUFF_TYPE_RANGED_LEVEL: Hrid = Hrid(28);
    /// `/buff_types/magic_level`。
    pub const BUFF_TYPE_MAGIC_LEVEL: Hrid = Hrid(29);
    /// `/buff_types/evasion`。
    pub const BUFF_TYPE_EVASION: Hrid = Hrid(30);
    /// `/buff_types/armor`。
    pub const BUFF_TYPE_ARMOR: Hrid = Hrid(31);
    /// `/buff_types/water_resistance`。
    pub const BUFF_TYPE_WATER_RESISTANCE: Hrid = Hrid(32);
    /// `/buff_types/nature_resistance`。
    pub const BUFF_TYPE_NATURE_RESISTANCE: Hrid = Hrid(33);
    /// `/buff_types/fire_resistance`。
    pub const BUFF_TYPE_FIRE_RESISTANCE: Hrid = Hrid(34);
    /// `/buff_types/max_hitpoints`。
    pub const BUFF_TYPE_MAX_HITPOINTS: Hrid = Hrid(35);
    /// `/buff_types/max_manapoints`。
    pub const BUFF_TYPE_MAX_MANAPOINTS: Hrid = Hrid(36);
    /// `/buff_types/fury_accuracy`。
    pub const BUFF_TYPE_FURY_ACCURACY: Hrid = Hrid(37);
    /// `/buff_types/fury_damage`。
    pub const BUFF_TYPE_FURY_DAMAGE: Hrid = Hrid(38);
    /// `/buff_types/accuracy`。
    pub const BUFF_TYPE_ACCURACY: Hrid = Hrid(39);
    /// `/buff_types/damage`。
    pub const BUFF_TYPE_DAMAGE: Hrid = Hrid(40);
    /// `/buff_types/damage_taken`。
    pub const BUFF_TYPE_DAMAGE_TAKEN: Hrid = Hrid(41);
    /// `/buff_types/physical_amplify`。
    pub const BUFF_TYPE_PHYSICAL_AMPLIFY: Hrid = Hrid(42);
    /// `/buff_types/water_amplify`。
    pub const BUFF_TYPE_WATER_AMPLIFY: Hrid = Hrid(43);
    /// `/buff_types/nature_amplify`。
    pub const BUFF_TYPE_NATURE_AMPLIFY: Hrid = Hrid(44);
    /// `/buff_types/fire_amplify`。
    pub const BUFF_TYPE_FIRE_AMPLIFY: Hrid = Hrid(45);
    /// `/buff_types/healing_amplify`。
    pub const BUFF_TYPE_HEALING_AMPLIFY: Hrid = Hrid(46);
    /// `/buff_types/attack_speed`。
    pub const BUFF_TYPE_ATTACK_SPEED: Hrid = Hrid(47);
    /// `/buff_types/hp_regen`。
    pub const BUFF_TYPE_HP_REGEN: Hrid = Hrid(48);
    /// `/buff_types/mp_regen`。
    pub const BUFF_TYPE_MP_REGEN: Hrid = Hrid(49);
    /// `/buff_types/life_steal`。
    pub const BUFF_TYPE_LIFE_STEAL: Hrid = Hrid(50);
    /// `/buff_types/physical_thorns`。
    pub const BUFF_TYPE_PHYSICAL_THORNS: Hrid = Hrid(51);
    /// `/buff_types/elemental_thorns`。
    pub const BUFF_TYPE_ELEMENTAL_THORNS: Hrid = Hrid(52);
    /// `/buff_types/wisdom`。
    pub const BUFF_TYPE_WISDOM: Hrid = Hrid(53);
    /// `/buff_types/critical_rate`。
    pub const BUFF_TYPE_CRITICAL_RATE: Hrid = Hrid(54);
    /// `/buff_types/critical_damage`。
    pub const BUFF_TYPE_CRITICAL_DAMAGE: Hrid = Hrid(55);
    /// `/buff_types/cast_speed`。
    pub const BUFF_TYPE_CAST_SPEED: Hrid = Hrid(56);
    /// `/buff_types/combat_drop_rate`。
    pub const BUFF_TYPE_COMBAT_DROP_RATE: Hrid = Hrid(57);
    /// `/buff_types/rare_find`。
    pub const BUFF_TYPE_RARE_FIND: Hrid = Hrid(58);
    /// `/buff_types/combat_drop_quantity`。
    pub const BUFF_TYPE_COMBAT_DROP_QUANTITY: Hrid = Hrid(59);
    /// `/buff_types/threat`。
    pub const BUFF_TYPE_THREAT: Hrid = Hrid(60);
    /// `/buff_types/retaliation`。
    pub const BUFF_TYPE_RETALIATION: Hrid = Hrid(61);
    /// `/buff_types/tenacity`。
    pub const BUFF_TYPE_TENACITY: Hrid = Hrid(62);

    // —— 事件类型常量（序号必须与 WELL_KNOWN 一致；测试 `event_type_constants_resolve_to_js_type_strings` 锁定）——
    /// JS 事件 `type` 字符串 `"combatStart"`。
    pub const EVENT_COMBAT_START: Hrid = Hrid(63);
    /// JS 事件 `type` 字符串 `"playerRespawn"`。
    pub const EVENT_PLAYER_RESPAWN: Hrid = Hrid(64);
    /// JS 事件 `type` 字符串 `"enemyRespawn"`。
    pub const EVENT_ENEMY_RESPAWN: Hrid = Hrid(65);
    /// JS 事件 `type` 字符串 `"autoAttack"`。
    pub const EVENT_AUTO_ATTACK: Hrid = Hrid(66);
    /// JS 事件 `type` 字符串 `"abilityCastEndEvent"`。
    pub const EVENT_ABILITY_CAST_END: Hrid = Hrid(67);
    /// JS 事件 `type` 字符串 `"consumableTick"`。
    pub const EVENT_CONSUMABLE_TICK: Hrid = Hrid(68);
    /// JS 事件 `type` 字符串 `"damageOverTime"`。
    pub const EVENT_DAMAGE_OVER_TIME: Hrid = Hrid(69);
    /// JS 事件 `type` 字符串 `"checkBuffExpiration"`。
    pub const EVENT_CHECK_BUFF_EXPIRATION: Hrid = Hrid(70);
    /// JS 事件 `type` 字符串 `"scrollRenewal"`。
    pub const EVENT_SCROLL_RENEWAL: Hrid = Hrid(71);
    /// JS 事件 `type` 字符串 `"regenTick"`。
    pub const EVENT_REGEN_TICK: Hrid = Hrid(72);
    /// JS 事件 `type` 字符串 `"stunExpiration"`。
    pub const EVENT_STUN_EXPIRATION: Hrid = Hrid(73);
    /// JS 事件 `type` 字符串 `"blindExpiration"`。
    pub const EVENT_BLIND_EXPIRATION: Hrid = Hrid(74);
    /// JS 事件 `type` 字符串 `"silenceExpiration"`。
    pub const EVENT_SILENCE_EXPIRATION: Hrid = Hrid(75);
    /// JS 事件 `type` 字符串 `"curseExpiration"`。
    pub const EVENT_CURSE_EXPIRATION: Hrid = Hrid(76);
    /// JS 事件 `type` 字符串 `"weakenExpiration"`。
    pub const EVENT_WEAKEN_EXPIRATION: Hrid = Hrid(77);
    /// JS 事件 `type` 字符串 `"furyExpiration"`。
    pub const EVENT_FURY_EXPIRATION: Hrid = Hrid(78);
    /// JS 事件 `type` 字符串 `"enrageTick"`。
    pub const EVENT_ENRAGE_TICK: Hrid = Hrid(79);
    /// JS 事件 `type` 字符串 `"awaitCooldownEvent"`。
    pub const EVENT_AWAIT_COOLDOWN: Hrid = Hrid(80);
    /// JS 事件 `type` 字符串 `"cooldownReady"`。
    pub const EVENT_COOLDOWN_READY: Hrid = Hrid(81);

    // —— 触发器常量（序号必须与 WELL_KNOWN 一致）——
    /// `/combat_trigger_dependencies/self`。
    pub const TRIGGER_DEP_SELF: Hrid = Hrid(82);
    /// `/combat_trigger_dependencies/targeted_enemy`。
    pub const TRIGGER_DEP_TARGETED_ENEMY: Hrid = Hrid(83);
    /// `/combat_trigger_dependencies/all_allies`。
    pub const TRIGGER_DEP_ALL_ALLIES: Hrid = Hrid(84);
    /// `/combat_trigger_dependencies/all_enemies`。
    pub const TRIGGER_DEP_ALL_ENEMIES: Hrid = Hrid(85);
    /// `/combat_trigger_comparators/greater_than_equal`。
    pub const TRIGGER_CMP_GREATER_THAN_EQUAL: Hrid = Hrid(86);
    /// `/combat_trigger_comparators/less_than_equal`。
    pub const TRIGGER_CMP_LESS_THAN_EQUAL: Hrid = Hrid(87);
    /// `/combat_trigger_comparators/is_active`。
    pub const TRIGGER_CMP_IS_ACTIVE: Hrid = Hrid(88);
    /// `/combat_trigger_comparators/is_inactive`。
    pub const TRIGGER_CMP_IS_INACTIVE: Hrid = Hrid(89);
    /// `/combat_trigger_conditions/current_hp`。
    pub const TRIGGER_COND_CURRENT_HP: Hrid = Hrid(90);
    /// `/combat_trigger_conditions/current_mp`。
    pub const TRIGGER_COND_CURRENT_MP: Hrid = Hrid(91);
    /// `/combat_trigger_conditions/missing_hp`。
    pub const TRIGGER_COND_MISSING_HP: Hrid = Hrid(92);
    /// `/combat_trigger_conditions/missing_mp`。
    pub const TRIGGER_COND_MISSING_MP: Hrid = Hrid(93);
    /// `/combat_trigger_conditions/stun_status`。
    pub const TRIGGER_COND_STUN_STATUS: Hrid = Hrid(94);
    /// `/combat_trigger_conditions/blind_status`。
    pub const TRIGGER_COND_BLIND_STATUS: Hrid = Hrid(95);
    /// `/combat_trigger_conditions/silence_status`。
    pub const TRIGGER_COND_SILENCE_STATUS: Hrid = Hrid(96);
    /// `/combat_trigger_conditions/number_of_active_units`。
    pub const TRIGGER_COND_NUMBER_OF_ACTIVE_UNITS: Hrid = Hrid(97);
    /// `/combat_trigger_conditions/number_of_dead_units`。
    pub const TRIGGER_COND_NUMBER_OF_DEAD_UNITS: Hrid = Hrid(98);
    /// `/combat_trigger_conditions/lowest_hp_percentage`。
    pub const TRIGGER_COND_LOWEST_HP_PERCENTAGE: Hrid = Hrid(99);

    // —— 战斗负面状态增益常量 ——
    /// `/buff_uniques/curse`。
    pub const BUFF_UNIQUE_CURSE: Hrid = Hrid(100);
    /// `/buff_uniques/weaken`。
    pub const BUFF_UNIQUE_WEAKEN: Hrid = Hrid(101);
    /// `/buff_uniques/fury_accuracy`。
    pub const BUFF_UNIQUE_FURY_ACCURACY: Hrid = Hrid(102);
    /// `/buff_uniques/fury_damage`。
    pub const BUFF_UNIQUE_FURY_DAMAGE: Hrid = Hrid(103);
    /// `/buff_uniques/enrage_damage`。
    pub const BUFF_UNIQUE_ENRAGE_DAMAGE: Hrid = Hrid(104);
    /// `/buff_uniques/enrage_accuracy`。
    pub const BUFF_UNIQUE_ENRAGE_ACCURACY: Hrid = Hrid(105);

    // —— 队伍光环技能常量 ——
    /// `/abilities/speed_aura`。
    pub const ABILITY_SPEED_AURA: Hrid = Hrid(106);
    /// `/abilities/guardian_aura`。
    pub const ABILITY_GUARDIAN_AURA: Hrid = Hrid(107);
    /// `/abilities/fierce_aura`。
    pub const ABILITY_FIERCE_AURA: Hrid = Hrid(108);
    /// `/abilities/critical_aura`。
    pub const ABILITY_CRITICAL_AURA: Hrid = Hrid(109);
    /// `/abilities/mystic_aura`。
    pub const ABILITY_MYSTIC_AURA: Hrid = Hrid(110);

    // —— 队伍光环增益常量（顺序必须与 PARTY_AURA_STRENGTH_FIELDS 一致）——
    /// `/buff_uniques/speed_aura_attack_speed`。
    pub const BUFF_UNIQUE_SPEED_AURA_ATTACK_SPEED: Hrid = Hrid(111);
    /// `/buff_uniques/speed_aura_cast_speed`。
    pub const BUFF_UNIQUE_SPEED_AURA_CAST_SPEED: Hrid = Hrid(112);
    /// `/buff_uniques/guardian_aura_healing_amplify`。
    pub const BUFF_UNIQUE_GUARDIAN_AURA_HEALING_AMPLIFY: Hrid = Hrid(113);
    /// `/buff_uniques/guardian_aura_evasion`。
    pub const BUFF_UNIQUE_GUARDIAN_AURA_EVASION: Hrid = Hrid(114);
    /// `/buff_uniques/guardian_aura_armor`。
    pub const BUFF_UNIQUE_GUARDIAN_AURA_ARMOR: Hrid = Hrid(115);
    /// `/buff_uniques/guardian_aura_water_resistance`。
    pub const BUFF_UNIQUE_GUARDIAN_AURA_WATER_RESISTANCE: Hrid = Hrid(116);
    /// `/buff_uniques/guardian_aura_nature_resistance`。
    pub const BUFF_UNIQUE_GUARDIAN_AURA_NATURE_RESISTANCE: Hrid = Hrid(117);
    /// `/buff_uniques/guardian_aura_fire_resistance`。
    pub const BUFF_UNIQUE_GUARDIAN_AURA_FIRE_RESISTANCE: Hrid = Hrid(118);
    /// `/buff_uniques/fierce_aura`。
    pub const BUFF_UNIQUE_FIERCE_AURA: Hrid = Hrid(119);
    /// `/buff_uniques/critical_aura_rate`。
    pub const BUFF_UNIQUE_CRITICAL_AURA_RATE: Hrid = Hrid(120);
    /// `/buff_uniques/critical_aura_damage`。
    pub const BUFF_UNIQUE_CRITICAL_AURA_DAMAGE: Hrid = Hrid(121);
    /// `/buff_uniques/mystic_aura_water_amplify`。
    pub const BUFF_UNIQUE_MYSTIC_AURA_WATER_AMPLIFY: Hrid = Hrid(122);
    /// `/buff_uniques/mystic_aura_nature_amplify`。
    pub const BUFF_UNIQUE_MYSTIC_AURA_NATURE_AMPLIFY: Hrid = Hrid(123);
    /// `/buff_uniques/mystic_aura_fire_amplify`。
    pub const BUFF_UNIQUE_MYSTIC_AURA_FIRE_AMPLIFY: Hrid = Hrid(124);

    /// 供 `Default` 使用（默认 = 空字符串）。
    pub fn empty() -> Hrid {
        Hrid::EMPTY
    }

    /// 是否为 well-known 常量（序号 < 常量区长度）。
    pub fn is_well_known(&self) -> bool {
        (self.0 as usize) < WELL_KNOWN.len()
    }
}

impl Default for Hrid {
    fn default() -> Self {
        Hrid::EMPTY
    }
}

/// 字符串 → 句柄注册表（按内容去重，先到先得）。
pub struct Interner {
    by_name: HashMap<Box<str>, u32>,
    names: Vec<Box<str>>,
}

impl Interner {
    /// 空注册表（不含 well-known 常量；测试与显式构造用）。
    pub fn new() -> Self {
        Self { by_name: HashMap::new(), names: Vec::new() }
    }

    /// 预注册 well-known 常量后的注册表（线程局部实例的初始化路径）。
    pub fn with_well_known() -> Self {
        let mut interner = Self::new();
        for (index, name) in WELL_KNOWN.iter().enumerate() {
            let hrid = interner.intern(name);
            debug_assert_eq!(hrid.0 as usize, index, "well-known 常量表顺序被破坏：{name}");
        }
        interner
    }

    pub fn intern(&mut self, name: &str) -> Hrid {
        if let Some(&id) = self.by_name.get(name) {
            return Hrid(id);
        }
        let id = self.names.len() as u32;
        self.names.push(name.into());
        self.by_name.insert(name.into(), id);
        Hrid(id)
    }

    pub fn resolve(&self, hrid: Hrid) -> &str {
        &self.names[hrid.0 as usize]
    }

    /// 已注册的字符串数量（测试/诊断用）。
    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
}

impl Default for Interner {
    fn default() -> Self {
        Self::new()
    }
}

thread_local! {
    /// 线程局部注册表（首次访问时预注册 well-known 常量）。
    static INTERNER: RefCell<Interner> = RefCell::new(Interner::with_well_known());
}

/// 注册字符串并取回句柄。
pub fn intern_hrid(name: &str) -> Hrid {
    INTERNER.with(|cell| cell.borrow_mut().intern(name))
}

/// 以闭包形式访问句柄对应的字符串（零分配；闭包内不得再触发 `intern`）。
pub fn with_hrid<R>(hrid: Hrid, f: impl FnOnce(&str) -> R) -> R {
    INTERNER.with(|cell| f(cell.borrow().resolve(hrid)))
}

/// 批量解析场景：在单次借用内访问注册表（避免逐键借用；闭包内不得触发 `intern`）。
pub fn with_interner<R>(f: impl FnOnce(&Interner) -> R) -> R {
    INTERNER.with(|cell| f(&cell.borrow()))
}

/// 句柄 → 字符串（分配；输出路径用）。
pub fn hrid_to_string(hrid: Hrid) -> String {
    with_hrid(hrid, |name| name.to_string())
}

/// 句柄与字符串字面量的相等比较（低频场景用；热路径请直接比较句柄）。
pub fn hrid_is(hrid: Hrid, name: &str) -> bool {
    with_hrid(hrid, |candidate| candidate == name)
}

/// 句柄是否为空字符串。
pub fn hrid_is_empty(hrid: Hrid) -> bool {
    hrid == Hrid::EMPTY
}

impl fmt::Debug for Hrid {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "hrid({:?})", with_hrid(*self, |name| name.to_string()))
    }
}

impl fmt::Display for Hrid {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        with_hrid(*self, |name| formatter.write_str(name))
    }
}

impl Serialize for Hrid {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        with_hrid(*self, |name| serializer.serialize_str(name))
    }
}

impl<'de> Deserialize<'de> for Hrid {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct HridVisitor;
        impl<'de> Visitor<'de> for HridVisitor {
            type Value = Hrid;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an hrid string")
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Hrid, E> {
                Ok(intern_hrid(value))
            }
        }
        deserializer.deserialize_str(HridVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intern_is_content_addressed_and_idempotent() {
        let first = intern_hrid("/abilities/fireball");
        let second = intern_hrid("/abilities/fireball");
        let other = intern_hrid("/abilities/fireball_2");
        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_eq!(hrid_to_string(first), "/abilities/fireball");
    }

    #[test]
    fn well_known_constants_resolve_to_table_entries() {
        let cases: &[(Hrid, &str)] = &[
            (Hrid::EMPTY, ""),
            (Hrid::UNDEFINED, "undefined"),
            (Hrid::DEFAULT, "default"),
            (Hrid::COMBAT_STYLE_STAB, "/combat_styles/stab"),
            (Hrid::COMBAT_STYLE_SLASH, "/combat_styles/slash"),
            (Hrid::COMBAT_STYLE_SMASH, "/combat_styles/smash"),
            (Hrid::COMBAT_STYLE_RANGED, "/combat_styles/ranged"),
            (Hrid::COMBAT_STYLE_MAGIC, "/combat_styles/magic"),
            (Hrid::DAMAGE_TYPE_PHYSICAL, "/damage_types/physical"),
            (Hrid::DAMAGE_TYPE_WATER, "/damage_types/water"),
            (Hrid::DAMAGE_TYPE_NATURE, "/damage_types/nature"),
            (Hrid::DAMAGE_TYPE_FIRE, "/damage_types/fire"),
            (Hrid::EFFECT_BUFF, "/ability_effect_types/buff"),
            (Hrid::EFFECT_DAMAGE, "/ability_effect_types/damage"),
            (Hrid::EFFECT_HEAL, "/ability_effect_types/heal"),
            (Hrid::EFFECT_SPEND_HP, "/ability_effect_types/spend_hp"),
            (Hrid::EFFECT_REVIVE, "/ability_effect_types/revive"),
            (Hrid::EFFECT_PROMOTE, "/ability_effect_types/promote"),
            (Hrid::TARGET_SELF, "self"),
            (Hrid::TARGET_ALL_ALLIES, "allAllies"),
            (Hrid::TARGET_ENEMY, "enemy"),
            (Hrid::TARGET_ALL_ENEMIES, "allEnemies"),
            (Hrid::TARGET_LOWEST_HP_ALLY, "lowestHpAlly"),
        ];
        for (hrid, expected) in cases {
            assert_eq!(&hrid_to_string(*hrid), expected, "well-known 常量错位");
            // intern 查表必须命中同一常量（路径无关）。
            assert_eq!(intern_hrid(expected), *hrid);
        }
    }

    #[test]
    fn buff_type_constants_are_contiguous_after_target_types() {
        // 逐项锁定 23..62 段（常量定义顺序必须与表一致）。
        let cases: &[(Hrid, &str)] = &[
            (Hrid::BUFF_TYPE_STAMINA_LEVEL, "/buff_types/stamina_level"),
            (Hrid::BUFF_TYPE_INTELLIGENCE_LEVEL, "/buff_types/intelligence_level"),
            (Hrid::BUFF_TYPE_ATTACK_LEVEL, "/buff_types/attack_level"),
            (Hrid::BUFF_TYPE_MELEE_LEVEL, "/buff_types/melee_level"),
            (Hrid::BUFF_TYPE_DEFENSE_LEVEL, "/buff_types/defense_level"),
            (Hrid::BUFF_TYPE_RANGED_LEVEL, "/buff_types/ranged_level"),
            (Hrid::BUFF_TYPE_MAGIC_LEVEL, "/buff_types/magic_level"),
            (Hrid::BUFF_TYPE_EVASION, "/buff_types/evasion"),
            (Hrid::BUFF_TYPE_ARMOR, "/buff_types/armor"),
            (Hrid::BUFF_TYPE_WATER_RESISTANCE, "/buff_types/water_resistance"),
            (Hrid::BUFF_TYPE_NATURE_RESISTANCE, "/buff_types/nature_resistance"),
            (Hrid::BUFF_TYPE_FIRE_RESISTANCE, "/buff_types/fire_resistance"),
            (Hrid::BUFF_TYPE_MAX_HITPOINTS, "/buff_types/max_hitpoints"),
            (Hrid::BUFF_TYPE_MAX_MANAPOINTS, "/buff_types/max_manapoints"),
            (Hrid::BUFF_TYPE_FURY_ACCURACY, "/buff_types/fury_accuracy"),
            (Hrid::BUFF_TYPE_FURY_DAMAGE, "/buff_types/fury_damage"),
            (Hrid::BUFF_TYPE_ACCURACY, "/buff_types/accuracy"),
            (Hrid::BUFF_TYPE_DAMAGE, "/buff_types/damage"),
            (Hrid::BUFF_TYPE_DAMAGE_TAKEN, "/buff_types/damage_taken"),
            (Hrid::BUFF_TYPE_PHYSICAL_AMPLIFY, "/buff_types/physical_amplify"),
            (Hrid::BUFF_TYPE_WATER_AMPLIFY, "/buff_types/water_amplify"),
            (Hrid::BUFF_TYPE_NATURE_AMPLIFY, "/buff_types/nature_amplify"),
            (Hrid::BUFF_TYPE_FIRE_AMPLIFY, "/buff_types/fire_amplify"),
            (Hrid::BUFF_TYPE_HEALING_AMPLIFY, "/buff_types/healing_amplify"),
            (Hrid::BUFF_TYPE_ATTACK_SPEED, "/buff_types/attack_speed"),
            (Hrid::BUFF_TYPE_HP_REGEN, "/buff_types/hp_regen"),
            (Hrid::BUFF_TYPE_MP_REGEN, "/buff_types/mp_regen"),
            (Hrid::BUFF_TYPE_LIFE_STEAL, "/buff_types/life_steal"),
            (Hrid::BUFF_TYPE_PHYSICAL_THORNS, "/buff_types/physical_thorns"),
            (Hrid::BUFF_TYPE_ELEMENTAL_THORNS, "/buff_types/elemental_thorns"),
            (Hrid::BUFF_TYPE_WISDOM, "/buff_types/wisdom"),
            (Hrid::BUFF_TYPE_CRITICAL_RATE, "/buff_types/critical_rate"),
            (Hrid::BUFF_TYPE_CRITICAL_DAMAGE, "/buff_types/critical_damage"),
            (Hrid::BUFF_TYPE_CAST_SPEED, "/buff_types/cast_speed"),
            (Hrid::BUFF_TYPE_COMBAT_DROP_RATE, "/buff_types/combat_drop_rate"),
            (Hrid::BUFF_TYPE_RARE_FIND, "/buff_types/rare_find"),
            (Hrid::BUFF_TYPE_COMBAT_DROP_QUANTITY, "/buff_types/combat_drop_quantity"),
            (Hrid::BUFF_TYPE_THREAT, "/buff_types/threat"),
            (Hrid::BUFF_TYPE_RETALIATION, "/buff_types/retaliation"),
            (Hrid::BUFF_TYPE_TENACITY, "/buff_types/tenacity"),
        ];
        for (hrid, expected) in cases {
            assert_eq!(&hrid_to_string(*hrid), expected, "增益类型常量错位");
            assert_eq!(intern_hrid(expected), *hrid);
        }
        // 常量区总长度（0..=124，共 125 项：63 基础 + 19 事件 + 18 触发器 + 6 负状态 + 19 队伍光环）。
        assert_eq!(WELL_KNOWN.len(), 125);
    }

    #[test]
    fn trigger_status_and_party_aura_constants_resolve() {
        let cases: &[(Hrid, &str)] = &[
            (Hrid::TRIGGER_DEP_SELF, "/combat_trigger_dependencies/self"),
            (Hrid::TRIGGER_DEP_TARGETED_ENEMY, "/combat_trigger_dependencies/targeted_enemy"),
            (Hrid::TRIGGER_DEP_ALL_ALLIES, "/combat_trigger_dependencies/all_allies"),
            (Hrid::TRIGGER_DEP_ALL_ENEMIES, "/combat_trigger_dependencies/all_enemies"),
            (Hrid::TRIGGER_CMP_GREATER_THAN_EQUAL, "/combat_trigger_comparators/greater_than_equal"),
            (Hrid::TRIGGER_CMP_LESS_THAN_EQUAL, "/combat_trigger_comparators/less_than_equal"),
            (Hrid::TRIGGER_CMP_IS_ACTIVE, "/combat_trigger_comparators/is_active"),
            (Hrid::TRIGGER_CMP_IS_INACTIVE, "/combat_trigger_comparators/is_inactive"),
            (Hrid::TRIGGER_COND_CURRENT_HP, "/combat_trigger_conditions/current_hp"),
            (Hrid::TRIGGER_COND_CURRENT_MP, "/combat_trigger_conditions/current_mp"),
            (Hrid::TRIGGER_COND_MISSING_HP, "/combat_trigger_conditions/missing_hp"),
            (Hrid::TRIGGER_COND_MISSING_MP, "/combat_trigger_conditions/missing_mp"),
            (Hrid::TRIGGER_COND_STUN_STATUS, "/combat_trigger_conditions/stun_status"),
            (Hrid::TRIGGER_COND_BLIND_STATUS, "/combat_trigger_conditions/blind_status"),
            (Hrid::TRIGGER_COND_SILENCE_STATUS, "/combat_trigger_conditions/silence_status"),
            (
                Hrid::TRIGGER_COND_NUMBER_OF_ACTIVE_UNITS,
                "/combat_trigger_conditions/number_of_active_units",
            ),
            (Hrid::TRIGGER_COND_NUMBER_OF_DEAD_UNITS, "/combat_trigger_conditions/number_of_dead_units"),
            (Hrid::TRIGGER_COND_LOWEST_HP_PERCENTAGE, "/combat_trigger_conditions/lowest_hp_percentage"),
            (Hrid::BUFF_UNIQUE_CURSE, "/buff_uniques/curse"),
            (Hrid::BUFF_UNIQUE_WEAKEN, "/buff_uniques/weaken"),
            (Hrid::BUFF_UNIQUE_FURY_ACCURACY, "/buff_uniques/fury_accuracy"),
            (Hrid::BUFF_UNIQUE_FURY_DAMAGE, "/buff_uniques/fury_damage"),
            (Hrid::BUFF_UNIQUE_ENRAGE_DAMAGE, "/buff_uniques/enrage_damage"),
            (Hrid::BUFF_UNIQUE_ENRAGE_ACCURACY, "/buff_uniques/enrage_accuracy"),
            (Hrid::ABILITY_SPEED_AURA, "/abilities/speed_aura"),
            (Hrid::ABILITY_GUARDIAN_AURA, "/abilities/guardian_aura"),
            (Hrid::ABILITY_FIERCE_AURA, "/abilities/fierce_aura"),
            (Hrid::ABILITY_CRITICAL_AURA, "/abilities/critical_aura"),
            (Hrid::ABILITY_MYSTIC_AURA, "/abilities/mystic_aura"),
            (Hrid::BUFF_UNIQUE_SPEED_AURA_ATTACK_SPEED, "/buff_uniques/speed_aura_attack_speed"),
            (Hrid::BUFF_UNIQUE_SPEED_AURA_CAST_SPEED, "/buff_uniques/speed_aura_cast_speed"),
            (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_HEALING_AMPLIFY, "/buff_uniques/guardian_aura_healing_amplify"),
            (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_EVASION, "/buff_uniques/guardian_aura_evasion"),
            (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_ARMOR, "/buff_uniques/guardian_aura_armor"),
            (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_WATER_RESISTANCE, "/buff_uniques/guardian_aura_water_resistance"),
            (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_NATURE_RESISTANCE, "/buff_uniques/guardian_aura_nature_resistance"),
            (Hrid::BUFF_UNIQUE_GUARDIAN_AURA_FIRE_RESISTANCE, "/buff_uniques/guardian_aura_fire_resistance"),
            (Hrid::BUFF_UNIQUE_FIERCE_AURA, "/buff_uniques/fierce_aura"),
            (Hrid::BUFF_UNIQUE_CRITICAL_AURA_RATE, "/buff_uniques/critical_aura_rate"),
            (Hrid::BUFF_UNIQUE_CRITICAL_AURA_DAMAGE, "/buff_uniques/critical_aura_damage"),
            (Hrid::BUFF_UNIQUE_MYSTIC_AURA_WATER_AMPLIFY, "/buff_uniques/mystic_aura_water_amplify"),
            (Hrid::BUFF_UNIQUE_MYSTIC_AURA_NATURE_AMPLIFY, "/buff_uniques/mystic_aura_nature_amplify"),
            (Hrid::BUFF_UNIQUE_MYSTIC_AURA_FIRE_AMPLIFY, "/buff_uniques/mystic_aura_fire_amplify"),
        ];
        for (hrid, expected) in cases {
            assert_eq!(&hrid_to_string(*hrid), expected, "触发器/光环常量错位");
            assert_eq!(intern_hrid(expected), *hrid);
        }
    }

    #[test]
    fn event_type_constants_resolve_to_js_type_strings() {
        let cases: &[(Hrid, &str)] = &[
            (Hrid::EVENT_COMBAT_START, "combatStart"),
            (Hrid::EVENT_PLAYER_RESPAWN, "playerRespawn"),
            (Hrid::EVENT_ENEMY_RESPAWN, "enemyRespawn"),
            (Hrid::EVENT_AUTO_ATTACK, "autoAttack"),
            (Hrid::EVENT_ABILITY_CAST_END, "abilityCastEndEvent"),
            (Hrid::EVENT_CONSUMABLE_TICK, "consumableTick"),
            (Hrid::EVENT_DAMAGE_OVER_TIME, "damageOverTime"),
            (Hrid::EVENT_CHECK_BUFF_EXPIRATION, "checkBuffExpiration"),
            (Hrid::EVENT_SCROLL_RENEWAL, "scrollRenewal"),
            (Hrid::EVENT_REGEN_TICK, "regenTick"),
            (Hrid::EVENT_STUN_EXPIRATION, "stunExpiration"),
            (Hrid::EVENT_BLIND_EXPIRATION, "blindExpiration"),
            (Hrid::EVENT_SILENCE_EXPIRATION, "silenceExpiration"),
            (Hrid::EVENT_CURSE_EXPIRATION, "curseExpiration"),
            (Hrid::EVENT_WEAKEN_EXPIRATION, "weakenExpiration"),
            (Hrid::EVENT_FURY_EXPIRATION, "furyExpiration"),
            (Hrid::EVENT_ENRAGE_TICK, "enrageTick"),
            (Hrid::EVENT_AWAIT_COOLDOWN, "awaitCooldownEvent"),
            (Hrid::EVENT_COOLDOWN_READY, "cooldownReady"),
        ];
        for (hrid, expected) in cases {
            assert_eq!(&hrid_to_string(*hrid), expected, "事件类型常量错位");
            assert_eq!(intern_hrid(expected), *hrid);
        }
    }

    #[test]
    fn serde_roundtrip_preserves_string_shape() {
        let value: Hrid = serde_json::from_str("\"/abilities/fireball\"").expect("deserializes");
        assert_eq!(hrid_to_string(value), "/abilities/fireball");
        let json = serde_json::to_string(&value).expect("serializes");
        assert_eq!(json, "\"/abilities/fireball\"");
        // well-known 同样往返。
        let style: Hrid = serde_json::from_str("\"/combat_styles/magic\"").expect("deserializes");
        assert_eq!(style, Hrid::COMBAT_STYLE_MAGIC);
    }

    #[test]
    fn default_is_empty_string() {
        assert_eq!(Hrid::default(), Hrid::EMPTY);
        assert!(hrid_is_empty(Hrid::default()));
        assert!(!hrid_is_empty(Hrid::UNDEFINED));
    }
}
