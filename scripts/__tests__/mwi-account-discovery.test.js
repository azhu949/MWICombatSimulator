// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('scripts/mwi-main-site-import.user.js', 'utf8');
const prefix = 'mwi.tm.import.account.v1.';
const requestPrefix = 'mwi.tm.import.request.v1.';
const responsePrefix = 'mwi.tm.import.response.v1.';
function tab(store = new Map(), id = 101, name = 'Alpha') {
  const listeners = new Map();
  let listenerId = 0;
  const win = {
    location: { hostname: 'example.test', origin: 'https://www.milkywayidle.com', search: '' },
    localStorage: { getItem: () => null },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const context = {
    Date,
    navigator: { language: 'zh-CN' },
    window: win,
    document,
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    unsafeWindow: { AbortController },
    GM_getValue: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    GM_setValue(key, value) {
      const old = store.get(key);
      store.set(key, value);
      for (const { key: watched, callback } of listeners.values()) if (watched === key) callback(key, old, value, true);
    },
    GM_deleteValue: (key) => store.delete(key),
    GM_listValues: () => [...store.keys()],
    GM_addValueChangeListener(key, callback) {
      listeners.set(++listenerId, { key, callback });
      return listenerId;
    },
    GM_removeValueChangeListener: (key) => listeners.delete(key),
  };
  runInNewContext(
    source.replace(
      '  installDebugInterface();',
      `
    globalThis.api = { currentAccountIdentity, sameAccount, publishAccountHeartbeat, discoverOnlineAccounts,
      chooseImportAccount, processTargetedImportRequest, requestAccountImport, captureCurrentCharacterState,
      mainSiteState, ACCOUNT_TTL_MS, MAIN_SITE_TAB_ID };
    installDebugInterface();`,
    ),
    context,
  );
  function capture(nextId = id, nextName = name) {
    context.api.captureCurrentCharacterState({
      type: 'init_character_data',
      character: { id: nextId, name: nextName },
      characterSkills: [],
      characterItems: [],
      combatUnit: {},
      actionTypeFoodSlotsMap: {},
      actionTypeDrinkSlotsMap: {},
    });
  }
  capture();
  return { ...context.api, capture, store, listeners };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('account discovery and targeted import', () => {
  it('registers independent tabs without overwriting another account and refreshes heartbeat', () => {
    const store = new Map();
    const a = tab(store);
    const b = tab(store, 202, 'Beta');
    expect(a.MAIN_SITE_TAB_ID).not.toBe(b.MAIN_SITE_TAB_ID);
    expect(a.discoverOnlineAccounts().map((x) => x.characterId)).toEqual(['101', '202']);
    const key = prefix + a.MAIN_SITE_TAB_ID;
    const before = store.get(key).updatedAt;
    vi.advanceTimersByTime(5000);
    a.publishAccountHeartbeat();
    expect(store.get(key).updatedAt).toBeGreaterThan(before);
  });
  it('expires stale entries, keeps fresh accounts, and deduplicates tabs of the same character', () => {
    const store = new Map();
    const a = tab(store);
    tab(store);
    expect(a.discoverOnlineAccounts()).toHaveLength(1);
    vi.advanceTimersByTime(a.ACCOUNT_TTL_MS + 1);
    expect(a.discoverOnlineAccounts()).toHaveLength(0);
    a.publishAccountHeartbeat();
    expect(a.discoverOnlineAccounts()).toHaveLength(1);
  });
  it('replaces registration immediately on a character switch', () => {
    const a = tab();
    a.capture(303, 'Gamma');
    expect(a.discoverOnlineAccounts().map((x) => x.characterId)).toEqual(['303']);
  });
  it('automatically selects a single character without showing a modal', async () => {
    const a = tab();
    expect((await a.chooseImportAccount()).characterId).toBe('101');
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('shows multiple characters, selects the clicked character, and stops its timer', async () => {
    const store = new Map();
    const a = tab(store);
    tab(store, 202, '<Beta>');
    const promise = a.chooseImportAccount();
    const button = [...document.querySelectorAll('dialog button')].find((x) => x.textContent.includes('<Beta>'));
    expect(button.querySelector('Beta')).toBeNull();
    button.click();
    expect((await promise).characterId).toBe('202');
    expect(document.querySelector('dialog')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancel returns no selection and leaves no timers', async () => {
    const store = new Map();
    const a = tab(store);
    tab(store, 202, 'Beta');
    const promise = a.chooseImportAccount();
    [...document.querySelectorAll('dialog button')].find((x) => x.textContent === '取消').click();
    expect(await promise).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('removes offline characters while the list is open', async () => {
    const store = new Map();
    const a = tab(store);
    const b = tab(store, 202, 'Beta');
    const promise = a.chooseImportAccount();
    store.delete(prefix + b.MAIN_SITE_TAB_ID);
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('dialog').textContent).not.toContain('Beta');
    document.querySelector('dialog button').click();
    expect((await promise).characterId).toBe('101');
  });
  it('uses site theme tokens, centered scrolling layout, and name/ID-only primary cards', async () => {
    const store = new Map();
    const a = tab(store);
    tab(store, 202, 'Beta');
    const promise = a.chooseImportAccount();
    const dialog = document.querySelector('dialog');
    const css = dialog.querySelector('style').textContent;
    expect(css).toContain('inset: 0; margin: auto');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('background: var(--card)');
    expect(css).toContain('background: var(--primary)');
    expect(css).toContain('color: var(--primary-foreground)');
    const choices = [...dialog.querySelectorAll('.mwi-account-choice')];
    expect(choices.map((x) => x.textContent)).toEqual(['AlphaID 101', 'BetaID 202']);
    expect(choices.some((x) => x.textContent.includes('milkywayidle'))).toBe(false);
    dialog.querySelector('.mwi-account-cancel').click();
    expect(await promise).toBeNull();
  });
  it('dismisses on outside click, but not padding or a drag beginning inside', async () => {
    const store = new Map();
    const a = tab(store);
    tab(store, 202, 'Beta');
    const promise = a.chooseImportAccount();
    const dialog = document.querySelector('dialog');
    dialog.getBoundingClientRect = () => ({ left: 100, right: 500, top: 100, bottom: 400 });
    function event(type, x, y) {
      dialog.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    event('pointerdown', 110, 110);
    event('click', 110, 110);
    expect(document.querySelector('dialog')).toBe(dialog);
    event('pointerdown', 110, 110);
    event('click', 10, 10);
    expect(document.querySelector('dialog')).toBe(dialog);
    event('pointerdown', 10, 10);
    event('click', 10, 10);
    expect(await promise).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('Escape dismisses and restores focus to the launch button', async () => {
    const store = new Map();
    const a = tab(store);
    tab(store, 202, 'Beta');
    const launch = document.createElement('button');
    document.body.append(launch);
    launch.focus();
    const promise = a.chooseImportAccount();
    document.querySelector('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await promise).toBeNull();
    expect(document.activeElement).toBe(launch);
    // jsdom focus queues a zero-delay selection task; drain it before checking interval cleanup.
    vi.advanceTimersByTime(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports no online characters instead of broadcasting an untargeted request', () => {
    const a = tab();
    a.store.clear();
    expect(() => a.chooseImportAccount()).toThrow('未发现在线角色');
  });
  it('only the selected tab responds and includes the selected character payload', async () => {
    const store = new Map();
    const a = tab(store);
    const b = tab(store, 202, 'Beta');
    const request = {
      requestId: 'selected',
      account: b.currentAccountIdentity(),
      createdAt: Date.now(),
      target: 'active-player',
      language: 'zh',
    };
    await a.processTargetedImportRequest(request);
    expect(store.has(responsePrefix + 'selected')).toBe(false);
    await b.processTargetedImportRequest(request);
    const response = store.get(responsePrefix + 'selected');
    expect(response.ok).toBe(true);
    expect(response.payload.character.id).toBe(202);
    expect(response.account.tabId).toBe(b.MAIN_SITE_TAB_ID);
  });
  it('rejects stale requests and selection made before a character switch', async () => {
    const a = tab();
    const account = a.currentAccountIdentity();
    a.capture(303, 'Gamma');
    await a.processTargetedImportRequest({ requestId: 'wrong', account, createdAt: Date.now() });
    await a.processTargetedImportRequest({
      requestId: 'old',
      account: a.currentAccountIdentity(),
      createdAt: Date.now() - 13000,
    });
    expect([...a.store.keys()].some((x) => x.startsWith(responsePrefix))).toBe(false);
  });
  it('invalidates asynchronous team import if the character changes while building the response', async () => {
    const a = tab();
    const pending = a.processTargetedImportRequest({
      requestId: 'switch',
      account: a.currentAccountIdentity(),
      createdAt: Date.now(),
      target: 'auto',
      language: 'zh',
    });
    a.capture(303, 'Gamma');
    await pending;
    expect(a.store.get(responsePrefix + 'switch')).toMatchObject({
      ok: false,
      message: '主站角色已切换，请重新选择后导入。',
    });
  });
  it('uses separate request/response keys and cleans them after success', async () => {
    const a = tab();
    const identity = a.currentAccountIdentity();
    const pending = a.requestAccountImport(identity, 'active-player', 'zh');
    const request = a.store.get(requestPrefix + identity.tabId);
    expect(a.store.has('mwi.tm.import.request.v1')).toBe(false);
    await a.processTargetedImportRequest(request);
    await vi.advanceTimersByTimeAsync(250);
    expect((await pending).payload.character.id).toBe(101);
    expect(a.store.has(requestPrefix + identity.tabId)).toBe(false);
    expect(a.store.has(responsePrefix + request.requestId)).toBe(false);
    expect(a.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a response with the correct request ID but wrong account', async () => {
    const a = tab();
    const identity = a.currentAccountIdentity();
    const pending = a.requestAccountImport(identity, 'active-player', 'zh');
    const assertion = expect(pending).rejects.toThrow('身份不匹配');
    const request = a.store.get(requestPrefix + identity.tabId);
    a.store.set(responsePrefix + request.requestId, {
      requestId: request.requestId,
      account: { ...identity, characterId: '999' },
    });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(a.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out rather than importing another account and cleans pending keys', async () => {
    const a = tab();
    const identity = a.currentAccountIdentity();
    const pending = a.requestAccountImport(identity, 'auto', 'zh');
    const assertion = expect(pending).rejects.toThrow('主站标签页响应超时');
    await vi.advanceTimersByTimeAsync(12000);
    await assertion;
    expect(a.store.has(requestPrefix + identity.tabId)).toBe(false);
    expect(a.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
