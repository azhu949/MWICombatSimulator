<template>
  <div class="surface-panel">
    <h2 class="mb-3 font-heading text-lg font-semibold text-primary">
      {{ t('common:vue.home.simulationTitle', 'Simulation') }}
    </h2>

    <div class="mb-3 grid gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="control-label">{{ t('common:vue.home.mode', 'Mode') }}</span>
        <Select v-model="simulationModeProxy">
          <SelectTrigger />
          <SelectContent>
            <SelectItem value="zone">{{ t('common:vue.home.modeZone', 'Zone') }}</SelectItem>
            <SelectItem value="labyrinth">{{
              getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth')
            }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label class="block">
        <span class="control-label">{{ t('common:vue.home.runScope', 'Run Scope') }}</span>
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
        <span class="control-label">{{ t('common:vue.home.profileSelectorLabel', 'Character Profile') }}</span>
        <Select v-model="profileSelectorPlayerId">
          <SelectTrigger :aria-label="t('common:vue.home.profileSelectorLabel', 'Character Profile')" />
          <SelectContent>
            <SelectItem v-for="entry in profilePlayerOptions" :key="entry.id" :value="String(entry.id)">{{
              entry.label
            }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <p class="mt-2 text-xs text-muted-foreground">
        {{
          t(
            'common:vue.home.profileSelectorHint',
            'Baseline simulation requires imported profile data for current player.',
          )
        }}
      </p>
      <p class="mt-1 text-xs" :class="activeProfileImported ? 'text-success' : 'text-primary'">
        {{
          activeProfileImported
            ? t('common:vue.home.profileStatusImported', 'Imported')
            : t('common:vue.home.profileStatusNotImported', 'Not imported')
        }}
      </p>
    </div>

    <div
      v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'single'"
      class="mb-3 grid gap-3 sm:grid-cols-2"
    >
      <label class="block">
        <span class="control-label">{{ t('common:vue.home.combatType', 'Combat Type') }}</span>
        <Select v-model="dungeonToggleProxy">
          <SelectTrigger :aria-label="t('common:vue.home.combatType', 'Combat Type')" />
          <SelectContent>
            <SelectItem value="zone">{{ t('common:vue.home.regularZone', 'Regular Zone') }}</SelectItem>
            <SelectItem value="dungeon">{{
              getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon')
            }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>

    <div
      v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'single'"
      class="mb-3 grid gap-3 sm:grid-cols-2"
    >
      <div class="block">
        <span class="control-label">{{
          simulator.simulationSettings.useDungeon
            ? getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon')
            : t('common:vue.home.zone', 'Zone')
        }}</span>
        <SearchCombobox
          v-model="selectedActionHrid"
          :options="currentActionComboboxOptions"
          :placeholder="t('common:vue.home.searchTarget', 'Search target')"
          :aria-label="
            simulator.simulationSettings.useDungeon
              ? getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon')
              : t('common:vue.home.zone', 'Zone')
          "
          :empty-label="t('common:vue.common.noResults', 'No results')"
          :open-label="t('common:vue.common.openOptions', 'Open options')"
          :more-results-label="
            t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')
          "
          :max-results="60"
        />
      </div>
      <label class="block">
        <span class="control-label">{{
          t('common:vue.home.difficultyMax', 'Difficulty', {
            max: Math.min(5, simulator.currentMaxDifficulty),
          })
        }}</span>
        <Select
          v-model="simulator.simulationSettings.difficultyTier"
          @update:model-value="simulator.normalizeDifficulty()"
        >
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

    <div
      v-else-if="
        simulator.simulationSettings.mode === 'labyrinth' && simulator.simulationSettings.runScope === 'single'
      "
      class="mb-3 grid gap-3 sm:grid-cols-2"
    >
      <label class="block">
        <span class="control-label">{{ getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth') }}</span>
        <Select v-model="simulator.simulationSettings.labyrinthHrid">
          <SelectTrigger :aria-label="getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth')" />
          <SelectContent>
            <SelectItem v-for="monster in simulator.options.labyrinths" :key="monster.hrid" :value="monster.hrid">
              {{ getMonsterName(monster.hrid, monster.name) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label class="block">
        <span class="control-label">{{ t('common:roomLevel', 'Room Level') }}</span>
        <input
          v-model.number="simulator.simulationSettings.roomLevel"
          class="control-input"
          type="number"
          :min="LABYRINTH_ROOM_LEVEL_MIN"
          :max="LABYRINTH_ROOM_LEVEL_MAX"
        />
      </label>
    </div>

    <p v-if="simulator.simulationSettings.runScope !== 'single'" class="mb-3 text-xs text-muted-foreground">
      {{
        t(
          'common:vue.home.batchHint',
          'Batch mode will run multiple targets and aggregate results in the Home results section.',
        )
      }}
    </p>

    <div
      v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'all_group_zones'"
      class="mb-3 rounded-md border border-border bg-muted/50 p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="control-label mb-0">{{ t('common:simAllZones', 'Sim All Zones') }}</p>
        <label class="status-chip flex items-center gap-2">
          <input :checked="allGroupZonesChecked" type="checkbox" @change="toggleAllGroupZones($event.target.checked)" />
          {{ t('common:selectAllOrNot', 'Select / Deselect All') }}
        </label>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label
          v-for="zone in simulator.groupZoneOptions"
          :key="zone.hrid"
          class="status-chip flex items-center justify-between gap-2 text-foreground"
        >
          <span>{{ getActionName(zone.hrid, zone.name) }}</span>
          <input
            :checked="selectedGroupZoneSet.has(zone.hrid)"
            type="checkbox"
            @change="simulator.toggleSelectedGroupZoneHrid(zone.hrid, $event.target.checked)"
          />
        </label>
      </div>
    </div>

    <div
      v-if="simulator.simulationSettings.mode === 'zone' && simulator.simulationSettings.runScope === 'all_solo_zones'"
      class="mb-3 rounded-md border border-border bg-muted/50 p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="control-label mb-0">{{ t('common:simAllSolos', 'Sim All Solos') }}</p>
        <label class="status-chip flex items-center gap-2">
          <input :checked="allSoloZonesChecked" type="checkbox" @change="toggleAllSoloZones($event.target.checked)" />
          {{ t('common:selectAllOrNot', 'Select / Deselect All') }}
        </label>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label
          v-for="zone in simulator.soloZoneOptions"
          :key="zone.hrid"
          class="status-chip flex items-center justify-between gap-2 text-foreground"
        >
          <span>{{ getActionName(zone.hrid, zone.name) }}</span>
          <input
            :checked="selectedSoloZoneSet.has(zone.hrid)"
            type="checkbox"
            @change="simulator.toggleSelectedSoloZoneHrid(zone.hrid, $event.target.checked)"
          />
        </label>
      </div>
    </div>

    <div
      v-if="simulator.simulationSettings.mode === 'labyrinth'"
      class="mb-3 rounded-md border border-border bg-muted/50 p-3"
    >
      <p class="control-label">{{ getOfficialGameText('labyrinthPanel', 'crates', 'Crates') }}</p>
      <div class="grid gap-3 sm:grid-cols-3">
        <label v-for="crateType in labyrinthCrateTypes" :key="crateType.key" class="block">
          <span class="control-label">{{
            getOfficialGameText('labyrinthPanel', crateType.labelKey, crateType.fallback)
          }}</span>
          <Select
            :model-value="labyrinthCrateSelectValue(crateType.key)"
            @update:model-value="setLabyrinthCrateSelection(crateType.key, $event)"
          >
            <SelectTrigger
              :aria-label="getOfficialGameText('labyrinthPanel', crateType.labelKey, crateType.fallback)"
            />
            <SelectContent>
              <SelectItem :value="EMPTY_SELECT_VALUE">{{ t('common:vue.common.none', 'None') }}</SelectItem>
              <SelectItem
                v-for="item in simulator.options.labyrinthCrates[crateType.key]"
                :key="item.hrid"
                :value="item.hrid"
              >
                {{ getItemName(item.hrid, item.name) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>

    <div class="mb-3 grid gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="control-label">{{ t('common:vue.home.simulationHours', 'Simulation Hours') }}</span>
        <input
          v-model.number="simulator.simulationSettings.simulationTimeHours"
          class="control-input"
          type="number"
          min="1"
          max="72"
        />
      </label>
      <div class="flex flex-wrap items-end gap-2">
        <label class="status-chip min-h-9 flex items-center justify-center gap-2 text-sm">
          <input
            :checked="combatScrollsEffectsEnabled"
            type="checkbox"
            @change="setCombatScrollsEnabled($event.target.checked)"
          />
          {{ t('common:vue.home.combatScrolls.button', 'Enable Combat Scroll Effects') }}
        </label>
        <button type="button" class="button-secondary" @click="$emit('open-combat-scrolls')">
          {{ t('common:vue.home.combatScrolls.configureButton', 'Configure') }}
        </button>
      </div>
    </div>

    <div class="mb-3 grid gap-3 sm:grid-cols-3">
      <label class="status-chip flex items-center justify-center gap-2 text-sm"
        ><input v-model="simulator.simulationSettings.mooPass" type="checkbox" />{{
          getOfficialGameText('mooPass', 'mooPass', 'MooPass')
        }}</label
      >
      <label class="status-chip flex items-center justify-center gap-2 text-sm"
        ><input v-model="simulator.simulationSettings.comExpEnabled" type="checkbox" />{{
          t('common:vue.home.communityExp', 'Community EXP')
        }}</label
      >
      <label class="status-chip flex items-center justify-center gap-2 text-sm"
        ><input v-model="simulator.simulationSettings.comDropEnabled" type="checkbox" />{{
          t('common:vue.home.communityDrop', 'Community Drop')
        }}</label
      >
    </div>

    <div class="mb-4 grid gap-3 sm:grid-cols-2">
      <label class="block"
        ><span class="control-label">{{ t('common:vue.home.expLevel', 'EXP Level') }}</span
        ><input
          v-model.number="simulator.simulationSettings.comExp"
          class="control-input"
          type="number"
          min="1"
          max="99"
          :disabled="!simulator.simulationSettings.comExpEnabled"
      /></label>
      <label class="block"
        ><span class="control-label">{{ t('common:vue.home.dropLevel', 'Drop Level') }}</span
        ><input
          v-model.number="simulator.simulationSettings.comDrop"
          class="control-input"
          type="number"
          min="1"
          max="99"
          :disabled="!simulator.simulationSettings.comDropEnabled"
      /></label>
    </div>

    <div class="flex flex-wrap gap-2" data-tm-import-anchor="simulator-home-actions">
      <button
        type="button"
        class="button-primary"
        :disabled="simulator.runtime.isRunning"
        @click="simulator.startSimulation()"
      >
        {{ t('common:controls.startSimulation', 'Start Simulation') }}
      </button>
      <button
        type="button"
        class="button-danger"
        :disabled="!simulator.runtime.isRunning"
        @click="simulator.stopSimulation()"
      >
        {{ t('common:controls.stopSimulation', 'Stop') }}
      </button>
      <button
        type="button"
        class="button-secondary"
        data-tm-import-reference="import-export"
        @click="$emit('open-import-export')"
      >
        {{ t('common:controls.importExport', 'Import/Export') }}
      </button>
      <button type="button" class="button-secondary" @click="$emit('open-house-rooms')">
        {{ t('common:vue.home.houseRooms.button', 'House Rooms') }}
      </button>
      <button type="button" class="button-secondary" @click="$emit('open-achievements')">
        {{ getOfficialGameText('achievementsPanel', 'achievements', 'Achievements') }}
      </button>
      <button type="button" class="button-secondary" @click="$emit('open-guild-buffs')">
        {{ t('common:vue.home.guildBuffs.button', 'Guild Shrines') }}
      </button>
      <button type="button" class="button-secondary" @click="$emit('open-experimental')">
        {{ t('common:Experiment.ExperimentalFeatures', 'Experimental Features') }}
      </button>
      <button type="button" class="button-secondary" @click="snapshotController.save">
        {{ t('common:settingsPage.savePlayerConfigs', 'Save Player Configs') }}
      </button>
      <button type="button" class="button-secondary" @click="snapshotController.load">
        {{ t('common:settingsPage.loadPlayerConfigs', 'Load Player Configs') }}
      </button>
      <button type="button" class="button-secondary" @click="$emit('open-snapshot-info')">
        {{ t('common:settingsPage.viewPlayerSnapshotInfo', 'View Snapshot Info') }}
      </button>
    </div>
    <p v-if="snapshotStatusText" class="mt-2 text-xs" :class="snapshotStatusClass">{{ snapshotStatusText }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from 'vue';
import { LABYRINTH_ROOM_LEVEL_MAX, LABYRINTH_ROOM_LEVEL_MIN } from '../../../shared/labyrinthConfig.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { SearchCombobox } from '../ui/combobox/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select/index.js';

const props = defineProps({
  snapshotController: { type: Object, required: true },
});
defineEmits([
  'open-combat-scrolls',
  'open-import-export',
  'open-house-rooms',
  'open-achievements',
  'open-guild-buffs',
  'open-experimental',
  'open-snapshot-info',
]);

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getActionName, getItemName, getMonsterName, getOfficialGameText } = useGameDataText();
const EMPTY_SELECT_VALUE = '__none__';
const SIMULATION_UI_PERSIST_DELAY_MS = 250;
const labyrinthCrateTypes = [
  { key: 'coffee', labelKey: 'coffeeCrate', fallback: 'Coffee Crate' },
  { key: 'food', labelKey: 'foodCrate', fallback: 'Food Crate' },
  { key: 'tea', labelKey: 'teaCrate', fallback: 'Tea Crate' },
];
const snapshotStatusText = props.snapshotController.statusText;
const snapshotStatusClass = props.snapshotController.statusClass;
const combatScrollsEffectsEnabled = computed(() => Boolean(simulator.simulationSettings.combatScrollsEnabled));
const simulationModeProxy = computed({
  get: () => simulator.simulationSettings.mode,
  set: (value) => simulator.setSimulationMode(value),
});
const runScopeProxy = computed({
  get: () => simulator.simulationSettings.runScope,
  set: (value) => simulator.setRunScope(value),
});
const dungeonToggleProxy = computed({
  get: () => (simulator.simulationSettings.useDungeon ? 'dungeon' : 'zone'),
  set(value) {
    simulator.simulationSettings.useDungeon = value === 'dungeon';
    simulator.normalizeDifficulty();
  },
});
const selectedActionHrid = computed({
  get: () =>
    simulator.simulationSettings.useDungeon
      ? simulator.simulationSettings.dungeonHrid
      : simulator.simulationSettings.zoneHrid,
  set(value) {
    if (simulator.simulationSettings.useDungeon) {
      simulator.simulationSettings.dungeonHrid = value;
    } else {
      simulator.simulationSettings.zoneHrid = value;
    }
    simulator.normalizeDifficulty();
  },
});
const currentActionComboboxOptions = computed(() =>
  simulator.currentActionOptions.map((action) => ({
    value: action.hrid,
    label: getActionName(action.hrid, action.name),
  })),
);
const difficultyTierOptions = computed(() => {
  const maxDifficulty = Math.min(5, Number(simulator.currentMaxDifficulty || 0));
  return [0, 1, 2, 3, 4, 5].map((tier) => ({ value: tier, label: `T${tier}`, disabled: tier > maxDifficulty }));
});
const selectedGroupZoneSet = computed(() => new Set(simulator.simulationSettings.selectedGroupZoneHrids || []));
const selectedSoloZoneSet = computed(() => new Set(simulator.simulationSettings.selectedSoloZoneHrids || []));
const allGroupZonesChecked = computed(
  () =>
    simulator.groupZoneOptions.length > 0 &&
    simulator.groupZoneOptions.every((zone) => selectedGroupZoneSet.value.has(zone.hrid)),
);
const allSoloZonesChecked = computed(
  () =>
    simulator.soloZoneOptions.length > 0 &&
    simulator.soloZoneOptions.every((zone) => selectedSoloZoneSet.value.has(zone.hrid)),
);
const profilePlayerOptions = computed(() =>
  simulator.players.map((player) => {
    const imported = simulator.queue?.importedProfileByPlayer?.[player.id] === true;
    const importedText = imported
      ? t('common:vue.home.profileStatusImported', 'Imported')
      : t('common:vue.home.profileStatusNotImported', 'Not imported');
    return { id: player.id, label: `${player.name || `Player ${player.id}`} (${importedText})` };
  }),
);
const profileSelectorPlayerId = computed({
  get: () => simulator.activePlayerId,
  set: (value) => simulator.setActivePlayer(String(value || '1')),
});
const activeProfileImported = computed(
  () => simulator.queue?.importedProfileByPlayer?.[simulator.activePlayerId] === true,
);

function labyrinthCrateSelectValue(crateType) {
  return String(simulator.simulationSettings.labyrinthCrates?.[crateType] || EMPTY_SELECT_VALUE);
}

function setLabyrinthCrateSelection(crateType, value) {
  simulator.setLabyrinthCrate(crateType, value === EMPTY_SELECT_VALUE ? '' : String(value || ''));
}

function toggleAllGroupZones(checked) {
  simulator.setSelectedGroupZoneHrids(checked ? simulator.groupZoneOptions.map((zone) => zone.hrid) : []);
}

function toggleAllSoloZones(checked) {
  simulator.setSelectedSoloZoneHrids(checked ? simulator.soloZoneOptions.map((zone) => zone.hrid) : []);
}

function setCombatScrollsEnabled(enabled) {
  simulator.simulationSettings.combatScrollsEnabled = Boolean(enabled);
}

function simulationUiSettingsKey(
  values = [
    simulator.simulationSettings.mooPass,
    simulator.simulationSettings.comExpEnabled,
    simulator.simulationSettings.comExp,
    simulator.simulationSettings.comDropEnabled,
    simulator.simulationSettings.comDrop,
    simulator.simulationSettings.combatScrollsEnabled,
  ],
) {
  return JSON.stringify(values);
}

let simulationUiPersistTimer = null;
let persistedSimulationUiSettingsKey = simulationUiSettingsKey();

function persistSimulationUiSettingsNow() {
  if (simulationUiPersistTimer !== null) {
    clearTimeout(simulationUiPersistTimer);
    simulationUiPersistTimer = null;
  }
  simulator.persistSimulationUiSettings();
  persistedSimulationUiSettingsKey = simulationUiSettingsKey();
}

function scheduleSimulationUiSettingsPersist(values) {
  if (simulationUiPersistTimer !== null) {
    clearTimeout(simulationUiPersistTimer);
    simulationUiPersistTimer = null;
  }
  if (simulationUiSettingsKey(values) === persistedSimulationUiSettingsKey) {
    return;
  }
  simulationUiPersistTimer = setTimeout(persistSimulationUiSettingsNow, SIMULATION_UI_PERSIST_DELAY_MS);
}

watch(
  () => [
    simulator.simulationSettings.mooPass,
    simulator.simulationSettings.comExpEnabled,
    simulator.simulationSettings.comExp,
    simulator.simulationSettings.comDropEnabled,
    simulator.simulationSettings.comDrop,
    simulator.simulationSettings.combatScrollsEnabled,
  ],
  scheduleSimulationUiSettingsPersist,
);

onBeforeUnmount(() => {
  if (simulationUiPersistTimer !== null) {
    persistSimulationUiSettingsNow();
  }
});
</script>
