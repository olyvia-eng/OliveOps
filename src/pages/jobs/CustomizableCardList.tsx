import { useState, type ReactNode } from 'react';
import { GripVertical, LayoutGrid, Plus, RotateCcw, X } from 'lucide-react';
import { Button, Card, Modal } from '../../components/ui';

export interface CustomizableCardDefinition<Id extends string> {
  id: Id;
  title: string;
  description: string;
  content: ReactNode;
}

interface CustomizableCardListProps<Id extends string> {
  cardIds: Id[];
  availableCardIds: Id[];
  definitions: CustomizableCardDefinition<Id>[];
  hydrated: boolean;
  emptyTitle: string;
  emptyDescription: string;
  addLabel?: string;
  resetTitle?: string;
  resetDescription?: string;
  onReorder: (nextOrder: Id[]) => void;
  onAdd: (id: Id) => void;
  onRemove: (id: Id) => void;
  onReset: () => void;
}

// A vertical, per-user customizable stack of full-width cards - the same "edit layout / add / drag /
// remove / reset" interaction as the Home dashboard's CustomizableWidgetGrid, but for a single column
// of cards rather than a 2D resizable grid, since these cards are always full width.
export default function CustomizableCardList<Id extends string>({
  cardIds,
  availableCardIds,
  definitions,
  hydrated,
  emptyTitle,
  emptyDescription,
  addLabel = 'Add card',
  resetTitle = 'Reset layout',
  resetDescription = 'Restore the default cards and order?',
  onReorder,
  onAdd,
  onRemove,
  onReset,
}: CustomizableCardListProps<Id>) {
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [dragId, setDragId] = useState<Id | null>(null);

  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const visibleDefinitions = cardIds.map((id) => definitionById.get(id)).filter((value): value is CustomizableCardDefinition<Id> => Boolean(value));
  const hiddenDefinitions = availableCardIds
    .map((id) => definitionById.get(id))
    .filter((value): value is CustomizableCardDefinition<Id> => Boolean(value))
    .filter((value) => !cardIds.includes(value.id));

  const handleDrop = (targetId: Id) => {
    if (!dragId || dragId === targetId) return;
    const withoutDragged = cardIds.filter((id) => id !== dragId);
    const targetIndex = withoutDragged.indexOf(targetId);
    onReorder([...withoutDragged.slice(0, targetIndex), dragId, ...withoutDragged.slice(targetIndex)]);
    setDragId(null);
  };

  const confirmReset = () => {
    onReset();
    setResetOpen(false);
  };

  return <>
    <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
      {editing ? <Button type="button" variant="ghost" size="sm" onClick={() => setResetOpen(true)}><RotateCcw />Reset layout</Button> : null}
      <Button type="button" variant="secondary" size="sm" onClick={() => setCatalogOpen(true)}><Plus />{addLabel}</Button>
      <Button type="button" variant={editing ? 'primary' : 'secondary'} size="sm" onClick={() => setEditing((value) => !value)}><LayoutGrid />{editing ? 'Done' : 'Edit layout'}</Button>
    </div>

    {!hydrated ? <div className="h-40 animate-pulse rounded-lg bg-gray-100" /> : null}
    {hydrated && visibleDefinitions.length === 0 ? (
      <Card className="rounded-lg p-8 text-center">
        <p className="font-semibold text-gray-900">{emptyTitle}</p>
        <p className="mt-1 text-sm text-gray-500">{emptyDescription}</p>
        <Button className="mt-4" onClick={() => setCatalogOpen(true)}><Plus />{addLabel}</Button>
      </Card>
    ) : null}

    {hydrated && visibleDefinitions.length > 0 ? (
      <div className="space-y-6">
        {visibleDefinitions.map((card) => (
          <div
            key={card.id}
            draggable={editing}
            onDragStart={() => setDragId(card.id)}
            onDragOver={(event) => { if (editing) event.preventDefault(); }}
            onDrop={() => handleDrop(card.id)}
            onDragEnd={() => setDragId(null)}
            className={dragId === card.id ? 'opacity-40' : ''}
          >
            {editing ? (
              <div className="mb-1 flex h-10 shrink-0 cursor-grab items-center justify-between rounded-t-lg border border-b-0 border-brand-100 bg-brand-50/80 px-3 text-sm font-semibold text-brand-700 active:cursor-grabbing dark:border-brand-600 dark:bg-brand-800 dark:text-brand-100">
                <span className="flex min-w-0 items-center gap-2">
                  <GripVertical size={16} className="shrink-0 text-brand-400" />
                  <span className="truncate">{card.title}</span>
                </span>
                <button
                  type="button"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-brand-400 hover:bg-white hover:text-accent-700 dark:hover:bg-brand-600"
                  onClick={() => onRemove(card.id)}
                  title="Remove card"
                  aria-label={`Remove ${card.title}`}
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
            {card.content}
          </div>
        ))}
      </div>
    ) : null}

    <Modal open={catalogOpen} onClose={() => setCatalogOpen(false)} title="Add a card">
      {hiddenDefinitions.length === 0 ? (
        <p className="text-sm text-gray-500">All available cards are already on this tab.</p>
      ) : (
        <div className="space-y-2">
          {hiddenDefinitions.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => { onAdd(card.id); setCatalogOpen(false); }}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-gray-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50"
            >
              <span>
                <span className="block text-sm font-semibold text-gray-900">{card.title}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{card.description}</span>
              </span>
              <Plus className="shrink-0 text-brand-500" size={17} />
            </button>
          ))}
        </div>
      )}
    </Modal>
    <Modal
      open={resetOpen}
      onClose={() => setResetOpen(false)}
      title={resetTitle}
      footer={<><Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button><Button onClick={confirmReset}>Reset layout</Button></>}
    >
      <p className="text-sm text-gray-500">{resetDescription}</p>
    </Modal>
  </>;
}
