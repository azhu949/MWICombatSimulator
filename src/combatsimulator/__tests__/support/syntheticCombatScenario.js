// 固定合成场景：Rust/WASM 引擎移植的 parity 对账与 JS 基准测试共用的权威输入定义。
// 同一份场景代码 => JS 引擎与 Rust 引擎（切片 2+）拿到完全相同的固定输入。
// 单位构造方式沿用 combatSimulator.test.js 中的测试单位写法。
import CombatSimulator from '../../combatSimulator.js';
import Consumable from '../../consumable.js';
import Player from '../../player.js';
import AutoAttackEvent from '../../events/autoAttackEvent.js';
import CombatStartEvent from '../../events/combatStartEvent.js';

export const UNIT_COUNT = 3;
// 高血量保证整段窗口没有单位死亡，事件调度骨架完全确定（攻击总数可复现）。
export const HITPOINTS = 1_000_000;
// 引擎以毫秒计时；1200ms 接近生产攻击间隔下限（生产默认 3000000000 经等级/增速修正后约 1200ms 量级）。
export const ATTACK_INTERVAL_MS = 1200;
export const ATTACK_DAMAGE = 20;
// 每轮模拟窗口：600 游戏秒（引擎时间单位为毫秒）。
export const SCENARIO_MS_PER_RUN = 600 * 1000;

function armUnit(unit) {
  // 引擎会在 reset()/CombatStart 内部从基础数据重建战斗属性，
  // 因此合成攻击档案必须在每次重置之后重新应用（见 rearmUnits）。
  const stats = unit.combatDetails.combatStats;
  stats.attackInterval = ATTACK_INTERVAL_MS;
  stats.autoAttackDamage = ATTACK_DAMAGE;
  stats.stabMaxDamage = ATTACK_DAMAGE;
  stats.slashMaxDamage = ATTACK_DAMAGE;
  stats.smashMaxDamage = ATTACK_DAMAGE;
  stats.rangedMaxDamage = ATTACK_DAMAGE;
  stats.magicMaxDamage = ATTACK_DAMAGE;
  stats.criticalRate = 0.05;
  stats.criticalDamage = 1;
  unit.combatDetails.maxHitpoints = HITPOINTS;
  unit.combatDetails.currentHitpoints = HITPOINTS;
  return unit;
}

export function rearmUnits(players, enemies) {
  players.forEach(armUnit);
  if (Array.isArray(enemies)) enemies.forEach(armUnit);
}

export function buildSyntheticUnits(seed) {
  const players = [];
  const enemies = [];
  for (let index = 0; index < UNIT_COUNT; index += 1) {
    const player = new Player();
    player.hrid = `/benchmark/player/${(seed * UNIT_COUNT + index).toString()}`;
    player.isPlayer = true;
    player.updateCombatDetails();
    player.combatDetails.maxHitpoints = HITPOINTS;
    player.combatDetails.currentHitpoints = HITPOINTS;
    player.food = [new Consumable('/items/donut', [])];
    players.push(player);

    const enemy = new Player();
    enemy.hrid = `/benchmark/enemy/${(seed * UNIT_COUNT + index).toString()}`;
    enemy.isPlayer = false;
    enemy.updateCombatDetails();
    enemy.combatDetails.maxHitpoints = HITPOINTS;
    enemy.combatDetails.currentHitpoints = HITPOINTS;
    enemies.push(enemy);
  }
  return { players, enemies };
}

// CombatStart 内部顺序：initializeCombatPlayers 重置单位 → startNewEncounter 注入敌人 →
// startAttacks 按「重置后的默认间隔」排程攻击。合成场景需要在每次重置之后
// 重新武装单位，清掉旧排程并以合成间隔重启攻击循环。
export class SyntheticCombatSimulator extends CombatSimulator {
  processEvent(event) {
    super.processEvent(event);
    if (event?.type === CombatStartEvent.type) {
      rearmUnits(this.players, this.enemies);
      this.eventQueue.clearEventsOfType(AutoAttackEvent.type);
      this.startAttacks();
    }
  }
}

export function createSyntheticScenario(seed = 0) {
  const { players, enemies } = buildSyntheticUnits(seed);
  const simulator = new SyntheticCombatSimulator(players, null, null, {
    logCombatEvents: false,
    enableHpMpVisualization: false,
  });
  simulator.enemies = enemies;
  return simulator;
}

// 汇总一轮模拟的聚合统计：JS 基线 vs Rust 引擎的 parity 对账契约（切片 2+ 启用对照）。
// simResult.attacks[source][target][ability][outcome] = 次数；outcome 为 'miss' 或命中伤害值。
export function collectScenarioMetrics(simResult) {
  let attackTally = 0;
  let hits = 0;
  let misses = 0;
  for (const targets of Object.values(simResult?.attacks ?? {})) {
    for (const abilities of Object.values(targets)) {
      for (const outcomes of Object.values(abilities)) {
        for (const [outcome, count] of Object.entries(outcomes)) {
          attackTally += count;
          if (outcome === 'miss') misses += count;
          else hits += count;
        }
      }
    }
  }
  return { attackTally, hits, misses, hitRate: attackTally > 0 ? hits / attackTally : 0 };
}
