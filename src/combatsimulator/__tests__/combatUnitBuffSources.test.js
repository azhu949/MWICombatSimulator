import { describe, expect, it, vi } from "vitest";
import Buff from "../buff.js";
import CombatSimulator from "../combatSimulator.js";
import CombatUnit, { buffsAffectStatsEqually } from "../combatUnit.js";
import abilityDetailMap from "../data/abilityDetailMap.json";
import Player from "../player.js";
import Zone from "../zone.js";
import { BUFF_SOURCE_POLICY, PARTY_AURA_STRENGTH_FIELDS } from "../buffSourcePolicy.js";
import { buildPlayersForSimulation, createEmptyPlayerConfig, isPartyAuraBuff } from "../../services/playerMapper.js";

const MINUTE = 60e9;
const SPEED_AURA_ATTACK_SPEED_HRID = "/buff_uniques/speed_aura_attack_speed";

function emptyConfig(id) {
    return { ...createEmptyPlayerConfig(String(id)), selected: true };
}

function withAura(config, abilityHrid, level = 1) {
    return {
        ...config,
        abilities: [{ abilityHrid, level }, ...config.abilities.slice(1)],
    };
}

function addStrongestBuff(unit, buff, currentTime, sourceHrid) {
    unit.addBuff(buff, currentTime, sourceHrid, {
        sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
    });
}

async function runSimulation(players, durationNs = MINUTE) {
    const zone = new Zone("/actions/combat/sorcerers_tower", 0);
    const simulator = new CombatSimulator(players, zone, null, { enableHpMpVisualization: false });
    for (const player of players) {
        player.zoneBuffs = [];
        player.extraBuffs = [];
        player.generatePermanentBuffs();
    }
    await simulator.simulate(durationNs);
    return simulator;
}

describe("CombatUnit buff sources and party aura engine", () => {
    it("compares buffs by identity and effective stat values", () => {
        const baseBuff = {
            uniqueHrid: "/buff_uniques/comparison",
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0.02,
        };

        expect(
            buffsAffectStatsEqually(baseBuff, {
                ...baseBuff,
                startTime: 100,
                duration: 50,
            }),
        ).toBe(true);
        expect(
            buffsAffectStatsEqually(baseBuff, {
                ...baseBuff,
                uniqueHrid: "/buff_uniques/other",
            }),
        ).toBe(false);
        expect(
            buffsAffectStatsEqually(baseBuff, {
                ...baseBuff,
                typeHrid: "/buff_types/defense",
            }),
        ).toBe(false);
        expect(
            buffsAffectStatsEqually(baseBuff, {
                ...baseBuff,
                ratioBoost: 0.2,
            }),
        ).toBe(false);
        expect(
            buffsAffectStatsEqually(baseBuff, {
                ...baseBuff,
                flatBoost: 0.03,
            }),
        ).toBe(false);
        expect(buffsAffectStatsEqually(null, baseBuff)).toBe(false);
    });

    it("keeps derived combat stats stable across repeated recalculation", () => {
        const unit = new CombatUnit();
        unit.isPlayer = true;
        const uniqueHrid = "/buff_uniques/recalculation_stability";

        unit.addBuff(
            {
                uniqueHrid,
                typeHrid: "/buff_types/physical_amplify",
                ratioBoost: 0,
                flatBoost: 0.1,
                duration: 100e9,
            },
            0,
        );

        const first = {
            physicalAmplify: unit.combatDetails.combatStats.physicalAmplify,
            attackInterval: unit.combatDetails.combatStats.attackInterval,
            threat: unit.combatDetails.combatStats.threat,
            hpRegenPer10: unit.combatDetails.combatStats.hpRegenPer10,
            mpRegenPer10: unit.combatDetails.combatStats.mpRegenPer10,
        };

        unit.updateCombatDetails();

        expect(unit.combatDetails.combatStats.physicalAmplify).toBe(first.physicalAmplify);
        expect(unit.combatDetails.combatStats.attackInterval).toBe(first.attackInterval);
        expect(unit.combatDetails.combatStats.threat).toBe(first.threat);
        expect(unit.combatDetails.combatStats.hpRegenPer10).toBe(first.hpRegenPer10);
        expect(unit.combatDetails.combatStats.mpRegenPer10).toBe(first.mpRegenPer10);
    });

    it("recomputes derived stats after an expired legacy buff is removed", () => {
        const unit = new CombatUnit();
        const uniqueHrid = "/buff_uniques/legacy_physical_amplify";

        unit.combatBuffs[uniqueHrid] = {
            uniqueHrid,
            typeHrid: "/buff_types/physical_amplify",
            ratioBoost: 0,
            flatBoost: 0.1,
            startTime: 0,
            duration: 1,
        };
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.physicalAmplify).toBeCloseTo(0.1, 10);

        unit.removeExpiredBuffs(1);

        expect(unit.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(unit.combatDetails.combatStats.physicalAmplify).toBeCloseTo(0, 10);
    });

    it("recognizes only official party aura buffs as party auras", () => {
        const partyAuraAbilityHrids = [
            "/abilities/speed_aura",
            "/abilities/guardian_aura",
            "/abilities/fierce_aura",
            "/abilities/critical_aura",
            "/abilities/mystic_aura",
        ];
        const officialPartyAuraBuffs = partyAuraAbilityHrids.flatMap((abilityHrid) =>
            (abilityDetailMap[abilityHrid]?.abilityEffects ?? [])
                .filter(
                    (effect) =>
                        effect?.effectType === "/ability_effect_types/buff" && effect?.targetType === "allAllies",
                )
                .flatMap((effect) => effect.buffs ?? []),
        );
        const officialPartyAuraBuffHrids = officialPartyAuraBuffs.map((buff) => buff.uniqueHrid);

        expect(officialPartyAuraBuffHrids).toHaveLength(14);
        expect(Object.keys(PARTY_AURA_STRENGTH_FIELDS).sort()).toEqual([...officialPartyAuraBuffHrids].sort());
        for (const uniqueHrid of officialPartyAuraBuffHrids) {
            expect(isPartyAuraBuff({ uniqueHrid })).toBe(true);
        }
        for (const buff of officialPartyAuraBuffs) {
            const strengthField = PARTY_AURA_STRENGTH_FIELDS[buff.uniqueHrid];
            const secondaryField = strengthField === "ratioBoost" ? "flatBoost" : "ratioBoost";
            expect(buff[strengthField]).toBeGreaterThanOrEqual(0);
            expect(buff[`${strengthField}LevelBonus`]).toBeGreaterThanOrEqual(0);
            expect(buff[secondaryField]).toBe(0);
            expect(buff[`${secondaryField}LevelBonus`]).toBe(0);
        }

        expect(isPartyAuraBuff({ uniqueHrid: "/buff_uniques/fierce_aura_regen" })).toBe(false);
        expect(isPartyAuraBuff({ uniqueHrid: "/buff_uniques/not_a_party_aura" })).toBe(false);
    });

    it("grants the hero speed_aura when a teammate casts it (allAllies)", async () => {
        const players = buildPlayersForSimulation([
            emptyConfig("1"),
            withAura(emptyConfig("2"), "/abilities/speed_aura"),
        ]);
        const hero = players[0];
        const teammate = players[1];

        await runSimulation(players);

        expect(teammate.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(hero.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(hero.combatBuffs["/buff_uniques/speed_aura_cast_speed"]).toBeTruthy();
        // The aura significantly shortens the attack interval (base: 3 seconds).
        expect(hero.combatDetails.combatStats.attackInterval).toBeLessThan(2_970_000_000);
        // The teammate actually spent MP to cast the ability.
        expect(teammate.combatDetails.currentManapoints).toBeLessThan(teammate.combatDetails.maxManapoints);
    });

    it("activates only the strongest source for the same aura (no stacking or weak-source override)", async () => {
        const strongConfig = withAura(emptyConfig("1"), "/abilities/speed_aura");
        strongConfig.levels = { ...strongConfig.levels, attack: 800 };
        const weakConfig = withAura(emptyConfig("2"), "/abilities/speed_aura");
        weakConfig.levels = { ...weakConfig.levels, attack: 1 };

        const players = buildPlayersForSimulation([strongConfig, weakConfig]);
        const strong = players[0];
        const weak = players[1];

        await runSimulation(players);

        const strongRatio = 0.03 * (1 + 800 * 0.005); // Attack level 800 -> 5.0x -> 0.15
        const weakRatio = 0.03 * (1 + 1 * 0.005); // Attack level 1 -> 1.005x -> 0.03015
        // Both players retain the stronger version.
        expect(strong.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(strongRatio, 10);
        expect(weak.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(strongRatio, 10);
        expect(strong.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).not.toBeCloseTo(weakRatio, 10);
    });

    it("keeps the first registered source when equal buffs are tied", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const equalBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 1_000e9,
        };

        addStrongestBuff(hero, equalBuff, 0, "first");
        addStrongestBuff(hero, { ...equalBuff }, 0, "second");

        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("first");

        // Refreshing an existing Map key does not change its insertion order,
        // so a later equal registration still uses the same deterministic tie.
        addStrongestBuff(hero, { ...equalBuff }, 1, "second");
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("first");
    });

    it("hands off to the next-strongest source when the strongest source expires (official handoff rule)", () => {
        const hero = new Player();
        hero.attackLevel = 1;
        hero.updateCombatDetails();

        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const weakBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.03,
            ratioBoostLevelBonus: 0,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            startTime: 0,
            duration: 1_000e9, // Weak source lasts 1000 seconds.
        };
        const strongBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            ratioBoostLevelBonus: 0,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            startTime: 0,
            duration: 100e9, // Strong source lasts only 100 seconds.
        };

        addStrongestBuff(hero, weakBuff, 0, "hero");
        addStrongestBuff(hero, strongBuff, 0, "mate");

        // Strong source is active.
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.15, 10);

        // Strong source expires (t=101s); the weak source takes over.
        hero.removeExpiredBuffs(101e9);
        expect(hero.combatBuffs[uniqueHrid]).toBeTruthy();
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03, 10);

        // The weak source also expires; the buff is fully removed.
        hero.removeExpiredBuffs(1001e9);
        expect(hero.combatBuffs[uniqueHrid]).toBeFalsy();
    });

    it("hands off to the next-strongest source when the strongest source is manually removed", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const weakBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.03,
            flatBoost: 0,
            duration: 1_000e9,
        };
        const strongBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            flatBoost: 0,
            duration: 1_000e9,
        };

        addStrongestBuff(hero, weakBuff, 0, "hero");
        addStrongestBuff(hero, strongBuff, 0, "mate");
        hero.removeBuff({ uniqueHrid }, "mate");

        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(weakBuff.ratioBoost);
        expect(hero.combatBuffs[uniqueHrid]).not.toBe(weakBuff);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("hero");
        expect(hero.buffSources[uniqueHrid].has("mate")).toBe(false);
        expect(hero.buffSources[uniqueHrid].has("hero")).toBe(true);
    });

    it("does not affect the current strongest source when the weak source is manually removed", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const weakBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.03,
            flatBoost: 0,
            duration: 1_000e9,
        };
        const strongBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            flatBoost: 0,
            duration: 1_000e9,
        };

        addStrongestBuff(hero, weakBuff, 0, "hero");
        addStrongestBuff(hero, strongBuff, 0, "mate");
        hero.removeBuff({ uniqueHrid }, "hero");

        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(strongBuff.ratioBoost);
        expect(hero.combatBuffs[uniqueHrid]).not.toBe(strongBuff);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("mate");
        expect(hero.buffSources[uniqueHrid].has("hero")).toBe(false);
    });

    it("reselects a remaining source when the same source is refreshed with a weaker buff", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const strongBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            flatBoost: 0,
            duration: 1_000e9,
        };
        const weakBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.03,
            flatBoost: 0,
            duration: 1_000e9,
        };
        const fallbackBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.08,
            flatBoost: 0,
            duration: 1_000e9,
        };

        addStrongestBuff(hero, strongBuff, 0, "hero");
        addStrongestBuff(hero, fallbackBuff, 0, "mate");
        addStrongestBuff(hero, weakBuff, 1, "hero");

        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(fallbackBuff.ratioBoost);
        expect(hero.combatBuffs[uniqueHrid]).not.toBe(fallbackBuff);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("mate");
    });

    it("hands off to a re-registered same-key source after the fallback source expires", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const initialStrongBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            flatBoost: 0,
            duration: 100e9,
        };
        const fallbackBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.08,
            flatBoost: 0,
            duration: 1_000e9,
        };
        const refreshedWeakBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.03,
            flatBoost: 0,
            duration: 2_000e9,
        };

        addStrongestBuff(hero, initialStrongBuff, 0, "hero");
        addStrongestBuff(hero, fallbackBuff, 0, "mate");

        // Re-registering the same "hero" source key overwrites the strong
        // registration. The overwritten buff must never resurface.
        addStrongestBuff(hero, refreshedWeakBuff, 1, "hero");

        // The fallback is strongest among the surviving sources.
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("mate");
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.08);

        // The fallback "mate" source expires; handoff goes to the re-registered
        // "hero" source (weak buff), not the overwritten strong registration.
        hero.removeExpiredBuffs(1_000e9);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("hero");
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);

        // The re-registered source expires; the buff is fully removed.
        hero.removeExpiredBuffs(2_002e9);
        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBeUndefined();
    });

    it("removes fury-style distinct buff objects by their exact source", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/fury_accuracy";
        const addedBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/fury_accuracy",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 15e9,
        };
        const removalBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/fury_accuracy",
            ratioBoost: 0,
            flatBoost: 0,
            duration: 15e9,
        };

        hero.addBuff(addedBuff, 0, "player1");
        hero.removeBuff(removalBuff, "player1");

        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(hero.buffSources[uniqueHrid]).toBeUndefined();
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBeUndefined();
    });

    it("removes a single strongest source by uniqueHrid without a buff instance and hands off", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const buff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 1_000e9,
        };

        addStrongestBuff(hero, buff, 0, "attacker-a");
        addStrongestBuff(hero, { ...buff, ratioBoost: 0.2 }, 0, "attacker-b");
        expect(hero.buffSources[uniqueHrid].size).toBe(2);

        // Removes only the requested source; the strongest remaining one takes over.
        hero.removeBuffByUniqueHrid(uniqueHrid, "attacker-a");
        expect(hero.buffSources[uniqueHrid].size).toBe(1);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("attacker-b");
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.2);

        // Removing the last source clears the buff entirely.
        hero.removeBuffByUniqueHrid(uniqueHrid, "attacker-b");
        expect(hero.buffSources[uniqueHrid]).toBeUndefined();
        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBeUndefined();
    });

    it("rejects registration when currentTime is missing", () => {
        const hero = new Player();
        const buff = {
            uniqueHrid: "/buff_uniques/missing_time",
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 1_000e9,
        };

        expect(() => hero.addBuff(buff, undefined, "source")).toThrow(TypeError);
        expect(hero.buffSources[buff.uniqueHrid]).toBeUndefined();
        expect(hero.combatBuffs[buff.uniqueHrid]).toBeUndefined();
    });

    it.each([null, "replace", 1, true, []])("rejects non-object addBuff options: %p", (options) => {
        const hero = new Player();
        const buff = {
            uniqueHrid: "/buff_uniques/invalid_options",
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 1_000e9,
        };

        expect(() => hero.addBuff(buff, 0, "source", options)).toThrow(TypeError);
        expect(hero.buffSources[buff.uniqueHrid]).toBeUndefined();
        expect(hero.combatBuffs[buff.uniqueHrid]).toBeUndefined();
    });

    it.each([
        ["uniqueHrid", "missing", undefined],
        ["uniqueHrid", "empty", ""],
        ["uniqueHrid", "blank", "   "],
        ["uniqueHrid", "not a string", 123],
        ["typeHrid", "missing", undefined],
        ["typeHrid", "empty", ""],
        ["typeHrid", "blank", "   "],
        ["typeHrid", "not a string", 123],
    ])("rejects registration when %s is %s", (fieldName, _label, invalidValue) => {
        const hero = new Player();
        const buff = {
            uniqueHrid: "/buff_uniques/invalid_hrid",
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 1_000e9,
            [fieldName]: invalidValue,
        };

        expect(() => hero.addBuff(buff, 0, "source")).toThrow(TypeError);
        expect(hero.combatBuffs).toEqual({});
        expect(hero.buffSources).toEqual({});
        expect(hero.activeBuffSourceKeys).toEqual({});
        expect(hero.buffSourcePolicies).toEqual({});
    });

    it("rejects strongest-source ordering outside the verified official aura shape", () => {
        const hero = new Player();
        const baseBuff = {
            uniqueHrid: SPEED_AURA_ATTACK_SPEED_HRID,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 1_000e9,
        };

        expect(() =>
            addStrongestBuff(
                hero,
                {
                    ...baseBuff,
                    uniqueHrid: "/buff_uniques/weaken",
                    ratioBoost: -0.1,
                },
                0,
                "unsupported",
            ),
        ).toThrow(/unsupported/);
        expect(() =>
            addStrongestBuff(
                hero,
                {
                    ...baseBuff,
                    ratioBoost: -0.1,
                },
                0,
                "negative",
            ),
        ).toThrow(/strength shape changed/);
        expect(() =>
            addStrongestBuff(
                hero,
                {
                    ...baseBuff,
                    flatBoost: 0.01,
                },
                0,
                "mixed",
            ),
        ).toThrow(/strength shape changed/);

        expect(hero.buffSources[SPEED_AURA_ATTACK_SPEED_HRID]).toBeUndefined();
        expect(hero.combatBuffs[SPEED_AURA_ATTACK_SPEED_HRID]).toBeUndefined();
    });

    it("accepts valid zero boost values but rejects missing or invalid boost fields", () => {
        const hero = new Player();
        const zeroBuff = {
            uniqueHrid: "/buff_uniques/zero_boost",
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0,
            flatBoost: 0,
            duration: 1_000e9,
        };

        expect(() => hero.addBuff(zeroBuff, 0, "zero-source")).not.toThrow();
        expect(hero.combatBuffs[zeroBuff.uniqueHrid].ratioBoost).toBe(0);
        expect(hero.combatBuffs[zeroBuff.uniqueHrid].flatBoost).toBe(0);

        const missingRatioBuff = {
            ...zeroBuff,
            uniqueHrid: "/buff_uniques/missing_ratio_boost",
        };
        delete missingRatioBuff.ratioBoost;
        expect(() => hero.addBuff(missingRatioBuff, 0, "missing-ratio")).toThrow(TypeError);

        const invalidFlatBuff = {
            ...zeroBuff,
            uniqueHrid: "/buff_uniques/invalid_flat_boost",
            flatBoost: Number.NaN,
        };
        expect(() => hero.addBuff(invalidFlatBuff, 0, "invalid-flat")).toThrow(TypeError);
        expect(hero.buffSources[missingRatioBuff.uniqueHrid]).toBeUndefined();
        expect(hero.buffSources[invalidFlatBuff.uniqueHrid]).toBeUndefined();
    });

    it.each([
        ["missing", undefined],
        ["a numeric string", "100000000000"],
        ["NaN", Number.NaN],
        ["infinity", Number.POSITIVE_INFINITY],
    ])("rejects registration when duration is %s", (_label, duration) => {
        const hero = new Player();
        const uniqueHrid = `/buff_uniques/invalid_duration_${_label.replaceAll(" ", "_")}`;
        const buff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
        };
        if (duration !== undefined) {
            buff.duration = duration;
        }

        expect(() => hero.addBuff(buff, 0, "source")).toThrow(TypeError);
        expect(hero.buffSources[uniqueHrid]).toBeUndefined();
        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
    });

    it("accepts a finite zero duration without coercion", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/zero_duration";
        const buff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 0,
        };

        expect(() => hero.addBuff(buff, 10, "source")).not.toThrow();
        expect(hero.buffSources[uniqueHrid].get("source").expiresAt).toBe(10);
    });

    it("isolates startTime and expiration time when the same buff object is registered by multiple sources", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/shared_registration";
        const sharedBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 100e9,
        };

        hero.addBuff(sharedBuff, 0, "sourceA");
        hero.addBuff(sharedBuff, 10, "sourceB");
        sharedBuff.startTime = 999;

        const sourceA = hero.buffSources[uniqueHrid].get("sourceA");
        const sourceB = hero.buffSources[uniqueHrid].get("sourceB");
        expect(sourceA.buff).not.toBe(sharedBuff);
        expect(sourceB.buff).not.toBe(sharedBuff);
        expect(sourceA.buff).not.toBe(sourceB.buff);
        expect(sourceA.buff.startTime).toBe(0);
        expect(sourceB.buff.startTime).toBe(10);
        expect(sourceA.expiresAt).toBe(100e9);
        expect(sourceB.expiresAt).toBe(100e9 + 10);

        hero.removeExpiredBuffs(100e9);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("sourceB");
        expect(hero.combatBuffs[uniqueHrid].startTime).toBe(10);
    });

    it("does not overwrite startTime when the same buff object is registered on different units", () => {
        const firstUnit = new Player();
        const secondUnit = new Player();
        const uniqueHrid = "/buff_uniques/shared_unit_registration";
        const sharedBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 100e9,
        };

        firstUnit.addBuff(sharedBuff, 0, "first");
        secondUnit.addBuff(sharedBuff, 10, "second");
        sharedBuff.startTime = 999;

        expect(firstUnit.combatBuffs[uniqueHrid].startTime).toBe(0);
        expect(secondUnit.combatBuffs[uniqueHrid].startTime).toBe(10);
        expect(firstUnit.combatBuffs[uniqueHrid]).not.toBe(secondUnit.combatBuffs[uniqueHrid]);
    });

    it("keeps ordinary last-write selection O(1) for a new source", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/ordinary_hot_path";

        hero.addBuff(
            {
                uniqueHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 100e9,
            },
            0,
            "source-a",
        );

        // A second ordinary registration is already known to be the active
        // last write. Make a full Map scan fail so this test locks the O(1)
        // source-key lookup instead of an implementation-detail argument.
        hero.buffSources[uniqueHrid].entries = () => {
            throw new Error("ordinary addBuff scanned every source");
        };
        hero.addBuff(
            {
                uniqueHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.2,
                flatBoost: 0,
                duration: 100e9,
            },
            1,
            "source-b",
        );

        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("source-b");
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.2);
    });

    it("does not hand off an overwritten ordinary buff when the active source expires", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/registered_expiration";
        const shortBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            flatBoost: 0,
            duration: 100e9,
        };
        const longBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.03,
            flatBoost: 0,
            duration: 1_000e9,
        };

        hero.addBuff(longBuff, 0, "weak");
        hero.addBuff(shortBuff, 0, "strong");
        hero.removeExpiredBuffs(101e9);

        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(hero.buffSources[uniqueHrid]).toBeUndefined();
    });

    it("recalculates combat details only once when batch-expiring multiple source-based buffs", () => {
        const hero = new Player();
        const firstUniqueHrid = "/buff_uniques/batch_expiration_first";
        const secondUniqueHrid = "/buff_uniques/batch_expiration_second";
        const createBuff = (uniqueHrid) => ({
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 100e9,
        });

        hero.addBuff(createBuff(firstUniqueHrid), 0, "source-a");
        hero.addBuff(createBuff(secondUniqueHrid), 0, "source-b");
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        hero.removeExpiredBuffs(101e9);

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(hero.combatBuffs[firstUniqueHrid]).toBeUndefined();
        expect(hero.combatBuffs[secondUniqueHrid]).toBeUndefined();
    });

    it("does not treat rebuilt permanent buffs as timed source buffs", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/permanent_expiration_boundary";
        const typeHrid = "/buff_types/attack_speed";
        hero.permanentBuffs[typeHrid] = {
            uniqueHrid,
            typeHrid,
            ratioBoost: 0.05,
            flatBoost: 0,
            startTime: null,
            duration: 0,
        };
        hero.clearBuffs();
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        const detailsDirty = hero.removeExpiredBuffs(101e9);

        expect(detailsDirty).toBe(false);
        expect(updateSpy).not.toHaveBeenCalled();
        expect(hero.combatBuffs[typeHrid]?.uniqueHrid).toBe(uniqueHrid);
        expect(hero.buffSources[uniqueHrid]).toBeUndefined();
    });

    it("expires legacy unregistered runtime buffs", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/legacy_runtime_expiration";
        hero.combatBuffs[uniqueHrid] = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            startTime: 0,
            duration: 100e9,
        };
        hero.updateCombatDetails();

        hero.removeExpiredBuffs(101e9);

        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
    });

    it("does not recalculate combat details when no buff has expired", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/no_expiration_change";

        hero.addBuff(
            {
                uniqueHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 100e9,
            },
            0,
            "source",
        );
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        hero.removeExpiredBuffs(99e9);

        expect(updateSpy).not.toHaveBeenCalled();
    });

    it("skips updateCombatDetails when the active source refreshes with identical values", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/identical_refresh";
        const buff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 100e9,
        };

        hero.addBuff(buff, 0, "source");
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        // Same source, same stat-affecting values (fresh object): the combat
        // ratings cannot change, so the full recompute must be skipped.
        hero.addBuff({ ...buff }, 1, "source");

        expect(updateSpy).not.toHaveBeenCalled();
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("source");
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.1);
    });

    it("compares leveled buffs by their precomputed effective boosts", () => {
        const hero = new Player();
        const definition = {
            uniqueHrid: "/buff_uniques/leveled_refresh",
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            ratioBoostLevelBonus: 0.02,
            flatBoost: 0.01,
            flatBoostLevelBonus: 0.03,
            duration: 100e9,
        };

        hero.addBuff(new Buff(definition, 3), 0, "source");
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");
        hero.addBuff(new Buff(definition, 3), 1, "source");

        expect(updateSpy).not.toHaveBeenCalled();
        expect(hero.combatBuffs[definition.uniqueHrid].ratioBoost).toBeCloseTo(0.14, 12);
        expect(hero.combatBuffs[definition.uniqueHrid].flatBoost).toBeCloseTo(0.07, 12);
    });

    it("recomputes when the active source refreshes with different values", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/different_refresh";
        const buff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.1,
            flatBoost: 0,
            duration: 100e9,
        };

        hero.addBuff(buff, 0, "source");
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        hero.addBuff({ ...buff, ratioBoost: 0.2 }, 1, "source");

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.2);
    });

    it("does not recompute when only a non-active source expires", () => {
        const hero = new Player();
        const uniqueHrid = SPEED_AURA_ATTACK_SPEED_HRID;
        const strongBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.15,
            flatBoost: 0,
            duration: 1_000e9,
        };
        const weakBuff = {
            uniqueHrid,
            typeHrid: "/buff_types/attack_speed",
            ratioBoost: 0.05,
            flatBoost: 0,
            duration: 100e9,
        };

        addStrongestBuff(hero, strongBuff, 0, "strong");
        addStrongestBuff(hero, weakBuff, 0, "weak");
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        // Only the non-active weak source expires (t=101s); the active strong
        // source survives with the same values, so no recompute is needed.
        hero.removeExpiredBuffs(101e9);

        expect(updateSpy).not.toHaveBeenCalled();
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("strong");
        expect(hero.combatBuffs[uniqueHrid].ratioBoost).toBe(0.15);
    });

    it("recalculates combat details only once when reset removes expired buffs", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/reset_expiration";

        hero.addBuff(
            {
                uniqueHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 100e9,
            },
            0,
            "source",
        );
        const updateSpy = vi.spyOn(hero, "updateCombatDetails");

        hero.reset(101e9);

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
    });

    it("keeps curse last-write semantics and does not hand off an overwritten source", () => {
        const hero = new Player();
        const uniqueHrid = "/buff_uniques/curse";
        const mildCurse = {
            uniqueHrid,
            typeHrid: "/buff_types/damage_taken",
            ratioBoost: 0,
            flatBoost: 0.02,
            duration: 1_000e9,
        };
        const strongCurse = {
            uniqueHrid,
            typeHrid: "/buff_types/damage_taken",
            ratioBoost: 0,
            flatBoost: 0.04,
            duration: 1_000e9,
        };

        // Curse is not a party aura, so the current PR must not change its
        // historical last-write behavior.
        hero.addBuff(mildCurse, 0, "attacker-a");
        hero.addBuff(strongCurse, 0, "attacker-b");

        expect(hero.buffSources[uniqueHrid].size).toBe(2);
        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBe("attacker-b");
        expect(hero.combatBuffs[uniqueHrid].flatBoost).toBe(0.04);

        hero.removeBuff({ uniqueHrid }, "attacker-b");

        expect(hero.activeBuffSourceKeys[uniqueHrid]).toBeUndefined();
        expect(hero.combatBuffs[uniqueHrid]).toBeUndefined();
    });

    it("allows different aura types to be active simultaneously (no cross-overwrite)", async () => {
        const players = buildPlayersForSimulation([
            emptyConfig("1"),
            withAura(emptyConfig("2"), "/abilities/speed_aura"),
            withAura(emptyConfig("3"), "/abilities/critical_aura"),
        ]);
        const hero = players[0];

        await runSimulation(players);

        expect(hero.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(hero.combatBuffs["/buff_uniques/critical_aura_rate"]).toBeTruthy();
        expect(hero.combatBuffs["/buff_uniques/critical_aura_damage"]).toBeTruthy();
    });
});
