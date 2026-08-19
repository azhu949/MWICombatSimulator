import { describe, expect, it } from "vitest";
import { actionDetailIndex, labyrinthCrateOptions, monsterDetailIndex } from "../../shared/gameDataIndex.js";
import {
    LABYRINTH_BATCH_ROOM_LEVEL_MIN,
    LABYRINTH_COFFEE_CRATE_HRIDS,
    LABYRINTH_FOOD_CRATE_HRIDS,
    LABYRINTH_ROOM_LEVEL_DEFAULT,
    LABYRINTH_ROOM_LEVEL_MAX,
    LABYRINTH_ROOM_LEVEL_MIN,
    LABYRINTH_TEA_CRATE_HRIDS,
    ONE_HOUR,
    RUN_SCOPE_ALL_GROUP_ZONES,
    RUN_SCOPE_ALL_SOLO_ZONES,
    RUN_SCOPE_SINGLE,
    aggregateBatchPlayerRows,
    buildAllLabyrinthTargets,
    buildQueueBaselineSettings,
    buildSingleSimulationPayload,
    buildSimulationExtra,
    buildZoneTargetsByScope,
    computeQueueMetrics,
    getAllNonDungeonActions,
    normalizeLabyrinthCrates,
    normalizeZoneSelection,
    summarizeBatchResults,
    summarizeQueueBaselineMetrics,
    summarizeResult,
    toPlayerHrid,
} from "../simulationDomain.js";

function findZoneBySpawnCount(targetSpawnCount) {
    return Object.values(actionDetailIndex || {}).find((action) => {
        if (action?.type !== "/action_types/combat" || action?.category === "/action_categories/combat/dungeons") {
            return false;
        }
        const maxSpawnCount = Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0);
        return targetSpawnCount > 1 ? maxSpawnCount > 1 : maxSpawnCount === 1;
    });
}

function findLabyrinthMonster() {
    return Object.values(monsterDetailIndex || {})
        .filter((monster) => monster?.isLabyrinthMonster === true)
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0))[0] || null;
}

describe("simulationDomain", () => {
    it("returns cached non-dungeon actions as defensive copies", () => {
        const firstActions = getAllNonDungeonActions();
        const secondActions = getAllNonDungeonActions();

        expect(firstActions.length).toBeGreaterThan(0);
        expect(secondActions).toEqual(firstActions);
        expect(secondActions).not.toBe(firstActions);

        firstActions.pop();
        firstActions.push({ hrid: "/actions/not_real" });

        const thirdActions = getAllNonDungeonActions();
        expect(thirdActions).toEqual(secondActions);
        expect(thirdActions.some((action) => action?.hrid === "/actions/not_real")).toBe(false);
    });

    it("normalizes run target selections and labyrinth crates", () => {
        const soloZone = findZoneBySpawnCount(1);
        const groupZone = findZoneBySpawnCount(2);
        expect(soloZone).toBeTruthy();
        expect(groupZone).toBeTruthy();

        expect(normalizeZoneSelection([
            soloZone.hrid,
            soloZone.hrid,
            "/actions/not_real",
            groupZone.hrid,
        ], [soloZone.hrid, groupZone.hrid])).toEqual([soloZone.hrid, groupZone.hrid]);

        expect(normalizeLabyrinthCrates({
            coffee: LABYRINTH_COFFEE_CRATE_HRIDS[0],
            food: "/items/not_a_food_crate",
            tea: "",
        })).toEqual({
            coffee: LABYRINTH_COFFEE_CRATE_HRIDS[0],
            food: "",
            tea: "",
        });
    });

    it("builds scoped zone and labyrinth targets with existing ordering", () => {
        const soloTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_SOLO_ZONES);
        const groupTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_GROUP_ZONES);
        const soloZone = findZoneBySpawnCount(1);
        const groupZone = findZoneBySpawnCount(2);
        expect(soloTargets.length).toBeGreaterThan(0);
        expect(groupTargets.length).toBeGreaterThan(0);
        expect(soloTargets.every((target) => target.zoneHrid !== groupZone.hrid)).toBe(true);
        expect(groupTargets.every((target) => target.zoneHrid !== soloZone.hrid)).toBe(true);

        const selected = buildZoneTargetsByScope(RUN_SCOPE_ALL_GROUP_ZONES, [groupZone.hrid]);
        expect(selected.length).toBe(Number(groupZone.maxDifficulty ?? 0) + 1);
        expect(selected.every((target) => target.zoneHrid === groupZone.hrid)).toBe(true);

        const firstLabyrinth = findLabyrinthMonster();
        const labyrinthTargets = buildAllLabyrinthTargets(["/items/basic_coffee_crate"]);
        expect(firstLabyrinth).toBeTruthy();
        expect(labyrinthTargets[0]).toEqual({
            labyrinthHrid: firstLabyrinth.hrid,
            roomLevel: LABYRINTH_BATCH_ROOM_LEVEL_MIN,
            crates: ["/items/basic_coffee_crate"],
        });
        expect(labyrinthTargets[labyrinthTargets.length - 1].roomLevel).toBe(LABYRINTH_ROOM_LEVEL_MAX);
    });

    it("derives labyrinth crate HRID allow lists from game data options", () => {
        expect(LABYRINTH_COFFEE_CRATE_HRIDS).toEqual(labyrinthCrateOptions.coffee.map((item) => item.hrid));
        expect(LABYRINTH_FOOD_CRATE_HRIDS).toEqual(labyrinthCrateOptions.food.map((item) => item.hrid));
        expect(LABYRINTH_TEA_CRATE_HRIDS).toEqual(labyrinthCrateOptions.tea.map((item) => item.hrid));
    });

    it("builds single simulation payloads without changing worker message shape", () => {
        const players = [{ id: "player1" }];
        const zonePayload = buildSingleSimulationPayload(players, {
            mode: "zone",
            useDungeon: false,
            zoneHrid: "/actions/combat/test_zone",
            difficultyTier: 3,
            simulationTimeHours: 12,
            mooPass: true,
            comExpEnabled: true,
            comExp: 33,
            comDropEnabled: false,
            enableHpMpVisualization: true,
        }, [], {
            workerId: "fixed-worker",
        });

        expect(zonePayload).toEqual({
            type: "start_simulation",
            workerId: "fixed-worker",
            players,
            zone: {
                zoneHrid: "/actions/combat/test_zone",
                difficultyTier: 3,
            },
            labyrinth: null,
            simulationTimeLimit: 12 * ONE_HOUR,
            extra: {
                mooPass: true,
                comExp: 33,
                comDrop: 0,
                enableHpMpVisualization: true,
                combatScrollsEnabled: false,
            },
        });

        expect(buildSingleSimulationPayload(players, {
            mode: "labyrinth",
            labyrinthHrid: "/monsters/test",
            roomLevel: 10,
            simulationTimeHours: 2,
        }, ["crate"], {
            workerId: "labyrinth-worker",
        })).toMatchObject({
            type: "start_simulation",
            workerId: "labyrinth-worker",
            zone: null,
            labyrinth: {
                labyrinthHrid: "/monsters/test",
                roomLevel: LABYRINTH_ROOM_LEVEL_MIN,
                crates: ["crate"],
            },
            simulationTimeLimit: 2 * ONE_HOUR,
        });
    });

    it("normalizes invalid single simulation payload numeric settings", () => {
        const players = [{ id: "player1" }];

        expect(buildSingleSimulationPayload(players, {
            mode: "zone",
            zoneHrid: "/actions/combat/test_zone",
            difficultyTier: "bad",
            simulationTimeHours: Number.NaN,
        }, [], {
            workerId: "nan-zone-worker",
        })).toMatchObject({
            workerId: "nan-zone-worker",
            zone: {
                zoneHrid: "/actions/combat/test_zone",
                difficultyTier: 0,
            },
            simulationTimeLimit: 24 * ONE_HOUR,
        });

        expect(buildSingleSimulationPayload(players, {
            mode: "zone",
            zoneHrid: "/actions/combat/test_zone",
            difficultyTier: 2.9,
            simulationTimeHours: 1.5,
        }, [], {
            workerId: "fractional-zone-worker",
        })).toMatchObject({
            workerId: "fractional-zone-worker",
            zone: {
                difficultyTier: 2,
            },
            simulationTimeLimit: 1.5 * ONE_HOUR,
        });

        expect(buildSingleSimulationPayload(players, {
            mode: "labyrinth",
            labyrinthHrid: "/monsters/test",
            roomLevel: "bad",
            simulationTimeHours: "bad",
        }, [], {
            workerId: "invalid-labyrinth-worker",
        })).toMatchObject({
            workerId: "invalid-labyrinth-worker",
            labyrinth: {
                labyrinthHrid: "/monsters/test",
                roomLevel: LABYRINTH_ROOM_LEVEL_DEFAULT,
            },
            simulationTimeLimit: 24 * ONE_HOUR,
        });
    });

    it("preserves combat scroll DTOs and an optional simulation context", () => {
        const players = [{
            hrid: "player1",
            combatScrolls: { "/items/seal_of_damage": { quantity: 2 } },
        }];
        const payload = buildSingleSimulationPayload(players, {
            mode: "zone",
            zoneHrid: "/actions/combat/test_zone",
            simulationTimeHours: 1,
        }, [], {
            workerId: "context-worker",
            simulationContext: { isGuildTrial: true },
        });

        expect(payload.players).toBe(players);
        expect(payload.simulationContext).toEqual({ isGuildTrial: true });
    });

    it("summarizes simulation results for rows and queue metrics", () => {
        const simResult = {
            simulatedTime: 2 * ONE_HOUR,
            encounters: 20,
            deaths: {
                player2: 4,
            },
            experienceGained: {
                player2: {
                    attack: 200,
                    magic: 100,
                },
            },
            attacks: {
                player2: {
                    slash: {
                        hit: {
                            10: 3,
                            5: 2,
                            miss: 99,
                        },
                    },
                },
            },
        };

        const rows = summarizeResult(simResult, [{ id: "2", name: "Second" }]);
        expect(rows[0]).toMatchObject({
            playerHrid: "player2",
            playerName: "Second",
            encountersPerHour: 10,
            deathsPerHour: 2,
            totalXpPerHour: 150,
            attackXpPerHour: 100,
            magicXpPerHour: 50,
        });

        expect(computeQueueMetrics(simResult, "2")).toMatchObject({
            dps: 40 / (2 * 60 * 60),
            killsPerHour: 10,
            xpPerHour: 150,
        });
        expect(toPlayerHrid("player2")).toBe("player2");
        expect(toPlayerHrid("2")).toBe("player2");
    });

    it("summarizes batch rows and baseline settings", () => {
        const soloZone = findZoneBySpawnCount(1);
        const groupZone = findZoneBySpawnCount(2);
        const labyrinthMonster = findLabyrinthMonster();
        expect(soloZone).toBeTruthy();
        expect(groupZone).toBeTruthy();
        expect(labyrinthMonster).toBeTruthy();

        const rows = summarizeBatchResults([
            {
                isLabyrinth: true,
                labyrinthName: labyrinthMonster.hrid,
                roomLevel: 80,
                simulatedTime: ONE_HOUR,
                encounters: 1,
                experienceGained: { player1: { attack: 1 } },
            },
            {
                zoneName: groupZone.hrid,
                difficultyTier: 0,
                simulatedTime: ONE_HOUR,
                encounters: 1,
                experienceGained: { player1: { attack: 1 } },
            },
            {
                zoneName: soloZone.hrid,
                difficultyTier: 0,
                simulatedTime: ONE_HOUR,
                encounters: 1,
                experienceGained: { player1: { attack: 1 } },
            },
        ], [{ id: "1", name: "One" }]);

        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.simulatedTime === ONE_HOUR)).toBe(true);
        expect(rows[2].zoneName).toBe(labyrinthMonster.hrid);
        expect(rows[2].difficulty).toBe(80);

        expect(aggregateBatchPlayerRows(rows, "player1")).toMatchObject({
            playerHrid: "player1",
            simulatedTime: ONE_HOUR,
            encountersPerHour: 3,
            totalXpPerHour: 3,
        });

        expect(
            aggregateBatchPlayerRows(
                [
                    ...rows,
                    {
                        ...rows[0],
                        rowId: "different-duration",
                        simulatedTime: 2 * ONE_HOUR,
                    },
                ],
                "player1",
            ),
        ).toBeNull();
        expect(
            aggregateBatchPlayerRows(
                rows.map(({ simulatedTime: _simulatedTime, ...row }) => row),
                "player1",
            ),
        ).toBeNull();

        expect(buildSimulationExtra({
            mooPass: false,
            comExpEnabled: false,
            comDropEnabled: true,
            comDrop: 12,
        })).toEqual({
            mooPass: false,
            comExp: 0,
            comDrop: 12,
            enableHpMpVisualization: false,
            combatScrollsEnabled: false,
        });
        expect(buildSimulationExtra({ combatScrollsEnabled: true }).combatScrollsEnabled).toBe(true);

        expect(buildQueueBaselineSettings({
            runScope: RUN_SCOPE_SINGLE,
            useDungeon: true,
            zoneHrid: "/actions/combat/zone",
            dungeonHrid: "/actions/combat/dungeon",
            difficultyTier: "4.8",
            simulationTimeHours: "7.5",
        }, {
            baselineRounds: 5,
        })).toMatchObject({
            simDungeon: true,
            zoneHrid: "/actions/combat/dungeon",
            regularZoneHrid: "/actions/combat/zone",
            dungeonHrid: "/actions/combat/dungeon",
            difficultyTier: 4,
            simulationTimeHours: 7,
            baselineRounds: 5,
        });

        expect(summarizeQueueBaselineMetrics({
            encountersPerHour: 3,
            deathsPerHour: 1,
            totalXpPerHour: 100,
            profitPerHour: 50,
        })).toMatchObject({
            killsPerHour: 3,
            xpPerHour: 100,
            dailyNoRngProfit: 1200,
        });
    });
});
