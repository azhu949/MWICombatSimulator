<template>
  <section class="space-y-4">
    <div class="grid grid-cols-1 gap-4">
      <div class="surface-panel overflow-hidden">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div class="space-y-2">
            <p class="text-xs uppercase text-primary">{{ t('common:advisor.eyebrow', 'Advisor') }}</p>
            <h2 class="font-heading text-2xl font-semibold text-foreground">
              {{ t('common:advisor.title', 'Farm Advisor') }}
            </h2>
            <p class="max-w-3xl text-sm leading-6 text-foreground/85">
              {{
                t(
                  'common:advisor.desc',
                  'Use your current team, buffs, achievements, housing, pricing, and run duration to rank the best farming targets across solo zones and group zones.',
                )
              }}
            </p>
            <DisclosurePanel
              :title="t('common:advisor.scoreExplainTitle', 'How the Composite Score and Confidence are computed')"
              class="max-w-3xl"
            >
              <div class="space-y-3 text-xs leading-6 text-foreground/85">
                <div>
                  <p class="font-semibold text-foreground">
                    {{ t('common:advisor.scoreExplainCompositeHeading', 'How is the composite score computed?') }}
                  </p>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainComposite1',
                          'Each target is rated on 3 metrics: Daily Profit, XP/h, and Safety (derived from Deaths/h). Kills/h is shown for reference only and does not affect the composite score.',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainComposite2',
                          'Each metric is compared against all candidates to produce a 0–100 relative score.',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainComposite3',
                          'Scores are weighted by your chosen goal preset (Balanced / Profit / XP / Safe / Custom) into a base score.',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainComposite4',
                          'Final score = base score × (0.85 + 0.15 × confidence).',
                        )
                      }}
                    </li>
                  </ul>
                </div>
                <div>
                  <p class="font-semibold text-foreground">
                    {{ t('common:advisor.scoreExplainConfidenceHeading', 'How is confidence computed?') }}
                  </p>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainConfidence1',
                          'Reflects how consistent results are across multiple scans — the closer the per-run data, the higher confidence.',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainConfidence2',
                          'Sample size: more rounds → higher confidence (10–20 refine rounds approaches the ceiling).',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainConfidence3',
                          'Run-to-run variance: the smaller the variance in profit / XP / deaths across rounds, the higher confidence.',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainConfidence4',
                          'The penalty for low confidence is small (~15%); even at 0% confidence the final score still preserves 85% of the base score.',
                        )
                      }}
                    </li>
                  </ul>
                </div>
                <div>
                  <p class="font-semibold text-foreground">
                    {{ t('common:advisor.presetIroncow', 'Iron Cow') }}
                  </p>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainIroncow1',
                          'Iron Cow mode rates targets on drops, XP, and safety: the drops dimension compares the expected per-hour count of your selected items across all candidates, and profit does not affect the score.',
                        )
                      }}
                    </li>
                    <li>
                      {{
                        t(
                          'common:advisor.scoreExplainIroncow2',
                          'The Iron Cow drops/XP/safety weights must sum to 1, otherwise they are not applied.',
                        )
                      }}
                    </li>
                  </ul>
                </div>
              </div>
            </DisclosurePanel>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ selectedPlayersLabel }}</span>
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ metricPlayerLabel }}</span>
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ runtimeStatusText }}</span>
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ pricingModeText }}</span>
            </div>
          </div>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div class="space-y-3 rounded-md border border-border bg-muted/40 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="control-label mb-0">{{ t('common:advisor.goal', 'Goal') }}</span>
              <button
                v-for="preset in presetOptions"
                :key="preset.value"
                type="button"
                :class="[
                  'rounded-md border px-3 py-1.5 text-xs transition',
                  simulator.advisor.goalPreset === preset.value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-foreground/85 hover:border-primary/40 hover:text-primary',
                  isRunning ? 'cursor-not-allowed opacity-60' : '',
                ]"
                :disabled="isRunning"
                @click="setPreset(preset.value)"
              >
                {{ preset.label }}
              </button>
            </div>

            <div v-if="isIroncowGoal" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <label v-for="weight in ironcowInputFields" :key="weight.key" class="block">
                <span class="control-label">{{ weight.label }}</span>
                <input
                  :value="ironcowWeightDraft[weight.key] ?? 0"
                  type="number"
                  min="0"
                  step="0.01"
                  class="control-input"
                  :disabled="isRunning"
                  @input="(event) => onIroncowWeightInput(weight.key, event)"
                  @change="onIroncowWeightChange"
                />
              </label>
            </div>
            <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <label v-for="weight in customInputFields" :key="weight.key" class="block">
                <span class="control-label">{{ weight.label }}</span>
                <input
                  :value="weightInputValue(weight.key)"
                  type="number"
                  min="0"
                  step="0.01"
                  class="control-input"
                  :disabled="isRunning || !isCustomGoal"
                  @input="(event) => onCustomWeightInput(weight.key, event)"
                  @change="onCustomWeightChange"
                />
              </label>
            </div>
            <template v-if="isIroncowGoal">
              <p class="text-xs text-muted-foreground">
                {{ t('common:advisor.weightSumLabel', 'Weight sum') }}: {{ ironcowWeightSumText }}
              </p>
              <p v-if="!ironcowWeightSumValid" class="text-xs font-medium text-destructive" role="alert">
                {{ t('common:advisor.weightSumError', 'The three weights must sum to 1') }}
              </p>
              <!-- 摘要恒显上次已应用的合法权重（非法输入不应用时与草稿行不一致，即“沿用上次合法权重”的直观提示）。 -->
              <p class="text-xs text-muted-foreground">
                {{ customWeightSummaryText }}
              </p>
            </template>
            <p v-else class="text-xs text-muted-foreground">
              {{ customWeightSummaryText }}
            </p>
          </div>

          <div class="space-y-3 rounded-md border border-border bg-muted/40 p-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <label
                class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground"
              >
                <input
                  v-model="filterDraft.includeSoloZones"
                  type="checkbox"
                  class="accent-primary"
                  :disabled="isRunning"
                />
                <span>{{ t('common:advisor.includeSolo', 'Solo zones') }}</span>
              </label>
              <label
                class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground"
              >
                <input
                  v-model="filterDraft.includeGroupZones"
                  type="checkbox"
                  class="accent-primary"
                  :disabled="isRunning"
                />
                <span>{{ t('common:advisor.includeGroup', 'Group zones') }}</span>
              </label>
              <label
                class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground"
              >
                <input
                  v-model="filterDraft.refineTopEnabled"
                  type="checkbox"
                  class="accent-primary"
                  :disabled="isRunning"
                />
                <span>{{ t('common:advisor.refineTop', 'Refine Top 8') }}</span>
              </label>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label for="advisor-refine-count" class="control-label">{{
                  t('common:advisor.refineCount', 'Refine Count')
                }}</label>
                <NumberField
                  id="advisor-refine-count"
                  v-model="filterDraft.refineTopCount"
                  :min="1"
                  :max="32"
                  :disabled="isRunning"
                />
              </div>
              <div>
                <label for="advisor-refine-rounds" class="control-label">{{
                  t('common:advisor.refineRounds', 'Refine Rounds')
                }}</label>
                <NumberField
                  id="advisor-refine-rounds"
                  v-model="filterDraft.refineRounds"
                  :min="1"
                  :max="30"
                  :disabled="isRunning"
                />
              </div>
              <div>
                <label for="advisor-quick-rounds" class="control-label">{{
                  t('common:advisor.quickRounds', 'Quick Rounds')
                }}</label>
                <NumberField
                  id="advisor-quick-rounds"
                  v-model="filterDraft.quickRounds"
                  :min="1"
                  :max="10"
                  :disabled="isRunning"
                />
              </div>
            </div>
          </div>

          <!-- 铁牛模式：目标掉落物品独立全宽面板（主角配置，不与扫描设置混排）。 -->
          <div
            v-if="isIroncowGoal"
            class="rounded-md border border-border bg-muted/40 p-4 lg:col-span-2"
            data-advisor-drop-items
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="control-label mb-0">{{ t('common:advisor.dropItemsTitle', 'Target drop items') }}</span>
                <span
                  class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition"
                  :class="
                    selectedDropItemHrids.length > 0
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/50 text-muted-foreground'
                  "
                >
                  {{
                    t('common:advisor.dropItemsSelectedCount', 'Selected {selected} / {total} in scope', {
                      selected: selectedDropItemHrids.length,
                      total: dropItemEntries.length,
                    })
                  }}
                </span>
              </div>
              <button
                v-if="selectedDropItemEntries.length > 0"
                type="button"
                class="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isRunning"
                data-advisor-drop-item-clear
                @click="clearSelectedDropItems"
              >
                {{ t('common:advisor.dropItemsClear', 'Clear') }}
              </button>
            </div>
            <div class="relative mt-3">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                v-model="dropItemSearchQuery"
                type="text"
                class="control-input pl-9"
                :placeholder="t('common:advisor.dropItemsSearchPlaceholder', 'Search item name or HRID')"
                data-advisor-drop-item-search
              />
            </div>
            <!-- 已选物品 chips：点击即移除（X 图标 + 悬停变红作删除暗示）。 -->
            <div v-if="selectedDropItemEntries.length > 0" class="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                v-for="entry in selectedDropItemEntries"
                :key="entry.itemHrid"
                type="button"
                class="group inline-flex max-w-64 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary transition hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed"
                :class="[
                  entry.outOfRange
                    ? 'border-border bg-muted/50 text-muted-foreground line-through opacity-70 hover:border-destructive/50'
                    : '',
                  isRunning ? 'pointer-events-none cursor-not-allowed opacity-60' : '',
                ]"
                :disabled="isRunning"
                :title="
                  entry.outOfRange
                    ? t('common:advisor.dropItemOutOfRange', 'This item is outside the current scan scope')
                    : ''
                "
                :data-advisor-drop-item-out-of-range="entry.outOfRange ? 'true' : undefined"
                @click="removeSelectedDropItem(entry.itemHrid)"
              >
                <svg
                  v-if="dropItemIconVisible(entry.itemHrid)"
                  class="h-3.5 w-3.5 shrink-0"
                  viewBox="0 0 50 50"
                  aria-hidden="true"
                >
                  <use :href="itemIconHref(entry.itemHrid)"></use>
                </svg>
                <span class="truncate">{{ entry.name }}</span>
                <X class="h-3 w-3 shrink-0 opacity-60 transition group-hover:opacity-100" aria-hidden="true" />
              </button>
            </div>
            <!-- 候选物品：自适应多列卡片网格，选中行整卡高亮（checkbox 视觉隐藏但保留键盘可达）。 -->
            <div
              class="mt-3 grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-border bg-background/40 p-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
              role="list"
            >
              <label
                v-for="entry in filteredDropItemEntries"
                :key="entry.itemHrid"
                class="flex relative min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
                :class="[
                  isDropItemSelected(entry.itemHrid)
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border/70 bg-background/60 text-foreground hover:border-primary/40 hover:bg-muted/50',
                  isRunning ? 'pointer-events-none cursor-not-allowed opacity-60' : '',
                ]"
                role="listitem"
              >
                <input
                  type="checkbox"
                  class="sr-only"
                  :checked="isDropItemSelected(entry.itemHrid)"
                  :disabled="isRunning"
                  @change="(event) => setDropItemSelected(entry.itemHrid, event.target.checked, event)"
                />
                <span class="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                  <svg v-if="dropItemIconVisible(entry.itemHrid)" class="h-5 w-5" viewBox="0 0 50 50">
                    <use :href="itemIconHref(entry.itemHrid)"></use>
                  </svg>
                </span>
                <span class="min-w-0 flex-1 truncate" :title="entry.name">{{ entry.name }}</span>
                <Check v-if="isDropItemSelected(entry.itemHrid)" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </label>
              <p
                v-if="filteredDropItemEntries.length === 0"
                class="col-span-full px-3 py-6 text-center text-sm text-muted-foreground"
              >
                {{ t('common:advisor.dropItemsEmpty', 'No matching items.') }}
              </p>
            </div>
          </div>
        </div>

        <div v-if="applyStatus || simulator.advisor.error" class="mt-4 space-y-2">
          <p
            v-if="applyStatus"
            class="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
          >
            {{ applyStatus }}
          </p>
          <p
            v-if="simulator.advisor.error"
            class="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            {{ advisorErrorText }}
          </p>
        </div>
      </div>

      <aside class="surface-panel">
        <div v-if="topCardsWithRows.length === 0">
          <p class="text-sm text-muted-foreground">
            {{ t('common:advisor.noCards', 'Run the advisor to generate quick picks and top cards.') }}
          </p>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article
            v-for="card in topCardsWithRows"
            :key="card.key"
            class="rounded-md border border-border bg-primary/10 p-4 shadow-lg"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-[11px] uppercase text-primary">{{ card.title }}</p>
                <h3 class="mt-1 font-heading text-lg text-foreground">{{ getTargetLabel(card.row || card) }}</h3>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ getContentTypeLabel(card.row || card) }} · {{ getDifficultyLabel(card.row || card) }}
                </p>
              </div>
              <span class="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                {{ formatMetric(card.row?.finalScore ?? card.score, 1) }}
              </span>
            </div>
            <div v-if="card.row" class="mt-3 grid grid-cols-2 gap-2 text-xs text-foreground/85">
              <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p class="text-muted-foreground">
                  {{
                    isIroncowGoal
                      ? t('common:advisor.dropsPerHour', 'Drops/h')
                      : t('common:advisor.dailyProfit', 'Daily Profit')
                  }}
                </p>
                <p class="mt-1 text-sm text-foreground">
                  {{
                    isIroncowGoal
                      ? formatDropRate(card.row.dropsPerHour)
                      : formatAdvisorDailyProfitValue(card.row.profitPerHour)
                  }}
                </p>
              </div>
              <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p class="text-muted-foreground">{{ t('common:advisor.xpPerHour', 'XP/h') }}</p>
                <p class="mt-1 text-sm text-foreground">{{ formatAdvisorCompactValue(card.row.xpPerHour) }}</p>
              </div>
            </div>
            <button
              v-if="card.row"
              type="button"
              class="button-secondary mt-3 w-full justify-center"
              @click="applyToHome(card.row)"
            >
              {{ t('common:advisor.applyToHome', 'Apply to Home') }}
            </button>
          </article>
        </div>
      </aside>
    </div>

    <div v-if="displayRows.length === 0" class="surface-panel">
      <p class="text-sm text-muted-foreground">
        {{
          t('common:advisor.noResults', "No advisor results yet. Click 'Run Advisor' to scan current farming targets.")
        }}
      </p>
    </div>

    <div v-else class="surface-panel overflow-x-auto">
      <p
        v-if="simulator.advisor.dropDataStale"
        class="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        data-advisor-drop-data-stale
      >
        {{
          t(
            'common:advisor.dropDataStale',
            'Target drop items or the goal preset changed; current results are based on stale data. Re-scan to refresh.',
          )
        }}
      </p>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-heading text-base font-semibold text-primary">
            {{ t('common:advisor.tableTitle', 'Recommended Targets') }}
          </h3>
          <p class="text-xs text-muted-foreground">{{ tableSummaryText }}</p>
        </div>
        <span class="rounded-md border border-border bg-muted/40 px-3 py-1 text-xs text-foreground/85">
          {{ t('common:advisor.rowCount', 'Rows') }}: {{ displayRows.length }}
        </span>
      </div>

      <Table class="min-w-[1280px] w-full text-sm">
        <TableHeader>
          <TableRow class="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('rank')">
              #<span class="ml-0.5">{{ advisorSortIndicator('rank') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('type')">
              {{ t('common:advisor.contentType', 'Type')
              }}<span class="ml-0.5">{{ advisorSortIndicator('type') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('target')">
              {{ t('common:advisor.target', 'Target') }}<span class="ml-0.5">{{ advisorSortIndicator('target') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('difficulty')">
              {{ t('common:advisor.difficulty', 'Difficulty')
              }}<span class="ml-0.5">{{ advisorSortIndicator('difficulty') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('profitPerHour')">
              {{ t('common:advisor.dailyProfit', 'Daily Profit')
              }}<span class="ml-0.5">{{ advisorSortIndicator('profitPerHour') }}</span>
            </TableHead>
            <TableHead
              v-if="isIroncowGoal"
              class="cursor-pointer select-none px-2 py-3"
              @click="toggleAdvisorSort('dropsPerHour')"
            >
              {{ t('common:advisor.dropsPerHour', 'Drops/h')
              }}<span class="ml-0.5">{{ advisorSortIndicator('dropsPerHour') }}</span>
            </TableHead>
            <TableHead v-if="isIroncowGoal" class="px-2 py-3">
              {{ t('common:advisor.dropItemsColumn', 'Drop Items') }}
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('xpPerHour')">
              {{ t('common:advisor.xpPerHour', 'XP/h')
              }}<span class="ml-0.5">{{ advisorSortIndicator('xpPerHour') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('killsPerHour')">
              {{ t('common:advisor.killsPerHour', 'Kills/h')
              }}<span class="ml-0.5">{{ advisorSortIndicator('killsPerHour') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('deathsPerHour')">
              {{ t('common:advisor.deathsPerHour', 'Deaths/h')
              }}<span class="ml-0.5">{{ advisorSortIndicator('deathsPerHour') }}</span>
            </TableHead>
            <TableHead class="cursor-pointer select-none px-2 py-3" @click="toggleAdvisorSort('finalScore')">
              {{ t('common:advisor.score', 'Score')
              }}<span class="ml-0.5">{{ advisorSortIndicator('finalScore') }}</span>
            </TableHead>
            <TableHead class="px-2 py-3">{{ t('common:advisor.reason', 'Reasons') }}</TableHead>
            <TableHead class="px-2 py-3"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in sortedRows"
            :key="row.id"
            :class="[
              'border-b border-border align-top transition-colors',
              row.rank <= 3 ? 'bg-primary/10' : 'hover:bg-muted/40',
            ]"
          >
            <TableCell class="px-2 py-3 font-medium text-foreground">{{ row.rank }}</TableCell>
            <TableCell class="px-2 py-3 text-foreground/85">{{ getContentTypeLabel(row) }}</TableCell>
            <TableCell class="px-2 py-3">
              <div class="font-medium text-foreground">{{ getTargetLabel(row) }}</div>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground/85">{{ getDifficultyLabel(row) }}</TableCell>
            <TableCell class="px-2 py-3 text-foreground">
              <span
                :class="
                  Number(row.profitPerHour) === maxAdvisorRowMetrics.profitPerHour
                    ? maxMetricValueClass
                    : metricValueClass
                "
              >
                {{ formatAdvisorDailyProfitValue(row.profitPerHour) }}
              </span>
            </TableCell>
            <TableCell v-if="isIroncowGoal" class="px-2 py-3 text-foreground">
              <span
                :class="
                  Number(row.dropsPerHour) === maxAdvisorRowMetrics.dropsPerHour
                    ? maxMetricValueClass
                    : metricValueClass
                "
                :title="getDropsCellTitle(row)"
              >
                {{ formatDropRate(row.dropsPerHour) }}
              </span>
            </TableCell>
            <TableCell v-if="isIroncowGoal" class="px-2 py-3">
              <div
                v-if="getDroppingItems(row).length > 0"
                class="flex max-w-[260px] flex-wrap gap-1.5"
                data-advisor-dropping-items
              >
                <span
                  v-for="entry in getDroppingItems(row)"
                  :key="entry.itemHrid"
                  class="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-1 text-[11px] text-foreground"
                  :title="getDroppingItemTitle(entry)"
                >
                  <svg
                    v-if="dropItemIconVisible(entry.itemHrid)"
                    class="h-4 w-4 shrink-0"
                    viewBox="0 0 50 50"
                    aria-hidden="true"
                  >
                    <use :href="itemIconHref(entry.itemHrid)"></use>
                  </svg>
                  <span class="max-w-[160px] truncate">{{ getItemName(entry.itemHrid, entry.itemHrid) }}</span>
                </span>
              </div>
              <span v-else class="text-[11px] text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground">
              <span
                :class="
                  Number(row.xpPerHour) === maxAdvisorRowMetrics.xpPerHour ? maxMetricValueClass : metricValueClass
                "
              >
                {{ formatAdvisorCompactValue(row.xpPerHour) }}
              </span>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground">
              <span
                :class="
                  Number(row.killsPerHour) === maxAdvisorRowMetrics.killsPerHour
                    ? maxMetricValueClass
                    : metricValueClass
                "
              >
                {{ formatMetric(row.killsPerHour, 1) }}
              </span>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground">{{ formatMetric(row.deathsPerHour, 2) }}</TableCell>
            <TableCell class="px-2 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  {{ formatMetric(row.finalScore, 1) }}
                </span>
                <span
                  v-if="row.isRefined"
                  class="rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] text-success"
                >
                  {{ t('common:advisor.confidence', 'Confidence') }} {{ formatMetric(row.confidenceScore, 0) }}%
                </span>
                <span
                  v-else
                  class="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-foreground/85"
                >
                  {{ t('common:advisor.quick', 'Quick') }}
                </span>
              </div>
              <p class="mt-1 text-[11px] text-muted-foreground">
                {{
                  row.isRefined
                    ? t('common:advisor.refinedRounds', 'Refined {done}/{total} rounds', {
                        done: row.successfulRounds,
                        total: row.refineRounds,
                      })
                    : t('common:advisor.singlePass', 'Single quick pass')
                }}
              </p>
            </TableCell>
            <TableCell class="px-2 py-3">
              <div class="flex max-w-[240px] flex-wrap gap-1.5">
                <span
                  v-for="reason in row.reasons"
                  :key="reason"
                  class="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-foreground"
                >
                  {{ getReasonLabel(reason) }}
                </span>
              </div>
            </TableCell>
            <TableCell class="px-2 py-3 text-right">
              <button type="button" class="button-secondary" @click="applyToHome(row)">
                {{ t('common:advisor.applyToHome', 'Apply to Home') }}
              </button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- 已有扫描结果时修改目标掉落物品：弹窗提醒先清空结果；确认后清空当前
         结果并应用本次修改，取消（X / Esc / 遮罩）则保留结果与原选择。 -->
    <BaseModal
      :open="dropItemsResultsDialogOpen"
      :title="t('common:advisor.dropItemsResultsTitle', 'Scan results exist')"
      @close="cancelDropItemsResultsDialog"
    >
      <p>
        {{
          t(
            'common:advisor.dropItemsResultsBody',
            'You already have scan results. Clear them before changing target drop items.',
          )
        }}
      </p>
      <p class="text-xs text-muted-foreground">
        {{
          t(
            'common:advisor.dropItemsResultsHint',
            'Confirm to clear the current results and apply this change; cancel keeps the existing results.',
          )
        }}
      </p>
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class="button-secondary" @click="cancelDropItemsResultsDialog">
          {{ t('common:vue.common.cancel', 'Cancel') }}
        </button>
        <button
          type="button"
          class="button-danger"
          data-advisor-drop-items-results-confirm
          @click="confirmClearAdvisorResultsForDropItems"
        >
          {{ t('common:advisor.dropItemsResultsConfirm', 'Clear results & apply') }}
        </button>
      </div>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Check, Search, X } from '@lucide/vue';
import { actionDetailIndex as actionDetailMap } from '../../shared/gameDataIndex.js';
import { formatAdvisorCompactValue, formatAdvisorDailyProfitValue } from '../../services/advisorFormatting.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import {
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_CUSTOM,
  ADVISOR_GOAL_PRESET_IRONCOW,
  ADVISOR_GOAL_PRESET_PROFIT,
  ADVISOR_GOAL_PRESET_SAFE,
  ADVISOR_GOAL_PRESET_XP,
  ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE,
  resolveAdvisorWeights,
} from '../../services/advisorScoring.js';
import { buildAdvisorDropItemOptions } from '../../services/advisorDropItems.js';
import { ensureItemIconSymbols, hasItemIconSymbol, itemIconHref } from '../../services/itemIconSprite.js';
import { useGameDataText } from '../composables/useGameDataText.js';
import { useI18nText } from '../composables/useI18nText.js';
import BaseModal from '../components/BaseModal.vue';
import DisclosurePanel from '../components/DisclosurePanel.vue';
import { NumberField } from '../components/ui/number-field/index.js';
import { buildAdvisorRuntimePhaseText } from '../advisorRuntimePresentation.js';

const simulator = useSimulatorStore();
const router = useRouter();
const { t } = useI18nText();
const { getActionName, getItemName, getOfficialGameText } = useGameDataText();
const applyStatus = ref('');

const metricValueClass = 'inline-flex items-center rounded-md border border-transparent px-2.5 py-1 tabular-nums';

const maxMetricValueClass = `${metricValueClass} border-primary/40 bg-primary/10 font-semibold text-primary shadow-sm`;

const presetOptions = computed(() => [
  { value: ADVISOR_GOAL_PRESET_BALANCED, label: t('common:advisor.presetBalanced', 'Balanced') },
  { value: ADVISOR_GOAL_PRESET_PROFIT, label: t('common:advisor.presetProfit', 'Profit') },
  { value: ADVISOR_GOAL_PRESET_XP, label: t('common:advisor.presetXp', 'XP') },
  { value: ADVISOR_GOAL_PRESET_SAFE, label: t('common:advisor.presetSafe', 'Safe') },
  { value: ADVISOR_GOAL_PRESET_CUSTOM, label: t('common:advisor.presetCustom', 'Custom') },
  { value: ADVISOR_GOAL_PRESET_IRONCOW, label: t('common:advisor.presetIroncow', 'Iron Cow') },
]);

const customInputFields = computed(() => [
  { key: 'profitPerHour', label: t('common:advisor.dailyProfit', 'Daily Profit') },
  { key: 'xpPerHour', label: t('common:advisor.xpPerHour', 'XP/h') },
]);

const ironcowInputFields = computed(() => [
  { key: 'safety', label: t('common:advisor.safety', 'Safety') },
  { key: 'dropsPerHour', label: t('common:advisor.dropsPerHour', 'Drops/h') },
  { key: 'xpPerHour', label: t('common:advisor.xpPerHour', 'XP/h') },
]);

const isCustomGoal = computed(() => simulator.advisor.goalPreset === ADVISOR_GOAL_PRESET_CUSTOM);
const isIroncowGoal = computed(() => simulator.advisor.goalPreset === ADVISOR_GOAL_PRESET_IRONCOW);

const resolvedDisplayWeights = computed(() =>
  resolveAdvisorWeights(
    simulator.advisor.goalPreset,
    simulator.advisor.customWeights,
    simulator.advisor.ironcowWeights,
  ),
);

function weightInputValue(key) {
  if (isCustomGoal.value) {
    return customWeightDraft[key] ?? 0;
  }
  return roundTo(resolvedDisplayWeights.value[key] ?? 0, 2);
}

function onCustomWeightInput(key, event) {
  if (!isCustomGoal.value) {
    return;
  }
  const value = Number(event.target?.value);
  customWeightDraft[key] = Number.isFinite(value) ? value : 0;
}

function onCustomWeightChange() {
  if (isCustomGoal.value) {
    applyCustomWeights();
  }
}

const summaryWeightFields = computed(() => {
  if (isIroncowGoal.value) {
    return [
      { key: 'dropsPerHour', label: t('common:advisor.dropsPerHour', 'Drops/h') },
      { key: 'xpPerHour', label: t('common:advisor.xpPerHour', 'XP/h') },
      { key: 'safety', label: t('common:advisor.safety', 'Safety') },
    ];
  }
  return [
    { key: 'profitPerHour', label: t('common:advisor.dailyProfit', 'Daily Profit') },
    { key: 'xpPerHour', label: t('common:advisor.xpPerHour', 'XP/h') },
    { key: 'safety', label: t('common:advisor.safety', 'Safety') },
  ];
});

const filterDraft = reactive({
  includeSoloZones: false,
  includeGroupZones: true,
  refineTopEnabled: true,
  refineTopCount: 8,
  refineRounds: 20,
  quickRounds: 3,
  dropItemHrids: [],
});

const customWeightDraft = reactive({
  profitPerHour: 0.484615,
  xpPerHour: 0.415385,
  safety: 0.1,
});

// 铁牛三维权重草稿：安全性 / 掉落 / 经验，应用前由 UI 校验三者之和恰为 1。
const ironcowWeightDraft = reactive({
  dropsPerHour: 0.45,
  xpPerHour: 0.45,
  safety: 0.1,
});

function roundTo(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(digits));
}

function syncCustomWeightDraft(source) {
  const safeSource = source || {};
  customWeightDraft.profitPerHour = roundTo(safeSource.profitPerHour ?? customWeightDraft.profitPerHour, 2);
  customWeightDraft.xpPerHour = roundTo(safeSource.xpPerHour ?? customWeightDraft.xpPerHour, 2);
  const safetyValue = Number(safeSource.safety ?? customWeightDraft.safety ?? 0.1);
  customWeightDraft.safety = Number.isFinite(safetyValue) ? safetyValue : 0.1;
}

function syncIroncowWeightDraft(source) {
  const safeSource = source || {};
  ironcowWeightDraft.dropsPerHour = roundTo(safeSource.dropsPerHour ?? ironcowWeightDraft.dropsPerHour, 2);
  ironcowWeightDraft.xpPerHour = roundTo(safeSource.xpPerHour ?? ironcowWeightDraft.xpPerHour, 2);
  ironcowWeightDraft.safety = roundTo(safeSource.safety ?? ironcowWeightDraft.safety, 2);
}

function syncFilterDraft(source) {
  const safeSource = source || {};
  filterDraft.includeSoloZones = Boolean(safeSource.includeSoloZones);
  filterDraft.includeGroupZones = safeSource.includeGroupZones !== false;
  filterDraft.refineTopEnabled = safeSource.refineTopEnabled !== false;
  filterDraft.refineTopCount = Number(safeSource.refineTopCount ?? filterDraft.refineTopCount);
  filterDraft.refineRounds = Number(safeSource.refineRounds ?? filterDraft.refineRounds);
  filterDraft.quickRounds = Number(safeSource.quickRounds ?? filterDraft.quickRounds);
  filterDraft.dropItemHrids = Array.isArray(safeSource.dropItemHrids) ? [...safeSource.dropItemHrids] : [];
}

watch(
  () => simulator.advisor.filters,
  (value) => {
    syncFilterDraft(value);
  },
  { deep: true, immediate: true },
);

watch(
  () => simulator.advisor.customWeights,
  (value) => {
    syncCustomWeightDraft(value);
  },
  { deep: true, immediate: true },
);

watch(
  () => simulator.advisor.ironcowWeights,
  (value) => {
    syncIroncowWeightDraft(value);
  },
  { deep: true, immediate: true },
);

// 铁牛模式：目标掉落物品多选面板。候选与清洗都在服务层
//（buildAdvisorDropItemOptions / updateAdvisorFilters），这里只负责
// 展示、搜索与选择状态。
const dropItemSearchQuery = ref('');
const dropItemIconRevision = ref(0);
let dropItemIconLoadQueue = Promise.resolve(0);

const dropItemEntries = computed(() =>
  buildAdvisorDropItemOptions({
    includeSoloZones: filterDraft.includeSoloZones,
    includeGroupZones: filterDraft.includeGroupZones,
  }).map(({ itemHrid }) => ({
    itemHrid,
    name: getItemName(itemHrid, itemHrid),
    nameZh: getOfficialGameText('itemNames', itemHrid, itemHrid, { language: 'zh' }),
    nameEn: getOfficialGameText('itemNames', itemHrid, itemHrid, { language: 'en' }),
  })),
);

const filteredDropItemEntries = computed(() => {
  const query = String(dropItemSearchQuery.value || '')
    .trim()
    .toLowerCase();
  const entries = dropItemEntries.value;
  if (!query) {
    return entries;
  }
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(query) ||
      entry.nameZh.toLowerCase().includes(query) ||
      entry.nameEn.toLowerCase().includes(query) ||
      entry.itemHrid.toLowerCase().includes(query),
  );
});

const selectedDropItemHrids = computed(() =>
  Array.isArray(filterDraft.dropItemHrids) ? filterDraft.dropItemHrids.filter(Boolean) : [],
);

const selectedDropItemEntries = computed(() => {
  const inRangeHrids = new Set(dropItemEntries.value.map((entry) => entry.itemHrid));
  return selectedDropItemHrids.value.map((itemHrid) => ({
    itemHrid,
    name: getItemName(itemHrid, itemHrid),
    outOfRange: !inRangeHrids.has(itemHrid),
  }));
});

function isDropItemSelected(itemHrid) {
  return selectedDropItemHrids.value.includes(itemHrid);
}

// 选择变更：写入草稿并经 store 动作持久化（不自动扫描）。
// 运行中禁止修改；已有扫描结果时不直接放行，而是挂起本次修改并弹窗提醒
// （确认清空结果后才应用，见 confirmClearAdvisorResultsForDropItems）。
function applyDropItemSelection(nextHrids) {
  const safeHrids = Array.isArray(nextHrids) ? nextHrids : [];
  const cleanHrids = Array.from(new Set(safeHrids.map((hrid) => String(hrid || '').trim()).filter(Boolean)));
  if (!requestDropItemSelection(cleanHrids)) {
    return false;
  }
  filterDraft.dropItemHrids = [...cleanHrids];
  // 必须提交整份 filterDraft（与 runAdvisor 同形态），而非仅 dropItemHrids 补丁：
  // updateAdvisorFilters 会用「旧 store filters + patch」整体替换 filters，页面对
  // store filters 的深度 watch 随即回声 syncFilterDraft(store 值)——只传补丁会把
  // 用户尚未提交的范围开关/轮数草稿编辑静默回滚（solo 开关弹回 off → 所选物品变
  // 「不在当前扫描范围」划线 chip → 开始推荐时 candidates 被过滤为空 → NO_TARGETS）。
  // 整份提交后 store 与可见草稿收敛，回声同步退化为无害的 normalize 收敛。
  simulator.updateAdvisorFilters({ ...filterDraft });
  return true;
}

function setDropItemSelected(itemHrid, selected, event) {
  const current = [...selectedDropItemHrids.value];
  const index = current.indexOf(itemHrid);
  if (selected && index === -1) {
    current.push(itemHrid);
  } else if (!selected && index !== -1) {
    current.splice(index, 1);
  } else {
    return;
  }
  if (!applyDropItemSelection(current) && event?.target instanceof HTMLInputElement) {
    // 拒绝变更时回滚 checkbox 的 DOM 勾选态，保持视觉与数据一致。
    event.target.checked = isDropItemSelected(itemHrid);
  }
}

function removeSelectedDropItem(itemHrid) {
  applyDropItemSelection(selectedDropItemHrids.value.filter((hrid) => hrid !== itemHrid));
}

function clearSelectedDropItems() {
  applyDropItemSelection([]);
}

function loadDropItemIcons(hrids = []) {
  const requestedHrids = Array.from(new Set(hrids.map((hrid) => String(hrid || '')).filter(Boolean)));
  // 两个图标 watch 的 getter 每次求值都返回新数组，搜索逐键/流式扫描逐批都会
  // 回调到这里；真正需要拉取的只有「尚未注入 sprite 符号」的物品。全部已注入
  // （含其他页面共享加载过）时直接短路：不再空转入队，也不自增 revision 触发
  // 无意义的整页重渲。
  const missingHrids = requestedHrids.filter((hrid) => !hasItemIconSymbol(hrid));
  if (missingHrids.length === 0) {
    return dropItemIconLoadQueue;
  }
  dropItemIconLoadQueue = dropItemIconLoadQueue
    .catch(() => 0)
    .then(() => ensureItemIconSymbols(missingHrids))
    .then(() => {
      // 仅当确实有新符号变得可见时才 bump revision 触发重渲；拉取失败或物品
      // 在官方 sprite 中本就不存在时不重渲（失败后符号仍缺失，下次触发可重试）。
      if (missingHrids.some((hrid) => hasItemIconSymbol(hrid))) {
        dropItemIconRevision.value += 1;
      }
      return 0;
    })
    .catch(() => 0);
  return dropItemIconLoadQueue;
}

function dropItemIconVisible(itemHrid) {
  void dropItemIconRevision.value;
  return hasItemIconSymbol(itemHrid);
}

watch(
  () => {
    if (!isIroncowGoal.value) {
      return [];
    }
    return [...filteredDropItemEntries.value.map((entry) => entry.itemHrid), ...selectedDropItemHrids.value];
  },
  (hrids) => {
    loadDropItemIcons(hrids);
  },
  { immediate: true },
);

const runtime = computed(() => simulator.advisor.runtime || {});
const isRunning = computed(() => Boolean(runtime.value?.isRunning));
const displayRows = computed(() =>
  Array.isArray(simulator.advisor.refinedRows) && simulator.advisor.refinedRows.length > 0
    ? simulator.advisor.refinedRows
    : Array.isArray(simulator.advisor.quickRows)
      ? simulator.advisor.quickRows
      : [],
);

// 已有结果时的掉落物品修改确认：不再显示“结果基于旧数据”的横幅，而是弹窗
// 提醒「当前已有结果，需要清空当前结果才能继续操作」。确认后清空结果并应用
// 挂起的修改；取消（X / Esc / 遮罩 / 取消按钮）则丢弃本次修改。
const dropItemsResultsDialogOpen = ref(false);
let pendingDropItemSelection = null;

const advisorHasResults = computed(() => displayRows.value.length > 0);

function requestDropItemSelection(cleanHrids) {
  // 冻结条件与 store updateAdvisorFilters 守卫同口径：isRunning 之外还拦
  // scanInFlight（首扫动态导入窗口/停止后 worker 收尾期间，isRunning 已复位
  // 但 store 仍拒绝 filters 写入）。只查 isRunning 会出现「本函数放行、store
  // 拒绝」的分裂——applyDropItemSelection 返回 true 却未真正写入，勾选态随后
  // 被收尾同步回滚（视觉闪烁）。返回 false 可让 setDropItemSelected 即时回滚。
  if (isRunning.value || runtime.value?.scanInFlight) {
    // 运行中/扫描占用期间不允许添加/去除掉落物品（面板交互已禁用，此处兜底拦截）。
    return false;
  }
  if (advisorHasResults.value) {
    // 挂起本次修改，弹窗确认后再继续。
    pendingDropItemSelection = [...cleanHrids];
    dropItemsResultsDialogOpen.value = true;
    return false;
  }
  return true;
}

function cancelDropItemsResultsDialog() {
  dropItemsResultsDialogOpen.value = false;
  pendingDropItemSelection = null;
}

function confirmClearAdvisorResultsForDropItems() {
  const pending = pendingDropItemSelection;
  pendingDropItemSelection = null;
  dropItemsResultsDialogOpen.value = false;
  simulator.clearAdvisorResults();
  if (pending) {
    applyDropItemSelection(pending);
  }
}

// 结果表「掉落物品」列：为各行实际有掉落（rate > 0）的物品加载官方图标
// sprite，与物品面板共用 loadDropItemIcons 队列（串行合并、完成后经
// dropItemIconRevision 触发重渲，dropItemIconVisible 才开始显示图标）。
watch(
  () => {
    if (!isIroncowGoal.value) {
      return [];
    }
    const droppingHrids = [];
    for (const row of displayRows.value) {
      for (const [itemHrid, rate] of Object.entries(row?.dropRatesByItem || {})) {
        if (Number(rate) > 0) {
          droppingHrids.push(itemHrid);
        }
      }
    }
    return droppingHrids;
  },
  (hrids) => {
    loadDropItemIcons(hrids);
  },
  { immediate: true },
);
const maxAdvisorRowMetrics = computed(() => {
  const rows = displayRows.value;
  let maxProfitPerHour = null;
  let maxXpPerHour = null;
  let maxKillsPerHour = null;
  let maxDropsPerHour = null;

  for (const row of rows) {
    const profitPerHour = Number(row?.profitPerHour);
    if (Number.isFinite(profitPerHour) && (maxProfitPerHour == null || profitPerHour > maxProfitPerHour)) {
      maxProfitPerHour = profitPerHour;
    }

    const xpPerHour = Number(row?.xpPerHour);
    if (Number.isFinite(xpPerHour) && (maxXpPerHour == null || xpPerHour > maxXpPerHour)) {
      maxXpPerHour = xpPerHour;
    }

    const killsPerHour = Number(row?.killsPerHour);
    if (Number.isFinite(killsPerHour) && (maxKillsPerHour == null || killsPerHour > maxKillsPerHour)) {
      maxKillsPerHour = killsPerHour;
    }

    const dropsPerHour = Number(row?.dropsPerHour);
    if (Number.isFinite(dropsPerHour) && (maxDropsPerHour == null || dropsPerHour > maxDropsPerHour)) {
      maxDropsPerHour = dropsPerHour;
    }
  }

  return {
    profitPerHour: maxProfitPerHour,
    xpPerHour: maxXpPerHour,
    killsPerHour: maxKillsPerHour,
    dropsPerHour: maxDropsPerHour,
  };
});

// 结果表手动排序：纯前端排序（不重跑模拟），默认（未排序）沿用综合分名次；
// 开始新扫描时通过 resetAdvisorSort 恢复默认。
const sortState = ref({ key: '', direction: 'desc' });
const ADVISOR_SORT_COLUMN_KEYS = [
  'rank',
  'type',
  'target',
  'difficulty',
  'profitPerHour',
  'dropsPerHour',
  'xpPerHour',
  'killsPerHour',
  'deathsPerHour',
  'finalScore',
];

function resolveAdvisorSortValue(row, columnKey) {
  switch (columnKey) {
    case 'rank':
      return Number(row?.rank);
    case 'type':
      return getContentTypeLabel(row);
    case 'target':
      return getTargetLabel(row);
    case 'difficulty':
      return Number(row?.difficultyTier);
    case 'profitPerHour':
    case 'dropsPerHour':
    case 'xpPerHour':
    case 'killsPerHour':
    case 'deathsPerHour':
    case 'finalScore':
      return Number(row?.[columnKey]);
    default:
      return 0;
  }
}

const sortedRows = computed(() => {
  const rows = displayRows.value;
  const columnKey = sortState.value.key;
  if (!columnKey || !ADVISOR_SORT_COLUMN_KEYS.includes(columnKey)) {
    return rows;
  }
  const factor = sortState.value.direction === 'asc' ? 1 : -1;
  return [...rows].sort((rowA, rowB) => {
    const valueA = resolveAdvisorSortValue(rowA, columnKey);
    const valueB = resolveAdvisorSortValue(rowB, columnKey);
    if (typeof valueA === 'string' || typeof valueB === 'string') {
      return String(valueA).localeCompare(String(valueB)) * factor;
    }
    const numericA = Number.isFinite(valueA) ? valueA : 0;
    const numericB = Number.isFinite(valueB) ? valueB : 0;
    if (numericA < numericB) {
      return -factor;
    }
    if (numericA > numericB) {
      return factor;
    }
    return 0;
  });
});

function toggleAdvisorSort(columnKey) {
  if (sortState.value.key === columnKey) {
    sortState.value = { key: columnKey, direction: sortState.value.direction === 'desc' ? 'asc' : 'desc' };
    return;
  }
  sortState.value = { key: columnKey, direction: 'desc' };
}

function resetAdvisorSort() {
  sortState.value = { key: '', direction: 'desc' };
}

function advisorSortIndicator(columnKey) {
  if (sortState.value.key !== columnKey) {
    return '';
  }
  return sortState.value.direction === 'asc' ? '▲' : '▼';
}
const topCardsWithRows = computed(() => {
  const rowById = new Map(displayRows.value.map((row) => [row.id, row]));
  return (simulator.advisor.topCards || []).map((card) => ({
    ...card,
    title: getTopCardTitle(card.titleKey),
    row: rowById.get(card.rowId) || null,
  }));
});
const pricingModeText = computed(() => {
  const consumable = String(simulator.pricing?.consumableMode || 'ask').toUpperCase();
  const drops = String(simulator.pricing?.dropMode || 'bid').toUpperCase();
  return `${t('common:advisor.pricing', 'Pricing')}: ${consumable}/${drops}`;
});
const selectedPlayersLabel = computed(() => {
  const names = simulator.selectedPlayers.map((player) => player.name || `Player ${player.id}`);
  return `${t('common:advisor.players', 'Players')}: ${names.join(', ') || t('common:advisor.none', 'None')}`;
});
const metricPlayerLabel = computed(() => {
  const name = String(simulator.advisor.metricPlayerName || simulator.resolvedAdvisorMetricPlayer?.name || '').trim();
  return `${t('common:advisor.metricPlayer', 'Metric Player')}: ${name || t('common:advisor.none', 'None')}`;
});
const runtimeStatusText = computed(() => {
  if (isRunning.value) {
    return `${t('common:advisor.status', 'Status')}: ${runtimePhaseText.value}`;
  }
  if (String(runtime.value?.phase || 'idle') === 'cancelled') {
    return `${t('common:advisor.status', 'Status')}: ${runtimePhaseText.value}`;
  }
  if (runtime.value?.lastRunAt) {
    return `${t('common:advisor.lastRun', 'Last Run')}: ${new Date(runtime.value.lastRunAt).toLocaleString()}`;
  }
  return `${t('common:advisor.status', 'Status')}: ${t('common:advisor.idle', 'Idle')}`;
});
const runtimePhaseText = computed(() => buildAdvisorRuntimePhaseText(runtime.value, t));
const customWeightSummaryText = computed(
  () =>
    `${t('common:advisor.normalizedWeights', 'Normalized weights')}: ` +
    summaryWeightFields.value
      .map((field) => `${field.label} ${formatMetric(resolvedDisplayWeights.value[field.key], 2)}`)
      .join(' · '),
);
const advisorErrorText = computed(() => {
  const raw = String(simulator.advisor.error || '').trim();
  if (!raw) {
    return '';
  }

  const knownMap = {
    'Another simulation is already running.': t('common:advisor.errorBusy', 'Another simulation is already running.'),
    'Please select at least one player.': t('common:advisor.errorNoPlayer', 'Please select at least one player.'),
    'Unable to build player simulation data.': t(
      'common:advisor.errorBuildPlayer',
      'Unable to build player simulation data.',
    ),
    'No advisor targets available for the current filters.': t(
      'common:advisor.errorNoTargets',
      'No advisor targets available for the current filters.',
    ),
    'Advisor scan did not produce any successful result.': t(
      'common:advisor.errorNoSuccess',
      'Advisor scan did not produce any successful result.',
    ),
    'Please select at least one target drop item.': t(
      'common:advisor.errorNoDropItems',
      'Please select at least one target drop item.',
    ),
  };
  if (knownMap[raw]) {
    return knownMap[raw];
  }

  const quickMatch = raw.match(/^(\d+) target\(s\) failed during quick scan\. Showing successful results only\.$/);
  if (quickMatch) {
    return t(
      'common:advisor.errorPartialQuick',
      '{{count}} target(s) failed during quick scan. Showing successful results only.',
      {
        count: Number(quickMatch[1] || 0),
      },
    );
  }

  const refineMatch = raw.match(/^(\d+) target\(s\) failed during refine step\. Showing successful results only\.$/);
  if (refineMatch) {
    return t(
      'common:advisor.errorPartialRefine',
      '{{count}} target(s) failed during refine step. Showing successful results only.',
      {
        count: Number(refineMatch[1] || 0),
      },
    );
  }

  return raw;
});

const tableSummaryText = computed(() => {
  const rows = displayRows.value;
  if (rows.length === 0) {
    return t('common:advisor.tableEmpty', 'No ranked rows yet.');
  }
  const refinedCount = rows.filter((row) => row.isRefined).length;
  return t('common:advisor.tableSummary', '{rows} rows ranked, {refined} validated by refine step.', {
    rows: rows.length,
    refined: refinedCount,
  });
});

function getTopCardTitle(titleKey) {
  const titleMap = {
    best_overall: t('common:advisor.bestOverall', 'Best Overall'),
    best_profit: t('common:advisor.bestProfit', 'Best Profit'),
    best_xp: t('common:advisor.bestXp', 'Best XP'),
    safest: t('common:advisor.safest', 'Safest'),
    best_drops: t('common:advisor.bestDrops', 'Best Drops'),
  };
  return titleMap[titleKey] || titleKey;
}

function getTargetLabel(row) {
  const hrid = String(row?.targetHrid || '');
  const fallback = String(row?.targetName || hrid || '-');
  if (!hrid) {
    return fallback;
  }
  const defaultLabel = String(actionDetailMap?.[hrid]?.name || fallback);
  return getActionName(hrid, defaultLabel);
}

function getContentTypeLabel(row) {
  const category = String(row?.category || row?.targetType || 'zone');
  if (category === 'solo_zone') {
    return t('common:advisor.soloZone', 'Solo Zone');
  }
  if (category === 'group_zone') {
    return t('common:advisor.groupZone', 'Group Zone');
  }
  return t('common:advisor.soloZone', 'Solo Zone');
}

function getDifficultyLabel(row) {
  return t('common:advisor.difficultyTier', 'Tier {level}', { level: row?.difficultyTier ?? 0 });
}

function getReasonLabel(reason) {
  const reasonMap = {
    top_profit: t('common:advisor.reasonTopProfit', 'Top Profit'),
    top_xp: t('common:advisor.reasonTopXp', 'Top XP'),
    safest: t('common:advisor.reasonSafest', 'Safest'),
    top_pick: t('common:advisor.reasonTopPick', 'Top Pick'),
    top_drops: t('common:advisor.reasonTopDrops', 'Top Drops'),
    validated: t('common:advisor.reasonValidated', 'Validated'),
  };
  return reasonMap[reason] || reason;
}

// 「掉落/h」列的原生 title 提示：分物品明细（本地化名称 + 各自每小时数量，多行）。
function getDropsCellTitle(row) {
  const dropRatesByItem = row?.dropRatesByItem;
  if (!dropRatesByItem || typeof dropRatesByItem !== 'object' || Array.isArray(dropRatesByItem)) {
    return '';
  }
  return Object.entries(dropRatesByItem)
    .map(([itemHrid, rate]) => `${getItemName(itemHrid, itemHrid)}: ${formatDropRate(rate)}/h`)
    .join('\n');
}

// 「掉落物品」列：dropRatesByItem 固定含全部所选物品（无掉落记 0），
// 这里只取实际有掉落（rate > 0）的物品，按速率降序、hrid 升序渲染徽章。
function getDroppingItems(row) {
  const dropRatesByItem = row?.dropRatesByItem;
  if (!dropRatesByItem || typeof dropRatesByItem !== 'object' || Array.isArray(dropRatesByItem)) {
    return [];
  }
  const entries = [];
  for (const [itemHrid, rawRate] of Object.entries(dropRatesByItem)) {
    const rate = Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      continue;
    }
    entries.push({ itemHrid, rate });
  }
  return entries.sort((left, right) => right.rate - left.rate || left.itemHrid.localeCompare(right.itemHrid));
}

function getDroppingItemTitle(entry) {
  return `${getItemName(entry.itemHrid, entry.itemHrid)}: ${formatDropRate(entry.rate)}/h`;
}

function formatMetric(value, digits = 0) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(digits, 1) : 0,
  }).format(numeric);
}

// 「掉落/h」专用格式化：常规值保持 2 位小数；非零但 < 0.01 的极低速率改用
// 2 位有效数字（0.00043 → "0.00043"），避免 boss 专属/负掉率开门类物品
//（如高级魔法护符 ~0.0004/h）被格式化成 "0.0" 而无法与真 0 区分
//（2026-09-03 实测）。恰为 0 的行仍显示 "0.0"——那是真不掉，而非显示截断。
function formatDropRate(value) {
  const numeric = Number(value || 0);
  if (numeric > 0 && numeric < 0.01) {
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 }).format(numeric);
  }
  return formatMetric(numeric, 2);
}

function setPreset(preset) {
  // 扫描运行中禁止切换预设（按钮已禁用，此处兜底拦截）：流式结果按扫描开始
  // 时的快照排名，运行中变更会造成排名口径分裂与额外落盘。
  if (isRunning.value) {
    return;
  }
  applyStatus.value = '';
  // 切入铁牛模式时把权重草稿重置为上次已应用的合法权重，避免残留半输入状态。
  if (preset === ADVISOR_GOAL_PRESET_IRONCOW) {
    syncIroncowWeightDraft(simulator.advisor.ironcowWeights);
  }
  simulator.rerankAdvisorResults({
    goalPreset: preset,
    customWeights: preset === ADVISOR_GOAL_PRESET_CUSTOM ? customWeightDraft : simulator.advisor.customWeights,
  });
}

function applyCustomWeights() {
  // 扫描运行中禁止应用权重（输入已禁用，此处兜底拦截，理由同 setPreset）。
  if (isRunning.value) {
    return;
  }
  customWeightDraft.profitPerHour = Math.max(0, roundTo(customWeightDraft.profitPerHour, 2));
  customWeightDraft.xpPerHour = Math.max(0, roundTo(customWeightDraft.xpPerHour, 2));
  simulator.rerankAdvisorResults({
    goalPreset: ADVISOR_GOAL_PRESET_CUSTOM,
    customWeights: customWeightDraft,
  });
  syncCustomWeightDraft(simulator.advisor.customWeights);
}

// 铁牛权重草稿的统一清洗口径：roundTo(·,2) 后非负截断。实时校验
// （ironcowWeightSum / ironcowWeightSumValid / 权重和文本）与应用
// （applyIroncowWeights）共用该函数，保证「红字报错 ⇔ apply 拒绝」一一
// 对应（2026-09-03 修复：旧实现实时校验用原始和、apply 用取整和，
// 0.334/0.333/0.333 显示合法却静默不生效；0.351/0.35/0.301 红字却实际生效）。
function normalizeIroncowDraftWeight(value) {
  return Math.max(0, roundTo(value, 2));
}

// 铁牛权重：三者之和（同一取整口径）必须恰为 1（容差复用服务层导出常量），
// 否则不应用（不 rerank、不持久化），沿用上次合法权重；合法时 change 即
// 应用并随 rerank 持久化。拒绝时 ironcowWeightSumValid 必为 false，红字
// （role="alert"）即拒绝的可见反馈，apply 无需额外提示。
const ironcowWeightSum = computed(
  () =>
    normalizeIroncowDraftWeight(ironcowWeightDraft.dropsPerHour) +
    normalizeIroncowDraftWeight(ironcowWeightDraft.xpPerHour) +
    normalizeIroncowDraftWeight(ironcowWeightDraft.safety),
);
const ironcowWeightSumValid = computed(
  () => Math.abs(ironcowWeightSum.value - 1) <= ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE,
);
const ironcowWeightSumText = computed(() => ironcowWeightSum.value.toFixed(2));

function onIroncowWeightInput(key, event) {
  if (!isIroncowGoal.value) {
    return;
  }
  const value = Number(event.target?.value);
  ironcowWeightDraft[key] = Number.isFinite(value) ? value : 0;
}

function applyIroncowWeights() {
  // 扫描运行中禁止应用权重（输入已禁用，此处兜底拦截，理由同 setPreset）。
  if (isRunning.value) {
    return;
  }
  const dropsPerHour = normalizeIroncowDraftWeight(ironcowWeightDraft.dropsPerHour);
  const xpPerHour = normalizeIroncowDraftWeight(ironcowWeightDraft.xpPerHour);
  const safety = normalizeIroncowDraftWeight(ironcowWeightDraft.safety);

  if (Math.abs(dropsPerHour + xpPerHour + safety - 1) > ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE) {
    return;
  }

  simulator.rerankAdvisorResults({
    goalPreset: ADVISOR_GOAL_PRESET_IRONCOW,
    ironcowWeights: { dropsPerHour, xpPerHour, safety },
  });
  syncIroncowWeightDraft(simulator.advisor.ironcowWeights);
}

function onIroncowWeightChange() {
  if (isIroncowGoal.value) {
    applyIroncowWeights();
  }
}

async function runAdvisor() {
  applyStatus.value = '';
  resetAdvisorSort();
  simulator.updateAdvisorFilters({ ...filterDraft });
  await simulator.runAdvisorScan();
  syncFilterDraft(simulator.advisor.filters);
  syncCustomWeightDraft(simulator.advisor.customWeights);
  syncIroncowWeightDraft(simulator.advisor.ironcowWeights);
}

// 顶栏「开始推荐」经 store token 发起：页面负责提交 filterDraft、重置排序后再扫描。
watch(
  () => simulator.advisor.runRequestToken,
  () => {
    void runAdvisor();
  },
);

function applyToHome(row) {
  applyStatus.value = '';
  if (!simulator.applyAdvisorTarget(row)) {
    return;
  }
  applyStatus.value = t('common:advisor.applyStatus', 'Applied to Home. Redirecting...');
  setTimeout(() => {
    router.push('/home');
  }, 180);
}
</script>
