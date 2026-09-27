// JS combat-engine throughput baseline benchmark (slice 1 of the Rust/WASM port).
// Runs the canonical synthetic scenario (src/combatsimulator/__tests__/support/
// syntheticCombatScenario.js, shared with the parity harness) in isolated Node
// workers and reports wall-clock seconds and simulated-hours/sec, so the
// Rust/WASM engine can be compared against this baseline slice by slice.
// Never starts the app/server. Companion of benchmark-food-optimizer.mjs.
// node scripts/benchmark-combat-engine.mjs --workers=4 --samples=3
// Optional: --report=tmp/combat-engine-benchmark/custom.json
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

if (!isMainThread) {
  const { supportUrl, msPerRun } = workerData;
  const { createSyntheticScenario, collectScenarioMetrics } = await import(supportUrl);

  parentPort.on('message', (data) => {
    if (data.type !== 'run') return;
    try {
      const simulator = createSyntheticScenario(data.round);
      const startedAt = performance.now();
      simulator.simulate(msPerRun).then(
        () => {
          const elapsedMs = performance.now() - startedAt;
          const metrics = collectScenarioMetrics(simulator.simResult);
          parentPort.postMessage({
            type: 'result',
            round: data.round,
            elapsedMs,
            attackTally: metrics.attackTally,
            hitRate: metrics.hitRate,
          });
        },
        (error) => parentPort.postMessage({ type: 'error', error: error?.stack || String(error) }),
      );
    } catch (error) {
      parentPort.postMessage({ type: 'error', error: error?.stack || String(error) });
    }
  });
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const value = (name, fallback) =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const integer = (name, fallback, min, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value(name, fallback));
    assert(Number.isSafeInteger(parsed) && parsed >= min && parsed <= max, `${name} must be from ${min} to ${max}`);
    return parsed;
  };
  const workers = Math.min(availableParallelism(), 16, integer('workers', 1, 1));
  const samples = integer('samples', 1, 1, 9);
  const report = value('report');
  const output = resolve(root, 'tmp', 'combat-engine-benchmark');
  const scenarioEntry = 'src/combatsimulator/__tests__/support/syntheticCombatScenario.js';

  // The scenario module uses Vite-style extensionless imports that Node ESM cannot
  // resolve, so bundle it (same approach as benchmark-food-optimizer.mjs).
  await mkdir(output, { recursive: true });
  const { build } = await import('esbuild');
  await build({
    absWorkingDir: root,
    entryPoints: { support: scenarioEntry },
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  });
  const supportUrl = pathToFileURL(resolve(output, 'support.mjs')).href;
  const { SCENARIO_MS_PER_RUN } = await import(supportUrl);
  const { Worker } = await import('node:worker_threads');

  const results = [];
  const startedAt = performance.now();
  for (let round = 0; round < samples; round += 1) {
    const roundResults = await Promise.all(
      Array.from({ length: workers }, (_, workerIndex) => {
        return new Promise((resolveRun, rejectRun) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { supportUrl, msPerRun: SCENARIO_MS_PER_RUN },
          });
          worker.once('message', (data) => {
            void worker.terminate();
            if (data.type === 'error') rejectRun(new Error(data.error));
            else resolveRun({ workerIndex, ...data });
          });
          worker.once('error', rejectRun);
          worker.postMessage({ type: 'run', round: round * workers + workerIndex });
        });
      }),
    );
    results.push(...roundResults);
  }

  const elapsedMs = performance.now() - startedAt;
  const meanRunMs = results.reduce((sum, entry) => sum + entry.elapsedMs, 0) / results.length;
  const simulatedSecondsTotal = (results.length * SCENARIO_MS_PER_RUN) / 1000;
  const wallSeconds = elapsedMs / 1000;
  const reportPayload = {
    engine: 'js',
    benchmarkSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    supportSha256: sha256(await readFile(resolve(root, scenarioEntry))),
    workers,
    rounds: samples,
    simulatedSecondsPerRun: SCENARIO_MS_PER_RUN / 1000,
    elapsedMs,
    meanRunMs,
    wallSeconds,
    simulatedHoursPerWallSecond: simulatedSecondsTotal / wallSeconds / 3600,
    perRun: results.map(({ round, elapsedMs: ms, attackTally, hitRate }) => ({
      round,
      elapsedMs: ms,
      attackTally,
      hitRate,
    })),
  };
  const json = JSON.stringify(reportPayload, null, 2);
  if (report) {
    await mkdir(dirname(resolve(root, report)), { recursive: true });
    await writeFile(resolve(root, report), json);
  } else {
    await writeFile(resolve(output, 'baseline.json'), json);
  }
  console.log(json);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

await main();
