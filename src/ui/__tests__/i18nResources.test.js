import { describe, expect, it } from "vitest";
import enCommon from "../../../locales/en/common.json";
import zhCommon from "../../../locales/zh/common.json";

describe("common locale resources", () => {
    it("defines the trinket equipment label in both supported languages", () => {
        expect(enCommon?.vue?.home?.equipmentLabels?.trinket).toBe("Trinket");
        expect(zhCommon?.vue?.home?.equipmentLabels?.trinket).toBe("饰品");
    });

    it("defines the battle attribute drop labels in both supported languages", () => {
        expect(enCommon?.vue?.home?.combatStats?.combatDropRate).toBe("Drop Rate");
        expect(enCommon?.vue?.home?.combatStats?.combatRareFind).toBe("Rare Find");
        expect(enCommon?.vue?.home?.combatStats?.combatDropQuantity).toBe("Drop Quantity");
        expect(zhCommon?.vue?.home?.combatStats?.combatDropRate).toBe("掉落率");
        expect(zhCommon?.vue?.home?.combatStats?.combatRareFind).toBe("稀有发现");
        expect(zhCommon?.vue?.home?.combatStats?.combatDropQuantity).toBe("掉落数量");
    });

    it("defines the retaliation battle attribute label in both supported languages", () => {
        expect(enCommon?.vue?.home?.combatStats?.retaliation).toBe("Retaliation");
        expect(zhCommon?.vue?.home?.combatStats?.retaliation).toBe("反击");
    });
});
