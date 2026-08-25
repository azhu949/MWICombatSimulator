const DEFAULT_STICKY_HEADER_OFFSET = 144;

function getStickyHeaderOffset() {
  if (typeof document === 'undefined') {
    return DEFAULT_STICKY_HEADER_OFFSET;
  }

  const header = document.querySelector('header.sticky');
  const headerHeight = Number(header?.getBoundingClientRect?.().height || 0);
  if (!Number.isFinite(headerHeight) || headerHeight <= 0) {
    return DEFAULT_STICKY_HEADER_OFFSET;
  }

  return Math.max(DEFAULT_STICKY_HEADER_OFFSET, Math.ceil(headerHeight + 16));
}

export function appScrollBehavior(to, from, savedPosition) {
  if (savedPosition) {
    return savedPosition;
  }

  if (to?.hash && String(to.hash) !== String(from?.hash || '')) {
    return { el: to.hash, top: getStickyHeaderOffset() };
  }

  // 在同一页面上仅规范化查询状态时，保留当前视口位置。
  if (String(to?.path || '') === String(from?.path || '') && String(to?.hash || '') === String(from?.hash || '')) {
    return false;
  }

  return { top: 0 };
}
