function fallbackTranslate(_key, fallback) {
  return String(fallback || '');
}

function normalizeTranslate(translate) {
  return typeof translate === 'function' ? translate : fallbackTranslate;
}

// 推荐扫描运行阶段文案：quick_scan / refine_top 附带完成计数，其余为固定文案。
// 供 AdvisorPage 页头状态 chips（runtimePhaseText）与顶栏 CombatCommandBar
// 进度摘要行（App.vue advisorPhaseText）共用，保持两处文案口径一致。
export function buildAdvisorRuntimePhaseText(runtime, translate) {
  const t = normalizeTranslate(translate);
  const phase = String(runtime?.phase || 'idle');
  if (phase === 'quick_scan') {
    return (
      t('common:advisor.phaseQuick', 'Quick scan in progress') +
      ` · ${runtime?.quickCompleted || 0}/${runtime?.quickTotal || 0}`
    );
  }
  if (phase === 'refine_top') {
    return (
      t('common:advisor.phaseRefine', 'Refining top picks') +
      ` · ${runtime?.refineCompleted || 0}/${runtime?.refineTotal || 0}`
    );
  }
  if (phase === 'done') {
    return t('common:advisor.phaseDone', 'Scan complete');
  }
  if (phase === 'cancelled') {
    return t('common:advisor.phaseCancelled', 'Scan stopped');
  }
  return t('common:advisor.idle', 'Idle');
}

// 推荐扫描进度百分比（0-100 整数）：顶栏 CombatCommandBar 进度摘要行
// （App.vue advisorProgressText）使用；progress 缺失或 NaN 时兜底为 0。
export function buildAdvisorProgressPercent(runtime) {
  return Math.round(Number(runtime?.progress || 0) * 100);
}
