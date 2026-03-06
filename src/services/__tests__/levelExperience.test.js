import { describe, expect, it } from "vitest";
import {
    calculateSkillUpgradeEta,
    getMaxSkillLevelWithExperienceTable,
    getSkillLevelExperience,
} from "../levelExperience.js";

describe("levelExperience", () => {
    it("returns current skill experience thresholds", () => {
        expect(getSkillLevelExperience(1)).toBe(0);
        expect(getSkillLevelExperience(2)).toBe(33);
        expect(getSkillLevelExperience(100)).toBe(10000000);
        expect(getSkillLevelExperience(getMaxSkillLevelWithExperienceTable())).toBe(100000000000);
    });

    it("calculates ETA from current xp and xp rate", () => {
        const result = calculateSkillUpgradeEta({
            currentLevel: 10,
            currentExperience: 900,
            targetLevel: 11,
            xpPerHour: 500,
        });

        expect(result.status).toBe("ok");
        expect(result.xpNeeded).toBe(964 - 900);
        expect(result.hoursNeeded).toBeCloseTo((964 - 900) / 500, 10);
    });

    it("does not calculate ETA when target level is not higher", () => {
        const result = calculateSkillUpgradeEta({
            currentLevel: 20,
            currentExperience: 40000,
            targetLevel: 20,
            xpPerHour: 1000,
        });

        expect(result.status).toBe("not_applicable");
    });

    it("reports explicit status for missing progress and rate", () => {
        expect(calculateSkillUpgradeEta({
            currentLevel: 20,
            currentExperience: null,
            targetLevel: 21,
            xpPerHour: 1000,
        }).status).toBe("missing_current_experience");

        expect(calculateSkillUpgradeEta({
            currentLevel: 20,
            currentExperience: 50000,
            targetLevel: 21,
            xpPerHour: null,
        }).status).toBe("missing_xp_rate");

        expect(calculateSkillUpgradeEta({
            currentLevel: 20,
            currentExperience: 50000,
            targetLevel: 21,
            xpPerHour: 0,
        }).status).toBe("zero_xp_rate");
    });

    it("reports out of range target levels", () => {
        const result = calculateSkillUpgradeEta({
            currentLevel: 199,
            currentExperience: getSkillLevelExperience(199),
            targetLevel: 400,
            xpPerHour: 100000,
        });

        expect(result.status).toBe("target_out_of_range");
    });
});
