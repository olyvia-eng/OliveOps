import { Outlet, useLocation } from 'react-router-dom';
import { Menu, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import type { BusinessUserRole } from '../../auth/types';
import { PinnedPagesProvider, usePinnedPages } from '../../navigation/PinnedPagesContext';
import { Button } from '../ui';
import NotificationBell from '../notifications/NotificationBell';

const DESKTOP_SIDEBAR_COLLAPSED_KEY = 'oliveops.sidebar.desktop-collapsed.v1';

interface AppLayoutProps {
  userName: string;
  userFirstName?: string;
  userLastName?: string;
  userEmail: string;
  businessName: string;
  userRole: BusinessUserRole;
  onLogout: () => void | Promise<void>;
}

function PinPageButton() {
  const { currentPage, isCurrentPagePinned, toggleCurrentPagePinned } = usePinnedPages();

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={toggleCurrentPagePinned}
      title={isCurrentPagePinned ? `Unpin ${currentPage.label}` : `Pin ${currentPage.label}`}
      aria-label={isCurrentPagePinned ? `Unpin ${currentPage.label}` : `Pin ${currentPage.label}`}
      className={isCurrentPagePinned ? 'bg-accent-50 dark:bg-brand-600 border-accent-100 dark:border-brand-500 text-accent-600 dark:text-accent-400 hover:bg-accent-100 dark:hover:bg-brand-500' : ''}
    >
      <Pin size={15} className={isCurrentPagePinned ? 'fill-current' : ''} />
      Pin
    </Button>
  );
}

export default function AppLayout({ userName, userFirstName, userLastName, userEmail, businessName, userRole, onLogout }: AppLayoutProps) {
  const location = useLocation();
  const isHome = location.pathname === '/home';
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DESKTOP_SIDEBAR_COLLAPSED_KEY) === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DESKTOP_SIDEBAR_COLLAPSED_KEY, String(isDesktopSidebarCollapsed));
  }, [isDesktopSidebarCollapsed]);

  const toggleDesktopSidebarCollapsed = () => {
    setIsDesktopSidebarCollapsed((current) => !current);
  };

  return (
    <PinnedPagesProvider userRole={userRole}>
      <div className="min-h-screen bg-cream dark:bg-brand-900">
        <Sidebar
          userName={userName}
          userFirstName={userFirstName}
          userLastName={userLastName}
          userEmail={userEmail}
          businessName={businessName}
          userRole={userRole}
          onLogout={onLogout}
          isDesktopCollapsed={isDesktopSidebarCollapsed}
          onToggleDesktopCollapsed={toggleDesktopSidebarCollapsed}
        />
        {/* Content area shifts right on desktop, down on mobile */}
        <main className={`pt-14 lg:pt-0 min-h-screen transition-[margin] duration-200 ${isDesktopSidebarCollapsed ? 'lg:ml-0' : 'lg:ml-72'}`}>
          <div className="border-b border-brand-100 dark:border-brand-600 bg-white dark:bg-brand-800">
            <div className="p-3 sm:px-6 sm:py-3 max-w-7xl mx-auto">
              <div className="flex items-center justify-between gap-3">
                <div className="hidden lg:block">
                  {isDesktopSidebarCollapsed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleDesktopSidebarCollapsed}
                      className="text-brand-700 dark:text-brand-100"
                      title="Expand sidebar"
                      aria-label="Expand sidebar"
                    >
                      <Menu size={14} />
                      Menu
                    </Button>
                  ) : <span />}
                </div>
                <div className="flex items-center gap-2">
                  <NotificationBell />
                  <PinPageButton />
                </div>
              </div>
            </div>
          </div>
          <div className={`mx-auto w-full p-4 sm:p-6 ${isHome ? 'max-w-[1600px]' : 'max-w-7xl'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </PinnedPagesProvider>
  );
}
