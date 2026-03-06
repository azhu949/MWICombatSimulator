<template>
  <section class="space-y-4">
    <div class="grid gap-4">
      <div class="panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.settings.generalTitle", "General") }}</h2>
        <div class="space-y-3 text-sm text-slate-200">
          <label class="badge flex items-center justify-between">
            <span>{{ t("common:vue.settings.enableHpMpVisualization", "Enable HP/MP visualization") }}</span>
            <input v-model="simulator.simulationSettings.enableHpMpVisualization" type="checkbox" />
          </label>
          <label class="badge flex items-center justify-between">
            <span>{{ t("common:vue.settings.defaultModeLabyrinth", "Default mode is Labyrinth") }}</span>
            <input v-model="labyrinthModeProxy" type="checkbox" />
          </label>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="action-button-muted" @click="resetPlayers">{{ t("common:vue.settings.resetPlayers", "Reset Players") }}</button>
        </div>
      </div>
    </div>

    <div class="panel space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:settingsPage.queueSettingsCardTitle", "Queue Scoring & Workers") }}</h3>
        <span class="text-xs" :class="queueSettingsStatusClass">{{ queueSettingsStatusText }}</span>
      </div>

      <div class="space-y-3">
        <p class="field-label">{{ t("common:settingsPage.weightsSectionTitle", "Score Weights (%)") }}</p>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="block">
            <span class="field-label">{{ t("common:settingsPage.weightPerformance", "Performance") }}</span>
            <input
              v-model.number="queueRuntimeDraft.performancePct"
              class="field-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
            />
          </label>
          <label class="block">
            <span class="field-label">{{ t("common:settingsPage.weightStability", "Stability") }}</span>
            <input
              v-model.number="queueRuntimeDraft.stabilityPct"
              class="field-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
            />
          </label>
          <label class="block">
            <span class="field-label">{{ t("common:settingsPage.weightCost", "Cost") }}</span>
            <input
              v-model.number="queueRuntimeDraft.costPct"
              class="field-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
            />
          </label>
        </div>
      </div>

      <div class="space-y-2">
        <label class="block max-w-xs">
          <span class="field-label">{{ t("common:settingsPage.parallelWorkerLimit", "Parallel Worker Limit") }}</span>
          <input
            v-model.number="queueRuntimeDraft.parallelWorkerLimit"
            class="field-input"
            type="number"
            min="1"
            :max="queueParallelWorkerHardMax"
            step="1"
          />
        </label>
        <p class="text-xs text-slate-400">{{ queueParallelWorkerHintText }}</p>
      </div>

      <div class="rounded-xl border border-white/10 bg-slate-900/40 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="font-heading text-sm uppercase tracking-[0.14em] text-slate-300">{{ t("common:queue.runQueueSettings", "Run Queue Settings") }}</h4>
          <span class="text-xs text-slate-400">{{ t("common:vue.queue.activePlayer", "Active player", { name: simulator.activePlayer.name }) }}</span>
        </div>

        <div class="mt-3 grid gap-3 lg:grid-cols-3">
          <div class="space-y-2">
            <label class="block">
              <span class="field-label">{{ t("common:queue.roundCount", "Rounds") }}</span>
              <select v-model="queueRunRoundPreset" class="field-select" @change="onQueueRunRoundPresetChanged">
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="30">30</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="custom">{{ t("common:queue.roundCustomOption", "Custom") }}</option>
              </select>
            </label>
            <label v-if="queueRunRoundPreset === 'custom'" class="block">
              <span class="field-label">{{ t("common:queue.roundCustom", "Custom Rounds") }}</span>
              <input
                v-model.number="queueRunDraft.rounds"
                type="number"
                min="1"
                max="200"
                step="1"
                class="field-input"
                @change="applyQueueRunSettings"
              />
            </label>
          </div>

          <label>
            <span class="field-label">{{ t("common:queue.executionMode", "Mode") }}</span>
            <select v-model="queueRunDraft.executionMode" class="field-select" @change="applyQueueRunSettings">
              <option value="parallel">{{ t("common:queue.modeParallel", "Parallel") }}</option>
              <option value="serial">{{ t("common:queue.modeSerial", "Serial") }}</option>
            </select>
          </label>

          <label>
            <span class="field-label">{{ t("common:vue.queue.medianBlend", "Median Blend (0-1)") }}</span>
            <div class="flex items-center gap-3">
              <input
                v-model.number="queueRunDraft.medianBlend"
                type="range"
                min="0"
                max="1"
                step="0.05"
                class="w-full accent-amber-300"
                @change="applyQueueRunSettings"
              />
              <input
                v-model.number="queueRunDraft.medianBlend"
                type="number"
                min="0"
                max="1"
                step="0.05"
                class="field-input w-24"
                @change="applyQueueRunSettings"
              />
            </div>
          </label>
        </div>

        <div class="mt-3 grid gap-3 lg:grid-cols-3">
          <label>
            <span class="field-label">{{ t("common:vue.queue.profitWeight", "Profit Weight") }}</span>
            <input
              v-model.number="queueRunDraft.weightProfit"
              type="number"
              min="0"
              step="0.1"
              class="field-input"
              @change="applyQueueRunSettings"
            />
          </label>
          <label>
            <span class="field-label">{{ t("common:vue.queue.xpWeight", "XP Weight") }}</span>
            <input
              v-model.number="queueRunDraft.weightXp"
              type="number"
              min="0"
              step="0.1"
              class="field-input"
              @change="applyQueueRunSettings"
            />
          </label>
          <label>
            <span class="field-label">{{ t("common:vue.queue.deathSafetyWeight", "Death Safety Weight") }}</span>
            <input
              v-model.number="queueRunDraft.weightDeathSafety"
              type="number"
              min="0"
              step="0.1"
              class="field-input"
              @change="applyQueueRunSettings"
            />
          </label>
        </div>

      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="action-button-primary" @click="saveQueueRuntimeSettings">
          {{ t("common:settingsPage.saveQueueSettings", "Save Queue Settings") }}
        </button>
        <button type="button" class="action-button-muted" @click="resetQueueRuntimeSettings">
          {{ t("common:settingsPage.resetQueueSettings", "Reset To Defaults") }}
        </button>
      </div>
    </div>

    <div class="panel space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:settingsPage.playerDataCardTitle", "Player Config Snapshot") }}</h3>
        <span class="text-xs" :class="playerSnapshotStatusClass">{{ playerSnapshotStatusText }}</span>
      </div>

      <p class="text-sm text-slate-300">{{ t("common:settingsPage.playerDataDescription", "Manually save/restore build data for 5 players only.") }}</p>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="action-button-primary" @click="savePlayerDataSnapshot">
          {{ t("common:settingsPage.savePlayerConfigs", "Save Player Configs") }}
        </button>
        <button type="button" class="action-button-muted" @click="loadPlayerDataSnapshot">
          {{ t("common:settingsPage.loadPlayerConfigs", "Load Player Configs") }}
        </button>
        <button type="button" class="action-button-danger" @click="deleteAllPlayerDataSnapshots">
          {{ t("common:settingsPage.deleteAllPlayerConfigs", "Delete All Snapshots") }}
        </button>
      </div>

      <div v-if="!hasPlayerSnapshotData" class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-4 text-sm text-slate-400">
        {{ t("common:settingsPage.playerSnapshotNoData", "No player snapshot data is currently saved.") }}
      </div>

      <div v-else class="space-y-2">
        <p class="text-xs text-slate-400">{{ playerSnapshotSavedAtLabel }}</p>

        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTablePlayer", "Player") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableZone", "Zone") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableDungeon", "Dungeon") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableDifficulty", "Difficulty") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableDuration", "Duration(h)") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableLabyrinth", "Labyrinth") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableRoomLevel", "Room Level") }}</th>
                <th class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableActions", "Actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in playerSnapshotRows" :key="row.playerId" class="border-b border-white/5 text-slate-200">
                <td class="px-2 py-2">Player {{ row.playerId }}</td>
                <td class="px-2 py-2">{{ row.hasSnapshot ? formatSnapshotActionName(row.zoneHrid, row.zone) : "-" }}</td>
                <td class="px-2 py-2">{{ row.hasSnapshot ? formatSnapshotActionName(row.dungeonHrid, row.dungeon) : "-" }}</td>
                <td class="px-2 py-2">{{ row.hasSnapshot ? row.difficulty : "-" }}</td>
                <td class="px-2 py-2">{{ row.hasSnapshot ? row.simulationTime : "-" }}</td>
                <td class="px-2 py-2">{{ row.hasSnapshot ? formatSnapshotMonsterName(row.labyrinthHrid, row.labyrinth) : "-" }}</td>
                <td class="px-2 py-2">{{ row.hasSnapshot ? row.roomLevel : "-" }}</td>
                <td class="px-2 py-2">
                  <button type="button"
                    class="action-button-muted"
                    :disabled="!row.hasSnapshot"
                    @click="deleteSinglePlayerDataSnapshot(row.playerId)"
                  >
                    {{ t("common:settingsPage.deleteSinglePlayerConfig", "Delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:vue.settings.priceSettingsTitle", "Price Settings") }}</h3>
        <span class="text-xs text-slate-400">{{ pricingStatusText }}</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="field-label">{{ t("common:vue.settings.consumablePricesLabel", "Consumable Prices") }}</span>
          <select v-model="consumablePriceModeProxy" class="field-select">
            <option value="ask">{{ t("common:vue.settings.modeAsk", "Ask (SO)") }}</option>
            <option value="bid">{{ t("common:vue.settings.modeBid", "Bid (BO)") }}</option>
          </select>
        </label>

        <label class="block">
          <span class="field-label">{{ t("common:vue.settings.dropPricesLabel", "Drop Prices") }}</span>
          <select v-model="dropPriceModeProxy" class="field-select">
            <option value="bid">{{ t("common:vue.settings.modeBid", "Bid (BO)") }}</option>
            <option value="ask">{{ t("common:vue.settings.modeAsk", "Ask (SO)") }}</option>
          </select>
        </label>
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="action-button-primary" :disabled="simulator.pricing.isLoading" @click="fetchMarketPrices">
          {{ simulator.pricing.isLoading ? t("common:vue.settings.loading", "Loading...") : t("common:vue.settings.fetchMarketPrices", "Get Prices") }}
        </button>
        <button type="button" class="action-button-muted" :disabled="simulator.pricing.isLoading" @click="resetPricesToVendor">
          {{ t("common:vue.settings.resetVendorPrices", "Reset Vendor Prices") }}
        </button>
        <button type="button" class="action-button-muted" @click="openEditPricesModal = true">
          {{ t("common:editPrices", "Edit Prices") }}
        </button>
      </div>

      <p class="text-xs text-slate-400">
        {{ t("common:vue.settings.priceHint", "Results and Queue profit metrics use these modes with vendor fallback.") }}
      </p>
    </div>

    <div
      v-if="message.text"
      class="rounded-xl border px-4 py-3 text-sm"
      :class="message.type === 'error' ? 'border-rose-300/40 bg-rose-500/10 text-rose-200' : 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100'"
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
          <span class="text-xs text-slate-400">
            {{ t("common:vue.settings.priceOverridesCount", "Overridden items", { count: priceOverrideCount }) }}
          </span>
          <button type="button" class="action-button-muted" :disabled="priceOverrideCount === 0" @click="resetAllPriceOverrides">
            {{ t("common:vue.settings.clearAllPriceOverrides", "Clear All Overrides") }}
          </button>
        </div>

        <div class="space-y-3">
          <input
            v-model.trim="priceSearchKeyword"
            class="field-input"
            type="text"
            :placeholder="t('common:vue.settings.priceSearchPlaceholder', 'Search by item name or HRID')"
          />

          <div class="overflow-x-auto">
            <div class="inline-flex min-w-full gap-2 rounded-xl border border-white/10 bg-slate-900/50 p-2">
              <button type="button"
               
                class="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                :class="selectedPriceCategory === '__all__'
                  ? 'bg-amber-300 text-slate-900'
                  : 'border border-white/15 text-slate-300 hover:bg-white/10'"
                @click="selectedPriceCategory = '__all__'"
              >
                {{ t("common:vue.settings.priceCategoryAll", "All Types") }} ({{ allPriceRows.length }})
              </button>
              <button type="button"
                v-for="option in priceCategoryOptions"
                :key="option.value"
               
                class="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                :class="selectedPriceCategory === option.value
                  ? 'bg-amber-300 text-slate-900'
                  : 'border border-white/15 text-slate-300 hover:bg-white/10'"
                @click="selectedPriceCategory = option.value"
              >
                {{ option.label }} ({{ option.count }})
              </button>
            </div>
          </div>
        </div>

        <div v-if="visiblePriceRows.length === 0" class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-4 text-sm text-slate-400">
          {{ t("common:vue.settings.priceNoMatches", "No items match current search.") }}
        </div>

        <div v-else class="max-h-[65vh] overflow-y-auto pr-1">
          <div class="overflow-x-auto rounded-xl border border-white/10">
            <table class="min-w-full text-sm">
              <thead class="sticky top-0 bg-slate-950">
                <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
                  <th class="px-2 py-2">{{ t("common:vue.settings.priceColumnItem", "Item") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.settings.priceColumnVendor", "Vendor") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.settings.priceColumnAsk", "Ask") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.settings.priceColumnBid", "Bid") }}</th>
                  <th class="px-2 py-2">{{ t("common:vue.common.actions", "Actions") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in visiblePriceRows" :key="row.hrid" class="border-b border-white/5 text-slate-200 align-top">
                  <td class="px-2 py-2" :title="row.hrid">
                    <div>{{ row.name }}</div>
                    <div v-if="selectedPriceCategory === '__all__'" class="text-xs text-slate-500">{{ row.categoryName }}</div>
                  </td>
                  <td class="px-2 py-2">{{ formatPriceForDisplay(row.vendor) }}</td>
                  <td class="px-2 py-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <input
                        class="field-input h-8 w-28"
                        type="number"
                        min="0"
                        step="0.01"
                        :value="formatPriceForInput(row.ask)"
                        @change="onPriceInputChange(row.hrid, 'ask', $event.target.value)"
                      />
                      <span v-if="row.askOverridden" class="badge text-[10px] uppercase tracking-[0.1em] text-amber-100">
                        {{ t("common:vue.settings.overrideTag", "Override") }}
                      </span>
                    </div>
                  </td>
                  <td class="px-2 py-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <input
                        class="field-input h-8 w-28"
                        type="number"
                        min="0"
                        step="0.01"
                        :value="formatPriceForInput(row.bid)"
                        @change="onPriceInputChange(row.hrid, 'bid', $event.target.value)"
                      />
                      <span v-if="row.bidOverridden" class="badge text-[10px] uppercase tracking-[0.1em] text-amber-100">
                        {{ t("common:vue.settings.overrideTag", "Override") }}
                      </span>
                    </div>
                  </td>
                  <td class="px-2 py-2">
                    <button type="button" class="action-button-muted" @click="resetItemPriceOverride(row.hrid)">
                      {{ t("common:vue.settings.resetRowPrice", "Reset") }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            {{ t("common:vue.settings.priceRowsVisible", "Showing items", { shown: visiblePriceRows.length, total: filteredPriceRows.length }) }}
          </span>
          <button type="button" v-if="hasMorePriceRows" class="action-button-muted" @click="loadMorePriceRows">
            {{ t("common:vue.settings.loadMorePriceRows", "Load More") }}
          </button>
        </div>
      </div>
    </BaseModal>

    <div class="space-y-4">
      <div class="panel space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:controls.equipmentSets", "Equipment Sets") }}</h3>
          <button type="button" class="action-button-muted" @click="refreshEquipmentSets">{{ t("common:vue.common.refresh", "Refresh") }}</button>
        </div>

        <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            v-model.trim="equipmentSetName"
            class="field-input"
            type="text"
            :placeholder="t('common:vue.settings.setNamePlaceholder', 'Set name, e.g. Fly AFK')"
          />
          <button type="button" class="action-button-primary" @click="saveEquipmentSet">{{ t("common:vue.settings.saveCurrent", "Save Current") }}</button>
        </div>

        <div v-if="equipmentSetEntries.length === 0" class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-4 text-sm text-slate-400">
          {{ t("common:vue.settings.noEquipmentSets", "No equipment sets yet.") }}
        </div>

        <div v-else class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
                <th class="px-2 py-2">{{ t("common:controls.name", "Name") }}</th>
                <th class="px-2 py-2">{{ t("common:vue.settings.savedAt", "Saved") }}</th>
                <th class="px-2 py-2">{{ t("common:vue.settings.queueChangeCount", "Queue Changes") }}</th>
                <th class="px-2 py-2">{{ t("common:vue.common.actions", "Actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in equipmentSetEntries" :key="entry.name" class="border-b border-white/5 text-slate-200">
                <td class="px-2 py-2">{{ entry.name }}</td>
                <td class="px-2 py-2">{{ formatTimestamp(entry.savedAt) }}</td>
                <td class="px-2 py-2">{{ entry.queueChangeCount }}</td>
                <td class="px-2 py-2">
                  <div class="flex flex-wrap gap-2">
                    <button type="button"
                      class="action-button-muted"
                      :disabled="entry.queueChangeCount <= 0"
                      @click="openImportQueueChangesConfirm(entry.name, entry.queueChangeCount, false)"
                    >
                      {{ t("common:vue.settings.importQueueChanges", "Import Queue Changes") }}
                    </button>
                    <button type="button"
                      class="action-button-primary"
                      :disabled="entry.queueChangeCount <= 0"
                      @click="openImportQueueChangesConfirm(entry.name, entry.queueChangeCount, true)"
                    >
                      {{ t("common:vue.settings.importQueueChangesAndResetBaseline", "Import + Reset Baseline") }}
                    </button>
                    <button type="button" class="action-button-danger" @click="deleteEquipmentSet(entry.name)">{{ t("common:controls.delete", "Delete") }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:patchNotes", "Patch Notes") }}</h3>
          <span class="text-xs uppercase tracking-[0.12em] text-slate-400">
            {{ t("common:vue.settings.versionsCount", "Versions", { count: patchNoteEntries.length }) }}
          </span>
        </div>

        <p class="text-xs text-slate-400">
          {{ t("common:vue.settings.patchNotesPreviewHint", "Showing patch notes preview.", { count: PATCH_NOTE_PREVIEW_COUNT }) }}
        </p>

        <div class="space-y-2">
          <DisclosurePanel
            v-for="(entry, index) in patchNotePreviewEntries"
            :key="entry.date"
            :title="entry.date"
            :default-open="index === 0"
          >
            <ul class="list-disc space-y-1 pl-5 text-sm text-slate-200">
              <li v-for="note in entry.notes" :key="note">{{ note }}</li>
            </ul>
          </DisclosurePanel>
        </div>

        <div class="flex justify-end">
          <button type="button" class="action-button-muted" @click="openPatchNotesModalList">
            {{ t("common:vue.settings.patchNotesViewMore", "View More") }}
          </button>
        </div>
      </div>
    </div>

    <BaseModal
      :open="openPatchNotesModal"
      :title="t('common:patchNotes', 'Patch Notes')"
      panel-class="max-w-[96vw] xl:max-w-[1100px]"
      @close="closePatchNotesModalList"
    >
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>{{ t("common:vue.settings.versionsCount", "Versions", { count: patchNoteEntries.length }) }}</span>
          <span>{{ t("common:vue.settings.patchNotesPageInfo", "Page info", {
            page: patchNotesPage,
            total: patchNotesTotalPages,
          }) }}</span>
        </div>

        <div class="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
          <DisclosurePanel
            v-for="(entry, index) in patchNotePageEntries"
            :key="`${entry.date}-${patchNotesPage}-${index}`"
            :title="entry.date"
            :default-open="index === 0"
          >
            <ul class="list-disc space-y-1 pl-5 text-sm text-slate-200">
              <li v-for="note in entry.notes" :key="note">{{ note }}</li>
            </ul>
          </DisclosurePanel>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <button type="button" class="action-button-muted" :disabled="patchNotesPage <= 1" @click="goToPatchNotesPrevPage">
            {{ t("common:vue.settings.patchNotesPrevPage", "Prev") }}
          </button>
          <button type="button" class="action-button-muted" :disabled="patchNotesPage >= patchNotesTotalPages" @click="goToPatchNotesNextPage">
            {{ t("common:vue.settings.patchNotesNextPage", "Next") }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openImportQueueChangesModal"
      :title="t('common:vue.settings.importQueueChangesConfirmTitle', 'Confirm Import Queue Changes')"
      panel-class="max-w-xl"
      @close="closeImportQueueChangesModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-200">
          {{ t(
            "common:vue.settings.importQueueChangesConfirmBody",
            "Import queue changes?",
            { name: pendingImportQueueSetName, count: pendingImportQueueChangeCount }
          ) }}
        </p>
        <div class="rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
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
          <button type="button" class="action-button-muted" @click="closeImportQueueChangesModal">
            {{ t("common:vue.settings.cancelImportQueueChanges", "Cancel") }}
          </button>
          <button type="button" class="action-button-primary" @click="confirmImportQueueChanges">
            {{ pendingImportAndResetBaseline
              ? t("common:vue.settings.confirmImportQueueChangesAndBaseline", "Confirm Import + Baseline")
              : t("common:vue.settings.confirmImportQueueChanges", "Confirm Import")
            }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openRestoreNavigateModal"
      :title="t('common:settingsPage.restoreCompleteTitle', 'Restore Complete')"
      panel-class="max-w-xl"
      @close="closeRestoreNavigateModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-200">
          {{ t("common:settingsPage.playerLoadSuccess", "Player configs restored", { time: restoredSnapshotSavedAtText }) }}
        </p>
        <p class="text-sm text-slate-300">
          {{ t("common:settingsPage.promptGoHomeAfterRestore", "Player configs restored. Go to Home page now?") }}
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="action-button-muted" @click="closeRestoreNavigateModal">
            {{ t("common:vue.common.cancel", "Cancel") }}
          </button>
          <button type="button" class="action-button-primary" @click="confirmGoHomeAfterRestore">
            {{ t("common:menu.home", "Home") }}
          </button>
        </div>
      </div>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import patchNote from "../../../patchNote.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { createEmptyPlayerConfig } from "../../services/playerMapper.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useI18nText } from "../composables/useI18nText.js";
import DisclosurePanel from "../components/DisclosurePanel.vue";
import BaseModal from "../components/BaseModal.vue";

const simulator = useSimulatorStore();
const { t } = useI18nText();
const router = useRouter();

const equipmentSetName = ref("");
const priceSearchKeyword = ref("");
const selectedPriceCategory = ref("__all__");
const openEditPricesModal = ref(false);
const openPatchNotesModal = ref(false);
const openImportQueueChangesModal = ref(false);
const openRestoreNavigateModal = ref(false);
const restoredSnapshotSavedAtText = ref("-");
const pendingImportQueueSetName = ref("");
const pendingImportQueueChangeCount = ref(0);
const pendingImportAndResetBaseline = ref(false);
const patchNotesPage = ref(1);

const PRICE_ROWS_STEP = 200;
const PATCH_NOTE_PREVIEW_COUNT = 5;
const PATCH_NOTE_PAGE_SIZE = 10;
const priceRowLimit = ref(PRICE_ROWS_STEP);

const message = ref({
  type: "ok",
  text: "",
});

const queueRuntimeDraft = reactive({
  performancePct: 40,
  stabilityPct: 20,
  costPct: 40,
  parallelWorkerLimit: 4,
});
const queueRunDraft = reactive({
  rounds: 30,
  medianBlend: 0.5,
  weightProfit: 0.5,
  weightXp: 0.3,
  weightDeathSafety: 0.2,
  executionMode: "parallel",
});
const queueRunRoundPreset = ref("30");

const queueSettingsStatus = ref({
  tone: "secondary",
  text: t("common:settingsPage.statusReady", "Ready."),
});

const playerSnapshotStatus = ref({
  tone: "secondary",
  text: t("common:settingsPage.statusReady", "Ready."),
});

const labyrinthModeProxy = computed({
  get() {
    return simulator.simulationSettings.mode === "labyrinth";
  },
  set(enabled) {
    simulator.setSimulationMode(enabled ? "labyrinth" : "zone");
  },
});

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

  const translationKey = `translation:itemCategoryNames.${hrid}`;
  const fromTranslation = t(translationKey, translationKey);
  if (fromTranslation !== translationKey) {
    return fromTranslation;
  }

  const commonKey = `itemCategoryNames.${hrid}`;
  const fromCommon = t(commonKey, commonKey);
  if (fromCommon !== commonKey) {
    return fromCommon;
  }

  return fallback || inferCategoryNameFromHrid(hrid);
}

function formatPriceItemName(itemHrid, fallbackName = "") {
  const hrid = String(itemHrid || "");
  if (!hrid) {
    return String(fallbackName || "").trim();
  }

  const translationKey = `translation:itemNames.${hrid}`;
  const fromTranslation = t(translationKey, translationKey);
  if (fromTranslation !== translationKey) {
    return fromTranslation;
  }

  const commonKey = `itemNames.${hrid}`;
  const fromCommon = t(commonKey, commonKey);
  if (fromCommon !== commonKey) {
    return fromCommon;
  }

  const fallback = String(fallbackName || "").trim();
  return fallback || inferItemNameFromHrid(hrid);
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const allPriceRows = computed(() => {
  const table = simulator.pricing.priceTable || {};
  const overrides = simulator.pricing.overrides || {};
  const rows = [];
  const seen = new Set();

  for (const item of Object.values(itemDetailMap)) {
    const hrid = String(item?.hrid || "");
    if (!hrid || seen.has(hrid)) {
      continue;
    }

    const categoryHrid = String(item?.categoryHrid || "/item_categories/unknown");
    seen.add(hrid);
    const entry = table[hrid] || {};
    const overrideEntry = overrides[hrid] || {};
    rows.push({
      hrid,
      categoryHrid,
      categoryName: formatPriceCategoryName(categoryHrid),
      name: formatPriceItemName(hrid, String(item?.name || "")),
      vendor: toFiniteNumber(entry.vendor, 0),
      ask: toFiniteNumber(entry.ask, -1),
      bid: toFiniteNumber(entry.bid, -1),
      askOverridden: hasOwn(overrideEntry, "ask"),
      bidOverridden: hasOwn(overrideEntry, "bid"),
    });
  }

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
    && (row.name.toLowerCase().includes(keyword) || row.hrid.toLowerCase().includes(keyword))
  ));
});

const visiblePriceRows = computed(() => filteredPriceRows.value.slice(0, priceRowLimit.value));
const hasMorePriceRows = computed(() => visiblePriceRows.value.length < filteredPriceRows.value.length);
const priceOverrideCount = computed(() => Object.keys(simulator.pricing.overrides || {}).length);

const equipmentSetEntries = computed(() => simulator.equipmentSetEntries);

const patchNoteEntries = computed(() => Object.entries(patchNote).map(([date, notes]) => ({
  date,
  notes: Array.isArray(notes) ? notes : [],
})));
const patchNotePreviewEntries = computed(() => patchNoteEntries.value.slice(0, PATCH_NOTE_PREVIEW_COUNT));
const patchNotesTotalPages = computed(() => Math.max(1, Math.ceil(patchNoteEntries.value.length / PATCH_NOTE_PAGE_SIZE)));
const patchNotePageEntries = computed(() => {
  const safePage = Math.min(patchNotesTotalPages.value, Math.max(1, Number(patchNotesPage.value || 1)));
  const start = (safePage - 1) * PATCH_NOTE_PAGE_SIZE;
  return patchNoteEntries.value.slice(start, start + PATCH_NOTE_PAGE_SIZE);
});

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
    return "text-emerald-300";
  }
  if (queueSettingsStatus.value.tone === "danger") {
    return "text-rose-300";
  }
  return "text-slate-400";
});

const queueSettingsStatusText = computed(() => queueSettingsStatus.value.text || "");

const playerSnapshotRows = computed(() => simulator.playerDataSnapshotRows || []);
const hasPlayerSnapshotData = computed(() => playerSnapshotRows.value.some((row) => row.hasSnapshot));

const playerSnapshotSavedAtLabel = computed(() => {
  const savedAt = Number(simulator.playerDataSnapshot?.savedAt || 0);
  const savedAtText = savedAt > 0 ? new Date(savedAt).toLocaleString() : "-";
  return t("common:settingsPage.playerSnapshotSavedAt", "", { time: savedAtText });
});

const playerSnapshotStatusClass = computed(() => {
  if (playerSnapshotStatus.value.tone === "success") {
    return "text-emerald-300";
  }
  if (playerSnapshotStatus.value.tone === "danger") {
    return "text-rose-300";
  }
  return "text-slate-400";
});

const playerSnapshotStatusText = computed(() => playerSnapshotStatus.value.text || "");

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
  const normalizedParallelLimit = Number(nextSettings?.parallelWorkerLimit || queueParallelWorkerRecommended.value);
  queueRuntimeDraft.parallelWorkerLimit = Math.min(
    queueParallelWorkerHardMax.value,
    Math.max(1, Math.floor(normalizedParallelLimit))
  );
}

function syncQueueRunDraft(nextSettings = simulator.activeQueueState?.settings) {
  const source = nextSettings || {};
  queueRunDraft.rounds = Number(source.rounds ?? 30);
  queueRunDraft.medianBlend = Number(source.medianBlend ?? 0.5);
  queueRunDraft.weightProfit = Number(source.weightProfit ?? 0.5);
  queueRunDraft.weightXp = Number(source.weightXp ?? 0.3);
  queueRunDraft.weightDeathSafety = Number(source.weightDeathSafety ?? 0.2);
  queueRunDraft.executionMode = String(source.executionMode || "parallel") === "serial" ? "serial" : "parallel";
  queueRunRoundPreset.value = ["5", "10", "20", "30", "50", "100", "200"].includes(String(queueRunDraft.rounds))
    ? String(queueRunDraft.rounds)
    : "custom";
}

function applyQueueRunSettings() {
  const normalized = simulator.updateActiveQueueSettings({
    rounds: queueRunDraft.rounds,
    medianBlend: queueRunDraft.medianBlend,
    weightProfit: queueRunDraft.weightProfit,
    weightXp: queueRunDraft.weightXp,
    weightDeathSafety: queueRunDraft.weightDeathSafety,
    executionMode: queueRunDraft.executionMode,
  });
  syncQueueRunDraft(normalized);
}

function onQueueRunRoundPresetChanged() {
  if (queueRunRoundPreset.value !== "custom") {
    queueRunDraft.rounds = Number(queueRunRoundPreset.value || 30);
    applyQueueRunSettings();
  }
}

function saveQueueRuntimeSettings() {
  const result = simulator.saveQueueRuntimeSettings({
    performancePct: queueRuntimeDraft.performancePct,
    stabilityPct: queueRuntimeDraft.stabilityPct,
    costPct: queueRuntimeDraft.costPct,
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

function resetQueueRuntimeSettings() {
  const result = simulator.resetQueueRuntimeSettings();
  if (!result.ok) {
    setQueueSettingsStatus(result.messageKey || "common:settingsPage.queueSaveErrorStorage", "danger");
    setMessage("error", queueSettingsStatus.value.text);
    return;
  }

  syncQueueRuntimeDraft(result.settings);
  setQueueSettingsStatus("common:settingsPage.queueResetSuccess", "success");
  setMessage("ok", queueSettingsStatus.value.text);
}

function setPlayerSnapshotStatus(messageKey, tone = "secondary", options = {}) {
  playerSnapshotStatus.value = {
    tone,
    text: t(messageKey, messageKey, options),
  };
}

function savePlayerDataSnapshot() {
  const result = simulator.savePlayerDataSnapshot();
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerSaveError", "danger");
    setMessage("error", playerSnapshotStatus.value.text);
    return;
  }

  setPlayerSnapshotStatus("common:settingsPage.playerSaveSuccess", "success");
  setMessage("ok", playerSnapshotStatus.value.text);
}

function loadPlayerDataSnapshot() {
  const result = simulator.loadPlayerDataSnapshot();
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerLoadInvalid", "danger");
    setMessage("error", playerSnapshotStatus.value.text);
    return;
  }

  const savedAtText = result.savedAt > 0 ? new Date(result.savedAt).toLocaleString() : "-";
  setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerLoadSuccess", "success", { time: savedAtText });
  setMessage("ok", playerSnapshotStatus.value.text);
  restoredSnapshotSavedAtText.value = savedAtText;
  openRestoreNavigateModal.value = true;
}

function closeRestoreNavigateModal() {
  openRestoreNavigateModal.value = false;
  restoredSnapshotSavedAtText.value = "-";
}

function confirmGoHomeAfterRestore() {
  openRestoreNavigateModal.value = false;
  restoredSnapshotSavedAtText.value = "-";
  router.push("/home");
}

function deleteSinglePlayerDataSnapshot(playerId) {
  const result = simulator.deleteSinglePlayerDataSnapshot(playerId);
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteError", "danger", result.messageOptions || {});
    setMessage("error", playerSnapshotStatus.value.text);
    return;
  }

  setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteSingleSuccess", "success", result.messageOptions || {});
  setMessage("ok", playerSnapshotStatus.value.text);
}

function deleteAllPlayerDataSnapshots() {
  const result = simulator.deleteAllPlayerDataSnapshots();
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteError", "danger");
    setMessage("error", playerSnapshotStatus.value.text);
    return;
  }

  setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteAllSuccess", "success");
  setMessage("ok", playerSnapshotStatus.value.text);
}

function formatTimestamp(timestamp) {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatSnapshotActionName(actionHrid, fallbackName = "-") {
  const hrid = String(actionHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }

  const translationKey = `translation:actionNames.${hrid}`;
  const fromTranslation = t(translationKey, translationKey);
  if (fromTranslation !== translationKey) {
    return fromTranslation;
  }

  const commonKey = `actionNames.${hrid}`;
  const fromCommon = t(commonKey, commonKey);
  if (fromCommon !== commonKey) {
    return fromCommon;
  }

  return fallbackName || hrid;
}

function formatSnapshotMonsterName(monsterHrid, fallbackName = "-") {
  const hrid = String(monsterHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }

  const translationKey = `translation:monsterNames.${hrid}`;
  const fromTranslation = t(translationKey, translationKey);
  if (fromTranslation !== translationKey) {
    return fromTranslation;
  }

  const commonKey = `monsterNames.${hrid}`;
  const fromCommon = t(commonKey, commonKey);
  if (fromCommon !== commonKey) {
    return fromCommon;
  }

  return fallbackName || hrid;
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

function openPatchNotesModalList() {
  patchNotesPage.value = 1;
  openPatchNotesModal.value = true;
}

function closePatchNotesModalList() {
  openPatchNotesModal.value = false;
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

function goToPatchNotesPrevPage() {
  patchNotesPage.value = Math.max(1, Number(patchNotesPage.value || 1) - 1);
}

function goToPatchNotesNextPage() {
  patchNotesPage.value = Math.min(patchNotesTotalPages.value, Number(patchNotesPage.value || 1) + 1);
}

function saveEquipmentSet() {
  const fallbackName = t("common:vue.settings.defaultSetName", "{{name}} Set", { name: simulator.activePlayer.name || "Player" });
  const finalName = String(equipmentSetName.value || fallbackName).trim();

  try {
    simulator.saveEquipmentSet(finalName);
    setMessage("ok", t("common:vue.settings.msgEquipmentSetSaved", "Equipment set saved: {{name}}", { name: finalName }));
    equipmentSetName.value = "";
  } catch (error) {
    setMessage("error", t("common:vue.settings.msgSaveEquipmentSetFailed", "Save equipment set failed: {{error}}", { error: error?.message || String(error) }));
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

function resetPlayers() {
  simulator.players = [1, 2, 3, 4, 5].map((id) => createEmptyPlayerConfig(id));
  simulator.clearPersistedPlayerAchievements();
  simulator.activePlayerId = "1";
  simulator.results.simResult = null;
  simulator.results.summaryRows = [];
  simulator.results.batchRows = [];
  ["1", "2", "3", "4", "5"].forEach((playerId) => {
    simulator.setImportedProfileState(playerId, false);
    const queueState = simulator.ensureQueueState(playerId);
    queueState.baseline = null;
    queueState.items = [];
    queueState.results = [];
    queueState.rawRuns = [];
    queueState.ranking = [];
    queueState.isRunning = false;
    queueState.progress = 0;
    queueState.error = "";
    queueState.lastRunAt = 0;
  });
  setMessage("ok", t("common:vue.settings.msgPlayersReset", "Players reset to defaults."));
}

</script>
