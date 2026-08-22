<template>
  <BaseModal
    :open="open"
    :title="t('common:vue.home.guildBuffs.title', 'Guild Shrine Buffs')"
    panel-class="max-w-[94vw] lg:max-w-4xl"
    @close="$emit('close')"
  >
    <div class="mb-3 flex items-center justify-end">
      <button type="button" class="button-secondary" @click="clearGuildBuffLevels">
        {{ t('common:vue.home.clearAll', 'Clear All') }}
      </button>
    </div>
    <div class="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
      <div
        v-for="option in guildBuffOptions"
        :key="option.hrid"
        class="grid gap-4 rounded-lg border border-border bg-muted/50 p-4 md:grid-cols-[minmax(0,1fr)_10rem] md:items-center"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-heading text-sm font-semibold text-foreground">
              {{ getGuildShrineName(option.shrineHrid, option.shrineName) }}
            </h3>
            <span
              class="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              >{{ getOfficialGameText('guildPanel', 'combat', 'Combat') }}</span
            >
          </div>
          <p
            class="mt-2 text-sm leading-6"
            :class="guildBuffLevel(option.hrid) > 0 ? 'text-success' : 'text-muted-foreground'"
          >
            {{ formatGuildBuffEffects(option, guildBuffLevel(option.hrid)) }}
          </p>
        </div>
        <label class="block"
          ><span class="control-label">{{ t('common:vue.home.guildBuffs.effectiveLevel', 'Effective Level') }}</span>
          <div class="flex items-center gap-2">
            <input
              class="control-input min-w-0"
              type="number"
              min="0"
              :max="option.maxLevel"
              :value="guildBuffLevel(option.hrid)"
              @input="setGuildBuffLevel(option.hrid, $event.target.value)"
            /><span class="shrink-0 text-xs text-muted-foreground">/ {{ option.maxLevel }}</span>
          </div></label
        >
      </div>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed } from 'vue';
import {
  combatGuildBuffDetails,
  getGuildBuffMaxLevel,
  guildShrineDetailIndex,
  normalizeGuildBuffLevels,
} from '../../../shared/guildBuffs.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import BaseModal from '../BaseModal.vue';

defineProps({ open: { type: Boolean, default: false } });
defineEmits(['close']);
const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getBuffTypeName, getGuildShrineName, getOfficialGameText } = useGameDataText();
const activePlayer = computed(() => simulator.activePlayer);
const guildBuffOptions = computed(() =>
  combatGuildBuffDetails.map((detail) => ({
    ...detail,
    shrineName: String(guildShrineDetailIndex?.[detail.shrineHrid]?.name || detail.shrineHrid || ''),
    maxLevel: getGuildBuffMaxLevel(detail.hrid),
  })),
);
function guildBuffLevel(hrid) {
  return Number(activePlayer.value?.guildBuffs?.[hrid] || 0);
}
function setGuildBuffLevel(hrid, value) {
  simulator.ensurePlayerConfig(activePlayer.value);
  const parsed = Math.floor(Number(value));
  activePlayer.value.guildBuffs[hrid] = Number.isFinite(parsed)
    ? Math.max(0, Math.min(parsed, getGuildBuffMaxLevel(hrid)))
    : 0;
}
function clearGuildBuffLevels() {
  simulator.ensurePlayerConfig(activePlayer.value);
  activePlayer.value.guildBuffs = normalizeGuildBuffLevels({});
}
function formatGuildBuffEffects(option, level) {
  const normalized = Math.max(0, Math.min(Math.floor(Number(level) || 0), option.maxLevel));
  if (normalized <= 0) return t('common:vue.home.guildBuffs.inactive', 'Inactive');
  return (option.buffs || [])
    .map((buff) => {
      const ratio = Number(buff?.ratioBoost || 0) + (normalized - 1) * Number(buff?.ratioBoostLevelBonus || 0);
      const flat = Number(buff?.flatBoost || 0) + (normalized - 1) * Number(buff?.flatBoostLevelBonus || 0);
      return `${getBuffTypeName(buff?.typeHrid, buff?.typeHrid)} +${((ratio !== 0 ? ratio : flat) * 100).toFixed(1).replace(/\.0$/, '')}%`;
    })
    .join(' · ');
}
</script>
