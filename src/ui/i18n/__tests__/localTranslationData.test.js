import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enTranslationPath = path.resolve(__dirname, "../../../../locales/en/translation.json");
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
