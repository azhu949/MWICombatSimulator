//! MWI combat engine — Rust/WASM port.
//!
//! Slice 1: infrastructure (crate skeleton, wasm build chain, loader, benchmark + parity harness).
//! Slice 2: event queue (exact port of the heap-js based `EventQueue`) + mulberry32 RNG
//! (bit-for-bit identical to `src/services/seededRandom.js`), with JS-vs-Rust parity probes.
//! Slice 3: combat units (exact port of `combatUnit.js` / `buff.js` / `buffSourcePolicy.js`
//! stat resolution + buff lifecycle, plus the equipment stat rule), with unit parity probes.
//! Slice 4: combat main loop (event types, ability/trigger/consumable behaviour, damage math,
//! unit arena) ported from `combatSimulator.js` / `combatUtilities.js`.

pub mod ability;
pub mod buff;
pub mod combat_utilities;
pub mod consumable;
pub mod equipment;
pub mod event_queue;
pub mod ordered_map;
pub mod prod_probe;
pub mod queue_probe;
pub mod rng;
pub mod scroll;
pub mod sim_events;
pub mod sim_probe;
pub mod sim_result;
pub mod sim_unit;
pub mod simulator;
pub mod trigger;
pub mod unit;
pub mod unit_probe;
pub mod zone;

use wasm_bindgen::prelude::*;

/// Slice-1 smoke export: proves the JS<->WASM bridge and the build chain work.
#[wasm_bindgen]
pub fn bridge_probe(a: u32, b: u32) -> String {
    format!("mwi-combat-engine 0.1.0 slice-1 probe: {}+{}={}", a, b, a + b)
}

/// Parity probe: `count` consecutive mulberry32 draws for `seed` (expect bit-for-bit
/// equality with JS `createSeededRandom(seed)` calls).
#[wasm_bindgen]
pub fn rng_probe(seed: u32, count: u32) -> Vec<f64> {
    let mut rng = rng::Mulberry32::new(seed);
    (0..count).map(|_| rng.next_f64()).collect()
}

/// Parity probe: JS `hashSeed(text)` equivalent.
#[wasm_bindgen]
pub fn hash_seed_probe(text: &str) -> u32 {
    rng::hash_seed(text)
}

/// Parity probe: JS `deriveSeedSet(baseSeed, count)` equivalent.
#[wasm_bindgen]
pub fn derive_seed_set_probe(seed: u32, count: u32) -> Vec<u32> {
    rng::derive_seed_set(seed, count)
}

/// Parity probe: replays an event-queue operation script (JSON) against the Rust queue
/// and returns the execution trace (JSON). See `queue_probe.rs` for the schema.
#[wasm_bindgen]
pub fn run_event_queue_operations(ops_json: &str) -> String {
    queue_probe::run_event_queue_operations(ops_json)
        .unwrap_or_else(|error| panic!("event queue probe failed: {error}"))
}

/// Parity probe: replays a combat-unit operation script (JSON) against the Rust `CombatUnit`
/// (stat resolution + buff lifecycle) and returns the execution trace (JSON).
/// See `unit_probe.rs` for the schema.
#[wasm_bindgen]
pub fn run_unit_operations(ops_json: &str) -> String {
    unit_probe::run_unit_operations(ops_json).unwrap_or_else(|error| panic!("unit probe failed: {error}"))
}

/// Parity probe: replays a full combat scenario (JSON) against the Rust `CombatSimulator`
/// (main loop, events, abilities, triggers, consumables) and returns per-run aggregates.
/// See `sim_probe.rs` for the schema.
#[wasm_bindgen]
pub fn run_simulator_operations(request_json: &str) -> String {
    sim_probe::run_simulator_operations(request_json)
        .unwrap_or_else(|error| panic!("simulator probe failed: {error}"))
}

/// Production entry (slice 5): runs a real zone simulation with real `SimResult`
/// aggregation and returns `{ "simResult": {...}, "error": null }`.
/// See `prod_probe.rs` for the schema and supported subset.
#[wasm_bindgen]
pub fn run_production_simulation(request_json: &str) -> String {
    prod_probe::run_production_simulation(request_json)
        .unwrap_or_else(|error| panic!("production simulation failed: {error}"))
}
