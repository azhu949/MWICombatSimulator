# 食物优化：跨组合消费核心复用（普通地图成倍提速方向）

2026-09-09 的实施前调查与隔离原型验证。此前已实施的优化包含精确前 10、提前零成本界限、按阈值证据选轴、装备附近有限优先搜索、装备属性复用、同输入报告缓存。本轮不修改生产代码；原型与全部报告位于忽略目录 `tmp/food-optimizer-core-failure`、`tmp/food-optimizer-core-failure-benchmark`。

**本轮找到了普通地图首个可复现的成倍提速方向：把"同组合阈值证书"扩展为"消费核心 + 未触发附加食物"的跨组合证书，并把成本剪枝证明一并纳入。** 隔离原型在页面默认输入（全部 28 种食物、三槽、10% 网格、600 秒 × 3、4,363,634 个候选、四 Worker）上的三次中位数为 **101,651.6 → 25,508.7 ms，3.98 倍；实际模拟轮数 335,298 → 46,698（-86%）**。25% 网格为 3.19 倍。正确性由现有基准的全部断言验证：新旧前 10 逐轮物理结果一致、可行总数（完整统计模式）一致、离散矩形相减覆盖审计无重复无遗漏；五个小域共 6,900+ 候选逐项对照独立原生引擎全部一致。

## 1. 机会：同组合证书无法跨组合复用

`src/services/foodOptimizerPruning.js` 的 `matchRanges` 只按 `compositionKey`（排序后的食物 hrid）在**同一组合**内匹配证据。生产中唯一的跨组合路径是"空食物全域证明"（`unusedFood`）和零成本槽数下界。因此：

- 组合 {A, B} 的失败轮次证明，不能帮助组合 {A, C} 或 {A, B, D} 的候选，即使后者的轨迹与前者完全相同（C、D 从未触发）。
- 轮次缓存虽已有按"消费核心"索引的完整轮次复用（`foodOptimizerInactiveCache.js`，仅接受跑满的轮次），但失败轮次与成本剪枝轮次从不进入任何跨组合存储——而普通地图恰恰以这两类候选为主。

此前 `docs/food-optimizer-user1-directions.md` 第 4 节与 `docs/food-optimizer-user1-long-run-directions.md` 第 2 节的原型已经证明：单轮请求上按消费核心索引失败可减少 72% 轮数，但当时按轮数统计收益、未覆盖多轮请求，且在 24 小时长轨迹输入上未见端到端收益。本轮补齐了三件事：多轮请求的证书语义、成本剪枝证明的纳入、以及按"实际模拟轮次/耗时"而非轮数的验证。

## 2. 机制与正确性依据

原型只改动 `foodOptimizerPruning.js` 的副本（打包时替换），协调器、Worker、模拟器、候选生成均不变：

1. **注册**：每个完成评估的候选结果，把"实际消费的食物"（1 或 2 种；三槽上限下三食物核心不可能出现在其他组合）连同证书写入 `coreGroups`（按核心 hrid 直查，最多单点查询 3 个单核心 + 3 个双核心，无线性扫描）：
   - 空蓝失败：证书为**失败那一个种子**的每槽阈值区间与该轮的未触发界限（评估器在首个失败轮即拒绝，与现有同组合证书语义一致）。
   - 死亡超限、可行、成本剪枝：证书为**全部已执行轮次的交集**区间与未触发界限（保证逐轮轨迹相同，从而累计死亡预算路径与成本下界完全一致）。
2. **匹配**：`matchRanges` 在同组合组未命中后探测核心索引。命中条件：核心食物阈值落在记录区间内；其余食物阈值不低于该轨迹观测到的对应资源缺口下限（沿用空食物全域证明的"不触发即不改战斗"论证）；双核心满足既有的相邻槽序检查（`compareFoodSlots` 为全序，同组食物相对槽序必然一致）。
3. **成本剪枝复用**：成本下界只由"相同轨迹上的相同消费"产生，查询时按当前榜单界限重新验证（与现有同组合成本条目一致），榜单改善只会减少剪枝机会、不会误删能入榜方案。
4. **超集物化**：`materializeFoodOptimizerOutcome` 泛化为"核心区间 + 附加食物零消费"的物化；可行核心逐轮样本精确物化（供审计逐候选对照）；核心块排名的代表选择退回全排列枚举（不给定顺序提示），保证覆盖块中任何可能入榜的签名都不会遗漏。

## 3. 实测：真实 Worker，三次重复取中位数，轮换先后

AMD Ryzen 7 8845H，Node.js v22.20.0。计时包含 Worker 启动、基线、搜索与退出；覆盖审计与独立对账在计时外。原型配置为宽容量（失败/成本核心 16,384 条、可行核心 2,048 条、每核心组 256 条）。

### 普通地图（`/actions/combat/fly`，600 秒 × 3，种子 [1,2,3]，精确前 10）

| 场景                            | Worker |    候选数 |    当前（ms） |   原型（ms） |    加速比 | 实际轮数（当前 → 原型） |
| ------------------------------- | -----: | --------: | ------------: | -----------: | --------: | ----------------------: |
| 四食物，三槽，25%               |      4 |       580 |         418.3 |        359.5 |     1.16× |                 96 → 41 |
| 四食物，三槽，10%               |      4 |     6,095 |         941.0 |        676.4 |     1.39× |              ~490 → 182 |
| 四食物，三槽，5%                |      4 |    39,775 |       2,030.0 |      1,151.9 | **1.76×** |            ~3,322 → 717 |
| 全目录两槽，10%                 |      4 |    46,047 |       4,935.6 |      3,293.9 |     1.50× |          ~8,921 → 5,889 |
| 全目录三槽，25%                 |      4 |   419,091 |      19,859.7 |      6,236.8 | **3.19×** |          55,098 → 9,832 |
| **全目录三槽，10%（页面默认）** |      4 | 4,363,634 | **101,651.6** | **25,508.7** | **3.98×** |        335,298 → 46,698 |
| 四食物，三槽，10%，单 Worker    |      1 |     6,095 |       1,183.4 |        674.6 | **1.75×** |               517 → 181 |
| 四食物，三槽，5%，单 Worker     |      1 |    39,775 |       2,546.5 |      1,240.4 | **2.05×** |             1,977 → 575 |
| 全目录两槽，10%，单 Worker      |      1 |    46,047 |       8,899.8 |      6,373.1 |     1.40× |           8,847 → 5,890 |

每个场景每版本各三次，逐样本见报告；大域三次样本为当前 103,726.2 / 101,651.6 / 100,938.2 ms，原型 25,508.7 / 25,813.3 / 25,426.6 ms，波动远小于组间差距。

### 地下城（次要）

| 场景                      | Worker | 当前（ms） | 原型（ms） | 加速比 | 实际轮数 |
| ------------------------- | -----: | ---------: | ---------: | -----: | -------- |
| 地下城，两槽，25%，600 秒 |      4 |      330.3 |      283.5 |  1.17× | 47 → 17  |
| 无耗蓝地下城，120 秒 × 2  |      4 |      265.9 |      223.2 |  1.19× | 37 → 7   |
| 队伍与卷轴                |      4 |      364.4 |      328.5 |  1.11× | 17 → 11  |
| 地下城，7,200 秒，50%     |      4 |      562.9 |      535.8 |  1.05× | 24 → 9   |
| 同上，单 Worker           |      1 |      610.8 |      664.5 |  0.92× | 24 → 9   |

地下城小域主要由启动开销支配，轮数大幅减少（-63%～-81%）但耗时收益有限；7,200 秒场景单 Worker 组无稳定收益（长轮次昂贵、已受提前零成本界限优化），不宣称地下城成倍提速。

### 完整统计模式（正确性与收益兼测）

`--mode=both --before-mode=complete` 六场景全部通过：完整可行总数与当前版完全一致；top-10 三方一致。完整模式也受益（成本核心不参与、失败/可行核心参与）：zone-mp30-default 1,126.8 → 768.5 ms（1.47×）、全目录两槽 8,588.8 → 5,236.2 ms（1.64×）。

## 4. 迭代过程说明（哪个环节带来多大收益）

| 原型版本                         | 全目录三槽 10%（4 Worker，单次） | 全目录三槽 25%（4 Worker，单次） |
| -------------------------------- | -------------------------------: | -------------------------------: |
| 当前版                           |                        89,364 ms |                        20,093 ms |
| 仅失败核心（容量 4,096）         |                        71,630 ms |                        12,743 ms |
| 仅失败核心（容量 16,384）        |                        49,753 ms |                                — |
| 失败 + 可行 + 成本核心（宽容量） |                        25,655 ms |                         6,232 ms |

两个结论：细网格上**容量是主要约束**（4,096 条时 10% 网格只有 2.84 倍，16,384 条达 3.98 倍）；**成本剪枝证明是最大单项**——流程诊断显示当前版在该大域 278,728 次派发中 31,262 次以成本剪枝返回、几乎占用全部实际模拟轮次，纳入成本核心后派发降至 36,892 次。

## 5. 剩余瓶颈与下一方向（原型 25.7 秒的构成）

对 10% 大域原型的只观测分解：36,892 次派发中 95.5% 仍以成本剪枝返回，每次调用平均约 1.77 ms（含一次往返消息与 ~1.28 轮真实模拟）；Worker 调用时间合计约为墙钟的 2.5 倍（四路并行），协调器自身遍历/匹配约占 9 秒。因此下一批方向按预期收益排序：

1. **派发批量化**：一次 Worker 消息携带一批候选、批量返回，可削减大部分消息往返与调度开销；需要处理进度上报、取消与运行中界限更新的批量语义。
2. **协调器侧零模拟派发的消除**：诊断显示存在部分"已缓存的早期轮次已足以判定拒绝、仍因后续轮次缺失被派发"的候选；允许拒绝先行的部分装配可省去这些纯开销派发（需要区分空蓝与死亡预算语义）。
3. **更细的成本下界**：让成本观察在更早事件上收紧下界（例如结合已见消费速率），减少每次成本剪枝需要模拟的事件数。
4. **容量与逐出策略调优**：核心索引的容量在细网格上仍敏感（见第 4 节），生产接入时应按网格规模自适应或提高默认容量，并保留命中率指标。

24 小时长轮次输入（如 `tmp/user1.json` 熊熊星球 T0）本轮未用新原型复测；此前单轮失败索引在该输入上"轮数 -72% 而吞吐不变"。成本核心改变了部分前提（廉价食物的成本界限同样可以跨组合复用，省去的是重复的长前缀），但长轨迹主导的问题仍在，接入前后应单独测量，不能沿用本轮 600 秒场景的倍数。

## 6. 与既有语义的边界说明

- 跨组合核心证书对可行候选是**精确**的（逐轮样本、消费、成本物化与独立原生引擎逐项一致）；对失败与成本剪枝候选，与现有同组合证书一样只在"分类"层面保证（空蓝/死亡/无法入榜），`roundsCompleted` 可能与目标候选的真实失败位置不同——这是既有语义的沿用，不影响可行性与前 10。
- 三槽上限下三食物消费核心不注册；空食物核心即既有的全域证明路径，不重复注册。
- 死亡失败核心要求全部轮次轨迹相同，累计死亡预算路径因此一致；空蓝核心只证明失败种子本身的轨迹，与评估器"单个失败种子即可拒绝"的规则一致。
- 原型未改动价格规则、槽序比较、种子、候选全集与遍历顺序；同输入报告缓存、跨请求证据复用等既有行为不受影响。

## 7. 验证与复现

- 每个计时场景同时用离散矩形相减完成覆盖审计（无重复、无遗漏、分类与统计一致）；新旧前 10 与基线逐轮物理结果一致；大域另由独立原生引擎复核入榜方案。
- 小域全量逐候选独立对账：zone（580）、zone-mp30-default（6,095）、dungeon（140）、hp-pressure（138）、party-scroll（57）、dungeon-long（57），当前版与原型的每个候选物理结果均与独立引擎一致（覆盖块的每个候选都经过物化后对照）。
- 完整统计模式可行总数跨实现一致。
- 生产源文件未修改；快照与原型记录 SHA-256。没有启动应用、浏览器或 Playwright。

```powershell
# 原型快照（宽容量）
node tmp/capture-food-optimizer-core-failure.mjs --prototype=tmp/food-optimizer-core-failure/foodOptimizerPruningPrototypeWide.js --directory=tmp/food-optimizer-core-failure-wide-snapshot
# 正式计时
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=top10 --before-mode=top10 --before=tmp/food-optimizer-core-failure-wide-snapshot --workers=4 --samples=3 --case=zone,zone-mp30-default,zone-mp30-finer,catalog-mp30-two,dungeon,dungeon-long,hp-pressure,party-scroll,catalog-mp30-three --oracle-limit=10000 --report=tmp/food-optimizer-core-failure-benchmark/formal-4-workers.json
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=top10 --before-mode=top10 --before=tmp/food-optimizer-core-failure-wide-snapshot --workers=1 --samples=3 --case=zone,zone-mp30-default,zone-mp30-finer,catalog-mp30-two,dungeon,dungeon-long --oracle-limit=10000 --report=tmp/food-optimizer-core-failure-benchmark/formal-1-worker.json
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=top10 --before-mode=top10 --before=tmp/food-optimizer-core-failure-wide-snapshot --workers=4 --samples=3 --case=catalog-mp30-three-default --oracle-limit=1000 --report=tmp/food-optimizer-core-failure-benchmark/formal-catalog-default-4-workers.json
# 完整模式正确性
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=both --before-mode=complete --before=tmp/food-optimizer-core-failure-wide-snapshot --workers=4 --samples=1 --case=zone,zone-mp30-default,dungeon,hp-pressure,party-scroll,catalog-mp30-two --oracle-limit=10000 --report=tmp/food-optimizer-core-failure-benchmark/formal-complete-mode.json
# 容量敏感性
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=top10 --before-mode=top10 --before=tmp/food-optimizer-core-failure-snapshot --workers=4 --samples=1 --case=catalog-mp30-three-default --oracle-limit=1000 --report=tmp/food-optimizer-core-failure-benchmark/caps-standard-vs-wide-4-workers.json
# 剩余耗时分解
node tmp/diagnose-food-optimizer-core-failure-flow.mjs --case=catalog-mp30-three-default --step=10 --slots=3 --workers=4
```

原型模块：`tmp/food-optimizer-core-failure/foodOptimizerPruningPrototype.js`（及宽容量副本 `foodOptimizerPruningPrototypeWide.js`）。快照：`tmp/food-optimizer-core-failure-snapshot`（标准容量）、`tmp/food-optimizer-core-failure-wide-snapshot`（宽容量）。报告目录：`tmp/food-optimizer-core-failure-benchmark`（`smoke-zone.json`、`pilot-1-worker.json`、`pilot-catalog-three-4-workers.json`、`pilot-catalog-three-default-wide-4-workers.json`、`pilot-cost-cores-4-workers.json`、`formal-4-workers.json`、`formal-1-worker.json`、`formal-catalog-default-4-workers.json`、`formal-complete-mode.json`、`caps-standard-vs-wide-4-workers.json`）。

生产接入建议：改动集中在 `src/services/foodOptimizerPruning.js` 单个文件（协调器与 Worker 打包共享），需补充核心索引的单元测试（注册/匹配/物化/成本界限重验）、原生引擎回归、取消清理、容量指标，以及 24 小时长输入的专项测量后再合入。

## 8. 生产实施（2026-09-10）

方向已落地：`foodOptimizerPruning.js` 增加消费核心索引（失败/可行/成本三类证书、超集物化、按实例作用域的容量），`foodOptimizerSearch.js` 接入容量选择与命中率指标，`foodOptimizerRoundCache.js` 为每个种子桶启用小额核心预算（64 条）。改动前源码已冻结为快照 `tmp/food-optimizer-consumed-core-before`，下文所有对比都以它为 `--before`。

实现与第 2 节原型的差异：

1. **容量按实例作用域化**。原型把宽容量写进工厂函数默认值，会同时放大轮缓存的每个种子桶（最多 10 个）。生产改为显式选项，并由 `selectFoodOptimizerConsumedCoreCapacity(totalCandidates)` 决定：小于 2,048 个候选用 (1024/256/32)，其余用宽容量 (16384/2048/256)。实测（1 Worker、35 秒预算、页面默认域）：核心索引存活堆增量约 **16.7 MB**（关索引 45.0 MB → 开索引 61.7 MB），保留 2,311 条（可行 2,048 满额、失败 263、71 组、逐出 2,317），是因为可行核心会持有完整多轮结果对象。
2. **命中率指标**：`report.coreMetrics`（probes / hits / records / evictions / failureEntries / feasibleEntries / groups）。它不进 `report.stats`，既有按精确形状比较 `stats` 的断言不受影响。页面默认域命中率约 34%（15 秒 6,056/17,650；35 秒 14,909/43,532）。
3. **修复了原型的一个缺陷**：未触发下界必须对"整个查询域"的每个非核心食物检查，原型只检查被探测的子集。既有 `foodOptimizerRoundCache.test.js` 的两条跨组合断言（阈值 110 出网格、100 低于下界）直接捕获了这一点。另补充核心长度必须相等的判断、注册时拒绝含分隔符的 hrid，核心组键改用 `\u0000` 连接（比每次 `JSON.stringify` 便宜）。
4. 轮缓存核心预算 64/桶（原型为宽默认值）；1 Worker 复测的轮数与原型完全一致（见下表），因此不需要更大的桶预算。

### 复测：4 Worker

| 场景                            |      候选 | 前（ms） | 后（ms） |    加速比 |  轮数（前 → 后） |
| ------------------------------- | --------: | -------: | -------: | --------: | ---------------: |
| zone                            |       580 |      747 |      626 |     1.19× |          96 → 41 |
| zone-mp30-default（四食物 10%） |     6,095 |    1,573 |    1,168 |     1.35× |        491 → 182 |
| dungeon                         |       140 |      553 |      467 |     1.19× |          47 → 17 |
| hp-pressure                     |       138 |      450 |      384 |     1.17× |           37 → 7 |
| party-scroll                    |        57 |      633 |      591 |     1.07× |          17 → 11 |
| dungeon-long（7,200 秒）        |        57 |      948 |      896 |     1.06× |           24 → 9 |
| 全目录三槽 25%                  |   419,091 |   20,241 |    6,643 | **3.05×** |   55,080 → 9,837 |
| 全目录三槽 10%（页面默认）      | 4,363,634 |  174,985 |   45,059 | **3.88×** | 334,717 → 47,145 |

页面默认域三次样本后分别为 45,059 / 45,325 / 39,207 ms，派发 27.8 万 → 3.7 万（36,872），与原型报告的 46,751 轮 / 36,841 次派发几乎一致。注意本轮会话的机器比 2026-09-08 慢：同一份"当前版"代码在该域当时中位数 101.7 秒、本轮 175.0 秒，因此以**比值与轮数/派发数**为准，绝对耗时不可跨会话比较。

### 复测：1 Worker（2 次样本）

| 场景                         |   候选 |    加速比 | 轮数（前 → 后） |
| ---------------------------- | -----: | --------: | --------------: |
| zone                         |    580 |     1.23× |         96 → 41 |
| zone-mp30-default            |  6,095 |     1.63× |       517 → 181 |
| zone-mp30-finer（四食物 5%） | 39,775 | **2.04×** |     1,977 → 575 |
| 全目录两槽 10%               | 46,047 |     1.38× |   8,847 → 5,919 |
| dungeon                      |    140 |     1.05× |         47 → 17 |
| dungeon-long                 |     57 |     1.01× |          24 → 9 |

原型的 0.92×（dungeon-long 单 Worker）不再出现：小域走小额容量，注册与探测开销不再吞掉收益。

### 复测：完整统计模式（4 Worker，1 次样本）

六个场景的可行总数与改动前**完全一致**（273 / 3,970 / 26,114 / 140 / 126 / 10），完整模式加速比 0.98× / 1.35× / 1.83× / 0.92× / 0.97× / 1.08×（zone / zone-mp30-default / 全目录两槽 / dungeon / hp-pressure / party-scroll），小域是启动开销主导、轮数不变时的噪声。

### 复测：24 小时长输入（熊熊星球 T0，28 食物、3 槽、4 Worker、60 秒预算 ×3）

分类候选数中位数 **64,354 → 101,338（+57%）**，模拟轮数 27,466 → 26,052（-5%），首个前 10 时间 7.0 → 7.1 秒，前后共有入榜签名的逐轮物理结果一致（10/10）。解释：真实模拟轮速基本不变（4 个 Worker 一直在算），但同样的轮预算覆盖了更多候选，因此"候选/秒"提升而"轮/秒"持平——这正是此前"轮数 -72% 而吞吐不变"之后最需要单独确认的一点。

### 正确性证据

- 小域逐候选独立原生引擎对账（`--oracle-limit` 覆盖全域，top10 与 before-top10 两侧都跑）：zone 580/580、zone-mp30-default 6,095/6,095、dungeon 140/140、hp-pressure 138/138、party-scroll 57/57、dungeon-long 57/57 全部一致。
- 完整模式六场景可行总数一致（上一节）；`top-10` 逐轮物理结果跨模式一致。
- 大域（4,363,634 与 419,091 候选）为压缩覆盖审计 + 入榜 10 个独立复核：813,763 / 104,998 条覆盖记录经离散矩形相减无重复、无遗漏，分类计数与报告统计一致。
- 全量单测 2,228 通过（含既有 7 场景 oracle 集成测试），`vite build` 通过，prettier 通过。

### 复现命令

```powershell
node tmp/capture-food-optimizer-consumed-core-before.mjs --directory=tmp/food-optimizer-consumed-core-before
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=top10 --before-mode=top10 --before=tmp/food-optimizer-consumed-core-before --workers=4 --samples=3 --case=zone,zone-mp30-default,dungeon,hp-pressure,party-scroll,dungeon-long --oracle-limit=10000 --report=tmp/food-optimizer-consumed-core-benchmark/formal-4-workers-small.json
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=top10 --before-mode=top10 --before=tmp/food-optimizer-consumed-core-before --workers=4 --samples=3 --case=catalog-mp30-three-default --oracle-limit=1000 --report=tmp/food-optimizer-consumed-core-benchmark/formal-default-4-workers.json
node scripts/benchmark-food-optimizer-top-ten.mjs --mode=both --before-mode=complete --before=tmp/food-optimizer-consumed-core-before --workers=4 --samples=1 --case=zone,zone-mp30-default,dungeon,hp-pressure,party-scroll,catalog-mp30-two --oracle-limit=10000 --report=tmp/food-optimizer-consumed-core-benchmark/formal-complete-mode.json
node --expose-gc tmp/measure-food-optimizer-core-memory.mjs --case=catalog-mp30-three-default --workers=1 --seconds=35
node tmp/benchmark-food-optimizer-long-run.mjs --seconds=60 --workers=4 --samples=3
```

报告目录 `tmp/food-optimizer-consumed-core-benchmark`（`smoke-4-workers.json`、`formal-4-workers-small.json`、`formal-default-4-workers.json`、`formal-1-worker.json`、`final-medium-4-workers.json`、`formal-complete-mode.json`、`cap-experiment-4-workers.json`、`long-run-user1.json`）。

### 残留风险与下一步

- 大域非入榜候选的分类仍只有理论 + 小域全量对账支撑（与原型的边界相同）。建议补一次中等域（39,775 候选）逐候选 oracle。
- 容量在细网格仍是主要约束：同一 39,775 候选域，标准容量（4,096）实测退化为 0.91×，宽容量为 1.52×。本实现默认宽容量，但网格更细时需要重新做容量敏感性测量。
- 内存是协调器侧的有界开销（约 17 MB @ 页面默认域），可用 `selectFoodOptimizerConsumedCoreCapacity` 降级。
- 剩余瓶颈仍是派发与协调器遍历（剩余派发约 95% 为成本剪枝返回），要再上一个台阶需要批量化派发，那会动 Worker 协议与进度/取消语义，应与本次分开实施。
