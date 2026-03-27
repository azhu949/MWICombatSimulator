# Project Optimization Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce bundle size, make batch worker concurrency obey settings, and trim the most expensive UI recomputation paths without changing simulation results.

**Architecture:** Separate heavy game data concerns between UI and simulation runtime, then thread the saved worker limit through the batch execution path, and finally cache or precompute the largest UI-derived datasets. Keep behavior stable by adding targeted tests around bundle-sensitive helpers, worker payload flow, and expensive computed state.

**Tech Stack:** Vue 3, Pinia, Vite, Web Workers, Vitest

---

### Task 1: Add A Single Tracking Plan Instead Of Four Source TODOs

**Files:**
- Modify: `docs/superpowers/plans/2026-03-27-project-optimization-roadmap.md`
- Optional later: GitHub issue or project board item outside the repo

- [ ] **Step 1: Use this document as the canonical checklist**

Keep one source of truth for the optimization work. Do not add scattered `TODO` comments into runtime files before implementation unless a code location needs a short local reminder tied to an unfinished refactor.

```md
- Preferred: one roadmap doc / one issue with 4 checklist items
- Avoid: 4 separate inline TODO comments across store/page/worker files
```

- [ ] **Step 2: Split execution into three batches**

Batch the work by risk and dependency:

```md
1. Bundle and data-boundary cleanup
2. Worker concurrency wiring
3. UI recomputation cleanup
```

- [ ] **Step 3: Only add inline TODO when stopping mid-refactor**

If implementation pauses in the middle of a structural change, add a short local note like:

```js
// TODO(opt): remove direct itemDetailMap dependency after gameDataIndex migration
```

- [ ] **Step 4: Commit the tracking artifact first if desired**

Run:

```bash
git add docs/superpowers/plans/2026-03-27-project-optimization-roadmap.md
git commit -m "docs: add optimization roadmap"
```

Expected: a small docs-only commit, no behavior change.

### Task 2: Shrink Main-Thread Bundle By Extracting UI-Friendly Game Data Indexes

**Files:**
- Create: `src/ui/data/gameDataIndex.js`
- Create: `src/ui/data/__tests__/gameDataIndex.test.js`
- Modify: `src/stores/simulatorStore.js`
- Modify: `src/ui/pages/HomePage.vue`
- Modify: `src/ui/pages/QueuePage.vue`
- Modify: `src/ui/pages/SettingsPage.vue`
- Modify: `src/ui/pages/MultiResultsPage.vue`
- Modify: `src/ui/components/SimulationResultsView.vue`
- Modify: `vite.config.mjs`

- [ ] **Step 1: Write a failing test for the new index helpers**

Add a small unit test that verifies the derived UI index exposes stable labels without making every component rebuild arrays from raw maps.

```js
import { describe, expect, it } from "vitest";
import { getItemName, getSortedHouseRoomOptions } from "../gameDataIndex.js";

describe("gameDataIndex", () => {
    it("returns stable item names and sorted house room options", () => {
        expect(typeof getItemName("/items/basic_food")).toBe("string");
        const rooms = getSortedHouseRoomOptions();
        expect(Array.isArray(rooms)).toBe(true);
        expect(rooms.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/ui/data/__tests__/gameDataIndex.test.js
```

Expected: FAIL because `src/ui/data/gameDataIndex.js` does not exist yet.

- [ ] **Step 3: Implement a UI-focused derived index**

Build one shared module that imports the raw JSON once and exports pre-sorted arrays and lookup helpers for the UI.

```js
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import houseRoomDetailMap from "../../combatsimulator/data/houseRoomDetailMap.json";

const itemNameByHrid = Object.fromEntries(
    Object.values(itemDetailMap).map((item) => [String(item.hrid || ""), String(item.name || item.hrid || "")])
);

const sortedHouseRoomOptions = Object.values(houseRoomDetailMap)
    .slice()
    .sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0))
    .map((room) => ({ hrid: room.hrid, name: room.name }));

export function getItemName(hrid) {
    return itemNameByHrid[String(hrid || "")] || String(hrid || "");
}

export function getSortedHouseRoomOptions() {
    return sortedHouseRoomOptions;
}
```

- [ ] **Step 4: Replace repeated `Object.values(...).sort(...).map(...)` UI code with shared helpers**

Use the index in hot UI files such as:

```js
// HomePage.vue
import { getSortedHouseRoomOptions } from "../data/gameDataIndex.js";

const houseRoomOptions = computed(() => getSortedHouseRoomOptions());
```

```js
// SettingsPage.vue
import { getItemName } from "../data/gameDataIndex.js";

name: getItemName(hrid),
```

- [ ] **Step 5: Keep raw combat data in simulator-only paths**

Do not move simulation-critical JSON out of the combat runtime yet. The goal in this batch is to stop UI pages from each recomputing their own derived views from raw maps.

```js
// okay in simulator runtime
import combatMonsterDetailMap from "../combatsimulator/data/combatMonsterDetailMap.json";

// avoid repeating this in several UI pages when a derived index is enough
Object.values(combatMonsterDetailMap).sort(...)
```

- [ ] **Step 6: Add manual chunks for clearly separate heavy modules**

Update Vite build splitting so `exceljs`, worker code, and large simulation code paths are isolated.

```js
build: {
    rollupOptions: {
        input: resolve(process.cwd(), "index.html"),
        output: {
            manualChunks: {
                excel: ["exceljs"],
            },
        },
    },
},
```

- [ ] **Step 7: Run focused tests and a production build**

Run:

```bash
npm test -- src/ui/data/__tests__/gameDataIndex.test.js src/ui/__tests__/patchNotes.test.js
npm run build
```

Expected:
- Tests PASS
- Build PASS
- `dist/assets/index-*.js` is smaller than the current baseline of about `2.43 MB`

- [ ] **Step 8: Commit**

```bash
git add src/ui/data/gameDataIndex.js src/ui/data/__tests__/gameDataIndex.test.js src/stores/simulatorStore.js src/ui/pages/HomePage.vue src/ui/pages/QueuePage.vue src/ui/pages/SettingsPage.vue src/ui/pages/MultiResultsPage.vue src/ui/components/SimulationResultsView.vue vite.config.mjs
git commit -m "perf: reduce duplicated UI game data work"
```

### Task 3: Make Home Batch Runs Respect Saved Parallel Worker Limit

**Files:**
- Modify: `src/services/workerClient.js`
- Modify: `src/multiWorker.js`
- Modify: `src/stores/simulatorStore.js`
- Modify: `src/services/__tests__/workerClient.test.js`
- Modify: `src/stores/__tests__/simulatorStore.test.js`

- [ ] **Step 1: Write a failing worker payload test**

Add a test proving multi-simulation payload includes `parallelWorkerLimit`.

```js
it("passes parallelWorkerLimit to the multi worker payload", () => {
    const postMessage = vi.fn();
    globalThis.Worker = vi.fn(() => ({ postMessage, terminate() {}, onmessage: null, onerror: null }));

    const client = new WorkerClient();
    client.startMultiSimulation({ type: "start_simulation_all_zones", zones: [], parallelWorkerLimit: 3 });

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
        parallelWorkerLimit: 3,
    }));
});
```

- [ ] **Step 2: Run the targeted tests and verify failure**

Run:

```bash
npm test -- src/services/__tests__/workerClient.test.js src/stores/__tests__/simulatorStore.test.js
```

Expected: FAIL on the new assertion before implementation.

- [ ] **Step 3: Thread the limit from store to multi-simulation payload**

Update the Home batch call sites so they send the saved runtime limit.

```js
const parallelWorkerLimit = normalizeParallelWorkerLimit(
    this.queueRuntime?.parallelWorkerLimit,
    this.queueParallelWorkerHardMax
);

workerClient.startMultiSimulation({
    type: "start_simulation_all_zones",
    players: playersToSim,
    zones,
    simulationTimeLimit,
    extra,
    parallelWorkerLimit,
}, handlers);
```

- [ ] **Step 4: Make `multiWorker.js` honor the provided limit**

Clamp the requested limit against hardware and target count.

```js
function getEffectiveWorkerLimit(eventData, targetCount) {
    const hardwareLimit = getHardwareWorkerLimit();
    const requestedLimit = Math.floor(Number(eventData?.parallelWorkerLimit || hardwareLimit));
    const safeRequestedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : hardwareLimit;
    return Math.min(hardwareLimit, safeRequestedLimit, targetCount);
}
```

```js
const maxWorkers = getEffectiveWorkerLimit(eventData, config.targets.length);
```

- [ ] **Step 5: Add a store-level regression test**

Cover both batch entry points.

```js
expect(startMultiSimulationMock).toHaveBeenCalledWith(
    expect.objectContaining({ parallelWorkerLimit: 2 }),
    expect.any(Object)
);
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/services/__tests__/workerClient.test.js src/stores/__tests__/simulatorStore.test.js src/stores/__tests__/advisorStore.test.js
```

Expected: PASS, with existing queue/advisor concurrency tests still green.

- [ ] **Step 7: Commit**

```bash
git add src/services/workerClient.js src/multiWorker.js src/stores/simulatorStore.js src/services/__tests__/workerClient.test.js src/stores/__tests__/simulatorStore.test.js
git commit -m "fix: honor saved worker limit in batch simulations"
```

### Task 4: Reduce Expensive Home And Settings Recomputations

**Files:**
- Modify: `src/ui/pages/HomePage.vue`
- Modify: `src/ui/pages/SettingsPage.vue`
- Add or modify tests if practical: `src/stores/__tests__/simulatorStore.test.js`

- [ ] **Step 1: Add a focused regression test around cached combat preview logic if extracted**

If preview calculation moves into a helper, test stable output for unchanged input.

```js
it("reuses preview data when unrelated home state changes", () => {
    const first = buildCombatPreview(playerSnapshot);
    const second = buildCombatPreview(playerSnapshot);
    expect(second).toEqual(first);
});
```

- [ ] **Step 2: Move Home combat preview behind explicit dependencies**

Replace unconditional deep clone plus player rebuild on every reactive change:

```js
const combatPreviewInput = computed(() => ({
    playerId: activePlayer.value?.id,
    levels: activePlayer.value?.levels,
    equipment: activePlayer.value?.equipment,
    food: activePlayer.value?.food,
    drinks: activePlayer.value?.drinks,
    abilities: activePlayer.value?.abilities,
    houseRooms: activePlayer.value?.houseRooms,
    achievements: activePlayer.value?.achievements,
}));
```

```js
watch(combatPreviewInput, () => {
    combatPreview.value = buildCombatPreviewFromPlayer(activePlayer.value);
}, { immediate: true, deep: true });
```

Use a debounced watcher if typing still feels heavy.

- [ ] **Step 3: Precompute the static item catalog once in Settings**

Split the static catalog from dynamic price state.

```js
const staticPriceCatalog = Object.values(itemDetailMap).map((item) => ({
    hrid: String(item?.hrid || ""),
    categoryHrid: String(item?.categoryHrid || "/item_categories/unknown"),
    baseName: formatPriceItemName(item?.hrid, String(item?.name || "")),
}));
```

```js
const allPriceRows = computed(() => staticPriceCatalog.map((item) => {
    const entry = simulator.pricing.priceTable?.[item.hrid] || {};
    const overrideEntry = simulator.pricing.overrides?.[item.hrid] || {};
    return {
        ...item,
        vendor: toFiniteNumber(entry.vendor, 0),
        ask: toFiniteNumber(entry.ask, -1),
        bid: toFiniteNumber(entry.bid, -1),
        askOverridden: hasOwn(overrideEntry, "ask"),
        bidOverridden: hasOwn(overrideEntry, "bid"),
    };
}));
```

- [ ] **Step 4: Verify UI behavior manually**

Run:

```bash
npm run dev
```

Manual checks:
- Home page level/equipment edits stay responsive
- Settings price modal search/filter still works
- No visible change in labels or sorting

- [ ] **Step 5: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with no simulation regressions.

- [ ] **Step 6: Commit**

```bash
git add src/ui/pages/HomePage.vue src/ui/pages/SettingsPage.vue
git commit -m "perf: reduce hot UI recomputation paths"
```

### Task 5: Final Verification And Cleanup

**Files:**
- Modify if needed: `README.md`
- Review: `dist/` output only, do not commit build artifacts unless the repo requires them

- [ ] **Step 1: Capture before/after numbers**

Record:

```md
- `dist/assets/index-*.js`
- `dist/assets/worker-*.js`
- full `npm test` duration
```

- [ ] **Step 2: Update docs only if behavior changed**

If worker limit behavior becomes user-visible in Home batch mode, add one short note in README or settings help text.

```md
- Parallel Worker Limit now also applies to Home batch zone/labyrinth runs
```

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run build
npm test
```

Expected: both commands PASS.

- [ ] **Step 4: Commit the final cleanup**

```bash
git add README.md
git commit -m "docs: note optimization behavior updates"
```

---

## Self-Review

- Spec coverage: The plan covers all four identified problem areas: bundle size, worker concurrency mismatch, Home preview recomputation, and Settings price table recomputation.
- Placeholder scan: No `TBD` or “implement later” placeholders were left in tasks.
- Type consistency: The new shared names (`parallelWorkerLimit`, `gameDataIndex`, `getEffectiveWorkerLimit`) are used consistently across tasks.

Plan complete and saved to `docs/superpowers/plans/2026-03-27-project-optimization-roadmap.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
