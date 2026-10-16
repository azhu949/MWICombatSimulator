<template>
  <section class="space-y-4" data-dungeon-calculator-page>
    <!-- 工具栏：标题 / 行情状态 / 刷新与重置 -->
    <div class="surface-panel overflow-hidden !px-4 !py-3" data-dungeon-calculator-toolbar>
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <div class="flex shrink-0 items-baseline gap-2">
              <p class="text-[10px] font-semibold uppercase text-success">
                {{ t('common:dungeonCalculator.eyebrow', 'Dungeon Ledger') }}
              </p>
              <h2 class="font-heading text-lg font-semibold text-foreground">
                {{ t('common:dungeonCalculator.title', 'Dungeon Profit Calculator') }}
              </h2>
            </div>
            <span class="hidden h-5 w-px bg-muted/40 sm:block" aria-hidden="true"></span>
            <p class="min-w-[180px] flex-1 truncate text-xs text-muted-foreground">
              D{{ dungeonSerial(calculator.config.dungeonHrid) }} · {{ selectedDungeonName }} · T{{
                calculator.config.difficultyTier
              }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2" data-dungeon-calculator-actions>
          <span class="rounded border px-2 py-1 text-[11px]" :class="priceStatusClass">{{ priceStatusText }}</span>
          <button type="button" class="button-secondary !px-3 !py-1.5" @click="resetConfig">
            {{ t('common:dungeonCalculator.reset', 'Reset') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 配置卡：模拟 / 配置项，标题与「地牢总览」同款（左上角）；宝箱钥匙 2% 回收固定按收入侧计入（2026-10-15 用户裁决：不再提供配置）；队伍人数显示在下方「地牢总览」 -->
    <div class="surface-panel space-y-3" data-dungeon-calculator-controls>
      <h3 class="font-heading text-base font-semibold text-primary">
        {{ t('common:dungeonCalculator.sectionConfig', 'Configuration') }}
      </h3>
      <div class="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5" data-dungeon-calculator-simulate>
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 space-y-0.5">
            <p class="text-[11px] font-semibold text-foreground">
              {{ t('common:dungeonCalculator.simulateTitle', 'Simulate from imported party') }}
            </p>
            <p class="text-[10px] leading-snug text-muted-foreground">
              {{
                t(
                  'common:dungeonCalculator.simulateHint',
                  'Runs a real combat simulation with the imported party across all 4 dungeons x tiers (24 h per round), then writes back the average minutes per run for each combination.',
                )
              }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <label class="flex items-center gap-1.5">
              <span class="control-label !mb-0 shrink-0">
                {{ t('common:dungeonCalculator.simulateRoundsLabel', 'Rounds') }}
              </span>
              <NumberField
                class="!w-24"
                :model-value="calculator.config.simulationRounds"
                :min="DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS"
                :max="DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS"
                :step="1"
                :disabled="calculator.simulation.isRunning"
                :aria-label="t('common:dungeonCalculator.simulateRoundsLabel', 'Rounds')"
                @update:model-value="calculator.setSimulationRounds"
              />
            </label>
            <button
              v-if="!calculator.simulation.isRunning"
              type="button"
              class="button-secondary !px-3 !py-1.5"
              :disabled="calculator.simulationPartySize === 0"
              @click="calculator.simulateRunMinutes()"
            >
              {{ t('common:dungeonCalculator.simulateRun', 'Simulate all dungeons') }}
            </button>
            <button
              v-else
              type="button"
              class="button-secondary !px-3 !py-1.5"
              @click="calculator.stopRunMinutesSimulation()"
            >
              {{ t('common:dungeonCalculator.simulateStop', 'Stop') }}
            </button>
          </div>
        </div>
        <p v-if="calculator.simulation.isRunning" class="text-[11px] text-muted-foreground">
          {{ simulationProgressText }}
        </p>
        <p v-else-if="calculator.simulation.error" class="text-[11px] text-warning">
          {{ simulationErrorText }}
        </p>
        <p v-else-if="simulationResultText" class="text-[11px]" :class="simulationResultTone">
          {{ simulationResultText }}
        </p>
        <p
          v-if="!calculator.simulation.isRunning && calculator.simulationPartySize === 0"
          class="text-[10px] text-muted-foreground"
        >
          {{
            t(
              'common:dungeonCalculator.simulateNoPlayersHint',
              'No player selected yet. Import and select players on the Home page first.',
            )
          }}
        </p>
      </div>
      <!-- 配置项：chip 式（与预算优化页同款）；暴饮之囊等级随勾选联动。 -->
      <div class="flex flex-wrap items-center gap-2" data-dungeon-calculator-switches>
        <label
          class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
          :class="calculator.config.artisanTea ? 'bg-muted font-medium' : ''"
        >
          <input
            type="checkbox"
            class="accent-primary"
            data-dungeon-calculator-artisan-tea
            :checked="calculator.config.artisanTea"
            @change="calculator.setArtisanTea($event.target.checked)"
          />
          <span>{{ t('common:dungeonCalculator.artisanTea', 'Artisan tea') }}</span>
        </label>
        <label
          class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
          :class="calculator.config.guzzlingPouch ? 'bg-muted font-medium' : ''"
        >
          <input
            type="checkbox"
            class="accent-primary"
            data-dungeon-calculator-guzzling-pouch
            :checked="calculator.config.guzzlingPouch"
            @change="calculator.setGuzzlingPouch($event.target.checked)"
          />
          <span>{{ t('common:dungeonCalculator.guzzlingPouch', 'Guzzling pouch') }}</span>
        </label>
        <label
          class="flex min-h-9 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors"
          :class="calculator.config.guzzlingPouch ? '' : 'opacity-60'"
          :title="t('common:dungeonCalculator.guzzlingLevel', 'Pouch enhancement')"
        >
          <span class="shrink-0">{{ t('common:dungeonCalculator.levelPrefix', 'Lv') }}</span>
          <NumberField
            class="!w-24"
            :model-value="calculator.config.guzzlingLevel"
            :min="0"
            :max="20"
            :step="1"
            :disabled="!calculator.config.guzzlingPouch"
            data-dungeon-calculator-guzzling-level
            :aria-label="t('common:dungeonCalculator.guzzlingLevel', 'Pouch enhancement')"
            @update:model-value="calculator.setGuzzlingLevel"
          />
        </label>
        <label
          class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
          :class="calculator.config.excludeCapeValue ? 'bg-muted font-medium' : ''"
        >
          <input
            type="checkbox"
            class="accent-primary"
            data-dungeon-calculator-exclude-cape
            :checked="calculator.config.excludeCapeValue"
            @change="calculator.setExcludeCapeValue($event.target.checked)"
          />
          <span>{{ t('common:dungeonCalculator.excludeCapeValue', 'Exclude cape profit') }}</span>
        </label>
        <label
          class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
          :class="calculator.config.excludeCowbellValue ? 'bg-muted font-medium' : ''"
        >
          <input
            type="checkbox"
            class="accent-primary"
            data-dungeon-calculator-exclude-cowbell
            :checked="calculator.config.excludeCowbellValue"
            @change="calculator.setExcludeCowbellValue($event.target.checked)"
          />
          <span>{{ t('common:dungeonCalculator.excludeCowbellValue', 'Exclude cowbell profit') }}</span>
        </label>
        <label
          class="flex min-h-9 items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors"
          :class="calculator.config.communityBuffLevel > 0 ? 'bg-muted font-medium' : ''"
        >
          <span class="shrink-0">{{
            t('common:dungeonCalculator.communityBuff', 'Community drop quantity buff')
          }}</span>
          <Select
            :model-value="calculator.config.communityBuffLevel"
            @update:model-value="calculator.setCommunityBuffLevel"
          >
            <SelectTrigger
              class="w-28"
              data-dungeon-calculator-community-buff
              :aria-label="t('common:dungeonCalculator.communityBuff', 'Community drop quantity buff')"
            />
            <SelectContent>
              <SelectItem :value="0">{{ t('common:dungeonCalculator.communityBuffOff', 'Off') }}</SelectItem>
              <SelectItem v-for="level in 20" :key="level" :value="level">
                {{ t('common:dungeonCalculator.levelPrefix', 'Lv') }} {{ level }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label
          class="flex min-h-9 items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors"
          data-dungeon-calculator-consumables
        >
          <span class="shrink-0">{{
            t('common:dungeonCalculator.dailyConsumablesCost', 'Daily food / drink cost (M)')
          }}</span>
          <Input
            type="number"
            min="0"
            step="0.1"
            class="!h-9 !w-24 text-xs"
            :value="dailyConsumablesCostInput"
            placeholder="0"
            :aria-label="t('common:dungeonCalculator.dailyConsumablesCost', 'Daily food / drink cost (M)')"
            @input="onDailyConsumablesCostInput"
          />
        </label>
      </div>
    </div>

    <!-- 地牢总览：地牢 × 档位 单表合一 —— 行点击切换组合、分钟格覆盖编辑、制 / 购 两列格内「成本 / 收益」双行（工具箱 574037 式排版）、每日产出两行与每轮死亡次数只读列；队伍人数与产物明细入口显示于此 -->
    <div class="surface-panel space-y-3" data-dungeon-calculator-overview>
      <div class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-heading text-base font-semibold text-primary">
            {{ t('common:dungeonCalculator.overviewTitle', 'Dungeon overview') }}
          </h3>
          <button
            type="button"
            class="button-secondary !px-3 !py-1.5"
            data-dungeon-calculator-open-items
            @click="itemsDialogOpen = true"
          >
            {{ t('common:dungeonCalculator.itemsTitle', 'Loot breakdown') }}
          </button>
        </div>
        <label
          class="flex w-fit items-center gap-2"
          data-dungeon-calculator-party-size
          :title="
            t(
              'common:dungeonCalculator.partySizeHint',
              'Defaults to 5 until data is imported, then follows the imported and selected party size.',
            )
          "
        >
          <span class="text-xs font-medium text-muted-foreground">{{
            t('common:dungeonCalculator.partySize', 'Party size')
          }}</span>
          <NumberField
            :model-value="calculator.config.partySize"
            :min="1"
            :max="5"
            :step="1"
            class="!w-28"
            :aria-label="t('common:dungeonCalculator.partySize', 'Party size')"
            @update:model-value="calculator.setPartySize"
          />
        </label>
        <!-- 展示层行过滤（2026-10-15 用户需求）：地下城 / 难度勾选，默认全勾；取消勾选 → 对应行不进表（纯展示过滤，不影响选中组合 / 覆盖值与模拟结果）。 -->
        <div class="flex flex-wrap items-center gap-2" data-dungeon-calculator-row-filters>
          <span class="text-xs font-medium text-muted-foreground">{{
            t('common:dungeonCalculator.rowFilterDungeonsLabel', 'Dungeons')
          }}</span>
          <label
            v-for="entry in calculator.catalog"
            :key="`dungeon-filter-${entry.actionHrid}`"
            class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
            :class="isDungeonFilterChecked(entry.actionHrid) ? 'bg-muted font-medium' : ''"
            data-dungeon-calculator-row-filter-dungeon
          >
            <input
              type="checkbox"
              class="accent-primary"
              :checked="isDungeonFilterChecked(entry.actionHrid)"
              @change="toggleDungeonFilter(entry.actionHrid, $event.target.checked)"
            />
            <span>D{{ dungeonSerial(entry.actionHrid) }} {{ getActionName(entry.actionHrid, entry.name) }}</span>
          </label>
          <span class="ml-1 text-xs font-medium text-muted-foreground">{{
            t('common:dungeonCalculator.rowFilterTiersLabel', 'Tiers')
          }}</span>
          <label
            v-for="tier in COMPARE_FILTER_TIERS"
            :key="`tier-filter-${tier}`"
            class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
            :class="isTierFilterChecked(tier) ? 'bg-muted font-medium' : ''"
            data-dungeon-calculator-row-filter-tier
          >
            <input
              type="checkbox"
              class="accent-primary"
              :checked="isTierFilterChecked(tier)"
              @change="toggleTierFilter(tier, $event.target.checked)"
            />
            <span>T{{ tier }}</span>
          </label>
        </div>
        <p class="text-xs text-muted-foreground">
          {{
            t(
              'common:dungeonCalculator.overviewHint',
              'Click a row to switch the current target; click a column header to sort; both the Craft and Buy columns use the ask buy / bid sell basis (buy at the ask price, sell at the bid price) and differ only in crafting keys from materials versus buying finished keys; the top line in each cell is the daily cost and the bottom line is the daily profit; the delta is the Craft profit minus the Buy profit; edit a minute cell to override, and clear it to fall back to the official default.',
            )
          }}
        </p>
      </div>
      <Table class="min-w-[1080px]">
        <TableHeader>
          <TableRow class="text-xs">
            <TableHead>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-left text-sm font-semibold transition hover:text-foreground"
                @click="toggleCompareSort('dungeonName')"
              >
                <span>{{ t('common:dungeonCalculator.compareDungeon', 'Dungeon') }}</span>
                <span
                  class="text-xs"
                  :class="compareSort.key === 'dungeonName' ? 'text-primary' : 'text-muted-foreground'"
                  >{{ getCompareSortIndicator('dungeonName') }}</span
                >
              </button>
            </TableHead>
            <TableHead>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-left text-sm font-semibold transition hover:text-foreground"
                @click="toggleCompareSort('difficultyTier')"
              >
                <span>{{ t('common:dungeonCalculator.compareTier', 'Tier') }}</span>
                <span
                  class="text-xs"
                  :class="compareSort.key === 'difficultyTier' ? 'text-primary' : 'text-muted-foreground'"
                  >{{ getCompareSortIndicator('difficultyTier') }}</span
                >
              </button>
            </TableHead>
            <TableHead>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-left text-sm font-semibold transition hover:text-foreground"
                @click="toggleCompareSort('runMinutes')"
              >
                <span>{{ t('common:dungeonCalculator.runMinutes', 'Minutes per run') }}</span>
                <span
                  class="text-xs"
                  :class="compareSort.key === 'runMinutes' ? 'text-primary' : 'text-muted-foreground'"
                  >{{ getCompareSortIndicator('runMinutes') }}</span
                >
              </button>
            </TableHead>
            <TableHead class="text-right">
              {{ t('common:dungeonCalculator.deathsPerRun', 'Deaths per run') }}
            </TableHead>
            <TableHead class="text-right">
              {{ t('common:dungeonCalculator.dailyOutputLabel', 'Daily output') }}
            </TableHead>
            <TableHead class="text-right">
              <button
                type="button"
                class="inline-flex items-center gap-1 text-sm font-semibold transition hover:text-foreground"
                @click="toggleCompareSort('craft')"
              >
                <span>{{ t('common:dungeonCalculator.compareBasisCraft', 'Craft (ask buy / bid sell)') }}</span>
                <span class="text-xs" :class="compareSort.key === 'craft' ? 'text-primary' : 'text-muted-foreground'">{{
                  getCompareSortIndicator('craft')
                }}</span>
              </button>
            </TableHead>
            <TableHead class="text-right">
              <button
                type="button"
                class="inline-flex items-center gap-1 text-sm font-semibold transition hover:text-foreground"
                @click="toggleCompareSort('market')"
              >
                <span>{{ t('common:dungeonCalculator.compareBasisMarket', 'Buy (ask buy / bid sell)') }}</span>
                <span
                  class="text-xs"
                  :class="compareSort.key === 'market' ? 'text-primary' : 'text-muted-foreground'"
                  >{{ getCompareSortIndicator('market') }}</span
                >
              </button>
            </TableHead>
            <TableHead class="text-right">
              <button
                type="button"
                class="inline-flex items-center gap-1 text-sm font-semibold transition hover:text-foreground"
                @click="toggleCompareSort('profitDelta')"
              >
                <span>{{ t('common:dungeonCalculator.compareProfitDelta', 'Delta') }}</span>
                <span
                  class="text-xs"
                  :class="compareSort.key === 'profitDelta' ? 'text-primary' : 'text-muted-foreground'"
                  >{{ getCompareSortIndicator('profitDelta') }}</span
                >
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in compareRowsForDisplay"
            :key="`${row.dungeonHrid}-${row.difficultyTier}`"
            class="transition"
            :class="
              compareRowNoClear(row)
                ? 'cursor-not-allowed opacity-45'
                : 'cursor-pointer hover:bg-muted/40' +
                  (isCurrentTarget(row.dungeonHrid, row.difficultyTier) ? ' bg-success/10' : '')
            "
            :title="compareNoClearTitle(row)"
            @click="selectTarget(row.dungeonHrid, row.difficultyTier)"
          >
            <TableCell class="py-1 text-sm">
              <span class="mr-1 inline-flex items-center gap-1 align-middle">
                <svg
                  v-if="dungeonIconVisible(row.dungeonHrid)"
                  class="inline-block h-4 w-4 shrink-0"
                  viewBox="0 0 100 100"
                  aria-hidden="true"
                >
                  <use :href="actionIconHref(row.dungeonHrid)" />
                </svg>
                <span class="font-heading text-xs font-bold text-muted-foreground"
                  >D{{ dungeonSerial(row.dungeonHrid) }}</span
                >
              </span>
              <span>{{ getActionName(row.dungeonHrid, row.dungeonName) }}</span>
            </TableCell>
            <TableCell class="py-1 text-sm">T{{ row.difficultyTier }}</TableCell>
            <TableCell class="py-1 align-top">
              <div class="flex items-center gap-2 rounded-md p-1 transition">
                <input
                  class="control-input !h-7 !min-h-0 !w-20 !px-2 shrink-0 text-center text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-60"
                  type="number"
                  inputmode="decimal"
                  min="0.25"
                  step="0.25"
                  :value="runMinutesInputValue(row.dungeonHrid, row.difficultyTier)"
                  :placeholder="formatNumber(targetDefaultRunMinutes(row.dungeonHrid, row.difficultyTier), 2)"
                  :disabled="targetNoClear(row.dungeonHrid, row.difficultyTier)"
                  :title="
                    targetNoClear(row.dungeonHrid, row.difficultyTier)
                      ? targetNoClearTitle(row.dungeonHrid, row.difficultyTier)
                      : ''
                  "
                  :aria-label="runMinutesInputLabel(row.dungeonHrid, row.difficultyTier)"
                  @focus="selectTarget(row.dungeonHrid, row.difficultyTier)"
                  @click.stop="selectTarget(row.dungeonHrid, row.difficultyTier)"
                  @change="onTargetRunMinutesInput(row.dungeonHrid, row.difficultyTier, $event)"
                />
                <p
                  class="min-w-0 flex-1 truncate text-xs"
                  :class="targetStatusTone(row.dungeonHrid, row.difficultyTier)"
                  :title="targetStatusTitle(row.dungeonHrid, row.difficultyTier)"
                >
                  {{ targetStatusText(row.dungeonHrid, row.difficultyTier) }}
                </p>
              </div>
            </TableCell>
            <TableCell class="py-1 text-right text-sm tabular-nums">
              {{ deathsPerRunText(row.dungeonHrid, row.difficultyTier) }}
            </TableCell>
            <TableCell class="py-1 text-right">
              <div class="space-y-0.5 leading-tight">
                <div class="flex items-baseline justify-end gap-x-4 whitespace-nowrap">
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-xs text-muted-foreground">{{
                      t('common:dungeonCalculator.runsPerDayLabel', 'Daily runs')
                    }}</span>
                    <span class="text-sm tabular-nums text-foreground/85">{{ formatNumber(row.runsPerDay, 2) }}</span>
                  </span>
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-xs text-muted-foreground">{{
                      t('common:dungeonCalculator.dailyEntryKeysLabel', 'Daily entry keys')
                    }}</span>
                    <span class="text-sm tabular-nums text-foreground/85">{{
                      formatNumber(row.mainChestCount * row.runsPerDay, 2)
                    }}</span>
                  </span>
                </div>
                <div class="flex items-baseline justify-end gap-x-4 whitespace-nowrap">
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-xs text-muted-foreground">{{
                      t('common:dungeonCalculator.dailyMainChestsLabel', 'Daily main chests')
                    }}</span>
                    <span class="text-sm tabular-nums text-foreground/85">{{
                      formatNumber(row.mainChestCount * row.runsPerDay, 2)
                    }}</span>
                  </span>
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-xs text-muted-foreground">{{
                      t('common:dungeonCalculator.dailyRefinementChestsLabel', 'Daily refinement chests')
                    }}</span>
                    <span class="text-sm tabular-nums text-foreground/85">{{
                      formatNumber(row.refinementChestCount * row.runsPerDay, 2)
                    }}</span>
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell class="py-1 text-right">
              <div class="space-y-0.5 leading-tight">
                <div class="flex items-baseline justify-end gap-1">
                  <span class="text-xs text-muted-foreground">{{
                    t('common:dungeonCalculator.compareLineCost', 'Cost')
                  }}</span>
                  <span class="text-sm tabular-nums text-destructive">{{
                    formatMoney(row.keySourceBreakdown.craft.dailyCost)
                  }}</span>
                </div>
                <div class="flex items-baseline justify-end gap-1">
                  <span class="text-xs text-muted-foreground">{{
                    t('common:dungeonCalculator.compareLineProfit', 'Profit')
                  }}</span>
                  <span
                    class="text-sm font-semibold tabular-nums"
                    :class="profitTone(row.keySourceBreakdown.craft.dailyProfit)"
                    >{{ formatMoney(row.keySourceBreakdown.craft.dailyProfit) }}</span
                  >
                </div>
              </div>
            </TableCell>
            <TableCell class="py-1 text-right">
              <div class="space-y-0.5 leading-tight">
                <div class="flex items-baseline justify-end gap-1">
                  <span class="text-xs text-muted-foreground">{{
                    t('common:dungeonCalculator.compareLineCost', 'Cost')
                  }}</span>
                  <span class="text-sm tabular-nums text-destructive">{{
                    formatMoney(row.keySourceBreakdown.market.dailyCost)
                  }}</span>
                </div>
                <div class="flex items-baseline justify-end gap-1">
                  <span class="text-xs text-muted-foreground">{{
                    t('common:dungeonCalculator.compareLineProfit', 'Profit')
                  }}</span>
                  <span
                    class="text-sm font-semibold tabular-nums"
                    :class="profitTone(row.keySourceBreakdown.market.dailyProfit)"
                    >{{ formatMoney(row.keySourceBreakdown.market.dailyProfit) }}</span
                  >
                </div>
              </div>
            </TableCell>
            <TableCell
              class="py-1 text-right text-sm font-semibold"
              :class="profitTone(row.keySourceBreakdown.profitDelta)"
            >
              {{ formatMoney(row.keySourceBreakdown.profitDelta) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <Badge variant="secondary">
        {{ t('common:dungeonCalculator.dataVersion', 'Data version') }}: {{ dataVersionText }}
      </Badge>
    </div>
    <BaseModal
      :open="itemsDialogOpen"
      :title="t('common:dungeonCalculator.itemsTitle', 'Loot breakdown')"
      panel-class="max-w-3xl"
      @close="itemsDialogOpen = false"
    >
      <!-- 产物表：开箱期望与产物价格（价格格可直接改价） -->
      <div class="space-y-3" data-dungeon-calculator-items>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {{ t('common:dungeonCalculator.buffMultiplierLabel', 'Chest multiplier') }}: ×{{
                formatNumber(calculator.result?.buffMultiplier ?? 1, 3)
              }}
            </span>
            <span>
              {{ t('common:dungeonCalculator.refinementRateLabel', 'Effective rate') }}:
              {{ formatPercent(calculator.result?.refinementRate ?? 0) }}
            </span>
          </div>
        </div>
        <div class="overflow-x-auto">
          <Table class="min-w-[560px]">
            <TableHeader>
              <TableRow class="text-xs">
                <TableHead>{{ t('common:dungeonCalculator.itemName', 'Item') }}</TableHead>
                <TableHead class="text-right">{{
                  t('common:dungeonCalculator.expectedQty', 'Expected qty')
                }}</TableHead>
                <TableHead class="text-right">{{ t('common:dungeonCalculator.modeBid', 'Bid price') }}</TableHead>
                <TableHead class="text-right">{{ t('common:dungeonCalculator.modeAsk', 'Ask price') }}</TableHead>
                <TableHead class="text-right">{{
                  t('common:dungeonCalculator.usedPriceLabel', 'Used price')
                }}</TableHead>
                <TableHead class="text-right">{{ t('common:dungeonCalculator.feeColumn', 'Fee') }}</TableHead>
                <TableHead class="text-right">{{ t('common:dungeonCalculator.subtotal', 'Subtotal') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in lootRows" :key="item.itemHrid">
                <TableCell class="text-xs" :title="itemName(item.itemHrid)">{{ itemName(item.itemHrid) }}</TableCell>
                <TableCell class="text-right text-xs tabular-nums">{{ formatNumber(item.qty, 3) }}</TableCell>
                <TableCell>
                  <input
                    class="control-input !h-7 !min-h-0 !px-1.5 text-right text-[11px]"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="1"
                    :value="overrideEntryValue(item.itemHrid, 'bid')"
                    :placeholder="marketQuoteText(item.itemHrid, 'bid')"
                    :aria-label="overrideAriaLabel(item.itemHrid, 'bid')"
                    @change="onOverrideInput(item.itemHrid, 'bid', $event)"
                  />
                </TableCell>
                <TableCell>
                  <input
                    class="control-input !h-7 !min-h-0 !px-1.5 text-right text-[11px]"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="1"
                    :value="overrideEntryValue(item.itemHrid, 'ask')"
                    :placeholder="marketQuoteText(item.itemHrid, 'ask')"
                    :aria-label="overrideAriaLabel(item.itemHrid, 'ask')"
                    @change="onOverrideInput(item.itemHrid, 'ask', $event)"
                  />
                </TableCell>
                <TableCell class="text-right text-xs tabular-nums text-muted-foreground">
                  {{ formatMoney(item.unitPrice) }}
                </TableCell>
                <TableCell class="text-right text-xs text-muted-foreground">{{ feeText(item) }}</TableCell>
                <TableCell class="text-right text-xs font-semibold tabular-nums">
                  {{ formatMoney(item.subtotal) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground"
        >
          <span>{{ overrideSummaryText }}</span>
          <button
            type="button"
            class="text-primary underline-offset-2 hover:underline disabled:opacity-50"
            :disabled="calculator.overrideCount === 0"
            @click="calculator.clearAllPriceOverrides()"
          >
            {{ t('common:dungeonCalculator.clearAllOverrides', 'Clear all overrides') }}
          </button>
        </div>
        <p class="text-[10px] leading-snug text-muted-foreground">
          {{
            t(
              'common:dungeonCalculator.priceEditHint',
              'Type into a price cell to override the market price; clear it to restore live prices.',
            )
          }}
        </p>
      </div>
    </BaseModal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS,
  DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS,
  useDungeonCalculatorStore,
} from '../../stores/dungeonCalculatorStore.js';
import { formatCompactAmountForLocale } from '../../services/amountFormatting.js';
import { actionIconHref, ensureActionIconSymbols, hasActionIconSymbol } from '../../services/itemIconSprite.js';
import { useI18nText } from '../composables/useI18nText.js';
import { useGameDataText } from '../composables/useGameDataText.js';
import BaseModal from '../components/BaseModal.vue';
import { Input } from '../components/ui/input/index.js';
import { NumberField } from '../components/ui/number-field/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/select/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { GAME_DATA_VERSION } from '../../shared/gameDataIndex.js';
import { formatDataVersionText } from '../dataVersionPresentation.js';

const calculator = useDungeonCalculatorStore();
const { t, language } = useI18nText();
const { getActionName, getItemName } = useGameDataText();

// 地牢序号（D1-D4）：跟随官方目录顺序（catalog），在总览表中对照游戏内地图编号。
const dungeonSerialMap = computed(() => {
  const map = new Map();
  calculator.catalog.forEach((entry, index) => {
    map.set(entry.actionHrid, index + 1);
  });
  return map;
});

function dungeonSerial(dungeonHrid) {
  return dungeonSerialMap.value.get(dungeonHrid) ?? '-';
}

// 地牢序号数值（排序专用）：目录序 1..4；未知 hrid 恒排最后（不参与 '-' 显示口径）。
function dungeonSerialRank(dungeonHrid) {
  return dungeonSerialMap.value.get(dungeonHrid) ?? Number.MAX_SAFE_INTEGER;
}

// ── 地牢图标：官方 actions_sprite 符号（与物品图标同源，见 services/itemIconSprite.js）──
// 拉取队列串行合并；注入成功后 bump revision 触发重渲（失败保持占位、下次可重试）。
const dungeonIconRevision = ref(0);
let dungeonIconLoadQueue = Promise.resolve(0);

function loadDungeonIcons(hrids = []) {
  const requestedHrids = Array.from(new Set(hrids.map((hrid) => String(hrid || '')).filter(Boolean)));
  const missingHrids = requestedHrids.filter((hrid) => !hasActionIconSymbol(hrid));
  if (missingHrids.length === 0) {
    return dungeonIconLoadQueue;
  }
  dungeonIconLoadQueue = dungeonIconLoadQueue
    .catch(() => 0)
    .then(() => ensureActionIconSymbols(missingHrids))
    .then(() => {
      if (missingHrids.some((hrid) => hasActionIconSymbol(hrid))) {
        dungeonIconRevision.value += 1;
      }
      return 0;
    })
    .catch(() => 0);
  return dungeonIconLoadQueue;
}

function dungeonIconVisible(dungeonHrid) {
  void dungeonIconRevision.value;
  return hasActionIconSymbol(dungeonHrid);
}

// 数据版本 = 索引生成时刻（ISO UTC），按中国时区渲染（见 ../dataVersionPresentation.js）。
// 索引生成时刻是构建期常量，故只算一次，避免每帧走 Intl.formatToParts。
const dataVersionText = formatDataVersionText(GAME_DATA_VERSION);

// 产物明细弹窗开关：产物表与相关控件收进弹窗，页面主体保持紧凑。
const itemsDialogOpen = ref(false);

// 金额（收益 / 成本 / 单价 / 小计）统一走项目紧凑口径：k/m/b 小写，与首页摘要、队列页、
// 批量结果页一致（services/amountFormatting.js）。价格覆盖输入框的市场价 placeholder 也
// 复用本函数，避免同页出现两套数字口径。数量、钥匙把数、轮次等计数仍走 formatNumber。
function formatMoney(value) {
  return formatCompactAmountForLocale(value, language.value === 'zh' ? 'zh-CN' : 'en-US');
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatPercent(value, digits = 1) {
  return `${formatNumber(Number(value) * 100, digits)}%`;
}

function formatMinutes(value) {
  return `${formatNumber(value, 2)} ${t('common:dungeonCalculator.minuteUnit', 'min')}`;
}

function itemName(hrid) {
  return getItemName(hrid, hrid);
}

function priceModeText(mode) {
  return mode === 'ask'
    ? t('common:dungeonCalculator.modeAsk', 'Ask price')
    : t('common:dungeonCalculator.modeBid', 'Bid price');
}

function feeText(item) {
  if (item?.taxRate == null) {
    return t('common:dungeonCalculator.shopValuation', 'Shop valuation');
  }
  if (item.taxRate <= 0) {
    return t('common:dungeonCalculator.taxFree', 'Tax free');
  }
  return formatPercent(item.taxRate, 1);
}

const selectedDungeonName = computed(() => {
  const entry = calculator.selectedDungeon;
  return entry ? getActionName(entry.actionHrid, entry.name) : '';
});

// ── 模拟未通关组合的统一门禁：每轮分钟禁改 / 顶部选择器禁切 / 批量对比置灰置底 ──
// 判定口径 = 模拟结果该组合零通关（avgRunMinutes 为 null，即未写回时长）；
// 无模拟结果（未跑过 / 已重置）时不做门禁。护栏：整批一个通关都没有时不做门禁，避免界面无处可去。
const compareNoClearMap = computed(() => {
  const map = new Map();
  const rows = calculator.simulation.lastResult?.targets;
  if (!Array.isArray(rows)) {
    return map;
  }
  for (const row of rows) {
    if (row && !(row.avgRunMinutes > 0)) {
      map.set(`${row.dungeonHrid}|${row.difficultyTier}`, row);
    }
  }
  return map;
});

const simulationClearedTargetsExist = computed(() => {
  const rows = calculator.simulation.lastResult?.targets;
  return Array.isArray(rows) && rows.some((row) => row && row.avgRunMinutes > 0);
});

function targetNoClear(dungeonHrid, tier) {
  if (!simulationClearedTargetsExist.value) {
    return false;
  }
  return compareNoClearMap.value.has(`${dungeonHrid}|${tier}`);
}

function targetNoClearTitle(dungeonHrid, tier) {
  const info = compareNoClearMap.value.get(`${dungeonHrid}|${tier}`);
  if (!info) {
    return '';
  }
  return t('common:dungeonCalculator.compareNoClearHint', 'No clears in the simulation; this row cannot be applied.', {
    failed: formatNumber(info.dungeonsFailed ?? 0, 0),
    wave: formatNumber(info.maxWaveReached ?? 0, 0),
  });
}

// ── 地牢总览：行点击 / 输入框聚焦的统一选择入口（合并原「行头选择」与「单元格选择」）──
// 未通关组合保持门禁（不可切换）；已是当前组合时幂等返回，避免重复写 store。
function selectTarget(dungeonHrid, tier) {
  if (targetNoClear(dungeonHrid, tier)) {
    return;
  }
  if (isCurrentTarget(dungeonHrid, tier)) {
    return;
  }
  calculator.setDungeonHrid(dungeonHrid);
  calculator.setDifficultyTier(tier);
}

// ── 每轮分钟：总表（地牢 × 档位）读写入口 ──
const runMinutesRowMap = computed(() => {
  const map = new Map();
  for (const row of calculator.runMinutesTargetRows) {
    map.set(row.key, row);
  }
  return map;
});

function isCurrentTarget(dungeonHrid, tier) {
  return calculator.config.dungeonHrid === dungeonHrid && calculator.config.difficultyTier === tier;
}

function runMinutesInputValue(dungeonHrid, tier) {
  const override = calculator.getRunMinutesOverride(dungeonHrid, tier);
  return override == null ? '' : String(override);
}

// 该组合的官方默认时长（runMinutesTargetRows 的 defaultRunMinutes）：分钟输入框 placeholder 用。
function targetDefaultRunMinutes(dungeonHrid, tier) {
  return runMinutesRowMap.value.get(`${dungeonHrid}|${tier}`)?.defaultRunMinutes ?? 0;
}

function runMinutesInputLabel(dungeonHrid, tier) {
  return `${getActionName(dungeonHrid, dungeonHrid)} T${tier} ${t('common:dungeonCalculator.runMinutes', 'Minutes per run')}`;
}

// 输入提交（失焦 / 回车）：空值 = 清除覆盖（回落默认）；非法值不落库并回滚显示。
// 模拟未通关的组合禁止修改（输入框已 disabled，这里兜底防御程序化触发）。
function onTargetRunMinutesInput(dungeonHrid, tier, event) {
  if (targetNoClear(dungeonHrid, tier)) {
    event.target.value = calculator.getRunMinutesOverride(dungeonHrid, tier) ?? '';
    return;
  }
  const raw = String(event?.target?.value ?? '').trim();
  const minutes = raw === '' ? null : Number(raw);
  if (minutes == null) {
    calculator.clearRunMinutesOverride(dungeonHrid, tier);
  } else if (Number.isFinite(minutes) && minutes > 0) {
    calculator.setRunMinutesOverride(dungeonHrid, tier, minutes);
  }
  event.target.value = calculator.getRunMinutesOverride(dungeonHrid, tier) ?? '';
}

// ── 每轮分钟总表：模拟结果摘要（按组合） ──
const simulationTargetMap = computed(() => {
  const map = new Map();
  for (const row of calculator.simulation.lastResult?.targets || []) {
    map.set(`${row.dungeonHrid}|${row.difficultyTier}`, row);
  }
  return map;
});

function targetSimResult(dungeonHrid, tier) {
  return simulationTargetMap.value.get(`${dungeonHrid}|${tier}`) || null;
}

function targetStatusText(dungeonHrid, tier) {
  const simRow = targetSimResult(dungeonHrid, tier);
  if (!simRow) {
    // 无模拟结果：不显示状态小字（每日轮次已在「每日产出」列展示，2026-10-15 同日反馈去重）。
    return '';
  }
  if (simRow.avgRunMinutes != null) {
    return t('common:dungeonCalculator.runMinutesSimAvgShort', 'avg {{minutes}}', {
      minutes: formatMinutes(simRow.avgRunMinutes),
    });
  }
  return t('common:dungeonCalculator.runMinutesSimNoClearShort', 'no clear');
}

function targetStatusTone(dungeonHrid, tier) {
  const simRow = targetSimResult(dungeonHrid, tier);
  return simRow && simRow.avgRunMinutes == null ? 'text-warning' : 'text-muted-foreground';
}

function targetStatusTitle(dungeonHrid, tier) {
  const simRow = targetSimResult(dungeonHrid, tier);
  if (!simRow) {
    // 无模拟结果时行内不再显示「轮/天」小字（每日轮次已由每日产出列承担），悬停亦无提示。
    return '';
  }
  const windowText = t('common:dungeonCalculator.simulateWindowValue', '{{rounds}} rounds x 24 h', {
    rounds: calculator.simulation.lastResult?.rounds ?? 1,
  });
  const parts = [];
  if (simRow.avgRunMinutes != null) {
    parts.push(
      t('common:dungeonCalculator.simulateAvgValue', 'Avg {{minutes}} per run', {
        minutes: formatMinutes(simRow.avgRunMinutes),
      }),
    );
    parts.push(
      t('common:dungeonCalculator.simulateClearsValue', '{{count}} clears', { count: simRow.dungeonsCompleted }),
    );
    parts.push(t('common:dungeonCalculator.simulateWipesValue', '{{count}} wipes', { count: simRow.dungeonsFailed }));
    if (simRow.minRunMinutes) {
      parts.push(
        t('common:dungeonCalculator.simulateFastestValue', 'Fastest {{minutes}}', {
          minutes: formatMinutes(simRow.minRunMinutes),
        }),
      );
    }
    parts.push(windowText);
    return parts.join(' · ');
  }
  parts.push(t('common:dungeonCalculator.simulateNoClear', 'No clears in the simulated window'));
  parts.push(t('common:dungeonCalculator.simulateWipesValue', '{{count}} wipes', { count: simRow.dungeonsFailed }));
  parts.push(
    t('common:dungeonCalculator.simulateDeepestValue', 'Deepest wave {{wave}}', { wave: simRow.maxWaveReached }),
  );
  parts.push(windowText);
  parts.push(t('common:dungeonCalculator.simulateNotApplied', 'not applied'));
  return parts.join(' · ');
}

// ── 「模拟每轮时长」展示层：进度 / 结果 / 错误文案（错误键由 store 产生，这里只做映射） ──
const simulationProgressText = computed(() => {
  if (!calculator.simulation.isRunning) {
    return '';
  }
  return `${t('common:dungeonCalculator.simulateRunning', 'Simulating...')} ${calculator.simulation.settledRounds}/${calculator.simulation.totalRounds}`;
});

const simulationResultText = computed(() => {
  const result = calculator.simulation.lastResult;
  if (!result) {
    return '';
  }
  const parts = [
    t('common:dungeonCalculator.simulateSummaryTargets', '{{count}} combinations', {
      count: Array.isArray(result.targets) ? result.targets.length : 0,
    }),
    t('common:dungeonCalculator.simulateSummaryApplied', '{{count}} written back', {
      count: result.appliedTargets ?? 0,
    }),
    t('common:dungeonCalculator.simulateSummaryConsumables', '{{count}} consumables written back', {
      count: result.appliedConsumablesTargets ?? 0,
    }),
    t('common:dungeonCalculator.simulateClearsValue', '{{count}} clears', { count: result.dungeonsCompleted ?? 0 }),
    t('common:dungeonCalculator.simulateWipesValue', '{{count}} wipes', { count: result.dungeonsFailed ?? 0 }),
  ];
  const elapsed = Number(result.elapsedSeconds);
  if (Number.isFinite(elapsed) && elapsed > 0) {
    parts.push(
      t('common:dungeonCalculator.simulateElapsedValue', '{{seconds}}s', { seconds: formatNumber(elapsed, 1) }),
    );
  }
  return parts.join(' · ');
});

// 有组合被写回 = 参考信息（弱化色）；全部未写回（整批零通关）= 警告色。
const simulationResultTone = computed(() =>
  Number(calculator.simulation.lastResult?.appliedTargets) > 0 ? 'text-muted-foreground' : 'text-warning',
);

const SIMULATION_ERROR_FALLBACKS = Object.freeze({
  'common:dungeonCalculator.simulateErrorNoPlayers': 'Import and select at least one player on the Home page first.',
  'common:dungeonCalculator.simulateErrorBusy': 'Another simulation is running. Try again in a moment.',
  'common:dungeonCalculator.simulateErrorFailed': 'Simulation failed. Please try again.',
});

const simulationErrorText = computed(() => {
  const key = calculator.simulation.error;
  if (!key) {
    return '';
  }
  return t(key, SIMULATION_ERROR_FALLBACKS[key] || 'Simulation failed. Please try again.');
});

// 每日消耗品成本（食物 / 饮品）：页面按百万金币输入，store / 引擎按金币口径换算。
const dailyConsumablesCostInput = computed(() => {
  const value = calculator.config.dailyConsumablesCostMillions;
  return value == null || value === 0 ? '' : String(value);
});

function onDailyConsumablesCostInput(event) {
  const raw = String(event?.target?.value ?? '').trim();
  const value = raw === '' ? 0 : Number(raw);
  calculator.setDailyConsumablesCostMillions(Number.isFinite(value) && value > 0 ? value : 0);
}

// 「每轮死亡次数」列：取自「用导入队伍模拟」对应组合结果（每轮平均死亡次数，窗口内玩家死亡总数
// ÷ 窗口内通关次数）；未跑模拟 / 该组合零通关 / 引擎未上报 deaths 时显示占位符。
function deathsPerRunText(dungeonHrid, tier) {
  const simRow = targetSimResult(dungeonHrid, tier);
  if (!simRow || simRow.deathsPerRun == null) {
    return '—';
  }
  return formatNumber(simRow.deathsPerRun, 2);
}

const lootRows = computed(() => (calculator.result?.items || []).filter((item) => item.isChest !== true));

const overrideSummaryText = computed(() =>
  t('common:dungeonCalculator.overrideSummary', '{{count}} price overrides', { count: calculator.overrideCount }),
);

// 金额正负着色：净利 / 日收益类数字绿正红负（对齐 MST 工具箱的成本红 / 收益绿语义）。
function profitTone(value) {
  return Number(value) >= 0 ? 'text-success' : 'text-destructive';
}

// ── 地牢总览：展示层行过滤（地下城 / 难度勾选）──
// 默认全部勾选；取消勾选 → 对应行不进表。过滤状态只存页面本地（展示性过滤），
// 不写 store、不影响选中组合 / 覆盖值与模拟结果；全不勾时表格为空属预期。
const COMPARE_FILTER_TIERS = Object.freeze([0, 1, 2]);
const uncheckedDungeonHrids = ref(new Set());
const uncheckedTiers = ref(new Set());

// 勾选态 = 不在「取消集合」里（集合为空即默认全勾）。
function isDungeonFilterChecked(dungeonHrid) {
  return !uncheckedDungeonHrids.value.has(dungeonHrid);
}

function toggleDungeonFilter(dungeonHrid, checked) {
  const next = new Set(uncheckedDungeonHrids.value);
  if (checked) {
    next.delete(dungeonHrid);
  } else {
    next.add(dungeonHrid);
  }
  uncheckedDungeonHrids.value = next;
}

function isTierFilterChecked(tier) {
  return !uncheckedTiers.value.has(tier);
}

function toggleTierFilter(tier, checked) {
  const next = new Set(uncheckedTiers.value);
  if (checked) {
    next.delete(tier);
  } else {
    next.add(tier);
  }
  uncheckedTiers.value = next;
}

// ── 地牢总览：列头排序（普通列三态；制 / 购 两列五态）──
// 点击列头按「降序 → 升序 → 恢复默认序」循环，指示符 <> / ^ / v；制 / 购 两列在格内两行间接力：
// 成本降 → 成本升 → 收益降 → 收益升 → 恢复默认（指示符 <> / ^成本 / v成本 / ^收益 / v收益），缺失值恒排末尾；
// 排序在展示层进行（store 的 compareRows 保持引擎默认顺序）。
const COMPARE_SORT_COLUMNS = Object.freeze([
  'dungeonName',
  'difficultyTier',
  'runMinutes',
  'craft',
  'market',
  'profitDelta',
]);
// 制 / 购 两列（格内上行 = 每日成本、下行 = 每日收益，对齐工具箱 574037 的「成本 / 收益」双行排版）：
// 排序值在 keySourceBreakdown[basis][metricField]；利润差价列直接取 row.keySourceBreakdown.profitDelta（顶层标量）。
const COMPARE_BASIS_COLUMNS = Object.freeze(['craft', 'market']);
const COMPARE_BASIS_METRIC_FIELDS = Object.freeze({ cost: 'dailyCost', profit: 'dailyProfit' });
const compareSort = ref({ key: '', metric: 'cost', direction: 'desc' });

function resolveCompareSortValue(row, key, metric = 'cost') {
  if (!row) {
    return null;
  }
  if (key === 'dungeonName') {
    return getActionName(row.dungeonHrid, row.dungeonName);
  }
  // 制 / 购 两列：值在 keySourceBreakdown 的嵌套对象里，按当前排序指标（成本 / 收益）取。
  if (COMPARE_BASIS_COLUMNS.includes(key)) {
    const field = COMPARE_BASIS_METRIC_FIELDS[metric] || 'dailyCost';
    const nested = Number(row.keySourceBreakdown?.[key]?.[field]);
    return Number.isFinite(nested) ? nested : null;
  }
  if (key === 'profitDelta') {
    const delta = Number(row.keySourceBreakdown?.profitDelta);
    return Number.isFinite(delta) ? delta : null;
  }
  // 其余列（地牢名 / 档位 / 每轮分钟）直接取引擎行字段。
  const numeric = Number(row[key]);
  return Number.isFinite(numeric) ? numeric : null;
}

function compareCompareRows(left, right, key, metric, directionFactor) {
  const leftValue = resolveCompareSortValue(left, key, metric);
  const rightValue = resolveCompareSortValue(right, key, metric);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  if (leftValue === rightValue) return 0;
  if (typeof leftValue === 'string' || typeof rightValue === 'string') {
    const diff = String(leftValue).localeCompare(String(rightValue), language.value === 'zh' ? 'zh-CN' : 'en-US');
    return diff * directionFactor;
  }
  return leftValue < rightValue ? -directionFactor : directionFactor;
}

function toggleCompareSort(columnKey) {
  if (!COMPARE_SORT_COLUMNS.includes(columnKey)) {
    return;
  }
  const basisColumn = COMPARE_BASIS_COLUMNS.includes(columnKey);
  if (compareSort.value.key === columnKey) {
    if (compareSort.value.direction === 'desc') {
      compareSort.value.direction = 'asc';
      return;
    }
    // 制 / 购 两列：成本 / 收益接力（成本升 → 收益降），两行都走完才恢复默认顺序。
    if (basisColumn && compareSort.value.metric !== 'profit') {
      compareSort.value.metric = 'profit';
      compareSort.value.direction = 'desc';
      return;
    }
    // 普通列，或制 / 购 两列的收益行走完：恢复默认顺序。
    compareSort.value = { key: '', metric: 'cost', direction: 'desc' };
    return;
  }
  compareSort.value = { key: columnKey, metric: 'cost', direction: 'desc' };
}

function getCompareSortIndicator(columnKey) {
  if (compareSort.value.key !== columnKey) {
    return '<>';
  }
  if (COMPARE_BASIS_COLUMNS.includes(columnKey)) {
    const metricLabel =
      compareSort.value.metric === 'profit'
        ? t('common:dungeonCalculator.compareLineProfit', 'Profit')
        : t('common:dungeonCalculator.compareLineCost', 'Cost');
    return `${compareSort.value.direction === 'asc' ? '^' : 'v'}${metricLabel}`;
  }
  return compareSort.value.direction === 'asc' ? '^' : 'v';
}

// 总览表行门禁：判定与提示文案统一走 targetNoClear / targetNoClearTitle（见「地牢总览」前的门禁块）。
function compareRowNoClear(row) {
  return targetNoClear(row.dungeonHrid, row.difficultyTier);
}

function compareNoClearTitle(row) {
  return targetNoClearTitle(row.dungeonHrid, row.difficultyTier);
}

// 默认展示顺序（未点列头排序时）：按地牢序号 D1 → D4、同地牢内按档位 T0 → T2 升序；
// 未通关行恒置底（与列头排序同款分层，护栏不变）。
function compareDefaultOrder(left, right) {
  const serialDiff = dungeonSerialRank(left.dungeonHrid) - dungeonSerialRank(right.dungeonHrid);
  if (serialDiff !== 0) {
    return serialDiff;
  }
  return left.difficultyTier - right.difficultyTier;
}

// 展示顺序：先做展示层行过滤（地下城 / 难度勾选：取消勾选的行不进表），再按未通关分层（未通关恒置底）；
// 有列头排序时按该列（制 / 购 两列带成本 / 收益指标），否则默认 D1 → D4 / T0 → T2。
const compareRowsForDisplay = computed(() => {
  const rows = calculator.compareRows.filter(
    (row) => isDungeonFilterChecked(row.dungeonHrid) && isTierFilterChecked(row.difficultyTier),
  );
  const layered = rows.map((row, index) => ({ row, index, noClear: compareRowNoClear(row) }));
  const sortKey = String(compareSort.value.key || '');
  const sortMetric = compareSort.value.metric === 'profit' ? 'profit' : 'cost';
  const columnSortActive = Boolean(sortKey) && COMPARE_SORT_COLUMNS.includes(sortKey);
  const directionFactor = compareSort.value.direction === 'asc' ? 1 : -1;
  layered.sort((a, b) => {
    if (a.noClear !== b.noClear) {
      return a.noClear ? 1 : -1;
    }
    if (columnSortActive) {
      return compareCompareRows(a.row, b.row, sortKey, sortMetric, directionFactor) || a.index - b.index;
    }
    return compareDefaultOrder(a.row, b.row) || a.index - b.index;
  });
  return layered.map((entry) => entry.row);
});

function overrideEntryValue(hrid, mode) {
  const entry = calculator.config.priceOverrides?.[hrid];
  const value = entry && typeof entry === 'object' ? entry[mode] : undefined;
  return value == null ? '' : String(value);
}

function marketQuoteText(hrid, mode) {
  const entry = calculator.marketPriceTable?.[hrid];
  const value = Number(entry?.[mode]);
  return Number.isFinite(value) && value >= 0 ? formatMoney(value) : '-';
}

function overrideAriaLabel(hrid, mode) {
  return `${itemName(hrid)} ${priceModeText(mode)}`;
}

// 弹窗价格格输入（bid/ask）：空值 = 清除覆盖；负数 / 非有限值不落库；三条路径末尾统一回写显示值，
// 非法输入立即回滚（与 onTargetRunMinutesInput 口径一致，不依赖下一次重渲染兜底 DOM 值）。
function onOverrideInput(hrid, mode, event) {
  const raw = String(event?.target?.value ?? '').trim();
  if (raw === '') {
    calculator.clearPriceOverrideMode(hrid, mode);
  } else {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) {
      calculator.setPriceOverride(hrid, mode, value);
    }
  }
  event.target.value = overrideEntryValue(hrid, mode);
}

const priceStatusText = computed(() => {
  const status = calculator.priceStatus;
  if (status?.loading) {
    return t('common:dungeonCalculator.refreshing', 'Refreshing...');
  }
  if (status?.error) {
    return t('common:dungeonCalculator.priceFallbackActive', 'Market fallback active');
  }
  if (status?.ready || status?.updatedAt) {
    return t('common:dungeonCalculator.pricesReady', 'Prices ready');
  }
  return t('common:dungeonCalculator.vendorPrices', 'Vendor prices');
});

const priceStatusClass = computed(() =>
  calculator.priceStatus?.error
    ? 'border-warning/40 bg-warning/10 text-warning'
    : 'border-success/40 bg-success/10 text-success',
);

function resetConfig() {
  calculator.resetConfig();
}

onMounted(() => {
  void calculator.initialize();
  void loadDungeonIcons(calculator.catalog.map((entry) => entry.actionHrid));
});

watch(
  () => calculator.catalog.map((entry) => entry.actionHrid).join('|'),
  () => {
    void loadDungeonIcons(calculator.catalog.map((entry) => entry.actionHrid));
  },
);
</script>
