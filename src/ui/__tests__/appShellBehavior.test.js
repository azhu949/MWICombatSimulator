// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, nextTick, reactive } from 'vue';
import AppSidebar from '../components/AppSidebar.vue';
import CombatCommandBar from '../components/CombatCommandBar.vue';
import PlayerCardsStrip from '../components/PlayerCardsStrip.vue';
import { Sidebar, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar/index.js';

const EmptyPage = { template: '<div />' };

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/home',
        name: 'home',
        component: EmptyPage,
        meta: { navLabelKey: 'home', navLabel: 'Home', navGroup: 'simulation', navOrder: 1 },
      },
      {
        path: '/queue',
        name: 'queue',
        component: EmptyPage,
        meta: { navLabelKey: 'queue', navLabel: 'Queue', navGroup: 'support', navOrder: 2 },
      },
      {
        path: '/patch-notes',
        name: 'patch-notes',
        component: EmptyPage,
        meta: { navLabelKey: 'patchNotes', navLabel: 'Patch Notes', navHidden: true },
      },
    ],
  });
}

// 资产分行为用例共用：合法快照（徽章/面板可渲染，明细文本非空可复制）。
const assetScoreSnapshot = {
  totalGold: 1_000_000,
  sections: { equipment: 1_000_000, house: 0, abilities: 0, shrine: 0 },
  items: { equipment: [], houseRooms: [], abilities: [], shrine: [] },
};

// Teleport 到 body 的明细面板选择器（z-[100] 类名含方括号，querySelector 需转义）。
const assetScorePanelSelector = '.fixed.z-\\[100\\]';

function mountPlayerCardsStrip(assetScore) {
  return mount(PlayerCardsStrip, {
    props: {
      players: [{ id: 'player-1', name: 'Player One', selected: true, assetScore }],
    },
  });
}

describe('application shell behavior', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
    // 复制用例会启用 fake timers；若单用例中途失败，这里兜底恢复真实时钟，
    // 避免假时钟泄漏导致后续用例的 flushPromises（setImmediate 实现）悬挂。
    vi.useRealTimers();
  });

  it('marks the current sidebar route active', async () => {
    const router = createTestRouter();
    await router.push('/queue');
    await router.isReady();

    const wrapper = mount(
      defineComponent({
        components: { AppSidebar, SidebarProvider },
        template: '<SidebarProvider><AppSidebar version="1.0.0" /></SidebarProvider>',
      }),
      { global: { plugins: [router] }, attachTo: document.body },
    );

    const queueLink = wrapper.findAll('a').find((link) => link.text().includes('Queue'));
    expect(queueLink.classes()).toContain('bg-sidebar-accent');
  });

  it('links to patch notes and exposes the semantic unread indicator', async () => {
    const router = createTestRouter();
    await router.push('/home');
    await router.isReady();

    const wrapper = mount(
      defineComponent({
        components: { AppSidebar, SidebarProvider },
        template:
          '<SidebarProvider><AppSidebar version="1.0.0" :unread-patch-notes-count="3" patch-notes-label="Patch Notes, 3 unread versions" /></SidebarProvider>',
      }),
      { global: { plugins: [router] }, attachTo: document.body },
    );

    const patchNotesLink = wrapper.findAll('a').find((link) => link.find('.sidebar-unread-badge').exists());
    expect(patchNotesLink).toBeTruthy();
    expect(patchNotesLink.attributes('aria-label')).toBe('Patch Notes, 3 unread versions');
    expect(patchNotesLink.find('.sidebar-unread-indicator').exists()).toBe(true);
    expect(patchNotesLink.find('.sidebar-unread-badge').text()).toBe('3');

    await router.push('/patch-notes');
    await flushPromises();
    expect(patchNotesLink.classes()).toContain('sidebar-action-active');
  });

  it('caps the unread badge at 99+', async () => {
    const router = createTestRouter();
    await router.push('/home');
    await router.isReady();

    const wrapper = mount(
      defineComponent({
        components: { AppSidebar, SidebarProvider },
        template: '<SidebarProvider><AppSidebar version="1.0.0" :unread-patch-notes-count="120" /></SidebarProvider>',
      }),
      { global: { plugins: [router] }, attachTo: document.body },
    );

    const patchNotesLink = wrapper.findAll('a').find((link) => link.find('.sidebar-unread-badge').exists());
    expect(patchNotesLink.find('.sidebar-unread-badge').text()).toBe('99+');
  });

  it('opens the unread preview without navigating when unread entries exist', async () => {
    const router = createTestRouter();
    await router.push('/home');
    await router.isReady();

    const wrapper = mount(
      defineComponent({
        components: { AppSidebar, SidebarProvider },
        template: '<SidebarProvider><AppSidebar version="1.0.0" :unread-patch-notes-count="3" /></SidebarProvider>',
      }),
      { global: { plugins: [router] }, attachTo: document.body },
    );

    const patchNotesLink = wrapper.findAll('a').find((link) => link.find('.sidebar-unread-badge').exists());
    await patchNotesLink.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('home');
    expect(wrapper.findComponent(AppSidebar).emitted('open-patch-notes')).toHaveLength(1);
  });

  it('navigates to patch notes when there are no unread entries', async () => {
    const router = createTestRouter();
    await router.push('/home');
    await router.isReady();

    const wrapper = mount(
      defineComponent({
        components: { AppSidebar, SidebarProvider },
        template: '<SidebarProvider><AppSidebar version="1.0.0" /></SidebarProvider>',
      }),
      { global: { plugins: [router] }, attachTo: document.body },
    );

    const patchNotesLink = wrapper.findAll('a').find((link) => link.attributes('aria-label') === 'Patch Notes');
    await patchNotesLink.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('patch-notes');
  });

  it('persists desktop sidebar collapse state', async () => {
    const wrapper = mount(
      defineComponent({
        components: { SidebarProvider, SidebarTrigger },
        template: '<SidebarProvider><SidebarTrigger /></SidebarProvider>',
      }),
    );

    await wrapper.get('button').trigger('click');
    expect(localStorage.getItem('mwi.ui.sidebar.v1')).toBe('collapsed');
    expect(wrapper.get('button').attributes('aria-label')).toBe('Expand navigation');
  });

  it('closes the mobile sidebar when the viewport crosses into desktop', async () => {
    let mediaListener;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({
      matches: false,
      addEventListener: (_event, listener) => {
        mediaListener = listener;
      },
      removeEventListener: () => {},
    });

    const wrapper = mount(
      defineComponent({
        components: { Sidebar, SidebarProvider, SidebarTrigger },
        template:
          '<SidebarProvider><SidebarTrigger mobile /><Sidebar><span>Navigation</span></Sidebar></SidebarProvider>',
      }),
      { attachTo: document.body },
    );

    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    mediaListener({ matches: true });
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    wrapper.unmount();
    window.matchMedia = originalMatchMedia;
  });

  it('preserves command disabled rules and emits the primary action', async () => {
    const wrapper = mount(CombatCommandBar, {
      props: {
        hasBaseline: true,
        itemCount: 1,
        queueActionsDisabled: false,
      },
      attachTo: document.body,
    });

    const runButtons = wrapper.findAll('button').filter((button) => button.text().includes('Run Queue'));
    expect(runButtons.length).toBe(2);
    expect(runButtons.every((button) => button.attributes('disabled') === undefined)).toBe(true);
    await runButtons[0].trigger('click');
    expect(wrapper.emitted('run-queue')).toHaveLength(1);
  });

  it('switches the Home simulation action from start to stop', async () => {
    const wrapper = mount(CombatCommandBar, {
      props: { showSimulationActions: true, simulationRunning: false },
    });

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('start-simulation')).toHaveLength(1);

    await wrapper.setProps({ simulationRunning: true });
    const stopButton = wrapper.findAll('button').find((button) => button.text().includes('Stop'));
    expect(stopButton).toBeTruthy();
    await stopButton.trigger('click');
    expect(wrapper.emitted('stop-simulation')).toHaveLength(1);
  });

  it('shows the party locked by the active queue baseline', () => {
    const wrapper = mount(CombatCommandBar, {
      props: { partySummaryText: 'Alice / Bob' },
    });

    expect(wrapper.text()).toContain('Locked party');
    expect(wrapper.text()).toContain('Alice / Bob');
  });

  it('only handles player keyboard selection on the player control itself', () => {
    const wrapper = mount(PlayerCardsStrip, {
      props: { players: [{ id: 'player-1', name: 'Player One', selected: true }] },
    });
    const playerControl = wrapper.get('[role="button"]');
    const nameInput = playerControl.findAll('input')[0];
    const inputSpace = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

    expect(nameInput.element.dispatchEvent(inputSpace)).toBe(true);
    expect(inputSpace.defaultPrevented).toBe(false);
    expect(wrapper.emitted('select-player')).toBeUndefined();

    const controlSpace = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    expect(playerControl.element.dispatchEvent(controlSpace)).toBe(false);
    expect(controlSpace.defaultPrevented).toBe(true);
    expect(wrapper.emitted('select-player')).toEqual([['player-1']]);
  });

  it('annotates incomplete asset score sections in the badge tooltip', () => {
    const wrapper = mount(PlayerCardsStrip, {
      props: {
        players: [
          {
            id: 'player-1',
            name: 'Player One',
            selected: true,
            assetScore: {
              totalGold: 1000000,
              sections: { equipment: 1000000, house: 0, abilities: 0, shrine: 0 },
              items: {
                equipment: [],
                houseRooms: [{ roomHrid: '/house_rooms/kitchen', level: 1, value: 0, incomplete: true }],
                abilities: [],
                shrine: [],
              },
            },
          },
        ],
      },
    });

    // T3（2026-08-31）：缺失分项按 0 计并在 tooltip 置顶标注缺哪块。
    const badge = wrapper.get('span[title]');
    expect(badge.attributes('title')).toContain('Incomplete (counted as 0): House');
  });

  it('omits the incomplete tooltip line when no section is incomplete', () => {
    const wrapper = mount(PlayerCardsStrip, {
      props: {
        players: [
          {
            id: 'player-1',
            name: 'Player One',
            selected: true,
            assetScore: {
              totalGold: 1000000,
              sections: { equipment: 1000000, house: 0, abilities: 0, shrine: 0 },
              items: {
                equipment: [],
                houseRooms: [{ roomHrid: '/house_rooms/kitchen', level: 1, value: 0 }],
                abilities: [],
                shrine: [],
              },
            },
          },
        ],
      },
    });

    // 旧快照/无缺失：tooltip 不出现缺失分项行。
    const badge = wrapper.get('span[title]');
    expect(badge.attributes('title')).not.toContain('Incomplete');
  });

  it('closes the asset score details panel when its snapshot is nulled or the player object is replaced', async () => {
    const assetScore = {
      totalGold: 1_000_000,
      sections: { equipment: 1_000_000, house: 0, abilities: 0, shrine: 0 },
      items: { equipment: [], houseRooms: [], abilities: [], shrine: [] },
    };
    // props 是浅响应的：原地变更须经 reactive 数组才能触发组件内的 watch
    // （真实链路中 players 来自 Pinia store，本身就是深响应对象）。
    const players = reactive([{ id: 'player-1', name: 'Player One', selected: true, assetScore }]);
    const wrapper = mount(PlayerCardsStrip, { props: { players } });
    const panelSelector = assetScorePanelSelector;

    // 面板打开后，store 重算写回「新的 assetScore 对象」（同一玩家引用）不应误关。
    await wrapper.get('span[title]').trigger('click');
    expect(document.body.querySelector(panelSelector)).toBeTruthy();
    players[0].assetScore = { ...assetScore, totalGold: 2_000_000 };
    await nextTick();
    expect(document.body.querySelector(panelSelector)).toBeTruthy();

    // 路径①：快照被原地置 null（行情不可用时签名不一致重算且无可算数据）→ 自动关闭。
    players[0].assetScore = null;
    await nextTick();
    expect(document.body.querySelector(panelSelector)).toBeNull();

    // 路径②：玩家对象被整体替换（导入/清空配置重建对象）→ 引用失配，自动关闭。
    players[0].assetScore = assetScore;
    await nextTick();
    await wrapper.get('span[title]').trigger('click');
    expect(document.body.querySelector(panelSelector)).toBeTruthy();
    await wrapper.setProps({ players: [{ id: 'player-1', name: 'Player Two', selected: true, assetScore }] });
    expect(document.body.querySelector(panelSelector)).toBeNull();

    wrapper.unmount();
  });

  it('renders no asset score badge when the player has no asset score snapshot', () => {
    const wrapper = mountPlayerCardsStrip(null);

    // 行为级兜底（不锁定 v-if 写法，重构友好）：无快照时卡片本身仍渲染（名称输入框在），
    // 徽章则彻底不渲染——无 tooltip 也无 aria-label；若 v-if 失守，
    // formatAssetScoreLabel(null) 会把徽章以 "0" 渲染出来，此断言即失败。
    expect(wrapper.find('input[aria-label="Player"]').exists()).toBe(true);
    expect(wrapper.find('span[title]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Gear Score"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('toggles the asset score details panel open and closed from the badge', async () => {
    const wrapper = mountPlayerCardsStrip(assetScoreSnapshot);
    const badge = wrapper.get('span[title]');

    await badge.trigger('click');
    expect(document.body.querySelector(assetScorePanelSelector)).toBeTruthy();
    // 再次点击同一徽章：toggle-off 分支关闭（此前只有「快照置空自动关闭」有行为断言）。
    await badge.trigger('click');
    expect(document.body.querySelector(assetScorePanelSelector)).toBeNull();
    // 关闭路径彻底清理状态，再次点击可重新打开。
    await badge.trigger('click');
    expect(document.body.querySelector(assetScorePanelSelector)).toBeTruthy();

    wrapper.unmount();
  });

  it('closes the asset score details panel via the close button, Escape, and outside clicks', async () => {
    const wrapper = mountPlayerCardsStrip(assetScoreSnapshot);
    const badge = wrapper.get('span[title]');
    const openPanel = async () => {
      await badge.trigger('click');
      expect(document.body.querySelector(assetScorePanelSelector)).toBeTruthy();
    };

    // ✕ 关闭按钮。
    await openPanel();
    document.body.querySelector(`${assetScorePanelSelector} button[aria-label="Close"]`).click();
    await nextTick();
    expect(document.body.querySelector(assetScorePanelSelector)).toBeNull();

    // Esc 全局关闭。
    await openPanel();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(document.body.querySelector(assetScorePanelSelector)).toBeNull();

    // 点击面板/徽章之外关闭（两者均已 @click.stop，不会误关）。
    await openPanel();
    document.body.click();
    await nextTick();
    expect(document.body.querySelector(assetScorePanelSelector)).toBeNull();

    wrapper.unmount();
  });

  it('switches the asset score details panel to another player when their badge is clicked', async () => {
    const wrapper = mount(PlayerCardsStrip, {
      props: {
        players: [
          { id: 'player-1', name: 'Player One', selected: true, assetScore: assetScoreSnapshot },
          { id: 'player-2', name: 'Player Two', selected: false, assetScore: assetScoreSnapshot },
        ],
      },
    });
    const badges = wrapper.findAll('span[title]');
    expect(badges).toHaveLength(2);

    await badges[0].trigger('click');
    const firstPanel = document.body.querySelector(assetScorePanelSelector);
    expect(firstPanel).toBeTruthy();
    expect(firstPanel.textContent).toContain('Player One');

    // 面板开着时点击另一玩家徽章：切换明细对象而非关闭（toggle 的第三条分支）。
    await badges[1].trigger('click');
    const panel = document.body.querySelector(assetScorePanelSelector);
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Player Two');
    expect(panel.textContent).not.toContain('Player One');

    wrapper.unmount();
  });

  it('shows Copied after a successful clipboard write and resets the label', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = mountPlayerCardsStrip(assetScoreSnapshot);
    await wrapper.get('span[title]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector(assetScorePanelSelector)).toBeTruthy();
    const copyButton = Array.from(document.body.querySelector(assetScorePanelSelector).querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Copy',
    );

    // fake timers 只接管复制阶段：标签复位的 setTimeout(1600) 落在假时钟上。
    // flushPromises 底层走 setImmediate，假时钟下会悬挂，故用 advanceTimersByTimeAsync 推进。
    vi.useFakeTimers();
    copyButton.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledTimes(1);
    // 复制的是明细全文（含合计行），不是空串或占位符。
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Total'));
    expect(copyButton.textContent.trim()).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1600);
    await nextTick();
    expect(copyButton.textContent.trim()).toBe('Copy');

    vi.useRealTimers();
    wrapper.unmount();
    delete navigator.clipboard;
  });

  it('shows Copy failed when the clipboard write rejects and resets the label', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = mountPlayerCardsStrip(assetScoreSnapshot);
    await wrapper.get('span[title]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector(assetScorePanelSelector)).toBeTruthy();
    const copyButton = Array.from(document.body.querySelector(assetScorePanelSelector).querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Copy',
    );

    vi.useFakeTimers();
    copyButton.click();
    await vi.advanceTimersByTimeAsync(0);
    // 失败分支：按钮反馈「Copy failed」而非「Copied」，同样在 1.6s 后复位为「Copy」。
    expect(copyButton.textContent.trim()).toBe('Copy failed');
    await vi.advanceTimersByTimeAsync(1600);
    await nextTick();
    expect(copyButton.textContent.trim()).toBe('Copy');

    vi.useRealTimers();
    wrapper.unmount();
    delete navigator.clipboard;
  });

  it('opens the mobile overflow menu', async () => {
    const wrapper = mount(CombatCommandBar, { attachTo: document.body });
    await wrapper.get('button[aria-label="More actions"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Set Baseline');
    expect(document.body.textContent).toContain('Clear Queue');
  });
});
