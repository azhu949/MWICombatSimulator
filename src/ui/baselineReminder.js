export const BASELINE_REMINDER_STORAGE_KEY = "mwi.ui.baselineReminder.v1";
export const BASELINE_REMINDER_STORAGE_VERSION = 1;

function getStorage(storage) {
    if (storage) {
        return storage;
    }
    if (typeof localStorage === "undefined") {
        return null;
    }
    return localStorage;
}

function normalizeDismissed(value) {
    return value === true;
}

function normalizeTimestamp(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function createDefaultBaselineReminderState() {
    return {
        version: BASELINE_REMINDER_STORAGE_VERSION,
        dismissed: false,
        updatedAt: 0,
    };
}

export function readBaselineReminderState(options = {}) {
    const resolvedStorage = getStorage(options.storage);
    if (!resolvedStorage || typeof resolvedStorage.getItem !== "function") {
        return createDefaultBaselineReminderState();
    }

    try {
        const rawValue = resolvedStorage.getItem(BASELINE_REMINDER_STORAGE_KEY);
        if (!rawValue) {
            return createDefaultBaselineReminderState();
        }

        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== "object" || Number(parsed.version) !== BASELINE_REMINDER_STORAGE_VERSION) {
            return createDefaultBaselineReminderState();
        }

        return {
            version: BASELINE_REMINDER_STORAGE_VERSION,
            dismissed: normalizeDismissed(parsed.dismissed),
            updatedAt: normalizeTimestamp(parsed.updatedAt),
        };
    } catch (error) {
        return createDefaultBaselineReminderState();
    }
}

export function isBaselineReminderDismissed(options = {}) {
    return readBaselineReminderState(options).dismissed;
}

export function dismissBaselineReminder(options = {}) {
    const resolvedStorage = getStorage(options.storage);
    if (!resolvedStorage || typeof resolvedStorage.setItem !== "function") {
        return false;
    }

    try {
        resolvedStorage.setItem(BASELINE_REMINDER_STORAGE_KEY, JSON.stringify({
            version: BASELINE_REMINDER_STORAGE_VERSION,
            dismissed: true,
            updatedAt: Date.now(),
        }));
        return true;
    } catch (error) {
        return false;
    }
}
