// 地下城收益计算器 store：页面配置持久化 + 计算编排（薄层，无 DOM / 无组件依赖）。
//
// - 计算口径全部委托 services/dungeonProfitCalculator.js（纯函数引擎），
//   本 store 不复制任何取价 / 计税 / 掉率逻辑；
// - 手动改价沿用 enhancementStore 的页面级 override 先例（config.priceOverrides 落
//   localStorage）：override 经 simulatorStorage.applyPriceOverridesToTable（语义 A：
//   改价即市场价）叠加到 simulatorStore 当前 priceTable 之上注入引擎，不改写
//   simulatorStore 的全局定价状态；
// - 行情刷新复用 simulatorPricingActions.ensureMarketPricesLoaded（内部含并发去重、
//   快照新鲜度判定与错误记录，勿新造并发控制）；
// - 「模拟每轮时长」用导入队伍（simulatorStore 勾选玩家）跑真实战斗模拟（专用 scope 批运行，
//   一次覆盖全部 4 地牢 × T0/T1/T2 共 12 个组合），按各组合「Σ 模拟时长 ÷ Σ 通关次数」分别
//   写回每轮分钟（含团灭与重开间隔；某组合零通关时保留该组合原值、只记录失败摘要）。
// - 每轮分钟按「地牢 × 档位」独立存储于 config.runMinutesByDungeonTier（{ [hrid]: { [tier]: 分钟 } }），
//   未设置的组合回落各地牢目录默认值（maxWaves × 15s / 60）。
// - 模拟同时产出「实测消耗品花费」（consumeCounts 按玩家分组 → computeConsumablesCost → 各角色
//   「窗口内花费 ÷ 窗口内通关次数」的每轮值，药钱归属该角色本人、不做整队摊薄），按
//   「玩家 × 地牢 × 档位」写回 config.consumablesCostPerRunByPlayerDungeonTier；页面按当前选中
//   角色取值（切换角色即切换药钱），零通关 / 未上报（或键全部未命中玩家 hrid）的组合不写回、
//   回落弹窗手填的每日成本口径。
import { computed, reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { createCachedModuleLoader } from '../services/cachedModuleLoader.js';
import {
  buildDungeonCatalog,
  compareDungeons,
  computeConsumablesCost,
  computeDungeonRunProfit,
} from '../services/dungeonProfitCalculator.js';
import { buildMultiRoundPayloads } from '../services/homeMultiRoundSimulation.js';
import { PLAYER_IDS } from '../services/profitEstimator.js';
import { buildSingleSimulationPayload } from '../services/simulationDomain.js';
import { isSimulationBusy, setDungeonCalculatorRunInFlight } from '../services/simulatorRunConflicts.js';
import {
  DEDICATED_WORKER_SCOPE_DUNGEON_CALCULATOR,
  isWorkerRunCancelledError,
  runSimulationBatchWithDedicatedWorker,
  stopDungeonCalculatorWorkerRuns,
} from '../services/simulatorWorkerRuns.js';
import {
  applyPriceOverridesToTable,
  buildDungeonAlignedPriceTable,
  normalizePriceOverrideMap,
  normalizePriceOverrideValue,
} from '../services/simulatorStorage.js';
import { useSimulatorStore } from './simulatorStore.js';

export const DUNGEON_CALCULATOR_STORAGE_VERSION = 1;
export const DUNGEON_CALCULATOR_STORAGE_KEY = `mwi.dungeonCalculator.v${DUNGEON_CALCULATOR_STORAGE_VERSION}`;

// 选项白名单：取值域与引擎 normalizeKeySource / normalizePriceMode 保持一致。
// 钥匙来源只保留 market / craft（2026-10-12 用户裁决：hybrid 选项整体移除）。
export const DUNGEON_KEY_SOURCES = Object.freeze(['market', 'craft']);
export const DUNGEON_BUY_MODES = Object.freeze(['ask', 'bid']);
export const DUNGEON_SELL_MODES = Object.freeze(['bid', 'ask']);

// 精炼箱掉率固定口径 = 脚本共识逐档常量（T0 = 0 / T1 = 0.33 / T2 = 1.0，2026-10-11 用户裁决：
// 不再提供口径切换 / 自定义覆盖控件，恒以对象型 override 线程化给引擎）。
export const SCRIPT_REFINEMENT_RATE_BY_TIER = Object.freeze({ 0: 0, 1: 0.33, 2: 1.0 });
// 宝箱钥匙 2% 回收固定按「收入侧计入」（2026-10-15 用户裁决：不再提供配置控件，口径恒为 income；
// 引擎仍支持 cost / income / off 三态，本产品固定 income）。

// 「模拟每轮时长」契约：每轮模拟窗口固定 1 个游戏日（24h），轮数 = 不同种子的重复次数
//（默认 3，范围 [1,10]；读取端统一 clamp）。
export const DUNGEON_CALCULATOR_SIMULATION_HOURS = 24;
export const DUNGEON_CALCULATOR_SIMULATION_DEFAULT_ROUNDS = 3;
export const DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS = 1;
export const DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS = 10;
// 固定基种子：相同输入配置 + 相同轮数必然复现同一组逐轮种子（语义同 HOME_MULTI_ROUND_SEED_BASE，
// 非数据迁移不要改）。
export const DUNGEON_CALCULATOR_SIMULATION_SEED_BASE = 20261010;
// 模拟目标（地牢 × 档位）之间的种子基错位步长：12 个组合各用「基种子 + 组合序号 × 步长」派生
// 逐轮种子，跨组合互不重复；步长远大于轮数上限（10），各组合的轮次种子区间互不交叠。
export const DUNGEON_CALCULATOR_SIMULATION_TARGET_SEED_STRIDE = 1000;

const DEFAULT_PARTY_SIZE = 5;
const MAX_PARTY_SIZE = 5;
const MAX_COMMUNITY_BUFF_LEVEL = 20;
// 暴饮之囊强化等级上限（游戏强化等级上限 20，与引擎 MAX_ENHANCEMENT_LEVEL 同口径）。
const MAX_GUZZLING_LEVEL = 20;
// 暴饮之囊 hrid（自动持有检测：当前选中角色的 pouch 槽）。
const GUZZLING_POUCH_HRID = '/items/guzzling_pouch';
const MINUTES_PER_DAY = 1440;
// 模拟结果的时间单位为纳秒（与引擎/夹具同口径），换算分钟用于每轮时长。
const NANOSECONDS_PER_MINUTE = 60 * 1_000_000_000;
// 「每轮死亡次数」的玩家键判定：模拟结果的 deaths 表混合玩家（player1 等）与怪物（/monsters/...）
// 键，只统计玩家单位；玩家键以本次模拟的 payload hrid 为准，兜底接受 playerN（player1-5）形式。

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finiteNumber(value, fallback));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// deaths 表里的键是否为玩家单位（玩家 hrid 集合优先，兜底 profitEstimator 的 PLAYER_IDS 白名单）。
function isPlayerDeathHrid(hrid, playerHrids) {
  const key = String(hrid || '');
  if (!key) {
    return false;
  }
  return playerHrids.has(key) || PLAYER_IDS.has(key);
}

function safeStorage(storage = globalThis?.localStorage) {
  return storage && typeof storage.getItem === 'function' ? storage : null;
}

function replaceReactiveObject(target, source) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  Object.assign(target, source);
}

// 玩家构建器按需加载（照 simulatorStore 的 loadPlayerMapperModule 先例：并发去重 + 失败可重试）。
const loadPlayerMapperModule = createCachedModuleLoader(() => import('../services/playerMapper.js'));

export function createDefaultDungeonCalculatorConfig() {
  return {
    dungeonHrid: '',
    difficultyTier: 0,
    // 每轮分钟按「地牢 × 档位」独立覆盖：{ [dungeonHrid]: { [tier]: 分钟 } }；
    // 未设置的组合回落该地牢目录默认值（maxWaves × 15s / 60）。
    runMinutesByDungeonTier: {},
    partySize: DEFAULT_PARTY_SIZE,
    entryKeySource: 'market',
    chestKeySource: 'market',
    // 工匠茶（默认开，2026-10-12 用户裁决）：钥匙自制配方材料 lessResource 折扣（含 coin）。
    artisanTea: true,
    // 暴饮之囊（默认关；导入角色持有则自动勾选）：加浓工匠茶折扣。
    guzzlingPouch: false,
    // 暴饮之囊强化等级（0-20，默认 0；自动按当前角色持有的暴饮之囊等级填充，允许手改）。
    guzzlingLevel: 0,
    // 披风不计算收益（默认关；对齐工具箱 574037 同名选项）：勾选后 7 件披风按 0 估值。
    excludeCapeValue: false,
    // 牛铃不计算收益（默认关；对齐工具箱 574037 同名选项）：勾选后牛铃/牛铃袋按 0 估值，
    // 大宝箱合成价中的牛铃部分一并归零。
    excludeCowbellValue: false,
    // 宝箱钥匙 2% 回收落点：固定 'income'（收入侧计入；2026-10-15 用户裁决，不再提供配置）。
    chestKeyRecoveryMode: 'income',
    // 社区掉落数量加成等级（默认 20 = 满级，2026-10-11 用户裁决：按社区口径放大每轮箱数）。
    communityBuffLevel: 20,
    // 每日消耗品成本（食物 / 饮品，单位：百万金币；对齐 MST 工具箱输入口径）。
    dailyConsumablesCostMillions: 0,
    // 模拟实测每轮消耗品花费（金币）：按「玩家 × 地牢 × 档位」存储——
    // { [playerId]: { [dungeonHrid]: { [tier]: 每轮金币 } } }。药钱归属吃药的该角色本人
    //（不做整队摊薄），页面按当前选中角色取值；0 为合法实测值。未跑模拟 / 未通关 /
    // 该角色未上报消耗品的组合回落「每日药品 / 饮料成本」摊薄口径。
    consumablesCostPerRunByPlayerDungeonTier: {},
    buyMode: 'ask',
    sellMode: 'bid',
    // 「模拟每轮时长」的轮数（不同种子重复次数；每轮模拟窗口固定 24h）。
    simulationRounds: DUNGEON_CALCULATOR_SIMULATION_DEFAULT_ROUNDS,
    priceOverrides: {},
  };
}

// 「地牢 × 档位」数值映射的公共规范化：仅保留 4 地牢白名单 + tier∈[0,2] + 有限数值；
// allowZero=false 要求严格正数（每轮分钟），true 允许 0（模拟实测每轮消耗品花费，0 为合法值）。
// 非法键/值静默丢弃（与 priceOverrides 同款容错口径：损坏持久化数据不炸、回落默认口径）。
function normalizeDungeonTierNumericMap(rawMap, catalogHrids, { allowZero = false } = {}) {
  if (!isPlainObject(rawMap)) {
    return {};
  }
  const normalized = {};
  for (const [hrid, rawTierMap] of Object.entries(rawMap)) {
    if (!catalogHrids.has(hrid) || !isPlainObject(rawTierMap)) {
      continue;
    }
    const tierMap = {};
    for (const [tierKey, rawValue] of Object.entries(rawTierMap)) {
      const tier = Number(tierKey);
      const value = Number(rawValue);
      if (!Number.isInteger(tier) || tier < 0 || tier > 2) {
        continue;
      }
      if (Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)) {
        tierMap[tier] = value;
      }
    }
    if (Object.keys(tierMap).length > 0) {
      normalized[hrid] = tierMap;
    }
  }
  return normalized;
}

// 「玩家 × 地牢 × 档位」数值映射的规范化：仅保留目录白名单内的玩家槽位（player1..playerN）
// 与地牢 hrid + tier∈[0,2] + 有限数值；allowZero=true 允许 0（模拟实测每轮消耗品花费，0 为
// 合法值——该角色窗口内没吃到消耗品）。非法键 / 值静默丢弃（损坏持久化数据不炸、回落默认口径）。
function normalizePlayerDungeonTierNumericMap(rawMap, catalogHrids, { allowZero = true } = {}) {
  if (!isPlainObject(rawMap)) {
    return {};
  }
  const normalized = {};
  for (const [playerId, rawDungeonMap] of Object.entries(rawMap)) {
    const normalizedPlayerId = String(playerId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(normalizedPlayerId) || !isPlainObject(rawDungeonMap)) {
      continue;
    }
    const dungeonMap = normalizeDungeonTierNumericMap(rawDungeonMap, catalogHrids, { allowZero });
    if (Object.keys(dungeonMap).length > 0) {
      normalized[normalizedPlayerId] = dungeonMap;
    }
  }
  return normalized;
}

export function normalizeDungeonCalculatorPersistedState(rawState = {}) {
  const source = isPlainObject(rawState) ? rawState : {};
  const rawConfig = isPlainObject(source.config) ? source.config : source;
  const defaults = createDefaultDungeonCalculatorConfig();
  const catalog = buildDungeonCatalog();
  const catalogHrids = new Set(catalog.map((entry) => entry.actionHrid));
  const requestedDungeonHrid = String(rawConfig.dungeonHrid || '').trim();

  // 每轮分钟映射（地牢 × 档位）：键白名单 + tier 0..2 + 值有限正数，其余静默丢弃。
  const runMinutesByDungeonTier = normalizeDungeonTierNumericMap(rawConfig.runMinutesByDungeonTier, catalogHrids);
  // 模拟实测每轮消耗品花费（玩家 × 地牢 × 档位）：值域为有限非负数（0 = 实测未吃到消耗品）。
  const consumablesCostPerRunByPlayerDungeonTier = normalizePlayerDungeonTierNumericMap(
    rawConfig.consumablesCostPerRunByPlayerDungeonTier,
    catalogHrids,
  );
  const resolvedDungeonHrid = catalogHrids.has(requestedDungeonHrid)
    ? requestedDungeonHrid
    : catalog[0]?.actionHrid || '';
  const resolvedTier = clamp(integer(rawConfig.difficultyTier, defaults.difficultyTier), 0, 2);
  // 旧格式迁移（此前未发布的单值 runMinutes，已被映射取代）：迁到当前选中组合；
  // 新字段对该组合已有值时以新字段为准（不覆盖）。
  if (
    resolvedDungeonHrid &&
    rawConfig.runMinutes != null &&
    rawConfig.runMinutes !== '' &&
    !(runMinutesByDungeonTier[resolvedDungeonHrid]?.[resolvedTier] > 0)
  ) {
    const legacyMinutes = Number(rawConfig.runMinutes);
    if (Number.isFinite(legacyMinutes) && legacyMinutes > 0) {
      runMinutesByDungeonTier[resolvedDungeonHrid] = {
        ...(runMinutesByDungeonTier[resolvedDungeonHrid] || {}),
        [resolvedTier]: legacyMinutes,
      };
    }
  }

  // 回收落点：固定 'income'（收入侧计入；2026-10-15 用户裁决）——旧档的 cost / off / legacy
  // 布尔 chestKeyRecovery 一律归一到 income（不再提供配置）。
  const chestKeyRecoveryMode = 'income';

  const entryKeySource = DUNGEON_KEY_SOURCES.includes(rawConfig.entryKeySource)
    ? rawConfig.entryKeySource
    : defaults.entryKeySource;
  const chestKeySource = DUNGEON_KEY_SOURCES.includes(rawConfig.chestKeySource)
    ? rawConfig.chestKeySource
    : defaults.chestKeySource;
  return {
    version: DUNGEON_CALCULATOR_STORAGE_VERSION,
    config: {
      ...defaults,
      dungeonHrid: resolvedDungeonHrid,
      difficultyTier: resolvedTier,
      runMinutesByDungeonTier,
      partySize: clamp(integer(rawConfig.partySize, defaults.partySize), 1, MAX_PARTY_SIZE),
      entryKeySource,
      chestKeySource,
      // 工匠茶默认开（仅显式 false 关闭）；暴饮之囊仅显式 true 开启；等级钳制 [0, 20]。
      artisanTea: rawConfig.artisanTea !== false,
      guzzlingPouch: rawConfig.guzzlingPouch === true,
      guzzlingLevel: clamp(integer(rawConfig.guzzlingLevel, defaults.guzzlingLevel), 0, MAX_GUZZLING_LEVEL),
      excludeCapeValue: rawConfig.excludeCapeValue === true,
      excludeCowbellValue: rawConfig.excludeCowbellValue === true,
      chestKeyRecoveryMode,
      communityBuffLevel: clamp(
        integer(rawConfig.communityBuffLevel, defaults.communityBuffLevel),
        0,
        MAX_COMMUNITY_BUFF_LEVEL,
      ),
      dailyConsumablesCostMillions: Math.max(
        0,
        finiteNumber(rawConfig.dailyConsumablesCostMillions, defaults.dailyConsumablesCostMillions),
      ),
      consumablesCostPerRunByPlayerDungeonTier,
      buyMode: DUNGEON_BUY_MODES.includes(rawConfig.buyMode) ? rawConfig.buyMode : defaults.buyMode,
      sellMode: DUNGEON_SELL_MODES.includes(rawConfig.sellMode) ? rawConfig.sellMode : defaults.sellMode,
      simulationRounds: clamp(
        integer(rawConfig.simulationRounds, defaults.simulationRounds),
        DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS,
        DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS,
      ),
      priceOverrides: normalizePriceOverrideMap(rawConfig.priceOverrides),
    },
  };
}

export function loadDungeonCalculatorPersistedState(storage = globalThis?.localStorage) {
  const target = safeStorage(storage);
  if (!target) {
    return normalizeDungeonCalculatorPersistedState({});
  }
  try {
    const raw = target.getItem(DUNGEON_CALCULATOR_STORAGE_KEY);
    if (!raw) {
      return normalizeDungeonCalculatorPersistedState({});
    }
    return normalizeDungeonCalculatorPersistedState(JSON.parse(raw));
  } catch (error) {
    // 损坏负载回退默认值（与 enhancementStore 的容错口径一致）。
    return normalizeDungeonCalculatorPersistedState({});
  }
}

export function persistDungeonCalculatorState(state, storage = globalThis?.localStorage) {
  const target = safeStorage(storage);
  if (!target || typeof target.setItem !== 'function') {
    return false;
  }
  try {
    target.setItem(DUNGEON_CALCULATOR_STORAGE_KEY, JSON.stringify(normalizeDungeonCalculatorPersistedState(state)));
    return true;
  } catch (error) {
    return false;
  }
}

export const useDungeonCalculatorStore = defineStore('dungeonCalculator', () => {
  const simulator = useSimulatorStore();
  const persisted = loadDungeonCalculatorPersistedState();
  const config = reactive(persisted.config);
  const initialized = ref(false);

  const catalog = buildDungeonCatalog();

  // 「模拟每轮时长」运行态（响应式：页面按钮 / 进度 / 结果直接绑定；跨功能互斥走
  // simulatorRunConflicts，运行句柄登记在 simulatorWorkerRuns 的专用 scope）。
  const simulation = reactive({
    isRunning: false,
    settledRounds: 0,
    totalRounds: 0,
    error: '',
    lastResult: null,
  });

  // 顶栏「标准 → 铁牛」闸门的响应式锚点镜像：跟随 simulation.isRunning 的整个运行区间
  //（含导入窗口、批运行、finally 复位，以及句柄未注册的收尾窗口），App 顶层据此禁用
  // 模式按钮而不必 import 本 store（避免把 dungeonProfitCalculator 的游戏数据 JSON 拉进
  // 主包）。锚点不并入统一忙碌判定，说明见 services/simulatorRunConflicts.js 文件末尾。
  watch(
    () => simulation.isRunning,
    (value) => setDungeonCalculatorRunInFlight(value),
    { immediate: true },
  );

  // 「模拟每轮时长」取消意图（闭包变量，不进响应式公开面）：专用运行句柄要到批入口调用时
  // 才由 simulatorWorkerRuns 注册，导入窗口（await loadPlayers，首次进入页面时 chunk 仍需
  // 拉取）内的停止请求先落在这里，由 simulateRunMinutes 的导入复查点静默收尾。
  let simulationCancelRequested = false;

  // 「已导入且勾选」的玩家配置（2026-10-15 用户裁决口径）：只有真正导入过数据的勾选玩家才算数
  // ——空槽位勾选 / 勾选残留（幽灵队友）不带偏人数，也不编入模拟队伍（2026-10-16 修复：模拟队伍
  // 与 partySize 联动必须同源；未导入的空配置玩家会以等级 1 无装备参战，拖偏实测每轮时长）。
  const importedSelectedPlayerConfigs = computed(() =>
    simulator.players.filter(
      (player) => player.selected && simulator.queue.importedProfileByPlayer?.[String(player.id)] === true,
    ),
  );

  // 「已导入且勾选」的玩家数：队伍人数自动联动的源。
  const importedSelectedCount = computed(() => importedSelectedPlayerConfigs.value.length);

  // 本次模拟将使用的队伍人数（与 partySize 联动同源）：页面按钮放行 / 未勾选提示同此判定。
  const simulationPartySize = computed(() => importedSelectedCount.value);

  // 是否存在任何已导入玩家：「没导入数据 → 默认 5」的回落判定。
  const hasImportedPlayers = computed(() =>
    simulator.players.some((player) => simulator.queue.importedProfileByPlayer?.[String(player.id)] === true),
  );

  // 当前选中角色（首页顶栏可切换）：模拟实测消耗品花费（药钱）与队伍人数的取值主体。
  const activePlayerId = computed(() => String(simulator.activePlayerId || ''));

  // 当前选中角色持有的暴饮之囊（2026-10-12 用户裁决：只看首页顶栏切换的当前角色）：
  // 读其 pouch 装备槽的 itemHrid 与强化等级；未装备 / 未导入时返回 null。
  // 用 simulator.activePlayer（顶栏选中者，含未勾选队伍的角色）而非 selectedPlayers，
  // 与「导入的角色持有即勾上」的用户语义一致。
  const activePlayerGuzzlingPouch = computed(() => {
    const pouch = simulator.activePlayer?.equipment?.pouch;
    if (String(pouch?.itemHrid || '') !== GUZZLING_POUCH_HRID) {
      return null;
    }
    return { enhancementLevel: clamp(integer(pouch?.enhancementLevel, 0), 0, MAX_GUZZLING_LEVEL) };
  });

  // 自动勾选 + 等级填充：当前角色装备暴饮之囊时勾上并填入其强化等级（允许随后手改）。
  // lastAppliedGuzzlingSignature 记录「已套用自动值的角色 / 等级组合」：签名变化（换角色 /
  // 换装备 / 换等级）才重新套用自动值，否则保留用户手改结果（含手动取消勾选）。
  const guzzlingAutoSignature = computed(() => {
    const player = simulator.activePlayer;
    if (!player) {
      return '';
    }
    const pouch = activePlayerGuzzlingPouch.value;
    return pouch ? `${player.id}|${pouch.enhancementLevel}` : `${player.id}|`;
  });
  let lastAppliedGuzzlingSignature = null;

  function applyGuzzlingPouchAutoDetection() {
    const signature = guzzlingAutoSignature.value;
    if (signature === lastAppliedGuzzlingSignature) {
      return;
    }
    lastAppliedGuzzlingSignature = signature;
    const pouch = activePlayerGuzzlingPouch.value;
    if (pouch) {
      config.guzzlingPouch = true;
      config.guzzlingLevel = pouch.enhancementLevel;
      return;
    }
    // 当前角色未装备暴饮之囊：保留用户手动勾选（不强制关掉），等级归 0 以便换回持有角色时重新填值。
    config.guzzlingLevel = 0;
  }

  watch(guzzlingAutoSignature, applyGuzzlingPouchAutoDetection, { immediate: true, flush: 'sync' });

  // 页面「队伍人数」自动联动（2026-10-15 用户裁决）：
  // - 没导入数据（无任何导入标记）→ 默认 5（满编标准口径）；
  // - 导入数据后 → 跟随「已导入且勾选」的队员数；
  // - 有导入数据但未勾选任何已导入玩家 → 保留现值（0 人不会写成 0，引擎侧钳制 [1, 5]）。
  // immediate + sync：进入页面 / 导入 / 勾选变化即对齐；重置配置后由 resetConfig 重新对齐。
  // 源为数字 computed，同步回调开销可忽略。
  function syncPartySizeWithSelection() {
    const selectedImported = importedSelectedCount.value;
    if (selectedImported > 0) {
      config.partySize = clamp(selectedImported, 1, MAX_PARTY_SIZE);
      return;
    }
    if (!hasImportedPlayers.value) {
      config.partySize = DEFAULT_PARTY_SIZE;
    }
  }

  watch(importedSelectedCount, syncPartySizeWithSelection, { immediate: true, flush: 'sync' });

  const selectedDungeon = computed(
    () => catalog.find((entry) => entry.actionHrid === config.dungeonHrid) || catalog[0] || null,
  );

  // 某「地牢 × 档位」组合的每轮分钟覆盖值（无覆盖 / 非法值返回 null，即回落目录默认时长）。
  function getRunMinutesOverride(dungeonHrid, difficultyTier) {
    const tierMap = config.runMinutesByDungeonTier?.[String(dungeonHrid || '')];
    const minutes = Number(tierMap?.[clamp(integer(difficultyTier, 0), 0, 2)]);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  // 某「地牢 × 档位」组合的模拟实测每轮消耗品花费（0 为合法实测值；无实测值返回 null）。
  // 药钱归属当前选中角色（首页顶栏可切换）：模拟按玩家分别写回，这里只读该角色那一层。
  function getConsumablesCostPerRunOverride(dungeonHrid, difficultyTier) {
    const dungeonMap = config.consumablesCostPerRunByPlayerDungeonTier?.[activePlayerId.value];
    const tierMap = isPlainObject(dungeonMap) ? dungeonMap[String(dungeonHrid || '')] : null;
    const cost = Number(tierMap?.[clamp(integer(difficultyTier, 0), 0, 2)]);
    return Number.isFinite(cost) && cost >= 0 ? cost : null;
  }

  // 当前选中角色的模拟实测每轮消耗品花费映射（「地牢 × 档位」两层，供引擎逐行解析）。
  const activeConsumablesCostByDungeonTier = computed(() => {
    const dungeonMap = config.consumablesCostPerRunByPlayerDungeonTier?.[activePlayerId.value];
    return isPlainObject(dungeonMap) ? dungeonMap : {};
  });

  // 当前选中组合的覆盖值（null = 未覆盖）。
  const currentRunMinutesOverride = computed(() => getRunMinutesOverride(config.dungeonHrid, config.difficultyTier));

  // 当前选中组合的模拟实测消耗品花费（null = 无实测值，回落到每日摊薄口径）。
  const currentConsumablesCostPerRunOverride = computed(() =>
    getConsumablesCostPerRunOverride(config.dungeonHrid, config.difficultyTier),
  );

  // 「每轮分钟」总表（4 地牢 × T0/T1/T2 共 12 行）：覆盖值 / 有效值 / 每日轮数，供页面一览表消费。
  const runMinutesTargetRows = computed(() => {
    const rows = [];
    for (const entry of catalog) {
      for (let tier = 0; tier <= entry.maxDifficulty; tier += 1) {
        const overrideRunMinutes = getRunMinutesOverride(entry.actionHrid, tier);
        const effectiveRunMinutes = overrideRunMinutes ?? entry.defaultRunMinutes;
        rows.push({
          key: `${entry.actionHrid}|${tier}`,
          dungeonHrid: entry.actionHrid,
          dungeonName: entry.name,
          difficultyTier: tier,
          defaultRunMinutes: entry.defaultRunMinutes,
          overrideRunMinutes,
          effectiveRunMinutes,
          runsPerDay: effectiveRunMinutes > 0 ? MINUTES_PER_DAY / effectiveRunMinutes : 0,
        });
      }
    }
    return rows;
  });

  // 模拟目标 = 全部 4 地牢 × T0/T1/T2（按目录顺序 + 档位升序，与 runMinutesTargetRows 同序）。
  function buildSimulationTargets() {
    const targets = [];
    for (const entry of catalog) {
      for (let tier = 0; tier <= entry.maxDifficulty; tier += 1) {
        targets.push({ dungeonHrid: entry.actionHrid, difficultyTier: tier });
      }
    }
    return targets;
  }

  // simulatorStore 的 priceTable 已含全局改价烘焙（rehydratePricingTable）；本页
  // 手动改价在其之上再叠加（applyPriceOverridesToTable 先克隆再烘焙，不改全局状态）。
  const marketPriceTable = computed(() =>
    simulator.pricing?.priceTable && typeof simulator.pricing.priceTable === 'object'
      ? simulator.pricing.priceTable
      : {},
  );

  // 有效价格表管线（顺序固定，勿颠倒）：
  // 1) 口径变换 buildDungeonAlignedPriceTable：在 marketPriceTable 的克隆上叠加两项可选口径
  //    （牛铃不计算收益 → 内部 rebuild 合成条目 → 披风按 0 估值）；两项全关时返回原引用，
  //    产物与「直接使用 marketPriceTable」逐位一致（零行为变化锚点）；
  // 2) 页面手动改价 applyPriceOverridesToTable：最高优先级，覆盖上述对齐结果。
  // nonTradableValuation / taxMode 随对齐线程化给内部 rebuild，保证与全局定价档一致。
  // 已知边界（2026-10-16）：第 1 步开「牛铃不计算收益」时内部 rebuild 会复位合成键，
  // 全局定价页对合成键（coin/宝箱等）的改价在该场景被重算覆盖（见 buildDungeonAlignedPriceTable 注释）。
  const effectivePriceTable = computed(() => {
    const aligned = buildDungeonAlignedPriceTable(marketPriceTable.value, {
      excludeCowbellValue: config.excludeCowbellValue === true,
      excludeCapeValue: config.excludeCapeValue === true,
      nonTradableValuation: simulator.pricing?.nonTradableValuation === true,
      taxMode: simulator.pricing?.taxMode,
    });
    const overrides = config.priceOverrides;
    if (!overrides || Object.keys(overrides).length === 0) {
      return aligned;
    }
    return applyPriceOverridesToTable(aligned, overrides);
  });

  function buildParams(overrides = {}) {
    return {
      dungeonHrid: config.dungeonHrid,
      difficultyTier: config.difficultyTier,
      priceTable: effectivePriceTable.value,
      buyMode: config.buyMode,
      sellMode: config.sellMode,
      entryKeySource: config.entryKeySource,
      chestKeySource: config.chestKeySource,
      // 工匠茶 / 暴饮之囊（2026-10-12 用户裁决）：只作用于 craft 来源的钥匙自制配方材料成本。
      artisanTea: config.artisanTea === true,
      guzzlingPouch: config.guzzlingPouch === true,
      guzzlingLevel: clamp(integer(config.guzzlingLevel, 0), 0, MAX_GUZZLING_LEVEL),
      // 精炼箱掉率：固定脚本共识逐档对象（引擎按档取值；2026-10-11 用户裁决，不再提供切换控件）。
      refinementRateOverride: SCRIPT_REFINEMENT_RATE_BY_TIER,
      // 回收落点：透传 config（2026-10-15 用户裁决：不再提供配置）——normalize 层恒归一为 'income'，
      // normalizeDungeonCalculatorPersistedState 写入的 config 即唯一来源；
      // 引擎只认 'cost' | 'income'，回收恒开。
      chestKeyRecoveryMode: config.chestKeyRecoveryMode,
      chestKeyRecovery: true,
      communityBuffLevel: config.communityBuffLevel,
      // 每日消耗品成本（页面按百万输入，引擎口径为金币）。
      dailyConsumablesCost: Math.max(0, finiteNumber(config.dailyConsumablesCostMillions, 0)) * 1_000_000,
      // 当前选中组合的覆盖值（null 由引擎回退目录默认时长）；仅服务「当前组合」结果卡——
      // 批量对比必须清掉这个统一覆盖位（见 compareRows），否则会串到所有未覆盖行。
      runMinutes: currentRunMinutesOverride.value,
      runMinutesByDungeonTier: config.runMinutesByDungeonTier,
      // 模拟实测每轮消耗品花费（行级覆盖，按「当前角色 × 地牢 × 档位」逐行生效；0 为合法实测值）。
      // 当前选中组合的单值覆盖（null = 无实测值，回落每日摊薄）；切换角色即换值。
      consumablesCostPerRunOverride: currentConsumablesCostPerRunOverride.value,
      consumablesCostPerRunByDungeonTier: activeConsumablesCostByDungeonTier.value,
      partySize: config.partySize,
      ...overrides,
    };
  }

  const result = computed(() => computeDungeonRunProfit(buildParams()));

  // 批量对比行：引擎默认按每轮净利降序（同值按目录序 + 档位升序稳定）；
  // 展示层的列头排序与未通关置底由页面（compareRowsForDisplay）叠加。
  // runMinutes 显式清 null：buildParams 的 runMinutes 是「当前选中组合」的单值覆盖，
  // 作为统一覆盖位会串到所有未做行级覆盖的行（改一格 → 全表跟着变）；
  // 行级覆盖只认 runMinutesByDungeonTier，未覆盖行回落各自 defaultRunMinutes。
  const compareRows = computed(() => compareDungeons(buildParams({ runMinutes: null })));

  const overrideCount = computed(() => Object.keys(config.priceOverrides || {}).length);

  const priceStatus = computed(() => ({
    loading: Boolean(simulator.pricing?.isLoading),
    ready: Boolean(simulator.pricing?.lastFetchedAt || simulator.pricing?.sourceUrl),
    updatedAt: Number(simulator.pricing?.lastFetchedAt || 0),
    sourceUrl: String(simulator.pricing?.sourceUrl || ''),
    error: String(simulator.pricing?.error || ''),
  }));

  const persistedState = computed(() => normalizeDungeonCalculatorPersistedState({ config }));

  watch(
    persistedState,
    (state) => {
      persistDungeonCalculatorState(state);
    },
    { deep: true },
  );

  async function initialize() {
    initialized.value = true;
    await simulator.ensureMarketPricesLoaded(false);
    return true;
  }

  async function refreshPrices() {
    await simulator.ensureMarketPricesLoaded(true);
    return priceStatus.value;
  }

  function resetConfig() {
    const defaults = normalizeDungeonCalculatorPersistedState({});
    replaceReactiveObject(config, defaults.config);
    // 重置回默认 5 后立即按「导入的勾选队员数」重新对齐（无导入数据时保持默认 5）。
    syncPartySizeWithSelection();
    // 暴饮之囊按当前角色持有重新检测（签名缓存失效，强制重新套用自动值）。
    lastAppliedGuzzlingSignature = null;
    applyGuzzlingPouchAutoDetection();
    // 重置即回到「未跑过」形态：上次摘要与未通关门禁一并失效（页面门禁按 lastResult 判定），
    // 否则配置已回默认而零通关组合仍被锁死，与「全部复位」预期相反。运行态字段
    // （isRunning / settledRounds / totalRounds）交由运行自身 finally 复位，此处不触碰。
    simulation.lastResult = null;
    simulation.error = '';
  }

  function setDungeonHrid(hrid) {
    const normalized = String(hrid || '');
    if (!catalog.some((entry) => entry.actionHrid === normalized)) {
      return false;
    }
    config.dungeonHrid = normalized;
    return true;
  }

  function setDifficultyTier(tier) {
    config.difficultyTier = clamp(integer(tier, 0), 0, 2);
    return true;
  }

  // 目标解析：地牢 hrid 必须在目录白名单内、档位为整数 0..2，否则视为非法目标。
  function resolveRunMinutesTarget(dungeonHrid, difficultyTier) {
    const hrid = String(dungeonHrid || '');
    if (!catalog.some((entry) => entry.actionHrid === hrid)) {
      return null;
    }
    const tier = integer(difficultyTier, -1);
    if (tier < 0 || tier > 2) {
      return null;
    }
    return { hrid, tier };
  }

  // 设置某「地牢 × 档位」组合的每轮分钟覆盖值（仅有限正数；整体替换映射对象以稳定触发持久化 watch）。
  function setRunMinutesOverride(dungeonHrid, difficultyTier, value) {
    const target = resolveRunMinutesTarget(dungeonHrid, difficultyTier);
    if (!target) {
      return false;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return false;
    }
    const tierMap = config.runMinutesByDungeonTier[target.hrid] || {};
    config.runMinutesByDungeonTier = {
      ...config.runMinutesByDungeonTier,
      [target.hrid]: { ...tierMap, [target.tier]: parsed },
    };
    return true;
  }

  // 清除某组合的覆盖值（回落目录默认）；原本无覆盖时返回 false。
  function clearRunMinutesOverride(dungeonHrid, difficultyTier) {
    const target = resolveRunMinutesTarget(dungeonHrid, difficultyTier);
    if (!target) {
      return false;
    }
    const tierMap = config.runMinutesByDungeonTier[target.hrid];
    if (!isPlainObject(tierMap) || !(Number(tierMap[target.tier]) > 0)) {
      return false;
    }
    const nextTierMap = { ...tierMap };
    delete nextTierMap[target.tier];
    const nextMap = { ...config.runMinutesByDungeonTier };
    if (Object.keys(nextTierMap).length > 0) {
      nextMap[target.hrid] = nextTierMap;
    } else {
      delete nextMap[target.hrid];
    }
    config.runMinutesByDungeonTier = nextMap;
    return true;
  }

  function setSimulationRounds(value) {
    config.simulationRounds = clamp(
      integer(value, DUNGEON_CALCULATOR_SIMULATION_DEFAULT_ROUNDS),
      DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS,
      DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS,
    );
    return true;
  }

  // 用户点「停止」/ 统一 stopSimulation 联动：取消在途的模拟批运行（promise 以
  // code:'cancelled' 拒绝，simulateRunMinutes 静默收尾）。
  function stopRunMinutesSimulation() {
    if (!simulation.isRunning) {
      return false;
    }
    // 句柄未注册的窗口（首次进入页面、playerMapper chunk 仍在拉取）内，下面的定向取消是
    // 空操作：先落取消意图，由 simulateRunMinutes 的导入复查点收尾。此处不得同步把
    // isRunning 置假——重入守卫依赖它撑过窗口，否则窗口期内再点「模拟」会并发启动第二个批次。
    simulationCancelRequested = true;
    stopDungeonCalculatorWorkerRuns();
    return true;
  }

  // 用导入的队伍（simulatorStore 勾选玩家）跑真实战斗模拟（一次覆盖全部 4 地牢 × T0/T1/T2）：
  // 每个组合每轮一个 24h 播种窗口、默认 3 轮，按组合以「Σ 模拟时长 ÷ Σ 通关次数」写回各自的
  // 每轮分钟（含团灭重开与重开间隔，与 runsPerDay / 日收益公式自洽）；某组合零通关时只记录
  // 失败摘要、保留该组合原值。options 仅测试注入：loadPlayerMapperModule / workerClient / WorkerClientCtor。
  // 取舍（2026-10-15）：拒绝路径（忙碌 / 无队员）不清空历史结果——lastResult 只在本次运行真正开始时复位，
  // 被拒绝时 error 与上次摘要可能并存（页面错误行优先显示，摘要与未通关门禁继续可见）。
  async function simulateRunMinutes(options = {}) {
    if (simulation.isRunning) {
      return false;
    }

    simulation.error = '';
    simulation.settledRounds = 0;
    simulation.totalRounds = 0;
    simulationCancelRequested = false;

    if (isSimulationBusy(simulator)) {
      simulation.error = 'common:dungeonCalculator.simulateErrorBusy';
      return false;
    }

    const rounds = clamp(
      integer(config.simulationRounds, DUNGEON_CALCULATOR_SIMULATION_DEFAULT_ROUNDS),
      DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS,
      DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS,
    );
    const loadPlayers =
      typeof options.loadPlayerMapperModule === 'function' ? options.loadPlayerMapperModule : loadPlayerMapperModule;
    const targets = buildSimulationTargets();
    const startedAt = Date.now();
    // 药钱归属角色在运行开始时定格（运行中切换角色不影响本次写回归属；结果行同时携带按玩家的
    // 每轮值，页面按当前角色读取）。
    const runActivePlayerId = activePlayerId.value;
    simulation.isRunning = true;
    simulation.totalRounds = targets.length * rounds;

    try {
      const { buildPlayersForSimulation } = await loadPlayers();
      // 导入窗口内的停止意图复查：专用句柄此刻尚未注册（要等下面批入口调用），取消在该窗口
      // 是空操作——命中即静默收尾、不提交批次（运行态统一由 finally 复位）。本行到批入口
      // 调用之间不得再引入 await，否则窗口重新打开、需在该 await 之后补第二处复查。
      if (simulationCancelRequested) {
        return false;
      }
      // 模拟队伍与 partySize 联动同源（2026-10-16）：只取「已导入且勾选」的玩家配置——未导入的
      // 空槽位（等级 1 / 无装备）不编入队伍，否则实测每轮时长对应「含空配置玩家的队伍」，而收益
      // 模型按已导入人数建模，参数与模拟口径错位；勾选未导入槽位时按「无有效队员」拒绝并提示导入。
      const simulationPartyConfigs = importedSelectedPlayerConfigs.value;
      const playersToSim = buildPlayersForSimulation(simulationPartyConfigs);
      if (playersToSim.length === 0) {
        simulation.error = 'common:dungeonCalculator.simulateErrorNoPlayers';
        return false;
      }
      // 模拟单位 hrid → 玩家槽位 id（playerMapper 用 `player${playerConfig.id}`，缺 hrid 时按同规则兜底），
      // 用于把 consumablesUsed 的 unitHrid 还原成 config 覆盖映射的玩家键；顺序与 playersToSim 一致。
      const playerIdByHrid = new Map(
        playersToSim.map((player, index) => {
          const configPlayerId = String(simulationPartyConfigs[index]?.id || '');
          const hrid = String(player?.hrid || '') || (configPlayerId ? `player${configPlayerId}` : '');
          return [hrid, configPlayerId];
        }),
      );
      const selectedPlayerIds = Array.from(new Set(Array.from(playerIdByHrid.values()).filter(Boolean)));
      // 参与模拟的玩家单位 hrid 集合：死亡统计据此区分玩家键与怪物键（deaths 表混合两者）。
      const playerHridSet = new Set(playerIdByHrid.keys());
      // 动态导入窗口内可能有其它运行启动：照 queue 基线先例做第二处闸门检查。
      if (isSimulationBusy(simulator)) {
        simulation.error = 'common:dungeonCalculator.simulateErrorBusy';
        return false;
      }

      // 上一轮摘要与门禁只在本次运行真正开始时失效：忙碌 / 无队员等拒绝路径保留上次摘要与
      // 未通关门禁（页面按 lastResult 判定每行平均时长小字与置灰门禁）。
      simulation.lastResult = null;

      // 增益开关沿用首页当前配置（月卡 / 社区经验 / 掉落 / 战斗卷轴），模拟环境与首页一致。
      const baseSettings = {
        mode: 'zone',
        useDungeon: true,
        simulationTimeHours: DUNGEON_CALCULATOR_SIMULATION_HOURS,
        mooPass: Boolean(simulator.simulationSettings?.mooPass),
        comExpEnabled: Boolean(simulator.simulationSettings?.comExpEnabled),
        comExp: Number(simulator.simulationSettings?.comExp || 20),
        comDropEnabled: Boolean(simulator.simulationSettings?.comDropEnabled),
        comDrop: Number(simulator.simulationSettings?.comDrop || 20),
        combatScrollsEnabled: Boolean(simulator.simulationSettings?.combatScrollsEnabled),
      };
      // 12 个组合共 12 × rounds 个播种轮收进同一次批运行（一个专用 realm，省 realm 重建）：
      // 每个组合用独立的种子基（基种子 + 组合序号 × 步长），跨组合随机流不重复、可复现。
      const batchPayloads = [];
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex];
        const basePayload = buildSingleSimulationPayload(
          playersToSim,
          { ...baseSettings, dungeonHrid: target.dungeonHrid, difficultyTier: target.difficultyTier },
          [],
        );
        // 逐轮关闭战斗事件日志：副本 full-result 的团灭日志体积可达 10 倍（同首页多轮先例，
        // 1h 副本夹具 1.16MB vs 104KB）；本流程只读数值字段，日志不影响任何统计。
        basePayload.logCombatEvents = false;
        batchPayloads.push(
          ...buildMultiRoundPayloads(
            basePayload,
            rounds,
            DUNGEON_CALCULATOR_SIMULATION_SEED_BASE + targetIndex * DUNGEON_CALCULATOR_SIMULATION_TARGET_SEED_STRIDE,
          ),
        );
      }

      const batch = await runSimulationBatchWithDedicatedWorker(batchPayloads, () => {}, {
        scope: DEDICATED_WORKER_SCOPE_DUNGEON_CALCULATOR,
        // 每完成一轮（成功或失败）推进进度：批运行上一条结算后才发下一条。
        onItemSettled: () => {
          simulation.settledRounds += 1;
        },
        workerClient: options.workerClient,
        WorkerClientCtor: options.WorkerClientCtor,
      });

      const simResults = Array.isArray(batch?.simResults) ? batch.simResults : [];
      const errors = Array.isArray(batch?.errors) ? batch.errors : [];

      // 模拟轮内消耗品折算（需求：用真实模拟数据算消耗品花费）：consumeCounts[组合] = Map(
      // 玩家 hrid → Map(物品 hrid → 计数) )，按 consumablesUsed（{ [unitHrid]: { [itemHrid]: count } }）
      // 的玩家分组累计，在批运行结束后按各玩家「窗口内花费 ÷ 窗口内通关次数」折算每轮值——
      // 药钱归属吃药的该角色本人（不做整队摊薄，与「每轮 = 一名玩家一次副本」的收益侧同口径）。
      const consumeCounts = targets.map(() => new Map());

      // 按目标聚合：payload 排列 = 组合顺序 × 轮次顺序，index / rounds 即组合序号；
      // worker 报错的轮计入该组合的 failedRounds 且不进时长/通关分母。
      const aggregates = targets.map(() => ({
        successfulRounds: 0,
        failedRounds: 0,
        simulatedTimeNanoseconds: 0,
        dungeonsCompleted: 0,
        dungeonsFailed: 0,
        maxWaveReached: 0,
        minRunMinutes: 0,
        // 引擎是否上报过消耗品字段（成功轮）：未上报（旧引擎 / 裁剪结果）时不做实测写回，
        // 保留每日摊薄口径——脏值 / 缺字段绝不静默把消耗品成本清零。
        hasConsumablesData: false,
        // 窗口内玩家单位死亡总数（deaths 表只取玩家键，怪物键不计）与是否上报过 deaths 字段；
        // 每轮值 = 窗口内死亡总数 ÷ 窗口内通关次数（与每轮分钟同分母）。
        playerDeaths: 0,
        hasDeathsData: false,
      }));
      for (let index = 0; index < batchPayloads.length; index += 1) {
        const targetIndex = Math.floor(index / rounds);
        const aggregate = aggregates[targetIndex];
        const simResult = simResults[index];
        if (!simResult || errors[index]) {
          aggregate.failedRounds += 1;
          continue;
        }
        aggregate.successfulRounds += 1;
        aggregate.simulatedTimeNanoseconds += Math.max(0, finiteNumber(simResult.simulatedTime));
        aggregate.dungeonsCompleted += Math.max(0, integer(simResult.dungeonsCompleted));
        aggregate.dungeonsFailed += Math.max(0, integer(simResult.dungeonsFailed));
        aggregate.maxWaveReached = Math.max(aggregate.maxWaveReached, Math.max(0, integer(simResult.maxWaveReached)));
        // minDungenonTime（官方字段拼写如此）仅完整通关才写入：取各轮最快值做参考。
        const fastestNanoseconds = Math.max(0, finiteNumber(simResult.minDungenonTime));
        if (fastestNanoseconds > 0) {
          const fastestMinutes = fastestNanoseconds / NANOSECONDS_PER_MINUTE;
          aggregate.minRunMinutes =
            aggregate.minRunMinutes > 0 ? Math.min(aggregate.minRunMinutes, fastestMinutes) : fastestMinutes;
        }
        // 死亡：deaths 表同时含玩家（playerN）与怪物（/monsters/...）键，只累计玩家单位；
        // 字段缺失的轮不影响 hasDeathsData 判定（保持 false，展示端回落占位符）。
        const deaths = simResult.deaths;
        if (deaths && typeof deaths === 'object') {
          aggregate.hasDeathsData = true;
          for (const [unitHrid, count] of Object.entries(deaths)) {
            if (!isPlayerDeathHrid(unitHrid, playerHridSet)) {
              continue;
            }
            aggregate.playerDeaths += Math.max(0, finiteNumber(count));
          }
        }
        // 消耗品：按玩家（unitHrid）分组累计该轮实际吃掉的药 / 饮料计数（不参与时长 / 通关分母，
        // 失败轮已在上方剔除）。字段缺失的轮不影响 hasConsumablesData 判定（保持 false）。
        const consumablesUsed = simResult.consumablesUsed;
        if (consumablesUsed && typeof consumablesUsed === 'object') {
          aggregate.hasConsumablesData = true;
          const targetConsumeCounts = consumeCounts[targetIndex];
          for (const [unitHrid, unitTable] of Object.entries(consumablesUsed)) {
            if (!unitTable || typeof unitTable !== 'object') {
              continue;
            }
            let playerCounts = targetConsumeCounts.get(unitHrid);
            if (!playerCounts) {
              playerCounts = new Map();
              targetConsumeCounts.set(unitHrid, playerCounts);
            }
            for (const [itemHrid, count] of Object.entries(unitTable)) {
              const normalizedCount = Math.max(0, finiteNumber(count));
              if (normalizedCount > 0) {
                playerCounts.set(itemHrid, (playerCounts.get(itemHrid) || 0) + normalizedCount);
              }
            }
          }
        }
      }

      const totalSuccessfulRounds = aggregates.reduce((sum, aggregate) => sum + aggregate.successfulRounds, 0);
      if (totalSuccessfulRounds === 0) {
        simulation.error = 'common:dungeonCalculator.simulateErrorFailed';
        return false;
      }

      // 键口径漂移归因收集（见 targetResults 之后的统一输出，每次运行每类至多一条）：
      // 零命中 = 该组合上报了 consumablesUsed 键但无一命中玩家 hrid；部分命中 = 键部分命中。
      // 两者都意味着引擎键与 payload 玩家 hrid 口径漂移（如官方口径 /players/pN）。
      const zeroMatchConsumableTargets = [];
      const partialMatchConsumableTargets = [];
      const targetResults = targets.map((target, targetIndex) => {
        const aggregate = aggregates[targetIndex];
        const avgRunMinutes =
          aggregate.dungeonsCompleted > 0
            ? aggregate.simulatedTimeNanoseconds / NANOSECONDS_PER_MINUTE / aggregate.dungeonsCompleted
            : 0;
        // 消耗品花费按玩家分别折算：computeConsumablesCost 的整队汇总对单玩家子表同样成立，
        // 包一层该玩家自己的单位壳即可（买入不扣税，与成本侧同口径；当前页面的改价叠加后价格表）。
        // 每轮值 = 该玩家窗口内花费 ÷ 窗口内通关次数——药钱归属吃药的该角色本人，不做整队摊薄。
        // 参与模拟但未出现在 consumablesUsed 的玩家（引擎不为其建键 = 窗口内没吃到消耗品）按 0 写回。
        const simConsumablesCostByPlayer = {};
        const simConsumablesCostPerRunByPlayer = {};
        let teamConsumablesTotal = 0;
        if (aggregate.dungeonsCompleted > 0 && aggregate.hasConsumablesData) {
          const targetConsumeCounts = consumeCounts[targetIndex];
          let matchedUnitHridCount = 0;
          const unmatchedUnitHrids = [];
          for (const [unitHrid, playerCounts] of targetConsumeCounts) {
            const playerId = playerIdByHrid.get(unitHrid);
            if (playerId == null) {
              unmatchedUnitHrids.push(unitHrid);
              continue;
            }
            matchedUnitHridCount += 1;
            const cost = computeConsumablesCost(
              { [unitHrid]: Object.fromEntries(playerCounts) },
              effectivePriceTable.value,
              config.buyMode,
            );
            simConsumablesCostByPlayer[playerId] = cost;
            simConsumablesCostPerRunByPlayer[playerId] = cost / aggregate.dungeonsCompleted;
            teamConsumablesTotal += cost;
          }
          // 键口径漂移守卫：引擎上报了 consumablesUsed（键非空）但无一命中本次 payload 玩家 hrid
          // 时按未上报处理——跳过该组合整个实测写回（含补 0，结果行按玩家数据留空、让下方过滤
          // 自然排除），保留每日摊薄口径，绝不静默按 0 清零。部分命中维持逐玩家写回（未命中玩家
          // 沿用「引擎未建键」的补 0 语义），漂移详情走 targetResults 之后的归因日志。
          if (targetConsumeCounts.size > 0 && matchedUnitHridCount === 0) {
            zeroMatchConsumableTargets.push({
              dungeonHrid: target.dungeonHrid,
              difficultyTier: target.difficultyTier,
              keys: unmatchedUnitHrids,
            });
          } else {
            if (unmatchedUnitHrids.length > 0) {
              partialMatchConsumableTargets.push({
                dungeonHrid: target.dungeonHrid,
                difficultyTier: target.difficultyTier,
                keys: unmatchedUnitHrids,
              });
            }
            for (const playerId of selectedPlayerIds) {
              if (!Object.prototype.hasOwnProperty.call(simConsumablesCostPerRunByPlayer, playerId)) {
                simConsumablesCostByPlayer[playerId] = 0;
                simConsumablesCostPerRunByPlayer[playerId] = 0;
              }
            }
          }
        }
        // 当前角色（运行开始时定格）的每轮值：页面读 config 的按角色覆盖，这里仅作结果行回显。
        const activePerRun = simConsumablesCostPerRunByPlayer[runActivePlayerId];
        // 每轮死亡次数 = 窗口内玩家死亡总数 ÷ 窗口内通关次数（与每轮分钟同分母）；零通关 / 未上报时 null。
        const deathsPerRun =
          aggregate.dungeonsCompleted > 0 && aggregate.hasDeathsData
            ? Math.round((aggregate.playerDeaths / aggregate.dungeonsCompleted) * 100) / 100
            : null;
        return {
          dungeonHrid: target.dungeonHrid,
          difficultyTier: target.difficultyTier,
          successfulRounds: aggregate.successfulRounds,
          failedRounds: aggregate.failedRounds,
          dungeonsCompleted: aggregate.dungeonsCompleted,
          dungeonsFailed: aggregate.dungeonsFailed,
          maxWaveReached: aggregate.maxWaveReached,
          minRunMinutes: aggregate.minRunMinutes > 0 ? aggregate.minRunMinutes : null,
          avgRunMinutes: avgRunMinutes > 0 ? avgRunMinutes : null,
          // 窗口内玩家死亡总数与每轮平均死亡次数（收益卡「死亡次数」指标的数据源）。
          playerDeaths: Math.round(aggregate.playerDeaths * 100) / 100,
          deathsPerRun,
          // 整队窗口内总花费（各玩家之和）与当前角色的每轮值（两位小数，避免无意义的超长尾数）。
          simConsumablesCost: teamConsumablesTotal,
          simConsumablesCostPerRun:
            Number.isFinite(activePerRun) && activePerRun >= 0 ? Math.round(activePerRun * 100) / 100 : null,
          simConsumablesCostByPlayer,
          simConsumablesCostPerRunByPlayer: Object.fromEntries(
            Object.entries(simConsumablesCostPerRunByPlayer).map(([playerId, value]) => [
              playerId,
              Math.round(value * 100) / 100,
            ]),
          ),
        };
      });

      // 键口径漂移归因输出：每次运行每类至多一条（组合取前 3 个样例、每样例键取前 3 个）。
      // 零命中的组合已按未上报跳过实测写回；部分命中的组合照常写回、未命中玩家沿用补 0。
      // 排查收益异常时靠此日志区分「确实没吃消耗品」与「键不匹配被丢弃」。
      for (const [logTargets, consequence] of [
        [zeroMatchConsumableTargets, '无一命中（已跳过实测写回，保留每日摊薄口径）'],
        [partialMatchConsumableTargets, '部分命中（未命中玩家按 0 写回）'],
      ]) {
        if (logTargets.length > 0) {
          const sample = logTargets
            .slice(0, 3)
            .map((item) => `${item.dungeonHrid}#${item.difficultyTier}[keys=${item.keys.slice(0, 3).join(',')}]`)
            .join('；');
          console.warn(
            `[dungeonCalculator] consumablesUsed 键与本次玩家 hrid 口径漂移（${logTargets.length} 个组合，${consequence}）。样例：${sample}`,
          );
        }
      }

      // 仅对该组合有通关记录时写回（零通关组合保留原值）；保留两位小数，避免无意义的超长尾数。
      let appliedTargets = 0;
      for (const row of targetResults) {
        if (!(row.avgRunMinutes > 0)) {
          continue;
        }
        const appliedMinutes = Math.round(row.avgRunMinutes * 100) / 100;
        if (appliedMinutes > 0 && setRunMinutesOverride(row.dungeonHrid, row.difficultyTier, appliedMinutes)) {
          appliedTargets += 1;
        }
      }
      // 模拟实测消耗品花费写回（按「玩家 × 地牢 × 档位」逐行覆盖每日摊薄值；零通关 / 无实测值不写回）。
      // 过滤只看「有通关 + 至少一名参与玩家有按角色数据」：当前角色若未参与模拟（运行中切走）也要把
      // 其余队员的实测值正常写回，其自身回显 null、读侧回落到每日摊薄口径。
      const appliedConsumablesTargets = applySimulationConsumablesCostOverrides(
        targetResults.filter(
          (row) =>
            row.avgRunMinutes > 0 &&
            row.simConsumablesCostPerRunByPlayer &&
            Object.keys(row.simConsumablesCostPerRunByPlayer).length > 0,
        ),
      );

      simulation.lastResult = {
        rounds,
        targets: targetResults,
        totalRounds: batchPayloads.length,
        successfulRounds: totalSuccessfulRounds,
        failedRounds: batchPayloads.length - totalSuccessfulRounds,
        appliedTargets,
        appliedConsumablesTargets,
        simulationHours: DUNGEON_CALCULATOR_SIMULATION_HOURS,
        dungeonsCompleted: targetResults.reduce((sum, row) => sum + row.dungeonsCompleted, 0),
        dungeonsFailed: targetResults.reduce((sum, row) => sum + row.dungeonsFailed, 0),
        playerDeaths: Math.round(targetResults.reduce((sum, row) => sum + row.playerDeaths, 0) * 100) / 100,
        elapsedSeconds: (Date.now() - startedAt) / 1000,
      };
      return true;
    } catch (error) {
      // 取消（用户停止 / stopSimulation 联动 / 导入窗口内的停止意图）静默收尾；其余失败统一提示。
      if (!isWorkerRunCancelledError(error) && !simulationCancelRequested) {
        simulation.error = 'common:dungeonCalculator.simulateErrorFailed';
      }
      return false;
    } finally {
      simulation.isRunning = false;
      simulationCancelRequested = false;
    }
  }

  function setPartySize(value) {
    config.partySize = clamp(integer(value, DEFAULT_PARTY_SIZE), 1, MAX_PARTY_SIZE);
    return true;
  }

  // 工匠茶（默认开）：仅显式 false 关闭。
  function setArtisanTea(enabled) {
    config.artisanTea = enabled !== false;
    return true;
  }

  // 暴饮之囊（默认关）：仅显式 true 开启；手动改动即视为用户意图（不参与自动检测回填）。
  function setGuzzlingPouch(enabled) {
    config.guzzlingPouch = enabled === true;
    return true;
  }

  // 暴饮之囊强化等级：钳制 [0, 20]（游戏强化上限），脏值按 0 处理。
  function setGuzzlingLevel(level) {
    config.guzzlingLevel = clamp(integer(level, 0), 0, MAX_GUZZLING_LEVEL);
    return true;
  }

  // 披风不计算收益（默认关）：仅显式 true 开启——7 件披风按 0 估值。
  function setExcludeCapeValue(enabled) {
    config.excludeCapeValue = enabled === true;
    return true;
  }

  // 牛铃不计算收益（默认关）：仅显式 true 开启——牛铃/铃袋按 0，大宝箱牛铃部分归零。
  function setExcludeCowbellValue(enabled) {
    config.excludeCowbellValue = enabled === true;
    return true;
  }

  function setCommunityBuffLevel(level) {
    config.communityBuffLevel = clamp(integer(level, 0), 0, MAX_COMMUNITY_BUFF_LEVEL);
    return true;
  }

  function setDailyConsumablesCostMillions(value) {
    config.dailyConsumablesCostMillions = Math.max(0, finiteNumber(value, 0));
    return true;
  }

  // 模拟实测消耗品花费写回：把行结果（dungeonHrid / difficultyTier / simConsumablesCostPerRunByPlayer）
  // 合并进「玩家 × 地牢 × 档位」映射（整体替换对象以稳定触发持久化 watch）；返回实际写入行数。
  // 已写回组合的旧值被新实测值覆盖；未列入的行保持原值；无按玩家数据的行（零通关 / 未上报）跳过。
  function applySimulationConsumablesCostOverrides(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return 0;
    }
    const nextMap = {};
    for (const [playerId, dungeonMap] of Object.entries(config.consumablesCostPerRunByPlayerDungeonTier || {})) {
      const clonedDungeonMap = {};
      for (const [hrid, tierMap] of Object.entries(dungeonMap || {})) {
        clonedDungeonMap[hrid] = { ...tierMap };
      }
      nextMap[playerId] = clonedDungeonMap;
    }
    let applied = 0;
    for (const row of rows) {
      const hrid = String(row?.dungeonHrid || '');
      const tier = integer(row?.difficultyTier, -1);
      if (!hrid || tier < 0 || tier > 2) {
        continue;
      }
      const perPlayer = isPlainObject(row?.simConsumablesCostPerRunByPlayer)
        ? row.simConsumablesCostPerRunByPlayer
        : null;
      if (!perPlayer) {
        continue;
      }
      let rowApplied = false;
      for (const [rawPlayerId, rawValue] of Object.entries(perPlayer)) {
        const playerId = String(rawPlayerId || '').trim();
        const value = Number(rawValue);
        if (!playerId || !Number.isFinite(value) || value < 0) {
          continue;
        }
        nextMap[playerId] = { ...(nextMap[playerId] || {}) };
        nextMap[playerId][hrid] = { ...(nextMap[playerId][hrid] || {}), [tier]: value };
        rowApplied = true;
      }
      if (rowApplied) {
        applied += 1;
      }
    }
    if (applied > 0) {
      config.consumablesCostPerRunByPlayerDungeonTier = nextMap;
    }
    return applied;
  }

  function setPriceOverride(itemHrid, mode, value) {
    const hrid = String(itemHrid || '');
    const normalizedMode = mode === 'ask' || mode === 'bid' ? mode : '';
    if (!hrid || !normalizedMode) {
      return false;
    }
    const normalizedValue = normalizePriceOverrideValue(value);
    if (normalizedValue === null) {
      return false;
    }
    const next = normalizePriceOverrideMap(config.priceOverrides);
    const entry = { ...(next[hrid] || {}) };
    entry[normalizedMode] = normalizedValue;
    next[hrid] = entry;
    config.priceOverrides = next;
    return true;
  }

  function clearPriceOverrideMode(itemHrid, mode) {
    const hrid = String(itemHrid || '');
    const normalizedMode = mode === 'ask' || mode === 'bid' ? mode : '';
    if (!hrid || !normalizedMode) {
      return false;
    }
    const next = normalizePriceOverrideMap(config.priceOverrides);
    const entry = { ...(next[hrid] || {}) };
    if (!Object.prototype.hasOwnProperty.call(entry, normalizedMode)) {
      return false;
    }
    delete entry[normalizedMode];
    if (Object.keys(entry).length > 0) {
      next[hrid] = entry;
    } else {
      delete next[hrid];
    }
    config.priceOverrides = next;
    return true;
  }

  function clearPriceOverride(itemHrid) {
    const hrid = String(itemHrid || '');
    if (!hrid || !Object.prototype.hasOwnProperty.call(config.priceOverrides || {}, hrid)) {
      return false;
    }
    const next = normalizePriceOverrideMap(config.priceOverrides);
    delete next[hrid];
    config.priceOverrides = next;
    return true;
  }

  function clearAllPriceOverrides() {
    if (Object.keys(config.priceOverrides || {}).length === 0) {
      return false;
    }
    config.priceOverrides = {};
    return true;
  }

  return {
    config,
    initialized,
    catalog,
    selectedDungeon,
    marketPriceTable,
    effectivePriceTable,
    result,
    compareRows,
    overrideCount,
    priceStatus,
    simulation,
    simulationPartySize,
    activePlayerId,
    activeConsumablesCostByDungeonTier,
    initialize,
    refreshPrices,
    resetConfig,
    setDungeonHrid,
    setDifficultyTier,
    setRunMinutesOverride,
    clearRunMinutesOverride,
    setSimulationRounds,
    getRunMinutesOverride,
    getConsumablesCostPerRunOverride,
    currentRunMinutesOverride,
    currentConsumablesCostPerRunOverride,
    runMinutesTargetRows,
    simulateRunMinutes,
    stopRunMinutesSimulation,
    setPartySize,
    setArtisanTea,
    setGuzzlingPouch,
    setGuzzlingLevel,
    activePlayerGuzzlingPouch,
    setExcludeCapeValue,
    setExcludeCowbellValue,
    setCommunityBuffLevel,
    setDailyConsumablesCostMillions,
    setPriceOverride,
    clearPriceOverrideMode,
    clearPriceOverride,
    clearAllPriceOverrides,
  };
});
