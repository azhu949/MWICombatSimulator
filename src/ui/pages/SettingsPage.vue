<template>
  <section class="space-y-4">
    <Tabs v-model="activeSettingsTab">
      <TabsList
        class="sticky z-20 w-full justify-start overflow-x-auto bg-background/95 p-1 backdrop-blur"
        style="top: var(--app-sticky-shell-height, 3rem)"
      >
        <TabsTrigger value="queue">{{ t("common:settingsPage.queueSettingsCardTitle", "Queue Configuration") }}</TabsTrigger>
        <TabsTrigger value="prices">{{ t("common:vue.settings.priceSettingsTitle", "Price Settings") }}</TabsTrigger>
        <TabsTrigger value="equipment">{{ t("common:controls.equipmentSets", "Equipment Sets") }}</TabsTrigger>
      </TabsList>

      <TabsContent value="queue">
      <div class="surface-panel space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-heading text-base font-semibold text-primary">{{ t("common:settingsPage.queueSettingsCardTitle", "Queue Configuration") }}</h3>
        <span class="text-xs" :class="queueSettingsStatusClass">{{ queueSettingsStatusText }}</span>
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <div class="rounded-md border border-border bg-muted/50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <h4 class="font-heading text-sm uppercase  text-primary">{{ t("common:settingsPage.queueScoringSectionTitle", "Scoring Model") }}</h4>
              <p class="text-xs text-muted-foreground">{{ t("common:settingsPage.queueScoringSectionHint", "Choose how final ranking weights the three major score components, and which cost metric Cost Score should read.") }}</p>
            </div>
            <span class="shrink-0 whitespace-nowrap rounded-md border border-success/40 bg-success/10 px-2 py-1 text-[11px] uppercase  text-success">{{ t("common:settingsPage.queueSectionSaveTag", "Save") }}</span>
          </div>

          <div class="mt-4 space-y-3">
            <div class="space-y-3">
              <p class="control-label">{{ t("common:settingsPage.weightsSectionTitle", "Score Weights (%)") }}</p>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="block">
                  <span class="control-label">{{ t("common:settingsPage.weightPerformance", "Performance") }}</span>
                  <input
                    v-model.number="queueRuntimeDraft.performancePct"
                    class="control-input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                  />
                </label>
                <label class="block">
                  <span class="control-label">{{ t("common:settingsPage.weightStability", "Stability") }}</span>
                  <input
                    v-model.number="queueRuntimeDraft.stabilityPct"
                    class="control-input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                  />
                </label>
                <label class="block">
                  <span class="control-label">{{ t("common:settingsPage.weightCost", "Cost") }}</span>
                  <input
                    v-model.number="queueRuntimeDraft.costPct"
                    class="control-input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                  />
                </label>
              </div>
            </div>

            <div class="space-y-2">
              <label class="block max-w-sm">
                <span class="control-label">{{ t("common:settingsPage.costScoreGoldMetricLabel", "Cost Score Metric") }}</span>
                <Select v-model="queueRuntimeDraft.costScoreGoldPerPointMode">
                  <SelectTrigger />
                  <SelectContent>
                    <SelectItem value="strict">{{ t("common:settingsPage.costScoreGoldMetricStrict", "Strict") }}</SelectItem>
                    <SelectItem value="composite">{{ t("common:settingsPage.costScoreGoldMetricComposite", "Composite") }}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <p class="text-xs text-muted-foreground">{{ t("common:settingsPage.costScoreGoldMetricHint", "Only affects which gold-per-0.01% metric is used in Cost Score. Both strict and composite columns remain visible in Multi-round Results.") }}</p>
            </div>

            <div class="space-y-3 border-t border-border pt-3">
              <p class="control-label">{{ t("common:settingsPage.performanceSubweightsTitle", "Performance Priorities") }}</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <label>
                  <span class="control-label">{{ t("common:vue.queue.profitWeight", "Profit Weight") }}</span>
                  <input
                    v-model.number="queueRunDraft.weightProfit"
                    type="number"
                    min="0"
                    :max="queueRunWeightProfitMax"
                    step="0.1"
                    class="control-input"
                    @change="applyQueueRunWeightInput('weightProfit')"
                  />
                </label>
                <label>
                  <span class="control-label">{{ t("common:vue.queue.xpWeight", "XP Weight") }}</span>
                  <input
                    v-model.number="queueRunDraft.weightXp"
                    type="number"
                    min="0"
                    :max="queueRunWeightXpMax"
                    step="0.1"
                    class="control-input"
                    @change="applyQueueRunWeightInput('weightXp')"
                  />
                </label>
              </div>
              <div class="space-y-1 text-xs text-muted-foreground">
                <p>{{ t("common:settingsPage.queueRunWeightHint", "Profit and XP weights are applied first. Any remaining weight is split evenly between DPS and Kills.") }}</p>
                <p>{{ t("common:settingsPage.queueRunWeightBreakdown", "", queueRunPerformanceBreakdownText) }}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-md border border-border bg-muted/50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <h4 class="font-heading text-sm uppercase  text-info">{{ t("common:settingsPage.queueExecutionSectionTitle", "Execution & Workers") }}</h4>
              <p class="text-xs text-muted-foreground">{{ t("common:settingsPage.queueExecutionSectionHint", "Control how queue simulations are dispatched, and which active player or locked party snapshot the current queue run follows.") }}</p>
            </div>
            <span class="shrink-0 whitespace-nowrap rounded-md border border-info/40 bg-info/10 px-2 py-1 text-[11px] uppercase  text-info">{{ t("common:settingsPage.queueSectionAutoTag", "Auto") }}</span>
          </div>

          <div class="mt-4 space-y-3">
            <div class="rounded-md border border-border bg-muted/40 p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="control-label">{{ t("common:queue.runQueueSettings", "Run Queue Settings") }}</p>
                <span class="text-xs text-muted-foreground">{{ t("common:vue.queue.activePlayer", "Active player", { name: simulator.activePlayer.name }) }}</span>
              </div>
              <p v-if="queuePartySummaryText" class="mt-2 text-xs text-muted-foreground">
                {{ t("common:queue.partyLockedMembers", "Locked party") }}:
                <span class="ml-1 text-foreground">{{ queuePartySummaryText }}</span>
              </p>
              <p v-if="queuePartyWarningText" class="mt-2 text-xs text-primary">{{ queuePartyWarningText }}</p>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <label>
                <span class="control-label">{{ t("common:queue.executionMode", "Mode") }}</span>
                <Select v-model="queueRunDraft.executionMode" @update:model-value="applyQueueRunSettings">
                  <SelectTrigger />
                  <SelectContent>
                    <SelectItem value="parallel">{{ t("common:queue.modeParallel", "Parallel") }}</SelectItem>
                    <SelectItem value="serial">{{ t("common:queue.modeSerial", "Serial") }}</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label class="block">
                <span class="control-label">{{ t("common:settingsPage.parallelWorkerLimit", "Parallel Worker Limit") }}</span>
                <input
                  v-model.number="queueRuntimeDraft.parallelWorkerLimit"
                  class="control-input"
                  type="number"
                  min="1"
                  :max="queueParallelWorkerHardMax"
                  step="1"
                />
              </label>
            </div>

            <p class="text-xs text-muted-foreground">{{ queueParallelWorkerHintText }}</p>
          </div>
        </div>

        <div class="rounded-md border border-border bg-muted/50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <h4 class="font-heading text-sm uppercase  text-info">{{ t("common:settingsPage.queueSamplingSectionTitle", "Sampling & Aggregation") }}</h4>
              <p class="text-xs text-muted-foreground">{{ t("common:settingsPage.queueSamplingSectionHint", "Tune round counts, baseline sampling, robust median blending, and the Profit/XP priorities used inside Performance Score.") }}</p>
            </div>
            <span class="shrink-0 whitespace-nowrap rounded-md border border-info/40 bg-info/10 px-2 py-1 text-[11px] uppercase  text-info">{{ t("common:settingsPage.queueSectionAutoTag", "Auto") }}</span>
          </div>

          <div class="mt-4 space-y-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-2">
                <label class="block">
                  <span class="control-label">{{ t("common:queue.roundCount", "Rounds") }}</span>
                  <Select :model-value="queueRunRoundPreset" @update:model-value="onQueueRunRoundPresetChanged">
                    <SelectTrigger :aria-label="t('common:queue.roundCount', 'Rounds')" />
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                      <SelectItem value="custom">{{ t("common:queue.roundCustomOption", "Custom") }}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label v-if="queueRunRoundPreset === 'custom'" class="block">
                  <span class="control-label">{{ t("common:queue.roundCustom", "Custom Rounds") }}</span>
                  <input
                    v-model.number="queueRunDraft.rounds"
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    class="control-input"
                    @change="applyQueueRunSettings"
                  />
                </label>
              </div>

              <div class="space-y-2">
                <label class="block">
                  <span class="control-label">{{ t("common:queue.baselineRoundCount", "Baseline Rounds") }}</span>
                  <Select :model-value="queueBaselineRoundPreset" @update:model-value="onQueueBaselineRoundPresetChanged">
                    <SelectTrigger :aria-label="t('common:queue.baselineRoundCount', 'Baseline Rounds')" />
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                      <SelectItem value="custom">{{ t("common:queue.roundCustomOption", "Custom") }}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label v-if="queueBaselineRoundPreset === 'custom'" class="block">
                  <span class="control-label">{{ t("common:queue.baselineRoundCustom", "Custom Baseline Rounds") }}</span>
                  <input
                    v-model.number="queueRunDraft.baselineRounds"
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    class="control-input"
                    @change="applyQueueRunSettings"
                  />
                </label>
              </div>
            </div>

            <label class="block">
              <span class="control-label">{{ t("common:vue.queue.medianBlend", "Median Blend (0-1)") }}</span>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="queueRunDraft.medianBlend"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  class="w-full accent-primary"
                  @change="applyQueueRunSettings"
                />
                <input
                  v-model.number="queueRunDraft.medianBlend"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  class="control-input w-24"
                  @change="applyQueueRunSettings"
                />
              </div>
              <div class="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>{{ t("common:settingsPage.medianBlendHint", "Lower values lean toward the robust average across all rounds. Higher values lean toward the median, which better represents a typical round when outliers appear.") }}</p>
                <p>{{ t("common:settingsPage.medianBlendBreakdown", "", queueMedianBlendExplanationText) }}</p>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="button-primary" @click="saveQueueRuntimeSettings">
          {{ t("common:settingsPage.saveQueueSettings", "Save Queue Settings") }}
        </button>
        <button type="button" class="button-secondary" @click="resetQueueSettings">
          {{ t("common:settingsPage.resetQueueSettings", "Reset To Defaults") }}
        </button>
      </div>
      </div>
      </TabsContent>


      <TabsContent value="prices">
      <div class="surface-panel space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-heading text-base font-semibold text-primary">{{ t("common:vue.settings.priceSettingsTitle", "Price Settings") }}</h3>
        <span class="text-xs text-muted-foreground">{{ pricingStatusText }}</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="control-label">{{ t("common:vue.settings.consumablePricesLabel", "Consumable Prices") }}</span>
          <Select v-model="consumablePriceModeProxy">
            <SelectTrigger :aria-label="t('common:vue.settings.consumablePricesLabel', 'Consumable Prices')" />
            <SelectContent>
              <SelectItem value="ask">{{ t("common:vue.settings.modeAsk", "Ask (SO)") }}</SelectItem>
              <SelectItem value="bid">{{ t("common:vue.settings.modeBid", "Bid (BO)") }}</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label class="block">
          <span class="control-label">{{ t("common:vue.settings.dropPricesLabel", "Drop Prices") }}</span>
          <Select v-model="dropPriceModeProxy">
            <SelectTrigger :aria-label="t('common:vue.settings.dropPricesLabel', 'Drop Prices')" />
            <SelectContent>
              <SelectItem value="bid">{{ t("common:vue.settings.modeBid", "Bid (BO)") }}</SelectItem>
              <SelectItem value="ask">{{ t("common:vue.settings.modeAsk", "Ask (SO)") }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="button-primary" :disabled="simulator.pricing.isLoading" @click="fetchMarketPrices">
          {{ simulator.pricing.isLoading ? t("common:vue.settings.loading", "Loading...") : t("common:vue.settings.fetchMarketPrices", "Get Prices") }}
        </button>
        <button type="button" class="button-secondary" :disabled="simulator.pricing.isLoading" @click="resetPricesToVendor">
          {{ t("common:vue.settings.resetVendorPrices", "Reset Vendor Prices") }}
        </button>
        <button type="button" class="button-secondary" @click="openEditPricesModal = true">
          {{ t("common:editPrices", "Edit Prices") }}
        </button>
      </div>

      <p class="text-xs text-muted-foreground">
        {{ t("common:vue.settings.priceHint", "Home results and Queue profit metrics use these modes with vendor fallback.") }}
      </p>
      </div>
      </TabsContent>

    <div
      v-if="message.text"
      class="rounded-md border px-4 py-3 text-sm"
      :class="message.type === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-success/40 bg-success/10 text-success'"
    >
      {{ message.text }}
    </div>

    <BaseModal
      :open="openEditPricesModal"
      :title="t('common:vue.settings.editPricesTitle', 'Edit Prices')"
      panel-class="max-w-[96vw] xl:max-w-[1200px]"
      @close="openEditPricesModal = false"
    >
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">
            {{ t("common:vue.settings.priceOverridesCount", "Overridden items", { count: priceOverrideCount }) }}
          </span>
          <button type="button" class="button-secondary" :disabled="priceOverrideCount === 0" @click="resetAllPriceOverrides">
            {{ t("common:vue.settings.clearAllPriceOverrides", "Clear All Overrides") }}
          </button>
        </div>

        <div class="space-y-3">
          <input
            v-model.trim="priceSearchKeyword"
            class="control-input"
            type="text"
            :placeholder="t('common:vue.settings.priceSearchPlaceholder', 'Search by item name or HRID')"
          />

          <div class="overflow-x-auto">
            <div class="inline-flex min-w-full gap-2 rounded-md border border-border bg-muted/50 p-2">
              <button type="button"
               
                class="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                :class="selectedPriceCategory === '__all__'
                  ? 'bg-primary/10 text-primary-foreground'
                  : 'border border-border text-foreground/85 hover:bg-muted/40'"
                @click="selectedPriceCategory = '__all__'"
              >
                {{ t("common:vue.settings.priceCategoryAll", "All Types") }} ({{ allPriceRows.length }})
              </button>
              <button type="button"
                v-for="option in priceCategoryOptions"
                :key="option.value"
               
                class="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                :class="selectedPriceCategory === option.value
                  ? 'bg-primary/10 text-primary-foreground'
                  : 'border border-border text-foreground/85 hover:bg-muted/40'"
                @click="selectedPriceCategory = option.value"
              >
                {{ option.label }} ({{ option.count }})
              </button>
            </div>
          </div>
        </div>

        <div v-if="visiblePriceRows.length === 0" class="rounded-md border border-border bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          {{ t("common:vue.settings.priceNoMatches", "No items match current search.") }}
        </div>

        <div v-else class="max-h-[65vh] overflow-y-auto pr-1">
          <div class="overflow-x-auto rounded-md border border-border">
            <Table class="min-w-full text-sm">
              <TableHeader class="sticky top-0 bg-muted/50">
                <TableRow class="border-b border-border text-left text-xs uppercase  text-muted-foreground">
                  <TableHead class="px-2 py-2">{{ t("common:vue.settings.priceColumnItem", "Item") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:vue.settings.priceColumnVendor", "Vendor") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:vue.settings.priceColumnAsk", "Ask") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:vue.settings.priceColumnBid", "Bid") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:vue.common.actions", "Actions") }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in visiblePriceRows" :key="row.hrid" class="border-b border-border text-foreground align-top">
                  <TableCell class="px-2 py-2" :title="row.hrid">
                    <div>{{ row.name }}</div>
                    <div v-if="selectedPriceCategory === '__all__'" class="text-xs text-muted-foreground">{{ row.categoryName }}</div>
                  </TableCell>
                  <TableCell class="px-2 py-2">{{ formatPriceForDisplay(row.vendor) }}</TableCell>
                  <TableCell class="px-2 py-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <input
                        class="control-input h-8 w-28"
                        type="number"
                        min="0"
                        step="0.01"
                        :value="formatPriceForInput(row.ask)"
                        @change="onPriceInputChange(row.hrid, 'ask', $event.target.value)"
                      />
                      <span v-if="row.askOverridden" class="status-chip text-[10px] uppercase  text-primary">
                        {{ t("common:vue.settings.overrideTag", "Override") }}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell class="px-2 py-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <input
                        class="control-input h-8 w-28"
                        type="number"
                        min="0"
                        step="0.01"
                        :value="formatPriceForInput(row.bid)"
                        @change="onPriceInputChange(row.hrid, 'bid', $event.target.value)"
                      />
                      <span v-if="row.bidOverridden" class="status-chip text-[10px] uppercase  text-primary">
                        {{ t("common:vue.settings.overrideTag", "Override") }}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell class="px-2 py-2">
                    <button type="button" class="button-secondary" @click="resetItemPriceOverride(row.hrid)">
                      {{ t("common:vue.settings.resetRowPrice", "Reset") }}
                    </button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {{ t("common:vue.settings.priceRowsVisible", "Showing items", { shown: visiblePriceRows.length, total: filteredPriceRows.length }) }}
          </span>
          <button type="button" v-if="hasMorePriceRows" class="button-secondary" @click="loadMorePriceRows">
            {{ t("common:vue.settings.loadMorePriceRows", "Load More") }}
          </button>
        </div>
      </div>
    </BaseModal>

      <TabsContent value="equipment">
        <div class="surface-panel space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-heading text-base font-semibold text-primary">{{ t("common:controls.equipmentSets", "Equipment Sets") }}</h3>
          <button type="button" class="button-secondary" @click="refreshEquipmentSets">{{ t("common:vue.common.refresh", "Refresh") }}</button>
        </div>

        <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            v-model.trim="equipmentSetName"
            class="control-input"
            type="text"
            :placeholder="t('common:vue.settings.setNamePlaceholder', 'Set name, e.g. Fly AFK')"
          />
          <button type="button" class="button-primary" @click="saveEquipmentSet">{{ t("common:vue.settings.saveCurrent", "Save Current") }}</button>
        </div>

        <div v-if="equipmentSetEntries.length === 0" class="rounded-md border border-border bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          {{ t("common:vue.settings.noEquipmentSets", "No equipment sets yet.") }}
        </div>

        <div v-else class="overflow-x-auto">
          <Table class="min-w-full text-sm">
            <TableHeader>
              <TableRow class="border-b border-border text-left text-xs uppercase  text-muted-foreground">
                <TableHead class="px-2 py-2">{{ t("common:controls.name", "Name") }}</TableHead>
                <TableHead class="px-2 py-2">{{ t("common:vue.settings.savedAt", "Saved") }}</TableHead>
                <TableHead class="px-2 py-2">{{ t("common:vue.settings.queueChangeCount", "Queue Changes") }}</TableHead>
                <TableHead class="px-2 py-2">{{ t("common:vue.common.actions", "Actions") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="entry in equipmentSetEntries" :key="entry.name" class="border-b border-border text-foreground">
                <TableCell class="px-2 py-2">{{ entry.name }}</TableCell>
                <TableCell class="px-2 py-2">{{ formatTimestamp(entry.savedAt) }}</TableCell>
                <TableCell class="px-2 py-2">{{ entry.queueChangeCount }}</TableCell>
                <TableCell class="px-2 py-2">
                  <div class="flex flex-wrap gap-2">
                    <button type="button"
                      class="button-secondary"
                      :disabled="entry.queueChangeCount <= 0"
                      @click="openImportQueueChangesConfirm(entry.name, entry.queueChangeCount, false)"
                    >
                      {{ t("common:vue.settings.importQueueChanges", "Import Queue Changes") }}
                    </button>
                    <button type="button"
                      class="button-primary"
                      :disabled="entry.queueChangeCount <= 0"
                      @click="openImportQueueChangesConfirm(entry.name, entry.queueChangeCount, true)"
                    >
                      {{ t("common:vue.settings.importQueueChangesAndResetBaseline", "Import + Reset Baseline") }}
                    </button>
                    <button type="button" class="button-danger" @click="deleteEquipmentSet(entry.name)">{{ t("common:controls.delete", "Delete") }}</button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        </div>
      </TabsContent>
    </Tabs>

    <BaseModal
      :open="openImportQueueChangesModal"
      :title="t('common:vue.settings.importQueueChangesConfirmTitle', 'Confirm Import Queue Changes')"
      panel-class="max-w-xl"
      @close="closeImportQueueChangesModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground">
          {{ t(
            "common:vue.settings.importQueueChangesConfirmBody",
            "Import queue changes?",
            { name: pendingImportQueueSetName, count: pendingImportQueueChangeCount }
          ) }}
        </p>
        <div class="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
          {{ pendingImportAndResetBaseline
            ? t(
              "common:vue.settings.importQueueChangesConfirmWarningWithBaseline",
              "This will overwrite current queue items and clear custom upgrade cost mappings, then run baseline simulation immediately."
            )
            : t(
              "common:vue.settings.importQueueChangesConfirmWarning",
              "This will overwrite current queue items and clear custom upgrade cost mappings. After import, please click 'Set Baseline' again."
            )
          }}
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="button-secondary" @click="closeImportQueueChangesModal">
            {{ t("common:vue.settings.cancelImportQueueChanges", "Cancel") }}
          </button>
          <button type="button" class="button-primary" @click="confirmImportQueueChanges">
            {{ pendingImportAndResetBaseline
              ? t("common:vue.settings.confirmImportQueueChangesAndBaseline", "Confirm Import + Baseline")
              : t("common:vue.settings.confirmImportQueueChanges", "Confirm Import")
            }}
          </button>
        </div>
      </div>
    </BaseModal>

  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { itemDetailIndex as itemDetailMap } from "../../shared/gameDataIndex.js";
import {
  constrainEditedQueuePerformanceWeights,
  resolveQueuePerformanceSubweights,
} from "../../shared/queuePerformanceWeights.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useGameDataText } from "../composables/useGameDataText.js";
import { useI18nText } from "../composables/useI18nText.js";
import { buildStaticPriceCatalog } from "../pageOptimizationHelpers.js";
import BaseModal from "../components/BaseModal.vue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs/index.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select/index.js";

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getItemCategoryName, getItemName, getOfficialGameText } = useGameDataText();

const equipmentSetName = ref("");
const activeSettingsTab = ref("queue");
const priceSearchKeyword = ref("");
const selectedPriceCategory = ref("__all__");
const openEditPricesModal = ref(false);
const openImportQueueChangesModal = ref(false);
const pendingImportQueueSetName = ref("");
const pendingImportQueueChangeCount = ref(0);
const pendingImportAndResetBaseline = ref(false);

const PRICE_ROWS_STEP = 200;
const priceRowLimit = ref(PRICE_ROWS_STEP);

const message = ref({
  type: "ok",
  text: "",
});

const DEFAULT_COST_SCORE_GOLD_METRIC_MODE = "strict";

function normalizeCostScoreGoldPerPointMode(value) {
  return value === "composite" ? "composite" : DEFAULT_COST_SCORE_GOLD_METRIC_MODE;
}

const queueRuntimeDraft = reactive({
  performancePct: 40,
  stabilityPct: 20,
  costPct: 40,
  costScoreGoldPerPointMode: DEFAULT_COST_SCORE_GOLD_METRIC_MODE,
  parallelWorkerLimit: 4,
});
const queueRunDraft = reactive({
  rounds: 30,
  baselineRounds: 1,
  medianBlend: 0.5,
  weightProfit: 0.5,
  weightXp: 0.3,
  executionMode: "parallel",
});
const queueRunRoundPreset = ref("30");
const queueBaselineRoundPreset = ref("1");

const queueSettingsStatus = ref({
  tone: "secondary",
  text: t("common:settingsPage.statusReady", "Ready."),
});
const queuePartyStatus = computed(() => simulator.activeQueuePartyStatus || { hasMismatch: false, messageKey: "", memberNames: [] });
const queuePartySummaryText = computed(() => (
  Array.isArray(queuePartyStatus.value?.memberNames) && queuePartyStatus.value.memberNames.length > 0
    ? queuePartyStatus.value.memberNames.join(" / ")
    : ""
));
const queuePartyWarningText = computed(() => (
  queuePartyStatus.value?.hasMismatch
    ? t(queuePartyStatus.value?.messageKey || "common:queue.partyChangedSinceBaseline", queuePartyStatus.value?.messageKey || "common:queue.partyChangedSinceBaseline")
    : ""
));

const consumablePriceModeProxy = computed({
  get() {
    return simulator.pricing.consumableMode;
  },
  set(mode) {
    simulator.setConsumablePriceMode(mode);
  },
});

const dropPriceModeProxy = computed({
  get() {
    return simulator.pricing.dropMode;
  },
  set(mode) {
    simulator.setDropPriceMode(mode);
  },
});

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function inferItemNameFromHrid(hrid) {
  const token = String(hrid || "").split("/").filter(Boolean).pop() || hrid;
  return token.replace(/_/g, " ");
}

function inferCategoryNameFromHrid(categoryHrid) {
  const token = String(categoryHrid || "").split("/").filter(Boolean).pop() || categoryHrid;
  return token.replace(/_/g, " ");
}

function formatPriceCategoryName(categoryHrid, fallbackName = "") {
  const hrid = String(categoryHrid || "");
  const fallback = String(fallbackName || "").trim();
  if (!hrid) {
    return fallback || t("common:vue.settings.priceCategoryUnknown", "Unknown Type");
  }

  return getItemCategoryName(hrid, fallback || inferCategoryNameFromHrid(hrid));
}

function formatPriceItemName(itemHrid, fallbackName = "") {
  const hrid = String(itemHrid || "");
  if (!hrid) {
    return String(fallbackName || "").trim();
  }

  const fallback = String(fallbackName || "").trim();
  return getItemName(hrid, fallback || inferItemNameFromHrid(hrid));
}

function formatOfficialItemName(itemHrid, targetLanguage) {
  const hrid = String(itemHrid || "");
  return getOfficialGameText(
    "itemNames",
    hrid,
    hrid,
    { language: targetLanguage },
  );
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const staticPriceCatalog = computed(() => buildStaticPriceCatalog(itemDetailMap, {
  formatPriceCategoryName,
  formatPriceItemName,
}));

const allPriceRows = computed(() => {
  const table = simulator.pricing.priceTable || {};
  const overrides = simulator.pricing.overrides || {};
  const rows = staticPriceCatalog.value.map((item) => {
    const entry = table[item.hrid] || {};
    const overrideEntry = overrides[item.hrid] || {};
    return {
      ...item,
      vendor: toFiniteNumber(entry.vendor, 0),
      ask: toFiniteNumber(entry.ask, -1),
      bid: toFiniteNumber(entry.bid, -1),
      askOverridden: hasOwn(overrideEntry, "ask"),
      bidOverridden: hasOwn(overrideEntry, "bid"),
    };
  });
  const seen = new Set(staticPriceCatalog.value.map((item) => item.hrid));

  for (const hrid of Object.keys(table)) {
    if (seen.has(hrid)) {
      continue;
    }

    const entry = table[hrid] || {};
    const overrideEntry = overrides[hrid] || {};
    const categoryHrid = "/item_categories/unknown";
    rows.push({
      hrid,
      categoryHrid,
      categoryName: formatPriceCategoryName(categoryHrid),
      name: formatPriceItemName(hrid, ""),
      vendor: toFiniteNumber(entry.vendor, 0),
      ask: toFiniteNumber(entry.ask, -1),
      bid: toFiniteNumber(entry.bid, -1),
      askOverridden: hasOwn(overrideEntry, "ask"),
      bidOverridden: hasOwn(overrideEntry, "bid"),
    });
  }

  rows.sort((a, b) => (
    a.categoryName.localeCompare(b.categoryName)
    || a.name.localeCompare(b.name)
    || a.hrid.localeCompare(b.hrid)
  ));
  return rows;
});

const priceRowMap = computed(() => Object.fromEntries(allPriceRows.value.map((row) => [row.hrid, row])));
const priceCategoryOptions = computed(() => {
  const map = new Map();
  for (const row of allPriceRows.value) {
    const key = String(row.categoryHrid || "/item_categories/unknown");
    if (!map.has(key)) {
      map.set(key, {
        value: key,
        label: row.categoryName || formatPriceCategoryName(key),
        count: 0,
      });
    }
    map.get(key).count += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
});

const filteredPriceRows = computed(() => {
  const keyword = String(priceSearchKeyword.value || "").trim().toLowerCase();
  const selectedCategory = String(selectedPriceCategory.value || "__all__");
  if (!keyword) {
    if (selectedCategory === "__all__") {
      return allPriceRows.value;
    }
    return allPriceRows.value.filter((row) => row.categoryHrid === selectedCategory);
  }

  return allPriceRows.value.filter((row) => (
    (selectedCategory === "__all__" || row.categoryHrid === selectedCategory)
    && (
      formatOfficialItemName(row.hrid, "zh").toLowerCase().includes(keyword)
      || formatOfficialItemName(row.hrid, "en").toLowerCase().includes(keyword)
      || row.hrid.toLowerCase().includes(keyword)
    )
  ));
});

const visiblePriceRows = computed(() => filteredPriceRows.value.slice(0, priceRowLimit.value));
const hasMorePriceRows = computed(() => visiblePriceRows.value.length < filteredPriceRows.value.length);
const priceOverrideCount = computed(() => Object.keys(simulator.pricing.overrides || {}).length);

const equipmentSetEntries = computed(() => simulator.equipmentSetEntries);

const pricingStatusText = computed(() => {
  if (simulator.pricing.isLoading) {
    return t("common:vue.settings.pricesLoading", "Loading market prices...");
  }
  if (simulator.pricing.lastFetchedAt > 0) {
    return t("common:vue.settings.pricesFetchedAt", "Last fetched: {{time}}", {
      time: new Date(simulator.pricing.lastFetchedAt).toLocaleString(),
    });
  }
  return t("common:vue.settings.pricesUsingVendor", "Using vendor fallback prices.");
});

const detectedHardwareCoreCount = computed(() => {
  const parsed = Number(simulator.detectedHardwareCoreCount);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
});

const queueParallelWorkerHardMax = computed(() => {
  const parsed = Number(simulator.queueParallelWorkerHardMax);
  return Number.isFinite(parsed) ? parsed : 64;
});

const queueParallelWorkerRecommended = computed(() => {
  const parsed = Number(simulator.queueParallelWorkerRecommended);
  return Number.isFinite(parsed) ? parsed : 4;
});

const queueParallelWorkerHintText = computed(() => {
  if (Number.isFinite(detectedHardwareCoreCount.value)) {
    return t("common:settingsPage.parallelWorkerHint", "", {
      cores: detectedHardwareCoreCount.value,
      recommended: queueParallelWorkerRecommended.value,
    });
  }
  return t("common:settingsPage.parallelWorkerHintUnknown", "", {
    recommended: queueParallelWorkerRecommended.value,
  });
});

const queueSettingsStatusClass = computed(() => {
  if (queueSettingsStatus.value.tone === "success") {
    return "text-success";
  }
  if (queueSettingsStatus.value.tone === "danger") {
    return "text-destructive";
  }
  return "text-muted-foreground";
});

const queueSettingsStatusText = computed(() => queueSettingsStatus.value.text || "");
const queueRunWeightProfitMax = computed(() => (
  Number(Math.max(0, 1 - Number(queueRunDraft.weightXp || 0)).toFixed(1))
));
const queueRunWeightXpMax = computed(() => (
  Number(Math.max(0, 1 - Number(queueRunDraft.weightProfit || 0)).toFixed(1))
));
const queueMedianBlendExplanationText = computed(() => {
  const medianWeight = Number((Math.max(0, Math.min(1, Number(queueRunDraft.medianBlend || 0))) * 100).toFixed(0));
  return {
    mean: Math.max(0, 100 - medianWeight),
    median: medianWeight,
  };
});
const queueRunPerformanceBreakdownText = computed(() => {
  const weights = resolveQueuePerformanceSubweights(queueRunDraft);
  return {
    profit: formatWeightPercent(weights.weightProfit),
    xp: formatWeightPercent(weights.weightXp),
    dps: formatWeightPercent(weights.weightDps),
    kills: formatWeightPercent(weights.weightKills),
  };
});

watch(priceSearchKeyword, () => {
  priceRowLimit.value = PRICE_ROWS_STEP;
});

watch(selectedPriceCategory, () => {
  priceRowLimit.value = PRICE_ROWS_STEP;
});

watch(
  () => simulator.queueRuntime,
  (nextSettings) => {
    syncQueueRuntimeDraft(nextSettings);
  },
  { immediate: true, deep: true },
);

watch(
  () => simulator.activeQueueState?.settings,
  (nextSettings) => {
    syncQueueRunDraft(nextSettings);
  },
  { immediate: true, deep: true },
);

function setMessage(type, text) {
  message.value = { type, text };
}

function setQueueSettingsStatus(messageKey, tone = "secondary", options = {}) {
  queueSettingsStatus.value = {
    tone,
    text: t(messageKey, messageKey, options),
  };
}

function formatWeightPercent(weight) {
  return Number((Number(weight || 0) * 100).toFixed(2));
}

function syncQueueRuntimeDraft(nextSettings = simulator.queueRuntime) {
  const finalWeights = nextSettings?.finalWeights || {};
  queueRuntimeDraft.performancePct = formatWeightPercent(finalWeights.performance);
  queueRuntimeDraft.stabilityPct = formatWeightPercent(finalWeights.stability);
  queueRuntimeDraft.costPct = formatWeightPercent(finalWeights.cost);
  queueRuntimeDraft.costScoreGoldPerPointMode = normalizeCostScoreGoldPerPointMode(nextSettings?.costScoreGoldPerPointMode);
  const normalizedParallelLimit = Number(nextSettings?.parallelWorkerLimit || queueParallelWorkerRecommended.value);
  queueRuntimeDraft.parallelWorkerLimit = Math.min(
    queueParallelWorkerHardMax.value,
    Math.max(1, Math.floor(normalizedParallelLimit))
  );
}

function syncQueueRunDraft(nextSettings = simulator.activeQueueState?.settings) {
  const source = nextSettings || {};
  queueRunDraft.rounds = Number(source.rounds ?? 30);
  queueRunDraft.baselineRounds = Number(source.baselineRounds ?? 1);
  queueRunDraft.medianBlend = Number(source.medianBlend ?? 0.5);
  queueRunDraft.weightProfit = Number(source.weightProfit ?? 0.5);
  queueRunDraft.weightXp = Number(source.weightXp ?? 0.3);
  queueRunDraft.executionMode = String(source.executionMode || "parallel") === "serial" ? "serial" : "parallel";
  queueRunRoundPreset.value = ["5", "10", "20", "30", "50", "100", "200"].includes(String(queueRunDraft.rounds))
    ? String(queueRunDraft.rounds)
    : "custom";
  queueBaselineRoundPreset.value = ["1", "5", "10", "20", "30", "50", "100", "200"].includes(String(queueRunDraft.baselineRounds))
    ? String(queueRunDraft.baselineRounds)
    : "custom";
}

function applyQueueRunSettings() {
  const normalized = simulator.updateActiveQueueSettings({
    rounds: queueRunDraft.rounds,
    baselineRounds: queueRunDraft.baselineRounds,
    medianBlend: queueRunDraft.medianBlend,
    weightProfit: queueRunDraft.weightProfit,
    weightXp: queueRunDraft.weightXp,
    executionMode: queueRunDraft.executionMode,
  });
  syncQueueRunDraft(normalized);
}

function applyQueueRunWeightInput(changedKey) {
  const constrainedWeights = constrainEditedQueuePerformanceWeights(queueRunDraft, changedKey);
  queueRunDraft.weightProfit = constrainedWeights.weightProfit;
  queueRunDraft.weightXp = constrainedWeights.weightXp;
  applyQueueRunSettings();
}

function onQueueRunRoundPresetChanged(value) {
  queueRunRoundPreset.value = String(value || "30");
  if (queueRunRoundPreset.value !== "custom") {
    queueRunDraft.rounds = Number(queueRunRoundPreset.value || 30);
    applyQueueRunSettings();
  }
}

function onQueueBaselineRoundPresetChanged(value) {
  queueBaselineRoundPreset.value = String(value || "1");
  if (queueBaselineRoundPreset.value !== "custom") {
    queueRunDraft.baselineRounds = Number(queueBaselineRoundPreset.value || 1);
    applyQueueRunSettings();
  }
}

function saveQueueRuntimeSettings() {
  const result = simulator.saveQueueRuntimeSettings({
    performancePct: queueRuntimeDraft.performancePct,
    stabilityPct: queueRuntimeDraft.stabilityPct,
    costPct: queueRuntimeDraft.costPct,
    costScoreGoldPerPointMode: queueRuntimeDraft.costScoreGoldPerPointMode,
    parallelWorkerLimit: queueRuntimeDraft.parallelWorkerLimit,
  });

  if (!result.ok) {
    setQueueSettingsStatus(result.messageKey || "common:settingsPage.queueSaveErrorStorage", "danger", result.messageOptions || {});
    setMessage("error", queueSettingsStatus.value.text);
    return;
  }

  syncQueueRuntimeDraft(result.settings);
  setQueueSettingsStatus("common:settingsPage.queueSaveSuccess", "success");
  setMessage("ok", queueSettingsStatus.value.text);
}

function resetQueueSettings() {
  const result = simulator.resetQueueSettingsToDefaults();
  if (!result.ok) {
    setQueueSettingsStatus(result.messageKey || "common:settingsPage.queueSaveErrorStorage", "danger");
    setMessage("error", queueSettingsStatus.value.text);
    return;
  }

  syncQueueRunDraft(result.queueSettings);
  syncQueueRuntimeDraft(result.runtimeSettings);
  setQueueSettingsStatus("common:settingsPage.queueResetSuccess", "success");
  setMessage("ok", queueSettingsStatus.value.text);
}

function formatTimestamp(timestamp) {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function refreshEquipmentSets() {
  simulator.refreshEquipmentSets();
  setMessage("ok", t("common:vue.settings.msgEquipmentSetsRefreshed", "Equipment sets refreshed from local storage."));
}

async function fetchMarketPrices() {
  try {
    await simulator.fetchMarketPrices();
    setMessage("ok", t("common:vue.settings.msgPricesFetched", "Market prices fetched successfully."));
  } catch (error) {
    setMessage("error", t("common:vue.settings.msgPricesFetchFailed", "Fetch market prices failed: {{error}}", { error: error?.message || String(error) }));
  }
}

function resetPricesToVendor() {
  simulator.resetPricesToVendorDefaults();
  setMessage("ok", t("common:vue.settings.msgPricesReset", "Reset to vendor fallback prices."));
}

function formatPriceForDisplay(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "-";
  }
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPriceForInput(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "";
  }
  return String(parsed);
}

function onPriceInputChange(itemHrid, side, rawValue) {
  if (side !== "ask" && side !== "bid") {
    return;
  }

  const normalizedText = String(rawValue ?? "").trim();
  const row = priceRowMap.value[itemHrid];
  const itemName = row?.name || itemHrid;
  const sideLabel = side === "ask"
    ? t("common:vue.settings.modeAsk", "Ask (SO)")
    : t("common:vue.settings.modeBid", "Bid (BO)");

  if (!normalizedText) {
    simulator.setPriceOverride(itemHrid, { [side]: null });
    setMessage("ok", t("common:vue.settings.msgPriceOverrideCleared", "{{side}} override cleared: {{item}}", { side: sideLabel, item: itemName }));
    return;
  }

  const parsed = Number(normalizedText);
  if (!Number.isFinite(parsed) || parsed < 0) {
    setMessage("error", t("common:vue.settings.msgInvalidPriceInput", "Invalid price input for {{item}}.", { item: itemName }));
    return;
  }

  simulator.setPriceOverride(itemHrid, { [side]: parsed });
  setMessage("ok", t("common:vue.settings.msgPriceOverrideSaved", "{{side}} price updated: {{item}} = {{value}}", {
    side: sideLabel,
    item: itemName,
    value: parsed,
  }));
}

function resetItemPriceOverride(itemHrid) {
  const row = priceRowMap.value[itemHrid];
  const itemName = row?.name || itemHrid;
  const ok = simulator.resetPriceOverride(itemHrid);
  if (!ok) {
    setMessage("ok", t("common:vue.settings.msgNoPriceOverrides", "No manual price overrides to clear."));
    return;
  }

  setMessage("ok", t("common:vue.settings.msgPriceOverrideReset", "Price overrides reset: {{item}}", { item: itemName }));
}

function resetAllPriceOverrides() {
  const ok = simulator.resetAllPriceOverrides();
  if (!ok) {
    setMessage("ok", t("common:vue.settings.msgNoPriceOverrides", "No manual price overrides to clear."));
    return;
  }

  setMessage("ok", t("common:vue.settings.msgAllPriceOverridesCleared", "All manual price overrides cleared."));
}

function loadMorePriceRows() {
  priceRowLimit.value += PRICE_ROWS_STEP;
}

function openImportQueueChangesConfirm(setName, queueChangeCount = 0, importAndResetBaseline = false) {
  pendingImportQueueSetName.value = String(setName || "").trim();
  pendingImportQueueChangeCount.value = Math.max(0, Math.floor(Number(queueChangeCount || 0)));
  pendingImportAndResetBaseline.value = importAndResetBaseline === true;

  if (!pendingImportQueueSetName.value || pendingImportQueueChangeCount.value <= 0) {
    setMessage("error", t(
      "common:vue.settings.msgQueueChangesImportEmpty",
      "No queue changes found in equipment set: {{name}}",
      { name: pendingImportQueueSetName.value || setName || "-" }
    ));
    return;
  }

  openImportQueueChangesModal.value = true;
}

function closeImportQueueChangesModal() {
  openImportQueueChangesModal.value = false;
  pendingImportQueueSetName.value = "";
  pendingImportQueueChangeCount.value = 0;
  pendingImportAndResetBaseline.value = false;
}

async function confirmImportQueueChanges() {
  const setName = pendingImportQueueSetName.value;
  const shouldResetBaseline = pendingImportAndResetBaseline.value;
  closeImportQueueChangesModal();
  if (!setName) {
    return;
  }
  if (shouldResetBaseline) {
    await importEquipmentSetQueueChangesAndResetBaseline(setName);
    return;
  }
  importEquipmentSetQueueChanges(setName);
}

function saveEquipmentSet() {
  const fallbackName = t("common:vue.settings.defaultSetName", "{{name}} Set", { name: simulator.activePlayer.name || "Player" });
  const finalName = String(equipmentSetName.value || fallbackName).trim();

  try {
    simulator.saveEquipmentSet(finalName);
    setMessage("ok", t("common:vue.settings.msgEquipmentSetSaved", "Equipment set saved: {{name}}", { name: finalName }));
    equipmentSetName.value = "";
  } catch (error) {
    const errorMessage = error?.message || String(error);
    setMessage("error", t("common:vue.settings.msgSaveEquipmentSetFailed", "Save equipment set failed: {{error}}", {
      error: t(errorMessage, errorMessage),
    }));
  }
}

function importEquipmentSetQueueChanges(setName) {
  const result = simulator.importEquipmentSetQueueChanges(setName);
  if (result.ok) {
    setMessage("ok", t(
      "common:vue.settings.msgQueueChangesImportedNeedBaseline",
      "Queue changes imported from {{name}}: {{count}} items. Please click 'Set Baseline' again on Queue page.",
      {
        name: setName,
        count: result.importedCount,
      }
    ));
    return;
  }

  const fallbackKey = result.messageKey || "common:vue.settings.msgQueueChangesImportFailed";
  setMessage("error", t(
    fallbackKey,
    fallbackKey === "common:vue.settings.msgQueueChangesImportEmpty"
      ? "No queue changes found in equipment set: {{name}}"
      : "Import queue changes failed: {{name}}",
    { name: setName }
  ));
}

async function importEquipmentSetQueueChangesAndResetBaseline(setName) {
  const result = simulator.importEquipmentSetQueueChanges(setName);
  if (!result.ok) {
    const fallbackKey = result.messageKey || "common:vue.settings.msgQueueChangesImportFailed";
    setMessage("error", t(
      fallbackKey,
      fallbackKey === "common:vue.settings.msgQueueChangesImportEmpty"
        ? "No queue changes found in equipment set: {{name}}"
        : "Import queue changes failed: {{name}}",
      { name: setName }
    ));
    return;
  }

  const queueState = simulator.activeQueueState;
  const preservedItems = Array.isArray(queueState?.items)
    ? queueState.items.slice()
    : [];

  try {
    await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    const currentQueueState = simulator.activeQueueState;
    currentQueueState.items = preservedItems;
    currentQueueState.results = [];
    currentQueueState.rawRuns = [];
    currentQueueState.ranking = [];
    currentQueueState.error = "";
    currentQueueState.progress = 0;
    currentQueueState.lastRunAt = 0;

    setMessage("ok", t(
      "common:vue.settings.msgQueueChangesImportedAndBaselineReset",
      "Queue changes imported from {{name}}: {{count}} items. Baseline has been reset.",
      {
        name: setName,
        count: result.importedCount,
      }
    ));
  } catch (error) {
    const errorTextRaw = error?.message || String(error);
    const errorText = t(errorTextRaw, errorTextRaw);
    setMessage("error", t(
      "common:vue.settings.msgQueueChangesImportedButBaselineResetFailed",
      "Queue changes imported from {{name}}: {{count}} items, but baseline reset failed: {{error}}",
      {
        name: setName,
        count: result.importedCount,
        error: errorText,
      }
    ));
  }
}

function deleteEquipmentSet(setName) {
  const ok = simulator.deleteEquipmentSet(setName);
  if (ok) {
    setMessage("ok", t("common:vue.settings.msgEquipmentSetDeleted", "Equipment set deleted: {{name}}", { name: setName }));
    return;
  }
  setMessage("error", t("common:vue.settings.msgEquipmentSetNotFound", "Equipment set not found: {{name}}", { name: setName }));
}

</script>
