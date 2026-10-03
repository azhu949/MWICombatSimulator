import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createSerialMutationQueue } from '../playerConfigMutationQueue.js';
import { applyTampermonkeyImportMessage } from '../tampermonkeyImportBridge.js';
import { createMainSiteShareProfileFixture } from './fixtures/mainSiteShareProfileFixture.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

// 玩家配置写入串行器（2026-10-03）回归：导入与快照链路由同步改异步后，await 窗口内的其它
// 写入（用户手动导入、快照恢复、主站桥接消息）不得被先发起者的后置清除动作误伤——团队导入
// 首个成员携带 clearPlayerIds=['1'..'5']，若其 clearPlayerSlots 晚于窗口内落地的用户写入，
// 用户刚导入的槽位会被整槽清空（services/tampermonkeyImportBridge.js:69-71）。
function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

// 把「第一次资产分刷新」扣成悬停窗口：导入入口 await 该 Promise 时确实让出执行权，稳定复现
// 按需加载/刷新造成的可交错窗口（不依赖真实 chunk 冷加载的时序）。arrived 在窗口真正打开
// （即待测入口已卡在该 await 上）后决议，避免调用方抢跑释放。
function stallFirstAssetScoreRefresh(simulator) {
  let releaseFirstCall = null;
  let signalArrived = null;
  let callCount = 0;
  const arrived = new Promise((resolve) => {
    signalArrived = resolve;
  });

  vi.spyOn(simulator, 'refreshAssetScores').mockImplementation(() => {
    callCount += 1;
    if (callCount === 1) {
      const stalled = new Promise((resolve) => {
        releaseFirstCall = resolve;
      });
      signalArrived();
      return stalled;
    }
    return Promise.resolve();
  });

  return {
    arrived,
    release: () => releaseFirstCall?.(),
  };
}

describe('createSerialMutationQueue', () => {
  it('runs queued operations strictly in call order', async () => {
    const runExclusive = createSerialMutationQueue();
    const order = [];

    const first = runExclusive(async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push('first:end');
      return 'first';
    });
    const second = runExclusive(async () => {
      order.push('second');
      return 'second';
    });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('forwards a rejection to its own caller and keeps the queue alive', async () => {
    const runExclusive = createSerialMutationQueue();
    const order = [];

    const failing = runExclusive(async () => {
      order.push('failing');
      throw new Error('weak network blip');
    });
    const following = runExclusive(async () => {
      order.push('following');
      return 'recovered';
    });

    await expect(failing).rejects.toThrow('weak network blip');
    await expect(following).resolves.toBe('recovered');
    expect(order).toEqual(['failing', 'following']);
  });
});

describe('import link serialization', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  it('completes a stalled import before a second import issued inside its await window', async () => {
    const simulator = useSimulatorStore();
    const stall = stallFirstAssetScoreRefresh(simulator);
    const completionOrder = [];

    const first = simulator
      .importSoloConfig(JSON.stringify(createMainSiteShareProfileFixture({ characterName: 'First One' })), '1')
      .then(() => completionOrder.push('first'));
    const second = simulator
      .importSoloConfig(JSON.stringify(createMainSiteShareProfileFixture({ characterName: 'Second Two' })), '2')
      .then(() => completionOrder.push('second'));

    await stall.arrived;
    stall.release();
    await Promise.all([first, second]);

    // 调用顺序 = 完成顺序：后发起者不得插队到先发起者的 await 窗口里。
    expect(completionOrder).toEqual(['first', 'second']);
    expect(simulator.players[0].name).toBe('First One');
    expect(simulator.players[1].name).toBe('Second Two');
  });

  it('serializes the group import and the snapshot restore behind an in-flight solo import', async () => {
    const simulator = useSimulatorStore();
    // 组队载荷先导出（导出入口本身会 await 资产分刷新），避免占用下面的悬停窗口。
    const groupText = await simulator.exportGroupConfig();
    const stall = stallFirstAssetScoreRefresh(simulator);
    const completionOrder = [];

    const soloImport = simulator
      .importSoloConfig(JSON.stringify(createMainSiteShareProfileFixture({ characterName: 'Solo One' })), '1')
      .then(() => completionOrder.push('solo'));
    const groupImport = simulator.importGroupConfig(groupText).then(() => completionOrder.push('group'));
    const snapshotRestore = simulator.loadPlayerDataSnapshot().then(() => completionOrder.push('snapshot'));

    await stall.arrived;
    stall.release();
    await Promise.all([soloImport, groupImport, snapshotRestore]);

    // 三个入口共用同一队列：组队导入与快照恢复都排在在飞的单人导入之后。
    expect(completionOrder).toEqual(['solo', 'group', 'snapshot']);
    // 组队载荷导出时槽位为空，故组队导入落地后槽位 1 回到空配置（证明它确实在单人导入之后应用）。
    expect(simulator.players[0].name).toBe('Player 1');
  });

  it('keeps a user import issued while a bridged team import was stalled', async () => {
    const simulator = useSimulatorStore();
    const stall = stallFirstAssetScoreRefresh(simulator);

    const bridgeImport = applyTampermonkeyImportMessage(simulator, {
      requestId: 'team-member-1',
      targetPlayerId: '1',
      clearPlayerIds: ['1', '2', '3', '4', '5'],
      resetTeamSelection: true,
      selectAfterImport: true,
      activateAfterImport: false,
      payload: createMainSiteShareProfileFixture({ characterName: 'Team Alpha' }),
    });
    const userImport = simulator.importSoloConfig(
      JSON.stringify(createMainSiteShareProfileFixture({ characterName: 'User Three' })),
      '3',
    );

    await stall.arrived;
    stall.release();
    await Promise.all([bridgeImport, userImport]);

    // 桥接侧后置动作 clearPlayerSlots(['2','3','4','5']) 先执行，窗口内落地的用户写入随后应用：
    // 槽位 3 必须保留用户内容，而槽位 2/4/5 仍按团队导入语义被清空。
    expect(simulator.players[0].name).toBe('Team Alpha');
    expect(simulator.players[2].name).toBe('User Three');
    expect(simulator.players[1].name).toBe('Player 2');
    expect(simulator.players[3].name).toBe('Player 4');
    expect(simulator.players[4].name).toBe('Player 5');
  });
});
