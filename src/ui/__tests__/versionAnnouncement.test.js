import { afterEach, describe, expect, it, vi } from "vitest";
import {
    VERSION_ANNOUNCEMENT_STORAGE_KEY,
    VERSION_ANNOUNCEMENT_STORAGE_VERSION,
    dismissVersionAnnouncements,
    getUnreadVersionAnnouncements,
    readVersionAnnouncementState,
    resolveVersionAnnouncementEntries,
    shouldShowVersionAnnouncement,
} from "../versionAnnouncement.js";

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

function createAnnouncement(overrides = {}) {
    return {
        announcementId: "announcement-1",
        dateLabel: "",
        versionLabel: "",
        title: {
            zh: "",
            en: "",
        },
        bodyLines: {
            zh: [],
            en: [],
        },
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("versionAnnouncement", () => {
    it("filters empty lines and resolves entries for the current language only", () => {
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-1",
                dateLabel: "2026-03-25",
                versionLabel: "v1.0.5",
                bodyLines: {
                    zh: ["  第一条公告  ", "", "   "],
                    en: ["", "  First line  ", " "],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-2",
                dateLabel: "2026-03-24",
                versionLabel: "v1.0.4",
                bodyLines: {
                    zh: ["", " "],
                    en: ["  Second line  "],
                },
            }),
        ];

        expect(resolveVersionAnnouncementEntries(announcements, "zh")).toEqual([
            {
                announcementId: "announcement-1",
                publishedAt: "",
                dateLabel: "2026-03-25",
                versionLabel: "v1.0.5",
                language: "zh",
                title: "",
                bodyLines: ["第一条公告"],
                hasContent: true,
            },
        ]);
        expect(resolveVersionAnnouncementEntries(announcements, "en")).toEqual([
            {
                announcementId: "announcement-1",
                publishedAt: "",
                dateLabel: "2026-03-25",
                versionLabel: "v1.0.5",
                language: "en",
                title: "",
                bodyLines: ["First line"],
                hasContent: true,
            },
            {
                announcementId: "announcement-2",
                publishedAt: "",
                dateLabel: "2026-03-24",
                versionLabel: "v1.0.4",
                language: "en",
                title: "",
                bodyLines: ["Second line"],
                hasContent: true,
            },
        ]);
    });

    it("does not read storage when the current language has no valid announcement content", () => {
        const storage = createLocalStorageMock();
        const announcements = [
            createAnnouncement({
                bodyLines: {
                    zh: [" ", ""],
                    en: [],
                },
            }),
        ];

        expect(getUnreadVersionAnnouncements({
            announcements,
            language: "zh",
            storage,
        })).toEqual([]);
        expect(storage.getItem).not.toHaveBeenCalled();
    });

    it("returns unread announcements in newest-first array order and skips read ids", () => {
        const storage = createLocalStorageMock();
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-3",
                dateLabel: "2026-03-25",
                versionLabel: "v1.0.5",
                bodyLines: {
                    zh: ["第三条"],
                    en: ["Third"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-2",
                dateLabel: "2026-03-24",
                versionLabel: "v1.0.4",
                bodyLines: {
                    zh: ["第二条"],
                    en: ["Second"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-1",
                dateLabel: "2026-03-23",
                versionLabel: "v1.0.3",
                bodyLines: {
                    zh: ["第一条"],
                    en: ["First"],
                },
            }),
        ];

        storage.setItem(VERSION_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: ["announcement-2"],
            updatedAt: 123,
        }));

        expect(getUnreadVersionAnnouncements({
            announcements,
            language: "zh",
            storage,
        }).map((entry) => entry.announcementId)).toEqual(["announcement-3", "announcement-1"]);
    });

    it("sorts announcements by publishedAt descending even when array order is wrong", () => {
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-1",
                publishedAt: "2026-03-23",
                dateLabel: "2026-03-23",
                bodyLines: {
                    zh: ["第一条"],
                    en: ["First"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-3",
                publishedAt: "2026-03-25",
                dateLabel: "2026-03-25",
                bodyLines: {
                    zh: ["第三条"],
                    en: ["Third"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-2",
                publishedAt: "2026-03-24",
                dateLabel: "2026-03-24",
                bodyLines: {
                    zh: ["第二条"],
                    en: ["Second"],
                },
            }),
        ];

        expect(resolveVersionAnnouncementEntries(announcements, "zh").map((entry) => entry.announcementId)).toEqual([
            "announcement-3",
            "announcement-2",
            "announcement-1",
        ]);
    });

    it("keeps original array order for the whole batch when any announcement lacks a sortable date", () => {
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-latest-missing-date",
                dateLabel: "Latest update",
                bodyLines: {
                    zh: ["最新公告"],
                    en: ["Latest announcement"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-older-dated",
                publishedAt: "2026-03-24",
                dateLabel: "2026-03-24",
                bodyLines: {
                    zh: ["较早公告"],
                    en: ["Older announcement"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-newer-dated",
                publishedAt: "2026-03-25",
                dateLabel: "2026-03-25",
                bodyLines: {
                    zh: ["较新公告"],
                    en: ["Newer announcement"],
                },
            }),
        ];

        expect(resolveVersionAnnouncementEntries(announcements, "zh").map((entry) => entry.announcementId)).toEqual([
            "announcement-latest-missing-date",
            "announcement-older-dated",
            "announcement-newer-dated",
        ]);
    });

    it("shows the modal when at least one unread announcement exists", () => {
        const storage = createLocalStorageMock();
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-1",
                bodyLines: {
                    zh: ["第一条"],
                    en: ["First"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-2",
                bodyLines: {
                    zh: ["第二条"],
                    en: ["Second"],
                },
            }),
        ];

        storage.setItem(VERSION_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: ["announcement-1"],
            updatedAt: 123,
        }));

        expect(shouldShowVersionAnnouncement({
            announcements,
            language: "zh",
            storage,
        })).toBe(true);
    });

    it("persists merged read ids in batch and deduplicates them", () => {
        const storage = createLocalStorageMock();
        vi.spyOn(Date, "now").mockReturnValue(456789);

        storage.setItem(VERSION_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: ["announcement-1", "announcement-2"],
            updatedAt: 123,
        }));

        const ok = dismissVersionAnnouncements({
            announcementIds: ["announcement-2", "announcement-3", "", "announcement-3"],
            storage,
        });

        expect(ok).toBe(true);
        expect(JSON.parse(storage.getItem(VERSION_ANNOUNCEMENT_STORAGE_KEY))).toEqual({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: ["announcement-1", "announcement-2", "announcement-3"],
            updatedAt: 456789,
        });
    });

    it("migrates legacy single-announcement dismissal payloads", () => {
        const storage = createLocalStorageMock();

        storage.setItem(VERSION_ANNOUNCEMENT_STORAGE_KEY, JSON.stringify({
            version: 1,
            announcementId: "announcement-legacy",
            dismissedAt: 321,
        }));

        expect(readVersionAnnouncementState(storage)).toEqual({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: ["announcement-legacy"],
            updatedAt: 321,
        });
    });

    it("treats invalid storage payloads as fully unread", () => {
        const storage = createLocalStorageMock();
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-1",
                bodyLines: {
                    zh: ["第一条"],
                    en: ["First"],
                },
            }),
        ];

        storage.setItem(VERSION_ANNOUNCEMENT_STORAGE_KEY, "{not-json");

        expect(readVersionAnnouncementState(storage)).toEqual({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: [],
            updatedAt: 0,
        });
        expect(getUnreadVersionAnnouncements({
            announcements,
            language: "zh",
            storage,
        }).map((entry) => entry.announcementId)).toEqual(["announcement-1"]);
    });

    it("does not mark announcements as read when they are missing content in the active language", () => {
        const storage = createLocalStorageMock();
        const announcements = [
            createAnnouncement({
                announcementId: "announcement-en-only",
                bodyLines: {
                    zh: [],
                    en: ["English only"],
                },
            }),
            createAnnouncement({
                announcementId: "announcement-zh",
                bodyLines: {
                    zh: ["中文公告"],
                    en: ["Chinese announcement"],
                },
            }),
        ];

        const unreadAnnouncements = getUnreadVersionAnnouncements({
            announcements,
            language: "zh",
            storage,
        });

        expect(unreadAnnouncements.map((entry) => entry.announcementId)).toEqual(["announcement-zh"]);

        dismissVersionAnnouncements({
            announcementIds: unreadAnnouncements.map((entry) => entry.announcementId),
            storage,
            updatedAt: 999,
        });

        expect(readVersionAnnouncementState(storage)).toEqual({
            version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
            readAnnouncementIds: ["announcement-zh"],
            updatedAt: 999,
        });
    });
});
