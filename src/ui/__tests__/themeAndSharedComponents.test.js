// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BaseModal from '../components/BaseModal.vue';
import DisclosurePanel from '../components/DisclosurePanel.vue';
import { Button } from '../components/ui/button/index.js';
import { applyTheme, initializeTheme, THEME_STORAGE_KEY, useTheme } from '../composables/useTheme.js';

describe('theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.theme;
  });

  it('defaults to dark and restores a stored light theme', () => {
    expect(initializeTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(initializeTheme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists manual changes through the existing storage key', () => {
    applyTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    const { toggleTheme, theme } = useTheme();
    toggleTheme();
    expect(theme.value).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

describe('shared shadcn-vue components', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('applies compact button variants', () => {
    const wrapper = mount(Button, {
      props: { variant: 'outline', size: 'icon-sm' },
      slots: { default: 'Run' },
    });
    expect(wrapper.attributes('data-slot')).toBe('button');
    expect(wrapper.classes()).toContain('size-8');
    expect(wrapper.classes()).toContain('border-input');
  });

  it('opens and closes a disclosure through Reka Collapsible', async () => {
    const wrapper = mount(DisclosurePanel, {
      props: { title: 'Damage breakdown' },
      slots: { default: 'Details' },
      attachTo: document.body,
    });

    expect(wrapper.text()).not.toContain('Details');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Details');
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true');
  });

  it('renders BaseModal in a portal and preserves the close event', async () => {
    const wrapper = mount(BaseModal, {
      props: { open: true, title: 'Queue details' },
      slots: { default: 'Queued simulation' },
      attachTo: document.body,
    });
    await flushPromises();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Queue details');
    expect(dialog?.textContent).toContain('Queued simulation');

    dialog.querySelector('button').click();
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
