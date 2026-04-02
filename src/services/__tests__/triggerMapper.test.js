import { describe, expect, it } from "vitest";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import {
    applyTriggerStateToTriggerMap,
    buildTriggerChangeDescriptor,
    getComparableTriggerTargetHrids,
    getDefaultTriggerDtosForHrid,
    getEffectiveTriggerState,
} from "../triggerMapper.js";

function findFirstFoodWithDefaultTriggers() {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/food"
        && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers)
        && entry.consumableDetail.defaultCombatTriggers.length > 0
    ));
    return item?.hrid ?? "";
}

function findFirstAbilityWithDefaultTriggers(excludeHrid = "") {
    const ability = Object.values(abilityDetailMap).find((entry) => (
        String(entry?.hrid || "") !== String(excludeHrid || "")
        && entry?.isSpecialAbility !== true
        && Array.isArray(entry?.defaultCombatTriggers)
        && entry.defaultCombatTriggers.length > 0
    ));
    return ability?.hrid ?? "";
}

function createAbilityEntry(abilityHrid = "") {
    return {
        abilityHrid: String(abilityHrid || ""),
        level: 1,
    };
}

describe("triggerMapper", () => {
    it("treats missing entries as default triggers and explicit empty entries as disabled", () => {
        const foodHrid = findFirstFoodWithDefaultTriggers();
        expect(foodHrid).toBeTruthy();

        const defaultTriggers = getDefaultTriggerDtosForHrid(foodHrid);
        expect(defaultTriggers.length).toBeGreaterThan(0);

        expect(getEffectiveTriggerState({}, foodHrid)).toEqual({
            targetHrid: foodHrid,
            state: "default",
            triggers: defaultTriggers,
            signature: JSON.stringify(defaultTriggers),
        });
        expect(getEffectiveTriggerState({ [foodHrid]: [] }, foodHrid)).toEqual({
            targetHrid: foodHrid,
            state: "disabled",
            triggers: [],
            signature: "[]",
        });
    });

    it("compares effective trigger semantics instead of raw storage shape", () => {
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        expect(abilityHrid).toBeTruthy();

        const defaultTriggers = getDefaultTriggerDtosForHrid(abilityHrid);
        expect(defaultTriggers.length).toBeGreaterThan(0);

        expect(getEffectiveTriggerState({
            [abilityHrid]: defaultTriggers,
        }, abilityHrid)).toEqual({
            targetHrid: abilityHrid,
            state: "default",
            triggers: defaultTriggers,
            signature: JSON.stringify(defaultTriggers),
        });
        expect(buildTriggerChangeDescriptor({}, {
            [abilityHrid]: defaultTriggers,
        }, abilityHrid)).toBeNull();
        expect(buildTriggerChangeDescriptor({
            [abilityHrid]: defaultTriggers,
        }, {
            [abilityHrid]: [],
        }, abilityHrid)).toMatchObject({
            targetHrid: abilityHrid,
            beforeState: "default",
            afterState: "disabled",
        });
        expect(buildTriggerChangeDescriptor({}, {
            [abilityHrid]: [],
        }, abilityHrid)).toMatchObject({
            targetHrid: abilityHrid,
            beforeState: "default",
            afterState: "disabled",
        });
    });

    it("collects trigger targets that remain active after slot swaps", () => {
        const foodHrid = findFirstFoodWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        const otherAbilityHrid = findFirstAbilityWithDefaultTriggers(abilityHrid);
        expect(foodHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();
        expect(otherAbilityHrid).toBeTruthy();

        const baseline = {
            food: [foodHrid, "", ""],
            drinks: ["", "", ""],
            abilities: [createAbilityEntry(abilityHrid), createAbilityEntry(), createAbilityEntry(), createAbilityEntry(), createAbilityEntry()],
        };
        const candidate = {
            food: [foodHrid, "", ""],
            drinks: ["", "", ""],
            abilities: [createAbilityEntry(otherAbilityHrid), createAbilityEntry(), createAbilityEntry(), createAbilityEntry(), createAbilityEntry()],
        };

        expect(getComparableTriggerTargetHrids(baseline, candidate)).toEqual([foodHrid, otherAbilityHrid]);
    });

    it("ignores removed targets when the edited build has no active trigger owners", () => {
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        expect(abilityHrid).toBeTruthy();

        const baseline = {
            food: ["", "", ""],
            drinks: ["", "", ""],
            abilities: [createAbilityEntry(abilityHrid), createAbilityEntry(), createAbilityEntry(), createAbilityEntry(), createAbilityEntry()],
        };
        const candidate = {
            food: ["", "", ""],
            drinks: ["", "", ""],
            abilities: [createAbilityEntry(), createAbilityEntry(), createAbilityEntry(), createAbilityEntry(), createAbilityEntry()],
        };

        expect(getComparableTriggerTargetHrids(baseline, candidate)).toEqual([]);
    });

    it("applies default trigger state by removing explicit trigger map entries", () => {
        const foodHrid = findFirstFoodWithDefaultTriggers();
        expect(foodHrid).toBeTruthy();

        const triggerMap = {
            [foodHrid]: [],
        };

        applyTriggerStateToTriggerMap(triggerMap, foodHrid, "default");
        expect(triggerMap).toEqual({});
    });
});
