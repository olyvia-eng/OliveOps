import { Outlet, useLocation } from 'react-router-dom';
import { Pin } from 'lucide-react';
import Sidebar from './Sidebar';
import type { BusinessUserRole } from '../../auth/types';
import { PinnedPagesProvider, usePinnedPages } from '../../navigation/PinnedPagesContext';
import { Button } from '../ui';
import NotificationBell from '../notifications/NotificationBell';
import useUiPreferences from './useUiPreferences';

interface AppLayoutProps {
  userId: string;
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

export default function AppLayout({ userId, userName, userFirstName, userLastName, userEmail, businessName, userRole, onLogout }: AppLayoutProps) {
  const location = useLocation();
  const isHome = location.pathname === '/home';
  const { appearanceStyle, sidebarCollapsed, setAppearanceStyle, setSidebarCollapsed } = useUiPreferences(userId);

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
          appearanceStyle={appearanceStyle}
          onAppearanceStyleChange={setAppearanceStyle}
          isDesktopCollapsed={sidebarCollapsed}
          onToggleDesktopCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        {/* Content area shifts right on desktop, down on mobile */}
        <main className={`pt-14 lg:pt-0 min-h-screen transition-[margin] duration-200 ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-72'}`}>
          <div className="app-header-surface border-b">
            <div className="p-3 sm:px-6 sm:py-3 max-w-7xl mx-auto">
              <div className="flex items-center justify-between gap-3">
                <div className="hidden lg:block" />
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
