import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// 真实数据快照中所有 spawn 偏移与掉落的 minDifficultyTier 均为 0，无法直接
// 构造「同一地图 T0 不含、T3 含」的难度档样例，因此这里用部分 mock 的合成
// 数据锁定 minZoneTier 数学（真实数据上的集成行为由 advisorDomain.test.js 覆盖）。
vi.mock('../../shared/gameDataIndex.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    soloZoneHrids: ['/actions/combat/ironcow_solo'],
    groupZoneHrids: ['/actions/combat/ironcow_group'],
    zoneMonsterSpawnIndex: {
      '/actions/combat/ironcow_solo': [
        { monsterHrid: '/monsters/ironcow_basic', difficultyTier: 0 },
        { monsterHrid: '/monsters/ironcow_elite', difficultyTier: 2 },
        // 负基础掉率 + 每档增长的开率门样例（对应真实的高级魔法护符类掉落）。
        { monsterHrid: '/monsters/ironcow_charmmage', difficultyTier: 0 },
      ],
      '/actions/combat/ironcow_group': [{ monsterHrid: '/monsters/ironcow_boss', difficultyTier: 0 }],
      // 不在扫描范围（solo/group 列表）中的区域：仅供索引开门档位断言。
      '/actions/combat/ironcow_gated': [{ monsterHrid: '/monsters/ironcow_gatekeeper', difficultyTier: 0 }],
    },
    monsterDetailIndex: {
      '/monsters/ironcow_basic': {
        dropTable: [{ itemHrid: '/items/apple', minDifficultyTier: 0, dropRate: 0.5, minCount: 1, maxCount: 1 }],
        rareDropTable: [{ itemHrid: '/items/pearl', minDifficultyTier: 3, dropRate: 0.02, minCount: 1, maxCount: 1 }],
      },
      '/monsters/ironcow_elite': {
        dropTable: [
          { itemHrid: '/items/apple', minDifficultyTier: 4, dropRate: 0.4, minCount: 1, maxCount: 1 },
          { itemHrid: '/items/quartz', minDifficultyTier: 1, dropRate: 0.4, minCount: 1, maxCount: 1 },
        ],
        rareDropTable: [],
      },
      '/monsters/ironcow_boss': {
        dropTable: [{ itemHrid: '/items/cherry', minDifficultyTier: 0, dropRate: 1, minCount: 1, maxCount: 2 }],
        rareDropTable: [{ itemHrid: '/items/pearl', minDifficultyTier: 0, dropRate: 0.01, minCount: 1, maxCount: 1 }],
      },
      '/monsters/ironcow_charmmage': {
        dropTable: [
          // -0.007 + 0.002×怪物档 > 0 自 T4 起（引擎同款浮点判定，T4 = 0.001）。
          {
            itemHrid: '/items/advanced_charm',
            minDifficultyTier: 0,
            dropRate: -0.007,
            dropRatePerDifficultyTier: 0.002,
            minCount: 1,
            maxCount: 1,
          },
          // 无 perTier 增益的负掉率：任何档位都不产出，不得进入索引。
          { itemHrid: '/items/dead_charm', minDifficultyTier: 0, dropRate: -0.01, minCount: 1, maxCount: 1 },
        ],
        rareDropTable: [
          // 稀有表掉率不随档位变化：负掉率即永不可掉。
          { itemHrid: '/items/rare_dead', minDifficultyTier: 0, dropRate: -0.001, minCount: 1, maxCount: 1 },
        ],
      },
      '/monsters/ironcow_gatekeeper': {
        dropTable: [
          // 浮点边界：-0.006 + 0.0015×4 恰为 0（引擎判定不可掉），T5 才开门。
          {
            itemHrid: '/items/floaty_charm',
            minDifficultyTier: 0,
            dropRate: -0.006,
            dropRatePerDifficultyTier: 0.0015,
            minCount: 1,
            maxCount: 1,
          },
          // -0.00005 + 0.00005×1 恰为 0，T2 开门。
          {
            itemHrid: '/items/epsilon_aura',
            minDifficultyTier: 0,
            dropRate: -0.00005,
            dropRatePerDifficultyTier: 0.00005,
            minCount: 1,
            maxCount: 1,
          },
        ],
        rareDropTable: [],
      },
    },
  };
});

import {
  ADVISOR_DROP_ITEM_HRID_MAX_COUNT,
  buildAdvisorDropItemOptions,
  buildZoneDropAvailabilityIndex,
  filterAdvisorCandidatesByDropItems,
  normalizeDropItemHridList,
} from '../advisorDropItems.js';

const ZONE_SOLO_HRID = '/actions/combat/ironcow_solo';
const ZONE_GROUP_HRID = '/actions/combat/ironcow_group';

function createCandidate(zoneHrid, difficultyTier) {
  return {
    id: `zone:${zoneHrid}#${difficultyTier}`,
    targetType: 'zone',
    targetHrid: zoneHrid,
    difficultyTier,
  };
}

function createTieredCandidates() {
  return [
    createCandidate(ZONE_SOLO_HRID, 0),
    createCandidate(ZONE_SOLO_HRID, 2),
    createCandidate(ZONE_SOLO_HRID, 3),
    createCandidate(ZONE_GROUP_HRID, 0),
  ];
}

describe('advisorDropItems availability index', () => {
  it('computes minZoneTier from spawn offsets and per-drop difficulty gates', () => {
    const index = buildZoneDropAvailabilityIndex();

    const soloItems = index.get(ZONE_SOLO_HRID);
    expect(soloItems).toBeTruthy();
    // pearl 仅由 offset 0 的基础怪稀有掉落（minDifficultyTier 3）提供：区域难度档
    // 需 >= 3 才含此物品（T0 不含、T3 含）。
    expect(soloItems.get('/items/pearl')).toBe(3);
    // quartz：minDifficultyTier 1 - spawn 偏移 2 = -1，钳制为 0。
    expect(soloItems.get('/items/quartz')).toBe(0);
    // apple 同时由两个 spawn 提供（0 与 max(0, 4-2)=2），同物品取最小值。
    expect(soloItems.get('/items/apple')).toBe(0);

    const groupItems = index.get(ZONE_GROUP_HRID);
    expect(groupItems.get('/items/cherry')).toBe(0);
    expect(groupItems.get('/items/pearl')).toBe(0);
  });

  it('gates negative-base-rate drops behind their effective opening tier and drops never-dropping entries', () => {
    const index = buildZoneDropAvailabilityIndex();

    const soloItems = index.get(ZONE_SOLO_HRID);
    // 高级护符型：-0.007 + 0.002×怪物档 自 T4 起 > 0（引擎同款浮点判定）。
    expect(soloItems.get('/items/advanced_charm')).toBe(4);
    // 无 perTier 增益的负掉率普通表条目与负掉率稀有表条目永不可掉，不入索引。
    expect(soloItems.has('/items/dead_charm')).toBe(false);
    expect(soloItems.has('/items/rare_dead')).toBe(false);

    // 浮点边界（不在扫描范围、仅供索引断言的区域）：恰为 0 的档位不开门。
    const gatedItems = index.get('/actions/combat/ironcow_gated');
    expect(gatedItems.get('/items/floaty_charm')).toBe(5);
    expect(gatedItems.get('/items/epsilon_aura')).toBe(2);
  });

  it('memoizes the availability index per game data version', () => {
    expect(buildZoneDropAvailabilityIndex()).toBe(buildZoneDropAvailabilityIndex());
  });
});

describe('advisorDropItems candidate filtering', () => {
  it('returns the original candidates when no drop item is selected', () => {
    const candidates = createTieredCandidates();
    expect(filterAdvisorCandidatesByDropItems(candidates, [])).toBe(candidates);
    expect(filterAdvisorCandidatesByDropItems(candidates, ['', '   '])).toBe(candidates);
    expect(filterAdvisorCandidatesByDropItems(candidates, undefined)).toBe(candidates);
  });

  it('keeps only candidates whose difficulty tier unlocks at least one selected item', () => {
    const candidates = createTieredCandidates();

    // pearl 在 solo 区域 minZoneTier=3：T0/T2 不含、T3 含；group 区域 0 档即含。
    const pearlOnly = filterAdvisorCandidatesByDropItems(candidates, ['/items/pearl']);
    expect(pearlOnly).toEqual([candidates[2], candidates[3]]);

    // quartz 受 spawn 偏移抵扣后在 T0 即可掉落（难度感知的档位判断）。
    const quartzOnly = filterAdvisorCandidatesByDropItems(candidates, ['/items/quartz']);
    expect(quartzOnly).toEqual([candidates[0], candidates[1], candidates[2]]);
  });

  it('filters low-tier candidates that can never drop negative-rate items', () => {
    const candidates = [createCandidate(ZONE_SOLO_HRID, 3), createCandidate(ZONE_SOLO_HRID, 4)];

    // advanced_charm 的开门档位为 4：T3 注定为 0，被过滤；T4 保留。
    expect(filterAdvisorCandidatesByDropItems(candidates, ['/items/advanced_charm'])).toEqual([candidates[1]]);
    // 永不可掉的物品在任何档位都无候选。
    expect(filterAdvisorCandidatesByDropItems(candidates, ['/items/dead_charm'])).toEqual([]);
  });

  it('matches any selected item and drops candidates without availability', () => {
    const candidates = createTieredCandidates();

    expect(filterAdvisorCandidatesByDropItems(candidates, ['/items/ghost'])).toEqual([]);
    expect(
      filterAdvisorCandidatesByDropItems([createCandidate('/actions/combat/unknown_zone', 5)], ['/items/apple']),
    ).toEqual([]);

    const multi = filterAdvisorCandidatesByDropItems(candidates, ['/items/ghost', '/items/quartz']);
    expect(multi).toEqual([candidates[0], candidates[1], candidates[2]]);

    const cleaned = filterAdvisorCandidatesByDropItems(candidates, ['  /items/pearl  ']);
    expect(cleaned).toEqual([candidates[2], candidates[3]]);
  });
});

describe('advisorDropItems options', () => {
  it('collects and sorts droppable items for the selected scope', () => {
    expect(buildAdvisorDropItemOptions({ includeSoloZones: true, includeGroupZones: false })).toEqual([
      { itemHrid: '/items/advanced_charm' },
      { itemHrid: '/items/apple' },
      { itemHrid: '/items/pearl' },
      { itemHrid: '/items/quartz' },
    ]);
    expect(buildAdvisorDropItemOptions({ includeSoloZones: false, includeGroupZones: true })).toEqual([
      { itemHrid: '/items/cherry' },
      { itemHrid: '/items/pearl' },
    ]);
    expect(buildAdvisorDropItemOptions({ includeSoloZones: true, includeGroupZones: true })).toEqual([
      { itemHrid: '/items/advanced_charm' },
      { itemHrid: '/items/apple' },
      { itemHrid: '/items/cherry' },
      { itemHrid: '/items/pearl' },
      { itemHrid: '/items/quartz' },
    ]);
    expect(buildAdvisorDropItemOptions({ includeSoloZones: false, includeGroupZones: false })).toEqual([]);
    // 默认范围与 normalizeAdvisorFilters 一致：仅组队区域。
    expect(buildAdvisorDropItemOptions()).toEqual([{ itemHrid: '/items/cherry' }, { itemHrid: '/items/pearl' }]);
  });

  it('treats non-object filters the same as normalizeAdvisorFilters (empty object fallback)', () => {
    // 脏输入（null / 数组）与 normalizeAdvisorFilters 同口径回退空对象：
    // 仅组队区域默认开。锁死内联解析与 advisorDomain 清洗函数的等价性。
    expect(buildAdvisorDropItemOptions(null)).toEqual([{ itemHrid: '/items/cherry' }, { itemHrid: '/items/pearl' }]);
    expect(buildAdvisorDropItemOptions(['not-an-object'])).toEqual([
      { itemHrid: '/items/cherry' },
      { itemHrid: '/items/pearl' },
    ]);
  });
});

// 防回归：advisorDomain 单向依赖本模块；本模块若反向导入 advisorDomain 会重新
// 形成 ESM 循环依赖（此前靠「双方均为调用期使用」才运行时安全，任一侧顶层
// 调用对方导出即踩 TDZ）。用源码断言把叶子模块边界锁死。
const moduleSource = readFileSync(new URL('../advisorDropItems.js', import.meta.url), 'utf8');

describe('advisorDropItems module boundaries', () => {
  it('stays a leaf module and must not import advisorDomain (circular dependency guard)', () => {
    // 正则同时覆盖静态 from（含 from'…' 无空格写法）、副作用 import '…' 与
    // 动态 import(…) 三种导入形式，单/双引号、省略 .js 后缀与其他相对路径
    // 写法均命中；注释里提及 advisorDomain（无引号模块说明符）不会误报。
    expect(moduleSource).not.toMatch(/(?:from\s*|import\s*\(?\s*)['"][^'"]*advisorDomain(?:\.js)?['"]/);
  });
});

describe('advisorDropItems hrid list cleaning', () => {
  it('trims, drops empties and dedupes drop item hrids', () => {
    expect(normalizeDropItemHridList(['  /items/a  ', '', '   ', '/items/a', null, undefined, '/items/b'])).toEqual([
      '/items/a',
      '/items/b',
    ]);
    expect(normalizeDropItemHridList('not-an-array')).toEqual([]);
    expect(normalizeDropItemHridList()).toEqual([]);
  });

  it('caps the list at the configured maximum count', () => {
    const rawHrids = Array.from(
      { length: ADVISOR_DROP_ITEM_HRID_MAX_COUNT + 50 },
      (_, index) => `/items/item_${index}`,
    );
    const normalized = normalizeDropItemHridList(rawHrids);
    expect(normalized).toHaveLength(ADVISOR_DROP_ITEM_HRID_MAX_COUNT);
    expect(normalized[0]).toBe('/items/item_0');
    expect(normalized.at(-1)).toBe(`/items/item_${ADVISOR_DROP_ITEM_HRID_MAX_COUNT - 1}`);
  });
});
