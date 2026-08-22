<template>
  <BaseModal
    :open="open"
    :title="t('common:settingsPage.playerDataCardTitle', 'Player Config Snapshot')"
    panel-class="max-w-[96vw] xl:max-w-[1200px]"
    @close="$emit('close')"
  >
    <div class="space-y-3">
      <p class="text-sm text-foreground/85">
        {{ t('common:settingsPage.playerDataDescription', 'Manually save/restore build data for 5 players only.') }}
      </p>
      <p v-if="statusText" class="text-xs" :class="statusClass">{{ statusText }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="button-danger" @click="snapshotController.deleteAll">
          {{ t('common:settingsPage.deleteAllPlayerConfigs', 'Delete All Snapshots') }}
        </button>
      </div>
      <div v-if="!hasData" class="rounded-md border border-border bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
        {{ t('common:settingsPage.playerSnapshotNoData', 'No player snapshot data is currently saved.') }}
      </div>
      <div v-else class="space-y-2">
        <p class="text-xs text-muted-foreground">{{ savedAtLabel }}</p>
        <div class="overflow-x-auto">
          <Table class="min-w-full text-sm"
            ><TableHeader
              ><TableRow class="border-b border-border text-left text-xs uppercase text-muted-foreground"
                ><TableHead class="px-2 py-2">{{
                  t('common:settingsPage.playerSnapshotTablePlayer', 'Player')
                }}</TableHead
                ><TableHead class="px-2 py-2">{{ t('common:settingsPage.playerSnapshotTableZone', 'Zone') }}</TableHead
                ><TableHead class="px-2 py-2">{{
                  getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon')
                }}</TableHead
                ><TableHead class="px-2 py-2">{{
                  t('common:settingsPage.playerSnapshotTableDifficulty', 'Difficulty')
                }}</TableHead
                ><TableHead class="px-2 py-2">{{
                  t('common:settingsPage.playerSnapshotTableDuration', 'Duration(h)')
                }}</TableHead
                ><TableHead class="px-2 py-2">{{
                  getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth')
                }}</TableHead
                ><TableHead class="px-2 py-2">{{
                  t('common:settingsPage.playerSnapshotTableRoomLevel', 'Room Level')
                }}</TableHead
                ><TableHead class="px-2 py-2">{{
                  t('common:settingsPage.playerSnapshotTableActions', 'Actions')
                }}</TableHead></TableRow
              ></TableHeader
            ><TableBody
              ><TableRow v-for="row in rows" :key="row.playerId" class="border-b border-border text-foreground"
                ><TableCell class="px-2 py-2">Player {{ row.playerId }}</TableCell
                ><TableCell class="px-2 py-2">{{
                  row.hasSnapshot ? getActionName(row.zoneHrid, row.zone) : '-'
                }}</TableCell
                ><TableCell class="px-2 py-2">{{
                  row.hasSnapshot ? getActionName(row.dungeonHrid, row.dungeon) : '-'
                }}</TableCell
                ><TableCell class="px-2 py-2">{{ row.hasSnapshot ? row.difficulty : '-' }}</TableCell
                ><TableCell class="px-2 py-2">{{ row.hasSnapshot ? row.simulationTime : '-' }}</TableCell
                ><TableCell class="px-2 py-2">{{
                  row.hasSnapshot ? getMonsterName(row.labyrinthHrid, row.labyrinth) : '-'
                }}</TableCell
                ><TableCell class="px-2 py-2">{{ row.hasSnapshot ? row.roomLevel : '-' }}</TableCell
                ><TableCell class="px-2 py-2"
                  ><button
                    type="button"
                    class="button-secondary"
                    :disabled="!row.hasSnapshot"
                    @click="snapshotController.deleteSingle(row.playerId)"
                  >
                    {{ t('common:settingsPage.deleteSinglePlayerConfig', 'Delete') }}
                  </button></TableCell
                ></TableRow
              ></TableBody
            ></Table
          >
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<script setup>
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table/index.js';
import BaseModal from '../BaseModal.vue';
const props = defineProps({
  open: { type: Boolean, default: false },
  snapshotController: { type: Object, required: true },
});
defineEmits(['close']);
const { t } = useI18nText();
const { getActionName, getMonsterName, getOfficialGameText } = useGameDataText();
const { rows, hasData, savedAtLabel, statusClass, statusText } = props.snapshotController;
</script>
