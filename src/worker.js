import CombatSimulator from './combatsimulator/combatSimulator';
import Player from './combatsimulator/player';
import Zone from './combatsimulator/zone';
import Labyrinth from './combatsimulator/labyrinth';
import { buildSimulationExtraBuffs } from './shared/simulationExtraBuffs.js';
import { createSeededRandom } from './services/seededRandom.js';
import { tryRunWasmProductionRound } from './services/wasmProductionSimulation.js';

// 确定性播种（公共随机数 / Common Random Numbers）
// -------------------------------------------------
// payload.seed 是**可选**字段。给定时，本次模拟全程运行在按种子生成的随机数发生器上，
// 于是「同一 payload + 同一 seed」在任意时刻、任意机器上都产出完全相同的 simResult。
// 这让优化器可以把同一组种子喂给基线与全部候选，把「候选 vs 基线」的差异变成
// 配对差（同一随机流下的事件路径差异），大幅抑制随机噪声——技能优化精度的来源。
//
// 不传 seed 时行为与历史完全一致（原生 Math.random），其他调用方（首页模拟 / 队列 /
// 推荐扫描）不受任何影响。每次 runSingleSimulationPayloadWithDedicatedWorker 都会
// 新建一个 Worker（全新 realm），因此播种是 realm 私有的，不存在跨任务串扰。
function installSeedScope(seed) {
  if (!Number.isFinite(Number(seed))) return null;
  const originalRandom = Math.random;
  Math.random = createSeededRandom(Number(seed) >>> 0);
  return () => {
    Math.random = originalRandom;
  };
}

onmessage = async function (event) {
  switch (event.data.type) {
    case 'start_simulation':
      let extra = event.data.extra || {};
      let extraBuffs = buildSimulationExtraBuffs(extra);

      // 在 DTO 中保留已配置的行，以便结果可以说明
      // 卷轴效果已被暂停；CombatSimulator 会应用该
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
        // buff 按「labyrinth 非空即迷宫模式」显式选取（与 CombatSimulator 一致：
        // scrollsAllowed、模式标签、遭遇取用都是 labyrinth 优先）。正常路径的
        // zone / labyrinth 严格互斥（buildSingleSimulationPayload 的 if/else、
        // multiWorker 单键消息、advisorDomain 的 labyrinth:null），此时与旧写法
        // `zone?.buffs || labyrinth?.buffs` 等价；仅 HomeExperimentalModal 批处理
        // 透传用户 JSON 可能双非空——旧写法在 zone.buffs 为空数组时被 truthy 的
        // `[]` 短路、静默吞掉迷宫 buff，这里显式选取消除该边界。
        currentPlayer.zoneBuffs = (labyrinth ? labyrinth.buffs : zone?.buffs) || [];
        currentPlayer.extraBuffs = extraBuffs;
        players.push(currentPlayer);
      }
      let simulationTimeLimit = event.data.simulationTimeLimit;
      let enableHpMpVisualization = Boolean(extra.enableHpMpVisualization);

      // 切片 5-B A/B 开关（默认关）：仅当调用方显式传 `useWasmEngine: true` 且配置落在
      // wasm 引擎覆盖范围内（minimal 结果 + 无副本/迷宫/卷轴/日志/可视化）时才走 wasm；
      // 其余情况 `tryRunWasmProductionRound` 返回 null，静默回退下面的 JS 引擎。
      const options = {
        minimalResult: event.data.minimalResult === true,
        // 仅当调用方显式传 false 时关闭战斗事件日志（默认 true = 历史行为）。
        // 优化器会关掉它：wipe 日志与逐事件控制台输出对只读指标的评估毫无价值。
        logCombatEvents: event.data.logCombatEvents !== false,
        enableHpMpVisualization,
        combatScrollsEnabled: Boolean(extra.combatScrollsEnabled),
        isGuildTrial: Boolean(event.data.simulationContext?.isGuildTrial),
      };
      const wasmSimResult = await tryRunWasmProductionRound({
        useWasmEngine: event.data.useWasmEngine === true,
        players,
        zone,
        labyrinth,
        simulationContext: event.data.simulationContext,
        seed: event.data.seed,
        simulationTimeLimit,
        options,
      });
      if (wasmSimResult) {
        // wasm 路径自带确定性，不需要（也不消耗）播种后的 Math.random 作用域。
        this.postMessage({ type: 'simulation_result', simResult: wasmSimResult });
        break;
      }

      let combatSimulator = new CombatSimulator(players, zone, labyrinth, options);
      combatSimulator.addEventListener('progress', (event) => {
        this.postMessage({
          type: 'simulation_progress',
          progress: event.detail.progress,
          zone: event.detail.zone,
          difficultyTier: event.detail.difficultyTier,
          labyrinth: event.detail.labyrinth,
          roomLevel: event.detail.roomLevel,
          timeSeriesData: event.detail.timeSeriesData,
        });
      });

      const restoreRandom = installSeedScope(event.data.seed);
      try {
        let simResult = await combatSimulator.simulate(simulationTimeLimit);
        this.postMessage({ type: 'simulation_result', simResult: simResult });
      } catch (e) {
        console.log(e);
        this.postMessage({ type: 'simulation_error', error: e });
      } finally {
        // 本 worker 一次只处理一条消息，恢复只是为了不把已播种的发生器留在
        // realm 里（若将来复用 realm，这一步就是安全前提）。
        if (restoreRandom) restoreRandom();
      }
      break;
  }
};
