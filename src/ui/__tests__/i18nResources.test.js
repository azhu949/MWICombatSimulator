import { describe, expect, it } from "vitest";
import enCommon from "../../../locales/en/common.json";
import zhCommon from "../../../locales/zh/common.json";

describe("common locale resources", () => {
    it("defines the trinket equipment label in both supported languages", () => {
        expect(enCommon?.vue?.home?.equipmentLabels?.trinket).toBe("Trinket");
        expect(zhCommon?.vue?.home?.equipmentLabels?.trinket).toBe("饰品");
    });
});
