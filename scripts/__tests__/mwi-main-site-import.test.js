import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const scriptSource = readFileSync(new URL("../mwi-main-site-import.user.js", import.meta.url), "utf8");

function loadScriptTestApi() {
    const gmStore = new Map();
    const sandboxWindow = {
        location: {
            hostname: "example.test",
            origin: "https://example.test",
            search: "",
        },
        localStorage: {
            getItem() {
                return null;
            },
        },
    };
    const pageWindow = {
        mwi: {
            game: {
                state: {
                    character: {
                        id: 101,
                        name: "Current Player",
                    },
                },
            },
        },
    };
    const marker = "    installDebugInterface();";
    const exposedSource = scriptSource.replace(marker, `    globalThis.__mwiImportTestApi = {
        hasStructuredPartyInfoFieldHints,
        getFreshRecentPartyMessages,
        getStructuredPartyInfoSources,
        rememberRecentPartyMessage,
        getGameStatePartyInfoSources,
        resolveTeamMemberNamesFromGameState,
        resolveTeamMemberNamesFromRecentPartyMessages,
        selectAutoDetectedTeamRoster,
        instrumentMainSiteSocket,
        isTrustedBridgeMessageSource,
        isTrustedBridgeMessageEvent,
        mainSiteState,
        RECENT_PARTY_MESSAGE_MAX_AGE_MS,
    };

${marker}`);

    if (exposedSource === scriptSource) {
        throw new Error(
            `Failed to inject the test API: marker ${JSON.stringify(marker)} was not found in mwi-main-site-import.user.js. `
            + "Update the marker if the call site or its indentation changed."
        );
    }

    const context = {
        console,
        GM_addValueChangeListener() {
            return 1;
        },
        GM_getValue(key, fallbackValue) {
            return gmStore.has(key) ? gmStore.get(key) : fallbackValue;
        },
        GM_removeValueChangeListener() {},
        GM_setValue(key, value) {
            gmStore.set(key, value);
        },
        unsafeWindow: pageWindow,
        URLSearchParams,
        window: sandboxWindow,
    };

    runInNewContext(exposedSource, context);

    return {
        api: context.__mwiImportTestApi,
        gmStore,
        pageWindow,
        sandboxWindow,
    };
}

function createPartyInfo(names = ["Current Player", "Party Member"]) {
    const partySlotMap = {};
    const sharableCharacterMap = {};

    names.forEach((name, index) => {
        const characterId = index === 0 ? 101 : 101 + index;
        partySlotMap[String(index + 1)] = {
            characterID: characterId,
            id: index + 1,
            isLeader: index === 0,
        };
        sharableCharacterMap[String(characterId)] = { name };
    });

    return {
        partySlotMap,
        sharableCharacterMap,
    };
}

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
        expect(scriptSource).toContain("// @version      0.1.29");
    });

    it("uses the current character and skilling bridge target on the skilling page", () => {
        expect(scriptSource).toContain('data-tm-import-anchor="skilling-actions"');
        expect(scriptSource).toContain('data-tm-import-reference="skilling-refresh"');
        expect(scriptSource).toContain('importTarget: "skilling"');
        expect(scriptSource).toContain('skillingButton: "导入生活技能快照"');
    });

    it("accepts bridge responses only from the sandbox or page window on the same origin", () => {
        const { api, pageWindow, sandboxWindow } = loadScriptTestApi();

        expect(api.isTrustedBridgeMessageEvent({ source: sandboxWindow, origin: sandboxWindow.location.origin })).toBe(true);
        expect(api.isTrustedBridgeMessageEvent({ source: pageWindow, origin: sandboxWindow.location.origin })).toBe(true);
        expect(api.isTrustedBridgeMessageEvent({ source: {}, origin: sandboxWindow.location.origin })).toBe(false);
        expect(api.isTrustedBridgeMessageEvent({ source: pageWindow, origin: "https://attacker.example" })).toBe(false);
        expect(scriptSource).toContain("pageWindow.postMessage({");
    });

    it("pre-filters websocket messages before structurally scanning nested party payloads", () => {
        const { api, gmStore } = loadScriptTestApi();
        const partyInfo = createPartyInfo();
        const partyMessage = {
            type: "party_updated",
            envelope: {
                nestedPartyState: partyInfo,
            },
        };

        expect(api.hasStructuredPartyInfoFieldHints(JSON.stringify({ type: "combat_tick", payload: { damage: 12 } }))).toBe(false);
        expect(api.hasStructuredPartyInfoFieldHints(JSON.stringify(partyMessage))).toBe(true);
        expect(api.getStructuredPartyInfoSources(partyMessage).map((entry) => entry.path)).toEqual([
            "envelope.nestedPartyState",
        ]);

        const listeners = new Map();
        const socket = {
            addEventListener(type, listener) {
                listeners.set(type, listener);
            },
        };
        api.instrumentMainSiteSocket(socket);
        listeners.get("message")({
            data: JSON.stringify({ type: "combat_tick", payload: { damage: 12 } }),
        });
        expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);

        listeners.get("message")({ data: JSON.stringify(partyMessage) });
        expect(api.mainSiteState.recentPartyMessages).toHaveLength(1);

        const cachedRoster = {
            exact: {
                "current player|42|/actions/combat/test|1": {
                    characterNames: ["Current Player", "Party Member"],
                    updatedAt: 1_000_000,
                },
            },
            loose: {},
        };
        api.mainSiteState.currentCharacterName = "Current Player";
        gmStore.set("mwi.tm.import.teamRosterCache.v1", cachedRoster);

        // Closing the last socket must only drop the in-memory roster: reconnects close
        // every socket, so the persisted cache has to survive to keep team imports intact.
        listeners.get("close")();
        expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);
        expect(gmStore.get("mwi.tm.import.teamRosterCache.v1")).toEqual(cachedRoster);
    });

    it("invalidates old websocket rosters on an empty party snapshot and after the TTL", () => {
        const { api, gmStore } = loadScriptTestApi();
        const receivedAt = 1_000_000;

        api.mainSiteState.currentCharacterName = "Current Player";
        gmStore.set("mwi.tm.import.teamRosterCache.v1", {
            exact: {
                "current player|42|/actions/combat/test|1": {
                    characterNames: ["Current Player", "Party Member"],
                    updatedAt: receivedAt,
                },
            },
            loose: {
                "current player|/actions/combat/test|1": {
                    characterNames: ["Current Player", "Party Member"],
                    updatedAt: receivedAt,
                },
            },
        });

        api.rememberRecentPartyMessage({ payload: createPartyInfo() }, receivedAt);
        expect(api.resolveTeamMemberNamesFromRecentPartyMessages(receivedAt).names).toEqual([
            "Current Player",
            "Party Member",
        ]);

        api.rememberRecentPartyMessage({
            payload: {
                partySlotMap: {},
                sharableCharacterMap: {},
            },
        }, receivedAt + 1);
        expect(api.resolveTeamMemberNamesFromRecentPartyMessages(receivedAt + 1).names).toEqual([]);
        expect(gmStore.get("mwi.tm.import.teamRosterCache.v1")).toEqual({ exact: {}, loose: {} });

        api.rememberRecentPartyMessage({ payload: createPartyInfo() }, receivedAt + 2);
        const expiredAt = receivedAt + 2 + api.RECENT_PARTY_MESSAGE_MAX_AGE_MS + 1;
        expect(api.resolveTeamMemberNamesFromRecentPartyMessages(expiredAt).names).toEqual([]);
        expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);
    });

    it("keeps websocket rosters ahead of cache candidates when websocket evidence unlocks fallbacks", () => {
        const { api } = loadScriptTestApi();
        const selected = api.selectAutoDetectedTeamRoster({
            allowFallbackSources: true,
            cacheMatch: {
                exactCharacterNames: ["Cached Player", "Cached Member"],
            },
            gameStateResult: {
                partyInfoMembers: [],
                partyInfoNames: [],
            },
            wsPartyResult: {
                members: [],
                names: ["Current Player", "Party Member"],
            },
        });

        expect(selected.source).toBe("ws-party");
        expect(selected.names).toEqual(["Current Player", "Party Member"]);
    });

    it("deduplicates direct party info and keeps the most informative debug source", () => {
        const { api, pageWindow } = loadScriptTestApi();
        const directPartyInfo = createPartyInfo();

        expect(api.getGameStatePartyInfoSources({ partyInfo: directPartyInfo })).toHaveLength(1);

        const nestedPartyInfo = createPartyInfo(["Current Player"]);
        pageWindow.mwi.game.state = {
            character: {
                id: 101,
                name: "Current Player",
            },
            nested: {
                currentParty: nestedPartyInfo,
            },
            partyInfo: {},
        };

        const result = api.resolveTeamMemberNamesFromGameState();
        expect(result.partyInfoMemberCount).toBe(1);
        expect(Object.keys(result.partyInfo.partySlotMap)).toHaveLength(1);
    });
});
