import type { ReactNode } from 'react';
import { Minimize2, Maximize2, X } from 'lucide-react';
import { Button } from '../ui';

interface DetailWorkspaceHeaderProps {
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

export default function DetailWorkspaceHeader({
  title,
  subtitle,
  status,
  actions,
  expanded,
  onExpand,
  onCollapse,
  onClose,
}: DetailWorkspaceHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-brand-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-brand-600 dark:bg-brand-700/95 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-gray-900 dark:text-brand-50 sm:text-xl">{title}</h1>
            {status}
          </div>
          {subtitle ? <div className="mt-1 text-sm text-gray-500 dark:text-brand-200">{subtitle}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={expanded ? onCollapse : onExpand}
            title={expanded ? 'Collapse to panel' : 'Expand details'}
            aria-label={expanded ? 'Collapse to panel' : 'Expand details'}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} title="Close details" aria-label="Close details">
            <X size={17} />
          </Button>
        </div>
      </div>
    </header>
  );
}