//! 战斗模拟回放探针：接收场景 JSON（玩家/遭遇战/技能/消耗品定义 + 随机种子），
//! 用 Rust `CombatSimulator` 跑一轮完整模拟，输出可与 JS 引擎逐项对账的聚合结果。
//!
//! 由 `src/services/__tests__/wasmEngineSimulatorParity.test.js` 驱动；两侧 schema 成对维护。
//!
//! 请求形如：
//! ```json
//! {
//!   "runs": [
//!     {
//!       "options": { "seed": 42, "simulationTimeLimit": 60000000, "traceLimit": 200, "zonePresent": true, "encounterSpecs": [[{ "hrid": "/e/0" }]] },
//!       "players": [ { "hrid": "/p/0", "isPlayer": true, "levels": { ... }, "combatStats": [["stabDamage", 0.1]], "abilities": [ ... ] } ]
//!     }
//!   ]
//! }
//! ```
//!
//! 结果形如 `{"results":[{"simulatedTime":…,"eventCount":…,"eventTrace":[…],"resultCalls":[…],"units":[…]}]}`；
//! 单轮内部报错（例如触发器指向已死单位）记 `"error":{"name":…,"message":…}`，其余字段照常返回。

use crate::hrid::hrid_to_string;
use crate::simulator::{CombatSimulator, EventTraceEntry, SimulatorOptions, UnitSpec};
use crate::unit::{CombatUnit, UnitError};
use serde::Deserialize;
use serde_json::{json, Map, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimRunRequest {
    #[serde(default)]
    options: SimulatorOptions,
    #[serde(default)]
    players: Vec<UnitSpec>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimProbeRequest {
    runs: Vec<SimRunRequest>,
}

pub(crate) fn unit_snapshot(unit: &CombatUnit) -> Value {
    let combat_buff_keys: Vec<String> = unit.combat_buffs.keys().map(|key| hrid_to_string(*key)).collect();
    let mut combat_buffs = Map::new();
    for (key, buff) in unit.combat_buffs.iter() {
        combat_buffs.insert(
            hrid_to_string(*key),
            json!({
                "uniqueHrid": buff.unique_hrid,
                "typeHrid": buff.type_hrid,
                "ratioBoost": buff.ratio_boost,
                "flatBoost": buff.flat_boost,
                "duration": buff.duration,
                "startTime": buff.start_time,
            }),
        );
    }

    let abilities: Vec<Value> = unit
        .abilities
        .iter()
        .map(|ability| match ability {
            Some(ability) => json!({ "hrid": ability.hrid, "lastUsed": ability.last_used }),
            None => Value::Null,
        })
        .collect();
    let food: Vec<Value> = unit
        .food
        .iter()
        .map(|item| match item {
            Some(item) => json!({ "hrid": item.hrid, "lastUsed": item.last_used }),
            None => Value::Null,
        })
        .collect();
    let drinks: Vec<Value> = unit
        .drinks
        .iter()
        .map(|item| match item {
            Some(item) => json!({ "hrid": item.hrid, "lastUsed": item.last_used }),
            None => Value::Null,
        })
        .collect();
    let ability_mana_costs: Vec<Value> = unit
        .ability_mana_costs
        .iter()
        .map(|(hrid, mana_cost)| json!({ "hrid": hrid, "manaCost": mana_cost }))
        .collect();

    json!({
        "hrid": unit.hrid,
        "isPlayer": unit.is_player,
        "currentHitpoints": unit.combat_details.current_hitpoints,
        "maxHitpoints": unit.combat_details.max_hitpoints,
        "currentManapoints": unit.combat_details.current_manapoints,
        "maxManapoints": unit.combat_details.max_manapoints,
        "isStunned": unit.is_stunned,
        "stunExpireTime": unit.stun_expire_time,
        "isBlinded": unit.is_blinded,
        "blindExpireTime": unit.blind_expire_time,
        "isSilenced": unit.is_silenced,
        "silenceExpireTime": unit.silence_expire_time,
        "isOutOfMana": unit.is_out_of_mana,
        "weakenExpireTime": unit.weaken_expire_time,
        "enrageTime": unit.enrage_time,
        "experience": unit.experience,
        "combatDetails": unit.combat_details,
        "combatBuffKeys": combat_buff_keys,
        "combatBuffs": combat_buffs,
        "abilities": abilities,
        "food": food,
        "drinks": drinks,
        "abilityManaCosts": ability_mana_costs,
    })
}

fn run_result(simulator: &CombatSimulator, error: Option<UnitError>) -> Value {
    let units: Vec<Value> = simulator.arena.units.iter().map(unit_snapshot).collect();
    let event_trace: Vec<&EventTraceEntry> = simulator.trace.iter().collect();
    let result_calls: Vec<Value> = simulator
        .tally
        .calls
        .iter()
        .map(|call| json!({ "method": call.method, "args": call.args }))
        .collect();

    json!({
        "simulatedTime": simulator.tally.simulated_time,
        "stoppedEarly": simulator.tally.stopped_early,
        "eventCount": simulator.event_count,
        "eventTrace": event_trace,
        "resultCalls": result_calls,
        "resultCallCount": simulator.tally.call_count,
        "units": units,
        "error": error.map(|error| json!({ "name": error.kind.name(), "message": error.message })),
    })
}

/// 回放场景 JSON，返回逐轮结果 JSON 字符串。
pub fn run_simulator_operations(request_json: &str) -> Result<String, String> {
    let request: SimProbeRequest = serde_json::from_str(request_json).map_err(|error| error.to_string())?;

    let mut results: Vec<Value> = Vec::with_capacity(request.runs.len());
    for run in request.runs {
        let mut simulator = CombatSimulator::new(run.options);
        let mut error: Option<UnitError> = None;

        for spec in &run.players {
            match simulator.add_player(spec) {
                Ok(_) => {}
                Err(unit_error) => {
                    error = Some(unit_error);
                    break;
                }
            }
        }

        if error.is_none() {
            if let Err(unit_error) = simulator.simulate() {
                error = Some(unit_error);
            }
        }

        results.push(run_result(&simulator, error));
    }

    serde_json::to_string(&json!({ "results": results })).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replays_a_minimal_scenario() {
        let request = r#"{
            "runs": [
                {
                    "options": {
                        "seed": 7,
                        "simulationTimeLimit": 5000000,
                        "traceLimit": 32,
                        "maxResultCalls": 128,
                        "zonePresent": true,
                        "encounterSpecs": [[{ "hrid": "/e/0" }]]
                    },
                    "players": [
                        {
                            "hrid": "/p/0",
                            "isPlayer": true,
                            "levels": { "staminaLevel": 50 },
                            "combatStats": [["attackInterval", 1000000]],
                            "food": [null],
                            "drinks": [null]
                        }
                    ]
                }
            ]
        }"#;
        let output = run_simulator_operations(request).expect("probe replays");
        let parsed: Value = serde_json::from_str(&output).expect("valid json");
        let run = &parsed["results"][0];
        assert!(run["eventCount"].as_u64().expect("event count") > 0);
        assert!(run["error"].is_null());
        assert!(run["eventTrace"].as_array().expect("trace array").len() > 0);
    }

    #[test]
    fn rejects_malformed_requests() {
        assert!(run_simulator_operations("not json").is_err());
    }
}
