import { createApp } from "vue";
import { createPinia } from "pinia";
import "@fontsource/chakra-petch/latin-400.css";
import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/chakra-petch/latin-600.css";
import "@fontsource/chakra-petch/latin-700.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import App from "./App.vue";
import router from "./router/index.js";
import { initI18n } from "./i18n/i18n.js";
import { initializeTheme } from "./composables/useTheme.js";
import { validateSpecialMarketFeeRateHrids } from "../services/marketPriceService.js";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "./components/ui/table/index.js";
import { NativeSelect } from "./components/ui/native-select/index.js";
import "./styles.css";

async function bootstrap() {
    initializeTheme();
    validateSpecialMarketFeeRateHrids();
    await initI18n();

    const app = createApp(App);
    app.use(createPinia());
    app.use(router);
    app.component("Table", Table);
    app.component("TableBody", TableBody);
    app.component("TableCell", TableCell);
    app.component("TableHead", TableHead);
    app.component("TableHeader", TableHeader);
    app.component("TableRow", TableRow);
    app.component("NativeSelect", NativeSelect);
    app.mount("#app");
}

bootstrap();
