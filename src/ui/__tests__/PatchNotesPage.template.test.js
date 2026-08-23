import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('../pages/PatchNotesPage.vue', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../router/index.js', import.meta.url), 'utf8');

describe('PatchNotesPage workspace', () => {
  it('registers a dedicated route without combat controls or automatic nav duplication', () => {
    expect(routerSource).toContain("path: '/patch-notes'");
    expect(routerSource).toContain("name: 'patch-notes'");
    expect(routerSource).toContain("import('../pages/PatchNotesPage.vue')");
    expect(routerSource).toContain('meta: { showCombatToolbar: false, navHidden: true,');
  });

  it('renders localized entries in a responsive two-column page flow', () => {
    expect(pageSource).toContain('resolvePatchNoteEntries(undefined, language.value)');
    expect(pageSource).toContain('v-for="entry in entries"');
    expect(pageSource).toContain('md:grid-cols-[14rem_minmax(0,1fr)]');
    expect(pageSource).toContain('md:border-r');
    expect(pageSource).toContain('{{ entry.label }}');
    expect(pageSource).not.toContain('DisclosurePanel');
    expect(pageSource).toContain('common:vue.app.patchNotesPageDescription');
    expect(pageSource).toContain('common:vue.app.patchNotesMarkReadHint');
    expect(pageSource).not.toContain('BaseModal');
    expect(pageSource).not.toContain('max-h-[65vh]');
    expect(pageSource).not.toContain('overflow-y-auto');
  });

  it('handles empty entries and entries without note lines', () => {
    expect(pageSource).toContain('v-if="entry.notes.length > 0"');
    expect(pageSource).toContain('v-else class="text-sm leading-6 text-foreground/85"');
    expect(pageSource).toContain('v-else class="surface-panel"');
    expect(pageSource).toContain('common:vue.app.patchNotesEmpty');
  });
});
