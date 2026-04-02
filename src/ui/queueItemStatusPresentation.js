import { formatQueueTriggerLabel } from "./queueTriggerPresentation.js";

const CHANGE_KIND_PRIORITY = {
    equipment: 0,
    house_room: 1,
    food: 2,
    drink: 3,
    ability: 4,
    trigger: 5,
    level: 6,
};

function fallbackTranslate(key, fallback, params = {}) {
    const template = String(fallback ?? key ?? "");
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token) => {
        if (!Object.prototype.hasOwnProperty.call(params, token)) {
            return "";
        }
        return String(params[token] ?? "");
    });
}

function normalizeTranslate(translate) {
    return typeof translate === "function" ? translate : fallbackTranslate;
}

function normalizeResolver(resolver, fallbackValue = "-") {
    return typeof resolver === "function"
        ? resolver
        : (value) => String(value || fallbackValue);
}

function toEnhancementText(level) {
    return Math.max(0, Math.floor(Number(level || 0)));
}

function toAbilityLevelText(level) {
    return Math.max(1, Math.floor(Number(level || 1)));
}

function formatChangeValue(change, side, options) {
    const kind = String(change?.kind || "");
    const resolveItemName = normalizeResolver(options.resolveItemName);
    const resolveAbilityName = normalizeResolver(options.resolveAbilityName);
    const resolveHouseRoomName = normalizeResolver(options.resolveHouseRoomName, "");
    if (kind === "equipment") {
        const itemHrid = String(side === "before" ? change?.beforeItemHrid || "" : change?.afterItemHrid || "");
        if (!itemHrid) {
            return "-";
        }
        const enhancementLevel = side === "before"
            ? toEnhancementText(change?.beforeEnhancementLevel)
            : toEnhancementText(change?.afterEnhancementLevel);
        return `${resolveItemName(itemHrid)}(+${enhancementLevel})`;
    }

    if (kind === "food" || kind === "drink") {
        const itemHrid = String(side === "before" ? change?.beforeItemHrid || "" : change?.afterItemHrid || "");
        return itemHrid ? resolveItemName(itemHrid) : "-";
    }

    if (kind === "ability") {
        const abilityHrid = String(side === "before" ? change?.beforeAbilityHrid || "" : change?.afterAbilityHrid || "");
        if (!abilityHrid) {
            return "-";
        }
        const level = side === "before"
            ? toAbilityLevelText(change?.beforeLevel)
            : toAbilityLevelText(change?.afterLevel);
        return `${resolveAbilityName(abilityHrid)}(Lv.${level})`;
    }

    if (kind === "house_room") {
        const roomHrid = String(change?.roomHrid || "");
        const level = side === "before"
            ? Math.max(0, Math.floor(Number(change?.beforeLevel || 0)))
            : Math.max(0, Math.floor(Number(change?.afterLevel || 0)));
        const roomName = roomHrid ? resolveHouseRoomName(roomHrid) : "";
        return roomName ? `${roomName} Lv.${level}` : `${level}`;
    }

    if (kind === "level") {
        const level = side === "before"
            ? toAbilityLevelText(change?.beforeLevel)
            : toAbilityLevelText(change?.afterLevel);
        return `${level}`;
    }

    return "-";
}

function deriveSingleQueueItemStatusName(change, options = {}) {
    const t = normalizeTranslate(options.t);
    const resolveItemName = normalizeResolver(options.resolveItemName);
    const resolveAbilityName = normalizeResolver(options.resolveAbilityName);
    const resolveTriggerTargetName = normalizeResolver(options.resolveTriggerTargetName);
    const resolveSkillName = normalizeResolver(options.resolveSkillName, "");

    if (!change || typeof change !== "object") {
        return "";
    }

    if (change.kind === "level") {
        const localized = resolveSkillName(String(change?.key || ""));
        return localized || "";
    }

    if (change.kind === "ability") {
        const beforeHrid = String(change?.beforeAbilityHrid || "");
        const afterHrid = String(change?.afterAbilityHrid || "");
        const beforeLevel = toAbilityLevelText(change?.beforeLevel);
        const afterLevel = toAbilityLevelText(change?.afterLevel);
        if (beforeHrid && afterHrid && beforeHrid === afterHrid) {
            return t("common:queue.skillLevelChange", "{{name}}: Level {{from}} -> {{to}}", {
                name: resolveAbilityName(afterHrid),
                from: beforeLevel,
                to: afterLevel,
            });
        }
    }

    if (change.kind === "equipment") {
        const beforeItemHrid = String(change?.beforeItemHrid || "");
        const afterItemHrid = String(change?.afterItemHrid || "");
        const beforeLevel = toEnhancementText(change?.beforeEnhancementLevel);
        const afterLevel = toEnhancementText(change?.afterEnhancementLevel);
        if (beforeItemHrid && afterItemHrid && beforeItemHrid === afterItemHrid) {
            return t("common:queue.itemEnhancementChange", "{{name}}: Enhance {{from}} -> {{to}}", {
                name: resolveItemName(afterItemHrid),
                from: beforeLevel,
                to: afterLevel,
            });
        }
        if (beforeItemHrid && afterItemHrid) {
            return `${resolveItemName(beforeItemHrid)} -> ${resolveItemName(afterItemHrid)}(+${afterLevel})`;
        }
        if (afterItemHrid) {
            return `${resolveItemName(afterItemHrid)}(+${afterLevel})`;
        }
        if (beforeItemHrid) {
            return `${resolveItemName(beforeItemHrid)}(+${beforeLevel})`;
        }
    }

    if (change.kind === "trigger") {
        return formatQueueTriggerLabel(change?.targetHrid, resolveTriggerTargetName, t);
    }

    const afterText = formatChangeValue(change, "after", options);
    if (afterText && afterText !== "-") {
        return afterText;
    }
    const beforeText = formatChangeValue(change, "before", options);
    if (beforeText && beforeText !== "-") {
        return beforeText;
    }
    return "";
}

export function deriveQueueItemStatusName(changeDetails, options = {}) {
    const t = normalizeTranslate(options.t);
    const fallbackText = String(options.fallbackText || "");
    const changes = Array.isArray(changeDetails) ? changeDetails : [];
    if (changes.length === 0) {
        return fallbackText;
    }

    const sorted = [...changes].sort((left, right) => {
        const leftPriority = CHANGE_KIND_PRIORITY[String(left?.kind || "")] ?? 99;
        const rightPriority = CHANGE_KIND_PRIORITY[String(right?.kind || "")] ?? 99;
        return leftPriority - rightPriority;
    });
    const candidates = sorted
        .map((change) => deriveSingleQueueItemStatusName(change, options))
        .filter((value) => String(value || "").trim().length > 0);
    const uniqueCandidates = Array.from(new Set(candidates));
    if (uniqueCandidates.length === 0) {
        return fallbackText;
    }
    if (uniqueCandidates.length === 1) {
        return uniqueCandidates[0];
    }
    return t("common:queue.itemNameWithMore", "{{name}} +{{count}}", {
        name: uniqueCandidates[0],
        count: uniqueCandidates.length - 1,
    });
}
