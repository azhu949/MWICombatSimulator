import { createRouter, createWebHashHistory } from "vue-router";
import HomePage from "../pages/HomePage.vue";
import QueuePage from "../pages/QueuePage.vue";
import ResultsPage from "../pages/ResultsPage.vue";
import MultiResultsPage from "../pages/MultiResultsPage.vue";
import SettingsPage from "../pages/SettingsPage.vue";

const routes = [
    { path: "/", redirect: "/home" },
    { path: "/home", name: "home", component: HomePage },
    { path: "/queue", name: "queue", component: QueuePage },
    { path: "/results", name: "results", component: ResultsPage },
    { path: "/multi-results", name: "multi-results", component: MultiResultsPage },
    { path: "/settings", name: "settings", component: SettingsPage },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

export default router;
