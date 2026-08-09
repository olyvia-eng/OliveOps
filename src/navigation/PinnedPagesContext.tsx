import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { BusinessUserRole } from '../auth/types';
import { getSidebarLinkItems } from './sidebarConfig';

const PINNED_PAGES_STORAGE_KEY = 'oliveops.navigation.pinned-pages.v1';
const LEGACY_FAVORITES_STORAGE_KEY = 'oliveops.navigation.favorites.v1';

const savePinnedPages = (pinnedPages: PinnedPage[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PINNED_PAGES_STORAGE_KEY, JSON.stringify(pinnedPages));
};

type PinnedPage = {
  id: string;
  label: string;
  to: string;
  end?: boolean;
};

type PinnedPagesContextValue = {
  pinnedPages: PinnedPage[];
  currentPage: PinnedPage;
  isCurrentPagePinned: boolean;
  toggleCurrentPagePinned: () => void;
  isPagePinned: (to: string) => boolean;
  togglePinnedPage: (page: PinnedPage) => void;
  reorderPinnedPages: (fromIndex: number, toIndex: number) => void;
};

const PinnedPagesContext = createContext<PinnedPagesContextValue | null>(null);

const normalizePath = (value: string) => {
  if (!value) return '/';
  if (value === '/') return '/';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const isRouteActive = (pathname: string, to: string, end?: boolean) => {
  const normalizedPath = normalizePath(pathname);
  const normalizedTo = normalizePath(to);

  if (normalizedTo === '/') return normalizedPath === '/';
  if (end) return normalizedPath === normalizedTo;
  return normalizedPath === normalizedTo || normalizedPath.startsWith(`${normalizedTo}/`);
};

const toFallbackLabel = (pathname: string) => {
  if (pathname === '/' || pathname === '/home') return 'Home';
  if (pathname === '/company-dashboard') return 'Company Dashboard';
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[-_]/g, ' '))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' / ');
};

interface PinnedPagesProviderProps {
  userRole: BusinessUserRole;
  children: ReactNode;
}

export function PinnedPagesProvider({ userRole, children }: PinnedPagesProviderProps) {
  const location = useLocation();
  const candidates = useMemo(() => getSidebarLinkItems(userRole), [userRole]);

  const [pinnedPages, setPinnedPages] = useState<PinnedPage[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(PINNED_PAGES_STORAGE_KEY)
        ?? window.localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY);
      if (!raw) {
        setPinnedPages([]);
        setHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setPinnedPages([]);
        setHydrated(true);
        return;
      }

      const loaded = parsed.filter((value): value is PinnedPage => {
        return (
          typeof value?.id === 'string' &&
          typeof value?.label === 'string' &&
          typeof value?.to === 'string'
        );
      });

      setPinnedPages(loaded);
    } catch {
      setPinnedPages([]);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    savePinnedPages(pinnedPages);
  }, [pinnedPages, hydrated]);

  const currentPage = useMemo<PinnedPage>(() => {
    const pathname = normalizePath(location.pathname);

    const match = [...candidates]
      .sort((a, b) => b.to.length - a.to.length)
      .find((candidate) => isRouteActive(pathname, candidate.to, candidate.end));

    if (match) {
      return {
        id: match.id,
        label: match.label,
        to: normalizePath(match.to),
        end: match.end,
      };
    }

    return {
      id: `custom-${pathname}`,
      label: toFallbackLabel(pathname),
      to: pathname,
      end: true,
    };
  }, [candidates, location.pathname]);

  const isCurrentPagePinned = useMemo(() => {
    return pinnedPages.some((pinnedPage) => normalizePath(pinnedPage.to) === normalizePath(currentPage.to));
  }, [currentPage.to, pinnedPages]);

  const toggleCurrentPagePinned = () => {
    setPinnedPages((current) => {
      const currentPath = normalizePath(currentPage.to);
      const exists = current.some((pinnedPage) => normalizePath(pinnedPage.to) === currentPath);

      if (exists) {
        const next = current.filter((pinnedPage) => normalizePath(pinnedPage.to) !== currentPath);
        savePinnedPages(next);
        return next;
      }

      const next = [...current, currentPage];
      savePinnedPages(next);
      return next;
    });
  };

  const isPagePinned = (to: string) => {
    const path = normalizePath(to);
    return pinnedPages.some((pinnedPage) => normalizePath(pinnedPage.to) === path);
  };

  const togglePinnedPage = (page: PinnedPage) => {
    setPinnedPages((current) => {
      const targetPath = normalizePath(page.to);
      const exists = current.some((pinnedPage) => normalizePath(pinnedPage.to) === targetPath);

      if (exists) {
        const next = current.filter((pinnedPage) => normalizePath(pinnedPage.to) !== targetPath);
        savePinnedPages(next);
        return next;
      }

      const next = [
        ...current,
        {
          ...page,
          to: targetPath,
        },
      ];
      savePinnedPages(next);
      return next;
    });
  };

  const reorderPinnedPages = (fromIndex: number, toIndex: number) => {
    setPinnedPages((current) => {
      if (fromIndex === toIndex) return current;
      if (fromIndex < 0 || fromIndex >= current.length) return current;
      if (toIndex < 0 || toIndex >= current.length) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      savePinnedPages(next);
      return next;
    });
  };

  return (
    <PinnedPagesContext.Provider
      value={{
        pinnedPages,
        currentPage,
        isCurrentPagePinned,
        toggleCurrentPagePinned,
        isPagePinned,
        togglePinnedPage,
        reorderPinnedPages,
      }}
    >
      {children}
    </PinnedPagesContext.Provider>
  );
}

export function usePinnedPages() {
  const context = useContext(PinnedPagesContext);
  if (!context) {
    throw new Error('usePinnedPages must be used within PinnedPagesProvider');
  }
  return context;
}
