import { describe, expect, it } from "vitest";
import Player from "../player.js";
import CombatSimulator from "../combatSimulator.js";
import Zone from "../zone.js";
import Ability from "../ability.js";
import { REMOVE_ACTIVE_SOURCE } from "../combatUnit.js";
import itemDetailMap from "../data/itemDetailMap.json";
import {
    BUFF_SOURCE_POLICY,
    PARTY_AURA_STRENGTH_FIELDS,
    assertPartyAuraSnapshotMatchesOfficialData,
    getAbilityBuffSourcePolicy,
    isPartyAuraBuff,
} from "../buffSourcePolicy.js";

function makeBuff(uniqueHrid, ratioBoost, duration = 100e9) {
    return {
        uniqueHrid,
        typeHrid: "/buff_types/attack_speed",
        ratioBoost,
        flatBoost: 0,
        duration,
    };
}

describe("Buff source policy", () => {
    it("documents the official one-stack equipment values used by the probes", () => {
        expect({
            curse: itemDetailMap["/items/cursed_bow"].equipmentDetail.combatStats.curse,
            curseRefined: itemDetailMap["/items/cursed_bow_refined"].equipmentDetail.combatStats.curse,
            weaken: itemDetailMap["/items/griffin_bulwark"].equipmentDetail.combatStats.weaken,
            weakenRefined: itemDetailMap["/items/griffin_bulwark_refined"].equipmentDetail.combatStats.weaken,
            fury: itemDetailMap["/items/furious_spear"].equipmentDetail.combatStats.fury,
            furyRefined: itemDetailMap["/items/furious_spear_refined"].equipmentDetail.combatStats.fury,
        }).toEqual({
            curse: 0.02,
            curseRefined: 0.022,
            weaken: 0.03,
            weakenRefined: 0.032,
            fury: 0.03,
            furyRefined: 0.032,
        });
    });

    async function runDeterministicSimulation(playerCount, abilityHrid = null) {
        const players = Array.from({ length: playerCount }, (_, index) => {
            const player = new Player();
            player.hrid = `player${index + 1}`;
            player.attackLevel = 31 + index;
            player.meleeLevel = 31 + index;
            player.defenseLevel = 31 + index;
            player.zoneBuffs = [];
            player.extraBuffs = [];
            if (abilityHrid) {
                player.abilities = [new Ability(abilityHrid), null, null, null];
            }
            player.updateCombatDetails();
            return player;
        });

        const simulator = new CombatSimulator(players, new Zone("/actions/combat/sorcerers_tower", 0), null, {});
        await simulator.simulate(60e9);
        return {
            attacks: simulator.simResult.attacks,
            deaths: simulator.simResult.deaths,
            manaUsed: simulator.simResult.manaUsed,
            stats: players.map((player) => ({
                attackInterval: player.combatDetails.combatStats.attackInterval,
                smashMaxDamage: player.combatDetails.smashMaxDamage,
                currentHitpoints: player.combatDetails.currentHitpoints,
                currentManapoints: player.combatDetails.currentManapoints,
            })),
        };
    }

    // Runs the callback with Math.random pinned to a constant. The golden
    // simulation below runs three simulations concurrently via Promise.all,
    // so a seeded sequence would interleave unpredictably across the three
    // runs and make the snapshots unstable. A fixed value keeps every
    // Math.random() call identical regardless of interleaving, which is what
    // makes the golden values reproducible.
    async function withFixedRandom(callback) {
        const originalRandom = Math.random;
        Math.random = () => 0.5;
        try {
            return await callback();
        } finally {
            Math.random = originalRandom;
        }
    }

    // These expectations were captured by running the unchanged HEAD engine
    // and this implementation with the same deterministic inputs. Keep the
    // old-engine values here so ordinary combat cannot drift as a side effect
    // of adding source arbitration for party auras.
    //
    // MAINTENANCE COST: this is a golden-values test by design. Any change to
    // the ordinary combat path (damage formulas, attack timing, zone behavior,
    // ability effects, etc.) will legitimately change these numbers and force
    // a snapshot update. When that happens:
    //   1. Verify the change is intentional and the new values are correct
    //      (run the simulation with the same fixed random and inspect the
    //      diff, or update via `vitest -u`).
    //   2. Update the inline snapshot / toEqual expectations together.
    //   3. Do NOT weaken the assertions (e.g. toBeCloseTo on everything) to
    //      avoid future updates - the tight coupling is the point: it guards
    //      the ordinary path against accidental drift from aura arbitration.
    it("matches the legacy-engine golden results for ordinary simulations", async () => {
        const [single, dual, dualWithSelfBuff] = await withFixedRandom(() =>
            Promise.all([
                runDeterministicSimulation(1),
                runDeterministicSimulation(2),
                runDeterministicSimulation(2, "/abilities/berserk"),
            ]),
        );

        expect(single).toMatchInlineSnapshot(`
              {
                "attacks": {
                  "/monsters/ice_sorcerer": {
                    "player1": {
                      "/abilities/water_strike": {
                        "4": 1,
                        "53": 2,
                      },
                    },
                  },
                },
                "deaths": {
                  "player1": 1,
                },
                "manaUsed": {
                  "player1": {},
                },
                "stats": [
                  {
                    "attackInterval": 2954209748.892171,
                    "currentHitpoints": 0,
                    "currentManapoints": 110,
                    "smashMaxDamage": 41,
                  },
                ],
              }
            `);
        expect(dual).toEqual({
            attacks: {
                "/monsters/ice_sorcerer": {
                    player2: {
                        "/abilities/water_strike": { 4: 1, 53: 2 },
                    },
                    player1: {
                        "/abilities/water_strike": { 4: 1, 53: 2 },
                    },
                },
                player1: {
                    "/monsters/ice_sorcerer": {
                        autoAttack: { miss: 1 },
                    },
                },
            },
            deaths: { player1: 1, player2: 1 },
            manaUsed: { player1: {}, player2: {} },
            stats: [
                {
                    attackInterval: 2954209748.892171,
                    smashMaxDamage: 41,
                    currentHitpoints: 0,
                    currentManapoints: 110,
                },
                {
                    attackInterval: 2952755905.511811,
                    smashMaxDamage: 42,
                    currentHitpoints: 0,
                    currentManapoints: 110,
                },
            ],
        });
        expect(dualWithSelfBuff.manaUsed).toEqual({
            player1: { "/abilities/berserk": 65 },
            player2: { "/abilities/berserk": 65 },
        });
        expect(dualWithSelfBuff.stats).toEqual(
            dual.stats.map((stats) => ({
                ...stats,
                currentManapoints: 45,
            })),
        );
    });

    it("preserves last-write-wins for non-aura buffs", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/non_aura_policy_probe";

        unit.addBuff(makeBuff(uniqueHrid, 0.15), 0, "first");
        unit.addBuff(makeBuff(uniqueHrid, 0.03), 0, "second");

        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("second");
        expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);

        unit.removeBuff({ uniqueHrid }, "second");
        expect(unit.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(unit.buffSources[uniqueHrid]).toBeUndefined();
    });

    it("keeps uniqueHrid-only removal compatible for source-keyed ordinary buffs", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/remove_compatibility_probe";

        unit.addBuff(makeBuff(uniqueHrid, 0.15), 0, "first");
        unit.addBuff(makeBuff(uniqueHrid, 0.03), 1, "second");

        // The old API removed the visible (last-write) Buff without requiring
        // callers to know anything about source registration.
        unit.removeBuff({ uniqueHrid });

        expect(unit.combatBuffs[uniqueHrid]).toBeUndefined();
        expect(unit.buffSources[uniqueHrid]).toBeUndefined();
    });

    it("removes the active strongest source and hands off when no key is given", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const add = (ratioBoost, sourceKey) =>
            unit.addBuff(makeBuff(uniqueHrid, ratioBoost), 0, sourceKey, {
                sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
            });

        add(0.03, "weak");
        add(0.15, "strong");

        unit.removeBuffByUniqueHrid(uniqueHrid);

        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("weak");
        expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
        expect(unit.buffSources[uniqueHrid].has("strong")).toBe(false);
        expect(unit.buffSources[uniqueHrid].has("weak")).toBe(true);
    });

    it("supports an explicit active-source sentinel without changing default-source removal", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const add = (ratioBoost, sourceKey) =>
            unit.addBuff(makeBuff(uniqueHrid, ratioBoost), 0, sourceKey, {
                sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
            });

        add(0.03, "weak");
        add(0.15, "strong");

        unit.removeBuffByUniqueHrid(uniqueHrid, REMOVE_ACTIVE_SOURCE);

        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("weak");
        expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
    });

    it("keeps explicit null removal scoped to the default source", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/explicit_default_removal_probe";

        unit.addBuff(makeBuff(uniqueHrid, 0.15), 0);
        unit.addBuff(makeBuff(uniqueHrid, 0.03), 1, "named");

        unit.removeBuffByUniqueHrid(uniqueHrid, null);

        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("named");
        expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
        expect(unit.buffSources[uniqueHrid].has("default")).toBe(false);
        expect(unit.buffSources[uniqueHrid].has("named")).toBe(true);
    });

    // Official one-stack representative values from the checked-in official
    // client-data snapshot (`data/itemDetailMap.json`):
    //   /items/cursed_bow 0.02, /items/cursed_bow_refined 0.022 (curse)
    //   /items/griffin_bulwark 0.03, /items/griffin_bulwark_refined 0.032 (weaken)
    //   /items/furious_spear 0.03, /items/furious_spear_refined 0.032 (fury)
    // The runtime formulas apply these equipment stats as `curse * stacks`,
    // `-weaken * stacks`, and `fury * stacks` respectively.  These are
    // official representative inputs for the arbitration test, not universal
    // hardcoded Buff magnitudes.  See combatSimulator.js for the formulas.
    it("keeps curse, weaken, and fury on the legacy last-write path", () => {
        const ordinaryBuffs = [
            {
                uniqueHrid: "/buff_uniques/curse",
                typeHrid: "/buff_types/damage_taken",
                first: { ratioBoost: 0, flatBoost: 0.022 },
                second: { ratioBoost: 0, flatBoost: 0.02 },
            },
            {
                uniqueHrid: "/buff_uniques/weaken",
                typeHrid: "/buff_types/damage",
                first: { ratioBoost: -0.032, flatBoost: 0 },
                second: { ratioBoost: -0.03, flatBoost: 0 },
            },
            {
                uniqueHrid: "/buff_uniques/fury_damage",
                typeHrid: "/buff_types/fury_damage",
                first: { ratioBoost: 0.032, flatBoost: 0 },
                second: { ratioBoost: 0.03, flatBoost: 0 },
            },
        ];

        for (const ordinary of ordinaryBuffs) {
            const unit = new Player();
            const create = (boosts) => ({
                uniqueHrid: ordinary.uniqueHrid,
                typeHrid: ordinary.typeHrid,
                duration: 100e9,
                ...boosts,
            });

            unit.addBuff(create(ordinary.first), 0, "first");
            unit.addBuff(create(ordinary.second), 1, "second");

            expect(unit.activeBuffSourceKeys[ordinary.uniqueHrid]).toBe("second");
            expect(unit.combatBuffs[ordinary.uniqueHrid]).toMatchObject(ordinary.second);
        }
    });

    it("uses strongest-source handoff only when explicitly requested", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const add = (ratioBoost, sourceKey, duration) =>
            unit.addBuff(makeBuff(uniqueHrid, ratioBoost, duration), 0, sourceKey, {
                sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
            });

        add(0.03, "weak", 1_000e9);
        add(0.15, "strong", 100e9);

        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("strong");
        unit.removeExpiredBuffs(101e9);
        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("weak");
        expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
    });

    it("uses the official flat field for flat-only party aura strength", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/guardian_aura_armor";
        const add = (flatBoost, sourceKey) =>
            unit.addBuff(
                {
                    uniqueHrid,
                    typeHrid: "/buff_types/armor",
                    ratioBoost: 0,
                    flatBoost,
                    duration: 1_000e9,
                },
                0,
                sourceKey,
                { sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST },
            );

        add(5, "weak");
        add(25, "strong");

        expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe("strong");
        expect(unit.combatBuffs[uniqueHrid].flatBoost).toBe(25);
    });

    it("classifies only official party-aura ability buffs as strongest", () => {
        expect(
            isPartyAuraBuff({
                uniqueHrid: "/buff_uniques/speed_aura_attack_speed",
            }),
        ).toBe(true);
        expect(isPartyAuraBuff({ uniqueHrid: "/buff_uniques/curse" })).toBe(false);
        expect(
            getAbilityBuffSourcePolicy(
                { hrid: "/abilities/speed_aura" },
                { uniqueHrid: "/buff_uniques/speed_aura_attack_speed" },
            ),
        ).toBe(BUFF_SOURCE_POLICY.STRONGEST);
        expect(
            getAbilityBuffSourcePolicy({ hrid: "/abilities/mana_spring" }, { uniqueHrid: "/buff_uniques/mana_spring" }),
        ).toBe(BUFF_SOURCE_POLICY.REPLACE);
    });

    it("rejects changing the policy of an already registered uniqueHrid", () => {
        const unit = new Player();
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        unit.addBuff(makeBuff(uniqueHrid, 0.1), 0, "source", {
            sourcePolicy: BUFF_SOURCE_POLICY.REPLACE,
        });

        expect(() =>
            unit.addBuff(makeBuff(uniqueHrid, 0.2), 1, "source", {
                sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
            }),
        ).toThrow(/policy mismatch/);
    });

    it("fails fast when the official data adds a party aura buff not in the snapshot", () => {
        const officialBuffs = [
            ...Object.keys(PARTY_AURA_STRENGTH_FIELDS).map((uniqueHrid) => ({
                uniqueHrid,
                ratioBoost: 0,
                flatBoost: 0.02,
            })),
            { uniqueHrid: "/buff_uniques/new_official_aura", ratioBoost: 0.01, flatBoost: 0 },
        ];

        expect(() => assertPartyAuraSnapshotMatchesOfficialData(officialBuffs)).toThrow(
            /Unexpected in official data: \/buff_uniques\/new_official_aura/,
        );
    });

    it("fails fast when the official data removes a party aura buff from the snapshot", () => {
        const officialBuffs = Object.keys(PARTY_AURA_STRENGTH_FIELDS)
            .filter((uniqueHrid) => uniqueHrid !== "/buff_uniques/fierce_aura")
            .map((uniqueHrid) => ({
                uniqueHrid,
                ratioBoost: 0,
                flatBoost: 0.02,
            }));

        expect(() => assertPartyAuraSnapshotMatchesOfficialData(officialBuffs)).toThrow(
            /Missing from official data: \/buff_uniques\/fierce_aura/,
        );
    });

    it("fails fast when a party aura buff shape changes (negative or mixed fields)", () => {
        const officialBuffs = Object.keys(PARTY_AURA_STRENGTH_FIELDS).map((uniqueHrid) => ({
            uniqueHrid,
            ratioBoost: 0,
            flatBoost: 0.02,
        }));
        officialBuffs.find((buff) => buff.uniqueHrid === "/buff_uniques/speed_aura_attack_speed").ratioBoost = -0.01;

        expect(() => assertPartyAuraSnapshotMatchesOfficialData(officialBuffs)).toThrow(
            /Party aura strength shape changed for \/buff_uniques\/speed_aura_attack_speed/,
        );
    });

    it("accepts the checked-in official snapshot without throwing", () => {
        expect(() => assertPartyAuraSnapshotMatchesOfficialData()).not.toThrow();
    });
});
