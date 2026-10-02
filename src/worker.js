import Player from './combatsimulator/player';
import Zone from './combatsimulator/zone';
import Labyrinth from './combatsimulator/labyrinth';
import { buildSimulationExtraBuffs } from './shared/simulationExtraBuffs.js';
import { getWasmProductionDiagnostics, tryRunWasmProductionRound } from './services/wasmProductionSimulation.js';
import { createFoodOptimizerEvaluator } from './services/foodOptimizerSimulation.js';

// 确定性播种（公共随机数 / Common Random Numbers）
// -------------------------------------------------
// payload.seed 是**可选**字段。给定时，wasm 引擎按该种子跑出完全确定的 simResult
// （Rust RNG 自带确定性，不消耗 Math.random）。不传 seed 时（首页单轮 / 批量区域扫描）
// 随机采一个，保持「每场独立随机流」的统计语义。
// 切片 21A：JS 引擎回退分支已删除——wasm 产物随仓库提交（public/engine/pkg），
// 引擎缺失/不支持/运行失败属于构建事故，直接上报 simulation_error 硬失败
// （审计定案 D1），不再静默回退。
function pickWasmSeed(seed) {
  if (Number.isFinite(Number(seed))) {
    return Number(seed) >>> 0;
  }
  // 采随机种子时 Math.random 仍是原生（此时还没进入任何播种作用域）。
  return (Math.random() * 0x100000000) >>> 0;
}

// ── 食物优化器协议（切片 22：自 src/foodOptimizerWorker.js 并入，原文件已删除）──
// Vite 5 的 worker 是每入口一次独立 Rollup 构建（manualChunks 不生效、跨构建不共享
// chunk，见 memory pitfall），两个入口意味着两份 ~3.67MB bundle（战斗 B 层 + gameData
// + wasm 桥各打包一次）。并入后单 worker 入口双协议：浏览器只下载/缓存一个 worker
// 文件，首页模拟、批量扫描与食物优化器共享同一 URL。
// 协议形状与原 foodOptimizerWorker 逐字一致：init / 裸候选消息（无 type，或
// type:'evaluate'）；协调器在调用挂起期间不发新消息，同一时刻至多一条在处理——
// 重叠消息会破坏评估器状态，必须大声失败。
let foodOptimizerEvaluate;
let foodOptimizerEvaluating = false;
async function handleFoodOptimizerMessage(data) {
  try {
    if (foodOptimizerEvaluating) throw new Error('Overlapping message while a food optimizer evaluation is in flight.');
    if (data.type === 'init') {
      foodOptimizerEvaluate = createFoodOptimizerEvaluator(data.request, {
        collectThresholds: data.collectThresholds !== false,
        sharedRounds: data.sharedRounds === true,
        items: data.items,
      });
      self.postMessage({ type: 'result' });
      return;
    }
    foodOptimizerEvaluating = true;
    try {
      const result = await foodOptimizerEvaluate(
        data.candidate,
        data.deathBudget,
        (progress) => self.postMessage({ type: 'progress', ...progress }),
        data.reusableSamples,
        data.costCutoff,
      );
      self.postMessage({ type: 'result', result });
    } finally {
      foodOptimizerEvaluating = false;
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || String(error) });
  }
}

self.onmessage = async function (event) {
  const data = event.data ?? {};
  if (data.type === 'init' || data.type === 'evaluate' || data.candidate !== undefined) {
    await handleFoodOptimizerMessage(data);
    return;
  }
  switch (event.data.type) {
    // 空闲预热握手（enginePrewarm.js）：能处理到这条消息说明 worker bundle 已下载
    // 并执行完毕（冷启动资源已进 HTTP 缓存）；立即回 pong 让主线程 terminate 本 realm。
    // 不做任何模拟，与 start_simulation 完全隔离。
    case 'prewarm_ping': {
      this.postMessage({ type: 'prewarm_pong' });
      break;
    }
    case 'start_simulation': {
      let extra = event.data.extra || {};
      let extraBuffs = buildSimulationExtraBuffs(extra);

      // 在 DTO 中保留已配置的行，以便结果可以说明
      // 卷轴效果已被暂停；引擎会应用该
      // 开关，且不修改用户已保存的配置。
      let playersData = event.data.players;
      let players = [];
      let zone = null;
      if (event.data.zone) {
        zone = new Zone(event.data.zone.zoneHrid, event.data.zone.difficultyTier);
      }
      let labyrinth = null;
      if (event.data.labyrinth) {
        labyrinth = new Labyrinth(
          event.data.labyrinth.labyrinthHrid,
          event.data.labyrinth.roomLevel,
          event.data.labyrinth.crates,
          event.data.labyrinth.shopUpgrades,
        );
      }
      for (let i = 0; i < playersData.length; i++) {
        let currentPlayer = Player.createFromDTO(structuredClone(playersData[i]));
        // zoneBuffs/extraBuffs 刻意按引用共享给全队伍（区域/补给箱 buff 还是模块级
        // JSON 常量）：跨玩家安全依赖引擎侧 addPermanentBuff「首次写入必克隆」。
        // 禁止就地改写这些对象（会永久污染同一 worker realm 的下一次模拟），
        // 也不要绕过 addPermanentBuff 直接写 permanentBuffs。
        // buff 按「labyrinth 非空即迷宫模式」显式选取（与引擎一致：scrollsAllowed、
        // 模式标签、遭遇取用都是 labyrinth 优先）。正常路径的 zone / labyrinth
        // 严格互斥，此时与旧写法 `zone?.buffs || labyrinth?.buffs` 等价；
        // 仅 HomeExperimentalModal 批处理透传用户 JSON 可能双非空——显式选取
        // 消除该边界。
        currentPlayer.zoneBuffs = (labyrinth ? labyrinth.buffs : zone?.buffs) || [];
        currentPlayer.extraBuffs = extraBuffs;
        players.push(currentPlayer);
      }
      let simulationTimeLimit = event.data.simulationTimeLimit;
      let enableHpMpVisualization = Boolean(extra.enableHpMpVisualization);

      const options = {
        minimalResult: event.data.minimalResult === true,
        // 仅当调用方显式传 false 时关闭战斗事件日志（默认 true = 历史行为）。
        // 优化器会关掉它：wipe 日志与逐事件控制台输出对只读指标的评估毫无价值。
        logCombatEvents: event.data.logCombatEvents !== false,
        enableHpMpVisualization,
        combatScrollsEnabled: Boolean(extra.combatScrollsEnabled),
        isGuildTrial: Boolean(event.data.simulationContext?.isGuildTrial),
      };

      // 切片 21A：无条件走 wasm 引擎（切片 18 起生产载荷默认带 useWasmEngine: true；
      // 不带的入口——HomeExperimentalModal 批处理手写载荷——由这里的 true 兜底）。
      // wasm 输出为 null（引擎缺失 / 配置不受支持 / 运行出错）时按审计定案 D1
      // 上报 simulation_error 硬失败：产物已随仓库提交，不可达 = 构建事故。
      const wasmOutput = await tryRunWasmProductionRound({
        useWasmEngine: true,
        players,
        zone,
        labyrinth,
        simulationContext: event.data.simulationContext,
        seed: pickWasmSeed(event.data.seed),
        simulationTimeLimit,
        options,
      });
      if (wasmOutput) {
        this.postMessage({ type: 'simulation_result', simResult: wasmOutput.simResult });
        break;
      }

      const reason = getWasmProductionDiagnostics().lastFallbackReason || 'unknown';
      console.error(`[worker] WASM engine unavailable (reason: ${reason}); no JS fallback exists (slice 21A).`);
      // simulation_error 按 errorCode 分两类（消费端 workerClient 据此分流批量路径）：
      // - engine_unavailable：wasm 引擎加载失败已被本 realm 的模块级缓存记住，本 realm 内
      //   不可恢复（realm 级 sticky 失败），复用只会立刻再次失败；
      // - round_error：仅本场运行失败（配置不支持 / 快照构造 / 运行时抛错），同一 realm 的
      //   后续运行仍可能成功（单场级失败）。
      const errorCode = reason === 'engine_unavailable' ? 'engine_unavailable' : 'round_error';
      this.postMessage({
        type: 'simulation_error',
        error: new Error(`WASM combat engine unavailable (${reason}); the JS engine fallback was removed.`),
        errorCode,
      });
      break;
    }
  }
};
