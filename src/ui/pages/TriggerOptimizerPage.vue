<template>
  <section class="min-w-0 space-y-5" data-trigger-optimizer-page>
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <h2 class="flex items-center gap-2 font-heading text-xl font-semibold">
        <SlidersHorizontal class="size-5 text-primary" />{{ t('common:menu.triggerOptimizer') }}
      </h2>
      <div class="flex flex-wrap gap-2">
        <Button as-child variant="outline" size="sm"
          ><RouterLink to="/home"><Settings2 />{{ t('common:triggerOptimizer.editCombat') }}</RouterLink></Button
        >
        <Button
          v-if="running"
          size="sm"
          variant="destructive"
          data-trigger-optimizer-stop
          @click="simulator.stopTriggerOptimizer()"
          ><Square />{{ t('common:triggerOptimizer.stop') }}</Button
        >
        <Button v-else size="sm" :disabled="!canStart" data-trigger-optimizer-start @click="run()"
          ><Play />{{ t('common:triggerOptimizer.start') }}</Button
        >
      </div>
    </header>

    <div class="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label class="min-w-0"
        ><span class="control-label">{{ t('common:player') }}</span
        ><select
          class="control-input w-full"
          :value="simulator.activePlayerId"
          :disabled="running"
          @change="simulator.setActivePlayer($event.target.value)"
        >
          <option v-for="player in simulator.players" :key="player.id" :value="player.id">
            {{ player.name
            }}{{
              simulator.queue.importedProfileByPlayer?.[player.id]
                ? ''
                : ` (${t('common:triggerOptimizer.notImported')})`
            }}
          </option>
        </select></label
      >
      <div class="min-w-0">
        <p class="control-label">{{ t('common:triggerOptimizer.map') }}</p>
        <p class="break-words text-sm">{{ targetName }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ difficultyText }}</p>
      </div>
      <div class="min-w-0">
        <p class="control-label">{{ t('common:triggerOptimizer.duration') }}</p>
        <p class="text-sm">{{ number(settings.simulationHours) }} {{ t('common:triggerOptimizer.hours') }}</p>
      </div>
      <div class="min-w-0">
        <p class="control-label">{{ t('common:triggerOptimizer.searchStrength') }}</p>
        <p class="text-sm" data-trigger-optimizer-strength-summary>{{ presetSummary }}</p>
        <p class="mt-1 text-xs text-muted-foreground" data-trigger-optimizer-planned>
          {{ t('common:triggerOptimizer.simulationsPlanned', '', { count: number(plannedSimulations, 0) }) }}
        </p>
      </div>
    </div>

    <!-- 搜索设置卡片（2026-09-22）：原来的「锁定不优化」与「搜索设置」两块合成一张卡片 ——
         它们调的是同一件事（这一轮搜什么），拆成两处只会让人来回找；卡片下面原本平铺着 8 段
         解释性长文（锁定含义 / 档位含义 / 重复次数 / 权重 / 搜索过程 / 时长 / 范围 / 配对比较），
         同样收进「参数说明」弹窗（见 settingsNotes）。 -->
    <section class="space-y-3 rounded-lg border border-border bg-muted/20 p-4" data-trigger-optimizer-settings-card>
      <header class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ t('common:triggerOptimizer.settingsTitle') }}</h3>
        <Button size="sm" variant="ghost" data-trigger-optimizer-settings-notes-open @click="openSettingsNotes()"
          ><Info />{{ t('common:triggerOptimizer.settingsNotesEntry') }}</Button
        >
      </header>

      <!-- 锁定不优化：用户拿到结果后调整策略的主入口（已调好的技能固定住，只搜其余）。 -->
      <div v-if="abilitySlots.length" class="space-y-2 border-t border-border/60 pt-3" data-trigger-optimizer-locks>
        <p class="control-label">{{ t('common:triggerOptimizer.lockTitle') }}</p>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="slot in abilitySlots"
            :key="slot.abilityHrid"
            class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
            :class="slot.locked ? 'bg-muted text-muted-foreground' : ''"
            :data-trigger-optimizer-lock="slot.abilityHrid"
          >
            <input
              type="checkbox"
              :checked="slot.locked"
              :disabled="running"
              @change="toggleLock(slot.abilityHrid, $event.target.checked)"
            />
            <span>{{ getAbilityName(slot.abilityHrid) }}</span>
            <span v-if="slot.locked" class="text-[10px]">{{ t('common:triggerOptimizer.locked') }}</span>
          </label>
        </div>
      </div>

      <!-- 模拟载荷（2026-09-27，设计 §59）：勾选参与整队模拟的队友。空 = 单人模拟（现状，零行为
           变化）；勾上队友后按整队评估（更贴近组队刷怪），但每场模拟约慢 3~4 倍（实测量级）。
           队友配置**冻结**参与（只改主角触发器），指标仍按主角结算；队友集合与队友配置都进输入
           指纹 ⇒ 换队友 / 改队友配置后既有报告自动过期。 -->
      <div v-if="partyCandidates.length" class="space-y-2 border-t border-border/60 pt-3" data-trigger-optimizer-party>
        <p class="control-label">{{ t('common:triggerOptimizer.partyTitle') }}</p>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="player in partyCandidates"
            :key="player.id"
            class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
            :class="isPartyPlayerSelected(player.id) ? 'bg-muted text-muted-foreground' : ''"
            :data-trigger-optimizer-party-player="player.id"
          >
            <input
              type="checkbox"
              :checked="isPartyPlayerSelected(player.id)"
              :disabled="running"
              @change="togglePartyPlayer(player.id, $event.target.checked)"
            />
            <span>{{ player.name }}</span>
            <span v-if="isPartyPlayerSelected(player.id)" class="text-[10px]">{{
              t('common:triggerOptimizer.partyIncluded')
            }}</span>
          </label>
        </div>
        <p class="text-xs text-muted-foreground" data-trigger-optimizer-party-hint>
          {{ t('common:triggerOptimizer.partyHint') }}
        </p>
      </div>

      <div class="space-y-2 border-t border-border/60 pt-3">
        <div class="flex flex-wrap items-end gap-4">
          <label class="w-48 max-w-full"
            ><span class="control-label">{{ t('common:triggerOptimizer.preset') }}</span
            ><select
              class="control-input w-full"
              :value="activePreset"
              :disabled="running"
              data-trigger-optimizer-preset
              @change="applyPreset($event.target.value)"
            >
              <option :value="TRIGGER_OPTIMIZER_PRESET_FAST">
                {{ t('common:triggerOptimizer.presets.fast') }}
              </option>
              <option :value="TRIGGER_OPTIMIZER_PRESET_STANDARD">
                {{ t('common:triggerOptimizer.presets.standard') }}
              </option>
              <option :value="TRIGGER_OPTIMIZER_PRESET_FINE">
                {{ t('common:triggerOptimizer.presets.fine') }}
              </option>
              <option :value="TRIGGER_OPTIMIZER_PRESET_CUSTOM" disabled>
                {{ t('common:triggerOptimizer.presets.custom') }}
              </option>
            </select></label
          >
          <label class="w-32 max-w-full"
            ><span class="control-label">{{ t('common:triggerOptimizer.rounds') }}</span
            ><input
              v-model="sampleRoundsDraft"
              class="control-input w-full"
              type="number"
              :min="TRIGGER_OPTIMIZER_MIN_ROUNDS"
              :max="TRIGGER_OPTIMIZER_MAX_ROUNDS"
              step="1"
              :disabled="running"
              :aria-invalid="!validDraft"
              data-trigger-optimizer-rounds
              @input="updateSettings('rounds', $event.target.value)"
          /></label>
          <label class="w-40 max-w-full"
            ><span class="control-label">{{ t('common:triggerOptimizer.weightProfit') }}</span
            ><input
              v-model="profitDraft"
              class="control-input w-full"
              type="number"
              min="0"
              max="100"
              step="1"
              :disabled="running"
              :aria-invalid="!validDraft"
              data-trigger-optimizer-profit-weight
              @input="updateWeight('weightProfit', $event.target.value)"
          /></label>
          <label class="w-40 max-w-full"
            ><span class="control-label">{{ t('common:triggerOptimizer.weightXp') }}</span
            ><input
              v-model="xpDraft"
              class="control-input w-full"
              type="number"
              min="0"
              max="100"
              step="1"
              :disabled="running"
              :aria-invalid="!validDraft"
              data-trigger-optimizer-xp-weight
              @input="updateWeight('weightXp', $event.target.value)"
          /></label>
          <div class="w-40 max-w-full">
            <p class="control-label">{{ t('common:triggerOptimizer.weightDeathSafety') }}</p>
            <p class="text-sm tabular-nums" data-trigger-optimizer-death-weight>{{ number(deathSafetyPercent, 2) }}%</p>
          </div>
          <label class="w-36 max-w-full"
            ><span class="control-label">{{ t('common:triggerOptimizer.simulationHours') }}</span
            ><input
              v-model="hoursDraft"
              class="control-input w-full"
              type="number"
              :min="TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS"
              :max="TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS"
              step="1"
              :disabled="running"
              :aria-invalid="!validDraft"
              data-trigger-optimizer-hours
              @input="updateSettings('simulationHours', $event.target.value)"
          /></label>
        </div>
        <details class="rounded-md border border-border/60 px-3 py-2" data-trigger-optimizer-advanced>
          <summary class="cursor-pointer text-xs font-medium">
            {{ t('common:triggerOptimizer.advanced') }}
          </summary>
          <div class="mt-2 flex flex-wrap items-end gap-4">
            <label class="w-32 max-w-full"
              ><span class="control-label">{{ t('common:triggerOptimizer.maxRounds') }}</span
              ><input
                v-model="maxRoundsDraft"
                class="control-input w-full"
                type="number"
                :min="TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS"
                :max="TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS"
                step="1"
                :disabled="running"
                :aria-invalid="!validDraft"
                data-trigger-optimizer-max-rounds
                @input="updateSettings('maxRounds', $event.target.value)"
            /></label>
            <label class="w-36 max-w-full"
              ><span class="control-label">{{ t('common:triggerOptimizer.candidateLimit') }}</span
              ><input
                v-model="candidateDraft"
                class="control-input w-full"
                type="number"
                :min="TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT"
                :max="TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT"
                step="1"
                :disabled="running"
                :aria-invalid="!validDraft"
                data-trigger-optimizer-candidate-limit
                @input="updateSettings('candidateLimit', $event.target.value)"
            /></label>
          </div>
        </details>
      </div>
    </section>

    <p v-if="!validDraft" class="text-sm text-destructive" role="alert">
      {{ t('common:triggerOptimizer.invalidSettings') }}
    </p>
    <p v-else-if="blockReason" class="text-sm text-warning" role="status">{{ t(blockReason) }}</p>
    <p v-if="errorText" class="break-words text-sm text-destructive" role="alert" data-trigger-optimizer-error>
      {{ t(errorText, errorText) }}
    </p>

    <section v-if="!imported" class="space-y-2 border-t border-border pt-4" data-trigger-optimizer-empty>
      <p class="text-sm text-muted-foreground">{{ t('common:triggerOptimizer.emptyState') }}</p>
      <Button as-child variant="outline" size="sm"
        ><RouterLink to="/home">{{ t('common:triggerOptimizer.goHome') }}</RouterLink></Button
      >
    </section>

    <section v-if="running || hasResults" class="space-y-3 border-t border-border pt-4" data-trigger-optimizer-progress>
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p class="font-medium" data-trigger-optimizer-phase>
          {{ t(`common:triggerOptimizer.phases.${phaseKey}`) }}
        </p>
        <span class="tabular-nums" data-trigger-optimizer-elapsed>{{ number(liveStats.elapsedSeconds, 1) }} s</span>
      </div>
      <progress
        class="h-2 w-full accent-primary"
        data-trigger-optimizer-progress-bar
        :value="progressValue"
        max="1"
        :aria-label="t('common:triggerOptimizer.progress')"
      />
      <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span v-if="running && runtimeDetail" data-trigger-optimizer-current>{{ runtimeDetail }}</span>
        <span v-if="running && etaSeconds != null" data-trigger-optimizer-eta>
          {{ t('common:triggerOptimizer.eta', '', { seconds: number(etaSeconds, 0) }) }}
        </span>
        <span>{{ t('common:triggerOptimizer.candidateEvaluations') }}: {{ number(liveStats.evaluations, 0) }}</span
        ><span>{{ t('common:triggerOptimizer.evaluations') }}: {{ number(liveStats.simulations, 0) }}</span
        ><span>{{ t('common:triggerOptimizer.roundsUsed') }}: {{ number(liveStats.rounds, 0) }}</span
        ><span
          >{{ t('common:triggerOptimizer.workers') }}: {{ number(liveStats.maxConcurrentWorkers, 0) }} /
          {{ number(liveStats.workerLimit, 0) }}</span
        >
      </div>
      <p v-if="stale" class="text-sm text-warning" role="status">{{ t('common:triggerOptimizer.stale') }}</p>
    </section>

    <section v-if="hasResults" class="space-y-3 border-t border-border pt-4" data-trigger-optimizer-results>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-base font-semibold">{{ t('common:triggerOptimizer.resultsTitle') }}</h3>
          <!-- 解释性长段落（复验口径 / 得分尺度 / 深挖复核 / 跨槽联合采纳 / 轮数上限 /
               噪声地板与显著门槛 / 应用范围）全部收进「查看说明」弹窗（2026-09-22）：结果区只留结论、
               数字与逐技能卡片，需要时再点开看 —— 平铺时一屏四五段长文，用户一般不会读。 -->
          <Button size="sm" variant="ghost" data-trigger-optimizer-notes-open @click="openNotes()"
            ><Info />{{ t('common:triggerOptimizer.notesEntry') }}</Button
          >
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            :disabled="exportBusy"
            data-trigger-optimizer-export
            @click="exportReport()"
            ><Download />{{ t('common:triggerOptimizer.exportReport') }}</Button
          >
          <Button v-if="canRevert" size="sm" variant="outline" data-trigger-optimizer-revert @click="revert()"
            ><Undo2 />{{ t('common:triggerOptimizer.revert') }}</Button
          >
          <Button size="sm" :disabled="!canApply" data-trigger-optimizer-apply @click="apply()"
            ><Check />{{
              t(results.appliedInputSignature ? 'common:triggerOptimizer.applied' : 'common:triggerOptimizer.apply')
            }}</Button
          >
        </div>
      </div>
      <!-- 复验否决（2026-09-18）：报告被判「换种子后显著更差」时，应用按钮直接禁用并把
           理由写在按钮下方（判定与 store 的拒绝口径同源，不只是 UI 禁用）。 -->
      <p
        v-if="resultRejected && improvement?.improved === true"
        class="text-sm text-destructive"
        role="status"
        data-trigger-optimizer-apply-blocked
      >
        {{ t('common:triggerOptimizer.applyBlockedNegative') }}
      </p>

      <!-- 结果分三层：结论卡（提升是否可信）→ 指标对照 → 每技能候选细节。 -->
      <div v-if="improvement" class="grid gap-4 md:grid-cols-2">
        <!-- 结论卡：边框/底色按复验结论变色，只回答「改了几个技能、提升成不成立」；
             支撑这些结论的口径与建议在「查看说明」弹窗里（见 resultNotes）。 -->
        <div class="flex flex-col gap-3 rounded-lg border p-4" :class="verdictCardClass">
          <div class="flex items-start gap-3">
            <component :is="verdictIcon" class="size-6 shrink-0" :class="verdictTextClass" />
            <div class="min-w-0">
              <p class="font-medium" :class="verdictTextClass" data-trigger-optimizer-verdict>{{ verdictHeadline }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" data-trigger-optimizer-summary>
            <div>
              <p class="text-xs text-muted-foreground">{{ t('common:triggerOptimizer.changedAbilities') }}</p>
              <p class="tabular-nums font-medium" data-trigger-optimizer-changed>
                {{ t('common:triggerOptimizer.changedAbilitiesValue', '', changedAbilities) }}
              </p>
            </div>
            <div v-if="verification">
              <p class="text-xs text-muted-foreground">{{ t('common:triggerOptimizer.verificationTitle') }}</p>
              <p class="font-medium" :class="verdictTextClass" data-trigger-optimizer-verification>
                {{ t(`common:triggerOptimizer.verdicts.${verification.verdict || 'unknown'}`) }}
              </p>
            </div>
            <div v-if="verificationPValue != null">
              <p class="text-xs text-muted-foreground">
                {{ t('common:triggerOptimizer.verificationPValue') }}
              </p>
              <p class="tabular-nums text-xs text-muted-foreground">{{ verificationPValueLabel }}</p>
            </div>
          </div>
          <!-- 复验三态的诚实标注（2026-09-24，设计 §31）：复验判「未达显著」且搜索期确有提升时，
               不能默默放行 —— 明说「提升尚未被独立样本确认」，并给出「追加复验」把不确定结论追到
               明确（产品口径不变：只有复验判负才否决应用，未达显著仍可应用，只是不许装作已确认）。
               合并轮数标注与警示行分开判定：追加后结论转正时警示行消失，留档仍然显示。 -->
          <div v-if="showVerifyAppend || verifyAppendMergedText" class="flex flex-col gap-2">
            <p
              v-if="showVerifyAppend"
              class="text-sm text-warning"
              role="status"
              data-trigger-optimizer-verify-unconfirmed
            >
              {{ t('common:triggerOptimizer.verifyUnconfirmed') }}
            </p>
            <!-- 追加轮数不是常量了（2026-09-25，设计 §47）：这一次要追加多少轮、护栏/上限有没有
                 咬住，必须在上屏处说清；上限或护栏咬到「一轮都追加不了」时按钮不挂出来。 -->
            <p
              v-if="verifyAppendPlanText"
              class="text-xs text-muted-foreground"
              data-trigger-optimizer-verify-append-plan
            >
              {{ verifyAppendPlanText }}
            </p>
            <p
              v-if="verifyAppendErrorText"
              class="break-words text-xs text-destructive"
              role="alert"
              data-trigger-optimizer-verify-append-error
            >
              {{ verifyAppendErrorText }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                v-if="showVerifyAppend && !verifyAppendRunning && verifyAppendAvailable"
                size="sm"
                variant="outline"
                data-trigger-optimizer-verify-append
                @click="runVerificationAppend()"
                >{{ t('common:triggerOptimizer.verifyAppend') }}</Button
              >
              <Button
                v-else-if="verifyAppendRunning"
                size="sm"
                variant="outline"
                data-trigger-optimizer-verify-append-stop
                @click="simulator.stopTriggerOptimizer()"
                >{{ t('common:triggerOptimizer.verifyAppendStop') }}</Button
              >
              <p
                v-if="verifyAppendMergedText"
                class="text-xs text-muted-foreground"
                data-trigger-optimizer-verify-append-merged
              >
                {{ verifyAppendMergedText }}
              </p>
            </div>
          </div>
        </div>
        <!-- 综合得分卡：分数变化大字 + 「−1..+1」发散条（0 居中刻度）+ 基线→最优。
             尺度说明同样收进「查看说明」。 -->
        <div class="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-xs text-muted-foreground">{{ t('common:triggerOptimizer.scoreDelta') }}</p>
            <p class="text-3xl font-semibold tabular-nums" :class="scoreDeltaClass">
              {{ signed(improvement.scoreDelta, 4) }}
            </p>
          </div>
          <div class="relative h-2.5 rounded-full bg-muted">
            <div class="absolute inset-y-0 left-1/2 w-px bg-border" />
            <div class="absolute inset-y-0 rounded-full" :class="scoreBarFillClass" :style="scoreBarStyle" />
          </div>
          <div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span class="tabular-nums"
              >{{ t('common:triggerOptimizer.baseline') }}
              {{ baselineScore == null ? '—' : signed(baselineScore, 4) }}</span
            >
            <ArrowRight class="size-3.5" />
            <span class="tabular-nums"
              >{{ t('common:triggerOptimizer.best') }}
              <span data-trigger-optimizer-score>{{ signed(improvement.score, 4) }}</span></span
            >
          </div>
        </div>
      </div>
      <!-- 结论适用范围 + 换难度复核（2026-09-23，设计 §29）：触发器写的是**全局技能配置**，
           而搜索只在「一个区域 + 一个难度」上评估过 —— 这里把结论的边界写在结论旁边，并给出
           「换个难度再看一眼」的入口（2 次评估 × 自适应 6~12 轮，见设计 §49；只读，不改玩家配置）。 -->
      <div
        v-if="evaluationScope"
        class="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs"
        data-trigger-optimizer-scope
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium text-muted-foreground">{{ t('common:triggerOptimizer.scopeTitle') }}</p>
            <p class="mt-0.5" data-trigger-optimizer-scope-text>{{ scopeText }}</p>
            <!-- 模拟载荷（2026-09-27，设计 §59）：与「结论适用范围」同一块的边界标注 —— 这份结论是在
                 单人还是整队（哪些队友）载荷上得出的。 -->
            <p class="mt-0.5 text-muted-foreground" data-trigger-optimizer-scope-party>{{ scopePartyText }}</p>
            <!-- 队伍载荷的保守提示（2026-09-27，设计 §60 / C1-①）：C1 实测队伍载荷下判据链真检出率偏低
                 （本机基准 93.2% → 64.6%，同一批种子与切分）⇒ 有队友时结论可能欠采。只提示，不改判据 / 数值。 -->
            <p
              v-if="scopePartyEntries.length > 0"
              class="mt-0.5 text-warning"
              role="status"
              data-trigger-optimizer-scope-party-detection
            >
              {{ scopePartyDetectionNote }}
            </p>
          </div>
          <Button
            v-if="robustnessRunning"
            size="sm"
            variant="outline"
            data-trigger-optimizer-robustness-stop
            @click="stopRobustness()"
            ><Square />{{ robustnessStopLabel }}</Button
          >
          <!-- 首跑入口：只在没有复核结论时挂出；已有结论时再点是**追加**（见结果区的追加入口），
               不会用同盐复跑覆盖旧结论（§51）。 -->
          <Button
            v-else-if="!robustnessSummary"
            size="sm"
            variant="outline"
            :disabled="!canRunRobustness"
            data-trigger-optimizer-robustness-run
            @click="runRobustness()"
            ><RefreshCw />{{ robustnessButtonLabel }}</Button
          >
        </div>
        <!-- 复核进行中：说清在跑什么、跑到哪（两个配置各 N 场，N 来自本次计划；进度来自 store 的复核运行态）。 -->
        <p v-if="robustnessRunning" class="text-muted-foreground" data-trigger-optimizer-robustness-progress>
          {{ robustnessProgressText }}
        </p>
        <!-- 复核结果：Δ 得分 / Δ 日利润 / p / 结论。方向看符号、显著性看判定（口径与复验同源）。 -->
        <div
          v-else-if="robustnessSummary"
          class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-2"
          data-trigger-optimizer-robustness-result
        >
          <span class="font-medium">{{
            t('common:triggerOptimizer.robustnessTitle', '', { tier: robustnessSummary.difficultyTier })
          }}</span>
          <span class="text-muted-foreground">
            {{ t('common:triggerOptimizer.scoreDelta') }}
            <span class="tabular-nums" :class="robustnessScoreClass" data-trigger-optimizer-robustness-score>{{
              signed(robustnessSummary.scoreDelta, 4)
            }}</span>
          </span>
          <span class="text-muted-foreground">
            {{ t('common:triggerOptimizer.robustnessProfit') }}
            <span class="tabular-nums" :class="robustnessProfitClass">{{
              signedCompact('dailyNoRngProfit', robustnessSummary.profitDelta)
            }}</span>
          </span>
          <span class="text-muted-foreground">
            {{ t('common:triggerOptimizer.verificationPValue') }}
            <span class="tabular-nums">{{ robustnessPValueLabel }}</span>
          </span>
          <span :class="robustnessVerdictClass" data-trigger-optimizer-robustness-verdict>
            {{ t('common:triggerOptimizer.robustnessVerdict') }}：{{ robustnessVerdictLabel }}
          </span>
        </div>
        <!-- 复核**实际执行**的计划（2026-09-25，设计 §49）：跑了几轮、是反解出来的还是被上限/成本
             护栏咬住 —— 结论旁边要有这句，否则「为什么是 6 轮 / 12 轮」事后无据可查。 -->
        <p
          v-if="robustnessPlanDetail"
          class="text-xs text-muted-foreground"
          data-trigger-optimizer-robustness-plan-detail
        >
          {{ robustnessPlanDetail }}
        </p>
        <!-- 复核追加（2026-09-26，设计 §51）：已复核过就再补一组**换盐新样本**与首跑样本合并重检
             ——旧口径的「同盐复跑」被实测证伪（逐值相同、白烧 2 × 轮数样本，见 §51）。护栏/上限/
             零差咬到「一轮都追加不了」时不挂按钮，只挂原因句（按钮凭空消失会被读成功能坏了）。 -->
        <p
          v-if="robustnessAppendMergedText"
          class="text-xs text-muted-foreground"
          data-trigger-optimizer-robustness-append-merged
        >
          {{ robustnessAppendMergedText }}
        </p>
        <p
          v-if="!robustnessRunning && robustnessAppendHintText"
          class="text-xs text-muted-foreground"
          data-trigger-optimizer-robustness-append-hint
        >
          {{ robustnessAppendHintText }}
        </p>
        <p
          v-if="!robustnessRunning && robustnessAppendBlockedText"
          class="text-xs text-warning"
          data-trigger-optimizer-robustness-append-blocked
        >
          {{ robustnessAppendBlockedText }}
        </p>
        <Button
          v-if="robustnessSummary && !robustnessRunning && robustnessAppendAvailable"
          size="sm"
          variant="outline"
          class="self-start"
          data-trigger-optimizer-robustness-append
          @click="runRobustnessAppend()"
          ><RefreshCw />{{ t('common:triggerOptimizer.robustnessAppendRun') }}</Button
        >
        <!-- 未复核时给一句可执行的说明（能复核 → 说明怎么读；不能复核 → 说明为什么）。轮数不是常量
             了（2026-09-25，设计 §49）：反解出计划时再补一句「这次要跑几轮」的明细。 -->
        <p
          v-if="!robustnessRunning && !robustnessSummary"
          :class="robustnessBlockReason ? 'text-warning' : 'text-muted-foreground'"
          data-trigger-optimizer-robustness-note
        >
          {{ robustnessNote }}
        </p>
        <p
          v-if="!robustnessRunning && !robustnessSummary && robustnessPlanText"
          class="text-xs text-muted-foreground"
          data-trigger-optimizer-robustness-plan
        >
          {{ robustnessPlanText }}
        </p>
        <p v-if="robustnessErrorText" class="text-destructive" role="status" data-trigger-optimizer-robustness-error>
          {{ robustnessErrorText }}
        </p>
      </div>
      <p
        v-if="resultsCreated.resourcesAvailable === false"
        class="text-xs text-warning"
        role="status"
        data-trigger-optimizer-resources-warning
      >
        {{ t('common:triggerOptimizer.resourcesUnavailable') }}
      </p>
      <p v-if="lastAction === 'reverted'" class="text-xs text-success" role="status" data-trigger-optimizer-action-note>
        {{ t('common:triggerOptimizer.reverted') }}
      </p>

      <!-- 指标对照卡：每项「基线 vs 最优」同尺度双条形 + 带单位的差值，死亡单列一张卡。
           口径来源必须标明：复验判负时这里显示的是**复验实测**（换种子 6 轮）而不是
           搜索期估算 —— 否则同一屏上会出现「结论卡说更差、指标卡说 +0.1%」的自相矛盾。 -->
      <p v-if="metricCards.length" class="text-xs text-muted-foreground" data-trigger-optimizer-metric-source>
        {{ t(metricSourceKey) }}
      </p>
      <div v-if="metricCards.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="card in metricCards"
          :key="card.key"
          class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
          :data-trigger-optimizer-metric="card.key"
        >
          <p class="text-xs font-medium text-muted-foreground">
            {{ t(`common:triggerOptimizer.metrics.${card.key}`) }}
          </p>
          <div class="space-y-1.5">
            <div class="flex items-center gap-2 text-xs">
              <span class="w-7 shrink-0 text-muted-foreground">{{ t('common:triggerOptimizer.baseline') }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-muted-foreground/40" :style="{ width: `${card.baselineWidth}%` }" />
              </div>
              <span class="w-20 shrink-0 text-right tabular-nums">{{
                formatMetricValue(card.key, card.baselineValue)
              }}</span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="w-7 shrink-0 text-muted-foreground">{{ t('common:triggerOptimizer.best') }}</span>
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${card.bestWidth}%` }" />
              </div>
              <span class="w-20 shrink-0 text-right font-medium tabular-nums">
                {{ formatMetricValue(card.key, card.bestValue) }}
              </span>
            </div>
          </div>
          <p class="text-right text-xs tabular-nums" :class="deltaClass(card.key, card.delta)">
            {{ formatMetricDelta(card) }}
          </p>
        </div>
      </div>

      <p v-if="!choices.length" class="text-sm text-muted-foreground">{{ t('common:triggerOptimizer.noResults') }}</p>
      <!-- 每技能一张卡片：左「当前配置（搜索起点）」、右「模拟最优配置」，改动过的条目带圆点、
           没动的淡出——列表本身先回答「每个技能被改成了什么」。候选分数、配对信号、指标明细、
           深挖复核等细节收进「详情」弹窗，卡片保持可扫读、可横向对比。 -->
      <div v-else class="grid gap-4 lg:grid-cols-2" data-trigger-optimizer-choices>
        <article
          v-for="choice in choices"
          :key="`${choice.slotIndex}-${choice.abilityHrid}`"
          class="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4"
          data-trigger-optimizer-choice
          :data-trigger-optimizer-choice-slot="choice.slotIndex"
        >
          <!-- 卡片头部：技能名 + 角色 + 槽位 + 「推荐：候选 · 得分 · 配对信号徽章」。 -->
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex flex-wrap items-baseline gap-2">
              <p class="text-sm font-semibold">{{ getAbilityName(choice.abilityHrid) }}</p>
              <span class="text-xs text-muted-foreground">{{ t(choice.roleLabelKey, '') }}</span>
              <span class="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                {{ t('common:triggerOptimizer.slotLabel', '', { index: Number(choice.slotIndex) + 1 }) }}
              </span>
              <span v-if="choice.locked" class="text-xs text-muted-foreground">
                {{ t('common:triggerOptimizer.locked') }}
              </span>
            </div>
            <!-- 复验判负时**不**再挂「推荐」徽章（2026-09-18）：搜索期的分数已被 6 轮复验
                 证伪，继续把它标成推荐就是让用户去应用一个更差的配置。
                 另外两个条件（2026-09-19）：①「本槽最优 = 当前配置/默认触发器（得分 0）」时
                 不叫「推荐」（读起来像推荐一个 0 分改动，语义其实是保持现状）；②该槽必须**真的
                 被采纳过**（adoptedSlots）——chosen 会保留未被采纳的槽内最优，只看它会让卡片挂着
                 「推荐」而同屏结论写着「证据不足、已优化 0 / N」。 -->
            <p
              v-if="choice.chosen && !resultRejected && chosenScore(choice) > 0 && slotAdopted(choice.slotIndex)"
              class="flex flex-wrap items-center gap-1.5 text-xs"
              data-trigger-optimizer-recommendation
            >
              <span class="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {{ t('common:triggerOptimizer.recommendation') }}
              </span>
              <span class="font-medium">{{ candidateLabel(choice.chosen) }}</span>
              <span class="text-muted-foreground">·</span>
              <span class="tabular-nums">{{ t('common:triggerOptimizer.score') }} {{ chosenScoreText(choice) }}</span>
              <span
                v-if="choice.chosen.paired"
                class="rounded px-1 py-0.5 text-[10px]"
                :class="verdictBadgeClass(choice.chosen.paired.score?.verdict)"
              >
                {{ t(`common:triggerOptimizer.signals.${choice.chosen.paired.score?.verdict || 'unknown'}`) }}
              </span>
              <!-- 搜索期 verdict 不是 positive 时，采纳依据是**噪声地板**（|mean| > 2×SE）而不是
                   显著性声明：不写清楚会被读成「没证据也硬采纳」（2026-09-19，设计 §19.4/§19.6）。
                   深挖采纳的槽**不挂**这枚标签：它的依据是扩样到 6 轮后的复测（旁边已有
                   「深挖复核通过（6 轮）」），而搜索期的 mean 可能本来就没过地板
                   （熊熊图实测：搜索期 0.0732 < 2×SE 0.0764，深挖 6 轮 0.0785 > 0.0632）。 -->
              <span
                v-if="
                  choice.chosen.paired &&
                  choice.chosen.paired.score?.verdict !== 'positive' &&
                  deepDiveForSlot(choice.slotIndex)?.adopted !== true
                "
                class="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                :title="adoptionEvidenceHint(choice)"
                data-trigger-optimizer-adoption-evidence
              >
                {{ t('common:triggerOptimizer.noiseFloorPassed') }}
              </span>
              <!-- 深挖采纳的槽：搜索期的「不显著」徽章会被误读成「没证据也硬采纳」，
                   这里补一句「哪来的证据」（同盐扩样，设计 §18.1）。 -->
              <span
                v-if="deepDiveForSlot(choice.slotIndex)?.adopted === true"
                class="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                data-trigger-optimizer-deep-dive-slot
              >
                {{
                  t('common:triggerOptimizer.deepDiveAdopted', '', { rounds: deepDiveForSlot(choice.slotIndex).rounds })
                }}
              </span>
            </p>
            <p
              v-else-if="choice.chosen && resultRejected"
              class="text-xs text-destructive"
              data-trigger-optimizer-recommendation-withheld
            >
              {{ t('common:triggerOptimizer.recommendationWithheld') }}
            </p>
            <p v-else-if="choice.locked" class="text-xs text-muted-foreground">
              {{ t('common:triggerOptimizer.locked') }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              {{ t('common:triggerOptimizer.keepCurrent') }}
              <span
                v-if="deepDiveForSlot(choice.slotIndex)?.adopted === false"
                class="text-[10px]"
                data-trigger-optimizer-deep-dive-slot
              >
                ·
                {{
                  t('common:triggerOptimizer.deepDiveBlocked', '', { rounds: deepDiveForSlot(choice.slotIndex).rounds })
                }}
              </span>
            </p>
          </div>

          <!-- 配置对比：两侧同结构、改动过的条目带圆点（对侧没有的那一行才算改动）。
               「游戏默认触发器」不再是代替内容的一句话——默认列表按游戏数据展开成真实条目，
               只在标题下补一行说明（否则「用户配置恰好等价于默认」会被渲染成一次假改动）。
               两侧**不同颜色**高亮（2026-09-22 用户要求）：左边冷色 = 你现在是什么样，
               右边主色 = 会变成什么样（与当前配置相同时自动降档，见 triggerBestPanelClass）。
               最优侧一度有过一条左侧竖条，用户看后要求去掉（2026-09-22）——只留底色调区分。 -->
          <div class="grid gap-2 sm:grid-cols-2">
            <section
              class="min-w-0 rounded-md border p-2"
              :class="TRIGGER_ORIGINAL_PANEL_CLASS"
              data-trigger-optimizer-original
            >
              <p class="text-xs font-medium text-info">{{ t('common:triggerOptimizer.originalConfig') }}</p>
              <p
                v-if="isOriginalDefault(choice)"
                class="text-[10px] text-muted-foreground"
                data-trigger-optimizer-original-default
              >
                {{ t('common:triggerOptimizer.defaultTriggers') }}
              </p>
              <ul class="mt-1 space-y-0.5 text-xs">
                <li
                  v-for="(line, index) in originalLines(choice)"
                  :key="index"
                  class="flex items-start gap-1.5"
                  :class="line.changed ? 'text-foreground' : 'text-muted-foreground'"
                  :data-trigger-optimizer-line-changed="line.changed ? 'true' : 'false'"
                >
                  <span
                    class="mt-1.5 size-1 shrink-0 rounded-full"
                    :class="line.changed ? 'bg-primary' : 'bg-transparent'"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 break-words">{{ line.text }}</span>
                </li>
              </ul>
            </section>
            <section
              class="min-w-0 rounded-md border p-2"
              :class="triggerBestPanelClass(!configUnchanged(choice))"
              data-trigger-optimizer-best
            >
              <p class="flex flex-wrap items-baseline gap-1 text-xs">
                <span class="font-medium text-primary">{{ t('common:triggerOptimizer.bestConfig') }}</span>
                <span
                  v-if="bestLabelFor(choice)"
                  class="rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary"
                  data-trigger-optimizer-best-label
                  >{{ bestLabelFor(choice) }}</span
                >
              </p>
              <p
                v-if="isBestDefault(choice)"
                class="text-[10px] text-muted-foreground"
                data-trigger-optimizer-best-default
              >
                {{ t('common:triggerOptimizer.defaultTriggers') }}
              </p>
              <ul class="mt-1 space-y-0.5 text-xs">
                <li
                  v-for="(line, index) in bestLines(choice)"
                  :key="index"
                  class="flex items-start gap-1.5"
                  :class="line.changed ? 'text-foreground' : 'text-muted-foreground'"
                  :data-trigger-optimizer-line-changed="line.changed ? 'true' : 'false'"
                >
                  <span
                    class="mt-1.5 size-1 shrink-0 rounded-full"
                    :class="line.changed ? 'bg-primary' : 'bg-transparent'"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 break-words">{{ line.text }}</span>
                </li>
              </ul>
              <p v-if="configUnchanged(choice)" class="mt-1 text-[10px] text-muted-foreground">
                {{ t('common:triggerOptimizer.sameAsCurrent') }}
              </p>
            </section>
          </div>

          <!-- 本槽净效应直显（2026-09-25，§27.6）：与详情弹窗同源（buildNetMetricRows），
               卡片只留「指标 + 配对差 ± 标准误 + 显著性」摘要，完整表与口径说明在弹窗里。
               未采纳的槽不渲染（净效应是「本槽改动」的账，没改动就没账可记）。 -->
          <div
            v-if="netMetricRowsFor(choice).length"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            data-trigger-optimizer-net-summary
          >
            <span class="font-medium text-muted-foreground">{{ t('common:triggerOptimizer.netMetricsTitle') }}</span>
            <span
              v-for="row in netMetricRowsFor(choice)"
              :key="row.key"
              class="flex items-baseline gap-1"
              :data-trigger-optimizer-net-summary-metric="row.key"
            >
              <span class="tabular-nums" :class="deltaClass(row.key, row.mean)"
                >{{ t(`common:triggerOptimizer.metrics.${row.key}`) }} {{ netDeltaText(row) }}</span
              >
              <span
                class="text-[10px] text-muted-foreground"
                :class="netMetricSignificanceKey(row.verdict) === 'significant' ? 'font-medium text-foreground' : ''"
                :data-trigger-optimizer-net-summary-significance="netMetricSignificanceKey(row.verdict)"
                >{{ netMetricSignificanceLabel(row.verdict) }}</span
              >
            </span>
          </div>

          <footer class="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
            <p class="text-xs text-muted-foreground">
              {{ t('common:triggerOptimizer.detailsHint', '', { count: candidateCount(choice) }) }}
            </p>
            <Button
              size="sm"
              variant="outline"
              :data-trigger-optimizer-details-open="choice.slotIndex"
              @click="openDetails(choice)"
              ><Info />{{ t('common:triggerOptimizer.details') }}</Button
            >
          </footer>
        </article>
      </div>
      <p v-if="hasAlwaysFireCandidate" class="text-xs text-muted-foreground" data-trigger-optimizer-disabled-hint>
        {{ disabledHint }}
      </p>
      <p v-if="hasCompositeCandidate" class="text-xs text-muted-foreground" data-trigger-optimizer-and-hint>
        {{ t('common:triggerOptimizer.candidate.andHint') }}
      </p>
    </section>

    <!-- 结果说明弹窗：结论卡 / 得分卡 / 指标卡下面原本平铺的解释性长段落集中在这里
         （条目按本次报告是否适用组装，见 resultNotes）。 -->
    <TriggerOptimizerNotes scope="result" :open="notesOpen" :notes="resultNotes" @close="closeNotes" />

    <!-- 参数说明弹窗：搜索设置卡片下面原本平铺的 8 段解释性长文集中在这里（见 settingsNotes）。 -->
    <TriggerOptimizerNotes
      scope="settings"
      :title-key="'common:triggerOptimizer.settingsNotesTitle'"
      :open="settingsNotesOpen"
      :notes="settingsNotes"
      @close="closeSettingsNotes"
    />

    <!-- 详情弹窗：某技能的其它模拟结果与相关数据（候选评估 / 指标明细 / 深挖与联合采纳记录）。
         按槽位记账而不是直接存 choice 对象：新一轮结果替换后对象身份会变，存对象会让弹窗停在旧报告上。 -->
    <TriggerOptimizerAbilityDetails
      :open="detailsOpen"
      :choice="detailChoice"
      :original-triggers="detailOriginalTriggers"
      :best-triggers="detailBestTriggers"
      :best-label="detailBestLabel"
      :metrics-by-candidate="resultsCreated.metricsByCandidate || {}"
      :baseline-metrics="resultsCreated.baselineMetrics || null"
      :deep-dive="detailDeepDive"
      :joint-adoptions="detailJointAdoptions"
      :result-rejected="resultRejected"
      :adopted="detailChoice ? slotAdopted(detailChoice.slotIndex) : false"
      @close="closeDetails"
    />
  </section>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  Info,
  Minus,
  Play,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Square,
  TrendingDown,
  TrendingUp,
  Undo2,
} from '@lucide/vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { snapshotTriggerOptimizerInput, triggerOptimizerBusy } from '../../stores/simulatorTriggerOptimizerActions.js';
import {
  ABILITY_SLOT_COUNT,
  TRIGGER_OPTIMIZER_CANDIDATE_DISABLED_HINT_KEY,
  isAbilitySlotActive,
} from '../../services/triggerOptimizerCandidates.js';
import {
  TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS,
  TRIGGER_OPTIMIZER_METRIC_KEYS,
  TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS,
  TRIGGER_OPTIMIZER_PRESET_CUSTOM,
  TRIGGER_OPTIMIZER_PRESET_FAST,
  TRIGGER_OPTIMIZER_PRESET_FINE,
  TRIGGER_OPTIMIZER_PRESET_STANDARD,
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_RACING_KEEP,
  TRIGGER_OPTIMIZER_RACING_MIN_POOL,
  TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
  TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO,
  TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO,
  TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  getTriggerOptimizerPresetSettings,
  isValidTriggerOptimizerSettings,
  resolveTriggerOptimizerAppendSpentSimulations,
  resolveTriggerOptimizerPresetId,
} from '../../services/triggerOptimizerDomain.js';
import { RUN_SCOPE_SINGLE, resolveAdjacentDifficultyTier } from '../../services/simulationDomain.js';
import {
  isTriggerOptimizerResultRejected,
  planTriggerOptimizerRobustnessAppend,
  planTriggerOptimizerRobustnessRounds,
  planTriggerOptimizerVerificationAppend,
  resolveTriggerOptimizerDetectionFloor,
  resolveTriggerOptimizerRoundsForEffect,
  resolveTriggerOptimizerRoundsForSignificance,
  TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE,
} from '../../services/triggerOptimizerScoring.js';
import { downloadTriggerOptimizerReportXlsx } from '../components/triggerOptimizerExport.js';
import TriggerOptimizerAbilityDetails from '../components/TriggerOptimizerAbilityDetails.vue';
import TriggerOptimizerNotes from '../components/TriggerOptimizerNotes.vue';
import {
  buildNetMetricRows,
  createTriggerOptimizerText,
  netMetricSignificanceKey,
  resolveBestTriggers,
  resolveOriginalTriggers,
  TRIGGER_ORIGINAL_PANEL_CLASS,
  triggerBestPanelClass,
  triggerMetricDeltaClass,
  triggerVerdictBadgeClass,
  triggerVerdictTextClass,
} from '../components/triggerOptimizerText.js';
import { Button } from '../components/ui/button/index.js';
import { useI18nText } from '../composables/useI18nText.js';
import { useGameDataText } from '../composables/useGameDataText.js';

const simulator = useSimulatorStore();
const { t, language } = useI18nText();
const { getAbilityName, getActionName, getMonsterName, getOfficialGameText } = useGameDataText();

// 数值与文案格式化、信号配色、指标差值配色全部与详情弹窗共用同一份实现
// （components/triggerOptimizerText.js）：同一个候选在卡片与弹窗里必须给出同样的标签、
// 同样的精度、同样的颜色，否则「对比」这件事本身就不成立。
const number = (value, digits = 2) =>
  Number(value || 0).toLocaleString(language.value, { maximumFractionDigits: digits });
const {
  signed,
  formatMetricValue,
  signedCompact,
  configLines,
  configsMatch,
  candidateLabel,
  netDeltaText,
  netMetricSignificanceLabel,
} = createTriggerOptimizerText({
  t,
  number,
  getOfficialGameText,
});
const verdictBadgeClass = triggerVerdictBadgeClass;
const deltaClass = triggerMetricDeltaClass;

const input = computed(() => snapshotTriggerOptimizerInput(simulator));
const settings = computed(() => simulator.triggerOptimizer.settings);
const results = computed(() => simulator.triggerOptimizer.results);
const resultsCreated = computed(() => results.value ?? {});
const runtime = computed(() => simulator.triggerOptimizer.runtime);
const running = computed(() => runtime.value.isRunning);
const busy = computed(() => triggerOptimizerBusy(simulator));
const stale = computed(() => simulator.triggerOptimizerReportStale);
const imported = computed(() => simulator.queue?.importedProfileByPlayer?.[simulator.activePlayerId] === true);
const hasResults = computed(() => Boolean(results.value?.createdAt));
const improvement = computed(() => results.value?.improvement || null);
const verification = computed(() => results.value?.verification || null);
const choices = computed(() =>
  Array.isArray(results.value?.perAbilityChoices) ? results.value.perAbilityChoices : [],
);
const METRIC_KEYS = TRIGGER_OPTIMIZER_METRIC_KEYS;
const disabledHint = computed(() => t(TRIGGER_OPTIMIZER_CANDIDATE_DISABLED_HINT_KEY, ''));

// 深挖记录（2026-09-19，设计 §18.1）：被噪声地板拦下的槽级最优候选的加密复核结果。
// 报告里最多每槽一条；UI 用它解释「这个槽为什么被采纳（或不采纳）」。
const deepDives = computed(() => (Array.isArray(results.value?.deepDives) ? results.value.deepDives : []));
// 真正被采纳过的槽位（2026-09-19 实测补记）：`chosen` 会保留「槽内最优」——即使它因证据
// 不足没被采纳。只按 chosen 挂「推荐」徽章会与同屏的「证据不足 / 已优化 0 / N」自相矛盾。
const adoptedSlots = computed(() => (Array.isArray(results.value?.adoptedSlots) ? results.value.adoptedSlots : []));
function slotAdopted(slotIndex) {
  return adoptedSlots.value.some((value) => Number(value) === Number(slotIndex));
}
const deepDiveSummary = computed(() => {
  const list = deepDives.value;
  if (list.length === 0) return '';
  const passed = list.filter((entry) => entry?.adopted === true).length;
  const rounds = Number(list[0]?.rounds) || 0;
  return t('common:triggerOptimizer.deepDiveNote', '', {
    count: list.length,
    rounds,
    passed,
    blocked: list.length - passed,
  });
});
function deepDiveForSlot(slotIndex) {
  return deepDives.value.find((entry) => Number(entry?.slotIndex) === Number(slotIndex)) ?? null;
}
// 跨槽联合采纳（2026-09-19，设计 §19.11）：单槽增量的证据不足、但一对配置相对本轮起点显著时，
// 两槽一起被采纳。这里汇总一行说清「提升里包含联合采纳的贡献」，避免被误读成普通的槽内推荐。
const jointAdoptions = computed(() =>
  Array.isArray(results.value?.jointAdoptions) ? results.value.jointAdoptions : [],
);
const jointAdoptionSummary = computed(() => {
  const list = jointAdoptions.value;
  if (list.length === 0) return '';
  const slots = new Set();
  for (const entry of list) {
    for (const slot of Array.isArray(entry?.adoptedSlots) ? entry.adoptedSlots : []) slots.add(Number(slot));
  }
  return t('common:triggerOptimizer.jointAdoptionNote', '', { count: list.length, slots: slots.size });
});
// 「本槽最优」的分数（缺值按 0）；得分 0 = 与当前配置等价（UI 显示「保持现状」而不是「推荐」）。
function chosenScore(choice) {
  const value = Number(choice?.chosen?.score);
  return Number.isFinite(value) ? value : 0;
}

// 本槽净效应直显（2026-09-25，§27.6）：与详情弹窗共用取数口径（buildNetMetricRows），
// 卡片只留「指标 + 配对差 ± 标准误 + 显著性」摘要；未采纳的槽不渲染（没有「本槽改动」可记）。
function netMetricRowsFor(choice) {
  return slotAdopted(choice?.slotIndex) ? buildNetMetricRows(choice) : [];
}
const lastAction = ref('');
// 复验否决：独立复验判「最优配置比基线显著更差」→ 不可应用（与 store 同一判据）。
// 复验这一步的价值就在这里：它是**唯一**能证伪搜索期「提升」的环节，判负时必须真的
// 拦住应用，而不是只在结论卡上写一句「不建议应用」。
const resultRejected = computed(() => isTriggerOptimizerResultRejected(results.value));

const targetHrid = computed(() => {
  const simulation = input.value.simulation;
  return simulation.useDungeon ? simulation.dungeonHrid : simulation.zoneHrid;
});
const targetName = computed(() => {
  const simulation = input.value.simulation;
  if (simulation.mode === 'labyrinth') return getMonsterName(simulation.labyrinthHrid);
  return getActionName(targetHrid.value);
});
const difficultyText = computed(() => {
  const simulation = input.value.simulation;
  return simulation.mode === 'labyrinth'
    ? `${t('common:triggerOptimizer.roomLevel')} ${simulation.roomLevel ?? ''}`.trim()
    : `${t('common:triggerOptimizer.tier')} ${simulation.difficultyTier ?? 0}`;
});

// 已佩戴且能进入模拟的技能槽（锁定开关与「已优化技能」计数的同一口径）。
const abilitySlots = computed(() => {
  const player = input.value.player;
  const locked = new Set(settings.value.lockedAbilityHrids || []);
  const slots = [];
  for (let slotIndex = 0; slotIndex < ABILITY_SLOT_COUNT; slotIndex += 1) {
    if (!isAbilitySlotActive(player, slotIndex)) continue;
    const abilityHrid = String(player?.abilities?.[slotIndex]?.abilityHrid || '');
    if (!abilityHrid) continue;
    slots.push({ slotIndex, abilityHrid, locked: locked.has(abilityHrid) });
  }
  return slots;
});
const activeSlotCount = computed(() => abilitySlots.value.length);
const searchableSlotCount = computed(() => abilitySlots.value.filter((slot) => !slot.locked).length);

// ── 模拟载荷：队友选择（2026-09-27，设计 §59）────────────────────────────────────
// 候选 = 除主角外的已保存玩家（引擎按勾选顺序把队友挂成 player2 / player3…）。
// 勾选集合存 settings.partyPlayerIds：空集合 = 单人载荷（现状，零行为变化）；它进输入指纹，
// 因此「换队友」会让既有报告立即过期（与锁定集合同款语义）。
const partyCandidates = computed(() =>
  (simulator.players || [])
    .filter((player) => String(player.id ?? '') !== String(simulator.activePlayerId ?? ''))
    .map((player) => ({ id: String(player.id ?? ''), name: String(player.name || player.id || '') }))
    .filter((player) => player.id !== ''),
);
const selectedPartyIds = computed(() => new Set(settings.value.partyPlayerIds || []));
function isPartyPlayerSelected(playerId) {
  return selectedPartyIds.value.has(String(playerId));
}
function togglePartyPlayer(playerId, selected) {
  const key = String(playerId);
  const next = (settings.value.partyPlayerIds || []).filter((id) => String(id) !== key);
  if (selected) next.push(key);
  simulator.setTriggerOptimizerPartyPlayers(next);
}

// 预计模拟场次（开工前的成本透明化）：与搜索层的口径一致（都按上界计）。
//   基线 1 次 × 重复次数（大候选池再加粗筛参考 1 × SCREEN_ROUNDS）
//   + 轮数上限 × Σ_可搜槽「小池：候选数 × 重复次数 / 大池：候选数 × 粗筛轮数 + 幸存者上界 × 重复次数」
//   + 轮数上限 × 槽对数 × 重复次数 + 复验 2 × VERIFY_ROUNDS
// 幸存者上界 = min(候选数, RACING_KEEP + 2)：top-K + 两个锚点保送（设计 §30）。
// 槽对数 = C(可搜槽数, 2)：跨槽联合探针的成本上界（设计 §19.11；实际只在存在合格成员时才探）。
// 精炼与深挖不在内（只在采纳/被拦时发生，无法事前计入，是既有的简化）。
const plannedSimulations = computed(() => {
  const current = settings.value;
  const slots = searchableSlotCount.value;
  const pairs = (slots * (slots - 1)) / 2;
  const count = current.candidateLimit;
  const racing = count > TRIGGER_OPTIMIZER_RACING_MIN_POOL;
  const survivors = Math.min(count, TRIGGER_OPTIMIZER_RACING_KEEP + 2);
  const perSlotRound = racing
    ? count * TRIGGER_OPTIMIZER_SCREEN_ROUNDS + survivors * current.rounds
    : count * current.rounds;
  return (
    current.rounds +
    (racing && slots > 0 ? TRIGGER_OPTIMIZER_SCREEN_ROUNDS : 0) +
    current.maxRounds * slots * perSlotRound +
    current.maxRounds * pairs * current.rounds +
    2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS
  );
});

const blockReason = computed(() => {
  if (input.value.simulation.mode === 'labyrinth') return 'common:triggerOptimizer.labyrinthUnsupported';
  if (!imported.value) return 'common:triggerOptimizer.requireImport';
  if (input.value.simulation.runScope !== RUN_SCOPE_SINGLE) return 'common:triggerOptimizer.requireSingle';
  if (!targetHrid.value) return 'common:triggerOptimizer.requireZone';
  if (activeSlotCount.value === 0) return 'common:triggerOptimizer.noAbilitySlots';
  // 自身运行期间不显示「被占用」提示（busy 汇总含本优化器），此时按钮本来就是「停止搜索」。
  if (!running.value && busy.value) return 'common:triggerOptimizer.busy';
  return '';
});
const errorText = computed(() => {
  const error = runtime.value.error || '';
  return error && error === blockReason.value ? '' : error;
});
const canStart = computed(() => !running.value && !blockReason.value && validDraft.value);
// ── 运行中的平滑时钟与进度 ──────────────────────────────────────────────
// 搜索层只在「一次评估结束」等离散检查点上报，且 PROGRESS_THROTTLE_MS 只是 150ms 的
// **上限**节流（没有定时器兜底）——直接绑 store 的值，观感就是「冻结 → 跳变」：时间的
// 步长等于两次评估之间的真实耗时（数秒），进度的步长是 1/totalEvaluations（快速档 1/32
// ≈ 3.1%）。这里加一个页面本地 100ms 时钟，把上报之间的空档补成连续运动：
//   · 时间：从最后一次上报值继续走；上报到达即重锚（取「本地外推 vs 上报值」的较大者，
//     所以既不倒退也不落后）；
//   · 进度：向「上报值 + 一格余量」缓动，单调不减 —— 平滑但最多领先约 1.5 个评估格，
//     不会离真实进度太远。
// 运行结束后一律回落到报告里的真实值（与 liveStats 其它字段同口径）。
const SMOOTH_TICK_MS = 100;
const SMOOTH_EASING = 0.25; // 每 tick 消化剩余差距的比例（≈0.4s 追上目标）
const SMOOTH_LEAD_STEPS = 1.5; // 允许领先的评估格数
const displayProgress = ref(0);
const displayElapsedSeconds = ref(0);
let smoothTimer = null;
let reportedElapsedSeconds = -1; // 用于识别「有新上报」
let elapsedAnchorSeconds = 0; // 最近一次上报的已用时
let elapsedAnchorAt = 0; // 该上报（或本轮起点）的本地时刻

function stopSmoothTicker() {
  if (smoothTimer !== null) {
    clearInterval(smoothTimer);
    smoothTimer = null;
  }
}

function tickSmoothDisplay() {
  const current = runtime.value;
  if (!current.isRunning) {
    stopSmoothTicker();
    return;
  }
  const now = Date.now();
  const reported = Number(current.elapsedSeconds) || 0;
  if (reported !== reportedElapsedSeconds) {
    const extrapolated =
      elapsedAnchorAt > 0 ? elapsedAnchorSeconds + (now - elapsedAnchorAt) / 1000 : elapsedAnchorSeconds;
    elapsedAnchorSeconds = Math.max(extrapolated, reported);
    elapsedAnchorAt = now;
    reportedElapsedSeconds = reported;
  }
  if (elapsedAnchorAt === 0) elapsedAnchorAt = now;
  displayElapsedSeconds.value = Math.max(elapsedAnchorSeconds + (now - elapsedAnchorAt) / 1000, reported);
  const raw = Math.min(1, Math.max(0, Number(current.progress) || 0));
  const total = Number(current.totalEvaluations) || 0;
  const step = total > 0 ? 1 / total : 0.05;
  const target = Math.min(1, raw + step * SMOOTH_LEAD_STEPS);
  displayProgress.value = Math.max(
    displayProgress.value,
    displayProgress.value + (target - displayProgress.value) * SMOOTH_EASING,
  );
}

// 新一轮开始：重置平滑状态（从 0 起步、立刻走表）；结束或卸载即停表。
watch(
  running,
  (isRunning) => {
    stopSmoothTicker();
    reportedElapsedSeconds = -1;
    elapsedAnchorSeconds = 0;
    elapsedAnchorAt = Date.now();
    displayProgress.value = 0;
    displayElapsedSeconds.value = 0;
    if (isRunning) smoothTimer = setInterval(tickSmoothDisplay, SMOOTH_TICK_MS);
  },
  { immediate: true },
);
onUnmounted(stopSmoothTicker);

const progressValue = computed(() => {
  if (!running.value) return hasResults.value ? 1 : 0;
  return displayProgress.value;
});

// 收尾相位回填（2026-09-24，设计 §37.3 观察项① 方案 A）：运行结束后（尤其刷新重进，runtime.phase
// 回到 idle）阶段行若仍读运行态相位会显示「未开始」，而同区计数已回落报告真实值 —— 文案与底层状态
// 不符。非运行且有报告时，相位改由报告收尾状态推导：cancelled → 搜索已停止、error 非空 → 搜索异常
// 中断、其余 → 搜索已完成（复用 phases.done/cancelled/error，i18n 零新增键）；运行中仍如实显示实时相位。
const phaseKey = computed(() => {
  if (running.value || !hasResults.value) return runtime.value.phase || 'idle';
  if (results.value?.cancelled) return 'cancelled';
  if (results.value?.error) return 'error';
  return 'done';
});

// 运行中展示实时统计（搜索层每次评估都会上报）；空闲时回落到上一份报告。
// 已用时用本地时钟平滑（见上），其余字段仍直接反映上报值。
const liveStats = computed(() => {
  if (running.value) {
    return {
      elapsedSeconds: displayElapsedSeconds.value,
      evaluations: runtime.value.evaluations,
      simulations: runtime.value.simulations,
      rounds: runtime.value.round,
      maxConcurrentWorkers: 0,
      workerLimit: results.value?.workerLimit ?? 0,
    };
  }
  return {
    elapsedSeconds: results.value?.elapsedSeconds ?? 0,
    evaluations: results.value?.evaluations ?? 0,
    simulations: results.value?.simulations ?? 0,
    rounds: results.value?.rounds ?? 0,
    maxConcurrentWorkers: results.value?.maxConcurrentWorkers ?? 0,
    workerLimit: results.value?.workerLimit ?? 0,
  };
});

// 实时反馈：「正在优化哪个技能 / 第几轮 / 当前最佳分」，让进度条不再是孤立的百分比。
const runtimeDetail = computed(() => {
  const current = runtime.value;
  if (!current.isRunning) return '';
  const parts = [];
  if (current.abilityHrid)
    parts.push(t('common:triggerOptimizer.currentAbility', '', { name: getAbilityName(current.abilityHrid) }));
  if (current.round > 0) parts.push(t('common:triggerOptimizer.roundLabel', '', { round: current.round }));
  if (current.bestScore != null) {
    parts.push(t('common:triggerOptimizer.bestScoreNow', '', { score: signed(current.bestScore, 4) }));
  }
  return parts.join(' · ');
});

// 预计剩余：直接由「已用时 / 已完成比例」外推（不猜单场耗时，用户看到的是自己的机器上的真实速度）。
// 口径仍是**上报值**（不是平滑展示值）：ETA 只在每次上报时更新，避免显示值与估算基准互相追着跑。
const etaSeconds = computed(() => {
  const current = runtime.value;
  if (!current.isRunning || !(current.progress > 0.02)) return null;
  const remaining = (current.elapsedSeconds / current.progress) * (1 - current.progress);
  return Number.isFinite(remaining) && remaining > 0 ? remaining : null;
});

const deathSafetyPercent = computed(() => Number(settings.value.objectiveWeights.weightDeathSafety || 0) * 100);
const baselineScore = computed(() => {
  const current = improvement.value;
  if (!current || !Number.isFinite(Number(current.score))) return null;
  const delta = Number(current.scoreDelta);
  return Number(current.score) - (Number.isFinite(delta) ? delta : 0);
});
const canApply = computed(() =>
  Boolean(
    hasResults.value &&
    !running.value &&
    !busy.value &&
    !stale.value &&
    // 复验判负 → 不可应用：搜索期的正分只是那组种子的运气（与 store 的拒绝口径同源）。
    !resultRejected.value &&
    improvement.value?.improved === true &&
    !results.value?.appliedInputSignature,
  ),
);
// 撤销入口只看「有没有应用快照」：结果过期（切了地图/难度/时长/手改触发器…）不再关掉它——
// 撤销只覆盖被优化的技能键，是否会踩掉手工改动由 store 的 revert 判定（设计 §19.6）。
const canRevert = computed(() => !running.value && !busy.value && Boolean(simulator.triggerOptimizer.baselineSnapshot));
const hasAlwaysFireCandidate = computed(() =>
  choices.value.some((choice) =>
    (Array.isArray(choice?.candidates) ? choice.candidates : []).some((candidate) => candidate?.state === 'disabled'),
  ),
);
// 组合候选（两条触发器 = 引擎的「与」关系）需要一句澄清，否则用户会读成「或」。
const hasCompositeCandidate = computed(() =>
  choices.value.some((choice) =>
    (Array.isArray(choice?.candidates) ? choice.candidates : []).some(
      (candidate) => Array.isArray(candidate?.triggers) && candidate.triggers.length > 1,
    ),
  ),
);

// ── 每技能卡片：当前配置 vs 模拟最优配置 + 详情弹窗 ──────────────────────────
// 两侧都取自**报告**，不读玩家当前的 triggerMap：应用结果后那份配置已经被改写成最优配置，
// 拿它当「原始配置」会让对比的两边同时变成新配置（这张卡片也就没用了）。
//   原始配置 = 候选表里的「当前配置」锚点（生成器在用户配置非空时必然产出）——
//              没有该锚点即当时是游戏默认触发器（null 表示，[] 表示「立即释放」）。
//   最优配置 = 报告终态 bestTriggerMap 里该技能的键（键不存在 = 删键 = 游戏默认触发器）。
function originalTriggersFor(choice) {
  return resolveOriginalTriggers(choice);
}
function bestTriggersFor(choice) {
  return resolveBestTriggers(results.value?.bestTriggerMap, choice?.abilityHrid, originalTriggersFor(choice));
}
// 该侧的配置是不是「游戏默认触发器」（报告里 null = 删键回落默认）：面板上补一行说明，
// 因为默认列表已经按真实条目展开、不再靠这一句话代替内容。
function isOriginalDefault(choice) {
  return originalTriggersFor(choice) == null;
}
function isBestDefault(choice) {
  return bestTriggersFor(choice) == null;
}
// 卡片里的「改动标记」与「与当前配置相同」都由共享模块统一算（详情弹窗同一套口径）：
// 默认触发器按游戏数据展开成真实条目，对侧没有的那一行才算改动。
function originalLines(choice) {
  return configLines(originalTriggersFor(choice), bestTriggersFor(choice), choice?.abilityHrid);
}
function bestLines(choice) {
  return configLines(bestTriggersFor(choice), originalTriggersFor(choice), choice?.abilityHrid);
}
function configUnchanged(choice) {
  return configsMatch(originalTriggersFor(choice), bestTriggersFor(choice), choice?.abilityHrid);
}
// 「模拟最优配置」的候选标签：只在最优配置确实来自该候选（该槽被采纳）时显示——
// 未采纳的槽里 chosen 只是「槽内最优」，bestTriggerMap 仍是原配置，标上去就是张冠李戴。
function bestLabelFor(choice) {
  if (!choice?.chosen || !slotAdopted(choice.slotIndex)) return '';
  return candidateLabel(choice.chosen);
}
function candidateCount(choice) {
  return Array.isArray(choice?.candidates) ? choice.candidates.length : 0;
}
// 推荐徽章里的得分：与候选表同精度（四位小数），缺值给「—」而不是 0。
function chosenScoreText(choice) {
  const value = Number(choice?.chosen?.score);
  return Number.isFinite(value) ? number(value, 4) : '—';
}

// 详情弹窗按**槽位**记账（不直接存 choice 对象）：新一轮结果替换后对象身份会变，
// 存对象会让弹窗停在旧报告上；按槽位查在报告更新后自动指向新数据，槽位消失则自动关闭。
const detailsSlotIndex = ref(null);
const detailChoice = computed(() => {
  if (detailsSlotIndex.value == null) return null;
  return choices.value.find((choice) => Number(choice?.slotIndex) === Number(detailsSlotIndex.value)) ?? null;
});
const detailsOpen = computed(() => Boolean(detailChoice.value));
function openDetails(choice) {
  detailsSlotIndex.value = Number(choice?.slotIndex ?? -1);
}
function closeDetails() {
  detailsSlotIndex.value = null;
}
const detailOriginalTriggers = computed(() => (detailChoice.value ? originalTriggersFor(detailChoice.value) : null));
const detailBestTriggers = computed(() => (detailChoice.value ? bestTriggersFor(detailChoice.value) : null));
const detailBestLabel = computed(() => (detailChoice.value ? bestLabelFor(detailChoice.value) : ''));
const detailDeepDive = computed(() => (detailChoice.value ? deepDiveForSlot(detailChoice.value.slotIndex) : null));
// 只有**涉及该槽**的联合采纳记录才属于这张卡片的相关数据。
const detailJointAdoptions = computed(() => {
  if (!detailChoice.value) return [];
  const slot = Number(detailChoice.value.slotIndex);
  return jointAdoptions.value.filter((entry) =>
    (Array.isArray(entry?.slots) ? entry.slots : []).some((value) => Number(value) === slot),
  );
});

const changedAbilities = computed(() => {
  const total = choices.value.filter((choice) => choice?.locked !== true).length;
  // 「已优化技能」只在报告**确实声称提升**时才计数：证据不足（evidenceBlocked）或复验判负时，
  // 搜索期的「槽内局部赢家」并没有被采纳（bestTriggerMap 与当前配置一致），报出「3 / 5」会
  // 与同一张卡上的「未找到更优配置 / 证据不足」以及禁用的应用按钮自相矛盾（浏览器实测发现）。
  const claimed = improvement.value?.improved === true && !resultRejected.value;
  // 计数口径 = **真正被采纳的槽位数**（adoptedSlots，与「推荐」徽章、应用写回的
  // bestTriggerMap 同源）。旧口径数「chosen.score > 0」会把**未被采纳**的次阈值候选也算进来：
  // 采纳闸门要求增量分 ≥ MIN_ADOPT_SCORE(0.01) 且配对证据过噪声地板，score 落在 (0, 0.01) 的
  // 槽内最优只是「略好但不够格」，并没有写进 bestTriggerMap。实测（2026-09-19，fly 图）
  // 结论卡报 3 / 5，而 bestTriggerMap 与当前配置只差 1 个键、同屏两张卡片还写着「保持当前配置」。
  return { improved: claimed ? adoptedSlots.value.length : 0, total };
});

const verificationPValue = computed(() => {
  const value = verification.value?.paired?.score?.pValue;
  return Number.isFinite(Number(value)) ? Number(value) : null;
});
const verificationPValueLabel = computed(() =>
  verificationPValue.value == null ? '—' : verificationPValue.value.toFixed(3),
);

// ── 结论适用范围 + 换难度复核（2026-09-23，设计 §29）───────────────────────────
// 触发器写的是**全局技能配置**，而搜索只在报告记录的那一个区域 + 那一个难度上评估过
// （实测区域间噪声差 20 倍，§19.5）。两件事都在这里：把边界写在结论旁边；给一个
// 「换个难度再测一次」的入口（只读：跑两个配置的配对评估，不改玩家配置）。
const evaluationScope = computed(() => {
  const scope = results.value?.evaluationScope;
  if (!scope || typeof scope !== 'object' || !scope.zoneHrid) return null;
  return scope;
});
// 适用范围文案：区域名 + 难度 + 时长。三者都属于「这份结论在什么条件下成立」。
const scopeText = computed(() => {
  const scope = evaluationScope.value;
  if (!scope) return '';
  return t('common:triggerOptimizer.scopeText', '', {
    zone: getActionName(scope.zoneHrid),
    tier: Number(scope.difficultyTier) || 0,
    hours: number(Number(scope.simulationHours) || 0, 0),
  });
});
// 模拟载荷（2026-09-27，设计 §59）：报告在单人还是整队（哪些队友）载荷上得出的 —— 与 scopeText
// 同一块边界标注。队友名优先按当前玩家表解析（改名后显示现名），解析不到时回落报告里的快照名 / id。
const scopePartyEntries = computed(() => {
  const party = evaluationScope.value?.party;
  if (!Array.isArray(party) || party.length === 0) return [];
  return party
    .map((entry) => {
      const id = String(entry?.id ?? '');
      const player = (simulator.players || []).find((item) => String(item.id ?? '') === id);
      return { id, name: String(player?.name || entry?.name || id) };
    })
    .filter((entry) => entry.id !== '');
});
const scopePartyText = computed(() => {
  if (scopePartyEntries.value.length === 0) return t('common:triggerOptimizer.partyScopeSingle');
  return t('common:triggerOptimizer.partyScopeText', '', {
    party: scopePartyEntries.value.map((entry) => entry.name).join(' / '),
  });
});
// 队伍载荷的保守提示（2026-09-27，设计 §60 / C1-①）：C1 实测队伍载荷下判据链真检出率偏低（本机基准
// 93.2% → 64.6%，同一批种子与切分）⇒ 有队友时搜索可能欠采。只做提示，不改任何判据 / 数值。
const scopePartyDetectionNote = computed(() => t('common:triggerOptimizer.partyDetectionNote'));
const robustness = computed(() => runtime.value.robustness ?? {});
const robustnessRunning = computed(() => Boolean(robustness.value.isRunning));
// 复核结果（报告里的那一份）：取消运行不写结果，因此这里不必再判 cancelled。
const robustnessSummary = computed(() => results.value?.robustness ?? null);
// 目标难度 = 报告适用范围的相邻难度（优先 +1，已在最高难度则退回 −1，见 simulationDomain）。
const robustnessTargetTier = computed(() => {
  const scope = evaluationScope.value;
  if (!scope) return null;
  return resolveAdjacentDifficultyTier(scope.zoneHrid, scope.difficultyTier);
});
// 不能复核的两种原因（都是「这份报告缺什么」而不是「按钮坏了」）：没有相邻难度、
// 或报告来自本功能之前的版本（未记录搜索起点配置）。有原因时按钮禁用 + 提示改用它。
const robustnessBlockReason = computed(() => {
  if (!evaluationScope.value) return '';
  if (robustnessTargetTier.value == null) return 'common:triggerOptimizer.robustnessUnavailable';
  const baseline = results.value?.baselineTriggerMap;
  if (!baseline || typeof baseline !== 'object') return 'common:triggerOptimizer.robustnessMissingBaseline';
  return '';
});
const canRunRobustness = computed(
  () => !running.value && !busy.value && !robustnessRunning.value && !robustnessBlockReason.value,
);
const robustnessButtonLabel = computed(() =>
  robustnessTargetTier.value == null
    ? t('common:triggerOptimizer.robustnessRun')
    : t('common:triggerOptimizer.robustnessRunTier', '', { tier: robustnessTargetTier.value }),
);
// 复核轮数自适应的**上屏口径**（2026-09-25，设计 §49）：实测胜出的 A′ 口径把「复核要花多少样本」
// 从常量变成了反解值（保底 6 轮 / 上限 16 轮 / 多花的部分受整轮场次 20% 的成本护栏约束），所以
// 入口旁必须说清这一次要跑多少轮、上限或护栏有没有咬住。这里与 store 真正执行时用的是**同一个**
// 纯函数、同一份输入（报告的复验统计 + 报告里的整轮场次），「文案说的轮数」与「实际跑的轮数」
// 因此不会分裂。反解不出来（旧报告 / 统计退化）时计划为 null：文案与行为都回落到固定 6 轮。
const robustnessPlan = computed(() => {
  if (robustnessBlockReason.value) return null;
  return planTriggerOptimizerRobustnessRounds(verification.value?.paired?.score, {
    maxRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
    wholeRunSimulations: Number(results.value?.simulations) || 0,
  });
});
const robustnessPlannedRounds = computed(
  () => Number(robustnessPlan.value?.plannedRounds) || TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
);
// 计划明细句（三态：按需反解 / 已达上限 / 成本护栏）：上屏两处（运行前的说明、结果块里的事后
// 留档）与导出共用同一句；措辞用中性时态，三处都读得通。
function robustnessPlanSentence(plan) {
  if (!plan) return '';
  const params = {
    rounds: Number(plan.plannedRounds) || 0,
    simulations: Number(plan.plannedSimulations) || 0,
    base: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
    cap: Number(plan.capRounds) || 0,
    percent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO * 100),
  };
  if (plan.budgetLimited === true) return t('common:triggerOptimizer.robustnessPlanBudget', '', params);
  if (plan.capped === true) return t('common:triggerOptimizer.robustnessPlanCapped', '', params);
  return t('common:triggerOptimizer.robustnessPlanRounds', '', params);
}
const robustnessPlanText = computed(() => robustnessPlanSentence(robustnessPlan.value));
const robustnessNote = computed(() => {
  if (robustnessBlockReason.value) return t(robustnessBlockReason.value);
  return t('common:triggerOptimizer.robustnessHint', '', {
    rounds: robustnessPlannedRounds.value,
    simulations: robustnessPlannedRounds.value * 2,
  });
});

// ── 复核追加的**上屏口径**（2026-09-26，设计 §51）──────────────────────────────
// 已复核过这个难度之后再点复核 = 换盐追加（新样本与首跑合并重检），不再同盐复跑（§51 实测：
// 同盐复跑逐值相同、信息增量 0）。这里与 store 真正执行时用的是**同一个**纯函数、同一份输入
// （首跑复核的合并统计 + 报告里的整轮场次 + attempts 累计已花），「文案说的轮数」与「实际追加的
// 轮数」不会分裂。三种「一轮都追加不了」的出口（零差 / 已达上限 / 预算用尽）与 store 的早退
// 分键顺序一致：不挂按钮，只挂原因句。
const robustnessAppendPlan = computed(() => {
  if (!robustnessSummary.value) return null;
  return planTriggerOptimizerRobustnessAppend(robustnessSummary.value?.paired?.score, {
    maxRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
    wholeRunSimulations: Number(results.value?.simulations) || 0,
    spentSimulations: resolveTriggerOptimizerAppendSpentSimulations(robustnessSummary.value?.attempts),
  });
});
const robustnessAppendAvailable = computed(() => Number(robustnessAppendPlan.value?.plannedRounds) >= 1);
// 追加运行中的判定：复核运行态是共享槽（首跑 / 追加同一套取消链），用「报告里已有复核结论」
// 区分两态 —— 首跑期间结论为空，追加期间结论仍在（旧结论保留到合并成功）。
const robustnessAppendRunning = computed(() => robustnessRunning.value && Boolean(robustnessSummary.value));
// 合并留档：只要追加过就显示「已复核 N 次 · 合并 M 轮 · 累计追加 X 场」（与导出汇总行同一份文案）。
const robustnessAppendMergedText = computed(() => {
  const attempts = Array.isArray(robustnessSummary.value?.attempts) ? robustnessSummary.value.attempts : [];
  if (attempts.length === 0) return '';
  return t('common:triggerOptimizer.robustnessAppendMerged', '', {
    attempts: attempts.length,
    rounds: Number(robustnessSummary.value?.rounds) || 0,
    spent: resolveTriggerOptimizerAppendSpentSimulations(attempts),
  });
});
const robustnessAppendHintText = computed(() => {
  const plan = robustnessAppendPlan.value;
  if (!plan || !robustnessAppendAvailable.value) return '';
  const sentence = t('common:triggerOptimizer.robustnessAppendHint', '', {
    rounds: Number(plan.plannedRounds) || 0,
    simulations: Number(plan.plannedSimulations) || 0,
    currentRounds: Number(plan.currentRounds) || 0,
    cap: Number(plan.capRounds) || 0,
  });
  // 累计预算进度（2026-09-26，设计 §53）：与复验追加的 verifyAppendCumulative 同款子句 ——
  // 点完这一下之后累计花到哪，两条追加路径在决策点是同一口径。没有整轮场次（旧报告）不显示。
  const budget = Number(plan.cumulativeBudgetSimulations);
  const cumulative =
    Number.isFinite(budget) && budget > 0
      ? t('common:triggerOptimizer.robustnessAppendCumulative', '', {
          spent: (Number(plan.spentSimulations) || 0) + plan.plannedSimulations,
          budget,
        })
      : '';
  return cumulative ? `${sentence}｜${cumulative}` : sentence;
});
const robustnessAppendBlockedText = computed(() => {
  const plan = robustnessAppendPlan.value;
  if (!plan || robustnessAppendAvailable.value) return '';
  const params = {
    cap: Number(plan.capRounds) || 0,
    percent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO * 100),
    singlePercent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO * 100),
  };
  if (plan.zeroDiff === true) return t('common:triggerOptimizer.robustnessAppendZeroDiff', '', params);
  if (plan.atCap === true) return t('common:triggerOptimizer.robustnessAppendAtCap', '', params);
  if (plan.budgetLimited === true) return t('common:triggerOptimizer.robustnessAppendBudgetExhausted', '', params);
  return t('common:triggerOptimizer.robustnessAppendExhausted', '', params);
});
// 停止按钮的文案按态切换：追加跑的是同一套取消链，说清「停的是哪件事」。
const robustnessStopLabel = computed(() =>
  robustnessAppendRunning.value
    ? t('common:triggerOptimizer.robustnessAppendStop')
    : t('common:triggerOptimizer.robustnessStop'),
);
// 运行中那句「N 轮/侧」按态取：首跑用首跑计划、追加用追加计划（追加期间结论还没被合并覆盖，
// 计划函数按当前统计算出本次要补的轮数）。
const robustnessActiveRounds = computed(() =>
  robustnessAppendRunning.value
    ? Number(robustnessAppendPlan.value?.plannedRounds) || TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS
    : robustnessPlannedRounds.value,
);
const robustnessProgressText = computed(() =>
  t('common:triggerOptimizer.robustnessRunning', '', {
    tier: Number(robustness.value.difficultyTier ?? robustnessTargetTier.value ?? 0),
    rounds: robustnessActiveRounds.value,
    simulations: robustnessActiveRounds.value * 2,
    seconds: number(Number(robustness.value.elapsedSeconds) || 0, 1),
  }),
);
// 结果块里的事后留档：复核**实际执行**的计划（results.robustness.plan，服务层净化后写入）。
// 旧报告 / 净化失败（缺项、不自洽）时没有 plan —— 不显示这一行，只说结论。
const robustnessPlanDetail = computed(() => robustnessPlanSentence(robustnessSummary.value?.plan));
const robustnessVerdictLabel = computed(() =>
  t(`common:triggerOptimizer.robustnessVerdicts.${robustnessSummary.value?.verdict || 'unknown'}`),
);
// 配色与详情弹窗同源：方向看符号（得分/利润越高越好），结论走配对信号配色
// （positive 绿 / negative 红 / 其余中性——不把「没测出来」渲染成好或坏）。
const robustnessVerdictClass = computed(() => triggerVerdictTextClass(robustnessSummary.value?.verdict));
const robustnessScoreClass = computed(() => {
  const delta = Number(robustnessSummary.value?.scoreDelta);
  if (!Number.isFinite(delta) || delta === 0) return 'text-muted-foreground';
  return delta > 0 ? 'text-success' : 'text-destructive';
});
const robustnessProfitClass = computed(() =>
  deltaClass('dailyNoRngProfit', Number(robustnessSummary.value?.profitDelta) || 0),
);
const robustnessPValueLabel = computed(() => {
  const value = robustnessSummary.value?.paired?.score?.pValue;
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—';
});
// 复核的运行期错误（键或原始消息，与 runtime.error 同款口径：t() 找不到键时原样返回）。
const robustnessErrorText = computed(() => {
  const message = String(robustness.value.error || '');
  return message ? t(message, '') : '';
});

// 「推荐」徽章旁的证据解释（2026-09-19，设计 §19.4/§19.6）：搜索期 verdict 是
// inconclusive/unknown 时，采纳依据是**噪声地板**（|mean| > 2×SE），不是显著性声明——
// 与同屏的「不显著」徽章并列时必须说清楚，否则会被读成「没证据也硬采纳」。
function adoptionEvidenceHint(choice) {
  const summary = choice?.chosen?.paired?.score ?? null;
  if (!summary) return '';
  const format = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '—');
  const stdError = Number(summary.stdError);
  return t('common:triggerOptimizer.adoptionEvidenceHint', '', {
    mean: format(summary.mean),
    se: format(summary.stdError),
    threshold: Number.isFinite(stdError) ? (stdError * 2).toFixed(4) : '—',
    p: verificationPValueLabel.value,
  });
}

// 「轮数上限截断」提示（2026-09-19，设计 §19.8）：报告声称提升、且搜索因跑满轮数上限而结束
// （不是固定点收敛）→ 还有改进空间，给用户一个明确的下一步（精细档 / 提高搜索轮数上限）。
const roundLimitReached = computed(
  () => improvement.value?.improved === true && results.value?.roundLimitReached === true,
);

// 「本次可确认的最小提升」（2026-09-20，设计 §20.2）：把两把尺子按**本次运行实测的噪声**上屏——
// 噪声地板（2×SE，采纳口径：「比噪声大」）与显著门槛（t(n−1)×SE，判定口径：p<0.05）。
// 搜索期 verdict 恒 inconclusive（低轮数下 t 临界值巨大）时，这一行才是「为什么没采纳、
// 多大的提升才算数」的答案——把「感觉搜不出提升」换成一个可以对着看的数字。
const detectionFloor = computed(() => {
  const weights = settings.value.objectiveWeights;
  // 轮数取**抽样重复次数**（settings.rounds），不是 results.rounds（那是 coordinate descent
  // 跑到固定点用了几轮 pass，与 t 检验的自由度无关）。2026-09-20 实测抓到：取错字段会让
  // 文案印成「2 轮 × 24 小时」（搜索轮数），把 t(自由度) 与上屏口径一起带偏。
  const rounds = Number(settings.value.rounds) || 0;
  // 首选推荐配置自己的配对统计（与采纳判据同源）；没有就退到全部候选 SE 的中位数
  // （「证据不足」时 best 往往等于基线，其 paired 为空；锚点候选的 SE 恒为 0，也走这里）。
  const direct = resolveTriggerOptimizerDetectionFloor(improvement.value?.paired, weights, { rounds });
  if (direct) return direct;
  const errors = [];
  for (const choice of choices.value) {
    const value = Number(choice?.chosen?.paired?.score?.stdError);
    if (Number.isFinite(value) && value > 0) errors.push(value);
  }
  if (errors.length === 0) return null;
  errors.sort((left, right) => left - right);
  const median = errors[Math.floor(errors.length / 2)];
  return resolveTriggerOptimizerDetectionFloor({ score: { stdError: median, rounds } }, weights, { rounds });
});
// 下限文案里的「±」由文案自己带：这里只给幅值，否则会渲成「±+0.01」这样的双符号。
const floorMagnitude = (value, digits = 4) => number(Math.abs(Number(value) || 0), digits);
const detectionFloorNote = computed(() => {
  const floor = detectionFloor.value;
  if (!floor) return '';
  return t('common:triggerOptimizer.detectionFloor', '', {
    rounds: floor.rounds,
    hours: Number(settings.value.simulationHours) || 0,
    noiseFloor: floorMagnitude(floor.noiseFloor),
    significanceFloor: floorMagnitude(floor.significanceFloor),
    profitPercent: floor.profitPercent == null ? '—' : number(floor.profitPercent, 2),
  });
});
// 「还差多少轮」的两把尺子（2026-09-26，设计 §52）：
//   ① 采纳口径（本块主体，§45 反解）：噪声地板 2×SE —— 回答「再跑多少轮才可能被采纳」；
//   ② 判定口径（significance 子句，§47/§49 同一把 t×SE 尺子）：回答「判成 p<0.05 明确结论还要多少轮」。
// 两把尺子在全部可达轮数内不可能给出同一个答案（t(n−1) > 2，见 scoring 注释）——所以建议句必须
// 各自指名口径，不能让「确认下来」这种无口径动词把采纳口径读成显著性承诺。
// 三个分支缺一不可（文案必须与实际一致）：已够（当前下限 ≤ 门槛）/ 提到 N 轮即可 / 拉满也不够
// （此时诚实说「这个量级确认不了」，并指出加时长比加轮数更划算）。
const detectionFloorAdvice = computed(() => {
  const floor = detectionFloor.value;
  if (!floor) return '';
  const plan = resolveTriggerOptimizerRoundsForEffect(
    floor,
    TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE,
    TRIGGER_OPTIMIZER_MAX_ROUNDS,
  );
  if (!plan) return '';
  const significance = resolveTriggerOptimizerRoundsForSignificance(
    floor,
    TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE,
    TRIGGER_OPTIMIZER_MAX_ROUNDS,
  );
  let significanceText = '';
  if (significance) {
    if (significance.satisfied) {
      significanceText = t('common:triggerOptimizer.detectionFloorAdviceSignificanceAtCurrent', '', {
        rounds: significance.rounds,
      });
    } else if (significance.capped) {
      significanceText = t('common:triggerOptimizer.detectionFloorAdviceSignificanceCapped', '', {
        cap: TRIGGER_OPTIMIZER_MAX_ROUNDS,
      });
    } else {
      significanceText = t('common:triggerOptimizer.detectionFloorAdviceSignificanceRounds', '', {
        rounds: significance.rounds,
      });
    }
  }
  const params = {
    target: number(plan.effect, 2),
    targetProfit: plan.effectProfitPercent == null ? '—' : number(plan.effectProfitPercent, 2),
    rounds: plan.rounds,
    noiseFloor: floorMagnitude(plan.noiseFloor),
    significanceFloor: floorMagnitude(plan.significanceFloor),
    profitPercent: plan.profitPercent == null ? '—' : number(plan.profitPercent, 2),
    hours: Number(settings.value.simulationHours) || 0,
    significance: significanceText,
  };
  if (plan.satisfied) return t('common:triggerOptimizer.detectionFloorAdviceSatisfied', '', params);
  if (plan.capped) return t('common:triggerOptimizer.detectionFloorAdviceCapped', '', params);
  return t('common:triggerOptimizer.detectionFloorAdviceRounds', '', params);
});

// ── 结果展示层：结论卡 → 得分卡 → 指标对照 → 候选细节 ─────────────────────
// verdictKind 汇总「报告是否声称提升 / 复验是否支持」：improved=false 一票否决——
// 即使报告里带着 positive 复验也不渲染成「提升成立」（合成数据自相矛盾时的诚实降级）。
// evidenceBlocked（2026-09-18）：搜索期确实有候选分数更高，但配对证据不足 → 未采纳。
// 它与 noImprovement 是两件事（前者是「样本不够没敢采纳」，建议加重复次数/换精细档），
// 文案必须分开，否则用户会以为已经搜遍了。
const verdictKind = computed(() => {
  const current = improvement.value;
  if (!current) return verification.value ? verification.value.verdict || 'unknown' : 'missing';
  if (!current.improved) {
    return results.value?.evidenceBlocked === true ? 'evidenceBlocked' : 'noImprovement';
  }
  if (resultRejected.value) return 'negative';
  if (!verification.value) return 'missing';
  return verification.value.verdict || 'unknown';
});
const verdictHeadline = computed(() => t(`common:triggerOptimizer.verdictHeadlines.${verdictKind.value}`));
const verdictIcon = computed(() => {
  const kind = verdictKind.value;
  if (kind === 'positive') return TrendingUp;
  if (kind === 'negative') return TrendingDown;
  if (kind === 'noImprovement') return Minus;
  return AlertTriangle;
});
const verdictCardClass = computed(() => {
  const kind = verdictKind.value;
  if (kind === 'positive') return 'border-success/40 bg-success/10';
  if (kind === 'negative') return 'border-destructive/40 bg-destructive/10';
  if (kind === 'inconclusive' || kind === 'unknown') return 'border-warning/40 bg-warning/10';
  return 'border-border bg-muted/30';
});
const verdictTextClass = computed(() => {
  const kind = verdictKind.value;
  if (kind === 'positive') return 'text-success';
  if (kind === 'negative') return 'text-destructive';
  if (kind === 'inconclusive' || kind === 'unknown') return 'text-warning';
  return 'text-muted-foreground';
});
// 复验口径说明（结果说明弹窗的第 1 条）：这段文字原本平铺在结论卡正文里，2026-09-22 收进弹窗。
// 分支口径与旧模板逐字一致：noImprovement 与 evidenceBlocked 是**两件事**（前者「搜遍了」、
// 后者「样本不够没敢采纳」，出路也不同），必须分开说；复验缺失时声明结论只来自搜索期；
// 其余情况解释复验本身怎么做（换一组种子重跑 6 轮配对）。
const verificationNoteText = computed(() => {
  const kind = verdictKind.value;
  if (kind === 'noImprovement') return t('common:triggerOptimizer.noImprovement');
  if (kind === 'evidenceBlocked') return t('common:triggerOptimizer.evidenceBlocked');
  if (kind === 'missing') return t('common:triggerOptimizer.verificationMissing');
  return t('common:triggerOptimizer.verificationHint');
});

// 复验三态的诚实标注（2026-09-24，设计 §31）：复验判「未达显著」且搜索期确有提升时，结论不能
// 默默放行 —— 页面明说「提升尚未被独立样本确认」，并给出「追加复验」入口。产品口径不变：
// 只有复验判 negative 才否决应用（resultRejected 与 store 同源），这里只是不许把「没测出来」
// 装成「测出来了」。已判正/判负时不显示：那两种结论都已经被独立样本定了性。
const showVerifyAppend = computed(
  () => verification.value?.verdict === 'inconclusive' && improvement.value?.improved === true,
);
const verifyAppendRunning = computed(() => simulator.triggerOptimizer.runtime.verifyAppend?.isRunning === true);
// 合并留档：只要追加过就显示「已复验 N 次 · 合并 M 轮」。与警示行分开判定 —— 追加后结论转正时
// 警示行消失，这一行仍然在（读者要能看出结论是几轮样本合并出来的）。
const verifyAppendMergedText = computed(() => {
  const attempts = Array.isArray(verification.value?.attempts) ? verification.value.attempts : [];
  if (attempts.length === 0) return '';
  const rounds = Number(verification.value?.rounds) || 0;
  // 累计追加场次（§50 B-2）：与成本护栏同一口径（Σ 2 × rounds），读者能看出结论是花多少样本追
  // 出来的 —— 导出的汇总行用同一份文案。
  return t('common:triggerOptimizer.verifyAppendMerged', '', {
    attempts: attempts.length,
    rounds,
    spent: resolveTriggerOptimizerAppendSpentSimulations(attempts),
  });
});

// 追加轮数自适应的**上屏口径**（2026-09-25，设计 §47；累计护栏 2026-09-26，设计 §50 B-2）：
// 实测胜出的 A′ 口径把「会追加多少轮」从常量变成了反解值（保底 12 轮 / 上限 24 轮 / 成本护栏
// 单次 ≤ 整轮 20%、累计 ≤ 整轮 40%），所以入口旁必须说清这一次要花多少样本、护栏或上限有没有
// 咬住。这里与 store 真正执行时用的是**同一个**纯函数、同一份输入（报告的复验统计 + 报告里的
// 整轮场次 + attempts 累计已花），「文案说的轮数」与「实际追加的轮数」因此不会分裂。反解不出来
//（旧报告）时不显示这一行，行为与今天一致（服务层缺省 6 轮）。
//（§53：同一次调用拆成两段——不设门槛的 verifyAppendBudgetPlan 供「证据预算」视图使用：
//  verdict 转正、入口消失之后，「已花 / 预算」仍要照实可查；带门槛的 verifyAppendPlan 保持
//  按钮与计划行的原判据。）
const verifyAppendBudgetPlan = computed(() =>
  planTriggerOptimizerVerificationAppend(verification.value?.paired?.score, {
    maxRounds: TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
    wholeRunSimulations: Number(results.value?.simulations) || 0,
    spentSimulations: resolveTriggerOptimizerAppendSpentSimulations(verification.value?.attempts),
  }),
);
const verifyAppendPlan = computed(() => (showVerifyAppend.value ? verifyAppendBudgetPlan.value : null));
// 上限或护栏咬到「一轮都追加不了」时不再挂入口（点下去只会白等一次拒绝），文案说清原因 ——
// 否则按钮凭空消失会被读成功能坏了。
const verifyAppendAvailable = computed(() => Number(verifyAppendPlan.value?.plannedRounds) >= 1);
const verifyAppendPlanText = computed(() => {
  const plan = verifyAppendPlan.value;
  if (!plan || plan.decisive) return '';
  const params = {
    rounds: plan.plannedRounds,
    simulations: plan.plannedSimulations,
    cap: plan.capRounds,
    percent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO * 100),
    singlePercent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO * 100),
  };
  if (plan.plannedRounds < 1) {
    return plan.budgetLimited
      ? t('common:triggerOptimizer.verifyAppendBudgetExhausted', '', params)
      : t('common:triggerOptimizer.verifyAppendExhausted', '', params);
  }
  // 累计预算进度（§50 B-2）：有整轮场次时，把「点完这一下之后累计花到哪」一并说清 —— 用户据此
  // 知道还能再点几次，而不是点到「预算用尽」才知道。没有整轮场次（旧报告）不显示。
  const budget = Number(plan.cumulativeBudgetSimulations);
  const cumulative =
    Number.isFinite(budget) && budget > 0
      ? t('common:triggerOptimizer.verifyAppendCumulative', '', {
          spent: (Number(plan.spentSimulations) || 0) + plan.plannedSimulations,
          budget,
        })
      : '';
  const sentence = plan.budgetLimited
    ? t('common:triggerOptimizer.verifyAppendPlanBudget', '', params)
    : plan.capped
      ? t('common:triggerOptimizer.verifyAppendPlanCapped', '', params)
      : t('common:triggerOptimizer.verifyAppendPlanRounds', '', params);
  return cumulative ? `${sentence}｜${cumulative}` : sentence;
});
// 追加复验的失败原因（缺样本 / 忙 / 结论已明确 / 上限已尽…）：store 一直把 i18n 键写进
// verifyAppend.error，但页面上此前没有任何渲染点（§31 遗留）—— 2026-09-25 补上，与上面
// 三种「不追加」分支共用同一块 UI。t() 找不到键时原样显示，便于定位。
const verifyAppendErrorText = computed(() => {
  const message = String(simulator.triggerOptimizer.runtime.verifyAppend?.error || '');
  return message ? t(message, '') : '';
});

// 综合得分卡：分数变化大字 + 「−1..+1」发散条（0 居中刻度，钳到 [-1,1]）。
const scoreDeltaClass = computed(() => {
  const delta = Number(improvement.value?.scoreDelta);
  if (!Number.isFinite(delta) || delta === 0) return 'text-muted-foreground';
  return delta > 0 ? 'text-success' : 'text-destructive';
});
function scoreBarGeometry(raw) {
  if (!Number.isFinite(Number(raw))) return { left: '50%', width: '0%' };
  const clamped = Math.max(-1, Math.min(1, Number(raw)));
  const half = Math.abs(clamped) * 50;
  return clamped >= 0 ? { left: '50%', width: `${half}%` } : { left: `${50 - half}%`, width: `${half}%` };
}
const scoreBarStyle = computed(() => scoreBarGeometry(improvement.value?.score));
const scoreBarFillClass = computed(() => {
  const raw = Number(improvement.value?.score);
  if (!Number.isFinite(raw) || raw === 0) return 'bg-muted-foreground';
  return raw > 0 ? 'bg-success' : 'bg-destructive';
});

// 指标对照卡：每项一组「基线 vs 最优」同尺度双条形 + 带单位的差值（死亡单列一张卡）。
// 口径来源（2026-09-19 调整，设计 §19.6）：
//   复验可用 → **一律用复验实测**（换种子 6 轮）。① 判负时：搜索期的 +0.1% 已被证伪，
//              继续拿它当「提升」展示会与结论卡自相矛盾（2026-09-18）；② 成立/未达显著时：
//              结论卡那个 p 值就是这 6 轮算出来的，指标卡必须同源，用户才能把「提升多少」
//              与「p 值多大」读成同一批证据（旧行为只标「搜索期估算」）。
//   复验缺失 → 回落到搜索期同种子配对估算（取消/失败的报告）。
// 差值一律由「所选来源的 best − baseline」现算，不再读 improvement.deltas：两个来源
// 一套算法，避免出现「卡片数字来自搜索期、结论来自复验」的口径混用。
const METRIC_CARD_KEYS = [...METRIC_KEYS, 'deathsPerHour'];
// 指标卡的数据来源与标签必须共用一个谓词：**复验确实带回了指标**时用复验实测，否则用搜索期
// 估算。分开判会出现「标签说复验、数字来自搜索期」。
const useVerificationMetrics = computed(
  () => Boolean(verification.value?.baselineMetrics) && Boolean(verification.value?.bestMetrics),
);
const metricSourceKey = computed(() =>
  useVerificationMetrics.value
    ? 'common:triggerOptimizer.metricSourceVerification'
    : 'common:triggerOptimizer.metricSourceSearch',
);
const metricCards = computed(() => {
  const current = improvement.value;
  if (!current) return [];
  const useVerification = useVerificationMetrics.value;
  const baseline = (useVerification ? verification.value.baselineMetrics : results.value?.baselineMetrics) || {};
  const best = (useVerification ? verification.value.bestMetrics : current.metrics) || {};
  const cards = [];
  for (const key of METRIC_CARD_KEYS) {
    const baselineValue = Number(baseline[key] ?? 0);
    const bestValue = Number(best[key] ?? 0);
    const delta = bestValue - baselineValue;
    // 死亡没有预计算的 percent 口径：基线为 0 时百分比无意义，给 null（模板不渲染括号）。
    const deltaPercent =
      baselineValue !== 0 && Number.isFinite(bestValue) ? (delta / Math.abs(baselineValue)) * 100 : null;
    const scale = Math.max(baselineValue, bestValue, 0);
    cards.push({
      key,
      baselineValue,
      bestValue,
      delta,
      deltaPercent,
      baselineWidth: scale > 0 ? (Math.max(baselineValue, 0) / scale) * 100 : 0,
      bestWidth: scale > 0 ? (Math.max(bestValue, 0) / scale) * 100 : 0,
    });
  }
  return cards;
});

// ── 结果说明弹窗（2026-09-22）─────────────────────────────────────────────
// 结论卡 / 得分卡 / 指标卡下面原本平铺着 5–8 段解释性长文（复验口径、得分尺度、指标口径、
// 深挖复核、跨槽联合采纳、轮数上限、噪声地板与显著门槛、应用范围）：一屏四五段，用户一般不会读，
// 还把结论与数字挤出了视野。现在整条搬进「查看说明」弹窗——页面只留结论、数字与逐技能卡片。
// 条目按**本次报告是否适用**组装（没有深挖 / 没有联合采纳 / 算不出下限就不出现那一条），
// 弹窗组件只负责渲染，口径判断全部留在这里（它拿得到 verdictKind / settings）。
const notesOpen = ref(false);
function openNotes() {
  notesOpen.value = true;
}
function closeNotes() {
  notesOpen.value = false;
}

// ── 证据预算（2026-09-26，设计 §53）────────────────────────────────────────
// 两条追加路径（复验追加 / 复核追加）各有**独立**的预算池：整轮场次 × 累计 40%，单次追加另有
// 20% 上限（§50 / §51 的同一对常量）；已花 = Σ(2 × attempts[].rounds)，只算追加、不含首跑。
// 这里把「已花 / 预算 / 剩余 / 停在哪个出口」收敛到同一处：说明弹窗与导出逐字同文 —— 数字全部
// 来自与执行同一纯函数、同一份输入的计划字段（spentSimulations / cumulativeBudgetSimulations /
// plannedRounds / 出口标记），页面不另行重算；两条路径分行并列，不合并成总和（池子彼此独立，
// 已花不跨路径相加）。可见性：至少一条路径「有实花」或「已停在出口」才出现（没花过也没停住 ⇒
// 不留空条目）；缺整轮场次的旧报告只说「已花」，不编预算与剩余。
function appendEvidenceBudgetLine(labelKey, plan, attempts) {
  const spent = resolveTriggerOptimizerAppendSpentSimulations(attempts);
  const planned = Number(plan?.plannedRounds) || 0;
  let reason = '';
  if (plan) {
    if (plan.zeroDiff === true) {
      reason = t('common:triggerOptimizer.evidenceBudgetStopZeroDiff');
    } else if (plan.atCap === true) {
      reason = t('common:triggerOptimizer.evidenceBudgetStopCap', '', { cap: Number(plan.capRounds) || 0 });
    } else if (planned < 1 && plan.budgetLimited === true) {
      reason = t('common:triggerOptimizer.evidenceBudgetStopBudget', '', {
        singlePercent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO * 100),
        percent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO * 100),
      });
    } else if (planned < 1 && plan.decisive !== true) {
      reason = t('common:triggerOptimizer.evidenceBudgetStopCap', '', { cap: Number(plan.capRounds) || 0 });
    }
  }
  if (attempts.length === 0 && !reason) return '';
  const rawBudget = plan?.cumulativeBudgetSimulations;
  const hasBudget = plan != null && rawBudget != null;
  const label = t(labelKey, '');
  const base = hasBudget
    ? t('common:triggerOptimizer.evidenceBudgetLine', '', {
        label,
        spent,
        budget: Number(rawBudget),
        remaining: Math.max(0, Number(rawBudget) - spent),
      })
    : t('common:triggerOptimizer.evidenceBudgetNoBudget', '', { label, spent });
  return reason ? `${base}，${reason}` : base;
}
const evidenceBudgetNote = computed(() => {
  const verifyAttempts = Array.isArray(verification.value?.attempts) ? verification.value.attempts : [];
  const robustnessAttempts = Array.isArray(robustnessSummary.value?.attempts) ? robustnessSummary.value.attempts : [];
  return [
    appendEvidenceBudgetLine(
      'common:triggerOptimizer.evidenceBudgetVerify',
      verifyAppendBudgetPlan.value,
      verifyAttempts,
    ),
    appendEvidenceBudgetLine(
      'common:triggerOptimizer.evidenceBudgetRobustness',
      robustnessAppendPlan.value,
      robustnessAttempts,
    ),
  ]
    .filter(Boolean)
    .join('｜');
});

const resultNotes = computed(() => {
  // 顺序＝一段连贯的说明：结论怎么来的 → 本次能测出多大 → 是否还有空间 → 还能花多少证据 →
  // 分数怎么读 → 指标数字怎么来的 → 卡片上的两处复核记录 → 应用范围。
  const notes = [
    {
      key: 'verification',
      labelKey: 'common:triggerOptimizer.verificationTitle',
      text: verificationNoteText.value,
    },
  ];
  // 噪声地板与显著门槛（设计 §20.2；两把尺子的口径分离见 §52）：缺标准误就没有——整条不出现；
  // 建议行（§45 采纳口径反解 + §52 判定口径反解）单独可能为空，那时只展示两组门槛本身。
  if (detectionFloorNote.value) {
    notes.push({
      key: 'detectionFloor',
      labelKey: 'common:triggerOptimizer.noteDetectionFloor',
      text: detectionFloorNote.value,
      extra: detectionFloorAdvice.value,
    });
  }
  if (roundLimitReached.value) {
    notes.push({
      key: 'roundLimit',
      labelKey: 'common:triggerOptimizer.noteRoundLimit',
      text: t('common:triggerOptimizer.roundLimitReached'),
    });
  }
  // 证据预算（2026-09-26，设计 §53）：两条追加路径的「已花 / 预算 / 剩余 / 停在哪」收敛成同一处
  // （导出同文）；没花过也没停住时整条不出现。
  if (evidenceBudgetNote.value) {
    notes.push({
      key: 'evidenceBudget',
      labelKey: 'common:triggerOptimizer.noteEvidenceBudget',
      text: evidenceBudgetNote.value,
    });
  }
  notes.push({
    key: 'scoreScale',
    labelKey: 'common:triggerOptimizer.noteScoreScale',
    text: t('common:triggerOptimizer.scoreScaleHint'),
  });
  // 指标口径在指标卡上方还有一行就地短标签（数字的来源必须紧贴数字）；这里复述一遍，
  // 让弹窗自成一份完整口径——用户不必在页面与弹窗之间来回找。
  notes.push({
    key: 'metricSource',
    labelKey: 'common:triggerOptimizer.noteMetricSource',
    text: t(metricSourceKey.value),
  });
  if (deepDiveSummary.value) {
    notes.push({
      key: 'deepDive',
      labelKey: 'common:triggerOptimizer.noteDeepDive',
      text: deepDiveSummary.value,
    });
  }
  if (jointAdoptionSummary.value) {
    notes.push({
      key: 'jointAdoption',
      labelKey: 'common:triggerOptimizer.noteJointAdoption',
      text: jointAdoptionSummary.value,
    });
  }
  notes.push({
    key: 'applyScope',
    labelKey: 'common:triggerOptimizer.noteApplyScope',
    text: t('common:triggerOptimizer.applyHint'),
  });
  return notes;
});

const profitDraft = ref(percent(settings.value.objectiveWeights.weightProfit));
const xpDraft = ref(percent(settings.value.objectiveWeights.weightXp));
const maxRoundsDraft = ref(settings.value.maxRounds);
const sampleRoundsDraft = ref(settings.value.rounds);
const candidateDraft = ref(settings.value.candidateLimit);
const hoursDraft = ref(settings.value.simulationHours);
const validDraft = computed(() =>
  isValidTriggerOptimizerSettings({
    ...settings.value,
    objectiveWeights: {
      weightProfit: toFraction(profitDraft.value),
      weightXp: toFraction(xpDraft.value),
    },
    maxRounds: maxRoundsDraft.value,
    rounds: sampleRoundsDraft.value,
    candidateLimit: candidateDraft.value,
    simulationHours: hoursDraft.value,
  }),
);

// 搜索强度：预设是派生状态（当前三元组命中哪一档），「自定义」在 select 里 disabled——
// 用户只能通过改动高级项进入该状态，不会被写成一个可以直接选出来的档位。
const activePreset = computed(() => resolveTriggerOptimizerPresetId(settings.value));
const presetHintParams = computed(() => ({
  preset: t(`common:triggerOptimizer.presets.${activePreset.value}`),
  candidateLimit: settings.value.candidateLimit,
  maxRounds: settings.value.maxRounds,
  rounds: settings.value.rounds,
}));
const presetSummary = computed(() => t(`common:triggerOptimizer.presets.${activePreset.value}`));

// ── 参数说明弹窗（2026-09-22）──────────────────────────────────────────────
// 搜索设置卡片下面原本平铺着 8 段解释（锁定含义 / 档位含义 / 重复次数 / 权重 / 搜索过程 /
// 模拟时长 / 优化范围 / 配对比较），与结果区的长文一样收进弹窗：卡片只留标签与控件。
// 与结果说明共用同一个组件（components/TriggerOptimizerNotes.vue），只换标题与条目。
const settingsNotesOpen = ref(false);
function openSettingsNotes() {
  settingsNotesOpen.value = true;
}
function closeSettingsNotes() {
  settingsNotesOpen.value = false;
}
const settingsNotes = computed(() => {
  const notes = [];
  // 锁定行只在有可锁技能时才渲染 → 说明也跟着它走（没有技能可锁时讲锁定是空话）。
  if (abilitySlots.value.length) {
    notes.push({
      key: 'lock',
      labelKey: 'common:triggerOptimizer.lockTitle',
      text: t('common:triggerOptimizer.lockHint'),
    });
  }
  // 顺序与卡片自上而下一致：档位 → 重复次数 → 权重 → 搜索过程 → 时长 → 优化范围 → 配对比较。
  // `presetHint` 是插值文案（当前档位的三个数值），换档位时弹窗里跟着变 —— 它本来就在设置区里
  // 充当「这个档位意味着什么」的即时反馈，只是换了展示位置。
  notes.push(
    {
      key: 'preset',
      labelKey: 'common:triggerOptimizer.preset',
      text: t('common:triggerOptimizer.presetHint', '', presetHintParams.value),
    },
    {
      key: 'rounds',
      labelKey: 'common:triggerOptimizer.rounds',
      text: t('common:triggerOptimizer.roundsHint'),
    },
    {
      key: 'weights',
      labelKey: 'common:triggerOptimizer.weightDeathSafety',
      text: t('common:triggerOptimizer.weightsHint'),
    },
    {
      key: 'searchLoop',
      labelKey: 'common:triggerOptimizer.noteSearchLoop',
      text: t('common:triggerOptimizer.searchHint'),
    },
    {
      key: 'hours',
      labelKey: 'common:triggerOptimizer.simulationHours',
      text: t('common:triggerOptimizer.simulationHoursHint'),
    },
    {
      key: 'scope',
      labelKey: 'common:triggerOptimizer.noteOptimizeScope',
      text: t('common:triggerOptimizer.scopeHint'),
    },
    {
      key: 'pairing',
      labelKey: 'common:triggerOptimizer.notePairing',
      text: t('common:triggerOptimizer.pairingHint'),
    },
  );
  return notes;
});

function percent(fraction) {
  return Number((Number(fraction || 0) * 100).toFixed(2));
}

function toFraction(value) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return '';
  return Number(value) / 100;
}

// 差值文案：绝对值（带单位）+ 百分比；死亡卡没有 percent 时只显示绝对值。
function formatMetricDelta(card) {
  if (!card) return '—';
  const body = signedCompact(card.key, card.delta);
  if (card.deltaPercent == null || !Number.isFinite(Number(card.deltaPercent))) return body;
  return `${body} (${signed(Number(card.deltaPercent), 1)}%)`;
}

function updateSettings(key, value) {
  simulator.setTriggerOptimizerSettings({ [key]: value === '' ? '' : Number(value) });
}

function updateWeight(key, raw) {
  const draft = raw === '' ? '' : Number(raw);
  const profit = key === 'weightProfit' ? draft : profitDraft.value === '' ? '' : Number(profitDraft.value);
  const xp = key === 'weightXp' ? draft : xpDraft.value === '' ? '' : Number(xpDraft.value);
  simulator.setTriggerOptimizerSettings({
    objectiveWeights: { weightProfit: toFraction(profit), weightXp: toFraction(xp) },
  });
}

// 预设 = 三个旋钮的捆绑写入（未知 id 直接忽略，「自定义」不是可写入的档位）。
// 时长按**当前设置**传入（2026-09-19，设计 §18.2）：预设的 rounds = max(基础轮数,
// 推荐轮数(时长))，短时长会被加密（4h → 5 轮），默认 24h 仍是 6/1/2、10/2/2、16/3/3。
function applyPreset(presetId) {
  const preset = getTriggerOptimizerPresetSettings(presetId, settings.value.simulationHours);
  if (!preset) return;
  simulator.setTriggerOptimizerSettings(preset);
}

function toggleLock(abilityHrid, locked) {
  const next = (settings.value.lockedAbilityHrids || []).filter((hrid) => hrid !== abilityHrid);
  if (locked) next.push(abilityHrid);
  simulator.setTriggerOptimizerLockedAbilities(next);
}

function run() {
  lastAction.value = '';
  simulator.startTriggerOptimizer();
}

// 换难度复核（2026-09-23，设计 §29）：只读动作 —— 不影响玩家配置，也不动报告主体，结果写进
// results.robustness（属于当前这一份报告）。再点一次 = 换盐追加（§51），因此同一次运行里可以
// 重复触发：首次换成相邻难度复核，之后每次再补一组新样本与已复核样本合并重检。
function runRobustness() {
  lastAction.value = '';
  simulator.runTriggerOptimizerRobustness();
}

// 复核追加（2026-09-26，设计 §51）：与首跑走**同一个** store 动作（内部按「有无复核结论」分两态），
// 这里单独挂入口只为把「首跑 / 追加」两个语义在界面上分开。
function runRobustnessAppend() {
  lastAction.value = '';
  simulator.runTriggerOptimizerRobustness();
}

// 追加复验（2026-09-24，设计 §31）：同样只读 —— 不写玩家配置，只把「首轮样本 + 新样本合并重检」
// 的结论写回当前报告的 verification（动作见 store 的 runTriggerOptimizerVerificationAppend）。
function runVerificationAppend() {
  lastAction.value = '';
  simulator.runTriggerOptimizerVerificationAppend();
}

// 停止复核：与搜索共用取消链（store 的 stop 会把在途的复核一并作废）。
function stopRobustness() {
  simulator.stopTriggerOptimizer();
}

function apply() {
  if (simulator.applyTriggerOptimizerResult()) lastAction.value = 'applied';
}

function revert() {
  if (simulator.revertTriggerOptimizerChanges()) lastAction.value = 'reverted';
}

// ── 导出 Excel（2026-09-24，设计 §40）────────────────────────────────────────
// 与「报告落盘恢复」互补而不是二选一：恢复 = 自动防丢（刷新/崩溃后重进自动回来），
// 导出 = 手动带走（留存/分享）。文案与界面同源（createTriggerOptimizerText + t），
// 不出现任何底层字段名；文件名带时间戳。
const exportBusy = ref(false);

// 逐技能「状态」列与卡片徽章逐字同口径（模板四级分支同顺序）：复验判负不挂「推荐」；
// 得分 0 或该槽未被采纳同样记「保持当前配置」。
function exportStatusFor(choice) {
  if (choice?.chosen && !resultRejected.value && chosenScore(choice) > 0 && slotAdopted(choice.slotIndex)) {
    return 'recommendation';
  }
  if (choice?.chosen && resultRejected.value) return 'recommendationWithheld';
  if (choice?.locked) return 'locked';
  return 'keepCurrent';
}

// 导出用：单次追加复验的**人话留档**（2026-09-25，设计 §48；累计字段 2026-09-26，设计 §50）——
// 基础句（轮数 / 累计）任何报告都说得出（attempts.rounds / mergedRounds 是 §31 就有的字段）；
// 计划快照在时再补一句「上限或护栏有没有生效」，这正是复盘要回答的第三个问题。快照缺失（本改动
// 之前的旧报告，或服务层判定不自洽而丢弃）就只说基础句：宁可少说，也不说没有依据的话。
function verifyAppendArchiveText(attempt) {
  const rounds = Number(attempt?.rounds) || 0;
  const mergedRounds = Number(attempt?.mergedRounds) || 0;
  const plan = attempt?.plan && typeof attempt.plan === 'object' ? attempt.plan : null;
  if (!plan) return t('common:triggerOptimizer.verifyAppendArchive', '', { rounds, mergedRounds });
  const params = {
    rounds,
    mergedRounds,
    cap: Number(plan.capRounds) || 0,
    percent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO * 100),
    singlePercent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO * 100),
  };
  if (plan.budgetLimited === true) return t('common:triggerOptimizer.verifyAppendArchiveBudget', '', params);
  if (plan.capped === true) return t('common:triggerOptimizer.verifyAppendArchiveCapped', '', params);
  return t('common:triggerOptimizer.verifyAppendArchiveWithinLimits', '', params);
}

// 导出用：单次复核追加的**人话留档**（2026-09-26，设计 §51）——与追加复验同款：基础句（轮数 /
// 累计）任何报告都说得出；计划快照在时再补一句成本护栏有没有生效（复核追加的目标恒为「补到
// 上限」，所以这里只区分护栏，不区分上限来源）。快照缺失（本改动之前的旧报告，或服务层判定
// 不自洽而丢弃）就只说基础句：宁可少说，也不说没有依据的话。
function robustnessAppendArchiveText(attempt) {
  const rounds = Number(attempt?.rounds) || 0;
  const mergedRounds = Number(attempt?.mergedRounds) || 0;
  const plan = attempt?.plan && typeof attempt.plan === 'object' ? attempt.plan : null;
  if (!plan) return t('common:triggerOptimizer.robustnessAppendArchive', '', { rounds, mergedRounds });
  const params = {
    rounds,
    mergedRounds,
    cap: Number(plan.capRounds) || 0,
    percent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO * 100),
    singlePercent: Math.round(TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO * 100),
  };
  if (plan.budgetLimited === true) return t('common:triggerOptimizer.robustnessAppendArchiveBudget', '', params);
  return t('common:triggerOptimizer.robustnessAppendArchiveWithinLimits', '', params);
}

async function exportReport() {
  const report = results.value;
  if (!report?.createdAt || exportBusy.value) return;
  // 重新组装一份文本工具（不猜页面解构名）：导出格子里每一行文案都与卡片/弹窗同款。
  const exportText = createTriggerOptimizerText({ t, number, getOfficialGameText });
  const statusBySlot = {};
  for (const choice of choices.value) {
    const statusKey = exportStatusFor(choice);
    statusBySlot[choice.slotIndex] = t(`common:triggerOptimizer.${statusKey}`, statusKey);
  }
  const summaryRows = [
    {
      item: t('common:triggerOptimizer.export.generatedAt', 'Report time'),
      value: new Date(report.createdAt).toLocaleString(),
    },
    { item: t('common:triggerOptimizer.export.conclusion', 'Conclusion'), value: verdictHeadline.value },
    {
      item: t('common:triggerOptimizer.changedAbilities', ''),
      value: t('common:triggerOptimizer.changedAbilitiesValue', '', changedAbilities.value),
    },
    {
      item: t('common:triggerOptimizer.scoreDelta', ''),
      value: exportText.signed(improvement.value?.scoreDelta, 4),
    },
    {
      item: t('common:triggerOptimizer.baseline', ''),
      value: baselineScore.value == null ? '—' : exportText.signed(baselineScore.value, 4),
    },
    { item: t('common:triggerOptimizer.best', ''), value: exportText.signed(improvement.value?.score, 4) },
  ];
  if (verification.value) {
    summaryRows.push(
      {
        item: t('common:triggerOptimizer.verificationTitle', ''),
        value: t(`common:triggerOptimizer.verdicts.${verification.value.verdict || 'unknown'}`),
      },
      {
        item: t('common:triggerOptimizer.verificationPValue', ''),
        value: verificationPValueLabel.value,
      },
    );
  }
  // 追加复验的留档（2026-09-25，设计 §48）：轮数自适应（§47）之后，「这次补了几轮、上限/护栏
  // 有没有咬住」只在上屏说过一次（下一次渲染就被新计划顶掉）—— 导出必须带上同一件事，事后
  // 才能复盘。汇总行与界面逐字同款（verifyAppend / verifyAppendMerged），然后每次追加一行明细。
  const attempts = Array.isArray(verification.value?.attempts) ? verification.value.attempts : [];
  if (attempts.length > 0) {
    summaryRows.push({
      item: t('common:triggerOptimizer.verifyAppend', ''),
      value: t('common:triggerOptimizer.verifyAppendMerged', '', {
        attempts: attempts.length,
        rounds: Number(verification.value?.rounds) || 0,
        spent: resolveTriggerOptimizerAppendSpentSimulations(attempts),
      }),
    });
    attempts.forEach((attempt, index) => {
      summaryRows.push({
        item: t('common:triggerOptimizer.verifyAppendAttempt', '', {
          attempt: Number(attempt?.attempt) || index + 1,
        }),
        value: verifyAppendArchiveText(attempt),
      });
    });
  }
  // 复核留档（2026-09-25，设计 §49）：轮数从固定 6 轮变成按需反解之后，导出里必须带上「这次跑了
  // 几轮、上限/成本护栏有没有咬住」；旧报告没有 plan（或净化失败）时只说结论。
  if (robustnessSummary.value) {
    const verdict = robustnessVerdictLabel.value;
    summaryRows.push({
      item: t('common:triggerOptimizer.robustnessTitle', '', {
        tier: Number(robustnessSummary.value.difficultyTier) || 0,
      }),
      value: robustnessPlanDetail.value ? `${verdict} · ${robustnessPlanDetail.value}` : verdict,
    });
    // 复核追加的留档（2026-09-26，设计 §51）：换盐追加之后，「补了几轮、护栏有没有咬住」只在上屏
    // 说过一次 —— 导出必须带上同一件事，事后才能复盘。汇总行与界面逐字同款（robustnessAppendRun /
    // robustnessAppendMerged），然后每次追加一行明细（与追加复验同款结构）。
    const robustnessAttempts = Array.isArray(robustnessSummary.value.attempts) ? robustnessSummary.value.attempts : [];
    if (robustnessAttempts.length > 0) {
      summaryRows.push({
        item: t('common:triggerOptimizer.robustnessAppendRun', ''),
        value: t('common:triggerOptimizer.robustnessAppendMerged', '', {
          attempts: robustnessAttempts.length,
          rounds: Number(robustnessSummary.value.rounds) || 0,
          spent: resolveTriggerOptimizerAppendSpentSimulations(robustnessAttempts),
        }),
      });
      robustnessAttempts.forEach((attempt, index) => {
        summaryRows.push({
          item: t('common:triggerOptimizer.robustnessAppendAttempt', '', {
            attempt: Number(attempt?.attempt) || index + 1,
          }),
          value: robustnessAppendArchiveText(attempt),
        });
      });
    }
  }
  // 证据预算（2026-09-26，设计 §53）：与说明弹窗逐字同文 —— 界面上的句子会被下一次渲染顶掉，
  // 事后复盘只有导出能查（两条追加路径的已花 / 预算 / 剩余 / 出口）。
  if (evidenceBudgetNote.value) {
    summaryRows.push({
      item: t('common:triggerOptimizer.noteEvidenceBudget', ''),
      value: evidenceBudgetNote.value,
    });
  }
  if (scopeText.value) {
    summaryRows.push({ item: t('common:triggerOptimizer.scopeTitle', ''), value: scopeText.value });
  }
  summaryRows.push(
    {
      item: t('common:triggerOptimizer.preset', ''),
      value: t(`common:triggerOptimizer.presets.${activePreset.value}`),
    },
    { item: t('common:triggerOptimizer.rounds', ''), value: String(settings.value.rounds) },
    { item: t('common:triggerOptimizer.maxRounds', ''), value: String(settings.value.maxRounds) },
    {
      item: t('common:triggerOptimizer.candidateLimit', ''),
      value: String(settings.value.candidateLimit),
    },
  );
  exportBusy.value = true;
  try {
    await downloadTriggerOptimizerReportXlsx({
      report,
      summaryRows,
      statusBySlot,
      text: exportText,
      t,
      getAbilityName,
    });
  } finally {
    exportBusy.value = false;
  }
}

watch(
  () => simulator.triggerOptimizer.settings,
  (value) => {
    profitDraft.value = percent(value.objectiveWeights.weightProfit);
    xpDraft.value = percent(value.objectiveWeights.weightXp);
    maxRoundsDraft.value = value.maxRounds;
    sampleRoundsDraft.value = value.rounds;
    candidateDraft.value = value.candidateLimit;
    hoursDraft.value = value.simulationHours;
  },
  { deep: true },
);
</script>
