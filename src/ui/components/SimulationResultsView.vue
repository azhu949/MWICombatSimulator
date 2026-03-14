<template>
  <section class="space-y-4">
    <template v-if="hasBatchResult">
      <div class="panel">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.results.batchResultsTitle", "Batch Results") }}</h2>
          <button type="button"
            class="action-button-muted"
           
            :disabled="simulator.results.batchRows.length === 0"
            @click="exportBatchRowsCsv"
          >
            {{ t("common:exportToCSV", "Export To CSV") }}
          </button>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.results.targets", "Targets") }}</p>
            <p class="mt-1 font-heading text-lg text-slate-100">{{ simulator.results.simResults.length }}</p>
          </div>
          <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.results.rows", "Rows") }}</p>
            <p class="mt-1 font-heading text-lg text-slate-100">{{ simulator.results.batchRows.length }}</p>
          </div>
          <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.results.bestProfitPerHour", "Best Profit/h") }}</p>
            <p class="mt-1 font-heading text-lg text-emerald-300">{{ formatCurrency(bestBatchRow?.profitPerHour ?? 0) }}</p>
          </div>
        </div>
        <p class="mt-3 text-xs text-slate-400">{{ t("common:vue.results.protocol", "Protocol") }}: {{ batchProtocolLabel }}</p>
      </div>

      <div class="panel overflow-x-auto">
        <h3 class="mb-3 font-heading text-sm uppercase tracking-[0.14em] text-slate-300">{{ t("common:vue.results.batchTable", "Batch Table") }}</h3>
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
              <th v-for="column in batchTableColumns" :key="column.key" class="px-2 py-2">
                <button type="button"
                  v-if="column.sortable"
                  class="inline-flex items-center gap-1 text-left transition hover:text-slate-200"
                 
                  @click="toggleBatchSort(column.key)"
                >
                  <span>{{ t(column.labelKey, column.fallback) }}</span>
                  <span class="text-[10px]" :class="batchSort.key === column.key ? 'text-amber-300' : 'text-slate-500'">{{ getBatchSortIndicator(column.key) }}</span>
                </button>
                <span v-else>{{ t(column.labelKey, column.fallback) }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in batchRowsForDisplay" :key="row.rowId" class="border-b border-white/5 text-slate-200">
              <td
                v-for="column in batchTableColumns"
                :key="`${row.rowId}-${column.key}`"
                class="px-2 py-2"
                :class="getBatchCellClass(row, column)"
              >
                {{ formatBatchCell(row, column) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="panel overflow-x-auto">
        <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.results.summaryTitle", "Summary") }}</h2>
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
              <th class="px-2 py-2">{{ t("common:player", "Player") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.results.encountersPerHour", "Encounters/h") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.results.deathsPerHour", "Deaths/h") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.results.xpPerHour", "XP/h") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.results.profitPerHour", "Profit/h") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in simulator.results.summaryRows"
              :key="row.playerHrid"
              class="border-b border-white/5 text-slate-200 transition hover:bg-white/5"
              :class="row.playerHrid === simulator.results.activeResultPlayerHrid ? 'bg-white/10' : ''"
              :aria-selected="row.playerHrid === simulator.results.activeResultPlayerHrid ? 'true' : 'false'"
            >
              <td class="px-2 py-2">
                <button type="button"
                  class="w-full rounded-md px-1 py-1 text-left transition hover:text-amber-200"
                 
                  @click="selectSummaryRow(row.playerHrid)"
                >
                  {{ row.playerName }}
                </button>
              </td>
              <td class="px-2 py-2">{{ formatNumber(row.encountersPerHour) }}</td>
              <td class="px-2 py-2">{{ formatNumber(row.deathsPerHour) }}</td>
              <td class="px-2 py-2">{{ formatNumber(row.totalXpPerHour) }}</td>
              <td class="px-2 py-2">{{ formatCurrency(row.profitPerHour) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="panel">
          <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.results.detailsTitle", "Result Details") }}</h2>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:player", "Player") }}</p>
              <p class="mt-1 font-heading text-lg text-slate-100">{{ activeResultRow?.playerName ?? '-' }}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.results.simulatedTime", "Simulated Time") }}</p>
              <p class="mt-1 font-heading text-lg text-slate-100">{{ simulatedHoursText }}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:zoneName", "Zone") }}</p>
              <p class="mt-1 font-heading text-lg text-slate-100">{{ zoneLabel }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ t("common:vue.results.difficulty", "Difficulty") }}: {{ simulator.results.simResult?.difficultyTier ?? 0 }}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.results.workerRuntime", "Worker Runtime") }}</p>
              <p class="mt-1 font-heading text-lg text-slate-100">{{ t("common:vue.results.elapsed", "Elapsed", { seconds: simulator.runtime.elapsedSeconds.toFixed(1) }) }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ t("common:vue.results.protocol", "Protocol") }}: {{ singleProtocolLabel }}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:revenue", "Revenue") }}</p>
              <p class="mt-1 font-heading text-lg text-emerald-300">{{ formatCurrency(activeRevenueTotal) }}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:expense", "Expense") }}</p>
              <p class="mt-1 font-heading text-lg text-rose-300">{{ formatCurrency(activeExpensesTotal) }}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:profit", "Profit") }}</p>
              <p class="mt-1 font-heading text-lg" :class="activeProfitTotal >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                {{ formatCurrency(activeProfitTotal) }}
              </p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:noRNGProfit", "No RNG Profit") }}</p>
              <p class="mt-1 font-heading text-lg" :class="activeExpectedProfitTotal >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                {{ formatCurrency(activeExpectedProfitTotal) }}
              </p>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <DisclosurePanel :title="t('common:vue.results.experienceBreakdown', 'Experience Breakdown')" :default-open="true">
              <div class="grid gap-2 sm:grid-cols-2">
                <div v-for="entry in experienceRows" :key="entry.label" class="rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-xs uppercase tracking-[0.12em] text-slate-400">{{ entry.label }}</p>
                  <p class="mt-1 text-slate-100">{{ formatNumber(entry.value) }}</p>
                </div>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.killPerHour', 'Kills Per Hour')">
              <div class="space-y-2">
                <div v-for="row in killMetricRows" :key="row.label" class="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-100">{{ row.value }}</p>
                </div>
                <div v-for="row in monsterKillRows.slice(0, DETAIL_ROW_LIMIT)" :key="row.id" class="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-100">{{ row.value }}</p>
                </div>
                <p v-if="monsterKillRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.timeSpentOnBoss', 'Time Spent On Boss')">
              <div class="space-y-2">
                <div v-for="row in bossTimeRows" :key="row.id" class="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-400">{{ row.extra || "-" }}</p>
                  <p class="text-slate-100">{{ row.value }}</p>
                </div>
                <p v-if="bossTimeRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.hpSpentPerHour', 'HP Spent Per Hour')">
              <div class="space-y-2">
                <div v-for="row in hpSpentRows" :key="row.id" class="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-100">{{ formatNumber(row.value) }}</p>
                </div>
                <p v-if="hpSpentRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.manaUsedPerHour', 'Mana Used Per Hour')">
              <div class="space-y-2">
                <div v-for="row in manaUsedRows" :key="row.id" class="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-400">{{ formatNumber(row.castsPerHour) }} /h</p>
                  <p class="text-slate-100">{{ formatNumber(row.manaPerHour) }}</p>
                </div>
                <p v-if="manaUsedRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.healthRestoredPerSecond', 'Health Restored Per Second')">
              <div class="space-y-2">
                <div v-for="row in hitpointsRestoredRows" :key="row.id" class="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-400">{{ formatNumber(row.perSecond) }} /s</p>
                  <p class="text-slate-100">{{ formatPercent(row.pct, 0) }}</p>
                </div>
                <p v-if="hitpointsRestoredRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.manaRestoredPerSecond', 'Mana Restored Per Second')">
              <div class="space-y-2">
                <div v-for="row in manapointsRestoredRows" :key="row.id" class="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-400">{{ formatNumber(row.perSecond) }} /s</p>
                  <p class="text-slate-100">{{ formatPercent(row.pct, 0) }}</p>
                </div>
                <div v-for="row in manaStatusRows" :key="row.id" class="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <p class="text-slate-300">{{ row.label }}</p>
                  <p class="text-slate-100">{{ row.value }}</p>
                </div>
                <p v-if="manapointsRestoredRows.length === 0 && manaStatusRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.damageDoneTotal', 'Damage Done (Total)')">
              <div class="space-y-3">
                <div class="overflow-x-auto">
                  <table class="min-w-full text-xs">
                    <thead>
                      <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                        <th class="px-2 py-2">{{ t("common:simulationResults.source", "Source") }}</th>
                        <th class="px-2 py-2">{{ t("common:simulationResults.hitChance", "Hit Chance") }}</th>
                        <th class="px-2 py-2">DPS</th>
                        <th class="px-2 py-2">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, index) in damageDoneSummary.totalRows" :key="`damage-done-total-${index}`" class="border-b border-white/5 text-slate-200">
                        <td class="px-2 py-2" :class="index === 0 ? 'font-semibold text-amber-200' : ''">{{ row.label }}</td>
                        <td class="px-2 py-2">{{ formatPercent(row.hitChance, 1) }}</td>
                        <td class="px-2 py-2">{{ formatNumber(row.dps) }}</td>
                        <td class="px-2 py-2">{{ formatPercent(row.pct, 0) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div v-for="detail in damageDoneSummary.detailRows.slice(0, DETAIL_ROW_LIMIT)" :key="detail.id" class="rounded-lg border border-white/10 p-3">
                  <p class="mb-2 text-xs uppercase tracking-[0.12em] text-slate-400">{{ detail.label }}</p>
                  <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead>
                        <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                          <th class="px-2 py-2">{{ t("common:simulationResults.source", "Source") }}</th>
                          <th class="px-2 py-2">{{ t("common:simulationResults.hitChance", "Hit Chance") }}</th>
                          <th class="px-2 py-2">DPS</th>
                          <th class="px-2 py-2">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, rowIndex) in detail.rows" :key="`damage-done-${detail.id}-${rowIndex}`" class="border-b border-white/5 text-slate-200">
                          <td class="px-2 py-2" :class="rowIndex === 0 ? 'font-semibold text-amber-200' : ''">{{ row.label }}</td>
                          <td class="px-2 py-2">{{ formatPercent(row.hitChance, 1) }}</td>
                          <td class="px-2 py-2">{{ formatNumber(row.dps) }}</td>
                          <td class="px-2 py-2">{{ formatPercent(row.pct, 0) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <p v-if="damageDoneSummary.totalRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:simulationResults.damageTakenTotal', 'Damage Taken (Total)')">
              <div class="space-y-3">
                <div class="overflow-x-auto">
                  <table class="min-w-full text-xs">
                    <thead>
                      <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                        <th class="px-2 py-2">{{ t("common:simulationResults.source", "Source") }}</th>
                        <th class="px-2 py-2">{{ t("common:simulationResults.hitChance", "Hit Chance") }}</th>
                        <th class="px-2 py-2">DPS</th>
                        <th class="px-2 py-2">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, index) in damageTakenSummary.totalRows" :key="`damage-taken-total-${index}`" class="border-b border-white/5 text-slate-200">
                        <td class="px-2 py-2" :class="index === 0 ? 'font-semibold text-amber-200' : ''">{{ row.label }}</td>
                        <td class="px-2 py-2">{{ formatPercent(row.hitChance, 1) }}</td>
                        <td class="px-2 py-2">{{ formatNumber(row.dps) }}</td>
                        <td class="px-2 py-2">{{ formatPercent(row.pct, 0) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div v-for="detail in damageTakenSummary.detailRows.slice(0, DETAIL_ROW_LIMIT)" :key="detail.id" class="rounded-lg border border-white/10 p-3">
                  <p class="mb-2 text-xs uppercase tracking-[0.12em] text-slate-400">{{ detail.label }}</p>
                  <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead>
                        <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                          <th class="px-2 py-2">{{ t("common:simulationResults.source", "Source") }}</th>
                          <th class="px-2 py-2">{{ t("common:simulationResults.hitChance", "Hit Chance") }}</th>
                          <th class="px-2 py-2">DPS</th>
                          <th class="px-2 py-2">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, rowIndex) in detail.rows" :key="`damage-taken-${detail.id}-${rowIndex}`" class="border-b border-white/5 text-slate-200">
                          <td class="px-2 py-2" :class="rowIndex === 0 ? 'font-semibold text-amber-200' : ''">{{ row.label }}</td>
                          <td class="px-2 py-2">{{ formatPercent(row.hitChance, 1) }}</td>
                          <td class="px-2 py-2">{{ formatNumber(row.dps) }}</td>
                          <td class="px-2 py-2">{{ formatPercent(row.pct, 0) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <p v-if="damageTakenSummary.totalRows.length === 0" class="text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              </div>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:dropTotal', 'Drops (Total)')">
              <div class="overflow-x-auto">
                <table class="min-w-full text-xs">
                  <thead>
                    <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                      <th class="px-2 py-2">{{ t("common:vue.results.breakdownItem", "Item") }}</th>
                      <th class="px-2 py-2">{{ t("common:vue.results.breakdownAmount", "Amount") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in totalDropsRowsForDisplay" :key="`drop-total-${row.itemHrid}`" class="border-b border-white/5 text-slate-200">
                      <td class="px-2 py-2">{{ formatItemName(row.itemHrid) }}</td>
                      <td class="px-2 py-2">{{ formatAmount(row.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="totalDropsRowsForDisplay.length === 0" class="mt-2 text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:noRNGDrops', 'No RNG Drops')">
              <div class="overflow-x-auto">
                <table class="min-w-full text-xs">
                  <thead>
                    <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                      <th class="px-2 py-2">{{ t("common:vue.results.breakdownItem", "Item") }}</th>
                      <th class="px-2 py-2">{{ t("common:vue.results.breakdownAmount", "Amount") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in noRngDropsRowsForDisplay" :key="`drop-no-rng-${row.itemHrid}`" class="border-b border-white/5 text-slate-200">
                      <td class="px-2 py-2">{{ formatItemName(row.itemHrid) }}</td>
                      <td class="px-2 py-2">{{ formatAmount(row.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="noRngDropsRowsForDisplay.length === 0" class="mt-2 text-xs text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
              <p v-if="hasTrimmedDropRows" class="mt-2 text-xs text-slate-400">
                {{ t("common:vue.results.breakdownTrimHint", "Showing first entries only.") }}
              </p>
            </DisclosurePanel>

            <DisclosurePanel :title="t('common:vue.results.profitBreakdownTitle', 'Profit Breakdown')" :default-open="true">
              <div class="grid gap-3 lg:grid-cols-2">
                <div class="rounded-lg border border-white/10 p-3">
                  <div class="mb-2 flex items-center justify-between">
                    <h4 class="font-heading text-sm font-semibold text-emerald-200">{{ t("common:vue.results.revenueItemsTitle", "Revenue Items") }}</h4>
                    <span class="text-xs text-emerald-200">{{ formatCurrency(activeProfitBreakdown.revenue) }}</span>
                  </div>
                  <p v-if="revenueItemsForDisplay.length === 0" class="text-xs text-slate-400">{{ t("common:vue.results.breakdownNoRevenue", "No revenue items.") }}</p>
                  <div v-else class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead>
                        <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownItem", "Item") }}</th>
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownAmount", "Amount") }}</th>
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownUnitPrice", "Unit Price") }}</th>
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownTotal", "Total") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in revenueItemsForDisplay" :key="`revenue-${row.itemHrid}`" class="border-b border-white/5 text-slate-200">
                          <td class="px-2 py-2">{{ formatItemName(row.itemHrid) }}</td>
                          <td class="px-2 py-2">{{ formatAmount(row.amount) }}</td>
                          <td class="px-2 py-2">{{ formatCurrency(row.unitPrice) }}</td>
                          <td class="px-2 py-2">{{ formatCurrency(row.totalValue) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="rounded-lg border border-white/10 p-3">
                  <div class="mb-2 flex items-center justify-between">
                    <h4 class="font-heading text-sm font-semibold text-rose-200">{{ t("common:vue.results.expenseItemsTitle", "Expense Items") }}</h4>
                    <span class="text-xs text-rose-200">{{ formatCurrency(activeProfitBreakdown.expenses) }}</span>
                  </div>
                  <p v-if="expenseItemsForDisplay.length === 0" class="text-xs text-slate-400">{{ t("common:vue.results.breakdownNoExpenses", "No expense items.") }}</p>
                  <div v-else class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead>
                        <tr class="border-b border-white/10 text-left uppercase tracking-[0.12em] text-slate-400">
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownItem", "Item") }}</th>
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownAmount", "Amount") }}</th>
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownUnitPrice", "Unit Price") }}</th>
                          <th class="px-2 py-2">{{ t("common:vue.results.breakdownTotal", "Total") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in expenseItemsForDisplay" :key="`expense-${row.itemHrid}`" class="border-b border-white/5 text-slate-200">
                          <td class="px-2 py-2">{{ formatItemName(row.itemHrid) }}</td>
                          <td class="px-2 py-2">{{ formatAmount(row.amount) }}</td>
                          <td class="px-2 py-2">{{ formatCurrency(row.unitPrice) }}</td>
                          <td class="px-2 py-2">{{ formatCurrency(row.totalValue) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <p v-if="hasTrimmedBreakdownRows" class="mt-2 text-xs text-slate-400">
                {{ t("common:vue.results.breakdownTrimHint", "Showing first entries only.") }}
              </p>
            </DisclosurePanel>
          </div>
        </div>

      <div v-if="simulator.simulationSettings.enableHpMpVisualization && simulator.results.timeSeriesData" class="space-y-3">
        <TimeSeriesChart :time-series-data="simulator.results.timeSeriesData" />
      </div>

      <div class="panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:WipeEvents", "Wipe Events") }}</h2>
        <p v-if="!hasWipeEvents" class="text-sm text-slate-400">{{ t("common:noWipeEventsDetected", "No wipe events detected in this simulation.") }}</p>

        <template v-else>
          <div class="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto] sm:items-end">
            <label class="block">
              <span class="field-label">{{ t("common:vue.results.event", "Event") }}</span>
              <select v-model.number="selectedWipeEventIndex" class="field-select">
                <option
                  v-for="(wipeEvent, index) in wipeEvents"
                  :key="`${index}-${wipeEvent.timestamp || 0}`"
                  :value="index"
                >
                  #{{ index + 1 }} | {{ t("common:vue.results.wave", "Wave") }} {{ wipeEvent.wave || "?" }} | {{ formatSimSeconds(wipeEvent.simulationTime) }}s
                </option>
              </select>
            </label>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
              <p>{{ t("common:vue.results.wave", "Wave") }}: {{ activeWipeEvent?.wave || "?" }}</p>
              <p>{{ t("common:vue.results.simulationTime", "Simulation Time") }}: {{ formatSimSeconds(activeWipeEvent?.simulationTime) }}s</p>
              <p>{{ t("common:combatLogs", "Logs") }}: {{ wipeLogsForDisplay.length }}</p>
            </div>
          </div>

          <div class="mt-3 overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
                  <th class="px-2 py-2">{{ t("common:vue.results.timeSeconds", "t(s)") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.results.wave", "Wave") }}</th>
                  <th class="px-2 py-2">{{ t("common:simulationResults.source", "Source") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.results.ability", "Ability") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.results.target", "Target") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.results.damage", "Damage") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.results.hpShort", "HP") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.results.crit", "Crit") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(log, logIndex) in wipeLogsForDisplay" :key="`${selectedWipeEventIndex}-${logIndex}`" class="border-b border-white/5 text-slate-200">
                  <td class="px-2 py-2">{{ formatSimSeconds(log.time) }}</td>
                  <td class="px-2 py-2">{{ log.wave ?? "-" }}</td>
                  <td class="px-2 py-2">{{ formatLogSource(log) }}</td>
                  <td class="px-2 py-2">{{ formatLogAbility(log) }}</td>
                  <td class="px-2 py-2">{{ log.target || "-" }}</td>
                  <td class="px-2 py-2" :class="log.isCrit ? 'font-semibold text-amber-300' : ''">{{ formatNumber(log.damage) }}</td>
                  <td class="px-2 py-2">{{ formatNumber(log.beforeHp) }} -> {{ formatNumber(log.afterHp) }}</td>
                  <td class="px-2 py-2">{{ log.isCrit ? t("common:simulationResults.Yes", "Yes") : t("common:simulationResults.No", "No") }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import actionDetailMap from "../../combatsimulator/data/actionDetailMap.json";
import combatMonsterDetailMap from "../../combatsimulator/data/combatMonsterDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { buildNoRngProfitBreakdown, buildRandomProfitBreakdown } from "../../services/profitEstimator.js";
import DisclosurePanel from "./DisclosurePanel.vue";
import TimeSeriesChart from "./TimeSeriesChart.vue";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useAbilityText } from "../composables/useAbilityText.js";
import { useI18nText } from "../composables/useI18nText.js";

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getAbilityName } = useAbilityText();
const PLAYER_HRIDS = new Set(["player1", "player2", "player3", "player4", "player5"]);
const batchSort = ref({ key: "", direction: "desc" });
const batchTableColumns = Object.freeze([
  { key: "zoneName", labelKey: "common:zoneName", fallback: "Zone Name", sortable: false, format: "text", csvDigits: null, highlightMax: false },
  { key: "difficulty", labelKey: "common:vue.results.diff", fallback: "Diff", sortable: false, format: "text", csvDigits: null, highlightMax: false },
  { key: "playerName", labelKey: "common:player", fallback: "Player", sortable: false, format: "text", csvDigits: null, highlightMax: false },
  { key: "encountersPerHour", labelKey: "common:simulationResults.encounters", fallback: "Encounters", sortable: true, format: "decimal", csvDigits: 1, highlightMax: false },
  { key: "deathsPerHour", labelKey: "common:simulationResults.deathPerHour", fallback: "Deaths", sortable: true, format: "decimal", csvDigits: 2, highlightMax: false },
  { key: "totalXpPerHour", labelKey: "common:simulationResults.totalExperience", fallback: "Total Experience", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "staminaXpPerHour", labelKey: "common:vue.home.levelLabels.stamina", fallback: "Stamina", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "intelligenceXpPerHour", labelKey: "common:vue.home.levelLabels.intelligence", fallback: "Intelligence", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "attackXpPerHour", labelKey: "common:vue.home.levelLabels.attack", fallback: "Attack", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "magicXpPerHour", labelKey: "common:vue.home.levelLabels.magic", fallback: "Magic", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "rangedXpPerHour", labelKey: "common:vue.home.levelLabels.ranged", fallback: "Ranged", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "meleeXpPerHour", labelKey: "common:vue.home.levelLabels.melee", fallback: "Melee", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "defenseXpPerHour", labelKey: "common:vue.home.levelLabels.defense", fallback: "Defense", sortable: true, format: "integer", csvDigits: 0, highlightMax: true },
  { key: "noRngRevenue", labelKey: "common:noRNGRevenue", fallback: "No RNG Revenue", sortable: true, format: "decimal", csvDigits: 2, highlightMax: true },
  { key: "expenses", labelKey: "common:expense", fallback: "Expense", sortable: true, format: "decimal", csvDigits: 2, highlightMax: true },
  { key: "noRngProfit", labelKey: "common:noRNGProfit", fallback: "No RNG Profit", sortable: true, format: "decimal", csvDigits: 2, highlightMax: true },
]);

const hasBatchResult = computed(() => simulator.results.batchRows.length > 0);
const isBatchLabyrinth = computed(() => Boolean(simulator.results.simResults?.[0]?.isLabyrinth));
const singleProtocolLabel = computed(() => t(
  "common:vue.results.protocolSingle",
  "start_simulation / simulation_result",
));
const batchProtocolLabel = computed(() => {
  const protocol = String(simulator.results.batchResultType || "simulation_result_allZones");
  if (protocol === "simulation_result_allZones") {
    return t(
      "common:vue.results.protocolAllZones",
      "start_simulation_all_zones / simulation_result_allZones",
    );
  }
  if (protocol === "simulation_result_allLabyrinths") {
    return t(
      "common:vue.results.protocolAllLabyrinths",
      "start_simulation_all_labyrinths / simulation_result_allLabyrinths",
    );
  }
  return protocol;
});
const batchRowsSorted = computed(() => {
  const rows = simulator.results.batchRows.slice();
  const sortKey = String(batchSort.value.key || "");
  if (!sortKey) {
    return rows;
  }

  const column = batchTableColumns.find((entry) => entry.key === sortKey);
  if (!column || !column.sortable) {
    return rows;
  }

  const direction = batchSort.value.direction === "asc" ? 1 : -1;
  rows.sort((a, b) => (toFiniteNumber(a?.[sortKey]) - toFiniteNumber(b?.[sortKey])) * direction);
  return rows;
});
const batchRowsForDisplay = computed(() => batchRowsSorted.value);
const bestBatchRow = computed(() => {
  const rows = simulator.results.batchRows;
  if (!rows.length) {
    return null;
  }

  let best = rows[0];
  for (let index = 1; index < rows.length; index += 1) {
    if (Number(rows[index]?.profitPerHour || 0) > Number(best?.profitPerHour || 0)) {
      best = rows[index];
    }
  }
  return best;
});
const batchHighlightCellByColumn = computed(() => {
  if (isBatchLabyrinth.value) {
    return {};
  }

  const highlightMap = {};
  for (const column of batchTableColumns) {
    if (!column.highlightMax) {
      continue;
    }

    let maxValue = -Infinity;
    let rowId = null;
    for (const row of simulator.results.batchRows) {
      const value = toFiniteNumber(row?.[column.key], Number.NEGATIVE_INFINITY);
      if (value > maxValue) {
        maxValue = value;
        rowId = row.rowId;
      }
    }

    if (rowId !== null && Number.isFinite(maxValue) && maxValue !== 0) {
      highlightMap[column.key] = rowId;
    }
  }
  return highlightMap;
});
const selectedWipeEventIndex = ref(0);
const BREAKDOWN_ROW_LIMIT = 220;
const DETAIL_ROW_LIMIT = 200;

const activeResultRow = computed(() => simulator.activeResultRow);
const activePlayerHrid = computed(() => String(simulator.results.activeResultPlayerHrid || "player1"));

function selectSummaryRow(playerHrid) {
  simulator.results.activeResultPlayerHrid = String(playerHrid || "");
}

const simulatedHours = computed(() => {
  const seconds = Number(simulator.results.simResult?.simulatedTime ?? 0) / 1e9;
  const hours = seconds / 3600;
  if (!Number.isFinite(hours) || hours <= 0) {
    return 1e-9;
  }
  return hours;
});

const simulatedHoursText = computed(() => `${simulatedHours.value.toFixed(2)} h`);
const simulatedSeconds = computed(() => Math.max(1e-9, Number(simulator.results.simResult?.simulatedTime || 0) / 1e9));

const activeProfitBreakdown = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return {
      revenueItems: [],
      expenseItems: [],
      revenue: 0,
      expenses: 0,
      profit: 0,
    };
  }

  return buildRandomProfitBreakdown(simResult, simulator.results.activeResultPlayerHrid, {
    consumableMode: simulator.pricing.consumableMode,
    dropMode: simulator.pricing.dropMode,
    priceTable: simulator.pricing.priceTable,
  });
});

const activeNoRngProfitBreakdown = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return {
      revenueItems: [],
      expenseItems: [],
      revenue: 0,
      expenses: 0,
      profit: 0,
    };
  }

  return buildNoRngProfitBreakdown(simResult, simulator.results.activeResultPlayerHrid, {
    consumableMode: simulator.pricing.consumableMode,
    dropMode: simulator.pricing.dropMode,
    priceTable: simulator.pricing.priceTable,
  });
});

const activeRevenueTotal = computed(() => Number(activeProfitBreakdown.value.revenue || 0));
const activeExpensesTotal = computed(() => Number(activeProfitBreakdown.value.expenses || 0));
const activeProfitTotal = computed(() => Number(activeProfitBreakdown.value.profit || 0));
const activeExpectedProfitTotal = computed(() => Number(activeNoRngProfitBreakdown.value.profit || 0));

const revenueItemsForDisplay = computed(() => activeProfitBreakdown.value.revenueItems.slice(0, BREAKDOWN_ROW_LIMIT));
const expenseItemsForDisplay = computed(() => activeProfitBreakdown.value.expenseItems.slice(0, BREAKDOWN_ROW_LIMIT));
const hasTrimmedBreakdownRows = computed(() => (
  activeProfitBreakdown.value.revenueItems.length > BREAKDOWN_ROW_LIMIT
  || activeProfitBreakdown.value.expenseItems.length > BREAKDOWN_ROW_LIMIT
));

const noRngDropsRows = computed(() => {
  if (simulator.results.simResult?.isDungeon) {
    return [];
  }
  return activeNoRngProfitBreakdown.value.revenueItems || [];
});

const totalDropsRows = computed(() => {
  if (simulator.results.simResult?.isDungeon) {
    return [];
  }
  return (activeProfitBreakdown.value.revenueItems || []).map((row) => ({
    itemHrid: row.itemHrid,
    amount: row.amount,
  }));
});

const totalDropsRowsForDisplay = computed(() => totalDropsRows.value.slice(0, DETAIL_ROW_LIMIT));
const noRngDropsRowsForDisplay = computed(() => noRngDropsRows.value.slice(0, DETAIL_ROW_LIMIT));
const hasTrimmedDropRows = computed(() => (
  totalDropsRows.value.length > DETAIL_ROW_LIMIT
  || noRngDropsRows.value.length > DETAIL_ROW_LIMIT
));

const zoneLabel = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return "-";
  }

  if (simResult.isLabyrinth) {
    const labyrinthHrid = String(simResult.labyrinthName || simResult.labyrinthHrid || "");
    if (!labyrinthHrid) {
      return t("common:labyrinth", "Labyrinth");
    }
    if (labyrinthHrid.startsWith("/monsters/")) {
      const defaultLabel = combatMonsterDetailMap?.[labyrinthHrid]?.name || labyrinthHrid;
      return t(`monsterNames.${labyrinthHrid}`, defaultLabel);
    }
    return labyrinthHrid;
  }

  const zoneHrid = String(simResult.zoneName || simResult.zoneHrid || "");
  if (!zoneHrid) {
    return t("common:zoneName", "Zone");
  }
  if (zoneHrid.startsWith("/actions/")) {
    const defaultLabel = actionDetailMap?.[zoneHrid]?.name || zoneHrid;
    return t(`actionNames.${zoneHrid}`, defaultLabel);
  }
  return zoneHrid;
});

const activePlayerDeaths = computed(() => {
  const playerHrid = simulator.results.activeResultPlayerHrid;
  return simulator.results.simResult?.deaths?.[playerHrid] ?? 0;
});

const killMetricRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }

  const rows = [];
  if (simResult.isDungeon) {
    rows.push({
      label: t("common:simulationResults.maxWaveReached", "Max Wave Reached"),
      value: Number(simResult.maxWaveReached || 0),
    });
    rows.push({
      label: t("common:simulationResults.dungeonsCompleted", "Dungeons Completed"),
      value: Number(simResult.dungeonsCompleted || 0),
    });
    if (Number(simResult.dungeonsFailed || 0) > 0) {
      rows.push({
        label: t("common:simulationResults.dungeonsFailed", "Dungeons Failed"),
        value: Number(simResult.dungeonsFailed || 0),
      });
    }
    if (Number(simResult.maxEnrageStack || 0) > 0) {
      rows.push({
        label: t("common:simulationResults.maxEnrageStack", "Max Stack of Enrage"),
        value: Number(simResult.maxEnrageStack || 0),
      });
    }

    const completed = Math.max(0, Number(simResult.dungeonsCompleted || 0));
    const dungeonHours = Number(simResult.lastDungeonFinishTime || 0) > 0
      ? (Number(simResult.lastDungeonFinishTime || 0) / 1e9 / 3600)
      : simulatedHours.value;

    if (completed > 0 && dungeonHours > 0) {
      rows.push({
        label: t("common:simulationResults.averageTime", "Average Time"),
        value: `${(dungeonHours * 60 / completed).toFixed(1)}m`,
      });
    }

    const minDungeonSeconds = Number(simResult.minDungenonTime || 0) / 1e9;
    if (minDungeonSeconds > 0) {
      rows.push({
        label: t("common:simulationResults.minimumTime", "Minimum Time"),
        value: `${(minDungeonSeconds / 60).toFixed(1)}m`,
      });
    }
  } else {
    const encounterHours = Number(simResult.lastEncounterFinishTime || 0) > 0
      ? (Number(simResult.lastEncounterFinishTime || 0) / 1e9 / 3600)
      : simulatedHours.value;
    const encountersPerHour = encounterHours > 0
      ? Number(simResult.encounters || 0) / encounterHours
      : 0;
    rows.push({
      label: t("common:simulationResults.encounters", "Encounters"),
      value: `${encountersPerHour.toFixed(1)}/h`,
    });
  }

  const debuffOnLevelGap = Number(simResult.debuffOnLevelGap?.[activePlayerHrid.value] || 0);
  if (Math.abs(debuffOnLevelGap) > 1e-9) {
    rows.push({
      label: t("common:simulationResults.debuffOnLevelGap", "Debuff on Level Gap"),
      value: `${(debuffOnLevelGap * 100).toFixed(1)}%`,
    });
  }

  return rows;
});

const monsterKillRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }

  const hours = simulatedHours.value;
  const rows = Object.entries(simResult.deaths || {})
    .filter(([hrid]) => !PLAYER_HRIDS.has(String(hrid || "")))
    .map(([hrid, deaths]) => ({
      id: String(hrid || ""),
      label: formatMonsterName(hrid),
      value: `${(Number(deaths || 0) / hours).toFixed(1)}/h`,
    }));

  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
});

const bossTimeRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }

  const bosses = Array.isArray(simResult.bossSpawns) ? simResult.bossSpawns : [];
  if (bosses.length === 0) {
    return [];
  }

  if (simResult.isDungeon) {
    const rows = [];
    for (const waveName of bosses) {
      const waveLabel = String(waveName || "").split(",")[0];
      const aliveEntry = findAliveEntry(simResult, waveLabel);
      const count = Math.max(0, Number(aliveEntry?.count || 0));
      if (count <= 0) {
        continue;
      }
      const averageSeconds = (Number(aliveEntry?.timeSpentAlive || 0) / 1e9) / count;
      rows.push({
        id: waveLabel,
        label: waveLabel,
        extra: String(count),
        value: `${averageSeconds.toFixed(1)}s`,
      });
    }
    return rows;
  }

  return bosses.map((bossHrid) => {
    const aliveSeconds = resolveAliveSecondsByName(simResult, bossHrid, simulatedSeconds.value);
    const hours = aliveSeconds / 3600;
    const percentage = simulatedSeconds.value > 0 ? (aliveSeconds / simulatedSeconds.value) * 100 : 0;
    return {
      id: String(bossHrid || ""),
      label: formatMonsterName(bossHrid),
      extra: "",
      value: `${hours.toFixed(2)}h (${percentage.toFixed(2)}%)`,
    };
  });
});

const hpSpentRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }

  const sourceMap = simResult.hitpointsSpent?.[activePlayerHrid.value] || {};
  return Object.entries(sourceMap)
    .map(([source, amount]) => ({
      id: String(source || ""),
      label: formatAbilityLabel(source),
      value: Number(amount || 0) / simulatedHours.value,
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
});

const manaUsedRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }

  const sourceMap = simResult.manaUsed?.[activePlayerHrid.value] || {};
  return Object.entries(sourceMap)
    .map(([abilityHrid, amount]) => {
      const manaPerHour = Number(amount || 0) / simulatedHours.value;
      const manaCost = Number(abilityDetailMap?.[abilityHrid]?.manaCost || 0);
      return {
        id: String(abilityHrid || ""),
        label: formatAbilityLabel(abilityHrid),
        castsPerHour: manaCost > 0 ? (manaPerHour / manaCost) : 0,
        manaPerHour,
      };
    })
    .filter((entry) => entry.manaPerHour > 0)
    .sort((a, b) => b.manaPerHour - a.manaPerHour);
});

const hitpointsRestoredRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }
  return buildResourceRestoreRows(simResult.hitpointsGained?.[activePlayerHrid.value], simulatedSeconds.value, "hp");
});

const manapointsRestoredRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }
  return buildResourceRestoreRows(simResult.manapointsGained?.[activePlayerHrid.value], simulatedSeconds.value, "mp");
});

const manaStatusRows = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return [];
  }

  const rows = [];
  const ranOut = Boolean(simResult.playerRanOutOfMana?.[activePlayerHrid.value]);
  rows.push({
    id: "ranOutOfMana",
    label: t("common:simulationResults.ranOutOfMana", "Mana Run Out"),
    value: ranOut ? t("common:simulationResults.Yes", "Yes") : t("common:simulationResults.No", "No"),
  });

  if (ranOut) {
    const stat = simResult.playerRanOutOfManaTime?.[activePlayerHrid.value];
    if (stat) {
      const totalOutTime = Number(stat.totalTimeForOutOfMana || 0)
        + (stat.isOutOfMana ? (Number(simResult.simulatedTime || 0) - Number(stat.startTimeForOutOfMana || 0)) : 0);
      const ratio = Number(simResult.simulatedTime || 0) > 0
        ? (totalOutTime / Number(simResult.simulatedTime || 0)) * 100
        : 0;
      rows.push({
        id: "ranOutOfManaRatio",
        label: t("common:simulationResults.ranOutOfManaRatio", "Mana Run Out Ratio"),
        value: `${ratio.toFixed(2)}%`,
      });
    }
  }

  return rows;
});

const damageDoneSummary = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return {
      totalRows: [],
      detailRows: [],
    };
  }

  const totalAggregate = {};
  const detailRows = [];
  const byTarget = simResult.attacks?.[activePlayerHrid.value] || {};
  for (const [targetHrid, abilityMap] of Object.entries(byTarget)) {
    const aggregate = aggregateAbilityDamage(abilityMap);
    if (Object.keys(aggregate).length === 0) {
      continue;
    }
    mergeAbilityDamageAggregate(totalAggregate, aggregate);
    const aliveSeconds = resolveAliveSecondsByName(simResult, targetHrid, simulatedSeconds.value);
    detailRows.push({
      id: String(targetHrid || ""),
      label: formatMonsterName(targetHrid),
      rows: buildDamageRows(aggregate, aliveSeconds),
    });
  }

  return {
    totalRows: buildDamageRows(totalAggregate, simulatedSeconds.value),
    detailRows,
  };
});

const damageTakenSummary = computed(() => {
  const simResult = simulator.results.simResult;
  if (!simResult) {
    return {
      totalRows: [],
      detailRows: [],
    };
  }

  const totalAggregate = {};
  const detailRows = [];
  for (const [sourceHrid, targetMap] of Object.entries(simResult.attacks || {})) {
    if (PLAYER_HRIDS.has(sourceHrid)) {
      continue;
    }

    const abilityMap = targetMap?.[activePlayerHrid.value];
    if (!abilityMap) {
      continue;
    }

    const aggregate = aggregateAbilityDamage(abilityMap);
    if (Object.keys(aggregate).length === 0) {
      continue;
    }

    mergeAbilityDamageAggregate(totalAggregate, aggregate);
    const aliveSeconds = resolveAliveSecondsByName(simResult, sourceHrid, simulatedSeconds.value);
    detailRows.push({
      id: String(sourceHrid || ""),
      label: formatMonsterName(sourceHrid),
      rows: buildDamageRows(aggregate, aliveSeconds),
    });
  }

  return {
    totalRows: buildDamageRows(totalAggregate, simulatedSeconds.value),
    detailRows,
  };
});

const experienceRows = computed(() => {
  const playerHrid = simulator.results.activeResultPlayerHrid;
  const experience = simulator.results.simResult?.experienceGained?.[playerHrid] ?? {};

  return [
    { label: t("common:vue.results.staminaXp", "Stamina XP"), value: experience.stamina ?? 0 },
    { label: t("common:vue.results.intelligenceXp", "Intelligence XP"), value: experience.intelligence ?? 0 },
    { label: t("common:vue.results.attackXp", "Attack XP"), value: experience.attack ?? 0 },
    { label: t("common:vue.results.meleeXp", "Melee XP"), value: experience.melee ?? 0 },
    { label: t("common:vue.results.defenseXp", "Defense XP"), value: experience.defense ?? 0 },
    { label: t("common:vue.results.rangedXp", "Ranged XP"), value: experience.ranged ?? 0 },
    { label: t("common:vue.results.magicXp", "Magic XP"), value: experience.magic ?? 0 },
  ];
});

const wipeEvents = computed(() => {
  const events = simulator.results.simResult?.wipeEvents;
  return Array.isArray(events) ? events : [];
});

const hasWipeEvents = computed(() => wipeEvents.value.length > 0);

const activeWipeEvent = computed(() => {
  if (!wipeEvents.value.length) {
    return null;
  }

  const safeIndex = Math.max(0, Math.min(wipeEvents.value.length - 1, Number(selectedWipeEventIndex.value || 0)));
  return wipeEvents.value[safeIndex] ?? null;
});

const wipeLogsForDisplay = computed(() => {
  const logs = activeWipeEvent.value?.logs;
  if (!Array.isArray(logs)) {
    return [];
  }
  return logs.slice(0, 600);
});

watch(
  () => simulator.results.simResult,
  () => {
    selectedWipeEventIndex.value = 0;
  },
);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatFixed(value, digits) {
  return toFiniteNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInteger(value) {
  return toFiniteNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function toggleBatchSort(columnKey) {
  const column = batchTableColumns.find((entry) => entry.key === columnKey);
  if (!column || !column.sortable) {
    return;
  }

  if (batchSort.value.key === columnKey) {
    batchSort.value.direction = batchSort.value.direction === "asc" ? "desc" : "asc";
    return;
  }

  batchSort.value = {
    key: columnKey,
    direction: "desc",
  };
}

function getBatchSortIndicator(columnKey) {
  if (batchSort.value.key !== columnKey) {
    return "<>";
  }
  return batchSort.value.direction === "asc" ? "^" : "v";
}

function formatBatchCell(row, column) {
  const value = row?.[column.key];
  if (column.key === "zoneName") {
    const zoneText = String(value || "");
    if (zoneText.startsWith("/actions/")) {
      const defaultLabel = actionDetailMap?.[zoneText]?.name || zoneText;
      return t(`actionNames.${zoneText}`, defaultLabel);
    }
    if (zoneText.startsWith("/monsters/")) {
      const defaultLabel = combatMonsterDetailMap?.[zoneText]?.name || zoneText;
      return t(`monsterNames.${zoneText}`, defaultLabel);
    }
    return zoneText || "-";
  }
  if (column.format === "integer") {
    return formatInteger(value);
  }
  if (column.format === "decimal") {
    return formatFixed(value, Number(column.csvDigits ?? 2));
  }
  return value ?? "-";
}

function getBatchCellClass(row, column) {
  if (isBatchLabyrinth.value && column.key === "encountersPerHour" && toFiniteNumber(row?.encountersPerHour) >= 30) {
    return "bg-emerald-700/40 font-semibold text-emerald-200";
  }

  if (isBatchLabyrinth.value) {
    return "";
  }

  if (!column.highlightMax) {
    return "";
  }
  const highlightedRowId = batchHighlightCellByColumn.value[column.key];
  if (highlightedRowId && highlightedRowId === row.rowId) {
    return "bg-emerald-700/40 font-semibold text-emerald-200";
  }
  return "";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value, digits = 1) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(digits)}%`;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatItemName(itemHrid) {
  const hrid = String(itemHrid || "");
  if (!hrid) {
    return "-";
  }
  const defaultLabel = itemDetailMap?.[hrid]?.name || hrid;
  return t(`itemNames.${hrid}`, defaultLabel);
}

function formatMonsterName(monsterHrid) {
  const hrid = String(monsterHrid || "");
  const defaultLabel = combatMonsterDetailMap?.[hrid]?.name || hrid;
  return t(`monsterNames.${hrid}`, defaultLabel);
}

function formatAbilityLabel(abilityHrid) {
  const hrid = String(abilityHrid || "");
  if (!hrid) {
    return "-";
  }

  if (hrid === "autoAttack") {
    return t("common:vue.results.autoAttack", "Auto Attack");
  }
  if (hrid === "parry") {
    return t("common:simulationResults.parryAttack", "Parry Attack");
  }
  if (hrid === "damageOverTime") {
    return t("common:vue.results.damageOverTime", "Damage Over Time");
  }
  if (hrid === "physicalThorns") {
    return t("common:vue.results.physicalThorns", "Physical Thorns");
  }
  if (hrid === "elementalThorns") {
    return t("common:vue.results.elementalThorns", "Elemental Thorns");
  }
  if (hrid === "retaliation") {
    return t("common:vue.results.retaliation", "Retaliation");
  }
  if (hrid === "blaze") {
    return t("common:vue.home.combatStats.blaze", "Blaze");
  }
  const abilityName = getAbilityName(hrid, hrid);
  if (abilityName !== hrid) {
    return abilityName;
  }
  return hrid;
}

function resolveAliveSecondsByName(simResult, name, fallbackSeconds) {
  const entry = findAliveEntry(simResult, name);
  const seconds = Number(entry?.timeSpentAlive || 0) / 1e9;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return Math.max(1e-9, Number(fallbackSeconds || 0));
  }
  return seconds;
}

function findAliveEntry(simResult, name) {
  const targetName = String(name || "");
  return (simResult?.timeSpentAlive || []).find((entry) => String(entry?.name || "") === targetName) || null;
}

function aggregateAbilityDamage(abilityMap) {
  const aggregate = {};
  for (const [ability, hitMap] of Object.entries(abilityMap || {})) {
    let casts = 0;
    let misses = 0;
    let damage = 0;
    for (const [hitValue, countValue] of Object.entries(hitMap || {})) {
      const count = Number(countValue || 0);
      if (!Number.isFinite(count) || count <= 0) {
        continue;
      }
      casts += count;
      if (hitValue === "miss") {
        misses += count;
        continue;
      }
      damage += Number(hitValue || 0) * count;
    }

    if (casts <= 0 && damage <= 0) {
      continue;
    }

    aggregate[ability] = {
      casts,
      misses,
      damage,
    };
  }

  return aggregate;
}

function mergeAbilityDamageAggregate(target, source) {
  for (const [ability, entry] of Object.entries(source || {})) {
    if (!target[ability]) {
      target[ability] = {
        casts: 0,
        misses: 0,
        damage: 0,
      };
    }
    target[ability].casts += Number(entry.casts || 0);
    target[ability].misses += Number(entry.misses || 0);
    target[ability].damage += Number(entry.damage || 0);
  }
}

function buildDamageRows(aggregate, secondsSimulated) {
  const rows = Object.entries(aggregate || {})
    .map(([ability, entry]) => ({
      id: ability,
      label: formatAbilityLabel(ability),
      casts: Number(entry.casts || 0),
      misses: Number(entry.misses || 0),
      damage: Number(entry.damage || 0),
    }))
    .filter((entry) => entry.casts > 0 || entry.damage > 0)
    .sort((a, b) => b.damage - a.damage);

  if (rows.length === 0) {
    return [];
  }

  const safeSeconds = Math.max(1e-9, Number(secondsSimulated || 0));
  const totalCasts = rows.reduce((sum, row) => sum + row.casts, 0);
  const totalMisses = rows.reduce((sum, row) => sum + row.misses, 0);
  const totalDamage = rows.reduce((sum, row) => sum + row.damage, 0);

  const formatRow = (label, casts, misses, damage) => {
    const hitChance = casts > 0 ? ((casts - misses) / casts) * 100 : 0;
    const dps = damage / safeSeconds;
    const pct = totalDamage > 0 ? (damage / totalDamage) * 100 : 0;
    return {
      label,
      hitChance,
      dps,
      pct,
      rawDamage: damage,
    };
  };

  const result = [
    formatRow(t("common:total", "Total"), totalCasts, totalMisses, totalDamage),
  ];

  for (const row of rows) {
    result.push(formatRow(row.label, row.casts, row.misses, row.damage));
  }

  return result.slice(0, DETAIL_ROW_LIMIT);
}

function buildResourceRestoreRows(sourceMap, seconds, resourceType) {
  const entries = Object.entries(sourceMap || {})
    .map(([source, amount]) => ({
      source: String(source || ""),
      amount: Number(amount || 0),
    }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  if (entries.length === 0) {
    return [];
  }

  const safeSeconds = Math.max(1e-9, Number(seconds || 0));
  const totalAmount = entries.reduce((sum, entry) => sum + entry.amount, 0);

  const rows = [
    {
      id: "total",
      label: t("common:total", "Total"),
      perSecond: totalAmount / safeSeconds,
      pct: 100,
    },
  ];

  for (const entry of entries) {
    rows.push({
      id: entry.source,
      label: formatRestoreSourceLabel(entry.source, resourceType),
      perSecond: entry.amount / safeSeconds,
      pct: totalAmount > 0 ? (entry.amount / totalAmount) * 100 : 0,
    });
  }

  return rows.slice(0, DETAIL_ROW_LIMIT);
}

function formatRestoreSourceLabel(source, resourceType) {
  if (source === "regen") {
    return resourceType === "hp"
      ? t("common:vue.home.combatStats.hpRegen", "HP Regen")
      : t("common:vue.home.combatStats.mpRegen", "MP Regen");
  }
  if (source === "lifesteal") {
    return t("common:vue.home.combatStats.lifeSteal", "Life Steal");
  }
  if (source === "manaLeech") {
    return t("common:vue.home.combatStats.manaLeech", "Mana Leech");
  }
  if (source === "blaze") {
    return t("common:vue.home.combatStats.blaze", "Blaze");
  }
  if (source === "bloom") {
    return t("common:vue.home.combatStats.bloom", "Bloom");
  }
  if (source === "ripple") {
    return t("common:vue.home.combatStats.ripple", "Ripple");
  }
  if (itemDetailMap?.[source]?.name) {
    return t(`itemNames.${source}`, itemDetailMap[source].name);
  }
  const abilityName = getAbilityName(source, source || "-");
  if (abilityName !== (source || "-")) {
    return abilityName;
  }
  return source || "-";
}

function formatSimSeconds(value) {
  const seconds = Number(value || 0) / 1e9;
  if (!Number.isFinite(seconds)) {
    return "0.00";
  }
  return seconds.toFixed(2);
}

function formatLogSource(log) {
  if (!log) {
    return "-";
  }
  if (log.ability === "damageOverTime") {
    return String(log.target || t("common:vue.results.dot", "DOT"));
  }
  if (log.source === "UNKNOWN_SOURCE") {
    return t("common:vue.results.unknown", "UNKNOWN");
  }
  return String(log.source || "-");
}

function formatLogAbility(log) {
  const ability = String(log?.ability || "");
  if (!ability) {
    return "-";
  }
  if (ability === "autoAttack") {
    return t("common:vue.results.autoAttack", "Auto Attack");
  }
  if (ability === "damageOverTime") {
    return t("common:vue.results.damageOverTime", "Damage Over Time");
  }
  if (ability === "physicalThorns") {
    return t("common:vue.results.physicalThorns", "Physical Thorns");
  }
  if (ability === "elementalThorns") {
    return t("common:vue.results.elementalThorns", "Elemental Thorns");
  }
  if (ability === "retaliation") {
    return t("common:vue.results.retaliation", "Retaliation");
  }
  return ability;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toBatchCsvValue(row, column) {
  const value = row?.[column.key];
  if (column.csvDigits === null || column.csvDigits === undefined) {
    return value ?? "";
  }
  return toFiniteNumber(value).toFixed(Number(column.csvDigits));
}

function exportBatchRowsCsv() {
  const rows = batchRowsSorted.value || [];
  if (!rows.length) {
    return;
  }

  const header = batchTableColumns.map((column) => t(column.labelKey, column.fallback));
  const csvLines = [header.map(toCsvCell).join(",")];
  for (const row of rows) {
    const fields = batchTableColumns.map((column) => toBatchCsvValue(row, column));
    csvLines.push(fields.map(toCsvCell).join(","));
  }

  const blob = new Blob([`\uFEFF${csvLines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mwi-batch-results-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
</script>
