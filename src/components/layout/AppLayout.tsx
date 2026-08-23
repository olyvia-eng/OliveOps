import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import type { BusinessUserRole } from '../../auth/types';
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

export default function AppLayout({ userId, userName, userFirstName, userLastName, userEmail, businessName, userRole, onLogout }: AppLayoutProps) {
  const location = useLocation();
  const isHome = location.pathname === '/home';
  const { appearanceStyle, theme, sidebarCollapsed, setAppearanceStyle, setTheme, setSidebarCollapsed } = useUiPreferences(userId);

  return (
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
          theme={theme}
          onThemeChange={setTheme}
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
                </div>
              </div>
            </div>
          </div>
          <div className={`mx-auto w-full p-4 sm:p-6 ${isHome ? 'max-w-[1600px]' : 'max-w-7xl'}`}>
            <Outlet />
          </div>
        </main>
    </div>
  );
}
