import { computed } from 'vue';
import { Gauge, Shield, Sparkles, Swords, Trophy } from '@lucide/vue';
import combatStyleDetailMap from '../../combatsimulator/data/combatStyleDetailMap.json';
import damageTypeDetailMap from '../../combatsimulator/data/damageTypeDetailMap.json';
import { itemDetailIndex as itemDetailMap } from '../../shared/gameDataIndex.js';
import { LABYRINTH_ROOM_LEVEL_DEFAULT, LABYRINTH_ROOM_LEVEL_MIN } from '../../shared/labyrinthConfig.js';
import { buildCombatPreviewData, COMBAT_PREVIEW_STAT_SPEC_KEYS } from '../../services/playerMapper.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { buildCombatStatBreakdownParts } from '../lib/combatStatBreakdown.js';
import { createCombatPreviewPlayerConfig } from '../pageOptimizationHelpers.js';
import {
  formatDurationSeconds,
  formatFlexibleNumber,
  formatInt,
  formatNumber,
  formatPercent,
  formatSignedFlexibleNumber,
  formatSignedPercent,
} from '../components/home/homeFormatters.js';
import { useGameDataText } from './useGameDataText.js';
import { useI18nText } from './useI18nText.js';

const COMBAT_STAT_SECTION_DEFINITIONS = [
  {
    key: 'overview',
    titleKey: 'common:vue.home.combatStatSectionOverview',
    titleFallback: 'Combat Overview',
    icon: Gauge,
    statKeys: [
      'maxHitpoints',
      'maxManapoints',
      'combatStyle',
      'damageType',
      'primaryTraining',
      'focusTraining',
      'attackIntervalSeconds',
    ],
  },
  {
    key: 'offense',
    titleKey: 'common:vue.home.combatStatSectionOffense',
    titleFallback: 'Offense',
    icon: Swords,
    statKeys: [
      'stabAccuracyRating',
      'stabMaxDamage',
      'slashAccuracyRating',
      'slashMaxDamage',
      'smashAccuracyRating',
      'smashMaxDamage',
      'defensiveMaxDamage',
      'rangedAccuracyRating',
      'rangedMaxDamage',
      'magicAccuracyRating',
      'magicMaxDamage',
      'criticalRate',
      'criticalDamage',
      'armorPenetration',
      'physicalAmplify',
      'waterAmplify',
      'natureAmplify',
      'fireAmplify',
      'waterPenetration',
      'naturePenetration',
      'firePenetration',
      'lifeSteal',
      'taskDamage',
      'attackSpeed',
      'autoAttackDamage',
      'abilityDamage',
    ],
  },
  {
    key: 'defense',
    titleKey: 'common:vue.home.combatStatSectionDefense',
    titleFallback: 'Defense',
    icon: Shield,
    statKeys: [
      'averageEvasion',
      'totalArmor',
      'stabEvasionRating',
      'slashEvasionRating',
      'smashEvasionRating',
      'rangedEvasionRating',
      'magicEvasionRating',
      'totalWaterResistance',
      'totalNatureResistance',
      'totalFireResistance',
      'physicalThorns',
      'elementalThorns',
      'retaliation',
      'hpRegenPer10',
      'mpRegenPer10',
      'tenacity',
      'totalThreat',
      'parry',
    ],
  },
  {
    key: 'effects',
    titleKey: 'common:vue.home.combatStatSectionEffects',
    titleFallback: 'Combat Effects',
    icon: Sparkles,
    statKeys: [
      'healingAmplify',
      'abilityHaste',
      'manaLeech',
      'castSpeed',
      'mayhem',
      'pierce',
      'curse',
      'fury',
      'weaken',
      'ripple',
      'bloom',
      'blaze',
      'drinkConcentration',
      'foodHaste',
    ],
  },
  {
    key: 'rewards',
    titleKey: 'common:vue.home.combatStatSectionRewards',
    titleFallback: 'Rewards & Experience',
    icon: Trophy,
    statKeys: [
      'combatDropRate',
      'combatRareFind',
      'combatDropQuantity',
      'combatExperience',
      'staminaExperience',
      'intelligenceExperience',
      'attackExperience',
      'defenseExperience',
      'meleeExperience',
      'rangedExperience',
      'magicExperience',
    ],
  },
];

const COMBAT_STAT_SECTION_KEY_BY_STAT = new Map(
  COMBAT_STAT_SECTION_DEFINITIONS.flatMap((section) => section.statKeys.map((key) => [key, section.key])),
);

if (import.meta.env?.DEV) {
  const missingStatKeys = COMBAT_PREVIEW_STAT_SPEC_KEYS.filter((key) => !COMBAT_STAT_SECTION_KEY_BY_STAT.has(key));
  if (missingStatKeys.length > 0) {
    console.warn(
      `[combatStatSections] Stats missing from section definitions (will fall back to "effects"): ${missingStatKeys.join(', ')}`,
    );
  }
}

export function useHomeCombatPreview() {
  const simulator = useSimulatorStore();
  const { t, language } = useI18nText();
  const {
    getAbilityName,
    getBuffTypeName,
    getCombatStatName,
    getGuildShrineName,
    getItemName,
    getOfficialGameText,
    getSkillName,
  } = useGameDataText();
  const activePlayer = computed(() => simulator.activePlayer);
  const selectedActionHrid = computed(() =>
    simulator.simulationSettings.useDungeon
      ? simulator.simulationSettings.dungeonHrid
      : simulator.simulationSettings.zoneHrid,
  );
  const playerConfig = computed(() => createCombatPreviewPlayerConfig(activePlayer.value));
  const extra = computed(() => ({
    mooPass: Boolean(simulator.simulationSettings.mooPass),
    comExp: simulator.simulationSettings.comExpEnabled ? Number(simulator.simulationSettings.comExp || 20) : 0,
    comDrop: simulator.simulationSettings.comDropEnabled ? Number(simulator.simulationSettings.comDrop || 20) : 0,
    combatScrollsEnabled: Boolean(simulator.simulationSettings.combatScrollsEnabled),
  }));
  const context = computed(() => {
    if (simulator.simulationSettings.mode === 'labyrinth') {
      const labyrinthHrid = String(simulator.simulationSettings.labyrinthHrid || '');
      return labyrinthHrid
        ? {
            mode: 'labyrinth',
            labyrinthHrid,
            roomLevel: Math.max(
              LABYRINTH_ROOM_LEVEL_MIN,
              Number(simulator.simulationSettings.roomLevel || LABYRINTH_ROOM_LEVEL_DEFAULT),
            ),
            crates: simulator.getActiveLabyrinthCrates(),
          }
        : null;
    }
    const zoneHrid = String(selectedActionHrid.value || '');
    return zoneHrid
      ? {
          mode: 'zone',
          zoneHrid,
          difficultyTier: Number(simulator.simulationSettings.difficultyTier || 0),
          useDungeon: Boolean(simulator.simulationSettings.useDungeon),
        }
      : null;
  });
  const data = computed(() =>
    playerConfig.value
      ? buildCombatPreviewData(playerConfig.value, extra.value, context.value, {
          partyPlayerConfigs: simulator.selectedPlayers,
        })
      : {
          player: null,
          finalPlayer: null,
          drinkCards: [],
          highlightSources: [],
          statBreakdowns: {},
          partyAuraPreviewTruncated: false,
        },
  );
  const combatDetails = computed(() => (data.value.finalPlayer || data.value.player)?.combatDetails || null);
  const combatStats = computed(() => combatDetails.value?.combatStats || null);
  const breakdowns = computed(() => data.value.statBreakdowns || {});

  // stat 标签仅依赖语言、与玩家数据无关：按 语言:key 记忆化，
  // 避免 rows 在每次数据变化重算时重复执行 76 次 i18n 查表。
  const statNameCache = new Map();
  function statName(key, fallback) {
    const normalizedKey = String(key || '');
    const cacheKey = `${language.value}:${normalizedKey}`;
    if (!statNameCache.has(cacheKey)) {
      statNameCache.set(cacheKey, getCombatStatName(normalizedKey, fallback));
    }
    return statNameCache.get(cacheKey);
  }

  function skillName(hrid) {
    const normalized = String(hrid || '');
    return normalized ? getSkillName(normalized, normalized) : '-';
  }

  function combatStyleName(hrid, fallback = '') {
    const normalized = String(hrid || '');
    return normalized
      ? getOfficialGameText(
          'combatStyleNames',
          normalized,
          fallback || combatStyleDetailMap?.[normalized]?.name || normalized,
        )
      : fallback || '-';
  }

  function damageTypeName(hrid, fallback = '') {
    const normalized = String(hrid || '');
    if (!normalized) return fallback || '-';
    const resolved = damageTypeDetailMap?.[normalized];
    return getOfficialGameText(
      'damageTypeNames',
      String(resolved?.hrid || normalized),
      fallback || resolved?.name || normalized,
    );
  }

  function highlightLabel(source) {
    if (!source?.sourceHrid) return String(source?.sourceName || '');
    if (source.sourceType === 'ability') return getAbilityName(source.sourceHrid, source.sourceName || '');
    if (source.sourceType === 'guild_buff') return getGuildShrineName(source.sourceHrid, source.sourceName || '');
    return getItemName(
      source.sourceHrid,
      source.sourceName || itemDetailMap?.[source.sourceHrid]?.name || source.sourceHrid,
    );
  }

  function formatDelta(stat) {
    if (!stat) return '-';
    if (stat.format === 'percent') return formatSignedPercent(stat.deltaValue, 2);
    if (stat.format === 'seconds') return `${formatSignedFlexibleNumber(stat.deltaValue, 2)}s`;
    return formatSignedFlexibleNumber(stat.deltaValue, 2);
  }

  function formatValue(value, format) {
    if (format === 'percent') return formatPercent(value, 2);
    if (format === 'seconds') return formatDurationSeconds(value);
    return formatFlexibleNumber(value, 2);
  }

  const rows = computed(() => {
    const details = combatDetails.value;
    const stats = combatStats.value;
    // 玩家缺失时（如应用刚启动）playerConfig 为 null → data 走空回退 → combatDetails 为 null，
    // 本 guard 已在构造任何 row 之前短路，无需额外的 playerConfig 判空。
    if (!details || !stats) return [];
    const evasionValues = [
      details.stabEvasionRating,
      details.slashEvasionRating,
      details.smashEvasionRating,
      details.rangedEvasionRating,
      details.magicEvasionRating,
    ]
      .map(Number)
      .filter(Number.isFinite);
    const averageEvasion =
      evasionValues.length > 0 ? evasionValues.reduce((sum, value) => sum + value, 0) / evasionValues.length : 0;
    const attackIntervalSeconds = Number(stats.attackInterval || 0) / 1e9;
    const result = [
      {
        key: 'maxHitpoints',
        label: statName('maxHitpoints', 'Max Hitpoints'),
        value: formatInt(details.maxHitpoints),
      },
      {
        key: 'maxManapoints',
        label: statName('maxManapoints', 'Max Manapoints'),
        value: formatInt(details.maxManapoints),
      },
      {
        key: 'combatStyle',
        label: statName('combatStyleHrids', 'Combat Style'),
        value: combatStyleName(stats.combatStyleHrid, combatStyleDetailMap?.[stats.combatStyleHrid]?.name || ''),
      },
      {
        key: 'damageType',
        label: statName('damageType', 'Damage Type'),
        value: damageTypeName(stats.damageType, damageTypeDetailMap?.[stats.damageType]?.name || ''),
      },
      {
        key: 'primaryTraining',
        label: statName('primaryTraining', 'Primary Training'),
        value: skillName(stats.primaryTraining),
      },
      {
        key: 'focusTraining',
        label: statName('focusTraining', 'Focus Training'),
        value: skillName(stats.focusTraining),
      },
      {
        key: 'attackIntervalSeconds',
        label: statName('attackInterval', 'Attack Interval'),
        value: `${formatNumber(attackIntervalSeconds, 2)}s`,
      },
      {
        key: 'stabAccuracyRating',
        label: statName('stabAccuracy', 'Stab Accuracy'),
        value: formatInt(details.stabAccuracyRating),
      },
      {
        key: 'stabMaxDamage',
        label: statName('stabDamage', 'Stab Damage'),
        value: formatInt(details.stabMaxDamage),
      },
      {
        key: 'slashAccuracyRating',
        label: statName('slashAccuracy', 'Slash Accuracy'),
        value: formatInt(details.slashAccuracyRating),
      },
      {
        key: 'slashMaxDamage',
        label: statName('slashDamage', 'Slash Damage'),
        value: formatInt(details.slashMaxDamage),
      },
      {
        key: 'smashAccuracyRating',
        label: statName('smashAccuracy', 'Smash Accuracy'),
        value: formatInt(details.smashAccuracyRating),
      },
      {
        key: 'smashMaxDamage',
        label: statName('smashDamage', 'Smash Damage'),
        value: formatInt(details.smashMaxDamage),
      },
      {
        key: 'defensiveMaxDamage',
        label: statName('defensiveDamage', 'Defensive Damage'),
        value: formatInt(details.defensiveMaxDamage),
      },
      {
        key: 'rangedAccuracyRating',
        label: statName('rangedAccuracy', 'Ranged Accuracy'),
        value: formatInt(details.rangedAccuracyRating),
      },
      {
        key: 'rangedMaxDamage',
        label: statName('rangedDamage', 'Ranged Damage'),
        value: formatInt(details.rangedMaxDamage),
      },
      {
        key: 'magicAccuracyRating',
        label: statName('magicAccuracy', 'Magic Accuracy'),
        value: formatInt(details.magicAccuracyRating),
      },
      {
        key: 'magicMaxDamage',
        label: statName('magicDamage', 'Magic Damage'),
        value: formatInt(details.magicMaxDamage),
      },
      {
        key: 'averageEvasion',
        label: getBuffTypeName('/buff_types/evasion', 'Evasion'),
        value: formatInt(averageEvasion),
      },
      { key: 'totalArmor', label: statName('armor', 'Armor'), value: formatInt(details.totalArmor) },
      {
        key: 'criticalRate',
        label: statName('criticalRate', 'Critical Rate'),
        value: formatPercent(stats.criticalRate, 2),
      },
      {
        key: 'armorPenetration',
        label: statName('armorPenetration', 'Armor Penetration'),
        value: formatPercent(stats.armorPenetration, 2),
      },
      {
        key: 'stabEvasionRating',
        label: statName('stabEvasion', 'Stab Evasion'),
        value: formatInt(details.stabEvasionRating),
      },
      {
        key: 'slashEvasionRating',
        label: statName('slashEvasion', 'Slash Evasion'),
        value: formatInt(details.slashEvasionRating),
      },
      {
        key: 'smashEvasionRating',
        label: statName('smashEvasion', 'Smash Evasion'),
        value: formatInt(details.smashEvasionRating),
      },
      {
        key: 'rangedEvasionRating',
        label: statName('rangedEvasion', 'Ranged Evasion'),
        value: formatInt(details.rangedEvasionRating),
      },
      {
        key: 'magicEvasionRating',
        label: statName('magicEvasion', 'Magic Evasion'),
        value: formatInt(details.magicEvasionRating),
      },
      {
        key: 'totalWaterResistance',
        label: statName('waterResistance', 'Water Resistance'),
        value: formatInt(details.totalWaterResistance),
      },
      {
        key: 'totalNatureResistance',
        label: statName('natureResistance', 'Nature Resistance'),
        value: formatInt(details.totalNatureResistance),
      },
      {
        key: 'totalFireResistance',
        label: statName('fireResistance', 'Fire Resistance'),
        value: formatInt(details.totalFireResistance),
      },
      {
        key: 'physicalAmplify',
        label: statName('physicalAmplify', 'Physical Amplify'),
        value: formatPercent(stats.physicalAmplify, 2),
      },
      {
        key: 'waterAmplify',
        label: statName('waterAmplify', 'Water Amplify'),
        value: formatPercent(stats.waterAmplify, 2),
      },
      {
        key: 'natureAmplify',
        label: statName('natureAmplify', 'Nature Amplify'),
        value: formatPercent(stats.natureAmplify, 2),
      },
      {
        key: 'fireAmplify',
        label: statName('fireAmplify', 'Fire Amplify'),
        value: formatPercent(stats.fireAmplify, 2),
      },
      {
        key: 'healingAmplify',
        label: statName('healingAmplify', 'Healing Amplify'),
        value: formatPercent(stats.healingAmplify, 2),
      },
      { key: 'lifeSteal', label: statName('lifeSteal', 'Life Steal'), value: formatPercent(stats.lifeSteal, 2) },
      {
        key: 'physicalThorns',
        label: statName('physicalThorns', 'Physical Thorns'),
        value: formatPercent(stats.physicalThorns, 2),
      },
      {
        key: 'elementalThorns',
        label: statName('elementalThorns', 'Elemental Thorns'),
        value: formatPercent(stats.elementalThorns, 2),
      },
      {
        key: 'retaliation',
        label: statName('retaliation', 'Retaliation'),
        value: formatPercent(stats.retaliation, 2),
      },
      {
        key: 'hpRegenPer10',
        label: statName('hpRegenPer10', 'HP Regen'),
        value: formatPercent(stats.hpRegenPer10, 2),
      },
      {
        key: 'mpRegenPer10',
        label: statName('mpRegenPer10', 'MP Regen'),
        value: formatPercent(stats.mpRegenPer10, 2),
      },
      {
        key: 'criticalDamage',
        label: statName('criticalDamage', 'Critical Damage'),
        value: formatPercent(stats.criticalDamage, 2),
      },
      {
        key: 'taskDamage',
        label: statName('taskDamage', 'Task Damage'),
        value: formatPercent(stats.taskDamage, 2),
      },
      {
        key: 'waterPenetration',
        label: statName('waterPenetration', 'Water Penetration'),
        value: formatPercent(stats.waterPenetration, 2),
      },
      {
        key: 'naturePenetration',
        label: statName('naturePenetration', 'Nature Penetration'),
        value: formatPercent(stats.naturePenetration, 2),
      },
      {
        key: 'firePenetration',
        label: statName('firePenetration', 'Fire Penetration'),
        value: formatPercent(stats.firePenetration, 2),
      },
      {
        key: 'abilityHaste',
        label: statName('abilityHaste', 'Ability Haste'),
        value: formatInt(stats.abilityHaste),
      },
      { key: 'tenacity', label: statName('tenacity', 'Tenacity'), value: formatInt(stats.tenacity) },
      { key: 'manaLeech', label: statName('manaLeech', 'Mana Leech'), value: formatPercent(stats.manaLeech, 2) },
      { key: 'castSpeed', label: statName('castSpeed', 'Cast Speed'), value: formatPercent(stats.castSpeed, 2) },
      { key: 'totalThreat', label: statName('threat', 'Threat'), value: formatInt(details.totalThreat) },
      { key: 'parry', label: statName('parry', 'Parry'), value: formatPercent(stats.parry, 2) },
      { key: 'mayhem', label: statName('mayhem', 'Mayhem'), value: formatPercent(stats.mayhem, 2) },
      { key: 'pierce', label: statName('pierce', 'Pierce'), value: formatPercent(stats.pierce, 2) },
      { key: 'curse', label: statName('curse', 'Curse'), value: formatPercent(stats.curse, 2) },
      { key: 'fury', label: statName('fury', 'Fury'), value: formatPercent(stats.fury, 2) },
      { key: 'weaken', label: statName('weaken', 'Weaken'), value: formatPercent(stats.weaken, 2) },
      { key: 'ripple', label: statName('ripple', 'Ripple'), value: formatPercent(stats.ripple, 2) },
      { key: 'bloom', label: statName('bloom', 'Bloom'), value: formatPercent(stats.bloom, 2) },
      { key: 'blaze', label: statName('blaze', 'Blaze'), value: formatPercent(stats.blaze, 2) },
      {
        key: 'attackSpeed',
        label: statName('attackSpeed', 'Attack Speed'),
        value: formatPercent(stats.attackSpeed, 2),
      },
      {
        key: 'autoAttackDamage',
        label: statName('autoAttackDamage', 'Auto Attack Damage'),
        value: formatPercent(stats.autoAttackDamage, 2),
      },
      {
        key: 'abilityDamage',
        label: statName('abilityDamage', 'Ability Damage'),
        value: formatPercent(stats.abilityDamage, 2),
      },
      {
        key: 'drinkConcentration',
        label: statName('drinkConcentration', 'Drink Concentration'),
        value: formatPercent(stats.drinkConcentration, 2),
      },
      { key: 'foodHaste', label: statName('foodHaste', 'Food Haste'), value: formatPercent(stats.foodHaste, 2) },
      {
        key: 'combatDropRate',
        label: statName('combatDropRate', 'Combat Drop Rate'),
        value: formatPercent(stats.combatDropRate, 2),
      },
      {
        key: 'combatRareFind',
        label: statName('combatRareFind', 'Combat Rare Find'),
        value: formatPercent(stats.combatRareFind, 2),
      },
      {
        key: 'combatDropQuantity',
        label: statName('combatDropQuantity', 'Combat Drop Quantity'),
        value: formatPercent(stats.combatDropQuantity, 2),
      },
      {
        key: 'combatExperience',
        label: statName('combatExperience', 'Combat Experience'),
        value: formatPercent(stats.combatExperience, 2),
      },
      {
        key: 'staminaExperience',
        label: statName('staminaExperience', 'Stamina Experience'),
        value: formatPercent(stats.staminaExperience, 2),
      },
      {
        key: 'intelligenceExperience',
        label: statName('intelligenceExperience', 'Intelligence Experience'),
        value: formatPercent(stats.intelligenceExperience, 2),
      },
      {
        key: 'attackExperience',
        label: statName('attackExperience', 'Attack Experience'),
        value: formatPercent(stats.attackExperience, 2),
      },
      {
        key: 'defenseExperience',
        label: statName('defenseExperience', 'Defense Experience'),
        value: formatPercent(stats.defenseExperience, 2),
      },
      {
        key: 'meleeExperience',
        label: statName('meleeExperience', 'Melee Experience'),
        value: formatPercent(stats.meleeExperience, 2),
      },
      {
        key: 'rangedExperience',
        label: statName('rangedExperience', 'Ranged Experience'),
        value: formatPercent(stats.rangedExperience, 2),
      },
      {
        key: 'magicExperience',
        label: statName('magicExperience', 'Magic Experience'),
        value: formatPercent(stats.magicExperience, 2),
      },
    ];

    return result
      .filter((entry) => entry.value !== '-')
      .map((entry) => {
        const breakdown = breakdowns.value[entry.key];
        return breakdown
          ? {
              ...entry,
              ...buildCombatStatBreakdownParts(breakdown, entry.key, {
                formatDelta,
                formatValue,
                formatHighlightLabel: highlightLabel,
                t,
              }),
            }
          : { ...entry, hasSources: false, breakdownParts: [], breakdownText: '' };
      });
  });

  // section 标题同样只依赖语言：单独 computed，rows 重算时不重复做 i18n 查表。
  const sectionDefinitions = computed(() =>
    COMBAT_STAT_SECTION_DEFINITIONS.map((section) => ({
      ...section,
      title: t(section.titleKey, section.titleFallback),
    })),
  );

  const sections = computed(() => {
    const rowsBySection = new Map(COMBAT_STAT_SECTION_DEFINITIONS.map((section) => [section.key, []]));
    rows.value.forEach((row) => rowsBySection.get(COMBAT_STAT_SECTION_KEY_BY_STAT.get(row.key) || 'effects').push(row));
    return sectionDefinitions.value
      .map((section) => ({
        key: section.key,
        title: section.title,
        icon: section.icon,
        rows: rowsBySection.get(section.key),
      }))
      .filter((section) => section.rows.length > 0);
  });

  return {
    data,
    combatDetails,
    combatStats,
    rows,
    sections,
    combatStyleName,
    damageTypeName,
    partyAuraPreviewTruncated: computed(() => Boolean(data.value?.partyAuraPreviewTruncated)),
  };
}
