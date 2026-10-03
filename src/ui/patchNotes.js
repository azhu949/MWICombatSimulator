// 补丁目录（patchNote.json，双语全文）改为按需加载——它曾由本模块顶层静态 import，
// 使整包数据经 App.vue 静态依赖链进入首屏 index chunk。首个消费者（App 启动 /
// PatchNotesPage 挂载）调用 loadPatchNoteCatalog() 拉取一次并缓存；未读徽标与
// 预览内容在数据就绪后刷新，加载失败则保持隐藏。
let patchNoteCatalog = null;
let patchNoteCatalogPromise = null;

export function loadPatchNoteCatalog() {
  if (patchNoteCatalog) {
    return Promise.resolve(patchNoteCatalog);
  }
  if (!patchNoteCatalogPromise) {
    patchNoteCatalogPromise = import('../../patchNote.json')
      .then((module) => {
        patchNoteCatalog = module?.default ?? module;
        return patchNoteCatalog;
      })
      .catch((error) => {
        // 失败后清空缓存允许重试；错误交给调用方决定兜底策略。
        patchNoteCatalogPromise = null;
        throw error;
      });
  }
  return patchNoteCatalogPromise;
}

export const PATCH_NOTES_STORAGE_KEY = 'mwi.ui.patchNotes.v1';
export const PATCH_NOTES_STORAGE_VERSION = 1;

export const PATCH_NOTE_SECTION_KEYS = ['newFeatures', 'improvements', 'bugFixes'];

function normalizePatchNoteText(value) {
  return String(value || '').trim();
}

function normalizeEntryId(value) {
  return normalizePatchNoteText(value);
}

function normalizePatchNoteLanguage(value) {
  return normalizePatchNoteText(value).toLowerCase() === 'en' ? 'en' : 'zh';
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
  if (typeof localStorage === 'undefined') {
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

function normalizePatchNoteList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((note) => normalizePatchNoteText(note)).filter(Boolean);
}

function resolveLocalizedPatchNoteText(value, language, fallbackValue = '') {
  if (typeof value === 'string') {
    return normalizePatchNoteText(value);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalizePatchNoteText(fallbackValue);
  }

  const normalizedLanguage = normalizePatchNoteLanguage(language);
  const localizedValue = normalizePatchNoteText(value[normalizedLanguage]);
  if (localizedValue) {
    return localizedValue;
  }

  // 历史条目（2026年2月27日及更早）仅提供中文内容，英文视图回退显示中文
  // 是有意为之（迁移前行为一致，测试显式断言该回退）。
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

function resolveLocalizedPatchNoteList(value, language) {
  if (Array.isArray(value)) {
    return normalizePatchNoteList(value);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const normalizedLanguage = normalizePatchNoteLanguage(language);
  const localizedList = normalizePatchNoteList(value[normalizedLanguage]);
  if (localizedList.length > 0) {
    return localizedList;
  }

  // 历史条目（2026年2月27日及更早）仅提供中文内容，英文视图回退显示中文
  // 是有意为之（迁移前行为一致，测试显式断言该回退）。
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

// 归一化“已解析”条目的数组（resolveEntries 的数组入参路径）。
// 条目中的 sections 可能是两种形态——
//   - 已本地化形态：{ newFeatures: ['...'], ... }（单语言数组，来自 resolvePatchNoteEntries 输出）
//   - 原始 catalog 形态：{ newFeatures: { zh: [...], en: [...] }, ... }（按语言分组）
// 统一走 resolveEntrySections 的本地化解析，避免把原始形态误判为非数组而静默丢弃。
function normalizePatchNoteEntries(entries, language = 'zh') {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      entryId: normalizeEntryId(entry?.entryId),
      label: normalizePatchNoteText(entry?.label),
      sections: resolveEntrySections(entry?.sections, language),
    }))
    .filter((entry) => entry.entryId);
}

// 解析一个版本的分类字段（newFeatures / improvements / bugFixes）
// - 新三段式对象：逐个分类做本地化解析，空分类省略
// - 旧版纯数组或旧 notes 字段：整体归入 improvements 兜底，保证不丢内容。
//   该兜底仅面向历史/外部数据（当前 catalog 已全部迁移为三分类结构，不再走此路径）。
function resolveEntrySections(patchNoteValue, language) {
  if (Array.isArray(patchNoteValue)) {
    const notes = normalizePatchNoteList(patchNoteValue);
    return notes.length > 0 ? { improvements: notes } : {};
  }

  if (!patchNoteValue || typeof patchNoteValue !== 'object') {
    return {};
  }

  const sections = {};
  let hasSectionKey = false;

  for (const key of PATCH_NOTE_SECTION_KEYS) {
    const list = resolveLocalizedPatchNoteList(patchNoteValue[key], language);
    if (list.length > 0) {
      sections[key] = list;
      hasSectionKey = true;
    }
  }

  // 三分类与旧 notes 并存时，将 notes 合并进 improvements，避免内容被静默丢弃。
  const legacyNotes = resolveLocalizedPatchNoteList(patchNoteValue.notes, language);
  if (legacyNotes.length > 0) {
    sections.improvements = [...(sections.improvements || []), ...legacyNotes];
    hasSectionKey = true;
  }

  return hasSectionKey ? sections : {};
}

function resolveEntries(entriesOrPatchNotes, language = 'zh') {
  if (Array.isArray(entriesOrPatchNotes)) {
    return normalizePatchNoteEntries(entriesOrPatchNotes, language);
  }

  return resolvePatchNoteEntries(entriesOrPatchNotes, language);
}

function parseStoredPatchNotesState(storage) {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage || typeof resolvedStorage.getItem !== 'function') {
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
    if (!parsed || typeof parsed !== 'object' || Number(parsed.version) !== PATCH_NOTES_STORAGE_VERSION) {
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
  if (!resolvedStorage || typeof resolvedStorage.setItem !== 'function') {
    return false;
  }

  try {
    resolvedStorage.setItem(PATCH_NOTES_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    return false;
  }
}

// 解析补丁目录对象（patchNote.json 的原始形态）为 { entryId, label, sections } 条目数组。
// patchNotes 为必传参数（模块已不再静态导入目录、此处也没有默认值）：undefined / null /
// 非对象 / 数组入参一律返回 []；数组入参请走 resolveEntries 的归一化分派路径。
export function resolvePatchNoteEntries(patchNotes, language = 'zh') {
  if (!patchNotes || typeof patchNotes !== 'object' || Array.isArray(patchNotes)) {
    return [];
  }

  const normalizedLanguage = normalizePatchNoteLanguage(language);
  return Object.entries(patchNotes).map(([entryId, patchNoteValue]) => {
    const isLegacyEntry = Array.isArray(patchNoteValue);
    const rawLabel = isLegacyEntry ? entryId : patchNoteValue?.label;

    return {
      entryId: normalizeEntryId(entryId),
      label: resolveLocalizedPatchNoteText(rawLabel, normalizedLanguage, entryId),
      sections: resolveEntrySections(patchNoteValue, normalizedLanguage),
    };
  });
}

export function readPatchNotesState(storage) {
  return parseStoredPatchNotesState(storage).state;
}

// 首次启动建立读基线：把当前全部版本一次性记为已读；存储已有效时原样返回、不覆盖。
// entries 为必传参数（无默认值、无静态目录兜底）：未传 / 空数组时不写持久化、直接返回
// 默认状态（静默降级，见下方防御分支），开发环境会在该分支给出 console.warn 提示调用方。
export function initializePatchNotesState({ entries, storage, initializedAt = Date.now() } = {}) {
  const resolvedEntries = resolveEntries(entries);
  const { isValid, state } = parseStoredPatchNotesState(storage);

  if (isValid) {
    return state;
  }

  // 防御：目录数据尚未加载（entries 为空）时不写持久化——否则会留下
  // readEntryIds: [] 的基线，之后所有版本都会显示为未读。
  if (resolvedEntries.length === 0) {
    if (import.meta.env.DEV) {
      console.warn('[patchNotes] initializePatchNotesState skipped: no entries resolved, baseline not persisted.');
    }
    return createDefaultPatchNotesState();
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

// 返回尚未标记为已读的条目（未读徽标与预览弹窗的数据源）。
// entries 为必传参数：未传 / 空数组时不初始化、不写持久化，直接返回 []（静默降级）。
export function getUnreadPatchNoteEntries({ entries, storage } = {}) {
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

export function markPatchNoteEntriesAsRead({ entryIds = [], storage, updatedAt = Date.now() } = {}) {
  const resolvedStorage = getStorage(storage);
  const normalizedEntryIds = normalizeEntryIdList(entryIds);
  if (!resolvedStorage || typeof resolvedStorage.setItem !== 'function' || normalizedEntryIds.length === 0) {
    return false;
  }

  const currentState = readPatchNotesState(resolvedStorage);
  const nextState = {
    version: PATCH_NOTES_STORAGE_VERSION,
    readEntryIds: normalizeEntryIdList([...currentState.readEntryIds, ...normalizedEntryIds]),
    initializedAt: currentState.initializedAt,
    updatedAt: normalizeTimestamp(updatedAt),
  };

  return persistPatchNotesState(resolvedStorage, nextState);
}
