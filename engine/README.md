# Rust/WASM combat engine

This branch ports the combat simulator engine from JavaScript to Rust + WebAssembly, slice by slice.

## Slice plan

| Slice | Scope                                                                                             | Status                    |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| 1     | Infra: crate skeleton, wasm-pack build chain, loader with JS fallback, benchmark + parity harness | done (tag `wasm-slice-1`) |
| 2     | Event queue + RNG (exact heap-js port + bit-for-bit mulberry32 parity)                            | done (tag `wasm-slice-2`) |
| 3     | Units & stat resolution (combatUnit / equipment / buff)                                           | pending merge             |
| 4     | Combat main loop (abilities / triggers / all event types)                                         | pending                   |
| 5     | Result aggregation + worker integration + A/B switch                                              | pending                   |
| 6     | Wrap-up: performance report, decide JS engine fate                                                | pending                   |

## Parity probes (JS-vs-Rust, exact)

Each slice exports a JSON "operation script → trace" probe that the JS test drives against the
real JS implementation and compares entry by entry (no tolerance):

| Export                       | Rust module      | JS driver / test                                                            |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `run_event_queue_operations` | `queue_probe.rs` | `wasmEngineParitySupport.js` / `wasmEngineParity.test.js` (slice 2)         |
| `run_unit_operations`        | `unit_probe.rs`  | `wasmCombatUnitParitySupport.js` / `wasmEngineUnitParity.test.js` (slice 3) |

The probes round-trip every float through JSON, so non-finite values (NaN/±Infinity) are
normalized to `null` on both sides before deep comparison. Both suites are guarded by
`describe.runIf(wasmPackageBuilt)` — they skip (stay green) when `engine/pkg` is absent.

## Commands

```bash
npm run build:wasm      # wasm-pack build engine --target web  (outputs engine/pkg, git-ignored)
npm run verify:wasm     # loads engine/pkg in Node and calls the bridge probe export
cargo test --manifest-path engine/Cargo.toml   # native Rust unit tests

npm run benchmark:combat-engine -- --workers=4 --samples=3   # JS baseline throughput
```

The fixed synthetic scenario shared by the benchmark and parity harness lives in
`src/combatsimulator/__tests__/support/syntheticCombatScenario.js`. The parity
harness test (`combatEngineParityHarness.test.js`) locks the determinism contract:
scheduled attack counts must match exactly, hit rate is compared within tolerance.

## Merge gate per slice

1. Native Rust unit tests pass (`cargo test`)
2. Parity tests pass (same fixed input, JS vs Rust aggregates within tolerance)
3. Full `npm test` passes
4. The slice delivers measured benefit or unblocks the next slice
