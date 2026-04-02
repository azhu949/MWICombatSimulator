export function appScrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
        return savedPosition;
    }

    // Preserve the current viewport when we only normalize query state on the same page.
    if (String(to?.path || "") === String(from?.path || "") && String(to?.hash || "") === String(from?.hash || "")) {
        return false;
    }

    return { top: 0 };
}
