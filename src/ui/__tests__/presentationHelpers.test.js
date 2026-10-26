import { describe, expect, it } from 'vitest';
import { buildAdvisorProgressPercent, buildAdvisorRuntimePhaseText } from '../advisorRuntimePresentation.js';
import { formatCurrency } from '../components/home/homeFormatters.js';
import {
  DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL,
  GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
  resolveMainSiteImportScriptUrl,
} from '../config/externalLinks.js';
import {
  IMPORT_SCRIPT_CHANNEL_GREASYFORK,
  IMPORT_SCRIPT_CHANNEL_SITE,
  buildImportScriptChannels,
  resolveLocalImportScriptUrl,
  resolveMainSiteImportScriptInstallUrl,
} from '../config/importScriptDistribution.js';
import { isQueueRunInProgress } from '../multiResultsPresentation.js';
import { deriveQueueItemStatusName } from '../queueItemStatusPresentation.js';
import { buildSkillingDrinkStatuses } from '../skillingDrinkPresentation.js';

// 2026-10-03 合并：原 6 个 UI 展示层纯函数测试文件（homeFormatters / externalLinks /
// multiResultsPresentation / queueItemStatusPresentation / advisorRuntimePresentation /
// skillingDrinkPresentation）。用例、断言与注释逐字保留，仅减少测试文件数——
// 全量墙钟瓶颈在文件数与 fork 启停。

describe('home formatters', () => {
  it.each([NaN, Infinity, -Infinity, 'NaN', 'invalid'])(
    'renders non-finite currency value %s as unavailable',
    (value) => {
      expect(formatCurrency(value)).toBe('-');
    },
  );

  it.each([null, undefined, ''])('keeps the zero fallback for empty currency value %s', (value) => {
    expect(formatCurrency(value)).toBe('0');
  });

  it('rounds and localizes finite currency values', () => {
    expect(formatCurrency(1234.6)).toBe(
      (1234.6).toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
    );
  });
});

describe('external link configuration', () => {
  it('defaults to the site-hosted script in a browser, GreasyFork outside one', () => {
    // 国内 GreasyFork 常打不开：浏览器里默认入口必须是站内同源下载。
    // 非浏览器环境（无 location，如 SSR / 本测试）无从拼站内地址，回退 GreasyFork。
    const browserLocation = {
      origin: 'https://mwi-combatsi-mulator.pages.dev',
      href: 'https://mwi-combatsi-mulator.pages.dev/',
    };
    const browserUrl = resolveMainSiteImportScriptInstallUrl(browserLocation);
    expect(browserUrl).toContain('/userscript/mwi-main-site-import.user.js');
    expect(browserUrl).not.toContain('greasyfork.org');

    expect(resolveMainSiteImportScriptInstallUrl(null)).toBe(GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL);

    // 模块级常量按当前运行环境的 location 求值：二者必须与解析结果一致，不能各说各话。
    expect(DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL).toBe(resolveMainSiteImportScriptInstallUrl());
    expect(resolveMainSiteImportScriptUrl(undefined)).toBe(DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL);
  });

  it('resolves the site-hosted path under every deployment base', () => {
    // 三种部署形态都必须落到同一份站内副本：GitHub Pages 子路径 / Cloudflare 根路径 / 本地 dev。
    const cases = [
      [
        { origin: 'https://azhu949.github.io', href: 'https://azhu949.github.io/MWICombatSimulator/#/home' },
        'https://azhu949.github.io/MWICombatSimulator/userscript/mwi-main-site-import.user.js',
      ],
      [
        { origin: 'https://mwi-combatsi-mulator.pages.dev', href: 'https://mwi-combatsi-mulator.pages.dev/' },
        'https://mwi-combatsi-mulator.pages.dev/userscript/mwi-main-site-import.user.js',
      ],
      [
        { origin: 'http://localhost:5173', href: 'http://localhost:5173/' },
        'http://localhost:5173/userscript/mwi-main-site-import.user.js',
      ],
    ];
    for (const [location, expected] of cases) {
      expect(resolveLocalImportScriptUrl(location)).toBe(expected);
    }
  });

  it('falls back to GreasyFork when the site location is unavailable', () => {
    expect(resolveMainSiteImportScriptInstallUrl(null)).toBe(GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL);
  });

  it('accepts a configured HTTP(S) URL', () => {
    expect(resolveMainSiteImportScriptUrl('  https://example.com/import-script  ')).toBe(
      'https://example.com/import-script',
    );
  });

  it('disables the link when the override is empty', () => {
    expect(resolveMainSiteImportScriptUrl('')).toBe('');
    expect(resolveMainSiteImportScriptUrl('   ')).toBe('');
  });

  it('disables malformed and non-HTTP(S) overrides', () => {
    expect(resolveMainSiteImportScriptUrl('not a URL')).toBe('');
    expect(resolveMainSiteImportScriptUrl('javascript:alert(1)')).toBe('');
    expect(resolveMainSiteImportScriptUrl('false')).toBe('');
  });

  it('offers site download first and GreasyFork second as update channels', () => {
    const channels = buildImportScriptChannels({
      primaryUrl: '  https://mwi-combatsi-mulator.pages.dev/userscript/mwi-main-site-import.user.js  ',
      greasyforkUrl: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
    });

    expect(channels).toEqual([
      {
        key: IMPORT_SCRIPT_CHANNEL_SITE,
        url: 'https://mwi-combatsi-mulator.pages.dev/userscript/mwi-main-site-import.user.js',
      },
      { key: IMPORT_SCRIPT_CHANNEL_GREASYFORK, url: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL },
    ]);
  });

  it('de-duplicates identical channel URLs and skips blank entries', () => {
    // 无 location 的 SSR/测试环境里主入口会回退到 GreasyFork：不能显示两个同样的选项。
    expect(
      buildImportScriptChannels({
        primaryUrl: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
        greasyforkUrl: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
      }),
    ).toEqual([{ key: IMPORT_SCRIPT_CHANNEL_SITE, url: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL }]);

    // 主入口被禁用时只剩 GreasyFork，且必须保持 greasyfork 标识（不能标成站点下载）。
    expect(buildImportScriptChannels({ primaryUrl: '   ', greasyforkUrl: ' https://greasyfork.org/x ' })).toEqual([
      { key: IMPORT_SCRIPT_CHANNEL_GREASYFORK, url: 'https://greasyfork.org/x' },
    ]);
    expect(buildImportScriptChannels({ primaryUrl: '', greasyforkUrl: '' })).toEqual([]);
  });
});

describe('multiResultsPresentation', () => {
  it('treats active queue runs as running', () => {
    expect(
      isQueueRunInProgress({
        isRunning: true,
        lastRunStatus: 'running',
      }),
    ).toBe(true);
  });

  it('does not treat baseline runs as queue runs', () => {
    expect(
      isQueueRunInProgress({
        isRunning: true,
        lastRunStatus: 'idle',
      }),
    ).toBe(false);
  });

  it('does not treat finished queue runs as running', () => {
    expect(
      isQueueRunInProgress({
        isRunning: false,
        lastRunStatus: 'completed',
      }),
    ).toBe(false);
  });
});

describe('queueItemStatusPresentation', () => {
  function translate(key, fallback, params = {}) {
    const table = {
      'common:queue.itemEnhancementChange': '{{name}}: 强化 {{from}} -> {{to}}',
      'common:queue.skillLevelChange': '{{name}}: 等级 {{from}} -> {{to}}',
      'common:queue.itemNameWithMore': '{{name}} +{{count}}',
      'common:queue.triggerLabel': '触发器',
    };
    const template = String(table[key] || fallback || key);
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token) => String(params[token] ?? ''));
  }

  it('localizes equipment enhancement status names', () => {
    expect(
      deriveQueueItemStatusName(
        [
          {
            kind: 'equipment',
            slot: 'ring',
            beforeItemHrid: '/items/ring_of_regeneration',
            afterItemHrid: '/items/ring_of_regeneration',
            beforeEnhancementLevel: 5,
            afterEnhancementLevel: 6,
          },
        ],
        {
          t: translate,
          resolveItemName: (hrid) => (hrid === '/items/ring_of_regeneration' ? '再生之戒' : String(hrid || '')),
        },
      ),
    ).toBe('再生之戒: 强化 5 -> 6');
  });

  it('collapses multiple localized changes into a compact summary', () => {
    expect(
      deriveQueueItemStatusName(
        [
          {
            kind: 'equipment',
            beforeItemHrid: '/items/ring_of_regeneration',
            afterItemHrid: '/items/ring_of_regeneration',
            beforeEnhancementLevel: 5,
            afterEnhancementLevel: 6,
          },
          {
            kind: 'ability',
            beforeAbilityHrid: '/abilities/fireball',
            afterAbilityHrid: '/abilities/fireball',
            beforeLevel: 1,
            afterLevel: 2,
          },
        ],
        {
          t: translate,
          resolveItemName: (hrid) => (hrid === '/items/ring_of_regeneration' ? '再生之戒' : String(hrid || '')),
          resolveAbilityName: (hrid) => (hrid === '/abilities/fireball' ? '火球术' : String(hrid || '')),
        },
      ),
    ).toBe('再生之戒: 强化 5 -> 6 +1');
  });
});

describe('advisorRuntimePresentation', () => {
  // 页面与顶栏共用的阶段文案 helper：t 未命中时回退默认英文文案。
  const fallbackTranslate = (_key, fallback) => fallback;

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

describe('skillingDrinkPresentation', () => {
  it('describes newly consumed drinks and their ending remainder', () => {
    expect(
      buildSkillingDrinkStatuses({
        drinks: [{ itemHrid: '/items/artisan_tea', count: 1, carriedDurationSeconds: 0 }],
        endingDrinkState: {
          itemsByHrid: { '/items/artisan_tea': { remainingSeconds: 291 } },
        },
      }),
    ).toEqual([
      {
        itemHrid: '/items/artisan_tea',
        consumedCount: 1,
        continued: false,
        endingKnown: true,
        remainingSeconds: 291,
        usedUp: false,
      },
    ]);
  });

  it('distinguishes a continued drink from an additional consumed drink', () => {
    expect(
      buildSkillingDrinkStatuses({
        drinks: [{ itemHrid: '/items/artisan_tea', count: 0, carriedDurationSeconds: 291 }],
        endingDrinkState: {
          itemsByHrid: { '/items/artisan_tea': { remainingSeconds: 282 } },
        },
      })[0],
    ).toMatchObject({
      consumedCount: 0,
      continued: true,
      remainingSeconds: 282,
      usedUp: false,
    });
    expect(
      buildSkillingDrinkStatuses({
        drinks: [{ itemHrid: '/items/artisan_tea', count: 2, carriedDurationSeconds: 30 }],
        endingDrinkState: {
          itemsByHrid: { '/items/artisan_tea': { remainingSeconds: 120 } },
        },
      })[0],
    ).toMatchObject({
      consumedCount: 2,
      continued: true,
      remainingSeconds: 120,
    });
  });

  it('reports a known exhausted drink without treating unknown state as exhausted', () => {
    expect(
      buildSkillingDrinkStatuses({
        drinks: [{ itemHrid: '/items/artisan_tea', count: 111 }],
        endingDrinkState: {
          itemsByHrid: { '/items/artisan_tea': { remainingSeconds: 0 } },
        },
      })[0],
    ).toMatchObject({ endingKnown: true, usedUp: true });
    expect(
      buildSkillingDrinkStatuses({
        drinks: [{ itemHrid: '/items/artisan_tea', count: 1 }],
      })[0],
    ).toMatchObject({ endingKnown: false, usedUp: false });
  });

  it('keeps exhaustion known when a merged route ends with a no-drink tail', () => {
    expect(
      buildSkillingDrinkStatuses({
        drinks: [{ itemHrid: '/items/artisan_tea', count: 1 }],
        endingDrinkState: null,
        phases: [
          {
            drinks: [{ itemHrid: '/items/artisan_tea', count: 1 }],
            endingDrinkState: {
              itemsByHrid: { '/items/artisan_tea': { remainingSeconds: 0 } },
            },
          },
          { drinks: [], endingDrinkState: null },
        ],
      })[0],
    ).toMatchObject({
      endingKnown: true,
      remainingSeconds: 0,
      usedUp: true,
    });
  });

  it('keeps independent status for multiple drinks in a merged stage', () => {
    const statuses = buildSkillingDrinkStatuses({
      drinks: [
        { itemHrid: '/items/artisan_tea', count: 2, carriedDurationSeconds: 30 },
        { itemHrid: '/items/wisdom_tea', count: 0, carriedDurationSeconds: 180 },
      ],
      endingDrinkState: {
        itemsByHrid: {
          '/items/artisan_tea': { remainingSeconds: 120 },
          '/items/wisdom_tea': { remainingSeconds: 0 },
        },
      },
    });

    expect(statuses).toEqual([
      expect.objectContaining({
        itemHrid: '/items/artisan_tea',
        consumedCount: 2,
        continued: true,
        remainingSeconds: 120,
        usedUp: false,
      }),
      expect.objectContaining({
        itemHrid: '/items/wisdom_tea',
        consumedCount: 0,
        continued: true,
        remainingSeconds: 0,
        usedUp: true,
      }),
    ]);
  });
});
