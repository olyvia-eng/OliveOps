import { useEffect, useState, type ReactNode } from 'react';
import { GripVertical, LayoutGrid, Plus, RotateCcw, X } from 'lucide-react';
import { Responsive, useContainerWidth, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './CustomizableWidgetGrid.css';
import { Button, Card, Modal } from '../../components/ui';
import type { HomeWidgetId } from './useHomeDashboardPreferences';
import { addHomeDashboardWidget, HOME_GRID_COLUMNS, HOME_WIDGET_LAYOUT_SPECS, homeWidgetIdsFromLayout, type HomeWidgetLayoutItem } from './homeDashboardLayoutModel.js';

export interface HomeWidgetDefinition {
  id: HomeWidgetId;
  title: string;
  description: string;
  content: ReactNode;
  category: 'Personal' | 'Operations' | 'Finance';
}

interface CustomizableWidgetGridProps {
  widgetIds: HomeWidgetId[];
  widgetLayout: HomeWidgetLayoutItem[];
  availableWidgetIds: HomeWidgetId[];
  definitions: HomeWidgetDefinition[];
  hydrated: boolean;
  onChange: (widgetIds: HomeWidgetId[], widgetLayout: HomeWidgetLayoutItem[]) => void;
  onReset: () => void;
}

const toGridLayout = (layout: HomeWidgetLayoutItem[], columns: 12 | 8): Layout => layout.map((item) => {
  const spec = HOME_WIDGET_LAYOUT_SPECS[item.widgetId];
  const scale = columns / HOME_GRID_COLUMNS;
  const width = Math.min(columns, Math.max(Math.ceil(spec.minWidth * scale), Math.round(item.width * scale)));
  return { i: item.widgetId, x: Math.min(columns - width, Math.round(item.x * scale)), y: item.y, w: width, h: item.height, minW: Math.ceil(spec.minWidth * scale), minH: spec.minHeight, maxW: columns, maxH: 40 };
});

const fromGridLayout = (layout: Layout, columns: 12 | 8): HomeWidgetLayoutItem[] => {
  const scale = HOME_GRID_COLUMNS / columns;
  return layout.map((item) => ({ widgetId: item.i as HomeWidgetId, x: Math.round(item.x * scale), y: item.y, width: Math.round(item.w * scale), height: item.h }));
};

function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export default function CustomizableWidgetGrid({ widgetIds, widgetLayout, availableWidgetIds, definitions, hydrated, onChange, onReset }: CustomizableWidgetGridProps) {
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [breakpoint, setBreakpoint] = useState<'lg' | 'md'>('lg');
  const mobile = useMobileLayout();
  const { width, containerRef, mounted } = useContainerWidth();
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const visibleDefinitions = widgetIds.map((id) => definitionById.get(id)).filter((value): value is HomeWidgetDefinition => Boolean(value));
  const hiddenDefinitions = availableWidgetIds.map((id) => definitionById.get(id)).filter((value): value is HomeWidgetDefinition => Boolean(value)).filter((value) => !widgetIds.includes(value.id));

  const persistGridLayout = (layout: Layout) => {
    const nextLayout = fromGridLayout(layout, breakpoint === 'md' ? 8 : 12);
    onChange(homeWidgetIdsFromLayout(nextLayout), nextLayout);
  };
  const addWidget = (id: HomeWidgetId) => {
    const nextLayout = addHomeDashboardWidget(widgetLayout, id);
    onChange(homeWidgetIdsFromLayout(nextLayout), nextLayout);
    setCatalogOpen(false);
  };
  const removeWidget = (id: HomeWidgetId) => {
    const nextLayout = widgetLayout.filter((item) => item.widgetId !== id);
    onChange(homeWidgetIdsFromLayout(nextLayout), nextLayout);
  };
  const confirmReset = () => {
    onReset();
    setResetOpen(false);
  };

  const widgetContent = (widget: HomeWidgetDefinition) => <div className={`home-widget-shell relative flex h-full min-h-0 flex-col ${editing ? 'home-widget-editing' : ''}`}>
    {editing ? <div className="home-widget-drag-handle flex h-10 shrink-0 cursor-grab items-center justify-between border-b border-brand-100 bg-brand-50/80 px-3 text-sm font-semibold text-brand-700 active:cursor-grabbing dark:border-brand-600 dark:bg-brand-800 dark:text-brand-100"><span className="flex min-w-0 items-center gap-2"><GripVertical size={16} className="shrink-0 text-brand-400" /><span className="truncate">{widget.title}</span></span><button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded text-brand-400 hover:bg-white hover:text-accent-700 dark:hover:bg-brand-600" onClick={() => removeWidget(widget.id)} title="Remove widget" aria-label={`Remove ${widget.title}`}><X size={14} /></button></div> : null}
    <div className="min-h-0 flex-1 overflow-auto [&>*]:h-full">{widget.content}</div>
  </div>;

  return <>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {editing ? <Button type="button" variant="ghost" size="sm" onClick={() => setResetOpen(true)}><RotateCcw />Reset layout</Button> : null}
      <Button type="button" variant="secondary" size="sm" onClick={() => setCatalogOpen(true)}><Plus />Add widget</Button>
      <Button type="button" variant={editing ? 'primary' : 'secondary'} size="sm" onClick={() => setEditing((value) => !value)}><LayoutGrid />{editing ? 'Done' : 'Edit layout'}</Button>
    </div>

    {!hydrated ? <div className="h-40 animate-pulse rounded-lg bg-brand-50 dark:bg-brand-700" /> : null}
    {hydrated && visibleDefinitions.length === 0 ? <Card className="rounded-lg p-8 text-center"><p className="font-semibold text-brand-900 dark:text-brand-50">Your Home is ready to personalize</p><p className="mt-1 text-sm text-brand-400 dark:text-brand-300">Add the widgets that help you run your day.</p><Button className="mt-4" onClick={() => setCatalogOpen(true)}><Plus />Add widget</Button></Card> : null}
    {hydrated && visibleDefinitions.length > 0 ? <div ref={containerRef} className={editing ? 'home-layout-is-editing' : ''}>
      {mobile ? <div className="grid grid-cols-1 gap-4">{visibleDefinitions.map((widget) => <section key={widget.id} aria-label={`${widget.title} widget`}>{widgetContent(widget)}</section>)}</div> : mounted ? <Responsive
        width={width}
        layouts={{ lg: toGridLayout(widgetLayout, 12), md: toGridLayout(widgetLayout, 8) }}
        breakpoints={{ lg: 1200, md: 0 }}
        cols={{ lg: 12, md: 8 }}
        rowHeight={44}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        dragConfig={{ enabled: editing, handle: '.home-widget-drag-handle', cancel: 'button,a,input,select,textarea,[role="button"],[role="tab"]', threshold: 4 }}
        resizeConfig={{ enabled: editing, handles: ['se'] }}
        onBreakpointChange={(next) => setBreakpoint(next as 'lg' | 'md')}
        onDragStop={(layout) => persistGridLayout(layout)}
        onResizeStop={(layout) => persistGridLayout(layout)}
        className="home-dashboard-grid"
      >{visibleDefinitions.map((widget) => <section key={widget.id} aria-label={`${widget.title} widget`}>{widgetContent(widget)}</section>)}</Responsive> : null}
    </div> : null}

    <Modal open={catalogOpen} onClose={() => setCatalogOpen(false)} title="Add a widget">
      {hiddenDefinitions.length === 0 ? <p className="text-sm text-brand-500 dark:text-brand-200">All available widgets are already on your Home.</p> : <div className="space-y-4">{(['Personal', 'Operations', 'Finance'] as const).map((category) => { const items = hiddenDefinitions.filter((widget) => widget.category === category); if (!items.length) return null; return <section key={category}><h3 className="mb-2 text-xs font-semibold uppercase text-brand-400 dark:text-brand-300">{category}</h3><div className="space-y-2">{items.map((widget) => <button key={widget.id} type="button" onClick={() => addWidget(widget.id)} className="flex w-full items-center justify-between gap-3 rounded-md border border-brand-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:hover:bg-brand-600"><span><span className="block text-sm font-semibold text-brand-900 dark:text-brand-50">{widget.title}</span><span className="mt-0.5 block text-xs text-brand-400 dark:text-brand-300">{widget.description}</span></span><Plus className="shrink-0 text-brand-500" size={17} /></button>)}</div></section>; })}</div>}
    </Modal>
    <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset Home layout" footer={<><Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button><Button onClick={confirmReset}>Reset layout</Button></>}><p className="text-sm text-brand-500 dark:text-brand-200">Restore the default widgets, order, widths, and heights?</p></Modal>
  </>;
}
