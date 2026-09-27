//! mulberry32 确定性伪随机源：与 JS 侧 `src/services/seededRandom.js` 逐位一致。
//!
//! 为什么必须一致：`src/worker.js` 在给定 seed 时用 mulberry32 替换 `Math.random`，
//! 「同一 payload + 同一 seed 必然产出相同 simResult」是该项目的既定契约（公共随机数 /
//! Common Random Numbers，技能与食物优化器精度的来源）。Rust 引擎要在切片 4/5 接管
//! 模拟，就必须消费与 JS 完全相同的随机流，本模块是逐位 parity 的第一块基石。
//!
//! 位运算说明：JS 侧 `Math.imul`/`^`/`>>>` 在 int32 与 ToUint32 之间往返，
//! 但全程只影响低 32 位模式；Rust 侧统一在 u32 域用 wrapping 运算，位模式完全一致。

/// mulberry32：32 位种子 → 均匀序列，逐位复刻 JS `createSeededRandom`。
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// 一次抽样，等价于 JS `createSeededRandom(seed)()` 的一次调用，返回 [0,1)。
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut value = (self.state ^ (self.state >> 15)).wrapping_mul(1 | self.state);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(61 | value));
        ((value ^ (value >> 14)) as f64) / 4294967296.0
    }
}

/// 字符串 → 32 位种子（FNV-1a 变体），与 JS `hashSeed` 一致。
/// 按 UTF-16 码元折叠（`encode_utf16`），与 JS `charCodeAt` 的语义对齐。
pub fn hash_seed(text: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for unit in text.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

/// 从基础种子派生 `count` 个互不相同的种子，与 JS `deriveSeedSet` 一致。
pub fn derive_seed_set(base_seed: u32, count: u32) -> Vec<u32> {
    let mut rng = Mulberry32::new(base_seed);
    (0..count)
        .map(|_| ((rng.next_f64() * 4294967296.0).floor()) as u32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // 以下期望值由真实 JS 实现（node 运行 src/services/seededRandom.js）生成，
    // 任何位级偏差都会让本测试失败。

    #[test]
    fn matches_js_stream_for_seed_0() {
        let mut rng = Mulberry32::new(0);
        let actual: Vec<f64> = (0..5).map(|_| rng.next_f64()).collect();
        let expected = [
            0.26642920868471265,
            0.0003297457005828619,
            0.2232720274478197,
            0.1462021479383111,
            0.46732782293111086,
        ];
        assert_eq!(actual, expected);
    }

    #[test]
    fn matches_js_stream_for_seed_42() {
        let mut rng = Mulberry32::new(42);
        let actual: Vec<f64> = (0..5).map(|_| rng.next_f64()).collect();
        let expected = [
            0.6011037519201636,
            0.44829055899754167,
            0.8524657934904099,
            0.6697340414393693,
            0.17481389874592423,
        ];
        assert_eq!(actual, expected);
    }

    #[test]
    fn stream_is_deterministic_per_seed() {
        let mut a = Mulberry32::new(7);
        let mut b = Mulberry32::new(7);
        for _ in 0..1000 {
            assert_eq!(a.next_f64(), b.next_f64());
        }
    }

    #[test]
    fn values_stay_in_unit_interval() {
        let mut rng = Mulberry32::new(1);
        for _ in 0..10_000 {
            let value = rng.next_f64();
            assert!((0.0..1.0).contains(&value), "value out of range: {value}");
        }
    }

    #[test]
    fn matches_js_hash_seed() {
        assert_eq!(hash_seed("hello"), 1335831723);
        assert_eq!(hash_seed("中文测试"), 349844549);
        assert_eq!(hash_seed(""), 0x811c9dc5);
    }

    #[test]
    fn matches_js_derive_seed_set() {
        assert_eq!(derive_seed_set(1, 3), vec![2693262067, 11749833, 2265367787]);
        assert_eq!(
            derive_seed_set(0, 5),
            vec![1144304738, 1416247, 958946056, 627933444, 2007157716]
        );
        assert_eq!(derive_seed_set(123, 0), Vec::<u32>::new());
    }
}
