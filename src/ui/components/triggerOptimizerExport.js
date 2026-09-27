// 报告导出 Excel（2026-09-24，设计 §40）—— 纯构建（buildTriggerOptimizerReportSheets）
// 与下载封装（downloadTriggerOptimizerReportXlsx）。
//
// 为什么单独成模块：导出的每一格文案都必须与界面**同款**（判据②：人可读、不出现字段名），
// 因此行文本 / 候选标签 / 分数格式全部复用 triggerOptimizerText（依赖注入 t / number /
// getOfficialGameText），本模块不自己造任何文案。纯函数部分可被单测直接驱动。
//
// 分数口径（已实证，勿改）：chosen 自带重估分数（chosen.score）；其余候选按报告的
// 「槽位|签名」键（`${slotIndex}|${signature}`）读 metricsByCandidate —— 不同技能可能
// 产出同一份触发器列表（同签名），只按签名做键会串味。
import { resolveBestTriggers, resolveOriginalTriggers } from './triggerOptimizerText.js';

export const TRIGGER_OPTIMIZER_REPORT_EXPORT_BASENAME = 'mwi-trigger-optimizer-report';

// 候选的取数入口：签名与 chosen 相同 → chosen（重估口径）；否则 metricsByCandidate。
function resolveCandidateEntry(report, choice, candidate) {
  const chosen = choice?.chosen;
  if (chosen && String(candidate?.signature ?? '') === String(chosen.signature ?? '')) {
    return chosen;
  }
  const key = `${Number(choice?.slotIndex) || 0}|${String(candidate?.signature ?? '')}`;
  const entry = report?.metricsByCandidate?.[key];
  return entry && typeof entry === 'object' ? entry : null;
}

// 分数格：非有限数留空（不编 0 分——那会被读成「与当前配置等价」）。
function scoreCell(entry, text) {
  const value = Number(entry?.score);
  return Number.isFinite(value) ? text.signed(value, 4) : '';
}

// 信号格：与卡片徽章同源（entry.paired 存在才有信号；verdict 缺失按 unknown，无值留空）。
function signalCell(entry, t) {
  const paired = entry?.paired;
  if (!paired) return '';
  return t(`common:triggerOptimizer.signals.${paired.score?.verdict || 'unknown'}`, '');
}

// 配置格：行文本换行拼接；空列表（立即释放）是唯一没有条目可列的形态。
function configCell(text, t, triggers, abilityHrid) {
  const lines = text.configLineTexts(triggers, abilityHrid);
  if (lines.length === 0) return t('common:triggerOptimizer.candidate.alwaysFire', '');
  return lines.join('\n');
}

export function buildTriggerOptimizerReportSheets({ report, summaryRows, statusBySlot, text, t, getAbilityName }) {
  const choices = Array.isArray(report?.perAbilityChoices) ? report.perAbilityChoices : [];

  const summarySheet = {
    name: t('common:triggerOptimizer.export.sheetSummary', 'Summary'),
    columns: [
      { header: t('common:triggerOptimizer.export.item', 'Item'), key: 'item', width: 28 },
      { header: t('common:triggerOptimizer.export.value', 'Value'), key: 'value', width: 96 },
    ],
    // 行 = 页面组装的 summaryRows 透传（结论 / 得分 / 复验 / 范围 / 设置全部与界面同源）。
    rows: summaryRows,
  };

  const abilityRows = choices.map((choice) => {
    const chosen = choice?.chosen ?? null;
    const originalTriggers = resolveOriginalTriggers(choice);
    const bestTriggers = resolveBestTriggers(report?.bestTriggerMap, choice?.abilityHrid, originalTriggers);
    const entry = resolveCandidateEntry(report, choice, chosen);
    return {
      slot: Number(choice?.slotIndex) + 1,
      ability: getAbilityName(choice?.abilityHrid),
      role: t(choice?.roleLabelKey || '', ''),
      status: statusBySlot?.[choice?.slotIndex] ?? '',
      candidate: text.candidateLabel(chosen),
      score: scoreCell(entry, text),
      signal: signalCell(entry, t),
      currentConfig: configCell(text, t, originalTriggers, choice?.abilityHrid),
      bestConfig: configCell(text, t, bestTriggers, choice?.abilityHrid),
    };
  });
  const abilitiesSheet = {
    name: t('common:triggerOptimizer.export.sheetAbilities', 'Per-ability comparison'),
    columns: [
      { header: t('common:triggerOptimizer.export.slot', 'Slot'), key: 'slot', width: 8 },
      { header: t('common:triggerOptimizer.export.ability', 'Ability'), key: 'ability', width: 18 },
      { header: t('common:triggerOptimizer.export.role', 'Role'), key: 'role', width: 12 },
      { header: t('common:triggerOptimizer.export.status', 'Status'), key: 'status', width: 16 },
      { header: t('common:triggerOptimizer.export.candidate', 'Candidate'), key: 'candidate', width: 22 },
      { header: t('common:triggerOptimizer.score', 'Score'), key: 'score', width: 12 },
      { header: t('common:triggerOptimizer.export.signal', 'Signal'), key: 'signal', width: 14 },
      {
        header: t('common:triggerOptimizer.originalConfig', 'Current setup (search start)'),
        key: 'currentConfig',
        width: 46,
      },
      { header: t('common:triggerOptimizer.bestConfig', 'Simulated best setup'), key: 'bestConfig', width: 46 },
    ],
    rows: abilityRows,
  };

  const candidateRows = [];
  for (const choice of choices) {
    for (const candidate of Array.isArray(choice?.candidates) ? choice.candidates : []) {
      const entry = resolveCandidateEntry(report, choice, candidate);
      candidateRows.push({
        slot: Number(choice?.slotIndex) + 1,
        ability: getAbilityName(choice?.abilityHrid),
        candidate: text.candidateLabel(candidate),
        triggers: text.triggerSummary(candidate),
        score: scoreCell(entry, text),
        signal: signalCell(entry, t),
      });
    }
  }
  const candidatesSheet = {
    name: t('common:triggerOptimizer.export.sheetCandidates', 'All candidates'),
    columns: [
      { header: t('common:triggerOptimizer.export.slot', 'Slot'), key: 'slot', width: 8 },
      { header: t('common:triggerOptimizer.export.ability', 'Ability'), key: 'ability', width: 18 },
      { header: t('common:triggerOptimizer.export.candidate', 'Candidate'), key: 'candidate', width: 22 },
      { header: t('common:triggerOptimizer.export.triggers', 'Triggers'), key: 'triggers', width: 46 },
      { header: t('common:triggerOptimizer.score', 'Score'), key: 'score', width: 12 },
      { header: t('common:triggerOptimizer.export.signal', 'Signal'), key: 'signal', width: 14 },
    ],
    rows: candidateRows,
  };

  return [summarySheet, abilitiesSheet, candidatesSheet];
}

// 下载封装（照 MultiResultsPage 的 exceljs 范式）：动态 import（vite 已拆独立 chunk）→
// writeBuffer → Blob → 临时 <a> 下载 → 回收。文件名带时间戳（判据②）。
export async function downloadTriggerOptimizerReportXlsx(options) {
  const sheets = buildTriggerOptimizerReportSheets(options);
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'MWI Combat Simulator';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.columns = sheet.columns;
    worksheet.addRows(sheet.rows);
    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF334155' },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${TRIGGER_OPTIMIZER_REPORT_EXPORT_BASENAME}-${Date.now()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
