import { afterEach, describe, expect, it, vi } from 'vitest';
import patchNoteCatalog from '../../../patchNote.json';
import {
  PATCH_NOTES_STORAGE_KEY,
  PATCH_NOTES_STORAGE_VERSION,
  PATCH_NOTE_SECTION_KEYS,
  getUnreadPatchNoteEntries,
  initializePatchNotesState,
  markPatchNoteEntriesAsRead,
  readPatchNotesState,
  resolvePatchNoteEntries,
} from '../patchNotes.js';

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

function flattenSections(sections) {
  return PATCH_NOTE_SECTION_KEYS.flatMap((key) => (sections?.[key] || []).map(String)).filter(Boolean);
}

function catalogSectionList(catalogValue, language) {
  const list = [];
  for (const key of PATCH_NOTE_SECTION_KEYS) {
    for (const note of catalogValue?.[key]?.[language] || []) {
      list.push(String(note));
    }
  }
  return list;
}

function catalogSections(catalogValue, language) {
  const sections = {};
  for (const key of PATCH_NOTE_SECTION_KEYS) {
    const list = (catalogValue?.[key]?.[language] || []).map(String);
    if (list.length > 0) {
      sections[key] = list;
    }
  }
  return sections;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('patchNotes', () => {
  it('publishes the newest bilingual entry first and preserves the release chain order', () => {
    const zhEntries = resolvePatchNoteEntries(undefined, 'zh');
    const enEntries = resolvePatchNoteEntries(undefined, 'en');
    // Source order of patchNote.json is the release chain (newest first).
    // Deriving the expectation from the catalog keeps this test green on
    // every release without editing hardcoded versions.
    const releaseEntryIds = Object.keys(patchNoteCatalog);
    expect(releaseEntryIds.length).toBeGreaterThan(0);

    // The newest entry matches the catalog's first entry exactly.
    const latestId = releaseEntryIds[0];
    const latestRaw = patchNoteCatalog[latestId];
    expect(zhEntries[0]).toMatchObject({
      entryId: latestId,
      label: latestRaw.label.zh,
    });
    expect(zhEntries[0].sections).toEqual(catalogSections(latestRaw, 'zh'));
    expect(enEntries[0]).toMatchObject({
      entryId: latestId,
      label: latestRaw.label.en,
    });
    expect(enEntries[0].sections).toEqual(catalogSections(latestRaw, 'en'));

    // Every catalog release appears exactly once, in source order.
    expect(zhEntries.slice(0, releaseEntryIds.length).map((entry) => entry.entryId)).toEqual(releaseEntryIds);
    expect(enEntries.slice(0, releaseEntryIds.length).map((entry) => entry.entryId)).toEqual(releaseEntryIds);

    // Spot-check historical entries by catalog position so content
    // assertions keep working regardless of how many releases precede
    // them. The flattened section lists must match the original flat
    // note lists exactly (content and order are preserved by the data).
    const expectEntryAt = (entryId, zhLabel, enLabel, zhNotes, enNotes) => {
      const index = releaseEntryIds.indexOf(entryId);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(zhEntries[index]).toMatchObject({ entryId, label: zhLabel });
      expect(flattenSections(zhEntries[index].sections)).toEqual(zhNotes.map(String));
      expect(enEntries[index]).toMatchObject({ entryId, label: enLabel });
      expect(flattenSections(enEntries[index].sections)).toEqual(enNotes.map(String));
    };

    expectEntryAt(
      '2026年8月18日（v2.0.9）',
      '2026年8月18日（v2.0.9）',
      'August 18, 2026 (v2.0.9)',
      catalogSectionList(patchNoteCatalog['2026年8月18日（v2.0.9）'], 'zh'),
      catalogSectionList(patchNoteCatalog['2026年8月18日（v2.0.9）'], 'en'),
    );

    expectEntryAt(
      '2026年8月16日（v2.0.8）',
      '2026年8月16日（v2.0.8）',
      'August 16, 2026 (v2.0.8)',
      catalogSectionList(patchNoteCatalog['2026年8月16日（v2.0.8）'], 'zh'),
      catalogSectionList(patchNoteCatalog['2026年8月16日（v2.0.8）'], 'en'),
    );

    const v207Index = releaseEntryIds.indexOf('2026年8月15日（v2.0.7）');
    expect(v207Index).toBeGreaterThanOrEqual(0);
    expect(zhEntries[v207Index]).toMatchObject({
      entryId: '2026年8月15日（v2.0.7）',
      label: '2026年8月15日（v2.0.7）',
    });
    expect(flattenSections(zhEntries[v207Index].sections)).toHaveLength(4);
    expect(flattenSections(zhEntries[v207Index].sections)).toContain(
      '同步游戏 8/14 市场与公会试炼更新，市场税率提高至 5%，所有市场卖出估值已扣除 5% 税。',
    );
    expect(flattenSections(zhEntries[v207Index].sections)).toContain(
      '牛铃袋 (10个) 市场卖出按官方特殊税率 18% 扣税，其余物品仍按 5%。',
    );
    expect(flattenSections(zhEntries[v207Index].sections)).toContain(
      '税后价格四舍五入取整为整数金币（官方取整规则暂未核实，集中一处可切换）。',
    );
    expect(flattenSections(zhEntries[v207Index].sections)).toContain(
      '同步神龛增益（稀有发现 1.5%/级、精华发现 3%/级）与公会试炼怪物数据。',
    );
    expect(enEntries[v207Index]).toMatchObject({
      entryId: '2026年8月15日（v2.0.7）',
      label: 'August 15, 2026 (v2.0.7)',
    });
    expect(flattenSections(enEntries[v207Index].sections)).toHaveLength(4);
    expect(flattenSections(enEntries[v207Index].sections)).toContain(
      'Synced the Aug 14 game update: market tax raised to 5%, and all market-sale valuations now deduct the tax.',
    );

    const v206Index = releaseEntryIds.indexOf('2026年8月12日（v2.0.6）');
    expect(v206Index).toBeGreaterThanOrEqual(0);
    expect(zhEntries[v206Index]).toMatchObject({
      entryId: '2026年8月12日（v2.0.6）',
      label: '2026年8月12日（v2.0.6）',
    });
    expect(flattenSections(zhEntries[v206Index].sections)).toContain('买入价支持整数输入与 k/m/b 单位按钮。');
    expect(zhEntries[v206Index].sections.newFeatures).toContain('目标装备无市场价格时，支持手动输入买入价后加入队列。');

    const v205Index = releaseEntryIds.indexOf('2026年8月10日（v2.0.5）');
    expect(v205Index).toBeGreaterThanOrEqual(0);
    expect(zhEntries[v205Index]).toMatchObject({
      entryId: '2026年8月10日（v2.0.5）',
      label: '2026年8月10日（v2.0.5）',
    });
    expect(flattenSections(zhEntries[v205Index].sections)).toContain(
      '更新日志从弹窗迁移为独立页面，进入页面后自动标记当前未读版本。',
    );

    const v204Index = releaseEntryIds.indexOf('2026年8月10日（v2.0.4）');
    expect(v204Index).toBeGreaterThanOrEqual(0);
    expect(zhEntries[v204Index]).toMatchObject({
      entryId: '2026年8月10日（v2.0.4）',
      label: '2026年8月10日（v2.0.4）',
    });
    expect(flattenSections(zhEntries[v204Index].sections)).toContain(
      '官方精确 Ask 和小时均价均缺失时，可确认使用历史归档最新有效 Ask。',
    );

    const v200Index = releaseEntryIds.indexOf('2026年8月8日（v2.0.0）');
    expect(v200Index).toBeGreaterThanOrEqual(0);
    expect(zhEntries[v200Index]).toMatchObject({
      entryId: '2026年8月8日（v2.0.0）',
      label: '2026年8月8日（v2.0.0）',
    });
    expect(zhEntries[v200Index].sections.newFeatures).toHaveLength(2);
    expect(enEntries[v200Index]).toMatchObject({
      entryId: '2026年8月8日（v2.0.0）',
      label: 'August 8, 2026 (v2.0.0)',
    });
    expect(enEntries[v200Index].sections.newFeatures).toHaveLength(2);
  });

  it('resolves new-format, legacy fallback, and empty entries in source order', () => {
    const patchNotes = {
      '2026年3月26日（v1.0.8）': {
        label: {
          zh: ' 2026年3月26日（v1.0.8） ',
          en: ' March 26, 2026 (v1.0.8) ',
        },
        newFeatures: {
          zh: ['  新增说明  ', '', '   '],
          en: [' First feature '],
        },
        improvements: {
          zh: ['体验优化说明'],
          en: ['First improvement'],
        },
        bugFixes: {
          zh: ['缺陷修复说明'],
          en: ['First fix'],
        },
      },
      '2026年3月25日（v1.0.7）': [' 旧版纯数组说明 '],
      '2026年3月24日（v1.0.6）': {
        label: {
          zh: ' 2026年3月24日（v1.0.6） ',
        },
        improvements: {
          zh: [' 第四条 '],
        },
      },
      '2026年3月23日': {},
    };

    expect(resolvePatchNoteEntries(patchNotes, 'zh')).toEqual([
      {
        entryId: '2026年3月26日（v1.0.8）',
        label: '2026年3月26日（v1.0.8）',
        sections: {
          newFeatures: ['新增说明'],
          improvements: ['体验优化说明'],
          bugFixes: ['缺陷修复说明'],
        },
      },
      {
        entryId: '2026年3月25日（v1.0.7）',
        label: '2026年3月25日（v1.0.7）',
        sections: {
          improvements: ['旧版纯数组说明'],
        },
      },
      {
        entryId: '2026年3月24日（v1.0.6）',
        label: '2026年3月24日（v1.0.6）',
        sections: {
          improvements: ['第四条'],
        },
      },
      {
        entryId: '2026年3月23日',
        label: '2026年3月23日',
        sections: {},
      },
    ]);
  });

  it('uses english content when available and falls back to zh labels and notes otherwise', () => {
    const patchNotes = {
      '2026年3月26日（v1.0.8）': {
        label: {
          zh: '2026年3月26日（v1.0.8）',
          en: 'March 26, 2026 (v1.0.8)',
        },
        newFeatures: {
          zh: ['新增说明'],
          en: ['First feature'],
        },
        improvements: {
          zh: ['体验优化说明'],
          en: ['First improvement'],
        },
      },
      '2026年3月25日（v1.0.7）': {
        label: {
          zh: '2026年3月25日（v1.0.7）',
        },
        improvements: {
          zh: ['第三条'],
        },
      },
    };

    expect(resolvePatchNoteEntries(patchNotes, 'en')).toEqual([
      {
        entryId: '2026年3月26日（v1.0.8）',
        label: 'March 26, 2026 (v1.0.8)',
        sections: {
          newFeatures: ['First feature'],
          improvements: ['First improvement'],
        },
      },
      {
        entryId: '2026年3月25日（v1.0.7）',
        label: '2026年3月25日（v1.0.7）',
        sections: {
          improvements: ['第三条'],
        },
      },
    ]);
  });

  it('merges legacy notes into improvements when section keys and notes coexist', () => {
    const patchNotes = {
      '2026年3月26日（v1.0.8）': {
        label: '2026年3月26日（v1.0.8）',
        newFeatures: {
          zh: ['新增说明'],
        },
        improvements: {
          zh: ['体验优化说明'],
        },
        notes: {
          zh: ['旧版补充说明'],
        },
      },
      '2026年3月25日（v1.0.7）': {
        label: '2026年3月25日（v1.0.7）',
        notes: ['纯 notes 兜底说明'],
      },
    };

    expect(resolvePatchNoteEntries(patchNotes, 'zh')).toEqual([
      {
        entryId: '2026年3月26日（v1.0.8）',
        label: '2026年3月26日（v1.0.8）',
        sections: {
          newFeatures: ['新增说明'],
          improvements: ['体验优化说明', '旧版补充说明'],
        },
      },
      {
        entryId: '2026年3月25日（v1.0.7）',
        label: '2026年3月25日（v1.0.7）',
        sections: {
          improvements: ['纯 notes 兜底说明'],
        },
      },
    ]);
  });

  it('resolves the real catalog for zh and en with non-empty sections and zh/en parity', () => {
    const zhEntries = resolvePatchNoteEntries(undefined, 'zh');
    const enEntries = resolvePatchNoteEntries(undefined, 'en');

    expect(zhEntries).toHaveLength(Object.keys(patchNoteCatalog).length);
    expect(enEntries).toHaveLength(Object.keys(patchNoteCatalog).length);

    for (let i = 0; i < zhEntries.length; i += 1) {
      const zhSections = zhEntries[i].sections;
      const enSections = enEntries[i].sections;

      // 每个版本至少有一个非空分类
      expect(Object.keys(zhSections).length).toBeGreaterThan(0);

      // 现代条目（英文存在）必须与中文分类结构一致且内容完整
      const snapshotEn = catalogSectionList(patchNoteCatalog[zhEntries[i].entryId], 'en');
      if (snapshotEn.length > 0) {
        expect(new Set(Object.keys(enSections))).toEqual(new Set(Object.keys(zhSections)));
        expect(flattenSections(enSections)).toEqual(snapshotEn);
      } else {
        // 旧版仅有中文：英文视图回退显示中文内容（与历史行为一致）
        expect(flattenSections(enSections)).toEqual(catalogSectionList(patchNoteCatalog[zhEntries[i].entryId], 'zh'));
      }
    }
  });

  it('keeps previously stored read ids stable against the new sections shape', () => {
    const storage = createLocalStorageMock();
    storage.setItem(
      PATCH_NOTES_STORAGE_KEY,
      JSON.stringify({
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: ['2026年3月25日（v1.0.7）', '2026年3月24日'],
        initializedAt: 100,
        updatedAt: 100,
      }),
    );

    const entries = resolvePatchNoteEntries({
      '2026年3月26日（v1.0.8）': {
        newFeatures: { zh: ['最新'] },
      },
      '2026年3月25日（v1.0.7）': {
        improvements: { zh: ['第一条'] },
      },
      '2026年3月24日': {
        improvements: { zh: ['第二条'] },
      },
    });

    expect(
      getUnreadPatchNoteEntries({
        entries,
        storage,
      }),
    ).toEqual([
      {
        entryId: '2026年3月26日（v1.0.8）',
        label: '2026年3月26日（v1.0.8）',
        sections: {
          newFeatures: ['最新'],
        },
      },
    ]);
  });

  it('returns unread entries carrying their sections for preview rendering', () => {
    const storage = createLocalStorageMock();
    const entries = resolvePatchNoteEntries({
      '2026年3月26日（v1.0.8）': {
        label: { zh: '2026年3月26日（v1.0.8）' },
        newFeatures: { zh: ['新功能一'] },
        improvements: { zh: ['优化一'] },
      },
      '2026年3月25日（v1.0.7）': {
        improvements: { zh: ['已读'] },
      },
    });

    storage.setItem(
      PATCH_NOTES_STORAGE_KEY,
      JSON.stringify({
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: ['2026年3月25日（v1.0.7）'],
        initializedAt: 100,
        updatedAt: 100,
      }),
    );

    const unread = getUnreadPatchNoteEntries({ entries, storage });
    expect(unread).toHaveLength(1);
    expect(unread[0].entryId).toBe('2026年3月26日（v1.0.8）');
    expect(unread[0].sections).toEqual({
      newFeatures: ['新功能一'],
      improvements: ['优化一'],
    });
  });

  it('resolves raw bilingual sections instead of dropping them when entries arrive as an array', () => {
    const storage = createLocalStorageMock();
    storage.setItem(
      PATCH_NOTES_STORAGE_KEY,
      JSON.stringify({
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: [],
        initializedAt: 100,
        updatedAt: 100,
      }),
    );

    // 数组入参路径：sections 以「原始 catalog 形态」（按语言分组）传入，
    // 应被本地化解析，而非被 normalizePatchNoteList 判为非数组静默丢弃。
    const entries = [
      {
        entryId: '2026年3月26日（v1.0.8）',
        label: '2026年3月26日（v1.0.8）',
        sections: {
          newFeatures: { zh: ['新增说明'], en: ['First feature'] },
        },
      },
    ];

    const unread = getUnreadPatchNoteEntries({ entries, storage });
    expect(unread).toHaveLength(1);
    expect(unread[0].sections).toEqual({ newFeatures: ['新增说明'] });
  });

  it('initializes storage with all current entries marked as read on first launch', () => {
    const storage = createLocalStorageMock();
    vi.spyOn(Date, 'now').mockReturnValue(111);
    const entries = resolvePatchNoteEntries({
      '2026年3月25日（v1.0.7）': {
        newFeatures: { zh: ['第一条'] },
      },
      '2026年3月24日': {
        improvements: { zh: ['第二条'] },
      },
    });

    const state = initializePatchNotesState({
      entries,
      storage,
    });

    expect(state).toEqual({
      version: PATCH_NOTES_STORAGE_VERSION,
      readEntryIds: ['2026年3月25日（v1.0.7）', '2026年3月24日'],
      initializedAt: 111,
      updatedAt: 111,
    });
    expect(JSON.parse(storage.getItem(PATCH_NOTES_STORAGE_KEY))).toEqual(state);
    expect(
      getUnreadPatchNoteEntries({
        entries,
        storage,
      }),
    ).toEqual([]);
  });

  it('keeps read-state matching stable when the patch note language changes', () => {
    const storage = createLocalStorageMock();
    vi.spyOn(Date, 'now').mockReturnValue(333);
    const patchNotes = {
      '2026年3月26日（v1.0.8）': {
        label: {
          zh: '2026年3月26日（v1.0.8）',
          en: 'March 26, 2026 (v1.0.8)',
        },
        newFeatures: {
          zh: ['第一条'],
          en: ['First note'],
        },
      },
      '2026年3月25日（v1.0.7）': {
        label: {
          zh: '2026年3月25日（v1.0.7）',
          en: 'March 25, 2026 (v1.0.7)',
        },
        improvements: {
          zh: ['第二条'],
          en: ['Second note'],
        },
      },
    };
    const zhEntries = resolvePatchNoteEntries(patchNotes, 'zh');
    const enEntries = resolvePatchNoteEntries(patchNotes, 'en');

    expect(zhEntries.map((entry) => entry.entryId)).toEqual(['2026年3月26日（v1.0.8）', '2026年3月25日（v1.0.7）']);
    expect(enEntries.map((entry) => entry.entryId)).toEqual(['2026年3月26日（v1.0.8）', '2026年3月25日（v1.0.7）']);

    initializePatchNotesState({
      entries: zhEntries,
      storage,
    });

    expect(
      getUnreadPatchNoteEntries({
        entries: enEntries,
        storage,
      }),
    ).toEqual([]);
  });

  it('marks unread entries as read without dropping older read ids', () => {
    const storage = createLocalStorageMock();
    vi.spyOn(Date, 'now').mockReturnValue(456789);

    storage.setItem(
      PATCH_NOTES_STORAGE_KEY,
      JSON.stringify({
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: ['2026年3月25日（v1.0.7）'],
        initializedAt: 111,
        updatedAt: 222,
      }),
    );

    const ok = markPatchNoteEntriesAsRead({
      entryIds: ['2026年3月26日（v1.0.8）', '', '2026年3月26日（v1.0.8）'],
      storage,
    });

    expect(ok).toBe(true);
    expect(JSON.parse(storage.getItem(PATCH_NOTES_STORAGE_KEY))).toEqual({
      version: PATCH_NOTES_STORAGE_VERSION,
      readEntryIds: ['2026年3月25日（v1.0.7）', '2026年3月26日（v1.0.8）'],
      initializedAt: 111,
      updatedAt: 456789,
    });
  });

  it('re-initializes invalid storage payloads into a recoverable baseline state', () => {
    const storage = createLocalStorageMock();
    vi.spyOn(Date, 'now').mockReturnValue(999);
    const entries = resolvePatchNoteEntries({
      '2026年3月25日（v1.0.7）': {
        improvements: { zh: ['第一条'] },
      },
    });

    storage.setItem(PATCH_NOTES_STORAGE_KEY, '{not-json');

    const state = initializePatchNotesState({
      entries,
      storage,
    });

    expect(readPatchNotesState(storage)).toEqual(state);
    expect(state).toEqual({
      version: PATCH_NOTES_STORAGE_VERSION,
      readEntryIds: ['2026年3月25日（v1.0.7）'],
      initializedAt: 999,
      updatedAt: 999,
    });
    expect(
      getUnreadPatchNoteEntries({
        entries,
        storage,
      }),
    ).toEqual([]);
  });
});
