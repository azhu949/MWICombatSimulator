import { createFoodOptimizerEvaluator } from './services/foodOptimizerSimulation.js';

let evaluate;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      evaluate = createFoodOptimizerEvaluator(data.request, {
        collectThresholds: data.collectThresholds !== false,
        sharedRounds: data.sharedRounds === true,
        items: data.items,
      });
      self.postMessage({ type: 'result' });
      return;
    }
    const result = await evaluate(
      data.candidate,
      data.baselineDeaths,
      (progress) => self.postMessage({ type: 'progress', ...progress }),
      data.reusableSamples,
      data.costCutoff,
    );
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || String(error) });
  }
};
