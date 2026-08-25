// 用于组装战斗属性拆解文本的纯函数。
//
// 从 HomePage.vue 中抽出，使差异/来源/对账拼接逻辑可以
// 直接进行单元测试，而不必依赖脆弱的模板源码字符串匹配。
// 格式化函数（formatDelta、formatValue、formatHighlightLabel）
// 与翻译函数（t）均以注入方式传入，使本模块
// 不依赖 Vue/i18n 副作用，也避免引入循环依赖。

export const COMBAT_PREVIEW_RECONCILIATION_EPSILON = 1e-9;

/**
 * 为单个战斗属性行构建拆解部分数组与拼接后的文本。
 *
 * @param {object} breakdown - 来自 combatPreviewData 的属性拆解条目。
 * @param {string} entryKey - 属性 key（用于生成各部分 key）。
 * @param {object} deps - 注入的格式化/翻译依赖。
 * @param {(stat: object) => string} deps.formatDelta
 * @param {(value: number, format: string) => string} deps.formatValue
 * @param {(source: object) => string} deps.formatHighlightLabel
 * @param {(key: string, fallback: string, options?: object) => string} deps.t
 * @returns {{ hasSources: boolean, value: string, breakdownParts: Array, breakdownText: string }}
 */
export function buildCombatStatBreakdownParts(breakdown, entryKey, deps) {
  const baseLabel = deps.t('common:vue.home.combatStatBaseValue', 'Base');
  const reconciliationLabel = deps.t('common:vue.home.combatStatReconciliation', 'Adjustment');
  const sourceFormat = deps.t('common:vue.home.combatStatSourceFormat', '{{delta}} ({{source}})');

  const reconciliationDelta = Number(breakdown.reconciliationDelta);
  const hasReconciliationDelta =
    Number.isFinite(reconciliationDelta) && Math.abs(reconciliationDelta) > COMBAT_PREVIEW_RECONCILIATION_EPSILON;

  const breakdownParts = [
    {
      key: `base-${entryKey}`,
      kind: 'base',
      text: `${baseLabel} ${deps.formatValue(breakdown.baseValue, breakdown.format)}`,
    },
  ];

  breakdown.sources.forEach((source) => {
    const deltaText = deps.formatDelta({ ...source, format: breakdown.format });
    const sourceText = deps.formatHighlightLabel(source);
    breakdownParts.push({
      key: `${source.sourceKey}-${entryKey}`,
      kind: 'source',
      text: sourceFormat.replace('{{delta}}', deltaText).replace('{{source}}', sourceText),
    });
  });

  if (hasReconciliationDelta) {
    const deltaText = deps.formatDelta({ ...breakdown, deltaValue: reconciliationDelta });
    breakdownParts.push({
      key: `reconciliation-${entryKey}`,
      kind: 'reconciliation',
      text: sourceFormat.replace('{{delta}}', deltaText).replace('{{source}}', reconciliationLabel),
    });
  }

  return {
    hasSources: breakdown.sources.length > 0 || hasReconciliationDelta,
    value: deps.formatValue(breakdown.finalValue, breakdown.format),
    breakdownParts,
    breakdownText: breakdownParts.map((part) => part.text).join(' '),
  };
}
