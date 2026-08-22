import { describe, expect, it, vi } from "vitest";
import CombatSimulator from "../combatSimulator.js";
import Zone from "../zone.js";
import { buildPlayersForSimulation, createEmptyPlayerConfig } from "../../services/playerMapper.js";
import { COMBAT_SCROLL_DURATION_NS, combatScrollOptions } from "../../shared/combatScrolls.js";

const ONE_NS = 1;
const MINUTE_30 = COMBAT_SCROLL_DURATION_NS;
const DAY_NS = 24 * 60 * 60 * 1e9;

function createPlayers(scrollMaps) {
    const configs = scrollMaps.map((combatScrolls, index) => ({
        ...createEmptyPlayerConfig(index + 1),
        selected: true,
        combatScrolls,
    }));
    return buildPlayersForSimulation(configs);
}

function prepareSimulator(scrollMaps, simulationTimeLimit, options = {}) {
    const players = createPlayers(scrollMaps);
    const simulator = new CombatSimulator(players, null, options.labyrinth ?? null, {
        isGuildTrial: options.isGuildTrial,
        combatScrollsEnabled: options.combatScrollsEnabled ?? true,
    });
    simulator.simulationTimeLimit = simulationTimeLimit;
    simulator.reset();
    players.forEach((player) => {
        player.zoneBuffs = [];
        player.extraBuffs = [];
        player.generatePermanentBuffs();
        player.reset(0);
    });
    simulator.activateInitialScrolls();
    return { simulator, players };
}

function usage(simulator, playerHrid, itemHrid) {
    return simulator.simResult.scrollUsage.byPlayer[playerHrid][itemHrid];
}

function totalExperience(simulator, playerHrid = "player1") {
    return Object.values(simulator.simResult.experienceGained[playerHrid] || {})
        .reduce((sum, value) => sum + Number(value || 0), 0);
}

function createTestEnemy(hrid, hitpoints, experience = 100) {
    return {
        hrid,
        experience,
        experienceRate: 0,
        enrageTime: MINUTE_30 * 2,
        combatDetails: {
            currentHitpoints: hitpoints,
        },
    };
}

function prepareEncounter(simulator, enemies, simulationTime = 0) {
    simulator.enemies = enemies;
    simulator.simulationTime = simulationTime;
    simulator.enrageBeginTime = 0;
}

describe("CombatSimulator combat scroll runtime", () => {
    it("opens at t=0 and applies an independent Buff instance per player", () => {
        const itemHrid = "/items/seal_of_attack_speed";
        const { simulator, players } = prepareSimulator([
            { [itemHrid]: { quantity: null } },
            { [itemHrid]: { quantity: null } },
        ], MINUTE_30);

        expect(players[0].combatBuffs["/buff_uniques/personal_attack_speed"]).toBeTruthy();
        expect(players[1].combatBuffs["/buff_uniques/personal_attack_speed"]).toBeTruthy();
        expect(players[0].combatBuffs["/buff_uniques/personal_attack_speed"])
            .not.toBe(players[1].combatBuffs["/buff_uniques/personal_attack_speed"]);
        expect(players[0].combatBuffs["/buff_uniques/personal_attack_speed"].startTime).toBe(0);
        expect(players[0].buffSources["/buff_uniques/personal_attack_speed"].has(`scroll:${itemHrid}`)).toBe(true);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(1);
        expect(usage(simulator, "player2", itemHrid).openedCount).toBe(1);
    });

    it("removes a scroll source even when another stronger source is active", () => {
        const itemHrid = "/items/seal_of_attack_speed";
        const { simulator, players } = prepareSimulator([
            { [itemHrid]: { quantity: 1 } },
        ], MINUTE_30);
        const player = players[0];
        const state = simulator.scrollRuntimeByPlayer.player1[itemHrid];
        const uniqueHrid = state.buffUniqueHrid;
        const otherSourceBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.99,
            flatBoost: 0,
            duration: MINUTE_30,
        };

        player.addBuff(otherSourceBuff, 0, "other-source");
        expect(player.combatBuffs[uniqueHrid].ratioBoost).toBe(otherSourceBuff.ratioBoost);
        expect(player.combatBuffs[uniqueHrid]).not.toBe(otherSourceBuff);

        simulator.closeScrollWindow(state, MINUTE_30);

        expect(player.combatBuffs[uniqueHrid].ratioBoost).toBe(otherSourceBuff.ratioBoost);
        expect(player.combatBuffs[uniqueHrid]).not.toBe(otherSourceBuff);
        expect(player.buffSources[uniqueHrid].has(`scroll:${itemHrid}`)).toBe(false);
        expect(player.buffSources[uniqueHrid].has("other-source")).toBe(true);
    });

    it.each([
        [MINUTE_30 - 1e9, 1],
        [MINUTE_30, 1],
        [MINUTE_30 + ONE_NS, 2],
    ])("uses half-open 30-minute windows at %s ns", (limit, expectedOpenings) => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator } = prepareSimulator([
            { [itemHrid]: { quantity: null } },
        ], limit);

        simulator.syncScrollsToTime(limit);
        simulator.finalizeScrollUsage(limit);

        const entry = usage(simulator, "player1", itemHrid);
        expect(entry.openedCount).toBe(expectedOpenings);
        expect(entry.activeDurationNs).toBe(limit);
        expect(entry.exhausted).toBe(false);
    });

    it("only performs a full scroll sync when the next renewal is due", async () => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator } = prepareSimulator([
            { [itemHrid]: { quantity: null } },
        ], MINUTE_30 * 2);
        simulator.checkTriggers = vi.fn();
        const syncSpy = vi.spyOn(simulator, "syncScrollsToTime");

        await simulator.processEvent({ type: "ordinaryTestEvent", time: MINUTE_30 - ONE_NS });
        expect(syncSpy).not.toHaveBeenCalled();
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(1);

        // Even if an ordinary event wins the heap tie at the exact boundary,
        // the due-time guard renews the scroll before that event is handled.
        await simulator.processEvent({ type: "ordinaryTestEvent", time: MINUTE_30 });
        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(2);
    });

    it("does not repeat the sync after the due guard exhausts a finite scroll", async () => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator } = prepareSimulator([
            { [itemHrid]: { quantity: 1 } },
        ], MINUTE_30 * 2);
        simulator.checkTriggers = vi.fn();
        const state = simulator.scrollRuntimeByPlayer.player1[itemHrid];
        const syncSpy = vi.spyOn(simulator, "syncScrollsToTime");

        await simulator.processEvent({
            type: "scrollRenewal",
            time: MINUTE_30,
            playerHrid: "player1",
            itemHrid,
            token: state.token,
        });

        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(state.active).toBe(false);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(1);
    });

    it("retains renewal synchronization when the handler is invoked directly", () => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator } = prepareSimulator([
            { [itemHrid]: { quantity: null } },
        ], MINUTE_30 * 2);
        const state = simulator.scrollRuntimeByPlayer.player1[itemHrid];
        const syncSpy = vi.spyOn(simulator, "syncScrollsToTime");

        simulator.processScrollRenewalEvent({
            type: "scrollRenewal",
            time: MINUTE_30,
            playerHrid: "player1",
            itemHrid,
            token: state.token,
        });

        expect(syncSpy).toHaveBeenCalledTimes(1);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(2);
    });

    it("renews finite inventory and stops after the configured quantity", () => {
        const itemHrid = "/items/seal_of_wisdom";
        const limit = MINUTE_30 * 4 + ONE_NS;
        const { simulator } = prepareSimulator([
            { [itemHrid]: { quantity: 2 } },
        ], limit);

        simulator.syncScrollsToTime(limit);
        simulator.finalizeScrollUsage(limit);

        expect(usage(simulator, "player1", itemHrid)).toEqual({
            configuredQuantity: 2,
            openedCount: 2,
            activeDurationNs: MINUTE_30 * 2,
            exhausted: true,
        });
    });

    it("keeps each player's inventory and effects independent", () => {
        const damage = "/items/seal_of_damage";
        const wisdom = "/items/seal_of_wisdom";
        const { simulator, players } = prepareSimulator([
            { [damage]: { quantity: 1 } },
            { [wisdom]: { quantity: 2 } },
        ], MINUTE_30 * 2);

        simulator.syncScrollsToTime(MINUTE_30);

        expect(usage(simulator, "player1", damage).openedCount).toBe(1);
        expect(usage(simulator, "player2", wisdom).openedCount).toBe(2);
        expect(players[0].combatBuffs["/buff_uniques/personal_damage"]).toBeUndefined();
        expect(players[0].combatDetails.combatStats.combatExperience).toBe(0);
        expect(players[1].combatBuffs["/buff_uniques/personal_wisdom"]).toBeTruthy();
        expect(players[1].combatDetails.combatStats.combatExperience).toBeCloseTo(0.2, 6);
    });

    it("opens 48 unlimited scrolls in a 24-hour simulation", () => {
        const itemHrid = "/items/seal_of_rare_find";
        const { simulator } = prepareSimulator([
            { [itemHrid]: { quantity: null } },
        ], DAY_NS);

        simulator.syncScrollsToTime(DAY_NS);
        simulator.finalizeScrollUsage(DAY_NS);

        expect(usage(simulator, "player1", itemHrid)).toEqual({
            configuredQuantity: null,
            openedCount: 48,
            activeDurationNs: DAY_NS,
            exhausted: false,
        });
    });

    it("retains configured scrolls but ignores them in Labyrinth and Guild Trial contexts", () => {
        const itemHrid = "/items/seal_of_damage";
        const labyrinth = {};
        const labyrinthSetup = prepareSimulator([{ [itemHrid]: { quantity: 3 } }], MINUTE_30, { labyrinth });
        const guildSetup = prepareSimulator([{ [itemHrid]: { quantity: 3 } }], MINUTE_30, { isGuildTrial: true });

        for (const { simulator } of [labyrinthSetup, guildSetup]) {
            simulator.syncScrollsToTime(MINUTE_30);
            simulator.finalizeScrollUsage(MINUTE_30);
            expect(usage(simulator, "player1", itemHrid).openedCount).toBe(0);
            expect(simulator.simResult.scrollUsage.allowed).toBe(false);
        }
        expect(labyrinthSetup.simulator.simResult.scrollUsage.ignoredReason).toBe("labyrinth");
        expect(guildSetup.simulator.simResult.scrollUsage.ignoredReason).toBe("guild_trial");
    });

    it("retains configured rows and marks the result when scroll effects are paused", () => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator, players } = prepareSimulator(
            [{ [itemHrid]: { quantity: 3 } }],
            MINUTE_30,
            { combatScrollsEnabled: false },
        );

        expect(simulator.simResult.scrollUsage.disabled).toBe(true);
        expect(usage(simulator, "player1", itemHrid)).toEqual({
            configuredQuantity: 3,
            openedCount: 0,
            activeDurationNs: 0,
            exhausted: false,
        });
        expect(players[0].combatBuffs["/buff_uniques/personal_damage"]).toBeUndefined();
    });

    it("keeps configured scroll effects disabled when the simulator option is omitted", () => {
        const itemHrid = "/items/seal_of_damage";
        const [player] = createPlayers([{ [itemHrid]: { quantity: 1 } }]);
        const simulator = new CombatSimulator([player], null, null, {});
        simulator.simulationTimeLimit = MINUTE_30;
        simulator.reset();
        player.zoneBuffs = [];
        player.extraBuffs = [];
        player.generatePermanentBuffs();
        player.reset(0);

        simulator.activateInitialScrolls();

        expect(simulator.combatScrollsEnabled).toBe(false);
        expect(simulator.simResult.scrollUsage.disabled).toBe(true);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(0);
        expect(player.combatBuffs["/buff_uniques/personal_damage"]).toBeUndefined();
    });

    it("can finalize an active window without re-attaching a missing buff", () => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator, players } = prepareSimulator(
            [{ [itemHrid]: { quantity: null } }],
            MINUTE_30,
        );
        players[0].clearBuffs();
        const restoreSpy = vi.spyOn(simulator, "restoreActiveScrollBuff");

        simulator.finalizeScrollUsage(MINUTE_30);

        expect(restoreSpy).not.toHaveBeenCalled();
        expect(usage(simulator, "player1", itemHrid).activeDurationNs).toBe(MINUTE_30);
    });

    it("restores an active window after respawn without consuming another scroll", () => {
        const itemHrid = "/items/seal_of_damage";
        const { simulator, players } = prepareSimulator([{ [itemHrid]: { quantity: 2 } }], MINUTE_30 * 2);
        const player = players[0];
        const uniqueHrid = "/buff_uniques/personal_damage";

        player.clearBuffs();
        expect(player.combatBuffs[uniqueHrid]).toBeUndefined();
        simulator.syncScrollsToTime(MINUTE_30 - ONE_NS);
        expect(player.combatBuffs[uniqueHrid]).toBeTruthy();
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(1);

        simulator.syncScrollsToTime(MINUTE_30);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(2);
    });

    it("rebuilds inventory and removes active runtime buffs when a simulator is reset", () => {
        const itemHrid = "/items/seal_of_damage";
        const uniqueHrid = "/buff_uniques/personal_damage";
        const { simulator, players } = prepareSimulator([{ [itemHrid]: { quantity: 2 } }], MINUTE_30 * 2 + ONE_NS);

        simulator.syncScrollsToTime(MINUTE_30);
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(2);
        expect(players[0].combatBuffs[uniqueHrid]).toBeTruthy();

        simulator.reset();
        expect(players[0].combatBuffs[uniqueHrid]).toBeUndefined();
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(0);
        simulator.activateInitialScrolls();
        expect(usage(simulator, "player1", itemHrid).openedCount).toBe(1);
    });

    it("keeps player regeneration stable across repeated scroll refreshes", () => {
        const itemHrid = "/items/seal_of_attack_speed";
        const { simulator, players } = prepareSimulator(
            [{ [itemHrid]: { quantity: null } }],
            MINUTE_30 * 3 + ONE_NS,
        );
        const player = players[0];
        const initialHpRegen = player.combatDetails.combatStats.hpRegenPer10;
        const initialMpRegen = player.combatDetails.combatStats.mpRegenPer10;

        simulator.syncScrollsToTime(MINUTE_30);
        simulator.syncScrollsToTime(MINUTE_30 * 2);
        simulator.syncScrollsToTime(MINUTE_30 * 3 + ONE_NS);

        expect(player.combatDetails.combatStats.hpRegenPer10).toBeCloseTo(initialHpRegen, 12);
        expect(player.combatDetails.combatStats.mpRegenPer10).toBeCloseTo(initialMpRegen, 12);
    });

    it("uses the Wisdom multiplier at each enemy death timestamp", () => {
        const itemHrid = "/items/seal_of_wisdom";
        const { simulator, players } = prepareSimulator([{ [itemHrid]: { quantity: 1 } }], MINUTE_30 * 2);
        const activeEnemy = { experience: 100, experienceRate: 1 };
        const expiredEnemy = { experience: 100, experienceRate: 1 };

        simulator.awardEnemyExperience(activeEnemy);
        simulator.syncScrollsToTime(MINUTE_30);
        simulator.awardEnemyExperience(expiredEnemy);
        simulator.commitPendingExperience();

        const experience = totalExperience(simulator);
        const baseline = createPlayers([{}])[0];
        baseline.zoneBuffs = [];
        baseline.extraBuffs = [];
        baseline.generatePermanentBuffs();
        baseline.reset(0);
        const baselineSimulator = new CombatSimulator([baseline], null, null, {});
        baselineSimulator.simulationTimeLimit = MINUTE_30;
        baselineSimulator.reset();
        baselineSimulator.awardEnemyExperience({ experience: 100, experienceRate: 1 });
        baselineSimulator.commitPendingExperience();
        const baselineExperience = totalExperience(baselineSimulator);

        expect(experience).toBeGreaterThan(baselineExperience * 2);
        expect(experience).toBeLessThan(baselineExperience * 2.5);
        expect(players[0].combatDetails.combatStats.combatExperience).toBe(0);
    });

    it("keeps the recorded death time when encounter cleanup is delayed", () => {
        const itemHrid = "/items/seal_of_wisdom";
        const { simulator } = prepareSimulator([{ [itemHrid]: { quantity: 1 } }], MINUTE_30 * 2);
        const firstEnemy = createTestEnemy("/monsters/first_delayed", 0);
        const secondEnemy = createTestEnemy("/monsters/second_delayed", 100);
        prepareEncounter(simulator, [firstEnemy, secondEnemy], 5_000_000_000);

        // Record the death while Wisdom is active, then deliberately move the
        // clock past expiration before running the encounter-end check.
        simulator.recordUnitDeath(firstEnemy);
        simulator.simulationTime = MINUTE_30;
        simulator.syncScrollsToTime(MINUTE_30);

        expect(simulator.checkEncounterEnd()).toBe(false);
        const firstSnapshot = simulator.enemyDeathSnapshots.get(firstEnemy);
        expect(firstSnapshot.deathTime).toBe(5_000_000_000);
        expect(firstSnapshot.experienceRate)
            .toBeCloseTo(1 + 5_000_000_000 / firstEnemy.enrageTime, 10);

        secondEnemy.combatDetails.currentHitpoints = 0;
        expect(simulator.checkEncounterEnd()).toBe(true);
        const secondSnapshot = simulator.enemyDeathSnapshots.get(secondEnemy);
        const firstGain = Object.values(firstSnapshot.gainsByPlayer.player1)
            .reduce((sum, value) => sum + value, 0);
        const secondGain = Object.values(secondSnapshot.gainsByPlayer.player1)
            .reduce((sum, value) => sum + value, 0);
        expect(firstGain / firstSnapshot.experienceRate)
            .toBeGreaterThan(secondGain / secondSnapshot.experienceRate);
    });

    it.each([0, Number.NaN])(
        "allows experience to be awarded after invalid enemy rate %s is corrected",
        (initialRate) => {
            const { simulator } = prepareSimulator([{}], MINUTE_30);
            const enemy = { experience: 100, experienceRate: initialRate };

            simulator.awardEnemyExperience(enemy);
            expect(simulator.experienceAwardedEnemies.has(enemy)).toBe(false);
            expect(simulator.pendingExperienceGains.size).toBe(0);

            enemy.experienceRate = 1;
            simulator.awardEnemyExperience(enemy);
            expect(simulator.experienceAwardedEnemies.has(enemy)).toBe(true);
            simulator.commitPendingExperience();
            const awardedExperience = totalExperience(simulator);
            expect(awardedExperience).toBeGreaterThan(0);

            simulator.awardEnemyExperience(enemy);
            simulator.commitPendingExperience();
            expect(totalExperience(simulator)).toBe(awardedExperience);
        }
    );

    it("recalculates a dead enemy whose existing experience rate is NaN", () => {
        const { simulator } = prepareSimulator([{}], MINUTE_30);
        const enemy = createTestEnemy("/monsters/nan_rate", 0);
        enemy.experienceRate = Number.NaN;
        prepareEncounter(simulator, [enemy], MINUTE_30);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        let encounterEnded;

        try {
            encounterEnded = simulator.checkEncounterEnd();
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }

        expect(encounterEnded).toBe(true);
        expect(simulator.enemyDeathSnapshots.get(enemy).experienceRate).toBeCloseTo(1.5, 10);
        expect(enemy.experienceRate).toBeNaN();
        expect(simulator.experienceAwardedEnemies.has(enemy)).toBe(true);
        expect(totalExperience(simulator)).toBeGreaterThan(0);
    });

    it.each([
        ["zero", 0],
        ["missing", undefined],
        ["NaN", Number.NaN],
    ])("uses base experience and warns once for %s enrage time", (_label, enrageTime) => {
        const { simulator } = prepareSimulator([{}], MINUTE_30);
        const enemies = [
            createTestEnemy("/monsters/invalid_enrage", 0),
            createTestEnemy("/monsters/invalid_enrage", 0),
        ];
        enemies.forEach((enemy) => {
            enemy.enrageTime = enrageTime;
        });
        prepareEncounter(simulator, enemies, MINUTE_30);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        let encounterEnded;

        try {
            encounterEnded = simulator.checkEncounterEnd();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toContain("/monsters/invalid_enrage");
            expect(warnSpy.mock.calls[0][0]).toContain("using 1.0");
        } finally {
            warnSpy.mockRestore();
        }

        expect(encounterEnded).toBe(true);
        expect(enemies.every((enemy) => simulator.enemyDeathSnapshots.get(enemy).experienceRate === 1)).toBe(true);
        expect(enemies.every((enemy) => simulator.experienceAwardedEnemies.has(enemy))).toBe(true);
        expect(totalExperience(simulator)).toBeGreaterThan(0);
    });

    it("keeps a partial encounter's experience pending until every monster dies", () => {
        const { simulator } = prepareSimulator([{}], MINUTE_30);
        const deadEnemy = createTestEnemy("/monsters/dead", 0);
        const livingEnemy = createTestEnemy("/monsters/living", 100);

        prepareEncounter(simulator, [deadEnemy, livingEnemy]);
        expect(simulator.checkEncounterEnd()).toBe(false);

        expect(totalExperience(simulator)).toBe(0);
        expect(simulator.pendingExperienceGains.size).toBe(1);

        livingEnemy.combatDetails.currentHitpoints = 0;
        expect(simulator.checkEncounterEnd()).toBe(true);

        expect(totalExperience(simulator)).toBeGreaterThan(0);
        expect(simulator.pendingExperienceGains.size).toBe(0);
    });

    it("matches the legacy aggregate experience for an unbuffed cleared encounter", () => {
        const { simulator } = prepareSimulator([{}], MINUTE_30);
        const enemies = [
            createTestEnemy("/monsters/one", 0, 100),
            createTestEnemy("/monsters/two", 0, 150),
        ];
        prepareEncounter(simulator, enemies);
        simulator.checkEncounterEnd();

        const expectedSetup = prepareSimulator([{}], MINUTE_30);
        expectedSetup.simulator.simResult.addExperienceGain(expectedSetup.players[0], 250);

        expect(totalExperience(simulator)).toBeCloseTo(totalExperience(expectedSetup.simulator), 10);
    });

    it("discards killed-monster experience when a dungeon encounter wipes", () => {
        const dungeon = {
            isDungeon: true,
            encountersKilled: 1,
            dungeonSpawnInfo: { maxWaves: 10 },
        };
        const [player] = createPlayers([{}]);
        const simulator = new CombatSimulator([player], dungeon, null, {});
        simulator.simulationTimeLimit = MINUTE_30;
        simulator.reset();
        player.zoneBuffs = [];
        player.extraBuffs = [];
        player.generatePermanentBuffs();
        player.reset(0);
        simulator.simulationTime = 0;
        simulator.enrageBeginTime = 0;
        simulator.enemies = [
            createTestEnemy("/monsters/killed_before_wipe", 0),
            createTestEnemy("/monsters/survivor", 100),
        ];
        player.combatDetails.currentHitpoints = 0;

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        let encounterEnded;
        try {
            encounterEnded = simulator.checkEncounterEnd();
        } finally {
            logSpy.mockRestore();
        }

        expect(encounterEnded).toBe(true);
        expect(totalExperience(simulator)).toBe(0);
        expect(simulator.pendingExperienceGains.size).toBe(0);
    });

    it("uses each monster's death-time Wisdom state before committing a cleared encounter", () => {
        const itemHrid = "/items/seal_of_wisdom";
        const { simulator } = prepareSimulator([{ [itemHrid]: { quantity: 1 } }], MINUTE_30 * 2);
        const firstEnemy = createTestEnemy("/monsters/first", 0);
        const secondEnemy = createTestEnemy("/monsters/second", 100);
        prepareEncounter(simulator, [firstEnemy, secondEnemy]);

        simulator.checkEncounterEnd();
        expect(totalExperience(simulator)).toBe(0);

        simulator.simulationTime = MINUTE_30;
        simulator.syncScrollsToTime(MINUTE_30);
        secondEnemy.combatDetails.currentHitpoints = 0;
        simulator.checkEncounterEnd();

        expect(totalExperience(simulator)).toBeGreaterThan(0);
        expect(simulator.simResult.encounters).toBe(1);
        expect(simulator.pendingExperienceGains.size).toBe(0);
    });

    it("records drop contexts at each monster death before and after expiration", () => {
        const itemHrid = "/items/seal_of_combat_drop";
        const monsterHrid = "/monsters/abyssal_imp";
        const { simulator } = prepareSimulator([{ [itemHrid]: { quantity: 1 } }], MINUTE_30 * 2);

        simulator.recordUnitDeath({ isPlayer: false, hrid: monsterHrid });
        simulator.syncScrollsToTime(MINUTE_30);
        simulator.recordUnitDeath({ isPlayer: false, hrid: monsterHrid });

        expect(simulator.simResult.deaths[monsterHrid]).toBe(2);
        expect(simulator.simResult.dropContextBuckets.player1[monsterHrid]).toEqual([
            expect.objectContaining({ killCount: 1, combatDropQuantity: 0.15 }),
            expect.objectContaining({ killCount: 1, combatDropQuantity: 0 }),
        ]);
    });

    it("keeps the combat catalog limited to the seven official options", () => {
        expect(combatScrollOptions).toHaveLength(7);
    });

    it("integrates scroll windows with a real zone simulation and kill-time buckets", async () => {
        const itemHrid = "/items/seal_of_combat_drop";
        const [player] = createPlayers([{ [itemHrid]: { quantity: 2 } }]);
        const zone = new Zone("/actions/combat/jungle_planet", 0);
        player.zoneBuffs = zone.buffs || [];
        player.extraBuffs = [];
        const simulator = new CombatSimulator([player], zone, null, { combatScrollsEnabled: true });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        let result;
        try {
            result = await simulator.simulate(MINUTE_30 + ONE_NS);
        } finally {
            logSpy.mockRestore();
        }

        expect(result.simulatedTime).toBe(MINUTE_30 + ONE_NS);
        expect(result.scrollUsage.byPlayer.player1[itemHrid].openedCount).toBe(2);
        expect(result.dropContextBuckets).toEqual(expect.any(Object));
        expect(simulator.eventQueue.minHeap.toArray()
            .filter((event) => event.type === "scrollRenewal")).toHaveLength(0);
    });
});
