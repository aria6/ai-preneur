import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useIsTabletUp } from '../../hooks/use-media-query';
import { Icon } from '../ui/Icon';
import { SIDEBAR_ID, Sidebar } from './Sidebar';

const COLLAPSED_KEY = 'aip:sidebar-collapsed';

function readStoredCollapsed(): boolean | null {
  try {
    const value = window.localStorage.getItem(COLLAPSED_KEY);
    return value === null ? null : value === 'true';
  } catch {
    return null;
  }
}

function storeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    // Storage unavailable (private mode) — keep the in-memory state.
  }
}

/** Authenticated shell: collapsible sidebar + top bar + routed content. */
export function AppLayout() {
  const isTabletUp = useIsTabletUp();
  const location = useLocation();

  // Tablets start as an icon rail, desktops expanded — unless the user chose otherwise.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => readStoredCollapsed() ?? !window.matchMedia('(min-width: 1024px)').matches,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      storeCollapsed(!previous);
      return !previous;
    });
  }, []);

  const expand = useCallback(() => {
    storeCollapsed(false);
    setCollapsed(false);
  }, []);

  // Close the drawer on navigation and when growing past the phone breakpoint.
  // Close the drawer on navigation (adjust-state-during-render, not an effect).
  const [drawerPath, setDrawerPath] = useState(location.pathname);
  if (drawerPath !== location.pathname) {
    setDrawerPath(location.pathname);
    setMobileOpen(false);
  }
  // The drawer only exists on phones: derived, so growing past the breakpoint closes it.
  const drawerOpen = mobileOpen && !isTabletUp;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50 text-slate-900">
      <Sidebar
        collapsed={collapsed && isTabletUp}
        mobileOpen={drawerOpen}
        isMobile={!isTabletUp}
        onToggleCollapsed={toggleCollapsed}
        onExpand={expand}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones only. On tablet/desktop the sidebar holds navigation, toggle and profile,
            so there is no top bar at all. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-controls={SIDEBAR_ID}
            aria-expanded={drawerOpen}
            aria-label="Buka menu"
            className="-ml-1.5 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <Icon name="menu" className="size-6" />
          </button>
          <span className="font-semibold tracking-tight">AI Preneur</span>
        </header>

        <main className="flex-1 overflow-y-auto">
          {/* No max-width: collapsing the sidebar gives the page the freed space. */}
          <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
