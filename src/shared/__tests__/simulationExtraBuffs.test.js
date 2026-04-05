import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSimulationExtraBuffs } from "../simulationExtraBuffs.js";

afterEach(() => {
    vi.resetModules();
    vi.unmock("../../combatsimulator/data/communityBuffTypeDetailMap.json");
});

describe("simulationExtraBuffs", () => {
    it("keeps moo pass at a fixed 5% wisdom buff", () => {
        const buffs = buildSimulationExtraBuffs({ mooPass: true, comExp: 0, comDrop: 0 });

        expect(buffs).toHaveLength(1);
        expect(buffs[0]).toMatchObject({
            uniqueHrid: "/buff_uniques/experience_moo_pass_buff",
            typeHrid: "/buff_types/wisdom",
            ratioBoost: 0,
            flatBoost: 0.05,
        });
    });

    it("builds the community experience buff from the official template", () => {
        const buffs = buildSimulationExtraBuffs({ mooPass: false, comExp: 20, comDrop: 0 });

        expect(buffs).toHaveLength(1);
        expect(buffs[0].uniqueHrid).toBe("/buff_uniques/experience_community_buff");
        expect(buffs[0].typeHrid).toBe("/buff_types/wisdom");
        expect(buffs[0].ratioBoost).toBe(0);
        expect(buffs[0].flatBoost).toBeCloseTo(0.295, 6);
    });

    it("builds the community combat drop buff from the official template", () => {
        const buffs = buildSimulationExtraBuffs({ mooPass: false, comExp: 0, comDrop: 20 });

        expect(buffs).toHaveLength(1);
        expect(buffs[0].uniqueHrid).toBe("/buff_uniques/combat_community_buff");
        expect(buffs[0].typeHrid).toBe("/buff_types/combat_drop_quantity");
        expect(buffs[0].ratioBoost).toBe(0);
        expect(buffs[0].flatBoost).toBeCloseTo(0.295, 6);
    });

    it("preserves the existing total wisdom boost when moo pass and community exp are both enabled", () => {
        const buffs = buildSimulationExtraBuffs({ mooPass: true, comExp: 20, comDrop: 0 });
        const totalWisdomBoost = buffs
            .filter((buff) => buff.typeHrid === "/buff_types/wisdom")
            .reduce((sum, buff) => sum + Number(buff.flatBoost || 0), 0);

        expect(totalWisdomBoost).toBeCloseTo(0.345, 6);
    });

    it("falls back to the legacy formula when the community buff template is unavailable", async () => {
        vi.doMock("../../combatsimulator/data/communityBuffTypeDetailMap.json", () => ({
            default: {},
        }));

        const { buildSimulationExtraBuffs: buildFallbackBuffs } = await import("../simulationExtraBuffs.js");
        const buffs = buildFallbackBuffs({ mooPass: false, comExp: 20, comDrop: 20 });

        expect(buffs).toHaveLength(2);
        expect(buffs[0].uniqueHrid).toBe("/buff_uniques/experience_community_buff");
        expect(buffs[0].typeHrid).toBe("/buff_types/wisdom");
        expect(buffs[0].flatBoost).toBeCloseTo(0.295, 6);
        expect(buffs[1].uniqueHrid).toBe("/buff_uniques/combat_community_buff");
        expect(buffs[1].typeHrid).toBe("/buff_types/combat_drop_quantity");
        expect(buffs[1].flatBoost).toBeCloseTo(0.295, 6);
    });
});
