import { describe, expect, it } from 'vitest';

import {
  TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT,
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_SCORE_EPSILON,
} from '../triggerOptimizerDomain.js';
import { TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS } from '../triggerOptimizerCandidates.js';
import {
  TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE,
  computePairedStats,
  hasAdoptionEvidence,
  isAdoptionBlockedByEvidence,
  isTriggerOptimizerResultRejected,
  pairedPValue,
  planTriggerOptimizerRobustnessAppend,
  planTriggerOptimizerRobustnessRounds,
  planTriggerOptimizerVerificationAppend,
  compareCandidates,
  projectTriggerOptimizerDetectionFloor,
  resolveTriggerOptimizerDetectionFloor,
  resolveTriggerOptimizerRobustnessRounds,
  resolveTriggerOptimizerRoundsForEffect,
  resolveTriggerOptimizerRoundsForSignificance,
  resolveTriggerOptimizerVerificationRounds,
  scoreCandidate,
  shouldAdoptCandidate,
  summarizeDeltas,
  summarizeSamples,
} from '../triggerOptimizerScoring.js';

const ZERO_METRICS = { dps: 0, dailyNoRngProfit: 0, xpPerHour: 0, killsPerHour: 0, deathsPerHour: 0 };

// 逐轮样本序列（同一组种子下标对齐）：[seed0, seed1, ...]。
function samples(rows) {
  return rows.map((row) => ({ ...ZERO_METRICS, ...row }));
}

function withSamples(aggregate, rows) {
  return { ...ZERO_METRICS, ...aggregate, samples: samples(rows), rounds: rows.length };
}

function entry(score, metrics, signature = '', distance = 2) {
  return { score, metrics, signature, distance };
}

describe('triggerOptimizerScoring', () => {
  describe('scoreCandidate', () => {
    it('scores the baseline against itself as zero', () => {
      expect(scoreCandidate(ZERO_METRICS, {}, ZERO_METRICS)).toBeCloseTo(0, 9);
      expect(scoreCandidate(ZERO_METRICS, undefined, ZERO_METRICS)).toBeCloseTo(0, 9);
    });

    it('is monotonic: better metrics → higher score', () => {
      const weights = { weightProfit: 0.5, weightXp: 0.3 };
      const baseline = { ...ZERO_METRICS, dailyNoRngProfit: 100, dps: 100 };
      const low = scoreCandidate({ ...ZERO_METRICS, dailyNoRngProfit: 100, dps: 100 }, weights, baseline);
      const mid = scoreCandidate({ ...ZERO_METRICS, dailyNoRngProfit: 150, dps: 100 }, weights, baseline);
      const high = scoreCandidate({ ...ZERO_METRICS, dailyNoRngProfit: 200, dps: 500 }, weights, baseline);
      expect(low).toBeLessThan(mid);
      expect(mid).toBeLessThan(high);
    });

    it('moves the winner when weights change direction', () => {
      const baseline = { ...ZERO_METRICS, dailyNoRngProfit: 100, dps: 100 };
      const profitWinner = { ...ZERO_METRICS, dailyNoRngProfit: 400, dps: 100 };
      const dpsWinner = { ...ZERO_METRICS, dailyNoRngProfit: 100, dps: 400 };
      const profitHeavy = { weightProfit: 1, weightXp: 0 };
      const deathHeavy = { weightProfit: 0, weightXp: 0 }; // weightDeathSafety=1 → dps 权重 0.5
      expect(scoreCandidate(profitWinner, profitHeavy, baseline)).toBeGreaterThan(
        scoreCandidate(dpsWinner, profitHeavy, baseline),
      );
      expect(scoreCandidate(dpsWinner, deathHeavy, baseline)).toBeGreaterThan(
        scoreCandidate(profitWinner, deathHeavy, baseline),
      );
    });

    it('clamps huge improvements so the score stays within [-1 - weightDeathSafety, 1]', () => {
      const weights = { weightProfit: 0, weightXp: 0 };
      // 用极大但有限的值（1e12）而不是 Infinity：指标经 toFiniteNumber 会丢弃非有限值。
      const score = scoreCandidate({ ...ZERO_METRICS, dps: 1e12 }, weights, ZERO_METRICS);
      expect(score).toBeCloseTo(0.5, 9); // weightDps = 0.5，单指标上限 1
    });

    it('treats missing metrics as zero instead of blowing up', () => {
      expect(scoreCandidate({}, {}, {})).toBeCloseTo(0, 9);
      expect(Number.isFinite(scoreCandidate({}, { weightProfit: 0.5, weightXp: 0.3 }, ZERO_METRICS))).toBe(true);
    });

    it('vetoes mana exhaustion with -Infinity regardless of metrics', () => {
      const metrics = { ...ZERO_METRICS, dps: Number.POSITIVE_INFINITY, ranOutOfMana: true };
      expect(scoreCandidate(metrics, { weightProfit: 1, weightXp: 0 }, ZERO_METRICS)).toBe(-Infinity);
    });

    it('penalizes deaths above the baseline proportionally to weightDeathSafety', () => {
      const baseline = { ...ZERO_METRICS, deathsPerHour: 0 };
      const safe = scoreCandidate({ ...ZERO_METRICS, deathsPerHour: 4 }, { weightProfit: 0, weightXp: 0 }, baseline);
      const risky = scoreCandidate(
        { ...ZERO_METRICS, deathsPerHour: 4 },
        { weightProfit: 0.5, weightXp: 0.3 },
        baseline,
      );
      // weightDeathSafety=1 → 4 / max(0, 2) = 2 的惩罚；默认权重 → 0.2 * 2。
      expect(safe).toBeCloseTo(-2, 9);
      expect(risky).toBeCloseTo(-0.4, 9);
      expect(safe).toBeLessThan(risky);
    });

    it('symmetrically rewards dying less than the baseline', () => {
      const baseline = { ...ZERO_METRICS, deathsPerHour: 10 };
      const fewerDeaths = scoreCandidate(
        { ...ZERO_METRICS, deathsPerHour: 0 },
        { weightProfit: 0, weightXp: 0 },
        baseline,
      );
      const sameDeaths = scoreCandidate(
        { ...ZERO_METRICS, deathsPerHour: 10 },
        { weightProfit: 0, weightXp: 0 },
        baseline,
      );
      // 减少死亡现在得分（与惩罚对称）：减少 10 / max(10, 2) = 1 → 满分奖励。
      // 旧口径此项与「死亡不变」完全相等，「死亡更低」在目标函数里没有存在感。
      expect(fewerDeaths).toBeGreaterThan(sameDeaths);
      expect(fewerDeaths).toBeCloseTo(TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT, 9);
      expect(sameDeaths).toBeCloseTo(0, 9);
    });
  });

  describe('compareCandidates', () => {
    it('ranks higher scores first and sinks -Infinity', () => {
      const candidates = [
        entry(0.1, ZERO_METRICS, 'b'),
        entry(-Infinity, ZERO_METRICS, 'c'),
        entry(0.5, ZERO_METRICS, 'a'),
      ];
      const ranked = [...candidates].sort(compareCandidates);
      expect(ranked.map((candidate) => candidate.signature)).toEqual(['a', 'b', 'c']);
    });

    it('breaks score ties by profit, then dps', () => {
      const candidates = [
        entry(0.5, { ...ZERO_METRICS, dailyNoRngProfit: 100, dps: 50 }, 'low-profit'),
        entry(0.5, { ...ZERO_METRICS, dailyNoRngProfit: 300, dps: 10 }, 'high-profit'),
        entry(0.5, { ...ZERO_METRICS, dailyNoRngProfit: 300, dps: 99 }, 'high-dps'),
      ];
      const ranked = [...candidates].sort(compareCandidates);
      expect(ranked.map((candidate) => candidate.signature)).toEqual(['high-dps', 'high-profit', 'low-profit']);
    });

    it('prefers the smaller change when everything else is equal (deterministic convergence)', () => {
      const candidates = [
        entry(0.5, ZERO_METRICS, 'custom-a', 2),
        entry(0.5, ZERO_METRICS, 'always', 1),
        entry(0.5, ZERO_METRICS, 'default', 0),
      ];
      const ranked = [...candidates].sort(compareCandidates);
      expect(ranked.map((candidate) => candidate.signature)).toEqual(['default', 'always', 'custom-a']);
    });

    it('falls back to signature order so the comparator is a strict total order', () => {
      const a = entry(0.5, ZERO_METRICS, 'aaa');
      const b = entry(0.5, ZERO_METRICS, 'bbb');
      expect(compareCandidates(a, b)).toBeLessThan(0);
      expect(compareCandidates(b, a)).toBeGreaterThan(0);
      expect(compareCandidates(a, a)).toBe(0);
    });

    it('is stable: repeated sorts give identical results', () => {
      const candidates = [
        entry(0.5, ZERO_METRICS, 'b', 1),
        entry(0.5, ZERO_METRICS, 'a', 0),
        entry(0.9, ZERO_METRICS, 'c', 2),
        entry(-Infinity, ZERO_METRICS, 'd', 0),
      ];
      const first = [...candidates].sort(compareCandidates).map((candidate) => candidate.signature);
      const second = [...candidates].sort(compareCandidates).map((candidate) => candidate.signature);
      expect(second).toEqual(first);
    });

    it('tolerates missing fields', () => {
      expect(compareCandidates({}, {})).toBe(0);
      expect(compareCandidates({ score: 1 }, { score: 0 })).toBeLessThan(0);
    });
  });

  describe('summarizeDeltas', () => {
    const baseline = {
      metrics: { ...ZERO_METRICS, dps: 100, dailyNoRngProfit: 1000, deathsPerHour: 2 },
      score: 0,
      signature: 'default',
    };
    const candidate = {
      metrics: { ...ZERO_METRICS, dps: 200, dailyNoRngProfit: 1500, deathsPerHour: 3 },
      score: 0.25,
      signature: 'always',
      distance: 1,
    };

    it('reports absolute and percentage deltas for every scored metric', () => {
      const summary = summarizeDeltas(baseline, candidate);
      expect(summary.score).toBeCloseTo(0.25, 9);
      expect(summary.scoreDelta).toBeCloseTo(0.25, 9);
      expect(summary.improved).toBe(true);
      expect(summary.signature).toBe('always');
      expect(summary.metrics).toBe(candidate.metrics);
      expect(summary.deltas.dps).toEqual({ absolute: 100, percent: 100 });
      expect(summary.deltas.dailyNoRngProfit).toEqual({ absolute: 500, percent: 50 });
    });

    it('reports the death delta separately (no percentage)', () => {
      expect(summarizeDeltas(baseline, candidate).deathsAbsolute).toBe(1);
    });

    it('flags non-improving candidates', () => {
      const worse = { ...candidate, score: -0.1 };
      expect(summarizeDeltas(baseline, worse).improved).toBe(false);
      // 与基线同分：只有严格超过 eps 才算改进。
      const tied = { ...candidate, score: TRIGGER_OPTIMIZER_SCORE_EPSILON / 2 };
      expect(summarizeDeltas(baseline, tied).improved).toBe(false);
    });

    it('survives missing metrics', () => {
      const summary = summarizeDeltas(null, { score: 1, metrics: null, signature: 'x' });
      expect(summary.score).toBe(1);
      expect(summary.deltas.dps.absolute).toBe(0);
      expect(summary.deathsAbsolute).toBe(0);
    });

    it('carries -Infinity scores through', () => {
      const summary = summarizeDeltas(baseline, { score: -Infinity, metrics: ZERO_METRICS, signature: 'y' });
      expect(summary.score).toBe(-Infinity);
      expect(summary.improved).toBe(false);
    });
  });

  describe('summarizeSamples（配对统计的口径）', () => {
    it('按样本数给出均值/标准误/t/自由度/双侧 p 值', () => {
      const two = summarizeSamples([1, 3]);
      expect(two).toMatchObject({ rounds: 2, mean: 2, stdError: 1, t: 2, dof: 1 });
      expect(two.pValue).toBeCloseTo(0.2952, 3); // t 分布(1 自由度)双侧 p，量级远超 0.05
      // 关键：2 轮抽样达不到显著性 —— verdict 必须是 inconclusive，不能给出假阳性结论。
      expect(two.verdict).toBe('inconclusive');

      const three = summarizeSamples([1, 2, 3]);
      expect(three.mean).toBe(2);
      expect(three.stdError).toBeCloseTo(Math.sqrt(1 / 3), 9);
      expect(three.t).toBeCloseTo(2 / Math.sqrt(1 / 3), 9);
      expect(three.dof).toBe(2);
    });

    it('单轮没得估标准误 → t=null、pValue=null、verdict=unknown（UI 必须提示样本不足）', () => {
      expect(summarizeSamples([5])).toEqual({
        rounds: 1,
        mean: 5,
        stdError: null,
        t: null,
        dof: 0,
        pValue: null,
        verdict: 'unknown',
      });
      expect(summarizeSamples([])).toEqual({
        rounds: 0,
        mean: null,
        stdError: null,
        t: null,
        dof: null,
        pValue: null,
        verdict: 'unknown',
      });
      expect(summarizeSamples(null).verdict).toBe('unknown');
    });

    it('全部同号且无波动 → 标准误 0 → t=±Infinity、p=0 的明确结论', () => {
      expect(summarizeSamples([2, 2, 2])).toMatchObject({ verdict: 'positive', t: Infinity, pValue: 0 });
      expect(summarizeSamples([-1, -1])).toMatchObject({ verdict: 'negative', t: -Infinity, pValue: 0 });
      expect(summarizeSamples([0, 0])).toMatchObject({ verdict: 'inconclusive', t: 0 });
      expect(summarizeSamples([0, 0]).pValue).toBeCloseTo(1, 6);
    });

    it('出现 -Infinity（空蓝回归）直接判 negative，不做统计', () => {
      const summary = summarizeSamples([1, Number.NEGATIVE_INFINITY]);
      expect(summary.verdict).toBe('negative');
      expect(summary.mean).toBe(-Infinity);
      expect(summary.t).toBeNull();
    });
  });

  describe('pairedPValue（真实 p 值，而不是「|t|≥2≈95%」的近似）', () => {
    it('t 分布双侧 p 值：轮数越少越保守', () => {
      // 同样的 t=2，在 1 自由度（2 轮）下 p≈0.30，在 5 自由度（6 轮）下 p≈0.10。
      expect(pairedPValue(2, 2)).toBeCloseTo(0.2952, 3);
      expect(pairedPValue(2, 6)).toBeCloseTo(0.1019, 3);
      expect(pairedPValue(2, 6)).toBeLessThan(pairedPValue(2, 2));
      // 6 轮下 t=2.57 才刚好 p<0.05（这正是复验固定 6 轮的原因）。
      expect(pairedPValue(2.57, 6)).toBeCloseTo(0.05, 2);
      expect(pairedPValue(-2.57, 6)).toBeCloseTo(pairedPValue(2.57, 6), 9);
    });

    it('无波动（t=±Infinity）→ p=0；单轮无法估标准误 → p=null', () => {
      expect(pairedPValue(Infinity, 2)).toBe(0);
      expect(pairedPValue(-Infinity, 2)).toBe(0);
      expect(pairedPValue(2, 1)).toBeNull();
      expect(pairedPValue(2, 0)).toBeNull();
    });
  });

  describe('computePairedStats（提升是真信号还是这组种子的运气）', () => {
    const weights = { weightProfit: 0, weightXp: 0 }; // weightDps = weightKills = 0.5

    it('按种子下标逐轮相减，给出逐指标配对统计与目标分统计', () => {
      const reference = withSamples({ dps: 100 }, [{ dps: 100 }, { dps: 100 }]);
      const candidate = withSamples({ dps: 200 }, [{ dps: 200 }, { dps: 300 }]);
      const stats = computePairedStats(candidate, reference, weights);

      expect(stats.rounds).toBe(2);
      expect(stats.metrics.dps.mean).toBe(150);
      expect(stats.metrics.dps).toMatchObject({ rounds: 2, dof: 1 });
      // 逐轮目标分都为正 → 均值正；但 2 轮（1 自由度）达不到 p<0.05 → inconclusive。
      // 这不是缺陷而是设计：搜索期抽样廉价，显著性结论交给复验（固定 6 轮）。
      expect(stats.score.mean).toBeGreaterThan(0);
      expect(stats.score.verdict).toBe('inconclusive');
      expect(stats.score.pValue).toBeGreaterThan(0.05);
      expect(stats.manaRegressions).toBe(0);
      expect(stats.manaRecoveries).toBe(0);
    });

    it('6 轮一致的提升 → p<0.05 的 positive 结论（复验配置的功效）', () => {
      const reference = withSamples(
        { dps: 100 },
        Array.from({ length: 6 }, () => ({ dps: 100 })),
      );
      const candidate = withSamples(
        { dps: 200 },
        Array.from({ length: 6 }, () => ({ dps: 200 })),
      );
      const stats = computePairedStats(candidate, reference, weights);
      expect(stats.rounds).toBe(6);
      expect(stats.score.dof).toBe(5);
      expect(stats.score.pValue).toBe(0);
      expect(stats.score.verdict).toBe('positive');
    });

    it('样本长度不一致（例如一方是退化结构）→ null：宁可不给统计，也不给错统计', () => {
      const reference = withSamples({ dps: 100 }, [{ dps: 100 }, { dps: 100 }]);
      expect(computePairedStats(withSamples({ dps: 100 }, [{ dps: 100 }]), reference, weights)).toBeNull();
      expect(computePairedStats({ dps: 100 }, reference, weights)).toBeNull();
      expect(computePairedStats(withSamples({ dps: 100 }, [{ dps: 100 }]), { dps: 100 }, weights)).toBeNull();
    });

    it('空蓝只统计「参考不空蓝 → 候选空蓝」的回归轮数，反向单独记为修复', () => {
      const healthy = withSamples({}, [{ ranOutOfMana: false }, { ranOutOfMana: false }]);
      const starving = withSamples({}, [{ ranOutOfMana: true }, { ranOutOfMana: false }]);
      expect(computePairedStats(starving, healthy, weights).manaRegressions).toBe(1);
      expect(computePairedStats(starving, healthy, weights).manaRecoveries).toBe(0);
      expect(computePairedStats(healthy, starving, weights).manaRecoveries).toBe(1);
      expect(computePairedStats(healthy, starving, weights).manaRegressions).toBe(0);
    });
  });

  describe('shouldAdoptCandidate（采纳判据）', () => {
    // 带配对证据的候选：verdict='positive' = 逐轮 t 检验已显著 → 证据充足。
    function withEvidence(score, verdict = 'positive') {
      return { score, paired: { score: { verdict } } };
    }

    it('增量分必须严格为正且达到最小效应量 MIN_ADOPT_SCORE', () => {
      expect(shouldAdoptCandidate(withEvidence(0.5))).toBe(true);
      expect(shouldAdoptCandidate(withEvidence(TRIGGER_OPTIMIZER_SCORE_EPSILON / 2))).toBe(false);
      expect(shouldAdoptCandidate(withEvidence(0))).toBe(false);
      expect(shouldAdoptCandidate(withEvidence(-Infinity))).toBe(false);
      expect(shouldAdoptCandidate({})).toBe(false);
      // eps=1e-9 的旧门槛在噪声面前等于零门槛（实测：+0.00078 分的改动被采纳，复验判负）。
      expect(shouldAdoptCandidate(withEvidence(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE / 2))).toBe(false);
      expect(shouldAdoptCandidate(withEvidence(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE))).toBe(true);
      expect(shouldAdoptCandidate(withEvidence(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE + 0.0029))).toBe(true);
    });

    it('同参考系回归：槽级采纳不传参照分 → 只按增量分判，不受其它槽已采纳分数影响', () => {
      // 实测缺陷（2026-09-18，设计 §16.9）：采纳 flame_blast-800(+0.0189) 后，
      // firestorm-800 的 +0.02474（SE 0.00097、p=0.00155，全轮证据最强）被
      // 「0.0189 + MIN_ADOPT_SCORE」拦掉 —— 那是上一个被采纳候选在**另一个参考系**里的分。
      // 槽级采纳的参照恒为「当前工作配置」（增量分 0 分），所以下面两条都必须通过。
      expect(shouldAdoptCandidate(withEvidence(0.02474))).toBe(true);
      expect(shouldAdoptCandidate(withEvidence(0.0189))).toBe(true);

      // 显式参照分仍然参与门槛（精炼采纳的同参考系用法：传同槽 winner）——
      // 参照必须与候选分同源，由调用方保证（search 只在精炼处传同槽 winner）。
      expect(shouldAdoptCandidate(withEvidence(1.005), { score: 1 })).toBe(false);
      expect(shouldAdoptCandidate(withEvidence(1.01), { score: 1 })).toBe(true);

      // 非法参照分（NaN / 缺 score）→ 一律不采纳：宁可不改，也不在错参考系上判。
      expect(shouldAdoptCandidate(withEvidence(0.5), { score: Number.NaN })).toBe(false);
      expect(shouldAdoptCandidate(withEvidence(0.5), {})).toBe(false);
    });

    it('聚合分更高但配对证据不支持时拒绝（那是聚合口径的假象）', () => {
      // negative：逐轮证据一致指向更差 → 拒绝。
      expect(shouldAdoptCandidate(withEvidence(0.5, 'negative'))).toBe(false);
      // inconclusive 且均值没超过噪声地板（|mean| ≤ 2 × stdError）→ 拒绝。
      expect(
        shouldAdoptCandidate({
          score: 0.5,
          paired: { score: { verdict: 'inconclusive', mean: 0.01, stdError: 0.02 } },
        }),
      ).toBe(false);
      // unknown（rounds < 2，标准误无从估计）→ 拒绝：样本不足的正确处置是保持现状。
      expect(shouldAdoptCandidate(withEvidence(0.5, 'unknown'))).toBe(false);
      // 完全没有配对统计（无 samples / 未评估）→ 拒绝。
      expect(shouldAdoptCandidate({ score: 0.5, paired: null })).toBe(false);
      // inconclusive 但均值超过噪声地板（|mean| > 2 × stdError）→ 采纳。
      expect(
        shouldAdoptCandidate({
          score: 0.5,
          paired: { score: { verdict: 'inconclusive', mean: 0.09, stdError: 0.02 } },
        }),
      ).toBe(true);
    });

    it('hasAdoptionEvidence：positive 支持 / negative 拒绝 / 缺标准误一律不支持', () => {
      expect(hasAdoptionEvidence({ score: { verdict: 'positive' } })).toBe(true);
      expect(hasAdoptionEvidence({ score: { verdict: 'negative' } })).toBe(false);
      expect(hasAdoptionEvidence({ score: { verdict: 'unknown' } })).toBe(false);
      // rounds=1 的摘要：mean 是有限数、stdError 是 null。Number(null) === 0 会让
      // 「|mean| > 2 × 0」恒真 → 必须严格按类型判，否则噪声地板被静默拆掉。
      expect(hasAdoptionEvidence({ score: { verdict: 'unknown', mean: 0.5, stdError: null } })).toBe(false);
      expect(hasAdoptionEvidence({ score: { verdict: 'unknown', mean: 0.5, stdError: undefined } })).toBe(false);
      // 缺 mean 的摘要（rounds = 0）。
      expect(hasAdoptionEvidence({ score: { verdict: 'unknown', mean: null, stdError: null } })).toBe(false);
      expect(hasAdoptionEvidence({ score: { verdict: 'inconclusive', mean: 0.01, stdError: 0.02 } })).toBe(false);
      expect(hasAdoptionEvidence({ score: { verdict: 'inconclusive', mean: 0.05, stdError: 0.02 } })).toBe(true);
      expect(hasAdoptionEvidence({ score: null })).toBe(false);
      expect(hasAdoptionEvidence(null)).toBe(false);
      expect(hasAdoptionEvidence({})).toBe(false);
    });

    it('isAdoptionBlockedByEvidence：分数够高但证据不足才为真（UI 据此换文案）', () => {
      expect(isAdoptionBlockedByEvidence(withEvidence(0.5, 'negative'))).toBe(true);
      expect(isAdoptionBlockedByEvidence(withEvidence(0.5, 'unknown'))).toBe(true);
      // 证据充足 → 不是「被证据挡住」。
      expect(isAdoptionBlockedByEvidence(withEvidence(0.5))).toBe(false);
      // 分数本来就不够高 → 属于「没找到更优」，不是「证据不足」。
      expect(isAdoptionBlockedByEvidence(withEvidence(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE / 2))).toBe(false);
      // 同一参考系口径：判定同样不受其它槽已采纳分数影响（与采纳闸门同源）。
      expect(isAdoptionBlockedByEvidence(withEvidence(0.02474, 'unknown'))).toBe(true);
      expect(isAdoptionBlockedByEvidence(withEvidence(0.02474))).toBe(false);
    });

    it('复验否决闸门：仅 verification.verdict === negative 时拒绝应用', () => {
      expect(isTriggerOptimizerResultRejected({ verification: { verdict: 'negative' } })).toBe(true);
      expect(isTriggerOptimizerResultRejected({ verification: { verdict: 'inconclusive' } })).toBe(false);
      expect(isTriggerOptimizerResultRejected({ verification: { verdict: 'positive' } })).toBe(false);
      // 还没复验（null）→ 不否决：旧报告没有 verification 字段时行为不变。
      expect(isTriggerOptimizerResultRejected({ verification: null })).toBe(false);
      expect(isTriggerOptimizerResultRejected({})).toBe(false);
      expect(isTriggerOptimizerResultRejected(null)).toBe(false);
    });
  });

  it('exposes the complete candidate label key contract for the UI layer', () => {
    // 翻译文件必须覆盖下面每一项，且 alwaysFire 的文案须澄清「= 立即释放，非禁用」。
    // 键必须是 common: 冒号前缀：本项目 i18next（defaultNS='common'）不会把
    // 'common.xxx' 点号前缀当作命名空间，运行时只会渲染原始键。
    expect(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS).toEqual({
      default: 'common:triggerOptimizer.candidate.default',
      current: 'common:triggerOptimizer.candidate.current',
      alwaysFire: 'common:triggerOptimizer.candidate.alwaysFire',
      lowHp: 'common:triggerOptimizer.candidate.lowHp',
      executeHp: 'common:triggerOptimizer.candidate.executeHp',
      // 敌方血量类（阈值换算自区域真实怪物血量，与玩家 maxHp 无关）。
      enemyGroupHp: 'common:triggerOptimizer.candidate.enemyGroupHp',
      enemyTargetHp: 'common:triggerOptimizer.candidate.enemyTargetHp',
      missingHp: 'common:triggerOptimizer.candidate.missingHp',
      lowMp: 'common:triggerOptimizer.candidate.lowMp',
      enoughMp: 'common:triggerOptimizer.candidate.enoughMp',
      missingMp: 'common:triggerOptimizer.candidate.missingMp',
      buffInactive: 'common:triggerOptimizer.candidate.buffInactive',
      debuffInactive: 'common:triggerOptimizer.candidate.debuffInactive',
      manyEnemies: 'common:triggerOptimizer.candidate.manyEnemies',
      // 波内进度（2026-09-20，设计 §22）：all_enemies + number_of_dead_units，
      // 阈值取自区域一波怪的**上限**人数（enemyHp.waveSize）。
      deadUnitsAtLeast: 'common:triggerOptimizer.candidate.deadUnitsAtLeast',
      deadUnitsAtMost: 'common:triggerOptimizer.candidate.deadUnitsAtMost',
      allyLowHp: 'common:triggerOptimizer.candidate.allyLowHp',
      // 跨技能增益门（2026-09-19，设计 §18.3）：条件来自**其他已佩戴技能**挂给自身的增益。
      buffWindow: 'common:triggerOptimizer.candidate.buffWindow',
      // 跨技能减益窗口（2026-09-21，设计 §23）：条件来自**其他已佩戴技能**挂在目标身上的
      // 减益（self 侧减益恒假，只能配 targeted_enemy，故与 buffWindow 分成两条标签）。
      debuffWindow: 'common:triggerOptimizer.candidate.debuffWindow',
      compositeExecuteGuard: 'common:triggerOptimizer.candidate.compositeExecuteGuard',
      compositeManyEnemiesGuard: 'common:triggerOptimizer.candidate.compositeManyEnemiesGuard',
      compositeLowHpGuard: 'common:triggerOptimizer.candidate.compositeLowHpGuard',
      compositeBuffRefreshGuard: 'common:triggerOptimizer.candidate.compositeBuffRefreshGuard',
      compositeBuffRefreshLowHp: 'common:triggerOptimizer.candidate.compositeBuffRefreshLowHp',
      compositeAuraRefreshAllyLowHp: 'common:triggerOptimizer.candidate.compositeAuraRefreshAllyLowHp',
      compositeDebuffRefreshGuard: 'common:triggerOptimizer.candidate.compositeDebuffRefreshGuard',
      compositeDebuffMultiple: 'common:triggerOptimizer.candidate.compositeDebuffMultiple',
      compositeAllyLowHpGuard: 'common:triggerOptimizer.candidate.compositeAllyLowHpGuard',
      compositeMissingHpGuard: 'common:triggerOptimizer.candidate.compositeMissingHpGuard',
      compositeBuffWindowGroupHp: 'common:triggerOptimizer.candidate.compositeBuffWindowGroupHp',
    });
  });

  // 可检测下限（2026-09-20，设计 §20.2）：地板 = 2×SE，显著门槛 = t(n−1)×SE，并把地板
  // 换算成「利润百分比」（默认利润权重 0.5 时 score = 0.5·log2(1+相对变化)）。
  describe('detection floor', () => {
    const pairedAt = (rounds, stdError) => ({
      rounds,
      score: { rounds, mean: 0.02, stdError, t: 4, dof: rounds - 1, pValue: 0.05, verdict: 'inconclusive' },
    });

    it('derives the noise floor, the significance threshold and the profit equivalent', () => {
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.005), {}, { rounds: 5 });
      expect(floor.rounds).toBe(5);
      expect(floor.noiseFloor).toBeCloseTo(0.01, 9);
      // t(4) = 2.7764…（双侧 95%）：显著门槛比地板高一截 —— 低轮数下这截就是「测不出小提升」的机制。
      expect(floor.significanceFloor).toBeCloseTo(0.013882, 5);
      expect(floor.weightProfit).toBeCloseTo(0.5, 9);
      expect(floor.profitPercent).toBeCloseTo(1.3959, 3);
    });

    it('prefers the explicit rounds and refuses to guess without a standard error', () => {
      // 显式轮数优先于配对统计自带的轮数（复验 6 轮 ≠ 本次搜索 5 轮，地板要按搜索口径说）。
      expect(resolveTriggerOptimizerDetectionFloor(pairedAt(6, 0.005), {}, { rounds: 5 }).rounds).toBe(5);
      // 无标准误 / 轮数 < 2 / SE = 0（锚点候选与基线逐轮完全相同）→ 没有可展示的下限。
      expect(resolveTriggerOptimizerDetectionFloor(pairedAt(5, null), {}, { rounds: 5 })).toBeNull();
      expect(resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0), {}, { rounds: 5 })).toBeNull();
      expect(resolveTriggerOptimizerDetectionFloor(pairedAt(1, 0.005), {}, { rounds: 1 })).toBeNull();
      expect(resolveTriggerOptimizerDetectionFloor(null, {}, { rounds: 5 })).toBeNull();
    });

    it('skips the profit conversion when the profit weight is zero (no division by zero)', () => {
      const floor = resolveTriggerOptimizerDetectionFloor(
        pairedAt(5, 0.005),
        { weightProfit: 0, weightXp: 1 },
        { rounds: 5 },
      );
      expect(floor.noiseFloor).toBeCloseTo(0.01, 9);
      expect(floor.profitPercent).toBeNull();
    });

    it('projects the floor to a larger round count (SE ∝ 1/√n, threshold also gains t(n−1))', () => {
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.005), {}, { rounds: 5 });
      const projected = projectTriggerOptimizerDetectionFloor(floor, 10);
      expect(projected.rounds).toBe(10);
      expect(projected.noiseFloor).toBeCloseTo(0.0070711, 6);
      expect(projected.significanceFloor).toBeCloseTo(0.0079978, 6);
      // 2^(0.0070710678 / 0.5) − 1 ≈ 0.985%（上屏按两位小数显示成 0.99%）。
      expect(projected.profitPercent).toBeCloseTo(0.98508, 4);
      // 目标轮数不高于当前轮数 / 缺下限 → null（UI 据此不渲染一个做不到的下一步）。
      expect(projectTriggerOptimizerDetectionFloor(floor, 5)).toBeNull();
      expect(projectTriggerOptimizerDetectionFloor(floor, 3)).toBeNull();
      expect(projectTriggerOptimizerDetectionFloor(null, 10)).toBeNull();
    });

    // 反解（2026-09-25，设计 §45）：回答「要把采纳门槛量级（0.01 分）过闸（被采纳）需要多少轮」。
    // 口径 = 轮数 × (2×SE/effect)²（SE ∝ 1/√n）；漏掉 √轮数 会少算一个量级。
    it('solves the minimal round count for a target effect', () => {
      // SE(5) = 0.006 ⇒ 0.01 分需要 n ≥ 5 × (0.012/0.01)² = 7.2 ⇒ 8 轮；7 轮还差一点。
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.006), {}, { rounds: 5 });
      const plan = resolveTriggerOptimizerRoundsForEffect(floor, 0.01, 10);
      expect(plan.rounds).toBe(8);
      expect(plan.capped).toBe(false);
      expect(plan.satisfied).toBe(false);
      expect(plan.effect).toBe(0.01);
      expect(plan.effectProfitPercent).toBeCloseTo(1.3959, 3);
      expect(plan.noiseFloor).toBeCloseTo(0.0094868, 6);
      // 显著门槛 = t(7) × SE(8) = 2.3646 × 0.006 × √(5/8) ≈ 0.0112164。
      expect(plan.significanceFloor).toBeCloseTo(0.0112164, 6);
      // 换算成利润：2^(0.0094868 / 0.5) − 1 ≈ 1.3238%（w_profit = 0.5，与上面同一口径）。
      expect(plan.profitPercent).toBeCloseTo(1.3238, 3);
      // 最小性：7 轮的下限仍高于门槛 ⇒「至少 8 轮」不是随口说的。
      expect(plan.noiseFloor).toBeLessThanOrEqual(0.01);
      expect(projectTriggerOptimizerDetectionFloor(floor, 7).noiseFloor).toBeGreaterThan(0.01);
    });

    it('says so when even the round cap cannot confirm the target effect', () => {
      // SE(5) = 0.01 ⇒ 需要 20 轮 > 上限 10 ⇒ capped，并给出拉满时的下限（≈0.0141 > 0.01）。
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.01), {}, { rounds: 5 });
      const plan = resolveTriggerOptimizerRoundsForEffect(floor, 0.01, 10);
      expect(plan.capped).toBe(true);
      expect(plan.rounds).toBe(10);
      expect(plan.noiseFloor).toBeCloseTo(0.0141421, 6);
      expect(plan.noiseFloor).toBeGreaterThan(0.01);
      expect(plan.significanceFloor).toBeCloseTo(0.0159957, 6);
    });

    it('reports "already sufficient" and never suggests fewer rounds than the current run', () => {
      // 当前地板（0.008）已低于目标（0.01）⇒ satisfied，轮数保持不动。
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.004), {}, { rounds: 5 });
      const plan = resolveTriggerOptimizerRoundsForEffect(floor, 0.01, 10);
      expect(plan.satisfied).toBe(true);
      expect(plan.capped).toBe(false);
      expect(plan.rounds).toBe(5);
      expect(plan.noiseFloor).toBeCloseTo(0.008, 9);
      // 已经在上限（10 轮）时：capped 分支不得给出「比现在更少轮数」的建议（防御性口径）。
      const atCap = resolveTriggerOptimizerDetectionFloor(pairedAt(10, 0.01), {}, { rounds: 10 });
      const cappedAtCap = resolveTriggerOptimizerRoundsForEffect(atCap, 0.01, 10);
      expect(cappedAtCap.capped).toBe(true);
      expect(cappedAtCap.rounds).toBe(10);
      expect(cappedAtCap.noiseFloor).toBeCloseTo(0.02, 9);
    });

    it('refuses to guess on invalid inputs instead of inventing advice', () => {
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.006), {}, { rounds: 5 });
      expect(resolveTriggerOptimizerRoundsForEffect(null, 0.01, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForEffect(floor, 0, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForEffect(floor, -0.01, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForEffect(floor, Number.NaN, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForEffect({ rounds: 5, stdError: 0, noiseFloor: 0 }, 0.01, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForEffect({ rounds: 1, stdError: 0.01 }, 0.01, 10)).toBeNull();
    });
  });

  // 判定口径反解（2026-09-26，设计 §52）：两把尺子里的第二把 —— 「把给定效应量判成 p<0.05 的
  // 明确结论要多少轮」。与 §47/§49 的 t×SE 尺子同源；与上面 §45 的采纳口径（2×SE）在全部可达
  // 轮数内不可能给出同一个答案（t(n−1) > 2 ⇒ 显著门槛恒高于噪声地板）。
  describe('significance rounds（§52 判定口径反解）', () => {
    // 与「detection floor」组同款的最小配对统计构造器（各组自负其辅助函数，互不依赖）。
    const pairedAt = (rounds, stdError) => ({
      rounds,
      score: { rounds, mean: 0.02, stdError, t: 4, dof: rounds - 1, pValue: 0.05, verdict: 'inconclusive' },
    });

    it('solves the minimal round count on the t×SE ruler and disagrees with the 2×SE ruler', () => {
      // 同一组输入：采纳口径说 8 轮（上面的 §45 用例），判定口径说 10 轮 —— 差的这 2 轮就是两把尺子。
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.006), {}, { rounds: 5 });
      const plan = resolveTriggerOptimizerRoundsForSignificance(floor, 0.01, 10);
      expect(plan.satisfied).toBe(false);
      expect(plan.capped).toBe(false);
      expect(plan.rounds).toBe(10);
      expect(plan.effect).toBe(0.01);
      // 最小性：9 轮的显著门槛仍高于 0.01（t(8) 2.3060 × 0.006 × √(5/9) ≈ 0.010314），10 轮才够。
      expect(projectTriggerOptimizerDetectionFloor(floor, 9).significanceFloor).toBeGreaterThan(0.01);
      expect(projectTriggerOptimizerDetectionFloor(floor, 10).significanceFloor).toBeLessThan(0.01);
      // 「提到 8 轮」买不到显著：8 轮的显著门槛（≈0.0112）仍高于目标。
      const adopted = resolveTriggerOptimizerRoundsForEffect(floor, 0.01, 10);
      expect(adopted.rounds).toBe(8);
      expect(projectTriggerOptimizerDetectionFloor(floor, adopted.rounds).significanceFloor).toBeGreaterThan(0.01);
    });

    it('uses the same t×SE ruler as the verification back-solve', () => {
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.006), {}, { rounds: 5 });
      const mine = resolveTriggerOptimizerRoundsForSignificance(floor, 0.01, 10);
      const theirs = resolveTriggerOptimizerVerificationRounds(
        { rounds: 5, mean: 0.01, stdError: 0.006, verdict: 'inconclusive' },
        10,
      );
      // 同一个 t×SE 反解核（目标效应 = 观测均值时的两种入口）：同一输入必须给出同一轮数。
      expect(mine.rounds).toBe(theirs.requiredRounds);
      expect(theirs.capped).toBe(false);
    });

    it('reports the three exits honestly (already enough / raise rounds / beyond cap)', () => {
      // 已够：10 轮、SE 0.004 ⇒ t(9) × 0.004 ≈ 0.00905 < 0.01。
      const settled = resolveTriggerOptimizerRoundsForSignificance(
        resolveTriggerOptimizerDetectionFloor(pairedAt(10, 0.004), {}, { rounds: 10 }),
        0.01,
        10,
      );
      expect(settled.satisfied).toBe(true);
      expect(settled.rounds).toBe(10);
      // 上限内不够：SE(5) = 0.01 ⇒ t(9) × 0.01 × √(5/10) ≈ 0.016 > 0.01 ⇒ capped。
      const capped = resolveTriggerOptimizerRoundsForSignificance(
        resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.01), {}, { rounds: 5 }),
        0.01,
        10,
      );
      expect(capped.capped).toBe(true);
      expect(capped.rounds).toBe(10);
    });

    it('refuses to guess on invalid inputs instead of inventing advice', () => {
      const floor = resolveTriggerOptimizerDetectionFloor(pairedAt(5, 0.006), {}, { rounds: 5 });
      expect(resolveTriggerOptimizerRoundsForSignificance(null, 0.01, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForSignificance(floor, 0, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForSignificance(floor, Number.NaN, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForSignificance({ rounds: 5, stdError: 0 }, 0.01, 10)).toBeNull();
      expect(resolveTriggerOptimizerRoundsForSignificance({ rounds: 1, stdError: 0.01 }, 0.01, 10)).toBeNull();
    });
  });

  // 复验轮数自适应（2026-09-25，设计 §47）：反解「把已观测到的效应量判成明确结论要多少轮」
  // （口径 |mean| > t(n−1) × SE，与结论卡同一把尺子），再按实测胜出的 A′ 口径折成执行计划。
  describe('verification rounds（§47 自适应追加）', () => {
    const CAP = 24;
    // 三个样本点手算自证（SE ∝ 1/√n，t 随自由度下降 ⇒ t(n−1)√(6/n) 单调下降，试到第一个即可）：
    //   mean 0.025 / SE(6) 0.02 ⇒ n ≥ 18（17 轮差一点：t(16) 2.1199 × 0.02√(6/17) ≈ 0.025186 > 0.025）
    //   mean 0.040 / SE(6) 0.02 ⇒ n ≥ 9（t(7) 2.3646 × 0.02√(6/8) ≈ 0.040958 > 0.04；9 轮 0.037659）
    //   mean 0.005 / SE(6) 0.02 ⇒ 连 24 轮都不够（24 轮门槛 ≈ 0.020687）
    const summary = (mean, stdError, extra = {}) => ({ rounds: 6, mean, stdError, verdict: 'inconclusive', ...extra });

    it('reverse-solves the minimal decisive round count and never invents a smaller one', () => {
      const plan = resolveTriggerOptimizerVerificationRounds(summary(0.025, 0.02), CAP);
      expect(plan.decisive).toBe(false);
      expect(plan.capped).toBe(false);
      expect(plan.extend).toBe(true);
      expect(plan.requiredRounds).toBe(18);
      expect(plan.targetRounds).toBe(18);
      // 最小性自证：把上限收到 17 轮就反解不出任何可行轮数（capped）——「18 轮」不是随口说的。
      const tighter = resolveTriggerOptimizerVerificationRounds(summary(0.025, 0.02), 17);
      expect(tighter.capped).toBe(true);
      expect(tighter.requiredRounds).toBeNull();
      // 已是明确结论（positive/negative）→ decisive，不追加。
      const settled = resolveTriggerOptimizerVerificationRounds(summary(0.05, 0.01, { verdict: 'positive' }), CAP);
      expect(settled.decisive).toBe(true);
      expect(settled.extend).toBe(false);
      // 上限也不够：requiredRounds = null，targetRounds = 上限（调用方据此决定花不花样本）。
      const capped = resolveTriggerOptimizerVerificationRounds(summary(0.005, 0.02), CAP);
      expect(capped.capped).toBe(true);
      expect(capped.requiredRounds).toBeNull();
      expect(capped.targetRounds).toBe(CAP);
      // 零差是**合法退化**、不是非法输入（2026-09-26，设计 §50 B-1）：逐轮差恒 0（stdError = 0）⇒
      // 标准误永远是 0、t×SE 恒为 0，再加多少轮都判不出 —— 这正是 capped 的定义：与上面的「上限也
      // 不够」同出口（补到上限），而不是回落调用方的「每次 +6 轮」兜底（那条路没有上限，能无限追加）。
      const zeroDiff = resolveTriggerOptimizerVerificationRounds(summary(0.025, 0), CAP);
      expect(zeroDiff.capped).toBe(true);
      expect(zeroDiff.decisive).toBe(false);
      expect(zeroDiff.extend).toBe(false);
      expect(zeroDiff.requiredRounds).toBeNull();
      expect(zeroDiff.targetRounds).toBe(CAP);
      // 退化输入 → null（宁可不出这一行，也不编一份方案）。
      expect(resolveTriggerOptimizerVerificationRounds(null, CAP)).toBeNull();
      // 标准误非法（负值 / 非有限）仍是非法输入 —— 注意零差（恰好 0）已不属于这一类（见上）。
      expect(resolveTriggerOptimizerVerificationRounds(summary(0.025, -0.01), CAP)).toBeNull();
      expect(resolveTriggerOptimizerVerificationRounds(summary(0.025, Number.NaN), CAP)).toBeNull();
      expect(resolveTriggerOptimizerVerificationRounds({ rounds: 1, mean: 0.02, stdError: 0.02 }, CAP)).toBeNull();
    });

    it('plans the A′ append: reverse-solved rounds clamped to [12, 24]', () => {
      const extend = planTriggerOptimizerVerificationAppend(summary(0.025, 0.02), { maxRounds: CAP });
      expect(extend).toMatchObject({
        plannedRounds: 12,
        targetRounds: 18,
        requiredRounds: 18,
        capRounds: CAP,
        capped: false,
        budgetLimited: false,
        // 不给整轮场次 ⇒ 两级护栏与瓶颈都不存在（§50 B-2 的新字段；spent 只数追加部分）。
        budgetSimulations: null,
        cumulativeBudgetSimulations: null,
        spentSimulations: 0,
        limitedBy: null,
      });
      expect(extend.plannedSimulations).toBe(24);
      // 反解小于保底 → 抬到现状口径的 12 轮（A′ 的 max(n*, 12)：绝不比今天少花样本）。
      const floor = planTriggerOptimizerVerificationAppend(summary(0.04, 0.02), { maxRounds: CAP });
      expect(floor.requiredRounds).toBe(9);
      expect(floor.plannedRounds).toBe(6);
      expect(floor.targetRounds).toBe(12);
      // capped → 目标就是上限（A′ 口径：补到上限，不是 A 臂的「不花样本」）。
      const capped = planTriggerOptimizerVerificationAppend(summary(0.005, 0.02), { maxRounds: CAP });
      expect(capped.capped).toBe(true);
      expect(capped.plannedRounds).toBe(18);
      expect(capped.targetRounds).toBe(CAP);
      // 已经在上限且仍不明确 → 一轮都追加不了（调用方据此不派样本）。
      const exhausted = planTriggerOptimizerVerificationAppend(
        { rounds: CAP, mean: 0.005, stdError: 0.02, verdict: 'inconclusive' },
        { maxRounds: CAP },
      );
      expect(exhausted.plannedRounds).toBe(0);
      expect(exhausted.capped).toBe(true);
      // 已有明确结论 → decisive，计划为空。
      const settled = planTriggerOptimizerVerificationAppend(summary(0.05, 0.01, { verdict: 'negative' }), {
        maxRounds: CAP,
      });
      expect(settled.decisive).toBe(true);
      expect(settled.plannedRounds).toBe(0);
      // 退化输入 → null（调用方保持今天的固定 6 轮）。
      expect(planTriggerOptimizerVerificationAppend(null, { maxRounds: CAP })).toBeNull();
    });

    it('caps the append by the 20% single and 40% cumulative cost guards of the whole run', () => {
      // 整轮 100 场 → 单次预算 20 场 = 10 轮/侧：需要 12 轮 → 钳到 10 轮（单次护栏咬住；累计预算
      // 40 场这里还剩 40 且没花过 ⇒ 允许 20 轮，不是瓶颈）。
      const limited = planTriggerOptimizerVerificationAppend(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 100,
      });
      expect(limited.budgetSimulations).toBe(20);
      expect(limited.cumulativeBudgetSimulations).toBe(40);
      expect(limited.spentSimulations).toBe(0);
      expect(limited.budgetLimited).toBe(true);
      expect(limited.limitedBy).toBe('single');
      expect(limited.plannedRounds).toBe(10);
      expect(limited.plannedSimulations).toBe(20);
      expect(limited.targetRounds).toBe(16);
      // 整轮 8 场 → 预算 1 场：连 1 轮都追加不了（护栏本意：不许对快档花掉半个整轮）。
      const starved = planTriggerOptimizerVerificationAppend(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 8,
      });
      expect(starved.budgetLimited).toBe(true);
      // 单次 20% = 1 场 ⇒ 允许 0 轮（累计 40% = 3 场允许 1 轮，不是最终瓶颈）。
      expect(starved.limitedBy).toBe('single');
      expect(starved.plannedRounds).toBe(0);
      // 累计护栏是两级里的**第二级**（2026-09-26，设计 §50 B-2）：整轮 100 场 → 累计预算 40 场，
      // 已经追加过 30 场（spent）⇒ 本次只剩 10 场 = 5 轮 —— 比单次允许的 10 轮更紧，最终瓶颈是
      // 累计（limitedBy 记的是**最终**钳住的那一级）。
      const cumulative = planTriggerOptimizerVerificationAppend(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 100,
        spentSimulations: 30,
      });
      expect(cumulative.cumulativeBudgetSimulations).toBe(40);
      expect(cumulative.spentSimulations).toBe(30);
      expect(cumulative.budgetLimited).toBe(true);
      expect(cumulative.limitedBy).toBe('cumulative');
      expect(cumulative.plannedRounds).toBe(5);
      expect(cumulative.plannedSimulations).toBe(10);
      expect(cumulative.targetRounds).toBe(11);
      // 累计预算已经花光（30 → 40 场）⇒ 一轮都追加不了：调用方据此报「预算用尽」而不是「上限不够」
      //（反解本身在 cap 内是解得出 12 轮的，预算才是瓶颈）。
      const cumulativeExhausted = planTriggerOptimizerVerificationAppend(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 100,
        spentSimulations: 40,
      });
      expect(cumulativeExhausted.budgetLimited).toBe(true);
      expect(cumulativeExhausted.limitedBy).toBe('cumulative');
      expect(cumulativeExhausted.plannedRounds).toBe(0);
      // 拿不到整轮场次（老报告）→ 不假装有护栏：budgetSimulations 为 null，按上限口径全量追加。
      const unknown = planTriggerOptimizerVerificationAppend(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 0,
      });
      expect(unknown.budgetSimulations).toBeNull();
      expect(unknown.cumulativeBudgetSimulations).toBeNull();
      expect(unknown.spentSimulations).toBe(0);
      expect(unknown.budgetLimited).toBe(false);
      expect(unknown.limitedBy).toBeNull();
      expect(unknown.plannedRounds).toBe(12);
    });
  });

  // 复核轮数自适应（2026-09-25，设计 §49）：拿报告已有的复验统计反解「换到相邻难度重测要多少
  // 轮」（同 §47 的 t×SE 尺子，但语义是「新现场从零要多少轮」——先验已判明确也要给数），
  // 再按 A′ 口径折成执行计划（保底 6 / 上限 16 / 增量护栏 20%）。
  describe('robustness rounds（§49 自适应复核）', () => {
    const CAP = TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS;
    // 同一把尺子的手算自证（与 §47 组共用）：0.04 / SE(6) 0.02 ⇒ 9 轮；0.025 / SE(6) 0.02 ⇒ 18 轮。
    const summary = (mean, stdError, extra = {}) => ({ rounds: 6, mean, stdError, verdict: 'inconclusive', ...extra });

    it('reverse-solves the minimum sufficient rounds for a fresh difficulty', () => {
      const plan = resolveTriggerOptimizerRobustnessRounds(summary(0.04, 0.02), CAP);
      expect(plan.requiredRounds).toBe(9);
      expect(plan.capped).toBe(false);
      // 18 > 上限 16 ⇒ cap 内无解（capped：调用方补到上限）。
      const capped = resolveTriggerOptimizerRobustnessRounds(summary(0.025, 0.02), CAP);
      expect(capped.capped).toBe(true);
      expect(capped.requiredRounds).toBeNull();
      // 先验已判明确（positive）也要给出轮数 —— 复核是「新现场一定要跑」，不是「追加」。
      const settled = resolveTriggerOptimizerRobustnessRounds(summary(0.05, 0.01, { verdict: 'positive' }), CAP);
      expect(settled.requiredRounds).toBe(4);
      expect(settled.capped).toBe(false);
      // 退化输入 → null（调用方保持固定 6 轮，不编一份方案）。
      expect(resolveTriggerOptimizerRobustnessRounds(null, CAP)).toBeNull();
      expect(resolveTriggerOptimizerRobustnessRounds(summary(0.025, 0), CAP)).toBeNull();
      expect(resolveTriggerOptimizerRobustnessRounds({ rounds: 1, mean: 0.02, stdError: 0.02 }, CAP)).toBeNull();
    });

    it('plans the adaptive robustness run clamped to [6, 16]', () => {
      const extend = planTriggerOptimizerRobustnessRounds(summary(0.04, 0.02), { maxRounds: CAP });
      expect(extend).toMatchObject({
        plannedRounds: 9,
        requiredRounds: 9,
        capRounds: CAP,
        capped: false,
        budgetLimited: false,
        budgetSimulations: null,
      });
      expect(extend.plannedSimulations).toBe(18);
      // 反解小于保底 → 抬到现状口径的 6 轮（保底：绝不比今天少花样本）。
      const floor = planTriggerOptimizerRobustnessRounds(summary(0.05, 0.01), { maxRounds: CAP });
      expect(floor.requiredRounds).toBe(4);
      expect(floor.plannedRounds).toBe(6);
      // capped → 目标就是上限（补到上限，不是「不花样本」）。
      const capped = planTriggerOptimizerRobustnessRounds(summary(0.025, 0.02), { maxRounds: CAP });
      expect(capped.capped).toBe(true);
      expect(capped.plannedRounds).toBe(CAP);
      expect(capped.plannedSimulations).toBe(CAP * 2);
      // 退化输入 → null。
      expect(planTriggerOptimizerRobustnessRounds(null, { maxRounds: CAP })).toBeNull();
    });

    it('caps the extra spend by the shared 20% guard on top of the baseline', () => {
      // 整轮 40 场 → 预算 8 场 = 4 轮额外：capped 目标 16 轮（= 保底 6 + 10）→ 钳到 10 轮。
      const limited = planTriggerOptimizerRobustnessRounds(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 40,
      });
      expect(limited.budgetSimulations).toBe(8);
      expect(limited.budgetLimited).toBe(true);
      expect(limited.plannedRounds).toBe(10);
      expect(limited.plannedSimulations).toBe(20);
      // 整轮 8 场 → 预算 1 场 = 0 轮额外：自适应完全被护栏收住，但**不低于现状 6 轮**。
      const starved = planTriggerOptimizerRobustnessRounds(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 8,
      });
      expect(starved.budgetLimited).toBe(true);
      expect(starved.plannedRounds).toBe(6);
      // 目标不超保底时不触发护栏（没多花就没得限）。
      const within = planTriggerOptimizerRobustnessRounds(summary(0.05, 0.01), {
        maxRounds: CAP,
        wholeRunSimulations: 8,
      });
      expect(within.budgetLimited).toBe(false);
      expect(within.plannedRounds).toBe(6);
      // 拿不到整轮场次（老报告）→ 不假装有护栏：budgetSimulations 为 null，按上限口径全量。
      const unknown = planTriggerOptimizerRobustnessRounds(summary(0.025, 0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 0,
      });
      expect(unknown.budgetSimulations).toBeNull();
      expect(unknown.budgetLimited).toBe(false);
      expect(unknown.plannedRounds).toBe(CAP);
    });
  });

  // 复核**追加**的执行计划（2026-09-26，设计 §51）：复跑 = 换盐补到上限（不是同盐重跑、也不是
  // 按需反解 —— 装置 S2 臂实测「补到上限」解析率 97.6% vs 按需 89.4%），并带零差出口与两级
  // 护栏（与追加复验共用同一组比例常量，单一事实源：单次 20% / 累计 40%）。
  describe('robustness append plan（§51 复核追加）', () => {
    const CAP = TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS;
    const summary = (stdError, rounds = 6, extra = {}) => ({
      rounds,
      mean: 0.02,
      stdError,
      verdict: 'inconclusive',
      ...extra,
    });

    it('plans to fill the gap up to the robustness cap with fresh rounds', () => {
      const plan = planTriggerOptimizerRobustnessAppend(summary(0.02), { maxRounds: CAP });
      expect(plan).toMatchObject({
        zeroDiff: false,
        atCap: false,
        // capped 恒为 true：追加的目标就是上限（与 §49 的 capped「反解无解」语义同款——
        // requiredRounds 恒 null，追加不做反解）。
        capped: true,
        budgetLimited: false,
        limitedBy: null,
        currentRounds: 6,
        requiredRounds: null,
        capRounds: CAP,
        plannedRounds: 10,
        plannedSimulations: 20,
      });
      // 已有 8 轮 ⇒ 补 8 轮（补的是差额，不是固定 6 轮）。
      const partial = planTriggerOptimizerRobustnessAppend(summary(0.02, 8), { maxRounds: CAP });
      expect(partial.plannedRounds).toBe(8);
      expect(partial.atCap).toBe(false);
    });

    it('spends nothing when the paired differences are exactly zero', () => {
      const zero = planTriggerOptimizerRobustnessAppend(summary(0), { maxRounds: CAP });
      expect(zero.zeroDiff).toBe(true);
      expect(zero.atCap).toBe(false);
      expect(zero.plannedRounds).toBe(0);
      expect(zero.plannedSimulations).toBe(0);
      // 非零 SE（再小）也不触发零差出口：判据只看「恒为 0」这一件事。
      expect(planTriggerOptimizerRobustnessAppend(summary(0.001), { maxRounds: CAP }).zeroDiff).toBe(false);
    });

    it('spends nothing when the cap is already reached (the cap is a total limit)', () => {
      const atCap = planTriggerOptimizerRobustnessAppend(summary(0.02, CAP), { maxRounds: CAP });
      expect(atCap.atCap).toBe(true);
      expect(atCap.zeroDiff).toBe(false);
      expect(atCap.plannedRounds).toBe(0);
      // 缺 maxRounds 时上限回落到当前轮数 ⇒ 同样视作已到上限（不假装还有一个更高的天花板）。
      const noCap = planTriggerOptimizerRobustnessAppend(summary(0.02, 6));
      expect(noCap.capRounds).toBe(6);
      expect(noCap.atCap).toBe(true);
      expect(noCap.plannedRounds).toBe(0);
    });

    it('clamps by the single 20% guard and then by the cumulative 40% guard', () => {
      // 整轮 40 场 ⇒ 单次预算 8 场 = 4 轮；要补 10 轮 ⇒ 钳到 4 轮，瓶颈 'single'。
      const single = planTriggerOptimizerRobustnessAppend(summary(0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 40,
      });
      expect(single.budgetSimulations).toBe(8);
      expect(single.cumulativeBudgetSimulations).toBe(16);
      expect(single.budgetLimited).toBe(true);
      expect(single.limitedBy).toBe('single');
      expect(single.plannedRounds).toBe(4);
      expect(single.plannedSimulations).toBe(8);

      // 整轮 100 场：单次预算 20 场（允许 10 轮，没咬）；累计预算 40 场、已花 38 ⇒ 只剩
      // 1 场 = 0.5 轮 ⇒ 钳到 0 轮？不 —— floor((40−38)/2) = 1 轮，累计才是最终瓶颈。
      const cumulative = planTriggerOptimizerRobustnessAppend(summary(0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 100,
        spentSimulations: 38,
      });
      expect(cumulative.budgetLimited).toBe(true);
      expect(cumulative.limitedBy).toBe('cumulative');
      expect(cumulative.plannedRounds).toBe(1);

      // 累计预算正好花光（40/40）：一轮都不追加 —— 调用方据此报「预算用尽」而不是「上限不够」。
      const exhausted = planTriggerOptimizerRobustnessAppend(summary(0.02), {
        maxRounds: CAP,
        wholeRunSimulations: 100,
        spentSimulations: 40,
      });
      expect(exhausted.plannedRounds).toBe(0);
      expect(exhausted.limitedBy).toBe('cumulative');
    });

    it('reports no guard when the whole-run budget is unknown', () => {
      const unknown = planTriggerOptimizerRobustnessAppend(summary(0.02), { maxRounds: CAP });
      expect(unknown.budgetSimulations).toBeNull();
      expect(unknown.cumulativeBudgetSimulations).toBeNull();
      expect(unknown.spentSimulations).toBe(0);
      expect(unknown.budgetLimited).toBe(false);
      expect(unknown.limitedBy).toBeNull();
      expect(unknown.plannedRounds).toBe(10);
      // 脏的 spent（负数 / 非数字）按 0 计：护栏宁可不咬，也不误咬。
      expect(
        planTriggerOptimizerRobustnessAppend(summary(0.02), { maxRounds: CAP, spentSimulations: -5 }).spentSimulations,
      ).toBe(0);
    });

    it('returns null for degenerate summaries instead of inventing a plan', () => {
      expect(planTriggerOptimizerRobustnessAppend(null)).toBeNull();
      expect(planTriggerOptimizerRobustnessAppend(undefined)).toBeNull();
      expect(planTriggerOptimizerRobustnessAppend({ rounds: 1, stdError: 0.02 })).toBeNull();
      expect(planTriggerOptimizerRobustnessAppend({ rounds: 0, stdError: 0.02 })).toBeNull();
      expect(planTriggerOptimizerRobustnessAppend({ rounds: 'x', stdError: 0.02 })).toBeNull();
      // stdError 缺失（NaN）不算零差（零差要求严格等于 0 的有限数），照常补到上限。
      const missingSe = planTriggerOptimizerRobustnessAppend({ rounds: 6 }, { maxRounds: CAP });
      expect(missingSe.zeroDiff).toBe(false);
      expect(missingSe.plannedRounds).toBe(10);
    });
  });
});
