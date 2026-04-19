import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsPageSource = readFileSync(new URL("../pages/SettingsPage.vue", import.meta.url), "utf8");

describe("SettingsPage baseline round defaults", () => {
    it("uses 1 as the default baseline round preset and draft value", () => {
        expect(settingsPageSource).toContain('baselineRounds: 1,');
        expect(settingsPageSource).toContain('const queueBaselineRoundPreset = ref("1");');
        expect(settingsPageSource).toContain('queueRunDraft.baselineRounds = Number(source.baselineRounds ?? 1);');
    });

    it("offers 1 as a selectable preset for baseline rounds", () => {
        expect(settingsPageSource).toContain('<option value="1">1</option>');
        expect(settingsPageSource).toContain('["1", "5", "10", "20", "30", "50", "100", "200"]');
    });
});
