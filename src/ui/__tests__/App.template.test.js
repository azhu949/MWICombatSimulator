import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.vue", import.meta.url), "utf8");

describe("App header support links", () => {
    it("renders GitHub and feedback entry points in the header", () => {
        expect(appSource).toContain("https://github.com/azhu949/MWICombatSimulator");
        expect(appSource).not.toContain("__REPOSITORY_URL__");
        expect(appSource).toContain('t("common:vue.app.feedback", "Feedback")');
        expect(appSource).toContain('t("common:vue.app.feedbackGitHubAriaLabel", "GitHub Repository")');
    });

    it("renders feedback modal contact details", () => {
        expect(appSource).toContain("596846069");
        expect(appSource).toContain("mailto:596846069@qq.com");
        expect(appSource).toContain("copyFeedbackContact");
        expect(appSource).toContain('t("common:vue.app.feedbackHint", "Use the following channels for feedback, bug reports, or suggestions.")');
        expect(appSource).toContain('t("common:vue.app.feedbackQqLabel", "QQ")');
        expect(appSource).toContain('t("common:vue.app.feedbackEmailLabel", "QQ Email")');
    });
});
