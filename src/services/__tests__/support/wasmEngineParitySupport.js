// JS 侧对账驱动（切片 2 parity）：用**真实** JS 实现执行与 Rust 探针相同的操作脚本，
// 产出与 `engine/src/queue_probe.rs` 同构的轨迹。两侧 schema 成对维护：
// 任何一侧改动操作或轨迹格式，另一侧必须同步（否则 parity 测试立刻翻红）。
import { isDeepStrictEqual } from 'node:util';
import EventQueue from '../../../combatsimulator/events/eventQueue.js';
import { createSeededRandom } from '../../seededRandom.js';

// 执行操作脚本并返回轨迹（与 Rust run_event_queue_operations 的输出逐项可比）。
export function driveJsEventQueue(ops) {
  const queue = new EventQueue();
  // 单位对象按 id 缓存，保证引用相等语义（JS 队列查询用 == 比较对象引用）。
  const units = new Map();
  const unit = (id) => {
    const key = Number(id);
    if (!units.has(key)) units.set(key, { id: key });
    return units.get(key);
  };
  const trace = [];

  for (const op of ops) {
    switch (op.op) {
      case 'push': {
        const event = { id: op.id, type: op.type, time: op.time };
        if (op.source !== undefined) event.source = unit(op.source);
        if (op.target !== undefined) event.target = unit(op.target);
        if (op.hrid !== undefined) event.hrid = op.hrid;
        queue.addEvent(event);
        break;
      }
      case 'pop':
        trace.push({ op: 'pop', id: queue.getNextEvent()?.id ?? null });
        break;
      case 'peek':
        trace.push({ op: 'peek', id: queue.peekNextEvent()?.id ?? null });
        break;
      case 'containsType':
        trace.push({ op: 'containsType', value: queue.containsEventOfType(op.type) });
        break;
      case 'containsTypeAndHrid':
        trace.push({ op: 'containsTypeAndHrid', value: queue.containsEventOfTypeAndHrid(op.type, op.hrid) });
        break;
      case 'containsTypesAndSource':
        trace.push({
          op: 'containsTypesAndSource',
          value: queue.containsEventOfTypesAndSource(op.types, unit(op.source)),
        });
        break;
      case 'clearByType':
        // JS 包装方法不返回 clearMatching 的结果（观察值为 undefined）；记录 null 对齐 schema。
        queue.clearEventsOfType(op.type);
        trace.push({ op: 'clearByType', value: null });
        break;
      case 'clearEventsForUnit':
        queue.clearEventsForUnit(unit(op.unit));
        trace.push({ op: 'clearEventsForUnit', value: null });
        break;
      case 'getMatchingByType':
        trace.push({ op: 'getMatchingByType', id: queue.getMatching((event) => event.type === op.type)?.id ?? null });
        break;
      case 'clear':
        queue.clear();
        trace.push({ op: 'clear' });
        break;
      default:
        throw new Error(`unknown parity op: ${op.op}`);
    }
  }

  return trace;
}

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
