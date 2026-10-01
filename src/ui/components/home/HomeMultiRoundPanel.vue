<template>
  <div v-if="visibleMultiRound" class="surface-panel space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <h2 class="font-heading text-lg font-semibold text-primary">
        {{ t('common:vue.results.multiRound.title', 'Multi-round Statistics') }}
      </h2>
      <p class="text-xs text-muted-foreground">
        {{ t('common:vue.results.multiRound.roundsLabel', 'Rounds') }}: {{ visibleMultiRound.rounds }}
        <span class="mx-2">|</span>
        {{ t('common:vue.results.multiRound.seedBaseLabel', 'Base Seed') }}: {{ visibleMultiRound.seedBase }}
      </p>
    </div>

    <p
      v-if="failedCount > 0"
      class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
      role="status"
    >
      {{ failedCountText }}
    </p>

    <div v-for="player in playerSections" :key="player.playerHrid" class="space-y-2">
      <h3 class="font-heading text-sm font-semibold text-foreground">{{ player.playerLabel }}</h3>
      <div class="overflow-x-auto">
        <Table class="min-w-full text-sm">
          <TableHeader>
            <TableRow class="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <TableHead class="px-2 py-2">{{ t('common:triggerOptimizer.metricColumn', 'Metric') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:vue.results.multiRound.median', 'Median') }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:vue.results.multiRound.robustMean', 'Robust Mean')
              }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:vue.results.multiRound.mean', 'Mean') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:vue.results.multiRound.interval', '95% Interval') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:vue.results.multiRound.confidence', 'Confidence') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="metric in player.metricRows"
              :key="metric.key"
              class="border-b border-border text-foreground"
            >
              <TableCell class="px-2 py-2">{{ metric.label }}</TableCell>
              <TableCell class="px-2 py-2">{{ metric.medianText }}</TableCell>
              <TableCell class="px-2 py-2">{{ metric.robustMeanText }}</TableCell>
              <TableCell class="px-2 py-2">{{ metric.meanText }}</TableCell>
              <TableCell class="px-2 py-2">{{ metric.intervalText }}</TableCell>
              <TableCell class="px-2 py-2">{{ metric.confidenceText }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>

    <DisclosurePanel :title="t('common:vue.results.multiRound.perRoundTitle', 'Per-round Details')">
      <div class="space-y-3">
        <div v-for="table in perRoundTables" :key="table.playerHrid" class="space-y-2">
          <h4 v-if="perRoundTables.length > 1" class="font-heading text-sm font-semibold text-foreground">
            {{ table.playerLabel }}
          </h4>
          <div class="overflow-x-auto" :data-per-round-table="table.playerHrid">
            <Table class="min-w-full w-max text-sm">
              <TableHeader>
                <TableRow class="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <TableHead class="px-2 py-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-left uppercase transition hover:text-foreground"
                      data-per-round-sort="round"
                      @click="togglePerRoundSort('round')"
                    >
                      <span>{{ t('common:vue.queue.round', 'Round') }}</span>
                      <span
                        class="text-[10px]"
                        :class="perRoundSort.key === 'round' ? 'text-primary' : 'text-muted-foreground'"
                        >{{ getPerRoundSortIndicator('round') }}</span
                      >
                    </button>
                  </TableHead>
                  <TableHead class="px-2 py-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-left uppercase transition hover:text-foreground"
                      data-per-round-sort="seed"
                      @click="togglePerRoundSort('seed')"
                    >
                      <span>{{ t('common:vue.results.multiRound.seedColumn', 'Seed') }}</span>
                      <span
                        class="text-[10px]"
                        :class="perRoundSort.key === 'seed' ? 'text-primary' : 'text-muted-foreground'"
                        >{{ getPerRoundSortIndicator('seed') }}</span
                      >
                    </button>
                  </TableHead>
                  <TableHead v-for="metric in table.metrics" :key="metric.key" class="px-2 py-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-left uppercase transition hover:text-foreground"
                      :data-per-round-sort="metric.key"
                      @click="togglePerRoundSort(metric.key)"
                    >
                      <span>{{ metric.label }}</span>
                      <span
                        class="text-[10px]"
                        :class="perRoundSort.key === metric.key ? 'text-primary' : 'text-muted-foreground'"
                        >{{ getPerRoundSortIndicator(metric.key) }}</span
                      >
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="row in table.rows"
                  :key="row.round"
                  class="border-b border-border"
                  :class="row.failed ? 'text-muted-foreground' : 'text-foreground'"
                >
                  <TableCell class="px-2 py-2">{{ row.round }}</TableCell>
                  <TableCell class="px-2 py-2">{{ row.seed }}</TableCell>
                  <TableCell v-for="(cell, cellIndex) in row.cells" :key="cellIndex" class="px-2 py-2">
                    {{ cell }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </DisclosurePanel>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useGameDataText } from '../../composables/useGameDataText.js';
import { useI18nText } from '../../composables/useI18nText.js';
import DisclosurePanel from '../DisclosurePanel.vue';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table/index.js';
import { formatCurrency, formatNumber, formatPercent } from './homeFormatters.js';
import { formatCompactAmountForLocale } from '../../../services/amountFormatting.js';

// 首页多轮模拟的统计面板：数据来自 results.multiRound（多轮执行链路的聚合产物）。
// 该组件自身对缺失数据与 rounds < 2 保持空渲染——接入层 v-if 之外再兜一层，
// 保证单轮（rounds <= 1）与未运行状态不会产生任何新 UI。
const props = defineProps({
  multiRound: {
    type: Object,
    default: null,
  },
});

const { t, language } = useI18nText();
const { getSkillName } = useGameDataText();

// 金额口径与结果视图一致（收益/收入/支出等用 formatCurrency，其余数值指标用 formatNumber）；
// ≥1000 的数值统一走 compact k/m/b 缩写（与首页摘要、队列口径一致）。
const CURRENCY_METRIC_KEYS = new Set([
  'profitPerHour',
  'revenuePerHour',
  'expensesPerHour',
  'noRngRevenue',
  'expenses',
  'noRngProfit',
]);

// 指标标签优先复用结果视图与批量表的既有文案键；技能 XP（{skill}XpPerHour）走官方技能名。
// 先查显式映射再匹配技能模式，避免 totalXpPerHour 被误判为 "total" 技能。
const METRIC_LABEL_KEYS = {
  simulatedTime: ['common:vue.results.simulatedTime', 'Simulated Time'],
  encountersPerHour: ['common:vue.results.encountersPerHour', 'Encounters/h'],
  deathsPerHour: ['common:vue.results.deathsPerHour', 'Deaths/h'],
  totalXpPerHour: ['common:vue.results.xpPerHour', 'XP/h'],
  profitPerHour: ['common:vue.results.profitPerHour', 'Profit/h'],
  revenuePerHour: ['common:vue.results.revenuePerHour', 'Revenue/h'],
  expensesPerHour: ['common:vue.results.expensesPerHour', 'Expenses/h'],
  totalExperience: ['common:simulationResults.totalExperience', 'Total Experience'],
  noRngRevenue: ['common:noRNGRevenue', 'No RNG Revenue'],
  expenses: ['common:expense', 'Expense'],
  noRngProfit: ['common:noRNGProfit', 'No RNG Profit'],
};

const SKILL_XP_METRIC_PATTERN = /^([a-z]+)XpPerHour$/;

function metricLabel(metricKey) {
  const key = String(metricKey || '');
  const explicit = METRIC_LABEL_KEYS[key];
  if (explicit) {
    return t(explicit[0], explicit[1]);
  }
  const skillMatch = SKILL_XP_METRIC_PATTERN.exec(key);
  if (skillMatch) {
    const skill = skillMatch[1];
    const fallbackSkill = skill.charAt(0).toUpperCase() + skill.slice(1);
    return getSkillName(`/skills/${skill}`, fallbackSkill);
  }
  return key;
}

// 模拟时长以纳秒交付（simulationDomain.summarizeResult 的 simulatedTime），属时间类指标而非金额/计数：
// 不做 compact 缩写（否则 1h 模拟时长会被误显示为 '3,600b'），与结果视图（simulatedHoursText）同口径折算为小时。
const TIME_METRIC_KEYS = new Set(['simulatedTime']);
const NS_PER_HOUR = 3_600_000_000_000;

function formatTimeMetricValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric / NS_PER_HOUR).toFixed(2)} h` : '-';
}

function formatMetricValue(metricKey, value) {
  if (TIME_METRIC_KEYS.has(metricKey)) {
    return formatTimeMetricValue(value);
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && Math.abs(numeric) >= 1000) {
    return formatCompactAmountForLocale(numeric, language.value === 'zh' ? 'zh-CN' : 'en-US');
  }
  return CURRENCY_METRIC_KEYS.has(metricKey) ? formatCurrency(value) : formatNumber(value);
}

function buildMetricRow(metricKey, stat) {
  const label = metricLabel(metricKey);
  if (!stat || typeof stat !== 'object') {
    return {
      key: metricKey,
      label,
      stat: null,
      medianText: '-',
      robustMeanText: '-',
      meanText: '-',
      intervalText: '-',
      confidenceText: '-',
    };
  }
  return {
    key: metricKey,
    label,
    stat,
    medianText: formatMetricValue(metricKey, stat.p50),
    robustMeanText: formatMetricValue(metricKey, stat.robustMean),
    meanText: formatMetricValue(metricKey, stat.mean),
    intervalText: `[${formatMetricValue(metricKey, stat.ciLow)}, ${formatMetricValue(metricKey, stat.ciHigh)}]`,
    confidenceText: formatPercent(stat.confidence, 0),
  };
}

// 逐轮明细的原始取值：该轮在该指标统计里的原始值（失败轮 / 无样本为 null）。
// 排序必须用原始数值——格式化后的单元格文本（'1.5k'、带货币符号）不可直接比较；
// 单元格展示仍走 formatMetricValue。
function resolveRoundRawValue(metricRow, round) {
  const values = Array.isArray(metricRow.stat?.values) ? metricRow.stat.values : [];
  const statRounds = Array.isArray(metricRow.stat?.rounds) ? metricRow.stat.rounds : [];
  const valueIndex = statRounds.findIndex((value) => Number(value) === Number(round));
  if (valueIndex < 0 || valueIndex >= values.length) {
    return null;
  }
  return values[valueIndex] ?? null;
}

function formatRoundCellValue(metricRow, rawValue) {
  return rawValue == null ? '-' : formatMetricValue(metricRow.key, rawValue);
}

// 逐轮明细列排序：与多轮结果页（MultiResultsPage）同一交互——
// 点击列头按「降序 → 升序 → 恢复默认轮次序」循环，缺失值恒排末尾；
// 排序状态由所有玩家表共享，保证各表表头指示符一致。
const perRoundSort = ref({ key: '', direction: 'desc' });

function resolvePerRoundSortValue(row, key) {
  const rawValue = row?.sortValues?.[key];
  if (rawValue == null) {
    return null;
  }
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
}

function comparePerRoundRows(left, right, key, directionFactor) {
  const leftValue = resolvePerRoundSortValue(left, key);
  const rightValue = resolvePerRoundSortValue(right, key);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -directionFactor : directionFactor;
}

function sortPerRoundRows(rows) {
  const sortKey = String(perRoundSort.value.key || '');
  if (!sortKey) {
    return rows;
  }
  // 稳定排序：先按默认轮次序稳定分层，再按当前列比较。
  const directionFactor = perRoundSort.value.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => comparePerRoundRows(a.row, b.row, sortKey, directionFactor) || a.index - b.index)
    .map((entry) => entry.row);
}

function togglePerRoundSort(columnKey) {
  const key = String(columnKey || '');
  if (!key) {
    return;
  }
  if (perRoundSort.value.key === key) {
    if (perRoundSort.value.direction === 'desc') {
      perRoundSort.value.direction = 'asc';
      return;
    }
    // 再次点击同一列：恢复默认轮次序。
    perRoundSort.value = { key: '', direction: 'desc' };
    return;
  }
  perRoundSort.value = { key, direction: 'desc' };
}

function getPerRoundSortIndicator(columnKey) {
  if (perRoundSort.value.key !== columnKey) {
    return '<>';
  }
  return perRoundSort.value.direction === 'asc' ? '^' : 'v';
}

const visibleMultiRound = computed(() => {
  const multiRound = props.multiRound;
  if (!multiRound || typeof multiRound !== 'object') {
    return null;
  }
  const rounds = Number(multiRound.rounds);
  return Number.isFinite(rounds) && rounds >= 2 ? multiRound : null;
});

const failedCount = computed(() => {
  const value = Number(visibleMultiRound.value?.failedCount ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
});

// 含 i18next 插值的文案在 script 中生成：模板插值内不能出现双花括号字面量
// （Vue 编译器会在首个 }} 处提前结束插值，见既有踩坑记录）。
const failedCountText = computed(() =>
  t('common:vue.results.multiRound.failedCount', '{{count}} rounds failed (excluded from statistics)', {
    count: failedCount.value,
  }),
);

const playerSections = computed(() => {
  const players = Array.isArray(visibleMultiRound.value?.perPlayer) ? visibleMultiRound.value.perPlayer : [];
  const sections = [];
  for (const player of players) {
    if (!player || typeof player !== 'object') {
      continue;
    }
    const metrics = player.metrics && typeof player.metrics === 'object' ? player.metrics : {};
    sections.push({
      playerHrid: String(player.playerHrid || ''),
      playerLabel: String(player.playerName || player.playerHrid || '-'),
      metricRows: Object.entries(metrics).map(([metricKey, stat]) => buildMetricRow(metricKey, stat)),
    });
  }
  return sections;
});

const perRoundEntries = computed(() => {
  const multiRound = visibleMultiRound.value;
  const listed = Array.isArray(multiRound?.perRound) ? multiRound.perRound : [];
  const totalRounds = Math.max(0, Math.floor(Number(multiRound?.rounds) || 0));
  const entries = [];
  for (let index = 0; index < totalRounds; index += 1) {
    const entry = listed[index] && typeof listed[index] === 'object' ? listed[index] : {};
    const round = Number(entry.round);
    entries.push({
      round: Number.isFinite(round) ? round : index + 1,
      seed: entry.seed ?? '-',
      failed: entry.failed === true,
    });
  }
  return entries;
});

const perRoundTables = computed(() =>
  playerSections.value.map((section) => {
    // 每行的 sortValues 保存原始数值（指标列取该轮原始值，失败轮为 null）供列排序使用；
    // cells 是对应的格式化文本。
    const rows = perRoundEntries.value.map((entry) => {
      const sortValues = { round: entry.round, seed: entry.seed };
      const cells = section.metricRows.map((metricRow) => {
        const rawValue = resolveRoundRawValue(metricRow, entry.round);
        sortValues[metricRow.key] = rawValue;
        return formatRoundCellValue(metricRow, rawValue);
      });
      return { round: entry.round, seed: entry.seed, failed: entry.failed, cells, sortValues };
    });
    return {
      playerHrid: section.playerHrid,
      playerLabel: section.playerLabel,
      metrics: section.metricRows.map((metricRow) => ({ key: metricRow.key, label: metricRow.label })),
      rows: sortPerRoundRows(rows),
    };
  }),
);
</script>
