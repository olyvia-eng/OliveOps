import {
  ChevronDown,
  Edit3,
  LogOut,
  Menu,
  X,
  Leaf,
  ChevronsLeft,
  ChevronsRight,
  Settings,
  MessageSquare,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { BusinessUserRole } from '../../auth/types';
import { getSidebarConfig } from '../../navigation/sidebarConfig';
import { Button, Input, Modal } from '../ui';
import SidebarItem from './SidebarItem';
import SidebarSection from './SidebarSection';
import FeedbackModal from '../feedback/FeedbackModal';
import type { AppearanceStyle, ThemePreference } from './useUiPreferences';

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
  userFirstName?: string;
  userLastName?: string;
  userEmail: string;
  businessName: string;
  userRole: BusinessUserRole;
  onLogout: () => void | Promise<void>;
  appearanceStyle: AppearanceStyle;
  onAppearanceStyleChange: (style: AppearanceStyle) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  isDesktopCollapsed: boolean;
  onToggleDesktopCollapsed: () => void;
}

export default function Sidebar({
  userName,
  userFirstName,
  userLastName,
  userEmail,
  businessName,
  userRole,
  onLogout,
  appearanceStyle,
  onAppearanceStyleChange,
  theme,
  onThemeChange,
  isDesktopCollapsed,
  onToggleDesktopCollapsed,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companySetupExpanded, setCompanySetupExpanded] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const legacyNameParts = userName.trim().split(/\s+/);
  const [profileFirstName, setProfileFirstName] = useState(userFirstName ?? legacyNameParts[0] ?? '');
  const [profileLastName, setProfileLastName] = useState(userLastName ?? legacyNameParts.slice(1).join(' '));
  const [profileEmail, setProfileEmail] = useState(userEmail);
  const [profilePassword, setProfilePassword] = useState('');
  const [profilePasswordConfirm, setProfilePasswordConfirm] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [isDesktopHoverExpanded, setIsDesktopHoverExpanded] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const [displayName, setDisplayName] = useState(userName);
  const [displayEmail, setDisplayEmail] = useState(userEmail);
  const navigation = useMemo(() => getSidebarConfig(userRole), [userRole]);
  const isDesktopVisuallyExpanded = !isDesktopCollapsed || isDesktopHoverExpanded;

  const clearHoverTimer = () => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  };

  const scheduleHoverExpansion = () => {
    if (!isDesktopCollapsed) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => setIsDesktopHoverExpanded(true), 190);
  };

  const scheduleHoverCollapse = () => {
    if (!isDesktopCollapsed) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => setIsDesktopHoverExpanded(false), 140);
  };

  useEffect(() => () => clearHoverTimer(), []);
  useEffect(() => { if (!isDesktopCollapsed) setIsDesktopHoverExpanded(false); }, [isDesktopCollapsed]);

  useEffect(() => {
    setDisplayName(userName);
  }, [userName]);

  useEffect(() => {
    setDisplayEmail(userEmail);
  }, [userEmail]);

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
      { label: 'Estimate Templates', path: '/estimates/templates', visible: true },
      { label: 'Company Settings', path: '/settings/company', visible: canManageCompanySetup },
      { label: 'Pricing', path: '/settings/pricing', visible: canManageCompanySetup },
      { label: 'Scheduling', path: '/settings/scheduling', visible: canManageCompanySetup },
      { label: 'Users & Access', path: '/user-access', visible: canManageCompanySetup },
      { label: 'Integrations', path: '/settings/integrations', visible: canManageCompanySetup },
      { label: 'Unbillable Categories', path: '/settings/unbillable-time-categories', visible: canManageCompanySetup },
    ].filter((item) => item.visible);
  }, [canManageCompanySetup]);

  const isCompanySetupItemActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const openProfileModal = () => {
    setProfileEmail(displayEmail);
    setProfilePassword('');
    setProfilePasswordConfirm('');
    setProfileError('');
    setProfileModalOpen(true);
  };

  const saveProfile = async () => {
    setProfileError('');

    if (!profileFirstName.trim() || !profileLastName.trim() || !profileEmail.trim()) {
      setProfileError('First name, last name, and email are required.');
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
      const payload: { firstName: string; lastName: string; email: string; password?: string } = {
        firstName: profileFirstName.trim(),
        lastName: profileLastName.trim(),
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

      setDisplayName(body.user?.name ?? `${payload.firstName} ${payload.lastName}`);
      setDisplayEmail(body.user?.email ?? payload.email);
      setProfileModalOpen(false);
    } catch {
      setProfileError('Could not update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const userInitials = displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      {/* Mobile top bar */}
      <div className="app-header-surface lg:hidden fixed top-0 left-0 right-0 z-30 border-b flex items-center justify-between px-4 h-14">
        <button
          type="button"
          onClick={() => navigate('/home')}
          className="flex items-center gap-2 font-semibold text-brand-800 dark:text-brand-100"
        >
          <Leaf size={22} />
          OliveOps
        </button>
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
        className={`sidebar-surface lg:hidden fixed top-14 left-0 bottom-0 z-20 w-72 border-r p-4 flex flex-col transform transition-transform ${
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

          {navigation.sections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              compact
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
        data-sidebar-state={isDesktopCollapsed ? isDesktopHoverExpanded ? 'hover-expanded' : 'collapsed' : 'expanded'}
        onMouseEnter={scheduleHoverExpansion}
        onMouseLeave={scheduleHoverCollapse}
        className={`sidebar-surface hidden lg:flex flex-col min-h-screen border-r fixed top-0 left-0 bottom-0 overflow-hidden transition-[width,box-shadow] duration-200 ${isDesktopVisuallyExpanded ? 'w-72 p-4' : 'w-16 p-3'} ${isDesktopHoverExpanded ? 'z-40 shadow-2xl' : 'z-30'}`}
      >
        <div className={`flex h-10 shrink-0 items-center font-semibold text-brand-800 dark:text-brand-100 mb-4 ${isDesktopVisuallyExpanded ? 'justify-between gap-2 px-1' : 'justify-center'}`}>
          <button
            type="button"
            onClick={() => navigate('/home')}
            aria-label="OliveOps Home"
            title={!isDesktopVisuallyExpanded ? 'OliveOps Home' : undefined}
            className="flex items-center gap-2 min-w-0 shrink-0"
          >
            <Leaf size={24} />
            {isDesktopVisuallyExpanded ? <span className="text-2xl truncate">OliveOps</span> : null}
          </button>
          {isDesktopVisuallyExpanded ? <button
            type="button"
            onClick={() => { clearHoverTimer(); onToggleDesktopCollapsed(); }}
            aria-label={isDesktopCollapsed ? 'Keep sidebar expanded' : 'Collapse sidebar'}
            title={isDesktopCollapsed ? 'Keep expanded' : 'Collapse sidebar'}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-brand-600 dark:text-brand-200 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            {isDesktopCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button> : null}
        </div>

        <div className={`flex-1 overflow-y-auto ${isDesktopVisuallyExpanded ? 'pr-1' : ''}`}>
          <div className={isDesktopVisuallyExpanded ? 'mb-3 space-y-0.5' : 'mb-2 space-y-1'}>
            {navigation.topLevel.map((item) => (
              <SidebarItem
                key={`desktop-${item.id}`}
                item={item}
                compact
                iconOnly={!isDesktopVisuallyExpanded}
                onNavigate={handleNavigate}
                onAction={handleAction}
              />
            ))}
          </div>

          {navigation.sections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              compact
              iconOnly={!isDesktopVisuallyExpanded}
              onNavigate={handleNavigate}
              onAction={handleAction}
            />
          ))}
        </div>

        <div className="pt-3 border-t border-brand-100 dark:border-brand-600">
          <button
            type="button"
            onClick={openProfileModal}
            aria-label="Profile and appearance settings"
            title={!isDesktopVisuallyExpanded ? 'Profile and appearance settings' : undefined}
            className={`w-full flex items-center mb-2 text-left rounded-lg hover:bg-accent-50 dark:hover:bg-brand-600 ${isDesktopVisuallyExpanded ? 'gap-3 px-1' : 'h-10 justify-center'}`}
          >
            <div className="h-8 w-8 rounded-full bg-accent-100 dark:bg-brand-600 text-accent-600 dark:text-accent-400 flex items-center justify-center text-xs font-semibold">{userInitials}</div>
            {isDesktopVisuallyExpanded ? <div className="min-w-0">
              <p className="text-xs font-semibold text-brand-900 dark:text-brand-100 truncate">{displayName}</p>
              <p className="text-[11px] text-brand-600 dark:text-brand-300 truncate">{displayEmail}</p>
            </div> : null}
            {isDesktopVisuallyExpanded ? <Edit3 size={14} className="ml-auto text-brand-400 dark:text-brand-300" /> : null}
          </button>
          {isDesktopVisuallyExpanded ? <>
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
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-accent-600 dark:text-accent-400 hover:bg-accent-50 dark:hover:bg-brand-600"
          >
            <LogOut size={16} /> Log Out
          </button>
          </> : <div className="space-y-1">
            <button type="button" onClick={() => { setIsDesktopHoverExpanded(true); setCompanySetupExpanded(true); }} aria-label="Company Setup" title="Company Setup" className="grid h-10 w-full place-items-center rounded-lg text-brand-700 hover:bg-accent-50 dark:text-brand-100 dark:hover:bg-brand-600"><Settings size={17} /></button>
            <button type="button" onClick={openFeedbackModal} aria-label="Send Feedback" title="Send Feedback" className="grid h-10 w-full place-items-center rounded-lg text-brand-700 hover:bg-accent-50 dark:text-brand-100 dark:hover:bg-brand-600"><MessageSquare size={17} /></button>
            <button type="button" onClick={onLogout} aria-label="Log Out" title="Log Out" className="grid h-10 w-full place-items-center rounded-lg text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-brand-600"><LogOut size={17} /></button>
          </div>}
        </div>
      </aside>

      <Modal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        title="Profile & Appearance"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setProfileModalOpen(false)} disabled={profileSaving}>Cancel</Button>
            <Button onClick={() => void saveProfile()} disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save Changes'}</Button>
          </>
        )}
      >
        <div className="space-y-3">
          <Input label="Business" value={businessName} disabled />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="First Name" value={profileFirstName} onChange={(event) => setProfileFirstName(event.target.value)} autoComplete="given-name" />
            <Input label="Last Name" value={profileLastName} onChange={(event) => setProfileLastName(event.target.value)} autoComplete="family-name" />
          </div>
          <Input label="Email" type="email" value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} />
          <Input label="New Password (optional)" type="password" value={profilePassword} onChange={(event) => setProfilePassword(event.target.value)} />
          <Input label="Confirm New Password" type="password" value={profilePasswordConfirm} onChange={(event) => setProfilePasswordConfirm(event.target.value)} />
          <section className="border-t border-brand-100 pt-4 dark:border-brand-600">
            <div><h3 className="text-sm font-semibold">Theme</h3><p className="mt-0.5 text-xs text-brand-400 dark:text-brand-300">Use your device setting or choose a theme.</p></div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['system', 'light', 'dark'] as const).map((value) => (
                <label key={value} className={`cursor-pointer rounded-lg border p-3 text-sm font-semibold capitalize ${theme === value ? 'border-accent-500 bg-accent-50 dark:bg-brand-600' : 'border-brand-100 bg-white dark:border-brand-600 dark:bg-brand-700'}`}>
                  <span className="flex items-center gap-2"><input type="radio" name="theme" value={value} checked={theme === value} onChange={() => onThemeChange(value)} />{value}</span>
                </label>
              ))}
            </div>
          </section>
          <section className="border-t border-brand-100 pt-4 dark:border-brand-600">
            <div><h3 className="text-sm font-semibold">Interface Style</h3><p className="mt-0.5 text-xs text-brand-400 dark:text-brand-300">Changes preview and save immediately.</p></div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {([
                ['standard', 'Standard', 'Current OliveOps surfaces.'],
                ['tinted-glass', 'Tinted Glass', 'Frosted surfaces with an OliveOps tint.'],
                ['clear-glass', 'Clear Glass', 'Lighter neutral frosted surfaces.'],
              ] as const).map(([value, label, description]) => (
                <label key={value} className={`cursor-pointer rounded-lg border p-3 ${appearanceStyle === value ? 'border-accent-500 bg-accent-50 dark:bg-brand-600' : 'border-brand-100 bg-white dark:border-brand-600 dark:bg-brand-700'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="appearance-style" value={value} checked={appearanceStyle === value} onChange={() => onAppearanceStyleChange(value)} />{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-brand-400 dark:text-brand-300">{description}</span>
                  <span className={`appearance-preview appearance-preview-${value} mt-3 block h-9 rounded-md border`} aria-hidden="true" />
                </label>
              ))}
            </div>
          </section>
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
