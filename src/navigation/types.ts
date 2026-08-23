import type { LucideIcon } from 'lucide-react';
import type { BusinessUserRole } from '../auth/types';

export type NavRole = BusinessUserRole;

type NavBase = {
  id: string;
  label: string;
  icon?: LucideIcon;
  roles?: NavRole[];
};

export type SidebarLinkItem = NavBase & {
  type: 'link';
  to: string;
  end?: boolean;
};

export type SidebarGroupItem = NavBase & {
  type: 'group';
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: SidebarNavItem[];
};

export type SidebarActionItem = NavBase & {
  type: 'action';
  actionId: string;
};

export type SidebarNavItem = SidebarLinkItem | SidebarGroupItem | SidebarActionItem;

export type SidebarSectionConfig = {
  id: string;
  title: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  roles?: NavRole[];
  items: SidebarNavItem[];
};

export type SidebarConfig = {
  topLevel: SidebarNavItem[];
  sections: SidebarSectionConfig[];
};
