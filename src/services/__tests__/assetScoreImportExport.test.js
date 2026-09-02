import { describe, expect, it } from 'vitest';
import { exportGroupConfig, exportSoloConfig, importGroupConfig, importSoloConfig } from '../importExportMapper.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  createMainSiteCurrentCharacterFixture,
  createMainSiteShareProfileFixture,
} from './fixtures/mainSiteShareProfileFixture.js';

const ASSET_SCORE_SNAPSHOT = {
  version: 1,
  total: 12.3,
  totalGold: 12_300_000,
  sections: { equipment: 12_000_000, house: 300_000, abilities: 0, shrine: 0 },
  items: {
    equipment: [
      { slotKey: 'weapon', itemHrid: '/items/foo', enhancementLevel: 0, value: 12_000_000, source: 'vendor' },
    ],
    houseRooms: [],
    abilities: [],
    shrine: [],
  },
  computedAt: 1_700_000_000_000,
};

describe('资产分随导出/导入携带', () => {
  it('exportSoloConfig 携带资产分快照', () => {
    const player = createEmptyPlayerConfig(1);
    player.name = 'Scored Hero';
    player.assetScore = ASSET_SCORE_SNAPSHOT;
    const exported = JSON.parse(exportSoloConfig(player, {}));
    expect(exported.player.assetScore).toEqual(ASSET_SCORE_SNAPSHOT);
  });

  it('exportGroupConfig 携带资产分快照', () => {
    const player = createEmptyPlayerConfig(2);
    player.assetScore = ASSET_SCORE_SNAPSHOT;
    const exported = JSON.parse(exportGroupConfig([player], {}));
    expect(exported.players[0].assetScore).toEqual(ASSET_SCORE_SNAPSHOT);
  });

  it('modern-solo 导入保留合法资产分，非法资产分被丢弃', () => {
    const basePlayer = createEmptyPlayerConfig(1);
    const good = importSoloConfig(
      JSON.stringify({
        version: 2,
        format: 'mwi-vue-solo',
        player: { ...basePlayer, assetScore: ASSET_SCORE_SNAPSHOT },
      }),
      basePlayer,
      {},
    );
    expect(good.player.assetScore).toEqual(ASSET_SCORE_SNAPSHOT);

    const bad = importSoloConfig(
      JSON.stringify({
        version: 2,
        format: 'mwi-vue-solo',
        player: { ...basePlayer, assetScore: { version: 99, total: 'oops' } },
      }),
      basePlayer,
      {},
    );
    expect(bad.player.assetScore).toBeNull();
  });

  it('主站当前角色载荷顶层的 marketItemValues 被提取到导入结果', () => {
    const basePlayer = createEmptyPlayerConfig(1);
    const payload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Market Hero' }),
      marketItemValues: { '/items/foo': { 0: 100, 1: 250 } },
    };
    const result = importSoloConfig(JSON.stringify(payload), basePlayer, {});
    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.marketItemValues).toEqual({ '/items/foo': { 0: 100, 1: 250 } });
    // 主站载荷不携带资产分快照 → 置 null，由 store refreshAssetScores 计算。
    expect(result.player.assetScore).toBeNull();
  });

  // marketEstimateSource 来源标记提取（N5 联动，app 侧消费链见
  // simulatorPricingActions.applyImportedMarketItemValues）。
  it('主站载荷的 marketEstimateSource 被提取：synthetic / official / 缺失返回 null', () => {
    const basePlayer = createEmptyPlayerConfig(1);
    const syntheticPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Synthetic Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'synthetic',
    };
    const synthetic = importSoloConfig(JSON.stringify(syntheticPayload), basePlayer, {});
    expect(synthetic.marketEstimateSource).toBe('synthetic');

    const officialPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Official Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'official',
    };
    const official = importSoloConfig(JSON.stringify(officialPayload), basePlayer, {});
    expect(official.marketEstimateSource).toBe('official');

    // 旧载荷 / 复制粘贴载荷无该字段 → null（app 侧落官方估算兼容分支）。
    const legacyPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Legacy Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
    };
    const legacy = importSoloConfig(JSON.stringify(legacyPayload), basePlayer, {});
    expect(legacy.marketEstimateSource).toBeNull();

    // 非法值不入白名单 → null。
    const garbagePayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Garbage Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'guess-what',
    };
    const garbage = importSoloConfig(JSON.stringify(garbagePayload), basePlayer, {});
    expect(garbage.marketEstimateSource).toBeNull();
  });

  // #18（2026-08-31）：混合载荷的逐件来源真值——syntheticItemHrids 清单提取
  //（白名单外返 null，旧载荷/复制粘贴载荷向后兼容）。
  it('主站载荷的 syntheticItemHrids 被提取：清单 / 缺失 / 非法形态返回 null', () => {
    const basePlayer = createEmptyPlayerConfig(1);

    const mixedPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Mixed Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 0: 200 } },
      marketEstimateSource: 'official',
      syntheticItemHrids: ['/items/bar'],
    };
    const mixed = importSoloConfig(JSON.stringify(mixedPayload), basePlayer, {});
    expect(mixed.marketEstimateSource).toBe('official');
    expect(mixed.syntheticItemHrids).toEqual(['/items/bar']);

    // 缺失 → null（向后兼容：无清单载荷按现状整体标官方估算）
    const legacy = importSoloConfig(
      JSON.stringify({
        ...createMainSiteCurrentCharacterFixture({ characterName: 'Legacy Hero' }),
        marketItemValues: { '/items/foo': { 0: 100 } },
        marketEstimateSource: 'official',
      }),
      basePlayer,
      {},
    );
    expect(legacy.syntheticItemHrids).toBeNull();

    // 非法形态（非数组）→ null
    const garbage = importSoloConfig(
      JSON.stringify({
        ...createMainSiteCurrentCharacterFixture({ characterName: 'Garbage Hero' }),
        marketItemValues: { '/items/foo': { 0: 100 } },
        marketEstimateSource: 'official',
        syntheticItemHrids: 'not-an-array',
      }),
      basePlayer,
      {},
    );
    expect(garbage.syntheticItemHrids).toBeNull();
  });

  // 【一般-5】（2026-09-02）：混合载荷的等级级来源真值——syntheticLevelKeys 清单提取
  //（缺失/非法形态返回 null 维持物品级标注，向后兼容；清单存在但合法条目为空返回 {}）。
  it('主站载荷的 syntheticLevelKeys 被提取：清单 / 缺失 / 非法形态返回 null', () => {
    const basePlayer = createEmptyPlayerConfig(1);

    const mixedPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Level Mixed Hero' }),
      marketItemValues: { '/items/foo': { 0: 100, 1: 200 } },
      marketEstimateSource: 'official',
      syntheticLevelKeys: { '/items/foo': ['1'] },
    };
    const mixed = importSoloConfig(JSON.stringify(mixedPayload), basePlayer, {});
    expect(mixed.syntheticLevelKeys).toEqual({ '/items/foo': ['1'] });

    // 缺失 → null（旧载荷向后兼容：维持物品级标注）
    const legacy = importSoloConfig(
      JSON.stringify({
        ...createMainSiteCurrentCharacterFixture({ characterName: 'Level Legacy Hero' }),
        marketItemValues: { '/items/foo': { 0: 100 } },
        marketEstimateSource: 'official',
      }),
      basePlayer,
      {},
    );
    expect(legacy.syntheticLevelKeys).toBeNull();

    // 非法形态（非对象）→ null
    const garbage = importSoloConfig(
      JSON.stringify({
        ...createMainSiteCurrentCharacterFixture({ characterName: 'Level Garbage Hero' }),
        marketItemValues: { '/items/foo': { 0: 100 } },
        marketEstimateSource: 'official',
        syntheticLevelKeys: 'not-an-object',
      }),
      basePlayer,
      {},
    );
    expect(garbage.syntheticLevelKeys).toBeNull();

    // 非法条目（值非数组 / 空 hrid）被丢弃、合法条目保留
    const partial = importSoloConfig(
      JSON.stringify({
        ...createMainSiteCurrentCharacterFixture({ characterName: 'Level Partial Hero' }),
        marketItemValues: { '/items/foo': { 0: 100 } },
        marketEstimateSource: 'official',
        syntheticLevelKeys: { '/items/foo': ['0'], '/items/bad': 'oops', '': ['1'] },
      }),
      basePlayer,
      {},
    );
    expect(partial.syntheticLevelKeys).toEqual({ '/items/foo': ['0'] });
  });

  it('无 marketItemValues 的导入结果返回 null', () => {
    const basePlayer = createEmptyPlayerConfig(1);
    const result = importSoloConfig(
      JSON.stringify({ version: 2, format: 'mwi-vue-solo', player: basePlayer }),
      basePlayer,
      {},
    );
    expect(result.marketItemValues).toBeNull();
  });

  it('modern-group 导入返回 null marketItemValues 且玩家资产分保留', () => {
    const player = createEmptyPlayerConfig(1);
    player.assetScore = ASSET_SCORE_SNAPSHOT;
    const text = exportGroupConfig([player], {});
    const result = importGroupConfig(text, [createEmptyPlayerConfig(1)], {});
    expect(result.detectedFormat).toBe('modern-group');
    expect(result.marketItemValues).toBeNull();
    expect(result.players[0].assetScore).toEqual(ASSET_SCORE_SNAPSHOT);
  });

  it('带配置签名的快照导出/导入后签名透传保留（守卫据此判断保留或重算）', () => {
    const player = createEmptyPlayerConfig(1);
    player.assetScore = { ...ASSET_SCORE_SNAPSHOT, configSignature: 'v1:["sig"]' };
    const exported = JSON.parse(exportSoloConfig(player, {}));
    expect(exported.player.assetScore.configSignature).toBe('v1:["sig"]');

    const imported = importSoloConfig(
      JSON.stringify({ version: 2, format: 'mwi-vue-solo', player: exported.player }),
      createEmptyPlayerConfig(1),
      {},
    );
    expect(imported.player.assetScore.configSignature).toBe('v1:["sig"]');
  });

  // B4（2026-09-01）：六个导入分支的市场字段透传接线此前仅 main-site-current-character
  // 有正例——24 个复制式接线点（6 分支 × marketItemValues/marketEstimateSource/
  // syntheticItemHrids/syntheticLevelKeys）任一漏接/接错在该分支不可见；原生格式的载荷
  // 同样能手工注入市场数据并被提取应用（第 25 轮格式门控明确支持该形态）。
  it('六个导入分支均提取载荷顶层的 marketItemValues/marketEstimateSource/syntheticItemHrids/syntheticLevelKeys', () => {
    const marketFields = {
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'synthetic',
      syntheticItemHrids: ['/items/foo'],
      syntheticLevelKeys: { '/items/foo': ['0'] },
    };
    const basePlayer = createEmptyPlayerConfig(1);
    const soloBranches = [
      {
        detectedFormat: 'modern-solo',
        text: JSON.stringify({ version: 2, format: 'mwi-vue-solo', player: basePlayer, ...marketFields }),
      },
      {
        detectedFormat: 'modern-player-only',
        text: JSON.stringify({ levels: basePlayer.levels, equipment: basePlayer.equipment, ...marketFields }),
      },
      {
        detectedFormat: 'legacy-solo',
        text: JSON.stringify({ player: { name: 'Legacy Market Hero' }, ...marketFields }),
      },
      {
        detectedFormat: 'main-site-share-profile',
        text: JSON.stringify({
          ...createMainSiteShareProfileFixture({ characterName: 'Shared Market Hero' }),
          ...marketFields,
        }),
      },
      {
        detectedFormat: 'main-site-current-character',
        text: JSON.stringify({
          ...createMainSiteCurrentCharacterFixture({ characterName: 'Current Market Hero' }),
          ...marketFields,
        }),
      },
    ];

    for (const branch of soloBranches) {
      const result = importSoloConfig(branch.text, basePlayer, {});
      expect(result.detectedFormat).toBe(branch.detectedFormat);
      expect(result.marketItemValues).toEqual(marketFields.marketItemValues);
      expect(result.marketEstimateSource).toBe('synthetic');
      expect(result.syntheticItemHrids).toEqual(marketFields.syntheticItemHrids);
      expect(result.syntheticLevelKeys).toEqual(marketFields.syntheticLevelKeys);
    }

    const groupResult = importGroupConfig(
      JSON.stringify({ version: 2, players: [basePlayer], ...marketFields }),
      [createEmptyPlayerConfig(1)],
      {},
    );
    expect(groupResult.detectedFormat).toBe('modern-group');
    expect(groupResult.marketItemValues).toEqual(marketFields.marketItemValues);
    expect(groupResult.marketEstimateSource).toBe('synthetic');
    expect(groupResult.syntheticItemHrids).toEqual(marketFields.syntheticItemHrids);
    expect(groupResult.syntheticLevelKeys).toEqual(marketFields.syntheticLevelKeys);
  });
});
