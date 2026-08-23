import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { SidebarNavItem } from '../../navigation/types';

interface SidebarItemProps {
  item: SidebarNavItem;
  level?: number;
  compact?: boolean;
  iconOnly?: boolean;
  onNavigate?: () => void;
  onAction?: (actionId: string) => void;
}

const isRouteActive = (pathname: string, to: string, end?: boolean) => {
  if (to === '/') return pathname === '/';
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
};

const hasActiveDescendant = (item: SidebarNavItem, pathname: string): boolean => {
  if (item.type === 'link') return isRouteActive(pathname, item.to, item.end);
  if (item.type === 'action') return false;
  return item.children.some((child) => hasActiveDescendant(child, pathname));
};

export default function SidebarItem({
  item,
  level = 0,
  compact = false,
  iconOnly = false,
  onNavigate,
  onAction,
}: SidebarItemProps) {
  const { pathname } = useLocation();
  const isBranchActive = useMemo(() => hasActiveDescendant(item, pathname), [item, pathname]);

  const [expanded, setExpanded] = useState(item.type === 'group' ? (item.defaultExpanded ?? true) : false);

  useEffect(() => {
    if (item.type !== 'group') return;
    if (isBranchActive) setExpanded(true);
  }, [isBranchActive, item.type]);

  const indentStyle = level > 0 ? { marginLeft: `${Math.min(level * 10, 40)}px` } : undefined;

  if (item.type === 'action') {
    const Icon = item.icon;
    return (
      <button
        type="button"
        aria-label={item.label}
        title={iconOnly ? item.label : undefined}
        onClick={() => onAction?.(item.actionId)}
        style={indentStyle}
        className={`w-full flex items-center gap-2 ${iconOnly ? 'h-10 justify-center px-0' : compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} rounded-lg text-sm font-medium text-brand-700 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600 hover:text-brand-900 dark:hover:text-brand-50`}
      >
        {Icon ? <Icon size={compact ? 14 : 15} /> : null}
        {!iconOnly ? <span className="truncate">{item.label}</span> : null}
      </button>
    );
  }

  if (item.type === 'link') {
    const Icon = item.icon;

    return (
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        aria-label={item.label}
        title={iconOnly ? item.label : undefined}
        style={indentStyle}
        className={({ isActive }) =>
          `group relative flex min-w-0 items-center gap-2 ${iconOnly ? 'h-10 justify-center px-0' : compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${iconOnly ? '' : 'pl-3'} rounded-lg text-sm font-medium transition-colors ${
            isActive
              ? 'bg-accent-100 dark:bg-brand-600 text-brand-900 dark:text-brand-50 border border-accent-200 dark:border-brand-500 shadow-sm'
              : 'text-brand-700 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600 hover:text-brand-900 dark:hover:text-brand-50 border border-transparent'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <span className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r ${isActive ? 'bg-accent-500' : 'bg-transparent group-hover:bg-accent-400 dark:group-hover:bg-brand-400'}`} />
            {Icon ? <Icon size={compact ? 14 : 15} /> : null}
            {!iconOnly ? <span className="truncate text-left">{item.label}</span> : null}
          </>
        )}
      </NavLink>
    );
  }

  const GroupIcon = item.icon;
  const isCollapsible = item.collapsible !== false;

  return (
    <div style={indentStyle} className="relative">
      <button
        type="button"
        aria-label={item.label}
        title={iconOnly ? item.label : undefined}
        className={`w-full flex items-center ${iconOnly ? 'h-10 justify-center px-0' : `justify-between ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`} rounded-lg text-sm font-medium transition-colors ${
          isBranchActive
            ? 'text-brand-900 dark:text-brand-50 bg-accent-100 dark:bg-brand-600 border border-accent-200 dark:border-brand-500 shadow-sm'
            : 'text-brand-700 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600 hover:text-brand-900 dark:hover:text-brand-50 border border-transparent'
        }`}
        onClick={() => {
          if (!isCollapsible) return;
          setExpanded((current) => !current);
        }}
      >
        <span className="flex items-center gap-2 min-w-0">
          {GroupIcon ? <GroupIcon size={compact ? 14 : 15} /> : null}
          {!iconOnly ? <span className="truncate">{item.label}</span> : null}
        </span>
        {isCollapsible && !iconOnly ? (
          <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : 'rotate-0'}`} />
        ) : null}
      </button>

      {expanded && !iconOnly && (
        <div className="mt-1 ml-2 pl-2 border-l border-brand-100 dark:border-brand-600 space-y-0.5" role="menu" aria-label={`${item.label} submenu`}>
          {item.children.map((child) => (
            <SidebarItem
              key={child.id}
              item={child}
              level={level + 1}
              compact={compact}
              iconOnly={iconOnly}
              onNavigate={onNavigate}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
