// 切片 2 parity → 切片 21B（定案 D2）golden 化：JS 事件队列已随 A 层删除，
// Rust 探针（`engine/src/queue_probe.rs`）的轨迹输出改为与 golden 快照对账。
// 操作脚本构造器与轨迹比较助手保留：前者生成确定性输入，后者供 unitParity 复用。
import { isDeepStrictEqual } from 'node:util';
import { createSeededRandom } from '../../seededRandom.js';

// 返回两轨迹的首个分歧（位置 + 两侧内容）；完全一致时返回 null。
// parity 失败时的定位助手：无视 JSON 键序，逐项做深比较。
export function findTraceDivergence(jsTrace, rustTrace) {
  const length = Math.max(jsTrace.length, rustTrace.length);
  for (let index = 0; index < length; index += 1) {
    if (!isDeepStrictEqual(jsTrace[index], rustTrace[index])) {
      return { index, js: jsTrace[index], rust: rustTrace[index] };
    }
  }
  return null;
}

// 定向脚本：覆盖同时间事件（tie 顺序）、f64 小数时间、超大时间、按类型/单位清除、
// 空队列查询等边界。与 Rust 侧的堆实现逐位对账。
export function buildTargetedEventQueueOps() {
  return [
    { op: 'push', id: 1, type: 'autoAttack', time: 1200, source: 10, target: 20 },
    { op: 'push', id: 2, type: 'regenTick', time: 1200, hrid: 'h1' },
    { op: 'push', id: 3, type: 'autoAttack', time: 1200, source: 11, target: 20 },
    { op: 'push', id: 4, type: 'regenTick', time: 1200, hrid: 'h2' },
    { op: 'push', id: 5, type: 'autoAttack', time: 600, source: 10, target: 21 },
    { op: 'peek' },
    { op: 'pop' },
    { op: 'containsType', type: 'autoAttack' },
    { op: 'containsType', type: 'missingType' },
    { op: 'containsTypeAndHrid', type: 'regenTick', hrid: 'h2' },
    { op: 'containsTypeAndHrid', type: 'regenTick', hrid: 'missing' },
    { op: 'containsTypesAndSource', types: ['regenTick', 'autoAttack'], source: 10 },
    { op: 'getMatchingByType', type: 'regenTick' },
    { op: 'push', id: 6, type: 'damageOverTime', time: 600, source: 20, target: 10 },
    { op: 'clearEventsForUnit', unit: 10 },
    { op: 'push', id: 7, type: 'checkBuffExpiration', time: 15000000000, hrid: 'h3' },
    { op: 'push', id: 8, type: 'autoAttack', time: 900.125, source: 11 },
    { op: 'pop' },
    { op: 'pop' },
    { op: 'clearByType', type: 'regenTick' },
    { op: 'pop' },
    { op: 'pop' },
    { op: 'push', id: 9, type: 'regenTick', time: 300 },
    { op: 'clear' },
    { op: 'peek' },
    { op: 'pop' },
    { op: 'containsTypesAndSource', types: ['regenTick'], source: 10 },
  ];
}

// 模糊脚本：确定性随机生成大量操作（重复时间 + 1/8 小数时间），对堆内部布局做压力对账。
export function buildFuzzEventQueueOps(seed, count) {
  const rng = createSeededRandom(seed);
  const types = ['autoAttack', 'regenTick', 'damageOverTime', 'checkBuffExpiration'];
  const pickType = () => types[Math.floor(rng() * types.length)];
  const ops = [];
  let nextId = 1;

  for (let index = 0; index < count; index += 1) {
    const roll = rng();
    if (roll < 0.55 || nextId === 1) {
      // 时间 = 500ms 的整数倍 + 0..7/8 的二进制精确小数 → 大量 tie 且覆盖 f64 小数比较。
      const time = Math.floor(rng() * 241) * 500 + Math.floor(rng() * 8) / 8;
      const event = { op: 'push', id: nextId, type: pickType(), time };
      if (rng() < 0.7) event.source = 1 + Math.floor(rng() * 3);
      if (rng() < 0.5) event.target = 1 + Math.floor(rng() * 3);
      if (rng() < 0.35) event.hrid = `h${Math.floor(rng() * 4)}`;
      ops.push(event);
      nextId += 1;
    } else if (roll < 0.72) {
      ops.push({ op: 'pop' });
    } else if (roll < 0.78) {
      ops.push({ op: 'peek' });
    } else if (roll < 0.84) {
      ops.push({ op: 'containsType', type: pickType() });
    } else if (roll < 0.88) {
      ops.push({ op: 'containsTypeAndHrid', type: pickType(), hrid: `h${Math.floor(rng() * 4)}` });
    } else if (roll < 0.92) {
      ops.push({ op: 'containsTypesAndSource', types: [pickType(), pickType()], source: 1 + Math.floor(rng() * 3) });
    } else if (roll < 0.95) {
      ops.push({ op: 'clearByType', type: pickType() });
    } else if (roll < 0.97) {
      ops.push({ op: 'clearEventsForUnit', unit: 1 + Math.floor(rng() * 3) });
    } else if (roll < 0.99) {
      ops.push({ op: 'getMatchingByType', type: pickType() });
    } else {
      ops.push({ op: 'clear' });
    }
  }

  return ops;
}
