// racing 有效性实证研究（2026-09-24，设计 §30.8）—— 引擎入口。
// esbuild 打包成单文件 ESM 后给 scripts/trigger-optimizer-racing-study.mjs 的主进程与
// worker_threads 共用；不启动应用/服务器（与 benchmark-food-optimizer*.mjs 同款模式）。
//
// runPayload 与 src/worker.js 的 'start_simulation' 分支**逐行同构**（worker 是浏览器
// realm 里唯一的模拟入口，本文件只是把同一段逻辑搬到 Node 能 import 的形态）——两处若
// 发生漂移，实测结论就不再代表生产行为：**改动 worker.js 时必须同步这里**。
import CombatSimulator from '../src/combatsimulator/combatSimulator.js';
import Player from '../src/combatsimulator/player.js';
import Zone from '../src/combatsimulator/zone.js';
import Labyrinth from '../src/combatsimulator/labyrinth.js';
import { buildSimulationExtraBuffs } from '../src/shared/simulationExtraBuffs.js';
import { createSeededRandom } from '../src/services/seededRandom.js';
import { buildPlayersForSimulation } from '../src/services/playerMapper.js';
import { buildSimulationExtra, buildSingleSimulationPayload } from '../src/services/simulationDomain.js';
import {
  TRIGGER_OPTIMIZER_WORKER_ID,
  applyCandidateToPlayerConfig,
} from '../src/services/triggerOptimizerSimulation.js';
import { isPlainObject } from '../src/services/utils.js';

// 与 worker.js installSeedScope 同构（公共随机数的载体）：给定 seed 时本次模拟全程
// 运行在确定性随机流上，「同一 payload + 同一 seed」产出完全相同的 simResult。
export function installSeedScope(seed) {
  if (!Number.isFinite(Number(seed))) return null;
  const originalRandom = Math.random;
  Math.random = createSeededRandom(Number(seed) >>> 0);
  return () => {
    Math.random = originalRandom;
  };
}

export async function runPayload(payload) {
  const extra = payload.extra || {};
  const extraBuffs = buildSimulationExtraBuffs(extra);
  const playersData = payload.players;
  const players = [];
  let zone = null;
  if (payload.zone) {
    zone = new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier);
  }
  let labyrinth = null;
  if (payload.labyrinth) {
    labyrinth = new Labyrinth(
      payload.labyrinth.labyrinthHrid,
      payload.labyrinth.roomLevel,
      payload.labyrinth.crates,
      payload.labyrinth.shopUpgrades,
    );
  }
  for (let i = 0; i < playersData.length; i += 1) {
    const currentPlayer = Player.createFromDTO(structuredClone(playersData[i]));
    // 与 worker.js 相同的共享语义：zoneBuffs/extraBuffs 按引用共享给全队伍，
    // 跨模拟安全依赖引擎 addPermanentBuff「首次写入必克隆」。
    currentPlayer.zoneBuffs = zone?.buffs || labyrinth?.buffs || [];
    currentPlayer.extraBuffs = extraBuffs;
    players.push(currentPlayer);
  }
  const combatSimulator = new CombatSimulator(players, zone, labyrinth, {
    enableHpMpVisualization: Boolean(extra.enableHpMpVisualization),
    combatScrollsEnabled: Boolean(extra.combatScrollsEnabled),
    isGuildTrial: Boolean(payload.simulationContext?.isGuildTrial),
    logCombatEvents: payload.logCombatEvents !== false,
  });
  const restoreRandom = installSeedScope(payload.seed);
  try {
    return await combatSimulator.simulate(payload.simulationTimeLimit);
  } finally {
    if (restoreRandom) restoreRandom();
  }
}

// ── 队伍载荷（2026-09-27，设计 §59）────────────────────────────────────────────
// 与生产的队伍载荷**逐行同构**：players = 「被优化角色 + 冻结的队友」（队友只强制 selected，不动其
// triggerMap），候选只改主角。生产侧实现见 buildCandidatePayload 的 `options.teammates`
//（2026-09-27 落地，设计 §59.5 实施项 2）——本函数是研究装置保留的副本：装置不依赖 store / UI，
// 历史实测因此可离线复现；两处口径必须一起演进（改动任一侧都要同步另一侧）。
// 主角保持 player1（引擎 hrid = `player${config.id}`），队友按传入顺序为 player2…；
// 指标上下文仍用主角 id（collectMetrics 按 preferredPlayerId 归集 ⇒ 口径不变）。
export function buildPartyCandidatePayload(
  playerConfig,
  teammateConfigs,
  simulationSettings,
  extra,
  candidate,
  options = {},
) {
  const config = applyCandidateToPlayerConfig(playerConfig, candidate);
  const teammates = (Array.isArray(teammateConfigs) ? teammateConfigs : []).map((teammate) =>
    applyCandidateToPlayerConfig(teammate, null),
  );
  const players = buildPlayersForSimulation([config, ...teammates]);
  const settings = isPlainObject(simulationSettings) ? simulationSettings : {};
  const baseExtra = isPlainObject(extra) ? extra : buildSimulationExtra(settings);
  const payload = buildSingleSimulationPayload(players, settings, [], {
    workerId: TRIGGER_OPTIMIZER_WORKER_ID,
    extra: { ...baseExtra, enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  if (Number.isFinite(Number(options.seed))) payload.seed = Number(options.seed) >>> 0;
  return payload;
}

// ── 生产模块再导出 ────────────────────────────────────────────────────────────
// 研究的采样、聚合、打分、筛选**全部走生产实现**：实验回放的就是生产决策逻辑本身，
// 不允许在研究脚本里重写任何判据（否则测的就不是线上那套口径）。
export {
  aggregateRoundMetrics,
  applyCandidateToPlayerConfig,
  buildCandidatePayload,
  collectMetrics,
  resolveOptimizerResources,
} from '../src/services/triggerOptimizerSimulation.js';
export {
  TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE,
  compareCandidates,
  computePairedStats,
  hasAdoptionEvidence,
  isAdoptionBlockedByEvidence,
  // 复核轮数自适应（设计 §49）：反解与执行计划都取生产实现 —— 脚本里不另抄「多少轮算够」。
  planTriggerOptimizerRobustnessRounds,
  // 追加复验堆叠对照（设计 §50）：每次追加的执行计划取生产实现 —— 堆叠回放的就是生产决策本身。
  planTriggerOptimizerVerificationAppend,
  resolveTriggerOptimizerRobustnessRounds,
  resolveTriggerOptimizerVerificationRounds,
  scoreCandidate,
  shouldAdoptCandidate,
} from '../src/services/triggerOptimizerScoring.js';
// 复核对照（设计 §49）要按生产口径解析「相邻难度」：不另抄一套档位规则。
export { resolveAdjacentDifficultyTier } from '../src/services/simulationDomain.js';
export {
  TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS,
  isRacingPool,
  pickRacingSurvivors,
} from '../src/services/triggerOptimizerSearch.js';
export {
  TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS,
  buildCandidateConfigs,
  buildRefinedCandidates,
} from '../src/services/triggerOptimizerCandidates.js';
// 缺口族量化（设计 §33）用生产同款入口自证合法性、生成与生产同格式的候选签名：脚本里手搓
// 「签名格式」「合法三件套」这类口径迟早与生产漂移，测出来就不是线上那套了。
export { sanitizeTriggerList } from '../src/services/triggerMapper.js';
// 深挖窗口可达性（设计 §44）要按生产预设表枚举「档位 × 时长 → 轮数 / 上限」：预设表与解析函数
// 直接取生产实现，脚本里不另抄一份档位定义（档位改了这里跟着变）。
export {
  buildTriggerCandidateSignature,
  createTriggerOptimizerSeedSet,
  normalizeTriggerOptimizerSettings,
  resolveTriggerOptimizerPresetRounds,
  TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS,
  TRIGGER_OPTIMIZER_PRESETS,
  TRIGGER_OPTIMIZER_RACING_KEEP,
  TRIGGER_OPTIMIZER_RACING_MIN_POOL,
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
  // 复核复跑对照（设计 §51）要按生产口径复算「复跑恒等」与「换盐 = 新样本」：盐常量与两级护栏
  // 比例都取生产实现 —— 脚本里不另抄一份盐名 / 比例（抄了必然与生产漂移）。
  TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
  TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO,
  TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO,
  // 复验轮数自适应（设计 §47）：轮数 / 上限与反解函数都取生产实现 —— 脚本里不另抄「多少轮算够」。
  // 复核轮数自适应（设计 §49）同理：保底 / 上限 / 反解 / 计划全取生产实现。
  // 队伍载荷复核链（设计 §63）复验首轮保底轮数同源。
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
} from '../src/services/triggerOptimizerDomain.js';
export { importSoloConfig } from '../src/services/importExportMapper.js';
export { createEmptyPlayerConfig } from '../src/services/playerMapper.js';
export { default as modernPlayerJunglePlanetFixture } from '../src/services/__tests__/fixtures/modernPlayerJunglePlanetFixture.json';
// 队伍载荷评估（设计 §59）的队友来源：官方向导存档（真实数据，法系，等级略低于主角色）。
export { default as junglePlanetOfficialParityUserFixture } from '../src/services/__tests__/fixtures/junglePlanetOfficialParityUser.json';
