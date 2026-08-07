import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guidePageSource = readFileSync(new URL("../pages/GuidePage.vue", import.meta.url), "utf8");
const guidePageEnSource = readFileSync(new URL("../pages/GuidePageEn.vue", import.meta.url), "utf8");
const guideFigureSource = readFileSync(new URL("../components/guide/GuideFigure.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router/index.js", import.meta.url), "utf8");

describe("GuidePage tutorial surface", () => {
    it("registers a guide route without combat controls", () => {
        expect(routerSource).toContain('path: "/guide"');
        expect(routerSource).toContain('name: "guide"');
        expect(routerSource).toContain('import("../pages/GuidePage.vue")');
        expect(routerSource).toContain("meta: { showCombatToolbar: false }");
    });

    it("renders the complete English guide from the global application language", () => {
        expect(routerSource).not.toContain('path: "/guide/en"');
        expect(guidePageSource).toContain('<GuidePageEn v-if="language !== \'zh\'" />');
        expect(guidePageSource).toContain('import { useI18nText }');
        expect(guidePageSource).toContain("const { language } = useI18nText();");
        expect(guidePageSource).not.toContain("GuideLanguageSwitch");
        expect(guidePageEnSource).not.toContain("GuideLanguageSwitch");
        expect(guidePageEnSource).not.toContain("/guide/en");
    });

    it("covers the core and specialist workflows", () => {
        for (const sectionId of [
            "quick-start",
            "combat",
            "queue",
            "advisor",
            "enhancement",
            "skilling",
            "settings",
            "troubleshooting",
        ]) {
            expect(guidePageSource).toContain(`id=\"${sectionId}\"`);
        }

        expect(guidePageSource).toContain("首次使用与数据导入");
        expect(guidePageSource).toContain("回到模拟器点击“从主站导入”");
        expect(guidePageSource).toContain("只有组队数据需要先在游戏主站逐个打开队友资料");
        expect(guidePageSource).toContain("队列与多轮结果");
        expect(guidePageSource).toContain("遇到空状态或按钮不可用");
    });

    it("keeps the full workflow and corrected import instructions in English", () => {
        for (const sectionId of [
            "quick-start",
            "combat",
            "queue",
            "advisor",
            "enhancement",
            "skilling",
            "settings",
            "troubleshooting",
        ]) {
            expect(guidePageEnSource).toContain(`id=\"${sectionId}\"`);
        }

        expect(guidePageEnSource).toContain("Getting Started and Importing Data");
        expect(guidePageEnSource).toContain("click Import from Main Site");
        expect(guidePageEnSource).toContain("Open teammate profiles only for a team import");
        expect(guidePageEnSource).toContain("Queue and Multi-Round Results");
        expect(guidePageEnSource).toContain("Empty States and Disabled Controls");
    });

    it("uses real screenshots with stable dimensions and useful alt text", () => {
        for (const imageName of [
            "import-data.png",
            "home-workspace.png",
            "queue.png",
            "multi-results.png",
            "advisor.png",
            "enhancement.png",
            "skilling.png",
            "settings.png",
        ]) {
            expect(guidePageSource).toContain(`/tutorial/${imageName}`);
            expect(guidePageEnSource).toContain(`/tutorial/${imageName}`);
        }

        expect(guideFigureSource).toContain(':width="width"');
        expect(guideFigureSource).toContain(':height="height"');
        expect(guideFigureSource).toContain(':alt="alt"');
        expect(guideFigureSource).toContain('loading="lazy"');
        expect(guideFigureSource).toContain("import.meta.env.BASE_URL");
        expect(guideFigureSource).toContain(":src=\"resolvedSrc\"");
        expect(guideFigureSource).toContain('{{ openLabel }}');
        expect(guidePageEnSource.match(/open-label="View full image"/g)).toHaveLength(8);
    });
});
