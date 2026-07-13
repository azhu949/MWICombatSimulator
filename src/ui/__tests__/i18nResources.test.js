import { describe, expect, it } from "vitest";
import enCommon from "../../../locales/en/common.json";
import zhCommon from "../../../locales/zh/common.json";

describe("common locale resources", () => {
    it("defines the enhancement workspace labels in both supported languages", () => {
        expect(enCommon?.menu?.enhancement).toBe("Enhancement");
        expect(zhCommon?.menu?.enhancement).toBe("强化模拟");
        expect(enCommon?.enhancement?.title).toBe("Enhancement Simulator");
        expect(zhCommon?.enhancement?.title).toBe("强化模拟器");
        expect(zhCommon?.enhancement?.fromZeroPlanTitle).toBe("最低成本制作方案");
        expect(zhCommon?.enhancement?.useMirror).toBe("已使用{{item}}");
        expect(zhCommon?.enhancement?.directEnhancement).toBe("未使用{{item}}");
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

    it("does not duplicate game-defined labels in the common locale", () => {
        for (const common of [enCommon, zhCommon]) {
            expect(common?.vue?.home?.levelLabels).toBeUndefined();
            expect(common?.vue?.home?.equipmentLabels).toBeUndefined();
            expect(common?.vue?.home?.combatStats).toBeUndefined();
            expect(common?.vue?.home?.combatStatsTitle).toBeUndefined();
            expect(common?.vue?.home?.dungeon).toBeUndefined();
            expect(common?.vue?.home?.guildBuffCombat).toBeUndefined();
            expect(common?.vue?.results?.ability).toBeUndefined();
            expect(common?.queue?.changeCategory?.food).toBeUndefined();
            expect(common?.queue?.changeCategory?.drink).toBeUndefined();
            expect(common?.settingsPage?.playerSnapshotTableDungeon).toBeUndefined();
            expect(common?.settingsPage?.playerSnapshotTableLabyrinth).toBeUndefined();
        }
        expect(zhCommon?.enhancement?.observatoryLevel).toBeUndefined();
        expect(zhCommon?.enhancement?.philosophersMirror).toBeUndefined();
    });
});
