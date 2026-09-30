//! 攻击 / 治疗 / 反伤数学：`src/combatsimulator/combatUtilities.js` 的逐行移植。
//!
//! 逐位 parity 要点：
//! - 所有表达式保持 JS 的运算顺序（含 `Math.pow(x, 1.4)`、`Math.ceil`、`Math.min`）；
//! - 随机数**只能**通过传入的 `rng`（mulberry32，逐位对齐 JS `Math.random()`）消费，
//!   且调用顺序必须与 JS 完全一致（`randomInt` 内部 1~3 次抽样的分支也一样）；
//! - `randomInt` 的整段逻辑（含 `extraTailChance` 分支与 `Math.floor` 语义）必须逐行复刻；
//! - `process_attack` 会就地修改 `source`/`target` 的 `currentHitpoints`，并调用
//!   `source.add_hitpoints` / `source.add_manapoints`（吸血 / 吸蓝 / 掉血）。
//!
//! 刻意保留的 JS 既有怪癖（不得「改进」）：
//! - `randomInt` 在 `max < min` 时交换**局部参数**，交换后的中间量（minCeil / maxTail 等）
//!   全部按新 (min, max) 重算；
//! - `randomInt` 的首个分支 `Math.floor(min) == maxFloor` 把两参之间的小数整体吞掉
//!   （例如 `(2.5, 2.6)` 只返回 2 或 3，而不是按权重抽样）；
//! - 暴击判定恒消费一次抽样，且命中判定发生在伤害掷骰**之后**：未命中的攻击同样掷伤害；
//! - 反伤只要 `targetThornPower > 0 && targetResistance > -99` 就判定（与是否命中无关），
//!   报复只要 `retaliation > 0` 就先消费一次命中判定，命中后再掷报复伤害；
//! - `isWeakened` / `weakenPercentage` 在 JS 中从未被赋值（恒 undefined ⇒ 恒假），
//!   命中惩罚分支保留形状，生产路径不触发；
//! - `processHeal` / `processRevive` 的非魔法风格报错复用同一句文案
//!   （revive 也报 'Heal ability effect not supported for combat style: ...'）；
//! - `processSpendHp` 的 `spendHpRatio` 缺失（undefined）时整条算式得 NaN 并写回面板。
//!
//! 注：JS `Math.min` 对 NaN 会传播 NaN，而 Rust `f64::min` 会忽略 NaN 返回另一操作数；
//! 运行路径上的两个入参都是由有限数算出的伤害 / 血量，因此按约定直接映射为 `.min()`。

use crate::ability::AbilityEffect;
use crate::hrid::Hrid;
use crate::rng::Mulberry32;
use crate::unit::{CombatUnit, UnitError};

/// 等价 JS `processAttack` 的返回对象。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AttackResult {
    pub damage_done: f64,
    pub did_hit: bool,
    pub thorn_damage_done: f64,
    /// JS `thornType`（物理 = 'physicalThorns'，元素 = 'elementalThorns'）。
    pub thorn_type: String,
    pub retaliation_damage_done: f64,
    pub life_steal_heal: f64,
    pub hp_drain: f64,
    pub mana_leech_mana: f64,
    pub is_crit: bool,
}

/// 等价 JS `CombatUtilities.randomInt(min, max)`。
pub fn random_int(min: f64, max: f64, rng: &mut Mulberry32) -> f64 {
    // JS：`let` 参数可直接重写；`max < min` 时交换局部副本（NaN 参与时不交换）。
    let mut min = min;
    let mut max = max;
    if max < min {
        let temp = min;
        min = max;
        max = temp;
    }

    let min_ceil = min.ceil();
    let max_floor = max.floor();

    if min.floor() == max_floor {
        return ((min + max) / 2.0 + rng.next_f64()).floor();
    }

    let min_tail = -1.0 * (min - min_ceil);
    let max_tail = max - max_floor;

    let balanced_weight = 2.0 * min_tail + (max_floor - min_ceil);
    let balanced_average = (max_floor + min_ceil) / 2.0;
    let average = (max + min) / 2.0;
    let extra_tail_weight = (balanced_weight * (average - balanced_average)) / (max_floor + 1.0 - average);
    let extra_tail_chance = (extra_tail_weight / (extra_tail_weight + balanced_weight)).abs();

    if rng.next_f64() < extra_tail_chance {
        if max_tail > min_tail {
            return (max_floor + 1.0).floor();
        } else {
            return (min_ceil - 1.0).floor();
        }
    }

    if max_tail > min_tail {
        return (min + rng.next_f64() * (max_floor + min_tail - min + 1.0)).floor();
    } else {
        return (min_ceil - max_tail + rng.next_f64() * (max - (min_ceil - max_tail) + 1.0)).floor();
    }
}

/// 等价 JS `CombatUtilities.processAttack(source, target, abilityEffect = null)`。
///
/// JS 对未知战斗风格 / 伤害类型抛 `new Error(...)`；Rust 侧没有 Result 返回通道，
/// 因此以 `panic_any(UnitError::error(...))` 抛出同类别、同消息的结构化错误
/// （供探针 `catch_unwind` 后按 `{ name, message }` 逐字对账）。
pub fn process_attack(
    source: &mut CombatUnit,
    target: &mut CombatUnit,
    ability_effect: Option<&AbilityEffect>,
    rng: &mut Mulberry32,
) -> AttackResult {
    let _prof = crate::prof::start("attack.process");
    // JS：abilityEffect 存在时用效果自带的战斗风格 / 伤害类型；两个字段缺失时均为 undefined。
    let combat_style: Hrid = match ability_effect {
        Some(effect) => effect.combat_style().unwrap_or(Hrid::UNDEFINED),
        None => source.combat_details.combat_stats.combat_style_hrid,
    };
    // 同上：伤害类型同样取自技能效果字段。
    let damage_type: Hrid = match ability_effect {
        Some(effect) => effect.damage_type().unwrap_or(Hrid::UNDEFINED),
        None => source.combat_details.combat_stats.damage_type,
    };

    // 移植说明（逐行移植）：JS 的 `let x = 1` 初始值仅存在于抛错路径，合法战斗风格都会覆盖它；
    // 这里改为无初值声明表达同一语义，可见行为逐位一致，同时避免死赋值警告。
    let mut source_accuracy_rating: f64;
    let source_auto_attack_max_damage: f64;
    let target_evasion_rating: f64;

    match combat_style {
        Hrid::COMBAT_STYLE_STAB => {
            source_accuracy_rating = source.combat_details.stab_accuracy_rating;
            source_auto_attack_max_damage = source.combat_details.stab_max_damage;
            target_evasion_rating = target.combat_details.stab_evasion_rating;
        }
        Hrid::COMBAT_STYLE_SLASH => {
            source_accuracy_rating = source.combat_details.slash_accuracy_rating;
            source_auto_attack_max_damage = source.combat_details.slash_max_damage;
            target_evasion_rating = target.combat_details.slash_evasion_rating;
        }
        Hrid::COMBAT_STYLE_SMASH => {
            source_accuracy_rating = source.combat_details.smash_accuracy_rating;
            source_auto_attack_max_damage = source.combat_details.smash_max_damage;
            target_evasion_rating = target.combat_details.smash_evasion_rating;
        }
        Hrid::COMBAT_STYLE_RANGED => {
            source_accuracy_rating = source.combat_details.ranged_accuracy_rating;
            source_auto_attack_max_damage = source.combat_details.ranged_max_damage;
            target_evasion_rating = target.combat_details.ranged_evasion_rating;
        }
        Hrid::COMBAT_STYLE_MAGIC => {
            source_accuracy_rating = source.combat_details.magic_accuracy_rating;
            source_auto_attack_max_damage = source.combat_details.magic_max_damage;
            target_evasion_rating = target.combat_details.magic_evasion_rating;
        }
        // 未知战斗风格（含技能效果缺字段 ⇒ undefined）：与 JS 一致地抛 Error 并带上原始值消息。
        other => std::panic::panic_any(UnitError::error(format!("Unknown combat style: {other}"))),
    }

    // 同理（逐行移植）：JS 的 1 / 0 初值仅存在于抛错路径，match 的全部合法臂都会赋值；
    // `thornType` 在 JS 里本就是 `let thornType;`（五个合法伤害类型分支都会赋值）。
    let source_damage_multiplier: f64;
    let source_resistance: f64;
    let source_penetration: f64;
    let target_resistance: f64;
    let target_thorn_power: f64;
    let target_penetration: f64;
    let thorn_type: &'static str;

    match damage_type {
        Hrid::DAMAGE_TYPE_PHYSICAL => {
            source_damage_multiplier = 1.0 + source.combat_details.combat_stats.physical_amplify;
            source_resistance = source.combat_details.total_armor;
            source_penetration = source.combat_details.combat_stats.armor_penetration;
            target_resistance = target.combat_details.total_armor;
            target_thorn_power = target.combat_details.combat_stats.physical_thorns;
            target_penetration = target.combat_details.combat_stats.armor_penetration;
            thorn_type = "physicalThorns";
        }
        Hrid::DAMAGE_TYPE_WATER => {
            source_damage_multiplier = 1.0 + source.combat_details.combat_stats.water_amplify;
            source_resistance = source.combat_details.total_water_resistance;
            source_penetration = source.combat_details.combat_stats.water_penetration;
            target_resistance = target.combat_details.total_water_resistance;
            target_thorn_power = target.combat_details.combat_stats.elemental_thorns;
            target_penetration = target.combat_details.combat_stats.water_penetration;
            thorn_type = "elementalThorns";
        }
        Hrid::DAMAGE_TYPE_NATURE => {
            source_damage_multiplier = 1.0 + source.combat_details.combat_stats.nature_amplify;
            source_resistance = source.combat_details.total_nature_resistance;
            source_penetration = source.combat_details.combat_stats.nature_penetration;
            target_resistance = target.combat_details.total_nature_resistance;
            target_thorn_power = target.combat_details.combat_stats.elemental_thorns;
            target_penetration = target.combat_details.combat_stats.nature_penetration;
            thorn_type = "elementalThorns";
        }
        Hrid::DAMAGE_TYPE_FIRE => {
            source_damage_multiplier = 1.0 + source.combat_details.combat_stats.fire_amplify;
            source_resistance = source.combat_details.total_fire_resistance;
            source_penetration = source.combat_details.combat_stats.fire_penetration;
            target_resistance = target.combat_details.total_fire_resistance;
            target_thorn_power = target.combat_details.combat_stats.elemental_thorns;
            target_penetration = target.combat_details.combat_stats.fire_penetration;
            thorn_type = "elementalThorns";
        }
        other => std::panic::panic_any(UnitError::error(format!("Unknown damage type: {other}"))),
    }

    let mut crit_chance = 0.0;
    let mut is_crit = false;
    let bonus_crit_chance = source.combat_details.combat_stats.critical_rate;
    let bonus_crit_damage = source.combat_details.combat_stats.critical_damage;

    if let Some(effect) = ability_effect {
        source_accuracy_rating *= 1.0 + effect.bonus_accuracy_ratio;
    }

    if source.is_weakened {
        source_accuracy_rating = source_accuracy_rating - source.weaken_percentage * source_accuracy_rating;
    }

    // JS 先赋 1 再无条件覆盖；此处直接计算最终值。
    let hit_chance = source_accuracy_rating.powf(1.4)
        / (source_accuracy_rating.powf(1.4) + target_evasion_rating.powf(1.4));

    if combat_style == Hrid::COMBAT_STYLE_RANGED {
        crit_chance = 0.3 * hit_chance;
    }

    crit_chance = crit_chance + bonus_crit_chance;

    let base_damage_flat = ability_effect.map_or(0.0, |effect| effect.damage_flat);
    let base_damage_ratio = ability_effect.map_or(1.0, |effect| effect.damage_ratio);

    let armor_damage_ratio_flat =
        ability_effect.map_or(0.0, |effect| effect.armor_damage_ratio * source.combat_details.total_armor);

    let mut source_min_damage = source_damage_multiplier * (1.0 + base_damage_flat + armor_damage_ratio_flat);
    let mut source_max_damage = source_damage_multiplier
        * (base_damage_ratio * source_auto_attack_max_damage + base_damage_flat + armor_damage_ratio_flat);

    if rng.next_f64() < crit_chance {
        source_max_damage = source_max_damage * (1.0 + bonus_crit_damage);
        source_min_damage = source_max_damage;
        is_crit = true;
    }

    let mut damage_roll = random_int(source_min_damage, source_max_damage, rng);
    damage_roll *= 1.0 + source.combat_details.combat_stats.task_damage;
    damage_roll *= 1.0 + target.combat_details.combat_stats.damage_taken;
    if ability_effect.is_none() {
        damage_roll += damage_roll * source.combat_details.combat_stats.auto_attack_damage;
    } else {
        damage_roll *= 1.0 + source.combat_details.combat_stats.ability_damage;
    }

    let mut damage_done = 0.0;
    let mut thorn_damage_done = 0.0;

    let mut did_hit = false;
    if rng.next_f64() < hit_chance {
        did_hit = true;
        let mut penetrated_target_resistance = target_resistance;

        if source_penetration > 0.0 && target_resistance > 0.0 {
            penetrated_target_resistance = target_resistance / (1.0 + source_penetration);
        }

        let mut target_damage_taken_ratio = 100.0 / (100.0 + penetrated_target_resistance);
        if penetrated_target_resistance < 0.0 {
            target_damage_taken_ratio = (100.0 - penetrated_target_resistance) / 100.0;
        }

        let mitigated_damage = (target_damage_taken_ratio * damage_roll).ceil();
        damage_done = mitigated_damage.min(target.combat_details.current_hitpoints);
        target.combat_details.current_hitpoints -= damage_done;
    }

    if target_thorn_power > 0.0 && target_resistance > -99.0 {
        let mut penetrated_source_resistance = source_resistance;

        if source_resistance > 0.0 {
            penetrated_source_resistance = source_resistance / (1.0 + target_penetration);
        }

        let mut source_damage_taken_ratio = 100.0 / (100.0 + penetrated_source_resistance);
        if penetrated_source_resistance < 0.0 {
            source_damage_taken_ratio = (100.0 - penetrated_source_resistance) / 100.0;
        }

        let target_task_damage_multiplier = 1.0 + target.combat_details.combat_stats.task_damage;
        let source_damage_taken_multiplier = 1.0 + source.combat_details.combat_stats.damage_taken;
        let target_damage_multiplier = target_task_damage_multiplier * source_damage_taken_multiplier;

        let thorns_damage_roll = random_int(
            1.0,
            target_damage_multiplier
                * target.combat_details.defensive_max_damage
                * (1.0 + target_resistance / 100.0)
                * target_thorn_power,
            rng,
        );

        let mitigated_thorns_damage = (source_damage_taken_ratio * thorns_damage_roll).ceil();

        thorn_damage_done = mitigated_thorns_damage.min(source.combat_details.current_hitpoints);
        source.combat_details.current_hitpoints -= thorn_damage_done;
    }

    let mut retaliation_damage_done = 0.0;
    if target.combat_details.combat_stats.retaliation > 0.0 {
        let retaliation_hit_chance = target.combat_details.smash_accuracy_rating.powf(1.4)
            / (target.combat_details.smash_accuracy_rating.powf(1.4)
                + source.combat_details.smash_evasion_rating.powf(1.4));

        if retaliation_hit_chance > rng.next_f64() {
            let mut source_effective_armor = source.combat_details.total_armor;
            if source_effective_armor > 0.0 {
                source_effective_armor =
                    source_effective_armor / (1.0 + target.combat_details.combat_stats.armor_penetration);
            }

            let mut source_damage_taken_ratio = 100.0 / (100.0 + source_effective_armor);
            if source_effective_armor < 0.0 {
                source_damage_taken_ratio = (100.0 - source_effective_armor) / 100.0;
            }

            let target_task_damage_multiplier = 1.0 + target.combat_details.combat_stats.task_damage;
            let source_damage_taken_multiplier = 1.0 + source.combat_details.combat_stats.damage_taken;
            let retaliation_damage_multiplier = target_task_damage_multiplier * source_damage_taken_multiplier;

            let mut premitigated_damage = damage_roll;
            premitigated_damage = premitigated_damage.min(target.combat_details.defensive_max_damage * 5.0);

            let retaliation_min_damage = retaliation_damage_multiplier
                * target.combat_details.combat_stats.retaliation
                * premitigated_damage;
            let retaliation_max_damage = retaliation_damage_multiplier
                * target.combat_details.combat_stats.retaliation
                * (target.combat_details.defensive_max_damage + premitigated_damage);

            let retaliation_damage_roll = random_int(retaliation_min_damage, retaliation_max_damage, rng);
            let mitigated_retaliation_damage = (source_damage_taken_ratio * retaliation_damage_roll).ceil();
            retaliation_damage_done = mitigated_retaliation_damage.min(source.combat_details.current_hitpoints);
            source.combat_details.current_hitpoints -= retaliation_damage_done;
        }
    }

    let mut life_steal_heal = 0.0;
    if ability_effect.is_none() && did_hit && source.combat_details.combat_stats.life_steal > 0.0 {
        let life_steal_amount = (source.combat_details.combat_stats.life_steal * damage_done).floor();
        life_steal_heal = source.add_hitpoints(life_steal_amount);
    }

    let mut hp_drain = 0.0;
    if let Some(effect) = ability_effect {
        if did_hit && effect.hp_drain_ratio.is_some_and(|ratio| ratio > 0.0) {
            let healing_amplify = 1.0 + source.combat_details.combat_stats.healing_amplify;
            let drain_amount = (effect.hp_drain_ratio.unwrap_or(0.0) * damage_done * healing_amplify).floor();
            hp_drain = source.add_hitpoints(drain_amount);
        }
    }

    let mut mana_leech_mana = 0.0;
    if ability_effect.is_none() && did_hit && source.combat_details.combat_stats.mana_leech > 0.0 {
        let mana_leech_amount = (source.combat_details.combat_stats.mana_leech * damage_done).floor();
        mana_leech_mana = source.add_manapoints(mana_leech_amount);
    }

    AttackResult {
        damage_done,
        did_hit,
        thorn_damage_done,
        thorn_type: thorn_type.to_string(),
        retaliation_damage_done,
        life_steal_heal,
        hp_drain,
        mana_leech_mana,
        is_crit,
    }
}

/// 等价 JS `CombatUtilities.processHeal(source, abilityEffect, target)`。
///
/// 非魔法战斗风格（含缺失 ⇒ undefined）抛错，消息与 JS 逐字一致。
pub fn process_heal(
    source: &CombatUnit,
    ability_effect: &AbilityEffect,
    target: &mut CombatUnit,
    rng: &mut Mulberry32,
) -> f64 {
    if ability_effect.combat_style() != Some(Hrid::COMBAT_STYLE_MAGIC) {
        std::panic::panic_any(UnitError::error(format!(
            "Heal ability effect not supported for combat style: {}",
            ability_effect.combat_style().unwrap_or(Hrid::UNDEFINED)
        )));
    }

    let healing_amplify = 1.0 + source.combat_details.combat_stats.healing_amplify;
    let magic_max_damage = source.combat_details.magic_max_damage;
    process_heal_with_stats(healing_amplify, magic_max_damage, ability_effect, target, rng)
}

/// `process_heal` 的主体：施法者贡献的两个标量先取出，以便同单位自疗时规避借用冲突。
pub fn process_heal_with_stats(
    healing_amplify: f64,
    magic_max_damage: f64,
    ability_effect: &AbilityEffect,
    target: &mut CombatUnit,
    rng: &mut Mulberry32,
) -> f64 {
    let base_heal_flat = ability_effect.damage_flat;
    let base_heal_ratio = ability_effect.damage_ratio;

    let min_heal = healing_amplify * (1.0 + base_heal_flat);
    let max_heal = healing_amplify * (base_heal_ratio * magic_max_damage + base_heal_flat);

    let heal = random_int(min_heal, max_heal, rng);
    let amount_healed = target.add_hitpoints(heal);

    amount_healed
}

/// 等价 JS `CombatUtilities.processRevive(source, abilityEffect, target)`。
///
/// JS 里 revive 复用 heal 的风格校验与错误文案（'Heal ability effect ...'）。
pub fn process_revive(
    source: &CombatUnit,
    ability_effect: &AbilityEffect,
    target: &mut CombatUnit,
    rng: &mut Mulberry32,
) -> f64 {
    if ability_effect.combat_style() != Some(Hrid::COMBAT_STYLE_MAGIC) {
        std::panic::panic_any(UnitError::error(format!(
            "Heal ability effect not supported for combat style: {}",
            ability_effect.combat_style().unwrap_or(Hrid::UNDEFINED)
        )));
    }

    let healing_amplify = 1.0 + source.combat_details.combat_stats.healing_amplify;
    let magic_max_damage = source.combat_details.magic_max_damage;
    process_revive_with_stats(healing_amplify, magic_max_damage, ability_effect, target, rng)
}

/// `process_revive` 的主体（标量入口，理由同 `process_heal_with_stats`）。
pub fn process_revive_with_stats(
    healing_amplify: f64,
    magic_max_damage: f64,
    ability_effect: &AbilityEffect,
    target: &mut CombatUnit,
    rng: &mut Mulberry32,
) -> f64 {
    let base_heal_flat = ability_effect.damage_flat;
    let base_heal_ratio = ability_effect.damage_ratio;

    let min_heal = healing_amplify * (1.0 + base_heal_flat);
    let max_heal = healing_amplify * (base_heal_ratio * magic_max_damage + base_heal_flat);

    let heal = random_int(min_heal, max_heal, rng);
    let amount_healed = target.add_hitpoints(heal);
    target.combat_details.current_manapoints = target.combat_details.max_manapoints;
    target.clear_ccs();

    // target.clearBuffs(); —— JS 中该行被注释掉，刻意保持不调用。

    amount_healed
}

/// 等价 JS `CombatUtilities.processSpendHp(source, abilityEffect)`。
pub fn process_spend_hp(source: &mut CombatUnit, ability_effect: &AbilityEffect) -> f64 {
    let current_hp = source.combat_details.current_hitpoints;
    // JS：spendHpRatio 缺失时为 undefined，参与算术即得 NaN（写回面板的怪癖如实保留）。
    let spend_hp_ratio = ability_effect.spend_hp_ratio.unwrap_or(f64::NAN);

    let spent_hp = (current_hp * spend_hp_ratio).floor();

    source.combat_details.current_hitpoints -= spent_hp;

    spent_hp
}

/// 等价 JS `CombatUtilities.calculateTickValue(totalValue, totalTicks, currentTick)`。
pub fn calculate_tick_value(total_value: f64, total_ticks: f64, current_tick: f64) -> f64 {
    let current_sum = ((current_tick * total_value) / total_ticks).floor();
    let previous_sum = (((current_tick - 1.0) * total_value) / total_ticks).floor();

    current_sum - previous_sum
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hrid::intern_hrid;
    use crate::unit::UnitErrorKind;

    // 以下期望值（含每次调用后的「下一次抽样」）由真实 JS 实现生成：
    // node 加载 src/combatsimulator/combatUtilities.js 与 src/services/seededRandom.js，
    // 用 createSeededRandom(seed) 覆盖 Math.random 后逐场景执行；
    // 「下一次抽样」断言同时锁定了随机数消费的时机、次数与顺序。

    fn base_ability_effect() -> AbilityEffect {
        AbilityEffect {
            target_type: intern_hrid("/target_types/enemy"),
            effect_type: intern_hrid("/ability_effect_types/damage"),
            combat_style_hrid: None,
            damage_type: None,
            damage_flat: 0.0,
            damage_ratio: 1.0,
            bonus_accuracy_ratio: 0.0,
            armor_damage_ratio: 0.0,
            damage_over_time_ratio: None,
            damage_over_time_duration: None,
            hp_drain_ratio: None,
            pierce_chance: None,
            blind_chance: None,
            blind_duration: None,
            silence_chance: None,
            silence_duration: None,
            stun_chance: None,
            stun_duration: None,
            spend_hp_ratio: None,
            buffs: Vec::new(),
        }
    }

    /// 基准攻击者：闪击风格、物理伤害；与 JS ground truth 的 BASIC_SOURCE 一致。
    fn smash_attacker() -> CombatUnit {
        let mut unit = CombatUnit::default();
        unit.combat_details.smash_accuracy_rating = 50.0;
        unit.combat_details.smash_max_damage = 30.0;
        unit.combat_details.total_armor = 5.0;
        unit.combat_details.current_hitpoints = 500.0;
        unit.combat_details.max_hitpoints = 500.0;
        unit
    }

    /// 基准目标：与 JS ground truth 的 BASIC_TARGET 一致。
    fn armor_target() -> CombatUnit {
        let mut unit = CombatUnit::default();
        unit.combat_details.smash_evasion_rating = 20.0;
        unit.combat_details.total_armor = 10.0;
        unit.combat_details.current_hitpoints = 400.0;
        unit.combat_details.max_hitpoints = 400.0;
        unit
    }

    #[allow(clippy::too_many_arguments)]
    fn assert_attack_result(
        result: &AttackResult,
        damage_done: f64,
        did_hit: bool,
        thorn_damage_done: f64,
        thorn_type: &str,
        retaliation_damage_done: f64,
        life_steal_heal: f64,
        hp_drain: f64,
        mana_leech_mana: f64,
        is_crit: bool,
    ) {
        assert_eq!(result.damage_done, damage_done, "damageDone");
        assert_eq!(result.did_hit, did_hit, "didHit");
        assert_eq!(result.thorn_damage_done, thorn_damage_done, "thornDamageDone");
        assert_eq!(result.thorn_type, thorn_type, "thornType");
        assert_eq!(result.retaliation_damage_done, retaliation_damage_done, "retaliationDamageDone");
        assert_eq!(result.life_steal_heal, life_steal_heal, "lifeStealHeal");
        assert_eq!(result.hp_drain, hp_drain, "hpDrain");
        assert_eq!(result.mana_leech_mana, mana_leech_mana, "manaLeechMana");
        assert_eq!(result.is_crit, is_crit, "isCrit");
    }

    /// 捕获抛错路径的 `UnitError` 载荷（与探针 `{ name, message }` 对账方式一致）。
    fn capture_unit_error(callback: impl FnOnce()) -> UnitError {
        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(callback))
            .expect_err("JS 会抛错，Rust 侧应当 panic");
        match panic.downcast_ref::<UnitError>() {
            Some(error) => error.clone(),
            None => panic!("panic payload 不是 UnitError"),
        }
    }

    // -----------------------------------------------------------------------
    // randomInt
    // -----------------------------------------------------------------------

    #[test]
    fn random_int_early_return_branch_matches_js() {
        // (2, 2)：Math.floor(min) == maxFloor 的提前返回，固定消费 1 次抽样。
        let mut rng = Mulberry32::new(7);
        assert_eq!(random_int(2.0, 2.0, &mut rng), 2.0);
        assert_eq!(rng.next_f64(), 0.06195825757458806);

        // (2.5, 2.6)：跨整数边界的提前返回（中点 + 一次抽样后取 floor），JS 结果为 2。
        let mut rng = Mulberry32::new(7);
        assert_eq!(random_int(2.5, 2.6, &mut rng), 2.0);
        assert_eq!(rng.next_f64(), 0.06195825757458806);
    }

    #[test]
    fn random_int_extra_tail_branch_matches_js() {
        // (1.5, 10)：extraTailChance ≈ 0.05；seed 7 首抽 < 0.05 命中该分支，
        // 因 maxTail(0) <= minTail(0.5) 返回 Math.floor(minCeil - 1) = 1，仅消费 1 次抽样。
        let mut rng = Mulberry32::new(7);
        assert_eq!(random_int(1.5, 10.0, &mut rng), 1.0);
        assert_eq!(rng.next_f64(), 0.06195825757458806);
    }

    #[test]
    fn random_int_regular_branches_matches_js() {
        // (1.5, 10) seed 0：maxTail(0) <= minTail(0.5) → floor(minCeil - maxTail + r*(...)) = 2。
        let mut rng = Mulberry32::new(0);
        assert_eq!(random_int(1.5, 10.0, &mut rng), 2.0);
        assert_eq!(rng.next_f64(), 0.2232720274478197);

        // (1.2, 10.9) seed 0：maxTail(0.9) > minTail(0.8) → floor(min + r*(...)) = 1。
        let mut rng = Mulberry32::new(0);
        assert_eq!(random_int(1.2, 10.9, &mut rng), 1.0);
        assert_eq!(rng.next_f64(), 0.2232720274478197);
    }

    #[test]
    fn random_int_swaps_arguments_locally() {
        // JS 在 max < min 时交换局部参数：交换前后的调用结果与抽样消费完全一致。
        let mut rng = Mulberry32::new(0);
        assert_eq!(random_int(1.2, 10.0, &mut rng), 2.0);
        assert_eq!(rng.next_f64(), 0.2232720274478197);

        let mut rng = Mulberry32::new(0);
        assert_eq!(random_int(10.0, 1.2, &mut rng), 2.0);
        assert_eq!(rng.next_f64(), 0.2232720274478197);

        let mut rng = Mulberry32::new(0);
        assert_eq!(random_int(10.9, 1.2, &mut rng), 1.0);
        assert_eq!(rng.next_f64(), 0.2232720274478197);
    }

    #[test]
    fn random_int_nan_arguments_follow_js() {
        // JS：NaN 参与时不做交换、不命中提前返回，消费 2 次抽样后返回 NaN。
        let mut rng = Mulberry32::new(99);
        assert!(random_int(f64::NAN, 5.0, &mut rng).is_nan());
        assert_eq!(rng.next_f64(), 0.5408715349622071);
    }

    #[test]
    fn random_int_stream_consumption_matches_js() {
        // 连续调用混合各分支：结果与调用后的下一次抽样都必须逐位一致。
        let mut rng = Mulberry32::new(20240928);
        let pairs = [(1.5, 10.0), (2.5, 2.6), (10.0, 1.2), (3.0, 3.0), (2.5, 2.5), (1.0, 100.0)];
        let expected = [7.0, 3.0, 5.0, 3.0, 2.0, 54.0];
        for ((min, max), expected_value) in pairs.iter().zip(expected) {
            assert_eq!(random_int(*min, *max, &mut rng), expected_value);
        }
        assert_eq!(rng.next_f64(), 0.6573707461357117);
    }

    // -----------------------------------------------------------------------
    // processAttack
    // -----------------------------------------------------------------------

    #[test]
    fn process_attack_hit_and_miss_match_js() {
        // 命中（seed 0）：暴击判定 + 伤害掷骰(2 抽) + 命中判定 = 4 抽；伤害 7，目标 400 → 393。
        let mut source = smash_attacker();
        let mut target = armor_target();
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 7.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(target.combat_details.current_hitpoints, 393.0);
        assert_eq!(source.combat_details.current_hitpoints, 500.0);
        assert_eq!(rng.next_f64(), 0.46732782293111086);

        // 未命中（seed 1）：didHit=false、目标血量不变，但伤害掷骰照常消费随机数。
        let mut source = smash_attacker();
        let mut target = armor_target();
        let mut rng = Mulberry32::new(1);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 0.0, false, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(target.combat_details.current_hitpoints, 400.0);
        assert_eq!(rng.next_f64(), 0.9683778982143849);
    }

    #[test]
    fn process_attack_crit_rewrites_damage_range() {
        // criticalRate = 1：暴击恒触发；sourceMaxDamage 先放大再赋给 min（区间坍缩）。
        let mut source = smash_attacker();
        source.combat_details.combat_stats.critical_rate = 1.0;
        source.combat_details.combat_stats.critical_damage = 0.5;
        let mut target = armor_target();
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 41.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, true);
        assert_eq!(target.combat_details.current_hitpoints, 359.0);
        assert_eq!(rng.next_f64(), 0.1462021479383111);
    }

    #[test]
    fn process_attack_armor_mitigation_and_penetration_match_js() {
        // 目标护甲 100、穿透 1.0：有效护甲 50 → 承伤比 100/150；伤害 7 → 5。
        let mut source = smash_attacker();
        source.combat_details.smash_accuracy_rating = 300.0;
        source.combat_details.total_armor = 0.0;
        source.combat_details.combat_stats.armor_penetration = 1.0;
        let mut target = CombatUnit::default();
        target.combat_details.smash_evasion_rating = 10.0;
        target.combat_details.total_armor = 100.0;
        target.combat_details.current_hitpoints = 4000.0;
        target.combat_details.max_hitpoints = 4000.0;
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 5.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(target.combat_details.current_hitpoints, 3995.0);
        assert_eq!(rng.next_f64(), 0.46732782293111086);

        // 负护甲走 (100 - resistance) / 100 分支：-50 → 承伤比 1.5；伤害 7 → 11。
        let mut source = smash_attacker();
        let mut target = armor_target();
        target.combat_details.total_armor = -50.0;
        target.combat_details.current_hitpoints = 4000.0;
        target.combat_details.max_hitpoints = 4000.0;
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 11.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(target.combat_details.current_hitpoints, 3989.0);
        assert_eq!(rng.next_f64(), 0.46732782293111086);
    }

    #[test]
    fn process_attack_thorns_physical_and_elemental_match_js() {
        // 物理反伤：目标 physicalThorns 0.5，反伤掷骰消费 2 抽，源 500 → 498。
        let mut source = smash_attacker();
        let mut target = armor_target();
        target.combat_details.combat_stats.physical_thorns = 0.5;
        target.combat_details.defensive_max_damage = 4.0;
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 7.0, true, 2.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 498.0);
        assert_eq!(target.combat_details.current_hitpoints, 393.0);
        assert_eq!(rng.next_f64(), 0.6152513844426721);

        // 元素反伤：火伤改用 totalFireResistance / elementalThorns，thornType 同步切换。
        let mut source = smash_attacker();
        source.combat_details.combat_stats.damage_type = intern_hrid("/damage_types/fire");
        source.combat_details.total_fire_resistance = 2.0;
        let mut target = CombatUnit::default();
        target.combat_details.smash_evasion_rating = 20.0;
        target.combat_details.total_fire_resistance = 3.0;
        target.combat_details.combat_stats.elemental_thorns = 0.75;
        target.combat_details.defensive_max_damage = 4.0;
        target.combat_details.current_hitpoints = 400.0;
        target.combat_details.max_hitpoints = 400.0;
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 7.0, true, 2.0, "elementalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 498.0);
        assert_eq!(target.combat_details.current_hitpoints, 393.0);
        assert_eq!(rng.next_f64(), 0.6152513844426721);

        // 目标抗性 <= -99 时整段反伤被跳过（连随机数都不消费）。
        let mut source = smash_attacker();
        let mut target = armor_target();
        target.combat_details.total_armor = -100.0;
        target.combat_details.combat_stats.physical_thorns = 0.5;
        target.combat_details.defensive_max_damage = 4.0;
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 14.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 500.0);
        assert_eq!(target.combat_details.current_hitpoints, 386.0);
        assert_eq!(rng.next_f64(), 0.46732782293111086);
    }

    #[test]
    fn process_attack_retaliation_matches_js() {
        // 报复命中：premitigatedDamage 被 defensiveMaxDamage * 5 截断；报复掷骰消费 2 抽。
        let mut source = smash_attacker();
        source.combat_details.smash_max_damage = 100.0;
        source.combat_details.current_hitpoints = 1000.0;
        source.combat_details.max_hitpoints = 1000.0;
        source.combat_details.combat_stats.damage_taken = 0.2;
        let mut target = CombatUnit::default();
        target.combat_details.smash_evasion_rating = 20.0;
        target.combat_details.defensive_max_damage = 1.0;
        target.combat_details.smash_accuracy_rating = 500.0;
        target.combat_details.current_hitpoints = 4000.0;
        target.combat_details.max_hitpoints = 4000.0;
        target.combat_details.combat_stats.retaliation = 0.4;
        target.combat_details.combat_stats.armor_penetration = 0.2;
        target.combat_details.combat_stats.task_damage = 0.1;
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 23.0, true, 0.0, "physicalThorns", 3.0, 0.0, 0.0, 0.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 997.0);
        assert_eq!(target.combat_details.current_hitpoints, 3977.0);
        assert_eq!(rng.next_f64(), 0.6489853798411787);

        // 报复命中判定失败：只消费那一次判定抽样，不再掷报复伤害。
        let mut source = smash_attacker();
        source.combat_details.smash_max_damage = 100.0;
        source.combat_details.current_hitpoints = 1000.0;
        source.combat_details.max_hitpoints = 1000.0;
        source.combat_details.combat_stats.damage_taken = 0.2;
        let mut target = CombatUnit::default();
        target.combat_details.smash_evasion_rating = 3000.0;
        target.combat_details.defensive_max_damage = 1.0;
        target.combat_details.smash_accuracy_rating = 2.0;
        target.combat_details.current_hitpoints = 4000.0;
        target.combat_details.max_hitpoints = 4000.0;
        target.combat_details.combat_stats.retaliation = 0.4;
        let mut rng = Mulberry32::new(26);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 52.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 1000.0);
        assert_eq!(target.combat_details.current_hitpoints, 3948.0);
        assert_eq!(rng.next_f64(), 0.5393128525465727);
    }

    #[test]
    fn process_attack_life_steal_and_mana_leech_match_js() {
        // 普攻命中后：吸血 floor(0.1 * 28) = 2、吸蓝 floor(0.05 * 28) = 1，均走上限截断方法。
        let mut source = smash_attacker();
        source.combat_details.current_hitpoints = 100.0;
        source.combat_details.current_manapoints = 100.0;
        source.combat_details.max_manapoints = 400.0;
        source.combat_details.combat_stats.life_steal = 0.1;
        source.combat_details.combat_stats.mana_leech = 0.05;
        let mut target = armor_target();
        let mut rng = Mulberry32::new(7);
        let result = process_attack(&mut source, &mut target, None, &mut rng);
        assert_attack_result(&result, 28.0, true, 0.0, "physicalThorns", 0.0, 2.0, 0.0, 1.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 102.0);
        assert_eq!(source.combat_details.current_manapoints, 101.0);
        assert_eq!(target.combat_details.current_hitpoints, 372.0);
        assert_eq!(rng.next_f64(), 0.5214452685322613);
    }

    #[test]
    fn process_attack_ability_branch_and_hp_drain_match_js() {
        // 技能攻击：baseDamageFlat/Ratio 与 armorDamageRatio*totalArmor 进入伤害区间；
        // 伤害掷骰命中 extraTail 分支（只消费 1 抽）→ 79；技能分支乘 abilityDamage；
        // 掉血用 healingAmplify 且普攻吸血 / 吸蓝被跳过。
        let mut source = CombatUnit::default();
        source.combat_details.magic_accuracy_rating = 60.0;
        source.combat_details.magic_max_damage = 40.0;
        source.combat_details.total_armor = 5.0;
        source.combat_details.current_hitpoints = 200.0;
        source.combat_details.max_hitpoints = 500.0;
        source.combat_details.combat_stats.fire_amplify = 0.2;
        source.combat_details.combat_stats.ability_damage = 0.3;
        source.combat_details.combat_stats.task_damage = 0.05;
        source.combat_details.combat_stats.healing_amplify = 0.5;
        source.combat_details.combat_stats.life_steal = 0.1;
        let mut target = CombatUnit::default();
        target.combat_details.magic_evasion_rating = 20.0;
        target.combat_details.total_fire_resistance = 20.0;
        target.combat_details.current_hitpoints = 1000.0;
        target.combat_details.max_hitpoints = 1000.0;
        target.combat_details.combat_stats.damage_taken = 0.1;
        let effect = AbilityEffect {
            combat_style_hrid: Some(intern_hrid("/combat_styles/magic")),
            damage_type: Some(intern_hrid("/damage_types/fire")),
            damage_flat: 5.0,
            damage_ratio: 1.5,
            bonus_accuracy_ratio: 0.2,
            armor_damage_ratio: 0.1,
            hp_drain_ratio: Some(0.25),
            ..base_ability_effect()
        };
        let mut rng = Mulberry32::new(0);
        let result = process_attack(&mut source, &mut target, Some(&effect), &mut rng);
        assert_attack_result(&result, 99.0, true, 0.0, "elementalThorns", 0.0, 0.0, 37.0, 0.0, false);
        assert_eq!(source.combat_details.current_hitpoints, 237.0);
        assert_eq!(target.combat_details.current_hitpoints, 901.0);
        assert_eq!(rng.next_f64(), 0.1462021479383111);
    }

    #[test]
    fn process_attack_weakened_accuracy_penalty_branch_matches_js() {
        // JS 里 isWeakened 恒 undefined（恒假）；Rust 以 is_weakened 建模并保留分支形状。
        // seed 19 下同一随机流：惩罚生效 → 未命中；未生效 → 命中（证明惩罚参与命中判定）。
        let mut weakened = smash_attacker();
        weakened.is_weakened = true;
        weakened.weaken_percentage = 0.25;
        let mut target = armor_target();
        let mut rng = Mulberry32::new(19);
        let result = process_attack(&mut weakened, &mut target, None, &mut rng);
        assert_attack_result(&result, 0.0, false, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(rng.next_f64(), 0.9865809082984924);

        let mut plain = smash_attacker();
        plain.weaken_percentage = 0.25;
        let mut target = armor_target();
        let mut rng = Mulberry32::new(19);
        let result = process_attack(&mut plain, &mut target, None, &mut rng);
        assert_attack_result(&result, 13.0, true, 0.0, "physicalThorns", 0.0, 0.0, 0.0, 0.0, false);
        assert_eq!(target.combat_details.current_hitpoints, 387.0);
        assert_eq!(rng.next_f64(), 0.9865809082984924);
    }

    #[test]
    fn process_attack_panics_with_js_messages() {
        // 未知战斗风格（普攻来源）。
        let error = capture_unit_error(|| {
            let mut source = smash_attacker();
        source.combat_details.combat_stats.combat_style_hrid = intern_hrid("/combat_styles/bogus");
            let mut target = armor_target();
            let mut rng = Mulberry32::new(1);
            process_attack(&mut source, &mut target, None, &mut rng);
        });
        assert_eq!(error.kind, UnitErrorKind::Error);
        assert_eq!(error.message, "Unknown combat style: /combat_styles/bogus");

        // 未知伤害类型。
        let error = capture_unit_error(|| {
            let mut source = smash_attacker();
            source.combat_details.combat_stats.damage_type = intern_hrid("/damage_types/bogus");
            let mut target = armor_target();
            let mut rng = Mulberry32::new(1);
            process_attack(&mut source, &mut target, None, &mut rng);
        });
        assert_eq!(error.message, "Unknown damage type: /damage_types/bogus");

        // 技能效果缺战斗风格 / 伤害类型：JS 字符串化为 'undefined'。
        let missing_style = base_ability_effect();
        let error = capture_unit_error(|| {
            let mut source = smash_attacker();
            let mut target = armor_target();
            let mut rng = Mulberry32::new(1);
            process_attack(&mut source, &mut target, Some(&missing_style), &mut rng);
        });
        assert_eq!(error.message, "Unknown combat style: undefined");

        let missing_damage_type = AbilityEffect {
            combat_style_hrid: Some(intern_hrid("/combat_styles/smash")),
            ..base_ability_effect()
        };
        let error = capture_unit_error(|| {
            let mut source = smash_attacker();
            let mut target = armor_target();
            let mut rng = Mulberry32::new(1);
            process_attack(&mut source, &mut target, Some(&missing_damage_type), &mut rng);
        });
        assert_eq!(error.message, "Unknown damage type: undefined");
    }

    // -----------------------------------------------------------------------
    // processHeal / processRevive / processSpendHp / calculateTickValue
    // -----------------------------------------------------------------------

    #[test]
    fn process_heal_matches_js() {
        let source = {
            let mut unit = CombatUnit::default();
            unit.combat_details.magic_max_damage = 200.0;
            unit.combat_details.combat_stats.healing_amplify = 0.25;
            unit
        };
        let ability = AbilityEffect {
            combat_style_hrid: Some(intern_hrid("/combat_styles/magic")),
            damage_flat: 10.0,
            damage_ratio: 0.5,
            ..base_ability_effect()
        };

        // 部分治疗：heal 掷骰结果 48，目标 50 → 98。
        let mut target = CombatUnit::default();
        target.combat_details.current_hitpoints = 50.0;
        target.combat_details.max_hitpoints = 500.0;
        let mut rng = Mulberry32::new(4242);
        assert_eq!(process_heal(&source, &ability, &mut target, &mut rng), 48.0);
        assert_eq!(target.combat_details.current_hitpoints, 98.0);
        assert_eq!(rng.next_f64(), 0.9312369171530008);

        // 满血目标：addHitpoints 返回 0，血量不变，但治疗掷骰照常消费随机数。
        let mut target = CombatUnit::default();
        target.combat_details.current_hitpoints = 500.0;
        target.combat_details.max_hitpoints = 500.0;
        let mut rng = Mulberry32::new(4242);
        assert_eq!(process_heal(&source, &ability, &mut target, &mut rng), 0.0);
        assert_eq!(target.combat_details.current_hitpoints, 500.0);
        assert_eq!(rng.next_f64(), 0.9312369171530008);
    }

    #[test]
    fn process_revive_restores_manapoints_and_clears_ccs_match_js() {
        let source = {
            let mut unit = CombatUnit::default();
            unit.combat_details.magic_max_damage = 300.0;
            unit
        };
        let ability = AbilityEffect {
            combat_style_hrid: Some(intern_hrid("/combat_styles/magic")),
            damage_flat: 10.0,
            damage_ratio: 0.5,
            ..base_ability_effect()
        };
        let mut target = CombatUnit::default();
        target.combat_details.current_hitpoints = 0.0;
        target.combat_details.max_hitpoints = 500.0;
        target.combat_details.current_manapoints = 10.0;
        target.combat_details.max_manapoints = 400.0;
        target.combat_details.combat_stats.damage_taken = 0.3;
        target.is_stunned = true;
        target.is_blinded = true;
        target.is_silenced = true;
        let mut rng = Mulberry32::new(777);
        assert_eq!(process_revive(&source, &ability, &mut target, &mut rng), 16.0);
        assert_eq!(target.combat_details.current_hitpoints, 16.0);
        assert_eq!(target.combat_details.current_manapoints, 400.0);
        assert!(!target.is_stunned);
        assert!(!target.is_silenced);
        assert!(!target.is_blinded);
        assert_eq!(target.combat_details.combat_stats.damage_taken, 0.0);
        assert_eq!(rng.next_f64(), 0.19238732964731753);
    }

    #[test]
    fn process_heal_and_revive_reject_non_magic_styles() {
        let source = CombatUnit::default();
        let mut target = CombatUnit::default();

        let smash_effect = AbilityEffect {
            combat_style_hrid: Some(intern_hrid("/combat_styles/smash")),
            ..base_ability_effect()
        };
        let error = capture_unit_error(|| {
            let mut rng = Mulberry32::new(1);
            process_heal(&source, &smash_effect, &mut target, &mut rng);
        });
        assert_eq!(error.kind, UnitErrorKind::Error);
        assert_eq!(error.message, "Heal ability effect not supported for combat style: /combat_styles/smash");

        // revive 复用 heal 的错误文案（含风格缺失时的 'undefined'）。
        let missing_style = base_ability_effect();
        let error = capture_unit_error(|| {
            let mut rng = Mulberry32::new(1);
            process_revive(&source, &missing_style, &mut target, &mut rng);
        });
        assert_eq!(error.message, "Heal ability effect not supported for combat style: undefined");

        let error = capture_unit_error(|| {
            let mut rng = Mulberry32::new(1);
            process_heal(&source, &missing_style, &mut target, &mut rng);
        });
        assert_eq!(error.message, "Heal ability effect not supported for combat style: undefined");
    }

    #[test]
    fn process_spend_hp_floors_and_subtracts_match_js() {
        let mut source = CombatUnit::default();
        source.combat_details.current_hitpoints = 500.0;
        let ability = AbilityEffect { spend_hp_ratio: Some(0.25), ..base_ability_effect() };
        assert_eq!(process_spend_hp(&mut source, &ability), 125.0);
        assert_eq!(source.combat_details.current_hitpoints, 375.0);

        // floor(333 * 0.1) = 33（0.1 的二进制误差不改变结果）。
        let mut source = CombatUnit::default();
        source.combat_details.current_hitpoints = 333.0;
        let ability = AbilityEffect { spend_hp_ratio: Some(0.1), ..base_ability_effect() };
        assert_eq!(process_spend_hp(&mut source, &ability), 33.0);
        assert_eq!(source.combat_details.current_hitpoints, 300.0);
    }

    #[test]
    fn process_spend_hp_without_ratio_pollutes_hitpoints_like_js() {
        // JS 怪癖：spendHpRatio 缺失（undefined）时整条算式得 NaN，并原样写回面板。
        let mut source = CombatUnit::default();
        source.combat_details.current_hitpoints = 500.0;
        let ability = base_ability_effect();
        assert!(process_spend_hp(&mut source, &ability).is_nan());
        assert!(source.combat_details.current_hitpoints.is_nan());
    }

    #[test]
    fn calculate_tick_value_matches_js() {
        // Math.floor((tick * total) / ticks) 与 Math.floor(((tick - 1) * total) / ticks) 的差值。
        let cases = [
            (100.0, 10.0, 1.0, 10.0),
            (100.0, 10.0, 5.0, 10.0),
            (33.0, 7.0, 3.0, 5.0),
            (5.0, 3.0, 2.0, 2.0),
            (0.5, 3.0, 2.0, 0.0),
            (100.0, 10.0, 0.0, 10.0),
            (100.0, 10.0, 10.0, 10.0),
            (7.0, 2.0, 1.0, 3.0),
            (2.5, 1.5, 2.0, 2.0),
        ];
        for (total_value, total_ticks, current_tick, expected) in cases {
            assert_eq!(calculate_tick_value(total_value, total_ticks, current_tick), expected);
        }
    }
}