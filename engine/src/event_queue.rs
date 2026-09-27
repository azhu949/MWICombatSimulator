//! 事件队列：逐行复刻 JS 侧 `heap-js` MinHeap（v2.2.0）的堆算法与 `EventQueue` 语义。
//!
//! 为什么不是「重新实现一个等价的最小堆」：模拟器对**同时间事件的处理顺序**敏感，
//! 而该顺序由 heap-js 的内部数组布局与上浮/下沉细节决定（不是稳定排序保证）。
//! 逐行复刻是逐位 parity 的前提；`tests` 中的基准数据全部由真实 heap-js 生成。
//!
//! 对应 JS：`src/combatsimulator/events/eventQueue.js`（用法）
//! + `node_modules/heap-js/dist/heap-js.es5.js`（算法）。

/// 队列项契约：事件队列只依赖这些字段（对应 JS 事件对象中被队列逻辑用到的部分）。
pub trait QueueItem {
    /// 事件时间（毫秒，f64 以复刻 JS number 运算）。
    fn time(&self) -> f64;
    /// 稳定身份（JS 侧为对象引用；Rust 侧用数值 id 承担 remove-by-identity 语义）。
    fn id(&self) -> u64;
    fn event_type(&self) -> &str;
    fn source(&self) -> Option<u64>;
    fn target(&self) -> Option<u64>;
    fn hrid(&self) -> Option<&str>;
}

/// 二叉最小堆事件队列（比较器等价于 JS `(a, b) => a.time - b.time`）。
pub struct EventQueue<E: QueueItem> {
    heap: Vec<E>,
}

impl<E: QueueItem> Default for EventQueue<E> {
    fn default() -> Self {
        Self { heap: Vec::new() }
    }
}

impl<E: QueueItem> EventQueue<E> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    /// JS `addEvent`：push 后从末尾上浮。
    pub fn add_event(&mut self, event: E) {
        self.heap.push(event);
        let index = self.heap.len() - 1;
        self.sort_node_up(index);
    }

    /// JS `getNextEvent`（heap-js `pop`）：取根，末元素顶到根后下沉。
    pub fn get_next_event(&mut self) -> Option<E> {
        let last = self.heap.pop()?;
        if self.heap.is_empty() {
            return Some(last);
        }
        Some(self.replace_root(last))
    }

    /// JS `peekNextEvent`：非修改性读取堆根。
    pub fn peek_next_event(&self) -> Option<&E> {
        self.heap.first()
    }

    /// JS `clear`。
    pub fn clear(&mut self) {
        self.heap.clear();
    }

    /// JS `clearEventsForUnit`：source 或 target 命中即清。
    /// 注意：JS 包装方法**不返回** clearMatching 的结果（观察值为 undefined），
    /// 这里忠实复刻为无返回值；生产代码全部为语句式调用（已核对全部调用点）。
    pub fn clear_events_for_unit(&mut self, unit: u64) {
        self.clear_matching(|event| event.source() == Some(unit) || event.target() == Some(unit));
    }

    /// JS `clearEventsOfType`。与 `clear_events_for_unit` 同理：JS 包装方法不返回结果。
    pub fn clear_events_of_type(&mut self, event_type: &str) {
        self.clear_matching(|event| event.event_type() == event_type);
    }

    /// JS `clearMatching`：先对 `toArray()` 快照按数组顺序求值，匹配者按身份逐个移除。
    /// 返回是否有事件被清除。
    pub fn clear_matching<F: Fn(&E) -> bool>(&mut self, matcher: F) -> bool {
        let snapshot: Vec<u64> = self.heap.iter().map(|event| event.id()).collect();
        let mut cleared = false;
        for id in snapshot {
            let matched = self
                .heap
                .iter()
                .find(|event| event.id() == id)
                .map_or(false, |event| matcher(event));
            if matched {
                self.remove_by_id(id);
                cleared = true;
            }
        }
        cleared
    }

    /// JS `getMatching`：按堆数组顺序找首个匹配事件（非修改性）。
    pub fn get_matching<F: Fn(&E) -> bool>(&self, matcher: F) -> Option<&E> {
        self.heap.iter().find(|event| matcher(event))
    }

    /// JS `containsEventOfType`。
    pub fn contains_event_of_type(&self, event_type: &str) -> bool {
        self.heap.iter().any(|event| event.event_type() == event_type)
    }

    /// JS `containsEventOfTypeAndHrid`。
    pub fn contains_event_of_type_and_hrid(&self, event_type: &str, hrid: &str) -> bool {
        self.heap
            .iter()
            .any(|event| event.event_type() == event_type && event.hrid() == Some(hrid))
    }

    /// JS `containsEventOfTypesAndSource`：类型命中任一 type 后即检查 source，未命中类型
    /// 则看下一个事件（原实现用 break 短路类型链，等价于「任一类型命中 且 source 命中」）。
    pub fn contains_event_of_types_and_source(&self, types: &[&str], source: u64) -> bool {
        self.heap.iter().any(|event| {
            types.iter().any(|candidate| event.event_type() == *candidate)
                && event.source() == Some(source)
        })
    }

    /// heap-js `remove`（默认身份比较）的等价实现：按 id 找到首个匹配项后移除。
    pub fn remove_by_id(&mut self, id: u64) -> bool {
        if self.heap.is_empty() {
            return false;
        }
        let Some(index) = self.heap.iter().position(|event| event.id() == id) else {
            return false;
        };
        if index == 0 {
            self.get_next_event();
        } else if index == self.heap.len() - 1 {
            self.heap.pop();
        } else {
            let last = self.heap.pop().expect("heap is non-empty");
            self.heap[index] = last;
            self.sort_node_up(index);
            self.sort_node_down(index);
        }
        true
    }

    /// heap-js `replace`：旧根被替换后自根下沉，返回旧根。
    fn replace_root(&mut self, element: E) -> E {
        let old = std::mem::replace(&mut self.heap[0], element);
        self.sort_node_down(0);
        old
    }

    /// heap-js `_sortNodeUp`：与父节点比较，严格更小则交换上浮。
    fn sort_node_up(&mut self, mut index: usize) {
        while index > 0 {
            let parent = parent_index(index);
            if self.heap[parent].time() - self.heap[index].time() > 0.0 {
                self.heap.swap(index, parent);
                index = parent;
            } else {
                break;
            }
        }
    }

    /// heap-js `_sortNodeDown`：与更小的子节点比较并交换下沉。
    fn sort_node_down(&mut self, mut index: usize) {
        // JS：var moveIt = i < heapArray.length - 1（length 为 0 时恒 false）。
        if index + 1 >= self.heap.len() {
            return;
        }
        // JS 在循环前读取一次 self 节点；它随交换向下移动，比较基准不变。
        let node_time = self.heap[index].time();
        loop {
            let left = index * 2 + 1;
            let right = index * 2 + 2;
            // heap-js `getPotentialParent`：右侧子节点在范围内且严格更小时取代左侧。
            let mut best = left;
            if self.heap.len() > right && self.heap[right].time() - self.heap[best].time() < 0.0 {
                best = right;
            }
            match self.heap.get(best).map(|event| event.time()) {
                Some(best_child_time) if node_time - best_child_time > 0.0 => {
                    self.heap.swap(index, best);
                    index = best;
                }
                _ => break,
            }
        }
    }
}

/// heap-js `getParentIndexOf`：奇数 → (idx-1)/2；偶数 → (idx-2)/2。
fn parent_index(index: usize) -> usize {
    if index % 2 == 1 {
        index / 2
    } else {
        index / 2 - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq)]
    struct TestEvent {
        id: u64,
        event_type: String,
        time: f64,
        source: Option<u64>,
        target: Option<u64>,
        hrid: Option<String>,
    }

    impl QueueItem for TestEvent {
        fn time(&self) -> f64 {
            self.time
        }
        fn id(&self) -> u64 {
            self.id
        }
        fn event_type(&self) -> &str {
            &self.event_type
        }
        fn source(&self) -> Option<u64> {
            self.source
        }
        fn target(&self) -> Option<u64> {
            self.target
        }
        fn hrid(&self) -> Option<&str> {
            self.hrid.as_deref()
        }
    }

    fn event(id: u64, time: f64) -> TestEvent {
        TestEvent {
            id,
            event_type: format!("type{id}"),
            time,
            source: None,
            target: None,
            hrid: None,
        }
    }

    fn pop_all(queue: &mut EventQueue<TestEvent>) -> Vec<u64> {
        let mut order = Vec::new();
        while let Some(next) = queue.get_next_event() {
            order.push(next.id);
        }
        order
    }

    // 以下基准数据由真实 heap-js（v2.2.0）生成。

    #[test]
    fn pop_order_with_ties_matches_heap_js() {
        let mut queue = EventQueue::new();
        for (id, time) in [
            (1u64, 2000.0),
            (2, 1000.0),
            (3, 2000.0),
            (4, 1000.0),
            (5, 3000.0),
            (6, 1000.0),
        ] {
            queue.add_event(event(id, time));
        }
        assert_eq!(pop_all(&mut queue), vec![2, 4, 6, 1, 3, 5]);
    }

    #[test]
    fn identity_removals_match_heap_js() {
        let mut queue = EventQueue::new();
        for (id, time) in [
            (1u64, 500.0),
            (2, 1500.0),
            (3, 500.0),
            (4, 1500.0),
            (5, 500.0),
            (6, 2500.0),
            (7, 1500.0),
            (8, 500.0),
        ] {
            queue.add_event(event(id, time));
        }
        assert!(queue.remove_by_id(3));
        assert!(queue.remove_by_id(6));
        assert_eq!(pop_all(&mut queue), vec![1, 5, 8, 7, 4, 2]);
    }

    #[test]
    fn clear_by_type_matches_heap_js() {
        let mut queue = EventQueue::new();
        for (id, time, event_type) in [
            (1u64, 100.0, "a"),
            (2, 200.0, "b"),
            (3, 300.0, "a"),
            (4, 400.0, "b"),
            (5, 500.0, "a"),
        ] {
            queue.add_event(TestEvent {
                id,
                event_type: event_type.to_string(),
                time,
                source: None,
                target: None,
                hrid: None,
            });
        }
        queue.clear_events_of_type("a");
        assert_eq!(pop_all(&mut queue), vec![2, 4]);
        // 再次调用是幂等的空操作（JS 包装方法无返回值，无法断言 cleared 标志）
        queue.clear_events_of_type("a");
    }

    #[test]
    fn peek_is_non_destructive_and_empty_pops_return_none() {
        let mut queue = EventQueue::new();
        assert!(queue.get_next_event().is_none());
        assert!(queue.peek_next_event().is_none());
        queue.add_event(event(1, 100.0));
        assert_eq!(queue.peek_next_event().map(|e| e.id), Some(1));
        assert_eq!(queue.peek_next_event().map(|e| e.id), Some(1));
        assert_eq!(queue.len(), 1);
    }

    #[test]
    fn query_methods_match_event_queue_contract() {
        let mut queue = EventQueue::new();
        queue.add_event(TestEvent {
            id: 1,
            event_type: "autoAttack".to_string(),
            time: 100.0,
            source: Some(10),
            target: None,
            hrid: None,
        });
        queue.add_event(TestEvent {
            id: 2,
            event_type: "regenTick".to_string(),
            time: 200.0,
            source: None,
            target: None,
            hrid: Some("h1".to_string()),
        });

        assert!(queue.contains_event_of_type("autoAttack"));
        assert!(!queue.contains_event_of_type("missing"));
        assert!(queue.contains_event_of_type_and_hrid("regenTick", "h1"));
        assert!(!queue.contains_event_of_type_and_hrid("regenTick", "h2"));
        assert!(queue.contains_event_of_types_and_source(&["autoAttack", "x"], 10));
        // 类型命中但 source 不符：不得回落到后面的类型继续匹配。
        assert!(!queue.contains_event_of_types_and_source(&["autoAttack", "regenTick"], 99));
        assert_eq!(queue.get_matching(|e| e.event_type() == "regenTick").map(|e| e.id), Some(2));

        queue.clear_events_for_unit(10);
        assert_eq!(queue.len(), 1);
        queue.clear_events_for_unit(10);
        assert_eq!(queue.len(), 1);
    }
}
