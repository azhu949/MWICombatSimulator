import { describe, expect, it, vi } from 'vitest';
import { generateFoodOptimizerCompositionCandidates } from '../foodOptimizerDomain.js';
import { materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';

// 两条食物轴、每条两个阈值 → 域 = 空方案 + 2 + 2 + 2×2 = 9 个候选。
// 基线携带 2 槽食物（血药 + 蓝药），因此 0 槽与 1 槽候选的死亡预算都被压到「基线累计死亡 - 1」。
// restore 取在 thresholds 内：默认阈值候选（buildFoodDefaultCandidate）依旧落在网格里，
// 与域契约「自身恢复量总在目录中」一致。
const items = [
  { hrid: 'food-hp', kind: 'hp', restore: 50, price: 1, thresholds: [100, 50] },
  { hrid: 'food-mp', kind: 'mp', restore: 50, price: 10, thresholds: [100, 50] },
];
const PRICES = { 'food-hp': 1, 'food-mp': 10 };
const DEATHS_PER_ROUND = 2;

// 合成流：死亡只看「是否带了血药」——带血药与基线每轮 2 死持平，不带血药每轮 0 死、严格更少。
// 这正是用户报告的形态：少带一件食物却不多死，必须被死亡预算淘汰；少带且更少死才准予入围。
// 蓝药从不被消耗，2 槽候选对血药的观察又很粗（整条轴同轨迹），所以它的核心证书能覆盖只带
// 血药的 1 槽候选——跨槽位复用的预算闸门就落在这条路径上。
function sampleFor(candidate, seed) {
  const baseline = candidate === null;
  const slots = candidate?.slots || [];
  const wide = slots.length > 1;
  const foodUsed = baseline
    ? { 'food-hp': 1, 'food-mp': 1 }
    : Object.fromEntries(slots.map((slot) => [slot.hrid, slot.kind === 'hp' ? 1 : 0]));
  return {
    seed,
    deaths: baseline || slots.some((slot) => slot.kind === 'hp') ? DEATHS_PER_ROUND : 0,
    ranOutOfMana: false,
    stoppedEarly: false,
    simulatedTime: 600e9,
    foodUsed,
    costPerHour: Object.entries(foodUsed).reduce((sum, [hrid, count]) => sum + count * PRICES[hrid], 0) * 6,
    equivalentThresholds: slots.map((slot) => ({
      hrid: slot.hrid,
      kind: slot.kind,
      min: slot.kind === 'hp' && wide ? 1 : slot.threshold,
      max: slot.kind === 'hp' && wide ? 100 : slot.threshold,
    })),
    // 空方案不带「食物从未触发」证书：本用例只盯跨槽位复用这一条路径。
    unusedFoodThresholds: null,
    // 「核心之外的食物不触发」的上界必须与合成流自洽：本流里血药一旦带上就会触发（上界高于
    // 网格最大阈值 ⇒ 任何带血药的查询都不能靠别的证书背书），蓝药则从不触发。
    inactiveFoodThresholds: { hp: 101, mp: 1 },
  };
}

async function run({ requireZeroDeaths, reuse = true } = {}) {
  const request = {
    activePlayerId: '1',
    rounds: 2,
    seeds: [1, 2],
    searchMode: 'complete',
    requireZeroDeaths,
    payload: {
      simulationTimeLimit: 600e9,
      players: [
        {
          hrid: 'player1',
          food: [
            { hrid: 'food-hp', triggers: [] },
            { hrid: 'food-mp', triggers: [] },
          ],
        },
      ],
    },
  };
  // 派发出去的候选收到了哪个死亡预算，以及每个候选最终的裁定：预算是唯一的死亡闸门，直接钉住它。
  const budgets = new Map();
  const covered = new Map();
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
        if (message.candidate) budgets.set(message.candidate.signature, message.deathBudget);
        return evaluateFoodOptimizerCandidate(
          request,
          message.candidate,
          message.deathBudget,
          progress,
          async (_request, candidate, seed) => sampleFor(candidate, seed),
          { reusableSamples: message.reusableSamples },
        );
      },
    }),
    onCoverage(coverage) {
      if (coverage.candidate) covered.set(coverage.candidate.signature, coverage.result);
      else
        for (const candidate of generateFoodOptimizerCompositionCandidates(coverage.items))
          if (candidate.signature !== coverage.excludedSignature)
            covered.set(candidate.signature, materializeFoodOptimizerOutcome(coverage.evidence, candidate));
    },
  }).done;
  expect(report.status, report.error).toBe('completed');
  expect(report.complete).toBe(true);
  return { report, budgets, covered };
}

const HP_ONLY = ['food-hp@hp:100', 'food-hp@hp:50'];

describe('food optimizer slot-aware death budgets', () => {
  it('admits fewer slots only when they die strictly less than the equipped baseline', async () => {
    const { report, budgets, covered } = await run();

    // 预算按槽位重算：0/1 槽候选比基线少带食物 ⇒ 必须严格更少死（基线 4 死 - 1 = 3）；
    // 2 槽与基线持平 ⇒ 沿用基线累计死亡 4。
    expect(budgets.get('')).toBe(3);
    expect(budgets.get('food-hp@hp:50')).toBe(3);
    expect(budgets.get('food-mp@mp:50')).toBe(3);
    expect(budgets.get('food-mp@mp:50|food-hp@hp:50')).toBe(4);

    // 少带一件血药但死亡数与基线持平（4 死）：0/1 槽候选一律淘汰，前十不再出现单槽血药方案。
    expect(covered.size).toBe(9);
    for (const signature of HP_ONLY)
      expect(covered.get(signature)).toMatchObject({ feasible: false, rejected: 'deaths' });
    expect(report.stats.rejectedDeaths).toBe(HP_ONLY.length);
    expect(report.topResults.some((result) => HP_ONLY.includes(result.signature))).toBe(false);

    // 其中 100 阈值那份没有派发：它由 2 槽候选的核心证书覆盖（记录预算 4 > 查询预算 3），
    // 复用必须就地改判成死亡淘汰，而不是把「4 死仍可行」的结论外借给少带食物的查询。
    expect(budgets.has('food-hp@hp:100')).toBe(false);
    expect(covered.get('food-hp@hp:100').deaths).toBe(4);

    // 严格更少死的少带方案照常入围：1 槽蓝药（0 死）与空方案都在榜上，2 槽持平方案也不受影响。
    expect(new Set(report.topResults.map((result) => result.signature))).toEqual(
      new Set([
        '',
        'food-mp@mp:100',
        'food-mp@mp:50',
        'food-mp@mp:100|food-hp@hp:100',
        'food-mp@mp:50|food-hp@hp:100',
        'food-mp@mp:100|food-hp@hp:50',
        'food-mp@mp:50|food-hp@hp:50',
      ]),
    );
  });

  it('reaches the same verdicts with evidence reuse disabled', async () => {
    const { report, covered } = await run({ reuse: false });

    // 关闭复用只影响证书路径：逐候选模拟的裁定与复用全开时一致。
    expect(covered.size).toBe(9);
    for (const signature of HP_ONLY)
      expect(covered.get(signature)).toMatchObject({ feasible: false, rejected: 'deaths' });
    expect(report.topResults.some((result) => result.signature === '')).toBe(true);
  });

  it('subsumes the slot-aware rule under the zero-death switch', async () => {
    const { report, budgets } = await run({ requireZeroDeaths: true });

    // 少带槽位的减一规则被「一律 0」吸收：所有候选（含 2 槽）都必须 0 死。
    expect([...budgets.values()].length).toBeGreaterThan(0);
    expect([...budgets.values()].every((budget) => budget === 0)).toBe(true);
    expect(report.topResults.map((result) => result.signature)).toEqual(['', 'food-mp@mp:100', 'food-mp@mp:50']);
  });
});
