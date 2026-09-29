# Rust/WASM 战斗引擎：生产路径性能对照（切片 6）

> 结论速览：**保留 JS 引擎**（全功能实现与 parity 基准），**保留 WASM 引擎**作为可选加速器。
> 在 WASM 覆盖的生产子集（真实区域 + minimal 结果）上实测约 **2.0–2.5×** 提速，
> 且结果与 JS 引擎逐字段一致；但该子集当前不覆盖食物优化器的主力轮次（候选轮次），
> 因此**尚未给最终用户带来实际提速**——它取决于后续是否扩展 WASM 的覆盖范围。
>
> 横向对比（2026-09-28 实测）：第三方 Rust 引擎 **mwi-fastsim** 的 WASM 吞吐约为本引擎的 **6–9 倍**
> （同机、事件/秒口径）；差距来源、构建参数实验与可借鉴项见第 5 节。
>
> 切片 7–9（2026-09-28/29）：prof 定位 + 三批**保语义**优化后，
> **WASM 引擎 1h 43.2–49.3 ms → 24–27 ms、4h 223.7 ms → 82.6–86.9 ms（≈2.6×）**，
> JS/WASM 提速比由 2.09–2.57× 升到 **3.6–3.7×**；期间一次 `Rc<Ability>` 试验经
> 背靠背 A/B 否决（原生更快、WASM 更慢）。方法与读数见第 6–8 节。

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

> 2026-09-28 复测（同机同脚本）：1h 场景 JS 引擎 98.8–122.7 ms、WASM 引擎 43.2–49.3 ms
> （提速 **2.09×–2.57×**）；4h 场景 JS 引擎 428.3 ms、WASM 引擎 223.7 ms。与上表口径一致；
> 同次复测的事件数：1h = 5,486、4h = 21,950（本引擎吞吐 ≈0.10–0.12M 事件/秒）。

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

## 5. 横向对比：mwi-fastsim（第三方 Rust 引擎）

第三方项目 [wow121/mwi-fastsim](https://github.com/wow121/mwi-fastsim)：Rust 重写的战斗引擎，
提供两种形态——本机原生服务（JSON-lines 多线程）与浏览器 WASM（每核一个 Web Worker）。
其 README 自称"单线程约为原版 JS 引擎的 12 倍（WebAssembly 约 7 倍），并且多线程并行"。
本节是 2026-09-28 在本机（AMD Ryzen 7 8845H，8 核 / 16 线程）做的实测复核与差距归因，
供后续提速决策参考。

### 5.1 实测数据

对方（仓库自带内置游戏数据 `web/public/data/gamedata.json` + `node/make-sample-team.mjs`
示例三法师队；8 个区域、tier 0–2，跑其自带 `node wasm-check.mjs` / 自写 `bench2.mjs`）：

| 引擎           | 场景            | 平均事件数 | 平均耗时 | 吞吐               |
| -------------- | --------------- | ---------- | -------- | ------------------ |
| 原生（1 线程） | 8 区域 × 2 小时 | 14,252     | 13.5 ms  | **≈1.06M 事件/秒** |
| 原生（1 线程） | 8 区域 × 4 小时 | 28,457     | 23.9 ms  | **≈1.19M 事件/秒** |
| WASM           | 8 区域 × 2 小时 | 14,252     | 20.4 ms  | **≈0.70M 事件/秒** |
| WASM           | 8 区域 × 4 小时 | 28,457     | 32.3 ms  | **≈0.88M 事件/秒** |

我方（同机、同一夹具 `jungle_planet` tier 1、单人、种子 101；一次性脚本，测完已删）：

| 引擎      | 1 小时（5,486 事件）  | 4 小时（21,950 事件） | 吞吐                |
| --------- | --------------------- | --------------------- | ------------------- |
| JS 引擎   | 98.8–122.7 ms（引擎） | 428.3 ms              | ≈0.03–0.06M 事件/秒 |
| WASM 引擎 | 43.2–49.3 ms（引擎）  | 223.7 ms              | ≈0.10–0.12M 事件/秒 |

结论：

- **对方的 WASM 引擎吞吐 ≈ 本引擎的 6–9 倍；对方原生 ≈ 本引擎的 9–12 倍**；
  对方原生/WASM 比值 ≈1.35–1.5，与其"12× vs 7×"（≈1.7）的数量级吻合。
- 本报告第 2 节的 **2.0–2.5×** 与上面的数字不矛盾：前者是"我们的 JS → 我们的 WASM"的
  相对提速；对方是**每事件成本低一个数量级的另一个引擎**，不是把我们的引擎调到更快。
- 口径说明：两侧事件计数含义一致（引擎处理的事件数），但负载不同（对方三法师队伍与
  多区域混合，我方单人夹具），吞吐比较按量级理解（±20% 量级）。

复现要点（对方仓库 `node/` 目录）：`npm install`；`node make-sample-team.mjs`；
将 `web/public/data/gamedata.json` 复制为 `node/data/envelope.json`（免游戏同步）；
`cd engine` 依次 `cargo build --release` 与
`cargo build --profile wasm --target wasm32-unknown-unknown --lib`；再跑 `node wasm-check.mjs 8`。
本次实测使用项目外的参考克隆 `D:\workspace\2026\mwi\_refs\mwi-fastsim`（可随时删除/重建）。

### 5.2 差距来源（代码级）

| 维度            | 本引擎（切片 1–6）                                                                   | mwi-fastsim                                                  | 与 parity 的关系                              |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------- |
| 事件字段        | `String`（hrid / buff key / combat style）；结算里 `unit_hrid()` 每次返回新 `String` | 字符串驻留为 u32（`Interner` + 前缀位掩码），热路径零字符串  | 无关，可直接改                                |
| 有序容器        | `OrderedMap` = 线性扫描 `Vec`（O(n) 字符串比较）                                     | `FxIndexMap`（插入序 + FxHash）与 `SmallVec`                 | 无关，可直接改                                |
| 事件队列        | 逐行复刻 heap-js：`clear_matching` 快照 + 线性查找 + 身份删除（O(n²)/次清场）        | `Vec` 有序插入 + `retain`，`(time, seq)` 全序                | **改它 = 放弃 heap-js 平局顺序（动 parity）** |
| 技能/触发器定义 | 每请求从 spec 重建                                                                   | `Rc<AbilityDef>` / `Rc<Vec<Trigger>>` 按 (hrid, level) 缓存  | 无关，可直接改                                |
| 构建参数        | `lto=true`；无 `codegen-units=1`；wasm-opt 关闭                                      | `lto="fat"`、`codegen-units=1`、wasm profile `panic="abort"` | 无关                                          |
| 运行形态        | 浏览器 WASM（wasm-bindgen 胶水，924 KB）                                             | 原生多线程服务 / 手写 C-ABI WASM（486 KB，零 import）        | 架构选择                                      |
| 并行            | `multiWorker.js` 可按核数扇出（all-zones / 迷宫）；优化器候选轮次单 Worker           | 浏览器每核一个 Worker；原生按核数开线程                      | 编排层                                        |
| 覆盖            | 仅 minimal 结果；副本/迷宫/卷轴/完整结果走 JS                                        | 全功能覆盖                                                   | 切片推进中                                    |

**构建参数实验**（本机，临时加 `codegen-units = 1` → 重建 WASM → 跑基准，已还原）：
WASM 引擎 47.0–49.3 ms → 43.2–46.6 ms（**约 -5%～-10%**），JS 侧不变。属"速赢"级别，
不足以解释数量级差距——**大头在每事件的工作量与数据结构**。

### 5.3 可行动项（按风险/收益排序）

1. **速赢（不动语义）**：启用 `codegen-units = 1`；尝试通过镜像 / 离线方式打开 wasm-opt
   （`engine/Cargo.toml` 中 `wasm-opt=false` 的原因见切片 1）。预计单位数到十位数百分比。
2. **保语义热路径（建议先加 prof 再动手）**：加一个默认关闭的 `prof` 计时开关（参考对方
   48 行的 `prof.rs`），先测出真实热点，再按序推进：事件/增益 hrid → u32 驻留 id；
   `OrderedMap` → FxIndexMap（同为插入序语义）；消除 `unit_hrid()` 的每调用分配；小容器 `SmallVec`。
3. **队列保语义提速**：维护 `id → 堆下标` 侧表，把 `remove_by_id` / `clear_matching` 的
   线性查找降为 O(1)——操作序列与 heap-js 同构，**parity 不破**（需 prof 定量后决定优先级）。
4. **并行化**：把优化器候选轮次扇出到多 Worker（`multiWorker.js` 基建已有），墙钟收益 ~N×。
5. **放宽 parity 契约**（换队列、改浮点求和顺序等）：收益最大，但要接受"Rust 与 JS 不再逐位
   一致"的口径代价，需要单独的产品/工程决策，不可与其他优化混为一谈。

### 5.4 未验证点 / 风险提示

- 对方"同一随机种子下结果与原版一致"**仅为自述**：仓库内只有 wasm↔native 自洽对账与
  RNG/pow 的位级对账（`check-prims.mjs`），没有对"原版 JS 引擎"的自动化逐位对账。
- 对方把事件队列换成 `(time, seq)` 全序实现，注释声称"与原始二叉堆弹出顺序一致"——
  与本项目切片 2 的结论（heap-js 平局顺序依赖内部布局，必须逐行复刻）相抵触。
  **这正是"放宽 parity 契约"的一个实例**：他们可以这样换，因为他们不承担与本项目 JS
  引擎的逐位一致义务。
- 复核使用对方仓库自己的 fixture、示例队伍与内置数据（`v1.0.28`），与本项目夹具不同；
  数字用于量级判断，不作为逐项对账依据。

## 6. 切片 7：prof 定位 + 首批保语义提速（2026-09-28）

### 6.1 方法：可关闭的分段计时

- 新增 `engine/src/prof.rs`：`#[cfg(feature = "prof")]` 下用 `thread_local` 累加各分段耗时。
  **feature 关闭时**（默认，也是 WASM 生产构建的状态）`prof::start()` 是零大小 Guard，
  调用点会被优化器整条消除——插桩常驻代码但零开销。
- 原生入口 `engine/examples/production_profile.rs`：
  `cargo run --release --features prof --example production_profile -- <request.json> [rounds] [warmup]`
  （已构建时直接跑 `engine\target\release\examples\production_profile.exe`）。
- 限制：`Instant` 在 `wasm32-unknown-unknown` 不可用，**prof 只能在原生构建使用**；
  分段天然嵌套（父段包含子段，**跨层不可相加，同层可相加**）。
- 负载与生产基准同源：基准测试用 `WASM_BENCH_DUMP=<path>` 环境变量导出 1 小时请求 JSON，
  内容为 `jungle_planet` tier 1、单人夹具、种子 101、5,486 事件。
- 读数方式：同一行（同一分段）跨版本对比 ns/次；原生 prof 构建自带插桩开销
  （每次进入分段一次 `Instant::now()`），故**绝对值偏高、段间增量被稀释**，
  端到端收益以 6.4 的 WASM 基准为准。

### 6.2 热点读数（1h 场景，单位为「每次调用」，括号内为该版本中位数）

| 分段                       | 第一批前（10 轮，38.8–42.1 ms） | 第一批后（20 轮，32.2 ms） | 本批后（20 轮，29.6 ms） |
| -------------------------- | ------------------------------- | -------------------------- | ------------------------ |
| `simulate(total)`（ms/轮） | 38.8–42.1                       | 30.4                       | 28.8                     |
| `unit.index_buffs`         | ≈2,200 ns                       | 996 ns                     | 981 ns                   |
| `unit.update_details`      | ≈3,800 ns                       | 1,793 ns                   | 1,846 ns                 |
| `unit.add_buff`            | 7,800 ns                        | 5,073 ns                   | 4,573 ns                 |
| `attack.schedule`          | 950–1,225 ns                    | 993 ns                     | 620 ns                   |
| `ability.try_use`          | （未细分）                      | 5,802 ns                   | 4,804 ns                 |
| `event.abilityCastEnd`     | ≈6,700 ns                       | 6,429 ns                   | 5,495 ns                 |
| `event.enemyRespawn`       | 38,393 ns                       | 27,865 ns                  | 30,063 ns                |
| `encounter.instantiate`    | 35,597 ns                       | 17,178 ns                  | 20,788 ns                |
| `unit.build_from_spec`     | ≈6,000 ns                       | 4,126 ns                   | 5,219 ns                 |
| `triggers.check`           | ≈2,400 ns                       | 563 ns                     | 618 ns                   |

读数要点：

- 每轮约 2,546 次 `unit.update_details`，其中 `unit.index_buffs` 一度占 2.2 µs/次——
  它把单位每个增益**深拷贝**（每个 `Buff` 约 9 个字段含 3 个 `String`）进结算索引。
- `event.abilityCastEnd` 是最大事件类型（2,462 次/轮）：其内部 `ability.try_use` 中，
  `ability.damage`（1.5 µs/次）与 `ability.effect.buff`（15.7 µs/次）之外仍有约 2 µs/次
  未被分段覆盖——主要是**每次施放深拷贝一份 `Ability`**（含效果数组与触发器）。
- `event.enemyRespawn` 每轮 242 次、单次约 30 µs：其内部 `encounter.instantiate`
  逐个 `unit.build_from_spec` 重建怪物。
- 桥接与序列化不是瓶颈：`prod.parse` ≈0.25 ms/轮、`prod.output` ≈0.04 ms/轮。

### 6.3 本批改动（全部保 parity）

1. `unit.rs` `BuffBoostEntry.buffs`：`Vec<Buff>` → `Vec<BuffBoost>`——索引只消费
   ratio/flat 投影，不再深拷贝每个 `Buff`；`snapshot_boosts` 改为返回**借用切片**，
   每次结算的十余次 `typeHrid` 查询零分配。
2. `unit.rs` 新增 `reconcile_buff_source_live`：`addBuff` / `removeBuff` / 过期清理不再
   深拷贝整张 `buff_sources` 源表（原实现每注册一次增益就克隆所有源条目与活动 Buff）。
3. `simulator.rs` `try_use_ability`：`todo_abilities: Vec<Ability>` → 「owned 主技能 +
   可选 blaze/bloom」引用链，去掉每次施放的第二次 `Ability` 深拷贝；遍历顺序、元素身份与
   RNG 消费顺序与原实现逐个一致。
4. `simulator.rs` `add_next_attack_event` / `can_use_ability`：可施放判定不再深拷贝
   `Ability`（`can_use_ability` 改为接收 `mana_cost: f64`）。
5. 构建与工具链：`engine/Cargo.toml` 新增 `[features] prof`（默认关）并保留
   `codegen-units = 1`；新增 `engine/src/prof.rs` 与 `engine/examples/production_profile.rs`；
   基准测试支持 `WASM_BENCH_DUMP` 导出 profiling 请求 JSON。

### 6.4 实测收益（本机，AMD Ryzen 7 8845H）

- **WASM 端到端（`npm run benchmark:wasm-engine`，1h，7 轮中位数，两次取样）**：
  引擎 43.2–49.3 ms → **22.7–25.3 ms**（≈1.8–2.0×）。
- JS 侧不变（102.9–109.1 ms，符合预期：改动只落在 Rust 侧）。
- **JS/WASM 提速比：2.09–2.57× → 4.15–4.39×**；两侧 `simResult` 仍逐字段一致
  （基准测试自带对账，不一致直接失败）。
- 为什么 WASM 侧收益远大于原生 prof 的 ms/轮 变化：本批消除的是**每轮数十万次小对象分配**
  （结算路径 2,546 次/轮 × 约 10 个增益 × 每个 `Buff` 3 个 `String`），
  而 WASM 侧分配器比原生更贵、字符串拷贝更慢。
- parity 未破：`cargo test` 102 passed；5 个 parity 套件 17 passed（含生产 parity 多种子）。

### 6.5 剩余热点与下一批候选（按 prof 读数排序）

1. `ability.try_use` 仍约 11.8 ms/轮（≈40%）：残余为每次施放的第一次 `Ability` 深拷贝
   （`Rc<Ability>` 方案已在切片 8 试做并经 A/B **否决**，见 7.2）与 `ability.effect.buff`（15.7 µs/次）。
2. `event.enemyRespawn` ≈7.3 ms/轮：`encounter.instantiate`（5.05）中的
   `unit.build_from_spec`（3.7）——新增的 `unit.spec_apply` / `unit.spec_loadout` 分段可
   继续细分；模板查找仍是 `encounter_templates` 线性扫描，可按 `(hrid, difficultyTier)` 建索引。
3. `unit.update_details_full` ≈0.9 µs/次：约 40 次 `OrderedMap` 线性查找可改「快照单遍分派」。
4. 队列 `clear_matching` / `remove_by_id` 仍是 O(n²)/O(n)：`id → 堆下标` 侧表可降到 O(1)，
   操作序列与 heap-js 同构、parity 不破（第 5.3 节第 3 条的定量版本）。
5. `unit_hrid()` 每次返回新 `String`（15,925 次/轮）：改返回 `&str` 或 u32 驻留 id。
6. `wasm-opt` 仍关闭（binaryen 下载受阻）；后续可尝试镜像或预置二进制。

## 7. 切片 8：第二批去克隆优化与一次被否决的试验（2026-09-28）

### 7.1 本批改动（全部保 parity）

1. `simulator.rs` `add_next_attack_event`：不再克隆 players/enemies 两个 `Vec`
   （原实现连同派生的 friendlies/enemiesArg 每次共 6 次克隆），改为对 `self.players` /
   `self.enemies` 的只读切片视图；`first_alive_in` 改收 `Option<&[UnitId]>`。
   顺序、内容与 `is_none` 判定与原实现逐个一致。
2. `simulator.rs` `check_triggers` / `check_triggers_for_unit`：每次调用原先克隆 6 个 `Vec`
   （players×3 / enemies×3，调用量约 5.7k 次/轮 ⇒ 约 3.4 万次分配/轮）。改为下标遍历 +
   `is_player` 标记 + 内部按需借用切片；传入 `should_trigger` 的友方/敌方列表与顺序不变。

### 7.2 被 A/B 否决的试验：`Rc<Ability>`

动机：`try_use_ability` 每次施放都要深拷贝一份 `Ability`（效果数组 + 触发器 + 多个 `String`）。
试验把 `CombatUnit.abilities` 改为 `Vec<Option<Rc<Ability>>>`（构建期 `Rc::new(clone)`，
`last_used` 写回走 `Rc::make_mut`，并把写回点安排在快照释放之后以保持引用计数为 1）。

结果（**背靠背交换 `engine/pkg` 复测**，15 轮中位数，同机同会话）：

| 口径          | 原生 prof（1h）      | WASM 1h 引擎             |
| ------------- | -------------------- | ------------------------ |
| 试验前        | 29.6 ms/轮（中位数） | 25.0–25.9 ms             |
| `Rc<Ability>` | 26.2 ms/轮（-11%）   | 26.3–34.5 ms（+5%～15%） |

**结论：原生更快、WASM 反而更慢 → 弃用**（代码已回退，仅在 `unit.rs` 留注释记录）。
教训：`wasm32` 对「多一层指针追逐 + 每单位多若干次堆分配」的惩罚远大于原生；
**原生 prof 只用来定位热点占比，任何改动能否落地必须由 WASM 端到端基准裁决**。
（这一条与切片 7 的相反案例共同说明：原生 prof 会**低估**去分配类优化的收益、
也会**高估**加间接层类优化的收益。）

### 7.3 累计实测（`npm run benchmark:wasm-engine`，同机 AMD Ryzen 7 8845H）

| 场景 | 引擎 | 优化前（切片 6） | 现在         | 变化                   |
| ---- | ---- | ---------------- | ------------ | ---------------------- |
| 1h   | JS   | 98.8–122.7 ms    | 86–113 ms    | 未改动（机器状态波动） |
| 1h   | WASM | 43.2–49.3 ms     | 24.1–27.3 ms | **≈1.8×**              |
| 4h   | WASM | 223.7 ms         | **96.1 ms**  | **≈2.3×**              |

> 4h 是最稳的口径（单轮约 0.1 s，负载尖峰影响小）：WASM 96.1 ms 与同版本原生 prof 的
> 4h 中位数 95.6 ms/轮吻合。同次 JS 4h 为 355.4 ms（与切片 6 的 428.3 ms 之差来自机器状态：
> 该时段 JS 侧整体快约 17%；按此归一后 WASM 的净提速仍约 **1.9×**）。

### 7.4 仍未解决的（下一批候选，按 4h prof 读数排序）

1. `ability.try_use` 4,047 ns/次（7.8 万次/4h）：每次施放的 `Ability` 深拷贝仍在。
   继续攻它需要一个**不引入指针追逐**的方案（例如「按槽位索引 + 分步归还借用」的效果处理重构，
   让效果循环直接借用 arena 中的技能，而不是先克隆一份）。
2. `unit.update_details` 1,547 ns/次（其中 `index_buffs` 858 ns）：结算索引每轮次重建；
   可考虑单位内复用缓冲（`#[serde(skip)]` 暂存区）或小容器化。
3. `event.enemyRespawn` 22.0 µs/次、`encounter.instantiate` 15.7 µs/次、
   `unit.build_from_spec` 3.9 µs/次（其中 `spec_loadout` 1.8 µs = 技能/消耗品深拷贝）。
   注意：本批已证明「技能定义 Rc 化」在 WASM 端得不偿失，若继续需换思路（如按模板缓存已构建的单位代价）。
4. 队列 `clear_matching` / `remove_by_id` 仍是 O(n²)/O(n)：`id → 堆下标` 侧表可降为 O(1)，parity 不破。
5. `unit_hrid()` 每次返回新 `String`（1.6 万次/轮）：可逐点改为直接借用 `self.arena.get(id).hrid`。
6. `wasm-opt` 仍关闭；尝试镜像/预置 binaryen 可再拿单位数到十位数百分比。

## 8. 切片 9：增益生命周期免 String 分配（2026-09-29）

### 8.1 本批改动（全部保 parity）

1. `ordered_map.rs`：新增 `get_mut_str` / `delete_str` / `set_str`（str 键版本的可变查询、
   删除、写入；键已存在时零 `String` 分配，语义与 `set`/`delete` 完全一致）。
2. `unit.rs` 增益生命周期（addBuff / removeBuff / 过期清理 / reconcile 共 5 个方法，
   约 20 处调用点）：`unique_hrid.to_string()` 传键改为 `delete_str`/`set_str`/`get_mut_str`，
   消除该路径每次增益增删/过期处理的一批临时 `String` 分配。
3. `simulator.rs` `process_event`：`CheckBuffExpiration` 事件不再 `clone` 其
   `buff_unique_hrid`（事件本身拥有该 String，按值解构后以 `&str` 传递）。

### 8.2 试过并搁置：`unit_hrid()` 返回 `&str`

把 `unit_hrid` 改成返回借用后，与其交错的约 30 处调用点全部报借用冲突（hrid 的取用与
`tally` 记账 / `arena.get_mut` 深度交错、频率分布很平、无单点热点）。收益约 2–4%，
改动面与风险不成比例——留注释并归入下一批，与「效果循环直借 arena 技能」的更大重构一起做。

### 8.3 实测（`npm run benchmark:wasm-engine`，同机）

- 4h 稳态三轮：WASM 引擎 82.6–86.9 ms（提速比 3.61–3.71×），与切片 8 的 96.1 ms /
  3.70× 相比**在噪声内小幅偏好**；本批改动集中在增益生命周期路径（每轮数千次调用），
  单点收益小但确定性为正。
- 1h 最好 24.9 ms，与切片 8 持平。
- 验收：cargo test 102 passed；parity 17 passed；npm test 2636 passed + prettier；
  build + verify-pages-build 通过。
