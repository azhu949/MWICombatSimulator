// Isolated Node workers only; never starts the app or a development server.
// node scripts/benchmark-food-optimizer-top-ten.mjs --workers=1 --samples=3 --before=tmp/food-optimizer-top-ten-before
// Large cases are explicit: --case=catalog-three-default-grid or --case=dungeon-long
// Feasible normal-map defaults: --case=zone-mp30-default,zone-mp30-finer,catalog-mp30-three
// Full normal-map catalog at the default grid: --case=catalog-mp30-three-default --mode=top10
// Optional: --seconds=600 --rounds=3 --seed=1 --threshold-step=25 --oracle-limit=10000 --report=tmp/report.json
// Same-mode comparison: --mode=top10 --before-mode=top10 --before=<snapshot directory>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

// Do not share the production evaluator or result aggregation with the oracle.
// Even invalid candidates run every seed to the original full time limit.
async function referenceEvaluation(request, candidate, baselineDeaths, simulateRound, progress = () => {}) {
  const samples = [];
  for (const seed of request.seeds) {
    samples.push(await simulateRound(request, candidate, seed));
    progress({ round: samples.length, progress: 0, simulatedRounds: samples.length, reusedRounds: 0 });
  }
  const deaths = samples.reduce((sum, sample) => sum + sample.deaths, 0);
  const ranOutOfMana = samples.some((sample) => sample.ranOutOfMana);
  const rejected = candidate ? (ranOutOfMana ? 'mana' : deaths > baselineDeaths ? 'deaths' : '') : '';
  const foodUsed = {};
  for (const sample of samples)
    for (const [hrid, count] of Object.entries(sample.foodUsed))
      foodUsed[hrid] = (foodUsed[hrid] || 0) + count / samples.length;
  return {
    feasible: !rejected,
    rejected,
    deaths,
    ranOutOfMana,
    foodUsed,
    samples,
    roundsCompleted: samples.length,
    simulatedRounds: samples.length,
    reusedRounds: 0,
    costPerHour: samples.reduce((sum, sample) => sum + sample.costPerHour, 0) / samples.length,
  };
}

if (!isMainThread) {
  if (workerData.workerUrl) {
    // Run the bundled production browser-worker entry, including its real cost
    // cutoff forwarding. Only the transport is adapted to Node worker_threads.
    globalThis.self = { postMessage: (message) => parentPort.postMessage(message), onmessage: null };
    await import(workerData.workerUrl);
    parentPort.on('message', (data) => globalThis.self.onmessage({ data }));
  } else {
    const createEvaluator = workerData.reference
      ? null
      : (await import(workerData.simulationUrl)).createFoodOptimizerEvaluator;
    const referenceRound = workerData.reference
      ? (await import(workerData.supportUrl)).referenceFoodOptimizerRound
      : null;
    let request;
    let evaluate;
    parentPort.on('message', async (data) => {
      try {
        if (data.type === 'init') {
          request = data.request;
          evaluate = referenceRound
            ? (candidate, baselineDeaths, progress) =>
                referenceEvaluation(request, candidate, baselineDeaths, referenceRound, progress)
            : createEvaluator(request, {
                collectThresholds: data.collectThresholds !== false,
                sharedRounds: data.sharedRounds,
                items: data.items,
              });
          parentPort.postMessage({ type: 'result' });
          return;
        }
        const result = await evaluate(
          data.candidate,
          data.baselineDeaths,
          (progress) => parentPort.postMessage({ type: 'progress', ...progress }),
          data.reusableSamples,
          data.costCutoff,
        );
        parentPort.postMessage({ type: 'result', result });
      } catch (error) {
        parentPort.postMessage({ type: 'error', error: error?.stack || String(error) });
      }
    });
  }
}

class BenchmarkClient {
  constructor(mode, metrics) {
    this.metrics = metrics;
    this.pending = null;
    this.worker = new Worker(new URL(import.meta.url), {
      workerData: {
        workerUrl: mode.workerUrl,
        simulationUrl: mode.simulationUrl,
        supportUrl: mode.supportUrl,
        reference: mode.reference,
      },
    });
    metrics.createdWorkers += 1;
    this.worker.on('message', (message) => {
      if (message.type === 'progress') metrics.progressMessages += 1;
      if (!this.pending) return;
      if (message.type === 'progress') this.pending.progress?.(message);
      else {
        const pending = this.pending;
        this.pending = null;
        if (message.type === 'error') pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      }
    });
    this.worker.on('error', (error) => this.stop(error));
    this.worker.on('exit', (code) => {
      if (this.pending) this.stop(new Error(`Worker exited during a request (${code}).`));
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
        if (message.type === 'evaluate' && message.candidate) {
          this.metrics.candidateDispatches += 1;
          if (Number.isFinite(message.costCutoff)) this.metrics.dispatchesWithCostCutoff += 1;
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

const freshWorkerMetrics = () => ({
  createdWorkers: 0,
  candidateDispatches: 0,
  dispatchesWithCostCutoff: 0,
  progressMessages: 0,
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const volume = (box) => box.reduce((count, [min, max]) => count * (max - min + 1), 1);

// Return disjoint slabs covering outer minus cutter, plus the removed volume.
// Coordinates are integer indices in the original discrete threshold axes.
function subtractBox(outer, cutter) {
  const intersection = outer.map(([min, max], index) => [
    Math.max(min, cutter[index][0]),
    Math.min(max, cutter[index][1]),
  ]);
  if (intersection.some(([min, max]) => min > max)) return { pieces: [outer], removed: 0 };
  const pieces = [];
  const middle = outer.map((range) => [...range]);
  for (let index = 0; index < middle.length; index += 1) {
    if (middle[index][0] < intersection[index][0]) {
      const slab = middle.map((range) => [...range]);
      slab[index][1] = intersection[index][0] - 1;
      pieces.push(slab);
      middle[index][0] = intersection[index][0];
    }
    if (middle[index][1] > intersection[index][1]) {
      const slab = middle.map((range) => [...range]);
      slab[index][0] = intersection[index][1] + 1;
      pieces.push(slab);
      middle[index][1] = intersection[index][1];
    }
  }
  return { pieces, removed: volume(intersection) };
}

// Exact domain audit without constructing every candidate. Removing only the
// still-uncovered volume proves both absence of duplicates and full coverage.
function createCoverageAudit(fixture, domain, context) {
  const compositions = new Map();
  const compositionKey = (items) => JSON.stringify(items.map((item) => item.hrid).sort());
  let expectedCount = 0;
  for (const items of domain.generateFoodOptimizerCompositionItems(fixture.items, fixture.foodSlots)) {
    const arranged = [...items].sort((a, b) => (a.hrid < b.hrid ? -1 : a.hrid > b.hrid ? 1 : 0));
    const full = arranged.map((item) => [0, item.thresholds.length - 1]);
    const count = volume(full);
    expectedCount += count;
    compositions.set(compositionKey(items), {
      arranged,
      indices: arranged.map((item) => new Map(item.thresholds.map((threshold, index) => [threshold, index]))),
      remaining: [full],
      defaultCandidate: domain.buildFoodDefaultCandidate(items),
      count,
      covered: 0,
    });
  }
  assert.equal(expectedCount, domain.countFoodOptimizerCandidates(fixture.items, fixture.foodSlots));
  const digest = createHash('sha256');
  const counts = {
    coveredCandidates: 0,
    feasibleCandidates: 0,
    rejectedMana: 0,
    rejectedDeaths: 0,
    prunedCandidates: 0,
  };
  let records = 0;
  let peakUncoveredFragments = 1;
  const pointFor = (entry, candidate) =>
    entry.arranged.map((item, axis) => {
      const slot = candidate.slots.find((slot) => slot.hrid === item.hrid);
      const index = entry.indices[axis].get(slot?.threshold);
      assert(index !== undefined && slot.kind === item.kind, `${context}: candidate outside input grid`);
      return [index, index];
    });
  const remove = (entry, box) => {
    let removed = 0;
    const remaining = [];
    for (const original of entry.remaining) {
      const difference = subtractBox(original, box);
      removed += difference.removed;
      remaining.push(...difference.pieces);
    }
    assert.equal(removed, volume(box), `${context}: duplicate or out-of-domain coverage`);
    entry.remaining = remaining;
    entry.covered += removed;
    peakUncoveredFragments = Math.max(peakUncoveredFragments, remaining.length);
  };
  return {
    accept(coverage) {
      const items = coverage.candidate?.slots ?? coverage.items;
      const key = compositionKey(items);
      const entry = compositions.get(key);
      assert(entry, `${context}: unexpected composition ${key}`);
      let box;
      if (coverage.candidate) {
        assert.equal(
          domain.buildFoodCandidate(coverage.candidate.slots).signature,
          coverage.candidate.signature,
          `${context}: invalid candidate signature`,
        );
        box = pointFor(entry, coverage.candidate);
      } else
        box = entry.arranged.map((item, axis) => {
          const thresholds = items.find((other) => other.hrid === item.hrid)?.thresholds;
          assert(thresholds?.length, `${context}: empty coverage axis`);
          const indices = thresholds.map((threshold) => entry.indices[axis].get(threshold));
          assert(
            indices.every((index) => index !== undefined),
            `${context}: unknown coverage threshold`,
          );
          const sorted = [...indices].sort((a, b) => a - b);
          assert(
            sorted.every((index, offset) => index === sorted[0] + offset),
            `${context}: noncontiguous coverage axis`,
          );
          return [sorted[0], sorted.at(-1)];
        });
      let pieces = [box];
      if (coverage.excludedSignature !== undefined) {
        assert.equal(
          coverage.excludedSignature,
          entry.defaultCandidate.signature,
          `${context}: unknown excluded candidate`,
        );
        const exclusion = pointFor(entry, entry.defaultCandidate);
        const difference = subtractBox(box, exclusion);
        assert.equal(difference.removed, 1, `${context}: exclusion lies outside its coverage block`);
        pieces = difference.pieces;
      }
      const count = pieces.reduce((sum, piece) => sum + volume(piece), 0);
      assert(count > 0, `${context}: empty coverage record`);
      for (const piece of pieces) remove(entry, piece);
      const result = coverage.result ?? coverage.evidence.result;
      let classification;
      if (result.pruned === 'cost' || result.pruned === 'rank') {
        assert.equal(result.feasible, null, `${context}: pruning was represented as infeasibility`);
        assert.equal(result.rejected, '', `${context}: ranking pruning was mixed with a failure reason`);
        classification = 'prunedCandidates';
      } else if (result.feasible === true) classification = 'feasibleCandidates';
      else if (result.feasible === false && result.rejected === 'mana') classification = 'rejectedMana';
      else if (result.feasible === false && result.rejected === 'deaths') classification = 'rejectedDeaths';
      else throw new Error(`${context}: missing final candidate classification`);
      counts[classification] += count;
      counts.coveredCandidates += count;
      records += 1;
      digest.update(JSON.stringify([key, box, coverage.excludedSignature ?? null, classification]) + '\n');
    },
    finish(report) {
      for (const [key, entry] of compositions) {
        assert.equal(entry.remaining.length, 0, `${context}: uncovered region in ${key}`);
        assert.equal(entry.covered, entry.count, `${context}: composition volume mismatch`);
      }
      assert.equal(counts.coveredCandidates, expectedCount, `${context}: missing coverage`);
      for (const name of ['feasibleCandidates', 'rejectedMana', 'rejectedDeaths', 'prunedCandidates'])
        assert.equal(report.stats[name] ?? 0, counts[name], `${context}: ${name} disagrees with coverage`);
      return {
        type: 'exact-discrete-box-subtraction',
        ...counts,
        records,
        peakUncoveredFragments,
        sha256: digest.digest('hex'),
      };
    },
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = resolve(root, 'tmp/food-optimizer-top-ten-benchmark');
  const value = (name, fallback) =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const integer = (name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value(name, fallback));
    assert(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum, `Invalid --${name} value`);
    return parsed;
  };
  const workers = Math.min(availableParallelism(), integer('workers', 1, 1, 64));
  const samples = integer('samples', 3, 1, 10);
  const seed = integer('seed', 1, 0, 0xffffffff);
  const oracleLimit = integer('oracle-limit', 10000, 0);
  const reportPath = resolve(
    root,
    value('report', `tmp/food-optimizer-top-ten-benchmark/report-${workers}-workers.json`),
  );
  const beforeArgument = value('before');
  const selectedMode = value('mode', 'both');
  const beforeMode = value('before-mode', 'complete');
  assert(['both', 'complete', 'top10'].includes(selectedMode), 'Invalid --mode value');
  assert(['complete', 'top10'].includes(beforeMode), 'Invalid --before-mode value');
  assert(!process.argv.includes('--before'), 'Use --before=<snapshot directory>');
  const within = (directory, path) => {
    const difference = relative(directory, path);
    return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
  };
  let beforeSnapshot;
  if (beforeArgument !== undefined) {
    assert(beforeArgument.trim(), 'The snapshot directory must not be empty');
    const directory = resolve(root, beforeArgument);
    assert(!within(directory, output), 'Compilation output must not overwrite the before snapshot');
    assert(!within(directory, reportPath), 'The report must not overwrite the before snapshot');
    const metadata = JSON.parse(await readFile(resolve(directory, 'snapshot.json'), 'utf8'));
    assert(metadata.sha256 && Object.keys(metadata.sha256).length, 'Before snapshot must provide module checksums');
    for (const file of ['search.mjs', 'simulation.mjs', 'pruning.mjs', 'support.mjs']) {
      assert(metadata.sha256[file], `Missing checksum for ${file}`);
      await access(resolve(directory, file));
    }
    for (const [file, expected] of Object.entries(metadata.sha256)) {
      assert(/^[^\\/]+\.mjs$/.test(file), 'Snapshot checksum paths must name local modules');
      assert.equal(sha256(await readFile(resolve(directory, file))), expected, `Snapshot changed: ${file}`);
    }
    beforeSnapshot = { directory, metadata };
  }
  const overrides = {};
  for (const [option, property, maximum] of [
    ['seconds', 'seconds', Math.floor(Number.MAX_SAFE_INTEGER / 1e9)],
    ['rounds', 'rounds', 10],
    ['threshold-step', 'thresholdStepPercent', 100],
  ])
    if (value(option) !== undefined) overrides[property] = integer(option, undefined, 1, maximum);
  const scenarios = [
    { name: 'zone', foodSlots: 3 },
    { name: 'zone-finer', explicitOnly: true, foodSlots: 3, thresholdStepPercent: 5 },
    { name: 'zone-mp30', explicitOnly: true, foodSlots: 3, intelligenceLevel: 30 },
    { name: 'zone-mp30-default', explicitOnly: true, foodSlots: 3, intelligenceLevel: 30, thresholdStepPercent: 10 },
    { name: 'zone-mp30-finer', explicitOnly: true, foodSlots: 3, intelligenceLevel: 30, thresholdStepPercent: 5 },
    {
      name: 'zone-snake-hp',
      explicitOnly: true,
      foodSlots: 3,
      intelligenceLevel: 30,
      staminaLevel: 30,
      zoneHrid: '/actions/combat/snake',
      noManaUse: true,
      equippedHpThreshold: 80,
      thresholdStepPercent: 10,
    },
    {
      name: 'catalog-mp30-two',
      explicitOnly: true,
      fullCatalog: true,
      foodSlots: 2,
      intelligenceLevel: 30,
      thresholdStepPercent: 10,
    },
    { name: 'catalog-mp30-three', explicitOnly: true, fullCatalog: true, foodSlots: 3, intelligenceLevel: 30 },
    {
      name: 'catalog-mp30-three-default',
      explicitOnly: true,
      fullCatalog: true,
      foodSlots: 3,
      intelligenceLevel: 30,
      thresholdStepPercent: 10,
    },
    { name: 'dungeon', target: 'dungeon', foodSlots: 2 },
    {
      name: 'hp-pressure',
      explicitOnly: true,
      target: 'dungeon',
      foodSlots: 3,
      noManaUse: true,
      seconds: 120,
      rounds: 2,
      thresholdStepPercent: 50,
    },
    { name: 'catalog-two', fullCatalog: true, foodSlots: 2, seconds: 60, rounds: 2, thresholdStepPercent: 50 },
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
    {
      name: 'catalog-three-default-grid',
      explicitOnly: true,
      fullCatalog: true,
      foodSlots: 3,
      seconds: 60,
      rounds: 2,
      thresholdStepPercent: 10,
    },
    {
      name: 'dungeon-long',
      explicitOnly: true,
      target: 'dungeon',
      foodSlots: 2,
      seconds: 7200,
      thresholdStepPercent: 50,
    },
    { name: 'catalog-two-longer', explicitOnly: true, fullCatalog: true, foodSlots: 2 },
    {
      name: 'no-mana-cached',
      explicitOnly: true,
      fullCatalog: true,
      foodSlots: 3,
      noManaUse: true,
      thresholdStepPercent: 1,
    },
  ];
  const selected = value('case', '').split(',').filter(Boolean);
  for (const name of selected)
    assert(
      scenarios.some((scenario) => scenario.name === name),
      `Unknown case: ${name}`,
    );
  const cases = scenarios
    .filter((scenario) => (selected.length ? selected.includes(scenario.name) : !scenario.explicitOnly))
    .map((scenario) => ({ seconds: 600, rounds: 3, thresholdStepPercent: 25, ...scenario, ...overrides }));

  await mkdir(output, { recursive: true });
  const { build } = await import('esbuild');
  const built = await build({
    absWorkingDir: root,
    entryPoints: {
      search: 'src/services/foodOptimizerSearch.js',
      simulation: 'src/services/foodOptimizerSimulation.js',
      worker: 'src/foodOptimizerWorker.js',
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
    metafile: true,
    logLevel: 'silent',
  });
  const moduleSha256 = {};
  for (const file of Object.keys(built.metafile.outputs))
    if (file.endsWith('.mjs'))
      moduleSha256[relative(output, resolve(root, file))] = sha256(await readFile(resolve(root, file)));
  const moduleUrl = (directory, name) => pathToFileURL(resolve(directory, `${name}.mjs`)).href;
  const { createFoodOptimizerFixture, physicalFoodOptimizerResult } = await import(moduleUrl(output, 'support'));
  const domain = await import(moduleUrl(output, 'domain'));
  const pruning = await import(moduleUrl(output, 'pruning'));
  const search = (await import(moduleUrl(output, 'search'))).createFoodOptimizerSearch;
  const modes = [
    { name: 'complete', searchMode: 'complete', search, workerUrl: moduleUrl(output, 'worker'), pruning },
    { name: 'top10', searchMode: 'top10', search, workerUrl: moduleUrl(output, 'worker'), pruning },
  ].filter((mode) => selectedMode === 'both' || mode.searchMode === selectedMode);
  if (beforeSnapshot)
    modes.push({
      name: `before-${beforeMode}`,
      searchMode: beforeMode,
      search: (await import(moduleUrl(beforeSnapshot.directory, 'search'))).createFoodOptimizerSearch,
      workerUrl: beforeSnapshot.metadata.sha256['worker.mjs']
        ? moduleUrl(beforeSnapshot.directory, 'worker')
        : undefined,
      simulationUrl: moduleUrl(beforeSnapshot.directory, 'simulation'),
      pruning: await import(moduleUrl(beforeSnapshot.directory, 'pruning')),
    });
  const referenceMode = { reference: true, supportUrl: moduleUrl(beforeSnapshot?.directory ?? output, 'support') };
  const physicalTop = (results) =>
    results.map((result) => ({ signature: result.signature, result: physicalFoodOptimizerResult(result) }));
  const summary = {
    status: 'running',
    createdAt: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    availableCores: availableParallelism(),
    workers,
    samples,
    seed,
    oracleLimit,
    arguments: process.argv.slice(2),
    beforeSnapshot,
    moduleSha256,
    benchmarkSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    note: 'Every timed run uses fresh real Node workers and includes startup, baseline, search, and awaited termination. Compilation and separate audits are excluded. Current modes and snapshots containing worker.mjs execute their production worker entry. Modes rotate for each repeated sample and use identical combat fixtures and seeds. --mode and --before-mode allow comparisons within one search mode. Top10 preserves exact rankings but does not determine feasibility of cost/rank-pruned candidates. Large domains receive exact compressed coverage checks and independent finalist verification, not per-candidate exhaustive simulation.',
    oracleNote:
      'The independent oracle runs full native-engine rounds with generic triggers and legacy buff lookup, and aggregates them independently of the production evaluator. With --before, its engine comes from the verified snapshot. Full-domain oracle is limited by --oracle-limit; the limit never disables compressed duplicate/missing coverage checks.',
    cases: [],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  const save = () => writeFile(reportPath, JSON.stringify(summary, null, 2) + '\n');
  const countsFor = (report, expected, context) => {
    const stats = report.stats;
    const pruned = stats.prunedCandidates ?? 0;
    assert.equal(report.status, 'completed', report.error);
    assert.equal(report.complete, true, `${context}: incomplete search`);
    assert.equal(stats.totalCandidates, expected, `${context}: changed candidate domain`);
    assert.equal(stats.completedCandidates, expected, `${context}: missing candidates`);
    assert.equal(
      stats.simulatedCandidates + stats.reusedCandidates + stats.skippedCandidates + pruned,
      expected,
      `${context}: coverage accounting`,
    );
    assert.equal(
      stats.feasibleCandidates + stats.rejectedMana + stats.rejectedDeaths + pruned,
      expected,
      `${context}: classification accounting`,
    );
    assert(stats.completedRounds <= stats.maxSimulationRounds, `${context}: invalid round accounting`);
  };
  async function run(mode, fixture, onCoverage) {
    const clients = [];
    const workerMetrics = freshWorkerMetrics();
    const input = structuredClone(fixture);
    input.request.searchMode = mode.searchMode;
    const start = performance.now();
    let report;
    try {
      report = await mode.search({
        ...input,
        workerLimit: workers,
        onCoverage,
        workerFactory() {
          const client = new BenchmarkClient(mode, workerMetrics);
          clients.push(client);
          return client;
        },
      }).done;
    } finally {
      for (const client of clients) client.stop();
      await Promise.all(clients.map((client) => client.termination));
    }
    return { report, elapsedMs: performance.now() - start, workerMetrics };
  }
  async function oracleFor(fixture, finalists, fullDomain) {
    const workerMetrics = freshWorkerMetrics();
    const client = new BenchmarkClient(referenceMode, workerMetrics);
    const results = new Map();
    const ranked = [];
    let baseline;
    try {
      await client.call({
        type: 'init',
        request: { ...fixture.request, searchMode: 'complete' },
        collectThresholds: false,
      });
      baseline = await client.call({ type: 'evaluate', candidate: null });
      const candidates = fullDomain
        ? domain.generateFoodOptimizerCandidates(fixture.items, fixture.foodSlots)
        : finalists.map((result) => domain.buildFoodCandidate(result.slots));
      for (const candidate of candidates) {
        assert(!results.has(candidate.signature), 'Duplicate oracle candidate');
        const result = await client.call({ type: 'evaluate', candidate, baselineDeaths: baseline.deaths });
        results.set(candidate.signature, result);
        if (result.feasible) ranked.push({ ...candidate, ...result });
      }
    } finally {
      client.stop();
      await client.termination;
    }
    ranked.sort(domain.compareFoodOptimizerResults);
    return { baseline, results, ranked, workerMetrics, fullDomain };
  }
  const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  await save();
  try {
    for (const scenario of cases) {
      const fixture = createFoodOptimizerFixture(scenario);
      fixture.request.seeds = Array.from({ length: fixture.request.rounds }, (_, index) => (seed + index) >>> 0);
      const totalCandidates = domain.countFoodOptimizerCandidates(fixture.items, fixture.foodSlots);
      const measurements = new Map(modes.map((mode) => [mode.name, []]));
      let expectedTop;
      let expectedTopCandidates;
      let expectedBaseline;
      let expectedFeasible;
      summary.activeCase = {
        scenario,
        fixtureSha256: sha256(JSON.stringify(fixture)),
        totalCandidates,
        measurements: [],
      };
      await save();
      for (let sample = 0; sample < samples; sample += 1) {
        const offset = sample % modes.length;
        for (const mode of [...modes.slice(offset), ...modes.slice(0, offset)]) {
          const { report, elapsedMs, workerMetrics } = await run(mode, fixture);
          const context = `${scenario.name}/${mode.name}`;
          countsFor(report, totalCandidates, context);
          const top = physicalTop(report.topResults);
          const baseline = physicalFoodOptimizerResult(report.baseline);
          if (expectedTop) assert.deepEqual(top, expectedTop, `${context}: top-ten physical results changed`);
          else {
            expectedTop = top;
            expectedTopCandidates = report.topResults;
          }
          if (expectedBaseline) assert.deepEqual(baseline, expectedBaseline, `${context}: baseline changed`);
          else expectedBaseline = baseline;
          if (mode.searchMode === 'complete') {
            assert.equal(report.stats.prunedCandidates ?? 0, 0, `${context}: complete mode pruned a candidate`);
            if (expectedFeasible !== undefined)
              assert.equal(report.stats.feasibleCandidates, expectedFeasible, `${context}: feasible count changed`);
            else expectedFeasible = report.stats.feasibleCandidates;
          }
          measurements.get(mode.name).push({ elapsedMs, stats: report.stats, workerMetrics });
          summary.activeCase.measurements.push({
            mode: mode.name,
            sample: sample + 1,
            elapsedMs,
            stats: report.stats,
            workerMetrics,
          });
          await save();
          console.log(
            `${context} ${sample + 1}/${samples}: ${elapsedMs.toFixed(1)} ms, ${report.stats.completedRounds} real rounds, ${report.stats.prunedCandidates ?? 0} ranking-pruned candidates`,
          );
        }
      }

      // The oracle and all coverage expansion/subtraction run outside timings.
      const oracle = await oracleFor(fixture, expectedTopCandidates, totalCandidates <= oracleLimit);
      assert.deepEqual(
        physicalFoodOptimizerResult(oracle.baseline),
        expectedBaseline,
        `${scenario.name}: independent baseline mismatch`,
      );
      assert.deepEqual(
        physicalTop(oracle.ranked.slice(0, 10)),
        expectedTop,
        `${scenario.name}: independent top-ten mismatch`,
      );
      if (oracle.fullDomain) {
        assert.equal(oracle.results.size, totalCandidates, `${scenario.name}: incomplete oracle`);
        if (expectedFeasible !== undefined)
          assert.equal(oracle.ranked.length, expectedFeasible, `${scenario.name}: independent feasible-count mismatch`);
      }
      const finalCutoff = expectedTopCandidates.length === 10 ? expectedTopCandidates[9] : null;
      const coverageAudits = {};
      for (const mode of modes) {
        const context = `${scenario.name}/${mode.name}`;
        const audit = createCoverageAudit(fixture, domain, context);
        let comparedCandidates = 0;
        const checkCandidate = (candidate, result) => {
          const expected = oracle.results.get(candidate.signature);
          assert(expected, `${context}: candidate missing from oracle`);
          if (result.pruned === 'cost' || result.pruned === 'rank') {
            assert.equal(mode.searchMode, 'top10', `${context}: unexpected ranking pruning`);
            assert(
              !expectedTop.some((entry) => entry.signature === candidate.signature),
              `${context}: finalist was pruned`,
            );
            if (expected.feasible)
              assert(
                finalCutoff && domain.compareFoodOptimizerResults({ ...candidate, ...expected }, finalCutoff) > 0,
                `${context}: competitive feasible candidate pruned`,
              );
          } else
            assert.deepEqual(
              physicalFoodOptimizerResult(result),
              physicalFoodOptimizerResult(expected),
              `${context}: candidate physical-result mismatch (${candidate.signature})`,
            );
          comparedCandidates += 1;
        };
        const { report } = await run(mode, fixture, (coverage) => {
          audit.accept(coverage);
          if (!oracle.fullDomain) return;
          if (coverage.candidate) checkCandidate(coverage.candidate, coverage.result);
          else
            for (const candidate of domain.generateFoodOptimizerCompositionCandidates(coverage.items)) {
              if (candidate.signature === coverage.excludedSignature) continue;
              checkCandidate(candidate, mode.pruning.materializeFoodOptimizerOutcome(coverage.evidence, candidate));
            }
        });
        countsFor(report, totalCandidates, context);
        assert.deepEqual(physicalTop(report.topResults), expectedTop, `${context}: audited top-ten mismatch`);
        assert.deepEqual(
          physicalFoodOptimizerResult(report.baseline),
          expectedBaseline,
          `${context}: audited baseline mismatch`,
        );
        if (oracle.fullDomain)
          assert.equal(comparedCandidates, totalCandidates, `${context}: incomplete per-candidate audit`);
        coverageAudits[mode.name] = { ...audit.finish(report), independentlyComparedCandidates: comparedCandidates };
        console.log(
          `${context}: exact coverage verified (${totalCandidates} candidates, ${coverageAudits[mode.name].records} compressed records)`,
        );
      }
      const result = {
        scenario,
        seeds: fixture.request.seeds,
        fixtureSha256: sha256(JSON.stringify(fixture)),
        totalCandidates,
        completeModeFeasibleCandidates: expectedFeasible,
        baseline: expectedBaseline,
        topResults: expectedTop,
        oracle: {
          type: oracle.fullDomain
            ? 'independent-full-domain-native-engine'
            : 'independent-finalists-only-native-engine',
          comparedCandidates: oracle.results.size,
          workerMetrics: oracle.workerMetrics,
        },
        coverageAudits,
        modes: Object.fromEntries(
          [...measurements].map(([name, runs]) => [name, { medianMs: median(runs.map((run) => run.elapsedMs)), runs }]),
        ),
      };
      if (result.modes.complete && result.modes.top10)
        result.topTenSpeedup = result.modes.complete.medianMs / result.modes.top10.medianMs;
      if (result.modes['before-complete']) {
        if (result.modes.complete)
          result.completeModeSpeedup = result.modes['before-complete'].medianMs / result.modes.complete.medianMs;
        if (result.modes.top10)
          result.topTenSpeedupVersusBefore = result.modes['before-complete'].medianMs / result.modes.top10.medianMs;
      }
      if (result.modes[`before-${beforeMode}`] && result.modes[beforeMode])
        result.sameModeSpeedup = result.modes[`before-${beforeMode}`].medianMs / result.modes[beforeMode].medianMs;
      summary.cases.push(result);
      delete summary.activeCase;
      await save();
      if (result.topTenSpeedup !== undefined)
        console.log(`${scenario.name}: top10 ${result.topTenSpeedup.toFixed(2)}x versus current complete mode`);
      if (result.sameModeSpeedup !== undefined)
        console.log(`${scenario.name}: ${beforeMode} ${result.sameModeSpeedup.toFixed(2)}x versus before snapshot`);
    }
    summary.status = 'completed';
  } catch (error) {
    summary.status = 'error';
    summary.error = error?.stack || String(error);
    throw error;
  } finally {
    await save();
  }
  console.log(`Report: ${reportPath}`);
}

if (isMainThread) await main();
