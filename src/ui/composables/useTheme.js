import { readonly, ref } from 'vue';

export const THEME_STORAGE_KEY = 'mwi.ui.theme.v1';

const theme = ref('dark');

export function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

export function applyTheme(nextTheme, { persist = true } = {}) {
  const normalizedTheme = normalizeTheme(nextTheme);
  theme.value = normalizedTheme;

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = normalizedTheme;
    document.documentElement.classList.toggle('dark', normalizedTheme === 'dark');
  }

  if (persist && typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
  }

  return normalizedTheme;
}

export function initializeTheme() {
  let savedTheme = 'dark';
  if (typeof localStorage !== 'undefined') {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  }
  return applyTheme(savedTheme, { persist: false });
}

export function useTheme() {
  function toggleTheme() {
    return applyTheme(theme.value === 'dark' ? 'light' : 'dark');
  }

  return {
    theme: readonly(theme),
    applyTheme,
    initializeTheme,
    toggleTheme,
  };
}
