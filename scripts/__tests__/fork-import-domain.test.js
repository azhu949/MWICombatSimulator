import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { resolveImportScriptCoverage } from '../../src/services/mainSiteImportScriptStatus.js';
import { readUserscriptMetadataFromBytes } from '../userscript-metadata.mjs';

const source = readFileSync(new URL('../mwi-main-site-import.user.js', import.meta.url), 'utf8');
const { matches } = readUserscriptMetadataFromBytes(Buffer.from(source));
const predicate = source.match(/function isSimulatorPage\(\) \{[\s\S]*?\n  \}/)[0];

describe('main-site import deployment domains', () => {
  it.each([
    'https://reroger.github.io/MWICombatSimulator/#/home',
    'https://azhu949.github.io/MWICombatSimulator/#/home',
    'https://mwi-combatsi-mulator.pages.dev/#/home',
    'http://localhost:5173/#/home',
    'http://127.0.0.1:5173/#/home',
  ])('runs the userscript and enables the import button on %s', (href) => {
    expect(resolveImportScriptCoverage(href, matches)).toBe('covered');
    const window = { location: new URL(href) };
    expect(runInNewContext(`${predicate}; isSimulatorPage()`, { window })).toBe(true);
  });

  it('does not cover other GitHub Pages users or unrelated repository paths', () => {
    for (const href of ['https://example.github.io/MWICombatSimulator/', 'https://reroger.github.io/other/']) {
      expect(resolveImportScriptCoverage(href, matches)).toBe('uncovered');
    }
    const window = { location: new URL('https://example.github.io/MWICombatSimulator/') };
    expect(runInNewContext(`${predicate}; isSimulatorPage()`, { window })).toBe(false);
  });
});
