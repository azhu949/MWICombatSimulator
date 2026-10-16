<template>
  <section class="min-w-0 space-y-5" data-budget-optimizer-page>
    <!-- 头卡：标题 + 操作 + 只读上下文（玩家 / 目标场景）。上下文跟随主页模拟设置，
         本页不提供切换器，换图 / 换难度走「去主页改」；模拟时长为可编辑项，收在下方优化设置里。 -->
    <header class="surface-panel space-y-3" data-budget-optimizer-header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="flex items-center gap-2 font-heading text-xl font-semibold">
          <Wallet class="size-5 text-primary" />{{ t('common:menu.budgetOptimizer') }}
        </h2>
        <div class="flex flex-wrap gap-2">
          <Button as-child variant="outline" size="sm"
            ><RouterLink to="/home"><Settings2 />{{ t('common:budgetOptimizer.editCombat') }}</RouterLink></Button
          >
          <Button
            v-if="running"
            size="sm"
            variant="destructive"
            data-budget-optimizer-stop
            @click="simulator.stopBudgetOptimizer()"
            ><Square />{{ t('common:budgetOptimizer.stop') }}</Button
          >
          <Button v-else size="sm" :disabled="!canStart" data-budget-optimizer-start @click="run()"
            ><Play />{{ t('common:budgetOptimizer.start') }}</Button
          >
        </div>
      </div>
      <div class="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-border pt-3 text-sm">
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="text-xs font-semibold text-muted-foreground">{{ t('common:player') }}</span>
          <span class="break-words font-medium">{{ activePlayerName }}</span>
        </div>
        <div class="flex min-w-0 flex-wrap items-baseline gap-2">
          <span class="text-xs font-semibold text-muted-foreground">{{ t('common:budgetOptimizer.targetLabel') }}</span>
          <span class="break-words font-medium">{{ targetName }}</span>
          <span class="text-xs text-muted-foreground">{{ difficultyText }}</span>
          <RouterLink class="text-xs underline" to="/home">{{ t('common:budgetOptimizer.changeTarget') }}</RouterLink>
        </div>
      </div>
    </header>

    <!-- 已应用 · 撤销条：链结束后配置已自动写回主角（整链一条快照），撤销一次退回链起点。
         撤销只回滚被链涉及的装备 / 技能 / 房子键；是否踩到手工改动由 store 判定，这里不做二次拦截。 -->
    <div
      v-if="hasAppliedSnapshot"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 p-3"
      data-budget-optimizer-applied-bar
    >
      <p class="text-sm text-success" role="status">
        {{ t('common:budgetOptimizer.appliedBar', '', { count: number(appliedSteps, 0) }) }}
      </p>
      <Button size="sm" variant="outline" :disabled="!canRevert" data-budget-optimizer-revert @click="revert()"
        ><Undo2 />{{ t('common:budgetOptimizer.revert') }}</Button
      >
    </div>
    <p v-if="lastAction === 'reverted'" class="text-sm text-success" role="status" data-budget-optimizer-action-note>
      {{ t('common:budgetOptimizer.reverted') }}
    </p>

    <!-- 优化设置卡：分组依次为 预算 → 优化范围 → 搜索参数 → 队友，组间上边框分隔；
         所有字段统一「标签在上 + 控件在下」，开关统一 chip 样式。 -->
    <section class="surface-panel space-y-4" data-budget-optimizer-settings-card>
      <h3 class="text-sm font-semibold">{{ t('common:budgetOptimizer.settingsTitle') }}</h3>

      <!-- 预算与派生区间：区间随预算草稿实时换算（bandRatio 已含设置归一化）。 -->
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="min-w-0"
          ><span class="control-label">{{ t('common:budgetOptimizer.budgetLabel') }}</span
          ><input
            v-model="budgetDraft"
            class="control-input"
            type="number"
            min="1"
            step="1"
            :disabled="running"
            :aria-invalid="!validDraft"
            data-budget-optimizer-budget
            @input="commitBudget($event.target.value)"
        /></label>
        <div class="min-w-0">
          <p class="control-label">{{ t('common:budgetOptimizer.bandLabel') }}</p>
          <p class="flex min-h-9 items-center text-sm font-semibold tabular-nums" data-budget-optimizer-band>
            {{ bandText }}
          </p>
          <p class="mt-1 text-xs text-muted-foreground" data-budget-optimizer-band-high>{{ bandHighText }}</p>
        </div>
      </div>

      <!-- 优化范围：参与搜索的类别开关（chip）+ 装备强化上限（数值约束，独立成字段）。 -->
      <div class="border-t border-border pt-4">
        <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div class="min-w-0 space-y-2">
            <p class="text-xs font-semibold text-muted-foreground">{{ t('common:budgetOptimizer.rangeTitle') }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <label
                class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/50"
                :class="settings.enableEquipment ? 'bg-muted font-medium' : ''"
                ><input
                  type="checkbox"
                  :checked="settings.enableEquipment"
                  :disabled="running"
                  data-budget-optimizer-enable-equipment
                  @change="commitToggle('enableEquipment', $event.target.checked)"
                /><span>{{ t('common:budgetOptimizer.enableEquipment') }}</span></label
              >
              <label
                class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/50"
                :class="settings.enableAbilities ? 'bg-muted font-medium' : ''"
                ><input
                  type="checkbox"
                  :checked="settings.enableAbilities"
                  :disabled="running"
                  data-budget-optimizer-enable-abilities
                  @change="commitToggle('enableAbilities', $event.target.checked)"
                /><span>{{ t('common:budgetOptimizer.enableAbilities') }}</span></label
              >
              <label
                class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/50"
                :class="settings.enableHouses ? 'bg-muted font-medium' : ''"
                ><input
                  type="checkbox"
                  :checked="settings.enableHouses"
                  :disabled="running"
                  data-budget-optimizer-enable-houses
                  @change="commitToggle('enableHouses', $event.target.checked)"
                /><span>{{ t('common:budgetOptimizer.enableHouses') }}</span></label
              >
            </div>
          </div>
          <label class="w-28 shrink-0"
            ><span class="control-label">{{ t('common:budgetOptimizer.maxLevelUp') }}</span
            ><input
              v-model="maxLevelUpDraft"
              class="control-input"
              type="number"
              :min="MIN_MAX_LEVEL_UP"
              :max="MAX_MAX_LEVEL_UP"
              step="1"
              :disabled="running"
              :aria-invalid="!validDraft"
              data-budget-optimizer-max-level-up
              @input="commitNumber('maxLevelUp', $event.target.value)"
          /></label>
        </div>
      </div>

      <!-- 搜索参数：优化目标 / 搜索强度 / 模拟时长 / 模拟步数（统一「标签在上 + 控件在下」的四列网格）；
           模拟步数 = 一次链最多应用的升级步数，预设 5/10/15 与「自定义」共用 custom 模式，
           选自定义时旁边出现数字输入框（1~40，超出由 store 归一化钳制）。 -->
      <div class="grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <label class="min-w-0"
          ><span class="control-label">{{ t('common:budgetOptimizer.objectiveLabel') }}</span
          ><select
            class="control-input"
            :value="settings.objective"
            :disabled="running"
            data-budget-optimizer-objective
            @change="commitObjective($event.target.value)"
          >
            <option :value="OBJECTIVE_PROFIT">{{ t('common:budgetOptimizer.objectives.profit') }}</option>
            <option :value="OBJECTIVE_DPS">{{ t('common:budgetOptimizer.objectives.dps') }}</option>
            <option :value="OBJECTIVE_XP">{{ t('common:budgetOptimizer.objectives.xp') }}</option>
          </select></label
        >
        <label class="min-w-0"
          ><span class="control-label">{{ t('common:budgetOptimizer.preset') }}</span
          ><select
            class="control-input"
            :value="settings.searchPreset"
            :disabled="running"
            data-budget-optimizer-preset
            @change="commitPreset($event.target.value)"
          >
            <option :value="PRESET_FAST">{{ t('common:budgetOptimizer.presets.fast') }}</option>
            <option :value="PRESET_STANDARD">{{ t('common:budgetOptimizer.presets.standard') }}</option>
            <option :value="PRESET_FINE">{{ t('common:budgetOptimizer.presets.fine') }}</option>
          </select></label
        >
        <label class="min-w-0"
          ><span class="control-label">{{ t('common:budgetOptimizer.simulationHours') }}</span
          ><input
            v-model="hoursDraft"
            class="control-input"
            type="number"
            :min="MIN_SIMULATION_HOURS"
            :max="MAX_SIMULATION_HOURS"
            step="1"
            :disabled="running"
            :aria-invalid="!validDraft"
            data-budget-optimizer-hours
            @input="commitNumber('simulationHours', $event.target.value)"
        /></label>
        <div class="min-w-0">
          <span class="control-label">{{ t('common:budgetOptimizer.stepLimit') }}</span>
          <div class="flex items-center gap-2">
            <select
              class="control-input min-w-0 flex-1"
              :value="stepLimitSelectValue"
              :disabled="running"
              data-budget-optimizer-step-limit
              @change="commitStepLimit($event.target.value)"
            >
              <option :value="STEP_LIMIT_UNLIMITED">{{ t('common:budgetOptimizer.stepLimitModes.unlimited') }}</option>
              <option v-for="count in STEP_LIMIT_PRESETS" :key="count" :value="String(count)">
                {{ t('common:budgetOptimizer.stepLimitSteps', '', { count }) }}
              </option>
              <option :value="STEP_LIMIT_CUSTOM">{{ t('common:budgetOptimizer.stepLimitModes.custom') }}</option>
            </select>
            <input
              v-if="isCustomStepLimit"
              v-model="maxChainStepsDraft"
              class="control-input w-20 shrink-0"
              type="number"
              :min="MIN_CHAIN_STEPS"
              :max="MAX_CHAIN_STEPS"
              step="1"
              :disabled="running"
              :aria-invalid="!validDraft"
              data-budget-optimizer-max-chain-steps
              @input="commitNumber('maxChainSteps', $event.target.value)"
            />
          </div>
        </div>
      </div>

      <!-- 定选显著性门槛（2026-10-09 起默认开启）：开启后定选只接受配对 t 检验显著为正的候选 —— 更保守、
           链可能提前终止；配合结果条的复验值与账面推算值做事后对照。 -->
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <label
              class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/50"
              :class="settings.pickSignificanceGate ? 'bg-muted font-medium' : ''"
              ><input
                type="checkbox"
                :checked="settings.pickSignificanceGate"
                :disabled="running"
                data-budget-optimizer-significance-gate
                @change="commitToggle('pickSignificanceGate', $event.target.checked)"
              /><span>{{ t('common:budgetOptimizer.significanceGate') }}</span></label
            >
          </div>
          <p class="text-xs text-muted-foreground" data-budget-optimizer-significance-gate-hint>
            {{ t('common:budgetOptimizer.significanceGateHint') }}
          </p>
        </div>
      </div>

      <!-- 队友勾选：空 = 单人载荷；勾选后整队评估（只改主角）。集合写进设置并进输入指纹，
           换队友会让既有报告过期。 -->
      <div v-if="partyCandidates.length" class="space-y-2 border-t border-border pt-4" data-budget-optimizer-party>
        <p class="control-label">{{ t('common:budgetOptimizer.partyTitle') }}</p>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="player in partyCandidates"
            :key="player.id"
            class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/50"
            :class="isPartyPlayerSelected(player.id) ? 'bg-muted font-medium' : ''"
            :data-budget-optimizer-party-player="player.id"
          >
            <input
              type="checkbox"
              :checked="isPartyPlayerSelected(player.id)"
              :disabled="running"
              @change="togglePartyPlayer(player.id, $event.target.checked)"
            />
            <span>{{ player.name }}</span>
            <span v-if="isPartyPlayerSelected(player.id)" class="text-xs text-muted-foreground">{{
              t('common:budgetOptimizer.partyIncluded')
            }}</span>
          </label>
        </div>
        <p class="text-xs text-muted-foreground" data-budget-optimizer-party-hint>
          {{ t('common:budgetOptimizer.partyHint') }}
        </p>
      </div>
    </section>

    <p v-if="!validDraft" class="text-sm text-destructive" role="alert">
      {{ t('common:budgetOptimizer.invalidSettings') }}
    </p>
    <p v-else-if="blockReason" class="text-sm text-warning" role="status">{{ t(blockReason) }}</p>
    <p v-if="errorText" class="break-words text-sm text-destructive" role="alert" data-budget-optimizer-error>
      {{ t(errorText, errorText) }}
    </p>

    <section v-if="!imported" class="space-y-2 border-t border-border pt-4" data-budget-optimizer-empty>
      <p class="text-sm text-muted-foreground">{{ t('common:budgetOptimizer.emptyState') }}</p>
      <Button as-child variant="outline" size="sm"
        ><RouterLink to="/home">{{ t('common:budgetOptimizer.goHome') }}</RouterLink></Button
      >
    </section>

    <section
      v-if="running || hasResults || chainSteps.length"
      class="space-y-3 border-t border-border pt-4"
      data-budget-optimizer-progress
    >
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p class="font-medium" data-budget-optimizer-phase>{{ t(`common:budgetOptimizer.phases.${phaseKey}`) }}</p>
        <div class="flex items-center gap-3">
          <span class="tabular-nums" data-budget-optimizer-elapsed>{{ number(liveElapsedSeconds, 1) }} s</span>
          <Button
            v-if="running"
            size="sm"
            variant="destructive"
            data-budget-optimizer-progress-stop
            @click="simulator.stopBudgetOptimizer()"
            ><Square />{{ t('common:budgetOptimizer.stop') }}</Button
          >
        </div>
      </div>
      <progress
        class="h-2 w-full accent-primary"
        data-budget-optimizer-progress-bar
        :value="progressValue"
        max="1"
        :aria-label="t('common:budgetOptimizer.progress')"
      />
      <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span v-if="running && runtime.total > 0" data-budget-optimizer-evaluated
          >{{ t('common:budgetOptimizer.evaluatedLabel') }}: {{ number(runtime.evaluated, 0) }} /
          {{ number(runtime.total, 0) }}</span
        >
        <span v-if="runtime.stepsDone > 0" data-budget-optimizer-steps-done
          >{{ t('common:budgetOptimizer.stepsDoneLabel') }}: {{ number(runtime.stepsDone, 0) }}</span
        >
      </div>
      <p v-if="stale" class="text-sm text-warning" role="status" data-budget-optimizer-stale>
        {{ t('common:budgetOptimizer.stale') }}
      </p>
    </section>

    <section
      v-if="hasResults || chainSteps.length"
      class="space-y-4 border-t border-border pt-4"
      data-budget-optimizer-results
    >
      <h3 class="flex items-center gap-2 font-heading text-base font-semibold">
        <TrendingUp class="size-4 text-primary" />{{ t('common:budgetOptimizer.resultsTitle') }}
      </h3>
      <!-- KPI 主视觉卡：「链起点 → 优化后」是本页唯一的结论。主口径优先取配对复验（链终点的
           真实测量，Δ 为逐种子配对差），无复验（旧报告 / 取消 / 零步链 / 复验失败）回退保守推算
           （链起点基线 + 各步 mean−1×se 累加）。账面对照（各步自评累加的乐观口径）只在有复验时
           降级为右侧灰字 —— 账面值与真值的差距就是「赢者诅咒」的幅度。 -->
      <div class="rounded-lg border border-border bg-muted/30 p-4" data-budget-optimizer-baseline>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-muted-foreground">
              {{ t('common:budgetOptimizer.baselineLabel', '', { objective: objectiveTitle }) }}
            </p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">{{ baselineValueText }}</p>
          </div>
          <ArrowRight class="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span data-budget-optimizer-final-label>{{
                t(optimizedLabelKey, '', { objective: objectiveTitle })
              }}</span>
              <span
                v-if="optimizedVerified"
                class="rounded-full border border-border bg-background px-2 py-px text-[10px] font-medium tabular-nums text-muted-foreground"
                data-budget-optimizer-verification-rounds
                >{{
                  t('common:budgetOptimizer.verificationRounds', '', { count: number(verificationRounds, 0) })
                }}</span
              >
            </p>
            <p class="mt-1 flex flex-wrap items-baseline gap-2">
              <span class="text-3xl font-bold tabular-nums" data-budget-optimizer-final-value>{{
                optimizedValueText
              }}</span>
              <span
                v-if="optimizedDeltaText"
                class="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                :class="deltaPillClass(optimizedDelta)"
                data-budget-optimizer-final-delta
                >{{ optimizedDeltaText }}</span
              >
            </p>
          </div>
          <div
            v-if="optimizedVerified && ledgerDeltaText"
            class="ml-auto flex min-w-0 flex-col items-end gap-0.5 self-center text-muted-foreground"
          >
            <span class="text-xs" data-budget-optimizer-ledger-label>{{
              t('common:budgetOptimizer.ledgerLabel', '', { objective: objectiveTitle })
            }}</span>
            <p class="flex items-baseline gap-1.5 text-sm tabular-nums">
              <span data-budget-optimizer-ledger-value>{{ ledgerValueText }}</span>
              <span class="text-xs" data-budget-optimizer-ledger-delta>{{ ledgerDeltaText }}</span>
            </p>
          </div>
        </div>
      </div>
      <!-- 汇总卡：预算是本功能的核心约束，直接画成「花费 / 剩余」占比条；累计 Δ目标与终止原因
           同卡收拢。注记小字（取消说明 / 缺价跳过 / 估值口径 / 应用行为）统一收在网格之后。 -->
      <div class="space-y-3 rounded-lg border border-border p-4" data-budget-optimizer-chain-summary>
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p class="text-sm font-semibold">{{ t('common:budgetOptimizer.chainSummaryTitle') }}</p>
          <span v-if="stopReasonText" class="text-xs text-muted-foreground" data-budget-optimizer-chain-stop-reason>
            {{ stopReasonText }}
          </span>
        </div>
        <div class="space-y-1.5">
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary transition-[width]"
              :style="{ width: `${budgetUsedPercent}%` }"
              aria-hidden="true"
            />
          </div>
          <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs tabular-nums">
            <span data-budget-optimizer-chain-total-cost>
              {{ t('common:budgetOptimizer.chainTotalCost', '', { cost: coins(totalCost) }) }}
            </span>
            <span class="text-muted-foreground">{{ number(budgetUsedPercent, 0) }}%</span>
            <span class="ml-auto" data-budget-optimizer-chain-remaining>
              {{ t('common:budgetOptimizer.chainRemaining', '', { remaining: coins(remainingBudget) }) }}
            </span>
          </div>
        </div>
        <p class="border-t border-border/60 pt-2.5 text-sm font-semibold tabular-nums">
          <span :class="deltaTextClass(optimizedDelta)" data-budget-optimizer-chain-total-delta>
            {{
              t('common:budgetOptimizer.chainTotalDelta', '', {
                objective: objectiveTitle,
                delta: percentText(deltaToPercent(optimizedDelta)),
              })
            }}
          </span>
        </p>
      </div>
      <p v-if="!displaySteps.length" class="text-sm text-muted-foreground" data-budget-optimizer-chain-empty>
        {{ chainEmptyText }}
      </p>

      <!-- 升级链步骤网格：每步一张独立卡片（不再拼线成单个大容器），自上而下：步号（色点与
           徽章同色，按步骤序号轮转调色板）→ 变化 → 「标签在上、数值在下」的字段网格（贴底
           对齐）；强调色只做识别标记、不承载语义，「候选明细」开弹窗。 -->
      <ol v-if="displaySteps.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-budget-optimizer-steps>
        <li
          v-for="step in displaySteps"
          :key="step.index"
          class="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3"
          :class="isRunningStep(step.index) ? 'ring-1 ring-inset ring-primary/40' : ''"
          :data-budget-optimizer-step="step.index"
        >
          <div class="flex items-center justify-between gap-x-2" data-budget-optimizer-step-head>
            <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :style="{ backgroundColor: stepAccentColor(step.index) }"
                aria-hidden="true"
                data-budget-optimizer-step-dot
              />
              <span
                class="rounded bg-muted px-1.5 py-0.5 text-[11px] leading-4 font-semibold tabular-nums"
                :style="{ color: stepAccentColor(step.index) }"
                data-budget-optimizer-step-badge
                >{{ t('common:budgetOptimizer.stepBadge', '', { index: number(step.index + 1, 0) }) }}</span
              >
              <span v-if="isRunningStep(step.index)" class="text-xs font-medium text-primary">{{
                t('common:budgetOptimizer.stepRunning')
              }}</span>
            </div>
            <Button
              class="shrink-0"
              size="sm"
              variant="ghost"
              :data-budget-optimizer-step-candidates-open="step.index"
              @click="openStepCandidates(step.index)"
              >{{ t('common:budgetOptimizer.stepCandidatesOpen') }}</Button
            >
          </div>
          <p class="break-words text-sm leading-snug font-semibold" data-budget-optimizer-step-change>
            {{ candidateChangeText(step.candidate) }}
          </p>
          <dl
            class="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-2.5 text-xs"
            data-budget-optimizer-step-fields
          >
            <div class="min-w-0">
              <dt class="text-muted-foreground">{{ t('common:budgetOptimizer.stepCostLabel') }}</dt>
              <dd class="mt-0.5 font-semibold tabular-nums" data-budget-optimizer-step-cost>
                {{ coins(step.cost) }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">
                {{ t('common:budgetOptimizer.stepDeltaLabel', '', { objective: objectiveTitle }) }}
              </dt>
              <dd
                class="mt-0.5 font-semibold tabular-nums"
                :class="deltaTextClass(stepDeltaOf(step))"
                data-budget-optimizer-step-delta
              >
                {{ percentText(deltaToPercent(stepDeltaOf(step))) }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">{{ t('common:budgetOptimizer.stepRemainingLabel') }}</dt>
              <dd class="mt-0.5 font-semibold tabular-nums" data-budget-optimizer-step-remaining>
                {{ coins(step.remainingBudgetAfter) }}
              </dd>
            </div>
            <div v-if="Number(step.elapsedSeconds) > 0" class="min-w-0">
              <dt class="text-muted-foreground">{{ t('common:budgetOptimizer.stepElapsedLabel') }}</dt>
              <dd class="mt-0.5 font-semibold tabular-nums" data-budget-optimizer-step-elapsed>
                {{ number(step.elapsedSeconds, 0) }} s
              </dd>
            </div>
          </dl>
        </li>
      </ol>

      <!-- 报告注记：附属低密度信息（停止说明 / 缺价跳过 / 估值口径 / 应用行为）统一收拢为小字
           列表，放在步骤网格之后不再散落；缺价提示有明细时整行按钮可点击打开弹窗。 -->
      <div class="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <p v-if="results.cancelled" class="text-warning" role="status" data-budget-optimizer-cancelled>
          {{ t('common:budgetOptimizer.cancelled') }}
        </p>
        <button
          v-if="skippedNoPrice > 0 && skippedDetails.length > 0"
          type="button"
          class="self-start text-left underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
          data-budget-optimizer-skipped
          @click="skippedOpen = true"
        >
          {{ t('common:budgetOptimizer.skippedNoPrice', '', { count: number(skippedNoPrice, 0) }) }}
        </button>
        <p v-else-if="skippedNoPrice > 0" data-budget-optimizer-skipped>
          {{ t('common:budgetOptimizer.skippedNoPrice', '', { count: number(skippedNoPrice, 0) }) }}
        </p>
        <p v-if="fallbackFairValue > 0" data-budget-optimizer-fair-value>
          {{ t('common:budgetOptimizer.fallbackFairValue', '', { count: number(fallbackFairValue, 0) }) }}
        </p>
        <p data-budget-optimizer-apply-hint>{{ t('common:budgetOptimizer.applyHint') }}</p>
      </div>

      <!-- 步骤候选明细弹窗：卡片按钮打开（一次一步）；候选按证据分档 + 性价比排序（快照已排好）。 -->
      <BaseModal
        :open="candidatesStepIndex != null"
        :title="candidatesTitle"
        panel-class="max-w-4xl"
        @close="candidatesStepIndex = null"
      >
        <div data-budget-optimizer-step-candidates-dialog>
          <p class="mb-2 text-xs text-muted-foreground" data-budget-optimizer-step-candidates-hint>
            {{ t('common:budgetOptimizer.stepCandidatesHint') }}
          </p>
          <div
            v-if="candidatesStep && stepCandidatesOf(candidatesStep).length"
            class="overflow-x-auto rounded-lg border border-border"
            :data-budget-optimizer-step-candidates="candidatesStep.index"
          >
            <table class="w-full min-w-[40rem] text-left text-sm">
              <thead class="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th class="px-3 py-2 font-medium">{{ t('common:budgetOptimizer.candidateColumnGroup') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('common:budgetOptimizer.candidateColumnChange') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('common:budgetOptimizer.candidateColumnCost') }}</th>
                  <th class="px-3 py-2 font-medium">
                    {{ t('common:budgetOptimizer.candidateColumnDeltaObjective', '', { objective: objectiveTitle }) }}
                  </th>
                  <th class="px-3 py-2 font-medium">{{ t('common:budgetOptimizer.candidateColumnEfficiency') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('common:budgetOptimizer.candidateColumnSignificant') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('common:budgetOptimizer.candidateColumnPrecision') }}</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(candidate, candidateIndex) in stepCandidatesOf(candidatesStep)" :key="candidate.id">
                  <tr
                    v-if="dividerBefore(candidatesStep, candidateIndex)"
                    class="bg-muted/40"
                    :data-budget-optimizer-step-divider="candidatesStep.index"
                  >
                    <td colspan="7" class="px-3 py-1.5 text-xs text-muted-foreground">
                      {{ dividerText(candidatesStep, candidateIndex) }}
                    </td>
                  </tr>
                  <tr
                    class="border-b border-border/60 last:border-0"
                    :class="candidate.id === candidatesStep.candidate.id ? 'bg-primary/5 font-medium' : ''"
                    :data-budget-optimizer-step-candidate="candidate.id"
                  >
                    <td class="px-3 py-2">{{ candidateGroupLabel(candidate) }}</td>
                    <td class="px-3 py-2">
                      <span class="break-words">{{ candidateChangeText(candidate) }}</span>
                      <span v-if="candidate.id === candidatesStep.candidate.id" class="ml-2 text-[10px] text-primary">{{
                        t('common:budgetOptimizer.stepChosenMark')
                      }}</span>
                      <span v-else-if="candidate.manaRegression" class="ml-2 text-[10px] text-warning">{{
                        t('common:budgetOptimizer.manaRegression')
                      }}</span>
                    </td>
                    <td class="px-3 py-2 tabular-nums">{{ coins(candidate.cost) }}</td>
                    <td class="px-3 py-2 tabular-nums" :class="deltaTextClass(candidateDeltaOf(candidate))">
                      {{ percentText(deltaToPercent(candidateDeltaOf(candidate))) }}
                    </td>
                    <td class="px-3 py-2 tabular-nums">
                      {{ candidateEfficiencyText(candidate) }}
                    </td>
                    <td class="px-3 py-2">
                      {{
                        candidate.significant
                          ? t('common:budgetOptimizer.candidateYes')
                          : t('common:budgetOptimizer.candidateNo')
                      }}
                    </td>
                    <td class="px-3 py-2">
                      <span :class="candidate.refined ? 'text-success' : 'text-warning'">
                        {{
                          candidate.refined
                            ? t('common:budgetOptimizer.candidateRefined')
                            : t('common:budgetOptimizer.candidateScreened')
                        }}
                      </span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p
            v-else
            class="text-sm text-muted-foreground"
            :data-budget-optimizer-step-candidates-empty="candidatesStepIndex"
          >
            {{ t('common:budgetOptimizer.stepCandidatesEmpty') }}
          </p>
          <p
            v-if="candidatesStep && stepCandidatesTruncatedOf(candidatesStep) > 0"
            class="mt-2 text-xs text-muted-foreground"
            :data-budget-optimizer-step-candidates-truncated="candidatesStepIndex"
          >
            {{
              t('common:budgetOptimizer.stepCandidatesTruncated', '', {
                count: number(stepCandidatesTruncatedOf(candidatesStep), 0),
              })
            }}
          </p>
        </div>
      </BaseModal>
    </section>

    <!-- 缺价候选明细弹窗：解释缺价原因 + 按槽位/技能/房间分组的完整清单。 -->
    <BaseModal
      :open="skippedOpen"
      :title="t('common:budgetOptimizer.skippedDetailsTitle')"
      @close="skippedOpen = false"
    >
      <div data-budget-optimizer-skipped-dialog>
        <p class="text-xs text-muted-foreground">{{ t('common:budgetOptimizer.skippedDetailsHint') }}</p>
        <div v-if="skippedGroups.length > 0" class="space-y-3">
          <div v-for="group in skippedGroups" :key="group.label">
            <p class="mb-1 text-xs font-semibold text-muted-foreground">{{ group.label }}</p>
            <ul class="space-y-0.5">
              <li
                v-for="(item, index) in group.items"
                :key="index"
                class="break-words text-sm"
                data-budget-optimizer-skipped-row
              >
                {{ effectText(item.effect) }}
                <p
                  v-if="skippedUnpricedMaterials(item).length > 0"
                  class="mt-0.5 text-xs text-muted-foreground"
                  data-budget-optimizer-skipped-unpriced-materials
                >
                  {{ skippedMaterialsText(item) }}
                </p>
                <p
                  v-if="skippedReasonText(item)"
                  class="mt-0.5 text-xs text-muted-foreground"
                  data-budget-optimizer-skipped-reason
                >
                  {{ skippedReasonText(item) }}
                </p>
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground">{{ t('common:budgetOptimizer.skippedDetailsEmpty') }}</p>
        <p
          v-if="skippedFairValueBelowSale > 0"
          class="mt-2 text-xs text-muted-foreground"
          data-budget-optimizer-skipped-fair-value
        >
          {{
            t('common:budgetOptimizer.skippedFairValueBelowSale', '', {
              count: number(skippedFairValueBelowSale, 0),
            })
          }}
        </p>
        <p
          v-if="skippedDetailsTruncated > 0"
          class="mt-2 text-xs text-muted-foreground"
          data-budget-optimizer-skipped-truncated
        >
          {{
            t('common:budgetOptimizer.skippedDetailsTruncated', '', {
              count: number(skippedDetailsTruncated, 0),
            })
          }}
        </p>
      </div>
    </BaseModal>
  </section>
</template>

<script setup>
// 预算优化页（升级链模式 v4）：只消费 store（startBudgetOptimizer / revertBudgetOptimizerChanges 等），
// 不直接触达搜索层。
// 链步骤渐进上屏：运行中读 runtime.chainSteps（onStep 逐条 push），结束后读 results.steps。
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowRight, Play, Settings2, Square, TrendingUp, Undo2, Wallet } from '@lucide/vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { budgetOptimizerBusy } from '../../stores/simulatorBudgetOptimizerActions.js';
import {
  BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
  BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
  BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_OBJECTIVE_DPS,
  BUDGET_OPTIMIZER_OBJECTIVE_PROFIT,
  BUDGET_OPTIMIZER_OBJECTIVE_XP,
  BUDGET_OPTIMIZER_PRESET_FAST,
  BUDGET_OPTIMIZER_PRESET_FINE,
  BUDGET_OPTIMIZER_PRESET_STANDARD,
  BUDGET_OPTIMIZER_SKIP_REASON_FAIR_VALUE_BELOW_SALE,
  BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
  BUDGET_OPTIMIZER_STEP_LIMIT_PRESETS,
  isValidBudgetOptimizerSettings,
  resolveBudgetHigh,
  resolveBudgetObjectiveMetricKey,
} from '../../services/budgetOptimizerDomain.js';
import {
  BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE,
  BUDGET_OPTIMIZER_STOP_CANCELLED,
  BUDGET_OPTIMIZER_STOP_EXHAUSTED,
  BUDGET_OPTIMIZER_STOP_SIGNIFICANCE,
  BUDGET_OPTIMIZER_STOP_STEP_LIMIT,
  resolveBudgetEvidenceBand,
} from '../../services/budgetOptimizerSearch.js';
import { RUN_SCOPE_SINGLE } from '../../services/simulationDomain.js';
import { formatCompactAmountForLocale } from '../../services/amountFormatting.js';
import { Button } from '../components/ui/button/index.js';
import BaseModal from '../components/BaseModal.vue';
import { useI18nText } from '../composables/useI18nText.js';
import { useGameDataText } from '../composables/useGameDataText.js';

const simulator = useSimulatorStore();
const { t, language } = useI18nText();
const { getActionName, getAbilityName, getEquipmentSlotName, getHouseRoomName, getItemName, getMonsterName } =
  useGameDataText();

const OBJECTIVE_DPS = BUDGET_OPTIMIZER_OBJECTIVE_DPS;
const OBJECTIVE_PROFIT = BUDGET_OPTIMIZER_OBJECTIVE_PROFIT;
const OBJECTIVE_XP = BUDGET_OPTIMIZER_OBJECTIVE_XP;
// 目标 → 文案键（下拉选项与动态标题共用）。
const OBJECTIVE_TITLE_KEYS = {
  [OBJECTIVE_DPS]: 'common:budgetOptimizer.objectives.dps',
  [OBJECTIVE_PROFIT]: 'common:budgetOptimizer.objectives.profit',
  [OBJECTIVE_XP]: 'common:budgetOptimizer.objectives.xp',
};
const PRESET_FAST = BUDGET_OPTIMIZER_PRESET_FAST;
const PRESET_FINE = BUDGET_OPTIMIZER_PRESET_FINE;
const PRESET_STANDARD = BUDGET_OPTIMIZER_PRESET_STANDARD;
const MIN_SIMULATION_HOURS = BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS;
const MAX_SIMULATION_HOURS = BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS;
const MIN_MAX_LEVEL_UP = BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP;
const MAX_MAX_LEVEL_UP = BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP;
// 模拟步数：下拉选项 = 用完预算（unlimited）/ 快捷预设 5/10/15（preset）/ 自定义（custom）；
// 三态分开存储，否则步数恰为预设值时「自定义」会被预设项遮蔽（选中后显示弹回、输入框出不来）。
const STEP_LIMIT_UNLIMITED = BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED;
const STEP_LIMIT_PRESET = BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET;
const STEP_LIMIT_CUSTOM = BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM;
const STEP_LIMIT_PRESETS = BUDGET_OPTIMIZER_STEP_LIMIT_PRESETS;
const MIN_CHAIN_STEPS = BUDGET_OPTIMIZER_MIN_CHAIN_STEPS;
const MAX_CHAIN_STEPS = BUDGET_OPTIMIZER_MAX_CHAIN_STEPS;

const settings = computed(() => simulator.budgetOptimizer.settings);
const runtime = computed(() => simulator.budgetOptimizer.runtime);
const results = computed(() => simulator.budgetOptimizer.results);
const running = computed(() => runtime.value.isRunning);
const busy = computed(() => budgetOptimizerBusy(simulator));
// 报告过期由 store 的指纹 getter 判定（与撤销的拒绝口径同源）。
const stale = computed(() => simulator.budgetOptimizerReportStale);
const imported = computed(() => simulator.queue?.importedProfileByPlayer?.[simulator.activePlayerId] === true);
const hasResults = computed(() => Boolean(results.value?.createdAt));
// 停止收尾窗口（语义性判断）：isRunning 已置假、取消报告尚未回填 —— 服务在途标志覆盖这段
//（见 store 的 runtime.serviceRunInFlight 说明）。期间本页自己的收尾不算「被其他任务占用」。
const stopping = computed(() => !running.value && !hasResults.value && Boolean(runtime.value.serviceRunInFlight));
// 数据源判据（2026-10-09 修复）：无报告时读 runtime（onStep 渐进 push 的 runtime.chainSteps），
// 有报告时读 results.steps（同源同构：报告里的 steps 就是逐条上报的那些 stepRecord）。
// 取「无报告」而不是「运行中」：停止收尾窗口与「迟到结果被 runId 闸门丢弃」的残留期都没有报告，
// 但 runtime.chainSteps 里已模拟完的步骤照样该上屏 —— 否则进度区与结果区整段空白。
// reset（导入新存档 / 恢复快照）例外：它把 phase 复位成 idle 并清掉报告，此刻 runtime.chainSteps
// 是上一份存档的残留，必须当作无内容（phase 非 idle 才认本次会话的链痕迹）。
const liveView = computed(() => !hasResults.value && String(runtime.value.phase || 'idle') !== 'idle');
const chainSteps = computed(() =>
  liveView.value
    ? Array.isArray(runtime.value.chainSteps)
      ? runtime.value.chainSteps
      : []
    : Array.isArray(results.value?.steps)
      ? results.value.steps
      : [],
);
// 汇总字段：无报告时用运行态累计（chainSteps 累加，覆盖运行中 / 收尾窗口 / 残留期），有报告读报告。
const totalCost = computed(() =>
  liveView.value
    ? chainSteps.value.reduce((sum, step) => sum + (Number(step.cost) || 0), 0)
    : Number(results.value?.totalCost) || 0,
);
const remainingBudget = computed(() =>
  liveView.value
    ? chainSteps.value.length > 0
      ? Number(chainSteps.value[chainSteps.value.length - 1].remainingBudgetAfter) || 0
      : resolveBudgetHigh(settings.value)
    : Number(results.value?.remainingBudget) || 0,
);
// 预算使用占比（汇总卡占比条）：总花费 /（总花费 + 剩余额度）；双边缺值时按 0%，不画假进度。
const budgetUsedPercent = computed(() => {
  const used = Math.max(0, Number(totalCost.value) || 0);
  const remaining = Math.max(0, Number(remainingBudget.value) || 0);
  const total = used + remaining;
  if (!(total > 0)) return 0;
  return Math.min(100, (used / total) * 100);
});
const skippedNoPrice = computed(() => Number(results.value?.diagnostics?.skippedNoPrice) || 0);
// 估值救回计数：买入侧缺价但按 MWITools 装备价值口径估值参与搜索的候选数
//（旧报告无该字段 → 0，不显示）。
const fallbackFairValue = computed(() => Number(results.value?.diagnostics?.fallbackFairValue) || 0);
// 缺价候选明细（diagnostics.skippedNoPriceDetails，结构化 effect）：展示名按当前语言现场解析，
// 不消费 domain 固化的 label —— 与候选明细表的本地化口径一致。
const skippedDetails = computed(() =>
  Array.isArray(results.value?.diagnostics?.skippedNoPriceDetails)
    ? results.value.diagnostics.skippedNoPriceDetails
    : [],
);
// 缺价明细超上限被截掉的条数（旧报告无该字段 → 0，不显示提示）。
const skippedDetailsTruncated = computed(() => Number(results.value?.diagnostics?.skippedNoPriceDetailsTruncated) || 0);
// 「估值不足」跳过计数（diagnostics.skippedFairValueBelowSale，skippedNoPrice 的子集：估值可得但
// 估值 ≤ 旧件卖出抵扣）；旧报告无该字段 → 0，不显示提示（与 fallbackFairValue 同款回退）。
const skippedFairValueBelowSale = computed(() => Number(results.value?.diagnostics?.skippedFairValueBelowSale) || 0);
const skippedOpen = ref(false);
// 弹窗列表按槽位 / 技能 / 房间分组（组名同样现场解析，解析不出时回退 hrid 本身）。
const skippedGroups = computed(() => {
  const map = new Map();
  for (const item of skippedDetails.value) {
    const label = skippedGroupLabel(item);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(item);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
});
function skippedGroupLabel(item) {
  const effect = item?.effect;
  const type = String(effect?.type || '');
  if (type === 'equipment') return getEquipmentSlotName(String(effect?.slotKey || ''), effect?.slotKey || '');
  if (type === 'ability') return getAbilityName(String(effect?.abilityHrid || ''), effect?.abilityHrid || '');
  if (type === 'house') return getHouseRoomName(String(effect?.roomHrid || ''), effect?.roomHrid || '');
  return '';
}
// 房子缺价明细（diagnostics.skippedNoPriceDetails[].unpricedMaterials，缺价材料 hrid 数组）：
// 仅 house 条目带该字段时在缺价弹窗渲染材料行；旧报告无该字段时不渲染（向后兼容）。
function skippedUnpricedMaterials(item) {
  if (item?.kind !== 'house' || !Array.isArray(item.unpricedMaterials)) return [];
  return item.unpricedMaterials;
}
// 材料行文本：标签 + 现场解析的材料名（解析不出回退 hrid 本身，与分组名同口径）；分隔符随语言。
function skippedMaterialsText(item) {
  const separator = language.value === 'zh' ? '、' : ', ';
  const materials = skippedUnpricedMaterials(item)
    .map((hrid) => getItemName(String(hrid || ''), String(hrid || '')))
    .join(separator);
  return t('common:budgetOptimizer.skippedUnpricedMaterials', '', { materials });
}
// 明细条目的原因行（domain 结构化 token）：只有「估值不足以支撑正净支出」这一非默认原因携带
// reason；完全缺价条目 / 旧报告条目没有该字段 → 返回空串不渲染（与 unpricedMaterials 同款
// 「字段存在才渲染」模式，向后兼容）。
function skippedReasonText(item) {
  if (String(item?.reason || '') !== BUDGET_OPTIMIZER_SKIP_REASON_FAIR_VALUE_BELOW_SALE) return '';
  return t('common:budgetOptimizer.skippedReasonFairValueBelowSale');
}
// 「已应用」= 有应用时刻的输入指纹（撤销/换输入会清空，与触发优化器同款语义）。
const applied = computed(() => Boolean(results.value?.appliedInputSignature));
// 撤销栈：链 = 一条快照（整链一次回退到链起点）；跨链保留（用户可连跑多条链再逐条撤销）。
const appliedSteps = computed(() => simulator.budgetOptimizer.baselineSnapshots.length);
const hasAppliedSnapshot = computed(() => appliedSteps.value > 0);
const canRevert = computed(() => !running.value && !busy.value && hasAppliedSnapshot.value);
const lastAction = ref('');

const activePlayerName = computed(() => String(simulator.activePlayer?.name || ''));

// ── 只读上下文：目标场景（主页设置）──────────────────────────────────
const targetHrid = computed(() => {
  const simulation = simulator.simulationSettings;
  return simulation.useDungeon ? simulation.dungeonHrid : simulation.zoneHrid;
});
const targetName = computed(() => {
  const simulation = simulator.simulationSettings;
  if (simulation.mode === 'labyrinth') return getMonsterName(simulation.labyrinthHrid);
  return getActionName(targetHrid.value);
});
const difficultyText = computed(
  () => `${t('common:budgetOptimizer.tier')} ${simulator.simulationSettings.difficultyTier ?? 0}`,
);

// 开局阻断原因（与 store 的 start 校验矩阵同序）：本地先给出可读提示，真正拦截仍在 store。
const blockReason = computed(() => {
  if (simulator.simulationSettings.mode === 'labyrinth') return 'common:budgetOptimizer.labyrinthUnsupported';
  if (!imported.value) return 'common:budgetOptimizer.requireImport';
  if (simulator.simulationSettings.runScope !== RUN_SCOPE_SINGLE) return 'common:budgetOptimizer.requireSingle';
  if (!targetHrid.value) return 'common:budgetOptimizer.requireZone';
  // 自身运行期间不显示「被占用」提示（此时按钮本来就是「停止」）；停止后的收尾窗口也是自家收尾
  //（stopping），同样不该说成「被其他任务占用」——误报修正（2026-10-09）。
  if (!running.value && busy.value && !stopping.value) return 'common:budgetOptimizer.busy';
  return '';
});
// runtime.error 与 blockReason 同源时不再重复显示（提示已在阻断行给出）。
const errorText = computed(() => {
  const error = runtime.value.error || '';
  return error && error === blockReason.value ? '' : error;
});

// ── 预算 / 区间 ───────────────────────────────────────────────────────
const budgetCoins = computed(() => Number(settings.value.budgetCoins) || 0);
const bandLow = computed(() => Math.max(0, budgetCoins.value * (1 - (Number(settings.value.bandRatio) || 0))));
// 上限复用 domain 的同口径函数（clamp 缺省与归一化一致），不重算一份公式。
const bandHigh = computed(() => resolveBudgetHigh(settings.value));

const number = (value, digits = 2) =>
  Number(value || 0).toLocaleString(language.value, { maximumFractionDigits: digits });
// 金额格式化复用项目工具（紧凑 k/m/b；与队列 / 强化页同一实现，不手搓分叉）。
const coins = (value) => formatCompactAmountForLocale(Number(value) || 0, language.value);
const bandText = computed(() => `${coins(bandLow.value)} ~ ${coins(bandHigh.value)}`);
const bandHighText = computed(() => t('common:budgetOptimizer.bandHighLabel', '', { value: coins(bandHigh.value) }));

// ── 设置草稿（照触发优化器）：输入即提交，非法值只留在草稿里并禁用开始 ──
function formatBudgetDraft(value) {
  const millions = Number(value) / 1_000_000;
  return Number.isFinite(millions) ? String(millions) : '';
}
const budgetDraft = ref(formatBudgetDraft(settings.value.budgetCoins));
const hoursDraft = ref(String(settings.value.simulationHours));
const maxLevelUpDraft = ref(String(settings.value.maxLevelUp));
const maxChainStepsDraft = ref(String(settings.value.maxChainSteps));

// 外部（其它页面动作 / 报告恢复）改了设置时回写草稿；deep watch 保证落盘归一化后的值上屏。
watch(
  () => simulator.budgetOptimizer.settings,
  (value) => {
    budgetDraft.value = formatBudgetDraft(value.budgetCoins);
    hoursDraft.value = String(value.simulationHours);
    maxLevelUpDraft.value = String(value.maxLevelUp);
    maxChainStepsDraft.value = String(value.maxChainSteps);
  },
  { deep: true },
);

const draftCoins = computed(() => {
  const raw = budgetDraft.value;
  if (raw === '' || !Number.isFinite(Number(raw))) return 0;
  return Number(raw) * 1_000_000;
});
// 草稿有效性与 store 的校验同源（isValidBudgetOptimizerSettings）：非法时禁用开始，
// 不让「按了开始才发现无效」发生。
const validDraft = computed(() =>
  isValidBudgetOptimizerSettings({
    ...settings.value,
    budgetCoins: draftCoins.value,
    simulationHours: Number(hoursDraft.value),
    maxLevelUp: Number(maxLevelUpDraft.value),
    maxChainSteps: Number(maxChainStepsDraft.value),
  }),
);
// 追加 !busy：停止后的收尾窗口里 blockReason 不再出声（见上），但按钮必须仍然不可点 ——
// 与 store 的 start 闸门（busy 拒绝）保持一致，避免「按钮可点却被拒绝、同一条文案以 errorText 复现」。
const canStart = computed(() => !running.value && !blockReason.value && !busy.value && validDraft.value);

// 空字符串与非法值不提交：提交空值会被 store 的归一化当成缺省覆盖掉原值（假控件）。
function commitBudget(raw) {
  if (raw === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return;
  simulator.setBudgetOptimizerSettings({ budgetCoins: value * 1_000_000 });
}
function commitNumber(key, raw) {
  if (raw === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  simulator.setBudgetOptimizerSettings({ [key]: value });
}
function commitToggle(key, checked) {
  simulator.setBudgetOptimizerSettings({ [key]: checked === true });
}
function commitPreset(value) {
  // 档位白名单：新增档位时与下拉选项（模板）一起同步，否则选择会被静默忽略。
  if (value !== PRESET_FAST && value !== PRESET_STANDARD && value !== PRESET_FINE) return;
  simulator.setBudgetOptimizerSettings({ searchPreset: value });
}
function commitObjective(value) {
  if (value !== OBJECTIVE_DPS && value !== OBJECTIVE_PROFIT && value !== OBJECTIVE_XP) return;
  simulator.setBudgetOptimizerSettings({ objective: value });
}

// 模拟步数：预设 5/10/15 落 preset 模式 + 对应步数；「自定义」切 custom（沿用当前步数，
// 交由旁边的数字输入框编辑）；「用完预算」切回 unlimited（步数上限 = 安全阀，maxChainSteps 保留）。
const stepLimitSelectValue = computed(() => {
  const mode = settings.value.stepLimitMode;
  if (mode === STEP_LIMIT_CUSTOM) return STEP_LIMIT_CUSTOM;
  if (mode === STEP_LIMIT_PRESET) return String(Number(settings.value.maxChainSteps));
  return STEP_LIMIT_UNLIMITED;
});
const isCustomStepLimit = computed(() => stepLimitSelectValue.value === STEP_LIMIT_CUSTOM);
function commitStepLimit(value) {
  if (value === STEP_LIMIT_UNLIMITED || value === STEP_LIMIT_CUSTOM) {
    simulator.setBudgetOptimizerSettings({ stepLimitMode: value });
    return;
  }
  const count = Number(value);
  if (!Number.isInteger(count)) return;
  simulator.setBudgetOptimizerSettings({ stepLimitMode: STEP_LIMIT_PRESET, maxChainSteps: count });
}

// ── 队友勾选：写进设置（进输入指纹，换队友会让既有报告过期）──────────
// 候选 = 除主角外**已导入**的玩家槽位（防幽灵队友）：players 2-5 常驻但默认空配置，
// 未导入槽位既无数据也永远不会进整队载荷 —— 列出来只会让用户勾到永远无效的假队友。
const partyCandidates = computed(() =>
  (simulator.players || [])
    .filter((player) => String(player.id ?? '') !== String(simulator.activePlayerId ?? ''))
    .filter((player) => simulator.queue?.importedProfileByPlayer?.[String(player.id ?? '')] === true)
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
  simulator.setBudgetOptimizerPartyPlayers(next);
}

// ── 进度区 ───────────────────────────────────────────────────────────
// 收尾相位回填（照触发优化器）：运行结束（含刷新重进，runtime.phase 回 idle）后，
// 相位改由报告收尾状态推导，避免「阶段行说未开始、旁边却是报告真实计数」的矛盾。
const phaseKey = computed(() => {
  if (running.value || !hasResults.value) return runtime.value.phase || 'idle';
  if (results.value?.cancelled) return 'cancelled';
  if (results.value?.error) return 'error';
  return 'done';
});
// 进度读数（收尾窗口 / 残留期同样按 runtime 口径）：运行中取实时进度；停止时 store 保留读数
//（不再置 0），条停在停止瞬间；有报告时以 1 收尾。取值口径不变，仍保留原 clamp。
const progressValue = computed(() =>
  liveView.value ? Math.min(1, Math.max(0, Number(runtime.value.progress) || 0)) : hasResults.value ? 1 : 0,
);
// 已用时间：runtime.elapsedSeconds 只在服务在途时被 onProgress 与收尾写值（本页无计时器），
// 非运行态读它即天然冻结在最后一次上报值；报告回填后改读报告值。
const liveElapsedSeconds = computed(() =>
  liveView.value ? Number(runtime.value.elapsedSeconds) || 0 : Number(results.value?.elapsedSeconds) || 0,
);

// ── 结果格式化：Δ目标指标一律换算为「相对基线的百分比」（基线绝对值另行上屏）──
// 运行中无报告时按设置口径显示（运行中设置被禁用且 store 拒改，即本次运行口径）。
const objective = computed(() => String(results.value?.objective || settings.value?.objective || OBJECTIVE_DPS));
const objectiveMetricKey = computed(() => resolveBudgetObjectiveMetricKey(objective.value));
const objectiveTitle = computed(() => t(OBJECTIVE_TITLE_KEYS[objective.value] || OBJECTIVE_TITLE_KEYS[OBJECTIVE_DPS]));
// 链起点基线最终不可用（报告 diagnostics.baselineFailed；旧报告无该字段 → false）：
// 此时报告基线停在 failed 的 0 值，不是真实测量 —— 界面显示占位符，并把零步链的文案分流。
const baselineFailed = computed(() => !running.value && results.value?.diagnostics?.baselineFailed === true);
// 基线原始值（目标指标；链起点 = 报告 baseline，运行中 / 基线失败时显示 —）。
const baselineRaw = computed(() => {
  if (running.value || baselineFailed.value) return null;
  const value = Number(results.value?.baseline?.metrics?.[objectiveMetricKey.value]);
  return Number.isFinite(value) ? value : null;
});
// 百分比换算要求基线为正：0 / 缺失时百分比无定义（显示 —）。
const baselineMetric = computed(() =>
  Number.isFinite(baselineRaw.value) && baselineRaw.value > 0 ? baselineRaw.value : null,
);
const baselineValueText = computed(() => (baselineRaw.value == null ? '—' : coins(baselineRaw.value)));
function deltaToPercent(value) {
  if (!baselineMetric.value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return (numeric / baselineMetric.value) * 100;
}
// Δ 百分比显示（2026-10-09：统一两位小数——小提升不再被四舍五入成「+0.0%」而显得像零提升，
// 如真实 +0.021% 显示 +0.02%）。真实非零但小于半个最小刻度（0.005）时显示「<0.01%」，
// 避免再次出现「0.00% 却买了」的观感。
function percentText(value) {
  // null / 缺失（如运行中还没有链起点基线）显示占位符，而不是被 Number(null) 折成 0.0%。
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const abs = Math.abs(numeric);
  if (abs > 0 && abs < 0.005) return `${numeric > 0 ? '+' : '-'}<0.01%`;
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}
function deltaTextClass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return 'text-muted-foreground';
  return numeric > 0 ? 'text-success' : 'text-destructive';
}
// KPI 主视觉的 Δ 胶囊：与 deltaTextClass 同向（正绿 / 负红 / 零灰），但带上底色，让「链净收益」
// 成为整页最重的一个视觉锚点；胶囊只在 Δ 非 0 时渲染（零增量本来就隐藏）。
function deltaPillClass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return 'bg-muted text-muted-foreground';
  return numeric > 0 ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive';
}

// 单项性价比：Δ目标% / (花费 / 1B) = 每 1B 花费换来的目标提升百分比（与搜索层定选的
// 效率口径同源：Δ目标指标 / 成本，这里只做单位换算）。
function candidateEfficiencyText(candidate) {
  const cost = Number(candidate?.cost);
  const delta = candidateDeltaOf(candidate);
  // 免费项（成本 ≤ 0 且提升为正）：分母无定义 —— 按语义显示「免费」而不是「—」
  //（「—」与「无数据」混淆，曾把这类候选误读成不可用）。
  if (Number.isFinite(cost) && cost <= 0 && Number.isFinite(delta) && delta > 0) {
    return t('common:budgetOptimizer.costFree');
  }
  const percent = deltaToPercent(delta);
  if (percent == null || !(cost > 0)) return '—';
  return `${(percent / (cost / 1_000_000_000)).toFixed(1)}%/B`;
}

// 候选/步骤的目标增量：优先泛化名，回退旧兼容名。
function candidateDeltaOf(candidate) {
  return Number(candidate?.deltaObjective ?? candidate?.deltaDps);
}
function stepDeltaOf(step) {
  return Number(step?.deltaObjective ?? step?.deltaDps);
}

// 链总提升：各步 Δ 相对链起点基线的百分比之和（每步 Δ 的基线是「上一步之后」的配置，
// 逐步累加即链累计；百分比换算仍用链起点基线 —— 每步绝对增量 / 起点基线，可加）。
const chainTotalDelta = computed(() => chainSteps.value.reduce((sum, step) => sum + (stepDeltaOf(step) || 0), 0));

// 优化后的目标指标绝对值（推算口径）：链起点基线 + 链上各步 Δ 绝对增量之和。每步 Δ 的配对
// 基线是「上一步之后」的配置，绝对增量可直接累加（分母统一为链起点基线，只有换算百分比时
// 才做除法）；Δ 缺失的步骤按 0 计（与 chainTotalDelta 同口径），无基线（运行中 / 基线失败）
// 时无法推算 → 显示占位符，不给出误导数值。
// 每步 Δ 的保守口径：mean − 1×se。选中候选的自评均值有系统性乐观偏差（赢者诅咒，期望
// 高估约 1 个标准误量级），运行中渐进累计与回退主口径按保守口径累加 —— 目标是「不高估」，
// 尽量贴近链终配对复验的真值。se 缺失（单样本 / 退化）时退回 mean 原值。
function stepConservativeDelta(step) {
  const mean = Number(step?.deltaObjective ?? step?.deltaDps);
  if (!Number.isFinite(mean)) return 0;
  const se = Number(step?.se);
  return Number.isFinite(se) ? mean - se : mean;
}
const chainConservativeDelta = computed(() =>
  chainSteps.value.reduce((sum, step) => sum + stepConservativeDelta(step), 0),
);
// 账面推算（乐观口径）：链起点基线 + 各步自评 Δ 之和。仅作对照 —— 它与复验 Δ 的差就是
// 这条链的纸面增益（赢者诅咒 + 步间噪声累加的幅度）。
const finalObjectiveValue = computed(() => {
  const baseline = baselineRaw.value;
  if (!Number.isFinite(baseline)) return null;
  const value = baseline + chainTotalDelta.value;
  return Number.isFinite(value) ? value : null;
});
// 保守推算的绝对值：链起点基线 + 保守累计（运行中渐进与无复验时的主口径）。
const conservativeObjectiveValue = computed(() => {
  const baseline = baselineRaw.value;
  if (!Number.isFinite(baseline)) return null;
  const value = baseline + chainConservativeDelta.value;
  return Number.isFinite(value) ? value : null;
});
const finalValueText = computed(() => (finalObjectiveValue.value == null ? '—' : coins(finalObjectiveValue.value)));

// 链终复验（报告 verification，可选字段）：链起点与链终点在同一批独立种子下的配对测量。
// 形状 v4.1.1：{ rounds, baseline, final, paired }；兼容 v4.1 过渡形状 { metrics, deltaVsBaseline }。
// 缺失（旧报告 / 取消 / 零步链 / 复验失败）时各值回退 null，结果条隐藏复验块、只显示推算口径。
const verificationShape = computed(() => (running.value ? null : (results.value?.verification ?? null)));
// 终点复验值：优先新形状 final.metrics（failed 结构按缺失处理），回退旧形状 metrics。
const verificationFinalRaw = computed(() => {
  const shape = verificationShape.value;
  const metrics = shape?.final?.metrics ?? shape?.metrics ?? null;
  if (!metrics || metrics.failed === true) return null;
  const value = Number(metrics[objectiveMetricKey.value]);
  return Number.isFinite(value) ? value : null;
});
// 起点复验值（新形状才有；旧形状的链起点仍是搜索期小样本基线，不冒充复验值）。
const verificationBaselineRaw = computed(() => {
  const shape = verificationShape.value;
  const metrics = shape?.baseline?.metrics ?? null;
  if (!metrics || metrics.failed === true) return null;
  const value = Number(metrics[objectiveMetricKey.value]);
  return Number.isFinite(value) ? value : null;
});
// 复验 Δ：优先配对差均值（同种子逐场差分，无偏）；配对缺失时回退两复验值之差，
// 旧形状（v4.1 过渡）再回退其 deltaVsBaseline 字段。
const verificationDelta = computed(() => {
  if (verificationFinalRaw.value == null) return null;
  const pairedMean = Number(verificationShape.value?.paired?.mean);
  if (Number.isFinite(pairedMean)) return pairedMean;
  if (verificationBaselineRaw.value != null) return verificationFinalRaw.value - verificationBaselineRaw.value;
  const legacy = Number(verificationShape.value?.deltaVsBaseline);
  return Number.isFinite(legacy) ? legacy : null;
});
// ── 优化后主口径：优先配对复验（无偏真值），无复验回退保守推算（mean − 1×se 累加，
// 不高估）；账面乐观原值只在「账面」对照里出现 ──
const optimizedVerified = computed(() => verificationFinalRaw.value != null);
const optimizedValueText = computed(() =>
  optimizedVerified.value
    ? coins(verificationFinalRaw.value)
    : conservativeObjectiveValue.value == null
      ? '—'
      : coins(conservativeObjectiveValue.value),
);
const optimizedDelta = computed(() =>
  optimizedVerified.value ? verificationDelta.value : chainConservativeDelta.value,
);
const optimizedDeltaText = computed(() => {
  // 主口径值不可用（运行中无基线 → '—'）时 Δ 一并隐藏：值与 Δ 同进退，不出现「值 — 但 Δ +N」。
  const hasValue = optimizedVerified.value || conservativeObjectiveValue.value != null;
  if (!hasValue) return '';
  const delta = optimizedDelta.value;
  if (!Number.isFinite(delta) || delta === 0) return '';
  return `${delta > 0 ? '+' : '-'}${coins(Math.abs(delta))}`;
});
const optimizedLabelKey = computed(() =>
  optimizedVerified.value ? 'common:budgetOptimizer.optimizedLabel' : 'common:budgetOptimizer.finalLabel',
);
// 推算对照（有复验时才展示）：账面推算值与它的 Δ —— 各步选中者自评累加，天然乐观；
// 它与复验 Δ 的差就是这条链的纸面增益幅度。
const ledgerValueText = computed(() => finalValueText.value);
const ledgerDeltaText = computed(() => finalDeltaText.value);
const verificationRounds = computed(() => {
  const shape = verificationShape.value;
  return Number(shape?.rounds ?? shape?.metrics?.rounds) || 0;
});
// 相对链起点的绝对增量徽标：Δ 为 0（零步链 / 无有效增量）时不显示；符号手拼（紧凑格式化
// 工具的负数口径只保证可读，不保证带显式 +）。
const finalDeltaText = computed(() => {
  if (finalObjectiveValue.value == null) return '';
  const delta = chainTotalDelta.value;
  if (!Number.isFinite(delta) || delta === 0) return '';
  return `${delta > 0 ? '+' : '-'}${coins(Math.abs(delta))}`;
});

// 终止原因文案。
const STOP_REASON_KEYS = {
  [BUDGET_OPTIMIZER_STOP_EXHAUSTED]: 'common:budgetOptimizer.stopReasonExhausted',
  [BUDGET_OPTIMIZER_STOP_SIGNIFICANCE]: 'common:budgetOptimizer.stopReasonSignificance',
  [BUDGET_OPTIMIZER_STOP_STEP_LIMIT]: 'common:budgetOptimizer.stopReasonStepLimit',
  [BUDGET_OPTIMIZER_STOP_CANCELLED]: 'common:budgetOptimizer.stopReasonCancelled',
};
const stopReasonText = computed(() => {
  if (running.value) return '';
  // 零步链且链起点基线不可用：给「基线失败」的说明，不复用「无可买项」的误导口径。
  if (baselineFailed.value && !chainSteps.value.length) {
    return t('common:budgetOptimizer.stopReasonBaselineFailed');
  }
  const reason = String(results.value?.stopReason || '');
  return reason ? t(STOP_REASON_KEYS[reason] || 'common:budgetOptimizer.stopReasonExhausted') : '';
});
// 零步链空态文案：基线失败时给失败口径（与停因文案互补，不复用「无可买项」措辞）。
const chainEmptyText = computed(() =>
  baselineFailed.value ? t('common:budgetOptimizer.chainEmptyBaselineFailed') : t('common:budgetOptimizer.chainEmpty'),
);

// ── 步骤列表 ─────────────────────────────────────────────────────────
const displaySteps = chainSteps;
// 运行中最新一步 = runtime.stepsDone（含进行中的一步？不含——stepsDone 只在步骤完成时更新，
// 最后一条已完成步骤高亮即可；进行中的一步没有记录，进度条已表达）。
function isRunningStep(index) {
  return running.value && index === chainSteps.value.length - 1;
}
// 强调色按步骤序号轮转调色板，只落在徽章前的 6px 色点上 —— 只做识别标记、不承载语义；
// 格子本身不铺底色（铺一片淡染在多步并排时显得花哨，2026-10-08 用户反馈后收敛）。
const STEP_ACCENT_PALETTE = [
  '#14b8a6',
  '#f59e0b',
  '#60a5fa',
  '#f472b6',
  '#a78bfa',
  '#34d399',
  '#fb923c',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
];
function stepAccentColor(index) {
  return STEP_ACCENT_PALETTE[Number(index) % STEP_ACCENT_PALETTE.length];
}
// 候选明细弹窗：点卡片按钮打开（一次一步）；按步骤 index 定位该步记录 —— 链结束切换数据源
//（runtime.chainSteps → results.steps，两者同构同 index）时弹窗内容照常命中，无需关闭。
const candidatesStepIndex = ref(null);
const candidatesStep = computed(() =>
  candidatesStepIndex.value == null
    ? null
    : chainSteps.value.find((step) => step.index === candidatesStepIndex.value) || null,
);
const candidatesTitle = computed(() =>
  candidatesStepIndex.value == null
    ? ''
    : t('common:budgetOptimizer.stepCandidatesTitle', '', { index: number(candidatesStepIndex.value + 1, 0) }),
);
function openStepCandidates(index) {
  candidatesStepIndex.value = index;
}
// 开新链时关闭上一链的弹窗，避免旧步骤快照串进新一轮。
watch(running, (value) => {
  if (value) candidatesStepIndex.value = null;
});

// 步骤候选明细（快照已按证据分档 + 性价比排好序，直接展示）。
// 展示条数与搜索层快照上限共用同一常量：旧报告的快照可能仍带更多条（上限调小前跑的链），
// UI 侧同样只取头部，弹窗行数不随历史数据回涨。
// 选定项保底：排序按性价比、不区分买得起与否，选定项理论上可能排在展示上限之外；此时用末位
// 替换把它放进来，否则弹窗里看不到「已选定」那一行。
function stepCandidatesOf(step) {
  const list = Array.isArray(step?.candidatesSnapshot?.candidates) ? step.candidatesSnapshot.candidates : [];
  const shown = list.slice(0, BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT);
  const chosenId = step?.candidate?.id;
  if (chosenId && shown.length > 0 && !shown.some((candidate) => candidate.id === chosenId)) {
    const chosen = list.find((candidate) => candidate.id === chosenId);
    if (chosen) shown[shown.length - 1] = chosen;
  }
  return shown;
}
// 未展示条数 = 快照 total − 实际展示数；旧报告缺 total 时退回快照自带 truncated 计数 + UI 截掉的部分。
function stepCandidatesTruncatedOf(step) {
  const snapshot = step?.candidatesSnapshot;
  const list = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
  const shown = stepCandidatesOf(step).length;
  const total = Number(snapshot?.total);
  if (Number.isFinite(total) && total > 0) return Math.max(0, total - shown);
  return Math.max(0, (Number(snapshot?.truncated) || 0) + list.length - shown);
}
// 档前说明行：与搜索层 resolveBudgetEvidenceBand 共享同一判定（FREE 免费项 → 0 精筛可用 →
// 1 粗筛 → 2 不可用），不再维护镜像副本。
function evidenceRankOf(candidate) {
  return resolveBudgetEvidenceBand({
    manaRegression: candidate?.manaRegression,
    // 旧报告回退旧兼容名 deltaDps（新报告两字段同值）。
    delta: candidateDeltaOf(candidate),
    cost: candidate?.cost,
    refined: candidate?.refined,
  });
}
function dividerBefore(step, candidateIndex) {
  const list = stepCandidatesOf(step);
  if (candidateIndex === 0) return evidenceRankOf(list[0]) > 0;
  return evidenceRankOf(list[candidateIndex]) !== evidenceRankOf(list[candidateIndex - 1]);
}
function dividerText(step, candidateIndex) {
  const rank = evidenceRankOf(stepCandidatesOf(step)[candidateIndex]);
  if (rank === BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE) return t('common:budgetOptimizer.bandFree');
  if (rank === 1) return t('common:budgetOptimizer.bandScreened');
  if (rank === 2) return t('common:budgetOptimizer.bandUnusable');
  return '';
}

// ── 候选展示（组名 / 变化文本）──────────────────────────────────────
function groupIdOf(candidate) {
  const groupKey = String(candidate?.groupKey || '');
  const separator = groupKey.indexOf(':');
  return separator >= 0 ? groupKey.slice(separator + 1) : '';
}
function candidateGroupLabel(candidate) {
  const kind = String(candidate?.kind || '');
  const id = groupIdOf(candidate);
  if (kind === 'equipment') return id ? getEquipmentSlotName(id) : '';
  if (kind === 'ability') return id ? getAbilityName(id) : '';
  if (kind === 'house') return id ? getHouseRoomName(id) : '';
  return id;
}
// 变化列的展示名：候选带结构化 effect / fromEffect（type + 目标 id + 等级），名称在 UI 侧
// 按当前语言解析（useGameDataText：官方语言包 → 索引英文名兜底），不在报告里固化语言字符串。
// 解析不出（缺字段 / 未知 type）时返回空串，调用方回退到报告里的 label 文本。
function effectText(effect) {
  const type = String(effect?.type || '');
  if (type === 'equipment') {
    const hrid = String(effect?.itemHrid || '');
    if (!hrid) return t('common:budgetOptimizer.slotEmpty');
    return `${getItemName(hrid, hrid)} +${Number(effect?.enhancementLevel) || 0}`;
  }
  if (type === 'ability') {
    const hrid = String(effect?.abilityHrid || '');
    if (!hrid) return '';
    return `${getAbilityName(hrid, hrid)} Lv.${Number(effect?.level) || 0}`;
  }
  if (type === 'house') {
    const hrid = String(effect?.roomHrid || '');
    if (!hrid) return '';
    const level = Number(effect?.level) || 0;
    return `${getHouseRoomName(hrid, hrid)} ${t('common:budgetOptimizer.houseLevelText', '', { level })}`;
  }
  return '';
}
function candidateChangeText(candidate) {
  const from = effectText(candidate?.fromEffect) || String(candidate?.fromLabel || '');
  const to = effectText(candidate?.effect) || String(candidate?.toLabel || candidate?.label || '');
  if (!from || !to) return to || from;
  return `${from} → ${to}`;
}

// ── 动作 ─────────────────────────────────────────────────────────────
function run() {
  lastAction.value = '';
  simulator.startBudgetOptimizer();
}
function revert() {
  if (simulator.revertBudgetOptimizerChanges()) lastAction.value = 'reverted';
}
</script>
