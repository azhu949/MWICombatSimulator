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
        expect(scriptSource).toContain('"houseActionTypeBuffsMap"');
        expect(scriptSource).toContain('"personalActionTypeBuffsMap"');
        expect(scriptSource).toContain('"mooPassActionTypeBuffsMap"');
        expect(scriptSource).toContain('type === "personal_buffs_updated"');
        expect(scriptSource).toContain('type === "moo_pass_buffs_updated"');
        expect(scriptSource).toContain("captureCurrentCharacterDataUpdate(parsed);");
    });

    it("uses a current-character-only request and enhancement bridge target on the enhancement page", () => {
        expect(scriptSource).toContain('data-tm-import-anchor="enhancement-actions"');
        expect(scriptSource).toContain('normalizedImportMode === "player" ? "auto" : "active-player"');
        expect(scriptSource).toContain('importTarget: "enhancement"');
        expect(scriptSource).toContain('enhancementButton: "导入角色强化配置"');
        expect(scriptSource).toContain("// @version      0.1.27");
    });

    it("uses the current character and skilling bridge target on the skilling page", () => {
        expect(scriptSource).toContain('data-tm-import-anchor="skilling-actions"');
        expect(scriptSource).toContain('data-tm-import-reference="skilling-refresh"');
        expect(scriptSource).toContain('importTarget: "skilling"');
        expect(scriptSource).toContain('skillingButton: "导入生活技能快照"');
    });

    it("accepts app bridge responses only from the current window and origin", () => {
        expect(scriptSource).toContain("event.source !== window || event.origin !== window.location.origin");
    });
});
