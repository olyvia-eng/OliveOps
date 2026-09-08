export function reorderHomeWidgetIds(widgetIds, draggedId, targetId) {
  const fromIndex = widgetIds.indexOf(draggedId);
  const toIndex = widgetIds.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...widgetIds];
  const next = [...widgetIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}