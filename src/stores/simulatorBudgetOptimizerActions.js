// 预算优化（Budget Optimizer）—— store actions（升级链模式 v4）。
//
// 职责：把搜索层（budgetOptimizerSearch.optimizeBudgetUpgrades 链模式）接入 Pinia：
//   startBudgetOptimizer           校验 → 冻结输入 → 链运行（onStep 渐进上屏 runtime.chainSteps）
//                                  → 报告写 results → 链结束自动写回主角（finalConfig）+ 整链撤销快照
//   stopBudgetOptimizer            取消链（注册表 + 专属 worker 停表）+ runId 自增 + 复位
//   applyBudgetChainResult         链结果写回（内部 action，start 收尾时调用；不对外）
//   revertBudgetOptimizerChanges   按快照回滚「被链涉及的键」（手改拒绝）
//   setBudgetOptimizerSettings     归一化 + 校验 + 落盘 + 标记结果过期
//   setBudgetOptimizerPartyPlayers 队友勾选（走设置同一套归一化/落盘/过期）
//   resetBudgetOptimizerResults    导入新存档 / 恢复快照时清空（唯一显式删除点）
//
// 互斥：budgetOptimizerBusy 汇总 store.runtime / queue / advisor / foodOptimizer /
// triggerOptimizer（含复核与追加复验）/ pricing / 共享 worker / 预算运行标志
//（模块级注册表 + 专属 worker 句柄）。上游 service 的口径不改。
//
// 报告过期：输入指纹（domain 的 createBudgetOptimizerInputSignature）变化即过期；
// 应用后用 appliedInputSignature 记录「应用时刻的输入」，使「应用 → 手改 → 再应用」
// 的过期判定与 trigger/food 同源。

import {
  clearBudgetOptimizerReportFromStorage,
  createProfitPricingOptions,
  loadBudgetOptimizerReportFromStorage,
  loadBudgetOptimizerSettingsFromStorage,
  persistBudgetOptimizerReportToStorage,
  persistBudgetOptimizerSettingsToStorage,
} from '../services/simulatorStorage.js';
import {
  createBudgetOptimizerInput,
  createBudgetOptimizerInputSignature,
  isValidBudgetOptimizerSettings,
  normalizeBudgetOptimizerSettings,
  BUDGET_OPTIMIZER_BUSY_ERROR,
  BUDGET_OPTIMIZER_REPORT_VERSION,
} from '../services/budgetOptimizerDomain.js';
import { cancelBudgetOptimizerRun, hasBudgetOptimizerRunInProgress } from '../services/budgetOptimizerRunRegistry.js';
import {
  hasBudgetOptimizerWorkerRunInProgress,
  hasSharedWorkerRunInProgress,
  isWorkerRunCancelledError,
  stopBudgetOptimizerWorkerRuns,
} from '../services/simulatorWorkerRuns.js';
import { buildSimulationExtra, RUN_SCOPE_SINGLE } from '../services/simulationDomain.js';
import { normalizeParallelWorkerLimit } from '../services/queueScoring.js';
import { clamp, deepClone, isPlainObject, normalizeBaselineSaleSide } from '../services/utils.js';
import { effectScope, toRaw, watch } from 'vue';

const trackedStores = new WeakSet();
const applyingStores = new WeakSet();

// WeakSet 的键必须取 store 的**原始对象**（toRaw）而不是 action 里的 this 本身。
// Pinia 的 devtools 插件（dev 下对 options store 生效）会给每次 action 调用传一个新建的
// `new Proxy(store)` 当 this，以对象身份为键的 WeakSet 永不命中：注册去重失效（每次 action
// 各建一个 watcher）且 apply 期间的遮蔽失效（写回玩家配置的那一刻老 watcher 把刚应用的结果
// 判成过期）——与 trigger 同款事故（2026-09-17 定案），toRaw 对任意代理层都返回同一个原始 store。
function storeKey(store) {
  return toRaw(store);
}

// 队伍载荷：把设置里的 partyPlayerIds 解析成**冻结队友配置**（顺序按勾选顺序；主角自身永不入队
// —— 它在载荷里固定是 player1）。找不到的 id 静默跳过：玩家被删后报告会因为指纹变化自然过期，
// 这里不报错、也不阻断运行。未导入的槽位同样跳过（2026-10-04 防幽灵队友）：players 槽位 2-5
// 常驻存在但默认是空配置（等级 1 / 无装备技能），只有 importedProfileByPlayer 标记为 true 的
// 槽位才有真数据 —— 勾选若指向未导入槽位（如刷新后勾选残留、而队友数据已丢），空配置队友
// 会静默混进整队模拟污染结果，这里直接过滤掉。返回 deepClone 出来的普通对象（Pinia 的
// 响应式代理不能进 worker 序列化）。
export function resolveBudgetOptimizerTeammates(store) {
  const settings = store?.budgetOptimizer?.settings;
  const ids = Array.isArray(settings?.partyPlayerIds) ? settings.partyPlayerIds : [];
  if (ids.length === 0) return [];
  const activeId = String(store?.activePlayerId ?? '');
  const importedByPlayer = store?.queue?.importedProfileByPlayer;
  const byId = new Map(
    (Array.isArray(store?.players) ? store.players : []).map((player) => [String(player.id ?? ''), player]),
  );
  const teammates = [];
  for (const id of ids) {
    const key = String(id ?? '');
    if (!key || key === activeId) continue;
    const player = byId.get(key);
    if (player && importedByPlayer?.[key] === true) teammates.push(deepClone(player));
  }
  return teammates;
}

// 输入快照 + 指纹（过期判定的唯一口径）：主角配置 + 队友配置子集 + 模拟设置子集 + 优化器设置
// + 抵扣口径 saleSide（2026-10-09 纳指纹，用户决策：口径切换改变净支出与剪枝，旧报告过期一次；
// consumable/drop/tax 行情模式仍不进指纹 —— 与 trigger/food 同款取舍）。
// 队友进指纹 ⇒ 换队友 / 改队友配置都会让报告过期。
export function snapshotBudgetOptimizerInput(store) {
  return createBudgetOptimizerInput(store.activePlayer, store.simulationSettings, {
    settings: store.budgetOptimizer?.settings,
    teammates: resolveBudgetOptimizerTeammates(store),
    // 与 startBudgetOptimizer 的运行入参同源（activeQueueState.settings），保证「跑出来的报告
    // 口径」与「过期判定口径」一致。
    saleSide: normalizeBaselineSaleSide(store.activeQueueState?.settings?.baselineSaleSide),
  });
}

// 空结果（开跑清空 / 无结果占位）：createdAt: 0 是「不是一份真报告」的通用闸门
// —— 存储层不落盘、apply 不认它（与 trigger 的 createEmptyResult 同款形状语义）。
// v2 链报告：steps / totalCost / stopReason / finalSnapshot；nextBest / plans / curve 已移除。
function createEmptyBudgetOptimizerResult() {
  return {
    version: BUDGET_OPTIMIZER_REPORT_VERSION,
    createdAt: 0,
    elapsedSeconds: 0,
    cancelled: false,
    stopReason: '',
    settings: null,
    baseline: null,
    // 链终复验（v4.1.1 报告的可选字段）：{ rounds, baseline: { metrics }, final: { metrics }, paired }；
    // v4.1 过渡形状 { metrics, deltaVsBaseline } 仅作旧报告兼容；空结果/旧报告为 null。
    verification: null,
    steps: [],
    totalCost: 0,
    remainingBudget: 0,
    finalSnapshot: null,
    finalConfig: null,
    diagnostics: null,
    inputSignature: '',
    appliedInputSignature: '',
    stale: false,
  };
}

export function createBudgetOptimizerState() {
  return {
    settings: loadBudgetOptimizerSettingsFromStorage(),
    runtime: {
      isRunning: false,
      runId: 0,
      // 链起点冻结的目标角色 id（memo 0366770566183632896）：链终写回按它解析玩家，
      // 运行中切换主角不会把本链的终点配置写到新主角身上。
      targetPlayerId: '',
      phase: 'idle',
      progress: 0,
      startedAt: null,
      elapsedSeconds: 0,
      error: '',
      cancelRequested: false,
      // 「被用户取消的世代」令牌（0 = 无）：stopBudgetOptimizer 在顶掉 runId 前记下被取消的
      // runId，迟到取消报告的放行判据（stoppedByUser）按世代匹配 —— cancelRequested 布尔只能
      // 表达「曾有取消请求」，无法区分报告属于哪一代。reset 与新一轮 start 都会把本字段清零。
      cancelledRunId: 0,
      // ── 实时进度明细（页面据此显示「正在做什么阶段 / 评估了多少」）──
      evaluated: 0,
      total: 0,
      // ── 链模式（v4）──
      // stepsDone：已完成步数（进度展示）。
      stepsDone: 0,
      // chainSteps：已完成步骤的渐进数组（onStep 逐条 push；「模拟完一步就能看这一步」的
      // 响应式锚点）。运行中不落盘（报告整体在链结束时一次写入，避免每步全量落盘的卡顿），
      // 结束后 UI 改读 results.steps。
      chainSteps: [],
      // 「搜索的服务调用在途」标志（**响应式锚点**，照 trigger 的 runtime.serviceRunInFlight）：
      // 注册表与 worker 句柄是模块级普通变量（变化不触发重算），而它们的清空发生在异步收尾里
      // —— 晚于 stop 把 isRunning 置 false 的那一次渲染。计算属性于是会把「清理还没跑完」的
      // 一瞬间缓存下来，此后再无响应式变化让它重算（实测：缺少它时停止后「开始」永久禁用）。
      // 本标志在调用前后维护，覆盖那段收尾窗口，并让依赖它的计算属性在结算后再算一次。
      serviceRunInFlight: false,
      completionNoticeId: 0,
    },
    // 报告落盘/恢复：刷新/崩溃/重进后最近一份报告自动回来（版本闸门 + 形状闸门，
    // 脏数据静默回落空结果）。写入点是 trackResultStaleness 的持久化 watch，
    // 唯一删除点是 resetBudgetOptimizerResults。
    results: loadBudgetOptimizerReportFromStorage() || createEmptyBudgetOptimizerResult(),
    // 逐步撤销栈：每应用一步入栈一条 { playerId, equipment, abilities, houseRooms, touched, applied }，
    // 撤销按钮每点一次弹出并恢复栈顶（可一直退到连续升级开始前）。跨搜索保留（单步迭代链
    // 「应用 → 自动重搜 → 再应用」要能整体回退），唯一清空点是导入新存档的 resetBudgetOptimizerResults。
    baselineSnapshots: [],
  };
}

// 其他功能是否占用运行资源（不含预算优化器自身）。
function otherRunsBusy(store) {
  return (
    Boolean(store.runtime?.isRunning) ||
    Boolean(store.isAnyQueueRunning) ||
    Boolean(store.advisor?.runtime?.isRunning) ||
    Boolean(store.advisor?.runtime?.scanInFlight) ||
    Boolean(store.foodOptimizer?.runtime?.isRunning) ||
    Boolean(store.triggerOptimizer?.runtime?.isRunning) ||
    // 触发器的换难度复核 / 追加复验与搜索共用专属 worker 与注册表（runtime.isRunning
    // 之外的两个子运行态）：它们运行时同样在占资源，预算优化必须一起让路。
    Boolean(store.triggerOptimizer?.runtime?.robustness?.isRunning) ||
    Boolean(store.triggerOptimizer?.runtime?.verifyAppend?.isRunning) ||
    Boolean(store.pricing?.isLoading) ||
    hasSharedWorkerRunInProgress()
  );
}

export function budgetOptimizerBusy(store) {
  return (
    otherRunsBusy(store) ||
    Boolean(store.budgetOptimizer?.runtime?.isRunning) ||
    // 服务调用在途（含 stop 之后的**收尾窗口**）：见 runtime.serviceRunInFlight 的说明 ——
    // 除覆盖那段窗口外，它还是模块级标志的**响应式锚点**（注册表 / worker 句柄是非响应式变量，
    // 没有本项时调用方的计算属性会在收尾前缓存一次 busy=true 并永久卡住）。
    Boolean(store.budgetOptimizer?.runtime?.serviceRunInFlight) ||
    hasBudgetOptimizerRunInProgress() ||
    hasSharedWorkerRunInProgress() ||
    hasBudgetOptimizerWorkerRunInProgress()
  );
}

// ── 撤销前的「手工改动」检查 ────────────────────────────────────────────
// 只比较「被方案涉及的键」：撤销只覆盖这些键，未被涉及的槽位/技能/房间的手改不参与
//（切地图/难度/时长同样会让报告 stale，但撤销并不会踩到这些东西 —— 不能一刀切拒绝）。
function pickTouchedSubset(player, touched) {
  const equipment = {};
  for (const slotKey of touched?.slots ?? []) {
    const value = player?.equipment?.[slotKey];
    equipment[slotKey] = value == null ? null : deepClone(value);
  }
  const abilities = [];
  for (const abilityHrid of touched?.abilityHrids ?? []) {
    const entry = (Array.isArray(player?.abilities) ? player.abilities : []).find(
      (ability) => String(ability?.abilityHrid || '') === String(abilityHrid),
    );
    abilities.push(entry ? deepClone(entry) : null);
  }
  const houseRooms = {};
  for (const roomHrid of touched?.rooms ?? []) {
    houseRooms[roomHrid] = player?.houseRooms?.[roomHrid] ?? null;
  }
  return { equipment, abilities, houseRooms };
}

function hasAppliedBudgetFieldsBeenEdited(store, snapshot) {
  const touched = snapshot?.touched;
  // 旧快照（没有 touched 字段）没有基准 → 放行，与「不阻断撤销」的旧行为一致。
  if (!touched) return false;
  // 查找失败不回退 activePlayer（memo 0366940866978611200）：目标缺失只代表「无法核对」，
  // 不按「手改」拦截；真正阻止写错对象的是撤销侧的 fail-closed 分支。
  const player = store.players.find((entry) => String(entry.id) === String(snapshot.playerId));
  if (!player) return false;
  const current = pickTouchedSubset(player, touched);
  return JSON.stringify(current) !== JSON.stringify(snapshot.applied ?? null);
}

// 撤销恢复：只把「被方案涉及的键」写回应用前的值（快照里存着三字段的全量深拷贝）；
// 未涉及的键保持现状 —— 用户在那里的手改不阻止撤销、也不被撤销踩掉（与 trigger 的收窄口径同款）。
function restoreTouchedSubset(player, snapshot) {
  const touched = snapshot?.touched ?? { slots: [], abilityHrids: [], rooms: [] };
  const beforeEquipment = isPlainObject(snapshot?.equipment) ? snapshot.equipment : {};
  const beforeAbilities = Array.isArray(snapshot?.abilities) ? snapshot.abilities : [];
  const beforeHouseRooms = isPlainObject(snapshot?.houseRooms) ? snapshot.houseRooms : {};
  if (!isPlainObject(player.equipment)) player.equipment = {};
  if (!Array.isArray(player.abilities)) player.abilities = [];
  if (!isPlainObject(player.houseRooms)) player.houseRooms = {};

  for (const slotKey of touched.slots ?? []) {
    if (Object.prototype.hasOwnProperty.call(beforeEquipment, slotKey)) {
      player.equipment[slotKey] = deepClone(beforeEquipment[slotKey]);
    } else {
      delete player.equipment[slotKey];
    }
  }
  for (const abilityHrid of touched.abilityHrids ?? []) {
    const key = String(abilityHrid);
    const before = beforeAbilities.find((ability) => String(ability?.abilityHrid || '') === key);
    const index = player.abilities.findIndex((ability) => String(ability?.abilityHrid || '') === key);
    if (index >= 0) {
      if (before) player.abilities[index] = deepClone(before);
      else player.abilities.splice(index, 1);
    } else if (before) {
      player.abilities.push(deepClone(before));
    }
  }
  for (const roomHrid of touched.rooms ?? []) {
    if (Object.prototype.hasOwnProperty.call(beforeHouseRooms, roomHrid)) {
      player.houseRooms[roomHrid] = beforeHouseRooms[roomHrid];
    } else {
      delete player.houseRooms[roomHrid];
    }
  }
}

// 写回修补：restoreTouchedSubset 的镜像（同一套 touched 遍历骨架）——只把「被方案涉及的键」写成
// 链终点值（patch 即 finalConfig），未涉及的键保持玩家当前值。链运行期间用户在其它页面对这三字段的
// 编辑（含链未涉及的槽位/技能/房间）因此不被静默覆盖；patch 里没有该键 = 链终点不含它 ⇒ 删除该键
//（与撤销在「应用前快照无该键」时的 delete 同款语义）。
function applyTouchedSubset(player, touched, patch) {
  const patchEquipment = isPlainObject(patch?.equipment) ? patch.equipment : {};
  const patchAbilities = Array.isArray(patch?.abilities) ? patch.abilities : [];
  const patchHouseRooms = isPlainObject(patch?.houseRooms) ? patch.houseRooms : {};
  if (!isPlainObject(player.equipment)) player.equipment = {};
  if (!Array.isArray(player.abilities)) player.abilities = [];
  if (!isPlainObject(player.houseRooms)) player.houseRooms = {};

  for (const slotKey of touched?.slots ?? []) {
    if (Object.prototype.hasOwnProperty.call(patchEquipment, slotKey)) {
      player.equipment[slotKey] = deepClone(patchEquipment[slotKey]);
    } else {
      delete player.equipment[slotKey];
    }
  }
  for (const abilityHrid of touched?.abilityHrids ?? []) {
    const key = String(abilityHrid);
    const next = patchAbilities.find((ability) => String(ability?.abilityHrid || '') === key);
    const index = player.abilities.findIndex((ability) => String(ability?.abilityHrid || '') === key);
    if (index >= 0) {
      if (next) player.abilities[index] = deepClone(next);
      else player.abilities.splice(index, 1);
    } else if (next) {
      player.abilities.push(deepClone(next));
    }
  }
  for (const roomHrid of touched?.rooms ?? []) {
    if (Object.prototype.hasOwnProperty.call(patchHouseRooms, roomHrid)) {
      player.houseRooms[roomHrid] = patchHouseRooms[roomHrid];
    } else {
      delete player.houseRooms[roomHrid];
    }
  }
}

// ── 方案 → 配置补丁（已随 v2 单步模式移除；保留说明）──────────────────
// v4 链模式下不再有「用户手动应用某个方案」的路径：链结束由 startBudgetOptimizer 内部调
// applyBudgetChainResult 把 finalConfig 按链涉及的键写回主角（effect 载荷以搜索层报告为准 ——
// 工作配置就是从同一份 effect 序列推出来的，不经过报告候选 id 的反查）。旧 applyBudgetPlan 的
// 「反查失败拒绝半应用」防御不再需要（写入键由 touched 唯一定界，不存在半应用）。

// 链结果写回：把 finalConfig 里**链涉及的键**定点写回**链起点角色**对应字段 + 压一条整链撤销快照。
// 快照形状与旧单步快照同构（restoreTouchedSubset / pickTouchedSubset 直接复用）：touched
// 取「链上所有步骤涉及键」的并集 —— 写回与撤销都只碰这些键，链外的手改不受影响
//（memo 0366770569446801408：写回不再是整字段覆盖，否则链运行期间在别处的手改会被静默丢弃）。
// 目标角色取 runtime.targetPlayerId（start 时冻结），不是「写回瞬间的激活角色」：运行中切换主角
// 后收尾不得改写新主角（memo 0366770566183632896）。该 id 缺失（非 start 路径的外部调用）时按
// 数据安全优先直接放弃写回 —— 丢失一份链结果远好于把 A 的终点配置覆盖到别的角色上。
function applyBudgetChainResultToPlayer(store, result) {
  const targetId = String(store.budgetOptimizer?.runtime?.targetPlayerId || '');
  if (!targetId) return false;
  const player = (Array.isArray(store.players) ? store.players : []).find(
    (entry) => String(entry?.id ?? '') === targetId,
  );
  if (!player) return false;
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  if (steps.length === 0) return false;
  const finalConfig = isPlainObject(result?.finalConfig) ? result.finalConfig : null;
  if (!finalConfig) return false;

  const touched = { slots: [], abilityHrids: [], rooms: [] };
  for (const step of steps) {
    const effect = step?.candidate?.effect;
    if (effect?.type === 'equipment') touched.slots.push(String(effect.slotKey || ''));
    else if (effect?.type === 'ability') touched.abilityHrids.push(String(effect.abilityHrid || ''));
    else if (effect?.type === 'house') touched.rooms.push(String(effect.roomHrid || ''));
  }
  touched.slots = [...new Set(touched.slots.filter(Boolean))];
  touched.abilityHrids = [...new Set(touched.abilityHrids.filter(Boolean))];
  touched.rooms = [...new Set(touched.rooms.filter(Boolean))];

  const before = {
    equipment: deepClone(player.equipment || {}),
    abilities: deepClone(player.abilities || []),
    houseRooms: deepClone(player.houseRooms || {}),
  };

  applyingStores.add(storeKey(store));
  try {
    store.$patch(() => {
      // 按 touched 子集定点写回（finalConfig 是从主角初始配置克隆后逐步应用 effect 得到的链终点
      // 权威值）：只覆盖链涉及的键，未涉及的键保持玩家当前值 —— 链运行期间用户在其它页面对这三
      // 字段的编辑（含链未涉及的槽位/房间）不被静默覆盖，与撤销的收窄口径对称
      //（memo 0366770569446801408；界面 applyHint 的「只覆盖链涉及的键」由此兑现）。
      applyTouchedSubset(player, touched, finalConfig);
      store.budgetOptimizer.baselineSnapshots.push({
        playerId: targetId,
        equipment: before.equipment,
        abilities: before.abilities,
        houseRooms: before.houseRooms,
        touched,
        applied: pickTouchedSubset(player, touched),
      });
      if (targetId === String(store.activePlayerId)) {
        // 应用后指纹：撤销把配置退回去后，报告相对链起点仍视为「已应用」。
        store.budgetOptimizer.results.appliedInputSignature = store.budgetOptimizerInputSignature;
      } else {
        // 写回的是非当前激活角色：报告不属于当前视角 —— 不记应用后指纹（否则会像修复前那样
        // 用新主角的写后指纹把「过期」判定掩盖掉），并显式置过期。不能只靠指纹比较兜底：
        // 两个角色配置恰好相同时指纹可能相等；写回不触碰激活角色时，过期 watch 也不会触发。
        store.budgetOptimizer.results.appliedInputSignature = '';
        store.budgetOptimizer.results.stale = true;
      }
    });
  } finally {
    applyingStores.delete(storeKey(store));
  }
  // 收尾序（start 内）已先写过一次 runtime.error（报告写入时），这里在其后覆盖为定向提示：
  // 链结果写回的是链起点角色而非当前激活角色，用户需要知道这份配置改到了哪里。
  if (targetId !== String(store.activePlayerId)) {
    store.budgetOptimizer.runtime.error = 'common:budgetOptimizer.appliedToOtherPlayer';
  }
  return true;
}

// 输入变化 → 标记结果过期（仿 trigger 的 trackResultStaleness）。apply 期间用 applyingStores
// 屏蔽：应用写回本身会改变指纹（装备/技能/房子是指纹的一部分），那一刻不该把刚应用的结果
// 判成过期（appliedInputSignature 在 $patch 内同步记录应用后的指纹）。
function trackResultStaleness(store) {
  const key = storeKey(store);
  if (trackedStores.has(key)) return;
  trackedStores.add(key);
  const scope = effectScope(true);
  // 双职责：① 输入变化 → 标记结果过期（见上）；② 报告落盘 —— results 任何变化
  //（整体替换或原地写 stale / appliedInputSignature）都把带 createdAt 的报告写进本地存储。
  // 空结果（createdAt: 0）既不写也不删：开跑清空后崩溃/刷新要能找回上一份
  // —— 持久化要防的正是这种丢法；唯一删除点是 resetBudgetOptimizerResults（导入新存档）。
  scope.run(() => {
    watch(
      [() => store.budgetOptimizerInputSignature, () => store.budgetOptimizer.results],
      () => {
        if (applyingStores.has(key)) return;
        const results = store.budgetOptimizer.results;
        if (results?.createdAt && store.budgetOptimizerReportStale) {
          results.stale = true;
        }
      },
      { flush: 'sync' },
    );
    watch(
      () => store.budgetOptimizer.results,
      (results) => {
        persistBudgetOptimizerReportToStorage(results);
      },
      { deep: true },
    );
  });
  const dispose = store.$dispose.bind(store);
  store.$dispose = () => {
    store.stopBudgetOptimizer();
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

export function createBudgetOptimizerActions({ loadPlayerMapperModule }) {
  return {
    setBudgetOptimizerSettings(settings) {
      trackResultStaleness(this);
      if (this.budgetOptimizer.runtime.isRunning) return false;
      const previous = this.budgetOptimizer.settings;
      const next = { ...previous, ...(isPlainObject(settings) ? settings : {}) };
      if (!isValidBudgetOptimizerSettings(next)) return false;
      const normalized = normalizeBudgetOptimizerSettings(next);
      if (JSON.stringify(normalized) === JSON.stringify(this.budgetOptimizer.settings)) return true;
      if (this.budgetOptimizer.results.createdAt) this.budgetOptimizer.results.stale = true;
      this.budgetOptimizer.settings = persistBudgetOptimizerSettingsToStorage(normalized);
      return true;
    },
    // 队伍载荷：切换参与整队模拟的队友集合（玩家 id 数组；空 = 单人）。
    // 走同一套归一化 + 校验 + 落盘 + 过期标记 ——「换队友」会让既有报告立即过期
    //（指纹里既有 id 列表、也有队友的配置快照），不会被误应用。
    setBudgetOptimizerPartyPlayers(playerIds) {
      return this.setBudgetOptimizerSettings({
        partyPlayerIds: Array.isArray(playerIds) ? playerIds.map((id) => String(id)).filter(Boolean) : [],
      });
    },
    async startBudgetOptimizer() {
      trackResultStaleness(this);
      const runtime = this.budgetOptimizer.runtime;
      if (runtime.isRunning) return;
      runtime.error = '';

      const settings = this.budgetOptimizer.settings;
      const activePlayer = this.activePlayer;
      const activePlayerId = String(this.activePlayerId);
      const imported = this.queue.importedProfileByPlayer?.[activePlayerId] === true;

      if (!activePlayer || !imported) {
        runtime.error = 'common:budgetOptimizer.requireImport';
        return;
      }
      // 候选枚举与成本参考只覆盖 zone/dungeon；迷宫模式直接拒绝而非降级跑一份残缺结果
      //（与触发优化器的拒绝口径一致）。
      if (this.simulationSettings.mode === 'labyrinth') {
        runtime.error = 'common:budgetOptimizer.labyrinthUnsupported';
        return;
      }
      const useDungeon = Boolean(this.simulationSettings.useDungeon);
      const zoneHrid = useDungeon ? this.simulationSettings.dungeonHrid : this.simulationSettings.zoneHrid;
      if (!zoneHrid) {
        runtime.error = 'common:budgetOptimizer.requireZone';
        return;
      }
      if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
        runtime.error = 'common:budgetOptimizer.requireSingle';
        return;
      }
      if (budgetOptimizerBusy(this)) {
        runtime.error = BUDGET_OPTIMIZER_BUSY_ERROR;
        return;
      }
      if (!isValidBudgetOptimizerSettings(settings)) {
        runtime.error = 'common:budgetOptimizer.invalidSettings';
        return;
      }

      const runId = runtime.runId + 1;
      const startedAt = Date.now();
      Object.assign(runtime, {
        isRunning: true,
        runId,
        // 目标角色冻结（memo 0366770566183632896）：链终写回按本 id 解析玩家，运行中切换主角
        // 不会把本链的终点配置写到新主角身上（activePlayerId 已在入口同步捕获）。
        targetPlayerId: activePlayerId,
        phase: 'preparing',
        progress: 0,
        startedAt,
        elapsedSeconds: 0,
        cancelRequested: false,
        // 世代令牌复位：新链不属于任何「曾被用户取消的世代」，旧链迟到取消报告一律丢弃。
        cancelledRunId: 0,
        evaluated: 0,
        total: 0,
        stepsDone: 0,
        chainSteps: [],
      });
      const active = () => runtime.runId === runId && runtime.isRunning;

      // 入口段兜底（同 startSimulation / startTriggerOptimizer）：动态导入 / 玩家构建失败统一
      // 转入 runtime.error，而不是让异常逃逸成 unhandledrejection。
      let buildPlayersForSimulation;
      try {
        ({ buildPlayersForSimulation } = await loadPlayerMapperModule());
      } catch (loadError) {
        if (active()) resetRuntimeForError(runtime, 'common:simulation.errorLoadModule');
        return;
      }
      if (!active()) return;
      if (otherRunsBusy(this) || hasBudgetOptimizerRunInProgress()) {
        if (active()) resetRuntimeForError(runtime, BUDGET_OPTIMIZER_BUSY_ERROR);
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

      // 技能书成本参考（幂等）：技能候选的成本依赖全局经验表，缺表时技能候选会被静默跳过
      //（搜索层自己也会再注入一次，那是服务层的纵深；store 先加载让预热在页面路径上完成）。
      await this.ensureAbilityUpgradeReferenceDataLoaded().catch(() => null);
      if (!active()) return;

      // 估值回退 resolver（2026-10-08）：装备/技能候选买入侧缺价时按 MWITools 装备价值口径
      // （六级链：官方估算 → 挂单中价 → 成交均价 → 强化成本法 → 获取成本 → 商店价）估值参与
      // 搜索，尽量不因缺价跳过。重链按需动态加载（与 loadAssetScoreModule 同一模块实例，
      // 浏览器模块缓存兜底）；加载失败降级为不注入（回退旧行为：缺价跳过）。
      // per-run Map 记忆化：同 (物品, 等级) 全链步只估一次；context.kind 区分装备专用择优
      //（resolveEquipmentAssetValue：官方估算 vs 成本法偏差 ≤20% 择优，背部装备强制保护镜）
      // 与通用物品链（技能书：resolveAssetItemValue）。估值语义是「价值」不是买入实价，
      // 只在原链完全缺价时被 domain 采用，不会覆盖实价口径。
      let fairValueResolver;
      try {
        const { resolveAssetItemValue, resolveEquipmentAssetValue } = await import('../services/assetScoreService.js');
        const fairValueCache = new Map();
        fairValueResolver = (itemHrid, enhancementLevel, context = {}) => {
          const hrid = String(itemHrid || '');
          const level = Math.max(0, Math.floor(Number(enhancementLevel) || 0));
          const cacheKey = `${hrid}|${level}|${String(context?.slotKey || '')}`;
          if (fairValueCache.has(cacheKey)) return fairValueCache.get(cacheKey);
          let result = null;
          try {
            const valued =
              context?.kind === 'equipment'
                ? resolveEquipmentAssetValue(this.pricing, hrid, level, String(context?.slotKey || ''))
                : resolveAssetItemValue(this.pricing, hrid, level);
            const price = Number(valued?.price);
            if (Number.isFinite(price) && price > 0) {
              result = { price, source: String(valued?.source || 'fair_value') };
            }
          } catch {
            result = null;
          }
          fairValueCache.set(cacheKey, result);
          return result;
        };
      } catch {
        fairValueResolver = undefined;
      }
      if (!active()) return;

      // optimizeBudgetUpgrades 的入参：simulationSettings 取自首页模拟设置的子集（payload 只读
      // 这些字段），extra 用 buildSimulationExtra 单独序列化；模拟时长以优化器自身的
      // settings.simulationHours 为准（本页有独立时长设置，与首页 simulationTimeHours 解耦，
      // 避免「改了时长却不生效」的假控件）。
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
        // 队伍载荷：冻结队友配置随搜索一起进模拟（口径：只改主角的装备/技能/房子）。
        // 空数组 = 单人载荷。
        teammates: resolveBudgetOptimizerTeammates(this),
        simulationSettings,
        extra: buildSimulationExtra(this.simulationSettings),
        settings: normalizeBudgetOptimizerSettings(settings),
        // 行情口径（设计 §7）：pricingState 供候选成本（domain），pricingOptions 供指标口径
        //（收益链）；后者与 trigger 同款深拷贝，前者只读引用。
        pricing: {
          pricingState: this.pricing,
          pricingOptions: deepClone(createProfitPricingOptions(this.pricing)),
        },
        // 抵扣口径（2026-10-09 接通全局 baselineSaleSide 设置）：装备候选旧件卖出抵扣按该口径
        // 取价，与队列页/成本弹窗同源；同值进指纹（snapshotBudgetOptimizerInput），口径切换
        // 旧报告过期。归一化仅接受 'ask'，其余（含缺省）一律 'bid'。
        saleSide: normalizeBaselineSaleSide(this.activeQueueState?.settings?.baselineSaleSide),
        // 估值回退（MWITools 装备价值口径）：模块加载成功才有值；undefined = 搜索层走旧行为。
        fairValueResolver,
        parallelWorkerLimit: normalizeParallelWorkerLimit(
          this.queueRuntime?.parallelWorkerLimit,
          this.queueParallelWorkerHardMax,
        ),
        parallelWorkerHardMax: this.queueParallelWorkerHardMax,
        // 计时原点交给搜索层：报告/进度上报的 elapsedSeconds 与页面「已用时间」同口径
        //（都从点击「开始」算起），跑完时数字不再回缩。
        startedAt,
      };

      const inputSignature = this.budgetOptimizerInputSignature;
      try {
        const { optimizeBudgetUpgrades } = await import('../services/budgetOptimizerSearch.js');
        if (!active()) return;
        if (otherRunsBusy(this) || hasBudgetOptimizerRunInProgress()) {
          resetRuntimeForError(runtime, BUDGET_OPTIMIZER_BUSY_ERROR);
          return;
        }

        // 预检（动态导入 / 互斥检查 / 玩家构建）全部通过、确认真开跑后再清空旧报告——
        // 上述任一失败路径提前返回时旧报告保持上屏，预检失败不得吞掉上一份报告；
        // 撤销栈跨搜索保留：链报告覆盖写入前先清空（旧链报告对应的配置已被新链取代）。
        this.budgetOptimizer.results = createEmptyBudgetOptimizerResult();
        // 服务调用在途（含 stop 之后的收尾窗口）：见 runtime.serviceRunInFlight 的说明。
        runtime.serviceRunInFlight = true;
        const result = await optimizeBudgetUpgrades(input, {
          onProgress: (update) => {
            if (runtime.runId !== runId) return;
            runtime.phase = String(update?.phase || runtime.phase);
            runtime.progress = clamp(Number(update?.progress || 0), 0, 1);
            runtime.elapsedSeconds = Number(update?.elapsedSeconds || runtime.elapsedSeconds);
            // 进度明细照单收下：搜索层上报当前阶段评估计数 / 步数。
            runtime.evaluated = Number(update?.evaluated || 0);
            runtime.total = Number(update?.total || 0);
            runtime.stepsDone = Number(update?.stepsDone || 0);
          },
          // 链步骤渐进上报：每完成一步立刻 push 进 runtime.chainSteps（UI 渐进上屏，
          // 「模拟完一步就能看这一步的结果」）。runId 闸门防串台（停止后旧链的迟到步骤不进新状态）。
          onStep: (stepRecord) => {
            if (runtime.runId !== runId) return;
            runtime.chainSteps.push(stepRecord);
          },
          onCancel: () => {
            if (runtime.runId === runId) runtime.cancelRequested = true;
          },
        });
        // runId 闸门防串台：新一轮已开跑（runId 又变了且不是本轮的停止）的迟到结果直接丢弃。
        // 用户停止是唯一例外：stop 把「被取消的世代」记进 cancelledRunId 再把 runId 顶掉，搜索层
        // 随后会把已完成的步骤收敛成取消报告 resolve 回来（不抛错）——此刻必须照常写入并写回
        //（已应用步骤是既成事实，撤销走统一入口；与设计 §5 取消口径一致），否则停止后 UI 数据源
        // 从 runtime.chainSteps 切回 results.steps，「已经搜出来的步骤」会整段消失（2026-10-06 修复）。
        // 放行按世代匹配而非 cancelRequested 布尔：布尔只表达「曾有取消请求」，无法区分报告属于
        // 哪一代 —— reset 收尾闸门清零世代后，旧链取消报告走丢弃路径，不把 finalConfig 写回新存档。
        const stoppedByUser = runtime.cancelledRunId === runId && result?.cancelled === true;
        if (runtime.runId !== runId && !stoppedByUser) return;

        // 链结束：报告整体写回 results（finalConfig 不入 results —— 配置写回主角后它就是
        // 当前配置的重复品，留着只会让报告体积翻倍；撤销基准用撤销栈快照）。
        const { finalConfig, ...reportFields } = result;
        this.budgetOptimizer.results = {
          ...reportFields,
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

        // ── 链结束自动写回（v4 核心行为）：链至少完成一步就把 finalConfig 整体写回主角，
        // 并压一条撤销快照（整链一条；「撤销应用」一次退回链起点）。零步链（首步即无可买项）
        // 不写回。取消的链同样写回（已应用步骤是既成事实，与 store 的撤销语义一致）。
        if (Array.isArray(result.steps) && result.steps.length > 0 && result.finalConfig) {
          this.applyBudgetChainResult(result);
        }
      } catch (error) {
        // 取消不算失败：optimizeBudgetUpgrades 内部把取消收敛成 result.cancelled，
        // 只有真正的失败才会重新抛出（isWorkerRunCancelledError 为防御性兜底）。
        if (active() && !isWorkerRunCancelledError(error)) {
          runtime.error = error?.message || String(error);
          runtime.phase = 'error';
        }
      } finally {
        // 注意：必须在这里清（而不是在 stop 里）：服务层的清理（注册表注销 / worker 停表）发生在
        // 异步收尾里，本标志是页面「忙」计算属性的响应式锚点 —— 它的这一次写入会让计算属性在
        // **标志真正清空之后**再算一次。
        runtime.serviceRunInFlight = false;
        if (runtime.runId === runId) {
          runtime.isRunning = false;
          runtime.cancelRequested = false;
          // 本轮未被 stop 顶掉（runId 仍匹配）时不会有取消世代残留；清零是防御性卫生。
          runtime.cancelledRunId = 0;
        }
      }
    },
    stopBudgetOptimizer() {
      const runtime = this.budgetOptimizer.runtime;
      if (!runtime.isRunning) return;
      runtime.cancelRequested = true;
      // 注册表置 cancelRequested 并停专属 worker；两条一起走是 trigger 的停止链口径（第二条幂等）。
      cancelBudgetOptimizerRun();
      stopBudgetOptimizerWorkerRuns();
      // 在途流程按 runId 复位识别「本轮已作废」：新一轮抢占的迟到结果不再写回
      //（用户停止的取消收尾除外 —— startBudgetOptimizer 里的 stoppedByUser 判据会保留它）。
      // 世代令牌：顶掉 runId 前先记下「被取消的是哪一代」，迟到取消报告只在世代匹配时放行
      //（reset 收尾闸门清零世代后，旧链取消报告走丢弃路径，不写回新存档）。
      runtime.cancelledRunId = runtime.runId;
      runtime.runId += 1;
      runtime.isRunning = false;
      runtime.phase = 'cancelled';
      // 进度读数保留（不置 0，2026-10-09）：停止后的收尾窗口与「迟到结果被丢弃」的残留期里，
      // 页面仍按 runtime 口径渲染（进度条停在停止瞬间的值，不再先回零再跳满）。
      // 开跑（start 的 runtime 复位）与 reset 照旧归零，两处不受影响。
    },
    // 链结果写回（v4）：链结束后由 startBudgetOptimizer 调用（不对外）。finalConfig 整体覆盖
    // 主角三字段 + 一条整链撤销快照。
    // 不做运行态拦截：调用点就在链收尾窗口内（isRunning 仍为 true、服务调用已结算），
    // 此刻写回是设计行为；外部误调用由「steps 非空 + finalConfig 存在」的防御兜底。
    applyBudgetChainResult(result) {
      trackResultStaleness(this);
      return applyBudgetChainResultToPlayer(this, result);
    },
    // 撤销（逐步回退）：每次弹出栈顶快照并恢复被这一步涉及的键；可一直退到连续升级开始前。
    // 返回值只表示「这一步是否成功撤销」，不表示栈已空（栈长见 baselineSnapshots.length）。
    revertBudgetOptimizerChanges() {
      trackResultStaleness(this);
      const runtime = this.budgetOptimizer.runtime;
      const stack = this.budgetOptimizer.baselineSnapshots;
      const snapshot = stack.length > 0 ? stack[stack.length - 1] : null;
      // 与 apply 同款闸门：撤销同样整体写回玩家配置，任何其它在途任务正在读这份配置时都不允许写穿。
      if (runtime.isRunning || budgetOptimizerBusy(this)) {
        runtime.error = BUDGET_OPTIMIZER_BUSY_ERROR;
        return false;
      }
      // 栈空 = 没有可撤销的应用步骤（含「已全部撤销」）。
      if (!snapshot) {
        runtime.error = 'common:budgetOptimizer.noChangesToRevert';
        return false;
      }
      // 撤销门禁（收窄口径）：只拦「被这一步涉及的键在应用后被手改」——撤销会把这些键写回应用前，
      // 手工改动会被踩掉。未被涉及的改动不阻止撤销（撤销并不会碰到它们）。
      if (hasAppliedBudgetFieldsBeenEdited(this, snapshot)) {
        runtime.error = 'common:budgetOptimizer.revertBlockedEdited';
        return false;
      }
      // 目标缺失即放弃（memo 0366940866978611200）：不得回退当前激活角色 —— 会把链起点的应用前
      // 配置静默写到另一个玩家身上。不弹栈、不清指纹、零写入（与 applyBudgetChainResultToPlayer 对偶）。
      const player = this.players.find((entry) => String(entry.id) === String(snapshot.playerId));
      if (!player) {
        runtime.error = 'common:budgetOptimizer.revertTargetUnavailable';
        return false;
      }

      applyingStores.add(storeKey(this));
      try {
        this.$patch(() => {
          restoreTouchedSubset(player, snapshot);
          stack.pop();
          this.budgetOptimizer.results.appliedInputSignature = '';
        });
      } finally {
        applyingStores.delete(storeKey(this));
      }
      return true;
    },
    // 导入新存档 / 恢复快照时重置会话内结果（仿 trigger 的导入重置口径）：
    // 玩家配置整体被替换，既有报告的输入签名不再对应任何当前配置。
    resetBudgetOptimizerResults() {
      // 搜索在跑先停掉：它结束后会往报告里写结果 —— 只清空而不停，会把在途结果落在新存档上。
      // 停止收尾窗口（stop 已把 isRunning 置假、取消报告尚未 resolve，serviceRunInFlight 仍为真）
      // 同样要覆盖：此刻 stop 因幂等守卫直接返回（无害空操作），真正的收尾闸门是下面的无条件清理。
      const runtime = this.budgetOptimizer.runtime;
      if (runtime.isRunning || runtime.serviceRunInFlight) {
        this.stopBudgetOptimizer();
      }
      // 迟到取消报告的放行闸门（startBudgetOptimizer 的 stoppedByUser 判据：布尔 + 世代）在
      // 条件之外无条件关闭 —— 玩家配置已被新存档整体替换，旧链的取消收尾报告必须丢弃，旧链
      // finalConfig 的写回会污染新配置。清在条件外：收尾窗口内 isRunning 已为假，进不了上面的
      // 分支，清放行条件不能依赖 stop 被执行。
      runtime.cancelRequested = false;
      runtime.cancelledRunId = 0;
      this.budgetOptimizer.results = createEmptyBudgetOptimizerResult();
      // 唯一显式删除点：导入新存档 ⇒ 旧报告作废，不再兜底恢复。
      clearBudgetOptimizerReportFromStorage();
      // 导入新存档：玩家配置整体被替换，撤销栈里的旧配置快照不再有意义。
      this.budgetOptimizer.baselineSnapshots = [];
      this.budgetOptimizer.runtime.error = '';
      this.budgetOptimizer.runtime.phase = 'idle';
      this.budgetOptimizer.runtime.progress = 0;
    },
  };
}
