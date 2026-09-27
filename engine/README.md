# Rust/WASM combat engine

This branch ports the combat simulator engine from JavaScript to Rust + WebAssembly, slice by slice.

## Slice plan

| Slice | Scope                                                                                             | Status                    |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| 1     | Infra: crate skeleton, wasm-pack build chain, loader with JS fallback, benchmark + parity harness | done (tag `wasm-slice-1`) |
| 2     | Event queue + RNG (exact heap-js port + bit-for-bit mulberry32 parity)                            | pending merge             |
| 3     | Units & stat resolution (combatUnit / equipment / buff)                                           | pending                   |
| 4     | Combat main loop (abilities / triggers / all event types)                                         | pending                   |
| 5     | Result aggregation + worker integration + A/B switch                                              | pending                   |
| 6     | Wrap-up: performance report, decide JS engine fate                                                | pending                   |

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
