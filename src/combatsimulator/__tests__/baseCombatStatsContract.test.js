import { describe, expect, it } from "vitest";
import Player from "../player.js";

// Guards the baseCombatStats contract (see CombatUnit.baseCombatStats and
// refreshBaseCombatStats): any direct write to combatDetails.combatStats.X must
// be folded back into the baseline via refreshBaseCombatStats, otherwise the
// next updateCombatDetails silently discards it through resetCombatStatsToBase.
describe("baseCombatStats contract (direct combatStats writes must be folded)", () => {
    it("clearCCs folds its damageTaken zeroing into the recalculation baseline", () => {
        const unit = new Player();
        const curse = {
            uniqueHrid: "/buff_uniques/clear_ccs_curse",
            typeHrid: "/buff_types/damage_taken",
            ratioBoost: 0,
            flatBoost: 0.04,
            duration: 1_000e9,
        };

        // Repeated recalculation while a damage_taken (curse) buff is active
        // settles the derived 0.04 into baseCombatStats — exactly the state a
        // mid-combat CC clear can encounter.
        unit.addBuff(curse, 0, "attacker");
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.damageTaken).toBeCloseTo(0.04);
        expect(unit.baseCombatStats.damageTaken).toBeCloseTo(0.04);

        // clearCCs zeroes the visible stat. Its refresh must carry the zero
        // into the baseline: without it, a later recalculation would first
        // resurrect the cursed value via resetCombatStatsToBase.
        unit.clearCCs();
        expect(unit.combatDetails.combatStats.damageTaken).toBe(0);
        expect(unit.baseCombatStats.damageTaken).toBe(0);

        // The fold is about baseline cleanliness, not buff suppression: with
        // the curse still active, a recalculation re-derives the stat from the
        // buff as usual.
        unit.updateCombatDetails();
        expect(unit.combatDetails.combatStats.damageTaken).toBeCloseTo(0.04);
    });
});
