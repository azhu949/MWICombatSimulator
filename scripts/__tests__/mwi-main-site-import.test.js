import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const scriptSource = readFileSync(new URL('../mwi-main-site-import.user.js', import.meta.url), 'utf8');

// 从 @version 元数据动态提取版本号，避免发版时硬编码断言失步。
// ^ 锚定行首 + m 标志：只匹配元数据块中的 @version 行，避免误匹配脚本正文
// 中可能出现的 // @version 注释。
const scriptVersionMatch = scriptSource.match(/^\/\/\s*@version\s+(\S+)/m);
const scriptVersion = scriptVersionMatch?.[1] || '';

function loadScriptTestApi() {
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

    // Closing the last socket must only drop the in-memory roster: reconnects close
    // every socket, so the persisted cache has to survive to keep team imports intact.
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
