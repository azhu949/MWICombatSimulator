import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('../pages/PatchNotesPage.vue', import.meta.url), 'utf8');
const sectionsSource = readFileSync(new URL('../components/PatchNoteSections.vue', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../router/index.js', import.meta.url), 'utf8');

describe('PatchNotesPage workspace', () => {
  it('registers a dedicated route without combat controls or automatic nav duplication', () => {
    expect(routerSource).toContain("path: '/patch-notes'");
    expect(routerSource).toContain("name: 'patch-notes'");
    expect(routerSource).toContain("import('../pages/PatchNotesPage.vue')");
    expect(routerSource).toContain('meta: { showCombatToolbar: false, navHidden: true,');
  });

  it('renders localized entries as categorized version cards using the shared sections component', () => {
    expect(pageSource).toContain('resolvePatchNoteEntries(undefined, language.value)');
    expect(pageSource).toContain("import PatchNoteSections from '../components/PatchNoteSections.vue'");
    expect(pageSource).toContain('<PatchNoteSections :sections="entry.sections" />');
    expect(pageSource).toContain('v-for="entry in entries"');
    expect(pageSource).toContain('{{ entry.label }}');
    // 分类组件按固定顺序仅在存在时渲染，子项使用无序列表
    expect(sectionsSource).toContain("key: 'newFeatures',");
    expect(sectionsSource).toContain("key: 'improvements',");
    expect(sectionsSource).toContain("key: 'bugFixes',");
    expect(sectionsSource).toContain('class="list-disc space-y-1.5 pl-6');
    expect(sectionsSource).toContain('Array.isArray(props.sections?.[section.key])');
    expect(pageSource).not.toContain('entry.notes');
    expect(pageSource).not.toContain('DisclosurePanel');
    expect(pageSource).not.toContain('BaseModal');
    expect(pageSource).not.toContain('max-h-[65vh]');
    expect(pageSource).toContain('common:vue.app.patchNotesPageDescription');
    expect(pageSource).toContain('common:vue.app.patchNotesMarkReadHint');
  });

  it('handles empty entries and renderable section content', () => {
    expect(pageSource).toContain('v-else class="surface-panel"');
    expect(pageSource).toContain('common:vue.app.patchNotesEmpty');
    // 空分类由组件内 v-if / v-else 兜底
    expect(sectionsSource).toContain('v-if="sectionList.length > 0"');
    expect(sectionsSource).toContain('v-else class="text-sm leading-6 text-foreground/85"');
    expect(sectionsSource).toContain("t('common:vue.app.patchNotesEmpty', 'No patch notes yet.')");
  });

  it('renders a left-hand version directory with scroll-spy navigation', () => {
    expect(pageSource).toContain('common:vue.app.patchNotesVersionsNav');
    expect(pageSource).toContain('scrollToEntry');
    expect(pageSource).toContain('activeEntryId');
    expect(pageSource).toContain('IntersectionObserver');
    expect(pageSource).toContain(':data-entry-id="entry.entryId"');
  });
});
