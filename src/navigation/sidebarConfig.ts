import {
  BarChart3,
  Briefcase,
  CalendarDays,
  Clock,
  FileBox,
  FileText,
  FolderOpen,
  PackageSearch,
  Receipt,
  LayoutDashboard,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { BusinessUserRole } from '../auth/types';
import type { SidebarConfig, SidebarNavItem, SidebarSectionConfig } from './types';

const ownerAdminRoles: BusinessUserRole[] = ['owner', 'admin'];

const icon = (value: LucideIcon): LucideIcon => value;

const NAVIGATION_CONFIG: SidebarConfig = {
  topLevel: [
    { id: 'top-home', type: 'link', to: '/home', end: true, label: 'Home', icon: icon(LayoutDashboard) },
  ],
  sections: [
    {
      id: 'workflow',
      title: 'Workflow',
      collapsible: false,
      defaultExpanded: true,
      items: [
        { id: 'workflow-clients', type: 'link', to: '/crm', label: 'Clients', icon: icon(Users) },
        { id: 'workflow-estimates', type: 'link', to: '/estimates', label: 'Estimates', icon: icon(FileText) },
        { id: 'workflow-jobs', type: 'link', to: '/jobs', label: 'Jobs', icon: icon(Briefcase) },
        { id: 'workflow-schedule', type: 'link', to: '/schedule', label: 'Schedule', icon: icon(CalendarDays) },
      ],
    },
    {
      id: 'team',
      title: 'Team',
      collapsible: false,
      defaultExpanded: true,
      items: [
        { id: 'team-employees', type: 'link', to: '/employees', label: 'Employees', icon: icon(UserCheck) },
        {
          id: 'team-time-tracking',
          type: 'link',
          to: '/time-reports',
          label: 'Time Tracking',
          icon: icon(Clock),
          roles: ownerAdminRoles,
        },
        { id: 'team-forms', type: 'link', to: '/operations/forms', label: 'Forms', icon: icon(FileBox) },
      ],
    },
    {
      id: 'business',
      title: 'Business',
      collapsible: false,
      defaultExpanded: true,
      items: [
        { id: 'business-budgets', type: 'link', to: '/budgets', label: 'Budgets', icon: icon(Wallet) },
        { id: 'business-catalog', type: 'link', to: '/materials/catalog', label: 'Catalog', icon: icon(PackageSearch) },
        { id: 'business-reports', type: 'link', to: '/data-center/dashboard', label: 'Reports', icon: icon(BarChart3), roles: ownerAdminRoles },
        { id: 'business-documents', type: 'link', to: '/data-center/documents', label: 'Documents', icon: icon(FolderOpen) },
        { id: 'business-invoices', type: 'link', to: '/finance/invoices', label: 'Invoices', icon: icon(Receipt) },
      ],
    },
  ],
};

const includesRole = (roles: BusinessUserRole[] | undefined, userRole: BusinessUserRole) => {
  if (!roles || roles.length === 0) return true;
  return roles.includes(userRole);
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

  const sections = NAVIGATION_CONFIG.sections
    .map((section) => filterSection(section, userRole))
    .filter((section): section is SidebarSectionConfig => section !== null);

  return {
    topLevel,
    sections,
  };
};