import { NavLink } from 'react-router';

import { useAuth } from '../../hooks/use-auth';
import { cn } from '../../lib/cn';
import { NAV_ITEMS } from '../../lib/navigation';
import { Icon } from '../ui/Icon';

export const SIDEBAR_ID = 'app-sidebar';

interface SidebarProps {
  /** md+ only: icon rail instead of the full sidebar. */
  collapsed: boolean;
  /** < md only: off-canvas drawer visibility. */
  mobileOpen: boolean;
  /** Phone layout: the closed drawer is made inert so it cannot be tabbed into. */
  isMobile: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}

/**
 * - Phone (<768px): off-canvas drawer with backdrop, always full width labels.
 * - Tablet/desktop (≥768px): static column, collapsible to a 64px icon rail.
 */
export function Sidebar({ collapsed, mobileOpen, isMobile, onToggleCollapsed, onCloseMobile }: SidebarProps) {
  const { can } = useAuth();
  const items = NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onCloseMobile}
        className={cn(
          'fixed inset-0 z-30 bg-slate-900/50 transition-opacity md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        id={SIDEBAR_ID}
        aria-label="Navigasi utama"
        inert={isMobile && !mobileOpen}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white',
          'transition-[transform,width] duration-200 ease-out',
          'md:static md:z-auto md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:w-16' : 'md:w-64',
        )}
      >
        <div className={cn('flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 px-4', collapsed && 'md:justify-center md:px-0')}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            AP
          </span>
          <span className={cn('truncate font-semibold tracking-tight', collapsed && 'md:hidden')}>AI Preneur</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
            aria-label="Tutup menu"
          >
            <Icon name="close" className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  collapsed && 'md:justify-center md:px-0',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon name={item.icon} className="size-5 shrink-0" />
              <span className={cn('truncate', collapsed && 'md:sr-only')}>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-slate-200 p-3 md:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-controls={SIDEBAR_ID}
            aria-expanded={!collapsed}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900',
              collapsed && 'justify-center px-0',
            )}
            title={collapsed ? 'Perluas menu' : undefined}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} className="size-5 shrink-0" />
            <span className={cn(collapsed && 'sr-only')}>{collapsed ? 'Perluas menu' : 'Ciutkan menu'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
