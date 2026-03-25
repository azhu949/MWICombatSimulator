export const VERSION_ANNOUNCEMENT_STORAGE_KEY = "mwi.ui.versionAnnouncement.v1";
export const VERSION_ANNOUNCEMENT_STORAGE_VERSION = 2;
const LEGACY_VERSION_ANNOUNCEMENT_STORAGE_VERSION = 1;

// Keep announcements in newest-first order so unread backlog display stays stable.
export const versionAnnouncements = Object.freeze([
    Object.freeze({
        announcementId: "2026-03-25-v1.0.7-release",
        publishedAt: "2026-03-25",
        dateLabel: "2026-03-25",
        versionLabel: "v1.0.7",
        title: Object.freeze({
            zh: "版本更新公告已上线",
            en: "Version Announcements Are Live",
        }),
        bodyLines: Object.freeze({
            zh: Object.freeze([
                "新增版本更新公告弹窗，首次进入会汇总展示当前所有未读版本说明。",
                "公告改为按版本逐条记录已读，同一版本只提醒一次；新版本发布后会自动补发未读内容。",
                "长公告支持顶部聚焦和独立滚动查看，阅读体验更稳定。",
                "本次也同步整理了后续公告维护所需的版本信息结构。",
            ]),
            en: Object.freeze([
                "A new version announcement modal now summarizes all unread release notes on first visit.",
                "Announcements are tracked per release, so each version is shown once and future unread updates can be delivered automatically.",
                "Long announcements now open from the top and support independent scrolling for a steadier reading experience.",
                "The release metadata structure has also been cleaned up to make future announcement maintenance easier.",
            ]),
        }),
    }),
    Object.freeze({
        announcementId: "2026-03-25-v1.0.6-release",
        publishedAt: "2026-03-25",
        dateLabel: "2026-03-25",
        versionLabel: "v1.0.6",
        title: Object.freeze({
            zh: "主站导入脚本合规性整改",
            en: "Main-Site Import Script Compliance Update",
        }),
        bodyLines: Object.freeze({
            zh: Object.freeze([
                "主站导入脚本已完成合规性整改，导入流程调整为“当前角色直导 + 手动缓存队友资料补全”。",
                "脚本不会主动调用游戏 HTTP API，也不会自动发送 view_profile 或自动操作资料弹窗。",
                "队伍导入仅使用你已手动打开并缓存过的队友资料，缺失成员会跳过并给出提示。",
                "相关使用方式、限制说明与隐私说明已同步补充到脚本文档。",
            ]),
            en: Object.freeze([
                "The main-site import script has been adjusted for compliance, using direct current-character import plus manually cached teammate profiles only.",
                "The script does not actively call game HTTP APIs, send view_profile automatically, or manipulate profile dialogs on your behalf.",
                "Party import now uses only teammate profiles you have opened and cached manually, and missing members are skipped with clear status feedback.",
                "The script documentation has been updated with clearer usage, limitations, and privacy notes.",
            ]),
        }),
    }),
]);

function normalizeLanguage(language) {
    return language === "zh" ? "zh" : "en";
}

function normalizeAnnouncementText(value) {
    return String(value || "").trim();
}

function normalizeAnnouncementId(value) {
    return normalizeAnnouncementText(value);
}

function resolveAnnouncementSortTimestamp(value) {
    const normalized = normalizeAnnouncementText(value);
    if (!normalized) {
        return Number.NaN;
    }

    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeAnnouncementIdList(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    const seen = new Set();
    const result = [];

    for (const value of values) {
        const normalized = normalizeAnnouncementId(value);
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

function createDefaultVersionAnnouncementState() {
    return {
        version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
        readAnnouncementIds: [],
        updatedAt: 0,
    };
}

export function normalizeAnnouncementBodyLines(lines) {
    if (!Array.isArray(lines)) {
        return [];
    }

    return lines
        .map((line) => normalizeAnnouncementText(line))
        .filter(Boolean);
}

export function resolveVersionAnnouncementEntry(announcement, language = "en") {
    const normalizedLanguage = normalizeLanguage(language);
    const title = normalizeAnnouncementText(announcement?.title?.[normalizedLanguage]);
    const bodyLines = normalizeAnnouncementBodyLines(announcement?.bodyLines?.[normalizedLanguage]);
    const publishedAtTimestamp = resolveAnnouncementSortTimestamp(announcement?.publishedAt);
    const sortTimestamp = Number.isFinite(publishedAtTimestamp)
        ? publishedAtTimestamp
        : resolveAnnouncementSortTimestamp(announcement?.dateLabel);

    return {
        announcementId: normalizeAnnouncementId(announcement?.announcementId),
        publishedAt: normalizeAnnouncementText(announcement?.publishedAt),
        dateLabel: normalizeAnnouncementText(announcement?.dateLabel),
        versionLabel: normalizeAnnouncementText(announcement?.versionLabel),
        language: normalizedLanguage,
        title,
        bodyLines,
        hasContent: bodyLines.length > 0,
        sortTimestamp,
    };
}

export function resolveVersionAnnouncementEntries(announcements = versionAnnouncements, language = "en") {
    if (!Array.isArray(announcements)) {
        return [];
    }

    const resolvedEntries = announcements
        .map((announcement, index) => ({
            entry: resolveVersionAnnouncementEntry(announcement, language),
            index,
        }))
        .filter(({ entry }) => entry.announcementId && entry.hasContent);

    const allEntriesHaveSortableDates = resolvedEntries.every(({ entry }) => Number.isFinite(entry.sortTimestamp));
    const orderedEntries = allEntriesHaveSortableDates
        ? resolvedEntries.slice().sort((left, right) => {
            if (left.entry.sortTimestamp !== right.entry.sortTimestamp) {
                return right.entry.sortTimestamp - left.entry.sortTimestamp;
            }

            return left.index - right.index;
        })
        : resolvedEntries;

    return orderedEntries
        .map(({ entry }) => {
            const { sortTimestamp, ...entryWithoutSortTimestamp } = entry;
            return entryWithoutSortTimestamp;
        });
}

export function readVersionAnnouncementState(storage) {
    const resolvedStorage = getStorage(storage);
    if (!resolvedStorage || typeof resolvedStorage.getItem !== "function") {
        return createDefaultVersionAnnouncementState();
    }

    try {
        const rawValue = resolvedStorage.getItem(VERSION_ANNOUNCEMENT_STORAGE_KEY);
        if (!rawValue) {
            return createDefaultVersionAnnouncementState();
        }

        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== "object") {
            return createDefaultVersionAnnouncementState();
        }

        if (Number(parsed.version) === VERSION_ANNOUNCEMENT_STORAGE_VERSION) {
            return {
                version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
                readAnnouncementIds: normalizeAnnouncementIdList(parsed.readAnnouncementIds),
                updatedAt: normalizeTimestamp(parsed.updatedAt),
            };
        }

        if (Number(parsed.version) === LEGACY_VERSION_ANNOUNCEMENT_STORAGE_VERSION) {
            const legacyAnnouncementId = normalizeAnnouncementId(parsed.announcementId);
            return {
                version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
                readAnnouncementIds: legacyAnnouncementId ? [legacyAnnouncementId] : [],
                updatedAt: normalizeTimestamp(parsed.dismissedAt),
            };
        }

        return createDefaultVersionAnnouncementState();
    } catch (error) {
        return createDefaultVersionAnnouncementState();
    }
}

export function getUnreadVersionAnnouncements({
    announcements = versionAnnouncements,
    language = "en",
    storage,
} = {}) {
    const resolvedEntries = resolveVersionAnnouncementEntries(announcements, language);
    if (resolvedEntries.length === 0) {
        return [];
    }

    const readAnnouncementIds = new Set(readVersionAnnouncementState(storage).readAnnouncementIds);
    return resolvedEntries.filter((entry) => !readAnnouncementIds.has(entry.announcementId));
}

export function shouldShowVersionAnnouncement({
    announcements = versionAnnouncements,
    language = "en",
    storage,
} = {}) {
    return getUnreadVersionAnnouncements({
        announcements,
        language,
        storage,
    }).length > 0;
}

export function dismissVersionAnnouncements({
    announcementIds = [],
    storage,
    updatedAt = Date.now(),
} = {}) {
    const resolvedStorage = getStorage(storage);
    const normalizedAnnouncementIds = normalizeAnnouncementIdList(announcementIds);

    if (!resolvedStorage || typeof resolvedStorage.setItem !== "function" || normalizedAnnouncementIds.length === 0) {
        return false;
    }

    const nextReadAnnouncementIds = normalizeAnnouncementIdList([
        ...readVersionAnnouncementState(resolvedStorage).readAnnouncementIds,
        ...normalizedAnnouncementIds,
    ]);

    try {
        resolvedStorage.setItem(
            VERSION_ANNOUNCEMENT_STORAGE_KEY,
            JSON.stringify({
                version: VERSION_ANNOUNCEMENT_STORAGE_VERSION,
                readAnnouncementIds: nextReadAnnouncementIds,
                updatedAt: normalizeTimestamp(updatedAt),
            }),
        );
        return true;
    } catch (error) {
        return false;
    }
}
