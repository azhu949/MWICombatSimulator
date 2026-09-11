<template>
  <BaseModal
    :open="open"
    :title="t('common:foodOptimizer.scopeTitle', 'Foods to include')"
    panel-class="max-w-[96vw] lg:max-w-6xl"
    @close="$emit('close')"
  >
    <p class="text-xs text-muted-foreground">
      {{
        t(
          'common:foodOptimizer.scopeHint',
          'Unchecked foods are excluded from the candidate set. Fewer foods search faster.',
        )
      }}
    </p>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-medium" data-food-optimizer-scope-summary>{{ scopeSummaryText }}</p>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          :disabled="selection.length >= items.length"
          @click="selectAllFoods"
        >
          {{ t('common:foodOptimizer.scopeSelectAll', 'Select all') }}
        </Button>
        <Button type="button" size="sm" variant="outline" :disabled="selection.length === 0" @click="clearAllFoods">
          {{ t('common:foodOptimizer.scopeClearAll', 'Clear all') }}
        </Button>
      </div>
    </div>
    <div class="grid min-w-0 gap-3 sm:grid-cols-2">
      <section
        v-for="group in groups"
        :key="group.kind"
        class="flex min-w-0 flex-col rounded-md border border-border"
        :data-food-optimizer-scope-group="group.kind"
      >
        <header
          class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-2.5 py-1.5"
        >
          <p class="text-sm font-semibold">
            {{ group.title }}<span class="ml-1.5 text-xs font-normal text-muted-foreground">{{ group.summary }}</span>
          </p>
          <div class="flex shrink-0 gap-2 text-xs">
            <button
              type="button"
              class="text-primary hover:underline disabled:opacity-50"
              :disabled="group.selected >= group.total"
              @click="setGroupSelected(group.kind, true)"
            >
              {{ t('common:foodOptimizer.scopeSelectAll', 'Select all') }}
            </button>
            <button
              type="button"
              class="text-primary hover:underline disabled:opacity-50"
              :disabled="group.selected === 0"
              @click="setGroupSelected(group.kind, false)"
            >
              {{ t('common:foodOptimizer.scopeClearAll', 'Clear all') }}
            </button>
          </div>
        </header>
        <div class="max-h-[50vh] space-y-0.5 overflow-y-auto p-1.5">
          <label
            v-for="item in group.items"
            :key="item.hrid"
            class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50"
          >
            <input
              type="checkbox"
              :checked="selectedSet.has(item.hrid)"
              :data-food-optimizer-scope-item="item.hrid"
              @change="toggleFood(item.hrid, $event.target.checked)"
            />
            <svg v-if="iconsReady && hasItemIconSymbol(item.hrid)" class="size-6 shrink-0" aria-hidden="true">
              <use :href="itemIconHref(item.hrid)" />
            </svg>
            <Utensils v-else class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ getItemName(item.hrid) }}</span>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ restoreLabel(item) }}</span>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ number(item.price) }}</span>
            <span v-if="equippedSet.has(item.hrid)" class="shrink-0 text-xs text-primary">{{
              t('common:foodOptimizer.scopeEquipped', 'Equipped')
            }}</span>
          </label>
        </div>
      </section>
    </div>
    <p v-if="!items.length" class="text-sm text-muted-foreground">
      {{ t('common:foodOptimizer.scopeUnavailable', 'No food catalog is available for this target.') }}
    </p>
    <p class="text-xs text-muted-foreground" data-food-optimizer-scope-count>
      {{ t('common:foodOptimizer.candidates', 'Candidate count') }}: {{ number(candidateCount, 0) }}
    </p>
    <p v-if="!selection.length" class="text-sm text-destructive" role="alert">
      {{ t('common:foodOptimizer.scopeRequired', 'Select at least one food to search.') }}
    </p>
    <div class="flex flex-wrap justify-end gap-2">
      <Button type="button" size="sm" variant="outline" @click="$emit('close')">{{
        t('common:foodOptimizer.cancel', 'Cancel')
      }}</Button>
      <Button type="button" size="sm" :disabled="!selection.length" data-food-optimizer-scope-start @click="confirm">
        <Play />{{ t('common:foodOptimizer.start', 'Start search') }}
      </Button>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { Play, Utensils } from '@lucide/vue';
import { countFoodOptimizerCandidates } from '../../services/foodOptimizerDomain.js';
import { ensureItemIconSymbols, hasItemIconSymbol, itemIconHref } from '../../services/itemIconSprite.js';
import { Button } from './ui/button/index.js';
import BaseModal from './BaseModal.vue';
import { useGameDataText } from '../composables/useGameDataText.js';
import { useI18nText } from '../composables/useI18nText.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  selected: { type: Array, default: null },
  equippedHrids: { type: Array, default: () => [] },
  foodSlots: { type: Number, default: 0 },
});
const emit = defineEmits(['close', 'confirm']);
const { t, language } = useI18nText();
const { getItemName } = useGameDataText();
const selection = ref([]);
const selectedSet = computed(() => new Set(selection.value));
const equippedSet = computed(() => new Set(props.equippedHrids.map((hrid) => String(hrid || ''))));
const iconsReady = ref(false);
const candidateCount = computed(() =>
  countFoodOptimizerCandidates(
    props.items.filter((item) => selectedSet.value.has(item.hrid)),
    props.foodSlots,
  ),
);
// 恢复生命值与恢复法力值分列展示，恢复量高的排前面，两列合计即完整目录。
const groups = computed(() =>
  ['hp', 'mp']
    .map((kind) => {
      const items = props.items
        .filter((item) => item.kind === kind)
        .slice()
        .sort((left, right) => right.restore - left.restore || (left.hrid < right.hrid ? -1 : 1));
      const selected = items.filter((item) => selectedSet.value.has(item.hrid)).length;
      return {
        kind,
        items,
        total: items.length,
        selected,
        title: t(
          kind === 'hp' ? 'common:foodOptimizer.scopeGroupHp' : 'common:foodOptimizer.scopeGroupMp',
          kind === 'hp' ? 'HP food' : 'MP food',
        ),
        summary: t('common:foodOptimizer.scopeGroupSelected', '{{selected}}/{{total}} selected', {
          selected,
          total: items.length,
        }),
      };
    })
    .filter((group) => group.items.length),
);
// 模板表达式里不能出现 {{ }}（会被 Vue 编译器当作插值提前闭合），
// 因此带参数插值的文案在脚本中组装。
const scopeSummaryText = computed(() =>
  t('common:foodOptimizer.scopeSelected', 'Foods selected', {
    selected: selection.value.length,
    total: props.items.length,
  }),
);
const number = (value, digits = 2) =>
  Number(value || 0).toLocaleString(language.value, { maximumFractionDigits: digits });
function restoreLabel(item) {
  return `+${number(item.restore, 0)}`;
}
function currentSelection() {
  const available = new Set(props.items.map((item) => item.hrid));
  const picked = Array.isArray(props.selected)
    ? props.selected.map((hrid) => String(hrid || '')).filter((hrid) => available.has(hrid))
    : [];
  return picked.length ? picked : props.items.map((item) => item.hrid);
}
// 只在打开时同步一次草稿：模拟进行中预览输入仍可能刷新，编辑期间不得被覆盖。
watch(
  () => props.open,
  (open) => {
    if (open) selection.value = currentSelection();
  },
  { immediate: true },
);
watch(
  () => props.items.map((item) => item.hrid).join('|'),
  async () => {
    try {
      await ensureItemIconSymbols(props.items.map((item) => item.hrid));
      iconsReady.value = true;
    } catch {
      iconsReady.value = false;
    }
  },
  { immediate: true },
);
function toggleFood(hrid, checked) {
  const next = new Set(selection.value);
  if (checked) next.add(hrid);
  else next.delete(hrid);
  selection.value = props.items.map((item) => item.hrid).filter((item) => next.has(item));
}
function selectAllFoods() {
  selection.value = props.items.map((item) => item.hrid);
}
function clearAllFoods() {
  selection.value = [];
}
function setGroupSelected(kind, checked) {
  const next = new Set(selection.value);
  for (const item of props.items) {
    if (item.kind !== kind) continue;
    if (checked) next.add(item.hrid);
    else next.delete(item.hrid);
  }
  selection.value = props.items.map((item) => item.hrid).filter((hrid) => next.has(hrid));
}
function confirm() {
  if (!selection.value.length) return;
  emit('confirm', [...selection.value]);
}
</script>
