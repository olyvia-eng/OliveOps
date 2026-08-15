import {
  Briefcase,
  CalendarDays,
  Clock,
  FileBox,
  FileText,
  FolderOpen,
  Receipt,
  LayoutDashboard,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { BusinessUserRole } from '../auth/types';
import type { SidebarConfig, SidebarLinkItem, SidebarNavItem, SidebarSectionConfig } from './types';

const ownerAdminRoles: BusinessUserRole[] = ['owner', 'admin'];

const icon = (value: LucideIcon): LucideIcon => value;

const NAVIGATION_CONFIG: SidebarConfig = {
  topLevel: [
    { id: 'top-home', type: 'link', to: '/home', end: true, label: 'Home', icon: icon(LayoutDashboard) },
  ],
  pinnedPages: [
    { id: 'pin-schedule', type: 'link', to: '/schedule', label: 'Schedule', icon: icon(CalendarDays) },
    { id: 'pin-clients', type: 'link', to: '/crm', label: 'Clients', icon: icon(Users) },
    { id: 'pin-jobs', type: 'link', to: '/jobs', label: "Today's Jobs", icon: icon(Briefcase) },
  ],
  sections: [
    {
      id: 'data-center',
      title: 'Data Center',
      collapsible: true,
      defaultExpanded: false,
      items: [
        { id: 'data-center-company-dashboard', type: 'link', to: '/company-dashboard', end: true, label: 'Company Dashboard', icon: icon(LayoutDashboard) },
        { id: 'data-center-documents', type: 'link', to: '/data-center/documents', label: 'Documents', icon: icon(FolderOpen) },
      ],
    },
    {
      id: 'revenue',
      title: 'Revenue',
      collapsible: true,
      defaultExpanded: true,
      items: [
        { id: 'revenue-clients', type: 'link', to: '/crm', label: 'Clients', icon: icon(Users) },
        { id: 'revenue-estimates', type: 'link', to: '/estimates', label: 'Estimates', icon: icon(FileText) },
      ],
    },
    {
      id: 'finance',
      title: 'Finance',
      collapsible: true,
      defaultExpanded: false,
      items: [
        { id: 'finance-company-budget', type: 'link', to: '/budgets', label: 'Budgets', icon: icon(Wallet) },
        { id: 'finance-invoices', type: 'link', to: '/finance/invoices', label: 'Invoices', icon: icon(Receipt) },
        {
          id: 'finance-reports',
          type: 'link',
          to: '/time-reports',
          label: 'Reports',
          icon: icon(Clock),
          roles: ownerAdminRoles,
        },
      ],
    },
    {
      id: 'operations',
      title: 'Operations',
      collapsible: true,
      defaultExpanded: false,
      items: [
        { id: 'operations-jobs', type: 'link', to: '/jobs', label: 'Jobs', icon: icon(Briefcase) },
        { id: 'operations-schedule', type: 'link', to: '/schedule', label: 'Schedule', icon: icon(CalendarDays) },
        { id: 'operations-forms', type: 'link', to: '/operations/forms', label: 'Forms', icon: icon(FileBox) },
      ],
    },
    {
      id: 'employees',
      title: 'Employees',
      collapsible: true,
      defaultExpanded: false,
      items: [
        { id: 'employees-list', type: 'link', to: '/employees', label: 'Employees', icon: icon(UserCheck) },
        {
          id: 'employees-time-tracking',
          type: 'link',
          to: '/time-reports',
          label: 'Time Tracking',
          icon: icon(Clock),
          roles: ownerAdminRoles,
        },
      ],
    },
  ],
};

const includesRole = (roles: BusinessUserRole[] | undefined, userRole: BusinessUserRole) => {
  if (!roles || roles.length === 0) return true;
  return roles.includes(userRole);
};

const collectLinkItems = (items: SidebarNavItem[]): SidebarLinkItem[] => {
  return items.flatMap((item) => {
    if (item.type === 'link') return [item];
    if (item.type === 'group') return collectLinkItems(item.children);
    return [];
  });
};

const filterNavItem = (item: SidebarNavItem, userRole: BusinessUserRole): SidebarNavItem | null => {
  if (!includesRole(item.roles, userRole)) return null;

  if (item.type !== 'group') return item;

  const children = item.children
    .map((child) => filterNavItem(child, userRole))
    .filter((child): child is SidebarNavItem => child !== null);

  if (children.length === 0) return null;
  return { ...item, children };
};

const filterSection = (section: SidebarSectionConfig, userRole: BusinessUserRole): SidebarSectionConfig | null => {
  if (!includesRole(section.roles, userRole)) return null;

  const items = section.items
    .map((item) => filterNavItem(item, userRole))
    .filter((item): item is SidebarNavItem => item !== null);

  if (items.length === 0) return null;
  return { ...section, items };
};

export const getSidebarConfig = (userRole: BusinessUserRole): SidebarConfig => {
  const topLevel = NAVIGATION_CONFIG.topLevel
    .map((item) => filterNavItem(item, userRole))
    .filter((item): item is SidebarNavItem => item !== null);

  const pinnedPages = NAVIGATION_CONFIG.pinnedPages
    .map((item) => filterNavItem(item, userRole))
    .filter((item): item is SidebarNavItem => item !== null);

  const sections = NAVIGATION_CONFIG.sections
    .map((section) => filterSection(section, userRole))
    .filter((section): section is SidebarSectionConfig => section !== null);

  return {
    topLevel,
    pinnedPages,
    sections,
  };
};

export const getSidebarLinkItems = (userRole: BusinessUserRole): SidebarLinkItem[] => {
  const config = getSidebarConfig(userRole);
  const sectionItems = config.sections.flatMap((section) => collectLinkItems(section.items));
  const all = [...collectLinkItems(config.topLevel), ...sectionItems];

  const seen = new Set<string>();
  const unique: SidebarLinkItem[] = [];

  for (const item of all) {
    const key = `${item.to}::${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
};
