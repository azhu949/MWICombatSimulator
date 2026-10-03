import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// ③ 动态化（2026-10-03）回归：快照保存/恢复的按需模块加载失败必须与业务失败分开归因。
// store 内的 loadImportExportMapperModule 是模块级常量，无法由调用方注入失败 loader，因此在
// 导入 store 之前替换 createCachedModuleLoader：按 importModule 源码文本识别目标模块，仅让
// importExportMapper 的动态加载拒绝，其余 loader 原样透传（快照路径只使用该 loader）。
vi.mock('../../services/cachedModuleLoader.js', () => ({
  createCachedModuleLoader: (importModule) => {
    if (String(importModule).includes('importExportMapper')) {
      return () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
    }
    return importModule;
  },
}));

import { useSimulatorStore } from '../simulatorStore.js';

const PLAYER_DATA_SNAPSHOT_STORAGE_KEY = 'mwi.player.data.snapshot.v1';

function createLocalStorageMock() {
  const storage = new Map();
  return {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

describe('player data snapshot module-load failure attribution', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('save attributes a rejecting module load to playerSaveModuleError and warns', async () => {
    const simulator = useSimulatorStore();
    // 预填可序列化内容，避免「无 meaningful 数据」这一业务失败先于模块加载失败分支发生。
    simulator.players[0].levels.stamina = 99;
    simulator.players[0].skillExperience.stamina = 123456;
    global.localStorage.setItem.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await simulator.savePlayerDataSnapshot();

    expect(result.ok).toBe(false);
    expect(result.messageKey).toBe('common:settingsPage.playerSaveModuleError');
    expect(result.messageKey).not.toBe('common:settingsPage.playerSaveError');
    expect(warn).toHaveBeenCalledWith('[playerSnapshot] save module load failed:', expect.any(Error));
    // 模块加载失败发生在序列化/落盘之前：不得写入存储。
    expect(global.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('load attributes a rejecting module load to playerLoadModuleError, rebuilds snapshot state and warns', async () => {
    const simulator = useSimulatorStore();
    // 预置一份状态可用的快照，确保 load 不落入 not_found / invalid 等前置分支，走到模块加载阶段。
    global.localStorage.setItem(
      PLAYER_DATA_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: 123,
        playerDataMap: {
          1: JSON.stringify({ version: 2, player: { levels: { stamina: 2 } } }),
        },
      }),
    );
    // 置入与存储不一致的会话内状态：模块加载失败分支应重建为存储中的快照状态（savedAt 123）。
    simulator.playerDataSnapshot = { savedAt: 999, playerDataMap: {} };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await simulator.loadPlayerDataSnapshot();

    expect(result.ok).toBe(false);
    expect(result.messageKey).toBe('common:settingsPage.playerLoadModuleError');
    expect(result.messageKey).not.toBe('common:settingsPage.playerLoadInvalid');
    expect(simulator.playerDataSnapshot.savedAt).toBe(123);
    expect(simulator.playerDataSnapshot.savedAt).not.toBe(999);
    expect(Object.keys(simulator.playerDataSnapshot.playerDataMap)).toEqual(['1']);
    expect(warn).toHaveBeenCalledWith('[playerSnapshot] load module load failed:', expect.any(Error));
  });
});
