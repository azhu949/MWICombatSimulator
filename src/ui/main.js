import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import App from './App.vue';
import router from './router/index.js';
import { initI18n } from './i18n/i18n.js';
import { initializeTheme } from './composables/useTheme.js';
import { validateSpecialMarketFeeRateHrids } from '../services/marketPriceService.js';
import { scheduleEnginePrewarm } from '../services/enginePrewarm.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table/index.js';
import { NativeSelect } from './components/ui/native-select/index.js';
import './styles.css';

async function bootstrap() {
  initializeTheme();
  validateSpecialMarketFeeRateHrids();
  await initI18n();

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.component('Table', Table);
  app.component('TableBody', TableBody);
  app.component('TableCell', TableCell);
  app.component('TableHead', TableHead);
  app.component('TableHeader', TableHeader);
  app.component('TableRow', TableRow);
  app.component('NativeSelect', NativeSelect);
  app.mount('#app');

  // 挂载完成后在空闲时间预热 wasm 引擎与 worker bundle（幂等；等待 load 事件，
  // 不与首屏资源竞争带宽）。目的：把首次点击「开始模拟」的冷启动开销
  // 挪到用户还在配置队伍的空闲时间预付，详见 enginePrewarm.js。
  scheduleEnginePrewarm();
}

bootstrap();
