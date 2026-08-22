import { describe, expect, it, vi } from "vitest";
import Ability from "../ability.js";
import CombatSimulator from "../combatSimulator.js";
import Player from "../player.js";
import Zone from "../zone.js";
import CheckBuffExpirationEvent from "../events/checkBuffExpirationEvent.js";
import EventQueue from "../events/eventQueue.js";

class BoundaryProbeSimulator extends CombatSimulator {
    constructor(eventTimes) {
        super([], null, null, {});
        this.eventTimes = eventTimes;
        this.processedEventTimes = [];
    }

    reset() {
        super.reset();
        this.processedEventTimes = [];
        for (const time of this.eventTimes) {
            this.eventQueue.addEvent({ type: "boundaryProbe", time });
        }
    }

    async processEvent(event) {
        this.simulationTime = event.time;
        if (event.type === "boundaryProbe") {
            this.processedEventTimes.push(event.time);
        }
    }
}

describe("CombatSimulator", () => {
    it("uses the fixed encounter respawn interval instead of the zone base time cost", () => {
        const simulator = new CombatSimulator([], new Zone("/actions/combat/sorcerers_tower", 4), null, {});

        simulator.simulationTime = 1e9;
        simulator.encounterStartTime = 0;

        expect(simulator.calculateNextEncounterRespawnTime()).toBe(4e9);
    });

    it("treats the simulation horizon as half-open", async () => {
        const simulator = new BoundaryProbeSimulator([99, 100, 101]);

        const result = await simulator.simulate(100);

        expect(simulator.processedEventTimes).toEqual([99]);
        expect(simulator.eventQueue.peekNextEvent()).toMatchObject({ time: 100 });
        expect(result.simulatedTime).toBe(100);
    });

    it("emits initial and terminal progress for a zero-length simulation", async () => {
        const simulator = new BoundaryProbeSimulator([0, 1]);
        const progressValues = [];
        simulator.addEventListener("progress", (event) => {
            progressValues.push(event.detail.progress);
        });

        const result = await simulator.simulate(0);

        expect(simulator.processedEventTimes).toEqual([]);
        expect(result.simulatedTime).toBe(0);
        expect(progressValues).toEqual([0, 1]);
    });

    it("dispatches terminal progress when the horizon ends before a periodic tick", async () => {
        const simulator = new BoundaryProbeSimulator([99]);
        const progressValues = [];
        simulator.addEventListener("progress", (event) => {
            progressValues.push(event.detail.progress);
        });

        await simulator.simulate(100);

        expect(progressValues.at(-1)).toBe(1);
    });

    it("peeks the earliest event without removing it", () => {
        const queue = new EventQueue();
        const later = { type: "later", time: 20 };
        const earlier = { type: "earlier", time: 10 };
        queue.addEvent(later);
        queue.addEvent(earlier);

        expect(queue.peekNextEvent()).toBe(earlier);
        expect(queue.getNextEvent()).toBe(earlier);
        expect(queue.getNextEvent()).toBe(later);
    });

    it("registers enrage buffs with the current simulation time and source", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const enemy = new Player();
        enemy.hrid = "enrage-test";
        enemy.enrageTime = 60e9;
        enemy.combatDetails.currentHitpoints = 100;
        simulator.enemies = [enemy];
        simulator.simulationTime = 123e9;

        simulator.processEnrageTickEvent({ encounterTime: 60e9 });

        const damageSources = enemy.buffSources["/buff_uniques/enrage_damage"];
        const accuracySources = enemy.buffSources["/buff_uniques/enrage_accuracy"];
        expect(damageSources.get("default").buff.startTime).toBe(123e9);
        expect(accuracySources.get("default").buff.startTime).toBe(123e9);
        expect(damageSources.get("default").expiresAt).toBe(183e9);
        expect(accuracySources.get("default").expiresAt).toBe(183e9);
        expect(enemy.activeBuffSourceKeys["/buff_uniques/enrage_damage"]).toBe("default");
        expect(enemy.activeBuffSourceKeys["/buff_uniques/enrage_accuracy"]).toBe("default");
    });

    it("skips enrage buffs for enemies without a positive enrage time", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const enemy = new Player();
        enemy.hrid = "enrage-guard";
        // 0 is the combatUnit default when data omits enrageTime. A missing or
        // non-numeric value would otherwise produce Infinity/NaN stack math
        // (immediate max enrage, or an addBuff validation crash).
        enemy.enrageTime = 0;
        enemy.combatDetails.currentHitpoints = 100;
        simulator.enemies = [enemy];
        simulator.simulationTime = 123e9;

        simulator.processEnrageTickEvent({ encounterTime: 60e9 });

        expect(enemy.buffSources["/buff_uniques/enrage_damage"]).toBeUndefined();
        expect(enemy.buffSources["/buff_uniques/enrage_accuracy"]).toBeUndefined();
        expect(enemy.combatBuffs["/buff_uniques/enrage_damage"]).toBeUndefined();
        expect(simulator.simResult.maxEnrageStack).toBe(0);
    });

    it("expires only fury buffs when processing a fury expiration event", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const source = new Player();
        const furyAccuracyHrid = "/buff_uniques/fury_accuracy";
        const furyDamageHrid = "/buff_uniques/fury_damage";
        const unrelatedHrid = "/buff_uniques/unrelated_expiring_buff";
        source.addBuff(
            {
                uniqueHrid: furyAccuracyHrid,
                typeHrid: "/buff_types/fury_accuracy",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "fury-accuracy",
        );
        source.addBuff(
            {
                uniqueHrid: furyDamageHrid,
                typeHrid: "/buff_types/fury_damage",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "fury-damage",
        );
        source.addBuff(
            {
                uniqueHrid: unrelatedHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "other-source",
        );
        simulator.simulationTime = 1;

        const fullSweepSpy = vi.spyOn(source, "removeExpiredBuffs");
        simulator.processFuryExpirationEvent({ source });

        expect(fullSweepSpy).not.toHaveBeenCalled();
        expect(source.combatBuffs[furyAccuracyHrid]).toBeUndefined();
        expect(source.combatBuffs[furyDamageHrid]).toBeUndefined();
        expect(source.combatBuffs[unrelatedHrid]).toBeTruthy();
    });

    it("expires only curse when processing a curse expiration event", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const source = new Player();
        const curseHrid = "/buff_uniques/curse";
        const unrelatedHrid = "/buff_uniques/unrelated_expiring_buff";
        source.addBuff(
            {
                uniqueHrid: curseHrid,
                typeHrid: "/buff_types/damage_taken",
                ratioBoost: 0,
                flatBoost: 0.1,
                duration: 1,
            },
            0,
            "curse-source",
        );
        source.addBuff(
            {
                uniqueHrid: unrelatedHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "other-source",
        );
        simulator.simulationTime = 1;

        const fullSweepSpy = vi.spyOn(source, "removeExpiredBuffs");
        simulator.processCurseExpirationEvent({ source });

        expect(fullSweepSpy).not.toHaveBeenCalled();
        expect(source.combatBuffs[curseHrid]).toBeUndefined();
        expect(source.combatBuffs[unrelatedHrid]).toBeTruthy();
    });

    it("expires only weaken when processing a weaken expiration event", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const source = new Player();
        const weakenHrid = "/buff_uniques/weaken";
        const unrelatedHrid = "/buff_uniques/unrelated_expiring_buff";

        source.addBuff(
            {
                uniqueHrid: weakenHrid,
                typeHrid: "/buff_types/damage",
                ratioBoost: -0.02,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "weaken-source",
        );
        source.addBuff(
            {
                uniqueHrid: unrelatedHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "other-source",
        );

        const fullSweepSpy = vi.spyOn(source, "removeExpiredBuffs");
        simulator.simulationTime = 1;
        simulator.processWeakenExpirationEvent({ source });

        expect(fullSweepSpy).not.toHaveBeenCalled();
        expect(source.combatBuffs[weakenHrid]).toBeUndefined();
        // The unrelated buff is expired by time, but must not be removed by
        // the weaken event; its own expiration lifecycle owns that cleanup.
        expect(source.combatBuffs[unrelatedHrid]).toBeTruthy();
    });

    it("expires only the referenced buff for a targeted buff expiration event", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const source = new Player();
        const targetedHrid = "/buff_uniques/targeted_expiring_buff";
        const unrelatedHrid = "/buff_uniques/unrelated_expiring_buff";
        source.addBuff(
            {
                uniqueHrid: targetedHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "targeted-source",
        );
        source.addBuff(
            {
                uniqueHrid: unrelatedHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "other-source",
        );
        simulator.simulationTime = 1;

        const fullSweepSpy = vi.spyOn(source, "removeExpiredBuffs");
        simulator.processCheckBuffExpirationEvent({
            source,
            buffUniqueHrid: targetedHrid,
            buffSourceKey: "targeted-source",
        });

        expect(fullSweepSpy).not.toHaveBeenCalled();
        expect(source.combatBuffs[targetedHrid]).toBeUndefined();
        // The unrelated buff is expired by time, but must not be removed by
        // the targeted event; its own expiration lifecycle owns that cleanup.
        expect(source.combatBuffs[unrelatedHrid]).toBeTruthy();
    });

    it("falls back to the full sweep when the expiration event carries no buff reference", () => {
        const simulator = new CombatSimulator([], null, null, {});
        const source = new Player();
        const sweptHrid = "/buff_uniques/swept_expiring_buff";
        source.addBuff(
            {
                uniqueHrid: sweptHrid,
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.1,
                flatBoost: 0,
                duration: 1,
            },
            0,
            "default",
        );
        simulator.simulationTime = 1;

        const fullSweepSpy = vi.spyOn(source, "removeExpiredBuffs");
        simulator.processCheckBuffExpirationEvent({ source, buffUniqueHrid: null, buffSourceKey: null });

        expect(fullSweepSpy).toHaveBeenCalledTimes(1);
        expect(source.combatBuffs[sweptHrid]).toBeUndefined();
    });

    it("applies buff effects without scheduling expiration events when requested", () => {
        const hero = new Player();
        const caster = new Player();
        hero.updateCombatDetails();
        caster.updateCombatDetails();

        const simulator = new CombatSimulator([hero, caster], null, null, {});
        simulator.simulationTime = 0;

        const aura = new Ability("/abilities/speed_aura");
        const auraEffect = aura.abilityEffects.find((effect) => effect.effectType === "/ability_effect_types/buff");
        const selfBuffAbility = new Ability("/abilities/berserk");
        const selfBuffEffect = selfBuffAbility.abilityEffects.find(
            (effect) => effect.effectType === "/ability_effect_types/buff",
        );
        const initialMana = caster.combatDetails.currentManapoints;
        const initialAuraLastUsed = aura.lastUsed;
        const initialSelfBuffLastUsed = selfBuffAbility.lastUsed;

        simulator.processAbilityBuffEffect(caster, aura, auraEffect, {
            scheduleExpirationEvents: false,
        });
        simulator.processAbilityBuffEffect(caster, selfBuffAbility, selfBuffEffect, {
            scheduleExpirationEvents: false,
        });

        expect(caster.combatDetails.currentManapoints).toBe(initialMana);
        expect(aura.lastUsed).toBe(initialAuraLastUsed);
        expect(selfBuffAbility.lastUsed).toBe(initialSelfBuffLastUsed);
        expect(caster.abilityManaCosts.size).toBe(0);
        expect(simulator.eventQueue.minHeap.toArray()).toHaveLength(0);
        expect(hero.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(hero.activeBuffSourceKeys["/buff_uniques/speed_aura_attack_speed"]).toBe(caster.hrid);
        expect(caster.combatBuffs["/buff_uniques/berserk"]).toBeTruthy();
        expect(caster.activeBuffSourceKeys["/buff_uniques/berserk"]).toBe("default");
    });

    it("coalesces refreshed ability buff expiration events per target and source", () => {
        const hero = new Player();
        const firstCaster = new Player();
        const secondCaster = new Player();
        hero.hrid = "expiration-hero";
        firstCaster.hrid = "expiration-first-caster";
        secondCaster.hrid = "expiration-second-caster";
        [hero, firstCaster, secondCaster].forEach((player) => player.updateCombatDetails());

        const simulator = new CombatSimulator([hero, firstCaster, secondCaster], null, null, {});
        const firstAura = new Ability("/abilities/speed_aura");
        const firstAuraEffect = firstAura.abilityEffects.find(
            (effect) => effect.effectType === "/ability_effect_types/buff",
        );
        const secondAura = new Ability("/abilities/speed_aura");
        const secondAuraEffect = secondAura.abilityEffects.find(
            (effect) => effect.effectType === "/ability_effect_types/buff",
        );
        const expectedDurationByHrid = new Map(firstAuraEffect.buffs.map((buff) => [buff.uniqueHrid, buff.duration]));
        const getExpirationEvents = () =>
            simulator.eventQueue.minHeap.toArray().filter((event) => event instanceof CheckBuffExpirationEvent);
        const expectSourceEvents = (events, sourceKey, startTime) => {
            const sourceEvents = events.filter((event) => event.buffSourceKey === sourceKey);
            expect(sourceEvents).toHaveLength(6); // 3 targets × 2 speed-aura buffs.
            sourceEvents.forEach((event) => {
                expect(event.time).toBe(startTime + expectedDurationByHrid.get(event.buffUniqueHrid));
            });
        };

        simulator.simulationTime = 0;
        simulator.processAbilityBuffEffect(firstCaster, firstAura, firstAuraEffect);
        let expirationEvents = getExpirationEvents();
        expect(expirationEvents).toHaveLength(6);
        expectSourceEvents(expirationEvents, firstCaster.hrid, 0);

        // Recasting the same aura refreshes each registration. The old six
        // events must be replaced, not left in the queue or allowed to win over
        // the refreshed expiration time.
        simulator.simulationTime = 1e9;
        simulator.processAbilityBuffEffect(firstCaster, firstAura, firstAuraEffect);
        expirationEvents = getExpirationEvents();
        expect(expirationEvents).toHaveLength(6);
        expectSourceEvents(expirationEvents, firstCaster.hrid, 1e9);

        // A different caster owns an independent source registration, so its
        // events must not be coalesced with the first caster's events.
        simulator.simulationTime = 2e9;
        simulator.processAbilityBuffEffect(secondCaster, secondAura, secondAuraEffect);
        expirationEvents = getExpirationEvents();
        expect(expirationEvents).toHaveLength(12);
        expectSourceEvents(expirationEvents, firstCaster.hrid, 1e9);
        expectSourceEvents(expirationEvents, secondCaster.hrid, 2e9);
    });

    it("tracks cumulative ability mana costs across deduct/recover/re-deduct", () => {
        const caster = new Player();
        caster.updateCombatDetails();

        const simulator = new CombatSimulator([caster], null, null, {});
        simulator.simulationTime = 5e9;

        const ability = new Ability("/abilities/speed_aura");
        const maxMana = caster.combatDetails.currentManapoints;
        const cost = ability.manaCost;

        simulator.spendAbilityMana(caster, ability);
        expect(caster.combatDetails.currentManapoints).toBe(maxMana - cost);
        expect(caster.abilityManaCosts.get(ability.hrid)).toBe(cost);
        expect(ability.lastUsed).toBe(5e9);

        // Recover to full MP, then deduct again. currentManapoints reflects the
        // net result while abilityManaCosts keeps the running total spent.
        caster.addManapoints(cost);
        expect(caster.combatDetails.currentManapoints).toBe(maxMana);

        simulator.spendAbilityMana(caster, ability);
        expect(caster.combatDetails.currentManapoints).toBe(maxMana - cost);
        expect(caster.abilityManaCosts.get(ability.hrid)).toBe(cost * 2);
        expect(ability.lastUsed).toBe(5e9);
    });
});
