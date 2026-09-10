import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card } from '../ui';
import type { LineItemCategory } from '../../types';
import { WORK_AREA_CATEGORY_ADD_LABEL, WORK_AREA_CATEGORY_LABEL } from './workAreaCategories';

interface Props {
  category: LineItemCategory;
  itemCount: number;
  canAdd: boolean;
  onAdd: () => void;
  emptyText: string;
  children?: ReactNode;
}

export default function WorkAreaResourceSection({ category, itemCount, canAdd, onAdd, emptyText, children }: Props) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-brand-50">{WORK_AREA_CATEGORY_LABEL[category]}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-brand-300">{itemCount} item{itemCount === 1 ? '' : 's'}</p>
        </div>
        {canAdd ? <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus size={14} /> Add {WORK_AREA_CATEGORY_ADD_LABEL[category]}
        </Button> : null}
      </div>
      {itemCount === 0 ? <p className="mt-4 text-sm text-gray-500 dark:text-brand-300">{emptyText}</p> : children}
    </Card>
  );
}