import {
  GAME_DATA_VERSION,
  groupZoneHrids,
  monsterDetailIndex,
  soloZoneHrids,
  zoneMonsterSpawnIndex,
} from '../shared/gameDataIndex.js';

// 铁牛模式（刷图推荐器目标掉落）单次最多追踪的物品数量上限。
export const ADVISOR_DROP_ITEM_HRID_MAX_COUNT = 200;

// 所选目标物品 hrid 列表的统一清洗：trim 后非空、去重、按出现顺序保留前
// ADVISOR_DROP_ITEM_HRID_MAX_COUNT 个。advisorDomain.normalizeAdvisorFilters
// 与本模块的候选过滤共用，避免两处口径漂移。
export function normalizeDropItemHridList(rawItemHrids = []) {
  const source = Array.isArray(rawItemHrids) ? rawItemHrids : [];
  const seen = new Set();
  const result = [];

  for (const rawItem of source) {
    const itemHrid = String(rawItem ?? '').trim();
    if (!itemHrid || seen.has(itemHrid)) {
      continue;
    }
    seen.add(itemHrid);
    result.push(itemHrid);
    if (result.length >= ADVISOR_DROP_ITEM_HRID_MAX_COUNT) {
      break;
    }
  }

  return result;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let cachedZoneDropAvailabilityIndex = null;
let cachedZoneDropAvailabilityVersion = '';

// 掉率开门档位搜索上限：当前全部非地牢战斗区域 maxDifficulty 均为 5，取 2 倍
// 余量。该前提由 spawnOffsetDataInvariant.test.js 的数据不变量测试双端锁定
// （raw actionDetailMap 与生成索引 gameDataIndex.generated.json 均断言非地牢
// 区域 maxDifficulty ≤ 本常量，断言直接引用此导出常量保持单一事实源）：上游
// 数据引入更高难度档区域、或生成索引投影漂移时，测试失败即为显性信号，需
// 复核数据后同步上调本上限，否则开门档位落在上限之外的物品会被静默判定
// 「永不可掉」。有效掉率随档位单调不减（全量掉落数据无 dropRatePerDifficultyTier < 0），
// 门开之后不会回落，超过上限仍找不到门即可判定「扫描范围内永不可掉」。
export const ADVISOR_DROP_GATE_MAX_ZONE_TIER = 10;

/**
 * 普通掉落条目的最低可掉区域档位：从 minDifficultyTier 字段门开始，用与
 * worker 掉落引擎（profitEstimator 的 appendExpectedDropsFromTable /
 * appendRandomDropsForContext）完全相同的浮点表达式
 * `dropRate + dropRatePerDifficultyTier × (spawn 偏移 + 区域档位) > 0`
 * 逐档判定开门档位。估算端的档位取自 simResult 掉落桶记录的怪物有效
 * 难度（recordMonsterDeathFromContext 写入的 Monster.difficultyTier =
 * spawn 偏移 + 区域档；旧结果/DTO 缺省时回退纯区域档快照），与本索引
 * 同口径，非零 spawn 偏移数据下两端口径仍一致。负基础掉率 + 每档增长的
 * 钥匙碎片/护符类物品（如高级魔法护符 -0.007+0.002×档：T4 才 >0；
 * -0.0048+0.0012×档：T4 恰为 0、T5 才开门）在开门前的档位不产出任何
 * 掉落，索引必须如实反映，否则会保留注定为 0 的低档位扫描行。
 * 无 perTier 增益且 rate ≤ 0（或到搜索上限仍不开门）返回 null，
 * 表示此物品不经该怪物掉落。
 */
function resolveDropGateZoneTier(drop, offset, fieldGateTier) {
  const baseRate = toFiniteNumber(drop?.dropRate, 0);
  const ratePerTier = toFiniteNumber(drop?.dropRatePerDifficultyTier, 0);
  for (let zoneTier = fieldGateTier; zoneTier <= ADVISOR_DROP_GATE_MAX_ZONE_TIER; zoneTier += 1) {
    const monsterTier = offset + zoneTier;
    if (baseRate + ratePerTier * monsterTier > 0) {
      return zoneTier;
    }
  }
  return null;
}

/**
 * 区域掉落可用性索引：Map<zoneHrid, Map<itemHrid, minZoneTier>>。
 *
 * 对每个区域、每个 spawn { monsterHrid, offset = difficultyTier }：取
 * monsterDetailIndex 中该怪物 dropTable + rareDropTable 的每条掉落。门由
 * 两部分取严：① minDifficultyTier 字段门 = max(0, minDifficultyTier - offset)；
 * ② 普通表的开率门 = 使 dropRate + dropRatePerDifficultyTier × (offset + 档位)
 * > 0 的最低档位（稀有表掉率不随档位变化，rate ≤ 0 即永不可掉）。同一物品在
 * 区域内的多个怪物/spawn 上取最小值。minZoneTier 即「该区域难度档 >=
 * minZoneTier 时此物品可掉」的门槛（有效怪物难度 = spawn 偏移 + 区域难度档，
 * 与 worker 端 zone.js 同口径），因此同一地图 T0 可能不含、T3 含。
 *
 * 结果按 GAME_DATA_VERSION 记忆化：共享索引热重载（版本变化）后自动重建。
 */
export function buildZoneDropAvailabilityIndex() {
  const dataVersion = String(GAME_DATA_VERSION || '');
  if (cachedZoneDropAvailabilityIndex && cachedZoneDropAvailabilityVersion === dataVersion) {
    return cachedZoneDropAvailabilityIndex;
  }

  const index = new Map();
  for (const [zoneHrid, spawns] of Object.entries(zoneMonsterSpawnIndex || {})) {
    if (!Array.isArray(spawns) || spawns.length === 0) {
      continue;
    }

    const itemTierMap = new Map();
    for (const spawn of spawns) {
      const monsterHrid = String(spawn?.monsterHrid || '');
      const monster = monsterDetailIndex?.[monsterHrid];
      if (!monster) {
        continue;
      }

      const offset = Math.floor(toFiniteNumber(spawn?.difficultyTier, 0));
      for (const [dropTable, isRareTable] of [
        [monster.dropTable, false],
        [monster.rareDropTable, true],
      ]) {
        for (const drop of Array.isArray(dropTable) ? dropTable : []) {
          const itemHrid = String(drop?.itemHrid || '');
          if (!itemHrid) {
            continue;
          }

          const fieldGateTier = Math.max(0, toFiniteNumber(drop.minDifficultyTier, 0) - offset);
          let minZoneTier;
          if (isRareTable) {
            // 稀有掉落率不随档位变化（引擎仅乘玩家 rareFindMultiplier）：
            // rate ≤ 0 永不可掉；> 0 时开门档位只由 minDifficultyTier 字段决定。
            minZoneTier = toFiniteNumber(drop.dropRate, 0) > 0 ? fieldGateTier : null;
          } else {
            minZoneTier = resolveDropGateZoneTier(drop, offset, fieldGateTier);
          }
          if (minZoneTier === null) {
            continue;
          }

          const currentMinZoneTier = itemTierMap.get(itemHrid);
          if (currentMinZoneTier === undefined || minZoneTier < currentMinZoneTier) {
            itemTierMap.set(itemHrid, minZoneTier);
          }
        }
      }
    }

    if (itemTierMap.size > 0) {
      index.set(String(zoneHrid), itemTierMap);
    }
  }

  cachedZoneDropAvailabilityIndex = index;
  cachedZoneDropAvailabilityVersion = dataVersion;
  return index;
}

/**
 * 难度感知的候选地图过滤：dropItemHrids 为空时原样返回候选数组；
 * 否则仅保留「任一所选物品的 minZoneTier <= candidate.difficultyTier」
 * 的候选（按候选所在难度档判断，T0 与 T3 的结果可以不同）。
 */
export function filterAdvisorCandidatesByDropItems(candidates, dropItemHrids) {
  const selectedItemHrids = normalizeDropItemHridList(dropItemHrids);
  if (selectedItemHrids.length === 0) {
    return candidates;
  }

  const zoneDropAvailabilityIndex = buildZoneDropAvailabilityIndex();
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  return safeCandidates.filter((candidate) => {
    const itemTierMap = zoneDropAvailabilityIndex.get(String(candidate?.targetHrid || ''));
    if (!itemTierMap) {
      return false;
    }

    const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(candidate?.difficultyTier, 0)));
    return selectedItemHrids.some((itemHrid) => {
      const minZoneTier = itemTierMap.get(itemHrid);
      return minZoneTier !== undefined && minZoneTier <= difficultyTier;
    });
  });
}

/**
 * 当前筛选范围（scope 字段口径与 advisorDomain.normalizeAdvisorFilters 逐字
 * 一致：includeGroupZones 默认开、includeSoloZones 默认关；null / 非对象 / 数组输入回退
 * 空对象）内可掉落的物品候选列表，按 hrid 排序返回 [{ itemHrid }]。名称/图标
 * 等本地化由 UI 层负责，服务层不掺 i18n。scope 布尔在此直接解析而不导入
 * normalizeAdvisorFilters：advisorDomain 已单向依赖本模块（候选过滤 / hrid
 * 清洗），反向导入会形成模块循环依赖。ESM 下只有「双方均在调用期使用」才
 * 运行时安全：求值期调用对方导出时，被调函数一旦引用对方未完成求值的模块级
 * const/let 绑定（normalizeAdvisorFilters 恰引用 ADVISOR_REFINE_* 与 ADVISOR_QUICK_* 常量）即
 * 踩 TDZ；本模块保持为只依赖共享数据索引的叶子模块。
 */
export function buildAdvisorDropItemOptions(filters = {}) {
  const source = filters != null && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
  const includeSoloZones = Boolean(source.includeSoloZones);
  const includeGroupZones = source.includeGroupZones !== false;
  const zoneHrids = [];
  if (includeSoloZones) {
    zoneHrids.push(...soloZoneHrids);
  }
  if (includeGroupZones) {
    zoneHrids.push(...groupZoneHrids);
  }

  const zoneDropAvailabilityIndex = buildZoneDropAvailabilityIndex();
  const itemHridSet = new Set();
  for (const zoneHrid of zoneHrids) {
    const itemTierMap = zoneDropAvailabilityIndex.get(String(zoneHrid || ''));
    if (!itemTierMap) {
      continue;
    }
    for (const itemHrid of itemTierMap.keys()) {
      itemHridSet.add(itemHrid);
    }
  }

  return Array.from(itemHridSet)
    .sort()
    .map((itemHrid) => ({ itemHrid }));
}
