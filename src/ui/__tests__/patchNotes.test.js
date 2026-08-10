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
    it("publishes the concise bilingual 2.0.5 through 2.0.0 entries first", () => {
        const zhEntries = resolvePatchNoteEntries(undefined, "zh");
        const enEntries = resolvePatchNoteEntries(undefined, "en");

        expect(zhEntries[0]).toMatchObject({
            entryId: "2026年8月10日（v2.0.5）",
            label: "2026年8月10日（v2.0.5）",
        });
        expect(zhEntries[0].notes).toContain(
            "更新日志从弹窗迁移为独立页面，进入页面后自动标记当前未读版本。"
        );
        expect(enEntries[0]).toMatchObject({
            entryId: "2026年8月10日（v2.0.5）",
            label: "August 10, 2026 (v2.0.5)",
        });
        expect(enEntries[0].notes).toContain(
            "Patch notes now open on a dedicated page instead of a dialog, and current unread versions are marked as read when the page opens."
        );
        expect(zhEntries[1]).toMatchObject({
            entryId: "2026年8月10日（v2.0.4）",
            label: "2026年8月10日（v2.0.4）",
        });
        expect(zhEntries[1].notes).toContain(
            "官方精确 Ask 和小时均价均缺失时，可确认使用历史归档最新有效 Ask。"
        );
        expect(enEntries[1]).toMatchObject({
            entryId: "2026年8月10日（v2.0.4）",
            label: "August 10, 2026 (v2.0.4)",
        });
        expect(enEntries[1].notes).toContain(
            "Confirm the latest valid archived Ask when both the official exact Ask and hourly average are unavailable."
        );
        expect(zhEntries[2]).toMatchObject({
            entryId: "2026年8月9日（v2.0.3）",
            label: "2026年8月9日（v2.0.3）",
        });
        expect(enEntries[2]).toMatchObject({
            entryId: "2026年8月9日（v2.0.3）",
            label: "August 9, 2026 (v2.0.3)",
        });
        expect(zhEntries[3]).toMatchObject({
            entryId: "2026年8月9日（v2.0.2）",
            label: "2026年8月9日（v2.0.2）",
        });
        expect(zhEntries[3].notes).toContain(
            "队列装备成本改为完全采用市场定价：目标强化等级无精确卖单时禁止入队。"
        );
        expect(enEntries[3]).toMatchObject({
            entryId: "2026年8月9日（v2.0.2）",
            label: "August 9, 2026 (v2.0.2)",
        });
        expect(enEntries[3].notes).toContain(
            "Queue equipment costs now use market pricing only; variants without an exact sell listing are rejected."
        );
        expect(zhEntries[4]).toMatchObject({
            entryId: "2026年8月8日（v2.0.1）",
            label: "2026年8月8日（v2.0.1）",
        });
        expect(zhEntries[4].notes).toContain(
            "食物、饮品和技能新增内联触发条件编辑。"
        );
        expect(enEntries[4]).toMatchObject({
            entryId: "2026年8月8日（v2.0.1）",
            label: "August 8, 2026 (v2.0.1)",
        });
        expect(enEntries[4].notes).toContain(
            "Added inline trigger-condition editing for food, drinks, and abilities."
        );
        expect(zhEntries[5]).toMatchObject({
            entryId: "2026年8月8日（v2.0.0）",
            label: "2026年8月8日（v2.0.0）",
        });
        expect(zhEntries[5].notes).toHaveLength(3);
        expect(enEntries[5]).toMatchObject({
            entryId: "2026年8月8日（v2.0.0）",
            label: "August 8, 2026 (v2.0.0)",
        });
        expect(enEntries[5].notes).toHaveLength(3);
    });

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
