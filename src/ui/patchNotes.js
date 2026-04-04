import patchNote from "../../patchNote.json";

export const PATCH_NOTES_STORAGE_KEY = "mwi.ui.patchNotes.v1";
export const PATCH_NOTES_STORAGE_VERSION = 1;

function normalizePatchNoteText(value) {
    return String(value || "").trim();
}

function normalizeEntryId(value) {
    return normalizePatchNoteText(value);
}

function normalizePatchNoteLanguage(value) {
    return normalizePatchNoteText(value).toLowerCase() === "en" ? "en" : "zh";
}

function normalizeEntryIdList(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    const seen = new Set();
    const result = [];

    for (const value of values) {
        const normalized = normalizeEntryId(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function normalizeTimestamp(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getStorage(storage) {
    if (storage) {
        return storage;
    }
    if (typeof localStorage === "undefined") {
        return null;
    }
    return localStorage;
}

function createDefaultPatchNotesState() {
    return {
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: [],
        initializedAt: 0,
        updatedAt: 0,
    };
}

function normalizePatchNoteEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    return entries
        .map((entry) => ({
            entryId: normalizeEntryId(entry?.entryId),
            label: normalizePatchNoteText(entry?.label),
            notes: Array.isArray(entry?.notes)
                ? entry.notes.map((note) => normalizePatchNoteText(note)).filter(Boolean)
                : [],
        }))
        .filter((entry) => entry.entryId);
}

function resolveLocalizedPatchNoteText(value, language, fallbackValue = "") {
    if (typeof value === "string") {
        return normalizePatchNoteText(value);
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return normalizePatchNoteText(fallbackValue);
    }

    const normalizedLanguage = normalizePatchNoteLanguage(language);
    const localizedValue = normalizePatchNoteText(value[normalizedLanguage]);
    if (localizedValue) {
        return localizedValue;
    }

    const zhFallback = normalizePatchNoteText(value.zh);
    if (zhFallback) {
        return zhFallback;
    }

    for (const candidate of Object.values(value)) {
        const normalized = normalizePatchNoteText(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return normalizePatchNoteText(fallbackValue);
}

function normalizePatchNoteList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((note) => normalizePatchNoteText(note)).filter(Boolean);
}

function resolveLocalizedPatchNoteList(value, language) {
    if (Array.isArray(value)) {
        return normalizePatchNoteList(value);
    }

    if (!value || typeof value !== "object") {
        return [];
    }

    const normalizedLanguage = normalizePatchNoteLanguage(language);
    const localizedList = normalizePatchNoteList(value[normalizedLanguage]);
    if (localizedList.length > 0) {
        return localizedList;
    }

    const zhFallback = normalizePatchNoteList(value.zh);
    if (zhFallback.length > 0) {
        return zhFallback;
    }

    for (const candidate of Object.values(value)) {
        const normalizedList = normalizePatchNoteList(candidate);
        if (normalizedList.length > 0) {
            return normalizedList;
        }
    }

    return [];
}

function resolveEntries(entriesOrPatchNotes, language = "zh") {
    if (Array.isArray(entriesOrPatchNotes)) {
        return normalizePatchNoteEntries(entriesOrPatchNotes);
    }

    return resolvePatchNoteEntries(entriesOrPatchNotes, language);
}

function parseStoredPatchNotesState(storage) {
    const resolvedStorage = getStorage(storage);
    if (!resolvedStorage || typeof resolvedStorage.getItem !== "function") {
        return {
            isValid: false,
            state: createDefaultPatchNotesState(),
        };
    }

    try {
        const rawValue = resolvedStorage.getItem(PATCH_NOTES_STORAGE_KEY);
        if (!rawValue) {
            return {
                isValid: false,
                state: createDefaultPatchNotesState(),
            };
        }

        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== "object" || Number(parsed.version) !== PATCH_NOTES_STORAGE_VERSION) {
            return {
                isValid: false,
                state: createDefaultPatchNotesState(),
            };
        }

        return {
            isValid: true,
            state: {
                version: PATCH_NOTES_STORAGE_VERSION,
                readEntryIds: normalizeEntryIdList(parsed.readEntryIds),
                initializedAt: normalizeTimestamp(parsed.initializedAt),
                updatedAt: normalizeTimestamp(parsed.updatedAt),
            },
        };
    } catch (error) {
        return {
            isValid: false,
            state: createDefaultPatchNotesState(),
        };
    }
}

function persistPatchNotesState(storage, state) {
    const resolvedStorage = getStorage(storage);
    if (!resolvedStorage || typeof resolvedStorage.setItem !== "function") {
        return false;
    }

    try {
        resolvedStorage.setItem(PATCH_NOTES_STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch (error) {
        return false;
    }
}

export function resolvePatchNoteEntries(patchNotes = patchNote, language = "zh") {
    if (!patchNotes || typeof patchNotes !== "object" || Array.isArray(patchNotes)) {
        return [];
    }

    const normalizedLanguage = normalizePatchNoteLanguage(language);
    return Object.entries(patchNotes).map(([entryId, patchNoteValue]) => {
        const isLegacyEntry = Array.isArray(patchNoteValue);
        const rawLabel = isLegacyEntry ? entryId : patchNoteValue?.label;
        const rawNotes = isLegacyEntry ? patchNoteValue : patchNoteValue?.notes;

        return {
            entryId: normalizeEntryId(entryId),
            label: resolveLocalizedPatchNoteText(rawLabel, normalizedLanguage, entryId),
            notes: resolveLocalizedPatchNoteList(rawNotes, normalizedLanguage),
        };
    });
}

export const patchNoteEntries = Object.freeze(resolvePatchNoteEntries(patchNote, "zh"));

export function readPatchNotesState(storage) {
    return parseStoredPatchNotesState(storage).state;
}

export function initializePatchNotesState({
    entries = patchNoteEntries,
    storage,
    initializedAt = Date.now(),
} = {}) {
    const resolvedEntries = resolveEntries(entries);
    const { isValid, state } = parseStoredPatchNotesState(storage);

    if (isValid) {
        return state;
    }

    const timestamp = normalizeTimestamp(initializedAt);
    const nextState = {
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: normalizeEntryIdList(resolvedEntries.map((entry) => entry.entryId)),
        initializedAt: timestamp,
        updatedAt: timestamp,
    };

    persistPatchNotesState(storage, nextState);
    return nextState;
}

export function getUnreadPatchNoteEntries({
    entries = patchNoteEntries,
    storage,
} = {}) {
    const resolvedEntries = resolveEntries(entries);
    if (resolvedEntries.length === 0) {
        return [];
    }

    const state = initializePatchNotesState({
        entries: resolvedEntries,
        storage,
    });
    const readEntryIds = new Set(state.readEntryIds);
    return resolvedEntries.filter((entry) => !readEntryIds.has(entry.entryId));
}

export function markPatchNoteEntriesAsRead({
    entryIds = [],
    storage,
    updatedAt = Date.now(),
} = {}) {
    const resolvedStorage = getStorage(storage);
    const normalizedEntryIds = normalizeEntryIdList(entryIds);
    if (!resolvedStorage || typeof resolvedStorage.setItem !== "function" || normalizedEntryIds.length === 0) {
        return false;
    }

    const currentState = readPatchNotesState(resolvedStorage);
    const nextState = {
        version: PATCH_NOTES_STORAGE_VERSION,
        readEntryIds: normalizeEntryIdList([
            ...currentState.readEntryIds,
            ...normalizedEntryIds,
        ]),
        initializedAt: currentState.initializedAt,
        updatedAt: normalizeTimestamp(updatedAt),
    };

    return persistPatchNotesState(resolvedStorage, nextState);
}
