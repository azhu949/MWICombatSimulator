<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <div class="panel">
      <h3 class="mb-3 font-heading text-sm uppercase tracking-[0.14em] text-slate-300">{{ t("common:vue.results.hpOverTime", "HP Over Time") }}</h3>
      <div class="relative h-64 w-full overflow-hidden">
        <canvas ref="hpCanvas" class="block h-full w-full"></canvas>
      </div>
    </div>
    <div class="panel">
      <h3 class="mb-3 font-heading text-sm uppercase tracking-[0.14em] text-slate-300">{{ t("common:vue.results.mpOverTime", "MP Over Time") }}</h3>
      <div class="relative h-64 w-full overflow-hidden">
        <canvas ref="mpCanvas" class="block h-full w-full"></canvas>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Title } from "chart.js";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nText } from "../composables/useI18nText.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend, Title);

const props = defineProps({
  timeSeriesData: {
    type: Object,
    default: null,
  },
});

const hpCanvas = ref(null);
const mpCanvas = ref(null);
let hpChart = null;
let mpChart = null;
const { t } = useI18nText();
const MAX_TIME_SERIES_POINTS = 1200;

const palette = [
  "#14b8a6",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
];

function buildDatasets(playerMap, key) {
  const players = Object.keys(playerMap || {});
  return players.map((playerHrid, index) => {
    const color = palette[index % palette.length];
    const keyLabel = key === "hp"
      ? t("common:vue.results.hpShort", "HP")
      : t("common:vue.results.mpShort", "MP");
    return {
      label: `${playerHrid} ${keyLabel}`,
      data: playerMap[playerHrid]?.[key] || [],
      borderColor: color,
      backgroundColor: `${color}55`,
      borderWidth: 1.8,
      pointRadius: 0,
      pointHoverRadius: 2,
      tension: 0.2,
      spanGaps: true,
    };
  });
}

function buildSamplingIndices(length, maxPoints) {
  const count = Math.max(0, Math.floor(Number(length || 0)));
  const limit = Math.max(2, Math.floor(Number(maxPoints || 2)));
  if (count <= 0) {
    return [];
  }
  if (count <= limit) {
    return Array.from({ length: count }, (_, idx) => idx);
  }

  const last = count - 1;
  const step = last / (limit - 1);
  const indices = [];
  let previous = -1;
  for (let idx = 0; idx < limit; idx += 1) {
    let candidate = Math.round(idx * step);
    if (candidate <= previous) {
      candidate = previous + 1;
    }
    if (candidate > last) {
      candidate = last;
    }
    indices.push(candidate);
    previous = candidate;
  }
  return indices;
}

function sampleByIndices(values, indices) {
  const source = Array.isArray(values) ? values : [];
  return indices.map((idx) => {
    if (idx < 0 || idx >= source.length) {
      return null;
    }

    const value = source[idx];
    return Number.isFinite(Number(value)) ? Number(value) : null;
  });
}

function normalizeTimeSeriesData(rawData) {
  const timestamps = Array.isArray(rawData?.timestamps) ? rawData.timestamps : [];
  const players = rawData?.players && typeof rawData.players === "object" ? rawData.players : {};
  const indices = buildSamplingIndices(timestamps.length, MAX_TIME_SERIES_POINTS);
  const sampledTimestamps = indices.map((idx) => Number(timestamps[idx] || 0));
  const sampledPlayers = {};

  for (const [playerHrid, series] of Object.entries(players)) {
    sampledPlayers[playerHrid] = {
      hp: sampleByIndices(series?.hp, indices),
      mp: sampleByIndices(series?.mp, indices),
    };
  }

  return {
    timestamps: sampledTimestamps,
    players: sampledPlayers,
  };
}

function createBaseOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    plugins: {
      legend: {
        labels: {
          color: "#e2e8f0",
          boxWidth: 14,
        },
      },
      title: {
        display: false,
      },
    },
    scales: {
      x: {
        ticks: { color: "#94a3b8", maxTicksLimit: 8 },
        grid: { color: "rgba(148,163,184,0.12)" },
      },
      y: {
        title: { display: true, text: yLabel, color: "#94a3b8" },
        ticks: { color: "#94a3b8" },
        grid: { color: "rgba(148,163,184,0.12)" },
      },
    },
    interaction: {
      intersect: false,
      mode: "index",
    },
  };
}

function destroyCharts() {
  if (hpChart) {
    hpChart.destroy();
    hpChart = null;
  }
  if (mpChart) {
    mpChart.destroy();
    mpChart = null;
  }
}

async function renderCharts(timeSeriesData) {
  await nextTick();

  if (!hpCanvas.value || !mpCanvas.value) {
    return;
  }

  destroyCharts();

  const normalized = normalizeTimeSeriesData(timeSeriesData);
  const labels = (normalized.timestamps || []).map((value) => (Number(value) / 1e9).toFixed(1));
  const players = normalized.players || {};

  hpChart = new Chart(hpCanvas.value, {
    type: "line",
    data: {
      labels,
      datasets: buildDatasets(players, "hp"),
    },
    options: createBaseOptions("HP"),
  });

  mpChart = new Chart(mpCanvas.value, {
    type: "line",
    data: {
      labels,
      datasets: buildDatasets(players, "mp"),
    },
    options: createBaseOptions("MP"),
  });
}

watch(
  () => props.timeSeriesData,
  (nextValue) => {
    if (!nextValue || !nextValue.timestamps?.length) {
      destroyCharts();
      return;
    }
    renderCharts(nextValue);
  },
  { deep: true }
);

onMounted(() => {
  if (props.timeSeriesData?.timestamps?.length) {
    renderCharts(props.timeSeriesData);
  }
});

onBeforeUnmount(() => {
  destroyCharts();
});
</script>
