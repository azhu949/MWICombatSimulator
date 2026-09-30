# Rust/WASM combat engine

This branch ports the combat simulator engine from JavaScript to Rust + WebAssembly, slice by slice.

## Slice plan

| Slice | Scope                                                                                             | Status                                                                               |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1     | Infra: crate skeleton, wasm-pack build chain, loader with JS fallback, benchmark + parity harness | done (tag `wasm-slice-1`)                                                            |
| 2     | Event queue + RNG (exact heap-js port + bit-for-bit mulberry32 parity)                            | done (tag `wasm-slice-2`)                                                            |
| 3     | Units & stat resolution (combatUnit / equipment / buff)                                           | done (tag `wasm-slice-3`)                                                            |
| 4     | Combat main loop (abilities / triggers / all event types)                                         | done                                                                                 |
| 5     | Result aggregation + worker integration + A/B switch                                              | done                                                                                 |
| 6     | Wrap-up: performance report, decide JS engine fate                                                | done (slice 21: JS engine physically removed; see `docs/wasm-engine-performance.md`) |

## Parity probes

The engine still exports JSON "operation script → trace" probes (exact, no tolerance). Since the
JS engine was removed (slice 21B), the JS-side drivers compare against committed golden snapshots
(`src/services/__tests__/fixtures/golden/`) instead of a live JS implementation; regenerating them
requires an explicit `GOLDEN_UPDATE=1` run (`node scripts/generate-wasm-golden.mjs`):

| Export                       | Rust module      | JS driver / test                                                                |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `run_event_queue_operations` | `queue_probe.rs` | `wasmEngineParitySupport.js` / `wasmEngineParity.test.js` (slice 2)             |
| `run_unit_operations`        | `unit_probe.rs`  | `wasmCombatUnitParitySupport.js` / `wasmEngineUnitParity.test.js` (slice 3)     |
| `run_simulator_operations`   | `sim_probe.rs`   | `wasmSimulatorParitySupport.js` / `wasmEngineSimulatorParity.test.js` (slice 4) |

The probes round-trip every float through JSON, so non-finite values (NaN/±Infinity) are
normalized to `null` on both sides before deep comparison. All suites are guarded by
`describe.runIf(wasmPackageBuilt)` — they skip (stay green) when `engine/pkg` is absent.

## Commands

```bash
npm run build:wasm      # wasm-pack build engine --target web  (outputs engine/pkg, git-ignored)
npm run verify:wasm     # loads engine/pkg in Node and calls the bridge probe export
cargo test --manifest-path engine/Cargo.toml   # native Rust unit tests

npm run benchmark:wasm-engine   # wasm-only throughput benchmark (JS baseline removed with the JS engine)
```

## Merge gate per slice

1. Native Rust unit tests pass (`cargo test`)
2. Golden parity tests pass (fixed input → committed golden JSON, byte-stable)
3. Full `npm test` passes
4. The slice delivers measured benefit or unblocks the next slice
