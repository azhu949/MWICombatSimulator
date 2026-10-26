// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ImportScriptChannelDialog from '../components/ImportScriptChannelDialog.vue';
import { initI18n } from '../i18n/i18n.js';
import {
  GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
  IMPORT_SCRIPT_CHANNEL_GREASYFORK,
  IMPORT_SCRIPT_CHANNEL_SITE,
} from '../config/importScriptDistribution.js';
import {
  IMPORT_SCRIPT_STATUS_LEGACY,
  IMPORT_SCRIPT_STATUS_OUTDATED,
} from '../../services/mainSiteImportScriptStatus.js';

const SITE_SCRIPT_URL = 'https://mwi.example/userscript/mwi-main-site-import.user.js';

const channels = [
  { key: IMPORT_SCRIPT_CHANNEL_SITE, url: SITE_SCRIPT_URL },
  { key: IMPORT_SCRIPT_CHANNEL_GREASYFORK, url: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL },
];

beforeAll(async () => {
  localStorage.setItem('i18nextLng', 'en');
  await initI18n();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountDialog(props = {}) {
  return mount(ImportScriptChannelDialog, {
    props: {
      open: true,
      status: IMPORT_SCRIPT_STATUS_OUTDATED,
      installedVersion: '0.1.40',
      expectedVersion: '0.1.51',
      channels,
      ...props,
    },
    attachTo: document.body,
  });
}

function getDialog() {
  return document.body.querySelector('[role="dialog"]');
}

describe('ImportScriptChannelDialog', () => {
  it('lists the site download and GreasyFork channels with version context', async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const dialog = getDialog();
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Update Import Script');
    expect(dialog.textContent).toContain('Installed v0.1.40, latest is v0.1.51');

    const siteChannel = dialog.querySelector('[data-import-script-channel="site"]');
    expect(siteChannel).toBeTruthy();
    expect(siteChannel.textContent).toContain('Site download (recommended)');
    expect(siteChannel.textContent).toContain('mwi.example');

    const greasyforkChannel = dialog.querySelector('[data-import-script-channel="greasyfork"]');
    expect(greasyforkChannel).toBeTruthy();
    expect(greasyforkChannel.textContent).toContain('GreasyFork (overseas)');
    expect(greasyforkChannel.textContent).toContain('greasyfork.org');

    wrapper.unmount();
  });

  it('describes legacy scripts without pretending to know the installed version', async () => {
    const wrapper = mountDialog({ status: IMPORT_SCRIPT_STATUS_LEGACY, installedVersion: '' });
    await flushPromises();

    const dialog = getDialog();
    expect(dialog.textContent).toContain('legacy import script');
    expect(dialog.textContent).not.toContain('Installed v?');
    expect(dialog.textContent).toContain('v0.1.51');

    wrapper.unmount();
  });

  it('opens the selected channel in a new tab and closes the dialog', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const wrapper = mountDialog();
    await flushPromises();

    getDialog().querySelector('[data-import-script-channel="greasyfork"]').click();

    expect(openSpy).toHaveBeenCalledWith(GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL, '_blank', 'noopener,noreferrer');
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });
});
