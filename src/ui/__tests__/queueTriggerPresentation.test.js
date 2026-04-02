import { describe, expect, it } from "vitest";
import {
    buildTriggerChangeLabel,
    formatQueueTriggerDetailLine,
} from "../queueTriggerPresentation.js";

function translate(_key, fallback) {
    const table = {
        "common:queue.triggerLabel": "Trigger",
        "common:queue.triggerState.default": "Default",
        "common:queue.triggerState.custom": "Custom",
        "common:queue.triggerState.disabled": "Disabled",
        "combatTriggerDependencyNames./combat_trigger_dependencies/targeted_enemy": "Target Enemy's",
        "combatTriggerConditionNames./combat_trigger_conditions/current_hp": "Current Hp",
        "combatTriggerConditionNames./combat_trigger_conditions/number_of_active_units": "# of Active Units",
        "combatTriggerComparatorNames./combat_trigger_comparators/greater_than_equal": ">=",
    };
    return String(table[_key] || fallback || "");
}

function resolveTargetName(targetHrid) {
    if (targetHrid === "/abilities/fireball") {
        return "Fireball";
    }
    if (targetHrid === "/items/sandwich") {
        return "Sandwich";
    }
    return String(targetHrid || "");
}

describe("queueTriggerPresentation", () => {
    it("formats default to custom trigger changes", () => {
        expect(formatQueueTriggerDetailLine({
            targetHrid: "/abilities/fireball",
            beforeState: "default",
            afterState: "custom",
        }, {
            t: translate,
            resolveTargetName,
        })).toBe("Trigger Fireball: Default -> Custom");
    });

    it("formats custom to disabled trigger changes", () => {
        expect(formatQueueTriggerDetailLine({
            label: buildTriggerChangeLabel("/items/sandwich"),
            beforeState: "custom",
            afterState: "disabled",
        }, {
            t: translate,
            resolveTargetName,
        })).toBe("Trigger Sandwich: Custom -> Disabled");
    });

    it("formats disabled to default trigger changes", () => {
        expect(formatQueueTriggerDetailLine({
            targetHrid: "/abilities/fireball",
            beforeState: "disabled",
            afterState: "default",
        }, {
            t: translate,
            resolveTargetName,
        })).toBe("Trigger Fireball: Disabled -> Default");
    });

    it("includes readable trigger rule summaries when both sides are custom", () => {
        expect(formatQueueTriggerDetailLine({
            targetHrid: "/abilities/fireball",
            beforeState: "custom",
            afterState: "custom",
            beforeTriggers: [{
                dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
                conditionHrid: "/combat_trigger_conditions/number_of_active_units",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 1,
            }, {
                dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
                conditionHrid: "/combat_trigger_conditions/current_hp",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 85,
            }],
            afterTriggers: [{
                dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
                conditionHrid: "/combat_trigger_conditions/number_of_active_units",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 1,
            }, {
                dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
                conditionHrid: "/combat_trigger_conditions/current_hp",
                comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
                value: 60,
            }],
        }, {
            t: translate,
            resolveTargetName,
        })).toBe("Trigger Fireball: Target Enemy's # of Active Units >= 1 / Target Enemy's Current Hp >= 85 -> Target Enemy's # of Active Units >= 1 / Target Enemy's Current Hp >= 60");
    });
});
