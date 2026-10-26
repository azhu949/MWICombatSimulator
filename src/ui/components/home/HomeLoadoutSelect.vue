<template>
  <div v-if="visibleLoadouts.length > 0" class="mt-3 border-t border-border pt-3" data-loadout-controls>
    <label class="block">
      <span class="control-label">{{ t('common:vue.home.loadout.selectLabel', 'Loadout') }}</span>
      <Select v-model="selectedLoadoutId">
        <SelectTrigger :aria-label="t('common:vue.home.loadout.selectLabel', 'Loadout')" />
        <SelectContent>
          <SelectItem v-for="loadout in visibleLoadouts" :key="loadout.id" :value="loadout.id">
            {{ loadout.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </label>
    <div class="mt-2 flex flex-wrap gap-2">
      <button type="button" class="button-primary" :disabled="!selectedLoadoutId" @click="requestApplySelectedLoadout">
        {{ t('common:vue.home.loadout.apply', 'Apply') }}
      </button>
    </div>
    <p class="mt-2 text-xs text-muted-foreground">
      {{
        t(
          'common:vue.home.loadout.hint',
          'Applying a loadout overwrites equipment, food, drinks, abilities, and triggers.',
        )
      }}
    </p>
    <BaseModal
      :open="applyConfirmOpen"
      :title="t('common:vue.home.loadout.confirmTitle', 'Apply loadout')"
      panel-class="max-w-md"
      initial-focus-selector="[data-loadout-apply-cancel]"
      @close="closeApplyConfirm"
    >
      <p>{{ applyConfirmBody }}</p>
      <p class="text-xs text-warning" role="status">
        {{
          t(
            'common:vue.home.loadout.confirmTriggerWarning',
            'Trigger rules that are not recorded in this loadout are lost, and targets it includes without rules fall back to the game defaults. This cannot be undone.',
          )
        }}
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="button-secondary" data-loadout-apply-cancel @click="closeApplyConfirm">
          {{ t('common:vue.common.cancel', 'Cancel') }}
        </button>
        <button type="button" class="button-primary" data-loadout-apply-confirm @click="confirmApplySelectedLoadout">
          {{ t('common:vue.home.loadout.confirmApply', 'Replace and apply') }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useHomeBuildComparison } from '../../composables/useHomeBuildComparison.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select/index.js';
import BaseModal from '../BaseModal.vue';

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { activePlayer } = useHomeBuildComparison();

const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';

// 游戏内配装是「全部动作类型共用一个池」：生活技能配装（采矿/伐木/烹饪等）与战斗配装同列，
// 而套用配装会整体覆盖装备、食物、饮品、技能与触发器。把这个下拉交给生活技能配装，战斗配置
// 就会被静默覆盖且没有任何提示，因此这里只列战斗配装。
// actionTypeHrid 为空（字段缺失、「所有专业」通用配装，见 shared 层 normalizePlayerLoadouts 的
// 空值归一化）无法证明它是非战斗配装，一律放行——宁可多列一项，也不隐藏用户以为还在的配装。
const visibleLoadouts = computed(() =>
  (activePlayer.value?.loadouts || []).filter((entry) => {
    const actionTypeHrid = String(entry?.actionTypeHrid || '');
    return actionTypeHrid === COMBAT_ACTION_TYPE_HRID || actionTypeHrid === '';
  }),
);

// 默认选中顺序：默认配装 → 战斗配装 → 名称。运行期 loadouts 不含 ordinal（shared 层白名单
// 未保留该字段），因此排序不依赖 ordinal。
function pickDefaultLoadoutId(loadouts) {
  const isCombatLoadout = (entry) => (String(entry?.actionTypeHrid || '') === COMBAT_ACTION_TYPE_HRID ? 1 : 0);
  const candidates = [...loadouts].sort((left, right) => {
    const defaultDelta = Number(right?.isDefault === true) - Number(left?.isDefault === true);
    if (defaultDelta !== 0) {
      return defaultDelta;
    }

    const combatDelta = isCombatLoadout(right) - isCombatLoadout(left);
    if (combatDelta !== 0) {
      return combatDelta;
    }

    return String(left?.name || '').localeCompare(String(right?.name || ''));
  });

  return String(candidates[0]?.id || '');
}

const selectedLoadoutId = ref('');
const pendingLoadoutId = ref('');
const applyConfirmOpen = ref(false);
const pendingLoadoutName = computed(() => {
  const loadoutId = pendingLoadoutId.value;
  return String(visibleLoadouts.value.find((entry) => entry.id === loadoutId)?.name || '');
});
// 正文带配装名且含 {{name}} 插值：模板内联 t() 的 fallback 不能出现双花括号（Vue 会在字符串内
// 首个 }} 处截断插值，prettier 还会把残片当文本节点重排并改坏模板），因此在这里生成。
const applyConfirmBody = computed(() =>
  t(
    'common:vue.home.loadout.confirmBody',
    'Apply "{{name}}"? This overwrites your current equipment, food, drinks, and abilities, and replaces the entire trigger map.',
    { name: pendingLoadoutName.value },
  ),
);

watch(
  () => visibleLoadouts.value,
  (loadouts) => {
    const ids = loadouts.map((entry) => entry.id);
    if (!ids.includes(selectedLoadoutId.value)) {
      selectedLoadoutId.value = pickDefaultLoadoutId(loadouts);
    }
  },
  { immediate: true },
);

// 套用配装会整包覆盖装备/食物/饮品/技能，并整体替换 triggerMap（快照外的触发器规则会丢失），
// 且没有撤销入口：单击 Apply 只打开确认弹窗，确认后才写入，写入的仍是打开弹窗时选中的那一套
// （弹窗期间配装列表被外部刷新也不会改成别的配装）。
function requestApplySelectedLoadout() {
  if (!selectedLoadoutId.value) {
    return;
  }
  pendingLoadoutId.value = selectedLoadoutId.value;
  applyConfirmOpen.value = true;
}

function closeApplyConfirm() {
  applyConfirmOpen.value = false;
  pendingLoadoutId.value = '';
}

function confirmApplySelectedLoadout() {
  const loadoutId = pendingLoadoutId.value;
  closeApplyConfirm();
  if (loadoutId) {
    simulator.applyActivePlayerLoadout(loadoutId);
  }
}
</script>
