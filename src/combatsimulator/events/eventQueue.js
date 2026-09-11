import Heap from 'heap-js';

class EventQueue {
  constructor() {
    this.minHeap = new Heap((a, b) => a.time - b.time);
  }

  addEvent(event) {
    this.minHeap.push(event);
  }

  getNextEvent() {
    return this.minHeap.pop();
  }

  peekNextEvent() {
    // heap-js 的 peek() 是对堆根的非修改性读取。
    // 模拟器依赖该契约来执行时间范围限制，
    // 而不会移除模拟窗口之外的首个事件。
    return this.minHeap.peek();
  }

  containsEventOfType(type) {
    const heap = this.minHeap;
    for (let index = 0, length = heap.length; index < length; index += 1) {
      if (heap.get(index).type == type) return true;
    }
    return false;
  }

  containsEventOfTypeAndHrid(type, hrid) {
    const heap = this.minHeap;
    for (let index = 0, length = heap.length; index < length; index += 1) {
      const event = heap.get(index);
      if (event.type == type && event.hrid == hrid) return true;
    }
    return false;
  }

  containsEventOfTypesAndSource(types, source) {
    const heap = this.minHeap;
    for (let index = 0, length = heap.length; index < length; index += 1) {
      const event = heap.get(index);
      for (let typeIndex = 0; typeIndex < types.length; typeIndex += 1) {
        if (event.type == types[typeIndex]) {
          if (event.source == source) return true;
          // Preserve the original OR chain: a matching type ends type checks
          // even when this event belongs to another source.
          break;
        }
      }
    }
    return false;
  }

  clear() {
    this.minHeap = new Heap((a, b) => a.time - b.time);
  }

  clearEventsForUnit(unit) {
    this.clearMatching((event) => event.source == unit || event.target == unit);
  }

  clearEventsOfType(type) {
    this.clearMatching((event) => event.type == type);
  }

  clearMatching(fn) {
    let cleared = false;
    let heapEvents = this.minHeap.toArray();

    for (const event of heapEvents) {
      if (fn(event)) {
        this.minHeap.remove(event);
        cleared = true;
      }
    }
    return cleared;
  }

  getMatching(fn) {
    let heapEvents = this.minHeap.toArray();

    for (const event of heapEvents) {
      if (fn(event)) {
        return event;
      }
    }

    return null;
  }
}

export default EventQueue;
