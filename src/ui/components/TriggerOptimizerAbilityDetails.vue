<template>
  <BaseModal :open="open" :title="title" panel-class="max-w-4xl" @close="emit('close')">
    <div v-if="choice" class="space-y-4" data-trigger-optimizer-details>
      <!-- 状态行：这个技能到底被改没改、改动有多少证据。与结果卡片上的徽章同一套判据，
           只是这里能把「为什么」摊开写（卡片只有一行位置）。 -->
      <div class="flex flex-wrap items-center gap-2 text-xs" data-trigger-optimizer-details-status>
        <span class="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground" data-trigger-optimizer-details-slot>
          {{ t('common:triggerOptimizer.slotLabel', '', { index: slotNumber }) }}
        </span>
        <span v-if="choice.locked" class="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
          {{ t('common:triggerOptimizer.locked') }}
        </span>
        <span
          v-if="recommended"
          class="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
          data-trigger-optimizer-details-recommendation
        >
          {{ t('common:triggerOptimizer.recommendation') }}
        </span>
        <span v-else class="rounded bg-muted px-1.5 py-0.5 text-muted-foreground" data-trigger-optimizer-details-keep>
          {{ t('common:triggerOptimizer.keepCurrent') }}
        </span>
        <span v-if="choice.chosen" class="tabular-nums text-muted-foreground">
          {{ t('common:triggerOptimizer.score') }} {{ candidateScoreText(choice.chosen) }}
        </span>
        <span v-if="chosenSignal" class="rounded px-1 py-0.5" :class="verdictBadgeClass(chosenSignal.verdict)">
          {{ t(`common:triggerOptimizer.signals.${chosenSignal.verdict || 'unknown'}`) }}
        </span>
        <span
          v-if="adopted"
          class="rounded bg-success/10 px-1 py-0.5 text-success"
          data-trigger-optimizer-details-adopted
        >
          {{ t('common:triggerOptimizer.adoptedChip') }}
        </span>
      </div>

      <!-- 配置对比：左「当前配置（搜索起点）」、右「模拟最优配置」。两侧用不同颜色高亮
           （左冷蓝 / 右主色，与结果卡片同一套），变化过的条目带圆点，两侧完全一致时不再让用户逐行比对。 -->
      <div class="grid gap-3 sm:grid-cols-2">
        <section
          v-for="panel in configPanels"
          :key="panel.key"
          class="min-w-0 rounded-md border p-3"
          :class="panel.panelClass"
          :data-trigger-optimizer-details-config="panel.key"
        >
          <header class="flex flex-wrap items-baseline justify-between gap-1">
            <p class="text-xs font-medium" :class="panel.titleClass">{{ t(panel.titleKey) }}</p>
            <p
              v-if="panel.label"
              class="rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary"
              data-trigger-optimizer-details-config-label
            >
              {{ panel.label }}
            </p>
          </header>
          <p
            v-if="panel.isDefault"
            class="text-[10px] text-muted-foreground"
            data-trigger-optimizer-details-config-default
          >
            {{ t('common:triggerOptimizer.defaultTriggers') }}
          </p>
          <ul class="mt-2 space-y-1 text-xs">
            <li
              v-for="(line, index) in panel.lines"
              :key="index"
              class="flex items-start gap-1.5"
              :class="line.changed ? 'text-foreground' : 'text-muted-foreground'"
            >
              <span
                class="mt-1.5 size-1 shrink-0 rounded-full"
                :class="line.changed ? 'bg-primary' : 'bg-transparent'"
                aria-hidden="true"
              />
              <span class="min-w-0 break-words">{{ line.text }}</span>
            </li>
          </ul>
          <p v-if="panel.sameAsOther" class="mt-2 text-[10px] text-muted-foreground">
            {{ t('common:triggerOptimizer.sameAsCurrent') }}
          </p>
        </section>
      </div>

      <!-- 本槽净效应（配对差，2026-09-23）：报告里每条候选都带**逐指标**配对统计
           （triggerOptimizerScoring.computePairedStats 的 metrics），被采纳的那条（chosen）的参考系
           是**本槽搜索起点**，因此它逐指标的配对差就是「这个技能这一次改动赚了什么」。
           与下面那张累计表各回答一个问题，两张都保留：
             本表 = 本槽净效应（含每项指标自己的显著性）；
             下表 = 基线 → 最优的累计值（能读出绝对值，但混着同轮其它技能的改动）。 -->
      <section
        v-if="netMetricRows.length"
        class="rounded-md border border-primary/40 bg-primary/5 p-3"
        data-trigger-optimizer-details-net-metrics
      >
        <p class="text-xs font-medium">{{ t('common:triggerOptimizer.netMetricsTitle') }}</p>
        <p class="mt-0.5 text-[10px] text-muted-foreground">
          {{ t('common:triggerOptimizer.netMetricsHint') }}
        </p>
        <table class="mt-2 w-full text-left text-xs">
          <thead class="text-muted-foreground">
            <tr>
              <th class="py-1 pr-2">{{ t('common:triggerOptimizer.metricColumn') }}</th>
              <th class="py-1 pr-2 text-right">{{ t('common:triggerOptimizer.pairedDelta') }}</th>
              <th class="py-1 text-right">{{ t('common:triggerOptimizer.significanceColumn') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in netMetricRows"
              :key="row.key"
              class="border-t border-border"
              :data-trigger-optimizer-net-metric="row.key"
            >
              <td class="py-1 pr-2">{{ t(`common:triggerOptimizer.metrics.${row.key}`) }}</td>
              <td class="py-1 pr-2 text-right font-medium tabular-nums" :class="deltaClass(row.key, row.mean)">
                {{ netDeltaText(row) }}
              </td>
              <td
                class="py-1 text-right"
                :class="significanceClass(row.verdict)"
                :data-trigger-optimizer-net-significance="significanceKey(row.verdict)"
              >
                {{ significanceLabel(row.verdict) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 累计口径指标明细：只在**本槽被采纳**时展示。未采纳的槽摆出这张表，等于把别的技能
           赚到的提升记在它头上（实测：火球槽没采纳，表里却写着 DPS +1.5%，那是同轮熔岩爆裂的
           功劳）。本槽自己的净效应见上面那张表。 -->
      <section
        v-if="metricRows.length"
        class="rounded-md border border-border p-3"
        data-trigger-optimizer-details-metrics
      >
        <p class="text-xs font-medium">
          {{ t('common:triggerOptimizer.candidateMetricsTitle') }}
          <span v-if="chosenLabel" class="text-muted-foreground">· {{ chosenLabel }}</span>
        </p>
        <p class="mt-0.5 text-[10px] text-muted-foreground">
          {{ t('common:triggerOptimizer.candidateMetricsHint') }}
        </p>
        <table class="mt-2 w-full text-left text-xs">
          <thead class="text-muted-foreground">
            <tr>
              <th class="py-1 pr-2">{{ t('common:triggerOptimizer.metricColumn') }}</th>
              <th class="py-1 pr-2 text-right">{{ t('common:triggerOptimizer.baseline') }}</th>
              <th class="py-1 pr-2 text-right">{{ t('common:triggerOptimizer.best') }}</th>
              <th class="py-1 text-right">{{ t('common:triggerOptimizer.deltaColumn') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in metricRows" :key="row.key" class="border-t border-border">
              <td class="py-1 pr-2">{{ t(`common:triggerOptimizer.metrics.${row.key}`) }}</td>
              <td class="py-1 pr-2 text-right tabular-nums">{{ formatMetricValue(row.key, row.baseline) }}</td>
              <td class="py-1 pr-2 text-right font-medium tabular-nums">
                {{ formatMetricValue(row.key, row.best) }}
              </td>
              <td class="py-1 text-right tabular-nums" :class="deltaClass(row.key, row.delta)">
                {{ formatDelta(row.key, row.delta, row.baseline) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 其它候选的模拟结果：分数与配对信号（采纳闸门的原始证据）。表内**按分数降序**
           （2026-09-22 用户要求），标题旁标明口径，免得读者以为这是生成顺序。 -->
      <section class="rounded-md border border-border p-3" data-trigger-optimizer-details-candidates>
        <p class="text-xs font-medium">
          {{ t('common:triggerOptimizer.candidateDetails', '', { count: candidates.length }) }}
          <span class="ml-1 text-[10px] font-normal text-muted-foreground">{{
            t('common:triggerOptimizer.candidateSortHint')
          }}</span>
        </p>
        <!-- 截断透明化（2026-09-23，设计 §28）：候选表被「每槽候选上限」截断时明示还有多少条
             从未被评估 —— 「8 个候选」不等于「搜索试遍了所有可能」（截断是静默丢候选）。 -->
        <p
          v-if="truncatedCandidates > 0"
          class="mt-1 text-[10px] text-muted-foreground"
          data-trigger-optimizer-candidates-truncated
        >
          {{
            t('common:triggerOptimizer.candidatesTruncated', '', {
              count: truncatedCandidates,
              limit: candidateLimit,
            })
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="text-muted-foreground">
              <tr>
                <th class="p-2">{{ t('common:triggerOptimizer.candidateColumn') }}</th>
                <th class="p-2 text-right">{{ t('common:triggerOptimizer.score') }}</th>
                <th class="p-2 text-right">{{ t('common:triggerOptimizer.signalColumn') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="candidate in sortedCandidates"
                :key="candidate.signature"
                class="border-t border-border"
                :class="isSlotBest(candidate) ? 'bg-primary/10' : ''"
                data-trigger-optimizer-candidate
                :data-trigger-optimizer-candidate-winner="isSlotBest(candidate) ? 'true' : 'false'"
              >
                <td class="p-2 align-top">
                  <div class="flex flex-wrap items-center gap-1">
                    <span :title="candidate.state === 'disabled' ? disabledHint : undefined">{{
                      candidateLabel(candidate)
                    }}</span>
                    <span v-if="isSlotBest(candidate)" class="rounded-sm bg-muted px-1 text-[10px] text-primary">{{
                      t('common:triggerOptimizer.slotBest')
                    }}</span>
                    <span
                      v-if="isSlotBest(candidate) && adopted"
                      class="rounded-sm bg-success/10 px-1 text-[10px] text-success"
                      data-trigger-optimizer-candidate-adopted
                      >{{ t('common:triggerOptimizer.adoptedChip') }}</span
                    >
                  </div>
                  <div v-if="triggerSummary(candidate)" class="text-muted-foreground">
                    {{ triggerSummary(candidate) }}
                  </div>
                </td>
                <td class="p-2 align-top">
                  <div class="flex items-center justify-end gap-2">
                    <div class="relative h-1.5 w-14 shrink-0 rounded-full bg-muted">
                      <div class="absolute inset-y-0 left-1/2 w-px bg-border/70" />
                      <div
                        class="absolute inset-y-0 rounded-full"
                        :class="candidateBarClass(candidate)"
                        :style="candidateBarStyle(candidate)"
                      />
                    </div>
                    <span class="tabular-nums">{{ candidateScoreText(candidate) }}</span>
                  </div>
                </td>
                <td class="p-2 text-right align-top" :class="verdictClass(candidateSignal(candidate)?.verdict)">
                  {{ candidateSignalLabel(candidate) }}
                  <!-- 配对差 ± 标准误：采纳闸门的判据是 |mean| > 2×SE（噪声地板），
                       把这两个数字摊开，用户才能理解「为什么这个候选分数更高却没被采纳」。 -->
                  <div v-if="candidateSignalDetail(candidate)" class="text-[10px] tabular-nums text-muted-foreground">
                    {{ candidateSignalDetail(candidate) }}
                  </div>
                  <!-- 粗筛行标注（设计 §30）：未进精测的候选只有 2 轮统计，必须与精测行区分。 -->
                  <div
                    v-if="candidateSampleNote(candidate)"
                    class="text-[10px] text-muted-foreground"
                    data-trigger-optimizer-candidate-screened
                  >
                    {{ candidateSampleNote(candidate) }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 深挖复核记录（设计 §18.1 / §21）：被噪声地板拦下的槽级最优候选换独立种子重判的结果。 -->
      <section v-if="deepDive" class="rounded-md border border-border p-3" data-trigger-optimizer-details-deep-dive>
        <p class="text-xs font-medium">{{ t('common:triggerOptimizer.deepDiveTitle') }}</p>
        <dl class="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.deepDiveRounds') }}</dt>
            <dd class="tabular-nums">{{ number(deepDive.rounds, 0) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.pairedDelta') }}</dt>
            <dd class="tabular-nums">{{ meanSeText(deepDive) }}</dd>
          </div>
          <div v-if="deepDivePValue != null" class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.verificationPValue') }}</dt>
            <dd class="tabular-nums">{{ deepDivePValue.toFixed(3) }}</dd>
          </div>
          <div v-if="deepDive.verdict" class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.verificationVerdict') }}</dt>
            <dd :class="verdictClass(deepDive.verdict)">
              {{ t(`common:triggerOptimizer.verdicts.${deepDive.verdict || 'unknown'}`) }}
            </dd>
          </div>
        </dl>
        <p class="mt-2 text-xs" :class="deepDive.adopted === true ? 'text-success' : 'text-muted-foreground'">
          {{
            deepDive.adopted === true
              ? t('common:triggerOptimizer.deepDiveAdopted', '', { rounds: number(deepDive.rounds, 0) })
              : t('common:triggerOptimizer.deepDiveBlocked', '', { rounds: number(deepDive.rounds, 0) })
          }}
        </p>
      </section>

      <!-- 跨槽联合采纳记录（设计 §19.11）：单槽证据不足、两槽联合显著时的补救。 -->
      <section
        v-if="jointAdoptions.length"
        class="rounded-md border border-border p-3"
        data-trigger-optimizer-details-joint
      >
        <p class="text-xs font-medium">{{ t('common:triggerOptimizer.jointAdoptionTitle') }}</p>
        <dl
          v-for="(entry, index) in jointAdoptions"
          :key="index"
          class="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2"
        >
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.jointSlots') }}</dt>
            <dd class="tabular-nums">{{ jointSlotText(entry) }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.pairedDelta') }}</dt>
            <dd class="tabular-nums">{{ meanSeText(entry) }}</dd>
          </div>
          <div v-if="entry.marginalMean != null" class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.jointMarginalMean') }}</dt>
            <dd class="tabular-nums">{{ signed(entry.marginalMean, 4) }}</dd>
          </div>
          <div v-if="entry.verdict" class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">{{ t('common:triggerOptimizer.verificationVerdict') }}</dt>
            <dd :class="verdictClass(entry.verdict)">
              {{ t(`common:triggerOptimizer.verdicts.${entry.verdict || 'unknown'}`) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed } from 'vue';
import { TRIGGER_OPTIMIZER_METRIC_KEYS } from '../../services/triggerOptimizerDomain.js';
import { TRIGGER_OPTIMIZER_CANDIDATE_DISABLED_HINT_KEY } from '../../services/triggerOptimizerCandidates.js';
import BaseModal from './BaseModal.vue';
import {
  buildNetMetricRows,
  createTriggerOptimizerText,
  netMetricSignificanceKey,
  TRIGGER_ORIGINAL_PANEL_CLASS,
  triggerBestPanelClass,
  triggerMetricDeltaClass,
  triggerVerdictBadgeClass,
  triggerVerdictTextClass,
} from './triggerOptimizerText.js';
import { useGameDataText } from '../composables/useGameDataText.js';
import { useI18nText } from '../composables/useI18nText.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  choice: { type: Object, default: null },
  // null = 该侧没有自定义触发器（游戏默认触发器）；[] = 立即释放；数组 = 自定义条目。
  originalTriggers: { type: Array, default: null },
  bestTriggers: { type: Array, default: null },
  // 「模拟最优配置」对应的候选标签（页面按 chosen 传进来，缺省不显示）。
  bestLabel: { type: String, default: '' },
  metricsByCandidate: { type: Object, default: () => ({}) },
  baselineMetrics: { type: Object, default: null },
  deepDive: { type: Object, default: null },
  jointAdoptions: { type: Array, default: () => [] },
  resultRejected: { type: Boolean, default: false },
  adopted: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const { t, language } = useI18nText();
const { getAbilityName, getOfficialGameText } = useGameDataText();
const number = (value, digits = 2) =>
  Number(value || 0).toLocaleString(language.value, { maximumFractionDigits: digits });
const {
  signed,
  formatMetricValue,
  signedCompact,
  configLines,
  configsMatch,
  triggerSummary,
  candidateLabel,
  netDeltaText,
  netMetricSignificanceLabel: significanceLabel,
} = createTriggerOptimizerText({ t, number, getOfficialGameText });

const disabledHint = computed(() => t(TRIGGER_OPTIMIZER_CANDIDATE_DISABLED_HINT_KEY, ''));
const slotNumber = computed(() => Number(props.choice?.slotIndex ?? 0) + 1);
const candidates = computed(() => (Array.isArray(props.choice?.candidates) ? props.choice.candidates : []));
// 被「每槽候选上限」截掉、从未评估的候选条数（0 = 候选表完整，提示不显示）。数据来自生成器
// （triggerOptimizerCandidates.buildCandidateConfigs 的 truncatedCandidates / candidateLimit）——
// 「评估了 8 条」与「只有 8 条」是两件事，报告必须能区分。
const truncatedCandidates = computed(() => {
  const value = Number(props.choice?.truncatedCandidates);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
});
const candidateLimit = computed(() => {
  const value = Number(props.choice?.candidateLimit);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
});
const title = computed(() =>
  t('common:triggerOptimizer.detailsTitle', '', { name: getAbilityName(props.choice?.abilityHrid) }),
);
// 「推荐」与结果卡片同一套判据（复验判负 / 得分 0 / 该槽真的被采纳过）——两处口径分叉会让
// 卡片说「保持当前配置」而弹窗说「推荐」。
const recommended = computed(
  () =>
    Boolean(props.choice?.chosen) && !props.resultRejected && Number(props.choice.chosen.score) > 0 && props.adopted,
);
const chosenSignal = computed(() => props.choice?.chosen?.paired?.score ?? null);
const chosenLabel = computed(() => (props.choice?.chosen ? candidateLabel(props.choice.chosen) : ''));

// 报告记录以「槽位 + 签名」为键：不同技能可能生成同一份触发器列表，只按签名做键会串味。
function candidateEntry(candidate) {
  const chosen = props.choice?.chosen;
  if (chosen && candidate && chosen.signature === candidate.signature && Number.isFinite(Number(chosen.score))) {
    return { score: chosen.score, paired: chosen.paired ?? null, metrics: chosen.metrics ?? null };
  }
  const key = `${Number(props.choice?.slotIndex)}|${String(candidate?.signature ?? '')}`;
  return props.metricsByCandidate?.[key] ?? null;
}
function isSlotBest(candidate) {
  const signature = props.choice?.chosen?.signature;
  return Boolean(signature && signature === candidate?.signature);
}
function candidateScoreText(candidate) {
  const entry = candidateEntry(candidate);
  return entry && Number.isFinite(Number(entry.score)) ? number(entry.score, 4) : '—';
}
function candidateSignal(candidate) {
  return candidateEntry(candidate)?.paired?.score ?? null;
}
function candidateSignalLabel(candidate) {
  const signal = candidateSignal(candidate);
  if (!signal) return '—';
  return t(`common:triggerOptimizer.signals.${signal.verdict || 'unknown'}`);
}
// 「配对差 ± 标准误」：rounds < 2 时没有标准误 → 不显示。
function candidateSignalDetail(candidate) {
  const signal = candidateSignal(candidate);
  const mean = Number(signal?.mean);
  const stdError = Number(signal?.stdError);
  if (!Number.isFinite(mean) || !Number.isFinite(stdError)) return '';
  return t('common:triggerOptimizer.pairedMeanSe', '', { mean: signed(mean, 4), se: signed(stdError, 4) });
}
// 粗筛行标注（2026-09-24，设计 §30）：racing 后未进精测的候选只有粗筛的少量样本，
// 其配对统计不能与精测行混读 —— 依据必须绑定产生它的那批测量（§19.6 A3 的教训）。
function candidateSampleNote(candidate) {
  const entry = candidateEntry(candidate);
  if (!entry || entry.lane !== 'screen') return '';
  const rounds = Number(entry.sampleRounds ?? entry.metrics?.rounds ?? 0);
  return t('common:triggerOptimizer.candidateScreenedNote', '', {
    rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : 2,
  });
}
// 迷你发散条：与综合得分卡同款几何（0 居中、钳到 [-1,1]），让抽象分数可比较。
function scoreBarGeometry(raw) {
  if (!Number.isFinite(Number(raw))) return { left: '50%', width: '0%' };
  const clamped = Math.max(-1, Math.min(1, Number(raw)));
  const half = Math.abs(clamped) * 50;
  return clamped >= 0 ? { left: '50%', width: `${half}%` } : { left: `${50 - half}%`, width: `${half}%` };
}
function candidateBarStyle(candidate) {
  return scoreBarGeometry(Number(candidateEntry(candidate)?.score));
}
function candidateBarClass(candidate) {
  const raw = Number(candidateEntry(candidate)?.score);
  if (!Number.isFinite(raw) || raw === 0) return 'bg-muted-foreground';
  return raw > 0 ? 'bg-success' : 'bg-destructive';
}

const verdictClass = triggerVerdictTextClass;
const verdictBadgeClass = triggerVerdictBadgeClass;
const deltaClass = triggerMetricDeltaClass;

// 每侧按「对侧没有的那一行」打点：改过的条目亮起、没改的淡出，两侧一致时直接标一句
// 「与当前配置相同」，不必逐行对照。默认触发器（null）按游戏数据展开成真实条目——
// 与结果卡片共用同一套口径（triggerOptimizerText.configLines / configsMatch）。
// 配色同样与卡片共用（2026-09-22）：当前配置 = info 冷蓝、模拟最优配置 = primary 主色，
// 且只有真的改了才给实心高亮 + 左侧竖条（见 triggerBestPanelClass 的说明）。
const configPanels = computed(() => {
  const hrid = props.choice?.abilityHrid;
  const same = configsMatch(props.originalTriggers, props.bestTriggers, hrid);
  return [
    {
      key: 'original',
      titleKey: 'common:triggerOptimizer.originalConfig',
      titleClass: 'text-info',
      panelClass: TRIGGER_ORIGINAL_PANEL_CLASS,
      label: '',
      isDefault: props.originalTriggers == null,
      lines: configLines(props.originalTriggers, props.bestTriggers, hrid),
      sameAsOther: false,
    },
    {
      key: 'best',
      titleKey: 'common:triggerOptimizer.bestConfig',
      titleClass: 'text-primary',
      panelClass: triggerBestPanelClass(!same),
      label: props.bestLabel,
      isDefault: props.bestTriggers == null,
      lines: configLines(props.bestTriggers, props.originalTriggers, hrid),
      sameAsOther: same,
    },
  ];
});

// 候选表按分数降序（2026-09-22，用户要求）：读这张表的目的是「哪个候选更好」，
// 按报告顺序平铺时还要读者自己去找最大值。报告里没有分数记录的候选排在最后
// （`—` 不参与比较，否则会与「0 分」混为一谈）；同分保持报告原顺序（sort 稳定）——
// 同分时先出现的通常是锚点（当前配置 / 游戏默认），这个顺序本身有信息。
const sortedCandidates = computed(() => {
  const scored = candidates.value.map((candidate, index) => {
    const score = Number(candidateEntry(candidate)?.score);
    return { candidate, index, score: Number.isFinite(score) ? score : null };
  });
  scored.sort((left, right) => {
    if (left.score == null || right.score == null) {
      if (left.score == null && right.score == null) return left.index - right.index;
      return left.score == null ? 1 : -1;
    }
    if (left.score !== right.score) return right.score - left.score;
    return left.index - right.index;
  });
  return scored.map((entry) => entry.candidate);
});

// 累计口径指标明细：本槽候选被采纳时，整体配置的搜索期实测 vs 基线（同种子配对）。
// 只在 adopted 时渲染（模板注释有原因）：未采纳的槽没有「本槽改动」，摆出这张表会把
// 其它技能已采纳的提升记到它头上。**本槽自己的净效应**见 netMetricRows（上一张表）。
const METRIC_KEYS = [...TRIGGER_OPTIMIZER_METRIC_KEYS, 'deathsPerHour'];
const metricRows = computed(() => {
  if (!props.adopted) return [];
  const best = props.choice?.chosen?.metrics ?? null;
  const baseline = props.baselineMetrics;
  if (!best || !baseline) return [];
  return METRIC_KEYS.map((key) => ({
    key,
    baseline: Number(baseline[key] ?? 0),
    best: Number(best[key] ?? 0),
    delta: Number(best[key] ?? 0) - Number(baseline[key] ?? 0),
  }));
});

// 本槽净效应（2026-09-23；2026-09-25 抽共享）：取数与显著性映射在 triggerOptimizerText
// （buildNetMetricRows / netMetricSignificanceKey），结果卡片直显共用同一口径；配对差文本
// 与显著性文案来自 createTriggerOptimizerText（netDeltaText / significanceLabel 别名）。
// 与累计表同一判据：只在 adopted 时渲染（未采纳的槽没有「本槽改动」）。
const netMetricRows = computed(() => (props.adopted ? buildNetMetricRows(props.choice) : []));
const significanceKey = netMetricSignificanceKey;
// 显著性配色：只有「超出噪声」加粗提亮，其余保持中性（不把「没测出来」渲染成好或坏）。
function significanceClass(verdict) {
  return significanceKey(verdict) === 'significant' ? 'font-medium text-foreground' : 'text-muted-foreground';
}

function formatDelta(key, delta, baselineValue) {
  const body = signedCompact(key, delta);
  const numericBaseline = Number(baselineValue ?? 0);
  if (!numericBaseline || !Number.isFinite(Number(delta))) return body;
  return `${body} (${signed((Number(delta) / Math.abs(numericBaseline)) * 100, 1)}%)`;
}

const deepDivePValue = computed(() => {
  const value = Number(props.deepDive?.pValue);
  return Number.isFinite(value) ? value : null;
});
// 定义列表里「配对差」这一行的值：行标签已经写明是配对差，这里只给「均值 ± 标准误」，
// 不再套一层带前缀的文案（否则会渲染成「配对差 配对差 +0.024 ± +0.009」）。
function meanSeText(entry) {
  const mean = Number(entry?.mean);
  const stdError = Number(entry?.stdError);
  if (!Number.isFinite(mean)) return '—';
  return `${signed(mean, 4)} ± ${Number.isFinite(stdError) ? signed(stdError, 4) : '—'}`;
}
function jointSlotText(entry) {
  const slots = Array.isArray(entry?.slots) ? entry.slots : [];
  return slots.map((slot) => t('common:triggerOptimizer.slotLabel', '', { index: Number(slot) + 1 })).join(' + ');
}
</script>
