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
    let heapEvents = this.minHeap.toArray();

    return heapEvents.some((event) => event.type == type);
  }

  containsEventOfTypeAndHrid(type, hrid) {
    let heapEvents = this.minHeap.toArray();
    return heapEvents.some((event) => event.type == type && event.hrid == hrid);
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
