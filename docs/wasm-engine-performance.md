# Rust/WASM 战斗引擎：生产路径性能对照（切片 6）

> 结论速览：**保留 JS 引擎**（全功能实现与 parity 基准），**保留 WASM 引擎**作为可选加速器。
> 在 WASM 覆盖的生产子集（真实区域 + minimal 结果）上实测约 **2.0–2.5×** 提速，
> 且结果与 JS 引擎逐字段一致；但该子集当前不覆盖食物优化器的主力轮次（候选轮次），
> 因此**尚未给最终用户带来实际提速**——它取决于后续是否扩展 WASM 的覆盖范围。
>
> 横向对比（2026-09-28 实测）：第三方 Rust 引擎 **mwi-fastsim** 的 WASM 吞吐约为本引擎的 **6–9 倍**
> （同机、事件/秒口径）；差距来源、构建参数实验与可借鉴项见第 5 节。
>
> 切片 7–10（2026-09-28/29）：prof 定位 + 四批**保语义**优化后，
> **WASM 引擎 1h 43.2–49.3 ms → 24–27 ms、4h 223.7 ms → 78–97 ms（最好 77.8）**，
> JS/WASM 提速比由 2.09–2.57× 升到 **3.6–4.5×**；期间 `Rc<Ability>` 与队列侧表两个
> 试验经背靠背 A/B 否决（原生/理论更快、WASM 更慢），wasm-opt 验证可用（-12.6% 体积）。
> 方法与读数见第 6–9 节。
>
> 切片 11–15（2026-09-29）：结算单遍分派 + 施法免克隆 + wasm-opt 常态化，并把 WASM 覆盖
> 从 minimal 扩到完整 SimResult、提前停止、观察器与**副本波次**——默认优化器路径任务级
> **1.50–1.53×**（第 12 节）、首页单轮 full-result **3.20×**（第 13 节）、副本 full-result
> **2.59–2.64×**（第 14 节，4h 配对中位数）。
>
> 切片 16（2026-09-29）：**迷宫**纳入覆盖（迷宫 full-result **5.42–5.54×**，第 15 节）。
>
> 切片 17（2026-09-29）：**战斗卷轴**窗口语义纳入覆盖（卷轴 full-result **3.21–3.31×**，第 16 节）。
>
> 切片 18（2026-09-29）：**生产载荷默认点亮 wasm 引擎**并让产物进部署链
> （`public/engine/pkg` 随仓库提交 → vite 拷进 `dist`，Pages 子路径 URL 修正；
> 见第 17 节）。仍留 JS 的只有：公会试炼 / 无区域（生产不可达的预留语义）、
> 「副本 + full-result + `logCombatEvents`」组合与成本上界观察器。
>
> 切片 19（2026-09-29）：**副本团灭日志（wipeEvents）引擎生成**，「副本 + full-result +
> `logCombatEvents`」组合解除闸门——timestamp 用确定性字符串 `t+{simulationTime}`
> 替代墙钟（UI 仅用作 v-for key；见第 18 节）。仍留 JS 的只剩：成本上界观察器与
> 公会试炼 / 无区域（生产不可达的预留语义）。
>
> 切片 20（2026-09-29）：**成本上界观察器（costBound）下推**——top-10 轮内成本剪枝
> （`observeFoodOptimizerCostBound`）由 Rust 观察器承接，`shouldUseWasmOptimizerRound`
> 判据放宽为 `useWasmEngine === true`（见第 19 节）。真实路径缺口清零：仍留 JS 的只剩
> 公会试炼 / 无区域（生产不可达的预留语义）。
>
> 切片 21A（2026-09-30）：**A 层（JS 模拟执行层）零生产消费**——playerMapper 三处预览
> 换轻量 `CombatPreviewContext`、`getFoodOptimizerResources` 脱离模拟执行层、worker.js
> wasm 不可用改硬失败（审计定案 D1）、优化器轮次 wasm-only（JS 分支删除）；顺带修复
> Rust `clear_ccs` 误回滚 live 面板的 threat 归零 bug（玩家复活后单玩家威胁选靶
> TypeError）。见第 20 节。
>
> 切片 21B（2026-09-30）：**JS 引擎物理删除**——A 层 6 个生产文件 + 8 个连带测试删净
> （B 层 events/combatUnit/player/zone 与 `CombatActionsCore` 预览基类保留）；parity
> oracle 改 **golden 快照**（定案 D2：固定输入 → 固定期望 JSON，`fixtures/golden/`
> 29 件 3.56MB；行为语义防线由 cargo 128 用例承载）；`useWasmEngine` 开关清理（唯一
> 例外：`foodOptimizerSnapshot.js` 的字段进输入签名，删除会让存量缓存签名复活）；JS
> 基准/研究脚本处置（6 脚本删除，保留 `benchmark:wasm-engine`）。见第 21 节。

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

| 维度                    | WASM 支持                                                             | 说明                                                                               |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 结果形状                | ✅ 全量：`minimalResult` 与完整 `SimResult`（切片 14）                | 完整结果含经验记账 / 掉落上下文桶 / 1000-tick 时序快照 / 激怒层数                  |
| 区域                    | 普通区域 + **副本**（切片 15/19）+ **迷宫**（切片 16）                | ✅ 全支持：副本团灭日志（wipeEvents）由引擎生成（切片 19）；迷宫为无 zone 单怪循环 |
| 战斗卷轴                | ✅ 开启（切片 17）                                                    | 窗口语义 / 库存记账与 JS 逐位一致；迷宫内自动忽略（`allowed: false`）              |
| 战斗日志 / HP-MP 可视化 | ✅ 均可（切片 14）                                                    | 日志仅控制台输出；可视化无流式 progress（时序随结果一次性返回）                    |
| 公会试炼                | 否（生产不可达的预留语义）                                            | `options.isGuildTrial` 无生产传值点；接入公会试炼模拟时再评估                      |
| 优化器观察点            | 阈值/闲置观察（切片 13 `observers`）+ 成本上界（切片 20 `costBound`） | 无需留 JS（成本停止结论/下界走独立输出字段）                                       |
| 提前停止                | 空蓝 / 死亡预算（切片 12 `earlyStop`）                                | 无需留 JS                                                                          |

> 本表为切片 20 后的当前边界（迷宫细节见第 15 节、卷轴见第 16 节、默认开关与部署见第 17 节、
> 副本团灭日志见第 18 节、成本上界观察器见第 19 节）。切片 5–11 期间的历史边界
> （候选轮/阈值轮全部留 JS）见第 11 节勘误与第 12 节——彼时默认生产路径
> （`collectThresholds: reuse` 且 `reuse` 默认 true）的所有优化器轮次实际都走 JS。

据此，食物优化器当前的判据（`shouldUseWasmOptimizerRound`）为：
`useWasmEngine === true`——全部轮次放行（候选轮的 `earlyStop`、阈值/闲置 `observers`
与成本上界 `costBound` 分别由切片 12/13/20 承接；切片 18 起优化器请求快照默认带
`useWasmEngine: true`，不再依赖调用方显式开启）。

## 4. 结论与建议

1. **JS 引擎保留**：它是唯一全功能实现与 parity 基准（用户定案：最终只保留 WASM；
   真实路径缺口已随切片 20 清零，仅剩生产不可达的预留语义——删 JS 的前置就绪，
   删除动作本身待用户启动），
   删掉它会让 WASM 的正确性失去参照。
2. **WASM 引擎为默认引擎（切片 18 翻转）**：所有生产载荷默认带 `useWasmEngine: true`
   （首页单轮 / 队列场景与基线轮 / 食物优化器 / 触发器优化器 / 批量区域与迷宫扫描 /
   推荐扫描），引擎缺失 / 配置不支持 / 快照或运行时出错一律静默回退 JS，不会让页面
   不可用；显式 `false` / 缺省的 JS 路径完整保留（测试与实验载荷用）。产物随仓库
   提交（`public/engine/pkg`），CI 无 Rust 工具链也能构建出带 wasm 的部署产物。
3. **端到端提速已兑现（切片 13–20）**：观察器 WASM 化后，默认优化器路径的全部轮次
   （含 top-10 成本剪枝轮，切片 20）落在 WASM 覆盖内，任务级配对 A/B 实测 **1.50–1.53×**（第 12 节）；切片 14 起
   首页单轮全量结果（full-result + 可视化）也走 WASM，单轮引擎级配对 A/B 实测
   **3.20×**（第 13 节）；切片 15 副本波次纳入覆盖，副本 full-result 单轮实测
   **2.59–2.64×**（第 14 节）；切片 16 迷宫纳入覆盖，迷宫 full-result 单轮实测
   **5.42–5.54×**（第 15 节）；切片 17 战斗卷轴纳入覆盖，卷轴 full-result 单轮实测
   **3.21–3.31×**（第 16 节）；切片 18 生产载荷默认点亮 + 产物进部署链，线上用户
   直接用上 wasm 引擎（第 17 节）；切片 20 成本上界观察器下推后，优化器全部轮次
   （含 top-10 成本剪枝轮）落在 WASM 覆盖内（第 19 节）。后续扩展方向：仅剩
   生产不可达的预留语义（公会试炼 / 无区域），接入时再评估。
4. 打开 `useWasmEngine` 的前提（引擎已构建、配置落在覆盖表内）见第 3 节；行为分叉
   （JS/WASM 双路径）由 parity 测试兜底（第 12.3 节）。

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

## 9. 切片 10：施法路径取还式免克隆 + 一次被否决的队列侧表 + wasm-opt 验证（2026-09-29）

### 9.1 保留：`try_use_ability` 取还式（take → 处理 → restore）

原实现每次施放深拷贝一份 `Ability`（占 4h prof 的 ~35%）。改为把槽内技能 `take()` 到局部
owned 变量，效果循环结束后原样 `restore`——零克隆。安全性已逐路径核实：效果循环内
damage 目标恒为敌方列表（永不可能等于 source）、promote/revive 触新单位、parry 分支只清
队列；restore 放在 ripple 段之前（ripple 会遍历技能槽写 last_used）。`spend_ability_mana`
的 `last_used` 写入移到调用方（owned 副本上），顺带消除了该方法内的第二次技能槽查找。
A/B 多轮无可分辨差异（min 79.8 vs 80.1，互有胜负），保留理由是零克隆 + 代码更简洁。

### 9.2 否决：事件队列 `id → 堆下标` 侧表

侧表（`std::collections::HashMap<u64, usize>`）把 `remove_by_id`/`clear_matching` 的
O(n²) 查找降为 O(1)，堆操作序列与 heap-js 同构（parity 不破，全部 heap-js 基准测试通过）。
但 A/B/A 复测：**WASM 端到端反而慢 ~4%**（100.0 vs 95.9 ms，A/A 自检一致）。
原因：本负载的堆很小（队列长度通常 < 50），线性扫描缓存友好；而每次 sift 交换要维护
2 次 SipHash 插入/删除，在 WASM 上开销更高——与切片 8 的 `Rc<Ability>` 教训同族
（**WASM 惩罚间接层，小集合上“更优”的数据结构反而更慢**）。已回退。

### 9.3 wasm-opt 验证成功（可启用，待决定）

npmmirror 的 `binaryen@121` npm 包自带可用的 `wasm-opt`（`node_modules/binaryen/bin/wasm-opt`
是 Node 脚本入口，用 `node bin/wasm-opt` 调用）。对当前包 `-O4`：

- 体积 838.9 KB → 733.4 KB（**-12.6%**），parity 17/17 全过，4h 基准最好 77.8 ms（历史最快）；
  热节流下的 A/B 无可分辨差异（无回退）。
- 启用需在 `devDependencies` 加 `binaryen`（约 10 MB）并给 `build:wasm` 加一步
  `node node_modules/binaryen/bin/wasm-opt <pkg>.wasm -O4 -o <pkg>.wasm`。
  **是否把它写进构建脚本待定**（涉包体积与 CI 稳定性权衡，本切片只记录方法与验证结果）。
  → **切片 11 已启用并写进 `build:wasm`，见第 10 节。**

### 9.4 实测与验收

- 4h WASM 引擎（无 wasm-opt，取还式）：A/B 多轮 79.8–97 ms，与切片 9 的 82.6–96.9 ms
  在噪声内持平；机器热节流当日读数漂移明显（同配置 JS 4h 在 296–711 ms 间波动），
  结论以 A/B 配对比较为准。
- 验收：cargo test 102 passed；parity 17 passed；npm test 2636 passed + prettier；
  build:wasm 正常。

### 9.5 剩余候选（更新）

1. `update_details` / `index_buffs`（0.86–1.5 µs/次 × 8.2 万次/4h）：结算索引每轮重建，
   可做单位内复用缓冲。
2. `enemyRespawn` / `instantiate` / `build_from_spec`（22 / 15.7 / 3.9 µs/次）：
   按模板缓存已构建单位（注意：会改 RNG 消费时点，须 parity 验证）。
3. wasm-opt 启用与否（见 9.3）。
4. WASM 覆盖范围扩展（提前停止 / 观察器 / 完整 SimResult）——解锁主页端到端收益的主线。

## 10. 切片 11：结算单遍分派 + 施法目标免克隆 + wasm-opt 常态化（2026-09-29）

### 10.1 本批改动（全部保 parity）

1. **`SettlementBoosts` 单遍分派（unit.rs）**：退役 `index_buffs_by_type` /
   `BuffBoostEntry` / `BuffBoostIndex` / `snapshot_boost(s)` 旧链路。新方案单遍遍历
   `combat_buffs`，`slot_mut(&type_hrid)` match 直分派到固定槽位：
   - 12 个**逐项槽**（`Vec<BuffBoost>` 保序）：7 等级字段 + evasion + armor + 三系抗性
     ——消费端逐项循环，浮点累加序不可合并；
   - 28 个**汇总槽**（`BuffBoost`）：消费端只读 ratio/flat 总和，从 `0.0` 起按序累加
     ——与 JS `indexBuffsByType` 的 `{0,0}` 起点 `+=` 序列**逐位一致**（旧 Rust 索引
     首项直接赋值，仅在首项恰为 -0.0 时有理论符号差，新方案更忠实）；
     `attack_speed` 消费端的 `fold(0.0)` 与该序列逐位相同，一并归入此类。
   - 消除：索引构建的每类型 `String` 克隆 + OrderedMap 写入 + 结算体 40 次
     `get_str` 线性查找（每次 O(类型数)）。
2. **施法目标列表免克隆（simulator.rs）**：`process_ability_buff_effect` /
   `process_ability_heal_effect` 的 allAllies/lowestHpAlly 路径去掉
   `self.players.clone()` / `self.enemies.clone().unwrap_or_default()`，改下标遍历
   （heal 处 `ally_at` 闭包取 `Option<UnitId>`；buff 处 if/else 直取，越界 break）。
   循环内不增删单位列表，遍历顺序与快照一致。
3. **wasm-opt 常态化（scripts/optimize-wasm.mjs）**：`build:wasm` 追加
   `wasm-opt -O4`（binaryen@121 devDep）。输出走临时文件 + rename 原子替换，
   失败即退出非零。体积 835.4 KB → 730.1 KB（**-12.6%**）。

### 10.2 实测（`npm run benchmark:wasm-engine`，同机 AMD Ryzen 7 8845H）

- **4h 背靠背 A/B 三轮（pkg_opt=切片10 vs pkg_s11=切片11，交替覆盖）**：

  | 轮次 | A（切片10）WASM | B（切片11）WASM | 配对差 |
  | ---- | --------------- | --------------- | ------ |
  | 1    | 84.8 ms         | 72.6 ms         | -12.2  |
  | 2    | 82.5 ms         | 71.4 ms         | -11.1  |
  | 3    | 89.4 ms         | 69.4 ms         | -20.0  |

  三轮配对全部同向，均值 85.6 → 71.1 ms（**约 -17%**），切片 10 记录的
  78–97 ms 区间被压至 ~69–73 ms。

- **1h 基准**：21.1 ms（4.93×），历史最低（切片 10 为 24–27 ms）。
- 同轮 JS 读数 331–401 ms 波动，印证热节流下只有配对比较可靠的既有结论。

### 10.3 验收

- cargo test 102 passed；parity 17 passed（真实夹具 + 多种子，覆盖三项改动 +
  wasm-opt 输出的逐位一致性）；npm test 2636 passed + prettier；
  `build:wasm` → `build` → `verify-pages-build` 全过。

### 10.4 剩余候选（更新）

1. `update_details` 池化 / `enemyRespawn` 单位模板缓存（parity 风险高，RNG 时点）。
2. WASM 覆盖扩展（shouldStop 提前停止 / 观察器数据）——解锁主页端到端收益的主线。
3. `Interner` 字符串驻留（大工程，收益待估）。

## 11. 切片 12：WASM 覆盖扩展——shouldStop 提前停止（2026-09-29）

### 11.1 背景

切片 5 起 WASM 引擎只覆盖「无 JS 侧观察点」的轮次，食物优化器的**候选轮**（带
`shouldStop` 空蓝/死亡预算提前停止）全部留在 JS 引擎——而候选轮恰是优化器工作量的
大头。本切片把这类轮次也纳入 WASM。

### 11.2 实现

- **Rust `earlyStop` 谓词**（simulator.rs）：`SimulatorOptions.earlyStop: Option<
EarlyStopSpec>`（`{ watchHrid, deathLimit }`，camelCase）。主循环**每个事件处理后**
  求值（与 JS `simulate(limit, { shouldStop })` 的检查点逐事件一致）：
  `playerRanOutOfMana[watchHrid] === true || (deaths[watchHrid] || 0) > deathLimit`。
  谓词单调（空蓝粘滞、死亡只增），无漏检窗口。`deathLimit: null` = JS `Infinity`
  （仅空蓝停止）。命中后收尾与 JS 一致：`simulatedTime = 最后事件时间`、
  `stoppedEarly = true`。`SimResultState` 新增只读访问器 `deaths_value` /
  `player_ran_out_of_mana_value`（tally 层转发）。
- **JS 桥**（wasmProductionBridge.js + foodOptimizerSimulation.js）：请求 options 透传
  `earlyStop`（`Infinity`/非有限 → `null`）；`shouldUseWasmOptimizerRound` 放宽——
  候选轮放行，阈值收集（`collectThresholds`）与成本上界（`costBound`）轮次仍留 JS
  （两者需拦截 JS 模拟器实例，收益待后续切片评估）。
- **覆盖变化**：`useWasmEngine` 开启时，优化器轮次中仅剩阈值收集轮与 top-ten 成本
  剪枝轮走 JS。

  > **勘误（切片 13 复核，2026-09-29）**：上方「覆盖变化」只在 `collectThresholds === false`
  > 时成立——生产调用（`foodOptimizerSearch.js`）恒传 `collectThresholds: reuse` 且
  > `reuse` 默认 `true`，旧判据 `!collectThresholds` 把**默认路径的所有轮次**留在 JS，
  > 即切片 12 在默认生产路径无可兑现收益（当时的 A/B 也因此无可分辨差异）。切片 13
  > 补上观察器 WASM 化后判据放宽为「除成本上界轮外全部放行」，默认路径才真正切到 WASM；
  > 任务级收益数字见第 12 节。

### 11.3 验收

- cargo test **105 passed**（+3：死亡预算触发含部分时间/无 earlyStop 跑满/
  None 死亡上限忽略死亡）；
- parity **19 passed**（+2：真实夹具 + luna_empress deathLimit=10 精确触发——
  `stoppedEarly=true`、部分 `simulatedTime`、`deaths=11` 逐字段对账；
  deathLimit 不可达（Infinity→null）与 JS 无死亡分支一致）；
- npm test 2638 passed + prettier；build + verify-pages-build 全过。
- 性能：热节流下配对 A/B（s11 vs s12）两轮方向相反（105.4/106.3、116.6/104.1），
  逐事件谓词检查无可分辨回退。

### 11.4 剩余候选（更新）

1. 观察器数据扩展：阈值收集（`observeFoodOptimizerThresholds`）与成本上界
   （`observeFoodOptimizerCostBound`）的 WASM 化——需把逐事件消费快照导出或
   把谓词下推到 Rust，复杂度高于本切片。
2. `update_details` 池化 / `enemyRespawn` 单位模板缓存（parity 风险高，RNG 时点）。
3. `Interner` 字符串驻留（大工程，收益待估）。

## 12. 切片 13：观察器 WASM 化——解锁默认优化器路径（2026-09-29）

### 12.1 背景与动机

切片 12 把候选轮的 `shouldStop`（空蓝/死亡预算）下推到 Rust `earlyStop`，但验收时发现
**默认生产路径无收益**：UI 入口不传 `reuse`（默认 `true`）→ `foodOptimizerSearch.js`
以 `collectThresholds: reuse`（= true）初始化 worker → 旧判据
`!collectThresholds` 把**默认路径的所有轮次**留在 JS。即切片 5–12 在默认路径上的
WASM 覆盖为 0（第 11 节勘误）。本切片把两个 JS 阈值观察器 WASM 化，补上最后一块缺口。

两个观察器（均为**纯读窥视**，不改 RNG / 事件流 / 比较结果）：

- **阈值区间观察器**（`observeFoodOptimizerThresholds`，foodOptimizerPruning.js）：
  包装 food 槽 trigger 的 `compareValue`，门控通过后记录 `(value, active)`：
  active → `max = min(max, floor(value))`；inactive → `min = max(min, floor(value)+1)`；
  初值 `min=1 / max=MAX_SAFE_INTEGER`。形态校验失败 → `thresholdRanges` 输出 null。
  槽位索引按 `food.filter(Boolean)` 过滤序。
- **闲置下界观察器**（`observeInactiveFoodThresholds`，foodOptimizerInactiveFood.js）：
  ①`checkTriggersForUnit` 入口：单位匹配且存活且未眩晕时
  `min.hp = max(min.hp, floor(hp 缺口)+1)`（mp 同理）；②`tryUseConsumable` 成功后
  （food 类、`unit.food.includes(consumable)` 引用匹配）再观察一次。

### 12.2 实现

**Rust 侧（simulator.rs / consumable.rs / prod_probe.rs）**

- `SimulatorOptions.observers: Option<ObserverSpec>`（`{ watchHrid }`）；
  `ObserverState` 在 `add_player`（hrid 匹配时）初始化并做触发器形态校验，
  `reset` 末尾重建。
- `ThresholdObserve<'a> { state: &mut ObserverState, slot_index }` + `record(value, active)`
  取代旧的 `&mut dyn FnMut` 别名；food 循环用 **take/put 方案**穿过借用冲突：
  `let mut taken = self.observer_state.take()` → 构造 probe → `should_trigger(..., probe)`
  （此处不 `?`）→ 放回 `self.observer_state = taken` → `should_result.transpose()?`
  ——**放回必须先于 `?`**，否则错误路径丢观察状态。drinks 循环第 7 参传 `None`
  （JS 观察器只包 food）。
- `should_trigger`（consumable.rs）fast path：`compare_value` 之后调
  `observe.record(current, active)`——观察点与 JS 侧（门控通过后、仍走 compareValue）
  逐字对齐，这是刻意设计，不得绕过。
- `try_use_consumable` 末尾：buff 循环后 food 类调用 `observe_inactive_for(source)`。
- `ObserverState::to_value()` → `{ thresholdRanges: [...] | null, inactiveMinimum: { hp, mp } | null }`，
  经 `prod_probe.rs` 作为**独立输出字段** `observers` 返回——`simResult` 逐字节不变。

**JS 侧（桥 + 优化器 + worker）**

- `wasmProductionBridge.js`：请求透传 `observers.watchHrid`；返回
  `{ simResult, observers }`。
- `foodOptimizerSimulation.js`：`shouldUseWasmOptimizerRound` 判据放宽为
  `useWasmEngine === true && !costBound`（`collectThresholds` 形参保留但不再阻止）；
  wasm 分支安装条件与 JS 分支对齐（`collectThresholds && observedCandidate != null`），
  样本映射 `equivalentThresholds / inactiveFoodThresholds / unusedFoodThresholds` 与
  JS 分支逐字对齐。
- `worker.js`：wasm 命中时 `postMessage({ type: 'simulation_result', simResult })` 后
  break（不再落回 JS 分支）。

### 12.3 验收

- cargo test **108 passed**（+3：区间导出含中间 null 槽的过滤序 / 形态校验失败仅
  thresholdRanges 置 null / 无 spec 输出 null；非 gte 形态用例配恒假 value=-1 防挂起）。
- parity **21 passed**（+2）：
  - 真实夹具（jungle_planet）观察器 parity：simResult 不受观察影响 +
    `thresholdRanges` / `inactiveMinimum` 与 JS 侧手动安装两观察器的输出逐字段一致；
  - **生产 24h 时长回归**（本切片新增）：真实优化器 fixture（fly 区域）走生产单轮函数
    `simulateFoodOptimizerRound`，baseline 轮与候选轮（空蓝早停 + 观察器）两侧逐字段
    一致，并断言 wasm 轮无静默回退（`lastFallbackReason === ''`）——防止对照退化成
    JS vs JS 的假绿。
- npm test **2640 passed** + prettier；`build:wasm`（wasm-opt -O4：843866 → 737107
  bytes，-12.7%）→ `build` → `verify-pages-build` 全过。

### 12.4 任务级 A/B（本切片的核心收益数字）

新增 `npm run benchmark:wasm-optimizer`
（`scripts/benchmark-food-optimizer-wasm.mjs`；该脚本与 npm script 已在切片 21B 随 JS
引擎删除，下述数字为当时实测）：同一条优化器搜索任务（同一
request / seeds / 自适应 worker 池，仅 `useWasmEngine` 不同）背靠背配对交替跑，
JS 侧与 WASM 侧各计完整任务 wall time（含 worker 启动 / 协调 / 终止）。
WASM 由 worker 内 bridge 注入（esbuild splitting 保证与模拟器同 chunk 图），
worker 侧每次评估后自检 `lastFallbackReason`，任何静默回退即大声失败。

配置：真实量级——3 槽食物、25% 阈值步进、**24h × 3 轮**、580 候选、8 worker
（生产推荐值 = min(核数-1, 自适应上限 8)）。

| 配对轮 | JS（中位） | WASM（中位） | 提速   |
| ------ | ---------- | ------------ | ------ |
| 3 对   | 7738 ms    | 5144 ms      | 1.504× |
| 5 对   | 8061 ms    | 5271 ms      | 1.529× |

要点：

- **物理结果两侧完全一致**（baseline + top-10 逐字段）；stats 计数
  （simulatedCandidates / completedRounds 等）存在 ±5 左右抖动，且**同一模式自身重复
  跑也在抖**——源于剪枝/共享缓存命中受多 worker 调度时序影响，与引擎选择无关
  （脚本据此只对物理结果硬断言，stats 差异记录不阻断）。
- 任务级 1.5× 显著低于单轮引擎级 4.9×（1h）——差距来自：早停轮次远短于完整轮
  （候选轮在空蓝/超死时秒停）、成本剪枝轮仍留 JS、任务时间含协调/启动开销、
  单轮桥接开销（快照+JSON）占比上升。
- 读数纪律：热节流环境下单次读数不作数，全部为配对交替顺序（js→wasm / wasm→js）
  的中位数。

### 12.5 剩余候选（更新）

1. ~~成本上界观察器（`observeFoodOptimizerCostBound`）WASM 化~~——已于切片 20 完成
   （见第 19 节；dirty 检查点重算而非逐事件记账）。
2. 完整 `SimResult` 支持——解锁首页模拟本体（主页端到端收益的主线）。
3. `update_details` 池化 / `enemyRespawn` 单位模板缓存（parity 风险高，RNG 时点）。
4. `Interner` 字符串驻留（大工程，收益待估）。

## 13. 切片 14：完整 SimResult 覆盖（full-result 解锁首页单轮）（2026-09-29）

### 13.1 背景与动机

用户定案：最终只保留 WASM 引擎，JS 引擎删除。删除的前置是**结果面必须全量对齐**——
此前 WASM 生产路径只覆盖 `minimalResult`（食物优化器口径），首页模拟本体（完整 `SimResult`）
永远回退 JS。本切片补齐 full-result 的五个缺口，并解除双重闸门（桥三条 + Rust 三条）。

### 13.2 实现（缺口 → 接线）

| 缺口               | JS 语义                                                                                      | Rust 实现                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 经验记账           | `recordUnitDeath` 击杀快照（按 enrage 比率）→ `finalizeEnemyExperience` → pending → 清场提交 | `capture_enemy_death_snapshot` / `finalize_enemy_experience` / `append_pending_experience_gains` / `commit_pending_experience`（`ensure_experience_gain_entry` 保「空增益也建零值模板」） |
| 掉落上下文桶       | `recordMonsterDeathFromUnit(player, monster, 1)`                                             | `record_monster_death_from_unit`：玩家结算面板三倍率 + `debuffOnLevelGap`；难度档取**怪物实例**的 `difficultyTier`（`CombatUnit` 新增字段，刷怪 / 升变时写入）                            |
| 激怒层数           | `processEnrageTickEvent` 内 `maxEnrageStack = max(旧, nowStack)`                             | `SimResultState::bump_max_enrage_stack`（保 `Math.max` 的 NaN 传播）；minimal 结果同样记录（JS 亦如此）                                                                                   |
| 1000-tick 时序快照 | `ticks === 1000` 且 `enableHpMpVisualization` → `addTimeSeriesSnapshot(simTime, players)`    | 主循环同点位采集 `(hrid, hp, mp, maxHp, maxMp)` → `add_time_series_snapshot`                                                                                                              |
| `debuffOnLevelGap` | 玩家 DTO 顶层字段（`playerMapper` 按等级差算）                                               | 桥 `dumpUnitSpec` 增字段；`UnitSpec` / `CombatUnit` 承接；收尾 `setDropRateMultipliers` 读它                                                                                              |

同时解除 `getProductionSupport` 的 `full_result` / `combat_logs` / `hp_mp_visualization`
三条闸门与 Rust `validate_production_support` 的对应三条（战斗日志只影响控制台输出，
时序随 `simResult` 一次性返回）。另新增一条**保守校验**：full-result 时若玩家的
`combatStyleHrid` 不在风格技能表内（JS 会在首次击杀 `Object.keys(null)` / 缺风格时抛
TypeError），Rust 直接报错 → 回退 JS，避免静默产出「0 经验」。

### 13.3 对账中抓到的两个真实缺陷（本切片修复）

1. **`dropRateMultiplier` / `rareFindMultiplier` 双重 `+1`**：`SimulatorTally::set_drop_rate_multipliers`
   先加 1、`SimResultState::set_drop_rate_multipliers` 又加 1 → 结果里是 `2 + stat`。
   minimal 结果不含这两个字段，故此前的 minimal parity 掩盖了它；现由状态层单独施加 `1 +`。
2. **风格技能表未接线**：`combatStyleSkillExpMap` 从未进过生产请求 → full-result 经验恒为 0。
   现由桥按 `combatStyleDetailMap` 投影（`Object.keys(skillExpMap)` 键序；`null` 风格不进表）。

### 13.4 实测（`npm run benchmark:wasm-engine`，4h、15 轮配对中位数，同机 AMD Ryzen 7 8845H）

| 口径                             | JS 单轮  | WASM 单轮 | 提速      |
| -------------------------------- | -------- | --------- | --------- |
| minimal（食物优化器口径）        | 554.3 ms | 110.1 ms  | **5.03×** |
| full-result（首页单轮 + 可视化） | 604.7 ms | 189.0 ms  | **3.20×** |

full-result 轮比 minimal 贵（WASM 侧 +71%）：经验 / 掉落桶记账与每 1000 事件的时序快照
都随事件流发生；JS 侧同口径只贵 9%（其记账本就更重）。

### 13.5 验收

- `cargo test`：**111 passed**（新增 3 个 full-result 单测：经验 + 掉落桶、激怒层数、时序快照开关）。
- parity：**24 passed**（生产 parity 新增 3 例：1h full-result 逐字段、可视化时序、24h full-result；
  接线测试新增 1 例首页单轮 full-result A/B，`lastFallbackReason === ''`）。
- `npm test`：192 文件 / 2643 测试通过 + prettier 全绿；`npm run build` + `verify-pages-build` 通过。

### 13.6 已知差异与仍留 JS 的部分

1. **无流式 progress**：WASM 路径一次性返回 `simResult`，首页进度条 0→完成直跳、图表在结束时
   渲染（时序数据本身逐字段一致）；JS 路径仍按 1000 事件派发 `progress`。首页 store 已在
   `onResult` 里从 `simResult.timeSeriesData` 兜底取时序。
2. **副本 / 迷宫 / 卷轴 / 公会试炼**：仍由 JS 承接（后续切片）。→ 副本已于切片 15 覆盖
   （第 14 节），仅剩「副本 + full-result + `logCombatEvents`」组合留 JS。
3. ~~**成本上界观察器**（`observeFoodOptimizerCostBound`）~~：已于切片 20 下推（第 19 节）。

### 13.7 剩余候选（更新）

1. ~~副本 / 迷宫支持（`updateTimeSpentAlive` / `wipeEvents` / 波次结算）~~ ——
   副本已于**切片 15** 完成（第 14 节），迷宫仍留 JS。
2. 战斗卷轴窗口语义（`scroll.rs` 空壳）。
3. ~~成本上界观察器下推~~——已于切片 20 完成（第 19 节）。
4. `Interner` 字符串驻留（大工程，收益待估）。

## 14. 切片 15：副本（dungeon）波次覆盖（2026-09-29）

### 14.1 背景与动机

用户定案最终只保留 WASM 引擎；此前副本（`zone.isDungeon === true`）整条路径留 JS
（Rust `validate_production_support` 无条件拒绝），首页副本单轮与「副本 + 食物优化器」
永远回退。本切片把副本波次机制移入 Rust：波次生成（`getNextWave` 固定波 / 随机波）、
团灭重开与失败计数、逐波存活时间（`timeSpentAlive`），以及
`maxWaveReached` / `dungeonsCompleted` / `bossSpawns` 收尾聚合；同时解锁原「副本」闸门。

### 14.2 实现要点

**Rust（simulator.rs / sim_result.rs）**

- `start_new_encounter` 副本分支：`zone.get_next_wave(&mut rng)`（同构移植 `getNextWave`
  的固定波 / 随机波两条路径，RNG 消费顺序与 JS 一致）、波次名 `#<encountersKilled - 1>`
  （JS 两个分支都在返回前自增）、`dungeonsCompleted > tempDungeonCount` 时全队 HP/MP
  回满（`restore_players_to_full`）。
- 清波 / 团灭两条分支的差异：清波记 `timeSpentAlive("#<ek-1>", false)`，
  `encountersKilled > maxWaves` 时记整副本完成与 `lastDungeonFinishTime`；
  团灭清 10 类事件队列 + 清空 pending 经验 + 重排 `CombatStart`（非副本只清 2 类）。
- 收尾：`set_is_dungeon(zone.is_dungeon)`（此前 Rust 写死 `false`）、
  `compute_max_wave_reached(dungeonsCompleted, maxWaves)`（`>=1` 直接取 `maxWaves`，
  否则从 `#1` 起逐波查 `timeSpentAlive` 直到缺条目或计数为 0）、`bossSpawns`
  （`fixedSpawnsMap` 整数键升序拼接 + `monsterSpawnInfo.bossSpawns` 追加）。
- 闸门：`validate_production_support` 只在「副本 + full-result + `logCombatEvents`」时报错
  （JS 团灭写 `wipeEvents`，内容含 `new Date().toISOString()` 墙钟，不可复现）；
  桥侧 `getProductionSupport` 同判据（`reason: 'dungeon_combat_logs'`）。

**桥（wasmProductionBridge.js）——本切片修掉两个既有缺陷**

1. `zoneIsDungeon` 从未传：Rust 把副本当普通区域跑（走 `getRandomEncounter`）。
   证据：真实副本 `fightInfo.randomSpawnInfo.spawns` 为 **null**（`maxSpawnCount: 0`、
   `bossSpawns: []`），误走随机会在读取 `spawns` 时抛
   `Cannot read properties of undefined`。
2. buff `startTime` 可能是 .NET 日期字符串（真实副本区域 `buffs` 的
   `"0001-01-01T00:00:00Z"`），Rust `Option<f64>` 会因类型不符拒绝整条请求。
   桥侧 `stripNonNumericStartTime` 归一为「非数字即丢弃」——JS 只在
   `typeof startTime === 'number'` 时消费它（`removeExpiredBuffs`），语义等价。
3. 副本波次模板需进 `encounterTemplates`：`fixedSpawnsMap` +
   `randomSpawnInfoMap` 的刷新表（否则副本刷怪因缺模板报错）。

**工具链**：`console_error_panic_hook` + wasm start 钩子——wasm panic 现在输出真实消息
（此前只有 `RuntimeError: unreachable`），为后续排障的常驻设施。

### 14.3 parity 与单测

- `cargo test` **116 passed**（+5 副本单测：整副本完成 → `dungeonsCompleted>=1` /
  `maxWaveReached=maxWaves` / `lastDungeonFinishTime>0` / 每波 `timeSpentAlive` 计数；
  2s 部分波次；团灭重开与失败计数；full-result 日志组合报错；minimal 时间线为空）。
- 生产 parity **+3 例**（真实 chimerical_den：1h full-result / 1h minimal / 24h full-result），
  逐字段对账全过。**关键事实**：fixture 玩家在该副本反复团灭（1h：`dungeonsFailed=76`、
  `maxWaveReached=2`、`encounters=62`；24h：`dungeonsFailed=1818`、`encounters=1517`；
  `bossSpawns` 恒 10），因此生产 parity 覆盖的是「团灭重开 + 逐波计数 + 失败计数」；
  **完成整副本的分支由 Rust 单测覆盖**——两者互补，缺一不可。

### 14.4 实测（`npm run benchmark:wasm-engine`，4h、15 轮配对中位数，同机 AMD Ryzen 7 8845H）

新增副本口径（fixture 玩家 + chimerical_den + full-result；`WASM_BENCH_ROUNDS/HOURS` 同前）：

| 口径                               | JS 单轮        | WASM 单轮      | 提速           |
| ---------------------------------- | -------------- | -------------- | -------------- |
| minimal（食物优化器）              | 310.5–330.7 ms | 61.4–75.4 ms   | **4.39–5.06×** |
| full-result（首页 + 可视化）       | 312.4–365.6 ms | 111.6–115.3 ms | **2.80–3.17×** |
| full-result 副本（chimerical_den） | 303.4–382.0 ms | 117.0–144.8 ms | **2.59–2.64×** |

两次独立取样的副本提速比高度一致（2.594 / 2.638）——副本负载由大量短遭遇战 +
团灭重排事件构成；副本请求 JSON 152408 bytes（约普通区域 3 倍，含波次模板）。
JS 侧绝对值在同一口径两次取样间漂移（310 → 382 ms），再次说明热节流下
**只看同轮配对比值**。

### 14.5 验收

- `cargo test` 116 passed；5 个 wasm 套件 28 passed（parity +3）；`npm test`
  192 文件 / 2647 测试 + prettier 全绿；`build:wasm`（wasm-opt -O4：890453 → 777753 bytes，
  -12.7%）→ `build` → `verify-pages-build` 全过。

### 14.6 仍留 JS 的部分（更新）

1. 「副本 + full-result + `logCombatEvents`」组合（`wipeEvents` 墙钟时间戳）。
2. ~~迷宫~~ / 战斗卷轴 / 公会试炼 / 无区域——迷宫已于切片 16 覆盖（第 15 节）。
3. ~~成本上界观察器（`observeFoodOptimizerCostBound`）~~——已于切片 20 覆盖（第 19 节）。
4. `useWasmEngine` 默认仍为 false——「默认开关翻转」是独立切片候选。

## 15. 切片 16：迷宫（labyrinth）覆盖（2026-09-29）

### 15.1 背景与动机

迷宫是「删 JS 引擎」缺口清单上的第二块：`getProductionSupport` 里 `if (labyrinth) → 'labyrinth'`
把整条路径挡回 JS。本切片把迷宫的单怪循环、120s 超时重启与身份字段移入 Rust，
并保持与 JS `Labyrinth` / `CombatSimulator` 逐位一致。

### 15.2 JS 语义（先行摸底，实现逐条对照）

- 载荷：`{ labyrinth: { labyrinthHrid（怪物 hrid）, roomLevel, crates[], shopUpgrades } }`，**zone 为 null**；
  `worker.js` 把 `labyrinth.buffs`（补给箱 + 商店升级 buff）作为玩家 `zoneBuffs`。
- `getMonster()` = `[new Monster(hrid, 0, roomLevel)]`：单只、`difficultyTier` 恒 0、
  属性按 `roomLevel / 100` 缩放（技能等级取整、抗性/护甲同乘）。
- 遭遇推进：清场或**单轮超过 120s**（`checkTimeout`，`120 * 1e9` ns）都立刻重启——
  `eventQueue.clear()` + `CombatStart @ 当前时间`（同一时刻开下一轮，无延迟）。
- 玩家重置：迷宫的 `initializeCombatPlayers` 用 `player.reset()`（缺省 `currentTime = 0`：
  清空战斗增益 + 复位 CD；`generatePermanentBuffs` 只在 t=0 那次跑）；死亡不排
  `PlayerRespawnEvent`（仅 `zone && !isDungeon` 才排），靠每次 CombatStart 复活。
- 身份字段：`labyrinthName = labyrinth.monsterHrid`、`roomLevel`、`isLabyrinth = true`；
  `scrollUsage = { allowed: false, ignoredReason: 'labyrinth' }`；无 `zoneName` / `difficultyTier` 键。

### 15.3 实现

**Rust（simulator.rs）**

- `SimulatorOptions` 的 `labyrinth_present` / `labyrinth_name` / `labyrinth_room_level` 是切片 4 起的桩，
  本切片补运行时：新增 `labyrinth_encounter_start_time`（120s 判定）。
- `start_new_encounter`：zone 分支之后追加迷宫分支——用 `labyrinth_name` 作模板键
  `instantiate_templates([(hrid, 0.0)])` 复刻单怪并记 `labyrinth_encounter_start_time`
  （与 JS「迷宫优先」的覆盖顺序一致）。
- `initialize_combat_players`：迷宫用 `reset(0.0)`，其余沿用当前模拟时间。
- `check_encounter_end`：新增迷宫分支（超时或 `encounter_ended` → 未清场则丢弃挂起经验、
  `enemies = None`、`queue.clear()`、当前时间排 `CombatStart`）；全队阵亡路径因无 zone 自然跳过
  副本/普通区域分支（与 JS 一致），随即被迷宫分支接管重开。
- `validate_production_support`：「必须有区域」放宽为「区域或迷宫至少有一个」，删除迷宫 Err。

**桥（wasmProductionBridge.js / wasmProductionSimulation.js）**

- 请求新增 `labyrinthPresent` / `labyrinthName`（= monster hrid）/ `labyrinthRoomLevel`；
  迷宫模式下 `encounterTemplates` 来自新的 `buildLabyrinthEncounterTemplate(labyrinth)`——
  在 JS 侧 `new Labyrinth(...).getMonster()[0]` 后快照（roomLevel 缩放与技能等级过滤都已在 JS 侧完成，
  Rust 不需要游戏数据），按 `(monsterHrid, roomLevel)` 缓存。
- `getProductionSupport` 的 `no_zone` 判据改为「既无 zone 又无迷宫」，删除迷宫闸门；
  `tryRunWasmProductionRound` 把 `labyrinth` 透传给请求构建。

### 15.4 parity 与单测

- `cargo test` **118 passed**（+2 迷宫单测：单怪循环击杀多次 + 身份字段；
  体力 1e12 打不死 → 130s 后 `spawnedAt >= 120s` 且 `count = 0`，覆盖超时重启分支）。
- 生产 parity **+2 例**（真实 `/monsters/cyclops` + 真实补给箱 `/items/basic_coffee_crate` +
  5 项商店升级）：1h 与 24h full-result 逐字段一致；接线测试的迷宫用例改为
  「不再被配置闸门挡住」（期望 `engine_unavailable`）。

### 15.5 实测（`npm run benchmark:wasm-engine`，4h、15 轮配对中位数，同机 AMD Ryzen 7 8845H）

| 口径                  | JS 单轮        | WASM 单轮      | 提速           |
| --------------------- | -------------- | -------------- | -------------- |
| minimal（食物优化器） | 282.7–293.5 ms | 60.7–67.8 ms   | **4.33–4.66×** |
| full-result（首页）   | 317.0–319.7 ms | 108.1–115.1 ms | **2.78–2.93×** |
| full-result 副本      | 309.4–329.6 ms | 114.6–122.1 ms | **2.70×**      |
| full-result 迷宫      | 489.0–513.9 ms | 88.3–94.9 ms   | **5.42–5.54×** |

迷宫口径提速比最高（两次 5.54× / 5.42×）：迷宫每轮只生成一只怪、清场/超时即整队重启，
JS 侧每次遭遇都要重建 `Monster`（含 `updateCombatDetails` 全量结算）并重置整个事件队列，
WASM 侧则复用模板实例化；请求 JSON 也最小（38.1 KB，无区域刷怪表）。

### 15.6 验收

- `cargo test` 118 passed；`npm test` 全绿 + prettier；`build:wasm`
  （wasm-opt -O4：891700 → 778912 bytes，-12.6%）→ `build` → `verify-pages-build` 全过。

### 15.7 仍留 JS 的部分（截至切片 16）

1. ~~战斗卷轴窗口语义（`scroll.rs` 空壳）~~——已于切片 17 覆盖（第 16 节）。
2. 公会试炼与无区域（无 zone 且无迷宫）。
3. 「副本 + full-result + `logCombatEvents`」组合（`wipeEvents` 墙钟时间戳）。
4. ~~成本上界观察器（`observeFoodOptimizerCostBound`）~~——已于切片 20 覆盖（第 19 节）。
5. `useWasmEngine` 默认仍为 false——「默认开关翻转」是独立切片候选。

## 16. 切片 17：战斗卷轴（combat scroll）窗口语义覆盖（2026-09-29）

### 16.1 背景与动机

战斗卷轴是「删 JS 引擎」缺口清单上的第三块：`getProductionSupport` 里 `combat_scrolls` 闸门
把 `combatScrollsEnabled: true` 的整条路径挡回 JS，而 `engine/src/scroll.rs` 从切片 4 起一直是空壳。
本切片把卷轴的窗口开启 / 续期 / 关闭、库存记账与 buff 生命周期移入 Rust，并保持与
`CombatSimulator` 逐位一致。

### 16.2 JS 语义（先行摸底，实现逐条对照）

- 配置面：玩家 `combatScrolls = { [itemHrid]: { quantity } }`（`quantity: null` = 无限库存），
  定义来自 `shared/combatScrolls.js`（单窗口 30 分钟 = `COMBAT_SCROLL_DURATION_NS`）。
- 窗口语义：半开区间 `[activeStartTime, activeUntil)`——开启即注册 buff（源键
  `scroll:<itemHrid>`、Replace 策略、level 1 无等级并入）、token++、扣库存并记
  `openedCount`；到期由 `syncScrollsToTime` 关闭窗口（记录 bounded 时长）并在原
  `renewalTime` 续开；`renewalTime >= simulationTimeLimit` 时不再排续期事件。
- 与普通 buff 的差异：卷轴 buff **不排** `CheckBuffExpiration`——只由窗口关闭按源移除。
- 作用域：`scrollsAllowed = !labyrinth && !isGuildTrial`；开关关闭时记
  `setScrollUsageDisabled` 但保留配置行（opened 0）。
- 收尾：`finalizeScrollUsage(effectiveSimulationTime)` 关掉活跃窗口，并以直读 `openedCount`
  的 exhausted 公式（`configuredQuantity` 非 null 且 `openedCount >= quantity`）落最终记账。

### 16.3 实现

**Rust（scroll.rs / unit.rs / sim_result.rs / simulator.rs）**

- `scroll.rs`（空壳 → 51 行）：`CombatScrollDefinition`（桥侧快照：`item_hrid` /
  `duration_ns` / buff）与只读 `ScrollState`。
- `simulator.rs`：卷轴状态机（`initialize_scroll_runtime` / `can_open_scroll` /
  `schedule_scroll_renewal` / `open_scroll_window` / `close_scroll_window` /
  `restore_active_scroll_buff` / `sync_scrolls_to_time` / `sync_scrolls_if_due` /
  `activate_initial_scrolls` / `process_scroll_renewal_event` / `finalize_scroll_usage`）+
  `ScrollRenewal` 事件；`reset()` 先清卷轴 buff 再重建运行时；每事件前 O(1) 前置守卫
  `sync_scrolls_if_due`；`validate_production_support` 删除卷轴闸门。
- `unit.rs`：`CombatScrollConfig`（`quantity: null` → `None`）+ `CombatUnit.combat_scrolls` +
  `has_buff_source`（JS `buffSources?.[u]?.has(k)` 的等价）。
- `sim_result.rs`：`finalize_scroll_exhausted`（直接按键查表、缺失即返回，不建条目）。

**桥（wasmProductionBridge.js）**

- `dumpUnitSpec` 新增 `combatScrolls`（键序与 `normalizeCombatScrolls` 一致）；
  `buildCombatScrollDefinitions(players)` 把玩家配置的卷轴快照为 `combatScrollDefinitions`
  （duration + buff 模板；缺定义跳过）；`getProductionSupport` 删除 `combat_scrolls` 闸门。

### 16.4 parity 与单测

- `cargo test` **122 passed**（+4 卷轴单测：半开窗口 45s/20s 续期 → opened 3 /
  activeDuration 45s / 无限库存 null / finalize 后 buff 已移除；有限库存 qty 2 耗尽停止；
  迷宫内 `allowed=false` 但配置行保留、opened 0；开关关闭时同样保留行但不开窗）。
- 生产 parity **+2 例**（真实卷轴 `/items/seal_of_damage`）：1h 防退化断言
  openedCount=2 / activeDurationNs=simulationTimeLimit / exhausted=false / allowed=true /
  disabled=false；24h openedCount=48。两侧逐字段一致。
- 接线测试：`combatScrollsEnabled: true` 的普通区域轮不再被配置闸门挡住
  （期望 `engine_unavailable`）。

### 16.5 实测（`npm run benchmark:wasm-engine`，4h、15 轮配对中位数，同机 AMD Ryzen 7 8845H）

| 口径                  | JS 单轮        | WASM 单轮      | 提速           |
| --------------------- | -------------- | -------------- | -------------- |
| minimal（食物优化器） | 296.6–311.6 ms | 64.5–65.4 ms   | **4.60–4.76×** |
| full-result（首页）   | 306.8–364.2 ms | 106.5–118.4 ms | **2.88–3.08×** |
| full-result 副本      | 304.0–326.8 ms | 116.0–117.9 ms | **2.62–2.77×** |
| full-result 迷宫      | 467.4–484.1 ms | 90.9–91.8 ms   | **5.14–5.27×** |
| full-result 卷轴      | 352.6–365.3 ms | 109.8–110.3 ms | **3.21–3.31×** |

新增卷轴口径两次取样 3.311× / 3.211×：卷轴 buff 提升玩家输出，4h 内击杀数上升
（1h 冒烟对照同口径：`jungle_sprite` 击杀 193 → 224），JS 侧每遭遇的属性重算更多；
请求 JSON 52299 bytes（比无卷轴口径 +314 bytes，即一条 `combatScrollDefinitions` +
玩家 `combatScrolls` 配置）。其余口径读数与切片 16 同量级（同一台机器的热节流抖动范围内）。

### 16.6 验收

- `cargo test` 122 passed；5 个 wasm 套件 **32 passed**（生产 parity 16，+2 卷轴）；
  `npm test` 192 文件 / 2651 用例 + prettier 全绿；`build:wasm`
  （wasm-opt -O4：916874 → 800932 bytes，-12.6%）→ `build` → `verify-pages-build` 全过。

### 16.7 仍留 JS 的部分（截至切片 17）

1. 公会试炼与无区域（无 zone 且无迷宫）。
2. 「副本 + full-result + `logCombatEvents`」组合（`wipeEvents` 墙钟时间戳）。
3. ~~成本上界观察器（`observeFoodOptimizerCostBound`）~~——已于切片 20 覆盖（第 19 节）。
4. `useWasmEngine` 默认仍为 false——「默认开关翻转」是独立切片候选。

## 17. 切片 18：生产载荷默认点亮 wasm 引擎 + 产物进部署链（2026-09-29）

### 17.1 背景与动机

切片 5–17 把 WASM 的能力面铺满（结果形状 / 区域类型 / 卷轴 / 观察器 / 提前停止），
但 `useWasmEngine` 在主线程**从未有过发送点**——worker.js 只读 `event.data.useWasmEngine`，
而全部生产 payload 构造函数（store / 快照 / 域层）都不设置它。同时摸底确认两个部署缺口：

- **CI 无 Rust 工具链且 `engine/pkg` 被 gitignore**：`npm run build` 产出的 `dist` 不含
  wasm，线上（GitHub Pages）永远 `engine_unavailable` 回退 JS。
- **loader 固定两级上跳**（`../../engine/pkg`）：worker bundle 位于 `<site>/assets/`，
  两级上跳在 Pages 子路径（`user.github.io/<repo>/`）会越出 `<repo>/` 前缀 → 404。

另一个摸底结论（用户指认 + 代码验证）：**公会试炼与无区域在生产载荷里不可达**——
`options.isGuildTrial === true` 无任何生产调用方传值（只有测试），
`buildSingleSimulationPayload` 的 if/else 保证 zone 或 labyrinth 至少其一。
两者是「预留语义」，不是当前缺口，从留 JS 清单改记为「接入时再评估」。

### 17.2 实现

**点亮发送点（六处生产 payload 构造）**

- `simulationDomain.buildSingleSimulationPayload`：payload 加 `useWasmEngine: true`
  （覆盖首页单轮、队列场景轮 / 基线轮、触发器优化器候选轮——三者共用该函数）。
- `foodOptimizerSnapshot.snapshotFoodOptimizerInput`：优化器请求快照加
  `useWasmEngine: true`（该字段进输入签名：引擎切换让存量缓存报告过期一次，保守正确；
  成本上界剪枝轮彼时由 `shouldUseWasmOptimizerRound` 挡回 JS——自切片 20 起也走 wasm，第 19 节）。
- `advisorDomain.createAdvisorSimulationPayload` + `advisorRunExecution` 批量消息：
  推荐扫描单轮与 quick/refine 批量轮点亮。
- `simulatorSimulationActions` 的 `start_simulation_all_zones` / `all_labyrinths` 批量消息。
- `multiWorker.buildWorkerMessage`：主线程批量消息的开关透传给每个子 worker
  （未开启时不注入字段，消息形状最小化）。

**worker.js 的 seed 兜底**：Rust RNG 自带确定性、必须显式 seed；载荷未带 seed 时
（首页单轮 / 批量扫描）在 `installSeedScope` 之前随机采一个
（`(Math.random() * 0x100000000) >>> 0`，此时 Math.random 仍是原生），
保持「每场独立随机流」——与 JS 分支无 seed 时的统计语义等价。带 seed 的路径
（优化器公共随机数）原样透传。

**部署链**

- 新增 `scripts/sync-wasm-to-public.mjs`（`build:wasm` 末步）：把
  `mwi_combat_engine.js` + `mwi_combat_engine_bg.wasm`（wasm-opt 后）拷进
  `public/engine/pkg`。public 由 vite 接管：dev 映射到站点根、构建原样拷进
  `dist/engine/pkg`；**产物随仓库提交**，CI 无 Rust 工具链也能构建出带引擎的 dist。
- `verify-pages-build` 新增两条断言：`dist/engine/pkg` 两个文件必须存在（缺失即
  线上永远回退 JS，构建红灯）。
- `wasmEngineLoader` 改为候选式解析：源码布局两级上跳（dev / Node）→ 打包布局
  一级上跳（`assets/` → 站点根），修复 Pages 子路径 404；`.prettierignore` 排除
  wasm-pack 生成的胶水代码（每次 build:wasm 重新生成，格式化无意义）。

### 17.3 验证

- `npm test` 192 文件 / **2652 用例** + prettier 全绿（multiWorker 透传 +1 用例；
  simulationDomain / advisorDomain 的 payload 精确断言同步更新为含开关字段）。
- 5 个 wasm 套件 **32 passed**（两侧逐字段一致性未受影响）。
- `npm run build` + `verify-pages-build` 全过，`dist/engine/pkg` 实测含
  `mwi_combat_engine.js`（13 KB）+ `mwi_combat_engine_bg.wasm`（800932 bytes，
  wasm-opt -O4 后）。
- `cargo test` 122 passed（Rust 侧零改动，复跑确认）。

### 17.4 行为语义（用户可见变化）

- 所有生产模拟默认走 wasm：引擎级单轮提速按口径 2.6–5.5×（第 14–16 节实测），
  优化器任务级 1.50–1.53×（第 12 节）。
- **无流式进度条**（wasm 路径时序随结果一次性返回）：首页单轮进度条 0→完成直跳、
  HP/MP 图表在结束时渲染——这是切片 14 起已存在并文档化的行为，本切片只是让它
  真正生效。若需回退流式体验，清掉 localStorage 的引擎开关相关实验项即可走 JS。
- wasm 失败静默回退 JS：引擎缺失（部署产物不含 wasm）/ 运行时出错——页面行为与
  切片 17 前完全一致。「副本 + full-result + 日志」组合的回退分支已在切片 19 移除
  （见第 18 节）。

### 17.5 仍留 JS 的部分（截至切片 18）

1. （已消项，切片 19——见第 18 节）~~「副本 + full-result + `logCombatEvents`」组合~~
   （`wipeEvents` 改由引擎生成，timestamp 用确定性字符串替代墙钟）。
2. （已消项，切片 20——见第 19 节）~~成本上界观察器（`observeFoodOptimizerCostBound`）~~。
3. 公会试炼与无区域：**生产不可达的预留语义**（无传值点 / 构造保证 zone 或
   labyrinth 至少其一），接入公会试炼模拟时再评估，不计入「删 JS 引擎」缺口。
4. （已消项）~~默认开关翻转~~——本切片完成。

## 18. 切片 19：副本团灭日志（wipeEvents）引擎生成（2026-09-29）

### 18.1 背景与动机

切片 18 点亮默认开关后，仍留 JS 的最后一个**真实路径缺口**是「副本 + full-result +
`logCombatEvents`」：首页 / 队列的副本模拟若开启战斗日志（UI 的团灭日志浏览器消费
`simResult.wipeEvents`），整轮回退 JS，吃不到副本口径 2.59–2.64× 的提速。本切片把
团灭日志生成下推进引擎，解除该组合闸门。

### 18.2 JS 语义（逐行确认，`combatSimulator.js`）

- **生成点 7 处**：普攻直击 `:1017-1027`（`target.isPlayer && didHit && damageDone > 0`，
  `generateCombatLog`，ability=`'autoAttack'`，isCrit 取 attackResult）；普攻 thorn
  `:1146-1149` 与 retaliation `:1159-1162`（`damageDone > 0 && source.isPlayer`，
  `buildCombatLog`，isCrit 恒 false）；DoT `:1453-1456`（**仅 `zone?.isDungeon` 门控**，
  source 传 `''`——经 `source?.hrid || 'UNKNOWN_SOURCE'` 记为 `'UNKNOWN_SOURCE'`，
  damage 可为 0 也记）；技能直击 `:2023-2032`（同普攻直击，ability=技能 hrid）；
  技能 thorn `:2216-2219` / retaliation `:2229-2232`。**技能 parry 块 `:1943-1990`
  不写日志**（Rust parry 块同样不接）。
- **条目 10 键**：`{time: simulationTime, wave: encountersKilled - 1, source, ability,
target, damage, beforeHp: max(0, afterHp + damage), afterHp, playersHp（全玩家
{hrid, current, max} 快照）, isCrit}`。
- **缓冲**：`wipeLogs` 200 条环形；团灭分支 `:1268-1315` 在
  `saveWipeLogsToSimResult(encountersKilled - 1)` 后 `index = 0; count = 0` 清零；
  团灭前的 console.log 敌人血量输出无数据价值，不移植。
- `simResult.addWipeEvent`（simResult.js:108）：`{simulationTime, logs, wave,
timestamp: new Date().toISOString()}`——**timestamp 是唯一不可复现部分**，UI 仅用作
  v-for `:key`（SimulationResultsView.vue），不显示 → Rust 用确定性字符串
  `t+{simulationTime}` 替代。
- minimal 变体 `addWipeEvent` 为空操作；`logAndResetWipeLogs` 无调用点（死代码）。

### 18.3 Rust 实现（`engine/src/simulator.rs`）

- `CombatSimulator.wipe_logs: Option<WipeLogBuffer>`：`log_combat_events &&
zone_is_dungeon && !minimal_result` 时启用；`VecDeque` 环形容量 200（**不可 derive
  Default**——capacity=0 会让 push 恒 no-op）。
- 方法组：`build_wipe_log_entry`（isCrit=false 族；**空 source 串映射
  `'UNKNOWN_SOURCE'`**，等价 JS `source?.hrid || 'UNKNOWN_SOURCE'`——DoT 点专用）、
  `generate_wipe_log_entry`（isCrit 覆写、damage NaN→0）、`wipe_wave`、
  `players_hp_snapshot`、`save_wipe_logs_to_result`（timestamp=
  `t+{js_number_key(simulation_time)}`，空日志跳过）。
- 7 个结算点按各自 isPlayer / damage 条件接入（`self.wipe_logs.is_some()` 门控）；
  团灭分支在清事件**之前**快照缓冲进 simResult。
- `validate_production_support` 删除 `dungeon_combat_logs` Err 闸门；`SimResultTally`
  转发 `add_wipe_event`（探针分支不 push 仅记名，探针无副作用原则不变）。

### 18.4 桥与接线

- `getProductionSupport`（wasmProductionBridge.js）删除
  `dungeon && logCombatEvents && !minimalResult` 判据——现在只剩 `no_zone` 与
  `guild_trial` 两条。
- wiring 测试期望更新：该组合在引擎未注入时的回退原因 `dungeon_combat_logs` →
  `engine_unavailable`。

### 18.5 parity 与单测

- Rust 单测 **+2 / -1**：`dungeon_full_result_emits_wipe_events_when_logging`
  （打不死 + 低伤高命中的怪引导 5s 留痕 → 手动置零玩家 HP 制造团灭 → 断言 wipeEvents
  形状 / 每条日志 10 键 / `t+` 时间戳 / autoAttack 条目 / 团灭后缓冲清空；
  `regular_zone_with_logging_keeps_wipe_events_empty`（非副本不启用缓冲）；
  删除 `dungeon_full_result_rejects_combat_event_logging`。**测试场景调参要点**：
  手动引导循环的迭代上限必须远大于事件数（玩家 1ms 攻速下 5s ≈ 5000+ 事件），
  且怪物 `attack_level` 同时决定命中率与攻击间隔（`/(1 + level/2000)`）、
  `melee_level` 决定单击伤害——须调到「必命中且引导窗内杀不死玩家」，否则循环内
  提前团灭清空缓冲）。`cargo test` **123 passed**。
- 生产 parity **+1 例**（真实 chimerical_den + 真实夹具，1h）：两侧
  `logCombatEvents: true`，剥离 timestamp 字段（JS 墙钟 ISO vs Rust `t+{ns}`）后完整
  simResult 逐字段一致；防退化断言两侧 wipeEvents 非空且含 `ability: 'autoAttack'`
  条目、Rust timestamp 全部 `t+` 前缀。首跑即揪出一处真实语义缺口：DoT 条目 JS 记
  `'UNKNOWN_SOURCE'`（`''?.hrid || fallback`）而 Rust 初版记 `""`——补空串映射后
  逐位一致（parity 对账的价值直接兑现）。

### 18.6 验收

- `cargo test` 123 passed；5 个 wasm 套件全绿（生产 parity 17 例，含新副本日志用例）；
  `npm test` 192 文件 / **2653 用例** + prettier 全绿；`build:wasm`
  （wasm-opt -O4：928840 → 811298 bytes，-12.7%）→ `npm run build` →
  `verify-pages-build` 全过。
- 基准未跑：本片是覆盖面收尾非性能片，副本口径沿用切片 15 实测 2.59–2.64×
  （第 14 节），开启日志的副本轮从此也落在该提速内。

### 18.7 仍留 JS 的部分（截至切片 19）

1. ~~成本上界观察器（`observeFoodOptimizerCostBound`，依赖 JS 运行时状态）~~——
   已于切片 20 下推（第 19 节）。
2. 公会试炼与无区域：**生产不可达的预留语义**（同 §17.5），接入时再评估。

## 19. 切片 20：成本上界观察器（costBound）下推（2026-09-29）

### 19.1 背景与动机

切片 19 收尾后，仍留 JS 的最后一个**真实路径缺口**是 top-10 轮内成本剪枝
（`observeFoodOptimizerCostBound`）：食物优化器候选评估轮通过 monkey-patch
`tryUseConsumable` 监视食物消费，在成本下界越过 cutoff 时提前停止——它依赖 JS
模拟器实例，`shouldUseWasmOptimizerRound` 判据 `!costBound` 把这类轮次整体挡回 JS，
top-10 搜索的任务级提速吃不到成本剪枝轮。本切片把该观察器下推进 Rust。

### 19.2 实现

- **Rust `CostBoundSpec` / `CostBoundState`**（simulator.rs）：请求 options 增
  `costBound`（`{ watchHrid, cutoff, completedCostPerHour, totalRounds, prices }`，
  camelCase；价格由桥侧预解析成 `[hrid, price]` 快照——键序 = 监视玩家 food 槽
  `filter(Boolean)` 去重，与 JS `foodUsed` 的求和序逐字一致，且只含 food 类目条目，
  `resolveMarketPrice` 的 ask/bid/vendor 兜底一并固化，引擎不持有市场数据）。
  安装守卫镜像 JS（`try_new`：首轮下界非法 → 不激活；监视单位未出场 → 不激活——
  `reset()` 重建 state 必须带 `cost_bound_unit` 守卫）。运行时 `try_use_consumable`
  成功消费监视玩家的被监视食物 → `dirty`；主循环检查点（每个事件处理后，与 JS
  `simulate` 的 `shouldStop` 调用点一致）dirty 时从 `consumablesUsed` 全量快照重算——
  以**全额** `simulationTimeLimit` 为除数（绝不除以已流逝时长）、按快照序累加
  `max(0,count)*max(0,price)`。与 `earlyStop` 组合成 JS `shouldStop` 完整语义：
  失败谓词（空蓝/死亡预算）优先、成本其次（`||` 短路顺序一致）；`stoppedForCost`
  仅在成本分支被求值且命中时置位。
- **独立输出字段**：`costBound: { stoppedForCost, costLowerBound }`（未激活 → null），
  simResult 逐字节不变（`prod_probe.rs` 输出 `simResult` / `observers` / `costBound`
  三字段纪律）。
- **JS 桥**（wasmProductionBridge.js + foodOptimizerSimulation.js）：
  `buildProductionRequest` 增 `costBound` 构造（`buildCostBoundSpec`：时长有限 >0、
  监视玩家在场、价格快照按 food 槽序去重只含 food 类目）；安装条件提取为
  `shouldInstallCostBoundObserver`（JS/wasm 两分支共用同一份判定，逐字镜像原 JS
  守卫）；`runWasmProductionSimulation` 返回值增第三字段 `costBound`；
  `shouldUseWasmOptimizerRound` 判据放宽为 `useWasmEngine === true`；wasm 分支样本
  映射与 JS 分支逐字对齐（`stoppedForCost` → `pruned: 'cost'` + `costLowerBound`、
  `unusedFoodThresholds` 的 `!stoppedForCost` 门、`costPerHour` 恒 0 由 stoppedEarly
  分支给出）。

### 19.3 验收

- `cargo test` **127 passed**（+4：真实食物消费后剪枝 + 部分时长、不可达 cutoff 跑满
  （仍导出有限下界）、非法 spec / 监视单位未出场 → 输出 null、失败优先于成本停止）。
  测试场景坑：`early_stop_production_options` 的默认怪（defense 1）会被玩家 1ms 攻速
  秒杀 → 玩家 HP 永不下降 → 食物永不消费；换切片 19 的「打不死强怪」模板
  （stamina 1e12 + attack/melee 1000 + attackInterval 1s）才能真实驱动食物消费。
- parity +2（19 passed）：真实夹具 top10 costBound 轮（cutoff=0 → 首次食物消费即剪枝）
  JS/wasm 单轮样本逐字段一致 + 防退化（真剪枝、部分时长、有限下界、costPerHour=0）；
  安装守卫拒绝（cutoff 非有限）时两侧跑满整轮一致。wiring 判据断言更新
  （costBound 轮 false → true）。
- `npm test` 192 文件 / **2655 用例** + prettier 全绿；`build:wasm`
  （wasm-opt -O4：940141 → 821670 bytes，-12.6%）→ `build` → `verify-pages-build` 全过。
- 基准未跑：本片是覆盖面收尾非性能片，优化器任务级口径沿用切片 13 实测 1.50–1.53×
  （第 12 节），成本剪枝轮从此也落在该提速内（此前这些轮次整体走 JS）。

### 19.4 仍留 JS 的部分（截至切片 20）

1. 公会试炼与无区域：**生产不可达的预留语义**（同 §17.5），接入时再评估。
2. 真实路径缺口清零——「删 JS 引擎」的删除动作本身待用户启动
   （下一候选：JS 引擎审计与删除）。

## 20. 切片 21A：A 层零生产消费 + Rust clear_ccs threat bug 修复（2026-09-30）

### 20.1 背景与范围

切片 21 审计（2026-09-29 用户已批）定案：删除 JS 引擎分两片。**21A 范围**是让
A 层（模拟执行层：combatSimulator.js + events/ + simResult/foodOptimizerSimResult +
drops + dataBuffValidation）达到**零生产消费**：

1. playerMapper 三处预览（createCombatPreviewSimulationState / buildDrinkPreviewCard /
   buildPartyAuraPreviewResult）不再 `new CombatSimulator`，改用轻量
   `CombatPreviewContext`（extends 新抽出的 `CombatActionsCore` 单步动作基类 +
   数组版 `PreviewEventQueue` + 全 no-op `NoopPreviewSimResult`）；
   `CombatActionsCore` 同时是 `CombatSimulator` 的基类（单步动作方法逐字搬移，
   引擎行为零变化）。
2. `getFoodOptimizerResources` 改道：主线程直接复刻「reset() + initializeCombatPlayers(0)」
   的玩家初始化链（`generatePermanentBuffs()` → `reset(0)` → 等价
   `activateInitialScrolls`），读取 maxHp/maxMp/foodSlots，不再构造模拟器。
3. worker.js：wasm 输出 null 时按审计定案 **D1 硬失败**——`console.error`（含
   lastFallbackReason）+ postMessage `simulation_error`。JS 回退分支
   （installSeedScope / CombatSimulator）删除；无条件 `useWasmEngine: true` 兜底
   （覆盖 HomeExperimentalModal 批处理等不带开关的手写载荷）。
4. foodOptimizerSimulation：`simulateFoodOptimizerRound` **wasm-only**——不带开关
   或 wasm 运行失败均 throw（JS 分支含 Math.random 播种作用域、观察器
   monkey-patch 安装整体删除）；`shouldUseWasmOptimizerRound` 判据为
   `useWasmEngine === true`。`createFoodOptimizerSimulation` 保留（测试 oracle 用，
   21B 处置）。

**21B（已完成，见第 21 节）**：物理删除 A 层文件 + parity oracle 改 golden 快照
（定案 D2）+ scripts 处置 + useWasmEngine 开关清理 + 文档 §21。

### 20.2 Rust clear_ccs bug（21A 暴露的既有 bug，非引入）

复现：sorcerers_tower tier4 + 单玩家（fly 同载荷正常）。现象：wasm 引擎抛
`TypeError: Cannot read properties of undefined (reading 'player')`（复刻 JS
`pickThreatTarget` 的 `.player` 访问）。

根因链：JS `clearCCs` 只清 CC 标志 + live 面板 `damageTaken = 0` + 刷新基准快照，
**live 面板保留最近一次结算的派生值**（threat 基准 0 + 100 = 100）；而 Rust
`clear_ccs` 误把 live combatStats 整体回滚到构造期快照（class_base，threat=0 未
派生）。玩家死亡→复活路径（clearBuffs→结算→clearCCs）后 live threat=0 → 单玩家
威胁选靶 `rng*0=0` 不满足 `>= 0 && < 0` → find miss → TypeError。fly 区玩家不死
不复活，所以从未触发；旧测试用例在 JS 引擎下通过（JS 侧 threat 恒 100）。

修复（unit.rs `clear_ccs`）：类自有单位把**基准快照**恢复为构造期 class_base
（damageTaken 归零），live 不回滚——等价 JS 语义（下次 update 从基准重算，类覆写
重写装备字段）；合成单位（探针，无 class_base）维持「从 live 捕获基准」逐字等价。
回归测试 `clear_ccs_keeps_live_derived_threat_for_class_owned_units` 锚定。

### 20.3 测试面连带修复

- `foodOptimizerTestSupport.js`：fixture 请求统一带 `useWasmEngine: true` + 模块
  加载时一次性注入真实 wasm 引擎（roundCache / sharedRounds / inactive 等真轮次
  用例零改动走 wasm）；新增 `simulateFoodOptimizerRoundOnJsEngine`——逐字复刻删除前
  JS 分支（git HEAD @ simulateFoodOptimizerRound 的种子播种 + CombatSimulator +
  观察器 + shouldStop 路径），作为 parity/wiring 对账的 JS oracle（定案 D2 的
  golden 快照在 21B 落地前的过渡）。
- `foodOptimizerSimulation.js`：`buildRoundSample` / `shouldInstallCostBoundObserver`
  导出（wasm 路径与 JS oracle 共用单一形状/判定来源，防镜像漂移）。
- `wasmProductionWiring.test.js`：「回退 JS 成功」两处断言改为「拒绝（throw）」；
  JS-vs-wasm 样本对照的 JS 侧换 oracle。
- `wasmEngineProductionParity.test.js`：三个优化器用例的 JS 侧（24h 轮次、costBound
  剪枝轮、安装守卫拒绝轮）换 oracle。
- `foodOptimizerCostPruning.test.js`：spyOn CombatSimulator 的事件/RNG 前缀对照用例
  改写为 wasm 轮行为断言（两侧一致性由 parity oracle 对账覆盖）。
- worker.js 动态 import 改静态具名 import。

### 20.4 验收

- `cargo test` **128 passed**（+1 clear_ccs 回归）；`build:wasm`
  （wasm-opt -O4：940154 → 821690 bytes，-12.6%）。
- A 层零生产消费审计（grep 全仓生产文件）：生产代码对 combatSimulator 的 import 仅剩
  `foodOptimizerSimulation.js` 的 `createFoodOptimizerSimulation`（无生产调用方，测试
  oracle 专用，21B 处置）。
- `npm test` 192 文件 / **2655 passed + 5 skipped** + prettier 全绿；`npm run build` →
  `verify-pages-build` 全过。

### 20.5 仍留 JS 的部分（截至切片 21A）

1. A 层文件本体（combatSimulator.js / combatActions.js / combatPreviewContext.js /
   events/ / simResult / foodOptimizerSimResult / drops / dataBuffValidation）：
   供测试 oracle（`simulateFoodOptimizerRoundOnJsEngine` / parity 对账 /
   `createFoodOptimizerSimulation`）与 `CombatPreviewContext` 基类使用——**物理删除
   与 oracle 改 golden 快照在 21B**。
2. 公会试炼与无区域：**生产不可达的预留语义**（同 §17.5），接入时再评估。

## 21. 切片 21B：JS 引擎物理删除 + golden 快照 + 开关清理（2026-09-30）

21A 证明 A 层零生产消费后，本片完成审计定案的剩余三步：**物理删除** A 层、parity
oracle 改 **golden 快照**（定案 D2）、`useWasmEngine` 开关与 JS 基准脚本处置。

### 21.1 物理删除清单

生产文件（6 个，B 层全部保留）：

- `combatSimulator.js` / `simResult.js` / `foodOptimizerSimResult.js` /
  `dataBuffValidation.js` / `events/eventQueue.js` / `events/scrollRenewalEvent.js`。
- **不能删**的连带件：`events/` 其余 18 个事件类（`combatActions.js` 的
  `CombatActionsCore`——预览基类——import 它们；`drops.js` 被 B 层 `monster.js`
  引用）、`combatUnit.js` / `player.js` / `zone.js` 等 B 层本体。

引擎测试（8 个删除）：

- `combatSimulator.test.js` / `combatSimulatorLogging.test.js` /
  `combatSimulatorMinimalResult.test.js` / `eventQueueQueries.test.js` /
  `dataBuffValidation.test.js` / `combatEngineParityHarness.test.js` /
  `combatScrollRuntime.test.js`（整体依赖卷轴运行时）/
  `support/syntheticCombatScenario.js`。
- `simulatorRealmReuseParity.test.js`（§54 JS realm 复用防线，前提消失）。

生产引用清零：`foodOptimizerSimulation.js` 删 `createFoodOptimizerSimulation` 与
CombatSimulator import；wiring / playerRoundtripParity / wasmEngineBenchmark 的
import 一并清理。历史注释（combatActions / combatPreviewContext / seededRandom
提及 CombatSimulator）按架构沿革保留，不清洗。

### 21.2 golden 快照设施（定案 D2）

JS 引擎删除后，「JS vs Rust 双引擎对账」的 parity 测试改为**固定输入 → 固定期望
JSON**：期望值以当前 wasm 引擎输出生成并提交进仓库，之后任何输出漂移（引擎行为 /
游戏数据表 / 桥序列化变化）都会翻红。行为语义的回归防线在 cargo test（128+ 用例），
本套只锁「wasm 输出字节不漂移」。

- 助手：`src/services/__tests__/support/goldenSnapshot.js` 的
  `expectMatchesGolden(name, actual)`——`GOLDEN_UPDATE=1` 时写文件否则比较；
  JSON 往返归一（undefined 自有属性消失，对齐 Rust `to_value` 的「键不存在」语义，
  **不能用于含 undefined 语义的断言**）。
- 再生成：`node scripts/generate-wasm-golden.mjs`（内部以 `GOLDEN_UPDATE=1` 跑
  3 个 parity 套件）。**再生成后提交前必须人工 diff——golden 变化必须能归因到
  有意的行为/数据变更**（golden diff review 义务）。
- 产物：`src/services/__tests__/fixtures/golden/` 共 29 件 3.56MB（21 个 production
  轮 + simulator-targeted-a/b + simulator-fuzz-5/17/33 + eventqueue-targeted +
  eventqueue-fuzz-1/7；最大单件 `dungeon-1h-logs.json` 1.12MB）。已加入
  `.prettierignore`（脚本生成物，prettier 重排会与再生成器的
  `JSON.stringify(2)` 输出冲突；比较按 parse 后对象进行，重排无语义价值）。

改 golden 的测试：

- `wasmEngineProductionParity.test.js` 全量重写：删全部 JS runner（5 个 runJs* 与
  firstDiff / jsonProjection），保留全部 payload 构造器与防退化断言，19 用例对
  `production-*.json`。
- `wasmEngineSimulatorParity.test.js`：runRustScenario + `simulator-*.json`，
  断言 `rustResult.error` 为 null。
- `wasmEngineParity.test.js`：队列 2 用例改 `eventqueue-*.json`；mulberry32 /
  hashSeed / deriveSeedSet 纯函数对账保留（seededRandom.js 生产在用）。
- `wasmSimulatorParitySupport.js` 手术：删 ParitySimResult / describeEvent /
  ParityCombatSimulator / runJsScenario / findSimulationDivergence 等约 360 行，
  保留序列化 + 场景构造；`wasmEngineParitySupport.js` 删 driveJsEventQueue，
  保留 findTraceDivergence（unitParity 用）+ op 构造器。

### 21.3 oracle 消费方改写

- `foodOptimizerTestSupport.js` 重写：删 JS oracle（referenceFoodOptimizerRound /
  simulateFoodOptimizerRoundOnJsEngine / installLegacy* / createReferenceSimulation），
  保留 fixture（**不再带 useWasmEngine 字段**）/ referenceDeathBudget /
  physicalFoodOptimizerResult + 模块级一次性 wasm 引擎注入（真轮次用例零改动走 wasm）。
- **TopTen / Pruning 集成 harness**：参照臂改「逐轮直调
  `simulateFoodOptimizerRound`（预算 Infinity 跑满、含不可行候选）后自行聚合」——
  不走生产 evaluator、不用轮次缓存、无成本剪枝；Pruning harness 参照臂走生产
  evaluator（同引擎同种子，确定性保证逐候选一致）。describe 名去误导性的
  "native-engine oracle"。
- `foodOptimizerRoundCache.test.js`：缓存命中 vs wasm 重跑等价（阈值观测字段
  equivalentThresholds / unusedFoodThresholds / inactiveFoodThresholds 属轮次缓存
  簿记，比较前两边剥离）。
- `foodOptimizerSharedRounds` / `foodOptimizerInactive.integration`：reference 改
  `evaluateFoodOptimizerCandidate(request, target, Infinity)` 独立 evaluator 真跑。
- 引擎 B 层测试改写：residualNonCombatDrink（映射守卫 + wasm 快照断言）/
  partyAuraPreview（删端到端对照）/ combatUnitBuffSources（preview 等价断言）/
  buffSourcePolicy / profitEstimator.scrollBuckets / playerRoundtripParity（改
  wasm 动态注入）/ wasmEngineBenchmark（对照臂改 wasm-A/wasm-B）。

### 21.4 useWasmEngine 开关清理

- 删 5 处生产构造：`simulationDomain.js` / `advisorDomain.js` /
  `advisorRunExecution.js` / `simulatorSimulationActions.js`（两处）。
- `shouldUseWasmOptimizerRound` 函数 + 调用 + 判据用例全删（判据无意义，
  `tryRunWasmProductionRound` 调用处硬编码 true）。
- **保留的例外**：
  - `foodOptimizerSnapshot.js` 的 `useWasmEngine: true`——该字段进输入签名，删除
    会让存量缓存签名复活 = 隐性行为变化（注释已说明）。
  - `multiWorker.js` 透传与 `worker.js` 无条件兜底——worker 消息形状兼容。
  - `wasmProductionSimulation.js` 的 `useWasmEngine` 参数——API 形状（显式 true
    才尝试），wiring 测试用它构造拒绝路径（disabled / no_zone / engine_unavailable
    等诊断码断言）。

### 21.5 scripts 处置

删除 6 个 JS 基准/研究脚本：`benchmark-food-optimizer.mjs` /
`benchmark-food-optimizer-top-ten.mjs` / `benchmark-combat-engine.mjs` /
`trigger-optimizer-racing-study.mjs` / `trigger-optimizer-racing-study.engine.mjs` /
`benchmark-food-optimizer-wasm.mjs`（js/wasm 双臂 A/B，js 臂前提已死——引擎
wasm-only 后无 JS 路径可跑）；连带孤儿 `wasmOptimizerBenchmarkBridge.js` 与
`tmp/wasm-optimizer-benchmark/`。`package.json` 删 `benchmark:combat-engine` 与
`benchmark:wasm-optimizer` 两条 scripts。保留 `benchmark:wasm-engine`
（`run-wasm-benchmark.mjs`，wasm-only 有意义）。

### 21.6 验收

- `npx vitest run`：**184 文件 / 2570 passed + 5 skipped 全绿**（13 个失败文件
  修复：TopTen×4 / Pruning×2 / advisorDomain / simulationDomain / roundCache /
  combatUnitBuffSources / partyAuraPreview 等）。
- `cargo test` **128 passed**（本片无 Rust 改动）。
- `npx prettier --check .` 全绿（`.prettierignore` 增 golden 目录）。
- `npm run build` → `npm run verify-pages-build` 全过。
- grep 审计：生产代码对已删 A 层模块的 import 清零。

### 21.7 仍留 JS 的部分（截至切片 21B，终态）

1. B 层（events 18 事件类 / combatUnit / player / zone / drops / combatActions 的
   `CombatActionsCore` / combatPreviewContext）：预览与光环语义的生产消费仍在，
   **不是**待删项。
2. 公会试炼与无区域：**生产不可达的预留语义**（同 §17.5），接入时再评估——wasm
   桥对二者返回 null，worker 硬失败路径只在生产不可达组合上成立。

### 21.8 残留清扫（同日补刀）

- 死产物清理：`tmp/combat-engine-benchmark/`、`tmp/food-optimizer-benchmark/`（已删脚本的输出目录）。
- `engine/README.md`：slice 表 4/5/6 置 done（6 = 本切片闭环）、parity 探针节改为 golden 快照口径（再生成需显式 `GOLDEN_UPDATE=1`）、基准命令改 `benchmark:wasm-engine`（原 `benchmark:combat-engine` 已删，连带删去对已删 `syntheticCombatScenario.js` / `combatEngineParityHarness.test.js` 的引用）。`engine/pkg/README.md` 是 wasm-pack 生成物，不手改。
- 悬空注释指针重定向：`triggerOptimizerCandidates.js`（4 处）/ `triggerOptimizerDomain.js` / `buffSourcePolicy.test.js` 中指向已删 `combatSimulator.js`（含行号）的引用，改指 `combatActions.js`（21A 方法体逐字搬移地）。
- 过时契约注释更新：`wasmProductionSimulation.js` 头部与 `wasmProductionBridge.js`（3 处）的「静默回退 JS 引擎」措辞改为「worker 硬失败、无 JS 回退」（审计定案 D1 终态）；「与 JS 引擎逐字段一致（parity 对账）」改 golden 快照口径。
- 死导出收回：`foodOptimizerSimulation.js` 的 `buildRoundSample` / `shouldInstallCostBoundObserver` 去 export（21A 为 JS oracle 增设的出口，消费方已随 oracle 删除，grep 确认仅剩模块内调用）。
- 复验：全量 vitest **184 文件 / 2570 passed + 5 skipped**、prettier 全绿（engine/README.md 格式化后）。
- 基准冒烟（`WASM_BENCH=1`，全量测试不覆盖该套件）：改臂后首次真实运行 **5/5 绿**，wasm-A/wasm-B 双臂 deaths 逐字段一致（顺带验证引擎确定性）；`run-wasm-benchmark.mjs` 头注释更新为双臂口径。
- golden 确定性往返：`node scripts/generate-wasm-golden.mjs` 再生成全部 29 件 → SHA256 **零变化**（快照设施自洽：同一输入两次生成字节稳定，再生成入口可用）；§12.4 的 `benchmark:wasm-optimizer` 历史数字段加删除注记。

## 22. 切片 22：worker 交付体积治理——入口合并消除重复 bundle（2026-09-30）

切片 21 后构建产物里真正的大头不是主 chunk（index 554KB gzip + gameData 142KB +
playerMapper 208KB gzip，首屏已按需懒加载），而是 **4 个 worker bundle**：
foodOptimizerWorker 3680KB、worker 3671KB、enhancementWorker 984KB、skillingWorker
971KB——每个都是一次独立的完整打包。

### 22.1 死路：worker.format='es'（实证否决）

Vite 5 的 worker 是**每个入口一次独立的 Rollup 构建**：`worker.format: 'es'` 只改
输出语法（IIFE→ESM），不会把 worker 并进主构建 chunk 图；`manualChunks` 对 worker
构建无效；`worker.rollupOptions` 的 manualChunks 也只在自己那次构建内拆分（树摇
差异导致 gameData 纯数据 chunk 的内容/哈希与主构建不同，无法借哈希碰撞去重）。
upstream 未支持跨构建共享（issue #2862/#7015）。实测加配置后 4 个 worker bundle
字节数零变化。配置与配套断言已回退，结论留档 memory pitfall。

### 22.2 生路：合并 worker 入口（单 bundle 双协议）

`worker.js` 与 `foodOptimizerWorker.js` 的 bundle 内容近乎全同（各 ~3.67MB =
战斗 B 层 + gameData + wasm 桥），是唯一可靠的去重机会：

- 食物优化器协议（`init` / 裸候选消息，含 `type:'evaluate'` 变体）整体并入
  `worker.js`，消息分发按形状路由（candidate/init/evaluate → 优化器；
  start_simulation → 模拟协议），`src/foodOptimizerWorker.js` 删除。
- `FoodOptimizerWorkerClient` 改为引用同一个 `worker.js` URL。
- 协议处理逻辑逐字保留（含「重叠消息大声失败」守卫），两个直接 import worker
  入口的测试同步改指 worker.js。

### 22.3 效果与验收

| bundle                     | 前     | 后                                |
| -------------------------- | ------ | --------------------------------- |
| foodOptimizerWorker        | 3680KB | **（消失）**                      |
| worker                     | 3671KB | 3789KB（+118KB = 优化器协调逻辑） |
| 浏览器总下载（双功能用户） | 7351KB | **3789KB（-48%）**                |

- 单功能用户不受影响（仍只下载自己用到的入口；首页模拟用户 bundle 略增 118KB，
  换取优化器功能零额外下载）。
- 验收：全量 vitest **184 文件 / 2570+5 skipped**、prettier、`build` →
  `verify-pages-build` 全绿。
- 未做（收益递减，留档）：enhancementWorker/skillingWorker（各 ~1MB，共享部分
  较少）合并、主 chunk 内 gameData/playerMapper 的进一步拆分。

## 23. 切片 23：性能摸底——差距重测与「模板 clone」实验否决（2026-09-30）

本片无代码交付（实验已回退、零残留），产出为**测量结论**，修正 §5 的过时对比并否决
一个看似诱人的优化假设。

### 23.1 差距重测（§5 数据已过时）

切片 7–11 的优化叠加后，当前 1h full-result 负载：

| 口径                              | 切片 6 时     | 现在     | 变化      |
| --------------------------------- | ------------- | -------- | --------- |
| WASM 引擎（基准中位）             | 43–49 ms      | 17–24 ms | **~2.5×** |
| 原生 median（production_profile） | —             | 18.7 ms  | —         |
| 事件吞吐                          | ≈0.10–0.12M/s | ≈0.32M/s | —         |

对 mwi-fastsim WASM（0.70–0.88M 事件/秒，§5.1）的差距已从 **6–9× 缩至 ~2.2–2.8×**。
原生/WASM 比值 ~1.2–1.4×，原生 prof 结论可直接指导 WASM 侧。

### 23.2 当前热点分布（prof 10 轮，1h full-result）

| 分段                               | 占 simulate 总时长 | 单次成本                                           |
| ---------------------------------- | ------------------ | -------------------------------------------------- |
| event.abilityCastEnd（含 try_use） | 44%（39%）         | 2883 ns × 24620                                    |
| event.enemyRespawn                 | 31%                | 19339 ns × 2420                                    |
| encounter.instantiate              | 23%                | 14272 ns × 2430（含 build_from_spec 27ms/7170 次） |
| ability.damage                     | 17%                | 1037 ns × 26620                                    |

### 23.3 模板 clone 实验证伪

假设：把 `encounter_templates` 构造期预构建为 `CombatUnit`，刷怪时 `clone()` 替代
逐次 `build_unit_from_spec`。等价性论证成立（build 纯函数、reset 覆盖动态状态、rng
序不变），实现并通过 cargo 128 测试。

实测：`build_from_spec` 27ms → **0.46ms（-98%）**，但 `instantiate` 仅 37.7 → 29.6ms、
总 median 18.7 → 18.1ms（**~1–2%，噪声级**）。剩余成本在 clone 本身（深拷贝
abilities/buffs 全套）+ arena.push + 事件处理联动（clear_matching / unit_hrid /
reset / 记账）——**build 不是瓶颈，瓶颈是「每只怪一份完整 CombatUnit」这一数据布局**。
已回退，结论留档 memory。

### 23.4 后续可行方向（按侵入面排序）

1. **hrid 驻留 u32**（§5.2 首选项）：热点散布在 try_use/damage 的字符串比较，收益
   可观但侵入面大（引擎全量 hrid 字段改型）。
2. **OrderedMap → FxIndexMap**：需引入依赖（indexmap crate），语义同为插入序。
3. **放宽 parity 契约**（换队列/改浮点累加序）：收益最大，但需接受与既有 golden
   快照全部重新生成的口径代价——产品/工程决策，不可与其他优化混做。

## 24. 切片 24：事件队列换装——(time, seq) 全序稳定队列（2026-09-30）

契约放宽后的第一片（用户已批：模拟结果正确即可，golden 作漂移防线而非跨引擎等价证明）。
队列换装自包含、先行跑通新验收协议（cargo 语义测试 + golden 重锚归因 + WASM A/B）。

### 24.1 实现

`engine/src/event_queue.rs`：heap-js 逐行复刻 → `VecDeque<QueueEntry>` 按 `(time, seq)`
升序存储（`seq` 在入队时单调分配，构成全序键）。

- `add_event`：先查队尾——绝大多数调度的时间 ≥ 队尾（事件随时间递增产生），直接
  `push_back`；仅乱序调度（时间早于队尾）时二分定位插入。
- `get_next_event`：`pop_front`（O(1)，恒取全序最小者）；`clear_matching`：`retain`
  单趟（旧版为快照 + 逐身份移除的 O(n²)）；`remove_by_id` 保留 API 但不再被清场路径
  调用（旧版 15840 次/10 轮 → 0）。
- 查询方法（`get_matching` / `contains_*`）签名不变，扫描序从「堆数组序」变为
  `(time, seq)` 序（语义更符合直觉：首个匹配 = 时间最早者）。`simulator.rs` 零改动。

语义变化（有意）：同 time 弹出序 = 入队序（FIFO），不再是堆内部布局序。尾部快速路径
与纯二分逻辑等价——由 golden 复测锁定（27/27 通过、无需重锚）。

### 24.2 验收协议首次运行（全绿）

| 环节                           | 结果                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `cargo test`                   | 128 → 131（+3 队列语义测试；模拟器断言对 tie 序不敏感，无翻红） |
| vitest 全量 + prettier         | 185 文件 / 2575 用例全绿                                        |
| `build` / `verify-pages-build` | 通过                                                            |
| golden 重锚                    | 13/29 件变化，全部人工归因（见下）                              |

golden 归因（键路径集合对比脚本 + 人工抽查）：

- 9 件纯值漂移（键路径集合完全一致：labyrinth / observers / scroll 数值、simulator
  聚合、dungeon-minimal、队列 fuzz 轨迹）；
- 3 件（dungeon-1h / dungeon-1h-logs / scroll-24h）增删全为「编号后缀键」（attacks
  日志随轨迹重编号，值级漂移的另一种表现）；
- 1 件（dungeon-24h）12 个新键 = 新增一段 player1 ↔ butterjerry 遭遇记录（与既有怪物
  记录同构、数值合理，波次轨迹重排的直接结果）；
- 队列 tie 序变化的直接证据：`eventqueue-fuzz-1` 中同 time 的 26/24 弹出序互换。

### 24.3 性能

原生 prof（10 轮，同一 52 KB 生产请求；两轮为背靠背运行、调用数一致）：

| 分段                             | 旧（堆复刻）         | 新（有序队列）          | 变化     |
| -------------------------------- | -------------------- | ----------------------- | -------- |
| `queue.clear_matching`           | 9.19 ms（462 ns/次） | 2.78 ms（140 ns/次）    | **-70%** |
| `queue.clear_for_unit`（嵌套段） | 5.10 ms（714 ns/次） | 1.84 ms（258 ns/次）    | -64%     |
| `queue.get_next_event`           | 3.58 ms              | 1.71 ms                 | -52%     |
| `queue.add_event`                | 3.15 ms（44 ns/次）  | 4.56 ms（64 ns/次）     | +45%     |
| `queue.remove_by_id`             | 1.40 ms（15840 次）  | 0（清场改 retain 单趟） | 消除     |
| 队列段合计                       | 22.42 ms             | 10.89 ms                | **-51%** |

WASM 端到端（full-result 1h；9/15 轮样本、B/A 交替共 13 次运行）：基线 min 23.5 /
median 24.2 ms → 新版 min 22.3 / median 23.5 ms，即 **-3~5%**（与原生推算吻合）。
测量教训：5 轮样本时噪声 ±10%，测不出该量级效应；**9+ 轮 + 交替配对 + min/median
双口径**才可判读。

### 24.4 结论与修正

- §23.4 的「放宽契约收益最大」过于乐观：**12% 是队列段占总时长的比例**（22.4/180.8），
  不是换装可得收益；实际队列段自身 -51%、端到端 -3~5%。
- `add_event` 的 +45% 是二分 + memmove 的代价（尾部快速路径把常态路径拉回 push_back，
  净增 ~1.3 ms/10 轮；prof 读数含记账开销，差异在噪声内）。
- 切片 25 / 26 的预期校准：先按 prof 口径估「该段占总时长比例 × 可削减比例」，再以
  WASM A/B 大样本验证，避免重复「占比 ≠ 收益」的误读。

## 25. 切片 25：hrid 字符串键 → u32 驻留（Hrid）（2026-09-30）

§23 记录的头号候选项（§5.2 首选项）。热路径上的 hrid 字符串（`/buff_types/damage` 一类）
此前承担约 15~30 万次/轮的小字符串分配 / 克隆 / 比较；本切片把引擎内部全部 hrid 键换成
`u32` 句柄（`Hrid`），字符串只在输入 / 输出边界驻留一次。契约放宽后收益由 WASM A/B 裁决
（教训：prof 段占比 ≠ 可得收益）。

### 25.1 实现

新增 `engine/src/hrid.rs`：

- `Hrid(u32)`：Copy/Clone/PartialEq/Eq/Hash（刻意不派生 Ord，避免误用位序比较）；
  `Default` = `Hrid::EMPTY`。句柄 `Hrid::UNDEFINED` 承载 JS `undefined` 的字符串语义
  （只在 `process_attack` 缺字段的错误路径出现，报错文本逐字一致）。
- `Interner`（`by_name` 哈希 + `names` 序号表）+ 线程本地 `INTERNER`；`with_well_known()`
  预注册常量表。
- well-known 常量表**冻结、只可尾部追加**（序号 = u32；共 125 项 0..=124：0-2 哨兵
  EMPTY/UNDEFINED/DEFAULT、3-7 战斗风格、8-11 伤害类型、12-17 效果类型、18-22 目标类型、
  23-62 buff 类型、63-81 事件类型、82-99 触发器、100-105 负面 buff、106-110 光环技能、
  111-124 光环 buff）。
- serde 双向：Serialize 输出原字符串（JSON 形状不变）；Deserialize 走 `deserialize_str`
  visitor 自动注册。

契约层全量替换：`buff / ability / consumable / trigger / sim_events / event_queue / scroll /
unit / sim_result` 及 `simulator.rs` 热路径、探针调用点。三条纪律：

- **输入层保留 String**（UnitSpec / RawBuffInput / UnitOp 等 DTO），调用点 `intern_hrid`；
  **输出层保留 String**（eventTrace / thresholdRanges / zoneName / scrollUsage 等），显式
  `hrid_to_string`。
- 非 well-known 的动态串（`player1..5`、`regen`、`lifesteal` / `manaLeech` / `ripple`、
  `scroll:<item>` 源键、`physicalThorns` / `elementalThorns` 等）按需注册，JSON 输出逐字相同。
- 雷区：`json!({ hrid: ... })` 的键会退化成字面量 `"hrid"`——输出键必须显式
  `hrid_to_string`；`with_hrid` 闭包内禁止再触发驻留（借用冲突）；驻留表按线程独立
  （原生测试每线程一套，WASM 单线程）。

时间语义、随机数消费顺序、错误消息文本均未改动；全部 `expected_json` 硬编码期望一字未改。

### 25.2 验收协议（全绿，零漂移）

| 环节                           | 结果                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `cargo test`                   | 131 → 138（+7 hrid 基建测试，0 警告）                                 |
| golden 快照（四套件）          | **29/29 通过、零漂移**、无需重锚（JSON 形状不变的直接证明）           |
| vitest 全量 + prettier         | 185 文件 / 2575 用例（2570 passed + 5 skipped）全绿                   |
| `build` / `verify-pages-build` | 通过                                                                  |
| 产物体积                       | 810784 B（`0207EE46…`）→ 802422 B（`04C5E57A…`），wasm-opt -O4 -12.8% |

### 25.3 性能

**WASM 端到端**（full-result 1h；基线 / 新版交替 5 轮、每轮 15 回合；同一调用内两臂读数
合并，各 n=10，同会话同机）：

| 指标（引擎耗时） | 基线（切片 24，`0207EE46`） | 新版（切片 25，`04C5E57A`） | 变化              |
| ---------------- | --------------------------- | --------------------------- | ----------------- |
| min              | 23.3 ms                     | 15.3 ms                     | **-34%**          |
| median           | 27.4 ms                     | 18.8 ms                     | **-31%（1.46×）** |
| max              | 32.8 ms                     | 21.4 ms                     | -35%              |

基线当日读数高于切片 24 归档（min 22.3 / median 23.5），系会话噪声；交替配对设计抵消
漂移，比率有效。逐轮配对 5/5 新版更快；事件吞吐 ≈0.32M/s → **≈0.47~0.49M/s**（对
mwi-fastsim 0.70–0.88M/s 的差距缩至约 1.5–1.9×）。

**原生 prof**（10 轮 + 2 预热，同一 52 KB 生产请求）：

| 分段                   | 切片 24              | 切片 25             | 变化        |
| ---------------------- | -------------------- | ------------------- | ----------- |
| 壁钟 median / min      | 16.8 / 16.3 ms       | 13.2 / 11.7 ms      | -21% / -28% |
| `simulate(total)`      | 144.88 ms/10 轮      | 122.47 ms/10 轮     | -15%        |
| `event.abilityCastEnd` | 64.55 ms（24620 次） | 53.91 ms            | -16%        |
| `ability.try_use`      | 57.08 ms（24620 次） | 46.04 ms            | -19%        |
| `event.enemyRespawn`   | 43.38 ms（2420 次）  | 37.10 ms            | -14%        |
| `ability.damage`       | 25.81 ms（26620 次） | 20.58 ms            | -20%        |
| `unit_hrid`            | 6.90 ms（43 ns/次）  | 4.92 ms（31 ns/次） | -29%        |

WASM 收益（-31~-34%）大于原生（-21~-28%）：wasm 侧字符串分配 / 比较的单位成本更高，
消除后省得更多。

### 25.4 结论

- 契约放宽后的第一个完整「A/B 裁决」闭环：端到端 **-1/3**，且 golden 零漂移（比验收
  下限更强——连输出形状都未变）。§23 头号遗留项清账。
- `unit_hrid` 仍有 159260 次/轮 × 31 ns ≈ 4.9 ms/10 轮：调用点多为「按 UnitId 取句柄」
  的一次查表，后续可在热点循环内缓存句柄。
- 与 mwi-fastsim 的剩余差（约 1.5–1.9×）→ 切片 26 候选：结算 / 施法路径剩余克隆、
  `OrderedMap` 底层结构（FxIndexMap）、热点循环句柄缓存。

## 26. 切片 26：重生路径死槽复用——池化重建 + 记账槽位化（2026-09-30）

三岩石第三块（§23.2 热点：`enemyRespawn` 段 + `instantiate` 段合计占 simulate 约 40%）。
此前每次重生都 `arena.push` 一个新 `CombatUnit`（深拷贝模板 + 全新分配），arena 与分配
只增不减；本切片改为**死槽原位重建 + 按 (hrid, tier) 键池化复用**，并把切片 14 记账从
UnitId 列表改为**按槽位下标索引**（旧 WeakSet 式语义阻碍槽位复用，属同一原子改动）。

### 26.1 实现

四文件（`simulator.rs` 为主战场，`unit.rs` / `sim_unit.rs` / `ordered_map.rs` 配套）：

- **`CombatUnit` 复用基建**（`unit.rs`）：新字段 `respawn_pool_key: Option<String>`
  （仅带池键的敌人参与复用；玩家 / 探针恒 `None`）；新方法
  `reset_to_default_in_place()`——把全部字段恢复 default 形态（abilities / food /
  drinks `resize` 保留容量后逐槽清空、`CombatDetails::default()`、各 OrderedMap 重建），
  注释注明「新增字段必须与 `Default for CombatUnit` 同步维护」。
- **死槽释放**（`sim_unit.rs`）：`UnitArena::release(id) -> CombatUnit`，`Vec::swap_remove`
  语义——**末位单位换入该下标、其余下标不变**（非顺序删除、无 -1 平移）；模块 doc
  补例外注记。`ordered_map.rs` 新增 `values_mut()`（键序不变，池索引重映射用）。
- **build 拆分**（`simulator.rs`）：`build_unit_from_spec` 拆出公共主体
  `apply_unit_spec(unit, spec) -> Result<(), UnitError>`；新
  `CombatUnit::restore_for_respawn(unit, spec, pool_key, tier)`：`reset_to_default_in_place`
  → `is_player` → `apply_unit_spec` → 写 `difficulty_tier` / `respawn_pool_key`（与 build
  逐字段一致，由复用开 / 关双跑测试锁定）。
- **池与记账槽位化**（`simulator.rs`）：`pool_by_key: OrderedMap<String, Vec<UnitId>>`
  （键 `"{hrid}|{js_number_key(tier)}"`，迷宫 override `"|lab"`）；计数器
  `pool_reuse_hits` / `pool_build_misses`；`enemy_death_snapshots` / `experience_awarded`
  改为**下标 = 槽位** 的 `Vec` 记账表（`pending_experience_gains` 键恒玩家、保持线性）。
  入池链：`release_dead_enemy_slots`（仅收回「已死 + 有池键」槽位）→ 事件已清 + 记账
  已清 → 入池；接入 `check_encounter_end` 清场分支与副本团灭分支两处。
- **swap 重映射**（`simulator.rs`）：`remove_slot_or_degrade(slot) -> bool` 前置检查
  （非玩家、不在 `enemies`、末位非玩家、末位无队列事件引用）→ `try_clear_events_for_unit`
  → `arena.release` → `remap_unit_ids_after_release(removed, moved)`；任一不满足返回
  false **降级（不 panic）**。重映射覆盖 `players` / `enemies` / `observer_unit` /
  `cost_bound_unit` / `pending_experience_gains` 键 / `enemy_death_snapshots`（含内部
  玩家下标）/ `scroll_runtime[].player_id` / `pool_by_key` 全部桶；记账表按槽位搬移。
  **复用前提链：入池 ⇒ 事件已清 + 记账已清**；`restore_for_respawn` 必须覆盖
  `apply_unit_spec` 的全部写入字段。
- **升变产物入池**：`process_ability_promote_effect` 给升变产物设
  `respawn_pool_key = "{hrid}|{js_number_key(tier)}"`（跨轮复用同一键空间）。
- **无效 / 退化输入**（模板缺失、tier 不可渲染、`is_player` 不符）走 build 回退并
  计数 / 降级，不 panic。

### 26.2 验收（全绿，零漂移）

| 环节                            | 结果                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `cargo test`                    | 138 → **143**（+5：swap 重映射 ×3、复用双跑全等、跨轮池命中） |
| `cargo check --release` / tests | 0 警告                                                        |
| golden 快照（四套件）           | **29/29 通过、零漂移**、无需重锚                              |
| vitest 全量 + prettier          | 184+1 文件 / 2570 passed + 5 skipped 全绿                     |
| `build` / `verify-pages-build`  | 通过                                                          |
| 产物体积                        | 802422 B → **812002 B**（sha `92AD25EC…`；glue 未变）         |

### 26.3 性能

**WASM 端到端**（full-result 1h，seed 101；同进程交错法，详见 26.4）：三连测 median
speedup **1.0802× / 1.0639× / 1.0551×**（wins 51/60、91/120、83/120）；自对照（两臂同
产物）120 轮 1.0033×、wins 56/120 ⇒ 方法无偏置。**裁决口径：引擎耗时 -5.2% ~ -7.4%**。
旧跨进程协议（`WASM_BENCH_ROUNDS=15`，base/new 各 6 次追加）：12 对 wins 9/12、median
17.15 → 15.65 ms（-9%）、配对差值 median +0.99 ms——方向一致、幅度偏大（噪声未压干）。
吞吐 ≈0.35M → ≈0.37M 事件/s（1h full-result 单轮 5486 事件；跨会话绝对值仅供参考）。

**原生 prof before/after**（同会话、同请求、10 轮；基线 = 切片 25 源码
`git show db48b83` 换入独立目录单独构建，当前版 = engine 本体）：

口径A（minimal，`tmp/prof-request.json`）：

| 分段                       | 切片 25                 | 切片 26                        | 变化        |
| -------------------------- | ----------------------- | ------------------------------ | ----------- |
| 原生壁钟 median / min      | 13.4 / 11.6 ms          | 10.5 / 9.5 ms                  | -22% / -18% |
| `simulate(total)`          | 122.64 ms               | 101.16 ms                      | -18%        |
| `event.enemyRespawn`       | 36.34 ms（15017 ns/次） | 21.66 ms（8951 ns/次）         | **-40%**    |
| `encounter.instantiate`    | 25.61 ms                | 12.35 ms                       | **-52%**    |
| `unit.build_from_spec`     | 16.30 ms（7170 次）     | 0.37 ms（140 次）              | **-98%**    |
| `unit.restore_for_respawn` | —                       | 9.23 ms（7030 次，1313 ns/次） | 新增        |
| `unit.spec_loadout`        | 5.49 ms                 | 2.20 ms                        | -60%        |
| `unit.spec_apply`          | 3.70 ms                 | 3.10 ms                        | -16%        |

口径B（full-result）：壁钟 median 18.0 → 15.6 ms（-13%）；`simulate(total)` 159.89 →
140.84 ms（-12%）；enemyRespawn 34.82 → 23.19 ms（-33%）；instantiate 24.47 → 13.04 ms
（-47%）；build 15.25 → 0.41 ms（7170 → 140 次）；restore 9.97 ms 新增。

参考归因：`restore_for_respawn` ≈ 1313 ns/次 vs `build_from_spec`（build+spec_apply+
spec_loadout ≈ 3858 ns/次），单次省 ≈ 2545 ns × 7030 次/10 轮 ≈ **17.9 ms/10 轮**——
与 simulate 段 -21.5 ms / 壁钟 -2.9 ms 的观测吻合。

### 26.4 结论与测量法修订

- **方法学修订（重要）**：切片 24/25 的跨进程交替法（base / new 各自独立进程、
  median 比对）在 ≈1 ms/次量级的效应上噪声压不住——切片 26 效应恰在该量级，旧法测得
  -9% 偏大。新法 = **同进程交错 A/B**：同一 vitest 进程加载两个 wasm 实例、逐轮交替
  计时、成对差值 + wins 计数，并以**自对照**（两臂同产物，实测 1.0033× / wins
  56/120）验证无偏置。§24.3 的「**9+ 轮才可判读**」论断需校准：9 轮够判 -31% 级效应，
  但约 5% 级效应需 60~120 轮 + 逐轮配对 + 自对照。
- `remove_slot_or_degrade` 的 swap 语义与降级设计（前置检查不过 → false、不 panic），
  把「复用失败」限制为「性能退化回 build」，不会引入错误状态。
- 记账槽位化与死槽复用是同一提交的原子改动（旧 UnitId 记账在槽位复用下语义失效），
  勿拆半提交。切片 23 证伪的「模板 clone」与本次「原地复用」的本质差别：clone 仍付
  深拷贝 + 新槽累积；复用消除了两者（restore 2.5 μs/次 vs build 3.9 μs/次）。
- 与 mwi-fastsim 的剩余差 → 切片 27+ 候选：结算 / 施法路径剩余克隆、`OrderedMap` →
  FxIndexMap、热点循环句柄缓存（`unit_hrid` 159260 次/轮）。

## 27. 切片 27：结算 / 施法路径深挖——命中键零分配 + 遭遇战判定去克隆（2026-09-30）

按 §26.4 候选开工：先用细粒度 prof 探针把 `ability.try_use`（≈4.3 μs/次）内部构成拆开，
再削减占比最高的两处——`result.add_attack`（每轮约 4700 次命中记账）与
`encounter.check_end`（每轮约 3700 次调用）的克隆 / 分配开销。

### 27.1 实现

**探针（12 处，`#[cfg(feature="prof")]`，生产构建零开销）**：`try_use.pre` / `.effects` /
`.post`（取还式窗口分段）、`ability.damage.setup` / `.parry` / `.parry_body` / `.attack` /
`.body`、`encounter.check_end`、`unit.remove_buff`、`unit.clear_buffs`、`result.add_attack`。

**优化（四文件）**：

- `ordered_map.rs`：新增 `entry_or_default_mut`（`map[k] ??= default` 语义，单趟扫描，替代
  `contains_key` + `set` + `get_mut` 的 2–3 趟）与 `OrderedMap<String, f64>::add_value_str`
  （`map[k] += delta`，键已存在零分配）。
- `sim_result.rs`：`ensure_child` 改走 `entry_or_default_mut`；`add_attack` 命中键改用复用
  缓冲（新字段 `hit_key_scratch`，不参与序列化）。数字键走**写入版** `write_js_number_key`——
  `js_number_key` 抽出写入版后由前者委托，保证 JS `String(number)` 语义（`1e+21` / `1e-7` /
  `-0` → `"0"`）唯一事实源。**首版直接用 Rust `{value}` Display 格式化，`attack_table_nested_keys_match_js`
  立即捕获两个键错（大 / 小量级未走指数写法），改回写入版后 143/143 全绿**。
- `simulator.rs`：`check_encounter_end` 去掉 `enemies` 两次 `clone()`（take → 未清场原样放回、
  清场维持 `None`）与 `players` 的 `clone()`（下标遍历）；团灭分支 `enemies.clone()` →
  `take()`。安全性核对：take 窗口内被调函数（`finalize_enemy_experience` /
  `commit_pending_experience` / `release_dead_enemy_slots` 等）均不读写 `self.enemies`
  （grep 全量 + 函数级目检 + 四路径 case 分析）。
- `unit.rs`：`remove_buff` / `clear_buffs` 落探针（无逻辑改动）。

### 27.2 验收（全绿，零漂移）

| 环节                               | 结果                                       |
| ---------------------------------- | ------------------------------------------ |
| `cargo test`                       | 143 全绿（含捕获并修复的键格式化回归）     |
| `cargo check`（tests / prof 路径） | 0 警告                                     |
| golden 快照（四套件）              | **29/29 通过、零漂移**、无需重锚           |
| vitest 全量 + prettier             | 184+1 文件 / 2570 passed + 5 skipped 全绿  |
| `build` / `verify-pages-build`     | 通过                                       |
| 产物体积                           | 812002 B → **809660 B**（sha `36EE4A0E…`） |

### 27.3 性能

**WASM 端到端**（full-result 1h，seed 101；同进程交错法 120 轮 + 5 预热，每轮交替先后）：

| 轮次                    | A=切片26  | B=切片27  | B/A               | wins B         |
| ----------------------- | --------- | --------- | ----------------- | -------------- |
| 第 1 次                 | 26.117 ms | 23.474 ms | 0.8988×           | 90/120         |
| 第 2 次                 | 24.755 ms | 20.870 ms | 0.8431×           | 105/120        |
| 交换臂（B=切片26）      | 20.650 ms | 23.720 ms | 1.1487×           | 15/120         |
| 自对照（同产物 × 2 次） | 22.9 ms   | 23.4 ms   | 1.0270× / 1.0222× | 48/120、51/120 |

minimal 口径 0.9990× / 0.9791×（wins 61/120、73/120）：`add_attack` 在 minimal 分支不记账，
持平符合预期。**裁决口径：full-result -10% 至 -15%**（交换臂与自对照双向校验；扣自对照
+2.2–2.7% 位置偏置后仍 ≥ 10%）；吞吐 ≈0.37M → ≈0.41M 事件/s（估算，跨会话仅供参考）。

**原生 prof 复测**（同请求 10 轮；before = 本切片优化前读数，after = 3 连跑；绝对值随机器
状态浮动，ns/次 对照为主）：

| 分段                  | before               | after（3 连跑）       | 变化           |
| --------------------- | -------------------- | --------------------- | -------------- |
| `result.add_attack`   | 597 ns/次（28.3 ms） | 241 / 250 / 272 ns/次 | **降 55%–60%** |
| `encounter.check_end` | 283 ns/次（10.6 ms） | 149 / 158 / 158 ns/次 | **降 44%–47%** |
| `simulate(total)`     | 185.4 ms/10 轮       | 143.5 / 149.2 / 153.1 | 方向一致       |

第二批候选（prof 现读数）：`try_use.effects` 2227–2358 ns/次（当前最大单段）、
`event.enemyRespawn` 簇（instantiate + restore_for_respawn）、`unit.update_details` /
`index_buffs`、`attack.schedule` / `triggers.check`、`unit_hrid` 缓存、`OrderedMap` →
FxIndexMap。

### 27.4 结论

- **测量法复用**：切片 26 的「同进程交错 A/B + 自对照 + 交换臂」三件套继续有效；本切片
  交换臂（把两产物角色对调）与直接 A/B 的方向 / 幅度互证（0.8431× vs 1.1487×），是排除
  「实例加载顺序」混淆的低成本手段，建议后续切片沿用。
- **take/restore 改造的核对清单**（本切片确立）：take 窗口内被调函数对目标字段的读写必须
  为空集；用 grep 全量访问点 + 函数级目检 + 路径 case 分析（None / 未清场 / 清场 /
  minimal）三重核对后才可落盘。
- 数字键 / 文本键的「零分配改写」红线：一切格式化的语义必须与既有 `js_number_key` 逐字
  一致（含指数写法与 `-0`）；写入版抽取 + 委托是保持唯一事实源的安全形态。
- 与 mwi-fastsim 的剩余差（约 1.8–2×）→ 切片 28+ 候选见 27.3 末段。

## 28. 切片 28：攻击命中键表换装哈希旁路 + 去残克隆（第二批）（2026-09-30）

切片 27 归因显示 `result.add_attack` 仍有约 250 ns/次；本切片进一步定位到其主体是**最内层
「命中键 → 次数」表的线性扫描**：键数随「不同伤害值」增长（golden 实测 1h 满结果 36 表 /
2521 键、单表最大 267；24h 最大 1068），调用加权平均扫描长度 **1h ≈ 35、24h ≈ 208**——
长时负载（24h）上呈 O(n) 且 n 随轮次增长。换装后 24h 口径引擎耗时直降四分之一。

### 28.1 实现

- **`HitCountMap`**（`sim_result.rs`）：攻击表最内层换用「插入序 + FNV-1a 哈希旁路」计数表。
  小表（≤ 12 项）保持线性扫描（短数字键比较约 2–4 ns，快于哈希约 20–30 ns）；超限后走
  `buckets: HashMap<u64, Vec<u32>>`（`U64Hasher` 直通，避免 SipHash 与随机源），哈希碰撞
  按插入序逐个比较键。索引只在「追加缺失键」时写入——本表只增不减，下标恒有效。
  语义与 `OrderedMap<String, f64>` 的「键在 → 原位累加；键缺 → 追加」逐位一致
  （`attack_table_nested_keys_match_js` + golden 29/29 零漂移锁定）。切片 27 的过渡实现
  `OrderedMap::add_value_str`（唯一调用点即此表）随之删除。
  新增单测：线性段 / 哈希段键序与累加等价、线性段插入的键在哈希段可命中。
- **去残克隆（第二批，`simulator.rs`）**：
  - `process_auto_attack_event`：对侧全集 `clone()` 删除，按下标直读源列表构造存活表；
    `check_parry` 传存活表（候选过滤「存活 ∧ parry>0」对全集与存活子集恒等）。
  - `process_ability_damage_effect`：全集 `clone()` 与逐轮 `collect` 重过滤删除，改为
    「存活表 + `candidates.retain` 单调收缩」（等价性：死单位只减不增、avoid 单调增长，
    故候选表当前态与「对全集重过滤」恒等）。
  - `start_new_encounter`：enemies `clone()` → 下标遍历。

### 28.2 验收（全绿，零漂移）

| 环节                           | 结果                                       |
| ------------------------------ | ------------------------------------------ |
| `cargo test`                   | 143 → **144**（+1：HitCountMap 语义）全绿  |
| `cargo check`（tests）         | 0 警告                                     |
| golden 快照（四套件）          | **29/29 通过、零漂移**、无需重锚           |
| vitest 全量 + prettier         | 184+1 文件 / 2570 passed + 5 skipped 全绿  |
| `build` / `verify-pages-build` | 通过                                       |
| 产物体积                       | 809660 B → **818414 B**（sha `CCA3A1A5…`） |

### 28.3 性能

**WASM 端到端**（full-result seed 101；同进程交错法，1h 120 轮 / 24h 20 轮，每轮交替先后）：

| 口径                    | A=切片27   | B=切片28   | B/A               | wins B           |
| ----------------------- | ---------- | ---------- | ----------------- | ---------------- |
| 1h                      | 20.909 ms  | 20.502 ms  | 0.9805×           | 67/120           |
| 24h                     | 379.381 ms | 282.013 ms | **0.7433×**       | **19/20**        |
| 24h 交换臂（B=切片27）  | 446.345 ms | 589.614 ms | 1.3210×           | **0/20**（反向） |
| 自对照（同产物 × 2 次） | —          | —          | 0.9946× / 0.9808× | 72/120、13/20    |

**裁决口径：24h full-result -25.7%**（交换臂反向 0/20、自对照 -1.9%）；**1h -1.95%**（接近
噪声底线，方向与交换臂一致）。原因即 28.1 的扫描长度：1h 均摊 35、24h 均摊 208，哈希旁路
把每次 `add_attack` 的 O(n) 比较变为 O(1) 查询——**长时负载是被放大的一侧**。

**原生 prof（1h 口径）**：`result.add_attack` 254–281 → 224–237 ns/次（raw -8% 至 -12%，含
机器漂移修正后约 -8%）；`simulate(total)` 144.4–154.3 → 132.8–138.0 ms/10 轮（同轮同向）。
（本机 prof 绝对值漂移大，跨会话只作方向参照。）

### 28.4 结论

- **长时负载的隐性 O(n) 热点**：结算表的键数随运行时长增长（1h 2521 → 24h 16369 键），
  线性扫描成本随之放大；24h 是生产默认视野，该修复对真实用时有直接意义。小表线性 +
  大表哈希的混合策略是安全形态（小表零开销、大表 O(1)，无需随机源）。
- 去残克隆（auto-attack / damage / encounter）为叠加项，量级 1–2%，与主收益同向。
- 测量学补充：**1h 口径的噪声底线约 ±2%**（自对照 0.9946× / 0.9808×）；**24h 口径可放大
  长时热点、给出 25% 级信号**——对「随运行时长增长」的效应，优先用 24h 口径裁决。
- 切片 29+ 候选：`try_use.effects` 内层与 `attack.schedule` 的队列扫描、`update_details` /
  `index_buffs`（SettlementBoosts 构建的栈初始化与分配）、`prod.output` 序列化、热点循环
  `unit_hrid` 缓存、`OrderedMap` → FxIndexMap。

## 29. 切片 29：结算暂存复用 + 效果内环去分配（第三批）（2026-09-30）

切片 28 后重新摸底（原生 prof 10 轮，1h full-result，独占时间 = 段耗时扣除已嵌套子段与
prof 计时器自耗 ~28 ns/次），对候选清单逐一裁决：

| 候选                           | 摸底读数                              | 裁决                                          |
| ------------------------------ | ------------------------------------- | --------------------------------------------- |
| `update_details`/`index_buffs` | index 4.70 ms + update 未归因 ~3.4 ms | **落地**（SettlementBoosts 构建的分配）       |
| `try_use.effects` 内层         | 未归因仅 ~2 ms（真身在 damage 子段）  | **落地**（damage 循环的表分配，清单外重归因） |
| `attack.schedule` 扫描         | 独占 ~2.5 ms（主体是 triggers.check） | 留切片 30（队列本负载深度浅，扫描非瓶颈）     |
| `prod.output` 序列化           | 0.28 ms / 10 轮（0.24%）              | **否决**（死项）                              |
| `unit_hrid` 缓存               | 159260 次 × 28 ns ≈ 计时器自耗        | **否决**（伪热点；真实体 = 单次下标读）       |
| `OrderedMap` → FxIndexMap      | 热点侧表 n ≤ 8、主表已哈希旁路        | **否决**（切片 23 已实证，不重试）            |

### 29.1 实现

- **结算暂存复用**（`unit.rs`）：`SettlementBoosts` 新增 `rebuild`（原地重建）与
  `clear_for_reuse`（12 个逐项槽 `clear` 保容量 + 28 个汇总槽归零为 `BuffBoost::ZERO`，
  与 `Self::default()` 逐字段起点一致）；`update_combat_details` 优先走
  `thread_local` 暂存（`try_with` + `try_borrow_mut`，重入或线程销毁期退回独立构建，
  两条路径输出逐位恒等）。原生 prof：`index_buffs` 4.70 → **1.21 ms**（-74%）、
  `update_details` 9.56 → 5.13 ms。
- **效果内环暂存**（`simulator.rs` 新增 `SimScratch`：`alive` / `candidates` /
  `threat_ranges` / `start_units` 四槽，take → 清空 → 重填 → restore）：
  - `process_auto_attack_event` / `process_ability_damage_effect` 存活表、
    `pick_threat_target` 区间表、`start_attacks` 单位表全部换装；三处错误早退路径
    （无敌人侧 / 不支持目标类型 / `?` 传播）显式归还容量。
  - damage 玩家路径**免候选表**：`avoid_target` 仅由非玩家分支写入（玩家恒空）且目标
    只死不回生，故「候选表收缩后为空」⇔「存活表无存活者」——直接 `any` 判定，省去
    分配与逐轮 `retain`；非玩家路径保持原语义（原地收缩 + threat 选择）。
- **锚定测试 ×2**：`rebuild` 必须清空上一轮全部槽位（脏读回归锚点）；连续两次结算
  （第二次走暂存路径）结果逐位一致——用 `Debug` 表示比对，规避 `tenacity: Some(NaN)`
  这类 parity 契约字段使整体 `PartialEq` 恒假的问题。

### 29.2 验收（全绿，零漂移）

| 环节                           | 结果                                    |
| ------------------------------ | --------------------------------------- |
| `cargo test`                   | 144 → **146**（+2 锚定）全绿            |
| golden 快照（四套件）          | **29/29 通过、零漂移**、无需重锚        |
| vitest 全量 + prettier         | 184 文件 / 2570 passed + 5 skipped 全绿 |
| `build` / `verify-pages-build` | 通过                                    |
| 产物体积                       | 818414 B → **819528 B**                 |

### 29.3 性能

**WASM 端到端**（full-result seed 101；同进程交错法 + 自对照 + 交换臂，1h 120 轮 /
24h 20 轮 + 确认跑 40 轮，每轮交替先后）：

| 口径                   | A=切片28   | B=切片29   | B/A             | wins B                  |
| ---------------------- | ---------- | ---------- | --------------- | ----------------------- |
| 1h                     | 13.070 ms  | 12.511 ms  | **0.9572×**     | 88/120                  |
| 1h 确认跑              | 12.322 ms  | 11.819 ms  | **0.9592×**     | 73/120                  |
| 24h                    | 287.581 ms | 264.738 ms | **0.9206×**     | 14/20                   |
| 24h 确认跑（40 轮）    | 265.679 ms | 253.097 ms | **0.9526×**     | **32/40**               |
| 1h 交换臂（B=切片28）  | 11.342 ms  | 11.955 ms  | 1.0540×         | 28/120（s29 快 92/120） |
| 24h 交换臂（B=切片28） | 257.616 ms | 270.522 ms | 1.0501×         | 10/40（s29 快 30/40）   |
| 自对照                 | —          | —          | 1.0015×–1.0187× | 20/40、56/120（噪声）   |

**裁决口径：full-result -4% ~ -5%（1h/24h 一致）**；24h 合并 46/60 胜、交换臂反向
互证（s28 为 B 臂时恒慢 ~5%），自对照 ≤ ±2% 噪声带。本次是调用次数线性效应
（每次结算/施法省固定分配），不随时长放大——两口径同向同幅符合预期。

**原生 prof（1h 口径，10 轮）**：`index_buffs` 185 → **48 ns/次**、`update_details`
376 → 202 ns/次、`damage.setup` 66 → 34 ns/次；`simulate(total)` 108.5 → 106.1 ms
（原生侧部分收益被 prof 计时器稀释，WASM A/B 为准）。

### 29.4 结论

- **候选清单必须摸底裁决，不能按清单执行**：五候选两死（`prod.output` 0.24%、
  `unit_hrid` 伪热点）一延后（队列扫描），实际落地的 damage 循环分配来自清单外
  的独占时间重归因。
- **prof 计时器自耗 ~28 ns/次是读表底线**：任何 >10 万次的小函数段读数都要先扣
  计时器成本再归因（`unit_hrid` 4.43 ms 全部是计时器开销，真实体 ≈ 单次下标读）。
- `thread_local` 暂存 + take/restore 在 wasm32（单线程）与原生多线程（按线程独立
  暂存）下语义一致；重入与线程销毁期都有零成本退路，是「纯分配优化不改语义」的
  安全形态。
- 切片 30 候选：`attack.schedule` 的 `contains_event_of_types_and_source` 队列扫描
  旁路（源事件位图）、`ability.effect.buff` / `add_buff` 深层（clone 链）、
  `restore_for_respawn` 的 spec 应用链、`triggers.check` 求值短路化（需 parity 放宽
  决策）。

## 30. 切片 30：观察器脚手架短路 + 模板池键预计算 + enrage 清场合并（2026-09-30）

切片 29 后加 11 处细粒度探针（原生 prof 10 轮，1h full-result，独占时间 = 段耗时扣除
已嵌套子段与 prof 计时器自耗 ~28 ns/次），逐一裁决候选：

| 候选                                        | 摸底读数                               | 裁决                         |
| ------------------------------------------- | -------------------------------------- | ---------------------------- |
| `triggers.check` 观察器脚手架（food 槽）    | 57,290 次 × 202 ns（无观察器仍搬状态） | **落地①**（快/慢路径拆分）   |
| `instantiate.lookup`（`format!` + 数字键）  | 7,160 次 × 269 ns                      | **落地②**（构造期预计算）    |
| enrage 双清（两次全队列 retain）            | 2,430 次 × 400 ns                      | **落地③**（合并单趟）        |
| `attack.schedule.scan`（源事件位图）        | 真身 ~15 ns/次、0.66 ms/10 轮          | **否决**（实体太小，勿重试） |
| `buff.add_ability_buff` / `add_buff` 注册表 | 557 ns/次但拆分后小、11 次小表扫描     | 延后（低收益）               |
| `respawn.apply_spec` 链                     | 切片 29 已部分优化                     | 延后                         |
| `unit.clear_buffs` 整表 clone               | 未专项摸底                             | 留后续切片                   |

### 30.1 实现

- **① 观察器脚手架短路**（`simulator.rs` `check_triggers_for_unit`）：food 槽循环拆成
  「无观察器快速路径」（`probe` 恒 `None`，不再每槽位 `take` / 放回 ~48B 的
  `ObserverState`）与「观察器慢路径」（原 take → 构造 `ThresholdObserve` →
  `should_trigger` → **放回先行于 `?`** 的错误路径语义逐字保留）；`observer_unit ==
Some(unit)` 判定提升到循环外（槽位循环内不改写该字段：`should_trigger` /
  `try_use_consumable` 都不动它）。生产路径（观察器恒不安装）省去每单位每轮
  ~3 槽 × 2 次的状态搬移。**语义面未动**：探针记录点、NaN/空槽语义、RNG 与事件流不变。
- **② 模板池键预计算**（`simulator.rs`）：新增 `template_pool_keys: Vec<String>`
  （下标与 `encounter_templates` 对齐），构造期一次性算
  `format!("{hrid}|{}", js_number_key(tier))`；`instantiate_templates` 普通区域分支改为
  **克隆预计算键**（`position` 命中即 entry 的 `(hrid, tier)` 与模板逐位相等；±0 由
  JS 数字键恒等归一），迷宫 `tier_label_override` 分支仍走现算键。**不动 `TemplateSpec`
  结构**（避免破坏 7 处测试构造点与 serde 面）；`js_number_key` 语义未动（红线）。
- **③ enrage 双清合并**（`event_queue.rs` + `simulator.rs`）：新增
  `EventQueue::clear_events_of_types(&[Hrid])`（单趟 `retain`，任一类型命中即清）；
  `start_new_encounter` 的 ENRAGE_TICK / ABILITY_CAST_END 两次全队列清场合并为一次，
  清除集合与保留元素相对 (time, seq) 序不变（EnrageTick 仍在清场之后入队）。
- **探针保留**：本切片新增的 11 处探针（`attack.schedule.scan` /
  `attack.schedule.ability_loop` / `respawn.zone_encounter` ×2 / `respawn.reset_loop` /
  `respawn.enrage_block` / `respawn.reset_default` / `respawn.apply_spec` /
  `instantiate.lookup` / `buff.add_ability_buff` / `buff.schedule_expiration` /
  `unit.reset_cooldowns`）全部 `feature = "prof"` 门控、默认关闭零开销；风格统一为
  `let prof_x = crate::prof::start(...);` + `drop(prof_x);`（`instantiate.lookup` 现只覆盖
  模板查表，键计算已移出热路径）。

### 30.2 验收（全绿，零漂移）

| 环节                            | 结果                                    |
| ------------------------------- | --------------------------------------- |
| `cargo test`（debug + release） | **146** 全绿（无新增/改动测试）         |
| golden 快照（四套件）           | **29/29 通过、零漂移**、无需重锚        |
| vitest 全量 + prettier          | 184 文件 / 2570 passed + 5 skipped 全绿 |
| `build` / `verify-pages-build`  | 通过                                    |
| 产物体积                        | 819528 B → **821202 B**（+0.2%）        |

### 30.3 性能

**原生 prof（1h 口径，10 轮；`tmp/prof-s30-probe.txt` → `tmp/prof-s30-after.txt`）**：
`triggers.check` 202 → **170 ns/次**（11.55 → 9.73 ms）、`instantiate.lookup` 269 →
**64 ns/次**（1.93 → 0.46 ms）、`respawn.enrage_block` 400 → **249 ns/次**（0.97 →
0.61 ms）；`simulate(total)` 118.45 → **114.45 ms**（-3.4%）。

**WASM 端到端**（full-result seed 101，夹具 jungle_planet；同进程交错法 + 自对照 +
交换臂；每轮交替先后，全 3 批 + 5 预热；原始输出 `tmp/slice30-ab/ab-runs.txt`）：

| 批次 | 口径 | A=切片29   | B=切片30   | B/A         | wins B（B 更快） |
| ---- | ---- | ---------- | ---------- | ----------- | ---------------- |
| 1    | 1h   | 20.345 ms  | 19.977 ms  | 0.9819×     | 63/120           |
| 1    | 24h  | 251.353 ms | 240.466 ms | **0.9567×** | 13/20            |
| 2    | 1h   | 21.378 ms  | 20.709 ms  | **0.9687×** | 72/120           |
| 2    | 24h  | 256.951 ms | 254.323 ms | 0.9898×     | 28/40            |
| 3    | 1h   | 14.017 ms  | 12.958 ms  | **0.9244×** | 81/120           |
| 3    | 24h  | 274.197 ms | 262.255 ms | **0.9564×** | 22/40            |

| 对照      | 口径 | A=切片30                       | B=切片29                       | B/A                         | B（切片29）胜率        |
| --------- | ---- | ------------------------------ | ------------------------------ | --------------------------- | ---------------------- |
| 交换臂 ×3 | 1h   | 19.627 / 11.452 / 11.131 ms    | 20.831 / 12.030 / 11.578 ms    | 1.0614× / 1.0505× / 1.0401× | 37/120、44/120、46/120 |
| 交换臂 ×3 | 24h  | 235.639 / 436.883 / 303.938 ms | 247.706 / 451.434 / 320.312 ms | 1.0512× / 1.0333× / 1.0539× | 4/20、12/40、16/40     |
| 自对照 ×3 | 1h   | —                              | —                              | 1.0057× / 1.0016× / 0.9751× | 噪声（±0.2%~2.5%）     |
| 自对照 ×3 | 24h  | —                              | —                              | 1.0020× / 1.0317× / 0.9852× | 噪声（最差批 ±3.2%）   |

**裁决口径：full-result ≈ -4%**（1h 六臂对中位 **-4.5%**、24h 六臂对中位 **-4.3%**；
**12/12 臂对方向一致**——切片 30 恒快）。本机本轮绝对耗时跨批波动近 2×（1h 11–21 ms、
24h 235–451 ms），自对照噪声随之升高，故按「方向 + 中位」裁决、幅度给 ±2% 区间；
本次是调用次数线性效应（每次触发检查 / 刷怪 / 遭遇重置省固定开销），两口径同向同幅
符合预期。

### 30.4 结论

- **脚手架类开销与算法开销同样值得计量**：观察器 `take`/放回看着只是两次字段搬移，
  但在「每单位每轮每槽」的调用频率下值 ~1.8 ms/10 轮。拆分形态（慢路径逐字保留 +
  快路径直呼 `should_trigger(probe: None)`）同时保住了错误路径语义（放回先于 `?`）。
- **构造期预计算 + 克隆 替代 热路径 `format!`**：`js_number_key` 的 JS 语义是红线，
  但它的**调用时机**可动——键在模板构造后恒定，查表命中已证明 `(hrid, tier)` 逐位
  相等，克隆键与现算键逐字符一致（269 → 64 ns/次）。
- **单趟 retain 合并**：同一次遭遇重置里的多次全队列清场可合并（类型判定无副作用、
  保留序不变），是零风险形态。
- 切片 32 候选：`ability.try_use` 的 take/restore 状态搬运（prof 2580 ns/次 × 24620，
  子段 effects 1352 + post 932）、`event.abilityCastEnd` 事件簇（2851 ns/次，最大单段）、
  `event.autoAttack`（1223 ns/次 × 9900）、`event.enemyRespawn` 残余（`zone_encounter` /
  `reset_loop`）、`triggers.check`（171 ns/次 × 57290）、队列系列（`add_event` 54 ns ×
  70930 / `clear_matching` / `get_next_event`）。【切片 31 的逐项裁决与落地见 §31】

## 31. 切片 31：重生链规格计划快照 + 注册表/过期清理深挖（2026-09-30）

切片 30 后按 §30.4 候选逐一摸底（原生 prof 10 轮，1h full-result；基线
`tmp/prof-s31-baseline.txt` 108.98 ms），六候选全部裁定：五组落地、一组否决：

| 候选                                                                                | 摸底读数                     | 裁决                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| `event.enemyRespawn` 大簇（`apply_spec` / `reset_default`）                         | 8665 ns/次 × 2420 轮         | **落地①②**（计划快照 + 复用）                             |
| `checkBuffExpiration` / `remove_expired_buff_by_unique_hrid` 的 `expired_keys` 分配 | 698 / 875 ns/次              | **落地③**（单趟化 + 键收集）                              |
| `add_buff` 注册表 11 次小表扫描                                                     | 455 ns/次 × 5800             | **落地④**（单次查找 + 策略注入）                          |
| `clear_buffs` 整表 clone                                                            | 233 ns/次 × 7170             | **落地⑤**（`clone_from_map`）                             |
| consumable `should_trigger` 的 `category_hrid` 短路                                 | 求值段非显热段（探针）       | 落地⑥（双零短路；微收益）                                 |
| `attack.schedule.ability_loop` 字段缓存                                             | 185 ns/次；should ~4 次/迭代 | **否决**（非热点；真瓶颈在 `ability.try_use`，留切片 32） |

### 31.1 实现

- **① 规格计划预编译 + `stats_snapshot`**（`simulator.rs`）：新增 `CompiledSpecPlan`
  （hrid / two_hand_hrid / `stats_snapshot: Option<CombatStats>` / `numeric_ops` /
  `string_ops`），构造期按 `template.spec` 逐个编译。字段**全部可解析**时，快照 = 在
  `CombatStats::default()` 上逐项应用的结果（字段写入与顺序无关），应用期
  `unit.combat_details.combat_stats = snapshot.clone()`（~600B memcpy）；含未知字段时
  快照为 `None`，走 op 重放——**「先写错误点前字段再报错」的原文语义逐字保留**
  （错误路径测试只断言错误文本）。`CombatStats` 侧新增 `numeric_field_setter` /
  `string_field_setter`（宏生成；`tenacity` / `abilityHaste` 仍在 simulator 侧单独解析）。
- **② 重生复用路径**（`unit.rs` + `simulator.rs`）：`reset_to_default_impl(clear_loadout_slots)`
  拆出 `reset_to_default_keep_loadout()`（重生专用：abilities / food / drinks 槽位内容
  保留、由 apply 覆盖；OrderedMap 一律 `clear()`）；`restore_for_respawn` 改走预编译
  计划（`instantiate_one` 复用与新建两条路径都传 `&plan`）。`apply_unit_spec_with_plan`：
  `house_rooms` / `guild_buffs` / `achievements` / `zone_buffs` / `extra_buffs` /
  `combat_scrolls` 改 `clone_from`，loadout 用 `resize(len.max(4|3), None)` + 同形态
  `clone_from_reuse` + skip 段清空（与 Default(4/3/3) 按需扩展逐位一致）。
- **③ 过期清理单趟化**（`unit.rs`）：`remove_expired_buff_by_unique_hrid` 的
  `buff_sources.contains_key` 门改 `get_mut` 单趟（保留原始借用顺序），过期源 `retain`
  零分配删除；`remove_expired_buffs` legacy 分支由「克隆全部 Buff 值」改为只收集命中的
  键（谓词不变：不在 `buff_sources` 且已过期）。
- **④ `add_buff` 注册表收敛**：`buff_sources.get_or_insert_with` +
  `buff_source_policies.get_mut`（一次查找）；`reconcile_buff_source_live` 增 `policy`
  参数由调用方注入（省一次策略表查找）；策略不符仍**先返回错误再写源表**（原语义）。
- **⑤ `clear_buffs`**：`combat_buffs.clone_from_map(&permanent_buffs)`（复用容量）、三张
  附表 `clear()`。`ordered_map.rs` 新增 `clear` / `retain` / `get_or_insert_with` /
  `clone_from_map` 四个原语（`retain` / `clone_from_map` 不改变键序）。
- **⑥ `should_trigger` 双零短路**（`consumable.rs`）：`food_haste == 0.0 &&
drink_concentration == 0.0` 时跳过 `with_hrid` 类别解析（haste=0 下该判定恒不改变
  结论）。`Ability` / `Consumable` 各增 `clone_from_reuse`（解构绑定 → 新增字段编译期
  报错；`ability_effects` 同长逐项复用内层 `buffs`）。
- **探针**：`attack.schedule` 循环内新增 `ability_should` / `ability_cast` 两枚（feature
  门控）。**注意**：它们真实计时，prof 下把 `ability_loop` 段读数抬高 ~275 ns/次
  （≈6 ms/10 轮），与历史 prof 段对比时需先扣除；生产构建零开销。

### 31.2 验收（全绿，零漂移）

| 环节                            | 结果                                    |
| ------------------------------- | --------------------------------------- |
| `cargo test`（debug + release） | **146** 全绿（无新增/改动测试）         |
| golden 快照（四套件）           | **29/29 通过、零漂移**、无需重锚        |
| vitest 全量 + prettier          | 184 文件 / 2570 passed + 5 skipped 全绿 |
| `build` / `verify-pages-build`  | 通过                                    |
| 产物体积                        | 821202 B → **833013 B**（+1.4%）        |

### 31.3 性能

**原生 prof（1h 口径，10 轮；`tmp/prof-s31-baseline.txt` → `tmp/prof-s31-after3.txt`）**：
`restore_for_respawn` 1258 → **687 ns/次**（-45%）、`respawn.apply_spec` 985 → **499**
（-49%）、`respawn.reset_default` 153 → **64**（-58%）、`spec_apply` 352 → **44**（快照
生效，-88%）、`spec_loadout` 274 → **137**、`remove_expired_buffs` 875 → **451**、
`checkBuffExpiration` 698 → **631**、`add_buff` 455 → 428、`clear_buffs` 233 → 236（噪声）；
`encounter.instantiate` 4513 → **2831（-37%）**。`simulate(total)` 108.98 → 119.36 ms 的
表观抬升 ≈ 探针计时开销（~20 万次开关 × ~~30 ns）+ 机器波动（同二进制重复跑 108~~120 ms），
非逻辑回退——裁决以 WASM A/B 为准。

**WASM 端到端**（full-result seed 101，夹具 jungle_planet；同进程交错法 + 自对照 +
交换臂；每轮交替先后；1h 120 轮 + 24h 40 轮；原始输出 `tmp/slice31-ab/ab-runs.txt`）：

| 臂对   | 口径 | A=切片30          | B=切片31          | B/A         | wins B（B 更快）        |
| ------ | ---- | ----------------- | ----------------- | ----------- | ----------------------- |
| 正向   | 1h   | 11.937 ms         | 10.384 ms         | **0.8700×** | 94/120                  |
| 正向   | 24h  | 266.141 ms        | 219.920 ms        | **0.8263×** | 38/40                   |
| 交换臂 | 1h   | 10.565 ms（s31）  | 12.485 ms（s30）  | 1.1818×     | 25/120（s31 快 95/120） |
| 交换臂 | 24h  | 190.341 ms（s31） | 230.696 ms（s30） | 1.2120×     | 3/40（s31 快 37/40）    |
| 自对照 | 1h   | —                 | —                 | 0.9610×     | 噪声 -3.9%              |
| 自对照 | 24h  | —                 | —                 | 1.0245×     | 噪声 +2.5%              |

**裁决口径：full-result 1h ≈ -13% ~ -18%（正向 -13.0%）、24h ≈ -17% ~ -21%（正向
-17.4%）**——正反臂同向互证（s30 为 B 臂时恒慢 18~21%），自对照 ≤ ±4% 噪声带；两臂
输出逐字节一致（1h 24178B / 24h 135387B）。本次是「重生路径固定开销 + 计划快照」的
调用次数线性效应，24h 因重生次数更多幅度更大，符合预期。

### 31.4 结论

- **「预编译计划 + 快照」是把构造期知识搬到应用期的干净形态**：spec 在模板构造后恒定，
  全字段可解析时应用退化为一次 ~600B memcpy（`spec_apply` 352 → 44 ns/次），未知字段
  走 op 重放完整保留错误路径语义（写入顺序与错误点不动）——比「逐字段 setter 分派」
  更快也更稳（字段新增走编译期报错）。
- **重生复用从「槽位复用」（切 26）深入到「字段复用」**：loadout 覆盖改同形态
  `clone_from_reuse`（不重建 Vec 元素）、default 恢复走保留 loadout 专用入口——
  `instantiate` 段是 WASM 端到端收益的主来源（-37% prof / 1h 总收益超半）。
- **注册表 / 过期清理的「多趟小表扫描」是 unit.rs 的通用形态**：`get_or_insert_with` +
  策略注入（`add_buff`）、`get_mut` 单趟 + `retain`（过期源删除）、键收集替代全量克隆
  （legacy 过期）——均为零语义漂移的「趟数 / 容量」收敛。
- **prof 段读数与 WASM 端到端收益不同量级属预期**：native 与 wasm32 的分配 / 内存
  边界成本结构不同（本轮 end-to-end -13~-18% 远高于 native prof 各段合计），
  与切片 23 起的经验一致——**裁决必须回到 A/B 交错法**。
- 切片 32 候选：`ability.try_use` 的 take/restore 状态搬运（prof 2580 ns/次 × 24620）、
  `event.abilityCastEnd` 事件簇（2851 ns/次，最大单段）、`event.autoAttack`（1223 ns/次
  × 9900）、`event.enemyRespawn` 残余（`zone_encounter` / `reset_loop`）、`triggers.check`
  （171 ns/次 × 57290）与队列系列（`add_event` 54 ns × 70930 / `clear_matching` /
  `get_next_event`）。
