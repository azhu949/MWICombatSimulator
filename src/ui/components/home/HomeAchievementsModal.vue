<template>
  <BaseModal
    :open="open"
    :title="getOfficialGameText('achievementsPanel', 'achievements', 'Achievements')"
    panel-class="max-w-[96vw] xl:max-w-[1200px]"
    @close="$emit('close')"
  >
    <div class="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
      <DisclosurePanel
        v-for="section in achievementTierSections"
        :key="section.tierHrid"
        :title="`${section.tierName} (${section.checkedCount}/${section.totalCount})`"
      >
        <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-foreground/85">
          <span>{{ section.buffText }}</span
          ><button type="button" class="button-secondary" @click="setTierAchievements(section.tierHrid, true)">
            {{ t('common:vue.home.selectAll', 'Select All') }}</button
          ><button type="button" class="button-secondary" @click="setTierAchievements(section.tierHrid, false)">
            {{ t('common:vue.home.clearAll', 'Clear All') }}
          </button>
        </div>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <label
            v-for="detail in section.details"
            :key="detail.hrid"
            class="status-chip flex items-start gap-2 text-sm text-foreground"
            ><span class="min-w-0 flex-1 leading-snug">{{ getAchievementName(detail.hrid, detail.name) }}</span
            ><input
              class="mt-0.5 shrink-0"
              :checked="Boolean(activePlayer.achievements?.[detail.hrid])"
              type="checkbox"
              @change="setAchievement(detail.hrid, $event.target.checked)"
          /></label>
        </div>
      </DisclosurePanel>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed } from 'vue';
import achievementDetailMap from '../../../combatsimulator/data/achievementDetailMap.json';
import achievementTierMap from '../../../combatsimulator/data/achievementTierDetailMap.json';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import BaseModal from '../BaseModal.vue';
import DisclosurePanel from '../DisclosurePanel.vue';

defineProps({ open: { type: Boolean, default: false } });
defineEmits(['close']);
const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getAchievementName, getAchievementTierName, getBuffTypeName, getOfficialGameText } = useGameDataText();
const activePlayer = computed(() => simulator.activePlayer);
const achievementDetailsByTier = Object.values(achievementDetailMap).reduce((result, detail) => {
  const tierHrid = String(detail?.tierHrid || '');
  if (tierHrid) (result[tierHrid] ||= []).push(detail);
  return result;
}, {});
Object.values(achievementDetailsByTier).forEach((details) =>
  details.sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0)),
);
const achievementTierSections = computed(() => {
  const achievements = activePlayer.value?.achievements ?? {};
  return Object.values(achievementTierMap)
    .slice()
    .sort((a, b) => Number(a.sortIndex || 0) - Number(b.sortIndex || 0))
    .map((tier) => {
      const details = achievementDetailsByTier[tier.hrid] ?? [];
      if (details.length === 0) return null;
      const typeHrid = String(tier?.buff?.typeHrid || '');
      const value = Number(tier?.buff?.ratioBoost || tier?.buff?.flatBoost || 0);
      return {
        tierHrid: tier.hrid,
        tierName: getAchievementTierName(tier.hrid, tier.name),
        buffText: `${t('common:vue.home.buff', 'Buff')}: ${typeHrid ? getBuffTypeName(typeHrid, typeHrid) : t('common:vue.home.buff', 'Buff')} +${(value * 100).toFixed(1).replace(/\.0$/, '')}%`,
        details,
        totalCount: details.length,
        checkedCount: details.filter((detail) => Boolean(achievements[detail.hrid])).length,
      };
    })
    .filter(Boolean);
});
function setAchievement(hrid, checked) {
  simulator.ensurePlayerConfig(activePlayer.value);
  activePlayer.value.achievements[hrid] = Boolean(checked);
  simulator.persistPlayerAchievements();
}
function setTierAchievements(tierHrid, checked) {
  simulator.ensurePlayerConfig(activePlayer.value);
  for (const detail of achievementDetailsByTier[tierHrid] ?? [])
    activePlayer.value.achievements[detail.hrid] = Boolean(checked);
  simulator.persistPlayerAchievements();
}
</script>
