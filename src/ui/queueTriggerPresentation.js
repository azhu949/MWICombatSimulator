import combatTriggerComparatorDetailMap from "../combatsimulator/data/combatTriggerComparatorDetailMap.json";
import combatTriggerConditionDetailMap from "../combatsimulator/data/combatTriggerConditionDetailMap.json";
import combatTriggerDependencyDetailMap from "../combatsimulator/data/combatTriggerDependencyDetailMap.json";

export const TRIGGER_CHANGE_LABEL_PREFIX = "trigger:";
const DEFAULT_TRIGGER_RULE_LIMIT = 2;

function fallbackTranslate(_key, fallback) {
    return String(fallback || "");
}

function normalizeTranslate(translate) {
    return typeof translate === "function" ? translate : fallbackTranslate;
}

function normalizeTriggerTargetHrid(value) {
    return String(value || "").trim();
}

export function buildTriggerChangeLabel(targetHrid) {
    const hrid = normalizeTriggerTargetHrid(targetHrid);
    return hrid ? `${TRIGGER_CHANGE_LABEL_PREFIX}${hrid}` : TRIGGER_CHANGE_LABEL_PREFIX;
}

export function parseTriggerTargetHrid(value) {
    const label = String(value || "");
    if (!label.startsWith(TRIGGER_CHANGE_LABEL_PREFIX)) {
        return "";
    }
    return normalizeTriggerTargetHrid(label.slice(TRIGGER_CHANGE_LABEL_PREFIX.length));
}

export function formatQueueTriggerStateText(state, translate) {
    const t = normalizeTranslate(translate);
    const normalizedState = String(state || "default").trim().toLowerCase();
    if (normalizedState === "custom") {
        return t("common:queue.triggerState.custom", "Custom");
    }
    if (normalizedState === "disabled") {
        return t("common:queue.triggerState.disabled", "Disabled");
    }
    return t("common:queue.triggerState.default", "Default");
}

function localizeTriggerMetadata(namespaceKey, hrid, detailMap, translate) {
    const t = normalizeTranslate(translate);
    const normalizedHrid = String(hrid || "").trim();
    if (!normalizedHrid) {
        return "";
    }
    return t(`${namespaceKey}.${normalizedHrid}`, detailMap?.[normalizedHrid]?.name || normalizedHrid);
}

function formatTriggerRuleValue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return "";
    }
    return Number.isInteger(numericValue) ? String(numericValue) : String(numericValue);
}

export function formatQueueTriggerRuleText(triggerRule, translate) {
    const dependencyText = localizeTriggerMetadata(
        "combatTriggerDependencyNames",
        triggerRule?.dependencyHrid,
        combatTriggerDependencyDetailMap,
        translate
    );
    const conditionText = localizeTriggerMetadata(
        "combatTriggerConditionNames",
        triggerRule?.conditionHrid,
        combatTriggerConditionDetailMap,
        translate
    );
    const comparatorHrid = String(triggerRule?.comparatorHrid || "").trim();
    const comparatorText = localizeTriggerMetadata(
        "combatTriggerComparatorNames",
        comparatorHrid,
        combatTriggerComparatorDetailMap,
        translate
    );
    if (!dependencyText || !conditionText || !comparatorText) {
        return "";
    }

    const allowValue = Boolean(combatTriggerComparatorDetailMap?.[comparatorHrid]?.allowValue);
    const valueText = allowValue ? formatTriggerRuleValue(triggerRule?.value) : "";
    return valueText
        ? `${dependencyText} ${conditionText} ${comparatorText} ${valueText}`
        : `${dependencyText} ${conditionText} ${comparatorText}`;
}

function formatQueueTriggerRuleSummary(triggers, translate, maxRules = DEFAULT_TRIGGER_RULE_LIMIT) {
    const lines = (Array.isArray(triggers) ? triggers : [])
        .map((triggerRule) => formatQueueTriggerRuleText(triggerRule, translate))
        .filter(Boolean);
    if (lines.length <= 0) {
        return "";
    }

    const safeLimit = Math.max(1, Math.floor(Number(maxRules || DEFAULT_TRIGGER_RULE_LIMIT)));
    const visible = lines.slice(0, safeLimit).join(" / ");
    const hiddenCount = Math.max(0, lines.length - safeLimit);
    return hiddenCount > 0 ? `${visible} +${hiddenCount}` : visible;
}

function formatQueueTriggerStateWithSummary(state, triggers, translate) {
    const stateText = formatQueueTriggerStateText(state, translate);
    const normalizedState = String(state || "default").trim().toLowerCase();
    if (normalizedState === "disabled") {
        return stateText;
    }

    const summaryText = formatQueueTriggerRuleSummary(triggers, translate);
    return summaryText ? `${stateText} (${summaryText})` : stateText;
}

export function formatQueueTriggerLabel(targetHrid, resolveTargetName, translate) {
    const t = normalizeTranslate(translate);
    const hrid = normalizeTriggerTargetHrid(targetHrid);
    if (!hrid) {
        return t("common:queue.triggerLabel", "Trigger");
    }

    const resolvedName = typeof resolveTargetName === "function"
        ? String(resolveTargetName(hrid) || "").trim()
        : "";
    if (!resolvedName) {
        return t("common:queue.triggerLabel", "Trigger");
    }

    return `${t("common:queue.triggerLabel", "Trigger")} ${resolvedName}`;
}

export function formatQueueTriggerDetailLine(change, options = {}) {
    const targetHrid = normalizeTriggerTargetHrid(
        change?.targetHrid
        || parseTriggerTargetHrid(change?.label)
    );
    const beforeState = change?.beforeState ?? change?.before?.state ?? "default";
    const afterState = change?.afterState ?? change?.after?.state ?? "default";
    const beforeTriggers = change?.beforeTriggers ?? change?.before?.triggers ?? [];
    const afterTriggers = change?.afterTriggers ?? change?.after?.triggers ?? [];
    const label = formatQueueTriggerLabel(targetHrid, options.resolveTargetName, options.t);
    const normalizedBeforeState = String(beforeState || "default").trim().toLowerCase();
    const normalizedAfterState = String(afterState || "default").trim().toLowerCase();
    if (normalizedBeforeState === "custom" && normalizedAfterState === "custom") {
        const beforeSummary = formatQueueTriggerRuleSummary(beforeTriggers, options.t);
        const afterSummary = formatQueueTriggerRuleSummary(afterTriggers, options.t);
        if (beforeSummary && afterSummary) {
            return `${label}: ${beforeSummary} -> ${afterSummary}`;
        }
    }
    const beforeText = formatQueueTriggerStateWithSummary(beforeState, beforeTriggers, options.t);
    const afterText = formatQueueTriggerStateWithSummary(afterState, afterTriggers, options.t);
    return `${label}: ${beforeText} -> ${afterText}`;
}
