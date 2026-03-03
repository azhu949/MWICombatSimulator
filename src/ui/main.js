import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router/index.js";
import { initI18n } from "./i18n/i18n.js";
import "./styles.css";

async function bootstrap() {
    await initI18n();

    const app = createApp(App);
    app.use(createPinia());
    app.use(router);
    app.mount("#app");
}

bootstrap();
