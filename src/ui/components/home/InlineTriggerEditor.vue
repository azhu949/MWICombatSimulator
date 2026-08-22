<template>
  <section class="mt-2 border-t border-border" :data-trigger-target="targetId">
    <button
      type="button"
      class="flex min-h-10 w-full items-center gap-2 px-1 py-2 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :aria-expanded="expanded"
      @click="emit('request-toggle')"
    >
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-semibold text-foreground">{{
            t('common:vue.home.trigger.summaryTitle', 'Trigger conditions')
          }}</span>
          <Badge :variant="stateBadgeVariant">{{ stateLabel }}</Badge>
          <span class="text-[11px] tabular-nums text-muted-foreground">{{ ruleCountLabel }}</span>
        </span>
        <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">{{ summaryText }}</span>
      </span>
      <span class="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
        {{ expanded ? t('common:vue.common.hide', 'Hide') : t('common:vue.home.trigger.edit', 'Edit') }}
        <ChevronDown
          class="size-4 transition-transform duration-200 motion-reduce:transition-none"
          :class="expanded ? 'rotate-180' : ''"
        />
      </span>
    </button>

    <div v-if="expanded" class="space-y-3 border-t border-border px-1 pt-3" data-trigger-editor>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-foreground">{{ targetName }}</p>
          <p class="text-xs text-muted-foreground">
            {{
              draft.length === 0
                ? t(
                    'common:vue.home.trigger.noRulesHint',
                    'No conditions: activate as soon as cooldown and resource requirements allow.',
                  )
                : t('common:vue.home.trigger.rulesHint', 'All conditions must pass before this target can activate.')
            }}
          </p>
        </div>
        <Badge v-if="dirty" variant="warning">{{ t('common:vue.home.trigger.unsaved', 'Unsaved') }}</Badge>
      </div>

      <p
        v-if="blockedMessage"
        class="rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
        role="status"
      >
        {{ blockedMessage }}
      </p>

      <div class="divide-y divide-border">
        <div v-for="(trigger, rowIndex) in draft" :key="`trigger-${rowIndex}`" class="py-3 first:pt-0">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-muted-foreground">
              {{ conditionNumberLabel(rowIndex) }}
            </span>
            <button
              type="button"
              class="text-xs font-medium text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="removeRule(rowIndex)"
            >
              {{ t('common:vue.common.remove', 'Remove') }}
            </button>
          </div>
          <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <label class="block">
              <span class="control-label">{{ t('common:vue.home.trigger.dependency', 'Dependency') }}</span>
              <Select
                :model-value="optionalSelectValue(trigger.dependencyHrid)"
                @update:model-value="setDependency(rowIndex, $event)"
              >
                <SelectTrigger :aria-label="t('common:vue.home.trigger.dependency', 'Dependency')" />
                <SelectContent>
                  <SelectItem :value="EMPTY_SELECT_VALUE">{{ t('common:vue.common.select', 'Select') }}</SelectItem>
                  <SelectItem v-for="dependency in dependencyOptions" :key="dependency.hrid" :value="dependency.hrid">
                    {{ triggerDependencyName(dependency) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label class="block">
              <span class="control-label">{{ t('common:vue.home.trigger.condition', 'Condition') }}</span>
              <SearchCombobox
                :model-value="trigger.conditionHrid"
                :options="conditionOptions(trigger.dependencyHrid)"
                :placeholder="t('common:vue.common.searchOptions', 'Search options')"
                :aria-label="t('common:vue.home.trigger.condition', 'Condition')"
                :empty-label="t('common:vue.common.noResults', 'No results')"
                :open-label="t('common:vue.common.openOptions', 'Open options')"
                :more-results-label="
                  t('common:vue.common.refineSearchMoreResults', 'Refine the search to see {count} more results')
                "
                :disabled="!trigger.dependencyHrid"
                :max-results="60"
                @update:model-value="setCondition(rowIndex, $event)"
              />
            </label>

            <label class="block">
              <span class="control-label">{{ t('common:vue.home.trigger.comparator', 'Comparator') }}</span>
              <Select
                :model-value="optionalSelectValue(trigger.comparatorHrid)"
                :disabled="!trigger.conditionHrid"
                @update:model-value="setComparator(rowIndex, $event)"
              >
                <SelectTrigger :aria-label="t('common:vue.home.trigger.comparator', 'Comparator')" />
                <SelectContent>
                  <SelectItem :value="EMPTY_SELECT_VALUE">{{ t('common:vue.common.select', 'Select') }}</SelectItem>
                  <SelectItem
                    v-for="comparator in comparatorOptions(trigger.conditionHrid)"
                    :key="comparator.hrid"
                    :value="comparator.hrid"
                  >
                    {{ triggerComparatorName(comparator) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label class="block">
              <span class="control-label">{{ t('common:vue.home.trigger.value', 'Value') }}</span>
              <input
                :value="trigger.value"
                class="control-input"
                type="number"
                :disabled="!valueRequired(trigger.comparatorHrid)"
                @input="setValue(rowIndex, $event.target.value)"
              />
            </label>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" class="button-secondary" :disabled="draft.length >= maxRules" @click="addRule">
          {{ t('common:vue.home.trigger.addRule', 'Add condition') }}
        </button>
        <button type="button" class="button-secondary" @click="replaceDraft(defaultRules)">
          {{ t('common:vue.home.trigger.useDefault', 'Restore default') }}
        </button>
        <button type="button" class="button-secondary" @click="replaceDraft([])">
          {{ t('common:vue.home.trigger.noConditions', 'No conditions') }}
        </button>
        <span class="hidden flex-1 sm:block" />
        <button type="button" class="button-secondary" @click="emit('cancel')">
          {{ t('common:vue.home.trigger.cancel', 'Cancel') }}
        </button>
        <button type="button" class="button-primary" :disabled="!draftValid" @click="emit('save', cloneRules(draft))">
          {{ t('common:controls.save', 'Save') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, watch } from 'vue';
import { ChevronDown } from '@lucide/vue';
import {
  getTriggerComparatorsForCondition,
  getTriggerConditionsForDependency,
  getTriggerDependencies,
  isComparatorValueRequired,
} from '../../../services/triggerMapper.js';
import { formatQueueTriggerRuleText, formatQueueTriggerStateText } from '../../queueTriggerPresentation.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { Badge } from '../ui/badge/index.js';
import { SearchCombobox } from '../ui/combobox/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select/index.js';

const props = defineProps({
  targetId: { type: String, required: true },
  targetName: { type: String, required: true },
  state: { type: String, default: 'default' },
  currentRules: { type: Array, default: () => [] },
  defaultRules: { type: Array, default: () => [] },
  draft: { type: Array, default: () => [] },
  expanded: { type: Boolean, default: false },
  maxRules: { type: Number, default: 4 },
  blockedMessage: { type: String, default: '' },
});

const emit = defineEmits(['request-toggle', 'update:draft', 'dirty-change', 'save', 'cancel']);
const { t } = useI18nText();
const { getOfficialGameText } = useGameDataText();
const EMPTY_SELECT_VALUE = '__mwi_inline_trigger_empty__';
const dependencyOptions = getTriggerDependencies();

const dirty = computed(() => JSON.stringify(props.draft) !== JSON.stringify(props.currentRules));
const draftValid = computed(() =>
  props.draft.every(
    (entry) => Boolean(entry?.dependencyHrid) && Boolean(entry?.conditionHrid) && Boolean(entry?.comparatorHrid),
  ),
);
const presentationState = computed(() => (props.currentRules.length === 0 ? 'disabled' : props.state));
const stateLabel = computed(() => formatQueueTriggerStateText(presentationState.value, t));
const stateBadgeVariant = computed(() => {
  if (presentationState.value === 'custom') return 'default';
  if (presentationState.value === 'disabled') return 'outline';
  return 'secondary';
});
const ruleCountLabel = computed(() =>
  t('common:vue.home.trigger.ruleCount', '{{count}} conditions', { count: props.currentRules.length }),
);
const summaryText = computed(() => {
  if (props.currentRules.length === 0) {
    return t('common:vue.home.trigger.noConditionsSummary', 'Activates whenever it is ready.');
  }
  const firstRule = formatQueueTriggerRuleText(props.currentRules[0], t);
  if (props.currentRules.length === 1) {
    return firstRule;
  }
  return t('common:vue.home.trigger.firstRuleMore', '{{rule}} +{{count}} more', {
    rule: firstRule,
    count: props.currentRules.length - 1,
  });
});

function cloneRules(rules) {
  return JSON.parse(JSON.stringify(Array.isArray(rules) ? rules : []));
}

function updateRule(index, patch) {
  const next = cloneRules(props.draft);
  if (!next[index]) return;
  next[index] = { ...next[index], ...patch };
  emit('update:draft', next);
}

function createEmptyRule() {
  return { dependencyHrid: '', conditionHrid: '', comparatorHrid: '', value: 0 };
}

function addRule() {
  if (props.draft.length >= props.maxRules) return;
  emit('update:draft', [...cloneRules(props.draft), createEmptyRule()]);
}

function removeRule(index) {
  const next = cloneRules(props.draft);
  next.splice(index, 1);
  emit('update:draft', next);
}

function replaceDraft(rules) {
  emit('update:draft', cloneRules(rules));
}

function setDependency(index, value) {
  updateRule(index, {
    dependencyHrid: decodeOptionalValue(value),
    conditionHrid: '',
    comparatorHrid: '',
    value: 0,
  });
}

function setCondition(index, value) {
  updateRule(index, {
    conditionHrid: String(value || ''),
    comparatorHrid: '',
    value: 0,
  });
}

function setComparator(index, value) {
  const comparatorHrid = decodeOptionalValue(value);
  updateRule(index, {
    comparatorHrid,
    ...(!valueRequired(comparatorHrid) ? { value: 0 } : {}),
  });
}

function setValue(index, rawValue) {
  const numericValue = Number(rawValue);
  updateRule(index, { value: Number.isFinite(numericValue) ? numericValue : 0 });
}

function optionalSelectValue(value) {
  return value || EMPTY_SELECT_VALUE;
}

function decodeOptionalValue(value) {
  return value === EMPTY_SELECT_VALUE ? '' : String(value || '');
}

function conditionOptions(dependencyHrid) {
  return [
    { value: '', label: t('common:vue.common.select', 'Select') },
    ...getTriggerConditionsForDependency(dependencyHrid).map((condition) => ({
      value: condition.hrid,
      label: getOfficialGameText('combatTriggerConditionNames', condition.hrid, condition.name),
    })),
  ];
}

function comparatorOptions(conditionHrid) {
  return getTriggerComparatorsForCondition(conditionHrid);
}

function triggerDependencyName(dependency) {
  return getOfficialGameText('combatTriggerDependencyNames', dependency.hrid, dependency.name);
}

function triggerComparatorName(comparator) {
  return getOfficialGameText('combatTriggerComparatorNames', comparator.hrid, comparator.name);
}

function valueRequired(comparatorHrid) {
  return isComparatorValueRequired(comparatorHrid);
}

function conditionNumberLabel(index) {
  return t('common:vue.home.trigger.conditionNumber', 'Condition {{index}}', { index: index + 1 });
}

watch(dirty, (nextDirty) => emit('dirty-change', nextDirty), { immediate: true });
</script>
