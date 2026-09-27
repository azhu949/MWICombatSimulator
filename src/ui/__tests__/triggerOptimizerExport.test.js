import { describe, expect, it } from 'vitest';
import {
  TRIGGER_OPTIMIZER_REPORT_EXPORT_BASENAME,
  buildTriggerOptimizerReportSheets,
} from '../components/triggerOptimizerExport.js';
import { createTriggerOptimizerText } from '../components/triggerOptimizerText.js';

// 依赖注入的最小实现：t = fallback 优先（断言英文 fallback 就是断言「界面同款文案」），
// 游戏文本取 hrid 尾段（触发器行内容可断言）。
const t = (key, fallback) => fallback || key;
const number = (value, digits = 2) => Number(value || 0).toFixed(digits);
const getAbilityName = (hrid) => `ability:${hrid}`;
const getOfficialGameText = (_type, hrid) =>
  String(hrid || '')
    .split('/')
    .pop();
const text = createTriggerOptimizerText({ t, number, getOfficialGameText });

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';
const ABILITY_HRID = '/abilities/fake_ability';

function customTrigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

const ORIGINAL_TRIGGERS = [customTrigger(800)];
const ORIGINAL_SIGNATURE = JSON.stringify(ORIGINAL_TRIGGERS);
const BEST_TRIGGERS = [customTrigger(500)];
const BEST_SIGNATURE = JSON.stringify(BEST_TRIGGERS);
const metrics = { dps: 100, dailyNoRngProfit: 5, xpPerHour: 1000, killsPerHour: 60, deathsPerHour: 0 };

// 夹具形状对齐 TriggerOptimizerPage.template.test 的 makeResult，另加「当前配置」锚点候选
//（真实报告必然有它 —— resolveOriginalTriggers 靠它定位搜索起点，勿改读玩家当前 triggerMap）。
function makeReport() {
  const candidates = [
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'custom',
      triggers: ORIGINAL_TRIGGERS,
      signature: ORIGINAL_SIGNATURE,
      labelKey: 'common:triggerOptimizer.candidate.current',
      labelParams: {},
      distance: 0,
    },
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'default',
      triggers: null,
      signature: 'default',
      labelKey: 'common:triggerOptimizer.candidate.default',
      labelParams: {},
      distance: 1,
    },
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'disabled',
      triggers: [],
      signature: '[]',
      labelKey: 'common:triggerOptimizer.candidate.alwaysFire',
      labelParams: {},
      distance: 2,
    },
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'custom',
      triggers: BEST_TRIGGERS,
      signature: BEST_SIGNATURE,
      labelKey: 'common:triggerOptimizer.candidate.lowHp',
      labelParams: { percent: 75 },
      distance: 3,
    },
  ];
  const chosen = { ...candidates[3], metrics, score: 0.42 };
  return {
    cancelled: false,
    perAbilityChoices: [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        role: 'damage',
        roleLabelKey: 'common:triggerOptimizer.role.damage',
        candidates,
        chosen,
        candidateLimit: 4,
        generatedCandidates: 4,
        truncatedCandidates: 0,
      },
    ],
    metricsByCandidate: {
      [`1|${ORIGINAL_SIGNATURE}`]: { metrics: { ...metrics, dps: 90 }, score: 0, paired: null, slotIndex: 1 },
      '1|default': { metrics: { ...metrics, dps: 90 }, score: -0.05, paired: null, slotIndex: 1 },
      '1|[]': {
        metrics: { ...metrics, dps: 95 },
        score: 0.1,
        paired: null,
        slotIndex: 1,
        lane: 'screen',
        sampleRounds: 2,
      },
      [`1|${BEST_SIGNATURE}`]: { metrics, score: 0.42, paired: null, slotIndex: 1 },
    },
    adoptedSlots: [1],
    bestTriggerMap: { [ABILITY_HRID]: BEST_TRIGGERS },
    improvement: { score: 0.42, scoreDelta: 0.47, improved: true },
    createdAt: 1727000000000,
  };
}

describe('triggerOptimizerReport export sheets', () => {
  it('builds three sheets with interface wording, signed scores and config cell text', () => {
    const report = makeReport();
    const summaryRows = [
      { item: 'Report time', value: '2024/9/22 12:00:00' },
      { item: 'Conclusion', value: 'Optimization works' },
    ];
    const sheets = buildTriggerOptimizerReportSheets({
      report,
      summaryRows,
      statusBySlot: { 1: 'Recommended' },
      text,
      t,
      getAbilityName,
    });

    // 3 个 sheet 名 = 英文 fallback（界面同款文案，不出现字段名）。
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Per-ability comparison', 'All candidates']);

    const [summarySheet, abilitiesSheet, candidatesSheet] = sheets;
    // 总结：两列 + 页面组装的 summaryRows 透传。
    expect(summarySheet.columns.map((column) => column.header)).toEqual(['Item', 'Value']);
    expect(summarySheet.rows).toBe(summaryRows);

    // 逐技能对比：9 列英文表头；分数 = 带符号 4 位（chosen.score）；配置两列 = 触发器行文本。
    expect(abilitiesSheet.columns.map((column) => column.header)).toEqual([
      'Slot',
      'Ability',
      'Role',
      'Status',
      'Candidate',
      'Score',
      'Signal',
      'Current setup (search start)',
      'Simulated best setup',
    ]);
    expect(abilitiesSheet.rows).toHaveLength(1);
    const abilityRow = abilitiesSheet.rows[0];
    expect(abilityRow).toMatchObject({
      slot: 2,
      ability: `ability:${ABILITY_HRID}`,
      status: 'Recommended',
      score: '+0.4200',
    });
    expect(abilityRow.currentConfig).toContain('current_hp less_than_equal 800.00');
    expect(abilityRow.bestConfig).toContain('current_hp less_than_equal 500.00');

    // 候选明细：行数 = 候选数；非 chosen 候选的分数按「槽位|签名」读 metricsByCandidate。
    expect(candidatesSheet.columns.map((column) => column.header)).toEqual([
      'Slot',
      'Ability',
      'Candidate',
      'Triggers',
      'Score',
      'Signal',
    ]);
    expect(candidatesSheet.rows).toHaveLength(4);
    expect(candidatesSheet.rows.map((row) => row.score)).toEqual(['+0.0000', '-0.0500', '+0.1000', '+0.4200']);
    expect(candidatesSheet.rows[3].triggers).toContain('current_hp less_than_equal 500.00');
  });

  it('degrades to empty rows when the report carries no per-ability choices', () => {
    const sheets = buildTriggerOptimizerReportSheets({
      report: { createdAt: 1 },
      summaryRows: [],
      statusBySlot: {},
      text,
      t,
      getAbilityName,
    });
    expect(sheets[1].rows).toEqual([]);
    expect(sheets[2].rows).toEqual([]);
    expect(TRIGGER_OPTIMIZER_REPORT_EXPORT_BASENAME).toBe('mwi-trigger-optimizer-report');
  });
});
