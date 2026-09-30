import Player from './combatsimulator/player';
import Zone from './combatsimulator/zone';
import Labyrinth from './combatsimulator/labyrinth';
import { buildSimulationExtraBuffs } from './shared/simulationExtraBuffs.js';
import { getWasmProductionDiagnostics, tryRunWasmProductionRound } from './services/wasmProductionSimulation.js';

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

onmessage = async function (event) {
  switch (event.data.type) {
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
      this.postMessage({
        type: 'simulation_error',
        error: new Error(`WASM combat engine unavailable (${reason}); the JS engine fallback was removed.`),
      });
      break;
    }
  }
};
