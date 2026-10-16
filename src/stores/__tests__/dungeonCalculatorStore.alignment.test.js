// 地下城计算器 store 配置模型与口径开关测试（两项「默认关、可选开」开关）：
// 覆盖默认配置、持久化迁移/收敛、各 setter 的互斥语义、buildParams 到引擎的映射，
// 以及 effectivePriceTable 的两段管线（口径变换 → 页面手动改价最高优先）。
// 精炼率已固定为脚本共识逐档常量（2026-10-11 用户裁决：无切换控件），故不再覆盖 mode/override 字段。
// 两个开关为「披风不计算收益」与「牛铃不计算收益」（2026-10-12 用户裁决，替换原「按镜价计税」/「按卖出侧取袋价」）。
// 不触网 / 不触 worker：价格表由用例直接写入 simulator.pricing.priceTable。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { toRaw } from 'vue';
import { useSimulatorStore } from '../simulatorStore.js';
import {
  createDefaultDungeonCalculatorConfig,
  DUNGEON_CALCULATOR_STORAGE_VERSION,
  DUNGEON_KEY_SOURCES,
  normalizeDungeonCalculatorPersistedState,
  SCRIPT_REFINEMENT_RATE_BY_TIER,
  useDungeonCalculatorStore,
} from '../dungeonCalculatorStore.js';
import {
  BAG_OF_10_COWBELLS_HRID,
  COWBELL_HRID,
  createDefaultPriceTable,
  MIRROR_OF_PROTECTION_HRID,
  NON_TRADABLE_CAPE_HRIDS,
} from '../../services/marketPriceService.js';

// 披风基础形态的静态收购价（itemDetail sellPrice，对齐 marketPriceService 建表初值）。
const CAPE_BASE_VENDOR = 100000;

function createLocalStorageMock() {
  const storage = new Map();
  return {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

function createStores() {
  const simulator = useSimulatorStore();
  const calculator = useDungeonCalculatorStore();
  return { simulator, calculator };
}

function findItemRow(result, itemHrid) {
  return result.items.find((row) => row.itemHrid === itemHrid) || null;
}

// 对齐用价格表：默认表（含 7 件披风基础形态）叠加铃袋 / 保护之镜行情。
function createAlignedPriceTable() {
  const table = createDefaultPriceTable();
  table[BAG_OF_10_COWBELLS_HRID] = { ask: 1090000, bid: 1060000, vendor: 0 };
  table[MIRROR_OF_PROTECTION_HRID] = { ask: 150000, bid: 123456, vendor: 200000 };
  return table;
}

describe('dungeonCalculatorStore 配置模型（对齐口径）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('默认配置与导出常量', () => {
    it('字段与默认值：精炼率字段已移除 / 两开关 false / 回收 income / buff 20', () => {
      const config = createDefaultDungeonCalculatorConfig();

      // 精炼率固定为脚本共识逐档常量：config 不再携带 mode / override 字段（2026-10-11 用户裁决）。
      expect('refinementRateMode' in config).toBe(false);
      expect('refinementRateOverride' in config).toBe(false);
      expect(config.excludeCapeValue).toBe(false);
      expect('capeMirrorValuation' in config).toBe(false);
      expect(config.excludeCowbellValue).toBe(false);
      expect('cowbellSidePricing' in config).toBe(false);
      expect(config.chestKeyRecoveryMode).toBe('income');
      expect(config.communityBuffLevel).toBe(20);
      // 工匠茶默认开 / 暴饮之囊默认关且等级 0（2026-10-12 用户裁决）。
      expect(config.artisanTea).toBe(true);
      expect(config.guzzlingPouch).toBe(false);
      expect(config.guzzlingLevel).toBe(0);
      // 旧布尔字段已移除（页面/测试不得再引用）。
      expect('chestKeyRecovery' in config).toBe(false);
    });

    it('脚本逐档精炼率常量与钥匙来源白名单冻结且取值域一致', () => {
      expect(SCRIPT_REFINEMENT_RATE_BY_TIER).toEqual({ 0: 0, 1: 0.33, 2: 1.0 });
      expect(Object.isFrozen(SCRIPT_REFINEMENT_RATE_BY_TIER)).toBe(true);
      // 钥匙来源只保留 market / craft（hybrid 已移除，2026-10-12 用户裁决）。
      expect(DUNGEON_KEY_SOURCES).toEqual(['market', 'craft']);
      expect(Object.isFrozen(DUNGEON_KEY_SOURCES)).toBe(true);
      expect(DUNGEON_KEY_SOURCES).not.toContain('hybrid');
    });

    it('store 不再暴露精炼率 / 回收落点 setter（口径固定），其余 action 保持', () => {
      const { calculator } = createStores();

      expect(calculator.setRefinementRateMode).toBeUndefined();
      expect(calculator.setRefinementRateOverride).toBeUndefined();
      expect(typeof calculator.setExcludeCapeValue).toBe('function');
      expect(calculator.setCapeMirrorValuation).toBeUndefined();
      expect(typeof calculator.setExcludeCowbellValue).toBe('function');
      expect(calculator.setCowbellSidePricing).toBeUndefined();
      expect(calculator.setChestKeyRecoveryMode).toBeUndefined();
      expect(calculator.setChestKeyRecovery).toBeUndefined();
      expect(calculator.config.chestKeyRecoveryMode).toBe('income');
      expect(calculator.config.communityBuffLevel).toBe(20);
    });
  });

  describe('持久化迁移与一致性收敛', () => {
    it('legacy 布尔回收字段一律归一到 income（2026-10-15 固定收入侧）', () => {
      const off = normalizeDungeonCalculatorPersistedState({ config: { chestKeyRecovery: false } });
      expect(off.config.chestKeyRecoveryMode).toBe('income');
      expect('chestKeyRecovery' in off.config).toBe(false);

      const on = normalizeDungeonCalculatorPersistedState({ config: { chestKeyRecovery: true } });
      expect(on.config.chestKeyRecoveryMode).toBe('income');

      const missing = normalizeDungeonCalculatorPersistedState({});
      expect(missing.config.chestKeyRecoveryMode).toBe('income');
    });

    it('legacy 精炼率字段（mode/override）一律丢弃：旧数据统一迁到固定脚本共识', () => {
      const migrated = normalizeDungeonCalculatorPersistedState({ config: { refinementRateOverride: 0.5 } });
      expect('refinementRateMode' in migrated.config).toBe(false);
      expect('refinementRateOverride' in migrated.config).toBe(false);

      const zero = normalizeDungeonCalculatorPersistedState({ config: { refinementRateOverride: 0 } });
      expect('refinementRateOverride' in zero.config).toBe(false);

      const withMode = normalizeDungeonCalculatorPersistedState({
        config: { refinementRateMode: 'official', refinementRateOverride: 0.75 },
      });
      expect('refinementRateMode' in withMode.config).toBe(false);
      expect('refinementRateOverride' in withMode.config).toBe(false);

      const bogus = normalizeDungeonCalculatorPersistedState({
        config: { refinementRateMode: 'bogus', refinementRateOverride: 'bad' },
      });
      expect('refinementRateMode' in bogus.config).toBe(false);
      expect('refinementRateOverride' in bogus.config).toBe(false);
    });

    it('旧档任意回收落点一律归一到 income；两个对齐开关仅显式 true 开启', () => {
      const bogus = normalizeDungeonCalculatorPersistedState({
        config: { chestKeyRecoveryMode: 'bogus', chestKeyRecovery: false },
      });
      expect(bogus.config.chestKeyRecoveryMode).toBe('income');

      const legacyCost = normalizeDungeonCalculatorPersistedState({ config: { chestKeyRecoveryMode: 'cost' } });
      expect(legacyCost.config.chestKeyRecoveryMode).toBe('income');

      const flags = normalizeDungeonCalculatorPersistedState({
        config: { excludeCapeValue: 'true', excludeCowbellValue: 1 },
      });
      expect(flags.config.excludeCapeValue).toBe(false);
      expect(flags.config.excludeCowbellValue).toBe(false);

      const enabled = normalizeDungeonCalculatorPersistedState({
        config: { excludeCapeValue: true, excludeCowbellValue: true },
      });
      expect(enabled.config.excludeCapeValue).toBe(true);
      expect(enabled.config.excludeCowbellValue).toBe(true);

      // 版本号未变（纯字段扩展，无破坏性迁移）。
      expect(enabled.version).toBe(DUNGEON_CALCULATOR_STORAGE_VERSION);
    });
  });

  describe('setters', () => {
    it('setExcludeCapeValue / setExcludeCowbellValue：仅显式 true 开启', () => {
      const { calculator } = createStores();

      expect(calculator.setExcludeCapeValue(true)).toBe(true);
      expect(calculator.config.excludeCapeValue).toBe(true);
      expect(calculator.setExcludeCapeValue(false)).toBe(true);
      expect(calculator.config.excludeCapeValue).toBe(false);
      expect(calculator.setExcludeCapeValue('true')).toBe(true);
      expect(calculator.config.excludeCapeValue).toBe(false);

      expect(calculator.setExcludeCowbellValue(true)).toBe(true);
      expect(calculator.config.excludeCowbellValue).toBe(true);
      expect(calculator.setExcludeCowbellValue(1)).toBe(true);
      expect(calculator.config.excludeCowbellValue).toBe(false);
    });

    it('setChestKeyRecoveryMode 已移除：回收固定 income 不再提供配置', () => {
      const { calculator } = createStores();

      expect(calculator.setChestKeyRecoveryMode).toBeUndefined();
      expect(calculator.config.chestKeyRecoveryMode).toBe('income');
    });

    it('store 不再暴露钥匙来源 setter（控件已移除）；配置字段保留默认 market', () => {
      const { calculator } = createStores();

      // 两个钥匙来源下拉整体移除（2026-10-15 用户裁决）：setter 不再暴露。
      expect(calculator.setEntryKeySource).toBeUndefined();
      expect(calculator.setChestKeySource).toBeUndefined();
      // 配置字段保留（旧档兼容 + buildParams 透传），默认 market。
      expect(calculator.config.entryKeySource).toBe('market');
      expect(calculator.config.chestKeySource).toBe('market');
    });

    it('setArtisanTea / setGuzzlingPouch / setGuzzlingLevel：默认开 / 仅显式 true / 等级钳制', () => {
      const { calculator } = createStores();

      // 工匠茶默认开：仅显式 false 关闭。
      expect(calculator.config.artisanTea).toBe(true);
      expect(calculator.setArtisanTea(false)).toBe(true);
      expect(calculator.config.artisanTea).toBe(false);
      expect(calculator.setArtisanTea(true)).toBe(true);
      expect(calculator.config.artisanTea).toBe(true);
      expect(calculator.setArtisanTea('true')).toBe(true);
      expect(calculator.config.artisanTea).toBe(true);

      // 暴饮之囊默认关：仅显式 true 开启。
      expect(calculator.config.guzzlingPouch).toBe(false);
      expect(calculator.setGuzzlingPouch(1)).toBe(true);
      expect(calculator.config.guzzlingPouch).toBe(false);
      expect(calculator.setGuzzlingPouch(true)).toBe(true);
      expect(calculator.config.guzzlingPouch).toBe(true);

      // 等级钳制 [0, 20]；脏值按 0 处理。
      expect(calculator.setGuzzlingLevel(7)).toBe(true);
      expect(calculator.config.guzzlingLevel).toBe(7);
      expect(calculator.setGuzzlingLevel(999)).toBe(true);
      expect(calculator.config.guzzlingLevel).toBe(20);
      expect(calculator.setGuzzlingLevel(-3)).toBe(true);
      expect(calculator.config.guzzlingLevel).toBe(0);
      expect(calculator.setGuzzlingLevel('abc')).toBe(true);
      expect(calculator.config.guzzlingLevel).toBe(0);
    });
  });

  describe('工匠茶 / 暴饮之囊自动检测与线程化', () => {
    it('当前角色装备暴饮之囊：自动勾选并填入其强化等级；换角色 / 换等级重新对齐', () => {
      const { simulator, calculator } = createStores();
      simulator.players = [
        {
          id: 'player1',
          name: 'P1',
          selected: true,
          equipment: { pouch: { itemHrid: '/items/guzzling_pouch', enhancementLevel: 7 } },
        },
        {
          id: 'player2',
          name: 'P2',
          selected: false,
          equipment: { pouch: { itemHrid: '/items/gluttonous_pouch', enhancementLevel: 9 } },
        },
      ];

      // 顶栏选中 P1（持有暴饮之囊 +7）：自动勾选并填 7。
      simulator.activePlayerId = 'player1';
      expect(calculator.activePlayerGuzzlingPouch).toEqual({ enhancementLevel: 7 });
      expect(calculator.config.guzzlingPouch).toBe(true);
      expect(calculator.config.guzzlingLevel).toBe(7);

      // 切到 P2（贪食之袋）：不是暴饮之囊，不自动勾选（保留手动勾选状态），等级归 0。
      simulator.activePlayerId = 'player2';
      expect(calculator.activePlayerGuzzlingPouch).toBeNull();
      expect(calculator.config.guzzlingLevel).toBe(0);

      // 切回 P1：重新套用自动值（+7）。
      simulator.activePlayerId = 'player1';
      expect(calculator.config.guzzlingPouch).toBe(true);
      expect(calculator.config.guzzlingLevel).toBe(7);
    });

    it('无导入角色 / 未装备 pouch：不自动勾选，等级保持 0', () => {
      const { simulator, calculator } = createStores();
      simulator.players = [];
      expect(calculator.activePlayerGuzzlingPouch).toBeNull();
      expect(calculator.config.guzzlingPouch).toBe(false);
      expect(calculator.config.guzzlingLevel).toBe(0);
    });

    it('buildParams 线程化：三字段进入引擎，且 craft 来源时自制成本按折扣下降', () => {
      const { simulator, calculator } = createStores();
      simulator.pricing.priceTable = createAlignedPriceTable();

      // 工匠茶默认开：craft 来源的自制门票成本低于无折扣基线。
      //（钥匙来源控件已移除，2026-10-15：旧档 craft 兼容路径由 config 字段直写表达。）
      calculator.config.entryKeySource = 'craft';
      expect(calculator.setCommunityBuffLevel(0)).toBe(true);
      const withTea = calculator.result.entryKeyCost;
      expect(calculator.result.artisanTea).toBe(true);

      expect(calculator.setArtisanTea(false)).toBe(true);
      const withoutTea = calculator.result.entryKeyCost;
      expect(calculator.result.artisanTea).toBe(false);
      expect(withoutTea).toBeGreaterThan(withTea);

      // 折扣比例 = 0.9（工匠茶 flatBoost 0.1，无暴饮加浓）。
      expect(withTea / withoutTea).toBeCloseTo(0.9, 9);

      // 暴饮之囊 +7 加浓：折扣进一步加深（0.88818）。
      expect(calculator.setArtisanTea(true)).toBe(true);
      expect(calculator.setGuzzlingPouch(true)).toBe(true);
      expect(calculator.setGuzzlingLevel(7)).toBe(true);
      const withPouch = calculator.result.entryKeyCost;
      expect(calculator.result.guzzlingPouch).toBe(true);
      expect(calculator.result.guzzlingLevel).toBe(7);
      expect(withPouch / withoutTea).toBeCloseTo(0.88818, 9);
      expect(withPouch).toBeLessThan(withTea);

      // market 来源不受影响（只作用 craft）：单把成本取市场价、每轮成本 = 市场价 × 每轮门票数
      //（= 普通箱数，2026-10-15 裁决）；明细仍为单行市场价（count 1）。
      // 配方侧 materialMultiplier 仍回显（表示「若走 craft 会用的系数」，不参与 market 成本）。
      calculator.config.entryKeySource = 'market';
      expect(calculator.result.entryKeyCostDetail.basis).toBe('market');
      expect(calculator.result.entryKeyCostDetail.cost).toBe(calculator.result.entryKeyCostDetail.marketCost);
      expect(calculator.result.entryKeyCost).toBe(
        calculator.result.entryKeyCostDetail.marketCost * calculator.result.entryKeyCostDetail.keysPerRun,
      );
      expect(calculator.result.entryKeyCostDetail.breakdown).toEqual([
        {
          itemHrid: calculator.result.entryKeyCostDetail.keyHrid,
          count: 1,
          unitPrice: calculator.result.entryKeyCostDetail.marketCost,
          subtotal: calculator.result.entryKeyCostDetail.marketCost,
        },
      ]);
    });

    it('持久化迁移：工匠茶缺键默认开、显式 false 关闭；暴饮之囊仅显式 true；等级钳制', () => {
      const missing = normalizeDungeonCalculatorPersistedState({});
      expect(missing.config.artisanTea).toBe(true);
      expect(missing.config.guzzlingPouch).toBe(false);
      expect(missing.config.guzzlingLevel).toBe(0);

      const explicit = normalizeDungeonCalculatorPersistedState({
        config: { artisanTea: false, guzzlingPouch: true, guzzlingLevel: 7 },
      });
      expect(explicit.config.artisanTea).toBe(false);
      expect(explicit.config.guzzlingPouch).toBe(true);
      expect(explicit.config.guzzlingLevel).toBe(7);

      // 非布尔 true 不开启暴饮；等级越界 / 脏值钳制。
      const dirty = normalizeDungeonCalculatorPersistedState({
        config: { guzzlingPouch: 'true', guzzlingLevel: 999 },
      });
      expect(dirty.config.guzzlingPouch).toBe(false);
      expect(dirty.config.guzzlingLevel).toBe(20);

      // 钥匙来源 legacy 'hybrid' 归一为 market（白名单外值同路径）。
      const legacySource = normalizeDungeonCalculatorPersistedState({
        config: { entryKeySource: 'hybrid', chestKeySource: 'hybrid' },
      });
      expect(legacySource.config.entryKeySource).toBe('market');
      expect(legacySource.config.chestKeySource).toBe('market');
    });
  });

  describe('buildParams 映射（经 result 回显）', () => {
    it('精炼率固定脚本共识：T0/T1/T2 = 0 / 0.33 / 1（config 无相关字段）', () => {
      const { calculator } = createStores();
      // 口径固定：config 不再携带 mode/override，引擎按 SCRIPT_REFINEMENT_RATE_BY_TIER 逐档取值。
      expect('refinementRateMode' in calculator.config).toBe(false);
      expect('refinementRateOverride' in calculator.config).toBe(false);

      for (const [tier, expected] of [
        [0, 0],
        [1, 0.33],
        [2, 1],
      ]) {
        expect(calculator.setDifficultyTier(tier)).toBe(true);
        expect(calculator.result.refinementRate).toBeCloseTo(expected, 12);
      }
    });

    it('回收固定 income：成本侧取毛额 + 收入侧含钥匙行（默认即生效）', () => {
      const { calculator } = createStores();
      const chestKeyHrid = calculator.selectedDungeon.chestKeyHrid;
      // 该用例只验证回收落点，社区 buff 显式关 0（默认 20 会放大箱数与回收量，见箱数模型用例）。
      expect(calculator.setCommunityBuffLevel(0)).toBe(true);

      // 2026-10-15 用户裁决：固定收入侧计入，默认即 income（无 setter 可切）。
      expect(calculator.result.chestKeyRecoveryMode).toBe('income');
      expect(calculator.result.chestKeyCost).toBe(calculator.result.chestKeyGrossCost);
      const recoveredRow = findItemRow(calculator.result, chestKeyHrid);
      expect(recoveredRow).not.toBeNull();
      // 返还钥匙数 = 0.02 × 主箱数（随队伍人数 / 社区 buff 联动，2026-10-15 对齐）。
      expect(recoveredRow.qty).toBeCloseTo(0.02 * calculator.result.mainChestCount, 12);

      // 字段契约（2026-10-15 拆分）：income 落点下回收量恒为真实回收量（不再归零），
      // 成本侧折减由 recoveryDiscountEnabled 独立表达。
      expect(calculator.result.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(
        0.02 * calculator.result.mainChestCount,
        12,
      );
      expect(calculator.result.chestKeyCostDetail.recoveryDiscountEnabled).toBe(false);
    });
  });

  describe('effectivePriceTable 口径管线', () => {
    it('两开关默认关：与 simulatorStore 的 priceTable 同引用（零开销直通）', () => {
      const { simulator, calculator } = createStores();
      const base = createAlignedPriceTable();
      simulator.pricing.priceTable = base;

      // 零开销直通：computed 返回的就是全局表的同一底层对象（Vue 响应式代理之下的 toRaw 同一引用），
      // 而非克隆产物——两开关全关时与改动前行为逐位一致。
      expect(toRaw(calculator.effectivePriceTable)).toBe(base);
      expect(calculator.effectivePriceTable).toBe(simulator.pricing.priceTable);
      expect(calculator.config.priceOverrides).toEqual({});
    });

    it('excludeCapeValue 开：披风三列按 0 估值；牛铃保持基础形态', () => {
      const { simulator, calculator } = createStores();
      simulator.pricing.priceTable = createAlignedPriceTable();
      simulator.pricing.nonTradableValuation = false;

      expect(calculator.setExcludeCapeValue(true)).toBe(true);
      for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
        expect(calculator.effectivePriceTable[capeHrid]).toEqual({ ask: 0, bid: 0, vendor: 0 });
      }
      // 牛铃不受披风开关影响（仍为基础形态）。
      expect(calculator.effectivePriceTable[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
      // 全局表（simulatorStore）永不被改写：披风仍为基础形态。
      expect(simulator.pricing.priceTable['/items/chance_cape']).toEqual({
        ask: -1,
        bid: -1,
        vendor: CAPE_BASE_VENDOR,
      });
    });

    it('excludeCowbellValue 开：牛铃三列清零、袋也按 0；披风保持基础形态', () => {
      const { simulator, calculator } = createStores();
      simulator.pricing.priceTable = createAlignedPriceTable();
      simulator.pricing.nonTradableValuation = false;

      expect(calculator.setExcludeCowbellValue(true)).toBe(true);
      expect(calculator.effectivePriceTable[COWBELL_HRID]).toEqual({ ask: 0, bid: 0, vendor: 0 });
      // 铃袋同属牛铃收益（脚本 isCowbellItem 语义）：一并按 0。
      expect(calculator.effectivePriceTable[BAG_OF_10_COWBELLS_HRID]).toEqual({ ask: 0, bid: 0, vendor: 0 });
      for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
        expect(calculator.effectivePriceTable[capeHrid]).toEqual({
          ask: -1,
          bid: -1,
          vendor: CAPE_BASE_VENDOR,
        });
      }
      // 入参表（simulatorStore 的全局表）永不被改写。
      expect(simulator.pricing.priceTable[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
      expect(simulator.pricing.priceTable[BAG_OF_10_COWBELLS_HRID]).toEqual({
        ask: 1090000,
        bid: 1060000,
        vendor: 0,
      });
    });

    it('两开关同开：披风清零不被合成键复位清掉（顺序正确），牛铃与袋同为零', () => {
      const { simulator, calculator } = createStores();
      simulator.pricing.priceTable = createAlignedPriceTable();
      simulator.pricing.nonTradableValuation = false;

      expect(calculator.setExcludeCowbellValue(true)).toBe(true);
      expect(calculator.setExcludeCapeValue(true)).toBe(true);
      for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
        expect(calculator.effectivePriceTable[capeHrid]).toEqual({ ask: 0, bid: 0, vendor: 0 });
      }
      expect(calculator.effectivePriceTable[COWBELL_HRID]).toEqual({ ask: 0, bid: 0, vendor: 0 });
      expect(calculator.effectivePriceTable[BAG_OF_10_COWBELLS_HRID]).toEqual({ ask: 0, bid: 0, vendor: 0 });

      // nonTradableValuation 开：rebuild 的保守 vendor 注入（披风 vendor = round(镜 bid)）
      // 先执行，随后被清零覆盖——披风与牛铃三列仍为 0。
      simulator.pricing.nonTradableValuation = true;
      for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
        expect(calculator.effectivePriceTable[capeHrid]).toEqual({ ask: 0, bid: 0, vendor: 0 });
      }
      expect(calculator.effectivePriceTable[COWBELL_HRID]).toEqual({ ask: 0, bid: 0, vendor: 0 });
    });

    it('页面 priceOverrides 最高优先：覆盖口径结果且不影响未覆盖侧', () => {
      const { simulator, calculator } = createStores();
      simulator.pricing.priceTable = createAlignedPriceTable();
      simulator.pricing.nonTradableValuation = false;

      expect(calculator.setExcludeCowbellValue(true)).toBe(true);
      expect(calculator.setExcludeCapeValue(true)).toBe(true);
      const capeHrid = NON_TRADABLE_CAPE_HRIDS[0];
      expect(calculator.setPriceOverride(COWBELL_HRID, 'ask', 999)).toBe(true);
      expect(calculator.setPriceOverride(capeHrid, 'bid', 777)).toBe(true);

      const table = calculator.effectivePriceTable;
      expect(table[COWBELL_HRID]).toEqual({ ask: 999, bid: 0, vendor: 0 });
      expect(table[capeHrid]).toEqual({ ask: 0, bid: 777, vendor: 0 });

      // 清空改价 → 回到口径结果（口径变换仍在管线中生效）。
      expect(calculator.clearAllPriceOverrides()).toBe(true);
      expect(calculator.effectivePriceTable[COWBELL_HRID].ask).toBe(0);
      expect(calculator.effectivePriceTable[capeHrid].bid).toBe(0);
    });
  });
});
