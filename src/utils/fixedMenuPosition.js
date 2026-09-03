export function calculateFixedMenuPosition(triggerRect, menuSize, viewport, options = {}) {
  const margin = options.margin ?? 8;
  const gap = options.gap ?? 6;
  const width = Math.min(menuSize.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(menuSize.height, Math.max(0, viewport.height - margin * 2));
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.min(Math.max(margin, triggerRect.right - width), maxLeft);
  const belowTop = triggerRect.bottom + gap;
  const aboveTop = triggerRect.top - gap - height;
  const top = belowTop + height <= viewport.height - margin
    ? belowTop
    : aboveTop >= margin
      ? aboveTop
      : Math.max(margin, Math.min(belowTop, viewport.height - height - margin));

  return { left, top, width, maxHeight: Math.max(0, viewport.height - margin * 2) };
}