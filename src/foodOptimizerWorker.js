import { createFoodOptimizerEvaluator } from './services/foodOptimizerSimulation.js';

let evaluate;
// 协调器在调用挂起期间（FoodOptimizerWorkerClient.call）不会发送任何消息，
// 因此这里同一时刻至多处理一条消息。显式断言这一前提：任何重叠的消息
//（evaluate 或 init）都会与正在运行的评估共享 realm 级的已播种 Math.random
// 作用域，必须大声失败，而不是破坏两条轨迹或悄悄重配置评估器。
let evaluating = false;
self.onmessage = async ({ data }) => {
  try {
    if (evaluating) throw new Error('Overlapping message while a food optimizer evaluation is in flight.');
    if (data.type === 'init') {
      evaluate = createFoodOptimizerEvaluator(data.request, {
        collectThresholds: data.collectThresholds !== false,
        sharedRounds: data.sharedRounds === true,
        items: data.items,
      });
      self.postMessage({ type: 'result' });
      return;
    }
    evaluating = true;
    try {
      const result = await evaluate(
        data.candidate,
        data.deathBudget,
        (progress) => self.postMessage({ type: 'progress', ...progress }),
        data.reusableSamples,
        data.costCutoff,
      );
      self.postMessage({ type: 'result', result });
    } finally {
      evaluating = false;
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || String(error) });
  }
};
