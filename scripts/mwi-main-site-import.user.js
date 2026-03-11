// ==UserScript==
// @name         MWI Combat Simulator 主站一键导入
// @name:zh      MWI Combat Simulator 主站一键导入
// @name:zh-CN   MWI Combat Simulator 主站一键导入
// @namespace    https://azhu949.github.io/MWICombatSimulator
// @version      0.1.13
// @license      ISC
// @description  Import the current Milky Way Idle character into MWI Combat Simulator with one click.
// @description:zh      一键将 Milky Way Idle 主站当前角色导入到 MWI Combat Simulator。
// @description:zh-CN   一键将 Milky Way Idle 主站当前角色导入到 MWI Combat Simulator。
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://azhu949.github.io/MWICombatSimulator/*
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
    const MAIN_SITE_SHORTCUT_ID = "mwi-tm-main-site-simulator-link";
    const SIMULATOR_APP_URL = "https://azhu949.github.io/MWICombatSimulator/";
    const REQUEST_TIMEOUT_MS = 12000;
    const PAGE_REQUEST_TIMEOUT_MS = 10000;
    const APP_IMPORT_TIMEOUT_MS = 8000;
    const STORAGE_POLL_INTERVAL_MS = 250;
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
            const leftPartyId = Number(left?.partyID || 0);
            const rightPartyId = Number(right?.partyID || 0);
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

        mainSiteState.currentCombatAction = {
            actionHrid: String(currentAction.actionHrid || "").trim(),
            difficultyTier: normalizeDifficultyTier(currentAction.difficultyTier),
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

    function openSimulatorPage() {
        window.open(SIMULATOR_APP_URL, "_blank", "noopener,noreferrer");
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
            shortcut.href = SIMULATOR_APP_URL;
            shortcut.target = "_blank";
            shortcut.rel = "noopener noreferrer";
        } else {
            shortcut.setAttribute("role", "link");
            shortcut.tabIndex = 0;
            shortcut.style.cursor = "pointer";
            shortcut.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                openSimulatorPage();
            });
            shortcut.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                openSimulatorPage();
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
        const characterId = String(
            message.profile?.sharableCharacter?.id
            || message.profile?.sharableCharacter?.characterID
            || message.profile?.sharableCharacter?.characterId
            || ""
        ).trim();

        for (const [requestId, pendingRequest] of Array.from(mainSiteState.pendingRequests.entries())) {
            if (pendingRequest.characterName && characterName && pendingRequest.characterName !== characterName) {
                continue;
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

    function requestCurrentMainSiteProfile(requestId, preferredLanguage = "") {
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

            const characterName = String(mainSiteState.currentCharacterName || "").trim();
            if (!characterName) {
                resolve({
                    requestId: normalizedRequestId,
                    ok: false,
                    message: getUiText("currentCharacterNotInitialized", preferredLanguage),
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
                    message: getUiText("profileSharedTimeout", preferredLanguage),
                });
            }, PAGE_REQUEST_TIMEOUT_MS);

            mainSiteState.pendingRequests.set(normalizedRequestId, {
                characterName,
                requestStartedAt: Date.now(),
                modalSnapshot: createSharableProfileModalSnapshot(),
                timeoutId,
                resolve,
            });

            socket.send(JSON.stringify({
                type: "view_profile",
                viewProfileData: {
                    characterName,
                },
            }));
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

            requestCurrentMainSiteProfile(requestId, preferredLanguage)
                .then((pageResponse) => {
                    const payload = pageResponse?.payload;
                    GM_setValue(RESPONSE_KEY, {
                        version: 1,
                        requestId,
                        source: "milkywayidle",
                        format: "shareable-profile",
                        ok: pageResponse?.ok === true,
                        message: pageResponse?.ok === true ? "" : normalizeErrorMessage(pageResponse?.message, getUiText("unableToReadCurrentProfile", preferredLanguage)),
                        characterId: String(pageResponse?.characterId || ""),
                        characterName: String(pageResponse?.characterName || ""),
                        exportedAt: Date.now(),
                        payload: payload && typeof payload === "object" ? payload : null,
                    });
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

        async function requestMainSiteProfile(requestId) {
            GM_setValue(REQUEST_KEY, {
                version: 1,
                requestId,
                createdAt: Date.now(),
                target: "active-player",
                language: state.uiLanguage,
            });

            return waitForSharedValue(RESPONSE_KEY, requestId, REQUEST_TIMEOUT_MS);
        }

        async function importPayloadIntoSimulator(requestId, payload) {
            const responsePromise = waitForWindowMessage(APP_BRIDGE_CHANNEL, "mwi-tm-import-result", requestId, APP_IMPORT_TIMEOUT_MS);

            window.postMessage({
                channel: APP_BRIDGE_CHANNEL,
                type: "mwi-tm-import",
                requestId,
                format: "shareable-profile",
                payload,
            }, window.location.origin);

            return responsePromise;
        }

        async function handleImportButtonClick() {
            if (state.isRequestPending) {
                return;
            }

            const requestId = createRequestId();
            state.isRequestPending = true;
            setStatusKey("waitingMainSite", "idle");

            try {
                const mainSiteResponse = await requestMainSiteProfile(requestId);
                if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
                    throw new Error(mainSiteResponse?.message || getUiText("noMainSiteData", state.uiLanguage));
                }

                setStatusKey("importingSimulator", "idle");
                const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload);
                if (!appResponse || appResponse.ok !== true) {
                    throw new Error(appResponse?.message || getUiText("simulatorImportFailed", state.uiLanguage));
                }

                setStatusKey("importSuccess", "success");
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
