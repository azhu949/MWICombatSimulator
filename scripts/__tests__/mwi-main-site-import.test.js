import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const scriptSource = readFileSync(new URL('../mwi-main-site-import.user.js', import.meta.url), 'utf8');

// 从 @version 元数据动态提取版本号，避免发版时硬编码断言失步。
// ^ 锚定行首 + m 标志：只匹配元数据块中的 @version 行，避免误匹配脚本正文
// 中可能出现的 // @version 注释。
const scriptVersionMatch = scriptSource.match(/^\/\/\s*@version\s+(\S+)/m);
const scriptVersion = scriptVersionMatch?.[1] || '';

function loadScriptTestApi({ console: consoleStub = console, mainSiteMode = false } = {}) {
  const gmStore = new Map();
  const sandboxWindow = {
    location: {
      hostname: 'example.test',
      origin: 'https://example.test',
      search: '',
    },
    localStorage: {
      getItem() {
        return null;
      },
    },
  };
  const pageWindow = {
    // fetchSyntheticMarketItemValues（#16）改用 pageWindow.AbortController 取页面
    // realm 的信号源：注入宿主实现模拟「页面提供 AbortController」的真实主站形态，
    // 使超时中止用例（options.signal.addEventListener('abort')）走 controller 非空分支。
    AbortController,
    mwi: {
      game: {
        state: {
          character: {
            id: 101,
            name: 'Current Player',
          },
        },
      },
    },
  };
  if (mainSiteMode) {
    // N2 端到端装置（2026-08-31）：桥接安装需要 WebSocket 构造器；请求轮询的
    // setInterval 换成可手动驱动的收集器（不跑真实定时器，测试直接调用回调）。
    // 注意 hostname 保持 example.test，避免脚本尾部自动 init 连带执行 DOM 相关初始化。
    pageWindow.WebSocket = function StubWebSocket() {};
    sandboxWindow.__pollCallbacks = [];
    sandboxWindow.setInterval = (callback) => {
      sandboxWindow.__pollCallbacks.push(callback);
      return sandboxWindow.__pollCallbacks.length;
    };
    sandboxWindow.clearInterval = () => {};
  }
  const marker = '  installDebugInterface();';
  const exposedSource = scriptSource.replace(
    marker,
    `    globalThis.__mwiImportTestApi = {
        hasStructuredPartyInfoFieldHints,
        getFreshRecentPartyMessages,
        getStructuredPartyInfoSources,
        rememberRecentPartyMessage,
        getGameStatePartyInfoSources,
        resolveTeamMemberNamesFromGameState,
        resolveTeamMemberNamesFromRecentPartyMessages,
        selectAutoDetectedTeamRoster,
        captureCurrentCharacterState,
        hasCurrentCharacterSnapshot,
        buildCurrentCharacterPayload,
        buildCurrentMainSiteResponse,
        readCharacterNameCandidate,
        instrumentMainSiteSocket,
        isTrustedBridgeMessageSource,
        isTrustedBridgeMessageEvent,
        extractSharedProfileCharacterId,
        extractSharedProfileName,
        isLikelyProfileDialog,
        pickBestProfileDialogCandidate,
        resolveProfileCopyMountAction,
        resolveProfileDialogScanGate,
        mainSiteState,
        RECENT_PARTY_MESSAGE_MAX_AGE_MS,
        buildProfileExportPayload,
        describeMarketItemValuesStatus,
        convertMarketDataToItemValues,
        getMergedMarketItemValues,
        getMarketplaceApiUrl,
        fetchSyntheticMarketItemValues,
        isMainSiteHostname,
        readStoredMarketItemValues,
        mergeStoredMarketItemValues,
        createLzStringDecompressor,
        initMainSiteBridge,
        buildCachedProfilePayload,
        persistProfileCacheEntry,
        buildTeamImportFeedbackText,
        formatTeamImportSummary,
    };

${marker}`,
  );

  if (exposedSource === scriptSource) {
    throw new Error(
      `Failed to inject the test API: marker ${JSON.stringify(marker)} was not found in mwi-main-site-import.user.js. ` +
        'Update the marker if the call site or its indentation changed.',
    );
  }

  const context = {
    console: consoleStub,
    // resolveUiLanguage 会读取 document.documentElement.lang；主站页面脚本默认 zh。
    document: {
      documentElement: {
        lang: 'zh',
      },
    },
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
    // vm 沙箱默认无宿主定时器全局：fetchSyntheticMarketItemValues 的 15s 超时定时器
    //（N5）依赖 setTimeout/clearTimeout，注入宿主实现（fake timers 生效时为 fake 版本）。
    // AbortController 自 #16 起经 pageWindow.AbortController 注入（页面 realm 信号源，
    // 见上方 pageWindow mock），vm 层不再需要。
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };

  runInNewContext(exposedSource, context);

  return {
    api: context.__mwiImportTestApi,
    console: consoleStub,
    gmStore,
    pageWindow,
    sandboxWindow,
  };
}

function createPartyInfo(names = ['Current Player', 'Party Member']) {
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

describe('mwi main-site import userscript', () => {
  it('captures enhancement-related current-character snapshot fields', () => {
    expect(scriptSource).toContain("'communityBuffs'");
    expect(scriptSource).toContain("'communityActionTypeBuffsMap'");
    expect(scriptSource).toContain("'achievementActionTypeBuffsMap'");
    expect(scriptSource).toContain("type === 'skills_updated'");
    expect(scriptSource).toContain("type === 'items_updated'");
    expect(scriptSource).toContain("type === 'house_rooms_updated'");
    expect(scriptSource).toContain("type === 'achievements_updated'");
    expect(scriptSource).toContain("type === 'community_buffs_updated'");
    expect(scriptSource).toContain("'characterGuildBuffMap'");
    expect(scriptSource).toContain("'guildBuildingLevelMap'");
    expect(scriptSource).toContain("type === 'guild_buffs_updated'");
    expect(scriptSource).toContain("type === 'guild_updated'");
    expect(scriptSource).toContain("if (reset || type === 'guild_buffs_updated')");
    expect(scriptSource).toContain("nextFields.characterGuildBuffMap = hasOwnKey(message, 'characterGuildBuffMap')");
    expect(scriptSource).toContain("if (reset || type === 'guild_updated')");
    expect(scriptSource).toContain("nextFields.guildBuildingLevelMap = hasOwnKey(message, 'guildBuildingLevelMap')");
    expect(scriptSource).toContain("'houseActionTypeBuffsMap'");
    expect(scriptSource).toContain("'personalActionTypeBuffsMap'");
    expect(scriptSource).toContain("'mooPassActionTypeBuffsMap'");
    expect(scriptSource).toContain("type === 'personal_buffs_updated'");
    expect(scriptSource).toContain("type === 'moo_pass_buffs_updated'");
    expect(scriptSource).toContain('captureCurrentCharacterDataUpdate(parsed);');
  });

  it('uses a current-character-only request and enhancement bridge target on the enhancement page', () => {
    expect(scriptSource).toContain('data-tm-import-anchor="enhancement-actions"');
    expect(scriptSource).toContain("normalizedImportMode === 'player' ? 'auto' : 'active-player'");
    expect(scriptSource).toContain("importTarget: 'enhancement'");
    expect(scriptSource).toContain("enhancementButton: '导入角色强化配置'");
    // 版本号从 @version 元数据动态提取，发版无需同步更新测试。
    // 先断言存在再匹配格式，避免 scriptVersion 为空时只报「不匹配」而看不出根因。
    expect(scriptVersion).toBeTruthy();
    expect(scriptVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('uses the migrated toolbar button and semantic status classes', () => {
    expect(scriptSource).toContain("button.className = 'button-tool';");
    expect(scriptSource).not.toContain('action-button-tool');
    expect(scriptSource).toContain("'text-xs text-destructive'");
    expect(scriptSource).toContain("'text-xs text-success'");
    expect(scriptSource).toContain("'text-xs text-muted-foreground'");
    expect(scriptSource).not.toContain('text-rose-300');
    expect(scriptSource).not.toContain('text-teal-200');
    expect(scriptSource).not.toContain('text-cyan-200');
  });

  it('uses the current character and skilling bridge target on the skilling page', () => {
    expect(scriptSource).toContain('data-tm-import-anchor="skilling-actions"');
    expect(scriptSource).toContain('data-tm-import-reference="skilling-refresh"');
    expect(scriptSource).toContain("importTarget: 'skilling'");
    expect(scriptSource).toContain("skillingButton: '导入生活技能快照'");
  });

  it('accepts bridge responses only from the sandbox or page window on the same origin', () => {
    const { api, pageWindow, sandboxWindow } = loadScriptTestApi();

    expect(api.isTrustedBridgeMessageEvent({ source: sandboxWindow, origin: sandboxWindow.location.origin })).toBe(
      true,
    );
    expect(api.isTrustedBridgeMessageEvent({ source: pageWindow, origin: sandboxWindow.location.origin })).toBe(true);
    expect(api.isTrustedBridgeMessageEvent({ source: {}, origin: sandboxWindow.location.origin })).toBe(false);
    expect(api.isTrustedBridgeMessageEvent({ source: pageWindow, origin: 'https://attacker.example' })).toBe(false);
    expect(scriptSource).toMatch(/pageWindow\.postMessage\(\s*\{[\s\S]*?channel:\s*APP_BRIDGE_CHANNEL,?/);
  });

  it('pre-filters websocket messages before structurally scanning nested party payloads', () => {
    const { api, gmStore } = loadScriptTestApi();
    const partyInfo = createPartyInfo();
    const partyMessage = {
      type: 'party_updated',
      envelope: {
        nestedPartyState: partyInfo,
      },
    };

    expect(api.hasStructuredPartyInfoFieldHints(JSON.stringify({ type: 'combat_tick', payload: { damage: 12 } }))).toBe(
      false,
    );
    expect(api.hasStructuredPartyInfoFieldHints(JSON.stringify(partyMessage))).toBe(true);
    expect(api.getStructuredPartyInfoSources(partyMessage).map((entry) => entry.path)).toEqual([
      'envelope.nestedPartyState',
    ]);

    const listeners = new Map();
    const socket = {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    };
    api.instrumentMainSiteSocket(socket);
    listeners.get('message')({
      data: JSON.stringify({ type: 'combat_tick', payload: { damage: 12 } }),
    });
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);

    listeners.get('message')({ data: JSON.stringify(partyMessage) });
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(1);

    const cachedRoster = {
      exact: {
        'current player|42|/actions/combat/test|1': {
          characterNames: ['Current Player', 'Party Member'],
          updatedAt: 1_000_000,
        },
      },
      loose: {},
    };
    api.mainSiteState.currentCharacterName = 'Current Player';
    gmStore.set('mwi.tm.import.teamRosterCache.v1', cachedRoster);

    // 关闭最后一个套接字只能丢弃内存中的名单：重连会关闭所有套接字，
    // 因此持久化缓存必须保留下来，才能保证队伍导入完好无损。
    listeners.get('close')();
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);
    expect(gmStore.get('mwi.tm.import.teamRosterCache.v1')).toEqual(cachedRoster);
  });

  it('invalidates old websocket rosters on an empty party snapshot and after the TTL', () => {
    const { api, gmStore } = loadScriptTestApi();
    const receivedAt = 1_000_000;

    api.mainSiteState.currentCharacterName = 'Current Player';
    gmStore.set('mwi.tm.import.teamRosterCache.v1', {
      exact: {
        'current player|42|/actions/combat/test|1': {
          characterNames: ['Current Player', 'Party Member'],
          updatedAt: receivedAt,
        },
      },
      loose: {
        'current player|/actions/combat/test|1': {
          characterNames: ['Current Player', 'Party Member'],
          updatedAt: receivedAt,
        },
      },
    });

    api.rememberRecentPartyMessage({ payload: createPartyInfo() }, receivedAt);
    expect(api.resolveTeamMemberNamesFromRecentPartyMessages(receivedAt).names).toEqual([
      'Current Player',
      'Party Member',
    ]);

    api.rememberRecentPartyMessage(
      {
        payload: {
          partySlotMap: {},
          sharableCharacterMap: {},
        },
      },
      receivedAt + 1,
    );
    expect(api.resolveTeamMemberNamesFromRecentPartyMessages(receivedAt + 1).names).toEqual([]);
    expect(gmStore.get('mwi.tm.import.teamRosterCache.v1')).toEqual({ exact: {}, loose: {} });

    api.rememberRecentPartyMessage({ payload: createPartyInfo() }, receivedAt + 2);
    const expiredAt = receivedAt + 2 + api.RECENT_PARTY_MESSAGE_MAX_AGE_MS + 1;
    expect(api.resolveTeamMemberNamesFromRecentPartyMessages(expiredAt).names).toEqual([]);
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);
  });

  it('keeps websocket rosters ahead of cache candidates when websocket evidence unlocks fallbacks', () => {
    const { api } = loadScriptTestApi();
    const selected = api.selectAutoDetectedTeamRoster({
      allowFallbackSources: true,
      cacheMatch: {
        exactCharacterNames: ['Cached Player', 'Cached Member'],
      },
      gameStateResult: {
        partyInfoMembers: [],
        partyInfoNames: [],
      },
      wsPartyResult: {
        members: [],
        names: ['Current Player', 'Party Member'],
      },
    });

    expect(selected.source).toBe('ws-party');
    expect(selected.names).toEqual(['Current Player', 'Party Member']);
  });

  it('deduplicates direct party info and keeps the most informative debug source', () => {
    const { api, pageWindow } = loadScriptTestApi();
    const directPartyInfo = createPartyInfo();

    expect(api.getGameStatePartyInfoSources({ partyInfo: directPartyInfo })).toHaveLength(1);

    const nestedPartyInfo = createPartyInfo(['Current Player']);
    pageWindow.mwi.game.state = {
      character: {
        id: 101,
        name: 'Current Player',
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

  it('keeps pure-number character names in team roster resolution', () => {
    const { api, pageWindow } = loadScriptTestApi();
    // 数字名队友（id 102，非当前角色）没有 isCurrentById 回退保护：
    // 名字被当作「不像角色名」过滤时会直接从名单消失。
    pageWindow.mwi.game.state = {
      character: {
        id: 101,
        name: 'Alice',
      },
      partyInfo: createPartyInfo(['Alice', '123456']),
    };

    const result = api.resolveTeamMemberNamesFromGameState();
    expect(result.partyInfoNames).toEqual(['Alice', '123456']);
    expect(result.partyInfoMembers.map((member) => member.characterId)).toEqual([101, 102]);
  });

  it('builds a main-site current-character response for a pure-number character name', () => {
    const { api } = loadScriptTestApi();
    const message = {
      type: 'init_character_data',
      character: { id: 101, name: '123456' },
      characterSkills: [{ skillHrid: '/skills/melee', level: 42 }],
      characterItems: [{ itemHrid: '/items/basic_sword', count: 1 }],
      combatUnit: {},
      actionTypeFoodSlotsMap: { food: {} },
      actionTypeDrinkSlotsMap: { drink: {} },
    };
    api.captureCurrentCharacterState(JSON.parse(JSON.stringify(message)));

    expect(api.hasCurrentCharacterSnapshot()).toBe(true);
    const response = api.buildCurrentMainSiteResponse('numeric-name-request');
    expect(response.ok).toBe(true);
    expect(response.format).toBe('main-site-current-character');
    expect(response.characterName).toBe('123456');
    expect(response.payload?.character?.name).toBe('123456');
    expect(api.readCharacterNameCandidate({ name: '123456' })).toBe('123456');
    expect(api.readCharacterNameCandidate({ name: 'Hero' })).toBe('Hero');
  });

  it('rejects non-name noise samples while keeping pure-number character names legal', () => {
    const { api, pageWindow } = loadScriptTestApi();
    pageWindow.mwi.game.state = {
      character: { id: 101, name: 'Alice' },
    };

    // 删除纯数字排斥后，剩余过滤器是结构噪声的唯一名字级防线：逐类回归拦截能力。
    expect(api.readCharacterNameCandidate({ name: '' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: '   ' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: '/actions/combat' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: '2024-05-06T07:08:09Z' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: '2024-05-06T07:08:09.123Z' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: '{"count":3}' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: '[1,2]' })).toBe('');
    expect(api.readCharacterNameCandidate({ name: 'SystemChatMessage.party' })).toBe('');
    // 对照边界：裸数字名本身合法、必须放行（与上一用例正例互补）；
    // 对裸数字噪声的拦截职责已由下方队伍结构护栏接管。
    expect(api.readCharacterNameCandidate({ name: '42' })).toBe('42');

    // 噪声样本①：计数播报式单槽快照（成员 <2）不得入选名单记忆。
    api.rememberRecentPartyMessage(
      {
        payload: {
          partySlotMap: { 1: { characterID: 999, id: 1, isLeader: true } },
          sharableCharacterMap: { 999: { name: '42' } },
        },
      },
      1_000_000,
    );
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(0);
    expect(api.resolveTeamMemberNamesFromRecentPartyMessages(1_000_000).names).toEqual([]);

    // 噪声样本②：双槽裸数字（当前角色不在场）——名字过滤放行，
    // 但「当前角色必须在场」护栏拒绝凭空造名单。
    api.rememberRecentPartyMessage(
      {
        payload: {
          partySlotMap: {
            1: { characterID: 901, id: 1, isLeader: true },
            2: { characterID: 902, id: 2, isLeader: false },
          },
          sharableCharacterMap: { 901: { name: '3' }, 902: { name: '7' } },
        },
      },
      1_000_001,
    );
    // 快照已入选记忆（≥2 成员护栏放行）：names 为空必须归因于解析层护栏，
    // 断言在场数防止记忆层未来收紧时用例退化为真空通过。
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(1);
    expect(api.resolveTeamMemberNamesFromRecentPartyMessages(1_000_001).names).toEqual([]);

    // 噪声样本③：真实队伍结构中混入系统消息式噪声名——被剩余过滤器剔除后
    // 名单不足 2 人，不得降级成含噪声名单。
    api.rememberRecentPartyMessage(
      {
        payload: {
          partySlotMap: {
            1: { characterID: 101, id: 1, isLeader: true },
            2: { characterID: 902, id: 2, isLeader: false },
          },
          sharableCharacterMap: {
            101: { name: 'Alice' },
            902: { name: 'SystemChatMessage.combat_tick' },
          },
        },
      },
      1_000_002,
    );
    // 同上：两个噪声快照均在记忆中，names 为空归因于过滤器剔除 + 名单 <2 护栏。
    expect(api.mainSiteState.recentPartyMessages).toHaveLength(2);
    expect(api.resolveTeamMemberNamesFromRecentPartyMessages(1_000_002).names).toEqual([]);

    // 噪声样本④：同一双槽裸数字噪声从 game-state 路径进入（partyInfo 直挂游戏状态）。
    // 两条入口路径接线独立（与 WS 路径仅共享解析核心）：防止未来重构绕过
    // 其中一侧护栏时，只有 WS 侧用例报警而 game-state 侧静默放行。
    pageWindow.mwi.game.state = {
      character: { id: 101, name: 'Alice' },
      partyInfo: {
        partySlotMap: {
          1: { characterID: 901, id: 1, isLeader: true },
          2: { characterID: 902, id: 2, isLeader: false },
        },
        sharableCharacterMap: { 901: { name: '3' }, 902: { name: '7' } },
      },
    };
    const gameStateResult = api.resolveTeamMemberNamesFromGameState();
    expect(gameStateResult.partyInfoNames).toEqual([]);
    expect(gameStateResult.partyInfoMembers).toEqual([]);
  });

  it('extracts the sharable character id from profile variants', () => {
    const { api } = loadScriptTestApi();

    expect(api.extractSharedProfileCharacterId({ sharableCharacter: { id: 42 } })).toBe('42');
    expect(api.extractSharedProfileCharacterId({ sharableCharacter: { characterID: 43 } })).toBe('43');
    expect(api.extractSharedProfileCharacterId({ sharableCharacter: { characterId: 44 } })).toBe('44');
    expect(api.extractSharedProfileCharacterId({ characterId: 45 })).toBe('45');
    expect(api.extractSharedProfileCharacterId({ sharableCharacter: {} })).toBe('');
    expect(api.extractSharedProfileCharacterId(null)).toBe('');
  });

  it('extracts the sharable character name from profile variants', () => {
    const { api } = loadScriptTestApi();

    expect(api.extractSharedProfileName({ sharableCharacter: { name: '  Hero  ' } })).toBe('Hero');
    expect(api.extractSharedProfileName({ name: 'Plain Name' })).toBe('Plain Name');
    expect(api.extractSharedProfileName({ sharableCharacter: {} })).toBe('');
    expect(api.extractSharedProfileName(null)).toBe('');
  });

  it('rejects profile dialogs when the shared name is empty or too short', () => {
    const { api } = loadScriptTestApi();

    api.mainSiteState.latestSharedProfile = { sharableCharacter: { name: '' } };
    expect(api.isLikelyProfileDialog({ textContent: 'Anything' })).toBe(false);

    // 单字符名（如「A」）被长度下限拦截，避免匹配 Attack 等任意含该字母的弹窗。
    api.mainSiteState.latestSharedProfile = { sharableCharacter: { name: 'A' } };
    expect(api.isLikelyProfileDialog({ textContent: 'Attack Monster' })).toBe(false);

    // 2 字符名通过长度下限，但弹窗文本不含该子串时仍拒绝。
    // 注：'Mo' 匹配 'Monster' 是长度下限方案的已知边界（2 字符名无法靠长度区分）。
    api.mainSiteState.latestSharedProfile = { sharableCharacter: { name: 'Mo' } };
    expect(api.isLikelyProfileDialog({ textContent: 'Attack' })).toBe(false);
  });

  it('accepts a profile dialog whose text contains the normalized shared name', () => {
    const { api } = loadScriptTestApi();

    api.mainSiteState.latestSharedProfile = { sharableCharacter: { name: '  Hero  ' } };
    expect(api.isLikelyProfileDialog({ textContent: 'Hero Profile' })).toBe(true);
    expect(api.isLikelyProfileDialog({ textContent: 'hero profile' })).toBe(true);
    expect(api.isLikelyProfileDialog({ textContent: 'Other Dialog' })).toBe(false);
  });

  it('requires 2-character names to match as a standalone word, not a substring', () => {
    const { api } = loadScriptTestApi();

    // S5 已知边界：'Mo' ⊂ 'Monster' 不再视为有效匹配——词边界判定拒绝非独立出现。
    api.mainSiteState.latestSharedProfile = { sharableCharacter: { name: 'Mo' } };
    expect(api.isLikelyProfileDialog({ textContent: 'Monster Profile' })).toBe(false);
    expect(api.isLikelyProfileDialog({ textContent: 'Momo The Hero' })).toBe(false);

    // 独立出现仍可命中：整词、前后空白、标点分隔。
    expect(api.isLikelyProfileDialog({ textContent: 'Mo' })).toBe(true);
    expect(api.isLikelyProfileDialog({ textContent: 'Mo The Hero' })).toBe(true);
    expect(api.isLikelyProfileDialog({ textContent: 'Hero Mo' })).toBe(true);
    expect(api.isLikelyProfileDialog({ textContent: '(Mo) Hero' })).toBe(true);

    // ≥3 字符名维持子串语义（现有行为不回归；长名误配概率低，留待 data-* ID 校验根治）。
    api.mainSiteState.latestSharedProfile = { sharableCharacter: { name: 'Leo' } };
    expect(api.isLikelyProfileDialog({ textContent: 'Leonardo Profile' })).toBe(true);
  });

  describe('profile copy button mount decision (pure functions)', () => {
    it('picks the tablist-bearing dialog candidate first, then the largest area', () => {
      const { api } = loadScriptTestApi();
      const candidates = [
        { element: 'plain-big', area: 1000, hasTablist: false },
        { element: 'tablist-small', area: 300, hasTablist: true },
        { element: 'plain-small', area: 500, hasTablist: false },
      ];

      expect(api.pickBestProfileDialogCandidate(candidates).element).toBe('tablist-small');
      // 同组（均无 tablist）按面积降序
      expect(
        api.pickBestProfileDialogCandidate([
          { element: 'a', area: 100, hasTablist: false },
          { element: 'b', area: 300, hasTablist: false },
        ]).element,
      ).toBe('b');
      // 输入不污染：原数组保持插入序
      expect(candidates.map((entry) => entry.element)).toEqual(['plain-big', 'tablist-small', 'plain-small']);
      expect(api.pickBestProfileDialogCandidate([])).toBeNull();
      expect(api.pickBestProfileDialogCandidate(null)).toBeNull();
    });

    it('keeps the mounted button and skips without a share snapshot', () => {
      const { api } = loadScriptTestApi();
      const profile = { sharableCharacter: { name: 'Hero' } };

      // 按钮已挂载：即使弹窗/快照齐全也不重复挂载
      expect(
        api.resolveProfileCopyMountAction({ hasConnectedButton: true, profile, dialog: { textContent: 'Hero' } }),
      ).toEqual({ action: 'keep' });

      // 无快照 / 快照非对象 → skip（保持懒扫描：调用方在扫描前短路）
      expect(api.resolveProfileCopyMountAction({ hasConnectedButton: false, profile: null, dialog: null })).toEqual({
        action: 'skip',
      });
      expect(
        api.resolveProfileCopyMountAction({ hasConnectedButton: false, profile: 'not-an-object', dialog: null }),
      ).toEqual({ action: 'skip' });
    });

    it('arms the cooldown when no dialog exists or the name check fails', () => {
      const { api } = loadScriptTestApi();
      const profile = { sharableCharacter: { name: 'Hero' } };

      // G1 关联场景：快照在、弹窗未打开（或已关闭）→ 武装冷却
      expect(api.resolveProfileCopyMountAction({ hasConnectedButton: false, profile, dialog: null })).toEqual({
        action: 'arm-cooldown',
      });

      // 弹窗存在但文本不含角色名 → 武装冷却
      expect(
        api.resolveProfileCopyMountAction({
          hasConnectedButton: false,
          profile,
          dialog: { textContent: 'Other Dialog' },
        }),
      ).toEqual({ action: 'arm-cooldown' });
    });

    it('mounts only when the dialog text contains the shared profile name', () => {
      const { api } = loadScriptTestApi();
      const profile = { sharableCharacter: { name: 'Hero' } };

      expect(
        api.resolveProfileCopyMountAction({
          hasConnectedButton: false,
          profile,
          dialog: { textContent: 'Hero Profile' },
        }),
      ).toEqual({ action: 'mount' });
    });

    it('lets the scan gate through after the cooldown and reports the remaining delay inside it', () => {
      const { api } = loadScriptTestApi();

      // 边界：now === until 时冷却已失效，允许扫描（G1 的 retry 恰好在此刻触发）
      expect(api.resolveProfileDialogScanGate(1000, 1000)).toEqual({ state: 'scan' });
      expect(api.resolveProfileDialogScanGate(1001, 1000)).toEqual({ state: 'scan' });

      // 冷却中：返回剩余毫秒，供调用方排程一次性兜底重试
      expect(api.resolveProfileDialogScanGate(500, 1000)).toEqual({ state: 'cooling', retryAfterMs: 500 });
    });
  });
});

describe('官方估值透传（captureMarketItemValues）', () => {
  function createSocketHarness(api) {
    const handlers = {};
    api.instrumentMainSiteSocket({
      addEventListener(type, handler) {
        handlers[type] = handler;
      },
    });
    return {
      dispatch(message) {
        handlers.message({ data: JSON.stringify(message) });
      },
    };
  }

  it('market_item_values_updated 全量替换官方估值缓存', () => {
    const { api } = loadScriptTestApi();
    const harness = createSocketHarness(api);

    harness.dispatch({
      type: 'market_item_values_updated',
      marketItemValues: { '/items/a': { 0: 100 }, '/items/b': { 1: 250 } },
    });

    expect(api.mainSiteState.marketItemValues['/items/a']).toEqual({ 0: 100 });
    expect(api.mainSiteState.marketItemValues['/items/b']).toEqual({ 1: 250 });
  });

  it('market_item_order_books_updated 按物品合并增量（对齐 MWITools 单物品形状）', () => {
    const { api } = loadScriptTestApi();
    const harness = createSocketHarness(api);

    harness.dispatch({
      type: 'market_item_values_updated',
      marketItemValues: { '/items/a': { 0: 100, 1: 120 } },
    });
    // 单物品增量：字段在 marketItemOrderBooks 下，按 itemHrid 合并等级估值
    harness.dispatch({
      type: 'market_item_order_books_updated',
      marketItemOrderBooks: { itemHrid: '/items/a', marketValues: { 1: 250 } },
    });
    expect(api.mainSiteState.marketItemValues['/items/a']).toEqual({ 0: 100, 1: 250 });

    // 其他物品的增量不覆盖已有物品
    harness.dispatch({
      type: 'market_item_order_books_updated',
      marketItemOrderBooks: { itemHrid: '/items/b', marketValues: { 0: 50 } },
    });
    expect(api.mainSiteState.marketItemValues['/items/b']).toEqual({ 0: 50 });
    expect(api.mainSiteState.marketItemValues['/items/a']).toEqual({ 0: 100, 1: 250 });
  });

  it('订单簿增量合并为浅拷贝：非目标物品引用共享，顶层引用按事件替换（性能 #6 锁定）', () => {
    const { api } = loadScriptTestApi();
    const harness = createSocketHarness(api);

    harness.dispatch({
      type: 'market_item_values_updated',
      marketItemValues: { '/items/a': { 0: 100, 1: 120 }, '/items/b': { 0: 50 } },
    });
    const before = api.mainSiteState.marketItemValues;
    const levelsOfB = before['/items/b'];

    harness.dispatch({
      type: 'market_item_order_books_updated',
      marketItemOrderBooks: { itemHrid: '/items/a', marketValues: { 1: 250, 2: 300 } },
    });
    const after = api.mainSiteState.marketItemValues;

    // 顶层引用整体替换：N3 记忆化失效信号约定保持（数据变化后必须重建 merged）
    expect(after).not.toBe(before);
    // 目标物品：增量合并且 levels 映射为全新对象（不与上一代共享）
    expect(after['/items/a']).toEqual({ 0: 100, 1: 250, 2: 300 });
    expect(after['/items/a']).not.toBe(before['/items/a']);
    // 非目标物品：levels 映射与上一代共享引用——锁定浅拷贝实现，
    // 防无声回退为 clonePlainObject(existingByItem) 全量深克隆（2-6ms/条）。
    expect(after['/items/b']).toBe(levelsOfB);
  });

  it('缺 itemHrid 或 marketValues 的订单簿消息不破坏缓存', () => {
    const { api } = loadScriptTestApi();
    const harness = createSocketHarness(api);

    harness.dispatch({
      type: 'market_item_values_updated',
      marketItemValues: { '/items/a': { 0: 100 } },
    });
    harness.dispatch({ type: 'market_item_order_books_updated', marketItemOrderBooks: { marketValues: { 0: 1 } } });
    harness.dispatch({ type: 'market_item_order_books_updated', marketItemOrderBooks: { itemHrid: '/items/a' } });

    expect(api.mainSiteState.marketItemValues['/items/a']).toEqual({ 0: 100 });
  });

  it('marketItemOrderBooks 数组形状漂移：不破坏缓存且会话内告警一次（【一般-2】）', () => {
    // 形状防御告警经沙箱注入的 console 输出：Object.create(console) 保留全部
    // 原型方法（Node 的 console 方法不在自有属性上，spread 会得到空对象），仅替换 warn。
    const warn = vi.fn();
    const { api } = loadScriptTestApi({ console: Object.assign(Object.create(console), { warn }) });
    const harness = createSocketHarness(api);

    harness.dispatch({
      type: 'market_item_values_updated',
      marketItemValues: { '/items/a': { 0: 100 } },
    });
    // 契约漂移：字段变成数组形状时 itemHrid 取值必为空，合并不得写坏缓存；
    // F12 诊断已拆除，静默失效不可观测，故必须输出告警（高频消息下仅一次）。
    harness.dispatch({
      type: 'market_item_order_books_updated',
      marketItemOrderBooks: [{ itemHrid: '/items/a', marketValues: { 1: 250 } }],
    });
    harness.dispatch({
      type: 'market_item_order_books_updated',
      marketItemOrderBooks: [{ itemHrid: '/items/b', marketValues: { 0: 50 } }],
    });

    expect(api.mainSiteState.marketItemValues['/items/a']).toEqual({ 0: 100 });
    expect(api.mainSiteState.marketItemValues['/items/b']).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('复制按钮导出载荷不携带市场数据（缓存非空也不携带，通道分离）', () => {
    const { api } = loadScriptTestApi();
    const harness = createSocketHarness(api);

    harness.dispatch({
      type: 'market_item_values_updated',
      marketItemValues: { '/items/a': { 0: 100 } },
    });

    const payload = api.buildProfileExportPayload({ sharableCharacter: { name: 'A' }, characterSkills: [] });
    // 通道分离：分享弹窗「复制角色数据」= 干净角色数据（即使官方估值缓存非空）；
    // 市场数据只走模拟器页「从主站导入」按钮（buildCurrentCharacterPayload / buildCachedProfilePayload）。
    expect(Object.prototype.hasOwnProperty.call(payload, 'marketItemValues')).toBe(false);
    // 原有字段保持不变，应用侧 isShareableProfilePayload 判断不受影响。
    expect(payload.sharableCharacter).toEqual({ name: 'A' });
    expect(payload.characterSkills).toEqual([]);
  });

  it('复制按钮导出载荷在缓存为空时不携带市场数据', () => {
    const { api } = loadScriptTestApi();

    const payload = api.buildProfileExportPayload({ sharableCharacter: { name: 'A' } });
    expect(Object.prototype.hasOwnProperty.call(payload, 'marketItemValues')).toBe(false);
  });

  it('导入状态补充文案数导入载荷实际携带的官方估值物品数', () => {
    const { api } = loadScriptTestApi();

    // 模拟器页与主站不同源：本页缓存恒为空，历史无参分支会误报 0（已拆除）。
    // 现在必须传导入载荷：数载荷顶层 marketItemValues 的物品数。
    expect(
      api.describeMarketItemValuesStatus({
        marketItemValues: { '/items/a': { 0: 100 }, '/items/b': { 1: 200 }, '/items/c': { 0: 300 } },
      }),
    ).toContain('3');
    // 载荷未携带市场字段（复制粘贴产物等场景）时显示 0 个物品。
    expect(api.describeMarketItemValuesStatus({ sharableCharacter: { name: 'A' } })).toContain('0');
    // 空载荷 / 缺字段防御。
    expect(api.describeMarketItemValuesStatus({})).toContain('0');
  });

  it('convertMarketDataToItemValues：双边取中价、单边取单边、负值哨兵视为缺失', () => {
    const { api } = loadScriptTestApi();

    const converted = api.convertMarketDataToItemValues({
      '/items/dual_sided': { 0: { a: 200, b: 100 }, 1: { a: 300, b: -1 } },
      '/items/ask_only': { 0: { a: 50 } },
      '/items/empty': { 0: { a: 0, b: -1 } },
      '/items/broken': null,
    });

    expect(converted['/items/dual_sided']['0']).toBe(150);
    expect(converted['/items/dual_sided']['1']).toBe(300);
    expect(converted['/items/ask_only']['0']).toBe(50);
    expect(converted['/items/empty']).toBeUndefined();
    expect(converted['/items/broken']).toBeUndefined();
  });

  it('getMarketplaceApiUrl：www/裸域→www 端点，cn 域→cn 端点，test. 前缀→test 端点', () => {
    const { api } = loadScriptTestApi();

    expect(api.getMarketplaceApiUrl('www.milkywayidle.com')).toBe(
      'https://www.milkywayidle.com/game_data/marketplace.json',
    );
    expect(api.getMarketplaceApiUrl('milkywayidle.com')).toBe(
      'https://www.milkywayidle.com/game_data/marketplace.json',
    );
    expect(api.getMarketplaceApiUrl('milkywayidlecn.com')).toBe(
      'https://milkywayidlecn.com/game_data/marketplace.json',
    );
    expect(api.getMarketplaceApiUrl('test.milkywayidle.com')).toBe(
      'https://test.milkywayidle.com/game_data/marketplace.json',
    );
  });

  it('getMergedMarketItemValues：WS 真实官方估算优先，合成行情补缺', () => {
    const { api } = loadScriptTestApi();

    api.mainSiteState.syntheticMarketItemValues = {
      '/items/a': { 0: 100, 1: 110 },
      '/items/b': { 0: 50 },
    };
    // WS 真实估算只覆盖 /items/a 的 1 级（如全量快照/LS 合并后仅覆盖该物品的该等级）
    api.mainSiteState.marketItemValues = { '/items/a': { 1: 999 } };

    const merged = api.getMergedMarketItemValues();
    expect(merged['/items/a']['0']).toBe(100);
    expect(merged['/items/a']['1']).toBe(999);
    expect(merged['/items/b']['0']).toBe(50);
  });

  it('fetchSyntheticMarketItemValues：主站域拉取合成行情并节流，非主站域不请求', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    let fetchCount = 0;
    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    pageWindow.fetch = () => {
      fetchCount += 1;
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({ marketData: { '/items/trident': { 0: { a: 240500000, b: 235000000 } } } })),
      });
    };

    await api.fetchSyntheticMarketItemValues();
    expect(fetchCount).toBe(1);
    expect(api.mainSiteState.syntheticMarketItemValues['/items/trident']['0']).toBe(237750000);

    // 6 小时节流内不重复请求
    await api.fetchSyntheticMarketItemValues();
    expect(fetchCount).toBe(1);

    // 合成值进入合并视图（桥接导入的取数源）；分享弹窗复制载荷不再携带市场数据（通道分离）
    expect(api.getMergedMarketItemValues()['/items/trident']['0']).toBe(237750000);
    const exportPayload = api.buildProfileExportPayload({ sharableCharacter: { name: 'A' } });
    expect(Object.prototype.hasOwnProperty.call(exportPayload, 'marketItemValues')).toBe(false);
  });

  it('fetchSyntheticMarketItemValues：非主站域（模拟器页）不发请求', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    pageWindow.location = { hostname: 'azhu949.github.io' };
    let fetchCount = 0;
    pageWindow.fetch = () => {
      fetchCount += 1;
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') });
    };

    expect(api.isMainSiteHostname()).toBe(false);
    await api.fetchSyntheticMarketItemValues();
    expect(fetchCount).toBe(0);
    expect(api.mainSiteState.syntheticMarketItemValues).toEqual({});
  });

  // 官方 lz-string@1.5.0 压缩向量（plain 为 utf16/base64 的原文；原临时向量文件已内联至此，保证新克隆/CI 可复现）
  const LZ_TEST_VECTOR = {
    plain: '{"marketValuesVersion":42,"marketItemValues":{"/items/blazing_trident":{"0":912345678,"14":2500000000}}}',
    utf16: 'ᯡࡍ䄬Ԁ欥ᠥ恕Уか並㥎⦀■笠癀̀ˠঠ൘樀⁄䅘惁嬫 ⁍䰶⼠⍴ࠠ帤␣䰣琱‰œ䅀䏤#ʠ✠⍕┠嘠㘠瘠ບ綴ᗊ䶉㶒瀷樈  ',
    base64:
      'N4IgtghgTg1gpgFwGoQDYFc4GclylgSwHsA7EALgBYAmAGnGngQEkE4wUNsLQB6AtmCy8ARqggAvAiQDmAfQRQCAEzgkEPEAAYKATgCM1AMyUArADYA7AA56+yhWqmtL1y4C+noA',
  };

  it('内嵌 LZString 解压器与官方 lz-string 1.5.0 输出一致（真实压缩向量）', () => {
    const { plain, utf16, base64 } = LZ_TEST_VECTOR;
    const { api } = loadScriptTestApi();
    const decompressor = api.createLzStringDecompressor();

    expect(decompressor.decompressFromUTF16(utf16)).toBe(plain);
    expect(decompressor.decompressFromBase64(base64)).toBe(plain);
  });

  it('readStoredMarketItemValues：优先 localStorageUtil，回落裸键 + LZString 解压', () => {
    const { api, pageWindow } = loadScriptTestApi();

    // localStorageUtil 路径
    pageWindow.localStorageUtil = {
      getMarketItemValues: () => ({
        marketValuesVersion: 7,
        marketItemValues: { '/items/via-util': { 0: 1 } },
      }),
    };
    expect(api.readStoredMarketItemValues().marketItemValues['/items/via-util']['0']).toBe(1);

    // 裸键 UTF16 压缩形态
    delete pageWindow.localStorageUtil;
    const { plain, utf16 } = LZ_TEST_VECTOR;
    const storageMap = new Map([['marketItemValues', utf16]]);
    pageWindow.localStorage = {
      getItem: (key) => storageMap.get(key) ?? null,
    };
    const stored = api.readStoredMarketItemValues();
    expect(stored.marketValuesVersion).toBe(42);
    expect(stored.marketItemValues['/items/blazing_trident']['0']).toBe(912345678);
    expect(JSON.stringify(stored.marketItemValues)).toBe(JSON.stringify(JSON.parse(plain).marketItemValues));

    // 裸键 Base64 压缩形态（明文/UTF16/原生三候选落空后命中，锁定逐形态回退）
    storageMap.set('marketItemValues', LZ_TEST_VECTOR.base64);
    const storedFromBase64 = api.readStoredMarketItemValues();
    expect(storedFromBase64.marketValuesVersion).toBe(42);
    expect(storedFromBase64.marketItemValues['/items/blazing_trident']['14']).toBe(2500000000);
  });

  it('mergeStoredMarketItemValues：localStorage 官方估算合并进缓存且 WS 值优先', () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    pageWindow.localStorage = {
      getItem: (key) =>
        key === 'marketItemValues'
          ? JSON.stringify({
              marketValuesVersion: 42,
              marketItemValues: { '/items/a': { 0: 100, 1: 110 }, '/items/b': { 0: 50 } },
            })
          : null,
    };

    // WS 先捕获了 /items/a 的 1 级真实推送
    api.mainSiteState.marketItemValues = { '/items/a': { 1: 999 } };

    expect(api.mergeStoredMarketItemValues()).toBe(true);
    expect(api.mainSiteState.marketItemValues['/items/a']['0']).toBe(100);
    expect(api.mainSiteState.marketItemValues['/items/a']['1']).toBe(999);
    expect(api.mainSiteState.marketItemValues['/items/b']['0']).toBe(50);

    // 幂等：再次合并不改变引用
    const before = api.mainSiteState.marketItemValues;
    expect(api.mergeStoredMarketItemValues()).toBe(false);
    expect(api.mainSiteState.marketItemValues).toBe(before);
  });

  // —— N2/N3/N5 新行为用例（2026-08-31 审计）——

  it('getMergedMarketItemValues 记忆化：状态不变返回同一引用，任一状态引用替换后重建', () => {
    const { api } = loadScriptTestApi();

    api.mainSiteState.syntheticMarketItemValues = { '/items/syn': { 0: 10 } };
    api.mainSiteState.marketItemValues = { '/items/a': { 0: 100 } };
    const first = api.getMergedMarketItemValues();
    expect(first['/items/a']['0']).toBe(100);
    expect(first['/items/syn']['0']).toBe(10);

    // 两个状态引用均未变：命中缓存，返回同一对象（读放大消除的收益面）
    expect(api.getMergedMarketItemValues()).toBe(first);

    // 失效源 1：WS 捕获/订单簿合并（captureMarketItemValues 均整体替换 official 引用）
    api.mainSiteState.marketItemValues = { '/items/a': { 0: 100, 1: 120 } };
    const second = api.getMergedMarketItemValues();
    expect(second).not.toBe(first);
    expect(second['/items/a']['1']).toBe(120);

    // 失效源 2：合成 fetch 整体赋值 synthetic 引用
    api.mainSiteState.syntheticMarketItemValues = { '/items/syn': { 0: 11 } };
    const third = api.getMergedMarketItemValues();
    expect(third).not.toBe(second);
    expect(third['/items/syn']['0']).toBe(11);

    // 失效源 3：mergeStoredMarketItemValues 变更分支整体替换 official 引用
    api.mainSiteState.marketItemValues = { '/items/a': { 0: 100, 1: 120, 2: 130 } };
    const fourth = api.getMergedMarketItemValues();
    expect(fourth).not.toBe(third);
    expect(fourth['/items/a']['2']).toBe(130);
    // 数值合并语义不变：official 优先、synthetic 补缺
    expect(fourth['/items/a']['0']).toBe(100);
    expect(fourth['/items/syn']['0']).toBe(11);
  });

  it('mergeStoredMarketItemValues：变更时整体替换引用，幂等时不换引用', () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    pageWindow.localStorage = {
      getItem: (key) =>
        key === 'marketItemValues'
          ? JSON.stringify({ marketValuesVersion: 42, marketItemValues: { '/items/b': { 0: 50 } } })
          : null,
    };
    api.mainSiteState.marketItemValues = { '/items/a': { 0: 100 } };
    const before = api.mainSiteState.marketItemValues;

    // changed=true：整体替换为新引用（getMergedMarketItemValues 记忆化的失效信号依赖此约定）
    expect(api.mergeStoredMarketItemValues()).toBe(true);
    const after = api.mainSiteState.marketItemValues;
    expect(after).not.toBe(before);
    expect(after['/items/a']['0']).toBe(100);
    expect(after['/items/b']['0']).toBe(50);

    // changed=false（全已存在）：引用保持不变
    expect(api.mergeStoredMarketItemValues()).toBe(false);
    expect(api.mainSiteState.marketItemValues).toBe(after);
  });

  it('mergeStoredMarketItemValues：跳过 __proto__ 键，不改写缓存对象原型（【一般-1】复核）', () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    // 顶层写入由计算键（CreateDataProperty）改为普通赋值后，"__proto__" 键会命中
    // 访问器改写对象原型而非创建自有键。LS 数据经 JSON.parse 可携带 "__proto__"
    // 自有键（用原始 JSON 串构造，避免对象字面量把该键变成原型设置），须显式跳过。
    pageWindow.localStorage = {
      getItem: (key) =>
        key === 'marketItemValues'
          ? '{"marketValuesVersion":42,"marketItemValues":{"__proto__":{"0":1},"/items/a":{"0":100}}}'
          : null,
    };
    api.mainSiteState.marketItemValues = {};
    const before = api.mainSiteState.marketItemValues;

    expect(api.mergeStoredMarketItemValues()).toBe(true);
    const cache = api.mainSiteState.marketItemValues;
    expect(cache).not.toBe(before);
    // '__proto__' 既不成为缓存自有键，也不改写缓存对象原型（与脚本沙箱同 realm
    // 的普通对象原型比较，跨 realm 不能用本文件 Object.prototype 恒等断言）。
    expect(Object.hasOwn(cache, '__proto__')).toBe(false);
    const plainProto = Object.getPrototypeOf(api.mainSiteState);
    expect(Object.getPrototypeOf(cache)).toBe(plainProto);
    // 正常物品合并不受影响
    expect(cache['/items/a']['0']).toBe(100);
  });

  it('缓存条目剥离 marketItemValues/marketEstimateSource，响应侧默认仍携带', () => {
    const { api, gmStore } = loadScriptTestApi();

    // 官方估算先到位（WS 全量快照）
    api.mainSiteState.marketItemValues = { '/items/a': { 0: 100 } };

    const entry = api.persistProfileCacheEntry({ sharableCharacter: { name: 'Cached' }, characterSkills: [] });
    expect(entry).toBeTruthy();

    // N3：GM 存储的缓存条目不再挂全量市场快照（50 条 ×50 冗余序列化的消除点），
    // 来源标记同属市场挂载块、一并剥离（缓存条目无消费方）。
    const stored = gmStore.get('mwi.tm.import.profileCache.v1');
    expect(stored?.entries?.length).toBe(1);
    const cachedPayload = stored.entries[0].payload;
    expect(Object.prototype.hasOwnProperty.call(cachedPayload, 'marketItemValues')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cachedPayload, 'marketEstimateSource')).toBe(false);
    expect(cachedPayload.profile.sharableCharacter).toEqual({ name: 'Cached' });

    // 响应侧（默认 includeMarket=true）重建载荷仍携带市场数据与来源标记
    const responsePayload = api.buildCachedProfilePayload({ sharableCharacter: { name: 'Cached' } });
    expect(responsePayload.marketItemValues).toEqual({ '/items/a': { 0: 100 } });
    expect(responsePayload.marketEstimateSource).toBe('official');
  });

  it('merged 为空时两 builder 均不挂市场字段（空载荷无来源标记可言）', () => {
    const { api } = loadScriptTestApi();

    // 冷启动：LS 无键 + WS 未推 + 合成 fetch 未完成 → merged 为空
    api.captureCurrentCharacterState({
      type: 'init_character_data',
      character: { id: 101, name: 'Current Player' },
      characterSkills: [{ skillHrid: '/skills/melee', level: 42 }],
      characterItems: [{ itemHrid: '/items/basic_sword', count: 1 }],
      combatUnit: {},
      actionTypeFoodSlotsMap: { food: {} },
      actionTypeDrinkSlotsMap: { drink: {} },
    });

    const snapshotPayload = api.buildCurrentCharacterPayload();
    expect(snapshotPayload).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(snapshotPayload, 'marketItemValues')).toBe(false);
    // 空载荷冗余标记：来源标记描述「本载荷所携数值」的来源，0 个值无来源
    // 可言——无条件挂 'synthetic' 会让 app 侧 main-site-current-character 格式（计数行
    // 恒显示）渲染「合成中价估值：0 个物品」的自相矛盾反馈。
    expect(Object.prototype.hasOwnProperty.call(snapshotPayload, 'marketEstimateSource')).toBe(false);

    const cachedPayload = api.buildCachedProfilePayload({ sharableCharacter: { name: 'Cached' } });
    expect(Object.prototype.hasOwnProperty.call(cachedPayload, 'marketItemValues')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cachedPayload, 'marketEstimateSource')).toBe(false);

    // 对照：合成行情到位后（官方估算仍空）两字段同时挂载、来源如实标 synthetic
    api.mainSiteState.syntheticMarketItemValues = { '/items/syn': { 0: 10 } };
    const syntheticSnapshot = api.buildCurrentCharacterPayload();
    expect(syntheticSnapshot.marketItemValues).toEqual({ '/items/syn': { 0: 10 } });
    expect(syntheticSnapshot.marketEstimateSource).toBe('synthetic');
    const syntheticCached = api.buildCachedProfilePayload({ sharableCharacter: { name: 'Cached' } });
    expect(syntheticCached.marketItemValues).toEqual({ '/items/syn': { 0: 10 } });
    expect(syntheticCached.marketEstimateSource).toBe('synthetic');
  });

  it('#18：混合载荷（官方 + 合成独有物品）附 syntheticItemHrids 逐件真值；纯源载荷不挂', () => {
    const { api } = loadScriptTestApi();

    api.captureCurrentCharacterState({
      type: 'init_character_data',
      character: { id: 101, name: 'Current Player' },
      characterSkills: [{ skillHrid: '/skills/melee', level: 42 }],
      characterItems: [{ itemHrid: '/items/basic_sword', count: 1 }],
      combatUnit: {},
      actionTypeFoodSlotsMap: { food: {} },
      actionTypeDrinkSlotsMap: { drink: {} },
    });

    // 混合：官方 1 件（/items/official）+ 合成独有 2 件（/items/syn_a、/items/syn_b）；
    // /items/official 的等级 1 为官方缓存未覆盖、由合成行情补齐的等级（【一般-5】）。
    api.mainSiteState.marketItemValues = { '/items/official': { 0: 100 } };
    api.mainSiteState.syntheticMarketItemValues = {
      '/items/official': { 0: 50, 1: 55 },
      '/items/syn_a': { 0: 10 },
      '/items/syn_b': { 1: 20 },
    };

    const mixedSnapshot = api.buildCurrentCharacterPayload();
    expect(mixedSnapshot.marketEstimateSource).toBe('official');
    // merged 官方优先：/items/official 取官方值 100（合成 50 被覆盖）
    expect(mixedSnapshot.marketItemValues['/items/official']['0']).toBe(100);
    expect(mixedSnapshot.syntheticItemHrids).toEqual(['/items/syn_a', '/items/syn_b']);
    // 【一般-5】等级级来源真值：官方未覆盖的等级 1 进 syntheticLevelKeys；
    // 官方覆盖的等级 0（合成 50 被覆盖）不进清单。
    expect(mixedSnapshot.marketItemValues['/items/official']['1']).toBe(55);
    expect(mixedSnapshot.syntheticLevelKeys).toEqual({ '/items/official': ['1'] });

    const mixedCached = api.buildCachedProfilePayload({ sharableCharacter: { name: 'Cached' } });
    expect(mixedCached.marketEstimateSource).toBe('official');
    expect(mixedCached.syntheticItemHrids).toEqual(['/items/syn_a', '/items/syn_b']);
    expect(mixedCached.syntheticLevelKeys).toEqual({ '/items/official': ['1'] });

    // 纯官方：合成缓存清空后清单为空不挂（零体积增量）
    api.mainSiteState.syntheticMarketItemValues = {};
    const pureOfficialSnapshot = api.buildCurrentCharacterPayload();
    expect(pureOfficialSnapshot.marketEstimateSource).toBe('official');
    expect(Object.prototype.hasOwnProperty.call(pureOfficialSnapshot, 'syntheticItemHrids')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(pureOfficialSnapshot, 'syntheticLevelKeys')).toBe(false);

    // 纯合成：官方缓存清空后标记 synthetic、清单冗余不挂
    api.mainSiteState.marketItemValues = {};
    api.mainSiteState.syntheticMarketItemValues = { '/items/syn_a': { 0: 10 } };
    const pureSyntheticSnapshot = api.buildCurrentCharacterPayload();
    expect(pureSyntheticSnapshot.marketEstimateSource).toBe('synthetic');
    expect(Object.prototype.hasOwnProperty.call(pureSyntheticSnapshot, 'syntheticItemHrids')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(pureSyntheticSnapshot, 'syntheticLevelKeys')).toBe(false);
  });

  it('#18：导入状态文案混合载荷分列官方/合成计数（逐件真值不丢失）', () => {
    const { api } = loadScriptTestApi();

    const mixedPayload = {
      marketItemValues: { '/items/a': { 0: 100 }, '/items/b': { 1: 200 }, '/items/c': { 0: 300 } },
      marketEstimateSource: 'official',
      syntheticItemHrids: ['/items/b', '/items/c'],
    };
    const mixedText = api.describeMarketItemValuesStatus(mixedPayload);
    // 计数绑定所属分列段（整句断言，对齐 app 侧「Official estimates: N items」绑定式）：
    // 分列文案两个数字槽位若对调（officialCount/syntheticCount 互换），两数字只是换段、
    // 均仍在句中——裸数字 toContain('1')/toContain('2') 对互换不敏感，绑定句段即双双失败。
    expect(mixedText).toContain('官方估值已透传：1 个物品'); // 官方段 = 清单外 1 件
    expect(mixedText).toContain('合成中价估值：2 个物品'); // 合成段 = 清单 2 件（「合成」入句由本断言覆盖）

    // 清单为空/缺失：维持官方文案（旧载荷向后兼容）
    const officialText = api.describeMarketItemValuesStatus({
      marketItemValues: { '/items/a': { 0: 100 } },
      marketEstimateSource: 'official',
    });
    expect(officialText).toContain('官方估值已透传：1 个物品'); // 计数同样绑定官方句段
    expect(officialText).not.toContain('合成');
  });

  it('导入状态文案区分官方估算与合成中价来源（旧载荷无标记兼容）', () => {
    const { api } = loadScriptTestApi();

    const payloadWith = (source) => ({
      marketItemValues: { '/items/a': { 0: 100 }, '/items/b': { 1: 200 }, '/items/c': { 0: 300 } },
      ...(source ? { marketEstimateSource: source } : {}),
    });

    // official：现文案（zh 沙箱）
    expect(api.describeMarketItemValuesStatus(payloadWith('official'))).toContain('3');
    // synthetic：如实标注合成中价兜底（N5 用户面失真的修复点）
    const syntheticText = api.describeMarketItemValuesStatus(payloadWith('synthetic'));
    expect(syntheticText).toContain('3');
    expect(syntheticText).toContain('合成');
    expect(syntheticText).not.toContain('官方估值已透传');
    // 旧载荷/复制粘贴载荷无标记字段：维持现文案（向后兼容，不劣化）
    expect(api.describeMarketItemValuesStatus(payloadWith())).toContain('3');
    expect(api.describeMarketItemValuesStatus(payloadWith())).not.toContain('合成');
    // 空载荷：0 个物品（该分支文案本就诚实，不按来源分叉）
    expect(api.describeMarketItemValuesStatus({})).toContain('0');
  });

  it('团队导入成功反馈附带官方估值计数（与单人路径口径一致）', () => {
    const { api } = loadScriptTestApi();

    // 团队响应顶层不带 marketItemValues，快照挂各 member 载荷（同一份 merged 共享
    // 快照）。文案拼接逻辑自 #22 起提取到顶层可注入纯函数 buildTeamImportFeedbackText，
    // 此处以行为断言覆盖「成功反馈必须附带估值计数」——团队导入（auto 主链路）缺失
    // 该计数时，「透传为 0」故障只能等 tooltip 全是挂单价才被排查（第 20 轮修复目标
    // 的补齐）；本块行为断言不锁实现细节（变量名/模板字符串），重构即不碎；接线
    // 护栏有意更严（锁定关键参数形态），取舍说明见下方 #22 P1/P2 注释。
    const payload = {
      marketItemValues: { '/items/a': { 0: 100 }, '/items/b': { 1: 200 }, '/items/c': { 0: 300 } },
      marketEstimateSource: 'official',
    };

    // 全部成功分支：与单人路径同为「importSuccess + 估值文案」拼接
    const allSuccessZh = api.buildTeamImportFeedbackText({
      uiLanguage: 'zh',
      summary: '',
      firstSuccessPayload: payload,
    });
    expect(allSuccessZh).toContain('导入成功');
    // 估值计数绑定整句（对齐 app 侧绑定式断言）：计数脱离「官方估值已透传」句段即失败
    expect(allSuccessZh).toContain('官方估值已透传：3 个物品');

    const allSuccessEn = api.buildTeamImportFeedbackText({
      uiLanguage: 'en',
      summary: '',
      firstSuccessPayload: payload,
    });
    expect(allSuccessEn).toContain('Import successful');
    // 估值句恒为 zh：describeMarketItemValuesStatus 的 UI_TEXT 不随 uiLanguage 分叉
    expect(allSuccessEn).toContain('官方估值已透传：3 个物品');

    // 部分成功分支：summary 之后同样附带估值文案（summary 由真实拼接器生成，不手写）
    const partialSummaryZh = api.formatTeamImportSummary(1, [{ name: 'A', message: 'x' }], 'zh');
    const partialZh = api.buildTeamImportFeedbackText({
      uiLanguage: 'zh',
      summary: partialSummaryZh,
      firstSuccessPayload: payload,
    });
    expect(partialZh).toContain('导入完成');
    expect(partialZh).toContain('成功 1 人');
    expect(partialZh).toContain('官方估值已透传：3 个物品');

    const partialSummaryEn = api.formatTeamImportSummary(1, [{ name: 'A', message: 'x' }], 'en');
    const partialEn = api.buildTeamImportFeedbackText({
      uiLanguage: 'en',
      summary: partialSummaryEn,
      firstSuccessPayload: payload,
    });
    expect(partialEn).toContain('Import finished');
    expect(partialEn).toContain('官方估值已透传：3 个物品'); // 同上：估值句恒 zh（含 issue 未点名的同型处）

    // 空估值载荷：如实显示 0 个物品（透传故障在导入瞬间可见）
    const emptyZh = api.buildTeamImportFeedbackText({ uiLanguage: 'zh', summary: '', firstSuccessPayload: {} });
    expect(emptyZh).toContain('0');

    // 接线护栏（#22 P1/P2）：锁定 importTeamMainSiteResponse 体内对
    // buildTeamImportFeedbackText 的调用必须传 successfulMembers[0]?.payload——
    // 这是「取首个成功 member 载荷」的关键接线（团队响应顶层无 marketItemValues，
    // 未过滤的 members[0] 可能是失败 member，误传两者都会让计数恒 0 静默回归）。
    // [^}]* 限定参数在同一对象字面量内：即使纯函数定义挪到 importTeamMainSiteResponse
    // 之后（定义签名含 buildTeamImportFeedbackText({ 但无该参数形态），或文件后部
    // 再出现同名引用，体内调用被删时护栏仍会报警（P2 收紧点）。
    expect(scriptSource).toMatch(
      /function importTeamMainSiteResponse[\s\S]*?buildTeamImportFeedbackText\(\s*\{[^}]*firstSuccessPayload:\s*successfulMembers\[0\]\?\.payload/,
    );
  });

  it('formatTeamImportSummary：部分成功摘要拼装（0/1/2/3+ 失败、中英文、空名回落）', () => {
    const { api } = loadScriptTestApi();

    // 无失败：空串（全部成功分支不拼 summary）
    expect(api.formatTeamImportSummary(2, [], 'zh')).toBe('');
    expect(api.formatTeamImportSummary(2, [], 'en')).toBe('');

    // 1 个失败
    expect(api.formatTeamImportSummary(1, [{ name: 'A', message: 'x' }], 'zh')).toBe('成功 1 人，失败 1 人（A: x）。');
    expect(api.formatTeamImportSummary(1, [{ name: 'A', message: 'x' }], 'en')).toBe('1 succeeded, 1 failed (A: x).');

    // 2 个失败：分隔符按语言分叉（zh 全角分号 / en 分号+空格）
    expect(
      api.formatTeamImportSummary(
        2,
        [
          { name: 'A', message: 'x' },
          { name: 'B', message: 'y' },
        ],
        'zh',
      ),
    ).toBe('成功 2 人，失败 2 人（A: x；B: y）。');
    expect(
      api.formatTeamImportSummary(
        2,
        [
          { name: 'A', message: 'x' },
          { name: 'B', message: 'y' },
        ],
        'en',
      ),
    ).toBe('2 succeeded, 2 failed (A: x; B: y).');

    // 3+ 失败：只预览前 2 个 + 超限后缀
    expect(
      api.formatTeamImportSummary(
        2,
        [
          { name: 'A', message: 'x' },
          { name: 'B', message: 'y' },
          { name: 'C', message: 'z' },
        ],
        'zh',
      ),
    ).toBe('成功 2 人，失败 3 人（A: x；B: y……另有 1 个失败）。');
    expect(
      api.formatTeamImportSummary(
        2,
        [
          { name: 'A', message: 'x' },
          { name: 'B', message: 'y' },
          { name: 'C', message: 'z' },
        ],
        'en',
      ),
    ).toBe('2 succeeded, 3 failed (A: x; B: y… +1 more).');

    // 空名/空消息回落：name → '-', message → importFailed 文案
    const fallbackZh = api.formatTeamImportSummary(1, [{}], 'zh');
    expect(fallbackZh).toContain('-: ');
    expect(fallbackZh).toContain('导入失败');
    const fallbackEn = api.formatTeamImportSummary(1, [{}], 'en');
    expect(fallbackEn).toContain('-: ');
    expect(fallbackEn).toContain('Import failed');
  });

  it('fetchSyntheticMarketItemValues：挂起中返回 false（不再谎报成功），完成后返回 true', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    let resolveFetch;
    pageWindow.fetch = () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      });

    const first = api.fetchSyntheticMarketItemValues();
    // 挂起窗口内的第二次调用返回 false（旧实现返回 true 会误导基于返回值的重试判定），
    // 且由 inFlight 守卫挡下、不会双发（fetch mock 仅被赋值一次）。
    await expect(api.fetchSyntheticMarketItemValues()).resolves.toBe(false);
    expect(resolveFetch).toBeDefined();

    resolveFetch({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ marketData: { '/items/x': { 0: { a: 10, b: 6 } } } })),
    });
    await expect(first).resolves.toBe(true);
    expect(api.mainSiteState.syntheticMarketItemValues['/items/x']['0']).toBe(8);
  });

  it('fetchSyntheticMarketItemValues：超时中止后复位 inFlight 并返回 false（可重新发起）', async () => {
    vi.useFakeTimers();
    try {
      const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

      pageWindow.location = { hostname: 'www.milkywayidle.com' };
      let fetchCount = 0;
      pageWindow.fetch = (_url, options) => {
        fetchCount += 1;
        if (fetchCount === 1) {
          // 永不 resolve 的挂起 fetch，仅响应 abort 信号（模拟网络停滞）
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ marketData: { '/items/y': { 0: { a: 4, b: 2 } } } })),
        });
      };

      const first = api.fetchSyntheticMarketItemValues();
      // 推进假计时器触发 15s 超时中止（AbortController signal reject → catch → false）
      await vi.advanceTimersByTimeAsync(15000);
      await expect(first).resolves.toBe(false);
      expect(api.mainSiteState.syntheticMarketFetchInFlight).toBe(false);

      // inFlight 已复位：第二次调用可重新发起请求（N2「下次导入退避重试」入口的前提）
      await expect(api.fetchSyntheticMarketItemValues()).resolves.toBe(true);
      expect(fetchCount).toBe(2);
      expect(api.mainSiteState.syntheticMarketItemValues['/items/y']['0']).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetchSyntheticMarketItemValues：页面无 AbortController 时降级为无 signal 请求，流程照常完成', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    // 模拟页面 realm 无 AbortController（#16 门控的降级形态）：typeof 门控 → controller=null
    delete pageWindow.AbortController;
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ marketData: { '/items/z': { 0: { a: 8, b: 4 } } } })),
      }),
    );
    pageWindow.fetch = fetchMock;

    await expect(api.fetchSyntheticMarketItemValues()).resolves.toBe(true);
    // 降级契约：不传 signal（第二参数为 undefined），请求照常发出，finally 复位 inFlight
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), undefined);
    expect(api.mainSiteState.syntheticMarketItemValues['/items/z']['0']).toBe(6);
    expect(api.mainSiteState.syntheticMarketFetchInFlight).toBe(false);
  });

  it('fetchSyntheticMarketItemValues：页面 AbortController 构造抛错时返回 false 且复位 inFlight（守卫不锁死）', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({ console: consoleStub });

    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    // 模拟页面把 AbortController 覆盖成不可构造的实现（typeof 门控可通过，但 new 抛错）
    pageWindow.AbortController = function BrokenAbortController() {
      throw new Error('broken');
    };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('{}') }));
    pageWindow.fetch = fetchMock;

    await expect(api.fetchSyntheticMarketItemValues()).resolves.toBe(false);
    // 构造抛错发生在 fetch 之前：请求未发出；catch 返 false + finally 复位 inFlight
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.mainSiteState.syntheticMarketFetchInFlight).toBe(false);
  });

  it('N2：导入请求惰性补 LS merge，单人载荷同步携带；缓存为空时才触发合成兜底 fetch', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, gmStore, pageWindow, sandboxWindow } = loadScriptTestApi({
      console: consoleStub,
      mainSiteMode: true,
    });

    // init（启动链：LS 为空 → merge false → fetch fire-and-forget；此时 fetch 未 mock，静默返回 false）
    api.initMainSiteBridge();
    const poll = sandboxWindow.__pollCallbacks.at(-1);
    expect(typeof poll).toBe('function');

    // 喂当前角色快照：单人分支 buildCurrentMainSiteResponse 需要 init_character_data
    // 快照才会构建有效载荷（对齐既有「pure-number character name」用例的前置）。
    api.captureCurrentCharacterState({
      type: 'init_character_data',
      character: { id: 101, name: 'Current Player' },
      characterSkills: [{ skillHrid: '/skills/melee', level: 42 }],
      characterItems: [{ itemHrid: '/items/basic_sword', count: 1 }],
      combatUnit: {},
      actionTypeFoodSlotsMap: { food: {} },
      actionTypeDrinkSlotsMap: { drink: {} },
    });

    let fetchCount = 0;
    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    pageWindow.fetch = () => {
      fetchCount += 1;
      return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
    };

    // 第一次导入请求（LS 仍为空、官方估算缓存为空）：ensure 触发合成兜底 fetch（退避重试入口）
    gmStore.set('mwi.tm.import.request.v1', { requestId: 'req-empty', target: 'active-player' });
    poll();
    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });
    expect(api.mainSiteState.marketItemValues).toEqual({});

    // 主站登录后写入 LS 键（晚于 document-start 的「后写」场景）+ 新导入请求到达
    pageWindow.localStorage = {
      getItem: (key) =>
        key === 'marketItemValues'
          ? JSON.stringify({ marketValuesVersion: 42, marketItemValues: { '/items/late': { 0: 700 } } })
          : null,
    };
    gmStore.set('mwi.tm.import.request.v1', { requestId: 'req-ls-late', target: 'active-player' });
    poll();

    // 惰性补 merge 生效：官方估算缓存获得 LS 数据；merge 成功 → 不再触发合成兜底 fetch
    expect(api.mainSiteState.marketItemValues['/items/late']['0']).toBe(700);
    expect(fetchCount).toBe(1);

    // 单人分支在响应构建前完成 merge：响应载荷同步携带市场数据与 official 来源标记
    const response = gmStore.get('mwi.tm.import.response.v1');
    expect(response?.requestId).toBe('req-ls-late');
    expect(response?.payload?.marketItemValues?.['/items/late']?.['0']).toBe(700);
    expect(response?.payload?.marketEstimateSource).toBe('official');
  });

  it('N2：changed 双义性——官方估算缓存非空时不触发合成兜底 fetch', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, gmStore, pageWindow, sandboxWindow } = loadScriptTestApi({
      console: consoleStub,
      mainSiteMode: true,
    });

    // init（LS 空 → 启动链 fetch，此时未 mock、无操作）
    api.initMainSiteBridge();
    const poll = sandboxWindow.__pollCallbacks.at(-1);
    expect(typeof poll).toBe('function');

    let fetchCount = 0;
    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    pageWindow.fetch = () => {
      fetchCount += 1;
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') });
    };

    // 变体 A：WS 已捕获数据、LS 无键（merge 返回 false 的含义是「LS 无键」而非「无数据」）
    api.mainSiteState.marketItemValues = { '/items/ws': { 0: 1 } };
    gmStore.set('mwi.tm.import.request.v1', { requestId: 'req-ws-only', target: 'active-player' });
    poll();
    await vi.waitFor(() => {
      expect(fetchCount).toBe(0);
    });
    expect(api.mainSiteState.marketItemValues['/items/ws']['0']).toBe(1);

    // 变体 B：LS 有键但与缓存全重叠（merge 返回 false 的含义是「无新增」）——同样不 fetch
    pageWindow.localStorage = {
      getItem: (key) =>
        key === 'marketItemValues'
          ? JSON.stringify({ marketValuesVersion: 1, marketItemValues: { '/items/ws': { 0: 1 } } })
          : null,
    };
    gmStore.set('mwi.tm.import.request.v1', { requestId: 'req-fully-covered', target: 'active-player' });
    poll();
    await vi.waitFor(() => {
      expect(fetchCount).toBe(0);
    });
    expect(api.mainSiteState.marketItemValues['/items/ws']['0']).toBe(1);
  });

  it('启动链（#19）：官方估算缓存非空且 LS 全覆盖（merge 幂等返 false）时不触发合成兜底 fetch', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({
      console: consoleStub,
      mainSiteMode: true,
    });

    let fetchCount = 0;
    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    pageWindow.fetch = () => {
      fetchCount += 1;
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') });
    };

    // WS 已捕获官方估算 + LS 数据与缓存全重叠（merge 幂等返 false）——
    // 启动链的双守卫（merge 返 false 且缓存整体为空）应拦下多余的合成行情拉取。
    api.mainSiteState.marketItemValues = { '/items/ws': { 0: 1 } };
    pageWindow.localStorage = {
      getItem: (key) =>
        key === 'marketItemValues'
          ? JSON.stringify({ marketValuesVersion: 1, marketItemValues: { '/items/ws': { 0: 1 } } })
          : null,
    };

    api.initMainSiteBridge();
    await vi.waitFor(() => {
      expect(fetchCount).toBe(0);
    });
    expect(api.mainSiteState.marketItemValues['/items/ws']['0']).toBe(1);
  });

  it('启动链（#19）对照：官方估算缓存为空（冷启动）时仍触发合成兜底 fetch', async () => {
    const consoleStub = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { api, pageWindow } = loadScriptTestApi({
      console: consoleStub,
      mainSiteMode: true,
    });

    let fetchCount = 0;
    pageWindow.location = { hostname: 'www.milkywayidle.com' };
    pageWindow.fetch = () => {
      fetchCount += 1;
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') });
    };

    // 冷启动：LS 无键（merge 返 false）+ 官方估算缓存为空 → 双守卫放行，补拉合成行情
    api.initMainSiteBridge();
    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });
  });
});
