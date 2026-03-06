<template>
  <section class="space-y-4">
    <HomeWorkspaceTabs
      v-model="activeWorkspaceTab"
      :tabs="workspaceTabs"
      :aria-label="t('common:vue.home.workspaceTabsAria', 'Home workspace sections')"
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

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div class="space-y-4">
      <div class="grid gap-4 xl:grid-cols-12">
      <div v-if="activeWorkspaceTab === 'base'" class="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:col-span-12">
      <div class="panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.levelsTitle", "Levels") }}</h2>
        <div class="grid grid-cols-2 gap-3">
          <label class="col-span-2 block">
            <span class="field-label">{{ t("common:vue.home.averageCombatLevel", "Combat Level") }}</span>
            <input :value="activePlayerCombatLevelLabel" class="field-input" type="text" readonly />
          </label>
          <label v-for="key in levelKeys" :key="key" class="block">
            <span class="field-label">{{ levelLabelMap[key] }}</span>
            <input
              v-model.number="activePlayer.levels[key]"
              :class="['field-input', isLevelChanged(key) ? 'border-amber-300 bg-amber-300/10' : '']"
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
            :class="['rounded-lg border p-3 text-[11px] text-slate-200', card.borderClass, card.bgClass]"
          >
            <h3 class="mb-2 font-medium" :class="card.titleClass">{{ card.title }}</h3>
            <div v-if="card.details" class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
              <span class="text-slate-400">{{ t("common:vue.home.levelEtaTotalExperience", "Total XP") }}</span>
              <span class="text-right">{{ card.details.totalExperience }}</span>
              <span class="text-slate-400">{{ t("common:vue.home.levelEtaRequiredExperience", "XP Needed") }}</span>
              <span class="text-right">{{ card.details.requiredExperience }}</span>
              <span class="text-slate-400">{{ t("common:vue.home.levelEtaRequiredTime", "Time Needed") }}</span>
              <span class="text-right">{{ card.details.requiredTime }}</span>
              <span class="text-slate-400">{{ t("common:vue.home.levelEtaCompletionTime", "Completion Time") }}</span>
              <span class="text-right">{{ card.details.completionTime }}</span>
            </div>
            <p v-else class="text-xs leading-5" :class="card.messageClass">{{ card.message }}</p>
          </article>
        </div>
      </div>

      <div class="panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.simulationTitle", "Simulation") }}</h2>

        <div class="mb-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="field-label">{{ t("common:vue.home.mode", "Mode") }}</span>
            <select v-model="simulationModeProxy" class="field-select">
              <option value="zone">{{ t("common:vue.home.modeZone", "Zone") }}</option>
              <option value="labyrinth">{{ t("common:vue.home.modeLabyrinth", "Labyrinth") }}</option>
            </select>
          </label>

          <label class="block">
            <span class="field-label">{{ t("common:vue.home.runScope", "Run Scope") }}</span>
            <select v-model="runScopeProxy" class="field-select">
              <option v-for="scope in simulator.availableRunScopes" :key="scope.value" :value="scope.value">
                {{ t(`common:vue.home.runScopeOptions.${scope.value}`, scope.label) }}
              </option>
            </select>
          </label>
        </div>

        <div class="mb-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <label class="block">
            <span class="field-label">{{ t("common:vue.home.profileSelectorLabel", "Character Profile") }}</span>
            <select v-model="profileSelectorPlayerId" class="field-select">
              <option v-for="entry in profilePlayerOptions" :key="entry.id" :value="entry.id">
                {{ entry.label }}
              </option>
            </select>
          </label>
          <p class="mt-2 text-xs text-slate-400">
            {{ t("common:vue.home.profileSelectorHint", "Baseline simulation requires imported profile data for current player.") }}
          </p>
          <p
            class="mt-1 text-xs"
            :class="activeProfileImported ? 'text-emerald-300' : 'text-amber-300'"
          >
            {{ activeProfileImported
              ? t("common:vue.home.profileStatusImported", "Imported")
              : t("common:vue.home.profileStatusNotImported", "Not imported") }}
          </p>
        </div>

        <div class="mb-3 grid gap-3 sm:grid-cols-2" v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'single'">
          <label class="block">
            <span class="field-label">{{ t("common:vue.home.combatType", "Combat Type") }}</span>
            <select v-model="dungeonToggleProxy" class="field-select">
              <option :value="false">{{ t("common:vue.home.regularZone", "Regular Zone") }}</option>
              <option :value="true">{{ t("common:vue.home.dungeon", "Dungeon") }}</option>
            </select>
          </label>
        </div>

        <div v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'single'" class="mb-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="field-label">{{ simulator.simulationSettings.useDungeon ? t("common:vue.home.dungeon", "Dungeon") : t("common:vue.home.zone", "Zone") }}</span>
            <select
              v-model="selectedActionHrid"
              class="field-select"
              @change="simulator.normalizeDifficulty()"
            >
              <option v-for="zone in simulator.currentActionOptions" :key="zone.hrid" :value="zone.hrid">
                {{ formatActionName(zone.hrid, zone.name) }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="field-label">
              {{ t("common:vue.home.difficultyMax", "Difficulty", { max: Math.min(5, simulator.currentMaxDifficulty) }) }}
            </span>
            <select
              v-model.number="simulator.simulationSettings.difficultyTier"
              class="field-select"
              @change="simulator.normalizeDifficulty()"
            >
              <option
                v-for="option in difficultyTierOptions"
                :key="option.value"
                :value="option.value"
                :disabled="option.disabled"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

        <div v-else-if="simulator.simulationSettings.mode === 'labyrinth' && simulator.simulationSettings.runScope === 'single'" class="mb-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="field-label">{{ t("common:labyrinth", "Labyrinth") }}</span>
            <select v-model="simulator.simulationSettings.labyrinthHrid" class="field-select">
              <option v-for="monster in simulator.options.labyrinths" :key="monster.hrid" :value="monster.hrid">
                {{ monster.name }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="field-label">{{ t("common:roomLevel", "Room Level") }}</span>
            <input v-model.number="simulator.simulationSettings.roomLevel" class="field-input" type="number" min="20" max="220" />
          </label>
        </div>

        <p v-if="simulator.simulationSettings.runScope !== 'single'" class="mb-3 text-xs text-slate-400">
          {{ t("common:vue.home.batchHint", "Batch mode will run multiple targets and aggregate results in the Home results section.") }}
        </p>

        <div v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'all_group_zones'" class="mb-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="field-label mb-0">{{ t("common:simAllZones", "Sim All Zones") }}</p>
            <label class="badge flex items-center gap-2">
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
              class="badge flex items-center justify-between gap-2 text-slate-100"
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

        <div v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'all_solo_zones'" class="mb-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="field-label mb-0">{{ t("common:simAllSolos", "Sim All Solos") }}</p>
            <label class="badge flex items-center gap-2">
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
              class="badge flex items-center justify-between gap-2 text-slate-100"
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

        <div v-if="simulator.simulationSettings.mode === 'labyrinth'" class="mb-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <p class="field-label">{{ t("common:labyrinthCrates", "Crates") }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="field-label">{{ t("common:coffeeCrate", "Coffee Crate") }}</span>
              <select
                :value="simulator.simulationSettings.labyrinthCrates?.coffee || ''"
                class="field-select"
                @change="simulator.setLabyrinthCrate('coffee', $event.target.value)"
              >
                <option value="">{{ t("common:vue.common.none", "None") }}</option>
                <option v-for="item in simulator.options.labyrinthCrates.coffee" :key="item.hrid" :value="item.hrid">
                  {{ item.name }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="field-label">{{ t("common:foodCrate", "Food Crate") }}</span>
              <select
                :value="simulator.simulationSettings.labyrinthCrates?.food || ''"
                class="field-select"
                @change="simulator.setLabyrinthCrate('food', $event.target.value)"
              >
                <option value="">{{ t("common:vue.common.none", "None") }}</option>
                <option v-for="item in simulator.options.labyrinthCrates.food" :key="item.hrid" :value="item.hrid">
                  {{ item.name }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div class="mb-3 grid gap-3 sm:grid-cols-1">
          <label class="block max-w-sm">
            <span class="field-label">{{ t("common:vue.home.simulationHours", "Simulation Hours") }}</span>
            <input v-model.number="simulator.simulationSettings.simulationTimeHours" class="field-input" type="number" min="1" max="72" />
          </label>
        </div>

        <div class="mb-3 grid gap-3 sm:grid-cols-3">
          <label class="badge flex items-center justify-center gap-2 text-sm">
            <input v-model="simulator.simulationSettings.mooPass" type="checkbox" />
            {{ t("common:vue.home.mooPass", "Moo Pass") }}
          </label>
          <label class="badge flex items-center justify-center gap-2 text-sm">
            <input v-model="simulator.simulationSettings.comExpEnabled" type="checkbox" />
            {{ t("common:vue.home.communityExp", "Community EXP") }}
          </label>
          <label class="badge flex items-center justify-center gap-2 text-sm">
            <input v-model="simulator.simulationSettings.comDropEnabled" type="checkbox" />
            {{ t("common:vue.home.communityDrop", "Community Drop") }}
          </label>
        </div>

        <div class="mb-4 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="field-label">{{ t("common:vue.home.expLevel", "EXP Level") }}</span>
            <input v-model.number="simulator.simulationSettings.comExp" class="field-input" type="number" min="1" max="99" :disabled="!simulator.simulationSettings.comExpEnabled" />
          </label>
          <label class="block">
            <span class="field-label">{{ t("common:vue.home.dropLevel", "Drop Level") }}</span>
            <input v-model.number="simulator.simulationSettings.comDrop" class="field-input" type="number" min="1" max="99" :disabled="!simulator.simulationSettings.comDropEnabled" />
          </label>
        </div>

        <div class="flex flex-wrap gap-2" data-tm-import-anchor="simulator-home-actions">
          <button type="button" class="action-button-primary" :disabled="simulator.runtime.isRunning" @click="simulator.startSimulation()">
            {{ t("common:controls.startSimulation", "Start Simulation") }}
          </button>
          <button type="button" class="action-button-danger" :disabled="!simulator.runtime.isRunning" @click="simulator.stopSimulation()">
            {{ t("common:controls.stopSimulation", "Stop") }}
          </button>
          <button type="button" class="action-button-muted" data-tm-import-reference="import-export" @click="openPlayerImportExportModal">
            {{ t("common:controls.importExport", "Import/Export") }}
          </button>
          <button type="button" class="action-button-muted" @click="openHouseRoomsModal = true">
            {{ t("common:vue.home.houseRoomsButton", "House Rooms") }}
          </button>
          <button type="button" class="action-button-muted" @click="openAchievementsModal = true">
            {{ t("common:vue.home.achievementsButton", "Achievements") }}
          </button>
          <button type="button" class="action-button-muted" @click="openExperimentalModal = true">
            {{ t("common:Experiment.ExperimentalFeatures", "Experimental Features") }}
          </button>
          <button type="button" class="action-button-muted" @click="savePlayerDataSnapshotFromHome">
            {{ t("common:settingsPage.savePlayerConfigs", "Save Player Configs") }}
          </button>
          <button type="button" class="action-button-muted" @click="loadPlayerDataSnapshotFromHome">
            {{ t("common:settingsPage.loadPlayerConfigs", "Load Player Configs") }}
          </button>
          <button type="button" class="action-button-muted" @click="openPlayerSnapshotInfoModal = true">
            {{ t("common:settingsPage.viewPlayerSnapshotInfo", "View Snapshot Info") }}
          </button>
        </div>
        <p v-if="playerSnapshotStatusText" class="mt-2 text-xs" :class="playerSnapshotStatusClass">{{ playerSnapshotStatusText }}</p>
      </div>
      </div>

      <div v-if="activeWorkspaceTab === 'build'" class="space-y-4 xl:col-span-12">
        <div class="panel">
        <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.equipmentTitle", "Equipment") }}</h2>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="slot in equipmentSlots"
            :key="slot"
            :class="[
              'rounded-xl border p-3',
              isEquipmentSlotChanged(slot) ? 'border-amber-300/70 bg-amber-300/10' : 'border-white/10',
            ]"
          >
            <label class="field-label">{{ equipmentLabelMap[slot] }}</label>
            <select v-model="activePlayer.equipment[slot].itemHrid" class="field-select">
              <option value="">{{ t("common:vue.common.none", "None") }}</option>
              <option v-for="item in simulator.options.equipmentBySlot[slot]" :key="item.hrid" :value="item.hrid">
                {{ t("common:vue.home.levelShort", "Lv") }}{{ item.itemLevel }} {{ formatItemName(item.hrid, item.name) }}
              </option>
            </select>
            <div class="mt-2">
              <label class="field-label">{{ t("common:vue.home.enhancement", "Enhancement") }}</label>
              <input v-model.number="activePlayer.equipment[slot].enhancementLevel" class="field-input" type="number" min="0" max="30" />
            </div>
            <div class="mt-2">
              <p class="field-label">{{ t("common:vue.home.marketEnhancements", "Market Enhancements") }}</p>
              <div v-if="equipmentHintViewModel[slot]?.levels?.length > 0" class="mt-1 flex flex-wrap gap-1">
                <button type="button"
                  v-for="level in equipmentHintViewModel[slot].levels"
                  :key="`${slot}-enh-${level}`"
                 
                  class="rounded-md border px-2 py-0.5 text-xs transition"
                  :class="Number(activePlayer.equipment[slot].enhancementLevel || 0) === level
                    ? 'border-amber-300 bg-amber-300/20 text-amber-200'
                    : 'border-white/15 text-slate-300 hover:border-amber-200/70 hover:text-amber-100'"
                  @click="applyMarketEnhancement(slot, level)"
                >
                  +{{ level }}
                </button>
              </div>
              <p v-else class="mt-1 text-xs text-slate-500">
                {{ t("common:vue.home.marketEnhancementsEmpty", "No market enhancement data.") }}
              </p>
            </div>
            <div v-if="equipmentHintViewModel[slot]?.costDraft" class="mt-2 rounded-lg border border-white/10 bg-slate-900/50 p-2">
              <p class="text-xs text-slate-300">
                {{ t("common:equipment.upgradeCost", "Upgrade Cost") }}:
                {{ formatUpgradeCost(equipmentHintViewModel[slot].costDraft.cost) }}
              </p>
              <input
                class="field-input mt-1"
                type="number"
                min="0"
                step="1"
                :value="equipmentHintViewModel[slot].costDraft.cost"
                @change="onEquipmentUpgradeCostChanged(slot, $event.target.value)"
              />
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>

    <div v-if="activeWorkspaceTab === 'build'" class="grid gap-4 lg:grid-cols-2">
        <div class="panel">
          <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.foodDrinksTitle", "Food & Drinks") }}</h2>
            <div class="space-y-3">
              <div v-for="slotIndex in 3" :key="`food-${slotIndex}`" class="grid gap-2 sm:grid-cols-2">
              <div :class="['rounded-xl border p-2', isFoodSlotChanged(slotIndex - 1) ? 'border-amber-300/70 bg-amber-300/10' : 'border-white/10']">
                <label class="field-label">{{ t("common:vue.home.foodSlot", "Food", { index: slotIndex }) }}</label>
                <select v-model="activePlayer.food[slotIndex - 1]" class="field-select" @change="onFoodChanged(slotIndex - 1)">
                  <option value="">{{ t("common:vue.common.none", "None") }}</option>
                  <option v-for="item in simulator.options.food" :key="item.hrid" :value="item.hrid">
                    {{ t("common:vue.home.levelShort", "Lv") }}{{ item.itemLevel }} {{ formatItemName(item.hrid, item.name) }}
                  </option>
                </select>
                <button type="button"
                  class="action-button-muted mt-2 w-full"
                 
                  :disabled="!activePlayer.food[slotIndex - 1]"
                  @click="openTriggerEditor('food', slotIndex - 1)"
                >
                  {{ t("common:trigger", "Trigger") }}
                </button>
              </div>
              <div :class="['rounded-xl border p-2', isDrinkSlotChanged(slotIndex - 1) ? 'border-amber-300/70 bg-amber-300/10' : 'border-white/10']">
                <label class="field-label">{{ t("common:vue.home.drinkSlot", "Drink", { index: slotIndex }) }}</label>
                <select v-model="activePlayer.drinks[slotIndex - 1]" class="field-select" @change="onDrinkChanged(slotIndex - 1)">
                  <option value="">{{ t("common:vue.common.none", "None") }}</option>
                  <option v-for="item in simulator.options.drinks" :key="item.hrid" :value="item.hrid">
                    {{ t("common:vue.home.levelShort", "Lv") }}{{ item.itemLevel }} {{ formatItemName(item.hrid, item.name) }}
                  </option>
                </select>
                <button type="button"
                  class="action-button-muted mt-2 w-full"
                 
                  :disabled="!activePlayer.drinks[slotIndex - 1]"
                  @click="openTriggerEditor('drink', slotIndex - 1)"
                >
                  {{ t("common:trigger", "Trigger") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <h2 class="mb-3 font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.abilitiesTitle", "Abilities") }}</h2>
          <div class="space-y-3">
            <div
              v-for="slotIndex in 5"
              :key="`ability-${slotIndex}`"
              :class="[
                'rounded-xl border p-2',
                isAbilitySlotChanged(slotIndex - 1) ? 'border-amber-300/70 bg-amber-300/10' : 'border-white/10',
              ]"
            >
              <div class="grid gap-2 sm:grid-cols-[1fr_88px_auto]">
                <div>
                  <label class="field-label">{{ getAbilitySlotLabel(slotIndex - 1) }}</label>
                  <select v-model="activePlayer.abilities[slotIndex - 1].abilityHrid" class="field-select" @change="onAbilityChanged(slotIndex - 1)">
                    <option value="">{{ t("common:vue.common.none", "None") }}</option>
                    <option v-for="ability in getAbilityOptionsForSlot(slotIndex - 1)" :key="ability.hrid" :value="ability.hrid">
                      {{ formatAbilityName(ability.hrid, ability.name) }}
                    </option>
                  </select>
                </div>
                <div>
                  <label class="field-label">{{ t("common:vue.home.levelShort", "Lv") }}</label>
                  <input v-model.number="activePlayer.abilities[slotIndex - 1].level" class="field-input" type="number" min="1" max="400" />
                </div>
                <div class="sm:pt-[22px]">
                  <button type="button"
                    class="action-button-muted w-full"
                   
                    :disabled="!activePlayer.abilities[slotIndex - 1].abilityHrid"
                    @click="openTriggerEditor('ability', slotIndex - 1)"
                  >
                    {{ t("common:trigger", "Trigger") }}
                  </button>
                </div>
              </div>
              <div v-if="abilityUpgradeCostDrafts[slotIndex - 1]" class="mt-2 rounded-lg border border-white/10 bg-slate-900/50 p-2">
                <p class="text-xs text-slate-300">
                  {{ t("common:equipment.upgradeCost", "Upgrade Cost") }}:
                  {{ formatUpgradeCost(abilityUpgradeCostDrafts[slotIndex - 1].cost) }}
                </p>
                <input
                  class="field-input mt-1"
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

    <div v-if="activeWorkspaceTab === 'advanced'" class="panel space-y-4">
      <div>
        <h2 class="font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.workspaceAdvancedTitle", "Battle Attributes") }}</h2>
        <p class="mt-1 text-sm text-slate-400">{{ t("common:vue.home.workspaceAdvancedDesc", "Review the full derived combat attributes for the current build.") }}</p>
      </div>

      <div v-if="combatStatRows.length > 0" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="entry in combatStatRows" :key="entry.label" class="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm">
          <p class="text-xs uppercase tracking-[0.12em] text-slate-400">{{ entry.label }}</p>
          <p class="mt-1 text-slate-100">{{ entry.value }}</p>
        </div>
      </div>
      <p v-else class="text-sm text-slate-400">{{ t("common:multiRound.noData", "No data") }}</p>
    </div>
      </div>

      <div class="hidden xl:block xl:self-start xl:sticky xl:top-24">
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

    <BaseModal :open="openHouseRoomsModal" :title="t('common:vue.home.houseRoomsTitle', 'House Rooms')" @close="openHouseRoomsModal = false">
      <div class="space-y-3">
        <div class="grid gap-2 sm:grid-cols-2">
          <label v-for="room in houseRoomOptions" :key="room.hrid" class="block rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <span class="field-label">{{ t(`houseRoomNames.${room.hrid}`, room.name) }}</span>
            <input
              v-model.number="activePlayer.houseRooms[room.hrid]"
              class="field-input"
              type="number"
              min="0"
              max="8"
            />
          </label>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openAchievementsModal"
      :title="t('common:vue.home.achievementsTitle', 'Achievements')"
      panel-class="max-w-[96vw] xl:max-w-[1200px]"
      @close="openAchievementsModal = false"
    >
      <div class="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <DisclosurePanel
          v-for="section in achievementTierSections"
          :key="section.tierHrid"
          :title="`${section.tierName} (${section.checkedCount}/${section.totalCount})`"
        >
          <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span>{{ section.buffText }}</span>
            <button type="button" class="action-button-muted" @click="setTierAchievements(section.tierHrid, true)">
              {{ t("common:vue.home.selectAll", "Select All") }}
            </button>
            <button type="button" class="action-button-muted" @click="setTierAchievements(section.tierHrid, false)">
              {{ t("common:vue.home.clearAll", "Clear All") }}
            </button>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <label
              v-for="detail in section.details"
              :key="detail.hrid"
              class="badge flex items-start gap-2 text-sm text-slate-100"
            >
              <span class="min-w-0 flex-1 leading-snug">{{ t(`achievementNames.${detail.hrid}`, detail.name) }}</span>
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

    <BaseModal :open="triggerModal.open" :title="triggerModalTitle" @close="closeTriggerModal">
      <div class="space-y-3">
        <p class="text-xs uppercase tracking-[0.12em] text-slate-400">{{ t("common:vue.home.trigger.target", "Target") }}</p>
        <p class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-sm text-slate-100">{{ triggerModal.label }}</p>

        <p class="text-xs text-slate-400">
          {{ triggerModal.draft.length === 0
            ? t("common:vue.home.trigger.noRulesHint", "No rules: activate immediately when off cooldown.")
            : t("common:vue.home.trigger.rulesHint", "All rules must pass before this target can trigger.") }}
        </p>

        <div class="space-y-2">
          <div v-for="(trigger, rowIndex) in triggerModal.draft" :key="`trigger-${rowIndex}`" class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <div class="grid gap-2 md:grid-cols-4">
              <label class="block">
                <span class="field-label">{{ t("common:vue.home.trigger.dependency", "Dependency") }}</span>
                <select v-model="trigger.dependencyHrid" class="field-select" @change="onDependencyChanged(rowIndex)">
                  <option value="">{{ t("common:vue.common.select", "Select") }}</option>
                  <option v-for="dependency in triggerDependencyOptions" :key="dependency.hrid" :value="dependency.hrid">
                    {{ formatTriggerDependencyName(dependency.hrid, dependency.name) }}
                  </option>
                </select>
              </label>

              <label class="block">
                <span class="field-label">{{ t("common:vue.home.trigger.condition", "Condition") }}</span>
                <select v-model="trigger.conditionHrid" class="field-select" :disabled="!trigger.dependencyHrid" @change="onConditionChanged(rowIndex)">
                  <option value="">{{ t("common:vue.common.select", "Select") }}</option>
                  <option v-for="condition in getConditionOptions(trigger.dependencyHrid)" :key="condition.hrid" :value="condition.hrid">
                    {{ formatTriggerConditionName(condition.hrid, condition.name) }}
                  </option>
                </select>
              </label>

              <label class="block">
                <span class="field-label">{{ t("common:vue.home.trigger.comparator", "Comparator") }}</span>
                <select v-model="trigger.comparatorHrid" class="field-select" :disabled="!trigger.conditionHrid" @change="onComparatorChanged(rowIndex)">
                  <option value="">{{ t("common:vue.common.select", "Select") }}</option>
                  <option v-for="comparator in getComparatorOptions(trigger.conditionHrid)" :key="comparator.hrid" :value="comparator.hrid">
                    {{ formatTriggerComparatorName(comparator.hrid, comparator.name) }}
                  </option>
                </select>
              </label>

              <label class="block">
                <span class="field-label">{{ t("common:vue.home.trigger.value", "Value") }}</span>
                <input
                  v-model.number="trigger.value"
                  class="field-input"
                  type="number"
                  :disabled="!isComparatorValueRequired(trigger.comparatorHrid)"
                />
              </label>
            </div>
            <div class="mt-2">
              <button type="button" class="action-button-danger" @click="removeTriggerRow(rowIndex)">{{ t("common:vue.common.remove", "Remove") }}</button>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="action-button-muted" :disabled="triggerModal.draft.length >= MAX_TRIGGER_COUNT" @click="addTriggerRow">
            {{ t("common:vue.home.trigger.addRule", "Add Rule") }}
          </button>
          <button type="button" class="action-button-muted" @click="useDefaultTriggers">{{ t("common:vue.home.trigger.useDefault", "Use Default") }}</button>
          <button type="button" class="action-button-muted" @click="clearTriggerRules">{{ t("common:vue.home.trigger.clearRules", "Clear Rules") }}</button>
          <button type="button" class="action-button-primary" :disabled="!isTriggerDraftValid" @click="saveTriggerRules">
            {{ t("common:controls.save", "Save") }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="openPlayerImportModal"
      :title="t('common:controls.importExport', 'Import/Export')"
      panel-class="max-w-[96vw] xl:max-w-[1200px]"
      @close="closePlayerImportModal"
    >
      <div class="space-y-3">
        <div class="flex flex-col gap-3 rounded-2xl border border-teal-300/20 bg-slate-900/70 p-4 shadow-lg shadow-cyan-950/20 sm:flex-row sm:items-center sm:justify-between">
          <div class="space-y-1">
            <p class="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-teal-100">
              {{ t("common:vue.settings.mainSiteImportScriptTitle", "Main-site Import Script") }}
            </p>
            <p class="text-sm text-slate-300">
              {{ t("common:vue.settings.mainSiteImportScriptDescription", "Install the Tampermonkey helper to add one-click import from the main site into the active player slot.") }}
            </p>
            <p v-if="!hasMainSiteImportScriptUrl" class="text-xs text-cyan-200">
              {{ t("common:vue.settings.mainSiteImportScriptPending", "Script link pending") }}
            </p>
          </div>

          <button
            type="button"
            class="action-button-tool shrink-0"
            :disabled="!hasMainSiteImportScriptUrl"
            @click="openMainSiteImportScript"
          >
            {{ t("common:vue.settings.installMainSiteImportScript", "Install Script") }}
          </button>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:vue.settings.groupImportExportTitle", "Group Import/Export") }}</h3>
              <select v-model="groupFormat" class="field-select max-w-[180px]">
                <option value="modern">{{ t("common:vue.settings.modernJson", "Modern JSON") }}</option>
                <option value="legacy">{{ t("common:vue.settings.legacyMap", "Legacy Map") }}</option>
              </select>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="action-button-primary" @click="handleGroupExport">{{ t("common:vue.settings.exportGroup", "Export Group") }}</button>
              <button type="button" class="action-button-muted" @click="copyImportExportText(groupText)">{{ t("common:vue.common.copy", "Copy") }}</button>
              <button type="button" class="action-button-muted" @click="downloadImportExportText(`mwi-group-${groupFormat}.json`, groupText)">{{ t("common:vue.common.download", "Download") }}</button>
              <label class="action-button-muted cursor-pointer">
                {{ t("common:vue.common.loadFile", "Load File") }}
                <input class="hidden" type="file" accept="application/json,.json,.txt" @change="onImportExportFileSelected($event, 'group')" />
              </label>
            </div>

            <textarea v-model="groupText" class="field-input min-h-[220px] font-mono text-xs" spellcheck="false"></textarea>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="action-button-primary" @click="handleGroupImport">{{ t("common:vue.settings.importGroup", "Import Group") }}</button>
              <button type="button" class="action-button-muted" @click="groupText = ''">{{ t("common:vue.common.clear", "Clear") }}</button>
            </div>
          </div>

          <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:vue.settings.soloImportExportTitle", "Solo Import/Export") }}</h3>
              <div class="flex items-center gap-2">
                <select v-model="soloTargetPlayerId" class="field-select max-w-[140px]">
                  <option v-for="player in simulator.players" :key="player.id" :value="player.id">{{ player.name }}</option>
                </select>
                <select v-model="soloFormat" class="field-select max-w-[150px]">
                  <option value="legacy">{{ t("common:vue.settings.legacySolo", "Legacy Solo") }}</option>
                  <option value="modern">{{ t("common:vue.settings.modernSolo", "Modern Solo") }}</option>
                </select>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="action-button-primary" @click="handleSoloExport">{{ t("common:vue.settings.exportSolo", "Export Solo") }}</button>
              <button type="button" class="action-button-muted" @click="copyImportExportText(soloText)">{{ t("common:vue.common.copy", "Copy") }}</button>
              <button type="button" class="action-button-muted" @click="downloadImportExportText(`mwi-solo-${soloTargetPlayerId}-${soloFormat}.json`, soloText)">{{ t("common:vue.common.download", "Download") }}</button>
              <label class="action-button-muted cursor-pointer">
                {{ t("common:vue.common.loadFile", "Load File") }}
                <input class="hidden" type="file" accept="application/json,.json,.txt" @change="onImportExportFileSelected($event, 'solo')" />
              </label>
            </div>

            <textarea v-model="soloText" class="field-input min-h-[220px] font-mono text-xs" spellcheck="false"></textarea>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="action-button-primary" @click="handleSoloImport">{{ t("common:vue.settings.importToPlayer", "Import To Player") }}</button>
              <button type="button" class="action-button-muted" @click="soloText = ''">{{ t("common:vue.common.clear", "Clear") }}</button>
            </div>
          </div>
        </div>

        <p v-if="importExportStatusText" class="text-sm" :class="importExportStatusClass">{{ importExportStatusText }}</p>
      </div>
    </BaseModal>

    <BaseModal :open="openExperimentalModal" :title="t('common:Experiment.ExperimentalFeatures', 'Experimental Features')" @close="openExperimentalModal = false">
      <div class="space-y-3">
        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
          <label class="badge flex items-center justify-between gap-3 text-sm text-slate-100">
            <span>{{ t("common:Experiment.enableHpMpVisualization", "Enable HP/MP Timeline Charts") }}</span>
            <input v-model="simulator.simulationSettings.enableHpMpVisualization" type="checkbox" />
          </label>
        </div>

        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
          <p class="field-label">{{ t("common:Experiment.batchSimFromJson", "Run batch simulations from JSON files") }}</p>
          <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              ref="experimentalFileInput"
              class="field-input"
              type="file"
              accept="application/json,.json,.txt"
              @change="onExperimentalFileSelected"
            />
            <button type="button" class="action-button-primary" :disabled="!experimentalFileReady || experimentalRunning" @click="runExperimentalBatch">
              {{ t("common:Experiment.uploadAndRun", "Upload & Run") }}
            </button>
            <button type="button" class="action-button-muted" :disabled="!experimentalDownloadText" @click="downloadExperimentalResults">
              {{ t("common:Experiment.download", "Download Results") }}
            </button>
          </div>
          <p class="mt-2 text-xs text-slate-400">{{ experimentalStatusText }}</p>
        </div>

        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3">
          <p class="field-label">{{ t("common:Experiment.dungeonStartWave", "Dungeon Start Wave") }}</p>
          <div class="flex items-center gap-3">
            <label class="badge flex items-center gap-2">
              <input v-model="experimentalDungeonStartWaveEnabled" type="checkbox" />
              {{ t("common:Experiment.dungeonStartWave", "Dungeon Start Wave") }}
            </label>
            <input
              v-model.number="experimentalDungeonStartWave"
              class="field-input max-w-[120px]"
              type="number"
              min="1"
              max="100"
              :disabled="!experimentalDungeonStartWaveEnabled"
            />
            <span class="text-xs text-slate-400">{{ t("common:Experiment.wave", "Wave") }}</span>
          </div>
          <p class="mt-2 text-xs text-slate-400">{{ t("common:Experiment.dungeonStartWaveNotConnected", "Start wave is not connected to worker runtime yet.") }}</p>
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
        <p class="text-sm text-slate-300">{{ t("common:settingsPage.playerDataDescription", "Manually save/restore build data for 5 players only.") }}</p>
        <p v-if="playerSnapshotStatusText" class="text-xs" :class="playerSnapshotStatusClass">{{ playerSnapshotStatusText }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="action-button-danger" @click="deleteAllPlayerDataSnapshotsFromHome">
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
                  <td class="px-2 py-2">{{ row.hasSnapshot ? formatActionName(row.zoneHrid, row.zone) : "-" }}</td>
                  <td class="px-2 py-2">{{ row.hasSnapshot ? formatActionName(row.dungeonHrid, row.dungeon) : "-" }}</td>
                  <td class="px-2 py-2">{{ row.hasSnapshot ? row.difficulty : "-" }}</td>
                  <td class="px-2 py-2">{{ row.hasSnapshot ? row.simulationTime : "-" }}</td>
                  <td class="px-2 py-2">{{ row.hasSnapshot ? formatMonsterName(row.labyrinthHrid, row.labyrinth) : "-" }}</td>
                  <td class="px-2 py-2">{{ row.hasSnapshot ? row.roomLevel : "-" }}</td>
                  <td class="px-2 py-2">
                    <button
                      type="button"
                      class="action-button-muted"
                      :disabled="!row.hasSnapshot"
                      @click="deleteSinglePlayerDataSnapshotFromHome(row.playerId)"
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
    </BaseModal>
    <section ref="homeResultsSection" class="panel space-y-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.home.completeResultsEyebrow", "Results") }}</p>
          <h2 class="font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.home.completeResultsTitle", "Complete Results") }}</h2>
          <p class="mt-1 text-sm text-slate-400">
            {{ simulator.runtime.isRunning
              ? t("common:vue.home.completeResultsRunningDesc", "The full report stays collapsed until you want the detailed breakdown, while progress remains visible here.")
              : t("common:vue.home.completeResultsDesc", "Open the detailed report only when you need tables, charts, and per-source breakdowns.") }}
          </p>
        </div>
        <button type="button" class="action-button-muted" :disabled="!homeCanOpenResults" @click="toggleCompleteResultsPanel">
          {{ completeResultsToggleLabel }}
        </button>
      </div>

      <div v-if="completeResultsExpanded" class="space-y-4">
        <AsyncSimulationResultsView v-if="homeHasResults" />
        <div v-else class="rounded-xl border border-dashed border-white/15 bg-slate-900/40 p-4">
          <p class="text-sm text-slate-300">{{ t("common:vue.home.homeResultsEmpty", "Your next simulation result will appear here as soon as it finishes.") }}</p>
        </div>
      </div>

      <div v-else class="rounded-xl border border-dashed border-white/15 bg-slate-900/40 p-4">
        <p class="text-sm text-slate-300">{{ t("common:vue.home.completeResultsCollapsed", "Keep the full report collapsed until you need detailed breakdowns.") }}</p>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import achievementDetailMap from "../../combatsimulator/data/achievementDetailMap.json";
import achievementTierMap from "../../combatsimulator/data/achievementTierDetailMap.json";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import combatStyleDetailMap from "../../combatsimulator/data/combatStyleDetailMap.json";
import damageTypeDetailMap from "../../combatsimulator/data/damageTypeDetailMap.json";
import houseRoomDetailMap from "../../combatsimulator/data/houseRoomDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import {
  MAX_TRIGGER_COUNT,
  getDefaultTriggerDtosForHrid,
  getTriggerComparatorsForCondition,
  getTriggerConditionsForDependency,
  getTriggerDependencies,
  isComparatorValueRequired,
  sanitizeTriggerList,
} from "../../services/triggerMapper.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { buildPlayersForSimulation, calcCombatLevel, EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "../../services/playerMapper.js";
import { buildNoRngProfitBreakdown, buildRandomProfitBreakdown } from "../../services/profitEstimator.js";
import { calculateSkillUpgradeEta } from "../../services/levelExperience.js";
import { useI18nText } from "../composables/useI18nText.js";
import BaseModal from "../components/BaseModal.vue";
import DisclosurePanel from "../components/DisclosurePanel.vue";
import HomeSummaryPanel from "../components/home/HomeSummaryPanel.vue";
import HomeWorkspaceTabs from "../components/home/HomeWorkspaceTabs.vue";

const simulator = useSimulatorStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nText();
const AsyncSimulationResultsView = defineAsyncComponent(() => import("../components/SimulationResultsView.vue"));
const TAMPERMONKEY_BRIDGE_CHANNEL = "mwi-tm-bridge";
const MAIN_SITE_IMPORT_SCRIPT_URL = "https://greasyfork.org/zh-CN/scripts/568613-mwi-combat-simulator-%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5";
const hasMainSiteImportScriptUrl = MAIN_SITE_IMPORT_SCRIPT_URL.trim().length > 0;

const levelKeys = LEVEL_KEYS;
const equipmentSlots = EQUIPMENT_SLOT_KEYS;
const homeResultsSection = ref(null);
const activeWorkspaceTab = ref("base");
const completeResultsExpanded = ref(false);
const homeHasResults = computed(() => (
  Boolean(simulator.results.simResult)
  || (Array.isArray(simulator.results.simResults) && simulator.results.simResults.length > 0)
  || (Array.isArray(simulator.results.summaryRows) && simulator.results.summaryRows.length > 0)
  || (Array.isArray(simulator.results.batchRows) && simulator.results.batchRows.length > 0)
));
const homeCanOpenResults = computed(() => Boolean(simulator.runtime.isRunning || homeHasResults.value));
const activeHomeResultRow = computed(() => simulator.activeResultRow || simulator.results.summaryRows[0] || null);
const activeHomeResultPlayerHrid = computed(() => (
  activeHomeResultRow.value?.playerHrid
  || simulator.results.activeResultPlayerHrid
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
    description: t("common:vue.home.workspaceTabs.baseDesc", "Player, target, mode, run scope, and launch controls."),
  },
  {
    value: "build",
    label: t("common:vue.home.workspaceTabs.build", "Build & Skills"),
    description: t("common:vue.home.workspaceTabs.buildDesc", "Equipment, consumables, abilities, and trigger entry points."),
  },
  {
    value: "advanced",
    label: t("common:vue.home.workspaceTabs.advanced", "Battle Attributes"),
    description: t("common:vue.home.workspaceTabs.advancedDesc", "Full derived combat attributes for the current build."),
  },
]));
const currentRunScopeLabel = computed(() => {
  const currentScope = simulator.availableRunScopes.find((scope) => scope.value === simulator.simulationSettings.runScope);
  return t(`common:vue.home.runScopeOptions.${currentScope?.value || simulator.simulationSettings.runScope}`, currentScope?.label || simulator.simulationSettings.runScope || "-");
});
const currentModeLabel = computed(() => {
  if (simulator.simulationSettings.mode === "labyrinth") {
    return t("common:vue.home.modeLabyrinth", "Labyrinth");
  }
  if (simulator.simulationSettings.useDungeon) {
    return t("common:vue.home.dungeon", "Dungeon");
  }
  return t("common:vue.home.modeZone", "Zone");
});
const currentTargetLabel = computed(() => {
  const settings = simulator.simulationSettings;
  if (settings.mode === "labyrinth" && settings.runScope === "single") {
    const selectedLabyrinth = simulator.options.labyrinths.find((entry) => entry.hrid === settings.labyrinthHrid);
    const labyrinthName = selectedLabyrinth?.name || settings.labyrinthHrid || t("common:labyrinth", "Labyrinth");
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
        borderClass: "border-emerald-400/20",
        bgClass: "bg-emerald-400/5",
        titleClass: "text-emerald-300",
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
        borderClass: "border-amber-400/20",
        bgClass: "bg-amber-400/5",
        titleClass: "text-amber-300",
        messageClass: "text-amber-200",
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
        borderClass: "border-amber-400/20",
        bgClass: "bg-amber-400/5",
        titleClass: "text-amber-300",
        messageClass: "text-amber-200",
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
        borderClass: "border-white/10",
        bgClass: "bg-slate-900/40",
        titleClass: "text-slate-200",
        messageClass: "text-slate-300",
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
        borderClass: "border-amber-400/20",
        bgClass: "bg-amber-400/5",
        titleClass: "text-amber-300",
        messageClass: "text-amber-200",
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
      label: t("common:vue.home.combatStats.combatStyle", "Combat Style"),
      value: stats ? formatCombatStyleName(stats.combatStyleHrid, combatStyleDetailMap?.[stats.combatStyleHrid]?.name || "") : "-",
    },
    {
      label: t("common:vue.home.combatStats.damageType", "Damage Type"),
      value: stats ? formatDamageTypeName(stats.damageType, damageTypeDetailMap?.[stats.damageType]?.name || "") : "-",
    },
    {
      label: t("common:vue.home.combatStats.maxHp", "Max HP"),
      value: details ? formatInt(details.maxHitpoints) : "-",
    },
    {
      label: t("common:vue.home.combatStats.attackInterval", "Attack Interval"),
      value: stats ? `${formatNumber(attackIntervalSeconds, 2)}s` : "-",
    },
    {
      label: t("common:vue.home.combatStats.armor", "Armor"),
      value: details ? formatInt(details.totalArmor) : "-",
    },
  ];
});
const fullResultsButtonLabel = computed(() => (
  simulator.runtime.isRunning
    ? t("common:vue.home.workspaceOpenResultsArea", "Open Results Area")
    : t("common:vue.home.workspaceViewFullResults", "View Full Results")
));
const completeResultsToggleLabel = computed(() => (
  completeResultsExpanded.value
    ? t("common:vue.common.hide", "Hide")
    : t("common:vue.home.workspaceViewFullResults", "View Full Results")
));

async function scrollToHomeResults(clearFocus = false) {
  await nextTick();
  homeResultsSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (clearFocus && route.name === "home" && route.query.focus === "results") {
    await router.replace({ name: "home" });
  }
}

async function openHomeResultsPanel(clearFocus = false) {
  completeResultsExpanded.value = true;
  await scrollToHomeResults(clearFocus);
}

function toggleCompleteResultsPanel() {
  completeResultsExpanded.value = !completeResultsExpanded.value;
}

const levelLabelMap = computed(() => ({
  stamina: t("common:vue.home.levelLabels.stamina", "Stamina"),
  intelligence: t("common:vue.home.levelLabels.intelligence", "Intelligence"),
  attack: t("common:vue.home.levelLabels.attack", "Attack"),
  melee: t("common:vue.home.levelLabels.melee", "Melee"),
  defense: t("common:vue.home.levelLabels.defense", "Defense"),
  ranged: t("common:vue.home.levelLabels.ranged", "Ranged"),
  magic: t("common:vue.home.levelLabels.magic", "Magic"),
}));

const equipmentLabelMap = computed(() => ({
  head: t("common:vue.home.equipmentLabels.head", "Head"),
  body: t("common:vue.home.equipmentLabels.body", "Body"),
  legs: t("common:vue.home.equipmentLabels.legs", "Legs"),
  feet: t("common:vue.home.equipmentLabels.feet", "Feet"),
  hands: t("common:vue.home.equipmentLabels.hands", "Hands"),
  weapon: t("common:vue.home.equipmentLabels.weapon", "Weapon"),
  off_hand: t("common:vue.home.equipmentLabels.off_hand", "Off Hand"),
  pouch: t("common:vue.home.equipmentLabels.pouch", "Pouch"),
  neck: t("common:vue.home.equipmentLabels.neck", "Neck"),
  earrings: t("common:vue.home.equipmentLabels.earrings", "Earrings"),
  ring: t("common:vue.home.equipmentLabels.ring", "Ring"),
  back: t("common:vue.home.equipmentLabels.back", "Back"),
  charm: t("common:vue.home.equipmentLabels.charm", "Charm"),
}));

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
        ? t(`buffTypeNames.${buffTypeHrid}`, buffTypeHrid)
        : t("common:vue.home.buff", "Buff");
      const buffValueRaw = Number(tier?.buff?.ratioBoost || tier?.buff?.flatBoost || 0);
      const buffPercent = `${(buffValueRaw * 100).toFixed(1).replace(/\\.0$/, "")}%`;
      const checkedCount = details.filter((detail) => Boolean(achievements[detail.hrid])).length;

      return {
        tierHrid: tier.hrid,
        tierName: t(`achievementTierNames.${tier.hrid}`, tier.name),
        buffText: `${t("common:vue.home.buff", "Buff")}: ${buffTypeName} +${buffPercent}`,
        details,
        totalCount: details.length,
        checkedCount,
      };
    })
    .filter(Boolean);
});

const triggerDependencyOptions = getTriggerDependencies();
const openHouseRoomsModal = ref(false);
const openAchievementsModal = ref(false);
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
const triggerModal = reactive({
  open: false,
  kind: "",
  index: -1,
  hrid: "",
  label: "",
  draft: [],
});
const groupFormat = ref("modern");
const soloFormat = ref("legacy");
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
    return simulator.simulationSettings.useDungeon;
  },
  set(value) {
    simulator.simulationSettings.useDungeon = Boolean(value);
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
  },
});

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
    return "text-emerald-300";
  }
  if (importExportStatus.value.tone === "danger") {
    return "text-rose-300";
  }
  return "text-slate-400";
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
    return "text-emerald-300";
  }
  if (playerSnapshotStatus.value.tone === "danger") {
    return "text-rose-300";
  }
  return "text-slate-400";
});
const playerSnapshotStatusText = computed(() => playerSnapshotStatus.value.text || "");

const combatDetails = computed(() => {
  if (!activePlayer.value) {
    return null;
  }

  const snapshot = JSON.parse(JSON.stringify(activePlayer.value));
  snapshot.selected = true;
  const playersToSim = buildPlayersForSimulation([snapshot]);
  return playersToSim[0]?.combatDetails || null;
});

const combatStats = computed(() => {
  return combatDetails.value?.combatStats || null;
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
    { label: t("common:vue.home.combatStats.maxHp", "Max HP"), value: formatInt(details.maxHitpoints) },
    { label: t("common:vue.home.combatStats.maxMp", "Max MP"), value: formatInt(details.maxManapoints) },
    { label: t("common:vue.home.combatStats.combatStyle", "Combat Style"), value: combatStyleName },
    { label: t("common:vue.home.combatStats.damageType", "Damage Type"), value: damageTypeName },
    { label: t("common:vue.home.combatStats.primaryTraining", "Primary Training"), value: primaryTrainingName },
    { label: t("common:vue.home.combatStats.focusTraining", "Focus Training"), value: focusTrainingName },
    { label: t("common:vue.home.combatStats.attackInterval", "Attack Interval"), value: `${formatNumber(attackIntervalSeconds, 2)}s` },
    { label: t("common:vue.home.combatStats.stabAccuracy", "Stab Accuracy"), value: formatInt(details.stabAccuracyRating) },
    { label: t("common:vue.home.combatStats.stabDamage", "Stab Damage"), value: formatInt(details.stabMaxDamage) },
    { label: t("common:vue.home.combatStats.slashAccuracy", "Slash Accuracy"), value: formatInt(details.slashAccuracyRating) },
    { label: t("common:vue.home.combatStats.slashDamage", "Slash Damage"), value: formatInt(details.slashMaxDamage) },
    { label: t("common:vue.home.combatStats.smashAccuracy", "Smash Accuracy"), value: formatInt(details.smashAccuracyRating) },
    { label: t("common:vue.home.combatStats.smashDamage", "Smash Damage"), value: formatInt(details.smashMaxDamage) },
    { label: t("common:vue.home.combatStats.defensiveDamage", "Defensive Damage"), value: formatInt(details.defensiveMaxDamage) },
    { label: t("common:vue.home.combatStats.rangedAccuracy", "Ranged Accuracy"), value: formatInt(details.rangedAccuracyRating) },
    { label: t("common:vue.home.combatStats.rangedDamage", "Ranged Damage"), value: formatInt(details.rangedMaxDamage) },
    { label: t("common:vue.home.combatStats.magicAccuracy", "Magic Accuracy"), value: formatInt(details.magicAccuracyRating) },
    { label: t("common:vue.home.combatStats.magicDamage", "Magic Damage"), value: formatInt(details.magicMaxDamage) },
    { label: t("common:vue.home.combatStats.evasion", "Evasion"), value: formatInt(averageEvasion) },
    { label: t("common:vue.home.combatStats.armor", "Armor"), value: formatInt(details.totalArmor) },
    { label: t("common:vue.home.combatStats.criticalRate", "Critical Rate"), value: formatPercent(stats.criticalRate, 2) },
    { label: t("common:vue.home.combatStats.armorPenetration", "Armor Penetration"), value: formatPercent(stats.armorPenetration, 2) },
    { label: t("common:vue.home.combatStats.stabEvasion", "Stab Evasion"), value: formatInt(details.stabEvasionRating) },
    { label: t("common:vue.home.combatStats.slashEvasion", "Slash Evasion"), value: formatInt(details.slashEvasionRating) },
    { label: t("common:vue.home.combatStats.smashEvasion", "Smash Evasion"), value: formatInt(details.smashEvasionRating) },
    { label: t("common:vue.home.combatStats.rangedEvasion", "Ranged Evasion"), value: formatInt(details.rangedEvasionRating) },
    { label: t("common:vue.home.combatStats.magicEvasion", "Magic Evasion"), value: formatInt(details.magicEvasionRating) },
    { label: t("common:vue.home.combatStats.waterResistance", "Water Resistance"), value: formatInt(details.totalWaterResistance) },
    { label: t("common:vue.home.combatStats.natureResistance", "Nature Resistance"), value: formatInt(details.totalNatureResistance) },
    { label: t("common:vue.home.combatStats.fireResistance", "Fire Resistance"), value: formatInt(details.totalFireResistance) },
    { label: t("common:vue.home.combatStats.physicalAmplify", "Physical Amplify"), value: formatPercent(stats.physicalAmplify, 2) },
    { label: t("common:vue.home.combatStats.waterAmplify", "Water Amplify"), value: formatPercent(stats.waterAmplify, 2) },
    { label: t("common:vue.home.combatStats.natureAmplify", "Nature Amplify"), value: formatPercent(stats.natureAmplify, 2) },
    { label: t("common:vue.home.combatStats.fireAmplify", "Fire Amplify"), value: formatPercent(stats.fireAmplify, 2) },
    { label: t("common:vue.home.combatStats.healingAmplify", "Healing Amplify"), value: formatPercent(stats.healingAmplify, 2) },
    { label: t("common:vue.home.combatStats.lifeSteal", "Life Steal"), value: formatPercent(stats.lifeSteal, 2) },
    { label: t("common:vue.home.combatStats.physicalThorns", "Physical Thorns"), value: formatPercent(stats.physicalThorns, 2) },
    { label: t("common:vue.home.combatStats.elementalThorns", "Elemental Thorns"), value: formatPercent(stats.elementalThorns, 2) },
    { label: t("common:vue.home.combatStats.hpRegen", "HP Regen"), value: formatPercent(stats.hpRegenPer10, 2) },
    { label: t("common:vue.home.combatStats.mpRegen", "MP Regen"), value: formatPercent(stats.mpRegenPer10, 2) },
    { label: t("common:vue.home.combatStats.criticalDamage", "Critical Damage Bonus"), value: formatPercent(stats.criticalDamage, 2) },
    { label: t("common:vue.home.combatStats.taskDamage", "Task Damage Bonus"), value: formatPercent(stats.taskDamage, 2) },
    { label: t("common:vue.home.combatStats.waterPenetration", "Water Penetration"), value: formatPercent(stats.waterPenetration, 2) },
    { label: t("common:vue.home.combatStats.naturePenetration", "Nature Penetration"), value: formatPercent(stats.naturePenetration, 2) },
    { label: t("common:vue.home.combatStats.firePenetration", "Fire Penetration"), value: formatPercent(stats.firePenetration, 2) },
    { label: t("common:vue.home.combatStats.abilityHaste", "Ability Haste"), value: formatInt(stats.abilityHaste) },
    { label: t("common:vue.home.combatStats.tenacity", "Tenacity"), value: formatInt(stats.tenacity) },
    { label: t("common:vue.home.combatStats.manaLeech", "Mana Leech"), value: formatPercent(stats.manaLeech, 2) },
    { label: t("common:vue.home.combatStats.castSpeed", "Cast Speed"), value: formatPercent(stats.castSpeed, 2) },
    { label: t("common:vue.home.combatStats.threat", "Threat"), value: formatInt(details.totalThreat) },
    { label: t("common:vue.home.combatStats.parry", "Parry"), value: formatPercent(stats.parry, 2) },
    { label: t("common:vue.home.combatStats.mayhem", "Mayhem"), value: formatPercent(stats.mayhem, 2) },
    { label: t("common:vue.home.combatStats.pierce", "Pierce"), value: formatPercent(stats.pierce, 2) },
    { label: t("common:vue.home.combatStats.curse", "Curse"), value: formatPercent(stats.curse, 2) },
    { label: t("common:vue.home.combatStats.fury", "Fury"), value: formatPercent(stats.fury, 2) },
    { label: t("common:vue.home.combatStats.weaken", "Weaken"), value: formatPercent(stats.weaken, 2) },
    { label: t("common:vue.home.combatStats.ripple", "Ripple"), value: formatPercent(stats.ripple, 2) },
    { label: t("common:vue.home.combatStats.bloom", "Bloom"), value: formatPercent(stats.bloom, 2) },
    { label: t("common:vue.home.combatStats.blaze", "Blaze"), value: formatPercent(stats.blaze, 2) },
    { label: t("common:vue.home.combatStats.attackSpeed", "Attack Speed"), value: formatPercent(stats.attackSpeed, 2) },
    { label: t("common:vue.home.combatStats.autoAttackDamage", "Auto Attack Damage"), value: formatPercent(stats.autoAttackDamage, 2) },
    { label: t("common:vue.home.combatStats.abilityDamage", "Ability Damage"), value: formatPercent(stats.abilityDamage, 2) },
    { label: t("common:vue.home.combatStats.drinkConcentration", "Drink Concentration"), value: formatPercent(stats.drinkConcentration, 2) },
    { label: t("common:vue.home.combatStats.foodHaste", "Food Haste"), value: formatPercent(stats.foodHaste, 2) },
    { label: t("common:vue.home.combatStats.combatExperience", "Experience Rate"), value: formatPercent(stats.combatExperience, 2) },
    { label: t("common:vue.home.combatStats.staminaExperience", "Stamina Experience"), value: formatPercent(stats.staminaExperience, 2) },
    { label: t("common:vue.home.combatStats.intelligenceExperience", "Intelligence Experience"), value: formatPercent(stats.intelligenceExperience, 2) },
    { label: t("common:vue.home.combatStats.attackExperience", "Attack Experience"), value: formatPercent(stats.attackExperience, 2) },
    { label: t("common:vue.home.combatStats.defenseExperience", "Defense Experience"), value: formatPercent(stats.defenseExperience, 2) },
    { label: t("common:vue.home.combatStats.meleeExperience", "Melee Experience"), value: formatPercent(stats.meleeExperience, 2) },
    { label: t("common:vue.home.combatStats.rangedExperience", "Ranged Experience"), value: formatPercent(stats.rangedExperience, 2) },
    { label: t("common:vue.home.combatStats.magicExperience", "Magic Experience"), value: formatPercent(stats.magicExperience, 2) },
  ];

  return rows.filter((entry) => entry.value !== "-");
});

const triggerModalTitle = computed(() => {
  if (!triggerModal.label) {
    return t("common:vue.home.trigger.editorTitle", "Trigger Editor");
  }
  return t("common:vue.home.trigger.editorTitleWithName", "Trigger Editor - {{name}}", { name: triggerModal.label });
});

const isTriggerDraftValid = computed(() => triggerModal.draft.every((entry) => (
  Boolean(entry?.dependencyHrid)
  && Boolean(entry?.conditionHrid)
  && Boolean(entry?.comparatorHrid)
)));

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
  const numeric = Number(value || 0);
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

function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${(numeric * 100).toFixed(digits)}%`;
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
  return t(`skillNames.${hrid}`, hrid);
}

function formatCombatStyleName(combatStyleHrid, fallbackName = "") {
  const hrid = String(combatStyleHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const defaultLabel = fallbackName || combatStyleDetailMap?.[hrid]?.name || hrid;
  return t(`combatStyleNames.${hrid}`, defaultLabel);
}

function formatDamageTypeName(damageTypeHrid, fallbackName = "") {
  const hrid = String(damageTypeHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const resolved = damageTypeDetailMap?.[hrid];
  const normalizedHrid = String(resolved?.hrid || hrid);
  const defaultLabel = fallbackName || resolved?.name || hrid;
  return t(`damageTypeNames.${normalizedHrid}`, defaultLabel);
}

function formatActionName(actionHrid, fallbackName = "") {
  const hrid = String(actionHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return t(`actionNames.${hrid}`, fallbackName || hrid);
}

function formatMonsterName(monsterHrid, fallbackName = "") {
  const hrid = String(monsterHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return t(`monsterNames.${hrid}`, fallbackName || hrid);
}

function formatItemName(itemHrid, fallbackName = "") {
  const hrid = String(itemHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const defaultLabel = fallbackName || itemDetailMap?.[hrid]?.name || hrid;
  return t(`itemNames.${hrid}`, defaultLabel);
}

function formatAbilityName(abilityHrid, fallbackName = "") {
  const hrid = String(abilityHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  const defaultLabel = fallbackName || abilityDetailMap?.[hrid]?.name || hrid;
  return t(`abilityNames.${hrid}`, defaultLabel);
}

function formatTriggerDependencyName(dependencyHrid, fallbackName = "") {
  const hrid = String(dependencyHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return t(`combatTriggerDependencyNames.${hrid}`, fallbackName || hrid);
}

function formatTriggerConditionName(conditionHrid, fallbackName = "") {
  const hrid = String(conditionHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return t(`combatTriggerConditionNames.${hrid}`, fallbackName || hrid);
}

function formatTriggerComparatorName(comparatorHrid, fallbackName = "") {
  const hrid = String(comparatorHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }
  return t(`combatTriggerComparatorNames.${hrid}`, fallbackName || hrid);
}

function getAbilitySlotLabel(index) {
  const slotIndex = Number(index);
  if (slotIndex === 0) {
    return t("abilitySlot.specialAbility", "Special Ability").replace(/<br\s*\/?>/gi, " ");
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

function getSanitizedTriggerText(triggerMap, hrid) {
  const normalizedHrid = normalizeHrid(hrid);
  if (!normalizedHrid) {
    return "[]";
  }
  const source = triggerMap && typeof triggerMap === "object" ? triggerMap : {};
  return JSON.stringify(sanitizeTriggerList(source[normalizedHrid]));
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
    if (getSanitizedTriggerText(currentTriggerMap, normalizedHrid) !== getSanitizedTriggerText(baselineTriggerMap, normalizedHrid)) {
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
  return hasTriggerChangeForHrids([beforeHrid, afterHrid]);
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
  return hasTriggerChangeForHrids([beforeHrid, afterHrid]);
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
  return hasTriggerChangeForHrids([beforeHrid, afterHrid]);
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
  groupText.value = simulator.exportGroupConfig(groupFormat.value);
  setImportExportStatus("success", t("common:vue.settings.msgGroupExported", "Group exported in {{format}} format.", {
    format: groupFormat.value,
  }));
}

function handleSoloExport() {
  soloText.value = simulator.exportSoloConfig(soloTargetPlayerId.value, soloFormat.value);
  setImportExportStatus("success", t("common:vue.settings.msgSoloExported", "Player {{player}} exported in {{format}} format.", {
    player: soloTargetPlayerId.value,
    format: soloFormat.value,
  }));
}

function handleGroupImport() {
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

  const requestId = String(data.requestId || "").trim();
  if (!requestId) {
    return;
  }

  try {
    const result = simulator.importSoloConfig(JSON.stringify(data.payload || {}), simulator.activePlayerId);
    postTampermonkeyImportResult({
      type: "mwi-tm-import-result",
      requestId,
      ok: true,
      detectedFormat: result?.detectedFormat || "",
      message: `Imported main-site profile into player ${simulator.activePlayerId}.`,
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

function createEmptyTriggerRule() {
  return {
    dependencyHrid: "",
    conditionHrid: "",
    comparatorHrid: "",
    value: 0,
  };
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
      label: hrid ? formatAbilityName(hrid, abilityDetailMap[hrid]?.name || getAbilitySlotLabel(index)) : getAbilitySlotLabel(index),
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

function onDrinkChanged(index) {
  const hrid = String(activePlayer.value?.drinks?.[index] || "");
  if (hrid) {
    simulator.ensureActivePlayerTriggerDefaults(hrid);
  }
}

function onAbilityChanged(index) {
  const hrid = String(activePlayer.value?.abilities?.[index]?.abilityHrid || "");
  if (hrid) {
    simulator.ensureActivePlayerTriggerDefaults(hrid);
  }
}

function applyMarketEnhancement(slot, level) {
  simulator.applyActivePlayerEquipmentEnhancementFromMarket(slot, level);
}

function onEquipmentUpgradeCostChanged(slot, rawCost) {
  simulator.setActivePlayerEquipmentUpgradeCost(slot, rawCost);
}

function onAbilityUpgradeCostChanged(slotIndex, rawCost) {
  simulator.setActivePlayerAbilityUpgradeCost(slotIndex, rawCost);
}

function openTriggerEditor(kind, index) {
  const target = resolveTriggerTarget(kind, index);
  if (!target.hrid) {
    return;
  }

  simulator.ensureActivePlayerTriggerDefaults(target.hrid);
  const currentRules = simulator.getActivePlayerTriggers(target.hrid);

  triggerModal.kind = kind;
  triggerModal.index = index;
  triggerModal.hrid = target.hrid;
  triggerModal.label = target.label;
  triggerModal.draft = cloneValue(currentRules);
  triggerModal.open = true;
}

function closeTriggerModal() {
  triggerModal.open = false;
  triggerModal.kind = "";
  triggerModal.index = -1;
  triggerModal.hrid = "";
  triggerModal.label = "";
  triggerModal.draft = [];
}

function onDependencyChanged(index) {
  const row = triggerModal.draft[index];
  if (!row) {
    return;
  }
  row.conditionHrid = "";
  row.comparatorHrid = "";
  row.value = 0;
}

function onConditionChanged(index) {
  const row = triggerModal.draft[index];
  if (!row) {
    return;
  }
  row.comparatorHrid = "";
  row.value = 0;
}

function onComparatorChanged(index) {
  const row = triggerModal.draft[index];
  if (!row) {
    return;
  }

  if (!isComparatorValueRequired(row.comparatorHrid)) {
    row.value = 0;
  }
}

function getConditionOptions(dependencyHrid) {
  return getTriggerConditionsForDependency(dependencyHrid);
}

function getComparatorOptions(conditionHrid) {
  return getTriggerComparatorsForCondition(conditionHrid);
}

function addTriggerRow() {
  if (triggerModal.draft.length >= MAX_TRIGGER_COUNT) {
    return;
  }
  triggerModal.draft.push(createEmptyTriggerRule());
}

function removeTriggerRow(index) {
  triggerModal.draft.splice(index, 1);
}

function useDefaultTriggers() {
  triggerModal.draft = cloneValue(getDefaultTriggerDtosForHrid(triggerModal.hrid));
}

function clearTriggerRules() {
  triggerModal.draft = [];
}

function saveTriggerRules() {
  if (!isTriggerDraftValid.value) {
    return;
  }
  const sanitized = sanitizeTriggerList(triggerModal.draft);
  simulator.setActivePlayerTriggers(triggerModal.hrid, sanitized);
  closeTriggerModal();
}

watch(
  () => activePlayer.value?.id,
  () => {
    ensureActivePlayerAdvancedState();
  },
  { immediate: true },
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
