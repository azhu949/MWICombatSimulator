import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enTranslationPath = path.resolve(__dirname, "../../../../locales/en/translation.json");
const zhTranslationPath = path.resolve(__dirname, "../../../../locales/zh/translation.json");
const enCommonPath = path.resolve(__dirname, "../../../../locales/en/common.json");
const zhCommonPath = path.resolve(__dirname, "../../../../locales/zh/common.json");

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

describe("local english translation data", () => {
    it("keeps translation.json in locales instead of public/locales", () => {
        expect(fs.existsSync(enTranslationPath)).toBe(true);
    });

    it("does not keep duplicated abilityNames and abilityDescriptions maps", () => {
        const enTranslation = readJson(enTranslationPath);

        expect(Object.prototype.hasOwnProperty.call(enTranslation, "abilityNames")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(enTranslation, "abilityDescriptions")).toBe(false);
    });

    it("includes localized names for the enhancement capes", () => {
        const zhTranslation = readJson(zhTranslationPath);

        expect(zhTranslation.itemNames).toMatchObject({
            "/items/labyrinth_essence": "迷宫精华",
            "/items/gatherer_cape": "采集者斗篷",
            "/items/gatherer_cape_refined": "采集者斗篷（精）",
            "/items/artificer_cape": "工匠斗篷",
            "/items/artificer_cape_refined": "工匠斗篷（精）",
            "/items/culinary_cape": "烹饪师斗篷",
            "/items/culinary_cape_refined": "烹饪师斗篷（精）",
            "/items/chance_cape": "幸运斗篷",
            "/items/chance_cape_refined": "幸运斗篷（精）",
        });
    });

    it("includes feedback modal keys in both locale common bundles", () => {
        const enCommon = readJson(enCommonPath);
        const zhCommon = readJson(zhCommonPath);

        expect(enCommon?.vue?.app?.feedback).toBeTypeOf("string");
        expect(enCommon?.vue?.app?.feedbackHint).toBeTypeOf("string");
        expect(enCommon?.vue?.app?.feedbackGitHubAriaLabel).toBeTypeOf("string");
        expect(enCommon?.vue?.app?.feedbackQqLabel).toBeTypeOf("string");
        expect(enCommon?.vue?.app?.feedbackEmailLabel).toBeTypeOf("string");

        expect(zhCommon?.vue?.app?.feedback).toBeTypeOf("string");
        expect(zhCommon?.vue?.app?.feedbackHint).toBeTypeOf("string");
        expect(zhCommon?.vue?.app?.feedbackGitHubAriaLabel).toBeTypeOf("string");
        expect(zhCommon?.vue?.app?.feedbackQqLabel).toBeTypeOf("string");
        expect(zhCommon?.vue?.app?.feedbackEmailLabel).toBeTypeOf("string");
    });
});
