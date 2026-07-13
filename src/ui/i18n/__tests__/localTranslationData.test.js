import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateTranslationResources } from "../../../../scripts/official-translation-sync.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../../..");
const enTranslationPath = path.resolve(rootDir, "locales/en/translation.official.generated.json");
const zhTranslationPath = path.resolve(rootDir, "locales/zh/translation.official.generated.json");
const sourceManifestPath = path.resolve(rootDir, "locales/official-translation-source.generated.json");
const enCommonPath = path.resolve(__dirname, "../../../../locales/en/common.json");
const zhCommonPath = path.resolve(__dirname, "../../../../locales/zh/common.json");

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

describe("official translation snapshots", () => {
    it("keeps generated snapshots in locales and removes legacy dictionaries", () => {
        expect(fs.existsSync(enTranslationPath)).toBe(true);
        expect(fs.existsSync(zhTranslationPath)).toBe(true);
        expect(fs.existsSync(path.resolve(rootDir, "locales/en/translation.json"))).toBe(false);
        expect(fs.existsSync(path.resolve(rootDir, "locales/zh/translation.json"))).toBe(false);
    });

    it("contains complete official English ability dictionaries", () => {
        const enTranslation = readJson(enTranslationPath);

        expect(Object.keys(enTranslation.abilityNames).length).toBeGreaterThan(0);
        expect(Object.keys(enTranslation.abilityDescriptions).sort()).toEqual(Object.keys(enTranslation.abilityNames).sort());
    });

    it("uses exact official item names without legacy refined aliases", () => {
        const zhTranslation = readJson(zhTranslationPath);

        expect(zhTranslation.itemNames).toMatchObject({
            "/items/labyrinth_essence": "迷宫精华",
            "/items/gatherer_cape": "采集者披风",
            "/items/gatherer_cape_refined": "采集者披风 ★",
            "/items/artificer_cape": "工匠披风",
            "/items/artificer_cape_refined": "工匠披风 ★",
            "/items/culinary_cape": "厨师披风",
            "/items/culinary_cape_refined": "厨师披风 ★",
            "/items/chance_cape": "机缘披风",
            "/items/chance_cape_refined": "机缘披风 ★",
        });
        expect(Object.values(zhTranslation.itemNames)).not.toContain("采集者斗篷");
        expect(Object.values(zhTranslation.itemNames)).not.toContain("采集者斗篷（精）");
    });

    it("matches every tracked HRID and the recorded resource hashes", async () => {
        const enContent = fs.readFileSync(enTranslationPath, "utf8");
        const zhContent = fs.readFileSync(zhTranslationPath, "utf8");
        const enTranslation = JSON.parse(enContent);
        const zhTranslation = JSON.parse(zhContent);
        const sourceManifest = readJson(sourceManifestPath);

        const validation = await validateTranslationResources({ en: enTranslation, zh: zhTranslation }, { rootDir });

        expect(validation.domainCount).toBe(sourceManifest.resources.en.topLevelKeyCount);
        expect(Object.keys(zhTranslation)).toHaveLength(sourceManifest.resources.zh.topLevelKeyCount);
        expect(sourceManifest.source.manifest.path).toBe("/asset-manifest.json");
        expect(sourceManifest.source.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(sourceManifest.resources.en.sha256).toBe(sha256(enContent));
        expect(sourceManifest.resources.zh.sha256).toBe(sha256(zhContent));
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
