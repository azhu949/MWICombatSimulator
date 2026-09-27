// 技能触发器优化器 —— store actions（模式照 simulatorFoodOptimizerActions.js）。
//
// 职责：把 node-2/node-3 的纯领域 + 搜索链路接入 Pinia：
//   startTriggerOptimizer  校验 → 构建 playersToSim → 组装 optimizeTriggers 入参 →
//                          运行 → 写 results；runtime 全程更新
//   stopTriggerOptimizer   cancelTriggerOptimizerRun + stopTriggerOptimizerWorkerRuns + 复位
//   applyTriggerOptimizerResult  把 bestTriggerMap 写回 activePlayer.triggerMap
//                                （只覆盖被优化技能的键，不动食物/饮品键）
//   revertTriggerOptimizerChanges 用基线快照恢复 triggerMap
//   setTriggerOptimizerSettings   归一化 + 校验 + 落盘 + 标记结果过期
//   resetTriggerOptimizerResults  导入新存档时重置会话内结果
//
// 互斥（设计 §4.2）：triggerOptimizerBusy 汇总 store.runtime / queue / advisor /
// foodOptimizer / pricing / 共享 worker / 自身运行态。上游 service 的口径不改。
//
// 报告过期：输入指纹（node-2 的 createTriggerOptimizerInputSignature）变化即过期，
// 应用后用 appliedInputSignature 记录「应用时刻的输入」，使「应用 → 手改 → 再应用」
// 的过期判定与 foodOptimizerReportStale 同源。

import {
  clearTriggerOptimizerReportFromStorage,
  loadTriggerOptimizerReportFromStorage,
  loadTriggerOptimizerSettingsFromStorage,
  persistTriggerOptimizerReportToStorage,
  persistTriggerOptimizerSettingsToStorage,
  createProfitPricingOptions,
} from '../services/simulatorStorage.js';
import {
  createEmptyResult,
  createOptimizerInput,
  createTriggerOptimizerInputSignature,
  getTriggerOptimizerPresetSettings,
  isValidTriggerOptimizerSettings,
  normalizeTriggerOptimizerSettings,
  resolveTriggerOptimizerAppendSpentSimulations,
  resolveTriggerOptimizerPresetId,
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
} from '../services/triggerOptimizerDomain.js';
import {
  hasSharedWorkerRunInProgress,
  isWorkerRunCancelledError,
  stopTriggerOptimizerWorkerRuns,
} from '../services/simulatorWorkerRuns.js';
import {
  cancelTriggerOptimizerRun,
  hasTriggerOptimizerRunInProgress,
} from '../services/triggerOptimizerRunRegistry.js';
import { buildSimulationExtra, resolveAdjacentDifficultyTier, RUN_SCOPE_SINGLE } from '../services/simulationDomain.js';
import {
  isTriggerOptimizerResultRejected,
  planTriggerOptimizerRobustnessAppend,
  planTriggerOptimizerRobustnessRounds,
  planTriggerOptimizerVerificationAppend,
} from '../services/triggerOptimizerScoring.js';
import { buildTriggerChangeDescriptor, sanitizeTriggerMap } from '../services/triggerMapper.js';
import { normalizeParallelWorkerLimit } from '../services/queueScoring.js';
import { clamp, deepClone, isPlainObject } from '../services/utils.js';
import { effectScope, toRaw, watch } from 'vue';

const trackedStores = new WeakSet();
const applyingStores = new WeakSet();

// WeakSet 的键必须取 store 的**原始对象**（toRaw）而不是 action 里的 this 本身。
// Pinia 的 devtools 插件（dev 下对 options store 生效，deps/pinia.js 的
// patchActionForGrouping）会给**每次 action 调用**传一个新建的 `new Proxy(store)`
// 当 this，于是以对象身份为键的 WeakSet 永不命中：
//   ① 注册去重失效 → 每次 action 各建一个 watcher，越叠越多；
//   ② 遮蔽失效 → apply 的 $patch 内写 triggerMap 时（此刻 appliedInputSignature
//      还是空串）老的 watcher 仍判「输入变了」，把 sticky 的 results.stale 钉成
//      true → getter 恒真 → 应用后撤销按钮消失（2026-09-17 浏览器冒烟定案）。
// toRaw 对任意代理层（devtools 代理 / reactive 代理）都返回同一个原始 store。
function storeKey(store) {
  return toRaw(store);
}

// 队伍载荷（2026-09-27，设计 §59）：把设置里的 partyPlayerIds 解析成**冻结队友配置**（顺序按
// 勾选顺序；主角自身永不入队 —— 它在载荷里固定是 player1）。找不到的 id 静默跳过：玩家被删后
// 报告会因为指纹变化自然过期，这里不报错、也不阻断运行。
// 返回 deepClone 出来的普通对象（Pinia 的响应式代理不能进 worker 的序列化）。
export function resolveTriggerOptimizerTeammates(store) {
  const settings = store?.triggerOptimizer?.settings;
  const ids = Array.isArray(settings?.partyPlayerIds) ? settings.partyPlayerIds : [];
  if (ids.length === 0) return [];
  const activeId = String(store?.activePlayerId ?? '');
  const byId = new Map(
    (Array.isArray(store?.players) ? store.players : []).map((player) => [String(player.id ?? ''), player]),
  );
  const teammates = [];
  for (const id of ids) {
    const key = String(id ?? '');
    if (!key || key === activeId) continue;
    const player = byId.get(key);
    if (player) teammates.push(deepClone(player));
  }
  return teammates;
}

// 输入快照 + 指纹（过期判定的唯一口径，仿 foodOptimizerSnapshot）：
// 玩家配置全量 + 队友配置子集（2026-09-27，设计 §59）+ 模拟设置子集 + 优化器设置。
// 行情口径（consumable/drop/tax 模式）随快照外的 pricing 传入搜索，不参与指纹——与
// foodOptimizer 只跟踪食物价格同款取舍。队友进指纹 ⇒ 换队友 / 改队友配置都会让报告过期。
export function snapshotTriggerOptimizerInput(store) {
  return createOptimizerInput(store.activePlayer, store.simulationSettings, {
    settings: store.triggerOptimizer?.settings,
    teammates: resolveTriggerOptimizerTeammates(store),
  });
}

export function createTriggerOptimizerState() {
  return {
    settings: loadTriggerOptimizerSettingsFromStorage(),
    runtime: {
      isRunning: false,
      runId: 0,
      phase: 'idle',
      progress: 0,
      startedAt: null,
      elapsedSeconds: 0,
      error: '',
      cancelRequested: false,
      // ── 实时进度明细（页面据此显示「正在优化哪个技能 / 当前最佳分 / 预计剩余」）──
      // 上一版只上报 progress，用户看到一个孤立百分比，既不知道在干什么，也判断不了还要多久。
      abilityHrid: '',
      role: '',
      slotIndex: -1,
      round: 0,
      bestScore: null,
      evaluations: 0,
      totalEvaluations: 0,
      simulations: 0,
      totalSimulations: 0,
      // 完成通知：每次成功完成自增，UI watch 它弹「已完成」提示（同 runtime.completionNoticeId）。
      completionNoticeId: 0,
      // 换难度稳健性复核的运行态（2026-09-23，设计 §29）：独立于搜索的一次「2 次评估 × 6 场」，
      // 但共用同一套取消链（模块级注册表 + 专属 worker 停表），因此也参与运行互斥。
      // runId 与搜索同款：stop 时自增，让在途流程在下一个检查点自行退出、不再写回。
      robustness: {
        isRunning: false,
        runId: 0,
        phase: 'idle',
        progress: 0,
        difficultyTier: null,
        startedAt: null,
        elapsedSeconds: 0,
        error: '',
        cancelRequested: false,
      },
      // 追加复验的运行态（2026-09-24，设计 §31）：与稳健性复核同款的一次「2 次评估 × 6 场」，
      // 共用同一套取消链（模块级注册表 + 专属 worker 停表），因此也参与运行互斥。
      // 没有 difficultyTier：追加复验**不换难度**（沿用报告记录的难度），只回答「证据够不够」。
      verifyAppend: {
        isRunning: false,
        runId: 0,
        phase: 'idle',
        progress: 0,
        startedAt: null,
        elapsedSeconds: 0,
        error: '',
        cancelRequested: false,
      },
      // 「搜索 / 复核的服务调用在途」标志（2026-09-23，设计 §29.10）：**响应式锚点**。
      // 注册表与共享 worker 的运行标志是模块级普通变量（变化不触发重算），而它们的清空发生在
      // 异步收尾里 —— 晚于 stop 把 isRunning 置 false 的那一次渲染。计算属性于是会把「清理
      // 还没跑完」的一瞬间缓存下来，此后再无响应式变化让它重算：实测停止复核后「开始搜索」
      // 永久禁用，而实际标志早已清空。本标志在调用前后维护，覆盖那段收尾窗口，
      // 并让依赖它的计算属性在结算后再算一次（判定口径不变，见 triggerOptimizerBusy）。
      serviceRunInFlight: false,
    },
    // 报告落盘/恢复（2026-09-24，设计 §40）：刷新/崩溃/重进后最近一份报告自动回来
    //（版本闸门 + 形状闸门，脏数据静默回落空结果）。写入点是 trackResultStaleness 的
    // 持久化 watch，唯一删除点是 resetTriggerOptimizerResults。
    results: loadTriggerOptimizerReportFromStorage() || createEmptyResult(),
    // apply 时刻的触发器基线（撤销入口），结构 { playerId, triggerMap }。
    // 新一次运行开始时清空——它只属于「上一份报告被应用」这一段生命周期。
    baselineSnapshot: null,
  };
}

// 其他功能是否占用运行资源（不含触发器优化器自身）。
function otherRunsBusy(store) {
  return (
    Boolean(store.runtime?.isRunning) ||
    Boolean(store.isAnyQueueRunning) ||
    Boolean(store.advisor?.runtime?.isRunning) ||
    Boolean(store.advisor?.runtime?.scanInFlight) ||
    Boolean(store.foodOptimizer?.runtime?.isRunning) ||
    Boolean(store.pricing?.isLoading) ||
    hasSharedWorkerRunInProgress()
  );
}

export function triggerOptimizerBusy(store) {
  return (
    otherRunsBusy(store) ||
    Boolean(store.triggerOptimizer?.runtime?.isRunning) ||
    // 换难度复核（2026-09-23，设计 §29）也占用专属 worker：搜索期间复核不能开跑，
    // 复核期间同样不能开工新搜索 / 应用结果（两者都会改变它正在读的那份配置）。
    // 追加复验（2026-09-24，设计 §31）同理：它读的就是当前这份报告的两份配置快照。
    Boolean(store.triggerOptimizer?.runtime?.robustness?.isRunning) ||
    Boolean(store.triggerOptimizer?.runtime?.verifyAppend?.isRunning) ||
    // 服务调用在途（含 stop 之后的**收尾窗口**）：见 runtime.serviceRunInFlight 的说明 ——
    // 除覆盖那段窗口外，它还是模块级标志的**响应式锚点**（下面两个函数读的是非响应式变量，
    // 没有本项时调用方的计算属性会在收尾前缓存一次 busy=true 并永久卡住）。
    Boolean(store.triggerOptimizer?.runtime?.serviceRunInFlight) ||
    hasTriggerOptimizerRunInProgress() ||
    hasSharedWorkerRunInProgress()
  );
}

// ── 撤销前的「手工改动」检查（2026-09-19，设计 §19.6）────────────────────────
// 只比较**被优化的技能**的触发器条目：撤销只覆盖这些键，食物/饮品键与其它技能不参与。
// 两侧都过 sanitizeTriggerMap 归一化后再比 —— 写回路径（apply）写的就是 sanitize 后的值，
// 比较基准必须同口径（否则归一化差异会被误判成「被手改」）。
function pickSanitizedTriggers(map, hrids) {
  const source = isPlainObject(map) ? map : {};
  const picked = {};
  for (const hrid of hrids) {
    if (!Object.prototype.hasOwnProperty.call(source, hrid)) continue;
    // null = 「应用时该键被删除」（default 态），与「键不存在」等价——必须归一化掉，
    // 否则「删键型改动」会被自己判成「被手改」，撤销永远被拒。
    if (source[hrid] == null) continue;
    picked[hrid] = deepClone(source[hrid]);
  }
  return sanitizeTriggerMap(picked);
}

function hasOptimizedTriggersBeenEdited(store, snapshot) {
  const hrids = Array.isArray(snapshot?.abilityHrids) ? snapshot.abilityHrids : [];
  // 旧快照（本字段是 2026-09-19 才加的）没有基准 → 放行，与旧行为一致（不阻断撤销）。
  if (hrids.length === 0) return false;
  const player = store.players.find((entry) => String(entry.id) === String(snapshot.playerId)) ?? store.activePlayer;
  if (!player) return false;
  const current = pickSanitizedTriggers(player.triggerMap, hrids);
  const applied = pickSanitizedTriggers(snapshot.appliedTriggers, hrids);
  return JSON.stringify(current) !== JSON.stringify(applied);
}

// 输入变化 → 标记结果过期（仿 trackReportChanges）。apply 期间用 applyingStores
// 屏蔽：应用写回本身会改变指纹（triggerMap 是指纹的一部分），那一刻不该把刚应用的
// 结果判成过期（appliedInputSignature 在 $patch 内同步记录应用后的指纹）。
function trackResultStaleness(store) {
  const key = storeKey(store);
  if (trackedStores.has(key)) return;
  trackedStores.add(key);
  const scope = effectScope(true);
  // 双职责（函数名沿用旧名，调用点不动）：① 输入变化 → 标记结果过期（见上）；② 报告落盘
  // （2026-09-24，设计 §40）——results 任何变化（整体替换 :335/:428/:865 或原地写 stale、
  // appliedInputSignature、追加复验/稳健性复核结论）都把带 createdAt 的报告写进本地存储。
  // 空结果（createEmptyResult，无 createdAt）**不删**存储：开跑清空后崩溃/刷新要能找回上一份
  // ——持久化要防的正是这种丢法；唯一删除点是 resetTriggerOptimizerResults（导入新存档）。
  scope.run(() => {
    watch(
      [() => store.triggerOptimizerInputSignature, () => store.triggerOptimizer.results],
      () => {
        if (applyingStores.has(key)) return;
        const results = store.triggerOptimizer.results;
        if (results?.createdAt && store.triggerOptimizerReportStale) {
          results.stale = true;
        }
      },
      { flush: 'sync' },
    );
    watch(
      () => store.triggerOptimizer.results,
      (results) => {
        // 写入闸门（createdAt 必须是正时间戳）在存储层：空结果（createEmptyResult 自带
        // createdAt: 0）既不写也不删 —— 这就是「开跑清空后崩溃/刷新还能找回上一份」。
        persistTriggerOptimizerReportToStorage(results);
      },
      { deep: true },
    );
  });
  const dispose = store.$dispose.bind(store);
  store.$dispose = () => {
    store.stopTriggerOptimizer();
    scope.stop();
    trackedStores.delete(key);
    dispose();
  };
}

function resetRuntimeForError(runtime, messageKey) {
  runtime.isRunning = false;
  runtime.phase = 'error';
  runtime.error = messageKey;
}

export function createTriggerOptimizerActions({ loadPlayerMapperModule }) {
  return {
    setTriggerOptimizerSettings(settings) {
      trackResultStaleness(this);
      if (this.triggerOptimizer.runtime.isRunning) return false;
      const previous = this.triggerOptimizer.settings;
      const next = { ...previous, ...settings };
      // 时长自适应（2026-09-19，设计 §18.2）：预设 = 三个旋钮 + 一条时长规则
      // （rounds = max(基础轮数, 推荐轮数(时长))）。用户改「模拟时长」时，若当前三元组
      // 命中某档预设，就把该档在新时长下的有效轮数同步写回——否则会出现「下拉显示
      // 精细档、轮数却还是 24h 的口径」的状态漂移（resolveTriggerOptimizerPresetId
      // 会立刻判成「自定义」，用户看不懂为什么）。
      // 只认「仅改时长」的补丁：同一补丁里显式改了候选上限/搜索轮数/重复次数时，
      // 说明调用方（或用户）在自定义，绝不静默覆盖手填值。
      const patch = isPlainObject(settings) ? settings : {};
      const changesHours =
        Object.prototype.hasOwnProperty.call(patch, 'simulationHours') &&
        Number(patch.simulationHours) !== Number(previous.simulationHours);
      const changesTriple =
        Object.prototype.hasOwnProperty.call(patch, 'candidateLimit') ||
        Object.prototype.hasOwnProperty.call(patch, 'maxRounds') ||
        Object.prototype.hasOwnProperty.call(patch, 'rounds');
      if (changesHours && !changesTriple) {
        const presetSettings = getTriggerOptimizerPresetSettings(
          resolveTriggerOptimizerPresetId(previous),
          next.simulationHours,
        );
        if (presetSettings) next.rounds = presetSettings.rounds;
      }
      if (!isValidTriggerOptimizerSettings(next)) return false;
      const normalized = normalizeTriggerOptimizerSettings(next);
      if (JSON.stringify(normalized) === JSON.stringify(this.triggerOptimizer.settings)) return true;
      if (this.triggerOptimizer.results.createdAt) this.triggerOptimizer.results.stale = true;
      this.triggerOptimizer.settings = persistTriggerOptimizerSettingsToStorage(normalized);
      return true;
    },
    // 锁定 / 解锁某个技能：用户「根据结果快速调整优化策略」的主入口——
    // 已经满意的技能锁住，下一轮只搜索其余技能（省时，也避免把好结果改差）。
    // 走 setTriggerOptimizerSettings 的同一套归一化 + 校验 + 落盘 + 过期标记，
    // 因此锁定集合进入了输入指纹：改锁 → 既有报告立即标记过期（不会被误应用）。
    setTriggerOptimizerLockedAbilities(hrids) {
      return this.setTriggerOptimizerSettings({
        lockedAbilityHrids: Array.isArray(hrids) ? hrids.map((hrid) => String(hrid)).filter(Boolean) : [],
      });
    },
    // 队伍载荷（2026-09-27，设计 §59）：切换参与整队模拟的队友集合（玩家 id 数组；空 = 单人）。
    // 与锁定集合同款：走同一套归一化 + 校验 + 落盘 + 过期标记 ——「换队友」会让既有报告立即过期
    // （指纹里既有 id 列表、也有队友的配置快照），不会被误应用。
    setTriggerOptimizerPartyPlayers(playerIds) {
      return this.setTriggerOptimizerSettings({
        partyPlayerIds: Array.isArray(playerIds) ? playerIds.map((id) => String(id)).filter(Boolean) : [],
      });
    },
    async startTriggerOptimizer() {
      trackResultStaleness(this);
      const runtime = this.triggerOptimizer.runtime;
      if (runtime.isRunning) return;
      runtime.error = '';

      const settings = this.triggerOptimizer.settings;
      const activePlayer = this.activePlayer;
      const activePlayerId = String(this.activePlayerId);
      const imported = this.queue.importedProfileByPlayer?.[activePlayerId] === true;

      if (!activePlayer || !imported) {
        runtime.error = 'common:triggerOptimizer.requireImport';
        return;
      }
      // 候选生成与绝对值换算只覆盖 zone/dungeon（resolveOptimizerResources 不吃迷宫输入，
      // 见 triggerOptimizerSimulation 的注释），迷宫模式直接拒绝而非降级跑一份残缺结果。
      if (this.simulationSettings.mode === 'labyrinth') {
        runtime.error = 'common:triggerOptimizer.labyrinthUnsupported';
        return;
      }
      const useDungeon = Boolean(this.simulationSettings.useDungeon);
      const zoneHrid = useDungeon ? this.simulationSettings.dungeonHrid : this.simulationSettings.zoneHrid;
      if (!zoneHrid) {
        runtime.error = 'common:triggerOptimizer.requireZone';
        return;
      }
      if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
        runtime.error = 'common:triggerOptimizer.requireSingle';
        return;
      }
      if (triggerOptimizerBusy(this)) {
        runtime.error = 'common:triggerOptimizer.busy';
        return;
      }
      if (!isValidTriggerOptimizerSettings(settings)) {
        runtime.error = 'common:triggerOptimizer.invalidSettings';
        return;
      }

      const runId = runtime.runId + 1;
      const startedAt = Date.now();
      Object.assign(runtime, {
        isRunning: true,
        runId,
        phase: 'preparing',
        progress: 0,
        startedAt,
        elapsedSeconds: 0,
        cancelRequested: false,
      });
      this.triggerOptimizer.baselineSnapshot = null;
      this.triggerOptimizer.results = createEmptyResult();
      const active = () => runtime.runId === runId && runtime.isRunning;

      // 入口段兜底（同 startSimulation）：动态导入/玩家构建失败统一转入 runtime.error，
      // 而不是让异常逃逸成 unhandledrejection。
      let buildPlayersForSimulation;
      try {
        ({ buildPlayersForSimulation } = await loadPlayerMapperModule());
      } catch (loadError) {
        if (active()) resetRuntimeForError(runtime, 'common:simulation.errorLoadModule');
        return;
      }
      if (!active()) return;
      if (otherRunsBusy(this) || hasTriggerOptimizerRunInProgress()) {
        if (active()) resetRuntimeForError(runtime, 'common:triggerOptimizer.busy');
        return;
      }

      let playersToSim;
      try {
        playersToSim = buildPlayersForSimulation(this.players);
      } catch (buildError) {
        if (active()) resetRuntimeForError(runtime, 'common:simulation.errorBuildPlayerData');
        return;
      }
      if (playersToSim.length === 0) {
        if (active()) resetRuntimeForError(runtime, 'common:simulation.errorBuildPlayerData');
        return;
      }

      // optimizeTriggers 的入参：simulationSettings 取自首页模拟设置的子集
      // （payload 只读这些字段），extra 用 buildSimulationExtra 单独序列化。
      // 模拟时长以优化器自身的 settings.simulationHours 为准（本页有独立时长设置，
      // 与首页 simulationTimeHours 解耦，避免「改了时长却不生效」的假控件）。
      const simulationSettings = {
        mode: String(this.simulationSettings.mode || 'zone'),
        zoneHrid: String(this.simulationSettings.zoneHrid || ''),
        dungeonHrid: String(this.simulationSettings.dungeonHrid || ''),
        useDungeon,
        difficultyTier: this.simulationSettings.difficultyTier,
        simulationTimeHours: Math.max(1, Number(settings.simulationHours || 24)),
      };
      const input = {
        playerConfig: deepClone(activePlayer),
        // 队伍载荷（2026-09-27，设计 §59）：冻结队友配置随搜索一起进模拟（口径 A：只改主角触发器）。
        // 空数组 = 现状单人载荷，行为逐值不变。
        teammates: resolveTriggerOptimizerTeammates(this),
        simulationSettings,
        extra: buildSimulationExtra(this.simulationSettings),
        weights: deepClone(settings.objectiveWeights),
        settings: normalizeTriggerOptimizerSettings(settings),
        pricing: { pricingOptions: deepClone(createProfitPricingOptions(this.pricing)) },
        parallelWorkerLimit: normalizeParallelWorkerLimit(
          this.queueRuntime?.parallelWorkerLimit,
          this.queueParallelWorkerHardMax,
        ),
        parallelWorkerHardMax: this.queueParallelWorkerHardMax,
        // 计时原点交给搜索层：报告/进度上报的 elapsedSeconds 与页面「已用时间」从此同口径
        //（都从点击「开始搜索」算起），跑完时数字不再回缩。
        startedAt,
      };

      const inputSignature = this.triggerOptimizerInputSignature;
      try {
        const { optimizeTriggers } = await import('../services/triggerOptimizerSearch.js');
        if (!active()) return;
        if (otherRunsBusy(this) || hasTriggerOptimizerRunInProgress()) {
          resetRuntimeForError(runtime, 'common:triggerOptimizer.busy');
          return;
        }

        // 服务调用在途（含 stop 之后的收尾窗口）：见 runtime.serviceRunInFlight 的说明。
        runtime.serviceRunInFlight = true;
        const result = await optimizeTriggers(input, {
          onProgress: (update) => {
            if (runtime.runId !== runId) return;
            runtime.phase = String(update?.phase || runtime.phase);
            runtime.progress = clamp(Number(update?.progress || 0), 0, 1);
            runtime.elapsedSeconds = Number(update?.elapsedSeconds || runtime.elapsedSeconds);
            // 进度明细照单收下：搜索层现在会上报当前槽位/技能/轮次与实时最佳分。
            runtime.abilityHrid = String(update?.abilityHrid || '');
            runtime.role = String(update?.role || '');
            runtime.slotIndex = Number.isInteger(update?.slotIndex) ? update.slotIndex : -1;
            runtime.round = Number(update?.round || 0);
            runtime.bestScore = Number.isFinite(Number(update?.bestScore)) ? Number(update.bestScore) : null;
            runtime.evaluations = Number(update?.evaluations || 0);
            runtime.totalEvaluations = Number(update?.totalEvaluations || 0);
            runtime.simulations = Number(update?.simulations || 0);
            runtime.totalSimulations = Number(update?.totalSimulations || 0);
          },
          onCancel: () => {
            if (runtime.runId === runId) runtime.cancelRequested = true;
          },
        });
        if (runtime.runId !== runId) return;

        this.triggerOptimizer.results = {
          ...result,
          inputSignature,
          appliedInputSignature: '',
          createdAt: Date.now(),
          stale: false,
        };
        runtime.phase = result.cancelled ? 'cancelled' : result.error ? 'error' : 'done';
        runtime.progress = 1;
        runtime.elapsedSeconds = Number(result.elapsedSeconds || runtime.elapsedSeconds);
        runtime.error = String(result.error || '');
        runtime.cancelRequested = Boolean(result.cancelled);
        if (!result.cancelled && !result.error) {
          runtime.completionNoticeId += 1;
        }
      } catch (error) {
        // 取消不算失败：optimizeTriggers 内部把取消收敛成 result.cancelled，
        // 只有真正的失败才会重新抛出（isWorkerRunCancelledError 为防御性兜底）。
        if (active() && !isWorkerRunCancelledError(error)) {
          runtime.error = error?.message || String(error);
          runtime.phase = 'error';
        }
      } finally {
        // ⚠️ 必须在这里清（而不是在 stop 里）：服务层的清理（注册表注销 / worker 停表）发生在
        // 异步收尾里，本标志是页面「忙」计算属性的响应式锚点 —— 它的这一次写入会让计算属性在
        // **标志真正清空之后**再算一次（实测：缺少它时停止复核后「开始搜索」永久禁用）。
        runtime.serviceRunInFlight = false;
        if (runtime.runId === runId) {
          runtime.isRunning = false;
          runtime.cancelRequested = false;
        }
      }
    },
    stopTriggerOptimizer() {
      const runtime = this.triggerOptimizer.runtime;
      const robustness = runtime.robustness;
      const verifyAppend = runtime.verifyAppend;
      const robustnessRunning = Boolean(robustness?.isRunning);
      const verifyAppendRunning = Boolean(verifyAppend?.isRunning);
      if (!runtime.isRunning && !robustnessRunning && !verifyAppendRunning) return;
      // 复核 / 追加复验与搜索共用取消链（模块级注册表 + 专属 worker 停表）：stop 是唯一入口，
      // 三个都停。先按各自 runId 复位 —— 在途流程的收尾回调据此识别「本轮已作废」。
      if (robustnessRunning) {
        robustness.cancelRequested = true;
        cancelTriggerOptimizerRun();
        stopTriggerOptimizerWorkerRuns();
        robustness.runId += 1;
        robustness.isRunning = false;
        robustness.phase = 'cancelled';
        robustness.progress = 0;
      }
      if (verifyAppendRunning) {
        verifyAppend.cancelRequested = true;
        cancelTriggerOptimizerRun();
        stopTriggerOptimizerWorkerRuns();
        verifyAppend.runId += 1;
        verifyAppend.isRunning = false;
        verifyAppend.phase = 'cancelled';
        verifyAppend.progress = 0;
      }
      if (!runtime.isRunning) return;
      runtime.cancelRequested = true;
      cancelTriggerOptimizerRun();
      stopTriggerOptimizerWorkerRuns();
      // 搜索的收尾回调按 runId 复位；若尚在准备阶段（模块级 activeRun 还未建立），
      // runId 自增让在途的 start 流程在下一个检查点自行退出。
      runtime.runId += 1;
      runtime.isRunning = false;
      runtime.phase = 'cancelled';
      runtime.progress = 0;
    },
    // 换难度稳健性复核（2026-09-23，设计 §29；两态编排 2026-09-26，设计 §51）：触发器写的是
    // **全局技能配置**，而搜索只在「一个区域 + 一个难度」上评估过 —— 结论可能只在那一个难度成立。
    // 本动作把报告里的「最优配置 vs 搜索起点配置」搬到相邻难度上做一次配对评估（独立盐种子、
    // 2 次评估 × 自适应 6~12 轮，见设计 §49），回答「换个难度这笔提升还成立吗」。只读：不写玩家
    // 配置，不动报告主体。
    // 两态编排（§51）：报告**已有**复核结论时，再点 = 换盐追加（新样本与首跑样本合并重检，写回
    // 合并结论与 attempts 留档）——旧口径的同盐复跑被实测证伪（逐值相同的样本、信息增量 0，
    // 见 §51 装置）；首跑语义不变（§49 路径）。
    async runTriggerOptimizerRobustness() {
      const runtime = this.triggerOptimizer.runtime;
      const robustness = runtime.robustness;
      if (runtime.isRunning || robustness.isRunning) return false;
      robustness.error = '';

      const results = this.triggerOptimizer.results;
      if (!results?.createdAt) {
        robustness.error = 'common:triggerOptimizer.noResults';
        return false;
      }
      // 报告必须同时带「最优」与「搜索起点」两份配置：后者是 2026-09-23 才加进报告的，
      // 旧报告要请用户重跑一次（比猜一个起点配置去复核更诚实）。
      if (!isPlainObject(results.bestTriggerMap) || !isPlainObject(results.baselineTriggerMap)) {
        robustness.error = 'common:triggerOptimizer.robustnessMissingBaseline';
        return false;
      }
      const scope = isPlainObject(results.evaluationScope) ? results.evaluationScope : {};
      // 目标难度：追加态沿用**首跑复核记录的难度**（追加的语义 = 同一难度的结论再用新样本加固；
      // 报告未变时它与相邻难度反解同值，以记录为准可杜绝 scope 口径演化后悄悄换难度）；首跑态
      // 照旧取报告适用范围的相邻难度（优先 +1，已在最高难度则退回 −1，见 simulationDomain）。
      const previousRobustness = isPlainObject(results.robustness) ? results.robustness : null;
      const recordedTier = Math.floor(Number(previousRobustness?.difficultyTier));
      const targetTier =
        Number.isFinite(recordedTier) && recordedTier >= 0
          ? recordedTier
          : resolveAdjacentDifficultyTier(scope.zoneHrid, scope.difficultyTier);
      if (targetTier == null) {
        robustness.error = 'common:triggerOptimizer.robustnessUnavailable';
        return false;
      }
      if (triggerOptimizerBusy(this)) {
        robustness.error = 'common:triggerOptimizer.busy';
        return false;
      }

      const settings = this.triggerOptimizer.settings;
      const useDungeon = scope.useDungeon === true;
      const simulationSettings = {
        mode: 'zone',
        zoneHrid: useDungeon ? '' : String(scope.zoneHrid || ''),
        dungeonHrid: useDungeon ? String(scope.zoneHrid || '') : '',
        useDungeon,
        // 相邻难度：优先 +1（更难），已在最高难度则退回 −1（判定见 simulationDomain）。
        difficultyTier: targetTier,
        // 时长取报告当时的时长，缺值时回落到当前设置：复核的唯一变量是难度。
        simulationTimeHours: Math.max(1, Number(scope.simulationHours) || Number(settings.simulationHours) || 24),
      };
      // 追加态（§51）：合并重检的原料 = 首跑复核的逐轮样本；缺 samples（旧报告 / 退化结构）就
      // 无从合并 —— 明确报错请用户重跑搜索，而不是猜一份样本去追加。
      const appendMode = Boolean(previousRobustness);
      const previousBaselineSamples = previousRobustness?.baselineMetrics?.samples;
      const previousBestSamples = previousRobustness?.bestMetrics?.samples;
      if (
        appendMode &&
        (!Array.isArray(previousBaselineSamples) ||
          !Array.isArray(previousBestSamples) ||
          previousBaselineSamples.length === 0 ||
          previousBaselineSamples.length !== previousBestSamples.length)
      ) {
        robustness.error = 'common:triggerOptimizer.robustnessAppendMissing';
        return false;
      }
      // attempt 递进（首跑没有 attempts → 第一次追加 = 1）：它进种子盐（`.r{attempt}`），保证每次
      // 追加的样本互不相交、也与首跑的 robustness 盐不相交（理由见 triggerOptimizerDomain 的种子集说明）。
      const attempt = (Array.isArray(previousRobustness?.attempts) ? previousRobustness.attempts.length : 0) + 1;
      // 执行计划（纯函数；页面入口旁那一行用的是同一个函数、同一份输入）：
      //   · 首跑（§49）= 用报告里的复验统计反解，保底 6 轮 / 上限 16 轮 / 20% 成本护栏；
      //   · 追加（§51）= 补到复核上限（实测解析率显著高于按需反解），带零差出口与两级护栏
      //     （单次 20% / 累计 40%；累计已花按 attempts 求和 —— 页面用同一个求和函数）。
      let plan = null;
      if (appendMode) {
        plan = planTriggerOptimizerRobustnessAppend(previousRobustness?.paired?.score, {
          maxRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
          wholeRunSimulations: Number(results.simulations) || 0,
          spentSimulations: resolveTriggerOptimizerAppendSpentSimulations(previousRobustness?.attempts),
        });
        // 零差出口 / 已达上限 / 预算用尽 → 一次模拟都不派：这三种情形追加都没有统计收益，白跑只是
        // 烧机器（与 verifyAppend 的早退同一处置原则）。分键顺序：零差是最强的「判不出」证据，
        // 其次「已到上限」，最后才是「预算不够」。
        if (plan && plan.plannedRounds < 1) {
          robustness.error = plan.zeroDiff
            ? 'common:triggerOptimizer.robustnessAppendZeroDiff'
            : plan.atCap
              ? 'common:triggerOptimizer.robustnessAppendAtCap'
              : plan.budgetLimited
                ? 'common:triggerOptimizer.robustnessAppendBudgetExhausted'
                : 'common:triggerOptimizer.robustnessAppendExhausted';
          return false;
        }
      } else {
        // 复核轮数自适应（2026-09-25，设计 §49）：反解不出来（旧报告 / 统计退化）时 plan = null ——
        // 省略 rounds，由服务层缺省 6 轮兜底（常量的事实源仍然只在服务层）。
        plan = planTriggerOptimizerRobustnessRounds(results.verification?.paired?.score, {
          maxRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
          wholeRunSimulations: Number(results.simulations) || 0,
        });
      }

      const input = {
        playerConfig: deepClone(this.activePlayer),
        // 队伍载荷（2026-09-27，设计 §59）：复核必须与搜索期**同载荷** —— 否则结论是在另一个
        // 载荷上得出的，与报告自证的适用范围不符。
        teammates: resolveTriggerOptimizerTeammates(this),
        simulationSettings,
        // extra 与搜索期同源（首页设置序列化）：换难度不该顺带换掉消耗品/掉落口径。
        extra: buildSimulationExtra(this.simulationSettings),
        weights: deepClone(settings.objectiveWeights),
        settings: normalizeTriggerOptimizerSettings(settings),
        pricing: { pricingOptions: deepClone(createProfitPricingOptions(this.pricing)) },
        bestTriggerMap: deepClone(results.bestTriggerMap),
        baselineTriggerMap: deepClone(results.baselineTriggerMap),
        // 追加态：首跑的复核记录（含逐轮样本）——服务层据此合并重检（§51）。
        ...(appendMode ? { previousRobustness: deepClone(previousRobustness) } : {}),
        startedAt: Date.now(),
      };

      const runId = robustness.runId + 1;
      Object.assign(robustness, {
        isRunning: true,
        runId,
        phase: 'preparing',
        progress: 0,
        difficultyTier: targetTier,
        startedAt: input.startedAt,
        elapsedSeconds: 0,
        cancelRequested: false,
      });
      // 旧结论保留到合并成功再覆盖（§51）：追加失败/取消 = 「什么都没追加」，结论字段由服务层
      // 原样带回；这里不再开局清空（旧口径会把失败时的结论也一并丢掉）。
      const active = () => robustness.runId === runId && robustness.isRunning;

      try {
        const { appendTriggerOptimizerRobustness, verifyTriggerOptimizerRobustness } =
          await import('../services/triggerOptimizerSearch.js');
        if (!active()) return false;
        if (otherRunsBusy(this) || hasTriggerOptimizerRunInProgress()) {
          if (active()) robustness.error = 'common:triggerOptimizer.busy';
          return false;
        }
        // 服务调用在途（含 stop 之后的收尾窗口）：见 runtime.serviceRunInFlight 的说明。
        runtime.serviceRunInFlight = true;
        const onProgress = (update) => {
          if (robustness.runId !== runId) return;
          robustness.phase = String(update?.phase || robustness.phase);
          robustness.progress = clamp(Number(update?.progress || 0), 0, 1);
          robustness.elapsedSeconds = Number(update?.elapsedSeconds || 0);
        };
        const outcome = appendMode
          ? await appendTriggerOptimizerRobustness(input, {
              attempt,
              targetTier,
              rounds: plan ? plan.plannedRounds : undefined,
              // 计划快照一并留档（§51）：报告要能回答「这次补了几轮、零差/上限/护栏有没有咬住」。
              // plan 为 null（统计退化）时不带 —— 服务层缺省口径兜底。
              plan: plan || undefined,
              onProgress,
            })
          : await verifyTriggerOptimizerRobustness(input, {
              targetTier,
              rounds: plan ? plan.plannedRounds : undefined,
              // 计划快照一并留档（2026-09-25，设计 §49）：报告要能回答「这次跑了几轮、依据是什么、
              // 上限/成本护栏有没有咬住」。plan 为 null 时不带 —— 服务层缺省口径与今天一致。
              plan: plan || undefined,
              onProgress,
            });
        if (robustness.runId !== runId) return false;
        if (outcome.cancelled) {
          robustness.phase = 'cancelled';
          return false;
        }
        // 合并成功（或首跑完成）才覆盖结论：追加失败/取消时服务层原样带回旧字段（「什么都没追加」）。
        results.robustness = { ...outcome, createdAt: Date.now() };
        robustness.phase = 'done';
        robustness.progress = 1;
        robustness.elapsedSeconds = Number(outcome.elapsedSeconds || robustness.elapsedSeconds);
        return true;
      } catch (error) {
        // 取消不算失败（stop 已经把 runId 复位 → active() 为假）；只有真正的失败才写错误。
        if (active() && !isWorkerRunCancelledError(error)) {
          robustness.error = error?.message || String(error);
          robustness.phase = 'error';
        }
        return false;
      } finally {
        // 与搜索同款：本标志是「忙」计算属性的响应式锚点，必须在服务层清理完成之后才置回。
        runtime.serviceRunInFlight = false;
        if (robustness.runId === runId) {
          robustness.isRunning = false;
          robustness.cancelRequested = false;
        }
      }
    },
    // 追加复验（2026-09-24，设计 §31）：首轮复验判「未达显著」≠「没有提升」，只是「样本不足」。
    // 本动作再采一组**独立盐**的新样本，与首轮样本合并后重新检验，把不确定结论追到转正 / 判负。
    // 与换难度稳健性复核的区别：**不换难度**（沿用报告记录的范围），回答的是「证据够不够」。
    // 只读：不写玩家配置、不动报告主体，只更新当前报告的 verification（含 attempts 留档）。
    async runTriggerOptimizerVerificationAppend() {
      const runtime = this.triggerOptimizer.runtime;
      const verifyAppend = runtime.verifyAppend;
      if (runtime.isRunning || runtime.robustness?.isRunning || verifyAppend.isRunning) return false;
      verifyAppend.error = '';

      const results = this.triggerOptimizer.results;
      if (!results?.createdAt) {
        verifyAppend.error = 'common:triggerOptimizer.noResults';
        return false;
      }
      // 合并重检的原料 = 首轮复验的逐轮样本。缺了（旧报告 / 复验退化成失败结构）就无从合并 ——
      // 明确报错请用户重跑搜索，而不是猜一份样本去追加。
      const verification = results.verification;
      const baselineSamples = verification?.baselineMetrics?.samples;
      const bestSamples = verification?.bestMetrics?.samples;
      if (
        !isPlainObject(verification) ||
        !Array.isArray(baselineSamples) ||
        !Array.isArray(bestSamples) ||
        baselineSamples.length === 0 ||
        baselineSamples.length !== bestSamples.length
      ) {
        verifyAppend.error = 'common:triggerOptimizer.verifyAppendMissing';
        return false;
      }
      // 报告必须带「最优 / 搜索起点」两份配置快照与结论适用范围（同一批 2026-09-23 加进报告）：
      // 追加要跑的正是这两份配置，而且必须跑在**报告当时的**范围上 —— 换了图/难度/时长再追加，
      // 新样本就与首轮样本不同源，合并出来的结论没有意义。旧报告请用户重跑一次搜索。
      const scope = isPlainObject(results.evaluationScope) ? results.evaluationScope : null;
      if (!isPlainObject(results.bestTriggerMap) || !isPlainObject(results.baselineTriggerMap) || !scope?.zoneHrid) {
        verifyAppend.error = 'common:triggerOptimizer.robustnessMissingBaseline';
        return false;
      }
      if (triggerOptimizerBusy(this)) {
        verifyAppend.error = 'common:triggerOptimizer.busy';
        return false;
      }

      const settings = this.triggerOptimizer.settings;
      const useDungeon = scope.useDungeon === true;
      const simulationSettings = {
        mode: 'zone',
        zoneHrid: useDungeon ? '' : String(scope.zoneHrid || ''),
        dungeonHrid: useDungeon ? String(scope.zoneHrid || '') : '',
        useDungeon,
        // 不换难度：沿用报告记录的难度（换难度是换难度稳健性复核回答的问题）。
        difficultyTier: Math.max(0, Math.floor(Number(scope.difficultyTier) || 0)),
        // 时长取报告当时的时长，缺值时回落到当前设置：这一轮唯一的变量是样本量。
        simulationTimeHours: Math.max(1, Number(scope.simulationHours) || Number(settings.simulationHours) || 24),
      };
      // attempt 递进（首轮复验没有 attempts → 第一次追加 = 1）：它进种子盐，保证每次追加的样本
      // 互不相交、也与首轮复验的 verify 盐不相交（理由见 triggerOptimizerDomain 的种子集说明）。
      const attempt = (Array.isArray(verification.attempts) ? verification.attempts.length : 0) + 1;
      // 追加轮数自适应（2026-09-25，设计 §47；累计护栏 2026-09-26，设计 §50 B-2）：轮数不再是常量
      // —— 由当前样本反解「要多少轮才能判出明确结论」，按保底 12 轮 / 上限 24 轮钳一次，再用
      // 成本护栏（单次 ≤ 整轮 20%；累计已花 + 本次 ≤ 整轮 40%）兜底。计划函数与页面入口旁那一行
      // 用的是同一个（纯函数 + 同一份输入），上屏的轮数与实际追加的轮数同源。反解不出来（旧报告 /
      // 退化结构）→ plan 为 null，保持今天的固定 6 轮（服务层缺省）。
      const plan = planTriggerOptimizerVerificationAppend(verification?.paired?.score, {
        maxRounds: TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
        wholeRunSimulations: Number(results.simulations) || 0,
        // 累计已花按 attempts 求和（只数追加部分，不含首轮复验）—— 页面那一行用同一个函数，
        // 「文案里的预算」与「实际扣的预算」不会分裂成两套（§50）。
        spentSimulations: resolveTriggerOptimizerAppendSpentSimulations(verification?.attempts),
      });
      // 结论已明确 / 预算用尽 / 上限也不够 → 一次模拟都不派：这三种情形追加都没有统计收益，
      // 白跑只是烧机器（与 §45 capped 分支同一处置原则：宁可如实上屏，也不做做不到的事）。
      // 分键顺序（§50 B-2）：预算钳到 0（单次或累计）优先于 capped —— 零差案例（B-1 之后 plan
      // 是 capped）在预算耗尽时，如实说的是「预算用尽」而不是「上限也不够」。
      if (plan && (plan.decisive || plan.plannedRounds < 1)) {
        verifyAppend.error = plan.decisive
          ? 'common:triggerOptimizer.verifyAppendDecisive'
          : plan.budgetLimited
            ? 'common:triggerOptimizer.verifyAppendBudgetExhausted'
            : 'common:triggerOptimizer.verifyAppendExhausted';
        return false;
      }
      const input = {
        playerConfig: deepClone(this.activePlayer),
        // 队伍载荷（2026-09-27，设计 §59）：追加复验同样与搜索期同载荷（见复核处的说明）。
        teammates: resolveTriggerOptimizerTeammates(this),
        simulationSettings,
        // extra 与搜索期同源（首页设置序列化）：追加不该顺带换掉消耗品/掉落口径。
        extra: buildSimulationExtra(this.simulationSettings),
        weights: deepClone(settings.objectiveWeights),
        settings: normalizeTriggerOptimizerSettings(settings),
        pricing: { pricingOptions: deepClone(createProfitPricingOptions(this.pricing)) },
        bestTriggerMap: deepClone(results.bestTriggerMap),
        baselineTriggerMap: deepClone(results.baselineTriggerMap),
        verification: deepClone(verification),
        startedAt: Date.now(),
      };

      const runId = verifyAppend.runId + 1;
      Object.assign(verifyAppend, {
        isRunning: true,
        runId,
        phase: 'preparing',
        progress: 0,
        startedAt: input.startedAt,
        elapsedSeconds: 0,
        cancelRequested: false,
      });
      const active = () => verifyAppend.runId === runId && verifyAppend.isRunning;

      try {
        const { appendTriggerOptimizerVerification } = await import('../services/triggerOptimizerSearch.js');
        if (!active()) return false;
        if (otherRunsBusy(this) || hasTriggerOptimizerRunInProgress()) {
          if (active()) verifyAppend.error = 'common:triggerOptimizer.busy';
          return false;
        }
        // 服务调用在途（含 stop 之后的收尾窗口）：见 runtime.serviceRunInFlight 的说明。
        runtime.serviceRunInFlight = true;
        // 轮数走上面的自适应计划（设计 §47）：plan 为 null（旧报告）时省略该项，由服务层缺省
        // （TRIGGER_OPTIMIZER_VERIFY_ROUNDS = 6）兜底 —— 常量的事实源仍然只在服务层。
        const outcome = await appendTriggerOptimizerVerification(input, {
          attempt,
          rounds: plan ? plan.plannedRounds : undefined,
          // 计划快照一并留档（2026-09-25，设计 §48）：报告要能回答「这次补了几轮、依据是什么、
          // 上限/护栏有没有咬住」。plan 为 null（旧报告 / 反解不出来）时不带 —— 服务层缺省口径
          // 与今天一致，报告里也不会留下没有依据的字段。
          plan: plan || undefined,
          onProgress: (update) => {
            if (verifyAppend.runId !== runId) return;
            verifyAppend.phase = String(update?.phase || verifyAppend.phase);
            verifyAppend.progress = clamp(Number(update?.progress || 0), 0, 1);
            verifyAppend.elapsedSeconds = Number(update?.elapsedSeconds || 0);
          },
        });
        if (verifyAppend.runId !== runId) return false;
        if (outcome.cancelled) {
          verifyAppend.phase = 'cancelled';
          return false;
        }
        // 只有真的合并成功才写回：取消时旧结论原样保留（「什么都没追加」，见服务层返回值口径）。
        results.verification = outcome;
        verifyAppend.phase = 'done';
        verifyAppend.progress = 1;
        verifyAppend.elapsedSeconds = Number(outcome.elapsedSeconds || verifyAppend.elapsedSeconds);
        return true;
      } catch (error) {
        // 取消不算失败（stop 已把 runId 复位 → active() 为假）；只有真正的失败才写错误。
        if (active() && !isWorkerRunCancelledError(error)) {
          verifyAppend.error = error?.message || String(error);
          verifyAppend.phase = 'error';
        }
        return false;
      } finally {
        // 与搜索同款：本标志是「忙」计算属性的响应式锚点，必须在服务层清理完成之后才置回。
        runtime.serviceRunInFlight = false;
        if (verifyAppend.runId === runId) {
          verifyAppend.isRunning = false;
          verifyAppend.cancelRequested = false;
        }
      }
    },
    applyTriggerOptimizerResult() {
      trackResultStaleness(this);
      const runtime = this.triggerOptimizer.runtime;
      const results = this.triggerOptimizer.results;
      if (runtime.isRunning || triggerOptimizerBusy(this)) return false;
      if (!results?.createdAt || !isPlainObject(results.bestTriggerMap)) {
        runtime.error = 'common:triggerOptimizer.noResults';
        return false;
      }
      if (this.triggerOptimizerReportStale) {
        runtime.error = 'common:triggerOptimizer.stale';
        return false;
      }
      // 复验否决：独立复验（另一组种子 × 6 轮）判「最优配置比基线显著更差」时，
      // 这份报告不允许被应用 —— 搜索期的正分只是那组种子的运气（实测：标准档在
      // 已调优角色上采纳 +0.00078 分的改动，复验 p=0.022 判它更差）。判定口径与
      // 页面按钮同源（scoring.isTriggerOptimizerResultRejected），不各判一次。
      if (isTriggerOptimizerResultRejected(results)) {
        runtime.error = 'common:triggerOptimizer.applyBlockedNegative';
        return false;
      }
      const player = this.activePlayer;
      if (!player) return false;

      // 只覆盖「参与优化的技能」键：bestTriggerMap 里这些键的值是搜索终态
      // （default 态 = 无键 → 从玩家配置里删键，设计 §10.3）；食物/饮品键一律不动。
      const optimizedHrids = (Array.isArray(results.perAbilityChoices) ? results.perAbilityChoices : [])
        .map((choice) => String(choice?.abilityHrid || ''))
        .filter(Boolean);
      if (optimizedHrids.length === 0) return false;

      const beforeTriggerMap = isPlainObject(player.triggerMap) ? player.triggerMap : {};
      const nextTriggerMap = { ...beforeTriggerMap };
      for (const hrid of optimizedHrids) {
        if (Object.prototype.hasOwnProperty.call(results.bestTriggerMap, hrid)) {
          nextTriggerMap[hrid] = deepClone(results.bestTriggerMap[hrid]);
        } else {
          delete nextTriggerMap[hrid];
        }
      }

      applyingStores.add(storeKey(this));
      try {
        this.$patch(() => {
          player.triggerMap = sanitizeTriggerMap(nextTriggerMap);
          // 撤销门禁的判定基准（2026-09-19，设计 §19.6）：应用后这些技能键「应该长什么样」。
          // 撤销只覆盖这些键，所以「会不会踩掉手工改动」只看它们——不再拿整份输入指纹的
          // stale 一刀切（切地图/难度/时长同样会 stale，但撤销并不会踩到这些东西）。
          const appliedTriggers = {};
          for (const hrid of optimizedHrids) {
            appliedTriggers[hrid] = Object.prototype.hasOwnProperty.call(player.triggerMap, hrid)
              ? deepClone(player.triggerMap[hrid])
              : null; // null = 该键在应用时被删除（default 态）
          }
          this.triggerOptimizer.baselineSnapshot = {
            playerId: String(this.activePlayerId),
            triggerMap: deepClone(beforeTriggerMap),
            abilityHrids: optimizedHrids.slice(),
            appliedTriggers,
          };
          results.appliedInputSignature = this.triggerOptimizerInputSignature;
          results.changeDescriptors = optimizedHrids
            .map((hrid) => buildTriggerChangeDescriptor(beforeTriggerMap, player.triggerMap, hrid))
            .filter(Boolean);
        });
      } finally {
        applyingStores.delete(storeKey(this));
      }
      return true;
    },
    revertTriggerOptimizerChanges() {
      trackResultStaleness(this);
      const runtime = this.triggerOptimizer.runtime;
      const snapshot = this.triggerOptimizer.baselineSnapshot;
      // 与 applyTriggerOptimizerResult 同款闸门（2026-09-27）：撤销同样整体写回玩家
      // triggerMap，任何其它在途任务（队列 / 顾问 / 食物优化器 / 定价 / 共享 worker /
      // 复核 / 追加复验）正在读这份配置时都不允许写穿。页面 canRevert 一直按此口径
      // 禁用按钮，这里是把同一契约落到 store 层，避免新入口（快捷键等）绕过。
      if (runtime.isRunning || triggerOptimizerBusy(this)) {
        runtime.error = 'common:triggerOptimizer.busy';
        return false;
      }
      if (!snapshot) {
        runtime.error = 'common:triggerOptimizer.noChangesToRevert';
        return false;
      }
      // 撤销门禁（2026-09-19 收窄，设计 §19.6）：只拦「被优化的技能触发器在应用后被手改」——
      // 撤销会把那些键整条覆盖回应用前，手工改动会被踩掉。旧实现用整份输入指纹的 stale
      // 一刀切，切地图/难度/时长同样会 stale，撤销按钮凭空消失，而那些改动撤销并不会碰到。
      if (hasOptimizedTriggersBeenEdited(this, snapshot)) {
        runtime.error = 'common:triggerOptimizer.revertBlockedEdited';
        return false;
      }
      const player = this.players.find((entry) => String(entry.id) === String(snapshot.playerId)) ?? this.activePlayer;
      if (!player) return false;

      applyingStores.add(storeKey(this));
      try {
        this.$patch(() => {
          player.triggerMap = sanitizeTriggerMap(deepClone(snapshot.triggerMap));
          this.triggerOptimizer.baselineSnapshot = null;
          this.triggerOptimizer.results.appliedInputSignature = '';
          this.triggerOptimizer.results.changeDescriptors = [];
        });
      } finally {
        applyingStores.delete(storeKey(this));
      }
      return true;
    },
    // 导入新存档 / 恢复快照时重置会话内结果（仿 advisor 的导入重置口径）：
    // 玩家配置整体被替换，既有报告的输入签名不再对应任何当前配置。
    resetTriggerOptimizerResults() {
      // 搜索**或**复核**或**追加复验任在跑都先停掉：三者共用注册表与专属 worker，且复核/追加
      // 结束后会往报告里写结果 —— 旧实现只检查 isRunning（搜索），会把在途复核留在新报告上
      // （2026-09-23）；追加复验（2026-09-24，设计 §31）同理。
      if (
        this.triggerOptimizer.runtime.isRunning ||
        this.triggerOptimizer.runtime.robustness?.isRunning ||
        this.triggerOptimizer.runtime.verifyAppend?.isRunning
      ) {
        this.stopTriggerOptimizer();
      }
      this.triggerOptimizer.results = createEmptyResult();
      // 唯一显式删除点（设计 §40）：导入新存档 ⇒ 旧报告作废，不再兜底恢复。
      clearTriggerOptimizerReportFromStorage();
      this.triggerOptimizer.baselineSnapshot = null;
      this.triggerOptimizer.runtime.error = '';
      this.triggerOptimizer.runtime.phase = 'idle';
      this.triggerOptimizer.runtime.progress = 0;
      // 复核 / 追加复验的运行态随报告一起作废（stop 只处理「正在跑」的情形，这里的错误/进度标注
      // 属于上一份报告，留着会在新存档上显示一条无主的复核结论）。
      const robustness = this.triggerOptimizer.runtime.robustness;
      if (robustness && !robustness.isRunning) {
        robustness.error = '';
        robustness.phase = 'idle';
        robustness.progress = 0;
        robustness.difficultyTier = null;
        robustness.elapsedSeconds = 0;
      }
      const verifyAppend = this.triggerOptimizer.runtime.verifyAppend;
      if (verifyAppend && !verifyAppend.isRunning) {
        verifyAppend.error = '';
        verifyAppend.phase = 'idle';
        verifyAppend.progress = 0;
        verifyAppend.elapsedSeconds = 0;
      }
    },
  };
}
