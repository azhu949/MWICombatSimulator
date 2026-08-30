<template>
  <SidebarProvider>
    <AppSidebar
      :version="appVersion"
      :unread-patch-notes-count="patchNotesUnreadCount"
      :patch-notes-label="patchNotesButtonAriaLabel"
      @feedback="openFeedbackModal"
      @open-patch-notes="openPatchNotesUnreadModal"
    />

    <SidebarInset :style="{ '--app-sticky-shell-height': stickyShellHeight }">
      <header
        class="sticky top-0 z-40 border-b border-border bg-background/94 backdrop-blur supports-[backdrop-filter]:bg-background/84"
      >
        <div class="mx-auto flex h-12 max-w-[1500px] items-center gap-2 px-3 sm:px-5">
          <SidebarTrigger class="md:hidden" mobile />
          <SidebarTrigger class="hidden md:inline-flex" />
          <div class="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <h1 class="min-w-0 flex-1 truncate font-heading text-sm font-semibold text-foreground">
            {{ currentPageTitle }}
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="themeToggleAriaLabel"
            :title="themeToggleAriaLabel"
            @click="toggleTheme"
          >
            <Sun v-if="theme === 'dark'" />
            <Moon v-else />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :aria-label="languageToggleAriaLabel"
            :title="languageToggleAriaLabel"
            @click="switchLanguage(languageToggleTarget)"
          >
            <Languages />{{ languageToggleLabel }}
          </Button>
        </div>
      </header>

      <CombatCommandBar
        v-if="showCombatToolbar"
        :players="simulator.players"
        :active-player-id="simulator.activePlayerId"
        :queue-actions-disabled="queueActionsDisabled"
        :has-baseline="activeQueueHasBaseline"
        :party-mismatch="activeQueuePartyMismatch"
        :item-count="activeQueueItemCount"
        :queue-progress-text="activeQueueProgressText"
        :party-summary-text="activeQueuePartySummaryText"
        :party-warning-text="activeQueuePartyWarningText"
        :action-status-text="topQueueActionStatusText"
        :action-status-class="topQueueActionStatusClass"
        :show-simulation-actions="showHomeSimulationActions"
        :simulation-running="simulator.runtime.isRunning"
        :simulation-actions-disabled="queueActionsDisabled"
        :show-runtime-summary="showRuntimeSummary"
        :runtime-progress="simulator.runtime.progress"
        :runtime-error="simulator.runtime.error"
        :progress-label="progressLabel"
        @set-baseline="setQueueBaselineFromTopbar"
        @add-queue="addToQueueFromTopbar"
        @run-queue="runQueueFromTopbar"
        @clear-queue="clearQueueFromTopbar"
        @select-player="simulator.setActivePlayer"
        @start-simulation="simulator.startSimulation()"
        @stop-simulation="simulator.stopSimulation()"
        @height-change="setCombatCommandBarHeight"
        @view-error="openGlobalError('runtime', $event)"
      />

      <main class="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5 sm:py-5">
        <RouterView />
      </main>
    </SidebarInset>

    <BaseModal
      :open="globalErrorModalOpen"
      :title="t('common:vue.app.globalErrorTitle', 'Error')"
      @close="globalErrorModalOpen = false"
    >
      <p class="text-sm text-foreground/85">
        {{ t('common:vue.app.globalErrorDesc', 'Please copy the following details if you report this issue.') }}
      </p>
      <pre
        class="max-h-[320px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-destructive"
        >{{ globalErrorText }}</pre>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="button-primary" @click="copyGlobalError">
          {{ t('common:vue.common.copy', 'Copy') }}
        </button>
        <span class="text-xs text-muted-foreground">{{ errorCopyStatus }}</span>
      </div>
    </BaseModal>

    <BaseModal
      :open="feedbackModalOpen"
      :title="t('common:vue.app.feedback', 'Feedback')"
      initial-focus-selector="[data-feedback-copy]"
      @close="closeFeedbackModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground/85">
          {{
            t('common:vue.app.feedbackHint', 'Use the following channels for feedback, bug reports, or suggestions.')
          }}
        </p>

        <div class="feedback-contact-list">
          <div class="feedback-contact-row">
            <div class="min-w-0">
              <p class="feedback-contact-label">{{ t('common:vue.app.feedbackQqLabel', 'QQ Group') }}</p>
              <p class="feedback-contact-value">{{ QQ_GROUP_NUMBER }}</p>
            </div>
            <button
              type="button"
              class="button-secondary text-xs"
              data-feedback-copy
              @click="copyFeedbackContact(QQ_GROUP_NUMBER)"
            >
              {{ t('common:vue.common.copy', 'Copy') }}
            </button>
          </div>

          <div class="feedback-contact-row">
            <div class="min-w-0">
              <p class="feedback-contact-label">{{ t('common:vue.app.feedbackEmailLabel', 'QQ Email') }}</p>
              <a class="feedback-contact-link" :href="`mailto:${FEEDBACK_EMAIL}`">{{ FEEDBACK_EMAIL }}</a>
            </div>
            <button type="button" class="button-secondary text-xs" @click="copyFeedbackContact(FEEDBACK_EMAIL)">
              {{ t('common:vue.common.copy', 'Copy') }}
            </button>
          </div>
        </div>

        <p class="text-xs text-muted-foreground">{{ feedbackCopyStatus }}</p>
      </div>
    </BaseModal>

    <BaseModal
      :open="simulationCompleteModalOpen"
      :title="t('common:vue.app.simulationCompleteTitle', 'Simulation completed')"
      initial-focus-selector="[data-simulation-results-confirm]"
      @close="closeSimulationCompleteModal"
    >
      <p class="text-sm text-foreground/85">
        {{ t('common:vue.app.simulationCompleteDesc', 'Simulation completed. Go to Home results now?') }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="button-primary" data-simulation-results-confirm @click="goToHomeResults">
          {{ t('common:vue.app.goToHomeResults', 'Go to Home Results') }}
        </button>
        <button type="button" class="button-secondary" @click="closeSimulationCompleteModal">
          {{ t('common:vue.app.stayHere', 'Stay Here') }}
        </button>
      </div>
    </BaseModal>

    <BaseModal
      :open="baselineReminderModalOpen"
      :title="t('common:queue.baselineReminderTitle', 'Baseline Rounds Reminder')"
      initial-focus-selector="[data-baseline-reminder-acknowledge]"
      @close="closeBaselineReminderModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground/85">
          {{
            t(
              'common:queue.baselineReminderBody',
              'Fewer baseline rounds can make the result more volatile. Adjust the setting first if you want a more stable baseline.',
            )
          }}
        </p>
        <p class="text-sm text-primary">
          {{ baselineReminderCurrentRoundsText }}
        </p>
        <p class="text-xs text-primary">
          {{
            t(
              'common:queue.baselineRecommendationHint',
              'Recommended: at least 10 rounds, with 20-30 as the usual stable range; use 50+ when comparing very close options.',
            )
          }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{
            t(
              'common:queue.baselineReminderAggregationHint',
              'Set Baseline runs multiple rounds using the current baseline round count and uses the aggregated result as the queue comparison baseline.',
            )
          }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="button-primary"
            data-baseline-reminder-acknowledge
            @click="acknowledgeBaselineReminderAndRun"
          >
            {{ t('common:queue.baselineReminderAcknowledge', "I understand, don't show again") }}
          </button>
          <button type="button" class="button-secondary" @click="openBaselineReminderSettings">
            {{ t('common:queue.baselineReminderGoToSettings', 'Go to Settings') }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="queueCompleteModalOpen"
      :title="t('common:queue.queueRunning', 'Running queue...')"
      initial-focus-selector="[data-multi-results-confirm]"
      @close="closeQueueCompleteModal"
    >
      <p class="text-sm text-foreground/85">
        {{ t('common:vue.app.queueCompleteDesc', 'Queue run started. Go to the Multi-round page now?') }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="button-primary" data-multi-results-confirm @click="goToMultiResults">
          {{ t('common:vue.app.goToMultiResults', 'Go to Multi-round') }}
        </button>
        <button type="button" class="button-secondary" @click="closeQueueCompleteModal">
          {{ t('common:vue.app.stayHere', 'Stay Here') }}
        </button>
      </div>
    </BaseModal>

    <BaseModal
      :open="equipmentPriceConfirmationModalOpen"
      :title="t('common:queue.confirmPriceChoiceTitle', 'Choose target equipment price')"
      panel-class="max-w-[96vw] lg:max-w-7xl"
      initial-focus-selector="[data-confirm-price-rows]"
      @close="cancelEquipmentPriceConfirmation"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground/85">
          {{
            t(
              'common:queue.confirmPriceChoiceBody',
              "Each changed equipment row can use a reference price, a manual price, or a Philosopher's Mirror combination. Review each row before confirming.",
            )
          }}
        </p>
        <p v-if="equipmentPriceConfirmationRefreshFailed" class="text-xs text-warning">
          {{
            t(
              'common:queue.confirmHourlyAverageCached',
              'The official market refresh failed. Review the fallback source and data time below.',
            )
          }}
        </p>

        <div class="rounded-md border border-border bg-muted/40 p-3">
          <p class="control-label">
            {{ t('common:queue.mirrorPriceShared', "Philosopher's Mirror price (shared)") }}
          </p>
          <div class="mt-1 flex items-center gap-2">
            <input
              type="text"
              inputmode="numeric"
              autocomplete="off"
              class="control-input !rounded !px-2 !py-1.5 text-xs w-32"
              :placeholder="t('common:queue.manualPricePlaceholder', 'Enter buy price (digits only)')"
              :value="sharedMirrorPriceDraft"
              @input="sanitizeSharedMirrorPriceInput"
            />
            <div
              class="flex h-7 shrink-0 items-center gap-0.5 rounded border border-input bg-background p-0.5"
              role="group"
              :aria-label="t('common:queue.manualPriceUnit', 'Buy price unit')"
            >
              <button
                v-for="unit in MANUAL_PRICE_UNITS"
                :key="unit.value"
                type="button"
                class="h-6 w-7 rounded-sm text-xs font-semibold transition-colors"
                :class="
                  sharedMirrorPriceUnit === unit.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                "
                :aria-pressed="sharedMirrorPriceUnit === unit.value"
                @click="setSharedMirrorPriceUnit(unit.value)"
              >
                {{ unit.value }}
              </button>
            </div>
            <span v-if="autoMirrorPrice != null" class="text-xs text-muted-foreground">
              {{
                t('common:queue.mirrorPriceAuto', FALLBACK_MIRROR_PRICE_AUTO, {
                  price: formatConfirmedMarketPrice(autoMirrorPrice),
                })
              }}
            </span>
          </div>
        </div>

        <div class="overflow-x-auto rounded-md border border-border" data-confirm-price-rows>
          <table class="w-full table-fixed text-left text-sm">
            <thead class="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th class="w-[13%] whitespace-nowrap px-3 py-2">
                  {{ t('common:queue.confirmPriceEquipment', 'Equipment') }}
                </th>
                <th class="w-[24%] whitespace-nowrap px-3 py-2">
                  {{ t('common:queue.confirmPriceMethod', 'Method') }}
                </th>
                <th class="w-[24%] whitespace-nowrap px-3 py-2">
                  {{ t('common:queue.confirmPriceReference', 'Reference Price') }}
                </th>
                <th class="w-[25%] whitespace-nowrap px-3 py-2">{{ t('common:queue.confirmPriceValue', 'Price') }}</th>
                <th class="w-[14%] whitespace-nowrap px-3 py-2">
                  {{ t('common:queue.confirmPriceMirrorCost', 'Mirror Cost') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in pendingEquipmentPriceConfirmations"
                :key="`${entry.itemHrid}|${entry.enhancementLevel}`"
                class="border-t border-border align-top"
              >
                <td class="w-[13%] whitespace-nowrap px-3 py-2">
                  {{ localizeHridDisplayName(entry.itemHrid) }}
                  <span class="text-muted-foreground">+{{ entry.enhancementLevel }}</span>
                </td>
                <td class="w-[24%] px-3 py-2">
                  <div class="flex flex-nowrap items-center gap-x-3">
                    <label
                      class="flex items-center gap-1.5 whitespace-nowrap text-xs"
                      :class="!hasReferencePrice(entry) ? 'cursor-not-allowed opacity-50' : ''"
                      :title="
                        !hasReferencePrice(entry)
                          ? t('common:queue.left1Unavailable', 'No reference price is available for this target.')
                          : ''
                      "
                    >
                      <input
                        type="radio"
                        :name="`price-method-${entry.itemHrid}-${entry.enhancementLevel}`"
                        :value="QUEUE_PRICE_METHOD_LEFT1"
                        :checked="getPriceMethod(entry) === QUEUE_PRICE_METHOD_LEFT1"
                        :disabled="!hasReferencePrice(entry)"
                        @change="setPriceMethod(entry, QUEUE_PRICE_METHOD_LEFT1)"
                      />
                      {{ t('common:queue.priceMethodLeft1', 'Left 1') }}
                    </label>
                    <label
                      class="flex items-center gap-1.5 whitespace-nowrap text-xs"
                      :class="!hasRealTargetBid(entry) ? 'cursor-not-allowed opacity-50' : ''"
                      :title="
                        !hasRealTargetBid(entry)
                          ? t('common:queue.right1Unavailable', 'No valid bid is available for this target.')
                          : ''
                      "
                    >
                      <input
                        type="radio"
                        :name="`price-method-${entry.itemHrid}-${entry.enhancementLevel}`"
                        :value="QUEUE_PRICE_METHOD_RIGHT1"
                        :checked="getPriceMethod(entry) === QUEUE_PRICE_METHOD_RIGHT1"
                        :disabled="!hasRealTargetBid(entry)"
                        @change="setPriceMethod(entry, QUEUE_PRICE_METHOD_RIGHT1)"
                      />
                      {{ t('common:queue.priceMethodRight1', 'Right 1') }}
                    </label>
                    <label class="flex items-center gap-1.5 whitespace-nowrap text-xs">
                      <input
                        type="radio"
                        :name="`price-method-${entry.itemHrid}-${entry.enhancementLevel}`"
                        :value="QUEUE_PRICE_METHOD_MANUAL"
                        :checked="getPriceMethod(entry) === QUEUE_PRICE_METHOD_MANUAL"
                        @change="setPriceMethod(entry, QUEUE_PRICE_METHOD_MANUAL)"
                      />
                      {{ t('common:queue.priceMethodManual', 'Manual') }}
                    </label>
                    <label
                      class="flex items-center gap-1.5 whitespace-nowrap text-xs"
                      :class="entry.mirrorPlan?.unavailable ? 'cursor-not-allowed opacity-50' : ''"
                      :title="
                        entry.mirrorPlan?.unavailable
                          ? t('common:queue.mirrorUnavailable', 'Mirror plan is unavailable for this target.')
                          : ''
                      "
                    >
                      <input
                        type="radio"
                        :name="`price-method-${entry.itemHrid}-${entry.enhancementLevel}`"
                        :value="QUEUE_PRICE_METHOD_MIRROR"
                        :checked="getPriceMethod(entry) === QUEUE_PRICE_METHOD_MIRROR"
                        :disabled="entry.mirrorPlan?.unavailable"
                        @change="setPriceMethod(entry, QUEUE_PRICE_METHOD_MIRROR)"
                      />
                      {{ t('common:queue.priceMethodMirror', 'Mirror') }}
                    </label>
                  </div>
                </td>
                <td class="w-[24%] px-3 py-2">
                  <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap text-xs">
                      <span>
                        {{ t('common:queue.confirmPriceLeft1', 'Left 1 (Buy)') }}:
                        <template v-if="entry.reference">{{
                          formatConfirmedMarketPrice(entry.reference.price)
                        }}</template>
                        <template v-else
                          ><span class="text-muted-foreground">{{
                            t('common:queue.confirmPriceMissing', '—')
                          }}</span></template
                        >
                      </span>
                      <span>
                        {{ t('common:queue.confirmPriceRight1', 'Right 1 (Sell)') }}:
                        <template v-if="hasRealTargetBid(entry)">{{
                          formatConfirmedMarketPrice(entry.targetBid.price)
                        }}</template>
                        <template v-else
                          ><span class="text-muted-foreground">{{
                            t('common:queue.confirmPriceMissing', '—')
                          }}</span></template
                        >
                      </span>
                    </div>
                    <span class="text-xs text-muted-foreground">
                      {{ formatConfirmationSource(entry)
                      }}<template v-if="isHistoricalAskEntry(entry)">
                        · {{ t('common:queue.confirmPriceDataTime', 'Data Time') }}:
                        {{ formatMarketDataTime(entry?.reference?.marketTimestamp) }}</template
                      >
                    </span>
                    <template v-if="hasMarketUpdate(entry)">
                      <span
                        class="inline-flex w-fit items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning"
                      >
                        {{ t('common:queue.marketUpdatedBadge', 'New price') }}
                      </span>
                      <span v-if="getMarketUpdateInfo(entry)?.currentPrice != null" class="text-xs text-foreground/85">
                        {{
                          t('common:queue.marketUpdatedCurrent', FALLBACK_MARKET_UPDATED_CURRENT, {
                            price: formatConfirmedMarketPrice(getMarketUpdateInfo(entry).currentPrice),
                          })
                        }}
                      </span>
                      <button
                        type="button"
                        class="button-secondary !px-2 !py-0.5 text-[11px]"
                        @click="useUpdatedReferencePrice(entry)"
                      >
                        {{ t('common:queue.marketUpdatedUseNew', 'Use new price') }}
                      </button>
                    </template>
                  </div>
                </td>
                <td class="px-3 py-2">
                  <template v-if="getPriceMethod(entry) === QUEUE_PRICE_METHOD_MANUAL">
                    <div class="flex items-center gap-1">
                      <input
                        type="text"
                        inputmode="numeric"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        data-manual-price-input
                        :data-price-key="getManualPriceKey(entry)"
                        class="control-input !rounded !px-2 !py-1.5 text-xs w-24"
                        :placeholder="t('common:queue.manualPricePlaceholder', 'Enter buy price (digits only)')"
                        :value="manualPriceDrafts[getManualPriceKey(entry)]"
                        @input="sanitizeManualPriceInput($event, entry)"
                      />
                      <div
                        class="flex h-7 shrink-0 items-center gap-0.5 rounded border border-input bg-background p-0.5"
                        role="group"
                        :aria-label="t('common:queue.manualPriceUnit', 'Buy price unit')"
                      >
                        <button
                          v-for="unit in MANUAL_PRICE_UNITS"
                          :key="unit.value"
                          type="button"
                          class="h-6 w-7 rounded-sm text-xs font-semibold transition-colors"
                          :class="
                            (manualPriceUnits[getManualPriceKey(entry)] || 'k') === unit.value
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          "
                          :aria-pressed="(manualPriceUnits[getManualPriceKey(entry)] || 'k') === unit.value"
                          @click="handleManualPriceUnitChange(unit.value, entry)"
                        >
                          {{ unit.value }}
                        </button>
                      </div>
                    </div>
                  </template>
                  <template v-else-if="getPriceMethod(entry) === QUEUE_PRICE_METHOD_MIRROR">
                    <div class="flex flex-col gap-1">
                      <div
                        v-for="(missingItem, mIndex) in getMirrorMissingLevels(entry)"
                        :key="`${getManualPriceKey(entry)}-mirror-input-${missingItem.level}`"
                        class="flex items-center gap-1"
                      >
                        <span
                          v-if="
                            mIndex === 0 &&
                            (!entry.mirrorPlan ||
                              entry.mirrorPlan.cost == null ||
                              (entry.mirrorPlan.missing && entry.mirrorPlan.missing.length > 0))
                          "
                          class="inline-flex shrink-0 items-center text-warning"
                          :title="getMirrorPlanMissingText(entry)"
                          role="alert"
                        >
                          <AlertTriangle class="h-4 w-4" />
                        </span>
                        <span
                          class="whitespace-nowrap text-xs text-muted-foreground"
                          :title="
                            t(
                              'common:queue.mirrorInputHint',
                              'Enter the buy price for this missing input piece (k/m/b unit)',
                            )
                          "
                        >
                          {{ formatMirrorInputMissingLevel(missingItem) }}
                        </span>
                        <input
                          type="text"
                          inputmode="numeric"
                          autocomplete="off"
                          autocapitalize="off"
                          spellcheck="false"
                          data-mirror-manual-input
                          :data-price-key="getManualPriceKey(entry)"
                          :data-mirror-level="missingItem.level"
                          class="control-input !rounded !px-1.5 !py-1 text-xs w-16"
                          :placeholder="t('common:queue.manualPricePlaceholder', 'Enter buy price (digits only)')"
                          :value="getMirrorInputDraft(entry, missingItem.level).raw"
                          @input="sanitizeMirrorManualPriceInput($event, entry, missingItem.level)"
                        />
                        <div
                          class="flex h-6 shrink-0 items-center gap-0.5 rounded border border-input bg-background p-0.5"
                          role="group"
                          :aria-label="t('common:queue.manualPriceUnit', 'Buy price unit')"
                        >
                          <button
                            v-for="unit in MANUAL_PRICE_UNITS"
                            :key="unit.value"
                            type="button"
                            class="h-5 w-6 rounded-sm text-[11px] font-semibold transition-colors"
                            :class="
                              getMirrorInputDraft(entry, missingItem.level).unit === unit.value
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            "
                            :aria-pressed="getMirrorInputDraft(entry, missingItem.level).unit === unit.value"
                            @click="handleMirrorManualPriceUnitChange(unit.value, entry, missingItem.level)"
                          >
                            {{ unit.value }}
                          </button>
                        </div>
                        <!-- 即时反馈：该输入按当前单位（k/m/b）解析出的实际价格，避免位数误判。 -->
                        <span
                          v-if="getMirrorInputResolvedPrice(entry, missingItem.level) != null"
                          class="whitespace-nowrap text-[11px] text-muted-foreground"
                        >
                          = {{ formatConfirmedMarketPrice(getMirrorInputResolvedPrice(entry, missingItem.level)) }}
                        </span>
                      </div>
                    </div>
                  </template>
                  <template v-else-if="getPriceMethod(entry) === QUEUE_PRICE_METHOD_RIGHT1">
                    <template v-if="hasRealTargetBid(entry)">
                      {{ formatConfirmedMarketPrice(entry.targetBid.price) }}
                    </template>
                    <template v-else>
                      <span class="text-muted-foreground">{{ t('common:queue.confirmPriceMissing', '—') }}</span>
                    </template>
                  </template>
                  <template v-else>
                    <template v-if="entry.reference">
                      {{ formatConfirmedMarketPrice(entry.reference.price) }}
                    </template>
                    <template v-else>
                      <span class="text-muted-foreground">{{ t('common:queue.confirmPriceMissing', '—') }}</span>
                    </template>
                  </template>
                  <p
                    v-if="manualPriceErrors[getManualPriceKey(entry)]"
                    class="mt-1 text-xs text-destructive"
                    role="alert"
                  >
                    {{ manualPriceErrors[getManualPriceKey(entry)] }}
                  </p>
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <template
                    v-if="
                      getPriceMethod(entry) === QUEUE_PRICE_METHOD_MIRROR &&
                      entry.mirrorPlan &&
                      entry.mirrorPlan.cost != null
                    "
                  >
                    <span
                      :class="
                        entry.reference && entry.mirrorPlan.cost > entry.reference.price
                          ? 'text-xs font-semibold text-destructive'
                          : 'text-xs font-semibold text-emerald-500'
                      "
                    >
                      {{ formatConfirmedMarketPrice(entry.mirrorPlan.cost) }}
                    </span>
                    <span v-if="entry.reference" class="ml-1 text-xs text-muted-foreground">
                      ({{
                        t('common:queue.mirrorVsDirect', FALLBACK_MIRROR_VS_DIRECT, {
                          price: formatConfirmedMarketPrice(entry.reference.price),
                        })
                      }})
                    </span>
                  </template>
                  <template v-else>
                    <span class="text-muted-foreground">{{ t('common:queue.confirmPriceMissing', '—') }}</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="button-primary" @click="confirmEquipmentPricesAndAdd">
            {{ t('common:queue.confirmFallbackPriceAction', 'Use these prices and enqueue') }}
          </button>
          <button type="button" class="button-secondary" @click="cancelEquipmentPriceConfirmation">
            {{ t('common:vue.common.cancel', 'Cancel') }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="patchNotesUnreadModalOpen"
      :title="t('common:patchNotes', 'Patch Notes')"
      panel-class="max-w-[96vw] lg:max-w-2xl"
      initial-focus-selector="[data-patch-notes-dismiss]"
      @close="closePatchNotesUnreadModal"
    >
      <div class="space-y-4">
        <p class="text-sm text-foreground/85">
          {{ patchNotesUnreadDialogText }}
        </p>
        <div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <article
            v-for="entry in patchNotesUnreadPreviewItems"
            :key="entry.entryId"
            class="rounded-lg border border-border bg-muted/30 p-4"
          >
            <h3 class="mb-3 font-heading text-sm font-semibold text-foreground">{{ entry.label }}</h3>
            <PatchNoteSections :sections="entry.sections" />
          </article>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="button-primary" data-patch-notes-view-all @click="viewAllPatchNotes">
            {{ t('common:vue.app.patchNotesViewAll', 'View all patch notes') }}
          </button>
          <button
            type="button"
            class="button-secondary"
            data-patch-notes-dismiss
            @click="closePatchNotesUnreadModal('programmatic')"
          >
            {{ t('common:vue.app.patchNotesDismiss', 'Close') }}
          </button>
        </div>
      </div>
    </BaseModal>
  </SidebarProvider>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { AlertTriangle, Languages, Moon, Sun } from '@lucide/vue';
import {
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from '../shared/gameDataIndex.js';
import BaseModal from './components/BaseModal.vue';
import AppSidebar from './components/AppSidebar.vue';
import CombatCommandBar from './components/CombatCommandBar.vue';
import PatchNoteSections from './components/PatchNoteSections.vue';
import { Button } from './components/ui/button/index.js';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './components/ui/sidebar/index.js';
import { useSimulatorStore } from '../stores/simulatorStore.js';
import { formatCompactAmountForLocale } from '../services/amountFormatting.js';
import { useGameDataText } from './composables/useGameDataText.js';
import { useI18nText } from './composables/useI18nText.js';
import { useTheme } from './composables/useTheme.js';
import {
  getUnreadPatchNoteEntries,
  initializePatchNotesState,
  markPatchNoteEntriesAsRead,
  resolvePatchNoteEntries,
} from './patchNotes.js';
import { dismissBaselineReminder, isBaselineReminderDismissed } from './baselineReminder.js';
import { deriveQueueItemStatusName } from './queueItemStatusPresentation.js';
import { evaluateManualPriceDraft, normalizeManualPriceDraft } from './queueManualPriceValidation.js';
import {
  computeMirrorPlan,
  mergeConfirmedPricesAndSelections,
  QUEUE_PRICE_METHOD_MANUAL,
  QUEUE_PRICE_METHOD_MIRROR,
  QUEUE_PRICE_METHOD_LEFT1,
  QUEUE_PRICE_METHOD_RIGHT1,
} from '../services/queueUpgradeCost.js';

const appVersion = __APP_VERSION__;

// 反馈联系方式——反馈弹窗的唯一数据来源。
const QQ_GROUP_NUMBER = '1102475742';
const FEEDBACK_EMAIL = '596846069@qq.com';

// i18n fallback 字符串常量——这些字符串包含 i18next 的 {{price}} 插值占位符。
// 必须在 <script setup> 中以普通 JS 字符串定义，而非直接写在 Vue 模板的 {{ t(...) }} 表达式内——
// 否则 Vue 模板编译器会将 {{price}} 误识别为嵌套插值导致编译错误。
// locale JSON 中已有对应翻译，这些常量仅在翻译缺失时作为 fallback 使用。
const FALLBACK_MIRROR_PRICE_AUTO = 'Auto: {{price}}';
const FALLBACK_MARKET_UPDATED_CURRENT = 'Now: {{price}}';
const FALLBACK_MIRROR_VS_DIRECT = 'direct {{price}}';
const simulator = useSimulatorStore();
const router = useRouter();
const route = useRoute();
const { theme, toggleTheme } = useTheme();
let deferredInitHandle = null;
const globalErrorModalOpen = ref(false);
const globalErrorText = ref('');
const errorCopyStatus = ref('');
const feedbackModalOpen = ref(false);
const feedbackCopyStatus = ref('');
const simulationCompleteModalOpen = ref(false);
const queueCompleteModalOpen = ref(false);
const baselineReminderModalOpen = ref(false);
const equipmentPriceConfirmationModalOpen = ref(false);
const pendingEquipmentPriceConfirmations = ref([]);
const equipmentPriceConfirmationRefreshFailed = ref(false);
const manualPriceDrafts = ref({});
const manualPriceUnits = ref({});
const manualPriceErrors = ref({});
const priceMethodByKey = ref({});
const sharedMirrorPriceDraft = ref('');
const sharedMirrorPriceUnit = ref('k');
const autoMirrorPrice = ref(null);
// prepareActivePlayerQueueAddition 异步拉取的历史 Ask 快照，供镜子方案取价链复用（与参考价列口径统一）。
const historicalQuotesMap = ref(null);
const marketUpdateByKey = ref({});
// 镜子方案缺价件手动补价草稿：{ [rowKey]: { [level]: { raw, unit, count } } }
const mirrorInputDrafts = ref({});
const queueAdditionPending = ref(false);
const pendingQueueDraftFingerprint = ref('');
const baselineReminderDismissed = ref(isBaselineReminderDismissed());
const patchNotesUnreadEntries = ref([]);
const patchNotesUnreadModalOpen = ref(false);
const patchNotesUnreadPreviewEntryIds = ref([]);
const topQueueActionStatus = ref({
  tone: 'secondary',
  text: '',
});
const { language, setLanguage, t } = useI18nText();
const { getAbilityName, getActionName, getEquipmentSlotName, getHouseRoomName, getItemName, getSkillName } =
  useGameDataText();
const showCombatToolbar = computed(() => route.meta?.showCombatToolbar !== false);
const showHomeSimulationActions = computed(() => route.name === 'home');
const combatCommandBarHeight = ref(0);
const stickyShellHeight = computed(() => `${48 + (showCombatToolbar.value ? combatCommandBarHeight.value : 0)}px`);
const currentPageTitle = computed(() =>
  t(route.meta?.navLabelKey || 'common:title', route.meta?.navLabel || 'MWI Combat Simulator'),
);

function setCombatCommandBarHeight(height) {
  const numericHeight = Number(height);
  combatCommandBarHeight.value = Number.isFinite(numericHeight) ? Math.max(0, numericHeight) : 0;
}

const progressLabel = computed(() => {
  const progress = Math.floor(simulator.runtime.progress * 100);
  const elapsed = simulator.runtime.elapsedSeconds.toFixed(1);
  return `${progress}% | ${elapsed}s`;
});

const themeToggleAriaLabel = computed(() =>
  theme.value === 'dark'
    ? t('common:vue.app.switchToLightTheme', 'Switch to light mode')
    : t('common:vue.app.switchToDarkTheme', 'Switch to dark mode'),
);
const languageToggleTarget = computed(() => (language.value === 'zh' ? 'en' : 'zh'));
const languageToggleLabel = computed(() => (language.value === 'zh' ? 'EN' : '中文'));
const languageToggleAriaLabel = computed(() =>
  language.value === 'zh'
    ? t('common:vue.app.switchToEnglish', 'Switch to English')
    : t('common:vue.app.switchToChinese', 'Switch to Chinese'),
);

const activeQueueState = computed(() => simulator.activeQueueState || null);
const activeQueuePartyStatus = computed(
  () => simulator.activeQueuePartyStatus || { hasMismatch: false, messageKey: '', memberNames: [] },
);
const activeQueuePartyMismatch = computed(() => Boolean(activeQueuePartyStatus.value?.hasMismatch));
const activeQueuePartySummaryText = computed(() =>
  Array.isArray(activeQueuePartyStatus.value?.memberNames) && activeQueuePartyStatus.value.memberNames.length > 0
    ? activeQueuePartyStatus.value.memberNames.join(' / ')
    : '',
);
const activeQueuePartyWarningText = computed(() =>
  activeQueuePartyMismatch.value
    ? t(
        activeQueuePartyStatus.value?.messageKey || 'common:queue.partyChangedSinceBaseline',
        activeQueuePartyStatus.value?.messageKey || 'common:queue.partyChangedSinceBaseline',
      )
    : '',
);
const queueActionsDisabled = computed(() =>
  Boolean(
    simulator.runtime?.isRunning ||
    activeQueueState.value?.isRunning ||
    simulator.advisor.runtime?.isRunning ||
    queueAdditionPending.value,
  ),
);
const activeQueueHasBaseline = computed(() => Boolean(activeQueueState.value?.baseline?.snapshot));
const activeQueueItemCount = computed(() =>
  Array.isArray(activeQueueState.value?.items) ? activeQueueState.value.items.length : 0,
);
const baselineReminderRoundCount = computed(() => {
  const parsed = Number(activeQueueState.value?.settings?.baselineRounds || 1);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
});
const baselineReminderCurrentRoundsText = computed(() =>
  t('common:queue.baselineReminderCurrentRounds', `Current baseline rounds: ${baselineReminderRoundCount.value}`, {
    count: baselineReminderRoundCount.value,
  }),
);
const showRuntimeSummary = computed(() => Boolean(simulator.runtime.isRunning || simulator.runtime.error));
const activeQueueProgressText = computed(() => {
  const progress = Number(activeQueueState.value?.progress || 0);
  if (!Number.isFinite(progress)) {
    return '0%';
  }
  const clamped = Math.max(0, Math.min(1, progress));
  return `${Math.floor(clamped * 100)}%`;
});
const hasSimulationResults = computed(
  () =>
    Boolean(simulator.results.simResult) ||
    (Array.isArray(simulator.results.simResults) && simulator.results.simResults.length > 0) ||
    (Array.isArray(simulator.results.summaryRows) && simulator.results.summaryRows.length > 0) ||
    (Array.isArray(simulator.results.batchRows) && simulator.results.batchRows.length > 0),
);
const topQueueActionStatusText = computed(() => topQueueActionStatus.value.text || '');
const topQueueActionStatusClass = computed(() => {
  if (topQueueActionStatus.value.tone === 'success') {
    return 'text-success';
  }
  if (topQueueActionStatus.value.tone === 'danger') {
    return 'text-destructive';
  }
  if (topQueueActionStatus.value.tone === 'warning') {
    return 'text-warning';
  }
  return 'text-foreground/85';
});
const patchNotesEntries = computed(() => resolvePatchNoteEntries(undefined, language.value));
const patchNotesUnreadPreviewItems = computed(() => {
  const previewEntryIds = patchNotesUnreadPreviewEntryIds.value;
  if (previewEntryIds.length === 0) {
    return [];
  }
  const entriesById = new Map(patchNotesEntries.value.map((entry) => [entry.entryId, entry]));
  return previewEntryIds.map((entryId) => entriesById.get(entryId)).filter((entry) => Boolean(entry));
});

// 将“缺失条目”诊断从 computed 移到 watch：computed 应保持纯函数、避免副作用，
// 且仅在预览 id 列表实际变化时检查一次（渲染层已用 filter(Boolean) 兜底缺失项）。
watch(patchNotesUnreadPreviewEntryIds, (previewEntryIds) => {
  if (!import.meta.env.DEV || previewEntryIds.length === 0) {
    return;
  }
  const entriesById = new Map(patchNotesEntries.value.map((entry) => [entry.entryId, entry]));
  const missingEntryIds = previewEntryIds.filter((entryId) => !entriesById.has(entryId));
  if (missingEntryIds.length > 0) {
    console.warn('[patchNotes] preview entry ids missing from catalog:', missingEntryIds);
  }
});
const patchNotesUnreadCount = computed(() => patchNotesUnreadEntries.value.length);
const hasUnreadPatchNotes = computed(() => patchNotesUnreadCount.value > 0);
const patchNotesButtonAriaLabel = computed(() =>
  hasUnreadPatchNotes.value
    ? t('common:vue.app.patchNotesUnreadAriaLabel', 'Patch Notes, {{count}} unread versions', {
        count: patchNotesUnreadCount.value,
      })
    : t('common:patchNotes', 'Patch Notes'),
);
const patchNotesUnreadDialogText = computed(() =>
  t('common:vue.app.patchNotesUnreadDialogDesc', 'You have {{count}} unread versions:', {
    count: patchNotesUnreadPreviewItems.value.length,
  }),
);
const actionNameFallbackMap = computed(() => {
  const map = {};
  const actionOptions = [...(simulator.options?.zones || []), ...(simulator.options?.dungeons || [])];
  for (const option of actionOptions) {
    const hrid = String(option?.hrid || '');
    if (!hrid || Object.prototype.hasOwnProperty.call(map, hrid)) {
      continue;
    }
    map[hrid] = String(option?.name || '');
  }
  return map;
});

function runDeferredInitialization() {
  simulator.ensureMarketPricesLoaded(true);
  simulator.ensureAbilityUpgradeReferenceDataLoaded();
}

function scheduleDeferredInitialization() {
  if (typeof window.requestIdleCallback === 'function') {
    deferredInitHandle = window.requestIdleCallback(runDeferredInitialization, { timeout: 1200 });
    return;
  }
  deferredInitHandle = window.setTimeout(runDeferredInitialization, 60);
}

function cancelDeferredInitialization() {
  if (deferredInitHandle == null) {
    return;
  }

  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(deferredInitHandle);
  } else {
    clearTimeout(deferredInitHandle);
  }
  deferredInitHandle = null;
}

function setTopQueueActionStatus(tone, text) {
  topQueueActionStatus.value = {
    tone: tone || 'secondary',
    text: String(text || ''),
  };
}

function resolveQueueActionErrorMessage(error) {
  const messageKey = typeof error === 'string' ? error : error?.message || String(error);
  if (error?.code === 'invalid_manual_price') {
    const fallback =
      messageKey === 'common:queue.priceSelectionInvalid'
        ? 'The selected price must be greater than 0.'
        : 'Enter a valid integer buy price greater than 0.';
    return t(messageKey, fallback);
  }
  if (error?.code === 'missing_enhancement_ask') {
    if (error?.queued) {
      return t(
        messageKey,
        'A queued enhancement no longer has an exact sell listing. Remove that variant or wait for a valid listing before running the queue.',
      );
    }
    const details = error?.details || {};
    return t(messageKey, '{{slot}}: {{item}} +{{level}} has no exact sell listing and cannot be added to the queue.', {
      slot: getEquipmentSlotName(details.slotKey, details.slotKey || 'Equipment'),
      item: localizeHridDisplayName(details.itemHrid),
      level: Number(details.enhancementLevel || 0),
    });
  }
  return t(messageKey, messageKey);
}

function isQueueActionCancelled(error) {
  return Boolean(error?.code === 'cancelled');
}

function localizeHridDisplayName(hrid) {
  const value = String(hrid || '');
  if (!value) {
    return '-';
  }

  if (Object.prototype.hasOwnProperty.call(itemDetailMap || {}, value)) {
    return getItemName(value, itemDetailMap[value]?.name || value);
  }

  const abilityName = getAbilityName(value, '');
  if (abilityName && abilityName !== value) {
    return abilityName;
  }

  if (Object.prototype.hasOwnProperty.call(actionNameFallbackMap.value || {}, value) || value.startsWith('/actions/')) {
    return getActionName(value, actionNameFallbackMap.value?.[value] || value);
  }

  return value;
}

function localizeQueueSkillName(skillKey) {
  const fallback = String(skillKey || '').trim();
  return getSkillName(skillKey, fallback);
}

function localizeHouseRoomName(roomHrid) {
  const value = String(roomHrid || '');
  return getHouseRoomName(value, houseRoomDetailMap?.[value]?.name || value || 'House Room');
}

function formatTopQueueVariantName(item, fallbackIndex = 1) {
  const fallbackName = String(item?.name || `${t('common:queue.queueItem', 'Queue Item')} ${fallbackIndex}`);
  return deriveQueueItemStatusName(item?.changeDetails, {
    t,
    fallbackText: fallbackName,
    resolveItemName: localizeHridDisplayName,
    resolveAbilityName: localizeHridDisplayName,
    resolveTriggerTargetName: localizeHridDisplayName,
    resolveHouseRoomName: localizeHouseRoomName,
    resolveSkillName: localizeQueueSkillName,
  });
}

async function runTopbarBaselineSimulation() {
  try {
    setTopQueueActionStatus('secondary', t('common:queue.baselineRunning', 'Running baseline simulation...'));
    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    const baselineRounds = Math.max(
      1,
      Math.floor(Number(baseline?.settings?.baselineRounds || activeQueueState.value?.settings?.baselineRounds || 1)),
    );
    setTopQueueActionStatus(
      'success',
      t(
        'common:vue.queue.msgBaselineCaptured',
        `Baseline captured for active player. Current baseline rounds: ${baselineRounds}. Recommended: at least 10 rounds, with 20-30 as the usual stable range; use 50+ when comparing very close options.`,
        { count: baselineRounds },
      ),
    );
  } catch (error) {
    if (isQueueActionCancelled(error)) {
      setTopQueueActionStatus('secondary', t('common:vue.queue.msgBaselineCancelled', 'Baseline simulation stopped.'));
      return;
    }
    setTopQueueActionStatus('danger', resolveQueueActionErrorMessage(error));
  }
}

async function setQueueBaselineFromTopbar() {
  if (!baselineReminderDismissed.value) {
    baselineReminderModalOpen.value = true;
    return;
  }
  await runTopbarBaselineSimulation();
}

function reportAddedQueueItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    setTopQueueActionStatus('danger', t('common:vue.queue.msgNoChanges', 'No changes detected (or baseline missing).'));
    return;
  }
  if (items.length === 1) {
    if (items.some((item) => Array.isArray(item?.costWarnings) && item.costWarnings.length > 0)) {
      setTopQueueActionStatus(
        'warning',
        t(
          'common:vue.queue.msgVariantAddedWithCostWarning',
          '{{name}} added to queue. A market-price warning applies.',
          { name: formatTopQueueVariantName(items[0], 1) },
        ),
      );
      return;
    }
    setTopQueueActionStatus(
      'success',
      t('common:vue.queue.msgVariantAdded', '{{name}} added to queue.', {
        name: formatTopQueueVariantName(items[0], 1),
      }),
    );
    return;
  }
  if (items.some((item) => Array.isArray(item?.costWarnings) && item.costWarnings.length > 0)) {
    setTopQueueActionStatus(
      'warning',
      t(
        'common:vue.queue.msgVariantsAddedWithCostWarning',
        '{{count}} variants added to queue. One or more market-price warnings apply.',
        { count: items.length },
      ),
    );
    return;
  }
  setTopQueueActionStatus(
    'success',
    t('common:vue.queue.msgVariantsAdded', '{{count}} variants added to queue.', { count: items.length }),
  );
}

async function addToQueueFromTopbar() {
  if (queueAdditionPending.value) {
    return;
  }
  queueAdditionPending.value = true;
  try {
    setTopQueueActionStatus('secondary', t('common:queue.checkingMarketPrice', 'Checking latest market prices...'));
    const preparation = await simulator.prepareActivePlayerQueueAddition();
    if (preparation?.requiresConfirmation) {
      pendingEquipmentPriceConfirmations.value = preparation.rows || [];
      equipmentPriceConfirmationRefreshFailed.value = Boolean(preparation.refreshFailed);
      pendingQueueDraftFingerprint.value = JSON.stringify(simulator.activePlayer);
      autoMirrorPrice.value = preparation.mirrorPrice ?? null;
      // 历史 Ask 快照：供镜子方案取价链复用，使镜子方案与参考价列口径一致。
      historicalQuotesMap.value = preparation.historicalQuotes ?? null;
      // 自动取到镜子价时直接预填到输入框（选最合适的 k/m/b 单位，保持整数整洁）；
      // 金额无法用单位整除时留空，计算仍会自动兜底使用 autoMirrorPrice。
      sharedMirrorPriceUnit.value = pickAmountUnitForDraft(autoMirrorPrice.value);
      sharedMirrorPriceDraft.value = formatAmountDraftForUnit(autoMirrorPrice.value, sharedMirrorPriceUnit.value);
      priceMethodByKey.value = {};
      manualPriceDrafts.value = {};
      manualPriceUnits.value = {};
      manualPriceErrors.value = {};
      // 一次性快照：在弹窗打开时构建市场更新映射，不随后续刷新更新（见 buildMarketUpdateMap 注释）。
      marketUpdateByKey.value = buildMarketUpdateMap();
      mirrorInputDrafts.value = {};
      equipmentPriceConfirmationModalOpen.value = true;
      focusFirstManualPriceInput();
      return;
    }
    reportAddedQueueItems(simulator.addActivePlayerToQueue());
  } catch (error) {
    setTopQueueActionStatus('danger', resolveQueueActionErrorMessage(error));
  } finally {
    queueAdditionPending.value = false;
  }
}

function cancelEquipmentPriceConfirmation() {
  equipmentPriceConfirmationModalOpen.value = false;
  pendingEquipmentPriceConfirmations.value = [];
  equipmentPriceConfirmationRefreshFailed.value = false;
  pendingQueueDraftFingerprint.value = '';
  manualPriceDrafts.value = {};
  manualPriceUnits.value = {};
  manualPriceErrors.value = {};
  priceMethodByKey.value = {};
  sharedMirrorPriceDraft.value = '';
  sharedMirrorPriceUnit.value = 'k';
  autoMirrorPrice.value = null;
  historicalQuotesMap.value = null;
  marketUpdateByKey.value = {};
  mirrorInputDrafts.value = {};
}

// 右一价（卖出）必须是真实的最高收购价（Bid）。市场没有买单时 resolveBaselineSaleQuote
// 会用 Ask 兜底并把 source 标为 'ask'——这种兜底值不再展示，右一价方案也同步不可选。
function hasRealTargetBid(entry) {
  return Boolean(entry?.targetBid && entry.targetBid.price > 0 && entry.targetBid.source !== 'ask');
}

// 左一价（买入）必须有参考价（精确 Ask / 官方小时均价 / 历史 Ask）才能作为定价方式。
function hasReferencePrice(entry) {
  return Boolean(entry?.reference && entry.reference.price > 0);
}

function getPriceMethod(entry) {
  const key = getManualPriceKey(entry);
  const stored = priceMethodByKey.value[key];
  if (stored === QUEUE_PRICE_METHOD_LEFT1) {
    // 无参考价时左一价不可用：回退手动输入。
    if (!hasReferencePrice(entry)) {
      return QUEUE_PRICE_METHOD_MANUAL;
    }
    return stored;
  }
  if (stored === QUEUE_PRICE_METHOD_MANUAL) {
    return stored;
  }
  if (stored === QUEUE_PRICE_METHOD_RIGHT1) {
    // 无真实 Bid 时右一价不可用：回退到参考价方案（无参考价则手动）。
    if (!hasRealTargetBid(entry)) {
      return entry?.reference ? QUEUE_PRICE_METHOD_LEFT1 : QUEUE_PRICE_METHOD_MANUAL;
    }
    return stored;
  }
  if (stored === QUEUE_PRICE_METHOD_MIRROR) {
    // 镜子方案不可用（与基准等级差不为 1）时，回退到默认方案，不允许选中镜子。
    if (entry?.mirrorPlan?.unavailable) {
      if (!entry?.reference) {
        return QUEUE_PRICE_METHOD_MANUAL;
      }
      return QUEUE_PRICE_METHOD_LEFT1;
    }
    return stored;
  }
  // 无参考价时默认手动，否则默认左一价（买入参考）。
  if (!entry?.reference) {
    return QUEUE_PRICE_METHOD_MANUAL;
  }
  return QUEUE_PRICE_METHOD_LEFT1;
}

function setPriceMethod(entry, method) {
  const key = getManualPriceKey(entry);
  priceMethodByKey.value[key] = method;
  // 切换定价方式即作废上一次确认失败在该行留下的错误提示（文案与旧方式绑定，避免残留误导）。
  delete manualPriceErrors.value[key];
  if (method === QUEUE_PRICE_METHOD_MIRROR) {
    recomputeMirrorPlan(entry);
  }
}

// 弹窗打开后聚焦第一个默认手动（无参考价）行的输入框。
function focusFirstManualPriceInput() {
  nextTick(() => {
    const rows = Array.isArray(pendingEquipmentPriceConfirmations.value)
      ? pendingEquipmentPriceConfirmations.value
      : [];
    const firstManualRow = rows.find((entry) => getPriceMethod(entry) === QUEUE_PRICE_METHOD_MANUAL);
    if (!firstManualRow) {
      return;
    }
    const key = getManualPriceKey(firstManualRow);
    const inputs = Array.from(document.querySelectorAll('[data-manual-price-input]'));
    const input = inputs.find((candidate) => candidate instanceof HTMLElement && candidate.dataset.priceKey === key);
    if (input instanceof HTMLElement) {
      input.focus();
    }
  });
}

// 对比已保存的队列项价格选择与当前市场参考价，标记"市场更新"（新出现精确价或价格变化）。
// 设计说明：本函数在弹窗打开时（addToQueueFromTopbar）一次性构建快照存入 marketUpdateByKey，
// 不随后续市场刷新自动更新——这是有意为之，避免用户确认过程中价格跳动造成困惑。
// 弹窗关闭（cancelEquipmentPriceConfirmation）时清空，再次打开时重建。
function buildMarketUpdateMap() {
  const updateMap = {};
  const queueItems = Array.isArray(simulator.activeQueueState?.items) ? simulator.activeQueueState.items : [];
  for (const item of queueItems) {
    // 合并 confirmedEquipmentPrices 与 priceSelections 后统一检查：
    // 旧版（v2.2.0）队列项只保存 confirmedEquipmentPrices 而无 priceSelections，
    // 若仅检查 priceSelections，这些旧队列项的市场更新检测会失效（不会显示"新价格"徽标）。
    // mergeConfirmedPricesAndSelections 内置归一化（去重、过滤无效 price），对已归一化输入幂等。
    const selections = mergeConfirmedPricesAndSelections(item);
    for (const selection of selections) {
      const key = getManualPriceKey(selection);
      const currentRow = pendingEquipmentPriceConfirmations.value.find((row) => getManualPriceKey(row) === key);
      if (!currentRow) {
        continue;
      }
      // 仅对 left1（或无 method 的旧版 confirmed 条目）执行价格变化检测：
      // mirror/right1/manual 的 selection.price 语义不同于参考价（Ask）——
      // mirror 存合成成本、right1 存 Bid 价、manual 存用户手输价，与参考 Ask 价直接比
      // 几乎必然不等，会产生误报"新价格"徽标；点击"Use new price"还会强制切回 left1，
      // 覆盖用户有意选择的定价方式。无 method 的旧版条目其 price 语义即参考价，仍参与比较。
      if (selection.method && selection.method !== QUEUE_PRICE_METHOD_LEFT1) {
        continue;
      }
      const currentReference = currentRow.reference;
      const savedPrice = Number(selection.price || 0);
      const currentPrice = currentReference ? Number(currentReference.price || 0) : 0;
      // 只在"当前存在参考价且与入队时保存的价格不同"时标记市场更新。
      // 旧逻辑中的 hasNewPrice（!currentReference && savedPrice > 0）语义实为"参考价消失"，
      // 并非"出现新价格"，且会在无参考价时渲染出点击无效的"Use new price"按钮，故移除。
      const priceChanged = currentReference && currentPrice > 0 && currentPrice !== savedPrice;
      if (priceChanged) {
        updateMap[key] = {
          priceChanged,
          savedPrice,
          currentPrice,
          currentSource: currentReference?.source || null,
        };
      }
    }
  }
  return updateMap;
}

function hasMarketUpdate(entry) {
  const key = getManualPriceKey(entry);
  return Boolean(marketUpdateByKey.value[key]);
}

function getMarketUpdateInfo(entry) {
  return marketUpdateByKey.value[getManualPriceKey(entry)] || null;
}

function useUpdatedReferencePrice(entry) {
  const key = getManualPriceKey(entry);
  const info = marketUpdateByKey.value[key];
  if (!info || info.currentPrice == null) {
    return;
  }
  // 切回左一价并锁定新价格。
  priceMethodByKey.value[key] = QUEUE_PRICE_METHOD_LEFT1;
  // 方式切换即作废旧错误提示，与 setPriceMethod 保持一致。
  delete manualPriceErrors.value[key];
  // 整体替换 .value 触发更新，不依赖 ref 的深度响应式代理——即使改为 shallowRef 也安全。
  pendingEquipmentPriceConfirmations.value = pendingEquipmentPriceConfirmations.value.map((candidate) => {
    const candidateKey = getManualPriceKey(candidate);
    if (candidateKey !== key || !candidate.reference) {
      return candidate;
    }
    return { ...candidate, reference: { ...candidate.reference, price: info.currentPrice } };
  });
  delete marketUpdateByKey.value[key];
}

function sanitizeSharedMirrorPriceInput(event) {
  const rawValue = String(event.target.value || '');
  const { normalized } = normalizeManualPriceDraft(rawValue);
  sharedMirrorPriceDraft.value = normalized;
  if (normalized !== rawValue) {
    event.target.value = normalized;
  }
  // normalize 已剔除字母得到稳定纯数字串，无论原始输入是否含字母都应刷新，
  // 避免粘贴 "12k" 等带字母输入时显示价与生效价短暂不一致。
  refreshMirrorPlans();
}

function resolveSharedMirrorPrice() {
  const unitMultiplier = getManualPriceUnitMultiplier(sharedMirrorPriceUnit.value);
  const evaluation = evaluateManualPriceDraft(sharedMirrorPriceDraft.value, unitMultiplier);
  if (evaluation.valid) {
    return evaluation.actualPrice;
  }
  return autoMirrorPrice.value;
}

function ensureMirrorInputDrafts(entry) {
  const rowKey = getManualPriceKey(entry);
  if (!mirrorInputDrafts.value[rowKey] || typeof mirrorInputDrafts.value[rowKey] !== 'object') {
    mirrorInputDrafts.value[rowKey] = {};
  }
  return mirrorInputDrafts.value[rowKey];
}

// 收集该行镜子方案已填的有效手动补价：{ level: 价格 }。
function collectMirrorManualPrices(entry) {
  const drafts = mirrorInputDrafts.value[getManualPriceKey(entry)];
  if (!drafts || typeof drafts !== 'object') {
    return {};
  }
  const prices = {};
  for (const [levelKey, draft] of Object.entries(drafts)) {
    const unitMultiplier = getManualPriceUnitMultiplier(draft?.unit);
    const evaluation = evaluateManualPriceDraft(draft?.raw, unitMultiplier);
    if (evaluation.valid) {
      prices[Number(levelKey)] = evaluation.actualPrice;
    }
  }
  return prices;
}

// 需要手动补价的等级 = 当前缺价 ∪ 已配置草稿（sticky，填完后仍可修改/清空）。
function getMirrorMissingLevels(entry) {
  const drafts = mirrorInputDrafts.value[getManualPriceKey(entry)];
  const sticky = drafts && typeof drafts === 'object' ? drafts : {};
  const missingItems = (entry?.mirrorPlan?.missing || []).map((item) => ({
    level: Number(item.level),
    // 软缺价条目 count 为 null（份数需补价后才能确定），保持 null 以便标签不渲染 ×N；
    // 硬缺价/兜底条目 count 为确定正整数。
    count: item.count == null ? null : Math.max(1, Math.floor(Number(item.count) || 1)),
  }));
  const byLevel = new Map();
  for (const missingItem of missingItems) {
    byLevel.set(missingItem.level, { level: missingItem.level, count: missingItem.count });
  }
  for (const levelKey of Object.keys(sticky)) {
    const numericLevel = Number(levelKey);
    if (!Number.isFinite(numericLevel) || numericLevel <= 0) {
      continue;
    }
    if (!byLevel.has(numericLevel)) {
      byLevel.set(numericLevel, {
        level: numericLevel,
        count: sticky[levelKey]?.count == null ? null : Math.max(1, Math.floor(Number(sticky[levelKey]?.count) || 1)),
      });
    }
  }
  return Array.from(byLevel.values()).sort((left, right) => left.level - right.level);
}

// 缺价输入框标签：count 确定（硬缺价/兜底）时显示"缺 +N ×count"；
// 软缺价 count 为 null 时不显示份数——补价前无法确定展开后的真实需求份数。
function formatMirrorInputMissingLevel(missingItem) {
  const level = Number(missingItem?.level || 0);
  const count = missingItem?.count;
  if (count == null || !(count > 0)) {
    return t('common:queue.mirrorInputMissingLevelNoCount', 'Missing +{{level}}', { level });
  }
  return t('common:queue.mirrorInputMissingLevel', 'Missing +{{level}} ×{{count}}', {
    level,
    count: Number(count),
  });
}

// 共享镜子价是否缺失：无自动价且顶部输入无效。行内错误与 hover 提示共用同一判定，避免口径漂移。
function isSharedMirrorPriceMissing() {
  const sharedMirrorPriceValid = evaluateManualPriceDraft(
    sharedMirrorPriceDraft.value,
    getManualPriceUnitMultiplier(sharedMirrorPriceUnit.value),
  ).valid;
  return autoMirrorPrice.value == null && !sharedMirrorPriceValid;
}

// 生成镜子方案缺价的明确提示：列出未填的输入件等级与缺失的镜子价。
function getMirrorPlanMissingText(entry) {
  const missingLevels = getMirrorMissingLevels(entry)
    .filter((item) => {
      const draft = getMirrorInputDraft(entry, item.level);
      const unitMultiplier = getManualPriceUnitMultiplier(draft.unit);
      return !evaluateManualPriceDraft(draft.raw, unitMultiplier).valid;
    })
    .map((item) => String(Number(item.level)));
  const mirrorPriceMissing = isSharedMirrorPriceMissing();
  const levelsText = missingLevels.join(', ');

  if (missingLevels.length > 0 && mirrorPriceMissing) {
    return t(
      'common:queue.mirrorPlanMissingAll',
      "Mirror plan still needs prices for +{{levels}} and the Philosopher's Mirror. Fill them in before confirming.",
      { levels: levelsText },
    );
  }
  if (missingLevels.length > 0) {
    return t(
      'common:queue.mirrorPlanMissingLevels',
      'Mirror plan still needs prices for +{{levels}}. Enter them in the inputs below.',
      { levels: levelsText },
    );
  }
  if (mirrorPriceMissing) {
    return t(
      'common:queue.mirrorPlanMissingMirrorPrice',
      "Mirror plan still needs the Philosopher's Mirror price. Enter it in the input at the top.",
    );
  }
  return t(
    'common:queue.mirrorPlanMissingUnavailable',
    'The mirror plan is missing prices and cannot be calculated. Review the prices and confirm again.',
  );
}

// 写入/刷新该行镜子方案的确认失败文案：仍缺输入价时列出具体等级（镜子价同时缺失时用组合文案），
// 否则给出缺镜子价/方案不可用提示。供确认失败与补价过程中的错误刷新共用，保证行内文案始终与当前草稿一致。
function setMirrorRowError(entry) {
  const stillMissingLevels = getMirrorMissingLevels(entry)
    .filter((item) => {
      const draft = getMirrorInputDraft(entry, item.level);
      const unitMultiplier = getManualPriceUnitMultiplier(draft.unit);
      return !evaluateManualPriceDraft(draft.raw, unitMultiplier).valid;
    })
    .map((item) => item.level);
  manualPriceErrors.value[getManualPriceKey(entry)] =
    stillMissingLevels.length > 0 && !isSharedMirrorPriceMissing()
      ? t(
          'common:queue.mirrorPlanMissingInputs',
          '{{name}} +{{level}}: enter the missing input prices (+{{levels}}) for the mirror plan.',
          {
            name: localizeHridDisplayName(entry.itemHrid),
            level: Number(entry.enhancementLevel || 0),
            levels: stillMissingLevels.join(', +'),
          },
        )
      : getMirrorPlanMissingText(entry);
}

// 仅当该行已存在确认失败错误时刷新文案：错误仅在确认失败后出现，补价过程中保持实时准确。
function refreshMirrorRowErrorIfPresent(entry) {
  if (manualPriceErrors.value[getManualPriceKey(entry)] != null) {
    setMirrorRowError(entry);
  }
}

function getMirrorInputDraft(entry, level) {
  const drafts = mirrorInputDrafts.value[getManualPriceKey(entry)];
  const draft = drafts && typeof drafts === 'object' ? drafts[String(level)] : null;
  return draft && typeof draft === 'object' ? draft : { raw: '', unit: 'k', count: 1 };
}

// 缺价输入框当前草稿按所选单位（k/m/b）解析出的实际价格；无效时返回 null。用于即时反馈。
function getMirrorInputResolvedPrice(entry, level) {
  const draft = getMirrorInputDraft(entry, level);
  const unitMultiplier = getManualPriceUnitMultiplier(draft.unit);
  const evaluation = evaluateManualPriceDraft(draft.raw, unitMultiplier);
  return evaluation.valid ? evaluation.actualPrice : null;
}

// 用当前缺价件手动价 + 共享镜子价重算该行镜子方案，并把结果写回行数据（响应式）。
function recomputeMirrorPlan(entry) {
  if (!entry || getPriceMethod(entry) !== QUEUE_PRICE_METHOD_MIRROR) {
    return entry?.mirrorPlan || null;
  }
  const drafts = ensureMirrorInputDrafts(entry);
  for (const missingItem of entry?.mirrorPlan?.missing || []) {
    const levelKey = String(Number(missingItem.level));
    // 软缺价条目（count 为 null）的草稿同样保持 null：份数未知，标签不渲染 ×N。
    const count = missingItem.count == null ? null : Math.max(1, Math.floor(Number(missingItem.count) || 1));
    if (!drafts[levelKey]) {
      drafts[levelKey] = { raw: '', unit: 'k', count };
    } else {
      drafts[levelKey].count = count;
    }
  }
  const manualPrices = collectMirrorManualPrices(entry);
  const mirrorPrice = resolveSharedMirrorPrice();
  const recomputed = computeMirrorPlan({
    itemHrid: entry.itemHrid,
    targetLevel: entry.enhancementLevel,
    baselineLevel: entry.baselineLevel || 0,
    pricingState: simulator.pricing,
    confirmedEquipmentPrices: [],
    mirrorPrice,
    manualInputPrices: manualPrices,
    historicalQuotes: historicalQuotesMap.value,
  });
  // 整体替换 .value 触发更新，不依赖 ref 的深度响应式代理——即使改为 shallowRef 也安全。
  const updatedUsedBaselineLevels = Array.isArray(recomputed?.usedBaselineLevels) ? recomputed.usedBaselineLevels : [];
  pendingEquipmentPriceConfirmations.value = pendingEquipmentPriceConfirmations.value.map((candidate) => {
    if (getManualPriceKey(candidate) !== getManualPriceKey(entry)) {
      return candidate;
    }
    return { ...candidate, mirrorPlan: recomputed, usedBaselineLevels: updatedUsedBaselineLevels };
  });
  // 镜子方案成本变为有效时，清除该行上一次确认失败留下的错误提示，
  // 对齐手动价"输入修正即清错"的体验；输入编辑、单位切换、共享镜子价变更、确认重算都会经过此处。
  // 该函数仅在 MIRROR 行执行（上方早退保护），不会误清其他定价方式的错误。
  const recomputedCost = Number(recomputed?.cost);
  if (recomputed?.cost != null && Number.isFinite(recomputedCost) && recomputedCost > 0) {
    delete manualPriceErrors.value[getManualPriceKey(entry)];
  }
  return recomputed;
}

function refreshMirrorPlans() {
  for (const entry of pendingEquipmentPriceConfirmations.value) {
    if (getPriceMethod(entry) === QUEUE_PRICE_METHOD_MIRROR) {
      recomputeMirrorPlan(entry);
      // 共享镜子价变更也可能改变失败原因（如"缺输入价" ↔ "输入价+镜子价组合缺失"），有错误时同步刷新行内文案。
      refreshMirrorRowErrorIfPresent(entry);
    }
  }
}

function sanitizeMirrorManualPriceInput(event, entry, level) {
  const drafts = ensureMirrorInputDrafts(entry);
  const levelKey = String(level);
  const current = drafts[levelKey] || { raw: '', unit: 'k', count: 1 };
  const rawValue = String(event?.target?.value ?? '');
  const { normalized } = normalizeManualPriceDraft(rawValue);
  current.raw = normalized;
  drafts[levelKey] = current;
  if (normalized !== rawValue) {
    event.target.value = normalized;
  }
  // normalize 已剔除字母得到稳定纯数字串，无论原始输入是否含字母都应刷新，
  // 避免粘贴 "12k" 等带字母输入时显示价与生效价短暂不一致。
  recomputeMirrorPlan(entry);
  refreshMirrorRowErrorIfPresent(entry);
}

function handleMirrorManualPriceUnitChange(value, entry, level) {
  const nextUnit = String(value || '').toLowerCase();
  if (!MANUAL_PRICE_UNITS.some((item) => item.value === nextUnit)) {
    return;
  }
  const drafts = ensureMirrorInputDrafts(entry);
  const levelKey = String(level);
  const current = drafts[levelKey] || { raw: '', unit: 'k', count: 1 };
  current.unit = nextUnit;
  drafts[levelKey] = current;
  recomputeMirrorPlan(entry);
  refreshMirrorRowErrorIfPresent(entry);
}

function setSharedMirrorPriceUnit(value) {
  const nextUnit = String(value || '').toLowerCase();
  if (!MANUAL_PRICE_UNITS.some((item) => item.value === nextUnit)) {
    return;
  }
  sharedMirrorPriceUnit.value = nextUnit;
  refreshMirrorPlans();
}

function confirmEquipmentPricesAndAdd() {
  try {
    if (JSON.stringify(simulator.activePlayer) !== pendingQueueDraftFingerprint.value) {
      throw new Error('common:queue.confirmHourlyAverageDraftChanged');
    }
    // 每次确认尝试开始时重置错误快照：行内错误只反映最近一次确认的结果，
    // 避免左一/右一行在市场刷新出价格后仍显示过期的"价格不可用"提示（本次循环会为仍失败的行重写）。
    manualPriceErrors.value = {};
    const priceSelections = [];
    let hasInvalidManualPrice = false;
    const sharedMirrorPrice = resolveSharedMirrorPrice();
    for (const entry of pendingEquipmentPriceConfirmations.value) {
      const method = getPriceMethod(entry);
      const key = getManualPriceKey(entry);
      if (method === QUEUE_PRICE_METHOD_MANUAL) {
        const unitMultiplier = getManualPriceUnitMultiplier(manualPriceUnits.value[key]);
        const evaluation = evaluateManualPriceDraft(manualPriceDrafts.value[key], unitMultiplier);
        if (!evaluation.valid) {
          hasInvalidManualPrice = true;
          manualPriceErrors.value[key] = t(
            'common:queue.manualPriceInvalidRow',
            '{{name}} +{{level}}: enter a valid integer buy price greater than 0.',
            {
              name: localizeHridDisplayName(entry.itemHrid),
              level: Number(entry.enhancementLevel || 0),
            },
          );
          continue;
        }
        delete manualPriceErrors.value[key];
        priceSelections.push({
          itemHrid: entry.itemHrid,
          enhancementLevel: entry.enhancementLevel,
          method: QUEUE_PRICE_METHOD_MANUAL,
          price: evaluation.actualPrice,
          confirmedAt: Date.now(),
        });
        continue;
      }
      if (method === QUEUE_PRICE_METHOD_MIRROR) {
        const mirrorPlan = recomputeMirrorPlan(entry) || entry.mirrorPlan || {};
        const mirrorPrice = sharedMirrorPrice ?? mirrorPlan.mirrorPrice ?? 0;
        const mirrorCost = Number(mirrorPlan.cost);
        if (mirrorPlan.cost == null || !Number.isFinite(mirrorCost) || mirrorCost <= 0) {
          hasInvalidManualPrice = true;
          setMirrorRowError(entry);
          continue;
        }
        const inputs = Array.isArray(mirrorPlan.inputs)
          ? mirrorPlan.inputs.map((input) => ({
              level: input.level,
              count: input.count,
              price: input.price,
              source: input.source,
            }))
          : [];
        priceSelections.push({
          itemHrid: entry.itemHrid,
          enhancementLevel: entry.enhancementLevel,
          method: QUEUE_PRICE_METHOD_MIRROR,
          price: mirrorCost,
          mirrorPrice,
          mirrorCount: mirrorPlan.mirrorCount || 0,
          inputs,
          usedBaselineLevels: Array.isArray(mirrorPlan?.usedBaselineLevels) ? mirrorPlan.usedBaselineLevels : [],
          confirmedAt: Date.now(),
        });
        continue;
      }
      if (method === QUEUE_PRICE_METHOD_LEFT1) {
        // 左一价：锁定买入参考价
        if (entry.reference) {
          priceSelections.push({
            itemHrid: entry.itemHrid,
            enhancementLevel: entry.enhancementLevel,
            method: QUEUE_PRICE_METHOD_LEFT1,
            price: entry.reference.price,
            source: entry.reference.source,
            volume: entry.reference.volume,
            marketTimestamp: entry.reference.marketTimestamp,
            confirmedAt: Date.now(),
          });
        } else {
          hasInvalidManualPrice = true;
          manualPriceErrors.value[key] = t(
            'common:queue.left1PriceMissingRow',
            '{{name}} +{{level}}: reference price is unavailable. Switch to Manual or Mirror.',
            {
              name: localizeHridDisplayName(entry.itemHrid),
              level: Number(entry.enhancementLevel || 0),
            },
          );
        }
        continue;
      }
      if (method === QUEUE_PRICE_METHOD_RIGHT1) {
        // 右一价：目标装备在市场上的最高收购价（bid 侧），只接受真实 Bid（不接受 Ask 兜底）。
        if (hasRealTargetBid(entry)) {
          priceSelections.push({
            itemHrid: entry.itemHrid,
            enhancementLevel: entry.enhancementLevel,
            method: QUEUE_PRICE_METHOD_RIGHT1,
            price: entry.targetBid.price,
            source: entry.targetBid.source,
            confirmedAt: Date.now(),
          });
        } else {
          hasInvalidManualPrice = true;
          manualPriceErrors.value[key] = t(
            'common:queue.right1PriceMissingRow',
            '{{name}} +{{level}}: bid price is unavailable. Switch to Manual or Mirror.',
            {
              name: localizeHridDisplayName(entry.itemHrid),
              level: Number(entry.enhancementLevel || 0),
            },
          );
        }
        continue;
      }
    }
    if (hasInvalidManualPrice) {
      return;
    }
    const items = simulator.addActivePlayerToQueue({ priceSelections });
    cancelEquipmentPriceConfirmation();
    reportAddedQueueItems(items);
  } catch (error) {
    cancelEquipmentPriceConfirmation();
    setTopQueueActionStatus('danger', resolveQueueActionErrorMessage(error));
  }
}

function formatConfirmedMarketPrice(value) {
  return formatCompactAmountForLocale(value, language.value === 'zh' ? 'zh-CN' : 'en-US');
}

const MANUAL_PRICE_UNITS = [
  { value: 'k', multiplier: 1000 },
  { value: 'm', multiplier: 1_000_000 },
  { value: 'b', multiplier: 1_000_000_000 },
];

function getManualPriceUnitMultiplier(unit) {
  const found = MANUAL_PRICE_UNITS.find((u) => u.value === String(unit || ''));
  return found ? found.multiplier : 1000;
}

// 自动价预填：选最小的 k/m/b 单位使 raw = amount / 单位 为 ≥1 的整数；无法表达时兜底 'k'。
function pickAmountUnitForDraft(amount) {
  const safeAmount = Number.isFinite(Number(amount)) ? Math.max(0, Math.floor(Number(amount))) : 0;
  for (const unit of MANUAL_PRICE_UNITS) {
    if (safeAmount % unit.multiplier === 0 && safeAmount / unit.multiplier >= 1) {
      return unit.value;
    }
  }
  return 'k';
}

// 自动价预填：raw（输入框显示值）；金额无法用所选单位整除时返回 ''（留空，计算仍自动兜底）。
function formatAmountDraftForUnit(amount, unit) {
  const safeAmount = Number.isFinite(Number(amount)) ? Math.max(0, Math.floor(Number(amount))) : 0;
  const multiplier = getManualPriceUnitMultiplier(unit);
  if (safeAmount % multiplier !== 0 || safeAmount / multiplier < 1) {
    return '';
  }
  return String(safeAmount / multiplier);
}

function sanitizeManualPriceInput(event, entry) {
  const key = getManualPriceKey(entry);
  const rawValue = String(event.target.value || '');
  const { normalized, containsLetters } = normalizeManualPriceDraft(rawValue);
  manualPriceDrafts.value[key] = normalized;
  if (normalized !== rawValue) {
    event.target.value = normalized;
  }
  if (containsLetters) {
    manualPriceErrors.value[key] = t(
      'common:queue.manualPriceDigitsOnly',
      'Numbers only. Pick the k/m/b unit with the buttons.',
    );
    return;
  }
  if (evaluateManualPriceDraft(normalized).valid) {
    delete manualPriceErrors.value[key];
  }
}

function handleManualPriceUnitChange(value, entry) {
  const nextUnit = String(value || '').toLowerCase();
  if (!MANUAL_PRICE_UNITS.some((u) => u.value === nextUnit)) return;
  manualPriceUnits.value[getManualPriceKey(entry)] = nextUnit;
}

function getManualPriceKey(entry) {
  return `${String(entry?.itemHrid || '')}|${Math.max(0, Math.floor(Number(entry?.enhancementLevel || 0)))}`;
}

// 参考价列下方的"来源"标签：跟随用户当前选定的价格方式，
// 选左一价时显示参考价来源（ask/历史/h均价），
// 选右一价时显示收购价来源（bid/ask fallback），
// 避免选右一价时仍显示"精确 Ask"造成误导。
function formatConfirmationSource(entry) {
  const method = getPriceMethod(entry);
  if (method === QUEUE_PRICE_METHOD_MANUAL) {
    return t('common:queue.manualPriceSource', 'Manual input');
  }
  if (method === QUEUE_PRICE_METHOD_MIRROR) {
    return t('common:queue.confirmPriceSourceMirror', 'Mirror');
  }
  if (method === QUEUE_PRICE_METHOD_RIGHT1) {
    const source = String(entry?.targetBid?.source || '');
    if (source === 'bid') {
      return t('common:queue.confirmPriceSourceExactBid', 'Exact Bid');
    }
    return t('common:queue.confirmPriceSourceUnavailable', 'No price');
  }
  // left1（默认）
  if (!entry?.reference) {
    return t('common:queue.confirmPriceSourceUnavailable', 'No price');
  }
  const source = String(entry?.reference?.source || entry?.source || '');
  if (source === 'manual') {
    return t('common:queue.manualPriceSource', 'Manual input');
  }
  if (source === 'historical_ask') {
    return t('common:queue.confirmPriceSourceHistoricalAsk', 'Historical Ask');
  }
  if (source === 'ask') {
    return t('common:queue.confirmPriceSourceExactAsk', 'Exact Ask');
  }
  if (source === 'mirror') {
    return t('common:queue.confirmPriceSourceMirror', 'Mirror');
  }
  return t('common:queue.confirmPriceSourceOfficialHourlyAverage', 'Official hourly average');
}

function isHistoricalAskEntry(entry) {
  return String(entry?.reference?.source || entry?.source || '') === 'historical_ask';
}

function formatMarketDataTime(timestampSeconds) {
  const timestamp = Number(timestampSeconds || 0);
  return timestamp > 0
    ? new Date(timestamp * 1000).toLocaleString()
    : t('common:queue.confirmPriceTimeUnknown', 'Unknown');
}

async function runQueueFromTopbar() {
  try {
    closeQueueCompleteModal();
    setTopQueueActionStatus('secondary', t('common:queue.queueRunning', 'Running queue...'));
    const queueRunPromise = simulator.runActiveQueue();
    if (route.name !== 'multi-results' && (simulator.runtime.isRunning || activeQueueState.value?.isRunning)) {
      queueCompleteModalOpen.value = true;
    }
    const rows = await queueRunPromise;
    if (activeQueueState.value?.lastRunStatus === 'cancelled') {
      const partialCount = Array.isArray(activeQueueState.value?.ranking) ? activeQueueState.value.ranking.length : 0;
      if (partialCount > 0) {
        setTopQueueActionStatus(
          'secondary',
          t('common:vue.queue.msgRunCancelledPartial', 'Queue run stopped. Kept {{count}} ranked variants.', {
            count: partialCount,
          }),
        );
        return;
      }
      setTopQueueActionStatus('secondary', t('common:vue.queue.msgRunCancelled', 'Queue run stopped.'));
      return;
    }
    if (Array.isArray(rows) && rows.length > 0) {
      setTopQueueActionStatus(
        'success',
        t('common:vue.queue.msgRunCompleted', 'Queue run completed: {{count}} variants ranked.', {
          count: rows.length,
        }),
      );
      return;
    }
    if (activeQueueState.value?.error) {
      setTopQueueActionStatus('danger', t(activeQueueState.value.error, activeQueueState.value.error));
      return;
    }
    setTopQueueActionStatus('secondary', t('common:queue.emptyResults', 'No queue run results yet.'));
  } catch (error) {
    setTopQueueActionStatus('danger', resolveQueueActionErrorMessage(error));
  }
}

function clearQueueFromTopbar() {
  simulator.clearActiveQueue();
  setTopQueueActionStatus('success', t('common:vue.queue.msgQueueCleared', 'Queue cleared.'));
}

function serializeErrorPayload(payload) {
  if (payload instanceof Error) {
    return payload.stack || payload.message || String(payload);
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return String(payload);
  }
}

function openGlobalError(source, payload) {
  const rawDetails = serializeErrorPayload(payload);
  // 双模式渲染：i18n key（如 "common:simulation.*"）会被翻译，
  // 普通运行时错误文本则原样显示。
  const details = t(rawDetails, rawDetails);
  globalErrorText.value = `[${source}] ${details || '-'}`;
  globalErrorModalOpen.value = true;
  errorCopyStatus.value = '';
}

async function copyGlobalError() {
  const text = String(globalErrorText.value || '');
  if (!text.trim()) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    errorCopyStatus.value = t('common:vue.app.globalErrorCopied', 'Copied.');
  } catch (error) {
    errorCopyStatus.value = t('common:vue.app.globalErrorCopyFailed', 'Copy failed.');
  }
}

function openFeedbackModal() {
  feedbackModalOpen.value = true;
  feedbackCopyStatus.value = '';
}

function closeFeedbackModal() {
  feedbackModalOpen.value = false;
  feedbackCopyStatus.value = '';
}

async function copyFeedbackContact(value) {
  const text = String(value || '').trim();
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    feedbackCopyStatus.value = t('common:vue.app.globalErrorCopied', 'Copied.');
  } catch (error) {
    feedbackCopyStatus.value = t('common:vue.app.globalErrorCopyFailed', 'Copy failed.');
  }
}

function onWindowError(event) {
  openGlobalError('window.error', event?.error || event?.message || event);
}

function onUnhandledRejection(event) {
  openGlobalError('unhandledrejection', event?.reason || event);
}

function closeSimulationCompleteModal() {
  simulationCompleteModalOpen.value = false;
}

function closeQueueCompleteModal() {
  queueCompleteModalOpen.value = false;
}

function closeBaselineReminderModal() {
  baselineReminderModalOpen.value = false;
}

async function acknowledgeBaselineReminderAndRun() {
  baselineReminderDismissed.value = true;
  dismissBaselineReminder();
  closeBaselineReminderModal();
  await runTopbarBaselineSimulation();
}

async function openBaselineReminderSettings() {
  closeBaselineReminderModal();
  setTopQueueActionStatus('secondary', '');
  if (route.name !== 'settings') {
    await router.push({ name: 'settings' });
  }
}

function refreshPatchNoteUnreadEntries() {
  patchNotesUnreadEntries.value = getUnreadPatchNoteEntries({
    entries: patchNotesEntries.value,
  });
}

function markPatchNotesReadOnPageEntry() {
  const unreadEntryIds = patchNotesUnreadEntries.value.map((entry) => entry.entryId);
  if (unreadEntryIds.length === 0) {
    return;
  }

  markPatchNoteEntriesAsRead({
    entryIds: unreadEntryIds,
  });
  refreshPatchNoteUnreadEntries();
}

function openPatchNotesUnreadModal() {
  const unread = patchNotesUnreadEntries.value;
  if (unread.length === 0) {
    return;
  }
  if (route.name === 'patch-notes') {
    // 已在更新日志页：未读徽标残留说明状态不一致（如语言切换后重新计算），
    // 直接清除未读，避免“点了没反应”。
    markPatchNotesReadOnPageEntry();
    return;
  }

  patchNotesUnreadPreviewEntryIds.value = unread.map((entry) => entry.entryId);
  patchNotesUnreadModalOpen.value = true;
}

function closePatchNotesUnreadModal(closeReason = 'programmatic') {
  // 关闭方式分类（与 BaseModal 的 reason 语义对应）：
  // - 'programmatic'（默认值，含不传参调用）：显式确认（点击“Close”/“View all”），视为已读。
  // - 'close-button'：点击右上角 X 按钮，同样视为已读（主动确认关闭）。
  // - 'escape' / 'backdrop'：Esc / 遮罩，视为“暂不阅读”，保留未读徽标。
  const isDismissiveClose = closeReason === 'escape' || closeReason === 'backdrop';
  if (!isDismissiveClose) {
    const previewEntryIds = patchNotesUnreadPreviewItems.value.map((entry) => entry.entryId);
    if (previewEntryIds.length > 0) {
      markPatchNoteEntriesAsRead({
        entryIds: previewEntryIds,
      });
      refreshPatchNoteUnreadEntries();
    }
  }
  patchNotesUnreadModalOpen.value = false;
  patchNotesUnreadPreviewEntryIds.value = [];
}

async function viewAllPatchNotes() {
  closePatchNotesUnreadModal();
  if (route.name !== 'patch-notes') {
    await router.push({ name: 'patch-notes' });
  }
}

async function goToHomeResults() {
  closeSimulationCompleteModal();
  if (route.name !== 'home' || route.query.focus !== 'results') {
    await router.push({ name: 'home', query: { focus: 'results' } });
  }
}

async function goToMultiResults() {
  closeQueueCompleteModal();
  if (route.name !== 'multi-results') {
    await router.push({ name: 'multi-results' });
  }
}

watch(
  () => simulator.runtime.error,
  (nextError, prevError) => {
    const nextText = String(nextError || '').trim();
    if (nextText && nextText !== String(prevError || '').trim()) {
      openGlobalError('runtime', nextText);
    }
  },
);

watch(
  () => simulator.runtime.completionNoticeId,
  (nextNoticeId, prevNoticeId) => {
    const nextId = Number(nextNoticeId || 0);
    const prevId = Number(prevNoticeId || 0);
    if (nextId <= prevId || !hasSimulationResults.value || route.name === 'home') {
      return;
    }
    simulationCompleteModalOpen.value = true;
  },
);

watch(
  () => simulator.runtime.isRunning,
  (nextRunning) => {
    if (nextRunning) {
      closeSimulationCompleteModal();
    }
  },
);

watch(
  () => route.name,
  (nextRouteName) => {
    if (nextRouteName === 'home') {
      closeSimulationCompleteModal();
    }
    if (nextRouteName === 'multi-results') {
      closeQueueCompleteModal();
    }
    if (nextRouteName === 'patch-notes') {
      markPatchNotesReadOnPageEntry();
    }
  },
);

watch(
  () => simulator.activePlayerId,
  () => {
    setTopQueueActionStatus('secondary', '');
  },
);

onMounted(() => {
  initializePatchNotesState({
    entries: patchNotesEntries.value,
  });
  refreshPatchNoteUnreadEntries();
  if (route.name === 'patch-notes') {
    markPatchNotesReadOnPageEntry();
  }
  scheduleDeferredInitialization();
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
});

onUnmounted(() => {
  cancelDeferredInitialization();
  window.removeEventListener('error', onWindowError);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);
});

watch(
  () => language.value,
  () => {
    refreshPatchNoteUnreadEntries();
    if (patchNotesUnreadModalOpen.value) {
      patchNotesUnreadPreviewEntryIds.value = patchNotesUnreadEntries.value.map((entry) => entry.entryId);
    }
  },
);

async function switchLanguage(nextLanguage) {
  await setLanguage(nextLanguage);
  simulator.setLanguage(nextLanguage);
}
</script>
