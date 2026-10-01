<template>
  <section class="min-w-0 space-y-5" data-food-optimizer-page>
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <h2 class="flex items-center gap-2 font-heading text-xl font-semibold">
        <Utensils class="size-5 text-primary" />{{ t('common:menu.foodOptimizer') }}
      </h2>
      <div class="flex flex-wrap gap-2">
        <Button as-child variant="outline" size="sm"
          ><RouterLink to="/home"><Settings2 />{{ t('common:foodOptimizer.editCombat') }}</RouterLink></Button
        >
        <Button v-if="running" size="sm" variant="destructive" @click="simulator.stopFoodOptimizer()"
          ><Square />{{ t('common:foodOptimizer.stop') }}</Button
        >
        <Button v-else size="sm" :disabled="!canStart" data-food-optimizer-open-scope @click="openScope"
          ><Play />{{ t('common:foodOptimizer.start') }}</Button
        >
      </div>
    </header>

    <div class="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label class="min-w-0"
        ><span class="control-label">{{ t('common:player') }}</span
        ><select
          class="control-input w-full"
          :value="simulator.activePlayerId"
          :disabled="running"
          @change="simulator.setActivePlayer($event.target.value)"
        >
          <option v-for="player in simulator.players" :key="player.id" :value="player.id">
            {{ player.name
            }}{{
              simulator.queue.importedProfileByPlayer[player.id] ? '' : ` (${t('common:foodOptimizer.notImported')})`
            }}
          </option>
        </select></label
      >
      <div class="min-w-0">
        <p class="control-label">{{ t('common:foodOptimizer.map') }}</p>
        <p class="break-words text-sm">{{ targetName(input.simulation) }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ difficultyText }}</p>
      </div>
      <div class="min-w-0">
        <p class="control-label">{{ t('common:foodOptimizer.duration') }}</p>
        <p class="text-sm">
          {{ number(input.simulation.simulationTimeLimit / ONE_HOUR) }} {{ t('common:foodOptimizer.hours') }}
        </p>
      </div>
      <div class="min-w-0">
        <p class="control-label">{{ t('common:foodOptimizer.teammates') }}</p>
        <p class="break-words text-sm">{{ teammates || t('common:foodOptimizer.none') }}</p>
      </div>
    </div>

    <div class="border-y border-border py-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ t('common:foodOptimizer.currentFood') }}</h3>
        <p class="text-xs text-muted-foreground">
          {{ t('common:foodOptimizer.priceMode') }}:
          {{ t(`common:foodOptimizer.priceModes.${input.prices.consumableMode}`) }}
        </p>
      </div>
      <FoodOptimizerDetails :slots="currentSlots" />
    </div>

    <div class="flex flex-wrap items-end gap-4">
      <label class="w-56 max-w-full"
        ><span class="control-label">{{ t('common:foodOptimizer.searchMode') }}</span
        ><select
          class="control-input w-full"
          data-food-optimizer-search-mode
          :value="simulator.foodOptimizer.settings.searchMode"
          :disabled="running"
          @change="simulator.setFoodOptimizerSettings({ searchMode: $event.target.value })"
        >
          <option :value="FOOD_OPTIMIZER_SEARCH_MODE_TOP10">
            {{ t('common:foodOptimizer.modeTop10Recommended') }}
          </option>
          <option :value="FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE">{{ t('common:foodOptimizer.modeComplete') }}</option>
        </select></label
      >
      <label class="w-40 max-w-full"
        ><span class="control-label">{{ t('common:foodOptimizer.thresholdStep') }}</span
        ><input
          v-model="stepDraft"
          class="control-input w-full"
          type="number"
          :min="FOOD_OPTIMIZER_MIN_STEP_PERCENT"
          :max="FOOD_OPTIMIZER_MAX_STEP_PERCENT"
          step="1"
          :disabled="running"
          :aria-invalid="!validDraft"
          @input="updateSettings('thresholdStepPercent', $event.target.value)"
      /></label>
      <label class="w-32 max-w-full"
        ><span class="control-label">{{ t('common:foodOptimizer.rounds') }}</span
        ><input
          v-model="roundsDraft"
          class="control-input w-full"
          type="number"
          :min="FOOD_OPTIMIZER_MIN_ROUNDS"
          :max="FOOD_OPTIMIZER_MAX_ROUNDS"
          step="1"
          :disabled="running"
          :aria-invalid="!validDraft"
          @input="updateSettings('rounds', $event.target.value)"
      /></label>
      <label class="flex items-center gap-2 pb-2 text-sm">
        <input
          type="checkbox"
          data-food-optimizer-zero-deaths
          :checked="zeroDeathsSetting"
          :disabled="running"
          @change="simulator.setFoodOptimizerSettings({ requireZeroDeaths: $event.target.checked })"
        />
        <span>{{ t('common:foodOptimizer.zeroDeaths') }}</span>
      </label>
      <dl class="flex min-w-0 flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt class="text-xs text-muted-foreground">{{ t('common:foodOptimizer.candidates') }}</dt>
          <dd class="tabular-nums">
            {{ candidateCount == null ? (labyrinthTarget ? '—' : '...') : number(candidateCount, 0) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">{{ t('common:foodOptimizer.maxRounds') }}</dt>
          <dd class="tabular-nums">
            {{
              candidateCount == null
                ? labyrinthTarget
                  ? '—'
                  : '...'
                : number((candidateCount + 1) * simulator.foodOptimizer.settings.rounds, 0)
            }}
          </dd>
        </div>
        <div v-if="resources">
          <dt class="text-xs text-muted-foreground">HP / MP / {{ t('common:foodOptimizer.slots') }}</dt>
          <dd class="tabular-nums">
            {{ number(resources.maxHp, 0) }} / {{ number(resources.maxMp, 0) }} / {{ resources.foodSlots }}
          </dd>
        </div>
        <div v-if="scopeTotal">
          <dt class="text-xs text-muted-foreground">{{ t('common:foodOptimizer.foodScope', 'Food scope') }}</dt>
          <dd class="tabular-nums" data-food-optimizer-scope>{{ scopeLabel }}</dd>
        </div>
      </dl>
    </div>
    <p class="text-xs text-muted-foreground" data-food-optimizer-mode-hint>
      {{
        t(
          input.searchMode === FOOD_OPTIMIZER_SEARCH_MODE_TOP10
            ? 'common:foodOptimizer.top10ModeHint'
            : 'common:foodOptimizer.completeModeHint',
        )
      }}
    </p>
    <p class="text-xs text-muted-foreground" data-food-optimizer-rounds-hint>
      {{ t('common:foodOptimizer.roundsHint') }}
    </p>
    <p v-if="zeroDeathsSetting" class="text-xs text-muted-foreground" data-food-optimizer-zero-deaths-hint>
      {{ t('common:foodOptimizer.zeroDeathsHint') }}
    </p>
    <p v-if="!validDraft" class="text-sm text-destructive" role="alert">
      {{ t('common:foodOptimizer.invalidSettings') }}
    </p>
    <p v-else-if="blockReason" class="text-sm text-warning" role="status">{{ t(blockReason) }}</p>
    <p v-if="labyrinthReport && !labyrinthTarget" class="text-sm text-warning" role="status">
      {{ t(FOOD_OPTIMIZER_LABYRINTH_ERROR) }}
    </p>
    <p v-if="errorText" class="break-words text-sm text-destructive" role="alert">{{ t(errorText, errorText) }}</p>

    <section v-if="running || report" class="space-y-3 border-t border-border pt-4">
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p class="font-medium">{{ t(`common:foodOptimizer.phases.${simulator.foodOptimizer.runtime.phase}`) }}</p>
        <span class="tabular-nums">{{ number(simulator.foodOptimizer.runtime.elapsedSeconds, 1) }} s</span>
      </div>
      <progress
        class="h-2 w-full accent-primary"
        :value="report?.complete ? 1 : simulator.foodOptimizer.runtime.progress"
        max="1"
        :aria-label="t('common:foodOptimizer.progress')"
      />
      <p v-if="!running && report?.fromCache" class="text-xs text-muted-foreground" data-food-optimizer-report-reuse>
        {{ t('common:foodOptimizer.reportReuseHint') }}
      </p>
      <p v-if="simulator.foodOptimizer.runtime.phase === 'baseline'" class="text-xs tabular-nums text-muted-foreground">
        {{ t('common:foodOptimizer.baseline') }}: {{ Math.floor(simulator.foodOptimizer.runtime.activeRounds) }} /
        {{ simulator.foodOptimizer.settings.rounds }}
      </p>
      <div v-if="report" class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span
          >{{ t('common:foodOptimizer.completedCandidates') }}: {{ number(report.stats.completedCandidates, 0) }} /
          {{ number(report.stats.totalCandidates, 0) }}</span
        ><span>{{ t('common:foodOptimizer.completedRounds') }}: {{ number(report.stats.completedRounds, 0) }}</span
        ><span v-if="report.stats.reusedRounds != null"
          >{{ t('common:foodOptimizer.reusedRounds') }}: {{ number(report.stats.reusedRounds, 0) }}</span
        ><span>{{ t('common:foodOptimizer.feasible') }}: {{ number(report.stats.feasibleCandidates, 0) }}</span
        ><span>{{ t('common:foodOptimizer.rejectedMana') }}: {{ number(report.stats.rejectedMana, 0) }}</span
        ><span>{{ t('common:foodOptimizer.rejectedDeaths') }}: {{ number(report.stats.rejectedDeaths, 0) }}</span>
        <span v-if="reportTop10" data-food-optimizer-pruned-count>
          {{ t('common:foodOptimizer.prunedCandidates') }}: {{ number(report.stats.prunedCandidates ?? 0, 0) }}
        </span>
        <template v-if="report.stats.skippedCandidates != null">
          <span
            >{{ t('common:foodOptimizer.simulatedCandidates') }}:
            {{ number(report.stats.simulatedCandidates, 0) }}</span
          >
          <span
            >{{ t('common:foodOptimizer.skippedCandidates') }}: {{ number(report.stats.skippedCandidates, 0) }}</span
          >
          <span
            >{{ t('common:foodOptimizer.reusedCandidates') }}: {{ number(report.stats.reusedCandidates ?? 0, 0) }}</span
          >
        </template>
        <span v-if="report.stats.totalCompositions != null">
          {{ t('common:foodOptimizer.screenedCompositions') }}: {{ number(report.stats.screenedCompositions, 0) }} /
          {{ number(report.stats.totalCompositions, 0) }}
        </span>
        <span v-if="report.stats.totalCompositions != null">
          {{ t('common:foodOptimizer.passedCompositions') }}: {{ number(report.stats.passedCompositions, 0) }}
        </span>
      </div>
      <p
        v-if="
          reportTop10 || report?.stats.skippedCandidates || report?.stats.reusedCandidates || report?.stats.reusedRounds
        "
        class="text-xs text-muted-foreground"
        data-food-optimizer-stats-hint
      >
        {{ t(reportTop10 ? 'common:foodOptimizer.top10StatsHint' : 'common:foodOptimizer.pruningHint') }}
      </p>
      <p v-if="stale" class="text-sm text-warning" role="status">{{ t('common:foodOptimizer.stale') }}</p>
      <template v-if="report?.baseline">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3">
          <h3 class="text-sm font-semibold">
            {{ t('common:foodOptimizer.baseline') }}: {{ reportPlayerName }} /
            {{ targetName(report.request.simulation ?? report.request.payload) }}
          </h3>
          <span class="text-xs text-muted-foreground"
            >{{ t(reportTop10 ? 'common:foodOptimizer.modeTop10' : 'common:foodOptimizer.modeComplete') }} /
            {{ report.request.thresholdStepPercent }}% / {{ report.request.rounds }}
            {{ t('common:foodOptimizer.rounds') }} / {{ t('common:foodOptimizer.foodScope', 'Food scope') }}
            {{ reportScopeLabel }}</span
          >
        </div>
        <dl class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <dt class="text-xs text-muted-foreground">{{ t('common:foodOptimizer.costPerHour') }}</dt>
            <dd class="tabular-nums">{{ number(report.baseline.costPerHour) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">{{ deathsLabel }}</dt>
            <dd>{{ report.baseline.deaths }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">{{ t('common:foodOptimizer.mana') }}</dt>
            <dd>
              {{
                t(report.baseline.ranOutOfMana ? 'common:foodOptimizer.outOfMana' : 'common:foodOptimizer.noOutOfMana')
              }}
            </dd>
          </div>
        </dl>
        <details>
          <summary class="cursor-pointer text-sm text-primary">{{ t('common:foodOptimizer.details') }}</summary>
          <FoodOptimizerDetails :slots="baselineSlots" :usage="report.baseline.foodUsed" :hours="reportHours" />
        </details>
      </template>
    </section>

    <section v-if="report?.baseline" class="space-y-3 border-t border-border pt-4">
      <h3 class="text-base font-semibold">
        {{ t(report.complete ? 'common:foodOptimizer.optimalTitle' : 'common:foodOptimizer.partialTitle') }}
      </h3>
      <p
        v-if="showSingleRoundDeathsHint"
        class="text-sm text-warning"
        role="status"
        data-food-optimizer-single-round-deaths-hint
      >
        {{ t('common:foodOptimizer.singleRoundDeathsHint') }}
      </p>
      <p v-if="reportZeroDeaths" class="text-xs text-muted-foreground" data-food-optimizer-zero-deaths-report-hint>
        {{ zeroDeathsReportText }}
      </p>
      <p v-if="!report.topResults.length" class="text-sm text-muted-foreground">
        {{ t('common:foodOptimizer.noResults') }}
      </p>
      <article
        v-for="(result, index) in report.topResults"
        :key="result.signature"
        class="min-w-0 rounded-md border border-border p-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <strong>#{{ index + 1 }}</strong
            ><span
              >{{ t('common:foodOptimizer.costPerHour') }}:
              <strong class="tabular-nums">{{ number(result.costPerHour) }}</strong></span
            ><span :class="result.savingsPerHour >= 0 ? 'text-success' : 'text-destructive'"
              >{{ t('common:foodOptimizer.savings') }}: {{ number(result.savingsPerHour) }}</span
            ><span class="text-xs text-muted-foreground">{{ deathsLabel }}: {{ result.deaths }}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            :disabled="
              running || busy || labyrinthTarget || labyrinthReport || report.appliedSignature === result.signature
            "
            @click="requestApplyResult(result.signature)"
            ><Check />{{
              t(
                report.appliedSignature === result.signature
                  ? 'common:foodOptimizer.applied'
                  : 'common:foodOptimizer.apply',
              )
            }}</Button
          >
        </div>
        <FoodOptimizerDetails
          :slots="result.slots.map((food) => ({ ...food, triggers: result.triggerMap[food.hrid] }))"
          :usage="result.foodUsed"
          :hours="reportHours"
        />
      </article>
    </section>

    <BaseModal
      :open="staleApplySignature !== null"
      :title="t('common:foodOptimizer.staleDialogTitle')"
      @close="staleApplySignature = null"
    >
      <p>{{ t('common:foodOptimizer.staleDialogHint') }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-food-optimizer-stale-cancel
          @click="staleApplySignature = null"
          >{{ t('common:foodOptimizer.cancel') }}</Button
        >
        <Button type="button" size="sm" variant="outline" data-food-optimizer-stale-restart @click="restartStaleSearch">
          <Play />{{ t('common:foodOptimizer.staleRestart') }}
        </Button>
        <Button type="button" size="sm" data-food-optimizer-stale-apply @click="confirmStaleApply">
          <Check />{{ t('common:foodOptimizer.staleApplyAnyway') }}
        </Button>
      </div>
    </BaseModal>

    <FoodOptimizerFoodScopeModal
      :open="scopeOpen"
      :items="scopeItems"
      :selected="input.foodHrids"
      :equipped-hrids="equippedHrids"
      :food-slots="resources?.foodSlots ?? 0"
      @close="scopeOpen = false"
      @confirm="confirmScope"
    />
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { Check, Play, Settings2, Square, Utensils } from '@lucide/vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { foodOptimizerBusy } from '../../stores/simulatorFoodOptimizerActions.js';
import { snapshotFoodOptimizerInput } from '../../services/foodOptimizerSnapshot.js';
import {
  FOOD_OPTIMIZER_MAX_ROUNDS,
  FOOD_OPTIMIZER_MAX_STEP_PERCENT,
  FOOD_OPTIMIZER_MIN_ROUNDS,
  FOOD_OPTIMIZER_MIN_STEP_PERCENT,
  FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE,
  FOOD_OPTIMIZER_SEARCH_MODE_TOP10,
  getFoodOptimizerItems,
  isFoodOptimizerZeroDeathsRequest,
  isValidFoodOptimizerSettings,
  normalizeFoodOptimizerZeroDeaths,
} from '../../services/foodOptimizerDomain.js';
import { FOOD_OPTIMIZER_LABYRINTH_ERROR, isFoodOptimizerLabyrinth } from '../../services/foodOptimizerTarget.js';
import { getDefaultTriggerDtosForHrid } from '../../services/triggerMapper.js';
import { resolveMarketPrice } from '../../services/marketPriceService.js';
import { ONE_HOUR } from '../../services/simulationDomain.js';
import { Button } from '../components/ui/button/index.js';
import FoodOptimizerDetails from '../components/FoodOptimizerDetails.vue';
import FoodOptimizerFoodScopeModal from '../components/FoodOptimizerFoodScopeModal.vue';
import BaseModal from '../components/BaseModal.vue';
import { useI18nText } from '../composables/useI18nText.js';
import { useGameDataText } from '../composables/useGameDataText.js';

const simulator = useSimulatorStore();
const { t, language } = useI18nText();
const { getActionName, getMonsterName } = useGameDataText();
const input = computed(() => snapshotFoodOptimizerInput(simulator));
const running = computed(() => simulator.foodOptimizer.runtime.isRunning);
const busy = computed(() => foodOptimizerBusy(simulator));
const report = computed(() => simulator.foodOptimizer.report);
const reportTop10 = computed(() => report.value?.request.searchMode === FOOD_OPTIMIZER_SEARCH_MODE_TOP10);
const labyrinthTarget = computed(() => isFoodOptimizerLabyrinth(input.value));
const labyrinthReport = computed(() => isFoodOptimizerLabyrinth(report.value?.request));
const stale = computed(() => simulator.foodOptimizerReportStale);
// 「累计死亡」是各轮死亡数的求和：把轮数写进标签，避免把 1 轮抽样误读成长期结论。
// 轮数缺失/非法时回退原标签，旧报告与异常请求都不会渲染出错误口径。
const reportRounds = computed(() => {
  const rounds = Number(report.value?.request?.rounds);
  return Number.isInteger(rounds) && rounds >= FOOD_OPTIMIZER_MIN_ROUNDS ? rounds : null;
});
const deathsLabel = computed(() =>
  reportRounds.value == null
    ? t('common:foodOptimizer.deaths')
    : t('common:foodOptimizer.deathsWithRounds', '', { rounds: reportRounds.value }),
);
const showSingleRoundDeathsHint = computed(() => Boolean(report.value?.baseline) && reportRounds.value === 1);
// 「排除有死亡的方案」：设置侧决定下一次搜索的口径；报告侧记录榜单实际执行的口径（旧报告没有
// 该字段时按未启用处理，与引擎的缺失回落一致）。
const zeroDeathsSetting = computed(() =>
  normalizeFoodOptimizerZeroDeaths(simulator.foodOptimizer.settings.requireZeroDeaths),
);
const reportZeroDeaths = computed(() => isFoodOptimizerZeroDeathsRequest(report.value?.request));
// 报告区的口径说明与勾选框共用同一份标签文案（locale 的 zeroDeaths）：改名只需改一处。
const zeroDeathsReportText = computed(() =>
  t('common:foodOptimizer.zeroDeathsReportHint', '', { label: t('common:foodOptimizer.zeroDeaths') }),
);
const stepDraft = ref(simulator.foodOptimizer.settings.thresholdStepPercent);
const roundsDraft = ref(simulator.foodOptimizer.settings.rounds);
const validDraft = computed(() =>
  isValidFoodOptimizerSettings({
    thresholdStepPercent: stepDraft.value,
    rounds: roundsDraft.value,
    searchMode: simulator.foodOptimizer.settings.searchMode,
  }),
);
const number = (value, digits = 2) =>
  Number(value || 0).toLocaleString(language.value, { maximumFractionDigits: digits });
const targetName = (simulation) =>
  simulation?.labyrinth
    ? getMonsterName(simulation.labyrinth.labyrinthHrid)
    : getActionName(simulation?.zone?.zoneHrid);
const difficultyText = computed(() =>
  input.value.simulation.labyrinth
    ? `${t('common:foodOptimizer.roomLevel')} ${input.value.simulation.labyrinth.roomLevel}`
    : `${t('common:foodOptimizer.tier')} ${input.value.simulation.zone?.difficultyTier}`,
);
const teammates = computed(() =>
  input.value.players
    .filter((player) => String(player.id) !== simulator.activePlayerId)
    .map((player) => player.name)
    .join(', '),
);
const blockReason = computed(() =>
  labyrinthTarget.value
    ? FOOD_OPTIMIZER_LABYRINTH_ERROR
    : !input.value.imported
      ? 'common:foodOptimizer.requireImport'
      : input.value.runScope !== 'single'
        ? 'common:foodOptimizer.requireSingle'
        : busy.value
          ? 'common:foodOptimizer.busy'
          : '',
);
const preview = computed(() =>
  !labyrinthTarget.value && simulator.foodOptimizer.preview?.inputSignature === simulator.foodOptimizerInputSignature
    ? simulator.foodOptimizer.preview
    : null,
);
const hasRunningReport = computed(
  () =>
    !labyrinthTarget.value &&
    !labyrinthReport.value &&
    running.value &&
    report.value?.status === 'running' &&
    simulator.foodOptimizer.runtime.phase !== 'preparing',
);
const resources = computed(() => (hasRunningReport.value ? report.value.request.resources : preview.value?.resources));
const candidateCount = computed(() =>
  validDraft.value
    ? hasRunningReport.value
      ? report.value.stats.totalCandidates
      : preview.value?.totalCandidates
    : null,
);
const canStart = computed(() => !running.value && !blockReason.value && validDraft.value && preview.value);
const errorText = computed(() => {
  const error = simulator.foodOptimizer.runtime.error || simulator.foodOptimizer.previewError;
  return error === FOOD_OPTIMIZER_LABYRINTH_ERROR && (labyrinthTarget.value || labyrinthReport.value) ? '' : error;
});
const reportHours = computed(() => report.value?.request.payload.simulationTimeLimit / ONE_HOUR || 1);
const reportPlayerName = computed(
  () => report.value?.request.players.find((player) => String(player.id) === report.value.request.activePlayerId)?.name,
);
function configSlots(player, prices) {
  return (player?.food || [])
    .map((hrid, slotIndex) =>
      hrid
        ? {
            hrid,
            slotIndex,
            triggers: player.triggerMap?.[hrid] ?? getDefaultTriggerDtosForHrid(hrid),
            price: resolveMarketPrice(prices.priceTable, hrid, prices.consumableMode),
          }
        : null,
    )
    .filter(Boolean);
}
const currentSlots = computed(() => configSlots(simulator.activePlayer, input.value.prices));
// 弹窗目录必须在应用范围之前计算：它只依赖资源上限、步长与价格，与已选范围无关。
const scopeItems = computed(() => {
  const current = resources.value;
  if (!current) return [];
  return getFoodOptimizerItems({
    ...current,
    thresholdStepPercent: simulator.foodOptimizer.settings.thresholdStepPercent,
    prices: input.value.prices.priceTable,
    consumableMode: input.value.prices.consumableMode,
  });
});
const scopeTotal = computed(() => scopeItems.value.length);
const scopeLabel = computed(() => {
  const selection = input.value.foodHrids;
  return `${Array.isArray(selection) ? selection.length : scopeTotal.value}/${scopeTotal.value}`;
});
const reportScopeLabel = computed(() => {
  if (!scopeTotal.value) return '';
  const selection = report.value?.request?.foodHrids;
  return `${Array.isArray(selection) ? selection.length : scopeTotal.value}/${scopeTotal.value}`;
});
const equippedHrids = computed(() => (simulator.activePlayer?.food || []).filter(Boolean));
const scopeOpen = ref(false);
function openScope() {
  if (canStart.value) scopeOpen.value = true;
}
function confirmScope(hrids) {
  if (!simulator.setFoodOptimizerSettings({ foodHrids: hrids })) return;
  scopeOpen.value = false;
  simulator.startFoodOptimizer();
}
// stale 报告的应用不再置灰按钮，改为点击时弹确认框：「重新搜索」走 startFoodOptimizer，
// 「仍要应用」以 force 绕过 store 的过期门禁（迷宫守卫仍拦）。取消即关闭弹窗。
const staleApplySignature = ref(null);
function requestApplyResult(signature) {
  if (stale.value) {
    staleApplySignature.value = signature;
    return;
  }
  simulator.applyFoodOptimizerResult(signature);
}
function confirmStaleApply() {
  const signature = staleApplySignature.value;
  staleApplySignature.value = null;
  if (signature === null) return;
  simulator.applyFoodOptimizerResult(signature, { force: true });
}
function restartStaleSearch() {
  staleApplySignature.value = null;
  simulator.startFoodOptimizer();
}
const baselineSlots = computed(() => {
  if (!report.value) return [];
  const player = report.value.request.payload.players.find(
    (entry) => entry.hrid === `player${report.value.request.activePlayerId}`,
  );
  return (player?.food || [])
    .map((food, slotIndex) =>
      food
        ? {
            hrid: food.hrid,
            slotIndex,
            triggers: food.triggers,
            price: resolveMarketPrice(
              report.value.request.prices.priceTable,
              food.hrid,
              report.value.request.prices.consumableMode,
            ),
          }
        : null,
    )
    .filter(Boolean);
});
function updateSettings(key, value) {
  simulator.setFoodOptimizerSettings({ [key]: value === '' ? '' : Number(value) });
}
watch([() => simulator.foodOptimizerInputSignature, running], () => simulator.refreshFoodOptimizerPreview(), {
  immediate: true,
});
watch(
  () => simulator.foodOptimizer.settings,
  (settings) => {
    stepDraft.value = settings.thresholdStepPercent;
    roundsDraft.value = settings.rounds;
  },
  { deep: true },
);
</script>
