// ==UserScript==
// @name         MWI Combat Simulator 主站一键导入
// @name:zh      MWI Combat Simulator 主站一键导入
// @name:zh-CN   MWI Combat Simulator 主站一键导入
// @namespace    https://azhu949.github.io/MWICombatSimulator
// @version      0.1.19
// @license      ISC
// @description  Import the current Milky Way Idle character or detected team into MWI Combat Simulator with one click.
// @description:zh      一键将 Milky Way Idle 主站当前角色或已识别队伍导入到 MWI Combat Simulator。
// @description:zh-CN   一键将 Milky Way Idle 主站当前角色或已识别队伍导入到 MWI Combat Simulator。
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
    const MAIN_SITE_BRIDGE_CHANNEL = "mwi-tm-main-bridge";
    const BUTTON_ID = "mwi-tm-import-button";
    const CONTROL_ID = "mwi-tm-import-control";
    const STATUS_ID = "mwi-tm-import-status";
    const TEAM_ROSTER_CACHE_KEY = "mwi.tm.import.teamRosterCache.v1";
    const MAIN_SITE_SHORTCUT_ID = "mwi-tm-main-site-simulator-link";
    const SIMULATOR_GITHUB_PAGES_URL = "https://azhu949.github.io/MWICombatSimulator/";
    const SIMULATOR_CLOUDFLARE_URL = "https://mwi-combatsi-mulator.pages.dev/";
    const SIMULATOR_FALLBACK_URL = SIMULATOR_GITHUB_PAGES_URL;
    const SIMULATOR_MIRROR_MODAL_ID = "mwi-tm-simulator-mirror-modal";
    const REQUEST_TIMEOUT_MS = 12000;
    const PAGE_REQUEST_TIMEOUT_MS = 10000;
    const APP_IMPORT_TIMEOUT_MS = 8000;
    const STORAGE_POLL_INTERVAL_MS = 250;
    const TEAM_ROSTER_CACHE_BUCKET_LIMIT = 24;
    const RECENT_PARTY_MESSAGE_LIMIT = 20;
    const SHAREABLE_PROFILE_MODAL_SELECTOR = '[class*="SharableProfile_modalContainer__"]';
    const SHAREABLE_PROFILE_BACKGROUND_SELECTOR = '[class*="SharableProfile_background__"]';
    const SHAREABLE_PROFILE_CLOSE_BUTTON_SELECTOR = '[class*="SharableProfile_closeButton__"]';
    const SHAREABLE_PROFILE_NAME_SELECTOR = '[class*="SharableProfile_name__"]';
    const SHAREABLE_PROFILE_CLEANUP_TIMEOUT_MS = 2500;
    const SHAREABLE_PROFILE_CLEANUP_POLL_INTERVAL_MS = 100;
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
            profileSharedTimeout: "Timed out waiting for profile_shared response.",
            duplicateRequestPending: "A duplicate import request is already pending.",
            mainSiteBridgeUnavailable: "WebSocket bridge unavailable. Refresh the main-site tab once.",
            missingRequestId: "Missing request id.",
            gameConnectionUnavailable: "Game connection unavailable. Refresh the main-site tab once.",
            currentCharacterNotInitialized: "Current character not initialized. Refresh the main-site tab once.",
            unableToReadCurrentProfile: "Unable to read the current profile.",
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
            profileSharedTimeout: "等待 profile_shared 响应超时。",
            duplicateRequestPending: "已有重复的导入请求正在处理中。",
            mainSiteBridgeUnavailable: "WebSocket bridge 不可用，请刷新一次主站标签页。",
            missingRequestId: "缺少请求 ID。",
            gameConnectionUnavailable: "游戏连接不可用，请刷新一次主站标签页。",
            currentCharacterNotInitialized: "当前角色尚未初始化，请刷新一次主站标签页。",
            unableToReadCurrentProfile: "无法读取当前角色资料。",
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
        lastGameSocket: null,
        currentCharacterName: "",
        characterActions: [],
        recentPartyMessages: [],
        currentCombatAction: null,
        actionTypeFoodSlotsMap: {},
        actionTypeDrinkSlotsMap: {},
        consumableCombatTriggersMap: {},
        abilityCombatTriggersMap: {},
        pendingRequests: new Map(),
    };
    const COMBAT_ACTION_TYPE_HRID = "/action_types/combat";

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
        const currentAction = mainSiteState.characterActions.find((action) => isCombatActionHrid(action?.actionHrid)) || null;
        if (!currentAction) {
            mainSiteState.currentCombatAction = null;
            return;
        }

        const partyId = Number(currentAction?.partyID ?? currentAction?.partyId ?? 0);

        mainSiteState.currentCombatAction = {
            actionHrid: String(currentAction.actionHrid || "").trim(),
            difficultyTier: normalizeDifficultyTier(currentAction.difficultyTier),
            partyId: Number.isFinite(partyId) ? partyId : 0,
        };
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

        const names = normalizeCharacterNameList(
            orderedMembers
                .map((entry) => normalizeCharacterName(entry?.name || ""))
                .filter(Boolean),
            5
        );
        if (names.length < 2) {
            return null;
        }

        return {
            path,
            names,
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
            partyInfo,
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
                    messages,
                    resolvedFromPath: candidate.path,
                };
            }
        }

        return {
            names: [],
            messages,
            resolvedFromPath: "",
        };
    }

    function selectAutoDetectedTeamRoster({ gameStateResult, wsPartyResult, cacheMatch }) {
        const candidates = [
            {
                source: "game-state:partyInfo",
                names: gameStateResult?.partyInfoNames ?? [],
                resolvedFromPath: gameStateResult?.partyInfoResolvedFromPath || "",
            },
            {
                source: "ws-party",
                names: wsPartyResult?.names ?? [],
                resolvedFromPath: wsPartyResult?.resolvedFromPath || "",
            },
            {
                source: "cache",
                names: cacheMatch?.exactCharacterNames ?? [],
                resolvedFromPath: "",
            },
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate.names) && candidate.names.length >= 2) {
                return candidate;
            }
        }

        return {
            source: "request",
            names: [],
            resolvedFromPath: "",
        };
    }

    function debugTeamRosterAutoDetection(details) {
        try {
            console.debug("[MWI TM] Team roster auto-detect", details);
        } catch (_error) {
        }
    }

    function isCloseLabelText(value) {
        const normalized = normalizeComparableText(value);
        return normalized === "close" || normalized === "关闭";
    }

    function isDomElement(value) {
        return Boolean(value)
            && typeof value === "object"
            && Number(value.nodeType) === 1
            && typeof value.querySelector === "function";
    }

    function isConnectedDomElement(value) {
        return isDomElement(value) && value.isConnected !== false;
    }

    function isClickableDomElement(value) {
        return isConnectedDomElement(value)
            && typeof value.dispatchEvent === "function";
    }

    function getSharableProfileModalContainers() {
        return Array.from(document.querySelectorAll(SHAREABLE_PROFILE_MODAL_SELECTOR))
            .filter((element) => isConnectedDomElement(element));
    }

    function readSharableProfileCharacterName(container) {
        if (!isDomElement(container)) {
            return "";
        }

        const explicitName = String(container.querySelector(SHAREABLE_PROFILE_NAME_SELECTOR)?.textContent || "").trim();
        if (explicitName) {
            return explicitName;
        }

        const headingCandidates = container.querySelectorAll("h1, h2, h3, [data-character-name]");
        for (const candidate of headingCandidates) {
            const text = String(candidate?.textContent || "").trim();
            if (text && !isCloseLabelText(text)) {
                return text;
            }
        }

        return "";
    }

    function getLatestSharableProfileModalContainer(containers) {
        const list = Array.isArray(containers) ? containers.filter((container) => isConnectedDomElement(container)) : [];
        return list.length > 0 ? list[list.length - 1] : null;
    }

    function createSharableProfileModalSnapshot() {
        const containers = getSharableProfileModalContainers();
        return {
            count: containers.length,
            characterNames: containers
                .map((container) => readSharableProfileCharacterName(container))
                .filter((name) => String(name || "").trim().length > 0),
            capturedAt: Date.now(),
        };
    }

    function snapshotHasSharableProfileCharacter(snapshot, characterName) {
        const normalizedCharacterName = normalizeComparableText(characterName);
        if (!normalizedCharacterName) {
            return false;
        }

        const characterNames = Array.isArray(snapshot?.characterNames) ? snapshot.characterNames : [];
        return characterNames.some((name) => normalizeComparableText(name) === normalizedCharacterName);
    }

    function findSharableProfileCloseControl(container) {
        if (!isDomElement(container)) {
            return null;
        }

        const directCloseButton = container.querySelector(SHAREABLE_PROFILE_CLOSE_BUTTON_SELECTOR);
        if (isClickableDomElement(directCloseButton)) {
            return directCloseButton;
        }

        const candidateSelectors = [
            "button",
            "[role=button]",
            "img[alt]",
            "[aria-label]",
            "[title]",
            "div",
            "span",
        ].join(", ");

        const candidateElements = container.querySelectorAll(candidateSelectors);
        for (const candidate of candidateElements) {
            const labels = [
                candidate.getAttribute?.("aria-label"),
                candidate.getAttribute?.("title"),
                candidate.getAttribute?.("alt"),
                candidate.textContent,
            ];

            if (!labels.some((label) => isCloseLabelText(label))) {
                continue;
            }

            const clickableAncestor = candidate.closest("button, [role=button], div, span");
            if (isClickableDomElement(clickableAncestor)) {
                return clickableAncestor;
            }

            if (isClickableDomElement(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    function clickSharableProfileCloseTarget(target) {
        if (!isClickableDomElement(target)) {
            return false;
        }

        try {
            if (typeof target.click === "function") {
                target.click();
                return true;
            }

            target.dispatchEvent(new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
            }));
            return true;
        } catch (_error) {
            return false;
        }
    }

    function scheduleSharableProfileModalCleanup(pendingRequest, characterName) {
        const normalizedCharacterName = normalizeComparableText(characterName || pendingRequest?.characterName);
        if (!normalizedCharacterName) {
            return;
        }

        const modalSnapshot = pendingRequest?.modalSnapshot;
        if (snapshotHasSharableProfileCharacter(modalSnapshot, normalizedCharacterName)) {
            return;
        }

        const baselineCount = Math.max(0, Number(modalSnapshot?.count || 0));
        const canCloseWithoutNewModalCount = baselineCount === 0;
        const deadlineAt = Date.now() + SHAREABLE_PROFILE_CLEANUP_TIMEOUT_MS;

        function attemptCleanup() {
            const containers = getSharableProfileModalContainers();
            const matchingContainers = containers.filter((container) => {
                return normalizeComparableText(readSharableProfileCharacterName(container)) === normalizedCharacterName;
            });

            const hasNewTopLevelModal = containers.length > baselineCount;
            const targetContainer = matchingContainers.length > 0
                ? matchingContainers[matchingContainers.length - 1]
                : ((canCloseWithoutNewModalCount || hasNewTopLevelModal)
                    ? getLatestSharableProfileModalContainer(containers)
                    : null);

            if (targetContainer) {
                const background = targetContainer.querySelector(SHAREABLE_PROFILE_BACKGROUND_SELECTOR);
                if (clickSharableProfileCloseTarget(background)) {
                    return;
                }

                const closeControl = findSharableProfileCloseControl(targetContainer);
                if (clickSharableProfileCloseTarget(closeControl)) {
                    return;
                }
            }

            if (Date.now() >= deadlineAt) {
                return;
            }

            window.setTimeout(attemptCleanup, SHAREABLE_PROFILE_CLEANUP_POLL_INTERVAL_MS);
        }

        window.setTimeout(attemptCleanup, 0);
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
            }
            return;
        }

        if (triggerTypeHrid === "/combat_trigger_types/ability") {
            const abilityHrid = String(message?.abilityHrid || "").trim();
            if (abilityHrid) {
                mainSiteState.abilityCombatTriggersMap[abilityHrid] = JSON.parse(JSON.stringify(combatTriggers));
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

    function markMainSiteSocket(socket) {
        mainSiteState.lastGameSocket = socket;
    }

    function captureCurrentCharacterName(message) {
        if (!message || typeof message !== "object") {
            return;
        }

        const type = String(message.type || "");
        if (type !== "init_character_data" && type !== "character_updated") {
            return;
        }

        const characterName = String(message.character?.name || "").trim();
        if (characterName) {
            mainSiteState.currentCharacterName = characterName;
        }

        if (type === "init_character_data") {
            replaceTrackedCharacterActions(message.characterActions);
            replaceConsumableSlotMaps(message.actionTypeFoodSlotsMap, message.actionTypeDrinkSlotsMap);
            replaceCombatTriggerMaps(message.consumableCombatTriggersMap, message.abilityCombatTriggersMap);
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
            replaceConsumableSlotMaps(message.actionTypeFoodSlotsMap, message.actionTypeDrinkSlotsMap);
            return;
        }

        if (type === "all_combat_triggers_updated") {
            replaceCombatTriggerMaps(message.consumableCombatTriggersMap, message.abilityCombatTriggersMap);
            return;
        }

        if (type === "combat_triggers_updated") {
            updateCombatTriggerMap(message);
        }
    }

    function buildMainSiteConsumablesPayload() {
        const foodItemHrids = Array.isArray(mainSiteState.actionTypeFoodSlotsMap?.[COMBAT_ACTION_TYPE_HRID])
            ? mainSiteState.actionTypeFoodSlotsMap[COMBAT_ACTION_TYPE_HRID]
            : [];
        const drinkItemHrids = Array.isArray(mainSiteState.actionTypeDrinkSlotsMap?.[COMBAT_ACTION_TYPE_HRID])
            ? mainSiteState.actionTypeDrinkSlotsMap[COMBAT_ACTION_TYPE_HRID]
            : [];

        function normalizeConsumableSlotItemHrid(slotValue) {
            if (!slotValue) {
                return "";
            }

            if (typeof slotValue === "string") {
                return String(slotValue || "");
            }

            if (typeof slotValue === "object") {
                return String(slotValue.itemHrid || "");
            }

            return "";
        }

        return {
            foodItemHrids: [0, 1, 2].map((index) => normalizeConsumableSlotItemHrid(foodItemHrids[index])),
            drinkItemHrids: [0, 1, 2].map((index) => normalizeConsumableSlotItemHrid(drinkItemHrids[index])),
            consumableCombatTriggersMap: clonePlainObject(mainSiteState.consumableCombatTriggersMap),
            abilityCombatTriggersMap: clonePlainObject(mainSiteState.abilityCombatTriggersMap),
        };
    }

    function resolveMainSitePendingRequest(requestId, response) {
        const pendingRequest = mainSiteState.pendingRequests.get(requestId);
        if (!pendingRequest) {
            return;
        }

        window.clearTimeout(pendingRequest.timeoutId);
        mainSiteState.pendingRequests.delete(requestId);
        pendingRequest.resolve(response);
    }

    function handleProfileSharedMessage(message) {
        if (String(message?.type || "") !== "profile_shared" || !message?.profile) {
            return;
        }

        const characterName = String(message.profile?.sharableCharacter?.name || mainSiteState.currentCharacterName || "").trim();
        const comparableCharacterName = normalizeComparableText(characterName);
        const characterId = String(
            message.profile?.sharableCharacter?.id
            || message.profile?.sharableCharacter?.characterID
            || message.profile?.sharableCharacter?.characterId
            || ""
        ).trim();

        for (const [requestId, pendingRequest] of Array.from(mainSiteState.pendingRequests.entries())) {
            const pendingName = normalizeComparableText(pendingRequest.characterName);
            if (pendingName) {
                if (!comparableCharacterName) {
                    continue;
                }

                if (pendingName !== comparableCharacterName) {
                    continue;
                }
            }

            scheduleSharableProfileModalCleanup(pendingRequest, characterName);

            resolveMainSitePendingRequest(requestId, {
                requestId,
                ok: true,
                characterId,
                characterName,
                payload: {
                    profile: message.profile,
                    mainSiteCombat: mainSiteState.currentCombatAction ? {
                        actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ""),
                        difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
                    } : null,
                    mainSiteConsumables: buildMainSiteConsumablesPayload(),
                },
            });
        }
    }

    function instrumentMainSiteSocket(socket) {
        if (!socket || socket.__mwiTmBridgeInstrumented === true) {
            return socket;
        }

        socket.__mwiTmBridgeInstrumented = true;
        mainSiteState.sockets.add(socket);

        const nativeSend = socket.send.bind(socket);
        socket.send = function wrappedSend(data) {
            const parsed = parseMainSiteJsonPayload(data);
            if (isMainSiteGameMessage(parsed)) {
                markMainSiteSocket(socket);
            }
            return nativeSend(data);
        };

        socket.addEventListener("message", (event) => {
            const parsed = parseMainSiteJsonPayload(event.data);
            rememberRecentPartyMessage(parsed);

            if (!isMainSiteGameMessage(parsed)) {
                return;
            }

            markMainSiteSocket(socket);
            captureCurrentCharacterName(parsed);
            captureCharacterActionsUpdate(parsed);
            handleProfileSharedMessage(parsed);
        });

        socket.addEventListener("close", () => {
            mainSiteState.sockets.delete(socket);
            if (mainSiteState.lastGameSocket === socket) {
                mainSiteState.lastGameSocket = null;
            }
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

    function getOpenMainSiteSocket() {
        const WebSocketCtor = pageWindow?.WebSocket;
        const openState = typeof WebSocketCtor?.OPEN === "number" ? WebSocketCtor.OPEN : 1;

        if (mainSiteState.lastGameSocket && mainSiteState.lastGameSocket.readyState === openState) {
            return mainSiteState.lastGameSocket;
        }

        for (const socket of mainSiteState.sockets) {
            if (socket.readyState === openState) {
                return socket;
            }
        }

        return null;
    }

    function requestMainSiteProfileByCharacterName(requestId, characterName, preferredLanguage = "", missingCharacterNameMessageKey = "unableToReadCurrentProfile") {
        return new Promise((resolve) => {
            if (!installMainSiteSocketBridge()) {
                resolve({
                    requestId,
                    ok: false,
                    message: getUiText("mainSiteBridgeUnavailable", preferredLanguage),
                });
                return;
            }

            const normalizedRequestId = String(requestId || "").trim();
            const socket = getOpenMainSiteSocket();
            if (!normalizedRequestId) {
                resolve({
                    requestId: normalizedRequestId,
                    ok: false,
                    message: getUiText("missingRequestId", preferredLanguage),
                });
                return;
            }

            if (!socket) {
                resolve({
                    requestId: normalizedRequestId,
                    ok: false,
                    message: getUiText("gameConnectionUnavailable", preferredLanguage),
                });
                return;
            }

            const normalizedCharacterName = normalizeCharacterName(characterName);
            if (!normalizedCharacterName) {
                resolve({
                    requestId: normalizedRequestId,
                    ok: false,
                    message: getUiText(missingCharacterNameMessageKey, preferredLanguage),
                });
                return;
            }

            if (mainSiteState.pendingRequests.has(normalizedRequestId)) {
                resolve({
                    requestId: normalizedRequestId,
                    ok: false,
                    message: getUiText("duplicateRequestPending", preferredLanguage),
                });
                return;
            }

            const timeoutId = window.setTimeout(() => {
                resolveMainSitePendingRequest(normalizedRequestId, {
                    requestId: normalizedRequestId,
                    ok: false,
                    characterId: "",
                    characterName: normalizedCharacterName,
                    message: getUiText("profileSharedTimeout", preferredLanguage),
                });
            }, PAGE_REQUEST_TIMEOUT_MS);

            mainSiteState.pendingRequests.set(normalizedRequestId, {
                characterName: normalizedCharacterName,
                requestStartedAt: Date.now(),
                modalSnapshot: createSharableProfileModalSnapshot(),
                timeoutId,
                resolve,
            });

            socket.send(JSON.stringify({
                type: "view_profile",
                viewProfileData: {
                    characterName: normalizedCharacterName,
                },
            }));
        });
    }

    function requestCurrentMainSiteProfile(requestId, preferredLanguage = "") {
        return requestMainSiteProfileByCharacterName(
            requestId,
            mainSiteState.currentCharacterName,
            preferredLanguage,
            "currentCharacterNotInitialized"
        );
    }

    function buildTeamProfilesResponse(requestIdPrefix, rosterSource, rosterNames, preferredLanguage = "", extraPayload = {}) {
        const normalizedRosterNames = normalizeCharacterNameList(rosterNames, 5);
        const tasks = normalizedRosterNames.map((name, index) => {
            return requestMainSiteProfileByCharacterName(`${requestIdPrefix}:${index}`, name, preferredLanguage);
        });

        return Promise.all(tasks)
            .then((responses) => {
                const members = responses.map((response, index) => {
                    const fallbackName = normalizedRosterNames[index] || "";
                    const resolvedName = normalizeCharacterName(response?.characterName || fallbackName) || fallbackName;
                    const ok = response?.ok === true && response?.payload && typeof response.payload === "object";
                    return {
                        characterName: resolvedName,
                        characterId: String(response?.characterId || "").trim(),
                        ok,
                        message: ok ? "" : normalizeErrorMessage(response?.message, getUiText("unableToReadCurrentProfile", preferredLanguage)),
                        payload: ok ? response.payload : null,
                    };
                });

                const hasSuccess = members.some((member) => member.ok === true);
                return {
                    ok: hasSuccess,
                    message: hasSuccess ? "" : getUiText("noMainSiteData", preferredLanguage),
                    payload: {
                        rosterSource,
                        members,
                        ...extraPayload,
                    },
                };
            })
            .catch((error) => {
                return {
                    ok: false,
                    message: normalizeErrorMessage(error, getUiText("unableToReadCurrentProfile", preferredLanguage)),
                    payload: {
                        rosterSource,
                        members: [],
                        ...extraPayload,
                    },
                };
            });
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
        const selectedAutoDetectedRoster = selectAutoDetectedTeamRoster({
            gameStateResult,
            wsPartyResult,
            cacheMatch,
        });

        debugTeamRosterAutoDetection({
            context: teamContext,
            selectedSource: selectedAutoDetectedRoster.source,
            resolvedFromPath: selectedAutoDetectedRoster.resolvedFromPath,
            partyInfoResolvedRoster: gameStateResult.partyInfoNames,
            gameStatePartyInfo: gameStateResult.partyInfo,
            wsPartyResolvedRoster: wsPartyResult.names,
            wsPartyMessages: wsPartyResult.messages,
        });

        if (selectedAutoDetectedRoster.names.length < 2 || selectedAutoDetectedRoster.source === "request") {
            return null;
        }

        const extraPayload = {
            context: teamContext,
        };
        if (selectedAutoDetectedRoster.source !== "cache") {
            extraPayload.resolvedFromPath = selectedAutoDetectedRoster.resolvedFromPath;
        }

        return buildTeamProfilesResponse(
            requestIdPrefix,
            selectedAutoDetectedRoster.source,
            selectedAutoDetectedRoster.names,
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

                        requestCurrentMainSiteProfile(requestId, preferredLanguage)
                            .then((pageResponse) => {
                                writeMainSiteImportResponse(requestId, "shareable-profile", pageResponse, preferredLanguage);
                            });
                    });
                return true;
            }

            requestCurrentMainSiteProfile(requestId, preferredLanguage)
                .then((pageResponse) => {
                    writeMainSiteImportResponse(requestId, "shareable-profile", pageResponse, preferredLanguage);
                });

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

            window.postMessage({
                ...safeOptions,
                channel: APP_BRIDGE_CHANNEL,
                type: "mwi-tm-import",
                requestId,
                format: "shareable-profile",
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
                .filter((member) => member?.ok === true)
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
            const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload);
            if (!appResponse || appResponse.ok !== true) {
                throw new Error(appResponse?.message || getUiText("simulatorImportFailed", state.uiLanguage));
            }

            setStatusKey("importSuccess", "success");
        }

        async function importTeamMainSiteResponse(mainSiteResponse) {
            const payload = mainSiteResponse?.payload;
            const members = Array.isArray(payload?.members) ? payload.members : [];
            if (mainSiteResponse?.ok !== true || members.length === 0) {
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

            const successfulMembers = members.filter((member) => {
                return member
                    && typeof member === "object"
                    && member.ok === true
                    && member.payload
                    && typeof member.payload === "object";
            });

            if (successfulMembers.length === 0) {
                throw new Error(mainSiteResponse?.message || getUiText("noMainSiteData", state.uiLanguage));
            }

            setStatusKey("importingSimulator", "idle");

            let importedCount = 0;
            const maxImports = Math.min(5, successfulMembers.length);
            for (let index = 0; index < maxImports; index += 1) {
                const member = successfulMembers[index];
                const targetPlayerId = String(index + 1);
                const appRequestId = createRequestId();

                // eslint-disable-next-line no-await-in-loop
                const appResponse = await importPayloadIntoSimulator(appRequestId, member.payload, {
                    targetPlayerId,
                    resetTeamSelection: index === 0,
                    selectAfterImport: true,
                });

                if (!appResponse || appResponse.ok !== true) {
                    failureEntries.push({
                        name: String(member.characterName || "").trim() || `Player ${targetPlayerId}`,
                        message: String(appResponse?.message || "").trim() || getUiText("simulatorImportFailed", state.uiLanguage),
                    });
                    continue;
                }

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

    if (isMainSitePage()) {
        initMainSiteBridge();
        initMainSiteSimulatorShortcut();
    }

    if (isSimulatorPage()) {
        initSimulatorImportButton();
    }
})();
