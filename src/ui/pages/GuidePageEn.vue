<template>
  <div class="space-y-4">
    <section class="surface-panel overflow-hidden">
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
        <div class="min-w-0">
          <p class="mb-2 text-xs font-semibold text-primary">MWI Combat Simulator</p>
          <h2 class="font-heading text-2xl font-semibold text-foreground sm:text-3xl">User Guide</h2>
          <p class="mt-3 max-w-3xl text-sm leading-7 text-foreground/85">
            Import character data, run your first combat simulation, then move on to queue comparisons, Advisor,
            Enhancement, and Skilling.
          </p>
        </div>
        <div class="border-l-2 border-primary/40 pl-4 text-sm leading-6 text-foreground/85">
          <p class="font-semibold text-primary">Recommended order</p>
          <p class="mt-1">
            Getting started, Combat simulation, then Queue and results. Open the specialist tools when you need them.
          </p>
        </div>
      </div>

      <div class="mt-5 border-l-2 border-success/40 bg-success/10 px-4 py-3 text-sm leading-6 text-foreground/85">
        Screenshots use the Chinese interface. Control positions and workflows are the same in English.
      </div>

      <Accordion type="single" collapsible class="mt-5 border-t border-border lg:hidden">
        <AccordionItem value="contents">
          <AccordionTrigger>Guide contents</AccordionTrigger>
          <AccordionContent>
            <nav class="grid grid-cols-2 gap-x-4 sm:grid-cols-4" aria-label="Guide contents">
              <RouterLink
                v-for="item in guideSections"
                :key="item.id"
                :to="{ path: '/guide', hash: `#${item.id}` }"
                class="border-b border-border py-2 text-sm text-foreground/85 hover:text-primary"
              >
                {{ item.label }}
              </RouterLink>
            </nav>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>

    <div class="surface-panel !p-0 lg:grid lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside class="hidden border-r border-border lg:block">
        <nav class="sticky top-36 max-h-[calc(100vh-10rem)] overflow-y-auto px-4 py-5" aria-label="Guide contents">
          <p class="px-2 pb-3 text-xs font-semibold text-muted-foreground">Guide contents</p>
          <RouterLink
            v-for="item in guideSections"
            :key="item.id"
            :to="{ path: '/guide', hash: `#${item.id}` }"
            class="block border-l-2 border-border px-3 py-2 text-sm text-foreground/85 hover:border-primary/40 hover:text-primary"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </aside>

      <article class="min-w-0 px-4 sm:px-6 lg:px-8">
        <section id="quick-start" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">BEFORE YOU BEGIN</p>
            <h3 class="guide-title">Getting Started and Importing Data</h3>
            <p class="guide-lead">
              Import the current character or team from the game first. This keeps equipment, abilities, consumables,
              and buffs aligned with the live character.
            </p>
          </div>

          <ol class="guide-steps">
            <li>
              <strong>Install the main-site import userscript.</strong>
              On Home, click Import/Export, then Install Script. A Combat Simulator entry will appear in the game site's
              sidebar.
            </li>
            <li>
              <strong>Import the current solo character directly.</strong>
              Keep the game site signed in, return to the simulator, and click Import from Main Site. The userscript
              reads the current character into the active player slot.
            </li>
            <li>
              <strong>Open teammate profiles only for a team import.</strong>
              Team data requires each teammate's profile to be opened on the game site first. The userscript uses
              profiles already opened and cached; missing members are skipped.
            </li>
            <li>
              <strong>Confirm the import target.</strong>
              Combat data goes to the Home player slot, Enhancement data to Enhancement, and Skilling data to Skilling.
              You can also paste JSON or load a local file.
            </li>
          </ol>

          <div class="mt-5 border-l-2 border-success/40 bg-success/10 px-4 py-3 text-sm leading-6 text-foreground/85">
            Imported Enhancement and Skilling character data lasts only for the current page session. Import it again
            after refreshing the page.
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/import-data.png"
            alt="Chinese Import and Export dialog with userscript installation, team import, and solo import controls"
            caption="Import and Export supports the main-site userscript, pasted JSON, and local files"
            open-label="View full image"
            :width="2850"
            :height="1980"
          />

          <RouterLink class="guide-route-link" to="/home">Open Home</RouterLink>
        </section>

        <section id="combat" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">CORE WORKFLOW</p>
            <h3 class="guide-title">Run a Combat Simulation</h3>
            <p class="guide-lead">
              Home is split into Basic Settings, Equipment and Abilities, and Combat Stats. Complete Basic Settings
              first; imported data usually fills in the rest.
            </p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>Choose a target</h4>
              <p>
                Select a zone or dungeon, single target or batch range, character profile, difficulty, and simulation
                duration. Batch ranges help compare several zones.
              </p>
            </div>
            <div>
              <h4>Check combat conditions</h4>
              <p>
                Confirm EXP and drop levels plus card, community EXP, and community drop toggles. Dungeons also require
                floor, room level, and supply crate settings.
              </p>
            </div>
            <div>
              <h4>Adjust the build</h4>
              <p>
                Use Equipment and Abilities to change gear, enhancement levels, food, drinks, abilities, and triggers.
                Rooms, achievements, and guild shrines add their bonuses.
              </p>
            </div>
            <div>
              <h4>Run and inspect results</h4>
              <p>
                Click Start Simulation. The summary shows XP/H, Deaths/H, Profit/H, and other key metrics. View Full
                Results expands drops, experience, and combat details.
              </p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/home-workspace.png"
            alt="Chinese Home combat workspace with players, target settings, simulation controls, and key results"
            caption="Home basic settings and simulation workspace"
            open-label="View full image"
            :width="2850"
            :height="1980"
          />

          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <div class="guide-note">
              <strong>Save player configuration</strong>
              <span
                >Saves a snapshot that can be restored on Home. It is useful for frequent builds and is separate from
                the multi-round comparison baseline.</span
              >
            </div>
            <div class="guide-note">
              <strong>Experimental features</strong>
              <span
                >These cover advanced workflows such as batch file processing. You can skip them during your first
                simulation.</span
              >
            </div>
          </div>

          <RouterLink class="guide-route-link" to="/home">Open Combat Simulation</RouterLink>
        </section>

        <section id="queue" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">COMPARE BUILDS</p>
            <h3 class="guide-title">Queue and Multi-Round Results</h3>
            <p class="guide-lead">
              The queue compares equipment or ability variants against one target. It captures a baseline, then runs
              each variant for multiple rounds and aggregates the results.
            </p>
          </div>

          <ol class="guide-steps">
            <li>
              <strong>Set the baseline.</strong> On Home or at the top of Queue, click Set Baseline to capture the
              current character, target, and build.
            </li>
            <li>
              <strong>Add variants.</strong> Change equipment, enhancement levels, abilities, consumables, or other
              settings, then click Add to Queue. Names are based on detected differences.
            </li>
            <li>
              <strong>Run the queue.</strong> Check the queued variants and click Run Queue. Queue shows the baseline
              summary, list, progress, and last run status.
            </li>
            <li>
              <strong>Read the results.</strong> Compare overall score, profit and experience changes, stability, strict
              or total cost, and confidence. Export to Excel when you need a record.
            </li>
          </ol>

          <div class="mt-5 border-l-2 border-warning/60 px-4 py-2 text-sm leading-6 text-foreground/85">
            Queue target purchases use the official exact Ask, then a valid official hourly average, then the latest
            valid archived Ask. Fallback prices show their source and data time for confirmation; new official listings
            still win, and historical prices never affect baseline sale credit.
          </div>

          <div class="mt-6 grid gap-5 xl:grid-cols-2">
            <GuideFigure
              src="/tutorial/queue.png"
              alt="Chinese Queue runner showing baseline, add, run, and clear actions"
              caption="The Queue runner prompts you to establish a baseline first"
              open-label="View full image"
              :width="2560"
              :height="1440"
            />
            <GuideFigure
              src="/tutorial/multi-results.png"
              alt="Chinese Multi-Round Results page with scoring model notes and baseline summary"
              caption="Multi-Round Results displays ranking and aggregated metrics after a queue run"
              open-label="View full image"
              :width="2530"
              :height="1424"
            />
          </div>

          <div class="mt-5 border-l-2 border-primary/40 px-4 py-2 text-sm leading-6 text-foreground/85">
            Change one major factor at a time when comparing gear. Queue labels and cost differences will be easier to
            interpret.
          </div>

          <div class="flex flex-wrap gap-2">
            <RouterLink class="guide-route-link" to="/queue">Open Queue</RouterLink>
            <RouterLink class="guide-route-link" to="/multi-results">Open Multi-Round Results</RouterLink>
          </div>
        </section>

        <section id="advisor" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">FIND A TARGET</p>
            <h3 class="guide-title">Use Advisor</h3>
            <p class="guide-lead">
              Advisor scans combat targets with the current team, buffs, achievements, house, and market prices, then
              ranks them using your preferences.
            </p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>Choose a scoring preference</h4>
              <p>
                Balanced weighs profit and experience together. Profit and Experience increase the matching metric.
                Stability favors lower variance, and Custom accepts manual weights.
              </p>
            </div>
            <div>
              <h4>Select the scan scope</h4>
              <p>
                Scan solo zones, planet zones, or dungeons. More finalists and verification rounds generally improve
                stability but take longer.
              </p>
            </div>
            <div>
              <h4>Review recommendations</h4>
              <p>
                Cards and tables show overall score, profit, experience, safety, and confidence. Expand the scoring
                explanation to inspect the current formula.
              </p>
            </div>
            <div>
              <h4>Verify on Home</h4>
              <p>
                Click Apply to Home in the results table, then run a full Home simulation to inspect target details and
                the drop breakdown.
              </p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/advisor.png"
            alt="Chinese Advisor settings with scoring preference, scan scope, verification rounds, and start button"
            caption="Choose the scoring goal and scan scope before starting Advisor"
            open-label="View full image"
            :width="2880"
            :height="2000"
          />

          <RouterLink class="guide-route-link" to="/advisor">Open Advisor</RouterLink>
        </section>

        <section id="enhancement" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">ENHANCEMENT DECISIONS</p>
            <h3 class="guide-title">Estimate Enhancement Cost and Risk</h3>
            <p class="guide-lead">
              Enhancement compares protection thresholds, material prices, and risk budgets. It is separate from combat
              simulation, so import Enhancement data or complete the setup manually.
            </p>
          </div>

          <ol class="guide-steps">
            <li>
              <strong>Choose the item and levels.</strong> Set starting level, target level, Enhancement skill level,
              and the teas used by the real setup.
            </li>
            <li>
              <strong>Complete advanced settings.</strong> Abilities and House contain success bonuses. Cost and Risk
              controls protection items, material prices, and decomposition recovery value.
            </li>
            <li>
              <strong>Compare protection strategies.</strong> The strategy table lists expected resets, actions, time,
              materials, and cost, and can be sorted by investment.
            </li>
            <li>
              <strong>Calculate risk.</strong> Enter a budget and run the analysis to inspect cost percentiles and the
              probability of success within budget. Mirror and decomposition tabs value special options.
            </li>
          </ol>

          <GuideFigure
            class="mt-6"
            src="/tutorial/enhancement.png"
            alt="Chinese Enhancement workspace with item settings and strategy, mirror, decomposition, and risk tabs"
            caption="Enhancement settings, protection strategies, and risk analysis share one workspace"
            open-label="View full image"
            :width="2880"
            :height="2000"
          />

          <RouterLink class="guide-route-link" to="/enhancement">Open Enhancement</RouterLink>
        </section>

        <section id="skilling" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">UPGRADE ROUTES</p>
            <h3 class="guide-title">Plan Skilling Upgrades</h3>
            <p class="guide-lead">
              Skilling combines current experience, inventory, equipment, buffs, and market prices to calculate
              level-by-level routes for six production skills.
            </p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>Import a Skilling snapshot</h4>
              <p>
                The page needs current levels, experience, inventory, and equipped items. If no current character
                snapshot is shown, return to the game site and import again.
              </p>
            </div>
            <div>
              <h4>Choose an optimization mode</h4>
              <p>
                Lowest net cost/XP limits spending. Balanced allows faster routes within a cost tolerance. Speed-first
                chooses the fastest effective route.
              </p>
            </div>
            <div>
              <h4>Set scope and target levels</h4>
              <p>
                Calculate one skill or all six. Targets cover Foraging, Brewing, Cheesemaking, Cooking, Manufacturing,
                and Tailoring.
              </p>
            </div>
            <div>
              <h4>Inspect route details</h4>
              <p>
                Overview compares skills, while skill tabs show level ranges. Details include drinks, equipment, stage
                actions, material purchases, and output recovery.
              </p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/skilling.png"
            alt="Chinese Skilling planner with optimization mode, scope, price actions, and missing-data prompt"
            caption="Import a Skilling snapshot before all target-level controls and calculations become available"
            open-label="View full image"
            :width="2560"
            :height="1440"
          />

          <RouterLink class="guide-route-link" to="/skilling">Open Skilling</RouterLink>
        </section>

        <section id="settings" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">GLOBAL RULES</p>
            <h3 class="guide-title">Prices, Scoring, and Runtime Settings</h3>
            <p class="guide-lead">
              Settings determines queue scoring, worker and round counts, and which market prices are used for profit
              calculations.
            </p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>Scoring model</h4>
              <p>
                Performance, Stability, and Cost weights total 100%. Performance can then divide its weight across
                profit, experience, DPS, and kills.
              </p>
            </div>
            <div>
              <h4>Execution and workers</h4>
              <p>
                Parallel mode is faster; serial mode limits resource usage. The worker cap also affects batch zone and
                dungeon simulations on Home.
              </p>
            </div>
            <div>
              <h4>Sampling and statistics</h4>
              <p>
                Queue rounds control variant sampling and baseline rounds control baseline sampling. A higher median
                blend reduces the influence of extreme rounds.
              </p>
            </div>
            <div>
              <h4>Prices and equipment sets</h4>
              <p>
                Refresh market prices, choose valuation rules for consumables and drops, or override specific items.
                Equipment sets save and restore frequent builds.
              </p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/settings.png"
            alt="Chinese Settings page with scoring, execution, workers, sampling, and statistics controls"
            caption="Queue scoring, workers, and sampling settings affect both runtime and interpretation"
            open-label="View full image"
            :width="2880"
            :height="2000"
          />

          <RouterLink class="guide-route-link" to="/settings">Open Settings</RouterLink>
        </section>

        <section id="troubleshooting" class="scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">TROUBLESHOOTING</p>
            <h3 class="guide-title">Empty States and Disabled Controls</h3>
            <p class="guide-lead">
              Most empty states mean the required character snapshot is missing, a baseline has not been set, or the
              queue has not finished running.
            </p>
          </div>

          <div class="mt-5 border-y border-border">
            <details class="guide-faq" open>
              <summary>Why is Set Baseline or a specialist calculation disabled?</summary>
              <p>
                Confirm that the active player has the required data and is selected for simulation. Enhancement and
                Skilling need their own import targets; Home combat data cannot replace them.
              </p>
            </details>
            <details class="guide-faq">
              <summary>Why is there no ranking in Multi-Round Results?</summary>
              <p>
                Set a baseline, add at least one variant, and finish a queue run. Multi-Round Results does not
                automatically use the latest single Home simulation.
              </p>
            </details>
            <details class="guide-faq">
              <summary>Why did Enhancement or Skilling data disappear after refresh?</summary>
              <p>
                Those imports are intentionally kept only for the current page session. Import them again from the main
                site after a refresh. Saved global settings are unaffected.
              </p>
            </details>
            <details class="guide-faq">
              <summary>What if a screenshot differs from the current interface?</summary>
              <p>
                Follow the labels and enabled controls in the current page. Updates may change the layout, while the
                Import, Configure, Run, and Review workflow remains the same.
              </p>
            </details>
          </div>

          <div class="mt-6 flex flex-wrap gap-2">
            <RouterLink class="button-primary" to="/home">Start a Simulation</RouterLink>
            <RouterLink class="button-secondary" to="/settings">Check Runtime Settings</RouterLink>
          </div>
        </section>
      </article>
    </div>
  </div>
</template>

<script setup>
import GuideFigure from '../components/guide/GuideFigure.vue';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion/index.js';
import '../guide.css';

const guideSections = [
  { id: 'quick-start', label: 'Getting started' },
  { id: 'combat', label: 'Combat' },
  { id: 'queue', label: 'Queue and results' },
  { id: 'advisor', label: 'Advisor' },
  { id: 'enhancement', label: 'Enhancement' },
  { id: 'skilling', label: 'Skilling' },
  { id: 'settings', label: 'Settings' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];
</script>
