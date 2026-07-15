import { createRouter, createWebHashHistory } from "vue-router";
import { appScrollBehavior } from "./scrollBehavior.js";

const routes = [
    { path: "/", redirect: "/home" },
    { path: "/home", name: "home", component: () => import("../pages/HomePage.vue") },
    { path: "/advisor", name: "advisor", component: () => import("../pages/AdvisorPage.vue") },
    {
        path: "/enhancement",
        name: "enhancement",
        component: () => import("../pages/EnhancementPage.vue"),
        meta: { showCombatToolbar: false },
    },
    {
        path: "/skilling",
        name: "skilling",
        component: () => import("../pages/SkillingPage.vue"),
        meta: { showCombatToolbar: false },
    },
    { path: "/queue", name: "queue", component: () => import("../pages/QueuePage.vue") },
    { path: "/multi-results", name: "multi-results", component: () => import("../pages/MultiResultsPage.vue") },
    { path: "/settings", name: "settings", component: () => import("../pages/SettingsPage.vue") },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
    scrollBehavior: appScrollBehavior,
});

export default router;
