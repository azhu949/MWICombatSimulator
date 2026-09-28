//! 生产模拟入口（切片 5）：把「玩家 spec + 真实区域数据 + 怪物模板」交给 Rust
//! `CombatSimulator` 跑一轮，返回**真实聚合**的 simResult JSON。
//!
//! 与切片 4 的 `sim_probe.rs` 的区别：
//! - 不要事件流水/调用流水，只要 `simResult`（JS `SimResult` / `FoodOptimizerSimResult` 形状）；
//! - 敌人由真实 `Zone` 按种子生成（`zoneMonsterSpawnInfo`），模板按 `(hrid, difficultyTier)` 查表实例化；
//! - 支持边界（不满足时返回 `error`，由 JS 侧回退）见 `CombatSimulator::validate_production_support`。
//!
//! 请求形如：
//! ```json
//! {
//!   "options": {
//!     "seed": 101, "simulationTimeLimit": 3600000000000,
//!     "realResult": true, "minimalResult": true,
//!     "zonePresent": true, "zoneHrid": "/actions/combat/jungle_planet", "zoneDifficultyTier": 1,
//!     "zoneMonsterSpawnInfo": { ... }, "zoneDungeonSpawnInfo": null,
//!     "encounterTemplates": [ { "hrid": "/monsters/treant", "difficultyTier": 1, "spec": { ... } } ],
//!     "logCombatEvents": false, "enableHpMpVisualization": false, "combatScrollsEnabled": false
//!   },
//!   "players": [ { "hrid": "/players/0", "isPlayer": true, ... } ]
//! }
//! ```
//! 返回 `{"simResult": {...}, "error": null}`；出错时 `simResult` 为已聚合到的状态。

use crate::simulator::{CombatSimulator, SimulatorOptions, UnitSpec};
use crate::unit::UnitError;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductionRequest {
    #[serde(default)]
    options: SimulatorOptions,
    #[serde(default)]
    players: Vec<UnitSpec>,
}

/// 跑一轮生产模拟，返回 `{ simResult, error }` JSON 字符串。
pub fn run_production_simulation(request_json: &str) -> Result<String, String> {
    let request: ProductionRequest = serde_json::from_str(request_json).map_err(|error| error.to_string())?;
    let mut simulator = CombatSimulator::new(request.options);
    let mut error: Option<UnitError> = None;

    for spec in &request.players {
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

    let sim_result: Value = simulator
        .tally
        .real
        .as_ref()
        .map(|real| real.to_value())
        .unwrap_or(Value::Null);

    serde_json::to_string(&json!({
        "simResult": sim_result,
        "eventCount": simulator.event_count,
        // 仅在 `traceLimit > 0` 时有内容；生产 parity 对账与分歧定位用。
        "eventTrace": simulator.trace,
        "units": if simulator.trace_limit > 0 {
            simulator.arena.units.iter().map(crate::sim_probe::unit_snapshot).collect::<Vec<Value>>()
        } else {
            Vec::new()
        },
        "error": error.map(|error| json!({ "name": error.kind.name(), "message": error.message })),
    }))
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_requests() {
        assert!(run_production_simulation("not json").is_err());
    }

    #[test]
    fn reports_unsupported_configuration_as_error_field() {
        // 未提供 zoneMonsterSpawnInfo → 生产路径校验失败，但请求本身合法。
        let output = run_production_simulation(
            r#"{
                "options": { "realResult": true, "minimalResult": true },
                "players": []
            }"#,
        )
        .expect("request parses");
        let parsed: Value = serde_json::from_str(&output).expect("valid json");
        assert!(parsed["simResult"].is_null() || parsed["simResult"].is_object());
        let message = parsed["error"]["message"].as_str().unwrap_or_default();
        assert!(message.contains("requires a zone"), "unexpected error: {message}");
    }
}
