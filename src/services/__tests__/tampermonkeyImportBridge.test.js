import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  createMainSiteCurrentCharacterFixture,
  createMainSiteShareProfileFixture,
} from './fixtures/mainSiteShareProfileFixture.js';
import {
  applyTampermonkeyEnhancementImportMessage,
  applyTampermonkeyImportMessage,
  applyTampermonkeySkillingImportMessage,
} from '../tampermonkeyImportBridge.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { ENHANCEMENT_STORAGE_KEY, useEnhancementStore } from '../../stores/enhancementStore.js';

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

function createImportMessage(overrides = {}) {
  const characterName = overrides.characterName ?? 'Imported Hero';
  return {
    requestId: String(overrides.requestId ?? `request-${characterName}`),
    targetPlayerId: String(overrides.targetPlayerId ?? '1'),
    payload: createMainSiteShareProfileFixture({ characterName }),
    ...overrides,
  };
}

describe('tampermonkeyImportBridge', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  it('keeps the original active player during multi-slot team imports', async () => {
    const simulator = useSimulatorStore();
    simulator.setActivePlayer('4');

    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'team-1',
        targetPlayerId: '1',
        characterName: 'Team Alpha',
        resetTeamSelection: true,
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );
    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'team-2',
        targetPlayerId: '2',
        characterName: 'Team Beta',
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );
    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'team-3',
        targetPlayerId: '3',
        characterName: 'Team Gamma',
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );

    expect(simulator.activePlayerId).toBe('4');
    expect(simulator.players[0].name).toBe('Team Alpha');
    expect(simulator.players[1].name).toBe('Team Beta');
    expect(simulator.players[2].name).toBe('Team Gamma');
    expect(simulator.players[0].selected).toBe(true);
    expect(simulator.players[1].selected).toBe(true);
    expect(simulator.players[2].selected).toBe(true);
    expect(simulator.players[3].selected).toBe(false);
  });

  it('keeps the original active player even when that slot is part of the imported team', async () => {
    const simulator = useSimulatorStore();
    simulator.setActivePlayer('2');

    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'team-same-1',
        targetPlayerId: '1',
        characterName: 'Team One',
        resetTeamSelection: true,
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );
    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'team-same-2',
        targetPlayerId: '2',
        characterName: 'Team Two',
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );
    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'team-same-3',
        targetPlayerId: '3',
        characterName: 'Team Three',
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );

    expect(simulator.activePlayerId).toBe('2');
    expect(simulator.players[1].name).toBe('Team Two');
    expect(simulator.players[1].selected).toBe(true);
  });

  it('keeps backward-compatible activation when only selectAfterImport is provided', async () => {
    const simulator = useSimulatorStore();
    simulator.setActivePlayer('4');

    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'legacy-single',
        targetPlayerId: '2',
        characterName: 'Solo Import',
        selectAfterImport: true,
      }),
    );

    expect(simulator.activePlayerId).toBe('2');
    expect(simulator.players[1].name).toBe('Solo Import');
    expect(simulator.players[1].selected).toBe(true);
  });

  it('resets team selection before marking imported slots as selected', async () => {
    const simulator = useSimulatorStore();
    simulator.players.forEach((player) => {
      player.selected = true;
    });

    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'selection-reset',
        targetPlayerId: '2',
        characterName: 'Selection Reset',
        resetTeamSelection: true,
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );

    expect(simulator.players[0].selected).toBe(false);
    expect(simulator.players[1].selected).toBe(true);
    expect(simulator.players[2].selected).toBe(false);
    expect(simulator.players[3].selected).toBe(false);
    expect(simulator.players[4].selected).toBe(false);
  });

  it('clears requested non-target slots without affecting the imported target slot', async () => {
    const simulator = useSimulatorStore();

    await simulator.importSoloConfig(
      JSON.stringify(createMainSiteShareProfileFixture({ characterName: 'Existing Two' })),
      '2',
    );
    await simulator.importSoloConfig(
      JSON.stringify(createMainSiteShareProfileFixture({ characterName: 'Existing Three' })),
      '3',
    );

    await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({
        requestId: 'clear-others',
        targetPlayerId: '1',
        characterName: 'Fresh One',
        clearPlayerIds: ['1', '2', '3'],
        selectAfterImport: true,
        activateAfterImport: false,
      }),
    );

    expect(simulator.players[0].name).toBe('Fresh One');
    expect(simulator.queue.importedProfileByPlayer['1']).toBe(true);
    expect(simulator.players[1].name).toBe('Player 2');
    expect(simulator.players[2].name).toBe('Player 3');
    expect(simulator.queue.importedProfileByPlayer['2']).toBe(false);
    expect(simulator.queue.importedProfileByPlayer['3']).toBe(false);
  });

  it('routes a current-character snapshot to the skilling store', () => {
    const importProfile = vi.fn();
    const payload = {
      character: { name: 'Skiller' },
      characterSkills: [{ skillHrid: '/skills/cooking', level: 31, experience: 12345 }],
      characterItems: [{ itemHrid: '/items/coin', itemLocationHrid: '/item_locations/inventory', count: 10 }],
    };

    const result = applyTampermonkeySkillingImportMessage({ importProfile }, { payload });

    expect(importProfile).toHaveBeenCalledOnce();
    expect(importProfile.mock.calls[0][0].characterName).toBe('Skiller');
    expect(result.detectedFormat).toBe('main-site-skilling-character');
  });

  it('keeps enhancement character imports in the current page session', async () => {
    const enhancement = useEnhancementStore();
    enhancement.config.targetLevel = 7;
    await nextTick();
    global.localStorage.setItem.mockClear();

    const result = applyTampermonkeyEnhancementImportMessage(enhancement, {
      payload: {
        character: { name: 'Enhancer' },
        characterSkills: [{ skillHrid: '/skills/enhancing', level: 177 }],
      },
    });
    await nextTick();

    expect(result.detectedFormat).toBe('main-site-enhancement-character');
    expect(enhancement.config.skillLevel).toBe(177);
    expect(global.localStorage.setItem.mock.calls.some(([key]) => key === ENHANCEMENT_STORAGE_KEY)).toBe(false);

    setActivePinia(createPinia());
    const refreshedEnhancement = useEnhancementStore();
    expect(refreshedEnhancement.config.targetLevel).toBe(7);
    expect(refreshedEnhancement.config.skillLevel).toBe(100);
  });

  // 迷宫商店升级等级的覆盖摘要必须随桥接响应回传给脚本状态栏：该字段是破坏性整包
  // 覆盖（主站未购买 = 全 0 → 清空），只回 ok 会让用户手填的多选框等级无声消失。
  it('forwards the labyrinth upgrade overwrite summary to the script status bar', async () => {
    const simulator = useSimulatorStore();
    simulator.simulationSettings.labyrinthUpgrades = { damage: 5, cast_speed: 2 };
    const payload = createMainSiteCurrentCharacterFixture({ characterName: 'No Upgrades Hero' });
    payload.characterInfo = { labyrinthCombatDamageLevel: 0, labyrinthAttackSpeedLevel: 0 };

    const result = await applyTampermonkeyImportMessage(simulator, { requestId: 'labyrinth-1', payload });

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(result.labyrinthUpgradesImport).toEqual({
      levelCount: 0,
      previousLevelCount: 2,
      changed: true,
      cleared: true,
    });
    expect(simulator.simulationSettings.labyrinthUpgrades).toEqual({});
  });

  it('reports no labyrinth upgrade summary when the payload carries no levels', async () => {
    const simulator = useSimulatorStore();
    simulator.simulationSettings.labyrinthUpgrades = { damage: 5 };

    const shareProfile = await applyTampermonkeyImportMessage(
      simulator,
      createImportMessage({ requestId: 'labyrinth-2', characterName: 'Share Profile Hero' }),
    );

    expect(shareProfile.labyrinthUpgradesImport).toBeNull();
    expect(simulator.simulationSettings.labyrinthUpgrades).toEqual({ damage: 5 });
  });
});
