import { readFileSync } from 'node:fs';
import { baseParse, NodeTypes } from '@vue/compiler-dom';
import { parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

const componentFiles = {
  home: '../pages/HomePage.vue',
  homeSimulation: '../components/home/HomeSimulationPanel.vue',
  homeEquipment: '../components/home/HomeEquipmentPanel.vue',
  homeLoadout: '../components/home/HomeLoadoutPanels.vue',
  enhancement: '../pages/EnhancementPage.vue',
  settings: '../pages/SettingsPage.vue',
  skilling: '../pages/SkillingPage.vue',
  results: '../components/SimulationResultsView.vue',
};

function collectTemplateTags(relativePath) {
  const filename = new URL(relativePath, import.meta.url);
  const source = readFileSync(filename, 'utf8');
  const { descriptor, errors } = parse(source, { filename: filename.pathname });
  expect(errors).toEqual([]);
  expect(descriptor.template).not.toBeNull();

  const tags = [];
  function visit(node) {
    if (node.type === NodeTypes.ELEMENT) tags.push(node.tag);
    for (const child of node.children || []) visit(child);
  }
  visit(baseParse(descriptor.template.content));
  return tags;
}

const tagsByFile = Object.fromEntries(
  Object.entries(componentFiles).map(([name, path]) => [name, collectTemplateTags(path)]),
);

function componentCount(file, componentName) {
  return tagsByFile[file].filter((tag) => tag === componentName).length;
}

describe('select migration coverage', () => {
  it('uses Reka Select for Home short lists', () => {
    expect(componentCount('homeSimulation', 'Select')).toBeGreaterThan(0);
    for (const file of ['home', 'homeSimulation', 'homeEquipment', 'homeLoadout']) {
      expect(componentCount(file, 'NativeSelect'), file).toBe(0);
    }
  });

  it('uses searchable controls for large game-data lists', () => {
    expect(componentCount('homeSimulation', 'SearchCombobox')).toBeGreaterThanOrEqual(1);
    expect(componentCount('homeEquipment', 'SearchCombobox')).toBeGreaterThanOrEqual(1);
    expect(componentCount('homeLoadout', 'SearchCombobox')).toBeGreaterThanOrEqual(3);
    expect(componentCount('enhancement', 'SearchCombobox')).toBeGreaterThanOrEqual(1);
  });

  it('keeps NativeSelect only for the grouped equipment-type filter', () => {
    const nativeSelectUses = Object.entries(tagsByFile)
      .filter(([, tags]) => tags.includes('NativeSelect'))
      .map(([file, tags]) => [file, tags.filter((tag) => tag === 'NativeSelect').length]);

    expect(nativeSelectUses).toEqual([['enhancement', 1]]);
    expect(componentCount('enhancement', 'optgroup')).toBeGreaterThanOrEqual(1);
  });

  it('uses Reka Select on settings, skilling, and result views', () => {
    for (const file of ['settings', 'skilling', 'results']) {
      expect(componentCount(file, 'Select'), file).toBeGreaterThan(0);
      expect(componentCount(file, 'NativeSelect'), file).toBe(0);
    }
  });
});
