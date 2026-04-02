import { describe, expect, it } from "vitest";
import { deriveQueueItemStatusName } from "../queueItemStatusPresentation.js";

function translate(key, fallback, params = {}) {
    const table = {
        "common:queue.itemEnhancementChange": "{{name}}: 强化 {{from}} -> {{to}}",
        "common:queue.skillLevelChange": "{{name}}: 等级 {{from}} -> {{to}}",
        "common:queue.itemNameWithMore": "{{name}} +{{count}}",
        "common:queue.triggerLabel": "触发器",
    };
    const template = String(table[key] || fallback || key);
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token) => String(params[token] ?? ""));
}

describe("queueItemStatusPresentation", () => {
    it("localizes equipment enhancement status names", () => {
        expect(deriveQueueItemStatusName([{
            kind: "equipment",
            slot: "ring",
            beforeItemHrid: "/items/ring_of_regeneration",
            afterItemHrid: "/items/ring_of_regeneration",
            beforeEnhancementLevel: 5,
            afterEnhancementLevel: 6,
        }], {
            t: translate,
            resolveItemName: (hrid) => hrid === "/items/ring_of_regeneration" ? "再生之戒" : String(hrid || ""),
        })).toBe("再生之戒: 强化 5 -> 6");
    });

    it("collapses multiple localized changes into a compact summary", () => {
        expect(deriveQueueItemStatusName([{
            kind: "equipment",
            beforeItemHrid: "/items/ring_of_regeneration",
            afterItemHrid: "/items/ring_of_regeneration",
            beforeEnhancementLevel: 5,
            afterEnhancementLevel: 6,
        }, {
            kind: "ability",
            beforeAbilityHrid: "/abilities/fireball",
            afterAbilityHrid: "/abilities/fireball",
            beforeLevel: 1,
            afterLevel: 2,
        }], {
            t: translate,
            resolveItemName: (hrid) => hrid === "/items/ring_of_regeneration" ? "再生之戒" : String(hrid || ""),
            resolveAbilityName: (hrid) => hrid === "/abilities/fireball" ? "火球术" : String(hrid || ""),
        })).toBe("再生之戒: 强化 5 -> 6 +1");
    });
});
