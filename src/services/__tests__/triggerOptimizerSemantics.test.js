import { describe, expect, it } from 'vitest';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import Ability from '../../combatsimulator/ability.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { buildPlayersForSimulation } from '../playerMapper.js';
import { buildSingleSimulationPayload, ONE_HOUR } from '../simulationDomain.js';
import {
  applyTriggerStateToTriggerMap,
  getEffectiveTriggerState,
  getDefaultTriggerDtosForHrid,
  sanitizeTriggerList,
  sanitizeTriggerMap,
  toTriggerInstances,
} from '../triggerMapper.js';

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';
const GTE = '/combat_trigger_comparators/greater_than_equal';

// 技能槽 1 的智力要求是 abilitySlotsLevelRequirementList[2] === 1，
// createEmptyPlayerConfig 的全 1 等级即可让它进入模拟。
const ABILITY_SLOT = 1;

function findFirstAbilityWithDefaultTriggers() {
  const ability = Object.values(abilityDetailMap).find(
    (entry) =>
      entry?.isSpecialAbility !== true &&
      Array.isArray(entry?.defaultCombatTriggers) &&
      entry.defaultCombatTriggers.length > 0,
  );
  return ability?.hrid ?? '';
}

const ABILITY_HRID = findFirstAbilityWithDefaultTriggers();

function customTrigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

function buildPlayerConfig(triggerMap) {
  const config = createEmptyPlayerConfig('1');
  config.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
  config.triggerMap = triggerMap;
  return config;
}

// 引擎 Player 对象不可直接 JSON.stringify（含循环/方法），只投影触发器部分。
function extractTriggerSignatures(payload) {
  return payload.players.map((player) =>
    (player.abilities || []).map((ability) =>
      ability
        ? (ability.triggers || []).map((trigger) => [
            trigger.dependencyHrid,
            trigger.conditionHrid,
            trigger.comparatorHrid,
            trigger.value,
          ])
        : null,
    ),
  );
}

describe('triggerOptimizerSemantics', () => {
  it('uses a real ability with default triggers as the probe target', () => {
    expect(ABILITY_HRID).toBeTruthy();
    expect(getDefaultTriggerDtosForHrid(ABILITY_HRID).length).toBeGreaterThan(0);
  });

  describe('triggerMap 四态在 sanitize 层的保持', () => {
    it('保留空数组键（hasOwnProperty 分叉点）', () => {
      // 空数组必须被原样保留：playerMapper 用 hasOwnProperty 判定走自定义分支。
      expect(sanitizeTriggerMap({})).toEqual({});
      expect(sanitizeTriggerMap({ [ABILITY_HRID]: [] })).toEqual({ [ABILITY_HRID]: [] });
      expect(sanitizeTriggerMap({ [ABILITY_HRID]: [customTrigger(500)] })).toEqual({
        [ABILITY_HRID]: [customTrigger(500)],
      });
      // sanitize 不与默认值比较，写默认值不会被折叠。
      const defaults = getDefaultTriggerDtosForHrid(ABILITY_HRID);
      expect(sanitizeTriggerMap({ [ABILITY_HRID]: defaults })).toEqual({ [ABILITY_HRID]: defaults });
    });

    it('丢弃非法键与非法触发器条目', () => {
      expect(sanitizeTriggerMap({ '': [customTrigger(1)] })).toEqual({});
      // sanitize 只校验触发器条目内容，不校验 target hrid 是否存在于游戏数据：
      // 未知 hrid 的键被保留，其合法触发器条目也原样保留。
      expect(sanitizeTriggerMap({ '/abilities/nonexistent': [customTrigger(1)] })).toEqual({
        '/abilities/nonexistent': [customTrigger(1)],
      });
      // 多目标 condition 配单目标 dependency → 非法，条目被丢弃。
      expect(
        sanitizeTriggerList([
          {
            dependencyHrid: SELF,
            conditionHrid: '/combat_trigger_conditions/number_of_active_units',
            comparatorHrid: GTE,
            value: 2,
          },
        ]),
      ).toEqual([]);
      // 缺字段 / 非法 comparator → 丢弃。
      expect(sanitizeTriggerList([{ dependencyHrid: SELF, conditionHrid: CURRENT_HP }])).toEqual([]);
    });
  });

  describe('toTriggerInstances 的四态映射', () => {
    it('null / undefined / 空数组 一律映射为空数组', () => {
      // 空数组是关键：它是 truthy，会进入 Ability 的自定义分支。
      expect(toTriggerInstances(null)).toEqual([]);
      expect(toTriggerInstances(undefined)).toEqual([]);
      expect(toTriggerInstances([])).toEqual([]);
    });

    it('合法 DTO 映射为 Trigger 实例', () => {
      const instances = toTriggerInstances([customTrigger(500)]);
      expect(instances).toHaveLength(1);
      expect(instances[0]).toMatchObject(customTrigger(500));
      expect(typeof instances[0].isActive).toBe('function');
    });
  });

  describe('getEffectiveTriggerState 的四态口径', () => {
    it('无键 = default', () => {
      const defaults = getDefaultTriggerDtosForHrid(ABILITY_HRID);
      expect(getEffectiveTriggerState({}, ABILITY_HRID)).toEqual({
        targetHrid: ABILITY_HRID,
        state: 'default',
        triggers: defaults,
        signature: JSON.stringify(defaults),
      });
    });

    it('有键且空列表 = disabled（UI 标签，引擎语义是立即释放）', () => {
      expect(getEffectiveTriggerState({ [ABILITY_HRID]: [] }, ABILITY_HRID)).toEqual({
        targetHrid: ABILITY_HRID,
        state: 'disabled',
        triggers: [],
        signature: '[]',
      });
    });

    it('有键且与默认签名相同 = default（折叠）', () => {
      const defaults = getDefaultTriggerDtosForHrid(ABILITY_HRID);
      expect(getEffectiveTriggerState({ [ABILITY_HRID]: defaults }, ABILITY_HRID).state).toBe('default');
    });

    it('有键且与默认不同 = custom', () => {
      expect(getEffectiveTriggerState({ [ABILITY_HRID]: [customTrigger(500)] }, ABILITY_HRID)).toMatchObject({
        targetHrid: ABILITY_HRID,
        state: 'custom',
        triggers: [customTrigger(500)],
      });
    });
  });

  describe('applyTriggerStateToTriggerMap 与状态往返', () => {
    it('default 删键、disabled 写空数组、custom 写 sanitize 结果', () => {
      const base = {};
      applyTriggerStateToTriggerMap(base, ABILITY_HRID, 'default');
      expect(base).toEqual({});

      applyTriggerStateToTriggerMap(base, ABILITY_HRID, 'disabled');
      expect(base).toEqual({ [ABILITY_HRID]: [] });

      applyTriggerStateToTriggerMap(base, ABILITY_HRID, 'custom', [customTrigger('500')]);
      expect(base).toEqual({ [ABILITY_HRID]: [customTrigger(500)] });
    });

    it('disabled 与 custom 的落盘值都能到达引擎（不被 sanitize 吞掉）', () => {
      const disabledMap = applyTriggerStateToTriggerMap({}, ABILITY_HRID, 'disabled');
      expect(Object.prototype.hasOwnProperty.call(disabledMap, ABILITY_HRID)).toBe(true);
      expect(toTriggerInstances(disabledMap[ABILITY_HRID])).toEqual([]);

      const customMap = applyTriggerStateToTriggerMap({}, ABILITY_HRID, 'custom', [customTrigger(500)]);
      expect(toTriggerInstances(customMap[ABILITY_HRID])).toHaveLength(1);
    });
  });

  describe('引擎层：Ability 对空数组的实际行为', () => {
    // 这条测试是「空列表 = 立即释放，不是禁用」的直接引擎证据。
    it('triggers=null 走默认触发器，triggers=[] 清空触发器', () => {
      const defaults = getDefaultTriggerDtosForHrid(ABILITY_HRID);
      const withDefaults = new Ability(ABILITY_HRID, 1, null);
      expect(withDefaults.triggers).toHaveLength(defaults.length);

      const alwaysFire = new Ability(ABILITY_HRID, 1, toTriggerInstances([]));
      expect(alwaysFire.triggers).toEqual([]);
      // shouldTrigger 的语义：triggers 清空后冷却好了就放（见 ability.js 的 length == 0 分支）。
      expect(alwaysFire.triggers.length).toBe(0);
    });
  });

  describe('buildPlayersForSimulation 对四态的注入', () => {
    it('无键注入默认触发器', () => {
      const players = buildPlayersForSimulation([buildPlayerConfig({})]);
      const triggers = players[0].abilities[ABILITY_SLOT].triggers;
      expect(triggers.map((t) => t.dependencyHrid)).toEqual(
        getDefaultTriggerDtosForHrid(ABILITY_HRID).map((t) => t.dependencyHrid),
      );
    });

    it('空列表注入空触发器（立即释放，不是禁用）', () => {
      const players = buildPlayersForSimulation([buildPlayerConfig({ [ABILITY_HRID]: [] })]);
      expect(players[0].abilities[ABILITY_SLOT].triggers).toEqual([]);
    });

    it('自定义列表注入自定义触发器', () => {
      const players = buildPlayersForSimulation([buildPlayerConfig({ [ABILITY_HRID]: [customTrigger(500)] })]);
      expect(players[0].abilities[ABILITY_SLOT].triggers).toMatchObject([customTrigger(500)]);
    });
  });

  describe('buildSingleSimulationPayload 对仅 triggerMap 不同的配置产出不同 payload', () => {
    const settings = {
      mode: 'zone',
      zoneHrid: '/actions/combat/green_slimes',
      difficultyTier: 0,
      simulationTimeHours: 24,
    };

    it('payload 的 zone/time/extra 不随 triggerMap 变化', () => {
      const playersA = buildPlayersForSimulation([buildPlayerConfig({})]);
      const playersB = buildPlayersForSimulation([buildPlayerConfig({ [ABILITY_HRID]: [] })]);

      const payloadA = buildSingleSimulationPayload(playersA, settings, [], { workerId: 'probe-a' });
      const payloadB = buildSingleSimulationPayload(playersB, settings, [], { workerId: 'probe-b' });

      expect(payloadA.zone).toEqual(payloadB.zone);
      expect(payloadA.simulationTimeLimit).toBe(24 * ONE_HOUR);
      expect(payloadA.simulationTimeLimit).toBe(payloadB.simulationTimeLimit);
      expect(payloadA.extra).toEqual(payloadB.extra);
      expect(payloadA.type).toBe('start_simulation');
    });

    it('payload.players 的触发器随 triggerMap 不同而不同（默认 vs 立即释放）', () => {
      const playersA = buildPlayersForSimulation([buildPlayerConfig({})]);
      const playersB = buildPlayersForSimulation([buildPlayerConfig({ [ABILITY_HRID]: [] })]);

      const payloadA = buildSingleSimulationPayload(playersA, settings, [], { workerId: 'probe-a' });
      const payloadB = buildSingleSimulationPayload(playersB, settings, [], { workerId: 'probe-b' });

      expect(extractTriggerSignatures(payloadA)).not.toEqual(extractTriggerSignatures(payloadB));
      // 空列表一侧的槽位触发器为空，另一侧带默认触发器。
      expect(extractTriggerSignatures(payloadB)[0][ABILITY_SLOT]).toEqual([]);
      expect(extractTriggerSignatures(payloadA)[0][ABILITY_SLOT].length).toBeGreaterThan(0);
    });

    it('payload.players 的触发器随 triggerMap 不同而不同（默认 vs 自定义阈值）', () => {
      const playersA = buildPlayersForSimulation([buildPlayerConfig({})]);
      const playersC = buildPlayersForSimulation([buildPlayerConfig({ [ABILITY_HRID]: [customTrigger(500)] })]);

      const payloadA = buildSingleSimulationPayload(playersA, settings, [], { workerId: 'probe-a' });
      const payloadC = buildSingleSimulationPayload(playersC, settings, [], { workerId: 'probe-c' });

      expect(extractTriggerSignatures(payloadA)).not.toEqual(extractTriggerSignatures(payloadC));
      expect(extractTriggerSignatures(payloadC)[0][ABILITY_SLOT]).toEqual([[SELF, CURRENT_HP, LTE, 500]]);
    });

    it('只有被改动的技能槽触发器变化，其余槽位保持一致', () => {
      const playersA = buildPlayersForSimulation([buildPlayerConfig({})]);
      const playersC = buildPlayersForSimulation([buildPlayerConfig({ [ABILITY_HRID]: [customTrigger(500)] })]);

      const payloadA = buildSingleSimulationPayload(playersA, settings, [], { workerId: 'probe-a' });
      const payloadC = buildSingleSimulationPayload(playersC, settings, [], { workerId: 'probe-c' });

      const signaturesA = extractTriggerSignatures(payloadA)[0];
      const signaturesC = extractTriggerSignatures(payloadC)[0];
      expect(signaturesA.filter((_, index) => index !== ABILITY_SLOT)).toEqual(
        signaturesC.filter((_, index) => index !== ABILITY_SLOT),
      );
    });
  });
});
