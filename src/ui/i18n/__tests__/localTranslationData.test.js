import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enTranslationPath = path.resolve(__dirname, "../../../../public/locales/en/translation.json");

describe("local english translation data", () => {
    it("does not keep duplicated abilityNames and abilityDescriptions maps", () => {
        const enTranslation = JSON.parse(fs.readFileSync(enTranslationPath, "utf8"));

        expect(Object.prototype.hasOwnProperty.call(enTranslation, "abilityNames")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(enTranslation, "abilityDescriptions")).toBe(false);
    });
});

