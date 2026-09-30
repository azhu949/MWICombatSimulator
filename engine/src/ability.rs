//! 技能模型（`src/combatsimulator/ability.js` 的移植；定义数据由场景 JSON 提供，已含等级并入）。
//!
//! 逐位 parity 要点：
//! - `should_trigger` 先查 `isStunned` / `isSilenced`，再算冷却，最后**无短路**地
//!   求值全部触发器（任一不满足即 false），以保持与 JS 相同的求值次数与报错顺序；
//! - 冷却在 `abilityHaste > 0` 时按 `cooldown * 100 / (100 + haste)` 缩放。

use crate::buff::Buff;
use crate::hrid::Hrid;
use crate::sim_unit::{UnitArena, UnitId};
use crate::trigger::Trigger;
use crate::unit::UnitError;
use serde::{Deserialize, Serialize};

/// 技能效果（JS `abilityEffect`：等级并入后的数值快照）。
///
/// `#[serde(default)]` 的字段对应 JS 侧可能缺失的原始字段（缺失时 JS 得到
/// `undefined`，消费点用 `> 0` 判定为假）；带 level bonus 并入的字段（damageFlat /
/// damageRatio / bonusAccuracyRatio / armorDamageRatio）在 JS 侧缺失会得到 NaN，
/// 因此场景装配必须保证它们存在且为有限数。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityEffect {
    pub target_type: Hrid,
    pub effect_type: Hrid,
    #[serde(default)]
    pub combat_style_hrid: Option<Hrid>,
    #[serde(default)]
    pub damage_type: Option<Hrid>,
    pub damage_flat: f64,
    pub damage_ratio: f64,
    pub bonus_accuracy_ratio: f64,
    pub armor_damage_ratio: f64,
    #[serde(default)]
    pub damage_over_time_ratio: Option<f64>,
    #[serde(default)]
    pub damage_over_time_duration: Option<f64>,
    #[serde(default)]
    pub hp_drain_ratio: Option<f64>,
    #[serde(default)]
    pub pierce_chance: Option<f64>,
    #[serde(default)]
    pub blind_chance: Option<f64>,
    #[serde(default)]
    pub blind_duration: Option<f64>,
    #[serde(default)]
    pub silence_chance: Option<f64>,
    #[serde(default)]
    pub silence_duration: Option<f64>,
    #[serde(default)]
    pub stun_chance: Option<f64>,
    #[serde(default)]
    pub stun_duration: Option<f64>,
    #[serde(default)]
    pub spend_hp_ratio: Option<f64>,
    #[serde(default)]
    pub buffs: Vec<Buff>,
}

impl AbilityEffect {
    /// JS `abilityEffect.combatStyleHrid`（可能为 undefined）。
    pub fn combat_style(&self) -> Option<Hrid> {
        self.combat_style_hrid
    }

    /// JS `abilityEffect.damageType`（可能为 undefined）。
    pub fn damage_type(&self) -> Option<Hrid> {
        self.damage_type
    }

    /// 切片 31：同形态覆盖复制（重生复用热路径）——复用内层 `buffs` 已分配缓冲。
    /// 字段以解构模式绑定，新增字段时编译期强制同步。
    pub fn clone_from_reuse(&mut self, source: &Self) {
        let AbilityEffect {
            target_type,
            effect_type,
            combat_style_hrid,
            damage_type,
            damage_flat,
            damage_ratio,
            bonus_accuracy_ratio,
            armor_damage_ratio,
            damage_over_time_ratio,
            damage_over_time_duration,
            hp_drain_ratio,
            pierce_chance,
            blind_chance,
            blind_duration,
            silence_chance,
            silence_duration,
            stun_chance,
            stun_duration,
            spend_hp_ratio,
            buffs,
        } = source;
        self.target_type = *target_type;
        self.effect_type = *effect_type;
        self.combat_style_hrid = *combat_style_hrid;
        self.damage_type = *damage_type;
        self.damage_flat = *damage_flat;
        self.damage_ratio = *damage_ratio;
        self.bonus_accuracy_ratio = *bonus_accuracy_ratio;
        self.armor_damage_ratio = *armor_damage_ratio;
        self.damage_over_time_ratio = *damage_over_time_ratio;
        self.damage_over_time_duration = *damage_over_time_duration;
        self.hp_drain_ratio = *hp_drain_ratio;
        self.pierce_chance = *pierce_chance;
        self.blind_chance = *blind_chance;
        self.blind_duration = *blind_duration;
        self.silence_chance = *silence_chance;
        self.silence_duration = *silence_duration;
        self.stun_chance = *stun_chance;
        self.stun_duration = *stun_duration;
        self.spend_hp_ratio = *spend_hp_ratio;
        self.buffs.clone_from(buffs);
    }
}

/// 技能（JS `Ability` 的运行时状态 + 已解析定义）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ability {
    pub hrid: Hrid,
    #[serde(default = "crate::ability::default_level")]
    pub level: f64,
    pub mana_cost: f64,
    pub cooldown_duration: f64,
    pub cast_duration: f64,
    #[serde(default)]
    pub is_special_ability: bool,
    #[serde(default)]
    pub ability_effects: Vec<AbilityEffect>,
    #[serde(default)]
    pub triggers: Vec<Trigger>,
    #[serde(default = "crate::ability::default_last_used")]
    pub last_used: f64,
}

pub fn default_level() -> f64 {
    1.0
}

/// `Number.MIN_SAFE_INTEGER`（JS 技能/消耗品的初始 lastUsed）。
pub fn default_last_used() -> f64 {
    crate::sim_unit::NUMBER_MIN_SAFE_INTEGER
}

impl Ability {
    /// 等价 JS `Ability.shouldTrigger(currentTime, source, target, friendlies, enemies)`。
    ///
    /// 注意：JS 读的是 `source.combatDetails.combatStats.abilityHaste`（玩家侧为 undefined，
    /// 只有怪物数据会补值），比较写 `haste > 0`；Rust 侧用
    /// `combat_stats.ability_haste.is_some_and(|value| value > 0.0)` 复刻。
    pub fn should_trigger(
        &self,
        arena: &UnitArena,
        source: UnitId,
        target: Option<UnitId>,
        friendlies: &[UnitId],
        enemies: Option<&[UnitId]>,
        current_time: f64,
    ) -> Result<bool, UnitError> {
        let unit = arena.get(source);
        if unit.is_stunned {
            return Ok(false);
        }
        if unit.is_silenced {
            return Ok(false);
        }

        let haste = unit.combat_details.combat_stats.ability_haste;
        let mut cooldown_duration = self.cooldown_duration;
        if haste.is_some_and(|value| value > 0.0) {
            cooldown_duration = (cooldown_duration * 100.0) / (100.0 + haste.unwrap_or(0.0));
        }

        if self.last_used + cooldown_duration > current_time {
            return Ok(false);
        }

        if self.triggers.is_empty() {
            return Ok(true);
        }

        // 不短路：全部触发器都要被求值（保持与 JS 相同的报错顺序与求值次数）。
        let mut should_trigger = true;
        for trigger in &self.triggers {
            if !trigger.is_active(arena, source, target, friendlies, enemies, current_time)? {
                should_trigger = false;
            }
        }

        Ok(should_trigger)
    }

    /// 切片 31：同形态覆盖复制（重生复用热路径）——复用 `ability_effects` /
    /// `triggers` 已分配缓冲；效果条目逐项走 `AbilityEffect::clone_from_reuse`。
    /// 字段以解构模式绑定，新增字段时编译期强制同步。
    pub fn clone_from_reuse(&mut self, source: &Self) {
        let Ability {
            hrid,
            level,
            mana_cost,
            cooldown_duration,
            cast_duration,
            is_special_ability,
            ability_effects,
            triggers,
            last_used,
        } = source;
        self.hrid = *hrid;
        self.level = *level;
        self.mana_cost = *mana_cost;
        self.cooldown_duration = *cooldown_duration;
        self.cast_duration = *cast_duration;
        self.is_special_ability = *is_special_ability;
        self.last_used = *last_used;
        if self.ability_effects.len() == ability_effects.len() {
            for (destination, source_effect) in self.ability_effects.iter_mut().zip(ability_effects.iter()) {
                destination.clone_from_reuse(source_effect);
            }
        } else {
            self.ability_effects.clone_from(ability_effects);
        }
        self.triggers.clone_from(triggers);
    }
}
