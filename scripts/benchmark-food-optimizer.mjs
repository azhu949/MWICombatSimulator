// Runs the simulation core in isolated Node workers; never starts the app/server.
// node scripts/benchmark-food-optimizer.mjs --workers=1 --samples=3 --case=zone,dungeon --before=tmp/food-optimizer-composition-before
// Optional: --seed=1 --seconds=600 --rounds=3 --threshold-step=25 --report=tmp/food-optimizer-benchmark/custom.json
// --before selects a snapshot directory; --iteration-before retains the earlier fixed snapshot comparison.
// Both can be used together. --previous retains the oldest, top-ten-only comparison.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

if (!isMainThread) {
  const { evaluateFoodOptimizerCandidate, createFoodOptimizerEvaluator } = await import(workerData.moduleUrl);
  const referenceRound = workerData.reference
    ? (await import(workerData.supportUrl)).referenceFoodOptimizerRound
    : null;
  let request;
  let collectThresholds = true;
  let evaluator;
  parentPort.on('message', async (data) => {
    try {
      if (data.type === 'init') {
        request = data.request;
        collectThresholds = data.collectThresholds !== false;
        evaluator = referenceRound
          ? (candidate, baselineDeaths, progress) =>
              evaluateFoodOptimizerCandidate(request, candidate, baselineDeaths, progress, referenceRound, {
                collectThresholds: false,
              })
          : createFoodOptimizerEvaluator?.(request, {
              collectThresholds,
              sharedRounds: data.sharedRounds,
              items: data.items,
            });
        parentPort.postMessage({ type: 'result' });
        return;
      }
      const progress = (value) => parentPort.postMessage({ type: 'progress', ...value });
      const result = evaluator
        ? await evaluator(data.candidate, data.baselineDeaths, progress, data.reusableSamples)
        : await evaluateFoodOptimizerCandidate(
            request,
            data.candidate,
            data.baselineDeaths,
            progress,
            undefined,
            workerData.legacy ? { costPerHourLimit: data.costPerHourLimit } : { collectThresholds },
          );
      parentPort.postMessage({ type: 'result', result });
    } catch (error) {
      parentPort.postMessage({ type: 'error', error: error?.stack || String(error) });
    }
  });
}

class BenchmarkClient {
  constructor(mode, metrics) {
    this.metrics = metrics;
    this.rounds = 0;
    this.worker = new Worker(new URL(import.meta.url), {
      workerData: {
        moduleUrl: mode.simulationUrl,
        legacy: mode.legacy,
        reference: mode.reference,
        supportUrl: mode.supportUrl,
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
        if (message.type === 'init') this.rounds = message.request.rounds;
        if (message.type === 'evaluate' && message.candidate != null) {
          this.metrics.candidateDispatches += 1;
          const samples = message.reusableSamples;
          let complete = Array.isArray(samples) && this.rounds > 0 && samples.length >= this.rounds;
          // Check every requested index: Array.every would skip sparse holes.
          for (let round = 0; complete && round < this.rounds; round += 1) complete = Boolean(samples[round]);
          if (complete) this.metrics.fullyReusableCandidateDispatches += 1;
        }
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

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = resolve(root, 'tmp', 'food-optimizer-benchmark');
  const value = (name, fallback) =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const integer = (name, fallback, min, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value(name, fallback));
    assert(Number.isSafeInteger(parsed) && parsed >= min && parsed <= max, `${name} must be from ${min} to ${max}`);
    return parsed;
  };
  const workers = Math.min(availableParallelism(), 64, integer('workers', 1, 1));
  const samples = integer('samples', 3, 1, 5);
  const seed = integer('seed', 1, 0, 0xffffffff);
  const beforeArgument = value('before');
  assert(!process.argv.includes('--before'), 'use --before=<snapshot directory>');
  assert(beforeArgument === undefined || beforeArgument.trim(), 'before must name a snapshot directory');
  const selectedSnapshots = [
    ...(beforeArgument !== undefined ? [{ name: 'before', directory: resolve(root, beforeArgument) }] : []),
    ...(process.argv.includes('--iteration-before')
      ? [{ name: 'iteration-before', directory: resolve(root, 'tmp', 'food-optimizer-iteration-before') }]
      : []),
  ];
  const reportPath = value('report')
    ? resolve(root, value('report'))
    : resolve(output, `report-${workers}-workers.json`);
  const isWithin = (directory, target) => {
    const difference = relative(directory, target);
    return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
  };
  for (const snapshot of selectedSnapshots) {
    assert(!isWithin(snapshot.directory, output), 'benchmark output must not overwrite a snapshot directory');
    assert(!isWithin(snapshot.directory, reportPath), 'benchmark report must not be written inside a snapshot');
    snapshot.metadata = JSON.parse(await readFile(resolve(snapshot.directory, 'snapshot.json'), 'utf8'));
    for (const file of ['search.mjs', 'simulation.mjs', 'pruning.mjs']) await access(resolve(snapshot.directory, file));
    if (snapshot.metadata.sha256)
      await Promise.all(
        Object.entries(snapshot.metadata.sha256).map(async ([file, expected]) => {
          assert(/^[^\\/]+\.mjs$/.test(file), 'snapshot checksum entries must name local module files');
          const actual = createHash('sha256')
            .update(await readFile(resolve(snapshot.directory, file)))
            .digest('hex');
          assert.equal(actual, expected, `snapshot file has changed: ${resolve(snapshot.directory, file)}`);
        }),
      );
  }
  const overrides = {};
  for (const [option, property, maximum] of [
    ['seconds', 'seconds', Number.MAX_SAFE_INTEGER / 1e9],
    ['rounds', 'rounds', 10],
    ['threshold-step', 'thresholdStepPercent', 100],
  ])
    if (value(option) !== undefined) overrides[property] = integer(option, undefined, 1, maximum);
  await mkdir(output, { recursive: true });
  const { build } = await import('esbuild');
  await build({
    absWorkingDir: root,
    entryPoints: {
      search: 'src/services/foodOptimizerSearch.js',
      simulation: 'src/services/foodOptimizerSimulation.js',
      support: 'src/services/__tests__/support/foodOptimizerTestSupport.js',
      domain: 'src/services/foodOptimizerDomain.js',
      pruning: 'src/services/foodOptimizerPruning.js',
    },
    outdir: output,
    bundle: true,
    splitting: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  });
  const { createFoodOptimizerFixture, physicalFoodOptimizerResult } = await import(
    pathToFileURL(resolve(output, 'support.mjs'))
  );
  const domain = await import(pathToFileURL(resolve(output, 'domain.mjs')));
  const pruning = await import(pathToFileURL(resolve(output, 'pruning.mjs')));
  const searchUrl = pathToFileURL(resolve(output, 'search.mjs')).href;
  const simulationUrl = pathToFileURL(resolve(output, 'simulation.mjs')).href;
  const supportUrl = pathToFileURL(resolve(output, 'support.mjs')).href;
  const modes = [
    { name: 'exhaustive', searchUrl, simulationUrl, supportUrl, reuse: false, reference: true, pruning },
    { name: 'optimized', searchUrl, simulationUrl, reuse: true, pruning },
  ];
  let iterationSnapshot;
  let beforeSnapshot;
  for (const { name, directory, metadata } of selectedSnapshots) {
    if (name === 'before') beforeSnapshot = { directory, metadata };
    else iterationSnapshot = metadata;
    modes.push({
      name,
      searchUrl: pathToFileURL(resolve(directory, 'search.mjs')).href,
      simulationUrl: pathToFileURL(resolve(directory, 'simulation.mjs')).href,
      reuse: true,
      pruning: await import(pathToFileURL(resolve(directory, 'pruning.mjs'))),
    });
  }
  if (process.argv.includes('--previous')) {
    const previous = resolve(root, 'tmp', 'food-optimizer-before');
    await access(resolve(previous, 'foodOptimizerSearch.mjs'));
    modes.push({
      name: 'previous-top-ten-only',
      legacy: true,
      searchUrl: pathToFileURL(resolve(previous, 'foodOptimizerSearch.mjs')).href,
      simulationUrl: pathToFileURL(resolve(previous, 'foodOptimizerSimulation.mjs')).href,
    });
  }
  for (const mode of modes) mode.search = (await import(mode.searchUrl)).createFoodOptimizerSearch;
  const selectedCases = value('case', '').split(',').filter(Boolean);
  const scenarios = [
    { name: 'zone', foodSlots: 3 },
    { name: 'dungeon', target: 'dungeon', foodSlots: 2 },
    { name: 'catalog-all', foodSlots: 2, fullCatalog: true, seconds: 60, rounds: 2, thresholdStepPercent: 50 },
    {
      name: 'catalog-three-slots',
      explicitOnly: true,
      foodSlots: 3,
      fullCatalog: true,
      seconds: 60,
      rounds: 2,
      thresholdStepPercent: 100,
    },
    {
      name: 'catalog-window',
      foodSlots: 2,
      fullCatalog: true,
      seconds: 600,
      rounds: 3,
      thresholdStepPercent: 25,
      itemHrids: [
        '/items/gummy',
        '/items/star_fruit_yogurt',
        '/items/donut',
        '/items/blueberry_cake',
        '/items/blueberry_donut',
        '/items/blackberry_donut',
        '/items/strawberry_donut',
        '/items/mooberry_donut',
      ],
    },
    { name: 'no-mana-fine-grid', foodSlots: 3, noManaUse: true, thresholdStepPercent: 10 },
    {
      name: 'party-scroll',
      foodSlots: 2,
      party: true,
      activePlayerId: '2',
      scrolls: true,
      seconds: 1801,
      rounds: 2,
      thresholdStepPercent: 50,
    },
  ];
  for (const name of selectedCases)
    assert(
      scenarios.some((scenario) => scenario.name === name),
      `unknown case: ${name}`,
    );
  const cases = scenarios
    .filter((scenario) => (selectedCases.length ? selectedCases.includes(scenario.name) : !scenario.explicitOnly))
    .map((scenario) => ({ seconds: 600, rounds: 3, thresholdStepPercent: 25, ...scenario, ...overrides }));
  const summary = {
    status: 'running',
    createdAt: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    availableCores: availableParallelism(),
    workers,
    samples,
    seed,
    arguments: process.argv.slice(2),
    beforeSnapshot,
    iterationSnapshot,
    note: 'Wall time includes worker startup, baseline, search, and termination. Compilation and separate exhaustive coverage audits are excluded. Every mode receives the same fixture and seeds. Exhaustive mode disables outcome reuse and runs complete rounds with full combat results, generic consumable triggers, and the original repeated buff scans. Before uses the selected snapshot directory; its checksums are verified when available. Iteration-before retains the earlier fixed complete-optimizer snapshot. Previous mode preserves only the top ten, not all feasible candidates.',
    workerMetricsNote:
      'Per-run workerMetrics count created Node workers, successful candidate evaluate sends (excluding init and baseline), and all received progress messages. fullyReusableCandidateDispatches counts sends supplying a nonempty reusable sample at every requested round index; it observes supplied samples without revalidating their certificates. Separate coverage-audit runs are not included.',
    cases: [],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  const save = () => writeFile(reportPath, JSON.stringify(summary, null, 2) + '\n');

  async function run(mode, fixture, onCoverage) {
    const clients = [];
    const workerMetrics = {
      createdWorkers: 0,
      candidateDispatches: 0,
      progressMessages: 0,
      fullyReusableCandidateDispatches: 0,
    };
    const start = performance.now();
    let report;
    try {
      report = await mode.search({
        ...structuredClone(fixture),
        workerLimit: workers,
        reuse: mode.reuse,
        onCoverage,
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
    assert.equal(report.status, 'completed', report.error);
    return { report, elapsedMs, workerMetrics };
  }

  const topResults = (report) =>
    report.topResults.map((entry) => ({ signature: entry.signature, result: physicalFoodOptimizerResult(entry) }));
  const checkCounts = (report, expectedCount, context) => {
    const stats = report.stats;
    assert.equal(report.complete, true, `${context}: search is incomplete`);
    assert.equal(stats.totalCandidates, expectedCount, `${context}: candidate-domain mismatch`);
    assert.equal(stats.completedCandidates, expectedCount, `${context}: candidates missing`);
    assert.equal(
      stats.simulatedCandidates + stats.reusedCandidates + stats.skippedCandidates,
      expectedCount,
      `${context}: coverage accounting mismatch`,
    );
    assert.equal(
      stats.feasibleCandidates + stats.rejectedMana + stats.rejectedDeaths,
      expectedCount,
      `${context}: classification accounting mismatch`,
    );
    assert(stats.completedRounds <= stats.maxSimulationRounds, `${context}: round-count overflow`);
  };
  await save();
  for (const scenario of cases) {
    const fixture = createFoodOptimizerFixture(scenario);
    if (scenario.itemHrids) {
      const selectedHrids = new Set(scenario.itemHrids);
      fixture.items = fixture.items.filter((item) => selectedHrids.has(item.hrid));
      assert.equal(fixture.items.length, selectedHrids.size, `${scenario.name}: a selected food is missing`);
    }
    fixture.request.seeds = Array.from({ length: fixture.request.rounds }, (_, index) => (seed + index) >>> 0);
    const fixtureSha256 = createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
    const signatures = new Set();
    for (const composition of domain.generateFoodOptimizerCompositionItems(fixture.items, fixture.foodSlots))
      for (const candidate of domain.generateFoodOptimizerCompositionCandidates(composition)) {
        assert(!signatures.has(candidate.signature), `${scenario.name}: duplicate input candidate`);
        signatures.add(candidate.signature);
      }
    const measurements = new Map(modes.map((mode) => [mode.name, []]));
    let expectedTop;
    let expectedFeasible;
    let expectedBaseline;
    for (let sample = 0; sample < samples; sample += 1) {
      // Rotate execution order to reduce warm-cache and thermal ordering bias.
      const ordered = [...modes.slice(sample % modes.length), ...modes.slice(0, sample % modes.length)];
      for (const mode of ordered) {
        const { report, elapsedMs, workerMetrics } = await run(mode, fixture);
        const context = `${scenario.name}/${mode.name}`;
        const top = topResults(report);
        if (expectedTop) assert.deepEqual(top, expectedTop, `${context}: top-ten physical-result mismatch`);
        else expectedTop = top;
        if (!mode.legacy) {
          checkCounts(report, signatures.size, context);
          const baseline = physicalFoodOptimizerResult(report.baseline);
          if (expectedBaseline) assert.deepEqual(baseline, expectedBaseline, `${context}: baseline mismatch`);
          else expectedBaseline = baseline;
          if (expectedFeasible != null)
            assert.equal(report.stats.feasibleCandidates, expectedFeasible, `${context}: feasible-count mismatch`);
          else expectedFeasible = report.stats.feasibleCandidates;
        }
        measurements.get(mode.name).push({ elapsedMs, stats: report.stats, workerMetrics });
        console.log(
          `${scenario.name} | ${mode.name} | ${sample + 1}/${samples} | ${elapsedMs.toFixed(1)} ms | ${report.stats.completedCandidates} candidates | ${report.stats.feasibleCandidates} feasible`,
        );
      }
    }
    // Expanding reused blocks would penalize the algorithm being measured, so
    // audit one separate run per complete mode, outside every timing sample.
    let expectedCoverage;
    const coverageAudits = {};
    for (const mode of modes.filter((entry) => !entry.legacy)) {
      const context = `${scenario.name}/${mode.name}`;
      const covered = new Map();
      const accept = (candidate, result) => {
        assert(signatures.has(candidate.signature), `${context}: unexpected candidate ${candidate.signature}`);
        assert(!covered.has(candidate.signature), `${context}: duplicate coverage ${candidate.signature}`);
        covered.set(candidate.signature, physicalFoodOptimizerResult(result));
      };
      const { report } = await run(mode, fixture, (coverage) => {
        if (coverage.candidate) accept(coverage.candidate, coverage.result);
        else
          for (const candidate of domain.generateFoodOptimizerCompositionCandidates(coverage.items)) {
            if (candidate.signature === coverage.excludedSignature) continue;
            accept(candidate, mode.pruning.materializeFoodOptimizerOutcome(coverage.evidence, candidate));
          }
      });
      checkCounts(report, signatures.size, context);
      assert.equal(covered.size, signatures.size, `${context}: incomplete coverage`);
      const feasible = [...covered.values()].filter((result) => result.feasible).length;
      assert.equal(feasible, expectedFeasible, `${context}: audited feasible-count mismatch`);
      assert.deepEqual(topResults(report), expectedTop, `${context}: audited top-ten physical-result mismatch`);
      if (expectedCoverage)
        assert.deepEqual(covered, expectedCoverage, `${context}: per-candidate physical-result mismatch`);
      else expectedCoverage = covered;
      coverageAudits[mode.name] = { coveredCandidates: covered.size, feasibleCandidates: feasible, duplicates: 0 };
      console.log(`${context}: coverage and all feasible physical results verified (${covered.size} candidates)`);
    }
    const result = {
      scenario,
      seeds: fixture.request.seeds,
      rounds: fixture.request.rounds,
      simulationTimeLimit: fixture.request.payload.simulationTimeLimit,
      fixtureSha256,
      totalCandidates: signatures.size,
      feasibleCandidates: expectedFeasible,
      coverageAudits,
      modes: Object.fromEntries(
        [...measurements].map(([name, runs]) => [
          name,
          {
            medianMs: [...runs].sort((a, b) => a.elapsedMs - b.elapsedMs)[Math.floor(runs.length / 2)].elapsedMs,
            runs,
          },
        ]),
      ),
    };
    result.speedup = result.modes.exhaustive.medianMs / result.modes.optimized.medianMs;
    if (result.modes.before) result.beforeSpeedup = result.modes.before.medianMs / result.modes.optimized.medianMs;
    if (result.modes['iteration-before'])
      result.iterationSpeedup = result.modes['iteration-before'].medianMs / result.modes.optimized.medianMs;
    summary.cases.push(result);
    await save();
    console.log(`${scenario.name}: ${result.speedup.toFixed(2)}x versus complete exhaustive evaluation`);
    if (result.beforeSpeedup)
      console.log(`${scenario.name}: ${result.beforeSpeedup.toFixed(2)}x versus snapshot ${beforeArgument}`);
    if (result.iterationSpeedup)
      console.log(
        `${scenario.name}: ${result.iterationSpeedup.toFixed(2)}x versus this iteration's previous optimizer`,
      );
  }
  summary.status = 'completed';
  await save();
  console.log(`Report: ${reportPath}`);
}

if (isMainThread) await main();
