//! 原生 profiling 入口（需要 `--features prof`）：读取生产请求 JSON，跑 N 轮并打印分段计时。
//!
//! 在 `engine/` 目录运行：
//!
//! ```text
//! cargo run --release --features prof --example production_profile -- <request.json> [rounds] [warmup]
//! ```
//!
//! 请求 JSON 由基准测试导出（在仓库根目录执行）：
//!
//! ```text
//! $env:WASM_BENCH_DUMP='D:\path\request.json'; npm run benchmark:wasm-engine; Remove-Item Env:\WASM_BENCH_DUMP
//! ```
//!
//! 注意：`Instant` 在 wasm32-unknown-unknown 上不可用，因此分段占比只能在**原生**构建上测；
//! 原生与 wasm 共用同一份引擎代码，结论用于定位热点与排序优化项。
//! 分段会嵌套（父段包含子段），累计值不可相加，请按同一层分项比较。

use std::env;
use std::fs;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();
    let path = match args.get(1) {
        Some(path) => path.clone(),
        None => {
            eprintln!("usage: production_profile <request.json> [rounds] [warmup]");
            std::process::exit(2);
        }
    };
    let rounds: usize = args.get(2).and_then(|value| value.parse().ok()).unwrap_or(5);
    let warmups: usize = args.get(3).and_then(|value| value.parse().ok()).unwrap_or(1);

    let request = fs::read_to_string(&path).expect("read request json");
    println!("request: {path} ({} bytes)", request.len());

    for _ in 0..warmups {
        mwi_combat_engine::prod_probe::run_production_simulation(&request).expect("warmup run");
    }

    mwi_combat_engine::prof::reset();
    let mut times = Vec::with_capacity(rounds);
    for _ in 0..rounds {
        let started = Instant::now();
        mwi_combat_engine::prod_probe::run_production_simulation(&request).expect("profiled run");
        times.push(started.elapsed().as_secs_f64() * 1e3);
    }
    times.sort_by(|left, right| left.partial_cmp(right).expect("finite timings"));

    println!(
        "rounds: {}  median {:.1} ms  min {:.1} ms  max {:.1} ms",
        rounds,
        times[times.len() / 2],
        times[0],
        times[times.len() - 1]
    );
    println!("---- sections (sorted by total) ----");
    for line in mwi_combat_engine::prof::dump() {
        println!("{line}");
    }
}
