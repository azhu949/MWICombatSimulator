<template>
  <section class="space-y-4">
    <HomeWorkspaceTabs
      :model-value="activeWorkspaceTab"
      :tabs="workspaceTabs"
      :aria-label="t('common:vue.home.workspaceTabsAria', 'Home workspace sections')"
      @update:model-value="requestWorkspaceTabChange"
    />

    <HomeSummaryPanel
      class="xl:hidden"
      :eyebrow="t('common:vue.home.workspaceEyebrow', 'Workspace')"
      :title="t('common:vue.home.workspaceTitle', 'Simulation Workspace')"
      :description="t('common:vue.home.workspaceDesc', 'Keep key metrics visible while you configure and run simulations.')"
      :status-label="workspaceStatusLabel"
      :status-text="workspaceStatusText"
      :status-tone="workspaceStatusTone"
      :is-running="simulator.runtime.isRunning"
      :progress-text="homeResultsProgressText"
      :progress-percent="homeResultsProgressPercent"
      :config-rows="summaryConfigRows"
      :metric-rows="summaryMetricRows"
      :build-rows="summaryBuildRows"
      :metrics-title="t('common:vue.home.workspaceMetricsTitle', 'Key Metrics')"
      :build-title="t('common:vue.home.workspaceBuildTitle', 'Build Snapshot')"
      :can-open-results="homeCanOpenResults"
      :results-button-label="fullResultsButtonLabel"
      @view-results="openHomeResultsPanel"
    />

    <div
      :class="[
        'grid gap-4',
        activeWorkspaceTab !== 'results' ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : '',
      ]"
    >
      <div class="space-y-4">
      <div class="grid gap-4 xl:grid-cols-12">
      <div v-if="activeWorkspaceTab === 'base'" class="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:col-span-12">
      <div class="surface-panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-primary">{{ t("common:vue.home.levelsTitle", "Levels") }}</h2>
        <div class="grid grid-cols-2 gap-3">
          <label class="col-span-2 block">
            <span class="control-label">{{ t("common:vue.home.averageCombatLevel", "Combat Level") }}</span>
            <input :value="activePlayerCombatLevelLabel" class="control-input" type="text" readonly />
          </label>
          <label v-for="key in levelKeys" :key="key" class="block">
            <span class="control-label">{{ levelLabelMap[key] }}</span>
            <input
              v-model.number="activePlayer.levels[key]"
              :class="['control-input', isLevelChanged(key) ? 'border-primary/40 bg-primary/10' : '']"
              min="1"
              max="400"
              type="number"
            />
          </label>
        </div>
        <div v-if="levelEtaCards.length > 0" class="mt-4 space-y-3">
          <article
            v-for="card in levelEtaCards"
            :key="card.skillKey"
            :class="['rounded-lg border p-3 text-[11px] text-foreground', card.borderClass, card.bgClass]"
          >
            <h3 class="mb-2 font-medium" :class="card.titleClass">{{ card.title }}</h3>
            <div v-if="card.details" class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
              <span class="text-muted-foreground">{{ t("common:vue.home.levelEtaTotalExperience", "Total XP") }}</span>
              <span class="text-right">{{ card.details.totalExperience }}</span>
              <span class="text-muted-foreground">{{ t("common:vue.home.levelEtaRequiredExperience", "XP Needed") }}</span>
              <span class="text-right">{{ card.details.requiredExperience }}</span>
              <span class="text-muted-foreground">{{ t("common:vue.home.levelEtaRequiredTime", "Time Needed") }}</span>
              <span class="text-right">{{ card.details.requiredTime }}</span>
              <span class="text-muted-foreground">{{ t("common:vue.home.levelEtaCompletionTime", "Completion Time") }}</span>
              <span class="text-right">{{ card.details.completionTime }}</span>
            </div>
            <p v-else class="text-xs leading-5" :class="card.messageClass">{{ card.message }}</p>
          </article>
        </div>
      </div>

      <div class="surface-panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-primary">{{ t("common:vue.home.simulationTitle", "Simulation") }}</h2>

        <div class="mb-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="control-label">{{ t("common:vue.home.mode", "Mode") }}</span>
            <Select v-model="simulationModeProxy">
              <SelectTrigger />
              <SelectContent>
                <SelectItem value="zone">{{ t("common:vue.home.modeZone", "Zone") }}</SelectItem>
                <SelectItem value="labyrinth">{{ getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth") }}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label class="block">
            <span class="control-label">{{ t("common:vue.home.runScope", "Run Scope") }}</span>
            <Select v-model="runScopeProxy">
              <SelectTrigger />
              <SelectContent>
              <SelectItem v-for="scope in simulator.availableRunScopes" :key="scope.value" :value="scope.value">
                {{ t(`common:vue.home.runScopeOptions.${scope.value}`, scope.label) }}
              </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <div class="mb-3 rounded-md border border-border bg-muted/50 p-3">
          <label class="block">
            <span class="control-label">{{ t("common:vue.home.profileSelectorLabel", "Character Profile") }}</span>
            <Select v-model="profileSelectorPlayerId">
              <SelectTrigger :aria-label="t('common:vue.home.profileSelectorLabel', 'Character Profile')" />
              <SelectContent>
              <SelectItem v-for="entry in profilePlayerOptions" :key="entry.id" :value="String(entry.id)">
                {{ entry.label }}
              </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p class="mt-2 text-xs text-muted-foreground">
            {{ t("common:vue.home.profileSelectorHint", "Baseline simulation requires imported profile data for current player.") }}
          </p>
          <p
            class="mt-1 text-xs"
            :class="activeProfileImported ? 'text-success' : 'text-primary'"
          >
            {{ activeProfileImported
              ? t("common:vue.home.profileStatusImported", "Imported")
              : t("common:vue.home.profileStatusNotImported", "Not imported") }}
          </p>
        </div>

        <div class="mb-3 grid gap-3 sm:grid-cols-2" v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'single'">
          <label class="block">
            <span class="control-label">{{ t("common:vue.home.combatType", "Combat Type") }}</span>
            <Select v-model="dungeonToggleProxy">
              <SelectTrigger :aria-label="t('common:vue.home.combatType', 'Combat Type')" />
              <SelectContent>
                <SelectItem value="zone">{{ t("common:vue.home.regularZone", "Regular Zone") }}</SelectItem>
                <SelectItem value="dungeon">{{ getOfficialGameText("shopCategoryNames", "/shop_categories/dungeon", "Dungeon") }}</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <div v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'single'" class="mb-3 grid gap-3 sm:grid-cols-2">
          <div class="block">
            <span class="control-label">{{ simulator.simulationSettings.useDungeon ? getOfficialGameText("shopCategoryNames", "/shop_categories/dungeon", "Dungeon") : t("common:vue.home.zone", "Zone") }}</span>
            <SearchCombobox
              v-model="selectedActionHrid"
              :options="currentActionComboboxOptions"
              :placeholder="t('common:vue.home.searchTarget', 'Search target')"
              :aria-label="simulator.simulationSettings.useDungeon ? getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon') : t('common:vue.home.zone', 'Zone')"
              :empty-label="t('common:vue.common.noResults', 'No results')"
              :open-label="t('common:vue.common.openOptions', 'Open options')"
              :more-results-label="t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')"
              :max-results="60"
            />
          </div>
          <label class="block">
            <span class="control-label">
              {{ t("common:vue.home.difficultyMax", "Difficulty", { max: Math.min(5, simulator.currentMaxDifficulty) }) }}
            </span>
            <Select v-model="simulator.simulationSettings.difficultyTier" @update:model-value="simulator.normalizeDifficulty()">
              <SelectTrigger />
              <SelectContent>
              <SelectItem
                v-for="option in difficultyTierOptions"
                :key="option.value"
                :value="option.value"
                :disabled="option.disabled"
              >
                {{ option.label }}
              </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <div v-else-if="simulator.simulationSettings.mode === 'labyrinth' && simulator.simulationSettings.runScope === 'single'" class="mb-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="control-label">{{ getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth") }}</span>
            <Select v-model="simulator.simulationSettings.labyrinthHrid">
              <SelectTrigger :aria-label="getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth')" />
              <SelectContent>
              <SelectItem v-for="monster in simulator.options.labyrinths" :key="monster.hrid" :value="monster.hrid">
                {{ formatMonsterName(monster.hrid, monster.name) }}
              </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="block">
            <span class="control-label">{{ t("common:roomLevel", "Room Level") }}</span>
            <input v-model.number="simulator.simulationSettings.roomLevel" class="control-input" type="number" min="20" max="220" />
          </label>
        </div>

        <p v-if="simulator.simulationSettings.runScope !== 'single'" class="mb-3 text-xs text-muted-foreground">
          {{ t("common:vue.home.batchHint", "Batch mode will run multiple targets and aggregate results in the Home results section.") }}
        </p>

        <div v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'all_group_zones'" class="mb-3 rounded-md border border-border bg-muted/50 p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="control-label mb-0">{{ t("common:simAllZones", "Sim All Zones") }}</p>
            <label class="status-chip flex items-center gap-2">
              <input
                :checked="allGroupZonesChecked"
                type="checkbox"
                @change="toggleAllGroupZones($event.target.checked)"
              />
              {{ t("common:selectAllOrNot", "Select / Deselect All") }}
            </label>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="zone in simulator.groupZoneOptions"
              :key="zone.hrid"
              class="status-chip flex items-center justify-between gap-2 text-foreground"
            >
              <span>{{ formatActionName(zone.hrid, zone.name) }}</span>
              <input
                :checked="selectedGroupZoneSet.has(zone.hrid)"
                type="checkbox"
                @change="simulator.toggleSelectedGroupZoneHrid(zone.hrid, $event.target.checked)"
              />
            </label>
          </div>
        </div>

        <div v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'all_solo_zones'" class="mb-3 rounded-md border border-border bg-muted/50 p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="control-label mb-0">{{ t("common:simAllSolos", "Sim All Solos") }}</p>
            <label class="status-chip flex items-center gap-2">
              <input
                :checked="allSoloZonesChecked"
                type="checkbox"
                @change="toggleAllSoloZones($event.target.checked)"
              />
              {{ t("common:selectAllOrNot", "Select / Deselect All") }}
            </label>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="zone in simulator.soloZoneOptions"
              :key="zone.hrid"
              class="status-chip flex items-center justify-between gap-2 text-foreground"
            >
              <span>{{ formatActionName(zone.hrid, zone.name) }}</span>
              <input
                :checked="selectedSoloZoneSet.has(zone.hrid)"
                type="checkbox"
                @change="simulator.toggleSelectedSoloZoneHrid(zone.hrid, $event.target.checked)"
              />
            </label>
          </div>
        </div>

        <div v-if="simulator.simulationSettings.mode === 'labyrinth'" class="mb-3 rounded-md border border-border bg-muted/50 p-3">
          <p class="control-label">{{ getOfficialGameText("labyrinthPanel", "crates", "Crates") }}</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="block">
              <span class="control-label">{{ getOfficialGameText("labyrinthPanel", "coffeeCrate", "Coffee Crate") }}</span>
              <Select
                :model-value="labyrinthCrateSelectValue('coffee')"
                @update:model-value="setLabyrinthCrateSelection('coffee', $event)"
              >
                <SelectTrigger :aria-label="getOfficialGameText('labyrinthPanel', 'coffeeCrate', 'Coffee Crate')" />
                <SelectContent>
                <SelectItem :value="EMPTY_SELECT_VALUE">{{ t("common:vue.common.none", "None") }}</SelectItem>
                <SelectItem v-for="item in simulator.options.labyrinthCrates.coffee" :key="item.hrid" :value="item.hrid">
                  {{ formatItemName(item.hrid, item.name) }}
                </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="block">
              <span class="control-label">{{ getOfficialGameText("labyrinthPanel", "foodCrate", "Food Crate") }}</span>
              <Select
                :model-value="labyrinthCrateSelectValue('food')"
                @update:model-value="setLabyrinthCrateSelection('food', $event)"
              >
                <SelectTrigger :aria-label="getOfficialGameText('labyrinthPanel', 'foodCrate', 'Food Crate')" />
                <SelectContent>
                <SelectItem :value="EMPTY_SELECT_VALUE">{{ t("common:vue.common.none", "None") }}</SelectItem>
                <SelectItem v-for="item in simulator.options.labyrinthCrates.food" :key="item.hrid" :value="item.hrid">
                  {{ formatItemName(item.hrid, item.name) }}
                </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label class="block">
              <span class="control-label">{{ getOfficialGameText("labyrinthPanel", "teaCrate", "Tea Crate") }}</span>
              <Select
                :model-value="labyrinthCrateSelectValue('tea')"
                @update:model-value="setLabyrinthCrateSelection('tea', $event)"
              >
                <SelectTrigger :aria-label="getOfficialGameText('labyrinthPanel', 'teaCrate', 'Tea Crate')" />
                <SelectContent>
                <SelectItem :value="EMPTY_SELECT_VALUE">{{ t("common:vue.common.none", "None") }}</SelectItem>
                <SelectItem v-for="item in simulator.options.labyrinthCrates.tea" :key="item.hrid" :value="item.hrid">
                  {{ formatItemName(item.hrid, item.name) }}
                </SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>

        <div class="mb-3 grid gap-3 sm:grid-cols-1">
          <label class="block max-w-sm">
            <span class="control-label">{{ t("common:vue.home.simulationHours", "Simulation Hours") }}</span>
            <input v-model.number="simulator.simulationSettings.simulationTimeHours" class="control-input" type="number" min="1" max="72" />
          </label>
        </div>

        <div class="mb-3 grid gap-3 sm:grid-cols-3">
          <label class="status-chip flex items-center justify-center gap-2 text-sm">
            <input v-model="simulator.simulationSettings.mooPass" type="checkbox" />
            {{ getOfficialGameText("mooPass", "mooPass", "MooPass") }}
          </label>
          <label class="status-chip flex items-center justify-center gap-2 text-sm">
            <input v-model="simulator.simulationSettings.comExpEnabled" type="checkbox" />
            {{ t("common:vue.home.communityExp", "Community EXP") }}
          </label>
          <label class="status-chip flex items-center justify-center gap-2 text-sm">
            <input v-model="simulator.simulationSettings.comDropEnabled" type="checkbox" />
            {{ t("common:vue.home.communityDrop", "Community Drop") }}
          </label>
        </div>

        <div class="mb-4 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="control-label">{{ t("common:vue.home.expLevel", "EXP Level") }}</span>
            <input v-model.number="simulator.simulationSettings.comExp" class="control-input" type="number" min="1" max="99" :disabled="!simulator.simulationSettings.comExpEnabled" />
          </label>
          <label class="block">
            <span class="control-label">{{ t("common:vue.home.dropLevel", "Drop Level") }}</span>
            <input v-model.number="simulator.simulationSettings.comDrop" class="control-input" type="number" min="1" max="99" :disabled="!simulator.simulationSettings.comDropEnabled" />
          </label>
        </div>

        <div class="flex flex-wrap gap-2" data-tm-import-anchor="simulator-home-actions">
          <button type="button" class="button-primary" :disabled="simulator.runtime.isRunning" @click="simulator.startSimulation()">
            {{ t("common:controls.startSimulation", "Start Simulation") }}
          </button>
          <button type="button" class="button-danger" :disabled="!simulator.runtime.isRunning" @click="simulator.stopSimulation()">
            {{ t("common:controls.stopSimulation", "Stop") }}
          </button>
          <button type="button" class="button-secondary" data-tm-import-reference="import-export" @click="openPlayerImportExportModal">
            {{ t("common:controls.importExport", "Import/Export") }}
          </button>
          <button type="button" class="button-secondary" @click="openHouseRoomsModal = true">
            {{ t("common:vue.home.houseRoomsButton", "House Rooms") }}
          </button>
          <button type="button" class="button-secondary" @click="openAchievementsModal = true">
            {{ getOfficialGameText("achievementsPanel", "achievements", "Achievements") }}
          </button>
          <button type="button" class="button-secondary" @click="openGuildBuffsModal = true">
            {{ t("common:vue.home.guildBuffsButton", "Guild Shrines") }}
          </button>
          <button type="button" class="button-secondary" @click="openExperimentalModal = true">
            {{ t("common:Experiment.ExperimentalFeatures", "Experimental Features") }}
          </button>
          <button type="button" class="button-secondary" @click="savePlayerDataSnapshotFromHome">
            {{ t("common:settingsPage.savePlayerConfigs", "Save Player Configs") }}
          </button>
          <button type="button" class="button-secondary" @click="loadPlayerDataSnapshotFromHome">
            {{ t("common:settingsPage.loadPlayerConfigs", "Load Player Configs") }}
          </button>
          <button type="button" class="button-secondary" @click="openPlayerSnapshotInfoModal = true">
            {{ t("common:settingsPage.viewPlayerSnapshotInfo", "View Snapshot Info") }}
          </button>
        </div>
        <p v-if="playerSnapshotStatusText" class="mt-2 text-xs" :class="playerSnapshotStatusClass">{{ playerSnapshotStatusText }}</p>
      </div>
      </div>

      <div v-if="activeWorkspaceTab === 'base'" class="space-y-4 xl:col-span-12">
        <div class="surface-panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-primary">{{ getOfficialGameText("equipmentPanel", "title", "Equipment") }}</h2>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="slot in equipmentSlots"
            :key="slot"
            :class="[
              'rounded-md border p-3',
              isEquipmentSlotChanged(slot) ? 'border-primary/40 bg-primary/10' : 'border-border',
            ]"
          >
            <label class="control-label">{{ equipmentLabelMap[slot] }}</label>
            <SearchCombobox
              v-model="activePlayer.equipment[slot].itemHrid"
              :options="equipmentComboboxOptionsBySlot[slot] || []"
              :placeholder="t('common:vue.common.searchOptions', 'Search options')"
              :aria-label="equipmentLabelMap[slot]"
              :empty-label="t('common:vue.common.noResults', 'No results')"
              :open-label="t('common:vue.common.openOptions', 'Open options')"
              :more-results-label="t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')"
              :max-results="60"
            />
            <div class="mt-2">
              <label class="control-label">{{ t("common:vue.home.enhancement", "Enhancement") }}</label>
              <input v-model.number="activePlayer.equipment[slot].enhancementLevel" class="control-input" type="number" min="0" max="30" />
            </div>
            <div class="mt-2">
              <p class="control-label">{{ t("common:vue.home.marketEnhancements", "Market Enhancements") }}</p>
              <div v-if="equipmentHintViewModel[slot]?.levels?.length > 0" class="mt-1 flex flex-wrap gap-1">
                <button type="button"
                  v-for="level in equipmentHintViewModel[slot].levels"
                  :key="`${slot}-enh-${level}`"
                 
                  class="rounded-md border px-2 py-0.5 text-xs transition"
                  :class="Number(activePlayer.equipment[slot].enhancementLevel || 0) === level
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-foreground/85 hover:border-primary/40 hover:text-primary'"
                  @click="applyMarketEnhancement(slot, level)"
                >
                  +{{ level }}
                </button>
              </div>
              <p v-else class="mt-1 text-xs text-muted-foreground">
                {{ t("common:vue.home.marketEnhancementsEmpty", "No market enhancement data.") }}
              </p>
            </div>
            <div v-if="equipmentHintViewModel[slot]?.costDraft" class="mt-2 rounded-lg border border-border bg-muted/50 p-2">
              <p class="text-xs text-foreground/85">
                {{ t("common:equipment.upgradeCost", "Upgrade Cost") }}:
                {{ formatUpgradeCost(equipmentHintViewModel[slot].costDraft.cost) }}
              </p>
              <p v-if="!equipmentHintViewModel[slot].costDraft.targetAskAvailable" class="mt-1 text-xs text-destructive">
                {{ t("common:vue.home.enhancementAskMissing", "No exact sell listing exists for this enhancement level, so it cannot be added to the queue.") }}
              </p>
              <p v-if="equipmentHintViewModel[slot].costDraft.baselineSaleZero" class="mt-1 text-xs text-warning">
                {{ t("common:vue.home.baselineSaleZero", "No exact quote exists for the baseline equipment. Its sale value is treated as 0.") }}
              </p>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>

    <div v-if="activeWorkspaceTab === 'base'" class="grid gap-4 lg:grid-cols-2">
        <div class="surface-panel">
          <h2 class="mb-3 font-heading text-lg font-semibold text-primary">{{ t("common:vue.home.foodDrinksTitle", "Food & Drinks") }}</h2>
            <div class="space-y-3">
              <div v-for="slotIndex in 3" :key="`food-${slotIndex}`" class="grid gap-2">
              <div :class="['rounded-md border p-2', isFoodSlotChanged(slotIndex - 1) ? 'border-primary/40 bg-primary/10' : 'border-border']">
                <label class="control-label">{{ t("common:vue.home.foodSlot", "Food", { index: slotIndex }) }}</label>
                <SearchCombobox
                  :model-value="activePlayer.food[slotIndex - 1]"
                  :options="foodComboboxOptions"
                  :placeholder="t('common:vue.common.searchOptions', 'Search options')"
                  :aria-label="t('common:vue.home.foodSlot', 'Food', { index: slotIndex })"
                  :empty-label="t('common:vue.common.noResults', 'No results')"
                  :open-label="t('common:vue.common.openOptions', 'Open options')"
                  :more-results-label="t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')"
                  :max-results="60"
                  @update:model-value="setFoodSelection(slotIndex - 1, $event)"
                />
                <InlineTriggerEditor
                  v-if="activePlayer.food[slotIndex - 1]"
                  :target-id="triggerTargetId('food', slotIndex - 1)"
                  :target-name="triggerTargetView('food', slotIndex - 1).label"
                  :state="triggerTargetView('food', slotIndex - 1).state"
                  :current-rules="triggerTargetView('food', slotIndex - 1).rules"
                  :default-rules="triggerTargetView('food', slotIndex - 1).defaultRules"
                  :draft="isTriggerEditorActive('food', slotIndex - 1) ? triggerEditor.draft : []"
                  :expanded="isTriggerEditorActive('food', slotIndex - 1)"
                  :max-rules="MAX_TRIGGER_COUNT"
                  :blocked-message="isTriggerEditorActive('food', slotIndex - 1) ? triggerEditor.blockedMessage : ''"
                  @request-toggle="requestTriggerEditor('food', slotIndex - 1)"
                  @update:draft="updateTriggerDraft"
                  @dirty-change="updateTriggerDirty('food', slotIndex - 1, $event)"
                  @save="saveInlineTriggerRules"
                  @cancel="cancelInlineTriggerEditor"
                />
              </div>
              </div>
            </div>
            <div class="mt-3 space-y-3">
              <div v-for="slotIndex in 3" :key="`drink-${slotIndex}`" class="grid gap-2">
              <div :class="['rounded-md border p-2', isDrinkSlotChanged(slotIndex - 1) ? 'border-primary/40 bg-primary/10' : 'border-border']">
                <label class="control-label">{{ t("common:vue.home.drinkSlot", "Drink", { index: slotIndex }) }}</label>
                <SearchCombobox
                  :model-value="activePlayer.drinks[slotIndex - 1]"
                  :options="drinkComboboxOptions"
                  :placeholder="t('common:vue.common.searchOptions', 'Search options')"
                  :aria-label="t('common:vue.home.drinkSlot', 'Drink', { index: slotIndex })"
                  :empty-label="t('common:vue.common.noResults', 'No results')"
                  :open-label="t('common:vue.common.openOptions', 'Open options')"
                  :more-results-label="t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')"
                  :max-results="60"
                  @update:model-value="setDrinkSelection(slotIndex - 1, $event)"
                />
                <InlineTriggerEditor
                  v-if="activePlayer.drinks[slotIndex - 1]"
                  :target-id="triggerTargetId('drink', slotIndex - 1)"
                  :target-name="triggerTargetView('drink', slotIndex - 1).label"
                  :state="triggerTargetView('drink', slotIndex - 1).state"
                  :current-rules="triggerTargetView('drink', slotIndex - 1).rules"
                  :default-rules="triggerTargetView('drink', slotIndex - 1).defaultRules"
                  :draft="isTriggerEditorActive('drink', slotIndex - 1) ? triggerEditor.draft : []"
                  :expanded="isTriggerEditorActive('drink', slotIndex - 1)"
                  :max-rules="MAX_TRIGGER_COUNT"
                  :blocked-message="isTriggerEditorActive('drink', slotIndex - 1) ? triggerEditor.blockedMessage : ''"
                  @request-toggle="requestTriggerEditor('drink', slotIndex - 1)"
                  @update:draft="updateTriggerDraft"
                  @dirty-change="updateTriggerDirty('drink', slotIndex - 1, $event)"
                  @save="saveInlineTriggerRules"
                  @cancel="cancelInlineTriggerEditor"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="surface-panel">
          <h2 class="mb-3 font-heading text-lg font-semibold text-primary">{{ getOfficialGameText("abilitiesPanel", "title", "Abilities") }}</h2>
          <div class="space-y-3">
            <div
              v-for="slotIndex in 5"
              :key="`ability-${slotIndex}`"
              :class="[
                'rounded-md border p-2',
                isAbilitySlotChanged(slotIndex - 1) ? 'border-primary/40 bg-primary/10' : 'border-border',
              ]"
            >
              <div class="grid gap-2 sm:grid-cols-[1fr_88px]">
                <div>
                  <label class="control-label">{{ getAbilitySlotLabel(slotIndex - 1) }}</label>
                  <SearchCombobox
                    :model-value="activePlayer.abilities[slotIndex - 1].abilityHrid"
                    :options="abilityComboboxOptions(slotIndex - 1)"
                    :placeholder="t('common:vue.common.searchOptions', 'Search options')"
                    :aria-label="getAbilitySlotLabel(slotIndex - 1)"
                    :empty-label="t('common:vue.common.noResults', 'No results')"
                    :open-label="t('common:vue.common.openOptions', 'Open options')"
                    :more-results-label="t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')"
                    :max-results="60"
                    @update:model-value="setAbilitySelection(slotIndex - 1, $event)"
                  />
                </div>
                <div>
                  <label class="control-label">{{ t("common:vue.home.levelShort", "Lv") }}</label>
                  <input v-model.number="activePlayer.abilities[slotIndex - 1].level" class="control-input" type="number" min="1" max="400" />
                </div>
              </div>
              <InlineTriggerEditor
                v-if="activePlayer.abilities[slotIndex - 1].abilityHrid"
                :target-id="triggerTargetId('ability', slotIndex - 1)"
                :target-name="triggerTargetView('ability', slotIndex - 1).label"
                :state="triggerTargetView('ability', slotIndex - 1).state"
                :current-rules="triggerTargetView('ability', slotIndex - 1).rules"
                :default-rules="triggerTargetView('ability', slotIndex - 1).defaultRules"
                :draft="isTriggerEditorActive('ability', slotIndex - 1) ? triggerEditor.draft : []"
                :expanded="isTriggerEditorActive('ability', slotIndex - 1)"
                :max-rules="MAX_TRIGGER_COUNT"
                :blocked-message="isTriggerEditorActive('ability', slotIndex - 1) ? triggerEditor.blockedMessage : ''"
                @request-toggle="requestTriggerEditor('ability', slotIndex - 1)"
                @update:draft="updateTriggerDraft"
                @dirty-change="updateTriggerDirty('ability', slotIndex - 1, $event)"
                @save="saveInlineTriggerRules"
                @cancel="cancelInlineTriggerEditor"
              />
              <div v-if="abilityUpgradeCostDrafts[slotIndex - 1]" class="mt-2 rounded-lg border border-border bg-muted/50 p-2">
                <p class="text-xs text-foreground/85">
                  {{ t("common:equipment.upgradeCost", "Upgrade Cost") }}:
                  {{ formatUpgradeCost(abilityUpgradeCostDrafts[slotIndex - 1].cost) }}
                </p>
                <input
                  class="control-input mt-1"
                  type="number"
                  min="0"
                  step="1"
                  :value="abilityUpgradeCostDrafts[slotIndex - 1].cost"
                  @change="onAbilityUpgradeCostChanged(slotIndex - 1, $event.target.value)"
                />
              </div>
            </div>
          </div>
        </div>
    </div>

    <div v-if="activeWorkspaceTab === 'advanced'" class="surface-panel space-y-4">
      <div>
        <h2 class="font-heading text-lg font-semibold text-primary">{{ t("common:vue.home.workspaceAdvancedTitle", "Battle Attributes") }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t("common:vue.home.workspaceAdvancedDesc", "Review the full derived combat attributes for the current build.") }}</p>
      </div>

      <div v-if="combatStatRows.length > 0" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="entry in combatStatRows" :key="entry.key" class="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
          <p class="text-xs uppercase  text-muted-foreground">{{ entry.label }}</p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <p class="text-foreground">{{ entry.value }}</p>
            <span
              v-for="highlight in entry.highlights"
              :key="highlight.key"
              class="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              {{ highlight.text }}
            </span>
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-muted-foreground">{{ t("common:multiRound.noData", "No data") }}</p>
    </div>

    <section v-if="activeWorkspaceTab === 'results'" ref="homeResultsSection" class="space-y-4">
      <div v-if="simulator.runtime.isRunning" class="surface-panel">
        <h2 class="font-heading text-lg font-semibold text-primary">{{ t("common:vue.home.homeResultsRunningTitle", "Simulation in progress") }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t("common:vue.home.homeResultsRunning", "Simulation is running. Results will appear here automatically.") }}</p>
        <p class="mt-3 text-sm font-medium text-foreground">{{ homeResultsProgressText }}</p>
      </div>
      <AsyncSimulationResultsView v-if="homeHasResults" />
      <div v-else-if="!simulator.runtime.isRunning" class="surface-panel border-dashed">
        <p class="text-sm text-foreground/85">{{ t("common:vue.home.homeResultsEmpty", "Your next simulation result will appear here as soon as it finishes.") }}</p>
      </div>
    </section>
      </div>

      <div
        v-if="activeWorkspaceTab !== 'results'"
        class="hidden xl:block xl:self-start xl:sticky"
        style="top: calc(var(--app-sticky-shell-height, 3rem) + 1rem)"
      >
        <HomeSummaryPanel
          eyebrow=""
          :title="t('common:vue.home.workspaceTitle', 'Simulation Workspace')"
          :description="t('common:vue.home.workspaceDesc', 'Keep key metrics visible while you configure and run simulations.')"
          :compact-header="true"
          :show-description="false"
          :status-label="workspaceStatusLabel"
          :status-text="workspaceStatusText"
          :show-status-card="false"
          :status-tone="workspaceStatusTone"
          :is-running="simulator.runtime.isRunning"
          :progress-text="homeResultsProgressText"
          :progress-percent="homeResultsProgressPercent"
          :config-rows="summaryConfigRows"
          :show-config-rows="false"
          :metric-rows="summaryMetricRows"
          :build-rows="summaryBuildRows"
          :metrics-title="t('common:vue.home.workspaceMetricsTitle', 'Key Metrics')"
          :build-title="t('common:vue.home.workspaceBuildTitle', 'Build Snapshot')"
          :can-open-results="homeCanOpenResults"
          :results-button-label="fullResultsButtonLabel"
          @view-results="openHomeResultsPanel"
        />
      </div>
    </div>

    <BaseModal
      :open="openHouseRoomsModal"
      :title="t('common:vue.home.houseRoomsTitle', 'House Rooms')"
      panel-class="max-w-[96vw] xl:max-w-[1280px]"
      @close="openHouseRoomsModal = false"
    >
      <div class="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        <div class="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div class="space-y-3">
            <div class="grid gap-2 sm:grid-cols-2">
              <label
                v-for="room in houseRoomOptions"
                :key="room.hrid"
                class="block rounded-md border border-border bg-muted/50 p-3 transition-colors"
                :class="houseRoomPreviewByHrid[room.hrid] ? 'border-primary/40 bg-primary/10' : ''"
              >
                <div class="mb-2 flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <span class="control-label">{{ getHouseRoomName(room.hrid, room.name) }}</span>
                    <p class="mt-1 text-xs text-muted-foreground">
                      {{ formatHouseRoomTransition(houseRoomBaselineLevelMap[room.hrid] ?? 0, activePlayer.houseRooms[room.hrid] ?? 0) }}
                    </p>
                  </div>
                  <span class="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    {{ formatUpgradeCost(houseRoomPreviewByHrid[room.hrid]?.subtotal ?? 0) }}
                  </span>
                </div>
                <input
                  v-model.number="activePlayer.houseRooms[room.hrid]"
                  class="control-input"
                  type="number"
                  min="0"
                  max="8"
                />
              </label>
            </div>
          </div>

          <div class="space-y-3">
            <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <article class="rounded-md border border-primary/40 bg-primary/10 p-4">
                <p class="text-[11px] uppercase  text-primary">
                  {{ t('common:vue.home.houseRoomsSummaryTotal', 'Total Cost') }}
                </p>
                <p class="mt-2 font-heading text-2xl text-primary">{{ formatUpgradeCost(houseRoomUpgradePreview.totals.totalCost) }}</p>
                <p class="mt-1 text-xs text-foreground/85">{{ formatCurrency(houseRoomUpgradePreview.totals.totalCost) }}</p>
              </article>
              <article class="rounded-md border border-success/40 bg-success/10 p-4">
                <p class="text-[11px] uppercase  text-success">
                  {{ t('common:vue.home.houseRoomsSummaryCoins', 'Coins Needed') }}
                </p>
                <p class="mt-2 font-heading text-2xl text-success">{{ formatUpgradeCost(houseRoomUpgradePreview.totals.coinCost) }}</p>
                <p class="mt-1 text-xs text-foreground/85">{{ formatCurrency(houseRoomUpgradePreview.totals.coinCost) }}</p>
              </article>
              <article class="rounded-md border border-info/40 bg-info/10 p-4">
                <p class="text-[11px] uppercase  text-info">
                  {{ t('common:vue.home.houseRoomsSummaryKinds', 'Material Types') }}
                </p>
                <p class="mt-2 font-heading text-2xl text-info">{{ formatInt(houseRoomMaterialKindCount) }}</p>
                <p class="mt-1 text-xs text-foreground/85">
                  {{ formatHouseRoomChangedRoomsText(houseRoomChangedRooms.length) }}
                </p>
              </article>
            </div>

            <div class="rounded-md border border-border bg-muted/50 p-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 class="font-heading text-sm font-semibold text-foreground">
                    {{ t('common:vue.home.houseRoomsChangedTitle', 'Upgrade Summary') }}
                  </h3>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {{ t('common:vue.home.houseRoomsChangedHint', 'Costs accumulate from the levels captured when this dialog opened.') }}
                  </p>
                </div>
                <span
                  v-if="houseRoomMissingPriceCount > 0"
                  class="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive"
                >
                  {{ formatHouseRoomMissingPriceHint(houseRoomMissingPriceCount) }}
                </span>
              </div>

              <div v-if="houseRoomChangedRooms.length === 0" class="rounded-md border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground">
                {{ t('common:vue.home.houseRoomsNoUpgrades', 'No room upgrades selected yet.') }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="room in houseRoomChangedRooms"
                  :key="room.roomHrid"
                  class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2.5"
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-foreground">{{ getHouseRoomName(room.roomHrid, houseRoomDetailMap?.[room.roomHrid]?.name || room.roomHrid) }}</p>
                    <p class="mt-1 text-xs text-muted-foreground">{{ formatHouseRoomTransition(room.fromLevel, room.toLevel) }}</p>
                  </div>
                  <span class="text-sm font-semibold text-primary">{{ formatUpgradeCost(room.subtotal) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-md border border-border bg-muted/50 p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 class="font-heading text-sm font-semibold text-foreground">
                {{ t('common:vue.home.houseRoomsMaterialsTitle', 'Material Breakdown') }}
              </h3>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('common:vue.home.houseRoomsMaterialsHint', 'Market value uses the current buy-side price with vendor fallback.') }}
              </p>
            </div>
            <span class="text-xs text-muted-foreground">{{ formatInt(houseRoomUpgradePreview.materials.length) }}</span>
          </div>

          <div v-if="houseRoomUpgradePreview.materials.length === 0" class="rounded-md border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground">
            {{ t('common:vue.home.houseRoomsNoUpgrades', 'No room upgrades selected yet.') }}
          </div>
          <div v-else class="overflow-x-auto">
            <Table class="min-w-full table-auto text-left text-sm text-foreground">
              <TableHeader>
                <TableRow class="border-b border-border text-xs uppercase  text-muted-foreground">
                  <TableHead class="px-2 py-2">{{ t('common:vue.home.houseRoomsMaterialName', 'Material') }}</TableHead>
                  <TableHead class="px-2 py-2 text-right">{{ t('common:vue.home.houseRoomsMaterialCount', 'Quantity') }}</TableHead>
                  <TableHead class="px-2 py-2 text-right">{{ t('common:vue.home.houseRoomsMaterialUnitPrice', 'Unit Price') }}</TableHead>
                  <TableHead class="px-2 py-2 text-right">{{ t('common:vue.home.houseRoomsMaterialSubtotal', 'Subtotal') }}</TableHead>
                  <TableHead class="px-2 py-2 text-right">{{ t('common:vue.home.houseRoomsMaterialStatus', 'Status') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="material in houseRoomUpgradePreview.materials"
                  :key="material.itemHrid"
                  class="border-b border-border last:border-b-0"
                >
                  <TableCell class="px-2 py-2">{{ formatItemName(material.itemHrid) }}</TableCell>
                  <TableCell class="px-2 py-2 text-right">{{ formatInt(material.count) }}</TableCell>
                  <TableCell class="px-2 py-2 text-right">{{ material.priced ? formatCurrency(material.unitPrice) : '-' }}</TableCell>
                  <TableCell class="px-2 py-2 text-right">{{ material.priced ? formatCurrency(material.subtotal) : '-' }}</TableCell>
                  <TableCell class="px-2 py-2 text-right">
                    <span
                      class="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium"
                      :class="material.priced ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'"
                    >
                      {{ material.priced
                        ? t('common:vue.home.houseRoomsMaterialStatusReady', 'Priced')
                        : t('common:vue.home.houseRoomsMaterialStatusMissing', 'Missing price') }}
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openGuildBuffsModal"
      :title="t('common:vue.home.guildBuffsTitle', 'Guild Shrine Buffs')"
      panel-class="max-w-[94vw] lg:max-w-4xl"
      @close="openGuildBuffsModal = false"
    >
      <div class="mb-3 flex items-center justify-end">
        <button type="button" class="button-secondary" @click="clearGuildBuffLevels">
          {{ t("common:vue.home.clearAll", "Clear All") }}
        </button>
      </div>
      <div class="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
        <div
          v-for="option in guildBuffOptions"
          :key="option.hrid"
          class="grid gap-4 rounded-lg border border-border bg-muted/50 p-4 md:grid-cols-[minmax(0,1fr)_10rem] md:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-heading text-sm font-semibold text-foreground">
                {{ getGuildShrineName(option.shrineHrid, option.shrineName) }}
              </h3>
              <span class="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {{ getOfficialGameText("guildPanel", "combat", "Combat") }}
              </span>
            </div>
            <p class="mt-2 text-sm leading-6" :class="guildBuffLevel(option.hrid) > 0 ? 'text-success' : 'text-muted-foreground'">
              {{ formatGuildBuffEffects(option, guildBuffLevel(option.hrid)) }}
            </p>
          </div>
          <label class="block">
            <span class="control-label">{{ t("common:vue.home.guildBuffEffectiveLevel", "Effective Level") }}</span>
            <div class="flex items-center gap-2">
              <input
                class="control-input min-w-0"
                type="number"
                min="0"
                :max="option.maxLevel"
                :value="guildBuffLevel(option.hrid)"
                @input="setGuildBuffLevel(option.hrid, $event.target.value)"
              />
              <span class="shrink-0 text-xs text-muted-foreground">/ {{ option.maxLevel }}</span>
            </div>
          </label>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openAchievementsModal"
      :title="getOfficialGameText('achievementsPanel', 'achievements', 'Achievements')"
      panel-class="max-w-[96vw] xl:max-w-[1200px]"
      @close="openAchievementsModal = false"
    >
      <div class="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <DisclosurePanel
          v-for="section in achievementTierSections"
          :key="section.tierHrid"
          :title="`${section.tierName} (${section.checkedCount}/${section.totalCount})`"
        >
          <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-foreground/85">
            <span>{{ section.buffText }}</span>
            <button type="button" class="button-secondary" @click="setTierAchievements(section.tierHrid, true)">
              {{ t("common:vue.home.selectAll", "Select All") }}
            </button>
            <button type="button" class="button-secondary" @click="setTierAchievements(section.tierHrid, false)">
              {{ t("common:vue.home.clearAll", "Clear All") }}
            </button>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <label
              v-for="detail in section.details"
              :key="detail.hrid"
              class="status-chip flex items-start gap-2 text-sm text-foreground"
            >
              <span class="min-w-0 flex-1 leading-snug">{{ getAchievementName(detail.hrid, detail.name) }}</span>
              <input
                class="mt-0.5 shrink-0"
                :checked="Boolean(activePlayer.achievements?.[detail.hrid])"
                type="checkbox"
                @change="setAchievement(detail.hrid, $event.target.checked)"
              />
            </label>
          </div>
        </DisclosurePanel>
      </div>
    </BaseModal>

    <BaseModal
      :open="openPlayerImportModal"
      :title="t('common:controls.importExport', 'Import/Export')"
      panel-class="max-w-[96vw] xl:max-w-[1200px]"
      @close="closePlayerImportModal"
    >
      <div class="space-y-3">
        <div class="flex flex-col gap-3 rounded-md border border-success/40 bg-muted/50 p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <div class="space-y-1">
            <p class="font-heading text-sm font-semibold uppercase  text-success">
              {{ t("common:vue.settings.mainSiteImportScriptTitle", "Main-site Import Script") }}
            </p>
            <p class="text-sm text-foreground/85">
              {{ t("common:vue.settings.mainSiteImportScriptDescription", "Install the Tampermonkey helper to add a single main-site import button that imports the current character directly; when a team is detected, it only uses party members whose profiles you have opened and cached manually, skips missing members, and writes to Player 1..N (up to 5).") }}
            </p>
            <p v-if="!hasMainSiteImportScriptUrl" class="text-xs text-info">
              {{ t("common:vue.settings.mainSiteImportScriptPending", "Script link pending") }}
            </p>
          </div>

          <button
            type="button"
            class="button-tool shrink-0"
            :disabled="!hasMainSiteImportScriptUrl"
            @click="openMainSiteImportScript"
          >
            {{ t("common:vue.settings.installMainSiteImportScript", "Install Script") }}
          </button>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-border bg-muted/50 p-3 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-heading text-base font-semibold text-primary">{{ t("common:vue.settings.groupImportExportTitle", "Group Import/Export") }}</h3>
              <span class="status-chip">{{ t("common:vue.settings.modernJson", "Modern JSON") }}</span>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="button-primary" @click="handleGroupExport">{{ t("common:vue.settings.exportGroup", "Export Group") }}</button>
              <button type="button" class="button-secondary" @click="copyImportExportText(groupText)">{{ t("common:vue.common.copy", "Copy") }}</button>
              <button type="button" class="button-secondary" @click="downloadImportExportText('mwi-group-modern.json', groupText)">{{ t("common:vue.common.download", "Download") }}</button>
              <label class="button-secondary cursor-pointer">
                {{ t("common:vue.common.loadFile", "Load File") }}
                <input class="hidden" type="file" accept="application/json,.json,.txt" @change="onImportExportFileSelected($event, 'group')" />
              </label>
            </div>

            <textarea v-model="groupText" class="control-input min-h-[220px] font-mono text-xs" spellcheck="false"></textarea>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="button-primary" @click="handleGroupImport">{{ t("common:vue.settings.importGroup", "Import Group") }}</button>
              <button type="button" class="button-secondary" @click="groupText = ''">{{ t("common:vue.common.clear", "Clear") }}</button>
            </div>
          </div>

          <div class="rounded-md border border-border bg-muted/50 p-3 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-heading text-base font-semibold text-primary">{{ t("common:vue.settings.soloImportExportTitle", "Solo Import/Export") }}</h3>
              <div class="flex items-center gap-2">
                <Select v-model="soloTargetPlayerId">
                  <SelectTrigger class="max-w-[140px]" :aria-label="t('common:vue.settings.soloImportExportTitle', 'Solo Import/Export')" />
                  <SelectContent>
                    <SelectItem v-for="player in simulator.players" :key="player.id" :value="String(player.id)">{{ player.name }}</SelectItem>
                  </SelectContent>
                </Select>
                <span class="status-chip">{{ t("common:vue.settings.modernSolo", "Modern Solo") }}</span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="button-primary" @click="handleSoloExport">{{ t("common:vue.settings.exportSolo", "Export Solo") }}</button>
              <button type="button" class="button-secondary" @click="copyImportExportText(soloText)">{{ t("common:vue.common.copy", "Copy") }}</button>
              <button type="button" class="button-secondary" @click="downloadImportExportText(`mwi-solo-${soloTargetPlayerId}-modern.json`, soloText)">{{ t("common:vue.common.download", "Download") }}</button>
              <label class="button-secondary cursor-pointer">
                {{ t("common:vue.common.loadFile", "Load File") }}
                <input class="hidden" type="file" accept="application/json,.json,.txt" @change="onImportExportFileSelected($event, 'solo')" />
              </label>
            </div>

            <textarea v-model="soloText" class="control-input min-h-[220px] font-mono text-xs" spellcheck="false"></textarea>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="button-primary" @click="handleSoloImport">{{ t("common:vue.settings.importToPlayer", "Import To Player") }}</button>
              <button type="button" class="button-secondary" @click="soloText = ''">{{ t("common:vue.common.clear", "Clear") }}</button>
            </div>
          </div>
        </div>

        <p v-if="importExportStatusText" class="text-sm" :class="importExportStatusClass">{{ importExportStatusText }}</p>
      </div>
    </BaseModal>

    <BaseModal :open="openExperimentalModal" :title="t('common:Experiment.ExperimentalFeatures', 'Experimental Features')" @close="openExperimentalModal = false">
      <div class="space-y-3">
        <div class="rounded-md border border-border bg-muted/50 p-3">
          <label class="status-chip flex items-center justify-between gap-3 text-sm text-foreground">
            <span>{{ t("common:Experiment.enableHpMpVisualization", "Enable HP/MP Timeline Charts") }}</span>
            <input v-model="simulator.simulationSettings.enableHpMpVisualization" type="checkbox" />
          </label>
        </div>

        <div class="rounded-md border border-border bg-muted/50 p-3">
          <p class="control-label">{{ t("common:Experiment.batchSimFromJson", "Run batch simulations from JSON files") }}</p>
          <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              ref="experimentalFileInput"
              class="control-input"
              type="file"
              accept="application/json,.json,.txt"
              @change="onExperimentalFileSelected"
            />
            <button type="button" class="button-primary" :disabled="!experimentalFileReady || experimentalRunning" @click="runExperimentalBatch">
              {{ t("common:Experiment.uploadAndRun", "Upload & Run") }}
            </button>
            <button type="button" class="button-secondary" :disabled="!experimentalDownloadText" @click="downloadExperimentalResults">
              {{ t("common:Experiment.download", "Download Results") }}
            </button>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">{{ experimentalStatusText }}</p>
        </div>

        <div class="rounded-md border border-border bg-muted/50 p-3">
          <p class="control-label">{{ t("common:Experiment.dungeonStartWave", "Dungeon Start Wave") }}</p>
          <div class="flex items-center gap-3">
            <label class="status-chip flex items-center gap-2">
              <input v-model="experimentalDungeonStartWaveEnabled" type="checkbox" />
              {{ t("common:Experiment.dungeonStartWave", "Dungeon Start Wave") }}
            </label>
            <input
              v-model.number="experimentalDungeonStartWave"
              class="control-input max-w-[120px]"
              type="number"
              min="1"
              max="100"
              :disabled="!experimentalDungeonStartWaveEnabled"
            />
            <span class="text-xs text-muted-foreground">{{ t("common:Experiment.wave", "Wave") }}</span>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">{{ t("common:Experiment.dungeonStartWaveNotConnected", "Start wave is not connected to worker runtime yet.") }}</p>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openPlayerSnapshotInfoModal"
      :title="t('common:settingsPage.playerDataCardTitle', 'Player Config Snapshot')"
      panel-class="max-w-[96vw] xl:max-w-[1200px]"
      @close="openPlayerSnapshotInfoModal = false"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground/85">{{ t("common:settingsPage.playerDataDescription", "Manually save/restore build data for 5 players only.") }}</p>
        <p v-if="playerSnapshotStatusText" class="text-xs" :class="playerSnapshotStatusClass">{{ playerSnapshotStatusText }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="button-danger" @click="deleteAllPlayerDataSnapshotsFromHome">
            {{ t("common:settingsPage.deleteAllPlayerConfigs", "Delete All Snapshots") }}
          </button>
        </div>

        <div v-if="!hasPlayerSnapshotData" class="rounded-md border border-border bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          {{ t("common:settingsPage.playerSnapshotNoData", "No player snapshot data is currently saved.") }}
        </div>

        <div v-else class="space-y-2">
          <p class="text-xs text-muted-foreground">{{ playerSnapshotSavedAtLabel }}</p>

          <div class="overflow-x-auto">
            <Table class="min-w-full text-sm">
              <TableHeader>
                <TableRow class="border-b border-border text-left text-xs uppercase  text-muted-foreground">
                  <TableHead class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTablePlayer", "Player") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableZone", "Zone") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ getOfficialGameText("shopCategoryNames", "/shop_categories/dungeon", "Dungeon") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableDifficulty", "Difficulty") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableDuration", "Duration(h)") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableRoomLevel", "Room Level") }}</TableHead>
                  <TableHead class="px-2 py-2">{{ t("common:settingsPage.playerSnapshotTableActions", "Actions") }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in playerSnapshotRows" :key="row.playerId" class="border-b border-border text-foreground">
                  <TableCell class="px-2 py-2">Player {{ row.playerId }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.hasSnapshot ? formatActionName(row.zoneHrid, row.zone) : "-" }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.hasSnapshot ? formatActionName(row.dungeonHrid, row.dungeon) : "-" }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.hasSnapshot ? row.difficulty : "-" }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.hasSnapshot ? row.simulationTime : "-" }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.hasSnapshot ? formatMonsterName(row.labyrinthHrid, row.labyrinth) : "-" }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.hasSnapshot ? row.roomLevel : "-" }}</TableCell>
                  <TableCell class="px-2 py-2">
                    <button
                      type="button"
                      class="button-secondary"
                      :disabled="!row.hasSnapshot"
                      @click="deleteSinglePlayerDataSnapshotFromHome(row.playerId)"
                    >
                      {{ t("common:settingsPage.deleteSinglePlayerConfig", "Delete") }}
                    </button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import achievementDetailMap from "../../combatsimulator/data/achievementDetailMap.json";
import achievementTierMap from "../../combatsimulator/data/achievementTierDetailMap.json";
import combatStyleDetailMap from "../../combatsimulator/data/combatStyleDetailMap.json";
import damageTypeDetailMap from "../../combatsimulator/data/damageTypeDetailMap.json";
import {
  abilityDetailIndex as abilityDetailMap,
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from "../../shared/gameDataIndex.js";
import {
  MAX_TRIGGER_COUNT,
  buildTriggerChangeDescriptor,
  getDefaultTriggerDtosForHrid,
  getEffectiveTriggerState,
  sanitizeTriggerList,
} from "../../services/triggerMapper.js";
import {
  combatGuildBuffDetails,
  getGuildBuffMaxLevel,
  guildShrineDetailIndex,
  normalizeGuildBuffLevels,
} from "../../shared/guildBuffs.js";
import { applyTampermonkeyImportMessage } from "../../services/tampermonkeyImportBridge.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { buildCombatPreviewData } from "../../services/playerMapper.js";
import { calcCombatLevel, EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "../../shared/playerConfig.js";
import { buildNoRngProfitBreakdown, buildRandomProfitBreakdown } from "../../services/profitEstimator.js";
import { calculateSkillUpgradeEta } from "../../services/levelExperience.js";
import { createCombatPreviewPlayerConfig } from "../pageOptimizationHelpers.js";
import { useGameDataText } from "../composables/useGameDataText.js";
import { useI18nText } from "../composables/useI18nText.js";
import BaseModal from "../components/BaseModal.vue";
import DisclosurePanel from "../components/DisclosurePanel.vue";
import HomeSummaryPanel from "../components/home/HomeSummaryPanel.vue";
import HomeWorkspaceTabs from "../components/home/HomeWorkspaceTabs.vue";
import InlineTriggerEditor from "../components/home/InlineTriggerEditor.vue";
import { SearchCombobox } from "../components/ui/combobox/index.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select/index.js";

const simulator = useSimulatorStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nText();
const {
  getAbilityName,
  getActionName,
  getAchievementName,
  getAchievementTierName,
  getBuffTypeName,
  getCombatStatName,
  getEquipmentSlotName,
  getGuildShrineName,
  getHouseRoomName,
  getItemName,
  getMonsterName,
  getOfficialGameText,
  getSkillName,
} = useGameDataText();
const AsyncSimulationResultsView = defineAsyncComponent(() => import("../components/SimulationResultsView.vue"));
const TAMPERMONKEY_BRIDGE_CHANNEL = "mwi-tm-bridge";
const EMPTY_SELECT_VALUE = "__none__";
const MAIN_SITE_IMPORT_SCRIPT_URL = "https://greasyfork.org/zh-CN/scripts/568613-mwi-combat-simulator-%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5";
const hasMainSiteImportScriptUrl = MAIN_SITE_IMPORT_SCRIPT_URL.trim().length > 0;

const levelKeys = LEVEL_KEYS;
const equipmentSlots = EQUIPMENT_SLOT_KEYS;
const homeResultsSection = ref(null);
const activeWorkspaceTab = ref("base");
const homeHasResults = computed(() => (
  Boolean(simulator.results.simResult)
  || (Array.isArray(simulator.results.simResults) && simulator.results.simResults.length > 0)
  || (Array.isArray(simulator.results.summaryRows) && simulator.results.summaryRows.length > 0)
  || (Array.isArray(simulator.results.batchRows) && simulator.results.batchRows.length > 0)
));
const homeCanOpenResults = computed(() => Boolean(simulator.runtime.isRunning || homeHasResults.value));
const activeHomeResultRow = computed(() => simulator.activeResultRow || null);
const activeHomeResultPlayerHrid = computed(() => (
  simulator.results.activeResultPlayerHrid
  || `player${simulator.activePlayerId}`
));
const homeResultsProgressPercent = computed(() => {
  const progress = Number(simulator.runtime.progress || 0);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor(progress * 100)));
});
const homeResultsProgressText = computed(() => `${homeResultsProgressPercent.value}% | ${Number(simulator.runtime.elapsedSeconds || 0).toFixed(1)}s`);
const workspaceTabs = computed(() => ([
  {
    value: "base",
    label: t("common:vue.home.workspaceTabs.base", "Base Setup"),
    description: t("common:vue.home.workspaceTabs.baseDesc", "Player, target, run settings, equipment, consumables, abilities, and trigger entry points."),
  },
  {
    value: "advanced",
    label: t("common:vue.home.workspaceTabs.advanced", "Battle Attributes"),
    description: t("common:vue.home.workspaceTabs.advancedDesc", "Full derived combat attributes for the current build."),
  },
  {
    value: "results",
    label: t("common:vue.home.workspaceTabs.results", "Complete Results"),
    description: t("common:vue.home.workspaceTabs.resultsDesc", "Full tables, charts, and per-source breakdowns from the latest simulation."),
  },
]));
const currentRunScopeLabel = computed(() => {
  const currentScope = simulator.availableRunScopes.find((scope) => scope.value === simulator.simulationSettings.runScope);
  return t(`common:vue.home.runScopeOptions.${currentScope?.value || simulator.simulationSettings.runScope}`, currentScope?.label || simulator.simulationSettings.runScope || "-");
});
const currentModeLabel = computed(() => {
  if (simulator.simulationSettings.mode === "labyrinth") {
    return getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth");
  }
  if (simulator.simulationSettings.useDungeon) {
    return getOfficialGameText("shopCategoryNames", "/shop_categories/dungeon", "Dungeon");
  }
  return t("common:vue.home.modeZone", "Zone");
});
const currentTargetLabel = computed(() => {
  const settings = simulator.simulationSettings;
  if (settings.mode === "labyrinth" && settings.runScope === "single") {
    const selectedLabyrinth = simulator.options.labyrinths.find((entry) => entry.hrid === settings.labyrinthHrid);
    const labyrinthName = formatMonsterName(
      selectedLabyrinth?.hrid || settings.labyrinthHrid,
      selectedLabyrinth?.name || settings.labyrinthHrid || getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth"),
    );
    return `${labyrinthName} • ${t("common:roomLevel", "Room Level")} ${formatNumber(settings.roomLevel, 0)}`;
  }
  if (settings.mode === "zone" && settings.runScope === "single") {
    const selectedAction = simulator.currentActionOptions.find((entry) => entry.hrid === selectedActionHrid.value);
    return `${formatActionName(selectedActionHrid.value, selectedAction?.name || "")} • T${Number(settings.difficultyTier || 0)}`;
  }
  if (settings.mode === "zone" && settings.runScope === "all_group_zones") {
    return t("common:vue.home.workspaceTargets.groupZones", "{{count}} group zones selected", { count: selectedGroupZoneSet.value.size });
  }
  if (settings.mode === "zone" && settings.runScope === "all_solo_zones") {
    return t("common:vue.home.workspaceTargets.soloZones", "{{count}} solo zones selected", { count: selectedSoloZoneSet.value.size });
  }
  return currentRunScopeLabel.value;
});
const workspaceStatusTone = computed(() => {
  if (simulator.runtime.isRunning) {
    return "running";
  }
  if (homeHasResults.value) {
    return "ready";
  }
  return "idle";
});
const workspaceStatusLabel = computed(() => {
  if (simulator.runtime.isRunning) {
    return t("common:vue.home.homeResultsRunningTitle", "Simulation in progress");
  }
  if (homeHasResults.value) {
    return t("common:vue.home.workspaceStatusReady", "Results ready");
  }
  return t("common:vue.home.workspaceStatusIdle", "Ready to run");
});
const workspaceStatusText = computed(() => {
  if (simulator.runtime.isRunning) {
    return t("common:vue.home.workspaceStatusRunningDesc", "Progress and summary metrics stay visible while the simulation runs.");
  }
  if (homeHasResults.value) {
    return t("common:vue.home.workspaceStatusReadyDesc", "Latest results are ready. Open the full report whenever you want deeper detail.");
  }
  return t("common:vue.home.workspaceStatusIdleDesc", "Start a simulation to populate the workspace summary and results area.");
});
const summaryConfigRows = computed(() => ([
  {
    label: t("common:vue.home.workspaceSummary.player", "Active Player"),
    value: activePlayer.value?.name || `Player ${simulator.activePlayerId}`,
  },
  {
    label: t("common:vue.home.workspaceSummary.profile", "Profile"),
    value: activeProfileImported.value
      ? t("common:vue.home.profileStatusImported", "Imported")
      : t("common:vue.home.profileStatusNotImported", "Not imported"),
    tone: activeProfileImported.value ? "success" : "accent",
  },
  {
    label: t("common:vue.home.workspaceSummary.modeScope", "Mode / Scope"),
    value: `${currentModeLabel.value} • ${currentRunScopeLabel.value}`,
  },
  {
    label: t("common:vue.home.workspaceSummary.target", "Target"),
    value: currentTargetLabel.value,
  },
]));
const summaryMetricRows = computed(() => {
  const row = activeHomeResultRow.value;
  const hasDetailedBreakdown = Boolean(simulator.results.simResult);
  const randomBreakdown = hasDetailedBreakdown
    ? buildRandomProfitBreakdown(simulator.results.simResult, activeHomeResultPlayerHrid.value, {
      consumableMode: simulator.pricing.consumableMode,
      dropMode: simulator.pricing.dropMode,
      priceTable: simulator.pricing.priceTable,
    })
    : { revenue: 0, expenses: 0, profit: 0 };
  const noRngBreakdown = hasDetailedBreakdown
    ? buildNoRngProfitBreakdown(simulator.results.simResult, activeHomeResultPlayerHrid.value, {
      consumableMode: simulator.pricing.consumableMode,
      dropMode: simulator.pricing.dropMode,
      priceTable: simulator.pricing.priceTable,
    })
    : { profit: 0 };

  let manaRunOutValue = "-";
  let manaRunOutTone;

  if (hasDetailedBreakdown) {
    const simResult = simulator.results.simResult;
    const playerHrid = String(activeHomeResultPlayerHrid.value || "");
    const ranOut = Boolean(simResult?.playerRanOutOfMana?.[playerHrid]);

    manaRunOutTone = ranOut ? "danger" : "success";

    if (!ranOut) {
      manaRunOutValue = t("common:simulationResults.No", "No");
    } else {
      const yesText = t("common:simulationResults.Yes", "Yes");
      const stat = simResult?.playerRanOutOfManaTime?.[playerHrid];
      const simulatedTime = Number(simResult?.simulatedTime || 0);

      if (stat && simulatedTime > 0) {
        const totalOutTime = Number(stat.totalTimeForOutOfMana || 0)
          + (stat.isOutOfMana ? (simulatedTime - Number(stat.startTimeForOutOfMana || 0)) : 0);
        const ratio = simulatedTime > 0
          ? (totalOutTime / simulatedTime) * 100
          : 0;

        manaRunOutValue = Number.isFinite(ratio)
          ? `${yesText} (${ratio.toFixed(2)}%)`
          : yesText;
      } else {
        manaRunOutValue = yesText;
      }
    }
  }

  const manaRunOutRow = {
    label: t("common:simulationResults.ranOutOfMana", "Mana Run Out"),
    value: manaRunOutValue,
    ...(manaRunOutTone ? { tone: manaRunOutTone } : {}),
  };
  return [
    {
      label: t("common:vue.results.xpPerHour", "XP/h"),
      value: row ? formatNumber(row.totalXpPerHour, 0) : "-",
      tone: "accent",
    },
    {
      label: t("common:vue.results.deathsPerHour", "Deaths/h"),
      value: row ? formatNumber(row.deathsPerHour, 2) : "-",
      tone: "danger",
    },
    manaRunOutRow,
    {
      label: t("common:vue.results.encountersPerHour", "Battles/h"),
      value: row ? formatNumber(row.encountersPerHour, 1) : "-",
    },
    {
      label: hasDetailedBreakdown
        ? t("common:revenue", "Revenue")
        : t("common:vue.results.revenuePerHour", "Revenue/h"),
      value: hasDetailedBreakdown
        ? formatCurrency(randomBreakdown.revenue)
        : (row ? formatCurrency(row.revenuePerHour) : "-"),
      tone: "success",
    },
    {
      label: hasDetailedBreakdown
        ? t("common:expense", "Expense")
        : t("common:vue.results.expensesPerHour", "Expenses/h"),
      value: hasDetailedBreakdown
        ? formatCurrency(randomBreakdown.expenses)
        : (row ? formatCurrency(row.expensesPerHour) : "-"),
      tone: "danger",
    },
    {
      label: hasDetailedBreakdown
        ? t("common:profit", "Profit")
        : t("common:vue.results.profitPerHour", "Profit/h"),
      value: hasDetailedBreakdown
        ? formatCurrency(randomBreakdown.profit)
        : (row ? formatCurrency(row.profitPerHour) : "-"),
      tone: (hasDetailedBreakdown ? Number(randomBreakdown.profit || 0) : Number(row?.profitPerHour || 0)) >= 0 ? "success" : "danger",
    },
    {
      label: hasDetailedBreakdown
        ? t("common:noRNGProfit", "No RNG Profit")
        : t("common:noRNGProfit", "No RNG Profit"),
      value: hasDetailedBreakdown
        ? formatCurrency(noRngBreakdown.profit)
        : (row ? formatCurrency(row.profitPerHour) : "-"),
      tone: Number(hasDetailedBreakdown ? noRngBreakdown.profit : row?.profitPerHour || 0) >= 0 ? "success" : "danger",
    },
  ];
});
const levelEtaCards = computed(() => {
  const cards = [];
  const importedBaseline = importedBaselineSnapshot.value;
  const currentPlayer = activePlayer.value;
  const resultRow = activeSingleTargetResultRow.value;

  if (!importedBaseline || !currentPlayer) {
    return cards;
  }

  for (const levelKey of levelKeys) {
    const importedLevel = normalizeLevel(importedBaseline?.levels?.[levelKey], 1);
    const targetLevel = normalizeLevel(currentPlayer?.levels?.[levelKey], importedLevel);
    if (targetLevel <= importedLevel) {
      continue;
    }

    const skillLabel = levelLabelMap.value?.[levelKey] || levelKey;
    const title = `${skillLabel} → ${t("common:vue.home.levelShort", "Lv")}.${targetLevel}`;

    const eta = calculateSkillUpgradeEta({
      currentLevel: importedLevel,
      currentExperience: importedBaseline?.skillExperience?.[levelKey],
      targetLevel,
      xpPerHour: resultRow?.[`${levelKey}XpPerHour`],
    });

    if (eta.status === "ok") {
      cards.push({
        skillKey: levelKey,
        skillLabel,
        targetLevel,
        status: eta.status,
        title,
        borderClass: "border-success/40",
        bgClass: "bg-success/10",
        titleClass: "text-success",
        details: {
          totalExperience: `${formatNumber(eta.currentExperience, 0)} / ${formatNumber(eta.targetExperience, 0)}`,
          requiredExperience: formatNumber(eta.xpNeeded, 0),
          requiredTime: formatEtaDuration(eta.hoursNeeded),
          completionTime: formatEtaCompletionTime(eta.hoursNeeded),
        },
      });
      continue;
    }

    if (eta.status === "missing_current_experience") {
      cards.push({
        skillKey: levelKey,
        skillLabel,
        targetLevel,
        status: eta.status,
        title,
        borderClass: "border-primary/40",
        bgClass: "bg-primary/10",
        titleClass: "text-primary",
        messageClass: "text-primary",
        message: t("common:vue.home.levelEtaMissingProgress", "Current imported data has no level progress."),
      });
      continue;
    }

    if (eta.status === "target_out_of_range") {
      cards.push({
        skillKey: levelKey,
        skillLabel,
        targetLevel,
        status: eta.status,
        title,
        borderClass: "border-primary/40",
        bgClass: "bg-primary/10",
        titleClass: "text-primary",
        messageClass: "text-primary",
        message: t("common:vue.home.levelEtaOutOfRange", "Target level is outside the current experience table range."),
      });
      continue;
    }

    if (!resultRow || !simulator.results.simResult || eta.status === "missing_xp_rate") {
      cards.push({
        skillKey: levelKey,
        skillLabel,
        targetLevel,
        status: "missing_xp_rate",
        title,
        borderClass: "border-border",
        bgClass: "bg-muted/50",
        titleClass: "text-foreground",
        messageClass: "text-foreground/85",
        message: t("common:vue.home.levelEtaMissingResult", "Run a single-target simulation first to show upgrade time."),
      });
      continue;
    }

    if (eta.status === "zero_xp_rate") {
      cards.push({
        skillKey: levelKey,
        skillLabel,
        targetLevel,
        status: eta.status,
        title,
        borderClass: "border-primary/40",
        bgClass: "bg-primary/10",
        titleClass: "text-primary",
        messageClass: "text-primary",
        message: t("common:vue.home.levelEtaZeroRate", "Current simulation has 0 XP/h for this skill, so ETA is unavailable."),
      });
    }
  }

  return cards;
});
const summaryBuildRows = computed(() => {
  const details = combatDetails.value;
  const stats = combatStats.value;
  const attackIntervalSeconds = Number(stats?.attackInterval || 0) / 1e9;
  return [
    {
      label: t("common:vue.home.averageCombatLevel", "Combat Level"),
      value: activePlayerCombatLevelLabel.value,
    },
    {
      label: getCombatStatName("combatStyleHrids", "Combat Style"),
      value: stats ? formatCombatStyleName(stats.combatStyleHrid, combatStyleDetailMap?.[stats.combatStyleHrid]?.name || "") : "-",
    },
    {
      label: getCombatStatName("damageType", "Damage Type"),
      value: stats ? formatDamageTypeName(stats.damageType, damageTypeDetailMap?.[stats.damageType]?.name || "") : "-",
    },
    {
      label: getCombatStatName("maxHitpoints", "Max Hitpoints"),
      value: details ? formatInt(details.maxHitpoints) : "-",
    },
    {
      label: getCombatStatName("attackInterval", "Attack Interval"),
      value: stats ? `${formatNumber(attackIntervalSeconds, 2)}s` : "-",
    },
    {
      label: getCombatStatName("armor", "Armor"),
      value: details ? formatInt(details.totalArmor) : "-",
    },
  ];
});
const fullResultsButtonLabel = computed(() => (
  simulator.runtime.isRunning
    ? t("common:vue.home.workspaceOpenResultsArea", "Open Results Area")
    : t("common:vue.home.workspaceViewFullResults", "View Full Results")
));
async function scrollToHomeResults(clearFocus = false) {
  await nextTick();
  homeResultsSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (clearFocus && route.name === "home" && route.query.focus === "results") {
    const { focus, ...query } = route.query;
    await router.replace({ name: "home", query, hash: route.hash });
  }
}

async function openHomeResultsPanel(clearFocus = false) {
  if (!requestWorkspaceTabChange("results")) {
    return;
  }
  await scrollToHomeResults(clearFocus);
}

const levelLabelMap = computed(() => Object.fromEntries(levelKeys.map((skillKey) => [
  skillKey,
  getSkillName(`/skills/${skillKey}`, skillKey),
])));

const equipmentLabelMap = computed(() => Object.fromEntries(equipmentSlots.map((slot) => [
  slot,
  getEquipmentSlotName(slot, slot),
])));

const activePlayer = computed(() => simulator.activePlayer);
const activePlayerCombatLevel = computed(() => {
  const levels = activePlayer.value?.levels ?? {};
  return calcCombatLevel(
    Math.max(1, Number(levels.stamina ?? 1)),
    Math.max(1, Number(levels.intelligence ?? 1)),
    Math.max(1, Number(levels.defense ?? 1)),
    Math.max(1, Number(levels.attack ?? 1)),
    Math.max(1, Number(levels.melee ?? 1)),
    Math.max(1, Number(levels.ranged ?? 1)),
    Math.max(1, Number(levels.magic ?? 1)),
  );
});
const activePlayerCombatLevelLabel = computed(() => {
  const level = Number(activePlayerCombatLevel.value);
  return Number.isFinite(level) ? level.toFixed(1) : "-";
});
const specialAbilityOptions = computed(() => (
  Object.values(abilityDetailMap)
    .filter((ability) => ability?.isSpecialAbility === true)
    .map((ability) => ({
      hrid: String(ability.hrid || ""),
      name: String(ability.name || ""),
      sortIndex: Number(ability.sortIndex ?? 0),
    }))
    .filter((ability) => ability.hrid)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name))
));
const houseRoomOptions = computed(() => Object.values(houseRoomDetailMap)
  .slice()
  .sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0))
  .map((room) => ({
    hrid: room.hrid,
    name: room.name,
  })));

const guildBuffOptions = computed(() => combatGuildBuffDetails.map((detail) => {
  const shrine = guildShrineDetailIndex?.[detail.shrineHrid] ?? {};
  return {
    ...detail,
    shrineName: String(shrine?.name || detail.shrineHrid || ""),
    maxLevel: getGuildBuffMaxLevel(detail.hrid),
  };
}));

const achievementDetailsByTier = Object.values(achievementDetailMap).reduce((acc, detail) => {
  const tierHrid = String(detail?.tierHrid || "");
  if (!tierHrid) {
    return acc;
  }
  if (!acc[tierHrid]) {
    acc[tierHrid] = [];
  }
  acc[tierHrid].push(detail);
  return acc;
}, {});

for (const tierHrid of Object.keys(achievementDetailsByTier)) {
  achievementDetailsByTier[tierHrid].sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0));
}

const achievementTierSections = computed(() => {
  const achievements = activePlayer.value?.achievements ?? {};
  return Object.values(achievementTierMap)
    .slice()
    .sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0))
    .map((tier) => {
      const details = achievementDetailsByTier[tier.hrid] ?? [];
      if (details.length === 0) {
        return null;
      }

      const buffTypeHrid = String(tier?.buff?.typeHrid || "");
      const buffTypeName = buffTypeHrid
        ? getBuffTypeName(buffTypeHrid, buffTypeHrid)
        : t("common:vue.home.buff", "Buff");
      const buffValueRaw = Number(tier?.buff?.ratioBoost || tier?.buff?.flatBoost || 0);
      const buffPercent = `${(buffValueRaw * 100).toFixed(1).replace(/\\.0$/, "")}%`;
      const checkedCount = details.filter((detail) => Boolean(achievements[detail.hrid])).length;

      return {
        tierHrid: tier.hrid,
        tierName: getAchievementTierName(tier.hrid, tier.name),
        buffText: `${t("common:vue.home.buff", "Buff")}: ${buffTypeName} +${buffPercent}`,
        details,
        totalCount: details.length,
        checkedCount,
      };
    })
    .filter(Boolean);
});

const openHouseRoomsModal = ref(false);
const houseRoomBaselineLevels = ref({});
const openAchievementsModal = ref(false);
const openGuildBuffsModal = ref(false);
const openPlayerImportModal = ref(false);
const openPlayerSnapshotInfoModal = ref(false);
const openExperimentalModal = ref(false);
const experimentalFileInput = ref(null);
const experimentalFileReady = ref(false);
const experimentalRunning = ref(false);
const experimentalStatusText = ref(t("common:Experiment.statusIdle", "-"));
const experimentalDownloadText = ref("");
const experimentalDungeonStartWaveEnabled = ref(false);
const experimentalDungeonStartWave = ref(1);
const houseRoomUpgradePreview = computed(() => simulator.previewHouseRoomUpgradeCost(
  houseRoomBaselineLevels.value,
  activePlayer.value?.houseRooms ?? {},
));
const houseRoomPreviewByHrid = computed(() => Object.fromEntries(
  (houseRoomUpgradePreview.value?.rooms ?? []).map((row) => [row.roomHrid, row]),
));
const houseRoomBaselineLevelMap = computed(() => {
  const baseline = houseRoomBaselineLevels.value && typeof houseRoomBaselineLevels.value === "object"
    ? houseRoomBaselineLevels.value
    : {};
  return Object.fromEntries(houseRoomOptions.value.map((room) => [
    room.hrid,
    Number(baseline?.[room.hrid] ?? activePlayer.value?.houseRooms?.[room.hrid] ?? 0),
  ]));
});
const houseRoomChangedRooms = computed(() => houseRoomUpgradePreview.value?.rooms ?? []);
const houseRoomMaterialKindCount = computed(() => (
  houseRoomUpgradePreview.value?.materials?.filter((entry) => entry.itemHrid !== "/items/coin").length ?? 0
));
const houseRoomMissingPriceCount = computed(() => (
  houseRoomUpgradePreview.value?.materials?.filter((entry) => entry.itemHrid !== "/items/coin" && !entry.priced).length ?? 0
));
const triggerEditor = reactive({
  kind: "",
  index: -1,
  hrid: "",
  draft: [],
  dirty: false,
  blockedMessage: "",
});
let restoringTriggerEditorPlayer = false;
const groupText = ref("");
const soloText = ref("");
const soloTargetPlayerId = ref(simulator.activePlayerId);
const importExportStatus = ref({
  tone: "secondary",
  text: "",
});
const playerSnapshotStatus = ref({
  tone: "secondary",
  text: "",
});

const dungeonToggleProxy = computed({
  get() {
    return simulator.simulationSettings.useDungeon ? "dungeon" : "zone";
  },
  set(value) {
    simulator.simulationSettings.useDungeon = value === "dungeon";
    simulator.normalizeDifficulty();
  },
});

const selectedActionHrid = computed({
  get() {
    return simulator.simulationSettings.useDungeon
      ? simulator.simulationSettings.dungeonHrid
      : simulator.simulationSettings.zoneHrid;
  },
  set(value) {
    if (simulator.simulationSettings.useDungeon) {
      simulator.simulationSettings.dungeonHrid = value;
    } else {
      simulator.simulationSettings.zoneHrid = value;
    }
    simulator.normalizeDifficulty();
  },
});

const currentActionComboboxOptions = computed(() => simulator.currentActionOptions.map((action) => ({
  value: action.hrid,
  label: formatActionName(action.hrid, action.name),
})));

function emptyComboboxOption() {
  return { value: "", label: t("common:vue.common.none", "None") };
}

function itemComboboxOption(item) {
  return {
    value: item.hrid,
    label: `${t("common:vue.home.levelShort", "Lv")}${item.itemLevel} ${formatItemName(item.hrid, item.name)}`,
  };
}

const equipmentComboboxOptionsBySlot = computed(() => Object.fromEntries(
  equipmentSlots.map((slot) => [
    slot,
    [emptyComboboxOption(), ...(simulator.options.equipmentBySlot[slot] || []).map(itemComboboxOption)],
  ]),
));
const foodComboboxOptions = computed(() => [
  emptyComboboxOption(),
  ...simulator.options.food.map(itemComboboxOption),
]);
const drinkComboboxOptions = computed(() => [
  emptyComboboxOption(),
  ...simulator.options.drinks.map(itemComboboxOption),
]);

function abilityComboboxOptions(slotIndex) {
  return [
    emptyComboboxOption(),
    ...getAbilityOptionsForSlot(slotIndex).map((ability) => ({
      value: ability.hrid,
      label: formatAbilityName(ability.hrid, ability.name),
    })),
  ];
}

function optionalSelectValue(value) {
  return String(value || EMPTY_SELECT_VALUE);
}

function decodeOptionalSelectValue(value) {
  return value === EMPTY_SELECT_VALUE ? "" : String(value || "");
}

function labyrinthCrateSelectValue(crateType) {
  return optionalSelectValue(simulator.simulationSettings.labyrinthCrates?.[crateType]);
}

function setLabyrinthCrateSelection(crateType, value) {
  simulator.setLabyrinthCrate(crateType, decodeOptionalSelectValue(value));
}

const simulationModeProxy = computed({
  get() {
    return simulator.simulationSettings.mode;
  },
  set(value) {
    simulator.setSimulationMode(value);
  },
});

const runScopeProxy = computed({
  get() {
    return simulator.simulationSettings.runScope;
  },
  set(value) {
    simulator.setRunScope(value);
  },
});

const difficultyTierOptions = computed(() => {
  const maxDifficulty = Math.min(5, Number(simulator.currentMaxDifficulty || 0));
  return [0, 1, 2, 3, 4, 5].map((tier) => ({
    value: tier,
    label: `T${tier}`,
    disabled: tier > maxDifficulty,
  }));
});

const selectedGroupZoneSet = computed(() => new Set(simulator.simulationSettings.selectedGroupZoneHrids || []));
const selectedSoloZoneSet = computed(() => new Set(simulator.simulationSettings.selectedSoloZoneHrids || []));
const profilePlayerOptions = computed(() => (
  simulator.players.map((player) => {
    const imported = simulator.queue?.importedProfileByPlayer?.[player.id] === true;
    const importedText = imported
      ? t("common:vue.home.profileStatusImported", "Imported")
      : t("common:vue.home.profileStatusNotImported", "Not imported");
    return {
      id: player.id,
      label: `${player.name || `Player ${player.id}`} (${importedText})`,
    };
  })
));
const profileSelectorPlayerId = computed({
  get() {
    return simulator.activePlayerId;
  },
  set(value) {
    simulator.setActivePlayer(String(value || "1"));
  },
});
const activeProfileImported = computed(() => simulator.queue?.importedProfileByPlayer?.[simulator.activePlayerId] === true);
const baselineSnapshot = computed(() => simulator.activeQueueState?.baseline?.snapshot || null);
const importedBaselineSnapshot = computed(() => simulator.activeImportedBaselineSnapshot || null);
const levelComparisonBaselineSnapshot = computed(() => importedBaselineSnapshot.value || baselineSnapshot.value || null);
const activeSingleTargetResultRow = computed(() => (
  simulator.results.simResult
    ? (simulator.results.summaryRows.find((row) => row.playerHrid === `player${simulator.activePlayerId}`) || null)
    : null
));
const equipmentHintViewModel = computed(() => {
  const player = activePlayer.value;
  const model = {};
  if (!player?.equipment) {
    return model;
  }

  for (const slot of equipmentSlots) {
    const itemHrid = String(player.equipment?.[slot]?.itemHrid || "");
    model[slot] = {
      levels: simulator.getMarketEnhancementLevelsForItem(itemHrid),
      costDraft: simulator.resolveActivePlayerEquipmentUpgradeCostDraft(slot),
    };
  }

  return model;
});
const abilityUpgradeCostDrafts = computed(() => (
  Array.from({ length: 5 }, (_, slotIndex) => simulator.resolveActivePlayerAbilityUpgradeCostDraft(slotIndex))
));

const allGroupZonesChecked = computed(() => (
  simulator.groupZoneOptions.length > 0
  && simulator.groupZoneOptions.every((zone) => selectedGroupZoneSet.value.has(zone.hrid))
));

const allSoloZonesChecked = computed(() => (
  simulator.soloZoneOptions.length > 0
  && simulator.soloZoneOptions.every((zone) => selectedSoloZoneSet.value.has(zone.hrid))
));
const importExportStatusClass = computed(() => {
  if (importExportStatus.value.tone === "success") {
    return "text-success";
  }
  if (importExportStatus.value.tone === "danger") {
    return "text-destructive";
  }
  return "text-muted-foreground";
});
const importExportStatusText = computed(() => importExportStatus.value.text || "");
const playerSnapshotRows = computed(() => simulator.playerDataSnapshotRows || []);
const hasPlayerSnapshotData = computed(() => playerSnapshotRows.value.some((row) => row.hasSnapshot));
const playerSnapshotSavedAtLabel = computed(() => {
  const savedAt = Number(simulator.playerDataSnapshot?.savedAt || 0);
  const savedAtText = savedAt > 0 ? new Date(savedAt).toLocaleString() : "-";
  return t("common:settingsPage.playerSnapshotSavedAt", "", { time: savedAtText });
});
const playerSnapshotStatusClass = computed(() => {
  if (playerSnapshotStatus.value.tone === "success") {
    return "text-success";
  }
  if (playerSnapshotStatus.value.tone === "danger") {
    return "text-destructive";
  }
  return "text-muted-foreground";
});
const playerSnapshotStatusText = computed(() => playerSnapshotStatus.value.text || "");
const combatPreviewPlayerConfig = computed(() => createCombatPreviewPlayerConfig(activePlayer.value));
const combatPreviewExtra = computed(() => ({
  mooPass: Boolean(simulator.simulationSettings.mooPass),
  comExp: simulator.simulationSettings.comExpEnabled ? Number(simulator.simulationSettings.comExp || 20) : 0,
  comDrop: simulator.simulationSettings.comDropEnabled ? Number(simulator.simulationSettings.comDrop || 20) : 0,
}));
const combatPreviewContext = computed(() => {
  if (simulator.simulationSettings.mode === "labyrinth") {
    const labyrinthHrid = String(simulator.simulationSettings.labyrinthHrid || "");
    if (!labyrinthHrid) {
      return null;
    }

    return {
      mode: "labyrinth",
      labyrinthHrid,
      roomLevel: Math.max(20, Number(simulator.simulationSettings.roomLevel || 100)),
      crates: simulator.getActiveLabyrinthCrates(),
    };
  }

  const zoneHrid = String(selectedActionHrid.value || "");
  if (!zoneHrid) {
    return null;
  }

  return {
    mode: "zone",
    zoneHrid,
    difficultyTier: Number(simulator.simulationSettings.difficultyTier || 0),
    useDungeon: Boolean(simulator.simulationSettings.useDungeon),
  };
});
const combatPreviewData = computed(() => {
  if (!combatPreviewPlayerConfig.value) {
    return {
      player: null,
      drinkCards: [],
      highlightSources: [],
    };
  }

  return buildCombatPreviewData(combatPreviewPlayerConfig.value, combatPreviewExtra.value, combatPreviewContext.value);
});

const combatDetails = computed(() => {
  return combatPreviewData.value.player?.combatDetails || null;
});

const combatStats = computed(() => {
  return combatDetails.value?.combatStats || null;
});

const conditionalHighlightSources = computed(() => combatPreviewData.value.highlightSources || []);
const conditionalHighlightsByKey = computed(() => {
  const highlights = new Map();

  conditionalHighlightSources.value.forEach((source) => {
    if (!source?.sourceKey || !Array.isArray(source.changedStats) || source.changedStats.length <= 0) {
      return;
    }

    const sourceLabel = formatCombatPreviewHighlightLabel(source);
    source.changedStats.forEach((stat) => {
      const entry = {
        key: `${source.sourceKey}-${stat.key}`,
        text: `${formatCombatPreviewStatDelta(stat)}（${sourceLabel}）`,
      };

      if (highlights.has(stat.key)) {
        highlights.get(stat.key).push(entry);
      } else {
        highlights.set(stat.key, [entry]);
      }
    });
  });

  return highlights;
});

const combatStatRows = computed(() => {
  const details = combatDetails.value;
  const stats = combatStats.value;
  if (!details || !stats) {
    return [];
  }

  const combatStyleName = formatCombatStyleName(stats.combatStyleHrid, combatStyleDetailMap?.[stats.combatStyleHrid]?.name || "");
  const damageTypeName = formatDamageTypeName(stats.damageType, damageTypeDetailMap?.[stats.damageType]?.name || "");
  const primaryTrainingName = formatSkillName(stats.primaryTraining);
  const focusTrainingName = formatSkillName(stats.focusTraining);
  const attackIntervalSeconds = Number(stats.attackInterval || 0) / 1e9;
  const evasionValues = [
    details.stabEvasionRating,
    details.slashEvasionRating,
    details.smashEvasionRating,
    details.rangedEvasionRating,
    details.magicEvasionRating,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const averageEvasion = evasionValues.length > 0
    ? evasionValues.reduce((sum, value) => sum + value, 0) / evasionValues.length
    : 0;

  const rows = [
    { key: "maxHitpoints", label: formatCombatStatName("maxHitpoints", "Max Hitpoints"), value: formatInt(details.maxHitpoints) },
    { key: "maxManapoints", label: formatCombatStatName("maxManapoints", "Max Manapoints"), value: formatInt(details.maxManapoints) },
    { key: "combatStyle", label: formatCombatStatName("combatStyleHrids", "Combat Style"), value: combatStyleName },
    { key: "damageType", label: formatCombatStatName("damageType", "Damage Type"), value: damageTypeName },
    { key: "primaryTraining", label: formatCombatStatName("primaryTraining", "Primary Training"), value: primaryTrainingName },
    { key: "focusTraining", label: formatCombatStatName("focusTraining", "Focus Training"), value: focusTrainingName },
    { key: "attackIntervalSeconds", label: formatCombatStatName("attackInterval", "Attack Interval"), value: `${formatNumber(attackIntervalSeconds, 2)}s` },
    { key: "stabAccuracyRating", label: formatCombatStatName("stabAccuracy", "Stab Accuracy"), value: formatInt(details.stabAccuracyRating) },
    { key: "stabMaxDamage", label: formatCombatStatName("stabDamage", "Stab Damage"), value: formatInt(details.stabMaxDamage) },
    { key: "slashAccuracyRating", label: formatCombatStatName("slashAccuracy", "Slash Accuracy"), value: formatInt(details.slashAccuracyRating) },
    { key: "slashMaxDamage", label: formatCombatStatName("slashDamage", "Slash Damage"), value: formatInt(details.slashMaxDamage) },
    { key: "smashAccuracyRating", label: formatCombatStatName("smashAccuracy", "Smash Accuracy"), value: formatInt(details.smashAccuracyRating) },
    { key: "smashMaxDamage", label: formatCombatStatName("smashDamage", "Smash Damage"), value: formatInt(details.smashMaxDamage) },
    { key: "defensiveMaxDamage", label: formatCombatStatName("defensiveDamage", "Defensive Damage"), value: formatInt(details.defensiveMaxDamage) },
    { key: "rangedAccuracyRating", label: formatCombatStatName("rangedAccuracy", "Ranged Accuracy"), value: formatInt(details.rangedAccuracyRating) },
    { key: "rangedMaxDamage", label: formatCombatStatName("rangedDamage", "Ranged Damage"), value: formatInt(details.rangedMaxDamage) },
    { key: "magicAccuracyRating", label: formatCombatStatName("magicAccuracy", "Magic Accuracy"), value: formatInt(details.magicAccuracyRating) },
    { key: "magicMaxDamage", label: formatCombatStatName("magicDamage", "Magic Damage"), value: formatInt(details.magicMaxDamage) },
    { key: "averageEvasion", label: getBuffTypeName("/buff_types/evasion", "Evasion"), value: formatInt(averageEvasion) },
    { key: "totalArmor", label: formatCombatStatName("armor", "Armor"), value: formatInt(details.totalArmor) },
    { key: "criticalRate", label: formatCombatStatName("criticalRate", "Critical Rate"), value: formatPercent(stats.criticalRate, 2) },
    { key: "armorPenetration", label: formatCombatStatName("armorPenetration", "Armor Penetration"), value: formatPercent(stats.armorPenetration, 2) },
    { key: "stabEvasionRating", label: formatCombatStatName("stabEvasion", "Stab Evasion"), value: formatInt(details.stabEvasionRating) },
    { key: "slashEvasionRating", label: formatCombatStatName("slashEvasion", "Slash Evasion"), value: formatInt(details.slashEvasionRating) },
    { key: "smashEvasionRating", label: formatCombatStatName("smashEvasion", "Smash Evasion"), value: formatInt(details.smashEvasionRating) },
    { key: "rangedEvasionRating", label: formatCombatStatName("rangedEvasion", "Ranged Evasion"), value: formatInt(details.rangedEvasionRating) },
    { key: "magicEvasionRating", label: formatCombatStatName("magicEvasion", "Magic Evasion"), value: formatInt(details.magicEvasionRating) },
    { key: "totalWaterResistance", label: formatCombatStatName("waterResistance", "Water Resistance"), value: formatInt(details.totalWaterResistance) },
    { key: "totalNatureResistance", label: formatCombatStatName("natureResistance", "Nature Resistance"), value: formatInt(details.totalNatureResistance) },
    { key: "totalFireResistance", label: formatCombatStatName("fireResistance", "Fire Resistance"), value: formatInt(details.totalFireResistance) },
    { key: "physicalAmplify", label: formatCombatStatName("physicalAmplify", "Physical Amplify"), value: formatPercent(stats.physicalAmplify, 2) },
    { key: "waterAmplify", label: formatCombatStatName("waterAmplify", "Water Amplify"), value: formatPercent(stats.waterAmplify, 2) },
    { key: "natureAmplify", label: formatCombatStatName("natureAmplify", "Nature Amplify"), value: formatPercent(stats.natureAmplify, 2) },
    { key: "fireAmplify", label: formatCombatStatName("fireAmplify", "Fire Amplify"), value: formatPercent(stats.fireAmplify, 2) },
    { key: "healingAmplify", label: formatCombatStatName("healingAmplify", "Healing Amplify"), value: formatPercent(stats.healingAmplify, 2) },
    { key: "lifeSteal", label: formatCombatStatName("lifeSteal", "Life Steal"), value: formatPercent(stats.lifeSteal, 2) },
    { key: "physicalThorns", label: formatCombatStatName("physicalThorns", "Physical Thorns"), value: formatPercent(stats.physicalThorns, 2) },
    { key: "elementalThorns", label: formatCombatStatName("elementalThorns", "Elemental Thorns"), value: formatPercent(stats.elementalThorns, 2) },
    { key: "retaliation", label: formatCombatStatName("retaliation", "Retaliation"), value: formatPercent(stats.retaliation, 2) },
    { key: "hpRegenPer10", label: formatCombatStatName("hpRegenPer10", "HP Regen"), value: formatPercent(stats.hpRegenPer10, 2) },
    { key: "mpRegenPer10", label: formatCombatStatName("mpRegenPer10", "MP Regen"), value: formatPercent(stats.mpRegenPer10, 2) },
    { key: "criticalDamage", label: formatCombatStatName("criticalDamage", "Critical Damage"), value: formatPercent(stats.criticalDamage, 2) },
    { key: "taskDamage", label: formatCombatStatName("taskDamage", "Task Damage"), value: formatPercent(stats.taskDamage, 2) },
    { key: "waterPenetration", label: formatCombatStatName("waterPenetration", "Water Penetration"), value: formatPercent(stats.waterPenetration, 2) },
    { key: "naturePenetration", label: formatCombatStatName("naturePenetration", "Nature Penetration"), value: formatPercent(stats.naturePenetration, 2) },
    { key: "firePenetration", label: formatCombatStatName("firePenetration", "Fire Penetration"), value: formatPercent(stats.firePenetration, 2) },
    { key: "abilityHaste", label: formatCombatStatName("abilityHaste", "Ability Haste"), value: formatInt(stats.abilityHaste) },
    { key: "tenacity", label: formatCombatStatName("tenacity", "Tenacity"), value: formatInt(stats.tenacity) },
    { key: "manaLeech", label: formatCombatStatName("manaLeech", "Mana Leech"), value: formatPercent(stats.manaLeech, 2) },
    { key: "castSpeed", label: formatCombatStatName("castSpeed", "Cast Speed"), value: formatPercent(stats.castSpeed, 2) },
    { key: "totalThreat", label: formatCombatStatName("threat", "Threat"), value: formatInt(details.totalThreat) },
    { key: "parry", label: formatCombatStatName("parry", "Parry"), value: formatPercent(stats.parry, 2) },
    { key: "mayhem", label: formatCombatStatName("mayhem", "Mayhem"), value: formatPercent(stats.mayhem, 2) },
    { key: "pierce", label: formatCombatStatName("pierce", "Pierce"), value: formatPercent(stats.pierce, 2) },
    { key: "curse", label: formatCombatStatName("curse", "Curse"), value: formatPercent(stats.curse, 2) },
    { key: "fury", label: formatCombatStatName("fury", "Fury"), value: formatPercent(stats.fury, 2) },
    { key: "weaken", label: formatCombatStatName("weaken", "Weaken"), value: formatPercent(stats.weaken, 2) },
    { key: "ripple", label: formatCombatStatName("ripple", "Ripple"), value: formatPercent(stats.ripple, 2) },
    { key: "bloom", label: formatCombatStatName("bloom", "Bloom"), value: formatPercent(stats.bloom, 2) },
    { key: "blaze", label: formatCombatStatName("blaze", "Blaze"), value: formatPercent(stats.blaze, 2) },
    { key: "attackSpeed", label: formatCombatStatName("attackSpeed", "Attack Speed"), value: formatPercent(stats.attackSpeed, 2) },
    { key: "autoAttackDamage", label: formatCombatStatName("autoAttackDamage", "Auto Attack Damage"), value: formatPercent(stats.autoAttackDamage, 2) },
    { key: "abilityDamage", label: formatCombatStatName("abilityDamage", "Ability Damage"), value: formatPercent(stats.abilityDamage, 2) },
    { key: "drinkConcentration", label: formatCombatStatName("drinkConcentration", "Drink Concentration"), value: formatPercent(stats.drinkConcentration, 2) },
    { key: "foodHaste", label: formatCombatStatName("foodHaste", "Food Haste"), value: formatPercent(stats.foodHaste, 2) },
    { key: "combatDropRate", label: formatCombatStatName("combatDropRate", "Combat Drop Rate"), value: formatPercent(stats.combatDropRate, 2) },
    { key: "combatRareFind", label: formatCombatStatName("combatRareFind", "Combat Rare Find"), value: formatPercent(stats.combatRareFind, 2) },
    { key: "combatDropQuantity", label: formatCombatStatName("combatDropQuantity", "Combat Drop Quantity"), value: formatPercent(stats.combatDropQuantity, 2) },
    { key: "combatExperience", label: formatCombatStatName("combatExperience", "Combat Experience"), value: formatPercent(stats.combatExperience, 2) },
    { key: "staminaExperience", label: formatCombatStatName("staminaExperience", "Stamina Experience"), value: formatPercent(stats.staminaExperience, 2) },
    { key: "intelligenceExperience", label: formatCombatStatName("intelligenceExperience", "Intelligence Experience"), value: formatPercent(stats.intelligenceExperience, 2) },
    { key: "attackExperience", label: formatCombatStatName("attackExperience", "Attack Experience"), value: formatPercent(stats.attackExperience, 2) },
    { key: "defenseExperience", label: formatCombatStatName("defenseExperience", "Defense Experience"), value: formatPercent(stats.defenseExperience, 2) },
    { key: "meleeExperience", label: formatCombatStatName("meleeExperience", "Melee Experience"), value: formatPercent(stats.meleeExperience, 2) },
    { key: "rangedExperience", label: formatCombatStatName("rangedExperience", "Ranged Experience"), value: formatPercent(stats.rangedExperience, 2) },
    { key: "magicExperience", label: formatCombatStatName("magicExperience", "Magic Experience"), value: formatPercent(stats.magicExperience, 2) },
  ];

  return rows
    .filter((entry) => entry.value !== "-")
    .map((entry) => ({
      ...entry,
      highlights: conditionalHighlightsByKey.value.get(entry.key) || [],
    }));
});

function formatInt(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.floor(numeric).toLocaleString() : "-";
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: digits }) : "-";
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatUpgradeCost(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  const absoluteValue = Math.abs(numeric);
  if (absoluteValue >= 1e9) {
    return `${formatNumber(numeric / 1e9, 2)}b`;
  }
  if (absoluteValue >= 1e6) {
    return `${formatNumber(numeric / 1e6, 2)}m`;
  }
  if (absoluteValue >= 1e3) {
    return `${formatNumber(numeric / 1e3, 1)}k`;
  }
  return formatNumber(numeric, 0);
}

function formatHouseRoomTransition(fromLevel, toLevel) {
  return t("common:vue.home.houseRoomsTransition", "Lv {{from}} -> Lv {{to}}", {
    from: formatInt(fromLevel),
    to: formatInt(toLevel),
  });
}

function formatHouseRoomChangedRoomsText(count) {
  return t("common:vue.home.houseRoomsSummaryChangedRooms", "{{count}} rooms changed", { count: formatInt(count) });
}

function formatHouseRoomMissingPriceHint(count) {
  return t("common:vue.home.houseRoomsMissingPriceHint", "{{count}} lines missing price", { count: formatInt(count) });
}

function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${(numeric * 100).toFixed(digits)}%`;
}

function formatDurationSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${formatNumber(numeric, 2)}s`;
}

function formatFlexibleNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  if (Number.isInteger(numeric)) {
    return formatInt(numeric);
  }
  return formatNumber(numeric, digits);
}

function formatSignedFlexibleNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}${formatFlexibleNumber(Math.abs(numeric), digits)}`;
}

function formatSignedPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}${(Math.abs(numeric) * 100).toFixed(digits)}%`;
}

function formatCombatPreviewStatDelta(stat) {
  if (!stat) {
    return "-";
  }

  if (stat.format === "percent") {
    return formatSignedPercent(stat.deltaValue, 2);
  }
  if (stat.format === "seconds") {
    return `${formatSignedFlexibleNumber(stat.deltaValue, 2)}s`;
  }
  return formatSignedFlexibleNumber(stat.deltaValue, 2);
}

function formatCombatPreviewHighlightLabel(source) {
  if (!source?.sourceHrid) {
    return String(source?.sourceName || "");
  }

  if (source.sourceType === "ability") {
    return formatAbilityName(source.sourceHrid, source.sourceName || "");
  }

  return formatItemName(source.sourceHrid, source.sourceName || "");
}

function formatEtaDuration(hours) {
  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) {
    return "-";
  }

  const totalMinutes = Math.max(1, Math.ceil(numericHours * 60));
  const minutesPerYear = 60 * 24 * 365;
  const minutesPerDay = 60 * 24;
  const minutesPerHour = 60;

  const years = Math.floor(totalMinutes / minutesPerYear);
  const days = Math.floor((totalMinutes % minutesPerYear) / minutesPerDay);
  const hoursPart = Math.floor((totalMinutes % minutesPerDay) / minutesPerHour);
  const minutes = totalMinutes % minutesPerHour;
  const parts = [];

  if (years > 0) {
    parts.push(`${years}y`);
  }
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hoursPart > 0) {
    parts.push(`${hoursPart}h`);
  }
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

function formatEtaCompletionTime(hours) {
  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) {
    return "-";
  }

  const completionDate = new Date(Date.now() + numericHours * 60 * 60 * 1000);
  const now = new Date();
  const isSameYear = completionDate.getFullYear() === now.getFullYear();

  return completionDate.toLocaleString(undefined, {
    year: isSameYear ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatSkillName(skillHrid) {
  const hrid = String(skillHrid || "");
  if (!hrid) {
    return "-";
  }
  return getSkillName(hrid, hrid);
}

function formatCombatStatName(statKey, fallbackName = "") {
  return getCombatStatName(String(statKey || ""), fallbackName);
}

function formatCombatStyleName(combatStyleHrid, fallbackName = "") {
  const hrid = String(combatStyleHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const defaultLabel = fallbackName || combatStyleDetailMap?.[hrid]?.name || hrid;
  return getOfficialGameText("combatStyleNames", hrid, defaultLabel);
}

function formatDamageTypeName(damageTypeHrid, fallbackName = "") {
  const hrid = String(damageTypeHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const resolved = damageTypeDetailMap?.[hrid];
  const normalizedHrid = String(resolved?.hrid || hrid);
  const defaultLabel = fallbackName || resolved?.name || hrid;
  return getOfficialGameText("damageTypeNames", normalizedHrid, defaultLabel);
}

function formatActionName(actionHrid, fallbackName = "") {
  const hrid = String(actionHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return getActionName(hrid, fallbackName || hrid);
}

function formatMonsterName(monsterHrid, fallbackName = "") {
  const hrid = String(monsterHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return getMonsterName(hrid, fallbackName || hrid);
}

function formatItemName(itemHrid, fallbackName = "") {
  const hrid = String(itemHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const defaultLabel = fallbackName || itemDetailMap?.[hrid]?.name || hrid;
  return getItemName(hrid, defaultLabel);
}

function formatAbilityName(abilityHrid, fallbackName = "") {
  const hrid = String(abilityHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return getAbilityName(hrid, fallbackName || hrid);
}

function getAbilitySlotLabel(index) {
  const slotIndex = Number(index);
  if (slotIndex === 0) {
    return t("translation:abilitySlot.specialAbility", "Special Ability").replace(/<br\s*\/?>/gi, " ");
  }
  return t("common:vue.home.abilitySlot", `Ability ${slotIndex}`, { index: slotIndex });
}

function getAbilityOptionsForSlot(slotIndex) {
  return Number(slotIndex) === 0 ? specialAbilityOptions.value : simulator.options.abilities;
}

function normalizeHrid(value) {
  return String(value || "");
}

function normalizeLevel(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function hasTriggerChangeForHrids(hrids = []) {
  const baseline = baselineSnapshot.value;
  if (!baseline) {
    return false;
  }

  const currentTriggerMap = activePlayer.value?.triggerMap || {};
  const baselineTriggerMap = baseline?.triggerMap || {};
  for (const hrid of hrids) {
    const normalizedHrid = normalizeHrid(hrid);
    if (!normalizedHrid) {
      continue;
    }
    if (buildTriggerChangeDescriptor(baselineTriggerMap, currentTriggerMap, normalizedHrid)) {
      return true;
    }
  }
  return false;
}

function isLevelChanged(levelKey) {
  const baseline = levelComparisonBaselineSnapshot.value;
  if (!baseline) {
    return false;
  }
  const before = normalizeLevel(baseline?.levels?.[levelKey], 1);
  const after = normalizeLevel(activePlayer.value?.levels?.[levelKey], 1);
  return before !== after;
}

function isEquipmentSlotChanged(slot) {
  const baseline = baselineSnapshot.value;
  if (!baseline) {
    return false;
  }
  const before = baseline?.equipment?.[slot] || { itemHrid: "", enhancementLevel: 0 };
  const after = activePlayer.value?.equipment?.[slot] || { itemHrid: "", enhancementLevel: 0 };
  return normalizeHrid(before.itemHrid) !== normalizeHrid(after.itemHrid)
    || normalizeLevel(before.enhancementLevel, 0) !== normalizeLevel(after.enhancementLevel, 0);
}

function isFoodSlotChanged(index) {
  const baseline = baselineSnapshot.value;
  if (!baseline) {
    return false;
  }
  const beforeHrid = normalizeHrid(baseline?.food?.[index]);
  const afterHrid = normalizeHrid(activePlayer.value?.food?.[index]);
  if (beforeHrid !== afterHrid) {
    return true;
  }
  return hasTriggerChangeForHrids([beforeHrid]);
}

function isDrinkSlotChanged(index) {
  const baseline = baselineSnapshot.value;
  if (!baseline) {
    return false;
  }
  const beforeHrid = normalizeHrid(baseline?.drinks?.[index]);
  const afterHrid = normalizeHrid(activePlayer.value?.drinks?.[index]);
  if (beforeHrid !== afterHrid) {
    return true;
  }
  return hasTriggerChangeForHrids([beforeHrid]);
}

function isAbilitySlotChanged(index) {
  const baseline = baselineSnapshot.value;
  if (!baseline) {
    return false;
  }
  const before = baseline?.abilities?.[index] || { abilityHrid: "", level: 1 };
  const after = activePlayer.value?.abilities?.[index] || { abilityHrid: "", level: 1 };
  const beforeHrid = normalizeHrid(before.abilityHrid);
  const afterHrid = normalizeHrid(after.abilityHrid);
  if (beforeHrid !== afterHrid) {
    return true;
  }
  if (normalizeLevel(before.level, 1) !== normalizeLevel(after.level, 1)) {
    return true;
  }
  return hasTriggerChangeForHrids([beforeHrid]);
}

function toggleAllGroupZones(checked) {
  const allHrids = simulator.groupZoneOptions.map((zone) => zone.hrid);
  simulator.setSelectedGroupZoneHrids(checked ? allHrids : []);
}

function toggleAllSoloZones(checked) {
  const allHrids = simulator.soloZoneOptions.map((zone) => zone.hrid);
  simulator.setSelectedSoloZoneHrids(checked ? allHrids : []);
}

function setImportExportStatus(tone, text) {
  importExportStatus.value = {
    tone: tone || "secondary",
    text: String(text || ""),
  };
}

function setPlayerSnapshotStatus(messageKey, tone = "secondary", options = {}) {
  playerSnapshotStatus.value = {
    tone,
    text: t(messageKey, messageKey, options),
  };
}

function savePlayerDataSnapshotFromHome() {
  const result = simulator.savePlayerDataSnapshot();
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerSaveError", "danger");
    return;
  }

  setPlayerSnapshotStatus("common:settingsPage.playerSaveSuccess", "success");
}

function loadPlayerDataSnapshotFromHome() {
  if (blockPlayerConfigReplacement()) {
    setPlayerSnapshotStatus("common:vue.home.trigger.saveOrCancelFirst", "warning");
    return;
  }
  const result = simulator.loadPlayerDataSnapshot();
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerLoadInvalid", "danger");
    return;
  }

  const savedAtText = result.savedAt > 0 ? new Date(result.savedAt).toLocaleString() : "-";
  setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerLoadSuccess", "success", { time: savedAtText });
}

function deleteSinglePlayerDataSnapshotFromHome(playerId) {
  const result = simulator.deleteSinglePlayerDataSnapshot(playerId);
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteError", "danger", result.messageOptions || {});
    return;
  }

  setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteSingleSuccess", "success", result.messageOptions || {});
}

function deleteAllPlayerDataSnapshotsFromHome() {
  const result = simulator.deleteAllPlayerDataSnapshots();
  if (!result.ok) {
    setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteError", "danger");
    return;
  }

  setPlayerSnapshotStatus(result.messageKey || "common:settingsPage.playerDeleteAllSuccess", "success");
}

function openPlayerImportExportModal() {
  soloTargetPlayerId.value = String(simulator.activePlayerId || "1");
  setImportExportStatus("secondary", "");
  openPlayerImportModal.value = true;
}

function closePlayerImportModal() {
  openPlayerImportModal.value = false;
  setImportExportStatus("secondary", "");
}

function openMainSiteImportScript() {
  if (!hasMainSiteImportScriptUrl) {
    return;
  }

  window.open(MAIN_SITE_IMPORT_SCRIPT_URL, "_blank", "noopener,noreferrer");
}

function handleGroupExport() {
  groupText.value = simulator.exportGroupConfig();
  setImportExportStatus("success", t("common:vue.settings.msgGroupExported", "Group exported in {{format}} format.", {
    format: "modern",
  }));
}

function handleSoloExport() {
  soloText.value = simulator.exportSoloConfig(soloTargetPlayerId.value);
  setImportExportStatus("success", t("common:vue.settings.msgSoloExported", "Player {{player}} exported in {{format}} format.", {
    player: soloTargetPlayerId.value,
    format: "modern",
  }));
}

function handleGroupImport() {
  if (blockPlayerConfigReplacement()) {
    setImportExportStatus("warning", triggerEditor.blockedMessage);
    return;
  }
  try {
    const result = simulator.importGroupConfig(groupText.value);
    setImportExportStatus("success", t("common:vue.settings.msgGroupImportSuccess", "Group import success ({{format}}).", {
      format: result.detectedFormat,
    }));
  } catch (error) {
    setImportExportStatus("danger", t("common:vue.settings.msgGroupImportFailed", "Group import failed: {{error}}", {
      error: error?.message || String(error),
    }));
  }
}

function handleSoloImport() {
  if (blockPlayerConfigReplacement()) {
    setImportExportStatus("warning", triggerEditor.blockedMessage);
    return;
  }
  try {
    const result = simulator.importSoloConfig(soloText.value, soloTargetPlayerId.value);
    setImportExportStatus("success", t("common:vue.settings.msgSoloImportSuccess", "Solo import success ({{format}}).", {
      format: result.detectedFormat,
    }));
  } catch (error) {
    setImportExportStatus("danger", t("common:vue.settings.msgSoloImportFailed", "Solo import failed: {{error}}", {
      error: error?.message || String(error),
    }));
  }
}

async function copyImportExportText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    setImportExportStatus("danger", t("common:vue.settings.msgNothingToCopy", "Nothing to copy."));
    return;
  }

  try {
    await navigator.clipboard.writeText(normalized);
    setImportExportStatus("success", t("common:vue.settings.msgCopied", "Copied to clipboard."));
  } catch (error) {
    setImportExportStatus("danger", t("common:vue.settings.msgCopyFailed", "Clipboard copy failed: {{error}}", {
      error: error?.message || String(error),
    }));
  }
}

function downloadImportExportText(filename, text) {
  const normalized = String(text || "");
  if (!normalized.trim()) {
    setImportExportStatus("danger", t("common:vue.settings.msgNothingToDownload", "Nothing to download."));
    return;
  }

  const blob = new Blob([normalized], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setImportExportStatus("success", t("common:vue.settings.msgDownloaded", "Downloaded {{filename}}.", { filename }));
}

async function onImportExportFileSelected(event, target) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    if (target === "group") {
      groupText.value = text;
    } else {
      soloText.value = text;
    }
    setImportExportStatus("success", t("common:vue.settings.msgLoadedFile", "Loaded file: {{filename}}", {
      filename: file.name,
    }));
  } catch (error) {
    setImportExportStatus("danger", t("common:vue.settings.msgReadFileFailed", "Read file failed: {{error}}", {
      error: error?.message || String(error),
    }));
  } finally {
    event.target.value = "";
  }
}

function postTampermonkeyImportResult(payload) {
  window.postMessage({
    channel: TAMPERMONKEY_BRIDGE_CHANNEL,
    ...payload,
  }, window.location.origin);
}

function handleTampermonkeyImportWindowMessage(event) {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.channel !== TAMPERMONKEY_BRIDGE_CHANNEL || data.type !== "mwi-tm-import") {
    return;
  }

  const importTarget = String(data.importTarget || "").trim();
  if (importTarget && importTarget !== "player") {
    return;
  }

  const requestId = String(data.requestId || "").trim();
  if (!requestId) {
    return;
  }
  if (blockPlayerConfigReplacement()) {
    postTampermonkeyImportResult({
      type: "mwi-tm-import-result",
      requestId,
      ok: false,
      message: triggerEditor.blockedMessage,
    });
    return;
  }

  try {
    const result = applyTampermonkeyImportMessage(simulator, data);
    postTampermonkeyImportResult({
      type: "mwi-tm-import-result",
      requestId,
      ok: true,
      detectedFormat: result?.detectedFormat || "",
      message: result?.message || "",
    });
  } catch (error) {
    postTampermonkeyImportResult({
      type: "mwi-tm-import-result",
      requestId,
      ok: false,
      message: error?.message || String(error),
    });
  }
}

function onExperimentalFileSelected(event) {
  const file = event?.target?.files?.[0];
  experimentalFileReady.value = Boolean(file);
  experimentalStatusText.value = file
    ? t("common:Experiment.statusFileReady", "Selected file: {{name}}", { name: file.name })
    : t("common:Experiment.statusIdle", "-");
}

async function runExperimentalBatch() {
  const file = experimentalFileInput.value?.files?.[0];
  if (!file) {
    experimentalStatusText.value = t("common:Experiment.statusNoFile", "No file selected.");
    return;
  }

  experimentalRunning.value = true;
  experimentalDownloadText.value = "";

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const cases = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.cases) ? parsed.cases : Object.values(parsed || {}));
    const results = [];

    for (let i = 0; i < cases.length; i++) {
      const entry = cases[i] || {};
      const players = Array.isArray(entry.players) ? entry.players : [];
      if (!Array.isArray(players) || players.length === 0) {
        continue;
      }

      const payload = {
        type: "start_simulation",
        workerId: `${Date.now()}-${i}`,
        players,
        zone: entry.zone || (entry.zoneHrid ? { zoneHrid: entry.zoneHrid, difficultyTier: Number(entry.difficultyTier || 0) } : null),
        labyrinth: entry.labyrinth || null,
        simulationTimeLimit: Number(entry.simulationTimeLimit || 24 * 60 * 60 * 1e9),
        extra: {
          mooPass: Boolean(entry?.extra?.mooPass),
          comExp: Number(entry?.extra?.comExp || 0),
          comDrop: Number(entry?.extra?.comDrop || 0),
          enableHpMpVisualization: Boolean(entry?.extra?.enableHpMpVisualization),
          dungeonStartWaveEnabled: Boolean(experimentalDungeonStartWaveEnabled.value),
          dungeonStartWave: Number(experimentalDungeonStartWave.value || 1),
        },
      };

      // eslint-disable-next-line no-await-in-loop
      const simResult = await simulator.runSingleSimulationPayload(payload);
      results.push({
        name: String(entry.name || `case-${i + 1}`),
        input: entry,
        simResult,
      });
      experimentalStatusText.value = t("common:Experiment.statusRunning", "Running {{current}} / {{total}}", {
        current: i + 1,
        total: cases.length,
      });
    }

    experimentalDownloadText.value = JSON.stringify({
      generatedAt: Date.now(),
      total: results.length,
      dungeonStartWaveEnabled: experimentalDungeonStartWaveEnabled.value,
      dungeonStartWave: experimentalDungeonStartWave.value,
      results,
    }, null, 2);
    experimentalStatusText.value = t("common:Experiment.statusCompleted", "Completed {{count}} cases.", {
      count: results.length,
    });
  } catch (error) {
    experimentalStatusText.value = t("common:Experiment.statusFailed", "Failed: {{error}}", {
      error: error?.message || String(error),
    });
  } finally {
    experimentalRunning.value = false;
  }
}

function downloadExperimentalResults() {
  if (!experimentalDownloadText.value) {
    return;
  }
  const blob = new Blob([experimentalDownloadText.value], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mwi-experimental-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ensureActivePlayerAdvancedState() {
  const player = activePlayer.value;
  if (!player) {
    return;
  }

  if (!player.houseRooms || typeof player.houseRooms !== "object" || Array.isArray(player.houseRooms)) {
    player.houseRooms = {};
  }

  for (const room of houseRoomOptions.value) {
    const currentValue = Number(player.houseRooms[room.hrid] ?? 0);
    player.houseRooms[room.hrid] = Number.isFinite(currentValue) && currentValue >= 0 ? Math.floor(currentValue) : 0;
  }

  if (!player.achievements || typeof player.achievements !== "object" || Array.isArray(player.achievements)) {
    player.achievements = {};
  }

  player.guildBuffs = normalizeGuildBuffLevels(player.guildBuffs);
}

function guildBuffLevel(guildBuffHrid) {
  return Number(activePlayer.value?.guildBuffs?.[guildBuffHrid] || 0);
}

function setGuildBuffLevel(guildBuffHrid, value) {
  ensureActivePlayerAdvancedState();
  const maxLevel = getGuildBuffMaxLevel(guildBuffHrid);
  const parsed = Math.floor(Number(value));
  activePlayer.value.guildBuffs[guildBuffHrid] = Number.isFinite(parsed)
    ? Math.max(0, Math.min(parsed, maxLevel))
    : 0;
}

function clearGuildBuffLevels() {
  ensureActivePlayerAdvancedState();
  activePlayer.value.guildBuffs = normalizeGuildBuffLevels({});
}

function formatGuildBuffEffects(option, level) {
  const normalizedLevel = Math.max(0, Math.min(Math.floor(Number(level) || 0), option.maxLevel));
  if (normalizedLevel <= 0) {
    return t("common:vue.home.guildBuffInactive", "Inactive");
  }

  return (option.buffs || []).map((buff) => {
    const ratioBoost = Number(buff?.ratioBoost || 0) + (normalizedLevel - 1) * Number(buff?.ratioBoostLevelBonus || 0);
    const flatBoost = Number(buff?.flatBoost || 0) + (normalizedLevel - 1) * Number(buff?.flatBoostLevelBonus || 0);
    const value = ratioBoost !== 0 ? ratioBoost : flatBoost;
    const valueText = `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
    return `${getBuffTypeName(buff?.typeHrid, buff?.typeHrid)} +${valueText}`;
  }).join(" · ");
}

function captureHouseRoomBaselineLevels() {
  ensureActivePlayerAdvancedState();
  houseRoomBaselineLevels.value = cloneValue(activePlayer.value?.houseRooms ?? {});
}

function setAchievement(achievementHrid, checked) {
  ensureActivePlayerAdvancedState();
  activePlayer.value.achievements[achievementHrid] = Boolean(checked);
  simulator.persistPlayerAchievements();
}

function setTierAchievements(tierHrid, checked) {
  ensureActivePlayerAdvancedState();
  const details = achievementDetailsByTier[tierHrid] ?? [];
  for (const detail of details) {
    activePlayer.value.achievements[detail.hrid] = Boolean(checked);
  }
  simulator.persistPlayerAchievements();
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveTriggerTarget(kind, index) {
  if (!activePlayer.value) {
    return { hrid: "", label: "" };
  }

  if (kind === "food") {
    const hrid = String(activePlayer.value.food?.[index] || "");
    return {
      hrid,
      label: formatItemName(hrid, itemDetailMap[hrid]?.name || t("common:vue.home.foodSlot", "Food {{index}}", { index: index + 1 })),
    };
  }

  if (kind === "drink") {
    const hrid = String(activePlayer.value.drinks?.[index] || "");
    return {
      hrid,
      label: formatItemName(hrid, itemDetailMap[hrid]?.name || t("common:vue.home.drinkSlot", "Drink {{index}}", { index: index + 1 })),
    };
  }

  if (kind === "ability") {
    const hrid = String(activePlayer.value.abilities?.[index]?.abilityHrid || "");
    return {
      hrid,
      label: hrid ? formatAbilityName(hrid, getAbilitySlotLabel(index)) : getAbilitySlotLabel(index),
    };
  }

  return { hrid: "", label: "" };
}

function onFoodChanged(index) {
  const hrid = String(activePlayer.value?.food?.[index] || "");
  if (hrid) {
    simulator.ensureActivePlayerTriggerDefaults(hrid);
  }
}

function setFoodSelection(index, value) {
  if (!canReplaceTriggerTarget("food", index)) {
    return;
  }
  activePlayer.value.food[index] = String(value || "");
  onFoodChanged(index);
}

function onDrinkChanged(index) {
  const hrid = String(activePlayer.value?.drinks?.[index] || "");
  if (hrid) {
    simulator.ensureActivePlayerTriggerDefaults(hrid);
  }
}

function setDrinkSelection(index, value) {
  if (!canReplaceTriggerTarget("drink", index)) {
    return;
  }
  activePlayer.value.drinks[index] = String(value || "");
  onDrinkChanged(index);
}

function onAbilityChanged(index) {
  const hrid = String(activePlayer.value?.abilities?.[index]?.abilityHrid || "");
  if (hrid) {
    simulator.ensureActivePlayerTriggerDefaults(hrid);
  }
}

function setAbilitySelection(index, value) {
  if (!canReplaceTriggerTarget("ability", index)) {
    return;
  }
  activePlayer.value.abilities[index].abilityHrid = String(value || "");
  onAbilityChanged(index);
}

function applyMarketEnhancement(slot, level) {
  simulator.applyActivePlayerEquipmentEnhancementFromMarket(slot, level);
}

function onAbilityUpgradeCostChanged(slotIndex, rawCost) {
  simulator.setActivePlayerAbilityUpgradeCost(slotIndex, rawCost);
}

function triggerTargetId(kind, index) {
  return `${kind}:${index}`;
}

function isTriggerEditorActive(kind, index) {
  return triggerEditor.kind === kind && triggerEditor.index === index;
}

function triggerTargetView(kind, index) {
  const target = resolveTriggerTarget(kind, index);
  const effective = getEffectiveTriggerState(activePlayer.value?.triggerMap, target.hrid);
  return {
    ...target,
    state: effective.state,
    rules: effective.triggers,
    defaultRules: getDefaultTriggerDtosForHrid(target.hrid),
  };
}

function resetTriggerEditor() {
  triggerEditor.kind = "";
  triggerEditor.index = -1;
  triggerEditor.hrid = "";
  triggerEditor.draft = [];
  triggerEditor.dirty = false;
  triggerEditor.blockedMessage = "";
}

function showTriggerEditorBlockedMessage() {
  triggerEditor.blockedMessage = t(
    "common:vue.home.trigger.saveOrCancelFirst",
    "Save or cancel the current changes first.",
  );
}

function blockPlayerConfigReplacement() {
  if (!triggerEditor.kind || !triggerEditor.dirty) {
    return false;
  }
  showTriggerEditorBlockedMessage();
  return true;
}

function requestWorkspaceTabChange(nextTab) {
  const normalizedTab = ["base", "advanced", "results"].includes(nextTab)
    ? nextTab
    : "base";
  if (normalizedTab === activeWorkspaceTab.value) {
    return true;
  }
  if (triggerEditor.kind && triggerEditor.dirty) {
    showTriggerEditorBlockedMessage();
    return false;
  }
  resetTriggerEditor();
  activeWorkspaceTab.value = normalizedTab;
  return true;
}

function requestTriggerEditor(kind, index) {
  if (isTriggerEditorActive(kind, index)) {
    if (triggerEditor.dirty) {
      showTriggerEditorBlockedMessage();
      return;
    }
    resetTriggerEditor();
    return;
  }

  if (triggerEditor.kind && triggerEditor.dirty) {
    showTriggerEditorBlockedMessage();
    return;
  }

  const view = triggerTargetView(kind, index);
  if (!view.hrid) {
    return;
  }
  triggerEditor.kind = kind;
  triggerEditor.index = index;
  triggerEditor.hrid = view.hrid;
  triggerEditor.draft = cloneValue(view.rules);
  triggerEditor.dirty = false;
  triggerEditor.blockedMessage = "";
}

function updateTriggerDraft(nextDraft) {
  if (!triggerEditor.kind) {
    return;
  }
  triggerEditor.draft = cloneValue(nextDraft);
  triggerEditor.blockedMessage = "";
}

function updateTriggerDirty(kind, index, dirty) {
  if (!isTriggerEditorActive(kind, index)) {
    return;
  }
  triggerEditor.dirty = Boolean(dirty);
  if (!triggerEditor.dirty) {
    triggerEditor.blockedMessage = "";
  }
}

function canReplaceTriggerTarget(kind, index) {
  if (isTriggerEditorActive(kind, index) && triggerEditor.dirty) {
    showTriggerEditorBlockedMessage();
    return false;
  }
  if (isTriggerEditorActive(kind, index)) {
    resetTriggerEditor();
  }
  return true;
}

function saveInlineTriggerRules(nextRules) {
  if (!triggerEditor.hrid) {
    return;
  }
  simulator.setActivePlayerTriggers(triggerEditor.hrid, sanitizeTriggerList(nextRules));
  resetTriggerEditor();
}

function cancelInlineTriggerEditor() {
  resetTriggerEditor();
}

watch(
  () => activePlayer.value,
  (nextPlayer, previousPlayer) => {
    if (restoringTriggerEditorPlayer) {
      restoringTriggerEditorPlayer = false;
      return;
    }

    const nextPlayerId = nextPlayer?.id;
    const previousPlayerId = previousPlayer?.id;

    if (
      triggerEditor.kind
      && triggerEditor.dirty
      && previousPlayerId != null
      && String(nextPlayerId || "") !== String(previousPlayerId || "")
    ) {
      restoringTriggerEditorPlayer = true;
      simulator.setActivePlayer(previousPlayerId);
      showTriggerEditorBlockedMessage();
      return;
    }

    // Imports, snapshots, and queue restores can replace the active player
    // without changing its id. Never allow a draft from the old object to be
    // saved into the replacement configuration.
    if (triggerEditor.kind && nextPlayer !== previousPlayer) {
      resetTriggerEditor();
    }
    ensureActivePlayerAdvancedState();
    if (openHouseRoomsModal.value) {
      captureHouseRoomBaselineLevels();
    }
  },
  { immediate: true },
);

onBeforeRouteLeave(() => {
  if (triggerEditor.kind && triggerEditor.dirty) {
    showTriggerEditorBlockedMessage();
    return false;
  }
  return true;
});

watch(
  () => openHouseRoomsModal.value,
  (isOpen) => {
    if (isOpen) {
      captureHouseRoomBaselineLevels();
      return;
    }
    houseRoomBaselineLevels.value = {};
  },
);

watch(
  () => ([
    simulator.simulationSettings.mooPass,
    simulator.simulationSettings.comExpEnabled,
    simulator.simulationSettings.comExp,
    simulator.simulationSettings.comDropEnabled,
    simulator.simulationSettings.comDrop,
  ]),
  () => {
    simulator.persistSimulationUiSettings();
  },
  { immediate: true },
);

watch(
  () => route.query.focus,
  async (nextFocus) => {
    if (route.name !== "home" || nextFocus !== "results") {
      return;
    }

    await openHomeResultsPanel(true);
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("message", handleTampermonkeyImportWindowMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleTampermonkeyImportWindowMessage);
});
</script>
