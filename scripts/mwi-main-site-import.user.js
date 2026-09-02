// ==UserScript==
// @name         MWI Combat Simulator 主站一键导入
// @name:zh      MWI Combat Simulator 主站一键导入
// @name:zh-CN   MWI Combat Simulator 主站一键导入
// @namespace    https://azhu949.github.io/MWICombatSimulator
// @version      0.1.47
// @license      ISC
// @description  Import the current Milky Way Idle character or cached team into the combat simulator, enhancement simulator, or skilling planner.
// @description:zh      将 Milky Way Idle 主站当前角色或缓存队伍导入战斗模拟器、强化模拟器或生活技能规划器。
// @description:zh-CN   将 Milky Way Idle 主站当前角色或缓存队伍导入战斗模拟器、强化模拟器或生活技能规划器。
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
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
  'use strict';

  const REQUEST_KEY = 'mwi.tm.import.request.v1';
  const RESPONSE_KEY = 'mwi.tm.import.response.v1';
  const APP_BRIDGE_CHANNEL = 'mwi-tm-bridge';
  const BUTTON_ID = 'mwi-tm-import-button';
  const CONTROL_ID = 'mwi-tm-import-control';
  const STATUS_ID = 'mwi-tm-import-status';
  const TEAM_ROSTER_CACHE_KEY = 'mwi.tm.import.teamRosterCache.v1';
  const PROFILE_CACHE_KEY = 'mwi.tm.import.profileCache.v1';
  const DEBUG_STORAGE_KEY = 'mwi.tm.import.debug';
  const DEBUG_QUERY_PARAM = 'mwiImportDebug';
  const MAIN_SITE_SHORTCUT_ID = 'mwi-tm-main-site-simulator-link';
  const PROFILE_COPY_BUTTON_ID = 'mwi-tm-profile-copy-button';
  const SIMULATOR_GITHUB_PAGES_URL = 'https://azhu949.github.io/MWICombatSimulator/';
  const SIMULATOR_CLOUDFLARE_URL = 'https://mwi-combatsi-mulator.pages.dev/';
  const SIMULATOR_FALLBACK_URL = SIMULATOR_GITHUB_PAGES_URL;
  const SIMULATOR_MIRROR_MODAL_ID = 'mwi-tm-simulator-mirror-modal';
  const REQUEST_TIMEOUT_MS = 12000;
  const APP_IMPORT_TIMEOUT_MS = 8000;
  const STORAGE_POLL_INTERVAL_MS = 250;
  const TEAM_ROSTER_CACHE_BUCKET_LIMIT = 24;
  const RECENT_PARTY_MESSAGE_LIMIT = 20;
  // 合成行情（零操作兜底）：主站公开端点 game_data/marketplace.json 提供全物品
  // per-level 行情（{a: ask, b: bid}），MWITools 以相同周期（生产 6 小时）主动拉取。
  // 官方估算（WS market_item_values_updated 为全量快照，另有 localStorage 键主通道）
  // 只在主站侧可得，模拟器页自身无行情来源，
  // 因此用该端点合成中价估值作兜底，与官方估算合并透传（真实值优先）。
  const SYNTHETIC_MARKET_REFRESH_MS = 6 * 60 * 60 * 1000;
  // 合成行情拉取超时（N5，2026-08-31）：无超时则挂起的 fetch 会永久占住 inFlight
  // 守卫，使 N2 的「下次导入请求退避重试」入口形同虚设。
  const SYNTHETIC_MARKET_FETCH_TIMEOUT_MS = 15000;
  // 官方估算的另一来源：主站自己把全量官方估算写入 localStorage 键 "marketItemValues"
  //（MWITools 的 loadMarketItemValuesFromStorage 即读此键，可能是 LZString 压缩串）。
  // 该键由主站登录/连接时写入，读取它即可在 WS 推送到达前就获得全量官方估算。
  const MARKET_ITEM_VALUES_STORAGE_KEY = 'marketItemValues';
  // 否则，WebSocket 队伍名单在发生不会更新当前战斗动作的静默离队/解散后，
  // 仍可能继续自我授权。
  const RECENT_PARTY_MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
  const PROFILE_CACHE_LIMIT = 50;
  const TEAM_IMPORT_PLAYER_IDS = ['1', '2', '3', '4', '5'];
  const UI_TEXT = {
    en: {
      button: 'Import from Main Site',
      enhancementButton: 'Import Character Setup',
      skillingButton: 'Import Skilling Snapshot',
      waitingMainSite: 'Waiting for main-site response…',
      importingSimulator: 'Importing into simulator…',
      importSuccess: 'Import successful.',
      importFailed: 'Import failed.',
      noMainSiteData:
        'No importable data was received from the main-site tab. Please make sure a logged-in main-site tab is open.',
      simulatorImportFailed: 'The simulator page could not finish the import.',
      pageBridgeTimeout: 'Timed out waiting for page bridge response.',
      mainSiteTabTimeout: 'Timed out waiting for the main-site tab response.',
      currentCharacterNotInitialized: 'Current character not initialized. Refresh the main-site tab once.',
      unableToReadCurrentProfile: 'Unable to read the current profile.',
      openProfileInGameFirst: 'Open profile in game first.',
      mainSiteShortcut: 'Combat Simulator',
      mainSiteShortcutTitle: 'Open MWI Combat Simulator',
      mirrorModalTitle: 'Open Combat Simulator',
      mirrorModalDescription: 'Choose which address you want to open.',
      mirrorModalGithub: 'GitHub Pages',
      mirrorModalCloudflare: 'Global (Cloudflare)',
      mirrorModalCancel: 'Cancel',
      mainSiteNews: 'News',
      copyProfileButton: 'Copy Character Data',
      copyProfileButtonTitle: 'Copy this character data as JSON for the combat simulator',
      copyProfileSuccess: 'Character data copied.',
      copyProfileFailed: 'Copy failed.',
      marketValuesStatusReady: 'Official estimates transferred: {count} items.',
      marketValuesStatusSynthetic:
        'Synthetic mid-price estimates forwarded: {count} items (not official; ~4-5% deviation vs MWITools).',
      marketValuesStatusMixed:
        'Official estimates forwarded: {officialCount} items + synthetic mid-price estimates: {syntheticCount} items (synthetic part not official; ~4-5% deviation vs MWITools).',
      marketValuesStatusEmpty: 'Official estimates: 0 items (asset score falls back to order-book prices).',
    },
    zh: {
      button: '从主站导入',
      enhancementButton: '导入角色强化配置',
      skillingButton: '导入生活技能快照',
      waitingMainSite: '等待主站响应…',
      importingSimulator: '正在导入到模拟器…',
      importSuccess: '导入成功。',
      importFailed: '导入失败。',
      noMainSiteData: '未从主站收到可导入的数据。请确认主站标签页已打开并已登录。',
      simulatorImportFailed: '模拟器页面未能完成导入。',
      pageBridgeTimeout: '等待页面桥接响应超时。',
      mainSiteTabTimeout: '等待主站标签页响应超时。',
      currentCharacterNotInitialized: '当前角色尚未初始化，请刷新一次主站标签页。',
      unableToReadCurrentProfile: '无法读取当前角色资料。',
      openProfileInGameFirst: '需要先在游戏中手动打开资料。',
      mainSiteShortcut: '战斗模拟器',
      mainSiteShortcutTitle: '打开 MWI Combat Simulator',
      mirrorModalTitle: '打开战斗模拟器',
      mirrorModalDescription: '请选择要跳转的地址。',
      mirrorModalGithub: 'GitHub Pages',
      mirrorModalCloudflare: '全球地址（Cloudflare）',
      mirrorModalCancel: '取消',
      mainSiteNews: '新闻',
      copyProfileButton: '复制角色数据',
      copyProfileButtonTitle: '复制该角色数据（JSON）用于战斗模拟器',
      copyProfileSuccess: '角色数据已复制。',
      copyProfileFailed: '复制失败。',
      marketValuesStatusReady: '官方估值已透传：{count} 个物品。',
      marketValuesStatusSynthetic: '合成中价估值已透传：{count} 个物品（非官方估算，与 MWITools 口径或有 4-5% 偏差）。',
      marketValuesStatusMixed:
        '官方估值已透传：{officialCount} 个物品 + 合成中价估值：{syntheticCount} 个物品（合成部分非官方估算，与 MWITools 口径或有 4-5% 偏差）。',
      marketValuesStatusEmpty: '官方估值：0 个物品（资产分将使用挂单价）。',
    },
  };
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const mainSiteState = {
    isInstalled: false,
    sockets: new Set(),
    currentCharacterName: '',
    characterActions: [],
    recentPartyMessages: [],
    latestSharedProfile: null,
    profileCopyButton: null,
    // findOpenProfileDialog 全量扫描的冷却截止时间戳（见 initMainSiteProfileCopyButton）。
    profileDialogScanCooldownUntil: 0,
    currentCombatAction: null,
    actionTypeFoodSlotsMap: {},
    actionTypeDrinkSlotsMap: {},
    consumableCombatTriggersMap: {},
    abilityCombatTriggersMap: {},
    currentCharacterSnapshot: null,
    // 官方估算市场价值快照（WS market_item_values_updated / 订单簿增量合并），
    // 形如 { [itemHrid]: { [强化等级字符串]: 价值 } }，随导入载荷透传给模拟器。
    marketItemValues: {},
    // 合成行情缓存（来自公开端点 marketplace.json 的中价估值），与 WS 真实官方估算
    // 分开保存：真实值在合并时优先覆盖，合成值只补缺。仅内存，刷新后重新拉取。
    syntheticMarketItemValues: {},
    syntheticMarketFetchedAt: 0,
    syntheticMarketFetchInFlight: false,
    currentCharacterFoodSlotsReady: false,
    currentCharacterDrinkSlotsReady: false,
    currentCharacterConsumableTriggersReady: false,
    currentCharacterAbilityTriggersReady: false,
  };
  const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';
  const CURRENT_CHARACTER_SNAPSHOT_KEYS = [
    'character',
    'characterSkills',
    'characterItems',
    'combatUnit',
    'characterHouseRoomMap',
    'characterAchievements',
    'characterGuildBuffMap',
    'guildBuildingLevelMap',
    'communityBuffs',
    'houseActionTypeBuffsMap',
    'communityActionTypeBuffsMap',
    'achievementActionTypeBuffsMap',
    'personalActionTypeBuffsMap',
    'mooPassActionTypeBuffsMap',
    'actionTypeFoodSlotsMap',
    'actionTypeDrinkSlotsMap',
    'consumableCombatTriggersMap',
    'abilityCombatTriggersMap',
  ];
  const REQUIRED_CURRENT_CHARACTER_SNAPSHOT_KEYS = ['character', 'characterSkills', 'characterItems', 'combatUnit'];

  function isCombatActionHrid(actionHrid) {
    return String(actionHrid || '').startsWith('/actions/combat/');
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
    const currentAction =
      mainSiteState.characterActions.find((action) => isCombatActionHrid(action?.actionHrid)) || null;
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
      actionHrid: String(currentAction.actionHrid || '').trim(),
      difficultyTier: normalizeDifficultyTier(currentAction.difficultyTier),
      partyId: nextPartyId,
    };

    if (previousPartyId !== 0 && nextPartyId === 0) {
      clearStaleTeamRosterState(mainSiteState.currentCharacterName);
    }
  }

  function replaceTrackedCharacterActions(nextActions) {
    mainSiteState.characterActions = sortTrackedCharacterActions(
      Array.isArray(nextActions) ? nextActions.filter((action) => action && typeof action === 'object') : [],
    );
    refreshCurrentCombatAction();
  }

  function mergeTrackedCharacterActions(endCharacterActions) {
    if (!Array.isArray(endCharacterActions) || endCharacterActions.length === 0) {
      return;
    }

    const nextActions = [...mainSiteState.characterActions];
    for (const action of endCharacterActions) {
      if (!action || typeof action !== 'object') {
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

  // 仅用于克隆「纯 JSON 对象」（来自 socket 消息或 JSON 载荷）。JSON 往返会丢失
  // undefined / 函数，并对 BigInt、循环引用抛错——不要复用于其它非 JSON 结构。
  function clonePlainObject(value) {
    if (!value || typeof value !== 'object') {
      return {};
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      // 防御：若未来载荷含 BigInt / 循环引用导致 JSON 往返抛错，降级为深拷贝
      // （structuredClone 优先，递归兜底），避免浅拷贝与原始载荷共享嵌套引用。
      if (typeof structuredClone === 'function') {
        try {
          return structuredClone(value);
        } catch (_error) {
          // structuredClone 失败（如含函数）时继续走递归兜底。
        }
      }
      return deepClonePlainObject(value);
    }
  }

  function deepClonePlainObject(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (seen.has(value)) {
      // 循环引用防御性妥协：返回原始引用，克隆结果与原始共享该嵌套对象。
      // 主站载荷经 JSON 序列化，正常不会出现循环引用；此分支仅防止极端输入
      // 导致无限递归。若未来需要完全独立的克隆，可改为抛错或返回占位值。
      return value;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => deepClonePlainObject(item, seen));
    }
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = deepClonePlainObject(value[key], seen);
    }
    return result;
  }

  function hasOwnKey(source, key) {
    return Boolean(source) && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key);
  }

  function normalizeComparableText(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function normalizeCharacterName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
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

    if (normalized.startsWith('/')) {
      return false;
    }

    // 纯数字是合法角色名（如「123456」），不得当作数字 ID / 计数噪声过滤掉，
    // 否则这类角色会在队伍名单解析（readCharacterNameCandidate）中被静默剔除，
    // 导致一键导入（含团队导入）失败或降级。仅拒绝明显非名字的结构化文本。
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
    return isLikelyCharacterName(value) ? normalizeCharacterName(value) : '';
  }

  function readCharacterNameCandidate(source) {
    if (!source || typeof source !== 'object') {
      return '';
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

    return '';
  }

  function buildTeamRosterContext() {
    return {
      currentCharacterName: normalizeCharacterName(mainSiteState.currentCharacterName),
      partyId: Number(mainSiteState.currentCombatAction?.partyId || 0),
      actionHrid: String(mainSiteState.currentCombatAction?.actionHrid || '').trim(),
      difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction?.difficultyTier),
    };
  }

  function buildTeamRosterExactCacheKey(context) {
    const currentCharacterName = normalizeComparableText(context?.currentCharacterName);
    const actionHrid = String(context?.actionHrid || '').trim();
    const difficultyTier = normalizeDifficultyTier(context?.difficultyTier);
    const partyId = Number(context?.partyId || 0);
    if (!currentCharacterName || !actionHrid) {
      return '';
    }

    return `${currentCharacterName}|${partyId}|${actionHrid}|${difficultyTier}`;
  }

  function buildTeamRosterLooseCacheKey(context) {
    const currentCharacterName = normalizeComparableText(context?.currentCharacterName);
    const actionHrid = String(context?.actionHrid || '').trim();
    const difficultyTier = normalizeDifficultyTier(context?.difficultyTier);
    if (!currentCharacterName || !actionHrid) {
      return '';
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
    const exactSource = rawValue?.exact && typeof rawValue.exact === 'object' ? rawValue.exact : {};
    const looseSource = rawValue?.loose && typeof rawValue.loose === 'object' ? rawValue.loose : {};
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

  function hasStructuredPartyInfoFieldHints(rawValue) {
    return (
      typeof rawValue === 'string' && rawValue.includes('"partySlotMap"') && rawValue.includes('"sharableCharacterMap"')
    );
  }

  function getFreshRecentPartyMessages(now = Date.now()) {
    const currentTime = Number(now);
    const messages = Array.isArray(mainSiteState.recentPartyMessages) ? mainSiteState.recentPartyMessages : [];
    const freshMessages = messages.filter((message) => {
      const receivedAt = Number(message?.receivedAt || 0);
      if (!Number.isFinite(currentTime) || !Number.isFinite(receivedAt) || receivedAt <= 0) {
        return false;
      }

      const age = currentTime - receivedAt;
      return age >= 0 && age <= RECENT_PARTY_MESSAGE_MAX_AGE_MS;
    });

    if (freshMessages.length !== messages.length) {
      mainSiteState.recentPartyMessages = freshMessages;
    }

    return freshMessages;
  }

  function clearTeamRosterCacheForCharacter(characterName) {
    const comparableCharacterName = normalizeComparableText(characterName);
    if (!comparableCharacterName) {
      return false;
    }

    const store = loadTeamRosterCacheStore();
    let changed = false;
    const cacheKeyPrefix = `${comparableCharacterName}|`;

    for (const bucket of ['exact', 'loose']) {
      for (const key of Object.keys(store[bucket] || {})) {
        if (!String(key || '').startsWith(cacheKeyPrefix)) {
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
    if (!partyInfo || typeof partyInfo !== 'object' || Array.isArray(partyInfo)) {
      return 0;
    }

    return readCollectionEntries(partyInfo?.partySlotMap).filter((entry) => entry && typeof entry === 'object').length;
  }

  function collectStructuredPartyInfoSources(source, path, depth, results, visited) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 3) {
      return;
    }

    if (visited.has(source)) {
      return;
    }

    visited.add(source);

    // 队伍数据载荷按结构而非键名识别，因为主站并不总是将它们嵌套在
    // 字面量 `partyInfo` 键名下。
    const hasPartySlotMap =
      source?.partySlotMap && typeof source.partySlotMap === 'object' && !Array.isArray(source.partySlotMap);
    const hasSharableCharacterMap =
      source?.sharableCharacterMap &&
      typeof source.sharableCharacterMap === 'object' &&
      !Array.isArray(source.sharableCharacterMap);
    if (hasPartySlotMap && hasSharableCharacterMap) {
      results.push({
        path: path || 'message',
        value: source,
      });
    }

    if (depth >= 3) {
      return;
    }

    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }

      const nextPath = path ? `${path}.${key}` : key;
      collectStructuredPartyInfoSources(value, nextPath, depth + 1, results, visited);
    });
  }

  function getStructuredPartyInfoSources(source, path = '') {
    const results = [];
    collectStructuredPartyInfoSources(source, path, 0, results, new WeakSet());
    return Array.from(new Map(results.map((entry) => [entry.path, entry])).values());
  }

  function rememberRecentPartyMessage(message, receivedAt = Date.now()) {
    const structuredSources = getStructuredPartyInfoSources(message);
    if (structuredSources.length === 0) {
      return;
    }

    const snapshots = structuredSources
      .map((entry) => clonePlainObject(entry.value))
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((partyInfo) => ({
        partyInfo,
        receivedAt,
      }));
    if (snapshots.length === 0) {
      return;
    }

    // 空/单人队伍快照是明确的 \"left the party\" 信号，因此会丢弃过期的名单状态。
    // 快照本身不会被保留：成员不足 2 人的名单在下游永远无法产生候选。
    const hasActiveRoster = snapshots.some((snapshot) => countPartyInfoMembers(snapshot.partyInfo) >= 2);
    if (!hasActiveRoster) {
      clearStaleTeamRosterState(mainSiteState.currentCharacterName);
      return;
    }

    mainSiteState.recentPartyMessages = [...snapshots, ...getFreshRecentPartyMessages(receivedAt)].slice(
      0,
      RECENT_PARTY_MESSAGE_LIMIT,
    );
  }

  function getMainSiteGameState() {
    const candidates = [pageWindow?.mwi, pageWindow?.MWI, pageWindow?.Mwi];

    for (const candidate of candidates) {
      const state = candidate?.game?.state;
      if (state && typeof state === 'object') {
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

    if (source && typeof source === 'object' && !Array.isArray(source)) {
      return Object.values(source);
    }

    return [];
  }

  function readCollectionValue(source, key) {
    if (!source || typeof source !== 'object') {
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
      comparableCurrentCharacterName: normalizeComparableText(
        gameState?.character?.name || mainSiteState.currentCharacterName,
      ),
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

      const leftOrderIndex = Number.isFinite(Number(left?.orderIndex))
        ? Number(left.orderIndex)
        : Number.MAX_SAFE_INTEGER;
      const rightOrderIndex = Number.isFinite(Number(right?.orderIndex))
        ? Number(right.orderIndex)
        : Number.MAX_SAFE_INTEGER;
      if (leftOrderIndex !== rightOrderIndex) {
        return leftOrderIndex - rightOrderIndex;
      }

      return String(left?.name || '').localeCompare(String(right?.name || ''));
    });
  }

  function buildStructuredRosterCandidate(path, members) {
    const normalizedMembers = Array.isArray(members)
      ? members.filter((entry) => entry && typeof entry === 'object')
      : [];
    const orderedMembers = sortResolvedTeamMembers(normalizedMembers);
    const includesCurrentCharacter = orderedMembers.some((entry) => {
      return entry.isCurrent === true && normalizeCharacterName(entry?.name || '').length > 0;
    });
    if (!includesCurrentCharacter) {
      return null;
    }

    const normalizedEntries = orderedMembers
      .map((entry) => {
        const name = normalizeCharacterName(entry?.name || '');
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
      5,
    );
    if (names.length < 2) {
      return null;
    }

    return {
      path,
      names,
      members: normalizedEntries
        .filter((entry) =>
          names.some((name) => normalizeComparableText(name) === normalizeComparableText(entry.characterName)),
        )
        .slice(0, 5),
    };
  }

  function resolvePartyInfoRosterCandidate(partyInfo, path, currentCharacterLookup) {
    if (!partyInfo || typeof partyInfo !== 'object' || Array.isArray(partyInfo)) {
      return null;
    }

    const partySlotEntries = readCollectionEntries(partyInfo?.partySlotMap).filter(
      (entry) => entry && typeof entry === 'object',
    );
    if (partySlotEntries.length < 2) {
      return null;
    }

    const sharableCharacterMap = partyInfo?.sharableCharacterMap;
    if (!sharableCharacterMap || typeof sharableCharacterMap !== 'object') {
      return null;
    }

    const currentCharacterId = Number(currentCharacterLookup?.currentCharacterId || 0);
    const currentCharacterName = normalizeCharacterName(currentCharacterLookup?.currentCharacterName || '');
    const comparableCurrentCharacterName = normalizeComparableText(
      currentCharacterLookup?.comparableCurrentCharacterName || currentCharacterName,
    );

    const members = partySlotEntries.map((partySlot, index) => {
      const rawCharacterId = Number(partySlot?.characterID ?? partySlot?.characterId ?? 0);
      const characterId = Number.isFinite(rawCharacterId) ? rawCharacterId : 0;
      const sharedCharacter = characterId !== 0 ? readCollectionValue(sharableCharacterMap, characterId) : null;
      const nameFromSharedCharacter = readCharacterNameCandidate(sharedCharacter);
      const comparableName = normalizeComparableText(nameFromSharedCharacter);
      const isCurrentById = currentCharacterId !== 0 && characterId === currentCharacterId;
      const isCurrentByName = comparableCurrentCharacterName
        ? comparableName === comparableCurrentCharacterName
        : false;
      const rawSlotId = Number(partySlot?.id || 0);

      return {
        name: nameFromSharedCharacter || (isCurrentById || isCurrentByName ? currentCharacterName : ''),
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

  function getGameStatePartyInfoSources(gameState) {
    const directPartyInfo = gameState?.partyInfo ?? null;
    const sources = [
      ...(directPartyInfo ? [{ path: 'mwi.game.state.partyInfo', value: directPartyInfo }] : []),
      ...getStructuredPartyInfoSources(gameState, 'mwi.game.state'),
    ];
    const seenPaths = new Set();

    return sources.filter((entry) => {
      const path = String(entry?.path || '');
      if (!path || seenPaths.has(path)) {
        return false;
      }

      seenPaths.add(path);
      return true;
    });
  }

  function resolveTeamMemberNamesFromGameState() {
    const gameState = getMainSiteGameState();
    const currentCharacterLookup = buildCurrentCharacterLookup(gameState);
    const directPartyInfo = gameState?.partyInfo ?? null;
    const partyInfoSources = getGameStatePartyInfoSources(gameState);

    let partyInfoCandidate = null;
    let resolvedPartyInfo = directPartyInfo;
    for (const entry of partyInfoSources) {
      const candidate = resolvePartyInfoRosterCandidate(entry.value, entry.path, currentCharacterLookup);
      if (candidate) {
        partyInfoCandidate = candidate;
        resolvedPartyInfo = entry.value;
        break;
      }

      if (countPartyInfoMembers(entry.value) > countPartyInfoMembers(resolvedPartyInfo)) {
        resolvedPartyInfo = entry.value;
      }
    }

    const partyInfoMemberCount = partyInfoSources.reduce((maxCount, entry) => {
      return Math.max(maxCount, countPartyInfoMembers(entry.value));
    }, 0);

    return {
      partyInfoNames: partyInfoCandidate?.names ?? [],
      partyInfoMembers: partyInfoCandidate?.members ?? [],
      partyInfo: resolvedPartyInfo,
      partyInfoMemberCount,
      partyInfoResolvedFromPath: partyInfoCandidate?.path || '',
    };
  }

  function resolveTeamMemberNamesFromRecentPartyMessages(now = Date.now()) {
    const messages = getFreshRecentPartyMessages(now);
    const currentCharacterLookup = buildCurrentCharacterLookup(getMainSiteGameState());

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const candidate = resolvePartyInfoRosterCandidate(
        messages[messageIndex]?.partyInfo,
        `wsPartyMessages[${messageIndex}].partyInfo`,
        currentCharacterLookup,
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
      resolvedFromPath: '',
    };
  }

  function selectAutoDetectedTeamRoster({ gameStateResult, wsPartyResult, cacheMatch, allowFallbackSources = false }) {
    const candidates = [
      {
        source: 'game-state:partyInfo',
        names: gameStateResult?.partyInfoNames ?? [],
        members: gameStateResult?.partyInfoMembers ?? [],
        resolvedFromPath: gameStateResult?.partyInfoResolvedFromPath || '',
      },
    ];

    if (allowFallbackSources) {
      candidates.push(
        {
          source: 'ws-party',
          names: wsPartyResult?.names ?? [],
          members: wsPartyResult?.members ?? [],
          resolvedFromPath: wsPartyResult?.resolvedFromPath || '',
        },
        {
          source: 'cache',
          names: cacheMatch?.exactCharacterNames ?? [],
          members: [],
          resolvedFromPath: '',
        },
      );
    }

    for (const candidate of candidates) {
      if (Array.isArray(candidate.names) && candidate.names.length >= 2) {
        return candidate;
      }
    }

    return {
      source: 'request',
      names: [],
      members: [],
      resolvedFromPath: '',
    };
  }

  function debugTeamRosterAutoDetection(details) {
    try {
      console.debug('[MWI TM] Team roster auto-detect', details);
    } catch (_error) {}
  }

  function isDomElement(value) {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      Number(value.nodeType) === 1 &&
      typeof value.querySelector === 'function'
    );
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
    const type = String(message?.type || '');

    if (reset || type === 'guild_buffs_updated') {
      nextFields.characterGuildBuffMap = hasOwnKey(message, 'characterGuildBuffMap')
        ? clonePlainObject(message.characterGuildBuffMap)
        : {};
    }
    if (reset || type === 'guild_updated') {
      nextFields.guildBuildingLevelMap = hasOwnKey(message, 'guildBuildingLevelMap')
        ? clonePlainObject(message.guildBuildingLevelMap)
        : {};
    }

    const nextKeys = Object.keys(nextFields);
    if (nextKeys.length === 0) {
      return;
    }

    const baseSnapshot =
      reset || !mainSiteState.currentCharacterSnapshot ? {} : clonePlainObject(mainSiteState.currentCharacterSnapshot);

    for (const key of nextKeys) {
      baseSnapshot[key] = nextFields[key];
    }

    mainSiteState.currentCharacterSnapshot = baseSnapshot;
  }

  function readSnapshotEntryIdentity(entry, identityKeys, fallbackIndex = -1) {
    if (!entry || typeof entry !== 'object') {
      return fallbackIndex >= 0 ? `index:${fallbackIndex}` : '';
    }

    for (const key of identityKeys) {
      const value = entry[key];
      if (value == null || String(value).trim() === '') {
        continue;
      }

      return `${key}:${String(value)}`;
    }

    return fallbackIndex >= 0 ? `index:${fallbackIndex}` : '';
  }

  function mergeCurrentCharacterSnapshotEntries(field, updates, identityKeys, removeWhen = null) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return;
    }

    const snapshot = mainSiteState.currentCharacterSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const existingEntries = Array.isArray(snapshot[field])
      ? snapshot[field].map((entry) => clonePlainObject(entry))
      : snapshot[field] && typeof snapshot[field] === 'object'
        ? Object.values(snapshot[field]).map((entry) => clonePlainObject(entry))
        : [];

    for (const rawUpdate of updates) {
      if (!rawUpdate || typeof rawUpdate !== 'object') {
        continue;
      }

      const update = clonePlainObject(rawUpdate);
      const identity = readSnapshotEntryIdentity(update, identityKeys);
      const index = identity
        ? existingEntries.findIndex(
            (entry, entryIndex) => readSnapshotEntryIdentity(entry, identityKeys, entryIndex) === identity,
          )
        : -1;

      if (removeWhen && removeWhen(update)) {
        if (index >= 0) {
          existingEntries.splice(index, 1);
        }
        continue;
      }

      if (index >= 0) {
        existingEntries[index] = update;
      } else {
        existingEntries.push(update);
      }
    }

    snapshot[field] = existingEntries;
  }

  function captureCurrentCharacterDataUpdate(message) {
    const type = String(message?.type || '');
    if (!mainSiteState.currentCharacterSnapshot || typeof mainSiteState.currentCharacterSnapshot !== 'object') {
      return;
    }

    if (type === 'skills_updated') {
      mergeCurrentCharacterSnapshotEntries('characterSkills', message.endCharacterSkills, ['skillHrid']);
      return;
    }

    if (type === 'items_updated') {
      mergeCurrentCharacterSnapshotEntries(
        'characterItems',
        message.endCharacterItems,
        ['hash', 'id'],
        (entry) => Number(entry.count) === 0,
      );
      return;
    }

    if (type === 'house_rooms_updated') {
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (type === 'achievements_updated') {
      mergeCurrentCharacterSnapshotEntries('characterAchievements', message.achievements, ['achievementHrid']);
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (
      type === 'achievement_buffs_updated' ||
      type === 'community_buffs_updated' ||
      type === 'personal_buffs_updated' ||
      type === 'moo_pass_buffs_updated' ||
      type === 'guild_buffs_updated' ||
      type === 'guild_updated'
    ) {
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (CURRENT_CHARACTER_SNAPSHOT_KEYS.some((key) => hasOwnKey(message, key))) {
      updateCurrentCharacterSnapshot(message);
    }
  }

  function syncCurrentCharacterConsumableSlotMaps(message, reset = false) {
    const hasFoodMap = hasOwnKey(message, 'actionTypeFoodSlotsMap');
    const hasDrinkMap = hasOwnKey(message, 'actionTypeDrinkSlotsMap');
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
    const hasConsumableTriggerMap = hasOwnKey(message, 'consumableCombatTriggersMap');
    const hasAbilityTriggerMap = hasOwnKey(message, 'abilityCombatTriggersMap');
    if (!reset && !hasConsumableTriggerMap && !hasAbilityTriggerMap) {
      return;
    }

    if (reset) {
      mainSiteState.consumableCombatTriggersMap = clonePlainObject(
        hasConsumableTriggerMap ? message.consumableCombatTriggersMap : {},
      );
      mainSiteState.abilityCombatTriggersMap = clonePlainObject(
        hasAbilityTriggerMap ? message.abilityCombatTriggersMap : {},
      );
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
      characterId: String(source?.character?.id || '').trim(),
      characterName: normalizeCharacterName(source?.character?.name || ''),
    };
  }

  function hasSnapshotField(snapshot, key) {
    return Boolean(snapshot) && typeof snapshot === 'object' && Object.prototype.hasOwnProperty.call(snapshot, key);
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
      incomingIdentity.characterId &&
      existingIdentity.characterId &&
      incomingIdentity.characterId !== existingIdentity.characterId
    ) {
      return true;
    }

    if (
      incomingIdentity.characterName &&
      existingIdentity.characterName &&
      normalizeComparableText(incomingIdentity.characterName) !==
        normalizeComparableText(existingIdentity.characterName)
    ) {
      return true;
    }

    return false;
  }

  function resetCurrentCharacterTracking(previousCharacterName = '') {
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
      snapshot &&
      typeof snapshot === 'object' &&
      snapshot.character &&
      typeof snapshot.character === 'object' &&
      Array.isArray(snapshot.characterSkills) &&
      REQUIRED_CURRENT_CHARACTER_SNAPSHOT_KEYS.every((key) => hasSnapshotField(snapshot, key)),
    );
  }

  function hasCurrentCharacterConsumableSlots() {
    return (
      mainSiteState.currentCharacterFoodSlotsReady === true && mainSiteState.currentCharacterDrinkSlotsReady === true
    );
  }

  function hasCurrentCharacterConsumableTriggerSnapshot() {
    return mainSiteState.currentCharacterConsumableTriggersReady === true;
  }

  function hasCurrentCharacterAbilityTriggerSnapshot() {
    return mainSiteState.currentCharacterAbilityTriggersReady === true;
  }

  function hasCurrentCharacterCombatTriggerSnapshot() {
    return hasCurrentCharacterConsumableTriggerSnapshot() || hasCurrentCharacterAbilityTriggerSnapshot();
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
    const mergedMarketItemValues = getMergedMarketItemValues();
    if (Object.keys(mergedMarketItemValues).length > 0) {
      snapshot.marketItemValues = mergedMarketItemValues;
      // N5 来源标记：描述的是「本载荷所携数值」的来源，仅在载荷实际携带市场数据时
      // 挂载——空载荷无来源可言，无条件挂 'synthetic' 属冗余标记。
      snapshot.marketEstimateSource =
        Object.keys(mainSiteState.marketItemValues ?? {}).length > 0 ? 'official' : 'synthetic';
      // #18（2026-08-31）：官方缓存非空 ≠ 载荷全部官方——merged 以合成行情为基底、
      // 官方按物品覆盖，官方 1 件 + 合成 871 件的混合载荷会被整体标 'official'，
      // 逐件真实来源丢失。载荷级标记为 official 且存在合成独有物品时附
      // syntheticItemHrids 清单（app 侧按 hrid 精确标注）；纯 official / 纯 synthetic
      // 载荷清单为空不挂（零体积增量，旧载荷向后兼容）。
      // 【一般-5】（2026-09-02）：混合物品（官方仅覆盖部分等级）的等级级来源由
      // syntheticLevelKeys 清单表达（仅列官方缓存未覆盖、由合成补齐的等级键），
      // app 侧据此建立等级级来源覆盖；非空才挂（旧版模拟器忽略未知字段，向后兼容）。
      if (snapshot.marketEstimateSource === 'official') {
        const syntheticOnlyItemHrids = collectSyntheticOnlyItemHrids(mergedMarketItemValues);
        if (syntheticOnlyItemHrids.length > 0) {
          snapshot.syntheticItemHrids = syntheticOnlyItemHrids;
        }
        const syntheticLevelKeys = collectSyntheticLevelKeys(mergedMarketItemValues);
        if (Object.keys(syntheticLevelKeys).length > 0) {
          snapshot.syntheticLevelKeys = syntheticLevelKeys;
        }
      }
    }
    snapshot.mainSiteCombat = mainSiteState.currentCombatAction
      ? {
          actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ''),
          difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
        }
      : null;
    return snapshot;
  }

  function buildCachedProfilePayload(profile, includeCurrentCombat = true, includeMarket = true) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }

    const payload = {
      profile: clonePlainObject(profile),
    };

    if (includeMarket) {
      // N3（2026-08-31）：缓存条目传 includeMarket=false 剥离全量市场快照——
      // GM 存储 50 条缓存各自挂一份 merged 快照造成 ×50 冗余序列化；缓存条目的
      // marketItemValues 零消费方（读取点只取 .profile 并在响应时重建载荷）。
      // 响应侧（buildTeamMemberResponse 等）保持默认 true，透传行为不变。
      const mergedMarketItemValues = getMergedMarketItemValues();
      if (Object.keys(mergedMarketItemValues).length > 0) {
        payload.marketItemValues = mergedMarketItemValues;
        // N5 来源标记：同 buildCurrentCharacterPayload——仅在载荷实际携带市场数据时
        // 挂载，空载荷无来源可言。
        payload.marketEstimateSource =
          Object.keys(mainSiteState.marketItemValues ?? {}).length > 0 ? 'official' : 'synthetic';
        // #18（2026-08-31）：同 buildCurrentCharacterPayload——混合载荷附合成独有物品清单。
        // 【一般-5】（2026-09-02）：同上——混合物品的等级级来源清单（syntheticLevelKeys）。
        if (payload.marketEstimateSource === 'official') {
          const syntheticOnlyItemHrids = collectSyntheticOnlyItemHrids(mergedMarketItemValues);
          if (syntheticOnlyItemHrids.length > 0) {
            payload.syntheticItemHrids = syntheticOnlyItemHrids;
          }
          const syntheticLevelKeys = collectSyntheticLevelKeys(mergedMarketItemValues);
          if (Object.keys(syntheticLevelKeys).length > 0) {
            payload.syntheticLevelKeys = syntheticLevelKeys;
          }
        }
      }
    }

    if (includeCurrentCombat) {
      payload.mainSiteCombat = mainSiteState.currentCombatAction
        ? {
            actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ''),
            difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
          }
        : null;
    }

    return payload;
  }

  function sanitizeProfileCacheEntry(value) {
    const payload = value?.payload && typeof value.payload === 'object' ? value.payload : null;
    const profile =
      payload?.profile && typeof payload.profile === 'object'
        ? payload.profile
        : value?.profile && typeof value.profile === 'object'
          ? value.profile
          : null;
    if (!profile) {
      return null;
    }

    const characterId = String(value?.characterId || extractSharedProfileCharacterId(profile) || '').trim();
    const characterName = normalizeCharacterName(
      value?.characterName || profile?.sharableCharacter?.name || profile?.name || '',
    );
    if (!characterId && !characterName) {
      return null;
    }

    return {
      characterId,
      characterName,
      comparableCharacterName: normalizeComparableText(characterName),
      payload: buildCachedProfilePayload(profile, false, false),
      updatedAt: Number(value?.updatedAt || Date.now()),
    };
  }

  function loadProfileCacheEntries() {
    const rawValue = GM_getValue(PROFILE_CACHE_KEY, null);
    const rawEntries = Array.isArray(rawValue?.entries) ? rawValue.entries : Array.isArray(rawValue) ? rawValue : [];

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
      entries: nextEntries.slice(0, PROFILE_CACHE_LIMIT).map((candidate) => ({
        characterId: candidate.characterId,
        characterName: candidate.characterName,
        updatedAt: candidate.updatedAt,
        payload: candidate.payload,
      })),
    });

    return entry;
  }

  function findCachedProfileEntry(characterId, characterName) {
    const normalizedCharacterId = String(characterId || '').trim();
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
    const triggerTypeHrid = String(message?.combatTriggerTypeHrid || '').trim();
    const combatTriggers = Array.isArray(message?.combatTriggers) ? message.combatTriggers : [];
    if (triggerTypeHrid === '/combat_trigger_types/consumable') {
      const itemHrid = String(message?.itemHrid || '').trim();
      if (itemHrid) {
        mainSiteState.consumableCombatTriggersMap[itemHrid] = JSON.parse(JSON.stringify(combatTriggers));
        mainSiteState.currentCharacterConsumableTriggersReady = true;
      }
      return;
    }

    if (triggerTypeHrid === '/combat_trigger_types/ability') {
      const abilityHrid = String(message?.abilityHrid || '').trim();
      if (abilityHrid) {
        mainSiteState.abilityCombatTriggersMap[abilityHrid] = JSON.parse(JSON.stringify(combatTriggers));
        mainSiteState.currentCharacterAbilityTriggersReady = true;
      }
    }
  }

  const MAIN_SITE_HOSTNAMES = new Set([
    'www.milkywayidle.com',
    'milkywayidle.com',
    'www.milkywayidlecn.com',
    'milkywayidlecn.com',
  ]);

  function isMainSitePage() {
    return MAIN_SITE_HOSTNAMES.has(
      String(window.location.hostname || '')
        .trim()
        .toLowerCase(),
    );
  }

  function isSimulatorPage() {
    const origin = window.location.origin;
    return (
      origin === 'https://azhu949.github.io' ||
      origin === 'https://mwi-combatsi-mulator.pages.dev' ||
      origin === 'http://localhost:5173' ||
      origin === 'http://127.0.0.1:5173'
    );
  }

  function normalizeUiLanguage(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized.startsWith('zh')) {
      return 'zh';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }
    return '';
  }

  function resolveUiLanguage(preferredLanguage = '') {
    const explicitLanguage = normalizeUiLanguage(preferredLanguage);
    if (explicitLanguage) {
      return explicitLanguage;
    }

    try {
      const storedLanguage = normalizeUiLanguage(window.localStorage?.getItem('i18nextLng'));
      if (storedLanguage) {
        return storedLanguage;
      }
    } catch (_error) {}

    const documentLanguage = normalizeUiLanguage(document.documentElement?.lang);
    if (documentLanguage) {
      return documentLanguage;
    }

    // 项目默认语言为中文：非中/英环境（如 ja、fr 等）统一回退到 zh 而非 en。
    // 这是刻意行为（脚本 UI 以中文为主），与 index.html 的 lang="zh" 保持一致。
    return normalizeUiLanguage(navigator.language) || 'zh';
  }

  function getUiText(key, preferredLanguage = '') {
    const language = resolveUiLanguage(preferredLanguage);
    return UI_TEXT[language]?.[key] || UI_TEXT.en[key] || '';
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isVisibleElement(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    // 现代浏览器走原生 checkVisibility：一次调用遍历祖先链，覆盖 display:none、
    // visibility:hidden 以及自身或任一祖先 opacity 计算值为 0 的情况。
    // opacity 不继承：动画作用在包装层（如 MUI Fade 的过渡 div）时，纸面/弹窗自身
    // opacity 仍为 1，只看自身的 getComputedStyle 会漏检整条祖先链的 opacity: 0。
    // 有意不做阈值判定（如 < 0.5 视为不可见）：淡入动画中间值（0 → 1）期间弹窗/菜单
    // 会被误杀导致挂载漏检（G1 的冷却重试不覆盖此窗口）；淡出中间值（0.3）仍视为
    // 可见，代价仅是按钮可能挂进正在消亡的弹窗（随后随弹窗拆除，自愈且影响轻微）。
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }

    // 旧浏览器回退：保持与快速路径一致的语义。
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    for (let node = element; node; node = node.parentElement) {
      if (parseFloat(window.getComputedStyle(node).opacity) === 0) {
        return false;
      }
    }
    return true;
  }

  function getMainSiteNewsLabels() {
    return [UI_TEXT.en.mainSiteNews, UI_TEXT.zh.mainSiteNews].map((value) => normalizeText(value)).filter(Boolean);
  }

  function getElementSearchText(element) {
    if (!isDomElement(element)) {
      return '';
    }

    const values = [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')];

    return normalizeText(values.filter((value) => String(value || '').trim()).join(' '));
  }

  function getElementSemanticText(element) {
    if (!isDomElement(element)) {
      return '';
    }

    const className = typeof element.className === 'string' ? element.className : element.getAttribute('class');

    const values = [
      element.tagName,
      element.getAttribute('role'),
      element.getAttribute('id'),
      className,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ];

    return normalizeText(values.filter((value) => String(value || '').trim()).join(' '));
  }

  function hasMainSiteNavigationContext(element) {
    if (!isDomElement(element)) {
      return false;
    }

    if (element.closest("nav, header, aside, [role='navigation'], [role='tablist'], [role='menu']")) {
      return true;
    }

    const semanticText = [getElementSemanticText(element), getElementSemanticText(element.parentElement)]
      .filter(Boolean)
      .join(' ');

    return /(^|[\s_-])(nav|menu|sidebar|drawer|tab|tabs|toolbar)([\s_-]|$)/.test(semanticText);
  }

  function getMainSiteMenuItemElement(element) {
    if (!isDomElement(element)) {
      return null;
    }

    const interactiveAncestor = element.closest(
      "a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem']",
    );
    if (interactiveAncestor && isVisibleElement(interactiveAncestor)) {
      return interactiveAncestor;
    }

    return isVisibleElement(element) ? element : null;
  }

  function scoreMainSiteNewsCandidate(menuItem, text, labels) {
    const rect = menuItem.getBoundingClientRect();
    const roleText = normalizeText(menuItem.getAttribute('role'));
    const semanticText = [
      getElementSemanticText(menuItem),
      getElementSemanticText(menuItem.parentElement),
      getElementSemanticText(
        menuItem.closest("nav, header, aside, [role='navigation'], [role='tablist'], [role='menu']"),
      ),
    ]
      .filter(Boolean)
      .join(' ');

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
    return labels.some(
      (label) =>
        normalized === label ||
        normalized.startsWith(`${label} `) ||
        normalized.endsWith(` ${label}`) ||
        normalized.includes(` ${label} `),
    );
  }

  function detectMainSiteMenuLanguage(referenceItem) {
    const text = normalizeText(referenceItem?.textContent);
    if (textMatchesLabel(text, [normalizeText(UI_TEXT.zh.mainSiteNews)])) {
      return 'zh';
    }
    if (textMatchesLabel(text, [normalizeText(UI_TEXT.en.mainSiteNews)])) {
      return 'en';
    }
    return resolveUiLanguage();
  }

  function updateShortcutLabel(root, nextLabel) {
    const newsLabels = [UI_TEXT.en.mainSiteNews, UI_TEXT.zh.mainSiteNews];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let didReplace = false;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const currentValue = String(node.nodeValue || '');
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
      const textContainer = root.querySelector('span, div, p') || root;
      textContainer.appendChild(document.createTextNode(nextLabel));
    }
  }

  function findMainSiteNewsMenuItem() {
    const newsLabels = getMainSiteNewsLabels();
    const dedupedCandidates = new Map();

    for (const element of Array.from(
      document.querySelectorAll("a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], div"),
    )) {
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

    const bestCandidate = Array.from(dedupedCandidates.values()).sort(
      (left, right) =>
        right.score - left.score ||
        left.rect.top - right.rect.top ||
        left.rect.left - right.rect.left ||
        left.menuItem.querySelectorAll('*').length - right.menuItem.querySelectorAll('*').length,
    )[0];

    return bestCandidate?.menuItem || null;
  }

  function openSimulatorPage(preferredLanguage = '') {
    if (!document?.body) {
      window.open(SIMULATOR_FALLBACK_URL, '_blank', 'noopener,noreferrer');
      return;
    }

    const existingModal = document.getElementById(SIMULATOR_MIRROR_MODAL_ID);
    if (existingModal && existingModal.isConnected) {
      const preferredButton = existingModal.querySelector('[data-mwi-tm-mirror="cloudflare"]');
      if (preferredButton && typeof preferredButton.focus === 'function') {
        preferredButton.focus();
      }
      return;
    }

    const previousFocus = document.activeElement;
    const titleId = `${SIMULATOR_MIRROR_MODAL_ID}-title`;
    const descriptionId = `${SIMULATOR_MIRROR_MODAL_ID}-desc`;

    const overlay = document.createElement('div');
    overlay.id = SIMULATOR_MIRROR_MODAL_ID;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';
    overlay.style.background = 'rgba(2, 6, 23, 0.72)';
    overlay.style.backdropFilter = 'blur(8px)';
    overlay.style.WebkitBackdropFilter = 'blur(8px)';
    overlay.style.boxSizing = 'border-box';

    function closeModal() {
      document.removeEventListener('keydown', handleKeydown, true);
      overlay.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    }

    function handleKeydown(event) {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    }

    document.addEventListener('keydown', handleKeydown, true);
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) {
        return;
      }
      closeModal();
    });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('aria-describedby', descriptionId);
    dialog.style.width = 'min(460px, 100%)';
    dialog.style.borderRadius = '16px';
    dialog.style.padding = '18px 18px 14px';
    dialog.style.background = 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92))';
    dialog.style.border = '1px solid rgba(148, 163, 184, 0.22)';
    dialog.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.65)';
    dialog.style.color = '#e2e8f0';
    dialog.style.boxSizing = 'border-box';
    dialog.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'flex-start';
    header.style.justifyContent = 'space-between';
    header.style.gap = '12px';

    const title = document.createElement('div');
    title.id = titleId;
    title.textContent = getUiText('mirrorModalTitle', preferredLanguage);
    title.style.fontSize = '16px';
    title.style.fontWeight = '750';
    title.style.letterSpacing = '0.01em';
    title.style.lineHeight = '1.25';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', getUiText('mirrorModalCancel', preferredLanguage));
    closeButton.style.border = '1px solid rgba(148, 163, 184, 0.22)';
    closeButton.style.background = 'rgba(30, 41, 59, 0.48)';
    closeButton.style.color = '#e2e8f0';
    closeButton.style.width = '34px';
    closeButton.style.height = '34px';
    closeButton.style.borderRadius = '12px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.display = 'inline-flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.style.fontSize = '20px';
    closeButton.style.lineHeight = '1';
    closeButton.style.padding = '0';
    closeButton.style.flexShrink = '0';
    closeButton.addEventListener('click', closeModal);

    const description = document.createElement('div');
    description.id = descriptionId;
    description.textContent = getUiText('mirrorModalDescription', preferredLanguage);
    description.style.marginTop = '8px';
    description.style.fontSize = '13px';
    description.style.color = 'rgba(148, 163, 184, 0.95)';
    description.style.lineHeight = '1.45';

    const options = document.createElement('div');
    options.style.display = 'grid';
    options.style.gap = '10px';
    options.style.marginTop = '16px';

    function createOptionButton({ id, label, url, accentColor }) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-mwi-tm-mirror', id);
      button.style.width = '100%';
      button.style.textAlign = 'left';
      button.style.cursor = 'pointer';
      button.style.border = `1px solid ${accentColor}`;
      button.style.background = 'rgba(2, 6, 23, 0.25)';
      button.style.borderRadius = '14px';
      button.style.padding = '12px 12px';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'space-between';
      button.style.gap = '12px';
      button.style.color = '#e2e8f0';
      button.style.boxShadow = 'inset 0 1px 0 rgba(255, 255, 255, 0.04)';
      button.style.transition = 'transform 80ms ease, background 120ms ease, border-color 120ms ease';
      button.addEventListener('mouseenter', () => {
        button.style.background = 'rgba(30, 41, 59, 0.45)';
        button.style.transform = 'translateY(-1px)';
        button.style.borderColor = accentColor;
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = 'rgba(2, 6, 23, 0.25)';
        button.style.transform = '';
        button.style.borderColor = accentColor;
      });
      button.addEventListener('click', () => {
        window.open(url, '_blank', 'noopener,noreferrer');
        closeModal();
      });

      const labelBlock = document.createElement('div');
      labelBlock.style.display = 'flex';
      labelBlock.style.flexDirection = 'column';
      labelBlock.style.gap = '4px';
      labelBlock.style.minWidth = '0';

      const labelRow = document.createElement('div');
      labelRow.textContent = label;
      labelRow.style.fontSize = '14px';
      labelRow.style.fontWeight = '750';
      labelRow.style.letterSpacing = '0.01em';
      labelRow.style.color = '#e2e8f0';

      const urlRow = document.createElement('div');
      urlRow.textContent = url.replace(/^https?:\/\//, '');
      urlRow.style.fontSize = '12px';
      urlRow.style.color = 'rgba(148, 163, 184, 0.95)';
      urlRow.style.overflow = 'hidden';
      urlRow.style.textOverflow = 'ellipsis';
      urlRow.style.whiteSpace = 'nowrap';

      labelBlock.appendChild(labelRow);
      labelBlock.appendChild(urlRow);

      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      arrow.style.fontSize = '16px';
      arrow.style.fontWeight = '700';
      arrow.style.color = accentColor;
      arrow.style.flexShrink = '0';

      button.appendChild(labelBlock);
      button.appendChild(arrow);
      return button;
    }

    const cloudflareButton = createOptionButton({
      id: 'cloudflare',
      label: getUiText('mirrorModalCloudflare', preferredLanguage),
      url: SIMULATOR_CLOUDFLARE_URL,
      accentColor: 'rgba(249, 115, 22, 0.72)',
    });

    const githubButton = createOptionButton({
      id: 'github',
      label: getUiText('mirrorModalGithub', preferredLanguage),
      url: SIMULATOR_GITHUB_PAGES_URL,
      accentColor: 'rgba(56, 189, 248, 0.78)',
    });

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.style.marginTop = '14px';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = getUiText('mirrorModalCancel', preferredLanguage);
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.border = '1px solid rgba(148, 163, 184, 0.22)';
    cancelButton.style.background = 'rgba(30, 41, 59, 0.25)';
    cancelButton.style.color = '#e2e8f0';
    cancelButton.style.borderRadius = '12px';
    cancelButton.style.padding = '10px 14px';
    cancelButton.style.fontSize = '13px';
    cancelButton.style.fontWeight = '700';
    cancelButton.addEventListener('click', closeModal);

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
    const iconWrapper = document.createElement('span');
    iconWrapper.setAttribute('aria-hidden', 'true');
    iconWrapper.style.display = 'inline-flex';
    iconWrapper.style.alignItems = 'center';
    iconWrapper.style.justifyContent = 'center';
    iconWrapper.style.width = '24px';
    iconWrapper.style.height = '24px';
    iconWrapper.style.flexShrink = '0';
    iconWrapper.style.borderRadius = '7px';
    iconWrapper.style.background = 'linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(20, 184, 166, 0.14))';
    iconWrapper.style.boxShadow = 'inset 0 0 0 1px rgba(103, 232, 249, 0.22)';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#67e8f9');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    for (const attrs of [
      { cx: '12', cy: '12', r: '4.5' },
      { d: 'M12 2.75V5.5' },
      { d: 'M12 18.5v2.75' },
      { d: 'M2.75 12H5.5' },
      { d: 'M18.5 12h2.75' },
      { d: 'M5.9 5.9l1.95 1.95' },
      { d: 'M16.15 16.15l1.95 1.95' },
      { d: 'M18.1 5.9l-1.95 1.95' },
      { d: 'M7.85 16.15 5.9 18.1' },
    ]) {
      const element = attrs.cx ? document.createElementNS(svgNS, 'circle') : document.createElementNS(svgNS, 'path');
      for (const [key, value] of Object.entries(attrs)) {
        element.setAttribute(key, value);
      }
      svg.appendChild(element);
    }

    iconWrapper.appendChild(svg);
    return iconWrapper;
  }

  function createMainSiteShortcutLabel(preferredLanguage) {
    const label = document.createElement('span');
    label.textContent = getUiText('mainSiteShortcut', preferredLanguage);
    label.style.color = '#fbbf24';
    label.style.fontWeight = '700';
    label.style.letterSpacing = '0.01em';
    label.style.textShadow = '0 0 10px rgba(251, 191, 36, 0.16)';
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
    shortcut.setAttribute('data-mwi-tm-main-shortcut', 'simulator');
    shortcut.removeAttribute('aria-current');
    shortcut.setAttribute('aria-label', getUiText('mainSiteShortcut', preferredLanguage));
    shortcut.title = getUiText('mainSiteShortcutTitle', preferredLanguage);
    shortcut.style.textDecoration = 'none';

    shortcut.querySelectorAll('[id]').forEach((element) => {
      element.removeAttribute('id');
    });

    if (shortcut.tagName === 'A') {
      shortcut.href = SIMULATOR_FALLBACK_URL;
      shortcut.target = '_blank';
      shortcut.rel = 'noopener noreferrer';
      shortcut.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
      shortcut.addEventListener('keydown', (event) => {
        if (event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
    } else {
      shortcut.setAttribute('role', 'link');
      shortcut.tabIndex = 0;
      shortcut.style.cursor = 'pointer';
      shortcut.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
      shortcut.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
    }

    shortcut.replaceChildren();

    const content = document.createElement('span');
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.justifyContent = compactLayout ? 'center' : 'flex-start';
    content.style.gap = compactLayout ? '0' : '12px';
    content.style.width = '100%';
    content.style.minWidth = '0';

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

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    } else {
      attachObserver();
    }
  }

  // —— 纯决策函数（可注入 vm 沙箱单测，见 scripts/__tests__/mwi-main-site-import.test.js）——
  //
  // pickBestProfileDialogCandidate：从扫描候选（{ element, area, hasTablist }）中选出目标
  // 弹窗。资料弹窗通常带 tablist（角色/技能/装备等页签），优先选择含 tablist 的候选；
  // 同组内再按面积降序，避免被更大的非资料弹窗（设置弹窗、确认框）抢占。
  function pickBestProfileDialogCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }
    return [...candidates].sort((left, right) => {
      if (left.hasTablist !== right.hasTablist) {
        return left.hasTablist ? -1 : 1;
      }
      return right.area - left.area;
    })[0];
  }

  // resolveProfileCopyMountAction：把「按钮状态 + 分享快照 + 扫描到的弹窗」映射为动作。
  //   keep          —— 按钮已挂载（调用方直接返回，不扫描）
  //   skip          —— 无分享快照（调用方直接返回，不扫描——保持懒扫描语义）
  //   arm-cooldown  —— 无弹窗、或弹窗名字校验失败（调用方武装冷却并返回）
  //   mount         —— 校验通过（调用方继续挂载流程）
  function resolveProfileCopyMountAction({ hasConnectedButton, profile, dialog }) {
    if (hasConnectedButton) {
      return { action: 'keep' };
    }
    if (!profile || typeof profile !== 'object') {
      return { action: 'skip' };
    }
    if (!dialog) {
      return { action: 'arm-cooldown' };
    }
    if (!isLikelyProfileDialog(dialog, profile)) {
      return { action: 'arm-cooldown' };
    }
    return { action: 'mount' };
  }

  // resolveProfileDialogScanGate：冷却状态机。返回 'cooling'（冷却中，retryAfterMs 后应
  // 排程一次兜底重试，对应「冷却窗口吞掉弹窗打开事件」的修复）或 'scan'（可执行扫描）。
  function resolveProfileDialogScanGate(now, cooldownUntil) {
    if (now < cooldownUntil) {
      return { state: 'cooling', retryAfterMs: cooldownUntil - now };
    }
    return { state: 'scan' };
  }

  // 在主站「玩家资料弹窗」里注入「复制角色数据」按钮，把该玩家的分享资料
  // 复制为 JSON，供模拟器「导入导出」弹窗粘贴导入（Solo Import To Player）。
  function findOpenProfileDialog() {
    // 5 组选择器合并为单条组合选择器：单次 querySelectorAll 即返回全部候选（去重文档序），
    // 与逐组遍历 + seen 去重得到相同候选集合。分享激活 + 弹窗未开期间每 500ms 一次扫描
    // （冷却节流），主站 DOM 高频变化时把每次扫描的 5 次全文档遍历收敛为 1 次。
    // 注意：此处可安全合并（候选最终统一排序）；findProfileTablist / findCloseButtonWithin
    // 的组顺序带优先级语义（返回第一个命中），保持逐组查询。
    const selectors = [
      "[role='dialog'], [role='alertdialog'], [class*='modal' i], [class*='dialog' i], [class*='overlay' i]",
    ];
    const debug = shouldInstallDebugInterface();
    const candidates = [];
    const seen = new Set();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        if (!isVisibleElement(element)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        // 尺寸判定用布局尺寸（offsetWidth/offsetHeight）而非视口裁剪后的 rect：
        // 弹窗在滚动容器内部分滚出视口时，rect 宽高会被裁剪而误判为过小。
        // isVisibleElement 已过滤 display:none 等不可见元素，offsetWidth 为 0 的
        // 可见元素（空布局）本就应跳过。
        const layoutWidth = element.offsetWidth || rect.width;
        const layoutHeight = element.offsetHeight || rect.height;
        if (layoutWidth < 240 || layoutHeight < 160) {
          continue;
        }

        const role = String(element.getAttribute?.('role') || '').toLowerCase();
        const isRoleDialog = role === 'dialog' || role === 'alertdialog';
        // 近全屏判定同样用布局尺寸：弹窗在滚动容器内部分滚出视口时，rect 会被裁剪，
        // 全屏遮罩可能因此漏判而未被跳过（与上方尺寸判定保持一致）。
        const isNearFullscreen =
          viewportWidth > 0 &&
          layoutWidth > viewportWidth * 0.98 &&
          viewportHeight > 0 &&
          layoutHeight > viewportHeight * 0.98;

        // 跳过全屏遮罩，让按钮落在内层的资料面板上；但近全屏的 role=dialog/alertdialog
        // 是真正的资料弹窗（移动端/最大化），不应被当作遮罩排除。
        if (isNearFullscreen && !isRoleDialog) {
          if (debug) {
            console.debug('[mwi-tm] findOpenProfileDialog: skip fullscreen overlay', element);
          }
          continue;
        }

        candidates.push({
          element,
          area: layoutWidth * layoutHeight,
          hasTablist: Boolean(findProfileTablist(element)),
        });
      }
    }

    const bestCandidate = pickBestProfileDialogCandidate(candidates);
    if (debug) {
      console.debug(
        '[mwi-tm] findOpenProfileDialog: candidates',
        candidates.map((entry) => ({
          tag: entry.element.tagName,
          role: String(entry.element.getAttribute?.('role') || ''),
          area: entry.area,
        })),
      );
    }
    return bestCandidate?.element || null;
  }

  function findCloseButtonWithin(dialog) {
    if (!dialog) {
      return null;
    }
    const selectors = [
      "[class*='closeButton' i]",
      "[class*='close-button' i]",
      "[class*='close' i][role='button']",
      "button[aria-label*='close' i]",
      "button[aria-label*='关闭' i]",
      "[aria-label*='关闭' i]",
    ];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of dialog.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        if (isVisibleElement(element)) {
          return element;
        }
      }
    }
    return null;
  }

  function findProfileTablist(dialog) {
    if (!dialog) {
      return null;
    }
    const selectors = [
      "[role='tablist']",
      "[class*='tabsContainer' i]",
      "[class*='tabs-container' i]",
      "[class*='flexContainer' i]",
      "[class*='tabList' i]",
      "[class*='tab-list' i]",
    ];
    for (const selector of selectors) {
      for (const element of dialog.querySelectorAll(selector)) {
        if (!isVisibleElement(element)) {
          continue;
        }
        // role=tablist 本身即 tab 语义；class 回退（含宽泛的 flexContainer）必须
        // 含 tab 语义元素才认可，避免把操作栏/页脚等普通 flex 容器误当作 tablist。
        // 用 :scope > 限定直接子元素：若内层嵌套了真正的 tablist（tablist 是其
        // 子元素），外层容器不会被后代查询误判，按钮仍追加到内层 tablist 行内末尾。
        const isSemanticTablist = element.getAttribute?.('role') === 'tablist';
        const hasTabSemantics = Boolean(element.querySelector(":scope > [role='tab'], :scope > [aria-selected]"));
        if (isSemanticTablist || hasTabSemantics) {
          return element;
        }
      }
    }
    return null;
  }

  // 有选择地读取真实 tab 的计算样式作为按钮基线：只取「外观尺寸/字体/圆角/字距」等安全
  // 属性，不迭代全部计算属性——站点 tab 哈希类里常有 flex:1 1 0%（等宽分栏）、
  // overflow:hidden、text-overflow:ellipsis 等布局属性，整份复制会把按钮压成与 tab 等宽的
  // 窄条，「复制角色数据」这类更长的文字会被裁掉。letter-spacing 需显式带上：tab 哈希类
  // 若覆盖了字距，缺省会退化为 MUI 默认 0.02857em，与真实 tab 产生细微字距差异。
  function readTabComputedStyles(tablist) {
    const tab = tablist ? tablist.querySelector("button, [role='tab']") : null;
    if (!tab) {
      return null;
    }
    const cs = window.getComputedStyle(tab);
    return {
      'min-height': cs.minHeight,
      'min-width': cs.minWidth,
      padding: cs.padding,
      margin: cs.margin,
      'font-size': cs.fontSize,
      'font-weight': cs.fontWeight,
      'font-family': cs.fontFamily,
      'line-height': cs.lineHeight,
      'letter-spacing': cs.letterSpacing,
      'border-radius': cs.borderRadius,
    };
  }

  function setProfileCopyButtonFeedback(button, feedbackKey) {
    if (button._mwiTmProfileCopyTimer) {
      window.clearTimeout(button._mwiTmProfileCopyTimer);
      button._mwiTmProfileCopyTimer = null;
    }
    button.textContent = getUiText(feedbackKey);
    button._mwiTmProfileCopyTimer = window.setTimeout(() => {
      button._mwiTmProfileCopyTimer = null;
      if (button.isConnected) {
        button.textContent = getUiText('copyProfileButton');
      }
    }, 1600);
  }

  function formatUiText(template, replacements) {
    let result = String(template || '');
    for (const [key, value] of Object.entries(replacements || {})) {
      result = result.split(`{${key}}`).join(String(value));
    }
    return result;
  }

  // 分享弹窗「复制角色数据」的导出载荷：只透传角色数据本身，不携带市场数据。
  // 历史：早期版本直接 JSON.stringify(profile)（无市场字段）→ 第 11 轮起在此合并
  // marketItemValues + mwiMarketDiag → 第 19 轮改回干净载荷（通道分离）、第 20 轮
  // 拆除全部诊断设施：分享弹窗「复制角色数据」= 纯角色数据；模拟器页「从主站导入」
  // 按钮携带全量市场数据（buildCurrentCharacterPayload / buildCachedProfilePayload），
  // 故需要资产分与 MWITools 对齐时请用「从主站导入」按钮，而非复制粘贴。
  // 模拟站粘贴导入对无市场字段的 payload 保持兼容（marketItemValues: null，UI 显示
  // 「官方估值：0 个物品」，属预期现象而非异常）。
  function buildProfileExportPayload(profile) {
    return { ...profile };
  }

  // 桥接导入成功后的状态栏补充文案：数导入载荷顶层实际携带的官方估值物品数。
  // 必须传载荷而不是数本页缓存——模拟器页脚本实例与主站不同源，本页 merged 缓存
  // 恒为空（localStorage 不互通、主站 WS 也不经过本页），数本地必然误报 0；
  // 真正的透传数据在主站页构建的 payload.marketItemValues 里。
  // 历史：曾有「无参时数本页 merged 缓存」的分支（本想供主站页桥接状态使用），
  // 但主站页从未调用过它，属于死代码，第 21 轮拆除。
  function describeMarketItemValuesStatus(payload) {
    const itemCount = Object.keys(payload?.marketItemValues ?? {}).length;
    if (itemCount <= 0) {
      return getUiText('marketValuesStatusEmpty');
    }
    // #18（2026-08-31）：混合载荷——载荷级标记 'official' 但附 syntheticItemHrids 清单
    // （官方与合成中价并存）时如实分列计数；把合成部分混入「官方估值已透传」正是
    // 混合载荷逐件真值丢失的用户面失真。标记本身为 'synthetic' 时全部物品均为合成、
    // 清单冗余（矛盾载荷）不进入混合分支。
    const syntheticItemHrids = Array.isArray(payload?.syntheticItemHrids) ? payload.syntheticItemHrids : [];
    if (payload?.marketEstimateSource !== 'synthetic' && syntheticItemHrids.length > 0) {
      return formatUiText(getUiText('marketValuesStatusMixed'), {
        officialCount: Math.max(0, itemCount - syntheticItemHrids.length),
        syntheticCount: syntheticItemHrids.length,
      });
    }
    // 合成中价兜底场景：载荷非空但官方估算缺位（LS 空 + WS 未推），如实标注来源，
    // 避免用户把合成中价（与官方估算差约 4-5%）误当官方估算对账（N5，2026-08-31）。
    // 旧载荷/复制粘贴载荷无 marketEstimateSource 字段时落 official 分支（向后兼容）。
    if (payload?.marketEstimateSource === 'synthetic') {
      return formatUiText(getUiText('marketValuesStatusSynthetic'), { count: itemCount });
    }
    return formatUiText(getUiText('marketValuesStatusReady'), { count: itemCount });
  }

  // 团队导入成功反馈文案拼接（#22 从深层闭包 importTeamMainSiteResponse 提取为顶层
  // 可注入纯函数，使该接线可用行为断言测试，替代锁源码字符串的 scriptSource.toContain）：
  // summary 为空 = 全部成功（importSuccess + 估值文案）；非空 = 部分成功
  //（导入完成/Import finished + summary + 估值文案）。firstSuccessPayload 取任一
  // 成功 member 载荷即可（各 member 挂同一份 merged 快照）。
  function buildTeamImportFeedbackText({ uiLanguage, summary, firstSuccessPayload }) {
    const marketValuesStatusText = describeMarketItemValuesStatus(firstSuccessPayload);
    if (summary) {
      return uiLanguage === 'zh'
        ? `导入完成：${summary} ${marketValuesStatusText}`
        : `Import finished: ${summary} ${marketValuesStatusText}`;
    }
    return `${getUiText('importSuccess', uiLanguage)} ${marketValuesStatusText}`;
  }

  // 团队导入部分成功摘要拼装（#22 P3① 从深层闭包 importTeamMainSiteResponse 提取为
  // 顶层可注入纯函数，配合 buildTeamImportFeedbackText 一并行为测试）：失败 >0 时返回
  // 「成功 N 人，失败 N 人（预览…）」；无失败返回空串。uiLanguage 由调用方传入
  //（原实现读深层闭包 state.uiLanguage）。
  function formatTeamImportSummary(successCount, failureEntries = [], uiLanguage = 'zh') {
    const failures = Array.isArray(failureEntries) ? failureEntries : [];
    const failedCount = failures.length;
    if (failedCount <= 0) {
      return '';
    }

    const preview = failures
      .slice(0, 2)
      .map((entry) => {
        const name = normalizeCharacterName(entry?.name || '') || '-';
        const message = normalizeCharacterName(entry?.message || '') || getUiText('importFailed', uiLanguage);
        return `${name}: ${message}`;
      })
      .join(uiLanguage === 'zh' ? '；' : '; ');

    const suffix =
      failedCount > 2 ? (uiLanguage === 'zh' ? `……另有 ${failedCount - 2} 个失败` : `… +${failedCount - 2} more`) : '';

    if (uiLanguage === 'zh') {
      return `成功 ${successCount} 人，失败 ${failedCount} 人（${preview}${suffix}）。`;
    }

    return `${successCount} succeeded, ${failedCount} failed (${preview}${suffix}).`;
  }

  function copyTextViaExecCommand(text) {
    // 防御：脚本 @run-at document-start 时 body 可能尚不存在；按钮点击路径下
    // body 必然存在，但独立调用（如未来快捷键）仍需防护。
    if (!document.body) {
      return false;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    // 记录原焦点元素：focus() 可能触发主站页面的 blur 监听（自动保存、UI 状态切换），
    // 复制完成后恢复焦点，避免把焦点留在已移除的 textarea 上。
    const previouslyFocused = document.activeElement;
    // iOS Safari 上 select()/setSelectionRange() 常需元素先获得焦点，否则可能静默失败。
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let succeeded = false;
    try {
      succeeded = document.execCommand('copy');
    } catch (_error) {
      succeeded = false;
    }

    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    // finally 保证异常路径也清理 textarea，避免残留。
    try {
      if (textarea.isConnected) {
        document.body.removeChild(textarea);
      }
    } catch (_error) {
      // 清理失败不影响复制结果。
    }
    // 恢复原焦点（textarea 已移除，activeElement 已回落为 body；仅当原焦点元素仍可聚焦时恢复）。
    if (previouslyFocused && previouslyFocused !== document.body && typeof previouslyFocused.focus === 'function') {
      try {
        previouslyFocused.focus();
      } catch (_error) {
        // 焦点恢复失败不影响复制结果。
      }
    }
    return succeeded;
  }

  async function copyLatestSharedProfileToClipboard(button) {
    // 优先读取按钮绑定的本次分享快照，避免依赖单一全局槽而复制到「最后一次分享」。
    const profile = button?._mwiTmProfileSnapshot || mainSiteState.latestSharedProfile;
    if (!profile || typeof profile !== 'object') {
      setProfileCopyButtonFeedback(button, 'copyProfileFailed');
      return;
    }

    let text;
    try {
      text = JSON.stringify(buildProfileExportPayload(profile));
    } catch (_error) {
      // clonePlainObject 的兜底路径（structuredClone/递归）可能保留 BigInt 或循环引用，
      // 此时 JSON.stringify 会抛 TypeError。失败时走失败反馈，避免 async 函数变成
      // unhandled rejection 且按钮无任何反馈。
      setProfileCopyButtonFeedback(button, 'copyProfileFailed');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        setProfileCopyButtonFeedback(button, 'copyProfileSuccess');
        return;
      } catch (_error) {
        // 异步剪贴板 API 失败时，回落到 execCommand 兜底。
      }
    }

    const fallbackSucceeded = copyTextViaExecCommand(text);
    if (fallbackSucceeded) {
      setProfileCopyButtonFeedback(button, 'copyProfileSuccess');
    } else {
      setProfileCopyButtonFeedback(button, 'copyProfileFailed');
    }
  }

  function createProfileCopyButton(tablist, profile) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = PROFILE_COPY_BUTTON_ID;
    button.setAttribute('data-mwi-tm-profile-copy', '1');
    button._mwiTmProfileSnapshot = profile;
    button.textContent = getUiText('copyProfileButton');
    button.title = getUiText('copyProfileButtonTitle');
    // 固定可访问名称：反馈阶段 textContent 会临时变为「已复制」等状态文本，
    // aria-label 保持稳定，避免读屏器把反馈文本当作按钮名称。
    button.setAttribute('aria-label', getUiText('copyProfileButton'));

    // 复用 MUI 的稳定全局类名（继承 hover/focus/ripple 等类级行为），并刻意不带
    // css-xxxx / __hash 这类每次构建都可能变的哈希类名——tab 哈希类带来的外观差异
    // 由下方 readTabComputedStyles 补齐（只取安全属性，见该函数注释）。
    button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';

    // 以真实 tab 的关键计算样式为基线（尺寸/字体/圆角/字距），再叠加「颜色覆盖」，
    // 使按钮与其余 tab 视觉一致、仅背景渐变与白字不同（用户要求保留）。
    const shapeStyles = readTabComputedStyles(tablist) || {
      'min-height': '40px',
      'min-width': '90px',
      padding: '6px 16px',
      margin: '0',
      'font-size': '13px',
      'font-weight': '600',
      'font-family': 'inherit',
      'line-height': '1.5',
      'border-radius': '8px',
      'letter-spacing': '0.02857em',
    };

    const styleMap = {
      ...shapeStyles,
      'box-sizing': 'border-box',
      cursor: 'pointer',
      'white-space': 'nowrap',
      'text-transform': 'none',
      // tablist 行内末尾的独立按钮：inline-flex 保持与 tabs 同排且垂直居中；flex 按内容
      // 自适应（只禁收缩、不复制主站等宽分栏的 flex-basis），保证文字完整显示。
      display: 'inline-flex',
      'align-items': 'center',
      'flex-shrink': '0',
      'align-self': 'center',
      'margin-left': '4px',
      // 保留按钮颜色（青蓝渐变背景 + 白字），其余与 tab 一致。
      border: 'none',
      background: 'linear-gradient(135deg, rgba(14,165,233,0.92), rgba(13,148,136,0.92))',
      color: '#fff',
      'box-shadow': 'none',
    };

    button.style.cssText = Object.entries(styleMap)
      .map(([key, value]) => `${key}:${value}`)
      .join(';');

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyLatestSharedProfileToClipboard(button);
    });
    return button;
  }

  function extractSharedProfileCharacterId(profile) {
    const sharable = profile?.sharableCharacter;
    return String(sharable?.id || sharable?.characterID || sharable?.characterId || profile?.characterId || '').trim();
  }

  function extractSharedProfileName(profile) {
    return String(profile?.sharableCharacter?.name || profile?.name || '').trim();
  }

  function isLikelyProfileDialog(dialog, profile = mainSiteState.latestSharedProfile) {
    // 弹窗 DOM 一般不暴露 characterId，因此 DOM 侧校验只能用名字子串；
    // characterId 精确比对用于「新分享到达时作废旧按钮」的身份判定（见 handleProfileSharedMessage）。
    // 若未来主站弹窗暴露 data-* 角色标识，优先改用 characterId 精确校验替代名称匹配。
    const expectedName = normalizeComparableText(extractSharedProfileName(profile));
    const normalizedName = expectedName.replace(/\s+/g, '');
    if (!normalizedName || normalizedName.length < 2) {
      // 未捕获到角色名或名字过短（单字符）时无法可靠校验：保守跳过注入，
      // 避免「A」这类单字符名误匹配到 Attack 等任意含该字母的弹窗。
      return false;
    }
    const dialogText = normalizeComparableText(dialog?.textContent || '');
    if (normalizedName.length === 2) {
      // 2 字符名启用词边界匹配（在保留空白的文本上执行，normalizeComparableText 已把空白
      // 压为单空格）：名字前后不得紧邻字母/数字/下划线（含 CJK），「Mo」只有独立出现
      // 才算命中，不再匹配 Monster 这类仅含子串的弹窗（S5 已知边界）。
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundaryPattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}_])`, 'u');
      return boundaryPattern.test(dialogText);
    }
    // ≥3 字符名维持子串匹配：长名误配概率低，且避免主站正文粘连渲染（如「莫凡的装备」）
    // 导致漏挂——漏挂（功能不可用）比低频错位更不可接受。
    return dialogText.replace(/\s+/g, '').includes(normalizedName);
  }

  // 回退路径曾把弹窗临时改为 relative（见 mountProfileCopyButton 的 fallback 分支）；
  // 弹窗关闭或按钮因身份变化被移除时恢复其原始 inline position，避免陈旧样式残留。
  function restoreProfileCopyDialogPosition(button) {
    const dialog = button?._mwiTmProfileDialog;
    const originalPosition = button?._mwiTmRestoreDialogPosition;
    if (dialog && originalPosition !== undefined) {
      dialog.style.position = originalPosition;
    }
  }

  function mountProfileCopyButton() {
    // 上一次挂载的按钮已随弹窗关闭而脱离 DOM：清理按钮引用并恢复弹窗样式。
    // latestSharedProfile 不在关闭时清空——同角色重开弹窗应恢复按钮，
    // 快照延续到下一次分享覆盖为止（详见下方 previousButton 分支注释）。
    const previousButton = mainSiteState.profileCopyButton;
    if (previousButton && !previousButton.isConnected) {
      // 上一次挂载的按钮已随弹窗关闭而脱离 DOM：清理按钮引用并恢复弹窗样式。
      // 刻意不清空 latestSharedProfile：同一角色重开弹窗（未重新分享）时按钮应能恢复，
      // 快照一直延续到下一次分享覆盖为止；打开其它角色弹窗时由 isLikelyProfileDialog
      // 的名字校验阻止挂载（若旧角色名恰好是新弹窗文本的子串，理论上可能误挂——
      // 已知限制，名字校验已挡住绝大多数跨角色场景）。
      restoreProfileCopyDialogPosition(previousButton);
      mainSiteState.profileCopyButton = null;
      // 注意：此处不 return。若弹窗 A（角色 X）关闭后已打开弹窗 B（角色 Y），
      // latestSharedProfile 保留为 Y，继续走下方挂载逻辑可立即为弹窗 B 挂载按钮，
      // 无需等待下一次 DOM 变化（弹窗内容静态时按钮可能一直不出现）。
    }

    const existingButton = document.getElementById(PROFILE_COPY_BUTTON_ID);
    if (existingButton && existingButton.isConnected) {
      return;
    }

    const profile = mainSiteState.latestSharedProfile;
    if (!profile || typeof profile !== 'object') {
      return;
    }

    const dialog = findOpenProfileDialog();
    // 决策函数与 DOM 胶水分离：无弹窗 / 名字校验失败 → arm-cooldown；校验通过 → mount。
    // keep / skip 不会在此出现（按钮已连接与无快照已在上面短路返回）。
    const decision = resolveProfileCopyMountAction({ hasConnectedButton: false, profile, dialog });
    if (decision.action === 'arm-cooldown') {
      // 未找到弹窗 / 弹窗存在但名字校验失败（名字为空/过短/与弹窗内容不匹配）：
      // 记录冷却，避免主站 React 应用频繁 DOM 变化时持续触发全量扫描
      // （见 initMainSiteProfileCopyButton 的 scheduleMount 冷却判断）。
      mainSiteState.profileDialogScanCooldownUntil = Date.now() + PROFILE_DIALOG_SCAN_COOLDOWN_MS;
      return;
    }
    if (decision.action !== 'mount') {
      return;
    }

    const tablist = findProfileTablist(dialog);
    const button = createProfileCopyButton(tablist, profile);
    button._mwiTmProfileDialog = dialog;

    // 作为独立操作按钮追加到 tablist 行内末尾（即最后一个 tab 的右侧）。曾用
    // insertAdjacentElement('afterend') 放在 tablist 之后——主站资料弹窗里 tablist 的父容器
    // 不是 flex 行布局，按钮会被换到下一行；只有放入行内才能与 tabs 保持同一排。
    // 代价是 tablist 混入非 tab 子元素（ARIA 语义不纯）：按钮不带 role=tab，读屏器仍按普通
    // 按钮播报，视觉正确性优先。按钮 click 已 stopPropagation（不触发主站 tab 切换），无
    // tabindex 不参与主站 tab 键序；React 重渲染移除按钮时由 existingButton 检查重新挂载。
    if (tablist) {
      tablist.appendChild(button);
      mainSiteState.profileCopyButton = button;
      return;
    }

    // 找不到 tablist 时回退：绝对定位在弹窗右上角（关闭按钮正下方、右对齐）。
    // 记录原始 inline position，待弹窗关闭/按钮移除时恢复（见 restoreProfileCopyDialogPosition）。
    // 注意：若弹窗或其祖先带 overflow:hidden，右上角按钮理论上可能被裁剪；目前主站资料弹窗
    // 右上角位于其内容边界内，暂未做通用反裁剪处理。
    const position = window.getComputedStyle(dialog).position;
    if (position === 'static') {
      button._mwiTmRestoreDialogPosition = dialog.style.position;
      dialog.style.position = 'relative';
    }

    let topPx = '12px';
    let rightPx = '12px';
    const closeButton = findCloseButtonWithin(dialog);
    if (closeButton) {
      const dialogRect = dialog.getBoundingClientRect();
      const closeRect = closeButton.getBoundingClientRect();
      if (dialogRect.width > 0 && closeRect.width > 0 && closeRect.height > 0) {
        topPx = `${Math.round(Math.max(12, closeRect.bottom - dialogRect.top + 8))}px`;
        rightPx = `${Math.round(Math.max(12, dialogRect.right - closeRect.right))}px`;
      }
    }

    button.style.position = 'absolute';
    button.style.top = topPx;
    button.style.right = rightPx;
    button.style.zIndex = '2147483647';
    dialog.appendChild(button);
    mainSiteState.profileCopyButton = button;
  }

  // findOpenProfileDialog 全量扫描的冷却时长：弹窗关闭后 500ms 内不再重复扫描，
  // 避免主站 React 应用频繁 DOM 变化时持续触发 querySelectorAll + 布局读取。
  const PROFILE_DIALOG_SCAN_COOLDOWN_MS = 500;

  function initMainSiteProfileCopyButton() {
    let scheduled = false;
    // 冷却窗口兜底重试定时器：冷却期内被跳过的扫描在此留下一次性重试（见 scheduleMount），
    // 保证冷却结束后必有最后一次挂载尝试。mountProfileCopyButton 内部会自然短路
    // （latestSharedProfile 为空 / 按钮已挂载 / 弹窗仍未打开），因此不会形成轮询。
    let mountRetryTimer = null;

    function scheduleMount() {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        // 冷却期内跳过扫描：弹窗刚关闭（或从未打开）时，findOpenProfileDialog 的
        // 全量扫描没有意义，直接跳过直到冷却结束，避免持续扫描开销。
        const gate = resolveProfileDialogScanGate(Date.now(), mainSiteState.profileDialogScanCooldownUntil);
        if (gate.state === 'cooling') {
          // 关键兜底：弹窗打开产生的 DOM 变化若恰好落在冷却窗口内，会被上面的跳过
          // 直接吞掉；资料弹窗内容静态、之后可能再无 DOM 变化，按钮将永不挂载。
          // 因此排程冷却结束后的最后一次重试。重试是一次性的：若届时弹窗仍未打开，
          // 扫描会重新武装冷却并返回，重试不循环，等待下一次 DOM 变化触发。
          if (mountRetryTimer === null) {
            mountRetryTimer = window.setTimeout(() => {
              mountRetryTimer = null;
              mountProfileCopyButton();
            }, gate.retryAfterMs);
          }
          return;
        }
        mountProfileCopyButton();
      });
    }

    // 观察者保持常驻（不做 disconnect）：它同时承担「弹窗关闭后清理临时状态」的检测
    // （见 mountProfileCopyButton 里 previousButton.isConnected 分支）。回调本身 O(1)，
    // 且 mountProfileCopyButton 在 latestSharedProfile 为空时会先短路返回，不会触发
    // findOpenProfileDialog 的全量扫描；latestSharedProfile 非空但弹窗未打开时，
    // 由 profileDialogScanCooldownUntil 冷却节流，避免每次 DOM 变化都全量扫描。
    const observer = new MutationObserver(scheduleMount);

    function attachObserver() {
      mountProfileCopyButton();
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    } else {
      attachObserver();
    }
  }

  function createRequestId() {
    return `mwi-tm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeErrorMessage(error, fallbackMessage) {
    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    const message = String(error?.message || '').trim();
    return message || fallbackMessage;
  }

  function isTrustedBridgeMessageSource(source) {
    if (!source) {
      return false;
    }

    // 用户脚本沙箱暴露的是代理 `window`，而页面使用真实的（不安全的）window
    // 作为 `event.source` 发送消息。此处必须同时接受两者。
    return source === window || source === pageWindow;
  }

  function isTrustedBridgeMessageEvent(event) {
    return isTrustedBridgeMessageSource(event?.source) && event?.origin === window.location.origin;
  }

  function waitForWindowMessage(channel, type, requestId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener('message', handleWindowMessage);
        reject(new Error(getUiText('pageBridgeTimeout')));
      }, timeoutMs);

      function handleWindowMessage(event) {
        if (!isTrustedBridgeMessageEvent(event)) {
          return;
        }

        const data = event.data;
        if (!data || typeof data !== 'object') {
          return;
        }

        if (data.channel !== channel || data.type !== type || data.requestId !== requestId) {
          return;
        }

        window.clearTimeout(timeoutId);
        window.removeEventListener('message', handleWindowMessage);
        resolve(data);
      }

      window.addEventListener('message', handleWindowMessage);
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
        reject(new Error(getUiText('mainSiteTabTimeout')));
      }, timeoutMs);

      function maybeResolve(rawValue) {
        if (!rawValue || typeof rawValue !== 'object') {
          return false;
        }

        if (String(rawValue.requestId || '') !== requestId) {
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
    if (typeof rawValue !== 'string') {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return null;
    }
  }

  function isMainSiteGameMessage(message) {
    return Boolean(message && typeof message === 'object' && typeof message.type === 'string');
  }

  function captureCurrentCharacterState(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    const type = String(message.type || '');
    if (type !== 'init_character_data' && type !== 'character_updated') {
      return;
    }

    const previousCharacterName = normalizeCharacterName(mainSiteState.currentCharacterName);
    const shouldResetSnapshot = type === 'character_updated' && hasCharacterIdentityChanged(message);
    if (shouldResetSnapshot) {
      resetCurrentCharacterTracking(previousCharacterName);
    }

    const characterName = String(message.character?.name || '').trim();
    if (characterName) {
      mainSiteState.currentCharacterName = characterName;
    }

    if (type === 'init_character_data') {
      updateCurrentCharacterSnapshot(message, true);
      replaceTrackedCharacterActions(message.characterActions);
      syncCurrentCharacterConsumableSlotMaps(message, true);
      syncCurrentCharacterCombatTriggerMaps(message, true);
      return;
    }

    if (type === 'character_updated') {
      updateCurrentCharacterSnapshot(message, shouldResetSnapshot);
      syncCurrentCharacterConsumableSlotMaps(message, shouldResetSnapshot);
      syncCurrentCharacterCombatTriggerMaps(message, shouldResetSnapshot);
    }
  }

  function captureCharacterActionsUpdate(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    const type = String(message.type || '');
    if (type === 'actions_updated' || type === 'action_completed') {
      mergeTrackedCharacterActions(message.endCharacterActions);
      return;
    }

    if (type === 'action_type_consumable_slots_updated') {
      syncCurrentCharacterConsumableSlotMaps(message);
      return;
    }

    if (type === 'all_combat_triggers_updated') {
      syncCurrentCharacterCombatTriggerMaps(message);
      return;
    }

    if (type === 'combat_triggers_updated') {
      updateCombatTriggerMap(message);
    }
  }

  // —— 市场估值透传（F12 诊断已随第 20 轮拆除；捕获逻辑见 captureMarketItemValues）——
  // 订单簿形状漂移告警去重标记：会话内只告警一次（见下方【一般-2】注释）。
  let marketOrderBookShapeWarned = false;
  function captureMarketItemValues(message) {
    const type = String(message?.type || '');
    if (type === 'market_item_values_updated') {
      const values = message?.marketItemValues;
      if (values && typeof values === 'object' && !Array.isArray(values)) {
        mainSiteState.marketItemValues = clonePlainObject(values);
      }
      return;
    }
    if (type === 'market_item_order_books_updated') {
      // 订单簿消息为单物品增量（对齐 MWITools applyMarketOrderBooks）：字段在
      // message.marketItemOrderBooks 下（itemHrid + marketValues{等级:估值}），
      // 需按物品合并进缓存；早期实现误读顶层 marketValues 且把单物品形状
      // spread 到顶层，导致官方估值缓存始终为空、导入后资产分降级为挂单价。
      // 合并成本约定（2026-08-31 审计【性能 #6】）：顶层浅拷贝（物品键引用复制）
      // + 仅深克隆本物品的 marketValues（≤21 档）——不得回退为
      // clonePlainObject(existingByItem) 全量深克隆（单物品增量每条消息
      // JSON 往返整张 ~872 物品缓存，市场页活跃期逐条阻塞主线程）。非目标
      // 物品的 levels 映射与上一代缓存共享引用是安全的：本状态全部写点均
      // 构建新对象、不变更已发布对象，getMergedMarketItemValues 亦只读展开——与
      // mergeStoredMarketItemValues（【一般-1】后同为浅拷贝构建新对象）同款
      // 结构共享；顶层引用仍按事件整体替换，N3 记忆化失效信号约定不变。
      const rawOrderBooks = message?.marketItemOrderBooks;
      // 【一般-2】形状防御与全量分支（marketItemValues 的 !Array.isArray）对齐：
      // typeof 不排数组，契约漂移为数组形状时 itemHrid 取值必为空、合并必然静默
      // no-op——官方估值停止增量更新、资产分无声降级为挂单价链，且 F12 诊断已
      // 随第 20 轮拆除，全程无任何可观测信号。故形状漂移（数组/非对象）时会话内
      // 告警一次（订单簿增量为高频消息，逐条告警会刷屏），并维持既有顶层
      // message 回退路径不变（与缺字段时同路径，不新增解析分支）。
      if (rawOrderBooks != null && (typeof rawOrderBooks !== 'object' || Array.isArray(rawOrderBooks))) {
        if (!marketOrderBookShapeWarned) {
          marketOrderBookShapeWarned = true;
          console.warn(
            '[MWI TM] market_item_order_books_updated.marketItemOrderBooks 形状异常（预期 {itemHrid, marketValues} 单物品对象），官方估值增量合并已停止：',
            rawOrderBooks,
          );
        }
      }
      const orderBook =
        rawOrderBooks && typeof rawOrderBooks === 'object' && !Array.isArray(rawOrderBooks) ? rawOrderBooks : message;
      const itemHrid = String(orderBook?.itemHrid || '');
      const values = orderBook?.marketValues;
      if (itemHrid && values && typeof values === 'object' && !Array.isArray(values)) {
        const existingByItem = mainSiteState.marketItemValues ?? {};
        mainSiteState.marketItemValues = {
          ...existingByItem,
          [itemHrid]: {
            ...(existingByItem[itemHrid] ?? {}),
            ...clonePlainObject(values),
          },
        };
      }
    }
  }

  function handleProfileSharedMessage(message) {
    if (String(message?.type || '') !== 'profile_shared' || !message?.profile) {
      return;
    }

    const nextProfile = clonePlainObject(message.profile);

    // 新分享到达：作废绑定到其它角色的旧按钮，避免陈旧快照残留；同一角色则刷新快照。
    // 注意：ID 缺失（如旧版主站载荷无 characterId）时无法确认身份，保守移除旧按钮，
    // 交由 mountProfileCopyButton 依据最新分享重新挂载，避免按钮误挂旧弹窗。
    const previousButton = mainSiteState.profileCopyButton;
    if (previousButton && previousButton._mwiTmProfileSnapshot) {
      const previousId = extractSharedProfileCharacterId(previousButton._mwiTmProfileSnapshot);
      const nextId = extractSharedProfileCharacterId(nextProfile);
      const isSameCharacter = Boolean(previousId && nextId && previousId === nextId);
      if (isSameCharacter) {
        // 同一角色：刷新按钮快照（全局槽由下方统一赋值）。
        previousButton._mwiTmProfileSnapshot = nextProfile;
      } else {
        // 另一角色，或 ID 缺失无法确认身份：移除旧按钮，交由挂载逻辑重新挂载。
        if (previousButton.isConnected) {
          previousButton.remove();
        }
        restoreProfileCopyDialogPosition(previousButton);
        mainSiteState.profileCopyButton = null;
      }
    }

    // 统一使用克隆后的 nextProfile 持久化，避免与原始 message.profile 混用。
    persistProfileCacheEntry(nextProfile);
    mainSiteState.latestSharedProfile = nextProfile;
  }

  function instrumentMainSiteSocket(socket) {
    if (!socket || socket.__mwiTmBridgeInstrumented === true) {
      return socket;
    }

    socket.__mwiTmBridgeInstrumented = true;
    mainSiteState.sockets.add(socket);

    socket.addEventListener('message', (event) => {
      const parsed = parseMainSiteJsonPayload(event.data);
      if (hasStructuredPartyInfoFieldHints(event.data)) {
        rememberRecentPartyMessage(parsed);
      }

      if (!isMainSiteGameMessage(parsed)) {
        return;
      }

      captureCurrentCharacterState(parsed);
      captureCurrentCharacterDataUpdate(parsed);
      captureCharacterActionsUpdate(parsed);
      captureMarketItemValues(parsed);
      handleProfileSharedMessage(parsed);
    });

    socket.addEventListener('close', () => {
      mainSiteState.sockets.delete(socket);
      if (mainSiteState.sockets.size === 0) {
        // 这里只丢弃内存中的名单。套接字关闭并不能证明队伍已结束：重连会短暂
        // 关闭所有套接字，若清空持久化缓存，则在新队伍消息到达前，导入团队成员
        // 将降级为仅当前角色。持久化缓存的失效交由真正的 \"left the party\"
        // 信号（空队伍快照 / partyId -> 0）处理。
        clearRecentPartyMessages();
      }
    });

    return socket;
  }

  function installMainSiteSocketBridge() {
    if (mainSiteState.isInstalled === true) {
      return true;
    }

    const NativeWebSocket = pageWindow?.WebSocket;
    if (typeof NativeWebSocket !== 'function') {
      return false;
    }

    if (NativeWebSocket.__mwiTmWrapped === true) {
      mainSiteState.isInstalled = true;
      return true;
    }

    function WrappedWebSocket(url, protocols) {
      const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      return instrumentMainSiteSocket(socket);
    }

    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.defineProperty(WrappedWebSocket, 'CONNECTING', { value: NativeWebSocket.CONNECTING });
    Object.defineProperty(WrappedWebSocket, 'OPEN', { value: NativeWebSocket.OPEN });
    Object.defineProperty(WrappedWebSocket, 'CLOSING', { value: NativeWebSocket.CLOSING });
    Object.defineProperty(WrappedWebSocket, 'CLOSED', { value: NativeWebSocket.CLOSED });
    WrappedWebSocket.__mwiTmWrapped = true;
    WrappedWebSocket.__mwiTmNative = NativeWebSocket;
    pageWindow.WebSocket = WrappedWebSocket;

    mainSiteState.isInstalled = true;
    return true;
  }

  // —— 合成行情（零操作兜底）——
  // 官方估算（WS market_item_values_updated 为全量快照；localStorage 键为主通道）
  // 只在主站侧可得，模拟器页拿不到。主站公开端点 game_data/marketplace.json 提供
  // 全物品 per-level 行情，MWITools 也主动拉取它（生产 6 小时一次）并在官方估算
  // 缺失时用其 (a+b)/2 作为 fair 值。这里拉取后合成中价估值，与官方估算合并透传
  //（真实值优先覆盖）。
  function isMainSiteHostname(hostname = pageWindow?.location?.hostname ?? '') {
    return /(^|\.)(milkywayidle\.com|milkywayidlecn\.com)$/.test(String(hostname || ''));
  }

  // —— 官方估算的 localStorage 来源（第 13 轮）——
  // 主站自己将全量官方估算（含 marketValuesVersion）写入 localStorage 键
  // "marketItemValues"，可能为明文 JSON 或 LZString 压缩串（UTF16 / Base64 形态）。
  // MWITools 启动即读此键（loadMarketItemValuesFromStorage），这就是它不浏览市场
  // 也有官方估算的原因。优先走主站自带的 localStorageUtil.getMarketItemValues()，
  // 失败再按明文 → UTF16 → Base64 依次尝试解压。以下为内嵌的 LZString 解压器
  //（lz-string 1.5.0 的 _decompress 忠实移植，仅风格现代化）。
  //
  // 第三方组件许可声明（依 MIT 许可证条款保留）：
  //   lz-string v1.5.0 —— https://github.com/pieroxy/lz-string
  //   Copyright (c) 2013 Pieroxy
  //   本文件包含该软件的实质性部分副本；MIT 许可证全文见
  //   https://raw.githubusercontent.com/pieroxy/lz-string/master/LICENSE.md
  //   （历史注释中的「WTFPL」系笔误：2026-08-31 经 npm registry 元数据
  //   https://registry.npmjs.org/lz-string/1.5.0 与上游 LICENSE.md 双源核证，
  //   lz-string 1.5.0 的许可证均为 MIT，本声明块即保留条款的履行。）
  function createLzStringDecompressor() {
    const fromCharCode = String.fromCharCode;
    const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const baseReverseDic = {};

    function getBaseValue(alphabet, character) {
      if (!baseReverseDic[alphabet]) {
        baseReverseDic[alphabet] = {};
        for (let i = 0; i < alphabet.length; i += 1) {
          baseReverseDic[alphabet][alphabet.charAt(i)] = i;
        }
      }
      return baseReverseDic[alphabet][character];
    }

    function lzDecompress(length, resetValue, getNextValue) {
      const dictionary = [];
      let enlargeIn = 4;
      let dictSize = 4;
      let numBits = 3;
      let entry = '';
      const result = [];
      let w;
      let bits;
      let resb;
      let maxpower;
      let power;
      let c;
      let next;
      const data = { val: getNextValue(0), position: resetValue, index: 1 };

      for (let i = 0; i < 3; i += 1) {
        dictionary[i] = i;
      }

      bits = 0;
      maxpower = Math.pow(2, 2);
      power = 1;
      while (power != maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch ((next = bits)) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2, 8);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          c = fromCharCode(bits);
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2, 16);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          c = fromCharCode(bits);
          break;
        case 2:
          return '';
      }
      dictionary[3] = c;
      w = c;
      result.push(c);
      while (true) {
        if (data.index > length) {
          return '';
        }

        bits = 0;
        maxpower = Math.pow(2, numBits);
        power = 1;
        while (power != maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position == 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }

        switch ((c = bits)) {
          case 0:
            bits = 0;
            maxpower = Math.pow(2, 8);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }

            dictionary[dictSize++] = fromCharCode(bits);
            c = dictSize - 1;
            enlargeIn--;
            break;
          case 1:
            bits = 0;
            maxpower = Math.pow(2, 16);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }
            dictionary[dictSize++] = fromCharCode(bits);
            c = dictSize - 1;
            enlargeIn--;
            break;
          case 2:
            return result.join('');
        }

        if (enlargeIn == 0) {
          enlargeIn = Math.pow(2, numBits);
          numBits++;
        }

        if (dictionary[c]) {
          entry = dictionary[c];
        } else {
          if (c === dictSize) {
            entry = w + w.charAt(0);
          } else {
            return null;
          }
        }
        result.push(entry);

        // Add w+entry[0] to the dictionary.
        dictionary[dictSize++] = w + entry.charAt(0);
        enlargeIn--;

        w = entry;

        if (enlargeIn == 0) {
          enlargeIn = Math.pow(2, numBits);
          numBits++;
        }
      }
    }

    function decompressFromUTF16(compressed) {
      if (compressed == null) return '';
      if (compressed == '') return null;
      return lzDecompress(compressed.length, 16384, (index) => compressed.charCodeAt(index) - 32);
    }

    function decompress(compressed) {
      if (compressed == null) return '';
      if (compressed == '') return null;
      return lzDecompress(compressed.length, 32768, (index) => compressed.charCodeAt(index));
    }

    function decompressFromBase64(input) {
      if (input == null) return '';
      if (input == '') return null;
      return lzDecompress(input.length, 32, (index) => getBaseValue(BASE64_ALPHABET, input.charAt(index)));
    }

    return { decompressFromUTF16, decompress, decompressFromBase64 };
  }

  // 读取主站 localStorage 中的官方估算（对齐 MWITools loadMarketItemValuesFromStorage）：
  // 优先主站自带 localStorageUtil.getMarketItemValues()（主站自己维护的解析封装），
  // 失败再读裸键并按 明文 JSON → UTF16 → 原生 → Base64 依次解压。返回形如
  // { marketValuesVersion, marketItemValues } 或 null。
  function readStoredMarketItemValues() {
    try {
      const viaUtil = pageWindow?.localStorageUtil?.getMarketItemValues?.();
      if (viaUtil && typeof viaUtil === 'object' && viaUtil.marketItemValues) {
        return viaUtil;
      }
    } catch (_error) {
      // localStorageUtil 不可用时回落到裸键。
    }

    let rawValue = null;
    try {
      rawValue = pageWindow?.localStorage?.getItem?.(MARKET_ITEM_VALUES_STORAGE_KEY) ?? null;
    } catch (_error) {
      return null;
    }
    if (!rawValue || typeof rawValue !== 'string') {
      return null;
    }

    const decompressor = createLzStringDecompressor();
    // 候选惰性求值、命中即停（2026-08-31 审计【性能 #7】）：数组字面量会立即
    // 求值全部元素，首个候选命中时其余 LZString 全量解压被无谓执行（且解压器
    // 对形态不匹配输入无 fail-fast，仍是全串逐位遍历）。候选顺序与语义不变：
    // 明文 → UTF16 → 原生 → Base64（对齐 MWITools parseStoredMarketItemValues）。
    const candidateProviders = [
      () => rawValue,
      () => decompressor.decompressFromUTF16(rawValue),
      () => decompressor.decompress(rawValue),
      () => decompressor.decompressFromBase64(rawValue),
    ];
    for (const provideCandidate of candidateProviders) {
      const candidate = provideCandidate();
      if (!candidate || typeof candidate !== 'string') {
        continue;
      }
      try {
        const parsed = JSON.parse(candidate);
        if (parsed?.marketItemValues) {
          return parsed;
        }
      } catch (_error) {
        // 该形态不是合法 JSON，尝试下一种。
      }
    }
    return null;
  }

  // 把 localStorage 中的官方估算合并进 WS 捕获缓存（物品/等级粒度，WS 已捕获值优先）。
  // 幂等：值无变化时不产生新对象引用；变更时整体替换 mainSiteState.marketItemValues
  // 引用（N3，2026-08-31：对已发布缓存对象原地写入，对 getMergedMarketItemValues
  // 记忆化的引用失效信号不可见，故构建新对象 + 末次整体赋值，为记忆化提供可靠失效信号）。
  // 【一般-1】（2026-09-02）：不再逐物品累积 spread——原写法下每次变更都整体复制累积
  // 对象，872 物品空缓存首合并为 O(n²)（~38 万次属性复制，主线程阻塞 ~50ms）；改为
  // 一次性顶层浅拷贝构建新对象，遍历中仅写该新对象，末次整体赋值，首合并降为 O(n)。
  function mergeStoredMarketItemValues() {
    const stored = readStoredMarketItemValues();
    if (!stored?.marketItemValues || typeof stored.marketItemValues !== 'object') {
      return false;
    }
    // 一次性顶层浅拷贝（【一般-1】）：next 为全新对象，原地写不会触碰已发布的缓存
    // 对象；未变更物品的 levels 映射与旧缓存共享引用（与订单簿合并分支同款），变更
    // 物品一律以新对象（mergedLevels / { ...levels }）整体替换该键。
    const next = { ...(mainSiteState.marketItemValues ?? {}) };
    let changed = false;
    for (const [itemHrid, levels] of Object.entries(stored.marketItemValues)) {
      // 跳过 '__proto__'（【一般-1】复核）：顶层写入由计算键改为普通赋值后，该键会
      // 命中 __proto__ 访问器改写缓存对象原型而非创建自有键（旧累积写法的计算键为
      // CreateDataProperty 语义）；物品 hrid 恒为 '/items/...' 形态，无合法数据损失。
      if (!itemHrid || itemHrid === '__proto__' || typeof levels !== 'object' || levels === null) {
        continue;
      }
      const existingLevels = next[itemHrid];
      if (existingLevels) {
        const mergedLevels = { ...existingLevels };
        let levelChanged = false;
        for (const [level, value] of Object.entries(levels)) {
          if (existingLevels[level] === undefined) {
            mergedLevels[level] = value;
            levelChanged = true;
          }
        }
        if (levelChanged) {
          next[itemHrid] = mergedLevels;
          changed = true;
        }
      } else {
        next[itemHrid] = { ...levels };
        changed = true;
      }
    }
    // 变更时整体替换引用（N3 记忆化的失效信号依赖此约定）；幂等时保持原引用。
    if (changed) {
      mainSiteState.marketItemValues = next;
    }
    return changed;
  }

  function getMarketplaceApiUrl(hostname = pageWindow?.location?.hostname ?? '') {
    const normalized = String(hostname || '');
    if (normalized.startsWith('test.')) {
      return 'https://test.milkywayidle.com/game_data/marketplace.json';
    }
    if (normalized.endsWith('milkywayidlecn.com')) {
      return 'https://milkywayidlecn.com/game_data/marketplace.json';
    }
    return 'https://www.milkywayidle.com/game_data/marketplace.json';
  }

  // 与 MWITools getFairValue 的行情 fallback 同口径：双边取 (ask+bid)/2，单边取单边；
  // 负值（无挂单哨兵 -1）与零视为缺失。等级键统一为非负整数字符串。
  function convertMarketDataToItemValues(marketData) {
    const converted = {};
    for (const [itemHrid, levels] of Object.entries(marketData ?? {})) {
      if (!itemHrid || typeof levels !== 'object' || levels === null) {
        continue;
      }
      const byLevel = {};
      for (const [level, record] of Object.entries(levels)) {
        const ask = Number(record?.a);
        const bid = Number(record?.b);
        const validAsk = Number.isFinite(ask) && ask > 0 ? ask : 0;
        const validBid = Number.isFinite(bid) && bid > 0 ? bid : 0;
        const mid = validAsk > 0 && validBid > 0 ? (validAsk + validBid) / 2 : Math.max(validAsk, validBid);
        if (mid > 0) {
          const levelNumber = Math.max(0, Math.floor(Number(level) || 0));
          byLevel[String(levelNumber)] = mid;
        }
      }
      if (Object.keys(byLevel).length > 0) {
        converted[itemHrid] = byLevel;
      }
    }
    return converted;
  }

  // 合并透传用：WS 真实官方估算优先，合成行情只补缺失的物品/等级。
  // 记忆化（N3，2026-08-31）：输入仅 mainSiteState.syntheticMarketItemValues 与
  // mainSiteState.marketItemValues 两个状态，二者变更均为整体替换新引用
  //（captureMarketItemValues 全量/订单簿两分支、fetchSyntheticMarketItemValues
  // 整体赋值、mergeStoredMarketItemValues 变更分支——按分支名标注，不写死行号），
  // 故以引用同一性作失效信号。返回共享缓存对象，调用方只读、不得修改。
  let mergedMarketItemValuesCache = null;
  let mergedCacheSyntheticRef = null;
  let mergedCacheOfficialRef = null;
  function getMergedMarketItemValues() {
    const syntheticRef = mainSiteState.syntheticMarketItemValues ?? null;
    const officialRef = mainSiteState.marketItemValues ?? null;
    if (
      mergedMarketItemValuesCache &&
      mergedCacheSyntheticRef === syntheticRef &&
      mergedCacheOfficialRef === officialRef
    ) {
      return mergedMarketItemValuesCache;
    }
    const merged = clonePlainObject(syntheticRef ?? {});
    for (const [itemHrid, levels] of Object.entries(officialRef ?? {})) {
      merged[itemHrid] = { ...(merged[itemHrid] ?? {}), ...(levels ?? {}) };
    }
    mergedMarketItemValuesCache = merged;
    mergedCacheSyntheticRef = syntheticRef;
    mergedCacheOfficialRef = officialRef;
    return merged;
  }

  // #18（2026-08-31）：混合载荷的逐件来源真值——merged 的键中不在官方估算缓存里的
  // 物品，其数值完全来自合成中价（合并优先级官方优先，官方覆盖的物品取官方值）。
  // 返回合成独有物品的 hrid 数组（只读）；仅载荷级标记为 'official' 时调用——
  // 标记 'synthetic' 时全部物品均为合成，清单冗余不挂。
  function collectSyntheticOnlyItemHrids(mergedMarketItemValues) {
    const officialKeys = new Set(Object.keys(mainSiteState.marketItemValues ?? {}));
    const syntheticOnly = [];
    for (const itemHrid of Object.keys(mergedMarketItemValues)) {
      if (!officialKeys.has(itemHrid)) {
        syntheticOnly.push(itemHrid);
      }
    }
    return syntheticOnly;
  }

  // 【一般-5】（2026-09-02）：等级级来源真值——物品级清单 syntheticItemHrids 只覆盖
  // 「整件合成」物品；混合物品（官方缓存命中该 hrid、但部分等级不在官方缓存内）的
  // 逐等级来源只能由本清单表达：{ [itemHrid]: [levelKey, ...] }，仅列出该物品中由
  // 合成行情补齐（官方缓存未覆盖）的等级键（合并语义官方优先，官方覆盖的等级取官方
  // 值、不会出现在清单中）。app 侧据此在 marketItemValueSourcesByLevel 建立等级级
  // 来源覆盖，tooltip / 可复制明细对合成补齐等级如实标「合成中价」。返回只读对象；
  // 仅载荷级标记为 'official' 时调用——纯 synthetic 载荷全部等级均为合成，清单冗余不挂。
  function collectSyntheticLevelKeys(mergedMarketItemValues) {
    const officialValues = mainSiteState.marketItemValues ?? {};
    const syntheticLevelKeys = {};
    for (const [itemHrid, levels] of Object.entries(mergedMarketItemValues ?? {})) {
      const officialLevels = officialValues[itemHrid];
      if (!officialLevels || typeof officialLevels !== 'object') {
        continue; // 整件合成物品已由 syntheticItemHrids 物品级清单覆盖
      }
      const levelKeys = [];
      for (const levelKey of Object.keys(levels ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(officialLevels, levelKey)) {
          levelKeys.push(levelKey);
        }
      }
      if (levelKeys.length > 0) {
        syntheticLevelKeys[itemHrid] = levelKeys;
      }
    }
    return syntheticLevelKeys;
  }

  async function fetchSyntheticMarketItemValues(force = false) {
    if (!isMainSiteHostname()) {
      return false;
    }
    const now = Date.now();
    if (mainSiteState.syntheticMarketFetchInFlight === true) {
      // 挂起中：不可视为「已就绪」（N5 语义修正——旧实现返回 true 会谎报成功，
      // 使基于返回值的重试判定失效）。重复请求由本守卫挡下，不会双发。
      return false;
    }
    if (
      !force &&
      mainSiteState.syntheticMarketFetchedAt > 0 &&
      now - mainSiteState.syntheticMarketFetchedAt < SYNTHETIC_MARKET_REFRESH_MS
    ) {
      return true;
    }
    if (typeof pageWindow.fetch !== 'function') {
      return false;
    }

    mainSiteState.syntheticMarketFetchInFlight = true;
    // 使用页面 realm 的 AbortController（pageWindow.AbortController）：其 signal 与
    // pageWindow.fetch 同 realm，避免 TM 沙箱 AbortSignal 跨上下文传给页面 fetch
    // 的兼容性隐患（#16）。typeof 门控保留：页面无 AbortController 时降级为无超时
    //（超时失效但不崩溃，与 catch/finally 结构自愈一致）。
    // 控制器/定时器创建放入 try 内：typeof 门控只确认是函数、不确认可构造，页面若
    // 把 AbortController 覆盖成不可 new 的实现，构造抛错也会被 catch 兜住并复位
    // inFlight（守卫不锁死，功能自愈；见下方降级契约测试）。
    let controller = null;
    let timeoutId = null;
    try {
      controller = typeof pageWindow.AbortController === 'function' ? new pageWindow.AbortController() : null;
      timeoutId =
        controller && typeof setTimeout === 'function'
          ? setTimeout(() => controller.abort(), SYNTHETIC_MARKET_FETCH_TIMEOUT_MS)
          : null;
      const url = getMarketplaceApiUrl();
      const response = await pageWindow.fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
      }
      const text = await response.text();
      const converted = convertMarketDataToItemValues(JSON.parse(text)?.marketData);
      const itemCount = Object.keys(converted).length;
      if (itemCount === 0) {
        throw new Error('marketData 为空');
      }
      mainSiteState.syntheticMarketItemValues = converted;
      mainSiteState.syntheticMarketFetchedAt = now;
      return true;
    } catch (_error) {
      return false;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      mainSiteState.syntheticMarketFetchInFlight = false;
    }
  }

  function buildCurrentMainSiteResponse(requestId, preferredLanguage = '') {
    const normalizedRequestId = String(requestId || '').trim();
    const payload = buildCurrentCharacterPayload();
    const characterName = normalizeCharacterName(payload?.character?.name || mainSiteState.currentCharacterName);
    const characterId = String(payload?.character?.id || '').trim();

    if (!payload || !characterName) {
      return {
        requestId: normalizedRequestId,
        ok: false,
        format: 'main-site-current-character',
        characterId: '',
        characterName: normalizeCharacterName(mainSiteState.currentCharacterName),
        message: getUiText('currentCharacterNotInitialized', preferredLanguage),
      };
    }

    return {
      requestId: normalizedRequestId,
      ok: true,
      format: 'main-site-current-character',
      characterId,
      characterName,
      payload,
    };
  }

  function buildTeamMemberResponse(member, preferredLanguage = '') {
    const rawCharacterId = Number(member?.characterId || 0);
    const characterId = Number.isFinite(rawCharacterId) && rawCharacterId > 0 ? String(rawCharacterId) : '';
    const characterName = normalizeCharacterName(member?.characterName || member?.name || '');
    const comparableCharacterName = normalizeComparableText(characterName);
    const isCurrent =
      member?.isCurrent === true ||
      (comparableCharacterName &&
        comparableCharacterName === normalizeComparableText(mainSiteState.currentCharacterName));

    if (isCurrent) {
      const currentResponse = buildCurrentMainSiteResponse('', preferredLanguage);
      return {
        format: String(currentResponse?.format || 'main-site-current-character'),
        characterName: normalizeCharacterName(currentResponse?.characterName || characterName) || characterName,
        characterId: String(currentResponse?.characterId || characterId).trim(),
        ok: currentResponse?.ok === true && currentResponse?.payload && typeof currentResponse.payload === 'object',
        message:
          currentResponse?.ok === true
            ? ''
            : normalizeErrorMessage(
                currentResponse?.message,
                getUiText('currentCharacterNotInitialized', preferredLanguage),
              ),
        payload: currentResponse?.ok === true ? currentResponse.payload : null,
      };
    }

    const cachedEntry = findCachedProfileEntry(characterId, characterName);
    if (!cachedEntry || !cachedEntry.payload) {
      return {
        characterName,
        characterId,
        ok: false,
        message: getUiText('openProfileInGameFirst', preferredLanguage),
        payload: null,
      };
    }

    return {
      format: 'shareable-profile',
      characterName: normalizeCharacterName(cachedEntry.characterName || characterName) || characterName,
      characterId: String(cachedEntry.characterId || characterId).trim(),
      ok: true,
      message: '',
      payload: buildCachedProfilePayload(cachedEntry.payload?.profile),
    };
  }

  function buildTeamProfilesResponse(
    requestIdPrefix,
    rosterSource,
    rosterMembers,
    preferredLanguage = '',
    extraPayload = {},
  ) {
    const normalizedMembers = (Array.isArray(rosterMembers) ? rosterMembers : [])
      .map((member) => {
        if (!member || typeof member !== 'object') {
          return null;
        }

        const characterName = normalizeCharacterName(member?.characterName || member?.name || '');
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
    const firstFailure = members.find((member) => member?.ok !== true && String(member?.message || '').trim());
    const firstFailureName = normalizeCharacterName(firstFailure?.characterName || '');
    return {
      ok: hasSuccess,
      message: hasSuccess
        ? ''
        : firstFailure
          ? `${firstFailureName || '-'}: ${String(firstFailure.message || '').trim()}`
          : getUiText('noMainSiteData', preferredLanguage),
      payload: {
        rosterSource,
        members,
        ...extraPayload,
      },
    };
  }

  async function requestTeamProfiles(requestId, preferredLanguage = '') {
    const requestIdPrefix = String(requestId || '').trim();
    if (!requestIdPrefix) {
      return null;
    }

    const teamContext = buildTeamRosterContext();
    const cacheMatch = readTeamRosterCache(teamContext);
    const gameStateResult = resolveTeamMemberNamesFromGameState();
    const wsPartyResult = resolveTeamMemberNamesFromRecentPartyMessages();
    // 已解析的 WebSocket 队伍名单本身就是队伍处于活动状态的有效证据：
    // 主站并不总是可靠地暴露 `mwi.game.state.partyInfo`，而且队伍战斗动作
    // 也不总是携带非零的 partyId。
    const hasActivePartyEvidence =
      Number(gameStateResult?.partyInfoMemberCount || 0) >= 2 ||
      Number(teamContext?.partyId || 0) > 0 ||
      (Array.isArray(wsPartyResult?.names) && wsPartyResult.names.length >= 2);
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

    if (selectedAutoDetectedRoster.names.length < 2 || selectedAutoDetectedRoster.source === 'request') {
      clearStaleTeamRosterState(teamContext.currentCharacterName);
      return null;
    }

    const extraPayload = {
      context: teamContext,
    };
    if (selectedAutoDetectedRoster.source !== 'cache') {
      extraPayload.resolvedFromPath = selectedAutoDetectedRoster.resolvedFromPath;
    }

    const rosterMembers =
      Array.isArray(selectedAutoDetectedRoster.members) && selectedAutoDetectedRoster.members.length > 0
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
      extraPayload,
    );
  }

  function writeMainSiteImportResponse(requestId, format, response, preferredLanguage = '') {
    const isTeamResponse = format === 'shareable-profile-team';
    const payload = response?.payload;
    GM_setValue(RESPONSE_KEY, {
      version: isTeamResponse ? 2 : 1,
      requestId,
      source: 'milkywayidle',
      format,
      ok: response?.ok === true,
      message:
        response?.ok === true
          ? ''
          : normalizeErrorMessage(response?.message, getUiText('unableToReadCurrentProfile', preferredLanguage)),
      characterId: isTeamResponse ? '' : String(response?.characterId || ''),
      characterName: isTeamResponse ? '' : String(response?.characterName || ''),
      exportedAt: Date.now(),
      payload: payload && typeof payload === 'object' ? payload : null,
    });
  }

  function initMainSiteBridge() {
    if (!installMainSiteSocketBridge()) {
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initMainSiteBridge, { once: true });
      }
      return;
    }

    // 官方估算优先走主站 localStorage（与 MWITools 同源，登录后即有全量）；
    // 该来源无值时再拉公开 marketplace.json 合成中价估值兜底。
    // 后续每次导入请求经 ensureMarketEstimatesFresh 惰性刷新（N2，2026-08-31）。
    // merge 返回 false 有双义（LS 无键 / 数据已全部存在）——与 ensureMarketEstimatesFresh
    // 同款双守卫（#19）：仅当官方估算缓存整体为空时才需要合成行情兜底，避免 WS 已捕获
    // 且 LS 全覆盖（merge 幂等返 false）时白拉一次合成行情。
    if (!mergeStoredMarketItemValues() && Object.keys(mainSiteState.marketItemValues ?? {}).length === 0) {
      fetchSyntheticMarketItemValues();
    }

    const handledRequestIds = new Set();

    // 每次导入请求时惰性刷新官方估算（N2，2026-08-31）：
    // 1) 主站 LS 键可能在 document-start 之后才写入（登录晚于脚本启动），每次请求补一次
    //    merge（幂等：无新增时不产生新引用、不触发下游失效）。
    // 2) merge 返回 false 有双义（LS 无键 / 数据已全部存在）——仅当官方估算缓存整体为空时
    //    才需要合成行情兜底，避免误触发 fetch。
    // 3) fetch 为 fire-and-forget：本次载荷可能仍缺合成行情，下一次导入请求（250ms 轮询窗
    //    之后）携带；fetch 失败后 syntheticMarketFetchedAt 不写，下次请求自然重试（退避 =
    //    导入频率），成功后 6 小时节流（SYNTHETIC_MARKET_REFRESH_MS）真实生效。
    function ensureMarketEstimatesFresh() {
      if (mergeStoredMarketItemValues()) {
        return;
      }
      if (Object.keys(mainSiteState.marketItemValues ?? {}).length === 0) {
        fetchSyntheticMarketItemValues();
      }
    }

    function processImportRequest(rawValue) {
      const request = rawValue && typeof rawValue === 'object' ? rawValue : null;
      const requestId = String(request?.requestId || '').trim();
      if (!requestId || handledRequestIds.has(requestId)) {
        return false;
      }

      handledRequestIds.add(requestId);
      // 请求驱动的惰性刷新（N2）：在响应构建前执行，单人分支同步构建的载荷
      // 即可携带本次 merge 结果；旧 requestId 已被去重逻辑挡下，不会重复触发。
      ensureMarketEstimatesFresh();

      const preferredLanguage = resolveUiLanguage(request?.language);
      const target = String(request?.target || 'active-player')
        .trim()
        .toLowerCase();

      if (target === 'auto') {
        requestTeamProfiles(requestId, preferredLanguage).then((teamResponse) => {
          if (Array.isArray(teamResponse?.payload?.members) && teamResponse.payload.members.length > 0) {
            writeMainSiteImportResponse(requestId, 'shareable-profile-team', teamResponse, preferredLanguage);
            return;
          }

          writeMainSiteImportResponse(
            requestId,
            'main-site-current-character',
            buildCurrentMainSiteResponse(requestId, preferredLanguage),
            preferredLanguage,
          );
        });
        return true;
      }

      writeMainSiteImportResponse(
        requestId,
        'main-site-current-character',
        buildCurrentMainSiteResponse(requestId, preferredLanguage),
        preferredLanguage,
      );

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
      statusTone: 'idle',
      statusText: '',
      statusTextKey: '',
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

      const importMode = String(button.dataset.importMode || 'player');
      const buttonTextKey =
        importMode === 'enhancement' ? 'enhancementButton' : importMode === 'skilling' ? 'skillingButton' : 'button';
      button.textContent = getUiText(buttonTextKey, state.uiLanguage);
      status.textContent = state.statusTextKey
        ? getUiText(state.statusTextKey, state.uiLanguage)
        : String(state.statusText || '');
      status.className =
        state.statusTone === 'error'
          ? 'text-xs text-destructive'
          : state.statusTone === 'success'
            ? 'text-xs text-success'
            : 'text-xs text-muted-foreground';
      button.disabled = state.isRequestPending;
    }

    function setStatus(text, tone = 'idle') {
      state.statusTone = tone;
      state.statusText = String(text || '');
      state.statusTextKey = '';
      renderControlState();
    }

    function setStatusKey(statusTextKey, tone = 'idle') {
      state.statusTone = tone;
      state.statusText = '';
      state.statusTextKey = String(statusTextKey || '');
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

    async function requestMainSiteImport(requestId, target = 'auto') {
      GM_setValue(REQUEST_KEY, {
        version: 2,
        requestId,
        createdAt: Date.now(),
        target,
        language: state.uiLanguage,
      });

      return waitForSharedValue(RESPONSE_KEY, requestId, REQUEST_TIMEOUT_MS);
    }

    async function importPayloadIntoSimulator(requestId, payload, options = {}) {
      const responsePromise = waitForWindowMessage(
        APP_BRIDGE_CHANNEL,
        'mwi-tm-import-result',
        requestId,
        APP_IMPORT_TIMEOUT_MS,
      );
      const safeOptions = options && typeof options === 'object' ? options : {};
      const format = String(safeOptions.format || 'shareable-profile').trim() || 'shareable-profile';
      const { format: _ignoredFormat, ...messageOptions } = safeOptions;

      pageWindow.postMessage(
        {
          ...messageOptions,
          channel: APP_BRIDGE_CHANNEL,
          type: 'mwi-tm-import',
          requestId,
          format,
          payload,
        },
        window.location.origin,
      );

      return responsePromise;
    }

    function isTeamImportResponse(response) {
      return (
        String(response?.format || '') === 'shareable-profile-team' &&
        response?.payload &&
        typeof response.payload === 'object'
      );
    }

    function persistImportedTeamRoster(teamPayload, members) {
      const cacheContext = teamPayload?.context;
      const cacheNames = (Array.isArray(members) ? members : [])
        .map((member) => normalizeCharacterName(member?.characterName || ''))
        .filter(Boolean);
      if (cacheNames.length < 2) {
        return;
      }

      persistTeamRosterCache(cacheContext, cacheNames);
    }

    async function importSingleMainSiteResponse(mainSiteResponse, requestId) {
      if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      setStatusKey('importingSimulator', 'idle');
      const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
        clearOtherPlayers: true,
        resetTeamSelection: true,
        selectAfterImport: true,
        activateAfterImport: true,
        format: String(mainSiteResponse?.format || 'shareable-profile'),
      });
      if (!appResponse || appResponse.ok !== true) {
        throw new Error(appResponse?.message || getUiText('simulatorImportFailed', state.uiLanguage));
      }

      // 成功反馈附带官方估值计数：必须数导入载荷实际携带的数量，不能数本页缓存——
      // 模拟器页脚本实例与主站不同源，本页 merged 缓存恒为空，会误报「0 个物品」。
      // 0 个物品时用户能立刻发现透传为空（资产分将降级挂单价），
      // 而不是等到 tooltip 全是挂单价才排查。
      setStatus(
        `${getUiText('importSuccess', state.uiLanguage)} ${describeMarketItemValuesStatus(mainSiteResponse.payload)}`,
        'success',
      );
    }

    async function importEnhancementMainSiteResponse(mainSiteResponse, requestId) {
      if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      setStatusKey('importingSimulator', 'idle');
      const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
        importTarget: 'enhancement',
        format: String(mainSiteResponse?.format || 'main-site-current-character'),
      });
      if (!appResponse || appResponse.ok !== true) {
        throw new Error(appResponse?.message || getUiText('simulatorImportFailed', state.uiLanguage));
      }

      setStatusKey('importSuccess', 'success');
    }

    async function importSkillingMainSiteResponse(mainSiteResponse, requestId) {
      if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      setStatusKey('importingSimulator', 'idle');
      const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
        importTarget: 'skilling',
        format: String(mainSiteResponse?.format || 'main-site-current-character'),
      });
      if (!appResponse || appResponse.ok !== true) {
        throw new Error(appResponse?.message || getUiText('simulatorImportFailed', state.uiLanguage));
      }

      setStatusKey('importSuccess', 'success');
    }

    async function importTeamMainSiteResponse(mainSiteResponse) {
      const payload = mainSiteResponse?.payload;
      const members = Array.isArray(payload?.members) ? payload.members : [];
      if (members.length === 0) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      const failureEntries = [];
      for (const member of members) {
        if (!member || typeof member !== 'object' || member.ok === true) {
          continue;
        }

        failureEntries.push({
          name: String(member.characterName || '').trim() || '-',
          message: String(member.message || '').trim() || getUiText('importFailed', state.uiLanguage),
        });
      }

      const successfulMembers = members.filter((member) => {
        return (
          member &&
          typeof member === 'object' &&
          member.ok === true &&
          member.payload &&
          typeof member.payload === 'object'
        );
      });

      if (successfulMembers.length === 0) {
        const firstFailure = failureEntries[0];
        throw new Error(
          firstFailure
            ? `${firstFailure.name}: ${firstFailure.message}`
            : mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage),
        );
      }

      setStatusKey('importingSimulator', 'idle');

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
          activateAfterImport: false,
          format: String(member?.format || 'shareable-profile'),
        });

        if (!appResponse || appResponse.ok !== true) {
          failureEntries.push({
            name: String(member.characterName || '').trim() || `Player ${targetPlayerId}`,
            message: String(appResponse?.message || '').trim() || getUiText('simulatorImportFailed', state.uiLanguage),
          });
          continue;
        }

        didClearTeamSlots = true;
        didResetTeamSelection = true;
        importedCount += 1;
      }

      if (importedCount <= 0) {
        const firstFailure = failureEntries[0];
        throw new Error(
          firstFailure ? `${firstFailure.name}: ${firstFailure.message}` : getUiText('importFailed', state.uiLanguage),
        );
      }

      persistImportedTeamRoster(payload, members);

      // 团队导入成功反馈同样附带官方估值计数，与单人路径（importSingleMainSiteResponse）
      // 口径一致：数导入载荷实际携带的 marketItemValues——各成功 member 载荷挂的是
      // 同一份 merged 快照（getMergedMarketItemValues 记忆化共享缓存），取任一成功
      // member 计数即可；merged 为空时全部 member 都不带该字段，如实显示「0 个物品
      // （资产分将使用挂单价）」，让透传故障（脚本未登录 / LS 无键 / fetch 失败）在
      // 导入瞬间可见，而非等 tooltip 全是挂单价才排查（第 20 轮修复目标，团队路径
      // 此前缺失该反馈）。文案拼接收敛到顶层可注入纯函数 buildTeamImportFeedbackText
      //（#22），此处仅接线调用，行为断言在测试侧覆盖；summary 为空 = 全部成功。
      const feedbackText = buildTeamImportFeedbackText({
        uiLanguage: state.uiLanguage,
        summary:
          failureEntries.length === 0 ? '' : formatTeamImportSummary(importedCount, failureEntries, state.uiLanguage),
        firstSuccessPayload: successfulMembers[0]?.payload,
      });
      setStatus(feedbackText, 'success');
    }

    async function handleImportButtonClick(importMode = 'player') {
      if (state.isRequestPending) {
        return;
      }

      const requestId = createRequestId();
      state.isRequestPending = true;
      setStatusKey('waitingMainSite', 'idle');

      try {
        const normalizedImportMode = importMode === 'enhancement' || importMode === 'skilling' ? importMode : 'player';
        const mainSiteResponse = await requestMainSiteImport(
          requestId,
          normalizedImportMode === 'player' ? 'auto' : 'active-player',
        );
        if (normalizedImportMode === 'enhancement') {
          await importEnhancementMainSiteResponse(mainSiteResponse, requestId);
        } else if (normalizedImportMode === 'skilling') {
          await importSkillingMainSiteResponse(mainSiteResponse, requestId);
        } else if (isTeamImportResponse(mainSiteResponse)) {
          await importTeamMainSiteResponse(mainSiteResponse);
        } else {
          await importSingleMainSiteResponse(mainSiteResponse, requestId);
        }
      } catch (error) {
        setStatus(normalizeErrorMessage(error, getUiText('importFailed', state.uiLanguage)), 'error');
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
      const skillingActionBar = document.querySelector('[data-tm-import-anchor="skilling-actions"]');
      const enhancementActionBar = document.querySelector('[data-tm-import-anchor="enhancement-actions"]');
      const actionBar =
        skillingActionBar ||
        enhancementActionBar ||
        document.querySelector('[data-tm-import-anchor="simulator-home-actions"]');
      if (!actionBar) {
        return;
      }

      const importMode = skillingActionBar ? 'skilling' : enhancementActionBar ? 'enhancement' : 'player';
      const referenceButton = actionBar.querySelector(
        importMode === 'enhancement'
          ? '[data-tm-import-reference="enhancement-refresh"]'
          : importMode === 'skilling'
            ? '[data-tm-import-reference="skilling-refresh"]'
            : '[data-tm-import-reference="import-export"]',
      );
      if (document.getElementById(CONTROL_ID)) {
        return;
      }

      const wrapper = document.createElement('span');
      wrapper.id = CONTROL_ID;
      wrapper.className = 'inline-flex items-center gap-2';

      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.dataset.importMode = importMode;
      const buttonTextKey =
        importMode === 'enhancement' ? 'enhancementButton' : importMode === 'skilling' ? 'skillingButton' : 'button';
      button.textContent = getUiText(buttonTextKey, state.uiLanguage);
      button.className = 'button-tool';
      button.addEventListener('click', () => handleImportButtonClick(importMode));

      const status = document.createElement('span');
      status.id = STATUS_ID;
      status.className = 'text-xs text-muted-foreground';
      status.textContent = '';

      wrapper.appendChild(button);
      wrapper.appendChild(status);

      if (referenceButton && referenceButton.nextSibling) {
        actionBar.insertBefore(wrapper, referenceButton.nextSibling);
      } else {
        actionBar.appendChild(wrapper);
      }

      syncControlLanguage(true);
      setStatus('', 'idle');
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

      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
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
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  function shouldInstallDebugInterface() {
    try {
      const searchParams = new URLSearchParams(String(window.location?.search || ''));
      if (isTruthyDebugFlag(searchParams.get(DEBUG_QUERY_PARAM))) {
        return true;
      }
    } catch (_error) {}

    try {
      if (isTruthyDebugFlag(window.localStorage?.getItem(DEBUG_STORAGE_KEY))) {
        return true;
      }
    } catch (_error) {}

    const hostname = String(window.location?.hostname || '')
      .trim()
      .toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1';
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
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow !== window) {
      targets.push(unsafeWindow);
    }

    for (const target of targets) {
      try {
        Object.defineProperty(target, '__mwiImportDebug', {
          configurable: true,
          value: frozenDebugApi,
          writable: false,
        });
      } catch (_error) {}
    }
  }

  installDebugInterface();

  if (isMainSitePage()) {
    initMainSiteBridge();
    initMainSiteSimulatorShortcut();
    initMainSiteProfileCopyButton();
  }

  if (isSimulatorPage()) {
    initSimulatorImportButton();
  }
})();
