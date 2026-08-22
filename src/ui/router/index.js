import { createRouter, createWebHashHistory } from 'vue-router';
import { appScrollBehavior } from './scrollBehavior.js';

const routes = [
  { path: '/', redirect: '/home' },
  {
    path: '/home',
    name: 'home',
    component: () => import('../pages/HomePage.vue'),
    meta: { navLabelKey: 'common:menu.home', navLabel: 'Home', navGroup: 'simulation', navOrder: 1 },
  },
  {
    path: '/advisor',
    name: 'advisor',
    component: () => import('../pages/AdvisorPage.vue'),
    meta: { navLabelKey: 'common:menu.advisor', navLabel: 'Advisor / 刷图推荐', navGroup: 'simulation', navOrder: 2 },
  },
  {
    path: '/enhancement',
    name: 'enhancement',
    component: () => import('../pages/EnhancementPage.vue'),
    meta: {
      showCombatToolbar: false,
      navLabelKey: 'common:menu.enhancement',
      navLabel: 'Enhancement',
      navGroup: 'tools',
      navOrder: 3,
    },
  },
  {
    path: '/skilling',
    name: 'skilling',
    component: () => import('../pages/SkillingPage.vue'),
    meta: {
      showCombatToolbar: false,
      navLabelKey: 'common:menu.skilling',
      navLabel: 'Skilling',
      navGroup: 'tools',
      navOrder: 4,
    },
  },
  {
    path: '/queue',
    name: 'queue',
    component: () => import('../pages/QueuePage.vue'),
    meta: { navLabelKey: 'common:menu.queue', navLabel: 'Queue', navGroup: 'support', navOrder: 5 },
  },
  {
    path: '/multi-results',
    name: 'multi-results',
    component: () => import('../pages/MultiResultsPage.vue'),
    meta: { navLabelKey: 'common:menu.multiResults', navLabel: 'Multi-round', navGroup: 'support', navOrder: 6 },
  },
  {
    path: '/patch-notes',
    name: 'patch-notes',
    component: () => import('../pages/PatchNotesPage.vue'),
    meta: { showCombatToolbar: false, navHidden: true, navLabelKey: 'common:patchNotes', navLabel: 'Patch Notes' },
  },
  {
    path: '/guide',
    name: 'guide',
    component: () => import('../pages/GuidePage.vue'),
    meta: {
      showCombatToolbar: false,
      navLabelKey: 'common:menu.guide',
      navLabel: 'Guide',
      navGroup: 'support',
      navOrder: 8,
    },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../pages/SettingsPage.vue'),
    meta: { navLabelKey: 'common:menu.settings', navLabel: 'Settings', navGroup: 'support', navOrder: 7 },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: appScrollBehavior,
});

export default router;
