<template>
  <div class="surface-panel">
    <h2 class="mb-3 font-heading text-lg font-semibold text-primary">
      {{ t('common:vue.home.levelsTitle', 'Levels') }}
    </h2>
    <div class="grid grid-cols-2 gap-3">
      <label class="col-span-2 block">
        <span class="control-label">{{ t('common:vue.home.averageCombatLevel', 'Combat Level') }}</span>
        <input :value="activePlayerCombatLevelLabel" class="control-input" type="text" readonly />
      </label>
      <label v-for="key in levelKeys" :key="key" class="block">
        <span class="control-label">{{ levelLabelMap[key] }}</span>
        <input
          v-model.number="activePlayer.levels[key]"
          :class="['control-input', isLevelChanged(key) ? 'border-primary/40 bg-primary/10' : '']"
          min="1"
          max="400"
          type="number"
        />
      </label>
    </div>
    <div v-if="levelEtaCards.length > 0" class="mt-4 space-y-3">
      <article
        v-for="card in levelEtaCards"
        :key="card.skillKey"
        :class="['rounded-lg border p-3 text-[11px] text-foreground', card.borderClass, card.bgClass]"
      >
        <h3 class="mb-2 font-medium" :class="card.titleClass">{{ card.title }}</h3>
        <div v-if="card.details" class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <span class="text-muted-foreground">{{ t('common:vue.home.levelEtaTotalExperience', 'Total XP') }}</span>
          <span class="text-right">{{ card.details.totalExperience }}</span>
          <span class="text-muted-foreground">{{ t('common:vue.home.levelEtaRequiredExperience', 'XP Needed') }}</span>
          <span class="text-right">{{ card.details.requiredExperience }}</span>
          <span class="text-muted-foreground">{{ t('common:vue.home.levelEtaRequiredTime', 'Time Needed') }}</span>
          <span class="text-right">{{ card.details.requiredTime }}</span>
          <span class="text-muted-foreground">{{
            t('common:vue.home.levelEtaCompletionTime', 'Completion Time')
          }}</span>
          <span class="text-right">{{ card.details.completionTime }}</span>
        </div>
        <p v-else class="text-xs leading-5" :class="card.messageClass">{{ card.message }}</p>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { calculateSkillUpgradeEta } from '../../../services/levelExperience.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { calcCombatLevel, LEVEL_KEYS } from '../../../shared/playerConfig.js';
import { useHomeBuildComparison, normalizeHomeLevel } from '../../composables/useHomeBuildComparison.js';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { formatNumber } from './homeFormatters.js';

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getSkillName } = useGameDataText();
const { activePlayer, importedBaselineSnapshot, isLevelChanged } = useHomeBuildComparison();
const levelKeys = LEVEL_KEYS;

const levelLabelMap = computed(() =>
  Object.fromEntries(levelKeys.map((skillKey) => [skillKey, getSkillName(`/skills/${skillKey}`, skillKey)])),
);
const activePlayerCombatLevel = computed(() => {
  const levels = activePlayer.value?.levels ?? {};
  return calcCombatLevel(
    Math.max(1, Number(levels.stamina ?? 1)),
    Math.max(1, Number(levels.intelligence ?? 1)),
    Math.max(1, Number(levels.defense ?? 1)),
    Math.max(1, Number(levels.attack ?? 1)),
    Math.max(1, Number(levels.melee ?? 1)),
    Math.max(1, Number(levels.ranged ?? 1)),
    Math.max(1, Number(levels.magic ?? 1)),
  );
});
const activePlayerCombatLevelLabel = computed(() => {
  const level = Number(activePlayerCombatLevel.value);
  return Number.isFinite(level) ? level.toFixed(1) : '-';
});
const activeSingleTargetResultRow = computed(() =>
  simulator.results.simResult
    ? simulator.results.summaryRows.find((row) => row.playerHrid === `player${simulator.activePlayerId}`) || null
    : null,
);
const levelEtaCards = computed(() => {
  const cards = [];
  const importedBaseline = importedBaselineSnapshot.value;
  const currentPlayer = activePlayer.value;
  const resultRow = activeSingleTargetResultRow.value;
  if (!importedBaseline || !currentPlayer) {
    return cards;
  }

  for (const levelKey of levelKeys) {
    const importedLevel = normalizeHomeLevel(importedBaseline?.levels?.[levelKey], 1);
    const targetLevel = normalizeHomeLevel(currentPlayer?.levels?.[levelKey], importedLevel);
    if (targetLevel <= importedLevel) {
      continue;
    }
    const skillLabel = levelLabelMap.value?.[levelKey] || levelKey;
    const title = `${skillLabel} → ${t('common:vue.home.levelShort', 'Lv')}.${targetLevel}`;
    const eta = calculateSkillUpgradeEta({
      currentLevel: importedLevel,
      currentExperience: importedBaseline?.skillExperience?.[levelKey],
      targetLevel,
      xpPerHour: resultRow?.[`${levelKey}XpPerHour`],
    });

    if (eta.status === 'ok') {
      cards.push({
        skillKey: levelKey,
        title,
        borderClass: 'border-success/40',
        bgClass: 'bg-success/10',
        titleClass: 'text-success',
        details: {
          totalExperience: `${formatNumber(eta.currentExperience, 0)} / ${formatNumber(eta.targetExperience, 0)}`,
          requiredExperience: formatNumber(eta.xpNeeded, 0),
          requiredTime: formatEtaDuration(eta.hoursNeeded),
          completionTime: formatEtaCompletionTime(eta.hoursNeeded),
        },
      });
      continue;
    }

    const common = {
      skillKey: levelKey,
      title,
      borderClass: 'border-primary/40',
      bgClass: 'bg-primary/10',
      titleClass: 'text-primary',
      messageClass: 'text-primary',
    };
    if (eta.status === 'missing_current_experience') {
      cards.push({
        ...common,
        message: t('common:vue.home.levelEtaMissingProgress', 'Current imported data has no level progress.'),
      });
    } else if (eta.status === 'target_out_of_range') {
      cards.push({
        ...common,
        message: t('common:vue.home.levelEtaOutOfRange', 'Target level is outside the current experience table range.'),
      });
    } else if (!resultRow || !simulator.results.simResult || eta.status === 'missing_xp_rate') {
      cards.push({
        ...common,
        borderClass: 'border-border',
        bgClass: 'bg-muted/50',
        titleClass: 'text-foreground',
        messageClass: 'text-foreground/85',
        message: t(
          'common:vue.home.levelEtaMissingResult',
          'Run a single-target simulation first to show upgrade time.',
        ),
      });
    } else if (eta.status === 'zero_xp_rate') {
      cards.push({
        ...common,
        message: t(
          'common:vue.home.levelEtaZeroRate',
          'Current simulation has 0 XP/h for this skill, so ETA is unavailable.',
        ),
      });
    }
  }
  return cards;
});

function formatEtaDuration(hours) {
  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) {
    return '-';
  }
  const totalMinutes = Math.max(1, Math.ceil(numericHours * 60));
  const years = Math.floor(totalMinutes / (60 * 24 * 365));
  const days = Math.floor((totalMinutes % (60 * 24 * 365)) / (60 * 24));
  const hoursPart = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (years > 0) parts.push(`${years}y`);
  if (days > 0) parts.push(`${days}d`);
  if (hoursPart > 0) parts.push(`${hoursPart}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatEtaCompletionTime(hours) {
  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) {
    return '-';
  }
  const completionDate = new Date(Date.now() + numericHours * 60 * 60 * 1000);
  const now = new Date();
  return completionDate.toLocaleString(undefined, {
    year: completionDate.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
</script>
