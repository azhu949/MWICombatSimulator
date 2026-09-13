import { describe, expect, it, vi } from 'vitest';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';

// 两条轴、每条两个阈值 → 域 = 空方案 + 2 + 2 + 2×2 = 9 个候选。
const items = [
  { hrid: 'food-a', kind: 'hp', restore: 30, price: 1, thresholds: [100, 50] },
  { hrid: 'food-b', kind: 'mp', restore: 30, price: 1, thresholds: [100, 50] },
];

// 合成流：不带食物（空候选 = 空槽基线）每轮必死 2 次，带食物的候选必定 0 死。两种口径下的
// 榜单差异只由“是否排除有死亡的方案”决定，与成本、跨轮复用无关。
function sampleFor(candidate, seed) {
  const slots = candidate?.slots || [];
  const baseline = candidate === null;
  return {
    seed,
    deaths: slots.length ? 0 : 2,
    ranOutOfMana: false,
    stoppedEarly: false,
    simulatedTime: 600e9,
    costPerHour: slots.length ? 80 : 0,
    foodUsed: Object.fromEntries(slots.map((slot) => [slot.hrid, 1])),
    equivalentThresholds: baseline
      ? null
      : slots.map((slot) => ({ hrid: slot.hrid, kind: slot.kind, min: slot.threshold, max: slot.threshold })),
    // 真实的空方案会带回“食物从未触发”证书（等价于“任何更晚的阈值都不触发”）：这正是
    // 空槽基线能被当作候选证据复用的原因，也是本用例要盯住的唯一旁路。
    unusedFoodThresholds: slots.length ? null : { hp: 51, mp: 51 },
    inactiveFoodThresholds: null,
  };
}

async function run({ requireZeroDeaths, searchMode = 'complete', reuse = true } = {}) {
  const request = {
    activePlayerId: '1',
    rounds: 2,
    seeds: [1, 2],
    searchMode,
    requireZeroDeaths,
    payload: {
      simulationTimeLimit: 600e9,
      // 空槽基线：用户当前没带食物，基线自身每轮就会死亡（累计 4 次）。
      players: [{ hrid: 'player1', food: [] }],
    },
  };
  // 只记录候选轮次收到的死亡预算（基线轮次永远是 Infinity）：预算就是“死亡是否淘汰”
  // 的唯一闸门，直接钉住它，避免只看最终榜单时被其它路径掩盖。
  const limits = [];
  const report = await createFoodOptimizerSearch({
    request,
    items,
    foodSlots: 2,
    workerLimit: 1,
    adaptiveWorkers: false,
    reuse,
    workerFactory: () => ({
      stop: vi.fn(),
      async call(message, progress) {
        if (message.type === 'init') return undefined;
        return evaluateFoodOptimizerCandidate(
          request,
          message.candidate,
          message.deathBudget,
          progress,
          async (_request, candidate, seed, _onProgress, deathLimit) => {
            if (candidate) limits.push(deathLimit);
            return sampleFor(candidate, seed);
          },
          { reusableSamples: message.reusableSamples },
        );
      },
    }),
  }).done;
  return { report, limits };
}

describe('food optimizer zero-death switch', () => {
  it.each(['complete', 'top10'])('ranks only death-free results when the switch is on (%s)', async (searchMode) => {
    const { report, limits } = await run({ requireZeroDeaths: true, searchMode });

    // 解析结果写回 request：报告与 UI 看到的是实际执行的口径（而不是 undefined）。
    expect(report.request.requireZeroDeaths).toBe(true);
    expect(report.topResults.length).toBeGreaterThan(0);
    // 榜单（前十）只收累计死亡为 0 的方案：会死亡的空方案既不进榜单，也不被当作合格证据。
    expect(report.topResults.every((result) => result.deaths === 0)).toBe(true);
    expect(report.topResults.every((result) => result.food.length > 0)).toBe(true);
    expect(report.stats.rejectedDeaths).toBeGreaterThan(0);
    // 候选的死亡预算被压到 0：基线自己每轮死 2 次也不放宽。
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((limit) => limit === 0)).toBe(true);
  });

  it.each([false, undefined, 'yes'])('keeps the baseline death budget off the switch (%s)', async (value) => {
    const { report } = await run({ requireZeroDeaths: value });

    // 缺失与非法值都按未启用处理，绝不静默加严搜索。
    expect(report.request.requireZeroDeaths).toBe(false);
    const dying = report.topResults.filter((result) => result.deaths > 0);
    // 对照：同一个域里，会死亡的空方案（0 成本）照常入榜，且没有任何候选因死亡被淘汰。
    expect(dying.length).toBeGreaterThan(0);
    expect(dying.some((result) => result.food.length === 0)).toBe(true);
    expect(report.stats.rejectedDeaths).toBe(0);
  });
});
