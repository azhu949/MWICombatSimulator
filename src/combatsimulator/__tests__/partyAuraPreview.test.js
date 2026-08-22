import { describe, expect, it, vi } from "vitest";
import CombatSimulator from "../combatSimulator.js";
import Player from "../player.js";
import Zone from "../zone.js";
import {
    buildPlayersForSimulation,
    buildCombatPreviewData,
    createEmptyPlayerConfig,
} from "../../services/playerMapper.js";

const MINUTE = 60e9;

function emptyConfig(id) {
    return { ...createEmptyPlayerConfig(String(id)), selected: true };
}

function withAura(config, abilityHrid, level = 1) {
    return {
        ...config,
        abilities: [{ abilityHrid, level }, ...config.abilities.slice(1)],
    };
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

describe("Party aura combat preview", () => {
    it("does not skip an earlier continuously-triggered attack to preview a later aura", () => {
        const heroConfig = emptyConfig("opener-order-hero");
        const teammateConfig = emptyConfig("opener-order-mate");
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/fireball", level: 1 },
            { abilityHrid: "/abilities/speed_aura", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ];

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        // Fireball has no cooldown and remains the first triggerable slot, so
        // the live scheduler never reaches the later speed aura.
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeFalsy();
        expect(
            preview.highlightSources.some(
                (source) => source.sourceKey === "teammate-aura-playeropener-order-mate-/abilities/speed_aura",
            ),
        ).toBe(false);
    });

    it("replays a one-shot prerequisite buff before selecting a later aura", () => {
        const heroConfig = emptyConfig("prerequisite-hero");
        const teammateConfig = emptyConfig("prerequisite-mate");
        teammateConfig.levels = { ...teammateConfig.levels, intelligence: 20 };
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/elemental_affinity", level: 1 },
            { abilityHrid: "/abilities/mystic_aura", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ];

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        expect(preview.finalPlayer.combatBuffs["/buff_uniques/mystic_aura_water_amplify"]).toBeTruthy();
    });

    it("applies a teammate's opening drink before scaling their party aura", () => {
        const heroConfig = emptyConfig("drink-order-hero");
        const teammateConfig = withAura(emptyConfig("drink-order-mate"), "/abilities/speed_aura");
        teammateConfig.levels = { ...teammateConfig.levels, attack: 100 };
        teammateConfig.drinks[0] = "/items/attack_coffee";

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        // Attack Coffee raises level 100 to 109 (8% + 1 flat) before the aura
        // multiplier is evaluated by the live combat opener.
        const expectedRatio = 0.03 * (1 + 109 * 0.005);
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(
            expectedRatio,
            10,
        );
    });

    it("keeps a teammate's already-scheduled aura after an ally triggers their drink", () => {
        const heroConfig = emptyConfig("scheduled-aura-hero");
        const firstTeammate = withAura(emptyConfig("scheduled-aura-first"), "/abilities/speed_aura");
        const secondTeammate = withAura(emptyConfig("scheduled-aura-second"), "/abilities/speed_aura");
        secondTeammate.levels = { ...secondTeammate.levels, attack: 100 };
        secondTeammate.drinks[0] = "/items/attack_coffee";
        secondTeammate.triggerMap["/items/attack_coffee"] = [
            {
                dependencyHrid: "/combat_trigger_dependencies/all_allies",
                conditionHrid: "/combat_trigger_conditions/speed_aura",
                comparatorHrid: "/combat_trigger_comparators/is_active",
                value: 0,
            },
        ];

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, firstTeammate, secondTeammate],
        });

        // Both auras are scheduled before either cast resolves. The first
        // cast activates the second teammate's drink; their already-scheduled
        // aura then scales from attack level 109 and becomes the active source.
        const expectedRatio = 0.03 * (1 + 109 * 0.005);
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(
            expectedRatio,
            10,
        );
        expect(preview.finalPlayer.activeBuffSourceKeys["/buff_uniques/speed_aura_attack_speed"]).toBe(
            "playerscheduled-aura-second",
        );
    });

    it("invalidates cached party aura triggers when the combat context changes", () => {
        const heroConfig = emptyConfig("context-cache-hero");
        const teammateConfig = withAura(emptyConfig("context-cache-mate"), "/abilities/speed_aura");
        teammateConfig.triggerMap["/abilities/speed_aura"] = [
            {
                dependencyHrid: "/combat_trigger_dependencies/all_enemies",
                conditionHrid: "/combat_trigger_conditions/number_of_active_units",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 4,
            },
        ];
        const options = { partyPlayerConfigs: [heroConfig, teammateConfig] };

        const fourEnemyPreview = buildCombatPreviewData(
            heroConfig,
            null,
            {
                zoneHrid: "/actions/combat/aqua_planet",
                difficultyTier: 0,
            },
            options,
        );
        const oneEnemyPreview = buildCombatPreviewData(
            heroConfig,
            null,
            {
                zoneHrid: "/actions/combat/alligator",
                difficultyTier: 0,
            },
            options,
        );

        expect(fourEnemyPreview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(oneEnemyPreview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeFalsy();
    });

    it("shows only the party auras affordable from a teammate's opening MP", async () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = emptyConfig("2");
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/speed_aura", level: 1 },
            { abilityHrid: "/abilities/critical_aura", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ];

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        expect(preview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_cast_speed"]).toBeTruthy();
        // A level-1 teammate has 110 MP; each official party aura costs 100.
        // The first slot can cast, but the second slot cannot.
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/critical_aura_rate"]).toBeFalsy();
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/critical_aura_damage"]).toBeFalsy();

        const auraSourceHrids = preview.highlightSources
            .filter((source) => source.sourceKey?.startsWith("teammate-aura-player2-"))
            .map((source) => source.sourceHrid);
        expect(auraSourceHrids).toEqual(["/abilities/speed_aura"]);

        // End-to-end parity: with the same configuration, one minute of the
        // real engine also has enough MP for speed aura but not critical aura.
        const simulationPlayers = buildPlayersForSimulation([heroConfig, teammateConfig]);
        await runSimulation(simulationPlayers);
        expect(simulationPlayers[0].combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(simulationPlayers[0].combatBuffs["/buff_uniques/critical_aura_rate"]).toBeFalsy();
    });

    it("replays multiple party auras when the teammate's opening MP covers their costs", () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = emptyConfig("2");
        teammateConfig.levels = { ...teammateConfig.levels, intelligence: 20 };
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/speed_aura", level: 1 },
            { abilityHrid: "/abilities/critical_aura", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ];

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        expect(preview.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(preview.finalPlayer.combatBuffs["/buff_uniques/critical_aura_rate"]).toBeTruthy();
        expect(
            preview.highlightSources.filter((source) => source.sourceKey?.startsWith("teammate-aura-player2-")),
        ).toHaveLength(2);
    });

    it("includes all 14 buffs from the five party auras in the party preview", () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = emptyConfig("2");
        teammateConfig.levels = { ...teammateConfig.levels, intelligence: 90 };
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/speed_aura", level: 1 },
            { abilityHrid: "/abilities/guardian_aura", level: 1 },
            { abilityHrid: "/abilities/fierce_aura", level: 1 },
            { abilityHrid: "/abilities/critical_aura", level: 1 },
            { abilityHrid: "/abilities/mystic_aura", level: 1 },
        ];

        const expectedPartyAuraBuffHrids = [
            "/buff_uniques/speed_aura_attack_speed",
            "/buff_uniques/speed_aura_cast_speed",
            "/buff_uniques/guardian_aura_healing_amplify",
            "/buff_uniques/guardian_aura_evasion",
            "/buff_uniques/guardian_aura_armor",
            "/buff_uniques/guardian_aura_water_resistance",
            "/buff_uniques/guardian_aura_nature_resistance",
            "/buff_uniques/guardian_aura_fire_resistance",
            "/buff_uniques/fierce_aura",
            "/buff_uniques/critical_aura_rate",
            "/buff_uniques/critical_aura_damage",
            "/buff_uniques/mystic_aura_water_amplify",
            "/buff_uniques/mystic_aura_nature_amplify",
            "/buff_uniques/mystic_aura_fire_amplify",
        ];

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        expect(expectedPartyAuraBuffHrids).toHaveLength(14);
        for (const uniqueHrid of expectedPartyAuraBuffHrids) {
            expect(preview.finalPlayer.combatBuffs[uniqueHrid]).toBeTruthy();
        }
    });

    it("does not deep-clone the hero for each teammate aura attribution snapshot", () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = emptyConfig("2");
        teammateConfig.levels = { ...teammateConfig.levels, intelligence: 90 };
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/speed_aura", level: 1 },
            { abilityHrid: "/abilities/guardian_aura", level: 1 },
            { abilityHrid: "/abilities/fierce_aura", level: 1 },
            { abilityHrid: "/abilities/critical_aura", level: 1 },
            { abilityHrid: "/abilities/mystic_aura", level: 1 },
        ];

        const cloneSpy = vi.spyOn(globalThis, "structuredClone");
        try {
            const preview = buildCombatPreviewData(heroConfig, null, null, {
                partyPlayerConfigs: [heroConfig, teammateConfig],
            });

            expect(
                preview.highlightSources.filter((source) => source.sourceKey?.startsWith("teammate-aura-player2-")),
            ).toHaveLength(5);
            expect(cloneSpy.mock.calls.some(([value]) => value instanceof Player)).toBe(false);
        } finally {
            cloneSpy.mockRestore();
        }
    });

    it("reuses party aura results for unrelated edits and invalidates on relevant in-place changes", () => {
        const heroConfig = emptyConfig("cache-hero");
        const teammateConfig = withAura(emptyConfig("cache-mate"), "/abilities/speed_aura");
        teammateConfig.levels = { ...teammateConfig.levels, attack: 1 };

        const buildPreview = () =>
            buildCombatPreviewData(heroConfig, null, null, {
                partyPlayerConfigs: [heroConfig, teammateConfig],
            });
        const findAuraSource = (preview) =>
            preview.highlightSources.find(
                (source) => source.sourceKey === "teammate-aura-playercache-mate-/abilities/speed_aura",
            );

        const first = buildPreview();
        const firstSource = findAuraSource(first);
        expect(firstSource).toBeTruthy();

        // Skill XP is UI/progression metadata and does not participate in the
        // party aura opening-state simulation.
        teammateConfig.skillExperience.attack = 123_456;
        const afterUnrelatedEdit = buildPreview();
        // Cache hits hand out an isolated snapshot (structuredClone), so the
        // source entry is content-equal rather than reference-equal to the
        // first build's result.
        expect(findAuraSource(afterUnrelatedEdit)).toStrictEqual(firstSource);

        // Store edits mutate the existing config object. The value signature
        // must still invalidate when an aura-relevant field changes.
        teammateConfig.levels.attack = 800;
        const afterRelevantEdit = buildPreview();
        expect(findAuraSource(afterRelevantEdit)).not.toBe(firstSource);
        expect(
            afterRelevantEdit.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost,
        ).toBeCloseTo(0.03 * (1 + 800 * 0.005), 10);
    });

    it("includes teammate auras in final panel stats and source details when teammates are selected", () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = {
            ...withAura(emptyConfig("2"), "/abilities/speed_aura"),
            name: "AuraBuddy",
        };

        const solo = buildCombatPreviewData(heroConfig);
        const withParty = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        // Without a party: no teammate aura.
        expect(solo.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeFalsy();
        // With a party: the hero gains a teammate aura and attacks faster.
        expect(withParty.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeTruthy();
        expect(withParty.finalPlayer.buffSources["/buff_uniques/speed_aura_attack_speed"].has("player2")).toBe(true);
        expect(withParty.finalPlayer.buffSources["/buff_uniques/speed_aura_attack_speed"].has("party-aura")).toBe(
            false,
        );
        expect(withParty.finalPlayer.combatDetails.combatStats.attackInterval).toBeLessThan(
            solo.finalPlayer.combatDetails.combatStats.attackInterval,
        );

        // Source details include a teammate aura entry (teammate name + aura name).
        const auraSource = withParty.highlightSources.find((source) => source.sourceKey?.startsWith("teammate-aura-"));
        expect(auraSource).toBeTruthy();
        expect(auraSource.sourceHrid).toBe("/abilities/speed_aura");
        expect(auraSource.sourceName).toContain("AuraBuddy");
        // The attackInterval breakdown entry includes this source.
        const breakdowns = withParty.statBreakdowns || {};
        const intervalBreakdown = Object.values(breakdowns).find((entry) =>
            entry?.sources?.some((source) => source.sourceKey?.startsWith("teammate-aura-")),
        );
        expect(intervalBreakdown).toBeTruthy();
    });

    it("preserves real sources and supports source handoff for the same aura from multiple teammates", () => {
        const heroConfig = emptyConfig("1");
        const strongTeammate = withAura(emptyConfig("2"), "/abilities/speed_aura");
        const weakTeammate = withAura(emptyConfig("3"), "/abilities/speed_aura");
        strongTeammate.levels = { ...strongTeammate.levels, attack: 800 };
        weakTeammate.levels = { ...weakTeammate.levels, attack: 1 };
        strongTeammate.triggerMap = { "/abilities/speed_aura": [] };
        weakTeammate.triggerMap = { "/abilities/speed_aura": [] };

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, strongTeammate, weakTeammate],
        });
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const sources = preview.finalPlayer.buffSources[uniqueHrid];

        expect(sources.has("player2")).toBe(true);
        expect(sources.has("player3")).toBe(true);
        expect(sources.has("party-aura")).toBe(false);
        expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe("player2");
        expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03 * (1 + 800 * 0.005), 10);

        // Give the two preview sources different lifetimes to exercise the
        // same strongest-source handoff used by the combat engine.
        sources.get("player2").expiresAt = 1;
        sources.get("player3").expiresAt = 100;
        preview.finalPlayer.removeExpiredBuffs(2);

        expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe("player3");
        expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03 * (1 + 1 * 0.005), 10);
    });

    it("does not include unselected teammates in the panel preview", () => {
        const heroConfig = emptyConfig("1");
        const unselectedTeammate = { ...withAura(emptyConfig("2"), "/abilities/speed_aura"), selected: false };

        const withParty = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, unselectedTeammate],
        });

        expect(withParty.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"]).toBeFalsy();
    });

    it("uses the stronger version when the hero and a teammate both provide an aura", () => {
        const strongHero = withAura(emptyConfig("1"), "/abilities/speed_aura");
        strongHero.levels = { ...strongHero.levels, attack: 800 };
        const weakTeammate = {
            ...withAura(emptyConfig("2"), "/abilities/speed_aura"),
            name: "WeakMate",
        };
        weakTeammate.levels = { ...weakTeammate.levels, attack: 1 };

        const solo = buildCombatPreviewData(strongHero);
        const withParty = buildCombatPreviewData(strongHero, null, null, {
            partyPlayerConfigs: [strongHero, weakTeammate],
        });

        // The hero's own aura (strong) is active.
        expect(solo.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(
            0.03 * (1 + 800 * 0.005),
            10,
        );
        // The weaker teammate aura must not override it; the value stays unchanged.
        expect(withParty.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(
            0.03 * (1 + 800 * 0.005),
            10,
        );
        // Because the weaker aura causes no net change, no teammate aura source entry is generated.
        expect(withParty.highlightSources.some((source) => source.sourceKey?.startsWith("teammate-aura-"))).toBe(false);
    });

    it("attributes a stat to the strongest teammate aura only, but preserves every source for handoff", () => {
        const heroConfig = emptyConfig("1");
        const weakMate = withAura(emptyConfig("2"), "/abilities/speed_aura");
        weakMate.levels = { ...weakMate.levels, attack: 1 };
        const strongMate = withAura(emptyConfig("3"), "/abilities/speed_aura");
        strongMate.levels = { ...strongMate.levels, attack: 800 };
        weakMate.triggerMap = { "/abilities/speed_aura": [] };
        strongMate.triggerMap = { "/abilities/speed_aura": [] };

        const preview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, weakMate, strongMate],
        });
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const auraSources = preview.highlightSources.filter((source) => source.sourceKey?.startsWith("teammate-aura-"));

        // Only the actual active contributor (the stronger mate, cast last) is
        // shown as a source; the weaker mate's earlier cast was overridden and
        // contributed no final stat change.
        expect(auraSources).toHaveLength(1);
        expect(auraSources[0].sourceKey).toBe("teammate-aura-player3-/abilities/speed_aura");
        // The strongest source is active in the final state ...
        expect(preview.finalPlayer.activeBuffSourceKeys[uniqueHrid]).toBe("player3");
        expect(preview.finalPlayer.combatBuffs[uniqueHrid].ratioBoost).toBeCloseTo(0.03 * (1 + 800 * 0.005), 10);
        // ... yet every source stays registered so the strongest can hand off
        // when it expires (state preservation is separate from attribution).
        expect(preview.finalPlayer.buffSources[uniqueHrid].has("player2")).toBe(true);
        expect(preview.finalPlayer.buffSources[uniqueHrid].has("player3")).toBe(true);
        // Speed aura lowers the attack interval: a negative delta and its
        // source are both kept, so beneficial reductions are never dropped.
        const intervalSource = auraSources[0].changedStats.find((stat) => stat.key === "attackIntervalSeconds");
        expect(intervalSource).toBeTruthy();
        expect(intervalSource.deltaValue).toBeLessThan(0);
        // The attackInterval breakdown lists only the active contributor.
        const breakdowns = preview.statBreakdowns || {};
        const intervalBreakdown = Object.values(breakdowns).find((entry) =>
            entry?.sources?.some((source) => source.sourceKey?.startsWith("teammate-aura-")),
        );
        expect(intervalBreakdown).toBeTruthy();
        expect(intervalBreakdown.sources).toHaveLength(1);
        expect(intervalBreakdown.sources[0].sourceKey).toBe("teammate-aura-player3-/abilities/speed_aura");
    });

    it("excludes multiple weaker teammate auras that cannot beat the hero's own stronger buff", () => {
        const strongHero = withAura(emptyConfig("1"), "/abilities/speed_aura");
        strongHero.levels = { ...strongHero.levels, attack: 800 };
        const weakMateA = { ...withAura(emptyConfig("2"), "/abilities/speed_aura"), name: "WeakMateA" };
        const weakMateB = { ...withAura(emptyConfig("3"), "/abilities/speed_aura"), name: "WeakMateB" };
        weakMateA.levels = { ...weakMateA.levels, attack: 1 };
        weakMateB.levels = { ...weakMateB.levels, attack: 2 };
        weakMateA.triggerMap = { "/abilities/speed_aura": [] };
        weakMateB.triggerMap = { "/abilities/speed_aura": [] };

        const withParty = buildCombatPreviewData(strongHero, null, null, {
            partyPlayerConfigs: [strongHero, weakMateA, weakMateB],
        });

        // The hero's own stronger aura stays active under accumulation order;
        // neither weaker teammate produces a visible change or a source entry.
        expect(withParty.finalPlayer.combatBuffs["/buff_uniques/speed_aura_attack_speed"].ratioBoost).toBeCloseTo(
            0.03 * (1 + 800 * 0.005),
            10,
        );
        expect(
            withParty.highlightSources.filter((source) => source.sourceKey?.startsWith("teammate-aura-")),
        ).toHaveLength(0);
    });

    it("does not leak caller-side mutations into later cache hits", () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = withAura(emptyConfig("2"), "/abilities/speed_aura");
        teammateConfig.levels = { ...teammateConfig.levels, attack: 100 };
        teammateConfig.triggerMap = { "/abilities/speed_aura": [] };

        const firstPreview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        // Same cache key: the second build must hit the module cache.
        const uniqueHrid = "/buff_uniques/speed_aura_attack_speed";
        const firstBuff = firstPreview.finalPlayer.combatBuffs[uniqueHrid];

        // Corrupt *every* object the first build handed out: the buff cloned
        // into finalPlayer, the buff captured in sourceBuffs, the
        // highlightSources array, and a highlight entry.
        firstBuff.ratioBoost = 999;
        const auraAuraSource = firstPreview.highlightSources.find((source) =>
            source.sourceKey?.startsWith("teammate-aura-"),
        );
        auraAuraSource.sourceName = "corrupted";
        auraAuraSource.changedStats = [];

        const secondPreview = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });

        // The fresh build must be unaffected by the first build's mutations:
        // the final buff strength and the highlight attribution are rebuilt
        // from the authoritative cached state.
        const secondBuff = secondPreview.finalPlayer.combatBuffs[uniqueHrid];
        expect(secondBuff.ratioBoost).toBeCloseTo(0.03 * (1 + 100 * 0.005), 10);
        expect(secondPreview.highlightSources.some((source) => source.sourceKey?.startsWith("teammate-aura-"))).toBe(
            true,
        );
        const secondAuraSource = secondPreview.highlightSources.find((source) =>
            source.sourceKey?.startsWith("teammate-aura-"),
        );
        expect(secondAuraSource.sourceName).toContain("Player 2");
        expect(secondAuraSource.changedStats.length).toBeGreaterThan(0);
    });

    it("flags and caches party preview truncation after the event budget is exhausted", () => {
        const heroConfig = emptyConfig("event-budget-hero");
        const teammateConfig = emptyConfig("event-budget-mate");
        teammateConfig.levels = { ...teammateConfig.levels, intelligence: 600 };
        teammateConfig.abilities = [
            { abilityHrid: "/abilities/fireball", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ];

        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const options = { partyPlayerConfigs: [heroConfig, teammateConfig] };
            const preview = buildCombatPreviewData(heroConfig, null, null, options);

            // Fireball costs only 10 MP and has no cooldown.  Intelligence 600
            // gives the teammate enough opening MP to queue more than 512 casts,
            // so the replay must stop because of maxEvents rather than converge.
            expect(preview.partyAuraPreviewTruncated).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stopped after 512 events"));
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("preview may be incomplete"));

            // The truncated result is cached with its warning flag, instead of
            // being collapsed into the normal null/no-aura cache entry.
            const cachedHit = buildCombatPreviewData(heroConfig, null, null, options);
            expect(cachedHit.partyAuraPreviewTruncated).toBe(true);
            expect(warnSpy).toHaveBeenCalledTimes(1);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("keeps partyAuraPreviewTruncated false for a converging party preview", () => {
        const heroConfig = emptyConfig("1");
        const teammateConfig = withAura(emptyConfig("2"), "/abilities/speed_aura");
        teammateConfig.levels = { ...teammateConfig.levels, attack: 100 };

        // Solo preview (no party configured) must not be marked truncated.
        const solo = buildCombatPreviewData(heroConfig);
        expect(solo.partyAuraPreviewTruncated).toBe(false);

        // A normal party replay settles well within the event budget.
        const withParty = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });
        expect(withParty.partyAuraPreviewTruncated).toBe(false);

        // The same key served from cache must preserve the flag.
        const cachedHit = buildCombatPreviewData(heroConfig, null, null, {
            partyPlayerConfigs: [heroConfig, teammateConfig],
        });
        expect(cachedHit.partyAuraPreviewTruncated).toBe(false);
    });
});
