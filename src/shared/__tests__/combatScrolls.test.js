import { describe, expect, it, vi } from "vitest";
import gameDataIndex from "../gameDataIndex.generated.json";
import {
    COMBAT_ACTION_TYPE_HRID,
    COMBAT_SCROLL_CATEGORY_HRID,
    COMBAT_SCROLL_DURATION_NS,
    combatScrollOptions,
    getCombatScrollDefinition,
    getCombatScrollOptions,
    getCombatScrollBuffTemplate,
    normalizeCombatScrollQuantity,
    normalizeCombatScrolls,
} from "../combatScrolls.js";

const itemDetailMap = gameDataIndex?.combatScrollItemDetailIndex || {};
const personalBuffTypeDetailMap = gameDataIndex?.personalBuffTypeDetailIndex || {};

describe("combatScrolls", () => {
    it("discovers exactly the combat-valid official scrolls", () => {
        expect(combatScrollOptions).toHaveLength(7);
        expect(combatScrollOptions.every((option) => (
            option.durationNs === COMBAT_SCROLL_DURATION_NS
            && option.usableInActionTypeMap[COMBAT_ACTION_TYPE_HRID] === true
        ))).toBe(true);

        const itemHrids = combatScrollOptions.map((option) => option.itemHrid);
        expect(itemHrids).toEqual([
            "/items/seal_of_combat_drop",
            "/items/seal_of_attack_speed",
            "/items/seal_of_cast_speed",
            "/items/seal_of_damage",
            "/items/seal_of_critical_rate",
            "/items/seal_of_wisdom",
            "/items/seal_of_rare_find",
        ]);

        for (const nonCombatHrid of [
            "/items/seal_of_action_speed",
            "/items/seal_of_efficiency",
            "/items/seal_of_gathering",
            "/items/seal_of_gourmet",
            "/items/seal_of_processing",
        ]) {
            expect(getCombatScrollDefinition(nonCombatHrid)).toBeNull();
        }

        expect(Object.fromEntries(combatScrollOptions.map((option) => [option.itemHrid, {
            typeHrid: option.buff.typeHrid,
            ratioBoost: option.buff.ratioBoost,
            flatBoost: option.buff.flatBoost,
        }]))).toEqual({
            "/items/seal_of_combat_drop": {
                typeHrid: "/buff_types/combat_drop_quantity",
                ratioBoost: 0,
                flatBoost: 0.15,
            },
            "/items/seal_of_attack_speed": {
                typeHrid: "/buff_types/attack_speed",
                ratioBoost: 0.15,
                flatBoost: 0,
            },
            "/items/seal_of_cast_speed": {
                typeHrid: "/buff_types/cast_speed",
                ratioBoost: 0,
                flatBoost: 0.15,
            },
            "/items/seal_of_damage": {
                typeHrid: "/buff_types/damage",
                ratioBoost: 0.08,
                flatBoost: 0,
            },
            "/items/seal_of_critical_rate": {
                typeHrid: "/buff_types/critical_rate",
                ratioBoost: 0,
                flatBoost: 0.1,
            },
            "/items/seal_of_wisdom": {
                typeHrid: "/buff_types/wisdom",
                ratioBoost: 0,
                flatBoost: 0.2,
            },
            "/items/seal_of_rare_find": {
                typeHrid: "/buff_types/rare_find",
                ratioBoost: 0,
                flatBoost: 0.6,
            },
        });
    });

    it("exposes official buff templates without sharing mutable data", () => {
        const damage = getCombatScrollDefinition("/items/seal_of_damage");
        expect(damage?.buff.ratioBoost).toBeCloseTo(0.08);
        expect(damage?.buff.typeHrid).toBe("/buff_types/damage");

        const template = getCombatScrollBuffTemplate("/items/seal_of_damage");
        template.ratioBoost = 99;
        expect(getCombatScrollBuffTemplate("/items/seal_of_damage").ratioBoost).toBeCloseTo(0.08);

    });

    it("drops malformed official templates safely", () => {
        const malformed = {
            ...itemDetailMap,
            "/items/bad_scroll": {
                hrid: "/items/bad_scroll",
                name: "Bad Scroll",
                categoryHrid: "/item_categories/scroll",
                scrollDetail: { personalBuffTypeHrid: "/personal_buff_types/bad" },
            },
        };
        const options = getCombatScrollOptions({
            itemDetailMap: malformed,
            personalBuffTypeDetailMap: {
                ...personalBuffTypeDetailMap,
                "/personal_buff_types/bad": {
                    hrid: "/personal_buff_types/bad",
                    usableInActionTypeMap: { [COMBAT_ACTION_TYPE_HRID]: true },
                    buff: { uniqueHrid: "/buff_uniques/bad", typeHrid: "/buff_types/bad", duration: 0 },
                },
            },
        });
        expect(options.some((option) => option.itemHrid === "/items/bad_scroll")).toBe(false);
    });

    it("keeps valid non-default durations visible and warns once", () => {
        const itemHrid = "/items/future_duration_scroll";
        const personalHrid = "/personal_buff_types/future_duration_scroll";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const customItems = {
            [itemHrid]: {
                hrid: itemHrid,
                name: "Future Duration Scroll",
                categoryHrid: COMBAT_SCROLL_CATEGORY_HRID,
                scrollDetail: { personalBuffTypeHrid: personalHrid },
            },
        };
        const customBuffs = {
            [personalHrid]: {
                hrid: personalHrid,
                name: "Future Duration Scroll",
                sortIndex: 1,
                usableInActionTypeMap: { [COMBAT_ACTION_TYPE_HRID]: true },
                buff: {
                    uniqueHrid: "/buff_uniques/future_duration_scroll",
                    typeHrid: "/buff_types/damage",
                    duration: 15 * 60 * 1e9,
                },
            },
        };

        try {
            const options = getCombatScrollOptions({
                itemDetailMap: customItems,
                personalBuffTypeDetailMap: customBuffs,
            });
            expect(options).toHaveLength(1);
            expect(options[0].durationNs).toBe(15 * 60 * 1e9);
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toContain(itemHrid);

            getCombatScrollOptions({
                itemDetailMap: customItems,
                personalBuffTypeDetailMap: customBuffs,
            });
            expect(warnSpy).toHaveBeenCalledTimes(1);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("normalizes enabled rows, unlimited quantities, and invalid imports", () => {
        expect(normalizeCombatScrollQuantity(null)).toBeNull();
        expect(normalizeCombatScrollQuantity("   ")).toBeNull();
        expect(normalizeCombatScrollQuantity("3")).toBe(3);
        expect(normalizeCombatScrollQuantity(true)).toBeUndefined();
        expect(normalizeCombatScrollQuantity(false)).toBeUndefined();
        expect(normalizeCombatScrollQuantity(-1)).toBeUndefined();

        expect(normalizeCombatScrolls({
            "/items/seal_of_damage": { quantity: 3 },
            "/items/seal_of_wisdom": { quantity: "" },
            "/items/seal_of_attack_speed": {},
            "/items/seal_of_cast_speed": { quantity: 0 },
            "/items/seal_of_critical_rate": { quantity: -1 },
            "/items/seal_of_rare_find": { quantity: 1.5 },
            "/items/seal_of_action_speed": { quantity: 2 },
            "/items/not_a_scroll": { quantity: 2 },
            "/items/seal_of_damage_disabled": { enabled: false, quantity: 2 },
        })).toEqual({
            "/items/seal_of_damage": { quantity: 3 },
            "/items/seal_of_wisdom": { quantity: null },
            "/items/seal_of_attack_speed": { quantity: null },
        });

        expect(normalizeCombatScrolls({
            "/items/seal_of_damage": -1,
            "/items/seal_of_wisdom": false,
        })).toEqual({});

        expect(normalizeCombatScrolls({
            "/items/seal_of_damage": { quantity: Number.MAX_SAFE_INTEGER + 1 },
        })).toEqual({});
    });
});
