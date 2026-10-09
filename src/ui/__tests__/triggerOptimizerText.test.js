import { describe, expect, it } from 'vitest';
import { resolveBestTriggers, resolveOriginalTriggers } from '../components/triggerOptimizerText.js';

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';
const ABILITY_HRID = '/abilities/fake_ability';
const OTHER_HRID = '/abilities/other_ability';

function customTrigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

// 候选表里带「当前配置」锚点的形态（生成器对非空自定义配置产出）。
function currentAnchorChoice(triggers) {
  return {
    slotIndex: 1,
    abilityHrid: ABILITY_HRID,
    candidates: [
      { labelKey: 'common:triggerOptimizer.candidate.default', state: 'default', triggers: null },
      { labelKey: 'common:triggerOptimizer.candidate.current', state: 'custom', triggers },
    ],
  };
}

describe('triggerOptimizerText.resolveOriginalTriggers', () => {
  // 2026-10-07 修复：候选生成器对 []（立即释放）不产「当前配置」锚点，对「配置与默认等价」
  // 会被等价去重删掉锚点 —— 只读锚点的旧口径会把这两种搜索起点误渲染成「游戏默认触发器」
  // （[] 场景还会伪造一次「原始 = 默认条目 / 最优 = 立即释放」的改动）。报告自带的
  // baselineTriggerMap 快照是权威口径：[] 必须还原成 []、有键即用户配置、无键才是默认。
  it('restores the search-start setup from the report baseline snapshot, [] included', () => {
    const choice = { slotIndex: 4, abilityHrid: ABILITY_HRID, candidates: [] };
    expect(resolveOriginalTriggers(choice, { [ABILITY_HRID]: [] })).toEqual([]);
    expect(resolveOriginalTriggers(choice, { [ABILITY_HRID]: [customTrigger(750)] })).toEqual([customTrigger(750)]);
    // 快照里没有该技能键 = 搜索起点就是游戏默认触发器（删键语义）。
    expect(resolveOriginalTriggers(choice, { [OTHER_HRID]: [] })).toBeNull();
  });

  it('prefers the baseline snapshot over the candidate anchor', () => {
    const choice = currentAnchorChoice([customTrigger(750)]);
    expect(resolveOriginalTriggers(choice, { [ABILITY_HRID]: [] })).toEqual([]);
    expect(resolveOriginalTriggers(choice, { [ABILITY_HRID]: [customTrigger(500)] })).toEqual([customTrigger(500)]);
  });

  it('falls back to the candidate anchor for reports without a baseline snapshot', () => {
    expect(resolveOriginalTriggers(currentAnchorChoice([customTrigger(750)]))).toEqual([customTrigger(750)]);
    expect(resolveOriginalTriggers({ slotIndex: 1, abilityHrid: ABILITY_HRID, candidates: [] })).toBeNull();
    expect(resolveOriginalTriggers(null)).toBeNull();
    // 非法快照（数组 / 字符串）同样回退到锚点路径。
    expect(resolveOriginalTriggers(currentAnchorChoice([customTrigger(750)]), [])).toEqual([customTrigger(750)]);
  });

  // 「最优配置」与「原始配置」是对称口径：键不存在 = 删键回落默认；[] = 立即释放。
  it('keeps resolveBestTriggers symmetric for deleted and [] keys', () => {
    expect(resolveBestTriggers({ [ABILITY_HRID]: [] }, ABILITY_HRID)).toEqual([]);
    expect(resolveBestTriggers({}, ABILITY_HRID)).toBeNull();
    expect(resolveBestTriggers(null, ABILITY_HRID, [customTrigger(1)])).toEqual([customTrigger(1)]);
  });
});
