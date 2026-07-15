<template>
  <section class="space-y-4" data-skilling-page>
    <div class="panel overflow-hidden !px-4 !py-3" data-skilling-toolbar>
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <div class="flex shrink-0 items-baseline gap-2">
            <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-300/80">{{ t("common:skilling.eyebrow", "Production Ledger") }}</p>
            <h2 class="font-heading text-lg font-semibold text-slate-100">{{ t("common:skilling.title", "Skilling Upgrade Planner") }}</h2>
          </div>
          <span class="hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true"></span>
          <div v-if="skilling.profile" class="min-w-0 text-xs text-slate-400">
            <span class="font-semibold text-slate-200">{{ skilling.profile.characterName || t("common:skilling.profile", "Character") }}</span>
            <span class="ml-2">{{ snapshotLabel }}</span>
          </div>
          <span v-else class="text-xs text-slate-500">{{ t("common:skilling.noProfile", "No current-character skilling snapshot") }}</span>
        </div>

        <div class="flex flex-wrap items-center gap-2" data-tm-import-anchor="skilling-actions">
          <span class="rounded border px-2 py-1 text-[11px]" :class="priceStatusClass">{{ priceStatusText }}</span>
          <button type="button" class="action-button-muted !px-3 !py-1.5" :disabled="skilling.running" @click="openPricesModal">
            {{ t("common:skilling.priceDetails", "Price details") }}
          </button>
          <button
            type="button"
            class="action-button-muted !px-3 !py-1.5"
            data-tm-import-reference="skilling-refresh"
            :disabled="skilling.priceStatus.loading || skilling.running"
            @click="refreshPrices"
          >
            {{ skilling.priceStatus.loading ? t("common:skilling.refreshing", "Refreshing...") : t("common:skilling.refreshPrices", "Refresh prices") }}
          </button>
          <button
            type="button"
            :class="skilling.running ? 'action-button-danger !px-3 !py-1.5' : 'action-button-primary !px-3 !py-1.5'"
            :disabled="!skilling.running && (!skilling.profile || skilling.priceStatus.loading)"
            @click="handlePlannerAction"
          >
            {{ skilling.running ? t("common:skilling.cancel", "Cancel") : t("common:skilling.calculate", "Calculate routes") }}
          </button>
        </div>
      </div>

      <div
        v-if="skilling.running"
        class="mt-3"
        data-skilling-progress
        role="progressbar"
        aria-live="polite"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="progressLabel"
        :aria-valuenow="progressPercent"
      >
        <div class="mb-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>{{ progressLabel }}</span>
          <span>{{ progressPercent }}%</span>
        </div>
        <div class="h-1.5 overflow-hidden rounded bg-slate-800">
          <div class="h-full bg-teal-400 transition-[width] motion-reduce:transition-none" :style="{ width: `${progressPercent}%` }"></div>
        </div>
      </div>
    </div>

    <div v-if="skilling.resultStale || snapshotIsOld || expiredBuffWarningCount > 0 || skilling.error" class="grid gap-2 sm:grid-cols-2" data-skilling-warnings aria-live="polite">
      <p v-if="skilling.resultStale" class="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
        {{ t("common:skilling.stale", "Results are stale because targets, prices, or the character snapshot changed.") }}
      </p>
      <p v-if="snapshotIsOld" class="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
        {{ t("common:skilling.oldSnapshotWarning", "This character snapshot is more than 30 minutes old.") }}
      </p>
      <p v-if="expiredBuffWarningCount > 0" class="rounded border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-200">
        {{ expiredBuffWarningText }}
      </p>
      <p v-if="skilling.error" class="rounded border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-200" role="alert">{{ skilling.error }}</p>
    </div>

    <div v-if="!skilling.profile" class="panel flex min-h-48 items-center justify-center" data-skilling-empty-profile>
      <p class="font-heading text-sm font-semibold text-slate-500">{{ t("common:skilling.noProfile", "No current-character skilling snapshot") }}</p>
    </div>

    <template v-else>
      <div class="panel overflow-hidden !p-0" data-skilling-targets>
        <div class="grid sm:grid-cols-2 xl:grid-cols-5">
          <label
            v-for="skillHrid in skillHrids"
            :key="skillHrid"
            class="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-3 border-b border-white/10 px-4 py-3 sm:border-r xl:border-b-0 xl:last:border-r-0"
          >
            <span class="min-w-0">
              <span class="block truncate text-xs font-semibold text-slate-200">{{ skillName(skillHrid) }}</span>
              <span class="mt-0.5 block text-[11px] text-slate-500">{{ t("common:skilling.current", "Current") }} {{ currentLevel(skillHrid) }}</span>
            </span>
            <input
              class="field-input !rounded !px-2 !py-1.5 text-right text-xs"
              type="number"
              :aria-label="`${skillName(skillHrid)} ${t('common:skilling.targetLevel', 'Target level')}`"
              :min="currentLevel(skillHrid)"
              max="200"
              step="1"
              :disabled="skilling.running"
              :value="skilling.targetLevels[skillHrid]"
              @change="setTarget(skillHrid, $event)"
            />
          </label>
        </div>
      </div>

      <div
        class="grid grid-cols-3 overflow-hidden rounded border border-white/10 bg-slate-950/30 sm:grid-cols-6"
        role="tablist"
        :aria-label="t('common:skilling.title', 'Skilling Upgrade Planner')"
        data-skilling-tabs
        @keydown="handleTabKeydown"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :id="tabId(tab.id)"
          type="button"
          class="min-h-10 border-b-2 px-2 py-2 text-xs font-semibold transition"
          :class="skilling.selectedView === tab.id ? 'border-teal-300 bg-teal-300/10 text-teal-200' : 'border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'"
          role="tab"
          :aria-controls="panelId(tab.id)"
          :aria-selected="skilling.selectedView === tab.id"
          :tabindex="skilling.selectedView === tab.id ? 0 : -1"
          @click="selectView(tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div
        v-if="skilling.selectedView === 'overview'"
        :id="panelId('overview')"
        class="panel !p-0"
        data-skilling-overview
        role="tabpanel"
        :aria-labelledby="tabId('overview')"
        tabindex="0"
      >
        <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h3 class="font-heading text-sm font-semibold text-amber-200">{{ t("common:skilling.overview", "Overview") }}</h3>
          <span v-if="skilling.result" class="text-[11px] text-slate-500">{{ resultGeneratedLabel }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-[980px] w-full text-left text-xs">
            <thead class="bg-slate-950/30 text-[10px] uppercase text-slate-500">
              <tr>
                <th class="px-4 py-2">{{ t("common:skilling.rank", "Rank") }}</th>
                <th class="px-3 py-2">{{ t("common:skilling.skill", "Skill") }}</th>
                <th class="px-3 py-2">{{ t("common:skilling.current", "Current") }} -> {{ t("common:skilling.target", "Target") }}</th>
                <th class="px-3 py-2">{{ t("common:skilling.route", "First route") }}</th>
                <th class="px-3 py-2 text-right">{{ t("common:skilling.costPerXp", "Net cost / XP") }}</th>
                <th class="px-3 py-2 text-right">{{ t("common:skilling.totalCost", "Net cost") }}</th>
                <th class="px-3 py-2 text-right">{{ t("common:skilling.purchaseCost", "Market purchases") }}</th>
                <th class="px-3 py-2 text-right">{{ t("common:skilling.duration", "Time") }}</th>
                <th class="px-3 py-2 text-right">{{ t("common:skilling.xpPerHour", "XP/h") }}</th>
                <th class="px-4 py-2 text-right">{{ t("common:skilling.status", "Status") }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/10">
              <tr v-for="row in overviewRows" :key="row.skillHrid" class="hover:bg-white/[0.025]">
                <td class="px-4 py-3 font-semibold text-amber-300">{{ row.rank || "-" }}</td>
                <td class="px-3 py-3">
                  <button type="button" class="font-semibold text-slate-100 hover:text-teal-200" @click="selectView(row.skillHrid, true)">{{ skillName(row.skillHrid) }}</button>
                </td>
                <td class="px-3 py-3 tabular-nums text-slate-300">{{ currentLevel(row.skillHrid) }} -> {{ skilling.targetLevels[row.skillHrid] }}</td>
                <td class="max-w-[220px] truncate px-3 py-3 text-slate-300">{{ row.plan?.segments?.[0] ? actionName(row.plan.segments[0]) : "-" }}</td>
                <td class="px-3 py-3 text-right tabular-nums" :class="amountClass(row.plan?.costPerExperience)">{{ formatAmount(row.plan?.costPerExperience) }}</td>
                <td class="px-3 py-3 text-right tabular-nums" :class="amountClass(row.plan?.totalNetCost)">{{ formatAmount(row.plan?.totalNetCost) }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-slate-300">{{ formatAmount(row.plan?.totalPurchaseCost) }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-slate-300">{{ formatDuration(row.plan?.totalDurationHours) }}</td>
                <td class="px-3 py-3 text-right tabular-nums text-slate-300">{{ formatAmount(row.plan?.experiencePerHour) }}</td>
                <td class="px-4 py-3 text-right"><span class="rounded border px-2 py-1 text-[10px]" :class="planStatusClass(row.plan)">{{ planStatusText(row.plan) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        v-else
        :id="panelId(selectedSkillHrid)"
        class="space-y-4"
        data-skilling-detail
        role="tabpanel"
        :aria-labelledby="tabId(selectedSkillHrid)"
        tabindex="0"
      >
        <div class="panel !p-0">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div>
              <p class="text-[10px] uppercase text-slate-500">{{ currentLevel(selectedSkillHrid) }} -> {{ skilling.targetLevels[selectedSkillHrid] }}</p>
              <h3 class="font-heading text-base font-semibold text-amber-200">{{ skillName(selectedSkillHrid) }}</h3>
            </div>
            <span v-if="selectedPlan?.status === 'blocked'" class="text-xs text-rose-300">{{ missingPriceLabel(selectedPlan) }}</span>
          </div>

          <div v-if="selectedPlan" class="grid grid-cols-2 border-b border-white/10 sm:grid-cols-3 xl:grid-cols-6">
            <div v-for="metric in selectedMetrics" :key="metric.label" class="border-r border-white/10 px-4 py-3 last:border-r-0">
              <p class="text-[10px] uppercase text-slate-500">{{ metric.label }}</p>
              <p class="mt-1 truncate text-sm font-semibold tabular-nums" :class="metric.className">{{ metric.value }}</p>
            </div>
          </div>

          <div v-if="!selectedPlan" class="flex min-h-44 items-center justify-center text-sm text-slate-500">
            {{ t("common:skilling.awaiting", "Awaiting calculation") }}
          </div>
          <div v-else-if="selectedPlan.segments?.length" class="overflow-x-auto" data-skilling-routes>
            <table class="min-w-[1280px] w-full text-left text-xs">
              <thead class="bg-slate-950/30 text-[10px] uppercase text-slate-500">
                <tr>
                  <th class="px-4 py-2">{{ t("common:skilling.levelRange", "Levels") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.recipe", "Recipe") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.actions", "Actions") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.drinks", "Drinks") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.equipment", "Equipment") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.shortage", "Purchase shortage") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.outputs", "Expected output") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.netCost", "Net cost") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.xpPerHour", "XP/h") }}</th>
                  <th class="px-4 py-2 text-right">{{ t("common:skilling.details", "Details") }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/10">
                <tr v-for="segment in selectedPlan.segments" :key="`${segment.fromLevel}-${segment.toLevel}-${segment.actionHrid}-${segment.bonusSignature}`" class="align-top hover:bg-white/[0.025]">
                  <td class="px-4 py-3 font-semibold tabular-nums text-amber-200">{{ segment.fromLevel }} -> {{ segment.toLevel }}</td>
                  <td class="max-w-[210px] px-3 py-3 font-semibold text-slate-100">{{ actionName(segment) }}</td>
                  <td class="px-3 py-3 text-right tabular-nums text-slate-300">{{ formatCount(segment.completionCount) }}</td>
                  <td class="max-w-[200px] px-3 py-3 text-slate-400">{{ drinkSummary(segment) }}</td>
                  <td class="max-w-[240px] px-3 py-3 text-slate-400">{{ equipmentSummary(segment) }}</td>
                  <td class="max-w-[220px] px-3 py-3 text-slate-400">{{ shortageSummary(segment) }}</td>
                  <td class="max-w-[220px] px-3 py-3 text-slate-400">{{ outputSummary(segment) }}</td>
                  <td class="px-3 py-3 text-right font-semibold tabular-nums" :class="amountClass(segment.netCost)">{{ formatAmount(segment.netCost) }}</td>
                  <td class="px-3 py-3 text-right tabular-nums text-slate-300">{{ formatAmount(segment.experiencePerHour) }}</td>
                  <td class="px-4 py-3 text-right"><button type="button" class="action-button-muted !rounded !px-2 !py-1 text-[11px]" @click="openSegment(segment)">{{ t("common:skilling.details", "Details") }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="flex min-h-32 items-center justify-center px-4 text-sm text-slate-500">{{ planStatusText(selectedPlan) }}</div>
        </div>

        <div v-if="selectedPlan?.alternatives?.length" class="panel !p-0" data-skilling-alternatives>
          <div class="border-b border-white/10 px-4 py-3"><h3 class="font-heading text-sm font-semibold text-teal-200">{{ t("common:skilling.firstLevelAlternatives", "First-level plan comparison") }}</h3></div>
          <div class="overflow-x-auto">
            <table class="min-w-[1200px] w-full text-left text-xs">
              <thead class="bg-slate-950/30 text-[10px] uppercase text-slate-500">
                <tr>
                  <th class="px-4 py-2">#</th>
                  <th class="px-3 py-2">{{ t("common:skilling.recipe", "Recipe") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.actions", "Actions") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.drinks", "Drinks") }}</th>
                  <th class="px-3 py-2">{{ t("common:skilling.equipment", "Equipment") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.costPerXp", "Net cost / XP") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.purchaseCost", "Market purchases") }}</th>
                  <th class="px-3 py-2 text-right">{{ t("common:skilling.xpPerHour", "XP/h") }}</th>
                  <th class="px-4 py-2 text-right">{{ t("common:skilling.details", "Details") }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/10">
                <tr v-for="(candidate, index) in selectedPlan.alternatives.slice(0, 8)" :key="`${candidate.actionHrid}-${index}`" class="align-top hover:bg-white/[0.025]">
                  <td class="px-4 py-2 text-amber-300">{{ index + 1 }}</td>
                  <td class="max-w-[190px] px-3 py-2 font-medium text-slate-200">{{ actionName(candidate) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-slate-300">{{ formatCount(candidate.completionCount) }}</td>
                  <td class="max-w-[190px] px-3 py-2 text-slate-400">{{ drinkSummary(candidate) }}</td>
                  <td class="max-w-[260px] px-3 py-2 text-slate-400">{{ equipmentSummary(candidate) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums" :class="amountClass(candidate.costPerExperience)">{{ formatAmount(candidate.costPerExperience) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-slate-400">{{ formatAmount(candidate.purchaseCost) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-slate-400">{{ formatAmount(candidate.experiencePerHour) }}</td>
                  <td class="px-4 py-2 text-right"><button type="button" class="action-button-muted !rounded !px-2 !py-1 text-[11px]" @click="openSegment(candidate)">{{ t("common:skilling.details", "Details") }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <BaseModal :open="segmentModalOpen" :title="t('common:skilling.routeDetails', 'Route details')" panel-class="enhancement-price-modal max-w-5xl max-h-[88vh] overflow-y-auto" @close="segmentModalOpen = false">
      <template v-if="activeSegment">
        <div class="grid grid-cols-2 border-y border-white/10 sm:grid-cols-4">
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-slate-500">{{ t("common:skilling.recipe", "Recipe") }}</p><p class="mt-1 font-semibold text-slate-100">{{ actionName(activeSegment) }}</p></div>
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-slate-500">{{ t("common:skilling.actions", "Actions") }}</p><p class="mt-1 tabular-nums text-slate-200">{{ formatCount(activeSegment.completionCount) }}</p></div>
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-slate-500">{{ t("common:skilling.duration", "Time") }}</p><p class="mt-1 tabular-nums text-slate-200">{{ formatDuration(activeSegment.durationHours) }}</p></div>
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-slate-500">{{ t("common:skilling.netCost", "Net cost") }}</p><p class="mt-1 font-semibold tabular-nums" :class="amountClass(activeSegment.netCost)">{{ formatAmount(activeSegment.netCost) }}</p></div>
        </div>

        <section class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-amber-200">{{ t("common:skilling.equipment", "Equipment") }}</h3>
          <div v-if="activeSegment.equipment?.length" class="grid border-y border-white/10 sm:grid-cols-2">
            <div v-for="item in activeSegment.equipment" :key="`${item.equipmentType}-${item.id}`" class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/[0.04] ring-1 ring-white/10">
                <svg v-if="itemIconVisible(item.itemHrid)" class="h-full w-full p-1" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(item.itemHrid)"></use></svg>
                <span v-else class="text-xs text-slate-500">{{ itemFallback(item.itemHrid) }}</span>
              </span>
              <span class="min-w-0 flex-1 truncate text-slate-200">{{ itemName(item.itemHrid) }}</span>
              <span class="text-xs text-amber-300">{{ enhancementLevelLabel(item.enhancementLevel) }}</span>
            </div>
          </div>
          <p v-else class="text-slate-500">{{ t("common:skilling.noEquipment", "None") }}</p>
        </section>

        <section class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-teal-200">{{ t("common:skilling.inputMaterials", "Input ledger") }}</h3>
          <div class="overflow-x-auto"><table class="min-w-[760px] w-full text-left text-xs"><thead class="border-y border-white/10 text-[10px] uppercase text-slate-500"><tr><th class="px-3 py-2">{{ t("common:skilling.item", "Item") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.actions", "Actions") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.owned", "From inventory") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.purchase", "Purchase") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.opportunityUnit", "Opportunity unit") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.ask", "Ask") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.value", "Value") }}</th></tr></thead><tbody class="divide-y divide-white/10"><tr v-for="row in activeSegment.inputItems" :key="`${row.itemHrid}-${row.enhancementLevel || 0}`"><td class="px-3 py-2"><span class="flex items-center gap-2"><svg v-if="itemIconVisible(row.itemHrid)" class="h-7 w-7" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(row.itemHrid)"></use></svg><span>{{ itemName(row.itemHrid) }}<template v-if="row.enhancementLevel > 0"> +{{ row.enhancementLevel }}</template></span></span></td><td class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.count) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.ownedCount) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.purchaseCount) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatAmount(row.opportunityUnitPrice) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatAmount(row.purchaseUnitPrice) }}</td><td class="px-3 py-2 text-right tabular-nums text-amber-200">{{ formatAmount(Number(row.opportunityCost || 0) + Number(row.purchaseCost || 0)) }}</td></tr></tbody></table></div>
        </section>

        <section class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-teal-200">{{ t("common:skilling.outputMaterials", "Output ledger") }}</h3>
          <div class="overflow-x-auto"><table class="min-w-[560px] w-full text-left text-xs"><thead class="border-y border-white/10 text-[10px] uppercase text-slate-500"><tr><th class="px-3 py-2">{{ t("common:skilling.item", "Item") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.actions", "Actions") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.recoveryUnit", "Recovery unit") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.value", "Value") }}</th></tr></thead><tbody class="divide-y divide-white/10"><tr v-for="row in activeSegment.outputItems" :key="`${row.itemHrid}-${row.enhancementLevel || 0}`"><td class="px-3 py-2"><span class="flex items-center gap-2"><svg v-if="itemIconVisible(row.itemHrid)" class="h-7 w-7" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(row.itemHrid)"></use></svg><span>{{ itemName(row.itemHrid) }}<template v-if="row.enhancementLevel > 0"> +{{ row.enhancementLevel }}</template></span></span></td><td class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.count) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatAmount(row.liquidationUnitPrice) }}</td><td class="px-3 py-2 text-right tabular-nums text-teal-200">{{ formatAmount(row.liquidationValue) }}</td></tr></tbody></table></div>
        </section>
      </template>
    </BaseModal>

    <BaseModal :open="pricesModalOpen" :title="t('common:skilling.marketPrices', 'Market prices and overrides')" panel-class="enhancement-price-modal max-w-6xl max-h-[88vh] overflow-y-auto" initial-focus-selector="[data-skilling-price-input]" @close="pricesModalOpen = false">
      <div v-if="priceRows.length" class="overflow-x-auto" data-skilling-prices>
        <table class="min-w-[980px] w-full text-left text-xs">
          <thead class="border-y border-white/10 text-[10px] uppercase text-slate-500"><tr><th class="px-3 py-2">{{ t("common:skilling.item", "Item") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.marketAsk", "Market ask") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.marketBid", "Market bid") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.vendor", "Vendor") }}</th><th class="px-3 py-2">{{ t("common:skilling.overrideAsk", "Override ask") }}</th><th class="px-3 py-2">{{ t("common:skilling.overrideBid", "Override bid") }}</th><th class="px-3 py-2 text-right">{{ t("common:skilling.clear", "Clear") }}</th></tr></thead>
          <tbody class="divide-y divide-white/10">
            <tr v-for="row in priceRows" :key="row.priceKey">
              <th scope="row" class="px-3 py-2 text-left"><span class="flex items-center gap-2"><svg v-if="itemIconVisible(row.itemHrid)" class="h-8 w-8" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(row.itemHrid)"></use></svg><span class="font-semibold text-slate-200">{{ itemName(row.itemHrid) }}<template v-if="row.enhancementLevel > 0"> +{{ row.enhancementLevel }}</template></span></span></th>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatPrice(row.marketAsk) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatPrice(row.marketBid) }}</td><td class="px-3 py-2 text-right tabular-nums">{{ formatPrice(row.vendor) }}</td>
              <td class="px-3 py-2"><input :data-skilling-price-input="row.overrideDisabled ? null : ''" class="field-input !rounded !px-2 !py-1.5 text-xs" type="number" min="0" step="any" :aria-label="priceOverrideAriaLabel(row, 'ask')" :disabled="row.overrideDisabled" :value="overrideValue(row, 'ask')" @change="setPriceOverride(row.itemHrid, 'ask', $event)" /></td>
              <td class="px-3 py-2"><input class="field-input !rounded !px-2 !py-1.5 text-xs" type="number" min="0" step="any" :aria-label="priceOverrideAriaLabel(row, 'bid')" :disabled="row.overrideDisabled" :value="overrideValue(row, 'bid')" @change="setPriceOverride(row.itemHrid, 'bid', $event)" /></td>
              <td class="px-3 py-2 text-right"><button type="button" class="action-button-muted !rounded !px-2 !py-1 text-[11px]" :aria-label="priceClearAriaLabel(row)" :disabled="row.overrideDisabled" @click="skilling.resetPriceOverride(row.itemHrid)">{{ t("common:skilling.clear", "Clear") }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="py-8 text-center text-sm text-slate-500">{{ t("common:skilling.noPriceRows", "No route price rows yet.") }}</p>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BaseModal from "../components/BaseModal.vue";
import { useI18nText } from "../composables/useI18nText.js";
import { useGameDataText } from "../composables/useGameDataText.js";
import { itemDetailIndex } from "../../shared/gameDataIndex.js";
import { ensureItemIconSymbols, hasItemIconSymbol, itemIconHref } from "../../services/itemIconSprite.js";
import { formatCompactAmount } from "../../services/amountFormatting.js";
import { applyTampermonkeySkillingImportMessage } from "../../services/tampermonkeyImportBridge.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useSkillingStore } from "../../stores/skillingStore.js";

const TAMPERMONKEY_BRIDGE_CHANNEL = "mwi-tm-bridge";
const SNAPSHOT_WARNING_MS = 30 * 60 * 1000;
const skilling = useSkillingStore();
const simulator = useSimulatorStore();
const { language, t } = useI18nText();
const { getActionName, getItemName, getSkillName } = useGameDataText();
const pricesModalOpen = ref(false);
const segmentModalOpen = ref(false);
const activeSegment = ref(null);
const itemIconRevision = ref(0);
const clockNow = ref(Date.now());
let itemIconLoadQueue = Promise.resolve(0);
let clockInterval = null;

const skillHrids = computed(() => skilling.skillHrids);
const tabs = computed(() => [
  { id: "overview", label: t("common:skilling.overview", "Overview") },
  ...skillHrids.value.map((skillHrid) => ({ id: skillHrid, label: skillName(skillHrid) })),
]);
const selectedSkillHrid = computed(() => skillHrids.value.includes(skilling.selectedView) ? skilling.selectedView : skillHrids.value[0]);
const selectedPlan = computed(() => skilling.plansBySkill[selectedSkillHrid.value] || null);
const progressPercent = computed(() => Math.max(0, Math.min(100, Math.round(Number(skilling.progress?.overallProgress || 0) * 100))));
const progressLabel = computed(() => t("common:skilling.progress", "Planning {{skill}}: {{percent}}%", {
  skill: skillName(skilling.progress?.skillHrid || selectedSkillHrid.value),
  percent: progressPercent.value,
}));
const snapshotIsOld = computed(() => skilling.profile?.importedAt
  ? clockNow.value - Number(skilling.profile.importedAt) > SNAPSHOT_WARNING_MS
  : false);
const snapshotLabel = computed(() => t("common:skilling.imported", "Snapshot {{time}}", {
  time: formatDate(skilling.profile?.importedAt),
}));
const expiredBuffWarningText = computed(() => t(
  "common:skilling.expiredBuffWarning",
  "{{count}} temporary Buff(s) expired and were excluded.",
  { count: expiredBuffWarningCount.value },
));
const temporaryBuffExpirations = computed(() => {
  const expirations = [];
  for (const sourceMap of Object.values(skilling.profile?.buffsBySource || {})) {
    for (const buffs of Object.values(sourceMap || {})) {
      for (const buff of Array.isArray(buffs) ? buffs : []) {
        const durationMs = Math.max(0, Number(buff?.duration || 0)) / 1_000_000;
        const startAt = Date.parse(String(buff?.startTime || ""));
        if (durationMs > 0 && Number.isFinite(startAt) && new Date(startAt).getUTCFullYear() >= 2000) {
          expirations.push(startAt + durationMs);
        }
      }
    }
  }
  return expirations;
});
const expiredProfileBuffCount = computed(() => temporaryBuffExpirations.value.filter((expiresAt) => expiresAt <= clockNow.value).length);
const expiredBuffWarningCount = computed(() => Math.max(Number(skilling.expiredBuffCount || 0), expiredProfileBuffCount.value));
const buffExpiredSinceResult = computed(() => {
  const generatedAt = Number(skilling.result?.generatedAt || 0);
  return generatedAt > 0 && temporaryBuffExpirations.value.some((expiresAt) => expiresAt > generatedAt && expiresAt <= clockNow.value);
});
const resultGeneratedLabel = computed(() => formatDate(skilling.result?.generatedAt));
const priceStatusText = computed(() => {
  if (skilling.priceStatus.loading) return t("common:skilling.refreshing", "Refreshing...");
  if (skilling.priceStatus.error) return skilling.priceStatus.error;
  return skilling.priceStatus.ready
    ? t("common:skilling.pricesReady", "Prices ready")
    : t("common:skilling.pricesUnavailable", "Prices unavailable");
});
const priceStatusClass = computed(() => {
  if (skilling.priceStatus.error) return "border-rose-300/30 bg-rose-300/10 text-rose-200";
  if (skilling.priceStatus.ready) return "border-teal-300/30 bg-teal-300/10 text-teal-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
});
const overviewRows = computed(() => {
  const rankBySkill = new Map((skilling.overview || []).map((plan, index) => [plan.skillHrid, index + 1]));
  const rankedSkillHrids = (skilling.overview || []).map((plan) => plan.skillHrid).filter((skillHrid) => skillHrids.value.includes(skillHrid));
  const orderedSkillHrids = skilling.result
    ? [...rankedSkillHrids, ...skillHrids.value.filter((skillHrid) => !rankedSkillHrids.includes(skillHrid))]
    : skillHrids.value;
  return orderedSkillHrids.map((skillHrid) => ({
    skillHrid,
    rank: rankBySkill.get(skillHrid) || 0,
    plan: skilling.plansBySkill[skillHrid] || null,
  }));
});
const selectedMetrics = computed(() => {
  const plan = selectedPlan.value;
  return [
    { label: t("common:skilling.netCost", "Net cost"), value: formatAmount(plan?.totalNetCost), className: amountClass(plan?.totalNetCost) },
    { label: t("common:skilling.purchaseCost", "Market purchases"), value: formatAmount(plan?.totalPurchaseCost), className: "text-slate-200" },
    { label: t("common:skilling.opportunityCost", "Inventory opportunity cost"), value: formatAmount(plan?.totalOpportunityCost), className: "text-slate-200" },
    { label: t("common:skilling.outputValue", "Expected recovery"), value: formatAmount(plan?.totalOutputValue), className: "text-teal-200" },
    { label: t("common:skilling.duration", "Time"), value: formatDuration(plan?.totalDurationHours), className: "text-slate-200" },
    { label: t("common:skilling.xpPerHour", "XP/h"), value: formatAmount(plan?.experiencePerHour), className: "text-slate-200" },
  ];
});
const priceRows = computed(() => {
  const references = new Map();
  function addReference(itemHrid, rawEnhancementLevel = 0) {
    const normalizedHrid = String(itemHrid || "");
    if (!normalizedHrid) return;
    const enhancementLevel = Math.max(0, Math.trunc(Number(rawEnhancementLevel) || 0));
    const priceKey = `${normalizedHrid}@${enhancementLevel}`;
    references.set(priceKey, { priceKey, itemHrid: normalizedHrid, enhancementLevel });
  }
  for (const plan of Object.values(skilling.plansBySkill || {})) {
    for (const missingHrid of plan?.missingPriceHrids || []) addReference(missingHrid);
    for (const segment of plan?.segments || []) {
      for (const row of [...(segment.inputItems || []), ...(segment.outputItems || [])]) {
        addReference(row.itemHrid, row.enhancementLevel);
      }
      for (const row of segment.drinks || []) addReference(row.itemHrid);
    }
  }
  return Array.from(references.values()).map(({ priceKey, itemHrid, enhancementLevel }) => {
    const base = simulator.pricing?.basePriceTable?.[itemHrid] || {};
    const quote = enhancementLevel > 0
      ? simulator.pricing?.enhancementQuotesByItem?.[itemHrid]?.[String(enhancementLevel)] || {}
      : base;
    const fixed = itemHrid === "/items/coin";
    return {
      priceKey,
      itemHrid,
      enhancementLevel,
      marketAsk: fixed ? 1 : finiteOrNull(quote.ask),
      marketBid: fixed ? 1 : finiteOrNull(quote.bid),
      vendor: fixed ? 1 : Math.max(0, Number(base.vendor ?? itemDetailIndex?.[itemHrid]?.sellPrice ?? 0) || 0),
      overrideDisabled: fixed || enhancementLevel > 0,
    };
  }).sort((left, right) => (
    itemName(left.itemHrid).localeCompare(itemName(right.itemHrid))
    || left.enhancementLevel - right.enhancementLevel
  ));
});

watch(priceRows, (rows) => {
  void loadItemIcons(rows.map((row) => row.itemHrid));
}, { deep: true });

watch(buffExpiredSinceResult, (expired) => {
  if (expired) skilling.invalidateResult();
}, { immediate: true });

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currentLevel(skillHrid) {
  return Math.max(1, Number(skilling.profile?.skills?.[skillHrid]?.level || 1));
}

function skillName(skillHrid) {
  return getSkillName(skillHrid, String(skillHrid || "").split("/").pop() || "-");
}

function itemName(itemHrid) {
  return getItemName(itemHrid, itemDetailIndex?.[itemHrid]?.name || String(itemHrid || "").split("/").pop() || "-");
}

function actionName(action) {
  return getActionName(action?.actionHrid, action?.actionName || String(action?.actionHrid || "").split("/").pop() || "-");
}

function displayLocale() {
  return language.value === "zh" ? "zh-CN" : "en-US";
}

function formatDate(value) {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(displayLocale(), { dateStyle: "short", timeStyle: "short" }).format(date) : "-";
}

function formatAmount(value) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  const numeric = Number(value);
  if (Math.abs(numeric) < 1_000) {
    return new Intl.NumberFormat(displayLocale(), {
      maximumFractionDigits: Math.abs(numeric) < 10 ? 3 : 1,
    }).format(numeric);
  }
  return formatCompactAmount(numeric, { locale: displayLocale(), unitCase: "lower" });
}

function formatCount(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat(displayLocale(), { maximumFractionDigits: 2 }).format(Number(value));
}

function formatPrice(value) {
  return value == null ? "-" : formatAmount(value);
}

function formatDuration(hours) {
  const numeric = Number(hours);
  if (!Number.isFinite(numeric)) return "-";
  if (numeric < 1 / 60) {
    return t("common:skilling.secondsShort", "{{value}}s", { value: formatCount(Math.max(0, Math.round(numeric * 3600))) });
  }
  if (numeric < 1) {
    return t("common:skilling.minutesShort", "{{value}}m", { value: formatCount(numeric * 60) });
  }
  return t("common:skilling.hoursShort", "{{value}}h", {
    value: new Intl.NumberFormat(displayLocale(), { maximumFractionDigits: numeric < 100 ? 1 : 0 }).format(numeric),
  });
}

function amountClass(value) {
  return Number(value) < 0 ? "text-teal-200" : "text-amber-200";
}

function enhancementLevelLabel(level) {
  return t("common:skilling.enhancementLevel", "+{{level}}", { level: Number(level || 0) });
}

function priceRowLabel(row) {
  const base = itemName(row?.itemHrid);
  return Number(row?.enhancementLevel) > 0
    ? `${base} ${enhancementLevelLabel(row.enhancementLevel)}`
    : base;
}

function priceOverrideAriaLabel(row, side) {
  const sideLabel = side === "bid"
    ? t("common:skilling.overrideBid", "Override bid")
    : t("common:skilling.overrideAsk", "Override ask");
  return `${sideLabel}: ${priceRowLabel(row)}`;
}

function priceClearAriaLabel(row) {
  return `${t("common:skilling.clear", "Clear")}: ${priceRowLabel(row)}`;
}

function planStatusText(plan) {
  if (!plan) return t("common:skilling.awaiting", "Awaiting calculation");
  if (plan.status === "blocked") return t("common:skilling.blocked", "Blocked");
  if (plan.status === "complete") return t("common:skilling.complete", "Complete");
  return t("common:skilling.ready", "Ready");
}

function planStatusClass(plan) {
  if (!plan) return "border-white/10 text-slate-500";
  if (plan.status === "blocked") return "border-rose-300/30 bg-rose-300/10 text-rose-200";
  if (plan.status === "complete") return "border-white/10 bg-white/5 text-slate-300";
  return "border-teal-300/30 bg-teal-300/10 text-teal-200";
}

function joinItemRows(rows, countField, emptyKey, emptyFallback) {
  if (!rows?.length) return t(emptyKey, emptyFallback);
  return rows.slice(0, 3).map((row) => `${itemName(row.itemHrid)} ${t("common:skilling.countTimes", "x{{count}}", { count: formatCount(row[countField]) })}`).join(", ")
    + (rows.length > 3 ? ` +${rows.length - 3}` : "");
}

function drinkSummary(segment) {
  return joinItemRows(segment?.drinks, "count", "common:skilling.noDrinks", "None");
}

function equipmentSummary(segment) {
  if (!segment?.equipment?.length) return t("common:skilling.noEquipment", "None");
  return segment.equipment.slice(0, 3).map((item) => `${itemName(item.itemHrid)} +${item.enhancementLevel}`).join(", ")
    + (segment.equipment.length > 3
      ? `, ${t("common:skilling.additionalEquipment", "… {{count}} more", { count: segment.equipment.length - 3 })}`
      : "");
}

function shortageSummary(segment) {
  const shortages = (segment?.inputItems || []).filter((row) => Number(row.purchaseCount) > 1e-9);
  return joinItemRows(shortages, "purchaseCount", "common:skilling.noShortage", "Inventory covers inputs");
}

function outputSummary(segment) {
  return joinItemRows(segment?.outputItems, "count", "common:skilling.noOutputs", "None");
}

function missingPriceLabel(plan) {
  return t("common:skilling.missingPrices", "Missing asks: {{items}}", {
    items: (plan?.missingPriceHrids || []).map(itemName).join(", ") || "-",
  });
}

function setTarget(skillHrid, event) {
  skilling.setTargetLevel(skillHrid, event?.target?.value);
  if (event?.target) event.target.value = String(skilling.targetLevels[skillHrid]);
}

async function runPlanner() {
  await skilling.run();
  void loadItemIcons(priceRows.value.map((row) => row.itemHrid));
}

function handlePlannerAction() {
  if (skilling.running) {
    skilling.cancel();
    return;
  }
  void runPlanner();
}

async function refreshPrices() {
  await skilling.refreshPrices();
}

function openSegment(segment) {
  activeSegment.value = segment;
  segmentModalOpen.value = true;
  void loadItemIcons([
    ...(segment?.equipment || []).map((item) => item.itemHrid),
    ...(segment?.inputItems || []).map((item) => item.itemHrid),
    ...(segment?.outputItems || []).map((item) => item.itemHrid),
  ]);
}

function openPricesModal() {
  pricesModalOpen.value = true;
  void loadItemIcons(priceRows.value.map((row) => row.itemHrid));
}

function overrideValue(row, side) {
  if (row?.enhancementLevel > 0) return "";
  return simulator.pricing?.overrides?.[row?.itemHrid]?.[side] ?? "";
}

function setPriceOverride(itemHrid, side, event) {
  if (itemHrid === "/items/coin") return;
  const raw = String(event?.target?.value ?? "").trim();
  skilling.setPriceOverride(itemHrid, { [side]: raw === "" ? null : Math.max(0, Number(raw)) });
}

function viewDomKey(view) {
  return String(view || "overview").split("/").filter(Boolean).join("-") || "overview";
}

function tabId(view) {
  return `skilling-tab-${viewDomKey(view)}`;
}

function panelId(view) {
  return `skilling-panel-${viewDomKey(view)}`;
}

function selectView(view, focusTab = false) {
  skilling.selectedView = view;
  if (focusTab) {
    void nextTick(() => document.getElementById(tabId(view))?.focus());
  }
}

function handleTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const ids = tabs.value.map((tab) => tab.id);
  const currentIndex = Math.max(0, ids.indexOf(skilling.selectedView));
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? ids.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
  selectView(ids[nextIndex]);
  event.currentTarget?.querySelectorAll('[role="tab"]')?.[nextIndex]?.focus();
}

function loadItemIcons(hrids = []) {
  const requested = Array.from(new Set(hrids.map(String).filter(Boolean)));
  if (!requested.length) return itemIconLoadQueue;
  itemIconLoadQueue = itemIconLoadQueue.catch(() => 0).then(() => ensureItemIconSymbols(requested)).then((count) => {
    itemIconRevision.value += 1;
    return count;
  }).catch(() => {
    itemIconRevision.value += 1;
    return 0;
  });
  return itemIconLoadQueue;
}

function itemIconVisible(itemHrid) {
  void itemIconRevision.value;
  return hasItemIconSymbol(itemHrid);
}

function itemFallback(itemHrid) {
  return Array.from(itemName(itemHrid))[0]?.toUpperCase() || "?";
}

function postTampermonkeyImportResult(payload) {
  window.postMessage({ channel: TAMPERMONKEY_BRIDGE_CHANNEL, ...payload }, window.location.origin);
}

function handleTampermonkeySkillingImportWindowMessage(event) {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.channel !== TAMPERMONKEY_BRIDGE_CHANNEL || data.type !== "mwi-tm-import" || data.importTarget !== "skilling") return;
  const requestId = String(data.requestId || "").trim();
  if (!requestId) return;
  try {
    const imported = applyTampermonkeySkillingImportMessage(skilling, data);
    postTampermonkeyImportResult({ type: "mwi-tm-import-result", requestId, ok: true, detectedFormat: imported.detectedFormat, message: imported.message });
    void loadItemIcons([
      ...Object.keys(skilling.profile?.inventory || {}),
      ...(skilling.profile?.equipment || []).map((item) => item.itemHrid),
    ]);
  } catch (error) {
    postTampermonkeyImportResult({ type: "mwi-tm-import-result", requestId, ok: false, message: error?.message || String(error) });
  }
}

onMounted(async () => {
  window.addEventListener("message", handleTampermonkeySkillingImportWindowMessage);
  clockInterval = window.setInterval(() => {
    clockNow.value = Date.now();
  }, 30_000);
  await skilling.initialize();
  void loadItemIcons([
    ...Object.keys(skilling.profile?.inventory || {}),
    ...(skilling.profile?.equipment || []).map((item) => item.itemHrid),
  ]);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleTampermonkeySkillingImportWindowMessage);
  if (clockInterval != null) window.clearInterval(clockInterval);
  skilling.cancel();
});
</script>
