import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scriptSource = readFileSync(new URL("../mwi-main-site-import.user.js", import.meta.url), "utf8");

describe("mwi main-site import userscript", () => {
    it("captures enhancement-related current-character snapshot fields", () => {
        expect(scriptSource).toContain('"communityBuffs"');
        expect(scriptSource).toContain('"communityActionTypeBuffsMap"');
        expect(scriptSource).toContain('"achievementActionTypeBuffsMap"');
        expect(scriptSource).toContain('type === "skills_updated"');
        expect(scriptSource).toContain('type === "items_updated"');
        expect(scriptSource).toContain('type === "house_rooms_updated"');
        expect(scriptSource).toContain('type === "achievements_updated"');
        expect(scriptSource).toContain('type === "community_buffs_updated"');
        expect(scriptSource).toContain('"characterGuildBuffMap"');
        expect(scriptSource).toContain('"guildBuildingLevelMap"');
        expect(scriptSource).toContain('type === "guild_buffs_updated"');
        expect(scriptSource).toContain('type === "guild_updated"');
        expect(scriptSource).toContain('if (reset || type === "guild_buffs_updated")');
        expect(scriptSource).toContain('nextFields.characterGuildBuffMap = hasOwnKey(message, "characterGuildBuffMap")');
        expect(scriptSource).toContain('if (reset || type === "guild_updated")');
        expect(scriptSource).toContain('nextFields.guildBuildingLevelMap = hasOwnKey(message, "guildBuildingLevelMap")');
        expect(scriptSource).toContain("captureCurrentCharacterDataUpdate(parsed);");
    });

    it("uses a current-character-only request and enhancement bridge target on the enhancement page", () => {
        expect(scriptSource).toContain('data-tm-import-anchor="enhancement-actions"');
        expect(scriptSource).toContain('normalizedImportMode === "enhancement" ? "active-player" : "auto"');
        expect(scriptSource).toContain('importTarget: "enhancement"');
        expect(scriptSource).toContain('enhancementButton: "导入角色强化配置"');
        expect(scriptSource).toContain("// @version      0.1.26");
    });
});
