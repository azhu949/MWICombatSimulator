// 技能优化（触发器优化器）——结果卡片与详情弹窗共用的文案 / 数值格式化 + 报告取值口径。
//
// 为什么单独成模块：结果卡片与详情弹窗都要渲染「触发器行」「候选标签」「指标数值」，
// 两处各写一份必然漂移（同一个候选在卡片上叫「生命 ≤ 75%」、在弹窗里叫别的），
// 而这一页的全部价值就是「两处口径一致、可以直接对着看」。
//
// 依赖注入（t / number / getOfficialGameText）而不是在模块里 import composable：
// 这里是纯函数集合，能被单测直接驱动，也不绑定 Vue 生命周期。
import { TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS } from '../../services/triggerOptimizerCandidates.js';
import { TRIGGER_OPTIMIZER_METRIC_KEYS } from '../../services/triggerOptimizerDomain.js';
import { getDefaultTriggerDtosForHrid } from '../../services/triggerMapper.js';

// 原始配置（搜索起点）在报告里的位置：候选表里的「当前配置」锚点——生成器在用户配置
// 非空时必然产出它（锚点排在最前，candidateLimit 截断不会切掉）。
// 返回 null 表示「当时没有自定义配置」＝游戏默认触发器；返回 [] 表示「立即释放」。
// 注意：不要改读玩家当前的 triggerMap —— 应用结果后那份配置已经被改写成最优配置，
// 拿它当「原始配置」会让对比两边同时变成新配置（本页最重要的一行就此失效）。
export function resolveOriginalTriggers(choice) {
  const candidates = Array.isArray(choice?.candidates) ? choice.candidates : [];
  const anchor = candidates.find((candidate) => candidate?.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.current);
  if (!anchor) return null;
  return Array.isArray(anchor.triggers) ? anchor.triggers : null;
}

// 报告终态里该技能的配置（bestTriggerMap）：键不存在 = 删键 = 游戏默认触发器。
// 报告缺 bestTriggerMap（无终态，例如异常收尾）时回落到 fallback（调用方传原始配置）。
export function resolveBestTriggers(bestTriggerMap, abilityHrid, fallback = null) {
  const map = bestTriggerMap && typeof bestTriggerMap === 'object' ? bestTriggerMap : null;
  if (!map) return fallback;
  const hrid = String(abilityHrid || '');
  if (!hrid || !Object.prototype.hasOwnProperty.call(map, hrid)) return null;
  const triggers = map[hrid];
  return Array.isArray(triggers) ? triggers : null;
}

// 本槽净效应（配对差，§27）：chosen.paired.metrics 是逐指标配对统计（mean / stdError /
// verdict），而 chosen 的配对参考系是「本槽开跑时的配置」——它逐指标的配对差就是本槽改动
// 的净效应（不含同轮其它技能的改动，那是累计表的口径）。结果卡片直显与详情弹窗共用本取数
// 口径，两处不得分叉；「只在采纳时渲染」由调用方判定（未采纳的槽没有「本槽改动」）。
export function buildNetMetricRows(choice) {
  const metricKeys = [...TRIGGER_OPTIMIZER_METRIC_KEYS, 'deathsPerHour'];
  const pairedMetrics = choice?.chosen?.paired?.metrics ?? null;
  if (!pairedMetrics || typeof pairedMetrics !== 'object') return [];
  const rows = [];
  for (const key of metricKeys) {
    const summary = pairedMetrics[key];
    // 缺统计（mean 为 null / 非有限）→ 不产行，而不是把 null 当成 0 上屏。
    const rawMean = summary?.mean;
    if (rawMean == null) continue;
    const mean = Number(rawMean);
    if (!Number.isFinite(mean)) continue;
    // 标准误要单独判 null：Number(null) === 0 会把「轮数不足、无从估计」画成「± 0」。
    const rawStdError = summary?.stdError;
    const stdError = rawStdError == null ? null : Number(rawStdError);
    rows.push({
      key,
      mean,
      stdError: Number.isFinite(stdError) ? stdError : null,
      verdict: String(summary?.verdict ?? 'unknown'),
    });
  }
  return rows;
}

// 显著性三态**方向中立**：逐指标 verdict 的 positive/negative 只说「比参考大/小」，
// 直接套 signals 文案会把「死亡显著下降」渲染成「显著更差」（死亡越低越好，方向与分数
// 相反）。这里只回答「是否超出噪声」，方向交给配对差的符号。
export function netMetricSignificanceKey(verdict) {
  if (verdict === 'positive' || verdict === 'negative') return 'significant';
  if (verdict === 'inconclusive') return 'inconclusive';
  return 'unknown';
}

// 配对信号配色：positive 绿、negative 红、其余（不显著/样本不足）保持中性——
// 不把「没测出来」渲染成「好」或「坏」。
export function triggerVerdictTextClass(verdict) {
  if (verdict === 'positive') return 'text-success';
  if (verdict === 'negative') return 'text-destructive';
  return 'text-muted-foreground';
}

export function triggerVerdictBadgeClass(verdict) {
  if (verdict === 'positive') return 'bg-success/10 text-success';
  if (verdict === 'negative') return 'bg-destructive/10 text-destructive';
  return 'bg-muted text-muted-foreground';
}

// 指标方向：dps/利润/经验/击杀越高越好；死亡越高越差（设计 §5.2 只惩罚增加）。
export function triggerMetricDeltaClass(key, absolute) {
  const value = Number(absolute || 0);
  if (!value) return '';
  if (key === 'deathsPerHour') return value > 0 ? 'text-destructive' : 'text-success';
  return value > 0 ? 'text-success' : 'text-destructive';
}

// 两侧配置面板的配色（2026-09-22，用户要求「当前配置与最优配置用不同颜色高亮」＋「最优配置要显眼」）：
//   当前配置（搜索起点）= info 冷蓝 —— 「你现在是什么样」；
//   模拟最优配置 = primary 主色 —— 「会变成什么样」，并按**是否真的改了**分两档强度。
// 两档都不弱于左侧（最优侧是这张卡的主角）：改了 = 更亮的暖色底，没改 = 与左侧同强度的暖色底。
// 仍然区分两档是因为「与当前配置相同」也照最亮的方式高亮，会把真正的改动淹没在整屏高亮里
// —— 实测一轮 5 个技能通常只有 1 个被采纳。
// 一度有过一条左侧竖条来强调「改了」，用户看后要求去掉（2026-09-22）→ 只靠底色调分档，
// 改动那一档因此再提亮一级（/15 → /20），免得去掉竖条后两档看不出差别。
// 卡片与详情弹窗共用这两个值，同一份报告在两处不能出现两种配色。
export const TRIGGER_ORIGINAL_PANEL_CLASS = 'border-info/40 bg-info/10';
export function triggerBestPanelClass(changed) {
  return changed ? 'border-primary/60 bg-primary/20' : 'border-primary/40 bg-primary/10';
}

export function createTriggerOptimizerText({ t, number, getOfficialGameText }) {
  // 带符号数值（+0.42 / -0.05）：0 也带正号，与页面既有口径一致。
  function signed(value, digits = 2) {
    const numeric = Number(value || 0);
    return `${numeric >= 0 ? '+' : ''}${number(numeric, digits)}`;
  }

  // 日利润与经验沿用队列/多结果页的 compact k/m 口径，dps 与击杀一位小数，死亡两位小数。
  function formatCompactKmb(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    const abs = Math.abs(numeric);
    if (abs >= 1e9) return `${(numeric / 1e9).toFixed(digits)}b`;
    if (abs >= 1e6) return `${(numeric / 1e6).toFixed(digits)}m`;
    if (abs >= 1e3) return `${(numeric / 1e3).toFixed(digits)}k`;
    return number(numeric, digits);
  }

  function formatMetricValue(key, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    if (key === 'dailyNoRngProfit' || key === 'xpPerHour') return formatCompactKmb(numeric);
    if (key === 'deathsPerHour') return number(numeric, 2);
    return number(numeric, 1);
  }

  // 带符号的差值：利润/经验走 compact，其余按指标精度（0 不带正负号）。
  function signedCompact(key, value) {
    const numeric = Number(value || 0);
    if (numeric === 0) return formatMetricValue(key, 0);
    const body =
      key === 'dailyNoRngProfit' || key === 'xpPerHour'
        ? formatCompactKmb(Math.abs(numeric))
        : number(Math.abs(numeric), key === 'deathsPerHour' ? 2 : 1);
    return `${numeric > 0 ? '+' : '-'}${body}`;
  }

  // 触发器条目文本（与 FoodOptimizerDetails.formatTrigger 同款口径）。
  function formatTriggerLine(trigger) {
    const dependency = getOfficialGameText('combatTriggerDependencyNames', trigger.dependencyHrid);
    const condition = getOfficialGameText('combatTriggerConditionNames', trigger.conditionHrid);
    const comparator = getOfficialGameText('combatTriggerComparatorNames', trigger.comparatorHrid);
    const value = String(trigger.comparatorHrid || '').endsWith('_equal') ? number(trigger.value) : '';
    return `${dependency} ${condition} ${comparator} ${value}`.trim();
  }

  // 候选的触发器摘要：default 态没有自定义触发器（删键，回落游戏默认）；空列表由候选标签说明。
  function triggerSummary(candidate) {
    if (!candidate) return '';
    if (candidate.state === 'default') return t('common:triggerOptimizer.defaultTriggers', '');
    if (!Array.isArray(candidate.triggers) || candidate.triggers.length === 0) return '';
    return candidate.triggers.map((trigger) => formatTriggerLine(trigger)).join('; ');
  }

  // 候选标签：百分比 / 计数 / 敌方血量绝对值 / 条件名的 i18n 插值。
  function candidateLabel(candidate) {
    const params = candidate?.labelParams || {};
    const interpolation = {};
    if (params.percent != null) interpolation.percent = params.percent;
    if (params.count != null) interpolation.count = params.count;
    if (params.mpPercent != null) interpolation.mpPercent = params.mpPercent;
    // 敌方血量类候选（enemyGroupHp / enemyTargetHp / executeHp）的插值是**绝对值**
    // （按区域真实怪物血量换算），不是百分比——用百分比展示会误导。
    if (params.value != null) interpolation.value = number(params.value, 0);
    if (params.conditionHrid) {
      interpolation.condition = getOfficialGameText('combatTriggerConditionNames', params.conditionHrid);
    }
    return t(candidate?.labelKey || '', '', interpolation);
  }

  // ── 配置对比（卡片与详情弹窗共用）────────────────────────────────────────
  // 一侧的「行文本」：null（删键 = 游戏默认触发器）展开成**默认列表本身**，而不是一句
  // 「游戏默认触发器」——只写一句话，用户没法与对侧逐条对照，而且「用户配置恰好等价于
  // 默认」时（生成器会按行为等价去重、丢掉「当前配置」锚点）会渲染成一次假改动。
  // 空列表（立即释放）与「默认列表本身为空」都得到空数组：两者行为等价，同一口径。
  function configLineTexts(triggers, abilityHrid) {
    if (triggers == null) {
      const dtos = getDefaultTriggerDtosForHrid(String(abilityHrid || ''));
      return Array.isArray(dtos) ? dtos.map((trigger) => formatTriggerLine(trigger)) : [];
    }
    return Array.isArray(triggers) ? triggers.map((trigger) => formatTriggerLine(trigger)) : [];
  }

  // 逐行对比：对侧没有的那一行才算改动（两侧都按上面的行文本口径展开）。
  // 空列表渲染成「立即释放」一行（唯一没有触发器条目可列的形态）。
  function configLines(triggers, otherTriggers, abilityHrid) {
    const texts = configLineTexts(triggers, abilityHrid);
    const otherTexts = configLineTexts(otherTriggers, abilityHrid);
    if (texts.length === 0) {
      return [{ text: t('common:triggerOptimizer.candidate.alwaysFire', ''), changed: otherTexts.length > 0 }];
    }
    const otherSet = new Set(otherTexts);
    return texts.map((text) => ({ text, changed: !otherSet.has(text) }));
  }

  // 两份配置是否等价（集合口径，与上面的「改动标记」同一套判据，不会出现「标了相同却
  // 有圆点」这种自相矛盾的渲染）。
  function configsMatch(left, right, abilityHrid) {
    const leftTexts = new Set(configLineTexts(left, abilityHrid));
    const rightTexts = new Set(configLineTexts(right, abilityHrid));
    if (leftTexts.size !== rightTexts.size) return false;
    for (const text of leftTexts) if (!rightTexts.has(text)) return false;
    return true;
  }

  // 净效应表的「配对差」格：rounds < 2 时标准误无从估计（报告给 null）→「± —」，
  // 而不是 Number(null) === 0 的「± 0」（一个不存在的确定性）。
  function netDeltaText(row) {
    const se = row.stdError == null ? '—' : signedCompact(row.key, row.stdError);
    return `${signedCompact(row.key, row.mean)} ± ${se}`;
  }

  // 净效应显著性文案（方向中立三态，见 netMetricSignificanceKey）。
  function netMetricSignificanceLabel(verdict) {
    return t(`common:triggerOptimizer.metricSignificance.${netMetricSignificanceKey(verdict)}`);
  }

  return {
    signed,
    formatCompactKmb,
    formatMetricValue,
    signedCompact,
    formatTriggerLine,
    triggerSummary,
    candidateLabel,
    configLineTexts,
    configLines,
    configsMatch,
    netDeltaText,
    netMetricSignificanceLabel,
  };
}
