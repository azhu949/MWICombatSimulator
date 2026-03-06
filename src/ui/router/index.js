import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
    { path: "/", redirect: "/home" },
    { path: "/home", name: "home", component: () => import("../pages/HomePage.vue") },
    { path: "/queue", name: "queue", component: () => import("../pages/QueuePage.vue") },
    { path: "/results", name: "results", component: () => import("../pages/ResultsPage.vue") },
    { path: "/multi-results", name: "multi-results", component: () => import("../pages/MultiResultsPage.vue") },
    { path: "/settings", name: "settings", component: () => import("../pages/SettingsPage.vue") },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

export default router;
