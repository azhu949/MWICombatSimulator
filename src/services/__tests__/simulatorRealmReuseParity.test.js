// §54 批量路径的常规回归防线（备忘录 0362617855333384193）：一次评估的全部种子收进
// 同一个 worker realm（runSimulationBatchWithDedicatedWorker），其正确性前提是
// 「引擎在同一 realm 连续两次 simulate 之间没有会改变结果的状态残留」。此前只有
// 离线研究装置（scripts/trigger-optimizer-racing-study.mjs --realm-study）背书，
// 不在常规测试流水线内 —— 本文件把 parity 断言固化进 vitest：
//
//   对照臂 A（同 realm 连跑，模拟 §54 批量路径）：同一份模块 registry 里，
//   按生产 worker.js 的装配方式（含 installSeedScope 的换/恢复）依次跑 K 场
//   不同种子的真实引擎模拟；
//   对照臂 B（每场全新 realm）：vi.resetModules() 清空模块缓存后重新 import()
//   —— 模块被重新执行，返回全新模块实例（含引擎 JSON 常量的全新副本），
//   即「全新 realm」在 vitest 环境下的等价物。
//
//   同一种子在 A、B 两臂的 simResult 必须逐位一致（JSON 序列化等值）。
//   若将来引擎改动引入非确定性残留（模块级缓存、共享 buff 对象就地改写等），
//   A 臂会污染后续场次，本测试即红 —— 防止「配对性表面成立而排序失真」。
//
// 耗时控制：simulationTimeHours 最小为 1（buildSingleSimulationPayload 强制
// Math.max(1, ...)），单场秒级；K = 3、两臂共 6 场，总时长在常规流水线可接受。
import { describe, expect, it, vi } from 'vitest';

import CombatSimulator from '../../combatsimulator/combatSimulator.js';
import { importSoloConfig } from '../importExportMapper.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../playerMapper.js';
import { buildSimulationExtra, buildSingleSimulationPayload } from '../simulationDomain.js';
import { TRIGGER_OPTIMIZER_WORKER_ID } from '../triggerOptimizerSimulation.js';
import fixture from './fixtures/modernPlayerJunglePlanetFixture.json';

const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
const SEEDS = [101, 202, 303];

function createSimulationSettings() {
  return {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: '',
    difficultyTier: 1,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: 1,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: false,
  };
}

function createPayloadPlayers() {
  const result = importSoloConfig(JSON.stringify(fixture), createEmptyPlayerConfig(1), createSimulationSettings());
  return buildPlayersForSimulation([{ ...result.player, selected: true }]);
}

function buildSeededPayload(players, seed) {
  const settings = createSimulationSettings();
  const payload = buildSingleSimulationPayload(players, settings, [], {
    workerId: TRIGGER_OPTIMIZER_WORKER_ID,
    extra: { ...buildSimulationExtra(settings), enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  payload.seed = seed;
  return payload;
}

// 与生产 worker.js 'start_simulation' 分支同构的装配 + 播种（依赖被引入模块自身的
// registry：A 臂共享本文件顶部 import 的同一批模块；B 臂通过动态 import 拿到全新实例）。
async function runInRegistry(modules, payload) {
  const { CombatSimulator, Player, Zone, buildSimulationExtraBuffs, createSeededRandom } = modules;
  const extra = payload.extra || {};
  const extraBuffs = buildSimulationExtraBuffs(extra);
  const zone = payload.zone ? new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier) : null;
  const players = [];
  for (const playerDto of payload.players) {
    const player = Player.createFromDTO(structuredClone(playerDto));
    // 与生产 worker.js 同款：zoneBuffs/extraBuffs 按引用共享，跨场安全依赖
    // 引擎 addPermanentBuff「首次写入必克隆」（permanentBuffPlayerIsolation.test.js 已锚定）。
    player.zoneBuffs = zone?.buffs || [];
    player.extraBuffs = extraBuffs;
    players.push(player);
  }
  const originalRandom = Math.random;
  Math.random = createSeededRandom(payload.seed >>> 0);
  try {
    const simulator = new CombatSimulator(players, zone, null, {
      enableHpMpVisualization: false,
      combatScrollsEnabled: Boolean(extra.combatScrollsEnabled),
      isGuildTrial: Boolean(payload.simulationContext?.isGuildTrial),
      logCombatEvents: payload.logCombatEvents !== false,
    });
    return await simulator.simulate(payload.simulationTimeLimit);
  } finally {
    Math.random = originalRandom;
  }
}

// B 臂：vi.resetModules() 清空模块缓存后重新 import() —— 模块被重新执行，
// 返回全新模块实例（引擎 JSON 常量是全新副本），即「全新 realm」的等价物。
async function importFreshRegistry() {
  vi.resetModules();
  const [combatSimulator, player, zone, extraBuffs, seededRandom] = await Promise.all([
    import('../../combatsimulator/combatSimulator.js'),
    import('../../combatsimulator/player.js'),
    import('../../combatsimulator/zone.js'),
    import('../../shared/simulationExtraBuffs.js'),
    import('../seededRandom.js'),
  ]);
  return {
    CombatSimulator: combatSimulator.CombatSimulator ?? combatSimulator.default,
    Player: player.Player ?? player.default,
    Zone: zone.Zone ?? zone.default,
    buildSimulationExtraBuffs: extraBuffs.buildSimulationExtraBuffs,
    createSeededRandom: seededRandom.createSeededRandom,
  };
}

async function runSharedRegistryArm(players, seeds) {
  // A 臂全部场次共用本文件顶部静态 import 的模块 registry —— 等价于 §54 批量
  // 路径里「一次评估一个 realm」：引擎 JSON 常量、模块级状态在多场之间共享。
  const modules = {
    CombatSimulator,
    Player: (await import('../../combatsimulator/player.js')).default,
    Zone: (await import('../../combatsimulator/zone.js')).default,
    buildSimulationExtraBuffs: (await import('../../shared/simulationExtraBuffs.js')).buildSimulationExtraBuffs,
    createSeededRandom: (await import('../seededRandom.js')).createSeededRandom,
  };
  const results = [];
  for (const seed of seeds) {
    results.push(await runInRegistry(modules, buildSeededPayload(players, seed)));
  }
  return results;
}

async function runFreshRealmArm(players, seeds) {
  const results = [];
  for (const seed of seeds) {
    const modules = await importFreshRegistry();
    results.push(await runInRegistry(modules, buildSeededPayload(players, seed)));
  }
  return results;
}

describe('worker realm 复用 parity（§54 常规回归防线）', () => {
  // 两臂共 6 场真实模拟（单独跑约 4-5s），全量流水线并行负载下会超过默认 5s 上限：
  // 显式放宽超时（只防抖，不放宽任何断言）。
  it('同一批种子在「同一 realm 连跑」与「每场全新 realm」下逐位一致', async () => {
    const players = createPayloadPlayers();
    const sharedResults = await runSharedRegistryArm(players, SEEDS);
    const freshResults = await runFreshRealmArm(players, SEEDS);

    expect(sharedResults).toHaveLength(SEEDS.length);
    expect(freshResults).toHaveLength(SEEDS.length);
    for (let i = 0; i < SEEDS.length; i += 1) {
      // 逐位一致：直接用 JSON 序列化比较（对象含非 JSON 字段时 toStrictEqual 也可，
      // 这里 simResult 是 worker postMessage 的纯数据，JSON 等值即逐位等值）。
      expect(JSON.stringify(sharedResults[i])).toBe(JSON.stringify(freshResults[i]));
    }
  }, 30000);

  it('对照组：不同种子的结果不同（排除「两臂都跑出空结果」的假阳性）', async () => {
    const players = createPayloadPlayers();
    const [first, second] = await runSharedRegistryArm(players, [11, 12]);
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });
});
