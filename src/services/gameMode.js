// 全局游戏模式（标准 / 铁牛）。
// 游戏中铁牛角色不能使用玩家市场（例外：商店购买牛铃），物品价值与收益口径随之
// 不同；本模块只承载模式的取值与规范化，具体计算差异（市场价口径、掉落估值等）
// 由消费方在后续功能中逐步接入。持久化走独立存储键（mwi.gameMode.v1，见
// simulatorStorage.js），切换即落盘、刷新后保留。
export const GAME_MODE_STANDARD = 'standard';
export const GAME_MODE_IRONCOW = 'ironcow';

// 归一化：仅接受 'ironcow'（容忍大小写/空白等非规范写法，与 advisor 预设
// normalizeAdvisorGoalPreset 同款宽容口径），其余一律回落到标准模式。
export function normalizeGameMode(rawMode) {
  const value = String(rawMode || '')
    .trim()
    .toLowerCase();
  return value === GAME_MODE_IRONCOW ? GAME_MODE_IRONCOW : GAME_MODE_STANDARD;
}
