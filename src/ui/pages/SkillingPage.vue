<template>
  <section class="space-y-4" data-skilling-page>
    <div class="surface-panel overflow-hidden !px-4 !py-3" data-skilling-toolbar>
      <div class="flex flex-col gap-3">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-skilling-toolbar-heading>
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p class="text-[10px] font-semibold uppercase  text-success">{{ t("common:skilling.eyebrow", "Skilling Ledger") }}</p>
            <h2 class="min-w-0 break-words font-heading text-lg font-semibold text-foreground">{{ t("common:skilling.title", "Skilling Upgrade Planner") }}</h2>
          </div>
          <span class="hidden h-5 w-px bg-muted/40 sm:block" aria-hidden="true"></span>
          <div v-if="skilling.profile" class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span class="shrink-0 font-semibold text-foreground">{{ skilling.profile.characterName || t("common:skilling.profile", "Character") }}</span>
            <span class="min-w-0 truncate">{{ snapshotLabel }}</span>
          </div>
          <span v-else class="text-xs text-muted-foreground">{{ t("common:skilling.noProfile", "No current-character skilling snapshot") }}</span>
        </div>

        <div class="flex flex-col gap-2 border-t border-border pt-3 2xl:flex-row 2xl:items-center" data-skilling-toolbar-controls>
          <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center 2xl:shrink-0" data-skilling-planner-controls>
          <div class="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:shrink-0">
            <div
              class="grid min-w-0 flex-1 grid-cols-[1.25fr_0.8fr_0.95fr] overflow-hidden rounded border border-border bg-muted/50 sm:flex-none"
              role="radiogroup"
              :aria-label="t('common:skilling.optimizationMode', 'Optimization mode')"
              data-skilling-optimization-mode
            >
              <label
                v-for="(mode, index) in optimizationModes"
                :key="mode.value"
                class="relative"
                :class="[
                  index > 0 ? 'border-l border-border' : '',
                  skilling.running ? 'cursor-not-allowed' : 'cursor-pointer',
                ]"
              >
                <input
                  class="peer sr-only"
                  type="radio"
                  name="skilling-optimization-mode"
                  autocomplete="off"
                  :value="mode.value"
                  :checked="skilling.optimizationMode === mode.value"
                  :disabled="skilling.running"
                  @change="skilling.setOptimizationMode(mode.value)"
                />
                <span
                  class="flex min-h-8 min-w-0 items-center justify-center whitespace-nowrap px-1.5 py-1 text-center text-[10px] font-semibold leading-tight transition sm:min-w-[6.5rem] sm:px-2 sm:text-[11px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px] peer-focus-visible:outline-ring peer-disabled:opacity-50"
                  :class="skilling.optimizationMode === mode.value
                    ? 'bg-success/10 text-success'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground peer-disabled:hover:bg-transparent peer-disabled:hover:text-muted-foreground'"
                >
                  {{ mode.label }}
                </span>
              </label>
            </div>
            <button
              type="button"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-xs font-bold text-muted-foreground transition hover:border-success/40 hover:text-success focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              :aria-label="t('common:skilling.optimizationModeHelp', 'Optimization mode guide')"
              :title="t('common:skilling.optimizationModeHelp', 'Optimization mode guide')"
              data-skilling-optimization-help
              @click="modeHelpModalOpen = true"
            >
              <CircleHelp class="size-4" aria-hidden="true" />
            </button>
          </div>
          <div class="flex w-full min-w-0 items-center gap-1.5 sm:w-auto" data-skilling-run-scope-controls>
            <div
              class="grid shrink-0 grid-cols-2 overflow-hidden rounded border border-border bg-muted/50"
              role="radiogroup"
              :aria-label="t('common:skilling.runScope', 'Simulation scope')"
              data-skilling-run-scope
            >
              <label
                v-for="(scope, index) in runScopes"
                :key="scope.value"
                class="relative"
                :class="[
                  index > 0 ? 'border-l border-border' : '',
                  skilling.running ? 'cursor-not-allowed' : 'cursor-pointer',
                ]"
              >
                <input
                  class="peer sr-only"
                  type="radio"
                  name="skilling-run-scope"
                  autocomplete="off"
                  :value="scope.value"
                  :checked="skilling.runScope === scope.value"
                  :disabled="skilling.running"
                  @change="skilling.setRunScope(scope.value)"
                />
                <span
                  class="flex min-h-8 min-w-[3.5rem] items-center justify-center px-2 py-1 text-center text-[11px] font-semibold transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px] peer-focus-visible:outline-ring peer-disabled:opacity-50"
                  :class="skilling.runScope === scope.value
                    ? 'bg-success/10 text-success'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground peer-disabled:hover:bg-transparent peer-disabled:hover:text-muted-foreground'"
                >
                  {{ scope.label }}
                </span>
              </label>
            </div>
            <Select
              name="skilling-run-skill"
              :disabled="skilling.running || skilling.runScope === 'all'"
              :model-value="skilling.runScope === 'all' ? '__all__' : skilling.selectedRunSkillHrid"
              @update:model-value="setRunSkill"
            >
              <SelectTrigger
                class="!h-8 !min-w-0 !w-auto !flex-1 !rounded !px-2 !py-1 text-xs sm:!w-36 sm:!flex-none"
                :aria-label="t('common:skilling.simulationSkill', 'Simulation skill')"
                data-skilling-run-skill
              />
              <SelectContent>
                <SelectItem v-if="skilling.runScope === 'all'" value="__all__">{{ t("common:skilling.allSkills", "All skills") }}</SelectItem>
                <template v-else>
                  <SelectItem v-for="skillHrid in skillHrids" :key="skillHrid" :value="skillHrid">{{ skillName(skillHrid) }}</SelectItem>
                </template>
              </SelectContent>
            </Select>
          </div>
          </div>
          <div class="flex w-full min-w-0 flex-wrap items-center gap-2 2xl:ml-auto 2xl:w-auto 2xl:flex-1 2xl:justify-end" data-skilling-toolbar-actions data-tm-import-anchor="skilling-actions">
          <span class="rounded border px-2 py-1 text-[11px]" :class="priceStatusClass">{{ priceStatusText }}</span>
          <button type="button" class="button-secondary !px-3 !py-1.5" :disabled="skilling.running" @click="openPricesModal">
            {{ t("common:skilling.priceDetails", "Price details") }}
          </button>
          <button
            type="button"
            class="button-secondary !px-3 !py-1.5"
            data-tm-import-reference="skilling-refresh"
            :disabled="skilling.priceStatus.loading || skilling.running"
            @click="refreshPrices"
          >
            {{ skilling.priceStatus.loading ? t("common:skilling.refreshing", "Refreshing…") : t("common:skilling.refreshPrices", "Refresh prices") }}
          </button>
          <button
            type="button"
            class="min-w-[9.5rem] whitespace-nowrap"
            :class="skilling.running ? 'button-danger !px-3 !py-1.5' : 'button-primary !px-3 !py-1.5'"
            :disabled="!skilling.running && (!skilling.profile || skilling.priceStatus.loading)"
            @click="handlePlannerAction"
          >
            {{ plannerActionLabel }}
          </button>
          </div>
        </div>
      </div>

      <div
        v-if="skilling.running"
        class="mt-3"
        data-skilling-progress
        aria-live="polite"
      >
        <div class="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{{ progressLabel }}</span>
          <span>{{ progressPercent }}%</span>
        </div>
        <Progress :value="progressPercent" :aria-label="progressLabel" />
      </div>
    </div>

    <div v-if="skilling.resultStale || snapshotIsOld || expiredBuffWarningCount > 0 || foragingProcessingNoticeVisible || skilling.error" class="grid gap-2 sm:grid-cols-2" data-skilling-warnings aria-live="polite">
      <p v-if="skilling.resultStale" class="rounded border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
        {{ t("common:skilling.stale", "Results are stale because targets, prices, optimization settings, or the character snapshot changed.") }}
      </p>
      <p v-if="snapshotIsOld" class="rounded border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
        {{ t("common:skilling.oldSnapshotWarning", "This character snapshot is more than 30 minutes old.") }}
      </p>
      <p v-if="expiredBuffWarningCount > 0" class="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {{ expiredBuffWarningText }}
      </p>
      <p v-if="foragingProcessingNoticeVisible" class="rounded border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
        {{ t("common:skilling.processingUnsupportedWarning", "Processing effects and Processing Tea are not yet included in foraging output values; foraging routes are optimized without them.") }}
      </p>
      <p v-if="skilling.error" class="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{{ skilling.error }}</p>
    </div>

    <div v-if="!skilling.profile" class="surface-panel flex min-h-48 items-center justify-center" data-skilling-empty-profile>
      <p class="font-heading text-sm font-semibold text-muted-foreground">{{ t("common:skilling.noProfile", "No current-character skilling snapshot") }}</p>
    </div>

    <template v-else>
      <div class="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside class="xl:sticky xl:top-16">
          <div class="surface-panel overflow-hidden !p-0" data-skilling-targets>
        <div class="grid sm:grid-cols-2 xl:grid-cols-1">
          <label
            v-for="skillHrid in skillHrids"
            :key="skillHrid"
            class="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-3 border-b border-border px-4 py-3 sm:border-r xl:border-r-0"
          >
            <span class="min-w-0">
              <span class="block truncate text-xs font-semibold text-foreground">{{ skillName(skillHrid) }}</span>
              <span class="mt-0.5 block text-[11px] text-muted-foreground">{{ t("common:skilling.current", "Current") }} {{ currentLevel(skillHrid) }}</span>
            </span>
            <input
              class="control-input !rounded !px-2 !py-1.5 text-right text-xs"
              type="number"
              :name="`skilling-target-${viewDomKey(skillHrid)}`"
              autocomplete="off"
              inputmode="numeric"
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
        </aside>

        <div class="min-w-0 space-y-4">

      <div
        class="grid grid-cols-2 overflow-hidden rounded border border-border bg-muted/50 sm:grid-cols-4 xl:grid-cols-7"
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
          :class="skilling.selectedView === tab.id ? 'border-success/40 bg-success/10 text-success' : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground/85'"
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
        class="surface-panel !p-0"
        data-skilling-overview
        role="tabpanel"
        :aria-labelledby="tabId('overview')"
        tabindex="0"
      >
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 class="font-heading text-sm font-semibold text-primary">{{ t("common:skilling.overview", "Overview") }}</h3>
          <span v-if="skilling.result" class="text-[11px] text-muted-foreground">{{ resultGeneratedLabel }}</span>
        </div>
        <div class="overflow-x-auto">
          <Table class="min-w-[1120px] w-full text-left text-xs">
            <TableHeader class="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <TableRow>
                <TableHead class="px-4 py-2">{{ t("common:skilling.rank", "Rank") }}</TableHead>
                <TableHead class="px-3 py-2">{{ t("common:skilling.skill", "Skill") }}</TableHead>
                <TableHead class="px-3 py-2">{{ t("common:skilling.current", "Current") }} -> {{ t("common:skilling.target", "Target") }}</TableHead>
                <TableHead class="px-3 py-2">{{ t("common:skilling.route", "First route") }}</TableHead>
                <TableHead class="px-3 py-2 text-right" :class="resultHighlightsCost ? 'bg-success/10 text-success' : ''">{{ t("common:skilling.costPerXp", "Net cost / XP") }}</TableHead>
                <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.materialPurchasePerXp", "Material purchases / XP") }}</TableHead>
                <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.totalCost", "Net cost") }}</TableHead>
                <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.purchaseCost", "Market purchases") }}</TableHead>
                <TableHead class="px-3 py-2 text-right" :class="resultHighlightsDuration ? 'bg-success/10 text-success' : ''">{{ t("common:skilling.duration", "Time") }}</TableHead>
                <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.xpPerHour", "XP/h") }}</TableHead>
                <TableHead class="px-4 py-2 text-right">{{ t("common:skilling.status", "Status") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody class="divide-y divide-border">
              <TableRow v-for="row in overviewRows" :key="row.skillHrid" class="hover:bg-muted/40">
                <TableCell class="px-4 py-3 font-semibold text-primary">{{ row.rank || "-" }}</TableCell>
                <TableCell class="px-3 py-3">
                  <button type="button" class="font-semibold text-foreground hover:text-success" @click="selectView(row.skillHrid, true)">{{ skillName(row.skillHrid) }}</button>
                </TableCell>
                <TableCell class="px-3 py-3 tabular-nums text-foreground/85">{{ currentLevel(row.skillHrid) }} -> {{ skilling.targetLevels[row.skillHrid] }}</TableCell>
                <TableCell class="max-w-[220px] truncate px-3 py-3 text-foreground/85">{{ row.plan?.segments?.[0] ? actionName(row.plan.segments[0]) : "-" }}</TableCell>
                <TableCell class="px-3 py-3 text-right tabular-nums" :class="[amountClass(row.plan?.costPerExperience), resultHighlightsCost ? 'bg-success/10 font-semibold' : '']">{{ formatAmount(row.plan?.costPerExperience) }}</TableCell>
                <TableCell class="px-3 py-3 text-right tabular-nums text-foreground/85">{{ formatAmount(row.plan?.materialPurchaseCostPerExperience) }}</TableCell>
                <TableCell class="px-3 py-3 text-right tabular-nums" :class="amountClass(row.plan?.totalNetCost)">{{ formatAmount(row.plan?.totalNetCost) }}</TableCell>
                <TableCell class="px-3 py-3 text-right tabular-nums text-foreground/85">{{ formatAmount(row.plan?.totalPurchaseCost) }}</TableCell>
                <TableCell class="px-3 py-3 text-right tabular-nums" :class="resultHighlightsDuration ? 'bg-success/10 font-semibold text-success' : 'text-foreground/85'">{{ formatDuration(row.plan?.totalDurationHours) }}</TableCell>
                <TableCell class="px-3 py-3 text-right tabular-nums text-foreground/85">{{ formatAmount(row.plan?.experiencePerHour) }}</TableCell>
                <TableCell class="px-4 py-3 text-right"><span class="rounded border px-2 py-1 text-[10px]" :class="planStatusClass(row.plan)">{{ planStatusText(row.plan) }}</span></TableCell>
              </TableRow>
            </TableBody>
          </Table>
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
        <div class="surface-panel !p-0">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p class="text-[10px] uppercase text-muted-foreground">{{ currentLevel(selectedSkillHrid) }} -> {{ skilling.targetLevels[selectedSkillHrid] }}</p>
              <h3 class="font-heading text-base font-semibold text-primary">{{ skillName(selectedSkillHrid) }}</h3>
            </div>
            <span v-if="selectedPlan?.status === 'blocked'" class="text-xs text-destructive">{{ missingPriceLabel(selectedPlan) }}</span>
          </div>

          <div v-if="selectedPlan" class="grid grid-cols-2 border-b border-border sm:grid-cols-3 xl:grid-cols-6">
            <div v-for="metric in selectedMetrics" :key="metric.label" class="border-r border-border px-4 py-3 last:border-r-0">
              <p class="text-[10px] uppercase text-muted-foreground">{{ metric.label }}</p>
              <p class="mt-1 truncate text-sm font-semibold tabular-nums" :class="metric.className">{{ metric.value }}</p>
            </div>
          </div>

          <div v-if="!selectedPlan" class="flex min-h-44 items-center justify-center text-sm text-muted-foreground">
            {{ t("common:skilling.awaiting", "Awaiting calculation") }}
          </div>
          <div v-else-if="selectedRangeSummary" class="overflow-x-auto" data-skilling-routes>
            <Table class="min-w-[1280px] w-full text-left text-xs">
              <TableHeader class="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <TableRow>
                  <TableHead class="px-4 py-2">{{ t("common:skilling.levelRange", "Levels") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.recipe", "Recipe") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.actions", "Actions") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.drinks", "Drinks") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.equipment", "Equipment") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.shortage", "Purchase shortage") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.outputs", "Expected output") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.netCost", "Net cost") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.xpPerHour", "XP/h") }}</TableHead>
                  <TableHead class="px-4 py-2 text-right">{{ t("common:skilling.details", "Details") }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-border">
                <TableRow class="align-top hover:bg-muted/40" data-skilling-range-summary>
                  <TableHead scope="row" class="px-4 py-3 text-left font-semibold tabular-nums text-primary">
                    <span class="block whitespace-nowrap">{{ segmentLevelLabel(selectedRangeSummary) }}</span>
                    <span class="mt-1 block text-[10px] font-normal text-muted-foreground">{{ stageCountLabel(selectedRangeSummary) }}</span>
                  </TableHead>
                  <TableCell class="max-w-[210px] break-words px-3 py-3 font-semibold text-foreground">{{ routeRecipeSummary(selectedRangeSummary) }}</TableCell>
                  <TableCell class="px-3 py-3 text-right tabular-nums text-foreground/85">{{ formatCount(selectedRangeSummary.completionCount) }}</TableCell>
                  <TableCell class="max-w-[220px] break-words px-3 py-3 leading-5 text-muted-foreground">{{ totalDrinkSummary(selectedRangeSummary) }}</TableCell>
                  <TableCell class="max-w-[240px] break-words px-3 py-3 text-muted-foreground">{{ routeEquipmentSummary(selectedRangeSummary) }}</TableCell>
                  <TableCell class="max-w-[220px] break-words px-3 py-3 text-muted-foreground">{{ shortageSummary(selectedRangeSummary) }}</TableCell>
                  <TableCell class="max-w-[220px] break-words px-3 py-3 text-muted-foreground">{{ outputSummary(selectedRangeSummary) }}</TableCell>
                  <TableCell class="px-3 py-3 text-right font-semibold tabular-nums" :class="amountClass(selectedRangeSummary.netCost)">{{ formatAmount(selectedRangeSummary.netCost) }}</TableCell>
                  <TableCell class="px-3 py-3 text-right tabular-nums text-foreground/85">{{ formatAmount(selectedRangeSummary.experiencePerHour) }}</TableCell>
                  <TableCell class="px-4 py-3 text-right"><button type="button" class="button-secondary !rounded !px-2 !py-1 text-[11px]" :aria-label="rangeDetailsAriaLabel(selectedRangeSummary)" @click="openSegment(selectedRangeSummary)">{{ t("common:skilling.details", "Details") }}</button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div v-else class="flex min-h-32 items-center justify-center px-4 text-sm text-muted-foreground">{{ planStatusText(selectedPlan) }}</div>
        </div>

        <div v-if="selectedPlan?.alternatives?.length" class="surface-panel !p-0" data-skilling-alternatives>
          <div class="border-b border-border px-4 py-3"><h3 class="font-heading text-sm font-semibold text-success">{{ t("common:skilling.currentLevelAlternatives", "Current-level candidate comparison") }}</h3></div>
          <div class="overflow-x-auto">
            <Table class="min-w-[1460px] w-full text-left text-xs">
              <TableHeader class="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <TableRow>
                  <TableHead class="px-4 py-2">#</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.recipe", "Recipe") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.nextLevelActions", "Estimated actions to next level") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right" :class="resultHighlightsDuration ? 'bg-success/10 text-success' : ''">{{ t("common:skilling.nextLevelTime", "Time to next level") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.nextLevelDrinks", "Drinks to next level") }}</TableHead>
                  <TableHead class="px-3 py-2">{{ t("common:skilling.equipment", "Equipment") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right" :class="resultHighlightsCost ? 'bg-success/10 text-success' : ''">{{ t("common:skilling.nextLevelCostPerXp", "Net cost / XP to next level") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.nextLevelMaterialPurchasePerXp", "Material purchases / XP to next level") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.nextLevelPurchaseCost", "Purchases to next level") }}</TableHead>
                  <TableHead class="px-3 py-2 text-right">{{ t("common:skilling.nextLevelXpPerHour", "XP/h to next level") }}</TableHead>
                  <TableHead class="px-4 py-2 text-right">{{ t("common:skilling.details", "Details") }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-border">
                <TableRow v-for="(candidate, index) in selectedPlan.alternatives.slice(0, 8)" :key="`${candidate.actionHrid}-${index}`" class="align-top hover:bg-muted/40">
                  <TableCell class="px-4 py-2 text-primary">{{ index + 1 }}</TableCell>
                  <TableCell class="max-w-[190px] px-3 py-2 font-medium text-foreground">{{ actionName(candidate) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums text-foreground/85">
                    <span class="block whitespace-nowrap font-medium text-foreground">{{ formatCount(candidate.completionCount) }}</span>
                  </TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums" :class="resultHighlightsDuration ? 'bg-success/10 font-semibold text-success' : 'text-foreground/85'">{{ formatDuration(candidate.durationHours) }}</TableCell>
                  <TableCell class="max-w-[220px] whitespace-pre-line px-3 py-2 leading-5 text-muted-foreground">{{ candidateDrinkSummary(candidate) }}</TableCell>
                  <TableCell class="max-w-[260px] px-3 py-2 text-muted-foreground">{{ candidateEquipmentSummary(candidate) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums" :class="[amountClass(candidate.costPerExperience), resultHighlightsCost ? 'bg-success/10 font-semibold' : '']">{{ formatAmount(candidate.costPerExperience) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums text-muted-foreground">{{ formatAmount(candidate.materialPurchaseCostPerExperience) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums text-muted-foreground">{{ formatAmount(candidate.purchaseCost) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums text-muted-foreground">{{ formatAmount(candidate.experiencePerHour) }}</TableCell>
                  <TableCell class="px-4 py-2 text-right"><button type="button" class="button-secondary !rounded !px-2 !py-1 text-[11px]" :aria-label="candidateDetailsAriaLabel(candidate, index)" @click="openSegment(candidate, true)">{{ t("common:skilling.details", "Details") }}</button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
        </div>
      </div>
      </div>
    </template>

    <BaseModal
      :open="modeHelpModalOpen"
      :title="t('common:skilling.optimizationModeHelp', 'Optimization mode guide')"
      panel-class="max-w-3xl max-h-[88vh] overflow-y-auto overscroll-contain"
      @close="modeHelpModalOpen = false"
    >
      <div class="grid border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-border" data-skilling-optimization-help-dialog>
        <section class="border-b border-border px-4 py-4 sm:border-b-0">
          <h3 class="font-heading text-sm font-semibold text-primary">{{ t("common:skilling.lowestCostPerXp", "Lowest net cost / XP") }}</h3>
          <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ t("common:skilling.costModeDescription", "Prioritizes the lowest net cost per experience.") }}</p>
        </section>
        <section class="border-b border-border bg-success/10 px-4 py-4 sm:border-b-0">
          <h3 class="font-heading text-sm font-semibold text-success">{{ t("common:skilling.balanced", "Balanced") }}</h3>
          <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ t("common:skilling.balancedModeDescription", `Uses the current level's lowest-net-cost-per-XP full-level route as the baseline and prefers shorter candidates within baseline + ${balancedCostTolerancePercentText}% of |baseline|.`, { percent: balancedCostTolerancePercentText }) }}</p>
          <div class="mt-3 border-t border-success/40 pt-3" data-skilling-balanced-tolerance>
            <label class="flex items-center justify-between gap-3 text-[11px] font-semibold text-foreground/85" for="skilling-balanced-cost-tolerance">
              <span>{{ t("common:skilling.balancedCostTolerance", "Cost tolerance") }}</span>
              <span class="font-normal text-muted-foreground">0–100%</span>
            </label>
            <div class="mt-1.5 flex items-center gap-2">
              <input
                id="skilling-balanced-cost-tolerance"
                class="control-input !w-24 !rounded !px-2 !py-1.5 text-right text-xs tabular-nums"
                type="number"
                name="skilling-balanced-cost-tolerance"
                autocomplete="off"
                inputmode="decimal"
                min="0"
                max="100"
                step="0.01"
                :aria-label="t('common:skilling.balancedCostTolerancePercent', 'Balanced cost tolerance percent')"
                :aria-describedby="balancedToleranceResultDiffers
                  ? 'skilling-balanced-cost-tolerance-hint skilling-balanced-cost-tolerance-status'
                  : 'skilling-balanced-cost-tolerance-hint'"
                :disabled="skilling.running"
                :value="balancedCostTolerancePercent"
                @input="setBalancedCostTolerance"
                @blur="normalizeBalancedCostToleranceInput"
              />
              <span class="text-xs font-semibold text-success" aria-hidden="true">%</span>
            </div>
            <p id="skilling-balanced-cost-tolerance-hint" class="mt-2 text-[11px] leading-4 text-muted-foreground">{{ t("common:skilling.balancedCostToleranceHint", "Controls how much higher the current level's net cost per XP may be than its lowest-cost baseline. A higher value allows faster but more expensive routes.") }}</p>
            <p
              v-if="balancedToleranceResultDiffers"
              id="skilling-balanced-cost-tolerance-status"
              class="mt-2 rounded border border-primary/40 bg-primary/10 px-2 py-1.5 text-[11px] leading-4 text-primary"
              role="status"
              aria-live="polite"
            >
              {{ t("common:skilling.balancedCostToleranceChanged", `The existing result used ${resultBalancedCostTolerancePercentText}%; the current ${balancedCostTolerancePercentText}% setting takes effect after recalculation.`, { resultPercent: resultBalancedCostTolerancePercentText, currentPercent: balancedCostTolerancePercentText }) }}
            </p>
          </div>
        </section>
        <section class="px-4 py-4">
          <h3 class="font-heading text-sm font-semibold text-info">{{ t("common:skilling.speedFirst", "Speed first") }}</h3>
          <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ t("common:skilling.speedModeDescription", "Prioritizes the shortest estimated time for each level.") }}</p>
        </section>
      </div>
      <p class="border-b border-border px-4 py-3 text-xs leading-5 text-muted-foreground">{{ t("common:skilling.optimizationModeCommonRules", "All modes calculate and show costs, require valid asks, and replan after every level.") }}</p>
    </BaseModal>

    <BaseModal
      :open="segmentModalOpen"
      :title="activeSegmentTitle"
      panel-class="max-w-5xl max-h-[88vh] overflow-y-auto overscroll-contain"
      @close="segmentModalOpen = false"
    >
      <template v-if="activeSegment">
        <div class="grid grid-cols-2 border-y border-border sm:grid-cols-4">
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-muted-foreground">{{ t("common:skilling.recipe", "Recipe") }}</p><p class="mt-1 font-semibold text-foreground">{{ routeRecipeSummary(activeSegment) }}</p></div>
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-muted-foreground">{{ t("common:skilling.actions", "Actions") }}</p><p class="mt-1 tabular-nums text-foreground">{{ formatCount(activeSegment.completionCount) }}</p></div>
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-muted-foreground">{{ activeSegmentIsCandidate ? t("common:skilling.nextLevelTime", "Time to next level") : t("common:skilling.duration", "Time") }}</p><p class="mt-1 tabular-nums text-foreground">{{ formatDuration(activeSegment.durationHours) }}</p></div>
          <div class="px-3 py-2"><p class="text-[10px] uppercase text-muted-foreground">{{ t("common:skilling.netCost", "Net cost") }}</p><p class="mt-1 font-semibold tabular-nums" :class="amountClass(activeSegment.netCost)">{{ formatAmount(activeSegment.netCost) }}</p></div>
        </div>

        <section v-if="activeSegmentIsRangeSummary" class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-info">{{ t("common:skilling.totalDrinks", "Total drinks") }}</h3>
          <div v-if="activeConsumedDrinks.length" class="grid border-y border-border sm:grid-cols-2">
            <div v-for="drink in activeConsumedDrinks" :key="drink.itemHrid" class="flex items-center gap-2 border-b border-border px-3 py-2">
              <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted/40 ring-1 ring-ring">
                <svg v-if="itemIconVisible(drink.itemHrid)" class="h-full w-full p-1" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(drink.itemHrid)"></use></svg>
                <span v-else class="text-xs text-muted-foreground">{{ itemFallback(drink.itemHrid) }}</span>
              </span>
              <span class="min-w-0 flex-1 truncate text-foreground">{{ itemName(drink.itemHrid) }}</span>
              <span class="text-xs tabular-nums text-info">{{ countTimesLabel(drink.count) }}</span>
            </div>
          </div>
          <p v-else class="px-3 text-xs text-muted-foreground">{{ t("common:skilling.noCandidateDrinks", "None") }}</p>
        </section>

        <section class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-primary">{{ t("common:skilling.equipment", "Equipment") }}</h3>
          <div v-if="activeEquipmentStrategies.length" class="space-y-3">
            <div v-for="(strategy, strategyIndex) in activeEquipmentStrategies" :key="`${strategy.equipmentSignature || 'equipment'}-${strategyIndex}`">
              <p v-if="activeEquipmentStrategies.length > 1" class="mb-1 px-3 text-[11px] text-muted-foreground">
                {{ equipmentStageLabel(strategy, strategyIndex) }}
              </p>
              <div v-if="strategy.equipment?.length" class="grid border-y border-border sm:grid-cols-2">
                <div v-for="item in strategy.equipment" :key="`${item.equipmentType}-${item.id}`" class="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted/40 ring-1 ring-ring">
                    <svg v-if="itemIconVisible(item.itemHrid)" class="h-full w-full p-1" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(item.itemHrid)"></use></svg>
                    <span v-else class="text-xs text-muted-foreground">{{ itemFallback(item.itemHrid) }}</span>
                  </span>
                  <span class="min-w-0 flex-1 truncate text-foreground">{{ itemName(item.itemHrid) }}</span>
                  <span class="text-xs text-primary">{{ enhancementLevelLabel(item.enhancementLevel) }}</span>
                </div>
              </div>
              <p v-else class="px-3 text-xs text-muted-foreground">{{ t("common:skilling.noEquipment", "None") }}</p>
            </div>
          </div>
          <p v-else class="text-muted-foreground">{{ t("common:skilling.noEquipment", "None") }}</p>
        </section>

        <section v-if="activeRouteStages.length > 1" class="pt-2" data-skilling-route-stages>
          <div class="mb-2 flex items-baseline justify-between gap-3">
            <h3 class="font-heading text-sm font-semibold text-primary">{{ t("common:skilling.stageDetails", "Stage details") }}</h3>
            <span class="text-[11px] tabular-nums text-muted-foreground">{{ stageCountLabel(activeSegment) }}</span>
          </div>
          <div
            class="overflow-x-auto"
            role="region"
            tabindex="0"
            :aria-label="t('common:skilling.stageDetails', 'Stage details')"
          >
            <Table class="min-w-[1080px] w-full text-left text-xs">
              <caption class="sr-only">{{ t("common:skilling.stageDetails", "Stage details") }}</caption>
              <TableHeader class="border-y border-border text-[10px] uppercase text-muted-foreground">
                <TableRow>
                  <TableHead scope="col" class="px-3 py-2">{{ t("common:skilling.stageLevel", "Stage levels") }}</TableHead>
                  <TableHead scope="col" class="px-3 py-2">{{ t("common:skilling.recipe", "Recipe") }}</TableHead>
                  <TableHead scope="col" class="px-3 py-2 text-right">{{ t("common:skilling.actions", "Actions") }}</TableHead>
                  <TableHead scope="col" class="px-3 py-2">{{ t("common:skilling.drinks", "Drinks") }}</TableHead>
                  <TableHead scope="col" class="px-3 py-2">{{ t("common:skilling.equipment", "Equipment") }}</TableHead>
                  <TableHead scope="col" class="px-3 py-2 text-right">{{ t("common:skilling.netCost", "Net cost") }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody class="divide-y divide-border">
                <TableRow v-for="(stage, stageIndex) in activeRouteStages" :key="routeStageKey(stage, stageIndex)" class="align-top">
                  <TableHead scope="row" class="px-3 py-2 text-left font-semibold tabular-nums text-primary">{{ segmentLevelLabel(stage) }}</TableHead>
                  <TableCell class="max-w-[190px] break-words px-3 py-2 font-medium text-foreground">{{ actionName(stage) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right tabular-nums text-foreground/85">{{ formatCount(stage.completionCount) }}</TableCell>
                  <TableCell class="max-w-[240px] whitespace-pre-line break-words px-3 py-2 leading-5 text-muted-foreground">{{ drinkSummary(stage) }}</TableCell>
                  <TableCell class="max-w-[260px] break-words px-3 py-2 text-muted-foreground">{{ routeEquipmentSummary(stage) }}</TableCell>
                  <TableCell class="px-3 py-2 text-right font-semibold tabular-nums" :class="amountClass(stage.netCost)">{{ formatAmount(stage.netCost) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>

        <section class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-success">{{ t("common:skilling.inputMaterials", "Input ledger") }}</h3>
          <div class="overflow-x-auto"><Table class="min-w-[760px] w-full text-left text-xs"><TableHeader class="border-y border-border text-[10px] uppercase text-muted-foreground"><TableRow><TableHead class="px-3 py-2">{{ t("common:skilling.item", "Item") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.quantity", "Quantity") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.owned", "From inventory") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.purchase", "Purchase") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.opportunityUnit", "Opportunity unit") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.ask", "Ask") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.value", "Value") }}</TableHead></TableRow></TableHeader><TableBody class="divide-y divide-border"><TableRow v-for="row in activeSegment.inputItems" :key="`${row.itemHrid}-${row.enhancementLevel || 0}`"><TableCell class="px-3 py-2"><span class="flex items-center gap-2"><svg v-if="itemIconVisible(row.itemHrid)" class="h-7 w-7" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(row.itemHrid)"></use></svg><span>{{ itemName(row.itemHrid) }}<template v-if="row.enhancementLevel > 0"> +{{ row.enhancementLevel }}</template></span></span></TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.count) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.ownedCount) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.purchaseCount) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatAmount(row.opportunityUnitPrice) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatAmount(row.purchaseUnitPrice) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums text-primary">{{ formatAmount(Number(row.opportunityCost || 0) + Number(row.purchaseCost || 0)) }}</TableCell></TableRow></TableBody></Table></div>
        </section>

        <section class="pt-2">
          <h3 class="mb-2 font-heading text-sm font-semibold text-success">{{ t("common:skilling.outputMaterials", "Output ledger") }}</h3>
          <div class="overflow-x-auto"><Table class="min-w-[560px] w-full text-left text-xs"><TableHeader class="border-y border-border text-[10px] uppercase text-muted-foreground"><TableRow><TableHead class="px-3 py-2">{{ t("common:skilling.item", "Item") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.quantity", "Quantity") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.recoveryUnit", "Recovery unit") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.value", "Value") }}</TableHead></TableRow></TableHeader><TableBody class="divide-y divide-border"><TableRow v-for="row in activeSegment.outputItems" :key="`${row.itemHrid}-${row.enhancementLevel || 0}`"><TableCell class="px-3 py-2"><span class="flex items-center gap-2"><svg v-if="itemIconVisible(row.itemHrid)" class="h-7 w-7" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(row.itemHrid)"></use></svg><span>{{ itemName(row.itemHrid) }}<template v-if="row.enhancementLevel > 0"> +{{ row.enhancementLevel }}</template></span></span></TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatCount(row.count) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatAmount(row.liquidationUnitPrice) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums text-success">{{ formatAmount(row.liquidationValue) }}</TableCell></TableRow></TableBody></Table></div>
        </section>
      </template>
    </BaseModal>

    <BaseModal :open="pricesModalOpen" :title="t('common:skilling.marketPrices', 'Market prices and overrides')" panel-class="max-w-6xl max-h-[88vh] overflow-y-auto overscroll-contain" initial-focus-selector="[data-skilling-price-input]" @close="pricesModalOpen = false">
      <div v-if="priceRows.length" class="overflow-x-auto" data-skilling-prices>
        <Table class="min-w-[980px] w-full text-left text-xs">
          <TableHeader class="border-y border-border text-[10px] uppercase text-muted-foreground"><TableRow><TableHead class="px-3 py-2">{{ t("common:skilling.item", "Item") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.marketAsk", "Market ask") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.marketBid", "Market bid") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.vendor", "Vendor") }}</TableHead><TableHead class="px-3 py-2">{{ t("common:skilling.overrideAsk", "Override ask") }}</TableHead><TableHead class="px-3 py-2">{{ t("common:skilling.overrideBid", "Override bid") }}</TableHead><TableHead class="px-3 py-2 text-right">{{ t("common:skilling.clear", "Clear") }}</TableHead></TableRow></TableHeader>
          <TableBody class="divide-y divide-border">
            <TableRow v-for="row in priceRows" :key="row.priceKey">
              <TableHead scope="row" class="px-3 py-2 text-left"><span class="flex items-center gap-2"><svg v-if="itemIconVisible(row.itemHrid)" class="h-8 w-8" viewBox="0 0 50 50" aria-hidden="true"><use :href="itemIconHref(row.itemHrid)"></use></svg><span class="font-semibold text-foreground">{{ itemName(row.itemHrid) }}<template v-if="row.enhancementLevel > 0"> +{{ row.enhancementLevel }}</template></span></span></TableHead>
              <TableCell class="px-3 py-2 text-right tabular-nums">{{ formatPrice(row.marketAsk) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatPrice(row.marketBid) }}</TableCell><TableCell class="px-3 py-2 text-right tabular-nums">{{ formatPrice(row.vendor) }}</TableCell>
              <TableCell class="px-3 py-2"><input :data-skilling-price-input="row.overrideDisabled ? null : ''" class="control-input !rounded !px-2 !py-1.5 text-xs" type="number" :name="`skilling-price-${viewDomKey(row.priceKey)}-ask`" autocomplete="off" inputmode="decimal" min="0" step="any" :aria-label="priceOverrideAriaLabel(row, 'ask')" :disabled="row.overrideDisabled" :value="overrideValue(row, 'ask')" @change="setPriceOverride(row.itemHrid, 'ask', $event)" /></TableCell>
              <TableCell class="px-3 py-2"><input class="control-input !rounded !px-2 !py-1.5 text-xs" type="number" :name="`skilling-price-${viewDomKey(row.priceKey)}-bid`" autocomplete="off" inputmode="decimal" min="0" step="any" :aria-label="priceOverrideAriaLabel(row, 'bid')" :disabled="row.overrideDisabled" :value="overrideValue(row, 'bid')" @change="setPriceOverride(row.itemHrid, 'bid', $event)" /></TableCell>
              <TableCell class="px-3 py-2 text-right"><button type="button" class="button-secondary !rounded !px-2 !py-1 text-[11px]" :aria-label="priceClearAriaLabel(row)" :disabled="row.overrideDisabled" @click="skilling.resetPriceOverride(row.itemHrid)">{{ t("common:skilling.clear", "Clear") }}</button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p v-else class="py-8 text-center text-sm text-muted-foreground">{{ t("common:skilling.noPriceRows", "No route price rows yet.") }}</p>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CircleHelp } from "@lucide/vue";
import BaseModal from "../components/BaseModal.vue";
import { Progress } from "../components/ui/progress/index.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select/index.js";
import { useI18nText } from "../composables/useI18nText.js";
import { useGameDataText } from "../composables/useGameDataText.js";
import { itemDetailIndex } from "../../shared/gameDataIndex.js";
import { ensureItemIconSymbols, hasItemIconSymbol, itemIconHref } from "../../services/itemIconSprite.js";
import { formatCompactAmount } from "../../services/amountFormatting.js";
import { applyTampermonkeySkillingImportMessage } from "../../services/tampermonkeyImportBridge.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useSkillingStore } from "../../stores/skillingStore.js";
import { buildSkillingDrinkStatuses } from "../skillingDrinkPresentation.js";
import { buildSkillingRangeSummary } from "../skillingRangeSummary.js";

const TAMPERMONKEY_BRIDGE_CHANNEL = "mwi-tm-bridge";
const SNAPSHOT_WARNING_MS = 30 * 60 * 1000;
const skilling = useSkillingStore();
const simulator = useSimulatorStore();
const { language, t } = useI18nText();
const { getActionName, getItemName, getSkillName } = useGameDataText();
const pricesModalOpen = ref(false);
const segmentModalOpen = ref(false);
const modeHelpModalOpen = ref(false);
const activeSegment = ref(null);
const activeSegmentIsCandidate = ref(false);
const activeSegmentIsRangeSummary = computed(() => activeSegment.value?.isRangeSummary === true);
const activeConsumedDrinks = computed(() => (
  (activeSegment.value?.drinks || []).filter((drink) => Number(drink?.count) > 1e-9)
));
const activeRouteStages = computed(() => (
  Array.isArray(activeSegment.value?.phases) ? activeSegment.value.phases : []
));
const activeSegmentTitle = computed(() => {
  if (activeSegmentIsCandidate.value) {
    return t("common:skilling.nextLevelCandidateDetails", "Next-level candidate details");
  }
  if (activeSegmentIsRangeSummary.value) {
    return t("common:skilling.routeDetailsWithRange", "Route details · {{range}}", {
      range: segmentLevelLabel(activeSegment.value),
    });
  }
  return t("common:skilling.routeDetails", "Route details");
});
const activeEquipmentStrategies = computed(() => {
  if (!activeSegment.value) return [];
  if (activeSegment.value.equipmentStrategies?.length) {
    return activeSegment.value.equipmentStrategies;
  }
  return [{
    equipmentSignature: activeSegment.value.equipmentSignature || "",
    equipment: activeSegment.value.equipment || [],
    completionCount: activeSegment.value.completionCount,
    durationHours: activeSegment.value.durationHours,
  }];
});
const itemIconRevision = ref(0);
const clockNow = ref(Date.now());
let itemIconLoadQueue = Promise.resolve(0);
let clockInterval = null;

const skillHrids = computed(() => skilling.skillHrids);
const tabs = computed(() => [
  { id: "overview", label: t("common:skilling.overview", "Overview") },
  ...skillHrids.value.map((skillHrid) => ({ id: skillHrid, label: skillName(skillHrid) })),
]);
const optimizationModes = computed(() => [
  { value: "cost", label: t("common:skilling.lowestCostPerXp", "Lowest net cost / XP") },
  { value: "balanced", label: t("common:skilling.balanced", "Balanced") },
  { value: "speed", label: t("common:skilling.speedFirst", "Speed first") },
]);
const runScopes = computed(() => [
  { value: "single", label: t("common:skilling.runScopeSingle", "Single") },
  { value: "all", label: t("common:skilling.runScopeAll", "All") },
]);
const requestedSkillHrids = computed(() => (
  skilling.runScope === "single"
    ? [skilling.selectedRunSkillHrid].filter((skillHrid) => skillHrids.value.includes(skillHrid))
    : skillHrids.value
));
const selectedSkillHrid = computed(() => skillHrids.value.includes(skilling.selectedView) ? skilling.selectedView : skillHrids.value[0]);
const selectedPlan = computed(() => skilling.plansBySkill[selectedSkillHrid.value] || null);
const selectedRangeSummary = computed(() => {
  const plan = selectedPlan.value;
  if (!plan?.segments?.length) return null;
  const completedRange = plan.status === "ok"
    ? { startLevel: plan.startLevel, targetLevel: plan.targetLevel }
    : {};
  return buildSkillingRangeSummary(plan.segments, completedRange);
});
const balancedCostTolerancePercent = computed(() => normalizeTolerancePercent(skilling.balancedCostTolerance));
const balancedCostTolerancePercentText = computed(() => formatTolerancePercent(balancedCostTolerancePercent.value));
const resultBalancedCostTolerance = computed(() => {
  const recordedTolerance = skilling.result?.balancedCostTolerance ?? selectedPlan.value?.balancedCostTolerance;
  if (recordedTolerance == null || recordedTolerance === "") return null;
  const numeric = Number(recordedTolerance);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
});
const resultBalancedCostTolerancePercent = computed(() => (
  resultBalancedCostTolerance.value == null ? null : normalizeTolerancePercent(resultBalancedCostTolerance.value)
));
const resultBalancedCostTolerancePercentText = computed(() => formatTolerancePercent(resultBalancedCostTolerancePercent.value));
const resultRecordedOptimizationMode = computed(() => (
  skilling.result?.optimizationMode || selectedPlan.value?.optimizationMode || ""
));
const balancedToleranceResultDiffers = computed(() => (
  skilling.resultStale
  && resultRecordedOptimizationMode.value === "balanced"
  && resultBalancedCostTolerance.value != null
  && Math.abs(resultBalancedCostTolerance.value - Number(skilling.balancedCostTolerance)) > 1e-12
));
const resultOptimizationMode = computed(() => {
  if (skilling.resultStale) return "";
  return skilling.result?.optimizationMode || selectedPlan.value?.optimizationMode || "";
});
const resultUsesCostMode = computed(() => resultOptimizationMode.value === "cost");
const resultUsesBalancedMode = computed(() => resultOptimizationMode.value === "balanced");
const resultUsesSpeedMode = computed(() => resultOptimizationMode.value === "speed");
const resultHighlightsCost = computed(() => resultUsesCostMode.value || resultUsesBalancedMode.value);
const resultHighlightsDuration = computed(() => resultUsesSpeedMode.value || resultUsesBalancedMode.value);
const progressPercent = computed(() => Math.max(0, Math.min(100, Math.round(Number(skilling.progress?.overallProgress || 0) * 100))));
const progressLabel = computed(() => t("common:skilling.progress", "Planning {{skill}}: {{percent}}%", {
  skill: skillName(skilling.progress?.skillHrid || selectedSkillHrid.value),
  percent: progressPercent.value,
}));
const plannerActionLabel = computed(() => {
  if (skilling.running) return t("common:skilling.cancel", "Cancel");
  if (skilling.runScope === "single") {
    return t("common:skilling.calculateSelected", "Calculate {{skill}}", {
      skill: skillName(skilling.selectedRunSkillHrid),
    });
  }
  return t("common:skilling.calculateAll", "Calculate all");
});
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
const foragingProcessingNoticeVisible = computed(() => {
  const skillHrid = "/skills/foraging";
  const currentLevel = Math.max(1, Number(skilling.profile?.skills?.[skillHrid]?.level || 1));
  const targetLevel = Number(skilling.targetLevels?.[skillHrid] ?? currentLevel);
  const resultPlan = skilling.plansBySkill?.[skillHrid];
  const resultIncludesUpgrade = Boolean(resultPlan && (
    Number(resultPlan.targetLevel) > Number(resultPlan.startLevel)
    || resultPlan.segments?.length > 0
  ));
  const nextRunIncludesUpgrade = requestedSkillHrids.value.includes(skillHrid)
    && targetLevel > currentLevel;
  return Boolean(skilling.profile && (resultIncludesUpgrade || nextRunIncludesUpgrade));
});
const buffExpiredSinceResult = computed(() => {
  const generatedAt = Number(skilling.result?.generatedAt || 0);
  return generatedAt > 0 && temporaryBuffExpirations.value.some((expiresAt) => expiresAt > generatedAt && expiresAt <= clockNow.value);
});
const resultGeneratedLabel = computed(() => formatDate(skilling.result?.generatedAt));
const priceStatusText = computed(() => {
  if (skilling.priceStatus.loading) return t("common:skilling.refreshing", "Refreshing…");
  if (skilling.priceStatus.error) return skilling.priceStatus.error;
  return skilling.priceStatus.ready
    ? t("common:skilling.pricesReady", "Prices ready")
    : t("common:skilling.pricesUnavailable", "Prices unavailable");
});
const priceStatusClass = computed(() => {
  if (skilling.priceStatus.error) return "border-destructive/40 bg-destructive/10 text-destructive";
  if (skilling.priceStatus.ready) return "border-success/40 bg-success/10 text-success";
  return "border-primary/40 bg-primary/10 text-primary";
});
const overviewRows = computed(() => {
  const rankBySkill = new Map((skilling.overview || []).map((plan, index) => [plan.skillHrid, index + 1]));
  const rankedSkillHrids = (skilling.overview || []).map((plan) => plan.skillHrid).filter((skillHrid) => skillHrids.value.includes(skillHrid));
  const recordedSkillHrids = Array.isArray(skilling.result?.skillHrids)
    ? skilling.result.skillHrids.filter((skillHrid) => skillHrids.value.includes(skillHrid))
    : Object.keys(skilling.plansBySkill || {}).filter((skillHrid) => skillHrids.value.includes(skillHrid));
  const visibleSkillHrids = skilling.result && recordedSkillHrids.length > 0
    ? recordedSkillHrids
    : skillHrids.value;
  const orderedSkillHrids = [
    ...rankedSkillHrids,
    ...visibleSkillHrids.filter((skillHrid) => !rankedSkillHrids.includes(skillHrid)),
  ];
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
    { label: t("common:skilling.purchaseCost", "Market purchases"), value: formatAmount(plan?.totalPurchaseCost), className: "text-foreground" },
    { label: t("common:skilling.opportunityCost", "Inventory opportunity cost"), value: formatAmount(plan?.totalOpportunityCost), className: "text-foreground" },
    { label: t("common:skilling.outputValue", "Expected recovery"), value: formatAmount(plan?.totalOutputValue), className: "text-success" },
    { label: t("common:skilling.duration", "Time"), value: formatDuration(plan?.totalDurationHours), className: "text-foreground" },
    { label: t("common:skilling.xpPerHour", "XP/h"), value: formatAmount(plan?.experiencePerHour), className: "text-foreground" },
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

function normalizeTolerancePercent(value) {
  const numeric = Number(value);
  const tolerance = Number.isFinite(numeric) ? numeric : 0.1;
  return Math.round(Math.max(0, Math.min(1, tolerance)) * 10_000) / 100;
}

function formatTolerancePercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat(displayLocale(), { maximumFractionDigits: 2 }).format(Number(value));
}

function tolerancePercentFromInput(input) {
  const rawValue = String(input?.value ?? "").trim();
  if (!rawValue) return null;
  const parsedPercent = Number(rawValue);
  if (!Number.isFinite(parsedPercent)) return null;
  return Math.round(Math.max(0, Math.min(100, parsedPercent)) * 100) / 100;
}

function setBalancedCostTolerance(event) {
  const input = event?.target;
  const percent = tolerancePercentFromInput(input);
  if (percent == null) return;
  skilling.setBalancedCostTolerance(percent / 100);
}

function normalizeBalancedCostToleranceInput(event) {
  const input = event?.target;
  const percent = tolerancePercentFromInput(input);
  if (percent != null) skilling.setBalancedCostTolerance(percent / 100);
  if (input) input.value = String(balancedCostTolerancePercent.value);
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

function routeRecipeSummary(route) {
  const actionHrids = Array.isArray(route?.actionHrids)
    ? route.actionHrids.filter(Boolean)
    : [route?.actionHrid].filter(Boolean);
  if (actionHrids.length <= 1) {
    const actionHrid = actionHrids[0] || route?.actionHrid;
    return getActionName(actionHrid, route?.actionName || String(actionHrid || "").split("/").pop() || "-");
  }
  return t("common:skilling.multipleRecipes", "{{count}} recipes (see details)", {
    count: formatCount(actionHrids.length),
  });
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
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat(displayLocale(), { maximumFractionDigits: 2 }).format(Number(value));
}

function formatPrice(value) {
  return value == null ? "-" : formatAmount(value);
}

function formatDuration(hours) {
  if (hours == null || hours === "") return "-";
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
  return Number(value) < 0 ? "text-success" : "text-primary";
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
  if (!plan) return "border-border text-muted-foreground";
  if (plan.status === "blocked") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (plan.status === "complete") return "border-border bg-muted/40 text-foreground/85";
  return "border-success/40 bg-success/10 text-success";
}

function joinItemRows(rows, countField, emptyKey, emptyFallback) {
  if (!rows?.length) return t(emptyKey, emptyFallback);
  return rows.slice(0, 3).map((row) => `${itemName(row.itemHrid)} ${t("common:skilling.countTimes", "x{{count}}", { count: formatCount(row[countField]) })}`).join(", ")
    + (rows.length > 3 ? ` +${rows.length - 3}` : "");
}

function drinkSummary(segment) {
  const statuses = buildSkillingDrinkStatuses(segment);
  if (!statuses.length) return t("common:skilling.noDrinks", "No new drinks this stage");
  return statuses.map((status) => {
    const parts = [];
    if (status.continued && status.consumedCount > 1e-9) {
      parts.push(t("common:skilling.drinkContinuedWithNew", "continued, plus x{{count}}", {
        count: formatCount(status.consumedCount),
      }));
    } else if (status.continued) {
      parts.push(t("common:skilling.drinkContinued", "continued"));
    } else if (status.consumedCount > 1e-9) {
      parts.push(t("common:skilling.drinkConsumed", "consumed x{{count}} this stage", {
        count: formatCount(status.consumedCount),
      }));
    }
    if (status.remainingSeconds > 1e-9) {
      parts.push(t("common:skilling.drinkRemaining", "{{duration}} left", {
        duration: formatDuration(Math.max(1, status.remainingSeconds) / 3600),
      }));
    } else if (status.usedUp) {
      parts.push(t("common:skilling.drinkUsedUp", "used up this stage"));
    }
    return [itemName(status.itemHrid), ...parts].join(" · ");
  }).join("\n");
}

function candidateDrinkSummary(candidate) {
  if (!candidate?.drinks?.length) return t("common:skilling.noCandidateDrinks", "None");
  return candidate.drinks.map((drink) => {
    const count = Number(drink?.count);
    if (!Number.isFinite(count) || count <= 1e-9) return itemName(drink?.itemHrid);
    return `${itemName(drink?.itemHrid)} ${t("common:skilling.countTimes", "x{{count}}", {
      count: formatCount(count),
    })}`;
  }).join("\n");
}

function segmentLevelLabel(segment) {
  const fromLevel = Number(segment?.fromLevel);
  const toLevel = Number(segment?.toLevel);
  if (Number.isFinite(fromLevel) && fromLevel === toLevel) {
    return t("common:skilling.levelInProgress", "{{level}} (in progress)", { level: fromLevel });
  }
  return `${formatCount(fromLevel)} -> ${formatCount(toLevel)}`;
}

function rangeDetailsAriaLabel(summary) {
  return t("common:skilling.rangeDetailsAriaLabel", "Details: {{skill}} {{range}}", {
    skill: skillName(selectedSkillHrid.value),
    range: segmentLevelLabel(summary),
  });
}

function countTimesLabel(value) {
  return t("common:skilling.countTimes", "x{{count}}", { count: formatCount(value) });
}

function candidateDetailsAriaLabel(candidate, index) {
  return `${t("common:skilling.details", "Details")}: #${index + 1} · ${actionName(candidate)}`;
}

function equipmentSummary(segment) {
  if (!segment?.equipment?.length) return t("common:skilling.noEquipment", "None");
  return segment.equipment.slice(0, 3).map((item) => `${itemName(item.itemHrid)} +${item.enhancementLevel}`).join(", ")
    + (segment.equipment.length > 3
      ? `, ${t("common:skilling.additionalEquipment", "… {{count}} more", { count: segment.equipment.length - 3 })}`
      : "");
}

function routeEquipmentSummary(route) {
  const strategies = route?.equipmentStrategies || [];
  if (strategies.length > 1) {
    return t("common:skilling.stagedEquipment", "Changes by stage ({{count}} loadouts; see details)", {
      count: strategies.length,
    });
  }
  return equipmentSummary(strategies[0] || route);
}

function candidateEquipmentSummary(candidate) {
  return routeEquipmentSummary(candidate);
}

function totalDrinkSummary(route) {
  const consumed = (route?.drinks || []).filter((drink) => Number(drink?.count) > 1e-9);
  return joinItemRows(consumed, "count", "common:skilling.noCandidateDrinks", "None");
}

function stageCountLabel(route) {
  return t("common:skilling.stageCount", "{{count}} execution stages", {
    count: formatCount(route?.phaseCount ?? route?.phases?.length ?? 1),
  });
}

function routeStageKey(stage, index) {
  return [
    stage?.fromLevel,
    stage?.toLevel,
    stage?.actionHrid,
    stage?.equipmentSignature,
    stage?.drinkSignature,
    stage?.bonusSignature,
    index,
  ].join("-");
}

function equipmentStageLabel(strategy, index) {
  return t("common:skilling.equipmentStage", "Stage {{index}} · {{actions}} actions · {{duration}}", {
    index: index + 1,
    actions: formatCount(strategy?.completionCount),
    duration: formatDuration(strategy?.durationHours),
  });
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

function setRunSkill(value) {
  const selected = String(value || "");
  skilling.setSelectedRunSkillHrid(selected);
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

function openSegment(segment, isCandidate = false) {
  activeSegment.value = segment;
  activeSegmentIsCandidate.value = isCandidate;
  segmentModalOpen.value = true;
  void loadItemIcons([
    ...(segment?.equipment || []).map((item) => item.itemHrid),
    ...(segment?.equipmentStrategies || []).flatMap((strategy) => (
      (strategy?.equipment || []).map((item) => item.itemHrid)
    )),
    ...(segment?.drinks || []).map((item) => item.itemHrid),
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
