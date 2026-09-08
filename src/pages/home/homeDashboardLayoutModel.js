export const HOME_GRID_COLUMNS = 12;

export const HOME_WIDGET_LAYOUT_SPECS = {
  'due-today': { width: 3, height: 3, minWidth: 3, minHeight: 3 },
  overdue: { width: 3, height: 3, minWidth: 3, minHeight: 3 },
  'jobs-week': { width: 3, height: 3, minWidth: 3, minHeight: 3 },
  'hours-today': { width: 3, height: 3, minWidth: 3, minHeight: 3 },
  calendar: { width: 8, height: 11, minWidth: 6, minHeight: 8 },
  'mini-calendar': { width: 4, height: 7, minWidth: 3, minHeight: 6 },
  tasks: { width: 8, height: 9, minWidth: 6, minHeight: 6 },
  upcoming: { width: 4, height: 7, minWidth: 3, minHeight: 5 },
  activity: { width: 6, height: 6, minWidth: 4, minHeight: 4 },
  'quick-actions': { width: 6, height: 5, minWidth: 4, minHeight: 4 },
  'clocked-in-now': { width: 6, height: 6, minWidth: 4, minHeight: 4 },
  'finance-outstanding-invoices': { width: 4, height: 3, minWidth: 3, minHeight: 3 },
  'finance-overdue-invoices': { width: 4, height: 3, minWidth: 3, minHeight: 3 },
  'finance-budget-profit': { width: 4, height: 3, minWidth: 3, minHeight: 3 },
};

const integer = (value) => Number.isInteger(value) ? value : null;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function firstAvailablePosition(layout, width, height) {
  for (let y = 0; y < 1000; y += 1) {
    for (let x = 0; x <= HOME_GRID_COLUMNS - width; x += 1) {
      const overlaps = layout.some((item) => x < item.x + item.width && x + width > item.x && y < item.y + item.height && y + height > item.y);
      if (!overlaps) return { x, y };
    }
  }
  return { x: 0, y: layout.reduce((bottom, item) => Math.max(bottom, item.y + item.height), 0) };
}

export function defaultHomeDashboardLayout(widgetIds) {
  const layout = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const widgetId of widgetIds) {
    const spec = HOME_WIDGET_LAYOUT_SPECS[widgetId];
    if (!spec) continue;
    if (x + spec.width > HOME_GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    layout.push({ widgetId, x, y, width: spec.width, height: spec.height });
    x += spec.width;
    rowHeight = Math.max(rowHeight, spec.height);
  }
  return layout;
}

export function normalizeHomeDashboardLayout(value, widgetIds) {
  const requested = Array.isArray(value) ? value : [];
  if (requested.length === 0) return defaultHomeDashboardLayout(widgetIds);
  const byId = new Map(requested.filter((item) => item && typeof item === 'object' && typeof item.widgetId === 'string').map((item) => [item.widgetId, item]));
  const layout = [];
  for (const widgetId of widgetIds) {
    const spec = HOME_WIDGET_LAYOUT_SPECS[widgetId];
    if (!spec) continue;
    const candidate = byId.get(widgetId);
    const width = clamp(integer(candidate?.width) ?? spec.width, spec.minWidth, HOME_GRID_COLUMNS);
    const height = clamp(integer(candidate?.height) ?? spec.height, spec.minHeight, 40);
    const requestedX = clamp(integer(candidate?.x) ?? 0, 0, HOME_GRID_COLUMNS - width);
    const requestedY = clamp(integer(candidate?.y) ?? 0, 0, 1000);
    const overlaps = layout.some((item) => requestedX < item.x + item.width && requestedX + width > item.x && requestedY < item.y + item.height && requestedY + height > item.y);
    const position = overlaps ? firstAvailablePosition(layout, width, height) : { x: requestedX, y: requestedY };
    layout.push({ widgetId, ...position, width, height });
  }
  return layout;
}

export function addHomeDashboardWidget(layout, widgetId) {
  const withoutWidget = layout.filter((item) => item.widgetId !== widgetId);
  const spec = HOME_WIDGET_LAYOUT_SPECS[widgetId];
  if (!spec) return withoutWidget;
  const position = firstAvailablePosition(withoutWidget, spec.width, spec.height);
  return [...withoutWidget, { widgetId, ...position, width: spec.width, height: spec.height }];
}

export function homeWidgetIdsFromLayout(layout) {
  return [...layout].sort((left, right) => left.y - right.y || left.x - right.x).map((item) => item.widgetId);
}
