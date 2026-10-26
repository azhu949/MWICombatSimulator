// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import {
  IMPORT_SCRIPT_DETECTED_ATTRIBUTE,
  IMPORT_SCRIPT_STATUS_LEGACY,
  IMPORT_SCRIPT_STATUS_MISSING,
  IMPORT_SCRIPT_VERSION_ATTRIBUTE,
} from '../../../services/mainSiteImportScriptStatus.js';
import { useMainSiteImportScriptStatus } from '../useMainSiteImportScriptStatus.js';

const DETECTION_MEMORY_KEY = 'mwi.importScript.detection.v2';

function seedDetectionMemory(payload) {
  localStorage.setItem(DETECTION_MEMORY_KEY, JSON.stringify(payload));
}

// 在真实组件实例内取用 composable（onMounted / onUnmounted 必须在 setup 内注册）。
function mountStatus() {
  const captured = {};
  const Host = defineComponent({
    render: () => null,
    setup() {
      Object.assign(captured, useMainSiteImportScriptStatus());
    },
  });
  return { wrapper: mount(Host), captured };
}

// 脚本安装痕迹有三层证据（标记 / 注入控件 / 历史记忆），判定顺序与降级方向都不能反：
// 反了会让装着的用户看到「未安装」，或让已删脚本的用户一直看到「已安装」。
describe('useMainSiteImportScriptStatus evidence branches', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(IMPORT_SCRIPT_DETECTED_ATTRIBUTE);
    document.documentElement.removeAttribute(IMPORT_SCRIPT_VERSION_ATTRIBUTE);
  });

  it('reads the marker and version attributes written by a current script', () => {
    document.documentElement.setAttribute(IMPORT_SCRIPT_DETECTED_ATTRIBUTE, '1');
    document.documentElement.setAttribute(IMPORT_SCRIPT_VERSION_ATTRIBUTE, ' 0.1.51 ');

    const { wrapper, captured } = mountStatus();

    expect(captured.detected.value).toBe(true);
    expect(captured.installedVersion.value).toBe('0.1.51');

    wrapper.unmount();
  });

  it('treats an injected import control as an installed legacy script', () => {
    // 旧版脚本不写标记，只注入控件：没有这一层证据，旧版用户会被误判成未安装。
    document.body.innerHTML = '<div id="mwi-tm-import-button"></div>';

    const { wrapper, captured } = mountStatus();

    expect(captured.detected.value).toBe(true);
    expect(captured.installedVersion.value).toBe('');
    expect(captured.status.value).toBe(IMPORT_SCRIPT_STATUS_LEGACY);

    wrapper.unmount();
  });

  it('reports missing when the page carries no trace at all', () => {
    const { wrapper, captured } = mountStatus();

    expect(captured.detected.value).toBe(false);
    expect(captured.status.value).toBe(IMPORT_SCRIPT_STATUS_MISSING);

    wrapper.unmount();
  });

  it('falls back to an unversioned detection memory when the current page cannot tell', () => {
    seedDetectionMemory({ detectedAt: Date.now(), version: '' });

    const { wrapper, captured } = mountStatus();

    expect(captured.detected.value).toBe(true);
    expect(captured.installedVersion.value).toBe('');

    wrapper.unmount();
  });

  it('downgrades a versioned detection memory once the marker is gone', () => {
    // 记忆里存过版本号说明证据来自新版脚本，而新版脚本在任何 @match 页面都会写标记：
    // 标记缺席即脚本已被删除，此时必须回落未安装而不是继续沿用记忆。
    seedDetectionMemory({ detectedAt: Date.now(), version: '0.1.51' });

    const { wrapper, captured } = mountStatus();

    expect(captured.detected.value).toBe(false);
    expect(captured.status.value).toBe(IMPORT_SCRIPT_STATUS_MISSING);

    wrapper.unmount();
  });
});
