/**
 * 迷宫商店「永久 BUFF 升级」目录（2026-04-25 游戏更新新增的 9 项升级）。
 *
 * 数据来源说明：
 * - 这 9 项升级**不在** init_client_data 载荷中（核对过 v1.20260814.0 的全部 56 个顶层 key，
 *   labyrinthShopItemDetailMap 仅含物品兑换条目，无升级定义；游戏内商店升级定义硬编码在客户端代码里）。
 * - 数值取自官方更新公告（Steam News 2026-04-25「Added 9 permanent Labyrinth Shop buff upgrades」）
 *   与官方 Wiki Labyrinth 页面的 Labyrinth Upgrades 表：
 *   每级 +1%（成功率项 +0.5%），最高 12 级。
 *
 * 作用域（2026-09-16 已游戏内核实）：升级 buff 仅在迷宫内生效——「永久」指升级等级永久保留，
 * 而非全局常驻 buff。zone/地下城模拟不注入该 buff，与游戏行为一致（出迷宫打怪无此加成）。
 *
 * 战斗模拟只会用到 combatRelevant = true 的 5 项（迷宫模拟只模拟战斗房间）；
 * 4 项生活向升级（速度/效率/成功率/双倍进度）对战斗模拟无影响，仅在此记录完整目录。
 *
 * buff 字段口径与官方卷轴/补给箱数据一致（见 personalBuffTypeDetailMap / labyrinthCrateDetailMap）：
 * damage、attack_speed 用 ratioBoost；cast_speed、critical_rate、wisdom 用 flatBoost。
 *
 * characterInfoField：该项升级在主站角色档案 characterInfo（官方 init_character_data /
 * character_info_updated 下发）上的等级字段名。模拟器只从 characterInfo 导入战斗 5 项，
 * 故仅 combatRelevant 项携带该属性（生活向 4 项无此属性 = 不提取）。
 * 「目录 key → characterInfo 字段」的对照表由本属性单点维护，src/services/importExportMapper.js
 * 的导入映射由此派生；禁止在别处另写一份清单——重复清单会在目录 key 改名时静默失配
 * （normalizeLabyrinthShopUpgrades 只按目录 key 取值，映射侧的陈旧 key 会被无声剔除，
 * 导入结果静默变空，运行时没有任何报错）。
 *
 * 【操作要求：官方下掉/改名等级字段时，改本属性不算修完】用户已导入的等级是持久配置
 * （simulatorStorage 的 mwi.simulation.ui.v1 → labyrinthUpgrades；该键为扁平 JSON、无版本号信封，
 * 也未接入任何「字段变更即失效」机制），故必须按变更类型一并收尾：
 * - 改名：本属性须与官方改名同批更新。同步之前，导入侧仍按旧字段名读 → 新字段自然读不到 =
 *   缺失 = 未购买（落空语义见 extractMainSiteLabyrinthUpgrades），下次导入会把该 key 静默清零——前提是
 *   携带门仍通过（5 项同时全部改名时反之，落进下一条「永不回收」一侧）；同步之后下一次导入即整包覆盖自愈。
 * - 下线：缺席是唯一信号，且与「部分下发」在协议上同形——快照侧「只增不减」正为此，见
 *   scripts/mwi-main-site-import.user.js 的 mergeCharacterInfoSnapshotField 注释。只要其余等级字段
 *   仍随载荷下发，快照重建后的下一次导入其整包覆盖会自然丢弃该 key；但若战斗 5 项字段全部不再携带
 *   （或官方一律以「省略键」表达未购买而该玩家其余项也均为 0），导入侧的携带门
 *   （level !== undefined && level >= 0）永不通过（即「永不回收」）→ 用户侧会按已下线的升级无限期模拟。
 *   故「下线」必须同时给出用户持久配置的清理路径（storage 版本号 / 一次性迁移 / UI 提示核对），
 *   并与目录改动同批发布。
 * - 反向澄清：我方删除/改名目录条目（含其 key）时不需要「残留」收尾——load 期
 *   normalizeLabyrinthShopUpgrades 只保留目录内的 5 项键，落盘中的未知键当即被丢弃（不再生效，下次落盘时
 *   从存储里消失）；本要求只针对官方侧变更。但「丢弃 ≠ 迁移」：改目录 key 会让用户已手填/已导入的该等级一并
 *   静默消失，故改 key 必须同时附迁移（旧 key 的值搬到新 key）或在 patch notes（src/ui/patchNotes.js）里写明。
 *
 * 等级取值口径同样单点：readLabyrinthShopUpgradeLevel（归一化、buff 构建、主站导入的
 * 「是否携带」判定三者共用）。禁止任何调用点另写 Number() 一把转换——布尔/单元素数组/
 * 非十进制串/原型链继承值会在归一化侧凭空变成有效等级，而类型门已把它们判为「不携带」。
 */

export const LABYRINTH_SHOP_UPGRADE_MAX_LEVEL = 12;

export const LABYRINTH_SHOP_BUFF_UPGRADES = Object.freeze([
  Object.freeze({
    key: 'damage',
    characterInfoField: 'labyrinthCombatDamageLevel',
    buffTypeHrid: '/buff_types/damage',
    boostField: 'ratioBoost',
    perLevel: 0.01,
    combatRelevant: true,
  }),
  Object.freeze({
    key: 'attack_speed',
    characterInfoField: 'labyrinthAttackSpeedLevel',
    buffTypeHrid: '/buff_types/attack_speed',
    boostField: 'ratioBoost',
    perLevel: 0.01,
    combatRelevant: true,
  }),
  Object.freeze({
    key: 'cast_speed',
    characterInfoField: 'labyrinthCastSpeedLevel',
    buffTypeHrid: '/buff_types/cast_speed',
    boostField: 'flatBoost',
    perLevel: 0.01,
    combatRelevant: true,
  }),
  Object.freeze({
    key: 'critical_rate',
    characterInfoField: 'labyrinthCriticalRateLevel',
    buffTypeHrid: '/buff_types/critical_rate',
    boostField: 'flatBoost',
    perLevel: 0.01,
    combatRelevant: true,
  }),
  Object.freeze({
    key: 'experience',
    characterInfoField: 'labyrinthExperienceLevel',
    buffTypeHrid: '/buff_types/wisdom',
    boostField: 'flatBoost',
    perLevel: 0.01,
    combatRelevant: true,
  }),
  // 以下 4 项为生活技能向升级，战斗模拟不消费。
  Object.freeze({
    key: 'skilling_speed',
    boostField: '',
    perLevel: 0.01,
    combatRelevant: false,
  }),
  Object.freeze({
    key: 'skilling_efficiency',
    boostField: '',
    perLevel: 0.01,
    combatRelevant: false,
  }),
  Object.freeze({
    key: 'skilling_success_rate',
    boostField: '',
    perLevel: 0.005,
    combatRelevant: false,
  }),
  Object.freeze({
    key: 'skilling_double_progress',
    boostField: '',
    perLevel: 0.01,
    combatRelevant: false,
  }),
]);

export const COMBAT_LABYRINTH_SHOP_UPGRADES = Object.freeze(
  LABYRINTH_SHOP_BUFF_UPGRADES.filter((upgrade) => upgrade.combatRelevant),
);

/**
 * 迷宫商店升级等级钳制：钳到 1..MAX_LEVEL 的整数。
 * 仅接受已通过 readLabyrinthShopUpgradeLevel 守卫的有限数，守卫责任在调用点。
 */
function clampShopUpgradeLevel(level) {
  return Math.min(LABYRINTH_SHOP_UPGRADE_MAX_LEVEL, Math.max(1, Math.floor(level)));
}

// 十进制数字串：显式拒绝 '0x10'/'1e2'/'Infinity' 等经 Number() 也能变成有限数的非十进制写法
// （'0x10' → 16 再钳到 12，等于凭空造出一个用户从未购买的满级）。
const DECIMAL_LEVEL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * 升级等级单点取值门：返回 source[key] 携带的等级原值（有限数）；「不携带」返回 undefined。
 *
 * 归一化（normalizeLabyrinthShopUpgrades / buildLabyrinthShopUpgradeBuffs）与导入侧的
 * 「载荷是否携带等级」判定（services/importExportMapper.js 的 hasLevelField）都走本函数，
 * 取值口径因此不可能再分叉；但「携带判定」另有一道非负过滤（见下方口径说明），那不是分叉：
 * 归一化剔除所有 level <= 0，门只额外剔除负数，0 的语义必须保留。禁止任何调用点改用
 * Number(source[key]) 一把转换：Number() 会把 null/''→0、true→1、[3]→3、{valueOf}→数，
 * 让「无数据」伪装成有效等级并落盘；且 source[key] 会读原型链
 * （Object.create({damage:5}) 也算取到 5），故先做 own 属性守卫。
 *
 * 口径：own 属性 且（有限数字 或 非空白十进制数字串）。数字 0 视为「携带 0 级」
 * （整包权威快照语义：全 0 = 玩家未购买任何升级，显式覆盖正确）。负数同为「携带原值」
 * 但被各调用方按 <= 0 剔除：归一化 / buff 构建直接跳过；主站导入的携带门必须把负数当
 * 「无意义数据」按伪值同待遇（游戏内等级恒为非负整数），否则整包会落空成 {} 并被当作
 * 权威快照覆盖，静默清空用户手动配置——该不变量由 importExportMapper.test.js 的
 * 负数用例锚定。
 */
export function readLabyrinthShopUpgradeLevel(source, key) {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, key)) {
    return undefined;
  }

  const rawValue = source[key];
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : undefined;
  }
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (!DECIMAL_LEVEL_PATTERN.test(trimmed)) {
    return undefined;
  }

  const parsed = Number(trimmed);
  // 超长数字串会溢出成 Infinity：算「不携带」，而不是钳成满级。
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 归一化迷宫商店升级等级：仅保留战斗相关 5 项，等级钳制到 0..12 的整数。
 * 取值口径见 readLabyrinthShopUpgradeLevel（伪值/原型链一律不算携带）。
 */
export function normalizeLabyrinthShopUpgrades(rawUpgrades) {
  const source = rawUpgrades && typeof rawUpgrades === 'object' && !Array.isArray(rawUpgrades) ? rawUpgrades : {};
  const normalized = {};

  for (const upgrade of COMBAT_LABYRINTH_SHOP_UPGRADES) {
    const level = readLabyrinthShopUpgradeLevel(source, upgrade.key);
    if (level === undefined || level <= 0) {
      continue;
    }
    normalized[upgrade.key] = clampShopUpgradeLevel(level);
  }

  return normalized;
}

/**
 * 按已购等级构建迷宫商店升级 buff（随迷宫模拟作为区域级 buff 应用，仅迷宫内生效）。
 * 返回的是已按等级折算好数值的 buff 模板数组（交由 Buff 构造时 level 传 1）。
 *
 * 模板显式携带 ratioBoostLevelBonus/flatBoostLevelBonus = 0：数值已在构建期固化到
 * ratioBoost/flatBoost，但 Buff 构造会读取这两个字段参与等级运算；字段缺失时
 * (level - 1) * undefined 恒为 NaN（即使 level 传 1 也如此），会静默污染战斗属性。
 * 形状须与官方模板（crates/ability/consumable）对齐，以防未来复制到走 Buff 构造的语义时踩雷。
 */
export function buildLabyrinthShopUpgradeBuffs(shopUpgrades) {
  const source = shopUpgrades && typeof shopUpgrades === 'object' && !Array.isArray(shopUpgrades) ? shopUpgrades : {};
  const buffs = [];

  for (const upgrade of COMBAT_LABYRINTH_SHOP_UPGRADES) {
    const level = readLabyrinthShopUpgradeLevel(source, upgrade.key);
    if (level === undefined || level <= 0) {
      continue;
    }

    const boostValue = upgrade.perLevel * clampShopUpgradeLevel(level);
    buffs.push({
      uniqueHrid: `/buff_uniques/labyrinth_shop_upgrade_${upgrade.key}`,
      typeHrid: upgrade.buffTypeHrid,
      ratioBoost: upgrade.boostField === 'ratioBoost' ? boostValue : 0,
      ratioBoostLevelBonus: 0,
      flatBoost: upgrade.boostField === 'flatBoost' ? boostValue : 0,
      flatBoostLevelBonus: 0,
      startTime: '0001-01-01T00:00:00Z',
      duration: 0,
    });
  }

  return buffs;
}
