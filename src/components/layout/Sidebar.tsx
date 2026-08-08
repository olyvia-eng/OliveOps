import {
  ChevronDown,
  Edit3,
  LogOut,
  Menu,
  X,
  Leaf,
  Pin,
  Moon,
  Sun,
  ChevronsLeft,
  Settings,
  MessageSquare,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { BusinessUserRole } from '../../auth/types';
import { getSidebarConfig, getSidebarLinkItems } from '../../navigation/sidebarConfig';
import type { SidebarNavItem } from '../../navigation/types';
import { Button, Input, Modal } from '../ui';
import SidebarItem from './SidebarItem';
import SidebarSection from './SidebarSection';
import { usePinnedPages } from '../../navigation/PinnedPagesContext';
import FeedbackModal from '../feedback/FeedbackModal';

const EXPANDED_SECTIONS_STORAGE_KEY = 'oliveops.sidebar.expanded-sections.v1';
const THEME_STORAGE_KEY = 'oliveops.theme.v1';

const ACTION_ROUTE_MAP: Record<string, string> = {
  'placeholder-leads': '/revenue/leads',
  'placeholder-change-orders': '/revenue/change-orders',
  'placeholder-invoices': '/finance/invoices',
  'placeholder-purchase-orders': '/operations/purchase-orders',
  'placeholder-payroll': '/employees/payroll',
  'placeholder-certifications': '/employees/certifications',
  'placeholder-documents': '/data-center/documents',
  'placeholder-forms': '/operations/forms',
  'placeholder-photos': '/data-center/photos',
  'placeholder-settings': '/materials/catalog',
};

interface SidebarProps {
  userName: string;
  userEmail: string;
  businessName: string;
  userRole: BusinessUserRole;
  onLogout: () => void | Promise<void>;
  isDesktopCollapsed: boolean;
  onToggleDesktopCollapsed: () => void;
}

export default function Sidebar({
  userName,
  userEmail,
  businessName,
  userRole,
  onLogout,
  isDesktopCollapsed,
  onToggleDesktopCollapsed,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [companySetupExpanded, setCompanySetupExpanded] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileName, setProfileName] = useState(userName);
  const [profileEmail, setProfileEmail] = useState(userEmail);
  const [profilePassword, setProfilePassword] = useState('');
  const [profilePasswordConfirm, setProfilePasswordConfirm] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState(userName);
  const [displayEmail, setDisplayEmail] = useState(userEmail);
  const navigation = useMemo(() => getSidebarConfig(userRole), [userRole]);
  const linkCandidates = useMemo(() => getSidebarLinkItems(userRole), [userRole]);
  const { pinnedPages, reorderPinnedPages } = usePinnedPages();
  const previousPinnedCountRef = useRef(pinnedPages.length);

  const allSectionIds = useMemo(() => {
    return ['pinned', ...navigation.sections.map((section) => section.id)];
  }, [navigation.sections]);

  const [expandedSectionIds, setExpandedSectionIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];

    try {
      const raw = window.localStorage.getItem(EXPANDED_SECTIONS_STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    setExpandedSectionIds((current) => {
      const filtered = current.filter((id) => allSectionIds.includes(id));
      if (filtered.length === current.length && filtered.every((id, index) => id === current[index])) {
        return current;
      }
      return filtered;
    });
  }, [allSectionIds]);

  useEffect(() => {
    window.localStorage.setItem(EXPANDED_SECTIONS_STORAGE_KEY, JSON.stringify(expandedSectionIds));
  }, [expandedSectionIds]);

  useEffect(() => {
    const previousCount = previousPinnedCountRef.current;
    const currentCount = pinnedPages.length;

    if (currentCount > previousCount) {
      setExpandedSectionIds((current) => (current.includes('pinned') ? current : [...current, 'pinned']));
    }

    previousPinnedCountRef.current = currentCount;
  }, [pinnedPages.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'dark') {
      setIsDarkMode(true);
      return;
    }
    if (storedTheme === 'light') {
      setIsDarkMode(false);
      return;
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(prefersDark);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    document.documentElement.classList.toggle('dark', isDarkMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    setDisplayName(userName);
  }, [userName]);

  useEffect(() => {
    setDisplayEmail(userEmail);
  }, [userEmail]);

  const toggleTheme = () => {
    setIsDarkMode((current) => !current);
  };

  const handleNavigate = () => {
    setMobileOpen(false);
  };

  const handleAction = (actionId: string) => {
    const path = ACTION_ROUTE_MAP[actionId];
    if (!path) return;
    navigate(path);
  };

  const navigateFromProfile = (path: string) => {
    setMobileOpen(false);
    navigate(path);
  };

  const openFeedbackModal = () => {
    setMobileOpen(false);
    setFeedbackModalOpen(true);
  };

  const canManageCompanySetup = userRole === 'owner' || userRole === 'admin';

  const companySetupItems = useMemo(() => {
    return [
      { label: 'Catalog', path: '/materials/catalog', visible: true },
      { label: 'Estimate Templates', path: '/estimates/templates', visible: true },
      { label: 'Users & Access', path: '/user-access', visible: canManageCompanySetup },
      { label: 'Unbillable Categories', path: '/settings/unbillable-time-categories', visible: canManageCompanySetup },
    ].filter((item) => item.visible);
  }, [canManageCompanySetup]);

  const isCompanySetupItemActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const openProfileModal = () => {
    setProfileName(displayName);
    setProfileEmail(displayEmail);
    setProfilePassword('');
    setProfilePasswordConfirm('');
    setProfileError('');
    setProfileModalOpen(true);
  };

  const saveProfile = async () => {
    setProfileError('');

    if (!profileName.trim() || !profileEmail.trim()) {
      setProfileError('Name and email are required.');
      return;
    }

    if (profilePassword && profilePassword.length < 8) {
      setProfileError('Password must be at least 8 characters.');
      return;
    }

    if (profilePassword !== profilePasswordConfirm) {
      setProfileError('Passwords do not match.');
      return;
    }

    setProfileSaving(true);
    try {
      const payload: { name: string; email: string; password?: string } = {
        name: profileName.trim(),
        email: profileEmail.trim(),
      };

      if (profilePassword) {
        payload.password = profilePassword;
      }

      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await response.json() as { ok?: boolean; error?: string; user?: { name: string; email: string } };
      if (!response.ok || !body?.ok) {
        setProfileError(body?.error ?? 'Could not update profile.');
        setProfileSaving(false);
        return;
      }

      setDisplayName(body.user?.name ?? payload.name);
      setDisplayEmail(body.user?.email ?? payload.email);
      setProfileModalOpen(false);
    } catch {
      setProfileError('Could not update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const isExpanded = (sectionId: string) => expandedSectionIds.includes(sectionId);
  const toggleSection = (sectionId: string) => {
    setExpandedSectionIds((current) => {
      if (sectionId === 'pinned') {
        if (current.includes('pinned')) {
          return current.filter((id) => id !== 'pinned');
        }
        return [...current, 'pinned'];
      }

      const pinnedExpanded = current.includes('pinned');
      if (current.includes(sectionId)) {
        return pinnedExpanded ? ['pinned'] : [];
      }

      return pinnedExpanded ? ['pinned', sectionId] : [sectionId];
    });
  };

  const pinnedItems: SidebarNavItem[] = useMemo(() => {
    return pinnedPages.map((pinnedPage) => ({
      ...(linkCandidates.find((candidate) => candidate.to === pinnedPage.to && candidate.label === pinnedPage.label) ?? {}),
      id: `pin-${pinnedPage.id}`,
      type: 'link' as const,
      to: pinnedPage.to,
      end: pinnedPage.end,
      label: pinnedPage.label,
    }));
  }, [pinnedPages, linkCandidates]);

  const renderPinnedItem = (item: SidebarNavItem, index: number) => (
    <div
      key={`pin-${item.id}`}
      className="flex items-center"
      draggable
      onDragStart={() => setDragIndex(index)}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={() => {
        if (dragIndex === null) return;
        reorderPinnedPages(dragIndex, index);
        setDragIndex(null);
      }}
      onDragEnd={() => setDragIndex(null)}
    >
      <Pin size={12} className="mr-2 text-accent-600" />
      <SidebarItem
        item={item}
        compact
        onNavigate={handleNavigate}
        onAction={handleAction}
      />
    </div>
  );

  const userInitials = displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-white dark:bg-brand-800 border-b border-brand-100 dark:border-brand-600 flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2 font-semibold text-brand-800 dark:text-brand-100">
          <Leaf size={22} />
          OliveOps
        </div>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-lg text-brand-800 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-700"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-20 bg-brand-900/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`lg:hidden fixed top-14 left-0 bottom-0 z-20 w-72 bg-white dark:bg-brand-800 border-r border-brand-100 dark:border-brand-600 p-4 flex flex-col transform transition-transform ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="mb-3 space-y-0.5">
            {navigation.topLevel.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                compact
                onNavigate={handleNavigate}
                onAction={handleAction}
              />
            ))}
          </div>

          <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 p-3 mb-4">
            <button
              type="button"
              className="w-full text-left px-1 text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300 mb-1"
              onClick={() => toggleSection('pinned')}
            >
              Pinned
            </button>
            {isExpanded('pinned') && (
              <div className="space-y-0.5">
                {pinnedItems.map((item, index) => renderPinnedItem(item, index))}
              </div>
            )}
          </div>

          {navigation.sections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              compact
              collapsed={!isExpanded(section.id)}
              onToggle={toggleSection}
              onNavigate={handleNavigate}
              onAction={handleAction}
            />
          ))}
        </div>
        <div className="pt-3 border-t border-brand-100 dark:border-brand-600 mt-3">
          <button
            type="button"
            onClick={openProfileModal}
            className="w-full flex items-center gap-3 px-1 mb-2 text-left rounded-lg hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <div className="h-8 w-8 rounded-full bg-accent-100 dark:bg-brand-600 text-accent-600 dark:text-accent-400 flex items-center justify-center text-xs font-semibold">{userInitials}</div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-900 dark:text-brand-100 truncate">{displayName}</p>
              <p className="text-[11px] text-brand-600 dark:text-brand-300 truncate">{displayEmail}</p>
            </div>
            <Edit3 size={14} className="ml-auto text-brand-400 dark:text-brand-300" />
          </button>
          <button
            onClick={() => setCompanySetupExpanded((current) => !current)}
            className="w-full mb-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <span className="inline-flex items-center gap-2"><Settings size={16} /> Company Setup</span>
            <ChevronDown size={14} className={`transition-transform ${companySetupExpanded ? 'rotate-180' : 'rotate-0'}`} />
          </button>
          {companySetupExpanded && (
            <div className="mb-2 ml-3 pl-3 border-l border-brand-100 dark:border-brand-600 space-y-1">
              {companySetupItems.map((item) => (
                <button
                  key={`mobile-company-setup-${item.path}`}
                  onClick={() => navigateFromProfile(item.path)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm ${isCompanySetupItemActive(item.path) ? 'bg-accent-50 dark:bg-brand-600 text-brand-900 dark:text-brand-100 font-medium' : 'text-brand-700 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={openFeedbackModal}
            className="w-full mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <MessageSquare size={16} /> Send Feedback
          </button>
          <button
            onClick={toggleTheme}
            className="w-full mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />} {isDarkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button
            onClick={() => {
              setMobileOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <LogOut size={16} /> Log Out
          </button>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col w-72 min-h-screen bg-white dark:bg-brand-800 border-r border-brand-100 dark:border-brand-600 p-4 fixed top-0 left-0 bottom-0 transition-transform duration-200 ${
          isDesktopCollapsed ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between gap-2 font-semibold text-brand-800 dark:text-brand-100 text-[28px] mb-4 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <Leaf size={24} />
            <span className="text-2xl truncate">OliveOps</span>
          </div>
          <button
            type="button"
            onClick={onToggleDesktopCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-brand-600 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <ChevronsLeft size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="mb-3 space-y-0.5">
            {navigation.topLevel.map((item) => (
              <SidebarItem
                key={`desktop-${item.id}`}
                item={item}
                compact
                onNavigate={handleNavigate}
                onAction={handleAction}
              />
            ))}
          </div>

          <div className="rounded-xl border border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-700 p-3 mb-4">
            <button
              type="button"
              className="w-full text-left px-1 text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300 mb-1"
              onClick={() => toggleSection('pinned')}
            >
              Pinned
            </button>
            {isExpanded('pinned') && (
              <div className="space-y-0.5">
                {pinnedItems.map((item, index) => renderPinnedItem(item, index))}
              </div>
            )}
          </div>

          {navigation.sections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              compact
              collapsed={!isExpanded(section.id)}
              onToggle={toggleSection}
              onNavigate={handleNavigate}
              onAction={handleAction}
            />
          ))}
        </div>

        <div className="pt-3 border-t border-brand-100 dark:border-brand-600">
          <button
            type="button"
            onClick={openProfileModal}
            className="w-full flex items-center gap-3 px-1 mb-2 text-left rounded-lg hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <div className="h-8 w-8 rounded-full bg-accent-100 dark:bg-brand-600 text-accent-600 dark:text-accent-400 flex items-center justify-center text-xs font-semibold">{userInitials}</div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-900 dark:text-brand-100 truncate">{displayName}</p>
              <p className="text-[11px] text-brand-600 dark:text-brand-300 truncate">{displayEmail}</p>
            </div>
            <Edit3 size={14} className="ml-auto text-brand-400 dark:text-brand-300" />
          </button>
          <button
            onClick={() => setCompanySetupExpanded((current) => !current)}
            className="w-full mb-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <span className="inline-flex items-center gap-2"><Settings size={16} /> Company Setup</span>
            <ChevronDown size={14} className={`transition-transform ${companySetupExpanded ? 'rotate-180' : 'rotate-0'}`} />
          </button>
          {companySetupExpanded && (
            <div className="mb-2 ml-3 pl-3 border-l border-brand-100 dark:border-brand-600 space-y-1">
              {companySetupItems.map((item) => (
                <button
                  key={`desktop-company-setup-${item.path}`}
                  onClick={() => navigateFromProfile(item.path)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm ${isCompanySetupItemActive(item.path) ? 'bg-accent-50 dark:bg-brand-600 text-brand-900 dark:text-brand-100 font-medium' : 'text-brand-700 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={openFeedbackModal}
            className="w-full mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <MessageSquare size={16} /> Send Feedback
          </button>
          <button
            onClick={toggleTheme}
            className="w-full mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />} {isDarkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <LogOut size={16} /> Log Out
          </button>
        </div>
      </aside>

      <Modal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        title="Edit Profile"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setProfileModalOpen(false)} disabled={profileSaving}>Cancel</Button>
            <Button onClick={() => void saveProfile()} disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save Changes'}</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Input label="Business" value={businessName} disabled />
          <Input label="Full Name" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          <Input label="Email" type="email" value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} />
          <Input label="New Password (optional)" type="password" value={profilePassword} onChange={(event) => setProfilePassword(event.target.value)} />
          <Input label="Confirm New Password" type="password" value={profilePasswordConfirm} onChange={(event) => setProfilePasswordConfirm(event.target.value)} />
          {profileError && <p className="text-sm text-accent-700">{profileError}</p>}
        </div>
      </Modal>

      <FeedbackModal
        open={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
      />
    </>
  );
}
