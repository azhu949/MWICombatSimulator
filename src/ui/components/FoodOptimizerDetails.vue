<template>
  <div class="overflow-x-auto">
    <p v-if="!slots.length" class="py-3 text-sm text-muted-foreground">{{ t('common:foodOptimizer.noFood') }}</p>
    <table v-else class="w-full text-left text-xs">
      <thead class="text-muted-foreground">
        <tr>
          <th class="p-2">{{ t('common:foodOptimizer.slot') }}</th>
          <th class="p-2">{{ t('common:foodOptimizer.food') }}</th>
          <th class="p-2">{{ t('common:trigger') }}</th>
          <th class="p-2 text-right">{{ t('common:foodOptimizer.unitPrice') }}</th>
          <th v-if="usage" class="p-2 text-right">{{ t('common:foodOptimizer.averageUsage') }}</th>
          <th v-if="usage" class="p-2 text-right">{{ t('common:foodOptimizer.costPerHour') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="food in groupedSlots" :key="food.hrid" class="border-t border-border">
          <td class="p-2 tabular-nums">{{ food.slotNumbers.join(', ') }}</td>
          <td class="p-2">
            <div class="flex min-w-36 items-center gap-2">
              <svg v-if="iconsReady && hasItemIconSymbol(food.hrid)" class="size-8 shrink-0" aria-hidden="true">
                <use :href="itemIconHref(food.hrid)" /></svg
              ><Utensils v-else class="size-6 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{{
                getItemName(food.hrid)
              }}</span>
            </div>
          </td>
          <td class="min-w-40 p-2">
            <div v-for="(trigger, triggerIndex) in food.triggers || []" :key="triggerIndex">
              {{ formatTrigger(trigger) }}
            </div>
            <span v-if="!food.triggers?.length">{{ t('common:foodOptimizer.noConditions') }}</span>
          </td>
          <td class="p-2 text-right tabular-nums">{{ number(food.price) }}</td>
          <td v-if="usage" class="p-2 text-right tabular-nums">{{ number(usage[food.hrid] || 0) }}</td>
          <td v-if="usage" class="p-2 text-right tabular-nums">
            {{ number(((usage[food.hrid] || 0) * food.price) / hours) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { Utensils } from '@lucide/vue';
import { ensureItemIconSymbols, hasItemIconSymbol, itemIconHref } from '../../services/itemIconSprite.js';
import { useGameDataText } from '../composables/useGameDataText.js';
import { useI18nText } from '../composables/useI18nText.js';

const props = defineProps({
  slots: { type: Array, default: () => [] },
  usage: { type: Object, default: null },
  hours: { type: Number, default: 1 },
});
const { t, language } = useI18nText();
const { getItemName, getOfficialGameText } = useGameDataText();
const iconsReady = ref(false);
const groupedSlots = computed(() => {
  const rows = new Map();
  props.slots.forEach((food, index) => {
    if (!rows.has(food.hrid)) rows.set(food.hrid, { ...food, slotNumbers: [] });
    rows.get(food.hrid).slotNumbers.push((food.slotIndex ?? index) + 1);
  });
  return [...rows.values()];
});
const number = (value) => Number(value || 0).toLocaleString(language.value, { maximumFractionDigits: 2 });
function formatTrigger(trigger) {
  const dependency = getOfficialGameText('combatTriggerDependencyNames', trigger.dependencyHrid);
  const condition = getOfficialGameText('combatTriggerConditionNames', trigger.conditionHrid);
  const comparator = getOfficialGameText('combatTriggerComparatorNames', trigger.comparatorHrid);
  const value = trigger.comparatorHrid.endsWith('_equal') ? number(trigger.value) : '';
  return `${dependency} ${condition} ${comparator} ${value}`;
}
watch(
  () => props.slots.map((slot) => slot.hrid).join('|'),
  async () => {
    try {
      await ensureItemIconSymbols(props.slots.map((slot) => slot.hrid));
      iconsReady.value = true;
    } catch {
      iconsReady.value = false;
    }
  },
  { immediate: true },
);
</script>
