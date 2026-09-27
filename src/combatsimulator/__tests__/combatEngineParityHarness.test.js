// 切片 1 parity 基线：固定合成场景在纯 JS 引擎上的对账契约自检。
// 验证「调度骨架确定性 + 统计量容差」这套即将用于 JS vs Rust 对照的方法学本身成立：
// - 攻击总数只由事件调度骨架决定，必须逐轮一致（精确对账项）；
// - 命中率为随机 roll 结果，只用容差对账（切片 2+ 的 Rust 引擎照此办理）。
import { describe, expect, it } from 'vitest';
import {
  collectScenarioMetrics,
  createSyntheticScenario,
  SCENARIO_MS_PER_RUN,
} from './support/syntheticCombatScenario.js';

async function runScenario(seed = 0) {
  const simulator = createSyntheticScenario(seed);
  await simulator.simulate(SCENARIO_MS_PER_RUN);
  return collectScenarioMetrics(simulator.simResult);
}

describe('combat engine parity harness (JS baseline)', () => {
  it('keeps the scheduled-attack skeleton deterministic across runs', async () => {
    const first = await runScenario(0);
    const second = await runScenario(0);
    expect(first.attackTally).toBeGreaterThan(0);
    expect(second.attackTally).toBe(first.attackTally);
  });

  it('counts hits and misses consistently and keeps hit rate stable within tolerance', async () => {
    const first = await runScenario(0);
    const second = await runScenario(0);
    expect(first.hits + first.misses).toBe(first.attackTally);
    expect(Math.abs(first.hitRate - second.hitRate)).toBeLessThan(0.05);
  });

  it('changes only random rolls, not sample counts, across seeds', async () => {
    const a = await runScenario(0);
    const b = await runScenario(12345);
    expect(b.attackTally).toBe(a.attackTally);
  });
});
