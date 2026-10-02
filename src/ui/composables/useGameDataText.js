import {
  getAbilityName as getIndexedAbilityName,
  getActionName as getIndexedActionName,
  getBuffTypeName as getIndexedBuffTypeName,
  getHouseRoomName as getIndexedHouseRoomName,
  getItemCategoryName as getIndexedItemCategoryName,
  getItemName as getIndexedItemName,
  getMonsterName as getIndexedMonsterName,
  getSkillName as getIndexedSkillName,
} from '../../shared/gameDataIndex.js';
import {
  normalizeAbilityDefinitionHrid,
  resolveAbilityDefinition,
} from '../../combatsimulator/abilityDefinitionResolver.js';
import { getGuildShrineName as getIndexedGuildShrineName } from '../../shared/guildBuffs.js';
import i18next from '../i18n/i18n.js';
import { useI18nText } from './useI18nText.js';

function coerceText(value) {
  if (value == null) {
    return '';
  }

  return String(value);
}

function normalizeSkillHrid(skillKey) {
  const normalized = coerceText(skillKey).trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('/skills/')) {
    return `/skills/${normalized.slice('/skills/'.length).toLowerCase()}`;
  }

  const shortKey = normalized.split('/').filter(Boolean).pop() || normalized;
  return `/skills/${shortKey.toLowerCase()}`;
}

function isUnresolvedTranslation(value, keys) {
  const normalized = coerceText(value).trim();
  return keys.some((key) => normalized === key || normalized === key.split(':').slice(1).join(':'));
}

export function useGameDataText() {
  const { t } = useI18nText();

  // 官方文本查询：默认走当前会话语言；options.language 可显式指定语言，但只对「已注册」
  // 语言（当前 zh / en）有效——默认 zh 会话下 en 语言包按需懒加载（见 i18n.js 与
  // localeBundles.js），目标语言未注册时 fallbackLng 已显式关闭，透传 lng 既不报错也不
  // 回落到当前语言，查询会静默退化为 fallbackText / hrid。跨语言取官方名请走
  // getItemNameEn 的索引式入口（读共享索引，不经 i18next）；本约束由下方的开发期断言兜底。
  function getOfficialGameText(resourceKey, hrid, fallbackText = '', options = {}) {
    const rawHrid = coerceText(hrid).trim();
    const normalizedFallback = coerceText(fallbackText);
    if (!rawHrid) {
      return normalizedFallback;
    }

    const translationKey = `translation:${resourceKey}.${rawHrid}`;
    // 开发期契约断言：显式 language 只对「已注册」语言有效，目标语言未注册时查询会静默
    // 退化（见函数上方注释）。让 CI（vitest 里 import.meta.env.DEV 恒为 true）而不是用户的
    // 界面发现这类调用；生产构建中 import.meta.env.DEV 被 Vite 静态替换为 false 并被
    // tree-shaking 移除，零开销零副作用。i18next.isInitialized 门控必需：未 init 时所有
    // 语言都还不在 resources 里，且既有单测 mock 了 t、从不 init，缺门控会把「未初始化」
    // 误判成「未注册」。
    if (
      import.meta.env.DEV &&
      options.language &&
      i18next.isInitialized &&
      !i18next.hasResourceBundle(options.language, 'translation')
    ) {
      throw new Error(
        `[getOfficialGameText] 显式 language "${options.language}" 尚未注册（key=${translationKey}）：该查询会静默退化为 fallbackText / hrid；跨语言取官方名请走 getItemNameEn 的索引式入口`,
      );
    }
    const translated = t(translationKey, translationKey, options.language ? { lng: options.language } : {});
    if (!isUnresolvedTranslation(translated, [translationKey])) {
      return translated;
    }

    return normalizedFallback || (options.fallbackToHrid === false ? '' : rawHrid);
  }

  function getAbilityName(abilityHrid, fallbackName = '') {
    const rawHrid = coerceText(abilityHrid).trim();
    if (!rawHrid) {
      return coerceText(fallbackName);
    }
    const normalizedHrid = normalizeAbilityDefinitionHrid(rawHrid) || rawHrid;
    return getOfficialGameText(
      'abilityNames',
      normalizedHrid,
      getIndexedAbilityName(normalizedHrid, coerceText(fallbackName)),
    );
  }

  function getAbilityDescription(abilityHrid, fallbackDescription = '') {
    const rawHrid = coerceText(abilityHrid).trim();
    if (!rawHrid) {
      return coerceText(fallbackDescription);
    }
    const normalizedHrid = normalizeAbilityDefinitionHrid(rawHrid) || rawHrid;
    const definitionDescription = coerceText(resolveAbilityDefinition(normalizedHrid)?.description);
    return getOfficialGameText(
      'abilityDescriptions',
      normalizedHrid,
      definitionDescription || coerceText(fallbackDescription),
      { fallbackToHrid: false },
    );
  }

  function getActionName(actionHrid, fallbackName = '') {
    const rawHrid = coerceText(actionHrid).trim();
    return getOfficialGameText('actionNames', rawHrid, getIndexedActionName(rawHrid, coerceText(fallbackName)));
  }

  function getBuffTypeName(buffTypeHrid, fallbackName = '') {
    const rawHrid = coerceText(buffTypeHrid).trim();
    const fallbackText = coerceText(fallbackName);

    if (!rawHrid) {
      return fallbackText;
    }

    return getOfficialGameText('buffTypeNames', rawHrid, getIndexedBuffTypeName(rawHrid, fallbackText));
  }

  function getSkillName(skillKey, fallbackName = '') {
    const rawSkillKey = coerceText(skillKey).trim();
    const fallbackText = coerceText(fallbackName);

    if (!rawSkillKey) {
      return fallbackText;
    }

    const normalizedHrid = normalizeSkillHrid(rawSkillKey);
    if (normalizedHrid) {
      return getOfficialGameText('skillNames', normalizedHrid, getIndexedSkillName(rawSkillKey, fallbackText));
    }

    return getIndexedSkillName(rawSkillKey, fallbackText);
  }

  function getItemCategoryName(categoryHrid, fallbackName = '') {
    const rawHrid = coerceText(categoryHrid).trim();
    const fallbackText = coerceText(fallbackName);

    if (!rawHrid) {
      return fallbackText;
    }

    return getOfficialGameText('itemCategoryNames', rawHrid, getIndexedItemCategoryName(rawHrid, fallbackText));
  }

  function getEquipmentTypeName(equipmentTypeHrid, fallbackName = '') {
    const rawHrid = coerceText(equipmentTypeHrid).trim();
    return getOfficialGameText('equipmentTypeNames', rawHrid, coerceText(fallbackName));
  }

  function getEquipmentSlotName(slotKey, fallbackName = '') {
    const rawSlotKey = coerceText(slotKey).trim();
    if (!rawSlotKey) {
      return coerceText(fallbackName);
    }
    const equipmentTypeKey = rawSlotKey === 'weapon' ? 'main_hand' : rawSlotKey.replace(/^\/equipment_types\//, '');
    const fallback =
      coerceText(fallbackName) ||
      equipmentTypeKey
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    return getEquipmentTypeName(`/equipment_types/${equipmentTypeKey}`, fallback);
  }

  function getCombatStatName(statKey, fallbackName = '') {
    const rawKey = coerceText(statKey).trim();
    return getOfficialGameText('combatStats', rawKey, coerceText(fallbackName));
  }

  function getItemName(itemHrid, fallbackName = '') {
    const rawHrid = coerceText(itemHrid).trim();
    const fallbackText = coerceText(fallbackName).trim();

    if (!rawHrid) {
      return fallbackText;
    }

    return getOfficialGameText('itemNames', rawHrid, getIndexedItemName(rawHrid, fallbackText));
  }

  // 官方英文名直接读共享索引，不走 i18next 的跨语言查询：默认 zh 会话下 en 资源
  // 缺席时，显式 lng 不会回落到当前语言，英文检索会静默退化成 hrid。
  // 数据源口径：展示名走 i18next 的 translation:itemNames（当前语言的官方语言包），
  // 英文检索词走共享索引 itemDetailIndex[hrid].name（由 scripts/build-game-data-index.mjs
  // 从 src/combatsimulator/data 快照生成）；两者由不同管线产出，一致性由
  // src/ui/i18n/__tests__/localTranslationData.test.js 的
  // 'keeps the shared item index names aligned with the official English dictionary' 守护。
  function getItemNameEn(itemHrid) {
    const rawHrid = coerceText(itemHrid).trim();
    return rawHrid ? getIndexedItemName(rawHrid, rawHrid) : '';
  }

  function getMonsterName(monsterHrid, fallbackName = '') {
    const rawHrid = coerceText(monsterHrid).trim();
    return getOfficialGameText('monsterNames', rawHrid, getIndexedMonsterName(rawHrid, coerceText(fallbackName)));
  }

  function getHouseRoomName(roomHrid, fallbackName = '') {
    const rawHrid = coerceText(roomHrid).trim();
    return getOfficialGameText('houseRoomNames', rawHrid, getIndexedHouseRoomName(rawHrid, coerceText(fallbackName)));
  }

  function getGuildShrineName(shrineHrid, fallbackName = '') {
    const rawHrid = coerceText(shrineHrid).trim();
    return getOfficialGameText(
      'guildShrineNames',
      rawHrid,
      getIndexedGuildShrineName(rawHrid, coerceText(fallbackName)),
    );
  }

  function getAchievementName(achievementHrid, fallbackName = '') {
    return getOfficialGameText('achievementNames', achievementHrid, fallbackName);
  }

  function getAchievementTierName(tierHrid, fallbackName = '') {
    return getOfficialGameText('achievementTierNames', tierHrid, fallbackName);
  }

  return {
    getAbilityDescription,
    getAbilityName,
    getActionName,
    getAchievementName,
    getAchievementTierName,
    getBuffTypeName,
    getCombatStatName,
    getEquipmentSlotName,
    getEquipmentTypeName,
    getGuildShrineName,
    getHouseRoomName,
    getItemName,
    getItemNameEn,
    getMonsterName,
    getOfficialGameText,
    getSkillName,
    getItemCategoryName,
  };
}
