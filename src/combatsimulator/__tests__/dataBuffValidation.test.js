import { describe, expect, it } from "vitest";
import {
    assertBuffShapesValid,
    collectAbilityBuffShapes,
    collectItemBuffShapes,
    validateBuffShape,
} from "../dataBuffValidation.js";

describe("dataBuffValidation", () => {
    it("passes for the checked-in ability and consumable buff data", () => {
        // Runs at module load via the side-effect import in combatSimulator.js.
        // This test re-runs the assertion explicitly so a failure is reported
        // in the right test scope instead of appearing as a module import error.
        expect(() => assertBuffShapesValid()).not.toThrow();
    });

    it("reports ability buff shape violations with a data-path context", () => {
        const badBuff = { uniqueHrid: "", typeHrid: "/buff_types/damage", ratioBoost: NaN, flatBoost: 0, duration: 1 };
        const failures = collectAbilityBuffShapes({
            "/abilities/bad": { abilityEffects: [{ effectType: "/ability_effect_types/buff", buffs: [badBuff] }] },
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain("ability /abilities/bad");
        expect(failures[0]).toContain("uniqueHrid");
        expect(failures[0]).toContain("ratioBoost");
    });

    it("reports consumable buff shape violations with a data-path context", () => {
        const badBuff = { uniqueHrid: "/buff_uniques/bad", typeHrid: "", ratioBoost: 0, flatBoost: "abc", duration: 1 };
        const failures = collectItemBuffShapes({
            "/items/drink": { consumableDetail: { buffs: [badBuff] } },
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain("item /items/drink");
        expect(failures[0]).toContain("typeHrid");
        expect(failures[0]).toContain("flatBoost");
    });

    it("skips items without consumable buffs", () => {
        const failures = collectItemBuffShapes({
            "/items/equipment": { equipmentType: "weapon" },
            "/items/scroll": { consumableDetail: { buffs: [] } },
        });
        expect(failures).toHaveLength(0);
    });

    it("throws a combined error from assertBuffShapesValid when multiple buffs are broken", () => {
        const badAbility = {
            "/abilities/test": {
                abilityEffects: [{ effectType: "/ability_effect_types/buff", buffs: [{ uniqueHrid: "", typeHrid: "", ratioBoost: 0, flatBoost: 0, duration: 0 }] }],
            },
        };
        const badItem = {
            "/items/drink": { consumableDetail: { buffs: [{ uniqueHrid: "/buff_uniques/ok", typeHrid: "", ratioBoost: 0, flatBoost: 0, duration: 1 }] } },
        };
        expect(() => assertBuffShapesValid({ abilityMap: badAbility, itemMap: badItem })).toThrow("2 malformed buff record(s)");
    });

    it("validateBuffShape throws TypeError for known invalid fields", () => {
        expect(() => validateBuffShape({}, "test")).toThrow(TypeError);
        expect(() => validateBuffShape({ uniqueHrid: "/u", typeHrid: "/t", ratioBoost: "x", flatBoost: 0, duration: 1 }, "test")).toThrow("ratioBoost");
        // Missing duration (addBuff would reject with NaN).
        expect(() => validateBuffShape({ uniqueHrid: "/u", typeHrid: "/t", ratioBoost: 0, flatBoost: 0 }, "test")).toThrow("duration");
    });
});