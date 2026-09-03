import { describe, expect, it } from 'vitest';
import actionDetailSource from '../../combatsimulator/data/actionDetailMap.json';
import gameDataIndex from '../gameDataIndex.generated.json';
import { zoneMonsterSpawnIndex } from '../gameDataIndex.js';

const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';

// zoneMonsterSpawnIndex 是刷图推荐器「铁牛模式」的区域→怪物链路入口：
// 键为非地牢战斗区域 hrid，值为该区域（随机刷怪表 + boss 刷怪表合并去重）的
// { monsterHrid, difficultyTier } 列表，difficultyTier 为难度档偏移。
// 本测试锁定构建期投影：
// 1) 模块导出必须指向生成索引中的 zoneMonsterSpawnIndex；
// 2) 键集合必须与 actionDetailIndex 中的非地牢战斗区域完全一致；
// 3) 条目形状必须为 { monsterHrid, difficultyTier } 且区域内去重；
// 4) 投影内容必须与原始表 actionDetailMap 保持一致，防止构建投影漂移漏算怪物。
function buildExpectedIndex() {
  const expected = {};
  for (const action of Object.values(actionDetailSource)) {
    const hrid = String(action?.hrid || '');
    if (!hrid || String(action?.type || '') !== COMBAT_ACTION_TYPE_HRID || action?.combatZoneInfo?.isDungeon === true) {
      continue;
    }

    const fightInfo = action?.combatZoneInfo?.fightInfo;
    const spawnEntries = [
      ...(Array.isArray(fightInfo?.randomSpawnInfo?.spawns) ? fightInfo.randomSpawnInfo.spawns : []),
      ...(Array.isArray(fightInfo?.bossSpawns) ? fightInfo.bossSpawns : []),
    ];
    const seen = new Set();
    const monsters = [];
    for (const spawn of spawnEntries) {
      const monsterHrid = String(spawn?.combatMonsterHrid || '');
      if (!monsterHrid) {
        continue;
      }
      const difficultyTier = Number(spawn?.difficultyTier ?? 0);
      const dedupeKey = `${monsterHrid}::${difficultyTier}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      monsters.push({ monsterHrid, difficultyTier });
    }
    expected[hrid] = monsters;
  }
  return expected;
}

describe('gameDataIndex zoneMonsterSpawnIndex projection', () => {
  it('exports the generated projection through gameDataIndex.js', () => {
    expect(zoneMonsterSpawnIndex).toBe(gameDataIndex.zoneMonsterSpawnIndex);
  });

  it('keys exactly match the non-dungeon combat zones in actionDetailIndex', () => {
    const expectedZoneHrids = new Set(
      Object.values(gameDataIndex.actionDetailIndex)
        .filter((action) => action?.type === COMBAT_ACTION_TYPE_HRID && action?.isDungeon !== true)
        .map((action) => String(action?.hrid || ''))
        .filter(Boolean),
    );
    expect(expectedZoneHrids.size).toBeGreaterThan(0);
    expect(new Set(Object.keys(zoneMonsterSpawnIndex))).toEqual(expectedZoneHrids);
  });

  it('projects deduplicated { monsterHrid, difficultyTier } entries for every zone', () => {
    const zoneHrids = Object.keys(zoneMonsterSpawnIndex);
    expect(zoneHrids.length).toBeGreaterThan(0);
    for (const zoneHrid of zoneHrids) {
      const monsters = zoneMonsterSpawnIndex[zoneHrid];
      expect(Array.isArray(monsters), `${zoneHrid} entries must be an array`).toBe(true);
      expect(monsters.length, `${zoneHrid} must list at least one monster`).toBeGreaterThan(0);
      const seen = new Set();
      for (const entry of monsters) {
        expect(Object.keys(entry).sort(), `${zoneHrid} entry shape`).toEqual(['difficultyTier', 'monsterHrid']);
        expect(entry.monsterHrid.startsWith('/monsters/'), `${zoneHrid} monster hrid prefix`).toBe(true);
        expect(Number.isInteger(entry.difficultyTier), `${zoneHrid} difficultyTier must be an integer`).toBe(true);
        const dedupeKey = `${entry.monsterHrid}::${entry.difficultyTier}`;
        expect(seen.has(dedupeKey), `${zoneHrid} duplicates ${dedupeKey}`).toBe(false);
        seen.add(dedupeKey);
      }
    }
  });

  it('stays in sync with the spawns + bossSpawns of actionDetailMap', () => {
    expect(zoneMonsterSpawnIndex).toEqual(buildExpectedIndex());
  });

  it('merges boss spawns into zone entries and excludes dungeons and the labyrinth', () => {
    // aqua_planet：普通怪 sea_snail 与 boss marine_huntress 都必须收录
    expect(zoneMonsterSpawnIndex['/actions/combat/aqua_planet']).toContainEqual({
      monsterHrid: '/monsters/sea_snail',
      difficultyTier: 0,
    });
    expect(zoneMonsterSpawnIndex['/actions/combat/aqua_planet']).toContainEqual({
      monsterHrid: '/monsters/marine_huntress',
      difficultyTier: 0,
    });
    // 地牢（isDungeon=true）与迷宫（/action_types/labyrinth）不收录
    expect(zoneMonsterSpawnIndex['/actions/combat/enchanted_fortress']).toBeUndefined();
    expect(zoneMonsterSpawnIndex['/actions/labyrinth/explore']).toBeUndefined();
  });
});
