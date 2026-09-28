//! 可选分段计时：**仅供原生 profiling**（`--features prof`，默认关闭）。
//!
//! 设计取向（与生产语义严格隔离）：
//! - feature 关闭时全部被 `cfg` 编译掉，`start()` 返回零大小 `Guard`，优化器会把整条调用消除；
//! - feature 打开时用 thread_local 累加「名称 → (累计 ns, 调用次数)」，`dump()` 按累计耗时降序输出文本行。
//!
//! 为什么不做进 wasm 构建：`Instant::now()` 依赖宿主时钟，`wasm32-unknown-unknown` 不提供；
//! 分段占比在**原生构建**上测（与 wasm 共用同一份引擎代码），用于定位热点、排序优化项。
//! 用法见 `engine/examples/production_profile.rs`。
//!
//! 读表注意：分段会嵌套（`process_event` 的每个 `event.*` 都包含在 `simulate(total)` 内），
//! 父子分段的累计值不可相加；请按同一层的分项比较。

#[cfg(feature = "prof")]
mod imp {
    use std::cell::RefCell;
    use std::time::Instant;

    thread_local! {
        static SECTIONS: RefCell<Vec<(&'static str, u128, u64)>> = const { RefCell::new(Vec::new()) };
    }

    /// RAII 计时器：析构时把本次耗时累加进同名分段。
    pub struct Guard(&'static str, Instant);

    impl Drop for Guard {
        fn drop(&mut self) {
            let nanos = self.1.elapsed().as_nanos();
            SECTIONS.with(|sections| {
                let mut sections = sections.borrow_mut();
                match sections.iter_mut().find(|(name, _, _)| *name == self.0) {
                    Some((_, total, count)) => {
                        *total += nanos;
                        *count += 1;
                    }
                    None => sections.push((self.0, nanos, 1)),
                }
            });
        }
    }

    /// 开始一段计时。
    #[inline]
    pub fn start(name: &'static str) -> Guard {
        Guard(name, Instant::now())
    }

    /// 清空已累计的分段（每轮之间调用，避免多轮累加）。
    pub fn reset() {
        SECTIONS.with(|sections| sections.borrow_mut().clear());
    }

    /// 按累计耗时降序返回文本行（`名称  累计 ms  调用次数  每次 ns`）。
    pub fn dump() -> Vec<String> {
        SECTIONS.with(|sections| {
            let mut rows: Vec<(&'static str, u128, u64)> = sections.borrow().clone();
            rows.sort_by(|left, right| right.1.cmp(&left.1));
            rows.iter()
                .map(|(name, nanos, count)| {
                    format!(
                        "{name:<34} {:>9.2} ms {:>10} calls {:>9.0} ns/call",
                        *nanos as f64 / 1e6,
                        count,
                        *nanos as f64 / (*count).max(1) as f64
                    )
                })
                .collect()
        })
    }
}

#[cfg(not(feature = "prof"))]
mod imp {
    /// feature 关闭时的空计时器（零大小、零开销）。
    pub struct Guard;

    #[inline(always)]
    pub fn start(_name: &'static str) -> Guard {
        Guard
    }

    #[inline(always)]
    pub fn reset() {}

    #[inline(always)]
    pub fn dump() -> Vec<String> {
        Vec::new()
    }
}

pub use imp::*;
