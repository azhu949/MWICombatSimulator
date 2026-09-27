//! 事件队列操作回放探针：把 JS 侧 parity 测试生成的操作脚本喂给 Rust 事件队列，
//! 输出可逐项比较的轨迹（JSON）。由 `src/services/__tests__/wasmEngineParity.test.js`
//! 驱动，并与真实 JS EventQueue 在同一脚本下的轨迹做**精确对账**。
//!
//! 操作脚本形如：
//! ```json
//! [
//!   {"op":"push","id":1,"type":"autoAttack","time":1200,"source":10,"target":20,"hrid":"h1"},
//!   {"op":"pop"},
//!   {"op":"containsTypesAndSource","types":["autoAttack"],"source":10}
//! ]
//! ```
//! 轨迹形如 `[{"op":"pop","id":1},{"op":"containsTypesAndSource","value":true}]`。

use crate::event_queue::{EventQueue, QueueItem};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum QueueOp {
    Push {
        id: u64,
        #[serde(rename = "type")]
        event_type: String,
        time: f64,
        #[serde(default)]
        source: Option<u64>,
        #[serde(default)]
        target: Option<u64>,
        #[serde(default)]
        hrid: Option<String>,
    },
    Pop,
    Peek,
    ContainsType {
        #[serde(rename = "type")]
        event_type: String,
    },
    ContainsTypeAndHrid {
        #[serde(rename = "type")]
        event_type: String,
        hrid: String,
    },
    ContainsTypesAndSource {
        types: Vec<String>,
        source: u64,
    },
    ClearByType {
        #[serde(rename = "type")]
        event_type: String,
    },
    ClearEventsForUnit {
        unit: u64,
    },
    GetMatchingByType {
        #[serde(rename = "type")]
        event_type: String,
    },
    Clear,
}

struct ProbeEvent {
    id: u64,
    event_type: String,
    time: f64,
    source: Option<u64>,
    target: Option<u64>,
    hrid: Option<String>,
}

impl QueueItem for ProbeEvent {
    fn time(&self) -> f64 {
        self.time
    }
    fn id(&self) -> u64 {
        self.id
    }
    fn event_type(&self) -> &str {
        &self.event_type
    }
    fn source(&self) -> Option<u64> {
        self.source
    }
    fn target(&self) -> Option<u64> {
        self.target
    }
    fn hrid(&self) -> Option<&str> {
        self.hrid.as_deref()
    }
}

/// 回放操作脚本，返回轨迹 JSON 字符串。错误（如脚本无法解析）以 Err 返回。
pub fn run_event_queue_operations(ops_json: &str) -> Result<String, String> {
    let ops: Vec<QueueOp> = serde_json::from_str(ops_json).map_err(|error| error.to_string())?;
    let mut queue: EventQueue<ProbeEvent> = EventQueue::new();
    let mut trace: Vec<Value> = Vec::with_capacity(ops.len());

    for op in ops {
        match op {
            QueueOp::Push {
                id,
                event_type,
                time,
                source,
                target,
                hrid,
            } => {
                queue.add_event(ProbeEvent {
                    id,
                    event_type,
                    time,
                    source,
                    target,
                    hrid,
                });
            }
            QueueOp::Pop => {
                let id = queue.get_next_event().map(|event| event.id);
                trace.push(json!({ "op": "pop", "id": id }));
            }
            QueueOp::Peek => {
                let id = queue.peek_next_event().map(|event| event.id);
                trace.push(json!({ "op": "peek", "id": id }));
            }
            QueueOp::ContainsType { event_type } => {
                trace.push(json!({
                    "op": "containsType",
                    "value": queue.contains_event_of_type(&event_type),
                }));
            }
            QueueOp::ContainsTypeAndHrid { event_type, hrid } => {
                trace.push(json!({
                    "op": "containsTypeAndHrid",
                    "value": queue.contains_event_of_type_and_hrid(&event_type, &hrid),
                }));
            }
            QueueOp::ContainsTypesAndSource { types, source } => {
                let type_refs: Vec<&str> = types.iter().map(String::as_str).collect();
                trace.push(json!({
                    "op": "containsTypesAndSource",
                    "value": queue.contains_event_of_types_and_source(&type_refs, source),
                }));
            }
            QueueOp::ClearByType { event_type } => {
                queue.clear_events_of_type(&event_type);
                // JS 包装方法不返回结果（undefined）；轨迹记录 null 以保持两侧 schema 对齐。
                trace.push(json!({ "op": "clearByType", "value": null }));
            }
            QueueOp::ClearEventsForUnit { unit } => {
                queue.clear_events_for_unit(unit);
                trace.push(json!({ "op": "clearEventsForUnit", "value": null }));
            }
            QueueOp::GetMatchingByType { event_type } => {
                let id = queue
                    .get_matching(|event| event.event_type() == event_type)
                    .map(|event| event.id);
                trace.push(json!({ "op": "getMatchingByType", "id": id }));
            }
            QueueOp::Clear => {
                queue.clear();
                trace.push(json!({ "op": "clear" }));
            }
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
            {"op":"push","id":1,"type":"a","time":2000},
            {"op":"push","id":2,"type":"b","time":1000,"source":7},
            {"op":"peek"},
            {"op":"pop"},
            {"op":"containsType","type":"a"},
            {"op":"containsTypesAndSource","types":["b"],"source":7},
            {"op":"getMatchingByType","type":"a"},
            {"op":"clearByType","type":"a"},
            {"op":"pop"},
            {"op":"peek"}
        ]"#;
        let trace: Value = serde_json::from_str(&run_event_queue_operations(script).expect("script replays"))
            .expect("trace is valid json");
        assert_eq!(
            trace,
            json!([
                {"op":"peek","id":2},
                {"op":"pop","id":2},
                {"op":"containsType","value":true},
                {"op":"containsTypesAndSource","value":false},
                {"op":"getMatchingByType","id":1},
                {"op":"clearByType","value":null},
                // clearByType 已清掉 id1，队列为空
                {"op":"pop","id":null},
                {"op":"peek","id":null}
            ])
        );
    }

    #[test]
    fn rejects_malformed_scripts() {
        assert!(run_event_queue_operations("not json").is_err());
        assert!(run_event_queue_operations(r#"[{"op":"unknownOp"}]"#).is_err());
    }
}
