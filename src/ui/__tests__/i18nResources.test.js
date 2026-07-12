import { describe, expect, it } from "vitest";
import enCommon from "../../../locales/en/common.json";
import zhCommon from "../../../locales/zh/common.json";

describe("common locale resources", () => {
    it("defines the enhancement workspace labels in both supported languages", () => {
        expect(enCommon?.menu?.enhancement).toBe("Enhancement");
        expect(zhCommon?.menu?.enhancement).toBe("强化模拟");
        expect(enCommon?.enhancement?.title).toBe("Enhancement Simulator");
        expect(zhCommon?.enhancement?.title).toBe("强化模拟器");
        expect(enCommon?.enhancement?.philosophersMirror).toBe("Philosopher's Mirror");
        expect(zhCommon?.enhancement?.philosophersMirror).toBe("贤者之镜");
        expect(zhCommon?.enhancement?.fromZeroPlanTitle).toBe("最低成本制作方案");
        expect(zhCommon?.enhancement?.useMirror).toBe("已使用贤者之镜");
        expect(zhCommon?.enhancement?.directEnhancement).toBe("未使用贤者之镜");
        expect(enCommon?.enhancement?.budgetSuccessProbability).toBe("Success within budget");
        expect(zhCommon?.enhancement?.budgetSuccessProbability).toBe("预算内成功率");
        expect(enCommon?.enhancement?.sourceAcquisitionEstimate).toBe("Acquisition estimate");
        expect(zhCommon?.enhancement?.sourceAcquisitionEstimate).toBe("获取估值");
        expect(zhCommon?.enhancement?.acquisitionEstimateSummary).toContain("平均 {{count}} 箱");
        expect(zhCommon?.enhancement?.vendorRecovery).toBe("商店回收 {{value}}");
    });

    it("keeps every enhancement resource key synchronized across locales", () => {
        expect(Object.keys(enCommon?.enhancement || {}).sort()).toEqual(Object.keys(zhCommon?.enhancement || {}).sort());
    });

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
