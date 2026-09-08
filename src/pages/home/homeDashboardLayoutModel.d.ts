import type { HomeWidgetId } from './useHomeDashboardPreferences';

export interface HomeWidgetLayoutItem {
  widgetId: HomeWidgetId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HomeWidgetLayoutSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export const HOME_GRID_COLUMNS: number;
export const HOME_WIDGET_LAYOUT_SPECS: Record<HomeWidgetId, HomeWidgetLayoutSpec>;
export function defaultHomeDashboardLayout(widgetIds: HomeWidgetId[]): HomeWidgetLayoutItem[];
export function normalizeHomeDashboardLayout(value: unknown, widgetIds: HomeWidgetId[]): HomeWidgetLayoutItem[];
export function addHomeDashboardWidget(layout: HomeWidgetLayoutItem[], widgetId: HomeWidgetId): HomeWidgetLayoutItem[];
export function homeWidgetIdsFromLayout(layout: HomeWidgetLayoutItem[]): HomeWidgetId[];
