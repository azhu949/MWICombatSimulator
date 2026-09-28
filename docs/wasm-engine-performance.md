# Rust/WASM 战斗引擎：生产路径性能对照（切片 6）

> 结论速览：**保留 JS 引擎**（全功能实现与 parity 基准），**保留 WASM 引擎**作为可选加速器。
> 在 WASM 覆盖的生产子集（真实区域 + minimal 结果）上实测约 **2.0–2.5×** 提速，
> 且结果与 JS 引擎逐字段一致；但该子集当前不覆盖食物优化器的主力轮次（候选轮次），
> 因此**尚未给最终用户带来实际提速**——它取决于后续是否扩展 WASM 的覆盖范围。

## 1. 测量方法

可复现基准：`npm run benchmark:wasm-engine`（`scripts/run-wasm-benchmark.mjs` →
`src/services/__tests__/wasmEngineBenchmark.test.js`，默认跳过，仅在基准脚本下运行）。

- 负载：**真实夹具** `src/services/__tests__/fixtures/modernPlayerJunglePlanetFixture.json` + 真实区域 `/actions/combat/jungle_planet`（tier 1）+ `minimalResult: true`（食物优化器口径）。
- 两侧每轮都重建玩家实例（与 worker 每轮装配一致）；怪物模板缓存跨轮复用（与 worker realm 一致）。
- WASM 侧计入**全部应用侧开销**：单位快照 → 请求 JSON → wasm 调用 → 结果 JSON 解析。
- 预热 1 轮不计时，取 N 轮中位数；环境变量 `WASM_BENCH_ROUNDS` / `WASM_BENCH_HOURS` / `WASM_BENCH_SEED`。
- 每轮同时校验两侧 `simResult` 键序无关地逐字段一致（不一致会直接失败，防止跑在错误分支上）。

## 2. 实测结果

| 场景                 | JS 引擎                          | WASM 引擎                        | 提速      |
| -------------------- | -------------------------------- | -------------------------------- | --------- |
| 1 小时（5 轮中位数） | 120.4 ms = 装配 0.8 + 引擎 119.5 | 54.0 ms = 快照 1.2 + 引擎 52.4   | **2.23×** |
| 4 小时（4 轮中位数） | 494.0 ms = 装配 1.0 + 引擎 492.8 | 225.5 ms = 快照 1.3 + 引擎 224.1 | **2.19×** |

多次重跑的提速区间为 **2.0×–2.5×**（同一容器/进程内的抖动区间）；1 小时场景曾在
JS 152 ms / WASM 75.7 ms（2.01×）与 JS 245 ms / WASM 100 ms（2.45×）之间波动。

要点：

- **桥接开销可忽略**：请求 JSON 约 51 KB，快照 + JSON 往返约 1.2 ms（占 WASM 总耗时 ~2%）。
  切片 4 期间"探针路径因逐事件 `json!`/String 克隆反而更慢"的教训，在生产路径上已不复现
  （生产路径只做一次请求序列化与一次结果反序列化）。
- **收益来自核心循环**：同一负载下 Rust 每模拟小时约 52 ms，JS 约 120 ms。
- **结果逐位一致**：1 小时 × 种子 101/7/2024 的 minimal `simResult` 全字段一致
  （见 `wasmEngineProductionParity.test.js`）。

## 3. WASM 覆盖范围（当前）

`wasmProductionSimulation.js` 的判定（`getProductionSupport`）决定何时可走 WASM，不满足即静默回退 JS：

| 维度                    | WASM 支持                            | 说明                                |
| ----------------------- | ------------------------------------ | ----------------------------------- |
| 结果形状                | 仅 `minimalResult`（食物优化器口径） | 完整 `SimResult` 仍走 JS            |
| 区域                    | 普通区域（非副本）                   | 副本 / 迷宫走 JS                    |
| 战斗卷轴                | 关闭                                 | 开启走 JS                           |
| 战斗日志 / HP-MP 可视化 | 关闭                                 | 开启走 JS                           |
| 公会试炼                | 否                                   | 走 JS                               |
| 优化器观察点            | 无阈值观察器 / 成本上界观察器        | 观察器改写 JS 模拟器实例，必须留 JS |
| 提前停止                | 无 `shouldStop`（空蓝 / 死亡预算）   | 依赖 JS 运行时状态，必须留 JS       |

据此，食物优化器当前的判据（`shouldUseWasmOptimizerRound`）为：
`useWasmEngine === true && candidate == null && collectThresholds === false && costBound == null`。
**候选轮次（优化器的主力负载）目前一律走 JS 引擎。**

## 4. 结论与建议

1. **JS 引擎保留**：它是唯一全功能实现（副本、迷宫、卷轴、完整结果、观察器、提前停止），
   同时是 WASM 的 parity 基准——删掉它会让 WASM 的正确性失去参照。
2. **WASM 引擎保留为可选加速器**：A/B 开关（`useWasmEngine`）**默认关**，
   引擎缺失 / 配置不支持 / 快照或运行时出错一律静默回退 JS，不会让页面不可用。
3. **尚未产生端到端提速**：优化器主力轮次落在 WASM 覆盖范围之外。若要拿到实际收益，
   建议按价值顺序扩展 WASM 路径：
   - 提前停止语义（`shouldStop`：空蓝 / 死亡预算）——解锁候选轮次；
   - 观察器数据（阈值 / 成本）由 WASM 侧记账输出——解锁阈值采集与成本剪枝；
   - 完整 `SimResult` 与副本 / 迷宫 / 卷轴支持——解锁首页模拟本体。
4. 在扩展完成前，**不建议**把 `useWasmEngine` 打开；当前子集命中率极低，
   打开只会让行为分叉（虽然结果一致）而不带来可感知收益。
