import { getActionName as getIndexedActionName } from '../shared/gameDataIndex.js';
import {
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_IRONCOW,
  buildAdvisorMetricSummary,
  getAdvisorPresetWeights,
  normalizeAdvisorGoalPreset,
} from './advisorScoring.js';
import { filterAdvisorCandidatesByDropItems, normalizeDropItemHridList } from './advisorDropItems.js';
import { buildNoRngDropCountMap } from './profitEstimator.js';
import {
  ONE_HOUR,
  RUN_SCOPE_ALL_GROUP_ZONES,
  RUN_SCOPE_ALL_SOLO_ZONES,
  buildZoneTargetsByScope,
  summarizeResult,
  toPlayerHrid,
} from './simulationDomain.js';
import { clamp, toFiniteNumber } from './utils.js';

export const ADVISOR_REFINE_TOP_COUNT_DEFAULT = 8;
export const ADVISOR_REFINE_ROUNDS_DEFAULT = 20;
export const ADVISOR_REFINE_TOP_COUNT_MIN = 1;
export const ADVISOR_REFINE_TOP_COUNT_MAX = 32;
export const ADVISOR_REFINE_ROUNDS_MIN = 1;
export const ADVISOR_REFINE_ROUNDS_MAX = 30;
export const ADVISOR_QUICK_ROUNDS_DEFAULT = 3;
export const ADVISOR_QUICK_ROUNDS_MIN = 1;
export const ADVISOR_QUICK_ROUNDS_MAX = 10;

function createDefaultWorkerId(random = Math.random) {
  const randomValue = Number(typeof random === 'function' ? random() : Math.random());
  const safeRandom = Number.isFinite(randomValue) ? randomValue : Math.random();
  return Math.floor(safeRandom * 1e9).toString();
}

export function normalizeAdvisorFilters(rawFilters = {}) {
  const source = rawFilters != null && typeof rawFilters === 'object' && !Array.isArray(rawFilters) ? rawFilters : {};
  return {
    includeGroupZones: source.includeGroupZones !== false,
    includeSoloZones: Boolean(source.includeSoloZones),
    refineTopEnabled: source.refineTopEnabled !== false,
    refineTopCount: clamp(
      Math.floor(toFiniteNumber(source.refineTopCount, ADVISOR_REFINE_TOP_COUNT_DEFAULT)),
      ADVISOR_REFINE_TOP_COUNT_MIN,
      ADVISOR_REFINE_TOP_COUNT_MAX,
    ),
    refineRounds: clamp(
      Math.floor(toFiniteNumber(source.refineRounds, ADVISOR_REFINE_ROUNDS_DEFAULT)),
      ADVISOR_REFINE_ROUNDS_MIN,
      ADVISOR_REFINE_ROUNDS_MAX,
    ),
    quickRounds: clamp(
      Math.floor(toFiniteNumber(source.quickRounds, ADVISOR_QUICK_ROUNDS_DEFAULT)),
      ADVISOR_QUICK_ROUNDS_MIN,
      ADVISOR_QUICK_ROUNDS_MAX,
    ),
    dropItemHrids: normalizeDropItemHridList(source.dropItemHrids),
  };
}

export function createAdvisorState() {
  return {
    filters: normalizeAdvisorFilters(),
    goalPreset: ADVISOR_GOAL_PRESET_BALANCED,
    customWeights: getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_BALANCED),
    // 自定义权重原始输入（用户口径草稿源，G3 2026-09-05）：null = 从未应用过
    // 自定义权重（或旧载荷无此字段），页面草稿回退由归一化 customWeights 回显。
    customWeightInputs: null,
    ironcowWeights: { dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 },
    scannedGoalPreset: '',
    scannedDropItemHrids: [],
    dropDataStale: false,
    quickRows: [],
    refinedRows: [],
    topCards: [],
    metricPlayerId: '',
    metricPlayerName: '',
    // 顶栏「开始推荐」的请求令牌（会话内计数器，不落盘）：requestAdvisorRun 递增，
    // AdvisorPage watch 后执行本地 runAdvisor() 以提交 filterDraft 并重置排序。
    runRequestToken: 0,
    runtime: {
      isRunning: false,
      phase: 'idle',
      progress: 0,
      startedAt: 0,
      elapsedSeconds: 0,
      quickCompleted: 0,
      quickTotal: 0,
      refineCompleted: 0,
      refineTotal: 0,
      lastRunAt: 0,
      runId: 0,
      cancelRequested: false,
      // runAdvisorScan 的「已进入未返回」标志（会话内，不落盘）：isRunning 要到
      // executeAdvisorScan 越过 loadPlayerMapperModule 动态导入并进入 quick 阶段
      // 才置位（首扫窗口可达数百 ms），scanInFlight 在首个 await 之前同步置位，
      // 用于吸收该窗口内的重复触发（顶栏「开始推荐」双击）。
      scanInFlight: false,
    },
    error: '',
  };
}

export function buildAdvisorTargetId(targetType, targetHrid, targetLevel) {
  return `${String(targetType || 'zone')}:${String(targetHrid || '')}#${Math.floor(toFiniteNumber(targetLevel, 0))}`;
}

export function createAdvisorZoneCandidate(zoneTarget, category, order) {
  const zoneHrid = String(zoneTarget?.zoneHrid || '');
  const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(zoneTarget?.difficultyTier, 0)));
  return {
    id: buildAdvisorTargetId('zone', zoneHrid, difficultyTier),
    order,
    targetType: 'zone',
    category,
    targetHrid: zoneHrid,
    targetName: getIndexedActionName(zoneHrid, zoneHrid),
    difficultyTier,
    roomLevel: null,
    isRefined: false,
    refineRounds: 0,
    successfulRounds: 0,
  };
}

export function resolveAdvisorMetricPlayer(selectedPlayers = [], preferredPlayerId = '1') {
  const safePlayers = Array.isArray(selectedPlayers) ? selectedPlayers.filter(Boolean) : [];
  const normalizedPreferredId = String(preferredPlayerId || '1');
  const preferredPlayer = safePlayers.find((player) => String(player?.id || '') === normalizedPreferredId);
  const fallbackPlayer = preferredPlayer || safePlayers[0] || null;
  const resolvedId = String(fallbackPlayer?.id || normalizedPreferredId || '1');
  return {
    id: resolvedId,
    name: String(fallbackPlayer?.name || `Player ${resolvedId}`),
  };
}

// 铁牛模式：对 metric player 计算所选目标物品的期望掉落速率。
// dropItemHrids 为空时返回零值；非空时用 buildNoRngDropCountMap 取整场
// 期望数量并按模拟小时折算，dropRatesByItem 固定包含全部所选物品
//（无掉落记 0），dropsPerHour 为所选物品速率之和。
function buildAdvisorDropRateMetrics(simResult, metricPlayerHrid, hours, dropItemHrids = []) {
  const selectedItemHrids = normalizeDropItemHridList(dropItemHrids);
  const dropRatesByItem = {};
  if (selectedItemHrids.length === 0 || !simResult) {
    return { dropsPerHour: 0, dropRatesByItem };
  }

  const dropCountMap = buildNoRngDropCountMap(simResult, metricPlayerHrid);
  for (const itemHrid of selectedItemHrids) {
    dropRatesByItem[itemHrid] = toFiniteNumber(dropCountMap.get(itemHrid), 0) / hours;
  }
  const dropsPerHour = selectedItemHrids.reduce(
    (sum, itemHrid) => sum + toFiniteNumber(dropRatesByItem[itemHrid], 0),
    0,
  );
  return { dropsPerHour, dropRatesByItem };
}

export function summarizeAdvisorTargetResult(
  simResult,
  selectedPlayers,
  preferredPlayerId,
  pricingOptions = {},
  dropItemHrids = [],
) {
  const playerRows = summarizeResult(simResult, selectedPlayers, pricingOptions);
  const hours = Math.max(1e-9, Number(simResult?.simulatedTime ?? 0) / ONE_HOUR);
  const metricPlayer = resolveAdvisorMetricPlayer(selectedPlayers, preferredPlayerId);
  const metricPlayerHrid = toPlayerHrid(metricPlayer.id);
  const metricRow = playerRows.find((row) => row?.playerHrid === metricPlayerHrid) || playerRows[0] || null;
  const fallbackKillsPerHour = toFiniteNumber(simResult?.encounters, 0) / hours;
  const { dropsPerHour, dropRatesByItem } = buildAdvisorDropRateMetrics(
    simResult,
    metricPlayerHrid,
    hours,
    dropItemHrids,
  );

  return {
    playerRows,
    metricPlayerId: metricPlayer.id,
    metricPlayerName: metricPlayer.name,
    profitPerHour: toFiniteNumber(metricRow?.profitPerHour, 0),
    xpPerHour: toFiniteNumber(metricRow?.totalXpPerHour, 0),
    killsPerHour: toFiniteNumber(metricRow?.encountersPerHour, fallbackKillsPerHour),
    deathsPerHour: toFiniteNumber(metricRow?.deathsPerHour, 0),
    dropsPerHour,
    dropRatesByItem,
  };
}

// 把 sample 的 dropRatesByItem 规整为「键非空、值为有限数」的普通对象，
// 缺失/非对象输入一律回退为 {}（与 dropsPerHour: 0 的默认行形状对齐）。
function normalizeDropRatesByItem(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  const result = {};
  for (const [itemHrid, rawRate] of Object.entries(source)) {
    const normalizedHrid = String(itemHrid || '').trim();
    if (!normalizedHrid) {
      continue;
    }
    result[normalizedHrid] = toFiniteNumber(rawRate, 0);
  }
  return result;
}

export function buildAdvisorBaseRow(candidate, sample) {
  return {
    ...candidate,
    profitPerHour: toFiniteNumber(sample?.profitPerHour, 0),
    xpPerHour: toFiniteNumber(sample?.xpPerHour, 0),
    killsPerHour: toFiniteNumber(sample?.killsPerHour, 0),
    deathsPerHour: toFiniteNumber(sample?.deathsPerHour, 0),
    dropsPerHour: toFiniteNumber(sample?.dropsPerHour, 0),
    dropRatesByItem: normalizeDropRatesByItem(sample?.dropRatesByItem),
    reasons: [],
    normalizedMetrics: {
      profitPerHour: 0,
      xpPerHour: 0,
      killsPerHour: 0,
      safety: 0,
    },
    finalScore: 0,
    baseFinalScore: 0,
    confidenceScore: null,
    confidencePenaltyFactor: 1,
    stabilityScore: 50,
    metricSummary: null,
  };
}

function resolveAdvisorRoundMetricValue(summary = {}, fallbackValue = 0) {
  return Number.isFinite(summary?.robustMean)
    ? toFiniteNumber(summary.robustMean, 0)
    : toFiniteNumber(fallbackValue, 0);
}

// dropRatesByItem 仅用于展示层 tooltip：每物品取「出现该物品键的轮次」的
// 简单平均。它与 dropsPerHour 的 robustMean 总量口径存在轻微差异，属预期
//（样本量小或离群轮次时两者不必互推）。
function aggregateAdvisorDropRatesByItem(roundMetrics = []) {
  const sumByItem = new Map();
  const countByItem = new Map();

  for (const round of roundMetrics) {
    const dropRatesByItem = round?.dropRatesByItem;
    if (!dropRatesByItem || typeof dropRatesByItem !== 'object' || Array.isArray(dropRatesByItem)) {
      continue;
    }
    for (const [itemHrid, rawRate] of Object.entries(dropRatesByItem)) {
      const normalizedHrid = String(itemHrid || '').trim();
      if (!normalizedHrid) {
        continue;
      }
      sumByItem.set(normalizedHrid, toFiniteNumber(sumByItem.get(normalizedHrid), 0) + toFiniteNumber(rawRate, 0));
      countByItem.set(normalizedHrid, toFiniteNumber(countByItem.get(normalizedHrid), 0) + 1);
    }
  }

  const result = {};
  for (const [itemHrid, sum] of sumByItem.entries()) {
    const count = Math.max(1, toFiniteNumber(countByItem.get(itemHrid), 1));
    result[itemHrid] = sum / count;
  }
  return result;
}

export function buildAdvisorCandidates(filters = {}, goalPreset = '') {
  const normalizedFilters = normalizeAdvisorFilters(filters);
  const candidates = [];
  let order = 0;

  if (normalizedFilters.includeSoloZones) {
    const soloTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_SOLO_ZONES);
    for (const zoneTarget of soloTargets) {
      candidates.push(createAdvisorZoneCandidate(zoneTarget, 'solo_zone', order));
      order += 1;
    }
  }

  if (normalizedFilters.includeGroupZones) {
    const groupTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_GROUP_ZONES);
    for (const zoneTarget of groupTargets) {
      candidates.push(createAdvisorZoneCandidate(zoneTarget, 'group_zone', order));
      order += 1;
    }
  }

  // 铁牛模式：在 solo/group 范围过滤之后，再按所选目标物品做难度感知过滤。
  // 非铁牛模式不按物品过滤（物品选择面板仅铁牛可见，遗留选择不应静默缩小
  // 老模式的扫描范围；与执行层空物品校验同样以 goalPreset==='ironcow' 门控）。
  if (
    normalizeAdvisorGoalPreset(goalPreset) === ADVISOR_GOAL_PRESET_IRONCOW &&
    normalizedFilters.dropItemHrids.length > 0
  ) {
    return filterAdvisorCandidatesByDropItems(candidates, normalizedFilters.dropItemHrids);
  }

  return candidates;
}

export function createAdvisorSimulationPayload(candidate, players, simulationTimeLimit, extra, options = {}) {
  const payload = {
    type: 'start_simulation',
    workerId: options.workerId ?? createDefaultWorkerId(options.random),
    players,
    zone: {
      zoneHrid: candidate.targetHrid,
      difficultyTier: Math.max(0, Math.floor(toFiniteNumber(candidate.difficultyTier, 0))),
    },
    labyrinth: null,
    simulationTimeLimit,
    extra,
  };

  const simulationContext =
    options.simulationContext && typeof options.simulationContext === 'object'
      ? { ...options.simulationContext }
      : options.isGuildTrial === true
        ? { isGuildTrial: true }
        : null;
  if (simulationContext) {
    payload.simulationContext = simulationContext;
  }

  return payload;
}

export function buildAdvisorRowFromRoundMetrics(candidate, roundMetrics = [], options = {}) {
  const safeRounds = Array.isArray(roundMetrics) ? roundMetrics.filter(Boolean) : [];
  const metricSummary = buildAdvisorMetricSummary(safeRounds);
  const fallbackSample = safeRounds[safeRounds.length - 1] || {};
  const profitSummary = metricSummary?.profitPerHour || {};
  const xpSummary = metricSummary?.xpPerHour || {};
  const killsSummary = metricSummary?.killsPerHour || {};
  const deathsSummary = metricSummary?.deathsPerHour || {};
  const dropsSummary = metricSummary?.dropsPerHour || {};
  const sample = {
    profitPerHour: resolveAdvisorRoundMetricValue(profitSummary, fallbackSample?.profitPerHour),
    xpPerHour: resolveAdvisorRoundMetricValue(xpSummary, fallbackSample?.xpPerHour),
    killsPerHour: resolveAdvisorRoundMetricValue(killsSummary, fallbackSample?.killsPerHour),
    deathsPerHour: resolveAdvisorRoundMetricValue(deathsSummary, fallbackSample?.deathsPerHour),
    dropsPerHour: resolveAdvisorRoundMetricValue(dropsSummary, fallbackSample?.dropsPerHour),
    dropRatesByItem: aggregateAdvisorDropRatesByItem(safeRounds),
  };

  return {
    ...buildAdvisorBaseRow(candidate, sample),
    isRefined: options.isRefined === true,
    refineRounds: Math.max(0, Math.floor(toFiniteNumber(options.refineRounds, candidate?.refineRounds ?? 0))),
    successfulRounds: safeRounds.length,
    metricSummary,
  };
}

export function buildAdvisorPartialErrorText(stageLabel, failedCandidates = []) {
  const safeStageLabel = String(stageLabel || 'scan');
  const failedCount = Array.isArray(failedCandidates) ? failedCandidates.length : 0;
  if (failedCount <= 0) {
    return '';
  }
  return `${failedCount} target(s) failed during ${safeStageLabel}. Showing successful results only.`;
}
