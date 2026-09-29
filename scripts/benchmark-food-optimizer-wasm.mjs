// 任务级 A/B：同一条食物优化器搜索任务（同一 request、同一 seeds、同一 worker 池），
// 对比「JS 引擎」与「WASM 引擎」两条路径的执行总耗时（wall time，含 worker 启动/协调）。
// 两组唯一差异是 request.useWasmEngine；wasm 引擎由 worker 侧 bridge 注入
//（Node 无法 fetch file:// 的 wasm，必须显式加载字节交给 wasm-bindgen）。
//
// 读数纪律（热节流环境）：单次读数不作数，按「配对」交替顺序反复跑，取中位数。
// 用法：node scripts/benchmark-food-optimizer-wasm.mjs --pairs=3 --workers=4 --seconds=600 --rounds=3
// 可选：--case 暂只支持 zone 场景；--slots=3 --step=25 --seed=1
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

if (!isMainThread) {
  // worker 侧：init 时（按模式）加载 wasm 引擎并注入生产桥，然后逐候选评估。
  const { createFoodOptimizerEvaluator } = await import(workerData.simulationUrl);
  const { getWasmProductionDiagnostics, loadWasmEngine, setWasmProductionEngineForTests } = await import(
    workerData.bridgeUrl
  );
  const expectWasm = workerData.wasm === true;
  let evaluator;
  parentPort.on('message', async (data) => {
    try {
      if (data.type === 'init') {
        if (expectWasm) {
          const engine = await loadWasmEngine({
            glueUrl: workerData.glueUrl,
            moduleOrPath: readFile(workerData.wasmPath),
          });
          if (!engine) throw new Error('wasm engine failed to load inside the worker.');
          setWasmProductionEngineForTests(engine);
        }
        evaluator = createFoodOptimizerEvaluator(data.request, {
          collectThresholds: data.collectThresholds !== false,
          sharedRounds: data.sharedRounds === true,
          items: data.items,
        });
        parentPort.postMessage({ type: 'result' });
        return;
      }
      const progress = (value) => parentPort.postMessage({ type: 'progress', ...value });
      const result = await evaluator(data.candidate, data.deathBudget, progress, data.reusableSamples, data.costCutoff);
      // 自检：wasm 模式若有任何一次静默回退，读数就不作数，必须大声失败。
      if (expectWasm) {
        const reason = getWasmProductionDiagnostics().lastFallbackReason;
        if (reason !== '') throw new Error(`wasm fallback inside the worker: ${reason}`);
      }
      parentPort.postMessage({ type: 'result', result });
    } catch (error) {
      parentPort.postMessage({ type: 'error', error: error?.stack || String(error) });
    }
  });
}

class BenchmarkClient {
  constructor(mode, metrics) {
    this.metrics = metrics;
    this.worker = new Worker(new URL(import.meta.url), {
      workerData: {
        simulationUrl: mode.simulationUrl,
        bridgeUrl: mode.bridgeUrl,
        wasm: mode.wasm,
        glueUrl: mode.glueUrl,
        wasmPath: mode.wasmPath,
      },
    });
    this.metrics.createdWorkers += 1;
    this.pending = null;
    this.worker.on('message', (data) => {
      if (data.type === 'progress') this.metrics.progressMessages += 1;
      if (!this.pending) return;
      if (data.type === 'progress') {
        this.pending.progress?.(data);
        return;
      }
      const pending = this.pending;
      this.pending = null;
      if (data.type === 'error') pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    });
    this.worker.on('error', (error) => this.stop(error));
    this.worker.on('exit', (code) => {
      if (this.pending) this.stop(new Error(`Worker exited while evaluating (${code}).`));
    });
  }
  call(message, progress) {
    return new Promise((resolveCall, reject) => {
      if (!this.worker || this.pending) {
        reject(new Error('Worker unavailable.'));
        return;
      }
      this.pending = { resolve: resolveCall, reject, progress };
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.pending = null;
        reject(error);
      }
    });
  }
  stop(error = new Error('Benchmark stopped.')) {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
    if (this.worker) {
      this.termination = this.worker.terminate();
      this.worker = null;
    }
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = resolve(root, 'tmp', 'wasm-optimizer-benchmark');
  const value = (name, fallback) =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const integer = (name, fallback, min, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value(name, fallback));
    assert(Number.isSafeInteger(parsed) && parsed >= min && parsed <= max, `${name} must be from ${min} to ${max}`);
    return parsed;
  };
  const scenarioName = value('case', 'zone');
  assert.equal(scenarioName, 'zone', 'only the zone scenario is wired for this benchmark');
  const pairs = integer('pairs', 3, 1, 25);
  const workers = Math.min(availableParallelism(), 64, integer('workers', Math.min(availableParallelism(), 8), 1));
  const seed = integer('seed', 1, 0, 0xffffffff);
  const scenario = {
    foodSlots: integer('slots', 3, 1, 3),
    seconds: integer('seconds', 600, 1),
    rounds: integer('rounds', 3, 1, 10),
    thresholdStepPercent: integer('step', 25, 1, 100),
  };
  const gluePath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine.js');
  const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
  await mkdir(output, { recursive: true });
  const { build } = await import('esbuild');
  await build({
    absWorkingDir: root,
    entryPoints: {
      search: 'src/services/foodOptimizerSearch.js',
      simulation: 'src/services/foodOptimizerSimulation.js',
      support: 'src/services/__tests__/support/foodOptimizerTestSupport.js',
      bridge: 'src/services/__tests__/support/wasmOptimizerBenchmarkBridge.js',
    },
    outdir: output,
    bundle: true,
    splitting: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  });
  const { createFoodOptimizerSearch } = await import(pathToFileURL(resolve(output, 'search.mjs')).href);
  const { createFoodOptimizerFixture, physicalFoodOptimizerResult } = await import(
    pathToFileURL(resolve(output, 'support.mjs')).href
  );
  const fixture = createFoodOptimizerFixture(scenario);
  fixture.request.seeds = Array.from({ length: fixture.request.rounds }, (_, index) => (seed + index) >>> 0);
  const modes = [
    { name: 'js', wasm: false },
    { name: 'wasm', wasm: true },
  ].map((mode) => ({
    ...mode,
    simulationUrl: pathToFileURL(resolve(output, 'simulation.mjs')).href,
    bridgeUrl: pathToFileURL(resolve(output, 'bridge.mjs')).href,
    glueUrl: pathToFileURL(gluePath).href,
    wasmPath,
  }));

  const run = async (mode) => {
    const clients = [];
    const workerMetrics = { createdWorkers: 0, progressMessages: 0 };
    const request = structuredClone(fixture.request);
    if (mode.wasm) request.useWasmEngine = true;
    else delete request.useWasmEngine;
    const start = performance.now();
    let report;
    try {
      report = await createFoodOptimizerSearch({
        request,
        items: structuredClone(fixture.items),
        foodSlots: fixture.foodSlots,
        workerLimit: workers,
        reuse: true,
        workerFactory: () => {
          const client = new BenchmarkClient(mode, workerMetrics);
          clients.push(client);
          return client;
        },
      }).done;
    } finally {
      for (const client of clients) client.stop();
      await Promise.all(clients.map((client) => client.termination));
    }
    const elapsedMs = performance.now() - start;
    assert.equal(report.status, 'completed', report.error ?? report.status);
    return { report, elapsedMs, workerMetrics };
  };

  // 硬口径：物理结果（baseline + top 10 与 complete）。软口径：stats 计数——
  // 剪枝/共享缓存的命中受多 worker 调度时序影响（同一模式重复跑也会抖动），
  // 只记录差异，不作为失败条件。
  const diffStats = (left, right) => {
    const delta = {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
      if (left[key] !== right[key]) delta[key] = [left[key], right[key]];
    return delta;
  };
  const summarize = (report) => ({
    physical: {
      complete: report.complete,
      baseline: physicalFoodOptimizerResult(report.baseline),
      top: report.topResults.map((entry) => ({
        signature: entry.signature,
        result: physicalFoodOptimizerResult(entry),
      })),
    },
    stats: report.stats,
  });

  const measurements = new Map(modes.map((mode) => [mode.name, []]));
  const statsDeltas = [];
  let reference;
  for (let pair = 0; pair < pairs; pair += 1) {
    // 交替顺序抵消热漂移：同一对内先跑的先进先衰，下一对反转先后。
    const order = pair % 2 === 0 ? modes : [...modes].reverse();
    for (const mode of order) {
      const { report, elapsedMs, workerMetrics } = await run(mode);
      const summary = summarize(report);
      if (!reference) reference = { mode: mode.name, summary };
      else {
        assert.deepEqual(
          summary.physical,
          reference.summary.physical,
          `${mode.name}: task-level physical results mismatch against ${reference.mode}`,
        );
        const delta = diffStats(reference.summary.stats, summary.stats);
        if (Object.keys(delta).length) {
          statsDeltas.push({ mode: mode.name, against: reference.mode, delta });
          console.warn(
            `${mode.name}: scheduling-sensitive stats differ from ${reference.mode}: ${JSON.stringify(delta)}`,
          );
        }
      }
      measurements.get(mode.name).push({ elapsedMs, workerMetrics, stats: report.stats });
      console.log(
        `${scenarioName} | ${mode.name} | ${pair + 1}/${pairs} | ${elapsedMs.toFixed(1)} ms | ${report.stats.completedCandidates} candidates | ${report.stats.feasibleCandidates} feasible | ${workerMetrics.createdWorkers} workers`,
      );
    }
  }
  const jsMedian = median(measurements.get('js').map((entry) => entry.elapsedMs));
  const wasmMedian = median(measurements.get('wasm').map((entry) => entry.elapsedMs));
  const speedup = jsMedian / wasmMedian;
  const result = {
    createdAt: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    availableCores: availableParallelism(),
    workers,
    pairs,
    seed,
    scenario,
    fixtureRequestRounds: fixture.request.rounds,
    totalCandidates: reference.summary.stats.totalCandidates,
    feasibleCandidates: reference.summary.stats.feasibleCandidates,
    statsDeltas,
    modes: Object.fromEntries(
      [...measurements].map(([name, runs]) => [name, { medianMs: median(runs.map((r) => r.elapsedMs)), runs }]),
    ),
    speedup,
  };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(
    `js median ${jsMedian.toFixed(1)} ms | wasm median ${wasmMedian.toFixed(1)} ms | speedup ${speedup.toFixed(3)}x`,
  );
  console.log(`report: ${resolve(output, 'report.json')}`);
}

if (isMainThread) await main();
