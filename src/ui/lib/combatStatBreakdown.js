// Pure helpers for assembling combat stat breakdown text.
//
// Extracted from HomePage.vue so the delta/source/reconciliation joining
// logic can be unit-tested directly instead of via fragile template source
// string matching. The formatting functions (formatDelta, formatValue,
// formatHighlightLabel) and the translation function (t) are injected so the
// module stays free of Vue/i18n side-effects and import cycles.

export const COMBAT_PREVIEW_RECONCILIATION_EPSILON = 1e-9;

/**
 * Build the breakdown parts array and joined text for a single combat stat row.
 *
 * @param {object} breakdown - The stat breakdown entry from combatPreviewData.
 * @param {string} entryKey - The stat key (used for part keys).
 * @param {object} deps - Injected formatting/translation dependencies.
 * @param {(stat: object) => string} deps.formatDelta
 * @param {(value: number, format: string) => string} deps.formatValue
 * @param {(source: object) => string} deps.formatHighlightLabel
 * @param {(key: string, fallback: string, options?: object) => string} deps.t
 * @returns {{ hasSources: boolean, value: string, breakdownParts: Array, breakdownText: string }}
 */
export function buildCombatStatBreakdownParts(breakdown, entryKey, deps) {
    const baseLabel = deps.t("common:vue.home.combatStatBaseValue", "Base");
    const reconciliationLabel = deps.t("common:vue.home.combatStatReconciliation", "Adjustment");
    const sourceFormat = deps.t("common:vue.home.combatStatSourceFormat", "{{delta}} ({{source}})");

    const reconciliationDelta = Number(breakdown.reconciliationDelta);
    const hasReconciliationDelta = Number.isFinite(reconciliationDelta)
        && Math.abs(reconciliationDelta) > COMBAT_PREVIEW_RECONCILIATION_EPSILON;

    const breakdownParts = [{
        key: `base-${entryKey}`,
        kind: "base",
        text: `${baseLabel} ${deps.formatValue(breakdown.baseValue, breakdown.format)}`,
    }];

    breakdown.sources.forEach((source) => {
        const deltaText = deps.formatDelta({ ...source, format: breakdown.format });
        const sourceText = deps.formatHighlightLabel(source);
        breakdownParts.push({
            key: `${source.sourceKey}-${entryKey}`,
            kind: "source",
            text: sourceFormat
                .replace("{{delta}}", deltaText)
                .replace("{{source}}", sourceText),
        });
    });

    if (hasReconciliationDelta) {
        const deltaText = deps.formatDelta({ ...breakdown, deltaValue: reconciliationDelta });
        breakdownParts.push({
            key: `reconciliation-${entryKey}`,
            kind: "reconciliation",
            text: sourceFormat
                .replace("{{delta}}", deltaText)
                .replace("{{source}}", reconciliationLabel),
        });
    }

    return {
        hasSources: breakdown.sources.length > 0 || hasReconciliationDelta,
        value: deps.formatValue(breakdown.finalValue, breakdown.format),
        breakdownParts,
        breakdownText: breakdownParts.map((part) => part.text).join(" "),
    };
}
