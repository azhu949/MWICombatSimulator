//! 最小插入有序映射：复刻 JS 对象 / Map 的键序语义。
//!
//! 为什么必须复刻键序：引擎对增益的求和按遍历顺序做浮点累加，浮点加法不满足
//! 结合律，顺序即结果（逐位 parity 的前提）；且 JS `delete obj[k]` 后重新赋值
//! 会把键挪到末尾——过期/清除后的再次注册必须落在同一位置。
//!
//! 语义对照：
//! - `set`：键已存在 → 原位替换（保持原位置，等价 JS `obj[k] = v` / `map.set` 已存在键）；
//!   新键 → 追加到末尾。
//! - `delete`：移除该键，其余键序不变。
//! - 遍历顺序 = 插入顺序（删除后再插入的键回到末尾）。

#[derive(Clone, Debug, Default)]
pub struct OrderedMap<K: PartialEq, V> {
    entries: Vec<(K, V)>,
}

impl<K: PartialEq, V> OrderedMap<K, V> {
    pub fn new() -> Self {
        Self { entries: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.entries.iter().find(|(candidate, _)| candidate == key).map(|(_, value)| value)
    }

    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.entries.iter_mut().find(|(candidate, _)| candidate == key).map(|(_, value)| value)
    }

    pub fn contains_key(&self, key: &K) -> bool {
        self.entries.iter().any(|(candidate, _)| candidate == key)
    }

    /// 键已存在则原位替换，否则追加（JS 对象赋值语义）。
    pub fn set(&mut self, key: K, value: V) {
        if let Some((_, slot)) = self.entries.iter_mut().find(|(candidate, _)| candidate == &key) {
            *slot = value;
        } else {
            self.entries.push((key, value));
        }
    }

    /// 移除键（保持其余键序），返回是否移除了项。
    pub fn delete(&mut self, key: &K) -> bool {
        if let Some(index) = self.entries.iter().position(|(candidate, _)| candidate == key) {
            self.entries.remove(index);
            true
        } else {
            false
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.entries.iter().map(|(key, value)| (key, value))
    }


    pub fn keys(&self) -> impl Iterator<Item = &K> {
        self.entries.iter().map(|(key, _)| key)
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.entries.iter().map(|(_, value)| value)
    }
}

impl<V> OrderedMap<String, V> {
    /// `&str` 键查询：避免结算热路径为每次查找分配临时 `String`。
    pub fn get_str(&self, key: &str) -> Option<&V> {
        self.entries.iter().find(|(candidate, _)| candidate.as_str() == key).map(|(_, value)| value)
    }

    pub fn contains_key_str(&self, key: &str) -> bool {
        self.entries.iter().any(|(candidate, _)| candidate.as_str() == key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_insertion_order_and_replacement_position() {
        let mut map: OrderedMap<String, i32> = OrderedMap::new();
        map.set("b".to_string(), 1);
        map.set("a".to_string(), 2);
        map.set("b".to_string(), 3);
        let keys: Vec<&str> = map.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["b", "a"]);
        assert_eq!(map.get(&"b".to_string()), Some(&3));
    }

    #[test]
    fn delete_then_reinsert_moves_to_end() {
        let mut map: OrderedMap<String, i32> = OrderedMap::new();
        map.set("a".to_string(), 1);
        map.set("b".to_string(), 2);
        assert!(map.delete(&"a".to_string()));
        map.set("a".to_string(), 3);
        let keys: Vec<&str> = map.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["b", "a"]);
        assert!(!map.delete(&"missing".to_string()));
    }
}
