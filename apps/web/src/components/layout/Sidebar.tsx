import { useEffect, useId, useState } from 'react';
import { NavLink, useLocation } from 'react-router';

import { useAuth } from '../../hooks/use-auth';
import { cn } from '../../lib/cn';
import {
  isPathActive,
  visibleNavEntries,
  type NavGroupItem,
  type NavLinkItem,
} from '../../lib/navigation';
import { Icon } from '../ui/Icon';
import { SidebarProfile } from './SidebarProfile';

export const SIDEBAR_ID = 'app-sidebar';

const ITEM_BASE =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors';
const ITEM_IDLE = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';
const ITEM_ACTIVE = 'bg-primary-50 text-primary-700';

interface SidebarProps {
  /** md+ only: icon rail instead of the full sidebar. */
  collapsed: boolean;
  /** < md only: off-canvas drawer visibility. */
  mobileOpen: boolean;
  /** Phone layout: the closed drawer is made inert so it cannot be tabbed into. */
  isMobile: boolean;
  onToggleCollapsed: () => void;
  /** Expands the rail (used when a group is clicked while collapsed). */
  onExpand: () => void;
  onCloseMobile: () => void;
}

function SidebarLink({
  item,
  collapsed,
  nested = false,
}: {
  item: NavLinkItem;
  collapsed: boolean;
  nested?: boolean;
}) {
  return (
    <NavLink
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          ITEM_BASE,
          nested && 'pl-11',
          collapsed && 'md:justify-center md:px-0',
          isActive ? ITEM_ACTIVE : ITEM_IDLE,
        )
      }
    >
      {!nested && <Icon name={item.icon} className="size-5 shrink-0" />}
      <span className={cn('truncate', collapsed && 'md:sr-only')}>{item.label}</span>
    </NavLink>
  );
}

/**
 * Expandable menu group. Opens automatically when one of its pages is active.
 * In the collapsed rail, clicking it expands the sidebar and opens the group.
 */
function SidebarGroup({
  group,
  collapsed,
  onExpand,
}: {
  group: NavGroupItem;
  collapsed: boolean;
  onExpand: () => void;
}) {
  const { pathname } = useLocation();
  const panelId = useId();
  const containsActive = group.children.some((child) => isPathActive(pathname, child.to));
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const onClick = () => {
    if (collapsed) {
      onExpand();
      setOpen(true);
    } else {
      setOpen((value) => !value);
    }
  };

  const expanded = open && !collapsed;

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        aria-controls={panelId}
        title={collapsed ? group.label : undefined}
        className={cn(
          ITEM_BASE,
          collapsed && 'md:justify-center md:px-0',
          collapsed && containsActive
            ? ITEM_ACTIVE
            : containsActive
              ? 'text-primary-700 hover:bg-slate-100'
              : ITEM_IDLE,
        )}
      >
        <Icon name={group.icon} className="size-5 shrink-0" />
        <span className={cn('flex-1 truncate text-left', collapsed && 'md:sr-only')}>
          {group.label}
        </span>
        <Icon
          name="chevronDown"
          className={cn(
            'size-4 shrink-0 transition-transform',
            expanded && 'rotate-180',
            collapsed && 'md:hidden',
          )}
        />
      </button>
      <div id={panelId} hidden={!expanded} className="mt-1 space-y-1">
        {group.children.map((child) => (
          <SidebarLink key={child.to} item={child} collapsed={false} nested />
        ))}
      </div>
    </div>
  );
}

/**
 * - Phone (<768px): off-canvas drawer opened from the top-bar menu button.
 * - Tablet/desktop (≥768px): static column, collapsible to a 64px icon rail with
 *   the round edge toggle next to the logo. The current user sits at the bottom.
 */
export function Sidebar({
  collapsed,
  mobileOpen,
  isMobile,
  onToggleCollapsed,
  onExpand,
  onCloseMobile,
}: SidebarProps) {
  const { can } = useAuth();
  const entries = visibleNavEntries(can);
  const toggleLabel = collapsed ? 'Perluas Menu' : 'Rapatkan Menu';

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
          // relative: anchors the edge toggle; z-20 keeps it and the profile menu above the page.
          'md:relative md:z-20 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:w-16' : 'md:w-64',
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 px-4',
            collapsed && 'md:justify-center md:px-0',
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-sm font-bold text-white">
            AP
          </span>
          <span className={cn('truncate font-semibold tracking-tight', collapsed && 'md:hidden')}>
            AI Preneur
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
            aria-label="Tutup menu"
          >
            <Icon name="close" className="size-5" />
          </button>
        </div>

        {/* Tablet/desktop: round toggle sitting on the sidebar's right edge, level with the logo. */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-controls={SIDEBAR_ID}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={cn(
            'absolute top-5 -right-3 z-10 hidden size-6 items-center justify-center rounded-full md:flex',
            'border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors',
            'hover:border-primary-300 hover:text-primary-600',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500',
          )}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} className="size-3.5" />
        </button>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {entries.map((entry) =>
            entry.type === 'link' ? (
              <SidebarLink key={entry.to} item={entry} collapsed={collapsed} />
            ) : (
              <SidebarGroup
                key={entry.id}
                group={entry}
                collapsed={collapsed}
                onExpand={onExpand}
              />
            ),
          )}
        </nav>

        <div className={cn('shrink-0 border-t border-slate-200 p-3', collapsed && 'md:px-2')}>
          <SidebarProfile collapsed={collapsed} />
        </div>
      </aside>
    </>
  );
}
