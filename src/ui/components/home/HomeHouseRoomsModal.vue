<template>
  <BaseModal
    :open="open"
    :title="t('common:vue.home.houseRooms.title', 'House Rooms')"
    panel-class="max-w-[96vw] xl:max-w-[1280px]"
    @close="$emit('close')"
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
                    {{
                      formatHouseRoomTransition(
                        houseRoomBaselineLevelMap[room.hrid] ?? 0,
                        activePlayer.houseRooms[room.hrid] ?? 0,
                      )
                    }}
                  </p>
                </div>
                <span
                  class="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                  >{{ formatUpgradeCost(houseRoomPreviewByHrid[room.hrid]?.subtotal ?? 0) }}</span
                >
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
              <p class="text-[11px] uppercase text-primary">
                {{ t('common:vue.home.houseRooms.summaryTotal', 'Total Cost') }}
              </p>
              <p class="mt-2 font-heading text-2xl text-primary">
                {{ formatUpgradeCost(houseRoomUpgradePreview.totals.totalCost) }}
              </p>
              <p class="mt-1 text-xs text-foreground/85">
                {{ formatCurrency(houseRoomUpgradePreview.totals.totalCost) }}
              </p>
            </article>
            <article class="rounded-md border border-success/40 bg-success/10 p-4">
              <p class="text-[11px] uppercase text-success">
                {{ t('common:vue.home.houseRooms.summaryCoins', 'Coins Needed') }}
              </p>
              <p class="mt-2 font-heading text-2xl text-success">
                {{ formatUpgradeCost(houseRoomUpgradePreview.totals.coinCost) }}
              </p>
              <p class="mt-1 text-xs text-foreground/85">
                {{ formatCurrency(houseRoomUpgradePreview.totals.coinCost) }}
              </p>
            </article>
            <article class="rounded-md border border-info/40 bg-info/10 p-4">
              <p class="text-[11px] uppercase text-info">
                {{ t('common:vue.home.houseRooms.summaryKinds', 'Material Types') }}
              </p>
              <p class="mt-2 font-heading text-2xl text-info">
                {{ formatInt(houseRoomMaterialKindCount) }}
              </p>
              <p class="mt-1 text-xs text-foreground/85">
                {{ formatHouseRoomChangedRoomsText(houseRoomChangedRooms.length) }}
              </p>
            </article>
          </div>
          <div class="rounded-md border border-border bg-muted/50 p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 class="font-heading text-sm font-semibold text-foreground">
                  {{ t('common:vue.home.houseRooms.changedTitle', 'Upgrade Summary') }}
                </h3>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{
                    t(
                      'common:vue.home.houseRooms.changedHint',
                      'Costs accumulate from the levels captured when this dialog opened.',
                    )
                  }}
                </p>
              </div>
              <span
                v-if="houseRoomMissingPriceCount > 0"
                class="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive"
                >{{ formatHouseRoomMissingPriceHint(houseRoomMissingPriceCount) }}</span
              >
            </div>
            <div
              v-if="houseRoomChangedRooms.length === 0"
              class="rounded-md border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground"
            >
              {{ t('common:vue.home.houseRooms.noUpgrades', 'No room upgrades selected yet.') }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="room in houseRoomChangedRooms"
                :key="room.roomHrid"
                class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2.5"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">
                    {{ getHouseRoomName(room.roomHrid, houseRoomDetailMap?.[room.roomHrid]?.name || room.roomHrid) }}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {{ formatHouseRoomTransition(room.fromLevel, room.toLevel) }}
                  </p>
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
              {{ t('common:vue.home.houseRooms.materialsTitle', 'Material Breakdown') }}
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              {{
                t(
                  'common:vue.home.houseRooms.materialsHint',
                  'Market value uses the current buy-side price with vendor fallback.',
                )
              }}
            </p>
          </div>
          <span class="text-xs text-muted-foreground">{{ formatInt(houseRoomUpgradePreview.materials.length) }}</span>
        </div>
        <div
          v-if="houseRoomUpgradePreview.materials.length === 0"
          class="rounded-md border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground"
        >
          {{ t('common:vue.home.houseRooms.noUpgrades', 'No room upgrades selected yet.') }}
        </div>
        <div v-else class="overflow-x-auto">
          <Table class="min-w-full table-auto text-left text-sm text-foreground">
            <TableHeader
              ><TableRow class="border-b border-border text-xs uppercase text-muted-foreground"
                ><TableHead class="px-2 py-2">{{ t('common:vue.home.houseRooms.materialName', 'Material') }}</TableHead
                ><TableHead class="px-2 py-2 text-right">{{
                  t('common:vue.home.houseRooms.materialCount', 'Quantity')
                }}</TableHead
                ><TableHead class="px-2 py-2 text-right">{{
                  t('common:vue.home.houseRooms.materialUnitPrice', 'Unit Price')
                }}</TableHead
                ><TableHead class="px-2 py-2 text-right">{{
                  t('common:vue.home.houseRooms.materialSubtotal', 'Subtotal')
                }}</TableHead
                ><TableHead class="px-2 py-2 text-right">{{
                  t('common:vue.home.houseRooms.materialStatus', 'Status')
                }}</TableHead></TableRow
              ></TableHeader
            >
            <TableBody
              ><TableRow
                v-for="material in houseRoomUpgradePreview.materials"
                :key="material.itemHrid"
                class="border-b border-border last:border-b-0"
                ><TableCell class="px-2 py-2">{{
                  getItemName(material.itemHrid, itemDetailMap?.[material.itemHrid]?.name || material.itemHrid)
                }}</TableCell
                ><TableCell class="px-2 py-2 text-right">{{ formatInt(material.count) }}</TableCell
                ><TableCell class="px-2 py-2 text-right">{{
                  material.priced ? formatCurrency(material.unitPrice) : '-'
                }}</TableCell
                ><TableCell class="px-2 py-2 text-right">{{
                  material.priced ? formatCurrency(material.subtotal) : '-'
                }}</TableCell
                ><TableCell class="px-2 py-2 text-right"
                  ><span
                    class="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium"
                    :class="
                      material.priced
                        ? 'border-success/40 bg-success/10 text-success'
                        : 'border-destructive/40 bg-destructive/10 text-destructive'
                    "
                    >{{
                      material.priced
                        ? t('common:vue.home.houseRooms.materialStatusReady', 'Priced')
                        : t('common:vue.home.houseRooms.materialStatusMissing', 'Missing price')
                    }}</span
                  ></TableCell
                ></TableRow
              ></TableBody
            >
          </Table>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import {
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from '../../../shared/gameDataIndex.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table/index.js';
import BaseModal from '../BaseModal.vue';
import { formatCurrency, formatInt, formatUpgradeCost } from './homeFormatters.js';

const props = defineProps({
  open: { type: Boolean, default: false },
});
defineEmits(['close']);
const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getHouseRoomName, getItemName } = useGameDataText();
const activePlayer = computed(() => simulator.activePlayer);
// 基线按玩家归属：每个玩家在"本次打开会话"中首次被查看时捕获初始等级。
// 切换玩家不互相覆盖；切回时该玩家的升级摘要自动恢复。
const baselinesByPlayerId = ref({});

// 摘要基线 = 当前玩家在本次会话的基线；尚无基线时回退到当前等级（diff 为 0，摘要无变化）。
// 注意不能回退到 {}：空基线会让预览把玩家已有等级误判为升级（base 0 → to N）。
const baselineLevels = computed(
  () => baselinesByPlayerId.value[String(activePlayer.value?.id ?? '')] ?? activePlayer.value?.houseRooms ?? {},
);
const houseRoomOptions = computed(() =>
  Object.values(houseRoomDetailMap)
    .slice()
    .sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0))
    .map((room) => ({ hrid: room.hrid, name: room.name })),
);
const houseRoomUpgradePreview = computed(() =>
  simulator.previewHouseRoomUpgradeCost(baselineLevels.value, activePlayer.value?.houseRooms ?? {}),
);
const houseRoomPreviewByHrid = computed(() =>
  Object.fromEntries((houseRoomUpgradePreview.value?.rooms ?? []).map((row) => [row.roomHrid, row])),
);
const houseRoomBaselineLevelMap = computed(() =>
  Object.fromEntries(
    houseRoomOptions.value.map((room) => [
      room.hrid,
      Number(baselineLevels.value?.[room.hrid] ?? activePlayer.value?.houseRooms?.[room.hrid] ?? 0),
    ]),
  ),
);
const houseRoomChangedRooms = computed(() => houseRoomUpgradePreview.value?.rooms ?? []);
const houseRoomMaterialKindCount = computed(
  () => houseRoomUpgradePreview.value?.materials?.filter((entry) => entry.itemHrid !== '/items/coin').length ?? 0,
);
const houseRoomMissingPriceCount = computed(
  () =>
    houseRoomUpgradePreview.value?.materials?.filter((entry) => entry.itemHrid !== '/items/coin' && !entry.priced)
      .length ?? 0,
);

function playerBaselineKey() {
  return String(activePlayer.value?.id ?? '');
}

function captureBaselineForPlayer() {
  const player = activePlayer.value;
  if (!player) {
    return;
  }
  const key = playerBaselineKey();
  baselinesByPlayerId.value = {
    ...baselinesByPlayerId.value,
    [key]: JSON.parse(JSON.stringify(player.houseRooms ?? {})),
  };
}
function formatHouseRoomTransition(fromLevel, toLevel) {
  return t('common:vue.home.houseRooms.transition', 'Lv {{from}} -> Lv {{to}}', {
    from: formatInt(fromLevel),
    to: formatInt(toLevel),
  });
}
function formatHouseRoomChangedRoomsText(count) {
  return t('common:vue.home.houseRooms.summaryChangedRooms', '{{count}} rooms changed', {
    count: formatInt(count),
  });
}
function formatHouseRoomMissingPriceHint(count) {
  return t('common:vue.home.houseRooms.missingPriceHint', '{{count}} lines missing price', {
    count: formatInt(count),
  });
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      captureBaselineForPlayer();
    } else {
      baselinesByPlayerId.value = {}; // 关闭 = 会话结束，全部清空
    }
  },
);
watch(
  () => activePlayer.value,
  () => {
    // 仅当该玩家尚无基线时才捕获（首次查看）；已存在的基线保留，切回时摘要自动恢复。
    if (props.open && !baselinesByPlayerId.value[playerBaselineKey()]) {
      captureBaselineForPlayer();
    }
  },
  { immediate: true },
);
</script>
