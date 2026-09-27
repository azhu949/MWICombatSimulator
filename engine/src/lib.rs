//! MWI combat engine — Rust/WASM port (slice 1: infrastructure).
//!
//! Each slice of the JS engine is ported behind a feature-flagged module so the
//! JS engine stays the reference implementation until full parity is proven.

pub mod rng;

use wasm_bindgen::prelude::*;

/// Slice-1 smoke test export: proves the JS<->WASM bridge and the build chain work.
/// Returns the engine version string plus the two numbers, summed, to verify
/// argument passing works end to end.
#[wasm_bindgen]
pub fn bridge_probe(a: u32, b: u32) -> String {
    format!("mwi-combat-engine 0.1.0 slice-1 probe: {}+{}={}", a, b, a + b)
}
