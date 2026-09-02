import { defineStore } from 'pinia';
import {
  abilityOptions,
  actionDetailIndex,
  drinkOptions,
  dungeonOptions,
  equipmentOptionsBySlot,
  foodOptions,
  groupZoneHrids,
  itemDetailIndex,
  labyrinthCrateOptions,
  labyrinthOptions,
  soloZoneHrids,
  zoneOptions,
} from '../shared/gameDataIndex.js';
import { createEmptyPlayerConfig, ensurePlayerAdvancedState } from '../shared/playerConfig.js';
import workerClient from '../services/workerClient.js';
import {
  applyPersistedAchievementsToPlayers,
  clearPlayerAchievementsFromStorage,
  clearPlayerDataSnapshotFromStorage,
  createPlayerDataSnapshotState,
  createPricingState,
  getStorageItem,
  loadEquipmentSetsFromStorage,
  loadPlayerAchievementsFromStorage,
  loadPlayerDataSnapshotFromStorage,
  loadQueueRunSettingsByPlayerFromStorage,
  loadQueueRuntimeSettingsFromStorage,
  loadSimulationUiSettingsFromStorage,
  parsePlayerSnapshotSummary,
  persistEquipmentSetsToStorage,
  persistPlayerAchievementsToStorage,
  savePlayerDataSnapshotToStorage,
  upsertPlayerDataSnapshotToStorage,
} from '../services/simulatorStorage.js';
import {
  exportGroupConfig,
  exportSoloConfig,
  importGroupConfig as parseGroupImportConfig,
  importSoloConfig as parseSoloImportConfig,
} from '../services/importExportMapper.js';
import {
  assetScoreEquals,
  computeAssetScoreConfigSignature,
  computePlayerAssetScore,
  isPricingDataAvailableForAssetScore,
} from '../services/assetScoreService.js';
import {
  ensureTriggerMapEntry,
  getDefaultTriggerDtosForHrid,
  sanitizeTriggerList,
  sanitizeTriggerMap,
} from '../services/triggerMapper.js';
import {
  RUN_SCOPE_ALL_GROUP_ZONES,
  RUN_SCOPE_ALL_LABYRINTHS,
  RUN_SCOPE_ALL_SOLO_ZONES,
  RUN_SCOPE_SINGLE,
  LABYRINTH_ROOM_LEVEL_DEFAULT,
  buildQueueBaselineSettings,
  normalizeLabyrinthCrates,
  toPlayerHrid,
} from '../services/simulationDomain.js';
import { createAdvisorState, resolveAdvisorMetricPlayer } from '../services/advisorDomain.js';
import {
  QUEUE_PARALLEL_WORKER_LIMIT_MIN,
  QUEUE_PARALLEL_WORKER_LIMIT_MAX,
  QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS,
} from '../services/queueScoring.js';
import {
  buildEquipmentSetQueueChangesFromQueueState,
  buildQueueItemsFromQueueChangeTemplates,
  createEquipmentSetSnapshotFromPlayer,
  normalizeEquipmentSetQueueChanges,
  queueStateHasUnsupportedEquipmentSetQueueChanges,
} from '../services/queueVariants.js';
import { clamp, deepClone, isPlainObject } from '../services/utils.js';
import {
  QUEUE_PLAYER_IDS,
  buildQueuePartyComparisonPlayers,
  buildQueuePartySignature,
  createImportedBaselineByPlayer,
  createImportedProfileByPlayer,
  createQueueActions,
  createQueueBaselineRecord,
  createQueuePlayerState,
  createQueueStateByPlayer,
} from './simulatorQueueActions.js';
import { createPricingActions, ensureQueueMarketPriceSnapshot } from './simulatorPricingActions.js';
import { createAdvisorActions } from './simulatorAdvisorActions.js';
import { createSimulationActions } from './simulatorSimulationActions.js';

const ABILITY_BOOK_CATEGORY_HRID = '/item_categories/ability_book';

let playerMapperModulePromise = null;

function loadPlayerMapperModule() {
  if (!playerMapperModulePromise) {
    playerMapperModulePromise = import('../services/playerMapper.js');
  }
  return playerMapperModulePromise;
}

function sortByNameThenLevel(a, b) {
  if (a.itemLevel !== b.itemLevel) {
    return a.itemLevel - b.itemLevel;
  }
  return a.name.localeCompare(b.name);
}

function resolveFoodConsumableSortGroup(option) {
  const itemHrid = String(option?.hrid || '');
  const item = itemDetailIndex?.[itemHrid];
  const hitpointRestore = Number(item?.hitpointRestore ?? 0);
  const manapointRestore = Number(item?.manapointRestore ?? 0);
  const recoveryDuration = Number(item?.recoveryDuration ?? 0);

  if (hitpointRestore > 0 && manapointRestore <= 0) {
    return recoveryDuration > 0 ? 1 : 0;
  }

  if (manapointRestore > 0 && hitpointRestore <= 0) {
    return recoveryDuration > 0 ? 3 : 2;
  }

  return 99;
}

function getEquipmentOptionsBySlot() {
  return equipmentOptionsBySlot;
}

function getConsumableOptions(categoryHrid) {
  if (categoryHrid === '/item_categories/food') {
    return foodOptions;
  }

  if (categoryHrid === '/item_categories/drink') {
    return drinkOptions;
  }

  return [];
}

function getAbilityOptions() {
  return abilityOptions;
}

function getZoneOptions() {
  return { zones: zoneOptions, dungeons: dungeonOptions };
}

function getLabyrinthOptions() {
  return labyrinthOptions;
}

function getDetectedHardwareCoreCount() {
  const hardwareConcurrency = Number(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : NaN);
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(hardwareConcurrency));
}

function getParallelWorkerHardMaxForCurrentMachine() {
  const detectedCoreCount = getDetectedHardwareCoreCount();
  if (!Number.isFinite(detectedCoreCount)) {
    return QUEUE_PARALLEL_WORKER_LIMIT_MAX;
  }
  return clamp(detectedCoreCount, QUEUE_PARALLEL_WORKER_LIMIT_MIN, QUEUE_PARALLEL_WORKER_LIMIT_MAX);
}

function getRecommendedParallelWorkerLimit() {
  const detectedCoreCount = getDetectedHardwareCoreCount();
  const upperBound = Number.isFinite(detectedCoreCount)
    ? Math.min(QUEUE_PARALLEL_WORKER_LIMIT_MAX, detectedCoreCount)
    : QUEUE_PARALLEL_WORKER_LIMIT_MAX;
  return clamp(QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS, QUEUE_PARALLEL_WORKER_LIMIT_MIN, upperBound);
}

/**
 * @typedef {Object} SimulatorStoreState
 * @property {Array<any>} players
 * @property {string} activePlayerId
 * @property {Object} simulationSettings
 * @property {{ isRunning: boolean, progress: number, error: string, startedAt: number, elapsedSeconds: number, workerMode: "single" | "multi" }} runtime
 * @property {{ simResult: any, simResults: Array<any>, summaryRows: Array<any>, batchRows: Array<any>, batchResultType: string, activeResultPlayerHrid: string, timeSeriesData: any }} results
 */
export const useSimulatorStore = defineStore('simulator', {
  state: () => {
    const playerAchievementsById = loadPlayerAchievementsFromStorage();
    const playerList = applyPersistedAchievementsToPlayers(
      [1, 2, 3, 4, 5].map((id) => createEmptyPlayerConfig(id)),
      playerAchievementsById,
    );
    playerList.forEach((player) => ensurePlayerAdvancedState(player));
    const persistedQueueRunSettingsByPlayer = loadQueueRunSettingsByPlayerFromStorage();
    const simulationUiSettings = loadSimulationUiSettingsFromStorage();
    const { zones, dungeons } = getZoneOptions();
    const labyrinths = getLabyrinthOptions();
    const initialGroupZoneHrids = groupZoneHrids;
    const initialSoloZoneHrids = soloZoneHrids;

    return {
      players: playerList,
      activePlayerId: '1',
      options: {
        equipmentBySlot: getEquipmentOptionsBySlot(),
        food: getConsumableOptions('/item_categories/food'),
        drinks: getConsumableOptions('/item_categories/drink'),
        abilities: getAbilityOptions(),
        zones,
        dungeons,
        labyrinths,
        labyrinthCrates: {
          coffee: labyrinthCrateOptions.coffee,
          food: labyrinthCrateOptions.food,
          tea: labyrinthCrateOptions.tea,
        },
      },
      simulationSettings: {
        mode: 'zone',
        runScope: RUN_SCOPE_SINGLE,
        useDungeon: false,
        zoneHrid: zones[0]?.hrid ?? '',
        dungeonHrid: dungeons[0]?.hrid ?? '',
        difficultyTier: 0,
        labyrinthHrid: labyrinths[0]?.hrid ?? '',
        roomLevel: LABYRINTH_ROOM_LEVEL_DEFAULT,
        simulationTimeHours: 24,
        mooPass: simulationUiSettings.mooPass,
        combatScrollsEnabled: simulationUiSettings.combatScrollsEnabled,
        comExpEnabled: simulationUiSettings.comExpEnabled,
        comExp: simulationUiSettings.comExp,
        comDropEnabled: simulationUiSettings.comDropEnabled,
        comDrop: simulationUiSettings.comDrop,
        enableHpMpVisualization: simulationUiSettings.enableHpMpVisualization,
        selectedGroupZoneHrids: initialGroupZoneHrids,
        selectedSoloZoneHrids: initialSoloZoneHrids,
        labyrinthCrates: normalizeLabyrinthCrates({}),
      },
      runtime: {
        isRunning: false,
        progress: 0,
        error: '',
        startedAt: 0,
        elapsedSeconds: 0,
        workerMode: 'single',
        completionNoticeId: 0,
      },
      results: {
        simResult: null,
        simResults: [],
        summaryRows: [],
        batchRows: [],
        batchResultType: '',
        activeResultPlayerHrid: 'player1',
        timeSeriesData: null,
      },
      advisor: createAdvisorState(),
      queue: {
        byPlayer: createQueueStateByPlayer(playerList, persistedQueueRunSettingsByPlayer),
        importedProfileByPlayer: createImportedProfileByPlayer(),
        importedBaselineByPlayer: createImportedBaselineByPlayer(),
      },
      queueRuntime: loadQueueRuntimeSettingsFromStorage(),
      playerDataSnapshot: createPlayerDataSnapshotState(),
      equipmentSets: loadEquipmentSetsFromStorage(),
      pricing: createPricingState(),
      abilityUpgradeReferenceVersion: 0,
      ui: {
        language: getStorageItem('i18nextLng', { fallback: 'zh' }),
      },
    };
  },
  getters: {
    activePlayer(state) {
      return state.players.find((player) => player.id === state.activePlayerId) ?? state.players[0];
    },
    selectedPlayers(state) {
      return state.players.filter((player) => player.selected);
    },
    resolvedAdvisorMetricPlayer(state) {
      const selectedPlayers = state.players
        .filter((player) => player.selected)
        .map((player) => ({ id: player.id, name: player.name }));
      return resolveAdvisorMetricPlayer(selectedPlayers, state.activePlayerId);
    },
    currentActionOptions(state) {
      if (state.simulationSettings.mode === 'labyrinth') {
        return state.options.labyrinths;
      }
      return state.simulationSettings.useDungeon ? state.options.dungeons : state.options.zones;
    },
    groupZoneOptions(state) {
      return (state.options.zones || []).filter(
        (zone) => Number(actionDetailIndex?.[zone?.hrid]?.maxSpawnCount ?? 0) > 1,
      );
    },
    soloZoneOptions(state) {
      return (state.options.zones || []).filter(
        (zone) => Number(actionDetailIndex?.[zone?.hrid]?.maxSpawnCount ?? 0) === 1,
      );
    },
    currentMaxDifficulty(state) {
      if (state.simulationSettings.mode === 'labyrinth') {
        return 0;
      }

      const targetHrid = state.simulationSettings.useDungeon
        ? state.simulationSettings.dungeonHrid
        : state.simulationSettings.zoneHrid;
      const source = state.simulationSettings.useDungeon ? state.options.dungeons : state.options.zones;
      const action = source.find((entry) => entry.hrid === targetHrid);
      return Number(action?.maxDifficulty ?? 0);
    },
    availableRunScopes(state) {
      if (state.simulationSettings.mode === 'labyrinth') {
        return [
          { value: RUN_SCOPE_SINGLE, label: 'Single labyrinth' },
          { value: RUN_SCOPE_ALL_LABYRINTHS, label: 'All labyrinths' },
        ];
      }

      return [
        { value: RUN_SCOPE_SINGLE, label: 'Single target' },
        { value: RUN_SCOPE_ALL_GROUP_ZONES, label: 'All group zones' },
        { value: RUN_SCOPE_ALL_SOLO_ZONES, label: 'All solo zones' },
      ];
    },
    activeResultRow(state) {
      return state.results.summaryRows.find((row) => row.playerHrid === state.results.activeResultPlayerHrid) ?? null;
    },
    activeQueueState(state) {
      return state.queue.byPlayer[state.activePlayerId] ?? createQueuePlayerState();
    },
    activeQueuePartyStatus(state) {
      const queueState = state.queue.byPlayer[state.activePlayerId] ?? createQueuePlayerState();
      const hasBaselineSnapshot = Boolean(queueState?.baseline?.snapshot);
      if (!hasBaselineSnapshot) {
        return {
          hasMismatch: false,
          messageKey: '',
          memberNames: [],
        };
      }
      const baselinePartyPlayers = Array.isArray(queueState?.baseline?.partySnapshot?.selectedPlayers)
        ? queueState.baseline.partySnapshot.selectedPlayers
        : [];
      const memberNames = baselinePartyPlayers
        .map((player) => String(player?.name || `Player ${player?.id || ''}`).trim())
        .filter(Boolean);
      const selectedTeammateCount = buildQueuePartyComparisonPlayers(state.players, state.activePlayerId).length;
      if (baselinePartyPlayers.length <= 0) {
        return {
          hasMismatch: selectedTeammateCount > 0,
          messageKey: selectedTeammateCount > 0 ? 'common:queue.partyChangedSinceBaseline' : '',
          memberNames: [],
        };
      }

      const baselineSignature = String(
        queueState?.baseline?.partySnapshot?.signature ||
          buildQueuePartySignature(baselinePartyPlayers, state.activePlayerId),
      );
      const currentSignature = buildQueuePartySignature(state.players, state.activePlayerId);
      const hasMismatch = baselineSignature !== currentSignature;
      return {
        hasMismatch,
        messageKey: hasMismatch ? 'common:queue.partyChangedSinceBaseline' : '',
        memberNames,
      };
    },
    activeImportedBaselineSnapshot(state) {
      return state.queue.importedBaselineByPlayer?.[state.activePlayerId] ?? null;
    },
    isAnyQueueRunning(state) {
      return Object.values(state.queue.byPlayer).some((queueState) => Boolean(queueState?.isRunning));
    },
    detectedHardwareCoreCount() {
      return getDetectedHardwareCoreCount();
    },
    queueParallelWorkerHardMax() {
      return getParallelWorkerHardMaxForCurrentMachine();
    },
    queueParallelWorkerRecommended() {
      return getRecommendedParallelWorkerLimit();
    },
    equipmentSetEntries(state) {
      return Object.entries(state.equipmentSets || {})
        .map(([name, entry]) => ({
          name,
          savedAt: Number(entry?.savedAt ?? 0),
          queueChangeCount: Array.isArray(entry?.queueChanges?.items) ? entry.queueChanges.items.length : 0,
        }))
        .sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
    },
    playerDataSnapshotRows(state) {
      const sourceMap = state.playerDataSnapshot?.playerDataMap || {};
      return QUEUE_PLAYER_IDS.map((playerId) => {
        const rawText = sourceMap[playerId];
        const hasSnapshot = typeof rawText === 'string' && rawText.trim().length > 0;
        const summary = hasSnapshot ? parsePlayerSnapshotSummary(rawText) : null;
        return {
          playerId,
          hasSnapshot,
          zoneHrid: summary?.zoneHrid || '',
          dungeonHrid: summary?.dungeonHrid || '',
          labyrinthHrid: summary?.labyrinthHrid || '',
          zone: summary?.zone || '-',
          dungeon: summary?.dungeon || '-',
          difficulty: summary?.difficulty || '-',
          simulationTime: summary?.simulationTime || '-',
          labyrinth: summary?.labyrinth || '-',
          roomLevel: summary?.roomLevel || '-',
        };
      });
    },
  },
  actions: {
    ensurePlayerConfig(player = this.activePlayer) {
      return ensurePlayerAdvancedState(player);
    },
    syncActiveResultPlayerToActivePlayer(playerId = this.activePlayerId) {
      const targetPlayerHrid = toPlayerHrid(playerId);
      const summaryRow = Array.isArray(this.results.summaryRows)
        ? this.results.summaryRows.find((row) => String(row?.playerHrid || '') === targetPlayerHrid)
        : null;
      this.results.activeResultPlayerHrid = summaryRow?.playerHrid || targetPlayerHrid;
      return this.results.activeResultPlayerHrid;
    },
    clearOtherPlayersForSoloImport(targetPlayerId = this.activePlayerId) {
      const normalizedTargetId = String(targetPlayerId || this.activePlayerId);
      const hasTargetPlayer = this.players.some((player) => String(player.id) === normalizedTargetId);
      if (!hasTargetPlayer) {
        return false;
      }

      this.players = this.players.map((player) => {
        if (String(player.id) === normalizedTargetId) {
          return player;
        }

        const clearedPlayer = createEmptyPlayerConfig(player.id);
        clearedPlayer.selected = false;
        return clearedPlayer;
      });

      if (!this.queue.byPlayer || typeof this.queue.byPlayer !== 'object') {
        this.queue.byPlayer = createQueueStateByPlayer(this.players);
      }

      for (const player of this.players) {
        if (String(player.id) === normalizedTargetId) {
          continue;
        }

        this.queue.byPlayer[String(player.id)] = createQueuePlayerState(
          this.queue.byPlayer[String(player.id)]?.settings,
        );
        this.setImportedProfileState(player.id, false);
      }

      this.persistPlayerAchievements();
      return true;
    },
    clearPlayerSlots(playerIds = []) {
      const normalizedIds = Array.from(
        new Set(
          (Array.isArray(playerIds) ? playerIds : [])
            .map((playerId) => String(playerId || '').trim())
            .filter((playerId) => this.players.some((player) => String(player.id) === playerId)),
        ),
      );
      if (normalizedIds.length === 0) {
        return false;
      }

      const targetIdSet = new Set(normalizedIds);
      this.players = this.players.map((player) => {
        if (!targetIdSet.has(String(player.id))) {
          return player;
        }

        const clearedPlayer = createEmptyPlayerConfig(player.id);
        clearedPlayer.selected = false;
        return clearedPlayer;
      });

      if (!this.queue.byPlayer || typeof this.queue.byPlayer !== 'object') {
        this.queue.byPlayer = createQueueStateByPlayer(this.players);
      }

      for (const playerId of normalizedIds) {
        this.queue.byPlayer[playerId] = createQueuePlayerState(this.queue.byPlayer[playerId]?.settings);
        this.setImportedProfileState(playerId, false);
      }

      this.persistPlayerAchievements();
      return true;
    },
    refreshPlayerDataSnapshot() {
      this.playerDataSnapshot = createPlayerDataSnapshotState();
      return this.playerDataSnapshot;
    },
    savePlayerDataSnapshot() {
      const snapshotMap = {};
      for (const player of this.players) {
        const playerId = String(player.id || '');
        if (!playerId) {
          continue;
        }
        snapshotMap[playerId] = exportSoloConfig(player, this.simulationSettings);
      }

      try {
        savePlayerDataSnapshotToStorage(snapshotMap);
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: true,
          savedAt: this.playerDataSnapshot.savedAt,
          messageKey: 'common:settingsPage.playerSaveSuccess',
        };
      } catch (error) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerSaveError',
        };
      }
    },
    loadPlayerDataSnapshot() {
      const loadResult = loadPlayerDataSnapshotFromStorage();
      if (loadResult.status === 'not_found') {
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerLoadNotFound',
        };
      }

      if (loadResult.status !== 'ok') {
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerLoadInvalid',
        };
      }

      const loadedPlayerIds = Object.keys(loadResult.playerDataMap || {});
      if (loadedPlayerIds.length === 0) {
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerLoadInvalid',
        };
      }

      try {
        let nextPlayers = [...this.players];
        let preferredSimulationSettings = null;
        let fallbackSimulationSettings = null;

        for (const playerId of loadedPlayerIds) {
          const snapshotText = loadResult.playerDataMap[playerId];
          const sourcePlayer =
            nextPlayers.find((player) => String(player.id) === String(playerId)) || createEmptyPlayerConfig(playerId);

          const parsed = parseSoloImportConfig(snapshotText, sourcePlayer, this.simulationSettings);
          this.ensurePlayerConfig(parsed.player);
          nextPlayers = nextPlayers.map((player) => (String(player.id) === String(playerId) ? parsed.player : player));

          if (!fallbackSimulationSettings && parsed?.simulationSettings) {
            fallbackSimulationSettings = {
              ...parsed.simulationSettings,
            };
          }
          if (String(playerId) === String(this.activePlayerId) && parsed?.simulationSettings) {
            preferredSimulationSettings = {
              ...parsed.simulationSettings,
            };
          }

          this.queue.byPlayer[String(playerId)] = createQueuePlayerState(
            this.queue.byPlayer[String(playerId)]?.settings,
          );
          this.setImportedProfileState(playerId, true);
          this.setImportedBaselineSnapshot(playerId, parsed.player);
        }

        this.players = this.players.map((player) => {
          const resolved = nextPlayers.find((candidate) => String(candidate.id) === String(player.id));
          return resolved || player;
        });
        this.persistPlayerAchievements();

        const nextSimulationSettings = preferredSimulationSettings || fallbackSimulationSettings;
        if (nextSimulationSettings) {
          this.simulationSettings = {
            ...this.simulationSettings,
            ...nextSimulationSettings,
          };
          // 恢复角色数据时应默认回到常规区域视图，便于立即编辑。
          this.simulationSettings.mode = 'zone';
          this.simulationSettings.useDungeon = false;
          if (!this.simulationSettings.zoneHrid) {
            this.simulationSettings.zoneHrid = String(this.options?.zones?.[0]?.hrid || '');
          }
          this.normalizeRunScope();
          this.normalizeDifficulty();
        }

        this.playerDataSnapshot = {
          savedAt: Number(loadResult.savedAt || 0),
          playerDataMap: loadResult.playerDataMap || {},
        };

        return {
          ok: true,
          savedAt: this.playerDataSnapshot.savedAt,
          loadedPlayerIds,
          messageKey: 'common:settingsPage.playerLoadSuccess',
        };
      } catch (error) {
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerLoadInvalid',
        };
      }
    },
    deleteSinglePlayerDataSnapshot(playerId) {
      const targetPlayerId = String(playerId || '');
      if (!targetPlayerId) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerDeleteError',
        };
      }

      const loadResult = loadPlayerDataSnapshotFromStorage();
      if (loadResult.status !== 'ok') {
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerLoadNotFound',
        };
      }

      const nextPlayerDataMap = {
        ...(loadResult.playerDataMap || {}),
      };
      if (!Object.prototype.hasOwnProperty.call(nextPlayerDataMap, targetPlayerId)) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerLoadNotFound',
        };
      }

      delete nextPlayerDataMap[targetPlayerId];

      try {
        if (Object.keys(nextPlayerDataMap).length === 0) {
          clearPlayerDataSnapshotFromStorage();
        } else {
          upsertPlayerDataSnapshotToStorage(nextPlayerDataMap);
        }

        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: true,
          messageKey: 'common:settingsPage.playerDeleteSingleSuccess',
          messageOptions: {
            playerId: targetPlayerId,
          },
        };
      } catch (error) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerDeleteError',
        };
      }
    },
    deleteAllPlayerDataSnapshots() {
      try {
        clearPlayerDataSnapshotFromStorage();
        this.playerDataSnapshot = createPlayerDataSnapshotState();
        return {
          ok: true,
          messageKey: 'common:settingsPage.playerDeleteAllSuccess',
        };
      } catch (error) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.playerDeleteError',
        };
      }
    },
    persistPlayerAchievements() {
      persistPlayerAchievementsToStorage(this.players);
    },
    clearPersistedPlayerAchievements() {
      clearPlayerAchievementsFromStorage();
    },
    ensureActivePlayerTriggerDefaults(targetHrid) {
      const hrid = String(targetHrid || '');
      if (!hrid) {
        return [];
      }

      const player = this.activePlayer;
      if (!player) {
        return [];
      }

      if (!isPlainObject(player.triggerMap)) {
        player.triggerMap = {};
      }

      const triggers = ensureTriggerMapEntry(player.triggerMap, hrid);
      player.triggerMap[hrid] = sanitizeTriggerList(triggers);
      return deepClone(player.triggerMap[hrid]);
    },
    getActivePlayerTriggers(targetHrid) {
      const hrid = String(targetHrid || '');
      if (!hrid) {
        return [];
      }

      const triggerMap = isPlainObject(this.activePlayer?.triggerMap) ? this.activePlayer.triggerMap : {};
      return deepClone(sanitizeTriggerList(triggerMap[hrid]));
    },
    setActivePlayerTriggers(targetHrid, triggerList) {
      const hrid = String(targetHrid || '');
      if (!hrid) {
        return [];
      }

      const player = this.activePlayer;
      if (!player) {
        return [];
      }

      if (!isPlainObject(player.triggerMap)) {
        player.triggerMap = {};
      }

      player.triggerMap[hrid] = sanitizeTriggerList(triggerList);
      return deepClone(player.triggerMap[hrid]);
    },
    resetActivePlayerTriggersToDefault(targetHrid) {
      const hrid = String(targetHrid || '');
      if (!hrid) {
        return [];
      }

      const player = this.activePlayer;
      if (!player) {
        return [];
      }

      if (!isPlainObject(player.triggerMap)) {
        player.triggerMap = {};
      }

      player.triggerMap[hrid] = sanitizeTriggerList(getDefaultTriggerDtosForHrid(hrid));
      return deepClone(player.triggerMap[hrid]);
    },
    refreshEquipmentSets() {
      this.equipmentSets = loadEquipmentSetsFromStorage();
      return this.equipmentSetEntries;
    },
    saveEquipmentSet(name, playerId = this.activePlayerId) {
      const setName = String(name || '').trim();
      if (!setName) {
        throw new Error('Equipment set name is empty.');
      }

      const normalizedPlayerId = String(playerId || this.activePlayerId);
      const queueState = this.ensureQueueState(normalizedPlayerId);
      if (queueStateHasUnsupportedEquipmentSetQueueChanges(queueState)) {
        throw new Error('common:settingsPage.queueSaveErrorUnsupportedTriggerChange');
      }
      const queueChanges = normalizeEquipmentSetQueueChanges(buildEquipmentSetQueueChangesFromQueueState(queueState));

      this.equipmentSets = {
        ...this.equipmentSets,
        [setName]: {
          savedAt: Date.now(),
          queueChanges,
        },
      };
      persistEquipmentSetsToStorage(this.equipmentSets);
      return this.equipmentSets[setName];
    },
    /**
     * @deprecated 装备套装现在存储队列变更模板。请改用
     * importEquipmentSetQueueChanges(name, playerId) 来应用已保存的套装。
     */
    loadEquipmentSet() {
      return false;
    },
    importEquipmentSetQueueChanges(name, playerId = this.activePlayerId) {
      const setName = String(name || '').trim();
      if (!setName) {
        return {
          ok: false,
          importedCount: 0,
          messageKey: 'common:vue.settings.msgQueueChangesImportFailed',
        };
      }

      const entry = this.equipmentSets?.[setName];
      if (!entry) {
        return {
          ok: false,
          importedCount: 0,
          messageKey: 'common:vue.settings.msgQueueChangesImportFailed',
        };
      }

      const normalizedPlayerId = String(playerId || this.activePlayerId);
      const sourcePlayer = this.players.find((player) => String(player.id) === normalizedPlayerId);
      if (!sourcePlayer) {
        return {
          ok: false,
          importedCount: 0,
          messageKey: 'common:vue.settings.msgQueueChangesImportFailed',
        };
      }

      const queueChanges = normalizeEquipmentSetQueueChanges(entry.queueChanges);
      if (!Array.isArray(queueChanges.items) || queueChanges.items.length <= 0) {
        return {
          ok: false,
          importedCount: 0,
          messageKey: 'common:vue.settings.msgQueueChangesImportEmpty',
        };
      }

      const currentBaselineSnapshot = createEquipmentSetSnapshotFromPlayer(sourcePlayer);
      const importedItems = buildQueueItemsFromQueueChangeTemplates(currentBaselineSnapshot, queueChanges.items);
      if (importedItems.length <= 0) {
        return {
          ok: false,
          importedCount: 0,
          messageKey: 'common:vue.settings.msgQueueChangesImportEmpty',
        };
      }

      const queueState = this.ensureQueueState(normalizedPlayerId);
      queueState.baseline = createQueueBaselineRecord(
        currentBaselineSnapshot,
        null,
        buildQueueBaselineSettings(this.simulationSettings, queueState.settings),
      );
      queueState.items = importedItems;
      queueState.results = [];
      queueState.rawRuns = [];
      queueState.ranking = [];
      queueState.abilityUpgradeCosts = {};
      queueState.isRunning = false;
      queueState.progress = 0;
      queueState.error = '';
      queueState.lastRunAt = 0;

      return {
        ok: true,
        importedCount: importedItems.length,
        messageKey: 'common:vue.settings.msgQueueChangesImported',
      };
    },
    deleteEquipmentSet(name) {
      const setName = String(name || '').trim();
      if (!setName || !this.equipmentSets?.[setName]) {
        return false;
      }

      const nextSets = { ...this.equipmentSets };
      delete nextSets[setName];
      this.equipmentSets = nextSets;
      persistEquipmentSetsToStorage(this.equipmentSets);
      return true;
    },
    setActivePlayer(id) {
      this.activePlayerId = String(id);
      this.ensurePlayerConfig(this.activePlayer);
      this.ensureQueueState(this.activePlayerId);
      if (!Object.prototype.hasOwnProperty.call(this.queue.importedProfileByPlayer, this.activePlayerId)) {
        this.setImportedProfileState(this.activePlayerId, false);
      }
      const player = this.activePlayer;
      if (player && !isPlainObject(player.triggerMap)) {
        player.triggerMap = {};
      }
      this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
    },
    setLanguage(language) {
      this.ui.language = language === 'zh' ? 'zh' : 'en';
    },
    exportGroupConfig() {
      // 导出前刷新资产分快照，保证导出 JSON 携带的分数与当前配置/行情一致。
      this.refreshAssetScores();
      return exportGroupConfig(this.players, this.simulationSettings);
    },
    exportSoloConfig(playerId) {
      const targetId = String(playerId || this.activePlayerId);
      const targetPlayer = this.players.find((player) => player.id === targetId) || this.activePlayer;
      this.refreshAssetScores([targetPlayer.id]);
      return exportSoloConfig(targetPlayer, this.simulationSettings);
    },
    importGroupConfig(text) {
      const result = parseGroupImportConfig(text, this.players, this.simulationSettings);
      if (result.marketItemValues) {
        this.applyImportedMarketItemValues(
          result.marketItemValues,
          result.marketEstimateSource,
          result.syntheticItemHrids,
          result.syntheticLevelKeys,
        );
      }
      result.players.forEach((player) => this.ensurePlayerConfig(player));
      const byId = Object.fromEntries(result.players.map((player) => [String(player.id), player]));
      this.players = this.players.map((player) => byId[String(player.id)] || player);
      this.persistPlayerAchievements();
      result.players.forEach((player) => {
        this.setImportedProfileState(player.id, true);
        this.setImportedBaselineSnapshot(player.id, player);
      });
      this.simulationSettings = {
        ...this.simulationSettings,
        ...result.simulationSettings,
      };
      this.normalizeRunScope();
      this.normalizeDifficulty();
      this.refreshAssetScores();
      return result;
    },
    importSoloConfig(text, playerId) {
      const targetId = String(playerId || this.activePlayerId);
      const currentPlayer = this.players.find((player) => player.id === targetId) || this.activePlayer;
      const result = parseSoloImportConfig(text, currentPlayer, this.simulationSettings);
      // Solo 导入是「替换目标槽位配置」而非「身份迁移」：sanitizePlayerConfig 是
      // 导出/group/快照恢复共用的清洗函数，通用 id 语义（source.id || fallback.id）
      // 的 source.id 优先只在「载荷 id 与目标 id 分歧」时改变结果——solo 的目标由
      // 入参 playerId 决定、载荷 id 无槽位路由职责（group 按载荷 id 路由槽位，匹配
      // 后 source.id 与 fallback.id 恒同值），任由载荷 id 胜出会让携带 id 的 native
      // solo 载荷（modern-solo / modern-player-only；原生导出经 buildExportPlayer
      // 恒携带 id）在顶替目标槽位后带着来源 id——目标 id 从玩家列表消失，此后按
      // 玩家 id 过滤的即时资产分刷新落空（只能等 App.vue 250ms 防抖兜底；导入配置
      // 与槽位原配置签名一致时 watch 不触发，载荷携带的跨会话行情快照将无限期
      // 滞留），imported 标记 / 基线快照 / 桥接 selectAfterImport 全部挂错 id，且
      // 来源 id 撞上其他现有玩家时产生重复 id。与 share-profile /
      // main-site-current-character 分支恒用 fallback.id（= 目标 id）的既有语义
      // 对齐：写入前归一为目标槽位 id。不影响快照保留守卫：configSignature 不含
      // id（equipment/houseRooms/abilities/guildBuffs/工匠茶）；group 导入与快照
      // 恢复按 id 合并的路径不经此处，零影响。
      result.player.id = targetId;
      if (result.marketItemValues) {
        this.applyImportedMarketItemValues(
          result.marketItemValues,
          result.marketEstimateSource,
          result.syntheticItemHrids,
          result.syntheticLevelKeys,
        );
      }
      this.ensurePlayerConfig(result.player);

      this.players = this.players.map((player) => (player.id === targetId ? result.player : player));
      this.persistPlayerAchievements();
      this.setImportedProfileState(targetId, true);
      this.setImportedBaselineSnapshot(targetId, result.player);
      this.simulationSettings = {
        ...this.simulationSettings,
        ...result.simulationSettings,
      };
      this.normalizeRunScope();
      this.normalizeDifficulty();
      this.refreshAssetScores([targetId]);
      return result;
    },
    // 资产分（Gear Score）重算：市场数据不可用且玩家已有快照时的保留语义——
    // 快照仅在「仍与当前配置对应」时保留（导入携带语义的兜底：快照带 configSignature，
    // 与当前配置签名一致，或旧格式快照无签名时向后兼容维持旧行为）；
    // 签名不一致（导入后改配置 / 旧行情快照遇行情重置后改配置）则视为过时，
    // 按当前配置 + 取价链重算（无行情时降级为 vendor/成本法口径，tooltip 来源标记可见）。
    // 值未变化时不写回（App.vue 的资产分 watch 源只跟踪配置签名与行情引用、
    // 不跟踪快照本身；等值守卫同时避免
    // 无谓的引用替换与 UI 重渲染）。
    refreshAssetScores(playerIds = null) {
      const targets = Array.isArray(playerIds) ? new Set(playerIds.map((id) => String(id))) : null;
      const pricingReady = isPricingDataAvailableForAssetScore(this.pricing);
      for (const player of this.players) {
        if (targets && !targets.has(String(player.id))) {
          continue;
        }
        // 保留分支前置短路：行情不可用且已有快照时，仅凭签名比对即可判定保留，
        // 不必先全量 compute 再只为拿 computed.configSignature（该结果在保留时整体丢弃；
        // 记忆化只覆盖装备成本，冷缓存与房屋/技能书/神龛估值每次现算）。
        // 快照无签名（旧格式）时短路在前，不触发签名计算。
        if (!pricingReady && player.assetScore) {
          const snapshotSignature = String(player.assetScore?.configSignature || '');
          // computePlayerAssetScore 写入的 configSignature 即 computeAssetScoreConfigSignature(player)
          //（服务内同一函数、同一 player 归一化），此处直算签名与旧比对严格同值：
          // 与快照签名一致（或快照无签名）才保留，否则视为过时走下方重算。
          if (!snapshotSignature || snapshotSignature === computeAssetScoreConfigSignature(player)) {
            continue;
          }
        }
        const computed = computePlayerAssetScore(player, this.pricing);
        if (computed === null) {
          if (!assetScoreEquals(player.assetScore, null)) {
            player.assetScore = null;
          }
          continue;
        }
        if (!assetScoreEquals(player.assetScore, computed)) {
          player.assetScore = computed;
        }
      }
    },
    ...createPricingActions(),
    ...createAdvisorActions({
      loadPlayerMapperModule,
    }),
    ...createSimulationActions({
      loadPlayerMapperModule,
      workerClient,
    }),
    ...createQueueActions({
      ensureQueueMarketPriceSnapshot,
      loadPlayerMapperModule,
      workerClient,
    }),
  },
});
