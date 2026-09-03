import { describe, expect, it } from 'vitest';
import actionDetailMap from '../../combatsimulator/data/actionDetailMap.json';
import gameDataIndex from '../../shared/gameDataIndex.generated.json';
import { ADVISOR_DROP_GATE_MAX_ZONE_TIER } from '../advisorDropItems.js';

// 数据不变量：非地牢战斗区域（zoneMonsterSpawnIndex 的数据来源，与
// scripts/build-game-data-index.mjs 的 createZoneMonsterSpawnIndex 同口径：
// randomSpawnInfo.spawns + bossSpawns）的 spawn difficultyTier 偏移当前全为 0。
//
// 在此前提下，advisorDropItems 的掉落可用性索引口径（spawn 偏移 + 区域档）
// 与 profitEstimator 的历史回退口径（simResult.difficultyTier 纯区域档快照）
// 恒等，铁牛模式的候选过滤与掉落/h 估算之间不存在口径分歧。
//
// 一旦上游游戏数据引入非零 spawn 偏移，此测试失败即为显性信号，需要复核：
// ① simResult 掉落桶的 difficultyTier 记录链（recordMonsterDeathFromUnit
//   从 Monster unit 取有效难度）在真实扫描链路中生效；
// ② profitEstimator 优先读桶内难度、缺省回退区域档快照的行为；
// ③ 铁牛模式端到端掉落/h 数值（buildNoRngDropCountMap 与
//   filterAdvisorCandidatesByDropItems 的过滤结果是否自洽）。
describe('spawn difficulty offset data invariant', () => {
  it('keeps every non-dungeon zone spawn offset at 0 in the game data snapshot', () => {
    const violations = [];
    let zoneCount = 0;

    for (const action of Object.values(actionDetailMap)) {
      if (String(action?.type || '') !== '/action_types/combat') {
        continue;
      }
      const zoneInfo = action?.combatZoneInfo;
      if (!zoneInfo || zoneInfo.isDungeon === true) {
        continue;
      }
      zoneCount += 1;

      const fightInfo = zoneInfo.fightInfo;
      const spawns = Array.isArray(fightInfo?.randomSpawnInfo?.spawns) ? fightInfo.randomSpawnInfo.spawns : [];
      const bossSpawns = Array.isArray(fightInfo?.bossSpawns) ? fightInfo.bossSpawns : [];
      for (const spawn of [...spawns, ...bossSpawns]) {
        const offset = Number(spawn?.difficultyTier ?? 0);
        if (offset !== 0) {
          violations.push(`${action.hrid} :: ${spawn?.combatMonsterHrid} :: offset=${offset}`);
        }
      }
    }

    // 快照必须仍含非地牢战斗区域（当前基线：55 区域 / 98 条 spawn，全为 0 偏移）。
    expect(zoneCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

// 同文件的第二条数据不变量：advisorDropItems 的开门档位搜索上限
// ADVISOR_DROP_GATE_MAX_ZONE_TIER（当前 10 = 2 × 实际 maxDifficulty 5）要求
// 全部非地牢战斗区域 maxDifficulty 不超过该上限。若前提失守，开门档位落在
// 上限之外的物品会被 resolveDropGateZoneTier 静默判定「永不可掉」→ 目标物品
// 选项缺失、候选被错误过滤（数据缺失型错误，运行时无任何告警）。
// 与 spawn 偏移前提同理采用双端守护：① raw actionDetailMap 端拦截上游数据
// 增长；② gameDataIndex.generated.json 生成索引端拦截构建投影漂移/文件陈旧
// （spawn 偏移前提的生成端由 gameDataIndex.zoneMonsterSpawn.test.js 的
// raw↔生成同步断言守护，maxDifficulty 前提的生成端守护在此补齐）。
// 断言直接引用导出常量，上调上限后无需改测试。
describe('advisor drop gate zone tier data invariant', () => {
  it('keeps every non-dungeon zone maxDifficulty within the cap in the raw action detail map', () => {
    const violations = [];
    let zoneCount = 0;

    for (const action of Object.values(actionDetailMap)) {
      if (String(action?.type || '') !== '/action_types/combat') {
        continue;
      }
      const zoneInfo = action?.combatZoneInfo;
      if (!zoneInfo || zoneInfo.isDungeon === true) {
        continue;
      }
      zoneCount += 1;

      // 缺字段/非数值同样视为违规：NaN 与上限比较恒为 false，不显式拦截会静默漏过。
      const maxDifficulty = Number(action?.maxDifficulty);
      if (!Number.isFinite(maxDifficulty) || maxDifficulty > ADVISOR_DROP_GATE_MAX_ZONE_TIER) {
        violations.push(`${action.hrid} :: maxDifficulty=${String(action?.maxDifficulty)}`);
      }
    }

    // 快照必须仍含非地牢战斗区域。
    expect(zoneCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('keeps the generated actionDetailIndex maxDifficulty within the cap for every indexed zone', () => {
    // 生成索引是运行时实际消费的数据：buildZoneDropAvailabilityIndex 以
    // zoneMonsterSpawnIndex 的键为区域集合（该键集与 actionDetailIndex 的非地牢
    // 战斗区域完全一致已由 gameDataIndex.zoneMonsterSpawn.test.js 锁定），候选
    // 难度档上界来自 actionDetailIndex 的 maxDifficulty。本断言锁定运行时前提，
    // 拦截生成文件陈旧或构建投影漂移。
    const spawnIndex = gameDataIndex.zoneMonsterSpawnIndex || {};
    const actionDetailIndex = gameDataIndex.actionDetailIndex || {};
    const violations = [];

    for (const zoneHrid of Object.keys(spawnIndex)) {
      // 缺字段/非数值同样视为违规：NaN 与上限比较恒为 false，不显式拦截会静默漏过。
      const maxDifficulty = Number(actionDetailIndex[zoneHrid]?.maxDifficulty);
      if (!Number.isFinite(maxDifficulty) || maxDifficulty > ADVISOR_DROP_GATE_MAX_ZONE_TIER) {
        violations.push(`${zoneHrid} :: maxDifficulty=${String(actionDetailIndex[zoneHrid]?.maxDifficulty)}`);
      }
    }

    // 生成索引必须仍含被索引区域。
    expect(Object.keys(spawnIndex).length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
