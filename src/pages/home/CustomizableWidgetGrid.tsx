import { useState, type DragEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, GripVertical, LayoutGrid, Plus, RotateCcw, X } from 'lucide-react';
import { Button, Card, Modal } from '../../components/ui';
import type { HomeWidgetId } from './useHomeDashboardPreferences';

export interface HomeWidgetDefinition {
  id: HomeWidgetId;
  title: string;
  description: string;
  size: 'small' | 'medium' | 'large';
  content: ReactNode;
  category: 'Personal' | 'Finance';
}

interface CustomizableWidgetGridProps {
  widgetIds: HomeWidgetId[];
  availableWidgetIds: HomeWidgetId[];
  definitions: HomeWidgetDefinition[];
  hydrated: boolean;
  onChange: (widgetIds: HomeWidgetId[]) => void;
  onReset: () => void;
}

const preferredSpan = {
  small: { medium: 3, large: 3 },
  medium: { medium: 3, large: 3 },
  large: { medium: 6, large: 9 },
};

const mediumSpanClass = ['md:col-span-1', 'md:col-span-2', 'md:col-span-3', 'md:col-span-4', 'md:col-span-5', 'md:col-span-6'] as const;
const largeSpanClass = ['xl:col-span-1', 'xl:col-span-2', 'xl:col-span-3', 'xl:col-span-4', 'xl:col-span-5', 'xl:col-span-6', 'xl:col-span-7', 'xl:col-span-8', 'xl:col-span-9', 'xl:col-span-10', 'xl:col-span-11', 'xl:col-span-12'] as const;

function balancedSpans(widgets: HomeWidgetDefinition[], columns: 6 | 12, breakpoint: 'medium' | 'large') {
  const spans = widgets.map((widget) => preferredSpan[widget.size][breakpoint]);
  let rowStart = 0;
  let usedColumns = 0;

  const fillRow = (rowEnd: number) => {
    let remaining = columns - usedColumns;
    let index = rowStart;
    while (remaining > 0 && rowEnd > rowStart) {
      spans[index] += 1;
      remaining -= 1;
      index = index + 1 < rowEnd ? index + 1 : rowStart;
    }
  };

  spans.forEach((span, index) => {
    if (usedColumns + span > columns) {
      fillRow(index);
      rowStart = index;
      usedColumns = 0;
    }
    usedColumns += span;
    if (usedColumns === columns) {
      rowStart = index + 1;
      usedColumns = 0;
    }
  });
  fillRow(spans.length);
  return spans;
}

export default function CustomizableWidgetGrid({ widgetIds, availableWidgetIds, definitions, hydrated, onChange, onReset }: CustomizableWidgetGridProps) {
  const [customizing, setCustomizing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<HomeWidgetId | null>(null);
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const visibleDefinitions = widgetIds.map((id) => definitionById.get(id)).filter((value): value is HomeWidgetDefinition => Boolean(value));
  const mediumSpans = balancedSpans(visibleDefinitions, 6, 'medium');
  const largeSpans = balancedSpans(visibleDefinitions, 12, 'large');
  const hiddenDefinitions = availableWidgetIds
    .map((id) => definitionById.get(id))
    .filter((value): value is HomeWidgetDefinition => Boolean(value))
    .filter((value) => !widgetIds.includes(value.id));

  const moveWidget = (id: HomeWidgetId, offset: number) => {
    const fromIndex = widgetIds.indexOf(id);
    const toIndex = fromIndex + offset;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= widgetIds.length) return;
    const next = [...widgetIds];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  const dropWidget = (targetId: HomeWidgetId) => {
    if (!draggedId || draggedId === targetId) return;
    const next = [...widgetIds];
    const fromIndex = next.indexOf(draggedId);
    const toIndex = next.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
    setDraggedId(null);
  };

  const startDrag = (event: DragEvent<HTMLButtonElement>, id: HomeWidgetId) => {
    setDraggedId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const addWidget = (id: HomeWidgetId) => {
    onChange([...widgetIds, id]);
    setCatalogOpen(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {customizing ? <Button type="button" variant="ghost" size="sm" onClick={onReset}><RotateCcw />Reset layout</Button> : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => setCatalogOpen(true)}><Plus />Add widget</Button>
        <Button type="button" variant={customizing ? 'primary' : 'secondary'} size="sm" onClick={() => setCustomizing((value) => !value)}><LayoutGrid />{customizing ? 'Done' : 'Customize'}</Button>
      </div>

      {!hydrated ? <div className="h-40 animate-pulse rounded-lg bg-brand-50 dark:bg-brand-700" /> : null}
      {hydrated && visibleDefinitions.length === 0 ? (
        <Card className="rounded-lg p-8 text-center"><p className="font-semibold text-brand-900 dark:text-brand-50">Your Home is ready to personalize</p><p className="mt-1 text-sm text-brand-400 dark:text-brand-300">Add the widgets that help you run your day.</p><Button className="mt-4" onClick={() => setCatalogOpen(true)}><Plus />Add widget</Button></Card>
      ) : null}
      {hydrated && visibleDefinitions.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-6 xl:grid-cols-12">
          {visibleDefinitions.map((widget, index) => (
            <section
              key={widget.id}
              className={`relative min-w-0 ${mediumSpanClass[mediumSpans[index] - 1]} ${largeSpanClass[largeSpans[index] - 1]} ${customizing ? 'rounded-lg outline outline-2 outline-dashed outline-brand-300 dark:outline-brand-500' : ''} ${draggedId === widget.id ? 'opacity-50' : ''}`}
              onDragOver={(event) => { if (customizing) event.preventDefault(); }}
              onDrop={() => dropWidget(widget.id)}
              aria-label={`${widget.title} widget`}
            >
              {customizing ? (
                <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-brand-100 bg-white p-1 shadow-sm dark:border-brand-600 dark:bg-brand-700">
                  <button type="button" className="grid h-7 w-7 place-items-center rounded text-brand-500 hover:bg-brand-50 disabled:opacity-30 dark:text-brand-200 dark:hover:bg-brand-600" onClick={() => moveWidget(widget.id, -1)} disabled={index === 0} title="Move earlier" aria-label={`Move ${widget.title} earlier`}><ArrowLeft size={14} /></button>
                  <button type="button" draggable onDragStart={(event) => startDrag(event, widget.id)} onDragEnd={() => setDraggedId(null)} className="grid h-7 w-7 cursor-grab place-items-center rounded text-brand-500 hover:bg-brand-50 active:cursor-grabbing dark:text-brand-200 dark:hover:bg-brand-600" title="Drag to rearrange" aria-label={`Drag ${widget.title}`}><GripVertical size={15} /></button>
                  <button type="button" className="grid h-7 w-7 place-items-center rounded text-brand-500 hover:bg-brand-50 disabled:opacity-30 dark:text-brand-200 dark:hover:bg-brand-600" onClick={() => moveWidget(widget.id, 1)} disabled={index === widgetIds.length - 1} title="Move later" aria-label={`Move ${widget.title} later`}><ArrowRight size={14} /></button>
                  <button type="button" className="grid h-7 w-7 place-items-center rounded text-brand-500 hover:bg-accent-50 hover:text-accent-700" onClick={() => onChange(widgetIds.filter((id) => id !== widget.id))} title="Remove widget" aria-label={`Remove ${widget.title}`}><X size={14} /></button>
                </div>
              ) : null}
              {widget.content}
            </section>
          ))}
        </div>
      ) : null}

      <Modal open={catalogOpen} onClose={() => setCatalogOpen(false)} title="Add a widget">
        {hiddenDefinitions.length === 0 ? <p className="text-sm text-brand-500 dark:text-brand-200">All available widgets are already on your Home.</p> : (
          <div className="space-y-4">
            {(['Personal', 'Finance'] as const).map((category) => {
              const items = hiddenDefinitions.filter((widget) => widget.category === category);
              if (items.length === 0) return null;
              return <section key={category}><h3 className="mb-2 text-xs font-semibold uppercase text-brand-400 dark:text-brand-300">{category}</h3><div className="space-y-2">{items.map((widget) => <button key={widget.id} type="button" onClick={() => addWidget(widget.id)} className="flex w-full items-center justify-between gap-3 rounded-md border border-brand-100 p-3 text-left hover:border-brand-300 hover:bg-brand-50 dark:border-brand-600 dark:hover:bg-brand-600"><span><span className="block text-sm font-semibold text-brand-900 dark:text-brand-50">{widget.title}</span><span className="mt-0.5 block text-xs text-brand-400 dark:text-brand-300">{widget.description}</span></span><Plus className="shrink-0 text-brand-500" size={17} /></button>)}</div></section>;
            })}
          </div>
        )}
      </Modal>
    </>
  );
}
