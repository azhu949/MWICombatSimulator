import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import achievementDetailMap from '../../combatsimulator/data/achievementDetailMap.json';
import achievementTierDetailMap from '../../combatsimulator/data/achievementTierDetailMap.json';
import Player from '../../combatsimulator/player.js';
import Zone from '../../combatsimulator/zone.js';
import { importSoloConfig } from '../importExportMapper.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../playerMapper.js';
import modernPlayerJunglePlanetFixture from './fixtures/modernPlayerJunglePlanetFixture.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ONE_HOUR = 60 * 60 * 1e9;
const FIXTURE_ZONE_HRID = '/actions/combat/jungle_planet';
const FIXTURE_DIFFICULTY_TIER = 1;
const FIXTURE_SIMULATION_HOURS = 24;

function createSimulationSettings() {
  return {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: FIXTURE_ZONE_HRID,
    dungeonHrid: '',
    difficultyTier: FIXTURE_DIFFICULTY_TIER,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: FIXTURE_SIMULATION_HOURS,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: false,
  };
}

function createCompletedAchievementMapForFirstTier() {
  const firstTier = Object.values(achievementTierDetailMap)[0];
  const tierAchievements = Object.values(achievementDetailMap).filter((detail) => detail.tierHrid === firstTier?.hrid);

  expect(firstTier).toBeTruthy();
  expect(tierAchievements.length).toBeGreaterThan(0);

  return Object.fromEntries(tierAchievements.map((achievement) => [achievement.hrid, true]));
}

function createImportedPlayerConfig(overrides = {}) {
  const result = importSoloConfig(
    JSON.stringify(modernPlayerJunglePlanetFixture),
    createEmptyPlayerConfig(1),
    createSimulationSettings(),
  );

  return {
    ...result.player,
    selected: true,
    ...overrides,
  };
}

function createSimulationPlayer(overrides = {}) {
  const [player] = buildPlayersForSimulation([createImportedPlayerConfig(overrides)]);
  return player;
}

function activatePermanentBuffs(player) {
  player.zoneBuffs = [];
  player.extraBuffs = [];
  player.generatePermanentBuffs();
  player.reset(0);
  return player;
}

function capturePermanentBuffCombatStats(player) {
  return {
    combatExperience: player.combatDetails.combatStats.combatExperience,
    combatRareFind: player.combatDetails.combatStats.combatRareFind,
    castSpeed: player.combatDetails.combatStats.castSpeed,
    hpRegenPer10: player.combatDetails.combatStats.hpRegenPer10,
    mpRegenPer10: player.combatDetails.combatStats.mpRegenPer10,
  };
}

async function runDeterministicSimulation(player, seed) {
  // 切片 21B：JS 引擎已删除——roundtrip 一致性改在 wasm 引擎上对账（同一种子
  // 下两次运行的 simResult 必须逐字段一致，且 DTO roundtrip 不改变结果）。
  const { existsSync, readFileSync } = await import('node:fs');
  const { setWasmProductionEngineForTests, tryRunWasmProductionRound } = await import('../wasmProductionSimulation.js');
  const { loadWasmEngine } = await import('../wasmEngineLoader.js');
  const gluePath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine.js');
  const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
  if (!existsSync(gluePath)) throw new Error('engine/pkg not built — run npm run build:wasm');
  const { pathToFileURL } = await import('node:url');
  setWasmProductionEngineForTests(
    await loadWasmEngine({ glueUrl: pathToFileURL(gluePath).href, moduleOrPath: readFileSync(wasmPath) }),
  );

  const zone = new Zone(FIXTURE_ZONE_HRID, FIXTURE_DIFFICULTY_TIER);
  player.zoneBuffs = zone?.buffs || [];
  player.extraBuffs = [];

  const output = await tryRunWasmProductionRound({
    useWasmEngine: true,
    players: [player],
    zone,
    seed,
    simulationTimeLimit: FIXTURE_SIMULATION_HOURS * ONE_HOUR,
    options: { minimalResult: false, logCombatEvents: false, enableHpMpVisualization: false },
  });
  if (!output) throw new Error('wasm round failed');
  return output.simResult;
}

function totalExperience(simResult, playerHrid = 'player1') {
  return Object.values(simResult?.experienceGained?.[playerHrid] ?? {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
}

describe('player worker roundtrip parity', () => {
  it('preserves imported permanent buffs across worker roundtrip', () => {
    const achievementMap = createCompletedAchievementMapForFirstTier();
    const directPlayer = activatePermanentBuffs(createSimulationPlayer({ achievements: achievementMap }));
    const roundtripPlayer = activatePermanentBuffs(Player.createFromDTO(structuredClone(directPlayer)));

    expect(directPlayer.houseRooms).toHaveLength(roundtripPlayer.houseRooms.length);
    expect(directPlayer.houseRooms.length).toBeGreaterThan(0);
    expect(directPlayer.achievements?.buffs?.length).toBeGreaterThan(0);
    expect(roundtripPlayer.achievements?.buffs?.length).toBe(directPlayer.achievements?.buffs?.length);
    expect(capturePermanentBuffCombatStats(roundtripPlayer)).toEqual(capturePermanentBuffCombatStats(directPlayer));
  });

  it('matches deterministic combat results after worker roundtrip for the jungle planet modern fixture', async () => {
    const seed = 20260307;
    const directResult = await runDeterministicSimulation(createSimulationPlayer(), seed);
    const roundtripResult = await runDeterministicSimulation(
      Player.createFromDTO(structuredClone(createSimulationPlayer())),
      seed,
    );

    expect(roundtripResult.encounters).toBe(directResult.encounters);
    expect(roundtripResult.deaths?.player1 ?? 0).toBe(directResult.deaths?.player1 ?? 0);
    expect(totalExperience(roundtripResult)).toBe(totalExperience(directResult));
  });
});
