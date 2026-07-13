<template>
  <section class="space-y-4" data-enhancement-page>
    <div class="panel overflow-hidden !px-4 !py-3" data-enhancement-toolbar>
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <div class="flex shrink-0 items-baseline gap-2">
            <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-300/80">{{ t("common:enhancement.eyebrow", "Enhancement Lab") }}</p>
            <h2 class="font-heading text-lg font-semibold text-slate-100">{{ t("common:enhancement.title", "Enhancement Simulator") }}</h2>
          </div>
          <span class="hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true"></span>
          <p class="min-w-[180px] flex-1 truncate text-xs text-slate-400">{{ selectedRouteLabel }}</p>
          <span class="shrink-0 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-slate-400">
            {{ t("common:enhancement.actionTimeBadge", "12s base action") }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2" data-tm-import-anchor="enhancement-actions">
          <span class="rounded border px-2 py-1 text-[11px]" :class="priceStatusClass">{{ priceStatusText }}</span>
          <button type="button" class="action-button-muted !px-3 !py-1.5" data-tm-import-reference="enhancement-refresh" :disabled="priceRefreshPending" @click="refreshPrices">
            {{ priceRefreshPending ? t("common:enhancement.refreshing", "Refreshing...") : t("common:enhancement.refreshPrices", "Refresh prices") }}
          </button>
          <button type="button" class="action-button-muted !px-3 !py-1.5" :disabled="enhancement.riskRunning" @click="resetConfig">
            {{ t("common:enhancement.reset", "Reset") }}
          </button>
          <button type="button" class="action-button-primary !px-3 !py-1.5" :disabled="!enhancement.config.itemHrid || enhancement.riskRunning || !budgetInputValid" @click="runRisk">
            {{ t("common:enhancement.calculateRisk", "Calculate risk") }}
          </button>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
      <aside class="space-y-4">
        <div class="panel space-y-3" data-enhancement-config>
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.14em] text-slate-500">01</p>
              <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:enhancement.targetItem", "Target item") }}</h3>
            </div>
            <button
              v-if="enhancement.config.itemHrid"
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-lg text-amber-300 transition hover:bg-white/10"
              :aria-label="favoriteButtonLabel(enhancement.config.itemHrid)"
              :title="favoriteButtonLabel(enhancement.config.itemHrid)"
              @click="enhancement.toggleFavorite(enhancement.config.itemHrid)"
            >
              <span aria-hidden="true">{{ isFavorite(enhancement.config.itemHrid) ? "★" : "☆" }}</span>
            </button>
          </div>

          <button type="button" class="w-full rounded-lg border border-white/10 bg-slate-950/40 p-3 text-left transition hover:border-amber-300/50" @click="openItemPicker">
            <span class="field-label">{{ t("common:enhancement.item", "Item") }}</span>
            <span class="mt-1 flex items-center gap-2.5">
              <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/[0.04] ring-1 ring-inset ring-white/10" data-enhancement-selected-item-icon>
                <svg v-if="itemIconVisible(enhancement.config.itemHrid)" class="h-full w-full p-1" viewBox="0 0 50 50" aria-hidden="true">
                  <use :href="itemIconHref(enhancement.config.itemHrid)"></use>
                </svg>
                <span v-else class="text-sm font-semibold text-slate-500" aria-hidden="true">{{ itemIconFallback(enhancement.selectedItem || { name: "?" }) }}</span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center justify-between gap-3">
                  <span class="min-w-0 truncate text-sm font-semibold text-slate-100">{{ selectedItemName }}</span>
                  <span class="shrink-0 text-xs text-amber-300">{{ t("common:enhancement.choose", "Choose") }}</span>
                </span>
                <span v-if="selectedItemType" class="mt-1 block text-xs text-slate-500">{{ selectedItemType }}</span>
              </span>
            </span>
          </button>

          <div class="grid grid-cols-3 gap-3">
            <label>
              <span class="field-label">{{ t("common:enhancement.startLevel", "Start level") }}</span>
              <input v-model.number="enhancement.config.startLevel" class="field-input" type="number" min="0" :max="Math.max(0, Number(enhancement.config.targetLevel || 1) - 1)" step="1" />
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.targetLevel", "Target level") }}</span>
              <input v-model.number="enhancement.config.targetLevel" class="field-input" type="number" min="1" max="20" step="1" />
            </label>
            <label>
              <span class="field-label">{{ getBuffTypeName("/buff_types/enhancing_level", "Enhancing Level") }}</span>
              <input v-model.number="enhancement.config.skillLevel" class="field-input" type="number" min="1" max="200" step="1" />
            </label>
          </div>

          <div class="grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label>
              <span class="field-label">{{ enhancingTeaLabel }}</span>
              <select v-model="enhancement.config.teaHrid" class="field-select">
                <option value="">{{ t("common:enhancement.none", "None") }}</option>
                <option v-for="tea in teaOptions" :key="tea.hrid" :value="tea.hrid">{{ itemName(tea) }}</option>
              </select>
            </label>
            <label class="flex min-h-10 items-center gap-2 self-end rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <input v-model="enhancement.config.blessedTea" type="checkbox" />
              <span>{{ getGameItemName("/items/blessed_tea", "Blessed Tea") }}</span>
            </label>
            <label class="flex min-h-10 items-center gap-2 self-end rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <input v-model="enhancement.config.wisdomTea" type="checkbox" />
              <span>{{ getGameItemName("/items/wisdom_tea", "Wisdom Tea") }}</span>
            </label>
          </div>

          <div class="grid grid-cols-3 gap-2 border-t border-white/10 pt-3" data-enhancement-config-tools>
            <button
              type="button"
              class="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs font-semibold text-slate-300 transition hover:border-teal-300/40 hover:bg-teal-300/[0.06] hover:text-slate-100"
              :aria-expanded="advancedOpen"
              aria-controls="enhancement-advanced-tabs"
              @click="advancedOpen = !advancedOpen"
            >
              <span class="min-w-0 leading-4">{{ advancedOpen ? t("common:enhancement.collapseAdvancedSettings", "Collapse advanced settings") : t("common:enhancement.advancedSettings", "Advanced settings") }}</span>
              <span class="text-base text-teal-300" aria-hidden="true">{{ advancedOpen ? "-" : "+" }}</span>
            </button>
            <button
              type="button"
              class="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs font-semibold text-slate-300 transition hover:border-amber-300/40 hover:bg-amber-300/[0.06] hover:text-slate-100"
              aria-haspopup="dialog"
              @click="equipmentModalOpen = true"
            >
              <span class="min-w-0 leading-4">{{ enhancingGearLabel }}</span>
              <span class="shrink-0 text-[10px] font-normal text-amber-300">{{ configuredEquipmentCount }}</span>
            </button>
            <button
              type="button"
              class="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs font-semibold text-slate-300 transition hover:border-amber-300/40 hover:bg-amber-300/[0.06] hover:text-slate-100"
              aria-haspopup="dialog"
              @click="openPricesModal"
            >
              <span class="min-w-0 leading-4">{{ t("common:enhancement.materialsAndPrices", "Materials & prices") }}</span>
              <span class="shrink-0 text-[10px] font-normal text-slate-500">{{ materialRows.length }}</span>
            </button>
          </div>

          <div
            v-show="advancedOpen"
            id="enhancement-advanced-tabs"
            class="grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-slate-950/30"
            role="tablist"
            :aria-label="t('common:enhancement.advancedSettings', 'Advanced settings')"
            data-enhancement-advanced-tabs
            @keydown="handleTabKeydown"
          >
            <button
              type="button"
              class="min-h-11 border-b-2 px-2 py-2 text-[11px] font-semibold leading-4 transition"
              :class="activeAdvancedTab === 'bonuses' ? 'border-teal-300 bg-teal-300/10 text-teal-200' : 'border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'"
              role="tab"
              :aria-selected="activeAdvancedTab === 'bonuses'"
              :tabindex="activeAdvancedTab === 'bonuses' ? 0 : -1"
              aria-controls="enhancement-advanced-bonuses"
              @click="activeAdvancedTab = 'bonuses'"
            >
              {{ t("common:enhancement.skillAndHousing", "Skill & housing") }}
            </button>
            <button
              type="button"
              class="min-h-11 border-b-2 px-2 py-2 text-[11px] font-semibold leading-4 transition"
              :class="activeAdvancedTab === 'economics' ? 'border-teal-300 bg-teal-300/10 text-teal-200' : 'border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'"
              role="tab"
              :aria-selected="activeAdvancedTab === 'economics'"
              :tabindex="activeAdvancedTab === 'economics' ? 0 : -1"
              aria-controls="enhancement-advanced-economics"
              @click="activeAdvancedTab = 'economics'"
            >
              {{ t("common:enhancement.economics", "Costs & risk") }}
            </button>
          </div>

          <div
            v-show="advancedOpen && activeAdvancedTab === 'bonuses'"
            id="enhancement-advanced-bonuses"
            class="border-t border-white/10 pt-4"
            role="tabpanel"
          >
            <div class="mb-3 flex items-center justify-between gap-2">
              <h4 class="font-heading text-sm font-semibold text-teal-200">{{ t("common:enhancement.housingAndCommunity", "Housing & community") }}</h4>
              <span class="text-[11px] uppercase tracking-[0.12em] text-slate-500">{{ t("common:enhancement.successBonus", "Success bonus") }}</span>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <label>
                <span class="field-label">{{ getHouseRoomName("/house_rooms/observatory", "Observatory") }}</span>
                <input v-model.number="enhancement.config.observatoryLevel" class="field-input" type="number" min="0" max="8" step="1" />
              </label>
              <label>
                <span class="field-label">{{ t("common:enhancement.otherRoomLevels", "Other room levels") }}</span>
                <input v-model.number="enhancement.config.otherRoomLevels" class="field-input" type="number" min="0" step="1" />
              </label>
              <label>
                <span class="field-label">{{ getOfficialGameText("communityBuffTypeNames", "/community_buff_types/enhancing_speed", "Enhancing Speed") }}</span>
                <input v-model.number="enhancement.config.communityEnhancingLevel" class="field-input" type="number" min="0" max="20" step="1" />
              </label>
              <label>
                <span class="field-label">{{ getOfficialGameText("communityBuffTypeNames", "/community_buff_types/experience", "Experience") }}</span>
                <input v-model.number="enhancement.config.communityExperienceLevel" class="field-input" type="number" min="0" max="20" step="1" />
              </label>
            </div>

            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <label class="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                <input v-model="enhancement.config.noviceAchievement" type="checkbox" />
                <span>{{ achievementTierBonusLabel("/achievement_tiers/novice", "Novice") }}</span>
              </label>
              <label class="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                <input v-model="enhancement.config.championAchievement" type="checkbox" />
                <span>{{ achievementTierBonusLabel("/achievement_tiers/champion", "Champion") }}</span>
              </label>
            </div>
          </div>

        </div>

        <BaseModal
          :open="equipmentModalOpen"
          :title="enhancingGearLabel"
          panel-class="enhancement-price-modal max-w-3xl max-h-[88vh] overflow-y-auto"
          initial-focus-selector="[data-enhancement-equipment] select"
          @close="equipmentModalOpen = false"
        >
          <div class="space-y-3" data-enhancement-equipment>
            <p class="text-right text-xs text-slate-500">{{ t("common:enhancement.gearLevel", "Item / +Level") }}</p>
            <div class="grid border-y border-white/10 md:grid-cols-2 md:gap-x-4">
              <div v-for="slot in equipmentSlots" :key="slot.key" class="grid grid-cols-[76px_minmax(0,1fr)_62px] items-center gap-2 border-b border-white/10 py-2 last:border-b-0 md:[&:nth-last-child(-n+2)]:border-b-0">
                <label class="text-xs font-semibold text-slate-400" :for="`enhancement-slot-${slot.key}`">{{ slot.label }}</label>
                <select
                  :id="`enhancement-slot-${slot.key}`"
                  class="field-select py-1.5 text-xs"
                  :value="equipmentField(slot.key, 'itemHrid')"
                  @change="setEquipmentField(slot.key, 'itemHrid', $event.target.value)"
                >
                  <option value="">{{ t("common:enhancement.none", "None") }}</option>
                  <option v-for="item in slotOptions(slot.key)" :key="item.hrid" :value="item.hrid">{{ itemName(item) }}</option>
                </select>
                <input
                  :aria-label="t('common:enhancement.gearEnhancementLevel', '{{slot}} enhancement level', { slot: slot.label })"
                  class="field-input py-1.5 text-xs"
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  :value="equipmentField(slot.key, 'enhancementLevel')"
                  @input="setEquipmentField(slot.key, 'enhancementLevel', numberFromEvent($event, 0))"
                />
              </div>
            </div>
          </div>
        </BaseModal>

        <div
          v-show="advancedOpen && activeAdvancedTab === 'economics'"
          id="enhancement-advanced-economics"
          class="panel space-y-4"
          role="tabpanel"
          data-enhancement-economics
        >
          <div>
            <p class="text-xs uppercase tracking-[0.14em] text-slate-500">03</p>
            <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:enhancement.economics", "Costs & risk") }}</h3>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label>
              <span class="field-label">{{ t("common:enhancement.protectionItemMode", "Protection item") }}</span>
              <select v-model="enhancement.config.protectionMode" class="field-select">
                <option value="auto">{{ t("common:enhancement.autoCheapest", "Auto (cheapest)") }}</option>
                <option value="manual">{{ t("common:enhancement.manual", "Manual") }}</option>
              </select>
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.protectionChoice", "Protection choice") }}</span>
              <select v-model="enhancement.config.protectionItemHrid" class="field-select" :disabled="enhancement.config.protectionMode !== 'manual'">
                <option value="">{{ t("common:enhancement.autoCheapest", "Auto (cheapest)") }}</option>
                <option v-for="item in protectionOptions" :key="item.hrid" :value="item.hrid">{{ protectionOptionLabel(item) }}</option>
              </select>
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.laborRate", "Labor gold / hour") }}</span>
              <input v-model.number="enhancement.config.laborRatePerHour" class="field-input" type="number" min="0" step="1000" />
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.markupRate", "Markup (%)") }}</span>
              <input v-model.number="markupPercent" class="field-input" type="number" min="0" max="100" step="0.1" />
            </label>
          </div>
        </div>

        <BaseModal
          :open="pricesModalOpen"
          :title="t('common:enhancement.materialsAndPrices', 'Materials & prices')"
          panel-class="max-w-3xl max-h-[88vh] overflow-y-auto"
          initial-focus-selector="[data-enhancement-prices] input"
          @close="pricesModalOpen = false"
        >
          <div class="space-y-3" data-enhancement-prices>
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-slate-500">{{ t("common:enhancement.askFallback", "Market / fallback") }}</span>
              <button type="button" class="action-button-muted !px-3 !py-1.5" :disabled="priceRefreshPending" @click="refreshPrices">
                {{ priceRefreshPending ? t("common:enhancement.refreshing", "Refreshing...") : t("common:enhancement.refreshPrices", "Refresh prices") }}
              </button>
            </div>

            <div class="border-y border-amber-300/20 bg-amber-300/[0.04]" data-enhancement-starting-price>
              <div class="grid min-h-[58px] grid-cols-[minmax(0,1fr)_140px] items-center gap-3 px-3 py-2">
                <div class="flex min-w-0 items-center gap-2.5">
                  <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-950/55 ring-1 ring-inset ring-white/10" data-enhancement-starting-item-icon>
                    <svg v-if="itemIconVisible(enhancement.config.itemHrid)" class="h-full w-full p-1" viewBox="0 0 50 50" aria-hidden="true">
                      <use :href="itemIconHref(enhancement.config.itemHrid)"></use>
                    </svg>
                    <span v-else class="text-xs font-semibold text-slate-500" aria-hidden="true">{{ itemIconFallback(enhancement.selectedItem || { hrid: enhancement.config.itemHrid }) }}</span>
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-xs font-semibold text-slate-200">{{ t("common:enhancement.startingItemValue", "Starting item value") }}</p>
                    <p class="mt-0.5 text-[11px] text-slate-500">{{ priceDetailLabel(enhancement.startingItemPrice) }}</p>
                    <p v-if="isAcquisitionPriceRecord(enhancement.startingItemPrice)" class="mt-0.5 text-[10px] text-slate-600">
                      {{ acquisitionVendorFloorLabel(enhancement.startingItemPrice) }}
                    </p>
                    <p v-if="startingItemPriceMissing" class="mt-1 text-[11px] leading-4 text-amber-300">{{ startingItemPriceMissingText }}</p>
                  </div>
                </div>
                <input
                  class="field-input px-2 py-1.5 text-right text-xs"
                  type="number"
                  min="0"
                  step="1"
                  :placeholder="formatAmount(startingItemPriceValue)"
                  :value="enhancement.config.startingItemPriceOverride ?? ''"
                  @change="setStartingItemPriceOverride"
                />
              </div>
            </div>

            <div v-if="materialRows.length" class="grid gap-x-4 border-t border-white/10 sm:grid-cols-2" data-enhancement-price-grid>
              <div
                v-for="row in materialRows"
                :key="row.key || `${row.kind}-${row.priceMode}-${row.hrid}`"
                class="grid min-h-[58px] grid-cols-[minmax(0,1fr)_96px_32px] items-center gap-2 border-b border-white/10 py-2"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/[0.03] ring-1 ring-inset ring-white/10" data-enhancement-material-icon>
                    <svg v-if="itemIconVisible(row.hrid)" class="h-full w-full p-1" viewBox="0 0 50 50" aria-hidden="true">
                      <use :href="itemIconHref(row.hrid)"></use>
                    </svg>
                    <span v-else class="text-[11px] font-semibold text-slate-500" aria-hidden="true">{{ itemIconFallback(row) }}</span>
                  </span>
                  <div class="min-w-0">
                    <p class="truncate text-xs font-semibold text-slate-200">{{ itemName(row) }}</p>
                    <p class="mt-0.5 text-[11px] text-slate-500">
                      {{ priceDetailLabel(row) }}<template v-if="!isAcquisitionEstimate(row)"> · {{ t("common:enhancement.quantityShort", "Qty") }} {{ formatNumber(row.quantity ?? row.expectedQuantity ?? 0) }}</template>
                    </p>
                    <p v-if="isAcquisitionPriceRecord(row)" class="mt-0.5 text-[10px] text-slate-600">
                      {{ acquisitionVendorFloorLabel(row) }}<template v-if="Number(row.quantity ?? row.expectedQuantity ?? 0) > 0"> · {{ t("common:enhancement.quantityShort", "Qty") }} {{ formatNumber(row.quantity ?? row.expectedQuantity) }}</template>
                    </p>
                  </div>
                </div>
                <input
                  class="field-input px-2 py-1.5 text-right text-xs"
                  type="number"
                  min="0"
                  step="1"
                  :aria-label="t('common:enhancement.priceOverrideFor', 'Price override for {{item}}', { item: itemName(row) })"
                  :placeholder="row.missing ? '—' : formatAmount(row.unitPrice ?? row.price ?? 0)"
                  :value="materialOverrideValue(row)"
                  @change="setMaterialOverride(row, $event)"
                />
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-sm text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
                  :aria-label="t('common:enhancement.clearPriceOverride', 'Clear price override')"
                  :title="t('common:enhancement.clearPriceOverride', 'Clear price override')"
                  @click="enhancement.clearPriceOverride(row.hrid, row.priceMode)"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
            <p v-if="materialRows.length === 0" class="text-xs text-slate-500">{{ t("common:enhancement.selectItemForMaterials", "Select an item to load its material prices.") }}</p>
            <p
              v-if="hasAcquisitionEstimate"
              class="border-l-2 border-amber-300/30 bg-amber-300/[0.04] px-3 py-2 text-[11px] leading-4 text-slate-500"
              data-enhancement-acquisition-note
            >
              {{ t("common:enhancement.acquisitionEstimateNote", "The estimate uses key asks minus the expected liquidation value of other chest drops. Dungeon time, consumables, and drops earned during the run are excluded.") }}
            </p>
          </div>
        </BaseModal>
      </aside>

      <div class="min-w-0 space-y-4">
        <div class="panel overflow-hidden" data-enhancement-summary>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.16em] text-teal-300/80">{{ t("common:enhancement.recommendation", "Recommendation") }}</p>
              <h3 class="mt-1 font-heading text-xl font-semibold text-slate-100">{{ recommendedStrategyLabel }}</h3>
            </div>
            <span v-if="analysisReady" class="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
              {{ t("common:enhancement.lowestExpectedCost", "Lowest expected cost") }}
            </span>
          </div>

          <div v-if="analysisReady" class="mt-3 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
            <div v-for="metric in summaryMetrics" :key="metric.key" class="min-h-[76px] bg-slate-950/70 p-3">
              <p class="text-[11px] uppercase tracking-[0.12em] text-slate-500">{{ metric.label }}</p>
              <p class="mt-2 font-heading text-lg font-semibold" :class="metric.tone">{{ metric.value }}</p>
              <p v-if="metric.detail" class="mt-1 text-[11px] text-slate-500">{{ metric.detail }}</p>
            </div>
          </div>
          <div v-else class="mt-4 border-l-2 border-amber-300/50 py-2 pl-4 text-sm text-slate-400">
            {{ t("common:enhancement.emptyAnalysis", "Choose an item and valid levels to compare enhancement strategies.") }}
          </div>
        </div>

        <div
          class="grid grid-cols-3 overflow-hidden rounded-lg border border-white/10 bg-slate-950/30"
          role="tablist"
          :aria-label="t('common:enhancement.resultViews', 'Result views')"
          data-enhancement-result-tabs
          @keydown="handleTabKeydown"
        >
          <button
            type="button"
            class="min-h-12 border-b-2 px-3 py-2 text-xs font-semibold transition"
            :class="activeResultTab === 'strategies' ? 'border-amber-300 bg-amber-300/10 text-amber-200' : 'border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'"
            role="tab"
            :aria-selected="activeResultTab === 'strategies'"
            :tabindex="activeResultTab === 'strategies' ? 0 : -1"
            aria-controls="enhancement-results-strategies"
            @click="activeResultTab = 'strategies'"
          >
            {{ t("common:enhancement.strategyComparison", "Protection strategy comparison") }}
            <span class="ml-1 text-[10px] opacity-70">{{ strategyRows.length }}</span>
          </button>
          <button
            type="button"
            class="min-h-12 border-b-2 px-3 py-2 text-xs font-semibold transition"
            :class="activeResultTab === 'mirror' ? 'border-amber-300 bg-amber-300/10 text-amber-200' : 'border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'"
            role="tab"
            :aria-selected="activeResultTab === 'mirror'"
            :tabindex="activeResultTab === 'mirror' ? 0 : -1"
            aria-controls="enhancement-results-mirror"
            @click="activeResultTab = 'mirror'"
          >
            {{ mirrorAndDecompositionLabel }}
          </button>
          <button
            type="button"
            class="min-h-12 border-b-2 px-3 py-2 text-xs font-semibold transition"
            :class="activeResultTab === 'risk' ? 'border-amber-300 bg-amber-300/10 text-amber-200' : 'border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'"
            role="tab"
            :aria-selected="activeResultTab === 'risk'"
            :tabindex="activeResultTab === 'risk' ? 0 : -1"
            aria-controls="enhancement-results-risk"
            @click="activeResultTab = 'risk'"
          >
            {{ t("common:enhancement.riskAnalysis", "Risk & budget analysis") }}
          </button>
        </div>

        <div
          v-show="activeResultTab === 'strategies'"
          id="enhancement-results-strategies"
          class="panel overflow-hidden"
          role="tabpanel"
          data-enhancement-strategies
        >
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.14em] text-slate-500">{{ t("common:enhancement.expectedValues", "Expected values") }}</p>
              <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:enhancement.strategyComparison", "Protection strategy comparison") }}</h3>
            </div>
            <span class="text-xs text-slate-500">{{ t("common:enhancement.sortedByTotal", "Sorted by total investment") }}</span>
          </div>

          <div class="mt-3 overflow-auto xl:max-h-[460px]">
            <table class="w-full min-w-[1280px] text-xs">
              <thead class="sticky top-0 z-10 bg-slate-900/95">
                <tr class="border-b border-white/10 text-left uppercase tracking-[0.1em] text-slate-500">
                  <th class="px-2 py-3">{{ t("common:enhancement.strategy", "Strategy") }}</th>
                  <th
                    class="px-2 py-3 text-right"
                    :title="t('common:enhancement.expectedResetsHelp', 'Expected failures from +1 or above that return to +0; failures at +0 are excluded.')"
                  >
                    {{ t("common:enhancement.expectedResets", "Expected resets") }}
                  </th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.actions", "Actions") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.time", "Time") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.xp", "XP") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.xpPerHour", "XP/h") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.materialCost", "Materials") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.goldCost", "Gold") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.protectionCount", "Protection") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.incrementalCost", "Incremental") }}</th>
                  <th class="px-2 py-3 text-right">{{ t("common:enhancement.totalInvestment", "Total") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in strategyRows"
                  :key="strategyKey(row, index)"
                  class="border-b border-white/5 transition hover:bg-white/[0.03]"
                  :class="{ 'bg-emerald-400/[0.05]': isRecommended(row, index) }"
                >
                  <td class="px-2 py-3">
                    <p class="font-semibold text-slate-100">{{ strategyLabel(row) }}</p>
                    <p class="mt-1 text-[11px] text-slate-500">{{ protectionItemLabel(row) }}</p>
                  </td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatNumber(rowValue(row, "expectedResetCount", "expectedResets", "resetCount")) }}</td>
                  <td class="px-2 py-3 text-right text-slate-200">{{ formatNumber(rowValue(row, "expectedActions", "actions")) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatDuration(rowValue(row, "expectedSeconds", "seconds", "timeSeconds")) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatNumber(rowValue(row, "expectedXp", "expectedExperience", "xp")) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatNumber(rowValue(row, "xpPerHour", "experiencePerHour")) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatGold(strategyMaterialCost(row)) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatGold(strategyCoinCost(row)) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatNumber(rowValue(row, "expectedProtectionCount", "expectedProtections", "protectionCount")) }}</td>
                  <td class="px-2 py-3 text-right text-slate-300">{{ formatGold(rowValue(row, "incrementalCost", "enhancementCost")) }}</td>
                  <td class="px-2 py-3 text-right font-semibold text-amber-200">{{ formatGold(rowValue(row, "totalInvestment", "totalCost")) }}</td>
                </tr>
                <tr v-if="strategyRows.length === 0">
                  <td colspan="11" class="px-2 py-8 text-center text-slate-500">{{ t("common:enhancement.noStrategies", "No strategies available for the current configuration.") }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div
          v-show="activeResultTab === 'mirror'"
          id="enhancement-results-mirror"
          class="grid gap-4 lg:grid-cols-2"
          role="tabpanel"
        >
          <div class="panel min-w-0" data-enhancement-mirror>
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs uppercase tracking-[0.14em] text-slate-500">{{ t("common:enhancement.fromZeroPlan", "Independent plan · Built from +0") }}</p>
                <h3 class="font-heading text-base font-semibold text-cyan-200">{{ t("common:enhancement.fromZeroPlanTitle", "Lowest-cost build plan") }}</h3>
              </div>
              <span class="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-200">{{ mirrorMethodLabel }}</span>
            </div>

            <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">{{ t("common:enhancement.planCost", "Plan cost") }}</dt>
                <dd class="mt-1 font-semibold text-slate-100">{{ formatGold(mirrorPlanCost) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">{{ t("common:enhancement.savings", "Savings") }}</dt>
                <dd class="mt-1 font-semibold text-emerald-300">{{ formatGold(mirrorSavings) }}</dd>
              </div>
            </dl>

            <div v-if="mirrorMaterials.length" class="mt-4 overflow-x-auto border-t border-white/10 pt-3">
              <table class="w-full min-w-[360px] text-xs">
                <thead class="text-left text-slate-500">
                  <tr><th class="pb-2">{{ t("common:enhancement.material", "Material") }}</th><th class="pb-2 text-right">{{ t("common:enhancement.quantity", "Quantity") }}</th><th class="pb-2 text-right">{{ t("common:enhancement.cost", "Cost") }}</th></tr>
                </thead>
                <tbody>
                  <tr
                    v-for="material in mirrorMaterials"
                    :key="`${material.type || 'item'}:${material.itemHrid || material.hrid || material.name || ''}:${material.level ?? ''}`"
                    class="border-t border-white/5"
                  >
                    <td class="py-2 text-slate-300">{{ mirrorMaterialLabel(material) }}</td>
                    <td class="py-2 text-right text-slate-300">{{ formatNumber(material.quantity ?? material.count) }}</td>
                    <td class="py-2 text-right text-slate-200">{{ formatGold(material.cost ?? material.totalCost) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="mt-4 text-xs text-slate-500">{{ t("common:enhancement.mirrorUnavailable", "Mirror plan is unavailable for this target.") }}</p>
          </div>

          <div class="panel" data-enhancement-decomposition>
            <div>
              <p class="text-xs uppercase tracking-[0.14em] text-slate-500">{{ t("common:enhancement.recovery", "Recovery") }}</p>
              <h3 class="font-heading text-base font-semibold text-rose-200">{{ t("common:enhancement.decomposition", "Decomposition value") }}</h3>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10">
              <div class="bg-slate-950/70 p-3">
                <p class="text-xs text-slate-500">{{ t("common:enhancement.essenceYield", "Essence yield") }}</p>
                <p class="mt-2 font-heading text-lg font-semibold text-slate-100">{{ formatNumber(decompositionQuantity) }}</p>
              </div>
              <div class="bg-slate-950/70 p-3">
                <p class="text-xs text-slate-500">{{ t("common:enhancement.bidValue", "Recovery value") }}</p>
                <p class="mt-2 font-heading text-lg font-semibold text-rose-200">{{ formatGold(decompositionGold) }}</p>
              </div>
            </div>
            <p class="mt-4 text-xs text-slate-500">{{ decompositionItemLabel }}</p>
          </div>
        </div>

        <div
          v-show="activeResultTab === 'risk'"
          id="enhancement-results-risk"
          class="panel overflow-hidden"
          role="tabpanel"
          data-enhancement-risk
        >
          <div>
            <div>
              <p class="text-xs uppercase tracking-[0.14em] text-slate-500">{{ t("common:enhancement.distribution", "Distribution") }}</p>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:enhancement.riskAnalysis", "Risk & budget analysis") }}</h3>
                <span v-if="riskMethodLabel" class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-400">{{ riskMethodLabel }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(180px,1.3fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_auto]" data-enhancement-risk-controls>
            <label>
              <span class="field-label">{{ t("common:enhancement.riskStrategy", "Risk strategy") }}</span>
              <select v-model="enhancement.config.riskStrategy" class="field-select">
                <option value="recommended">{{ t("common:enhancement.useRecommended", "Use recommendation") }}</option>
                <option v-for="(row, index) in strategyRows" :key="strategyKey(row, index)" :value="strategySelectionValue(row, index)">{{ strategyLabel(row) }}</option>
              </select>
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.budget", "Budget") }}</span>
              <div class="grid grid-cols-[minmax(0,1fr)_64px]">
                <input
                  :value="budgetInputAmount"
                  class="field-input !rounded-r-none"
                  :class="{ '!border-rose-400/60': !budgetInputValid }"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="any"
                  autocomplete="off"
                  data-enhancement-budget-input
                  :aria-invalid="budgetInputValid ? undefined : 'true'"
                  :placeholder="t('common:enhancement.budgetAmountPlaceholder', '10')"
                  @focus="budgetInputEditing = true"
                  @input="handleBudgetInput"
                  @blur="commitBudgetInput"
                  @keydown.enter.prevent="$event.currentTarget.blur()"
                />
                <select
                  :value="budgetUnit"
                  class="field-select !rounded-l-none !border-l-0 !px-2 text-center font-semibold"
                  data-enhancement-budget-unit
                  :aria-label="t('common:enhancement.budgetUnit', 'Budget unit')"
                  @change="handleBudgetUnit"
                >
                  <option v-for="unit in budgetUnits" :key="unit" :value="unit">{{ unit }}</option>
                </select>
              </div>
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.samples", "Samples") }}</span>
              <input v-model.number="enhancement.config.sampleCount" class="field-input" type="number" min="1024" max="1000000" step="1024" @change="normalizeRiskSampleCount" />
            </label>
            <label>
              <span class="field-label">{{ t("common:enhancement.seed", "Random seed") }}</span>
              <input v-model="enhancement.config.seed" class="field-input" type="text" autocomplete="off" spellcheck="false" />
            </label>
            <div class="flex items-end gap-2 sm:col-span-2 2xl:col-span-1">
              <button type="button" class="action-button-primary flex-1 whitespace-nowrap 2xl:flex-none" :disabled="!enhancement.config.itemHrid || enhancement.riskRunning || !budgetInputValid" @click="runRisk">
                {{ enhancement.riskRunning ? t("common:enhancement.running", "Running...") : t("common:enhancement.runRisk", "Run risk") }}
              </button>
              <button type="button" class="action-button-danger flex-1 whitespace-nowrap 2xl:flex-none" :disabled="!enhancement.riskRunning" @click="enhancement.cancelRisk()">
                {{ t("common:enhancement.cancel", "Cancel") }}
              </button>
            </div>
          </div>

          <div v-if="enhancement.riskRunning || riskProgressPercent > 0" class="mt-4" role="status" aria-live="polite">
            <div class="flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>{{ riskProgressLabel }}</span>
              <span>{{ riskProgressPercent }}%</span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-teal-400 transition-all duration-300" :style="{ width: `${riskProgressPercent}%` }"></div>
            </div>
          </div>

          <p v-if="riskErrorText" class="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200" role="alert">{{ riskErrorText }}</p>

          <div v-if="enhancement.risk" class="mt-4">
            <div class="overflow-x-auto rounded-lg border border-white/10" data-enhancement-risk-quantiles>
              <table class="w-full min-w-[1080px] text-xs">
                <thead>
                  <tr class="border-b border-white/10 text-left uppercase tracking-[0.1em] text-slate-500">
                    <th class="px-3 py-3">P</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.totalInvestment", "Total") }}</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.incrementalCost", "Incremental") }}</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.actions", "Actions") }}</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.time", "Time") }}</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.xp", "XP") }}</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.materialCost", "Materials") }}</th>
                    <th class="px-2 py-3 text-right">{{ t("common:enhancement.goldCost", "Gold") }}</th>
                    <th class="px-3 py-3 text-right">{{ t("common:enhancement.protectionCount", "Protection") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="quantile in riskQuantileRows" :key="quantile.key" class="border-b border-white/5 last:border-b-0">
                    <td class="px-3 py-3 font-semibold text-slate-200">{{ quantile.label }}</td>
                    <td class="px-2 py-3 text-right font-semibold text-amber-200">{{ formatGold(quantile.value) }}</td>
                    <td class="px-2 py-3 text-right text-slate-300">{{ formatGold(rowValue(quantile.record, "incrementalCost")) }}</td>
                    <td class="px-2 py-3 text-right text-slate-300">{{ formatNumber(rowValue(quantile.record, "actions")) }}</td>
                    <td class="px-2 py-3 text-right text-slate-300">{{ formatDuration(rowValue(quantile.record, "seconds")) }}</td>
                    <td class="px-2 py-3 text-right text-slate-300">{{ formatNumber(rowValue(quantile.record, "experience")) }}</td>
                    <td class="px-2 py-3 text-right text-slate-300">{{ formatGold(rowValue(quantile.record, "materialCost")) }}</td>
                    <td class="px-2 py-3 text-right text-slate-300">{{ formatGold(rowValue(quantile.record, "coinCost")) }}</td>
                    <td class="px-3 py-3 text-right text-slate-300">{{ formatNumber(rowValue(quantile.record, "protections")) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <div>
                <p class="text-xs text-slate-500">{{ t("common:enhancement.budgetSuccessProbability", "Success within budget") }}</p>
                <p class="mt-1 font-heading text-2xl font-semibold text-emerald-300">{{ formatPercent(riskBudgetProbability) }}</p>
              </div>
              <div class="text-right text-xs text-slate-500">
                <p>{{ riskSampleLabel }}</p>
                <p class="mt-1">{{ riskSeedLabel }}</p>
                <p v-if="riskLoadLabel" class="mt-1">{{ riskLoadLabel }}</p>
                <p v-if="riskFallbackLabel" class="mt-1 text-amber-300">{{ riskFallbackLabel }}</p>
              </div>
            </div>
          </div>
          <p v-else-if="!enhancement.riskRunning" class="mt-4 text-xs text-slate-500">{{ t("common:enhancement.noRiskResult", "Run risk analysis to calculate cost percentiles and budget probability.") }}</p>
        </div>
      </div>
    </div>

    <BaseModal
      :open="itemModalOpen"
      :title="t('common:enhancement.chooseItem', 'Choose an enhancement item')"
      panel-class="max-w-[94vw] lg:max-w-5xl"
      initial-focus-selector="[data-enhancement-item-search]"
      @close="itemModalOpen = false"
    >
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
        <label>
          <span class="field-label">{{ t("common:enhancement.search", "Search") }}</span>
          <input v-model.trim="enhancement.itemSearch" class="field-input" type="search" data-enhancement-item-search :placeholder="t('common:enhancement.searchPlaceholder', 'Search item name')" />
        </label>
        <label>
          <span class="field-label">{{ t("common:enhancement.equipmentType", "Equipment type") }}</span>
          <select v-model="enhancement.itemFilters.equipmentType" class="field-select">
            <option value="all">{{ t("common:enhancement.allEquipmentTypes", "All equipment types") }} · {{ itemOptions.length }}</option>
            <optgroup v-for="group in itemTypeGroups" :key="group.key" :label="group.label">
              <option v-for="type in group.types" :key="type.value" :value="type.value">{{ type.label }} · {{ type.count }}</option>
            </optgroup>
          </select>
        </label>
        <label class="flex min-h-10 items-center gap-2 self-end rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">
          <input v-model="enhancement.itemFilters.favoritesOnly" type="checkbox" />
          <span>{{ t("common:enhancement.favoritesOnly", "Favorites only") }}</span>
        </label>
      </div>

      <div v-if="favoriteItemOptions.length" class="mt-3 flex items-center gap-3 border-y border-white/10 py-2" data-enhancement-favorite-items>
        <span class="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{{ t("common:enhancement.favorites", "Favorites") }}</span>
        <div class="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5" role="group" :aria-label="t('common:enhancement.favorites', 'Favorites')">
          <button
            v-for="item in favoriteItemOptions"
            :key="item.hrid"
            type="button"
            class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-white/10 bg-slate-950/70 transition hover:border-amber-300/50 hover:bg-white/10"
            :aria-label="itemName(item)"
            :title="itemName(item)"
            @click="chooseItem(item.hrid)"
          >
            <svg v-if="itemIconVisible(item.hrid)" class="h-9 w-9 p-1" viewBox="0 0 50 50" aria-hidden="true">
              <use :href="itemIconHref(item.hrid)"></use>
            </svg>
            <span v-else class="text-sm font-semibold text-slate-400" aria-hidden="true">{{ itemIconFallback(item) }}</span>
          </button>
        </div>
      </div>

      <div class="mt-3 max-h-[58vh] overflow-y-auto border-y border-white/10" role="list" :aria-label="t('common:enhancement.items', 'Enhanceable items')">
        <div v-if="filteredItemOptions.length" class="grid grid-cols-3 gap-px bg-white/10 sm:grid-cols-5 lg:grid-cols-7">
          <div
            v-for="item in filteredItemOptions"
            :key="item.hrid"
            class="enhancement-item-row relative min-w-0 bg-slate-950/70 transition hover:bg-white/[0.06]"
            :class="{ 'bg-amber-300/[0.08] ring-1 ring-inset ring-amber-300/50': item.hrid === enhancement.config.itemHrid }"
            role="listitem"
          >
            <button
              type="button"
              class="flex h-[88px] w-full min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 focus-visible:bg-white/[0.06]"
              :aria-current="item.hrid === enhancement.config.itemHrid ? 'true' : undefined"
              :aria-label="itemName(item)"
              :title="itemName(item)"
              @click="chooseItem(item.hrid)"
            >
              <span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded bg-white/[0.03]" data-enhancement-item-icon>
                <svg v-if="itemIconVisible(item.hrid)" class="h-full w-full p-1.5" viewBox="0 0 50 50" aria-hidden="true">
                  <use :href="itemIconHref(item.hrid)"></use>
                </svg>
                <span v-else class="text-base font-semibold text-slate-500" aria-hidden="true">{{ itemIconFallback(item) }}</span>
              </span>
              <span class="w-full truncate text-center text-[11px] font-semibold text-slate-200">{{ itemName(item) }}</span>
            </button>
            <span v-if="item.itemLevel || item.level" class="pointer-events-none absolute left-1 top-1 rounded bg-slate-950/80 px-1 text-[9px] text-slate-500">Lv. {{ item.itemLevel || item.level }}</span>
            <button
              type="button"
              class="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded text-sm text-amber-300 transition hover:bg-white/10"
              :aria-label="favoriteButtonLabel(item.hrid)"
              :title="favoriteButtonLabel(item.hrid)"
              @click="enhancement.toggleFavorite(item.hrid)"
            >
              <span aria-hidden="true">{{ isFavorite(item.hrid) ? "★" : "☆" }}</span>
            </button>
          </div>
        </div>
        <p v-else class="px-3 py-10 text-center text-sm text-slate-500">{{ t("common:enhancement.noItems", "No matching items.") }}</p>
      </div>
      <p class="mt-2 text-right text-xs text-slate-500">{{ t("common:enhancement.itemCount", `${filteredItemOptions.length} items`, { count: filteredItemOptions.length }) }}</p>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BaseModal from "../components/BaseModal.vue";
import { useGameDataText } from "../composables/useGameDataText.js";
import { useI18nText } from "../composables/useI18nText.js";
import {
  convertAmountFromBaseUnits,
  convertAmountToBaseUnits,
  formatCompactAmount,
} from "../../services/amountFormatting.js";
import {
  ensureItemIconSymbols,
  hasItemIconSymbol,
  itemIconHref,
} from "../../services/itemIconSprite.js";
import { applyTampermonkeyEnhancementImportMessage } from "../../services/tampermonkeyImportBridge.js";
import { useEnhancementStore } from "../../stores/enhancementStore.js";

const TAMPERMONKEY_BRIDGE_CHANNEL = "mwi-tm-bridge";
const enhancement = useEnhancementStore();
const { language, t } = useI18nText();
const {
  getAchievementTierName,
  getBuffTypeName,
  getEquipmentTypeName,
  getHouseRoomName,
  getItemName: getGameItemName,
  getOfficialGameText,
  getSkillName,
} = useGameDataText();
const budgetUnits = Object.freeze(["K", "M", "B"]);
const itemModalOpen = ref(false);
const itemIconRevision = ref(0);
const equipmentModalOpen = ref(false);
const pricesModalOpen = ref(false);
const initializationError = ref("");
const priceRefreshPending = ref(false);
const advancedOpen = ref(true);
const activeAdvancedTab = ref("bonuses");
const activeResultTab = ref("strategies");
const budgetUnit = ref("M");
const budgetInputAmount = ref("");
const budgetInputValid = ref(true);
const budgetInputEditing = ref(false);
let itemIconLoadQueue = Promise.resolve(0);

watch(() => enhancement.config.budget, (value) => {
  if (!budgetInputEditing.value) {
    budgetInputAmount.value = formatBudgetInput(value);
  }
}, { immediate: true });

watch(() => enhancement.config.itemHrid, (itemHrid) => {
  if (itemHrid) void loadItemIcons([itemHrid]);
}, { immediate: true });

const equipmentSlots = computed(() => (enhancement.equipmentSlotKeys || []).map((key) => ({
  key,
  label: getEquipmentTypeName(
    `/equipment_types/${key}`,
    key.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
  ),
})));
const configuredEquipmentCount = computed(() => equipmentSlots.value.filter(
  (slot) => Boolean(enhancement.config.equipmentSlots?.[slot.key]?.itemHrid),
).length);

const fallbackTeaOptions = [
  { hrid: "/items/enhancing_tea", name: "Enhancing Tea" },
  { hrid: "/items/super_enhancing_tea", name: "Super Enhancing Tea" },
  { hrid: "/items/ultra_enhancing_tea", name: "Ultra Enhancing Tea" },
];

const itemTypeGroupDefinitions = [
  {
    key: "weapons",
    label: () => t("common:enhancement.itemTypeGroupWeapons", "Weapons"),
    types: ["main_hand", "two_hand", "off_hand"],
  },
  {
    key: "armor",
    label: () => t("common:enhancement.itemTypeGroupArmor", "Armor"),
    types: ["head", "body", "legs", "hands", "feet"],
  },
  {
    key: "accessories",
    label: () => t("common:enhancement.itemTypeGroupAccessories", "Accessories"),
    types: ["back", "neck", "earrings", "ring", "pouch", "trinket"],
  },
  {
    key: "charms",
    label: () => t("common:enhancement.itemTypeGroupCharms", "Charms"),
    types: ["charm"],
  },
  {
    key: "tools",
    label: () => t("common:enhancement.itemTypeGroupTools", "Production tools"),
    types: [
      "milking_tool",
      "foraging_tool",
      "woodcutting_tool",
      "cheesesmithing_tool",
      "crafting_tool",
      "tailoring_tool",
      "cooking_tool",
      "brewing_tool",
      "alchemy_tool",
      "enhancing_tool",
    ],
  },
];

const teaOptions = computed(() => {
  const storeOptions = enhancement.teaOptions;
  return Array.isArray(storeOptions) && storeOptions.length > 0 ? storeOptions : fallbackTeaOptions;
});
const itemOptions = computed(() => Array.isArray(enhancement.itemOptions) ? enhancement.itemOptions : []);
const favoriteItemOptions = computed(() => itemOptions.value.filter((item) => isFavorite(item.hrid)));
function officialItemName(item, targetLanguage) {
  const hrid = String(item?.hrid || item?.itemHrid || "");
  return getOfficialGameText("itemNames", hrid, hrid, { language: targetLanguage });
}
const filteredItemOptions = computed(() => {
  const query = String(enhancement.itemSearch || "").trim().toLowerCase();
  return itemOptions.value.filter((item) => {
    if (enhancement.itemFilters.equipmentType !== "all" && item.equipmentType !== enhancement.itemFilters.equipmentType) return false;
    if (enhancement.itemFilters.favoritesOnly && !isFavorite(item.hrid)) return false;
    return !query
      || officialItemName(item, "zh").toLowerCase().includes(query)
      || officialItemName(item, "en").toLowerCase().includes(query)
      || String(item.hrid || "").toLowerCase().includes(query);
  });
});
const materialRows = computed(() => Array.isArray(enhancement.materialRows) ? enhancement.materialRows : []);
const protectionOptions = computed(() => Array.isArray(enhancement.protectionOptions) ? enhancement.protectionOptions : []);
const hasAcquisitionEstimate = computed(() => (
  isAcquisitionEstimate(enhancement.startingItemPrice)
  || materialRows.value.some(isAcquisitionEstimate)
));
const strategyRows = computed(() => Array.isArray(enhancement.strategyRows) ? enhancement.strategyRows : []);
const mirrorPlan = computed(() => enhancement.mirrorPlan || null);
const decompositionValue = computed(() => enhancement.decompositionValue || null);
const markupPercent = computed({
  get: () => Number(enhancement.config.markupRate || 0) * 100,
  set: (value) => {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    enhancement.config.markupRate = percent / 100;
  },
});

const selectedItemName = computed(() => enhancement.config.itemHrid ? itemName(enhancement.selectedItem || { hrid: enhancement.config.itemHrid }) : t("common:enhancement.noItemSelected", "No item selected"));
const philosopherMirrorName = computed(() => getGameItemName("/items/philosophers_mirror", "Philosopher's Mirror"));
const enhancingSkillName = computed(() => getSkillName("/skills/enhancing", "Enhancing"));
const enhancingTeaLabel = computed(() => t("common:enhancement.enhancingTea", "{{skill}} tea", { skill: enhancingSkillName.value }));
const enhancingGearLabel = computed(() => t("common:enhancement.enhancingGear", "{{skill}} gear", { skill: enhancingSkillName.value }));
const mirrorAndDecompositionLabel = computed(() => t(
  "common:enhancement.mirrorAndDecomposition",
  "{{item}} & decomposition",
  { item: philosopherMirrorName.value },
));
const selectedItemType = computed(() => equipmentTypeName(enhancement.selectedItem?.equipmentType));
const selectedRouteLabel = computed(() => enhancement.config.itemHrid
  ? t("common:enhancement.routeLabel", "{{item}} · +{{start}} → +{{target}}", {
      item: selectedItemName.value,
      start: Number(enhancement.config.startLevel || 0),
      target: Number(enhancement.config.targetLevel || 1),
    })
  : t("common:enhancement.routeEmpty", "Select an enhanceable item to begin"));

const itemTypeGroups = computed(() => {
  language.value;
  const counts = new Map();
  for (const item of itemOptions.value) {
    const value = String(item?.equipmentType || "").trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }

  const included = new Set();
  const groups = itemTypeGroupDefinitions.map((group) => {
    const types = group.types
      .map((type) => `/equipment_types/${type}`)
      .filter((value) => counts.has(value))
      .map((value) => {
        included.add(value);
        return { value, label: equipmentTypeName(value), count: counts.get(value) };
      });
    return { key: group.key, label: group.label(), types };
  }).filter((group) => group.types.length > 0);

  const otherTypes = Array.from(counts.entries())
    .filter(([value]) => !included.has(value))
    .map(([value, count]) => ({ value, label: equipmentTypeName(value), count }))
    .sort((left, right) => left.label.localeCompare(right.label, language.value));
  if (otherTypes.length > 0) {
    groups.push({
      key: "other",
      label: t("common:enhancement.itemTypeGroupOther", "Other"),
      types: otherTypes,
    });
  }
  return groups;
});

const recommendedStrategy = computed(() => {
  const direct = enhancement.analysis?.recommendedStrategy || enhancement.analysis?.recommended || null;
  if (direct) return direct;
  return strategyRows.value.find((row) => row?.recommended || row?.isRecommended) || strategyRows.value[0] || null;
});
const analysisReady = computed(() => Boolean(recommendedStrategy.value || enhancement.analysis));
const recommendedStrategyLabel = computed(() => analysisReady.value
  ? strategyLabel(recommendedStrategy.value)
  : t("common:enhancement.awaitingConfiguration", "Awaiting configuration"));

const summaryMetrics = computed(() => {
  const row = recommendedStrategy.value || {};
  const totalValue = numericValue(enhancement.recommendedTotal, rowValue(row, "totalInvestment", "totalCost"));
  const materialValue = numericValue(enhancement.recommendedMaterial, strategyMaterialCost(row));
  const incrementalValue = rowValue(row, "incrementalCost", "enhancementCost");
  const actionsValue = rowValue(row, "expectedActions", "actions");
  const secondsValue = rowValue(row, "expectedSeconds", "seconds", "timeSeconds");
  const xpValue = rowValue(row, "expectedXp", "expectedExperience", "xp");
  return [
    { key: "total", label: t("common:enhancement.totalInvestment", "Total investment"), value: formatGold(totalValue), detail: t("common:enhancement.includesStartingItem", "Includes starting item & markup"), tone: "text-amber-200" },
    { key: "incremental", label: t("common:enhancement.incrementalCost", "Incremental cost"), value: formatGold(incrementalValue), detail: t("common:enhancement.materialDetail", "Materials {{value}}", { value: formatGold(materialValue) }), tone: "text-teal-200" },
    { key: "actions", label: t("common:enhancement.expectedActions", "Expected actions"), value: formatNumber(actionsValue), detail: formatDuration(secondsValue), tone: "text-slate-100" },
    { key: "xp", label: t("common:enhancement.expectedXp", "Expected XP"), value: formatNumber(xpValue), detail: t("common:enhancement.xpRateDetail", "{{value}} XP/h", { value: formatNumber(rowValue(row, "xpPerHour", "experiencePerHour")) }), tone: "text-emerald-300" },
  ];
});

const priceStatusText = computed(() => {
  const status = enhancement.priceStatus;
  if (priceRefreshPending.value || status?.loading) return t("common:enhancement.refreshing", "Refreshing...");
  if (status?.error) return t("common:enhancement.priceFallbackActive", "Market fallback active");
  if (status?.updatedAt || status?.ready || status === "ready") return t("common:enhancement.pricesReady", "Prices ready");
  return t("common:enhancement.vendorPrices", "Vendor prices");
});
const priceStatusClass = computed(() => enhancement.priceStatus?.error
  ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
  : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200");

const startingItemPriceValue = computed(() => numericValue(enhancement.startingItemPrice?.value, enhancement.startingItemPrice));
const startingItemPriceMissing = computed(() => Boolean(enhancement.startingItemPrice?.missing || (Number(enhancement.config.startLevel || 0) > 0 && !Number.isFinite(Number(startingItemPriceValue.value)))));
const startingItemPriceMissingText = computed(() => (
  String(enhancement.startingItemPrice?.source || "").toLowerCase() === "acquisition_missing"
    ? t("common:enhancement.acquisitionEstimateMissing", "Required key asks are missing, so an acquisition estimate cannot be calculated.")
    : t("common:enhancement.startingItemPriceMissing", "No direct market quote exists for this enhancement level.")
));

const mirrorMaterials = computed(() => {
  const rows = mirrorPlan.value?.materials || mirrorPlan.value?.materialRows || mirrorPlan.value?.requirements || [];
  return Array.isArray(rows) ? rows : Object.entries(rows || {}).map(([hrid, value]) => ({ hrid, ...(typeof value === "object" ? value : { quantity: value }) }));
});
const mirrorPlanCost = computed(() => rowValue(mirrorPlan.value, "totalCost", "cost", "planCost"));
const mirrorSavings = computed(() => rowValue(mirrorPlan.value, "savings", "savedCost"));
const mirrorMethodLabel = computed(() => {
  if (!mirrorPlan.value) return t("common:enhancement.unavailable", "Unavailable");
  return mirrorPlan.value.usesMirror || mirrorPlan.value.method === "mirror"
    ? t("common:enhancement.useMirror", "Uses {{item}}", { item: philosopherMirrorName.value })
    : t("common:enhancement.directEnhancement", "No {{item}}", { item: philosopherMirrorName.value });
});

const decompositionQuantity = computed(() => rowValue(decompositionValue.value, "quantity", "essenceQuantity", "essenceCount", "expectedEssence"));
const decompositionGold = computed(() => {
  if (!decompositionValue.value || decompositionValue.value.priceAvailable === false) return Number.NaN;
  return numericValue(decompositionValue.value, rowValue(decompositionValue.value, "value", "goldValue", "grossValue", "bidValue"));
});
const decompositionItemLabel = computed(() => {
  if (!decompositionValue.value) return t("common:enhancement.noItemSelected", "No item selected");
  const hrid = decompositionValue.value?.itemHrid || decompositionValue.value?.essenceItemHrid || "/items/enhancing_essence";
  return t("common:enhancement.decompositionPriceSource", "{{item}} price source: {{source}}", {
    item: itemName({ hrid, name: "Enhancing Essence" }),
    source: priceSourceLabel(decompositionValue.value?.priceSource),
  });
});

const riskProgressPercent = computed(() => {
  const progress = typeof enhancement.riskProgress === "object" ? enhancement.riskProgress?.progress ?? enhancement.riskProgress?.fraction : enhancement.riskProgress;
  const number = Number(progress || 0);
  const normalized = number > 1 ? number : number * 100;
  return Math.max(0, Math.min(100, Math.round(normalized)));
});
const riskProgressLabel = computed(() => enhancement.riskProgress?.label || enhancement.riskProgress?.phase || t("common:enhancement.simulating", "Simulating cost paths"));
const riskErrorText = computed(() => localizeRiskError(initializationError.value || enhancement.riskError?.message || enhancement.riskError || ""));
const riskMethodLabel = computed(() => {
  const method = enhancement.risk?.method;
  if (method === "monte_carlo") return t("common:enhancement.monteCarlo", "Monte Carlo");
  if (method === "moment_gamma") return t("common:enhancement.gammaApproximation", "Moment / Gamma approximation");
  return "";
});
const riskQuantileDefinitions = [
  { key: "p25", label: "P25", probability: 0.25 },
  { key: "p50", label: "P50", probability: 0.5 },
  { key: "p75", label: "P75", probability: 0.75 },
  { key: "p90", label: "P90", probability: 0.9 },
  { key: "p95", label: "P95", probability: 0.95 },
  { key: "p99", label: "P99", probability: 0.99 },
];
const riskQuantileRows = computed(() => riskQuantileDefinitions.map((definition) => {
  const record = riskQuantileRecord(definition);
  return { ...definition, record, value: rowValue(record, "totalCost", "totalInvestment", "cost", "value") };
}));
const riskBudgetProbability = computed(() => rowValue(enhancement.risk, "budgetProbability", "successWithinBudget", "budgetSuccessProbability"));
const riskSampleLabel = computed(() => t("common:enhancement.sampleCountLabel", "{{count}} samples", { count: formatNumber(enhancement.risk?.sampleCount ?? enhancement.risk?.samples ?? enhancement.config.sampleCount) }));
const riskSeedLabel = computed(() => t("common:enhancement.seedLabel", "Seed: {{seed}}", { seed: enhancement.risk?.seed ?? enhancement.config.seed ?? "-" }));
const riskLoadLabel = computed(() => {
  const estimated = Number(enhancement.risk?.estimatedTransitions);
  if (!Number.isFinite(estimated)) return "";
  return t("common:enhancement.estimatedTransitionsLabel", "{{count}} estimated transitions", { count: formatNumber(estimated) });
});
const riskFallbackLabel = computed(() => {
  if (enhancement.risk?.fallbackReason === "hard_transition_limit") {
    return t("common:enhancement.fallbackHardLimit", "Monte Carlo stopped at the transition limit");
  }
  if (enhancement.risk?.fallbackReason === "estimated_load") {
    return t("common:enhancement.fallbackEstimatedLoad", "Monte Carlo skipped for estimated load");
  }
  return "";
});

function postTampermonkeyImportResult(payload) {
  window.postMessage({
    channel: TAMPERMONKEY_BRIDGE_CHANNEL,
    ...payload,
  }, window.location.origin);
}

function handleTampermonkeyEnhancementImportWindowMessage(event) {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (
    data.channel !== TAMPERMONKEY_BRIDGE_CHANNEL
    || data.type !== "mwi-tm-import"
    || data.importTarget !== "enhancement"
  ) return;

  const requestId = String(data.requestId || "").trim();
  if (!requestId) return;

  try {
    const result = applyTampermonkeyEnhancementImportMessage(enhancement, data);
    postTampermonkeyImportResult({
      type: "mwi-tm-import-result",
      requestId,
      ok: true,
      detectedFormat: result.detectedFormat,
      message: result.message,
    });
  } catch (error) {
    postTampermonkeyImportResult({
      type: "mwi-tm-import-result",
      requestId,
      ok: false,
      message: error?.message || String(error),
    });
  }
}

onMounted(async () => {
  window.addEventListener("message", handleTampermonkeyEnhancementImportWindowMessage);
  try {
    await enhancement.initialize();
  } catch (error) {
    initializationError.value = error?.message || String(error);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleTampermonkeyEnhancementImportWindowMessage);
});

function openItemPicker() {
  itemModalOpen.value = true;
  void loadItemIcons(itemOptions.value.map((item) => item.hrid));
}

function openPricesModal() {
  pricesModalOpen.value = true;
  void loadItemIcons([
    enhancement.config.itemHrid,
    ...materialRows.value.map((row) => row.hrid),
  ]);
}

function loadItemIcons(hrids = []) {
  const requestedHrids = Array.from(new Set(hrids.map((hrid) => String(hrid || "")).filter(Boolean)));
  if (requestedHrids.length === 0) return itemIconLoadQueue;
  itemIconLoadQueue = itemIconLoadQueue
    .catch(() => 0)
    .then(() => ensureItemIconSymbols(requestedHrids))
    .then((count) => {
      itemIconRevision.value += 1;
      return count;
    })
    .catch(() => {
      itemIconRevision.value += 1;
      return 0;
    });
  return itemIconLoadQueue;
}

function chooseItem(hrid) {
  enhancement.selectItem(hrid);
  itemModalOpen.value = false;
}

function itemName(item) {
  const hrid = String(item?.hrid || item?.itemHrid || "");
  const fallback = item?.name || item?.displayName || hrid || t("common:enhancement.unknownItem", "Unknown item");
  if (!hrid) return fallback;
  return getGameItemName(hrid, fallback);
}

function achievementTierBonusLabel(tierHrid, fallbackName) {
  return t("common:enhancement.achievementTierBonus", "{{tier}} achievement bonus", {
    tier: getAchievementTierName(tierHrid, fallbackName),
  });
}

function itemIconVisible(hrid) {
  void itemIconRevision.value;
  return hasItemIconSymbol(hrid);
}

function itemIconFallback(item) {
  return Array.from(itemName(item).trim())[0]?.toUpperCase() || "?";
}

function equipmentTypeName(equipmentTypeHrid) {
  const hrid = String(equipmentTypeHrid || "").trim();
  if (!hrid) return "";
  const fallback = hrid.split("/").filter(Boolean).at(-1)
    ?.split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || hrid;
  return getEquipmentTypeName(hrid, fallback);
}

function isFavorite(hrid) {
  const favorites = enhancement.favorites;
  if (favorites instanceof Set) return favorites.has(hrid);
  if (Array.isArray(favorites)) return favorites.includes(hrid);
  return Boolean(favorites?.[hrid]);
}

function favoriteButtonLabel(hrid) {
  return isFavorite(hrid)
    ? t("common:enhancement.removeFavorite", "Remove favorite")
    : t("common:enhancement.addFavorite", "Add favorite");
}

function slotOptions(slotKey) {
  const options = enhancement.supportSlotOptions;
  if (Array.isArray(options)) return options.filter((item) => !item.slot || item.slot === slotKey || item.equipmentType === slotKey);
  return Array.isArray(options?.[slotKey]) ? options[slotKey] : [];
}

function equipmentField(slotKey, field) {
  return enhancement.config.equipmentSlots?.[slotKey]?.[field] ?? (field === "enhancementLevel" ? 0 : "");
}

function setEquipmentField(slotKey, field, value) {
  const normalizedValue = field === "enhancementLevel"
    ? Math.max(0, Math.min(20, Math.trunc(Number(value) || 0)))
    : value;
  if (typeof enhancement.setNestedConfig === "function") {
    enhancement.setNestedConfig(["equipmentSlots", slotKey, field], normalizedValue);
    return;
  }
  enhancement.config.equipmentSlots ||= {};
  enhancement.config.equipmentSlots[slotKey] ||= { itemHrid: "", enhancementLevel: 0 };
  enhancement.config.equipmentSlots[slotKey][field] = normalizedValue;
}

function numberFromEvent(event, fallback = 0) {
  const value = Number(event?.target?.value);
  return Number.isFinite(value) ? value : fallback;
}

function formatBudgetInput(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const amount = convertAmountFromBaseUnits(numeric, budgetUnit.value);
  return amount == null ? "" : String(amount);
}

function parseBudgetInput(value) {
  if (!String(value ?? "").trim()) return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return convertAmountToBaseUnits(numeric, budgetUnit.value);
}

function handleBudgetInput(event) {
  budgetInputEditing.value = true;
  budgetInputAmount.value = String(event?.target?.value ?? "");
  const parsed = parseBudgetInput(budgetInputAmount.value);
  budgetInputValid.value = parsed != null;
  if (parsed != null) enhancement.config.budget = parsed;
}

function commitBudgetInput() {
  const parsed = parseBudgetInput(budgetInputAmount.value);
  budgetInputEditing.value = false;
  if (parsed == null) {
    budgetInputAmount.value = formatBudgetInput(enhancement.config.budget);
    budgetInputValid.value = true;
    return;
  }
  enhancement.config.budget = parsed;
  budgetInputAmount.value = formatBudgetInput(parsed);
  budgetInputValid.value = true;
}

function handleBudgetUnit(event) {
  const nextUnit = String(event?.target?.value || "").toUpperCase();
  if (!budgetUnits.includes(nextUnit)) return;
  budgetUnit.value = nextUnit;
  const parsed = parseBudgetInput(budgetInputAmount.value);
  budgetInputValid.value = parsed != null;
  if (parsed != null) enhancement.config.budget = parsed;
}

function normalizeRiskSampleCount(event) {
  const rawValue = Number(event?.target?.value ?? enhancement.config.sampleCount);
  const sampleCount = Number.isFinite(rawValue) ? Math.trunc(rawValue) : 32768;
  enhancement.config.sampleCount = Math.max(1024, Math.min(1_000_000, sampleCount));
}

function setStartingItemPriceOverride(event) {
  const raw = String(event?.target?.value ?? "").trim();
  const value = raw === "" ? null : Math.max(0, Number(raw));
  const patch = { startingItemPriceOverride: Number.isFinite(value) ? value : null };
  if (typeof enhancement.patchConfig === "function") enhancement.patchConfig(patch);
  else Object.assign(enhancement.config, patch);
}

function materialOverrideValue(row) {
  const direct = row.overrideValue ?? row.priceOverride;
  if (direct != null) return direct;
  const entry = enhancement.config.priceOverrides?.[row.hrid];
  if (entry && typeof entry === "object") return entry[row.priceMode] ?? "";
  return entry ?? "";
}

function setMaterialOverride(row, event) {
  const raw = String(event?.target?.value ?? "").trim();
  enhancement.setMaterialOverride(row.hrid, raw === "" ? null : Math.max(0, Number(raw)), row.priceMode);
}

async function refreshPrices() {
  priceRefreshPending.value = true;
  try {
    await enhancement.refreshPrices();
  } finally {
    priceRefreshPending.value = false;
  }
}

async function runRisk() {
  initializationError.value = "";
  activeResultTab.value = "risk";
  try {
    await enhancement.runRisk();
  } catch (error) {
    initializationError.value = error?.message || String(error);
  }
}

function resetConfig() {
  budgetUnit.value = "M";
  budgetInputAmount.value = "";
  budgetInputValid.value = true;
  budgetInputEditing.value = false;
  enhancement.resetConfig();
  equipmentModalOpen.value = false;
  pricesModalOpen.value = false;
  advancedOpen.value = true;
  activeAdvancedTab.value = "bonuses";
  activeResultTab.value = "strategies";
}

function handleTabKeydown(event) {
  const supportedKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!supportedKeys.includes(event.key)) return;

  const tabList = event.currentTarget;
  const tabs = Array.from(tabList?.querySelectorAll?.('[role="tab"]') || []);
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex < 0 || tabs.length === 0) return;

  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else nextIndex = (currentIndex + 1) % tabs.length;

  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function rowValue(row, ...keys) {
  if (row == null) return Number.NaN;
  if (typeof row === "number") return row;
  for (const key of keys) {
    const value = row?.[key];
    if (value != null && value !== "") return value;
  }
  return Number.NaN;
}

function numericValue(value, fallback = Number.NaN) {
  if (value && typeof value === "object") return rowValue(value, "value", "cost", "totalCost", "amount");
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat(language.value === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits,
    notation: Math.abs(number) >= 1e9 ? "compact" : "standard",
  }).format(number);
}

function formatGold(value) {
  return formatAmount(value);
}

function formatAmount(value) {
  return formatCompactAmount(value, { locale: language.value === "zh" ? "zh-CN" : "en-US" });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const normalized = Math.abs(number) <= 1 ? number * 100 : number;
  return `${formatNumber(normalized, 2)}%`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return t("common:enhancement.secondsShort", "{{value}}s", { value: formatNumber(seconds, 1) });
  if (seconds < 3600) return t("common:enhancement.minutesShort", "{{value}}m", { value: formatNumber(seconds / 60, 1) });
  return t("common:enhancement.hoursShort", "{{value}}h", { value: formatNumber(seconds / 3600, 1) });
}

function strategyKey(row, index) {
  return row?.id || row?.strategyId || `${row?.protectionThreshold ?? "none"}-${index}`;
}

function strategySelectionValue(row, index) {
  return String(row?.id || row?.strategyId || (row?.protectionThreshold == null ? "none" : `protect-${row.protectionThreshold}`) || index);
}

function strategyLabel(row) {
  if (!row) return t("common:enhancement.noProtection", "No protection");
  const threshold = row.protectionThreshold ?? row.protectAt ?? row.threshold;
  if (row.noProtection || threshold == null || threshold === false) return t("common:enhancement.noProtection", "No protection");
  return t("common:enhancement.protectFrom", "Protect from +{{level}}", { level: Number(threshold) });
}

function strategyCoinCost(row) {
  const direct = rowValue(row, "goldCost", "coinCost", "expectedGold");
  if (Number.isFinite(Number(direct))) return direct;
  const perAction = Number(row?.coinPerAction);
  const expectedActions = Number(row?.expectedActions);
  return Number.isFinite(perAction) && Number.isFinite(expectedActions)
    ? perAction * expectedActions
    : Number.NaN;
}

function strategyMaterialCost(row) {
  if (row?.materialPricesAvailable === false) return Number.NaN;
  const direct = rowValue(row, "materialCost", "materialsCost");
  if (Number.isFinite(Number(direct))) return direct;
  const perAction = Number(row?.materialCostPerAction);
  const expectedActions = Number(row?.expectedActions);
  return Number.isFinite(perAction) && Number.isFinite(expectedActions)
    ? perAction * expectedActions
    : rowValue(row, "rawMaterialCost");
}

function localizeRiskError(value) {
  const message = String(value || "");
  const knownErrors = {
    "Select an enhanceable item before running risk analysis.": ["riskSelectItemError", "Select an enhanceable item before running risk analysis."],
    "A direct market quote or price override is required for the starting enhancement level.": ["riskStartingPriceError", "A direct market quote or price override is required for the starting enhancement level."],
    "A price is required for every enhancement material.": ["riskMaterialPriceError", "A price is required for every enhancement material."],
    "A priced protection item is required for cost analysis.": ["riskProtectionPriceError", "A priced protection item is required for cost analysis."],
  };
  const localized = knownErrors[message];
  return localized ? t(`common:enhancement.${localized[0]}`, localized[1]) : message;
}

function protectionItemLabel(row) {
  const item = row?.protectionItem || (row?.protectionItemHrid ? { hrid: row.protectionItemHrid, name: row.protectionItemName } : null);
  if (!item) return t("common:enhancement.noProtectionItem", "No protection item");
  const label = t("common:enhancement.protectionItemUsed", "Protection item: {{item}}", { item: itemName(item) });
  return isAcquisitionEstimate(item)
    ? `${label} · ${t("common:enhancement.sourceAcquisitionEstimate", "Acquisition estimate")}`
    : label;
}

function protectionOptionLabel(item) {
  const label = itemName(item);
  if (isAcquisitionEstimate(item)) {
    return t("common:enhancement.acquisitionEstimateOption", "{{item}} · estimate {{value}}", {
      item: label,
      value: formatAmount(item.price),
    });
  }
  if (String(item?.source || item?.priceSource || "").toLowerCase() === "acquisition_missing") {
    return t("common:enhancement.acquisitionMissingOption", "{{item}} · unavailable", { item: label });
  }
  return label;
}

function mirrorMaterialLabel(material) {
  if (material?.type === "direct" && Number.isFinite(Number(material.level))) {
    return t("common:enhancement.directItemAtLevel", "{{item}} +{{level}}", {
      item: itemName(material),
      level: Number(material.level),
    });
  }
  return itemName(material);
}

function isRecommended(row, index) {
  return Boolean(row?.recommended || row?.isRecommended || row === recommendedStrategy.value || (!recommendedStrategy.value && index === 0));
}

function priceSourceLabel(source) {
  const key = String(source || "").toLowerCase();
  if (key === "acquisition_estimate") return t("common:enhancement.sourceAcquisitionEstimate", "Acquisition estimate");
  if (key === "acquisition_missing") return t("common:enhancement.sourceAcquisitionMissing", "Non-tradable / unavailable");
  if (key.includes("override")) return t("common:enhancement.sourceOverride", "Override");
  if (key.includes("ask")) return t("common:enhancement.sourceAsk", "Ask");
  if (key.includes("bid")) return t("common:enhancement.sourceBid", "Bid fallback");
  if (key.includes("vendor")) return t("common:enhancement.sourceVendor", "Vendor fallback");
  if (key.includes("missing")) return t("common:enhancement.sourceMissing", "Missing");
  return t("common:enhancement.sourceMarket", "Market");
}

function isAcquisitionEstimate(value) {
  return String(value?.source || value?.priceSource || "").toLowerCase() === "acquisition_estimate"
    && value?.available !== false;
}

function isAcquisitionPriceRecord(value) {
  const source = String(value?.source || value?.priceSource || "").toLowerCase();
  return source === "acquisition_estimate" || source === "acquisition_missing";
}

function priceDetailLabel(value) {
  if (isAcquisitionEstimate(value)) {
    return t("common:enhancement.acquisitionEstimateSummary", "Non-tradable · estimate {{value}} · avg. {{count}} chests", {
      value: formatAmount(value?.price),
      count: formatNumber(value?.expectedContainers),
    });
  }
  return priceSourceLabel(value?.source || value?.priceSource);
}

function acquisitionVendorFloorLabel(value) {
  return t("common:enhancement.vendorRecovery", "Vendor recovery {{value}}", {
    value: formatAmount(value?.vendorFloor),
  });
}

function riskQuantileRecord(definition) {
  const quantiles = enhancement.risk?.quantiles || enhancement.risk?.percentiles || {};
  const value = quantiles[definition.key]
    ?? quantiles[definition.label]
    ?? quantiles[String(definition.probability * 100)]
    ?? quantiles[definition.probability]
    ?? quantiles[String(definition.probability)]
    ?? Number.NaN;
  return value && typeof value === "object" ? value : { totalCost: value };
}
</script>
