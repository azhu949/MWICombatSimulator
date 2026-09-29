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

| 维度                    | WASM 支持                                              | 说明                                                                                              |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 结果形状                | ✅ 全量：`minimalResult` 与完整 `SimResult`（切片 14） | 完整结果含经验记账 / 掉落上下文桶 / 1000-tick 时序快照 / 激怒层数                                 |
| 区域                    | 普通区域 + **副本**（切片 15）+ **迷宫**（切片 16）    | 副本唯一例外：full-result 且 `logCombatEvents`（wipeEvents 含墙钟时间戳）；迷宫为无 zone 单怪循环 |
| 战斗卷轴                | ✅ 开启（切片 17）                                     | 窗口语义 / 库存记账与 JS 逐位一致；迷宫内自动忽略（`allowed: false`）                             |
| 战斗日志 / HP-MP 可视化 | ✅ 均可（切片 14）                                     | 日志仅控制台输出；可视化无流式 progress（时序随结果一次性返回）                                   |
| 公会试炼                | 否（生产不可达的预留语义）                             | `options.isGuildTrial` 无生产传值点；接入公会试炼模拟时再评估                                     |
| 优化器观察点            | 阈值/闲置观察（切片 13 `observers`）                   | 仅成本上界观察器（`costBound`）留 JS                                                              |
| 提前停止                | 空蓝 / 死亡预算（切片 12 `earlyStop`）                 | 无需留 JS                                                                                         |

> 本表为切片 18 后的当前边界（迷宫细节见第 15 节、卷轴见第 16 节、默认开关与部署见第 17 节）。切片 5–11 期间的历史边界
> （候选轮/阈值轮全部留 JS）见第 11 节勘误与第 12 节——彼时默认生产路径
> （`collectThresholds: reuse` 且 `reuse` 默认 true）的所有优化器轮次实际都走 JS。

据此，食物优化器当前的判据（`shouldUseWasmOptimizerRound`）为：
`useWasmEngine === true && !costBound`——除 top-ten 成本剪枝轮外全部放行
（候选轮的 `earlyStop` 与阈值/闲置 `observers` 分别由切片 12/13 承接；
切片 18 起优化器请求快照默认带 `useWasmEngine: true`，不再依赖调用方显式开启）。

## 4. 结论与建议

1. **JS 引擎保留**：它是唯一全功能实现与 parity 基准（用户定案：最终只保留 WASM，
   待剩余缺口——公会试炼 / 无区域 / 副本日志组合——清零后再删），
   删掉它会让 WASM 的正确性失去参照。
2. **WASM 引擎为默认引擎（切片 18 翻转）**：所有生产载荷默认带 `useWasmEngine: true`
   （首页单轮 / 队列场景与基线轮 / 食物优化器 / 触发器优化器 / 批量区域与迷宫扫描 /
   推荐扫描），引擎缺失 / 配置不支持 / 快照或运行时出错一律静默回退 JS，不会让页面
   不可用；显式 `false` / 缺省的 JS 路径完整保留（测试与实验载荷用）。产物随仓库
   提交（`public/engine/pkg`），CI 无 Rust 工具链也能构建出带 wasm 的部署产物。
3. **端到端提速已兑现（切片 13–17）**：观察器 WASM 化后，默认优化器路径（除成本剪枝轮）
   全部落在 WASM 覆盖内，任务级配对 A/B 实测 **1.50–1.53×**（第 12 节）；切片 14 起
   首页单轮全量结果（full-result + 可视化）也走 WASM，单轮引擎级配对 A/B 实测
   **3.20×**（第 13 节）；切片 15 副本波次纳入覆盖，副本 full-result 单轮实测
   **2.59–2.64×**（第 14 节）；切片 16 迷宫纳入覆盖，迷宫 full-result 单轮实测
   **5.42–5.54×**（第 15 节）；切片 17 战斗卷轴纳入覆盖，卷轴 full-result 单轮实测
   **3.21–3.31×**（第 16 节）；切片 18 生产载荷默认点亮 + 产物进部署链，线上用户
   直接用上 wasm 引擎（第 17 节）。后续扩展方向：剩余留 JS 组合（生产不可达的
   公会试炼 / 无区域语义、副本日志组合与成本上界观察器）。
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
（`scripts/benchmark-food-optimizer-wasm.mjs`）：同一条优化器搜索任务（同一
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

1. 成本上界观察器（`observeFoodOptimizerCostBound`）WASM 化——依赖逐事件成本记账
   下推到 Rust，是优化器路径上最后一块 JS 飞地。
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
3. **成本上界观察器**（`observeFoodOptimizerCostBound`）：依赖 JS 运行时状态，仍留 JS。

### 13.7 剩余候选（更新）

1. ~~副本 / 迷宫支持（`updateTimeSpentAlive` / `wipeEvents` / 波次结算）~~ ——
   副本已于**切片 15** 完成（第 14 节），迷宫仍留 JS。
2. 战斗卷轴窗口语义（`scroll.rs` 空壳）。
3. 成本上界观察器下推（逐事件成本记账）。
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
3. 成本上界观察器（`observeFoodOptimizerCostBound`）。
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
4. 成本上界观察器（`observeFoodOptimizerCostBound`）。
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
3. 成本上界观察器（`observeFoodOptimizerCostBound`）。
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
  成本上界剪枝轮仍由 `shouldUseWasmOptimizerRound` 挡回 JS）。
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
- wasm 失败静默回退 JS：引擎缺失（部署产物不含 wasm）/ 「副本 + full-result + 日志」
  组合 / 运行时出错，页面行为与切片 17 前完全一致。

### 17.5 仍留 JS 的部分（截至切片 18）

1. 「副本 + full-result + `logCombatEvents`」组合（`wipeEvents` 墙钟时间戳）。
2. 成本上界观察器（`observeFoodOptimizerCostBound`，依赖 JS 运行时状态）。
3. 公会试炼与无区域：**生产不可达的预留语义**（无传值点 / 构造保证 zone 或
   labyrinth 至少其一），接入公会试炼模拟时再评估，不计入「删 JS 引擎」缺口。
4. （已消项）~~默认开关翻转~~——本切片完成。
