import { describe, expect, it } from 'vitest';
import { appScrollBehavior } from '../router/scrollBehavior.js';

describe('appScrollBehavior', () => {
  it('returns the saved browser history position when available', () => {
    const savedPosition = { left: 12, top: 345 };

    expect(appScrollBehavior({}, {}, savedPosition)).toBe(savedPosition);
  });

  it('preserves scroll for same-page query cleanup navigations', () => {
    expect(appScrollBehavior({ path: '/home', hash: '' }, { path: '/home', hash: '' }, null)).toBe(false);
  });

  it('scrolls guide hash links below the sticky header', () => {
    expect(appScrollBehavior({ path: '/guide', hash: '#queue' }, { path: '/guide', hash: '#combat' }, null)).toEqual({
      el: '#queue',
      top: 144,
    });
  });

  it('uses the actual sticky header height on narrow layouts', () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
      querySelector: () => ({
        getBoundingClientRect: () => ({ height: 296 }),
      }),
    };

    try {
      expect(appScrollBehavior({ path: '/guide', hash: '#queue' }, { path: '/guide', hash: '#combat' }, null)).toEqual({
        el: '#queue',
        top: 312,
      });
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it('resets regular route changes back to the top', () => {
    expect(appScrollBehavior({ path: '/home', hash: '' }, { path: '/queue', hash: '' }, null)).toEqual({ top: 0 });
  });
});
