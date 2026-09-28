//! 单位操作回放探针：把 JS 侧 parity 测试生成的操作脚本喂给 Rust `CombatUnit`，
//! 输出可逐项比较的轨迹（JSON）。由 `src/services/__tests__/wasmEngineUnitParity.test.js`
//! 驱动，并与真实 JS CombatUnit 在同一脚本下的轨迹做**精确对账**。
//!
//! 操作脚本形如：
//! ```json
//! [
//!   {"op":"createUnit","isPlayer":true},
//!   {"op":"addBuff","buff":{"uniqueHrid":"/u/a","typeHrid":"/buff_types/damage","ratioBoost":0.1,"flatBoost":2,"duration":5000},"currentTime":1000},
//!   {"op":"expireBuffs","currentTime":4000},
//!   {"op":"snapshotUnit"}
//! ]
//! ```
//! 轨迹形如 `[{"op":"createUnit","value":null},{"op":"expireBuffs","value":true},…]`；
//! 抛错的操作记 `{"op":…,"error":{"name":"TypeError","message":…}}`（消息逐字对账）。
//!
//! 注意：`removeBuff` 的 `sourceHrid` 采用三层语义——字段缺省 = JS 的
//! `REMOVE_ACTIVE_SOURCE`；显式 `null` = `default` 键；字符串 = 显式源键。

use crate::buff::Buff;
use crate::unit::{policy_name, BuffList, BuffSourceEntry, BuffSourceSelector, CombatUnit, RawBuffInput, UnitError};
use serde::Deserialize;
use serde_json::{json, Map, Value};

fn default_true() -> bool {
    true
}

/// 复刻 JS 的三层参数语义：字段缺省 = `REMOVE_ACTIVE_SOURCE`、显式 `null` = `default` 源键。
/// serde 对 `Option<Option<T>>` 会把 null 折叠成外层 `None`，必须用 `deserialize_with` 把内层包成 `Some`。
fn deserialize_some<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LevelsInput {
    #[serde(default)]
    stamina_level: Option<f64>,
    #[serde(default)]
    intelligence_level: Option<f64>,
    #[serde(default)]
    attack_level: Option<f64>,
    #[serde(default)]
    melee_level: Option<f64>,
    #[serde(default)]
    defense_level: Option<f64>,
    #[serde(default)]
    ranged_level: Option<f64>,
    #[serde(default)]
    magic_level: Option<f64>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum UnitOp {
    CreateUnit {
        #[serde(default)]
        is_player: bool,
    },
    SetLevels {
        levels: LevelsInput,
    },
    SetCombatStat {
        name: String,
        value: f64,
    },
    SetEquipment {
        #[serde(default)]
        two_hand_hrid: Option<String>,
    },
    SetPermanentSources {
        #[serde(default)]
        house_rooms: Option<Vec<BuffList>>,
        #[serde(default)]
        guild_buffs: Option<Vec<BuffList>>,
        #[serde(default)]
        achievements: Option<Option<BuffList>>,
        #[serde(default)]
        zone_buffs: Option<Vec<RawBuffInput>>,
        #[serde(default)]
        extra_buffs: Option<Vec<RawBuffInput>>,
    },
    RefreshBase,
    AddBuff {
        buff: RawBuffInput,
        current_time: f64,
        #[serde(default)]
        source_hrid: Option<String>,
        #[serde(default)]
        source_policy: Option<String>,
    },
    RemoveBuff {
        #[serde(default)]
        unique_hrid: Option<String>,
        #[serde(default, deserialize_with = "deserialize_some")]
        source_hrid: Option<Option<String>>,
    },
    ExpireBuff {
        unique_hrid: String,
        current_time: f64,
        #[serde(default = "default_true")]
        update_details: bool,
    },
    ExpireBuffs {
        current_time: f64,
        #[serde(default = "default_true")]
        update_details: bool,
    },
    ClearBuffs,
    #[serde(rename = "clearCCs")]
    ClearCcs,
    UpdateDetails,
    GetBoost {
        #[serde(rename = "type")]
        type_hrid: String,
    },
    GetBoosts {
        #[serde(rename = "type")]
        type_hrid: String,
    },
    AddPermanentBuff {
        buff: RawBuffInput,
    },
    GeneratePermanentBuffs,
    SnapshotUnit,
}

impl UnitOp {
    fn name(&self) -> &'static str {
        match self {
            UnitOp::CreateUnit { .. } => "createUnit",
            UnitOp::SetLevels { .. } => "setLevels",
            UnitOp::SetCombatStat { .. } => "setCombatStat",
            UnitOp::SetEquipment { .. } => "setEquipment",
            UnitOp::SetPermanentSources { .. } => "setPermanentSources",
            UnitOp::RefreshBase => "refreshBase",
            UnitOp::AddBuff { .. } => "addBuff",
            UnitOp::RemoveBuff { .. } => "removeBuff",
            UnitOp::ExpireBuff { .. } => "expireBuff",
            UnitOp::ExpireBuffs { .. } => "expireBuffs",
            UnitOp::ClearBuffs => "clearBuffs",
            UnitOp::ClearCcs => "clearCCs",
            UnitOp::UpdateDetails => "updateDetails",
            UnitOp::GetBoost { .. } => "getBoost",
            UnitOp::GetBoosts { .. } => "getBoosts",
            UnitOp::AddPermanentBuff { .. } => "addPermanentBuff",
            UnitOp::GeneratePermanentBuffs => "generatePermanentBuffs",
            UnitOp::SnapshotUnit => "snapshotUnit",
        }
    }
}

fn require_unit(unit: &mut Option<CombatUnit>) -> Result<&mut CombatUnit, UnitError> {
    unit.as_mut().ok_or_else(|| UnitError::error("probe unit not created yet"))
}

fn apply_levels(unit: &mut CombatUnit, levels: LevelsInput) {
    if let Some(value) = levels.stamina_level {
        unit.stamina_level = value;
    }
    if let Some(value) = levels.intelligence_level {
        unit.intelligence_level = value;
    }
    if let Some(value) = levels.attack_level {
        unit.attack_level = value;
    }
    if let Some(value) = levels.melee_level {
        unit.melee_level = value;
    }
    if let Some(value) = levels.defense_level {
        unit.defense_level = value;
    }
    if let Some(value) = levels.ranged_level {
        unit.ranged_level = value;
    }
    if let Some(value) = levels.magic_level {
        unit.magic_level = value;
    }
}

fn apply_op(unit: &mut Option<CombatUnit>, op: UnitOp) -> Result<Value, UnitError> {
    match op {
        UnitOp::CreateUnit { is_player } => {
            *unit = Some(CombatUnit { is_player, ..Default::default() });
            Ok(Value::Null)
        }
        UnitOp::SetLevels { levels } => {
            apply_levels(require_unit(unit)?, levels);
            Ok(Value::Null)
        }
        UnitOp::SetCombatStat { name, value } => {
            let combat_stats = &mut require_unit(unit)?.combat_details.combat_stats;
            if name == "tenacity" || name == "abilityHaste" {
                // JS 基础面板缺失这两个键；显式设置后参与后续结算/冷却缩放。
                if name == "tenacity" {
                    combat_stats.tenacity = Some(value);
                } else {
                    combat_stats.ability_haste = Some(value);
                }
            } else if !combat_stats.set_numeric_field(&name, value) {
                // 探针防御：脚本写错字段名（JS 侧会静默新增键，脚本本身即错误）。
                return Err(UnitError::error(format!("unknown combat stat field: {name}")));
            }
            Ok(Value::Null)
        }
        UnitOp::SetEquipment { two_hand_hrid } => {
            require_unit(unit)?.two_hand_hrid = two_hand_hrid;
            Ok(Value::Null)
        }
        UnitOp::SetPermanentSources { house_rooms, guild_buffs, achievements, zone_buffs, extra_buffs } => {
            let unit = require_unit(unit)?;
            if let Some(house_rooms) = house_rooms {
                unit.house_rooms = house_rooms;
            }
            if let Some(guild_buffs) = guild_buffs {
                unit.guild_buffs = guild_buffs;
            }
            if let Some(achievements) = achievements {
                unit.achievements = achievements;
            }
            if let Some(zone_buffs) = zone_buffs {
                unit.zone_buffs = zone_buffs;
            }
            if let Some(extra_buffs) = extra_buffs {
                unit.extra_buffs = extra_buffs;
            }
            Ok(Value::Null)
        }
        UnitOp::RefreshBase => {
            require_unit(unit)?.refresh_base_combat_stats();
            Ok(Value::Null)
        }
        UnitOp::AddBuff { buff, current_time, source_hrid, source_policy } => {
            require_unit(unit)?.add_buff(&buff, current_time, source_hrid.as_deref(), source_policy.as_deref())?;
            Ok(Value::Null)
        }
        UnitOp::RemoveBuff { unique_hrid, source_hrid } => {
            let selector = match source_hrid {
                None => BuffSourceSelector::ActiveSource,
                Some(explicit) => BuffSourceSelector::Explicit(explicit),
            };
            require_unit(unit)?.remove_buff(unique_hrid.as_deref(), selector)?;
            Ok(Value::Null)
        }
        UnitOp::ExpireBuff { unique_hrid, current_time, update_details } => {
            let dirty =
                require_unit(unit)?.remove_expired_buff_by_unique_hrid(&unique_hrid, current_time, update_details)?;
            Ok(Value::Bool(dirty))
        }
        UnitOp::ExpireBuffs { current_time, update_details } => {
            let dirty = require_unit(unit)?.remove_expired_buffs(current_time, update_details)?;
            Ok(Value::Bool(dirty))
        }
        UnitOp::ClearBuffs => {
            require_unit(unit)?.clear_buffs();
            Ok(Value::Null)
        }
        UnitOp::ClearCcs => {
            require_unit(unit)?.clear_ccs();
            Ok(Value::Null)
        }
        UnitOp::UpdateDetails => {
            require_unit(unit)?.update_combat_details();
            Ok(Value::Null)
        }
        UnitOp::GetBoost { type_hrid } => {
            let boost = require_unit(unit)?.get_buff_boost(&type_hrid);
            Ok(json!({ "ratioBoost": boost.ratio_boost, "flatBoost": boost.flat_boost }))
        }
        UnitOp::GetBoosts { type_hrid } => {
            let boosts = require_unit(unit)?.get_buff_boosts(&type_hrid);
            let values: Vec<Value> = boosts
                .iter()
                .map(|boost| json!({ "ratioBoost": boost.ratio_boost, "flatBoost": boost.flat_boost }))
                .collect();
            Ok(Value::Array(values))
        }
        UnitOp::AddPermanentBuff { buff } => {
            require_unit(unit)?.add_permanent_buff(&buff);
            Ok(Value::Null)
        }
        UnitOp::GeneratePermanentBuffs => {
            require_unit(unit)?.generate_permanent_buffs();
            Ok(Value::Null)
        }
        UnitOp::SnapshotUnit => Ok(snapshot_unit(require_unit(unit)?)),
    }
}

/// 增益记录的规范化轨迹形态（字段集合与 JS 驱动 `buffToTrace` 成对维护）。
fn buff_to_trace(buff: &Buff) -> Value {
    json!({
        "uniqueHrid": buff.unique_hrid,
        "typeHrid": buff.type_hrid,
        "ratioBoost": buff.ratio_boost,
        "flatBoost": buff.flat_boost,
        "duration": buff.duration,
        "startTime": buff.start_time,
        "multiplierForSkillHrid": buff.multiplier_for_skill_hrid,
        "multiplierPerSkillLevel": buff.multiplier_per_skill_level,
    })
}

fn source_entry_to_trace(entry: &BuffSourceEntry) -> Value {
    json!({
        "buff": buff_to_trace(&entry.buff),
        "expiresAt": entry.expires_at,
        "sequence": entry.sequence,
    })
}

/// 单位全量快照（面板 + 增益注册表 + 源注册表 + 键序），两侧 schema 成对维护。
fn snapshot_unit(unit: &CombatUnit) -> Value {
    let combat_buff_keys: Vec<&String> = unit.combat_buffs.keys().collect();
    let mut combat_buffs = Map::new();
    for (key, buff) in unit.combat_buffs.iter() {
        combat_buffs.insert(key.clone(), buff_to_trace(buff));
    }

    let permanent_buff_keys: Vec<&String> = unit.permanent_buffs.keys().collect();
    let mut permanent_buffs = Map::new();
    for (key, buff) in unit.permanent_buffs.iter() {
        permanent_buffs.insert(key.clone(), buff_to_trace(buff));
    }

    let mut active_buff_source_keys = Map::new();
    for (unique_hrid, source_key) in unit.active_buff_source_keys.iter() {
        active_buff_source_keys.insert(unique_hrid.clone(), Value::String(source_key.clone()));
    }

    let mut buff_source_policies = Map::new();
    for (unique_hrid, policy) in unit.buff_source_policies.iter() {
        buff_source_policies.insert(unique_hrid.clone(), Value::String(policy_name(*policy).to_string()));
    }

    let mut buff_sources = Map::new();
    for (unique_hrid, sources) in unit.buff_sources.iter() {
        let keys: Vec<&String> = sources.keys().collect();
        let mut entries = Map::new();
        for (source_key, entry) in sources.iter() {
            entries.insert(source_key.clone(), source_entry_to_trace(entry));
        }
        buff_sources.insert(unique_hrid.clone(), json!({ "keys": keys, "entries": entries }));
    }

    json!({
        "isPlayer": unit.is_player,
        "twoHandHrid": unit.two_hand_hrid,
        "combatDetails": unit.combat_details,
        "baseCombatStats": unit.base_combat_stats,
        "combatBuffKeys": combat_buff_keys,
        "combatBuffs": combat_buffs,
        "permanentBuffKeys": permanent_buff_keys,
        "permanentBuffs": permanent_buffs,
        "activeBuffSourceKeys": active_buff_source_keys,
        "buffSourcePolicies": buff_source_policies,
        "buffSourceSequence": unit.buff_source_sequence,
        "buffSources": buff_sources,
    })
}

/// 回放操作脚本，返回轨迹 JSON 字符串。脚本无法解析时以 Err 返回。
pub fn run_unit_operations(ops_json: &str) -> Result<String, String> {
    let ops: Vec<UnitOp> = serde_json::from_str(ops_json).map_err(|error| error.to_string())?;
    let mut unit: Option<CombatUnit> = None;
    let mut trace: Vec<Value> = Vec::with_capacity(ops.len());

    for op in ops {
        let op_name = op.name();
        match apply_op(&mut unit, op) {
            Ok(value) => trace.push(json!({ "op": op_name, "value": value })),
            Err(error) => trace.push(json!({
                "op": op_name,
                "error": { "name": error.kind.name(), "message": error.message },
            })),
        }
    }

    serde_json::to_string(&trace).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replays_a_small_script() {
        let script = r#"[
            {"op":"createUnit","isPlayer":true},
            {"op":"refreshBase"},
            {"op":"addBuff","buff":{"uniqueHrid":"/u/a","typeHrid":"/buff_types/damage","ratioBoost":1,"flatBoost":0,"duration":500},"currentTime":100},
            {"op":"getBoost","type":"/buff_types/damage"},
            {"op":"getBoosts","type":"/buff_types/damage"},
            {"op":"snapshotUnit"},
            {"op":"expireBuffs","currentTime":600},
            {"op":"snapshotUnit"},
            {"op":"getBoost","type":"/buff_types/damage"},
            {"op":"removeBuff","uniqueHrid":"/u/a"},
            {"op":"getBoost","type":"/buff_types/damage"}
        ]"#;
        let trace: Value = serde_json::from_str(&run_unit_operations(script).expect("script replays"))
            .expect("trace is valid json");
        let entries = trace.as_array().expect("trace is an array");
        assert_eq!(entries.len(), 11);
        assert_eq!(entries[0], json!({ "op": "createUnit", "value": null }));
        assert_eq!(entries[3], json!({ "op": "getBoost", "value": { "ratioBoost": 1.0, "flatBoost": 0.0 } }));
        assert_eq!(entries[4]["value"].as_array().expect("boosts array").len(), 1);
        // damage ratio 1.0 → stabMaxDamage = (10+1) * (1+0) * (1+1) * (1+0) = 22
        assert_eq!(entries[5]["value"]["combatDetails"]["stabMaxDamage"], json!(22.0));
        assert_eq!(entries[6], json!({ "op": "expireBuffs", "value": true }));
        assert_eq!(entries[8], json!({ "op": "getBoost", "value": { "ratioBoost": 0.0, "flatBoost": 0.0 } }));
        assert_eq!(entries[9], json!({ "op": "removeBuff", "value": null }));
        assert_eq!(entries[10], json!({ "op": "getBoost", "value": { "ratioBoost": 0.0, "flatBoost": 0.0 } }));
    }

    #[test]
    fn records_errors_with_names_and_messages() {
        let script = r#"[
            {"op":"createUnit"},
            {"op":"addBuff","buff":{"uniqueHrid":"/u/x","typeHrid":"/buff_types/damage","ratioBoost":0,"flatBoost":1,"duration":100},"currentTime":0,"sourcePolicy":"bogus"},
            {"op":"addBuff","buff":{"uniqueHrid":"/u/x","typeHrid":"/buff_types/damage","ratioBoost":0,"flatBoost":1},"currentTime":0}
        ]"#;
        let trace: Value = serde_json::from_str(&run_unit_operations(script).expect("script replays"))
            .expect("trace is valid json");
        let entries = trace.as_array().expect("trace is an array");
        assert_eq!(
            entries[1],
            json!({
                "op": "addBuff",
                "error": { "name": "TypeError", "message": "Unsupported buff source policy: bogus" },
            })
        );
        assert_eq!(
            entries[2],
            json!({
                "op": "addBuff",
                "error": { "name": "TypeError", "message": "CombatUnit buff duration must be a finite number for /u/x" },
            })
        );
    }

    #[test]
    fn rejects_malformed_scripts() {
        assert!(run_unit_operations("not json").is_err());
        assert!(run_unit_operations(r#"[{"op":"unknownOp"}]"#).is_err());
    }

    #[test]
    fn buff_source_policy_trace_uses_js_policy_strings() {
        let script = r#"[
            {"op":"createUnit"},
            {"op":"addBuff","buff":{"uniqueHrid":"/buff_uniques/fierce_aura","typeHrid":"/buff_types/fierce_aura","ratioBoost":0,"flatBoost":0.1,"duration":100},"currentTime":0,"sourceHrid":"ally","sourcePolicy":"strongest"},
            {"op":"snapshotUnit"}
        ]"#;
        let trace: Value = serde_json::from_str(&run_unit_operations(script).expect("script replays"))
            .expect("trace is valid json");
        assert_eq!(trace[2]["value"]["buffSourcePolicies"]["/buff_uniques/fierce_aura"], json!("strongest"));
        assert_eq!(trace[2]["value"]["activeBuffSourceKeys"]["/buff_uniques/fierce_aura"], json!("ally"));
        assert_eq!(trace[2]["value"]["buffSourceSequence"], json!(1));
    }
}
