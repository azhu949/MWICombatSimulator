import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const sources = {
  page: readSource('../pages/HomePage.vue'),
  levels: readSource('../components/home/HomeLevelsPanel.vue'),
  simulation: readSource('../components/home/HomeSimulationPanel.vue'),
  equipment: readSource('../components/home/HomeEquipmentPanel.vue'),
  loadout: readSource('../components/home/HomeLoadoutPanels.vue'),
  combatAttributes: readSource('../components/home/HomeCombatAttributesPanel.vue'),
  guildBuffs: readSource('../components/home/HomeGuildBuffsModal.vue'),
  playerSnapshot: readSource('../components/home/HomePlayerSnapshotModal.vue'),
  combatPreview: readSource('../composables/useHomeCombatPreview.js'),
  workspaceSummary: readSource('../composables/useHomeWorkspaceSummary.js'),
};

function componentCount(source, componentName) {
  return source.match(new RegExp(`<${componentName}\\b`, 'g'))?.length || 0;
}

describe('Home simulation controls', () => {
  it('formats labyrinth and crate options through game-data helpers', () => {
    expect(sources.simulation).toContain('getMonsterName(');
    expect(sources.simulation).toContain('getItemName(');
    expect(sources.simulation).toContain("{ key: 'tea', labelKey: 'teaCrate', fallback: 'Tea Crate' }");
    expect(sources.simulation).toContain("{ key: 'coffee', labelKey: 'coffeeCrate', fallback: 'Coffee Crate' }");
    expect(sources.simulation).toContain("{ key: 'food', labelKey: 'foodCrate', fallback: 'Food Crate' }");
  });

  it('passes complete labyrinth context into combat preview data', () => {
    expect(sources.combatPreview).toContain("mode: 'labyrinth'");
    expect(sources.combatPreview).toContain('labyrinthHrid');
    expect(sources.combatPreview).toContain('LABYRINTH_ROOM_LEVEL_MIN');
    expect(sources.combatPreview).toContain('LABYRINTH_ROOM_LEVEL_DEFAULT');
    expect(sources.combatPreview).toContain('crates: simulator.getActiveLabyrinthCrates()');
  });
});

describe('Home localized panels', () => {
  it('renders per-player guild shrine controls', () => {
    expect(sources.guildBuffs).toContain('common:vue.home.guildBuffs.title');
    expect(sources.guildBuffs).toContain('v-for="option in guildBuffOptions"');
    expect(sources.guildBuffs).toContain('setGuildBuffLevel(option.hrid, $event.target.value)');
    expect(sources.guildBuffs).toContain('formatGuildBuffEffects(option, guildBuffLevel(option.hrid))');
  });

  it('uses triggered final stats and localized source breakdowns', () => {
    expect(sources.combatPreview).toContain('data.value.finalPlayer || data.value.player');
    expect(sources.combatPreview).toContain('buildCombatStatBreakdownParts(breakdown, entry.key');
    expect(sources.combatPreview).toContain("source.sourceType === 'guild_buff'");
    expect(sources.combatPreview).toContain('getGuildShrineName(source.sourceHrid');
    expect(sources.combatAttributes).toContain('v-for="part in entry.breakdownParts"');
  });

  it('groups combat attributes into semantic tactical sections', () => {
    for (const key of ['overview', 'offense', 'defense', 'effects', 'rewards']) {
      expect(sources.combatPreview).toContain(`key: '${key}'`);
    }
    expect(sources.combatAttributes).toContain('v-for="section in sections"');
    expect(sources.combatAttributes).toContain('grid gap-3 md:grid-cols-2 xl:grid-cols-3');
    expect(sources.combatAttributes).toContain('entry.hasSources');
    expect(sources.combatAttributes).toContain("part.kind === 'source'");
    expect(sources.combatAttributes).toContain(':title="entry.breakdownText"');
  });

  it('uses official labels in each responsible panel', () => {
    expect(sources.levels).toContain('getSkillName(`/skills/${skillKey}`');
    expect(sources.equipment).toContain('getEquipmentSlotName(slot, slot)');
    expect(sources.combatPreview).toContain("statName('retaliation', 'Retaliation')");
    expect(sources.simulation).toContain("getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth')");
    expect(sources.simulation).toContain(
      "getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon')",
    );
    expect(sources.guildBuffs).toContain("getOfficialGameText('guildPanel', 'combat', 'Combat')");
    expect(sources.simulation).toContain("getOfficialGameText('mooPass', 'mooPass', 'MooPass')");
    expect(sources.playerSnapshot).toContain("getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth')");
  });
});

describe('Home workspace tabs', () => {
  it('defines base, battle attributes, and complete results tabs', () => {
    for (const value of ['base', 'advanced', 'results']) {
      expect(sources.workspaceSummary).toContain(`value: '${value}'`);
    }
    expect(sources.workspaceSummary).not.toContain("value: 'build'");
  });

  it('groups build controls in base and isolates derived attributes', () => {
    expect(sources.page.match(/activeWorkspaceTab === 'base'/g)).toHaveLength(3);
    expect(sources.page).toContain("activeWorkspaceTab === 'advanced'");
    expect(sources.page).not.toContain("activeWorkspaceTab === 'build'");
    expect(sources.equipment).toContain("getOfficialGameText('equipmentPanel', 'title', 'Equipment')");
    expect(sources.loadout).toContain("t('common:vue.home.foodDrinksTitle', 'Food & Drinks')");
    expect(sources.loadout).toContain("getOfficialGameText('abilitiesPanel', 'title', 'Abilities')");
  });

  it('renders complete results in a full-width results tab', () => {
    expect(sources.page).toContain('v-if="activeWorkspaceTab === \'results\'" ref="homeResultsSection"');
    expect(sources.page).toContain('<AsyncSimulationResultsView v-if="homeHasResults" />');
    expect(sources.page).toContain('v-if="activeWorkspaceTab !== \'results\'"');
    expect(sources.page).not.toContain('completeResultsExpanded');
  });

  it('keeps the workspace column shrinkable so wide result tables scroll inside their own panels', () => {
    // results tab 的 grid 是无列定义的单列（auto 列）：item 必须带 min-w-0，
    // 否则 Per-round Details 等 w-max 宽表格的 min-content 会把整列撑宽，
    // 页面级出现横向滚动条（滚动条跑到页面底部而不是表格容器内）。
    expect(sources.page).toContain('<div class="min-w-0 space-y-4">');
  });

  it('routes summary and focus links to the results tab', () => {
    expect(sources.page).toContain("requestWorkspaceTabChange('results')");
    expect(sources.page).toContain("homeResultsSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })");
    expect(sources.page).toContain('const { focus, ...query } = route.query');
    expect(sources.page).toContain('await openHomeResultsPanel(true)');
  });

  it('surfaces a party aura preview truncation warning when the replay hits its event budget', () => {
    expect(sources.page).toContain('combatPreview.partyAuraPreviewTruncated.value');
    expect(sources.page).toContain('data-party-aura-preview-truncated');
    expect(sources.page).toContain('common:vue.home.partyAuraPreviewTruncated');
    expect(sources.combatPreview).toContain('partyAuraPreviewTruncated: computed(');
  });
});

describe('Home inline trigger layout', () => {
  it('connects one inline editor for each food, drink, and ability row', () => {
    expect(componentCount(sources.loadout, 'InlineTriggerEditor')).toBe(3);
    expect(sources.loadout).toContain("triggerController.request('food', slotIndex - 1)");
    expect(sources.loadout).toContain("triggerController.request('drink', slotIndex - 1)");
    expect(sources.loadout).toContain("triggerController.request('ability', slotIndex - 1)");
    expect(sources.loadout).not.toContain('openTriggerEditor');
  });

  it('groups full-width food rows before full-width drink rows', () => {
    expect(sources.loadout).toContain('v-for="slotIndex in 3" :key="`food-${slotIndex}`" class="grid gap-2"');
    expect(sources.loadout).toContain('v-for="slotIndex in 3" :key="`drink-${slotIndex}`" class="grid gap-2"');
    expect(sources.loadout.indexOf('`food-${slotIndex}`')).toBeLessThan(
      sources.loadout.indexOf('`drink-${slotIndex}`'),
    );
  });

  it('offsets the sticky summary below the application shell', () => {
    expect(sources.page).toContain('top: calc(var(--app-sticky-shell-height, 3rem) + 1rem)');
    expect(sources.page).not.toContain('xl:top-24');
  });
});

describe('Home enhancement pricing', () => {
  it('places the enhancement input beside its equipment selector', () => {
    expect(sources.equipment).toContain('grid-cols-[minmax(0,1fr)_5rem]');
    expect(sources.equipment).toContain('data-equipment-input-row');
  });

  it('shows exact-ask and zero-baseline warnings without manual cost input', () => {
    expect(sources.equipment).toContain('costDraft.targetAskAvailable');
    expect(sources.equipment).toContain('common:vue.home.enhancementAskMissing');
    expect(sources.equipment).toContain('costDraft.baselineSaleZero');
    expect(sources.equipment).toContain('common:vue.home.baselineSaleZero');
    expect(sources.equipment).not.toContain('manualNetUpgradeCost');
    expect(sources.equipment).not.toContain('onEquipmentUpgradeCostChanged');
  });
});

describe('Home equipment options', () => {
  it('takes the base equipment dropdown options from the store-owned caliber', () => {
    expect(sources.equipment).toContain(
      'getEquipmentComboboxOptions(slot, activePlayer.value?.equipment?.[slot]?.itemHrid)',
    );
    // UI 层不得携带标记知识或第二份过滤实现（口径只在 shared/gameDataIndex + store 出品层）。
    expect(sources.equipment).not.toContain('isCombatInert');
    expect(sources.equipment).not.toContain('homeEquipmentOptions');
  });
});

describe('Home ability slot order', () => {
  it('swaps ability slots through the store and keeps the official ability catalog', () => {
    expect(sources.loadout).toContain(
      'const options = Number(slotIndex) === 0 ? specialAbilityOptions.value : simulator.options.abilities;',
    );
    // UI 只发一条 store 写入指令：不自行改配置、不直连存储（传的是下面归一后的槽位号）。
    expect(sources.loadout).toContain('simulator.swapActivePlayerAbilitySlots(normalizedFromIndex, normalizedToIndex)');
    expect(sources.loadout).not.toContain('localStorage');
  });

  it('pins the special ability slot and swaps with the neighbour through prominent arrow buttons', () => {
    expect(sources.loadout).toContain("'common:vue.home.abilityOrder.hint'");
    // 切换只由点击驱动：拖拽排序的实现必须整体消失。
    expect(sources.loadout).not.toContain('draggable');
    expect(sources.loadout).not.toContain('onAbilitySlotDrag');
    // 两个方向按钮共用同一条「显眼」样式（可用态实心 primary、禁用态退回灰底）。
    expect(sources.loadout).toContain('const ABILITY_SLOT_MOVE_BUTTON_CLASS =');
    expect(sources.loadout.match(/:class="ABILITY_SLOT_MOVE_BUTTON_CLASS"/g)).toHaveLength(2);
    expect(sources.loadout).toContain('bg-primary text-primary-foreground shadow-sm');
    expect(sources.loadout).toContain('disabled:bg-muted/60');
    expect(sources.loadout).toContain(':disabled="!canMoveAbilitySlotUp(slotIndex - 1)"');
    expect(sources.loadout).toContain(':disabled="!canMoveAbilitySlotDown(slotIndex - 1)"');
    expect(sources.loadout).toContain('@click="swapAbilitySlots(slotIndex - 1, slotIndex - 2)"');
    expect(sources.loadout).toContain('@click="swapAbilitySlots(slotIndex - 1, slotIndex)"');
    // 技能槽 1（index 0）不是可移动槽位：方向按钮只出现在 isAbilitySlotMovable 为真的行。
    expect(sources.loadout).toContain('v-if="isAbilitySlotMovable(slotIndex - 1)"');
    expect(sources.loadout).toContain('return Number(slotIndex) > 0;');
  });

  it('guards the swap behind the trigger draft gate and closes only the editors sitting on the swapped slots', () => {
    expect(sources.loadout).toContain('if (!props.triggerController.canLeave()) {');
    // reset() 只对「编辑器正好开在被互换的两个槽位」生效：无条件 reset() 会把用户正打开的
    // 无关编辑器（食物/饮品或其他技能槽）一并关掉。行为锚定见 HomeLoadoutPanels.abilitySwap.test.js。
    // 槽位号必须先按 store 的同款口径归一（shared utils 的 normalizeAbilitySlotIndex），比较与传参用的是
    // 同一对数字：UI 若按原值比对（Number 不 floor）、store 按 floor 后的值动手，小数入参下就会静默分叉
    // ——store 换掉了槽位、UI 却认为「没换」，编辑器被留在内容已经换过的旧槽位上。
    expect(sources.loadout).toContain("import { normalizeAbilitySlotIndex } from '../../../services/utils.js';");
    expect(sources.loadout).toContain('const normalizedFromIndex = normalizeAbilitySlotIndex(fromIndex);');
    expect(sources.loadout).toContain('const normalizedToIndex = normalizeAbilitySlotIndex(toIndex);');
    expect(sources.loadout).toContain("props.triggerController.isActive('ability', normalizedFromIndex)");
    expect(sources.loadout).toContain("props.triggerController.isActive('ability', normalizedToIndex)");
    // 旧口径的调用形态（isActive('ability', Number(...))，不 floor）与 store 的实际交换目标分叉，
    // 必须整体消失（注释里提到旧写法不算，这里锚定的是真调用）。
    expect(sources.loadout).not.toContain("isActive('ability', Number(fromIndex))");
    expect(sources.loadout).not.toContain("isActive('ability', Number(toIndex))");
    expect(sources.loadout).toContain('if (closesTriggerEditor) {');
    expect(sources.loadout).toContain('props.triggerController.reset();');
  });
});
