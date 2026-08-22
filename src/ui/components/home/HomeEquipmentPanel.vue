<template>
  <div class="space-y-4 xl:col-span-12">
    <div class="surface-panel">
      <h2 class="mb-3 font-heading text-lg font-semibold text-primary">
        {{ getOfficialGameText('equipmentPanel', 'title', 'Equipment') }}
      </h2>
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
          <div class="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2" data-equipment-input-row>
            <SearchCombobox
              v-model="activePlayer.equipment[slot].itemHrid"
              :options="equipmentComboboxOptionsBySlot[slot] || []"
              :placeholder="t('common:vue.common.searchOptions', 'Search options')"
              :aria-label="equipmentLabelMap[slot]"
              :empty-label="t('common:vue.common.noResults', 'No results')"
              :open-label="t('common:vue.common.openOptions', 'Open options')"
              :more-results-label="
                t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')
              "
              :max-results="60"
            />
            <div class="relative min-w-0">
              <span
                class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
                aria-hidden="true"
                >+</span
              >
              <input
                v-model.number="activePlayer.equipment[slot].enhancementLevel"
                class="control-input pl-6 pr-2 text-right tabular-nums"
                type="number"
                min="0"
                max="30"
                :aria-label="`${equipmentLabelMap[slot]} ${t('common:vue.home.enhancement', 'Enhancement')}`"
                :title="t('common:vue.home.enhancement', 'Enhancement')"
              />
            </div>
          </div>
          <div class="mt-2">
            <p class="control-label">
              {{ t('common:vue.home.marketEnhancements', 'Market Enhancements') }}
            </p>
            <div v-if="equipmentHintViewModel[slot]?.levels?.length > 0" class="mt-1 flex flex-wrap gap-1">
              <button
                v-for="level in equipmentHintViewModel[slot].levels"
                :key="`${slot}-enh-${level}`"
                type="button"
                class="rounded-md border px-2 py-0.5 text-xs transition"
                :class="
                  Number(activePlayer.equipment[slot].enhancementLevel || 0) === level
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-foreground/85 hover:border-primary/40 hover:text-primary'
                "
                @click="simulator.applyActivePlayerEquipmentEnhancementFromMarket(slot, level)"
              >
                +{{ level }}
              </button>
            </div>
            <p v-else class="mt-1 text-xs text-muted-foreground">
              {{ t('common:vue.home.marketEnhancementsEmpty', 'No market enhancement data.') }}
            </p>
          </div>
          <div
            v-if="equipmentHintViewModel[slot]?.costDraft"
            class="mt-2 rounded-lg border border-border bg-muted/50 p-2"
          >
            <p class="text-xs text-foreground/85">
              {{ t('common:equipment.upgradeCost', 'Upgrade Cost') }}:
              {{ formatUpgradeCost(equipmentHintViewModel[slot].costDraft.cost) }}
            </p>
            <p v-if="!equipmentHintViewModel[slot].costDraft.targetAskAvailable" class="mt-1 text-xs text-destructive">
              {{
                t(
                  'common:vue.home.enhancementAskMissing',
                  'No exact sell listing exists. When adding to the queue, the app will look for an automatic market price and ask for confirmation if one is available.',
                )
              }}
            </p>
            <p
              v-if="!equipmentHintViewModel[slot].costDraft.targetAskAvailable"
              class="mt-1 text-xs text-muted-foreground"
            >
              {{
                t(
                  'common:vue.home.enhancementAskManualHint',
                  'If no official or historical price is available, you can enter a buy price manually in the confirmation dialog to add it to the queue.',
                )
              }}
            </p>
            <p v-if="equipmentHintViewModel[slot].costDraft.baselineSaleZero" class="mt-1 text-xs text-warning">
              {{
                t(
                  'common:vue.home.baselineSaleZero',
                  'No exact quote exists for the baseline equipment. Its sale value is treated as 0.',
                )
              }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { EQUIPMENT_SLOT_KEYS } from '../../../shared/playerConfig.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useHomeBuildComparison } from '../../composables/useHomeBuildComparison.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { SearchCombobox } from '../ui/combobox/index.js';
import { formatUpgradeCost } from './homeFormatters.js';

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getEquipmentSlotName, getItemName, getOfficialGameText } = useGameDataText();
const { activePlayer, isEquipmentSlotChanged } = useHomeBuildComparison();
const equipmentSlots = EQUIPMENT_SLOT_KEYS;
const equipmentLabelMap = computed(() =>
  Object.fromEntries(equipmentSlots.map((slot) => [slot, getEquipmentSlotName(slot, slot)])),
);
const equipmentComboboxOptionsBySlot = computed(() =>
  Object.fromEntries(
    equipmentSlots.map((slot) => [
      slot,
      [
        { value: '', label: t('common:vue.common.none', 'None') },
        ...(simulator.options.equipmentBySlot[slot] || []).map((item) => ({
          value: item.hrid,
          label: `${t('common:vue.home.levelShort', 'Lv')}${item.itemLevel} ${getItemName(item.hrid, item.name)}`,
        })),
      ],
    ]),
  ),
);
const equipmentHintViewModel = computed(() => {
  const model = {};
  if (!activePlayer.value?.equipment) {
    return model;
  }
  for (const slot of equipmentSlots) {
    const itemHrid = String(activePlayer.value.equipment?.[slot]?.itemHrid || '');
    model[slot] = {
      levels: simulator.getMarketEnhancementLevelsForItem(itemHrid),
      costDraft: simulator.resolveActivePlayerEquipmentUpgradeCostDraft(slot),
    };
  }
  return model;
});
</script>
