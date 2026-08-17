import { describe, expect, it } from "vitest";
import Trigger from "../trigger.js";

const SELF_DEPENDENCY_HRID = "/combat_trigger_dependencies/self";
const INVINCIBLE_CONDITION_HRID = "/combat_trigger_conditions/invincible";
const INVINCIBLE_BUFF_HRID = "/buff_uniques/invincible_armor";

function createInvincibleTrigger(comparator) {
    return new Trigger(
        SELF_DEPENDENCY_HRID,
        INVINCIBLE_CONDITION_HRID,
        `/combat_trigger_comparators/${comparator}`,
    );
}

function createSource(hasInvincibleBuff) {
    return {
        combatBuffs: hasInvincibleBuff
            ? { [INVINCIBLE_BUFF_HRID]: { uniqueHrid: INVINCIBLE_BUFF_HRID } }
            : {},
    };
}

describe("Trigger invincible condition", () => {
    it.each([
        ["is_active", true, true],
        ["is_active", false, false],
        ["is_inactive", true, false],
        ["is_inactive", false, true],
    ])("evaluates %s with buff presence %s as %s", (comparator, hasInvincibleBuff, expected) => {
        const trigger = createInvincibleTrigger(comparator);

        expect(trigger.isActive(createSource(hasInvincibleBuff), null, [], [], 0)).toBe(expected);
    });
});
