# 技能触发器优化器（Trigger Optimizer）设计文档

> 本文档是「技能触发器优化」功能的完整技术契约。后续 5 个实现节点只需读本文档即可动手，
> 不必重新读源码猜语义。所有行号基于截至 2026-09-17 的源码。

> **装置删除注（2026-10-02 标注）**：本文 §30.8–§63.6 引用的研究装置
> `scripts/trigger-optimizer-racing-study.mjs`（及 `trigger-optimizer-racing-study.engine.mjs`）
> 已于 2026-09-30 随切片 21B「JS 引擎物理删除」一并删除（同批 6 个 JS 基准/研究脚本与
> 孤儿桥接模块；删除记录见 `docs/wasm-engine-performance.md` §21.5）。因此**本文中所有形如
> `node scripts/trigger-optimizer-racing-study.mjs …` 的复现命令均已失效**（约 44 处，
> 自 §30.8 起至文末），原命令保留仅作沿革。各节实测数值与结论仍以本文档存档为准；
> 如需复跑，须按各节对装置行为 / 参数 / 断言的描述重建装置。

## 0. 功能定位

独立菜单页（路由 `/trigger-optimizer`）：用导入的玩家数据，在**当前战斗区域**（首页 simulationSettings
所指定的 zone/difficulty/labyrinth）下，搜索玩家**已佩戴技能（abilities）**的战斗触发器最优配置。

架构模板 = 食物优化器（Food Optimizer）：克隆玩家配置 → 生成候选 → 专用 worker 跑模拟 →
打分排序 → 把最优结果写回玩家 `triggerMap`。差异点见 §7（搜索算法用 coordinate descent
而非全枚举，因为每技能的候选空间是组合爆炸的）。

---

## 1. 触发器四态语义（结论 + 确切依据）

`playerConfig.triggerMap` 是 `{ [targetHrid]: TriggerDto[] }`。targetHrid 可以是技能 hrid、
食物 hrid、饮品 hrid。对某个 targetHrid，存在四种语义状态：

| #   | triggerMap 状态                           | UI 语义（`getEffectiveTriggerState`） | 引擎实际行为                                                        |
| --- | ----------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| ①   | 无键                                      | `default`                             | 使用游戏数据 `defaultCombatTriggers`                                |
| ②   | 有键、非空、sanitize 后与默认签名**相同** | `default`（折叠）                     | 同 ①（`sanitizeTriggerList` 输出等价 DTO）                          |
| ③   | 有键、非空、sanitize 后与默认签名**不同** | `custom`                              | 使用自定义触发器                                                    |
| ④   | 有键、**空列表**（或 sanitize 后为空）    | `disabled`                            | **「无条件立即释放」：每次 `checkTriggers` 冷却好了就放，不是禁用** |

### 1.1 关键结论：空列表 ≠ 禁用

**`triggerMap[hrid] = []` 在引擎里是「无条件立即释放」，不是「禁用」。**

证据链（逐层）：

1. **注入层** `playerMapper.js`：
   - 622: `const triggerMap = sanitizeTriggerMap(playerConfig.triggerMap ?? {})`
   - 674-677（食物）、688-691（饮品）、708-711（技能）：
     ```js
     const customAbilityTriggers = Object.prototype.hasOwnProperty.call(triggerMap, abilityHrid)
       ? toTriggerInstances(triggerMap[abilityHrid])
       : null;
     simulationPlayer.abilities[i] = new Ability(abilityHrid, abilityLevel, customAbilityTriggers);
     ```
   - **`hasOwnProperty` 为 true 时，即使值是空数组，也传入 `toTriggerInstances([])`（返回 `[]`），
     而不是 `null`。**空数组是 truthy。
2. **引擎层** `combatsimulator/ability.js`：
   - 54-67: `if (triggers) { this.triggers = triggers; } else { …默认触发器… }`
     —— `[]` 是 truthy，因此 `this.triggers = []`，**默认触发器被丢弃**。
   - 98-100: `if (this.triggers.length == 0) { return true; }`
     —— `shouldTrigger` 在冷却好了之后**恒返回 true**，即「CD 好了立刻放」。
   - 技能层（`Ability.shouldTrigger`）额外有眩晕/沉默/冷却闸门（80-96），所以不是每 tick 都放，
     而是「每次 checkTriggers 且 CD 就绪时立即释放」。
3. **饮品层** `combatsimulator/consumable.js`：33-49（`if (triggers)` 同款逻辑）、
   80（`if (this.triggers.length == 0) return true;`）——食物/饮品同语义。
4. **旁证**：`playerMapper.js` 769-776 `mapDrinkTriggerMode` 把 `getEffectiveTriggerState` 的
   `'disabled'` 态**映射成 `'always'`**（预览面板用），即项目内部已把「空列表」等价为「总是触发」。

### 1.2 「禁用」在 UI 语义层确实存在，但不是引擎行为

- `triggerMapper.js` 119-168 `getEffectiveTriggerState`：无键→`default`；有键且 sanitize 后为空→
  `disabled`；有键且签名==默认→`default`；否则→`custom`。
- `applyTriggerStateToTriggerMap`（220-239）：`default` 删键；`disabled` 写 `[]`；`custom` 写
  `sanitizeTriggerList(triggerList)`。
- **因此「禁用」只是 UI 的一个状态标签，落盘仍然是 `[]`，引擎跑起来是立即释放。**

### 1.3 候选生成必须遵守的推论

- **「禁用某技能」无法通过 triggerMap 表达**：要真正禁用一个技能，只能摘掉装备槽
  （`abilities[i] = { abilityHrid: '', level: 1 }`）。本优化器**不生成「禁用技能」候选**。
- **空列表 `[]` 是一个合法且常常最优的候选**（尤其增益/光环类技能：CD 好就放）。
  候选集必须包含 `state: 'disabled'`（= `[]`）这一态，但在 UI 展示时要按 §1.1 的语义
  标注为「立即释放」，不要写成「禁用」。
- **危险组合**：`[]`（恒触发）+ 零冷却消耗品 = `checkTriggers` 死循环。
  `playerMapper.js` 683-687 的注释已经说明过这个坑（残留非战斗饮品）。
  **候选生成器必须对消耗品（食物/饮品）跳过 `[]` 候选，或校验 `cooldownDuration > 0`**；
  技能的 `cooldownDuration` 来自 `resolveAbilityDefinition(hrid).cooldownDuration`
  （`ability.js` 16），技能槽一律有 CD（特殊技能除外），技能层可以安全生成 `[]` 候选。
- `sanitizeTriggerMap`（`triggerMapper.js` 85-98）会**保留空数组键**（`sanitizeTriggerList([]) === []`），
  所以候选里写 `[]` 能稳定通过 sanitize 到达引擎。
- **sanitize 只校验触发器条目内容，不校验 target hrid 是否存在**（`sanitizeTriggerMap` 只看键非空，
  值交给 `sanitizeTriggerList`；条目校验依赖 dependency/condition/comparator 三个 JSON）。
  因此候选生成器若写错技能 hrid，sanitize 不会拦——必须自己保证 hrid 来自 `playerConfig.abilities`。
- 上限：`MAX_TRIGGER_COUNT = 4`（`triggerMapper.js` 7），`sanitizeTriggerList` 用 `slice(0, 4)`
  静默截断。候选生成器禁止产出超过 4 条触发器的配置。

### 1.4 多条触发器之间是 AND（全部满足才释放）—— 2026-09-17 补记

原文档（§1 表格）只描述了「四种 triggerMap 状态」，**从未记录多条触发器之间的组合语义**。
本轮实测确认：**是合取（AND），不是析取（OR）**。

证据链：

1. `combatsimulator/ability.js` 102-109：
   ```js
   let shouldTrigger = true;
   for (const trigger of this.triggers) {
     if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) shouldTrigger = false;
   }
   return shouldTrigger; // 任一不满足 → 本轮不释放
   ```
   （循环前 98-100 已有三态分支：`triggers.length == 0 → return true`。）
2. `combatsimulator/consumable.js` 80-82 / 101-107：食物/饮品同款结构（空列表恒真，否则 AND 全过）。

推论（**候选生成必须遵守**）：

- 写 N 条触发器 = 「既要 … 又要 …」，条件越多释放越少；不可能用多条触发器表达「A 或 B」。
- 组合候选只能做**合取式时机收紧**（本轮新增，见 §14.4），例如
  「敌方残血 且 自身蓝量充足」= 大招收尾但不把蓝榨干。
- 同一 condition 在同一候选里出现两次是自我矛盾（`current_hp <= 50` 且 `<= 75` ≡ `<= 50`），
  与单条件候选重复，`compositeCandidates` 的 `push` 直接拒绝。

---

## 2. 可用指标字段清单（打分输入）

### 2.1 `computeQueueMetrics(simResult, preferredPlayerId, pricingOptions)` — simulationDomain.js 409-445

返回对象（**这是主口径**）：

| 字段               | 含义                                                 | 来源         |
| ------------------ | ---------------------------------------------------- | ------------ |
| `dps`              | 每秒伤害（总伤害/模拟秒，含全部攻击事件，miss 跳过） | 414-427, 439 |
| `killsPerHour`     | 每小时击杀（`simResult.encounters` / 小时）          | 435, 440     |
| `xpPerHour`        | 每小时总经验（全部技能经验求和）                     | 429-432, 441 |
| `dailyProfit`      | 日利润（noRng profit × 24）                          | 436, 442     |
| `dailyNoRngProfit` | 同上（别名，与 `dailyProfit` 同值）                  | 436, 443     |

其中 `profit = estimateNoRngProfit(simResult, playerHrid, pricingOptions)`
（`simulationDomain.js` 434，`profitEstimator.js`）。

### 2.2 `summarizeResult(simResult, selectedPlayers, pricingOptions)` — simulationDomain.js 131-166

逐玩家行，字段：`playerHrid`、`playerName`、`simulatedTime`、`encountersPerHour`、
`deathsPerHour`、`totalXpPerHour`、`profitPerHour`、`revenuePerHour`、`expensesPerHour`、
`totalExperience`、`noRngRevenue`、`expenses`、`noRngProfit`、
`{stamina,intelligence,attack,magic,ranged,melee,defense}XpPerHour`。

**死亡口径**：`deathsPerHour = simResult.deaths[playerHrid] / hours`（140）。
`simResult.deaths` 是 `{ [playerHrid]: number }`。

### 2.3 打分用字段（本优化器目标函数）

- `dps`、`dailyNoRngProfit`、`xpPerHour`、`killsPerHour` —— 来自 `computeQueueMetrics`
  （与 `QUEUE_MULTI_ROUND_METRIC_KEYS` 一致，`queueScoring.js` 23）。
- `deathsPerHour` —— 来自 `summarizeResult`（或直接 `simResult.deaths[playerHrid] / hours`）。
- `playerRanOutOfMana[playerHrid]` —— 蓝耗崩盘标记（`foodOptimizerSimulation.js` 151 用它做
  候选否决）。**2026-09-17 更正为配对口径**：不是「任一场空蓝即无条件判负」，而是
  「**基线不空蓝 → 候选空蓝** = 回归 → `-Infinity`」；基线自己就空蓝时，候选空蓝不算退步；
  反向（基线空蓝 → 候选不空蓝）给 `TRIGGER_OPTIMIZER_MANA_RECOVERY_BONUS = 0.25`。
  旧口径会系统性误杀「基线本来就崩蓝」场景下的全部候选。见 §5.2 / §14.3。

### 2.4 时间常量

`ONE_HOUR = 60 * 60 * 1e9`（ns，`simulationDomain.js` 18）；
`simulatedTime` 单位也是 ns。`computeQueueMetrics` 内部已除好，直接用返回值即可。

---

## 3. 外部搜索器运行模拟的确切调用链

```
store.startTriggerOptimizer()
  └─ snapshotTriggerOptimizerInput(store)           [新建，仿 foodOptimizerSnapshot.js]
       ├─ players = store.players.filter(selected || id===activePlayerId)
       │     .map(p => ({ id,name,levels,equipment,food,drinks,abilities,triggerMap,
       │                 combatScrolls,houseRooms,guildBuffs,achievements, selected:true }))
       │     （COMBAT_PLAYER_KEYS 清单照搬 foodOptimizerSnapshot.js 11-24）
       ├─ buildSingleSimulationPayload([], settings, crates, { workerId: 'trigger-optimizer' })
       │     → 取 { zone, labyrinth, simulationTimeLimit, extra }
       │     （simulationDomain.js 281-335；空 players 只是借它的 zone/labyrinth/time/extra 序列化）
       └─ { activePlayerId, imported, players, simulation, pricing }
  └─ prepare(input)
       ├─ mapper.buildPlayersForSimulation(input.players)   [playerMapper.js 2596-2603]
       │     → 过滤 selected → buildSimulationPlayerFromConfig（620-718，含 triggerMap 注入）
       │     → applyDebuffOnLevelGap
       ├─ payload = { ...input.simulation, players: deepClone(simulationPlayers) }
       │     （**关键：payload.players 是引擎 Player 对象（含 triggers 字段），
       │      不是 playerConfig；候选改写的是 Player.abilities[i].triggers**）
       └─ request = { ...input, payload, seeds, rounds, weights }
  └─ 对每个候选：
       candidatePayload = {
         ...payload,
         players: payload.players.map(p => p.hrid === `player${activePlayerId}`
           ? applyCandidateToPlayer(p, candidate) : p)
       }
       runSingleSimulationPayloadWithDedicatedWorker(candidatePayload, onProgress,
         { scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER })   [simulatorWorkerRuns.js 78-147]
       → resolve(simResult)
       → metrics = computeQueueMetrics(simResult, activePlayerId, pricingOptions)
       → score = objectiveFunction(metrics, deaths, weights)
```

### 3.1 候选如何注入 payload（两种等价写法，推荐 A）

**A. 改 Player DTO 的 triggers 字段**（`Player.createFromDTO` 的 DTO 形态，`player.js` 149-168）：

```js
function applyCandidateToPlayer(playerDto, candidate) {
  return {
    ...playerDto,
    abilities: playerDto.abilities.map((slot, i) =>
      candidate.has(i) ? { hrid: slot.hrid, level: slot.level, triggers: candidate.triggersFor(i) } : slot,
    ),
  };
}
```

`Ability.createFromDTO`（`ability.js` 72-77）会把 `triggers` 逐条 `Trigger.createFromDTO`。
**注意：这里的 triggers 是 TriggerDto 数组（`{dependencyHrid, conditionHrid, comparatorHrid, value}`），
不是 Trigger 实例。**

**B. 从 playerConfig 侧改 triggerMap 再重跑 buildPlayersForSimulation**：

```js
const config = { ...baseConfig, triggerMap: { ...baseConfig.triggerMap, ...candidate.triggerMapDelta } };
const players = buildPlayersForSimulation([config]);
```

B 更贴近「写回」语义（`applyTriggerStateToTriggerMap`），但每次重建 Player 对象更贵。

**推荐 A 用于模拟（快），B 用于最终写回（`applyTriggerOptimizerResult`，语义干净）。**
两种方式的等价性由 §1 的注入逻辑保证：`hasOwnProperty(triggerMap, hrid) ? toTriggerInstances(list) : null`
等价于 `Ability(hrid, level, toTriggerInstances(list))`。

### 3.2 并行方式

```js
await runParallelWorkerPool({
  taskCount: candidates.length,
  workerLimit: Math.min(
    normalizeParallelWorkerLimit(store.queueRuntime.parallelWorkerLimit, store.queueParallelWorkerHardMax),
    candidates.length,
  ),
  runTask: (index) => evaluateCandidate(candidates[index]),
  ensureActive: () => {
    if (cancelled) throw cancellationError;
  },
});
```

- `runParallelWorkerPool`（`workerPool.js` 20-42）：固定 worker 数瓜分任务索引；
  `clampWorkerCount=true`（默认）时 worker 数 = `min(workerLimit, taskCount)`；
  `ensureActive` 在每次预留任务前调用，抛异常即中止整个池（取消入口）。
- worker 数钳制：`normalizeParallelWorkerLimit(value, maxLimit)`（`queueScoring.js` 169-177）
  → `clamp([1..64], 1, clamp(maxLimit,1,64))`；
  `store.queueParallelWorkerHardMax` = `getParallelWorkerHardMaxForCurrentMachine()`
  （`simulatorStore.js` 179-185, 415-417）= `clamp(navigator.hardwareConcurrency, 1, 64)`，
  检测不到时回落 64。
- 每个任务内部调一次 `runSingleSimulationPayloadWithDedicatedWorker`，
  scope = `'trigger-optimizer'`（新增，见 §4）。
- **错误语义**：`Promise.all` 语义，首个失败拒绝整池，其余在途任务**不会**被自动取消
  （`workerPool.js` 5-8 注释）。要真正停下来必须靠 `ensureActive` 抛异常 + §4 的 cancel。
- **RNG 隔离与播种（2026-09-17 更正，见 §14）**：`runSingleSimulationPayloadWithDedicatedWorker`
  每个任务起**独立 worker**（`WorkerClient` 47: `new Worker(new URL('../worker.js', ...))`），
  每个 worker 有独立 realm 与独立原生 `Math.random`，所以并行任务之间 RNG 天然隔离。
  **但本契约原文有一处错误结论必须推翻**：worker.js 从未读 `payload.workerId` 去播种——
  workerId 只是日志/调试标识（外加优化器自加的 `#rN` 可读后缀），早期实现里给候选追加
  `workerId#rN` 属于**死代码**。真正的播种入口是 **`payload.seed`**：
  `worker.js` 的 `installSeedScope(seed)` 在 `combatSimulator.simulate()` 前后
  try/finally 替换/恢复 `Math.random`；**不传 `seed` 时行为与历史完全一致**（opt-in）。
- **不要在主线程装种子**：`foodOptimizerSimulation.js` 38-48 的 `activeRandomScopes`
  契约只适用于同 realm 轮次；本优化器的播种发生在专用 worker realm 内部（realm 私有、天然独占）。
- **配对的前提是显式传 `seeds`**：见 §14.1/§14.2。

---

## 4. 运行互斥与取消方案

### 4.1 新增专用 worker scope

`src/services/simulatorWorkerRuns.js`：

```js
export const DEDICATED_WORKER_SCOPE_QUEUE = 'queue';
export const DEDICATED_WORKER_SCOPE_ADVISOR = 'advisor';
export const DEDICATED_WORKER_SCOPE_EXPERIMENTAL = 'experimental';
export const DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER = 'trigger-optimizer'; // 新增

export function stopTriggerOptimizerWorkerRuns() {
  cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER);
}
```

- `cancelDedicatedWorkerRuns(predicate, error)`（32-46）遍历 `dedicatedWorkerRuns` Set，
  对满足条件的 handle 调 `handle.cancel(cancellationError)` → `settle(reject, error)` →
  `dedicatedClient.stopSimulation()`（terminate worker）+ 注销。
- 取消错误带 `code: 'cancelled'`（`createWorkerRunCancellationError` 10-14），
  调用方用 `isWorkerRunCancelledError(error)`（16-18）识别，**不要**把取消当失败上报。

### 4.2 store 接入

1. `simulatorStore.js` state 新增 `triggerOptimizer: createTriggerOptimizerState()`
   （仿 `createFoodOptimizerState`，`simulatorFoodOptimizerActions.js` 70-79）：
   ```js
   { settings: loadTriggerOptimizerSettingsFromStorage(), // rounds, weights, maxCandidatesPerAbility, maxPasses
     runtime: { isRunning: false, runId: 0, phase: 'idle', progress: 0, elapsedSeconds: 0, error: '' },
     report: null }
   ```
2. `simulatorSimulationActions.js` `stopSimulation`（178-202）加两处：
   - 开头：`if (this.triggerOptimizer?.runtime.isRunning) this.stopTriggerOptimizer();`
     （与 179 行 foodOptimizer 同款）。
   - 在 `stopQueueWorkerClients()`（191）后加 `stopTriggerOptimizerWorkerRuns();`。
3. `simulatorFoodOptimizerActions.js` 的 `foodOptimizerBusy`（81-90）互斥判断加
   `store.triggerOptimizer?.runtime?.isRunning`；同理 `startSimulation`（207-220）、
   `startFoodOptimizer` 的 busy 闸门。
4. `simulatorAdvisorActions.js` 的 advisor 互斥判断（`advisorRunExecution.js` 里的 busy 检查）
   也加 `store.triggerOptimizer?.runtime?.isRunning`。
5. `simulatorTriggerOptimizerActions.js` 的 `triggerOptimizerBusy(store)` 仿
   `foodOptimizerBusy`：runtime.isRunning || isAnyQueueRunning || advisor.runtime.isRunning ||
   foodOptimizer.runtime.isRunning || pricing.isLoading || hasSharedWorkerRunInProgress()。

### 4.3 取消传播链

```
用户点「停止」 → store.stopTriggerOptimizer()
  → search.cancel()  // 设 cancelled=true，下一轮 ensureActive 抛 cancellationError
  → stopTriggerOptimizerWorkerRuns()  // cancelDedicatedWorkerRuns(scope==='trigger-optimizer')
  → 在途的 runSingleSimulationPayloadWithDedicatedWorker promise reject(code:'cancelled')
  → runTask catch → isWorkerRunCancelledError → 不计入失败统计，正常收尾
```

- `runParallelWorkerPool` 的 `ensureActive` 在**每次任务预留前**调用，所以已在跑的任务要等它
  跑完才会停（worker 内部模拟不可中断）。这是既有行为，与 advisor/queue 一致。
- 搜索器内部循环（coordinate descent 的每个 pass、每个技能维度）都要在开头调 `ensureActive`。

---

## 5. 目标函数

### 5.1 权重来源

`shared/queuePerformanceWeights.js` `resolveQueuePerformanceSubweights(source, defaults)`
（106-125）：

```
weightProfit  (默认 0.5)  ┐
weightXp      (默认 0.3)  ┤→ 归一化到 10 个十分位（19-56 的 allocateNormalizedQueueWeightUnits）
weightDeathSafety = 1 - weightProfit - weightXp  (默认 0.2)
weightDps   = weightDeathSafety / 2
weightKills = weightDeathSafety / 2

byMetric = { dps: weightDps, dailyNoRngProfit: weightProfit, xpPerHour: weightXp, killsPerHour: weightKills }
```

**直接复用**：`getQueuePerformanceMetricWeights(queueSettings)`（`queueScoring.js` 204-206）
返回 `byMetric`。用户在设置页调的 `weightProfit/weightXp` 就是这条链（`SettingsPage.vue`
的滑块 → `normalizeQueueSettings` → `resolveQueuePerformanceSubweights`）。

### 5.2 复合分公式（2026-09-17 重构为配对口径）

指标量纲差异极大（dps 几万、profitPerHour 可能负数），必须先归一化。**唯一实现处**是
`triggerOptimizerDomain.computeObjectiveScore`（`triggerOptimizerScoring.scoreCandidate` 只是它的封装）：

```
对每个候选 c，四个指标 m ∈ {dps, dailyNoRngProfit, xpPerHour, killsPerHour}：
  base_m  = 配对参考（**同一组种子**下当前工作配置）的指标值
  floor_m = TRIGGER_OPTIMIZER_METRIC_FLOORS[m]
            // dps 1000 / dailyNoRngProfit 10000 / xpPerHour 1000 / killsPerHour 1
  scale   = max(|base_m|, |floor_m|)          // 基线≈0 时用 floor 兜住，防一个小差异被放大成满分
  relative = (m(c) - base_m) / scale          // 相对变化量，可为负、可 < -1
  norm_m(c) = relative <= -1 ? -1
            : clamp(log2(1 + relative) / RELATIVE_LOG_SCALE, -1, 1)
    RELATIVE_LOG_SCALE = 1.0 → 相对基线翻倍 = +1 分；腰斩 = -1 分（对负基线同样成立）

死亡惩罚与奖励（2026-09-18 改为对称）：
  deathPenalty = weightDeathSafety * max(deathsPerHour(c) - deaths_base, 0)
                 / max(deaths_base, DEATH_REFERENCE)      // DEATH_REFERENCE = 2.0/小时
  deathCredit  = weightDeathSafety * min(1, max(deaths_base - deathsPerHour(c), 0)
                 / max(deaths_base, DEATH_REFERENCE)) * DEATH_REDUCTION_CREDIT
                 // CREDIT = 1.0：与惩罚同量级、同分母口径
  旧口径只惩罚增加、死亡减少完全不得分：基线死 5/h、候选死 1/h 时贡献为 0，
  优化器无从区分「利润相当但更安全」的候选（用户目标「死亡更低」在分数里没有
  对应物）。对称后，同等利润下更安全的候选严格更优。
  注意重叠：引擎里死亡有真实成本（PLAYER_RESPAWN_INTERVAL = 150s 停摆 +
  clearBuffs + clearCCs，combatSimulator.js），dps/xp 已部分反映死亡代价，
  所以本项是**偏好性加权**（默认权重上限 0.2 分），不构成「送死换分」的逆向
  激励——增加死亡仍被惩罚，且惩罚无上限。

空蓝（配对口径，不是无条件否决）：
  候选空蓝 且 参考不空蓝  → score = -Infinity      （回归，直接判负）
  参考空蓝 且 候选不空蓝  → score += MANA_RECOVERY_BONUS = 0.25（真进步，给固定加分）
  两侧都空蓝 / 两侧都不空 → 不额外加减分

最终：
  score(c) = Σ_m byMetric[m] * norm_m(c) - deathPenalty + deathCredit (+ manaBonus)
```

**旧公式的两个硬缺陷（记录在此，避免被改回去）**：

1. 旧口径用 `Math.max(0, rawCurrent)` 把负利润**钳零**：基线亏损 5000/h、候选亏损 200/h
   时两者都变 0 ——「把亏损压小」这类真实改进完全不被打分奖励。
2. 旧口径 `(m+1)/(base+1)` 在基线为负时**翻转符号**（base = -3001 → 分母 -3000），
   候选越差得分越高，属于静默的错误排序。
   新口径吃的是**差值**（不是比值），对负基线正确、量纲无关、对称。

- 权重和为 1（`byMetric` 四项之和 = weightProfit + weightXp + weightDeathSafety = 1），
  所以 `score ∈ [-1 - weightDeathSafety, 1 + weightDeathSafety]`（死亡项上下限对称，
  外加 ±0.25 的空蓝修正）。
- **参考锚点**：搜索期参考 = 「当前工作配置」在同一组种子下的指标（首轮即基线），
  保证「不优于参考就不改」。
- **排序 tie-break**（`compareCandidates`，全序、绝不返回 0）：
  score → 配对信号（positive > inconclusive > unknown > negative）→ dailyNoRngProfit →
  dps → 改动距离（distance 小者优先）→ 签名字典序。
- **采纳判据**（`shouldAdoptCandidate`）：`score > best.score + eps` **且**配对信号不得为
  `negative`（聚合分更高但逐轮配对证据一致指向更差 = 聚合口径的假象，宁可不动）。
  eps = `TRIGGER_OPTIMIZER_SCORE_EPSILON = 1e-9`。
  注意：原文把它交叉引用到 `queueScoring.js` 的 `QUEUE_WEIGHT_SUM_EPSILON`，**该常量实际是
  1e-6**，两者不同，以本优化器自己的常量为准。
- **两层结果不要混**（详见 §14.3）：
  - 第 1 层 `scoreCandidate`（聚合分）：候选**聚合指标** vs 参考**聚合指标** → 搜索采纳判据；
  - 第 2 层 `computePairedStats`（配对统计）：**逐轮样本按种子下标对齐相减**，给出
    mean / 标准误 / t / 自由度 / 双侧 p 值 / verdict —— 回答「这个提升是真信号，还是
    这组种子的运气」。旧实现没有第 2 层，用户看到的「提升」既无法证伪也无法交叉验证。
  - `rounds < 2` 时标准误无从估计 → `t = null`、`pValue = null`、`verdict = 'unknown'`，
    UI 必须显示「样本不足、无法判断显著性」，**不允许**给假结论。

### 5.3 重复次数（rounds）：种子驱动的配对抽样

单次模拟有 RNG 波动（暴击、掉落、死亡、刷怪）。**2026-09-17 重构**：
每次评估按 `settings.rounds` 跑 N 场抽样，**第 i 场用种子集里的第 i 个种子**
（默认 **2**，范围 [1,10]；见 §14.1/§14.2）。

- **聚合口径**（`aggregateRoundMetrics`，`triggerOptimizerSimulation.js`）：
  数值指标（dps / dailyProfit / dailyNoRngProfit / xpPerHour / killsPerHour / deathsPerHour）
  取**算术均值**——每场时长相同，所以「累计死亡 ÷ 总时长」与死亡率的均值等价；
  空蓝只记 `ranOutOfMana`（任一场为 true）+ `ranOutOfManaCount`，
  **判负不在这里决定**：打分侧只在「参考不空蓝而候选空蓝」时才判 -Infinity（§5.2）；
  **任一场失败 → 整体退化为失败结构**（`createDegenerateMetrics`），失败抽样绝不混进均值；
  `samples` 保留**逐轮指标**（配对统计的原料，同种子下第 i 轮可直接与参考第 i 轮相减）。
- **种子从哪来**（重要）：`payload.seed = 该轮种子`（`buildSeededPayload`），
  `worker.js` 的 `installSeedScope` 据此替换 `Math.random`。
  **同一槽的基线与全部候选必须收到同一组 `seeds`**，否则配对性失效、噪声重新占主导。
  生产路径必须由调用方显式传 `seeds`；`resolveEvaluationSeeds` 的「按 `payload.workerId`
  派生」分支只是测试/旧调用方兜底，**没有配对保证**。
- **`workerId` 的角色**：仅作日志/调试标识，并带 `#r{N}` 可读后缀；
  **它不参与随机流**（随机流只由 `payload.seed` 决定）。
  早期文档「按 workerId 派生随机流」的结论已作废（§3.2 / §14.8）。
- **多轮在同一评估内串行**（跨候选仍并行）：worker 池的并行度只作用于候选，N 场抽样顺序跑；
  总模拟场次 = 评估次数 × rounds，进度分母 `totalSimulations` 与之同源。
- **复验固定 6 轮，与 `settings.rounds` 解耦**（`TRIGGER_OPTIMIZER_VERIFY_ROUNDS`，§14.5）：
  搜索期抽样廉价（默认 2 轮），统计功效花在最终结论上。
- UI：`roundsHint` 披露「轮数越少结论越不稳」；结果区同时显示「候选评估」与「模拟场次」。

### 5.4 搜索强度预设（三个旋钮的捆绑）

触发器优化器是坐标下降，没有食物优化器 top10/完整 那样的枚举模式可切（§7.1），因此
**不做同名「搜索模式」下拉**（同名不同义会误导），改用「搜索强度」预设：

| 预设 | 每槽候选上限 | 搜索轮数上限 | 重复次数  |
| ---- | ------------ | ------------ | --------- |
| 快速 | 6            | 1            | 1         |
| 标准 | 10（默认）   | 2（默认）    | 2（默认） |
| 精细 | 16（上限）   | 3            | 3         |

（2026-09-17 数值更新：候选上限默认 8 → **10**——新增的组合候选需要名额，见 §6.3/§14.4；
重复次数默认 1 → **2**、精细档 2 → **3**——CRN 配对后 2 轮的信息量已高于旧版 1 轮非配对，
但需要第 2 轮抽查配对一致性，见 §14.2。）

- **预设不持久化**：设置里没有 preset 字段，`resolveTriggerOptimizerPresetId` 由
  (candidateLimit, maxRounds, rounds) 三元组派生当前档位，匹配不上任何预设 → `custom`。
  单一事实源（三个数值），不会出现「下拉说精细、数值却是快速」的漂移。
- 「标准」= 三个产品默认常量（由 `triggerOptimizerDomain.test.js` 锁定）：默认档位 = 现有行为，
  用户不动设置时既不会被悄悄变快也不会被悄悄变慢。
- 「自定义」在 select 里 `disabled`：它只能通过改动高级项进入，不是可以被选出来的写入档位。
- 页面把「搜索轮数上限 / 每槽候选上限」收进「高级设置」`<details>`，预设下拉是主入口。

---

## 6. 候选生成策略

### 6.1 合法性矩阵（来自三个 JSON）

- **dependency**（`combatTriggerDependencyDetailMap.json`，4 个）：
  - `self`（单目标）、`targeted_enemy`（单目标）、`all_enemies`（多目标）、`all_allies`（多目标）。
- **condition**（`combatTriggerConditionDetailMap.json`，44 个）：每个有
  `isSingleTarget` / `isMultiTarget` / `allowedComparatorHrids`。
  - 单目标 condition 只能配单目标 dependency；多目标 condition 只能配多目标 dependency
    （`triggerMapper.js` 28-40 `isConditionAllowedForDependency`）。
  - 数值类：`current_hp`、`current_mp`、`missing_hp`、`missing_mp`（单+多皆可）；
    `lowest_hp_percentage`、`number_of_active_units`、`number_of_dead_units`（仅多目标）。
  - 增益类：`enrage`、`frenzy`、`berserk`、`precision`、`vampirism`、`fury`、`insanity`、
    `toughness`、`retribution`、`spike_shell`、`elemental_affinity`、`invincible`、
    各种 aura（fierce/guardian/mystic/speed/critical）、各种 coffee、各种 debuff
    （puncture、ice_spear、frost_surge、maim、curse、weaken、provoke、taunt、
    crippling_slash、fracturing_impact、pestilent_shot、smoke_burst、toxic_pollen、elusiveness）、
    状态类（stun/blind/silence_status）。
- **comparator**（`combatTriggerComparatorDetailMap.json`，4 个）：
  - `greater_than_equal`（allowValue）、`less_than_equal`（allowValue）、
    `is_active`、`is_inactive`（无 value）。
  - condition 的 `allowedComparatorHrids` 决定可选比较器
    （`triggerMapper.js` 42-49）。
- **value 语义**（`trigger.js` 88-160）：
  - 增益类 condition 返回 `source.combatBuffs[buffHrid]`（buff 层数/激活值），
    `is_active` = !!值，`is_inactive` = !值。
  - `current_hp`/`current_mp`/`missing_hp`/`missing_mp` 返回**绝对值**（ns 时间无关）。
  - `lowest_hp_percentage` 返回 0-100 的百分比（68-76，reduce 初值 2）。
  - `number_of_active_units`/`number_of_dead_units` 返回单位计数。
  - 多目标聚合除 `number_of_*`/`lowest_hp_percentage` 外，默认是**求和**
    （78-82：`map(getDependencyValue).reduce(sum)`）。
- **MAX_TRIGGER_COUNT = 4**（`triggerMapper.js` 7）。

### 6.2 按技能角色生成候选

技能分类依据 `resolveAbilityDefinition(hrid).abilityEffects`（`ability.js` 22-52）的
`effectType` / `targetType` / `buffs`。角色判定（启发式，可配置）：

| 角色          | 判定信号                                         | 典型候选（dependency / condition / comparator / value）                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **输出**      | 有 damage 类 effect，无自身增益                  | ① 默认 ② `[]` 立即释放 ③ `self/current_hp <= 50/75%`（残血斩杀/爆发） ④ `all_enemies/number_of_active_units >= 2`（AOE 场合） ⑤ `targeted_enemy/current_hp <= 30%`（斩杀）                                                                                                                                                                                                                    |
| **增益/Buff** | effect.buffs 且 targetType 自身                  | ① 默认 ② `[]` CD 好就放 ③ `self/<自身 buff> is_inactive`（buff 掉了再补）④ `self/current_hp <= 60%`（残血开） ⑤ `self/missing_mp >= 30% maxMp`                                                                                                                                                                                                                                                |
| **防御/生存** | effectType 含 heal/shield/armor，或 hpDrainRatio | ① 默认 ② `self/current_hp <= 50/75/90%` ③ `self/missing_hp >= 25/50%` ④ `all_allies/lowest_hp_percentage <= 40/60%`                                                                                                                                                                                                                                                                           |
| **治疗**      | hitpointRestore 类                               | 同防御，另加 `self/current_mp <= 20%`（防穿蓝）                                                                                                                                                                                                                                                                                                                                               |
| **光环/Aura** | effect.buffs 且 targetType 全队                  | ① 默认 ② `[]`（光环类通常 CD 长或被动，`[]` 可能强于默认）。~~③ `self/enrage is_active`~~ 已删除，见 §13。**④ 合取组合（2026-09-17 新增，§14.4）**：`self/<自身 buff> is_inactive` 且 `all_allies/lowest_hp_percentage <= 40`（光环失效且队友残血补上）、`… is_inactive` 且 `self/current_hp <= 60`。**这两条不需要绝对值换算，永远可生成**——修掉了旧版「光环角色零候选、只剩两个锚点」的塌缩 |
| **Debuff**    | effectType 含 debuff 应用                        | ① 默认 ② `[]` ③ `targeted_enemy/<自身 debuff> is_inactive`（debuff 掉了补）④ `all_enemies/number_of_active_units >= 2`                                                                                                                                                                                                                                                                        |

### 6.3 约束规则

- **每技能候选上限可配，默认 10、上限 16**（`TRIGGER_OPTIMIZER_DEFAULT/MAX_CANDIDATE_LIMIT`）。
  2026-09-17 由 8 提到 10：8 个名额会被「默认/当前 + `[]` 立即释放」两个锚点与单条件候选
  占满，**组合候选一条都进不来**（它们按生成顺序排在末尾）。10 = 2 锚点 + 5 单条件 + 3 组合，
  正好装下最常见的角色网格。并且 `generateAbilityCandidates` 把单条件与组合候选**交错 push**
  （先单条组合一条、再单条组合一条…），`candidateLimit` 截断时两类都必有代表。
  组合候选的 `distance = DISTANCE_COMPOSITE = 3`（最大），同分时优先采纳单条件候选。
- 数值档位：HP/MP 百分比用 25/50/75/90 四档；`number_of_active_units` 用 2/3 两档；
  斩杀用 30%。
- **自适应阈值精炼（2026-09-18 新增）**：固定网格粒度太粗——真实最优阈值常落在格点之间
  （例如 62%），网格永远搜不到它，这是「找不到最优触发」的主因。全量加密网格会让
  候选数爆炸（每个数值槽 ×N），而精炼只对**刚被采纳的单条件数值类候选**做一次邻域搜索：
  模拟成本只花在已证明有改进的槽上。实现在 `triggerOptimizerCandidates.js`：

  | 项目                   | 口径                                                                                                                                                                                                                                                                                    |
  | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 触发条件               | winner 恰好 **1 条触发器**（组合候选有 2 条，精炼其中一条会改变另一条的语义，不碰）；标签带 `{{percent}}` / `{{count}}` 插值参数（`labelParams` 是百分比的唯一精确来源，绝对值经取整后无法无损反推），且 UI 已支持这些插值，**无需新增 i18n key**                                       |
  | 百分比邻域             | ±`REFINEMENT_PERCENT_STEP = 10` 个百分点，clamp 到 **[5, 95]**（0%/100% 会退化成「恒不触发/恒触发」），再用 resources 的 maxHp/maxMp 换算绝对值，取整方式与该标签的生成器逐一对应（lowHp/executeHp → maxHp+floor；missingHp → maxHp+ceil；lowMp → maxMp+floor；missingMp → maxMp+ceil） |
  | `lowest_hp_percentage` | 本身即百分比（`all_allies` 队友残血），**不需要资源换算**，读不到战斗属性也能精炼（靠 condition 识别，不在 `REFINE_PERCENT_SPECS` 里）                                                                                                                                                  |
  | 计数邻域               | `number_of_active_units` ±1，clamp **[2, 8]**（GTE 1 恒真 = 立即释放，与 `[]` 候选等价，属于退化配置）                                                                                                                                                                                  |
  | 资源降级               | 绝对值类标签在 `resources` 不可用时返回空数组（与生成器的降级口径一致，不会产出半成品候选）                                                                                                                                                                                             |
  | 不可精炼               | 锚点（`triggers = null` / `[]`）、组合候选（2 条触发器）、buff/debuff 的 `is_inactive` 类非数值条件、非对象入参                                                                                                                                                                         |

  精炼候选由搜索层物化（`buildRefinedCandidates`）：`state: 'custom'`、
  `distance = DISTANCE_REFINEMENT = 4`（大于 `DISTANCE_COMPOSITE = 3`，同分时优先
  网格候选），并对该槽已有候选按**签名去重**——网格内的阈值会被自然跳过，精炼不会
  与已有候选重复（下一轮也不会重复评估同一配置）。

- **绝对值换算**：`current_hp <= 50%` 需要写成**绝对值**
  `value = floor(maxHitpoints * 0.5)`。maxHitpoints 必须从**基线模拟的 Player 对象**取
  （`getFoodOptimizerResources` 的做法，`foodOptimizerSimulation.js` 87-102：
  建模拟器 → reset → initializeCombatPlayers → 读 `combatDetails.maxHitpoints`）。
  **不要**用 playerConfig 估算（装备/成就/公会增益会影响最终血量）。
- **value 类型**：`toFiniteNumber`（`triggerMapper.js` 13-16）接受字符串/数字，
  但落盘和签名比较用数字。候选生成器直接写数字。
- **合法校验**：候选必须能通过 `sanitizeTriggerList`（`triggerMapper.js` 51-83），
  否则会被静默丢弃，导致「候选和默认等价」——白跑一场模拟。
  候选生成器内部直接用 `isConditionAllowedForDependency` + `isComparatorAllowedForCondition`
  预检，或生成后跑一遍 `sanitizeTriggerList` 自查 length 不变。
- **消耗品**：食物/饮品**不参与**触发器优化（食物由 Food Optimizer 负责；饮品触发器
  语义相同但用户预期是食物优化器的领域）。本优化器只扫 `playerConfig.abilities`
  的 5 个槽（含特殊技能槽）。
- **空槽跳过**：`abilityHrid === ''` 的槽不产候选。
- **等级闸门**：`playerMapper.js` 702-707 —— 智力等级 < `abilitySlotsLevelRequirementList[i+1]`
  （`[0,1,1,20,50,90]`）的技能槽不进入模拟。候选生成器也要跳过这些槽
  （否则候选永远等价于基线，浪费 worker）。

---

## 7. 搜索算法：Coordinate Descent

### 7.1 为什么不用全枚举

每技能 ≤10（上限 16）个候选 × 5 槽 = 10^5 组合起步，每组一场 24h 模拟（约数秒到数十秒），
不可行。食物优化器能全枚举是因为它的候选空间有结构性剪枝（阈值等价类、成本下界）。
触发器候选之间**没有可合并的等价类**，所以用贪心式逐技能搜索。

### 7.2 算法（2026-09-17 重写：配对参考链 + 独立复验）

```
输入：playerConfig（含当前 triggerMap），候选生成器，目标函数，并行 worker 数 W
输出：最优 triggerMap + 基线/参考指标 + 每槽选择 + 复验结论

0. searchSeeds = createTriggerOptimizerSeedSet(salt=search.v1, count=settings.rounds)
   verifySeeds = createTriggerOptimizerSeedSet(salt=verify.v1, count=6)      // 见 §14.1
   reference = evaluate(baseline, searchSeeds)      // 基线**在同一组种子下**测一次
   best = { metrics: reference, score: 0 }          // 基线相对自己得 0 分
   resources = resolveOptimizerResources(baseline)   // 失败 → 数值类候选跳过（resourcesAvailable=false）
   choices = buildCandidateConfigs(playerConfig, settings)   // locked 槽仍产候选，但跳过搜索

1. for round in 1..maxRounds (默认 2, 上限 5):
       improvedSlots = []
       for each choice in prioritizeChoices(choices) where !choice.locked:   // 槽优先级见 7.3
           ensureActive()
           // 其余槽保持「当前工作配置」，只换本槽；**全部候选与 reference 共享 searchSeeds**
           entries = await runParallelWorkerPool({
             taskCount: choice.candidates.length,
             workerLimit: min(W, candidates.length),
             runTask: (i) => {
               metrics = evaluate(workingConfig + candidate[i], searchSeeds)
               paired  = computePairedStats(metrics, reference, weights)   // 逐轮配对统计
               score   = scoreCandidate(metrics, weights, reference)       // 聚合配对分
               return { ...candidate[i], metrics, score, paired }
             },
             ensureActive,
           })
            winner = argmax(entries, compareCandidates)      // 全序 tie-break，见 §5.2
            if shouldAdoptCandidate(winner, best):           // 严格更优 && 配对信号非 negative
                apply(workingConfig, winner); apply(bestTriggerMap, winner)
                best = winner
                reference = winner.metrics        // ★ 配对链延续：零额外模拟
                improvedSlots.push(choice.slotIndex)
                chosenBySlot[slotIndex] = winner  // ★ 记下「采纳时的 winner」

                // ★ 自适应阈值精炼（2026-09-18，§6.3）：只对刚被采纳的单条件数值类候选
                refinements = buildRefinedCandidates(winner, choice, resources)  // 签名去重后
                if refinements.length > 0:
                    // 评分仍用本槽起始的 reference（与 winner 同标尺），共享 searchSeeds
                    refineEntries = await runParallelWorkerPool({ taskCount: refinements.length, ... })
                    refineWinner = argmax(refineEntries, compareCandidates)
                    if shouldAdoptCandidate(refineWinner, winner):   // 同标尺下的严格更优
                        apply(workingConfig, refineWinner); apply(bestTriggerMap, refineWinner)
                        best = refineWinner
                        reference = refineWinner.metrics             // 精炼者延续配对链
                        chosenBySlot[slotIndex] = refineWinner
                    choice.candidates.push(...refinements)           // 无论是否采纳都回写：
                                                                    // UI 候选表可见 + 下一轮
                                                                    // 签名去重不重复评估
            else if 该槽从未被采纳:
               chosenBySlot[slotIndex] = winner ?? null   // 分数 ≤ 0 = 不如当前配置
       if improvedSlots.length === 0: break              // 固定点
2. 回填 perAbilityChoices[i].chosen = chosenBySlot[slotIndex]
3. 复验：用 verifySeeds 重跑 baseline 与 workingConfig（各 6 场）
   verification = { baselineMetrics, bestMetrics, paired, verdict, seeds, rounds: 6 }
4. return { cancelled:false, rounds, perAbilityChoices, metricsByCandidate, baselineMetrics,
            referenceMetrics, bestTriggerMap, improvement, verification, resourcesAvailable,
            evaluations, simulations, evaluationRounds, maxConcurrentWorkers, workerLimit, elapsedSeconds }
```

- **配对参考链（本轮核心改动）**：`reference` 是「当前工作配置在同一组种子下的指标」。
  某槽的 winner 被采纳后，winner 与 reference **只差这一个槽**，所以 winner 的 metrics
  就是新工作配置的指标 —— 直接换成新 reference 即可，**零额外模拟**，且配对性完整保留。
  旧实现给「基线」单独抽 1 场、候选另起随机源，差异里 RNG 噪声占主导（§14.8 根因①）。
- **首轮必须评估基线**（`candidate = current`），既是锚点也是「不改动」的兜底。
- **eps = `TRIGGER_OPTIMIZER_SCORE_EPSILON = 1e-9`**：只有严格更优才采纳，避免无意义抖动。
- **`chosen` 的回填必须保住「采纳时的 winner」**：后续轮次里该槽已是「自己 vs 自己」，
  分数必然为 0，若用后续 winner 覆盖，会把已经拿到的真实提升从报告里抹掉 ——
  用户看到「优化了但每项 0.0000」，这正是「效果不佳」的观感来源之一（本轮修掉的报告缺陷）。
- **候选记录键 = `"${slotIndex}|${signature}"`**（`candidateKey`）：只按签名做键会**串味**
  ——不同技能完全可能生成同一份触发器列表（例如两个技能都取「自身蓝量 ≥ 30%」），
  共用一条记录会让 A 技能的分数显示在 B 技能的候选行上。报告 key 形如 `"1|default"`。
- **锁定槽**（`settings.lockedAbilityHrids`，存 hrid 而非槽位下标）：仍生成候选并上报
  （UI 要展示当前配置），但**不进 coordinate descent 的循环**。
  改锁定集合会进入输入指纹 → 既有报告立即标记过期，不会被误应用。
- **固定点终止**：一轮内无任何槽改进则停。
- **精炼的设计取舍**：
  - 评分刻意复用**本槽起始的 `reference`**（而不是采纳后的 `referenceMetrics`）：
    `shouldAdoptCandidate(refineWinner, winner)` 必须是同一标尺下的「严格更优」判定，
    若改用采纳后的参考会导致门槛过高、系统性拒绝精炼。
  - 精炼候选**无论是否采纳都 push 进 `choice.candidates`**：UI 候选表才能展示它们
    （分数/paired 已由 `recordMetrics` 记录，只在更高分时覆盖）；下一轮按签名去重
    不重复评估；未采纳者的分数必然 ≤ winner，不会被误采纳。
- **成本**：每个 pass = Σ_槽 (候选数) 次评估，每次评估 = `settings.rounds` 场模拟；
  精炼**只在候选被采纳时**触发，每槽最多 2 个邻域候选（±步长，签名去重后通常更少）；
  外加基线 1 次与复验 2 次。标准档实测约 **54 场**（(1 + 2×1×10)×2 + 12），
  精炼带来的增量为「每轮每个可精炼采纳槽 ×2 次评估」的上界——典型配置下
  每轮 2~3 个采纳槽，标准档约多 **4 到 6 次评估 ≈ 8 到 12 场**（约 2 成），换来的却是
  阈值精度从 25 个百分点提升到 10 个百分点。
- **进度分母是估算上界**：精炼次数无法精确预估（取决于采纳与否、签名去重压缩），
  `totalEvaluations` 按「每个含可精炼候选的槽 × 每轮最多 2 次」取上界，
  `progress = min(1, evaluations / totalEvaluations)` 钳到 1 避免倒走，收尾强制发布 1。
- **进度上报**：节流 150ms（`PROGRESS_THROTTLE_MS`），字段
  `{ phase, progress, elapsedSeconds, round, slotIndex, abilityHrid, role, workerLimit,
evaluations, totalEvaluations, simulations, totalSimulations, bestScore }`
  —— 页面据此显示「正在优化哪个技能 / 第几轮 / 当前最佳分 / 预计剩余」。
  `phase ∈ { baseline, searching, verifying, done, cancelled, error }`。
- **失败容错**：模拟失败不抛，退化为 `createDegenerateMetrics`（全零指标 + `failed:true`），
  打分自然淘汰；**取消错误（`code:'cancelled'`）必须原样上抛**，由搜索层按取消语义收尾。

### 7.3 槽优先级

按「预期影响」排序，让早改进带动后续：

1. 特殊技能槽（index 0，`isSpecialAbility`）
2. 输出类技能
3. 增益类技能
4. Debuff 类技能
5. 防御/治疗类技能
6. 光环类技能

### 7.4 并行 worker 数钳制

```js
const workerLimit = Math.min(
  normalizeParallelWorkerLimit(store.queueRuntime?.parallelWorkerLimit, store.queueParallelWorkerHardMax),
  currentCandidates.length, // 任务数小于限额时不开空 worker
);
```

`runParallelWorkerPool` 的 `clampWorkerCount=true`（默认）已做 `min(limit, taskCount)`，
所以第二项 clamp 可省，但显式写更清晰。

---

## 8. 完整文件清单（新建/修改）

### 8.1 新建

| 文件                                                       | 职责                                                                                                                                                      | 关键导出                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/seededRandom.js`                             | **CRN 基础设施（2026-09-17 新增）**：确定性 mulberry32 RNG、字符串→种子哈希、种子集派生；`foodOptimizerSimulation` 改为复用同一实现（避免第二份实现漂移） | `createSeededRandom`、`hashSeed`、`deriveSeedSet(baseSeed, count)`                                                                                                                                                                                                                                                                                                                                                             |
| `src/services/triggerOptimizerDomain.js`                   | 纯函数 + 常量：设置归一化/校验、输入快照与指纹、候选签名、**配对**目标函数、种子集、时间常量                                                              | `normalizeTriggerOptimizerSettings`、`isValidTriggerOptimizerSettings`、`createOptimizerInput`、`createTriggerOptimizerInputSignature`、`buildTriggerCandidateSignature`、`computeObjectiveScore`、`createTriggerOptimizerSeedSet`、`TRIGGER_OPTIMIZER_DEFAULT_*`（rounds 2 / maxRounds 2 / candidateLimit 10 / VERIFY_ROUNDS 6 / RELATIVE_LOG_SCALE / METRIC_FLOORS / MANA_RECOVERY_BONUS / DEATH_REFERENCE / SCORE_EPSILON） |
| `src/services/triggerOptimizerCandidates.js`               | 候选生成：技能角色分类、单条件候选、**合取组合候选（AND，§14.4）**、sanitize 自查、`locked` 标记                                                          | `classifyAbilityRole`、`generateAbilityCandidates`、`buildCandidateConfigs`、`compositeCandidates`、`TRIGGER_OPTIMIZER_MAX_TRIGGERS_PER_CANDIDATE = 4`、`TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS`                                                                                                                                                                                                                               |
| `src/services/triggerOptimizerScoring.js`                  | 打分：聚合配对分 + **逐轮配对统计（t / p / verdict）** + 排序与采纳判据 + UI delta                                                                        | `scoreCandidate`、`computePairedStats`、`summarizeSamples`、`pairedPValue`、`compareCandidates`、`shouldAdoptCandidate`、`summarizeDeltas`、`TRIGGER_OPTIMIZER_SIGNIFICANCE_LEVEL = 0.05`                                                                                                                                                                                                                                      |
| `src/services/triggerOptimizerSimulation.js`               | payload 构建（强制 `logCombatEvents:false` / `enableHpMpVisualization:false` / 写入 `payload.seed`）+ 专用 worker 逐种子抽样 + 聚合 + 绝对属性解析        | `buildCandidatePayload`、`applyCandidateToPlayerConfig`、`applyCandidateToTriggerMap`、`evaluatePayload`、`aggregateRoundMetrics`、`collectMetrics`、`resolveEvaluationSeeds`、`resolveOptimizerResources`、`createDegenerateMetrics`                                                                                                                                                                                          |
| `src/services/triggerOptimizerSearch.js`                   | 搜索引擎：**配对 coordinate descent**（参考链）+ 锁定槽跳过 + **独立复验阶段** + 取消/进度                                                                | `optimizeTriggers(input, callbacks)`、`cancelTriggerOptimizerRun`、`hasTriggerOptimizerRunInProgress`                                                                                                                                                                                                                                                                                                                          |
| `src/services/triggerOptimizerRunRegistry.js`              | 模块级单运行标志（store 需同步访问，且不能静态 import 搜索模块）                                                                                          | `registerTriggerOptimizerRun`、`unregisterTriggerOptimizerRun`、`cancelTriggerOptimizerRun`、`hasTriggerOptimizerRunInProgress`                                                                                                                                                                                                                                                                                                |
| `src/stores/simulatorTriggerOptimizerActions.js`           | Pinia actions：start/stop/apply/settings/**锁定设置**，runId 生命周期，互斥闸门，实时进度明细                                                             | `createTriggerOptimizerState`、`createTriggerOptimizerActions`、`triggerOptimizerBusy`、`setTriggerOptimizerLockedAbilities`                                                                                                                                                                                                                                                                                                   |
| `src/ui/pages/TriggerOptimizerPage.vue`                    | 页面：搜索强度预设 + 预计场次、技能槽锁定、实时进度/ETA、结果摘要（改了几个技能 + 复验结论 + p 值）、候选表（含配对信号列）、应用按钮                     | —                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/services/__tests__/triggerOptimizerSemantics.test.js` | 四态语义探针（另有 Domain / Scoring / Candidates / Simulation / Search / Store / 页面模板 测试）                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                              |

> 说明：**没有** `triggerOptimizerSnapshot.js` 与 `TriggerOptimizerDetails.vue`
> （旧文档的规划项未落地）——输入快照/指纹在 `triggerOptimizerDomain.js` 的
> `createOptimizerInput` / `createTriggerOptimizerInputSignature` 里；候选详情直接内嵌在页面。

### 8.2 修改

| 文件                                                | 改动                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/simulatorWorkerRuns.js`               | +`DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER`、+`stopTriggerOptimizerWorkerRuns()`                                                                                                                              |
| `src/stores/simulatorSimulationActions.js`          | `stopSimulation`（178-202）接入 trigger optimizer 停止（见 §4.2）                                                                                                                                             |
| `src/stores/simulatorStore.js`                      | state +`triggerOptimizer`；getter +`triggerOptimizerInputSignature`、+`triggerOptimizerReportStale`；`stopSimulation` 所属 actions 已在别处                                                                   |
| `src/stores/simulatorFoodOptimizerActions.js`       | `foodOptimizerBusy`（81-90）+ triggerOptimizer.isRunning 互斥                                                                                                                                                 |
| `src/stores/simulatorAdvisorActions.js`             | advisor 互斥判断 + triggerOptimizer.isRunning                                                                                                                                                                 |
| `src/services/simulatorStorage.js`                  | +`load/persistTriggerOptimizerSettingsToStorage`（键名 `mwi.triggerOptimizer.settings.v1`，仿 foodOptimizer 的存储模式；`simulatorStorage.js` 684/700 已是 queueRuntime 的同类模式）                          |
| `src/ui/router/index.js`                            | 新增路由（§9）                                                                                                                                                                                                |
| `locales/zh/common.json` + `locales/en/common.json` | i18n 键（§9）                                                                                                                                                                                                 |
| `src/worker.js`                                     | +`installSeedScope(seed)`：`payload.seed` 存在时在模拟前后 try/finally 替换/恢复 `Math.random`（**opt-in**，不传 seed 行为与历史完全一致）；+`logCombatEvents: event.data.logCombatEvents !== false`（§14.1） |
| `src/services/foodOptimizerSimulation.js`           | mulberry32 抽到 `seededRandom.js` 后改为复用（**必须** `import { createSeededRandom }` 再 `export const createFoodOptimizerRandom = createSeededRandom`，具名转发不建立本地绑定，见 §14.7）                   |
| `patchNote.json`                                    | 新版本条目（§9.4）                                                                                                                                                                                            |
| `src/ui/pages/SettingsPage.vue`（可选）             | 若把权重滑块放到设置页而非优化器页内                                                                                                                                                                          |

### 8.3 不需要改的

- `playerMapper.js`、`triggerMapper.js`、`simulationDomain.js`、`workerPool.js`、
  `workerClient.js`、`queueScoring.js`、`queuePerformanceWeights.js` —— **全部只读复用**。
- `combatSimulator/*` —— **引擎逻辑不改**（本轮只在 `src/worker.js` 外面套一层播种作用域
  并强制 `logCombatEvents:false`；引擎内部那些 `Math.random` 调用点一处未动）。

---

## 9. i18n 与菜单规划

### 9.1 路由（`src/ui/router/index.js`）

```js
{
  path: '/trigger-optimizer',
  name: 'trigger-optimizer',
  component: () => import('../pages/TriggerOptimizerPage.vue'),
  meta: {
    showCombatToolbar: false,
    navLabelKey: 'common:menu.triggerOptimizer',
    navLabel: 'Trigger Optimizer',
    navGroup: 'simulation',
    navOrder: 2.6,
  },
}
```

- `navGroup: 'simulation'`：与 Food Optimizer（2.5）同组（2026-09-17 调整：原为 `tools`）。
- `navOrder: 2.6`：紧随 Food Optimizer(2.5)、排在 Enhancement(3) 之前（2026-09-17 调整：原为 4.5）。
- **菜单命名（2026-09-17 调整）**：zh 菜单标签由「技能触发器」改为「技能优化」
  （`locales/zh/common.json` 的 `menu.triggerOptimizer`；en 仍为 `Trigger Optimizer`）。
  页面内其它文案（`requireSingle` / `labyrinthUnsupported` / `resultsTitle` 等）仍以
  「技能触发器」称呼被优化对象，未改名。
- `showCombatToolbar: false`：优化器页面不需要战斗工具栏（同 FoodOptimizer/Enhancement）。
- 侧边栏渲染逻辑（`AppSidebar.vue` 172-177）按 `navOrder` 排序、按 `navGroup` 分组，
  无需改侧边栏组件。

### 9.2 i18n key 规划

命名空间 `common`（`locales/{zh,en}/common.json`），主键 `triggerOptimizer`，
结构与 `foodOptimizer` 对称：

```
common.menu.triggerOptimizer                    // 菜单标签（zh: 技能优化）
common.triggerOptimizer.editCombat              // 返回首页编辑
common.triggerOptimizer.start / stop            // 开始/停止
common.triggerOptimizer.apply / applied         // 应用最优结果
common.triggerOptimizer.busy                    // 互斥占用
common.triggerOptimizer.requireImport           // 需要先导入玩家数据
common.triggerOptimizer.requireSingle           // 需要单区域模式
common.triggerOptimizer.labyrinthUnsupported    // 不支持迷宫（若决定不支持）
common.triggerOptimizer.invalidSettings
common.triggerOptimizer.stale                   // 报告过期
common.triggerOptimizer.player / map / tier / roomLevel / duration / hours / teammates / none
common.triggerOptimizer.currentTriggers         // 当前触发器总览
common.triggerOptimizer.settings.weightsTitle   // 权重
common.triggerOptimizer.settings.profit / xp / deathSafety   // 滑块
common.triggerOptimizer.settings.maxCandidates  // 每技能候选上限
common.triggerOptimizer.settings.maxPasses      // 轮次上限
common.triggerOptimizer.settings.rounds         // 重复次数（§5.3，2026-09-17 已开放）
common.triggerOptimizer.preset / presets.fast|standard|fine|custom  // 搜索强度（§5.4）
common.triggerOptimizer.presetHint / roundsHint / advanced          // 预设提示 / 重复次数提示 / 高级设置
common.triggerOptimizer.candidateEvaluations / evaluations          // 候选评估 / 模拟场次
common.triggerOptimizer.phases.preparing / baseline / searching / done / cancelled / error
common.triggerOptimizer.progress                // 进度文案
common.triggerOptimizer.results.title / noResults / baseline / best
common.triggerOptimizer.results.delta           // 分数差
common.triggerOptimizer.candidate.default / alwaysFire / custom   // 候选类型标签
common.triggerOptimizer.candidate.disabledHint  // 「= 立即释放，非禁用」的澄清文案（重要！）
common.triggerOptimizer.stats.simulations / elapsed / passes / improvedSlots
common.triggerOptimizer.role.damage / buff / debuff / defense / healing / aura

// 2026-09-17 新增（本轮）：
common.triggerOptimizer.searchStrength            // 「搜索强度」预设标签
common.triggerOptimizer.simulationsPlanned        // 预计模拟场次
common.triggerOptimizer.lock / locked / lockHint  // 技能槽锁定（按 hrid）
common.triggerOptimizer.currentAbility / roundLabel / bestScoreNow / eta   // 实时进度反馈
common.triggerOptimizer.summaryTitle / changedAbilities                    // 结果摘要卡
common.triggerOptimizer.verificationTitle / verificationPValue / verificationHint
common.triggerOptimizer.verdicts.positive | negative | inconclusive | unknown   // 复验结论
common.triggerOptimizer.pairedDelta / signalColumn / signals.*                  // 候选表「配对信号」列
common.triggerOptimizer.pairingHint / resourcesUnavailable                      // CRN 说明 / 数值候选不可用警告
common.triggerOptimizer.phases.verifying                                        // 复验阶段
common.triggerOptimizer.candidate.composite*（10 个组合标签）/ candidate.andHint  // 组合候选 + AND 语义澄清
```

- **`candidate.disabledHint` 必须有**：UI 展示 `[]` 候选时要写「立即释放（冷却好了就放）」，
  不能写「禁用」（§1.1 的语义澄清，避免用户误解）。
- 两份 common.json（zh/en）都要加，`i18nResources.test.js` 会逐语言核对常量与文案一致
  （`foodOptimizerDomain.js` 12-14 的注释提到这个校验）。
- **禁止在 Vue 模板的 t() fallback 字符串里写双花括号 `{{ }}`**（项目既有坑：
  mustache 截断 + prettier 重排会毁模板）。

### 9.3 菜单分组现状（`src/ui/router/index.js`）

| navGroup   | 路由（navOrder）                                                     |
| ---------- | -------------------------------------------------------------------- |
| simulation | home(1)、advisor(2)、food-optimizer(2.5)、**trigger-optimizer(2.6)** |
| tools      | enhancement(3)、skilling(4)                                          |
| support    | queue(5)、multi-results(6)、settings(7)、guide(8)                    |
| 隐藏       | patch-notes(navHidden)                                               |

### 9.4 patchNote.json

新增版本条目（放最前，键名日期格式照现有风格）：

```json
"2026年9月18日（v2.5.5）": {
  "label": { "zh": "…", "en": "…" },
  "newFeatures": {
    "zh": ["新增「技能触发器优化器」：用导入的玩家数据，在当前战斗区域搜索技能触发器的最优配置。"],
    "en": ["New Trigger Optimizer: searches the best combat-trigger setup for your equipped abilities in the current zone."]
  }
}
```

---

## 10. 对下游实现节点的关键提醒

1. **空列表 = 立即释放，不是禁用**（§1.1）。候选集要包含 `[]`，UI 要标注「立即释放」。
   消耗品（食物/饮品）不要生成 `[]` 候选（死循环风险，`playerMapper.js` 683-687 的既有坑）。
2. **payload.players 是引擎 Player 对象，不是 playerConfig**。候选改的是
   `Player.abilities[i].triggers`（TriggerDto 数组），不是 `triggerMap`。
   写回时才转成 triggerMap（`applyTriggerStateToTriggerMap` 或直接展开）。
3. **`hasOwnProperty` 是四态分叉点**（`playerMapper.js` 674/688/708）。
   候选里「保持默认」要**删键**（`delete triggerMap[hrid]`），不是写默认值
   （写默认值虽然引擎等价，但 `getEffectiveTriggerState` 会折叠成 default，
   签名比较时容易自洽；`applyTriggerStateToTriggerMap` 的 default 分支就是删键，学它）。
4. **数值类触发器的 value 是绝对值**（current_hp/missing_hp/current_mp/missing_mp），
   百分比候选必须先从基线模拟的 Player 对象读 maxHitpoints/maxManapoints
   （`foodOptimizerSimulation.js` 87-102 的 `getFoodOptimizerResources` 路径）。
   `lowest_hp_percentage` 是 0-100 的百分比，可以直接写百分比数值。
5. **每个任务一个独立 worker**（`WorkerClient` 每次新建 Worker），
   并行任务 RNG 天然隔离。**2026-09-17 推翻原文后半句**：「不要装 `Math.random` 种子」
   只对**主线程**成立（`foodOptimizerSimulation.js` 的同-realm 契约）；
   在本架构里**必须**通过 `payload.seed` 在**专用 worker realm 内部**播种
   （`worker.js` 的 `installSeedScope`），否则基线/候选各跑一条随机流，
   差异里 RNG 噪声占主导，结论不可复现。见 §14.1。
6. **`workerId` 不是随机种子**：它只作日志/调试标识（`#rN` 后缀仅可读性），
   worker.js 从不读它来播种。旧文档「按 workerId 派生随机流」是错的。
7. **取消 = ensureActive 抛异常 + `stopTriggerOptimizerWorkerRuns()`**
   （§4.3）。在途任务会跑完才停；worker 内部模拟不可中断。
8. **候选必须通过 `sanitizeTriggerList` 自查**（§6.3），否则静默退化成默认候选，白跑模拟。
9. **智力等级闸门**（`playerMapper.js` 702-707，`[0,1,1,20,50,90]`）：
   低智力玩家的技能槽根本不进模拟，候选生成器要同步跳过。
10. **目标函数的基线锚点**：首轮必须评估当前 triggerMap，只有严格更优（eps=1e-9）才采纳。
    死亡只惩罚增加、不奖励减少（防送死流）。
11. **进度节流 150ms**（仿 `foodOptimizerSearch.js` 296-316 的 publish 节流），
    否则高频 `structuredClone(report)` 会卡主线程。
12. **报告过期**：输入签名（players/zone/settings/weights）变化即过期
    （仿 `foodOptimizerReportStale` / `trackReportChanges`）。
13. **存储键名带版本**：`mwi.triggerOptimizer.settings.v1`，脏数据回落到产品默认
    （学 `foodOptimizerDomain.js` 5-11 的「单一魔法数」原则）。

---

## 11. 验证记录（主节点实施，2026-09-17）

### 11.1 落地范围

- 服务层：`triggerOptimizerDomain / Candidates / Scoring / Simulation / Search / RunRegistry.js`；
  存储：`simulatorStorage.js` 的版本化设置键；store：`simulatorTriggerOptimizerActions.js`；
  UI：`TriggerOptimizerPage.vue` + 路由 `/trigger-optimizer` + 侧栏图标 + 四处互斥接线
  （simulation / foodOptimizer / queue / advisor）。
- 文案：`locales/{zh,en}/common.json` 新增 `menu.triggerOptimizer` 与完整
  `triggerOptimizer` 命名空间（含 `candidate.disabledHint` 的「立即释放 ≠ 禁用」澄清）。
- patchNote：文案先追加至 v2.5.4 条目；2026-09-19 复核发现该版本已发布（追加内容不触发未读提醒），整体迁入 v2.5.5 新条目并同步版本号（§18.8）。

### 11.2 实施期修复的契约偏差（以运行时行为为准）

1. **i18n 键格式**：候选/角色标签键与 `TRIGGER_OPTIMIZER_CANDIDATE_DISABLED_HINT_KEY`
   原为 `common.triggerOptimizer.*` 点号前缀，在本项目 i18next（`defaultNS='common'`、
   `nsSeparator=':'`）下不会解析——运行时直接渲染原始键（最小实验复现：
   `t('common.xxx')` 返回键本身、`t('common:xxx')` 正常返回译文）。
   已全部改为 `common:` 冒号前缀，并同步更新候选/打分测试断言（本契约 §8.2/§9.2 中
   的 `common.triggerOptimizer.*` 写法作废，改用 `common:triggerOptimizer.*`）。
2. **`settings.simulationHours` 接线**：原实现跑 payload 时取首页 `simulationTimeHours`，
   页面上的时长设置不生效。已改为以优化器自身设置为准（
   `startTriggerOptimizer` 的 `simulationTimeHours = settings.simulationHours`），
   与首页解耦；输入指纹不变（首页时长变化仍会保守地触发过期）。
3. 交互补充：自身运行期间不显示「被占用」提示；新增 `noAbilitySlots` 前置闸门
   （无有效技能槽时禁用开始并给出原因）。

### 11.3 自动化验证

- `npm test`：**177 文件 / 2363 测试全绿**，Prettier 全仓通过。
  新增测试：语义探针 19、Domain 28、Candidates 23、Scoring 20、Simulation 13、
  Search 6、store 12、页面模板 12。
- `npm run build`：成功；`TriggerOptimizerPage-*.js` 懒加载 chunk 18.03 kB（gzip 5.31 kB）。

### 11.4 浏览器冒烟（dev server 实测）

- 侧栏顺序：生活技能 → **技能触发器** → 队列；`#/trigger-optimizer` 往返导航正常
  （当日稍后按用户要求改名为「技能优化」并移到「食物优化」下方，见 §9.1/§9.3）。
- 空态：未导入提示 + 「去首页导入」链接；控制台无任何 warning/error。
- 设置：利润 60% → 死亡安全自动变为 10%；`maxRounds: 3` 即时落盘
  `mwi.triggerOptimizer.settings.v1`（version 1）；非法权重（利润 90 + 经验 30）→
  警示文案 + 开始按钮禁用 + 不写脏值。
- 未覆盖项：真实 worker 全链模拟（需要真实导入的角色存档，本环境无法构造）。
  该链路由 `triggerOptimizerSimulation/Search`（WorkerClientCtor 注入）与
  `simulatorWorkerRuns/workerClient` 测试覆盖；建议用真实存档做一次短跑复核。

### 11.5 已知限制（MVP）

- 仅优化已佩戴技能的触发器；食物/饮品归 Food Optimizer。
- coordinate descent 为贪心搜索：非全局最优，且受 `candidateLimit` 截断。
- 迷宫模式直接拒绝（数值候选依赖 `resolveOptimizerResources` 的 zone/dungeon 路径）。
- ~~`rounds`（单场重复次数）固定为 1~~：2026-09-17 已开放为可配置，
  **并在第四轮重构后默认 2、由种子集驱动（§14.2/§5.3）**。
- ~~无复验~~ / ~~报告里的提升无法证伪~~：第四轮已加独立复验（§14.5）。
- 仍未覆盖：真实导入存档的 worker 全链模拟（§11.4 / §14.10）。

---

## 12. 第二轮调整（2026-09-17，按用户要求）

1. **菜单**：zh 标签「技能触发器」→「技能优化」；路由 meta 由 `tools/4.5` 改为
   `simulation/2.6`（侧栏排在「食物优化」正下方）。见 §9.1/§9.3。
2. **重复次数开放**（§5.3）：`settings.rounds`（1-10，默认 1）接入搜索；`aggregateRoundMetrics`
   聚合（数值取均值 / 空蓝任一场即判负 / 任一场失败即整体失败）；每场抽样新建 worker 且
   `workerId` 带 `#rN` 后缀；结果新增 `simulations` 与 `evaluationRounds`，结果区显示
   「候选评估」与「模拟场次」。
3. **搜索强度预设**（§5.4）：fast(6/1/1)、standard(8/2/1，= 默认)、fine(16/3/2)；预设不持久化，
   由 (candidateLimit, maxRounds, rounds) 三元组派生，「自定义」在 select 里不可选；
   搜索轮数上限 / 每槽候选上限移入「高级设置」`<details>`。
   **⚠️ 本轮（第二轮）数值已被第四轮取代：standard = 10/2/2、fine = 16/3/3，见 §14.2/§14.4。**
4. 验证：`npm test` **177 文件 / 2377 测试全绿**（较首轮 +14：Domain +5、Simulation +5、
   Search +1、页面模板 +3），Prettier 全仓通过；`npm run build` 成功
   （`TriggerOptimizerPage-*.js` 20.17 kB / gzip 5.78 kB）。
5. 浏览器冒烟（dev server）：默认档 =「标准」（提示行「当前「标准」：每槽候选上限 8、
   搜索轮数上限 2、重复次数 1」）；切「精细」→ 三个控件同步为 16/3/2 并落盘
   `mwi.triggerOptimizer.settings.v1`（`rounds: 2`）；手改高级项 → 档位即时变「自定义」；
   控制台无 error。

---

## 13. 第三轮修正（2026-09-17）：移除「暴走」候选

**现象**（用户反馈）：候选表里出现「激怒未激活时」，其触发器文本是 `自身 暴走 未激活`；
用户表示「我都没带什么暴走技能」——既然自身永远不会暴走，这个条件就是无效的。

**结论：两个 enrage 候选在引擎里是常量，属于无效候选，已删除。**

| 原候选                      | 角色 | 引擎实际行为                                                    |
| --------------------------- | ---- | --------------------------------------------------------------- |
| `self / enrage is_inactive` | 输出 | 恒真 → 与 `[]`（立即释放）行为**完全等价**，白跑一场模拟        |
| `self / enrage is_active`   | 光环 | 恒假 → 光环**永不释放**（一旦被选为最优并应用，等于废掉该技能） |

证据链：

1. `combatsimulator/trigger.js` 136-140：`enrage` condition 是**前缀匹配**——
   `Object.keys(source.combatBuffs).filter((buff) => buff.startsWith('/buff_uniques/enrage'))`，
   而 `dependency=self` 时 source 是玩家单位。
2. `combatsimulator/combatSimulator.js` 1580-1626（`processEnrageTickEvent`）：
   `/buff_uniques/enrage_damage` / `/buff_uniques/enrage_accuracy` 只会 `enemy.addBuff(...)`
   ——**暴走是怪物的增益**（`combatMonsterDetailMap.json` 的 `enrageTime`：普通怪 3 分钟、BOSS 10 分钟）。
3. 全仓检索 `buff_uniques/enrage`：除「引擎给敌人挂增益」与其测试外，没有任何技能/消耗品/装备会给
   玩家自己挂 enrage 系增益 → 玩家侧 `combatBuffs` 永远不含该前缀的键。
4. 术语不一致是困惑的直接来源：官方中文把 `/combat_trigger_conditions/enrage` 译作**暴走**
   （`locales/zh/translation.official.generated.json`），而候选标签原先自造「激怒」；同一行的
   触发器文本走官方译名显示「暴走」，于是同一件事出现两个名字。随候选一并删除。

**改动**：`triggerOptimizerCandidates.js` 删除 `CONDITION_ENRAGE`、两个 enrage 标签键与
`damageCandidates` / `auraCandidates` 中对应的描述符（光环角色因此只剩「默认 + 立即释放」两个锚点）；
`locales/{zh,en}/common.json` 删除 `candidate.enrageInactive` / `candidate.enrageActive`；
`triggerOptimizerCandidates.test.js` 增加「任何候选都不得引用 enrage condition」的回归断言。

**未做（留待讨论）**：若将来确实想要基于暴走的触发器，引擎里唯一活着的形式是
`targeted_enemy / enrage is_active|is_inactive`（对**目标敌人**取值：怪打久了确实会暴走）。
本轮不新增，避免在收益未确认前扩大候选空间。

---

## 14. 第四轮重构（2026-09-17）：公共随机数 + 配对打分 + 合取候选 + 独立复验

本轮针对用户提的五点（①算法准确 ②模拟结果准确 ③易用性 ④反馈与调整机制 ⑤性能稳定）
做结构性重做。**已与用户确认的范围决定**：

- **A** 维持现状范围：只调「已佩戴技能的触发器」；
- **B** 允许单技能配多条触发器（≤4，**合取**，见 §1.4）；
- **D** 接受耗时增加换准确（用户接受「1.5~2 倍」，实测约 1.9 倍）；
- **C 被否决**：不动技能槽本身（不做配装优化）。

### 14.1 根因①：没有公共随机数（CRN）—— 本轮最致命的问题

**症状**：同一份配置跑两次得到不同结论；报告里的「提升」与应用后的实际表现不符。

**证据（改动前）**：`src/worker.js` **不读 `payload.workerId`、不播种 `Math.random`**；
战斗引擎的伤害/命中/暴击/招架/掉落/刷怪全部走 realm 全局 `Math.random`
（`combatSimulator.js` / `combatUtilities.js` / `zone.js` 合计 20+ 处）。
`triggerOptimizerSimulation.js` 给每个候选追加 `workerId#rN` 后缀**在引擎侧毫无作用**（死代码）。
于是「候选 vs 基线」的差异里 RNG 噪声远大于触发器本身的影响 ——
优化器实际在挑「哪次抽样运气好」。

**修复（三层）**：

1. `src/services/seededRandom.js`（新增）：`createSeededRandom`（mulberry32：32 位种子、
   周期 2^32、跨 realm 一致、无外部依赖）、`hashSeed`（FNV-1a 变体）、
   `deriveSeedSet(baseSeed, count)`（派生走独立 RNG 实例 → 增删轮次不会改变已存在轮次的种子）。
   `deriveSeedSet` 对非有限/非正 `count` 返回**空集**（`Math.max(0, NaN)` 仍是 NaN，
   会让循环条件静默失效）。
2. `src/worker.js`：`installSeedScope(seed)` 在 `combatSimulator.simulate()` 前后
   `try/finally` 替换/恢复 `Math.random`。**opt-in**：不传 `seed` 时行为与历史完全一致
   （首页模拟 / 队列 / 推荐扫描零影响）；播种是 realm 私有的（每次
   `runSingleSimulationPayloadWithDedicatedWorker` 都新建 Worker）。
3. `triggerOptimizerSimulation.buildCandidatePayload(..., options.seed)` +
   `buildSeededPayload`：把**该轮种子**写进 `payload.seed`；一个评估内 N 轮串行使用
   `seeds[0..N-1]`。同时强制 `logCombatEvents:false` 与 `enableHpMpVisualization:false`
   （wipe 日志/逐事件输出/血蓝时间序列对只读指标毫无价值，在「候选 × 轮数」次评估下是纯浪费）。

**使用约束**：一个 realm 内同一时刻只允许一个播种作用域。三种合法用法：
专用 worker 内播种（本优化器）、主线程串行评估（foodOptimizer 的 `activeRandomScopes` 守卫）、
测试内显式注入。**绝不可**在并发任务共享的 realm 里就地替换 `Math.random`。

### 14.2 种子集：search / verify 两套，且刻意排除 triggerMap

`createTriggerOptimizerSeedSet({ playerId, playerConfig, simulationSettings, salt, count })`
把「与搜索过程无关的稳定上下文」折成一个种子：
`playerId | 已佩戴技能 hrid 列表 | 区域/难度/时长 | salt`，再 `deriveSeedSet`。

- **为什么刻意排除 triggerMap**：搜索过程中 triggerMap 不断变化；若把 triggerMap 算进种子，
  **每个候选会跑在不同随机流上**，配对性立刻失效 —— 这正是早期版本「结论不可复现」的根因之一。
- **两套种子**（salt 必须不同）：
  - `TRIGGER_OPTIMIZER_SEED_SALT_SEARCH = 'trigger-optimizer.search.v1'`，
    `count = settings.rounds`（默认 2）→ 搜索期；
  - `TRIGGER_OPTIMIZER_SEED_SALT_VERIFY = 'trigger-optimizer.verify.v1'`，
    `count = TRIGGER_OPTIMIZER_VERIFY_ROUNDS = 6` → 复验期。
- **确定性**：同样输入 → 同样种子集 → 同样结论（可复现、可交叉验证）。
- **生产路径必须显式传 `seeds`**；`resolveEvaluationSeeds` 的「按 `payload.workerId` 派生」
  分支只是测试/旧调用方兜底，**没有配对保证**。
- **默认 rounds 从 1 提升到 2 的理由**：① 配对差的主噪声需要第 2 轮抽查一致性；
  ② 长程混沌发散（触发器改动会让事件时间线分叉，24h 尺度上配对相关性会衰减）。
  单轮配对比较的信息量远高于单轮非配对比较，上限 10 留给需要更稳结论的用户。

### 14.3 打分重构：从「比值 + 钳零」改为「配对差」

公式与两个旧缺陷见 §5.2。要点：

- **唯一实现处**：`triggerOptimizerDomain.computeObjectiveScore`
  （`triggerOptimizerScoring.scoreCandidate` 只是封装）。
- `TRIGGER_OPTIMIZER_RELATIVE_LOG_SCALE = 1.0`（相对基线翻倍 = +1 分 / 腰斩 = -1 分）；
- `TRIGGER_OPTIMIZER_METRIC_FLOORS = { dps: 1000, dailyNoRngProfit: 10000, xpPerHour: 1000, killsPerHour: 1 }`
  （只在基线接近 0 时起作用，避免「基线 0 利润」把 1 点差异放大成满分）；
- **空蓝改为配对守恒**：`TRIGGER_OPTIMIZER_MANA_RECOVERY_BONUS = 0.25`，
  只有「参考不空蓝 → 候选空蓝」才 `-Infinity`；
- **死亡项对称化（2026-09-18）**：新增 `TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT = 1.0`
  与 `computeDeathReductionCredit`，死亡减少由「完全不得分」改为与惩罚同量级、
  同分母口径的奖励（上限 `CREDIT × weightDeathSafety`）。旧口径下「利润相当但更安全」
  的候选在分数里无法区分，与用户「死亡更低」的目标脱节。
- **第 2 层配对统计** `computePairedStats(candidateMetrics, referenceMetrics, weights)`：
  要求两侧 `samples` 长度相同且第 i 轮同种子；逐轮相减 → `summarizeSamples` →
  mean / 标准误 / t / dof / 双侧 p / verdict；
- **p 值必须用 `jstat` 的 Student-t 真实 CDF**（项目已依赖，`enhancementSimulator.js` 也在用）。
  **不要**用「|t| ≥ 2 ≈ 95%」近似：本功能默认 2 轮，自由度 1，t 要 12.7 才 p < 0.05，
  近似会给出假阳性。出现 `-Infinity`（空蓝回归）→ 直接 `negative` 不做统计；
  所有差值完全相同且非 0 → 标准误 0 → t = ±Infinity → p = 0 → 明确的 positive/negative；
  `rounds < 2` → `t/p = null`、`verdict = 'unknown'`（UI 显示「样本不足」）；
- **采纳判据** `shouldAdoptCandidate`：严格更优（> best + 1e-9）**且**配对信号非 `negative`；
- **排序** `compareCandidates`：在 tie-break 里插入配对信号等级
  （positive 2 > inconclusive 1 > unknown 0 > negative -1）；
- **报告缺陷修复**：`chosenBySlot` 保住「采纳时的 winner」（§7.2 的说明）。
  旧实现让后续轮次「自己 vs 自己」的 0 分覆盖已采纳结果 → 用户看到「优化了但每项 0.0000」；
- **`metricsByCandidate` 的键从「仅签名」改为 `"slotIndex|signature"`**：不同技能完全可能生成
  同一份触发器列表，只按签名做键会**串味**（A 技能的分数显示在 B 技能的候选行上）。

### 14.4 候选空间：合取组合候选 + 交错配额

- **引擎语义是 AND**（§1.4，`ability.js` 102-109）：组合候选只能表达「既要…又要…」。
- 新增 `compositeCandidates(ctx)`（每角色 ≤3 条、每条 2 个触发器；总条目上限
  `TRIGGER_OPTIMIZER_MAX_TRIGGERS_PER_CANDIDATE = 4`，与 `MAX_TRIGGER_COUNT` 同源）：
  - **输出**：「敌方残血 且 蓝量充足」「多目标 且 蓝量充足」「自身残血 且 蓝量充足」（需 maxHp/maxMp）；
  - **增益**：「buff 失效 且 蓝量充足」「buff 失效 且 自身血量健康」；
  - **Debuff**：「减益失效 且 多目标」（**不需要绝对值，始终可用**）、「减益失效 且 蓝量充足」；
  - **防御/治疗**：「队友残血 且 蓝量充足」「自身已损血量 ≥ 阈值 且 蓝量充足」；
  - **光环**：「光环失效 且 队友残血」「光环失效 且 自身残血」——**不需要绝对值，始终可用**。
- **依赖分层**：需要 maxHp/maxMp 的组合只在 `resourcesAvailable` 时产出；不需要绝对值的组合
  始终产出。这样即使 `resolveOptimizerResources` 失败，也不会退化成「只剩默认 + 立即释放」。
- **交错 push**：单条件与组合按 index 交替进入 descriptors，再统一截断到 `candidateLimit`；
  否则组合候选（生成顺序在末尾）在默认上限下一条都进不来。
  `DISTANCE_COMPOSITE = 3`（最大）→ 同分时优先采纳单条件候选。
- **去重**：`push` 拒绝同一 condition 出现两次的组合
  （`current_hp <= 50` 且 `<= 75` ≡ `<= 50`，与单条件候选重复，白跑一场模拟）。
- **修掉「光环技能零优化空间」**：`auraCandidates()` 单条件仍返回空数组
  （enrage 候选已删，见 §13），但上面两条组合候选填上了这条空白。

### 14.5 独立复验（VERIFY_ROUNDS = 6）

搜索结束后，用 **verifySeeds**（另一组种子）重跑「基线 vs 最优」并做配对比较：

```js
verification = { baselineMetrics, bestMetrics, paired, verdict, seeds, rounds: 6 };
```

- 只跑 2 个配置 × 6 轮 = **12 场模拟**，换来自由度 5 的 t 检验（t ≥ 2.57 → p < 0.05）。
  搜索期因成本只能廉价抽样（默认 2 轮），统计功效集中花在最终结论上更划算。
- `verdict ∈ { positive, negative, inconclusive, unknown }` 直接上抛到 UI；
  页面显示复验结论 + p 值 + 说明文案。
  **旧实现完全没有这一步，报告里的提升无法证伪。**
- 进度阶段新增 `phase: 'verifying'`；`totalSimulations` 的估算里包含这 12 场
  （`(1 + maxRounds × Σ候选) × rounds + 2 × 6`）。

### 14.6 锁定技能（易用性 / 反馈与调整）

- 设置项 `settings.lockedAbilityHrids`：**存 hrid 而非槽位下标**
  （槽位顺序/等级闸门变化后语义仍稳定）。
- 归一化：去重 + 排序（勾选顺序不同不应让输入指纹变化）；
  校验：缺省（未勾选）合法，显式给非数组或含空串/非字符串即非法。
- 锁定集合**进入输入指纹**：改锁 → 既有报告立即标记过期，不会被误应用。
- 搜索引擎跳过锁定槽（候选照旧上报给 UI 展示当前配置）；
  store 入口 `setTriggerOptimizerLockedAbilities(hrids)` 复用
  `setTriggerOptimizerSettings` 的归一化 + 校验 + 落盘 + 过期标记链。

### 14.7 一个坑：`export { X as Y } from '...'` 不建立本地绑定

`foodOptimizerSimulation.js` 把 mulberry32 抽到 `seededRandom.js` 后，若写成

```js
export { createSeededRandom as createFoodOptimizerRandom } from './seededRandom.js';
```

**模块体内引用 `createFoodOptimizerRandom` 是 `undefined`**（具名转发只做 re-export，
不在本模块建立本地绑定），曾导致 2 个 unhandled rejection + 34 个测试失败。正确写法：

```js
import { createSeededRandom } from './seededRandom.js';
export const createFoodOptimizerRandom = createSeededRandom;
```

### 14.8 本轮推翻的旧结论（旧文档如有冲突，以本节为准）

| 旧结论（作废）                                                              | 现在的事实                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| §3.2/§10.5「不要装 `Math.random` 种子」「按 `workerId` 派生随机流」         | 通过 `payload.seed` 在专用 worker realm 内播种；`workerId` 只是日志标识，与随机流无关 |
| §5.2 `LOG2_SCALE` + `(m+1)/(base+1)` + `Math.max(0, …)`                     | 配对差口径 `log2(1 + Δ/max(\|base\|, floor))`，`RELATIVE_LOG_SCALE = 1.0`             |
| §5.2「候选空蓝直接判负」                                                    | 只在「参考不空蓝而候选空蓝」时判负；反向给 +0.25 加分                                 |
| §5.3「空蓝任一场即判负」「`workerId` 追加 `#rN` 保证抽样独立」              | 空蓝判负在打分侧按配对决定；`#rN` 只是可读后缀，随机流由 `payload.seed` 决定          |
| §5.4「standard 8/2/1、fine 16/3/2」                                         | standard **10/2/2**、fine **16/3/3**、fast 6/1/1                                      |
| §6.2「光环角色只剩默认 + `[]` 两个锚点」                                    | 光环有两条「不需要绝对值」的组合候选（§14.4）                                         |
| §6.3「每技能候选上限默认 ≤ 8」                                              | 默认 **10**、上限 16，并为组合候选预留交错配额                                        |
| §7.2「搜索结束即返回，无复验」                                              | 有独立复验阶段（verifySeeds × 6 轮，§14.5）                                           |
| §7.2 报告候选 key = 签名                                                    | key = `"slotIndex\|signature"`（防跨技能串味）                                        |
| §8.1 规划里的 `triggerOptimizerSnapshot.js` / `TriggerOptimizerDetails.vue` | 未落地；输入快照/指纹在 `triggerOptimizerDomain.js`，候选详情内嵌页面                 |
| §11.5「真实 worker 全链模拟未覆盖」                                         | 仍未覆盖（§14.10）                                                                    |
| §5.4 fast 档 `rounds: 1`                                                    | fast = **6/1/2**（rounds<2 时采纳闸门恒拒绝 → 该档会变成「只烧机器」的死档，§16.4）   |
| §7.2「采纳判据 = 聚合分严格更大（eps=1e-9）且配对信号不是 negative」        | 必须**同时**满足「≥ MIN_ADOPT_SCORE(0.01)」与「配对证据超过噪声地板」（§16.2）        |
| §14.5 复验只作为「报告里的第二层结论」                                      | 复验判 `negative` 时**禁止应用**：UI 禁用按钮、store 拒绝写入（§16.3）                |
| §6.3 斩杀线 = 玩家 `maxHp × 30%`                                            | 斩杀线/防浪费阈值 = **区域真实怪物血量**（`enemyHp.min/group`）换算（§16.4）          |

### 14.9 自动化验证（本轮）

- `npx vitest run`：**177 文件 / 2413 用例全绿**（在 2411 基线上 +2：§14.10 缺陷② 的指纹
  回归 + 缺陷③ 的 devtools 代理遮蔽回归；0 失败 0 跳过）。
- `npm test`：vitest 全绿 + Prettier 全仓通过（`TriggerOptimizerPage.vue` 曾报格式问题，
  已 `npx prettier --write` 修复；格式化后页面模板测试 21/21 仍通过，测试钩子完好）。
- `npm run build`：成功；`TriggerOptimizerPage-*.js` **27.08 kB（gzip 7.35 kB）**，旧版 20.17 kB。
- 测试分布：Domain 44 / Scoring 32 / Candidates 26 / Simulation 20 / Search 7 /
  Semantics 19 / 页面模板 21 / Store 13（含 §14.10 缺陷② 的指纹回归测试与缺陷③ 的
  devtools 代理遮蔽回归）/ Food Store 61（含同款遮蔽回归）。
- 成本：标准档约 **54 场模拟**（(1 + 2×1×10)×2 + 12），约旧版 1.9 倍；
  精细档约 3.8 倍。

### 14.10 浏览器冒烟（dev server 实测，2026-09-17）：发现并修复的三个缺陷

冒烟方法：dev server（vite）+ 内嵌浏览器；用仓库里的真实角色夹具
（`src/services/__tests__/fixtures/modernPlayerJunglePlanetFixture.json`，法系 5 技能 +
自定义 triggerMap）注入 store 等价「已导入」，区域=丛林星球、1 小时、快速档，
**点 UI 按钮走真实 worker 全链**（这是 §11.4 一直缺失的真实链路覆盖）。

**实测通过项**：

- 空态（未导入）：requireImport 提示 + 「去首页导入」链接，开始按钮禁用，控制台零 error/warning；
- 预设与预计场次：快速 6/1/1 → 「预计模拟场次 43」= (1 + 1×5×6)×1 + 12，与搜索层公式一致；
  锁定一个技能后变 37（可搜槽 4）；
- 真实全链：32 次评估 / 42 场模拟 / 10 秒完成；组合候选真实出现在候选表
  （「目标残血且自身蓝量充足」「光环失效且队友残血」…），AND 澄清文案就位；
- 结果摘要：已优化技能 1/5、复验结论「未达显著：可能只是噪声」、p 值 0.774 ——
  与 delta（dps +1.7% / 利润 +0.8%）一致地诚实（rounds=1 时信号列如实显示「样本不足」）；
- 可复现性（CRN 生效的直接证据）：重载页面重新注入同一存档再跑，结论与首次完全一致
  （同为「元素光环 → 立即释放、得分 0.0157」）；
- 应用后到达固定点：应用方案后再跑一轮 → 0 改进（improved=false，应用按钮正确禁用）；
- 锁定/过期：锁定 → 报告立即过期（不会被误应用）+ 预计场次下降；
  设置改动走同一套归一化 + 校验 + 落盘链。

**缺陷①（已修）：复验 p 值重复展示** —— i18n 串 `verificationPValue` 已含 `{{p}}`，
模板下一行又单独打印一次数值。修法：两语言改为纯标签（zh「p 值」/ en「p value」），
模板删去插值参数，保留「标签 + 数值」两行结构。

**缺陷②（已修，较隐蔽）：应用后「撤销」按钮消失** —— 现象：应用方案成功后
`results.stale` 被置 true（sticky），`canRevert`/`canApply` 永久为 false。
根因链：`createOptimizerInput` 用 `deepClone` 克隆**整个玩家**做输入指纹，而玩家对象上的
`assetScore` 是**行情/资产管线异步写入的派生字段**（内含 `computedAt` 时间戳）；
应用写回 triggerMap → 资产管线重算 → 签名瞬时漂移 → 过期 watcher（非遮蔽窗口）触发 →
sticky 置位。修复：指纹收窄为**战斗键白名单** —— 把
`foodOptimizerSnapshot.js` 的 `COMBAT_PLAYER_KEYS` 导出为单一事实源，
`createOptimizerInput` 只克隆这 12 个键（id/name/levels/equipment/food/drinks/abilities/
triggerMap/combatScrolls/houseRooms/guildBuffs/achievements）。
这也正是设计 §3 原本要求的「COMBAT_PLAYER_KEYS 清单照搬」——实现偏离了契约。
回归测试：`triggerOptimizerDomain.test.js` 新增
「excludes derived player fields (assetScore etc.) from the fingerprint」。

**缺陷② 的定位修正（同日定案）**：指纹收窄为战斗键白名单**是独立成立**的加固
（派生字段不该进指纹，符合设计 §3 契约），但它**不是**「撤销按钮消失」的根因——
收窄后该现象照旧复现；真根因见缺陷③。

**结论（务必记住）**：玩家对象上**任何**由行情/资产/异步管线写入的派生字段
（现在或将来）都绝不能进输入指纹；增删指纹键必须同时评估「过期是否太松/太紧」。

**缺陷③（已修，真根因）：Pinia devtools 插件把每次 action 调用的 `this` 换成新建的
`new Proxy(store)`，「以 store 身份为键」的遮蔽因此永不命中** ——
现象：应用方案成功后 `results.stale` 被置 true（sticky），`canRevert`/`canApply` 永久
false、撤销按钮消失；而 `appliedInputSignature` 与当前指纹**始终相等**
（`sigEqApplied === true`），只看 getter 会误判成「没有签名漂移」。

- 直接证据（干净文档 + 真实 UI 链路）：apply 的 `$patch` 内写 `player.triggerMap` 的同一
  时刻 watcher 被触发 **2~3 次**，其中一个是 `masked=false`，且此刻
  `appliedInputSignature` 还是空串（`appliedLen=0`）→ 走 `(applied || inputSignature)`
  兜底比较 → 判「输入变了」→ `results.stale = true` 被钉死（sticky 只置不清）。
- 机制（`node_modules/.vite/deps/pinia.js` 的 `patchActionForGrouping`，devtools 插件对
  options store 生效）：`actions[name].apply(new Proxy(store, {get/set: …}), args)`。
  于是 `trackedStores.has(this)` 恒 false —— **每次 action 都新建一个 watcher**（层层
  叠加，同一次突变触发多次）；`applyingStores.add(this)` 加进去的也是「本次调用专属」
  的代理，永远对不上老 watcher 闭包里的那个对象。
- 生产构建不安装 devtools 插件 → `this` 就是 store 本身，该现象**仅 dev**；
  但「以对象身份作遮蔽/去重键」本身脆弱，仍按契约修掉（prod 行为不变）。
- 修复：两个优化器模块统一 `storeKey(store) = toRaw(store)`，注册/遮蔽/去重一律用它
  （对 devtools 代理与 reactive 代理都返回同一个原始 store）。
  `simulatorTriggerOptimizerActions`：`trackedStores` + `applyingStores`；
  `simulatorFoodOptimizerActions`：同款两处，并顺带修掉 `runs` / `reportCaches` 两处
  身份键 WeakMap（dev 下会漏命中 report 缓存与取消句柄）。
- 回归测试（各模块一条，均已反证）：`stores/__tests__/triggerOptimizerStore.test.js` 与
  `foodOptimizerStore.test.js` 的「keeps apply-time masking when actions are invoked
  through a rebound `this` (Pinia devtools proxy)」——把 `storeKey` 临时退回身份键，
  两条测试必红（分别落在 `results.stale` / `report.stale` 断言上）。
- 修复后实测（干净文档 → 注入夹具 → 跑 → 应用 → 等 10s）：`stale=false`、
  `triggerOptimizerReportStale=false`、「撤销应用」按钮存在且可点；点撤销后
  `triggerMap` 与基线逐字节相等、`baselineSnapshot=null`、按钮回到「应用方案」。
- **上一会话「未决」的判断作废**：当时「干净刷新后仍复现」的现场是**假刷新** ——
  同 URL 的 hash `navigate` 是 same-document no-op（控制台时间线：13:36 之后再无页面
  加载，却能看到 13:33 的 `COMBAT_PLAYER_KEYS` 报错与 14:03 的 SFC HMR 残留），
  于是浏览器里是**混版模块**进程，证据不可用。教训：做浏览器实验前的「刷新」必须
  `location.reload()`／硬刷新，并用 `performance.timeOrigin` + `results.createdAt === 0`
  自证是干净文档。

### 14.12 运行期显示：时间与进度平滑（2026-09-18）

问题（用户实测反馈）：进度条与已用时间不是连续走，而是「冻住 → 跳一下」。查证：

- 搜索层的 `onProgress` 只在**离散检查点**发布——每次评估结束的 `finally`（每完成一个候选
  评估一次）+ 阶段切换的强制发布；`PROGRESS_THROTTLE_MS = 150` 是**上限**节流
  （`if (!force && now - lastPublishAt < 150) return`），**没有定时器兜底**。
- 于是「时间的步长 = 两次评估之间的真实耗时」：快速档 1 小时 ≈ 0.2~0.6 s，标准/精细档
  （24 h × 2 轮）单次评估可达数秒；进度则是 `evaluations / totalEvaluations`（快速档 1/32
  ≈ **3.13%/格**），且并行 worker 成批收工 + 150ms 节流把一批塌成一次上报 → 冻结与跳变更明显。
- 页面侧也没有本地时钟（`src/ui` 全仓无 `setInterval`/`rAF` 的计时用途），显示值纯粹事件驱动。

修复（页面本地平滑 + 计时原点对齐）：

- `TriggerOptimizerPage.vue` 运行期起一个 **100ms 本地时钟**（只在 `runtime.isRunning` 期间
  存在，停止/卸载即 `clearInterval`）：
  - **时间**：从「最后一次上报值」继续走，上报到达即重锚，并取 `max(本地外推, 上报值)` →
    既不倒退也不落后；
  - **进度**：向「上报值 + 1.5 个评估格」做单调缓动（每 tick 消化 25% 剩余差距，≈0.4 s 追上），
    **只增不减**。领先量有上限，暂停页面显示的领先/落后都不大；
  - 停止后一律回落到报告里的真实值（口径与 `liveStats` 其它字段一致）。
- `etaSeconds` 仍按**上报值**外推（不改口径，避免显示值与估算基准互相追着跑）。
- **计时原点对齐**：`optimizeTriggers` 新增 `input.startedAt`（缺省退回自己的 `Date.now()`），
  store 把自己的运行起点传进去。此前准备段（动态导入 + `buildPlayersForSimulation`）只算在
  页面侧、不在报告里，跑完那一刻数字会往回缩一截（实测 −0.8 s）；对齐后
  `result.elapsedSeconds` 与页面的「自点击开始搜索」同口径。

实测（快速档，250ms 采样，硬刷新后的干净文档）：

- 时间：`0.2 → 0.4 → 0.7 … → 8.6 s` 连续走，而 store 的上报值期间一直卡在 `0.487 / 1.22 /
5.094`；收尾 `8.6 → 8.8`（**继续前进**，不再回缩），报告值 `8.832`。
- 进度：连续爬升 `0.019 → 0.067 → … → 0.951`，且领先被限在 1.5 格（上报 `0.9375` 时页面
  正好 `0.9844 = 0.9375 + 1.5/32`），完成后立刻补到 `1.000`。

回归测试：`TriggerOptimizerPage.template.test.js` 两条（时间在上报空档里继续走 + 进度单调
且领先 ≤ 1.5 格；结束后回落报告值并**停表**——空转计时器数归零）；
`triggerOptimizerSearch.test.js` 一条（传 `startedAt` 时报告与每次上报都 ≥ 该偏移，缺省不受影响）。

### 14.11 仍未覆盖 / 后续可加固

- ~~真实导入存档的 worker 全链模拟未跑~~：2026-09-17 已用仓库真实角色夹具注入 store
  走通（§14.10）；仍建议用**用户真实存档**做一次短跑复核（夹具覆盖法系一种角色形态）。
- dev-server 专项：改源码会即时 HMR 到已开的页面 → 关键实验前必须硬刷新；
  项目根无 `tail`（PowerShell）→ 读 dev 日志用 `Get-Content -Tail`（UTF-16）。
- 团队维度：优化器只模拟 activePlayer 单人（playerConfig 只传单人），队友配置变化
  不会让报告过期——与「实际模拟的就是单人」自洽，但若将来把队友纳入模拟，
  输入指纹必须同步扩展（当前 COMBAT_PLAYER_KEYS 白名单不含队友）。
- 锁定→解锁回原值后，报告仍是 sticky 过期（与 foodOptimizer 的保守门禁同款取舍）：
  用户需重跑一次才能拿到可应用的报告。若将来觉得太保守，可把 sticky 旗标改为
  「仅签名漂移时置位、签名恢复时清除」，但必须先想清楚「非指纹维度的输入变化」如何兜底。
- 可补「同一槽基线与全部候选收到同一组 seed」的集成断言
  （当前由 `triggerOptimizerSearch` 测试间接覆盖）。
- 指标经 `toFiniteNumber` 会丢弃 `Infinity` → 测试里「饱和到 +1」必须用有限大值（如 1e12），
  不能用 `Infinity`。
- 迷宫模式仍直接拒绝（数值候选依赖 `resolveOptimizerResources` 的 zone/dungeon 路径）。
- **coordinate descent 不是全局最优**：逐槽独立优化，**槽间交互无法发现**（例如
  「A 技能在 B 技能触发后释放才更好」这类跨槽条件依赖）；候选数受 `candidateLimit`
  截断，精炼也只覆盖「被采纳候选的 ±1 邻域」，不是阈值的全局搜索（例如 50% 被采纳后
  只看 40/60，不会跳到 45%——除非 40/60 之一被采纳后进入下一轮再精炼）。
  这是「成本 vs 最优性」的刻意取舍：全枚举在组合空间上不可行（§7.1）。
- 精炼的单指标归一化在相对变化 ≥ 100% 时饱和（`log2(2) = 1` 即钳到 1）：候选指标
  若线性放大到 2 倍以上，`count=2/3/4` 会同分、并列时 tie-break 选改动更小者——
  精炼通路只在**次对数**的指标梯度下被触发。真实模拟里指标梯度通常远小于 100%
  （换一个触发器很少让 dps 翻倍），所以这不是实践障碍，但**测试桩必须用次对数梯度**
  才能覆盖精炼路径（见 `triggerOptimizerSearch.test.js` 的 `betterWithMoreEnemies`）。
- 提交前提醒：本次改动**尚未 git 提交**，提交须先经 `user-interaction-askUserQuestion` 征得用户同意。

---

## 15. 第五轮：算法评估与两项改进（2026-09-18）

用户问题：「现在的技能优化算法合理不？能不能让系统找出当前佩戴技能的最优触发，
让利润更高、经验更高、死亡更低？」

### 15.1 评估结论：整体合理，工程水准高

通读 `triggerOptimizer*.js` 全链路后确认的既有优势（**不是场面话，逐条对应实现**）：

- **CRN 公共随机数**：payload.seed 播种，同槽基线与全部候选共享 `searchSeeds`，
  逐轮配对差抵消噪声（§14.1/§14.2）；
- **配对打分口径**：`relative = (m_c - m_base) / max(|m_base|, floor)` + `log2` 压缩，
  对负基线正确、量纲无关、对称（§5.2）；
- **两层结果**：聚合分（采纳判据）+ 逐轮配对 t/p（证伪通道），`rounds < 2` 时
  verdict 给 `unknown` 而不是假结论（§14.3）；
- **独立复验**：换 salt 的 6 轮重跑「基线 vs 最优」，搜索期的提升可被证伪（§14.5）；
- **空蓝配对守恒**：只有「参考不空蓝 → 候选空蓝」才判负，基线自己空蓝的候选
  不会被系统性误杀（§5.2）；
- **配对参考链**：采纳后 reference 直接换成 winner 指标，零额外模拟保持配对性（§7.2）。

### 15.2 弱点 A（已改进）：阈值网格固定且粗糙

`TRIGGER_OPTIMIZER_DEFAULT_THRESHOLDS` 的百分比档位（25/50/75/90）粒度是 25 个百分点：
真实最优阈值常落在格点之间（例如 62%），网格**永远搜不到它**。全量加密网格会让
候选数爆炸，而**自适应阈值精炼**只对「刚被采纳的单条件数值类候选」做一次 ±10 邻域
搜索——模拟成本只花在已证明有改进的槽上（实现细节见 §6.3，搜索层接入见 §7.2）。

### 15.3 弱点 B（已改进）：死亡减少完全不得分

`computeDeathPenalty` 只惩罚死亡**增加**，减少则贡献为 0：基线死 5/h、候选死 1/h
时两者在死亡项上无法区分，用户「死亡更低」的目标在目标函数里没有对应物。改进为
**对称奖励**（§5.2 的 `computeDeathReductionCredit`，`CREDIT = 1.0`）。

重叠说明（避免过度解读）：引擎里死亡有真实成本——`PLAYER_RESPAWN_INTERVAL = 150s`
的复活停摆 + `clearBuffs` + `clearCCs`（`combatSimulator.js`），dps/xp 指标已经
部分反映死亡代价；所以本项是**偏好性加权**（默认权重上限 0.2 分），不构成
「送死换分」的逆向激励（增加死亡仍被惩罚，且惩罚无上限）。

### 15.4 弱点 C（仍为已知限制，见 §14.11）

coordinate descent 非全局最优、槽间交互无法发现、受 `candidateLimit` 截断、
迷宫模式拒绝。这些是「成本 vs 最优性」的刻意取舍，未在本轮修改。

### 15.5 成本影响

精炼只在「候选被采纳」时触发，每槽最多 2 个邻域候选；标准档（maxRounds=2、
10 候选/槽）实测基线约 54 场模拟，精炼增量约 **4 到 6 次评估（8 到 12 场，约 2 成）**，
换来阈值精度从 25 个百分点提升到 10 个百分点。进度分母按估算上界（§7.2）。

### 15.6 自动化验证

- `triggerOptimizerCandidates.test.js`：34 tests（含 8 条新增精炼单测——
  百分比 ±10 与 floor/ceil 取整、`lowest_hp_percentage` 无资源精炼、计数 ±1 与
  clamp [2,8]、百分比 clamp [5,95]、资源降级、不可精炼清单、物化 + 签名去重）；
- `triggerOptimizerDomain.test.js` / `triggerOptimizerScoring.test.js`：
  77 tests（死亡对称奖励的单元与配对层断言）；
- `triggerOptimizerSearch.test.js`：9 tests（含 1 条精炼通路集成测试——
  网格 count=3 被采纳 → 精炼 count=4 再被采纳 → 回写候选表 → 固定点收敛 →
  复验 verdict=positive；顺带验证「评估次数 > 无精炼口径」）；
- **全量 `npm test`：2426 tests 全绿，prettier 无格式问题**。

## 16. 第六轮：实测评估与四道闸门（2026-09-18）

用户问题：「你评价一下，现在的技能优化功能怎么样，我怎么感觉无法模拟出来提升」。

这一轮不再靠读代码推断，而是**把功能跑起来量**：dev server + 内嵌浏览器，注入仓库里的
真实角色夹具 `src/services/__tests__/fixtures/modernPlayerJunglePlanetFixture.json`
（法系 120 级 / 5 技能 / 丛林星球），走真实 worker 全链，改的是页面上的设置。

### 16.1 实测证据（三组对照）

| 实验 | 场景                                    | 搜索期结论                                                                           | 复验（换种子 × 6 轮）   | 成本                    |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- | ----------------------- |
| A    | 夹具原样、tier0、24h、标准档 10/2/2     | 分数 **+0.00078**；dps +0.10%、利润 +0.056%、经验 +0.09%、击杀 −0.04%；配对 p = 0.18 | **negative，p = 0.022** | 87 评估 / 182 场 / 420s |
| B    | 游戏默认触发器、tier4、4h、快速档 6/1/1 | 分数 **+0.21**；利润 **+49.3%**、dps +11.4%                                          | inconclusive，p = 0.19  | 31 场 / 34s             |
| C    | 同 B，改标准档 10/2/2                   | 分数 **0**、四项 delta 全 0                                                          | p = 1.0（基线 = 最优）  | 44 评估 / 66s           |

实验 A 是最刺眼的一条：**搜索期说「有提升」，独立复验判它显著更差（p=0.022），而当时
报告仍把它标成「推荐」、应用按钮可点**——用户应用后看到的就是退步。

### 16.2 根因①：采纳判据在噪声面前等于零门槛

旧判据 = 「聚合分严格更大（eps=1e-9）**且**配对信号不是 negative」。而配对信号的
`verdict` 在 `rounds < 2` 时恒为 `unknown`、在 `rounds = 2`（dof=1）时 t 要 ≥ 12.7 才显著
→ 几乎恒为 `inconclusive`。「不是 negative」这道闸门**实际上永远为真**，采纳退化成
「在噪声里取最大值」（实验 A 的 +0.00078 分就是这么进来的）。

修法（`triggerOptimizerScoring.js`，搜索层唯一入口 `shouldAdoptCandidate`）：

1. **最小效应量** `TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE = 0.01`：聚合分必须比当前最优高出
   至少 1%（对数尺度 ≈ 0.7% 相对指标变化）；
2. **噪声地板** `hasAdoptionEvidence(paired)`：
   - `positive` → 支持；`negative` → 拒绝；
   - 其余 → 只有 `|mean| > 2 × stdError` 才算「比噪声大」；
   - **缺 `mean`/`stdError`（`rounds < 2`、参考无逐轮样本）→ 一律不支持**。

   本轮同时修掉一个静默漏洞：原先用 `Number(summary.stdError)` 取值，而 `rounds = 1` 的
   摘要是 `stdError: null` → `Number(null) === 0` → `|mean| > 2 × 0` 恒真，噪声地板被
   悄悄拆掉。现在先严格判 `typeof === 'number'`，缺标准误一律不支持。

被闸门挡下的候选（分数够高但证据不足）单独用 `isAdoptionBlockedByEvidence` 标记，
搜索层把 `evidenceBlocked` 随报告上抛，UI 用**另一套文案**说明（「样本不够没敢采纳」≠
「已经搜遍了」）。

### 16.3 根因②：复验只做事后打脸，不参与决策

复验本来就是为「提升是否成立」设计的，但旧实现只把它渲染成一行结论：判 `negative`
时页面出现红字「复验显示更差，不建议应用」，**应用按钮却仍可点**，store 也照样写入。
现在复验是硬闸门，三处同源（都调 `isTriggerOptimizerResultRejected`）：

- store `applyTriggerOptimizerResult()`：`verification.verdict === 'negative'` → 返回
  `false` + `runtime.error = 'common:triggerOptimizer.applyBlockedNegative'`（不建基线
  快照 → 撤销按钮不会出现）；
- 页面 `canApply`：直接禁用应用按钮，并在按钮下方写明为什么；
- 页面技能卡片：不再挂「推荐」徽章，改为「复验判负：本槽改动已被证伪，不予推荐」；
- 页面指标卡：口径切成**复验实测**（换种子 6 轮）并标注来源，否则同屏会出现
  「结论说更差、指标说 +0.1%」的自相矛盾。数据来源与来源标签共用同一个谓词
  （`useVerificationMetrics`），不会出现「标签说复验、数字来自搜索期」。

注意复验只在**判负**时否决：`inconclusive`（未达显著）不等于更差，仍可应用——否则
样本不足的结果全都不能应用，功能会退化成只读报告。

### 16.4 根因③：候选空间塌缩 + 死档

三处具体问题：

1. **快速档是死档**：fast 档 `rounds = 1` → 配对统计给不出标准误 → 采纳闸门恒拒绝
   → 该档只是「烧机器、却永远报未找到更优配置」。改为 `6/1/2`
   （`TRIGGER_OPTIMIZER_MIN_USABLE_ROUNDS = 2`）。实验 B 的「+49% 利润」正是
   `rounds = 1` 下的噪声，不是真的快。
2. **默认触发器大多是恒真条件**：`abilityDetailMap.json` 的 57 个技能里 **36 个**的
   `defaultCombatTriggers` 条件恒成立（23 个 `targeted_enemy/current_hp ≥ 1`、
   10 个 `all_enemies` 数量 ≥ 1 且血量 ≥ 1、3 个 `[]`）→ 默认已等价「CD 好了就放」
   = 释放频率上限，触发器能改的只是**时机**（每个攻击周期只放一个技能）。
3. **真正有杠杆的候选一条都不产**：用户手工配置里写的是
   `all_enemies/current_hp ≥ 500`（别把 AOE 丢给快死的一波怪），而旧生成器的斩杀线是
   `玩家 maxHp × 30%`——对 500 血的丛林小怪算出 439 ≈ **恒真**，对 4400 血的 BOSS
   又完全是另一个意思。现在新增**敌方血量尺度**（`resolveEnemyHpScale`：`Zone` +
   `Monster` 按同难度构造，读难度缩放后的 `maxHitpoints`）：

   | 区域                            | 难度  | min（小怪） | max（BOSS） | group（一波随机怪合计） |
   | ------------------------------- | ----- | ----------- | ----------- | ----------------------- |
   | `/actions/combat/jungle_planet` | tier0 | 500         | 4400        | 3200                    |
   | `/actions/combat/jungle_planet` | tier4 | 2500        | 10300       | 12400                   |

   候选随之变成：`敌方总生命 ≥ 25%/50% group`（AOE 防浪费）、`目标生命 ≥ 50% min`
   （单体防过量伤害）、`目标生命 ≤ 30% min`（斩杀线，不再是玩家血量口径）、
   `法力 ≥ 30% maxMp`（朴素的蓝量台阶，旧版只在组合候选里带）。

4. **等价候选白跑一场模拟**：与「游戏默认」行为完全等价的角色候选（例如 berserk 的
   `buffInactive` 就是它的默认触发器）现在在生成阶段按签名去重剔除；默认触发器为空
   列表时不启用去重（此时默认本就等价于「立即释放」，保留双锚点）。

### 16.5 候选价值顺序与截断行为（本轮的设计决定，务必知悉）

输出类候选的生成顺序 = **预期价值顺序**，因为 `candidateLimit` 按生成顺序截断：

```
① AOE 敌方总血量 → ② 敌人数 → ③ 单体目标血量（防浪费）→ ④ 斩杀线
→ ⑤ 蓝量台阶 → ⑥ 自身残血（价值最低）
```

标准档（10 候选/槽）下，输出技能的角色候选（9 单条件 + 3 组合 = 12，加 2 锚点 = 14）
会被截断到 10：**自身残血、蓝量台阶、斩杀线在标准档下通常进不来**，要全量网格请用
精细档（16）。这是刻意的取舍——把模拟预算花在实测有杠杆的时机控制上，而不是均匀撒开。

### 16.6 §14.8 补充推翻项

已并入 §14.8 表格（fast 档 rounds、采纳判据、复验的决策权、斩杀线口径四项）。旧文档
其余部分如有冲突，同样以 §14.8 + 本节为准。

### 16.7 自动化验证（本轮）

- `triggerOptimizerScoring.test.js`：新增 `hasAdoptionEvidence`（含 `stdError: null` 的
  回归断言）、最小效应量、`isAdoptionBlockedByEvidence`、`isTriggerOptimizerResultRejected`
  四组用例；
- `triggerOptimizerCandidates.test.js`：伤害候选改为**价值顺序**断言（含 1250/2500、
  500、300、150、500/750 的绝对值换算），新增「行为等价去重」用例（berserk 的
  `buffInactive` 被剔除、provoke 的保留）；
- `triggerOptimizerSearch.test.js`：`baselineMetrics` 复用契约两条（带等长 samples 才
  复用 / 不带则现场重评）；
- `triggerOptimizerSimulation.test.js`：新增 `resolveEnemyHpScale`（tier0/tier4 数值锁定、
  未知区域降级为 `null`）与 `resolveOptimizerResources`（`enemyHp` 随资源一起返回）；
- `triggerOptimizerDomain.test.js`：预设档位 `rounds ≥ MIN_USABLE_ROUNDS` 锁定；
- `triggerOptimizerStore.test.js`：复验判负拒绝应用（含 `inconclusive` 仍可应用）；
- `TriggerOptimizerPage.template.test.js`：复验判负四连断言（按钮禁用 + 理由、
  不挂推荐、指标来源改为复验实测）、`evidenceBlocked` 与 `noImprovement` 文案分离、
  默认指标来源标注。

### 16.8 仍未覆盖

- 迷宫模式仍拒绝优化（§14.11）；
- 标准档下输出技能的低价值候选会被截断（§16.5），需要在 UI 上引导用户用精细档；
- 敌方血量尺度目前只读随机刷新 + BOSS 刷新，未考虑「已受伤的怪」这类运行期状态
  （触发器读的是实时血量，阈值只能按满血尺度给）。

### 16.9 采纳闸门的跨参考系比较缺陷（2026-09-18 晚间实测复盘修正）

**背景（实测）**：从游戏默认触发器起步、丛林星球 tier0、精细档（16 候选 / 3 轮 / 4 小时）
跑真实全链三次，确认功能**能**产出经复验的改进（flame_blast → `all_enemies/current_hp ≥ 800`，
复验 6 轮 positive，利润 +1.69% p=0.0064、DPS +1.28% p=0.0093、XP +1.19%、击杀 +0.89%），
但同时暴露下面这个缺陷。

**缺陷**：搜索层每个候选的 `score` 是「以本槽开跑时的当前工作配置为参考」的**增量分**，
而 `best.score`（上一个被采纳候选的分数）是**它当时那个参考系**里的增量分。旧实现
（`shouldAdoptCandidate(winner, best)`）把两者直接相减并要求 ≥ `MIN_ADOPT_SCORE`：

```
score - best.score >= MIN_ADOPT_SCORE      // 跨参考系比较（错）
score >= MIN_ADOPT_SCORE                   // 同参考系门槛（现口径）
```

后果：**每采纳一个槽，其余所有槽的门槛就被抬高 `best.score + MIN_ADOPT_SCORE`**，越靠后的槽
（以及后续轮次）越难被采纳，系统性压制「多笔真实改进叠加」；而且被拦掉时
`improvedSlots.length === 0` 会把「被门槛拦掉」伪装成「已收敛」。

实测两处反例：

1. 默认基线跑：先采纳 flame_blast-800（+0.0189，p=0.125）；第 2 轮 firestorm-800 拿到
   **+0.02474（SE 0.00097、t≈25、p=0.00155，全轮统计证据最强）**，被 `0.0189 + 0.01 = 0.0289`
   拦掉 → 第 2 轮零采纳即判定收敛（`rounds=2`），最终只落地较弱的一笔。
2. 反向验证：把 flame_blast-800 预置为基线后再跑，**同一候选 +0.02474 立刻被采纳**
   （门槛回到 `0 + MIN_ADOPT_SCORE`），且该轮的复验 positive（p=0.00127）；
   同一次运行里 flame_blast-1600（+0.015）又被 `+0.02474 + 0.01` 拦掉 —— 同一 bug 再次触发。

**修正**：

1. `shouldAdoptCandidate(candidate, reference = null)` / `isAdoptionBlockedByEvidence(candidate,
reference = null)`：门槛改为**同参考系的固定量** ——
   - 槽级采纳**不传** `reference`（参照 = 当前工作配置，其增量分恒为 0）；
   - 精炼采纳传**同槽 winner**（精炼候选与该槽其它候选共享同一个 reference，属合法的同参考系比较）；
   - 传入非法参照分（NaN / 缺失）→ 一律不采纳（宁可不改，也不在错参考系上判）。
2. 报告总分口径修正：`improvement.score` 改为**按基线参考系现算的累计分**
   （`buildImprovement`：`scoreCandidate(best.metrics, weights, baselineMetrics)` + 同源
   `computePairedStats(best.metrics, baselineMetrics, weights)`），与同屏展示的
   `deltas = best − baseline` 同源。旧实现直接上抛 `best.score`（最后一笔增量），
   采纳多槽时 UI「最优得分」只显示最后那笔（实测：两次采纳 0.0189 + 0.0247 后仍显示 0.0247）。
   进度上报的 `bestScore` 用同一口径（`cumulativeScore`）。
   注意 `best` 的职责收敛为「报告里的最优配置指标」，**不再**充当任何门槛。

**回归保护**（两处，均已在旧算术下验证会失败）：

- `triggerOptimizerScoring.test.js`：同参考系回归组（槽级不传参照 → `+0.02474` 必须被采纳；
  显式参照仍参与门槛；非法参照不采纳）；
- `triggerOptimizerSearch.test.js`：`多槽叠加` 用例（两槽同增益的确定性响应器，
  顺序无关；旧实现在第二个槽失败）+ 自守断言（第二笔增量必须落在
  `largest + MIN_ADOPT_SCORE` 之内，否则用例不再复现缺陷）+ 累计分断言
  （`improvement.score` 必须等于按基线现算的分，且大于任何单笔增量）。

---

## 17. 第七轮：无提升复现与「证据不足」的实测定性（2026-09-19）

用户问题：「你评价一下，现在的技能优化的功能怎么样，我怎么感觉无法模拟出来提升」——
与 §16 标题同一句的复问。本轮是 **§16.9 修复后的复核**：不再论证"缺陷在哪"，
而是回答"现在到底能不能搜出提升、什么时候搜不出、搜不出时该怎么办"。

方法同 §16：dev server（端口 5181）+ 内嵌浏览器 + 真实角色夹具
`src/services/__tests__/fixtures/modernPlayerJunglePlanetFixture.json` 注入 store，
走真实 worker 全链；被测对象是页面上的设置，共四组对照，全部
`jungle_planet` / 难度 tier0 / 4 小时 / 权重 50-30-20。

### 17.1 四组实测（同一夹具、同一区域，变量=起点与采样档位）

| 实验 | 起点                                      | 档位（候选/轮/重复） | 成本                       | 搜索期                                                                     | 复验（6 轮换种子）                 | UI 结论卡                    |
| ---- | ----------------------------------------- | -------------------- | -------------------------- | -------------------------------------------------------------------------- | ---------------------------------- | ---------------------------- |
| A    | 游戏默认触发器（手工删掉两处 AOE≥500 门） | 精细 16/3/3          | 168 评估 / 510 场 / 141.5s | 采纳 3 槽（元素光环 `[]`、火焰风暴 ≥800、熔岩爆裂 ≥800），累计 **+0.0585** | **positive，p = 3.9e-5**           | 优化生效，推荐应用           |
| B    | 夹具原样（已手工调好 AOE≥500）            | 标准 10/2/2          | 44 评估 / 96 场 / 41.8s    | 零采纳（best +0.0247 被噪声地板拦）                                        | inconclusive（p = 1.0，基线=最优） | **有候选更高分，但证据不足** |
| C    | 同 B                                      | 精细 16/3/3          | 58 评估 / 180 场 / 59.6s   | 零采纳（best +0.0212 仍被噪声地板拦）                                      | inconclusive（p = 1.0）            | 同 B                         |
| D    | 同 B                                      | 精细 + 重复次数 5    | 113 评估 / 567 场 / 192.7s | 采纳 1 槽（熔岩爆裂 ≥800，**+0.0226**）                                    | **positive，p = 0.0131**           | 优化生效，推荐应用           |

实验 A 的增量（相对基线）：利润 **+5.49%**（p = 2.9e-3）、DPS **+3.62%**（p = 7.5e-3）、
XP +3.32%（p = 0.012）、击杀 +3.16%（p = 0.014）、死亡 0 变化；实验 D：利润 +1.92%、
DPS +1.49%、XP +1.43%、击杀 +1.55%。两次运行的控制台均无 error/warning。

### 17.2 结论：功能"能搜出提升"，但三条边界必须让用户知道

1. **能搜出、且能复验**：A/D 两组都是「搜索期采纳 → 独立复验 positive」的完整闭环，
   数字与 §16.9 那次实测一致到小数点后三位（种子确定性成立）。"功能坏了 / 永远搜不出"
   不成立。
2. **已手工调优的角色 + 默认档（标准 10/2/2）→ 必然报「证据不足」**：B 组就是用户
   观感的来源。这是 §16.2/§16.3 采纳闸门的**设计内**行为——不一致的逐轮证据不够强时
   宁可不改。它**不等于**"没有提升"，而是"这点提升在当前采样下无法与噪声区分"。
3. **提高重复次数是有效解锁路径（本轮验证）**：C 组 3 轮被拦的同一候选，在 D 组
   `rounds = 5` 下通过噪声地板（mean 0.0226 > 2×SE 0.0166）并被复验确认。
   代价：567 场、192.7s（4 小时时长）；若换成 24 小时，墙钟按 ~6 倍计（十几分钟量级）。

### 17.3 结构性天花板（数据来源，非推测）

- **单怪图没有 AOE 杠杆**：`actionDetailMap.json` 的 `fly`（默认区域）
  `randomSpawnInfo.maxSpawnCount = 1`，多怪条件恒假；`jungle_planet` 为 4
  （小怪 500 / BOSS 4400 / 一波合计 3200，与 §16.4 的 `resolveEnemyHpScale` 一致）。
  叠加「57 技能里 36 个默认条件恒真、每个攻击周期只放一个技能」（§16.4），
  触发器在单怪图上只能改时机微调 → 提升不可测量的概率大幅上升。
- **预估值与时长无关**：页面「预计模拟场次」= f(候选上限, 轮数上限, 重复次数)
  （标准/24h = 214、精细 = 735、精细+rounds5 = 1217），墙钟成本才随时长线性增长。

### 17.4 本轮观察到的 UI 打磨点（非缺陷）

- 「推荐」徽章在「本槽最优 = 当前配置/默认触发器（得分 0）」时仍然显示（实验 B/C 的
  元素增幅、元素光环卡片），读起来像"推荐一个 0 分改动"。建议对 `score ≤ 0` 的
  `chosen` 改用「保持现状」文案（判据可直接用 `Number(choice.chosen?.score) > 0`）。
- 证据不足的引导文案（§16.7 落地）已被本轮实测验证指向正确方向（B → D 通过
  「提高重复次数」解锁），无需改动；但可考虑在文案里补一句成本提示（24h 时长下
  提高重复次数会成倍拉长墙钟）。

---

## 18. 第八轮：四项落地（2026-09-19）

用户决策（沿用 §17 的路线图）：**「深挖加密采样 + UI 文案 + 按时长自动配重复次数」与
「跨技能增益门候选」都做**。本轮把这两件事都落地，并在真实全链上复核，顺手修掉实测
暴露的一个新缺陷（`adoptedSlots` 快照取早了）。

### 18.1 深挖（加密复核被噪声地板拦下的候选）

**问题**：搜索期某个槽的最优候选「分数 ≥ 最小效应量、但配对证据没过噪声地板」时，
旧实现只有一个结局——报告写「有候选更高分，但证据不足」，用户既不知道该不该信，
也不知道「提高重复次数」到底有没有用（§17.2 的 B/C 组就是这种局面）。

**设计**（`triggerOptimizerScoring` 的判据不变，改的是「再给一次机会」）：

| 项目     | 口径                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发条件 | 槽级最优候选被 `isAdoptionBlockedByEvidence` 拦下，且 `settings.rounds < TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS`（= 6；用户手填更大轮数时样本本就够，直接跳过） |
| 样本口径 | 用**同一盐的搜索种子集**扩到 6 轮（`deriveSeedSet` 是稳定前缀 → 纯粹样本扩充，不是换随机流重抽）                                                            |
| 成本     | 2 次评估（参考 + 候选）× 6 场 = **12 场**，每槽每次运行最多一次，计入进度分母与报告                                                                         |
| 判据     | 与槽级采纳**同源**（`shouldAdoptCandidate`：最小效应量 + 噪声地板）；通过则采纳原 winner（报告里 3 轮口径不变，配对链不断）                                 |
| 报告     | `result.deepDives[]` = `{ slotIndex, abilityHrid, role, rounds, score, mean, stdError, pValue, verdict, adopted }`                                          |
| 已知边界 | 这是**可选停时**设计（只对打到门槛附近的候选加密一次，p 值偏乐观）。兜底两层：每槽一次 + 轮数固定；最终仍由独立复验（另一组种子 × 6 轮）**硬否决**          |

本轮实测（4h / 16 候选 / 3 轮 / 夹具原样）：熔岩爆裂被拦的候选在 6 轮下 mean 0.0218、
SE 0.0068（2×SE = 0.0136 < 0.0218）→ 采纳，复验 positive p = 0.0131，利润 +1.77%、
DPS +1.45%。深挖把「样本不够」从死路变成了**一次性结论**。

### 18.2 时长自适应采样轮数

**动机**：单场模拟成本随时长线性增长，而采样轮数决定「证据是否足以采纳」——
24h × 5 轮要十几分钟，4h × 2 轮又几乎必然报「证据不足」（§17 实测 D 组：3 轮被拦的
候选在 5 轮下通过并复验确认）。

**口径**：预设的 `rounds` 是**基础轮数（下限）**，实际值 = `max(基础轮数, 推荐轮数(时长))`：

| 时长        | 推荐轮数 | fast (6/1) | standard (10/2) | fine (16/3) |
| ----------- | -------- | ---------- | --------------- | ----------- |
| ≤ 4h        | 5        | **5**      | **5**           | **5**       |
| ≤ 8h        | 3        | **3**      | **3**           | 3           |
| 更长（24h） | 2        | 2          | 2               | 3           |

**默认时长（24h）下三档与历史值完全一致**（6/1/2、10/2/2、16/3/3）——只有短时长被加密，
「预估值与时长无关、墙钟随时长线性」这条不会失控。落地三处：domain 的
`resolveRecommendedTriggerOptimizerRounds` / `getTriggerOptimizerPresetSettings(presetId, hours)` /
`resolveTriggerOptimizerPresetId`（按设置自己的时长判定）；store 的
`setTriggerOptimizerSettings` 在「仅改时长」且三元组命中预设时同步写回轮数（显式改三元组的
自定义配置绝不被静默覆盖）；页面 `applyPreset` 传当前时长。

### 18.3 跨技能增益门候选

**缺口**：旧生成器只用**本技能自己**的 buff 条件（`resolveOwnBuffConditions`），
「AOE/爆发只在某个增益覆盖期间释放」这类跨技能组合一条都不产——而引擎完全支持：
`trigger.js` 88-140 读的是 `source.combatBuffs` 里对应 condition 名字的键，**不区分谁挂的**；
`allAllies` 类光环的增益会施加到含施法者自己在内的 `players`（combatSimulator.js 1882-1902）。

**口径**（`resolveOtherBuffConditions`）：只从**其他已佩戴技能**的 buff 条件里取
（保证该增益在当前配置中真的存在，不产出恒定假的候选——§13 的暴走教训）；
优先 aura/buff 角色、同类按槽位序；**上限 3 条**避免候选空间爆炸。

**插入位置 = 价值顺序第 ③**（AOE 敌方总血量 → 敌人数 → **跨技能增益门** → 单体防浪费 →
斩杀线 → 蓝量 → 自身残血），并新增一条组合候选「增益门 × AOE 窗口」
（`compositeBuffWindowGroupHp`，需要 enemyHp 尺度，缺了整条跳过）。

### 18.4 UI 口径修正（本轮的第三条线）

1. **「推荐」徽章三条件**：`chosen && !resultRejected && score > 0 && 该槽真被采纳过`。
   前两条是 §16.7/§17.4 的落地；第三条来自本轮实测——`chosen` 会保留「槽内最优」即使它
   没被采纳，只看它会出现「卡片挂着推荐 + 同屏写着证据不足、已优化 0 / N」的自相矛盾。
2. **新报告字段 `adoptedSlots`**：真正被采纳过的槽位（槽级采纳与精炼采纳都记账）。
   ⚠️ 快照必须在 `finally` 里取：`result` 对象在搜索**开始前**创建，只在字面量里
   `[...adoptedSlots]` 会永远留着空数组（本轮实测踩到：深挖采纳了熔岩爆裂，报告却给
   `adoptedSlots: []`，UI 给已采纳的槽显示「保持当前配置」）。
3. **候选表新增「配对差 mean ± SE」**：采纳闸门的判据（|mean| > 2×SE）不再只是一个
   「不显著」徽章，用户能看到「差多少、噪声多大」。
4. **证据不足文案补成本提示**（墙钟 ≈ 时长 × 重复次数；24h 下建议先把时长改小）。
5. 深挖结果上屏：结论卡一行汇总（`deepDiveNote`）+ 被采纳/仍不足的槽位标签
   （`deepDiveAdopted` / `deepDiveBlocked`）。

### 18.5 浏览器全链复核（dev 5181 + 内嵌浏览器 + 真实 worker）

夹具原样（已手工调好 AOE≥500）/ 丛林星球 tier0 / 4h：

| 运行 | 档位                 | 结果                                                                                                                           |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R1   | 16/3/**2**（自定义） | 深挖触发 1 次（熔岩爆裂 6 轮 mean 0.0117、2×SE 0.0144 → **仍不足**），零采纳、`evidenceBlocked`；UI 显示复核结论与「仍不足」   |
| R2   | 16/3/3               | 深挖触发 1 次且**通过**（mean 0.0218、SE 0.0068 → adopted），复验 positive p = 0.0131；UI：推荐徽章 + 「深挖复核通过（6 轮）」 |

R1/R2 的候选表都出现了 `buffWindow` 与 `compositeBuffWindowGroupHp`（跨技能增益门已生成）；
控制台无 error/warning。R2 同时验证了 18.4 的缺陷修复（`adoptedSlots = [3]`）。

### 18.6 自动化验证（本轮）

- `triggerOptimizerSearch.test.js`：+3 条深挖用例（扩轮后采纳并记录、扩轮后仍不足、
  搜索轮数 ≥ 深挖轮数时跳过），并给「多槽叠加」补 `adoptedSlots` 断言；
- `triggerOptimizerCandidates.test.js`：+5 条跨技能增益门用例（条件只来自其他技能、
  无其他增益时不产、上限 3 条与排序、组合候选需要 enemyHp、自己的 buff 不混入），
  并把伤害候选的价值顺序断言更新为含 `buffWindow`；
- `triggerOptimizerDomain.test.js`：+2 条时长自适应用例（三档在 24h 与历史值一致、
  4h/8h 加密、基础轮数只升不降、非法时长回落；预设判定按设置自己的时长）；
- `triggerOptimizerStore.test.js`：+2 条（改时长时预设档位重算轮数、自定义三元组不被覆盖）；
- `TriggerOptimizerPage.template.test.js`：+4 条（深挖汇总与槽位标签、0 分不挂推荐 +
  深挖仍不足标签、未被采纳的槽不挂推荐、配对差 ± SE 上屏）；
- 全量 `npm test`：**177 文件 / 2460 用例全绿**，Prettier 全仓通过；`npm run build` 成功。

### 18.7 仍未覆盖

- 深挖只覆盖「槽级最优候选」，精炼候选被拦时不做（精炼通道的候选集更小、价值更低）；
- 可选停时的 p 值偏乐观这一点没有在 UI 上明说（只在文案里写「同一组随机种子扩样」）；
- 跨技能增益门目前只对**输出角色**生成（光环/减益/治疗角色的增益窗口语义不同，未评估）；
- 单怪图仍无 AOE 杠杆（§17.3 的结构性结论不变）。

### 18.8 收尾：patchNote 迁移与「预计模拟场次」复核（2026-09-19）

- patchNote：v2.5.4 已于 9-17 推送发布（Pages 自动部署），向其条目追加内容不会触发未读提醒 ⇒
  未发布文案整体迁入新条目「2026年9月19日（v2.5.5）」；`package.json` / `package-lock.json`
  同步升到 2.5.5，v2.5.4 条目恢复为已发布原样。
- 「预计模拟场次」刷新复核：实测为纯渲染时机（同一 tick 读旧值、下一 tick 即新值），无防抖；
  档位/时长/重复次数改动即时刷新（4h↔24h：轮数 5↔3、场次 1217↔735），无需改动。

---

## 19. 第九轮：三组全链实测与一处计数口径修正（2026-09-19）

用户问题（与 §16/§17 同一句的第三次复问）：「你评价一下，现在的技能优化的功能怎么样，
我怎么感觉无法模拟出来提升」。

方法同前：dev server（5181）+ 内嵌浏览器 + 真实角色夹具
`src/services/__tests__/fixtures/modernPlayerJunglePlanetFixture.json`（法系 120 级 / 5 技能，
triggerMap 里 firestorm / flame_blast 已是手工调好的 `all_enemies/current_hp ≥ 500`），
走真实 worker 全链。**本轮新增覆盖：出厂默认设置（24h + 标准档）与单怪图（fly）**——§16/§17
只跑过 4h / 精细档 / 多怪图。

### 19.1 三组实测

| 实验 | 场景                                 | 档位（候选/轮/重复）      | 成本                      | 搜索期                                                                        | 复验（换种子 ×6）                                    | 采纳的改动                                      |
| ---- | ------------------------------------ | ------------------------- | ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| A    | 丛林星球 tier0 / 4h                  | 标准 10/2/**5**（自适应） | 85 评估 / 427 场 / 178.0s | +0.02258；mean 0.02257、SE 0.00830、t 2.72、dof 4 → inconclusive（p 0.053）   | **positive，p = 0.0131**（mean 0.01624、SE 0.00431） | 熔岩爆裂 `all_enemies/current_hp ≥ 800`         |
| B    | 丛林星球 tier0 / **24h**（出厂默认） | 标准 10/2/**2**           | 85 评估 / 178 场 / 262.8s | +0.01767；mean 0.01767、SE 0.00014、t 127.8、dof 1 → **positive**（p 0.0050） | **positive，p = 0.0389**（mean 0.01364、SE 0.00491） | 同一笔（熔岩爆裂 ≥800）                         |
| C    | **苍蝇 fly** tier0 / 4h              | 标准 10/2/5               | 85 评估 / 427 场 / 151.7s | +0.08117；mean 0.08117、SE 0.00106、t 76.4、dof 4 → positive（p 1.8e-7）      | **positive，p = 4.3e-9**（mean 0.08169、SE 0.00096） | 元素光环 `[未生效] AND [所有队友 最低HP% ≤ 40]` |

- 三组的 `deepDives` 均为空（搜索期就过闸，深挖未触发）；三组控制台均无 error/warning。
- A 的 delta：DPS +1.49%、利润 +1.91%、XP +1.43%、击杀 +1.55%；
  B：DPS +1.11%、利润 +1.58%、XP +1.05%、击杀 +1.03%；
  C：DPS −0.37%、XP −0.36%、击杀 −0.37%，**利润 +12.23%**（基线 −5.4m/天 → 最优 −4.7m/天）。
- 应用链路同轮复核：应用 → `triggerMap` 写入、出现「撤销应用」；撤销 → 恢复原触发器 +
  提示「已撤销应用，恢复为应用前的触发器」，`baselineSnapshot` 清空。

### 19.2 结论

1. **出厂默认路径能出可应用的结论**：B 组是 `rounds = 2`（dof = 1）的恶劣采样，但 24h 单场
   模拟把逐轮波动压得很低（SE 0.00014）→ t = 127.8 直接 positive，**深挖根本没触发**。
   「什么都不改、点开始搜索」这一路径是可用的。
2. **短时长由时长自适应（§18.2）补齐**：A 组 4h 自动升到 5 轮，搜索期 verdict 仍是
   inconclusive（p = 0.053），靠 §16.2 的噪声地板（|mean| > 2×SE）过闸，复验 p = 0.0131
   与 §18.5 R2 的复验 p 值一致到小数点后四位（同一最优配置 + 同一组复验种子 ⇒ 可复现）。
3. **单怪图没有 AOE 杠杆，但不等于搜不出提升**：§17.3 的结构性结论再次确认
   （`actionDetailMap.json` 17216-17267：fly 单 spawn、无 boss、`maxSpawnCount = 1`），
   但 C 组证明单怪图仍存在**非 AOE** 杠杆——神秘光环（100 蓝 / 120s CD，只给水/自然/火增幅）
   在这张图上收益远小于蓝耗，「未生效就补」→「未生效**且**队友残血 ≤40%」（≈ 基本不补）
   换到利润 +12.2%（p = 4.3e-9）。即「搜不出提升」的实质是**候选空间里没有与目标同向的杠杆**，
   不是「图太简单所以必然为空」。
4. 成本量级：出厂默认（24h / 标准）≈ 178 场 / 4.4 min；4h / 标准（自适应 5 轮）≈ 427 场 /
   2.5-3 min —— 都低于 §17 的「精细档 + rounds 5」（567 场 / 3.2 min）。

### 19.3 本轮修正：「已优化技能」计数与采纳口径对齐

实测（C 组）暴露：结论卡写「已优化技能 **3 / 5**」，而 `results.bestTriggerMap` 与当前配置
**只差 1 个键**（元素光环），同屏还有两张卡片写着「保持当前配置」。

根因：`TriggerOptimizerPage.vue` 的 `changedAbilities` 数的是「`chosen.score > 0` 的槽」，
而槽内最优候选的 score 可能落在 `(0, MIN_ADOPT_SCORE)`——C 组的元素增幅 +0.0065、
火球 +0.0036 都属于「略好但不够格」（`shouldAdoptCandidate` 要求 ≥ 0.01 且过噪声地板），
**没有被采纳**，自然也没写进 `bestTriggerMap`。

修正：计数与「推荐」徽章（`isSlotAdopted`）、应用写回同源 —— 数 `results.adoptedSlots`
（真正被采纳过的槽位）。回归测试 `TriggerOptimizerPage.template.test.js` 新增
`counts only adopted slots as optimized, not sub-threshold slot winners`
（`chosen.score > 0` 且 `adoptedSlots = []` → 必须 `0 / 1`），已在旧口径下验证会失败（得到 `1 / 1`）。

### 19.4 未落地的建议（留给用户决定）

- **指标卡口径只在复验判负时切到「复验实测」**（`useVerificationMetrics = resultRejected &&
verification.baselineMetrics`）：复验 **positive** 时卡片仍标「搜索期估算」，用户看不到
  「复验口径下实际涨了多少」，只有一个 p 值。数据是齐的（`verification.baselineMetrics` /
  `bestMetrics` / `paired` 都已上抛，见 `triggerOptimizerSearch.js` 656-663），可考虑 positive
  时也提供一句复验口径 delta 或口径切换。
- 「推荐」徽章与配对信号「不显著」同屏（A 组熔岩爆裂：得分 0.0226 / 不显著；C 组元素光环：
  0.0812 / 显著提升）：语义正确（过闸但 p > 0.05），但建议徽章补充一句「已过噪声地板，
  独立复验 p = …」的解释。

### 19.5 补测 D：熊熊星球（bear_with_it）tier0 / 4h / 标准（自适应 5 轮）

用户追加要求：「把模拟地图换成熊熊星球T0试试」。区域结构（`actionDetailMap.json` 15825-15900）：
`maxSpawnCount = 3`、5 种熊（强度 50/70/70/85/100）+ 红熊猫 boss ⇒ **多怪图、有 AOE 杠杆**，
与 §17.3 的单怪图（fly）构成对照。同一夹具、同一档位（标准 10/2 → 自适应 5 轮）。

| 项目                 | 结果                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 成本                 | 89 评估 / 451 场 / 221.4s                                                                                                                                                                     |
| 采纳                 | 熔岩爆裂 `all_enemies/current_hp ≥ 1750`（`adoptedSlots = [3]`；`bestTriggerMap` 与当前配置只差这 1 个键）                                                                                    |
| 搜索期               | 增量分 +0.0777；mean 0.0730、SE 0.0382、t 1.91、dof 4 → inconclusive（p 0.128），未过噪声地板（2×SE = 0.0764 > mean）→ **触发深挖**                                                           |
| 深挖（首个实测触发） | 2 个槽被拦：火焰风暴 `敌方总生命 ≥ 1750`（6 轮 mean 0.0580、SE 0.0321 → 门槛 0.0642 > 0.0580，**仍不足**）；熔岩爆裂同一候选（6 轮 mean 0.0785、SE 0.0316 → 0.0785 > 0.0632，**通过并采纳**） |
| 复验                 | mean 0.0929、SE 0.0345、t 2.69、dof 5 → **positive，p = 0.0433**                                                                                                                              |
| 指标 delta           | DPS +2.73%、利润 +3.81%、XP +2.58%、击杀 +2.66%、**死亡 1.75 → 1.40/h（−20%）**                                                                                                               |
| UI                   | 结论卡「优化生效，推荐应用」+「已优化技能 **1 / 5**」+ 深挖汇总行「…（2 个 × 6 轮…）：1 个通过并采纳、1 个证据仍不足」，火焰风暴卡片挂「· 深挖复核仍不足（6 轮）」                            |

要点：

- **噪声随图变重**：同一夹具的搜索期 SE 在 fly ≈ 0.0011、丛林 4h ≈ 0.0083、熊熊 4h ≈ 0.0382
  （怪多 ⇒ 事件密度高）。熊熊图必须靠深挖兜底，而火焰风暴那条是**差一点**被拦
  （0.0580 对 0.0642 的门槛）；要更稳可提高重复次数或用精细档。
- 阈值由敌方血量尺度自动换算，跨图不照搬：同一份手工配置（`敌方总 HP ≥ 500`）在丛林
  tier0 提到 800（一波怪 3200 的 25%）就够，在熊熊 tier0 要提到 **1750**（一波怪 ≈7000 的
  25%；`enemyGroupHpPercent = [25, 50]` ⇒ 候选 1750/3500）。两图的 `默认触发器` 候选都是
  显著更差（丛林 −0.022 / 熊熊 −0.076）——手工那版门槛本身是有价值的。
- §19.3 的计数修正在本轮**实测上屏为 1 / 5**（旧口径会报 2 / 5：火焰风暴槽内最优 +0.0427 > 0
  但未被采纳），与 `bestTriggerMap` 的实际改动数一致。
- 火焰风暴与熔岩爆裂**同为 AOE、候选相同**，但一个过闸一个被拦——说明「同一改动在不同槽的
  证据强度不同」，这正是逐槽配对比较该有的粒度。

### 19.6 收尾：四项口径落定（2026-09-19，未提交）

按 §19.4 与复盘建议落地四处，全部带回归测试：

| #   | 改动                       | 位置                                                                                   | 旧行为 → 新行为                                                                                                                                                                                                |
| --- | -------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | 死亡权重提示文案与实现对齐 | `locales/{zh,en}/common.json` 的 `triggerOptimizer.weightsHint`                        | 「死亡只惩罚增加、不奖励减少」→「死亡增加会被惩罚，死亡减少同样会被奖励（对称）」。实现自 §15.3 起就是**对称奖励**，文案属于过期描述（熊熊图实测死亡 1.75→1.40 确实计分）                                      |
| A2  | 指标卡口径与 p 值同源      | `TriggerOptimizerPage.vue` 的 `useVerificationMetrics`                                 | 只在复验**判负**时切「复验实测」→ **复验带回了指标就一律用复验实测**（成立/未达显著时也切）：结论卡那个 p 值就是这 6 轮算的，数字与 p 值必须同批；复验缺失（取消/失败）回落搜索期估算                          |
| A3  | 「推荐」徽章补证据解释     | 同文件模板 + `adoptionEvidenceHint` + `noiseFloorPassed`/`adoptionEvidenceHint` 两个键 | 搜索期 verdict 不是 positive 时，徽章旁补一枚「已过噪声地板」标签，`title` 给出配对差 mean ± SE、门槛 2×SE 与独立复验 p（BO 组=0.0226/0.0083 → 门槛 0.0166 的形态）                                            |
| A4  | 撤销门禁收窄               | store `revertTriggerOptimizerChanges` + 页面 `canRevert`                               | 整份输入指纹的 stale 一刀切 → **只拦「被优化技能的 triggerMap 条目被手改」**（基准 = 应用时存的 `appliedTriggers`，两侧过 `sanitizeTriggerMap` 归一化）；页面不再因 stale 隐藏撤销按钮（应用按钮仍按过期禁用） |

**回归测试**：

- `triggerOptimizerStore.test.js`：+1 改 1 ——「手改被优化技能的触发器 → 撤销拒绝
  （`revertBlockedEdited`，快照保留）」；「等级变化 → 应用仍被拒、撤销仍可用」；
- `TriggerOptimizerPage.template.test.js`：+2 改 1 —— 撤销按钮在 stale 下仍可用（应用仍禁用）；
  「已过噪声地板」标签及其 title 四要素；指标口径默认断言改为「复验实测」+「复验缺失 → 搜索期估算」。
- **变异验证**：把撤销守卫换回 `triggerOptimizerReportStale` →「撤销仍可用」用例红；把
  `hasOptimizedTriggersBeenEdited` 恒返回 false → 「手改拦截」用例红（`expected true to be false`）。
- 全量 `npm test`：**177 文件 / 2464 用例**（+3）+ Prettier 全绿；`npm run build` 成功。

**实现过程中踩到并修掉的坑（记录以免复发）**：应用时被删除的技能键在 `appliedTriggers` 里记成
`null`，与「键不存在」不等价 —— 首版实现让「删键型改动」把自己判成「被手改」，撤销永远被拒
（store 测试立刻抓到）。归一口径收在 `pickSanitizedTriggers` 里。

**A3 的实测补丁（同日）**：浏览器复核（熊熊图，§19.5 D 组场景）当场抓到一处自相矛盾 ——
该轮的熔岩爆裂是**深挖采纳**的（搜索期 mean 0.0732 < 2×SE 0.0764，深挖 6 轮 0.0785 >
0.0632），标签却写着「已过噪声地板」。修正：`deepDiveForSlot(slot).adopted === true` 的槽
**不挂**这枚标签（旁边已有「深挖复核通过（6 轮）」，它才是真正的依据）；只有搜索期直接过闸
的采纳才挂。回归测试写进同一条用例（`deepDives = [{ adopted: true }]` → 标签不存在、深挖标签
存在）。复核同时确认 A2 生效：指标卡数字与标签都为**复验实测**（DPS +4.1%、日利润 +5.8%、
死亡 2 → 1.63 / −18.8%，与 p = 0.043 同批）。

### 19.7 本轮未落地（B/C 类，备查）

- B1 寻优轮数上限（`maxRounds`）不随时长自适应：标准档固定 2，交互强的图（熊熊）可能没搜够；
- B2 阈值精炼只有 ±10 邻域、且只在采纳后触发（网格 25 个百分点 → 10，未到 ~5）；
- B3 深挖的「可选停时」偏差：只对打到门槛附近的候选加密一次，p 偏乐观；
- B4 复验 `inconclusive`（样本不足）缺中间态文案（只有「提升成立 / 显示更差」两档）；
- B5 `candidateLimit` 截断按生成顺序：标准档 10 会挤掉斩杀线/蓝量/自身残血类候选；
- C 类：跨槽交互（坐标下降天花板）、迷宫模式硬拒绝、队友维度未纳入模拟。

### 19.8 B1 落地：「轮数上限截断」仪表盘（2026-09-19，未提交）

§19.7 的 B1 是「寻优轮数上限（`maxRounds`）不随时长自适应：标准档固定 2，交互强的图可能没搜够」。
本轮先实测、再定方案：

**实测（真实引擎，dev 5181 + 夹具）**：

- 熊熊星球 `bear_with_it` tier0 / 4h / `(candidateLimit, maxRounds, rounds) = (10, 3, 5)` 跑完：
  `rounds = 2`、`adoptedSlots = [3]`、`+0.0778`、复验 positive、89 次评估、墙钟 ≈ 282 s。
  第 1 轮采纳、第 2 轮零采纳 → **因固定点收敛而停，第 3 轮从未执行** —— 3 轮上限不约束该图。
- 丛林星球 `jungle_planet` tier0 / 4h / `(10, 3, 5)`（预计 767 场）：跑到第 2/3 轮、76 次评估、
  约 315 s 时被 dev server 热重载打断（未取到终值）—— 不补测：B1 的决策证据已由熊熊一条给出
  （上限未约束搜索；真正约束墙钟的是「时长 × 重复次数」，与 §19.6 的提醒一致）。

**决策：不提高默认 `maxRounds`，把「被上限截断」变成报告里的仪表盘。** 理由：

- 标准档 2 轮 / 精细档 3 轮已覆盖实测的图（≤2 轮收敛）；盲目上调只会给每张图再付
  「候选数 × 重复次数」场模拟，而空轮收敛的图多给一轮也不会改变结论。
- 真正的问题是**信息缺失**：搜索因「一整轮零采纳」而停 = 固定点收敛；因上限而停 = 可能没搜完。
  旧报告看不出这两种停法，用户只能猜「是不是没搜够」。仪表盘把两者分开，并有据可依地给下一步。

**实现（全部带回归测试）**：

- 搜索层 `triggerOptimizerSearch.js`：轮次循环收尾处判 `round === settings.maxRounds &&
improvedSlots.length > 0` → `roundLimitReached = true`（含义：跑满上限且最后一轮仍有采纳
  ⇒ 固定点没到）；报告字段在 `finally` 统一回填 `result.roundLimitReached`，默认 false
  （`createEmptyResult` 骨架同形，UI 空态一致）。
  ⚠️ 变量必须声明在**函数体级**：`finally` 访问不到 `try` 内的 `let`（首版放进 try 内 → 14 个用例
  当场 `ReferenceError`；本文件 `cumulativeScore` 上方早有同款注释，属二次踩坑，已留防复发注释）。
- 报告字段 `roundLimitReached` 是唯一数据源（store/UI 都从 result 读，不另设运行期状态）。
- 页面 `TriggerOptimizerPage.vue`：结论卡（深挖说明之后）新增 `data-trigger-optimizer-round-limit`
  段落，显示条件 = `improvement.improved === true && results.roundLimitReached === true`
  （不声称提升时不叠加「还能再搜」的猜测）。
- 文案 `triggerOptimizer.roundLimitReached`（zh/en）：「搜索已跑满「搜索轮数上限」，且最后一轮仍在
  采纳候选——固定点还没到，可能还有改进空间。可提高「搜索轮数上限」或用「精细」档再跑一次。」

**回归测试**：

- `triggerOptimizerSearch.test.js`：+1 改 1 —— 新增「maxRounds=1 且有采纳 → `roundLimitReached=true`」；
  收敛用例补 `roundLimitReached=false`（`rounds === maxRounds` 但最后一轮零采纳 ⇒ 不许误报）。
- `TriggerOptimizerPage.template.test.js`：+1 —— 收敛静默 / 截断出提示且点名两个出路 /
  `improved=false` 时即使标记为 true 也不提示。
- `triggerOptimizerDomain.test.js`：骨架新增字段断言。
- **变异验证**：搜索层不置位 → 新搜索用例红（`expected false to be true`）；页面去掉 `improved`
  闸门 → 新页面用例第三段红（`expected true to be false`）。

**真实端到端（浏览器，熊图 tier0 / 4h / `maxRounds=1` / `rounds=5`）**：48 次评估 / 246 场 / 197.8 s，
`rounds=1`、`adoptedSlots=[3]`、`roundLimitReached=true`、分数 +0.0778（与 10/3/5 那次的 +0.07777
几乎一致——第 1 轮采纳与上限无关）、复验 positive（p=0.043）、页面「已优化技能 1 / 5」；结论卡
按预期渲染提示行（`data-trigger-optimizer-round-limit` 截图核对），且与同屏的深挖说明（2 条 × 6 轮）
共存无冲突。

**方法论备忘（本轮两次踩到）**：dev server（Vite）对**不在模块图里的文件写入**（实测 `docs/*.md`）
也会整页重载 —— 浏览器实测运行期间不要写任何项目文件，否则在途运行被清空（本轮丛林 10/3/5 与
第一次熊图 e2e 均因此中断；`npm test` / `prettier --check` 是只读检查，不触发重载）。

### 19.9 B2 落地：阈值精炼多级化（网格 25 → 10 → 5）（2026-09-19，未提交）

§19.7 的 B2：阈值精炼只有 ±10 一级邻域，粗网格（25 个百分点）只能收到 10；且「只在采纳后触发」
意味着偏离稍远的内部最优根本走不到。本轮把精炼改成**多级迭代行走**（成本纪律不变）：

**设计**：

- 步长序列：level 0 = ±10 个百分点（网格 25 → 10），level ≥ 1 = ±5（下限）。「~5」是目标粒度——
  再细的阈值差异已低于逐轮抽样噪声，成本却不会少（每次评估 = `rounds` 场模拟）。计数类候选维持
  ±1（整数粒度已是最细），不随层级变化。
- 行走规则：每级只在「上一级精炼候选被**严格采纳**」后才继续（`shouldAdoptCandidate(refineWinner,
refineBase)`，同一参考系）；签名去重让「已走过的点」自动跳过 → 走到邻居都已评估过即自然终止。
- 安全上限 `TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS = 4`：网格间隔 25pp ⇒ 内部最优最多偏离
  「最佳格点」±12.5pp；10 + 3×5 = 25pp 的可行走距离足够覆盖（整个网格跨度），同时把每槽每次
  采纳的精炼成本封顶在 8 次评估（典型 1–2 级）。
- 进度分母同步：`estimatedRefinements` 由「每槽每轮 2 次」改为 4 次（典型 2 级 × 2）；走得更远
  只会让进度条提前到 1（钳制），评估/场次计数器仍是精确值。页面「预计模拟场次」式未动（该式
  本来就不含精炼/深挖，属既有简化）。

**实现**：`triggerOptimizerCandidates.js` 新增 `refinementPercentStep(level)`（10 → 5 下限）、
`buildRefinementCandidates` / `buildRefinedCandidates` 增加 `options.level` 透传；
`triggerOptimizerSearch.js` 精炼块改为 `for (level < MAX_LEVELS)` 循环（每级：物化 → 并行评估 →
记录 → 采纳则 `refineBase = refineWinner` 继续；未采纳/无可精炼则 break），「精炼候选回写候选表」
移入循环内逐级落盘。

**回归测试**（`npm test` 177 文件 / 2468 用例 + prettier 全绿；build 成功）：

- `triggerOptimizerCandidates.test.js`：+1 —— 步长随层级减半（level 0/1/2、原始百分比类、
  计数类不变、95% 边界只出单侧、物化路径透传 level）。
- `triggerOptimizerSearch.test.js`：改 1 增 1 —— 既有精炼用例改为「沿单调响应器走到级数上限
  （3→4→5→6→7，评估 1+4+4+8+2 = 19）」；新增「内部最优在网格外（count=5，网格只有 2/3）：
  行走 4→5、评估 6 回落即停（评估 1+4+3+7+2 = 17），被拒绝的 6 也留在候选表里（探边透明）」。
- **变异验证**：级数上限压到 1 → 两个搜索用例红（评估数 13 ≠ 19/17）；步长忽略层级 → 候选层
  用例红（`[40, 60] ≠ [45, 55]`）。

**真实引擎回归（浏览器，熊图 tier0 / 4h / 标准档 10/2/5）**：89 次评估 / 451 场 / 308.8 s，
`rounds = 2`、`adoptedSlots = [3]`、`+0.0779`、复验 positive（p = 0.0430）、
`roundLimitReached = false`（第 2 轮零采纳 = 固定点收敛，B1 仪表盘正确静默）。**该夹具上没有
任何精炼候选被采纳**（槽 2/3 的胜出者是 `enemyGroupHp` 阈值——按设计口径不参与精炼；
`refinedCount = 0`），所以 B2 的行走没有真实引擎现场可复现，机制由上述 mock 测试覆盖。触发
条件（供后续实测参考）：某个**数值类**候选（self hp/mp、ally lowest_hp、敌人数）在真实引擎里
胜出并被采纳时，行走才会出现。

**选型说明（§19.7 其余项）**：B5（`candidateLimit` 截断丢「斩杀线/蓝量/自身残血」）经代码与测试
核对属**有意的价值顺序**（`damageCandidates` 注释与 `triggerOptimizerCandidates.test.js` 都写明
「AOE 敌方总血量 > 敌人数 > 单体防浪费 > 斩杀线 > 蓝量 > 自身残血」），不按缺陷处理；B4（复验
`inconclusive` 文案）为措辞类小项，留待后续按需处理。

### 19.10 跨槽交互诊断：交互存在但温和且次可加（2026-09-19，只读实验）

问题（§19.7 C 类「坐标下降天花板」）：坐标下降一次只改一个槽，**必须两槽同改才见效**的组合会被
漏掉。本轮用真实引擎直接量化：熊图 tier0 / 4h，把两个 AOE 槽（火风暴 slot2 / 焰爆 slot3）的
`all_enemies ≥ X` 阈值做 2×2 组合（其余配置不动），四组配置**共享同一组 10 轮种子**逐一评估
（10 轮是为排除「只是功效不够」的干扰；搜索默认 5 轮）。

| 配置（vs 现状）     | 聚合分（基线参考系） | 配对 mean ± SE  | p      | 判定         |
| ------------------- | -------------------- | --------------- | ------ | ------------ |
| A：火风暴 → 1750    | +0.0859              | 0.0731 ± 0.0408 | 0.107  | inconclusive |
| B：焰爆 → 1750      | +0.0966              | 0.0873 ± 0.0281 | 0.0127 | positive     |
| AB：两个都 → 1750   | +0.1441              | 0.1287 ± 0.0409 | 0.0118 | positive     |
| AB vs A（顺序增量） | +0.0582              | 0.0571 ± 0.0204 | 0.0208 | positive     |
| AB vs B（顺序增量） | +0.0475              | 0.0473 ± 0.0264 | 0.107  | inconclusive |

**结论**：

1. 交互真实存在但**温和且次可加**：近似交互项 `agg(AB) − agg(A) − agg(B) ≈ −0.038`（约为两笔
   单项之和的 −20%）——两槽共享同一个杠杆（AOE 阈值），边际收益递减，与「互相抢同一波怪」的
   直觉一致；**没有发现协同盲区**（单改任一个都可见正分 ⇒ 坐标下降在这张图上不是结构性瞎的）。
2. 搜索实际漏掉的是 AB：它停在 B（+0.097），丢掉 AB 的 +0.144。原因不是「只改一个槽」，而是
   **增量证据的统计功效**——R2 里「在 B 基础上再加 A」的增量 10 轮也只有 p = 0.107
   （与 §19.5 D 的深挖 not-adopted 结论一致）；而 AB 相对**现状**的联合提升是显著的
   （p = 0.0118）。
3. 成本取舍：全量两两组合 ≈ 10 对 × 100 组合 ≈ 11 倍成本（≈1 小时级），为 −0.038 量级的交互
   不值得；**便宜替代（待定）**：每槽对只探「各自 top-1 候选」的联合配置（5 槽 ≈ +10 次评估/轮
   ≈ +11% 成本），判据用「联合配置 vs 当前工作配置」的显著性（本实验里该口径能把两笔一起采纳）。
   是否落地留给用户决定。

### 19.11 C 类落地：跨槽联合探针（2026-09-19，未提交）

§19.10 把问题从「坐标下降是结构性瞎的」改写成「**增量证据的统计功效不够**」：AB 相对现状的联合
提升显著（p = 0.0118），但「已采纳 B 之后再补 A」的增量 10 轮也只有 p = 0.107。逐槽判据永远等不
到那一步——除非把一对配置的收益放进同一个分子。本轮按 §19.10 的「便宜替代」方案落地。

**位置**：每轮槽循环结束后、轮次收尾之前（一轮最多一批探测，不干扰单槽 coordinate descent 的
配对链；零采纳即固定点收敛，所以探测只发生在真正跑过的轮次里）。

**成员与配对规则**（`triggerOptimizerSearch.js`：`resolveJointMember` + 槽对双循环）：

- 成员资格：本轮已采纳的槽（收益计入联合，且按其**已落地形态**参与——精炼/深挖后的最终形态不
  丢；若改用本轮原始 top-1，会把已落地的更好配置换掉）或 未采纳且增量分 > 0 的槽（待救候选）。
  两者都不是的槽不构成有意义的一对——包括已采纳的槽在后续轮次里重新评估出的「分数≈0 的中性
  复核点」，既省成本，也避免把已落地的配置换回未证明的候选。
- 一对里至少有一个「未采纳」成员：两笔都已落地时联合配置就是当前工作配置，没有可新增的内容。
- 判据 = 联合配置相对**轮起参考**的增量（`shouldAdoptCandidate`：≥ MIN_ADOPT_SCORE 且过噪声
  地板）且 相对**当前工作配置**的边际均值 > 0（防有害搭车）。联合判据的功效来自「一对配置合计
  的收益」；边际项只做符号检查、不要求显著——那正是被功效卡住的地方。
- 采纳 = 两槽一起写回（workingConfig / bestTriggerMap / chosenBySlot / adoptedSlots /
  improvedSlots，已落地成员为幂等 no-op）；联合配置的指标就是采纳后的工作配置指标 → 直接沿用
  （零额外模拟延续配对链，与槽级采纳同一手法）。记录进 `result.jointAdoptions`
  （`{ round, slots, abilityHrids, rounds, score, mean, stdError, pValue, verdict, marginalMean,
adoptedSlots }`，只含采纳成功的；证据不足被拦时置 `evidenceBlocked`，边际不满足时不置位——
  那是「这一对不值得」，不是「样本不够」）。

**报告与 UI**：新字段 `jointAdoptions`（store 整对象透传；`createEmptyResult` 骨架 `[]`）；
结论卡新增一行汇总（`data-trigger-optimizer-joint-adoption` + `jointAdoptionNote` zh/en）；
「预计模拟场次」把探针上界 `maxRounds × C(可搜槽数, 2)` 计入（搜索层 totalEvaluations /
totalSimulations 同步）；「已优化技能」自动含联合采纳的槽（与 `adoptedSlots` 同源）。

**成本**：每轮 ≤ C(n, 2) 次评估，且只在存在合格成员时才跑（多数轮次为 0）。5 槽满载 = +10 次/轮
≈ +11%（与 §19.10 估算一致）；单槽输入天然为 0。

**测试与变异验证**（`triggerOptimizerSearch.test.js` 四个确定性用例，增益标定注释写明本环境
`score ≈ 0.4 × log2(1 + gain)`）：

1. 两槽各自 +0.012（≈0.0069 < MIN_ADOPT_SCORE）→ 联合 +0.024（≈0.0137）过闸 → 两槽一起采纳、
   报告 1 条记录（单槽视角两个 chosen.score 都 < MIN，证明是探针救回来的）；
2. 两槽各自 +0.004（联合 ≈0.0046 不够格）→ 不采纳、不留记录、一轮收敛（零采纳即固定点）；
3. 一槽 +0.2 已单独采纳、另一槽 +0.012 不够格 → 联合（相对轮起）过闸补采纳被拦的槽——正是
   §19.10 实测「先采纳 B、再补 A 被功效拦掉」的形态，记录 `adoptedSlots` 只含新采纳的那个槽；
4. 联合相对轮起过闸（≈0.099）但边际 ≈ −1%（有害搭车）→ 不采纳，且 `evidenceBlocked` 不置位。

变异验证：禁用探针 → 4 个用例全红；关掉边际符号检查 → 用例 4 红（失败输出里
`marginalMean: −0.0058` 与设计预期吻合）。页面模板测试新增「有/无联合采纳」两态的汇总行用例。

**真实引擎验收（2026-09-19，熊图 tier0 / 4h / 法系夹具 5 技能 / 10/2 档 × 两种重复次数）**：

- **重复次数 = 5（产品在 4h 时长下的推荐档）**：90 评估 / 456 场 / 226.5 s，采纳 `[3]`、总分
  `+0.0778`、复验 positive（p = 0.0429；§19.9 记录为 +0.0779 / p = 0.0430 的同一配置，逐位复现）
  —— 与 §19.9 基准（89 / 451 / 308.8 s）相比**只多 1 次评估**（探针上界 20 次：5 槽 10 对 × 2 轮；
  实际只有 `(slot2, slot3)` 一对合格），墙钟差异主要为机器负载。该对的联合比较在 5 轮下被噪声地板
  拦下——离线同种子复算：联合 mean `0.0835 ± 0.0627`（2×SE = 0.1254 > mean ⇒
  `hasAdoptionEvidence = false`）、边际 `+0.0124 > 0`（符号检查通过）⇒ **拦得住**正是设计意图：
  功效不足时不强行采纳。该轮另有 2 条深挖记录（slot2 扩到 6 轮仍不足、slot3 扩到 6 轮通过并采纳）。
- **重复次数 = 10（`TRIGGER_OPTIMIZER_MAX_ROUNDS` 上限）**：88 评估 / 872 场 / 447.0 s，
  **采纳 `[3, 2]`**（slot3 单独采纳 + slot2 由联合探针补采纳），`jointAdoptions` 一条：
  score `0.1440` / mean `0.1286 ± 0.04095` / p = `0.0119` / 边际 `0.0473` —— 与 §19.10 表中
  「AB vs 现状」「AB vs B」两行**逐位吻合**（同一组 10 种子）；总分 `+0.1440`（对照：只采纳 B 是
  `+0.0965`），复验 positive（p = 0.0317）。3 次探测中 2 次被拒（`(slot0, slot2)`、`(slot0, slot3)`），
  只有 `(slot2, slot3)` 过闸——探针没有把「两两组合」的成本全花出去。
- 结论：§19.10 提议的「便宜替代」在真实引擎上兑现——**同样的搜索预算下把 AB 从被漏掉变成被采纳**；
  在低功效档位（5 轮）它保守地不出手，只留下 +1 次评估的成本（+0.6%）。注意两次验收的
  `deepDives` 行为符合既有口径（rounds ≥ 6 不开放深挖；5 轮时 slot2/slot3 各深挖一次）。

**已知边界**（勿过度解读）：

- 成员不做精炼（联合采纳后不进入精炼行走）；
- 联合参考系是**轮起**：同轮其它已采纳槽的收益有轻度「搭车」，由边际符号检查与最终独立复验
  （6 轮换种子、判负一票否决）兜底；
- 联合采纳的槽在报告里的 `chosen.score` 可能 < MIN_ADOPT_SCORE（它正是「单槽不够格」的那类），
  UI 的可信度口径以结论卡（improved + 复验）与 `adoptedSlots` 为准。

---

## 20. 第九轮：功效实测 → 轮数口径 + 可确认下线上屏（2026-09-20，未提交）

起因：用户问「现在的技能优化怎么样，还有能提升找出最优结果的方法吗」。先做**只读实验**（§20.1）
把「搜不出提升」量化，确认瓶颈在**统计功效**而不是搜索算法；随后落地两件事——
**① 按实测地板重定「档位 × 时长 → 轮数」（§20.3）** 与 **④ 把「本次能确认多大的提升」上屏（§20.2）**。
② racing、③ 深挖换独立种子盐、⑤ 候选空间/联合探针扩展留待后续（依据见 §20.1 末）。

### 20.1 只读实验：σ·√T 恒定 ⇒ 统计货币是「总模拟小时数」

**方法（仓库零改动）**：dev server + 内嵌浏览器，页面内直接 import 生产模块
（`buildCandidatePayload` / `evaluatePayload` / `createTriggerOptimizerSeedSet` /
`computeObjectiveScore`），夹具 `modernPlayerJunglePlanetFixture`，`/actions/combat/jungle_planet`
tier0，2 个 AOE 槽（firestorm slot2 / flame_blast slot3）各 10 候选 + 基线 = 21 配置 ×
4h/8h/24h × 20 个稳定前缀种子 = **1260 场真实 worker 模拟**（14 分钟，零失败）。

**① 标度律**：每轮 σ = **0.0160 / 0.0122 / 0.0070**（4h / 8h / 24h），σ·√T ≈ 0.032~0.034
恒定 ⇒ Var ∝ 1/T。采纳闸门的地板 = 2×SE = 2σ(T)/√n ⇒ **只由 W = n·T（总模拟小时数）决定**：
同一 W 下无论切成几次，地板一样；「时长」只影响墙钟（结论 ④）与 t 检验的自由度（结论 ②）。

**② 地板与显著门槛**（分数→利润按 2^(x/w_profit) − 1，w_profit = 0.5；下表为丛林 tier0 实测标定）：

| 组合     | W = n·T | 地板 2×SE（利润） | 显著门槛 t(n−1)×SE（利润）  |
| -------- | ------- | ----------------- | --------------------------- |
| 24h × 2  | 48      | 1.38%             | **9.2%**（dof 1，t = 12.7） |
| 24h × 5  | 120     | 0.86%             | 1.21%（t = 2.78）           |
| 24h × 6  | 144     | 0.79%             | 1.02%（t = 2.57）           |
| 24h × 10 | 240     | 0.61%             | —                           |
| 4h × 5   | 20      | 2.0%              | 2.8%                        |
| 4h × 8   | 32      | 1.6%              | —                           |
| 4h × 10  | 40      | 1.41%             | —                           |

⇒ **轮数 = 2 时搜索期 verdict 几乎恒 inconclusive**：地板只要 1.38%，但 p<0.05 要 9.2%
（dof = 1 的 t 检验没有功效）。这就是用户「感觉搜不出提升」的机制，也是本轮默认值 2 → 5 的依据。

**③ 决策质量**（190 / 1140 / 15504 / 4000 个种子子集自助）：

- 真提升槽（分数增量 ≈ +0.019）：采纳率 n = 2 时 4h 43.7% / 24h 93.2%，n = 5 时 24h 100%，
  n = 10 时 4h 97.2% —— **低轮数的代价是漏采**；
- 无提升槽（firestorm 全候选更差）：假采纳 ≈ 0%（precision 100%）⇒ 采纳闸门不会把噪声当提升；
- n = 2 时保留 top-3，真最优 **100% 不被淘汰**（racing 的安全性依据）。

**④ 成本模型**（串行标定）：每场 ≈ **0.66 s 固定开销**（worker 启动 + 模块加载）**+ 0.18 s/模拟小时**
→ 1h 0.84 s、4h 1.51 s、24h 5.01 s；每模拟小时 24h 最划算（0.209 s/h vs 4h 0.378 s/h）。
（**2026-09-27 已重标定**：§54/§55 之后的当前形态实测 ≈ **0.20–0.22 s 固定 + 0.14 s/模拟小时**，
老斜率偏高约 24% —— 见 §61；下文结论「不要靠缩短时长省时间」不受影响。）
⇒ **不要靠「把时长改小」省时间**：同一墙钟下 24h×6 的地板（0.0055）优于 4h×20（0.0074），
更优于默认的 24h×2（0.0096）。并发 9 路时单场约为串行的 1.6~1.7 倍（实验期开销，成本结论以串行标定为准）。

**⑤ 自证与跨时长一致性**：跨时长排名 Kendall τ(4h vs 24h) = 1.0 / 0.909（两槽各自）；
「当前配置」锚点候选 mean 恒 0.0000、sd = 0（CRN 配对正确，报告里的 0 分是真的 0）。

**由实验得到的路线（本轮取前两项）**：

1. **轮数口径**（§20.3）：把默认轮数按「可确认量级」重定，并让档案的时长表承担「短时长补样本」；
2. **可确认下线上屏**（§20.2）：把地板/显著门槛变成结论卡上的数字（本轮）；
3. racing（后续）：n = 2 全量筛 → 留 top-3 → 幸存者扩到 8~10 轮（同预算下地板 ≈0.5%、总成本 −45%）；
4. 深挖换独立种子盐（后续）：消除「可选停时」带来的 p 乐观偏差；
5. 候选空间 / 联合探针扩展（后续）：`number_of_dead_units` 引擎已支持而生成器未用、
   联合探针从「top-1 对」扩到 top-2 与三槽。

### 20.2 可确认下限上屏（`triggerOptimizerScoring` + 结论卡）

**纯函数**（`triggerOptimizerScoring.js`）：

- `resolveTriggerOptimizerDetectionFloor(paired, weights, { rounds })` →
  `{ rounds, stdError, noiseFloor, significanceFloor, weightProfit, profitPercent }`：
  地板 = 2×SE（与采纳闸门同源 `TRIGGER_OPTIMIZER_ADOPTION_NOISE_MULTIPLIER`），
  显著门槛 = `tCritical(rounds) × SE`（`jStat.studentt.inv(0.975, n−1)`，异常回落 1.96）；
  轮数优先取调用方给的本次 `settings.rounds`，否则回落 `paired.score.rounds`；
  `rounds < 2` 或 SE 非有限/≤0 → **返回 null（不猜）**。
- `projectTriggerOptimizerDetectionFloor(floor, targetRounds)`：SE ∝ 1/√n 的纯缩放 +
  t(target−1)；`target ≤ floor.rounds` 或 `floor` 缺失 → null（不出一个做不到的下一步）。
- `profitPercent = (2^(x / w_profit) − 1) × 100`，`w_profit = byMetric.dailyNoRngProfit`
  （自定义权重也吃同一口径 `resolveQueuePerformanceSubweights`）；权重 ≤ 0 → 不换算（上屏为「—」）。

**页面**（`TriggerOptimizerPage.vue` 结论卡，`roundLimitReached` 之后两行）：

- `detectionFloor` computed：首选 `improvement.paired`（与采纳判据同源）；为空时退到各槽
  `chosen.paired.score.stdError` 的**中位数**（过滤 ≤0/非有限——锚点候选 SE 恒 0、证据不足时
  best 就等于基线，其 paired 为空）。
- `data-trigger-optimizer-detection-floor`（本次设置：轮数 × 时长、地板、p<0.05 门槛）与
  `data-trigger-optimizer-detection-floor-projection`（提到 `TRIGGER_OPTIMIZER_MAX_ROUNDS` 后的地板）。
- 数字走页面既有 `toLocaleString` 口径（最多四位小数、不补尾零）；**「±」只出现在文案里**，
  传值是幅值（`floorMagnitude`），否则会渲成「±+0.01」这样的双符号。
- i18n：新增 `triggerOptimizer.detectionFloor` / `detectionFloorProjection`（zh/en）；
  `roundsHint` 与 `evidenceBlocked` 改为按「可确认下限」解释——**删掉旧引导「先把时长改小」**
  （实验结论 ④：缩短时长并不省统计货币，只是把同样的钱花得更慢）。

**测试**：`triggerOptimizerScoring.test.js` 新增 4 条（地板/门槛/利润换算、显式轮数优先 +
拒绝猜测、利润权重为 0 不换算、投影与 null 边界）；`TriggerOptimizerPage.template.test.js`
新增 1 条（两态渲染：本次下限 + 投影；已在上限时**不**渲染投影），并锁定「± 只出现一次」。

### 20.3 轮数口径变更（`TRIGGER_OPTIMIZER_PRESETS`）

口径从「全局推荐值 × 基础轮数」的两段式改为**每档自带一张「时长 → 轮数」表**（≤4h / ≤8h，
更长时长用该档的兜底 `rounds`）：

| 档位 | 4h     | 8h     | 更长（24h 起）    | 地板 4h / 8h / 24h（利润，见 §20.1 表） |
| ---- | ------ | ------ | ----------------- | --------------------------------------- |
| 快速 | 5      | 3      | 2                 | 2.0% / 2.0% / 1.4%（看一眼）            |
| 标准 | **8**  | **6**  | **5**（= 新默认） | 1.6% / 1.4% / 0.86%（产品默认档）       |
| 精细 | **10** | **10** | 6                 | 1.4% / 1.1% / 0.79%（尽量找最优）       |

- `TRIGGER_OPTIMIZER_DEFAULT_ROUNDS` **2 → 5**（注释记录 σ·√T、t(n−1)、自助命中率）；
- `resolveTriggerOptimizerPresetRounds(preset, hours)` 改为查该档时长表 → 兜底 `preset.rounds`，
  再 clamp 到 [1, 10]；`resolveRecommendedTriggerOptimizerRounds(hours)` 保留出口，
  语义 = 「标准档在给定时长下的轮数」；
- **不变式**：`normalizeTriggerOptimizerSettings({})` 的兜底 = 标准档在默认时长（24h）的轮数
  ⇒「默认设置必定命中标准档」仍成立（测试用常量而非硬编码）；
- store 侧无需改动：`setTriggerOptimizerSettings` 里「仅改时长且命中预设 → 回写 rounds」的
  逻辑自动吃新表（实测：24h ↔ 4h 切换 → 5 ↔ 8，档位仍显示「标准」）。

**成本影响**（页面「预计模拟场次」= `(1 + maxRounds × 槽数 × 候选上限 + maxRounds × 槽对数) × rounds + 2 × 6`，
上界口径）：

| 场景（5 技能 / jungle tier0 夹具） | 场次     | 说明                       |
| ---------------------------------- | -------- | -------------------------- |
| 标准 24h（新，rounds 5）           | **617**  | 默认档的真实成本           |
| 标准 24h（旧，rounds 2）           | 254      | 同输入对照（2.4×）         |
| 标准 4h（rounds 8）                | 980      | 短时长用轮数补样本         |
| 快速 24h / 4h                      | 94 / 217 | 低强度档仍是最便宜的探路档 |
| 精细 4h（rounds 10）               | 2722     | 上限档                     |

按串行成本模型（24h 5.01 s/场）与 9 路并发的 1.6~1.7 倍开销，标准 24h 的墙钟在十分钟量级——
这是「默认档结论可信」的价格；想更快就用快速档（94 场）。

### 20.4 真实链路验收（2026-09-20，dev server + 内嵌浏览器 + 真实 worker）

夹具 `modernPlayerJunglePlanetFixture`（5 技能：元素光环 / 元素增幅 / 火焰风暴 / 熔岩爆裂 / 火球）
经 `importSoloConfig` 注入玩家 1，区域 `/actions/combat/jungle_planet` tier0，两次运行都走
「页面按钮 → store.startTriggerOptimizer → 真实 worker」全链，控制台零 error/warning：

| 运行               | 重复次数 | 评估 / 场次 | 墙钟    | 结果                                                                                                             |
| ------------------ | -------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| 标准 24h（第一次） | 5        | 85 / 427    | 373 s   | 采纳 slot3，总分 `+0.0178`；搜索期 paired positive（p = 5.6e-5）、复验 6 轮 positive（p = 0.0386）               |
| 标准 4h（第二次）  | 8        | 85 / 676    | 190.4 s | 采纳 slot3，总分 `+0.0174`；复验 6 轮 positive（p = 0.0129）；`roundLimitReached` / `evidenceBlocked` 均为 false |

**① 实测抓到一处真缺陷（已修 + 加回归测试）**：第一次 24h 运行时，下限行印成
**「本次设置（2 轮 × 24 小时）」**——`detectionFloor` 取了 `results.rounds`（coordinate descent
跑到固定点用了几轮 pass，实测正是 2）而不是 `settings.rounds`（抽样重复次数 = 5）。两个字段同名字段
差一个数量级，且**搜索轮数少的时候看起来「也像那么回事」**（2 轮恰好是旧默认值），单测与静态审查都
不容易发现——只有真跑一遍才暴露。修法：`const rounds = Number(settings.value.rounds) || 0`；
回归测试把「result.rounds = 2（搜索 pass）+ settings.rounds = 5」这一真实组合钉死。
第二次（4h / 8 轮）验收读数正确：「本次设置（**8 轮 × 4 小时**）」。

**② 下限口径与实测标定独立吻合**：4h × 8 轮这次运行自己算出来的地板是 **±0.0116 分 ≈ 1.62% 利润**
（显著门槛 ±0.0137 分，t(7) = 2.36），与 §20.1 只读实验按 σ(4h) = 0.0160、n = 8 推出的 **≈1.6%**
几乎重合——两条独立路径（同种子精确重放 vs 随机分组实验）给出同一量级，标定可信。
投影行也符合预期：「把重复次数提到 10 轮 → ±0.0104 分（≈1.45% 利润）」。

**③ 成本复核**：24h×5 用 427 场 / 373 s（并发 4），4h×8 用 676 场 / 190.4 s——短时长确实更省墙钟、
但地板更差（1.62% vs 24h×5 的 0.86%），与 §20.1 结论 ④ 的方向一致（预算分配按「要多大结论」选，
不按「想多快跑完」选）。

---

## 21. 第十轮：深挖改用独立种子（消除可选停时的 p 乐观偏差）（2026-09-20，未提交）

§20.1 路线里的第 ③ 项，也是 §18.1 自己写下的「已知边界」：**深挖的判据样本必须独立于筛选过程**。

### 21.1 问题：复用搜索期的样本 = 可选停时

旧实现（§18.1）用**同一盐的搜索种子集**把被拦候选与参考「扩到 6 轮」再判一次，理由是
`deriveSeedSet` 是稳定前缀、前 N 个种子与搜索期完全相同 ⇒ 「纯粹的样本扩充」（不换随机流）。
这在**样本量**意义上没错，但在**统计**意义上有致命一环：**「谁被复核」正是用这批数据选出来的**
（分数够、只差噪声地板），于是那 6 轮里前 N 轮数据既是筛选依据、又是判据的一部分 ——
典型的可选停时（optional stopping），p 值必然偏乐观：只挑「看着快过线」的候选加密，
过线概率自然高于名义水平。兜底只有两道（每槽一次 + 最终独立复验），但被漏进报告的
`adopted` 与 UI 的「深挖复核通过」会把这种乐观当成结论展示。

### 21.2 修法：独立盐 = 样本分割

- 新增 `TRIGGER_OPTIMIZER_SEED_SALT_DEEP_DIVE = 'trigger-optimizer.deep-dive.v1'`（salt 进
  `createTriggerOptimizerSeedSet` 的 key 参与 hash ⇒ 与 search/verify 三组种子天然错开）。
- 深挖时**候选与参考各重跑 6 轮全新样本**，判据只用这 6 轮 —— 样本分割（select on A,
  test on B）：B 组与「谁被复核」这个事件无关 ⇒ 这次 t 检验的 p 值有效。
- **不把 A 组的 n 轮与新样本合并**：合并会把参与筛选的数据带回判据，偏差原路返回。
- **成本不变**：配对要求等长样本，所以两侧本来都要重测（旧实现也是 2 次评估 × 6 场 = 12 场），
  换盐只是换了随机流，不是加钱。
- 触发条件不变（`settings.rounds < TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS`）：新样本的检验功效
  由它自己的 6 轮决定，搜索轮数 ≥ 6 时还不如刚失败的那一次，直接跳过。
- 报告新增 `deepDives[i].seeds`（该次复核实际用的 6 个种子）——把「判据用的是新样本」变成
  可被 UI 与测试自证的事实；i18n `deepDiveNote` 改为「改用独立种子复核（判据不使用筛选时的那几轮
  样本）」，不再说「扩样」。

### 21.3 测试

`triggerOptimizerSearch.test.js` 深挖三条用例保持「增益只取决于轮序号」的确定性构造（因此
换盐不改数值），并新增四条断言：

1. `dive.seeds` 长度 = `TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS`；
2. 与**搜索期**种子不相交（`slice(0, evaluationRounds)` 那批）；
3. 与**复验**种子不相交；
4. 深挖那 12 场 worker 调用的 `payload.seed` 全部来自 `dive.seeds`（接线自证，不是只改了报告字段）。

页面模板用例改为断言新文案（「独立种子复核」），并继续覆盖「通过/仍不足」两态。

### 21.4 剩下的边界与后续

- 「只复核被拦候选」的多重比较风险由独立样本消解（B 组检验无偏），不是靠事后解释；
- 最终结论仍由独立复验（第三组种子）硬否决，判负一律不可应用；
- 未做（§20.1 路线里的其余项）：② racing（同预算把决定阶段轮数提高）、⑤ 候选空间与联合探针扩展。

### 21.5 真实链路验收与「深挖窗口」的结构性检查（2026-09-20）

4 次真实运行（夹具同 §20.4 的 5 技能夹具，全部走「页面按钮 → store.startTriggerOptimizer →
真实 worker」全链，控制台零 error/warning）：

| #   | 区域 / 时长 / 档位          | 评估 / 场次 | 墙钟   | 结果                                                  |
| --- | --------------------------- | ----------- | ------ | ----------------------------------------------------- |
| 1   | 丛林 / 24h / 快速（6/1/2）  | 33 / 74     | 68.3 s | 采纳 slot3+slot0，复验 positive；`deepDives` 0 条     |
| 2   | 单怪图 fly / 24h / 快速     | 34 / 76     | 50.4 s | 采纳 slot0/4/1，复验 positive；0 条                   |
| 3   | fly / 4h / 快速（rounds 5） | 35 / 177    | 44.6 s | 采纳 slot0/4，复验 positive；0 条                     |
| 4   | 丛林 / 4h / 快速            | 32 / 162    | 45.4 s | 采纳 slot3（score 0.0225、SE 0.0083，直接过闸）；0 条 |

**深挖分支 4 次都没被触发**，而且不是偶然——被拦带（`isAdoptionBlockedByEvidence`）要求
`score ≥ MIN_ADOPT_SCORE = 0.01` **且** `|mean| ≤ 2×SE`，两者同时成立需要 `2×SE > 0.01`
（即 `SE > 0.005`）。用 §20.1 实测的 σ(T) 在任务页里直接 import 生产模块实算：

| 组合    | 2×SE    | 被拦带可达  |
| ------- | ------- | ----------- |
| 24h × 2 | 0.0099  | ✗（差一点） |
| 24h × 5 | 0.00626 | ✗           |
| 4h × 5  | 0.01431 | ✓           |
| 4h × 10 | 0.01012 | ✓（临界）   |
| 8h × 3  | 0.01409 | ✓           |

⇒ **深挖是「短时长 / 低轮数」窗口的机制**：24h 档（σ 小）在结构上就不可能被拦，快速档 4h/8h
才是最可能触发的一档——这既解释了上面 4 次运行，也界定了 §21 修正的影响面（窄，但在正确的地方）。

**盐的独立性与确定性（页面内实算，生产模块）**：同一上下文下三套盐派生出的种子两两不相交
（search∩deepDive = search∩verify = deepDive∩verify = 0），同盐两次派生逐位相同（确定性）——
即「换盐」确实换成了一组与搜索/复验都不重叠的新样本。

**深挖接线本身**由服务层确定性用例覆盖（§21.3 第 4 条直接断言深挖那 12 场 worker 调用的
`payload.seed` 全部来自 `dive.seeds`），而 payload 是真实 `evaluateConfig` 路径产出的——
不依赖人工观察。

---

## 22. 候选空间扩展：波内进度（`number_of_dead_units`，2026-09-20）

§20/§21 解决的是「同样的候选集，怎么把结论做得可信」；本节处理另一半：「引擎支持、
生成器却从未用过的条件」——候选空间本身有缺口时，再强的统计也只是在残缺的集合里挑最优。

### 22.1 引擎语义核对（先验证再生成）

| 事实                            | 出处                                                                                     | 结论                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 只在多目标依赖下求值            | `combatsimulator/trigger.js:65`（`isActiveMultiTarget` 分支）                            | 依赖只能是 `all_enemies` / `all_allies`，单目标下不走这条 |
| 数的是依赖组里 `hp <= 0` 的单位 | 同上                                                                                     | 对玩家 = 当前这波怪里「已死几只」                         |
| 换波是**整波替换**              | `combatsimulator/combatSimulator.js:907/1201/1217/1220`（整波死光 → 换波）               | 不是累计击杀、也不是「已重生」：死亡怪随新波一起被换掉    |
| 数据定义                        | `data/combatTriggerConditionDetailMap.json`（`# of Dead Units`、`isMultiTarget`）        | 允许比较器只有 `greater_than_equal` / `less_than_equal`   |
| 游戏内真实用法                  | `data/abilityDetailMap.json:2455-2461`（某技能默认触发器 = `number_of_dead_units >= 1`） | 合法且被官方使用，不是死条件                              |
| 一波人数上限                    | `data/zone.js:29` 的 `randomSpawnInfo.maxSpawnCount`                                     | 丛林 = 4；单怪图 fly = 1（实测见 22.4）                   |

即：这条条件给的是 **① ② 都表达不了的「波内节奏」窗口** —— `≤ N` 只在开波期放（AOE 别丢给
残波）、`≥ N` 只在清场期放（把爆发留给残波）。

### 22.2 生成规则与阈值合法性

`triggerOptimizerCandidates.js` 的 `damageCandidates` 新增 ③ 段（插在 ② 敌人数之后、
跨技能增益门之前）：

- **绝不配单目标依赖**：`self` / `targeted_enemy` 下引擎会走单目标分支（该条件不在其白名单里），
  配出来就是无效配置；生成器只产 `all_enemies` 三件套。
- **阈值必须落在 `[0, waveSize)`**：`≥ waveSize` 恒假（整波死光就换波、永远到不了），
  `≤ waveSize − 1` 恒真（= 没有这条触发器）。故 `≥` 合法区间 `[1, waveSize−1]`、
  `≤` 合法区间 `[0, waveSize−2]`；`waveSize < 2`（单怪图）或资源降级 → **整族不生成**
  （与「敌方血量类」的 `isMeaningfulEnemyHpThreshold` 同款自守：不产白跑一场的候选）。
- `waveSize` 由 `triggerOptimizerSimulation.resolveEnemyHpScale` 提供（新增字段，读
  `Zone.monsterSpawnInfo.randomSpawnInfo.maxSpawnCount`，读不到 → 0 → 调用方跳过整族）。
- 默认阈值 `deadUnitsAtLeast: [1, 2]`、`deadUnitsAtMost: [0]`；顺序 = 价值顺序，
  先 `≤`（开波期）再 `≥`（清场期），截断时先丢清场期那条更高的阈值。

### 22.3 候选上限：16 → 20（截断影响的实测量化）

新族会让**候选表从「加和」变成「替换」**：输出角色的完整网格 = 2 锚点 + 13 单条件 + 4 组合
（+ 其它已佩戴技能提供的 `buffWindow`，数量随阵容浮动）。旧上限 16 恰好等于改动前的整张网格，
所以多出 3 条就意味着有 3 条被挤出去。页面内 import 生产模块实测（丛林夹具，5 技能，
`enemyHp = {min 500, max 4400, group 3200, waveSize 4}`）：

| 档位       | 上限 | 输出槽候选（节选尾部）                                                                                                     | 新族 |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| 快速       | 6    | …`enemyGroupHp@800`、`compositeExecuteGuard`、`enemyGroupHp@1600`                                                          | 0 条 |
| 标准       | 10   | …`compositeLowHpGuard`、`manyEnemies#3`（slot4 再加 `compositeBuffWindowGroupHp@800`）                                     | 0 条 |
| 精细（旧） | 16   | 上面 10 条 + `deadUnitsAtMost#0`、`deadUnitsAtLeast#1`、`deadUnitsAtLeast#2` → **挤掉** `enoughMp`、`lowHp`×2（尾部 3 条） | 3 条 |
| 精细（新） | 20   | 上面 10 条 + 3 条新族 + `buffWindow`×2、`enemyTargetHp@250`、`executeHp@150`、`enoughMp`、`lowHp`（slot4 两条）            | 3 条 |

⇒ 把上限提到 **20**：精细档重新装下完整网格，新族成为**净增量**（不是拿未验证的方向换掉既有
方向）；上限只是预算钳制，不会强生成候选 —— 快速 6 / 标准 10 两档的候选表与改动前**逐条相同**。代价只在精细档：
上界估算 `(1 + maxRounds×槽数×candidateLimit + maxRounds×槽对数) × rounds + 12` 从 1638 → 1998 场
（5 槽 / 24h / 3 轮上限 / 6 轮，+22%），而实际增长只有输出槽那 3 条。

**上限 20 的已知最坏情况**：某输出槽既带「当前配置」锚点、又有 ≥2 个跨技能增益条件时，
网格是 21 条 → 仍会丢掉设计上价值最低的那一条（`lowHp` 75%）。这是价值顺序截断的正常行为
（不是新族挤占），实测的 slot2/slot3 就是这种情形。

### 22.4 精炼支持（与「敌人数」同口径，但 clamp 随区域变化）

`buildRefinementCandidates` 新增波内进度分支：计数 ±1，合法区间由 `enemyHp.waveSize` 推出
（`≥` 类 `[1, waveSize−1]`、`≤` 类 `[0, waveSize−2]`）——**不能**复用 `number_of_active_units`
的 `[2, 8]`：`≤ 0` 是合法网格点，而 `≥ waveSize` 是恒假配置。读不到 `waveSize` 或 `waveSize < 2`
直接不产出（精炼也不能凭空造越界阈值，与生成阶段整族跳过的口径一致）。
多级精炼时计数类不随 `level` 变化（±1 已是最细的整数粒度）。

### 22.5 测试

`triggerOptimizerCandidates.test.js`：

1. 价值顺序用例新增 ③ 段断言（`≤ 0` 的三件套 + `[1, 2]` 两条 `≥`，比较器 `≤`/`≥`、依赖恒为 `all_enemies`）；
2. 单条件序列断言（13 条）含 3 条新族，位置在 `manyEnemies` 之后、`buffWindow` 之前；
3. 新用例「按一波怪的上限人数过滤」：`waveSize 4 → [0,1,2]`、`2 → [0,1]`、`1`/缺字段/无资源 → `[]`；
4. 新用例「候选上限：默认档不含新族，精细档装下完整网格（新族是净增量）」——上限若回到 16 会立刻变红；
5. 精炼用例：`waveSize 4` 下 `≤0 → [1]`、`≥2 → [1,3]`、`≥1 → [2]`；`waveSize 2` / 单怪图 /
   缺 `waveSize` → 不产出；三件套与标签沿用 winner 且过 `sanitizeTriggerList`。

`triggerOptimizerScoring.test.js` 的候选标签契约补两条新 key；`triggerOptimizerDomain.test.js`
预设用例改用常量断言并明确「旧持久化的 16/3/6 现在是自定义档」。

### 22.6 真实链路验收（页面 → store → 真实 worker）

夹具同 §20.4（丛林 5 技能，`importSoloConfig` 导入），设置 `candidateLimit 20 / maxRounds 1 /
rounds 2 / simulationHours 1`（缩时档：**只验接线与候选表，不作为统计结论**）：

- 76 次评估 / 160 场模拟 / 27 s，`resourcesAvailable = true`，控制台零 error/warning；
- 三个输出槽的候选表各 20 条，均含「已死怪数 ≤ 0（开波期）」「已死怪数 ≥ 1（清场期）」
  「已死怪数 ≥ 2（清场期）」，UI 文案与配对差正常渲染（截图核对）；
- **实测得分**（该缩时档）：`≤ 0` = **+0.0064**（该槽最优，配对差 +0.0064 ± 0.0036，不显著）、
  `≥ 1` = **−0.2336**（显著更差）、`≥ 2` = **−0.2855**（显著更差）。
  ⇒ 清场期方向在「纯输出技能 + 4 怪波」这个组合上被实测否决（延迟释放浪费冷却），
  这正是候选空间扩展的意义：**搜索可以证伪它，而不是「从未试过」**。开波期方向接近中性偏正。

### 22.7 已知边界与后续

- `waveSize` 是**上限**人数（实际一波还会被 `maxTotalStrength` 提前截断）⇒ 在「上限 4、实际
  常态 2」的区域里，`≥ 2` / `≥ 3` 会比字面更保守；阈值方向交给搜索裁决，不预判。
- 单怪图（`maxSpawnCount = 1`）与读不到区域刷新表的场景：整族不生成（不是「生成恒真候选」）。
- 旧版本持久化的精细档三元组（16/3/6）现在匹配不上任何预设 → 下拉显示「自定义」，
  用户候选表会升到 20 条（属预期，与 §20.1 改轮数时的口径一致）。
- 未做：把「已死怪数」与其它条件组合成合取候选（如「增益在 且 开波期」）——先看单条件方向
  在真实运行里是否被采纳（本轮为止是被否决），避免又做一批永远跑不到的组合。

## 23. 条件侧别：把敌人减益放到正确的依赖上 + 跨技能减益窗口（2026-09-21，未提交）

§22 扩的是「引擎支持、生成器从未用过的条件」；本轮处理同一类缺口的另一半：**用过的条件配在
了错的依赖上**。修掉这个之后，由它派生出的一个从未生成过的候选族（跨技能减益窗口）才成立。

### 23.1 问题：跨技能窗口不区分 buff 落在谁身上

`resolveOwnBuffConditions` 与它驱动的 `resolveOtherBuffConditions` 只按「buff 唯一键 → 条件表
条目且 `isSingleTarget`」登记，**不区分这个 buff 落在谁身上**，于是把「别人挂在敌人身上的减益」
也当成「自身增益门」的来源。实测的落点分类（`abilityDetailMap` 的 `abilityEffects[].targetType`）：

| 技能                            | targetType   | 条件                              | 旧行为（跨技能）          |
| ------------------------------- | ------------ | --------------------------------- | ------------------------- |
| `/abilities/puncture`           | `enemy`      | `…/conditions/puncture`           | 被塞进 `self + is_active` |
| `/abilities/fracturing_imp…`    | `allEnemies` | `…/conditions/fracturing_impact`  | 同上                      |
| `/abilities/mystic_aura`        | `allAllies`  | `…/conditions/mystic_aura`        | 正确（增益窗口）          |
| `/abilities/elemental_affinity` | `self`       | `…/conditions/elemental_affinity` | 正确（增益窗口）          |

引擎侧的事实（本轮逐条核对，并写进 `combatsimulator/__tests__/trigger.test.js`）：

| 事实                                                                               | 出处                           | 结论                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `self` 读 `source.combatBuffs`                                                     | `trigger.js:28-29`             | 施法者自己身上的 buff                                    |
| `targeted_enemy` 读 `target.combatBuffs`，`target` 为空**求值前**直接 return false | `trigger.js:31-35`             | 目标不存在时该触发器一律不成立（`is_inactive` 也不成立） |
| 伤害类效果的 buff 施加给被命中的 target                                            | `combatSimulator.js:2038-2043` | 敌人减益**只**存在于敌人身上                             |
| `allAllies` 的增益施加给 `this.players`（含施法者自己）                            | `combatSimulator.js:1882-1902` | 光环/队友增益在 `self` 下可读（§18.3 的前提）            |
| `self` 效果的 buff 施加给 `source`                                                 | `combatSimulator.js:1905-1914` | 自身增益在 `self` 下可读                                 |

⇒ 带 `puncture` / `fracturing_impact` 的阵容里，输出槽会稳定产出一条**结构性恒假**的
`self + 〈敌人减益〉 is_active`（施法者身上永远没有这个 buff）：每轮白跑一场模拟，精细档还占
一个候选名额；而真正有组合价值的 `targeted_enemy + 〈敌人减益〉 is_active` 一条都不生成。

### 23.2 侧别分类（只看 `targetType`，不靠 buff 名字猜）

`triggerOptimizerCandidates.js` 新增：

- `CONDITION_SIDE_SELF` / `CONDITION_SIDE_TARGET` + `resolveConditionSide(targetType)`：
  `self` / `allAllies` → 自身侧；`enemy` / `allEnemies` → 目标侧；其它 → `null`
  （队友侧：单目标依赖读不到，多目标侧已被 §22 扫完 ⇒ 不进候选）。
- `resolveOwnBuffConditions(definition)` 改为返回 `{ self: [], target: [] }`；技能 hrid 的回落项
  只在该技能**确实会挂 buff** 时才登记（挂哪一侧由它的效果决定）。
- `firstOwnCondition(definition, side)`：角色候选/组合候选按侧取条件，依赖与侧别强制配对 ——
  `buffCandidates`（BUFF 角色）用 `self` + 自身侧、`debuffCandidates`（DEBUFF 角色）用
  `targeted_enemy` + 目标侧、`compositeCandidates` 的 `ownBuffInactive(dependency, side)` 两处同理。
- `resolveCrossSkillConditions(player, slotIndex, side)`：§18.3 的跨技能条件按侧拆分，每侧上限
  `CROSS_SKILL_CONDITION_LIMIT = 3`；优先级 = 该侧的「窗口来源」角色（增益侧 aura → buff，
  减益侧 debuff），同类按槽位序。`ctx` 新增 `otherDebuffConditions`。

### 23.3 新族：跨技能减益窗口（`debuffWindow`）

`damageCandidates` 新增 ⑤ 段，形状与 ④ 对称但依赖是 `targeted_enemy`：
`targeted_enemy + 〈其他已佩戴技能的目标侧条件〉 + is_active`。后续段号顺移为 ⑥⑦⑧⑨。

- **依赖必须 `targeted_enemy`**：见 23.1（配 `self` 就是恒假）。
- **收益机制**（buff 数据实测）：碎裂冲击 `+5% 受伤`、致残 `+8% 受伤`（`/buff_types/damage_taken`）、
  穿刺 `−20% 护甲`、冰锥 `−25% 攻速`；持续 12 / 12 / 12 / 8 s ⇒ 「把爆发放进这个窗口」是乘区对齐。
- **条件只来自其他已佩戴技能**：不产恒定假候选（§13 的教训），与 ④ 同源。
- **位置**：插在 ④ 增益门之后、⑥ 单体目标血量之前 —— 同一档「窗口对齐」，且自身增益那侧已被
  §18.3 实测采纳过；减益窗口的收益方向尚未实测（本轮实测是负的，见 23.6）。
- **i18n**：zh「目标 `{{condition}}` 生效时」/ en `While target {{condition}} is active`（与
  `debuffInactive` 的「未激活时」区分）；`TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS` 与
  `triggerOptimizerScoring.test.js` 的标签契约同步（`{{condition}}` 走既有
  `getOfficialGameText('combatTriggerConditionNames', …)`，无需新增渲染路径）。

### 23.4 截断影响（实测量化；候选表是「替换」不是「加和」，§22.3 的教训）

页面内 import 生产模块实测（丛林夹具，`candidateLimit 20`，`enemyHp = {min 500, max 4400,
group 3200, waveSize 4}`）：

| 阵容                                          | 输出槽候选数   | 尾部（节选）                                                                                                                                                                  |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原始 5 技能（无减益来源）                     | 20（= 旧网格） | …`buffWindow(mystic_aura)`、`buffWindow(elemental_affinity)`、`enemyTargetHp(250)`、`executeHp(150)`、`enoughMp(30%)`、`lowHp(50%)`；**0 条新族** ⇒ 与 §22 记录逐条相同       |
| 光环 + 自身增益 + 2 输出 + 1 减益（碎裂冲击） | 20（网格 22）  | …`buffWindow(mystic_aura)`、`buffWindow(elemental_affinity)`、**`debuffWindow(fracturing_impact)`**、`enemyTargetHp(250)`、`executeHp(150)`、`enoughMp(30%)` ⇒ 挤掉 `lowHp`×2 |
| 光环 + 3 减益 + 1 输出（最坏）                | 20（网格 22）  | …`buffWindow(mystic_aura)`、**`debuffWindow(puncture / fracturing_impact / ice_spear)`**、`enemyTargetHp(250)`、`executeHp(150)`、`enoughMp(30%)` ⇒ 挤掉 `lowHp`×2            |

⇒ 新族排在 ④ 之后意味着它落在「被截断保护」区内，代价是丢掉设计上价值最低的 `lowHp`
（「自身残血才放」）。**本轮不再抬高上限**（与 §22 的取舍不同）：上限从 20 提到 22 只帮到
「1 个减益来源」的阵容，3 个来源仍会截断，而全局预算上界要多付 ≈9%；等减益窗口方向被实测
采纳后再按证据抬上限（把 `lowHp` 换回来）才划算。

### 23.5 测试

- `combatsimulator/__tests__/trigger.test.js`：新增 describe「Trigger condition side」2 条 —— 同一
  条件配 `self` 读施法者、配 `targeted_enemy` 读目标；`target` 为空时**两个比较符都返回 false**。
- `triggerOptimizerCandidates.test.js`：新增 describe「跨技能减益窗口」5 条（三件套形状 + 侧别分流
  不串味 + 上限 3 条「减益角色优先/同类按槽位序」+ 无来源不产出且本技能减益走 `debuffInactive` +
  价值顺序位置）；原「最多 3 条」用例改为「只取自身侧」（4 个自身侧来源 → 截断到 3 条）。
- `triggerOptimizerScoring.test.js`：候选标签契约补 `debuffWindow`。
- 全量：**177 文件 / 2488 用例全绿**（+7），prettier 干净。

### 23.6 真实链路验收（页面 → store → 真实 worker）

夹具同 §20.4/§22.6（丛林、`importSoloConfig`），把 slot4 换成 `/abilities/fracturing_impact`
（阵容 = 元素光环 / 元素增幅 / 火焰风暴 / 熔岩爆裂 / 碎裂冲击），缩时档
`candidateLimit 20 / maxRounds 1 / rounds 2 / simulationHours 1`：

- **63 次评估 / 134 场模拟 / 23.5 s**，`resourcesAvailable = true`，控制台零 warning/error。
- 三个输出槽候选表各 20 条，均含 `debuffWindow`（生产模块实测，尾部见 23.4 第二行）。
- 实测得分（缩时档只验接线与可证伪性，不作为统计结论）：
  - slot2 `火焰风暴`：`targeted_enemy + fracturing_impact + is_active` = **−0.2119**
    （配对差 −0.212 ± 0.0023，**显著更差**）⇒ 触发器**确实在跑**：dps 167.7 vs 基线 192.3、
    kills/h 225 vs 261 —— 「等减益窗口」在这个配置里代价大于收益，与 §22「≥1 已死怪数 =
    延迟释放」被否决同向；
  - slot3 `熔岩爆裂`：同族 **−0.1503**（配对差 −0.150 ± 0.0012，显著更差）；
  - 采纳：slot3 采纳 **`已死怪数 ≤ 0（开波期）`**，得分 **+0.0472**（配对差 +0.0472 ± 0.0010，
    显著提升，p = 0.0136）—— §22 的波内进度族在本轮换阵容里**再次被采纳**。
- UI：新标签渲染为「目标 碎裂冲击减益 生效时」，触发器摘要「目标敌人的 碎裂冲击减益 已生效」，
  与 `buffWindow`（「元素光环 生效时」/「我的 元素光环 已生效」）在候选表里并排可读（截图核对）。

### 23.7 已知边界与后续

- 减益窗口在「4 怪波 + 纯输出技能 + 1h 缩时档」上被实测**否决**（延迟释放浪费冷却）。它现在的
  价值是**可证伪**：搜索能真的试到它、并给出显著性判据；其它时长/阵容里是否为正，交给真实运行裁决。
- 上限仍为 20：减益来源 ≥ 1 的阵容会按价值顺序丢掉 `lowHp`（尾部两条），这是有意的价值排序。
- 未做（备查）：减益窗口的组合候选（如「目标带减益 且 敌方总血量 ≥ X」）；DEBUFF 角色自身的跨技能
  减益窗口（当前只给输出槽）；目标侧条件按「增伤类优先」排序（现在只按角色/槽位序，
  `damage_taken` 系与「降攻速」系被同等对待）。

## 24. 阈值精炼补齐：敌方血量类（2026-09-21，未提交）

自 §19.9 落地多级精炼以来，「敌方血量类」三个标签（`enemyGroupHp` / `enemyTargetHp` /
`executeHp`）一直是唯一的例外：它们的阈值网格只有 25/25/30% 三档（`TRIGGER_OPTIMIZER_DEFAULT_THRESHOLDS`），
而精炼入口 `REFINE_PERCENT_SPECS` 旁边明文留了口子 ——「加密档位需要先有『阈值步长 = 怪物血量的
百分之几』的口径」。本节就是把这个口径定下来并落地：**步长 = 敌方血量尺度上的百分点**，与
玩家 HP/MP 类共用同一把尺子（±10 → 逐级减半 → 下限 5）。

### 24.1 口径：尺度、上界、百分比反推

新增 `REFINE_ENEMY_HP_SPECS`（`triggerOptimizerCandidates.js`），每条标签声明两件事 ——
**换算尺度**与**自守上界**，两者都必须与生成阶段 `damageCandidates` 的调用完全一致：

| 标签            | 依赖             | 尺度（scaleKey） | 上界（ceilingKey） | 生成阶段的对应调用                                      |
| --------------- | ---------------- | ---------------- | ------------------ | ------------------------------------------------------- |
| `enemyGroupHp`  | `all_enemies`    | `enemyHp.group`  | `enemyHp.max`      | `isMeaningfulEnemyHpThreshold(GTE, value, enemyHp.max)` |
| `enemyTargetHp` | `targeted_enemy` | `enemyHp.min`    | `enemyHp.min`      | `isMeaningfulEnemyHpThreshold(GTE, value, enemyHp.min)` |
| `executeHp`     | `targeted_enemy` | `enemyHp.min`    | `enemyHp.min`      | `isMeaningfulEnemyHpThreshold(LTE, value, enemyHp.min)` |

换算复用生成器自己的 `enemyHpThreshold(percent, scale)`（`Math.round` + 下限 1），所以精炼值与网格值
落在**同一尺度、同一取整口径**上；随后再过 `isMeaningfulEnemyHpThreshold(comparator, value, ceiling)`
—— 精炼不可能造出网格生成器自己都会拒绝的阈值（≥ 上界恒真、< 尺度假之类）。

**百分比反推**：这三个标签的插值是绝对值 `{{value}}`（没有 `percent`），所以邻域写作
`percent = value ÷ scale × 100`，`±percentStep` 后再 clamp `[5, 95]` 并换算回绝对值。
物化时**仍写回 `{ value }`**（不是 `{ percent }`），与网格候选的标签契约逐字一致 ⇒ UI 的
`candidateLabel` / `triggerSummary` 与 i18n 都不需要任何改动（无新键、无新渲染路径）。
两个安全阀：`next === percent`（clamp 后回到自身）与 `value === current`（尺度太小、±步长取整回
同一阈值）都直接跳过，不把「同一个点」当邻域重复评估。

### 24.2 降级与自守（与生成阶段同源的「不产白跑一场的候选」原则）

- `enemyHp` 整体读不到、或某条 `scaleKey` / `ceilingKey` 缺失或 ≤ 0 ⇒ **整条跳过**（返回空数组），
  对应生成阶段「资源降级 → 敌方血量类整类不生成」；
- 越界阈值不产出：例如 `group 5000 / max 4000` 下，80%（4000）的 `+10pp` → 90% = 4500 > 4000（恒真）
  被自守挡下，只剩 `−10pp` → 70% = 3500；
- 精炼仍然只对**恰好 1 条触发器**的 winner 生效：锚点、组合候选（2 条）、`is_active` /
  `is_inactive` 这类非数值条件与既有口径完全一致，本轮不改动。

至此，**所有数值类候选族都可精炼**：`lowHp` / `missingHp` / `lowMp` / `missingMp`（玩家 HP/MP 百分比）、
`allyLowHp`（原始百分比）、`manyEnemies`（计数 [2,8]）、`deadUnitsAtLeast` / `deadUnitsAtMost`
（计数 + 波上限 clamp，§22.4）、`enemyGroupHp` / `enemyTargetHp` / `executeHp`（敌方血量百分点，本节）。

### 24.3 测试

`triggerOptimizerCandidates.test.js` 新增 3 条（`buildRefinementCandidates` describe）：

1. 「±10 个百分点并换算回绝对值（三标签各用自己的尺度）」：`group 5000` 下 1250 → 750/1750；
   `min 1000` 下 `enemyTargetHp` 500 → 400/600、`executeHp` 300 → 200/400；`level 1` → ±5pp
   （250/350）；断言产物仍是 `{ value }` 插值、依赖/比较器沿用 winner、过 `sanitizeTriggerList`；
2. 「自守与降级」：`group 5000 / max 4000` 下 4000（80%）只产 3500（+10pp 被上界挡下）；
   只有 `group` 没有 `max` → `[]`；`enemyHp` 缺失 / 全 0 / 只有玩家属性 → `[]`；
   尺度 3 时 ±步长取整回同值 → `[]`；
3. 「物化与签名去重」：`executeHp` 300 → 200/400（`distance === 4`、`state === 'custom'`、过 sanitize），
   已在候选表里的 400 被签名去重跳过 → 只剩 200。

全量：**177 文件 / 2491 用例全绿**（+3），prettier 干净。

### 24.4 真实链路验收（页面 → store → 真实 worker，单怪区域）

夹具同 §20.4（丛林 5 技能），把区域换成**单怪区域** `/actions/combat/vampire`
（`enemyHp = {min 2200, max 2200, group 2200, waveSize 1}`：单怪图下「已死怪数」族整族不生成，
于是 AOE 总血量族成为该槽的主要方向），缩时档 `candidateLimit 20 / maxRounds 1 / rounds 2 /
simulationHours 1`：

- **69 次评估 / 146 场 / 36.7 s**，`resourcesAvailable = true`，控制台零 warning/error；
- slot2「火焰风暴」采纳 `all_enemies + current_hp ≥ 1100`（= 50% × group 2200，网格值），
  得分 **+0.108** ⇒ 触发精炼循环；
- 精炼按新口径产出 **880（40%，−10pp）** 与 **1320（60%，+10pp）**，两条都带
  `distance = 4`（`DISTANCE_REFINEMENT`）进入候选表并被真实 worker 评估：
  880 = **−0.0839**、1320 = **−0.2793** ⇒ 都劣于 1100，搜索**没有**移动阈值（最终配置仍是 1100）——
  这正是精炼设计的自然终止：邻域被真正评估过，只是没赢；
- UI 截图核对：候选表里并排出现「敌方总生命 ≥ 1,100（本槽最优 0.108）」「敌方总生命 ≥ 880（−0.0839）」
  「敌方总生命 ≥ 1,320（−0.2793）」，标签与配对差渲染正常（新值没有 `percent` 参数也不影响显示）。

### 24.5 已知边界与后续

- `enemyTargetHp` / `executeHp` 的 `ceilingKey` 取 `min` 本身 ⇒ 在 `percent ≤ 95` 的约束下
  `value ≤ 0.95 × min` 恒成立，上界实际不可达；它作为安全网保留（生成阶段的调用就是这个口径，
  两边必须逐字一致，否则精炼会造出网格不会产的值）。
- 单怪区域（`waveSize = 1`，共 44 个区域）下**「敌人数 ≥ 2/3」是结构性恒假候选**（本轮的观察，
  与本轮修的「减益配 self」同类，但属另一个族）：`number_of_active_units` 目前没有波上限自守。
  单怪区域的输出/减益槽会各白跑 2 场/轮；是否按 `waveSize` 过滤留给后续按需处理。
- 组合候选（`compositeBuffWindowGroupHp` 等 2 条触发器）仍不参与精炼：精炼其中一条会改变另一条的
  语义，需要先有「组合内单条邻域」的口径。

## 25. 敌人数波上限自守 + 光环守卫维度（2026-09-22，未提交）

本轮排在最前的方向 C（「支撑角色候选空间」）在开工核实阶段**前提被推翻**（25.1），于是改成处理
两件有据可查的结构性问题：单怪区域的**结构性恒假候选**（§24.5 遗留的观察）与光环槽缺失的
**守卫维度**。两条都属于「候选表里白跑一场的条目」，与 §23（条件侧别错配）同一条原则 ——
候选可以弱、可以输，但不该是「永远不成立」或「与默认行为逐字等价」。

### 25.1 动因：方向 C 的前提被推翻（记录备查）

- **模拟载荷是单人**：`simulatorTriggerOptimizerActions.js:308` 的
  `buildPlayersForSimulation(this.players)` 默认只取 activePlayer，`triggerOptimizerSimulation.js:96`
  的 `buildCandidatePayload` 只构建 1 个 config ⇒ 「队伍总血量」「最残队友失血」这类候选在单人
  模拟里没有耦合对象，价值只剩「被优化角色是队伍一员」的弱耦合。方向 C 降级为 **方向 D**
  （队伍尺度条件），实现前需要先定口径（`all_allies + missing_hp ≥ X` 或「最残队友失血比例」）
  与资源来源（teamMaxHp）。
- **光环槽「候选太少」不是缺条件**：光环类技能的 `defaultCombatTriggers` 本身就是
  `self + 〈自身光环〉 + is_inactive`（实测表见 25.3），而生成器会做「与游戏默认行为等价」的签名去重
  （`triggerOptimizerCandidates.js` 的 `dedupeSignatures`）⇒ 补「光环未生效时释放」会被**逐字
  去重**，纯空转（测试 25.5-⑤ 把这条口径钉住）。
- **真正缺的是组合里的守卫维度**：BUFF 角色有 `compositeBuffRefreshGuard`（增益失效且蓝量充足），
  AURA 角色没有 —— 而用户手工配置里这种写法很常见（丛林夹具的 `mystic_aura` 当前配置正是
  `自身光环未生效 且 当前MP ≥ 500`）。这才是光环槽可补、且补完有意义的维度。

### 25.2 敌人数波上限自守（生成 / 组合 / 精炼三处）

新增 `isMeaningfulActiveUnitThreshold(count, waveSize)`（紧跟 `isMeaningfulEnemyHpThreshold`）：
一波怪的**上限**人数（`enemyHp.waveSize = maxSpawnCount`）同时是 N 的硬上界 —— `waveSize ≥ 1` 时
要求 `count ≤ waveSize`；**读不到（0/缺失）时不过滤**（没有证据就不改既有行为，与 §22
「不无据过滤」同口径）。

| 位置                        | 变化                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `damageCandidates` ② 敌人数 | `const waveSize` 提到 ② 之前（②③ 共用同一条上界），② 每条候选过自守 ⇒ 单怪图不再产 `manyEnemies#2/#3`                                                                                                        |
| `debuffCandidates`          | 新增 `debuffWaveSize` 读取 + 同一自守 ⇒ 减益槽不再产「敌人数 ≥ 2」                                                                                                                                           |
| `compositeCandidates`       | 新增 `compositeWaveSize`；`activeUnit(count)` 越界返回 `null` ⇒ `push` 的两腿非空判定**丢弃整条组合候选**（如 `compositeDebuffMultiple`）                                                                    |
| `buildRefinementCandidates` | `manyEnemies` 精炼上界 = `refinementActiveUnitUpperBound(resources)` = `waveSize ≥ 1 ? Math.min(8, waveSize) : 8`，clamp 到 `[2, upper]`；`upper < 2`（单怪图 `waveSize = 1`）时该族没有合法邻域，整族不产出 |

对照：③「波内进度」族（`deadUnits*`）此前就是「`waveSize < 2` 整族不生成」（`refinementWaveSize`），
本轮只补 ② —— 两者的差别是：③ 是「不产」，② 此前是「产了但恒假」。

**为什么不动 `number_of_active_units` 的另一个方向**：`is_inactive`（= 0）在开波后恒假、在开波
瞬间恒真 ⇒ 与「立即释放（`[]`）」行为等价，没有独立价值；本轮不新增该族。

### 25.3 光环守卫维度（`compositeBuffRefreshGuard` 进 AURA 分支）

五个光环类技能的 `defaultCombatTriggers` 实测（`sanitizeTriggerList(getDefaultTriggerDtosForHrid(...))`）：

| 技能                 | 默认触发器                                |
| -------------------- | ----------------------------------------- |
| `mystic_aura`        | `self + mystic_aura + is_inactive`        |
| `guardian_aura`      | `self + guardian_aura + is_inactive`      |
| `elemental_affinity` | `self + elemental_affinity + is_inactive` |
| `fierce_aura`        | `self + fierce_aura + is_inactive`        |
| `speed_aura`         | `self + speed_aura + is_inactive`         |

⇒ 「光环未生效时释放」这一类单条件候选**没有信息量**，`auraCandidates` 因此保持返回 `[]`
（本轮只补注释说明原因），AURA 槽的候选空间由 `compositeCandidates` 的 AURA 分支承担：
`compositeAuraRefreshAllyLowHp`（队友残血）、`compositeBuffRefreshLowHp`（自身残血）之外，
本轮补第三条 —— 与 BUFF 角色的同名组合对齐：

```js
push(buff, mpGuard?.trigger, TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffRefreshGuard, guardParams);
```

- **复用既有标签键**（`compositeBuffRefreshGuard`）：无新 i18n 键、无新渲染路径，zh/en 与 BUFF
  角色分支逐字相同（`增益失效且蓝量充足` / `Buff inactive and enough MP`）。
- **蓝量腿**来自 `buildManaGuard`：`compositeMpPercent[0] = 30` + `Math.ceil` 取整 ⇒ 实测
  `maxMp ≈ 1678` 的角色上屏为 `当前MP ≥ 504`（同页单条件「法力 ≥ 30%」用 `Math.round` 得 503，
  两条取整口径各自与既有生成器一致）。
- 资源缺失（读不到 `maxMp`）时该条不产，但 `compositeAuraRefreshAllyLowHp`（不需要绝对值）仍在
  —— 与既有的「不硬凑」口径一致。

### 25.4 候选表实测（页面内 import 生产模块）

单怪区域 `/actions/combat/vampire`（`enemyHp = {min 2200, max 2200, group 2200, waveSize 1}`）：

| 槽                                    | 候选数   | 变化                                                                                                                                                                             |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输出槽（`firestorm` / `flame_blast`） | 各 16 条 | **无** `manyEnemies`、**无** `deadUnits*`；保留 `debuffWindow`、`buffWindow`×2、`compositeBuffWindowGroupHp@550`、`enemyGroupHp@550/1100`、`enemyTargetHp@1100`、`executeHp@660` |
| 减益槽（`fracturing_impact`）         | 7 → 4 条 | 只剩 `default / alwaysFire / debuffInactive / compositeDebuffRefreshGuard`；`compositeDebuffMultiple`、`manyEnemies#2/#3` 消失                                                   |
| 光环槽（`mystic_aura`）               | 6 条     | `default / current / alwaysFire / compositeAuraRefreshAllyLowHp / compositeBuffRefreshLowHp / **compositeBuffRefreshGuard（本轮新增）**`                                         |

多怪区域回归（`/actions/combat/jungle_planet`，`enemyHp = {min 500, max 4400, group 3200, waveSize 4}`）：

- 输出槽仍是 **20 条**且含 `manyEnemies#2/#3`、`deadUnitsAtMost#0`、`deadUnitsAtLeast#1/#2`、
  `compositeManyEnemiesGuard#2` —— 逐条与 §22 记录相同；
- 减益槽仍 7 条、光环槽 6 条（含新组合）。

⇒ 自守只对 `waveSize < 2` 生效，多怪图的候选表**逐条不变**。

### 25.5 测试

`triggerOptimizerCandidates.test.js` 新增 describe「§25 敌人数波上限自守与光环守卫维度」5 条：

1. **单怪图不产「敌人数 ≥2/3」**：`waveSize` 4/3 → `[2,3]`、2 → `[2]`、1 → `[]`、读不到 → `[2,3]`
   （无据不过滤）；
2. **组合候选的敌人数腿被挡**：`waveSize 1` 无 `compositeDebuffMultiple` 但有 `debuffInactive`；
   `waveSize 4` 两者都在；
3. **「敌人数」精炼上界**：`waveSize 4` → `[2,4]`、3 → `[2]`、1 → `[]`、无资源 → `[2,4]`；
4. **光环补偿组合**：`compositeBuffRefreshGuard` 三件套 = `self + guardian_aura + is_inactive`、
   蓝量腿 `current_mp ≥ 150`、`labelParams.mpPercent === 30`、过 `sanitizeTriggerList`；
   `{}` 资源时该条不产但 `compositeAuraRefreshAllyLowHp` 仍在；
5. **光环单条件仍为空**：先用 `sanitizeTriggerList(getDefaultTriggerDtosForHrid(GUARDIAN_AURA))`
   断言默认触发器就是那条 `is_inactive`，再断言单条件候选为空（行为等价去重的口径钉住）。

全量：**177 文件 / 2496 用例全绿**（+5），prettier 干净。

### 25.6 真实链路验收（页面 → store → 真实 worker，单怪区域）

夹具同 §20.4（丛林 5 技能），区域换成单怪区域 `/actions/combat/vampire`（tier 0），缩时档
`candidateLimit 20 / maxRounds 1 / rounds 2 / simulationHours 1`：

- **58 条候选签名**（5 槽：光环 6 / 元素增幅 6 / 三个输出槽 17 / 15 / 14）全部走真实 worker，
  页面候选表渲染 58 行；**46.6 s** 完成（`results.createdAt` − 启动时刻），控制台零 warning/error；
- 光环槽新条目实测「增益失效且蓝量充足（我的 元素光环 未生效; 我的 当前MP ≥ 504）」= **0**
  （配对差 +0 ± +0）—— 该夹具的蓝量从不跌破 30%，守卫**不 binding**，与「不加守卫」逐场同分；
  这正是自守候选的正常形态：可证伪、可评估，本图无收益；
- 同轮回归：`火焰风暴` 槽 `敌方总生命 ≥ 1,100` = **+0.1081**（与 §24 同值），精炼邻域
  880 = **−0.0839**、1,320 = **−0.2792** 也在表内 ⇒ 本轮改动没有扰动既有链路与精炼行为；
- UI 截图核对：光环槽 6 条候选标签正常渲染，新条显示「增益失效且蓝量充足」+ 触发器摘要
  「我的 元素光环 未生效; 我的 当前MP >= 504」，与 BUFF 角色的同名标签逐字一致。

### 25.7 已知边界与后续

- 「已死怪数」族在单怪图**本就整族不生成**（`waveSize < 2`），与 `manyEnemies` 的自守同向；
  本轮只补了后者（前者是「不产」，后者此前是「产了但恒假」）。
- `number_of_active_units` 的 `is_inactive` 方向未生成候选：开波后恒假、开波瞬间恒真 ⇒
  等价于「立即释放」，没有独立价值（25.2 末段）。
- 候选上限仍 20：带 1 个减益来源的阵容会按价值顺序丢掉 `lowHp`×2（已知、有意，§23.4）。
- **方向 D（队伍尺度条件）**：单人载荷下是弱耦合，需要先定口径与资源来源；等有明确目标场景再做。
- 备查（本轮未做）：候选表截断透明化（UI 明示「本槽另有 N 条未评估」）、组合候选的单条邻域精炼
  （`compositeBuffWindowGroupHp` 实测 +0.0919 曾接近被采纳，内部阈值目前不可调）、racing
  （不提高结论强度上限）。

---

## 26. 结果展示改版：卡片式对比 + 每技能详情弹窗 + 结果说明弹窗（2026-09-22，未提交）

需求原文（轮次 A）：「优化模拟结果展示界面，采用卡片式布局。针对每个技能，分别展示用户原始配置与模拟得出的
最优配置。每张卡片应提供详情入口，点击后可查看该技能的其它模拟结果与相关数据，要求界面清晰、易于对比。」
需求原文（轮次 B）：「这下面的注释内容太多了，用户一般也不会看，也做成弹窗或者其它的查看方式」
（见 26.10）。
需求原文（轮次 C）：「模拟最优配置信息看起来不显眼，高亮会不会好点」＋「详情里面应该按分数降序排序，
当前配置和最优配置也要用不同的颜色高亮」（见 26.11）。
需求原文（轮次 D）：「模拟最优配置左侧不要那个厚边框」＋「搜索设置能不能和锁定不优化卡片融合到一起，
并且下面那一大段内容也放到弹窗里面去」（见 26.12）。

改版前：结果区把每个技能的**整张候选表摊在页面上**（每技能一个 `article` + 全量候选行），5 个技能
= 上百行；而「当前配置长什么样、会被改成什么」这两件最重要的事，反而要读者自己从候选表里挑行拼出来。

### 26.1 卡片结构（`src/ui/pages/TriggerOptimizerPage.vue`）

每个技能一张卡片（`lg:grid-cols-2`），三块：

1. **头部**：技能名 · 角色 · 槽位 · 已锁定 + 结论徽章（推荐 / 保持当前配置 / 复验判负不予推荐 +
   噪声地板、深挖证据标签）—— 判据与改版前逐条相同，只是搬了位置；
2. **配置对比**：左「当前配置（搜索起点）」、右「模拟最优配置」（带候选标签）；改动过的条目带圆点、
   未改动的淡出；两侧一致时标「与当前配置相同」；
3. **页脚**：「查看 N 个候选的模拟结果与指标明细」+「详情」按钮
   （`data-trigger-optimizer-details-open="<slotIndex>"`）。

### 26.2 两侧数据的来源口径（`src/ui/components/triggerOptimizerText.js`）

| 侧                   | 来源                                                  | 说明                                                                        |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| 当前配置（搜索起点） | 候选表里的「当前配置」锚点候选（`candidate.current`） | 生成器在用户配置非空时必然产出，且锚点排在最前、`candidateLimit` 截断切不到 |
| 模拟最优配置         | 报告终态 `results.bestTriggerMap[hrid]`               | 键不存在 = 删键 = 游戏默认触发器                                            |

**两侧都不读玩家当前的 `triggerMap`**：应用结果后那份配置已经被改写成最优配置，拿它当「原始配置」
会让对比的两边同时变成新配置 —— 这张卡片最重要的信息就此消失。

**「游戏默认触发器」按真实条目展开**（`configLineTexts`）：报告里的 `null` 表示删键（回落默认）。
第一版只渲染一句「游戏默认触发器」，浏览器实测立刻抓到两处问题 —— ① 用户没法与对侧逐条对照；
② 用户配置**恰好等价于游戏默认**时（`fireball` 夹具实测：`targeted_enemy/current_hp ≥ 1` 正是默认），
生成器按行为等价去重会丢掉「当前配置」锚点 ⇒ 左侧退化成一句话、右侧是那条真触发器、
`configUnchanged` 判否 ⇒ 渲染成一次**假改动**（同屏却挂着「保持当前配置」）。现在两侧都展开成
`getDefaultTriggerDtosForHrid(hrid)` 的真实条目，改动标记与「与当前配置相同」共用同一套行文本口径
（`configLines` / `configsMatch`），不会再自相矛盾。

### 26.3 详情弹窗（`src/ui/components/TriggerOptimizerAbilityDetails.vue`，BaseModal）

点「详情」打开，按**槽位**记账（`detailsSlotIndex`；不存 choice 对象：新一轮结果替换后对象身份会变，
存对象会让弹窗停在旧报告上）：

1. 状态行：槽位 · 已锁定 · 推荐/保持当前配置 · 得分 · 配对信号 · 已采纳；
2. 配置对比（与卡片同一套口径，完整渲染）；
3. **指标明细**：`基线 / 最优 / 差值`（五项指标，含每小时死亡）；
4. **候选评估结果**：全量候选的得分 + 配对信号（含「本槽最优」「已采纳」标记与精修邻域条目）；
5. **深挖复核记录**（`deepDives` 中属于本槽的那条）与**跨槽联合采纳记录**（`jointAdoptions` 中涉及
   本槽的条目）。

### 26.4 两处口径取舍（都是浏览器实测逼出来的）

- **指标明细只在「本槽被采纳」时渲染**。候选指标是「评估该候选时整体配置」的指标 —— 报告里只有
  **分数**的配对统计（`computePairedStats` 只产出 score 的 mean/SE/t/p），没有逐指标的配对差，
  所以「候选 vs 搜索起点」的差值必然包含其它技能当时已采纳的改动。夹具实测：火球槽**没被采纳**，
  表里却写着 DPS +1.5%（那是同轮 `flame_blast` 被采纳的功劳）。现在未采纳的槽不摆这张表（候选表仍
  完整给出「为什么没采纳」），表标题与说明也改成「本槽采纳时的整体配置 …… 差值是累计口径，不是
  本槽的净效应」。
- **「已采纳」标记与推荐徽章同源**：都用 `results.adoptedSlots`（`chosen` 会保留未被采纳的槽内最优，
  只看 `chosen` 会给没采纳的槽挂「推荐」，与同屏「已优化 0 / N」自相矛盾 —— §19 既有口径）。

### 26.5 共享模块 `src/ui/components/triggerOptimizerText.js`

卡片与弹窗要渲染同一批东西（触发器行、候选标签、指标数值、信号配色），两处各写一份必然漂移
（同一候选在卡片上叫「生命 ≤ 75%」、在弹窗里叫别的）。模块导出：

- 报告取值：`resolveOriginalTriggers(choice)`、`resolveBestTriggers(bestTriggerMap, hrid, fallback)`；
- 纯函数配色：`triggerVerdictTextClass` / `triggerVerdictBadgeClass` / `triggerMetricDeltaClass`；
- 工厂 `createTriggerOptimizerText({ t, number, getOfficialGameText })` → `signed` /
  `formatCompactKmb` / `formatMetricValue` / `signedCompact` / `formatTriggerLine` / `triggerSummary` /
  `candidateLabel` / `configLineTexts` / `configLines` / `configsMatch`。

页面与弹窗各自用自己的 composable 建一份实例（依赖注入，而不是在模块里 import composable：纯函数
集合能被单测直接驱动，也不绑定 Vue 生命周期）。页面因此删掉了 8 个重复 helper。

### 26.6 i18n

新增（zh/en 同步，`i18nResources.test.js` 的键集合断言覆盖）：`slotLabel` / `originalConfig` /
`bestConfig` / `sameAsCurrent` / `details` / `detailsTitle` / `candidateDetails` /
`candidateMetricsTitle` / `candidateMetricsHint` / `metricColumn` / `deltaColumn` / `deepDiveTitle` /
`deepDiveRounds` / `jointAdoptionTitle` / `jointSlots` / `jointMarginalMean` / `adoptedChip` /
`detailsHint`。含 `{{ }}` 的键一律不给 fallback（模板内 `t()` fallback 不得含双花括号，见既有坑）。
轮次 B（26.10）追加说明弹窗的键：`notesTitle` / `notesEntry` / `noteScoreScale` / `noteDetectionFloor` /
`noteApplyScope` / `noteMetricSource` / `noteRoundLimit` / `noteDeepDive` / `noteJointAdoption`。
轮次 C（26.11）追加 `candidateSortHint`（候选表按得分降序的标注）。
轮次 D（26.12）追加 `settingsNotesTitle` / `settingsNotesEntry` / `noteSearchLoop` / `noteOptimizeScope` /
`notePairing`（搜索设置说明弹窗的标题、入口与三条标签）。

### 26.7 测试

`TriggerOptimizerPage.template.test.js`：BaseModal 用内联 stub（同 `FoodOptimizerPage.test.js`），
新增 `openDetails(wrapper, slotIndex)` 辅助函数；原有候选表断言（3 行、本槽最优、配对差 ± 标准误、
组合候选按「槽位 + 签名」读分、`-0.05` 只出现在 `1|default`）改为**先点开详情再断言**；新增 2 条：

1. 卡片对比：两侧文本、改动圆点数量、`与当前配置相同`、未采纳时不挂候选标签；
2. 详情弹窗：标题带技能名、槽位/已采纳标记、两侧配置、候选行数、指标明细、深挖与联合采纳记录、
   未采纳时指标明细消失、关闭后内容消失。

全量（轮次 A 结束时）：**177 文件 / 2498 用例全绿**（+2），prettier 干净，`vite build` 通过；
轮次 B 又 +1 条（见 26.10），现为 **177 文件 / 2499 用例**。

### 26.8 浏览器实测（dev 5181 + 内嵌浏览器 + 真实 worker，2026-09-22）

夹具 `modernPlayerJunglePlanetFixture.json`（5 技能，已手工调过），`/actions/combat/jungle_planet`
tier0，4 小时 + 快速档（6/1/5）：**69 次评估、约 124 s**（三次同配置实测同量级），采纳 1 槽
（`flame_blast` 敌方总生命 ≥ 800，+0.0225），复验 **positive**；页面 5 张卡片（1 张「推荐」+
4 张「保持当前配置」，其中 2 张标「与当前配置相同」），控制台零 error。逐项核对：

- 熔岩爆裂卡：左 2 行（2 个改动圆点）、右 1 行（1 个圆点）+ 候选标签「敌方总生命 ≥ 800」，
  徽章「推荐 · 得分 0.0225 · 不显著 · 已过噪声地板」；
- 火球卡：左「游戏默认触发器」+ `目标敌人的 当前HP >= 1`、右同一行 +「与当前配置相同」、零圆点
  （26.2 的假改动已修）；
- 详情弹窗（熔岩爆裂）：8 条候选（含精修邻域 ≥ 1,600 / ≥ 480 / ≥ 1,120，其中 1,120 得分 +0.023
  显著提升）、指标明细 5 行、`本槽最优`/`已采纳` 标记齐全；
- 未采纳槽（火球）的详情：**无**指标明细，候选表 6 行（默认 −0.0717 / 当前 0 / 立即释放 −0.1522 …）。

**方法备忘**：dev server（Vite）对**不在模块图里的文件写入**（`docs/*.md`、`locales/*.json`）也会整页
重载 —— 浏览器实测运行期间不要写任何项目文件，否则在途运行与 store 里未持久化的结果被清空
（本轮踩到两次，其中一次丢掉 124 s 的运行结果，只能重跑）。深挖/联合采纳区块本轮实测未触发
（`deepDives` 为空），由模板测试覆盖。

### 26.9 已知边界

- 详情弹窗的指标明细是**累计口径**（见 26.4），不是本槽净效应。原文写「要做到净效应需要报告侧新增
  『逐指标配对差』（`computePairedStats` 目前只算分数）」—— **2026-09-23 更正：这条前提不成立**
  （`triggerOptimizerScoring.js` 里 `computePairedStats` 一直产出逐指标统计），本槽净效应已按既有数据
  上屏（§27），累计表保留为「跑完全程」的对照。
- 卡片的「改动圆点」是**行文本集合差**：两条触发器互换顺序不标改动 —— 有意为之（顺序在引擎里无意义）。
- 候选表截断透明化（「本槽另有 N 条未评估」）仍未做，与 §25.7 同一项遗留。

### 26.10 说明性文案收进弹窗（2026-09-22，轮次 B）

**动因（用户反馈 + 截图）**：结果区在结论卡 / 得分卡 / 指标卡下面平铺着 5 段解释性长文（复验口径、
跨槽联合采纳、轮数上限、可确认下限、得分尺度、应用范围），一屏读不完，用户一般也不会读 —— 还把结论
与数字挤出了视野。要求「做成弹窗或其它查看方式」。

**做法**：整条搬进「查看说明」弹窗，结果区只留结论、数字与逐技能卡片。

1. 新组件 `src/ui/components/TriggerOptimizerNotes.vue`（`BaseModal`，`panel-class="max-w-2xl"`）：
   props `open` / `notes`（`[{ key, labelKey, text, extra? }]`）/ `titleKey`（默认结果说明标题）/
   `scope`（`result` | `settings`，只用于区分 DOM 归属，见 26.12）；emit `close`；渲染成 `<dl>`，
   每项 `data-trigger-optimizer-note="<key>"`（容器 `data-trigger-optimizer-notes="<scope>"`，标题
   `notesTitle`）。**弹窗不判断口径**，条目由页面组装。
2. 页面入口：结果区标题旁 `Button variant="ghost"`（`data-trigger-optimizer-notes-open`，图标 `Info`）
   —— 与「撤销 / 应用」同一条 header，标题 flex 容器因此拆成两个子 div。
3. `resultNotes`（页面 computed）按**本次报告是否适用**组装，顺序＝一段连贯说明：`verification` →
   `detectionFloor`（有下限才有，`extra` = 提到 10 轮的投影）→ `roundLimit`（跑满上限才有）→
   `scoreScale` → `metricSource` → `deepDive`（`deepDives` 非空才有）→ `jointAdoption`（非空才有）→
   `applyScope`。不适用就不出现（**不留空条目**）。
4. 搬走的模板段落与键（这批键仍在用，只是换了位置）：结论卡内的 `verdictDescription` 段、
   `noImprovement` 段（`-no-improvement`）、`evidenceBlocked` 段（`-evidence-blocked`）、
   `deepDiveSummary`（`-deep-dive`）、`jointAdoptionSummary`（`-joint-adoption`）、
   `roundLimitReached`（`-round-limit`）、`detectionFloorNote`（`-detection-floor`）与
   `detectionFloorProjection`（`-detection-floor-projection`）；得分卡内的 `scoreScaleHint`；
   结果区末尾的 `applyHint`。
5. **留在页面上的**：指标卡上方的 `metricSourceKey` 一行短标签（`-metric-source`）。数字的来源必须
   紧贴数字（复验判负时这里从「搜索期估算」切到「复验实测」，见 26.4 的口径取舍），弹窗里再用
   `metricSource` 条目复述一遍，让弹窗自成一份完整口径。同理留在卡片上的还有页脚两行短提示
   （`-disabled-hint` 立即释放、`-and-hint` 组合候选「与」）——它们解释的是**同一张卡上刚出现的
   候选标签**，搬走会让卡片自相矛盾。
6. `verdictDescription` computed 无引用（改版后模板不再用它），改造成 `verificationNoteText`：
   分支口径与旧模板**逐字一致**——`noImprovement` / `evidenceBlocked` / `missing` / 其余，前两者是
   两件事（「搜遍了」vs「样本不够没敢采纳」，出路不同），必须分开说。
7. i18n 追加 4 个标签键：`noteMetricSource` / `noteDeepDive` / `noteJointAdoption` / `noteRoundLimit`
   （zh/en 同步）；条目正文复用既有键（`verificationHint`、`scoreScaleHint`、`detectionFloor*`、
   `deepDiveNote`、`jointAdoptionNote`、`roundLimitReached`、`applyHint`、`metricSource*`），零改动 ——
   搬位置不改文案，是这次改版刻意保住的性质。

**测试**（`TriggerOptimizerPage.template.test.js`）：新增 `openNotes` / `closeNotes` /
`noteEntry(wrapper, key)` 辅助函数；6 条原有断言从「页面上的段落」改为「点开弹窗后的同一条」
（nothing-improves、evidenceBlocked vs noImprovement、roundLimit、detectionFloor ± 投影、
jointAdoption、deepDive），其中 evidenceBlocked 一条补了**对照组**（`evidenceBlocked=false` 时同一条
改口成「保持现有配置即可」）；新增 1 条专测弹窗：常驻 4 条、长段落**不在**
`[data-trigger-optimizer-results]` 文本里、不适用时不给空条目、关闭后消失。全量 **177 文件 / 2499 用例
全绿**（+1），prettier 干净，`vite build` 通过，`check-dead-keys` 无死键。

**浏览器实测（同夹具同设置重跑）**：`modernPlayerJunglePlanetFixture.json` / `jungle_planet` tier0 /
4 小时 + 快速档（6/1/5），约 100 s 完成，结果与前一轮同量级（已优化 1 / 5，`flame_blast` +0.0225，
复验 positive p=0.014）。逐项核对：

- 结果区文本长度 **1,062 字符**（此前同屏含 5 段长文）：只剩标题 +「查看说明」+ 撤销/应用、结论卡
  （已优化技能 / 独立复验 / p 值）、得分卡（大字 + 发散条 + 基线→最优）、指标口径短标签、5 张指标卡、
  5 张技能卡、页脚两行短提示；
- 点「查看说明」→ 6 条：`verification` / `detectionFloor`（含「提到 10 轮 ≈ ±0.0117」第二行）/
  `roundLimit` / `scoreScale` / `metricSource`（复验实测）/ `applyScope`，**无空条目**；本轮无深挖、
  无联合采纳 → 这两条不出现（与 26.10-3 的适用性口径一致）；
- 详情弹窗（熔岩爆裂，槽位 4）：8 条候选 + 指标明细 5 行 + 已采纳标记仍正常；两个弹窗状态互不干扰；
- 控制台**零 error、零 warning**。

**已知边界**：弹窗是「一次性说明书」——**不记住**上次位置、不跟随报告更新自动关闭（结果换新后条目按新
报告重算，用户点开看到的就是当前这一份）；`notes` 为空数组时弹窗仍可打开（只是空内容），当前不会发生
（至少恒有 `verification` / `scoreScale` / `metricSource` / `applyScope` 四条）。

### 26.11 两侧配色 + 候选按分数降序（2026-09-22，轮次 C）

**动因（用户反馈）**：「模拟最优配置信息看起来不显眼，高亮会不会好点」＋「详情里面应该按分数降序排序，
当前配置和最优配置也要用不同的颜色高亮」。

1. **两侧不同颜色高亮**（卡片与详情弹窗共用，`triggerOptimizerText.js`）：
   - 当前配置（搜索起点）= `TRIGGER_ORIGINAL_PANEL_CLASS = 'border-info/40 bg-info/10'`（info 冷蓝 ——
     「你现在是什么样」），标题 `text-info`；
   - 模拟最优配置 = `triggerBestPanelClass(changed)`（primary 主色 —— 「会变成什么样」），标题
     `text-primary`：真改了 → `border-primary/60 bg-primary/20`；与当前相同 → `border-primary/40
bg-primary/10`（初版还带一条左侧竖条，已于 26.12 按用户要求删除）。
2. **档位取舍**：两档**都不弱于左侧**（最优侧是这张卡的主角，这就是「不显眼」的修复），但仍分两档是因为
   一轮 5 个技能通常只有 1 个被采纳 —— 把「与当前配置相同」也照最亮的方式高亮，会把真正的改动淹没在
   整屏高亮里。改动过的候选标签也升级成主色 chip（`bg-primary/15 text-primary`），与提交按钮同一套语言。
   第一版给「改了」的那一档额外加了左侧竖条，**用户看后要求去掉**（26.12-3）→ 分档改为只靠底色，
   并把改动档从 `bg-primary/15` 提到 `/20`，免得去掉竖条后两档看不出差别。
3. **候选表按得分降序**（详情弹窗 `sortedCandidates`）：读这张表的目的是「哪个候选更好」，按报告顺序
   平铺还要读者自己找最大值。报告里**没有分数记录**的候选垫底（`—` 不能与「0 分」混为一谈）；同分保持
   报告原顺序（`sort` 稳定）—— 同分时先出现的通常是锚点（当前配置 / 游戏默认），这个顺序有信息。
   表头旁加 `candidateSortHint`（按得分降序 / sorted by score, highest first），免得被读成生成顺序。
   胜出行的底色从 `bg-primary/5` 提到 `/10`，与新配色强度对齐。
4. **实测观察（顺带把一件事实显式化）**：本轮 jungle_planet 快速档实测里，排序后**第一行不是被采纳的
   那一行** —— 精修邻域 `≥ 1,120` 得 0.023（显著提升）> 已采纳的 `≥ 800` 得 0.0225。原因是这条搜索
   「跑满了轮数上限」（精修邻域在最后一轮采纳之后才评估，预算已用尽，见说明弹窗的「搜索轮数上限」
   条目）。排序把「表里还有更好的候选没被采纳」摆到了第一行 —— 这是诚实的方向，也是排序本身的收益。
5. **测试**：3 处「改动圆点」断言从数 `.bg-primary` 改为 `data-trigger-optimizer-line-changed`
   （样式重构不再误伤）；卡片对比用例补两侧配色、降档、竖条有无的断言；新增「候选按分数降序（无分数
   垫底）」用例；详情弹窗用例补两侧配色与表头口径断言。全量 **177 文件 / 2500 用例全绿**，prettier 干净，
   `vite build` 通过，`check-dead-keys` 无死键。
6. **浏览器实测**（同夹具同设置，两次重跑各约 105–110 s）：5 张卡片档位正确（1 张 `border-primary/60`
   ＋竖条、4 张 `border-primary/40` 无竖条，左侧一律 `border-info/40`）；熔岩爆裂详情弹窗 8 条候选
   严格降序 `0.023 → 0.0225（本槽最优·已采纳）→ 0.0155 → 0 → −0.0004 → −0.0717 → −0.1521 → −0.2405`，
   表头显示「候选评估结果（8 个） 按得分降序」；控制台零 error、零 warning。

### 26.12 设置区合并 + 其说明也进弹窗（2026-09-22，轮次 D）

**动因（用户反馈）**：「模拟最优配置左侧不要那个厚边框」＋「搜索设置能不能和锁定不优化卡片融合到一起，
并且下面那一大段内容也放到弹窗里面去」。

1. **设置卡片合并**：「锁定不优化」（原独立 `<section data-trigger-optimizer-locks>`）与「搜索设置」
   合成**一张卡片**（`data-trigger-optimizer-settings-card`，`rounded-lg border bg-muted/20 p-4`）：
   卡片头 = 标题 + 「ⓘ 参数说明」入口；第二行 = 锁定不优化（标签 + 技能 chip，`v-if="abilitySlots.length"`）；
   第三行（`border-t` 分隔）= 参数控件（搜索强度 / 重复次数 / 利润权重 / 经验权重 / 死亡安全权重 /
   模拟时长 / 高级设置）。两块调的是同一件事（这一轮搜什么），拆成两处只会让人来回找。
2. **8 段解释收进「参数说明」弹窗**（`settingsNotes`，与结果说明**共用组件**）：
   `lock`（锁定不优化）/ `preset`（搜索强度）/ `rounds`（重复次数）/ `weights`（死亡安全权重）/
   `searchLoop`（搜索过程，新键）/ `hours`（模拟时长（小时））/ `scope`（优化范围，新键）/
   `pairing`（配对比较，新键）。全量常驻，只有 `lock` 跟着锁定行走（没有可锁技能时讲锁定是空话）。
   `presetHint` 是插值文案（当前档位的三个数值），`settingsNotes` 直接读 `presetHintParams` ——
   换档位时弹窗里跟着变（用 `presetHintParams` 里已有的 `preset` 文案，不再另写一份）。
3. **组件泛化 + 改名**：`TriggerOptimizerResultNotes.vue` → **`TriggerOptimizerNotes.vue`**，新增
   `titleKey`（两份弹窗各自的标题）与 `scope`（`result` | `settings`）props，容器属性随之变成
   `data-trigger-optimizer-notes="<scope>"` —— 两份弹窗同屏可开时 DOM 仍有唯一归属，测试也能分别断言。
4. **左侧竖条删除**（用户要求）：卡片与详情弹窗的「模拟最优配置」面板都不再有 `w-1 bg-primary/70`
   竖条（`data-trigger-optimizer-best-accent` / `...-details-config-accent` 一并移除）；改动档底色
   从 `bg-primary/15` 提到 `/20` 作为补偿，两档（改了 / 与当前相同）仍然一眼可分。
5. **测试**：新增 `openSettingsNotes(wrapper)` / `notesDialog(wrapper, scope)` 辅助函数；原来断言
   `[data-trigger-optimizer-notes]` 的地方改为按 scope 精确匹配；新增用例「合并设置卡片 + 8 段解释
   进弹窗」（同卡片内既有锁定行又有参数控件、卡片 text 不含 4 类长文案、弹窗 8 条、标题为「搜索设置说明」、
   换档位后 `preset` 条跟着变）；档位用例里的 `当前「精细」` 断言改为检查留在页面上的
   `-strength-summary`（长解释由新用例覆盖）；复验用例补一条「设置卡片上不再有『公共随机数』，
   它现在在参数说明弹窗里」。全量 **177 文件 / 2501 用例全绿**（+1），prettier 干净，`vite build` 通过，
   `check-dead-keys` 无死键。
6. **浏览器实测**（dev 5181 + 夹具 jungle_planet tier0 / 4h / 快速档，真实 worker 重跑约 110 s）：
   合并卡片渲染为「标题 + 参数说明 + 锁定不优化（5 个 chip）+ 参数控件 + 高级设置」，卡片内
   **零长文案**；「参数说明」弹窗 8 条齐全（锁定不优化 / 搜索强度 / 重复次数 / 死亡安全权重 / 搜索过程 /
   模拟时长（小时）/ 优化范围 / 配对比较）；结果区 5 张卡片 `accents = 0`（竖条已彻底移除），
   改动槽为 `border-primary/60 bg-primary/20`、其余 `border-primary/40 bg-primary/10`，左侧一律
   `border-info/40 bg-info/10`；控制台零 error、零 warning。

---

## 27. 详情弹窗补「本槽净效应（配对差）」：把已存在的数据接上屏（2026-09-23，未提交）

起因：用户问「技能优化功能，还能怎么改进吗」。本轮先做代码审计（对照 §16–§26 的既有结论），
第一条发现就是 §26.4/§26.9 记下的那条「已知边界」**前提已经过时**：

> 详情弹窗的指标明细是累计口径……要做到净效应需要报告侧新增「逐指标配对差」
> （`computePairedStats` 目前只算分数）。

事实（本轮逐处核对）：`triggerOptimizerScoring.js` 的
`PAIRED_METRIC_KEYS = [...TRIGGER_OPTIMIZER_METRIC_KEYS, 'deathsPerHour']`，`computePairedStats`
**对每个指标**都产出 mean / stdError / t / pValue / verdict；搜索层每条候选都带 `paired`
（`triggerOptimizerSearch.js:557`），被采纳的 winner 进 `chosenBySlot`（:606），而它的配对参考系是
**本槽开跑时的配置**（:543 的 `reference`）—— `chosen.paired.metrics` 本来就是「本槽净效应」。
缺的不是数据，是上屏。

### 27.1 两张表各回答一个问题（都保留）

| 表                      | 数据                                 | 回答的问题                                       | 渲染判据        |
| ----------------------- | ------------------------------------ | ------------------------------------------------ | --------------- |
| 本槽净效应（新，§27）   | `chosen.paired.metrics[key]`         | 这个技能这一次改动赚了什么（含各项自己的显著性） | 仅 `adopted` 时 |
| 指标明细（累计，§26.4） | `baselineMetrics` → `chosen.metrics` | 整轮跑完相对最初基线共赚了多少（有绝对值可读）   | 同上            |

- 单槽采纳时两表逐项相同（本轮实测 dps 两表都是 `+3.7`，可交叉验证口径）；多槽采纳后**必然分叉**
  —— 累计表含同轮此前已采纳槽的改动，这正是 §26.4 记录的「把别的技能赚到的提升记在它头上」的来源，
  也是这张新表存在的意义。
- 累计表的文案、判据、配色一个字没改（搬位置不改语义）；新表补自己的口径说明，并在文末指向下表。

### 27.2 显著性必须**方向中立**

逐指标 verdict 的 `positive` / `negative` 说的是「比参考大 / 小」，**不是好 / 坏**：死亡**下降**得到
`negative`，而它正是我们要的结果。直接套 `signals.*`（「显著提升」/「显著更差」）会把「死亡显著下降」
渲染成「显著更差」。所以新表第三列只回答「是否超出噪声」：

| 内部口径                     | 上屏（zh / en）                 |
| ---------------------------- | ------------------------------- |
| `positive` / `negative`      | 显著 / Significant              |
| `inconclusive`               | 不显著 / Not significant        |
| 其它（含 `unknown`、缺统计） | 样本不足 / Insufficient samples |

方向交给配对差的符号；该列配色同样中立（显著 = 常规前景色，其余 muted），不借用 success/destructive。
指标列的配色沿用既有的 `triggerMetricDeltaClass`（它对 `deathsPerHour` 已作反向处理）。

### 27.3 边界与回落（都在测试里钉住）

- `stdError: null`（`rounds < 2`，报告确实会这么给）**不能**落入 `Number(null) === 0` —— 那会把
  「无从估计」画成「± 0」这个不存在的确定性。显式判 null → 上屏「± —」。
- `mean` 为 null / 非有限 → 整行不产（不把 null 当 0 上屏）；报告缺 `paired.metrics`（旧报告 /
  异常收尾）→ 整块不渲染，累计表照旧。
- 未采纳的槽不渲染新表（与累计表同一判据：未采纳就没有「本槽改动」）。
- 无新渲染路径：指标名复用 `metrics.*`、差值走既有的 `signedCompact`（一位小数 / 利润与经验 compact
  k-m / 死亡两位小数），只新增 3 个顶层键 + 1 个三态子对象（`netMetricsTitle` / `netMetricsHint` /
  `significanceColumn` / `metricSignificance.{significant,inconclusive,unknown}`）。

### 27.4 测试

- `TriggerOptimizerPage.template.test.js` 新增 1 条：净效应表逐行断言（dps `+1.5 ± +0.4`、
  利润 `+1.2k ± —` 走 stdError-null 回落且显示「样本不足」、死亡 `-0.4` 显示「显著」并断言整块
  **不含**「更差」（方向中立的变异守卫）、经验「不显著」），再断言清空 `adoptedSlots` → 新块消失、
  换回无 `paired` 的报告 → 新块消失而累计表仍在。
- `i18nResources.test.js` 的嵌套键对称循环加入 `metricSignificance`（zh/en 三态必须同名同数）。
- 全量 **177 文件 / 2502 用例**（+1）+ prettier + `vite build` + `check-dead-keys` 全绿。

### 27.5 浏览器实测（dev 5173 + 夹具 + 真实 worker）

夹具 `modernPlayerJunglePlanetFixture`（5 技能）经 `importSoloConfig` 注入玩家 1，
`/actions/combat/jungle_planet` tier0、4 小时 + 快速档（6/1/5）：**35 次评估**，采纳 slot3
（熔岩爆裂 · 敌方总生命 ≥ 800，得分 `0.0224`），打开详情弹窗核对：

- 新表 5 行齐全：每秒伤害 `+3.7 ± +1.4 不显著`、日利润 `+783.1k ± +301.4k`、每小时经验
  `+2.6k ± +974.7`、每小时击杀 `+5.2 ± +1.9`、每小时死亡 `0 ± 0`（rounds = 5，SE 有值，
  与「rounds < 2 才给 ± —」的回落口径互为对照）；
- 累计表逐项相同（本轮只采纳 1 个槽 —— 两表本应一致，正好交叉验证了两张表的同源口径）；
  两侧配色（左 info 冷蓝 / 右 primary 主色）与其它区块未受影响；
- 控制台零 error：唯一一条 warning 来自本轮**审计脚本**里一次失败的 JSON 动态 import
  （`Failed to load module script … MIME type of "application/json"`），与应用代码无关。

### 27.6 已知边界与后续

- 净效应的参考系是**本槽开跑时的配置**，同轮其它槽的改动不在其中；跨槽交互的账在「跨槽联合采纳
  记录」（§19.11）里，两处不要混读。
- 联合采纳的槽，其 `chosen.paired` 仍是**单槽评估时**的那次测量（联合收益记在 `jointAdoptions`），
  因此新表不会把联合收益算到单槽头上。
- 本轮未做（同一批审计里列出的其余项，优先级见对话结论文档）：候选表截断透明化（「本槽另有 N 条
  未评估」，§25.7 遗留）、报告落盘/导出（§26.8 的实测备忘里曾因此丢掉一次 124 s 的运行结果）、
  跨区域稳健性复核、racing（§20.1 路线③）、把净效应拿到卡片上直显。

---

## 28. 候选表截断透明化：报告带上「生成数 / 截断数」（2026-09-23，未提交）

起因：§27 同一次审计里列出的下一项（§25.7 / §26.9 的遗留）。候选表会被「每槽候选上限」
（`candidateLimit`）**静默截断**，而 UI 只显示「候选评估结果（N 个）」——用户读不出这是
「搜索试遍了这一槽的所有可能」还是「只试了上限允许的前 N 条」。§22.3/§23.4 早就量化过这件事的
代价（新候选族挤掉旧候选族、上限 16 → 20 的取舍），但它一直只写在设计文档里，界面上一句话都没有。

### 28.1 服务层：把统计透出来（不改既有契约）

`triggerOptimizerCandidates.js`：

- 新增 `finalizeCandidatesWithStats(ctx, descriptors, existingSignatures)` →
  `{ candidates, generated, limit }`；`generated` = **过上限之前**的条数（已过 sanitize 自查 +
  签名去重），`limit` = 本次生效的上限。既有 `finalizeCandidates` 变成它的薄包装（精炼路径零改动）。
- 新增 `generateAbilityCandidatesDetailed(player, slotIndex, settings)` → 同结构；
  对外契约的 `generateAbilityCandidates` 改为 `…Detailed(…).candidates` —— **返回值语义一个字
  没变**，既有 40+ 处调用与断言不受影响。
- `buildCandidateConfigs` 给每条 choice 补三个字段：`candidateLimit` / `generatedCandidates` /
  `truncatedCandidates = max(0, generated − candidates.length)`，随报告（`perAbilityChoices`）
  一路到 UI（store 只做结构化克隆，不丢字段）。
- 早退路径（空槽 / 非激活槽 / 未知 hrid）返回 `{ candidates: [], generated: 0, limit: 0 }`，
  UI 不需要判 `undefined`。

### 28.2 UI：只在真的截断时说一句

详情弹窗候选表标题下方新增 `data-trigger-optimizer-candidates-truncated`（`truncatedCandidates > 0`
才渲染）：zh「另有 {{count}} 条候选被「每槽候选上限（{{limit}}）」截断，未参与评估——提高该上限
会一并评估它们。」/ en 同义。文案落在最要紧的两件事上：**多少条**没被评估、以及**怎么让它们被评估**。

- 截断数 0（候选表完整）与旧报告（字段缺失）都不渲染 —— 不为「没截断」加噪声；计算属性对
  `Number(undefined) → NaN` 与 `≤ 0` 都已挡掉。
- 提示里读的是**报告字段**，不做二次计算：截断数是生成期的（见 28.4 的口径说明），而候选表在
  搜索过程中还会被精炼候选追加（`choice.candidates.push(...refinements)`），两者本就不该相减。

### 28.3 测试

- `triggerOptimizerCandidates.test.js` 新增 1 条：关键不变式「上限只决定**保留**多少，不改变
  **生成**多少」（`capped.generated === rich.generated`）、数组版与统计版的 candidates 逐条相同、
  `buildCandidateConfigs` 三个字段自洽（`truncated === generated − kept`）、上限装得下的槽截断为 0、
  空槽早退形状。
- `TriggerOptimizerPage.template.test.js` 新增 1 条：夹具的 choice 带
  `candidateLimit: 3 / generatedCandidates: 6 / truncatedCandidates: 3` → 断言「另有 3 条候选」
  与「每槽候选上限（3）」；截断数 0 与字段缺失两种回落都不渲染（候选表本身仍在）。
- i18n 顶层键集合断言（zh/en 对称）自动覆盖新键。
- 全量 **177 文件 / 2504 用例**（+2）+ prettier + `vite build` + `check-dead-keys` 全绿。

### 28.4 浏览器实测（dev 5173 + 夹具 + 真实 worker）

夹具 `modernPlayerJunglePlanetFixture`（5 技能）注入玩家 1，`/actions/combat/jungle_planet` tier0、
4 小时 + 快速档（**candidateLimit = 6**）：**35 次评估**，采纳 slot3（熔岩爆裂 · 敌方总生命 ≥ 800，
得分 `0.0224`），报告里的每槽统计（生产数据，非构造）：

| 槽  | 技能     | 生成 | 保留 | 截断   |
| --- | -------- | ---- | ---- | ------ |
| 0   | 元素光环 | 6    | 6    | 0      |
| 1   | 元素增幅 | 6    | 6    | 0      |
| 2   | 火焰风暴 | 21   | 6    | **15** |
| 3   | 熔岩爆裂 | 21   | 6    | **15** |
| 4   | 火球     | 20   | 6    | **14** |

- 详情弹窗（火焰风暴槽、熔岩爆裂槽）都渲染出：「另有 15 条候选被「每槽候选上限（6）」截断，
  未参与评估——提高该上限会一并评估它们。」光环 / 元素增幅两槽**不显示**该行（截断 0）；
- **口径实测**：熔岩爆裂槽的候选表实际有 **8 行**（6 条网格 + 2 条精炼邻域），而上限是 6 ——
  截断数仍是生成期的 15；UI 读报告字段而非相减，两者不冲突（这条正是 28.2 第二条要钉住的行为）；
- 控制台**零 error、零 warning**；详情弹窗的另两张表（§27 净效应 / 累计）同屏正常。

### 28.5 已知边界与后续

- `truncatedCandidates` 只统计**被上限截掉**的候选，不含被「行为等价去重」（与游戏默认等价）
  丢掉的条目 —— 那是去重，不是截断，两者混在一起会让这个数字失去意义。
- 提示只在详情弹窗里出现（候选表所在处）；卡片页脚仍是「查看 N 个候选…」——是否把同一句话也
  带到卡片上，等有人真的因此误读再说（§26 的教训：卡片上多一句话就少一眼注意力）。
- 未做（同一批审计里剩下的）：报告落盘/导出、跨区域稳健性复核、racing（§20.1 路线③）、
  敌方「最残血」多目标门（`all_enemies + lowest_hp_percentage`）、组合候选单条阈值精炼。

## §29 跨难度稳健性复核 + 结论适用范围标注（2026-09-23）

**一句话**：触发器写的是**全局技能配置**，而搜索只在「一个区域 + 一个难度」上评估过 —— 报告现在
自证适用范围（区域 / 难度 / 时长），并提供一个「换到相邻难度再测一次」的入口：把「最优配置 vs
搜索起点配置」搬到那个难度上，用独立盐的新样本做配对评估（固定 2 次评估 × 6 场），回答
「这笔提升是不是只属于原难度」。

### 29.1 为什么做这一条

- **触发器的作用域是全局的**：`applyTriggerOptimizerResult` 直接写 `activePlayer.triggerMap`，
  这套配置随后**在所有区域/难度上生效**；而搜索只在单目标上评估（设计 §4.2 的 runScope=single 校验）。
- **区域之间的噪声差 20 倍**（§19.5 实测：SE fly 0.0011 / 丛林 0.0083 / 熊 0.0382）：同一个「+0.02 分」
  在丛林是超过噪声地板的提升，在熊图可能完全落在噪声里。结论的**适用范围**因此必须写出来，
  而不是默认「搜过一次就等于在所有地方都成立」。
- 顺带修掉一个**前提缺口**：报告此前既没有「搜索起点配置」，也没有「当时跑的是哪个目标」——
  `workingConfig` 是克隆体、`bestTriggerMap` 原地改写，报告里没有任何字段能复原改动前的样子；
  要拿当前首页设置去猜「当时是什么难度」更是不可靠（用户随时会改）。

### 29.2 报告补两个前提（搜索层）

`optimizeTriggers` 的报告新增两个字段（`createEmptyResult()` 同步补骨架与注释）：

| 字段                 | 语义                                                                                                                        | 来源                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `baselineTriggerMap` | **搜索起点配置**（换难度复核的对照侧）；键缺失 = 该技能用游戏默认触发器                                                     | `finally` 里对入参 `playerConfig.triggerMap` 取 `deepClone` 快照 |
| `evaluationScope`    | `{ zoneHrid, useDungeon, difficultyTier, simulationHours }`：真正被评估的目标（`useDungeon` 已解析成实际 hrid）、难度、时长 | 由 `simulationSettings` 直接算出                                 |

- 快照语义是**深拷贝**：报告不与调用方共享引用（调用方之后复用同一对象也不会串改报告）；
  与 `adoptedSlots` 同理，属于「报告对象在搜索开始前创建、Set/引用类字段必须在 finally 里现取」
  这一类坑（§16.9 的教训）。
- `evaluationScope.zoneHrid` 只留一个字段（不再分 zone/dungeon 两路）：store 重建仿真设置时直接
  按 `useDungeon` 回填，避免「报告说是 A 图、复核跑的是 B 图」。

### 29.3 搜索层：`verifyTriggerOptimizerRobustness(input, options)`

```
input   = { playerConfig, simulationSettings, extra, settings?, weights?, pricing?,
            bestTriggerMap, baselineTriggerMap, startedAt? }
options = { targetTier, rounds?, WorkerClientCtor?, onProgress? }
返回     { difficultyTier, zoneHrid, rounds, seeds, baselineMetrics, bestMetrics, paired, verdict,
          scoreDelta, profitDelta, evaluations, simulations, elapsedSeconds, cancelled, error }
```

与搜索期**同源**的三条口径（否则复核结论与主结论不同尺度、无法对照）：

1. 两个配置共享**同一组种子**（公共随机数）⇒ 逐轮配对差；
2. 指标提取 / 打分 / 显著性全部走 `evaluatePayload` + `computePairedStats`（同一实现，不另写一套）；
3. 种子由「**目标难度 + 独立盐**」派生：`TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS = 'trigger-optimizer.robustness.v1'`
   与 `TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS = 6`。种子键里本就带 `difficultyTier`
   （`createTriggerOptimizerSeedSet` 的 key），换难度天然换随机流；独立盐是把它**写死**，
   不靠巧合 —— 与深挖（§21）同理：候选是在原难度上筛出来的，拿搜索期/复验期的样本再判一次
   就是样本复用，t 检验的 p 值不再有效。

实现细节：

- **只换难度**：`simulationSettings = { ...input.simulationSettings, difficultyTier: targetTier }`，
  区域/时长/模式逐字段照抄 —— 复核结论必须是「难度」这**一个**变量的答案，不能混进「换了图」。
- 两份配置都走 `configWithTriggerMap(playerConfig, map)`：整份 map 替换（含「键被删掉 = 回落默认触发器」
  的语义，逐键 apply 做不到「删除」），并且先经 `applyCandidateToPlayerConfig` 拿到 `selected: true`
  的深拷贝副本，与搜索期构建 payload 的路径完全一致。
- 对照侧（搜索起点）**先跑**、最优侧后跑：两者同种子，顺序不影响配对性；取消发生在中间时
  「对照组已就位、结论缺失」比反过来更容易读。
- 运行注册表与搜索**共用**：`registerTriggerOptimizerRun` + `ensureActive`，取消（`cancelTriggerOptimizerRun`
  → `stopTriggerOptimizerWorkerRuns`）在途中断后收尾为 `cancelled: true`（取消不是失败，不抛错）；
  真正的失败照搜索层的风格抛错。
- 缺少任一侧 map 直接抛 `MISSING_TRIGGER_MAP_ERROR` —— **绝不**静默回落到原难度（那会跑出一份
  「换难度」的假复核）。

### 29.4 相邻难度解析（`simulationDomain.resolveAdjacentDifficultyTier`）

难度是**区域属性**（`actionDetailMap[hrid].maxDifficulty`），合法区间 `0..maxDifficulty`：

1. 优先 `tier + 1`（更难一档 —— 结论在更难的难度上仍然成立，可信度明显更高）；
2. 已在最高难度 → `tier − 1`；
3. 两端都越界（`maxDifficulty = 0` 的目标、或 hrid 查不到）→ `null`，调用方据此说明
   「该目标没有相邻难度可复核」，而不是静默拿原难度重跑一遍。

实测数据（内置表）：普通区域 `maxDifficulty = 5`（55 个）、地下城 = 2（4 个），所以 tier 0 的目标
总能复核（→1），顶档退回下一档。放在 `simulationDomain` 而不是优化器域层：它只依赖游戏数据索引，
是「区域/难度」的通用知识（与 `buildZoneTargetsByScope` 同一处）。

### 29.5 store：运行态、动作与取消链

- `runtime.robustness = { isRunning, runId, phase, progress, difficultyTier, startedAt, elapsedSeconds, error, cancelRequested }`
  —— 与搜索运行态并列的第二个运行槽；`runId` 与搜索同款（stop 时自增，在途流程在下一个检查点自行退出）。
- `runTriggerOptimizerRobustness()`：校验（报告存在 / 两侧配置齐备 / 目标有相邻难度 / 不忙）→
  按**报告记录的** `evaluationScope` 重建仿真设置（`mode: 'zone'` + `useDungeon` + 目标 hrid +
  `difficultyTier: targetTier` + 报告当时的时长）→ 动态 import 搜索层 → 写 `results.robustness`
  （附 `createdAt`）。**只读**：不写玩家配置、不动报告主体，因此随时可以重复触发。
- `triggerOptimizerBusy` 纳入 `runtime.robustness.isRunning` **与** `runtime.serviceRunInFlight`：复核占用
  专属 worker，跑的时候既不能开工新搜索，也不能应用结果（它正在读的那份配置不能被改）；后者是覆盖
  收尾窗口的响应式锚点（§29.9 实测缺陷）。
- `stopTriggerOptimizer` 扩展成「两个运行槽都停」：先按 runId 复位复核、再走搜索的原有收尾；
  只有复核在跑时也能停（旧实现在 `!runtime.isRunning` 时直接 return，会留下一个停不掉的复核）。
- 错误/缺前提一律用 i18n 键：`noResults` / `robustnessMissingBaseline`（旧报告）/
  `robustnessUnavailable`（没有相邻难度）/ `busy`；真正的运行期失败写原始消息（与 `runtime.error` 同款，
  `t()` 找不到键时原样返回）。

### 29.6 UI：结论适用范围块

结果区新增一块（`data-trigger-optimizer-scope`，紧跟结论卡 / 得分卡之后、指标卡之前）：

- **适用范围**：`{{区域}} · 难度 N · M 小时` + 一句「触发器是全局技能配置，搜索只在上面这个目标上
  评估过」。数据源是 `results.evaluationScope`；没有该字段的旧报告整块不渲染（不猜口径）。
- **按钮**：`换难度复核（难度 N）`（`data-trigger-optimizer-robustness-run`）；跑的时候换成
  `停止复核`（`-stop`）+ 一行进度（`-progress`：`2 个配置 × 6 轮`）。
- **结果**（`-result`，有结果时替换掉说明行）：Δ 得分（`signed(…, 4)`，按符号配色）/
  Δ 日利润（`signedCompact`，指标方向配色）/ p 值 / 结论（`robustnessVerdicts.*`，按配对信号配色：
  positive 绿、negative 红、其余中性）。
- **三种回落**都在同一处给出理由（`-note`，warning 色）：无相邻难度 / 旧报告缺起点配置 /
  正常运行说明「怎么读」（`-hint`）。
- 配色全部复用 `triggerOptimizerText.js`（`triggerVerdictTextClass` / `triggerMetricDeltaClass`）：
  同一份报告在页面与详情弹窗里不能出现两种口径。

### 29.7 测试

- `triggerOptimizerSearch.test.js` 新增 4 条：
  - 报告带起点配置与适用范围（含**深拷贝**不变式：调用方改自己那份对象，报告不变）；
  - 换难度复核主路径：目标难度真的进了 payload（区域不变）、前 6 场 = 起点配置 / 后 6 场 = 最优配置、
    两侧**同种子**逐轮对齐、`result.seeds` = 「目标难度 + 独立盐」的确定性派生且与搜索盐/其它难度
    不相交、结论 positive 与 `scoreDelta` 一致、进度上报收尾到 1；
  - 缺任一侧配置 → 抛 `MISSING_TRIGGER_MAP_ERROR`（且不建立运行标志、不跑模拟）；
  - 取消 → `cancelled: true`、`paired` 为空、注册表清理干净。
- `simulationDomain.test.js` 新增 1 条：优先 +1 / 顶档退回 −1 / 越界输入钳到下界 / 未知 hrid 返回 null /
  地下城（区间 0..2）同规则。
- `triggerOptimizerStore.test.js` 新增 4 条（搜索模块的 vi.mock 补上 `verifyTriggerOptimizerRobustness`）：
  主路径（目标难度 = 报告范围的相邻档、时长取报告当时的 24h、两份配置来自报告且是深拷贝、
  复核期间 `apply → false`、结果写进 `results.robustness`、玩家配置未被改动、`serviceRunInFlight`
  调用期 true / 结算后 false）；三种缺前提的理由；取消（stop → 在途结果作废、不留错误）；
  重置会话结果时停掉在途复核（§29.9 的第二个洞）。搜索主路径用例也补了在途标志断言。
- `TriggerOptimizerPage.template.test.js` 新增 1 条：七种状态逐个断言（可复核 / 运行中 / 收尾窗口仍忙 →
  恢复可用 / 有结果 / 旧报告 / 无相邻难度 / 整块不渲染）。
- i18n 键对称：`robustnessVerdicts` 加入嵌套键集合断言（zh/en 自动对齐）。

### 29.8 浏览器实测（dev 5173 + 夹具 + 真实 worker）

夹具 `modernPlayerJunglePlanetFixture`（5 技能）注入玩家 1，`/actions/combat/jungle_planet` tier0、
4 小时 + 快速档（candidateLimit 6 / maxRounds 1 / rounds 5）：搜索 **35 次评估**、采纳 slot3（0.0224 分），
随后在结果区点「换难度复核（难度 1）」：

| 项           | 实测值                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- |
| 目标难度     | 1（报告范围 tier 0 → 相邻 +1）                                                              |
| 成本         | 2 次评估 × 6 场 = **12 场**，11.9 秒                                                        |
| 得分变化     | **+0.0204**（p = 0.0489 → positive）                                                        |
| 日利润差     | **+662.2k**（约 +1.5%）                                                                     |
| 逐指标配对差 | dps +3.33 / 经验 +2457 / 击杀 +3 / 死亡 0                                                   |
| 复核种子     | `1284548229, 1723246097, 351875909, …` —— 与复验种子 `3733189880, 2650161377, …` **零重叠** |

- 适用范围块上屏：「丛林星球 · 难度 0 · 4 小时——触发器是全局技能配置，而搜索只在上面这个目标上
  评估过：换难度或换图后结论不一定仍然成立。」；按钮标注目标难度（「换难度复核（难度 1）」）。
- 运行中：按钮换「停止复核」+「正在复核难度 1：12 场模拟（2 个配置 × 6 轮），已用时 5.7 秒。」，
  主按钮因 busy 禁用（互斥生效）。
- 结果块上屏：「换难度复核（难度 1）　得分变化 +0.0204　日利润差 +662.2k　p 值 0.049　结论：在该难度上提升成立」
  （结论按 positive 走绿色）。原难度结论（+0.0224 / p = 0.013）与更难一档的结论**方向一致** ——
  这正是这条功能要回答的问题。
- 控制台**零 error**；只有两条既有的引擎数据 warning（`Invalid experience rate for /monsters/…`，
  出现在搜索期，与本改动无关）。
- 报告里的 `baselineTriggerMap` 含玩家的**全部**键（5 个技能 + 6 个食物/饮品）——复核按整份 map 重建
  两份配置，「键缺失 = 回落游戏默认触发器」的语义因此完整保留。

### 29.9 实测缺陷修复：收尾窗口的响应式锚点（`runtime.serviceRunInFlight`）

浏览器实测抓到一个**只在真实链路才出现**的卡死，值得单独记一笔：

- **现象**：点「停止复核」后复核确实停了（注册表已清、`robustness.isRunning = false`），但页面
  「开始搜索」按钮**永久禁用**，理由显示「其他模拟或行情任务正在运行」。
- **根因**（逐步测量）：`busy` 计算属性读的 `hasTriggerOptimizerRunInProgress()` /
  `hasSharedWorkerRunInProgress()` 是**模块级普通变量**（非响应式），而它们的清空发生在**异步收尾**里
  —— 晚于 stop 把 `isRunning` 置 false 的那一次渲染。Vue 于是把「清理还没跑完」的 `busy = true`
  缓存了下来，此后再没有任何响应式变化让它重算 ⇒ 永久 busy。实测时间线：stop 同步返回时 registry
  仍为 true；+50ms registry 已是 false，但页面 `busy` 在 +50ms / +1.55s / +4.5s 三个采样点**全是 true**，
  而同一时刻直接调 `triggerOptimizerBusy(store)` 已经是 false —— 「真实状态对了、计算属性是陈旧的」。
  搜索路径其实有同一个潜在洞（stop 后同样没有后续响应式写入），复核只是第一个稳定复现它的入口。
- **修法**：加一个**响应式的在途标志** `runtime.serviceRunInFlight`，由 store 在每次调用搜索 / 复核前
  置 true、在 `finally`（服务层清理之后）置 false，并纳入 `triggerOptimizerBusy` 的判定。它同时做两件事：
  ① 覆盖「stop 已复位、服务层还在收尾」这段窗口（语义上确实还忙）；② 作为模块级标志的**响应式锚点**——
  它的写入让计算属性在标志真正清空之后再算一次。判定口径一个字没变。
- **顺带修掉同族的第二个洞**：`resetTriggerOptimizerResults()` 原本只检查 `runtime.isRunning`，在途复核
  不会被停 —— 而复核结束时是往**报告**里写结果的，导入新存档时不拦就会把上个存档的复核结论写到新报告上。
  现在两个运行槽都会被停。
- **回归测试**：store 用例断言「调用期 true / 结算后 false」（搜索与复核两条路径）、
  `resetTriggerOptimizerResults` 停掉在途复核且其结论作废；页面用例断言三段式忙态（运行中 → 收尾窗口 →
  恢复可用）。

### 29.10 已知边界与后续

- 只复核**相邻一个难度**，不回答「对其它区域是否成立」：跨区域是另一条线（区域间的怪种/刷新表差异
  比难度更大，且「相邻区域」没有良定义的顺序）。
- 复核用固定 6 轮（与复验同量级），不随 `settings.rounds` 缩放：它是**结论级**检查，成本固定
  12 场模拟；轮数足够给出 t(5) 的 p 值，再多的样本应该在主搜索里加。
- 「提升在该难度不成立」不等于配置有问题：它只是说明这份优化的适用面窄（原难度仍然按原报告读）。
- 未做（同一批审计里剩下的）：报告落盘/导出（防刷新丢结果）、
  敌方「最残血」多目标门（`all_enemies + lowest_hp_percentage`）、组合候选单条阈值精炼。
  （racing 分级采样已落地，见 §30。）

## 30. Racing 分级采样：粗筛 2 轮 → 幸存者精测（2026-09-24，未提交）

> 用户在第九轮审计的改进清单里选中「① Racing 分级采样」实施（其余暂缓）。目标：结果**更准**
> （消除「大候选池里挑最高分」的选择偏差）且**更省**（粗筛淘汰不值得精测的候选）。

### 30.1 动机与关键取舍（Option A）

- 大候选池（精细档 20 条/槽）全池精测时，winner 是「c-way 比较挑出来的最大值」——它相对 reference 的
  增量分被选择偏差抬高（挑 20 个噪声最大值去跟参考比，增量分与 p 值都偏乐观）。§20.1 的自助实测显示
  n=2 的粗筛就能把真最优保进 top-3，把「挑」和「判」拆到两组样本上即可同时拿到省成本与去偏差
  （选择偏差从 c-way 降到 ~3-way，且判据样本与筛选样本独立）。
- **Option A（采纳）**：`settings.rounds` 的语义不变 —— 它就是**精测**轮数；racing 只做「省成本 +
  消除选择偏差」，不自动扩样。
- **Option B（否决）**：预算中性自动扩样（省下的模拟静默换成更多精测轮）——会搅乱 §20.2/§20.3 精心
  标定的「可确认下限」显示口径与 joint.rounds 等既有契约，且用户填的轮数会被静默改写。

### 30.2 两段式采样与样本分割

| 泳道             | 种子盐                                | 轮数            | 用途                       |
| ---------------- | ------------------------------------- | --------------- | -------------------------- |
| 粗筛 `screen`    | `trigger-optimizer.screen.v1`（新盐） | SCREEN_ROUNDS=2 | 只决定「谁进精测」         |
| 精测 `decide`    | `trigger-optimizer.search.v1`（既有） | settings.rounds | winner / 采纳判据 / paired |
| 复验/深挖/换难度 | 各自独立盐（§21/§29，既有）           | 6 / 12 / 6      | 判据样本                   |

- **样本分割是硬约束**：「谁进精测」正是用粗筛样本选出来的（select on A），精测的采纳统计若混入
  粗筛样本就是可选停时（§21 的教训）——粗筛盐与 search 盐天然不同，B 组与「谁被复核」的决策无关
  ⇒ 精测的 t 检验无偏。
- 粗筛与精测共享同一份配置、只换随机流（`evaluateConfig(workingConfig, candidate, seeds)`）。

### 30.3 启用门槛与幸存者规则

- `TRIGGER_OPTIMIZER_RACING_MIN_POOL` = 8：候选数 **> 8** 才走 racing（`isRacingPool`）；小池走原路径
  （全池精测，零行为变化）—— 既有测试契约（`result.evaluations` 精确计数、深挖 12 场窗口（`#r1..#r6`
  连号）、复验/搜索种子不相交、`1|default` 记录等）全量保留。
- 幸存者 = 粗筛 top-`TRIGGER_OPTIMIZER_RACING_KEEP`(3) ∪ **锚点保送**（`distance === DISTANCE_ANCHOR`(0)，
  即「当前配置」/「游戏默认」锚点；`pickRacingSurvivors` 保持排名序）。锚点是「保持现状」的语义锚
  （报告的「本槽最优」要能落回 0 分锚点上），粗筛里被噪声挤出 top-K 不等于不值得精测。
- 安全性依据（§20.1 自助实测）：n=2 粗筛保留 top-3 时真最优 100% 不被淘汰；残余风险是漏采、不是误采。

### 30.4 参考链双份指标（`referenceMetrics` + `referenceScreenMetrics`）

- 粗筛比较同样要配对：粗筛 lane 的 reference = 「当前工作配置」在**粗筛种子**下的测量
  （`ensureScreenReference`，lazy —— 小候选池路径一次都不付这两场模拟的成本）。
- 槽级采纳后：`referenceScreenMetrics = screenMetricsBySignature.get(winner.signature)` ——
  winner 的粗筛测量就是「采纳后的工作配置」在粗筛种子下的指标（同一份配置、换随机流），
  **零额外模拟**接续（与精测参考链同一手法）；非 racing 路径的 winner 没有粗筛测量 → 置空。
- 精炼采纳 / 跨槽联合采纳改写配置 → `referenceScreenMetrics = null`：下一个粗筛槽 lazy 补测（2 场）。

### 30.5 记录口径（`metricsByCandidate`）

- 每条记录带 `lane`（'screen' / 'decide'）与 `sampleRounds`（该记录实际的抽样场数）。
- 覆盖规则：**精测记录总是顶掉粗筛记录**（决定性证据上屏）；同 lane 只在**分数更高**时覆盖
  —— 后续轮次的「自己 vs 自己」0 分复核点不得抹掉已采纳候选的正分记录（既有口径）。
- 非幸存者只留粗筛记录（lane='screen'）：UI 详情弹窗对这类行标注「粗筛 N 轮（未进入精测）」
  （`data-trigger-optimizer-candidate-screened`，i18n 键 `triggerOptimizer.candidateScreenedNote`）
  —— 依据绑定产生它的那批测量，2 轮的噪声统计不与精测统计混读。

### 30.6 成本口径、报告字段与 UI

- 每槽每轮评估数：racing 池 = 全池粗筛 1 次 + 幸存者精测 1 次（≤ KEEP+2 条）；小池 = 全池精测（原口径）。
  场次同理分段：粗筛段每条 2 场、精测段每条 `settings.rounds` 场；粗筛参考（lazy）另计 1 次评估 × 2 场。
- 典型收益（每槽每轮，20 候选）：× 10 轮 → 200 → 90 场（−55%）；× 6 轮 → 120 → 70 场（−42%）。
- 报告新增字段：`screenRounds`、`racingKeep`、`racingUsed`（`createEmptyResult` 骨架 + finally 回填 ——
  与 `adoptedSlots` 同款，`let` 必须**函数体级**）；`evaluationRounds` 语义不变（= settings.rounds）。
- UI：页面「预计模拟场次」公式改为 racing 感知（大池按 `count*SCREEN_ROUNDS + min(count, KEEP+2)*rounds`
  每槽每轮，+ 粗筛参考 2 场）；`roundsHint` 文案补充粗筛说明；详情弹窗候选表加粗筛标注（见 §30.5）。

### 30.7 测试与验证记录（2026-09-24）

- `triggerOptimizerSearch.racing.test.js`（新建）：mock 候选生成器给每个 choice 注入 9 条合成候选
  （201 粗筛虚高诱饵 / 202 精测真优 / 203 陪跑 / 204-209 垫底 —— 9 条是「每个池必然 > RACING_MIN_POOL」
  的下限保证，多槽用例的两个槽都必须真的走粗筛；响应器按种子归属判泳道）：
  - 纯函数：`isRacingPool` 门槛边界（8 不启用 / 9 启用）；`pickRacingSurvivors` = top-3 ∪ 锚点保送、
    保持排名序。
  - 主用例：粗筛 top-1（201）精测 0 分 → **必须采纳 202**（精测为准，诱饵不被采纳）；锚点保送
    （`1|default` 记录 lane='decide'）；非幸存者只留粗筛记录（lane='screen'、sampleRounds=2）；
    精确成本 `evaluations = 1+1+pool+4+2`、`simulations = 3+2+pool*2+4*3+2*6`；粗筛/精测两组种子
    不相交且都被实际使用。
  - 多槽参考链：两槽各采纳 202，粗筛参考只测一次（第二槽沿用 winner 的粗筛测量，零额外模拟）。
- `TriggerOptimizerPage.template.test.js` 新增 1 条：lane='screen' 的行恰有 1 条「粗筛 N 轮（未进入
  精测）」标注；chosen 行（报告自造对象，无 lane）不标注（依据绑定测量，不猜口径）。
- 既有测试**零改动**：`triggerOptimizerSearch.test.js` 等全走小池（≤ 8）→ 原路径，评估/场次精确计数
  断言全部不变。
- 全量验证：`npm test`（vitest 全绿 + prettier）、`npm run build` 通过（2026-09-24）。

### 30.8 有效性实证：真实引擎 bootstrap 对照（2026-09-24，`scripts/trigger-optimizer-racing-study.mjs`）

> 装置注（2026-10-02）：本节的 `scripts/trigger-optimizer-racing-study.mjs` 装置已于 2026-09-30
> 随切片 21B 删除——本节及此后各节（至 §63.6）的所有对应复现命令均已失效，详见文首「装置删除注」。

单测锁定的是**机制正确性**（粗筛不进判据、锚点保送、成本记账）；「结果更准」是实证命题，
另跑了一组对照实验回答（只读生产代码：采样/聚合/打分/闸门/筛选全部调用生产实现，判据零重写）：

- **方法**：`modernPlayerJunglePlanetFixture`（jungle_planet tier0、4h）+ 真实战斗引擎（Node
  worker_threads，引擎入口 `trigger-optimizer-racing-study.engine.mjs` 与 `src/worker.js` 逐行同构）
  对「基线 + 两槽全部真实候选」（各 20 条，含锚点）在 32 个真实 CRN 种子上采样 = **1312 场真实模拟**
  （182s / 8 workers）；bootstrap 500 次把种子切成互不相交的 粗筛 2 / 精测 5 / 留出 25 三组，回放
  旧路径（全候选进精测取最高）与 racing（top-3 ∪ 锚点进精测）—— 两路径共用**同一组**精测样本
  （判据预算对齐）；真值 = 留出组上的 `scoreCandidate`（与筛选/判据样本都不相交）。
- **有真提升槽**（flame_blast，真最优 `all_enemies HP≥800`，全体真实分 **+0.01978** ≈ 利润 +2.8%
  量级；与 §16.9 实测的 flame_blast-800 一致）：

  | 指标                  | 旧路径（全精测） | racing                   |
  | --------------------- | ---------------- | ------------------------ |
  | 选择偏差（报告−真实） | +0.00021         | **+0.00008（−62%）**     |
  | 选中真最优率          | 97.6%            | **98.6%**                |
  | regret 均值           | 0.00032          | **0.00020**              |
  | 真最优进精测率        | —                | **100%（漏采 0 / 500）** |
  | 采纳率 / 假采纳率     | 90.2% / 0.2%     | 90.2% / 0.2%             |
  | 每槽每轮场次          | 100              | 64（−36%）               |

- **无提升槽**（firestorm，全体候选真实分 ≤ 0、真最优 = 0 分锚点；§20.1 的 firestorm 同款）：
  选择偏差 0.00126 → 0.00104；虚报事件率（非锚点被选中 = 挑了个「看着更好」的候选）3.8% → 2.2%
  （−42%，单次虚报的量级 ~0.016 两路相同——racing 少的是**发生次数**）；选中真最优率 93.6% → 95.0%；
  **采纳 0% / 假采纳 0% 两路相同**（无提升槽的最终保护是采纳闸门 + 锚点 0 分地板，racing 不改变它）；
  每槽每轮场次 100 → 59（−41%）。
- **结论**：① 选择偏差确实下降（有真提升槽 −62%；无提升槽虚报事件 −42%）——「挑」与「判」用不相交
  样本后，报告分更接近真值；② **漏采 0%**（1000 次槽-试验里真最优 100% 进精测），选中真最优率不降反升
  （判据集从 c-way 缩到 ~~4-way，判据样本自身的 max-selection 误差同步变小）；③ 成本 −36~~41%
  （rounds=5；精细档 rounds=10 为 −55%，与 §30.6 解析值一致）；④ 「有用性」本体得到独立确认：
  flame_blast 槽真实存在 +0.0198 的提升、90.2% 的试验里被正确采纳。
- 复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3`
  （不启动应用/服务器；改 `src/worker.js` 时必须同步引擎入口镜像）。

---

## 31. 复验三态 + 追加复验：不确定的结论不许默默放行（2026-09-24，未提交）

**一句话**：复验判「未达显著」（`inconclusive`）时报告不再只是把结论摊在那儿 —— 结论卡明说「提升尚未被独立
样本确认」，并给出「追加复验」入口：再采一组**独立盐**新样本，与首轮样本**合并后重新检验**，把不确定结论
追到转正 / 判负。**产品门槛不变**：只有复验判 `negative` 才否决应用（`isTriggerOptimizerResultRejected` /
store / UI 三处同源），`inconclusive` 仍可应用 —— 但不许装作已确认。

### 31.1 为什么做这一条

- 三态里 `inconclusive` 的语义是「**没测出来**」，不是「没有提升」。它与 `positive` 在旧 UI 上的差别只有
  一个词（「未达显著」vs「提升成立」），而两者的**行动含义**完全不同：前者的出路是「再采样本」。
- 实测里「6 轮不够」是常态而非例外：§19 补测的搜索期 inconclusive（p=0.053、靠 |mean| > 2×SE 过闸）、
  复验 positive p=0.0131；§30.8 的两槽里 4 条真提升候选有 1 条落在两段样本上给出相反方向的结论。
  旧口径下用户看到「未达显著」之后没有下一步。
- 追加的边际成本固定且小：2 次评估 × 6 场 = **12 场模拟**，远低于重跑整轮搜索（数百场）。
- 「要不要追加」是**拿首轮结论做的决定**（select on A）—— 这正是它必须换盐、并且必须用 §31.6 的实证
  验证「假阳性没有被可选停时顶上去」的原因。

### 31.2 样本分割：为什么追加必须换盐

| 样本组                   | 种子盐                                              | 轮数 | 用途                                      |
| ------------------------ | --------------------------------------------------- | ---- | ----------------------------------------- |
| 首轮复验 `verify`        | `trigger-optimizer.verify.v1`（既有）               | 6    | 第一次判定（也是「要不要追加」的依据）    |
| 追加复验 `verify-append` | `trigger-optimizer.verify-append.v${attempt}`（新） | 6    | 第二次采样的判据原料（attempt 从 1 递进） |

- 追加样本与首轮复验 / 搜索 / 粗筛 / 深挖 / 稳健性复核的种子**全不相交**（盐进 key 参与 hash，
  `createTriggerOptimizerSeedSet` 的既有机制），每次追加之间也互不相交。
- 盐基名刻意不带 `.v1` 后缀：版本号由 `attempt` 提供（`verify-append.v1` = 第 1 次追加）。这样「第 N 次
  追加」有一套只属于它的随机流，重跑同一份报告的第 N 次追加仍是同一批样本（可复现）。
- **合并重检把首轮样本一并算进判据**（自由度 5 → 11）：这等价于「最多追加 N 次」的序贯检验，
  可选停时会不会把假阳性顶上去，由 §31.6 的 bootstrap 实证把关（判据：假阳性 ≤ 5% 且不高于单次）。

### 31.3 服务层：`appendTriggerOptimizerVerification(input, options)`

```
input   = { playerConfig, simulationSettings, extra, settings?, weights?, pricing?,
            bestTriggerMap, baselineTriggerMap, verification, startedAt?, WorkerClientCtor? }
options = { attempt, rounds?, WorkerClientCtor?, onProgress? }
返回     { ...旧 verification 字段, baselineMetrics, bestMetrics, paired, verdict, rounds, seeds,
          attempts, evaluations, simulations, elapsedSeconds, cancelled, error }
```

- **不换难度**（与 `verifyTriggerOptimizerRobustness` 的区别）：`simulationSettings` 原样使用 —— 这一轮
  回答的是「这批证据够不够」，唯一变量是样本量。换难度是另一个问题，有另一个入口（§29）。
- 骨架与搜索 / 复核同源：`hasTriggerOptimizerRunInProgress` / `hasSharedWorkerRunInProgress` 忙检查 →
  `registerTriggerOptimizerRun` → `ensureActive` → 取消 resolve `cancelled: true`、真正的失败抛出。
- 两次评估（对照侧先跑）→ 合并：

  ```js
  const mergedBaseline = aggregateRoundMetrics([...previousBaselineSamples, ...newBaseline.samples]);
  const mergedBest = aggregateRoundMetrics([...previousBestSamples, ...newBest.samples]);
  const mergedPaired = computePairedStats(mergedBest, mergedBaseline, weights);
  ```

  `verdict` 取合并后的 `paired.score.verdict`，`rounds` = 合并轮数（6 → 12 → 18…），`seeds` 逐次累加。

- **`attempts` 留档**：每次追加在末尾追加一条
  `{ attempt, rounds, seeds, paired, verdict, mergedRounds, mergedVerdict }` —— 前几项是**本次新增样本
  自身**的统计，后两项是合并后的总轮数与结论。两条口径都留档，读者能分清「新增样本说了什么」与
  「合并后说了什么」。旧记录原样保留（`two.attempts[0] === one.attempts[0]`，测试钉住）。
- **缺原料就明确报错**（`MISSING_VERIFICATION_ERROR`，新增导出）：`verification.baselineMetrics.samples` /
  `bestMetrics.samples` 缺失、为空、或两侧轮数不齐（旧报告 / 退化结构）→ 抛错，**不猜**一份样本去追加。
  校验在任何运行标志建立**之前**，因此不会真的派评估出去。
- 取消 / 失败时旧字段原样带回（= 「什么都没追加」）：只有合并成功才覆盖结论字段。

### 31.4 domain / store / UI / i18n

- `triggerOptimizerDomain.js`：新增 `TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND = 'trigger-optimizer.verify-append'`，
  种子集注释从「六套」改为「七套」并补上用途行（§31.2 的分割理由）。
- store（`simulatorTriggerOptimizerActions.js`）：
  - `runtime.verifyAppend = { isRunning, runId, phase, progress, startedAt, elapsedSeconds, error, cancelRequested }`
    （仿 `robustness`，**没有** `difficultyTier` —— 它不换难度）；纳入 `triggerOptimizerBusy`。
  - `runTriggerOptimizerVerificationAppend()`：校验（报告存在 / `verification` 带双侧样本 / 报告带两份 map 与
    `evaluationScope` / 不忙）→ 从 `evaluationScope` **按原难度**重建 `simulationSettings` →
    `attempt = (verification.attempts?.length ?? 0) + 1` → 动态 import 服务层 → 成功后
    `results.verification = outcome`（取消不写回）。**只读**：不写玩家配置、不动报告主体。
  - `stopTriggerOptimizer` 扩成「三个运行槽都停」（追加复验复用同一条取消链）；`resetTriggerOptimizerResults`
    的停表条件加入 `verifyAppend?.isRunning`，非运行态清 `error / phase / progress / elapsedSeconds`。
  - `runtime.serviceRunInFlight` 在调用前后维护（§29.9 的响应式锚点，缺了会永久卡 busy）。
  - 轮数走**服务层缺省**（`TRIGGER_OPTIMIZER_VERIFY_ROUNDS`）：常量只在一处定义，store 不抄第二份。
- UI（`TriggerOptimizerPage.vue`）结论卡内新增一块（`v-if="showVerifyAppend || verifyAppendMergedText"`）：
  - 警示行 `data-trigger-optimizer-verify-unconfirmed`（`text-warning`，`role="status"`）：只在
    `verification.verdict === 'inconclusive' && improvement.improved === true` 时出现；
  - 按钮 `data-trigger-optimizer-verify-append`（同条件），运行中换成
    `data-trigger-optimizer-verify-append-stop`（「停止追加复验」→ `simulator.stopTriggerOptimizer()`）；
  - 合并留档 `data-trigger-optimizer-verify-append-merged`（「已复验 N 次 · 合并 M 轮」，`attempts` 非空即显示
    —— 追加后结论转正时警示行消失、留档仍在）。
  - 三个 computed：`showVerifyAppend` / `verifyAppendRunning` / `verifyAppendMergedText`；handler
    `runVerificationAppend()` 与 `runRobustness()` 并列。
- i18n（zh/en 同步，`i18nResources.test.js` 自动覆盖对称性）：`verifyUnconfirmed` / `verifyAppend` /
  `verifyAppendStop` / `verifyAppendMerged`（插值 `{{attempts}}` / `{{rounds}}`，不给 fallback）/
  `verifyAppendMissing`（缺样本的 store 错误键）。
- patchNote：v2.5.7 条目的 improvements 追加一条（同批次同版本）。

### 31.5 测试

- **新建** `triggerOptimizerSearch.verifyAppend.test.js`（4 条，`SimulatedWorkerClient` 桩同 `racing.test.js`）：
  1. 合并重检：首轮 6 + 追加 6 = **12 轮**（两侧样本、`rounds`、`paired.rounds` 全是合并口径，前 6 轮就是
     首轮样本）、`verdict` 与「用合并样本在测试内重算」一致、`evaluations: 2` / `simulations: 12` 精确计数、
     `seeds` = 旧 6 + 新 6、`attempts[0]` 双口径自洽；
  2. 样本分割：`attempt 1 / 2` 的种子互不相交、各自等于 `${VERIFY_APPEND}.v1 / .v2` 的确定性派生、且与
     `verify / search / screen` 三套盐全不相交；`seeds` 逐次累加（6 → 12 → 18，与合并轮数同口径）、旧留档
     不被覆盖；
  3. 缺原料（缺 `samples` / 空数组 / 两侧轮数不齐）→ 抛 `MISSING_VERIFICATION_ERROR`，且**一次模拟都没跑**；
  4. 取消 → `cancelled: true`、`evaluations: 1`（对照侧跑完、最优侧未跑）、结论字段仍是首轮的（12 轮合并
     口径绝不凭空出现）。
- `triggerOptimizerStore.test.js`：mock 模块补 `appendTriggerOptimizerVerification` + `controls.appendCalls`；
  新增 2 条 —— 主路径（**按报告原难度**重建设置、深拷贝的输入、`attempt: 1`、运行期 `apply → false`、
  `serviceRunInFlight` 调用期 true / 结算后 false、合并结论写回 `results.verification`、玩家配置未被改动）、
  缺样本拒跑（`verifyAppendMissing` 且 `appendCalls` 为空）。
- `TriggerOptimizerPage.template.test.js`：新增 2 条 —— inconclusive → 警示行 + **恰 1 个**入口按钮（并断言
  未达显著**不拦应用**），positive / negative 两种已定型结论不给入口；点击按钮调 store action；运行中换成
  「停止追加复验」并调 `stopTriggerOptimizer`；`attempts` 非空 → 「已复验 1 次 · 合并 12 轮」留档。
- 全量：**179 文件 / 2528 用例**（+4 服务层、+2 store、+2 模板）+ prettier + `vite build` + `check-dead-keys`
  （0 死键）全绿。`official-translation-sync` 有一条 5 s 超时的边界用例在满负载下会抖动（单独复跑 364 ms
  通过），与本改动无关。

### 31.6 实证：复验追加功效 bootstrap（`scripts/trigger-optimizer-racing-study.mjs` 新增一段）

- **方法**：复用 §30.8 的 32 种子真实引擎矩阵（同为 jungle_planet tier0 / 4h、两槽各 20 条真实候选、
  1312 场真实模拟），对**每一条候选**当基线对照跑两段式复验协议：每试验抽 12 个互不相交的种子 →
  首轮 6 轮判 `verify1` → 若 inconclusive 再与后 6 轮合并成 12 轮重检。真值 = 全体 32 种子上的
  `scoreCandidate`：真值 > `MIN_ADOPT_SCORE` 的进「真提升」桶（确认率 / 解析率），真值 ≤ 0 的进
  「无提升」桶（判「提升成立」= **假阳性**）。判据：真提升确认率要明显上升，且假阳性率不升（§31.1）。
- **结果**（500 次试验/案例）：

  | 指标                         | 有真提升槽（flame_blast） | 无提升槽（firestorm） |
  | ---------------------------- | ------------------------- | --------------------- |
  | 真提升案例数                 | 2                         | 0（该槽无真提升候选） |
  | 首轮判「提升成立」           | 87.3%                     | —                     |
  | 累计判「提升成立」           | **100.0%**                | —                     |
  | 首轮未达显著                 | 12.7%                     | —                     |
  | 解析率（未达显著→明确）      | **100.0%**                | —                     |
  | 期望轮数/侧                  | 6.76                      | —                     |
  | 无提升案例数                 | 16                        | 20                    |
  | 假阳性（首轮 → 累计）        | **0.0% → 0.0%**           | **0.0% → 0.0%**       |
  | 首轮未达显著（null）/ 解析率 | 19.2% / 50.2%             | 18.5% / 54.5%         |
  | 期望轮数/侧（null）          | 7.15                      | 7.11                  |

- **判读**：① 真提升的确认率 **87.3% → 100%**（+12.7pp），且 12.7% 的不确定**全部**被追成明确结论；
  ② 假阳性率**不升**（两槽 36 条 null 候选 × 500 次 = 18,000 次试验**零假阳性**；按 rule of three，
  95% 置信上限 ≈ 0.017%，远低于 5% 判据）—— 合并重检没有把「可选停时」变成虚报机器；③ 代价可控：
  期望轮数/侧 = 6 + 6 × P(首轮未达显著) ≈ 6.8~7.2，即 **+13~19%** 的复验场次，且只在 inconclusive 时才付。
  ⇒ 本特性**保留**。
- **诚实边界**：真提升桶只有 **2 个候选**（flame_blast 槽 20 条里真值 > 0.01 的只有 2 条），确认率虽由
  2×500 = 1000 次试验汇总，但**只来自 2 个不同候选**，代表性有限；无提升槽的真提升桶整桶为空（该槽
  没有真提升候选），因此「确认率上升」这一条只在 flame_blast 槽上得到验证，「假阳性不升」则在两槽
  共 18,000 次试验上得到验证。本实证测的是**验证/追加阶段**的功效，不含「谁被选为 best」那一层的
  选择偏差（那由 §30.8 覆盖）。
- 复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3`
  （采样 1312 场 / 230 s；空桶显示「—」= 没得测，不是「测过且为零」）。

### 31.7 已知边界与后续

- 入口只在「`verdict === 'inconclusive'` **且** 搜索期 `improved === true`」时出现。其余情形
  （`unknown`、`evidenceBlocked`、没有提升）没有可追的结论 —— 加按钮只会制造空转。
- 追加次数**没有上限**：每次都会换盐、都会累加样本。实测的期望成本只有 +13~19%（因为只有 12.7% 的
  试验需要追加），但「连追 3 次以上」的功效与假阳性未单独实证（本次 bootstrap 最多追加 1 次）。
- 合并口径下 `verification.rounds` 会变成 12 / 18 …，`: `paired.rounds`同步 —— 读者要习惯「复验 6 轮」
这句话在追加过之后**不再成立**（结果说明弹窗里的`verificationHint` 仍是固定文案「固定 6 轮配对比较」，
  追加后不再精确；改文案会牵动 3 条既有断言，留待有人真的误读再说）。
- store 的两道防御性校验（`verifyAppendMissing` / `robustnessMissingBaseline`）**没有单独上屏**：
  入口的可见条件在结构上蕴含它们都能通过（`inconclusive` ⟹ `paired` 非 null ⟹ 两侧 samples 非空等长；
  `improved` ⟹ 报告带两份 map 与 `evaluationScope`），因此这两条只在直接调 store action（如测试）时可达。
  真要在页面上也显示，最省事的位置是那三行 computed 旁边的同一个块（模板已在那里）。
- 追加只覆盖「同一目标 + 同一难度 + 同一时长」的样本量轴；换难度有另一个入口（§29），两者不要混读。
- 未做（同一批审计里剩下的）：报告落盘/导出（防刷新丢结果）、跨区域（非相邻难度）稳健性综述、
  敌方「最残血」多目标门（`all_enemies + lowest_hp_percentage`）。

---

## 32. 精炼步长二分（2026-09-24，**实测无提升 ⇒ 已回退**）

### 32.1 为什么改做这一项

本轮原本继续 §31 之后的第一候选「深挖（deepDive）可选停时 / 默认 maxRounds 自适应」，但历史实测已经否掉
了它的必要性：§19.8 熊熊星球 `(10,3,5)` 第 2 轮零采纳 = **固定点收敛**先停，3 轮上限从未执行；§21.5 的
深挖窗口检查要求 `score ≥ 0.01 且 |mean| ≤ 2×SE`（即 `SE > 0.005`），24h×2（0.0099）、24h×5（0.00626）
都进不去，只有 4h×5（0.01431）能进，4 次真实运行 **0 触发**；32 种子矩阵里被拦候选最多 1~2 条 ⇒ 收益测不
准。影响面窄 + 样本不足 ⇒ 硬做违反「有提升才保留」。

改成**影响面覆盖每个带数值阈值候选**的精炼：当时的口径是「level 0 = ±10pp，level ≥ 1 = ±5pp（**下限 5**
掐死）」——从第 2 级起步长不再缩小，行走只能停在离内部最优 ~5pp 处，没有二分效果。候选改成
10 → 5 → 2 → 1（逐级二分、1pp 下限）时：**成本完全不变**（级数上限 4、每级 ≤2 次评估 = 每槽每次采纳
≤ 8 次评估），终值分辨率从 5pp 提到 1pp，代价是单次可行走距离从 25pp 降到 18pp（仍 ≥ 网格半径 12.5pp）。

### 32.2 实证方法（脚本新增「精炼步长序列对照」段）

`scripts/trigger-optimizer-racing-study.mjs` 末尾新增一段（与 §30.8 / §31 同一套真实引擎采样框架）：

1. **1pp 响应曲线**：用生产 `buildRefinedCandidates` 把目标家族（默认 `enemyGroupHp`）的可达阈值在 1pp
   网格上 BFS 全展开（每个新节点的邻居仍由生产函数生成 ⇒ 采样点与行走实际会评估的点逐字节一致），逐点
   真实采样（默认 `--refine-min/--refine-max=5/95`，91 点 × 种子数）；
2. **双行走回放**：生产臂直接调 `buildRefinedCandidates`；对照臂在同一批网格上按 `percent ± step` 取点
   （`--refine-steps`，默认就是被否决的 `10,5,2,1`）。两条臂同起点（区间内 5pp 格点）、同参考系（轮起配置
   = 基线）、同决策种子，判据全走生产实现（`compareCandidates` / `shouldAdoptCandidate`）；
3. **启动时对齐自检**：把对照臂步长设成**生产实测步长**时，两臂必须取到完全相同的候选（签名集合逐个比对，
   12 组）——不通过直接 assert 失败（实测：12 组全部一致）；
4. **样本分割**：决策种子（2 / 5 两档）与留出种子不相交，配对差 = 最终阈值的**真实分**（留出种子上 vs 基线）
   的「对照 − 生产」，跨 19 个起点 × 500 次试验配对汇总。

### 32.3 实测数字（4h / tier 0 / 32 种子 / 500 次试验）

| 指标                                     | 槽 2（firestorm，弱信号）                    | 槽 3（flame_blast，强信号）           |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------- |
| 全体真最优（1pp 网格）                   | 15% = **0.00398**                            | 33% = **0.02543**                     |
| 5pp 格点最优                             | 15% = 0.00398                                | 35% = 0.02308                         |
| 精度上限（= 二分能捡到的天花板）         | **0.00000**                                  | **0.00234**                           |
| 配对差 @ 决策样本 5（走到 level≥2 比例） | **0.00000 ± 0.00000**（0.0%）                | **0.00000 ± 0.00000**（0.8%）         |
| 配对差 @ 决策样本 2（走到 level≥2 比例） | −0.00049 ± 0.00004（t = −11.33，7.0%）       | −0.00065 ± 0.00007（t = −9.84，8.4%） |
| 配对差 @ **现实起点**（两档都是）        | **0.00000 ± 0.00000**（1000 样本）           | **0.00000 ± 0.00000**（1000 样本）    |
| 平均评估次数（生产 / 对照）              | 2.21 / 2.30（决策 2）、1.75 / 1.75（决策 5） | 2.31 / 2.42、1.94 / 1.95              |

- **判读**：① **现实起点**（家族真实网格候选，也就是生产真正会精炼的起点）上，两条步长序列的终值**逐样本
  完全相同**（1000 样本配对差 0.00000）——这一档本来就不可能因为步长而不同；② 把「不可能被精炼的非现实
  起点」也纳入后，5 次决策样本时仍然完全一致，2 次时二分**反而略差**（t ≈ −10，效应 −5e-4）；③ 槽 3 的
  1pp 天花板确实存在（0.00234），但行走走不到那里 —— **走到 level ≥ 2 的比例只有 0.8%（决策样本 5）/8.4%
  （决策样本 2）**，而步长差异只在 level ≥ 2 生效。⇒ 无提升，按判据**回退**（生产保留 5pp 下限）。
- **根因（本轮最有价值的结论）**：瓶颈不在步长分辨率，而在**精炼行走的启动率**。行走要启动，必须有一级
  邻域候选通过采纳门槛（增量 ≥ `MIN_ADOPT_SCORE` = 0.01 且配对证据 `|mean| > 2×SE`），而精炼每次评估只有
  `settings.rounds` 个样本（标准档 5）——一级都很少启动，更细的步长自然无从发挥作用。这与 §19.9 的真实
  引擎回归（`refinedCount = 0`）是同一现象。
- **诚实边界**：只测了 jungle_planet tier 0 / 4h、单一候选家族（`enemyGroupHp`）、两个槽、决策样本 2/5 两
  档；「无提升」的结论**不能外推到其它家族/区域**（槽 3 的 1pp 天花板就非零，只是走不到）。真要做「让行走
  走得更细」的改动，应先解决启动率（例如按可确认下限校准精炼门槛、或在有梯度时允许更远的探索），而不是
  继续减步长。

### 32.4 落地状态与复现

- **生产代码零行为改动**（回退完成）：`REFINEMENT_PERCENT_STEP_FLOOR` 仍为 5、`refinementPercentStep` 仍是
  `max(5, 10 / 2^level)`；只在 `triggerOptimizerSearch.js` 把进度分母里的硬编码 `4 *` 换成
  `TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS *`（同值，防「上限改了分母没跟着改」的静默漂移）。
- **脚本保留**对照段（可复跑的实验装置）：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32
--rounds=5 --trials=500 --workers=8 --slots=2,3`。**注意**：生产步长是 10/5（下限 5）时，BFS 枚举出的网格
  就是 **5pp**，`--refine-steps=10,5,2,1` 取不到 2/1pp 的点 —— 脚本这时会**明确跳过对照臂并说明原因**（不会
  打印退化的对照表）。复现 §32 的 1pp 对照需要临时把 `REFINEMENT_PERCENT_STEP_FLOOR` 改成 1 再跑一次采样；
  把 `--refine-steps` 设成与生产相同（`10,5,5,5`）时，配对差必须精确为 0.00000（自检，实测通过）。
- **回归**：`npm test` 179 文件 / 2528 用例全绿 + prettier 全绿；`npm run build` ✓；`npm run check-dead-keys` ✓
  （0 死键）。本轮全部改动**未提交 git**。

---

## 33. 候选覆盖缺口量化：「敌方最残血百分比门」有没有杠杆（2026-09-24，**实测无杠杆 ⇒ 不实施**）

### 33.1 缺口与合法性

候选生成器里有**队友侧**的百分比门（`all_allies` + `lowest_hp_percentage`，见 `defenseCandidates`），却
**没有敌方侧**同款。游戏数据里它是合法的多目标组合：

- `combatTriggerDependencyDetailMap`：`all_enemies` = `isMultiTarget`；
- `combatTriggerConditionDetailMap`：`lowest_hp_percentage` = `isMultiTarget`，`allowedComparatorHrids` =
  `greater_than_equal` / `less_than_equal`；
- 配对由 `getTriggerConditionsForDependency` 按 `isSingleTarget/isMultiTarget` 完成 ⇒
  `all_enemies` + `lowest_hp_percentage` + GTE/LTE 合法（脚本运行时用生产 `sanitizeTriggerList` 逐条自证，全部通过）。

引擎语义（`src/combatsimulator/trigger.js` 的 `isActiveMultiTarget`）：依赖值 = **敌方「最残血活体」的血量
百分比**；无活体时初值 `2 → 200%`。两个方向因此**语义不对称**：

| 方向            | 触发条件        | 空档（无活敌）时 | 语义                                        |
| --------------- | --------------- | ---------------- | ------------------------------------------- |
| LTE p（残血门） | 最残血那只 ≤ p% | 200 ≤ p = **假** | 天然带「有活敌」守卫：残波补刀              |
| GTE p（开局门） | 最残血那只 ≥ p% | 200 ≥ p = **真** | **不带**守卫：空档也会放技能（白耗冷却/蓝） |

现有敌方侧候选（`enemyGroupHp` / `enemyTargetHp` / `executeHp` / `deadUnits*`）都是**另一把尺子**（绝对值换算
或人数），没有这条「最残血百分比」门。按用户口径（有提升才保留），**先量化再决定是否实现**，门槛 =
`TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE` = 0.01。

### 33.2 实验装置（脚本第 4 段，零产品改动）

`scripts/trigger-optimizer-racing-study.mjs` 新增「候选覆盖缺口」段（`--coverage-family` / `--coverage-percents`）：

- **合成族**：`{all_enemies, lowest_hp_percentage, LTE/GTE, p}`，`p ∈ {20, 40, 60, 80}`（两向 = 8 条）。合法性
  过生产 `sanitizeTriggerList`（长度必须 = 1，否则 assert 失败）、签名走生产 `buildTriggerCandidateSignature`、
  `distance = 2`（= `DISTANCE_CUSTOM`，与角色候选同档）；并断言不与现有候选 / 精炼网格撞签名。
- **多槽覆盖**：覆盖 `--slots` 里**所有**含锚点家族（默认 `enemyGroupHp`）的槽（本轮槽 2、3 都命中），
  防止单槽结论外推。
- **精炼可用性（静态自证）**：生产 `buildRefinedCandidates` 早已按 `condition === lowest_hp_percentage` 识别
  （`rawPercent` 分支、不需要资源换算），±10pp 邻域保持同依赖 / 条件 / 比较器 ⇒ **若实施，精炼无需改造**
  （断言通过）。
- **采样**：与既有候选同一批 CRN 种子（32 种子 × 4h）：76 配置 × 32 = 2432 场。
- **判读**：① 全体种子聚合（对族最有利的「事后看」口径）族最优 vs 现有池最优；② 采纳侧 bootstrap
  （决策样本 2 / 5，500 次试验）：A 臂 = 现有池、B 臂 = 现有池 ∪ 族。

### 33.3 实测数字（4h / tier 0 / 32 种子 / 500 次试验）

| 指标                              | 槽 2（firestorm，AOE）             | 槽 3（flame_blast，单体）        |
| --------------------------------- | ---------------------------------- | -------------------------------- |
| 现有池最优（20 条候选）           | `current`（原样不动）= **0.00000** | `enemyGroupHp 800` = **0.01978** |
| 族最优（8 条网格）                | `≤80% 残血门` = **−0.07895**       | `≤80% 残血门` = **−0.10619**     |
| 两档实施形态（40/60 × 两向）最优  | −0.10860                           | −0.10688                         |
| **杠杆（族最优 − 现有池最优）**   | **−0.07895**                       | **−0.12597**                     |
| 族被选中率（bootstrap，决策 2/5） | 0.0% / 0.0%                        | 0.0% / 0.0%                      |
| 配对差（B − A 真实分）            | 0.00000 ± 0.00000（100% 平）       | 0.00000 ± 0.00000（100% 平）     |

族内形状（两槽一致）：**限制越少分越高**（LTE 80 > LTE 60 > LTE 40 > LTE 20；GTE 20/40 > GTE 60/80），且
**LTE 方向系统性优于 GTE**（槽 2：−0.079 vs −0.195）——与 33.1 的「GTE 在空档恒真」一致。

### 33.4 判读与根因

- **判据结论**：两槽杠杆都是**深度负值**（差 0.079 / 0.126，门槛 +0.01），bootstrap 里族**一次都没被选中**
  （B 臂与 A 臂逐试验同分、100% 平）⇒ **无杠杆，不实施**（生产候选池保持原样）。
- **根因（可复核）**：两个槽的**当前配置本来就是**「敌方总血量」门（夹具 `triggerMap`：
  `[all_enemies 活敌数 ≥ 1] AND [all_enemies current_hp ≥ 500]`），现有池就是在同一根轴上做邻域搜索
  （槽 3 最优 `enemyGroupHp 800` = +0.0198）。新族是**同一件事换一把尺子**（最残血百分比 vs 敌方总血量
  绝对值）**且整表替换**——替换后连「≥1 活敌」守卫都丢掉。单条件 gate 候选只能**收紧**释放时机，而这两个
  夹具的现状已在正确一侧：槽 2 的池最优就是「原样不动」（0.00000），任何净收紧都是负分。
- **附带发现（值得记住的引擎语义）**：`无活体 → 200%` 的初值让 **GTE（开局门）方向在「没有活敌」时为真**
  ⇒ 它**不能**替代「敌人存在」守卫。将来若要使用 `lowest_hp_percentage`，GTE 方向必须与活敌数条件组合，
  或只用 LTE 方向。
- **诚实边界**：只测 jungle_planet tier 0 / 4h / 单角色 / 两个伤害槽 / `p ∈ {20,40,60,80}`。「无杠杆」
  **不得外推**到其它区域（怪物血量结构不同）、其它槽（光环 / 治疗槽）、或其它轴（把该门做成**组合门**，
  例如与「活敌数 ≥ N」「蓝量 ≥ X」合取）。

### 33.5 落地状态与复现

- **生产代码零改动**：`triggerOptimizerCandidates.js` 一行未改（仍无敌方侧 `lowest_hp_percentage` 族）；
  无 i18n / 无 UI / 无测试改动。
- **研究装置保留**（可复跑）：
  `node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3`
  （可选 `--coverage-family=<候选家族后缀>`、`--coverage-percents=20,40,60,80`）。`engine.mjs` 为此新增 3 个
  生产再导出（`sanitizeTriggerList` / `buildTriggerCandidateSignature` / `TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS`）
  ——只服务研究装置，不进产品 bundle。
- **若将来要重判**：放宽 `--coverage-percents`（如 90/95）可验证「限制越少分越高」的单调趋势；换区域用
  `--tier`、换槽用 `--slots`；组合门方向则要改脚本合成形态（本段只测单条件 gate）。
- **回归**：`npm test` 179 文件 / 2528 用例（其中 `scripts/__tests__/official-translation-sync.test.js` 有 1 条
  5s 用例在满负载下超时 —— 既有抖动，单跑 241ms 通过，与本轮无关）；`npx prettier --check .` ✓；
  `npm run build` ✓（35.1s）；`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。本轮全部改动**未提交 git**。

---

## 34. 候选上限截断的代价：默认档（10）会不会丢掉真最优（2026-09-24，**实测无损失 ⇒ 不实施**）

**问题**：生成器按「价值顺序」产出候选，`candidateLimit` 从**尾部**截断（§22.3/§28 只做了透明化）。
生产三档上限 = 快速 6 / 标准 10 / 上限 20（`triggerOptimizerDomain.js` :54/:64），而伤害槽的生成数
（实测 21 条）超过默认档 ⇒ 尾部整段不评估。这份「损失」此前从未被量化。

**装置（零额外采样）**：截断 = 保序切片（`materialize` 后 `slice(0, limit)`），所以「上限 N 档实际评估的
集合」= 采样池（按上限档生成）的**前 N 条** —— 直接比「前 N 条最优」与「全池最优」，复用 §33 的同一批
32 种子 × 4h 样本（脚本「候选上限截断的代价」段）。

**实测（4h / tier 0 / 32 种子）**：

| 项                | 槽 2（firestorm）            | 槽 3（flame_blast）                       |
| ----------------- | ---------------------------- | ----------------------------------------- |
| 生成 / 采样池     | 21 / 20 条                   | 21 / 20 条                                |
| 全池最优（位置）  | 0.00000（第 2 条 `current`） | **0.01978**（第 4 条 `enemyGroupHp 800`） |
| 上限 6（快速档）  | Δ **0.00000**                | Δ **0.00000**                             |
| 上限 10（标准档） | Δ **0.00000**                | Δ **0.00000**                             |
| 上限 20（上限档） | Δ 0.00000                    | Δ 0.00000                                 |

- **判读**：三档上限的真实分**完全相同**，池最优分别落在第 2 / 第 4 条 —— 连最省的快速档（6 条）也把
  最优装进来了。⇒ 截断方向**无提升**，不实施（不动默认上限，也不重排）。
- **诚实边界**：生成 21 条是**这两个槽**在 jungle_planet tier 0 下的实数；条件更多的角色（例如带多条
  跨技能窗口的技能）可能生成更多，尾部被截的风险随之升高。§28 的「生成数 / 截断数」上屏仍是正确的护栏
  —— 它让这种风险**可见**；本节只证明「当前两个槽没有付出这份代价」。

---

## 35. 组合候选缺口：把已验证的单腿互相合取（2026-09-24，**实测无提升 ⇒ 不实施**）

**问题**：夹具里两个槽的**当前配置本身就是一条组合**（`[敌方活敌数 ≥ 1] AND [敌方总血量 ≥ 500]`），而
生成器的组合候选只做 4 种固定搭配（`compositeCandidates`：斩杀×蓝量 / 敌人数×蓝量 / 自身残血×蓝量 /
增益门×敌方总血量）。两个从未被测过的方向：① 把池里**胜出的单腿**（`enemyGroupHp GTE`）与「守卫腿」
合取（含当前配置自己写的那条 `[活敌数 ≥ 1]`，池里不生成 —— 阈值网格是 2/3）；② 与该腿从未搭配过的
已有腿（敌人数 / 波内进度 / 增益窗口 / 蓝量）合取。

**装置**：在 §33 的合成机制上加一层「腿 × 腿」——腿**从池里读**（数值与生产逐字节一致），守卫腿从
`current` 锚点读；每槽合成 10 条（2 条 HP 腿 × 5 条第二腿），全部过 `sanitizeTriggerList` 自证；
采样 96 配置 × 32 = 3072 场（脚本「组合候选缺口」段）。

**实测（4h / tier 0 / 32 种子）**：

| 项                         | 槽 2                             | 槽 3                                       |
| -------------------------- | -------------------------------- | ------------------------------------------ |
| 现有池最优                 | 0.00000                          | +0.01978                                   |
| 组合族最优                 | −0.01119（`HP≥800 且 活敌数≥1`） | +0.01978（同一条，**与池最优并列**）       |
| **杠杆**                   | **−0.01119**                     | **0.00000**                                |
| 族被选中率 / 配对差（B−A） | 0.0% / 0.00000                   | 8.8% / **−0.00112 ± 0.00017（t = −6.71）** |

- **判读**：① 组合族最好的成员在槽 3 只是**与现有池最优并列**（把守卫腿加回去既不加分也不减分），杠杆
  0.000 < 门槛；槽 2 直接为负。② 更关键的是采纳侧：把组合放进池子**逐试验配对差为负且显著**（t = −6.71）
  —— 组合与单腿在决定轮打平时，`compareCandidates` 优先距离更小的单腿（distance 2 vs 3），而被选中的
  组合在留出组上略差 ⇒ 加它只会**稀释决策质量**。⇒ **无提升，不实施**。
- **机制解释**：合取只能**收紧**释放条件，而本次两个槽的现状已在正确一侧（槽 2 的池最优就是「原样
  不动」）；§33 的两把尺子也一致显示「限制越少分越高」。本轮是先验偏负、再用实验确认（先量化后实施）。
- **诚实边界**：只测了「敌方总血量腿 × 5 条第二腿」这一族组合、单个夹具 / 两个伤害槽；其它腿的组合
  （例如跨技能窗口 × 波内进度）未测，结论不得外推到其它区域与其它角色。

### 候选生成三条缺口的合计结论（2026-09-24）

| 方向                   | 问题                 | 实测                                       | 处置   |
| ---------------------- | -------------------- | ------------------------------------------ | ------ |
| §33 敌方最残血百分比门 | 缺一条合法条件族     | 杠杆 −0.079 / −0.126                       | 不实施 |
| §34 候选上限截断       | 尾部整段不评估       | Δ = 0（6/10/20 三档同分）                  | 不实施 |
| §35 腿的组合           | 已验证的腿不互相合取 | 0.000 / −0.011；采纳侧 −0.0011（t = −6.7） | 不实施 |

⇒ 至此「候选生成 / 阈值质量」这条线上的三个可测缺口都已量化完毕；再加上 §32 的实测天花板（同轴阈值
精度 ≤ 0.006、精炼行走 1pp 天花板 0.0023），**本夹具上不存在 ≥ 0.01 的候选侧提升空间**。要继续找提升，
应换别的轴（报告与交互、成本与耗时；「其它区域」这一轴已由 §36 复核关闭），而不是继续往候选生成器里加料。

---

## 36. 阈值网格适配：换个区域，现有网格漏不漏 ≥ 0.01（2026-09-24，**实测无杠杆 ⇒ 不实施**）

**问题**：默认阈值网格每族只有 2-3 档（`enemyGroupHpPercent = [25, 50]` 等），而怪物血量结构随区域
剧烈变化（侦察实测：多怪图 jungle_planet = `{min 500, max 4400, group 3200, waveSize 4}`、aqua_planet =
`{350, 2800, 2330, 4}`；单怪图 black_bear / abyssal_imp = `{min=max=group 1300 / 1800, waveSize 1}`；
`enchanted_fortress` / `chimerical_den` 读不到 enemyHp（资源降级 ⇒ 该族整类不生成））。「网格没适配这个
区域」的漏分此前从未量化。

**装置**（脚本「阈值网格适配」段，**零额外采样**）：

- **上界口径（对假设最有利）**：该家族在 **5..95% 全网格**上最优的真实分 = 「阈值调到完美」的天花板；
  漏分 = 天花板 − 该槽现有池最优（同一批 CRN 种子、同一参考系、都是 in-sample）。低于门槛 0.01 ⇒ 即使
  做「区域自适应阈值」也买不回成本，方向直接关掉。
- 新增 `--zone=<zoneHrid>`（换区域）与 `--probe=1`（只打印该区域的 `enemyHp` 结构与各槽候选规模、
  不采样，用于挑结构不同的区域）。
- 采样网格由精炼扫描的 BFS 闭包给出（点都是**生产生成的候选**，逐字节同源）。

**实测（4h / tier 0 / 32 种子）**：

| 区域（结构）                    | 槽            | 池最优（真实分）  | 全网格最优（阈值）    | **漏分**     |
| ------------------------------- | ------------- | ----------------- | --------------------- | ------------ |
| jungle_planet（多怪 wave4）     | 2 firestorm   | 0.00000 `current` | 0.00398（15%）        | **+0.00398** |
| jungle_planet（多怪 wave4）     | 3 flame_blast | 0.01978（`800`）  | 0.02543（33%，1pp）   | **+0.00565** |
| aqua_planet（多怪 wave4，2330） | 2 firestorm   | 0.00000 `current` | 0.00595（17.5%，1pp） | **+0.00595** |
| black_bear（单怪 wave1，1300）  | 2 firestorm   | 0.00193（`325`）  | 0.00357（15%）        | **+0.00163** |
| abyssal_imp（单怪 wave1，1800） | 2 firestorm   | 0.00000 `current` | 0.00283（35%）        | **+0.00283** |
| abyssal_imp（单怪 wave1，1800） | 3 flame_blast | 0.00054（`900`）  | 0.00100（35%）        | **+0.00046** |

- **判读**：六个数据点的漏分全部 **≤ 0.00595**（门槛 0.01，差 1.7 倍以上），而且这是**对假设最有利的
  上界口径**（in-sample 的全网格最优）。⇒ 阈值网格适配**无杠杆，不实施**（不做区域自适应阈值、不扩默认
  网格）。响应曲线在最优附近是**平的**（19~~91 个网格点之间的落差只有 0.001~~0.006）——阈值精度本来就
  不是这条线的杠杆，这与 §32「1pp 天花板 0.0023」完全同向。
- **形状观察**：最优阈值稳定落在 **15%~35%**（默认网格的 25% 档贴着最优、50% 档偏严）；单怪图上整个
  家族几乎没有价值（池最优 ≈ 0，网格最优 ≤ 0.0036）——优化器的收益本来就集中在「AOE 别丢在残血波上」。
- **装置层面的两个教训（已修，记档）**：
  1. **取整漂移让 BFS 闭包爆炸**：敌方血量类精炼走 `value → 百分比 → ±step → value` 的往返换算
     （`buildRefinementCandidates` 的 `REFINE_ENEMY_HP_SPECS` 分支），尺度不是 100 的整数倍时每级带一点
     取整漂移（aqua_planet `group = 2330 ⇒ unitsPerPercent = 23.3`），研究脚本求全闭包时同一名义百分比
     会裂成多个相邻取整值（实测 **2116 点 → 坍缩到 91 个整数百分比**，采样量从 69568 场回到 5376 场）。
     **生产不受影响**（精炼只走 4 级 ≤ 8 次评估，§24 的口径）；脚本改为按整数百分比去重后采样。
  2. **§32 的对照臂在漂移下不可信**：网格取点（`byPercent`）与生产的 ±step 邻域会差半个格点（1387 vs
     1398）——脚本现在检测到闭包被压缩过就**明确跳过对照臂**（`controlArmUsable = false`），对齐自检改成
     两档口径（逐字节一致 / 同构 + 值差 ≤ 1），不再硬断言。§32 的原结论（jungle，整数尺度、逐字节一致）
     不受影响。
- **诚实边界**：4 个区域 × **tier 0**、**同一角色夹具**（仓库里没有其它角色夹具，「换角色」这一半测不了）、
  **一个家族**（`enemyGroupHp`，其余家族的阈值网格未逐一扫）；5pp 网格行的上界按 jungle 的「1pp − 5pp
  增量 +0.0023」修正后仍 < 0.01。结论不得外推到更高 tier 与其它角色。
- **回归**：`npm test` 179 文件 / 2528 用例全绿；`npx prettier --check .` ✓；`npm run build` ✓；
  `npm run check-dead-keys` ✓。本轮改动 = 研究脚本 + 本文档，**生产代码零改动、未提交 git**。

---

## §37 报告与交互的语义精度审计（2026-09-24）

**判据**（用户口径）：每处修改必须消除一个**可复现的「文案与底层状态不符」**；核实无错配的线索如实记录、
不制造改动（与 §33–§36「无提升 ⇒ 不实施」同源的诚实纪律）。

**审计范围**：结论卡 / 应用区 / 运行进度区 / 逐技能卡片 / 详情弹窗（`TriggerOptimizerAbilityDetails.vue`）/
结果说明弹窗（`TriggerOptimizerNotes.vue` + `resultNotes`）/ 换难度复核块的**全部上屏文案与状态源**对照
（`triggerOptimizerText.js`、`TriggerOptimizerPage.vue`、zh/en `common.json`、`triggerOptimizerScoring.js`
的 verdict 产出端、`simulatorTriggerOptimizerActions.js` 的 runtime 状态机）。

### §37.1 唯一证实的错配（已修复）

- **结论卡「复验结论」行缺 verdict 兜底**（`TriggerOptimizerPage.vue` 模板插值键
  `common:triggerOptimizer.verdicts.${verification.verdict}`，缺 `|| 'unknown'`）：`verification` 存在但
  缺 `verdict` 字段（旧报告 / 异常收尾）时插值出**原始键** `common:triggerOptimizer.verdicts.undefined`
  上屏，与同卡 headline 自相矛盾——后者经 `verdictKind`（带 `|| 'unknown'` 兜底）渲染「样本不足，结论待定」。
  可复现：注入去掉 `verdict` 字段的 `verification` 即见原始键。
- **修复**：补 `|| 'unknown'` 兜底，与全仓其余 5 处动态 verdict 键同口径（详情弹窗 3 处、robustness
  1 处、`verdictKind` 1 处）。i18n **零新增键**（复用 `verdicts.unknown`「样本不足」，zh/en 已对称）。
  模板测试 +1（`falls back to the unknown verdict text when the verification record lacks a verdict`，
  含「不得渲染原始键」断言）。

### §37.2 核实无错配的 7 条线索（不改）

1. **`roundLimitReached` 不是死代码**：交接时「疑似无渲染」——实际它在**结果说明弹窗**的 `roundLimit`
   条目上屏（`resultNotes`，显示条件 = `improved && results.roundLimitReached`，模板测试覆盖），
   只是不在结论卡模板里。
2. `verdictHeadlines` 7 键（positive/negative/inconclusive/unknown/missing/evidenceBlocked/noImprovement）
   zh/en 全覆盖，`verdictKind` 取值全集封闭 ⇒ 无缺键渲染。
3. `verdictHeadlines.missing`「结论未经独立复验」与状态（improved && 无 verification）相符。
4. `verificationNoteText` 4 分支（noImprovement / evidenceBlocked / missing / else→verificationHint）
   逐条与状态相符。
5. `formatTriggerLine` 的 `endsWith('_equal')` 对比较器全集（`less_than_equal` / `greater_than_equal` /
   `is_active` / `is_inactive`）判断**全部正确**（前两者显 value、后两者不显）；`configsMatch` 集合口径与
   引擎「多触发器 = 与」语义一致（顺序无关、重复条目幂等，见 `candidate.andHint`）；`areTriggerListsEqual`
   全仓无引用（死导出，不影响任何显示；收尾顺手清理时已整段删除，`configsMatch` 是唯一判据）。
6. `signals` / `verdicts` / `robustnessVerdicts` / `metricSignificance` 键集与 `summarizeSamples` 的
   verdict 全集（positive/negative/inconclusive/unknown）完全覆盖，`significanceKey` 三态映射封闭；
   全部动态键均带兜底（§37.1 修复后 6 处一致）。
7. `phases.${runtime.phase}` 动态键安全：store 侧 `createTriggerOptimizerState` 初始 `phase: 'idle'`
   （`simulatorTriggerOptimizerActions.js`），主搜索发布值（preparing/baseline/searching/verifying/
   done/cancelled/error）⊆ 8 键；robustness / verify-append 的运行态写独立子块（`runtime.robustness` /
   `runtime.verifyAppend`），不进主 phase；`liveStats` 运行结束回落报告真实值（页面注释口径）。

### §37.3 观察项（① 已按方案 A 修复；② 不修）

- **① 刷新 / 重进后阶段行显示「未开始」——已按用户拍板的方案 A 处理（2026-09-24，收尾相位回填）**：
  `!running && hasResults` 时阶段行不再读 `runtime.phase`（刷新后回 idle），改由报告收尾状态推导——
  `results.cancelled` → 「搜索已停止」/ `results.error` 非空 → 「搜索异常中断」/ 其余 → 「搜索已完成」
  （复用 `phases.done/cancelled/error`，i18n 零新增键）；运行中仍如实显示实时相位。生产代码 = `phaseKey`
  计算属性 + 模板 1 行；模板测试 +1（`backfills the finish-state phase from the report when the run
is over`，覆盖 done / cancelled / error 三态）；回归四项全绿（同 §37.4 口径）。
- `verificationHint`「固定 6 轮配对比较」在追加复验合并（M > 6 轮）后描述略旧，但同屏有「已复验 N 次 ·
  合并 M 轮」精确留档 ⇒ 不构成硬错配。

### §37.4 回归与边界

- 改动面：生产代码 **1 行**（模板兜底）+ 模板测试 **1 例**；i18n 零改动；其余文件只读。
- **回归**：`npm test` 179 文件 / **2529** 用例全绿（`vitest run && prettier --check .`）；
  `npx prettier --check .` ✓；`npm run build` ✓（26.8s）；`npm run check-dead-keys` ✓（en/zh 各 143 键、
  0 死键）。
- **未提交 git**（连同 §33–§36 的研究装置与文档一并等用户 add）。

---

## §38 预算缩减回放：同一批采纳决策下能省多少场次？（2026-09-24，「③ 成本/耗时」）

**研究问题**：两段式采样的预算（粗筛 2 轮 / keep 3 / 精测 5 轮）哪一档能减，而不改变采纳决策？

**装置**（racing-study 脚本「预算缩减回放」段，**零额外采样**）：与 §30.8 同一份样本矩阵（96 配置 ×
32 种子 × 4h = 3072 场真实模拟）、同一组 bootstrap perm 切分（粗筛 2 / 精测 5 / 留出 25；500 trials ×
2 槽）。各减预算臂的 screen/decide 取切分**前缀**（只少看样本）；筛选规则的 keep 参数化
（`pickSurvivorsWithKeep`——全脚本唯一手写判据副本，keep=3 时**每 trial 断言**与生产
`pickRacingSurvivors` 输出签名级全等）；打分/排序/采纳判据（`scoreCandidate` / `compareCandidates` /
`shouldAdoptCandidate`）全走生产。**决策复现** = 与 P 臂（生产参数、同一 perm 切分）的
`(winner 签名, 采纳?)` 全等；真实分 = 留出组（与筛选/判据样本不相交）独立评估。

**预注册判据**（跑之前写死在输出末行）：复现率 ≥ 99% ∧ 假采纳率不升 ∧ 真实分Δ(臂−P) 均值 ≥ 0 ∧
真最优进精测率不降 ⇒「同结论省时」成立；任一条不满足 ⇒ 不实施。

**实测**（4h / tier 0 / jungle_planet / 32 种子 / 500 trials；槽 2 firestorm **无提升**、槽 3
flame_blast **有真提升**（真最优 `enemyGroupHp 800`，+0.01978））：

| 臂（粗筛/keep/精测） | 决策复现率 槽2 / 槽3 | 真最优进精测 槽2 / 槽3 | 假采纳 槽2 / 槽3 | regret 槽2 / 槽3  | 真实分Δ(臂−P) 槽2 / 槽3（配对 t）   | 场次 槽2 / 槽3 | 省            |
| -------------------- | -------------------- | ---------------------- | ---------------- | ----------------- | ----------------------------------- | -------------- | ------------- |
| **P 生产 2/3/5**     | —                    | 100% / 99.8%           | 0% / 0%          | 0.00088 / 0.00016 | —                                   | 59 / 64        | —             |
| H1 粗筛1 1/3/5       | 98.6% / **99.4%**    | 100% / 100%            | 0% / 0%          | 0.00089 / 0.00007 | −0.00002(t=−0.2) / +0.00009(t=1.7)  | 39 / 44        | **34% / 32%** |
| H2 keep2 2/2/5       | 98.4% / 97.8%        | 100% / 98.4%           | 0% / 0%          | 0.00078 / 0.00022 | +0.00009(t=1.5) / −0.00006(t=−0.6)  | 55 / 60        | 7% / 6%       |
| H3 精测3 2/3/3       | 90.8% / 69.8%        | 100% / 99.8%           | 0.2% / 0%        | 0.00160 / 0.00065 | −0.00072(t=−3.4) / −0.00049(t=−4.0) | 51 / 55        | 13% / 15%     |
| H3b 精测2 2/3/2      | 80.8% / 52.8%        | 100% / 99.8%           | **1.8%** / 0%    | 0.00303 / 0.00128 | −0.00216(t=−7.5) / −0.00113(t=−6.2) | 48 / 50        | 19% / 23%     |
| H4 组合 1/2/3        | 91.6% / 68.0%        | 100% / 94.2%           | 0.2% / 0%        | 0.00145 / 0.00090 | −0.00058(t=−2.8) / −0.00074(t=−4.3) | 29 / 32        | 51% / 50%     |
| H5 极限 1/2/2        | 82.6% / 54.4%        | 100% / 94.2%           | **1.8%** / 0%    | 0.00272 / 0.00131 | −0.00184(t=−6.5) / −0.00115(t=−5.4) | 26 / 28        | 56% / 57%     |

（场次口径与 §30.8 同款：pool×粗筛 + 幸存者均值×精测；墙钟与场次近似线性——实测 3072 场 / 278s
= 11 场/s @ 8 workers ⇒ 省 34% 场次 ≈ 省 1/3 墙钟。）

**判读**：

- **六臂无一通过预注册判据 ⇒ 不实施任何预算缩减，生产采样参数零改动**（`SCREEN_ROUNDS=2` /
  `RACING_KEEP=3` / 默认精测 5 轮全部保留）。
- **最接近的是 H1（粗筛 2→1，省 32~34%）**：槽 3 四条全过（复现 99.4%、Δ 还略正 +0.00009）、
  槽 2 复现率 98.6%（500 次里 7 次决策翻转）差 0.4pp。「同一批采纳决策」不成立 ⇒ 按判据放弃。
  值得注意：H1 的真最优进精测率两槽都保持 100%（漏采仍为 0）——粗筛减到 1 轮的损失集中在
  「同分段候选的排序噪声」（翻转多发生在锚点与近分候选之间），不是漏掉最优。
- **精测轮数是决策质量的命门**：5→3 复现率掉到 69.8~~90.8% 且真实分Δ 显著为负（t=−3.4/−4.0）；
  5→2 更差（复现 52.8~~80.8%、**无提升槽假采纳率 0%→1.8%**）——与 §20「rounds=2 dof=1 无功效、
  别退回 2 轮」完全同向，且**新增实证**：3 轮也不够（精测预算不可减）。
- **keep 3→2 不划算**：只省 6~~7% 场次，复现率掉 1.2~~2.2pp、真最优进精测率掉到 98.4%（漏采出现）。
- 组合臂（H4/H5）省 50%+ 但质量全面退化（复现 54~~92%、Δ t=−2.8~~−6.5）：省一半的代价是
  决策大面积翻转，明确不实施。
- 结论级预算（复验 6 / 深挖 6 / 稳健性 6）本轮**不在范围**：§20/§31 已各自实证过必要性，
  且它们是「结论级」检查而非搜索期采样。

**诚实边界**：单角色夹具（仓库唯一）、jungle_planet tier 0、两个 20 候选手槽、4h、500 trials；
「复现率 ≥99%」是逐槽逐 trial 口径。换区域/换角色/其它时长前不得外推（但「精测轮数不可减」
与 §20 独立实测同向，可信度较高）。

**装置自证**：keep 参数化副本与生产 `pickRacingSurvivors` 在每个 keep=3 的 trial 上签名级全等
（断言全过）；同一矩阵上 §30.8/§31/§33/§35/§36 各段数字与此前记录逐位复现。

**回归**：`npm test` 179 文件 / 2529 用例全绿（`vitest run && prettier --check .`）；
`npx prettier --check .` ✓；`npm run build` ✓（41s）；`npm run check-dead-keys` ✓（en/zh 各 143 键、
0 死键）。本轮改动 = 研究脚本「预算缩减回放」段（~130 行）+ 本文档，**生产代码零改动、未提交 git**。

---

## §39 泛化复测：熊熊星球 T0 全电池重跑（2026-09-24，「换图再测」）

**动机**：§32–§38 的结论全部出自同一场景（`jungle_planet` tier 0、4h、槽 2/3）。应用户要求换
**熊熊星球**（`/actions/combat/bear_with_it`——多怪图：enemyHp min 1200 / max 6800 / group 7000 /
waveSize 3，与丛林 500/4400/3200 结构显著不同）T0 全电池重跑，检验已关闭方向会不会翻案。

**装置**：同一研究脚本 / 同一玩家夹具（`modernPlayerJunglePlanetFixture`，玩家侧不变）/ 同一套
预注册判据，仅 `--zone=/actions/combat/bear_with_it --tier=0`（4h / 32 种子 / 500 trials / 8 workers /
槽 2,3；3072 场 / 198.3s = 15.5 场/s）。冒烟（0.1h / 14 种子）曾报 §35 组合 +0.03987(t=2.83)、§36 网格
+0.02416 两个「有提升」——**正式跑全部翻负** ⇒ 小样本 in-sample 上界会虚高，一律以正式数字为准
（教训：冒烟只验链路，不下结论）。

**结果与判定**（槽 2 = firestorm、槽 3 = flame_blast；两槽均有真提升：真最优分别 `deadUnitsAtMost
{count:0}` 0.04907 与 `enemyGroupHp 1750` 0.08937）：

| 段               | 熊熊 T0 正式实测                                                                                                     | 对照（丛林）      | 处置                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| §30.8 racing     | 选择偏差 0.0285/0.0073（全精测 0.0358/0.0153）、假采纳 3.4%/0.0%、真最优进精测 65.6%/91.4%、省 38%/36%               | 同向              | 维持现状                                                    |
| §38 预算缩减     | 六臂复现率 **25.6~82.8%** 全部 ≪99%；真实分Δ 全负（t=−2.3~−10.8）；H3b/H5 无提升槽假采纳升至 11.4%/12.0%             | H1 近失 98.6/99.4 | **不实施**（H1 近失就此关闭：熊熊仅 69.6/74.2，换场景不稳） |
| §31 追加复验     | 确认率 6.1%→11.3%（槽2）/ 30.3%→61.3%（槽3）；假阳性 0.2%/0.1% 不升                                                  | 同向              | 维持保留                                                    |
| §33 残血门族     | 杠杆 −0.0885 / −0.1407                                                                                               | 同向（负）        | 不实施                                                      |
| §35 组合候选     | 杠杆 −0.03236 / **0.00000**；② 配对差 −0.00211(t=−3.45) / −0.00415(t=−6.23)                                          | 同向（无提升）    | 不实施                                                      |
| §36 阈值网格     | 漏分 −0.01233（网格没漏分；池最优 `deadUnitsAtMost` 在 enemyGroupHp 网格外但更强）                                   | 同向              | 不实施                                                      |
| **§34 截断代价** | **槽 2 Δ = −0.03236**：真最优排**第 12 条**，上限 6/10（默认档）都丢、上限 20（精细档）才拿到；槽 3 Δ = 0（第 4 条） | 丛林两槽 Δ = 0    | **唯一真信号 ⇒ 实施形态待拍板**                             |

**§34 信号的实施选项**（预注册判读：「Δ < 0 ⇒ 重排（免费）或抬上限（更贵）才有价值」）：

- **A. 候选生成顺序重排（推荐，已实施 ⇒ 见 §39-A）**：候选家族交错排序（敌方总血量/敌人数/单体血量/死亡数/斩杀线/蓝量/
  自身残血轮流取代表），保证 top-N 每族有代表——**零评估成本**；实证判据 = 丛林 + 熊熊两场景重排后
  top-10 前缀最优 ≡ 全池最优（丛林不回退、熊熊槽 2 的 +0.03236 拿回），不达标就撤（实测：达标保留）。
- **B. 默认 `candidateLimit` 10 → 16/20**：简单粗暴，但每槽每轮评估 +60~100% 场次。
- **C. 不动**：单场景单槽证据（熊熊 T0 槽 2，全体种子聚合口径，非 500-trial 复现口径），继续观察。

**其它记录**：§32 精炼对照臂在 5pp 采样网格上跳过（装置限制，§32 已闭环无需复现）；研究脚本
「诚实边界」打印行的写死 `jungle_planet` 改为 `${args.zone}`（1 行文案修正）；本轮**生产代码零改动**。

---

## §39-A 家族交错重排：已实施并实证达标（2026-09-24，§34 信号的处置）

**预注册判据**（跑前写死）：丛林 + 熊熊 T0 两场景重排后各槽 top-10 前缀最优 ≡ 全池最优（默认档
上限 10 的 Δ 全 = 0；丛林不回退、熊熊槽 2 的 +0.03236 拿回）⇒ 达标保留；不达标撤回本轮全部改动。

**落地**（生产改动 1 处 + 测试契约适配 5 处，零评估成本）：

- `src/services/triggerOptimizerCandidates.js` 新增 `interleaveCandidatesByFamily`：按**族键 =
  `labelKey + '|' + labelParams.conditionHrid`** 分组，组内保持生成序（= 价值顺序），族间按各族
  首条生成序 round-robin 轮转。族键必须含 `conditionHrid`：同标签不同条件是不同方向
  （buffWindow{guardian_aura|berserk|frenzy} 各占一族，初版只用 labelKey 会把三族并成一族打散
  截断）；档位型多值（lowHp{50,75}、enemyGroupHp{25,50}、deadUnitsAtLeast{1,2}）仍归同族轮转。
  锚点（default/current/alwaysFire）是各族首条且生成序最前 ⇒ 天然保持原位。
- `finalizeCandidatesWithStats` 唯一改动 = `materializeCandidates(...)` 后套
  `interleaveCandidatesByFamily(...)` 再 `slice(0, limit)`；`generated` 口径不变（交错不改数量），
  主生成与精炼追加路径共用此函数。
- 测试契约适配 `src/services/__tests__/triggerOptimizerCandidates.test.js` 5 处（singles 顺序、
  「候选上限」截断、窗口顺序等断言改为家族交错契约；定向 5 文件 115/115 全绿）。

**实证**（同 §39 装置/夹具/参数：4h / 32 种子 / 500 trials / 8 workers / 槽 2,3，两场景重跑
408s；研究装置 §34 段自动走生产排序，采样池 = 上限档生成 20 条，前缀 N 条 = 生产上限 N 档会
评估的集合）：

| 场景    | 槽            | 全池最优（重排后位次）                                                        | 上限 6 Δ     | 上限 10 Δ | 上限 20 Δ |
| ------- | ------------- | ----------------------------------------------------------------------------- | ------------ | --------- | --------- |
| 丛林    | 2 firestorm   | 0.00000 `current {}`（第 2 条，无提升）                                       | +0.00000     | +0.00000  | +0.00000  |
| 丛林    | 3 flame_blast | 0.01978 `enemyGroupHp {"value":800}`（第 4 条）                               | +0.00000     | +0.00000  | +0.00000  |
| 熊熊 T0 | 2 firestorm   | 0.04907 `deadUnitsAtMost {"count":0}`（**第 10 条**；重排前生成第 12 条被丢） | **−0.03236** | +0.00000  | +0.00000  |
| 熊熊 T0 | 3 flame_blast | 0.08937 `enemyGroupHp {"value":1750}`（第 4 条）                              | +0.00000     | +0.00000  | +0.00000  |

**判读**：主判据（默认档上限 10）四槽 Δ 全 = 0 ⇒ top-10 前缀最优 ≡ 全池最优——丛林不回退（槽 3
真最优仍在第 4 条），熊熊槽 2 的 **+0.03236** 如数拿回（真最优 `deadUnitsAtMost {"count":0}` 从
生成第 12 条挪进重排后第 10 条）⇒ **达标，A 保留**。快速档上限 6 如实记录：熊熊槽 2 仍 −0.03236
（真最优第 10 条落在 6 档外，与预判一致，不构成判据失败），其余三槽 Δ = 0——要 6 档也拿到只能
抬上限（选项 B，+60~100% 评估成本），成本/收益不成比例，不做。**选项 B / C 随 A 达标关闭**。

**回归**：`npm test`（vitest run && prettier --check .）/ `npm run build` /
`npm run check-dead-keys` 全绿（en/zh 各 143 键、0 死键）。本轮改动 = 生产 1 处 + 测试契约 5 处 +
本文档，**未提交 git**（等用户 add）。

---

## §40 报告落盘恢复 + 导出 Excel（2026-09-25，菜单 A）

**需求与判据**（预注册）：① 刷新/重进后**最近 1 份报告可恢复**（版本闸门同 settings.v1，
损坏/版本不符静默忽略）；② **导出 Excel 可下载且人可读**（界面同款文案、不出现字段名、
文件名带时间戳）——判据②原定「导出 JSON」，**用户中途追问后变更为 Excel，JSON 方案作废**；
③ 既有用例只增不减 + prettier/build/死键全绿。

**恢复 vs 导出的定位**（互补，不是二选一）：恢复 = 自动防丢（§26.8 实录 dev 整页重载丢过
一次 124s 的运行；用户不用记得点任何按钮）；导出 = 手动带走（留存/分享）。Excel 只是副本，
救不回「还没导出就丢」的报告；恢复只在本机，带走/分享仍需导出——类比「自动保存 vs 另存为」。

**落地**：

- `src/services/simulatorStorage.js`：键 `mwi.triggerOptimizer.report.v1`（version=1）+
  `loadTriggerOptimizerReportFromStorage`（版本闸门 + 形状闸门 + `JSON.parse(JSON.stringify())`
  深拷贝解耦，脏数据静默 null）/ `persistTriggerOptimizerReportToStorage` /
  `clearTriggerOptimizerReportFromStorage`。
- `src/stores/simulatorTriggerOptimizerActions.js`：state 工厂 `results` 改为
  `loadTriggerOptimizerReportFromStorage() || createEmptyResult()`（刷新/重进自动恢复）；
  `trackResultStaleness` 在同一 effectScope 挂第二只 **deep watch**（函数名不改、注释说明双职责），
  results 任何变化（整体替换或原地写 stale / appliedInputSignature / 追加复验 / 稳健性复核 /
  apply-revert 的 $patch）统一落盘；`resetTriggerOptimizerResults` 显式 clear（**唯一删除点**：
  导入新存档 ⇒ 旧报告作废）。
- **防丢核心语义**：空结果**既不写也不删**存储（开跑清空后崩溃/刷新要能找回上一份）。
  实测踩坑：`createEmptyResult()` 自带 `createdAt: 0`，`Number.isFinite(Number(createdAt))`
  对 0 放行 ⇒ 空壳会把好报告覆盖掉（reset 后 clear 也被 watch 写回）——形状闸门收紧为
  「createdAt 必须是正时间戳」（与 UI `Boolean(createdAt)` 同口径），用例已锚定。
- `src/ui/components/triggerOptimizerExport.js`（新）：`buildTriggerOptimizerReportSheets`
  3 sheet（总结 / 逐技能对比 / 候选明细，纯函数单测驱动）+
  `downloadTriggerOptimizerReportXlsx`（照 MultiResultsPage 的 exceljs 范式：动态 import →
  writeBuffer → Blob → 临时 `<a>` → 回收；`mwi-trigger-optimizer-report-${Date.now()}.xlsx`）。
  文案全部复用 `createTriggerOptimizerText` + 注入 t（界面同款、零字段名）。
- **候选分数口径**（已实证，勿改）：chosen 自带重估分（`chosen.score`）；其余按「槽位|签名」
  （`${slotIndex}|${signature}`）读 `metricsByCandidate`（不同技能可产出同一签名，只按签名做键
  会串味）；非有限数留空不编 0。信号 = `entry.paired` 存在才有（verdict 缺失按 unknown），
  与卡片徽章同源。
- `TriggerOptimizerPage.vue`：结果区按钮组新增「导出 Excel」（`[data-trigger-optimizer-export]`）；
  `exportStatusFor` 逐字镜像卡片徽章四级分支（推荐 / 复验判负 / 已锁定 / 保持当前配置）；
  summaryRows 全部同源复用页面计算属性（verdictHeadline / changedAbilities / improvement /
  baselineScore / verification / verificationPValueLabel / scopeText / settings）。
- i18n zh/en 对称 **15 键**：`exportReport` + `export.*` 14 键（sheetSummary / sheetAbilities /
  sheetCandidates / conclusion / generatedAt / item / value / slot / ability / role / status /
  candidate / signal / triggers）；其余复用既有键。

**测试**（4 文件，+7 用例）：storage round-trip / 深拷贝解耦 / 静默回落；store 持久化 + 新
store 恢复、清空不删 + reset 显式删（含 `createdAt: 0` 空壳不覆盖）；导出纯函数 3 sheet /
表头 / configCell / 分数 / 候选行数 / summaryRows 透传；模板测试导出按钮 → download 入参
（report / statusBySlot / summaryRows）。

**回归**：`npm test`（vitest run && prettier --check .）**180 文件 / 2537 用例**全绿（基线
179/2530，只增不减）；`npm run build` ✓（27s，exceljs 保持独立 chunk）；`npm run check-dead-keys`
✓（en/zh 各 143 键、0 死键——检查器覆盖 queue 命名空间，本轮新增键在 triggerOptimizer 段，
计数不变）。本轮改动 = 生产 4 文件 + 新模块 1 + 测试 4 + locales 2 + 本文档。

## §41 净效应卡片直显（B）+ 引擎侧 3 观察项收口（C）（2026-09-25，菜单 B+C）

**B：净效应摘要上卡片直显**（§27.6 遗留）——逐技能卡片不打开弹窗就能看到「这个技能这一次改动
赚了什么」：

- `src/ui/components/triggerOptimizerText.js` 新增共享纯函数：`buildNetMetricRows(choice)`（指标
  键 = `[...TRIGGER_OPTIMIZER_METRIC_KEYS, 'deathsPerHour']` **唯一权威列表**，卡片/弹窗共用；
  数据源 `choice.chosen.paired.metrics`——参考系是本槽开跑配置，逐指标配对差即本槽净效应；
  `mean` 非有限**不产行**（不把 null 当 0），`stdError` 缺失存 null 渲染「± —」（防
  `Number(null) === 0` 的假「± 0」））+ `netMetricSignificanceKey(verdict)`（positive|negative →
  significant、inconclusive、unknown，**方向中立**：死亡显著下降也是「显著」，不套「更差」）。
- `createTriggerOptimizerText` 新增 `netDeltaText(row)`（均值 ± 标准误文本）与
  `netMetricSignificanceLabel(verdict)`（`common:triggerOptimizer.metricSignificance.*` 一族）。
- 卡片（`TriggerOptimizerPage.vue` 的 `netMetricRowsFor`，摘要条插在配置对比与 `<footer` 之间）
  与弹窗（`TriggerOptimizerAbilityDetails.vue` 的 `netMetricRows`）同判据**只在采纳时渲染**
  （未采纳的槽没有「本槽改动」，摆表会把别的技能的提升记到它头上）。卡片 data 属性特意与弹窗
  区分防测试全局选择器双计：`data-trigger-optimizer-net-summary-metric/-significance` vs 弹窗
  `data-trigger-optimizer-net-metric` / `-net-significance`。i18n **零新增**（复用 netMetricsTitle /
  metrics.\* / metricSignificance.\*）。
- 测试 +1（模板）：4 指标 4 chip（mean null 不产行）/ 文本含「每秒伤害」「+3.5」「± —」/
  significance 2×significant（positive + negative 都算显著）+ 1×inconclusive；`makeResult` 夹具的
  chosen 不带 `paired`，其余用例不渲染摘要条、不双计。

**C：引擎侧 3 观察项收口**（先证真再动手）：

- **C1** `src/combatsimulator/combatUnit.js`：`zoneBuffs`/`extraBuffs` 字段默认值 `{}` → `[]`。这两
  项是数组（`generatePermanentBuffs` 逐条 `.forEach`），对象默认值会让「未赋值就 generate」直接
  TypeError（对照 `houseRooms`/`guildBuffs` 默认本来就是 `[]`）。
- **C2** `src/worker.js` 空数组 truthy 边界——**定性结论：不完全互斥 ⇒ 显式选 buff**：
  - 四个 `start_simulation` payload 生产端中三个严格互斥（`buildSingleSimulationPayload` 的
    if/else、`multiWorker` 单键消息、`advisorDomain` 的 `labyrinth: null`），唯
    `HomeExperimentalModal.vue` 批处理**透传用户 JSON 不校验互斥**，zone/labyrinth 可同时非空。
  - 引擎语义 = **迷宫优先**（`CombatSimulator` 三处一致：`scrollsAllowed = !labyrinth`、模式标签
    `this.labyrinth ? 'labyrinth' : ''`、遭遇取用 `if (this.labyrinth)` 后写覆盖）。
  - 落地：`currentPlayer.zoneBuffs = (labyrinth ? labyrinth.buffs : zone?.buffs) || [];` + 注释钉住
    语义。三条互斥路径下与旧写法 `zone?.buffs || labyrinth?.buffs || []` **逐值等价**；唯一变化在
    双非空边界：旧写法在 `zone.buffs` 为空数组（truthy）时短路、**静默吞掉迷宫 buff**（且有无
    zone buff 时行为不一致），新写法确定取迷宫 buff。
- **C3** `src/services/playerMapper.js` `buildGuildBuffPreviewSources`：删掉调用方的
  `structuredClone(buff)` 冗余克隆——`combatUnit.addPermanentBuff` 合同首写自带 `{ ...buff }`
  克隆、累加只读标量（typeHrid/flatBoost/ratioBoost 扁平结构），外部预克隆纯浪费（worker 全队
  共享 zoneBuffs/extraBuffs 也走同一契约）。

**测试**（+2 用例）：`combatUnitBuffSources.test.js` 新 describe 2 it——裸 `new CombatUnit()` 不赋
buff 直接 `generatePermanentBuffs()` 不抛（锚定 C1）；共享 buff 对象喂两个 unit + 重复累加，首写
克隆合同（first=2 / second=1 / shared 仍 1，锚定 C3 依据）。

**回归**：定向 vitest 4 文件 145 用例全绿；全量 `npm test` **180 文件 / 2540 用例**全绿（上轮
2537 + 新增 3，只增不减）+ `prettier --check .` ✓；`npm run build` ✓（24.7s，>500KB 大件不变：
playerMapper 2.35MB / gameData 1.99MB / index 1.68MB）；`npm run check-dead-keys` ✓（en/zh 各 143
键、0 死键）。本轮改动 = 生产 6 文件 + 测试 2 + 本文档（worker.js 属 C2）。

**编辑教训**（新增 2 条）：① 同文件同批次一处 edit 失败会留**断裂中间态**（本弹窗解构未匹配而
helpers 已删 ⇒ 模板引用未定义符号、打开即 ReferenceError）——批次内某文件有编辑失败时必须立即
通读该文件核对所有编辑的交叉依赖；② 该失败的根因是 searchContent 的**调用实参换行形态**与
prettier 重排后的单行形态不符（不是缩进）——任何 replace_edit 失败先重读原文逐字符拷贝，不凭
常规格式猜。

## §42 测试提速（E）：重文件拆分 + 「关隔离」实验否决（2026-09-25，菜单 E）

**目标与预注册判据**：全量 `npx vitest run` 墙钟从基线 59.7s 压到 **≤40s**（降幅 ≥33%）；硬约束 =
用例数 2540 不变、断言文本/语义零弱化（拆分只许「搬迁」）、prettier/build/死键全绿、连续 ≥2 次
全量绿。

**Exp1「关隔离」实验：否决并已还原**。给 `test` 块加 `pool: 'forks'` +
`poolOptions.forks.isolate: false` 后：9 文件 / 16 用例红（jsdom 文档串味 `themeAndSharedComponents` /
`selectLanguageBehavior` / `PatchNotesPage.behavior` / `MarketPriceIndicator.backgroundFailure`；
`vi.mock` 跨文件失效 `advisorDomain*` / `foodOptimizerFamilyFallback`；`resetModules` + 动态 import
破功 `foodOptimizerWorkerCost`；一行数值漂移 `combatUnitBuffSources`），而墙钟 57.1s vs 基线 59.7s
**几乎不降**：collect 371→254s、prepare 95→16s 全被吃掉 ⇒ **collect/prepare 不是墙钟瓶颈**。配置已
用 replace_edit 还原（`vite.config.mjs` 现 66 行、仅 `exclude` 一处 test 配置）。

**Exp0 旁证**（前一篇 trace 分析）：`utils+externalLinks` 在隔离全量的 11.55s 里窗口只有 0.70s。

**主杠杆：拆分两个重文件**（只搬迁，断言/超时 60000 逐字保留）：

- `foodOptimizerTopTen.integration.test.js`（13 场景 + 1 等价性）→ 场景体抽到
  `support/foodOptimizerTopTenHarness.js`（导出 `topTenScenarios` / `topTenScenariosFor(names)`
  ——未知名抛错 / `runTopTenScenario` / `runSearchModeEquivalence`），薄子文件 `foodOptimizerTopTen{A,B,C,D}`
  = 2+2+2+7 场景（D 另含等价性用例）；
- `foodOptimizerPruning.integration.test.js`（7 场景）→ `support/foodOptimizerPruningHarness.js`
  - `foodOptimizerPruning{A,B}` = 3+4 场景。
- 场景字面量与 oracle 体**只保留 harness 一份**（防多处副本口径分叉）；describe / it.each 文案与
  60000 超时原样。原两文件已删 ⇒ 文件数 180 − 2 + 6 = **184**。

**实测（三次连续全量）**：184 文件 / **2540 用例**全绿；墙钟 **60.9s / 59.1s**（vitest 内部
57.6s、62.4s）——**主判据①（≤40s）未达标，且相对基线 59.7s 无提升**。`npm run build` ✓（29.9s）、
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）、`prettier --check .` ✓。

**为什么没提升（trace 证据，关键结论）**：拆分确实把重活相位从基线「topTen 单文件 t=7→57」压成
「4 片 t≈24.2→40.7、pruning 2 片 t≈24.6→34.6 全并发」，但墙钟被别处吃掉：

- **有效并行度只有 2.9/8**：sum(单文件时长) = 151.7s，span = 52.1s；
- 前 25s 并发常年只有 **1-3** 个文件在跑（大量 0.1~0.5s 小文件在消化），t=41-43 出现 **3 秒空窗**，
  t=44-52 才是最后一批 ~17 个文件（`TriggerOptimizerPage.template` 4.4s 等）；另两个重活
  `axisOrder` 11.8s（t=6.1→17.8）、`playerRoundtripParity` 12.1s（t=16.8→28.9）各占中段一档；
- max 并发 = **7**（从未打满 8 fork ⇒ 不是 worker 不够）；
- 拆分的代价：4 片各自重新 collect + 重建夹具，topTen 总时长 50.3s → 59.5s（+18%）。

**结论**：本轮与 Exp1 两次独立证据一致——**全量墙钟不是「最长单文件」决定的**（把 50.3s 的文件拆
到 15.7s，墙钟纹丝不动；把 collect 砍 117s、prepare 砍 79s，墙钟也纹丝不动）⇒ 单文件 / 单模块级
开销对墙钟零杠杆；瓶颈在**批量调度与进程启停（184 个文件的 fork 启动 + 分发节流）**。后续杠杆应
瞄准「减少文件数 / 启停次数」或换 pool 模型（如 `threads`），而非继续拆文件。

**本轮改动** = 新增 8 文件（2 harness + 6 薄子文件）+ 删除 2 文件 + 本文档；生产代码零改动。

**C1 实验：`pool: 'threads'`（判据先立后验）**——针对「fork 启停」这条已定位瓶颈做最后一击：只把
`test.pool` 从默认 forks 改成 threads（**isolate 语义不变**，仅换进程模型），预注册「墙钟 ≤53s（较
59.7s 基线降 ≥10%）且 2540 用例全绿才保留」。实测**两次全绿（184 文件 / 2540 用例）**：墙钟
**56.9s / 55.4s**（vitest 内部 53.4s / 52.5s）——只快 ~6%，**未达判据**。收益结构可读：prepare
101→85s、collect 360→317s、environment 82→70s 三项全降，但 tests 155→182s **反升**（线程池下
CPU 密集用例更慢），净收益被吃掉。**按预注册当场还原**：`vite.config.mjs` 恢复 2011 字节原样、
`prettier --check` ✓。E 项到此收线——三条同向证据（Exp1 关隔离 / 重文件拆分 / threads 池）一致表明：
**全量墙钟不是任何单点配置改动能拿下的**，除非直接减少文件数与启停次数。

---

## §43 精炼行走实证与裁决（A）：保留机制与门槛，放宽门槛另立候选（2026-09-25，菜单 A）

**问题**：§32 把瓶颈定位到「精炼行走的启动率」（行走要启动，得有一级邻域候选的增量 ≥
`TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE` = 0.01 且配对证据 `|mean| > 2×SE`）。A 项先回答它的**前置问题**：这个
行走本身值不值得留 —— 若它在真实分上毫无贡献，正确动作是删掉它（省掉每采纳槽 2 次评估与一层复杂度），
而不是去优化启动率。

**判据演化（关键，勿读成「没提升就该删」）**：初版预注册判据「同预算下采纳值提升 ≥ 0.01」在开跑前就被
事实推翻 —— 这一轴的**可交付量结构上小于门槛**：§32.3 实测 1pp 精度上限只有 0.00000（槽 2）/ 0.00234
（槽 3），门槛却是 0.01 ⇒ 「≥ 0.01」在本轴**永远不可能达成**，拿它当判据只会得到一个假结论。改写后的判据
（已向用户声明）：① 用**留出种子**测「生产门槛 vs 无精炼」的真实分配对差（> 0 且过证据线才算有提升）；
② 如实报告评估成本；③ 无提升 ⇒ 删除行走；有提升 ⇒ 保留，并把「是否放宽门槛」作为**独立候选**（把
「精度」与「探索/寻优」两种动机分开算账）。

**装置**（`scripts/trigger-optimizer-racing-study.mjs` 的 §32 段扩展，**零新采样**、纯回放）：把原来的
「生产臂 vs 对照步长臂」扩成三条门槛臂，共享同一批真实样本、同一批起点、同一决策-留出切分 ——

| 臂               | 取点规则                                    | 采纳门槛                                                                            |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| 无精炼           | —（终值 = 起点本身）                        | —                                                                                   |
| 生产 10/5/5/5pp  | 生产 `buildRefinedCandidates`               | 生产 `shouldAdoptCandidate`（≥ 起点 + 0.01 且过噪声地板）                           |
| 放宽门槛（实验） | 生产 `buildRefinedCandidates`（同一条取点） | `score > base.score` 且 `hasAdoptionEvidence(paired)`（**去掉** `MIN_ADOPT_SCORE`） |

- 判据全部走生产实现（`compareCandidates` / `shouldAdoptCandidate` / `hasAdoptionEvidence` /
  `aggregateRoundMetrics` / `scoreCandidate`），脚本里不手搓判据副本；`runWalk(start, percentSteps, gate)`
  把取点与门槛参数化，三条臂走同一函数 ⇒ 不存在多份取点/门槛副本漂移。
- **「现实起点」子集** = 起点本身就在该家族的**真实候选表**里（`gridSignatures` = 生产候选表里的家族签名；
  1000 样本 = 2 起点 × 500 试验/档）—— 也就是生产真正会精炼的那些起点。其余 17 个起点是「不可能被精炼的
  非现实起点」，只作参照（把两者混在一起会高估行走的价值）。
- §32 的**对照步长臂**保留在同一段（门槛臂独立于它的可用性）：本轮它按预期**跳过** —— 生产步长 10/5
  （下限 5）⇒ BFS 网格就是 5pp，`--refine-steps=10,5,2,1` 取不到 2/1pp 的点。这不是故障（脚本有明确
  说明），复现 §32 的 1pp 对照需临时把 `REFINEMENT_PERCENT_STEP_FLOOR` 改成 1 后重新采样。

**实测**（4h / tier 0 / 32 种子 / 500 试验 / 8 workers / `--slots=2,3`，家族 `enemyGroupHp` @ 槽 2；191s，
EXIT=0）：

决策种子 2 / 留出 30（每方案 9500 个「起点 × 试验」样本）：

| 指标                   | 无精炼   | 生产 10/5/5/5pp | 放宽门槛 |
| ---------------------- | -------- | --------------- | -------- |
| 平均真实分             | −0.06296 | −0.04974        | −0.04878 |
| 平均 regret            | 0.06692  | 0.05370         | 0.05273  |
| 平均 \|终值 − 真最优\| | 36.58pp  | 33.72pp         | 33.02pp  |
| 平均评估次数           | 0.00     | 2.21            | 2.35     |
| 平均行走级数           | 0.00     | 0.35            | 0.51     |
| 走到 level ≥ 2         | 0.0%     | 7.0%            | 12.6%    |
| 终值与起点不同         | 0.0%     | 24.6%           | 31.7%    |

- 精炼净效应（生产 − 无精炼，真实分）：**+0.01322 ± 0.00035**（t = 38.15；胜 24.0% / 平 75.4% /
  负 0.6%）——**其中「现实起点」（1000 样本）：+0.00239 ± 0.00016**（t = 14.86；胜 20.0% /
  平 80.0% / 负 **0.0%**）
- 放宽门槛 − 生产（真实分）：+0.00096 ± 0.00004（t = 21.84；胜 9.9% / 平 87.8% / 负 2.3%）——其中
  「现实起点」：+0.00093 ± 0.00011（t = 8.53；胜 11.5% / 平 85.5% / 负 **3.0%**）
- 评估成本（生产 vs 无精炼，每「起点 × 试验」）：2.21 vs 0.00；越界跳过 0 次（默认区间下应为 0）。

决策种子 5 / 留出 27（每方案 9500 个「起点 × 试验」样本）：

| 指标                   | 无精炼   | 生产 10/5/5/5pp | 放宽门槛 |
| ---------------------- | -------- | --------------- | -------- |
| 平均真实分             | −0.06302 | −0.06265        | −0.06244 |
| 平均 regret            | 0.06684  | 0.06647         | 0.06627  |
| 平均 \|终值 − 真最优\| | 36.58pp  | 36.20pp         | 35.99pp  |
| 平均评估次数           | 0.00     | 1.75            | 1.80     |
| 平均行走级数           | 0.00     | 0.04            | 0.08     |
| 走到 level ≥ 2         | 0.0%     | 0.0%            | 0.8%     |
| 终值与起点不同         | 0.0%     | 3.9%            | 7.0%     |

- 精炼净效应（生产 − 无精炼，真实分）：+0.00037 ± 0.00002（t = 17.62；胜 3.8% / 平 96.1% / 负 0.1%）
  ——其中**「现实起点」：+0.00153 ± 0.00013**（t = 11.49；胜 13.1% / 平 86.9% / 负 **0.0%**）
- 放宽门槛 − 生产（真实分）：+0.00021 ± 0.00002（t = 11.90；胜 2.8% / 平 96.4% / 负 0.8%）——其中
  「现实起点」：+0.00025 ± 0.00006（t = 3.93；胜 3.5% / 平 94.9% / 负 1.6%）
- 评估成本（生产 vs 无精炼）：1.75 vs 0.00；越界跳过 0 次。

**判读（本轮最有价值的修正）**：

1. **行走不是死机制**：在生产真正会精炼的起点上（1000 样本），生产门槛稳定吃到 **+0.0015 ~ +0.0024 真实
   分**（两档决策样本同向、t = 11 ~ 15），且**负例率 0.0%**（一次都没把真实分走坏）。成本只是 +2 次评估 /
   采纳槽。**「能走到 level ≥ 2」的比例仍很低（0%/7.0%）**，但收益不依赖走深 —— 收益全部来自 level 0~1。
2. **「全起点」口径会高估**：把 17 个「生产永远不会精炼的非现实起点」算进去才有 +0.01322 —— 那些起点离
   真最优很远，行走当然能捡回大分。**主口径必须是「现实起点」**。
3. **放宽门槛确实能多拿，但开始付代价**：去掉绝对下限后多拿 +0.0009（决策 2）/ +0.0003（决策 5）真实分，
   终值与起点不同的比例也涨（24.6% → 31.7%），但**现实起点上出现 3.0% / 1.6% 的负例**（精炼后真实分反而
   更低）⇒ 对**纯精度**动机不划算；它真正的价值在「探索/寻优」侧（会真实改变采纳的配置），这属于另一个
   判据，需要用户拍板。

**裁决：生产代码零改动** —— 保留精炼行走与 `MIN_ADOPT_SCORE` 门槛。「天花板 0.0023 < 门槛 0.01」是
**设计上有意为之**：门槛面向的是「大到值得写进报告、能被用户读懂」的改动（报告分/卡片徽章），而行走带来的
是**平台级**收益（每一次采纳槽恒定花 2 次评估，让配置更靠近内部最优，不必写进报告）⇒ 保留行走与保留门槛
并不矛盾：「有提升才保留」在本轴成立（+0.0024、零负例）。若用户选择走「放宽门槛」，实施前必须先立三条：
① **不要直接改 `TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE`**（它同时是**槽级**采纳闸门，影响面远超精炼：会让所有
0.002 量级的候选拿到槽级采纳）；② 回退护栏（真实分不升则回退，或把放宽采纳单独标注 / 可撤销）；
③ 验收指标加**负例率**（把 1.6%~3.0% 当已知代价而不是意外）。

**诚实边界**：单一夹具（`/actions/combat/jungle_planet` tier 0 / 4h / 单角色）、单一候选家族
（`enemyGroupHp`）、单一槽（槽 2 firestorm）、决策样本只有 2 / 5 两档、采样网格 = 5pp（本轮对照臂跳过 ⇒
**没有 1pp 对照**）；净效应是「相对基线的**真实分**增量」（留出种子上的生产同款 `scoreCandidate`）的配对差，
不是报告分。**不可外推到其它家族 / 区域 / 槽**。

**复现**：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500
--workers=8 --slots=2,3`（`--seeds` 有 ≥12 的下限断言，冒烟时别小过它）。

**本轮改动** = 研究装置 1 文件（`scripts/trigger-optimizer-racing-study.mjs`：段首注释补门槛臂说明、三条臂
循环、`runWalk` 门槛参数化、`rows` 增 `none*`/`loose*`/`alt*` 字段、汇总面板通用化 + 三条配对差输出）+
本文档，**生产代码零改动**。

**回归**：`npm test` **184 文件 / 2540 用例**全绿（含 `prettier --check .` ✓）；`npm run build` ✓（23.35s）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。

---

## §44 深挖窗口可达性审计（B）：触发面 = 快速档 × 强信号槽，机制有效但**不做校准**（2026-09-25，菜单 B）

**问题**：`deepDives` 在真实运行里长期为空（§21.5 四次真实运行 0 触发），而深挖是「被噪声地板拦下的强候选」
唯一的**自动**救援通道。B 项回答三件事：它还能不能触发？触发后能不能买到采纳？要不要校准触发面？

**装置**（`scripts/trigger-optimizer-racing-study.mjs` 新增「深挖窗口可达性」段，**零新采样**）：

- 触发与采纳判据**全部调生产实现**：`isAdoptionBlockedByEvidence`（本轮新加进引擎包装层）、
  `hasAdoptionEvidence` / `shouldAdoptCandidate` / `compareCandidates` / `pickRacingSurvivors`；脚本里不手搓副本。
- **档位口径取生产预设表**（`TRIGGER_OPTIMIZER_PRESETS` × `resolveTriggerOptimizerPresetRounds`）：三档 ×
  4h/8h/24h 共 8 个 (上限, 轮数) 组合，按该档该时长**真实的 rounds** 回放；池 = 采样池的保序前缀
  （§34 已证前缀最优 ≡ 全池最优），racing 与否由生产 `isRacingPool(池大小)` 决定。
- 每次试验：粗筛 2 场（racing 池）→ 精测 d 场 → 生产 `compareCandidates` 取 winner → 三分类：
  **触发深挖**（被拦）/ **直采纳**（过闸）/ **未达门槛**（分数不够）。
- **扩轮采纳**：触发后用**与决策样本不相交的 6 轮**重测 winner，再走生产 `shouldAdoptCandidate`（生产用独立盐；
  这里用同一盐的不相交种子 —— 对「判据样本独立于触发决策」这一点等价）。
- 对照臂：把**触发**门槛放宽到 0.005 / 0.002（采纳侧仍是生产判据），回答「放宽触发面能买到什么」。

**实测 ①：4h 采样**（32 种子 / 500 试验 / 三槽 2,3,4 ⇒ 每行 1500 个「槽 × 试验」样本）

| 档位 × 时长 | 上限 / 轮数 | 深挖资格 | 触发率（合计） | 槽 2 | 槽 3 | 槽 4 | 扩轮采纳 | 条件通过率 |
| ----------- | ----------- | -------- | -------------- | ---- | ---- | ---- | -------- | ---------- |
| fast@4h     | 6 / 5       | ✓        | **3.1%**       | 0.0% | 6.2% | 3.0% | 2.0%     | 65.2%      |
| standard@4h | 10 / 8      | ✗        | 0.0%           | 0.0% | 0.0% | 0.0% | —        | —          |
| fine@4h     | 20 / 10     | ✗        | 0.0%           | 0.0% | 0.0% | 0.0% | —        | —          |

**实测 ②：8h / 24h 采样**（槽 2,3；24h 臂 20 种子）

| 档位 × 时长                | 上限 / 轮数 | 资格 | 触发率           | 槽 3 | 扩轮采纳 | 条件通过率 |
| -------------------------- | ----------- | ---- | ---------------- | ---- | -------- | ---------- |
| fast@8h                    | 6 / 3       | ✓    | 3.4%             | 6.8% | 3.4%     | 100%       |
| standard@8h                | 10 / 6      | ✗    | 0.7%（永不触发） | 1.4% | —        | —          |
| fine@8h                    | 20 / 10     | ✗    | 0.0%             | 0.0% | —        | —          |
| fast@24h                   | 6 / 2       | ✓    | 3.9%             | 7.8% | 3.9%     | 100%       |
| **standard@24h（默认档）** | 10 / 5      | ✓    | **0.0%**         | 0.0% | —        | —          |
| fine@24h                   | 20 / 6      | ✗    | 0.0%             | 0.0% | —        | —          |

**判读**：

1. **第一道门是资格门，不是噪声门**：深挖只在 `settings.rounds < 6` 时开放 ⇒ **标准档 4h/8h（8 / 6 轮）与精细档
   全档永不触发** —— 这是结构性排除，与 σ 无关（那些档位上 2×SE 再小也不会触发）。
2. **第二道门是效应量线**：在有资格的档位上，触发率由「槽级最优候选能不能上 0.01 线」决定 —— 强信号槽
   （flame_blast，池最优 ≈ 0.0195）6.2% / 7.8%，第三个伤害槽（fireball）3.0%，而弱信号槽（firestorm，
   winner 分中位 0.00000）**0.0 ~ 1.6%**（它的 winner 在 ~100% 的试验里连门槛都没到）。
3. **触发构成 100% 是「未过地板」**（`inconclusive` 且 `|mean| ≤ 2×SE`）：没有一例 `negative`、也没有一例
   「无标准误」⇒ §21.5 按 σ 推的窗口形状被实测确认，且窗口确实只描述这一类。
4. **机制有效**：扩轮采纳率高（fast@4h 条件通过率 65.2%；8h/24h 100%）⇒ 深挖买到的采纳基本是真的
   （判据样本独立于触发决策），与 §18.1/§21.5 的历史实证（深挖采纳后独立复验 positive，p = 0.0131）同向。
5. **放宽触发面 = 0 收益（实测）**：三档所有行都是「触发 +0.0%、额外采纳 0 次」 —— 因为触发条件本身就含
   `score ≥ 0.01`，降低它只能捞到 `score ∈ [bar′, 0.01)` 的候选，而它们过不了采纳判据（实测 0 次）。
   ⇒ 「校准触发面」这条路**结构上没有 up-side**，不做。
6. **这解释了历史观测**：fast@4h 每「槽 × 运行」触发 3.1% ⇒ 5 槽夹具一次运行期望 ≈ 0.09 次（约每 11 次运行
   见 1 次）；§21.5 那 4 次运行 0 触发（期望 0.4 次）属正常范围，不需要「机制坏了」的解释。
7. **顺带修正 §21.5 的一句**：它写「24h 档（σ 小）在结构上就不可能被拦，快速档 4h/8h 才是最可能触发的一档」。
   实测在**快速档口径**下 24h 反而更容易触发（槽 3：7.8% vs 4h 的 6.2%）—— 轮数从 5 掉到 2 带来的噪声增长
   超过了 24h 的 σ 收缩；而且 2 轮时「聚合分高、配对均值贴近 0」的样本比解析估计（把 mean 当成效应量）
   预期的多得多。真正结构性的门是第 1 条那个 `rounds < 6` 资格门。

**裁决：生产代码零改动**（保留机制与门槛）。理由：机制在资格档位上是**有效**的（触发即高概率换到真采纳），
而「放宽触发面」实测零收益、「校准窗口」没有可实施的方向；默认档（standard@24h）确实几乎不触发，但那里的
「证据不足」本来就有用户侧出口（提高重复次数 / 换精细档重跑，代价是墙钟），不需要机器再自动加测。
**深挖的成本只在触发时发生**（每槽每次运行 ≤ 1 次 × 12 场）。

**诚实边界**：单夹具（`/actions/combat/jungle_planet` tier 0 / 4h / 单角色）、单角色三伤害槽（2/3/4；增益槽 0/1
池只有 6 条、非 racing，未采）；8h/24h 臂只覆盖槽 2,3（24h 臂 20 种子）；触发率是**首轮 winner** 口径
（生产每轮都会检查，但在未采纳时参考系不变、同一批样本 ⇒ 后续轮与首轮同判；一旦某轮采纳，参考系变了，
本口径不建模那种复合情形）；「扩轮采纳」用**同一盐的不相交种子**代理独立盐。**不可外推到其它夹具 / 区域 / 家族。**

**复现**（三条命令，合计约 12 min）：
`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=12 --slots=2,3,4`；
同款 `--hours=8 --seeds=32 … --slots=2,3`；`--hours=24 --seeds=20 … --slots=2,3`。
（装置细节：新段的行标签「本次采样时长命中」= 该 (上限, 轮数) 正是这一档在采样时长下的取值，按预设表逐档比对
—— 早先写成「标签含 @&lt;hours&gt;h 或 hours &gt; 8」，24h 采样下会把 4h/8h 档行也标成命中；该 bug 只影响标签，
不影响任何数字。）

**本轮改动** = 研究装置 2 文件（引擎包装层补 `isAdoptionBlockedByEvidence` + 预设表/深挖轮数导出；研究脚本新增
「深挖窗口可达性」一段）+ 本文档，**生产代码零改动**。

**回归**：`npm test` **184 文件 / 2540 用例**全绿（含 `prettier --check .` ✓，58.5s）；`npm run check-dead-keys`
✓（en/zh 各 143 键、0 死键）。**一条观察**：与 24h 采样**并发**跑时 `official-translation-sync` 有一条 5s 超时
（整轮 177s vs 常规 70s）；采样结束后单跑该文件 229ms 通过、全量重跑全绿 ⇒ 是 CPU 争抢，不是回归。

## §45 C 项：反解「需要多少轮」——把固定的「提到上限」换成可执行的下一步（2026-09-25）

**问题**：§20.2 的「可确认下限」只回答「本次设置能确认多大的提升」，§19.8 的轮数截断提示只在报告**声称提升**时
出现；两者都不回答用户真正的下一步问题：**要不要加重复次数、加多少轮才可能看到采纳**。旧文案把
「提到 10 轮 → 下限降到 ≈X」写死 —— 既可能在 3 轮就够时夸大成本，也可能在上限也不够时给一个**做不到的下一步**
（§44 实测的默认档 standard@24h 触发 0.0% 正是这一类：真实缺口是时长/信号，不是轮数）。

**口径（与 `projectTriggerOptimizerDetectionFloor` 同源）**：采纳闸门要求 `|mean| > 2 × SE`；第 n 轮的
`SE = σ/√n`，σ 由本次实测的 SE 反推 `σ = SE(当前轮) × √轮数`。于是「目标效应量 effect 能被确认」的最小轮数：

n_min = ⌈ 轮数 × (2 × SE / effect)² ⌉

- **必须乘 `轮数` 这一项**：漏掉 √轮数 会把所需轮数算小一个量级（实现时踩过：5 轮 / SE=0.006 会被错算成 2 轮，
  正确是 8 轮）。已写进函数头注释。
- 目标效应量 = `TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE`（0.01 分，采纳门槛量级），上限 = `TRIGGER_OPTIMIZER_MAX_ROUNDS`
  （10 轮）。
- 抗浮点：`−1e-9` 之后再向上取整，避免 7.99999… 被抬成 9。

**三个分支**（返回 `satisfied` / `capped`，调用方按分支改口）：

| 分支       | 条件            | 上屏文案锚点（`common:triggerOptimizer.*`）                                                      |
| ---------- | --------------- | ------------------------------------------------------------------------------------------------ |
| 已够       | 当前下限 ≤ 0.01 | `detectionFloorAdviceSatisfied`：已低于采纳门槛量级；是否显著仍以逐轮样本与复验的 p 值为准       |
| 提到 N 轮  | 反解轮数 ≤ 上限 | `detectionFloorAdviceRounds`：需提到 ≈N 轮（届时下限/显著门槛各是多少，墙钟按轮数倍数增长）      |
| 拉满也不够 | 反解轮数 > 上限 | `detectionFloorAdviceCapped`：拉到上限仍高于门槛 ⇒ **先加长模拟时长**（噪声 ∝ 1/√(轮数 × 时长)） |

**构造算例**（单测锚定；SE 由 `pairedAt(轮数, SE)` 造，`w_profit = 0.5`）：

| 当前 (轮数, SE) | 反解         | 分支                   | 届时下限      | 届时显著门槛  |
| --------------- | ------------ | ---------------------- | ------------- | ------------- |
| (5, 0.006)      | **8 轮**     | 提到 N 轮              | ±0.0094868 分 | ±0.0112164 分 |
| (5, 0.010)      | 20 轮 > 上限 | 拉满也不够（钳 10 轮） | ±0.0141421 分 | ±0.0159957 分 |
| (5, 0.004)      | ≤ 5          | 已够（保持 5 轮）      | ±0.008 分     | —             |
| (10, 0.010)     | —            | 拉满也不够（已在上限） | ±0.02 分      | —             |

**自洽判据**（单测 + 模板测试同时钉住）：反解轮数的下限 ≤ 0.01 且 **N−1 轮的下限 > 0.01**（「至少 8 轮」不是随口
说的）；三分支文案与实际状态一一对应（已够分支不得出现「需提到」、拉满分支必须出现「加长模拟时长」、已在上限
时不得建议「比现在更少轮数」）。

**实现落点**：

- `src/services/triggerOptimizerScoring.js`：新增导出 `resolveTriggerOptimizerRoundsForEffect(floor, effect, maxRounds)`
  （紧跟 `projectTriggerOptimizerDetectionFloor`）；非法输入（缺 floor / σ 非有限或 ≤0 / 轮数 < 2 / effect 非有限
  正数）一律返回 `null` —— 宁可不出这一行，也不编一个假建议。
- `src/ui/pages/TriggerOptimizerPage.vue`：`detectionFloorProjection` computed 换成 `detectionFloorAdvice`，挂到
  `resultNotes` 的 `extra`（第二行），由既有 `TriggerOptimizerNotes.vue` 渲染。
- `locales/zh/common.json` + `locales/en/common.json`：新增 3 键（`detectionFloorAdviceRounds` / `…Satisfied` /
  `…Capped`），zh/en 逐键对称。
- 顺带清理：页面已无调用点的 `projectTriggerOptimizerDetectionFloor` 导入（服务层导出与单测保留 = §20.2 既有契约）。

**测试锚点**：服务层 +4 条（`solves the minimal round count for a target effect`，含最小性反证
`project(…,7).noiseFloor > 0.01`；`says so when even the round cap cannot confirm the target effect`；
`reports "already sufficient" and never suggests fewer rounds than the current run`；`refuses to guess on invalid
inputs instead of inventing advice`）+ 模板 1 条改写（`shows the detection floor and the rounds needed for an
adoptable-size improvement`，覆盖 无 SE 不渲染 / 已够 / 提到 8 轮 / 拉满也不够 / 已在上限 五种上屏状态）。

**零新采样**：反解只用本次运行已经算出的配对统计（`paired.score.stdError`），不触发任何新的引擎采样，墙钟不受
影响（与 §43/§44 的「先在装置上验证、再进生产」路线不同 —— 这一项是**展示口径**的改动，判据是「反解与投影自洽 +
文案与实际一致」，故用构造样本的单测钉住，而非跑采样）。

**诚实边界**：

1. `SE ∝ 1/√n` 的缩放是**外推**（沿用 §20.2 的投影口径），没有做「真实 N 轮采样 vs 预测下限」的对照核验 ——
   结论是「若噪声按经典 1/√n 收缩，则需 N 轮」，不等于「N 轮一定能采纳」（效应量本身也可能随轮数变化）。
2. 目标效应量按**分数**口径（0.01 分）；利润换算 `2^(v / w_profit) − 1` 在混合指标下只作量级参考，文案已用「≈」标注。
3. 上限固定取 `TRIGGER_OPTIMIZER_MAX_ROUNDS`：预设表若调整上限，文案数字自动跟随（无需改文案）。
4. 「已够」只说「这个量级的提升**可以被确认**」，不说「一定有提升」—— 是否显著仍由 p 值 / 复验裁决（文案已明说）。

**复现**：
`npx vitest run src/services/__tests__/triggerOptimizerScoring.test.js src/ui/__tests__/TriggerOptimizerPage.template.test.js`
（定向 95 条）；全量 `npm test`。

**本轮改动** = 生产 3 文件（scoring 纯函数、页面 computed、locales zh/en）、测试 2 文件（服务层 +4 用例、模板改写 1 条）与本文档。

**回归**：`npm test` **184 文件 / 2544 用例**全绿（含 `prettier --check .` ✓，75.6s）；`npm run build` ✓（27.1s）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。

## §46 A 项：默认档「每槽候选上限」10 → 6 能不能省时间（2026-09-25，**质量闸门硬失败 ⇒ 不实施**）

**问题**：§34 只测了「抬上限会不会买到质量」（Δ = 0 ⇒ 不抬），没测**反方向**：把默认档上限从 10 降到 6，
能不能在不丢质量的前提下把评估数/墙钟砍一截。这是搜索链上剩下的最后一个成本旋钮 —— §38 的粗筛预算臂
（粗筛 1 轮，省 40%）已因复现率 95% < 99% 判据被否。

**装置**（复用 §34 的保序前缀对照 + 新增生产公式成本账，零新机制）：家族交错重排（§39）**不读**
`candidateLimit`（截断 = 交错后的纯 `slice(0, limit)`，见 `triggerOptimizerCandidates.js` 的
`finalizeCandidatesWithStats`）⇒「上限 N 档真实会评估的集合」= 采样池的**前 N 条**。本轮把上限档扩到
**6 / 8 / 10 / 20**，成本账按生产公式逐档算（`triggerOptimizerSearch.js` 的 `simulationsPerRound` 同款：
racing 池 = 上限×粗筛 + min(上限, keep+2)×轮数；小池 = 上限×轮数），轮数/上限一律取生产预设表。

**预注册判据**（跑之前定）：

- 质量闸门（硬）：各场景各槽「上限 6 的池最优」与「生产上限 10 的池最优」差 ≤ **0.002**；
- 成本闸门：默认档 standard@24h 评估数降 ≥ **25%**，且各档各时长不出现成本上升；
- 两条都过才实施（默认上限 10 → 6）。

**实测（4h / 32 种子；丛林槽 2,3、熊熊槽 2,3,4）**：

| 场景 | 槽            | 生成 | 全池最优（位置）                             | 上限 6 Δ     | 上限 8 Δ     | 上限 10 / 20 Δ |
| ---- | ------------- | ---- | -------------------------------------------- | ------------ | ------------ | -------------- |
| 丛林 | 2 firestorm   | 21   | 0.00000（第 2 条 `current`）                 | +0.00000     | +0.00000     | +0.00000       |
| 丛林 | 3 flame_blast | 21   | 0.01978（第 4 条 `enemyGroupHp 800`）        | +0.00000     | +0.00000     | +0.00000       |
| 熊熊 | 2 firestorm   | 21   | **0.04907（第 10 条 `deadUnitsAtMost{0}`）** | **−0.03236** | **−0.03236** | +0.00000       |
| 熊熊 | 3 flame_blast | 21   | 0.08937（第 4 条 `enemyGroupHp 1750`）       | +0.00000     | +0.00000     | +0.00000       |
| 熊熊 | 4 fireball    | 20   | 0.00000（第 1 条 `default`）                 | +0.00000     | +0.00000     | +0.00000       |

**成本账**（解析值，参评槽每轮评估数之和）：上限 10 → 6 在标准档按时长省 **20%（4h）/ 28%（8h）/
33%（24h）**；精细档 20 → 6 可省 33%~49%，但精细档上限是**覆盖旋钮**（§22.3/§23.4 与「装下完整网格」的
测试锁死），不在本项范围。**省的钱是真的，代价也是真的。**

**裁决：不实施**。质量闸门**硬失败**：熊熊 T0 的 firestorm 槽，真实最优 `deadUnitsAtMost{count:0}`（+0.04907）
在交错后落在**第 10 条**，上限降到 9 以下就整段丢掉它 —— Δ = **−0.03236**（6 与 8 同值正说明赢家在 10 位）。
这个数值与 §39 引入家族交错时**修掉的回归逐值相同** ⇒ 装置完整复现了那次已知损失；反过来也说明
**默认上限 10 是承重值**：交错的「每族首条入场券」只覆盖前 #家族 条，**家族后续档位**要靠 10 这个深度才装得下。

**机制**：丛林两槽 Δ = 0 是**运气不是结构**（它们的最优恰好是家族首条/早位）；只要有一个槽的最优落在
「家族后续档位」，降上限就立刻丢分 —— 熊熊 T0 正是这种场景，而且它还是**信号最强**的槽（池最优 0.04907，
全部实测里最大的杠杆）。

**结论与边界**：

- 「同结论省时」在这条链上**没有可用旋钮**：上限下调丢质量（本节）；粗筛预算下调早已因复现率不达标被否
  （§38）；用时长/轮数换更低地板是**正常取舍**（拿时间买质量），不是免费提速。
- 诚实边界：单角色夹具（jungle / bear T0、4h、32 种子）；只测伤害槽（丛林 2,3 / 熊熊 2,3,4）；池最优是
  **in-sample 上界**口径（不建模 racing 筛选噪声，那由 §30.8 覆盖）；上限 8 与 6 同 Δ 只说明「≤9 都丢
  同一个赢家」，不代表 8 在其它场景等价。
- **复现**：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500
--workers=8 --slots=2,3`；熊熊臂同款加 `--zone=/actions/combat/bear_with_it --slots=2,3,4`。

**本轮改动** = 研究装置「候选上限截断的代价」段（上限档扩到 6/8/10/20、预注册质量闸门、生产公式成本账）与
本文档，**生产代码零改动**。

**回归**：`npm test` **184 文件 / 2544 用例**全绿（含 `prettier --check .` ✓，68.0s）；`npm run build` ✓（25.2s）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。

## §47 V 项：复验轮数自适应（2026-09-25，实测胜出 A′ ⇒ 已实施）

**问题**：§31 的追加复验是**固定 6 轮**（追加后合计 12 轮）。首轮 6 轮判「未达显著」时，固定 12 轮把两种完全不同的
情形一视同仁：「样本不够，再来一点就能判出来」与「效应本来就接近噪声，再加也没用」。本轮问的是：把追加轮数改成
**按需**（由当前样本反解「判成明确结论至少要多少轮」）能不能在不抬假阳性的前提下提高「首轮未达显著 → 明确结论」
的解析率，代价是多少场次。

**三臂口径**（同一批样本、同一套判据，只有「追加多少轮」不同）：

- **F（现状）**：追加 6 轮 ⇒ 合计 12 轮；
- **A（按需）**：反解说 `n* ≤ 上限` 才追加到 `n*`；反解说「上限也不够」时**一轮都不花**（停在 inconclusive）；
- **A′（按需 + 保底）**：`min(上限, max(n*, 12))` 轮；反解说「上限也不够」时补到上限。

反解口径与结论卡同一把尺子：`|mean| > t(n−1) × SE(n)`，其中 `SE(n) = SE(当前轮) × √(当前轮 / n)`，取满足该式的
**最小整数 n**（「差一点点」的方案不给）。上限 = 24 轮（= 现状合计轮数的 2 倍）；保底 = 12 轮（= 现状口径，
自适应**绝不比今天少花样本**）。

**预注册判据**（跑正式采样之前定稿，不因结果调整）：

1. 假阳性不升（硬）：null 桶「累计判提升成立」≤ 首轮值；
2. 解析率（两桶合计，「首轮未达显著 → 明确结论」）≥ F 臂；
3. 成本：复验额外场次 = `2 ×（期望轮数/侧 − 6）`—— 只做绝对量级报告；实施时另加运行期护栏「额外场次 ≤
   整轮运行估算的 20%」。

过闸的臂里取解析率最高者；都不过 ⇒ 不实施，如实汇报。

**实测 · 丛林 4h / 32 种子 / 500 试验**（槽 2 `firestorm` 的 real 桶为空，槽 3 `flame_blast` 有真提升）：

| 槽                            | 臂  | 真提升桶解析率 | 真提升累计成立 | null 桶解析率 | 假阳性 | 合计解析率             | 期望轮数/侧 | 额外场次 |
| ----------------------------- | --- | -------------- | -------------- | ------------- | ------ | ---------------------- | ----------- | -------- |
| 2（real 桶为空）              | F   | —              | —              | 54.8%         | 0.0%   | 54.8%（1019/1860）     | 7.12        | 2.2      |
|                               | A   | —              | —              | 47.2%         | 0.0%   | 47.2%（877/1860）      | 6.59        | 1.2      |
|                               | A′  | —              | —              | **67.3%**     | 0.0%   | **67.3%**（1252/1860） | 8.18        | 4.4      |
| 3（有真提升；首轮基准 88.2%） | F   | 100.0%         | 100.0%         | 51.4%         | 0.0%   | 54.8%（926/1691）      | 7.13        | 2.3      |
|                               | A   | 94.9%          | 99.4%          | 45.3%         | 0.0%   | 48.8%（825/1691）      | 6.50        | 1.0      |
|                               | A′  | **100.0%**     | **100.0%**     | **62.2%**     | 0.0%   | **64.9%**（1097/1691） | 8.19        | 4.4      |

反解统计：槽 2 计划追加 1107 次（平均要 11.4 轮）、反解说「上限也不够」253 次；槽 3 计划追加 990 次（平均 10.5 轮）、
上限也不够 201 次。

**实测 · 熊熊 T0 4h / 32 种子 / 500 试验**（槽 2 `firestorm`、槽 3 `flame_blast`、槽 4 `fireball` 的 real 桶为空）：

| 槽                  | 臂  | 真提升桶解析率 | 真提升累计成立 | null 桶解析率 | 假阳性 | 合计解析率             | 期望轮数/侧 | 额外场次 |
| ------------------- | --- | -------------- | -------------- | ------------- | ------ | ---------------------- | ----------- | -------- |
| 2（首轮基准 5.7%）  | F   | 6.0%           | 11.1%          | 25.4%         | 0.1%   | 19.0%（1075/5657）     | 9.39        | 6.8      |
|                     | A   | 5.8%           | 10.7%          | 23.8%         | 0.1%   | 17.8%（1008/5657）     | 7.51        | 3.0      |
|                     | A′  | **12.3%**      | **17.0%**      | **36.8%**     | 0.1%   | **28.7%**（1624/5657） | 14.00       | 16.0     |
| 3（首轮基准 30.3%） | F   | 43.6%          | 60.4%          | 32.8%         | 0.1%   | 35.5%（2008/5660）     | 9.40        | 6.8      |
|                     | A   | 38.7%          | 57.0%          | 29.5%         | 0.1%   | 31.7%（1797/5660）     | 7.88        | 3.8      |
|                     | A′  | **57.0%**      | **69.7%**      | **46.7%**     | 0.1%   | **49.2%**（2786/5660） | 13.19       | 14.4     |
| 4（real 桶为空）    | F   | —              | —              | 35.9%         | 0.0%   | 35.9%（460/1282）      | 6.77        | 1.5      |
|                     | A   | —              | —              | 29.3%         | 0.0%   | 29.3%（375/1282）      | 6.28        | 0.6      |
|                     | A′  | —              | —              | **44.9%**     | 0.0%   | **44.9%**（575/1282）  | 7.77        | 3.5      |

反解统计：槽 2 计划追加 2265 次（平均要 12.7 轮）、上限也不够 2892 次；槽 3 计划追加 3021 次（平均 12.2 轮）、
上限也不够 2139 次；槽 4 计划追加 519 次（平均 11.3 轮）、上限也不够 263 次。

**裁决：实施 A′**（含 20% 成本护栏）。理由：A′ 在 **5/5 槽**同时过 ①（假阳性不升 —— 0.1% 量级三臂同值、
0.0% 桶三臂同为 0）与 ②（合计解析率 ≥ F）；而 **A 臂 5/5 槽的合计解析率都低于 F**（17.8 < 19.0、31.7 < 35.5、
29.3 < 35.9、47.2 < 54.8、48.8 < 54.8），未采用。

**机制（为什么 A 反而输给现状）**：A 在反解说「上限也不够」时**一轮都不花** ⇒ 这批案例永远停在 inconclusive。
而熊熊的槽 2/3 里这类案例占大头（反解「上限不够」2892 / 2139 次）—— 换句话说，在效应量接近噪声的场景里，
A 省下的样本正好是**唯一可能换来结论**的那部分花费。A′ 花满上限买的就是「把它们判成明确结论」的机会：
真提升桶的解析率 12.3% vs 6.0%（槽 2）、57.0% vs 43.6%（槽 3）。

**呼应**：null 桶的解析率同样上升（36.8% vs 25.4%），但**假阳性一个都没多**（0.1% 三臂同值）⇒ 多出来的
「明确结论」在 null 桶里全部落在**判负**方向 —— 这正是想要的效果：不只把真提升判出来，也把噪声明确地关在门外，
而不是让用户对着 inconclusive 猜。

**成本与护栏**：A′ 的期望额外场次（相对现状 6 轮/侧）在熊熊是 +14.4~16.0 场/槽、丛林 +4.4 场/槽；而快档整轮
运行只有 ~74 场的量级（判据③注释口径）⇒ `14.4 / 74 ≈ 19.5%`，据此把护栏定为
**`TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO = 0.2`**；它同时拦住「补到 24 轮」的最坏情形
（`2 × 18 = 36` 场 = 整轮的 48%）。护栏咬住时把轮数往下钳：宁可结论仍是 inconclusive，也不超预算；拿不到整轮
场次（旧报告）时**不假装有护栏**（`budgetSimulations = null`，如实返回）。

**诚实边界**：

1. real 桶代表性的天花板：熊熊槽 2 的真提升桶解析率低到 6.0%~12.3%，说明这些槽的效应量已接近噪声 ——
   解析率的**绝对数**不是「产品里会出现多少」，只是「同一批案例上三臂的相对高低」；
2. `σ ∝ 1/√n` 是**外推**（沿用 §20.2 的投影口径），没有做「真实 N 轮采样 vs 反解预测」的对照核验 ——
   反解说 18 轮，不等于「18 轮一定能判出来」（效应量本身也可能随轮数变化）；
3. 单角色夹具（丛林 / 熊熊 T0、4h、32 种子），且只覆盖伤害槽（丛林 2,3 / 熊熊 2,3,4）；
4. 不建模 racing 选择偏差（引擎在真实运行里会先粗筛，这里的样本没有筛选过程）；
5. 熊熊槽 4 的 real 桶为空（三臂都只判 null 桶）。

**实现期发现并修掉的 bug（装置口径 ↔ 生产口径必须逐值同构）**：`planTriggerOptimizerVerificationAppend` 最初把
「上限」取成 `max(targetRounds, currentRounds)`（= 反解值），而不是真上限 ⇒ 反解说「9 轮就够」时，保底 12 轮会被
压成「只补 3 轮」（**比现状还少**），上屏的「上限 N 轮」也会跟着显示成反解值。现由
`resolveTriggerOptimizerVerificationRounds` 明确返回 `capRounds`（真上限 ≥ 当前轮数）供计划函数使用。装置用的
公式是 `min(CAP, max(n*, 12))`，生产必须逐字同构 —— 这条差一点就让「实测胜出的口径」在落地时变成另一回事。

**生产改动清单**：

- `src/services/triggerOptimizerDomain.js`：`TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS = 24`（:75）、
  `TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO = 0.2`（:80）、`normalizeTriggerOptimizerVerifyRounds`（:326，
  复验口径 1..24 —— **不能**复用搜索口径 `normalizeTriggerOptimizerRounds`：那个上限是 10 轮，会把「要 18 轮」
  静默钳成 10 轮）；
- `src/services/triggerOptimizerScoring.js`：`resolveTriggerOptimizerVerificationRounds`（:445，返回含 `capRounds`）、
  `planTriggerOptimizerVerificationAppend`（:487，A′ 计划 + 20% 护栏）；
- `src/services/triggerOptimizerSearch.js`：追加复验的 `rounds` 归一化改用复验口径（:1327）；
- `src/stores/simulatorTriggerOptimizerActions.js`：store 按计划派样本（:703 起），三种「不追加」直接早退并写
  `runtime.verifyAppend.error`（结论已明确 / 上限已尽 / 预算用尽）；
- `src/ui/pages/TriggerOptimizerPage.vue`：入口旁新增「本次追加多少轮」文案行与错误行（模板 :351-367、
  computed :1570-1604）。错误行是 §31 的遗留：`verifyAppend.error` 一直被写进 runtime，却没有任何渲染点；
- `locales/zh|en/common.json`：6 键（:243-248，计划三态 + 不追加三态），zh/en 逐一对齐；
- 装置：`scripts/trigger-optimizer-racing-study.engine.mjs`（导出反解函数与上限常量）、
  `scripts/trigger-optimizer-racing-study.mjs`（三臂对照段 :1046-1182，含 `--seeds >= 24` 断言）；
- 测试：服务层 +3（反解最小性 / A′ 计划钳位 / 20% 护栏）、追加复验 +1（18 轮越过搜索上限、越界值回落产品默认）、
  store +1（护栏咬住 + 三种不追加），模板用例就地扩写（计划文案 + 错误行 + 无余量时不挂入口）。

**复现**：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8
--slots=2,3`；熊熊臂同款加 `--zone=/actions/combat/bear_with_it --slots=2,3,4`。（三臂段输出在每槽 `槽位 N …`
标题之后，搜 `复验轮数自适应对照` 最快。）

**回归**：`npm test` **184 文件 / 2549 用例**全绿（含 `prettier --check .` ✓，56.7s）；`npm run build` ✓（25.1s）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键；该脚本只扫 `queue.*` 域）。

## §48 D 项：追加复验的计划留档与导出（2026-09-25，已实施）

**问题（§47 的自适应让缺口显形）**：追加复验的轮数从常量变成反解值（保底 12 / 上限 24 / 20% 成本护栏）之后，
「这次补了几轮、依据是什么、上限或护栏有没有咬住」只在上屏说过一次（而且下一次渲染就被新计划顶掉）；落盘报告与
Excel 导出都不含这件事 ⇒ 事后复盘（刷新后重进、把报告发给别人）答不出「为什么是 18 轮」。§31 的 attempts 留档原
只有 `{ attempt, rounds, seeds, paired, verdict, mergedRounds, mergedVerdict }` —— 「补了几轮」在（`rounds`），
「为什么」不在。

**口径（D-2 定稿）**：

- **字段位置**：`report.verification.attempts[i].plan`（与 `rounds` / `verdict` / `mergedRounds` 并列）；
- **语义**：这一轮追加执行时所用的**自适应计划快照** —— 就是 `planTriggerOptimizerVerificationAppend` 的输出，
  白名单 10 字段：`decisive / capped / budgetLimited / currentRounds / requiredRounds / capRounds / targetRounds /
plannedRounds / plannedSimulations / budgetSimulations`（`requiredRounds` 在 capped 时为 null、`budgetSimulations`
  在没有整轮场次基准时为 null —— 两个 null 都合法，如实留档）；
- **来源（单一事实源）**：store 把已经算好的计划从 `options.plan` 传给服务层（与它派样本用的 `rounds` 同一个
  对象），服务层**只净化不重算** —— 口径的事实源只有 scoring 的计划函数；服务层重算会把口径分叉成两套
  （§47 实现期 bug 的教训：同构要核对「值」，不是「形状」）；
- **净化与自洽闸门**（`normalizeTriggerOptimizerAppendPlan`）：白名单取字段 + 逐项校验类型，任何缺项 / 类型不符
  **整份丢弃**（返回 null）；并且要求 `plannedRounds` 等于这一条**实际执行的 rounds**（服务层归一化后的值）——
  两者不等说明「计划的那件事」与「真正跑的那件事」不是同一个（例如越界值被归一化回落），留档它只会误导复盘。
  净化失败不报错、不阻断追加（留档是旁路，不是前置条件）。

**落盘与导出（为什么只改了这些地方）**：

- 落盘链**不用改**：`simulatorStorage.js` 的 `persistTriggerOptimizerReportToStorage` 是**整体 JSON 化**（无字段投影
  白名单），store 的 deep watch（`trackResultStaleness`，:237-245）在 `results.verification` 写回时自动落盘 ⇒
  `attempts[i].plan` 天然跟着报告往返；§40 的两个闸门（createdAt 必须正时间戳、空报告不写不删）不受影响；
- 导出（Excel 汇总表）在**页面组装 `summaryRows` 处**追加两段：「追加复验 | 已复验 N 次 · 合并 M 轮」汇总行（复用
  界面键 `verifyAppend` / `verifyAppendMerged`，与卡片逐字同款）+ 每次追加一行明细「追加复验 {i} | 追加 X 轮/侧
  （累计 Y 轮）；…」。明细句三态（与上屏计划行的事后版对齐）：正常 = 「未受上限或成本护栏限制（上限 {cap} 轮）」、
  上限咬住 = 「已达上限 {cap} 轮」、护栏咬住 = 「成本护栏 {percent}% 生效（上限 {cap} 轮）」；快照缺失（旧报告）
  **只说基础句**（轮数 / 累计），不提上限与护栏 —— 没有依据就不说。上屏（界面）不动：计划行与合并行已够用，
  本项补的是留档与带走的那一份。

**验收判据（4 条，全部有测试钉住）**：

1. **不改统计口径**：plan 是只读附加字段；attempts 既有字段、轮数归一化（§47 复验口径）、判据逻辑零改动；
2. **落盘往返不丢**：store 用例在追加成功后重读 `mwi.triggerOptimizer.report.v1`，断言 `attempts[0].plan` 完整
   （plannedRounds / capRounds）；
3. **导出可读（人话、不出现字段名）**：模板用例断言 summaryRows 里出现「已复验 1 次 · 合并 24 轮」与
   「追加 18 轮/侧（累计 24 轮）；已达上限 24 轮」；
4. **旧报告不显示假信息**：无 plan 的 attempts 只有「追加 6 轮/侧（累计 12 轮）」—— 不含「上限 / 护栏」。

**生产改动清单**：

- `src/services/triggerOptimizerDomain.js`：`normalizeTriggerOptimizerAppendPlan`（:336，白名单 + 类型 + 自洽闸门）；
- `src/services/triggerOptimizerSearch.js`：`options.plan` 净化（`planSnapshot`，:1337）并写入 attempts 条目
  （:1424，`...(planSnapshot ? { plan: planSnapshot } : {})`）—— 不传 plan 的调用方行为与今天一致；
- `src/stores/simulatorTriggerOptimizerActions.js`：`plan` 透传（:760，与 `rounds` 同源）；
- `src/ui/pages/TriggerOptimizerPage.vue`：`verifyAppendArchiveText`（:1940 起，明细句三态）+ `exportReport` 追加
  汇总行与明细行（:1998-2018）；
- `locales/zh|en/common.json`：5 键（`verifyAppendAttempt` + `verifyAppendArchive` 三态），zh/en 逐一对齐。

**测试**：domain +3（快照白名单保留 / 丢弃分支 / 非对象输入）；服务层 +1（快照留档与四种丢弃情形：不自洽、
缺项、类型不符、没带）；store 就地扩写（`options.plan.plannedRounds = 18` 透传断言 + 落盘断言；mock 的 resolve 数据
对齐 §47 真实输出形状 rounds 24 / attempts 18 / plan 快照）；模板 +1（导出留档两态：有快照与旧报告）。

**手工核验**（若要眼见为实）：跑一次搜索 → 复验判「未达显著」→ 点「追加复验」→ 导出 Excel，汇总表可见
「追加复验」与「追加复验 1」两行；刷新页面（报告从存档 hydrate）后再导出，内容仍在。

**回归**：`npm test` **184 文件 / 2554 用例**全绿（含 `prettier --check .` ✓，59.9s）；`npm run build` ✓（27.0s）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键；该脚本只扫 `queue.*` 域，新增的 triggerOptimizer 键不在其内）。

## §49 C 项：换难度复核的轮数自适应（2026-09-25，实测胜出 A′ ⇒ 已实施）

**问题**：§29 的换难度复核是**固定 6 轮**（2 个配置 × 6 场 = 12 场）。首轮判「未达显著」时，「样本不够，多跑几轮就能判出来」与
「效应接近噪声，加多少轮也没用」被一视同仁；而报告里其实**已经有**一份效应量证据 —— 复验的配对统计
`verification.paired.score`（含 `mean` / `stdError` / `rounds`）。本轮问的是：由它反解「换到相邻难度要跑多少轮才判得出来」，
能不能在不抬假阳性的前提下提高复核的解析率，代价是多少场次。

**口径（C-2 定稿；与 §47 同构，但不是同一件事）**：

- **反解**：`|mean| > t(n−1) × SE(6) × √(6/n)` 取满足该式的**最小整数 n**（**从 n = 2 起** —— 新现场没有样本，不像 §47 的追加口径
  从 `rounds + 1` 起）；cap 以内无解 ⇒ `capped = true`、`requiredRounds = null`；
- **与 §47 的语义差异**（必须写进注释，否则下一次改动容易混）：§47 回答「在已有样本上**追加**多少」（已判明确就不追加）；
  本项回答「**新现场从零跑多少轮**」—— 先验判没判明确都照样给轮数（复核的意义就是换难度重测）；
- **执行计划**（`planTriggerOptimizerRobustnessRounds`）：`保底 = min(上限, max(6, 先验轮数))` ⇒ 自适应**绝不比今天少花样本**；
  `capped` ⇒ 目标 = 上限（**补到上限** —— 不要改成 §47 A 臂的「capped 就不花样本」）；否则 `目标 = clamp(n*, 保底, 上限)`；
- **上限 = 12**（= 2 × 保底；**2026-09-27 修订为 16，见下方修订条**）：论证过取 24（与 §47 同值），取 12 的硬理由是成本 —— 上限 24 时最坏 `2 × 24 = 48` 场 ≈ 快档整轮（~74 场）的 65%；
  取 12 则最坏 24 场 ≈ 32%，最大追加量（12 − 6 = 6 轮/侧 = 12 场）≈ 整轮的 16%：再往上买的是尾部解析率，成本翻倍不划算；
- **上限修订（2026-09-27，§63 实施项 ① 已拍板并落地）：12 → 16**。依据（§63-② 队伍载荷实测）：12 轮 88.6% 未达
  「同档位单人 − 10pp」判据线、16 轮 99.0% 达标；单人侧 ≤12 已 100% ⇒ 该上调只在「先验说不够」时生效（允许更贵、非
  默认更贵）。成本上界随之 ≤ 24 → ≤ 32 场/次复核；20% 护栏口径不变且在短时长档先咬住（快档整轮 ~74 场 ⇒ 额外 ≤ 7 轮、
  计划 ≤ 13 轮）。改常量即全线生效（planner / 追加归一化 / store / 页面 / 装置 import 同一常量）；装置的 `F${CAP}` 参照臂
  随之变为 F16，本节与 §51 表中以 12 轮为上限的实测为**历史记录**（再跑装置将按 16 出数，与表格不再逐值可比）；
- **成本护栏**：复用 §47 的比例（`TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO = 0.2`，单一事实源），但它限制的是**相对现状多花的**部分：
  `2 × (plannedRounds − 保底) ≤ 整轮场次 × 20%`；咬住时往下钳、但**不低于保底**（与 §47 不同：那里可以钳到 0，因为追加是可选动作；
  复核是用户主动点的检查，钳到比保底还少就等于「比现状更差」）；拿不到整轮场次（旧报告）⇒ `budgetSimulations = null`，不假装有护栏；
- **退化输入** ⇒ 计划 `null`：调用方保持今天的固定 6 轮（不编一份假计划）。计划快照随结果留档（`report.robustness.plan`，
  8 键白名单 + 自洽闸门 `plannedRounds === 实际 rounds`，与 §48 的 `normalizeTriggerOptimizerAppendPlan` 同款）。

**预注册判据（跑正式采样前定稿，不因结果调整）**：① 假阳性不升（硬）：null 桶「判提升成立」≤ F 臂；② 真提升桶「判提升成立」≥ F 臂。
过闸的臂里取解析率最高者；都不过 ⇒ 不实施。`F12`（固定跑满上限）只作参照 —— 看 A′ 离「总是跑满」有多远。

**实测 · 丛林 4h / 32 种子 / 500 试验**（目标难度 tier 1 = 相邻难度；槽 2 的 real 桶为空，槽 3 `flame_blast` 有真提升）：

| 臂                | 真提升:判成立 | 真提升:轮数/侧 | null:假阳性 | null:轮数/侧 | F 判不出→本臂判出 |
| ----------------- | ------------- | -------------- | ----------- | ------------ | ----------------- |
| F（现状 6 轮）    | 71.6%         | 6.00           | 0.0%        | 6.00         | 0.0%              |
| A′（按需 + 保底） | **73.5%**     | 7.31           | 0.0%        | 6.52         | 7.3%              |
| F12（参照）       | 99.3%         | 12.00          | 0.0%        | 12.00        | 97.7%             |

槽 2（real 桶为空）三臂的 null 桶假阳性同为 0.0%、轮数/侧 6.00 / 6.60 / 12.00。反解统计：**有计划 9000 次（其中上限也不够 621 次 ⇒ 补到上限）｜
可反解时平均要 3.6 轮｜先验退化 500 次（保持 6 轮）**；合计口径期望轮数/侧：F 6.00（额外 0.0 场）｜A′ 6.65（额外 **1.3 场**）｜F12 12.00（额外 12.0 场）。

**裁决：实施 A′** —— ① 假阳性 0.0% ≤ 0.0%（硬闸通过）；② 73.5% ≥ 71.6%（+1.9pp）。成本 +1.3 场/整轮 ≈ 快档整轮的 1.8%。
F12 的 99.3% 说明尾部（要 8~12 轮的案例）确实有价，但那是 12.0 场/整轮（≈ 整轮的 16%）换 25.8pp；A′ 用约 1/10 的成本买下其中
可反解的部分，而且护栏把最坏情形锁在 12 轮。

**装置口径的修正（错了就会误导下一次改动）**：第三列「F 判不出→本臂判出」的分母必须是**「F 判定不了的那些次试验」**；
首跑误用「本臂自己的未达显著次数」当分母（两者基数不同 —— 跑满上限的臂几乎总能给出结论、自己的未达显著次数接近 0），
F12 于是打出 4160% 这种无意义的数。修正后 F12 = 97.7%、A′ = 7.3%。重跑与首跑的**判定列逐值一致**（71.6 / 73.5 / 99.3、
轮数 6.00 / 7.31 / 12.00、反解统计一致）⇒ 采样确定性，修正只影响这一列显示。

**生产改动清单**：

- `src/services/triggerOptimizerDomain.js`：`TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS = 12`（并把保底常量的注释改写成「保底」；
  **2026-09-27 按 §63 实施项 ① 提升到 16**，见下方 §49 修订条）、
  `normalizeTriggerOptimizerRobustnessRounds`（1..12 —— **不能**复用搜索口径 `normalizeTriggerOptimizerRounds`：那个上限是 10 轮，
  会把「要 12 轮」静默钳成 10 轮，§47 同款教训）、`normalizeTriggerOptimizerRobustnessPlan`（8 键白名单 + 自洽闸门）；
- `src/services/triggerOptimizerScoring.js`：`resolveTriggerOptimizerRobustnessRounds`（反解，n 从 2 起）、
  `planTriggerOptimizerRobustnessRounds`（A′ 计划 + 20% 护栏；与 §47 的复验版共用 `tCritical`）；
- `src/services/triggerOptimizerSearch.js`：复核的 `rounds` 归一化改用复核口径、`options.plan` 净化后写 `result.plan`；
- `src/stores/simulatorTriggerOptimizerActions.js`：store 按计划派样本（`rounds: plan ? plan.plannedRounds : undefined` + `plan` 透传，
  与页面文案同一份输入）；早退分支（无报告 / 缺起点 / 无相邻难度 / 忙）保持现状；
- `src/ui/pages/TriggerOptimizerPage.vue`：入口旁新增「本次复核要跑几轮」明细行（`robustnessPlanText`，三态句 `robustnessPlanSentence`）、
  结果块新增事后留档行（`robustnessPlanDetail`）、`exportReport` 追加复核汇总行（结论 + 同一句计划明细）；
- `locales/zh|en/common.json`：3 键（`robustnessPlanRounds` / `robustnessPlanCapped` / `robustnessPlanBudget`），zh/en 逐一对齐；
- 装置：`scripts/trigger-optimizer-racing-study.engine.mjs`（再导出反解 / 计划函数、上限常量与 `resolveAdjacentDifficultyTier`）、
  `scripts/trigger-optimizer-racing-study.mjs`（相邻难度采样组 + 三臂对照段，含 `assert(CAP >= BASE)` 与 `--seeds >= CAP + BASE` 断言）。

**维护提示**：要改上限时，装置段（`assert(CAP >= BASE)`、`--seeds` 下限）与本文的实测表必须同步改 —— 单方面改常量会让装置按另一套
口径跑，实测数字随即失效（§47 实现期 bug 的教训同款）。2026-09-27 已按此执行一次（12 → 16，§63 实施项 ①）：
装置断言随常量自动成立，本节与 §51 表转为历史记录（见上方修订条）。

**测试**：scoring +3（反解最小性 / A′ 钳位 / 20% 护栏）；domain +6（轮数归一化 1..12、计划白名单保留、丢弃分支、非对象输入）；
服务层 +1（12 轮越过搜索上限 10、快照自洽才留档、不自洽整份丢弃、越界值回落保底 6）；store 就地扩写（计划与轮数同源、
落盘往返 `report.robustness.plan`、无复验统计时省略 `rounds`）；模板 +1（三态上屏 + 导出的有 / 无快照两态）并就地扩写
（计划行 6 轮/侧、旧结果不显示明细行）。

**复现**：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8`（另加 `--slots=2,3`）；
输出在每个 `槽位 N …` 标题之后，搜 `复核轮数自适应对照` 最快。

**诚实边界**：

1. **跨难度外推**：反解用的是**先验难度**的噪声尺度，而噪声是跨区域的（实测区域间差过 20 倍）—— 反解说 9 轮，不等于「9 轮在新难度一定够」；
   本项买的是「按 σ ∝ 1/√n 把先验的效应量搬到新难度」的期望收益，不是保证；
2. **反解的输入是复验统计**：拿不到（旧报告 / `rounds < 2` / `stdError` 缺失）⇒ 计划 `null`，回落到固定 6 轮 —— 不猜；
3. **收益随效应量分布变化**：本轮 621/9000（6.9%）的案例「连上限都不够」（补到上限），可反解的平均只要 3.6 轮；效应量越大，
   A′ 越接近保底 6 轮（额外成本趋近 0），效应量越接近噪声、补到上限的比例越高，成本越接近 F12；
4. 样本只覆盖丛林两个槽（槽 2 的 real 桶为空、槽 3 有真提升），且未建模 racing 选择偏差（引擎在真实运行里会先粗筛）。

**回归**：`npm test` **184 文件 / 2563 用例**全绿（含 `prettier --check .` ✓，55.8s）；`npm run build` ✓（22.6s，仅 chunk > 500KB 警告）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键；该脚本只扫 `queue.*` 域，本项新增的 triggerOptimizer 键不在其内）。

## §50 B 项：追加复验的零差出口与累计花费上限（2026-09-26，实测胜出 P2 ⇒ 已实施）

**问题（同一次采样量化两条缺口）**：

- **B-1 零差路径没有上界**：§47 的轮数反解把「逐轮差恒 0」（`stdError === 0`）当**非法输入**返回 `null` ⇒ 调用方回落
  「固定 +6 轮」兜底。这条路径**不受 24 轮上限约束**（零差样本永远 inconclusive、「追加复验」按钮一直在），可以无限
  追加 —— 实测零差案例占 5.0%~5.6%，现状在它们身上平均烧 **36 场买 0 次判出**，且真实成本只会更高（装置按 24 轮
  统一截断，是保守下界）。
- **B-2 累计花费没有上限**：§47 的 20% 护栏只管**单次**（`2 × plannedRounds ≤ 整轮 × 20%`）。它有隐式上界（由 24 轮
  上限推出的净增 18 轮 = 36 场 ≈ 快档整轮 74 场的 49%），但那是「上限的副作用」而不是「累计预算」—— 零差路径连这个
  副作用都没有，attempts 堆叠（已复验 N 次）也没有任何总量约束。

**口径（B-1 + B-2 = 装置臂 P2）**：

- **B-1 零差合法化**：`stdError === 0` 从「非法输入」改为「合法退化」—— 与其它 `capped` 同出口（`requiredRounds = null`、
  `targetRounds = 上限`）。合法性检查从 `!(stdError > 0)` 改为 `stdError < 0`（非有限 / 负值仍 `null`）。零差是**定义上**
  判不出（同轮数下 t×SE 恒为 0），「补到上限、再由护栏钳住」与 §47 A′ 对 capped 的处置同款。
- **B-2 两级护栏**：单次 20%（§47 不变）之外新增**累计**：`累计已花 + 本次 ≤ 整轮 × 40%`
  （新常量 `TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO = 0.4`）。钳位顺序：先单次（`limitedBy = 'single'`）、
  后累计（`limitedBy = 'cumulative'`，取**最终瓶颈**）；拿不到整轮场次（老报告）= 不限：`cumulativeBudgetSimulations = null`，
  不假装有护栏。累计已花的口径 = `Σ(2 × attempts[i].rounds)`（只数追加部分，不含首轮复验的 12 场；
  `resolveTriggerOptimizerAppendSpentSimulations`），store 与页面共用同一函数、同一输入（否则「文案里的预算」与
  「实际扣的预算」会分裂）。
- **分键顺序**（store / 页面文案）：`decisive`（结论已明确）→ `budgetLimited`（预算用尽）→ `capped`（上限也不够）——
  零差案例在预算耗尽时如实说「预算用尽」，而不是「上限也不够」（两个原因不同，出路也不同）。

**装置三臂（同一批样本、同一套判据；策略 = 一路未达显著就继续点到停，模拟最执着的用户）**：

- **F1（现状）**：常规路径走 §47 生产计划（单次 20% 已烘焙）；零差走 `null` → +6 轮兜底（无上界；装置按 24 轮统一截断）。
- **P1（B-1 + 累计 20%）**：零差视为 capped 补到上限；累计预算 = 整轮 20%。
- **P2（B-1 + 累计 40%）**：B-1 同 P1，只把累计比例放宽到 40% ⇒ **本项采用**。

**预注册判据**（跑正式采样前定稿）：① 假阳性不升（硬）：null 桶「最终判成立」P1 ≤ F1；② 解析率非劣：real 桶
「首轮未达显著 → 最终明确」P1 ≥ F1 − 2pp；③ 成本：P1 期望累计额外场次 ≤ floor(74 × 20%) = 14；④ 自证：451 场档常规路径
（非零差试次）三臂逐值一致。

**实测 · 丛林 4h / 32 种子 / 500 试验 / 5 轮（4384 场，259.6s）**：

| 槽                             | 臂  | 真提升:解析率 | 真提升:判成立 | 合计:解析率      | null:假阳性 | 累计额外场次(全案例) | 零差:花费 |
| ------------------------------ | --- | ------------- | ------------- | ---------------- | ----------- | -------------------- | --------- |
| 3 `flame_blast`（real 桶非空） | F1  | 100.0%        | 100.0%        | 69.9%            | 0.0%        | 3.89                 | 36.0 场   |
|                                | P1  | 100.0%        | 100.0%        | 58.4%（−11.5pp） | 0.0%        | 2.45                 | 14.0 场   |
|                                | P2  | 100.0%        | 100.0%        | 69.8%（−0.2pp）  | 0.0%        | 3.44                 | 28.0 场   |
| 2 `firestorm`（real 桶空）     | F1  | —             | —             | 73.4%            | 0.0%        | 3.83                 | —         |
|                                | P1  | —             | —             | 60.0%（−13.4pp） | 0.0%        | 2.50                 | —         |
|                                | P2  | —             | —             | 73.4%（0.0pp）   | 0.0%        | 3.43                 | —         |

零差案例（首轮 `stdError = 0`）：**F1 花 36 场判出 0 次｜P1 14 场、0 次｜P2 28 场、0 次**；451 场档（预算 90 / 180 场都不咬）
两槽三臂逐值一致（自证 ④ 通过）。判负：real 桶三臂 0 次（全判成立）；null 桶判负率 F1 95.0% / P1 92.5% / P2 95.0%。

**裁决：实施 B-1 + B-2（累计 40%）**。判读：

- **20% 的损失全在 null 桶的「负向明确」**：P1 合计解析率低 11.5~13.4pp，而 real 桶三臂同为 100%（判成立 100%）、
  假阳性全 0.0% —— 少掉的「明确」是 null 候选提前停在 inconclusive（判负率 95.0% → 92.5%），不是能力退化，但会让用户
  多点几次。
- **40% 把判负机会买回来**：P2 判负率回到 95.0%（= 现状），合计解析率与现状持平（−0.2pp / 0.0pp），累计额外场次比现状
  **低 11%**（3.44 vs 3.89）—— 「少花样本、持平结论」。
- 预注册四条：① 假阳性 0.0% ≤ 0.0%（硬闸通过）；② real 桶三臂 100.0% ≥ 100.0% − 2pp（通过）；③ P1 2.45 ≤ 14（通过）；
  ④ 451 档自证通过 —— 全过 ⇒ 采用。

**生产改动清单**：

- `src/services/triggerOptimizerDomain.js`：`TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO = 0.4`（:81）、
  `resolveTriggerOptimizerAppendSpentSimulations`（:348，Σ 2 × rounds，只数追加部分）、
  `normalizeTriggerOptimizerAppendPlan`（:362，白名单 +3 字段 `limitedBy` / `spentSimulations` / `cumulativeBudgetSimulations`；
  `limitedBy` 是枚举，枚举之外整份丢弃）；
- `src/services/triggerOptimizerScoring.js`：`resolveTriggerOptimizerVerificationRounds`（:452，零差 → capped 分支）、
  `planTriggerOptimizerVerificationAppend`（:502，两级钳位 + 返回值 +3 字段；`spentSimulations` 由 `options.spentSimulations` 读入）；
- `src/services/triggerOptimizerSearch.js`：无逻辑改动（注释更新，:1297）—— 快照净化的字段白名单在 domain，服务层不感知新字段；
- `src/stores/simulatorTriggerOptimizerActions.js`：`runTriggerOptimizerVerificationAppend`（:721）传 `spentSimulations`
  （与页面同一函数），早退分键顺序改为 decisive → budgetLimited → capped（:732）；
- `src/ui/pages/TriggerOptimizerPage.vue`：`verifyAppendMergedText`（:1613，合并行加「累计追加 N 场」）、`verifyAppendPlan`
  （:1632，加 `spentSimulations`）、`verifyAppendPlanText`（:1643，预算行含两级比例 + 「累计追加 X / Y 场（含本次）」后缀）、
  `verifyAppendArchiveText`（:2017，预算档显示「单次 ≤ 20% · 累计 ≤ 40%」）、`exportReport`（:2083，汇总行同一口径）；
- `locales/zh|en/common.json`：6 键（`verifyAppendMerged` / `verifyAppendPlanBudget` / `verifyAppendBudgetExhausted` /
  `verifyAppendArchiveBudget` 改文 + 新增 `verifyAppendCumulative`），zh/en 逐一对齐；
- 装置：`scripts/trigger-optimizer-racing-study.engine.mjs`（再导出 `planTriggerOptimizerVerificationAppend`，:83）、
  `scripts/trigger-optimizer-racing-study.mjs`（「追加复验堆叠对照」段 :1348-1596，三臂 + 451 档自证 + 零差单列）。

**维护提示**：

1. 改 `TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO` 必须同步装置 P2 的 **0.4 硬编码**（:1478）与本文实测表 ——
   单方面改常量会让装置按另一套口径跑（§47 实现期 bug 的教训同款）；
2. **F1 列是「改动前现状」的历史数字**：装置 engine 在运行时打包**当前**生产模块，本项实施后重跑，零差分支会走 B-1
   （不再是「+6 兜底」）⇒ F1 列不再逐值可复现；要复现历史 F1 需临时还原 B-1（P1 / P2 列不受影响）。

**测试**：scoring 就地扩写（零差 B-1 用例；两级护栏与累计耗尽用例；未咬 / 拿不到整轮的三处 `toMatchObject` 扩字段）；
domain +1（`resolveTriggerOptimizerAppendSpentSimulations` 口径与脏值）+ 快照白名单扩 3 字段与 `limitedBy` 枚举脏值丢弃；
服务层就地扩写（常规 / capped 两个 plan 夹具扩字段，锁定逐字段留档）；store 就地扩写（① 断言 `limitedBy = 'single'`；
新增 ⑤⑥ 两个累计护栏情形：剩余 4 场 = 2 轮、花满 40 场 ⇒ `verifyAppendBudgetExhausted`；落盘断言扩 `limitedBy` /
`spentSimulations`）；模板就地扩写（计划行含「累计 ≤ 40%」与「累计追加 2 / 4 场（含本次）」、合并行「累计追加 12 场」、
导出汇总行「已复验 1 次 · 合并 24 轮 · 累计追加 36 场」）。

**复现**：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8`
（4384 场 / 259.6s / exit 0；日志 `.snow/logs/node-20260925-234827-756.log`）。输出在每个 `槽位 N …` 标题之后，
搜 `追加复验堆叠对照` 最快；`--seeds` 下限 24 由 `assert(args.seeds >= CAP)` 保证。

**诚实边界**：

1. **主据是 real 桶**：null 桶的「明确」含 negative（对 null 候选判负是好事，不构成假阳性问题），合计解析率在 real 桶为空时
   偏悲观（槽 2 即如此）—— 20% 与 40% 的差距因此主要读 real 桶，合计口径只作参照；
2. **F1 的零差成本是保守下界**（装置按 24 轮统一截断，真实现状无上界）⇒ 「P2 比现状便宜 11%」在真实使用里只会更明显；
3. **零差占比 5.0%~5.6%**，样本只覆盖丛林两个伤害槽（槽 2 / 3）、4h / 32 种子 / 500 试验；
4. 未建模 racing 选择偏差（引擎在真实运行里会先粗筛，这里的样本没有筛选过程）；
5. 累计比例只测了 20% / 40% / 不咬（451 档）三个点：40% 不是搜索出来的最优值，只证明「20% 收得太紧、40% 与现状持平」；
   护栏按比例定义，换整轮量级时绝对场次随之缩放。

**回归**：`npm test` **184 文件 / 2564 用例**全绿（含 `prettier --check .` ✓，57.5s）；`npm run build` ✓（28.7s，仅 chunk > 500KB 警告）；
`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键；该脚本只扫 `queue.*` 域，本项新增的 triggerOptimizer 键不在其内）。

## §51 B-2：复核复跑换盐追加与零差出口（2026-09-26，S2 实测胜出 ⇒ 已实施）

**问题（同一轮采样量化的两条缺口）**：

- **复跑恒等、满价、覆盖留档**：稳健性复核的种子由玩家 / 配置 / 目标 / 难度 / 时长 / 盐确定；同一份报告再次复核时目标难度不变、固定盐也不变，因此第二次派出的种子与首跑逐值相同，同 payload + 同种子给出同一批逐轮样本。成本仍是 `2 × rounds` 场（每轮评估搜索起点与模拟最优两个配置），信息增量为 0。旧 store 还在开跑前清空 `results.robustness`：同盐重跑会覆盖结论，中途取消甚至丢掉上一份结论。
- **零差先验没有出口**：先验目标难度 `stdError = 0`（逐轮差恒为 0）时，§49 反解退化为 `null`，首跑回落保底 6 轮；同一目标难度上的更多轮差仍然全为 0，判据依旧没有信息，不能靠不断复跑解决。

**语义与口径（首跑维持 §49，复跑实施 S2）**：

- **首跑不变**：尚无 `results.robustness` 时，继续复核报告适用范围的相邻难度，按 §49 计划首跑（保底 6 / 总量上限 16——2026-09-27 起，初版 12 / 单次 20% 护栏），结果写入 `results.robustness`。
- **复跑 = 同难度换盐追加**：报告已有复核结论后，再点复核沿用该结论记录的 `difficultyTier`（不重新挑相邻难度），追加盐为 `${TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS}.r${attempt}`。每次追加的种子与首跑、既往追加和其它优化阶段不相交；新增两侧样本与已有样本拼接后，**以全部合并样本重新计算** paired 统计与 verdict，并就地覆盖 `results.robustness`。
- **attempts 留档**：每次追加记录 `{ attempt, rounds, seeds, paired, verdict, mergedRounds, mergedVerdict, plan? }`。`rounds` 是本次追加轮数/侧，`mergedRounds` 是合并后的总轮数；plan 只在白名单 / 类型校验通过且 `plannedRounds === rounds` 时留档。store 在合并成功后刷新 `createdAt`；取消 / 失败不覆盖旧结论。合并报告（含 attempts、样本和计划）继续通过现有报告存储持久化。
- **追加计划 S2**：目标是补齐至复核总量上限 16（初版 12，2026-09-27 起），即 `max(0, 16 − currentRounds)` 轮/侧；不再按需反解追加量（S1）。追加计划独立于 §49 首跑计划，缺少追加所需样本时明示错误，不猜样本。
- **零差 / 总量上限出口**：`stdError === 0` ⇒ `plannedRounds = 0, zeroDiff = true`；已有轮数达到上限 ⇒ `plannedRounds = 0, atCap = true`。两者均不派模拟，并显示对应原因。
- **两级增量预算**：新增样本须同时满足单次 `2 × plannedRounds ≤ 整轮模拟场次 × 20%`，以及累计 `已追加场次 + 本次 ≤ 整轮模拟场次 × 40%`。先按单次预算钳位、再按累计预算钳位；`limitedBy` 留最终瓶颈（`single` / `cumulative`）。已花场次为 `Σ(2 × attempts[i].rounds)`，只数追加，不含首跑复核。整轮场次未知的旧报告不伪造预算，两个预算字段为 `null`、不触发护栏。
- **分键优先级**：`zeroDiff` → `atCap` → `budgetLimited` → 通用追加耗尽。零差是「再加样本也不能判出」，应优先于成本 / 上限提示。

**装置四臂与预注册判据**（同一真实样本矩阵、逐例配对；`F12` 只作功效参照，不参与裁决）：

- **F′**：现状复跑（相同盐 / payload，复用同一批样本；不产生新增信息）。
- **S1**：首轮未达显著时换盐，按目标难度当前统计反解按需补到 $n^*$；再受单次 20% / 累计 40% 护栏限制。
- **S2**：首轮未达显著时换盐补到复核总量上限 16（初版 12）；同样受两级护栏限制。生产候选。
- **F12**：固定 12 轮参照，报告已测过的 12 轮功效量级。
- 预算档为 **40 / 74 / 451 场**（小预算验证护栏钳位、74 场代表快档 4h 整轮量级、451 场作为护栏不应咬住的自证档）。预注册：① null 桶判为 positive 的假阳性率 S1 / S2 不高于 F′；② real 桶中 F′ 首轮未达显著者，经该臂后达到明确结论的比例至少 80%；③ 74 场档期望额外场次不超过单次护栏 14 场；④ 恒等 / 换盐 / 同 payload 样本三个断言通过，且 451 场档两级护栏钳位数为 0。两候选都过闸时取解析率更高者；差距小于 2pp 时才以额外成本较低者优先。

**实测（正式采样：4h / 32 种子 / 500 试验 / 搜索 5 轮；下表为日志中目标难度 tier 1）**：

| 整轮预算 | 臂  | real：F′ 未达显著 → 最终明确 | real：最终 positive | 总轮数/侧均值 | null 假阳性 | 期望追加场次/案例 |
| -------- | --- | ---------------------------- | ------------------- | ------------- | ----------- | ----------------- |
| 40 场    | F′  | 0.0%                         | 74.8%               | 7.02          | 0.0%        | 0.0               |
| 40 场    | S1  | 81.7%                        | 95.4%               | 7.71          | 0.0%        | 1.8               |
| 40 场    | S2  | 87.8%                        | 96.8%               | 10.60         | 0.0%        | 7.6               |
| 40 场    | F12 | 97.6%                        | 99.3%               | 12.00         | 0.0%        | 0.0               |
| 74 场    | F′  | 0.0%                         | 74.8%               | 7.35          | 0.0%        | 0.0               |
| 74 场    | S1  | 89.4%                        | 97.3%               | 8.19          | 0.0%        | 2.3               |
| 74 场    | S2  | 97.6%                        | 99.3%               | 12.00         | 0.0%        | 10.7              |
| 74 场    | F12 | 97.6%                        | 99.3%               | 12.00         | 0.0%        | 0.0               |
| 451 场   | F′  | 0.0%                         | 74.8%               | 7.35          | 0.0%        | 0.0               |
| 451 场   | S1  | 89.4%                        | 97.3%               | 8.19          | 0.0%        | 2.3               |
| 451 场   | S2  | 97.6%                        | 99.3%               | 12.00         | 0.0%        | 10.7              |
| 451 场   | F12 | 97.6%                        | 99.3%               | 12.00         | 0.0%        | 0.0               |

解析率的分母是 F′ 在 real 桶首轮未达显著的 378 次试验；74 场档 S1 为 338/378、S2 为 369/378。S2 比 S1 高 **8.2pp**，超过预注册的 2pp 成本择优带；两臂 null 假阳性均为 0.0%，S2 的期望额外场次 10.7 ≤ 14。

护栏自证按正式日志记录：**40 场档**单次 / 累计预算为 8 / 16 场，S1 / S2 被钳位 1528 / 8250 次；**74 场档**预算 14 / 29 场，S1 / S2 均 0 次钳位；**451 场档**预算 90 / 180 场，S1 / S2 均 0 次钳位（断言通过）。451 档数字没有护栏截断，不能把它当作钳位数据。

恒等自证通过：同盐两次种子派生逐值相同；相同 payload + 种子探针的样本逐值相同；`.r2` 新盐种子与首跑盐不相交。74 场档现状复跑的平均价为 `2 × 首跑轮数 = 13.3` 场、信息增量 0。零差先验桶为 **500/9500 = 5.3%**，来自 **1 个候选案例**；目标难度同样零差率 100%，首轮 6 轮与补到 12 轮均 0 次判出。

**裁决：实施 S2（换盐追加、合并重检、零差出口、两级预算）**。全部硬闸通过；real 桶解析率 S2 97.6% 高于 S1 89.4%（差 8.2pp），故不选更省成本但解析率较低的按需 S1。生产维持「合并总量最多 12 轮」；在 74 场档 S2 实测期望额外场次 10.7 场，低于 14 场的单次上限。

**生产改动清单**：

- `src/services/triggerOptimizerDomain.js`：新增独立 `normalizeTriggerOptimizerRobustnessAppendRounds`（追加上限 16——落地时 12，2026-09-27 随上限提升；不复用搜索口径）；复核 plan 白名单可选补注 `zeroDiff` / `atCap` / `limitedBy` / `spentSimulations` / `cumulativeBudgetSimulations`，旧 §49 计划缺省时补安全默认值；复核追加盐沿用 robustness 根盐并追加 `.r${attempt}`。
- `src/services/triggerOptimizerScoring.js`：新增纯函数 `planTriggerOptimizerRobustnessAppend`，实现补到总量上限、零差 / 已达上限出口、单次 20% 与累计 40% 两级护栏。
- `src/services/triggerOptimizerSearch.js`：新增 `appendTriggerOptimizerRobustness`；使用追加盐与首跑逐轮样本合并重检，输出追加自身统计 / 合并结论 / attempts；缺样本时抛 `MISSING_ROBUSTNESS_ERROR`；取消返回旧结论，不覆盖统计字段。
- `src/stores/simulatorTriggerOptimizerActions.js`：`runTriggerOptimizerRobustness` 按是否已有复核结果分首跑 / 追加；目标 tier 沿用记录值；追加前按 plan 早退分键；开跑不清空旧结论，合并成功才替换并刷新 `createdAt`。
- `src/ui/pages/TriggerOptimizerPage.vue`：首跑结论存在时隐藏首跑按钮、展示追加按钮 / 合并轮数与已花场次 / 本次追加计划；零差、达上限、预算用尽显示各自原因；运行与停止标签区分追加态；导出追加汇总与逐次 attempts 明细。
- `locales/zh/common.json`、`locales/en/common.json`：追加入口 / 运行态 / 计划 / 阻断原因 / attempts 留档键；补 `robustnessAppendMissing`，两语言逐键对称，引用均使用 `common:` namespace。
- `scripts/trigger-optimizer-racing-study.engine.mjs`、`scripts/trigger-optimizer-racing-study.mjs`：复导生产计划与常量；新增 §51 四臂 / 三预算档、种子恒等与互斥断言、451 场零钳位断言、预注册判读输出。

**维护提示**：

1. `TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS` 是**首跑 + 全部追加的合并总量上限**，不是「每次追加最多 16 轮」（2026-09-27 起；初版 12）；追加归一化 / planner / store / 页面 / 测试与装置必须保持同口径。
2. 追加预算只计 `attempts[].rounds × 2`，不含首跑；页面与 store 共用 `resolveTriggerOptimizerAppendSpentSimulations`。改单次 / 累计比例时同步核对 `trigger-optimizer-racing-study.engine.mjs` 导出的生产常量与实测表。
3. 老报告若缺少 `results.simulations`，计划会把两级预算记为 `null`（不声称有护栏）；缺少首跑两侧 samples 则拒绝追加，不得伪造 / 重建样本。
4. 复核目标难度固定沿用 `results.robustness.difficultyTier`；若修改到追加时重新挑难度，首跑与新样本就不再是同一现场，不能继续合并统计。

**测试**：domain 覆盖追加轮数归一化、旧 plan 新字段默认、枚举外 `limitedBy` 整份丢弃；scoring 覆盖 zeroDiff / atCap / 补满上限 / single 与 cumulative 钳位 / 未知预算 / 退化摘要；search 覆盖 6+6 合并重检、`.r1/.r2` 与旧盐互斥、样本缺失、取消保留旧结论、plan 自洽留档、16 轮追加上限（落地时 12）；store 覆盖首跑 / 追加分流、早退键优先级、旧结论保留、落盘往返；页面覆盖追加入口 / 提示 / 阻断原因 / 首跑入口互斥 / attempts 导出；i18n 覆盖双语键对称。

**复现**：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8`（正式采样 exit 0；日志 `.snow/logs/node-20260926-003457-835.log`）。用装置构建出的 `engineUrl` 导入生产模块，避免 Node 直接导入生产 JSON 模块时被 JSON import attributes 限制。

**诚实边界**：

1. **序贯检验保证是外推，不是本项证明**：「合并重检 = 最多追加 N 次的序贯检验，整体假阳性率仍达标」是从 §31 bootstrap 口径外推。本项实测只证明 null 桶假阳性率在 F′ / S1 / S2、三预算档中均为 0.0%、未升高；没有对任意追加次数给出家族错误率 / 停时定理保证。
2. **零差案例数少**：500 次零差试验来自 1 个候选案例（占 9500 次试验 5.3%），而不是 500 个独立候选案例；“目标难度同为零差、6 / 12 轮均未判出”只支持明示退出，不足以估计跨区域普遍占比。
3. **预算钳位按日志逐档读**：40 场档确实触发钳位（S1 1528 / S2 8250）；74 场档与 451 场档均未触发。451 档的三臂相同不是「护栏行为已验证」，只有 40 场档展示公式实际钳位，451 档展示上限内不应误钳。
4. **换盐追加仍真实花钱**：语义是「用新随机流确认同一难度」，不是免费缓存或合并同一批结果；每次追加实付 `2 × 本次轮数` 场。若用户继续追加，仍会消耗单次 / 累计预算直至出口 / 护栏生效。
5. **F′ real 解析率 0.0% 是定义，不是测不到**：F′ 复用现有复核样本、没有采到独立新样本，所以不能把原先未达显著的结果记作「新增证据已解析」；74.8% 是 real 桶最终 positive 判定比例，二者不是同一指标。

**回归**：定向 6 个测试文件 **225 / 225** 通过；全量 `npm test` **184 文件 / 2582 用例**通过（含 `prettier --check .`）；`npm run build` 成功（仅有 >500KB chunk 警告）；`npm run check-dead-keys` 成功（en/zh 各 143 queue 键、0 死键、键集对称）。

## §52 A 项：两把尺子指名分离——噪声地板（采纳口径）与显著门槛（判定口径 p<0.05）（2026-09-26，方向 c+ ⇒ 已实施）

**问题（同一个「还差多少证据」，两把尺子却共用无口径措辞）**：结论卡与建议句里其实同时存在两个「还差多少」的答案，却没有分别指名自己是哪把尺子：

- **尺子①（§45 家族，采纳口径，记作 A）**：固定 `2 × SE`（常量 `TRIGGER_OPTIMIZER_ADOPTION_NOISE_MULTIPLIER = 2`）。服务**采纳闸门**——搜索期 `hasAdoptionEvidence` 用它决定候选是否敢采纳；上屏由 `projectTriggerOptimizerDetectionFloor` 给出 `noiseFloor`；§45 反解 `resolveTriggerOptimizerRoundsForEffect` 用它把「目标效应要过闸」换算成轮数（上限 10）。文件头与 §16.2 早已声明：这是「比噪声大」，**不是显著性声明**。
- **尺子②（§47 / §49 / §51 家族，判定口径，记作 B）**：`t(n−1) × SE`（`tCritical`）。服务**判定**——逐轮 verdict / `pairedPValue`、§47 复验轮数反解（上限 24）、§49 复核轮数反解（上限 16；初版 12）、§51 追加（不做反解、补到上限）都按它回答「判成 p<0.05 明确结论还需要多少样本」。

缺口不在数字（结论卡同时印两个数：`±A = 2×SE` 与 `±B = t×SE`；徽章 tooltip 也声明了「不是显著性声明」），而在**措辞**：A 被叫作「可确认下限」，§45 建议句写「……确认下来，需提到 ≈N 轮」，而 N 却是采纳口径的轮数——读起来像显著性承诺；§47 / §49 的建议句用 B 的轮数。「确认下来」这类无口径动词把两把尺子混成一把：用户按 A 的轮数加轮，加到点也判不出。

**结构性事实（两把尺子在全部可达轮数内不可能给出同一个答案）**：`t(n−1) > 2` 对一切 `n ≤ 61` 成立；而搜索 ≤ 10 轮、复核 ≤ 12 轮、复验 ≤ 24 轮，故 `B > A` 恒成立，两把尺子不可能重合。差异因子 `B / A = t(n−1) / 2`：

| 轮数 n  | 2     | 3     | 4     | 5     | 6     | 7     | 8     | 9     | 10    | 12    | 24    |
| ------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| `B / A` | 6.353 | 2.151 | 1.591 | 1.388 | 1.285 | 1.223 | 1.182 | 1.153 | 1.131 | 1.100 | 1.034 |

既有算例（5 轮、`SE = 0.006`、目标 0.01 分）：采纳口径反解得 **8 轮**（5 × (0.012/0.01)² = 7.2），判定口径反解得 **10 轮**；8 轮时的显著门槛 ≈ **0.0112 > 0.01**——「提到 8 轮」永远买不来该量级的 p<0.05。这正是会被误读的数值现场。

**方向裁决（用户拍板 c+：分离 + 指名，数值零改动）**：

- 尺子① 一律称「**噪声地板（采纳口径）**」：语义 = 比噪声大、可被采纳；**不是**显著性声明。
- 尺子② 一律称「**显著门槛（判定口径 p<0.05）**」：语义 = 判成明确结论的门槛。
- §45 建议句由「……确认下来」改为「……**能被采纳**（过噪声地板：比噪声大，不是显著性声明）」，并追加显著子句：「**判成 p<0.05 的明确结论需 ≈M 轮**」；超出上限则明说「上限内判不出来——显著性以复验 / 追加复验的统计为准」。
- **判定数值与执行路径零改动**：`hasAdoptionEvidence`、verdict、§47 / §49 / §51 计划函数、store 派样本路径全部不动；本项只新增一个只读展示反解与文案分支。
- 备查：未选 (a) 上屏下限改 `t×SE`、(b) 反解改 `2×SE`——两者都要动既有语义与执行数值（§21 已明确 2×SE 只服务采纳），与「零改动」前提冲突。

**预注册判据（实施前定稿，全部通过）**：

1. 两把尺子各自指名：A 一律「噪声地板（采纳口径）」、B 一律「显著门槛（判定口径 p<0.05）」；建议句不得再用无口径动词「确认下来」（模板测试断言关键词）。
2. 显著反解最小性：解 M 满足 `B(M) ≤ 目标 < B(M−1)`，`B = t(n−1) × SE`、`SE ∝ 1/√n`（用 `projectTriggerOptimizerDetectionFloor` 的 `significanceFloor` 断言：9 轮 ≈ 0.010314 > 0.01、10 轮 < 0.01）。
3. 与 §47 共用同一把尺子：同一输入下 `resolveTriggerOptimizerRoundsForSignificance(...).rounds === resolveTriggerOptimizerVerificationRounds({ rounds, mean: effect, stdError, verdict: 'inconclusive' }, cap).requiredRounds`（不变量测试，实测同为 10 轮）。
4. 分支文案与实际状态一一对应：satisfied / rounds / capped × 显著子句（已可判出 / 需 ≈M 轮 / 上限内判不出）逐态断言；capped 分支不得出现可行的追加轮数；已够分支不得出现「重复次数需提到」。
5. 判定数值与执行路径零改动：既有数值断言（`hasAdoptionEvidence`、verdict、各阶段计划函数的保底 / 上限 / 预算）全部保持原值。

**改动清单**：

- `src/services/triggerOptimizerScoring.js`：新增只读反解 `resolveTriggerOptimizerRoundsForSignificance(floor, effect, maxRounds)`——与 §45 函数同形状（同一 σ 估计、同一 `∝ 1/√n` 缩放），判据换成 `t(n−1)×SE`；非法输入返回 `null`；上限内无解返回 `capped`。§45 函数注释补「口径归属」两行。
- `src/ui/pages/TriggerOptimizerPage.vue`：`detectionFloorAdvice` 追加显著子句（三态分别取 `detectionFloorAdviceSignificanceAtCurrent / Rounds / Capped`，显式字面量键供 i18n 扫描）；三个主分支句尾注入 `{{significance}}`；`detectionFloor` / `resultNotes` 注释同步改口径措辞。
- `locales/zh/common.json`、`locales/en/common.json`：改写 7 键（`roundsHint`、`evidenceBlocked`、`detectionFloor`、`detectionFloorAdviceRounds / Satisfied / Capped`、`noteDetectionFloor`），标签统一为「噪声地板与显著门槛」/「Noise floor and significance threshold」；新增 3 键（`detectionFloorAdviceSignificanceRounds / AtCurrent / Capped`）；zh/en 逐键对称、全 `common:` 冒号前缀、参数注入 `t(key, '', params)`。
- 注释口径清理 6 处（scoring 头注释与其 §45 测试注释、页面模板注释与 notes 注释、模板测试两处）；页面 `detectionFloorAdvice` 注释内保留对「确认下来」的引用作为**有意反例**。

**测试锚点**：

- scoring：新增 `significance rounds（§52 判定口径反解）` describe 4 用例——最小性 + 与 2×SE 尺子分歧（同输入 8 vs 10）；与 §47 同尺子不变量（同 = 10）；三出口（`(10, 0.004)` 已够；`(5, 0.01)` 上限内无解返回 `capped`；「补到 N 轮」出口由最小性用例覆盖）；非法输入 `null`。
- 模板：主用例改名 `shows both rulers (noise floor / significance threshold) and the rounds each one needs`，四态重钉——satisfied 含「需 ≈8 轮」、不含「重复次数需提到」；planned 含「需提到 ≈8 轮」与「需 ≈10 轮」；capped 含「判不出来」「复验」、不含「需提到」；at-max 含「判不出来」、不含「把重复次数提到」。
- i18n：`i18nResources.test.js` 全仓 `t()` 字面量键核对 + zh/en 键集对称（覆盖新增 3 键）。

**免装置论证（如实）**：本项只改展示层与建议句（新增一个只读展示反解 + 文案分支），零执行路径 / 判定数值 / 派样本逻辑变更，因此不设三臂对照、**未做任何新采样**；装置（`scripts/trigger-optimizer-racing-study.mjs`）本项未改动、未运行。验证全部走构造样本：两把尺子在同一构造 `floor` 上直接断言（8 vs 10 分歧与 §47 不变量毫秒级复现），文案分支由模板测试在四种数据状态下逐字钉住，键集对称由 i18n 测试覆盖。

**诚实边界**：

1. **`SE ∝ 1/√n` 是外推**：两把尺子的反解都按当前 SE 的 √ 缩放外推（与 §45 / §47 / §49 同一外推口径），假设后续轮次噪声结构与当前一致；不是逐轮重采样验证。
2. **两尺子差异是设计内、且只做了指名**：`n ≤ 61` 内 `B > A` 恒成立；本项不统一数值（那会动判定语义）。将来若要「统一到一把尺子」，须按新口径重新预注册、并可能改执行数值。
3. **cap 常量各自耦合**：显著子句上限取搜索上限 `TRIGGER_OPTIMIZER_MAX_ROUNDS = 10`；复核 / 复验的判定上限分别为 12 / 24，跨阶段以各阶段函数为准（capped 文案已指向「复验 / 追加复验的统计」）。
4. **利润换算只作量级参考**：建议句里的利润百分比是 w 权重换算的参考量级，不是收益承诺（沿用 §45 口径）。
5. **免装置的另一面**：本项没有实测，因此没有度量「用户是否读懂」；可证明范围 = 两把尺子的数值不变量 + 四态文案关键词 + 键集对称。

**复现**：`npx vitest run src/services/__tests__/triggerOptimizerScoring.test.js src/ui/__tests__/TriggerOptimizerPage.template.test.js src/ui/__tests__/i18nResources.test.js`（定向 3 文件）；全量 `npm test`。

**回归**：定向 3 文件 **129 / 129** 通过（scoring 60 / 模板 54 / i18n 15）；全量 `npm test` **184 文件 / 2586 用例**通过（含 `prettier --check .`；较 §51 基线 +4 用例 = 本项新增）；`npm run build` ✓（仅 >500KB chunk 警告）；`npm run check-dead-keys` ✓（en/zh 各 143 queue 键、0 死键、键集对称；该脚本只扫 `queue.*`，本项新增键不在其内）。

## §53 A 项：「证据预算」统一上屏与导出（2026-09-27，已实施，免装置）

**问题（同一个「还能补多少」，两条路径各说各话、导出只有明细没有总览）**：两条追加路径各自有成本护栏（整轮场次 × 累计 40%，单次追加 ≤ 20%），但预算信息散落且不对称：

- **复验追加（§47 / §50）**：点前计划句里有「累计追加 {{spent}} / {{budget}} 场（含本次）」；但结论转正、入口消失之后，这一句也跟着消失（剩余进度无处可查）。
- **复核追加（§49 / §51）**：点前提示句只有本次轮数，没有累计进度；预算用尽 / 零差 / 已达上限三种出口句只给「原因」，不带数字。
- **导出**：两条路径都只有逐次追加明细，没有任何一处汇总「这份报告的追加预算花到哪了」。

于是用户回答不了三个问题：还能补多少样本？两条路径分别花了多少？为什么不能再点（并核对它）。预算语义其实早已存在（§50 / §51），缺的是**同一处视图**。

**口径（证据预算 = evidence budget）**：

- 两条**独立**预算池：复验追加池与复核追加池各自 = 整轮场次 × 累计 40%（`TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO`）；单次追加另有 20% 上限（`..._BUDGET_RATIO`）。**池子彼此独立、不合并、已花不跨路径相加**（这是既有执行语义，本项不改）。
- 已花 = `Σ(2 × attempts[].rounds)`（`resolveTriggerOptimizerAppendSpentSimulations`，只算追加、不含首跑）；剩余 = `max(0, 预算 − 已花)`。
- 数字全部取自与执行同一纯函数、同一份输入的计划字段（`spentSimulations` / `cumulativeBudgetSimulations` / `plannedRounds` / 出口标记），页面不另行重算。
- 诚实降级：缺整轮场次的旧报告只说「已花 X 场（预算不可用）」，不编预算与剩余。
- 出口原因只报「确实咬住」的那一个：零差 / 已达总量上限 / 成本护栏（单次 ≤ 20% · 累计 ≤ 40%）无余量。

**改动清单**：

- `src/ui/pages/TriggerOptimizerPage.vue`：新增 `evidenceBudgetNote`（两条路径各一行、`｜` 连接：`{{label}}：已花 {{spent}} / 预算 {{budget}} 场（剩余 {{remaining}}）` + 出口子句），由 `appendEvidenceBudgetLine` 组装（可见性：至少一条路径「有实花（attempts ≥ 1）」或「已停在出口」，否则整条不出现）；`verifyAppendPlan` 拆成不设门槛的 `verifyAppendBudgetPlan`（verdict 转正、入口消失后仍能照实报账）+ 保持原判据的 `verifyAppendPlan`；复核追加 hint 补上与复验同款的「累计追加 X / Y 场（含本次）」子句；说明弹窗新增「证据预算」条目；导出汇总表新增一行（与弹窗逐字同文）。
- `locales/zh/common.json`、`locales/en/common.json`：新增 9 键（`noteEvidenceBudget`、`evidenceBudgetVerify` / `evidenceBudgetRobustness`、`evidenceBudgetLine` / `evidenceBudgetNoBudget`、`evidenceBudgetStopZeroDiff` / `StopCap` / `StopBudget`、`robustnessAppendCumulative`），zh/en 逐键对称、全 `common:` 冒号前缀。

**预注册判据（实施前定稿，全部通过）**：

1. 数字同源：弹窗与导出的每个数字都取自计划字段（与执行同一纯函数、同一份输入），页面不重算（构造报告 → 断言文本逐字）。
2. 两条路径分行、不合并：两行标签各自指名「复验追加 / 复核追加」；一方已花不出现在另一方的行里。
3. 剩余 = `max(0, 预算 − 已花)`：护栏钳到 0 时显示 0、不得为负。
4. 诚实降级：无整轮场次 ⇒ 只出现「已花 X 场（预算不可用）」，不得出现预算 / 剩余数字。
5. 出口一一对应：零差 / 已达上限 / 预算用尽各有子句；**没花过、也没停在出口 ⇒ 整条不出现**（不留空条目）。
6. 同文：导出汇总行与说明弹窗逐字相同；决策点两条路径的累计子句同款（复核 hint 的 `robustnessAppendCumulative` 对应复验的 `verifyAppendCumulative`）。

**测试锚点**：

- 模板：新增用例 `collects both append budgets into one evidence-budget note and export row`——五态（默认不出现 / 双路径实花 `复验追加：已花 12 / 预算 25 场（剩余 13）｜复核追加：已花 4 / 预算 25 场（剩余 21）` / 旧报告降级 / 复核达上限 16 轮 / 护栏钳 0）+ 导出行逐字相等；默认报告的说明弹窗用例补「不出现」断言；复核追加用例两处补「累计追加 … / 33 场（含本次）」断言（2026-09-27 复核上限 12→16 后为 16 / 33 与 20 / 33）。
- i18n：`i18nResources.test.js` 全仓 `t()` 字面量键核对 + zh/en 键集对称（覆盖新增 9 键）。

**免装置论证（如实）**：本项只改展示与导出（新增一个只读 computed + 三个落点），零执行路径 / 预算数值 / 派样本逻辑变更，**未做任何新采样**；装置（`scripts/trigger-optimizer-racing-study.mjs`）本项未改动、未运行。验证全部走构造报告：五个状态的数字由测试夹具直接算出并逐字断言（例如整轮 64 场 ⇒ 预算 25 场、追加 1×6 轮 ⇒ 已花 12 场、护栏钳到 0 ⇒ 剩余 0 不为负）。

**维护提示**：

1. 「已花」的唯一口径是 `resolveTriggerOptimizerAppendSpentSimulations`（Σ2×rounds、只数追加）；证据预算、合并留档行与成本护栏共用它——改口径必须三处同步。
2. 百分比文案来自 `TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO` / `..._CUMULATIVE_BUDGET_RATIO`（`Math.round(×100)`）：改常量时计划句 / 阻断句 / 证据预算三处同步（§50 的装置硬编码提示仍然有效）。
3. `robustnessAppendCumulative` 与 `verifyAppendCumulative` 是双胞胎：措辞与参数（`spent` = 已花 + 本次、`budget` = 累计预算）必须同改，模板测试两处断言跟着动。

**诚实边界**：

1. **预算是「整轮场次」的函数**：整轮场次来自报告记录；换档 / 改时长重跑会改变预算池大小，不同报告之间的「剩余」不可直接比较。
2. **已花只认 attempts 留档**：历史追加若没有留档（旧报告）则计 0——视图说的是「记录在案的已花」，不是「真实花掉的场次」。
3. **单次 20% 与累计 40% 是两个瓶颈**：说明条目的出口子句只在计划明确时给出，且不替代点前的计划句（后者负责「这一次会花多少」）。
4. **本地化文案只保证「各态有词」**：五态 + 降级的关键词已逐态断言；「用户是否按它做决策」不在测试范围内。
5. **免装置的另一面**：本项没有实测，可证明范围 = 构造夹具的逐字数字 + 两处同文 + 键集对称。

**复现**：`npx vitest run src/ui/__tests__/TriggerOptimizerPage.template.test.js src/ui/__tests__/i18nResources.test.js src/ui/__tests__/triggerOptimizerExport.test.js`（定向 3 文件）；全量 `npm test`。

**回归**：定向 3 文件 **72 / 72** 通过（模板 55 / i18n 15 / 导出 2）；全量 `npm test` **184 文件 / 2587 用例**通过（含 `prettier --check .`；较 §52 基线 +1 用例 = 本项新增）；`npm run build` ✓（仅 >500KB chunk 警告）；`npm run check-dead-keys` ✓（en/zh 各 143 queue 键、0 死键、键集对称；该脚本只扫 `queue.*`，本项新增键不在其内）。

---

## §54 A 项：worker realm 批量化 —— 一次评估一个 realm（模拟速度）（2026-09-27，实测胜出 ⇒ 已实施）

> 用户口径（2026-09-27）：暂缓导出类工作，优先「结果准确性」或「模拟速度」。准确性侧盘点后已到噪声
> 地板（§30.8 实测：假采纳 0.2%、真最优进精测 100%、选择偏差 ≈0.00008 分）；本轮取速度侧唯一
> **不动任何判据/样本** 的可测杠杆：删掉「每场模拟新建一次 worker realm」的固定开销。

### 54.1 问题与取证（读码 + 跨运行旁证）

- 生产形态：`evaluatePayload`（`triggerOptimizerSimulation.js`）按种子串行循环，每一场都调
  `runSingleSimulationPayloadWithDedicatedWorker` → 内部 `new Worker(...)` → 跑 **1 场** → terminate。
  标准 4h 一次运行 ≈ 676 场 ⇒ **676 次 realm 新建**，而评估只有 85 次（§20.4 的同一运行）。
- 旁证（同一 4h 夹具）：装置（复用 realm）≈ 0.72 s/场/worker（§38 3072 场/278s @8 workers）；
  应用内两次实测 ≈ **1.11~1.13 s/场/worker**（§17 A 510 场/141.5s、§20.4 676 场/190.4s，均并发 4）
  ⇒ 每场固定开销 ≈0.4 s。构建产物给出量级解释：`worker-*.js` 是 **2.3 MB** 的单 chunk，每个新 realm
  都要解析一次。
- 顺带发现（**未实施**，留档）：默认并行 worker = 4（`QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS`），
  而本机 ≈9 逻辑核 ⇒ 设置项本身还有约 2× 余量；它属用户设置（队列页「并行 worker 数」），不在本轮
  代码范围（改默认值影响所有队列运行，需单独拍板）。

### 54.2 装置（新增「worker realm 复用对照」段）

`scripts/trigger-optimizer-racing-study.mjs --realm-study=1 --realm-seeds=16 --rounds=8`（只跑本段并提前返回；
`--realm-seeds` 缺省 16）。四臂，**同一夹具 / 同一 payload / 同一批种子**，全部串行以隔离单场成本：

- **F** 每场新 realm（= 当前生产形态）；**E** 每评估一个 realm（= 拟实施形态，按 `--rounds` 分组、组内种子
  串行）；**R** 单 realm 跑满全部种子（固定开销参照）；**F2** F 的复测（机器负载/热漂移自证）。

**预注册判据（开跑前写死在输出里，不由结果反推）**：G1（硬门槛）F 与 E 在同一 (payload, seed) 上的
`simResult` **逐位一致**，任一不等 ⇒ 引擎在复用 realm 下有跨模拟状态 ⇒ 放弃实施；G2 `mean(F) − mean(E)
≥ 5% × mean(F)`；G3 省时投影 ≥ 15%（口径：`(场次 − 评估数) × 每场固定开销 ÷ 并行度`，用 §20.4 的
676 场 / 85 评估 / 并行 4 / 基准 190.4s）。

### 54.3 实测（2026-09-27，4h / tier 0 / jungle_planet / 16 种子）

| 臂                  | 总墙钟 | 均值（首场）     |
| ------------------- | ------ | ---------------- |
| F 每场新 realm      | 11.7s  | 731 ms/场（805） |
| E 每评估一个 realm  | 5.6s   | 351 ms/场（722） |
| R 单 realm 跑满     | 4.6s   | 285 ms/场（672） |
| F2 复测（漂移自证） | 10.5s  | 654 ms/场（706） |

- **G1 通过**：F↔E parity **16/16 逐位一致** ⇒ 复用 realm 不改变结果（引擎给定种子无跨模拟状态）。
- **G2 通过**：差 380 ms（52.0%）；固定开销两个独立估计互相吻合——F−E 放大 **434 ms**、
  R 首场−其余均值 **413 ms**。
- **G3 通过**：投影省 **64.2s ≈ 基准的 33.7%**。
- 判读：三条全过 ⇒ 实施。诚实边界：node worker_threads ≠ 浏览器 Worker，装置只证「机制成立 + 量级」，
  生产收益以应用内 A/B（同设置两次运行）为准（见 §54.6）。

### 54.4 实施（三个生产文件 + 零判据改动）

- `workerClient.js` 新增 `startSimulationBatch(payloads, handlers)`：一个 realm 按序跑完 payloads，
  **上一条结果（或失败）回来才发下一条**。串行投递是硬约束：`worker.js` 的 `onmessage` 是 async，
  并发投递会让同一 realm 里并跑两场，并把 `installSeedScope` 换上的全局 `Math.random` 互相覆盖
  （「一个 realm 同一时刻只跑一场」是播种的安全前提）。单场失败（`simulation_error`）继续下一条；
  realm 级崩溃（`onerror`）走 `onAbort` 上报在飞索引并停止投递。
- `simulatorWorkerRuns.js` 新增 `supportsSimulationBatch(ctor)` 与
  `runSimulationBatchWithDedicatedWorker(payloads, onProgress, options)`：取消语义 / scope / handle 与逐场
  入口**完全一致**（`stopTriggerOptimizerWorkerRuns` 照旧定向取消 → `code:'cancelled'` 拒绝整批）；返回
  `{ simResults, errors }`（与 payloads 等长）；realm 级崩溃 ⇒ 在飞那条记失败 + **换新 realm 续跑**剩下的
  （与「每场新建 realm」形态的失败传播等价）。
- `triggerOptimizerSimulation.js` 的 `evaluatePayload`：`seeds.length > 1 && supportsSimulationBatch(...)`
  走批量，否则**回退逐场路径**（测试桩语义不变；单场评估无可摊薄开销也走原路径）；失败位 →
  `createDegenerateMetrics`（与逐场 `catch` 分支同款）。
- **不动的**：种子集 / 样本顺序 / 聚合 / 打分 / 闸门 / 报告字段与计数（`evaluations` / `simulations` 由
  搜索层记账，未改）。`worker.js` **零改动** —— 它的种子恢复注释早已写明「若将来复用 realm，这一步
  就是安全前提」。

### 54.5 测试与验证

- 定向 6 文件 **89/89**：`workerClient` 5 / `simulatorWorkerRuns` 15 / `triggerOptimizerSimulation` 28 /
  `triggerOptimizerSearch` 26 / `...racing` 4 / `...verifyAppend` 11。
- 新增锚点：串行投递（第二条只在第一条结果后发出）/ 单场失败不打断整批 / realm 崩溃停止投递并上报在飞
  索引 / runner 的逐索引收集 / 崩溃换 realm 续跑（新 realm 只带剩余 payload）/ 定向取消 / 一次评估只建
  一个 realm + 种子与 `#rN` 后缀照旧 / 批量失败退化 / 批量取消；能力探测（生产 WorkerClient ⇒ true、
  无 `startSimulationBatch` 的桩 ⇒ false）。
- 全量 `npm test` **184 文件 / 2596 用例**（较 §53 基线 +9 = 本项新增）全绿（含 `prettier --check .`）；
  `npm run build` ✓（23.45s，仅 >500KB chunk 警告）；`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。

### 54.6 诚实边界与待办

1. **应用内 A/B 已执行（同日，见 §54.7）**：批量开 **76.06s** / 批量关 **167.19s**（同一次搜索：538 场 /
   115 评估），且批量开在**与批量关同一价表**下报告**逐位一致**（除 `elapsedSeconds`/`createdAt` 两个时间
   字段外零差异）——收益与等价性均有应用内实测背书。首跑曾因「两臂之间市场行情刷新」判负（排查与冻结价表
   复测见 §54.7）；日后跨时段对照请先冻结行情。
2. **并行度默认值未动**（见 §54.1 第三条）：把默认 4 提到硬件核数属用户面设置改动，影响队列/顾问等
   所有运行，需单独拍板。
3. **失败隔离度下降**：同一评估共用一个 realm，realm 级崩溃会波及该评估的剩余场次 —— 已用「崩溃换
   realm 续跑」补偿；「长期复用导致资源增长」在本轮规模（每评估 ≤ 12 场）未观察到，但未做长跑压测。
4. **装置覆盖面**：固定开销只测 4h / 单夹具 / baseline payload（机制与时长无关，绝对数字不保证外推）。
5. 装置段自身有两个坑（已修，记档）：`new Worker` 的入口必须是**本脚本**（`!isMainThread` 分支再 import
   引擎），直接传 `engineUrl` 会得到没有消息循环的 realm；入口参数只接受绝对路径或 URL 对象，`file://`
   字符串要先裹 `new URL(...)`。

### 54.7 应用内 A/B 实测（2026-09-27，同夹具 / 同设置 / 同价表）

装置（`worker_threads`）只证机制；本节在真实浏览器里以「同设置两次运行」定案（页面按钮 → store → 真实
worker 全链）。夹具 `modernPlayerJunglePlanetFixture.json`（玩家 1 / 丛林星球 / 难度 0 / 4 小时 / 标准档 /
rounds=8 / 权重 0.5/0.3/0.2）；三臂工作量完全相同（`simulations` 538 / `evaluations` 115 / `rounds` 2）：

| 臂  | 形态                   | `elapsedSeconds` | 报告差异（对 A）    |
| --- | ---------------------- | ---------------- | ------------------- |
| A   | 批量关（改动前形态）   | 167.186          | —                   |
| B   | 批量开（首跑）         | 76.057           | 1238 处（价表家族） |
| B2  | 批量开（冻结价表复测） | 78.0             | **2 处 = 时间类**   |

- **预注册判据**：P1 = 两次报告全量对比，除时间类字段（`elapsedSeconds`/`createdAt`/`savedAt`）外必须逐位
  一致；P2 = 批量开 < 批量关且降幅 ≥15%（10–15% 追加交换顺序复测；<10% 或反向 ⇒ 判负）。
- **P2 通过**：A→B 省 91.13s（**54.5%**）、A→B2 省 89.19s（**53.3%**），远超 15%，与装置投影（−33.7%）
  同向且更大（浏览器 realm 新建比 node 更贵）；顺序上 A 后跑、吃热缓存，偏置对结论不利。
- **P1 首跑判负 ⇒ 排查定位为环境混淆**：B↔A 的 1238 处差异全部是 `dailyProfit`/`dailyNoRngProfit`（1006
  处）及其派生的 score 家族（232 处）；`inputSignature`、复验种子、选中触发器与全部非 profit 样本指标
  **逐位相同**。根因：两臂之间市场行情被刷新（B 用缓存 `marketTimestamp`=05:06；A 用 08:06 快照、08:13
  抓取）——profit = Σ(掉落数×价表价) − Σ(消耗×价表价)，价表属外部输入且不在 `inputSignature` 覆盖内。
- **P1 复测通过（冻结价表）**：以 `browser-devtools route` 挡掉 `marketplace.json`（两域名；失败仅置
  `pricing.error`、不动缓存）后重载，价表保持 A 臂那一版（`lastFetchedAt` 与抽样价指纹逐位相同）再跑 B2：
  B2↔A **仅 2 处差异**（`elapsedSeconds` 167.186↔78、`createdAt`），其余（含 profit/score/全部样本/复验）
  **逐位一致**；同时 B1↔B2 恰好 1238 处（同一价表家族）——两个方向互证。
- 控制台：两跑各自清空后**零新增**（复测里 2 条 `marketplace.json` CORS 报错是拦截装置自身产物，已在开跑
  前清空记账）。
- 诚实边界：① 单机 / 单夹具 / 单档位 / 各一次，属运行级对照而非重复抽样，绝对收益随夹具与机器变化；
  ② 「跨时段 A/B 被行情刷新混淆」对本项目任何对照都成立——日后先冻结行情并记录 `lastFetchedAt`；
  ③ dev server / 浏览器版本等进程外因素无法完全排除。

**复现**:`node scripts/trigger-optimizer-racing-study.mjs --realm-study=1 --realm-seeds=16 --rounds=8 --hours=4 --seeds=32`;
定向 `npx vitest run src/services/__tests__/workerClient.test.js src/services/__tests__/simulatorWorkerRuns.test.js src/services/__tests__/triggerOptimizerSimulation.test.js`;全量 `npm test`。

## §55 并行度默认值自适应(2026-09-27,实测通过 ⇒ 已实施)

> 用户口径(2026-09-27):「按你推荐来吧 要有适配性 我本机配置高不代表其他用户也有这么高的配置」⇒ 并行度
> 默认值从固定 4 改为按机型自适应;**适配性是第一约束**(不能照搬本机核数——8 物理/16 逻辑核的机器若默认
> 16,会让小配置用户的浏览器瞬间开满 worker 而卡死,故设绝对上限 8)。

### 55.1 自适应公式(`resolveAdaptiveParallelWorkerDefault(cores, deviceMemoryGb)`,纯函数)

- 核数未知/非法 ⇒ **回退 4**(历史值)。
- 核数 ≤ 4 ⇒ 取核数(与历史 `min(4, 核数)` 逐位一致,**小机型零变化**)。
- 核数 > 4 ⇒ **核数 − 1**(留 1 核给主线程/界面)。
- 内存护栏(`navigator.deviceMemory`,缺失不启用):≤2GB ⇒ 2、≤4GB ⇒ 4、否则 ⇒ 上限。
- 绝对上限 **`QUEUE_PARALLEL_WORKER_ADAPTIVE_CAP = 8`**(每 realm 一份引擎内存;用户仍可手动调到核数)。
- `getRecommendedParallelWorkerLimit()` = 自适应值再按本机硬上限 `min(64, 核数)` 收口。

### 55.2 语义升降级

- `QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS = 4` **保留但收窄为「回退值」**(核数未知/服务级调用/测试路径)。
- `getDetectedHardwareCoreCount` / `getParallelWorkerHardMaxForCurrentMachine` 从 `simulatorStore.js` 与
  `simulatorPricingActions.js` **上移**到 `queueScoring.js`(消除重复,供服务层与 UI 共用)。
- **默认值应用于「无存储键」的机器**(首次使用/清过设置);**已持久化的存量值不动**(尊重用户设置)。
- 消费链:`loadQueueRuntimeSettingsFromStorage({parallelWorkerLimit})` → state 初始化;
  `resetQueueRuntimeSettings` / `resetQueueSettingsToDefaults` → 自适应默认;
  `normalizeQueueRuntimeSettings(settings, {parallelWorkerLimit})` 新选项。
- 其它消费方(advisorRunExecution / queueRunExecution / simulatorTriggerOptimizerActions /
  simulatorFoodOptimizerActions / simulatorQueueActions / simulatorSimulationActions / multiWorker)
  读 store.queueRuntime 值,**零改动**。

### 55.3 实施文件与测试

- 源 4:1 `queueScoring.js`(cap 常量 + 3 个 normalize/getDefault 签名扩参 + 新段「机型探测与自适应推荐」);
  2 `simulatorStorage.js`(`loadQueueRuntimeSettingsFromStorage(options)` 缺省/缺失路径尊重注入值);
  3 `simulatorStore.js`(import 换源自 queueScoring + 删本地重复 helper + state 初始化用推荐值);
  4 `simulatorPricingActions.js`(同上换源,reset 两个函数用 `getDefaultQueueRuntimeSettings({ parallelWorkerLimit: getRecommendedParallelWorkerLimit() })`)。
- i18n 2:`settingsPage.parallelWorkerHint` 追加「当前核心数:{{cores}},推荐配置:{{recommended}}(按机型自动推荐)」
  (en 对称:`Detected cores: {{cores}}, recommended: {{recommended}} (auto-picked for this machine)`);
  `parallelWorkerHintUnknown` 未动。
- 测试 2 文件 +7 条:`queueScoring.test.js` 4 条(核数矩阵 / 内存护栏 / 机型读取防御式含 navigator 打桩 /
  归一化回退注入语义);`simulatorStore.test.js` 3 条(新增 `withStubbedNavigator` helper;无存储值 ⇒ 8 /
  小机型与无核数 ⇒ 2、4 / 已存值 3 优先)。**坑**:`queueParallelWorkerRecommended` 是动态 getter,断言必须写
  在 navigator 桩作用域内。
- 回归:定向 5 文件 255 用例全绿;全量 **184 文件 / 2603 用例**(基线 2596 + 新增 7)全绿;`npm run build` ✓;
  `npm run check-dead-keys` 143 键 / 0 死键;`prettier --check .` 全库 ✓(本处仅 queueScoring.js 需 --write 一次)。

### 55.4 应用内 A/B(冻结价表;538 场 / 115 评估 / 2 轮;score 五臂逐位一致 = 0.017518967579404302)

| 臂  | 设置            | 顺序               | 窗口     | `elapsedSeconds` | 对比                            |
| --- | --------------- | ------------------ | -------- | ---------------- | ------------------------------- |
| A   | 4(设置页保存)   | 先跑               | 早窗口   | **78.485**       | 基准                            |
| B   | 清键 ⇒ 自适应 8 | 后跑               | 早窗口   | **67.27**        | −14.29%(10–15% 带内 ⇒ 追加复测) |
| A′  | 4               | 复测先跑           | 劣化窗口 | 122.627          | 跨窗口无效(见 55.5)             |
| A′2 | 4               | 复测重跑           | 劣化窗口 | 140.737          | 与 B′ 同窗对照                  |
| B′  | 8               | 复测后跑(吃热缓存) | 劣化窗口 | **117.896**      | **−16.23%** vs A′2              |

- **D1 等价性(硬)通过 × 3**:A↔B、A′↔B、A′2↔B′ 三对报告全量 diff(排除时间类
  `elapsedSeconds`/`createdAt`/`savedAt` 与配置本身 `workerLimit`/`maxConcurrentWorkers`)均**零实质差异**;
  score / simulations 538 / evaluations 115 / rounds 2 逐位一致;控制台每臂清空后零新增。
- **D2 提速**:首跑 14.29% 落在预注册的 10–15% 带 ⇒ 追加交换顺序复测;复测里 B′ 后跑(**热缓存偏置对 8 不利**)
  仍比同窗口 A′2 快 **16.23% ≥ 15%** ⇒ **通过**。早窗口(A↔B 14.29%)与劣化窗口(A′2↔B′ 16.23%)两个
  独立同窗口对照方向一致(8 更快),且两次 8 都在后跑、都赢 ⇒ 方向稳健。
- **D3 内存安全(早窗口采样)**:worker 宿主 PID 39844 的 WS 由 A 臂 502MB → B 臂 650MB;Snow App 进程族合计
  1787 → 1944MB ⇒ +4 工人 ≈ +150MB ≈ **37MB/realm**;cap=8 满配 ≈ +300MB,远无 >2GB 风险。CPUΔ 86.2s →
  126.7s(≈1.47×,远超墙钟 1.17×,提示主线程串行段为次要瓶颈但不影响方向)。

### 55.5 裁决与诚实边界(含一次环境混淆的排查记录)

- **裁决:实施成立。** D1 三对逐位一致;D2 两个独立同窗口对照均 8 更快、复测 16.23% 破 15% 门槛;D3
  ≈37MB/realm 极安全。自适应语义满足适配性第一约束:≤4 核小机型零变化、>4 核留 1 核给界面、≤4GB 内存
  护栏、绝对上限 8、老用户已存值不动。
- **过程如实记录(环境混淆,与 §54 价表混淆同构)**:复测 A′ 首轮 122.627s 反超 B(67.27),按预注册字面应
  判「不足破门槛」;但同为 4 工人的 A′ 远超早窗口 A(78.485),暴露**本标签页会话跨窗口性能劣化**(长时运行
  内存/GC/缓存积累;同日 A′/A′2 = 122.6/140.7 vs 早上 A = 78.5),A′↔B 属「劣化窗口 vs 干净窗口」的
  **跨窗口无效对照**。据此改跑同窗口紧邻对照 A′2↔B′:140.737 → 117.896 = 16.23% 达标。此即「绝对值只可
  同窗口比较」的又一实证,与 §54 「先冻结行情再跑」同一纪律:对照必须同窗口同环境。
- **诚实边界**:1 单机(16 逻辑/8 物理核、31.3GB、deviceMemory=8 ⇒ 推荐 8)/ 单夹具 / 单档位(T0 丛林星球),
  跨机器收益随夹具变化;2 严格「交换顺序」(8 先跑、4 后跑)未跑——因劣化窗口内 8 后跑(偏置不利)仍胜
  16.23%,方向已被同窗口复现确认,补跑边际收益低;3 cap=8 是保守上限(本机 16 逻辑核可手动调更高),是为
  低配机器与并发内存留的安全带;4 首跑 14.29% 严格未过 15%,靠复测 16.23% 达标,两窗口方向一致才下定论。

**复现**:定向 `npx vitest run queueScoring simulatorStore simulatorStorage SettingsPage i18nResources`;
全量 `npm test` + `npm run build` + `npm run check-dead-keys`。

## §56 §54/§55 的 24h 长跑压测(2026-09-27,纯验证 ⇒ 通过,零生产改动)

**动机**:§54(批量 realm)与 §55(并行度自适应 8 工人)都是「一次评估内复用 realm/并发 8」的新形态,
已证 4h 短档成立;但用户真实场景有 **24h 长模拟 + 上千场次**。本轮用装置在同一重度设定下复跑 realm 对照段,
回答「批量 realm 在 24h 重度下是否仍逐位一致、省时是否仍成立、长跑是否稳定」。

**装置**(复用 §54 的 realm-study 段,零新机制):`node scripts/trigger-optimizer-racing-study.mjs
--realm-study=1 --hours=24 --realm-seeds=16 --rounds=8 --tier=0 --zone=/actions/combat/jungle_planet`。
同一夹具 / 同一 payload / 同一批 16 种子;F(每场新 realm)/ E(每评估 8 场一 realm)/ R(单 realm 跑满)/
F2(每场新 realm 复测)。24h 单场 ≈ 2164–2259ms(4h ≈ 300ms 的 ~7×,符合时长线性)。

**预注册判据**(开跑前写死,不以结果反推):G1(硬)24h 下 F↔E 同种子 simResult 逐位一致 ≥16/16;
G2 mean(F) − mean(E) ≥ 5% × mean(F);G3 按生产调用图投影省时 ≥ 15%;稳定性 F↔F2 抖动 < 10%;错误/告警零新增。

**实测**:

| 臂                               | 16 场墙钟 | 均值 ms/场 | 首场 ms |
| -------------------------------- | --------- | ---------- | ------- |
| F 每场新 realm(生产当前形态)     | 35.8s     | 2235       | 2259    |
| E 每评估一个 realm(批量,8 场/组) | 29.4s     | 1838       | 2320    |
| R 单 realm 跑满(参照)            | 28.1s     | 1758       | 2122    |
| F2 每场新 realm(复测)            | 35.6s     | 2224       | 2259    |

- **G1 通过**:**F↔E parity 16/16 逐位一致** —— 24h 重度长模拟下批量 realm 无任何跨模拟状态污染;原有 4h 的
  16/16 结论外推到 24h 成立。
- **G2 通过**:mean(F) 2235 vs mean(E) 1838 ms/场,差 397ms = **17.8%**(比 4h 的 13.5% 更强)。
- **G3 通过**:投影(676 场 / 85 评估 / 并行 4)省 **67.1s ≈ 35.2%**(基准 190.4s),远超 15%。
- **稳定性**:F 2235 vs F2 2224 = 差 **11ms(<0.5%)**,远小于 10% 门槛;固定开销两法互证
  (F−E 放大 454ms / R 首场−其余 389ms)。
- 错误/告警零新增,exit 0。

**裁决:通过**。§54 批量 realm 在 24h 重度下与 4h 结论一致(parity 全过 + 省时 + 极稳),§55 的 8 工人默认在
长跑下无稳定性风险(§55 已证 ≈37MB/realm,24h 跑满 8 worker 增量 ≈300MB,远安全)。

**如实留档**:本轮**未**做「浏览器内应用内 24h 长跑」——装置已覆盖 24h 重度(引擎同构 worker_threads),
§55 已完成应用内五臂(4/8 工人、冻结价表、report 逐位一致);浏览器内再跑 24h 需要数分钟且与装置结论
同构,边际收益低,故以装置为准并诚实标注此边界。

**诚实边界**:1 node worker_threads ≠ 浏览器 Worker(§54 已述),此处验证的是「批量 realm 机制在长模拟下
的安全性与量级」;2 单机/单夹具/单档位(T0 丛林星球),跨机器绝对收益随夹具变化;3 24h 单场耗时已线性外推
(~7×4h),未测 >24h(模拟时长上限)。

---

## §57 组合内单腿精炼量化：生产语义下「组合被采纳」从未发生 ⇒ 触发面为空（2026-09-27）

> 用户口径（2026-09-27）：「按你推荐，进行下一步」—— 第一推荐项 = **组合候选单条阈值精炼**
> （§24.5 / §25.7 / §28.5 / §29.10 反复遗留：组合被采纳后内部阈值不可调）。按项目纪律先做
> **只读量化**（预注册判据、改造研究装置、零产品改动），由实测决定是否实施。

### 57.1 问题与量化口径

- 生产现状：`buildRefinementCandidates` 首行 `triggers.length !== 1 → []` —— 2 条触发器的组合候选
  **被采纳后也不会被精炼**（§25.7 记录 `compositeBuffWindowGroupHp` 曾有 +0.0919「接近被采纳」）。
- 本量化回答：若允许对组合内的**单条数值腿**做与单条件同款的 ±step 邻域行走，**真实分**能不能提升、
  代价多少。判据 = 「有提升才实施」：
  - **C1（硬）**：邻域合成合法性（sanitize 双腿通过、与既有池/精炼扫描/覆盖族/组合缺口族不撞签名）+
    换算对齐自证（脚本步长公式 vs 生产 `buildRefinedCandidates` 单腿输出，逐值容差 ≤1）。
  - **C2（主）**：行走净效应（留出真实分、配对差）**mean > 0 且 t ≥ 3 且负例率 < 5%** ⇒ 值得实施；否则不实施。
- **口径修正（冒烟后、正式跑前，如实记录）**：初版把「全部 2 腿起点」当净效应对象；24 种子 / 1h 冒烟
  显示 ① 全起点口径的「改善」大量来自**起点本身不是 winner** 的假场景（生产根本不会精炼它）、② 真正
  的触发面（起点被采纳）触发极少。据此把**主口径收窄到「起点被采纳」**（= 该槽 winner 且过槽级采纳
  门槛 `shouldAdoptCandidate`，与 `triggerOptimizerSearch` 的采纳链同源），全起点等三类降为参考口径。
  （同 §43 的「判据演化」先例：预注册判据被事实修正时必须声明理由。）

### 57.2 装置（研究装置新增一段，零产品改动）

`scripts/trigger-optimizer-racing-study.mjs` 新增「组合内单腿精炼」段（自动开启、无参数）：

- 覆盖池里全部 2 腿候选：**组合族（composite\*）+ 当前配置锚点（current）**，三槽（`--slots=2,3,4`）。
- 腿规格（只覆盖**有生产现成精炼口径**的腿）：敌方血量类（all_enemies / targeted_enemy）、自身血量类
  （self current_hp / missing_hp）、队友百分比（all_allies lowest_hp_percentage）、计数类
  （active_units / dead_units）——换算/自守与生产 `REFINE_*` 口径逐一对照；**蓝量守卫腿**
  （组合里的 mp 腿）没有单条件精炼口径，不覆盖（如实计入 skipped）。
- 邻域探针 = 替换**一条腿**的数值（另一条腿逐字不变），过生产 `sanitizeTriggerList` +
  `buildTriggerCandidateSignature`；采样偏移集 ±{5,10,15,20,25}pt / ±{1..4}（= 生产步长序列
  10/5/5/5 × 4 级在 5pp 网格上的全部可能探针；生产步长变了有硬断言先失败）。
- 行走回放：决策样本走（`compareCandidates` + `shouldAdoptCandidate(best, base)`）、**留出样本评**
  真实分——判据全走生产实现。
- 对齐自证：**通过 4 类**（enemyGroupHp / executeHp / lowHp / manyEnemies，逐值容差 ≤1）、
  无单腿对照跳过 2 类（missingHp / allyLowHp——输出槽池里没有它们）。

### 57.3 实测（2026-09-27，丛林星球 tier0 / 4h / 32 种子 / 500 试验 / 三槽）

采样 237 配置 × 32 轮 = **7584 场 / 508s**（8 workers）。2 腿候选：槽 2/3 各 5 条（探针 52）、槽 4 4 条
（探针 34）；去重后 42 个探针。

**① 起点可达性（决定机制有没有触发面）**

| 槽               | 2 腿候选成为池 winner | 其中过采纳门槛    |
| ---------------- | --------------------- | ----------------- |
| 2（firestorm）   | **95.6%（478/500）**  | **0.0%（0/500）** |
| 3（flame_blast） | 0.0%                  | 0.0%              |
| 4（fireball）    | 0.0%                  | 0.0%              |

⇒ **主口径样本 = 0**：三个槽、1500 个「槽 × 试验」里，「2 腿候选被采纳」一次都没发生（槽 2 的 winner
主体是按聚合分 ≈0 的当前配置锚点，从未过「增量分 ≥ MIN_ADOPT_SCORE 且过噪声地板」的门槛）。

**② 行走净效应（配对差 = 行走终点真实分 − 起点真实分）**

| 口径                     | 样本        | 结果                                                            |
| ------------------------ | ----------- | --------------------------------------------------------------- |
| **主口径「起点被采纳」** | **0**       | —（无可测样本）                                                 |
| 参考1 全 2 腿起点        | 7000        | +0.00300 ± 0.00032（t = 9.44；胜 2.2% / 平 97.8% / 负 0.0%）    |
| 参考2 组合族 / current   | 6000 / 1000 | +0.00351 ± 0.00037（t = 9.46；胜 2.5%） / −0.00003（t = −1.41） |
| 参考3「起点是 winner」   | 478         | −0.00003 ± 0.00003（t = −1.00；平 99.8% / 负 0.2%）             |

成本：平均评估 **2.12 次 / 起点**（级数上限 4；每级 ≤ 2 腿 × 2 向）｜平均行走级数 0.02｜
终值与起点不同 2.2%。

**③ in-sample 天花板（事后口径，对邻域族最有利）**：确有局部梯度，但都不可达/不够大——
如 `compositeBuffWindowGroupHp` 槽 2 起点 −0.01119 → 邻域最优 +0.00398（Δ +0.01517）、
槽 3 起点 0.01978 → 邻域最优 0.00398（Δ −0.01580）；槽 4 该族起点本身极差（−0.25 ~ −0.38）。

### 57.4 判读与裁决

1. **主口径触发面为空**：生产只在「2 腿候选被采纳」后才可能触发精炼，而本夹具/档位下该事件
   **0 / 1500** ⇒ 「给组合加精炼」在生产语义下**一次评估都不会发生**。
2. **即使忽略触发面也走不动**：参考3（对 winner 型起点强行走）478 样本里 99.8% 平、mean −0.00003
   —— 邻域候选过不了「相对起点 + ≥0.01 且证据过地板」的行走门槛。
3. **全起点口径的正效应是假场景**：参考1/2 的 +0.003 来自「起点本身是负分候选」的样本（生产不会
   精炼它们），不能作为实施依据。
4. 天花板口径里 `compositeBuffWindowGroupHp` 一类的 ±0.015 级梯度不改变结论：起点不可达、行走不触发。

**裁决：不实施**（按预注册 C2；生产代码零改动）。「组合内单条邻域精炼」的遗留项就此关闭：
不是「口径难定」，而是**这条轴没有生产触发面**（至少在本夹具/档位；边界见 57.5）。若未来换区域/阵容
出现「组合候选被采纳」的真实运行，可用本段装置复测。

### 57.5 诚实边界

- 单夹具（法系 120 级 5 技能）/ 单区域（jungle_planet）/ tier0 / 4h / 三个 DAMAGE 槽；不得外推。
- 决策样本 5 轮、未模拟 racing 粗筛两段式（与 §33/§35 的 bootstrap 同一近似）；未模拟深挖路径
  （深挖通过也可采纳，是另一条支路）。
- 对齐自证 2 类无单腿对照跳过（missingHp / allyLowHp）；mp 守卫腿未覆盖（12 条腿计入 skipped）。
- 起点可达性未分解 winner 构成（current vs composite），按聚合分推断主体为 current。
- 「0/1500」的触发面结论只测了「过 `shouldAdoptCandidate` 门槛」这一条采纳路径。

### 57.6 复现与回归

- 复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3,4`
  （冒烟用 `--hours=1 --seeds=24 --rounds=2 --trials=50`；`--seeds` 有 ≥24 的既有下限断言）。
- 本轮改动 = 研究装置 1 文件（新增段 + 用法注释）+ 本文档；**生产代码零改动**；
  回归：`npm test` 全量 + `prettier --check .` + `npm run build` + `npm run check-dead-keys` 全绿。

## §58 跨区域适用性量化：移植几乎不成立，跨区域复核在高噪声/浅失效区域不可靠 ⇒ 不实施（2026-09-27）

> 用户口径（2026-09-27）：「按你推荐继续」—— 推荐清单第 2 项 = **跨区域适用性**（把 §29 的「换相邻
> 难度复核」延伸为「跨区域抽样复核」；§29.10/§31.7 反复遗留）。按项目纪律先做**只读量化**（预注册
> 判据、改造研究装置、零产品改动），由实测决定是否实施。

### 58.1 问题与量化口径

- 现状：触发器是**全局技能配置**（`applyTriggerOptimizerResult` 直接写 `triggerMap`，随后在所有区域
  生效），而搜索只在「一个区域 + 一个难度」上评估；§29 的复核只覆盖**相邻难度**，区域之间没有良定义
  顺序 ⇒ 跨区域复核若做，形态必然是「**用户指定目标区域**」。
- 本量化回答两件事：① **移植率**（源区域被采纳的 winner，换到其它区域还算不算提升）；② **跨区域复核
  的判别力**（把 §29/§49 的复核形态原样搬到目标区域：生产 robustness 盐 + 生产配对统计，能不能可靠
  回答 ① —— 不虚报、不空转）。② 才是「加不加这个入口」的判据：只有复核能给出可靠答案，花 12~24 场
  模拟才值得。
- **预注册判据**（开跑前写死；装置段注释同一份文本）：
  - **D1（硬·装置自证）**：复核样本 = 生产 `TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS` 盐在**目标区域
    设置**上派生（与源搜索种子、其它区域两两不相交，构造段断言）；判定全走生产实现
    （`computePairedStats` / `scoreCandidate` / `shouldAdoptCandidate`）；样本分割 = winner 用源 decide
    样本、真值用两侧**同索引**留出样本、复核只用 recheck 样本前缀（三组互斥）。
  - **D2（主·问题严重性）**：portRate = P(源已采纳 winner 在目标区域留出样本上仍过生产采纳闸门)。
    全目标区域 ≥ 95% ⇒ 移植基本安全 ⇒ **不实施**；任一 < 95% ⇒ 问题存在，进入 D3。
  - **D3（主·复核有效性；仅 D2 触发时裁决；逐目标区域、6 轮臂 = 现状保底口径）**：
    ① 不虚报（硬）：**失效样本**（源已采纳 ∧ 目标真值 ≤ 0）上判成立（`positive`）≤ 5%（n ≥ 20 才判）；
    ② 不空转（硬）：池级 real 桶（目标全体种子真实分 > `MIN_ADOPT_SCORE`）与 null 桶（≤ 0）的判成立率
    之差 ≥ 40pp（real cases ≥ 3 才判）；裁决 = 每个目标区域至少一项可判 ∧ 所有可判项通过 ⇒ 实施。
- **口径修正（冒烟后、正式跑前，如实记录；同 §43/§57 的「判据演化」先例）**：初版 ① 用「目标未过采纳
  闸门」当失效集、② 直接要求 real 桶判成立 ≥ 50%。1h / 24 种子冒烟显示：① 会把 (0, 0.01) 的微提升
  误算成失效（生产语义下它不是「没提升」）；② 在「目标区域池里几乎没有真提升候选」时会因分母为空被
  误判为失败。按 §31/§47/§49 的既有口径（案例方向必须明确）收窄：① 只看真值 ≤ 0 的明确失效，② 改判
  「real − null 的分离度」。

### 58.2 装置（研究装置新增一段，零产品改动）

`scripts/trigger-optimizer-racing-study.mjs` 新增「跨区域适用性」段（`--cross-zones=`，默认四档 =
结构梯度 + 极端对照、自动开启；`--cross-zones=0` 关闭）：

- **目标区域**（源区域固定 `jungle_planet` tier0：group 3200 / min 500 / max 4400 / waveSize 4）：
  `bear_with_it`（group 7000 / min 1200 / max 6800 / waveSize 3）、`aqua_planet`（group 2330 /
  min 350 / max 2800 / waveSize 4 —— **同结构近尺度，正对照**）、`vampire`（单怪 2200 / waveSize 1）、
  `fly`（单怪 50 / waveSize 1 —— 极端对照：源池阈值在该区域永不触发）。
- **两套样本/区域**：① 真值 = 「基线 + 源池全候选」在**源搜索种子**上的样本（`args.seeds` 轮，与
  搜索/留出同构）；② 复核 = 同两角色在**生产 robustness 盐**上的样本（12 轮 =
  `TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS`，评测取 6 / 12 轮前缀 —— 本节为当时实测；该常量
  2026-09-27 起为 16，再跑装置取 6 / 16 轮前缀）。同区域对照（ctrl）= 源区域 +
  同款 robustness 盐 —— 把「复核机制本身的判别力」与「区域变更」分开。
- **逐试验口径**：源 decide 样本（`rounds` 轮）上取 `compareCandidates` top-1 且过 `shouldAdoptCandidate`
  者为「源已采纳 winner」（生产语义：只有被采纳的结论会被搬去其它区域）；真值 = 该 winner 在**两侧
  同索引 holdout** 上的 `scoreCandidate`（配对 meanΔ）+ `shouldAdoptCandidate`（移植率）；复核臂 =
  目标区域 recheck 样本前缀上的 `computePairedStats(...).score.verdict`。池级搬运表另用**全体种子
  聚合**（与逐试验口径独立）。
- **种子两两不相交自证**：源搜索 / 同区域对照 / 四个目标区域的复核种子逐对断言无交集。

### 58.3 实测（2026-09-27，丛林星球 tier0 / 4h / 32 种子 / 500 试验 / 三槽 / 四目标区域）

采样 786 配置 × 32 轮 = **25152 场 / 1165s**（8 workers）；同参数**二次完整跑，D2/D3 全部数字逐值一致**
（移植率 96.4 / 1.3 / 0.0 / 0.0 / 0.0，meanΔ −0.03068 / −0.02351 / −0.01846 / −0.02679，
① 0.0 / 2.0 / 20.7 / 0.0%）⇒ 采样确定性。

**① 池级搬运（全体种子聚合）：源真提升候选 → 目标仍 > 0.01**

源池里真提升（> 0.01）只有**槽 3 的 1 个阈值**（两条同值候选）：`enemyGroupHp {value:800}` 与其组合
孪生 `compositeBuffWindowGroupHp {…mystic_aura, value:800}`，源分同为 **+0.01978**（= §30.8 实测的
flame_blast-800）。逐区域搬运：

| 目标区域（group）     | 该候选的目标分                                    | 池级搬运 | 目标上「最优的源池候选」（换区域就换人）                             |
| --------------------- | ------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| 源区域 jungle（3200） | +0.01978                                          | 2/2      | 自己（enemyGroupHp 800，+0.01978）                                   |
| bear_with_it（7000）  | **−0.01217**                                      | 0/2      | `deadUnitsAtMost {count:0}` +0.06734                                 |
| aqua_planet（2330）   | **−0.00099**                                      | 0/2      | `current {}` 0.00000（**整池无人为正**）                             |
| vampire（2200）       | **+0.00085**                                      | 0/2      | `alwaysFire`（槽 4）+0.01962 ／ `enemyTargetHp {250}` +0.01185       |
| fly（50）             | **0.00000**（32 轮逐轮配对差全 0 ⇒ 与基线同行为） | 0/2      | `enemyGroupHp {800}`（槽 4）+0.05600（= 永不施放 fireball 反而更好） |

**② 逐试验：源已采纳 winner（n=469；按槽 槽3:462 / 槽4:7）的移植率与复核臂**

| 目标区域             | 移植率               | 真值 > 0 | meanΔ（t；−∞）                       | 失效样本 n：判成立 / 判负 / 同区域对照 | 失效真值 mean / 中位 | 成立样本 n：检出（对照） | 桶 6 轮 real(cases) / null | 桶 12 轮 real / null |
| -------------------- | -------------------- | -------- | ------------------------------------ | -------------------------------------- | -------------------- | ------------------------ | -------------------------- | -------------------- |
| 源区域（同区域对照） | **96.4%**（452/469） | 98.5%    | —                                    | 7：0.0% / 0.0% / 0.0%                  | −0.0036 / −0.0036    | 452：32.5%               | 38.5%(2) / 0.0%            | 100% / 0.0%          |
| bear_with_it         | **1.3%**（6/469）    | 10.4%    | −0.03068 ± 0.00062（t=−49.32；−∞ 4） | 420：**0.0%** / 1.2% / 32.6%           | −0.01423 / −0.01403  | 6：50.0%                 | 15.9%(3) / 0.3%            | 33.3% / 0.0%         |
| aqua_planet          | **0.0%**（0/469）    | 16.4%    | −0.02351 ± 0.00113（t=−20.71）       | 392：**2.0%** / 3.6% / 31.9%           | −0.00550 / −0.00127  | 0：—                     | —(0) / 0.1%                | — / 0.0%             |
| vampire              | **0.0%**（0/469）    | 53.7%    | −0.01846 ± 0.00039（t=−47.07）       | 217：**20.7%** / 0.0% / 31.3%          | −0.00579 / −0.00449  | 0：—                     | 2.7%(6) / 0.1%             | 0.0% / 0.0%          |
| fly                  | **0.0%**（0/469）    | 0.0%     | −0.02679 ± 0.00245（t=−10.94）       | 469：**0.0%** / 1.9% / 32.2%           | −0.00779 / 0.00000   | 0：—                     | 100%(12) / 0.0%            | 100% / 0.0%          |

注：失效样本的「真值 mean / 中位」说明失效的**深度**；「同区域对照」= 同一批样本上「源区域 + 新盐」
复核的判成立率（源效应是真的 ⇒ 该列稳定在 31~33%）；「成立样本」= 目标真值过生产闸门（分母很薄时
如实显示）；−∞ = 空蓝否决（候选在目标区域跑空蓝而基线不空蓝，`computeObjectiveScore` 的确定性否决）。

**③ 判据结果**

- **D2**：目标区域移植率 0.0%~1.3%，远低于 95% ⇒ **问题存在**（而源区域自证 96.4% ⇒ 不是装置坏掉，
  是「换区域后确实不再成立」）。
- **D3（逐区域）**：
  - `bear_with_it`：① 通过（0.0%，n=420）｜② **失败**（15.9% − 0.3% = 15.6pp < 40pp，real cases=3）
  - `aqua_planet`：① 通过（2.0%，n=392）｜② **样本不足**（real cases=0 —— 整池在 aqua 无人为正）
  - `vampire`：① **失败**（**20.7% > 5%**，n=217）｜② **失败**（2.7% − 0.1% = 2.6pp）
  - `fly`：① 通过（0.0%，n=469）｜② 通过（100.0% − 0.0% = 100pp，real cases=12）
- **裁决：不实施**（按预注册 D3；生产代码零改动）。

### 58.4 判读与裁决

1. **移植损失是真实的、且量级大**：源区域被采纳的配置换到目标区域后，过采纳闸门的比例从 **96.4%**
   掉到 **0.0%~1.3%**。同一条 `enemyGroupHp 800`（源 +0.01978）在 bear / aqua / vampire / fly 分别是
   **−0.0122 / −0.0010 / +0.0009 / 0.0000** —— 该阈值绑定的正是**源区域的怪物血量尺度**（group 3200：
   800 = 整波 25%；bear 7000 → 11%；vampire 2200 → 36%；fly 50 → 永不触发）。这不是「噪声没测出来」：
   meanΔ 的 t 为 −10.9 ~ −49.3、失效样本真值中位 −0.0140 ~ 0.0000（bear 最深；fly 是「惰性 0 + 少数
   强负」的双峰：中位 0.00000、均值 −0.00779）。
2. **换区域「最优配置就换人」**：同一份源池在四个目标区域的排序完全重排（bear 头名
   `deadUnitsAtMost {count:0}` +0.067、fly 头名「永不施放 fireball」+0.056、aqua 整池无人为正）。
   即「在 A 搜出的最优」在 B 上既不是最优、往往也不是提升。
3. **跨区域复核本身：多数区域安全，但关键区域判别力不足**：
   - 「不虚报」在 bear / aqua / fly 成立（0.0% / 2.0% / 0.0%），**vampire 失败（20.7%）**：失效样本的
     真值是**浅负**（中位 −0.0045，不是贴零噪声；对照 bear 同类样本中位 −0.0140），6 轮复核仍会给出
     「提升成立」的假安心，5% 硬闸被击穿 4 倍。
   - 「不空转」在 **bear（15.9% − 0.3%）与 aqua（real cases=0）失败**：高噪声区域（§19.5：bear 噪声
     0.0382 ≈ 丛林的 4.6 倍）里 6 轮复核确认「当地真提升」的功率不足；12 轮能把 bear 抬到 33.3%，
     仍低于 40pp 的分离度闸门。
   - 唯一两项全过的 `fly`：复核**正确地**对 469/469 的移植样本说「不成立」（判成立 0.0%、真值 > 0
     也是 0.0%），但那是因为移植在那里必然失败 —— 对每个配置都说同一句话，信息量等价于一句静态提示
     （机构本身在 fly 是有效的：池级 real 桶 12 案例 100% 判成立）。
4. **结论**：问题（跨区域移植不成立）是真的，但**跨区域复核不是这个问题的可靠答案**（4 个目标区域里
   有 3 个在 D3 上失败或没证据）。花 12~24 场模拟买一个「在关键区域会虚报、在噪声区域只会说未确认」
   的入口，不如把「结论适用范围」的提示写清楚（零成本静态口径）。⇒ **不实施**，方向关闭（替代方向
   见 58.5 的遗留项）。

### 58.5 诚实边界

- 单夹具（法系 120 级 5 技能）/ 源区域 `jungle_planet` tier0 / 4h / 三个 DAMAGE 槽 / 四个目标区域
  **同为 tier0**；换区域未叠加换难度，不得外推。
- **样本代表性**：469 个「源已采纳 winner」样本来自 **2 条同值候选**（槽 3 的 enemyGroupHp 800 与其
  组合孪生）+ 槽 4 的 7 个样本，是同 2 条候选在 500 次试验的 decide/holdout 子集切分下的重复测量，
  不是 469 个独立配置（同 §57「真提升桶只有 2 个候选」的限制）；池级搬运表的分母同样只有 2。
- **决策样本 5 轮**、未模拟 racing 粗筛两段式（与 §33/§35 同一近似）；未模拟深挖路径。
- D3 ① 只在 **6 轮臂**上评判（现状保底口径；12 轮臂只测了桶口径）。补 12 轮列不会改变裁决：
  bear/aqua 的 ② 另有硬失败；vampire 的桶口径在 12 轮上也是 0.0%。
- vampire ① 的**机理未进一步分解**：已知失效真值是浅负（中位 −0.0045）、判负 0.0%、同区域对照
  31.3%，但「6 轮复核在低噪声 + 浅失效区域把浅负判成成立」的逐轮差分布形态未测。
- 目标区域只挑 4 个、且都是「普通区域 + tier0」：地下城 / 迷宫 / 高难度未覆盖；夹具基线本身是丛林
  flavour（「换区域」的用户场景正是如此，但对「基线为其它区域定制」的情况不适用）。
- 遗留的替代方向（本次**未做**，留给后续菜单）：报告「结论适用范围」块加一句**静态**提示（阈值绑定
  源区域怪物血量尺度、换区域前建议重跑）—— 它零成本、且正好覆盖本项实测到的失效模式；若未来要做
  跨区域复核，必须先解决 ① 的虚报与 ② 的功率（或限定在低噪声区域）。（并列：同一块「结论适用范围」提示
  在 §59 已随队伍载荷列成实施项——「模拟载荷 = 单人 / 队伍」标注 + 队友指纹；本项的「单人口径 + 换区域前
  建议重跑」可与它一并落地，见 §59.5 第 5 条 3 / 4。）

### 58.6 复现与回归

- 复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3,4`
  （默认自带 `--cross-zones=bear_with_it,aqua_planet,vampire,fly`；`--cross-zones=0` 关闭本段）；
  冒烟 `--hours=1 --seeds=24 --rounds=2 --trials=50`（≈180s）；输出搜 `跨区域适用性`。
- 本轮改动 = 研究装置 1 文件（新增段 + 用法注释 + 三轮口径细化）+ 本文档；**生产代码零改动**；
  回归：`npm test` **184 文件 / 2603 用例**全绿（含 `prettier --check .` ✓）｜`npm run build` ✓（24.2s，
  仅 chunk > 500KB 既有警告）｜`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。

## §59 队伍载荷评估：单人最优在组队环境里还成不成立（口径 A 量化，2026-09-27）

> 用户口径（2026-09-27，用户拍板）：优化器永远在**单人载荷**上搜索，而用户实际是**组队刷怪**（「我组队打
> 熊熊」）；用户选择 **口径 A = 模拟整队、只改主角触发器、指标仍按主角结算**（队友配置冻结、不当优化
> 对象）。按项目纪律先做**只读量化**（预注册判据、改造研究装置、零产品改动），由实测决定「要不要把队伍
> 纳入优化器评估」。

### 59.1 现状事实（已核实）与待答问题

- **生产永远是单人载荷**：`triggerOptimizerSimulation.js` 的 `buildCandidatePayload` 把**主角一份配置**交给
  `buildPlayersForSimulation([config])`；store 的 `runOptimizer` 只传 `playerConfig: deepClone(activePlayer)`
  （`simulatorTriggerOptimizerActions.js`）。
- **引擎里 `friendlies = this.players`**（`combatsimulator/combatSimulator.js`）⇒ 单人模拟下「队友条件」=
  **自己**：`all_allies + lowest_hp_percentage` 取的是主角自己的血量下限。三条队友文案（`allyLowHp` /
  `compositeAuraRefreshAllyLowHp` / `compositeAllyLowHpGuard`，`locales/zh/common.json`）在优化器里因此
  **名不副实**。
- 队友的光环 / 增益 / 被动在优化器模拟里**完全缺席**；而引擎支持整队（首页组队模拟、`partyAuraPreview`
  用例、`buildPlayersForSimulation([A, B])` 现成），只是这条链路没用。`requireSingle` 是**目标维度**
  （单区域 vs 批量区域），与队伍无关。
- 指标口径：`collectMetrics` / `computeQueueMetrics` 按 `preferredPlayerId` 归集 ⇒ dps / 经验 / 利润是
  **主角自身**；`killsPerHour = simResult.encounters`（引擎遭遇级 = 首页组队模拟同口径）——「遭遇更快打完」
  是队友影响的合法入口。
- **待答问题**：单人环境选出的最优触发器，放到整队环境里还成不成立？三种后果需要区分：**(a) 结论失效**
  （真值掉出采纳闸门）；**(b) 结论被取代**（队伍下换别的配置才是最优）；**(c) 只是排序变化而落差很小**
  （换人但不亏分）。只有 (a) / (b) 有量级才值得把队伍纳入评估（否则实施只剩「报告标注 + 输入指纹」那一半）。

### 59.2 量化口径与预注册判据（开跑前写死；装置段注释同一份文本）

- **对象**：单人 **decide 样本**上被生产采纳的 winner（`compareCandidates` top-1 ∧ `shouldAdoptCandidate`）；
  真值 = 该 winner 在**队伍样本**同索引留出集上的 `scoreCandidate`；对照 = 同一批索引在**单人样本**上的
  真值（CRN 配对：队伍与单人**共用同一组种子** ⇒ 逐索引可比，差异只来自队友）。
- **D1（硬·装置自证）**：① 队伍载荷下主角资源与单人**逐字段一致**（`enemyHp` / `maxHp` / `maxMp`，构造段
  打印对照）；② 队伍样本完整（每 key = `args.seeds` 轮）；③ winner / 真值 / 判定全走生产实现
  （`compareCandidates` / `scoreCandidate` / `computePairedStats` / `shouldAdoptCandidate`），脚本不另抄阈值。
- **D2（主·结论会不会变）**：① 移植率 = P(队伍留出真值仍过生产采纳闸门) **< 95%**；② |meanΔ|（队伍真值 −
  单人真值，同索引配对）的 **t ≥ 3**；③ 换人率 = P(队伍环境 winner ≠ 单人 winner) **≥ 20%**。
  **任一成立 ⇒ 需要把队伍纳入评估（口径 A 有实质依据）；三条都不成立 ⇒ 队伍感知不改变结论。**
- **参考列**：队伍最优对单人 winner 的 regret（队伍真值口径）、候选位移榜（队伍环境把哪些候选族变好 /
  变坏）、成本（队伍采样场/s 与单人对齐口径）。
- **统计口径（冒烟后、正式跑前固定，如实记录；同 §43/§57/§58 先例）**：meanΔ / regret 只在**有限样本**上
  取均值，−∞（空蓝否决）**单独计数**：含 −∞ 时均值恒为 −∞ / NaN、无判别意义，而 −∞ 个案已由判据 ① 以
  「未过闸门」计入，故不损失信息。

### 59.3 装置（研究装置新增一段 + 引擎再导出，零产品改动）

- `scripts/trigger-optimizer-racing-study.engine.mjs` 新增 `buildPartyCandidatePayload(playerConfig,
teammateConfigs, simulationSettings, extra, candidate)`：与生产 `buildCandidatePayload` **逐行同构**，唯一差别
  是 players = 主角 + 冻结队友（队友经 `applyCandidateToPlayerConfig(teammate, null)`，不动其 `triggerMap`）；
  文件内注释明确「**生产暂无此路径**，一旦生产支持队友需合并，否则实测不代表生产」。
- `scripts/trigger-optimizer-racing-study.mjs` 新增 `--party=parity`（默认关闭；`--party=0` 关闭）：队友 = 仓内
  官方向导存档 `junglePlanetOfficialParityUser.json`（法系 120 级 5 技能；仓内无任何代码引用它，经
  `importSoloConfig` 的 v2 分支导入成 player2 并**冻结配置**）；队伍样本 = 「队伍基线 + 每槽候选」=
  `3 × 20 + 1 = 61` 配置 × `args.seeds`（与单人采样**同一组 seeds** ⇒ CRN 配对）；判读段用独立随机流
  （`createSeededRandom(20260931)`）重抽 decide/holdout 切分，与脚本其它段的随机流互不干扰。
- 构造段打印**资源对照**（单人 vs 队伍：主角 `maxHp` / `maxMp` 相同、`enemyHp` 一致 ⇒ D1 ① 自证）、队友技能
  数与「队伍载荷采样：N 场 / s」成本行。

### 59.4 实测（2026-09-27，丛林星球 tier0 / 4h / 32 种子 / 500 试验 / 三槽 / 队友 = 官方向导存档）

采样：单人池 **25152 场 / 1396.0s（18.0 场/s）**；队伍池 **1952 场 / 353.7s（5.5 场/s）** ⇒ 整队每场约
**3.3×** 于单人（同机同 worker 数；冒烟 1h 口径为 2.8×）。同参数冒烟（1h / 24 种子 / 50 试验）**两次逐值
一致**（移植率 11.1%（3/27）｜meanΔ −0.00232（t = −0.62）｜换人率 100%（27/27））⇒ 采样确定性。

**① 单人 winner 在队伍环境（样本 n=463）**

| 指标                                       | 值                                         | 读法                                |
| ------------------------------------------ | ------------------------------------------ | ----------------------------------- |
| 移植率（队伍留出真值仍过采纳闸门）         | **4.3%**（20/463）                         | 单人最优换到整队后 95.7% 不过闸门   |
| meanΔ（队伍真值 − 单人真值，同索引配对）   | **−0.01110 ± 0.00014**（t = −77.50；−∞ 0） | 确定地掉分，不是噪声                |
| 换人率（队伍 winner ≠ 单人 winner）        | **84.9%**（393/463）                       | 队伍环境下 85% 的试验会选到别的配置 |
| regret（队伍最优 − 单人 winner，队伍真值） | 0.00325 ± 0.00012（t = 26.98）             | 「不重搜」丢掉的分数确定但小量      |

**② 候选位移榜（全体种子聚合：单人分 → 队伍分；|Δ| 最大的 8 条 —— 全部落在槽 4 `/fireball`）**

| 槽 4 候选                                           | 单人分   | 队伍分   | Δ            |
| --------------------------------------------------- | -------- | -------- | ------------ |
| `compositeLowHpGuard {percent:50, mpPercent:30}`    | −0.39081 | −0.08740 | **+0.30341** |
| `lowHp {percent:50}`                                | −0.39081 | −0.08740 | +0.30341     |
| `lowHp {percent:75}`                                | −0.39039 | −0.08740 | +0.30299     |
| `manyEnemies {count:3}`                             | −0.36439 | −0.06198 | +0.30241     |
| `compositeExecuteGuard {percent:30, mpPercent:30}`  | −0.37555 | −0.08409 | +0.29146     |
| `executeHp {value:150}`                             | −0.37555 | −0.08409 | +0.29146     |
| `compositeManyEnemiesGuard {count:2, mpPercent:30}` | −0.30448 | −0.03553 | +0.26895     |
| `manyEnemies {count:2}`                             | −0.30448 | −0.03553 | +0.26895     |

**③ 判据结果**

- **D1（装置自证）**：① 构造段资源对照 = `enemyHp 一致`、主角 `maxHp / maxMp` 与单人相同；② 队伍样本
  61 × 32 完整；③ winner / 真值 / 判定全走生产实现（脚本不另抄阈值）⇒ **通过**。
- **D2**：① 移植率 **4.3% < 95% 成立**｜② |t| = **77.50 ≥ 3 成立**｜③ 换人率 **84.9% ≥ 20% 成立**
  ⇒ **需要把队伍纳入评估（口径 A 有实质依据）**。
- 裁决：**量化达标 ⇒ 进入生产实施**（实施项见 59.5 第 5 条；装置侧「生产无此路径」的限制随实施一起合并）。

### 59.5 判读与裁决

1. **结论确实会变，且不是噪声**：单人环境被采纳的 winner，换到整队环境后只有 **4.3%** 还能过生产采纳
   闸门（同装置同夹具下，「同区域换盐复核」的移植率是 **96.4%**，§58 —— 差异只来自「队友在场」）。
   meanΔ −0.0111（t = −77.5）与换人率 84.9%（393/463）两条独立证据同向。
2. **代价分两层**：① **报告失真**：单人分数在整队里系统性高估约 **0.011**（≈ 已被采纳的
   `enemyGroupHp 800` 提升 +0.0198 的一半量级 ⇒ 足以改变「采纳 / 不采纳」的判断）；② **搜错方向**：
   84.9% 的试验里队伍环境的 top-1 是别的配置，不重搜平均丢 **0.0033** 分（t = 27，确定但小量）——所以
   问题首先是「口径与报告失真」，其次是「选择偏差」。
3. **位移榜说明「为什么会变」**：变动最大的 8 条全在**第三伤害槽（槽 4 fireball）**，方向一致——低血 /
   多敌 / 斩杀 / 换条件这类「保守族」在单人里是强负分（−0.30 ~ −0.39：少打了伤害），队伍下被抬到
   −0.03 ~ −0.09：**队友分担输出与承伤后，「少放 / 换条件」的代价变小**。即队伍载荷主要改写第三伤害槽
   的条件族排序（与 §57「组合候选被采纳面为零」不冲突：那里讲组合族，这里讲单腿条件族）。
4. **成本**：整队每场约 **3.3×**（5.5 vs 18.0 场/s）。按 §49 / §55 的轮数机制，队伍载荷会让一次扫描的
   墙钟时间同比例放大 ⇒ 实施必须带护栏（默认关闭、显式开启、界面提示放大倍数）。
5. **裁决：方向达标 ⇒ 进入生产实施**（预注册三条全中）。实施项（按依赖顺序）：

   1. **store / UI**：用户选择参与模拟的队友（从已保存玩家配置里选；**默认空 = 现状单人，零行为变化**）；
   2. **模拟载荷**：生产 `buildCandidatePayload` 支持队友（players = 主角 + 冻结队友），与装置
      `buildPartyCandidatePayload` 合并、删掉「生产无此路径」注释；
   3. **指标与报告**：指标仍按主角归集（口径 A）；报告「结论适用范围」明确标注「模拟载荷 = 单人 /
      队伍（含队友列表）」——与 §58.5 的静态提示遗留项合并落地；
   4. **输入指纹**：`COMBAT_PLAYER_KEYS` 扩展到队友（§1328-1330）⇒ 换队友 / 队友配置变化时报告失效；
   5. **成本护栏**：默认关闭 + 文案提示整队约 3~4×；轮数 / 池按 §49 / §55 既有机制不动；
   6. **测试与 i18n**：payload 构建、指纹、指标归集、报告标注、队友选择器文案。

   明确**不在口径 A 内**：队友也参与优化（口径 B）、多队友组合搜索、队友 AI 策略调整、队伍总收益口径。

### 59.6 诚实边界

- **单队友 / 单区域 / 单难度**：队友只有 1 个（官方向导存档，法系 120 级 5 技能，配置冻结）、区域只有
  `jungle_planet` tier0、三槽（2 / 3 / 4 三个 DAMAGE 槽）；换区域 / 换难度 / 多队友未扫，不得外推。
- **样本代表性**：463 个「单人已采纳 winner」样本来自**少数候选的重复测量**（同池同种子下 §58 打印的
  分布 = 槽 3 的 2 条同值候选 462 + 槽 4 个位数；本段切分随机流不同，分布可略偏）——不是 463 个独立
  配置；位移榜分母是各槽全候选（20 × 3），不受此限。
- **装置近似**：队伍样本经 `buildPartyCandidatePayload`（**当时**生产没有这条路径；2026-09-27 已按 59.8 落地
  生产版 `buildCandidatePayload(..., { teammates })`，两处逐行同构）；队友 AI 行为 = 引擎既有实现
  （与首页组队模拟同源），本次未另行校验。
- **队友选择未扫**：只有「带 / 不带这个法系队友」两态；队友强弱、职业、数量对结论的影响未测。
- **指标口径**：仍按主角自身归集（口径 A 已定）；若未来改按队伍总收益归集，本段结论不直接适用。
- **成本**：3.3× 是同机同 worker 数的实测（两份都含 worker 启动固定开销），换机器会有差异。
- **未模拟**：深挖路径在队伍载荷下的行为（与 §33 / §35 同一近似）；racing 两段式 / 复核链已补测
  （§60 / §63，2026-09-27）。

### 59.7 复现与回归

- 复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3,4 --party=parity`
  （本次 ≈28 min = 单人池 1396s + 队伍池 354s + 判读；`--party=0` 关闭本段）；冒烟
  `--hours=1 --seeds=24 --rounds=2 --trials=50 --party=parity`（≈280s，两次逐值一致）；输出搜 `队伍载荷评估`。
  注意两点：`--party=parity` 必须带 `=`（单 token 形式会被忽略）；`--seeds` 有既有硬断言 ≥ 24。
- 本轮改动 = 研究装置 2 文件（引擎再导出 `buildPartyCandidatePayload`；脚本参数 / 构造 / 采样 / 判读四段）+
  本文档；**生产代码零改动**。
- 回归：`npm test` **184 文件 / 2603 用例**全绿（含 `prettier --check .` ✓）｜`npm run build` ✓（23.4s，仅
  chunk > 500KB 既有警告）｜`npm run check-dead-keys` ✓（en/zh 各 143 键、0 死键）。
- 下一步：按 59.5 第 5 条的实施项进入生产改造 —— **已于同日完成并回归**，实施记录见 59.8。

### 59.8 生产实施记录（2026-09-27，判据达标后落地）

口径 A：模拟整队、只改主角触发器、指标按主角归集；**默认 = 现状单人**（`partyPlayerIds` 为空数组）。

- **设置 / 指纹**（`triggerOptimizerDomain.js`）：`settings.partyPlayerIds`（主角之外的玩家 id；去重 +
  保序 + 上限 4 = 引擎 `player1..player5` 的位数），归一化 / 校验 / 落盘与锁定集合同款；
  `createOptimizerInput` 新增**恒发**的 `teammates: [{ playerId, player }]`（与主角同一份
  `COMBAT_PLAYER_KEYS`，含队友自己的 `triggerMap`，同样排除 assetScore 这类派生字段）；报告的
  `evaluationScope.party = [{ id, name }]` 记录运行时刻的载荷。
- **模拟载荷**（`triggerOptimizerSimulation.js`）：`buildCandidatePayload(..., { teammates })` —— 队友经
  `applyCandidateToPlayerConfig(mate, null)` **冻结**进模拟，候选只改主角；空数组 = 单人载荷（行为逐值
  不变）。装置侧的 `buildPartyCandidatePayload` 从此是生产的等价物（注释已同步）。
- **四条链路**（`triggerOptimizerSearch.js`）：`optimizeTriggers` / `verifyTriggerOptimizerRobustness` /
  `appendTriggerOptimizerVerification` / `appendTriggerOptimizerRobustness` 共用
  `resolveSearchTeammates(input)` ⇒ **复核 / 追加复验与搜索期同载荷**（否则复核结论会在另一个载荷上得出）。
- **store**（`simulatorTriggerOptimizerActions.js`）：`resolveTriggerOptimizerTeammates`（deepClone 冻结
  副本；主角自身与未知 id 跳过）；`snapshotTriggerOptimizerInput` 带队友；搜索 / 复核 / 追加复验三处入参
  都带 `teammates`；新 action `setTriggerOptimizerPartyPlayers`（进指纹 ⇒ 换队友即过期）。
- **UI / i18n**（`TriggerOptimizerPage.vue` + `locales/{zh,en}/common.json`）：搜索设置卡片新增
  「模拟载荷（队友）」勾选行（默认全不勾 = 单人；提示整队约慢 3~4 倍、队友配置冻结、指标按主角结算）；
  结论适用范围块新增「模拟载荷：单人 / 队伍 A / B」标注（名字优先按当前玩家表解析，玩家被删时回落报告
  里的快照名）—— §58.5 的静态提示遗留项一并落地。
- **测试**：域层（队友进指纹 / 派生字段不进 / 归一化上限与非法值）、载荷（队友冻结、候选只改主角）、
  store（解析 + 运行入参 + 换队友即过期）、页面（勾选写设置 + 载荷标注的单人 / 现名 / 快照名回落）。
- **指纹语义自证**：`§1328-1330` 的「输入指纹不含队友」缺口就此关闭 —— 换队友、改队友装备 / 技能 /
  触发器都会让既有报告过期（stale 拦住 apply，与「改锁定集合」同源）。
- **回归**（2026-09-27）：`npm test` **184 文件 / 2609 用例**全绿（含 `prettier --check .` ✓；较上轮 +6 用例 =
  本次新增的域层 2 / 载荷 1 / store 1 / 页面 2）｜`npm run build` ✓（23.4s，仅 chunk > 500KB 既有警告）｜
  `npm run check-dead-keys` ✓（en/zh 键集对称、0 死键 —— 新增的 5 个队伍键两侧同名）。
- **仍不在口径 A 内**：队友也参与优化（口径 B）、多队友联合搜索、队伍总收益口径、队友 AI 策略调整。

---

## 60 队伍载荷统计口径对照（C1，2026-09-27）

问题：§59 证明了「队伍载荷会改变结论与成本」，但**生产判据链本身**（racing 粗筛 → 精测 → 噪声地板 /
显著性闸门）是在单人载荷样本上标定的 —— 在队伍样本上，这套判据还按同样的统计规律工作吗？本段是
§59.6「未模拟：racing 两段式粗筛 / 复核机制在队伍载荷下的行为」的正面回答的一部分。

### 60.1 口径与装置（生产零改动）

- 装置：`scripts/trigger-optimizer-racing-study.mjs` 新增 `--party-stats=1`（须与 `--party=parity` 同用），
  复用同一跑的两套样本（单人 `samplesByKey` / 队伍 `partySamples`）：**同一批候选、同一组种子
  （CRN 逐轮配对）、同一组 bootstrap 切分**（同一次 shuffle 序列），分别回放生产 racing 链
  （`scoreCandidate` / `computePairedStats` / `shouldAdoptCandidate` / `compareCandidates` /
  `pickRacingSurvivors`），脚本不另抄阈值。
- 三张量：**假采纳率**（无提升槽：采纳 ∧ 选中者留出真值 ≤ 0）、**真检出率**（有提升槽：采纳率）、
  **噪声尺度 σ**（逐轮配对差「候选 − 基线」的样本标准差，跨候选取中位数；**等效轮数比 =
  (σ_队伍 / σ_单人)²**，达到同样显著性的所需轮数 ∝ σ²）。
- 槽位分类（每套载荷各自分类）：该槽全体种子聚合真实分的最大值 > `TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE`
  （0.01）⇒ 有提升槽；−∞（空蓝否决）候选不进 σ、单独计数。

**预注册判据（开跑前写死；冒烟后修正主口径为「共同分类」槽，理由见下）**

| 判据 | 内容                                       | 门槛                             |
| ---- | ------------------------------------------ | -------------------------------- |
| C1-a | 假采纳率（共同「无提升」槽）：队伍 vs 单人 | 队伍 ≤ 单人 + 2pp                |
| C1-b | 真检出率（共同「有提升」槽）：队伍 vs 单人 | 队伍 ≥ 单人 − 10pp               |
| C1-c | 等效轮数比（σ_队伍 / σ_单人）²             | ≤ 1.5（⇒ 可沿用同一轮数 / 门槛） |

- **修正记录（冒烟后、正式跑前固定）**：两套载荷的槽位分类可能不一致（冒烟实测：槽 2 单人「无提升」/
  队伍「有提升」），「各自分类」口径的 pooled 比较会混入**构成效应**（多出的槽改变分母），与判据链的
  检出能力无关 ⇒ 主口径改为**两套载荷分类一致的槽（共同分类）**，各自分类口径降为参考列（逐槽明细
  一并打印）。

### 60.2 实测（正式跑 A：4h / 32 种子 / 5 轮 / 500 试验 / slots 2,3,4 / jungle_planet tier0）

槽位分类与逐槽回放（生产 racing 链，两套载荷共用种子与切分）：

| 槽            | 单人                                            | 队伍                                      |
| ------------- | ----------------------------------------------- | ----------------------------------------- |
| 2 firestorm   | 0.00000 无提升：采纳 0.0%（0/500）              | 0.01680 有提升：采纳 **89.6%**（448/500） |
| 3 flame_blast | 0.01978 有提升：采纳 **93.2%**（466/500）       | 0.01357 有提升：采纳 **64.6%**（323/500） |
| 4 fireball    | 0.00000 无提升：采纳 1.2%（6/500，假采纳 1.2%） | 0.00000 无提升：采纳 0.0%（0/500）        |

| 判据                        | 单人                   | 队伍                                                      | 判定                                                                           |
| --------------------------- | ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| C1-a（共同无提升槽 = 槽 4） | 1.2%（6/500）          | 0.0%（0/500）                                             | **通过**（参考：各自分类 0.6%（6/1000）vs 0.0%（0/500））                      |
| C1-b（共同有提升槽 = 槽 3） | 93.2%（466/500）       | 64.6%（323/500）                                          | **不通过（−28.6pp）**（参考：各自分类 93.2% vs 77.1%（771/1000），同样不通过） |
| C1-c                        | σ = 0.01570（60 候选） | σ = 0.01206（60 候选）；σ 比 0.768 ⇒ 等效轮数比 **0.590** | **通过**（≤ 1.5）                                                              |

- 参考列：载荷效应（同候选逐轮增量分 队伍 − 单人，CRN 配对）mean **+0.11172 ± 0.01359**（t = 8.22，
  60 候选）；winner 报告分均值 0.00727 vs 0.01030、留出真值均值 0.00601 vs 0.00911；成本
  16.4 vs 5.6 场/s（同装置同 workers 的两趟采样口径；§59 专项同池口径是 3.3×）。
- 冒烟（1h / 24 种子 / 2 轮 / 50 试验，两次逐值一致）同向：C1-b 52% → 24%（共同槽），C1-c 0.692。

### 60.3 裁决

- C1-a 通过、C1-c 通过、**C1-b 不通过（−28.6pp ≫ 10pp 容差）** ⇒ 按预注册口径**不能只留「载荷标注」**，
  需要列「队伍需单独轮数 / 门槛」实施项（60.5）。
- 判读（三条证据合流）：
  1. **不是噪声变大**：队伍 σ 反而更低（0.768×；等效轮数 0.590 ⇒ 同样显著性所需轮数更少）；
  2. **不是构成效应**：共同槽（槽 3）上同样是 93.2% → 64.6%，判据链在同一槽、同一批样本上「判不出」
     的比例大幅上升；
  3. **与 §59 的「真提升结构被改写」一致**：队伍载荷下同一槽的 top 候选真提升缩小（槽 3：0.01978 →
     0.01357），而 **MIN_ADOPT = 0.01 是绝对门槛** ⇒ 固定门槛下「真提升相对门槛的余量」从 ~~0.010 缩到
     ~~0.004，判据样本的估计误差（5 轮、SE ≈ σ/√5）足以把相当比例的 winner 推回门槛之下 —— 检出率
     随之从 93.2% 掉到 64.6%。同时 §59 的位移榜显示条件族被整体抬高（槽 4 的 −0.30~~−0.39 → −0.03~~−0.09），
     即「同一个绝对门槛」在两种载荷下对应着**不同的有效严格度**。
- 诚实说明：本轮装置**不能分离**「门槛余量缩小」与「队伍下 winner 换族（§59 换人率 84.9%）导致落到弱
  候选上的比例变化」这两种机制（需要逐试验的 winner 明细，未采集）—— 二者的共同结论相同：固定轮数 +
  固定门槛在队伍载荷下不再等效。

### 60.4 诚实边界

- **单队友 / 单区域 / tier0 / 三槽**：C1-b 的判定实际只落在**一个共同「有提升」槽**（槽 3，n=500 试验）
  与一个共同「无提升」槽（槽 4）上；不得外推到其它槽 / 区域 / 队友构成 / 多队友。
- **复核 / 复验机制在队伍载荷下的行为**：2026-09-27 已补测（§63）——复核**不虚报成立**、但功率不足
  （A2 不成立 ⇒ 列「队伍单独轮数」实施项）；复验臂共同 real 交集为空 ⇒「复验否决」仍缺证据。
- **装置近似**：node worker_threads、单机（16 逻辑核）；指标口径 = 主角自身（§59 口径 A）。
- **成本口径**：16.4 vs 5.6 场/s 是两趟采样的混合口径（单人含 §58 等段）；同池专项口径以 §59 的 3.3× 为准。
- **机制未分离**（见 60.3 末条）。

### 60.5 实施项（按依赖顺序，供拍板）

1. **报告 / 结论层（2026-09-27 已实施，C1-①）**：队伍载荷（`evaluationScope.party` 非空）时，结论卡
   载荷标注旁加一行**保守提示**（`data-trigger-optimizer-scope-party-detection`；i18n 键
   `partyDetectionNote`）：「队伍载荷下的判据链真检出率实测偏低（本机基准 93.2% → 64.6%，同一批种子与
   切分）⇒ 搜索可能欠采：建议提高「重复次数」后重跑」——不改任何判据与数值；单人载荷不挂该提示。
   落点：`TriggerOptimizerPage.vue`（模板行 + `scopePartyDetectionNote`）+ zh/en `common.json` +
   `TriggerOptimizerPage.template.test.js`（三个断言：单人无 / 队伍有 / 文案含 93.2% 与 64.6%）。
   「建议提高『重复次数』」一句的依据见第 2 条（C1-② 实测）。
2. **队伍载荷下的轮数口径（2026-09-27 C1-② 已实测 + 上限已实施）**：复用同一批样本与同一组切分，逐值复算
   5/8/10/12 轮（首跑 `--party-stats-rounds=5,8,12`，10 轮为后续补测；正式跑 4h / 32 种子 / 500 试验）：

   | 轮数          | 单人检出          | 队伍检出         | 同轮数差距（R3） |
   | ------------- | ----------------- | ---------------- | ---------------- |
   | 5（默认口径） | 93.2%（466/500）  | 64.6%（323/500） | −28.6pp          |
   | 8             | 99.4%（497/500）  | 77.6%（388/500） | −21.8pp          |
   | 10            | 99.8%（499/500）  | 83.0%（415/500） | −16.8pp          |
   | 12            | 100.0%（500/500） | 86.2%（431/500） | −13.8pp          |
   - 预注册 R1（补偿性）＝ 队伍 12 轮 ≥ 单人 5 轮 − 10pp（= 83.2%）⇒ **成立（86.2%）**；差距随轮数收敛
     （−28.6 → −13.8pp）；R2（安全性）＝ 各轮数队伍假采纳不升 ⇒ **成立**（≤ 0.2%）。
   - **只放宽上限（已实施）**：`TRIGGER_OPTIMIZER_MAX_ROUNDS` 10 → **12**（2026-09-27；UI 输入框 / 校验 /
     归一化全部跟随常量）；fine 档的 10 轮**不跟随**（档位 = 默认成本，不动默认）；zh/en `invalidSettings`
     文案同步为「重复次数 1–12」，并顺带修正同一条文案里过时的「每技能候选上限 2–16」（常量已是 20）；
     新增 i18nResources 的 bounds 顺序一致性测试锁住这条文案。
   - 结论：**加轮数确实能把检出拉回默认水平附近** —— 10 轮 83.0%（与判据线 83.2% 实质平齐，−0.2pp 在
     500 试验下不可分）、12 轮 86.2%（明确达标）⇒ C1-① 提示中的「建议提高『重复次数』」有实测支撑。
   - 成本账（§61 模型）：精测场次 ∝ 轮数 ⇒ 5 → 10 ≈ ×2、5 → 12 ≈ ×2.4（粗筛仍 2 轮）。
   - 复现提示（补注 2026-09-27）：R1 判据式右端的「单人基线」取请求档集中**与主扫描 `--rounds` 同档**的行
     （默认 5 轮；列表不含该档时回退为列表最小档）⇒ 单独重跑 `--party-stats-rounds=10,12` 时基线 = 单人 10 轮
     （99.8%）、判据线 89.8% ⇒ 该趟打印「不成立」，与首跑（基线 = 单人 5 轮 93.2%、判据线 83.2% ⇒「成立」）**不矛盾**；
     跨趟比对应看各轮数值行（A/B/补测三趟逐值一致），不看 R1 结论行。

3. **门槛口径**：**不建议**下调 `MIN_ADOPT`——C1-a 显示队伍环境假采纳为 0%，说明门槛在队伍下并不偏松；
   下调有假采纳风险，且需要重新标定。
4. **复核链（2026-09-27 已补测，见 §63）**：复核不虚报 ✓（队伍 null 桶 7/21000 ≈ 0.03%）；功率不足
   （A2 不成立：共享 real 候选 65.4% vs 单人 100.0%）⇒ 「队伍单独轮数（复核，实测达标档 16）」实施项
   **已拍板落地（2026-09-27，§63.4 ①：复核上限 12 → 16）**；复验臂共同 real 交集为空 ⇒ B2 不可判（仍缺证据）。

### 60.6 复现与回归

- 正式复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3,4 --party=parity --party-stats=1 --timing-study=1 --timing-eval-seeds=5`
  （本次 ≈40 min = S1 ≈4 min + 单人池 1536s + 队伍池 346s + 判读 ≈2 min；输出搜 `队伍载荷统计口径对照`）。
  冒烟：`--hours=1 --seeds=24 --rounds=2 --trials=50 --slots=2,3,4 --party=parity --party-stats=1 --cross-zones=0`
  （≈5 min，两次逐值一致）。
- 装置确定性：本段全部指标是「样本 + 固定切分种子（20261001）」的纯函数。**正式跑 B（同命令二次跑）的
  C1 段与 A 逐值一致**（C1-a 1.2% / 0.0%；C1-b 93.2%（466/500）/ 64.6%（323/500）；σ 0.01570 / 0.01206，
  等效轮数比 0.590；载荷效应 +0.11172 ± 0.01359 ⇒ 完全复现）；同日 `--party` 段（§59）也在两趟正式跑间
  逐值一致（4.3% / −0.01110 / 84.9% / 0.00325）。
- 本轮改动 = 研究装置 1 文件（`--party-stats` 参数 / 构造与判读段）+ 本文档；**生产代码零改动**。
- 追加（2026-09-27，C1-① 实施 + C1-② 实测 + S4 量化）：装置新增 `--party-stats-rounds`（轮数 A/B 段）与
  `--reuse-study`（§62 段），engine 再导出 `applyCandidateToPlayerConfig`；**生产侧实施 C1-①**（落点见
  60.5 第 1 条）；C1-② 实测见 60.5 第 2 条（R1 成立）；S4 见 §62。复现 = 本段首行命令追加
  `--party-stats-rounds=5,8,12 --reuse-study=1 --cross-zones=0`（A/B 两次跑，C1-② 与 S4 段逐行一致）。

---

## 61 成本分解与重标定（S1，2026-09-27）

问题：§20.3 的成本模型（**0.66s 固定 + 0.18s/模拟小时**，2026-09-20 串行标定）早于 §54（一批种子一个
realm）/ §55（并行度按机型自适应）/ §56（24h 重载压测）—— 当前形态下「钱花在哪」，老模型还准吗？

### 61.1 口径与装置（生产零改动）

- 装置新增 `--timing-study=1`（默认关闭；参数 `--timing-hours=1,4,8,12,24` / `--timing-reps=3` /
  `--timing-eval-seeds=4` / `--timing-curve-keys=12` / `--timing-curve-seeds=6` /
  `--timing-workers=1,2,4,8,12,16`）。worker 协议扩展：`ready` 消息（realm 启动计时）+ 逐场分阶段耗时
  （`runPayload` / `collectMetrics`）。
- 测量单元 =「一次评估」（生产形态）：一个新 realm + N 场串行（正式跑 N=5，对齐生产 `rounds=5`）；
  payload 构建在主线程另行计时；往返 = postMessage 主线程墙钟 −（realm 启动 + 引擎 + 聚合）。
- 预注册判据（开跑前写死）：**T1** 斜率对 180ms/模拟小时 的偏差 ≥ 20% ⇒ 老成本模型失效（新值写档）；
  **T2** 任一阶段 ≥ 20% 墙钟 ⇒ 列为可优化点；**T3** > 8 工人收益 < 5% ⇒ 关闭「worker 池化 / 提上限」
  方向；**T4** 主线程占用率（`performance.eventLoopUtilization`）≥ 50% ⇒ 主线程列为并列优化点。

### 61.2 实测（正式跑 A；T 曲线 = 3 复 × 5 场/评估）

| T   | 墙钟 ms/场 | realm 启动（摊薄 /5） | 引擎 runPayload | collectMetrics | postMessage 往返 | payload 构建 |
| --- | ---------- | --------------------- | --------------- | -------------- | ---------------- | ------------ |
| 1h  | 304        | 65                    | 237             | 2              | 0.6              | 1.1          |
| 4h  | 762        | 77                    | 682             | 3              | 0.6              | 0.8          |
| 8h  | 1274       | 72                    | 1198            | 3              | 0.8              | 1.0          |
| 12h | 1848       | 71                    | 1774            | 3              | 0.6              | 0.8          |
| 24h | 3440       | 69                    | 3366            | 4              | 0.6              | 1.0          |

- 拟合（两次正式跑，5 点）：**A：墙钟 = 196 + 135.7 × T ms/场**（引擎侧 122 + 135.6 × T）；**B：墙钟 =
  219 + 136.5 × T ms/场**（引擎侧 147 + 136.3 × T）。对照老模型 660 + 180 × T：**斜率偏差 24.6% / 24.2%
  （⇒ ≥ 20%，老模型失效）**、截距偏差 70.3% / 66.8% ⇒ 两次运行一致给出「老斜率偏高约 24%」。
- 测量点集的影响（诚实）：2 点拟合（只采 1h+4h，冒烟）给出斜率 179.0 / 192.6 ms/h（偏差 0.5% / 7.0%）——
  1h 点的 JIT 预热 / 新建 realm 占比大，会把两点斜率抬高；**正式跑用 5 点拟合（1/4/8/12/24h）才稳定**
  （两次运行拟合差 < 1 ms/h）。
- 阶段分解（T=4h）：realm 启动 **10.1%（A）/ 9.3%（B）** / payload 构建 ≈ 0.0% / 引擎 runPayload
  **89.4%（A）** / collectMetrics 0.4% / postMessage 往返 0.1% ⇒ T2 过线项 = **引擎 runPayload**。
  （T=1h 场景 realm 启动占 25.2% —— 短时长才显著。）
- 并行度曲线（12 场景 × 6 轮 = 72 场/点，4h；两次正式跑）：
  A：1 工人 1.8 → 2 工人 3.2（×1.73）→ 4 工人 5.6（×3.09）→ 8 工人 7.0（×3.84）→ 12 工人 7.3（×3.98）→
  16 工人 7.4（×4.09）；
  B：1.8 → 3.2（×1.79）→ 5.7（×3.19）→ 7.1（×3.94）→ 7.5（×4.18）→ 6.9（×3.87）。
  主线程占用率 ≤ 0.6%。T3：8 → 最优 >8 点收益 **+6.6%（A，16 工人）/ +6.0%（B，12 工人）** ⇒ 均 ≥ 5%
  ⇒ 两次正式跑都判「保留池化候选」；冒烟对照 −3.8% / −0.3%（小负载，见 61.4）。
- 主线程占用率：并行度曲线各点 0.1–0.4%；**主采样全程（25152 场）0.1%**。主采样速率 16.4 场/s
  （8 workers，4h；§59 的 1h 冒烟为 43.8 场/s）。

### 61.3 裁决与速度总账

- **T1（成本模型）**：两次正式跑（5 点）都触发重标定（24.6% / 24.2%）⇒ 老模型数值作废，**新标定
  （本机 / 本夹具 / 丛林 tier0）：≈ 0.20–0.22 s 固定 + ≈ 0.14 s/模拟小时**（A 196 + 135.7 × T、
  B 219 + 136.5 × T ms/场；固定项含 realm 启动 ~250ms/评估 ÷ 5 场摊薄 + 引擎冷启动 + 聚合/往返）。
  §20.3④ 的 0.66s / 0.18s 作为历史标定保留，数字引用请改本行。
- **T2（阶段占比）**：唯一过线项是引擎 runPayload（89.4%@4h）⇒ **S2「固定开销专项」关闭**（realm 启动
  4h 仅 10.1%、payload 构建 ≈ 1ms、聚合/往返 <1%）；它只对「≤1h 短时长」场景仍有意义（25.2%）。
- **T3（并行度）**：两次正式跑都给出 > 8 工人收益 **+6.6% / +6.0% ≥ 5%**（按预注册判据 ⇒ 不关闭）⇒
  **保留「worker 池化 / 提上限」为低优先候选（量级 ~6%；最优点在 12 工人附近，16 工人无额外收益甚至
  回落）**；两次小负载冒烟为 −3.8% / −0.3% ⇒ 收益与负载规模相关，落地前需应用内 A/B（§55 同款；
  cap=8 是 §55 的机型自适应上限，本结论只说明「8 → 12 有 ~6% 量级」）。
- **T4（主线程占用率）**：0.1–0.4%（并行曲线）与 0.1%（主采样全程）⇒ **S3 的「主线程 / 协调器占用」
  半边关闭**（与食物优化器相反：本引擎主线程几乎不参与计算，加 worker 无效的旧结论不适用于本项目
  的 node 形态）。
- **速度总账**：单场成本 ~90% 在引擎 runPayload（4h → 24h 都如此），固定开销 < 11% ⇒ 能省时间的只剩
  **减少 / 复用模拟场次**这一条路 ⇒ **S4（跨运行样本复用）成为剩余速度方向里唯一打击大头的候选**
  （`createTriggerOptimizerSeedSet` 的种子键已刻意排除 `triggerMap` ⇒ 同候选跨运行逐值可复现；生产
  `input.baselineMetrics` 复用路径存在但从未使用）。S4 的收益取决于用户重复跑「同玩家 / 同技能 / 同目标 /
  同难度 / 同时长」搜索的频率，建议下一步先做**使用频率 + 可复用比例**的量化再决定是否实施。
- 结论：**速度方向本轮收口**——S2 关闭、S3 关闭（主线程半边）且并行上限结清、S4 列为唯一后继候选；
  本轮装置与结论同时可作为后续任何速度改动的基线表。

### 61.4 诚实边界

- **机器 / 夹具 / 区域特定**：16 逻辑核 Windows、丛林 tier0 基线 payload、node worker_threads；换机器、
  换负载、换区域会变（本机斜率测量对测量点集敏感：2 点拟合 179–193 ms/h vs 5 点拟合 136 ms/h ——
  1h 点的 JIT 预热占比大；正式跑一律用 5 点）。
- **应用内 ≠ node**：浏览器 Worker 的启动 / 调度模型不同（§54 的先例：装置只证机制与量级，生产收益以
  应用内 A/B 为准）——T4 的「主线程不参与」结论在应用内需同款复核才能落地为生产结论（但主采样 0.1%
  的幅度足以说明「除非应用内存在装置外的主线程负担，否则不是瓶颈」）。
- **并行度曲线是小批量口径**（72 场/点）：与大批量速率（16.4 场/s）不同口径；`>8 收益`的判据对工作负载
  规模敏感（小批量里 overhead 占比更大）——两次冒烟的负收益（−3.8% / −0.3%）与两次正式跑的 +6% 即源于此，
  故「~6%」只作为量级参考，落地以应用内 A/B 为准。
- **一次评估按 5 场建模**（= 搜索 `rounds=5`）：复核 6 轮 / 追加 12 轮按 196 + 135.7×T 的「每场固定项
  ÷ 评估场数」线性换算（本段未单独测）。
- **未测**：浏览器主线程的 payload 构建 / 结构化克隆 / 持久化等应用内额外开销；磁盘 / 内存压力；
  24h 以上时长。

### 61.5 复现与回归

- 复现：`node scripts/trigger-optimizer-racing-study.mjs --timing-study=1 --hours=4 --seeds=32 --rounds=5 --trials=500 --workers=8 --slots=2,3,4 --party=parity --party-stats=1 --timing-eval-seeds=5`
  （输出搜 `§61 成本分解`；S1 段位于主跑最前、约 4 min，**无独立开关** —— 复测重标定用轻参数跑即可）。
  冒烟（S1 轻参数）：`--timing-study=1 --timing-hours=1,4 --timing-reps=2 --timing-eval-seeds=3 --timing-curve-keys=8 --timing-curve-seeds=4`。
- 跨运行复现（同日）：两次冒烟 C1/§59 各项逐值一致；正式跑 A/B（同命令）的 C1/§59 段逐值一致，S1 段
  两次 5 点拟合一致（A 196+135.7T / B 219+136.5T；斜率偏差 24.6% / 24.2%）—— 装置的样本侧完全确定，
  计时侧复现到「斜率 ±1 ms/h」量级（单点耗时见 61.2 的 ±5% 级波动）。
- 本轮改动 = 研究装置 1 文件（worker 协议 `ready`/`timings` + `--timing-*` 参数 + S1 段）+ 本文档；
  **生产代码零改动**。

---

## 62 跨运行样本复用（S4，2026-09-27）

问题（§61 的速度总账）：单场成本 ~90% 在引擎 runPayload ⇒ 速度方向只剩「减少 / 复用模拟场次」一条路。
S4 = 跨运行样本复用：`createTriggerOptimizerSeedSet` 的种子键刻意**不含 `triggerMap`** ⇒ 同一（玩家 /
已佩戴技能 / 目标 / 难度 / 时长）下，**同一候选 payload 的模拟样本跨运行逐值可复现**（§51 恒等自证 /
§59·§60 的两次正式跑逐值一致即此性质）。那么同一用户工作流的**下一次搜索**里，有多少评估可以不
再重跑？本轮只做**可复用比例**的只读量化（结构化测量，不额外跑仿真；生产零改动）；「使用频率」在
仓内不可测（需产品侧拍板），作为 P2 档位的第二输入留给拍板。

### 62.1 口径与装置

- 装置新增 `--reuse-study=1`（默认关闭；依赖主采样样本，无额外仿真）。
- 复用口径：评估 = 1 配置 × `--seeds` 场；**可复用 ⟺ payload 逐字节相同（stableStringify）且种子序列
  逐值相同**（后者由断言自证：种子键不含 triggerMap）。
- 三个场景（在同一份 run1 样本池上做结构比对）：
  - **S0 同输入重跑**（构造口径自证，应恒 100%；含「只改权重 / 档位等不进 payload 的设置」）；
  - **S1 应用「单槽 winner」后重跑**：winner = 该槽全体种子聚合真实分 top1（§58 / §59 同口径），逐槽
    各算一遍（用户点「应用」只换一个槽的形态）；
  - **S2 应用「全部槽 winner」后重跑**（用户一次把全部 winner 换上）。
- run2 的 payload / 候选由**生产函数**现场重建（`buildCandidatePayload` / `resolveOptimizerResources` /
  `buildCandidateConfigs` / `applyCandidateToPlayerConfig`），装置不写判据副本。
- **预注册判据**（开跑前写死）：
  - **P1（自证）**：run2 种子序列与 run1 逐值相同；S1/S2 的 run2 基线评估必须落在 run1 目标集内；
    S0 恒 100%（构造口径自证）。
  - **P2（主）**：R1 = S1 三个单槽场景的复用率均值（唯一 payload 键口径）：**≥40%** ⇒ 值得实施持久
    样本缓存（须带价表行情 / 引擎版本键护栏 —— C2 教训）；**20–40%** ⇒ 条件候选（需以实际「迭代
    重跑」频率拍板）；**<20%** ⇒ 不实施。
  - 参考列（不参与裁决）：按槽明细（基线 / 变更槽 / 其它槽）、S2、每评估样本体量与单轮池体量。

### 62.2 实测

正式跑 A（4h / 32 种子 / 5 轮 / 500 试验 / `--cross-zones=0`，≈17 min；同命令二次跑 B 的 C1-② 与 S4 段
与 A **逐行一致**）；下表全部为装置输出原值：

- **P1 自证**：✓ run2 种子序列与 run1 逐值相同（种子键不含 triggerMap）｜**S0 同输入重跑**：58/58 = 100.0%。
- **S1（应用「单槽 winner」后重跑；winner = 该槽全体种子聚合真实分 top1）**：

  | 场景                              | 复用率         | 明细                                                                   |
  | --------------------------------- | -------------- | ---------------------------------------------------------------------- |
  | 槽 2 firestorm（winner = 锚点）   | 58/58 = 100.0% | 变更槽 2 20/20，其它槽 3 20/20，其它槽 4 20/20（退化：应用后配置不变） |
  | 槽 3 flame_blast（winner 非锚点） | 19/58 = 32.8%  | 变更槽 19/20；其它槽各 1/20                                            |
  | 槽 4 fireball（winner = 锚点）    | 58/58 = 100.0% | 全部 20/20（退化）                                                     |
  | **R1 ＝ 三槽均值**                | **77.6%**      | 含 2 个退化场景；剔除后（真变化）= 32.8%                               |

- **S2（应用全部槽 winner 后重跑）**：19/58 = 32.8%（= 槽 3 形态）。
- **P2（主）**：R1 = 77.6% ⇒ **≥40% 高档**（须带价表行情 / 引擎版本键护栏）。
- 参考：每评估样本 ≈ 5.7 KB（含 32 轮，JSON 文本口径）⇒ 单轮搜索池（58 评估）≈ 0.32 MB。
- 退化场景的判定依据（同一次跑的槽位分类）：槽 2 / 槽 4 的「全体种子聚合真实分 top1」= 锚点本身
  （`current {}` / `default {}`，真实分 0.00000）；槽 3 的 top1 = `enemyGroupHp {"value":800}`（0.01978）。

### 62.3 裁决

- **按预注册口径**：R1 = 77.6%（≥40% 高档）⇒ 「值得实施持久样本缓存」。**同时披露**：3 个 S1 场景里 2 个
  是构造性退化（winner = 锚点 ⇒ 「应用」后配置无变化 ⇒ 100% 复用与 S0 同义）；唯一真变化场景 = 32.8%，
  S2 同值 32.8%。
- **保守读法（建议以它定档）**：S4 的增量价值在「应用了改进之后还能复用多少」⇒ 看真变化场景 = **32.8%**
  ⇒ 落 20–40%「条件候选」档：是否实施取决于「迭代重跑」的实际频率（仓内不可测 ⇒ 交产品侧拍板）。
- **结构发现（决定收益形态）**：真变化时 —— ① 变更槽自身的候选 payload 几乎全部复用（19/20；候选族生成
  基本不依赖锚点，仅个别由锚点派生）；② 其它槽的候选以「新基线」为背景 ⇒ 几乎全失效（1/20）。
  ⇒ 缓存收益主要来自「同一槽候选族的重复评估」而非「整池复用」；「应用全部 winner 后立刻再搜」这一形态
  可省 ~1/3 场次。
- **不做的事**：本轮**不实施**任何缓存（缺少频率输入；缓存键护栏未实现：价表行情 C2 教训 / 引擎版本 /
  模拟设置）；若拍板实施，以「真变化场景 32.8%」作为收益上界、先补护栏与频率刻度。

### 62.4 诚实边界

- **只测「结构可复用比例」，不测使用频率**：本段回答「若用户重跑，理论上能省多少」；「用户多久重跑
  一次」仓内不可测（需产品侧拍板）—— P2 的 20–40% 档必须与频率联合解读。
- **winner 口径 = 真实分 top1（事后最优）**：真实用户「应用」的是**报告 winner**（含选择偏差），其形态
  分布可能更散 ⇒ 本段的复用率是**乐观上界**（报告 winner 更随机 ⇒ 复用可能更低）。
- **S1 均值的构成**：三槽中 2 槽为退化场景（winner = 锚点）⇒ R1 = 77.6% 须同时读「含退化」（预注册口径）
  与「剔除退化」（32.8%）两个数；两者之差 = 构造性复用（与 S0 同义），不含新信息。
- **单队友 / 单区域 / tier0 / 三槽 / 单时长 / 固定候选生成**：种子池 = `--slots` 三槽候选 + 基线；换
  区域 / 难度 / 时长 / 队友构成 / 候选上限均未测（种子键含这些维度 ⇒ 任一变化 = 0% 复用）。
- **缓存键护栏未实现**：价表行情（C2 教训）、引擎版本、模拟设置未纳入任何真实缓存 —— 本段只量化
  「理论可复用」，不产出实现。
- run2 的重建路径依赖「同确定的 const 窗口」（`resolveOptimizerResources` 的概率窗口）⇒ P1 的种子断言
  与 S0 = 100% 是必要的自证；若 S1/S2 的基线评估不可复用（打印 `（！）`）说明重建路径漂移，须先排查
  再读复用率。

### 62.5 复现与回归

- 正式复现（含 C1-②）：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5
--trials=500 --workers=8 --slots=2,3,4 --party=parity --party-stats=1 --party-stats-rounds=5,8,12
--reuse-study=1 --cross-zones=0`（输出搜 `跨运行样本复用量化`；S4 段在判读末尾、秒级）。
- 冒烟：`--hours=1 --seeds=24 --rounds=2 --trials=50 --slots=2,3,4 --party=parity --party-stats=1
--party-stats-rounds=2,5,8 --reuse-study=1 --cross-zones=0`（≈4 min；S4 段秒级）。
- 本轮改动 = 研究装置 1 文件（`--party-stats-rounds` / `--reuse-study` 参数 + C1-② 段 + S4 段 + engine
  再导出 `applyCandidateToPlayerConfig`）+ 生产侧 C1-①（1 页 3 文件 + 2 语言包）+ 本文档。

---

## 63 队伍载荷复核链（2026-09-27）

问题：§59 / §60 量过「判据链（racing → 精测 → 采纳闸门）在队伍载荷下的检出 / 假采纳」，但**检查链**在
队伍载荷下的行为没有量过（§59.6 / §60.4 的同一遗留）：用户在报告上点「复核」（换难度稳健性复核，§29 /
§49）会不会虚报？搜索期「独立复验」（§21 / §31 / §47）会不会否决真提升？本项只读量化、**生产零改动**。

### 63.1 口径与预注册判据（开跑前写死）

- **复核臂**：生产 robustness 盐 × 相邻难度（tier 1）的**新样本**（队伍载荷单独采样趟、与单人同种子
  CRN）；先验 = 搜索难度样本切 6 轮反解（A′，`planTriggerOptimizerRobustnessRounds`），判据 = 目标难度
  样本逐试验换 perm 切 `plannedRounds` 轮；两套载荷共用同一组 perm。
- **复验臂**：候选 vs 基线在搜索难度样本上切 6 轮配对重判（首轮 = 报告口径；判据 = `summarizeSamples`
  的 p<0.05，与生产逐轮 verdict 同一把尺子）；首轮 inconclusive 时按 §47 A′ 追加作参考（上限 24；
  **未叠加** §50 累计护栏）。
- **主口径 =「共同分类」候选**（两套载荷真值分类一致者；各自分类降为参考列 —— 理由与 §60 的主口径修正
  同源：各自分类的 pooled 比较会混入构成效应）。
- 判据：**A1** 复核不虚报（队伍 null 桶判成立 ≤ 单人 + 2pp）｜**A2** 复核功率（队伍 real ≥ 单人 − 10pp）｜
  **B1** 复验不虚报（同 A1 口径）｜**B2** 复验不否决（同 A2 口径）。
- 补充判据 **S1**（§63-② 轮数补偿，纯回放）：存在档位 n 使 队伍 real 判成立率 ≥ 同档位单人 − 10pp
  ⇒ 轮数可解（列「队伍单独轮数」实施项）；否则轮数不是解（结构性）。

### 63.2 装置（研究装置新增两段，零产品改动）

- `--party-checks=1`：复核臂新增「队伍 robustness 盐 × 相邻难度」样本（61 配置 × 32 轮 = 1952 场，单独
  采样趟 —— §59 / §60 的 61 配置池速率行口径保持不变）；复验臂复用现有搜索期两套样本（**零新采样**）。
- `--party-checks-rounds=6,8,12,16,24,32`（§63-②）：对共同分类候选按固定档位逐值复算判成立率（同一批
  perm 前缀）。
- 判定全走生产实现（`computePairedStats` / `planTriggerOptimizerRobustnessRounds` /
  `resolveTriggerOptimizerVerificationRounds` / `TRIGGER_OPTIMIZER_VERIFY_ROUNDS`）；脚本不抄判据。
- 正式跑命令 = §62.5 复现命令追加 `--party-checks=1 --party-checks-rounds=6,8,12,16,24,32`；A / B 两次跑
  **主段逐值一致**；§59 / §60 / §62 三段与本轮之前（同参）正式跑逐值一致（仅速率行不同）⇒ 新增采样趟
  零扰动。

### 63.3 实测（正式跑 A / B：4h / 32 种子 / 5 轮 / 500 试验 / slots 2,3,4 / jungle_planet tier0 → tier1）

复核臂（共同分类：real **1** / null 42；分母 = 案例数 × 500 试验）：

| 载荷 | 真提升：判成立       | 判负          | 未决                 | 轮数/侧 | null：判成立     | F 6 轮（参考）   |
| ---- | -------------------- | ------------- | -------------------- | ------- | ---------------- | ---------------- |
| 单人 | 100.0%（500/500）    | 0.0%（0/500） | 0.0%（0/500）        | 9.57    | 0.0%（0/21000）  | 99.6%（498/500） |
| 队伍 | **65.4%（327/500）** | 0.0%（0/500） | **34.6%（173/500）** | 8.09    | 0.03%（7/21000） | 53.2%（266/500） |

- 反解统计（A′）：单人 有计划 28500 次（上限也不够 2949 = 10.3%）｜可反解平均要 3.2 轮；队伍 28500
  （上限也不够 4797 = 16.8%）｜平均 3.9 轮；先验退化两侧各 1500 次。
- 复验臂（共同分类：real **0** / null 45）：real 桶两套载荷均无样本 ⇒ **B2 不可判**；null 桶首轮判成立
  单人 0.03%（6/22500）→ 追加后 0.04%（9/22500）｜队伍 0.00%（1/22500）→ 0.01%（2/22500）。
- 分类对照（real / null / 介于门槛之间，逐槽）：槽 2 单人 0/19/1｜队伍 0/12/8；槽 3 单人 3/16/1｜队伍
  1/13/6；槽 4 单人 0/20/0｜队伍 0/17/3。
- 判据行：A1 ✓（0.03% ≤ 0% + 2pp）｜**A2 ✗（−34.6pp）**｜B1 ✓（0.00% ≤ 0.03% + 2pp）｜**B2 不可判**。

§63-② 轮数补偿（共享 real 候选 = 槽 3 `all_enemies + current_hp ≥ 1600`；目标难度真值 单人 **0.03212** /
队伍 **0.01181**；同一批 perm 逐值复算）：

| 档位              | 单人              | 队伍                 |
| ----------------- | ----------------- | -------------------- |
| 6 轮              | 99.6%（498/500）  | 53.2%（266/500）     |
| 8 轮              | 100.0%（500/500） | 66.8%（334/500）     |
| 12 轮（现状上限） | 100.0%（500/500） | 88.6%（443/500）     |
| 16 轮             | 100.0%（500/500） | **99.0%（495/500）** |
| 24 轮             | 100.0%（500/500） | 100.0%（500/500）    |
| 32 轮             | 100.0%（500/500） | 100.0%（500/500）    |

- **S1 成立（达标档 16 / 24 / 32 轮）⇒ 轮数可解**；null 桶安全（32 轮）：单人 0/21000｜队伍 0/21000
  （0.0%）⇒ 加轮数不制造虚报。
- 各载荷现状 A′ 判成立（同候选）：单人 100.0%（500/500）｜队伍 65.4%（327/500）。
- 复验 real 归类（搜索难度真值，交集为空）：单人 real = `current_hp ≥ 800` 及其 `mystic_aura` 孪生
  （各 0.01978）；队伍 real = `dead_units ≤ 0`（0.01628 / 0.01357）与 `current_hp ≥ 1600`
  （0.01680 / 0.01162）⇒ 两批候选不重叠。

### 63.4 判读与裁决

1. **不虚报成立（硬判据全过）**：队伍复核 null 桶 7/21000 ≈ 0.03%（与单人 0 的差 < 0.05pp）；复验 null
   桶 1/22500 ≈ 0.004% ⇒ 检查链不会把「没提升」判成成立。
2. **功率不足（A2 不成立）**：共享 real 候选在现状 A′（6~12 轮、实际 8.09 轮/侧）下判成立 **65.4%**，
   单人 **100.0%**（−34.6pp）；34.6% 全部落在「未决」（判负 0%）—— 队伍下复核更常「说不出话」，不是误判。
3. **机制与量级**：该候选在目标难度的真值 单人 0.03212 → 队伍 0.01181（−63%，贴 0.01 门槛）；而判定是
   p<0.05 的配对显著（t ∝ mean/σ）⇒ 队伍需要更多轮数。补偿曲线显示 12 轮 88.6% 距判据线（同档位单人
   100.0% − 10pp = 90.0%）**差 1.4pp 未达标**；16 轮 99.0% —— 现状上限 12 正是绑住它的约束
   （2026-09-27 已抬到 16，见第 5 条）。
4. **复验臂不可判**：4h 尺度下两套载荷的 real 候选不是同一批 ⇒ 共同口径零样本；各自分类参考（首轮
   单人 90.0% / 队伍 67.8%，−22.2pp）受构成效应污染，**只作参照、不作结论**。
5. **裁决 ⇒ 已拍板并实施 ①（2026-09-27）**：预注册口径「功率 ⇒ 队伍单独轮数」：
   - **① 复核上限 12 → 16（全局）—— 已实施**：最小改动；实测达标档 16 轮（99.0%）。单人侧实测 ≤12 已 100%
     ⇒ 该上调只在「先验说不够」时生效，属于「允许更贵」而非「默认更贵」。实施要点：轮数是**硬钳位** ——
     planner 的 `capRounds` 直接取调用点传入的 `TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS`（§49；store /
     页面两处共用同一常量）；本次改的是该常量本身（12 → 16），planner / 追加归一化 / store / 页面 /
     装置 import 随之全线生效（§49 修订条）。成本上界 ≤ 24 → ≤ 32 场/次复核；§49 的「额外 ≤ 整轮
     20%」护栏口径不变且在短时长档先咬住（快档整轮 ~74 场 ⇒ 额外 ≤ 7 轮、计划 ≤ 13 轮）。
   - **② 仅队伍载荷时上限 16 —— 未采用**：需把「是否有队友」传给 planner 调用点（`options.maxRounds`）；
     成本更精确，但必要性未被实测支持（单人侧的「允许更贵」不产生额外默认成本）。
   - **③ 不改 —— 未采用**：接受 12 轮 88.6% 与更多「未决」，与 A2 的功率缺口冲突。
   - 报告措辞（可选，零成本，未实施）：队伍载荷下「未决」显式提示「证据不足」。
6. **与 C1 的关系**：C1 的「检出率」是**搜索采纳闸门**（已实施重复次数上限 12）；本项是**复核链**
   （换难度）—— 同一根因（队伍下效应贴门槛 + 判定是显著性口径），不同的杠杆（复核轮数）。

### 63.5 诚实边界

- **共同 real 只有 1 个候选**（1 候选 × 500 试验）：A2 与补偿曲线的结论在该候选上成立，**不外推**；
  与 §57.5「真提升桶只有 2 个候选」同源限制。
- 复验臂 B2 不可判（交集为空）；各自分类的「否决率」参考含构成效应，**不得**据此下「复验否决」结论。
- 目标难度只测相邻 tier 1；单队友 / 单区域 / 三槽（同 §59 边界）；指标口径 = 主角自身。
- 复核判定样本与「真值」来自同一批 32 种子（perm 切分近似 §49）；「达标档 16」换批次会变；32 轮档 =
  全样本上限（退化端点，只作上界参考）。
- 正式跑 B 的速率行受机器负载影响（主采样 11.7 vs 正式跑 A 11.0 / §61 基准 16.4 场/s）—— 数值行不受
  影响（A / B 主段逐值一致）。

### 63.6 复现与回归

- 正式复现：`node scripts/trigger-optimizer-racing-study.mjs --hours=4 --seeds=32 --rounds=5 --trials=500
--workers=8 --slots=2,3,4 --party=parity --party-stats=1 --party-stats-rounds=5,8,12 --reuse-study=1
--cross-zones=0 --party-checks=1 --party-checks-rounds=6,8,12,16,24,32`（本次 A / B 各 ≈30 min；输出搜
  `队伍载荷复核链` 与 `复核轮数补偿`）。
- 冒烟：`--hours=0.1 --seeds=24 --rounds=2 --trials=20 --slots=2,3,4 --party=parity --party-checks=1
--party-checks-rounds=6,8,12,16,24,32 --cross-zones=0`（≈4 min）。
- 装置确定性：A / B 主段逐值一致；§59 / §60 / §62 三段与本轮之前（同参）正式跑逐值一致（仅速率行不同）。
- 本轮改动 = 研究装置 2 文件（`--party-checks` / `--party-checks-rounds` 参数 + 队伍复核采样趟 + 复核 /
  复验判读段 + §63-② 补偿段；engine 再导出 `TRIGGER_OPTIMIZER_VERIFY_ROUNDS`）+ 本文档；**生产代码零改动**。
- **实施后（2026-09-27，§63.4 ①）**：`TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS` 12 → 16（生产 5 文件 + 装置
  注释 / 断言随动 + 6 个测试文件同步；口径见 §49 修订条）。对本节的意义：再跑装置时 `F${CAP}` 参照臂 =
  F16、「现状 A′」的计划上限随之为 16（预期落到补偿曲线的 99.0% 档）；A / B 日志按 12 轮口径的实测保持
  历史记录（表格不改）。

> 装置注（2026-10-02）：§30.8 起全部「装置 / 复现」命令引用的
> `scripts/trigger-optimizer-racing-study.mjs` 已随切片 21B 删除而失效——详见文首「装置删除注」。
