// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { initI18n } from '../i18n/i18n.js';
import HomeExperimentalModal from '../components/home/HomeExperimentalModal.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

beforeAll(async () => {
  localStorage.setItem('i18nextLng', 'en');
  await initI18n();
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

function findButton(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text() === label);
}

function mountModal() {
  return mount(HomeExperimentalModal, {
    props: { open: true },
    global: {
      stubs: {
        BaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
      },
    },
  });
}

describe('HomeExperimentalModal file selection', () => {
  it('persists timeline visualization changes', async () => {
    const wrapper = mountModal();
    const simulator = useSimulatorStore();
    const persist = vi.spyOn(simulator, 'persistSimulationUiSettings');
    const visualizationToggle = wrapper.find('input[type="checkbox"]');
    const nextValue = !simulator.simulationSettings.enableHpMpVisualization;

    await visualizationToggle.setValue(nextValue);
    await flushPromises();

    expect(simulator.simulationSettings.enableHpMpVisualization).toBe(nextValue);
    expect(persist).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('retains the selected file while resetting the input and supports clearing it', async () => {
    const wrapper = mountModal();
    const input = wrapper.find('input[type="file"]');
    const file = {
      name: 'batch.json',
      text: vi.fn().mockResolvedValue('[]'),
    };
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });

    await input.trigger('change');

    expect(input.element.value).toBe('');
    expect(wrapper.text()).toContain('Selected file: batch.json');
    expect(findButton(wrapper, 'Upload & Run').attributes('disabled')).toBeUndefined();

    await findButton(wrapper, 'Upload & Run').trigger('click');
    await flushPromises();

    expect(file.text).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Completed 0 cases.');

    await input.trigger('change');
    expect(wrapper.text()).toContain('Selected file: batch.json');

    await findButton(wrapper, 'Clear').trigger('click');

    expect(findButton(wrapper, 'Upload & Run').attributes('disabled')).toBeDefined();
    expect(findButton(wrapper, 'Clear')).toBeUndefined();
    wrapper.unmount();
  });

  it('uses neutral community buff defaults when a batch case omits extra fields', async () => {
    const wrapper = mountModal();
    const simulator = useSimulatorStore();
    const runSimulation = vi
      .spyOn(simulator, 'runSingleSimulationPayloadWithDedicatedWorker')
      .mockResolvedValue({ encounters: 1 });
    const runSharedSimulation = vi.spyOn(simulator, 'runSingleSimulationPayload');
    const input = wrapper.find('input[type="file"]');
    const file = {
      name: 'neutral-defaults.json',
      text: vi.fn().mockResolvedValue(
        JSON.stringify([
          {
            name: 'neutral-defaults',
            players: [{ id: '1' }],
            zoneHrid: '/actions/combat/test_zone',
          },
        ]),
      ),
    };
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });

    expect(simulator.simulationSettings.comExp).toBe(20);
    expect(simulator.simulationSettings.comDrop).toBe(20);

    await input.trigger('change');
    await findButton(wrapper, 'Upload & Run').trigger('click');
    await flushPromises();

    expect(runSimulation).toHaveBeenCalledOnce();
    expect(runSharedSimulation).not.toHaveBeenCalled();
    expect(runSimulation.mock.calls[0][2]).toMatchObject({ scope: 'experimental' });
    expect(runSimulation.mock.calls[0][0].extra).toMatchObject({
      mooPass: false,
      comExp: 0,
      comDrop: 0,
      enableHpMpVisualization: false,
    });
    wrapper.unmount();
  });

  it('cancels only the active dedicated batch run', async () => {
    const wrapper = mountModal();
    const simulator = useSimulatorStore();
    let rejectRun;
    const cancel = vi.fn(() => {
      const error = new Error('Simulation cancelled.');
      error.code = 'cancelled';
      rejectRun(error);
    });
    vi.spyOn(simulator, 'runSingleSimulationPayloadWithDedicatedWorker').mockImplementation(
      (_payload, _onProgress, options) =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
          options.onHandle({ scope: options.scope, cancel });
        }),
    );
    const input = wrapper.find('input[type="file"]');
    const file = {
      name: 'cancel.json',
      text: vi.fn().mockResolvedValue(
        JSON.stringify([
          {
            players: [{ id: '1' }],
            zoneHrid: '/actions/combat/test_zone',
          },
        ]),
      ),
    };
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });

    await input.trigger('change');
    await findButton(wrapper, 'Upload & Run').trigger('click');
    await flushPromises();
    await findButton(wrapper, 'Cancel').trigger('click');
    await flushPromises();

    expect(cancel).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Cancelled.');
    wrapper.unmount();
  });
});
