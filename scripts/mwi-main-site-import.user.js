// ==UserScript==
// @name         MWI Combat Simulator 主站一键导入
// @name:zh      MWI Combat Simulator 主站一键导入
// @name:zh-CN   MWI Combat Simulator 主站一键导入
// @namespace    https://azhu949.github.io/MWICombatSimulator
// @version      0.1.22
// @license      ISC
// @description  Import the current Milky Way Idle character or manually cached detected team into MWI Combat Simulator with one click.
// @description:zh      一键将 Milky Way Idle 主站当前角色或已手动缓存资料的已识别队伍导入到 MWI Combat Simulator。
// @description:zh-CN   一键将 Milky Way Idle 主站当前角色或已手动缓存资料的已识别队伍导入到 MWI Combat Simulator。
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://azhu949.github.io/MWICombatSimulator/*
// @match        https://mwi-combatsi-mulator.pages.dev/*
// @match        http://localhost:5173/*
// @match        http://127.0.0.1:5173/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/568613/MWI%20Combat%20Simulator%20%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5.user.js
// @updateURL https://update.greasyfork.org/scripts/568613/MWI%20Combat%20Simulator%20%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5.meta.js
// ==/UserScript==

(function () {
    "use strict";

    const REQUEST_KEY = "mwi.tm.import.request.v1";
    const RESPONSE_KEY = "mwi.tm.import.response.v1";
    const APP_BRIDGE_CHANNEL = "mwi-tm-bridge";
    const BUTTON_ID = "mwi-tm-import-button";
    const CONTROL_ID = "mwi-tm-import-control";
    const STATUS_ID = "mwi-tm-import-status";
    const TEAM_ROSTER_CACHE_KEY = "mwi.tm.import.teamRosterCache.v1";
    const PROFILE_CACHE_KEY = "mwi.tm.import.profileCache.v1";
    const DEBUG_STORAGE_KEY = "mwi.tm.import.debug";
    const DEBUG_QUERY_PARAM = "mwiImportDebug";
    const MAIN_SITE_SHORTCUT_ID = "mwi-tm-main-site-simulator-link";
    const SIMULATOR_GITHUB_PAGES_URL = "https://azhu949.github.io/MWICombatSimulator/";
    const SIMULATOR_CLOUDFLARE_URL = "https://mwi-combatsi-mulator.pages.dev/";
    const SIMULATOR_FALLBACK_URL = SIMULATOR_GITHUB_PAGES_URL;
    const SIMULATOR_MIRROR_MODAL_ID = "mwi-tm-simulator-mirror-modal";
    const REQUEST_TIMEOUT_MS = 12000;
    const APP_IMPORT_TIMEOUT_MS = 8000;
    const STORAGE_POLL_INTERVAL_MS = 250;
    const TEAM_ROSTER_CACHE_BUCKET_LIMIT = 24;
    const RECENT_PARTY_MESSAGE_LIMIT = 20;
    const PROFILE_CACHE_LIMIT = 50;
    const TEAM_IMPORT_PLAYER_IDS = ["1", "2", "3", "4", "5"];
    const UI_TEXT = {
        en: {
            button: "Import from Main Site",
            waitingMainSite: "Waiting for main-site response…",
            importingSimulator: "Importing into simulator…",
            importSuccess: "Import successful.",
            importFailed: "Import failed.",
            noMainSiteData: "No importable data was received from the main-site tab. Please make sure a logged-in main-site tab is open.",
            simulatorImportFailed: "The simulator page could not finish the import.",
            pageBridgeTimeout: "Timed out waiting for page bridge response.",
            mainSiteTabTimeout: "Timed out waiting for the main-site tab response.",
            currentCharacterNotInitialized: "Current character not initialized. Refresh the main-site tab once.",
            unableToReadCurrentProfile: "Unable to read the current profile.",
            openProfileInGameFirst: "Open profile in game first.",
            mainSiteShortcut: "Combat Simulator",
            mainSiteShortcutTitle: "Open MWI Combat Simulator",
            mirrorModalTitle: "Open Combat Simulator",
            mirrorModalDescription: "Choose which address you want to open.",
            mirrorModalGithub: "GitHub Pages",
            mirrorModalCloudflare: "Global (Cloudflare)",
            mirrorModalCancel: "Cancel",
            mainSiteNews: "News",
        },
        zh: {
            button: "从主站导入",
            waitingMainSite: "等待主站响应…",
            importingSimulator: "正在导入到模拟器…",
            importSuccess: "导入成功。",
            importFailed: "导入失败。",
            noMainSiteData: "未从主站收到可导入的数据。请确认主站标签页已打开并已登录。",
            simulatorImportFailed: "模拟器页面未能完成导入。",
            pageBridgeTimeout: "等待页面桥接响应超时。",
            mainSiteTabTimeout: "等待主站标签页响应超时。",
            currentCharacterNotInitialized: "当前角色尚未初始化，请刷新一次主站标签页。",
            unableToReadCurrentProfile: "无法读取当前角色资料。",
            openProfileInGameFirst: "需要先在游戏中手动打开资料。",
            mainSiteShortcut: "战斗模拟器",
            mainSiteShortcutTitle: "打开 MWI Combat Simulator",
            mirrorModalTitle: "打开战斗模拟器",
            mirrorModalDescription: "请选择要跳转的地址。",
            mirrorModalGithub: "GitHub Pages",
            mirrorModalCloudflare: "全球地址（Cloudflare）",
            mirrorModalCancel: "取消",
            mainSiteNews: "新闻",
        },
    };
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const mainSiteState = {
        isInstalled: false,
        sockets: new Set(),
        currentCharacterName: "",
        characterActions: [],
        recentPartyMessages: [],
        currentCombatAction: null,
        actionTypeFoodSlotsMap: {},
        actionTypeDrinkSlotsMap: {},
        consumableCombatTriggersMap: {},
        abilityCombatTriggersMap: {},
        currentCharacterSnapshot: null,
        currentCharacterFoodSlotsReady: false,
        currentCharacterDrinkSlotsReady: false,
        currentCharacterConsumableTriggersReady: false,
        currentCharacterAbilityTriggersReady: false,
    };
    const COMBAT_ACTION_TYPE_HRID = "/action_types/combat";
    const CURRENT_CHARACTER_SNAPSHOT_KEYS = [
        "character",
        "characterSkills",
        "characterItems",
        "combatUnit",
        "characterHouseRoomMap",
        "characterAchievements",
        "actionTypeFoodSlotsMap",
        "actionTypeDrinkSlotsMap",
        "consumableCombatTriggersMap",
        "abilityCombatTriggersMap",
    ];
    const REQUIRED_CURRENT_CHARACTER_SNAPSHOT_KEYS = [
        "character",
        "characterSkills",
        "characterItems",
        "combatUnit",
    ];

    function isCombatActionHrid(actionHrid) {
        return String(actionHrid || "").startsWith("/actions/combat/");
    }

    function normalizeDifficultyTier(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return 0;
        }

        return Math.max(0, Math.floor(parsed));
    }

    function sortTrackedCharacterActions(actions) {
        return [...actions].sort((left, right) => {
            const leftPartyId = Number(left?.partyID ?? left?.partyId ?? 0);
            const rightPartyId = Number(right?.partyID ?? right?.partyId ?? 0);
            if (leftPartyId !== 0 && rightPartyId === 0) {
                return -1;
            }
            if (leftPartyId === 0 && rightPartyId !== 0) {
                return 1;
            }

            return Number(left?.ordinal || 0) - Number(right?.ordinal || 0);
        });
    }

    function refreshCurrentCombatAction() {
        const previousPartyId = Number(mainSiteState.currentCombatAction?.partyId || 0);
        const currentAction = mainSiteState.characterActions.find((action) => isCombatActionHrid(action?.actionHrid)) || null;
        if (!currentAction) {
            mainSiteState.currentCombatAction = null;
            if (previousPartyId !== 0) {
                clearStaleTeamRosterState(mainSiteState.currentCharacterName);
            }
            return;
        }

        const partyId = Number(currentAction?.partyID ?? currentAction?.partyId ?? 0);
        const nextPartyId = Number.isFinite(partyId) ? partyId : 0;

        mainSiteState.currentCombatAction = {
            actionHrid: String(currentAction.actionHrid || "").trim(),
            difficultyTier: normalizeDifficultyTier(currentAction.difficultyTier),
            partyId: nextPartyId,
        };

        if (previousPartyId !== 0 && nextPartyId === 0) {
            clearStaleTeamRosterState(mainSiteState.currentCharacterName);
        }
    }

    function replaceTrackedCharacterActions(nextActions) {
        mainSiteState.characterActions = sortTrackedCharacterActions(
            Array.isArray(nextActions)
                ? nextActions.filter((action) => action && typeof action === "object")
                : []
        );
        refreshCurrentCombatAction();
    }

    function mergeTrackedCharacterActions(endCharacterActions) {
        if (!Array.isArray(endCharacterActions) || endCharacterActions.length === 0) {
            return;
        }

        const nextActions = [...mainSiteState.characterActions];
        for (const action of endCharacterActions) {
            if (!action || typeof action !== "object") {
                continue;
            }

            const actionId = Number(action.id || 0);
            const existingIndex = nextActions.findIndex((entry) => Number(entry?.id || 0) === actionId);
            if (action.isDone === true) {
                if (existingIndex >= 0) {
                    nextActions.splice(existingIndex, 1);
                }
                continue;
            }

            if (existingIndex >= 0) {
                nextActions[existingIndex] = action;
            } else {
                nextActions.push(action);
            }
        }

        replaceTrackedCharacterActions(nextActions);
    }

    function clonePlainObject(value) {
        return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : {};
    }

    function hasOwnKey(source, key) {
        return Boolean(source) && typeof source === "object" && Object.prototype.hasOwnProperty.call(source, key);
    }

    function normalizeComparableText(value) {
        return String(value || "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function normalizeCharacterName(value) {
        return String(value || "")
            .trim()
            .replace(/\s+/g, " ");
    }

    function normalizeCharacterNameList(rawNames, maxCount = 5) {
        const list = Array.isArray(rawNames) ? rawNames : [];
        const deduped = new Map();
        for (const entry of list) {
            const name = normalizeCharacterName(entry);
            if (!name) {
                continue;
            }

            const key = normalizeComparableText(name);
            if (!key || deduped.has(key)) {
                continue;
            }

            deduped.set(key, name);
            if (deduped.size >= maxCount) {
                break;
            }
        }

        return Array.from(deduped.values());
    }

    function isLikelyCharacterName(value) {
        const normalized = normalizeCharacterName(value);
        if (!normalized) {
            return false;
        }

        if (normalized.startsWith("/")) {
            return false;
        }

        if (/^\d+$/.test(normalized)) {
            return false;
        }

        if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z$/i.test(normalized)) {
            return false;
        }

        if (/^\{.+\}$/.test(normalized) || /^\[.+\]$/.test(normalized)) {
            return false;
        }

        if (/^systemchatmessage\./i.test(normalized)) {
            return false;
        }

        return true;
    }

    function normalizeDetectedCharacterName(value) {
        return isLikelyCharacterName(value) ? normalizeCharacterName(value) : "";
    }

    function readCharacterNameCandidate(source) {
        if (!source || typeof source !== "object") {
            return "";
        }

        const candidates = [
            source.characterName,
            source.name,
            source.displayName,
            source.playerName,
            source.character?.name,
            source.character?.characterName,
            source.player?.name,
        ];

        for (const candidate of candidates) {
            const normalized = normalizeDetectedCharacterName(candidate);
            if (normalized) {
                return normalized;
            }
        }

        return "";
    }

    function buildTeamRosterContext() {
        return {
            currentCharacterName: normalizeCharacterName(mainSiteState.currentCharacterName),
            partyId: Number(mainSiteState.currentCombatAction?.partyId || 0),
            actionHrid: String(mainSiteState.currentCombatAction?.actionHrid || "").trim(),
            difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction?.difficultyTier),
        };
    }

    function buildTeamRosterExactCacheKey(context) {
        const currentCharacterName = normalizeComparableText(context?.currentCharacterName);
        const actionHrid = String(context?.actionHrid || "").trim();
        const difficultyTier = normalizeDifficultyTier(context?.difficultyTier);
        const partyId = Number(context?.partyId || 0);
        if (!currentCharacterName || !actionHrid) {
            return "";
        }

        return `${currentCharacterName}|${partyId}|${actionHrid}|${difficultyTier}`;
    }

    function buildTeamRosterLooseCacheKey(context) {
        const currentCharacterName = normalizeComparableText(context?.currentCharacterName);
        const actionHrid = String(context?.actionHrid || "").trim();
        const difficultyTier = normalizeDifficultyTier(context?.difficultyTier);
        if (!currentCharacterName || !actionHrid) {
            return "";
        }

        return `${currentCharacterName}|${actionHrid}|${difficultyTier}`;
    }

    function sanitizeTeamRosterCacheEntry(value) {
        const characterNames = normalizeCharacterNameList(value?.characterNames ?? value?.names ?? [], 5);
        if (characterNames.length < 2) {
            return null;
        }

        return {
            characterNames,
            updatedAt: Number(value?.updatedAt || Date.now()),
        };
    }

    function loadTeamRosterCacheStore() {
        const rawValue = GM_getValue(TEAM_ROSTER_CACHE_KEY, null);
        const exactSource = rawValue?.exact && typeof rawValue.exact === "object" ? rawValue.exact : {};
        const looseSource = rawValue?.loose && typeof rawValue.loose === "object" ? rawValue.loose : {};
        const exact = {};
        const loose = {};

        for (const [key, value] of Object.entries(exactSource)) {
            const normalized = sanitizeTeamRosterCacheEntry(value);
            if (normalized) {
                exact[key] = normalized;
            }
        }

        for (const [key, value] of Object.entries(looseSource)) {
            const normalized = sanitizeTeamRosterCacheEntry(value);
            if (normalized) {
                loose[key] = normalized;
            }
        }

        return { exact, loose };
    }

    function pruneTeamRosterCacheBucket(bucket) {
        const entries = Object.entries(bucket || {})
            .sort((left, right) => Number(right?.[1]?.updatedAt || 0) - Number(left?.[1]?.updatedAt || 0))
            .slice(0, TEAM_ROSTER_CACHE_BUCKET_LIMIT);
        return Object.fromEntries(entries);
    }

    function readTeamRosterCache(context) {
        const store = loadTeamRosterCacheStore();
        const exactKey = buildTeamRosterExactCacheKey(context);
        const looseKey = buildTeamRosterLooseCacheKey(context);
        const exactEntry = exactKey ? sanitizeTeamRosterCacheEntry(store.exact?.[exactKey]) : null;
        const looseEntry = looseKey ? sanitizeTeamRosterCacheEntry(store.loose?.[looseKey]) : null;

        return {
            exactKey,
            looseKey,
            exactCharacterNames: exactEntry?.characterNames ?? [],
            looseCharacterNames: looseEntry?.characterNames ?? [],
        };
    }

    function persistTeamRosterCache(context, characterNames) {
        const normalizedNames = normalizeCharacterNameList(characterNames, 5);
        if (normalizedNames.length < 2) {
            return false;
        }

        const exactKey = buildTeamRosterExactCacheKey(context);
        const looseKey = buildTeamRosterLooseCacheKey(context);
        if (!exactKey && !looseKey) {
            return false;
        }

        const store = loadTeamRosterCacheStore();
        const entry = {
            characterNames: normalizedNames,
            updatedAt: Date.now(),
        };

        if (exactKey) {
            store.exact[exactKey] = entry;
        }

        if (looseKey) {
            store.loose[looseKey] = entry;
        }

        GM_setValue(TEAM_ROSTER_CACHE_KEY, {
            exact: pruneTeamRosterCacheBucket(store.exact),
            loose: pruneTeamRosterCacheBucket(store.loose),
        });

        return true;
    }

    function clearRecentPartyMessages() {
        mainSiteState.recentPartyMessages = [];
    }

    function clearTeamRosterCacheForCharacter(characterName) {
        const comparableCharacterName = normalizeComparableText(characterName);
        if (!comparableCharacterName) {
            return false;
        }

        const store = loadTeamRosterCacheStore();
        let changed = false;
        const cacheKeyPrefix = `${comparableCharacterName}|`;

        for (const bucket of ["exact", "loose"]) {
            for (const key of Object.keys(store[bucket] || {})) {
                if (!String(key || "").startsWith(cacheKeyPrefix)) {
                    continue;
                }

                delete store[bucket][key];
                changed = true;
            }
        }

        if (!changed) {
            return false;
        }

        GM_setValue(TEAM_ROSTER_CACHE_KEY, {
            exact: pruneTeamRosterCacheBucket(store.exact),
            loose: pruneTeamRosterCacheBucket(store.loose),
        });

        return true;
    }

    function clearStaleTeamRosterState(characterName = mainSiteState.currentCharacterName) {
        clearRecentPartyMessages();
        clearTeamRosterCacheForCharacter(characterName);
    }

    function countPartyInfoMembers(partyInfo) {
        if (!partyInfo || typeof partyInfo !== "object" || Array.isArray(partyInfo)) {
            return 0;
        }

        return readCollectionEntries(partyInfo?.partySlotMap)
            .filter((entry) => entry && typeof entry === "object")
            .length;
    }

    function collectStructuredPartyInfoSources(source, path, depth, results, visited) {
        if (!source || typeof source !== "object" || Array.isArray(source) || depth > 2) {
            return;
        }

        if (visited.has(source)) {
            return;
        }

        visited.add(source);

        const isPartyInfoPath = path.split(".").pop() === "partyInfo";
        const hasPartySlotMap = source?.partySlotMap && typeof source.partySlotMap === "object" && !Array.isArray(source.partySlotMap);
        const hasSharableCharacterMap = source?.sharableCharacterMap && typeof source.sharableCharacterMap === "object" && !Array.isArray(source.sharableCharacterMap);
        if (isPartyInfoPath && hasPartySlotMap && hasSharableCharacterMap) {
            results.push({
                path,
                value: source,
            });
        }

        if (depth >= 2) {
            return;
        }

        [
            ["partyInfo", source?.partyInfo],
            ["payload", source?.payload],
            ["data", source?.data],
        ].forEach(([key, value]) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                return;
            }

            const nextPath = path ? `${path}.${key}` : key;
            collectStructuredPartyInfoSources(value, nextPath, depth + 1, results, visited);
        });
    }

    function getStructuredPartyInfoSources(source, path = "") {
        const results = [];
        collectStructuredPartyInfoSources(source, path, 0, results, new WeakSet());
        return Array.from(new Map(results.map((entry) => [entry.path, entry])).values());
    }

    function rememberRecentPartyMessage(message) {
        const structuredSources = getStructuredPartyInfoSources(message);
        if (structuredSources.length === 0) {
            return;
        }

        const snapshots = structuredSources
            .map((entry) => clonePlainObject(entry.value))
            .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
            .map((partyInfo) => ({ partyInfo }));
        if (snapshots.length === 0) {
            return;
        }

        mainSiteState.recentPartyMessages = [...snapshots, ...mainSiteState.recentPartyMessages]
            .slice(0, RECENT_PARTY_MESSAGE_LIMIT);
    }

    function getMainSiteGameState() {
        const candidates = [
            pageWindow?.mwi,
            pageWindow?.MWI,
            pageWindow?.Mwi,
        ];

        for (const candidate of candidates) {
            const state = candidate?.game?.state;
            if (state && typeof state === "object") {
                return state;
            }
        }

        return null;
    }

    function toCollectionValues(source) {
        if (Array.isArray(source)) {
            return source;
        }

        if (source instanceof Map || source instanceof Set) {
            return Array.from(source.values());
        }

        return null;
    }

    function readCollectionEntries(source) {
        const collectionValues = toCollectionValues(source);
        if (Array.isArray(collectionValues)) {
            return collectionValues;
        }

        if (source && typeof source === "object" && !Array.isArray(source)) {
            return Object.values(source);
        }

        return [];
    }

    function readCollectionValue(source, key) {
        if (!source || typeof source !== "object") {
            return null;
        }

        if (source instanceof Map) {
            return source.get(key) ?? source.get(String(key)) ?? null;
        }

        return source[key] ?? source[String(key)] ?? null;
    }

    function buildCurrentCharacterLookup(gameState) {
        const rawCurrentCharacterId = Number(gameState?.character?.id || 0);
        return {
            currentCharacterId: Number.isFinite(rawCurrentCharacterId) ? rawCurrentCharacterId : 0,
            currentCharacterName: normalizeCharacterName(gameState?.character?.name || mainSiteState.currentCharacterName),
            comparableCurrentCharacterName: normalizeComparableText(gameState?.character?.name || mainSiteState.currentCharacterName),
        };
    }

    function sortResolvedTeamMembers(members) {
        return [...members].sort((left, right) => {
            if (Boolean(left?.isCurrent) !== Boolean(right?.isCurrent)) {
                return left?.isCurrent ? -1 : 1;
            }

            if (Boolean(left?.isLeader) !== Boolean(right?.isLeader)) {
                return left?.isLeader ? -1 : 1;
            }

            if (Boolean(left?.isReady) !== Boolean(right?.isReady)) {
                return left?.isReady ? -1 : 1;
            }

            const leftSortId = Number.isFinite(Number(left?.sortId)) ? Number(left.sortId) : Number.MAX_SAFE_INTEGER;
            const rightSortId = Number.isFinite(Number(right?.sortId)) ? Number(right.sortId) : Number.MAX_SAFE_INTEGER;
            if (leftSortId !== rightSortId) {
                return leftSortId - rightSortId;
            }

            const leftOrderIndex = Number.isFinite(Number(left?.orderIndex)) ? Number(left.orderIndex) : Number.MAX_SAFE_INTEGER;
            const rightOrderIndex = Number.isFinite(Number(right?.orderIndex)) ? Number(right.orderIndex) : Number.MAX_SAFE_INTEGER;
            if (leftOrderIndex !== rightOrderIndex) {
                return leftOrderIndex - rightOrderIndex;
            }

            return String(left?.name || "").localeCompare(String(right?.name || ""));
        });
    }

    function buildStructuredRosterCandidate(path, members) {
        const normalizedMembers = Array.isArray(members)
            ? members.filter((entry) => entry && typeof entry === "object")
            : [];
        const orderedMembers = sortResolvedTeamMembers(normalizedMembers);
        const includesCurrentCharacter = orderedMembers.some((entry) => {
            return entry.isCurrent === true && normalizeCharacterName(entry?.name || "").length > 0;
        });
        if (!includesCurrentCharacter) {
            return null;
        }

        const normalizedEntries = orderedMembers
            .map((entry) => {
                const name = normalizeCharacterName(entry?.name || "");
                if (!name) {
                    return null;
                }

                const rawCharacterId = Number(entry?.characterId || 0);
                return {
                    characterId: Number.isFinite(rawCharacterId) ? rawCharacterId : 0,
                    characterName: name,
                    isCurrent: entry?.isCurrent === true,
                };
            })
            .filter((entry) => entry !== null);

        const names = normalizeCharacterNameList(
            normalizedEntries.map((entry) => entry.characterName),
            5
        );
        if (names.length < 2) {
            return null;
        }

        return {
            path,
            names,
            members: normalizedEntries
                .filter((entry) => names.some((name) => normalizeComparableText(name) === normalizeComparableText(entry.characterName)))
                .slice(0, 5),
        };
    }

    function resolvePartyInfoRosterCandidate(partyInfo, path, currentCharacterLookup) {
        if (!partyInfo || typeof partyInfo !== "object" || Array.isArray(partyInfo)) {
            return null;
        }

        const partySlotEntries = readCollectionEntries(partyInfo?.partySlotMap)
            .filter((entry) => entry && typeof entry === "object");
        if (partySlotEntries.length < 2) {
            return null;
        }

        const sharableCharacterMap = partyInfo?.sharableCharacterMap;
        if (!sharableCharacterMap || typeof sharableCharacterMap !== "object") {
            return null;
        }

        const currentCharacterId = Number(currentCharacterLookup?.currentCharacterId || 0);
        const currentCharacterName = normalizeCharacterName(currentCharacterLookup?.currentCharacterName || "");
        const comparableCurrentCharacterName = normalizeComparableText(currentCharacterLookup?.comparableCurrentCharacterName || currentCharacterName);

        const members = partySlotEntries.map((partySlot, index) => {
            const rawCharacterId = Number(partySlot?.characterID ?? partySlot?.characterId ?? 0);
            const characterId = Number.isFinite(rawCharacterId) ? rawCharacterId : 0;
            const sharedCharacter = characterId !== 0
                ? readCollectionValue(sharableCharacterMap, characterId)
                : null;
            const nameFromSharedCharacter = readCharacterNameCandidate(sharedCharacter);
            const comparableName = normalizeComparableText(nameFromSharedCharacter);
            const isCurrentById = currentCharacterId !== 0 && characterId === currentCharacterId;
            const isCurrentByName = comparableCurrentCharacterName
                ? comparableName === comparableCurrentCharacterName
                : false;
            const rawSlotId = Number(partySlot?.id || 0);

            return {
                name: nameFromSharedCharacter || ((isCurrentById || isCurrentByName) ? currentCharacterName : ""),
                characterId,
                isCurrent: isCurrentById || isCurrentByName,
                isLeader: partySlot?.isLeader === true,
                isReady: partySlot?.isReady === true,
                sortId: Number.isFinite(rawSlotId) ? rawSlotId : Number.MAX_SAFE_INTEGER,
                orderIndex: index,
            };
        });

        return buildStructuredRosterCandidate(path, members);
    }

    function resolveTeamMemberNamesFromGameState() {
        const gameState = getMainSiteGameState();
        const currentCharacterLookup = buildCurrentCharacterLookup(gameState);
        const partyInfo = gameState?.partyInfo ?? null;
        const partyInfoCandidate = resolvePartyInfoRosterCandidate(
            partyInfo,
            "mwi.game.state.partyInfo",
            currentCharacterLookup
        );

        return {
            partyInfoNames: partyInfoCandidate?.names ?? [],
            partyInfoMembers: partyInfoCandidate?.members ?? [],
            partyInfo,
            partyInfoMemberCount: countPartyInfoMembers(partyInfo),
            partyInfoResolvedFromPath: partyInfoCandidate?.path || "",
        };
    }

    function resolveTeamMemberNamesFromRecentPartyMessages() {
        const messages = Array.isArray(mainSiteState.recentPartyMessages) ? mainSiteState.recentPartyMessages : [];
        const currentCharacterLookup = buildCurrentCharacterLookup(getMainSiteGameState());

        for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
            const candidate = resolvePartyInfoRosterCandidate(
                messages[messageIndex]?.partyInfo,
                `wsPartyMessages[${messageIndex}].partyInfo`,
                currentCharacterLookup
            );
            if (candidate) {
                return {
                    names: candidate.names,
                    members: candidate.members ?? [],
                    messages,
                    resolvedFromPath: candidate.path,
                };
            }
        }

        return {
            names: [],
            members: [],
            messages,
            resolvedFromPath: "",
        };
    }

    function selectAutoDetectedTeamRoster({ gameStateResult, wsPartyResult, cacheMatch, allowFallbackSources = false }) {
        const candidates = [
            {
                source: "game-state:partyInfo",
                names: gameStateResult?.partyInfoNames ?? [],
                members: gameStateResult?.partyInfoMembers ?? [],
                resolvedFromPath: gameStateResult?.partyInfoResolvedFromPath || "",
            },
        ];

        if (allowFallbackSources) {
            candidates.push(
                {
                    source: "ws-party",
                    names: wsPartyResult?.names ?? [],
                    members: wsPartyResult?.members ?? [],
                    resolvedFromPath: wsPartyResult?.resolvedFromPath || "",
                },
                {
                    source: "cache",
                    names: cacheMatch?.exactCharacterNames ?? [],
                    members: [],
                    resolvedFromPath: "",
                }
            );
        }

        for (const candidate of candidates) {
            if (Array.isArray(candidate.names) && candidate.names.length >= 2) {
                return candidate;
            }
        }

        return {
            source: "request",
            names: [],
            members: [],
            resolvedFromPath: "",
        };
    }

    function debugTeamRosterAutoDetection(details) {
        try {
            console.debug("[MWI TM] Team roster auto-detect", details);
        } catch (_error) {
        }
    }

    function isDomElement(value) {
        return Boolean(value)
            && typeof value === "object"
            && Number(value.nodeType) === 1
            && typeof value.querySelector === "function";
    }

    function pickCurrentCharacterSnapshotFields(message) {
        const snapshot = {};
        for (const key of CURRENT_CHARACTER_SNAPSHOT_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(message || {}, key)) {
                continue;
            }

            snapshot[key] = clonePlainObject(message[key]);
        }

        return snapshot;
    }

    function updateCurrentCharacterSnapshot(message, reset = false) {
        const nextFields = pickCurrentCharacterSnapshotFields(message);
        const nextKeys = Object.keys(nextFields);
        if (nextKeys.length === 0) {
            return;
        }

        const baseSnapshot = reset || !mainSiteState.currentCharacterSnapshot
            ? {}
            : clonePlainObject(mainSiteState.currentCharacterSnapshot);

        for (const key of nextKeys) {
            baseSnapshot[key] = nextFields[key];
        }

        mainSiteState.currentCharacterSnapshot = baseSnapshot;
    }

    function syncCurrentCharacterConsumableSlotMaps(message, reset = false) {
        const hasFoodMap = hasOwnKey(message, "actionTypeFoodSlotsMap");
        const hasDrinkMap = hasOwnKey(message, "actionTypeDrinkSlotsMap");
        if (!reset && !hasFoodMap && !hasDrinkMap) {
            return;
        }

        if (reset) {
            mainSiteState.actionTypeFoodSlotsMap = clonePlainObject(hasFoodMap ? message.actionTypeFoodSlotsMap : {});
            mainSiteState.actionTypeDrinkSlotsMap = clonePlainObject(hasDrinkMap ? message.actionTypeDrinkSlotsMap : {});
            mainSiteState.currentCharacterFoodSlotsReady = hasFoodMap;
            mainSiteState.currentCharacterDrinkSlotsReady = hasDrinkMap;
            return;
        }

        if (hasFoodMap) {
            mainSiteState.actionTypeFoodSlotsMap = clonePlainObject(message.actionTypeFoodSlotsMap);
            mainSiteState.currentCharacterFoodSlotsReady = true;
        }

        if (hasDrinkMap) {
            mainSiteState.actionTypeDrinkSlotsMap = clonePlainObject(message.actionTypeDrinkSlotsMap);
            mainSiteState.currentCharacterDrinkSlotsReady = true;
        }
    }

    function syncCurrentCharacterCombatTriggerMaps(message, reset = false) {
        const hasConsumableTriggerMap = hasOwnKey(message, "consumableCombatTriggersMap");
        const hasAbilityTriggerMap = hasOwnKey(message, "abilityCombatTriggersMap");
        if (!reset && !hasConsumableTriggerMap && !hasAbilityTriggerMap) {
            return;
        }

        if (reset) {
            mainSiteState.consumableCombatTriggersMap = clonePlainObject(hasConsumableTriggerMap ? message.consumableCombatTriggersMap : {});
            mainSiteState.abilityCombatTriggersMap = clonePlainObject(hasAbilityTriggerMap ? message.abilityCombatTriggersMap : {});
            mainSiteState.currentCharacterConsumableTriggersReady = hasConsumableTriggerMap;
            mainSiteState.currentCharacterAbilityTriggersReady = hasAbilityTriggerMap;
            return;
        }

        if (hasConsumableTriggerMap) {
            mainSiteState.consumableCombatTriggersMap = clonePlainObject(message.consumableCombatTriggersMap);
            mainSiteState.currentCharacterConsumableTriggersReady = true;
        }

        if (hasAbilityTriggerMap) {
            mainSiteState.abilityCombatTriggersMap = clonePlainObject(message.abilityCombatTriggersMap);
            mainSiteState.currentCharacterAbilityTriggersReady = true;
        }
    }

    function readCurrentCharacterIdentity(source) {
        return {
            characterId: String(source?.character?.id || "").trim(),
            characterName: normalizeCharacterName(source?.character?.name || ""),
        };
    }

    function hasSnapshotField(snapshot, key) {
        return Boolean(snapshot) && typeof snapshot === "object" && Object.prototype.hasOwnProperty.call(snapshot, key);
    }

    function hasCharacterIdentityChanged(message) {
        const incomingIdentity = readCurrentCharacterIdentity(message);
        if (!incomingIdentity.characterId && !incomingIdentity.characterName) {
            return false;
        }

        const existingIdentity = readCurrentCharacterIdentity(mainSiteState.currentCharacterSnapshot);
        if (!existingIdentity.characterId && !existingIdentity.characterName) {
            return false;
        }

        if (
            incomingIdentity.characterId
            && existingIdentity.characterId
            && incomingIdentity.characterId !== existingIdentity.characterId
        ) {
            return true;
        }

        if (
            incomingIdentity.characterName
            && existingIdentity.characterName
            && normalizeComparableText(incomingIdentity.characterName) !== normalizeComparableText(existingIdentity.characterName)
        ) {
            return true;
        }

        return false;
    }

    function resetCurrentCharacterTracking(previousCharacterName = "") {
        clearStaleTeamRosterState(previousCharacterName || mainSiteState.currentCharacterName);
        mainSiteState.currentCharacterSnapshot = null;
        mainSiteState.currentCharacterFoodSlotsReady = false;
        mainSiteState.currentCharacterDrinkSlotsReady = false;
        mainSiteState.currentCharacterConsumableTriggersReady = false;
        mainSiteState.currentCharacterAbilityTriggersReady = false;
        replaceTrackedCharacterActions([]);
        replaceConsumableSlotMaps({}, {});
        replaceCombatTriggerMaps({}, {});
    }

    function hasCurrentCharacterSnapshot() {
        const snapshot = mainSiteState.currentCharacterSnapshot;
        return Boolean(
            snapshot
            && typeof snapshot === "object"
            && snapshot.character
            && typeof snapshot.character === "object"
            && Array.isArray(snapshot.characterSkills)
            && REQUIRED_CURRENT_CHARACTER_SNAPSHOT_KEYS.every((key) => hasSnapshotField(snapshot, key))
        );
    }

    function hasCurrentCharacterConsumableSlots() {
        return mainSiteState.currentCharacterFoodSlotsReady === true
            && mainSiteState.currentCharacterDrinkSlotsReady === true;
    }

    function hasCurrentCharacterConsumableTriggerSnapshot() {
        return mainSiteState.currentCharacterConsumableTriggersReady === true;
    }

    function hasCurrentCharacterAbilityTriggerSnapshot() {
        return mainSiteState.currentCharacterAbilityTriggersReady === true;
    }

    function hasCurrentCharacterCombatTriggerSnapshot() {
        return hasCurrentCharacterConsumableTriggerSnapshot()
            || hasCurrentCharacterAbilityTriggerSnapshot();
    }

    function buildCurrentCharacterPayload() {
        if (!hasCurrentCharacterSnapshot() || !hasCurrentCharacterConsumableSlots()) {
            return null;
        }

        const snapshot = clonePlainObject(mainSiteState.currentCharacterSnapshot);
        snapshot.actionTypeFoodSlotsMap = clonePlainObject(mainSiteState.actionTypeFoodSlotsMap);
        snapshot.actionTypeDrinkSlotsMap = clonePlainObject(mainSiteState.actionTypeDrinkSlotsMap);
        if (hasCurrentCharacterConsumableTriggerSnapshot()) {
            snapshot.consumableCombatTriggersMap = clonePlainObject(mainSiteState.consumableCombatTriggersMap);
        } else {
            delete snapshot.consumableCombatTriggersMap;
        }

        if (hasCurrentCharacterAbilityTriggerSnapshot()) {
            snapshot.abilityCombatTriggersMap = clonePlainObject(mainSiteState.abilityCombatTriggersMap);
        } else {
            delete snapshot.abilityCombatTriggersMap;
        }
        snapshot.mainSiteCombat = mainSiteState.currentCombatAction ? {
            actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ""),
            difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
        } : null;
        return snapshot;
    }

    function buildCachedProfilePayload(profile, includeCurrentCombat = true) {
        if (!profile || typeof profile !== "object") {
            return null;
        }

        const payload = {
            profile: clonePlainObject(profile),
        };

        if (includeCurrentCombat) {
            payload.mainSiteCombat = mainSiteState.currentCombatAction ? {
                actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ""),
                difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
            } : null;
        }

        return payload;
    }

    function sanitizeProfileCacheEntry(value) {
        const payload = value?.payload && typeof value.payload === "object"
            ? value.payload
            : null;
        const profile = payload?.profile && typeof payload.profile === "object"
            ? payload.profile
            : (value?.profile && typeof value.profile === "object" ? value.profile : null);
        if (!profile) {
            return null;
        }

        const characterId = String(
            value?.characterId
            || profile?.sharableCharacter?.id
            || profile?.sharableCharacter?.characterID
            || profile?.sharableCharacter?.characterId
            || ""
        ).trim();
        const characterName = normalizeCharacterName(
            value?.characterName
            || profile?.sharableCharacter?.name
            || profile?.name
            || ""
        );
        if (!characterId && !characterName) {
            return null;
        }

        return {
            characterId,
            characterName,
            comparableCharacterName: normalizeComparableText(characterName),
            payload: buildCachedProfilePayload(profile, false),
            updatedAt: Number(value?.updatedAt || Date.now()),
        };
    }

    function loadProfileCacheEntries() {
        const rawValue = GM_getValue(PROFILE_CACHE_KEY, null);
        const rawEntries = Array.isArray(rawValue?.entries)
            ? rawValue.entries
            : (Array.isArray(rawValue) ? rawValue : []);

        return rawEntries
            .map((entry) => sanitizeProfileCacheEntry(entry))
            .filter((entry) => entry && entry.payload)
            .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
            .slice(0, PROFILE_CACHE_LIMIT);
    }

    function persistProfileCacheEntry(profile) {
        const entry = sanitizeProfileCacheEntry({ profile, updatedAt: Date.now() });
        if (!entry) {
            return null;
        }

        const nextEntries = loadProfileCacheEntries().filter((candidate) => {
            if (entry.characterId && candidate.characterId) {
                return candidate.characterId !== entry.characterId;
            }

            if (entry.comparableCharacterName && candidate.comparableCharacterName) {
                return candidate.comparableCharacterName !== entry.comparableCharacterName;
            }

            return true;
        });

        nextEntries.unshift(entry);
        GM_setValue(PROFILE_CACHE_KEY, {
            entries: nextEntries
                .slice(0, PROFILE_CACHE_LIMIT)
                .map((candidate) => ({
                    characterId: candidate.characterId,
                    characterName: candidate.characterName,
                    updatedAt: candidate.updatedAt,
                    payload: candidate.payload,
                })),
        });

        return entry;
    }

    function findCachedProfileEntry(characterId, characterName) {
        const normalizedCharacterId = String(characterId || "").trim();
        const comparableCharacterName = normalizeComparableText(characterName);
        const entries = loadProfileCacheEntries();

        if (normalizedCharacterId) {
            const exactIdMatch = entries.find((entry) => entry.characterId === normalizedCharacterId);
            if (exactIdMatch) {
                return exactIdMatch;
            }
        }

        if (!comparableCharacterName) {
            return null;
        }

        return entries.find((entry) => entry.comparableCharacterName === comparableCharacterName) || null;
    }

    function replaceConsumableSlotMaps(foodMap, drinkMap) {
        mainSiteState.actionTypeFoodSlotsMap = clonePlainObject(foodMap);
        mainSiteState.actionTypeDrinkSlotsMap = clonePlainObject(drinkMap);
    }

    function replaceCombatTriggerMaps(consumableMap, abilityMap) {
        mainSiteState.consumableCombatTriggersMap = clonePlainObject(consumableMap);
        mainSiteState.abilityCombatTriggersMap = clonePlainObject(abilityMap);
    }

    function updateCombatTriggerMap(message) {
        const triggerTypeHrid = String(message?.combatTriggerTypeHrid || "").trim();
        const combatTriggers = Array.isArray(message?.combatTriggers) ? message.combatTriggers : [];
        if (triggerTypeHrid === "/combat_trigger_types/consumable") {
            const itemHrid = String(message?.itemHrid || "").trim();
            if (itemHrid) {
                mainSiteState.consumableCombatTriggersMap[itemHrid] = JSON.parse(JSON.stringify(combatTriggers));
                mainSiteState.currentCharacterConsumableTriggersReady = true;
            }
            return;
        }

        if (triggerTypeHrid === "/combat_trigger_types/ability") {
            const abilityHrid = String(message?.abilityHrid || "").trim();
            if (abilityHrid) {
                mainSiteState.abilityCombatTriggersMap[abilityHrid] = JSON.parse(JSON.stringify(combatTriggers));
                mainSiteState.currentCharacterAbilityTriggersReady = true;
            }
        }
    }

    function isMainSitePage() {
        return window.location.hostname === "www.milkywayidle.com" || window.location.hostname === "milkywayidle.com";
    }

    function isSimulatorPage() {
        const origin = window.location.origin;
        return origin === "https://azhu949.github.io"
            || origin === "https://mwi-combatsi-mulator.pages.dev"
            || origin === "http://localhost:5173"
            || origin === "http://127.0.0.1:5173";
    }

    function normalizeUiLanguage(value) {
        const normalized = String(value || "").trim().toLowerCase();
        if (normalized.startsWith("zh")) {
            return "zh";
        }
        if (normalized.startsWith("en")) {
            return "en";
        }
        return "";
    }

    function resolveUiLanguage(preferredLanguage = "") {
        const explicitLanguage = normalizeUiLanguage(preferredLanguage);
        if (explicitLanguage) {
            return explicitLanguage;
        }

        try {
            const storedLanguage = normalizeUiLanguage(window.localStorage?.getItem("i18nextLng"));
            if (storedLanguage) {
                return storedLanguage;
            }
        } catch (_error) {
        }

        const documentLanguage = normalizeUiLanguage(document.documentElement?.lang);
        if (documentLanguage) {
            return documentLanguage;
        }

        return normalizeUiLanguage(navigator.language) || "en";
    }

    function getUiText(key, preferredLanguage = "") {
        const language = resolveUiLanguage(preferredLanguage);
        return UI_TEXT[language]?.[key] || UI_TEXT.en[key] || "";
    }

    function normalizeText(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function isVisibleElement(element) {
        if (!element || !element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
    }

    function getMainSiteNewsLabels() {
        return [UI_TEXT.en.mainSiteNews, UI_TEXT.zh.mainSiteNews]
            .map((value) => normalizeText(value))
            .filter(Boolean);
    }

    function getElementSearchText(element) {
        if (!isDomElement(element)) {
            return "";
        }

        const values = [
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
        ];

        return normalizeText(values.filter((value) => String(value || "").trim()).join(" "));
    }

    function getElementSemanticText(element) {
        if (!isDomElement(element)) {
            return "";
        }

        const className = typeof element.className === "string"
            ? element.className
            : element.getAttribute("class");

        const values = [
            element.tagName,
            element.getAttribute("role"),
            element.getAttribute("id"),
            className,
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
        ];

        return normalizeText(values.filter((value) => String(value || "").trim()).join(" "));
    }

    function hasMainSiteNavigationContext(element) {
        if (!isDomElement(element)) {
            return false;
        }

        if (element.closest("nav, header, aside, [role='navigation'], [role='tablist'], [role='menu']")) {
            return true;
        }

        const semanticText = [
            getElementSemanticText(element),
            getElementSemanticText(element.parentElement),
        ]
            .filter(Boolean)
            .join(" ");

        return /(^|[\s_-])(nav|menu|sidebar|drawer|tab|tabs|toolbar)([\s_-]|$)/.test(semanticText);
    }

    function getMainSiteMenuItemElement(element) {
        if (!isDomElement(element)) {
            return null;
        }

        const interactiveAncestor = element.closest("a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem']");
        if (interactiveAncestor && isVisibleElement(interactiveAncestor)) {
            return interactiveAncestor;
        }

        return isVisibleElement(element) ? element : null;
    }

    function scoreMainSiteNewsCandidate(menuItem, text, labels) {
        const rect = menuItem.getBoundingClientRect();
        const roleText = normalizeText(menuItem.getAttribute("role"));
        const semanticText = [
            getElementSemanticText(menuItem),
            getElementSemanticText(menuItem.parentElement),
            getElementSemanticText(menuItem.closest("nav, header, aside, [role='navigation'], [role='tablist'], [role='menu']")),
        ]
            .filter(Boolean)
            .join(" ");

        let score = 0;
        if (/^(A|BUTTON)$/.test(menuItem.tagName)) {
            score += 120;
        }
        if (/(^|[\s_-])(button|link|tab|menuitem)([\s_-]|$)/.test(`${roleText} ${semanticText}`)) {
            score += 80;
        }
        if (hasMainSiteNavigationContext(menuItem)) {
            score += 160;
        }
        if (labels.includes(text)) {
            score += 60;
        }
        if (rect.width >= 36) {
            score += 20;
        }
        if (rect.width >= 60 && rect.width < 140) {
            score += 35;
        } else if (rect.width >= 140 && rect.width < 320) {
            score += 20;
        }
        if (rect.height >= 20 && rect.height <= 112) {
            score += 30;
        }
        if (rect.top >= 0 && rect.top < Math.max(window.innerHeight * 0.65, 320)) {
            score += 20;
        }
        if (rect.width > Math.max(window.innerWidth * 0.8, 480)) {
            score -= 120;
        }
        if (rect.height > 140) {
            score -= 120;
        }

        return { rect, score };
    }

    function textMatchesLabel(text, labels) {
        const normalized = normalizeText(text);
        return labels.some((label) => (
            normalized === label
            || normalized.startsWith(`${label} `)
            || normalized.endsWith(` ${label}`)
            || normalized.includes(` ${label} `)
        ));
    }

    function detectMainSiteMenuLanguage(referenceItem) {
        const text = normalizeText(referenceItem?.textContent);
        if (textMatchesLabel(text, [normalizeText(UI_TEXT.zh.mainSiteNews)])) {
            return "zh";
        }
        if (textMatchesLabel(text, [normalizeText(UI_TEXT.en.mainSiteNews)])) {
            return "en";
        }
        return resolveUiLanguage();
    }

    function updateShortcutLabel(root, nextLabel) {
        const newsLabels = [UI_TEXT.en.mainSiteNews, UI_TEXT.zh.mainSiteNews];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let didReplace = false;

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const currentValue = String(node.nodeValue || "");
            if (!currentValue.trim()) {
                continue;
            }

            let nextValue = currentValue;
            for (const label of newsLabels) {
                nextValue = nextValue.replace(label, nextLabel);
            }

            if (nextValue !== currentValue) {
                node.nodeValue = nextValue;
                didReplace = true;
            }
        }

        if (!didReplace) {
            const textContainer = root.querySelector("span, div, p") || root;
            textContainer.appendChild(document.createTextNode(nextLabel));
        }
    }

    function findMainSiteNewsMenuItem() {
        const newsLabels = getMainSiteNewsLabels();
        const dedupedCandidates = new Map();

        for (const element of Array.from(document.querySelectorAll("a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], div"))) {
            if (!isVisibleElement(element)) {
                continue;
            }

            const menuItem = getMainSiteMenuItemElement(element);
            if (!menuItem || !menuItem.parentElement) {
                continue;
            }

            const text = getElementSearchText(menuItem) || getElementSearchText(element);
            if (!text || !textMatchesLabel(text, newsLabels)) {
                continue;
            }

            const { rect, score } = scoreMainSiteNewsCandidate(menuItem, text, newsLabels);
            if (rect.width < 28 || rect.height < 18) {
                continue;
            }

            const existingCandidate = dedupedCandidates.get(menuItem);
            if (!existingCandidate || score > existingCandidate.score) {
                dedupedCandidates.set(menuItem, {
                    menuItem,
                    rect,
                    score,
                });
            }
        }

        const bestCandidate = Array.from(dedupedCandidates.values())
            .sort((left, right) => (
                right.score - left.score
                || left.rect.top - right.rect.top
                || left.rect.left - right.rect.left
                || left.menuItem.querySelectorAll("*").length - right.menuItem.querySelectorAll("*").length
            ))[0];

        return bestCandidate?.menuItem || null;
    }

    function openSimulatorPage(preferredLanguage = "") {
        if (!document?.body) {
            window.open(SIMULATOR_FALLBACK_URL, "_blank", "noopener,noreferrer");
            return;
        }

        const existingModal = document.getElementById(SIMULATOR_MIRROR_MODAL_ID);
        if (existingModal && existingModal.isConnected) {
            const preferredButton = existingModal.querySelector('[data-mwi-tm-mirror="cloudflare"]');
            if (preferredButton && typeof preferredButton.focus === "function") {
                preferredButton.focus();
            }
            return;
        }

        const previousFocus = document.activeElement;
        const titleId = `${SIMULATOR_MIRROR_MODAL_ID}-title`;
        const descriptionId = `${SIMULATOR_MIRROR_MODAL_ID}-desc`;

        const overlay = document.createElement("div");
        overlay.id = SIMULATOR_MIRROR_MODAL_ID;
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.zIndex = "2147483647";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.padding = "24px";
        overlay.style.background = "rgba(2, 6, 23, 0.72)";
        overlay.style.backdropFilter = "blur(8px)";
        overlay.style.WebkitBackdropFilter = "blur(8px)";
        overlay.style.boxSizing = "border-box";

        function closeModal() {
            document.removeEventListener("keydown", handleKeydown, true);
            overlay.remove();
            if (previousFocus && typeof previousFocus.focus === "function") {
                previousFocus.focus();
            }
        }

        function handleKeydown(event) {
            if (event.key !== "Escape") {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            closeModal();
        }

        document.addEventListener("keydown", handleKeydown, true);
        overlay.addEventListener("click", (event) => {
            if (event.target !== overlay) {
                return;
            }
            closeModal();
        });

        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", descriptionId);
        dialog.style.width = "min(460px, 100%)";
        dialog.style.borderRadius = "16px";
        dialog.style.padding = "18px 18px 14px";
        dialog.style.background = "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92))";
        dialog.style.border = "1px solid rgba(148, 163, 184, 0.22)";
        dialog.style.boxShadow = "0 24px 80px rgba(0, 0, 0, 0.65)";
        dialog.style.color = "#e2e8f0";
        dialog.style.boxSizing = "border-box";
        dialog.addEventListener("click", (event) => {
            event.stopPropagation();
        });

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "flex-start";
        header.style.justifyContent = "space-between";
        header.style.gap = "12px";

        const title = document.createElement("div");
        title.id = titleId;
        title.textContent = getUiText("mirrorModalTitle", preferredLanguage);
        title.style.fontSize = "16px";
        title.style.fontWeight = "750";
        title.style.letterSpacing = "0.01em";
        title.style.lineHeight = "1.25";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "×";
        closeButton.setAttribute("aria-label", getUiText("mirrorModalCancel", preferredLanguage));
        closeButton.style.border = "1px solid rgba(148, 163, 184, 0.22)";
        closeButton.style.background = "rgba(30, 41, 59, 0.48)";
        closeButton.style.color = "#e2e8f0";
        closeButton.style.width = "34px";
        closeButton.style.height = "34px";
        closeButton.style.borderRadius = "12px";
        closeButton.style.cursor = "pointer";
        closeButton.style.display = "inline-flex";
        closeButton.style.alignItems = "center";
        closeButton.style.justifyContent = "center";
        closeButton.style.fontSize = "20px";
        closeButton.style.lineHeight = "1";
        closeButton.style.padding = "0";
        closeButton.style.flexShrink = "0";
        closeButton.addEventListener("click", closeModal);

        const description = document.createElement("div");
        description.id = descriptionId;
        description.textContent = getUiText("mirrorModalDescription", preferredLanguage);
        description.style.marginTop = "8px";
        description.style.fontSize = "13px";
        description.style.color = "rgba(148, 163, 184, 0.95)";
        description.style.lineHeight = "1.45";

        const options = document.createElement("div");
        options.style.display = "grid";
        options.style.gap = "10px";
        options.style.marginTop = "16px";

        function createOptionButton({ id, label, url, accentColor }) {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("data-mwi-tm-mirror", id);
            button.style.width = "100%";
            button.style.textAlign = "left";
            button.style.cursor = "pointer";
            button.style.border = `1px solid ${accentColor}`;
            button.style.background = "rgba(2, 6, 23, 0.25)";
            button.style.borderRadius = "14px";
            button.style.padding = "12px 12px";
            button.style.display = "flex";
            button.style.alignItems = "center";
            button.style.justifyContent = "space-between";
            button.style.gap = "12px";
            button.style.color = "#e2e8f0";
            button.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.04)";
            button.style.transition = "transform 80ms ease, background 120ms ease, border-color 120ms ease";
            button.addEventListener("mouseenter", () => {
                button.style.background = "rgba(30, 41, 59, 0.45)";
                button.style.transform = "translateY(-1px)";
                button.style.borderColor = accentColor;
            });
            button.addEventListener("mouseleave", () => {
                button.style.background = "rgba(2, 6, 23, 0.25)";
                button.style.transform = "";
                button.style.borderColor = accentColor;
            });
            button.addEventListener("click", () => {
                window.open(url, "_blank", "noopener,noreferrer");
                closeModal();
            });

            const labelBlock = document.createElement("div");
            labelBlock.style.display = "flex";
            labelBlock.style.flexDirection = "column";
            labelBlock.style.gap = "4px";
            labelBlock.style.minWidth = "0";

            const labelRow = document.createElement("div");
            labelRow.textContent = label;
            labelRow.style.fontSize = "14px";
            labelRow.style.fontWeight = "750";
            labelRow.style.letterSpacing = "0.01em";
            labelRow.style.color = "#e2e8f0";

            const urlRow = document.createElement("div");
            urlRow.textContent = url.replace(/^https?:\/\//, "");
            urlRow.style.fontSize = "12px";
            urlRow.style.color = "rgba(148, 163, 184, 0.95)";
            urlRow.style.overflow = "hidden";
            urlRow.style.textOverflow = "ellipsis";
            urlRow.style.whiteSpace = "nowrap";

            labelBlock.appendChild(labelRow);
            labelBlock.appendChild(urlRow);

            const arrow = document.createElement("span");
            arrow.setAttribute("aria-hidden", "true");
            arrow.textContent = "↗";
            arrow.style.fontSize = "16px";
            arrow.style.fontWeight = "700";
            arrow.style.color = accentColor;
            arrow.style.flexShrink = "0";

            button.appendChild(labelBlock);
            button.appendChild(arrow);
            return button;
        }

        const cloudflareButton = createOptionButton({
            id: "cloudflare",
            label: getUiText("mirrorModalCloudflare", preferredLanguage),
            url: SIMULATOR_CLOUDFLARE_URL,
            accentColor: "rgba(249, 115, 22, 0.72)",
        });

        const githubButton = createOptionButton({
            id: "github",
            label: getUiText("mirrorModalGithub", preferredLanguage),
            url: SIMULATOR_GITHUB_PAGES_URL,
            accentColor: "rgba(56, 189, 248, 0.78)",
        });

        const footer = document.createElement("div");
        footer.style.display = "flex";
        footer.style.justifyContent = "flex-end";
        footer.style.gap = "10px";
        footer.style.marginTop = "14px";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = getUiText("mirrorModalCancel", preferredLanguage);
        cancelButton.style.cursor = "pointer";
        cancelButton.style.border = "1px solid rgba(148, 163, 184, 0.22)";
        cancelButton.style.background = "rgba(30, 41, 59, 0.25)";
        cancelButton.style.color = "#e2e8f0";
        cancelButton.style.borderRadius = "12px";
        cancelButton.style.padding = "10px 14px";
        cancelButton.style.fontSize = "13px";
        cancelButton.style.fontWeight = "700";
        cancelButton.addEventListener("click", closeModal);

        header.appendChild(title);
        header.appendChild(closeButton);

        options.appendChild(cloudflareButton);
        options.appendChild(githubButton);

        footer.appendChild(cancelButton);

        dialog.appendChild(header);
        dialog.appendChild(description);
        dialog.appendChild(options);
        dialog.appendChild(footer);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        window.setTimeout(() => {
            cloudflareButton.focus();
        }, 0);
    }

    function createMainSiteShortcutIcon() {
        const iconWrapper = document.createElement("span");
        iconWrapper.setAttribute("aria-hidden", "true");
        iconWrapper.style.display = "inline-flex";
        iconWrapper.style.alignItems = "center";
        iconWrapper.style.justifyContent = "center";
        iconWrapper.style.width = "24px";
        iconWrapper.style.height = "24px";
        iconWrapper.style.flexShrink = "0";
        iconWrapper.style.borderRadius = "7px";
        iconWrapper.style.background = "linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(20, 184, 166, 0.14))";
        iconWrapper.style.boxShadow = "inset 0 0 0 1px rgba(103, 232, 249, 0.22)";

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "18");
        svg.setAttribute("height", "18");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "#67e8f9");
        svg.setAttribute("stroke-width", "1.9");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");

        for (const attrs of [
            { cx: "12", cy: "12", r: "4.5" },
            { d: "M12 2.75V5.5" },
            { d: "M12 18.5v2.75" },
            { d: "M2.75 12H5.5" },
            { d: "M18.5 12h2.75" },
            { d: "M5.9 5.9l1.95 1.95" },
            { d: "M16.15 16.15l1.95 1.95" },
            { d: "M18.1 5.9l-1.95 1.95" },
            { d: "M7.85 16.15 5.9 18.1" },
        ]) {
            const element = attrs.cx
                ? document.createElementNS(svgNS, "circle")
                : document.createElementNS(svgNS, "path");
            for (const [key, value] of Object.entries(attrs)) {
                element.setAttribute(key, value);
            }
            svg.appendChild(element);
        }

        iconWrapper.appendChild(svg);
        return iconWrapper;
    }

    function createMainSiteShortcutLabel(preferredLanguage) {
        const label = document.createElement("span");
        label.textContent = getUiText("mainSiteShortcut", preferredLanguage);
        label.style.color = "#fbbf24";
        label.style.fontWeight = "700";
        label.style.letterSpacing = "0.01em";
        label.style.textShadow = "0 0 10px rgba(251, 191, 36, 0.16)";
        return label;
    }

    function isCompactMainSiteMenuItem(referenceItem) {
        if (!isVisibleElement(referenceItem)) {
            return false;
        }

        const rect = referenceItem.getBoundingClientRect();
        return rect.width > 0 && rect.width < 120;
    }

    function createMainSiteShortcut(referenceItem) {
        const shortcut = referenceItem.cloneNode(true);
        const preferredLanguage = detectMainSiteMenuLanguage(referenceItem);
        const compactLayout = isCompactMainSiteMenuItem(referenceItem);

        shortcut.id = MAIN_SITE_SHORTCUT_ID;
        shortcut.setAttribute("data-mwi-tm-main-shortcut", "simulator");
        shortcut.removeAttribute("aria-current");
        shortcut.setAttribute("aria-label", getUiText("mainSiteShortcut", preferredLanguage));
        shortcut.title = getUiText("mainSiteShortcutTitle", preferredLanguage);
        shortcut.style.textDecoration = "none";

        shortcut.querySelectorAll("[id]").forEach((element) => {
            element.removeAttribute("id");
        });

        if (shortcut.tagName === "A") {
            shortcut.href = SIMULATOR_FALLBACK_URL;
            shortcut.target = "_blank";
            shortcut.rel = "noopener noreferrer";
            shortcut.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                openSimulatorPage(preferredLanguage);
            });
            shortcut.addEventListener("keydown", (event) => {
                if (event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                openSimulatorPage(preferredLanguage);
            });
        } else {
            shortcut.setAttribute("role", "link");
            shortcut.tabIndex = 0;
            shortcut.style.cursor = "pointer";
            shortcut.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                openSimulatorPage(preferredLanguage);
            });
            shortcut.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                openSimulatorPage(preferredLanguage);
            });
        }

        shortcut.replaceChildren();

        const content = document.createElement("span");
        content.style.display = "flex";
        content.style.alignItems = "center";
        content.style.justifyContent = compactLayout ? "center" : "flex-start";
        content.style.gap = compactLayout ? "0" : "12px";
        content.style.width = "100%";
        content.style.minWidth = "0";

        const icon = createMainSiteShortcutIcon();

        content.appendChild(icon);
        if (!compactLayout) {
            const label = createMainSiteShortcutLabel(preferredLanguage);
            content.appendChild(label);
        }
        shortcut.appendChild(content);
        return shortcut;
    }

    function mountMainSiteSimulatorShortcut() {
        const existingShortcut = document.getElementById(MAIN_SITE_SHORTCUT_ID);
        if (existingShortcut && existingShortcut.isConnected) {
            return;
        }

        const referenceItem = findMainSiteNewsMenuItem();
        if (!referenceItem || !referenceItem.parentElement) {
            return;
        }

        const shortcut = createMainSiteShortcut(referenceItem);
        referenceItem.parentElement.insertBefore(shortcut, referenceItem);
    }

    function initMainSiteSimulatorShortcut() {
        const observer = new MutationObserver(() => {
            mountMainSiteSimulatorShortcut();
        });

        function attachObserver() {
            mountMainSiteSimulatorShortcut();
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }
        }

        if (document.readyState === "loading") {
            window.addEventListener("DOMContentLoaded", attachObserver, { once: true });
        } else {
            attachObserver();
        }
    }

    function createRequestId() {
        return `mwi-tm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeErrorMessage(error, fallbackMessage) {
        if (typeof error === "string" && error.trim()) {
            return error;
        }

        const message = String(error?.message || "").trim();
        return message || fallbackMessage;
    }

    function waitForWindowMessage(channel, type, requestId, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                window.removeEventListener("message", handleWindowMessage);
                reject(new Error(getUiText("pageBridgeTimeout")));
            }, timeoutMs);

            function handleWindowMessage(event) {
                const data = event.data;
                if (!data || typeof data !== "object") {
                    return;
                }

                if (data.channel !== channel || data.type !== type || data.requestId !== requestId) {
                    return;
                }

                window.clearTimeout(timeoutId);
                window.removeEventListener("message", handleWindowMessage);
                resolve(data);
            }

            window.addEventListener("message", handleWindowMessage);
        });
    }

    function waitForSharedValue(key, requestId, timeoutMs) {
        return new Promise((resolve, reject) => {
            let listenerId = null;
            let intervalId = null;
            const timeoutId = window.setTimeout(() => {
                if (listenerId != null) {
                    GM_removeValueChangeListener(listenerId);
                }
                if (intervalId != null) {
                    window.clearInterval(intervalId);
                }
                reject(new Error(getUiText("mainSiteTabTimeout")));
            }, timeoutMs);

            function maybeResolve(rawValue) {
                if (!rawValue || typeof rawValue !== "object") {
                    return false;
                }

                if (String(rawValue.requestId || "") !== requestId) {
                    return false;
                }

                window.clearTimeout(timeoutId);
                if (listenerId != null) {
                    GM_removeValueChangeListener(listenerId);
                }
                if (intervalId != null) {
                    window.clearInterval(intervalId);
                }
                resolve(rawValue);
                return true;
            }

            const initialValue = GM_getValue(key, null);
            if (maybeResolve(initialValue)) {
                return;
            }

            listenerId = GM_addValueChangeListener(key, (_name, _oldValue, newValue) => {
                maybeResolve(newValue);
            });

            intervalId = window.setInterval(() => {
                maybeResolve(GM_getValue(key, null));
            }, STORAGE_POLL_INTERVAL_MS);
        });
    }

    function parseMainSiteJsonPayload(rawValue) {
        if (typeof rawValue !== "string") {
            return null;
        }

        try {
            return JSON.parse(rawValue);
        } catch (error) {
            return null;
        }
    }

    function isMainSiteGameMessage(message) {
        return Boolean(message && typeof message === "object" && typeof message.type === "string");
    }

    function captureCurrentCharacterState(message) {
        if (!message || typeof message !== "object") {
            return;
        }

        const type = String(message.type || "");
        if (type !== "init_character_data" && type !== "character_updated") {
            return;
        }

        const previousCharacterName = normalizeCharacterName(mainSiteState.currentCharacterName);
        const shouldResetSnapshot = type === "character_updated" && hasCharacterIdentityChanged(message);
        if (shouldResetSnapshot) {
            resetCurrentCharacterTracking(previousCharacterName);
        }

        const characterName = String(message.character?.name || "").trim();
        if (characterName) {
            mainSiteState.currentCharacterName = characterName;
        }

        if (type === "init_character_data") {
            updateCurrentCharacterSnapshot(message, true);
            replaceTrackedCharacterActions(message.characterActions);
            syncCurrentCharacterConsumableSlotMaps(message, true);
            syncCurrentCharacterCombatTriggerMaps(message, true);
            return;
        }

        if (type === "character_updated") {
            updateCurrentCharacterSnapshot(message, shouldResetSnapshot);
            syncCurrentCharacterConsumableSlotMaps(message, shouldResetSnapshot);
            syncCurrentCharacterCombatTriggerMaps(message, shouldResetSnapshot);
        }
    }

    function captureCharacterActionsUpdate(message) {
        if (!message || typeof message !== "object") {
            return;
        }

        const type = String(message.type || "");
        if (type === "actions_updated" || type === "action_completed") {
            mergeTrackedCharacterActions(message.endCharacterActions);
            return;
        }

        if (type === "action_type_consumable_slots_updated") {
            syncCurrentCharacterConsumableSlotMaps(message);
            return;
        }

        if (type === "all_combat_triggers_updated") {
            syncCurrentCharacterCombatTriggerMaps(message);
            return;
        }

        if (type === "combat_triggers_updated") {
            updateCombatTriggerMap(message);
        }
    }

    function handleProfileSharedMessage(message) {
        if (String(message?.type || "") !== "profile_shared" || !message?.profile) {
            return;
        }

        persistProfileCacheEntry(message.profile);
    }

    function instrumentMainSiteSocket(socket) {
        if (!socket || socket.__mwiTmBridgeInstrumented === true) {
            return socket;
        }

        socket.__mwiTmBridgeInstrumented = true;
        mainSiteState.sockets.add(socket);

        socket.addEventListener("message", (event) => {
            const parsed = parseMainSiteJsonPayload(event.data);
            rememberRecentPartyMessage(parsed);

            if (!isMainSiteGameMessage(parsed)) {
                return;
            }

            captureCurrentCharacterState(parsed);
            captureCharacterActionsUpdate(parsed);
            handleProfileSharedMessage(parsed);
        });

        socket.addEventListener("close", () => {
            mainSiteState.sockets.delete(socket);
        });

        return socket;
    }

    function installMainSiteSocketBridge() {
        if (mainSiteState.isInstalled === true) {
            return true;
        }

        const NativeWebSocket = pageWindow?.WebSocket;
        if (typeof NativeWebSocket !== "function") {
            return false;
        }

        if (NativeWebSocket.__mwiTmWrapped === true) {
            mainSiteState.isInstalled = true;
            return true;
        }

        function WrappedWebSocket(url, protocols) {
            const socket = protocols === undefined
                ? new NativeWebSocket(url)
                : new NativeWebSocket(url, protocols);
            return instrumentMainSiteSocket(socket);
        }

        WrappedWebSocket.prototype = NativeWebSocket.prototype;
        Object.defineProperty(WrappedWebSocket, "CONNECTING", { value: NativeWebSocket.CONNECTING });
        Object.defineProperty(WrappedWebSocket, "OPEN", { value: NativeWebSocket.OPEN });
        Object.defineProperty(WrappedWebSocket, "CLOSING", { value: NativeWebSocket.CLOSING });
        Object.defineProperty(WrappedWebSocket, "CLOSED", { value: NativeWebSocket.CLOSED });
        WrappedWebSocket.__mwiTmWrapped = true;
        WrappedWebSocket.__mwiTmNative = NativeWebSocket;
        pageWindow.WebSocket = WrappedWebSocket;

        mainSiteState.isInstalled = true;
        return true;
    }

    function buildCurrentMainSiteResponse(requestId, preferredLanguage = "") {
        const normalizedRequestId = String(requestId || "").trim();
        const payload = buildCurrentCharacterPayload();
        const characterName = normalizeCharacterName(payload?.character?.name || mainSiteState.currentCharacterName);
        const characterId = String(payload?.character?.id || "").trim();

        if (!payload || !characterName) {
            return {
                requestId: normalizedRequestId,
                ok: false,
                format: "main-site-current-character",
                characterId: "",
                characterName: normalizeCharacterName(mainSiteState.currentCharacterName),
                message: getUiText("currentCharacterNotInitialized", preferredLanguage),
            };
        }

        return {
            requestId: normalizedRequestId,
            ok: true,
            format: "main-site-current-character",
            characterId,
            characterName,
            payload,
        };
    }

    function buildTeamMemberResponse(member, preferredLanguage = "") {
        const rawCharacterId = Number(member?.characterId || 0);
        const characterId = Number.isFinite(rawCharacterId) && rawCharacterId > 0 ? String(rawCharacterId) : "";
        const characterName = normalizeCharacterName(member?.characterName || member?.name || "");
        const comparableCharacterName = normalizeComparableText(characterName);
        const isCurrent = member?.isCurrent === true
            || (comparableCharacterName && comparableCharacterName === normalizeComparableText(mainSiteState.currentCharacterName));

        if (isCurrent) {
            const currentResponse = buildCurrentMainSiteResponse("", preferredLanguage);
            return {
                format: String(currentResponse?.format || "main-site-current-character"),
                characterName: normalizeCharacterName(currentResponse?.characterName || characterName) || characterName,
                characterId: String(currentResponse?.characterId || characterId).trim(),
                ok: currentResponse?.ok === true && currentResponse?.payload && typeof currentResponse.payload === "object",
                message: currentResponse?.ok === true
                    ? ""
                    : normalizeErrorMessage(currentResponse?.message, getUiText("currentCharacterNotInitialized", preferredLanguage)),
                payload: currentResponse?.ok === true ? currentResponse.payload : null,
            };
        }

        const cachedEntry = findCachedProfileEntry(characterId, characterName);
        if (!cachedEntry || !cachedEntry.payload) {
            return {
                characterName,
                characterId,
                ok: false,
                message: getUiText("openProfileInGameFirst", preferredLanguage),
                payload: null,
            };
        }

        return {
            format: "shareable-profile",
            characterName: normalizeCharacterName(cachedEntry.characterName || characterName) || characterName,
            characterId: String(cachedEntry.characterId || characterId).trim(),
            ok: true,
            message: "",
            payload: buildCachedProfilePayload(cachedEntry.payload?.profile),
        };
    }

    function buildTeamProfilesResponse(requestIdPrefix, rosterSource, rosterMembers, preferredLanguage = "", extraPayload = {}) {
        const normalizedMembers = (Array.isArray(rosterMembers) ? rosterMembers : [])
            .map((member) => {
                if (!member || typeof member !== "object") {
                    return null;
                }

                const characterName = normalizeCharacterName(member?.characterName || member?.name || "");
                if (!characterName) {
                    return null;
                }

                const rawCharacterId = Number(member?.characterId || 0);
                return {
                    characterId: Number.isFinite(rawCharacterId) ? rawCharacterId : 0,
                    characterName,
                    isCurrent: member?.isCurrent === true,
                };
            })
            .filter((member) => member !== null)
            .slice(0, 5);

        const members = normalizedMembers.map((member) => buildTeamMemberResponse(member, preferredLanguage));
        const hasSuccess = members.some((member) => member.ok === true);
        const firstFailure = members.find((member) => member?.ok !== true && String(member?.message || "").trim());
        const firstFailureName = normalizeCharacterName(firstFailure?.characterName || "");
        return {
            ok: hasSuccess,
            message: hasSuccess
                ? ""
                : (
                    firstFailure
                        ? `${firstFailureName || "-"}: ${String(firstFailure.message || "").trim()}`
                        : getUiText("noMainSiteData", preferredLanguage)
                ),
            payload: {
                rosterSource,
                members,
                ...extraPayload,
            },
        };
    }

    async function requestTeamProfiles(requestId, preferredLanguage = "") {
        const requestIdPrefix = String(requestId || "").trim();
        if (!requestIdPrefix) {
            return null;
        }

        const teamContext = buildTeamRosterContext();
        const cacheMatch = readTeamRosterCache(teamContext);
        const gameStateResult = resolveTeamMemberNamesFromGameState();
        const wsPartyResult = resolveTeamMemberNamesFromRecentPartyMessages();
        const hasActivePartyEvidence = Number(gameStateResult?.partyInfoMemberCount || 0) >= 2
            || Number(teamContext?.partyId || 0) > 0;
        const selectedAutoDetectedRoster = selectAutoDetectedTeamRoster({
            gameStateResult,
            wsPartyResult,
            cacheMatch,
            allowFallbackSources: hasActivePartyEvidence,
        });

        debugTeamRosterAutoDetection({
            context: teamContext,
            hasActivePartyEvidence,
            selectedSource: selectedAutoDetectedRoster.source,
            resolvedFromPath: selectedAutoDetectedRoster.resolvedFromPath,
            partyInfoResolvedRoster: gameStateResult.partyInfoNames,
            partyInfoMemberCount: gameStateResult.partyInfoMemberCount,
            gameStatePartyInfo: gameStateResult.partyInfo,
            wsPartyResolvedRoster: wsPartyResult.names,
            wsPartyMessages: wsPartyResult.messages,
            cacheExactRoster: cacheMatch.exactCharacterNames,
        });

        if (selectedAutoDetectedRoster.names.length < 2 || selectedAutoDetectedRoster.source === "request") {
            clearStaleTeamRosterState(teamContext.currentCharacterName);
            return null;
        }

        const extraPayload = {
            context: teamContext,
        };
        if (selectedAutoDetectedRoster.source !== "cache") {
            extraPayload.resolvedFromPath = selectedAutoDetectedRoster.resolvedFromPath;
        }

        const rosterMembers = Array.isArray(selectedAutoDetectedRoster.members) && selectedAutoDetectedRoster.members.length > 0
            ? selectedAutoDetectedRoster.members
            : selectedAutoDetectedRoster.names.map((name) => ({
                characterId: 0,
                characterName: name,
                isCurrent: normalizeComparableText(name) === normalizeComparableText(teamContext.currentCharacterName),
            }));

        return buildTeamProfilesResponse(
            requestIdPrefix,
            selectedAutoDetectedRoster.source,
            rosterMembers,
            preferredLanguage,
            extraPayload
        );
    }

    function writeMainSiteImportResponse(requestId, format, response, preferredLanguage = "") {
        const isTeamResponse = format === "shareable-profile-team";
        const payload = response?.payload;
        GM_setValue(RESPONSE_KEY, {
            version: isTeamResponse ? 2 : 1,
            requestId,
            source: "milkywayidle",
            format,
            ok: response?.ok === true,
            message: response?.ok === true ? "" : normalizeErrorMessage(response?.message, getUiText("unableToReadCurrentProfile", preferredLanguage)),
            characterId: isTeamResponse ? "" : String(response?.characterId || ""),
            characterName: isTeamResponse ? "" : String(response?.characterName || ""),
            exportedAt: Date.now(),
            payload: payload && typeof payload === "object" ? payload : null,
        });
    }

    function initMainSiteBridge() {
        if (!installMainSiteSocketBridge()) {
            if (document.readyState === "loading") {
                window.addEventListener("DOMContentLoaded", initMainSiteBridge, { once: true });
            }
            return;
        }

        const handledRequestIds = new Set();

        function processImportRequest(rawValue) {
            const request = rawValue && typeof rawValue === "object" ? rawValue : null;
            const requestId = String(request?.requestId || "").trim();
            if (!requestId || handledRequestIds.has(requestId)) {
                return false;
            }

            handledRequestIds.add(requestId);

            const preferredLanguage = resolveUiLanguage(request?.language);
            const target = String(request?.target || "active-player").trim().toLowerCase();

            if (target === "auto") {
                requestTeamProfiles(requestId, preferredLanguage)
                    .then((teamResponse) => {
                        if (Array.isArray(teamResponse?.payload?.members) && teamResponse.payload.members.length > 0) {
                            writeMainSiteImportResponse(requestId, "shareable-profile-team", teamResponse, preferredLanguage);
                            return;
                        }

                        writeMainSiteImportResponse(requestId, "main-site-current-character", buildCurrentMainSiteResponse(requestId, preferredLanguage), preferredLanguage);
                    });
                return true;
            }

            writeMainSiteImportResponse(requestId, "main-site-current-character", buildCurrentMainSiteResponse(requestId, preferredLanguage), preferredLanguage);

            return true;
        }

        GM_addValueChangeListener(REQUEST_KEY, (_name, _oldValue, newValue) => {
            processImportRequest(newValue);
        });

        processImportRequest(GM_getValue(REQUEST_KEY, null));
        window.setInterval(() => {
            processImportRequest(GM_getValue(REQUEST_KEY, null));
        }, STORAGE_POLL_INTERVAL_MS);
    }

    function initSimulatorImportButton() {
        const state = {
            isRequestPending: false,
            uiLanguage: resolveUiLanguage(),
            statusTone: "idle",
            statusText: "",
            statusTextKey: "",
        };

        function getControlElements() {
            const button = document.getElementById(BUTTON_ID);
            const status = document.getElementById(STATUS_ID);
            return { button, status };
        }

        function renderControlState() {
            const { button, status } = getControlElements();
            if (!status || !button) {
                return;
            }

            button.textContent = getUiText("button", state.uiLanguage);
            status.textContent = state.statusTextKey
                ? getUiText(state.statusTextKey, state.uiLanguage)
                : String(state.statusText || "");
            status.className = state.statusTone === "error"
                ? "text-xs text-rose-300"
                : (state.statusTone === "success" ? "text-xs text-teal-200" : "text-xs text-cyan-200");
            button.disabled = state.isRequestPending;
        }

        function setStatus(text, tone = "idle") {
            state.statusTone = tone;
            state.statusText = String(text || "");
            state.statusTextKey = "";
            renderControlState();
        }

        function setStatusKey(statusTextKey, tone = "idle") {
            state.statusTone = tone;
            state.statusText = "";
            state.statusTextKey = String(statusTextKey || "");
            renderControlState();
        }

        function syncControlLanguage(force = false) {
            const nextLanguage = resolveUiLanguage();
            if (!force && nextLanguage === state.uiLanguage) {
                return;
            }

            state.uiLanguage = nextLanguage;
            renderControlState();
        }

        async function requestMainSiteAutoImport(requestId) {
            GM_setValue(REQUEST_KEY, {
                version: 2,
                requestId,
                createdAt: Date.now(),
                target: "auto",
                language: state.uiLanguage,
            });

            return waitForSharedValue(RESPONSE_KEY, requestId, REQUEST_TIMEOUT_MS);
        }

        async function importPayloadIntoSimulator(requestId, payload, options = {}) {
            const responsePromise = waitForWindowMessage(APP_BRIDGE_CHANNEL, "mwi-tm-import-result", requestId, APP_IMPORT_TIMEOUT_MS);
            const safeOptions = options && typeof options === "object" ? options : {};
            const format = String(safeOptions.format || "shareable-profile").trim() || "shareable-profile";
            const { format: _ignoredFormat, ...messageOptions } = safeOptions;

            window.postMessage({
                ...messageOptions,
                channel: APP_BRIDGE_CHANNEL,
                type: "mwi-tm-import",
                requestId,
                format,
                payload,
            }, window.location.origin);

            return responsePromise;
        }

        function formatTeamImportSummary(successCount, failureEntries = []) {
            const failures = Array.isArray(failureEntries) ? failureEntries : [];
            const failedCount = failures.length;
            if (failedCount <= 0) {
                return "";
            }

            const preview = failures
                .slice(0, 2)
                .map((entry) => {
                    const name = normalizeCharacterName(entry?.name || "") || "-";
                    const message = normalizeCharacterName(entry?.message || "") || getUiText("importFailed", state.uiLanguage);
                    return `${name}: ${message}`;
                })
                .join(state.uiLanguage === "zh" ? "；" : "; ");

            const suffix = failedCount > 2
                ? (state.uiLanguage === "zh" ? `……另有 ${failedCount - 2} 个失败` : `… +${failedCount - 2} more`)
                : "";

            if (state.uiLanguage === "zh") {
                return `成功 ${successCount} 人，失败 ${failedCount} 人（${preview}${suffix}）。`;
            }

            return `${successCount} succeeded, ${failedCount} failed (${preview}${suffix}).`;
        }

        function isTeamImportResponse(response) {
            return String(response?.format || "") === "shareable-profile-team"
                && response?.payload
                && typeof response.payload === "object";
        }

        function persistImportedTeamRoster(teamPayload, members) {
            const cacheContext = teamPayload?.context;
            const cacheNames = (Array.isArray(members) ? members : [])
                .map((member) => normalizeCharacterName(member?.characterName || ""))
                .filter(Boolean);
            if (cacheNames.length < 2) {
                return;
            }

            persistTeamRosterCache(cacheContext, cacheNames);
        }

        async function importSingleMainSiteResponse(mainSiteResponse, requestId) {
            if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
                throw new Error(mainSiteResponse?.message || getUiText("noMainSiteData", state.uiLanguage));
            }

            setStatusKey("importingSimulator", "idle");
            const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
                clearOtherPlayers: true,
                resetTeamSelection: true,
                selectAfterImport: true,
                format: String(mainSiteResponse?.format || "shareable-profile"),
            });
            if (!appResponse || appResponse.ok !== true) {
                throw new Error(appResponse?.message || getUiText("simulatorImportFailed", state.uiLanguage));
            }

            setStatusKey("importSuccess", "success");
        }

        async function importTeamMainSiteResponse(mainSiteResponse) {
            const payload = mainSiteResponse?.payload;
            const members = Array.isArray(payload?.members) ? payload.members : [];
            if (members.length === 0) {
                throw new Error(mainSiteResponse?.message || getUiText("noMainSiteData", state.uiLanguage));
            }

            const failureEntries = [];
            for (const member of members) {
                if (!member || typeof member !== "object" || member.ok === true) {
                    continue;
                }

                failureEntries.push({
                    name: String(member.characterName || "").trim() || "-",
                    message: String(member.message || "").trim() || getUiText("importFailed", state.uiLanguage),
                });
            }

            const successfulMembers = members
                .filter((member) => {
                    return member
                        && typeof member === "object"
                        && member.ok === true
                        && member.payload
                        && typeof member.payload === "object";
                });

            if (successfulMembers.length === 0) {
                const firstFailure = failureEntries[0];
                throw new Error(
                    firstFailure
                        ? `${firstFailure.name}: ${firstFailure.message}`
                        : (mainSiteResponse?.message || getUiText("noMainSiteData", state.uiLanguage))
                );
            }

            setStatusKey("importingSimulator", "idle");

            let importedCount = 0;
            const teamTargetPlayerIds = [...TEAM_IMPORT_PLAYER_IDS];
            let didClearTeamSlots = false;
            let didResetTeamSelection = false;
            for (const member of successfulMembers.slice(0, TEAM_IMPORT_PLAYER_IDS.length)) {
                const targetPlayerId = TEAM_IMPORT_PLAYER_IDS[importedCount] || String(importedCount + 1);
                const appRequestId = createRequestId();
                const clearPlayerIds = didClearTeamSlots ? [] : teamTargetPlayerIds;

                // eslint-disable-next-line no-await-in-loop
                const appResponse = await importPayloadIntoSimulator(appRequestId, member.payload, {
                    targetPlayerId,
                    clearPlayerIds,
                    resetTeamSelection: !didResetTeamSelection,
                    selectAfterImport: true,
                    format: String(member?.format || "shareable-profile"),
                });

                if (!appResponse || appResponse.ok !== true) {
                    failureEntries.push({
                        name: String(member.characterName || "").trim() || `Player ${targetPlayerId}`,
                        message: String(appResponse?.message || "").trim() || getUiText("simulatorImportFailed", state.uiLanguage),
                    });
                    continue;
                }

                didClearTeamSlots = true;
                didResetTeamSelection = true;
                importedCount += 1;
            }

            if (importedCount <= 0) {
                const firstFailure = failureEntries[0];
                throw new Error(firstFailure ? `${firstFailure.name}: ${firstFailure.message}` : getUiText("importFailed", state.uiLanguage));
            }

            persistImportedTeamRoster(payload, members);

            if (failureEntries.length === 0) {
                setStatusKey("importSuccess", "success");
                return;
            }

            const summary = formatTeamImportSummary(importedCount, failureEntries);
            setStatus(state.uiLanguage === "zh" ? `导入完成：${summary}` : `Import finished: ${summary}`, "success");
        }

        async function handleImportButtonClick() {
            if (state.isRequestPending) {
                return;
            }

            const requestId = createRequestId();
            state.isRequestPending = true;
            setStatusKey("waitingMainSite", "idle");

            try {
                const mainSiteResponse = await requestMainSiteAutoImport(requestId);
                if (isTeamImportResponse(mainSiteResponse)) {
                    await importTeamMainSiteResponse(mainSiteResponse);
                } else {
                    await importSingleMainSiteResponse(mainSiteResponse, requestId);
                }
            } catch (error) {
                setStatus(normalizeErrorMessage(error, getUiText("importFailed", state.uiLanguage)), "error");
            } finally {
                state.isRequestPending = false;
                const { button } = getControlElements();
                if (button) {
                    button.disabled = false;
                }
                renderControlState();
            }
        }

        function mountImportControl() {
            const actionBar = document.querySelector('[data-tm-import-anchor="simulator-home-actions"]');
            if (!actionBar) {
                return;
            }

            const referenceButton = actionBar.querySelector('[data-tm-import-reference="import-export"]');
            if (document.getElementById(CONTROL_ID)) {
                return;
            }

            const wrapper = document.createElement("span");
            wrapper.id = CONTROL_ID;
            wrapper.className = "inline-flex items-center gap-2";

            const button = document.createElement("button");
            button.id = BUTTON_ID;
            button.type = "button";
            button.textContent = getUiText("button", state.uiLanguage);
            button.className = "action-button-tool";
            button.addEventListener("click", handleImportButtonClick);

            const status = document.createElement("span");
            status.id = STATUS_ID;
            status.className = "text-xs text-cyan-200";
            status.textContent = "";

            wrapper.appendChild(button);
            wrapper.appendChild(status);

            if (referenceButton && referenceButton.nextSibling) {
                actionBar.insertBefore(wrapper, referenceButton.nextSibling);
            } else {
                actionBar.appendChild(wrapper);
            }

            syncControlLanguage(true);
            setStatus("", "idle");
        }

        function startObserving() {
            const observer = new MutationObserver(() => {
                mountImportControl();
            });

            function attachObserver() {
                mountImportControl();
                window.setInterval(() => {
                    syncControlLanguage();
                }, 500);
                if (document.body) {
                    observer.observe(document.body, { childList: true, subtree: true });
                }
            }

            if (document.readyState === "loading") {
                window.addEventListener("DOMContentLoaded", attachObserver, { once: true });
            } else {
                attachObserver();
            }
        }

        startObserving();
    }

    function cloneDebugValue(value) {
        return value == null ? null : JSON.parse(JSON.stringify(value));
    }

    function isTruthyDebugFlag(value) {
        const normalized = String(value || "").trim().toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
    }

    function shouldInstallDebugInterface() {
        try {
            const searchParams = new URLSearchParams(String(window.location?.search || ""));
            if (isTruthyDebugFlag(searchParams.get(DEBUG_QUERY_PARAM))) {
                return true;
            }
        } catch (_error) {
        }

        try {
            if (isTruthyDebugFlag(window.localStorage?.getItem(DEBUG_STORAGE_KEY))) {
                return true;
            }
        } catch (_error) {
        }

        const hostname = String(window.location?.hostname || "").trim().toLowerCase();
        return hostname === "localhost" || hostname === "127.0.0.1";
    }

    function installDebugInterface() {
        if (!shouldInstallDebugInterface()) {
            return;
        }

        const debugApi = {
            getProfileCache() {
                return cloneDebugValue(GM_getValue(PROFILE_CACHE_KEY, null));
            },
            getTeamRosterCache() {
                return cloneDebugValue(GM_getValue(TEAM_ROSTER_CACHE_KEY, null));
            },
            getCurrentCharacterState() {
                return cloneDebugValue({
                    currentCharacterName: mainSiteState.currentCharacterName,
                    currentCharacterSnapshot: mainSiteState.currentCharacterSnapshot,
                    actionTypeFoodSlotsMap: mainSiteState.actionTypeFoodSlotsMap,
                    actionTypeDrinkSlotsMap: mainSiteState.actionTypeDrinkSlotsMap,
                    consumableCombatTriggersMap: mainSiteState.consumableCombatTriggersMap,
                    abilityCombatTriggersMap: mainSiteState.abilityCombatTriggersMap,
                    readiness: {
                        snapshot: hasCurrentCharacterSnapshot(),
                        consumableSlots: hasCurrentCharacterConsumableSlots(),
                        combatTriggers: hasCurrentCharacterCombatTriggerSnapshot(),
                        foodSlots: mainSiteState.currentCharacterFoodSlotsReady === true,
                        drinkSlots: mainSiteState.currentCharacterDrinkSlotsReady === true,
                        consumableTriggers: mainSiteState.currentCharacterConsumableTriggersReady === true,
                        abilityTriggers: mainSiteState.currentCharacterAbilityTriggersReady === true,
                    },
                    importPayloadPreview: buildCurrentCharacterPayload(),
                });
            },
        };

        const frozenDebugApi = Object.freeze(debugApi);
        const targets = [window];
        if (typeof unsafeWindow !== "undefined" && unsafeWindow && unsafeWindow !== window) {
            targets.push(unsafeWindow);
        }

        for (const target of targets) {
            try {
                Object.defineProperty(target, "__mwiImportDebug", {
                    configurable: true,
                    value: frozenDebugApi,
                    writable: false,
                });
            } catch (_error) {
            }
        }
    }

    installDebugInterface();

    if (isMainSitePage()) {
        initMainSiteBridge();
        initMainSiteSimulatorShortcut();
    }

    if (isSimulatorPage()) {
        initSimulatorImportButton();
    }
})();
