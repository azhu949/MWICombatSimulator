export function formatInt(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.floor(numeric).toLocaleString() : '-';
}

export function formatNumber(value, digits = 2) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';
}

export function formatCurrency(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

export function formatUpgradeCost(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }

  const absoluteValue = Math.abs(numeric);
  if (absoluteValue >= 1e9) {
    return `${formatNumber(numeric / 1e9, 2)}b`;
  }
  if (absoluteValue >= 1e6) {
    return `${formatNumber(numeric / 1e6, 2)}m`;
  }
  if (absoluteValue >= 1e3) {
    return `${formatNumber(numeric / 1e3, 1)}k`;
  }
  return formatNumber(numeric, 0);
}

export function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(digits)}%` : '-';
}

export function formatDurationSeconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${formatNumber(numeric, 2)}s` : '-';
}

export function formatFlexibleNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return Number.isInteger(numeric) ? formatInt(numeric) : formatNumber(numeric, digits);
}

export function formatSignedFlexibleNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${formatFlexibleNumber(Math.abs(numeric), digits)}`;
}

export function formatSignedPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${(Math.abs(numeric) * 100).toFixed(digits)}%`;
}
