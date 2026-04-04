import { afterEach, describe, expect, it, vi } from "vitest";
import {
    PATCH_NOTES_STORAGE_KEY,
    PATCH_NOTES_STORAGE_VERSION,
    getUnreadPatchNoteEntries,
    initializePatchNotesState,
    markPatchNoteEntriesAsRead,
    readPatchNotesState,
    resolvePatchNoteEntries,
} from "../patchNotes.js";

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => {
            store.set(key, String(value));
        }),
        removeItem: vi.fn((key) => {
            store.delete(key);
        }),
        clear: vi.fn(() => {
            store.clear();
        }),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("patchNotes", () => {
    it("resolves mixed legacy and bilingual patch note entries in source order", () => {
        const patchNotes = {
            "2026年3月26日（v1.0.8）": {
                label: {
                    zh: " 2026年3月26日（v1.0.8） ",
                    en: " March 26, 2026 (v1.0.8) ",
                },
                notes: {
                    zh: ["  第一条  ", "", "   ", "第二条"],
                    en: [" First note ", "", "   ", "Second note"],
                },
            },
            "2026年3月25日（v1.0.7）": [" 第三条 "],
            "2026年3月24日（v1.0.6）": {
                label: {
                    zh: " 2026年3月24日（v1.0.6） ",
                },
                notes: {
                    zh: [" 第四条 "],
                },
            },
            "2026年3月23日": "invalid",
        };

        expect(resolvePatchNoteEntries(patchNotes, "zh")).toEqual([
            {
                entryId: "2026年3月26日（v1.0.8）",
                label: "2026年3月26日（v1.0.8）",
                notes: ["第一条", "第二条"],
            },
            {
                entryId: "2026年3月25日（v1.0.7）",
                label: "2026年3月25日（v1.0.7）",
                notes: ["第三条"],
            },
            {
                entryId: "2026年3月24日（v1.0.6）",
                label: "2026年3月24日（v1.0.6）",
                notes: ["第四条"],
            },
            {
                entryId: "2026年3月23日",
                label: "2026年3月23日",
                notes: [],
            },
        ]);
    });

    it("uses english content when available and falls back to zh labels and notes otherwise", () => {
        const patchNotes = {
            "2026年3月26日（v1.0.8）": {
                label: {
                    zh: "2026年3月26日（v1.0.8）",
                    en: "March 26, 2026 (v1.0.8)",
                },
                notes: {
                    zh: ["第一条", "第二条"],
                    en: ["First note", "Second note"],
                },
            },
            "2026年3月25日（v1.0.7）": {
                label: {
                    zh: "2026年3月25日（v1.0.7）",
                },
                notes: {
                    zh: ["第三条"],
                },
            },
        };

        expect(resolvePatchNoteEntries(patchNotes, "en")).toEqual([
            {
                entryId: "2026年3月26日（v1.0.8）",
                label: "March 26, 2026 (v1.0.8)",
                notes: ["First note", "Second note"],
            },
            {
                entryId: "2026年3月25日（v1.0.7）",
                label: "2026年3月25日（v1.0.7）",
                notes: ["第三条"],
            },
        ]);
    });

    it("initializes storage with all current entries marked as read on first launch", () => {
        const storage = createLocalStorageMock();
        vi.spyOn(Date, "now").mockReturnValue(111);
        const entries = resolvePatchNoteEntries({
            "2026年3月25日（v1.0.7）": ["第一条"],
            "2026年3月24日": ["第二条"],
        });

        const state = initializePatchNotesState({
            entries,
            storage,
        });

        expect(state).toEqual({
            version: PATCH_NOTES_STORAGE_VERSION,
            readEntryIds: ["2026年3月25日（v1.0.7）", "2026年3月24日"],
            initializedAt: 111,
            updatedAt: 111,
        });
        expect(JSON.parse(storage.getItem(PATCH_NOTES_STORAGE_KEY))).toEqual(state);
        expect(getUnreadPatchNoteEntries({
            entries,
            storage,
        })).toEqual([]);
    });

    it("returns only newly added entries as unread when storage already exists", () => {
        const storage = createLocalStorageMock();
        const entries = resolvePatchNoteEntries({
            "2026年3月26日（v1.0.8）": ["最新"],
            "2026年3月25日（v1.0.7）": ["第一条"],
            "2026年3月24日": ["第二条"],
        });

        storage.setItem(PATCH_NOTES_STORAGE_KEY, JSON.stringify({
            version: PATCH_NOTES_STORAGE_VERSION,
            readEntryIds: ["2026年3月25日（v1.0.7）", "2026年3月24日"],
            initializedAt: 100,
            updatedAt: 100,
        }));

        expect(getUnreadPatchNoteEntries({
            entries,
            storage,
        })).toEqual([
            {
                entryId: "2026年3月26日（v1.0.8）",
                label: "2026年3月26日（v1.0.8）",
                notes: ["最新"],
            },
        ]);
    });

    it("keeps read-state matching stable when the patch note language changes", () => {
        const storage = createLocalStorageMock();
        vi.spyOn(Date, "now").mockReturnValue(333);
        const patchNotes = {
            "2026年3月26日（v1.0.8）": {
                label: {
                    zh: "2026年3月26日（v1.0.8）",
                    en: "March 26, 2026 (v1.0.8)",
                },
                notes: {
                    zh: ["第一条"],
                    en: ["First note"],
                },
            },
            "2026年3月25日（v1.0.7）": {
                label: {
                    zh: "2026年3月25日（v1.0.7）",
                    en: "March 25, 2026 (v1.0.7)",
                },
                notes: {
                    zh: ["第二条"],
                    en: ["Second note"],
                },
            },
        };
        const zhEntries = resolvePatchNoteEntries(patchNotes, "zh");
        const enEntries = resolvePatchNoteEntries(patchNotes, "en");

        expect(zhEntries.map((entry) => entry.entryId)).toEqual([
            "2026年3月26日（v1.0.8）",
            "2026年3月25日（v1.0.7）",
        ]);
        expect(enEntries.map((entry) => entry.entryId)).toEqual([
            "2026年3月26日（v1.0.8）",
            "2026年3月25日（v1.0.7）",
        ]);

        initializePatchNotesState({
            entries: zhEntries,
            storage,
        });

        expect(getUnreadPatchNoteEntries({
            entries: enEntries,
            storage,
        })).toEqual([]);
    });

    it("marks unread entries as read without dropping older read ids", () => {
        const storage = createLocalStorageMock();
        vi.spyOn(Date, "now").mockReturnValue(456789);

        storage.setItem(PATCH_NOTES_STORAGE_KEY, JSON.stringify({
            version: PATCH_NOTES_STORAGE_VERSION,
            readEntryIds: ["2026年3月25日（v1.0.7）"],
            initializedAt: 111,
            updatedAt: 222,
        }));

        const ok = markPatchNoteEntriesAsRead({
            entryIds: ["2026年3月26日（v1.0.8）", "", "2026年3月26日（v1.0.8）"],
            storage,
        });

        expect(ok).toBe(true);
        expect(JSON.parse(storage.getItem(PATCH_NOTES_STORAGE_KEY))).toEqual({
            version: PATCH_NOTES_STORAGE_VERSION,
            readEntryIds: ["2026年3月25日（v1.0.7）", "2026年3月26日（v1.0.8）"],
            initializedAt: 111,
            updatedAt: 456789,
        });
    });

    it("re-initializes invalid storage payloads into a recoverable baseline state", () => {
        const storage = createLocalStorageMock();
        vi.spyOn(Date, "now").mockReturnValue(999);
        const entries = resolvePatchNoteEntries({
            "2026年3月25日（v1.0.7）": ["第一条"],
        });

        storage.setItem(PATCH_NOTES_STORAGE_KEY, "{not-json");

        const state = initializePatchNotesState({
            entries,
            storage,
        });

        expect(readPatchNotesState(storage)).toEqual(state);
        expect(state).toEqual({
            version: PATCH_NOTES_STORAGE_VERSION,
            readEntryIds: ["2026年3月25日（v1.0.7）"],
            initializedAt: 999,
            updatedAt: 999,
        });
        expect(getUnreadPatchNoteEntries({
            entries,
            storage,
        })).toEqual([]);
    });
});
