import { describe, expect, it } from 'vitest';
import { buildAdvisorProgressPercent, buildAdvisorRuntimePhaseText } from '../advisorRuntimePresentation.js';

// 页面与顶栏共用的阶段文案 helper：t 未命中时回退默认英文文案。
const fallbackTranslate = (_key, fallback) => fallback;

describe('advisorRuntimePresentation', () => {
  describe('buildAdvisorRuntimePhaseText', () => {
    it('labels the quick scan phase with completed/total counters', () => {
      const runtime = { phase: 'quick_scan', quickCompleted: 3, quickTotal: 10 };
      expect(buildAdvisorRuntimePhaseText(runtime, fallbackTranslate)).toBe('Quick scan in progress · 3/10');
    });

    it('labels the refine phase with completed/total counters', () => {
      const runtime = { phase: 'refine_top', refineCompleted: 2, refineTotal: 5 };
      expect(buildAdvisorRuntimePhaseText(runtime, fallbackTranslate)).toBe('Refining top picks · 2/5');
    });

    it('renders fixed copy for done and cancelled phases', () => {
      expect(buildAdvisorRuntimePhaseText({ phase: 'done' }, fallbackTranslate)).toBe('Scan complete');
      expect(buildAdvisorRuntimePhaseText({ phase: 'cancelled' }, fallbackTranslate)).toBe('Scan stopped');
    });

    it('falls back to the idle copy for missing or unknown phases', () => {
      expect(buildAdvisorRuntimePhaseText({}, fallbackTranslate)).toBe('Idle');
      expect(buildAdvisorRuntimePhaseText(null, fallbackTranslate)).toBe('Idle');
      expect(buildAdvisorRuntimePhaseText({ phase: 'unexpected' }, fallbackTranslate)).toBe('Idle');
    });

    it('zero-fills missing quick and refine counters', () => {
      expect(buildAdvisorRuntimePhaseText({ phase: 'quick_scan' }, fallbackTranslate)).toBe(
        'Quick scan in progress · 0/0',
      );
      expect(buildAdvisorRuntimePhaseText({ phase: 'refine_top' }, fallbackTranslate)).toBe('Refining top picks · 0/0');
    });

    it('uses fallback copy when translate is not a function', () => {
      expect(buildAdvisorRuntimePhaseText({ phase: 'done' })).toBe('Scan complete');
      expect(buildAdvisorRuntimePhaseText({ phase: 'quick_scan', quickCompleted: 1, quickTotal: 4 })).toBe(
        'Quick scan in progress · 1/4',
      );
    });
  });

  describe('buildAdvisorProgressPercent', () => {
    it('rounds the progress fraction to a whole percent', () => {
      expect(buildAdvisorProgressPercent({ progress: 0 })).toBe(0);
      expect(buildAdvisorProgressPercent({ progress: 0.123 })).toBe(12);
      expect(buildAdvisorProgressPercent({ progress: 0.456 })).toBe(46);
      expect(buildAdvisorProgressPercent({ progress: 1 })).toBe(100);
    });

    it('tolerates empty or non-numeric progress values', () => {
      expect(buildAdvisorProgressPercent(null)).toBe(0);
      expect(buildAdvisorProgressPercent(undefined)).toBe(0);
      expect(buildAdvisorProgressPercent({})).toBe(0);
      expect(buildAdvisorProgressPercent({ progress: Number.NaN })).toBe(0);
      expect(buildAdvisorProgressPercent({ progress: '0.42' })).toBe(42);
    });
  });
});
