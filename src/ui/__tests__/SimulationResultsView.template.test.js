import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viewSource = readFileSync(new URL('../components/SimulationResultsView.vue', import.meta.url), 'utf8');

describe('SimulationResultsView official game labels', () => {
  it('uses official skill and combat-stat names throughout result views', () => {
    expect(viewSource).toContain('getSkillName(column.skillHrid');
    expect(viewSource).toContain("getCombatStatName('staminaExperience'");
    expect(viewSource).toContain("getCombatStatName('retaliation'");
    expect(viewSource).toContain("getBuffTypeName('/buff_types/damage'");
    expect(viewSource).toContain("getOfficialGameText('combatUnit', 'autoAttack'");
    expect(viewSource).toContain("getOfficialGameText('ability', 'ability', 'Ability')");
    expect(viewSource).not.toContain('common:vue.home.levelLabels');
    expect(viewSource).not.toContain('common:vue.home.combatStats');
    expect(viewSource).not.toContain('common:vue.results.retaliation');
  });

  it('floors scroll durations and normalizes hour boundaries', () => {
    expect(viewSource).toContain('const totalWholeMinutes = Math.floor(totalMinutes);');
    expect(viewSource).toContain('const minutes = totalWholeMinutes % 60;');
    expect(viewSource).not.toContain('Math.round(totalMinutes)');
  });

  it('shows scroll usage rows or an explicit paused state', () => {
    expect(viewSource).toContain('activeScrollUsageDisabled.value || activeScrollUsageRows.value.length > 0');
    expect(viewSource).toContain('activeScrollUsage.value?.root?.disabled === true');
    expect(viewSource).toContain('common:vue.results.scrollsDisabled');
    expect(viewSource).not.toContain('Boolean(activeScrollUsage.value)');
    expect(viewSource).not.toContain('noCombatScrollsUsed');
  });

  it('wires the multi-round panel after the summary table and annotates the timeline and result details', () => {
    expect(viewSource).toContain("import HomeMultiRoundPanel from './home/HomeMultiRoundPanel.vue';");
    expect(viewSource).toContain('<HomeMultiRoundPanel');
    expect(viewSource).toContain("'common:vue.results.multiRound.firstRoundNote'");
    expect(viewSource).toContain('{{ firstRoundNoteText }}');

    // 首轮失败时明细来自第 2+ 个成功轮：标注轮号必须读 firstSuccessfulRound（缺省回落 1），
    // 不允许回退到写死的「round 1」。
    expect(viewSource).toContain('multiRound.firstSuccessfulRound');
    expect(viewSource).not.toContain('round 1 of {{rounds}}');

    // 面板、时序图标注与结果详情标注共用同一个 rounds >= 2 守卫（rounds <= 1 与 null 时页面与改动前一致）。
    const guardedCondition = 'v-if="simulator.results.multiRound && simulator.results.multiRound.rounds >= 2"';
    expect(viewSource.split(guardedCondition).length - 1).toBe(3);

    // 面板插入在 summary 表之后、Result Details 之前。
    const panelIndex = viewSource.indexOf('<HomeMultiRoundPanel');
    const detailsIndex = viewSource.indexOf("'common:vue.results.detailsTitle'");
    expect(panelIndex).toBeGreaterThan(0);
    expect(detailsIndex).toBeGreaterThan(panelIndex);

    // 结果详情区（标题下）同样渲染首成功轮标注：利润卡片与明细源于第 N 轮单轮结果，
    // 避免被读成上方聚合统计；首处标注必须落在 detailsTitle 与 TimeSeriesChart 之间。
    expect(viewSource.split('{{ firstRoundNoteText }}').length - 1).toBe(2);
    const detailsNoteIndex = viewSource.indexOf('{{ firstRoundNoteText }}');
    const timelineIndex = viewSource.indexOf('<TimeSeriesChart');
    expect(detailsNoteIndex).toBeGreaterThan(detailsIndex);
    expect(detailsNoteIndex).toBeLessThan(timelineIndex);

    // 多轮运行逐轮关闭战斗事件日志（内存权衡）：Wipe 空态必须换成说明文案，
    // 不能沿用单轮「未检测到团灭事件」（会把「未采集」误述为「没有团灭」）。
    expect(viewSource).toContain("'common:vue.results.multiRound.wipeEventsNotRecorded'");
    expect(viewSource).toContain('const wipeEventsEmptyText = computed(');
    expect(viewSource).toContain('multiRound && Number(multiRound.rounds) >= 2');
    expect(viewSource).toContain('{{ wipeEventsEmptyText }}');
    // 单轮回退文案只保留在 computed 里一处（模板不再直接内联调用）。
    expect(viewSource.split("t('common:noWipeEventsDetected'").length - 1).toBe(1);
  });

  it('routes kill-per-hour rates through formatNumber so large values compact', () => {
    // 击杀速率（Encounters/h 与各怪物 Kills/h）同走 formatNumber：≥1000 与页面 compact 口径一致缩写，
    // 不足 1000 保持数值格式；toFixed(1) 直拼会在 ≥1000 时输出 '1234.5/h' 这类未缩写文本（审计 B 类漏网）。
    expect(viewSource).toContain('${formatNumber(encountersPerHour)}/h');
    expect(viewSource).toContain('${formatNumber(Number(deaths || 0) / hours)}/h');
    expect(viewSource).not.toContain('.toFixed(1)}/h');
  });

  it('keeps wipe combat log damage and HP values exact instead of compact', () => {
    // wipe 战斗日志是逐事件诊断视图：伤害与 HP 三处必须走 formatExactNumber 保留个位精度，
    // 不允许退回 ≥1000 即缩写的 formatNumber（k/m/b 会损失个位精度，如 1423 显示为 1.42k）。
    expect(viewSource).toContain('function formatExactNumber(value)');
    expect(viewSource.split('formatExactNumber(log.').length - 1).toBe(3);
    expect(viewSource).not.toContain('formatNumber(log.');
  });
});
