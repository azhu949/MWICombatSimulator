//! MWI combat engine — Rust/WASM port.
//!
//! Slice 1: infrastructure (crate skeleton, wasm build chain, loader, benchmark + parity harness).
//! Slice 2: event queue (exact port of the heap-js based `EventQueue`) + mulberry32 RNG
//! (bit-for-bit identical to `src/services/seededRandom.js`), with JS-vs-Rust parity probes.

pub mod event_queue;
pub mod queue_probe;
pub mod rng;

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
