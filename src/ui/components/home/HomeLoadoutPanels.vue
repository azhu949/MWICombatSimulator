<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <div class="surface-panel">
      <h2 class="mb-3 font-heading text-lg font-semibold text-primary">
        {{ t('common:vue.home.foodDrinksTitle', 'Food & Drinks') }}
      </h2>
      <div class="space-y-3">
        <div v-for="slotIndex in 3" :key="`food-${slotIndex}`" class="grid gap-2">
          <div
            :class="[
              'rounded-md border p-2',
              foodSlotChangedFlags[slotIndex - 1] ? 'border-primary/40 bg-primary/10' : 'border-border',
            ]"
          >
            <label class="control-label">{{ t('common:vue.home.foodSlot', 'Food', { index: slotIndex }) }}</label>
            <SearchCombobox
              :model-value="activePlayer.food[slotIndex - 1]"
              :options="foodComboboxOptions"
              :placeholder="t('common:vue.common.searchOptions', 'Search options')"
              :aria-label="t('common:vue.home.foodSlot', 'Food', { index: slotIndex })"
              :empty-label="t('common:vue.common.noResults', 'No results')"
              :open-label="t('common:vue.common.openOptions', 'Open options')"
              :more-results-label="
                t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')
              "
              :max-results="60"
              @update:model-value="triggerController.setSelection('food', slotIndex - 1, $event)"
            />
            <InlineTriggerEditor
              v-if="activePlayer.food[slotIndex - 1]"
              :target-id="triggerController.targetId('food', slotIndex - 1)"
              :target-name="foodTargetViews[slotIndex - 1].label"
              :state="foodTargetViews[slotIndex - 1].state"
              :current-rules="foodTargetViews[slotIndex - 1].rules"
              :default-rules="foodTargetViews[slotIndex - 1].defaultRules"
              :draft="triggerController.isActive('food', slotIndex - 1) ? activeTriggerDraft : []"
              :expanded="triggerController.isActive('food', slotIndex - 1)"
              :max-rules="MAX_TRIGGER_COUNT"
              :blocked-message="triggerController.isActive('food', slotIndex - 1) ? triggerBlockedMessage : ''"
              @request-toggle="triggerController.request('food', slotIndex - 1)"
              @update:draft="triggerController.updateDraft"
              @dirty-change="triggerController.updateDirty('food', slotIndex - 1, $event)"
              @save="triggerController.save"
              @cancel="triggerController.cancel"
            />
          </div>
        </div>
      </div>
      <div class="mt-3 space-y-3">
        <div v-for="slotIndex in 3" :key="`drink-${slotIndex}`" class="grid gap-2">
          <div
            :class="[
              'rounded-md border p-2',
              drinkSlotChangedFlags[slotIndex - 1] ? 'border-primary/40 bg-primary/10' : 'border-border',
            ]"
          >
            <label class="control-label">{{ t('common:vue.home.drinkSlot', 'Drink', { index: slotIndex }) }}</label>
            <SearchCombobox
              :model-value="activePlayer.drinks[slotIndex - 1]"
              :options="drinkComboboxOptions"
              :placeholder="t('common:vue.common.searchOptions', 'Search options')"
              :aria-label="t('common:vue.home.drinkSlot', 'Drink', { index: slotIndex })"
              :empty-label="t('common:vue.common.noResults', 'No results')"
              :open-label="t('common:vue.common.openOptions', 'Open options')"
              :more-results-label="
                t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')
              "
              :max-results="60"
              @update:model-value="triggerController.setSelection('drink', slotIndex - 1, $event)"
            />
            <InlineTriggerEditor
              v-if="activePlayer.drinks[slotIndex - 1]"
              :target-id="triggerController.targetId('drink', slotIndex - 1)"
              :target-name="drinkTargetViews[slotIndex - 1].label"
              :state="drinkTargetViews[slotIndex - 1].state"
              :current-rules="drinkTargetViews[slotIndex - 1].rules"
              :default-rules="drinkTargetViews[slotIndex - 1].defaultRules"
              :draft="triggerController.isActive('drink', slotIndex - 1) ? activeTriggerDraft : []"
              :expanded="triggerController.isActive('drink', slotIndex - 1)"
              :max-rules="MAX_TRIGGER_COUNT"
              :blocked-message="triggerController.isActive('drink', slotIndex - 1) ? triggerBlockedMessage : ''"
              @request-toggle="triggerController.request('drink', slotIndex - 1)"
              @update:draft="triggerController.updateDraft"
              @dirty-change="triggerController.updateDirty('drink', slotIndex - 1, $event)"
              @save="triggerController.save"
              @cancel="triggerController.cancel"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="surface-panel">
      <h2 class="mb-1 font-heading text-lg font-semibold text-primary">
        {{ getOfficialGameText('abilitiesPanel', 'title', 'Abilities') }}
      </h2>
      <p class="mb-3 text-xs text-muted-foreground">
        {{
          t(
            'common:vue.home.abilityOrder.hint',
            'Use the arrow buttons to swap an ability with its neighbour. The special ability slot always stays first.',
          )
        }}
      </p>
      <div class="space-y-3">
        <div
          v-for="slotIndex in 5"
          :key="`ability-${slotIndex}`"
          :class="[
            'rounded-md border p-2',
            abilitySlotChangedFlags[slotIndex - 1] ? 'border-primary/40 bg-primary/10' : 'border-border',
          ]"
        >
          <div class="grid gap-2 sm:grid-cols-[1fr_88px]">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="control-label min-w-0 truncate">
                  {{ triggerController.getAbilitySlotLabel(slotIndex - 1) }}
                </span>
                <span v-if="isAbilitySlotMovable(slotIndex - 1)" class="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    :class="ABILITY_SLOT_MOVE_BUTTON_CLASS"
                    :disabled="!canMoveAbilitySlotUp(slotIndex - 1)"
                    :title="`${triggerController.getAbilitySlotLabel(slotIndex - 1)} ${t('common:vue.home.abilityOrder.moveUp', 'Move up')}`"
                    :aria-label="`${triggerController.getAbilitySlotLabel(slotIndex - 1)} ${t('common:vue.home.abilityOrder.moveUp', 'Move up')}`"
                    @click="swapAbilitySlots(slotIndex - 1, slotIndex - 2)"
                  >
                    <ArrowUp class="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    :class="ABILITY_SLOT_MOVE_BUTTON_CLASS"
                    :disabled="!canMoveAbilitySlotDown(slotIndex - 1)"
                    :title="`${triggerController.getAbilitySlotLabel(slotIndex - 1)} ${t('common:vue.home.abilityOrder.moveDown', 'Move down')}`"
                    :aria-label="`${triggerController.getAbilitySlotLabel(slotIndex - 1)} ${t('common:vue.home.abilityOrder.moveDown', 'Move down')}`"
                    @click="swapAbilitySlots(slotIndex - 1, slotIndex)"
                  >
                    <ArrowDown class="size-4" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <SearchCombobox
                :model-value="activePlayer.abilities[slotIndex - 1].abilityHrid"
                :options="abilityComboboxOptions(slotIndex - 1)"
                :placeholder="t('common:vue.common.searchOptions', 'Search options')"
                :aria-label="triggerController.getAbilitySlotLabel(slotIndex - 1)"
                :empty-label="t('common:vue.common.noResults', 'No results')"
                :open-label="t('common:vue.common.openOptions', 'Open options')"
                :more-results-label="
                  t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')
                "
                :max-results="60"
                @update:model-value="triggerController.setSelection('ability', slotIndex - 1, $event)"
              />
            </div>
            <div>
              <label class="control-label">{{ t('common:vue.home.levelShort', 'Lv') }}</label>
              <input
                v-model.number="activePlayer.abilities[slotIndex - 1].level"
                class="control-input"
                type="number"
                min="1"
                max="400"
              />
            </div>
          </div>
          <InlineTriggerEditor
            v-if="activePlayer.abilities[slotIndex - 1].abilityHrid"
            :target-id="triggerController.targetId('ability', slotIndex - 1)"
            :target-name="abilityTargetViews[slotIndex - 1].label"
            :state="abilityTargetViews[slotIndex - 1].state"
            :current-rules="abilityTargetViews[slotIndex - 1].rules"
            :default-rules="abilityTargetViews[slotIndex - 1].defaultRules"
            :draft="triggerController.isActive('ability', slotIndex - 1) ? activeTriggerDraft : []"
            :expanded="triggerController.isActive('ability', slotIndex - 1)"
            :max-rules="MAX_TRIGGER_COUNT"
            :blocked-message="triggerController.isActive('ability', slotIndex - 1) ? triggerBlockedMessage : ''"
            @request-toggle="triggerController.request('ability', slotIndex - 1)"
            @update:draft="triggerController.updateDraft"
            @dirty-change="triggerController.updateDirty('ability', slotIndex - 1, $event)"
            @save="triggerController.save"
            @cancel="triggerController.cancel"
          />
          <div
            v-if="abilityUpgradeCostDrafts[slotIndex - 1]"
            class="mt-2 rounded-lg border border-border bg-muted/50 p-2"
          >
            <p class="text-xs text-foreground/85">
              {{ t('common:equipment.upgradeCost', 'Upgrade Cost') }}:
              {{ formatUpgradeCost(abilityUpgradeCostDrafts[slotIndex - 1].cost) }}
            </p>
            <input
              class="control-input mt-1"
              type="number"
              min="0"
              step="1"
              :value="abilityUpgradeCostDrafts[slotIndex - 1].cost"
              @change="simulator.setActivePlayerAbilityUpgradeCost(slotIndex - 1, $event.target.value)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ArrowDown, ArrowUp } from '@lucide/vue';
import { abilityDetailIndex as abilityDetailMap } from '../../../shared/gameDataIndex.js';
import { MAX_TRIGGER_COUNT } from '../../../services/triggerMapper.js';
import { normalizeAbilitySlotIndex } from '../../../services/utils.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useHomeBuildComparison } from '../../composables/useHomeBuildComparison.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { SearchCombobox } from '../ui/combobox/index.js';
import InlineTriggerEditor from './InlineTriggerEditor.vue';
import { formatUpgradeCost } from './homeFormatters.js';

const props = defineProps({
  triggerController: { type: Object, required: true },
});
const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getAbilityName, getItemName, getOfficialGameText } = useGameDataText();
const { activePlayer, foodSlotChangedFlags, drinkSlotChangedFlags, abilitySlotChangedFlags } = useHomeBuildComparison();
const activeTriggerDraft = props.triggerController.activeDraft;
const triggerBlockedMessage = props.triggerController.blockedMessage;
const specialAbilityOptions = computed(() =>
  Object.values(abilityDetailMap)
    .filter((ability) => ability?.isSpecialAbility === true)
    .map((ability) => ({
      hrid: String(ability.hrid || ''),
      name: String(ability.name || ''),
      sortIndex: Number(ability.sortIndex ?? 0),
    }))
    .filter((ability) => ability.hrid)
    .sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name)),
);

function itemOption(item) {
  return {
    value: item.hrid,
    label: `${t('common:vue.home.levelShort', 'Lv')}${item.itemLevel} ${getItemName(item.hrid, item.name)}`,
  };
}

const emptyOption = computed(() => ({ value: '', label: t('common:vue.common.none', 'None') }));
const foodComboboxOptions = computed(() => [emptyOption.value, ...simulator.options.food.map(itemOption)]);
const drinkComboboxOptions = computed(() => [emptyOption.value, ...simulator.options.drinks.map(itemOption)]);
const abilityUpgradeCostDrafts = computed(() =>
  Array.from({ length: 5 }, (_, slotIndex) => simulator.resolveActivePlayerAbilityUpgradeCostDraft(slotIndex)),
);

// 缓存 targetView：模板原先每个槽位调用 4 次 targetView（每次含多次 JSON.stringify + sanitizeTriggerList），
// 任何重渲染都会全量重算。改为 computed 后仅在依赖变化时计算一次（t() 内部读取 language ref，语言切换仍会正确失效）。
const foodTargetViews = computed(() =>
  Array.from({ length: 3 }, (_, index) => props.triggerController.targetView('food', index)),
);
const drinkTargetViews = computed(() =>
  Array.from({ length: 3 }, (_, index) => props.triggerController.targetView('drink', index)),
);
const abilityTargetViews = computed(() =>
  Array.from({ length: 5 }, (_, index) => props.triggerController.targetView('ability', index)),
);

function abilityComboboxOptions(slotIndex) {
  const options = Number(slotIndex) === 0 ? specialAbilityOptions.value : simulator.options.abilities;
  return [
    emptyOption.value,
    ...options.map((ability) => ({
      value: ability.hrid,
      label: getAbilityName(ability.hrid, ability.name),
    })),
  ];
}

// 技能槽切换（在「基础设置」面板里直接操作技能行）：技能槽 1（index 0）是特殊技能槽，
// 固定在最前；其余槽位（技能 1…技能 4）点 ↑/↓ 按钮与相邻槽位互换，写入统一走 store 的
// swapActivePlayerAbilitySlots——技能与等级随条目一起换位，UI 不自行改配置。
// 按钮做成实心 primary：切换是这些行唯一的操作入口，要一眼可见；不可换的方向退回灰底禁用态。
const ABILITY_SLOT_MOVE_BUTTON_CLASS =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground shadow-sm transition-colors outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:border-border disabled:bg-muted/60 disabled:text-muted-foreground disabled:shadow-none';

const abilitySlotCount = computed(() => Math.max(2, Number(activePlayer.value?.abilities?.length || 5)));

function isAbilitySlotMovable(slotIndex) {
  return Number(slotIndex) > 0;
}

function canMoveAbilitySlotUp(slotIndex) {
  return isAbilitySlotMovable(slotIndex) && isAbilitySlotMovable(slotIndex - 1);
}

function canMoveAbilitySlotDown(slotIndex) {
  return isAbilitySlotMovable(slotIndex) && Number(slotIndex) < abilitySlotCount.value - 1;
}

// 互换会改变「槽位 ↔ 技能」的对应关系：先用与切换玩家/替换配置同款的门卫拦住正在编辑的
// 触发器草稿（脏草稿被拦下并提示），互换成功后再关掉编辑器——否则内联编辑器会停在旧槽位
// 上，把草稿错写到互换后坐在那一格的另一个技能上。
// 但只有「正好开在被互换的两个槽位上」的编辑器需要关：state.hrid 绑的是技能，食物/饮品与
// 其他技能槽的内容没被这次互换改动，草稿依然对得上——无条件 reset() 会把用户正打开的无关
// 编辑器一并关掉（编辑器是否展开是用户可见状态，不能顺手丢）。
function swapAbilitySlots(fromIndex, toIndex) {
  if (!props.triggerController.canLeave()) {
    return;
  }
  // 槽位号归一化必须与 store 同源（shared utils 的 normalizeAbilitySlotIndex）：比较与传参用的是同一个
  // 数字——UI 若按原值比对（Number(fromIndex)）、store 按 floor 后的值动手，非整数入参下就会静默分叉，
  // 把编辑器留在已经换过内容的旧槽位上。
  const normalizedFromIndex = normalizeAbilitySlotIndex(fromIndex);
  const normalizedToIndex = normalizeAbilitySlotIndex(toIndex);
  const closesTriggerEditor =
    props.triggerController.isActive('ability', normalizedFromIndex) ||
    props.triggerController.isActive('ability', normalizedToIndex);
  if (!simulator.swapActivePlayerAbilitySlots(normalizedFromIndex, normalizedToIndex)) {
    return;
  }
  if (closesTriggerEditor) {
    props.triggerController.reset();
  }
}
</script>
