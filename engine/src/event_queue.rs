//! 事件队列：按 `(time, seq)` 全序弹出的稳定优先级队列。
//!
//! 切片 24（用户已批的契约放宽）：**放弃逐行复刻 heap-js**。平局（同 time）弹出序不再
//! 依赖堆内部数组布局，而是按**入队序**（FIFO tie-break，`seq` 单调递增）——这也正是
//! 旧注释里「同时间事件顺序敏感」的真实约束：顺序确定且可复现即可，不必与 JS 堆同构
//! （JS 引擎已随切片 21B 删除）。
//!
//! 语义防线：本文件测试锁定队列自身的 (time, seq) 全序与各查询/清除契约；
//! `queue_probe` 探针测试 + 生产 golden 快照（切片 24 已重锚）承载模拟轨迹级漂移。
//!
//! 数据结构：`VecDeque<QueueEntry>` 按 (time, seq) 升序存储——
//! - `add_event`：二分定位插入点后 `insert`（`O(n)` 移动，元素紧凑、队列小）；
//! - `get_next_event`：`pop_front`（`O(1)`），恒取 (time, seq) 最小者；
//! - `clear_matching`：`retain` 单趟完成（旧的堆复刻是快照 + 逐身份移除的 `O(n²)`）；
//! - 各查询方法按 (time, seq) 序扫描。
//!
//! 契约细节：`time` 保证非 NaN（引擎产生的时间均为有限值）；NaN 输入行为未定义。

use crate::hrid::Hrid;
use std::collections::VecDeque;

/// 队列项契约：事件队列只依赖这些字段（对应 JS 事件对象中被队列逻辑用到的部分）。
pub trait QueueItem {
    /// 事件时间（毫秒，f64 以复刻 JS number 运算）。
    fn time(&self) -> f64;
    /// 稳定身份（JS 侧为对象引用；Rust 侧用数值 id 承担 remove-by-identity 语义）。
    fn id(&self) -> u64;
    fn event_type(&self) -> Hrid;
    fn source(&self) -> Option<u64>;
    fn target(&self) -> Option<u64>;
    fn hrid(&self) -> Option<Hrid>;
}

/// 队列条目：事件 + 入队序号（全序键的第二部分，`add_event` 时单调分配）。
struct QueueEntry<E> {
    seq: u64,
    event: E,
}

/// `(time, seq)` 全序稳定优先级队列（弹出序 = 时间升序，同时间按入队序）。
pub struct EventQueue<E: QueueItem> {
    items: VecDeque<QueueEntry<E>>,
    next_seq: u64,
}

impl<E: QueueItem> Default for EventQueue<E> {
    fn default() -> Self {
        Self {
            items: VecDeque::new(),
            next_seq: 0,
        }
    }
}

impl<E: QueueItem> EventQueue<E> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// JS `addEvent`：按 (time, seq) 插入。新事件 seq 恒最大，因此同时间事件排在
    /// 既有同时间事件之后（FIFO tie-break）。绝大多数调度的时间 ≥ 队尾（事件随时间
    /// 递增产生），故先走尾部追加快速路径，仅当新事件时间早于队尾（乱序调度）时二分定位。
    pub fn add_event(&mut self, event: E) {
        let _prof = crate::prof::start("queue.add_event");
        let seq = self.next_seq;
        self.next_seq += 1;
        let entry = QueueEntry { seq, event };
        // 尾部快速路径：队尾 ≤ 新键时插入位置恒为队尾（seq 最大，同 time 不落前）。
        if self
            .items
            .back()
            .map_or(true, |back| (back.event.time(), back.seq) <= (entry.event.time(), entry.seq))
        {
            self.items.push_back(entry);
            return;
        }
        let index = self.lower_bound(entry.event.time(), seq);
        self.items.insert(index, entry);
    }

    /// JS `getNextEvent`：弹出 (time, seq) 最小者（队首）。
    pub fn get_next_event(&mut self) -> Option<E> {
        let _prof = crate::prof::start("queue.get_next_event");
        self.items.pop_front().map(|entry| entry.event)
    }

    /// JS `peekNextEvent`：非修改性读取队首。
    pub fn peek_next_event(&self) -> Option<&E> {
        self.items.front().map(|entry| &entry.event)
    }

    /// JS `clear`。`seq` 计数器不复位（无语义影响，避免溢出回绕的边界讨论）。
    pub fn clear(&mut self) {
        self.items.clear();
    }

    /// JS `clearEventsForUnit`：source 或 target 命中即清。
    /// 注意：JS 包装方法**不返回** clearMatching 的结果（观察值为 undefined），
    /// 这里忠实复刻为无返回值；生产代码全部为语句式调用（已核对全部调用点）。
    pub fn clear_events_for_unit(&mut self, unit: u64) {
        self.clear_matching(|event| event.source() == Some(unit) || event.target() == Some(unit));
    }

    /// JS `clearEventsOfType`。与 `clear_events_for_unit` 同理：JS 包装方法不返回结果。
    pub fn clear_events_of_type(&mut self, event_type: Hrid) {
        self.clear_matching(|event| event.event_type() == event_type);
    }

    /// JS `clearMatching`：单趟 `retain` 移除全部匹配项，剩余元素保持 (time, seq) 序。
    /// 返回是否有事件被清除。（旧堆复刻为快照 + 逐身份移除；对纯谓词 matcher 结果等价，
    /// matcher 的求值顺序由堆数组序改为 (time, seq) 序。）
    pub fn clear_matching<F: Fn(&E) -> bool>(&mut self, matcher: F) -> bool {
        let _prof = crate::prof::start("queue.clear_matching");
        let mut cleared = false;
        self.items.retain(|entry| {
            if matcher(&entry.event) {
                cleared = true;
                false
            } else {
                true
            }
        });
        cleared
    }

    /// JS `getMatching`：按 (time, seq) 序找首个匹配事件（非修改性）。
    pub fn get_matching<F: Fn(&E) -> bool>(&self, matcher: F) -> Option<&E> {
        self.items
            .iter()
            .find(|entry| matcher(&entry.event))
            .map(|entry| &entry.event)
    }

    /// JS `containsEventOfType`。
    pub fn contains_event_of_type(&self, event_type: Hrid) -> bool {
        self.items.iter().any(|entry| entry.event.event_type() == event_type)
    }

    /// JS `containsEventOfTypeAndHrid`。
    pub fn contains_event_of_type_and_hrid(&self, event_type: Hrid, hrid: Hrid) -> bool {
        self.items
            .iter()
            .any(|entry| entry.event.event_type() == event_type && entry.event.hrid() == Some(hrid))
    }

    /// JS `containsEventOfTypesAndSource`：类型命中任一 type 后即检查 source，未命中类型
    /// 则看下一个事件（原实现用 break 短路类型链，等价于「任一类型命中 且 source 命中」）。
    pub fn contains_event_of_types_and_source(&self, types: &[Hrid], source: u64) -> bool {
        self.items.iter().any(|entry| {
            types.iter().any(|candidate| entry.event.event_type() == *candidate)
                && entry.event.source() == Some(source)
        })
    }

    /// 按 id 找到首个匹配项后移除（原 heap-js `remove` 身份移除的等价实现）。
    pub fn remove_by_id(&mut self, id: u64) -> bool {
        let _prof = crate::prof::start("queue.remove_by_id");
        let Some(index) = self.items.iter().position(|entry| entry.event.id() == id) else {
            return false;
        };
        self.items.remove(index);
        true
    }

    /// 二分查找插入点：返回第一个 `(time, seq) > (time_arg, seq_arg)` 的下标
    /// （即第一个应排在目标键之后的元素位置）。
    fn lower_bound(&self, time: f64, seq: u64) -> usize {
        let mut lo = 0usize;
        let mut hi = self.items.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let entry = &self.items[mid];
            if (entry.event.time(), entry.seq) <= (time, seq) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hrid::intern_hrid;

    #[derive(Clone, Debug, PartialEq)]
    struct TestEvent {
        id: u64,
        event_type: Hrid,
        time: f64,
        source: Option<u64>,
        target: Option<u64>,
        hrid: Option<Hrid>,
    }

    impl QueueItem for TestEvent {
        fn time(&self) -> f64 {
            self.time
        }
        fn id(&self) -> u64 {
            self.id
        }
        fn event_type(&self) -> Hrid {
            self.event_type
        }
        fn source(&self) -> Option<u64> {
            self.source
        }
        fn target(&self) -> Option<u64> {
            self.target
        }
        fn hrid(&self) -> Option<Hrid> {
            self.hrid
        }
    }

    fn event(id: u64, time: f64) -> TestEvent {
        TestEvent {
            id,
            event_type: intern_hrid(&format!("type{id}")),
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

    // 以下期望值按切片 24 的 (time, seq) 全序语义人工推导（旧 heap-js 金标已弃用）。

    #[test]
    fn pop_order_with_ties_is_insertion_stable() {
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
        // 1000 组按入队序 [2,4,6]，随后 2000 组 [1,3]，最后 3000 组 [5]。
        assert_eq!(pop_all(&mut queue), vec![2, 4, 6, 1, 3, 5]);
    }

    #[test]
    fn insertion_keeps_sorted_order_for_mixed_times() {
        // 乱序插入 + 重复时间：弹出序恒为 (time, seq) 升序。
        let mut queue = EventQueue::new();
        for (id, time) in [(1u64, 500.0), (2, 100.0), (3, 300.0), (4, 100.0), (5, 500.0), (6, 0.0)] {
            queue.add_event(event(id, time));
        }
        assert_eq!(pop_all(&mut queue), vec![6, 2, 4, 3, 1, 5]);
    }

    #[test]
    fn identity_removals_preserve_remaining_order() {
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
        assert!(!queue.remove_by_id(99));
        // 500 组 [1,5,8] → 1500 组 [2,4,7]（2500 的 id6 已移除）。
        assert_eq!(pop_all(&mut queue), vec![1, 5, 8, 2, 4, 7]);
    }

    #[test]
    fn removal_and_reinsertion_get_new_tie_sequence() {
        // 移除后重新入队的事件拿到新 seq：同时间组内排到既有成员之后。
        let mut queue = EventQueue::new();
        queue.add_event(event(1, 100.0));
        queue.add_event(event(2, 100.0));
        assert!(queue.remove_by_id(1));
        queue.add_event(event(3, 100.0));
        assert_eq!(pop_all(&mut queue), vec![2, 3]);
    }

    #[test]
    fn clear_by_type_removes_matching_entries() {
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
                event_type: intern_hrid(event_type),
                time,
                source: None,
                target: None,
                hrid: None,
            });
        }
        queue.clear_events_of_type(intern_hrid("a"));
        assert_eq!(pop_all(&mut queue), vec![2, 4]);
        // 再次调用是幂等的空操作（JS 包装方法无返回值，无法断言 cleared 标志）
        queue.clear_events_of_type(intern_hrid("a"));
    }

    #[test]
    fn clear_matching_keeps_untouched_entries_in_order() {
        // 清除不改变剩余元素的相对序（retain 单趟保序）。
        let mut queue = EventQueue::new();
        for (id, time) in [(1u64, 300.0), (2, 100.0), (3, 200.0), (4, 100.0)] {
            queue.add_event(event(id, time));
        }
        assert!(queue.clear_matching(|entry| entry.event_type() == intern_hrid("type1")));
        assert!(!queue.clear_matching(|entry| entry.event_type() == intern_hrid("type1")));
        assert_eq!(pop_all(&mut queue), vec![2, 4, 3]);
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
            event_type: intern_hrid("autoAttack"),
            time: 100.0,
            source: Some(10),
            target: None,
            hrid: None,
        });
        queue.add_event(TestEvent {
            id: 2,
            event_type: intern_hrid("regenTick"),
            time: 200.0,
            source: None,
            target: None,
            hrid: Some(intern_hrid("h1")),
        });

        assert!(queue.contains_event_of_type(intern_hrid("autoAttack")));
        assert!(!queue.contains_event_of_type(intern_hrid("missing")));
        assert!(queue.contains_event_of_type_and_hrid(intern_hrid("regenTick"), intern_hrid("h1")));
        assert!(!queue.contains_event_of_type_and_hrid(intern_hrid("regenTick"), intern_hrid("h2")));
        assert!(queue.contains_event_of_types_and_source(&[Hrid::EVENT_AUTO_ATTACK, intern_hrid("x")], 10));
        // 类型命中但 source 不符：不得回落到后面的类型继续匹配。
        assert!(!queue.contains_event_of_types_and_source(
            &[Hrid::EVENT_AUTO_ATTACK, Hrid::EVENT_REGEN_TICK],
            99
        ));
        assert_eq!(
            queue.get_matching(|e| e.event_type() == Hrid::EVENT_REGEN_TICK).map(|e| e.id),
            Some(2)
        );

        queue.clear_events_for_unit(10);
        assert_eq!(queue.len(), 1);
        queue.clear_events_for_unit(10);
        assert_eq!(queue.len(), 1);
    }
}
