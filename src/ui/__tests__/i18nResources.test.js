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

    it("defines synchronized skilling workspace labels", () => {
        expect(enCommon?.menu?.skilling).toBe("Skilling");
        expect(zhCommon?.menu?.skilling).toBe("生活技能");
        expect(enCommon?.skilling?.title).toBe("Skilling Upgrade Planner");
        expect(zhCommon?.skilling?.title).toBe("生活技能升级推荐器");
        expect(zhCommon?.skilling?.balanced).toBe("均衡");
        expect(zhCommon?.skilling?.runScope).toBe("模拟范围");
        expect(zhCommon?.skilling?.runScopeSingle).toBe("单项");
        expect(zhCommon?.skilling?.runScopeAll).toBe("全部");
        expect(zhCommon?.skilling?.simulationSkill).toBe("指定技能");
        expect(zhCommon?.skilling?.allSkills).toBe("全部技能");
        expect(zhCommon?.skilling?.calculateAll).toBe("计算全部");
        expect(zhCommon?.skilling?.calculateSelected).toContain("{{skill}}");
        expect(zhCommon?.skilling?.optimizationModeHelp).toBe("优化模式说明");
        expect(zhCommon?.skilling?.materialPurchasePerXp).toBe("材料补购/经验");
        expect(zhCommon?.skilling?.balancedModeDescription).toContain("最低净成本/经验");
        expect(zhCommon?.skilling?.balancedModeDescription).toContain("基准 + |基准| × {{percent}}%");
        expect(zhCommon?.skilling?.balancedCostTolerance).toBe("成本容忍度");
        expect(zhCommon?.skilling?.balancedCostToleranceHint).toContain("当前等级净成本/经验");
        expect(zhCommon?.skilling?.balancedCostToleranceChanged).toContain("{{resultPercent}}%");
        expect(enCommon?.skilling?.balancedModeDescription).toContain("full-level route");
        expect(enCommon?.skilling?.balancedModeDescription).toContain("baseline + {{percent}}% of |baseline|");
        expect(enCommon?.skilling?.balancedCostTolerancePercent).toContain("percentage");
        expect(zhCommon?.skilling?.stageLevel).toBe("阶段等级");
        expect(zhCommon?.skilling?.stageDetails).toBe("执行阶段");
        expect(zhCommon?.skilling?.stageCount).toContain("{{count}}");
        expect(zhCommon?.skilling?.multipleRecipes).toContain("{{count}} 个配方");
        expect(zhCommon?.skilling?.totalDrinks).toBe("饮品总计");
        expect(zhCommon?.skilling?.routeDetailsWithRange).toContain("{{range}}");
        expect(zhCommon?.skilling?.rangeDetailsAriaLabel).toContain("{{skill}}");
        expect(zhCommon?.skilling?.levelInProgress).toContain("升级中");
        expect(zhCommon?.skilling?.drinkContinued).toBe("续用");
        expect(zhCommon?.skilling?.drinkRemaining).toContain("末余");
        expect(zhCommon?.skilling?.noDrinks).toBe("本段无需新增饮品");
        expect(zhCommon?.skilling?.noCandidateDrinks).toBe("无");
        expect(zhCommon?.skilling?.stagedEquipment).toContain("分阶段切换");
        expect(zhCommon?.skilling?.nextLevelActions).toBe("预计升下一级动作");
        expect(zhCommon?.skilling?.quantity).toBe("数量");
        expect(zhCommon?.skilling?.nextLevelDrinks).toBe("升下一级饮品");
        expect(zhCommon?.skilling?.nextLevelCostPerXp).toBe("升下一级净成本/经验");
        expect(zhCommon?.skilling?.nextLevelPurchaseCost).toBe("升下一级补购金额");
        expect(zhCommon?.skilling?.nextLevelCandidateDetails).toBe("升下一级候选明细");
        expect(zhCommon?.skilling?.currentLevelAlternatives).toBe("当前等级候选对比");
        expect(enCommon?.skilling?.drinkUsedUp).toContain("used up");
        expect(Object.keys(enCommon?.skilling || {}).sort()).toEqual(Object.keys(zhCommon?.skilling || {}).sort());
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
