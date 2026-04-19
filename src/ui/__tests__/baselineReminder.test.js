import { afterEach, describe, expect, it, vi } from "vitest";
import {
    BASELINE_REMINDER_STORAGE_KEY,
    BASELINE_REMINDER_STORAGE_VERSION,
    dismissBaselineReminder,
    isBaselineReminderDismissed,
    readBaselineReminderState,
} from "../baselineReminder.js";

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

describe("baselineReminder", () => {
    it("defaults to showing the reminder when storage is empty", () => {
        const storage = createLocalStorageMock();

        expect(readBaselineReminderState({ storage })).toEqual({
            version: BASELINE_REMINDER_STORAGE_VERSION,
            dismissed: false,
            updatedAt: 0,
        });
        expect(isBaselineReminderDismissed({ storage })).toBe(false);
    });

    it("persists the dismissed flag when the user acknowledges the reminder", () => {
        const storage = createLocalStorageMock();
        vi.spyOn(Date, "now").mockReturnValue(456);

        expect(dismissBaselineReminder({ storage })).toBe(true);
        expect(JSON.parse(storage.getItem(BASELINE_REMINDER_STORAGE_KEY))).toEqual({
            version: BASELINE_REMINDER_STORAGE_VERSION,
            dismissed: true,
            updatedAt: 456,
        });
        expect(isBaselineReminderDismissed({ storage })).toBe(true);
    });

    it("falls back to showing the reminder when the stored payload is invalid", () => {
        const storage = createLocalStorageMock();
        storage.setItem(BASELINE_REMINDER_STORAGE_KEY, "{broken");

        expect(readBaselineReminderState({ storage }).dismissed).toBe(false);
        expect(isBaselineReminderDismissed({ storage })).toBe(false);
    });

    it("falls back to showing the reminder when localStorage is unavailable", () => {
        expect(readBaselineReminderState({ storage: null }).dismissed).toBe(false);
        expect(isBaselineReminderDismissed({ storage: null })).toBe(false);
        expect(dismissBaselineReminder({ storage: null })).toBe(false);
    });
});
