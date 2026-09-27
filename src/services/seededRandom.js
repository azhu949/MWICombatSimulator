// 确定性伪随机源（mulberry32）——「公共随机数（Common Random Numbers）」的基础设施。
//
// 为什么需要它
// ------------
// 战斗引擎在模拟期间读取 realm 全局的 Math.random（combatSimulator / combatUtilities /
// zone 共数十处：命中、暴击、招架、掉落、刷怪、词缀等）。未播种时，两次模拟的差异里
// 随机噪声远大于「配置改动」本身带来的真实差异，于是优化器实际上在挑「哪次抽样运气好」，
// 结论既不可复现，也与实际应用后的表现不符。
//
// 把同一组种子喂给「基线」与「全部候选」，两者的差异就变成**配对差**（同一随机流下
// 的事件路径差异），噪声被大幅抵消，比较才能在少数几轮抽样内收敛——这就是本项目的
// 精度来源。食物优化器（foodOptimizerSimulation）同款实现，此处抽出为共享模块，
// 避免第二份实现漂移。
//
// 使用约束（与 foodOptimizerSimulation 的 RNG 隔离契约同源）
// ----------------------------------------------------------
// 一个 realm 内同一时刻只允许存在一个播种作用域。生产路径有三种合法用法：
//   1. 专用 worker 内播种（realm 私有，天然独占）；
//   2. 主线程串行评估（foodOptimizerSimulation 的 activeRandomScopes 守卫）；
//   3. 测试内显式注入。
// 绝不可在并发任务共享的 realm 里就地替换 Math.random。

// mulberry32：32 位种子 → 周期 2^32 的均匀序列，实现短、无外部依赖、跨 realm 一致。
export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// 字符串 → 32 位种子（FNV-1a 变体）。用于把「与搜索无关的稳定上下文字符串」
// （玩家 id + 区域/难度/时长 + 技能 hrid 列表 + 盐）折成一个确定性种子：
// 同样的输入必定得到同样的种子集 → 同一次配置的两次优化会得到同一份结论（可复现），
// 而不同输入自然错开随机流。
export function hashSeed(text) {
  const source = String(text ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// 从一个基础种子派生 count 个互不相同的种子。
// 派生走独立的 createSeededRandom 实例，因此与「用第几个种子做第几轮模拟」无关，
// 增删轮次不会改变已存在轮次的种子（复核/对比时序列稳定）。
export function deriveSeedSet(baseSeed, count) {
  // 非有限/非正数一律返回空集：Math.max(0, NaN) 仍是 NaN，会让循环条件静默失效。
  const requested = Number(count);
  const total = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  if (total === 0) return [];
  const rng = createSeededRandom(baseSeed);
  const seeds = [];
  for (let index = 0; index < total; index += 1) {
    // >>>0 保证是合法 uint32；0 也合法（mulberry32 对 0 仍产生完整周期序列）。
    seeds.push(Math.floor(rng() * 0x100000000) >>> 0);
  }
  return seeds;
}
