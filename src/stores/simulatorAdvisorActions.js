import {
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_IRONCOW,
  buildAdvisorTopCards,
  normalizeAdvisorGoalPreset,
  normalizeAdvisorWeights,
  normalizeIroncowWeights,
  rankAdvisorRows,
} from '../services/advisorScoring.js';
import { createAdvisorState, normalizeAdvisorFilters } from '../services/advisorDomain.js';
import { normalizeDropItemHridList } from '../services/advisorDropItems.js';
import { RUN_SCOPE_SINGLE } from '../services/simulationDomain.js';
import { stopAdvisorWorkerRuns } from '../services/simulatorWorkerRuns.js';
import { isPlainObject, toFiniteNumber } from '../services/utils.js';
import { executeAdvisorScan } from '../services/advisorRunExecution.js';
import { persistAdvisorSettingsToStorage } from '../services/simulatorStorage.js';

// 掉落数据陈旧检测：只有铁牛预设消费掉落数据，非铁牛一律视为不陈旧。
// 铁牛下若结果行并非产自铁牛扫描（scannedGoalPreset !== 'ironcow'），或
// 扫描时的目标物品集合与当前 filters.dropItemHrids 不一致 → dropDataStale=true。
function computeAdvisorDropDataStale({ goalPreset, scannedGoalPreset, scannedDropItemHrids, currentDropItemHrids }) {
  if (String(goalPreset || '') !== ADVISOR_GOAL_PRESET_IRONCOW) {
    return false;
  }
  if (String(scannedGoalPreset || '') !== ADVISOR_GOAL_PRESET_IRONCOW) {
    return true;
  }

  const scannedSet = new Set(normalizeDropItemHridList(scannedDropItemHrids));
  const currentSet = new Set(normalizeDropItemHridList(currentDropItemHrids));
  if (scannedSet.size !== currentSet.size) {
    return true;
  }
  for (const itemHrid of scannedSet) {
    if (!currentSet.has(itemHrid)) {
      return true;
    }
  }
  return false;
}

export function createAdvisorActions({ loadPlayerMapperModule }) {
  return {
    resetAdvisorState() {
      this.advisor = createAdvisorState();
      return this.advisor;
    },
    persistAdvisorSettings() {
      return persistAdvisorSettingsToStorage({
        goalPreset: this.advisor.goalPreset,
        customWeights: this.advisor.customWeights,
        ironcowWeights: this.advisor.ironcowWeights,
        filters: this.advisor.filters,
      });
    },
    rerankAdvisorResults(options = {}) {
      const normalizedGoalPreset = normalizeAdvisorGoalPreset(options.goalPreset ?? this.advisor.goalPreset);
      const normalizedCustomWeights = normalizeAdvisorWeights(
        options.customWeights ?? this.advisor.customWeights,
        ADVISOR_GOAL_PRESET_BALANCED,
      );
      const normalizedIroncowWeights = normalizeIroncowWeights(options.ironcowWeights ?? this.advisor.ironcowWeights);
      const quickRowsSource = Array.isArray(options.quickRows) ? options.quickRows : this.advisor.quickRows;
      const refinedRowsSource = Array.isArray(options.refinedRows) ? options.refinedRows : this.advisor.refinedRows;
      const rankOptions = {
        goalPreset: normalizedGoalPreset,
        customWeights: normalizedCustomWeights,
        ironcowWeights: normalizedIroncowWeights,
      };
      const rankedQuickRows = rankAdvisorRows(quickRowsSource, rankOptions);
      const quickRankById = new Map(rankedQuickRows.map((row, index) => [row.id, index + 1]));
      const rankedRefinedRows = rankAdvisorRows(refinedRowsSource, { ...rankOptions, quickRankById });
      const activeRows = rankedRefinedRows.length > 0 ? rankedRefinedRows : rankedQuickRows;

      this.advisor.goalPreset = normalizedGoalPreset;
      this.advisor.customWeights = normalizedCustomWeights;
      this.advisor.ironcowWeights = normalizedIroncowWeights;
      this.advisor.dropDataStale = computeAdvisorDropDataStale({
        goalPreset: normalizedGoalPreset,
        scannedGoalPreset: this.advisor.scannedGoalPreset,
        scannedDropItemHrids: this.advisor.scannedDropItemHrids,
        currentDropItemHrids: this.advisor.filters?.dropItemHrids,
      });
      this.advisor.quickRows = rankedQuickRows;
      this.advisor.refinedRows = rankedRefinedRows;
      this.advisor.topCards = buildAdvisorTopCards(activeRows, { preset: normalizedGoalPreset });
      // 默认随 rerank 持久化设置（用户交互路径契约）；options.persist === false 时跳过——
      // 供 advisorRunExecution 的流式 rerankLive* 高频调用（每个候选每轮 quick 结果触发
      // 一次，默认全量扫描约千次）选择退出：扫描开始时已落盘同一设置快照，且扫描期间
      // UI 已禁用设置修改，逐次同步 localStorage 写纯属冗余（2026-09-03 修复）。
      if (options.persist !== false) {
        this.persistAdvisorSettings();
      }
      return activeRows;
    },
    // 物品选择/范围开关等 filters 变更入口：patch 会与当前 filters 合并后整体
    // 规范化（含 dropItemHrids 清洗），避免部分更新把未传字段重置为默认值。
    // 扫描占用期间（isRunning 或 scanInFlight，后者覆盖 loadPlayerMapperModule
    // 动态导入窗口——isRunning 尚未置位、双击的 runAdvisor #2 恰在此提交
    // filterDraft）拒绝变更：persist:false 优化依赖「扫描期间设置不可变」，
    // 页面层 11 处 :disabled + 4 处 handler 兜底已封死 UI 路径，此处为 store
    // 层兜底，拦截程序化调用与窗口期的冗余落盘（runAdvisorScan 起止已各落盘
    // 一次设置快照）。拒绝时原样返回当前 filters，返回值契约与正常路径一致。
    updateAdvisorFilters(filters = {}) {
      if (this.advisor.runtime?.isRunning || this.advisor.runtime?.scanInFlight) {
        return this.advisor.filters;
      }
      const patch = isPlainObject(filters) ? filters : {};
      const normalizedFilters = normalizeAdvisorFilters({
        ...this.advisor.filters,
        ...patch,
      });
      this.advisor.filters = normalizedFilters;
      this.advisor.dropDataStale = computeAdvisorDropDataStale({
        goalPreset: this.advisor.goalPreset,
        scannedGoalPreset: this.advisor.scannedGoalPreset,
        scannedDropItemHrids: this.advisor.scannedDropItemHrids,
        currentDropItemHrids: normalizedFilters.dropItemHrids,
      });
      this.persistAdvisorSettings();
      return normalizedFilters;
    },
    // 清空当前扫描结果（quickRows/refinedRows/topCards 及扫描元数据）。
    // 这些都属于会话内状态（不落盘），filters/权重等已持久化设置保持不变。
    // 供「已有结果时修改目标掉落物品需先清空结果」的弹窗流程调用。
    clearAdvisorResults() {
      this.advisor.scannedGoalPreset = '';
      this.advisor.scannedDropItemHrids = [];
      this.advisor.dropDataStale = false;
      this.advisor.quickRows = [];
      this.advisor.refinedRows = [];
      this.advisor.topCards = [];
      return true;
    },
    async runAdvisorScan() {
      // 双击/重复触发去重：isRunning 要到 executeAdvisorScan 越过 loadPlayerMapperModule
      // 动态导入并进入 quick 阶段后才置位（首次加载窗口可达数百 ms），窗口期内的重复
      // 请求会并发进入第二次扫描——双 dedicated worker 池白烧 CPU、先者的收尾落盘
      // 落在后者扫描中途。scanInFlight 在首个 await 之前同步置位关窗；重复请求静默
      // 返回 []（与空扫描同口径），首次扫描不受影响。
      if (this.advisor.runtime?.isRunning || this.advisor.runtime?.scanInFlight) {
        return [];
      }
      this.advisor.runtime.scanInFlight = true;
      try {
        // 扫描开始：落盘一次设置快照（流式 rerank 期间不逐次写，见 rerankAdvisorResults）。
        this.persistAdvisorSettings();
        const rows = await executeAdvisorScan({
          store: this,
          loadPlayerMapperModule,
        });
        // 扫描完成/取消/失败路径：收尾再同步一次设置快照，保证磁盘与扫描后状态一致。
        // 当前所有设置入口的规范化均幂等，此写为防御性收尾——每次扫描恰好 2 次落盘，
        // 而非修复前的约千次。
        this.persistAdvisorSettings();
        return rows;
      } finally {
        this.advisor.runtime.scanInFlight = false;
      }
    },
    stopAdvisorScan() {
      if (!this.advisor.runtime?.isRunning) {
        return false;
      }

      this.advisor.error = '';
      this.advisor.runtime.cancelRequested = true;
      this.advisor.runtime.isRunning = false;
      this.advisor.runtime.phase = 'cancelled';
      this.advisor.runtime.elapsedSeconds =
        this.advisor.runtime.startedAt > 0 ? (Date.now() - this.advisor.runtime.startedAt) / 1000 : 0;
      stopAdvisorWorkerRuns();
      return true;
    },
    // 顶栏「开始推荐」经 token 请求页面执行 runAdvisor()：页面在扫描前需提交本地
    // filterDraft 并重置排序，直接调 runAdvisorScan 会用过期筛选配置。
    requestAdvisorRun() {
      this.advisor.runRequestToken = Number(this.advisor.runRequestToken || 0) + 1;
      return this.advisor.runRequestToken;
    },
    applyAdvisorTarget(row) {
      const targetType = String(row?.targetType || 'zone');
      if (targetType !== 'zone') {
        return false;
      }

      this.simulationSettings.mode = 'zone';
      this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
      this.simulationSettings.useDungeon = false;
      this.simulationSettings.zoneHrid = String(row?.targetHrid || this.simulationSettings.zoneHrid || '');
      this.simulationSettings.difficultyTier = Math.max(
        0,
        Math.floor(toFiniteNumber(row?.difficultyTier, this.simulationSettings.difficultyTier || 0)),
      );
      this.normalizeDifficulty();
      return true;
    },
  };
}
