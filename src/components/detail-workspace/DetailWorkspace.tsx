import type { ReactNode } from 'react';

interface DetailWorkspaceProps {
  open: boolean;
  expanded: boolean;
  list: ReactNode;
  detail: ReactNode;
  detailKey?: string | null;
}

export default function DetailWorkspace({ open, expanded, list, detail, detailKey }: DetailWorkspaceProps) {
  if (!open) return <>{list}</>;

  return (
    <div
      className={expanded
        ? 'min-w-0'
        : 'grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)] xl:grid-cols-[minmax(0,3fr)_minmax(26rem,2fr)]'}
      data-workspace-mode={expanded ? 'expanded' : 'panel'}
    >
      <div className={expanded ? 'hidden' : 'hidden min-w-0 lg:block'} aria-hidden={expanded}>
        {list}
      </div>
      <section
        key={detailKey ?? undefined}
        aria-label="Record details"
        className={expanded
          ? 'min-w-0 animate-[fadeIn_160ms_ease-out]'
          : 'detail-panel-surface min-w-0 overflow-hidden rounded-lg border shadow-sm lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]'}
      >
        <div className={expanded ? 'min-w-0' : 'h-full min-w-0 overflow-y-auto overscroll-contain'}>
          {detail}
        </div>
      </section>
    </div>
  );
}